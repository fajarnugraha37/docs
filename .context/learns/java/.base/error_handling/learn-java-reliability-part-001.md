# learn-java-reliability-part-001.md

# Part 001 — Mental Model of Failure: Dari Bug ke Reliability Engineering

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability  
> Status: Part 001 dari 030  
> Prasyarat: sudah memahami Java dasar, collections, streams, concurrency/reactive, data types, Jakarta/JAX-RS dasar/advance  
> Fokus part ini: membangun cara berpikir tentang failure sebelum masuk ke exception class, shutdown lifecycle, retry, circuit breaker, observability, dan production-hardening.

---

## 0. Tujuan Bagian Ini

Bagian ini bukan membahas `try-catch` dulu.

Bagian ini membangun fondasi berpikir:

> Error handling bukan aktivitas lokal di satu method. Error handling adalah cara sistem mengelola transisi dari kondisi normal menuju kondisi tidak pasti, rusak, parsial, terdegradasi, atau gagal total.

Setelah membaca bagian ini, kamu harus bisa menjawab:

1. Apa bedanya bug, fault, error, failure, outage, dan incident?
2. Mengapa exception bukan selalu failure?
3. Mengapa tidak semua failure muncul sebagai exception?
4. Mengapa sistem bisa “success” dari sudut pandang kode, tetapi gagal dari sudut pandang bisnis?
5. Bagaimana failure menyebar antar-layer dan antar-service?
6. Bagaimana engineer senior melihat failure sebagai state transition dan blast radius, bukan sekadar stack trace?
7. Mengapa reliability harus didesain dari awal, bukan ditempel belakangan?

---

## 1. Core Problem

Banyak engineer memahami error handling seperti ini:

```java
try {
    doSomething();
} catch (Exception e) {
    log.error("Failed", e);
    throw e;
}
```

Atau:

```java
try {
    callExternalService();
} catch (Exception e) {
    return defaultValue;
}
```

Masalahnya, dua contoh tersebut belum menjawab pertanyaan yang jauh lebih penting:

- Apakah operasi tadi sudah mengubah state?
- Kalau sudah mengubah state, state mana yang berubah?
- Apakah perubahan tersebut sudah commit?
- Apakah operasi aman untuk diulang?
- Apakah caller tahu bahwa hasilnya tidak pasti?
- Apakah downstream akan menerima duplikasi?
- Apakah user melihat sukses padahal sistem gagal sebagian?
- Apakah failure ini harus di-retry, di-stop, di-alert, di-compensate, atau diabaikan?
- Apakah error ini local, atau tanda awal incident sistemik?
- Apakah log-nya cukup untuk investigasi?
- Apakah sistem masih menerima traffic saat sebenarnya sedang shutdown?

Inilah titik perbedaan antara developer yang “bisa coding error handling” dan engineer yang memahami reliability.

Developer biasa bertanya:

> Exception apa yang harus saya catch?

Engineer reliability bertanya:

> State apa yang mungkin terjadi saat failure muncul, siapa yang terdampak, apa tindakan aman berikutnya, dan evidence apa yang harus dipertahankan?

---

## 2. Vocabulary Dasar: Bug, Fault, Error, Failure, Incident, Outage

Kita perlu menyamakan istilah terlebih dahulu.

Dalam percakapan sehari-hari, orang sering memakai kata “error”, “bug”, “issue”, “failure”, dan “incident” secara campur aduk. Untuk engineering yang serius, istilah ini perlu dipisahkan.

### 2.1 Bug / Defect

**Bug** atau **defect** adalah kesalahan dalam desain, implementasi, konfigurasi, asumsi, atau requirement.

Contoh:

```java
if (amount.compareTo(BigDecimal.ZERO) >= 0) {
    throw new InvalidAmountException("Amount must be positive");
}
```

Kode di atas bug karena kondisi validasi terbalik. Nilai positif malah ditolak.

Bug bisa diam lama tanpa terlihat. Bug adalah potensi masalah.

### 2.2 Fault

**Fault** adalah defect yang berada di dalam sistem dan dapat menghasilkan kondisi salah ketika dieksekusi.

Contoh:

- bug validasi amount berada di production code;
- konfigurasi timeout terlalu tinggi;
- query tidak punya index;
- retry tanpa jitter;
- shutdown hook menunggu thread yang tidak akan selesai;
- mapping HTTP 409 menjadi 500;
- exception ditelan tanpa log.

Fault belum tentu langsung terlihat. Fault bisa latent.

### 2.3 Error

**Error** adalah kondisi internal yang salah saat sistem berjalan.

Contoh:

- object berada dalam state tidak valid;
- cache berisi data basi;
- request context kehilangan correlation ID;
- retry counter tidak bertambah;
- transaction sudah rollback tetapi code menganggap commit;
- worker memproses message yang seharusnya sudah expired.

Error adalah kondisi internal yang menyimpang dari expected state.

### 2.4 Failure

**Failure** adalah ketika sistem tidak memenuhi expected behavior yang terlihat dari luar.

Contoh:

- API mengembalikan 500;
- user tidak bisa login;
- pembayaran tercatat dua kali;
- email terkirim walaupun transaksi gagal;
- case workflow masuk state yang salah;
- request timeout;
- data hilang;
- audit trail tidak tercatat;
- service tidak berhenti bersih saat deployment.

Failure adalah observable behavior yang salah.

### 2.5 Incident

**Incident** adalah failure yang berdampak pada operasi, user, SLA/SLO, compliance, atau bisnis sehingga perlu respons terkoordinasi.

Contoh:

- login semua user gagal selama 20 menit;
- queue backlog naik sampai menyebabkan delay proses enforcement;
- deployment membuat sebagian pod stuck terminating;
- external API rate limit menyebabkan fitur alamat tidak bisa digunakan;
- database storage pressure menyebabkan insert gagal;
- audit trail tidak mencatat aktivitas internet module selama window tertentu.

Incident bukan hanya error teknis. Incident adalah failure yang sudah menjadi masalah operasional.

### 2.6 Outage

**Outage** adalah kondisi layanan tidak tersedia atau tidak dapat menjalankan fungsi utama.

Semua outage adalah incident, tetapi tidak semua incident adalah outage.

Contoh incident yang bukan outage total:

- fitur tertentu gagal tetapi fitur lain berjalan;
- latency naik drastis tetapi service masih memberi response;
- audit trail gagal sebagian;
- satu integration provider down tetapi user masih bisa melakukan sebagian flow;
- service degrade menggunakan cache stale.

---

## 3. Rantai Kausal Failure

Model sederhana:

```text
Defect / Bug
    ↓
Fault in system
    ↓
Activated by condition
    ↓
Internal error state
    ↓
Observed failure
    ↓
Incident / outage / data corruption / compliance breach
```

Contoh konkret:

```text
Bug:
  retry external API tidak punya jitter

Fault:
  semua pod melakukan retry dengan interval sama

Activation:
  external dependency mulai lambat / timeout

Internal error:
  thread pool penuh oleh retry

Failure:
  request user ikut timeout walaupun fitur lain tidak butuh dependency itu

Incident:
  service dianggap unavailable oleh user dan SLO error budget terbakar
```

