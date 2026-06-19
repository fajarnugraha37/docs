# learn-http-for-web-backend-perspective-part-021.md

# Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses

> Seri: **HTTP for Web / Backend Perspective**  
> Target pembaca: **Java Software Engineer / Backend Engineer**  
> Fokus: memahami kapan model request-response biasa tidak cukup, bagaimana backend mendesain response asynchronous/streaming, dan bagaimana menjaga correctness, resource safety, observability, security, dan operational reliability.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 020, kita sudah membahas fondasi HTTP backend: semantics, request lifecycle, methods, status codes, headers, body framing, URI modeling, representation, validation, error, idempotency, conditional requests, caching, authentication, authorization, cookies/session/CSRF, CORS, rate limiting, timeout, backpressure, load shedding, file upload/download, dan large payload.

Part ini membahas satu area yang sering disalahpahami:

> HTTP tidak selalu berarti “request singkat, response singkat, selesai”.

Backend modern sering perlu:

- mengirim hasil bertahap,
- memberi progress pekerjaan panjang,
- menjaga koneksi terbuka untuk event,
- membuat client menunggu sampai perubahan tersedia,
- menjalankan job asynchronous lalu menyediakan status/result,
- menghindari timeout gateway,
- menjaga UI tetap responsif tanpa polling agresif,
- mendistribusikan event lifecycle case/workflow.

Namun, setiap bentuk streaming/asynchronous response membawa biaya:

- connection lebih lama hidup,
- thread/event-loop/resource lebih lama tertahan,
- proxy/gateway bisa buffering,
- timeout chain lebih rumit,
- cancellation harus ditangani,
- observability lebih sulit,
- authorization bisa berubah selama stream berjalan,
- retry semantics menjadi tricky,
- load shedding harus lebih disiplin.

Tujuan Part ini bukan hanya tahu istilah SSE atau long polling, tetapi mampu memilih pattern yang benar untuk kebutuhan backend production.

---

## 1. Core Mental Model

HTTP klasik sering dipahami seperti ini:

```text
client sends request
server processes
server sends complete response
connection/request lifecycle ends
```

Untuk banyak API CRUD biasa, model ini cukup.

Tetapi beberapa operasi tidak cocok dengan model tersebut:

1. **Operation lama**
   - generate report besar,
   - import file,
   - validate evidence batch,
   - run compliance scoring,
   - export audit bundle.

2. **Data datang bertahap**
   - logs,
   - notifications,
   - progress updates,
   - workflow event feed,
   - case activity stream.

3. **Client ingin tahu perubahan secepat mungkin**
   - assignment changed,
   - decision approved,
   - document scan completed,
   - supervisor requested revision.

4. **Response terlalu besar untuk dibangun sekaligus**
   - CSV export,
   - NDJSON stream,
   - large search result,
   - incremental aggregation.

Di sini backend punya beberapa pilihan:

```text
A. synchronous request-response
B. async job + polling
C. long polling
D. streaming response
E. Server-Sent Events
F. WebSocket
G. webhook/callback
H. message broker outside HTTP
```

Tidak ada satu pattern yang selalu benar. Pilihan bergantung pada:

- apakah komunikasi satu arah atau dua arah,
- apakah client browser atau machine client,
- apakah event harus durable,
- apakah client harus reconnect,
- apakah server bisa menahan koneksi lama,
- apakah proxy/gateway mendukungnya,
- apakah data perlu ordered,
- apakah backpressure diperlukan,
- apakah client bisa polling,
- apakah operasi harus audit-friendly.

---

## 2. Pattern Selection Map

Gunakan peta awal ini:

| Need | Pattern Umum | Catatan Backend |
|---|---|---|
| Operasi cepat, hasil langsung | synchronous request-response | paling sederhana |
| Operasi lama, hasil nanti | `202 Accepted` + job resource | paling defensible untuk workflow backend |
| Client ingin update status periodik | polling | sederhana, tapi bisa boros |
| Client ingin menunggu perubahan | long polling | mengurangi polling agresif |
| Server kirim event satu arah ke browser | SSE | bagus untuk notification/progress/feed |
| Server kirim data bertahap | streaming response / NDJSON | cocok untuk export/search/log stream |
| Komunikasi dua arah real-time | WebSocket | bukan HTTP request-response biasa setelah upgrade |
| Server notify system lain | webhook | perlu signing, retry, idempotency |
| Reliable internal event distribution | message broker | bukan pengganti HTTP API publik |

Rule of thumb:

> Untuk operasi bisnis yang lama dan penting secara audit, default terbaik biasanya bukan stream, tetapi **async job resource** dengan `202 Accepted`, polling status, idempotency, dan result retrieval.

Streaming cocok ketika:

- data memang naturally incremental,
- client mendapat manfaat nyata dari partial data,
- backend siap mengelola long-lived connections,
- proxy/gateway tidak mem-buffer secara merusak,
- cancellation dan timeout sudah dimodelkan.

---

## 3. Synchronous Request-Response: Baseline yang Harus Tetap Dihormati

Sebelum masuk streaming, pahami baseline.

Synchronous API cocok jika:

- operasi selesai dalam timeout budget,
- hasilnya kecil/sedang,
- client butuh hasil final langsung,
- failure sederhana,
- retry semantics jelas,
- tidak perlu progress intermediate.

Contoh:

```http
GET /cases/C-1001 HTTP/1.1
Accept: application/json
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "C-1001",
  "status": "UNDER_REVIEW"
}
```

Masalah muncul jika operasi sinkron terlalu lama:

```http
POST /reports/enforcement-summary
```

Server butuh 90 detik. Gateway timeout 30 detik. Client timeout 15 detik. Database query timeout 60 detik.

Hasilnya:

