# Part 1 — Mental Model: Runtime Evidence, Not Just Logging

**Series:** `learn-java-logging-observability-profiling-troubleshooting-engineering`  
**File:** `01-runtime-evidence-not-just-logging.md`  
**Target:** Java 8 sampai Java 25  
**Level:** Advanced / Staff+ Engineering Foundation  
**Status seri:** Belum selesai — ini Part 1 dari rencana 35 part.

---

## 0. Tujuan Part Ini

Bagian ini membangun fondasi berpikir sebelum masuk ke SLF4J, Logback, Log4j2, OpenTelemetry, JFR, profiler, dump, dan troubleshooting tools.

Topik ini sering disalahpahami karena banyak engineer memulai dari pertanyaan seperti:

- “Bagaimana cara konfigurasi Logback?”
- “Bagaimana cara menambahkan trace id?”
- “Bagaimana cara pakai OpenTelemetry?”
- “Bagaimana cara ambil thread dump?”
- “Bagaimana cara baca flame graph?”

Pertanyaan itu valid, tetapi belum cukup dalam. Pertanyaan yang lebih kuat adalah:

> **Ketika sistem produksi gagal, bukti runtime apa yang harus tersedia agar kita bisa memahami kejadian secara cepat, akurat, dan defensible?**

Logging, observability, profiling, dan troubleshooting bukan sekadar kumpulan tool. Mereka adalah sistem untuk mengubah perilaku runtime yang kompleks menjadi bukti yang bisa dianalisis.

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan log, metric, trace, profile, dump, audit event, dan runtime event.
2. Memahami kenapa “banyak log” tidak sama dengan sistem yang observable.
3. Mendesain event runtime berdasarkan pertanyaan diagnosis, bukan berdasarkan kebiasaan `logger.info()`.
4. Menghubungkan observability dengan architecture, reliability, security, compliance, dan incident response.
5. Membaca sistem Java produksi sebagai **evidence graph**, bukan hanya sebagai source code.
6. Mengembangkan standar berpikir yang akan dipakai sepanjang seri.

---

## 1. Premis Utama: Software Production Tidak Bisa Dipahami dari Source Code Saja

Source code menjelaskan apa yang **mungkin** dilakukan sistem.

Runtime evidence menjelaskan apa yang **benar-benar** terjadi.

Di sistem enterprise, perbedaan ini sangat besar.

Satu endpoint Java mungkin terlihat sederhana:

```java
@PostMapping("/applications/{id}/approve")
public ResponseEntity<Void> approve(@PathVariable Long id) {
    applicationService.approve(id);
    return ResponseEntity.ok().build();
}
```

Tetapi saat berjalan di produksi, endpoint itu bisa melibatkan:

- authentication context,
- authorization rule,
- validation,
- database transaction,
- optimistic locking,
- workflow state transition,
- audit trail,
- document generation,
- email notification,
- external API call,
- message queue,
- retry,
- async listener,
- cache invalidation,
- observability instrumentation,
- container CPU throttling,
- garbage collection,
- connection pool contention,
- network latency,
- deployment version,
- configuration drift.

Source code bisa memberi model statis. Tetapi masalah produksi biasanya muncul dari interaksi runtime:

- traffic berubah,
- data berubah,
- dependency lambat,
- thread pool penuh,
- connection pool habis,
- cache menjadi stale,
- retry memperparah beban,
- GC mulai dominan,
- log terlalu noisy,
- trace sampling tidak menangkap error,
- metric memiliki label cardinality terlalu tinggi,
- sebuah instance berbeda konfigurasi dari instance lain.

Maka top-tier engineer tidak hanya bertanya:

> “Code mana yang salah?”

Tetapi bertanya:

> “Apa bukti bahwa sistem bergerak dari state sehat ke state gagal, lewat jalur sebab-akibat apa, dan bagian mana yang paling mungkin menjadi leverage point untuk mitigasi?”

---

## 2. Logging Bukan Observability

Logging adalah salah satu signal. Observability adalah kemampuan sistem untuk menjelaskan internal state-nya dari external output yang tersedia.

Kesalahan umum:

> “Kita sudah punya log, berarti sistem sudah observable.”

Belum tentu.

Sistem bisa punya jutaan log per hari tetapi tetap sulit didiagnosis jika:

- tidak ada correlation id,
- log tidak structured,
- log message tidak konsisten,
- error log tidak punya cause,
- log level kacau,
- request body penuh PII,
- exception dilog berkali-kali,
- tidak ada trace id,
- tidak ada metric latency,
- tidak ada metric queue depth,
- tidak ada metric connection pool,
- tidak ada informasi version/deployment,
- tidak bisa membedakan user error vs system error,
- tidak bisa membedakan expected retry vs unexpected failure,
- tidak ada timestamp konsisten,
- tidak ada tenant/module/case identifier,
- log ingestion delay,
- log hilang ketika pod restart,
- async flow tidak terhubung ke request awal.

Observability yang baik bukan “semua hal dicetak ke log”. Observability yang baik berarti sistem menghasilkan **signal yang cukup, relevan, aman, murah, dan dapat dikorelasikan** untuk menjawab pertanyaan operasional.

---

## 3. Runtime Evidence: Definisi Kerja

Dalam seri ini, kita akan memakai istilah **runtime evidence**.

Runtime evidence adalah semua artefak yang dihasilkan atau ditangkap saat aplikasi berjalan, yang bisa digunakan untuk memahami perilaku, performa, kegagalan, dampak, dan sebab-akibat sistem.

Contoh runtime evidence:

| Evidence | Bentuk | Pertanyaan yang Dijawab |
|---|---|---|
| Log | Event tekstual/structured | Apa yang terjadi di titik tertentu? |
| Metric | Time-series numeric | Apakah kondisi memburuk? Seberapa besar? |
| Trace | Distributed causal path | Request ini melewati service/operation apa saja? |
| Span | Unit kerja dalam trace | Operasi mana yang lambat/error? |
| Profile | Sampling runtime cost | CPU/allocation/lock time habis di mana? |
| Thread dump | Snapshot thread state | Thread sedang blocked/waiting/runnable di mana? |
| Heap dump | Snapshot object graph | Memory ditahan oleh object apa? |
| GC log/JFR GC event | Memory lifecycle event | Apakah GC memengaruhi latency/throughput? |
| JFR event | JVM/runtime event stream | Apa yang terjadi di JVM dengan overhead rendah? |
| Audit trail | Business/legal event | Siapa melakukan apa, kapan, dan atas objek apa? |
| Deployment metadata | Runtime version/config | Apakah issue terkait change tertentu? |
| System/kernel/container metric | Infra runtime state | Apakah app dibatasi CPU/memory/network? |

Top-tier engineer tidak melihat evidence ini sebagai data terpisah. Mereka menggabungkannya menjadi graph:

```text
User action
  -> HTTP request
    -> service method
      -> DB transaction
        -> row lock wait
      -> external API call timeout
      -> retry storm
    -> thread pool saturation
    -> latency p99 spike
    -> error rate increase
    -> alert fires
    -> incident response
```

Inilah yang kita sebut **Evidence Graph**.

---

## 4. Evidence Graph: Cara Membaca Sistem Produksi

Evidence Graph adalah model mental untuk menghubungkan event runtime.

Bukan hanya:

```text
ERROR Something failed
```

Tetapi:

```text
At 10:03:21
service=case-management
version=2026.06.18-rc2
env=prod
trace_id=abc
correlation_id=case-approval-789
user_role=officer
module=application-approval
operation=approveApplication

HTTP request started
  -> validation passed
  -> state transition requested DRAFT -> APPROVED
  -> DB transaction started
  -> query application_by_id took 12ms
  -> update application_state blocked 4.8s on row lock
  -> transaction timeout
  -> rollback
  -> user got 500
  -> retry happened
  -> DB pool active=50/50
  -> p99 latency increased
```

