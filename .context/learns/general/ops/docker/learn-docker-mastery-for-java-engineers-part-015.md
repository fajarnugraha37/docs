# learn-docker-mastery-for-java-engineers-part-015.md

# Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Docker secara production-grade  
> Fokus part ini: health semantics, readiness, liveness, startup ordering, Compose dependency behavior, Spring Boot health endpoint design, dan failure mode yang sering menyebabkan container terlihat “running” tetapi sistem sebenarnya belum siap.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 014, kita sudah membangun fondasi:

- container sebagai proses dengan boundary,
- image sebagai artifact immutable,
- Dockerfile sebagai derivasi filesystem,
- runtime Java dalam resource limit container,
- filesystem/volume,
- Docker networking,
- Compose sebagai model sistem lokal.

Part ini menjawab satu masalah yang sering muncul setelah semua fondasi itu dipakai:

> Container sudah `running`, tetapi apakah aplikasi benar-benar bisa menerima traffic, melayani request, dan pulih dari kegagalan?

Di Docker, status proses dan status kesehatan aplikasi adalah dua hal berbeda.

Sebuah container bisa:

- `running`, tetapi aplikasi Java masih booting,
- `running`, tetapi migration belum selesai,
- `running`, tetapi thread pool sudah penuh,
- `running`, tetapi tidak bisa connect ke database,
- `healthy`, tetapi endpoint health terlalu dangkal,
- `unhealthy`, tetapi sebenarnya aplikasi masih bisa melayani traffic normal,
- crash loop karena healthcheck terlalu agresif,
- dianggap ready oleh service lain padahal dependency belum siap.

Part ini membahas cara berpikir yang benar agar healthcheck tidak menjadi kosmetik, tidak menjadi sumber false confidence, dan tidak berubah menjadi penyebab outage.

---

## 1. Core Mental Model: Running Is Not Ready

Docker container punya lifecycle process-level. Secara kasar:

```text
created -> running -> exited
```

Tetapi aplikasi punya lifecycle domain-level yang lebih kaya:

```text
process started
  -> runtime initialized
  -> config loaded
  -> dependency clients initialized
  -> schema/migration validated
  -> server socket bound
  -> application warmup finished
  -> ready to serve traffic
  -> serving traffic
  -> degraded
  -> draining
  -> shutting down
  -> stopped
```

Docker `running` hanya berarti proses utama container masih hidup. Itu belum berarti aplikasi siap.

Untuk Java service, jarak antara “process hidup” dan “service siap” bisa besar:

```text
java process starts
  -> JVM initializes
  -> classpath loaded
  -> framework bootstraps
  -> Spring context created
  -> beans initialized
  -> datasource pool created
  -> migration runs
  -> embedded server starts
  -> actuator endpoint exposed
  -> cache warmed
  -> message consumer started
  -> app ready
```

Kalau service lain mengirim request pada fase terlalu awal, hasilnya bisa:

- connection refused,
- HTTP 503,
- timeout,
- failed dependency,
- message redelivery,
- failed startup chain,
- flaky integration test,
- developer mengira Compose rusak padahal readiness contract belum benar.

### Prinsip Pertama

> Health bukan status proses. Health adalah kontrak observasi tentang kemampuan aplikasi menjalankan fungsi tertentu pada waktu tertentu.

---

## 2. Empat Status yang Sering Tertukar

Dalam sistem containerized, minimal ada empat konsep status:

| Konsep | Pertanyaan | Contoh Jawaban |
|---|---|---|
| Process status | Apakah proses utama masih hidup? | PID Java masih berjalan |
| Startup status | Apakah aplikasi sudah selesai booting? | Spring context selesai dibuat |
| Readiness | Apakah aplikasi boleh menerima traffic sekarang? | Endpoint HTTP siap, DB pool valid, migration selesai |
| Liveness | Apakah aplikasi masih hidup secara internal atau stuck permanen? | Event loop tidak deadlock, JVM tidak fatal hang |

Kesalahan umum adalah memakai satu endpoint `/health` untuk semuanya.

Itu terlihat sederhana, tetapi bisa berbahaya.

Contoh endpoint tunggal:

```text
GET /actuator/health
```

Dipakai untuk:

- Compose dependency readiness,
- load balancer readiness,
- liveness restart,
- external monitoring,
- human debugging.

Masalahnya: setiap consumer punya tujuan berbeda.

- Dependency startup butuh tahu “boleh mulai belum?”
- Load balancer butuh tahu “boleh kirim traffic belum?”
- Liveness restart butuh tahu “perlu kill process ini tidak?”
- Monitoring butuh tahu “ada degradasi apa?”
- Human operator butuh detail root cause.

Satu endpoint untuk semua tujuan biasanya menghasilkan kompromi buruk.

---

## 3. Docker `HEALTHCHECK`: Apa yang Sebenarnya Dilakukan

Dockerfile mendukung instruksi `HEALTHCHECK`.

Contoh:

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1
```

Healthcheck menjalankan command periodik di dalam container. Command itu menghasilkan exit code:

```text
0 -> healthy
1 -> unhealthy
2 -> reserved / special convention, jangan dipakai sembarangan
```

Secara konseptual:

```text
container running
  -> healthcheck command executed periodically
  -> if success enough times/status stable -> healthy
  -> if failure exceeds retries -> unhealthy
```

Docker health status biasanya:

```text
starting
healthy
unhealthy
```

Poin penting:

> Docker healthcheck tidak otomatis memperbaiki aplikasi.

Di Docker Engine biasa, container yang `unhealthy` tidak otomatis direstart hanya karena healthcheck gagal. Restart policy biasanya bereaksi terhadap process exit, bukan health status. Health status adalah sinyal observasi. Tool lain, Compose dependency condition, orchestrator, script, atau monitoring dapat memakai sinyal itu.

### Status Process vs Health

Contoh:

```bash
docker ps
```

Output bisa terlihat seperti:

```text
CONTAINER ID   IMAGE       STATUS
abc123         app:dev     Up 45 seconds (healthy)
```

atau:

```text
abc123         app:dev     Up 45 seconds (unhealthy)
```

Keduanya masih `Up`. Perbedaannya bukan container alive, tetapi healthcheck verdict.

---

## 4. Anatomy of a Docker Healthcheck

Sebuah healthcheck punya beberapa parameter utama:

```dockerfile
HEALTHCHECK \
  --interval=10s \
  --timeout=3s \
  --start-period=30s \
  --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1