- client melihat timeout,
- server mungkin tetap bekerja,
- report mungkin berhasil dibuat,
- client retry,
- report duplicate,
- observability kacau,
- user bingung apakah operasi berhasil.

Sinyal bahwa synchronous model salah:

- client sering timeout,
- user diminta “jangan refresh”,
- endpoint perlu timeout besar,
- load spike membuat thread pool habis,
- retry menghasilkan duplicate side effect,
- gateway perlu special config untuk endpoint tertentu,
- response final tidak selalu diperlukan segera.

---

## 4. Async Job Resource Pattern

Untuk operasi panjang, pola paling robust adalah:

1. Client submit command.
2. Server menerima dan membuat job resource.
3. Server mengembalikan `202 Accepted`.
4. Client polling status job.
5. Client mengambil result saat selesai.

Contoh:

```http
POST /exports/case-audit-bundles HTTP/1.1
Content-Type: application/json
Idempotency-Key: 7f2e0d8b-3d8e-4e7e-a9f9-85ab9a6d1111

{
  "caseId": "C-1001",
  "format": "PDF"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
Location: /exports/case-audit-bundles/J-9001
Retry-After: 5

{
  "jobId": "J-9001",
  "status": "PENDING",
  "statusUrl": "/exports/case-audit-bundles/J-9001"
}
```

Client cek status:

```http
GET /exports/case-audit-bundles/J-9001 HTTP/1.1
Accept: application/json
```

Response pending:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "jobId": "J-9001",
  "status": "RUNNING",
  "progress": {
    "stage": "SCANNING_EVIDENCE",
    "percent": 45
  }
}
```

Response done:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "jobId": "J-9001",
  "status": "SUCCEEDED",
  "result": {
    "downloadUrl": "/exports/case-audit-bundles/J-9001/result"
  }
}
```

Download:

```http
GET /exports/case-audit-bundles/J-9001/result HTTP/1.1
```

### 4.1 Kenapa Pattern Ini Kuat?

Karena ia memisahkan:

- command submission,
- job identity,
- progress,
- final result,
- retry semantics,
- authorization,
- observability,
- audit trail.

Async job resource cocok untuk:

- report generation,
- export,
- import,
- background validation,
- batch processing,
- document conversion,
- malware scanning,
- regulatory evidence bundle creation.

### 4.2 State Machine Job

Model job minimal:

```text
SUBMITTED
  -> PENDING
  -> RUNNING
  -> SUCCEEDED
  -> FAILED
  -> CANCELLED
  -> EXPIRED
```

Lebih detail:

```text
SUBMITTED
  -> VALIDATING_REQUEST
  -> QUEUED
  -> RUNNING
  -> WAITING_FOR_DOWNSTREAM
  -> FINALIZING
  -> SUCCEEDED
```

Failure states:

```text
FAILED_RETRYABLE
FAILED_PERMANENT
CANCEL_REQUESTED
CANCELLED
EXPIRED
```

Poin penting:

- Job resource harus punya stable ID.
- Status harus machine-readable.
- Progress jangan menjanjikan presisi palsu.
- Error job harus menggunakan error model konsisten.
- Result harus authorized terpisah.
- Job harus punya retention policy.
- Submission harus idempotent bila side effect mahal.

### 4.3 Status Code untuk Async Job

Submission:

| Situation | Status |
|---|---|
| Job accepted | `202 Accepted` |
| Job created and immediately available | `201 Created` |
| Duplicate idempotency key, same request | replay previous response |
| Duplicate idempotency key, different request | `409 Conflict` atau `422 Unprocessable Content` |
| Invalid request | `400` / `422` |
| Not authorized | `401` / `403` |
| Rate limited | `429` |
| Queue saturated | `503` + `Retry-After` |

Polling:

| Job State | Status |
|---|---|
| running | `200 OK` |
| succeeded | `200 OK` |
| failed | `200 OK` with job state, atau error resource depending contract |
| not found | `404` |
| expired | `410 Gone` |
| unauthorized | `403` atau `404` concealment |

Cancellation:

```http
POST /exports/case-audit-bundles/J-9001/cancellation-requests
```

atau:

```http
DELETE /exports/case-audit-bundles/J-9001
```

Pilih berdasarkan domain semantics. Kalau job resource dihapus, `DELETE` masuk akal. Kalau cancellation adalah auditable command, cancellation request sub-resource lebih jelas.

---

## 5. Polling

Polling adalah pattern paling sederhana:

```text
client asks periodically
server answers current state
```

Contoh:

```http
GET /jobs/J-9001
```

Response:

```http
HTTP/1.1 200 OK
Retry-After: 5

{
  "status": "RUNNING"
}
```

### 5.1 Kelebihan Polling

- mudah diimplementasikan,
- berjalan di semua proxy,
- mudah diamati,
- mudah diberi rate limit,
- failure recovery sederhana,
- client reconnect natural,
- tidak menahan koneksi lama.

### 5.2 Kekurangan Polling

- boros request jika interval terlalu pendek,
- update tidak real-time,
- thundering herd saat banyak client polling bersamaan,
- perlu caching/rate-limit policy,
- user experience bisa lambat.

### 5.3 Backend Polling Policy

Backend sebaiknya mengarahkan client:

```http
HTTP/1.1 200 OK
Retry-After: 10
Cache-Control: no-store
```

Atau response body:

```json
{
  "status": "RUNNING",
  "recommendedPollAfterSeconds": 10
}
```

Tetapi header lebih HTTP-native.

### 5.4 Adaptive Polling

Interval polling sebaiknya adaptif:

```text
first 10 seconds: every 1 second
next 60 seconds: every 5 seconds
after that: every 30 seconds
```

Server juga bisa mengubah `Retry-After` berdasarkan stage:

- queued: 10–30 detik,
- running fast stage: 2–5 detik,
- waiting external scan: 30–60 detik.

