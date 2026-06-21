# learn-docker-mastery-for-java-engineers-part-005.md

# Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `005 / 031`  
> Fokus: Docker CLI sebagai alat inspeksi runtime, bukan sekadar kumpulan perintah  
> Target pembaca: Java software engineer yang ingin naik dari “bisa menjalankan container” menjadi “bisa membaca, mendiagnosis, dan mengendalikan fakta runtime container secara sistematis”

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun beberapa fondasi:

1. **Part 000** — Docker bukan mini VM, melainkan cara memaketkan dan menjalankan proses dengan boundary tertentu.
2. **Part 001** — container adalah proses yang dibatasi oleh namespace, cgroup, dan filesystem boundary.
3. **Part 002** — Docker punya arsitektur: CLI, daemon, Engine API, containerd, runc, registry.
4. **Part 003** — image adalah artifact berlapis dengan tag, digest, manifest, dan platform.
5. **Part 004** — container punya lifecycle: created, running, paused, exited, restarting, dead.

Part 005 ini adalah jembatan dari konsep ke praktik operasional.

Kita belum akan membahas Dockerfile, Compose, security hardening, atau Java runtime tuning secara mendalam. Yang kita bahas di sini adalah kemampuan membaca realitas runtime melalui Docker CLI.

Docker CLI bukan cuma alat untuk menjalankan command seperti:

```bash
 docker run nginx
 docker ps
 docker stop my-container
```

Docker CLI adalah **runtime inspection surface**.

Engineer yang kuat tidak hanya bertanya:

> “Command apa yang harus saya jalankan?”

Tetapi bertanya:

> “Fakta runtime apa yang harus saya buktikan?”

Itulah inti part ini.

---

## 1. Mental Model: Docker CLI sebagai Query Interface ke Runtime

Saat kamu mengetik:

```bash
 docker ps
```

kamu tidak sedang “melihat Docker” secara ajaib. Kamu sedang meminta Docker CLI menghubungi Docker daemon, lalu daemon mengembalikan state container yang dikelolanya.

Secara sederhana:

```text
Human
  |
  v
Docker CLI
  |
  v
Docker Engine API
  |
  v
Docker daemon
  |
  +--> container metadata
  +--> image metadata
  +--> network metadata
  +--> volume metadata
  +--> runtime state
```

Jadi Docker CLI adalah **client**. Ia bukan sumber kebenaran utama. Sumber kebenaran ada pada Docker Engine/daemon dan runtime state yang dikelolanya.

Implikasinya:

- Output CLI adalah representasi dari metadata/runtime state.
- CLI bisa diformat, difilter, dan diparse.
- CLI bisa memberi ringkasan, tetapi ringkasan bisa menyembunyikan detail penting.
- Untuk debugging serius, `docker inspect` sering lebih penting daripada `docker ps`.

Dokumentasi resmi Docker menyebut `docker inspect` sebagai command untuk mengembalikan informasi low-level tentang object Docker dan secara default merender hasil dalam JSON array. Artinya, `inspect` adalah pintu utama untuk membaca fakta lengkap, bukan opini atau ringkasan CLI.

---

## 2. Prinsip Utama: Jangan Debug dari Ingatan, Debug dari Fakta

Salah satu kesalahan paling umum saat debugging Docker adalah engineer mengandalkan apa yang “seharusnya” terjadi.

Contoh asumsi:

- “Dockerfile saya expose port 8080, berarti host bisa akses 8080.”
- “Container running, berarti aplikasinya sehat.”
- “Saya sudah set env di Compose, berarti env itu pasti masuk.”
- “Image yang saya build tadi pasti image yang sedang dijalankan.”
- “Log kosong berarti app tidak menghasilkan log.”
- “Container pakai network default, berarti service lain pasti bisa resolve namanya.”

Docker CLI harus digunakan untuk mengubah asumsi menjadi fakta.

Pola berpikirnya:

```text
Assumption
  -> find runtime evidence
  -> verify with CLI
  -> refine hypothesis
  -> test next boundary
```

Misalnya:

```text
Masalah: service tidak bisa diakses dari browser.

Jangan langsung ubah Dockerfile.

Buktikan dulu:
1. Container benar-benar running?
2. Aplikasi listening di port berapa di dalam container?
3. Port container dipublish ke host atau tidak?
4. App bind ke 0.0.0.0 atau hanya 127.0.0.1?
5. Host port bentrok atau salah?
6. Network path dari host ke container benar?
```

Docker CLI membantu membuktikan sebagian besar pertanyaan itu.

---

## 3. Command Taxonomy: Kelompokkan Berdasarkan Pertanyaan

Daripada menghafal command satu per satu, kelompokkan berdasarkan jenis pertanyaan.

| Pertanyaan | Command Utama |
|---|---|
| Container apa yang ada? | `docker ps`, `docker container ls` |
| Detail konfigurasi container apa? | `docker inspect` |
| Apa yang ditulis app ke stdout/stderr? | `docker logs` |
| Bisa masuk ke container? | `docker exec` |
| Resource usage saat ini? | `docker stats` |
| Event runtime apa yang terjadi? | `docker events` |
| Proses apa yang berjalan di container? | `docker top` |
| File apa yang berubah di writable layer? | `docker diff` |
| Port container dipublish ke mana? | `docker port`, `docker ps`, `docker inspect` |
| Copy file masuk/keluar container? | `docker cp` |
| Metadata image/container/network/volume? | `docker inspect` |
| Network object apa yang ada? | `docker network ls`, `docker network inspect` |
| Volume apa yang ada? | `docker volume ls`, `docker volume inspect` |
| Disk usage Docker? | `docker system df` |

CLI mastery dimulai ketika kamu bisa menghubungkan command dengan pertanyaan diagnostik.

---

## 4. Naming Convention: Legacy Command vs Object-Oriented Command

Docker CLI punya dua gaya command.

Gaya pendek/tradisional:

```bash
 docker ps
 docker inspect
 docker logs
 docker exec
 docker rm
```

Gaya object-oriented:

```bash
 docker container ls
 docker container inspect
 docker container logs
 docker container exec
 docker container rm
```

Keduanya banyak yang ekuivalen.

Contoh:

```bash
 docker ps
 docker container ls
```

```bash
 docker logs my-app
 docker container logs my-app
```

```bash
 docker inspect my-app
 docker container inspect my-app
```

Untuk penggunaan harian, gaya pendek umum dipakai. Untuk dokumentasi, automation, atau teaching, gaya object-oriented sering lebih eksplisit.

Dalam materi ini kita akan menggunakan keduanya, tetapi mental modelnya tetap sama:

```text
Docker CLI command = query/action terhadap object Docker
```

Object Docker umum:

- container
- image
- network
- volume
- context
- builder
- system

---

## 5. `docker ps`: Snapshot Container, Bukan Diagnosis Lengkap

Command paling umum:

```bash
 docker ps
```

Secara default, `docker ps` hanya menampilkan container yang sedang running.

Untuk melihat semua container, termasuk yang sudah exited:

```bash
 docker ps -a
```

Atau:

```bash
 docker container ls -a
```

Output umum:

```text
CONTAINER ID   IMAGE          COMMAND                  CREATED          STATUS          PORTS                    NAMES
7fd1a93c12ab   my-app:1.0     "java -jar app.jar"      2 minutes ago    Up 2 minutes    0.0.0.0:8080->8080/tcp   my-app
```

Kolom penting:

| Kolom | Makna |
|---|---|
| `CONTAINER ID` | ID pendek container |
| `IMAGE` | image reference yang digunakan saat create |
| `COMMAND` | command efektif yang dijalankan |
| `CREATED` | kapan container dibuat |
| `STATUS` | status ringkas container |
| `PORTS` | port publishing ringkas |
| `NAMES` | nama container |