Poin penting:

> Failure jarang terjadi karena satu hal. Biasanya failure adalah rantai sebab-akibat yang melibatkan bug, load, timing, dependency, konfigurasi, dan respons sistem yang tidak tepat.

---

## 4. Exception Bukan Sama Dengan Failure

Dalam Java, semua exception dan error yang bisa dilempar berada di bawah `Throwable`. `Exception` merepresentasikan kondisi yang mungkin ingin ditangkap aplikasi, sedangkan `RuntimeException` adalah unchecked exception yang dapat terjadi selama operasi normal JVM dan tidak wajib dideklarasikan pada `throws` clause. `Error` biasanya merepresentasikan masalah serius yang reasonable application tidak seharusnya mencoba tangkap sebagai mekanisme normal.

Rujukan resmi:

- Oracle Java `Throwable`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html
- Oracle Java `Exception`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html
- Oracle Java `RuntimeException`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html
- Oracle Java `Error`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Error.html

Namun di level sistem, exception hanyalah salah satu bentuk signal.

### 4.1 Exception yang Bukan Failure

Contoh:

```java
public User getUserOrThrow(UserId id) {
    return userRepository.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id));
}
```

Jika API memang harus mengembalikan 404 saat user tidak ditemukan, maka `UserNotFoundException` bukan incident dan bukan failure sistem. Itu expected domain outcome.

Contoh lain:

- validasi input gagal;
- optimistic lock conflict;
- idempotency conflict;
- unauthorized request;
- expired token;
- business rule violation.

Semua itu bisa direpresentasikan sebagai exception, tetapi bukan berarti sistem rusak.

### 4.2 Failure yang Tidak Muncul Sebagai Exception

Contoh:

```java
try {
    auditService.record(activity);
} catch (Exception e) {
    // ignore because audit should not block user flow
}
return SuccessResponse.ok();
```

Dari sisi API, response sukses.

Dari sisi compliance, sistem gagal karena audit trail hilang.

Tidak ada exception keluar. Tidak ada 500. Tetapi failure nyata terjadi.

Contoh lain:

- fallback mengembalikan data default yang salah;
- retry menyebabkan duplikasi transaksi;
- message di-ack sebelum side effect selesai;
- shutdown membunuh worker di tengah proses;
- log error tidak menyimpan correlation ID;
- cache stale dipakai untuk keputusan yang harus fresh;
- timeout terlalu panjang membuat thread pool habis;
- 200 OK dikembalikan walaupun operasi async gagal.

Poin penting:

> Exception adalah signal lokal. Failure adalah pelanggaran ekspektasi sistem.

---

## 5. Local Correctness vs System Correctness

Kode bisa benar secara lokal tetapi salah secara sistemik.

### 5.1 Contoh Local Correct, System Wrong

```java
public void sendApprovalEmail(Application app) {
    emailClient.send(app.getApplicantEmail(), "Approved", "Your application is approved");
}
```

Method ini terlihat benar.

Tapi dalam flow:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = applicationRepository.getById(id);
    app.approve();
    sendApprovalEmail(app);
}
```

Pertanyaan reliability:

- Apa yang terjadi jika email terkirim tetapi transaction rollback?
- Apa yang terjadi jika DB commit sukses tetapi email gagal?
- Apa yang terjadi jika request timeout setelah DB commit?
- Apa yang terjadi jika user retry approval?
- Apa yang terjadi jika pod menerima SIGTERM setelah `app.approve()` tapi sebelum commit?

Method `sendApprovalEmail` benar secara lokal, tetapi placement-nya dalam transaction boundary bisa membuat sistem salah.

### 5.2 Local Exception Handling Bisa Menghancurkan System Semantics

```java
public void process(Message message) {
    try {
        handle(message);
    } catch (Exception e) {
        log.error("Failed to process message", e);
    }
    ack(message);
}
```

Kode ini “handle exception”.

Tapi secara sistem:

- message tetap di-ack;
- broker menganggap message berhasil;
- side effect mungkin belum terjadi;
- tidak ada retry;
- tidak ada dead-letter;
- data hilang secara logis.

Error handling lokal justru mengubah recoverable failure menjadi data loss.

---

## 6. Failure Sebagai State Transition

Cara berpikir yang lebih kuat:

> Jangan lihat failure sebagai event. Lihat failure sebagai transisi state.

Contoh operasi sederhana:

```text
RECEIVED
  ↓
VALIDATED
  ↓
PERSISTED
  ↓
EXTERNAL_NOTIFIED
  ↓
COMPLETED
```

Failure bisa terjadi di setiap titik:

```text
RECEIVED
  ↓ validation failed
REJECTED
```

```text
VALIDATED
  ↓ DB timeout, commit unknown
UNKNOWN_PERSISTENCE_RESULT
```

```text
PERSISTED
  ↓ external API failed
PERSISTED_BUT_NOT_NOTIFIED
```

```text
EXTERNAL_NOTIFIED
  ↓ response write failed