```

Mari pecah semantiknya.

### 4.1 `CMD`

Ini command yang dijalankan untuk mengecek health.

Contoh HTTP:

```dockerfile
CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1
```

Contoh TCP dengan shell:

```dockerfile
CMD nc -z localhost 8080 || exit 1
```

Contoh Java jar tanpa `curl` di image minimal:

```dockerfile
CMD ["java", "-cp", "/app/healthcheck.jar", "com.example.Healthcheck"]
```

Masalah praktis: image minimal/distroless sering tidak punya `curl`, `wget`, `sh`, atau `nc`. Jadi healthcheck design harus konsisten dengan base image strategy.

### 4.2 `--interval`

Jarak antar healthcheck.

Terlalu pendek:

- membebani aplikasi,
- memenuhi log,
- menambah noise,
- bisa menekan service saat sudah degraded.

Terlalu panjang:

- deteksi lambat,
- dependency service lambat memulai,
- feedback loop developer buruk.

Untuk local Compose, `5s` atau `10s` sering masuk akal.

Untuk production, harus disesuaikan dengan SLA, cost endpoint, dan sistem monitoring.

### 4.3 `--timeout`

Batas waktu command healthcheck.

Kalau endpoint kadang butuh 2 detik saat warmup, timeout `1s` bisa menghasilkan false negative.

Kalau timeout terlalu panjang, healthcheck bisa menumpuk atau memberi sinyal terlambat.

### 4.4 `--start-period`

Grace period saat startup.

Ini penting untuk Java.

Spring Boot service yang butuh 20–60 detik untuk cold start tidak boleh dinilai unhealthy terlalu cepat.

Tanpa `start-period`, healthcheck bisa gagal berkali-kali saat app memang belum siap, lalu status menjadi `unhealthy` sebelum startup selesai.

### 4.5 `--retries`

Jumlah failure berturut-turut sebelum dinyatakan unhealthy.

`retries=1` sangat agresif.

`retries=3` atau `5` lebih toleran terhadap blip pendek.

Mental model:

```text
failure detection time ~= start-period + (interval * retries) + timeout overhead
```

Bukan formula presisi, tetapi membantu desain.

---

## 5. Healthcheck di Dockerfile vs Compose

Healthcheck bisa didefinisikan di Dockerfile atau Compose.

### 5.1 Healthcheck di Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar app.jar

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- health contract melekat pada image,
- semua environment mendapat default yang sama,
- image self-describing.

Kekurangan:

- environment berbeda mungkin butuh parameter berbeda,
- image minimal mungkin tidak punya tool healthcheck,
- endpoint path bisa berbeda antar runtime config,
- production orchestrator mungkin punya mekanisme sendiri.

### 5.2 Healthcheck di Compose

```yaml
services:
  app:
    image: my-service:dev
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 30s
```

Kelebihan:

- cocok untuk local dev/integration test,
- bisa berbeda antar Compose profile,
- tidak memaksa production image membawa tool debug.

Kekurangan:

- health contract tersebar di Compose,
- image tanpa Compose tidak punya healthcheck,
- bisa divergen antar tim.

### 5.3 Rule of Thumb

Untuk Java service:

- gunakan Dockerfile healthcheck jika image memang punya endpoint dan tool healthcheck yang stabil,
- gunakan Compose healthcheck untuk local topology dependency,
- jangan masukkan healthcheck berat ke image production hanya demi Compose lokal,
- pastikan healthcheck tidak membutuhkan credential rahasia,
- jangan menganggap healthcheck sebagai pengganti observability.

---

## 6. Compose Startup Order: `depends_on` Bukan Readiness Kecuali Diberi Condition

Kesalahan paling umum Compose:

```yaml
services:
  app:
    depends_on:
      - db
```

Banyak engineer mengira ini berarti:

```text
start app after db is ready
```

Padahal yang sering dimaksud secara praktis hanyalah dependency creation/start order, bukan readiness domain-level.

Compose modern mendukung condition seperti:

```yaml
services:
  app:
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
```

Dengan pola ini, `app` tidak dimulai sampai `db` dinilai healthy oleh healthcheck-nya.

Namun tetap ada batasan penting:

> Compose startup order membantu dependency startup lokal, tetapi tidak menggantikan retry logic aplikasi.

Kenapa?

Karena dependency bisa sehat saat startup, lalu mati 30 detik kemudian.

Aplikasi tetap harus punya:

- connection retry,
- timeout,
- circuit breaker bila relevan,
- graceful degradation,
- reconnection strategy,
- error handling yang benar.

Compose `depends_on: condition: service_healthy` menyelesaikan masalah awal, bukan seluruh lifecycle dependency.

---

## 7. Startup Semantics: Started, Accepting Socket, Ready, Warm

Ada beberapa fase startup yang perlu dibedakan.

### 7.1 Process Started

PID sudah ada.

```text
java -jar app.jar
```

Docker melihat container `running`.

### 7.2 Port Bound

Aplikasi sudah bind port, misalnya `0.0.0.0:8080`.

Tetapi belum tentu endpoint business siap.

### 7.3 Framework Initialized

Spring context selesai.

Beans dibuat.

Embedded server aktif.

### 7.4 Dependency Ready

Datasource pool valid.

Redis client connect.

Kafka consumer siap.

External API config valid.

### 7.5 Migration Completed

Schema sudah sesuai versi app.

Ini penting untuk database-backed service.

### 7.6 Warmed Up

Cache tertentu sudah diisi.

JIT belum tentu warm, tetapi minimal app tidak cold sekali.

### 7.7 Ready for Traffic

Service boleh menerima traffic normal.

Health readiness harus mengarah ke fase ini, bukan sekadar process started.

---

## 8. Readiness: “Should Traffic Be Sent Here Now?”

Readiness menjawab:

> Apakah instance ini boleh menerima traffic sekarang?

Readiness bisa berubah selama runtime.

Contoh instance menjadi not ready karena:

- sedang startup,
- sedang graceful shutdown/draining,
- dependency kritis unavailable,
- thread pool exhausted,
- queue internal penuh,
- config reload gagal,
- aplikasi masuk maintenance mode.

### Readiness Bukan Liveness

Kalau readiness gagal, action idealnya:

```text
stop sending traffic to this instance
```

Bukan langsung:

```text
kill this process
```

Dalam Docker Compose lokal, readiness sering dipakai untuk menentukan kapan service dependent mulai.

Dalam orchestrator production, readiness biasanya dipakai load balancer/service routing.

### Contoh Readiness yang Baik

Untuk HTTP Java service:

```text
GET /actuator/health/readiness
```

Bisa memeriksa:

- aplikasi selesai booting,
- embedded server siap,
- datasource utama tersedia jika request normal pasti membutuhkan DB,
- migration state valid,
- message producer utama siap jika request memproduksi event sinkron.

Namun jangan sembarangan memasukkan semua dependency.

Kalau endpoint readiness memeriksa analytics database opsional, maka analytics DB outage bisa membuat service utama keluar dari traffic meskipun fungsi core masih bisa berjalan.

### Readiness Harus Mewakili Kemampuan Melayani Fungsi Core

Pertanyaannya bukan:

```text
Apakah semua dependency hijau?
```

Tetapi:

```text
Apakah instance ini pantas menerima traffic untuk fungsi yang ia janjikan?
```

---

## 9. Liveness: “Is This Process Fundamentally Alive?”

Liveness menjawab:

> Apakah process ini masih layak dibiarkan hidup, atau sudah masuk kondisi fatal yang hanya bisa pulih dengan restart?

Liveness harus lebih konservatif daripada readiness.

Contoh kondisi liveness gagal:

- JVM deadlock fatal yang membuat request thread tidak bisa jalan,
- event loop utama stuck,
- internal scheduler penting mati permanen,
- aplikasi masuk unrecoverable fatal state,
- process tidak bisa merespons endpoint ringan sama sekali dalam waktu wajar.

Contoh yang biasanya **bukan** alasan liveness gagal:

- database sedang down,
- Redis sedang unavailable,
- Kafka broker restart,
- external API timeout,
- downstream service 503.

Kenapa?

Karena dependency outage sering recover tanpa restart aplikasi. Kalau liveness memasukkan DB check, maka DB outage bisa menyebabkan semua instance direstart bersamaan. Ini memperburuk incident.

### Rule of Thumb

Readiness boleh dependency-sensitive.

Liveness sebaiknya dependency-independent, kecuali dependency tersebut benar-benar bagian internal yang jika hilang membuat process tidak bisa pulih.

---

## 10. Startup Probe Semantics Tanpa Kubernetes

Dalam Kubernetes ada konsep startup probe, readiness probe, liveness probe. Docker tidak punya pemisahan formal selengkap itu dalam `HEALTHCHECK`; hanya ada satu healthcheck per container.

Tetapi mental model startup tetap penting.

Docker healthcheck punya `start_period`, yang bisa dipakai sebagai grace period startup.

Namun `start_period` bukan startup probe penuh. Ia hanya memberi toleransi terhadap failure awal.

Untuk Compose lokal, pola praktisnya:

```yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
  interval: 10s
  timeout: 3s
  retries: 5
  start_period: 45s