### 5.1. Yang Bisa Kamu Simpulkan dari `docker ps`

Dari `docker ps`, kamu bisa tahu:

- container running atau tidak
- image apa yang dipakai
- command ringkas apa yang dijalankan
- port dipublish secara kasar atau tidak
- nama container
- apakah container restart terus
- apakah container punya health status ringkas

Contoh status:

```text
Up 10 minutes
Exited (1) 5 seconds ago
Restarting (1) 3 seconds ago
Up 2 minutes (healthy)
Up 2 minutes (unhealthy)
```

### 5.2. Yang Tidak Bisa Kamu Simpulkan dari `docker ps`

`docker ps` tidak cukup untuk membuktikan:

- env lengkap yang masuk ke container
- mount detail
- network detail
- restart policy detail
- healthcheck command detail
- memory limit
- CPU limit
- user efektif
- entrypoint dan cmd final secara lengkap
- apakah app bind ke `0.0.0.0` atau `127.0.0.1`
- kenapa container exit
- apakah image tag berubah setelah container dibuat

Jadi `docker ps` adalah **triage snapshot**, bukan full diagnosis.

---

## 6. Filtering `docker ps`: Mengurangi Noise

Saat environment besar, `docker ps -a` bisa terlalu berisik.

Gunakan filter.

### 6.1. Filter by Name

```bash
 docker ps --filter "name=my-app"
```

### 6.2. Filter by Status

```bash
 docker ps -a --filter "status=exited"
 docker ps -a --filter "status=running"
 docker ps -a --filter "status=restarting"
```

### 6.3. Filter by Label

Jika container diberi label:

```bash
 docker ps --filter "label=com.example.service=payment"
```

Label sangat berguna untuk environment yang dikelola automation.

### 6.4. Filter by Ancestor Image

```bash
 docker ps --filter "ancestor=my-app:1.0"
```

Ini menjawab:

> Container mana yang dibuat dari image tertentu?

Namun hati-hati: tag mutable. Untuk audit serius, gunakan digest/inspect.

---

## 7. Formatting Output: Dari Human View ke Machine View

Docker CLI mendukung output formatting menggunakan Go templates untuk beberapa command. Dokumentasi resmi Docker menjelaskan bahwa Docker mendukung Go template untuk memanipulasi format output command tertentu.

Contoh:

```bash
 docker ps --format "{{.ID}} {{.Image}} {{.Names}} {{.Status}}"
```

Output:

```text
7fd1a93c12ab my-app:1.0 my-app Up 2 minutes
```

Dengan table:

```bash
 docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}"
```

Output:

```text
CONTAINER ID   IMAGE        NAMES    STATUS
7fd1a93c12ab   my-app:1.0   my-app   Up 2 minutes
```

### 7.1. Format untuk Melihat Restart dan Port

```bash
 docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

### 7.2. Format untuk Script Ringan

```bash
 docker ps -q
```

Hanya container ID:

```text
7fd1a93c12ab
8ab992aa019c
```

Berguna untuk pipeline:

```bash
 docker inspect $(docker ps -q)
```

Namun hati-hati: command seperti itu bisa gagal jika tidak ada container running.

Lebih aman:

```bash
 ids=$(docker ps -q)
 if [ -n "$ids" ]; then
   docker inspect $ids
 fi
```

---

## 8. `docker inspect`: Source of Truth untuk Metadata Runtime

`docker inspect` adalah command yang harus kamu kuasai jika ingin serius debugging Docker.

```bash
 docker inspect my-app
```

Secara default, output berupa JSON array.

Untuk satu container, strukturnya kira-kira:

```json
[
  {
    "Id": "...",
    "Created": "...",
    "Path": "java",
    "Args": ["-jar", "app.jar"],
    "State": { ... },
    "Image": "sha256:...",
    "Name": "/my-app",
    "HostConfig": { ... },
    "Config": { ... },
    "NetworkSettings": { ... },
    "Mounts": [ ... ]
  }
]
```

Bagian penting:

| Bagian | Isi |
|---|---|
| `State` | status runtime, exit code, started/finished time, health |
| `Config` | config dari image/container: env, labels, cmd, entrypoint, user, exposed ports |
| `HostConfig` | config host side: port binding, restart policy, mounts, resource limits |
| `NetworkSettings` | IP, network, gateway, published ports |
| `Mounts` | bind mount, volume, tmpfs |
| `Image` | image ID/digest lokal yang dipakai container |
| `Path` dan `Args` | executable dan argument efektif |

### 8.1. Inspect State

```bash
 docker inspect my-app --format '{{json .State}}'
```

Lebih enak dengan `jq`:

```bash
 docker inspect my-app | jq '.[0].State'
```

Contoh output:

```json
{
  "Status": "exited",
  "Running": false,
  "Paused": false,
  "Restarting": false,
  "OOMKilled": false,
  "Dead": false,
  "Pid": 0,
  "ExitCode": 1,
  "Error": "",
  "StartedAt": "2026-06-21T01:10:00.000000000Z",
  "FinishedAt": "2026-06-21T01:10:05.000000000Z"
}
```

Pertanyaan yang dijawab:

- Container running?
- Exit code berapa?
- OOMKilled?
- Restarting?
- PID host berapa?
- Start/finish time kapan?
- Ada error dari runtime?

### 8.2. Inspect Exit Code

```bash
 docker inspect my-app --format '{{.State.ExitCode}}'
```

Interpretasi umum:

| Exit Code | Makna Umum |
|---:|---|
| 0 | process selesai sukses; mungkin app memang selesai, bukan long-running |
| 1 | generic application error |
| 125 | Docker daemon gagal menjalankan container |
| 126 | command ditemukan tapi tidak executable |
| 127 | command tidak ditemukan |
| 137 | biasanya SIGKILL; sering terkait OOMKilled atau kill paksa |
| 143 | SIGTERM; sering dari graceful stop |

Jangan hanya menghafal exit code. Selalu korelasikan dengan:

```bash
 docker logs my-app
 docker inspect my-app | jq '.[0].State'
 docker events --since ...
```

### 8.3. Inspect OOMKilled

```bash
 docker inspect my-app --format '{{.State.OOMKilled}}'
```

Jika `true`, container pernah dimatikan karena out-of-memory pada boundary container/host.

Untuk Java, ini sangat penting karena:

- Java heap bisa terlihat belum penuh.
- Native memory bisa membengkak.
- Thread stack bisa besar.
- Direct buffer bisa besar.
- Metaspace bisa besar.
- Container memory limit bisa lebih kecil dari asumsi JVM.

Kita akan bahas mendalam di Part 009.

### 8.4. Inspect Environment Variables

```bash
 docker inspect my-app | jq '.[0].Config.Env'
```

Tanpa `jq`:

```bash
 docker inspect my-app --format '{{range .Config.Env}}{{println .}}{{end}}'
```

Pertanyaan yang dijawab:

- Env benar-benar masuk atau tidak?
- Ada typo nama env?
- Value override dari mana?
- Profile Spring aktif atau tidak?
- Secret bocor sebagai env atau tidak?

Contoh:

```text
SPRING_PROFILES_ACTIVE=docker
SERVER_PORT=8080
JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75
```

### 8.5. Inspect Entrypoint dan Cmd

```bash
 docker inspect my-app | jq '.[0].Config.Entrypoint, .[0].Config.Cmd'
