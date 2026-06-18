# learn-java-reliability-part-012.md

# Part 012 — Request Draining and In-Flight Work Management

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability untuk Java Engineer  
> Status: Part 012 dari 030  
> Fokus: bagaimana service menghentikan penerimaan request baru, mengelola request yang sedang berjalan, dan membuat shutdown tetap aman secara data, client behavior, observability, dan operasional.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- fondasi graceful shutdown;
- mekanisme JVM shutdown;
- Spring Boot graceful shutdown;
- realitas Kubernetes/container termination.

Part ini masuk ke level yang lebih spesifik:

> Apa yang sebenarnya terjadi pada request yang sedang berjalan ketika service masuk fase terminating?

Banyak engineer mengira graceful shutdown selesai hanya dengan konfigurasi:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Konfigurasi itu penting, tetapi belum cukup. Sistem produksi punya banyak celah:

- load balancer masih bisa mengirim request saat pod mulai terminating;
- readiness state butuh waktu untuk tersinkronisasi ke endpoint, proxy, atau ALB;
- request bisa sudah diterima sebelum readiness berubah;
- request bisa long-running melebihi shutdown budget;
- request bisa berada di tengah transaksi;
- response bisa gagal dikirim padahal commit berhasil;
- client bisa retry request non-idempotent;
- reverse proxy bisa return `502`, `503`, atau `504` tanpa semantic error contract dari aplikasi;
- background async work yang dipicu request bisa tetap berjalan setelah response dikirim;
- request yang terlihat “selesai” belum tentu semua side effect-nya aman.

Maka fokus part ini adalah **request draining** dan **in-flight work management**.

---

## 1. Core Problem

### 1.1 Problem sederhana yang terlihat

Saat deployment, scaling down, restart, node drain, atau crash recovery, aplikasi harus berhenti. Di saat yang sama, user/client mungkin masih mengirim request.

Pertanyaan operasionalnya:

> Bagaimana memastikan request tidak hilang, tidak diproses setengah, tidak diproses dua kali secara merusak, dan tidak membuat client menerima hasil yang menyesatkan?

### 1.2 Problem sebenarnya

Problem sebenarnya bukan hanya “request selesai atau tidak”. Problem sebenarnya adalah:

> Pada titik shutdown tertentu, sistem harus tahu request mana yang masih boleh diterima, mana yang harus ditolak, mana yang harus diselesaikan, mana yang harus dibatalkan, dan bagaimana client harus bereaksi.

Request draining adalah koordinasi antara:

- application lifecycle;
- HTTP server;
- thread/executor model;
- transaction boundary;
- external dependency calls;
- client timeout;
- load balancer behavior;
- Kubernetes endpoint propagation;
- idempotency design;
- observability;
- operational runbook.

---

## 2. Mental Model: Shutdown Is a State Machine

Jangan pikirkan shutdown sebagai event tunggal:

```text
SIGTERM received -> application stops
```

Itu terlalu kasar.

Pikirkan shutdown sebagai state machine:

```text
RUNNING
  |
  | termination requested
  v
DRAINING
  |
  | no new work accepted, existing safe work allowed to finish
  v
QUIESCING
  |
  | only cleanup/finalization allowed
  v
STOPPING
  |
  | resources closed
  v
TERMINATED
```

### 2.1 State: RUNNING

Karakteristik:

- readiness = accepting traffic;
- new request boleh diterima;
- background task boleh dijadwalkan;
- HTTP server normal;
- dependency client normal;
- metrics normal.

### 2.2 State: DRAINING

Karakteristik:

- service sedang menuju shutdown;
- readiness harus berubah menjadi refusing traffic;
- request baru sebaiknya ditolak secara eksplisit;
- request yang sudah berjalan diberi kesempatan selesai;
- long-running request dievaluasi terhadap remaining shutdown budget;
- expensive new sub-work tidak boleh dimulai sembarangan;
- worker/executor mulai menolak pekerjaan baru;
- observability harus menandai instance dalam mode draining.

### 2.3 State: QUIESCING

Karakteristik:

- tidak ada request bisnis baru;
- hanya finalization yang boleh berjalan;
- flush log/metric buffer;
- finish lifecycle callbacks;
- close connection pool;
- release lease/lock;
- publish final heartbeat/state jika ada.

### 2.4 State: STOPPING

Karakteristik:

- resource mulai ditutup;
- dependency client tidak lagi boleh dipakai;
- late async task harus ditolak;
- request yang belum selesai kemungkinan besar harus fail/cancel;
- shutdown budget hampir habis.

### 2.5 State: TERMINATED

Karakteristik:

- process selesai;
- semua in-memory state hilang;
- hanya persistent evidence yang tersisa;
- client/proxy mungkin melihat connection reset, 502, 503, atau timeout jika drain tidak rapi.

---

## 3. Request Lifecycle During Shutdown

Request normal biasanya seperti ini:

```text
Client
  -> Load Balancer / Ingress
  -> Kubernetes Service / Endpoint
  -> Pod HTTP server
  -> Filter / Interceptor
  -> Controller
  -> Service
  -> Repository / External API
  -> Commit / Side Effect
  -> Response
```

Saat shutdown, lifecycle-nya menjadi lebih kompleks:

```text
T0: request already routed
T1: pod receives SIGTERM
T2: readiness becomes refusing traffic
T3: endpoint removal propagates
T4: load balancer stops sending new traffic
T5: app waits for active requests
T6: shutdown timeout expires
T7: process exits or is killed
```

Masalah utama: **urutan ini tidak selalu bersih**.

Beberapa race yang umum:

1. Request masuk tepat setelah SIGTERM tetapi sebelum endpoint removal efektif.
2. Request sudah diterima HTTP server sebelum server masuk rejecting mode.
3. Long-running request belum selesai saat grace period habis.
4. Request melakukan commit, tetapi response gagal karena koneksi ditutup.
5. Client retry karena tidak menerima response, padahal request pertama sudah sukses commit.
6. Async task dipicu oleh request, response sudah dikirim, tetapi process mati sebelum async task selesai.
7. LB/proxy retry otomatis ke instance lain untuk request yang tidak idempotent.

---

## 4. Request Draining Definition

Request draining adalah proses untuk:

1. menghentikan penerimaan request baru;
2. menyelesaikan request yang sudah diterima jika aman;
3. menolak request baru dengan semantic response yang benar;
4. membatalkan request yang tidak mungkin selesai dengan aman;
5. menjaga client retry tetap aman;
6. menyimpan evidence operasional;
7. keluar dari process tanpa meninggalkan state ambigu sebanyak mungkin.

Request draining bukan sekadar “wait”.

Request draining adalah **admission control + in-flight tracking + deadline awareness + side-effect safety + client contract**.

---

## 5. Three Categories of Request During Shutdown

Saat instance masuk mode draining, request bisa diklasifikasikan menjadi tiga kategori.

### 5.1 Already accepted and safe to finish

Contoh:

- request pendek;
- read-only request;
- request sudah melewati validation dan sedang membaca data;
- request punya idempotency key;
- request dalam transaksi lokal yang bisa commit/rollback dengan jelas;
- estimasi selesai masih dalam remaining shutdown budget.

Strategi:

- lanjutkan;
- jangan start sub-work baru yang tidak perlu;
- propagate deadline;
- log jika melewati threshold;
- selesaikan response.

### 5.2 New request during draining

Contoh:

- request masuk setelah readiness false;
- request masuk karena LB endpoint belum update;
- request dari internal client yang masih punya stale endpoint;
- request health check selain readiness.

Strategi:

- reject secara eksplisit;
- gunakan status yang tepat, biasanya `503 Service Unavailable`;
- sertakan `Retry-After` jika client bisa menggunakannya;
- jangan mulai transaksi atau side effect;
- log dengan level rendah/medium, bukan error besar untuk setiap request.

### 5.3 Already accepted but unsafe to continue

Contoh:

- long-running export melebihi remaining shutdown budget;
- request memanggil dependency eksternal lambat;
- request baru mulai side effect besar saat shutdown sudah dekat;
- streaming/WebSocket tidak bisa selesai tepat waktu;
- request memicu async processing yang tidak persistent;
- request tidak idempotent dan belum punya idempotency key.

Strategi:

- cancel sebelum side effect jika memungkinkan;
- return explicit failure jika response masih bisa dikirim;
- persist job intent dan lanjutkan di worker lain jika desain mendukung;
- jangan fake success;
- jangan diam-diam drop.

---

## 6. Admission Control: Gate Sebelum Controller

Aplikasi perlu punya konsep “apakah instance ini menerima request bisnis baru?”.

Ini berbeda dari sekadar Kubernetes readiness.

Readiness adalah signal ke platform. Admission control adalah keputusan di dalam aplikasi.

### 6.1 Kenapa readiness saja tidak cukup?

Karena readiness propagation tidak instan.

Ada delay di:

- application state update;
- kubelet probe interval;
- EndpointSlice update;
- kube-proxy/iptables/IPVS update;
- ingress controller update;
- load balancer target deregistration;
- client-side DNS/cache/stale connection;
- service mesh sidecar routing.

Maka walaupun pod sudah “not ready”, request masih bisa masuk dalam jendela pendek.

### 6.2 Pola internal draining flag

Minimal aplikasi perlu punya flag:

```java
public interface TrafficAdmission {
    boolean acceptsBusinessTraffic();
    boolean isDraining();
    Instant drainingSince();
}
```

Implementasi sederhana:

```java
@Component
public final class ApplicationDrainState implements TrafficAdmission {
    private final AtomicBoolean draining = new AtomicBoolean(false);
    private final AtomicReference<Instant> drainingSince = new AtomicReference<>();

    public void startDraining() {
        if (draining.compareAndSet(false, true)) {
            drainingSince.set(Instant.now());
        }
    }

    @Override
    public boolean acceptsBusinessTraffic() {
        return !draining.get();
    }

    @Override
    public boolean isDraining() {
        return draining.get();
    }

    @Override
    public Instant drainingSince() {
        return drainingSince.get();
    }
}
```

### 6.3 Gate di filter/interceptor

Untuk Servlet stack:

```java
@Component
public final class DrainingAdmissionFilter extends OncePerRequestFilter {
    private final TrafficAdmission admission;

    public DrainingAdmissionFilter(TrafficAdmission admission) {
        this.admission = admission;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        if (isInfrastructurePath(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        if (!admission.acceptsBusinessTraffic()) {
            response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, "5");
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.getWriter().write("""
                {
                  "type": "https://example.com/problems/service-draining",
                  "title": "Service is draining",
                  "status": 503,
                  "code": "SERVICE_DRAINING",
                  "message": "This instance is shutting down and is not accepting new business requests. Please retry." 
                }
                """);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean isInfrastructurePath(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/actuator/health")
                || path.startsWith("/actuator/prometheus");
    }
}
```

Catatan penting:

- readiness/liveness/metrics endpoint biasanya tetap perlu tersedia;
- business endpoint harus ditolak saat draining;
- jangan menolak semua endpoint buta-buta karena platform masih perlu health/metrics signal;
- jangan melakukan DB call sebelum admission gate.

---

## 7. Readiness vs Admission Control vs Graceful Shutdown

Ketiganya berbeda.