```

Ini berarti:

- selama startup, beri waktu Java boot,
- setelah itu, readiness endpoint harus sukses,
- service lain boleh menunggu health status `healthy`.

Namun untuk production, jangan memaksa satu Docker healthcheck menjadi semua jenis probe. Bila runtime platform mendukung probe terpisah, gunakan endpoint terpisah.

---

## 11. Spring Boot Health Model untuk Container

Spring Boot Actuator menyediakan endpoint health.

Umumnya:

```text
/actuator/health
```

Untuk readiness/liveness, Spring Boot mendukung health groups/probes seperti:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Konfigurasi tergantung versi dan mode deployment, tetapi mental modelnya:

- liveness menunjukkan aplikasi masih hidup secara internal,
- readiness menunjukkan aplikasi siap menerima traffic.

Contoh `application.yml`:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never
```

Untuk local debugging, kadang ingin detail:

```yaml
management:
  endpoint:
    health:
      show-details: when_authorized
```

Jangan expose detail sensitif ke publik.

### Spring Boot Health Indicator Pitfall

Spring Boot bisa auto-configure health indicators untuk dependency seperti database, disk space, Redis, dan lain-lain.

Ini berguna, tetapi hati-hati:

Jika `/actuator/health/liveness` ikut memasukkan database check, maka DB outage bisa membuat liveness gagal.

Itu biasanya salah.

Lebih aman:

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState,db
        liveness:
          include: livenessState
```

Contoh ini mengilustrasikan pemisahan: readiness boleh cek DB, liveness tidak.

Namun keputusan final bergantung pada domain service.

---

## 12. Designing Health Endpoints: Jangan Terlalu Dangkal, Jangan Terlalu Berat

Health endpoint buruk bisa jatuh ke dua ekstrem.

### 12.1 Terlalu Dangkal

```java
@GetMapping("/health")
public String health() {
    return "OK";
}
```

Masalah:

- hanya membuktikan controller bisa dipanggil,
- tidak membuktikan app siap,
- tidak membuktikan dependency kritis tersedia,
- bisa healthy saat service sebenarnya gagal total.

### 12.2 Terlalu Berat

Endpoint health melakukan:

- query kompleks ke database,
- call external API,
- publish Kafka message,
- read/write object storage,
- validasi semua tenant,
- cek ratusan dependency,
- menjalankan business transaction.

Masalah:

- healthcheck menjadi beban,
- bisa menyebabkan cascading failure,
- false negative tinggi,
- saat incident, healthcheck memperparah load,
- health endpoint menjadi business endpoint tersembunyi.

### 12.3 Health Endpoint yang Proporsional

Health endpoint yang baik:

- murah,
- cepat,
- deterministik,
- tidak membuat side effect besar,
- timeout ketat,
- membedakan core vs optional dependency,
- tidak membuka detail sensitif,
- punya semantik jelas untuk consumer-nya.

---

## 13. Dependency Health: Core, Required-at-Startup, Required-at-Request, Optional

Tidak semua dependency punya bobot sama.

Buat klasifikasi:

| Kategori | Contoh | Pengaruh ke Readiness | Pengaruh ke Liveness |
|---|---|---|---|
| Core synchronous dependency | Primary DB untuk semua request | Biasanya not ready jika down | Biasanya tidak |
| Required at startup only | Migration validator | Startup/readiness awal | Tidak |
| Required for subset feature | Search index untuk fitur search | Bisa degraded, tidak selalu not ready | Tidak |
| Async dependency | Kafka producer/consumer | Tergantung service contract | Tidak biasanya |
| Optional observability | Metrics exporter | Tidak | Tidak |
| External enrichment | Third-party scoring API | Biasanya degraded | Tidak |

Pertanyaan desain:

```text
Jika dependency ini down, apakah instance harus berhenti menerima semua traffic?
```

Jika jawabannya tidak, jangan masukkan dependency itu ke readiness global.

Mungkin lebih baik expose detail di endpoint diagnostic internal, bukan readiness.

---

## 14. Healthcheck untuk Database Container di Compose

Untuk Compose local development, database container sering perlu healthcheck agar app tidak start terlalu cepat.

Contoh PostgreSQL:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/appdb
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
```

Penting:

- healthcheck DB memeriksa DB siap menerima koneksi,
- belum tentu schema aplikasi sudah migrated,
- kalau migration dilakukan app, app readiness harus menunggu migration selesai,
- kalau migration dilakukan service terpisah, app harus bergantung pada migration success.

Compose juga mendukung condition seperti `service_completed_successfully` untuk job satu kali, tergantung kebutuhan.

Contoh migration job:

```yaml
services:
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 10

  migrate:
    image: flyway/flyway:latest
    command: -url=jdbc:postgresql://db:5432/appdb -user=app -password=app migrate
    depends_on:
      db:
        condition: service_healthy

  app:
    image: my-service:dev
    depends_on:
      migrate:
        condition: service_completed_successfully
```

Catatan: contoh ini bagus untuk mental model, tetapi production migration strategy harus didesain lebih hati-hati.

---

## 15. Healthcheck untuk Java App di Compose

Contoh Compose untuk Spring Boot:

```yaml
services:
  app:
    build:
      context: .
    ports:
      - "8080:8080"
    environment:
      MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED: "true"
      MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: health,info
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 45s
```