### 5.5 Polling dan Cache

Status job biasanya user-specific dan mutable.

Gunakan:

```http
Cache-Control: no-store
```

atau jika aman untuk private client cache jangka pendek:

```http
Cache-Control: private, max-age=2
```

Hati-hati shared cache. Jangan sampai status job user A terlihat oleh user B.

---

## 6. Long Polling

Long polling adalah variasi polling:

1. Client mengirim request.
2. Server tidak langsung menjawab.
3. Server menunggu sampai ada perubahan atau timeout.
4. Server menjawab.
5. Client segera mengirim request berikutnya.

Contoh:

```http
GET /cases/C-1001/events?wait=30&after=event-120
Accept: application/json
```

Jika event muncul:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "events": [
    {
      "id": "event-121",
      "type": "CASE_ASSIGNED",
      "occurredAt": "2026-06-19T09:30:00Z"
    }
  ],
  "nextCursor": "event-121"
}
```

Jika tidak ada event sampai timeout:

```http
HTTP/1.1 204 No Content
```

atau:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "events": [],
  "nextCursor": "event-120"
}
```

### 6.1 Kapan Long Polling Cocok?

Cocok jika:

- event tidak terlalu sering,
- client butuh update lebih cepat dari polling interval,
- SSE/WebSocket tidak memungkinkan,
- infrastructure kurang mendukung long-lived streaming,
- response tetap discrete dan mudah diretry.

### 6.2 Risiko Long Polling

- koneksi banyak tertahan,
- request timeout harus selaras dengan gateway,
- thread-per-request stack bisa habis jika tidak async,
- client reconnect storm,
- load balancer idle timeout bisa memutus,
- authorization harus dicek saat request dimulai dan mungkin saat event dikirim.

### 6.3 Servlet Stack Long Polling

Di Spring MVC, jangan menahan thread request biasa selama 30 detik untuk ribuan client.

Gunakan async support seperti:

- `DeferredResult<T>`,
- `Callable<T>`,
- `WebAsyncTask<T>`.

Sketch:

```java
@GetMapping("/cases/{caseId}/events")
public DeferredResult<ResponseEntity<EventsResponse>> waitForEvents(
        @PathVariable String caseId,
        @RequestParam String after,
        @RequestParam(defaultValue = "30") long waitSeconds) {

    long timeoutMillis = Math.min(waitSeconds, 30) * 1000;
    DeferredResult<ResponseEntity<EventsResponse>> result = new DeferredResult<>(timeoutMillis);

    Optional<EventsResponse> immediate = eventService.findAfter(caseId, after);
    if (immediate.isPresent()) {
        result.setResult(ResponseEntity.ok(immediate.get()));
        return result;
    }

    eventWaitRegistry.register(caseId, after, result);

    result.onTimeout(() ->
        result.setResult(ResponseEntity.noContent().build())
    );

    result.onCompletion(() ->
        eventWaitRegistry.unregister(result)
    );

    return result;
}
```

Kunci:

- request thread dilepas,
- ada timeout,
- registry dibersihkan,
- authorization dipastikan,
- jumlah waiter dibatasi,
- cancellation ditangani.

### 6.4 WebFlux Long Polling

Sketch:

```java
@GetMapping("/cases/{caseId}/events")
public Mono<ResponseEntity<EventsResponse>> waitForEvents(
        @PathVariable String caseId,
        @RequestParam String after) {

    return eventService.findImmediately(caseId, after)
        .switchIfEmpty(
            eventService.waitForNext(caseId, after)
                .timeout(Duration.ofSeconds(30))
        )
        .map(ResponseEntity::ok)
        .onErrorResume(TimeoutException.class,
            ex -> Mono.just(ResponseEntity.noContent().build()));
}
```

Tetap perlu:

- timeout,
- cancellation,
- max subscribers,
- protection terhadap slow client,
- event source yang non-blocking atau dijadwalkan benar.

---

## 7. Streaming Response

Streaming response berarti server mulai mengirim response sebelum seluruh data selesai diproduksi.

Contoh use case:

- export CSV besar,
- NDJSON search result,
- log tail,
- progress stream,
- AI/token stream,
- incremental report generation.

### 7.1 Streaming Bukan Async Job

Streaming response masih satu request-response lifecycle.

Jika koneksi putus:

- response putus,
- server harus berhenti memproduksi,
- client mungkin perlu retry dari awal atau resume jika didesain.

Async job lebih durable. Streaming lebih immediate.

Pilih streaming jika partial data bermanfaat dan operasi bisa dihentikan saat client disconnect.

Pilih async job jika operasi harus tetap selesai meskipun client disconnect.

---

## 8. Chunked Transfer and Response Commitment