COMPLETED_BUT_CLIENT_UNAWARE
```

State yang paling berbahaya biasanya bukan `FAILED`.

Yang paling berbahaya adalah:

```text
UNKNOWN
PARTIAL
DUPLICATED
COMMITTED_BUT_NOT_ACKNOWLEDGED
ACKNOWLEDGED_BUT_NOT_COMMITTED
VISIBLE_SUCCESS_WITH_HIDDEN_FAILURE
```

### 6.1 Failure State Table

| State | Makna | Risiko | Tindakan Aman |
|---|---|---:|---|
| `REJECTED` | Input/domain tidak valid | rendah | return 4xx/domain error |
| `FAILED_BEFORE_SIDE_EFFECT` | Gagal sebelum perubahan state | rendah-sedang | aman retry jika idempotent |
| `FAILED_AFTER_PARTIAL_SIDE_EFFECT` | Sebagian side effect terjadi | tinggi | detect, compensate, reconcile |
| `COMMIT_UNKNOWN` | Tidak tahu commit sukses/gagal | tinggi | query by idempotency key / reconciliation |
| `DUPLICATE_ATTEMPT` | Operasi diulang | sedang-tinggi | idempotency guard |
| `DEGRADED` | Sistem berjalan dengan fungsi terbatas | sedang | expose degradation, monitor |
| `CORRUPTED` | Invariant/data rusak | sangat tinggi | stop, isolate, repair |
| `SILENT_FAILURE` | Gagal tanpa signal | sangat tinggi | improve observability, backfill/replay |

Mental model ini akan dipakai terus dalam seri ini.

---

## 7. Failure Domain: Di Mana Failure Terjadi?

Failure bisa berasal dari banyak domain.

### 7.1 Input Failure

Contoh:

- field wajib kosong;
- format salah;
- enum tidak valid;
- file terlalu besar;
- payload JSON invalid;
- user mengirim state transition yang tidak diperbolehkan.

Biasanya client-correctable.

Strategi:

- return 400/422;
- jangan retry otomatis;
- berikan field-level error;
- jangan log sebagai error besar kecuali indikasi abuse.

### 7.2 Domain Failure

Contoh:

- application tidak bisa di-approve karena status bukan `PENDING_REVIEW`;
- user tidak boleh submit renewal sebelum periode tertentu;
- case tidak bisa close karena outstanding action masih ada;
- appeal tidak bisa dibuat setelah deadline.

Strategi:

- domain exception;
- stable error code;
- jelas apakah user bisa memperbaiki;
- jangan campur dengan technical 500.

### 7.3 Authorization/Security Failure

Contoh:

- user tidak punya role;
- token expired;
- token invalid;
- client certificate invalid;
- session revoked.

Strategi:

- fail closed;
- minimalkan detail ke client;
- log security event secara aman;
- jangan bocorkan apakah resource ada jika berisiko enumeration.

### 7.4 Dependency Failure

Contoh:

- external API timeout;
- DNS failure;
- TLS handshake failure;
- 429 rate limit;
- 503 provider unavailable;
- schema response berubah.

Strategi:

- classify retriable/non-retriable;
- timeout budget;
- circuit breaker;
- fallback hanya jika benar secara bisnis;
- expose dependency health.

### 7.5 Persistence Failure

Contoh:

- connection pool exhausted;
- deadlock;
- lock timeout;
- constraint violation;
- storage full;
- commit unknown;
- read replica lag.

Strategi:

- bedakan conflict vs transient vs capacity;
- idempotency key;
- transaction boundary jelas;
- retry hati-hati;
- alert untuk saturation/capacity.

### 7.6 Runtime/Resource Failure

Contoh:

- OutOfMemoryError;
- CPU saturation;
- thread pool exhausted;
- file descriptor exhausted;
- GC pause tinggi;
- container OOMKilled;
- pod eviction.

Strategi:

- jangan sekadar catch;
- isolate resource;
- bulkhead;
- limit concurrency;
- readiness/liveness benar;
- capture evidence sebelum hilang.

### 7.7 Shutdown/Lifecycle Failure

Contoh:

- pod menerima SIGTERM tetapi masih menerima traffic;
- worker mati sebelum ack/nack;
- scheduler start job saat shutdown;
- executor tidak drain;
- DB pool ditutup sebelum request selesai;
- `preStop` melebihi grace period.

Spring Boot punya graceful shutdown untuk web server melalui application context shutdown dan grace period. Kubernetes punya lifecycle termination sendiri: `preStop`, SIGTERM, dan `terminationGracePeriodSeconds` perlu dihitung sebagai satu lifecycle budget, bukan mekanisme terpisah yang pasti berhasil.

Rujukan resmi:

- Spring Boot graceful shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Kubernetes pod lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes container lifecycle hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/

---

## 8. Failure Modes: Cara Sistem Gagal

Failure mode adalah pola bagaimana sistem gagal.

### 8.1 Crash Failure

Sistem berhenti tiba-tiba.

Contoh:

- JVM crash;
- container killed;
- process exit;
- pod OOMKilled;
- node failure.

Risiko:

- in-flight request hilang;
- transaction uncertain;
- buffer belum flush;
- lock belum dilepas secara normal;
- message belum ack/nack.

### 8.2 Omission Failure

Sistem gagal melakukan sesuatu yang seharusnya dilakukan.

Contoh:

- audit trail tidak tercatat;
- email tidak terkirim;
- event tidak dipublish;
- cache tidak diinvalidasi;
- status tidak berubah.

Omission failure sering tidak terlihat karena tidak ada exception keluar.

### 8.3 Timing Failure

Sistem memberi hasil terlalu lambat atau terlalu cepat.

Contoh:

- API response 30 detik padahal SLA 2 detik;
- retry dilakukan terlalu cepat;
- timeout lebih panjang dari upstream timeout;
- scheduler menjalankan job sebelum data siap;
- shutdown grace terlalu pendek.

Timing failure penting karena distributed system sangat sensitif terhadap waktu.

### 8.4 Value Failure

Sistem mengembalikan nilai yang salah.

Contoh:

- status `APPROVED` padahal seharusnya `PENDING_REVIEW`;
- default value dipakai sebagai fallback padahal misleading;
- currency rounding salah;
- stale cache dipakai sebagai data final.

Ini sering lebih berbahaya daripada 500 karena user percaya hasilnya benar.

### 8.5 State Transition Failure

Sistem masuk state yang tidak sah.

Contoh:

```text
DRAFT → APPROVED
```

Padahal flow valid:

```text
DRAFT → SUBMITTED → REVIEWED → APPROVED
```

Jenis failure ini sangat relevan untuk case management, enforcement lifecycle, regulatory workflow, dan approval system.

### 8.6 Duplicate Failure

Operasi terjadi lebih dari sekali.

Contoh:

- user double submit;
- client retry setelah timeout;
- message redelivered;
- scheduler overlap;
- external callback dikirim ulang.

Strategi utama:

- idempotency;
- unique constraint;
- deduplication;
- deterministic command result.

### 8.7 Split-Brain / Divergence Failure

Dua komponen punya pandangan state yang berbeda.

Contoh:

- DB mengatakan approved, search index masih pending;
- payment provider berhasil, internal transaction gagal;
- email terkirim, application status rollback;
- case state berubah, audit event tidak tercatat.

Strategi:

- outbox/inbox;
- reconciliation;
- source of truth jelas;
- eventual consistency monitor;
- repair workflow.

---

## 9. Failure Visibility: Terlihat, Tersembunyi, atau Menyesatkan

Tidak semua failure terlihat sama.

### 9.1 Visible Failure

Contoh:

- 500 response;
- exception log;
- pod restart;
- alert fired;
- queue backlog naik.

Visible failure relatif mudah ditangani.

### 9.2 Hidden Failure

Contoh:

- audit gagal tetapi ditelan;
- event tidak publish tetapi API success;
- fallback default value salah;
- cache stale tanpa marker;
- job skip data tanpa report.

Hidden failure jauh lebih berbahaya.

### 9.3 Misleading Success

Ini pola paling berbahaya:

```json
{
  "status": "SUCCESS",
  "message": "Application approved"
}
```

Padahal:

- DB commit gagal;
- audit gagal;
- downstream notification gagal;
- workflow event tidak terkirim;
- only partial update succeeded.

Misleading success merusak trust, menyulitkan incident response, dan bisa menjadi compliance problem.

---

## 10. Blast Radius

Blast radius adalah seberapa luas dampak failure.

Pertanyaan kunci:

- Apakah failure hanya memengaruhi satu request?
- Satu user?
- Satu tenant/agency?
- Satu module?
- Semua pod?
- Semua service?
- Semua environment?
- Data historis?
- Audit/compliance evidence?

### 10.1 Contoh Blast Radius Rendah

```text
User A submit invalid payload → 400 validation error
```

Dampak:

- satu request;
- user bisa koreksi;
- tidak ada state berubah.

### 10.2 Contoh Blast Radius Sedang

```text
External provider timeout → address lookup unavailable
```

Dampak:

- fitur address lookup terganggu;
- flow lain masih berjalan;
- bisa degrade jika aman.

### 10.3 Contoh Blast Radius Tinggi

```text
DB connection pool exhausted → semua request blocking → pod dianggap unhealthy → restart loop
```

Dampak:

- semua module bisa terganggu;
- retry memperparah;
- autoscaling mungkin menambah pod yang juga gagal;
- incident sistemik.

### 10.4 Contoh Blast Radius Compliance

```text
Audit trail insert ignored during high load
```

Dampak:

- business function terlihat normal;
- evidence hilang;
- investigasi/regulatory defensibility terganggu;
- failure baru diketahui terlambat.

---

## 11. Reliability sebagai Control Loop

Reliability bukan satu fitur. Reliability adalah control loop.

```text
Prevent → Detect → Contain → Recover → Learn
```

### 11.1 Prevent

Mencegah failure masuk atau aktif.

Contoh:

- validation;
- invariant guard;
- type-safe design;
- timeout;
- capacity limit;
- unique constraint;
- static analysis;
- code review;
- architecture review;
- production readiness checklist.

### 11.2 Detect

Mengetahui failure sedang terjadi.

Contoh:

- structured logs;
- metrics;
- tracing;
- health checks;
- SLO alerts;
- dead-letter monitor;
- reconciliation report;
- anomaly detection.

### 11.3 Contain

Mencegah failure menyebar.

Contoh:

- circuit breaker;
- bulkhead;
- rate limiter;
- backpressure;
- queue isolation;
- tenant isolation;
- feature flag;
- kill switch;
- fail closed/open sesuai konteks.

### 11.4 Recover

Mengembalikan sistem ke state benar.

Contoh:

- retry aman;
- replay event;
- compensation;
- manual repair;
- rollback;
- forward fix;
- queue reprocessing;
- restore from backup;
- reconcile from source of truth.

### 11.5 Learn

Mencegah failure serupa berulang.

Contoh:

- postmortem;
- test baru;
- alert tuning;
- runbook update;
- architecture improvement;
- code convention;
- failure mode documentation.

---

## 12. Reliability Bukan Hanya Availability

Banyak orang menyamakan reliability dengan uptime.

Itu terlalu sempit.

Reliability minimal mencakup:

1. **Availability** — service bisa digunakan.
2. **Correctness** — hasil benar.
3. **Durability** — data tidak hilang.
4. **Consistency** — state tidak kontradiktif secara tidak terkendali.
5. **Recoverability** — bisa pulih setelah gagal.
6. **Observability** — failure bisa dilihat dan diinvestigasi.
7. **Operability** — operator bisa mengambil tindakan aman.
8. **Security** — failure tidak membuka celah.
9. **Compliance defensibility** — evidence dan auditability terjaga.

Contoh:

```text
Service uptime 99.99%, tetapi 2% transaksi menghasilkan status salah.
```

Itu bukan reliable.

```text
API selalu 200 OK, tetapi audit trail gagal 10% saat traffic tinggi.
```

Itu bukan reliable.

```text
Service sangat available karena semua error difallback, tetapi user melihat data misleading.
```

Itu bukan reliable.

---

## 13. Error Budget dan Trade-off

SRE menggunakan konsep SLO dan error budget untuk menghubungkan reliability dengan keputusan engineering. Google SRE menjelaskan bahwa tingkat pelanggaran SLO dapat dibandingkan dengan error budget, lalu gap-nya menjadi input keputusan apakah rilis baru aman dilanjutkan atau perlu ditahan.

Rujukan:

- Google SRE Book — Service Level Objectives: https://sre.google/sre-book/service-level-objectives/

### 13.1 Mengapa Ini Penting untuk Developer?

Karena reliability selalu trade-off.

Kita tidak bisa selalu memilih:

- retry terus;
- timeout panjang;
- fallback semua;
- fail-fast semua;
- strict validation semua;
- synchronous consistency semua;
- zero downtime semua;
- audit blocking semua;
- availability maksimal dan correctness maksimal tanpa biaya.

Setiap keputusan punya harga.

### 13.2 Contoh Trade-off

| Keputusan | Keuntungan | Risiko |
|---|---|---|
| Retry agresif | transient failure bisa pulih | retry storm, overload |
| Timeout panjang | operasi lambat masih bisa selesai | thread pool habis, user menunggu |
| Fallback default | user tetap mendapat response | misleading data |
| Fail closed | aman untuk security/compliance | availability turun |
| Fail open | availability naik | correctness/security risk |
| Async processing | latency rendah | eventual consistency dan recovery lebih sulit |
| Synchronous processing | semantics lebih jelas | latency dan coupling tinggi |

Top engineer tidak mencari pattern “terbaik”.

Top engineer mencari keputusan yang benar untuk failure mode tertentu.

---

## 14. Failure Classification Matrix

Saat menemukan error/failure, jangan langsung bertanya “catch di mana?”.

Gunakan matrix berikut.

| Pertanyaan | Pilihan | Dampak Desain |
|---|---|---|
| Apakah expected? | expected / unexpected | domain error vs incident signal |
| Apakah recoverable? | recoverable / non-recoverable | retry/compensate vs fail fast |
| Siapa yang bisa memperbaiki? | client / operator / developer / provider | response code, alert, runbook |
| Apakah side effect sudah terjadi? | belum / sebagian / sudah / tidak diketahui | retry safety, reconciliation |
| Apakah aman diulang? | ya / tidak / hanya dengan idempotency key | retry policy |
| Apakah failure lokal? | local / dependency / systemic | containment strategy |
| Apakah data terdampak? | no / temporary / durable corruption | severity |
| Apakah user terdampak? | no / partial / full | incident priority |
| Apakah compliance terdampak? | no / possible / yes | audit/evidence handling |
| Apakah terlihat? | visible / hidden / misleading | observability gap |

Contoh penggunaan:

```text
External API 503 saat user submit form
```

Analisis:

- expected? Ya, dependency bisa down.
- recoverable? Mungkin.
- side effect internal sudah terjadi? Tergantung transaction boundary.
- aman retry? Hanya jika idempotent.
- lokal? Tidak, dependency failure.
- user terdampak? Ya.
- compliance? Tergantung flow.
- visible? Jika hanya log tanpa metric, visibility lemah.

Dari sini baru desain:

- timeout;
- retry terbatas + jitter;
- idempotency;
- circuit breaker;
- user response yang jujur;
- metric dependency failure;
- alert jika rate tinggi;
- reconciliation jika ada partial state.

---

## 15. Failure Propagation

Failure jarang berhenti di tempat asal.

### 15.1 Propagation Antar-Layer

```text
Database slow
  ↓