```

Contoh output:

```json
[
  "java"
]
[
  "-jar",
  "app.jar"
]
```

Atau:

```json
null
[
  "java",
  "-jar",
  "app.jar"
]
```

Pertanyaan yang dijawab:

- Command final yang dijalankan apa?
- Apakah pakai shell form atau exec form?
- Apakah wrapper script dipakai?
- Apakah arg override bekerja?

Namun command final juga bisa dilihat dari `Path` dan `Args`:

```bash
 docker inspect my-app | jq '.[0] | {Path, Args}'
```

### 8.6. Inspect User

```bash
 docker inspect my-app --format '{{.Config.User}}'
```

Jika output kosong, sering berarti default user dari image, biasanya root jika tidak diubah.

Untuk security, ini penting.

```text
Output kosong bukan selalu aman. Output kosong sering berarti kamu perlu cek image/base image.
```

### 8.7. Inspect Mounts

```bash
 docker inspect my-app | jq '.[0].Mounts'
```

Contoh:

```json
[
  {
    "Type": "volume",
    "Name": "app-data",
    "Source": "/var/lib/docker/volumes/app-data/_data",
    "Destination": "/data",
    "Driver": "local",
    "Mode": "z",
    "RW": true,
    "Propagation": ""
  }
]
```

Pertanyaan yang dijawab:

- Path container dimount dari mana?
- Bind mount atau named volume?
- Read-write atau read-only?
- File di image tertutup mount atau tidak?
- Volume mana yang menyimpan state?

### 8.8. Inspect Port Bindings

```bash
 docker inspect my-app | jq '.[0].HostConfig.PortBindings'
```

Contoh:

```json
{
  "8080/tcp": [
    {
      "HostIp": "0.0.0.0",
      "HostPort": "18080"
    }
  ]
}
```

Makna:

```text
Container port 8080/tcp dipublish ke host port 18080 pada semua interface host.
```

Ini berbeda dari `EXPOSE`.

`EXPOSE` hanya metadata image. Agar bisa diakses dari host, harus ada port publishing.

### 8.9. Inspect Network

```bash
 docker inspect my-app | jq '.[0].NetworkSettings.Networks'
```

Contoh:

```json
{
  "myproject_default": {
    "IPAddress": "172.20.0.5",
    "Gateway": "172.20.0.1",
    "Aliases": ["my-app", "app"]
  }
}
```

Pertanyaan yang dijawab:

- Container attach ke network mana?
- IP container apa?
- Alias DNS apa?
- Gateway apa?
- Apakah container masuk network yang sama dengan dependency?

### 8.10. Inspect Restart Policy

```bash
 docker inspect my-app | jq '.[0].HostConfig.RestartPolicy'
```

Contoh:

```json
{
  "Name": "unless-stopped",
  "MaximumRetryCount": 0
}
```

Pertanyaan yang dijawab:

- Kenapa container restart sendiri?
- Apakah restart policy memang aktif?
- Apakah restart terbatas atau tidak?

---

## 9. `docker logs`: Membaca stdout/stderr, Bukan File Log Internal

Command:

```bash
 docker logs my-app
```

Docker logs mengambil log dari stdout/stderr container, tergantung logging driver.

Dokumentasi Docker menjelaskan `docker container logs` sebagai command untuk mengambil log container. Ini berarti `docker logs` bukan membaca sembarang file di dalam container seperti `/var/log/app.log`.

Implikasi:

- Jika Java app hanya menulis log ke file, `docker logs` bisa kosong.
- Best practice containerized app: log ke stdout/stderr.
- File logging dalam container sering menyulitkan rotasi, collection, dan observability.

### 9.1. Follow Logs

```bash
 docker logs -f my-app
```

### 9.2. Tampilkan Timestamp

```bash
 docker logs -t my-app
```

### 9.3. Ambil Log Terakhir

```bash
 docker logs --tail 100 my-app
```

### 9.4. Filter Berdasarkan Waktu

```bash
 docker logs --since 10m my-app
 docker logs --since "2026-06-21T09:00:00" my-app
 docker logs --until "2026-06-21T10:00:00" my-app
```

### 9.5. Kombinasi yang Sering Dipakai

```bash
 docker logs -f --tail 200 -t my-app
```

### 9.6. Interpretasi Logs untuk Java

Untuk Java/Spring Boot service, log awal sering menjawab:

- profile aktif
- port server
- datasource URL
- migration status
- failed bean creation
- missing env/config
- connection refused ke dependency
- bind exception
- out-of-memory
- certificate/truststore error

Contoh pola:

```text
APPLICATION FAILED TO START
```

Biasanya bukan Docker problem dulu. Itu application startup problem. Namun Docker CLI membantu melihatnya.

### 9.7. Logs Kosong: Kemungkinan Penyebab

Jika:

```bash
 docker logs my-app
```

kosong, kemungkinan:

1. app tidak pernah start cukup jauh untuk log
2. app menulis log ke file, bukan stdout/stderr
3. container exit sebelum logging framework init
4. logging driver berbeda/bermasalah
5. command yang berjalan bukan app yang kamu kira
6. container yang kamu lihat bukan container yang benar
7. proses daemonized dan parent process selesai

Langkah diagnosis:

```bash
 docker ps -a --filter "name=my-app"
 docker inspect my-app | jq '.[0].State'
 docker inspect my-app | jq '.[0] | {Path, Args, Config: .Config.Cmd}'
 docker diff my-app
```

---

## 10. `docker exec`: Masuk ke Namespace Container yang Sedang Running

Command umum:

```bash
 docker exec -it my-app sh
```

Atau jika ada bash:

```bash
 docker exec -it my-app bash
```

`docker exec` menjalankan command baru di dalam container yang sedang running.

Penting:

```text
exec bukan cara masuk ke image.
exec masuk ke container instance yang sedang running.
```

Jika container sudah exited, `docker exec` tidak bisa dipakai.

### 10.1. Menjalankan Command Satu Kali

```bash
 docker exec my-app pwd
 docker exec my-app ls -la /app
 docker exec my-app env
 docker exec my-app id
```

### 10.2. Masuk Interaktif

```bash
 docker exec -it my-app sh
```

Flag:

| Flag | Makna |
|---|---|
| `-i` | interactive; keep stdin open |
| `-t` | allocate pseudo-TTY |

Biasanya dipakai bersama sebagai `-it`.

### 10.3. Cek User Efektif

```bash
 docker exec my-app id
```

Contoh:

```text
uid=10001(app) gid=10001(app) groups=10001(app)
```

Jika:

```text
uid=0(root) gid=0(root)
```

berarti process exec berjalan sebagai root, kecuali kamu override user.

### 10.4. Exec dengan User Tertentu

```bash
 docker exec -u root -it my-app sh
```

Berguna untuk debugging permission, tetapi jangan jadikan kebiasaan operasional.

### 10.5. Exec untuk Java Diagnostics

Jika image memiliki tool JDK:

```bash
 docker exec my-app jcmd
 docker exec my-app jcmd 1 VM.flags
 docker exec my-app jcmd 1 VM.system_properties
 docker exec my-app jcmd 1 Thread.print
 docker exec my-app jcmd 1 GC.heap_info
```

Namun banyak runtime image minimal tidak membawa `jcmd`, `jstack`, atau shell.

Itulah trade-off image minimal vs debuggability.

### 10.6. Anti-Pattern: Fix Manual di Dalam Container

Misalnya:

```bash
 docker exec -it my-app sh
 vi /app/config.yml
 service restart
```

Ini anti-pattern untuk production.

Kenapa?

- Perubahan tidak masuk image.
- Container disposable; perubahan hilang saat recreate.
- Tidak audit-friendly.
- Tidak reproducible.
- Mengubah runtime state tanpa deployment record.

`docker exec` sebaiknya dipakai untuk inspeksi dan emergency diagnosis, bukan konfigurasi manual permanen.

---

## 11. `docker cp`: Mengambil dan Memasukkan File

Command:

```bash
 docker cp my-app:/path/in/container ./local-path
 docker cp ./local-file my-app:/path/in/container