Jika image tidak punya `curl`, alternatif:

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:8080/actuator/health/readiness >/dev/null 2>&1 || exit 1"]
```

Tetapi image juga mungkin tidak punya `wget`.

Untuk distroless image, pendekatan lain:

- healthcheck didefinisikan oleh platform luar,
- gunakan debug/dev image untuk Compose,
- tambahkan binary kecil khusus healthcheck,
- gunakan Java-based healthcheck kecil jika masuk akal,
- gunakan sidecar/prober eksternal di environment tertentu.

Jangan menambahkan shell dan curl ke runtime image production hanya tanpa sadar. Itu trade-off security/operability yang harus eksplisit.

---

## 16. Healthcheck Command Form: Exec vs Shell

Dalam Compose:

```yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health"]
```

Ini exec form.

Dengan shell:

```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -fsS http://localhost:8080/actuator/health || exit 1"]
```

Exec form lebih eksplisit dan tidak bergantung pada shell.

Shell form berguna jika butuh pipe, redirect, variable expansion, atau compound command.

Namun shell form gagal kalau image tidak punya shell.

Distroless/minimal image sering tidak cocok dengan `CMD-SHELL`.

---

## 17. Healthcheck Timing Design

Mari desain timing dengan sadar.

Misal aplikasi Java:

- cold start normal: 18 detik,
- cold start lambat di laptop: 45 detik,
- readiness endpoint response normal: <100 ms,
- saat DB lambat: 1–2 detik.

Healthcheck lokal:

```yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
  interval: 10s
  timeout: 3s
  retries: 5
  start_period: 60s
```

Kenapa?

- `start_period: 60s` memberi ruang startup lambat,
- `timeout: 3s` cukup untuk endpoint ringan,
- `retries: 5` menghindari false negative singkat,
- `interval: 10s` cukup responsif tanpa terlalu noisy.

Untuk service kecil yang start cepat:

```yaml
interval: 5s
timeout: 2s
retries: 5
start_period: 15s
```

Untuk service berat:

```yaml
interval: 15s
timeout: 5s
retries: 5
start_period: 90s
```

### Jangan Copy-Paste Timing Buta

Timing harus mengikuti:

- startup distribution,
- endpoint cost,
- host performance,
- dependency readiness,
- local vs CI vs production,
- konsekuensi false positive/false negative.

---

## 18. Failure Mode: Container Running, App Not Reachable

Gejala:

```bash
docker ps
```

menunjukkan container `Up`, tetapi request gagal.

Kemungkinan:

1. App belum ready.
2. App bind ke `127.0.0.1`, bukan `0.0.0.0`.
3. Port host salah.
4. Port container salah.
5. Health endpoint jalan, business endpoint gagal.
6. App stuck saat startup setelah port bind.
7. Firewall/VPN/proxy lokal.
8. Network Compose salah.
9. Container healthy check terlalu dangkal.

Diagnosis:

```bash
docker ps
```

```bash
docker inspect app --format '{{json .State.Health}}'
```

```bash
docker logs app
```

```bash
docker exec app sh -c 'ss -ltnp || netstat -ltnp'
```

```bash
docker exec app curl -v http://localhost:8080/actuator/health/readiness
```

Jika `curl` dari dalam container sukses tetapi dari host gagal, masalahnya kemungkinan port publishing/bind address.

Jika dari dalam container gagal, masalahnya app readiness atau internal startup.

---

## 19. Failure Mode: Healthcheck Membuat False Negative

Gejala:

```text
STATUS: Up 2 minutes (unhealthy)
```

Tetapi aplikasi terlihat bisa menerima request.

Kemungkinan:

- healthcheck path salah,
- endpoint butuh auth,
- `curl` tidak tersedia,
- `localhost` salah karena app bind ke port lain,
- timeout terlalu pendek,
- start period terlalu pendek,
- readiness terlalu strict,
- health endpoint response bukan 2xx,
- TLS/self-signed certificate issue,
- management port berbeda.

Diagnosis:

```bash
docker inspect app --format '{{range .State.Health.Log}}{{println .ExitCode .Output}}{{end}}'
```

Ini sering langsung menunjukkan error:

```text
curl: not found
```

atau:

```text
Connection refused
```

atau:

```text
Operation timed out
```

atau:

```text
HTTP/1.1 401 Unauthorized
```

### Prinsip

> Healthcheck harus diuji dari environment yang sama dengan healthcheck dijalankan: dari dalam container.

Menguji dari host tidak selalu sama.

---

## 20. Failure Mode: Healthcheck Terlalu Strict dan Menyebabkan Startup Chain Gagal

Contoh:

```yaml
app:
  depends_on:
    db:
      condition: service_healthy
```

DB healthcheck:

```yaml
healthcheck:
  test: ["CMD-SHELL", "psql -U app -d appdb -c 'select count(*) from huge_table' || exit 1"]
  interval: 3s
  timeout: 1s
  retries: 3
```

Masalah:

- query berat,
- timeout terlalu pendek,
- healthcheck DB overload,
- app tidak pernah start.

Lebih baik:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
  interval: 5s
  timeout: 3s
  retries: 10
```

DB healthcheck untuk startup biasanya cukup membuktikan DB menerima koneksi, bukan menjalankan validasi business berat.

Schema readiness bisa ditangani migration job/app readiness.

---

## 21. Failure Mode: Liveness Mengecek Database

Ini anti-pattern klasik.

Misal liveness endpoint:

```text
/actuator/health/liveness
```

ikut mengecek DB.

Saat DB down 2 menit:

```text
DB down
  -> liveness fails on every app instance
  -> runtime restarts all app containers
  -> connection storms during restart
  -> DB recovery lebih berat
  -> outage lebih lama
```

Lebih aman:

```text
liveness = app internal state only
readiness = app can serve traffic, maybe includes DB
```

Saat DB down:

```text
readiness false
  -> traffic withheld/degraded if platform supports
  -> app process stays alive
  -> connection pool retries
  -> DB recovers
  -> readiness true again
```

---

## 22. Failure Mode: Health Endpoint Butuh Authentication

Health endpoint kadang berada di bawah security filter.

Gejala:

```text
curl: HTTP 401
```

Docker healthcheck gagal.

Solusi:

- expose endpoint health secara internal tanpa auth,
- atau gunakan credential khusus healthcheck dengan hati-hati,
- atau bind management endpoint hanya ke internal network,
- atau gunakan platform-native probe yang bisa mengakses internal endpoint.

Untuk local Compose, endpoint health biasanya boleh tanpa auth selama tidak expose detail sensitif.

Jangan expose detail full health ke internet.

---

## 23. Failure Mode: Management Port Berbeda

Spring Boot dapat memakai management port berbeda.

Contoh:

```yaml
management:
  server:
    port: 8081
```

App port:

```text
8080
```

Healthcheck salah:

```yaml
test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
```

Harusnya:

```yaml
test: ["CMD", "curl", "-fsS", "http://localhost:8081/actuator/health/readiness"]
```

Tetapi kalau management port hanya bind ke host tertentu, cek lagi bind address.

---

## 24. Failure Mode: Healthcheck Output Membocorkan Informasi