Pada HTTP/1.1, streaming sering memakai chunked transfer.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
Transfer-Encoding: chunked
```

Server mengirim chunk bertahap.

Konsekuensi penting:

> Setelah response status dan header terkirim, server tidak bisa lagi mengubah status menjadi `500` dengan normal.

Jika error terjadi di tengah stream:

- connection bisa ditutup,
- stream bisa mengirim event/error record jika format mendukung,
- client harus memahami partial result.

Maka format stream perlu error semantics.

Contoh NDJSON:

```json
{"type":"record","data":{"caseId":"C-1"}}
{"type":"record","data":{"caseId":"C-2"}}
{"type":"error","code":"EXPORT_PARTIAL_FAILURE","message":"Export interrupted"}
```

Atau untuk CSV, error di tengah lebih sulit karena CSV tidak punya envelope natural.

Karena itu CSV export besar sering lebih baik async job + downloadable file.

---

## 9. NDJSON Streaming

NDJSON = newline-delimited JSON.

Setiap baris adalah JSON object.

```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
```

Body:

```json
{"id":"C-1001","status":"OPEN"}
{"id":"C-1002","status":"UNDER_REVIEW"}
{"id":"C-1003","status":"CLOSED"}
```

### 9.1 Kelebihan NDJSON

- mudah diproses incremental,
- tidak perlu menunggu array JSON lengkap,
- memory efficient,
- cocok untuk result besar,
- bisa mengandung envelope event,
- client bisa parse line-by-line.

### 9.2 Dibanding JSON Array

JSON array biasa:

```json
[
  {"id":"C-1001"},
  {"id":"C-1002"}
]
```

Masalah:

- array valid hanya setelah closing bracket,
- error di tengah membuat JSON invalid,
- banyak serializer akan membangun struktur besar,
- client sering menunggu response penuh.

NDJSON lebih cocok untuk streaming.

### 9.3 Spring WebFlux NDJSON

```java
@GetMapping(value = "/cases/export", produces = "application/x-ndjson")
public Flux<CaseExportRow> exportCases() {
    return caseExportService.streamRows();
}
```

Pastikan:

- repository mendukung streaming/non-blocking atau blocking call dipindahkan ke scheduler tepat,
- backpressure dihormati,
- timeout dan cancellation ditangani,
- data authorization dicek per query, bukan per row post-filter mahal.

---

## 10. Server-Sent Events

Server-Sent Events atau SSE adalah mekanisme server mengirim event satu arah ke client melalui HTTP response panjang.

Typical response:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Body:

```text
id: event-121
event: case-assigned
data: {"caseId":"C-1001","assignee":"investigator-7"}

id: event-122
event: evidence-scan-completed
data: {"caseId":"C-1001","status":"CLEAN"}

```

### 10.1 SSE Cocok untuk Apa?

SSE cocok untuk:

- notification feed,
- progress update,
- workflow events,
- dashboard live update,
- audit event stream read model,
- case lifecycle update.

SSE tidak cocok untuk:

- bidirectional chat intensif,
- binary stream,
- high-frequency low-latency gaming,
- durable guaranteed event delivery tanpa mekanisme tambahan,
- komunikasi internal service yang butuh strict delivery guarantee.

### 10.2 SSE vs WebSocket

| Aspect | SSE | WebSocket |
|---|---|---|
| Direction | server to client | bidirectional |
| Protocol | HTTP response stream | upgrade/protocol berbeda |
| Browser API | EventSource | WebSocket |
| Reconnect | built-in-ish by browser | manual |
| Text event | natural | manual framing |
| Binary | tidak cocok | cocok |
| Proxy compatibility | sering lebih mudah, tapi buffering perlu dicek | bisa lebih rumit |
| Backend complexity | lebih rendah | lebih tinggi |

Jika kebutuhan hanya server-to-client event, SSE sering lebih sederhana daripada WebSocket.

### 10.3 SSE Event Fields

SSE mendukung field:

```text
id: <event id>
event: <event name>
data: <payload>
retry: <milliseconds>
```

Contoh:

```text
retry: 5000
id: case-C-1001-000121
event: case.status.changed
data: {"caseId":"C-1001","from":"OPEN","to":"UNDER_REVIEW"}

```

`id` penting untuk resume.

Browser dapat mengirim `Last-Event-ID` saat reconnect.

### 10.4 SSE Resume

Client reconnect:

```http
GET /cases/C-1001/events/stream HTTP/1.1
Accept: text/event-stream
Last-Event-ID: case-C-1001-000121
```

Server bisa mengirim event setelah ID tersebut.

Untuk mendukung resume, backend perlu event store atau durable cursor.

Tanpa event store, SSE hanya live stream. Jika koneksi putus, event bisa hilang.

### 10.5 SSE Heartbeat

Proxy/load balancer bisa menutup koneksi idle. Gunakan heartbeat/comment:

```text
: heartbeat

```

atau event heartbeat:

```text
event: heartbeat
data: {}

```

Interval harus lebih pendek dari idle timeout terendah di chain.

Jika load balancer idle timeout 60 detik, heartbeat 20–30 detik lebih aman.

### 10.6 Spring MVC SSE

Spring MVC menyediakan `SseEmitter`.

Sketch:

```java
@GetMapping("/cases/{caseId}/events/stream")
public SseEmitter streamCaseEvents(@PathVariable String caseId) {
    authorizeViewCase(caseId);

    SseEmitter emitter = new SseEmitter(Duration.ofMinutes(30).toMillis());

    String subscriptionId = eventHub.subscribe(caseId, event -> {
        try {
            emitter.send(SseEmitter.event()
                .id(event.id())
                .name(event.type())
                .data(event.payload()));
        } catch (IOException ex) {
            emitter.completeWithError(ex);
        }
    });

    emitter.onCompletion(() -> eventHub.unsubscribe(subscriptionId));
    emitter.onTimeout(() -> {
        eventHub.unsubscribe(subscriptionId);
        emitter.complete();
    });
    emitter.onError(ex -> eventHub.unsubscribe(subscriptionId));

    return emitter;
}
```

Critical points:

- cleanup subscription,
- cap active emitters,
- heartbeat,
- authorization,
- error handling,
- timeout,
- avoid blocking request threads,
- avoid unbounded in-memory queues per client.

### 10.7 WebFlux SSE

```java
@GetMapping(value = "/cases/{caseId}/events/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<CaseEventDto>> streamCaseEvents(@PathVariable String caseId) {
    authorizeViewCase(caseId);

    return caseEventService.stream(caseId)
        .map(event -> ServerSentEvent.<CaseEventDto>builder()
            .id(event.id())
            .event(event.type())
            .data(event.payload())
            .build())
        .mergeWith(heartbeatFlux());
}
```

Need to handle:

- cancellation when client disconnects,
- backpressure,
- event store cursor,
- blocking source adaptation,
- max subscribers,
- memory pressure.

---

## 11. Proxy Buffering Problem

Streaming often fails not because app code is wrong, but because proxy buffers response.

Path:

```text
client
  -> CDN
  -> load balancer
  -> API gateway
  -> Nginx/Envoy
  -> application