| Concern | Pertanyaan | Mekanisme |
|---|---|---|
| Readiness | Apakah platform harus route traffic ke instance ini? | Kubernetes readiness / Spring availability |
| Admission control | Apakah aplikasi menerima request bisnis baru? | Filter/interceptor/gateway decision |
| Graceful shutdown | Apakah server menunggu request berjalan selesai? | Spring Boot/web server lifecycle |

Kesalahan umum:

> Menganggap `server.shutdown=graceful` otomatis cukup untuk zero lost request.

Lebih tepat:

```text
Readiness removes instance from future routing.
Admission control rejects late arrivals.
Graceful shutdown waits for accepted in-flight requests.
Idempotency protects client retries.
Observability proves what happened.
```

---

## 8. In-Flight Request Tracking

Untuk mengelola request berjalan, aplikasi perlu tahu:

- berapa request aktif;
- request apa saja yang aktif;
- sejak kapan;
- endpoint mana;
- apakah read/write;
- apakah punya idempotency key;
- apakah sedang dalam transaction boundary;
- apakah sudah melakukan side effect;
- berapa remaining deadline.

Tidak semua informasi harus disimpan detail, tetapi minimal **active request counter** penting.

### 8.1 Basic active request counter

```java
@Component
public final class InFlightRequestRegistry {
    private final AtomicInteger activeRequests = new AtomicInteger(0);

    public RequestScope enter() {
        activeRequests.incrementAndGet();
        return new RequestScope(this);
    }

    private void exit() {
        activeRequests.decrementAndGet();
    }

    public int activeCount() {
        return activeRequests.get();
    }

    public static final class RequestScope implements AutoCloseable {
        private final InFlightRequestRegistry registry;
        private final AtomicBoolean closed = new AtomicBoolean(false);

        private RequestScope(InFlightRequestRegistry registry) {
            this.registry = registry;
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                registry.exit();
            }
        }
    }
}
```

Filter:

```java
@Component
public final class InFlightTrackingFilter extends OncePerRequestFilter {
    private final InFlightRequestRegistry registry;

    public InFlightTrackingFilter(InFlightRequestRegistry registry) {
        this.registry = registry;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        try (var ignored = registry.enter()) {
            filterChain.doFilter(request, response);
        }
    }
}
```

### 8.2 Ordering dengan admission filter

Ada dua desain:

#### Desain A — Count semua request yang masuk server

```text
InFlightTrackingFilter
  -> AdmissionFilter
  -> Controller
```

Kelebihan:

- semua traffic terlihat;
- late arrival saat draining tercatat.

Kekurangan:

- active count termasuk request yang langsung ditolak.

#### Desain B — Count hanya accepted business request

```text
AdmissionFilter
  -> InFlightTrackingFilter
  -> Controller
```

Kelebihan:

- active count lebih merepresentasikan pekerjaan bisnis.

Kekurangan:

- rejected late arrival harus dimetrikkan terpisah.

Untuk production biasanya gunakan:

- `http_requests_active_total` untuk semua request;
- `business_requests_in_flight` untuk request yang diterima;
- `business_requests_rejected_draining_total` untuk request yang ditolak karena draining.

---

## 9. Shutdown Budget and Request Deadline

Graceful shutdown selalu punya budget waktu.

Contoh:

```yaml
terminationGracePeriodSeconds: 45
```

```properties
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Jangan habiskan semua budget untuk request bisnis. Sisakan waktu untuk:

- flushing logs;
- closing server;
- closing DB pool;
- stopping executor;
- releasing locks;
- sending final telemetry;
- sidecar/proxy termination;
- JVM final shutdown sequence.

### 9.1 Budget model

Misal Kubernetes memberi 45 detik.

Alokasi realistis:

```text
Total termination budget:       45s
preStop/readiness propagation:  5-10s
request drain budget:           25-30s
resource cleanup:               5-8s
safety buffer:                  2-5s
```

### 9.2 Remaining deadline

Saat aplikasi masuk draining, catat deadline:

```java
public final class ShutdownDeadline {
    private final AtomicReference<Instant> deadline = new AtomicReference<>();

    public void start(Duration drainBudget) {
        deadline.compareAndSet(null, Instant.now().plus(drainBudget));
    }

    public Optional<Duration> remaining() {
        Instant value = deadline.get();
        if (value == null) {
            return Optional.empty();
        }
        return Optional.of(Duration.between(Instant.now(), value));
    }