Repository call lambat
  ↓
Service thread tertahan
  ↓
HTTP request timeout
  ↓
Client retry
  ↓
Load naik
  ↓
Connection pool exhausted
  ↓
Semua endpoint ikut gagal
```

Root cause mungkin DB slow, tetapi failure menyebar melalui:

- thread pool;
- connection pool;
- client retry;
- timeout mismatch;
- lack of bulkhead;
- lack of backpressure.

### 15.2 Propagation Antar-Service

```text
Service A timeout ke Service B
  ↓
A retry 3x
  ↓
Service B makin overload
  ↓
Service C yang juga pakai B ikut gagal
  ↓
Platform incident
```

### 15.3 Propagation Melalui Data

```text
Bug mapping status
  ↓
Wrong status persisted
  ↓
Event published with wrong status
  ↓
Search index updated
  ↓
Report generated
  ↓
User action berdasarkan data salah
```

Ini lebih sulit daripada timeout karena failure menyebar sebagai data valid-looking.

---

## 16. Containment: Membatasi Penyebaran Failure

Containment berarti failure boleh terjadi, tetapi tidak boleh menyebar tanpa batas.

### 16.1 Containment Techniques

| Teknik | Melindungi Dari | Catatan |
|---|---|---|
| Timeout | infinite wait | harus sesuai budget chain |
| Circuit breaker | dependency overload | perlu metric dan threshold benar |
| Bulkhead | resource starvation | isolate thread/connection/queue |
| Rate limiter | overload / abuse | bisa client-side atau server-side |
| Backpressure | producer lebih cepat dari consumer | penting untuk queue/stream |
| Idempotency | duplicate side effect | wajib untuk retry-safe command |
| Queue isolation | failure module A ganggu module B | hindari shared poison backlog |
| Feature flag | disable fitur bermasalah | harus aman secara data |
| Kill switch | stop integration cepat | perlu runbook |
| Readiness false | stop menerima traffic | penting saat shutdown/degraded |
| DLQ | isolate poison message | bukan tempat sampah permanen |

### 16.2 Containment Mindset

Pertanyaan containment:

- Jika dependency ini down, fitur apa saja yang ikut gagal?
- Jika queue backlog naik, apakah semua worker terblokir?
- Jika satu tenant mengirim traffic tinggi, apakah tenant lain ikut terdampak?
- Jika external API rate limited, apakah service internal ikut habis thread?
- Jika audit trail lambat, apakah business transaction harus ikut gagal?
- Jika business transaction tetap sukses tanpa audit, apakah compliance menerima?

---

## 17. Recovery: Pulih ke State yang Benar

Recovery bukan sekadar “service nyala lagi”.

Recovery berarti sistem kembali ke state yang benar atau setidaknya state yang diketahui dan dapat diperbaiki.

### 17.1 Recovery Types

#### 17.1.1 Automatic Retry

Cocok untuk transient failure.

Syarat:

- operasi idempotent;
- retry terbatas;
- backoff + jitter;
- failure classified;
- tidak memperparah overload.

#### 17.1.2 Replay

Cocok untuk event/message/job.

Syarat:

- handler idempotent;
- ordering dipahami;
- poison message ditangani;
- side effect duplicate-safe.

#### 17.1.3 Compensation

Cocok untuk distributed transaction yang tidak bisa atomic.

Contoh:

- cancel reservation;
- reverse payment;
- revoke approval;
- create corrective audit entry.

#### 17.1.4 Reconciliation

Cocok untuk state divergence.

Contoh:

- compare internal DB vs external provider;
- compare source table vs search index;
- compare outbox event vs projection;
- compare audit count vs business transaction count.

#### 17.1.5 Manual Repair

Cocok untuk failure yang butuh human judgment.

Contoh:

- regulatory case state repair;
- data correction with approval;
- legal/audit-sensitive correction;
- partial migration failure.

### 17.2 Recovery Must Be Designed Before Incident

Jika recovery baru dipikirkan saat incident, biasanya sudah terlambat.

Desain recovery harus menjawab:

- data apa yang diperlukan untuk repair?
- apakah ada correlation ID?
- apakah request payload disimpan?
- apakah event bisa replay?
- apakah command punya idempotency key?
- apakah state transition history tersedia?
- apakah operator punya runbook?
- apakah manual action aman dan audited?

---

## 18. Reliability Invariants

Invariant adalah kondisi yang harus selalu benar.

Dalam reliability, kita perlu menulis invariant bukan hanya domain invariant, tetapi juga operational invariant.

### 18.1 Domain Invariant

Contoh:

```text
Application cannot be APPROVED unless it has passed required review.
```

```text
A closed case cannot receive new enforcement action unless reopened.
```

```text
A renewal cannot be issued before prior license exists.
```

### 18.2 Data Invariant

Contoh:

```text
Every approved application must have exactly one approval decision record.
```

```text
Every state transition must have actor, timestamp, previous state, and new state.
```

```text
Every external submission must have provider request id or failure reason.
```

### 18.3 Operational Invariant

Contoh:

```text
No pod should receive new traffic after it enters draining mode.
```

```text
A queue message must not be acknowledged before durable side effect is complete.
```

```text
A retryable command must have an idempotency key.
```

```text
A background job must not overlap with itself unless explicitly designed.
```

```text
Every unexpected exception must be observable with correlation id.
```

### 18.4 Compliance Invariant

Contoh:

```text
Every user-visible state-changing action must produce an audit record.
```

```text
Audit write failure must be visible and classified.
```

```text
Manual repair must itself be audited.
```

Untuk sistem regulatory, compliance invariant sering sama pentingnya dengan business invariant.

---

## 19. Anti-Patterns Awal

Bagian detail anti-pattern akan muncul di part akhir, tetapi fondasi ini perlu sejak awal.

### 19.1 Catch and Ignore

```java
try {
    auditService.record(activity);
} catch (Exception ignored) {
}
```

Bahaya:

- hidden failure;
- evidence loss;
- false success.

### 19.2 Catch and Log Only

```java
try {
    process(message);
} catch (Exception e) {
    log.error("Failed", e);
}
ack(message);
```

Bahaya:

- log bukan recovery;
- message hilang;
- failure dianggap sukses.

### 19.3 Wrap Everything as RuntimeException

```java
catch (SQLException e) {
    throw new RuntimeException(e);
}
```

Bahaya:

- kehilangan classification;
- caller tidak tahu conflict/transient/capacity;
- retry policy salah.

### 19.4 Convert Everything to 500

```text
Validation error → 500
Conflict → 500
Unauthorized → 500
Dependency timeout → 500
Bug → 500
```

Bahaya:

- client tidak bisa merespons benar;
- observability kacau;
- incident triage sulit.

### 19.5 Retry Everything

Bahaya:

- duplicate side effects;
- overload amplification;
- rate limit makin parah;
- data corruption.

### 19.6 Fallback Everything

Bahaya:

- misleading success;
- stale decision;
- compliance breach;
- hidden dependency outage.

### 19.7 Infinite Timeout

Bahaya:

- thread pool starvation;
- request pile-up;
- shutdown stuck;
- cascading failure.

### 19.8 Graceful Shutdown by Hope

```text
Kubernetes sends SIGTERM, therefore safe.
```

Bahaya:

- app belum stop accepting traffic;
- worker belum drain;
- LB masih routing;
- grace period habis;
- SIGKILL terjadi.

---

## 20. Production Failure Thinking: Pertanyaan Wajib

Saat mendesain satu flow, tanyakan pertanyaan berikut.

### 20.1 Before Side Effect

- Apa validasi boundary?
- Apa domain invariant?
- Apa precondition?
- Apakah command punya idempotency key?
- Apa expected conflict?
- Apa yang bisa ditolak sebelum transaction dimulai?

### 20.2 During Side Effect

- Apa saja side effect yang terjadi?
- Mana yang durable?
- Mana yang external?
- Mana yang irreversible?
- Apa urutan side effect?
- Apa yang terjadi jika gagal di antara dua side effect?

### 20.3 After Side Effect

- Bagaimana caller tahu hasil final?
- Apakah response failure berarti operation failure?
- Apakah response timeout berarti operation unknown?
- Apakah event sudah publish?
- Apakah audit sudah tercatat?
- Apakah ada reconciliation path?

### 20.4 During Shutdown

- Apakah service stop menerima work baru?
- Apakah in-flight work diberi waktu selesai?
- Apakah worker bisa checkpoint?
- Apakah message ack/nack benar?
- Apakah executor ditutup berurutan?
- Apakah timeout shutdown cukup?
- Apa yang terjadi jika SIGKILL datang?

### 20.5 During Incident

- Apakah ada metric untuk failure ini?
- Apakah log punya correlation ID?
- Apakah operator tahu tindakan aman?
- Apakah retry manual aman?
- Apakah replay aman?
- Apakah repair butuh approval?
- Apakah user perlu diberitahu?

---

## 21. Example: Simple Flow, Deep Failure Analysis

Misalnya ada API:

```text
POST /applications/{id}/approve
```

Expected behavior:

1. validasi user berwenang;
2. load application;
3. cek state `PENDING_REVIEW`;
4. ubah state ke `APPROVED`;
5. simpan decision record;
6. tulis audit trail;
7. publish event `ApplicationApproved`;
8. kirim notification;
9. return success.

### 21.1 Naive Implementation

```java
@Transactional
public void approve(ApplicationId id, User actor) {
    Application app = applicationRepository.findById(id)
        .orElseThrow(() -> new NotFoundException("Application not found"));

    app.approve(actor);
    applicationRepository.save(app);

    auditTrail.record(actor, "APPROVE", id);
    eventPublisher.publish(new ApplicationApproved(id));
    notificationService.sendApprovedEmail(app);
}
```

Terlihat sederhana.

Tapi failure analysis:

| Step | Failure | Pertanyaan Reliability |
|---|---|---|
| load app | DB timeout | return 503? retry? alert? |
| state check | invalid state | 409 domain conflict? |
| save app | deadlock | retry safe? optimistic lock? |
| audit | audit DB down | block approval atau fail visible? |
| publish event | broker down | rollback approval atau outbox? |
| email | SMTP down | rollback approval? async retry? |
| response | client disconnected | approval sudah commit? |

### 21.2 Better Mental Model

Pisahkan side effect berdasarkan criticality.

```text
Critical atomic state:
  - application status
  - approval decision record
  - audit trail? depends compliance requirement
  - outbox event