Health endpoint detail bisa berisi:

- database name,
- host internal,
- username,
- disk path,
- dependency topology,
- exception message,
- version library,
- stack trace.

Untuk local dev, detail bisa membantu.

Untuk exposed environment, batasi.

Spring Boot mendukung kontrol `show-details`.

Contoh aman default:

```yaml
management:
  endpoint:
    health:
      show-details: never
```

Atau:

```yaml
management:
  endpoint:
    health:
      show-details: when_authorized
```

---

## 25. Healthcheck dan Graceful Shutdown

Readiness juga relevan saat shutdown.

Ideal lifecycle saat stop:

```text
SIGTERM received
  -> app marks readiness false
  -> traffic stops being routed
  -> app drains in-flight request
  -> consumers stop polling
  -> resources close
  -> process exits cleanly
```

Di plain Docker/Compose, tidak ada load balancer bawaan seperti orchestrator production, tetapi prinsip tetap penting.

Untuk Spring Boot:

- aktifkan graceful shutdown,
- pastikan SIGTERM diterima process Java,
- jangan shell wrapper menelan signal,
- readiness state harus berubah saat shutdown bila platform menggunakannya.

Contoh:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Di Docker:

```dockerfile
STOPSIGNAL SIGTERM
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jangan:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Shell form bisa mengganggu signal handling jika tidak dikelola benar.

---

## 26. Healthcheck dan Message Consumers

Tidak semua service adalah HTTP server.

Java service bisa berupa:

- Kafka consumer,
- RabbitMQ worker,
- scheduled batch,
- outbox relay,
- projection updater,
- command processor.

Pertanyaan readiness berbeda:

```text
Apakah worker siap memproses message?
```

Bukan:

```text
Apakah HTTP endpoint bisa diakses?
```

Namun tetap berguna menyediakan lightweight management HTTP endpoint untuk health.

Untuk consumer, readiness bisa mempertimbangkan:

- consumer initialized,
- broker reachable,
- subscription assigned,
- lag threshold wajar,
- downstream core dependency tersedia,
- internal processing pool tidak saturated.

Tetapi hati-hati:

- lag tinggi mungkin degraded, bukan not ready,
- broker down tidak selalu liveness failure,
- restart consumer saat broker down bisa memperburuk rebalance storm.

---

## 27. Healthcheck dan Scheduled/Batch Jobs

Untuk one-shot job container, healthcheck sering tidak relevan.

Contoh migration job:

```text
run -> complete successfully -> exit 0
```

Yang penting bukan healthcheck, tetapi exit code.

Compose dependency bisa memakai:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

Untuk long-running scheduler, healthcheck bisa memeriksa:

- scheduler thread alive,
- last successful run within threshold,
- queue not stuck,
- lock not permanently held.

Tetapi jangan buat liveness gagal hanya karena satu job business gagal. Itu mungkin alert, bukan restart trigger.

---

## 28. Healthcheck dan Resource Exhaustion

Aplikasi bisa hidup tetapi tidak sehat karena resource saturation:

- heap pressure,
- native memory pressure,
- thread pool penuh,
- connection pool exhausted,
- file descriptor limit,
- disk full,
- CPU throttling berat,
- GC pause panjang.

Apakah healthcheck harus memeriksa ini?

Jawabannya: tergantung.

### Cocok untuk Readiness

Jika thread pool penuh dan service tidak bisa melayani request, readiness boleh false.

Jika connection pool DB habis karena semua request akan gagal, readiness bisa false atau degraded.

### Tidak Selalu Cocok untuk Liveness

Heap usage tinggi bukan berarti process harus direstart.

GC pause sesaat bukan liveness failure.

Disk hampir penuh mungkin alert serius, tetapi restart tidak memperbaiki.

### Observability Lebih Cocok

Banyak resource issue lebih cocok untuk metrics/alerts daripada healthcheck biner.

Healthcheck adalah sinyal kasar. Jangan jadikan health endpoint sebagai monitoring system lengkap.

---

## 29. Health Response Semantics

HTTP health endpoint biasanya memakai status code:

```text
200 -> healthy/ready
503 -> unhealthy/not ready
```

Response body bisa sederhana:

```json
{"status":"UP"}
```

atau:

```json
{"status":"DOWN"}
```

Untuk Docker `curl -f`, status 4xx/5xx dianggap failure.

```bash
curl -fsS http://localhost:8080/actuator/health/readiness
```

`-f` penting agar HTTP 503 menghasilkan exit non-zero.

Tanpa `-f`, `curl` bisa exit 0 meskipun server mengembalikan 503.

Ini bug healthcheck yang sangat umum.

Buruk:

```yaml
test: ["CMD", "curl", "http://localhost:8080/actuator/health"]
```

Lebih baik:

```yaml
test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
```

---

## 30. Healthcheck Tidak Boleh Punya Side Effect Besar

Jangan membuat healthcheck yang:

- insert row ke database,
- publish message,
- mutate cache,
- trigger background process,
- membuat audit log business,
- generate report,
- acquire distributed lock tanpa release robust,
- memanggil endpoint payment sandbox berkali-kali.

Healthcheck dipanggil berkala. Jika interval 10 detik, dalam sehari:

```text
6 per minute * 60 * 24 = 8,640 calls per container per day
```

Untuk 100 container:

```text
864,000 calls per day
```

Side effect kecil pun bisa menjadi noise besar.

---

## 31. Healthcheck dan Timeout Hygiene

Healthcheck yang memanggil dependency harus punya timeout eksplisit.

Buruk:

```java
healthIndicator.checkExternalApi(); // default timeout 60 seconds or unknown
```

Lebih baik:

```text
external check timeout: 200ms-1000ms depending on dependency
```

Jika health endpoint sendiri menggantung, Docker healthcheck akan timeout sesuai `--timeout`, tetapi thread aplikasi bisa tetap tersangkut jika internal call tidak punya timeout.

Rule:

> Every health dependency check must have a bounded timeout and bounded cost.

---

## 32. Healthcheck dan Caching

Kadang healthcheck dependency mahal. Bisa caching singkat.

Contoh:

```text
DB readiness check result cached for 2 seconds
```

Ini mengurangi beban jika banyak probe memanggil bersamaan.

Namun cache terlalu lama bisa membuat signal lambat.

Jangan cache liveness/readiness terlalu lama sampai kehilangan makna.

---

## 33. Healthcheck dan Circuit Breaker

Jika aplikasi memakai circuit breaker, readiness perlu desain hati-hati.

Misalnya external scoring API down.

Pilihan:

1. Readiness tetap UP, feature scoring degraded.
2. Readiness DOWN, seluruh service keluar traffic.
3. Readiness UP tetapi diagnostic endpoint menunjukkan degraded.

Keputusan bergantung domain.

Untuk service regulatory/case management, mungkin sebagian fungsi harus tetap berjalan walau enrichment eksternal down. Maka readiness global tidak boleh menjatuhkan seluruh service.

Gunakan domain criticality:

```text
Core case write path? readiness-sensitive.
Optional notification? diagnostic/degraded, not global readiness.
Analytics sync? not global readiness.
```

---

## 34. Healthcheck dan Multi-Tenant / Multi-Region Systems

Jika service melayani banyak tenant, healthcheck global bisa misleading.

Contoh:

- tenant A DB shard sehat,
- tenant B DB shard down,
- global `/health` UP.

Atau sebaliknya:

- satu tenant down,
- global readiness DOWN,
- semua tenant kehilangan service.

Untuk sistem kompleks:

- global readiness harus mewakili platform-level ability,
- tenant-specific health masuk diagnostic endpoint,
- routing/degradation bisa tenant-aware,
- alerting harus lebih granular daripada Docker healthcheck.

Docker healthcheck tetap biner; jangan paksa ia membawa seluruh health topology domain.

---

## 35. A Practical Spring Boot Configuration

Contoh `application.yml` untuk service HTTP umum:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s

management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never
      group:
        liveness:
          include: livenessState
        readiness:
          include: readinessState,db
```