Dengan model ini, log bukan lagi catatan acak. Log menjadi edge dan node dalam graph kejadian.

Evidence Graph yang baik memiliki beberapa properti:

1. **Identity** — event bisa dihubungkan dengan request/user/case/tenant/job/trace.
2. **Ordering** — event bisa disusun dalam timeline.
3. **Causality** — event bisa menunjukkan hubungan sebab-akibat, bukan sekadar kedekatan waktu.
4. **Context** — event membawa informasi cukup untuk dipahami tanpa membuka source code setiap saat.
5. **Outcome** — event menunjukkan apakah operasi sukses, gagal, retry, timeout, partial, atau compensated.
6. **Cost awareness** — evidence tidak membuat sistem overload.
7. **Safety** — evidence tidak membocorkan PII, secret, atau data sensitif.
8. **Queryability** — evidence bisa dicari, difilter, diagregasi, dan dikorelasikan.
9. **Defensibility** — evidence cukup kuat untuk audit, postmortem, RCA, atau dispute.

---

## 5. Empat Level Kedewasaan Engineer dalam Logging dan Observability

### Level 1 — Print-Oriented Engineer

Ciri:

```java
System.out.println("masuk sini");
System.out.println("data = " + data);
```

Masalah:

- tidak ada level,
- tidak ada correlation,
- tidak ada structured field,
- tidak ada control runtime,
- raw data bisa bocor,
- sulit di-query,
- tidak cocok untuk produksi.

Level ini umum di tahap belajar, tetapi berbahaya jika terbawa ke production engineering.

---

### Level 2 — Logger-Oriented Engineer

Ciri:

```java
log.info("Approve application {}", applicationId);
log.error("Failed to approve", e);
```

Lebih baik karena sudah memakai framework logging, tetapi masih terbatas.

Masalah yang sering ada:

- message tidak konsisten,
- log level tidak disiplin,
- error terlalu umum,
- tidak ada event name,
- tidak ada key-value context,
- tidak ada trace/correlation id,
- log tidak menjawab pertanyaan incident.

---

### Level 3 — Observability-Oriented Engineer

Ciri:

Engineer mulai berpikir dalam signal:

- log untuk discrete event,
- metric untuk trend dan alert,
- trace untuk causal path,
- profile untuk cost attribution,
- dump untuk snapshot state,
- audit untuk accountability.

Contoh:

```java
log.atInfo()
   .setMessage("Application approval completed")
   .addKeyValue("event", "application.approval.completed")
   .addKeyValue("applicationId", applicationId)
   .addKeyValue("previousState", previousState)
   .addKeyValue("newState", newState)
   .addKeyValue("durationMs", durationMs)
   .log();
```

Engineer level ini tidak hanya menambahkan log, tetapi mendesain event.

---

### Level 4 — Evidence-Oriented / Incident-Ready Engineer

Ciri:

Engineer mendesain sistem agar ketika gagal, bukti sudah tersedia.

Pertanyaan yang dipikirkan sebelum coding:

- Kalau operasi ini gagal, bagaimana kita tahu penyebabnya?
- Kalau lambat, bagaimana kita tahu lambat di layer mana?
- Kalau user dispute, bagaimana kita tahu state transition yang benar?
- Kalau dependency timeout, bagaimana kita tahu retry memperbaiki atau memperparah?
- Kalau queue backlog, bagaimana kita tahu producer terlalu cepat atau consumer terlalu lambat?
- Kalau DB pool penuh, bagaimana kita tahu leak atau slow query?
- Kalau memory naik, bagaimana kita tahu cache, allocation spike, atau leak?
- Kalau incident terjadi hanya di satu tenant, bagaimana kita filter evidence?
- Kalau log volume naik 10x, apakah sistem tetap aman?

Ini level yang akan kita bangun sepanjang seri.

---

## 6. Perbedaan Signal Utama

### 6.1 Log

Log adalah catatan event diskrit.

Cocok untuk:

- state transition,
- external call outcome,
- exception,
- retry,
- security-relevant event,
- business operation,
- audit-supporting diagnostic event,
- lifecycle event,
- unusual condition.

Tidak cocok untuk:

- menghitung request rate secara akurat,
- alert utama untuk latency,
- profiling CPU,
- mencari memory leak,
- menggantikan metric time-series.

Contoh event log yang baik:

```json
{
  "timestamp": "2026-06-18T10:15:30.123Z",
  "level": "INFO",
  "service": "application-service",
  "env": "prod",
  "event": "application.approval.completed",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "correlation_id": "approval-20260618-000123",
  "application_id": "APP-123",
  "previous_state": "PENDING_REVIEW",
  "new_state": "APPROVED",
  "duration_ms": 184,
  "outcome": "success"
}
```

---

### 6.2 Metric

Metric adalah angka yang berubah terhadap waktu.

Cocok untuk:

- alert,
- trend,
- capacity planning,
- SLI/SLO,
- rate,
- latency distribution,
- saturation,
- error ratio,
- queue depth,
- pool usage.

Contoh:

```text
http.server.request.duration{service="application-service", route="POST /applications/{id}/approve"}

hikaricp.connections.active{pool="main"}

jvm.memory.used{area="heap"}

application.approval.count{outcome="success"}
```

Metric unggul untuk pertanyaan:

- Apakah masalah sedang terjadi sekarang?
- Kapan mulai terjadi?
- Apakah memburuk?
- Seberapa besar dampaknya?
- Apakah semua instance terkena?
- Apakah error rate naik setelah deployment?

Metric buruk untuk pertanyaan:

- Request tertentu gagal kenapa?
- Exception stack trace-nya apa?
- User tertentu mengalami path apa?

---

### 6.3 Trace

Trace adalah representasi causal path dari satu operasi yang bisa melewati banyak service/layer.

Trace terdiri dari span.

Contoh:

```text
Trace: approve application
  Span: HTTP POST /applications/{id}/approve
    Span: ApplicationService.approve
      Span: SELECT application
      Span: UPDATE application
      Span: POST notification-service /email
      Span: publish audit event
```

Trace unggul untuk:

- distributed request path,
- latency breakdown,
- dependency call chain,
- retry visualization,
- service dependency graph,
- identifying slow span.

Trace kurang cocok untuk:

- aggregate alert tanpa metric,
- full forensic audit,
- high-volume body logging,
- profiling CPU internal method detail.

---

### 6.4 Profile

Profile menjawab pertanyaan:

> Runtime cost habis di mana?

Jenis profile:

- CPU profile,
- wall-clock profile,
- allocation profile,
- lock profile,
- native memory profile,
- IO profile.

Trace bisa bilang:

```text
ApplicationService.approve took 8 seconds
```

Profile bisa bilang:

```text
65% CPU spent in JSON serialization
18% CPU spent in regex validation
10% CPU spent in security expression evaluation
```

Atau:

```text
Most allocation comes from building debug log message objects
```

Profiling bukan pengganti logging. Profiling menjelaskan cost, bukan business semantics.

---

### 6.5 Dump

Dump adalah snapshot.

Thread dump menjawab:

- thread sedang apa,
- blocked di mana,
- waiting di mana,
- deadlock ada atau tidak,
- pool exhaustion terjadi atau tidak.

Heap dump menjawab:

- object apa yang menahan memory,
- siapa dominator,
- apa GC root,
- apakah ada cache leak,
- apakah ThreadLocal leak,
- apakah classloader leak.

Dump sangat detail tetapi berat dan point-in-time. Dump biasanya dipakai saat incident atau deep investigation, bukan sebagai signal utama harian.

---

### 6.6 JFR Event

Java Flight Recorder menyediakan event runtime dari JVM dengan overhead rendah, seperti:

- allocation,
- GC,
- thread park,
- monitor enter,
- socket read/write,
- file IO,
- exception,
- execution sample,
- class loading,
- safepoint,
- compiler event.

JFR sangat penting karena ia berada dekat dengan JVM, bukan hanya aplikasi. Ia bisa mengisi gap antara log aplikasi dan profiler eksternal.

---

### 6.7 Audit Event

Audit event berbeda dari application log.

Audit event menjawab:

- siapa,
- melakukan apa,
- atas objek apa,
- kapan,
- dari mana,
- berdasarkan otorisasi apa,
- perubahan sebelum/sesudah apa,
- apakah berhasil/gagal,
- apakah event dapat dipertanggungjawabkan.

Audit event harus lebih stabil, lebih aman, dan lebih defensible daripada diagnostic log.

Contoh buruk:

```text
INFO user updated application
```

Contoh lebih baik:

```json
{
  "event": "audit.application.state_changed",
  "actor_id": "U12345",
  "actor_type": "officer",
  "application_id": "APP-123",
  "previous_state": "PENDING_REVIEW",
  "new_state": "APPROVED",
  "decision_reason_code": "MEETS_REQUIREMENTS",
  "timestamp": "2026-06-18T10:15:30.123Z",
  "source_ip_hash": "...",
  "outcome": "success"
}
```

Diagnostic log boleh berubah seiring kebutuhan engineer. Audit event harus dikendalikan sebagai bagian dari business/legal contract.

---

## 7. Pertanyaan yang Harus Bisa Dijawab Sistem Produksi

Sistem yang observable harus bisa menjawab pertanyaan berikut tanpa panic debugging.

### 7.1 Pertanyaan Saat Error Spike

1. Error mulai kapan?
2. Error terjadi di semua instance atau instance tertentu?
3. Error terjadi untuk semua tenant/user/module atau subset tertentu?
4. Error terkait deployment/configuration change?
5. Error berasal dari application code, DB, external API, queue, auth, atau infra?
6. Error retriable atau non-retriable?
7. Error menghasilkan rollback, partial commit, atau inconsistent state?
8. Berapa banyak user/request/case terdampak?
9. Apakah retry memperburuk kondisi?
10. Apakah mitigation bisa dilakukan lewat config/traffic shaping/restart/scale?

---

### 7.2 Pertanyaan Saat Latency Spike

1. p50, p95, p99 naik semua atau hanya tail latency?
2. Endpoint mana yang paling terdampak?
3. Span mana yang lambat?
4. Apakah lambat di DB, external API, lock, queue, serialization, GC, CPU, atau thread pool?
5. Apakah latency naik sebelum error rate naik?
6. Apakah ada saturation?
7. Apakah hanya terjadi di traffic tertentu?
8. Apakah ada cold start, cache miss, or deployment warming issue?
9. Apakah timeout terlalu panjang sehingga thread tertahan?
10. Apakah backpressure bekerja?

---

### 7.3 Pertanyaan Saat Memory Naik

1. Heap, non-heap, direct memory, atau native memory?
2. Allocation rate naik atau retention naik?
3. GC frequency naik?
4. Old generation naik terus setelah full/concurrent GC?
5. Object dominator terbesar apa?
6. Apakah ada cache unbounded?
7. Apakah ThreadLocal tidak dibersihkan?
8. Apakah buffer/direct memory leak?
9. Apakah log/trace/exporter buffering terlalu besar?
10. Apakah ada perubahan traffic/data shape?

---

### 7.4 Pertanyaan Saat Thread Pool Penuh

1. Pool mana yang penuh?
2. Active thread sedang RUNNABLE, BLOCKED, WAITING, atau TIMED_WAITING?
3. Waiting pada DB connection, lock, HTTP response, queue, atau sleep/backoff?
4. Task masuk lebih cepat dari kapasitas proses?
5. Ada blocking call di event loop/reactive pipeline?
6. Ada nested async call yang menunggu pool yang sama?
7. Ada retry storm?
8. Ada deadlock atau lock convoy?
9. Timeout dan queue capacity sudah benar?
10. Apakah virtual thread membantu atau hanya menyembunyikan bottleneck dependency?

---

### 7.5 Pertanyaan Saat External Dependency Bermasalah

1. Dependency mana yang lambat/error?
2. Connect timeout atau read timeout?
3. DNS problem atau server problem?
4. Error 4xx, 5xx, timeout, reset, TLS, rate limit?
5. Retry policy aktif?
6. Circuit breaker terbuka?
7. Fallback aktif?
8. Berapa request terdampak?
9. Apakah ada correlation id lintas sistem?
10. Apakah ada idempotency key untuk retry aman?

---

## 8. Runtime Evidence dan Golden Signals

Dalam Site Reliability Engineering, empat signal klasik yang sering dipakai adalah:

1. **Latency** — berapa lama request/operation berjalan.
2. **Traffic** — berapa banyak demand ke sistem.
3. **Errors** — berapa banyak request/operation gagal.
4. **Saturation** — seberapa penuh resource yang digunakan.

Untuk Java backend, ini bisa diterjemahkan menjadi:

| Golden Signal | Java/System Evidence |
|---|---|
| Latency | HTTP duration, DB query duration, queue processing time, GC pause, lock wait |
| Traffic | request rate, message rate, job rate, DB query rate |
| Errors | exception count, HTTP 5xx, failed job, rejected task, timeout count |
| Saturation | CPU, heap, GC pressure, thread pool active, DB pool active, queue depth, connection backlog |

Latency sering menjadi leading indicator dari saturation. Misalnya DB pool belum timeout, tetapi acquisition time sudah naik. Jika metric ini tersedia, kita bisa mitigasi sebelum error spike.

Namun golden signals saja belum cukup. Untuk aplikasi enterprise/regulatory, kita juga butuh:

- correctness signal,
- state transition signal,
- auditability signal,
- security signal,
- data consistency signal,
- workflow backlog signal,
- tenant/module blast-radius signal.

---

## 9. Engineering Invariant untuk Runtime Evidence

Sepanjang seri ini, kita akan memakai beberapa invariant.

### Invariant 1 — Every Important Runtime Event Must Have Identity

Event penting harus bisa dikaitkan dengan identitas yang relevan.

Minimal:

- service,
- environment,
- version,
- timestamp,
- trace id/correlation id,
- operation,
- outcome.

Untuk domain enterprise:

- module,
- tenant/agency,
- user/actor,
- case/application id,
- job execution id,
- message id.

Tanpa identity, event menjadi orphan.

---

### Invariant 2 — Every Failure Must Have Context, Cause, and Outcome

Log error yang buruk:

```java
log.error("Error occurred");
```

Lebih buruk:

```java
log.error(e.getMessage());
```

Lebih baik:

```java
log.error("Failed to approve application. applicationId={}, currentState={}, targetState={}",
        applicationId, currentState, targetState, e);
```

Lebih baik lagi jika structured:

```java
log.atError()
   .setMessage("Application approval failed")
   .addKeyValue("event", "application.approval.failed")
   .addKeyValue("applicationId", applicationId)
   .addKeyValue("currentState", currentState)
   .addKeyValue("targetState", targetState)
   .addKeyValue("errorCategory", "database_timeout")
   .addKeyValue("outcome", "rolled_back")
   .setCause(e)
   .log();
```

Failure event harus menjawab:

1. Operasi apa?
2. Input/domain object apa?
3. State sebelumnya apa?
4. Dependency apa?
5. Cause teknis apa?
6. Outcome akhirnya apa?
7. Aman untuk retry atau tidak?

---

### Invariant 3 — Evidence Must Be Queryable

Kalau event hanya bisa dibaca manual satu-satu, itu tidak cukup.

Evidence harus bisa menjawab query:

```text
Tampilkan semua application.approval.failed
untuk agency=CEA
antara 10:00 sampai 10:15
pada version=2026.06.18-rc2
yang errorCategory=database_timeout
urutkan berdasarkan duration_ms desc
```

Agar bisa begitu, log harus structured dan punya field konsisten.

---

### Invariant 4 — Evidence Must Be Correlatable

Log, metric, trace, profile, dump, dan deployment metadata harus bisa saling menunjuk.

Contoh korelasi:

- metric `http.server.duration p99` naik,
- trace menunjukkan span DB lambat,
- log menunjukkan connection acquisition timeout,
- Hikari metric menunjukkan active connection 50/50,
- thread dump menunjukkan banyak thread waiting di `HikariPool.getConnection`,
- DB metric menunjukkan lock wait,
- deployment metadata menunjukkan CR baru mengubah query.

Tanpa korelasi, setiap tool memberi fragmen puzzle tanpa gambar utuh.

---

### Invariant 5 — Evidence Must Be Safe

Jangan mengorbankan security demi diagnosability.

Tidak boleh sembarang log:

- password,
- access token,
- refresh token,
- authorization header,
- session cookie,
- full NRIC/NIK/passport,
- full address,
- raw request body berisi PII,
- secret config,
- private key,
- database credential,
- personal health/legal data.

Safe evidence berarti:

- masking,
- hashing,
- tokenization,
- allowlist field,
- classification,
- retention control,
- access control,
- audit access to logs.

---

### Invariant 6 — Evidence Has Cost

Setiap signal punya biaya:

- CPU,
- memory,
- allocation,
- lock contention,
- disk IO,
- network IO,
- collector cost,
- storage cost,
- query cost,
- cognitive cost.

Logging semua request body mungkin membantu sekali saat debugging, tetapi bisa:

- memperlambat request,
- memenuhi disk,
- memperbesar cloud log cost,
- membocorkan PII,
- menambah GC pressure,
- membuat log penting tenggelam.

Top-tier engineer tidak mencari evidence maksimum. Mereka mencari evidence optimal.

---

### Invariant 7 — Evidence Must Survive Real Failure Modes

Observability yang hanya bekerja saat sistem sehat tidak cukup.

Pertanyaan:

- Jika pod crash, apakah log terakhir hilang?
- Jika collector down, apakah aplikasi ikut lambat?
- Jika log volume spike, apakah appender blocking?
- Jika queue exporter penuh, apakah memory naik?
- Jika disk full karena log, apakah aplikasi mati?
- Jika trace backend down, apakah request user tetap berjalan?
- Jika sampling terlalu agresif, apakah error trace tetap tersimpan?

Observability subsystem juga bisa menjadi sumber incident.

---

## 10. Anti-Pattern Besar

### 10.1 Log Everything

Terdengar aman, tetapi salah.

Dampak:

- noise tinggi,
- biaya tinggi,
- PII risk,
- sulit mencari signal,
- performance turun,
- storage cepat penuh,
- incident malah makin sulit.

Lebih baik:

> Log important events with useful context, consistent schema, and controlled cardinality.

---

### 10.2 Log Nothing Until Incident

Ini kebalikan ekstrem.

Dampak:

- incident buta,
- perlu redeploy hanya untuk menambah log,
- root cause hilang,
- tidak bisa membuktikan impact,
- postmortem spekulatif.

Lebih baik:

> Desain baseline evidence sejak development, lalu tambah dynamic debugging jika perlu.

---

### 10.3 Error Without Cause

Buruk:

```text
ERROR Approval failed
```

Tidak menjawab:

- kenapa gagal,
- object apa,
- dependency apa,
- user mendapat apa,
- transaction rollback atau tidak.

---

### 10.4 Stack Trace Spam

Satu exception bisa dilog di controller, service, repository, global handler, async listener, dan retry handler.

Dampak:

- error count palsu,
- log membengkak,
- sulit tahu root event,
- alert noisy.

Rule awal:

> Log exception stack trace di boundary yang memiliki context dan ownership terbaik. Layer bawah boleh menambah context dengan wrapping, tetapi jangan semua layer melakukan `log.error(..., e)`.

---

### 10.5 Business Event Dicampur dengan Diagnostic Noise

Audit/business event harus stabil. Diagnostic event boleh berubah.

Jangan menjadikan diagnostic log sebagai satu-satunya sumber audit.

---

### 10.6 No Correlation Across Async Boundary

Request awal punya trace id, tetapi message consumer tidak punya correlation id.

Akibat:

- user action tidak bisa dilacak ke queue,
- retry tidak bisa dipahami,
- DLQ tidak bisa dikaitkan ke original request,
- RCA menjadi spekulatif.

---

### 10.7 Observability as Tool Installation

Menginstall Prometheus, Grafana, ELK, OpenTelemetry Collector, atau APM vendor tidak otomatis membuat sistem observable.

Tool hanya storage dan visualization. Yang menentukan kualitas adalah:

- signal design,
- instrumentation boundary,
- context propagation,
- schema,
- cardinality control,
- alert design,
- incident workflow.

---

## 11. Cara Mendesain Evidence dari Use Case

Ambil contoh use case:

> Officer menyetujui application.

Jangan mulai dari “tambahkan log apa?”. Mulai dari pertanyaan diagnosis.

### 11.1 Business Questions

1. Siapa officer-nya?
2. Application apa?
3. State awal apa?
4. State akhir apa?
5. Apakah approval berhasil?
6. Jika gagal, apakah ada perubahan yang ter-commit?
7. Apakah email terkirim?
8. Apakah audit trail tercatat?
9. Apakah notification async sukses?
10. Apakah user melihat response sukses/gagal?

### 11.2 Technical Questions

1. Endpoint apa yang dipanggil?
2. Berapa latency total?
3. Berapa latency DB?
4. Query mana yang lambat?
5. Apakah lock terjadi?
6. Apakah external API timeout?
7. Apakah retry terjadi?
8. Apakah thread pool penuh?
9. Apakah transaction rollback?
10. Apakah exception expected atau unexpected?

### 11.3 Evidence Design

| Boundary | Evidence |
|---|---|
| HTTP entry | request started/completed log, HTTP metric, server span |
| Authorization | denied event if failed, security metric |
| Service operation | business operation span, state transition log |
| DB | DB span, slow query metric/log, transaction outcome |
| External notification | client span, dependency metric, retry log |
| Queue publish | producer span, message id log |
| Audit | audit event, immutable domain event |
| Error boundary | structured error log, exception cause |

### 11.4 Example Evidence Timeline

```text
10:00:00.000 request.started
10:00:00.010 authorization.allowed
10:00:00.020 application.approval.started
10:00:00.030 db.application.loaded
10:00:00.050 state.transition.validated
10:00:00.080 db.application.updated
10:00:00.100 audit.event.persisted
10:00:00.120 notification.email.publish.succeeded
10:00:00.130 application.approval.completed
10:00:00.132 request.completed
```

Jika gagal:

```text
10:00:00.000 request.started
10:00:00.010 authorization.allowed
10:00:00.020 application.approval.started
10:00:00.030 db.application.loaded
10:00:05.030 db.lock.timeout
10:00:05.035 transaction.rolled_back
10:00:05.036 application.approval.failed
10:00:05.040 request.failed
```

Ini jauh lebih berguna daripada:

```text
INFO approve called
ERROR failed
```

---

## 12. Runtime Evidence untuk Java 8 sampai Java 25

Materi seri ini mencakup Java 8 sampai 25. Perubahan penting dari perspektif observability:

### 12.1 Java 8 Era

Ciri umum:

- platform thread dominan,
- JFR awalnya terkait Oracle JDK/commercial context sebelum perubahan di era berikutnya,
- banyak aplikasi memakai Logback + SLF4J 1.x,
- GC logging masih format lama,
- container awareness belum sematang JDK modern,
- thread dump relatif mudah dibaca karena jumlah thread biasanya lebih kecil dibanding virtual-thread-heavy workloads.

Observability challenge:

- legacy logging config,
- mixed logging framework,
- old app server classloader,
- missing context propagation,
- manual instrumentation lebih banyak.

---

### 12.2 Java 11 Era

Ciri umum:

- LTS modern pertama setelah Java 8,
- JFR tersedia secara lebih umum di OpenJDK era modern,
- unified JVM logging mulai umum,
- container support lebih matang,
- banyak organisasi migrasi dari Java 8.

Observability challenge:

- migrasi GC log parser,
- dependency compatibility,
- mixed Java 8/11 fleet,
- old agents vs module system.

---

### 12.3 Java 17 Era

Ciri umum:

- LTS sangat umum untuk Spring Boot 3 generation,
- stronger encapsulation,
- modern JFR/JMC usage,
- better container runtime assumptions,
- mature G1 default, ZGC options berkembang.

Observability challenge:

- agent compatibility dengan module encapsulation,
- illegal reflective access lama,
- structured logging lebih umum,
- tracing lebih sering auto-instrumented.

---

### 12.4 Java 21 Era

Ciri umum:

- virtual threads menjadi stable,
- structured concurrency masih preview/incubator pada beberapa rilis,
- sequenced collections dan modern runtime features,
- banyak framework mulai mendukung virtual threads.

Observability challenge:

- jumlah thread bisa sangat besar,
- thread dump berubah cara dibaca,
- MDC berbasis ThreadLocal perlu dipahami ulang,
- blocking call tidak lagi selalu berarti thread pool exhaustion, tetapi dependency saturation tetap nyata,
- profiling virtual-thread workloads butuh kehati-hatian.

---

### 12.5 Java 25 Era

Ciri umum:

- Java 25 adalah LTS berikutnya setelah Java 21.
- Banyak fitur modern concurrency dan runtime observability semakin matang.
- Scoped Values menjadi bagian penting untuk context sharing yang lebih aman dibanding ThreadLocal pada model modern.

Observability challenge:

- memilih antara ThreadLocal, MDC, OpenTelemetry Context, dan Scoped Values,
- memahami interaction virtual threads + structured concurrency + logging context,
- memastikan tools/profilers/agents mendukung runtime modern,
- menjaga compatibility dengan fleet lama Java 8/11.

---

## 13. Evidence Boundary dalam Aplikasi Java

Aplikasi Java enterprise biasanya memiliki beberapa boundary penting.

### 13.1 Process Boundary

Saat aplikasi start/stop:

- service name,
- version,
- commit hash,
- build time,
- Java version,
- JVM flags,
- active profile,
- config source,
- hostname/pod name,
- instance id,
- OpenTelemetry config,
- logging backend,
- GC selected.

Startup log yang baik sangat membantu ketika ada configuration drift.

Contoh:

```text
service.starting service=case-service version=2026.06.18 commit=abc123 java=21.0.7 gc=ZGC env=prod
```

---

### 13.2 Request Boundary

HTTP request boundary:

- request started,
- request completed,
- method,
- route template,
- status,
- duration,
- trace id,
- request id,
- user/tenant jika aman,
- response classification.

Hindari route raw dengan ID sebagai metric label:

Buruk:

```text
uri="/applications/123/approve"
uri="/applications/456/approve"
```

Baik:

```text
route="POST /applications/{id}/approve"
```

---

### 13.3 Transaction Boundary

DB transaction boundary:

- transaction started,
- important state loaded,
- state transition requested,
- commit success,
- rollback cause,
- lock wait/timeout,
- optimistic lock conflict.

Jangan log setiap query normal di INFO. Gunakan trace/span/slow query mechanism.

---

### 13.4 External Dependency Boundary

External call boundary:

- dependency name,
- operation,
- endpoint template,
- timeout config,
- attempt number,
- status,
- duration,
- error category,
- circuit breaker state,
- fallback outcome.

---

### 13.5 Async Boundary

Queue/message boundary:

- message produced,
- message consumed,
- message ack/nack,
- retry attempt,
- DLQ movement,
- processing duration,
- original correlation id,
- idempotency key,
- consumer group,
- partition/routing key jika relevan.

---

### 13.6 Scheduler/Batch Boundary

Batch/job boundary:

- job execution id,
- schedule time,
- actual start time,
- drift,
- item count,
- success count,
- failure count,
- skipped count,
- duration,
- checkpoint,
- resume status.

---

## 14. Evidence Quality Model

Tidak semua evidence sama kualitasnya.

Kita bisa menilai evidence dari beberapa dimensi.

| Dimensi | Pertanyaan |
|---|---|
| Relevance | Apakah signal menjawab pertanyaan diagnosis penting? |
| Specificity | Apakah cukup spesifik atau terlalu generic? |
| Correlation | Bisa dikaitkan dengan signal lain? |
| Timeliness | Tersedia saat dibutuhkan? |
| Accuracy | Apakah merepresentasikan realita runtime? |
| Completeness | Apakah context cukup? |
| Cost | Apakah biaya runtime/storage/query masuk akal? |
| Safety | Apakah bebas secret/PII? |
| Stability | Apakah schema stabil untuk dashboard/alert/query? |
| Actionability | Apakah membantu mengambil keputusan? |

Contoh evidence buruk:

```text
ERROR failed
```

Nilai:

- relevance: rendah,
- specificity: rendah,
- correlation: tidak ada,
- actionability: rendah.

Contoh evidence baik:

```json
{
  "event": "external.onemap.lookup.failed",
  "dependency": "onemap",
  "operation": "postal_code_lookup",
  "postal_code_hash": "a91f...",
  "attempt": 3,
  "max_attempts": 3,
  "duration_ms": 1250,
  "http_status": 429,
  "error_category": "rate_limited",
  "outcome": "failed_after_retry",
  "trace_id": "...",
  "correlation_id": "..."
}
```

Nilai:

- relevance: tinggi,
- specificity: tinggi,
- correlation: tinggi,
- actionability: tinggi,
- safety: lebih baik karena hash, bukan raw personal data.

---

## 15. Log Level Mental Model

Kita akan bahas log level lebih detail di part berikutnya, tetapi fondasinya perlu dibangun sekarang.

### TRACE

Untuk detail sangat granular, biasanya hanya aktif lokal atau investigasi terbatas.

Contoh:

- parsing step,
- internal branch,
- protocol detail,
- deep transformation.

Bahaya:

- volume ekstrem,
- PII risk,
- performance overhead.

---

### DEBUG

Untuk debugging developer/operator pada kondisi non-normal atau investigasi.

Contoh:

- decision branch,
- computed config,
- cache hit/miss detail,
- retry decision detail.

Tidak boleh menjadi sumber utama observability produksi normal.

---

### INFO

Untuk significant lifecycle/business/technical event yang normal dan berguna.

Contoh:

- service started,
- job completed,
- state transition completed,
- external integration configured,
- important async message produced,
- batch summary.

INFO bukan tempat semua hal normal dicetak.

---

### WARN

Untuk kondisi tidak ideal tetapi sistem masih bisa melanjutkan.

Contoh:

- retry akan dilakukan,
- fallback digunakan,
- dependency lambat tetapi belum gagal,
- config deprecated,
- partial degradation,
- near-saturation.

WARN harus actionable. Jika WARN terjadi ribuan kali per menit dan tidak ada tindakan, mungkin level-nya salah atau alert design-nya salah.

---

### ERROR

Untuk failure yang menyebabkan operasi gagal, data tidak diproses, request gagal, job gagal, atau sistem masuk kondisi yang perlu perhatian.

ERROR harus punya:

- operation,
- context,
- cause,
- outcome,
- owner/boundary.

Jangan menjadikan semua exception sebagai ERROR. Validation error user biasanya bukan ERROR sistem.

---

## 16. Diagnostic Log vs Audit Log vs Security Log

### 16.1 Diagnostic Log

Tujuan:

- debugging,
- incident diagnosis,
- runtime behavior analysis.

Karakter:

- bisa berubah,
- technical,
- volume medium/high,
- retention lebih pendek,
- schema dapat berevolusi.

---

### 16.2 Audit Log

Tujuan:

- accountability,
- compliance,
- legal/business traceability,
- user dispute resolution.

Karakter:

- schema stabil,
- retention panjang,
- akses terbatas,
- tamper-aware,
- domain-focused,
- harus defensible.

---

### 16.3 Security Log

Tujuan:

- mendeteksi aktivitas mencurigakan,
- forensic security,
- access monitoring,
- policy violation.

Contoh:

- login failed,
- MFA failed,
- token rejected,
- privilege escalation attempt,
- forbidden access,
- suspicious rate,
- admin action,
- session invalidated.

Security log harus hati-hati: cukup detail untuk forensic, tetapi tidak membocorkan secret.

---

## 17. Observability dan Troubleshooting sebagai Architecture Concern

Observability bukan fitur tambahan setelah aplikasi selesai.

Ia memengaruhi arsitektur:

### 17.1 API Design

API perlu membawa/request correlation:

- W3C trace context,
- request id,
- idempotency key,
- tenant id,
- actor context.

### 17.2 Domain Design

Domain event harus punya semantic identity:

- event type,
- aggregate id,
- previous state,
- new state,
- actor,
- reason,
- timestamp.

### 17.3 Transaction Design

Perlu jelas:

- kapan commit,
- kapan rollback,
- apa yang terjadi sebelum external call,
- apa yang idempotent,
- apa yang compensated.

### 17.4 Async Design

Perlu jelas:

- message id,
- correlation id,
- retry count,
- dead letter reason,
- poison message handling.

### 17.5 Deployment Design

Perlu bisa membedakan:

- version lama vs baru,
- canary vs stable,
- region/zone/node,
- config A vs config B.

### 17.6 Security Design

Perlu memastikan:

- redaction,
- access control,
- auditability,
- safe context propagation.

---

## 18. Causality: Skill yang Membedakan Engineer Biasa dan Top Engineer

Banyak engineer berhenti di korelasi waktu.

Contoh:

```text
10:00 deployment
10:05 error naik
```

Mereka menyimpulkan:

> Deployment pasti penyebab.

Mungkin benar, mungkin tidak.

Top engineer membangun causal chain:

```text
deployment rc2 mengubah query approval
  -> query plan berubah
  -> DB CPU naik
  -> query latency naik
  -> Hikari connection active mencapai max
  -> request menunggu connection
  -> Tomcat worker habis
  -> p99 latency naik
  -> client retry meningkat
  -> load makin tinggi
  -> error timeout naik
```

Causal chain membutuhkan evidence lintas layer:

- deployment metadata,
- DB query metric,
- DB execution plan,
- Hikari metric,
- HTTP latency metric,
- thread dump,
- trace,
- error logs,
- client retry logs.

Observability yang baik mempercepat pembentukan causal chain.

---

## 19. Failure Taxonomy untuk Observability

Agar evidence berguna, kita perlu mengelompokkan failure.

### 19.1 Input/User Failure

Contoh:

- validation error,
- invalid state transition,
- unauthorized action,
- missing required field.

Biasanya bukan ERROR sistem. Bisa dicatat sebagai INFO/WARN tergantung konteks dan security relevance.

---

### 19.2 Dependency Failure

Contoh:

- DB timeout,
- external API 5xx,
- DNS failure,
- message broker unavailable,
- SMTP failure.

Perlu dependency name, operation, duration, attempt, status, outcome.

---

### 19.3 Resource Failure

Contoh:

- CPU saturation,
- memory pressure,
- thread pool exhaustion,
- connection pool exhaustion,
- disk full,
- file descriptor exhaustion.

Perlu metric dan dump/profile.

---

### 19.4 Concurrency Failure

Contoh:

- deadlock,
- lock convoy,
- race condition,
- lost update,
- optimistic lock conflict,
- duplicate processing,
- ThreadLocal leak.

Perlu logs, thread dump, trace, domain state evidence.

---

### 19.5 Data/State Failure

Contoh:

- inconsistent state,
- missing reference data,
- migration bug,
- stale cache,
- partial commit,
- duplicate event.

Perlu audit/domain event, DB evidence, idempotency evidence.

---

### 19.6 Configuration/Deployment Failure

Contoh:

- wrong endpoint,
- wrong timeout,
- missing secret,
- incompatible version,
- feature flag wrong,
- pod with stale config.

Perlu startup logs, config fingerprint, deployment metadata.

---

## 20. Evidence-First Development Workflow

Sebelum implementasi fitur, tanyakan:

### 20.1 What Can Fail?

Untuk setiap use case:

- input invalid,
- permission denied,
- state conflict,
- DB unavailable,
- dependency timeout,
- message publish failed,
- retry exhausted,
- transaction rollback,
- duplicate request,
- partial success.

### 20.2 What Should We Know When It Fails?

- operation,
- actor,
- object,
- state,
- dependency,
- latency,
- attempt,
- outcome,
- rollback/commit,
- safe retry or not.

### 20.3 Which Signal Should Carry It?

| Need | Signal |
|---|---|
| One important event happened | Log |
| Count/rate/duration over time | Metric |
| Request path across services | Trace |
| CPU/allocation cost | Profile |
| Current thread state | Thread dump |
| Object retention | Heap dump |
| JVM runtime event | JFR |
| Legal accountability | Audit event |

### 20.4 What Is Too Sensitive to Capture?

- secret,
- token,
- raw PII,
- full request body,
- personal/legal data.

### 20.5 What Is Too Expensive?

- per-row INFO log in large batch,
- full stack trace for expected validation,
- body logging for every request,
- high-cardinality metric labels,
- synchronous network appender,
- always-on allocation profiling at too high detail.

---

## 21. Example: Poor vs Strong Evidence Design

### 21.1 Poor Implementation

```java
public void approve(Long applicationId) {
    log.info("approve start");
    Application app = repository.findById(applicationId).orElseThrow();
    app.approve();
    repository.save(app);
    emailService.sendApprovalEmail(app);
    log.info("approve success");
}
```

Problems:

- no actor,
- no current state,
- no outcome detail,
- no duration,
- no transaction result,
- no email outcome,
- no correlation id shown,
- failure path unclear,
- approval success log may occur after DB save but before email success depending implementation,
- no distinction business success vs side-effect failure.

---

### 21.2 Better Evidence-Oriented Pseudocode