Post-commit async side effect:
  - notification email
  - search projection
  - analytics
```

Kemungkinan desain:

```text
Transaction:
  - validate state
  - update application
  - insert decision
  - insert audit trail
  - insert outbox event
Commit

Async workers:
  - publish integration event from outbox
  - send email from event/notification queue
  - retry with idempotency
  - DLQ if poison
  - reconciliation if stuck
```

### 21.3 Why This Matters

Jika email gagal, approval tidak perlu rollback.

Jika event broker down, outbox menjaga durable intent.

Jika request timeout setelah commit, idempotency key memungkinkan client mendapatkan hasil yang sama saat retry.

Jika audit wajib compliance, audit harus berada dalam transaction atau punya failure semantics yang eksplisit.

---

## 22. Example: Failure as State Machine

Approval command dapat dimodelkan seperti ini:

```text
COMMAND_RECEIVED
  ↓
AUTH_CHECKED
  ↓
DOMAIN_VALIDATED
  ↓
TRANSACTION_STARTED
  ↓
STATE_UPDATED
  ↓
AUDIT_RECORDED
  ↓
OUTBOX_RECORDED
  ↓
COMMITTED
  ↓
RESPONSE_SENT
```

Failure states:

```text
AUTH_FAILED
VALIDATION_FAILED
CONFLICT
DB_UNAVAILABLE_BEFORE_WRITE
COMMIT_UNKNOWN
AUDIT_FAILED_BEFORE_COMMIT
OUTBOX_FAILED_BEFORE_COMMIT
COMMITTED_RESPONSE_FAILED
COMMITTED_ASYNC_NOTIFICATION_PENDING
```

Setiap state butuh tindakan berbeda.

| Failure State | Client Response | Retry Safe? | Recovery |
|---|---|---|---|
| `AUTH_FAILED` | 401/403 | no | user/auth fix |
| `VALIDATION_FAILED` | 400/422 | no until corrected | client fix |
| `CONFLICT` | 409 | maybe after refresh | reload state |
| `DB_UNAVAILABLE_BEFORE_WRITE` | 503 | yes if idempotent | retry/backoff |
| `COMMIT_UNKNOWN` | 202/503/unknown semantics | only via idempotency lookup | reconcile |
| `AUDIT_FAILED_BEFORE_COMMIT` | 500/503 | yes if idempotent | retry transaction |
| `OUTBOX_FAILED_BEFORE_COMMIT` | 500/503 | yes if idempotent | retry transaction |
| `COMMITTED_RESPONSE_FAILED` | client saw timeout | client retry may duplicate unless idempotent | lookup result |
| `ASYNC_NOTIFICATION_PENDING` | success with pending async | no duplicate email | worker retry |

Inilah cara berpikir “top 1%”: failure bukan catch block, tetapi eksplisit dalam model state.

---

## 23. Practical Java Boundary Example

Kita belum masuk detail taxonomy exception, tetapi ini contoh arah desain.

```java
public sealed interface ApplicationApprovalFailure
        permits NotFoundFailure,
                InvalidStateFailure,
                PersistenceUnavailableFailure,
                CommitUnknownFailure,
                AuditFailure {

    String code();
    boolean clientCorrectable();
    boolean retryable();
    Severity severity();
}
```

Atau jika menggunakan exception:

```java
public abstract class DomainException extends RuntimeException {
    private final String code;

