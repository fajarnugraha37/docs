# learn-docker-mastery-for-java-engineers-part-010.md

# Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1

> Series: `learn-docker-mastery-for-java-engineers`  
> Part: `010`  
> Topic: `ENTRYPOINT`, `CMD`, process contract, override semantics, PID 1, signal handling  
> Audience: Java software engineer / tech lead  
> Goal: setelah bagian ini, kamu bisa mendesain startup contract container Java yang predictable, debuggable, override-friendly, dan aman untuk graceful shutdown.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 009, kita sudah membangun fondasi:

- container adalah proses yang diberi boundary;
- Docker Engine menjalankan container melalui runtime stack;
- image adalah artifact berbasis layer, tag, digest, manifest, dan platform;
- container punya lifecycle sendiri;
- Docker CLI adalah alat inspeksi runtime;
- Dockerfile adalah deskripsi derivasi filesystem;
- Docker build adalah cache graph;
- Java dalam container harus sadar memory, CPU, GC, dan signal.

Part ini masuk ke salah satu titik yang terlihat kecil tetapi sangat menentukan reliability:

> **Apa sebenarnya proses utama container kamu?**

Di Docker, container hidup selama proses utama hidup. Proses utama itu ditentukan oleh kombinasi:

- `ENTRYPOINT`
- `CMD`
- override dari `docker run`
- override dari Docker Compose
- wrapper script
- shell form vs exec form
- init process
- signal propagation
- PID 1 behavior

Untuk Java service, kesalahan di area ini sering menghasilkan incident seperti:

- Spring Boot tidak graceful shutdown;
- SIGTERM tidak sampai ke JVM;
- container butuh SIGKILL saat deployment;
- request in-flight terputus;
- connection pool tidak ditutup;
- Kafka/RabbitMQ consumer tidak commit/ack dengan benar;
- child process menjadi zombie;
- command override membingungkan di CI;
- image sulit dipakai untuk debug;
- Dockerfile terlihat benar, tetapi runtime behavior salah.

Bagian ini bukan sekadar “pakai `ENTRYPOINT` ini dan `CMD` itu”. Fokusnya adalah kontrak.

---

## 1. Core Mental Model: Container Is an Executable Contract

Sebuah image container bukan hanya filesystem. Image juga membawa metadata runtime, termasuk:

- default executable;
- default arguments;
- working directory;
- environment;
- exposed port metadata;
- user;
- healthcheck;
- stop signal.

Dari perspektif startup, image menjawab dua pertanyaan:

1. **Executable apa yang harus dijalankan?**
2. **Argumen default apa yang harus diberikan ke executable itu?**

Docker memodelkan dua hal itu dengan:

```dockerfile
ENTRYPOINT ["executable"]
CMD ["default", "arguments"]
```

Mental model yang paling berguna:

```text
final process = ENTRYPOINT + CMD
```

Tetapi ini hanya benar dalam kasus tertentu. Karena bentuk shell/exec, override, dan Compose bisa mengubah hasil akhirnya.

---

## 2. `ENTRYPOINT` vs `CMD`: Bukan Sinonim

Banyak engineer menganggap `ENTRYPOINT` dan `CMD` sebagai dua cara berbeda untuk menulis command startup. Itu framing yang terlalu dangkal.

Lebih tepat:

| Instruction | Peran Mental | Biasanya Dipakai Untuk |
|---|---|---|
| `ENTRYPOINT` | “Apa program utama image ini?” | executable tetap |
| `CMD` | “Apa argumen default untuk program itu?” | default parameter yang boleh dioverride |

Contoh image Java service:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
CMD []
```

Artinya:

- image ini pada dasarnya menjalankan Java application;
- tidak ada default argument tambahan;
- user masih bisa menambahkan argumen setelah nama image.

Contoh tool image:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/migrator.jar"]
CMD ["--help"]
```

Artinya:

- executable tetap adalah migrator;
- default behavior adalah menampilkan help;
- user bisa override `CMD` dengan argumen lain:

```bash
docker run my-migrator migrate --tenant=abc
```

Yang terjadi secara konseptual:

```text
java -jar /app/migrator.jar migrate --tenant=abc
```

---

## 3. Dockerfile Bisa Punya `CMD` Tanpa `ENTRYPOINT`

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY app.jar /app/app.jar
CMD ["java", "-jar", "/app/app.jar"]
```

Ini valid. Tetapi kontraknya berbeda.

Jika user menjalankan:

```bash
docker run my-app
```

Maka default command jalan.

Jika user menjalankan:

```bash
docker run my-app bash
```

Maka `CMD` diganti menjadi:

```text
bash
```

Artinya image menjadi mudah dioverride untuk debug, tetapi identitas executable image lebih lemah. Untuk aplikasi production, ini kadang terlalu longgar.

---

## 4. Dockerfile Bisa Punya `ENTRYPOINT` Tanpa `CMD`

Contoh:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika user menjalankan:

```bash
docker run my-app
```

Maka prosesnya:

```text
java -jar /app/app.jar
```

Jika user menjalankan:

```bash
docker run my-app --spring.profiles.active=dev
```

Maka argumen ditambahkan:

```text
java -jar /app/app.jar --spring.profiles.active=dev
```

Ini cocok untuk Java app yang executable-nya tetap, tetapi runtime parameter bisa diberikan.

Namun, untuk service yang semua konfigurasi sebaiknya datang dari env/config file, argumen runtime sering dibuat minimal.

---

## 5. Dockerfile Bisa Punya Keduanya

Contoh:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
CMD ["--spring.profiles.active=default"]
```

Default:

```bash
docker run my-app
```

Menjadi:

```text
java -jar /app/app.jar --spring.profiles.active=default
```