Interpretasi:

- liveness hanya state internal app,
- readiness melibatkan readiness state dan database,
- detail tidak dibuka publik,
- graceful shutdown aktif.

Untuk local debugging:

```yaml
management:
  endpoint:
    health:
      show-details: always
```

Tetapi jangan pakai default ini di environment yang dapat diakses publik.

---

## 36. A Practical Dockerfile Healthcheck

Jika runtime image punya `curl`:

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app
COPY target/my-service.jar app.jar

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=45s --retries=5 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Namun banyak JRE image tidak menyertakan `curl` secara default.

Jika harus install `curl`, sadari trade-off:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
```

Ini menambah package dan attack surface.

Alternatif:

- healthcheck hanya di Compose untuk dev,
- external probe dari platform production,
- debug image berbeda,
- custom tiny healthcheck binary,
- Java healthcheck command jika benar-benar diperlukan.

---

## 37. A Practical Compose File with App, DB, and Health Semantics

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d appdb"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  app:
    build:
      context: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/appdb
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: app
      MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED: "true"
      MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: health,info
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 45s

volumes:
  db-data:
```

Pola ini menyatakan:

- DB punya healthcheck sendiri,
- app menunggu DB healthy sebelum start,
- app punya readiness healthcheck sendiri,
- dependency startup eksplisit,
- local dev lebih deterministic.

Tetapi aplikasi tetap harus punya retry logic runtime karena DB bisa mati setelah startup.

---

## 38. Observing Health State

### 38.1 `docker ps`

```bash
docker ps
```

Lihat status:

```text
Up 1 minute (healthy)
Up 1 minute (unhealthy)
Up 10 seconds (health: starting)
```

### 38.2 `docker inspect`

```bash
docker inspect app --format '{{json .State.Health}}'
```

Untuk output lebih readable:

```bash
docker inspect app --format '{{range .State.Health.Log}}{{println .Start .ExitCode .Output}}{{end}}'
```

Ini sangat berguna untuk mengetahui healthcheck command gagal karena apa.

### 38.3 Compose

```bash
docker compose ps
```

```bash
docker compose logs app
```

```bash
docker compose events
```

### 38.4 Direct Probe Inside Container

```bash
docker exec app curl -v http://localhost:8080/actuator/health/readiness
```

Jika image punya shell/curl.

Jika tidak:

```bash
docker run --rm --network container:app curlimages/curl:latest \
  -v http://localhost:8080/actuator/health/readiness
```

Pola `--network container:app` membuat container debug berbagi network namespace dengan app container. Ini berguna saat app image minimal.

---

## 39. Debugging Decision Tree

### Case A: `docker ps` shows `health: starting` too long

Cek:

1. App startup lama?
2. Endpoint readiness belum muncul?
3. Healthcheck path salah?
4. Management port salah?
5. `start_period` terlalu besar atau app stuck?
6. Logs menunjukkan waiting dependency?

Commands:

```bash
docker logs app
```

```bash
docker inspect app --format '{{json .State.Health}}'
```

### Case B: `unhealthy`, app logs normal

Cek:

1. `curl`/`wget` missing?
2. Healthcheck command typo?
3. Endpoint butuh auth?
4. Exit code command benar?
5. HTTP 503 valid karena readiness memang false?
6. Healthcheck timeout terlalu pendek?

### Case C: dependency app starts before DB ready

Cek:

1. Apakah DB punya healthcheck?
2. Apakah app `depends_on` memakai `condition: service_healthy`?
3. Apakah DB healthcheck benar-benar memeriksa readiness?
4. Apakah app juga punya retry logic?

### Case D: healthcheck passes but app unusable

Cek:

1. Healthcheck terlalu dangkal?
2. Endpoint hanya return static OK?
3. Business dependency tidak termasuk readiness?
4. Endpoint berbeda port/context path?
5. Healthcheck hanya memeriksa HTTP server, bukan app state?

### Case E: app restart storm saat dependency down

Cek:

1. Liveness mengecek dependency eksternal?
2. Runtime/orchestrator restart on unhealthy?
3. App sendiri exit saat dependency transient down?
4. Retry policy terlalu agresif?
5. Backoff tidak ada?

---

## 40. Anti-Patterns

### 40.1 Static OK Health

```java
return "OK";
```

Tidak cukup untuk readiness production.

### 40.2 Healthcheck Terlalu Berat

Healthcheck menjalankan query/report besar.

Ini membuat healthcheck menjadi load generator.

### 40.3 Liveness Mengecek Semua Dependency

Menyebabkan restart storm saat dependency outage.

### 40.4 Readiness Sama dengan Liveness

Menyamakan dua semantik yang berbeda.

### 40.5 Health Endpoint Butuh Internet

Healthcheck tergantung external public API. Saat internet/proxy bermasalah, service dianggap down meski fungsi internal masih bisa berjalan.

### 40.6 Healthcheck Tanpa Timeout

Bisa menggantung dan menghabiskan resource.

### 40.7 `curl` Tanpa `-f`

HTTP 503 tetap dianggap sukses.

Buruk:

```bash
curl http://localhost:8080/health
```

Lebih baik:

```bash
curl -fsS http://localhost:8080/health
```

### 40.8 Compose `depends_on` Dianggap Retry Strategy

`depends_on` hanya membantu startup order. Aplikasi tetap butuh runtime resilience.

### 40.9 Healthcheck Membuka Detail Sensitif

Health endpoint detail dibuka ke publik.

### 40.10 Healthcheck Mengubah State

Healthcheck melakukan write/publish/side effect.

---

## 41. Design Pattern: Health Contract Document

Untuk service penting, dokumentasikan health contract.

Contoh:

```markdown
# Health Contract: case-service

## Liveness
Endpoint: GET /actuator/health/liveness
Meaning: JVM and application context are alive.
Includes:
- livenessState
Excludes:
- database
- message broker
- external notification API

## Readiness
Endpoint: GET /actuator/health/readiness
Meaning: instance can receive case command HTTP traffic.
Includes:
- readinessState
- primary database connectivity
- migration version compatibility
Excludes:
- analytics database
- notification gateway
- reporting export storage

## Startup
Expected cold start:
- local: 20-60s
- CI: 30-90s
- production: 15-45s

## Healthcheck Timing
Local Compose:
- interval: 10s
- timeout: 3s
- retries: 5
- start_period: 60s
```