```java
public void approve(ApprovalCommand command) {
    Timer.Sample timer = Timer.start(meterRegistry);

    log.atInfo()
       .setMessage("Application approval started")
       .addKeyValue("event", "application.approval.started")
       .addKeyValue("applicationId", command.applicationId())
       .addKeyValue("actorId", command.actorId())
       .log();

    try {
        ApprovalResult result = transactionTemplate.execute(status -> {
            Application app = repository.findForUpdate(command.applicationId());
            ApplicationState previousState = app.state();

            app.approve(command.actorId(), command.reasonCode());
            repository.save(app);
            auditService.recordApproval(app, previousState, app.state(), command.actorId());

            return new ApprovalResult(previousState, app.state());
        });

        notificationPublisher.publishApprovalNotification(command.applicationId());

        log.atInfo()
           .setMessage("Application approval completed")
           .addKeyValue("event", "application.approval.completed")
           .addKeyValue("applicationId", command.applicationId())
           .addKeyValue("actorId", command.actorId())
           .addKeyValue("previousState", result.previousState())
           .addKeyValue("newState", result.newState())
           .addKeyValue("outcome", "success")
           .log();

        meterRegistry.counter("application.approval", "outcome", "success").increment();
    } catch (OptimisticLockingFailureException e) {
        log.atWarn()
           .setMessage("Application approval conflicted")
           .addKeyValue("event", "application.approval.conflicted")
           .addKeyValue("applicationId", command.applicationId())
           .addKeyValue("actorId", command.actorId())
           .addKeyValue("errorCategory", "optimistic_lock_conflict")
           .addKeyValue("outcome", "not_committed")
           .setCause(e)
           .log();

        meterRegistry.counter("application.approval", "outcome", "conflict").increment();
        throw e;
    } catch (Exception e) {
        log.atError()
           .setMessage("Application approval failed")
           .addKeyValue("event", "application.approval.failed")
           .addKeyValue("applicationId", command.applicationId())
           .addKeyValue("actorId", command.actorId())
           .addKeyValue("errorCategory", classify(e))
           .addKeyValue("outcome", "failed")
           .setCause(e)
           .log();

        meterRegistry.counter("application.approval", "outcome", "error").increment();
        throw e;
    } finally {
        timer.stop(meterRegistry.timer("application.approval.duration"));
    }
}
```

Catatan:

Kode di atas bukan final production pattern. Banyak detail akan dibahas nanti: transaction semantics, audit separation, metric cardinality, error classifier, span, context propagation, redaction, dan event schema. Tujuannya hanya menunjukkan perubahan cara berpikir.

---

## 22. Signal Selection Decision Tree

Gunakan decision tree berikut saat mendesain observability.

```text
Apakah ini kejadian diskrit yang penting?
  Ya -> Log / audit event
  Tidak -> lanjut

Apakah perlu dihitung/rate/trend/alert?
  Ya -> Metric
  Tidak -> lanjut

Apakah perlu memahami path request antar layer/service?
  Ya -> Trace/span
  Tidak -> lanjut

Apakah perlu tahu CPU/allocation/lock cost?
  Ya -> Profile/JFR
  Tidak -> lanjut

Apakah perlu snapshot thread saat stuck?
  Ya -> Thread dump
  Tidak -> lanjut

Apakah perlu tahu object yang menahan memory?
  Ya -> Heap dump
  Tidak -> lanjut

Apakah perlu accountability/legal history?
  Ya -> Audit event
```

Rule penting:

> Satu kejadian penting bisa membutuhkan lebih dari satu signal.

Contoh external API timeout:

- Log: timeout event with context.
- Metric: dependency error count and duration.
- Trace: client span with error.
- JFR/profile: jika timeout menyebabkan thread blocking luas.

---

## 23. Designing for Unknown Unknowns

Known known:

> Kita tahu DB query X kadang lambat.

Known unknown:

> Kita tahu ada latency spike, tetapi belum tahu layer mana.

Unknown unknown:

> Kita belum tahu jenis masalah apa yang akan muncul.

Observability yang baik membantu unknown unknowns dengan menyediakan:

- consistent context,
- distributed traces,
- golden metrics,
- structured logs,
- runtime profiles,
- JFR continuous recording,
- deployment metadata,
- error classification,
- dependency map.

Namun tidak mungkin menangkap semua hal. Karena itu desain harus memperhatikan:

- sampling,
- dynamic log level,
- on-demand profiling,
- emergency dump,
- feature flag,
- canary,
- safe rollback.

---

## 24. Incident Time: Cara Berpikir Evidence-Driven

Saat incident, jangan langsung lompat ke fix. Mulai dari framing.

### 24.1 Define the Symptom

Buruk:

```text
Sistem lambat.
```

Baik:

```text
p99 latency POST /applications/{id}/approve naik dari 800ms ke 12s sejak 10:05, error 504 naik 0.1% ke 18%, hanya pada prod intranet service version rc2.
```

### 24.2 Define Blast Radius

- semua user atau subset?
- semua module atau module tertentu?
- semua region/zone/pod atau subset?
- semua endpoint atau endpoint tertentu?
- semua tenant/agency atau subset?

### 24.3 Build Timeline

```text
09:55 deployment rc2 started
10:00 deployment completed
10:03 DB CPU started rising
10:05 p99 latency spike
10:06 Hikari active reached max
10:07 504 increased
10:08 queue backlog started
```

### 24.4 Generate Hypotheses

- query regression,
- DB lock,
- connection leak,
- external API timeout,
- thread pool exhaustion,
- GC pressure,
- CPU throttling,
- retry storm,
- logging bottleneck.

### 24.5 Test with Evidence

Each hypothesis needs evidence.

| Hypothesis | Evidence |
|---|---|
| DB pool exhausted | Hikari active/pending metrics, thread dump |
| Slow query | DB spans, slow query log, DB AWR/ASH if available |
| GC issue | GC logs, JFR GC events, heap metric |
| Thread deadlock | thread dump over time |
| External API timeout | client spans, dependency metrics, retry logs |
| CPU hot path | async-profiler/JFR execution sample |
| Logging bottleneck | blocked appender threads, log queue metric, disk IO |

### 24.6 Mitigate Before Perfect RCA

Top-tier troubleshooting distinguishes:

- mitigation,
- root cause,
- permanent fix,
- prevention.

Example:

- Mitigation: reduce traffic, disable feature flag, increase timeout? scale? rollback?
- Root cause: query plan regression due to missing index.
- Permanent fix: add index/query rewrite.
- Prevention: add slow-query metric, deploy guardrail, canary query check.

---

## 25. Runtime Evidence in Regulatory/Case Management Systems

Karena banyak enterprise/regulatory system berbasis lifecycle, evidence design harus memikirkan state dan accountability.

### 25.1 State Transition Evidence

Untuk setiap state transition penting:

- aggregate id,
- previous state,
- requested state,
- resulting state,
- actor,
- role,
- reason,
- validation outcome,
- timestamp,
- transaction outcome,
- correlation id.

Contoh:

```json
{
  "event": "case.state_transition.completed",
  "case_id": "CASE-2026-0001",
  "previous_state": "UNDER_REVIEW",
  "new_state": "APPROVED",
  "actor_role": "senior_officer",
  "reason_code": "DOCUMENTS_VERIFIED",
  "outcome": "success"
}
```

---

### 25.2 Escalation Evidence

Untuk escalation workflow:

- escalation rule id,
- trigger condition,
- threshold,
- previous assignee,
- new assignee,
- SLA state,
- due date,
- notification outcome.

---

### 25.3 Cross-Entity Impact Evidence

Untuk operasi yang menyentuh banyak entity:

- root entity,
- affected entity count,
- affected entity ids jika aman dan terbatas,
- batch execution id,
- partial failure count,
- compensation id.

---

### 25.4 Defensibility

Saat terjadi dispute:

- siapa yang melihat/mengubah data,
- rule apa yang berlaku,
- data apa yang digunakan,
- hasil validasi apa,
- kapan keputusan terjadi,
- apakah sistem melakukan auto-action,
- apakah notifikasi terkirim.

Diagnostic log saja tidak cukup. Butuh audit/event model yang stabil.

---

## 26. Checklist Desain Evidence untuk Setiap Feature

Sebelum feature dianggap production-ready, jawab checklist ini.

### Identity

- [ ] Ada service name?
- [ ] Ada version/build id?
- [ ] Ada environment?
- [ ] Ada trace id?
- [ ] Ada correlation id?
- [ ] Ada domain id yang aman?
- [ ] Ada actor/tenant jika relevan dan aman?

### Events