```

A proxy may buffer server response until:

- buffer fills,
- upstream completes,
- timeout,
- flush boundary ignored.

Symptoms:

- backend logs show events sent,
- client receives nothing until end,
- SSE appears “stuck”,
- heartbeat not visible,
- memory usage grows at proxy,
- long streaming endpoint times out.

### 11.1 Backend Must Know Edge Behavior

For streaming/SSE endpoints, verify:

- response buffering disabled where needed,
- idle timeout configured,
- max response duration known,
- compression behavior understood,
- chunk flushing supported,
- HTTP/2 behavior tested,
- gateway does not transform stream.

Nginx commonly needs settings such as buffering off for specific locations. Exact config depends on deployment, but backend engineer must know that app-level streaming is insufficient if edge buffers.

### 11.2 Compression and Streaming

Compression can introduce buffering.

For SSE, often avoid gzip unless tested carefully.

Reason:

- compressor may buffer small events,
- client sees delayed events,
- heartbeat loses value.

For large NDJSON export, compression may be useful if flush behavior is acceptable.

---

## 12. Timeout Chain for Streaming

Streaming endpoints need different timeout thinking.

Normal request:

```text
client timeout: 10s
lb timeout: 15s
app timeout: 12s
```

SSE endpoint:

```text
client may hold for hours
lb idle timeout: 60s
gateway max duration: 30m
app emitter timeout: 30m
heartbeat every 25s
```

Important distinctions:

- **idle timeout**: no bytes sent for period.
- **request duration timeout**: total request time exceeds limit.
- **read timeout**: waiting for upstream read.
- **write timeout**: writing to slow client.

A heartbeat only helps idle timeout, not max duration timeout.

If gateway kills all requests after 60 seconds total, SSE cannot run longer unless gateway config changes.

---

## 13. Cancellation and Client Disconnect

For long-lived requests, client disconnect is normal, not exceptional.

Causes:

- browser tab closed,
- network change,
- mobile sleep,
- reverse proxy timeout,
- user navigates away,
- client intentionally cancels.

Backend must:

- stop producing data,
- release subscriptions,
- close database cursor,
- cancel downstream call if possible,
- decrement active connection metrics,
- avoid logging expected disconnect as severe error.

### 13.1 Response Already Committed

If response is committed and client disconnects:

- writing may throw `IOException`,
- WebFlux may receive cancellation signal,
- emitter complete/error hooks should cleanup.

Do not keep background task running unless operation is intentionally decoupled as async job.

---

## 14. Backpressure and Slow Clients

Streaming creates a classic problem:

```text
server produces faster than client consumes
```

Possible outcomes:

- memory buffer grows,
- event loop blocked,
- response write stalls,
- other clients affected,
- app OOM,
- proxy buffers explosively.

### 14.1 Strategies

1. **Bound per-client queue**
   - drop oldest,
   - drop newest,
   - disconnect slow client,
   - send summary event.

2. **Use reactive backpressure where real**
   - `Flux` can propagate demand if source supports it.

3. **Throttle event rate**
   - coalesce frequent events.

4. **Separate live notification from durable retrieval**
   - SSE says “case changed”; client fetches latest state.

5. **Disconnect clients that cannot keep up**
   - better than harming entire service.

### 14.2 Coalescing Pattern

Instead of sending every tiny update:

```text
CASE_FIELD_CHANGED
CASE_FIELD_CHANGED
CASE_FIELD_CHANGED
CASE_FIELD_CHANGED
```

Send:

```text
CASE_UPDATED
```

Client then fetches current state:

```http
GET /cases/C-1001
```

This reduces stream load and avoids leaking field-level details.

---

## 15. Event Semantics for Streaming

For event streams, define semantics clearly.

Questions:

1. Is event durable or best-effort?
2. Are events ordered?
3. Is ordering per resource, per tenant, or global?
4. Can events be duplicated?
5. Can events be missed?
6. Can event payload contain full data or only reference?
7. How does client resume?
8. What is retention window?
9. What happens after authorization changes?
10. Are event IDs stable?

### 15.1 Event ID Design

Bad:

```text
id: 1
id: 2
id: 3
```

Why bad?

- ambiguous across tenants/resources,
- hard to shard,
- may reveal global activity count.

Better:

```text
id: case-C-1001-0000000121
```

or opaque:

```text
id: eyJjYXNlSWQiOiJDLTEwMDEiLCJzZXEiOjEyMX0
```

### 15.2 Full Payload vs Reference Event

Full payload:

```json
{
  "type": "CASE_ASSIGNED",
  "caseId": "C-1001",
  "assignee": "investigator-7"
}
```

Reference event:

```json
{
  "type": "CASE_CHANGED",
  "caseId": "C-1001",
  "resourceUrl": "/cases/C-1001"
}
```

Reference event is safer when:

- authorization changes rapidly,
- payload contains sensitive data,
- clients need latest state anyway,
- event payload compatibility is hard.

Full payload is useful when:

- client must avoid extra fetch,
- event is immutable audit fact,
- payload is small and stable,
- authorization can be enforced at stream construction and event emission.

---

## 16. Authorization for Long-Lived Streams

Authorization for normal request happens once.

Long-lived stream introduces additional questions:

- What if user's role is revoked while stream is open?
- What if case is reassigned to another team?
- What if tenant access changes?
- What if session expires?
- What if token expires during stream?

Possible policies:

1. **Authorize only at connection time**
   - simpler,
   - risk: stale access.

2. **Authorize every event before sending**
   - safer,
   - more expensive.

3. **Short-lived streams with reconnect**
   - balances complexity,
   - token/session checked again periodically.

4. **Send only low-sensitivity invalidation events**
   - client must refetch with fresh authorization.

For regulatory systems, safer default:

> authorize stream at connection time, keep stream duration bounded, and perform event-level authorization or send only reference/invalidation events for sensitive data.

---

## 17. Security Risks

Streaming endpoints are abuse-prone.

Risks:

1. **Connection exhaustion**
   - attacker opens many SSE/long-poll connections.

2. **Slow client attack**
   - client reads slowly, server buffers.

3. **Unbounded subscriptions**
   - each connection subscribes to many resources.

4. **Sensitive data leakage**
   - stream emits events after authorization changes.

5. **Cache/proxy mishandling**
   - event stream cached incorrectly.

6. **CSRF-like browser connection risk**
   - cookie-authenticated SSE can be opened cross-site if CORS/cookie policy wrong, though reading response is governed by browser rules.

7. **Token leakage in URL**
   - EventSource historically makes custom headers harder in browser, tempting developers to put token in query string. Avoid this when possible.

8. **Log leakage**
   - stream query params with token/cursor may enter logs.

### 17.1 Protection Checklist

For streaming endpoints:

- require authentication,
- enforce authorization,
- cap active streams per user/tenant/IP,
- cap subscriptions per stream,
- set max duration,
- send heartbeat,
- bound queues,
- disconnect slow clients,
- avoid sensitive payloads if possible,
- use `Cache-Control: no-store` or appropriate no-cache policy,
- avoid tokens in URL,
- observe active connection counts,
- rate-limit reconnects,
- audit subscription open/close for sensitive streams.

---

## 18. Observability for Streaming

Normal HTTP metrics are insufficient.

For standard request:

- count,
- latency,
- status,
- size.

For streaming:

- active streams,
- stream duration,
- events sent per stream,
- bytes sent per stream,
- disconnect reason,
- timeout count,
- heartbeat failure,
- per-client queue depth,
- dropped/coalesced event count,
- slow client disconnect count,
- reconnect rate,
- authorization-denied event count,
- upstream subscription lag.

### 18.1 Logging

Log stream lifecycle:

```json
{
  "event": "sse_stream_opened",
  "streamType": "case-events",
  "caseId": "C-1001",
  "userId": "U-7",
  "tenantId": "T-1",
  "correlationId": "req-abc",
  "lastEventId": "case-C-1001-000120"
}
```

On close:

```json
{
  "event": "sse_stream_closed",
  "durationMs": 1800000,
  "eventsSent": 42,
  "bytesSent": 12844,
  "closeReason": "client_disconnect"
}
```

Avoid logging full event payload if sensitive.

### 18.2 Metrics

Example metric names:

```text
http_stream_active{type="sse", endpoint="case-events"}
http_stream_duration_seconds{type="sse"}
http_stream_events_sent_total{event_type="case.status.changed"}
http_stream_client_disconnect_total{reason="write_failed"}
http_stream_queue_depth{endpoint="case-events"}
http_stream_events_dropped_total{reason="slow_client"}
```

Careful with high-cardinality labels:

Bad label:

```text
case_id="C-1001"
```

Better:

```text
tenant_tier="enterprise"
endpoint="case-events"
stream_type="sse"
```

Case ID belongs in logs/traces, not metrics label.

---

## 19. Testing Streaming Endpoints

Testing must cover more than happy path.

### 19.1 Functional Tests

- client receives event,
- event ID present,
- event order correct,
- heartbeat emitted,
- reconnect with `Last-Event-ID`,
- unauthorized request rejected,
- expired cursor handled,
- empty long-poll returns timeout response.

### 19.2 Failure Tests

- client disconnects,
- server cleans subscription,
- slow client is disconnected,
- event source fails,
- proxy timeout simulated,
- response write throws,
- heartbeat stops,
- token/session expires,
- role revoked mid-stream.

### 19.3 Load Tests

- many idle streams,
- many active streams,
- reconnect storm,
- one tenant heavy load,
- high event rate,
- slow clients,
- gateway buffering behavior.

### 19.4 Manual Debug Tools

SSE with curl:

```bash
curl -N \
  -H 'Accept: text/event-stream' \
  -H 'Authorization: Bearer <token>' \
  http://localhost:8080/cases/C-1001/events/stream