Ini membuat health bukan tebakan, tetapi bagian dari service contract.

---

## 42. Design Pattern: Separate Diagnostic Health from Routing Health

Routing health harus sederhana dan aman.

Diagnostic health bisa lebih detail tetapi internal.

Contoh:

```text
/actuator/health/liveness       -> for liveness
/actuator/health/readiness      -> for routing/startup
/internal/diagnostics/health    -> detailed internal diagnostics
```

Diagnostic endpoint bisa menampilkan:

- dependency state,
- last successful broker poll,
- migration version,
- downstream latency,
- degraded features,
- queue depth,
- tenant shard status.

Tetapi jangan dipakai sebagai liveness global.

---

## 43. Design Pattern: Health as Domain Capability

Untuk sistem case management/regulatory enforcement, health sering tidak cukup kalau hanya technical.

Contoh service:

```text
case-command-service
```

Capabilities:

- create case,
- assign case,
- escalate case,
- submit enforcement action,
- emit audit event,
- generate notification.

Dependency:

- primary DB,
- audit event broker,
- identity provider,
- notification service,
- reporting store.

Readiness harus menjawab:

```text
Bolehkah service menerima command yang mengubah state regulatory case?
```

Jika audit event broker wajib untuk defensibility, maka broker unavailability mungkin readiness-critical.

Jika notification bisa retry async, notification outage mungkin degraded, bukan not ready.

Ini bukan purely technical decision. Ini domain reliability decision.

---

## 44. Healthcheck untuk CI Integration Test

CI sering flaky karena service belum ready.

Buruk:

```bash
docker compose up -d
mvn test
```

Lebih baik:

```bash
docker compose up -d --wait
mvn test
```

atau eksplisit:

```bash
docker compose up -d db
# wait until db healthy
mvn test
```

Compose versi modern memiliki kemampuan menunggu service health dalam beberapa command/flow, tetapi tetap pastikan file Compose punya healthcheck yang benar.

CI checklist:

- semua dependency punya healthcheck,
- app test menunggu readiness,
- timeout CI cukup realistis,
- tidak bergantung fixed sleep,
- logs diambil saat failure,
- health log diambil saat failure.

Hindari:

```bash
sleep 30
```

Fixed sleep buruk karena:

- terlalu lambat saat service cepat,
- terlalu cepat saat host lambat,
- tidak menjelaskan root cause.

Lebih baik wait berbasis condition.

---

## 45. Healthcheck untuk Local Developer Experience

Developer butuh feedback jelas.

Compose output yang baik:

```bash
docker compose ps
```

harus menunjukkan:

```text
db    running (healthy)
app   running (healthy)
```

Jika app tidak healthy, command untuk diagnosis harus mudah:

```bash
docker compose logs app
```

```bash
docker inspect <container> --format '{{range .State.Health.Log}}{{println .ExitCode .Output}}{{end}}'
```

Buat helper script jika perlu, tetapi konsepnya:

```text
health failure should be self-explaining
```

Jangan membuat developer menebak apakah DB belum siap, migration gagal, atau health path salah.

---

## 46. Healthcheck dan Image Minimal

Distroless/minimal image bagus untuk mengurangi attack surface, tetapi menyulitkan healthcheck command internal.

Trade-off:

| Strategy | Kelebihan | Kekurangan |
|---|---|---|
| Install curl in runtime image | Healthcheck mudah | Image lebih besar, attack surface naik |
| Use platform external probe | Runtime image tetap minimal | Tergantung platform |
| Compose-only healthcheck in dev image | Dev nyaman | Dev/prod bisa berbeda |
| Custom small health binary | Kontrol tinggi | Maintenance tambahan |
| Java-based healthcheck | Tidak butuh curl | JVM startup healthcheck bisa berat jika command memulai JVM baru |

Untuk Java service, external probe sering lebih bersih di production platform. Untuk local Compose, dev image dengan tool debugging bisa lebih ergonomis.

---

## 47. Healthcheck and Restart Policy Interaction

Docker restart policy seperti:

```yaml
restart: unless-stopped
```

bereaksi terhadap container exit.

Health status `unhealthy` sendiri tidak selalu membuat Docker restart container.

Jangan berasumsi:

```text
unhealthy -> Docker restart
```

Di banyak setup plain Docker, itu tidak terjadi otomatis.

Jika ingin restart based on health, butuh mekanisme tambahan seperti:

- orchestrator,
- watchdog,
- external automation,
- platform-specific policy.

Namun restart-on-unhealthy juga harus hati-hati. Jika healthcheck salah atau dependency outage, restart bisa memperburuk keadaan.

---

## 48. Security Considerations

Health endpoint harus aman.

Checklist:

- Jangan expose detail sensitif publik.
- Jangan expose internal dependency topology ke internet.
- Jangan butuh secret di Docker healthcheck jika bisa dihindari.
- Jangan letakkan token healthcheck di Dockerfile.
- Jangan log secret saat health failure.
- Batasi management endpoint ke internal network bila memungkinkan.
- Pastikan `/actuator` exposure minimal.
- Gunakan `show-details: never` atau `when_authorized` sesuai environment.

Health endpoint sering diremehkan, padahal sangat informatif bagi attacker.

---

## 49. Production Readiness Checklist

Untuk setiap Java service container:

### Process

- [ ] `ENTRYPOINT` exec form.
- [ ] SIGTERM diterima Java process.
- [ ] Graceful shutdown aktif.
- [ ] Stop timeout realistis.

### Health Semantics

- [ ] Liveness dan readiness dipisahkan.
- [ ] Liveness tidak mengecek dependency eksternal transient.
- [ ] Readiness mewakili kemampuan menerima traffic core.
- [ ] Startup grace sesuai cold start nyata.
- [ ] Healthcheck tidak punya side effect besar.
- [ ] Healthcheck punya timeout.

### Docker/Compose

- [ ] Dependency service punya healthcheck.
- [ ] Compose `depends_on` memakai `condition: service_healthy` bila perlu.
- [ ] Tidak memakai fixed sleep sebagai readiness strategy.
- [ ] Healthcheck command tersedia di image atau external probe digunakan.
- [ ] `curl -f` atau equivalent digunakan untuk HTTP status failure.

### Spring Boot

- [ ] Actuator health endpoint enabled.
- [ ] Probes enabled bila memakai liveness/readiness endpoint.
- [ ] Health groups dikonfigurasi dengan sadar.
- [ ] Detail health tidak bocor.
- [ ] Management port/path konsisten dengan healthcheck.

### Operations

- [ ] `docker inspect` health log bisa digunakan untuk diagnosis.
- [ ] Logs cukup untuk menjelaskan startup failure.
- [ ] Metrics/alerts tidak digantikan oleh healthcheck biner.
- [ ] Degraded state dibedakan dari down.