```

Contoh mengambil heap dump:

```bash
 docker cp my-app:/tmp/heap.hprof ./heap.hprof
```

Contoh mengambil generated report:

```bash
 docker cp my-app:/app/reports/error-report.json ./error-report.json
```

Contoh memasukkan file sementara untuk debugging:

```bash
 docker cp ./debug.conf my-app:/tmp/debug.conf
```

Hati-hati:

- Copy file ke container mengubah writable layer.
- Tidak persistent jika container dihapus.
- Bisa melanggar reproducibility.
- Untuk production, prefer mount/config/secret mechanism yang benar.

---

## 12. `docker stats`: Resource Snapshot Real-Time

Command:

```bash
 docker stats
```

Atau container tertentu:

```bash
 docker stats my-app
```

Dokumentasi Docker menjelaskan `docker stats` sebagai command yang mengembalikan live data stream resource usage untuk running containers.

Output umum:

```text
CONTAINER ID   NAME     CPU %   MEM USAGE / LIMIT     MEM %   NET I/O         BLOCK I/O       PIDS
7fd1a93c12ab   my-app   12.4%   512MiB / 1GiB         50.0%   1.2MB / 900kB   50MB / 10MB     48
```

Kolom penting:

| Kolom | Makna |
|---|---|
| `CPU %` | penggunaan CPU relatif terhadap alokasi host/quota |
| `MEM USAGE / LIMIT` | memory usage dan limit |
| `MEM %` | persentase memory terhadap limit |
| `NET I/O` | network bytes in/out |
| `BLOCK I/O` | disk/block IO |
| `PIDS` | jumlah proses/thread terkait |

### 12.1. One-Shot Stats

```bash
 docker stats --no-stream
```

### 12.2. Format Stats

```bash
 docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}"
```

### 12.3. Java Interpretation

Untuk Java service, `docker stats` membantu menjawab:

- Apakah memory mendekati limit?
- Apakah CPU stuck tinggi?
- Apakah jumlah thread/PID naik terus?
- Apakah container dibatasi 512MiB tapi app butuh lebih?
- Apakah ada indikasi leak?

Namun `docker stats` tidak cukup untuk root cause Java memory.

Kamu masih butuh:

```bash
 jcmd
 heap dump
 thread dump
 GC log
 application metrics
```

Tetapi `docker stats` memberi boundary evidence.

### 12.4. Exit 137 dan Stats

Jika container mati dengan exit 137, lihat:

```bash
 docker inspect my-app | jq '.[0].State'
```

Jika `OOMKilled=true`, stats sebelumnya mungkin menunjukkan memory mendekati limit. Namun setelah container mati, `docker stats` tidak lagi berguna untuk historical data. Karena itu production butuh metrics collector, bukan hanya CLI.

---

## 13. `docker events`: Timeline Runtime

Command:

```bash
 docker events
```

Docker events menampilkan event stream dari daemon.

Contoh event:

```text
2026-06-21T09:10:00 container create my-app
2026-06-21T09:10:01 container start my-app
2026-06-21T09:10:05 container die my-app
2026-06-21T09:10:06 container restart my-app
```

### 13.1. Filter Event Berdasarkan Container

```bash
 docker events --filter container=my-app
```

### 13.2. Filter Berdasarkan Type

```bash
 docker events --filter type=container
```

### 13.3. Berdasarkan Waktu

```bash
 docker events --since 30m
```

### 13.4. Kapan `docker events` Berguna?

Gunakan saat:

- container restart terus
- container tiba-tiba mati
- ada automation yang recreate container
- healthcheck berubah
- network disconnect/connect
- image pull terjadi tidak terduga

`docker ps` hanya memberi state saat ini. `docker events` memberi timeline.

Mental model:

```text
ps      = current snapshot
logs    = process output
inspect = object metadata and state
stats   = resource stream
 events = daemon timeline
```

---

## 14. `docker top`: Melihat Process di Container

Command:

```bash
 docker top my-app
```

Output contoh:

```text
UID      PID      PPID     C     STIME    TTY    TIME        CMD
10001    12345    12320    0     09:00    ?      00:00:12    java -jar app.jar
```

`docker top` berguna untuk:

- memastikan process utama benar
- melihat apakah shell wrapper masih jadi parent
- melihat zombie/child process secara kasar
- melihat command efektif
- melihat UID process

### 14.1. Shell Wrapper Problem

Jika output:

```text
root  12345  ...  /bin/sh /app/start.sh
root  12360  ...  java -jar app.jar
```

Mungkin signal handling perlu dicek.

Idealnya wrapper script menggunakan `exec`:

```sh
exec java -jar app.jar
```

Agar Java process menggantikan shell dan menerima signal dengan benar.

Kita bahas detail di Part 010.

---

## 15. `docker diff`: Melihat Perubahan Writable Layer

Command:

```bash
 docker diff my-app
```

Output contoh:

```text
C /tmp
A /tmp/app-cache
C /app
A /app/generated-report.json
C /var
C /var/log
A /var/log/app.log
```

Prefix:

| Prefix | Makna |
|---|---|
| `A` | Added |
| `C` | Changed |
| `D` | Deleted |

`docker diff` membantu menjawab:

- App menulis file ke mana?
- Apakah app menulis log ke file?
- Apakah app menghasilkan cache di filesystem container?
- Apakah config berubah manual?
- Apakah ada mutable state tersembunyi?

Untuk Java:

- `/tmp` sering berubah.
- app mungkin menulis uploaded file ke `/app/uploads`.
- logging framework mungkin menulis ke `/logs`.
- embedded DB mungkin menulis ke working directory.
- heap dump bisa muncul di path tertentu.

Jika state penting hanya ada di writable layer container, itu berbahaya. Saat container dihapus, state hilang.

---

## 16. `docker port`: Melihat Published Port

Command:

```bash
 docker port my-app
```

Output:

```text
8080/tcp -> 0.0.0.0:18080
```

Atau spesifik:

```bash
 docker port my-app 8080
```

Output:

```text
0.0.0.0:18080
```

Ini menjawab:

> Container port 8080 dipublish ke host mana?

Namun ada dua hal penting:

1. Port published tidak berarti app listening di port itu.
2. App bisa listening hanya di `127.0.0.1` dalam container sehingga tidak reachable dari host via published port.

Untuk membuktikan listening port di dalam container:

```bash
 docker exec my-app sh -c 'ss -lntp || netstat -lntp'
```

Namun image minimal mungkin tidak punya `ss` atau `netstat`.

Alternatif:

```bash
 docker exec my-app sh -c 'cat /proc/net/tcp'
```

Lebih sulit dibaca, tetapi tersedia jika `/proc` ada.

---

## 17. `docker network` Commands: Membaca Connectivity Boundary

List network:

```bash
 docker network ls
```

Inspect network:

```bash
 docker network inspect bridge
 docker network inspect myproject_default
```

Output inspect network berisi:

- driver
- subnet
- gateway
- attached containers
- aliases
- options

Contoh:

```bash
 docker network inspect myproject_default | jq '.[0].Containers'
```

Ini menjawab:

- Container apa saja di network yang sama?
- IP masing-masing container apa?
- Alias apa yang tersedia?
- Apakah service dependency berada di network yang sama?

### 17.1. Debug Service Name

Jika app `payment-service` tidak bisa resolve `postgres`, cek:

```bash
 docker network inspect myproject_default | jq '.[0].Containers'