```

NDJSON:

```bash
curl -N \
  -H 'Accept: application/x-ndjson' \
  http://localhost:8080/cases/export
```

Long polling:

```bash
curl -v \
  'http://localhost:8080/cases/C-1001/events?wait=30&after=event-120'
```

`-N` disables curl buffering.

---

## 20. Java/Spring Design Patterns

### 20.1 Spring MVC Pattern Choices

| Need | Spring MVC Tool |
|---|---|
| async single response | `DeferredResult`, `Callable`, `WebAsyncTask` |
| SSE | `SseEmitter` |
| streaming response | `StreamingResponseBody` |
| file download | `Resource`, `InputStreamResource`, `ResponseEntity` |

Example `StreamingResponseBody`:

```java
@GetMapping(value = "/exports/cases.ndjson", produces = "application/x-ndjson")
public ResponseEntity<StreamingResponseBody> exportCases() {
    StreamingResponseBody body = outputStream -> {
        caseExportService.writeNdjson(outputStream);
    };

    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .body(body);
}
```

Caution:

- do not load all rows into memory,
- flush intentionally,
- handle IOException,
- close resources,
- apply authorization before query,
- ensure database cursor/transaction lifecycle is correct,
- avoid long transaction holding locks.

### 20.2 WebFlux Pattern Choices

| Need | WebFlux Tool |
|---|---|
| async single response | `Mono<T>` |
| stream multiple records | `Flux<T>` |
| SSE | `Flux<ServerSentEvent<T>>` |
| streaming data buffers | `Flux<DataBuffer>` |
| reactive HTTP client | `WebClient` |

Example stream:

```java
@GetMapping(value = "/cases/export", produces = MediaType.APPLICATION_NDJSON_VALUE)
public Flux<CaseExportRow> export() {
    return caseExportService.streamAuthorizedRows();
}
```

Caution:

- reactive chain must not block event loop,
- database driver must support streaming or be adapted carefully,
- cancellation must close cursor/subscription,
- backpressure only works if source respects demand,
- DataBuffer leaks are serious in low-level code.

---

## 21. Async Job + SSE Hybrid

Often best UX uses hybrid pattern:

1. Client submits async job.
2. Server returns `202` and job URL.
3. Client opens SSE stream for job progress.
4. If SSE disconnects, client falls back to polling job URL.
5. Result is downloaded from job result URL.

Submission:

```http
POST /exports/case-audit-bundles
```

Response:

```json
{
  "jobId": "J-9001",
  "statusUrl": "/exports/case-audit-bundles/J-9001",
  "eventsUrl": "/exports/case-audit-bundles/J-9001/events",
  "resultUrl": null
}
```

SSE:

```http
GET /exports/case-audit-bundles/J-9001/events
Accept: text/event-stream
```

Events:

```text
event: job.progress
data: {"jobId":"J-9001","stage":"COLLECTING_EVIDENCE","percent":30}