---

## 50. Mini Lab: Membuktikan Running != Ready

### 50.1 Buat Service yang Lambat Ready

Misal Spring Boot app dengan endpoint readiness yang baru UP setelah 30 detik.

Pseudo behavior:

```text
0-30s: /actuator/health/readiness -> 503
30s+: /actuator/health/readiness -> 200
```

Compose:

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health/readiness"]
      interval: 5s
      timeout: 2s
      retries: 5
      start_period: 10s
```

Observe:

```bash
docker compose up -d
watch docker compose ps
```

Kamu akan melihat fase:

```text
running (health: starting)
running (unhealthy) mungkin jika start_period terlalu pendek
running (healthy)
```

Ubah `start_period` dari `10s` ke `45s`. Perhatikan perbedaannya.

### 50.2 Coba `curl` Tanpa `-f`

Jika readiness mengembalikan 503:

```bash
curl http://localhost:8080/actuator/health/readiness
```

Exit code bisa tetap 0.

Lalu:

```bash
curl -f http://localhost:8080/actuator/health/readiness
```

Exit code non-zero.

Ini membuktikan kenapa healthcheck harus memperhatikan exit code.

### 50.3 Coba Compose Dependency

Buat `app` bergantung pada `db` tanpa `service_healthy`.

Lihat app mencoba connect terlalu cepat.

Lalu tambahkan:

```yaml
depends_on:
  db:
    condition: service_healthy
```

Lihat startup lebih deterministic.

---

## 51. Senior-Level Heuristics

Gunakan heuristik berikut saat mendesain health.

### 51.1 Health Is a Contract, Not a Decoration

Jika tidak ada consumer yang jelas, healthcheck cenderung asal-asalan.

Tentukan siapa consumer-nya:

- Compose startup?
- Load balancer?
- Human operator?
- Monitoring?
- CI test harness?

### 51.2 Restart Is Not Always Recovery

Restart membantu untuk:

- memory leak sementara,
- stuck internal state,
- unrecoverable process failure.

Restart tidak membantu untuk:

- database down,
- wrong credentials,
- DNS broken,
- disk full,
- bad deployment config,
- downstream outage.

### 51.3 Readiness Can Be Domain-Specific

Service yang sama bisa punya beberapa capability.

Satu global readiness mungkin terlalu kasar.

### 51.4 Health Should Fail Loudly but Cheaply

Jika gagal, health output/log harus membantu diagnosis.

Tetapi healthcheck tidak boleh mahal.

### 51.5 Prefer Conditions Over Sleeps

`service_healthy` lebih baik daripada `sleep 30`.

Retry with backoff lebih baik daripada fixed startup assumption.

### 51.6 Separate Local Convenience from Production Contract

Compose local healthcheck boleh lebih pragmatis.

Production health semantics harus lebih hati-hati.

---

## 52. Common Interview/Review Questions

Gunakan pertanyaan ini untuk mengevaluasi maturity Docker health design.

1. Apa bedanya container `running` dan app `ready`?
2. Kenapa liveness tidak seharusnya mengecek database dalam banyak kasus?
3. Apa bahaya memakai `/health` static `OK`?
4. Kenapa `curl` healthcheck sebaiknya memakai `-f`?
5. Apa fungsi `start_period`?
6. Kenapa Compose `depends_on` tidak cukup tanpa healthcheck?
7. Apa yang terjadi jika health endpoint butuh auth?
8. Bagaimana mendesain readiness untuk service yang punya dependency opsional?
9. Apakah Docker otomatis restart container yang `unhealthy`?
10. Bagaimana debugging healthcheck yang gagal di image minimal tanpa shell?
11. Apa beda healthcheck untuk HTTP service dan message consumer?
12. Kapan healthcheck sebaiknya tidak dipakai?
13. Bagaimana mencegah health endpoint membocorkan detail internal?
14. Bagaimana health semantics berubah saat graceful shutdown?
15. Apa risiko healthcheck yang melakukan query berat?

---

## 53. Summary Mental Model

Ringkasnya:

```text
running != ready
ready != live
live != dependency healthy
dependency healthy != business capability healthy
healthcheck != monitoring
restart != recovery untuk semua failure
```

Docker healthcheck adalah sinyal. Nilainya bergantung pada semantik yang kamu desain.

Compose `depends_on: condition: service_healthy` membuat local startup lebih deterministic, tetapi tidak menghapus kebutuhan retry logic aplikasi.

Untuk Java/Spring Boot, pisahkan readiness dan liveness. Readiness boleh merepresentasikan kemampuan melayani traffic core. Liveness harus konservatif dan tidak mudah gagal karena dependency eksternal transient.

Health endpoint yang baik itu:

- murah,
- cepat,
- bounded,
- tidak side-effect berat,
- tidak membocorkan rahasia,
- punya semantik jelas,
- sesuai consumer-nya,
- membantu diagnosis tanpa menjadi sistem monitoring penuh.

Part ini adalah jembatan antara “container bisa dijalankan” dan “container bisa dipercaya sebagai unit layanan”.

---

## 54. Referensi Utama

- Docker Docs — Dockerfile `HEALTHCHECK` reference: https://docs.docker.com/reference/dockerfile/
- Docker Docs — Compose file services and `depends_on` conditions: https://docs.docker.com/reference/compose-file/services/
- Docker Docs — Control startup and shutdown order in Compose: https://docs.docker.com/compose/how-tos/startup-order/
- Docker Docs — Compose healthcheck examples in guides: https://docs.docker.com/compose/
- Spring Boot Docs — Actuator endpoints and health probes: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- Spring Boot Docs — Graceful shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html

---

## 55. Status Seri

Part ini adalah **Part 015** dari rencana **32 part**:

```text
000-031
```

Yang sudah selesai setelah part ini:

```text
000 Orientation: Docker as Process Packaging, Not Mini VM
001 Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
002 Docker Architecture: Client, Daemon, Engine, containerd, runc
003 Image Mental Model: Layer, Digest, Tag, Manifest, Platform
004 Container Lifecycle: Create, Start, Stop, Restart, Remove
005 Docker CLI Fluency: From Command User to Runtime Inspector
006 Dockerfile Foundations: Instruction Semantics, Not Recipes
007 Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit
008 Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
009 Java Runtime in Containers: Memory, CPU, GC, Signals
010 ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
011 Filesystem and Volumes: Immutable Image, Mutable Runtime State
012 Docker Networking: Bridge, Host, None, DNS, Port Publishing
013 Docker Compose as Local System Model
014 Compose for Java Development: Databases, Brokers, Mock Services
015 Container Health: Healthcheck, Readiness, Liveness, Startup Semantics
```

Seri **belum selesai**.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-016.md
```

Topik berikutnya:

```text
Configuration and Secrets: Env, Files, Build Args, Runtime Injection
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Compose for Java Development: Databases, Brokers, Mock Services</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-016.md">Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection ➡️</a>
</div>