```

Pastikan container postgres memang attach ke network yang sama.

### 17.2. Jangan Gunakan Container IP sebagai Kontrak

IP container bisa berubah saat recreate.

Gunakan:

- service name di Compose
- network alias
- DNS bawaan user-defined bridge network

---

## 18. `docker volume` Commands: Membaca Persistent State

List volume:

```bash
 docker volume ls
```

Inspect volume:

```bash
 docker volume inspect app-data
```

Output:

```json
[
  {
    "CreatedAt": "2026-06-21T09:00:00Z",
    "Driver": "local",
    "Labels": null,
    "Mountpoint": "/var/lib/docker/volumes/app-data/_data",
    "Name": "app-data",
    "Options": null,
    "Scope": "local"
  }
]
```

Pertanyaan yang dijawab:

- Volume dibuat kapan?
- Volume berada di host path mana?
- Driver apa?
- Label apa?
- Apakah volume orphan/stale?

Volume stale sering menyebabkan bug lokal:

- schema database lama
- migration tidak jalan ulang
- data test lama
- config lama
- permission lama

Command reset berisiko:

```bash
 docker volume rm app-data
```

Atau dengan Compose:

```bash
 docker compose down -v
```

Hati-hati: `-v` menghapus volume yang terkait, sehingga data hilang.

---

## 19. `docker system df`: Melihat Disk Usage Docker

Command:

```bash
 docker system df
```

Output contoh:

```text
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          20        8         12GB      7GB
Containers      10        3         1GB       800MB
Local Volumes   12        5         20GB      10GB
Build Cache     50        0         15GB      15GB
```

Untuk detail:

```bash
 docker system df -v
```

Ini berguna saat:

- build gagal karena disk penuh
- pull image gagal
- container tidak bisa write file
- Docker Desktop storage membengkak
- CI runner disk cepat habis

Pembersihan:

```bash
 docker system prune
 docker image prune
 docker container prune
 docker volume prune
 docker builder prune
```

Hati-hati dengan `docker volume prune`; itu bisa menghapus data persistent yang tidak terpakai container saat ini.

---

## 20. Debugging Scenario 1: Container Running tapi App Tidak Bisa Diakses dari Host

Masalah:

```text
Browser membuka http://localhost:8080 tetapi connection refused.
Container terlihat running.
```

Jangan langsung ubah Dockerfile.

### Step 1 — Cek Container Running

```bash
 docker ps --filter "name=my-app"
```

Lihat:

- status running?
- port dipublish?
- nama benar?

### Step 2 — Cek Port Publishing

```bash
 docker port my-app
```

Atau:

```bash
 docker inspect my-app | jq '.[0].HostConfig.PortBindings'
```

Kemungkinan:

```json
null
```

Berarti port tidak dipublish ke host.

Solusi saat run:

```bash
 docker run -p 8080:8080 my-app
```

Jika output:

```text
8080/tcp -> 0.0.0.0:18080
```

Maka akses host-nya:

```text
http://localhost:18080
```

bukan `8080`.

### Step 3 — Cek App Listening di Dalam Container

```bash
 docker exec my-app sh -c 'ss -lntp || netstat -lntp'
```

Jika app listening di:

```text
127.0.0.1:8080
```

maka masalahnya app bind ke localhost dalam container. Dari host, port publishing mengarah ke network interface container, bukan loopback internal app.

Untuk server app dalam container, biasanya bind ke:

```text
0.0.0.0
```

Untuk Spring Boot:

```properties
server.address=0.0.0.0
server.port=8080
```

Biasanya default Spring Boot sudah bind ke semua interface jika tidak dikunci ke localhost, tetapi config custom bisa mengubahnya.

### Step 4 — Cek Logs

```bash
 docker logs --tail 200 -t my-app
```

Cari:

- port aplikasi
- bind address
- startup failure
- profile aktif
- exception

### Step 5 — Cek Config Env

```bash
 docker inspect my-app | jq '.[0].Config.Env'
```

Cari:

```text
SERVER_PORT
SERVER_ADDRESS
SPRING_PROFILES_ACTIVE
```

### Diagnosis Pattern

```text
Container running
  != app listening correctly
  != port published correctly
  != host using correct port
  != app healthy
```

---

## 21. Debugging Scenario 2: Container Langsung Exit

Masalah:

```text
docker run my-app
```

container langsung selesai.

### Step 1 — Lihat Semua Container

```bash
 docker ps -a --filter "ancestor=my-app"
```

Atau berdasarkan nama:

```bash
 docker ps -a --filter "name=my-app"
```

### Step 2 — Lihat Exit Code

```bash
 docker inspect my-app | jq '.[0].State'
```

Atau:

```bash
 docker inspect my-app --format 'ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}}'
```

### Step 3 — Lihat Logs

```bash
 docker logs my-app
```

### Step 4 — Lihat Command Efektif

```bash
 docker inspect my-app | jq '.[0] | {Path, Args, Entrypoint: .Config.Entrypoint, Cmd: .Config.Cmd}'
```

### Kemungkinan Penyebab

| Gejala | Kemungkinan |
|---|---|
| Exit 0 | command memang selesai; bukan long-running service |
| Exit 1 | app startup error |
| Exit 126 | file command tidak executable |
| Exit 127 | command tidak ditemukan |
| Exit 137 | killed/OOM |
| Log kosong | command salah, app tidak log stdout, exit terlalu awal |

### Contoh: CMD Salah

Dockerfile:

```dockerfile
CMD ["java -jar app.jar"]
```

Ini salah untuk exec form karena Docker mencari executable bernama literal `java -jar app.jar`.

Yang benar:

```dockerfile
CMD ["java", "-jar", "app.jar"]
```

Atau shell form:

```dockerfile
CMD java -jar app.jar
```

Tetapi shell form punya implikasi signal handling yang akan dibahas di Part 010.

---

## 22. Debugging Scenario 3: Container Restart Terus

Masalah:

```text
STATUS: Restarting (1) 5 seconds ago
```

### Step 1 — Lihat Status

```bash
 docker ps -a --filter "name=my-app"
```

### Step 2 — Inspect Restart Policy

```bash
 docker inspect my-app | jq '.[0].HostConfig.RestartPolicy'
```

### Step 3 — Inspect State

```bash
 docker inspect my-app | jq '.[0].State'
```

### Step 4 — Logs Previous Attempts

```bash
 docker logs --tail 300 -t my-app
```

Jika restart cepat, logs mungkin berulang.

### Step 5 — Events Timeline

```bash
 docker events --filter container=my-app --since 10m
```

### Diagnosis Pattern

```text
Restarting bukan root cause.
Restarting adalah restart policy bereaksi terhadap process exit.
Root cause biasanya ada di logs + exit code + startup dependency.
```

Kemungkinan penyebab Java app restart:

- missing env
- DB unavailable
- migration failed
- port already in use di dalam container jarang, tapi bisa jika app spawn child
- config file missing
- permission denied writing temp/log/upload directory
- invalid JVM option
- OOMKilled during startup

---

## 23. Debugging Scenario 4: Env Tidak Masuk atau Salah

Masalah:

```text
App memakai default config, padahal env sudah diset.
```

### Step 1 — Inspect Env Runtime

```bash
 docker inspect my-app | jq '.[0].Config.Env'
```

Cari env yang diharapkan.

### Step 2 — Exec Env di Dalam Container

```bash
 docker exec my-app env | sort