Override `CMD`:

```bash
docker run my-app --spring.profiles.active=prod
```

Menjadi:

```text
java -jar /app/app.jar --spring.profiles.active=prod
```

Ini pattern yang berguna bila:

- executable image tidak boleh berubah;
- default argument boleh berubah;
- image ingin tetap bisa dipakai untuk beberapa mode terbatas.

Tetapi hati-hati: untuk production, environment-specific behavior sebaiknya tidak dikunci di image. Jangan membuat image yang secara default mengarah ke environment tertentu tanpa kontrol deployment yang jelas.

---

## 6. Shell Form vs Exec Form

Dockerfile instruction seperti `RUN`, `CMD`, dan `ENTRYPOINT` punya dua bentuk umum:

### 6.1 Shell Form

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

atau:

```dockerfile
CMD java -jar /app/app.jar
```

Ini dijalankan melalui shell, kira-kira seperti:

```text
/bin/sh -c "java -jar /app/app.jar"
```

Konsekuensi:

- shell menjadi proses utama;
- JVM biasanya menjadi child process;
- signal dari Docker masuk ke shell dulu;
- shell belum tentu meneruskan signal ke child process;
- quoting dan environment expansion mengikuti shell;
- behavior bisa berbeda tergantung shell base image.

### 6.2 Exec Form

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini langsung menjalankan executable tanpa shell wrapper.

Konsekuensi:

- `java` bisa menjadi PID 1;
- signal dari Docker langsung sampai ke JVM;
- tidak ada shell expansion otomatis;
- argument boundary jelas;
- lebih predictable;
- lebih aman untuk command dengan spasi/karakter khusus.

Untuk service Java production, default praktisnya:

> Gunakan exec form untuk `ENTRYPOINT`.

Dokumentasi Docker juga menekankan penggunaan exec form untuk `ENTRYPOINT`, sering dikombinasikan dengan `CMD` sebagai default arguments yang bisa dioverride.

---

## 7. Kenapa Shell Form Berbahaya untuk Java Service

Misalnya Dockerfile:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Yang terlihat:

```text
container menjalankan Java
```

Yang sebenarnya sering terjadi:

```text
PID 1: /bin/sh -c java -jar /app/app.jar
PID 7: java -jar /app/app.jar
```

Saat Docker menghentikan container:

```bash
docker stop my-app
```

Docker mengirim signal termination ke PID 1. Jika PID 1 adalah shell dan shell tidak meneruskan signal ke JVM, maka JVM tidak menerima SIGTERM. Akibatnya:

1. Spring Boot graceful shutdown tidak berjalan;
2. lifecycle callback tidak dipanggil;
3. HTTP server tidak berhenti menerima request dengan benar;
4. consumer tidak close;
5. connection pool tidak shutdown;
6. telemetry flush bisa hilang;
7. setelah timeout, Docker mengirim SIGKILL;
8. proses mati paksa.

Ini bukan masalah “Docker lambat stop”. Ini masalah kontrak proses.

---

## 8. PID 1 Problem

Dalam sistem Unix/Linux, PID 1 adalah proses init. Dalam container, proses utama container biasanya menjadi PID 1 dalam PID namespace container.

PID 1 punya karakteristik khusus:

- menjadi target utama signal lifecycle container;
- bertanggung jawab mereap zombie process jika ada child process;
- beberapa default signal handling berbeda dibanding proses biasa;
- jika PID 1 tidak menangani signal dengan benar, shutdown bisa gagal;
- jika PID 1 tidak melakukan wait pada child process, zombie bisa menumpuk.

Dalam container Java sederhana:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

JVM menjadi PID 1.

Ini biasanya cukup bila:

- aplikasi Java tidak spawn banyak child process;
- JVM menerima SIGTERM;
- Spring Boot graceful shutdown dikonfigurasi;
- tidak ada wrapper script yang menahan signal.

Tetapi jika aplikasi/wrapper menelurkan child process, kamu perlu memikirkan init process atau signal forwarding.

---

## 9. `docker stop`: Apa yang Sebenarnya Terjadi?

Secara konseptual:

```bash
docker stop my-app
```

Melakukan:

1. kirim stop signal ke proses utama container;
2. tunggu grace period;
3. jika proses belum keluar, kirim SIGKILL.

Default stop signal biasanya `SIGTERM`, tetapi bisa dipengaruhi oleh `STOPSIGNAL` dalam Dockerfile atau opsi runtime tertentu.

Contoh:

```dockerfile
STOPSIGNAL SIGTERM
```

Untuk Java service, umumnya `SIGTERM` adalah pilihan benar karena:

- orchestrator/deployment tools biasanya memakai SIGTERM untuk graceful shutdown;
- Spring Boot dapat merespons graceful shutdown saat menerima termination signal;
- JVM shutdown hook dieksekusi saat termination normal.

Jangan mengandalkan SIGKILL untuk shutdown normal. SIGKILL tidak bisa ditangkap oleh proses.

---

## 10. Java, JVM, dan Signal

JVM dapat merespons signal tertentu. Untuk lifecycle container, yang paling penting:

| Signal | Makna Umum | Implikasi Java |
|---|---|---|
| SIGTERM | graceful termination request | shutdown hook bisa berjalan |
| SIGINT | interrupt dari terminal | mirip Ctrl+C |
| SIGKILL | forced kill | tidak bisa ditangkap |
| SIGHUP | terminal hangup / reload pattern tertentu | jarang dipakai untuk Java service modern |

Dalam Spring Boot:

- `SIGTERM` dapat memicu shutdown application context;
- graceful shutdown dapat memberi waktu HTTP server menyelesaikan request;
- lifecycle beans bisa dihentikan;
- connection pool bisa close;
- telemetry bisa flush;
- consumer loop bisa berhenti.