event: job.succeeded
data: {"jobId":"J-9001","resultUrl":"/exports/case-audit-bundles/J-9001/result"}

```

Why hybrid is strong:

- job is durable,
- SSE improves UX,
- polling fallback works,
- result retrieval is separate,
- disconnect does not kill job,
- audit trail clear.

---

## 22. Regulatory Case Management Example

Scenario:

A regulatory enforcement platform supports:

- case assignment,
- evidence upload,
- malware scan,
- document classification,
- supervisor review,
- escalation,
- decision approval,
- audit bundle export.

### 22.1 Good Pattern Choices

| Requirement | Recommended Pattern |
|---|---|
| View case details | synchronous `GET /cases/{id}` |
| Submit evidence | upload session / multipart / object storage offload |
| Track evidence scan progress | async job + polling/SSE |
| Receive case activity updates | SSE event stream |
| Export audit bundle | async job + result download |
| Wait for next case event in legacy client | long polling |
| Notify external agency | webhook with signing + retry |
| Internal processing pipeline | message broker/event bus |

### 22.2 Case Event Stream

Endpoint:

```http
GET /cases/C-1001/events/stream
Accept: text/event-stream
```

Events:

```text
id: case-C-1001-000201
event: case.assignment.changed
data: {"caseId":"C-1001","assignedTeam":"LEGAL_REVIEW"}

id: case-C-1001-000202
event: evidence.scan.completed
data: {"caseId":"C-1001","evidenceId":"E-77","scanStatus":"CLEAN"}

id: case-C-1001-000203
event: case.status.changed
data: {"caseId":"C-1001","from":"UNDER_REVIEW","to":"READY_FOR_DECISION"}

```

But for sensitive environments, payload may be reduced:

```text
id: case-C-1001-000203
event: case.changed
data: {"caseId":"C-1001","resourceUrl":"/cases/C-1001"}

```

### 22.3 Authorization Policy

- User must have `case:view` permission at connection time.
- Event emission checks whether user still has case visibility.
- Stream max duration 30 minutes.
- Client reconnects with fresh token/session.
- Payload minimized.
- Audit log records stream open/close for sensitive cases.

### 22.4 Backpressure Policy

- Per-user max 5 active case streams.
- Per-tenant max N active streams based on plan.
- Per-stream queue max 100 events.
- If queue full, send `case.resync.required` or disconnect.

Example:

```text
event: resync.required
data: {"reason":"EVENT_QUEUE_OVERFLOW","resourceUrl":"/cases/C-1001"}