```

Perbedaan antara `inspect` dan `exec env` biasanya kecil, tetapi `exec env` menunjukkan env dari process command yang dijalankan dalam container saat itu.

### Step 3 — Cek Typo dan Binding Framework

Spring Boot relaxed binding bisa membantu, tetapi tetap ada aturan.

Contoh umum:

```text
SPRING_DATASOURCE_URL
SPRING_DATASOURCE_USERNAME
SPRING_DATASOURCE_PASSWORD
```

Bukan:

```text
SPRING_DATASOURCE_URI
SPRING_DB_URL
```

### Step 4 — Cek Override Precedence

Jika menggunakan Compose, env bisa datang dari:

- shell environment
- `.env`
- `environment`
- `env_file`
- image `ENV`
- application config default

Part Compose akan membahas ini lebih dalam.

### Core Lesson

```text
Jangan bertanya “saya sudah set env di mana?”
Tanya “env apa yang benar-benar diterima container?”
```

---

## 24. Debugging Scenario 5: Permission Denied

Masalah:

```text
java.nio.file.AccessDeniedException: /app/data
```

atau:

```text
Permission denied
```

### Step 1 — Cek User Container

```bash
 docker inspect my-app --format '{{.Config.User}}'
 docker exec my-app id
```

### Step 2 — Cek Mounts

```bash
 docker inspect my-app | jq '.[0].Mounts'
```

### Step 3 — Cek Ownership Path

```bash
 docker exec my-app ls -ld /app /app/data /tmp
```

### Step 4 — Cek Writable Layer Changes

```bash
 docker diff my-app
```

### Diagnosis Pattern

Permission denied biasanya muncul dari mismatch antara:

- user yang menjalankan process
- owner file/directory di image
- owner bind mount dari host
- named volume initial ownership
- read-only filesystem
- security profile host

Untuk Java app, path rawan:

- `/tmp`
- `/app/logs`
- `/app/uploads`
- `/app/data`
- heap dump path
- JFR output path
- truststore/keystore file

---

## 25. Debugging Scenario 6: Image yang Jalan Bukan yang Kamu Kira

Masalah:

```text
Saya sudah rebuild image, tapi container masih pakai behavior lama.
```

Kemungkinan:

- container lama belum recreate
- tag sama tapi image ID berbeda
- Compose tidak rebuild
- cache build masih dipakai
- registry tag mutable
- host menarik image lama

### Step 1 — Lihat Container Image Reference

```bash
 docker ps --filter "name=my-app" --format "table {{.Names}}\t{{.Image}}\t{{.ID}}"
```

### Step 2 — Inspect Image ID Container

```bash
 docker inspect my-app | jq '.[0].Image'
```

Ini adalah image ID lokal yang dipakai saat container dibuat.

### Step 3 — Bandingkan dengan Image Tag Saat Ini

```bash
 docker image inspect my-app:latest | jq '.[0].Id'
```

Jika berbeda, container lama masih menggunakan image lama.

### Step 4 — Recreate Container

Container tidak otomatis berubah hanya karena tag image di-rebuild.

Kamu perlu recreate:

```bash
 docker rm -f my-app
 docker run ... my-app:latest
```

Dengan Compose:

```bash
 docker compose up -d --build --force-recreate
```

### Core Lesson

```text
Image tag bisa berubah.
Container yang sudah dibuat tetap menunjuk image ID tertentu.
Rebuild image tidak otomatis mutate container lama.
```

---

## 26. Debugging Scenario 7: No Space Left on Device

Masalah:

```text
no space left on device
```

Bisa terjadi saat:

- build image
- pull image
- container write file
- database dalam volume menulis data
- logging terlalu besar
- Docker Desktop disk image penuh
- CI runner storage habis

### Step 1 — Docker Disk Usage

```bash
 docker system df
 docker system df -v
```

### Step 2 — Cek Container Writable Layer

```bash
 docker ps -a --size
```

### Step 3 — Cek Volume

```bash
 docker volume ls
 docker volume inspect <volume>
```

### Step 4 — Bersihkan dengan Hati-Hati

```bash
 docker container prune
 docker image prune
 docker builder prune
```

Lebih agresif:

```bash
 docker system prune -a
```

Sangat hati-hati:

```bash
 docker volume prune
```

`volume prune` dapat menghapus data persistent yang tidak sedang dipakai container.

### Core Lesson

Docker menyimpan banyak state:

- image layers
- stopped containers
- volumes
- build cache
- logs

Disk penuh bukan selalu masalah aplikasi.

---

## 27. Debugging Scenario 8: Container Bisa Akses Internet tapi Tidak Bisa Akses Service Lain

Masalah:

```text
payment-service tidak bisa connect ke postgres.
```

### Step 1 — Cek Network Attachment

```bash
 docker inspect payment-service | jq '.[0].NetworkSettings.Networks'
 docker inspect postgres | jq '.[0].NetworkSettings.Networks'
```

Apakah keduanya punya network yang sama?

### Step 2 — Inspect Network

```bash
 docker network inspect myproject_default | jq '.[0].Containers'
```

### Step 3 — Cek Env Connection String

```bash
 docker inspect payment-service | jq '.[0].Config.Env'
```

Kesalahan umum:

```text
jdbc:postgresql://localhost:5432/app
```

Di dalam container, `localhost` berarti container itu sendiri, bukan container postgres.

Dalam Compose, biasanya:

```text
jdbc:postgresql://postgres:5432/app
```

Jika service name postgres.

### Step 4 — Test dari Dalam Container

Jika ada tool:

```bash
 docker exec payment-service sh -c 'getent hosts postgres || nslookup postgres'
 docker exec payment-service sh -c 'nc -vz postgres 5432'
```

Image minimal mungkin tidak punya `getent`, `nslookup`, atau `nc`.

Gunakan debug container di network sama:

```bash
 docker run --rm -it --network myproject_default nicolaka/netshoot
```

Lalu test DNS/network dari sana.

### Core Lesson

```text
localhost di container bukan host dan bukan container lain.
Service-to-service communication membutuhkan shared network dan nama yang benar.
```

---

## 28. `docker inspect --format`: Query Cepat Tanpa `jq`

Walaupun `jq` sangat membantu, tidak semua environment punya `jq`.

Docker mendukung Go template formatting.

### 28.1. Ambil IP Container

```bash
 docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' my-app
```

### 28.2. Ambil Exit Code

```bash
 docker inspect -f '{{.State.ExitCode}}' my-app
```

### 28.3. Ambil OOMKilled

```bash
 docker inspect -f '{{.State.OOMKilled}}' my-app
```

### 28.4. Ambil Env

```bash
 docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' my-app
```

### 28.5. Ambil Mount Destination

```bash
 docker inspect -f '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}' my-app
```

### 28.6. Ambil Restart Policy

```bash
 docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' my-app
```

### 28.7. Kapan Pakai Format vs `jq`?

| Tool | Cocok untuk |
|---|---|
| `--format` | query singkat, script ringan, environment minimal |
| `jq` | eksplorasi JSON kompleks, filtering, transformasi data |

Untuk engineer senior, keduanya berguna.

---

## 29. Compose CLI Teaser: `docker compose ps/logs/exec`

Walaupun Compose dibahas detail mulai Part 013, penting tahu mapping dasarnya.

Docker command tunggal:

```bash
 docker ps
 docker logs my-app
 docker exec -it my-app sh
```

Compose equivalent:

```bash
 docker compose ps
 docker compose logs app
 docker compose exec app sh
```

Perbedaan mental model:

```text
docker container command -> object container spesifik
compose command          -> service dalam project Compose
```

`docker compose logs app` membaca logs dari service `app`.

Jika service punya beberapa replica/container, Compose bisa menggabungkan logs.

Compose juga memberi project-level abstraction:

- services
- networks
- volumes
- project name
- profiles

Tetapi semua tetap berujung pada object Docker biasa yang bisa diinspect.

Contoh:

```bash
 docker compose ps
 docker inspect <actual-container-name>