Tetapi itu semua hanya terjadi jika signal sampai ke JVM.

---

## 11. Anti-Pattern: Shell Wrapper Tanpa `exec`

Sangat umum melihat:

```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Isi script:

```sh
#!/bin/sh
java -jar /app/app.jar
```

Masalah:

- script menjadi PID 1;
- Java menjadi child process;
- shell menunggu Java;
- signal masuk ke shell;
- shell belum tentu meneruskan signal;
- Java bisa tidak graceful shutdown.

Versi lebih baik:

```sh
#!/bin/sh
set -e

exec java -jar /app/app.jar
```

`exec` mengganti proses shell dengan proses Java.

Setelah `exec`:

```text
PID 1: java -jar /app/app.jar
```

Bukan:

```text
PID 1: sh
PID 7: java
```

Ini perbedaan kecil yang sangat besar dampaknya.

---

## 12. Kapan Wrapper Script Masuk Akal?

Wrapper script tidak selalu buruk. Ia berguna bila perlu:

- generate config file dari env;
- menunggu file/cert tertentu tersedia;
- melakukan migration command opsional;
- menyesuaikan JVM option dari env;
- melakukan validation env sebelum start;
- memilih mode `server`, `worker`, atau `migrate`;
- menginisialisasi truststore;
- mengatur permission runtime directory.

Tetapi wrapper script harus memenuhi kontrak:

1. gagal cepat jika konfigurasi invalid;
2. tidak menyembunyikan exit code aplikasi;
3. menggunakan `exec` untuk proses utama;
4. tidak menelan signal;
5. tidak melakukan loop tak terbatas yang mengaburkan failure;
6. tidak melakukan pekerjaan orchestration yang seharusnya di luar container.

Contoh wrapper yang cukup baik:

```sh
#!/bin/sh
set -eu

: "${APP_ENV:?APP_ENV is required}"
: "${SERVER_PORT:=8080}"

JAVA_OPTS="${JAVA_OPTS:-}"

echo "Starting app with APP_ENV=${APP_ENV}, SERVER_PORT=${SERVER_PORT}"

exec java ${JAVA_OPTS} \
  -Dserver.port="${SERVER_PORT}" \
  -jar /app/app.jar
```

Catatan:

- `${JAVA_OPTS}` sengaja tidak dikutip penuh agar bisa berisi beberapa argumen; ini punya risiko word splitting, jadi validasi tetap penting.
- Untuk argumen yang berasal dari input tidak terpercaya, jangan menggunakan pattern ini mentah-mentah.
- Alternatif lebih aman adalah array, tetapi POSIX `sh` tidak punya array. Bash punya array, tetapi tidak selalu ada di minimal image.

---

## 13. Pattern Java ENTRYPOINT yang Umum

### 13.1 Simple Production Service

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- sederhana;
- signal langsung ke JVM;
- mudah dimengerti;
- tidak butuh shell;
- cocok untuk service yang semua config via env.

Kekurangan:

- sulit menyisipkan dynamic JVM options dari env tanpa wrapper;
- tidak ada preflight validation;
- tidak bisa shell expansion.

### 13.2 ENTRYPOINT Fixed, CMD Default App Args

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
CMD ["--server.port=8080"]
```

Kelebihan:

- executable tetap;
- default app args bisa dioverride;
- cocok untuk CLI-style Java app.

Kekurangan:

- untuk service production, runtime args sering lebih baik dikontrol deployment config;
- override bisa membuat behavior berbeda dari yang diharapkan.

### 13.3 Wrapper with `exec`

```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD []
```

Dengan script:

```sh
#!/bin/sh
set -eu

JAVA_OPTS="${JAVA_OPTS:-}"

exec java ${JAVA_OPTS} -jar /app/app.jar "$@"
```

Kelebihan:

- bisa inject JVM args dari env;
- bisa validasi env;
- bisa meneruskan `CMD`/runtime args dengan `"$@"`;
- signal tetap benar jika `exec` dipakai.

Kekurangan:

- script menjadi tempat logic tersembunyi;
- quoting bisa tricky;
- butuh discipline test;
- bisa jadi anti-pattern jika terlalu banyak orchestration.

### 13.4 Entrypoint as Mode Dispatcher

```sh
#!/bin/sh
set -eu

mode="${1:-server}"
shift || true

case "$mode" in
  server)
    exec java ${JAVA_OPTS:-} -jar /app/app.jar "$@"
    ;;
  migrate)
    exec java ${JAVA_OPTS:-} -jar /app/app.jar db migrate "$@"
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    exit 64
    ;;
esac
```

Dockerfile:

```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["server"]
```

Penggunaan:

```bash
docker run my-app
docker run my-app migrate
```

Ini bisa berguna, tetapi hati-hati: semakin banyak mode dalam satu image, semakin besar risiko image berubah menjadi “mini platform” dengan kontrak kabur.

---

## 14. Override Semantics dengan `docker run`

Misalnya image:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
CMD ["--server.port=8080"]
```

### 14.1 Tanpa Override

```bash
docker run my-app
```

Hasil:

```text
java -jar /app/app.jar --server.port=8080
```

### 14.2 Override `CMD`

```bash
docker run my-app --server.port=9090
```

Hasil:

```text
java -jar /app/app.jar --server.port=9090
```

### 14.3 Override `ENTRYPOINT`

```bash
docker run --entrypoint java my-app -version
```

Hasil:

```text
java -version
```

Catatan penting:

`--entrypoint` biasanya hanya executable, bukan satu string panjang dengan argumen kompleks.

Kurang baik:

```bash
docker run --entrypoint "java -version" my-app
```

Lebih benar:

```bash
docker run --entrypoint java my-app -version
```

### 14.4 Debug dengan Shell

Jika image punya shell:

```bash
docker run --rm -it --entrypoint sh my-app
```

Jika image distroless/minimal tanpa shell, command ini gagal. Karena itu production minimal image perlu strategi debug terpisah, bukan asumsi selalu ada shell.

---

## 15. Override Semantics di Docker Compose

Compose punya field:

```yaml
services:
  app:
    image: my-app
    entrypoint: [...]
    command: [...]