    public boolean hasEnoughTimeFor(Duration expectedDuration) {
        return remaining()
                .map(left -> left.compareTo(expectedDuration) >= 0)
                .orElse(true);
    }
}
```

### 9.3 Deadline-aware handler

```java
public ReportResponse generateReport(GenerateReportCommand command) {
    if (drainState.isDraining()
            && !shutdownDeadline.hasEnoughTimeFor(Duration.ofSeconds(20))) {
        throw new ServiceDrainingException("Not enough shutdown budget to start report generation");
    }

    return reportService.generate(command);
}
```

Prinsip:

> Saat shutdown, jangan mulai pekerjaan yang kemungkinan besar tidak selesai dengan aman.

---

## 10. Request Type Classification

Tidak semua request harus diperlakukan sama.

### 10.1 Read-only request

Contoh:

```text
GET /cases/{id}
GET /profile/me
GET /reference-data/countries
```

Karakteristik:

- biasanya aman diselesaikan;
- tidak menimbulkan mutation;
- bisa ditolak saat draining jika belum diterima;
- kalau gagal, client bisa retry relatif aman.

Strategi:

- accepted request boleh selesai;
- new request saat draining bisa 503;
- cache/proxy bisa membantu;
- timeout harus pendek.

### 10.2 Write request dengan idempotency

Contoh:

```text
POST /payments with Idempotency-Key
POST /applications with clientRequestId
POST /case-actions with commandId
```

Karakteristik:

- retry bisa aman jika idempotency benar;
- commit uncertainty bisa diselesaikan dengan lookup by idempotency key;
- response gagal tidak selalu berarti operation gagal.

Strategi:

- accepted request boleh selesai jika cukup budget;
- new request saat draining ditolak sebelum mutation;
- client boleh retry ke instance lain;
- response harus memberi guidance.

### 10.3 Write request tanpa idempotency

Contoh:

```text
POST /submit without unique command id
POST /send-email without dedup key
POST /charge-card without idempotency key
```

Karakteristik:

- retry berbahaya;
- response failure bisa menyebabkan duplicate side effect;
- shutdown bisa menghasilkan ambiguity.

Strategi:

- desain ulang API;
- wajibkan idempotency key untuk mutation penting;
- jangan mengandalkan client “tidak akan retry”.

### 10.4 Long-running synchronous request

Contoh:

```text
POST /reports/generate
POST /bulk-import
POST /recalculate-risk-score
```

Karakteristik:

- rentan melewati shutdown budget;
- mudah timeout di gateway/client;
- sulit drain;
- buruk untuk rolling deployment.

Strategi lebih baik:

- ubah menjadi async job;
- persist job intent;
- return `202 Accepted`;
- worker mengambil job;
- progress bisa dipoll;
- worker shutdown-safe.

### 10.5 Streaming/WebSocket/SSE

Karakteristik:

- bisa berjalan sangat lama;
- graceful shutdown perlu close handshake;
- tidak bisa hanya “wait sampai selesai”;
- connection drain harus punya max age.

Strategi:

- kirim server-side close signal;
- beri reconnect hint;
- client harus reconnect ke instance lain;
- stop accepting new connection;
- batasi max stream lifetime;
- jangan jadikan stream sebagai tempat side effect penting tanpa checkpoint.

---

## 11. 503, Retry-After, and Error Contract

Saat instance draining menerima request baru, status paling umum adalah:

```text
503 Service Unavailable
```

Untuk client yang mendukung retry, dapat ditambahkan:

```text
Retry-After: 5
```

Namun perlu hati-hati:

- `Retry-After` bukan jaminan service akan pulih dalam 5 detik;
- itu hanya signal minimum/anjuran kapan client mencoba lagi;
- untuk instance-level draining, request mungkin langsung berhasil jika retry ke instance lain;
- gateway/LB bisa punya behavior sendiri;
- client harus tetap punya retry budget dan idempotency.

Contoh response:

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/problem+json
Retry-After: 5
X-Correlation-Id: 01J...
```

```json
{
  "type": "https://example.com/problems/service-draining",
  "title": "Service is draining",
  "status": 503,
  "code": "SERVICE_DRAINING",
  "message": "This service instance is shutting down and cannot accept new work.",
  "retryable": true,
  "correlationId": "01J..."
}
```

### 11.1 Jangan pakai 500 untuk draining

`500 Internal Server Error` memberi signal salah:

- seolah ada bug internal;
- client mungkin melakukan retry policy berbeda;
- dashboard error rate menjadi misleading;
- operator sulit membedakan shutdown normal vs incident.

### 11.2 Jangan return 200 dengan fake success

Anti-pattern:

```json
{
  "success": true,
  "message": "Request received"
}
```

padahal request tidak diproses karena draining.

Ini berbahaya karena:

- client berhenti retry;
- data hilang;
- user melihat status palsu;
- audit trail tidak lengkap;
- incident sulit direkonstruksi.

---

## 12. Client Behavior During Draining

Server-side draining hanya separuh cerita. Client juga harus benar.

### 12.1 Client harus membedakan failure type

Client idealnya membedakan:

| Failure | Retriable? | Catatan |
|---|---:|---|
| 503 `SERVICE_DRAINING` | Ya, jika operation idempotent | Retry ke instance lain |
| 503 dependency unavailable | Mungkin | Ikuti retry budget |
| 408/timeout before send | Mungkin | Tergantung apakah request sampai server |
| timeout after body sent | Ambiguous | Butuh idempotency/lookup |
| connection reset | Ambiguous | Butuh idempotency/lookup |
| 409 conflict | Tidak otomatis | Biasanya perlu user/action logic |
| 400 validation | Tidak | Fix request |
| 401/403 | Tidak sebagai retry biasa | Auth/permission issue |

### 12.2 Retry harus punya budget

Client buruk:

```text
retry forever every 100ms
```

Client lebih baik:

```text
max attempts: 3
backoff: exponential
jitter: yes
idempotency key: required for mutation
observability: emit retry metric
```

### 12.3 Client harus tahu commit uncertainty

Kasus klasik:

```text
Client sends POST /applications
Server commits application
Server dies before response reaches client
Client receives timeout
```

Apakah request sukses?

Jawabannya: tidak diketahui oleh client.

Solusi:

- gunakan idempotency key;
- client retry dengan key yang sama;
- server mengembalikan hasil operasi sebelumnya;
- atau client query status by command id.

Tanpa itu, client bisa membuat duplicate submission.

---

## 13. Commit Uncertainty During Shutdown

Shutdown memperbesar kemungkinan commit uncertainty.

### 13.1 Failure windows

```text
Window A: before server receives request
Window B: after server receives request, before validation
Window C: after validation, before transaction
Window D: inside transaction, before commit
Window E: commit in progress
Window F: commit succeeded, response not sent
Window G: response sent, client did not receive
```

Client failure interpretation berbeda per window.

| Window | Server state | Client sees | Safe retry? |
|---|---|---|---|
| A | nothing happened | connection failure | yes |
| B | no side effect | maybe timeout | usually yes |
| C | no mutation yet | maybe failure | usually yes |
| D | rollback likely but not always obvious | timeout/failure | maybe |
| E | unknown | timeout/reset | only with idempotency |
| F | committed | timeout/reset | only with idempotency |
| G | committed | client uncertain | only with idempotency/status lookup |