```

---

## 30. Membangun Personal Debugging Checklist

Saat menghadapi masalah container, gunakan checklist berlapis.

### 30.1. Layer 1 — Object Identity

Pertanyaan:

- Container mana yang sedang saya debug?
- Nama/ID benar?
- Image apa yang dipakai?
- Container lama atau baru?

Command:

```bash
 docker ps -a
 docker inspect my-app | jq '.[0] | {Id, Name, Image, Created}'
```

### 30.2. Layer 2 — Runtime State

Pertanyaan:

- Running/exited/restarting?
- Exit code?
- OOMKilled?
- StartedAt/FinishedAt?

Command:

```bash
 docker inspect my-app | jq '.[0].State'
```

### 30.3. Layer 3 — Process Output

Pertanyaan:

- App mengatakan apa?
- Error startup?
- Config active?
- Port active?

Command:

```bash
 docker logs --tail 300 -t my-app
```

### 30.4. Layer 4 — Effective Command

Pertanyaan:

- Process apa yang benar-benar dijalankan?
- Entrypoint/Cmd benar?
- Shell wrapper?

Command:

```bash
 docker inspect my-app | jq '.[0] | {Path, Args, Entrypoint: .Config.Entrypoint, Cmd: .Config.Cmd}'
 docker top my-app
```

### 30.5. Layer 5 — Config

Pertanyaan:

- Env benar?
- Labels benar?
- User benar?

Command:

```bash
 docker inspect my-app | jq '.[0].Config.Env'
 docker inspect my-app --format '{{.Config.User}}'
```

### 30.6. Layer 6 — Network

Pertanyaan:

- Port dipublish?
- Network sama?
- DNS alias benar?
- App bind address benar?

Command:

```bash
 docker port my-app
 docker inspect my-app | jq '.[0].NetworkSettings.Networks'
 docker network inspect <network>
```

### 30.7. Layer 7 — Filesystem/Mount

Pertanyaan:

- Mount benar?
- Permission benar?
- App menulis state ke mana?

Command:

```bash
 docker inspect my-app | jq '.[0].Mounts'
 docker diff my-app
 docker exec my-app ls -la /path
```

### 30.8. Layer 8 — Resources

Pertanyaan:

- Memory/CPU limit?
- Usage tinggi?
- OOM?
- PID/thread count naik?

Command:

```bash
 docker stats my-app
 docker inspect my-app | jq '.[0].HostConfig | {Memory, NanoCpus, CpuQuota, CpuPeriod}'
```

### 30.9. Layer 9 — Timeline

Pertanyaan:

- Apa yang terjadi sebelum container mati/restart?
- Ada automation recreate?
- Healthcheck fail?

Command:

```bash
 docker events --filter container=my-app --since 30m
```

---

## 31. CLI Habits yang Membedakan Engineer Senior

### Habit 1 — Selalu Bedakan Snapshot, Timeline, dan Output Process

```text
Snapshot : docker ps, docker inspect
Timeline : docker events
Output   : docker logs
Resource : docker stats
Process  : docker top, docker exec
```

Jangan pakai satu command untuk menjawab semua hal.

### Habit 2 — Jangan Percaya Tag sebagai Identitas Final

Saat perlu memastikan image:

```bash
 docker inspect my-app | jq '.[0].Image'
 docker image inspect my-app:tag | jq '.[0].Id'
```

### Habit 3 — Inspect Sebelum Exec

`exec` menggoda karena terasa seperti “masuk server”. Tetapi inspect sering memberi jawaban tanpa mengubah container.

Urutan aman:

```text
ps -> inspect -> logs -> stats/events -> exec if needed
```

### Habit 4 — Treat Container as Disposable

Jangan memperbaiki container manual lalu merasa masalah selesai.

Solusi benar biasanya ada di:

- Dockerfile
- image build
- runtime config
- Compose file
- deployment descriptor
- host configuration
- application code/config

### Habit 5 — Capture Evidence Sebelum Restart

Sebelum restart container bermasalah:

```bash
 docker inspect my-app > inspect-my-app.json
 docker logs -t my-app > logs-my-app.txt
 docker events --since 30m > events.txt
```

Jika langsung restart, beberapa bukti bisa hilang atau tertimpa.

### Habit 6 — Gunakan Nama yang Stabil

Jangan terlalu bergantung pada container ID pendek dalam dokumentasi tim.

Gunakan:

```bash
 --name my-app
```

atau Compose service name.

### Habit 7 — Buat Output yang Bisa Dibaca Mesin

Untuk automation ringan:

```bash
 docker ps --format '{{.Names}} {{.Status}}'
```

Untuk struktur kompleks:

```bash
 docker inspect my-app | jq '.[0].State'
```

---

## 32. Command Reference Ringkas untuk Daily Use

### Container List

```bash
 docker ps
 docker ps -a
 docker ps --filter "name=my-app"
 docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

### Inspect

```bash
 docker inspect my-app
 docker inspect my-app | jq '.[0].State'
 docker inspect my-app | jq '.[0].Config.Env'
 docker inspect my-app | jq '.[0].Mounts'
 docker inspect my-app | jq '.[0].NetworkSettings.Networks'
 docker inspect my-app | jq '.[0].HostConfig.PortBindings'
```

### Logs

```bash
 docker logs my-app
 docker logs -f my-app
 docker logs --tail 200 -t my-app
 docker logs --since 10m my-app
```

### Exec

```bash
 docker exec my-app env
 docker exec my-app id
 docker exec -it my-app sh
 docker exec -u root -it my-app sh
```

### Stats and Events

```bash
 docker stats
 docker stats my-app
 docker stats --no-stream my-app
 docker events --filter container=my-app --since 30m
```

### Process and Filesystem

```bash
 docker top my-app
 docker diff my-app
 docker cp my-app:/tmp/file ./file
```

### Network and Port

```bash
 docker port my-app
 docker network ls
 docker network inspect <network>
```

### Volume and Disk

```bash
 docker volume ls
 docker volume inspect <volume>
 docker system df
 docker system df -v
```

---

## 33. Praktik Latihan: Mini Lab CLI Fluency

Gunakan image sederhana untuk latihan.

### 33.1. Jalankan Nginx

```bash
 docker run -d --name cli-lab-nginx -p 18080:80 nginx:stable
```

### 33.2. Triage Snapshot

```bash
 docker ps --filter "name=cli-lab-nginx"
 docker port cli-lab-nginx
```

Akses:

```text
http://localhost:18080
```

### 33.3. Inspect Runtime

```bash
 docker inspect cli-lab-nginx | jq '.[0].State'
 docker inspect cli-lab-nginx | jq '.[0].HostConfig.PortBindings'
 docker inspect cli-lab-nginx | jq '.[0].NetworkSettings.Networks'
```

### 33.4. Logs

```bash
 docker logs --tail 50 -t cli-lab-nginx
```

Lakukan request dari browser/curl, lalu lihat logs lagi.

### 33.5. Exec

```bash
 docker exec -it cli-lab-nginx sh
```

Di dalam container:

```sh
 id
 pwd
 ls -la
```

Keluar:

```sh
 exit
```

### 33.6. Diff

```bash
 docker diff cli-lab-nginx
```

### 33.7. Stats

```bash
 docker stats --no-stream cli-lab-nginx
```

### 33.8. Cleanup

```bash
 docker rm -f cli-lab-nginx
```

---

## 34. Latihan Java-Specific: Inspect Spring Boot Container

Misalkan kamu punya image:

```bash
 my-spring-app:dev
```

Jalankan:

```bash
 docker run -d \
   --name spring-cli-lab \
   -p 18081:8080 \
   -e SPRING_PROFILES_ACTIVE=docker \
   -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75" \
   my-spring-app:dev
```