```

Mental model:

| Compose Field | Mengoverride |
|---|---|
| `entrypoint` | Dockerfile `ENTRYPOINT` |
| `command` | Dockerfile `CMD` |

Contoh:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
CMD ["--server.port=8080"]
```

Compose:

```yaml
services:
  app:
    image: my-app
    command: ["--server.port=9090"]
```

Hasil:

```text
java -jar /app/app.jar --server.port=9090
```

Compose:

```yaml
services:
  app:
    image: my-app
    entrypoint: ["java"]
    command: ["-version"]
```

Hasil:

```text
java -version
```

Compose juga punya:

```yaml
services:
  app:
    init: true
```

Ini menambahkan init process kecil sebagai PID 1 untuk forward signal dan reap zombie process. Ini berguna jika proses utama atau child process model kamu membutuhkan init behavior.

---

## 16. `init: true` dan `docker run --init`

Docker menyediakan opsi:

```bash
docker run --init my-app
```

Di Compose:

```yaml
services:
  app:
    image: my-app
    init: true
```

Tujuannya:

- menjalankan init process kecil sebagai PID 1;
- forward signal;
- reap zombie process.

Kapan berguna:

- aplikasi spawn child process;
- wrapper menjalankan beberapa subprocess;
- ada tooling yang bisa meninggalkan zombie;
- kamu tidak yakin proses utama melakukan reaping dengan benar.

Kapan tidak perlu:

- Java service sederhana;
- tidak spawn child process;
- memakai exec form langsung;
- shutdown sudah terbukti benar.

Tetapi `--init` bukan pengganti desain entrypoint yang benar. Jika wrapper script menelan signal atau tidak `exec`, `--init` tidak otomatis memperbaiki semua bug desain.

---

## 17. `ENTRYPOINT` dan `CMD` untuk Java: Decision Matrix

| Kebutuhan | Pattern yang Cocok |
|---|---|
| Service sederhana, config via env | `ENTRYPOINT ["java", "-jar", "/app/app.jar"]` |
| App menerima argumen default | `ENTRYPOINT` + `CMD` |
| Perlu validasi env sebelum start | wrapper script + `exec` |
| Perlu dynamic JVM opts dari env | wrapper script + `exec` |
| Perlu mode `server/migrate/worker` | dispatcher entrypoint, tetapi jaga tetap sederhana |
| Perlu debug shell | gunakan `--entrypoint sh` jika image punya shell |
| Image distroless | siapkan debug image atau debug workflow lain |
| Banyak subprocess | pertimbangkan `--init` / `init: true` |

---

## 18. Environment Variable Expansion: Kenapa Exec Form Tidak Expand Env

Contoh yang sering salah:

```dockerfile
ENTRYPOINT ["java", "$JAVA_OPTS", "-jar", "/app/app.jar"]
```

Ini tidak bekerja seperti yang diharapkan. Dalam exec form, Docker tidak menjalankan shell, sehingga `$JAVA_OPTS` tidak diexpand oleh shell. Argumen literal yang diterima Java bisa menjadi string `"$JAVA_OPTS"`.

Jika kamu butuh env expansion, pilihan:

### 18.1 Gunakan Wrapper Script

```sh
#!/bin/sh
set -eu
exec java ${JAVA_OPTS:-} -jar /app/app.jar "$@"
```

### 18.2 Gunakan Shell Form, tetapi Ini Biasanya Tidak Disarankan untuk Service

```dockerfile
ENTRYPOINT java $JAVA_OPTS -jar /app/app.jar
```

Masalahnya kembali ke PID 1/signal.

### 18.3 Gunakan Shell Secara Eksplisit dengan `exec`

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar \"$@\"", "--"]
```

Ini advanced dan mudah salah. Untuk team production, wrapper script yang ditest biasanya lebih jelas.

---

## 19. `JAVA_OPTS`, `JAVA_TOOL_OPTIONS`, dan `JDK_JAVA_OPTIONS`

Ada beberapa cara menyisipkan JVM option.

### 19.1 `JAVA_OPTS`

`JAVA_OPTS` bukan mekanisme universal bawaan JVM. Ini convention yang sering dipakai oleh script startup.

Contoh:

```sh
exec java ${JAVA_OPTS:-} -jar /app/app.jar
```

Jika script tidak membaca `JAVA_OPTS`, variable itu tidak punya efek.

### 19.2 `JAVA_TOOL_OPTIONS`

`JAVA_TOOL_OPTIONS` dibaca oleh JVM launcher dan bisa otomatis menambahkan opsi tertentu.

Contoh:

```bash
docker run -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75" my-app
```

Kelebihan:

- tidak perlu wrapper script;
- JVM sendiri membacanya.

Risiko:

- bisa memengaruhi semua invocation Java dalam container;
- log JVM biasanya menampilkan bahwa option diambil;
- tidak semua opsi cocok;
- perlu governance agar tidak jadi jalan belakang konfigurasi production.

### 19.3 `JDK_JAVA_OPTIONS`

Mirip sebagai environment variable yang diproses oleh Java launcher untuk JDK modern. Ia juga bisa berguna untuk containerized Java.

Prinsip:

> Jangan membuat terlalu banyak jalur konfigurasi JVM. Pilih satu convention team dan dokumentasikan.

---

## 20. Exit Code Propagation

Entrypoint yang benar harus meneruskan exit code proses utama.

Exec form langsung:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Exit code Java menjadi exit code container.

Wrapper dengan `exec`:

```sh
exec java -jar /app/app.jar
```

Exit code Java menjadi exit code container.

Wrapper yang buruk:

```sh
java -jar /app/app.jar
echo "done"
exit 0
```

Masalah:

- app bisa gagal;
- script tetap exit 0;
- Docker/CI/orchestrator menganggap container sukses;
- failure tersembunyi.

Wrapper lain yang buruk:

```sh
java -jar /app/app.jar || true
```

Ini hampir selalu salah untuk production service.

---

## 21. Startup Validation: Fail Fast, Not Half Alive

Entrypoint script bisa digunakan untuk validasi config.

Contoh:

```sh
#!/bin/sh
set -eu

required() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Missing required env: $name" >&2
    exit 78
  fi
}

required DATABASE_URL
required APP_ENV

exec java ${JAVA_OPTS:-} -jar /app/app.jar
```

Kenapa ini berguna?

- container gagal cepat;
- log jelas;
- tidak menunggu app fail dengan stacktrace panjang;
- mencegah service masuk state “running tapi useless”;
- memudahkan diagnosis deployment.

Tetapi jangan terlalu banyak logic di entrypoint. Validasi business config tetap sebaiknya ada di aplikasi.

---

## 22. `ENTRYPOINT` Bukan Tempat Menunggu Dependency Secara Naif

Anti-pattern:

```sh
while ! nc -z db 5432; do
  sleep 1
done

exec java -jar /app/app.jar
```

Ini terlihat membantu, tetapi punya masalah:

- hanya mengecek port terbuka, bukan readiness;
- bisa menunda failure yang seharusnya ditangani app;
- membuat startup behavior tersembunyi;
- tidak punya timeout;
- bisa infinite loop;
- orchestration concern masuk image.

Lebih baik:

- app punya retry/backoff untuk dependency;
- healthcheck membedakan readiness;
- Compose/Testcontainers menggunakan health/wait strategy;
- migration dan startup dependency didesain eksplisit.

Jika tetap perlu wait script untuk local dev, batasi:

- hanya untuk dev/test;
- ada timeout;
- log jelas;
- jangan jadikan satu-satunya reliability mechanism.

---

## 23. App as Single Main Process

Container paling mudah dikelola bila menjalankan satu main process.

Untuk Java service:

```text
one container -> one primary JVM process -> one bounded responsibility
```

Jangan memasukkan:

- app server;
- cron;
- log forwarder;
- migration daemon;
- side process;
- supervisor;
- sshd;

semua dalam satu container kecuali ada alasan kuat.

Jika ada banyak proses, kamu perlu menjawab:

- siapa PID 1?
- siapa meneruskan signal?
- siapa mereap child?
- exit code mana yang menentukan container status?
- jika salah satu proses mati, container harus mati atau tetap jalan?
- log tiap proses ke mana?
- healthcheck mewakili proses mana?

Semakin banyak proses, semakin sulit kontraknya.

---

## 24. Common Java Dockerfile Startup Patterns

### 24.1 Spring Boot Fat JAR Minimal

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Cocok untuk:

- simple service;
- env-based config;
- tidak butuh wrapper;
- no child process.

### 24.2 Spring Boot with JVM Options via Env

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app

COPY target/app.jar /app/app.jar
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER 10001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Script:

```sh
#!/bin/sh
set -eu

JAVA_OPTS="${JAVA_OPTS:-}"

exec java ${JAVA_OPTS} -jar /app/app.jar "$@"
```

Run:

```bash
docker run \
  -e JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError" \
  my-app
```

### 24.3 Use `JAVA_TOOL_OPTIONS` Without Wrapper

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Run:

```bash
docker run \
  -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75" \
  my-app
```

Cocok bila team menerima `JAVA_TOOL_OPTIONS` sebagai convention resmi.

### 24.4 App Args via CMD

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
CMD ["--server.port=8080"]
```

Run:

```bash
docker run my-app --server.port=9090
```

Cocok untuk app/tool yang memang arg-driven.

---

## 25. Debug Override Patterns

### 25.1 Cek Java Version

```bash
docker run --rm --entrypoint java my-app -version
```

### 25.2 Masuk Shell

```bash
docker run --rm -it --entrypoint sh my-app
```

Jika tidak ada `sh`, berarti image memang minimal/distroless.

### 25.3 Cek File dalam Image

```bash
docker run --rm --entrypoint ls my-app -lah /app
```

### 25.4 Run App dengan Argumen Berbeda

```bash
docker run --rm my-app --spring.profiles.active=local
```

### 25.5 Override Compose Command

```yaml
services:
  app:
    image: my-app
    command: ["--spring.profiles.active=local"]
```

### 25.6 Override Compose Entrypoint untuk Debug

```yaml
services:
  app:
    image: my-app
    entrypoint: ["sh"]
    command: []
```

Untuk debug sementara saja. Jangan commit override debug ke production Compose.

---

## 26. Distroless Image: Startup Contract Makin Penting

Distroless/minimal images sering tidak punya:

- shell;
- package manager;
- `ls`;
- `cat`;
- `curl`;
- `ps`;
- CA tooling tambahan;
- debugging tools.

Ini bagus untuk attack surface dan size, tetapi membuat override debugging terbatas.

Jika memakai distroless:

- `ENTRYPOINT` harus benar sejak awal;
- tidak bisa mengandalkan wrapper shell biasa;
- jika butuh wrapper, perlu binary/static entrypoint atau base image yang mendukung;
- siapkan debug variant;
- pastikan logs cukup;
- pastikan healthcheck tidak bergantung pada shell/curl yang tidak ada.

Contoh distroless-ish pattern:

```dockerfile
FROM gcr.io/distroless/java21-debian12
WORKDIR /app
COPY app.jar /app/app.jar
USER nonroot
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Debug strategy:

- build image debug dengan base yang punya shell;
- gunakan same app artifact;
- jangan ubah runtime behavior utama;
- bandingkan env/config/mount/network.

---

## 27. Compose `command` String vs List

Compose bisa menerima command sebagai string atau list.

List form lebih eksplisit:

```yaml
command: ["--server.port=9090"]
```

String form:

```yaml
command: "--server.port=9090"
```

Untuk command kompleks, list form menghindari ambiguity parsing.

Entrypoint list:

```yaml
entrypoint: ["java", "-jar", "/app/app.jar"]
```

Entrypoint string:

```yaml
entrypoint: java -jar /app/app.jar
```

Untuk production-like Compose, biasakan list form agar boundary argumen jelas.

---

## 28. `CMD` sebagai Documentation Contract

Selain runtime default, `CMD` juga menjadi dokumentasi:

```dockerfile
ENTRYPOINT ["my-tool"]
CMD ["--help"]
```

Image ini memberi sinyal:

- default mode adalah help;
- executable utama `my-tool`;
- user diharapkan memberikan argumen.

Untuk Java CLI internal:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/tool.jar"]
CMD ["--help"]
```

Run:

```bash
docker run my-tool validate --file config.yaml
```

Hasil:

```text
java -jar /app/tool.jar validate --file config.yaml
```

Ini jauh lebih baik daripada dokumentasi tersembunyi di README saja.

---

## 29. `ENTRYPOINT` sebagai Policy Boundary

Untuk production application image, `ENTRYPOINT` juga bisa dianggap policy boundary.

Contoh:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini membatasi default bahwa image menjalankan app. User masih bisa override entrypoint, tetapi perlu eksplisit.

Jika hanya:

```dockerfile
CMD ["java", "-jar", "/app/app.jar"]
```

Maka user mudah mengganti command tanpa sadar:

```bash
docker run my-app echo hello
```

Itu bukan selalu buruk. Untuk base image/tool image, fleksibilitas ini bagus. Untuk service image production, kontrak executable yang kuat lebih aman.

---

## 30. Signal Testing: Jangan Asumsi, Uji

Kamu bisa menguji apakah Java menerima SIGTERM.

### 30.1 Tambahkan Log Shutdown Hook

Dalam Java sederhana:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("Shutdown hook called");
}));
```

Atau di Spring Boot, observasi log shutdown.

### 30.2 Jalankan Container

```bash
docker run --name app-test my-app
```

### 30.3 Stop dari Terminal Lain

```bash
docker stop app-test
```

### 30.4 Lihat Log

```bash
docker logs app-test
```

Cari:

- shutdown hook log;
- Spring context closing;
- Tomcat/Netty graceful shutdown log;
- consumer closing;
- connection pool shutdown.

Jika tidak muncul dan container mati setelah timeout, curigai:

- shell form;
- wrapper tanpa `exec`;
- PID 1 tidak forward signal;
- app tidak register graceful shutdown;
- shutdown lebih lama daripada stop timeout;
- thread non-daemon menggantung;
- blocking operation tidak responsive.

---

## 31. Stop Timeout

Jika aplikasi butuh waktu graceful shutdown lebih panjang, kamu bisa mengatur timeout runtime.

Contoh:

```bash
docker stop --time 30 my-app
```

Compose:

```yaml
services:
  app:
    image: my-app
    stop_grace_period: 30s
```

Tetapi jangan asal memperpanjang timeout. Diagnosis dulu:

- apakah signal sampai?
- apakah app mulai shutdown?
- bagian mana yang lama?
- apakah thread pool terminate?
- apakah consumer sedang menunggu poll?
- apakah HTTP keep-alive/request sedang drain?
- apakah telemetry flush blocking?

Timeout panjang tanpa diagnosis hanya menyembunyikan masalah.

---

## 32. Exit Code and Restart Policy Interaction

Entrypoint menentukan exit code container. Restart policy membaca exit behavior.

Contoh wrapper buruk:

```sh
java -jar /app/app.jar
exit 0
```

Jika app crash, container exit 0. Dengan restart policy `on-failure`, container tidak restart.

Wrapper yang benar:

```sh
exec java -jar /app/app.jar
```

atau jika butuh cleanup:

```sh
#!/bin/sh
set +e

java -jar /app/app.jar
status=$?

echo "App exited with status $status"

# cleanup non-critical here

exit "$status"
```

Untuk production, prefer `exec` kecuali benar-benar butuh post-process cleanup.

---

## 33. `ENTRYPOINT` dan Security

Startup contract juga berdampak security.

Shell form:

```dockerfile
ENTRYPOINT sh -c "java $JAVA_OPTS -jar /app/app.jar"
```

Risiko:

- command injection jika env tidak terpercaya;
- quoting bug;
- shell metacharacter behavior;
- semakin besar attack surface jika shell dibutuhkan.

Exec form:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lebih deterministic:

- tidak ada shell parsing;
- setiap argumen jelas;
- lebih sulit terjadi injection via shell metacharacter.

Jika harus memakai shell, pastikan input berasal dari sumber terpercaya dan validation dilakukan.

---

## 34. `ENTRYPOINT` dan Non-Root User

Jika image memakai:

```dockerfile
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Pastikan user tersebut bisa:

- read app jar;
- read config file;
- read truststore/keystore;
- write temp directory jika dibutuhkan;
- write log/heap dump/JFR output jika path dikonfigurasi;
- bind ke port non-privileged;
- access mounted volume dengan UID/GID cocok.

Banyak startup failure terlihat seperti entrypoint problem, padahal sebenarnya permission problem:

```text
Error: Unable to access jarfile /app/app.jar
```

atau:

```text
Permission denied
```

Diagnosis:

```bash
docker inspect my-container
docker logs my-container
docker run --rm --entrypoint id my-app
docker run --rm --entrypoint ls my-app -lah /app
```

Jika image minimal tidak punya `id`/`ls`, gunakan debug image/variant.

---

## 35. Healthcheck Bukan Pengganti Entrypoint yang Benar

Healthcheck menjawab:

```text
apakah service healthy?
```

Entrypoint menjawab:

```text
proses apa yang menjadi hidup container?
```

Jika entrypoint salah:

- signal tidak sampai;
- exit code salah;
- wrapper infinite loop;
- app mati tapi script tetap hidup;

healthcheck mungkin mendeteksi, tetapi masalah kontrak proses tetap ada.

Contoh anti-pattern:

```sh
#!/bin/sh
while true; do
  java -jar /app/app.jar
  echo "app crashed, restarting..."
  sleep 5
done
```

Ini membuat container tetap running meski app crash. Restart policy Docker tidak melihat crash sebenarnya. Healthcheck mungkin unhealthy, tetapi root cause tersamarkan.

Lebih baik:

```sh
exec java -jar /app/app.jar
```

Biarkan runtime/orchestrator yang mengelola restart.

---

## 36. Operational Smells

Waspadai image/container dengan ciri berikut:

1. Dockerfile memakai shell form `ENTRYPOINT java ...`.
2. Entrypoint script tidak memakai `exec`.
3. Entrypoint script melakukan banyak orchestration.
4. Wrapper menelan exit code.
5. Container menjalankan supervisor tanpa alasan jelas.
6. App crash tetapi container tetap running.
7. Docker stop selalu berakhir SIGKILL.
8. Shutdown log tidak pernah muncul.
9. Debug membutuhkan edit image production.
10. Compose override `entrypoint` dipakai untuk production behavior normal.
11. `JAVA_OPTS` diset tetapi tidak pernah dipakai.
12. `CMD` berisi environment-specific production config.
13. Image production hanya bisa jalan dengan shell wrapper yang tidak dites.
14. Distroless image dipakai tanpa debug strategy.
15. Exit code tidak dipercaya oleh CI/CD.

---

## 37. Recommended Baseline for Java Service

Untuk kebanyakan Java HTTP service:

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app

COPY target/app.jar /app/app.jar

USER 10001

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lalu config via env:

```bash
docker run \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError" \
  my-app
```

Jika butuh wrapper:

```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Script:

```sh
#!/bin/sh
set -eu

: "${APP_ENV:?APP_ENV is required}"

exec java ${JAVA_OPTS:-} -jar /app/app.jar "$@"
```

Compose:

```yaml
services:
  app:
    image: my-app
    init: true
    stop_grace_period: 30s
    environment:
      APP_ENV: local
      JAVA_TOOL_OPTIONS: "-XX:MaxRAMPercentage=75"
```

Catatan:

- `init: true` optional, bukan wajib;
- jangan menaruh config prod sebagai default image;
- jangan gunakan shell form kecuali paham trade-off;
- test shutdown behavior.

---

## 38. Design Exercise: Evaluate These Dockerfiles

### 38.1 Dockerfile A

```dockerfile
CMD java -jar app.jar
```

Masalah:

- shell form;
- command mudah dioverride;
- PID 1 bisa shell;
- working directory tidak jelas;
- jar path relatif;
- tidak jelas user.

### 38.2 Dockerfile B

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lebih baik:

- exec form;
- Java sebagai proses utama;
- executable contract jelas.

Perlu dicek:

- user non-root?
- app.jar permission?
- memory config?
- graceful shutdown?

### 38.3 Dockerfile C

```dockerfile
ENTRYPOINT ["/entrypoint.sh"]
```

Script:

```sh
#!/bin/sh
java -jar /app/app.jar
```

Masalah:

- wrapper tidak `exec`;
- signal bisa tidak sampai ke JVM;
- exit code mungkin masih benar, tetapi signal handling buruk.

### 38.4 Dockerfile D

```dockerfile
ENTRYPOINT ["/entrypoint.sh"]
```

Script:

```sh
#!/bin/sh
set -eu
exec java ${JAVA_OPTS:-} -jar /app/app.jar "$@"
```

Lebih baik:

- fail fast;
- Java menggantikan shell;
- args diteruskan;
- dynamic JVM opts mungkin.

Perlu dicek:

- word splitting `JAVA_OPTS`;
- input trust;
- shell tersedia;
- script executable;
- user permission.

---

## 39. Production Review Checklist

Sebelum image Java dianggap production-ready, jawab:

### Process Contract

- [ ] Apa proses utama container?
- [ ] Apakah `ENTRYPOINT` memakai exec form?
- [ ] Jika ada wrapper, apakah memakai `exec`?
- [ ] Apakah exit code app diteruskan?
- [ ] Apakah app crash membuat container exit?

### Override Semantics

- [ ] Apa yang terjadi jika user memberi argumen setelah image?
- [ ] Apa yang dioverride oleh Compose `command`?
- [ ] Apa yang dioverride oleh Compose `entrypoint`?
- [ ] Apakah behavior production bergantung pada override tersembunyi?

### Signal and Shutdown

- [ ] Apakah SIGTERM sampai ke JVM?
- [ ] Apakah graceful shutdown berjalan?
- [ ] Apakah stop timeout cukup?
- [ ] Apakah shutdown log terlihat?
- [ ] Apakah ada child process yang perlu direap?

### Java Runtime

- [ ] Bagaimana JVM options diberikan?
- [ ] Apakah `JAVA_OPTS` benar-benar dipakai?
- [ ] Apakah `JAVA_TOOL_OPTIONS` dipakai secara intentional?
- [ ] Apakah memory/CPU config konsisten dengan Part 009?

### Security and Operability

- [ ] Apakah container berjalan non-root?
- [ ] Apakah shell diperlukan?
- [ ] Jika distroless, apa debug strategy?
- [ ] Apakah secret tidak masuk command line/log?
- [ ] Apakah startup validation tidak membocorkan secret?

---

## 40. Decision Tree Cepat

```text
Apakah ini image service production?
├── Ya
│   ├── Butuh wrapper?
│   │   ├── Tidak -> ENTRYPOINT exec form langsung ke java
│   │   └── Ya -> wrapper harus set -eu, validasi minimal, exec java
│   ├── Butuh default app args?
│   │   ├── Ya -> pakai CMD sebagai default args
│   │   └── Tidak -> CMD boleh kosong/tidak ada
│   ├── Spawn child process?
│   │   ├── Ya -> pertimbangkan --init/init:true
│   │   └── Tidak -> exec java biasanya cukup
│   └── Test docker stop dan cek graceful shutdown
└── Tidak, ini tool/base/debug image
    ├── Fleksibilitas lebih penting?
    │   ├── Ya -> CMD-only bisa masuk akal
    │   └── Tidak -> ENTRYPOINT + CMD
    └── Dokumentasikan override behavior