- [ ] Ada event untuk operation started jika operation long-running/critical?
- [ ] Ada event untuk operation completed?
- [ ] Ada event untuk operation failed?
- [ ] Ada event untuk important state transition?
- [ ] Ada event untuk retry/fallback/degradation?
- [ ] Ada audit event jika action business-critical?

### Metrics

- [ ] Ada duration metric?
- [ ] Ada success/error counter?
- [ ] Ada dependency metric?
- [ ] Ada saturation metric untuk pool/queue?
- [ ] Label cardinality aman?

### Tracing

- [ ] Ada server span?
- [ ] Ada client span untuk external call?
- [ ] Ada span untuk operation penting?
- [ ] Trace context diteruskan ke async boundary?

### Safety

- [ ] Tidak log secret?
- [ ] Tidak log raw PII?
- [ ] Ada masking/redaction?
- [ ] Access log sesuai sensitivity?

### Troubleshooting

- [ ] Jika lambat, bisa tahu lambat di mana?
- [ ] Jika gagal, bisa tahu cause dan outcome?
- [ ] Jika partial, bisa tahu bagian mana yang sukses/gagal?
- [ ] Jika retry, bisa tahu attempt dan final outcome?
- [ ] Jika incident, bisa filter by tenant/module/version?

---

## 27. Practical Exercise

Gunakan use case berikut:

> User submit renewal application. Sistem melakukan validasi, menyimpan draft, memanggil payment service, publish notification, dan menulis audit event.

Tugas:

1. Identifikasi boundary runtime.
2. Tentukan log event penting.
3. Tentukan metric yang dibutuhkan.
4. Tentukan span yang dibutuhkan.
5. Tentukan audit event.
6. Tentukan data yang tidak boleh dilog.
7. Tentukan failure taxonomy.
8. Buat timeline sukses.
9. Buat timeline gagal karena payment timeout.
10. Buat timeline partial failure ketika DB commit sukses tetapi notification publish gagal.

Contoh jawaban ringkas:

```text
Boundary:
- HTTP submit renewal
- validation
- DB transaction
- payment service
- notification publish
- audit persist

Important IDs:
- trace_id
- correlation_id
- renewal_application_id
- actor_id
- payment_reference
- message_id

Metrics:
- renewal.submit.duration
- renewal.submit.count{outcome}
- payment.client.duration
- payment.client.errors{category}
- notification.publish.count{outcome}

Failure categories:
- validation_failed
- payment_timeout
- db_error
- duplicate_submission
- notification_publish_failed
- audit_persist_failed
```

---

## 28. Common Misconceptions

### Misconception 1 — “Log Level Bisa Diperbaiki Nanti”

Bisa, tapi jika semantic event buruk, menaikkan/menurunkan level tidak menyelesaikan masalah.

---

### Misconception 2 — “Trace Menggantikan Log”

Trace menunjukkan path dan timing. Log menjelaskan semantic event. Keduanya saling melengkapi.

---

### Misconception 3 — “Metric Cukup untuk RCA”

Metric menunjukkan gejala dan trend. RCA biasanya butuh logs, traces, profiles, dump, deployment metadata, dan domain understanding.

---

### Misconception 4 — “Profiler Hanya untuk Performance Engineer”

Backend engineer senior harus bisa membaca flame graph dasar, allocation hotspot, lock contention, dan wall-clock profile.

---

### Misconception 5 — “Observability Itu Urusan DevOps/SRE”

SRE/platform bisa menyediakan pipeline. Tetapi application engineer yang tahu domain dan code path harus mendesain signal semantic.

---

## 29. Minimum Runtime Evidence Baseline untuk Java Service

Untuk service Java production-grade, baseline minimal:

### Logs

- structured JSON logs,
- trace id/span id,
- correlation id,
- service/env/version,
- consistent event name,
- safe redaction,
- error logs with cause/context/outcome.

### Metrics

- HTTP RED metrics,
- JVM metrics,
- GC metrics,
- thread metrics,
- DB pool metrics,
- dependency client metrics,
- queue metrics jika ada,
- business operation count/duration.

### Traces

- incoming HTTP spans,
- outgoing HTTP spans,
- DB spans,
- message producer/consumer spans,
- manual spans untuk domain operation penting.

### JVM Evidence

- GC logging/JFR readiness,
- thread dump access,
- heap dump plan,
- profiler access plan,
- Native Memory Tracking plan untuk kasus tertentu.

### Metadata

- build/version,
- commit hash,
- deployment time,
- pod/instance id,
- Java version,
- important JVM flags,
- active config profile.

---

## 30. Summary Mental Model

Inti Part 1:

1. Production system tidak cukup dipahami dari source code.
2. Logging adalah signal, bukan observability penuh.
3. Runtime evidence adalah basis diagnosis.
4. Evidence harus punya identity, context, causality, outcome, safety, dan cost control.
5. Logs, metrics, traces, profiles, dumps, JFR, dan audit events menjawab pertanyaan berbeda.
6. Top-tier engineer mendesain evidence sebelum incident.
7. Observability adalah architecture concern.
8. Tujuan akhirnya adalah membangun Evidence Graph yang bisa menjelaskan behavior sistem secara cepat dan defensible.

---

## 31. Key Takeaways

- Jangan bertanya “log apa yang harus saya tambahkan?” terlalu cepat.
- Bertanyalah “pertanyaan diagnosis apa yang harus bisa dijawab saat sistem gagal?”
- Jangan log semua hal.
- Jangan hanya mengandalkan metric.
- Jangan mengira trace menggantikan log.
- Jangan mencampur diagnostic log dengan audit event.
- Jangan mengabaikan cost dan security.
- Desain evidence sebagai bagian dari feature design.
- Setiap critical operation harus punya identity, context, outcome, dan correlation.
- Runtime evidence yang baik membuat incident response lebih cepat, RCA lebih kuat, dan sistem lebih defensible.

---

## 32. Preparation for Part 2

Part berikutnya akan masuk ke:

# Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout

Kita akan membedah:

- kenapa Java punya banyak logging framework,
- SLF4J sebagai facade,
- Logback dan Log4j2 sebagai backend,
- binding/provider,
- appender,
- layout,
- encoder,
- logger hierarchy,
- classloader issue,
- Java 8 sampai 25 compatibility,
- dan cara menghindari dependency logging chaos.

---

## 33. References

Beberapa referensi resmi/otoritatif yang relevan untuk fondasi part ini:

1. OpenTelemetry documentation — OpenTelemetry sebagai framework/toolkit untuk generation, export, dan collection telemetry data seperti traces, metrics, dan logs: <https://opentelemetry.io/docs/what-is-opentelemetry/>
2. OpenTelemetry Java documentation — telemetry untuk Java menggunakan API dan SDK: <https://opentelemetry.io/docs/languages/java/>
3. SLF4J manual — parameterized/fluent/key-value logging concepts: <https://www.slf4j.org/manual.html>
4. Oracle Java Flight Recorder documentation — JFR sebagai tool profiling/diagnostics yang terintegrasi dengan JVM dan didesain untuk overhead rendah: <https://docs.oracle.com/javacomponents/jmc-5-5/jfr-runtime-guide/about.htm>
5. Google SRE Book, Monitoring Distributed Systems — monitoring, latency, saturation, dan prinsip signal untuk sistem produksi: <https://sre.google/sre-book/monitoring-distributed-systems/>

---

## 34. Status Seri

Seri belum selesai.

- Bagian selesai: Part 0, Part 1.
- Bagian berikutnya: Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout.
- Target akhir: Part 35 — Capstone: Diagnose a Complex Java Production Incident End-to-End.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 0 — Orientation, Scope, Mental Model, dan Learning Contract](./00-orientation-scope-mental-model-learning-contract.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — Java Logging Architecture: Facade, API, Backend, Appender, Layout](./02-java-logging-architecture-facade-api-backend-appender-layout.md)