### 13.2 Server-side response truthfulness

Jika server belum melakukan side effect:

```text
503 SERVICE_DRAINING
```

Jika server sudah commit:

```text
200/201/204 sesuai hasil
```

Jika server tidak tahu hasil commit:

- jangan mengarang sukses;
- log error dengan correlation/idempotency key;
- gunakan transaction outcome lookup jika memungkinkan;
- expose status endpoint jika operation async.

---

## 14. Cancellation Semantics

Tidak semua request bisa atau boleh dibatalkan.

### 14.1 Cancellation before side effect

Aman:

```text
request accepted -> validation -> draining detected -> no side effect yet -> reject/cancel
```

### 14.2 Cancellation during side effect

Berbahaya:

```text
request accepted -> external payment call -> draining detected -> cancel thread
```

Masalah:

- external provider mungkin sudah memproses;
- thread interruption tidak membatalkan remote side effect;
- DB transaction lokal tidak mencakup external system;
- retry bisa duplicate.

### 14.3 Cancellation after commit

Tidak boleh dianggap cancel.

Jika commit sudah terjadi, operation harus dianggap berhasil di server walaupun response gagal.

Solusi:

- persist operation record;
- return result on retry by idempotency key;
- reconciliation.

### 14.4 Java interruption bukan magic cancel

Di Java, interrupt hanyalah signal. Code harus cooperative.

```java
if (Thread.currentThread().isInterrupted()) {
    throw new InterruptedException("Request interrupted during shutdown");
}
```

Tetapi:

- banyak blocking I/O punya behavior berbeda;
- JDBC cancellation tidak selalu langsung;
- HTTP client cancellation tergantung implementation;
- external system side effect tetap mungkin terjadi.

Prinsip:

> Cancellation harus didesain sebagai semantic operation, bukan berharap thread mati menyelesaikan masalah.

---

## 15. Long-Running Work: Jangan Dipaksa Synchronous

Salah satu akar masalah drain adalah request synchronous terlalu panjang.

Anti-pattern:

```text
POST /bulk-approve-100000-cases
-> runs 5 minutes
-> returns final result
```

Saat deployment, request ini hampir pasti bermasalah.

Desain lebih baik:

```text
POST /bulk-approval-jobs
-> validate command
-> persist job
-> return 202 Accepted + jobId

GET /bulk-approval-jobs/{jobId}
-> return progress/result
```

### 15.1 Kenapa async job lebih shutdown-safe?

Karena:

- intent dipersist lebih awal;
- worker bisa checkpoint;
- worker bisa stop after current unit;
- job bisa dilanjutkan instance lain;
- client tidak tergantung satu HTTP connection;
- timeout gateway tidak menentukan nasib bisnis.

### 15.2 Tetapi async job juga perlu draining

Jangan salah: async bukan otomatis reliable.

Worker tetap perlu:

- stop polling;
- finish current item;
- checkpoint;
- release lease;
- idempotency per item;
- dead letter/retry policy;
- observability.

Ini akan dibahas lebih jauh di part background workers/message consumers.

---

## 16. Streaming and WebSocket Drain

Streaming punya problem khusus.

### 16.1 Problem

Connection bisa hidup lama:

- WebSocket dashboard;
- SSE notification;
- file download besar;
- report stream;
- long-polling;
- gRPC streaming.

Jika server menunggu semua streaming selesai, shutdown bisa tidak pernah selesai.

### 16.2 Drain strategy

Pola umum:

1. stop accepting new stream;
2. mark existing stream as draining;
3. send application-level close/reconnect event;
4. allow short grace period;
5. close connection;
6. client reconnects to another instance.

Contoh SSE event:

```text
event: server_draining
data: {"reconnectAfterMillis": 1000}
```

WebSocket close reason:

```text
1001 Going Away
```

### 16.3 Jangan simpan critical state hanya di connection

Jika stream/WebSocket membawa state penting, state itu harus:

- dipersist;
- punya sequence number;
- bisa resume;
- bisa replay missed event;
- tidak bergantung pada satu process memory.

---

## 17. Async Work Spawned by Request

Bahaya besar:

```java
@PostMapping("/send")
public ResponseEntity<Void> send(@RequestBody SendCommand command) {
    asyncExecutor.submit(() -> emailService.send(command));
    return ResponseEntity.accepted().build();
}
```

Ini terlihat cepat, tetapi saat shutdown:

- task mungkin belum mulai;
- executor mungkin ditutup;
- task bisa hilang;
- response sudah 202/200;
- tidak ada persistent job;
- client mengira aman.

### 17.1 Rule

Jika response dikirim sebelum work selesai, maka work intent harus durable.

Lebih aman:

```java
@PostMapping("/send")
public ResponseEntity<JobCreatedResponse> send(@RequestBody SendCommand command) {
    JobId jobId = commandService.createDurableEmailJob(command);
    return ResponseEntity.accepted().body(new JobCreatedResponse(jobId.value()));
}
```

Lalu worker mengambil job dari DB/queue.

### 17.2 Shutdown-aware executor

Jika tetap memakai executor internal untuk non-critical work:

```java
public void submitNonCritical(Runnable task) {
    if (drainState.isDraining()) {
        throw new ServiceDrainingException("Cannot accept async task while draining");
    }
    executor.submit(task);
}
```

Tetapi untuk critical work, gunakan durable queue/outbox/job table.

---

## 18. Practical Spring Boot Integration

### 18.1 Configuration baseline

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
management.endpoint.health.probes.enabled=true
management.health.livenessstate.enabled=true
management.health.readinessstate.enabled=true
```

### 18.2 Publish readiness refusing traffic

Spring Boot punya availability states. Saat shutdown, readiness umumnya berubah agar platform berhenti route traffic.

Untuk manual drain endpoint atau preStop integration, bisa buat komponen:

```java
@Component
public final class DrainController {
    private final ApplicationContext context;
    private final ApplicationDrainState drainState;