    protected DomainException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

```java
public final class InvalidApplicationStateException extends DomainException {
    public InvalidApplicationStateException(String currentState, String expectedState) {
        super(
            "APPLICATION_INVALID_STATE",
            "Application is in state %s, expected %s".formatted(currentState, expectedState)
        );
    }
}
```

Tetapi hati-hati: class exception saja tidak cukup.

Kamu tetap perlu:

- mapping ke API response;
- observability;
- retry semantics;
- transaction boundary;
- idempotency;
- shutdown behavior;
- runbook.

---

## 24. A Reliability-Oriented Error Model

Error/failure object idealnya membawa semantic metadata.

Contoh konseptual:

```java
public record FailureDescriptor(
    String code,
    FailureCategory category,
    boolean retryable,
    boolean clientCorrectable,
    boolean operatorActionRequired,
    boolean dataMayHaveChanged,
    boolean resultUnknown,
    Severity severity,
    String runbookKey
) {}
```

Contoh kategori:

```java
enum FailureCategory {
    VALIDATION,
    AUTHENTICATION,
    AUTHORIZATION,
    DOMAIN_CONFLICT,
    NOT_FOUND,
    EXTERNAL_DEPENDENCY,
    PERSISTENCE,
    TIMEOUT,
    RATE_LIMITED,
    CAPACITY,
    BUG,
    INVARIANT_VIOLATION,
    SHUTDOWN,
    UNKNOWN
}
```

Contoh severity:

```java
enum Severity {
    INFO,
    WARNING,
    ERROR,
    CRITICAL
}
```

Kenapa metadata ini penting?

Karena downstream decision bergantung pada metadata tersebut:

- API response;
- retry policy;
- alerting;
- logging level;
- support message;
- runbook;
- audit handling;
- reconciliation.

---

## 25. Failure Evidence

Saat failure terjadi, sistem harus meninggalkan evidence yang cukup.

Evidence minimal:

- timestamp;
- environment;
- service name;
- version/build/git commit;
- correlation ID;
- trace ID;
- request ID;
- user/actor ID jika aman;
- tenant/agency/module jika relevan;
- command ID/idempotency key;
- entity ID;
- previous state;
- attempted transition;
- error code;
- exception class;
- root cause;
- dependency name;
- duration/latency;
- retry attempt;
- final outcome;
- whether side effect may have occurred.

Contoh log buruk:

```text
Failed to process request
```

Contoh log lebih baik:

```json
{
  "level": "ERROR",
  "event": "APPLICATION_APPROVAL_FAILED",
  "correlationId": "c-123",
  "applicationId": "A-991",
  "actorId": "U-17",
  "previousState": "PENDING_REVIEW",
  "attemptedTransition": "APPROVE",
  "failureCategory": "PERSISTENCE",
  "failureCode": "DB_COMMIT_UNKNOWN",
  "dataMayHaveChanged": true,
  "resultUnknown": true,
  "retryable": false,
  "requiresReconciliation": true,
  "durationMs": 1840
}
```

Poin penting:

> Log bukan sekadar teks. Log adalah evidence untuk recovery dan accountability.

---

## 26. Severity: Jangan Semua Error Sama

Tidak semua error layak `ERROR` log dan alert.

### 26.1 Example Severity Model

| Severity | Contoh | Action |
|---|---|---|
| INFO | validation rejected | no alert |
| WARNING | external optional dependency degraded | monitor |
| ERROR | request failed due to DB timeout | alert if rate high |
| CRITICAL | data corruption/invariant breach | immediate incident |

### 26.2 Misclassification Problem

Jika semua validation error di-log sebagai ERROR:

- log noisy;
- alert fatigue;
- incident signal tenggelam.

Jika semua dependency failure hanya WARNING:

- outage terlambat diketahui.

Jika audit failure diabaikan:

- compliance evidence hilang.

Severity harus mengikuti impact, bukan hanya exception class.

---

## 27. Expected vs Unexpected

### 27.1 Expected Failure

Expected failure adalah bagian dari normal business/system behavior.

Contoh:

- validation error;
- unauthorized;
- not found;
- invalid state transition;
- duplicate idempotency key;
- optimistic locking conflict.

Expected failure biasanya tidak perlu stack trace besar.

### 27.2 Unexpected Failure

Unexpected failure adalah kondisi yang tidak seharusnya terjadi.

Contoh:

- null pada field yang invariant-nya wajib;
- enum state tidak dikenal;
- impossible transition;
- serialization gagal untuk object valid;
- database constraint mismatch dengan domain invariant;
- external response schema berubah;
- `OutOfMemoryError`.

Unexpected failure perlu evidence lebih kuat.

### 27.3 Expected Failure Bisa Menjadi Incident

Jika validation error rate tiba-tiba naik 500%, mungkin ada frontend bug atau abuse.

Jika 409 conflict naik drastis, mungkin ada concurrency issue.

Jika 401 naik drastis, mungkin auth provider bermasalah.

Jadi expected failure secara individual belum tentu incident, tetapi pattern agregatnya bisa menjadi incident.

---

## 28. Failure Policy by Category

| Category | Client Response | Retry | Alert | Notes |
|---|---|---|---|---|
| Validation | 400/422 | no | no | client-correctable |
| Authn | 401 | after refresh | rate monitor | avoid detail leak |
| Authz | 403 | no | suspicious rate | fail closed |
| Not Found | 404 | no | no | watch enumeration risk |
| Conflict | 409 | after reload | rate monitor | state/concurrency |
| Rate Limited | 429 | yes after delay | if systemic | include retry-after if safe |
| Dependency Timeout | 503/504 | bounded | yes by rate | circuit breaker |
| DB Deadlock | 503/409 depending context | bounded | if rate high | idempotency required |
| Capacity Exhaustion | 503 | no aggressive retry | yes | shed load |
| Invariant Violation | 500 | no | yes critical | bug/data corruption |
| Shutdown Draining | 503 | yes elsewhere | no unless prolonged | readiness false |
| Commit Unknown | 202/503/problem-specific | lookup only | yes | reconciliation |

---

## 29. Mindset: “Can It Fail Here?” Tidak Cukup

Pertanyaan “can it fail here?” terlalu dangkal.

Pertanyaan yang lebih baik:

1. **How can it fail?**
2. **What state exists immediately before failure?**
3. **What state may exist immediately after failure?**
4. **Who observes the failure?**
5. **Who does not observe it?**
6. **Can retry make it worse?**
7. **Can fallback lie?**
8. **Can shutdown interrupt it?**
9. **Can another pod process the same work?**
10. **Can the same command arrive twice?**
11. **Can the result be unknown?**
12. **Can evidence disappear?**
13. **Can this violate compliance/auditability?**
14. **Can this failure propagate?**
15. **What is the smallest safe containment boundary?**

---

## 30. Failure Analysis Template

Gunakan template ini untuk setiap flow penting.

```md
# Failure Analysis: <Flow Name>

## 1. Purpose
What business/system outcome must be true?

## 2. Critical Invariants
- Invariant 1
- Invariant 2

## 3. Side Effects
| Step | Side Effect | Durable? | Reversible? | Idempotent? |
|---|---|---|---|---|

## 4. Failure Points
| Step | Failure Mode | State Before | State After | Result Known? |
|---|---|---|---|---|

## 5. Classification
| Failure | Expected? | Retryable? | Client Correctable? | Operator Action? |
|---|---|---|---|---|

## 6. Containment
How do we prevent this failure from spreading?

## 7. Recovery
How do we restore correct state?

## 8. Observability
What logs, metrics, traces, audit records are required?

## 9. Shutdown Behavior
What happens if SIGTERM arrives during this flow?

## 10. Test Strategy
How do we prove the behavior?
```

Template ini akan dipakai ulang di part-part berikutnya.

---

## 31. Mini Case Study: External Address Lookup

Misalnya service memanggil external address provider.

### 31.1 Naive Thinking

```text
If provider fails, catch exception and return empty address.
```

Masalah:

- empty address bisa dianggap valid;
- user mungkin submit data salah;
- downstream workflow bisa memakai address kosong;
- failure provider tersembunyi.

### 31.2 Better Thinking

Classify:

| Failure | Classification | Response |
|---|---|---|
| invalid postal code | validation/domain | user corrects |
| provider 401 | auth/token failure | refresh token once |
| provider 403 | config/permission | alert operator |
| provider 429 | rate limited | throttle/backoff |
| provider timeout | transient/dependency | retry bounded/circuit |
| provider schema changed | contract drift | alert, fail visible |
| cache hit stale | degraded | only if business allows |

### 31.3 Reliability Design

- Exact-key cache for safe repeated lookup.
- Token cache with expiry awareness.
- 401 refresh only once per request path, not infinite loop.
- 429 client-side rate limiter.
- Timeout shorter than user request deadline.
- Circuit breaker per provider.
- Fallback to stale cache only if marked as stale and acceptable.
- Return explicit unavailable state if lookup is mandatory.
- Metric per failure category.
- Correlation ID across provider call.

---

## 32. Mini Case Study: Queue Worker During Shutdown

### 32.1 Naive Worker

```java
while (true) {
    Message msg = queue.poll();
    process(msg);
    queue.ack(msg);
}
```

Pertanyaan:

- Apa yang terjadi saat SIGTERM?
- Apakah loop berhenti polling?
- Jika `process` sedang berjalan, apakah diberi deadline?
- Jika process selesai tetapi ack gagal?
- Jika ack dilakukan sebelum process selesai?
- Jika worker dibunuh SIGKILL?

### 32.2 Better Lifecycle

```text
RUNNING
  ↓ SIGTERM
DRAINING
  - stop polling new messages
  - finish current message if within deadline
  - ack only after durable success
  - nack/requeue if cannot finish safely
  - flush metrics/logs
  ↓
STOPPED
```

### 32.3 Reliability Requirements

- message handler idempotent;
- processing deadline < termination grace period;
- stop accepting new work before closing dependencies;
- ack/nack semantics explicit;
- long-running job checkpoint;
- duplicate delivery safe;
- shutdown duration metric.

---

## 33. Checklist Part 001

Sebelum lanjut ke exception taxonomy dan graceful shutdown detail, pastikan kamu sudah bisa menjawab checklist ini.

### 33.1 Concept Checklist

- [ ] Saya bisa membedakan bug, fault, error, failure, incident, outage.
- [ ] Saya paham exception bukan selalu failure.
- [ ] Saya paham failure tidak selalu muncul sebagai exception.
- [ ] Saya bisa menganalisis side effect sebelum/selama/sesudah failure.
- [ ] Saya bisa melihat failure sebagai state transition.
- [ ] Saya bisa mengidentifikasi hidden failure dan misleading success.
- [ ] Saya bisa memperkirakan blast radius.
- [ ] Saya bisa membedakan prevent, detect, contain, recover, learn.
- [ ] Saya bisa menilai retry/fallback sebagai trade-off, bukan default solution.
- [ ] Saya bisa menulis failure analysis sederhana untuk satu flow.

### 33.2 Design Checklist

- [ ] Setiap command penting punya idempotency strategy.
- [ ] Setiap side effect punya failure semantics.
- [ ] Setiap external call punya timeout.
- [ ] Setiap retry punya limit, backoff, dan classification.
- [ ] Setiap fallback punya business justification.
- [ ] Setiap unexpected failure observable.
- [ ] Setiap audit/compliance failure tidak silent.
- [ ] Setiap worker punya shutdown behavior.
- [ ] Setiap API error punya stable error code.
- [ ] Setiap partial failure punya recovery path.

---

## 34. Review Questions

Jawab pertanyaan ini untuk menguji pemahaman.

### 34.1 Basic

1. Apa bedanya error dan failure?
2. Mengapa `UserNotFoundException` belum tentu failure sistem?
3. Berikan contoh failure tanpa exception.
4. Berikan contoh exception tanpa incident.
5. Mengapa `catch and log` belum tentu error handling?

### 34.2 Intermediate

6. Apa risiko retry tanpa idempotency?
7. Apa bedanya fallback dan misleading success?
8. Mengapa timeout adalah reliability contract?
9. Apa itu commit unknown?
10. Mengapa audit failure bisa lebih serius daripada API 500 biasa?

### 34.3 Advanced

11. Buat failure state machine untuk flow approval.
12. Jelaskan bagaimana DB slow bisa menyebabkan cascading failure.
13. Jelaskan kapan fail-open bisa diterima dan kapan berbahaya.
14. Jelaskan bagaimana shutdown bisa menyebabkan duplicate processing.
15. Jelaskan evidence apa yang dibutuhkan untuk memperbaiki partial failure.

---

## 35. Key Takeaways

1. Exception adalah mekanisme bahasa; failure adalah pelanggaran ekspektasi sistem.
2. Tidak semua exception adalah failure, dan tidak semua failure menghasilkan exception.
3. Failure harus dianalisis sebagai state transition.
4. State paling berbahaya adalah partial, unknown, duplicate, corrupted, dan misleading success.
5. Reliability adalah control loop: prevent, detect, contain, recover, learn.
6. Retry, fallback, timeout, circuit breaker, dan graceful shutdown bukan magic pattern; semuanya adalah trade-off.
7. Error handling yang baik mempertahankan semantic signal, state knowledge, dan recovery path.
8. Observability bukan tambahan; observability adalah syarat agar failure bisa dipahami.
9. Untuk sistem regulatory, auditability dan defensibility adalah bagian dari reliability.
10. Engineer top-tier tidak hanya bertanya “exception apa yang dicatch?”, tetapi “state apa yang mungkin terjadi dan tindakan aman apa berikutnya?”

---

## 36. What Comes Next

Part berikutnya:

```text
Part 002 — Java Exception Semantics Deep Dive
```

Di part berikutnya kita akan masuk ke detail Java:

- `Throwable`;
- `Exception`;
- `RuntimeException`;
- `Error`;
- checked vs unchecked exception;
- stack trace;
- cause chain;
- suppressed exception;
- try-with-resources;
- exception transparency;
- exception wrapping;
- kapan catch, rethrow, translate, atau terminate.

---

## 37. Series Progress

```text
Part 001 / 030 completed.
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-reliability-part-000.md](./learn-java-reliability-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-002.md](./learn-java-reliability-part-002.md)

</div>