```

---

## 41. What Top Engineers Notice

Engineer yang matang tidak hanya bertanya:

```text
Dockerfile-nya jalan atau tidak?
```

Mereka bertanya:

```text
Apa kontrak prosesnya?
Apa yang terjadi saat stop?
Apa yang terjadi saat app crash?
Apa yang terjadi saat argumen dioverride?
Apa yang terjadi saat signal masuk?
Apa yang terjadi saat wrapper gagal?
Apa exit code yang dilihat runtime?
Apa behavior di Compose vs docker run?
Apakah image tetap debuggable?
```

Ini membedakan Docker usage yang sekadar “bisa jalan” dari Docker usage yang operationally sound.

---

## 42. Summary

Inti Part 010:

1. `ENTRYPOINT` menentukan executable utama image.
2. `CMD` menentukan default argument atau default command.
3. Kombinasi terbaik untuk service biasanya exec-form `ENTRYPOINT`.
4. Shell form tampak praktis tetapi bisa merusak signal handling.
5. PID 1 dalam container punya tanggung jawab khusus.
6. Java graceful shutdown hanya bekerja jika signal sampai ke JVM.
7. Wrapper script harus memakai `exec`.
8. `JAVA_OPTS` bukan magic; script harus membacanya.
9. `JAVA_TOOL_OPTIONS` bisa menjadi alternatif resmi, tetapi harus dikelola.
10. `--init`/`init: true` berguna untuk reaping dan signal forwarding, tetapi bukan pengganti entrypoint yang benar.
11. Compose `command` mengoverride `CMD`; Compose `entrypoint` mengoverride `ENTRYPOINT`.
12. Startup contract harus ditest, bukan diasumsikan.

---

## 43. Sources

Referensi utama yang relevan untuk bagian ini:

- Docker Docs — Dockerfile reference: `ENTRYPOINT`, `CMD`, exec form, shell form  
  https://docs.docker.com/reference/dockerfile/
- Docker Docs — Running containers and entrypoint behavior  
  https://docs.docker.com/engine/containers/run/
- Docker Docs — Overriding container defaults  
  https://docs.docker.com/get-started/docker-concepts/running-containers/overriding-container-defaults/
- Docker Docs — Compose services reference, `init`, `entrypoint`, `command`  
  https://docs.docker.com/reference/compose-file/services/
- Docker Blog — Choosing between `RUN`, `CMD`, and `ENTRYPOINT`  
  https://www.docker.com/blog/docker-best-practices-choosing-between-run-cmd-and-entrypoint/
- Spring Boot Docs — Graceful shutdown  
  https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html

---

## 44. Latihan Praktis

Buat empat image kecil:

1. `ENTRYPOINT java -jar app.jar` shell form.
2. `ENTRYPOINT ["java", "-jar", "app.jar"]` exec form.
3. wrapper script tanpa `exec`.
4. wrapper script dengan `exec`.

Untuk masing-masing:

- jalankan container;
- kirim `docker stop`;
- lihat apakah shutdown hook terpanggil;
- lihat berapa lama container berhenti;
- cek `docker inspect` untuk exit code;
- bandingkan log.

Tujuan latihan bukan membuat image bagus. Tujuannya melihat sendiri bahwa perbedaan satu kata, `exec`, bisa mengubah lifecycle behavior container.

---

## 45. Penutup

Part ini menyelesaikan fondasi proses startup container.

Setelah memahami `ENTRYPOINT`, `CMD`, override semantics, PID 1, signal handling, dan wrapper script, kita bisa masuk ke state runtime berikutnya: filesystem dan volume.

Di part berikutnya kita akan membahas:

```text
Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State
```

Kita akan memisahkan dengan jelas:

- immutable image filesystem;
- writable container layer;
- bind mount;
- named volume;
- tmpfs;
- ownership;
- UID/GID;
- permission;
- temporary files;
- logs;
- upload directory;
- backup/restore;
- dan failure mode stateful container.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-011.md">Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State ➡️</a>
</div>