    public DrainController(ApplicationContext context, ApplicationDrainState drainState) {
        this.context = context;
        this.drainState = drainState;
    }

    public void beginDrain() {
        drainState.startDraining();
        AvailabilityChangeEvent.publish(
                context,
                ReadinessState.REFUSING_TRAFFIC
        );
    }
}
```

### 18.3 SmartLifecycle for drain start

```java
@Component
public final class DrainLifecycle implements SmartLifecycle {
    private final ApplicationDrainState drainState;
    private volatile boolean running = false;

    public DrainLifecycle(ApplicationDrainState drainState) {
        this.drainState = drainState;
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop(Runnable callback) {
        drainState.startDraining();
        running = false;
        callback.run();
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MIN_VALUE;
    }
}
```

Catatan:

- ordering lifecycle harus diuji;
- jangan mengandalkan satu bean untuk semua server behavior;
- pastikan filter admission melihat drain state secepat mungkin.

---

## 19. Kubernetes Deployment Pattern

### 19.1 Baseline YAML concept

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: example/case-service:1.0.0
          ports:
            - containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    wget -qO- http://127.0.0.1:8080/internal/drain || true
                    sleep 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            failureThreshold: 1
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
```

### 19.2 Important nuance

`preStop` + `sleep` sering dipakai untuk memberi waktu endpoint removal menyebar. Namun sleep bukan solusi universal.

Hal yang perlu diseimbangkan:

- terlalu pendek: traffic masih masuk saat app sudah stopping;
- terlalu panjang: rollout lambat;
- terlalu panjang + banyak pod: deployment delay besar;
- preStop dihitung dalam termination grace period;
- jika `preStop` terlalu lama, request drain budget justru berkurang.

### 19.3 Better mental model

```text
preStop: start drain + small propagation buffer
application: reject late business request
Spring graceful shutdown: wait accepted request
client: retry idempotently
metrics/logs: prove behavior
```

---

## 20. Observability for Request Draining

Tanpa observability, kamu tidak tahu apakah drain berhasil.

### 20.1 Metrics minimum

```text
app_draining_state{service="case-service"} 0|1
app_draining_since_timestamp_seconds
http_server_requests_active
business_requests_in_flight
business_requests_rejected_draining_total
business_requests_completed_during_draining_total
business_requests_cancelled_during_draining_total
shutdown_drain_duration_seconds
shutdown_forced_termination_total
request_duration_during_draining_seconds
```

### 20.2 Logs minimum

Saat drain mulai:

```json
{
  "event": "APPLICATION_DRAIN_STARTED",
  "service": "case-service",
  "pod": "case-service-abc123",
  "drainBudgetMs": 30000,
  "activeRequests": 12
}
```

Saat request ditolak:

```json
{
  "event": "REQUEST_REJECTED_DRAINING",
  "method": "POST",
  "path": "/cases/123/actions",
  "correlationId": "01J...",
  "retryable": true,
  "idempotencyKeyPresent": true
}
```

Saat drain selesai:

```json
{
  "event": "APPLICATION_DRAIN_COMPLETED",
  "durationMs": 18420,
  "completedRequests": 9,
  "rejectedRequests": 4,
  "cancelledRequests": 1,
  "remainingActiveRequests": 0
}
```

### 20.3 Trace/span tags

Tambahkan atribut:

```text
service.draining=true
request.admission=accepted|rejected_draining
shutdown.remaining_ms=12345
idempotency.key_present=true
```

### 20.4 Alerting

Alert tidak perlu untuk setiap normal drain. Alert perlu untuk:

- forced termination;
- active request masih ada saat process exit;
- high count rejected draining di luar deployment window;
- request duration during draining melebihi budget;
- duplicate command setelah retry;
- unknown transaction outcome.

---

## 21. Testing Request Draining

Request draining harus dites, bukan diasumsikan.

### 21.1 Unit test admission gate

Test:

- normal state accepts business request;
- draining state rejects business request;
- health endpoint tetap allowed;
- response 503 problem detail;
- `Retry-After` present;
- no service method called after rejection.

### 21.2 Integration test long request

Scenario:

1. endpoint `/slow` tidur 10 detik;
2. kirim request;
3. trigger drain;
4. pastikan request pertama selesai;
5. kirim request kedua;
6. pastikan request kedua mendapat 503.

### 21.3 Kubernetes-level test

Scenario:

1. deploy 3 pods;
2. kirim continuous traffic;
3. rolling restart;
4. ukur:
   - 5xx rate;
   - latency spike;
   - duplicate writes;
   - active request at termination;
   - rejected draining count;
   - client retry success.

### 21.4 Commit uncertainty test

Scenario:

1. server commit DB;
2. kill connection sebelum response;
3. client retry dengan idempotency key;
4. server return previous result;
5. assert no duplicate record.

---

## 22. Anti-Patterns

### 22.1 Only setting graceful shutdown property

```properties
server.shutdown=graceful
```

lalu menganggap semua aman.

Masalah:

- readiness propagation race masih ada;
- late requests bisa masuk;
- client retry belum tentu aman;
- long-running request bisa exceed budget;
- async work bisa hilang.

### 22.2 Closing DB pool before request finishes

Jika lifecycle ordering salah, request aktif bisa gagal karena datasource sudah ditutup.

Gejala:

```text
SQLException: HikariDataSource has been closed
```

Solusi:

- lifecycle phase ordering;
- graceful server stop sebelum resource close;
- integration test shutdown.

### 22.3 Accepting mutation during draining

Saat draining, service masih menerima `POST`/`PUT` baru.

Risiko:

- request mulai tapi tidak selesai;
- duplicate retry;
- partial side effect;
- user-visible inconsistency.

### 22.4 Returning fake success

Sistem menolak pekerjaan tetapi response sukses.

Ini bukan graceful shutdown; ini data loss.

### 22.5 No idempotency for critical mutation

Retry saat deploy menjadi sumber duplicate data.

### 22.6 Infinite long-running request

Server menunggu request yang tidak pernah selesai sampai Kubernetes kill process.

### 22.7 Killing liveness during drain

Jika liveness gagal saat drain, Kubernetes bisa mempercepat kill/restart dan memotong graceful window.

Readiness boleh false. Liveness harus tetap true selama process sehat dan sedang shutdown normal.

### 22.8 Logging every rejected drain request as ERROR

Request ditolak karena draining saat deployment normal bukan selalu application error.

Gunakan:

- `INFO` untuk drain start/end;
- `DEBUG`/sampled `INFO` untuk rejected draining normal;
- `WARN` jika volume abnormal;
- `ERROR` untuk forced kill, unknown outcome, or data risk.

---

## 23. Design Checklist

### 23.1 Application lifecycle

- [ ] Ada explicit draining state.
- [ ] Draining state berubah sebelum resource ditutup.
- [ ] Readiness menjadi refusing traffic saat drain.
- [ ] Business admission gate menolak late request.
- [ ] Infrastructure endpoints tetap tersedia seperlunya.
- [ ] Shutdown budget diketahui dan dikonfigurasi.
- [ ] Drain budget lebih kecil dari total termination grace period.

### 23.2 HTTP request

- [ ] Request baru saat draining mendapat 503, bukan fake 200.
- [ ] Response memakai stable error code seperti `SERVICE_DRAINING`.
- [ ] `Retry-After` dipertimbangkan untuk client.
- [ ] Error response tidak membocorkan internal state.
- [ ] Accepted in-flight request punya kesempatan selesai.
- [ ] Long-running request punya deadline.

### 23.3 Mutation safety

- [ ] Critical write API punya idempotency key atau command id.
- [ ] Retry duplicate menghasilkan same outcome, bukan duplicate side effect.
- [ ] Commit uncertainty punya lookup/reconciliation strategy.
- [ ] Request tanpa idempotency tidak disarankan untuk critical mutation.

### 23.4 Async work

- [ ] Response tidak dikirim sebelum critical work durable.
- [ ] Executor menolak task baru saat draining.
- [ ] Durable job/outbox digunakan untuk critical async work.
- [ ] Worker punya shutdown-safe checkpoint.

### 23.5 Kubernetes/platform

- [ ] `terminationGracePeriodSeconds` cukup realistis.
- [ ] `preStop` tidak menghabiskan seluruh grace period.
- [ ] Readiness probe period/failure threshold sesuai kebutuhan drain.
- [ ] Liveness tidak gagal saat normal drain.
- [ ] Load balancer deregistration delay dipahami.
- [ ] Rolling update diuji dengan traffic nyata/simulasi.

### 23.6 Observability

- [ ] Active request count tersedia.
- [ ] Rejected draining count tersedia.
- [ ] Drain duration tersedia.
- [ ] Forced termination terdeteksi.
- [ ] Correlation ID tetap ada di rejected response.
- [ ] Deployment window bisa dikorelasikan dengan 503 draining.

---

## 24. Reference Implementation Sketch

Berikut gambaran komponen minimal.

```text
ApplicationDrainState
  - stores draining flag
  - stores draining start time

ShutdownDeadline
  - stores drain deadline
  - exposes remaining budget

DrainEndpoint / Lifecycle Hook
  - sets draining=true
  - publishes readiness refusing traffic

AdmissionFilter
  - allows health/metrics
  - rejects new business request if draining

InFlightTrackingFilter
  - counts accepted business requests

Business Handler
  - checks deadline before expensive work
  - requires idempotency for mutation

Metrics
  - exposes draining state
  - active requests
  - rejected requests
  - drain duration
```

### 24.1 Internal drain endpoint

```java
@RestController
@RequestMapping("/internal")
public final class InternalDrainEndpoint {
    private final DrainCoordinator drainCoordinator;

    public InternalDrainEndpoint(DrainCoordinator drainCoordinator) {
        this.drainCoordinator = drainCoordinator;
    }

    @PostMapping("/drain")
    public ResponseEntity<Void> drain() {
        drainCoordinator.beginDrain("internal-endpoint");
        return ResponseEntity.accepted().build();
    }
}
```

### 24.2 Coordinator

```java
@Component
public final class DrainCoordinator {
    private final ApplicationContext applicationContext;
    private final ApplicationDrainState drainState;
    private final ShutdownDeadline shutdownDeadline;

    public DrainCoordinator(
            ApplicationContext applicationContext,
            ApplicationDrainState drainState,
            ShutdownDeadline shutdownDeadline
    ) {
        this.applicationContext = applicationContext;
        this.drainState = drainState;
        this.shutdownDeadline = shutdownDeadline;
    }

    public void beginDrain(String reason) {
        drainState.startDraining();
        shutdownDeadline.start(Duration.ofSeconds(30));

        AvailabilityChangeEvent.publish(
                applicationContext,
                ReadinessState.REFUSING_TRAFFIC
        );

        // log structured event: DRAIN_STARTED
        // increment metric/gauge
    }
}
```

### 24.3 Domain mutation with idempotency

```java
@PostMapping("/cases/{caseId}/actions")
public ResponseEntity<CaseActionResponse> performAction(
        @PathVariable String caseId,
        @RequestHeader("Idempotency-Key") String idempotencyKey,
        @RequestBody PerformCaseActionRequest request
) {
    CaseActionResult result = commandService.perform(
            new PerformCaseActionCommand(
                    caseId,
                    idempotencyKey,
                    request.action(),
                    request.reason()
            )
    );

    return ResponseEntity.status(result.created() ? 201 : 200)
            .body(CaseActionResponse.from(result));
}
```

Key point:

- admission filter sudah menolak request baru saat draining;
- kalau request sudah diterima, idempotency melindungi retry;
- command service harus menyimpan idempotency outcome.

---

## 25. Production Scenario Walkthrough

### Scenario: Rolling deployment case-service

Initial state:

```text
3 pods running:
case-service-1
case-service-2
case-service-3
```

Deployment starts replacing `case-service-1`.

### Step 1 — Pod termination requested

```text
case-service-1 receives termination request
```

Kubernetes menjalankan `preStop`.

### Step 2 — App enters draining

```text
POST /internal/drain
```

App:

- sets `draining=true`;
- publishes readiness refusing traffic;
- starts drain deadline;
- emits `APPLICATION_DRAIN_STARTED`.

### Step 3 — Some late requests still arrive

Karena endpoint propagation delay:

```text
POST /cases/123/actions -> case-service-1
```

Admission filter melihat draining:

```text
503 SERVICE_DRAINING Retry-After: 5
```

Client retry dengan idempotency key ke pod lain.

### Step 4 — Existing request continues

Request yang sudah diterima sebelum draining:

```text
POST /cases/999/actions
```

Service menyelesaikan transaksi karena:

- sudah accepted;
- punya idempotency key;
- estimated duration within budget.

### Step 5 — Long request rejected before expensive stage

Request yang sudah masuk tapi belum mulai expensive step:

```text
POST /reports/generate
```

Service cek remaining budget, tidak cukup, lalu return:

```text
503 SERVICE_DRAINING
```

Karena belum ada side effect, aman.

### Step 6 — Drain completes

Active request count menjadi 0.

App closes server/resources.

### Step 7 — New pod ready

Deployment lanjut.

Expected production metrics:

```text
business_requests_rejected_draining_total > 0 acceptable
unknown_transaction_outcome_total = 0
forced_termination_total = 0
duplicate_mutation_total = 0
```

---

## 26. Deep Principle: Do Not Start What You Cannot Finish or Resume

Saat shutdown, pertanyaan paling penting bukan:

> “Bisa tidak request ini diproses?”

Pertanyaan yang lebih benar:

> “Kalau proses ini terputus di tengah jalan, apakah sistem bisa mengetahui outcome-nya, mencegah duplicate, melanjutkan, atau mengompensasi?”

Jika jawabannya tidak:

- jangan mulai saat draining;
- ubah jadi async durable job;
- wajibkan idempotency;
- kecilkan transaction unit;
- buat checkpoint;
- desain status lookup;
- buat reconciliation.

---

## 27. Review Questions

Gunakan pertanyaan ini untuk mengevaluasi service nyata.

1. Saat pod menerima SIGTERM, kapan aplikasi berhenti menerima business request baru?
2. Apakah readiness berubah sebelum atau sesudah HTTP server berhenti?
3. Apakah late request saat endpoint propagation delay ditolak dengan 503 semantic?
4. Apakah active in-flight request count bisa dilihat dari metric?
5. Apakah long-running request punya deadline lebih kecil dari shutdown budget?
6. Apakah write API penting punya idempotency key?
7. Apa yang terjadi jika commit sukses tapi response gagal dikirim?
8. Apakah client retry bisa membuat duplicate side effect?
9. Apakah async work yang dipicu request durable sebelum response dikirim?
10. Apakah liveness tetap true saat normal draining?
11. Apakah forced termination bisa dideteksi?
12. Apakah deployment dashboard bisa membedakan normal draining 503 dari incident 503?
13. Apakah ada test yang membunuh pod saat request berjalan?
14. Apakah operator punya runbook untuk request stuck saat drain?
15. Apakah service bisa menjelaskan outcome request ambigu melalui correlation/idempotency key?

---

## 28. Summary

Request draining adalah salah satu bagian paling penting dari graceful shutdown.

Mental model utamanya:

```text
Graceful shutdown = stop new work + finish safe in-flight work + reject unsafe work + preserve outcome + guide retry + emit evidence.
```

Hal yang harus diingat:

- readiness tidak cukup;
- graceful shutdown property tidak cukup;
- admission control diperlukan untuk late requests;
- active request tracking diperlukan untuk visibility;
- shutdown budget harus eksplisit;
- long-running synchronous request adalah reliability smell;
- mutation penting butuh idempotency;
- fake success lebih buruk daripada explicit failure;
- client behavior adalah bagian dari reliability design;
- observability harus membuktikan drain behavior.

Engineer top-tier tidak hanya bertanya:

> “Apakah request selesai?”

Tetapi:

> “Jika request tidak selesai, apa state yang mungkin sudah berubah, bagaimana client tahu, bagaimana retry tetap aman, dan evidence apa yang tersisa untuk operator?”

---

## 29. Referensi

- Spring Boot Reference Documentation — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Spring Blog — Liveness and Readiness Probes with Spring Boot: https://spring.io/blog/2020/03/25/liveness-and-readiness-probes-with-spring-boot
- Kubernetes Documentation — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes Documentation — Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- Kubernetes Documentation — Configure Liveness, Readiness and Startup Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes Tutorial — Explore Termination Behavior for Pods and Their Endpoints: https://kubernetes.io/docs/tutorials/services/pods-and-endpoint-termination-flow/
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html

---

## 30. Status Seri

```text
Part 012 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 013 — Background Workers, Schedulers, Queues, and Message Consumers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-011.md">⬅️ Part 011 — Kubernetes, Containers, and Shutdown Reality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-013.md">Part 013 — Background Workers, Schedulers, Queues, and Message Consumers ➡️</a>
</div>