```

Client then fetches latest state.

---

## 23. Anti-Patterns

### Anti-Pattern 1: Streaming Everything

Problem:

- unnecessary complexity,
- harder failure handling,
- proxy issues,
- poor observability.

Better:

- synchronous for fast operations,
- async job for long operations,
- SSE only for real event updates.

### Anti-Pattern 2: Long Request for Long Job

```http
POST /exports/report
```

Server holds request for 3 minutes.

Better:

```http
202 Accepted
Location: /exports/jobs/J-1
```

### Anti-Pattern 3: SSE Without Heartbeat

Works locally. Fails behind load balancer.

Better:

- heartbeat interval below idle timeout,
- verify gateway behavior.

### Anti-Pattern 4: No Cleanup on Disconnect

Client disconnects, server keeps subscription.

Result:

- memory leak,
- ghost subscribers,
- event fanout cost grows.

### Anti-Pattern 5: Unbounded Queue per Client

Slow client causes memory growth.

Better:

- bounded queue,
- drop/coalesce/disconnect policy.

### Anti-Pattern 6: EventSource Token in Query String

```text
/events?access_token=...
```

Risk:

- logs,
- browser history,
- referer leakage,
- proxy logs.

Better:

- cookie session with CSRF/CORS policy where appropriate,
- short-lived signed stream token with careful logging redaction if unavoidable,
- consider fetch-based streaming if custom headers required.

### Anti-Pattern 7: Streaming CSV with Mid-Stream Failure Ambiguity

If error happens halfway, client may treat partial CSV as complete.

Better:

- async job creates complete file,
- result available only after success,
- include checksum/size metadata.

### Anti-Pattern 8: Treating SSE as Durable Message Queue

SSE is delivery mechanism, not durable broker.

Better:

- persist events if resume/replay required,
- use message broker for internal reliable distribution,
- expose cursor-based event API.

---

## 24. Design Checklist

Before choosing streaming/long polling/SSE, answer:

1. Is operation durable or tied to connection?
2. What happens if client disconnects?
3. Is partial result useful?
4. Can client resume?
5. Are event IDs stable?
6. Is event delivery best-effort or durable?
7. What is max stream duration?
8. What is idle heartbeat interval?
9. What is proxy/gateway timeout?
10. Does proxy buffer responses?
11. What is max active connection per user/IP/tenant?
12. What is queue bound per client?
13. What happens to slow clients?
14. Are events authorized per connection or per event?
15. What if authorization changes mid-stream?
16. What cache headers are sent?
17. Is response compression safe?
18. How are errors represented after response commit?
19. What metrics exist for active streams and disconnects?
20. What is fallback if streaming unavailable?

---

## 25. Practical Decision Framework

### Use synchronous response when:

- operation finishes quickly,
- response is not huge,
- timeout budget is safe,
- result is needed immediately.

### Use async job when:

- operation can exceed request timeout,
- result must be durable,
- operation has side effects,
- progress/status matters,
- retry safety matters,
- auditability matters.

### Use polling when:

- simplicity matters,
- update latency can be seconds,
- infrastructure is constrained,
- client count is moderate.

### Use long polling when:

- event frequency is low,
- client needs faster update than polling,
- SSE/WebSocket not possible,
- you can handle many waiting requests safely.

### Use SSE when:

- server-to-client event stream,
- browser clients,
- text events,
- reconnect/resume desired,
- bidirectional messaging not required.

### Use WebSocket when:

- true bidirectional low-latency communication,
- client sends frequent messages,
- protocol must remain open both ways,
- team can handle stateful connection complexity.

### Use webhook when:

- server needs to notify another backend,
- recipient exposes callback URL,
- retry/signing/idempotency are implemented.

---

## 26. Exercises

### Exercise 1 — Choose the Pattern

For each requirement, choose sync, async job, polling, long polling, SSE, WebSocket, or webhook:

1. User exports 2GB audit bundle.
2. UI shows case assignment changes in near-real-time.
3. External agency must be notified when decision is published.
4. User runs search returning 500K rows for machine processing.
5. Browser displays progress of evidence malware scan.
6. Investigator dashboard shows “new case assigned” within 5 seconds.
7. Internal service needs guaranteed processing of case events.

Explain why.

### Exercise 2 — Design an Async Export API

Design endpoints for:

- submit export,
- check status,
- stream progress,
- cancel job,
- download result,
- retrieve error details.

Include:

- status codes,
- headers,
- idempotency,
- authorization,
- retry behavior.

### Exercise 3 — SSE Failure Model

For an SSE case event stream, define behavior for:

- client disconnect,
- gateway idle timeout,
- role revoked mid-stream,
- event queue overflow,
- duplicate event,
- missed event after reconnect,
- event store retention expired.

### Exercise 4 — Proxy Readiness

Create a checklist for deploying SSE behind:

- CDN,
- load balancer,
- Nginx,
- API gateway,
- Spring Boot app.

Include timeout, buffering, compression, header, observability, and load limit.

---

## 27. Summary

Streaming and asynchronous HTTP patterns are powerful, but dangerous if treated as mere framework features.

Key points:

1. Synchronous request-response is simplest but not suitable for long operations.
2. Async job resource is often the most robust pattern for durable long-running work.
3. Polling is simple and operationally friendly, but can be inefficient.
4. Long polling reduces polling waste but holds server resources longer.
5. Streaming response is useful for incremental data, but failure after response commit is tricky.
6. NDJSON is often better than JSON array for incremental machine-readable streams.
7. SSE is excellent for one-way browser event streams, but requires heartbeat, cleanup, limits, and proxy testing.
8. WebSocket is not automatically better; use it when bidirectional communication is truly needed.
9. Long-lived streams require explicit cancellation, timeout, backpressure, and authorization policies.
10. Proxy buffering and idle timeout can break correct application code.
11. Observability must include active streams, events sent, disconnects, queue depth, and slow client behavior.
12. For regulatory/case-management systems, async job + polling/SSE hybrid is usually the most defensible architecture.

The professional backend mindset is:

> Do not choose streaming because it feels real-time. Choose it only when the domain, client behavior, infrastructure, and failure model justify long-lived HTTP interactions.

---

## 28. Status Seri

Kita sudah menyelesaikan:

- Part 000 — Orientation
- Part 001 — HTTP Semantics from Server Point of View
- Part 002 — Request Lifecycle: From Socket to Controller
- Part 003 — Methods Deep Dive for Backend Correctness
- Part 004 — Status Codes as Backend State Contracts
- Part 005 — Headers as Backend Control Plane
- Part 006 — Request Body, Response Body, and Message Framing
- Part 007 — URI, Routing, and Resource Modeling
- Part 008 — Content Negotiation and Representation Design
- Part 009 — Validation, Parsing, and Defensive Boundaries
- Part 010 — Error Response Design and Problem Details
- Part 011 — Idempotency, Retries, and Exactly-Once Illusions
- Part 012 — Conditional Requests and Optimistic Concurrency
- Part 013 — Caching for Backend Engineers
- Part 014 — Authentication over HTTP
- Part 015 — Authorization and Resource-Level Security
- Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend
- Part 017 — CORS from Backend Enforcement Perspective
- Part 018 — Rate Limiting, Quotas, and Abuse Control
- Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding
- Part 020 — File Upload, Download, Multipart, and Large Payloads
- Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses

Seri belum selesai.

Berikutnya:

**Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-020.md">⬅️ Part 020 — File Upload, Download, Multipart, and Large Payloads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-022.md">Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers ➡️</a>
</div>