Lakukan inspeksi:

```bash
 docker ps --filter "name=spring-cli-lab"
 docker logs --tail 200 -t spring-cli-lab
 docker inspect spring-cli-lab | jq '.[0].Config.Env'
 docker inspect spring-cli-lab | jq '.[0] | {Path, Args, Entrypoint: .Config.Entrypoint, Cmd: .Config.Cmd}'
 docker inspect spring-cli-lab | jq '.[0].HostConfig.PortBindings'
 docker stats --no-stream spring-cli-lab
```

Pertanyaan latihan:

1. Apakah container running?
2. Port host apa yang harus diakses?
3. Profile Spring apa yang aktif?
4. JVM option apa yang masuk?
5. Apakah app log ke stdout?
6. Apakah command efektif sesuai ekspektasi?
7. Apakah memory usage masuk akal?
8. Jika app tidak bisa diakses, boundary mana yang gagal?

---

## 35. Common Pitfalls dan Koreksinya

### Pitfall 1 — Menganggap `docker ps` Cukup

Salah:

```text
Container Up, berarti app sehat.
```

Benar:

```text
Container Up hanya berarti process utama masih berjalan.
Health, readiness, port listening, dependency connectivity, dan correctness harus dibuktikan terpisah.
```

### Pitfall 2 — Menganggap `EXPOSE` Sama dengan Publish Port

Salah:

```dockerfile
EXPOSE 8080
```

lalu berharap host bisa akses `localhost:8080`.

Benar:

```bash
 docker run -p 8080:8080 my-app
```

`EXPOSE` adalah metadata. `-p`/`--publish` membuat port binding.

### Pitfall 3 — Debugging Container Lama

Salah:

```text
Saya rebuild image, tapi tidak recreate container.
```

Benar:

```bash
 docker inspect container | jq '.[0].Image'
 docker image inspect image:tag | jq '.[0].Id'
```

Bandingkan.

### Pitfall 4 — Masuk Container dan Mengubah Manual

Salah:

```bash
 docker exec -it prod-app sh
 vi config.yml
```

Benar:

- ubah config source
- rebuild/redeploy bila image berubah
- inject runtime config dengan mekanisme yang jelas
- audit perubahan

### Pitfall 5 — Menggunakan `localhost` untuk Service Lain

Salah di dalam container:

```text
jdbc:postgresql://localhost:5432/app
```

Benar dalam Compose/network Docker:

```text
jdbc:postgresql://postgres:5432/app
```

Jika service name `postgres`.

### Pitfall 6 — Mengabaikan Exit Code

Salah:

```text
Container mati, coba run ulang.
```

Benar:

```bash
 docker inspect my-app | jq '.[0].State'
 docker logs my-app
```

### Pitfall 7 — Mengira Logs Selalu Lengkap

`docker logs` hanya sebaik logging driver dan stdout/stderr app.

Jika app menulis ke file internal, `docker logs` bisa tidak menunjukkan yang kamu cari.

---

## 36. Docker CLI dan Production Reality

Docker CLI sangat kuat untuk single-host/local diagnosis. Namun untuk production skala besar, CLI bukan pengganti observability platform.

CLI cocok untuk:

- local debugging
- CI runner debugging
- single VM troubleshooting
- incident triage awal
- reproduksi bug
- forensic snapshot sederhana

CLI tidak cukup untuk:

- historical metrics jangka panjang
- distributed tracing
- log aggregation multi-host
- alerting
- audit penuh
- cluster-level scheduling insight
- compliance-grade evidence retention

Tetapi engineer yang tidak bisa membaca Docker CLI biasanya akan lemah juga saat membaca abstraction di atasnya seperti Kubernetes.

Kubernetes, ECS, Nomad, dan platform lain tetap menjalankan container. Jika mental model container runtime lemah, abstraction yang lebih tinggi akan terlihat seperti magic.

---

## 37. Ringkasan Mental Model

Docker CLI fluency bukan hafalan command. Ini kemampuan menjawab pertanyaan runtime secara sistematis.

Model yang harus kamu bawa:

```text
Container problem
  -> identify object
  -> read state
  -> read logs
  -> inspect effective config
  -> inspect network/mount/resource boundary
  -> correlate timeline
  -> only then mutate/restart/rebuild
```

Command utama dan fungsi mental:

```text
docker ps       = snapshot container list
docker inspect  = low-level metadata and runtime state
docker logs     = stdout/stderr process output
docker exec     = run command inside running container
docker stats    = live resource usage
docker events   = daemon event timeline
docker top      = process list
docker diff     = writable layer changes
docker port     = published port mapping
docker cp       = file copy for evidence/debugging
```

Pertanyaan paling penting:

```text
Apa fakta runtime-nya?
Bukan: apa yang saya kira sudah saya konfigurasi?
```

---

## 38. Checklist Cepat Saat Container Bermasalah

Gunakan ini sebagai playbook awal:

```bash
# 1. Lihat container
 docker ps -a --filter "name=<name>"

# 2. Lihat state lengkap
 docker inspect <name> | jq '.[0].State'

# 3. Lihat logs
 docker logs --tail 300 -t <name>

# 4. Lihat command efektif
 docker inspect <name> | jq '.[0] | {Path, Args, Entrypoint: .Config.Entrypoint, Cmd: .Config.Cmd}'

# 5. Lihat env
 docker inspect <name> | jq '.[0].Config.Env'

# 6. Lihat port
 docker port <name>
 docker inspect <name> | jq '.[0].HostConfig.PortBindings'

# 7. Lihat network
 docker inspect <name> | jq '.[0].NetworkSettings.Networks'

# 8. Lihat mounts
 docker inspect <name> | jq '.[0].Mounts'

# 9. Lihat resources
 docker stats --no-stream <name>

# 10. Lihat timeline
 docker events --filter container=<name> --since 30m
```

Jika tidak ada `jq`, gunakan `docker inspect --format`.

---

## 39. Apa yang Harus Dikuasai Setelah Part Ini

Setelah menyelesaikan Part 005, kamu seharusnya bisa:

1. Membedakan `docker ps`, `docker inspect`, `docker logs`, `docker exec`, `docker stats`, dan `docker events` secara konseptual.
2. Membaca container state dari `docker inspect`.
3. Menemukan env, port binding, mount, network, restart policy, command efektif, dan image ID container.
4. Mendiagnosis container running tapi tidak reachable.
5. Mendiagnosis container exit cepat.
6. Mendiagnosis restart loop.
7. Membedakan image tag dan image ID yang sedang dipakai container.
8. Menggunakan CLI sebagai evidence gathering tool.
9. Menghindari anti-pattern “masuk container lalu fix manual”.
10. Membuat checklist debugging yang repeatable.

---

## 40. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
learn-docker-mastery-for-java-engineers-part-006.md
```

Topik:

```text
Dockerfile Foundations: Instruction Semantics, Not Recipes
```

Kenapa Dockerfile dibahas setelah CLI?

Karena Dockerfile menghasilkan image, image menghasilkan container, dan container punya fakta runtime. Tanpa kemampuan membaca runtime, Dockerfile sering diperlakukan seperti resep statis.

Di Part 006 kita akan membahas setiap instruksi Dockerfile bukan sebagai hafalan syntax, tetapi sebagai transformasi terhadap:

- filesystem layer
- image metadata
- runtime default
- build cache
- security posture
- operational behavior

---

## 41. Status Seri

Status saat ini:

```text
Selesai: Part 000 sampai Part 005
Belum selesai: Part 006 sampai Part 031
```

Seri belum mencapai bagian terakhir.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-006.md">Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes ➡️</a>
</div>
