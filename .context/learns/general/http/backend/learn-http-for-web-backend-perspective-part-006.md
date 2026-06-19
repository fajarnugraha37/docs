# learn-http-for-web-backend-perspective-part-006.md

# Part 006 — Request Body, Response Body, and Message Framing

> Seri: `learn-http-for-web-backend-perspective`  
> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif backend production  
> Fokus part ini: body, framing, transfer, parsing, streaming, limits, memory, dan failure/security model  
> Status seri: Part 006 dari 032 — seri belum selesai

---

## 0. Mengapa Part Ini Penting?

Banyak backend engineer merasa sudah paham request body karena sehari-hari menulis kode seperti ini:

```java
@PostMapping("/orders")
public OrderResponse create(@RequestBody CreateOrderRequest request) {
    return orderService.create(request);
}
```

atau ini:

```java
@PostMapping("/upload")
public ResponseEntity<?> upload(@RequestParam MultipartFile file) {
    return ResponseEntity.ok(fileService.store(file));
}
```

Pada level framework, request body terlihat seperti object Java biasa. Tetapi pada level HTTP production, body adalah aliran byte yang harus:

1. dibatasi ukurannya,
2. dibaca dengan benar,
3. di-decode sesuai metadata,
4. diparse oleh parser yang aman,
5. tidak membuat memory collapse,
6. tidak membuka celah request smuggling,
7. tidak menyebabkan desynchronization antara proxy dan backend,
8. tidak membuat thread/event-loop tersumbat,
9. tidak membocorkan data sensitif di response,
10. dan tetap menghasilkan kontrak API yang jelas.

Part ini membahas body bukan sebagai “JSON input”, tetapi sebagai **resource consumption boundary**.

Mental model utamanya:

> HTTP body adalah byte stream yang diberi makna oleh framing, headers, media type, encoding, parser, dan application contract.

Kalau salah satu layer salah, backend bisa menerima request yang berbeda dari yang dipikirkan developer.

---

## 1. Peta Besar: Apa Itu Message Body?

Dalam HTTP, message biasanya terdiri dari:

```text
start-line / pseudo-headers
headers
blank line
body bytes
```

Untuk HTTP/1.1, bentuk mentahnya kira-kira:

```http
POST /cases HTTP/1.1
Host: api.example.com
Content-Type: application/json
Content-Length: 57

{"subjectId":"SUB-123","allegation":"late disclosure"}
```

Bagian setelah blank line adalah **message body**.

Namun backend tidak boleh langsung menganggap:

```text
body == JSON object
```

Lebih tepat:

```text
body bytes
  -> framed by HTTP version rules
  -> decoded by transfer/content encoding rules
  -> interpreted by media type
  -> parsed by selected parser
  -> validated by schema/application rules
  -> mapped into domain command/query
```

Di Java/Spring, banyak layer ini tersembunyi:

```text
Socket bytes
  -> container/proxy parser
  -> HttpServletRequest / ServerHttpRequest
  -> message converter / codec
  -> DTO
  -> validation
  -> controller method
```

Top 1% backend engineer tidak berhenti di DTO. Mereka tahu apa yang terjadi sebelum DTO terbentuk.

---

## 2. Message Body vs Representation Data

Satu kesalahan konseptual umum: menganggap body selalu “resource representation”.

Tidak selalu.

### 2.1 Body pada request

Request body bisa berarti banyak hal tergantung method dan endpoint:

| Contoh | Body berarti |
|---|---|
| `POST /orders` | command untuk membuat order |
| `PUT /customers/123` | full replacement representation |
| `PATCH /cases/ABC` | patch document / partial modification instruction |
| `POST /reports/search` | query object untuk operasi pencarian kompleks |
| `POST /uploads` | binary content atau multipart payload |
| `POST /webhooks/provider-x` | event notification payload dari sistem eksternal |

Request body bukan otomatis “state final resource”.

### 2.2 Body pada response

Response body juga bisa berarti banyak hal:

| Status | Body biasanya |
|---|---|
| `200 OK` | representation, result, page, command outcome |
| `201 Created` | created representation atau creation summary |
| `202 Accepted` | async acceptance representation |
| `204 No Content` | tidak ada body |
| `400/422` | validation error |
| `409` | conflict detail |
| `500` | safe error envelope |

Response body harus sinkron dengan status code.

Contoh buruk:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"success":false,"error":"validation failed"}
```

Ini membuat client, gateway, metrics, retry policy, dan alerting salah memahami hasil.

Contoh lebih benar:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "errors": [
    {"field":"amount","reason":"must be positive"}
  ]
}
```

---

## 3. Framing: Bagaimana Penerima Tahu Body Berakhir?

Ini inti dari message framing.

Backend harus tahu: kapan body selesai?

Pada HTTP/1.1, penerima bisa menentukan panjang body melalui beberapa mekanisme, terutama:

1. `Content-Length`,
2. `Transfer-Encoding: chunked`,
3. rules khusus per method/status,
4. connection close dalam beberapa kondisi historis.

### 3.1 Content-Length

`Content-Length` menyatakan jumlah byte body.

```http
POST /cases HTTP/1.1
Content-Type: application/json
Content-Length: 18

{"caseId":"C-1"}
```

Yang dihitung adalah byte, bukan character.

Ini penting untuk UTF-8:

```text
"é" bisa lebih dari 1 byte
emoji bisa 4 byte
```

Kesalahan menghitung character sebagai byte dapat menyebabkan body truncated atau parser error.

### 3.2 Transfer-Encoding: chunked

Chunked transfer memungkinkan pengirim mengirim body sebagai potongan-potongan ketika total ukuran belum diketahui di awal.

Bentuk konseptual:

```http
HTTP/1.1 200 OK
Transfer-Encoding: chunked
Content-Type: application/json

7
{"a":1}
0


```

Setiap chunk punya panjang sendiri. Chunk terakhir ukuran `0` menandakan akhir body.

Ini berguna untuk:

1. streaming response,
2. server mulai mengirim sebelum seluruh body siap,
3. payload yang ukurannya sulit diketahui di depan.

Tetapi chunked juga membuka area kompleks untuk proxy/backend mismatch jika parser berbeda.

### 3.3 Empty Body

Empty body berbeda dari missing body secara application-level.

Contoh:

```http
POST /cases HTTP/1.1
Content-Length: 0
```

Ini secara framing valid: body ada tapi panjangnya nol.

Namun secara API contract bisa jadi invalid.

Bedakan:

| Kondisi | HTTP-level | Application-level |
|---|---|---|
| tidak ada body | mungkin valid secara HTTP | mungkin invalid untuk POST tertentu |
| body kosong | valid framing | mungkin invalid payload |
| body `{}` | JSON object kosong | mungkin gagal validation |
| body `null` | JSON literal null | beda dari object kosong |
| body whitespace | byte body ada | parser tergantung media type |

Dalam Spring, perbedaan ini bisa muncul sebagai:

1. `HttpMessageNotReadableException`,
2. DTO null,
3. DTO kosong,
4. validation error,
5. custom parser error.

Jangan biarkan perbedaan ini menjadi behavior acak.

---

## 4. Framing Rules dan Request Smuggling Risk

Request smuggling terjadi ketika frontend proxy dan backend server tidak sepakat tentang batas request.

Contoh masalah klasik:

```http
POST / HTTP/1.1
Host: vulnerable.example
Content-Length: 35
Transfer-Encoding: chunked

0

GET /admin HTTP/1.1
Host: vulnerable.example
```

Jika proxy memakai `Content-Length` tetapi backend memakai `Transfer-Encoding`, atau sebaliknya, satu pihak bisa melihat satu request sementara pihak lain melihat dua request.

Dampaknya bisa serius:

1. bypass access control,
2. cache poisoning,
3. hijack response milik user lain,
4. request queue desynchronization,
5. routing ke endpoint yang tidak dimaksud.

### 4.1 Prinsip defensive

Backend production harus punya kebijakan jelas:

1. reject request ambiguity,
2. jangan menerima kombinasi framing yang invalid,
3. samakan konfigurasi proxy dan app server,
4. disable legacy behavior yang permissive,
5. upgrade proxy/container secara berkala,
6. test CL.TE dan TE.CL behavior di edge stack,
7. jangan punya chain proxy dengan parser rules berbeda tanpa test.

### 4.2 Di mana mitigasi ditempatkan?

Idealnya di beberapa lapisan:

```text
internet
  -> CDN/WAF: reject malformed framing
  -> load balancer: enforce protocol parsing
  -> API gateway/reverse proxy: normalize/reject ambiguity
  -> app server: strict parser and limits
  -> framework: never trust already-parsed body blindly for security decisions
```

Jangan mengandalkan controller untuk memperbaiki framing. Controller menerima request setelah parser memutuskan boundary. Kalau parser boundary salah, controller sudah terlambat.

---

## 5. Content-Type: Body Itu Apa?

`Content-Type` memberi tahu media type body.

Contoh:

```http
Content-Type: application/json
```

atau:

```http
Content-Type: multipart/form-data; boundary=----abc
```

atau:

```http
Content-Type: application/problem+json
```

Tanpa `Content-Type`, server tidak selalu tahu parser mana yang harus dipakai.

### 5.1 Backend rule

Untuk endpoint yang membutuhkan body, tentukan media type eksplisit.

Contoh Spring MVC:

```java
@PostMapping(
    path = "/cases",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<CaseResponse> createCase(
        @Valid @RequestBody CreateCaseRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
            .body(caseService.create(request));
}
```

Jika client mengirim XML ke endpoint JSON, response seharusnya bukan generic 500.

Lebih tepat:

```http
HTTP/1.1 415 Unsupported Media Type
```

### 5.2 Content-Type mismatch

Contoh berbahaya:

```http
Content-Type: application/json

<xml>...</xml>
```

atau:

```http
Content-Type: text/plain

{"role":"admin"}
```

Server harus memilih kebijakan:

1. reject mismatch,
2. parse hanya sesuai `Content-Type`,
3. jangan sniff body sembarangan untuk API internal/secure.

Media sniffing yang terlalu permissive bisa membuka celah bypass validation/security.

---

## 6. Content-Encoding: Body Dikompresi atau Tidak?

`Content-Encoding` menjelaskan encoding terhadap representation data, misalnya:

```http
Content-Encoding: gzip
```

Artinya body bytes harus didecompress sebelum diparse sebagai JSON/XML/etc.

Pipeline konseptual:

```text
wire bytes
  -> transfer framing
  -> content decoding gzip/br/deflate
  -> media type parser JSON/XML/etc
  -> DTO
```

### 6.1 Decompression bomb

Payload kecil secara compressed bisa menjadi sangat besar setelah decompression.

Contoh risiko:

```text
compressed size: 100 KB
uncompressed size: 2 GB
```

Kalau server hanya membatasi compressed bytes, backend tetap bisa kehabisan memory/disk/CPU setelah decompression.

Defensive controls:

1. batasi compressed request size,
2. batasi decompressed size,
3. batasi ratio decompression,
4. timeout decompression,
5. CPU budget,
6. reject encoding yang tidak diperlukan,
7. log safe metadata, bukan body.

Untuk API JSON normal, banyak sistem memilih tidak menerima compressed request body kecuali ada kebutuhan jelas.

---

## 7. JSON Body: Terlihat Sederhana, Banyak Edge Case

JSON adalah default banyak HTTP API, tapi bukan berarti trivial.

### 7.1 Unknown fields

Request:

```json
{
  "name": "Alice",
  "role": "admin"
}
```

DTO:

```java
public record CreateUserRequest(String name) {}
```

Pertanyaan: `role` harus diapakan?

Pilihan:

| Kebijakan | Kelebihan | Risiko |
|---|---|---|
| Ignore unknown fields | forward-compatible | bisa menyembunyikan typo atau attack |
| Reject unknown fields | strict contract | perubahan client lebih sulit |
| Capture extension fields | extensible | kompleks dan harus aman |

Untuk API public/regulated/high-risk, strict sering lebih defensible.

Jackson config contoh:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Namun jangan aktifkan global tanpa menilai kompatibilitas seluruh API.

### 7.2 Null vs missing vs empty

JSON:

```json
{}
```

berbeda dari:

```json
{"middleName": null}
```

berbeda dari:

```json
{"middleName": ""}
```

Untuk PATCH, ini sangat penting:

| Payload | Meaning mungkin |
|---|---|
| field missing | jangan ubah field |
| field null | clear field |
| field empty string | set ke empty string |

Jika DTO Java tidak bisa membedakan missing vs null, PATCH semantics menjadi cacat.

Solusi:

1. gunakan patch document formal,
2. gunakan wrapper `JsonNullable<T>`,
3. parse ke `JsonNode` lalu interpret eksplisit,
4. buat command object yang menyimpan field presence.

### 7.3 Number precision

JSON number tidak membedakan integer/decimal secara ketat. Java punya `int`, `long`, `BigDecimal`, `double`.

Untuk uang, denda, penalty, limit, dan ukuran hukum/regulatory:

```java
BigDecimal amount
```

lebih aman daripada:

```java
double amount
```

Contoh buruk:

```json
{"penaltyAmount": 0.1}
```

Jika diparse ke floating point, precision bisa tidak sesuai ekspektasi domain.

### 7.4 Date/time

Masalah umum:

1. timezone tidak eksplisit,
2. offset hilang,
3. local date vs instant tertukar,
4. format ambigu,
5. client mengirim epoch milliseconds tapi server mengira seconds.

Guideline:

| Domain meaning | Type Java yang cocok |
|---|---|
| timestamp absolut | `Instant` / `OffsetDateTime` |
| tanggal kalender tanpa waktu | `LocalDate` |
| jam lokal tanpa tanggal | `LocalTime` |
| jadwal dengan timezone | `ZonedDateTime` atau domain-specific object |

Jangan mengirim tanggal ambigu seperti:

```json
{"submittedAt":"06/07/2026"}
```

Lebih baik:

```json
{"submittedAt":"2026-07-06T10:15:30+07:00"}
```

atau untuk tanggal saja:

```json
{"effectiveDate":"2026-07-06"}
```

---

## 8. XML Body dan Parser Risk

Walau banyak API modern memakai JSON, XML masih muncul di:

1. legacy enterprise integration,
2. SOAP bridge,
3. document exchange,
4. regulatory filing,
5. payment/finance systems.

Risiko XML:

1. XXE,
2. entity expansion bomb,
3. schema validation cost,
4. namespace confusion,
5. external DTD fetch,
6. parser differential.

Defensive checklist:

1. disable external entity resolution,
2. disable DTD jika tidak diperlukan,
3. batasi entity expansion,
4. batasi document size,
5. batasi depth,
6. batasi parsing time,
7. validate schema secara eksplisit,
8. jangan fetch remote schema dari request.

---

## 9. Multipart Body

Multipart umum untuk upload file plus metadata.

Contoh:

```http
POST /cases/C-123/evidence HTTP/1.1
Content-Type: multipart/form-data; boundary=----abc

------abc
Content-Disposition: form-data; name="metadata"
Content-Type: application/json

{"description":"photo evidence"}
------abc
Content-Disposition: form-data; name="file"; filename="evidence.jpg"
Content-Type: image/jpeg

...binary...
------abc--
```

### 9.1 Multipart bukan satu body sederhana

Multipart adalah container yang punya:

1. boundary,
2. parts,
3. per-part headers,
4. per-part content type,
5. per-part filename,
6. per-part size,
7. total request size,
8. number of parts.

### 9.2 Risiko multipart

1. terlalu banyak parts,
2. part kecil sangat banyak,
3. filename path traversal,
4. content type palsu,
5. file besar masuk memory,
6. temporary disk penuh,
7. scanning lambat,
8. upload partial,
9. duplicate field names,
10. parser boundary ambiguity.

### 9.3 Backend policy

Untuk upload production, definisikan:

| Policy | Contoh |
|---|---|
| max total request size | 25 MB |
| max file size | 20 MB |
| max metadata size | 32 KB |
| max parts | 5 |
| allowed content types | `application/pdf`, `image/jpeg`, `image/png` |
| allowed extensions | `.pdf`, `.jpg`, `.jpeg`, `.png` |
| storage | object storage, not app memory |
| scanning | async malware scan before activation |
| lifecycle | quarantine -> scanned -> available/rejected |

### 9.4 Jangan percaya filename

Client bisa mengirim:

```text
../../../../etc/passwd
```

atau:

```text
invoice.pdf.exe
```

atau Unicode tricky name.

Simpan file dengan server-generated object key:

```text
evidence/{caseId}/{uuid}
```

Filename asli hanya metadata display, setelah sanitization.

---

## 10. Large Payloads: Memory adalah Boundary

Kesalahan umum:

```java
byte[] bytes = file.getBytes();
```

Untuk file kecil mungkin aman. Untuk payload besar, ini bisa menyebabkan:

1. heap pressure,
2. GC pause,
3. OOM,
4. request thread tertahan,
5. node tidak sehat,
6. cascading failure.

### 10.1 Streaming mindset

Daripada:

```text
read entire body into memory -> process
```

lebih baik:

```text
read chunk -> validate incremental -> write chunk -> continue
```

Atau offload:

```text
client -> pre-signed URL -> object storage
client -> API finalize metadata
backend -> scan/process async
```

### 10.2 Kapan payload besar sebaiknya tidak lewat app server?

Jika payload:

1. file besar,
2. bulk export,
3. media upload,
4. raw evidence upload,
5. archive import,
6. generated report besar,

pertimbangkan object storage path.

Pattern:

```text
1. Client minta upload session ke backend
2. Backend authorize dan buat upload target/pre-signed URL
3. Client upload langsung ke object storage
4. Storage event / client callback memberitahu backend
5. Backend scan, validate, dan bind ke domain entity
```

Keuntungan:

1. app server tidak jadi pipe byte besar,
2. scaling lebih murah,
3. retry upload bisa dikelola storage,
4. storage lifecycle lebih jelas,
5. audit metadata tetap di backend.

---

## 11. Response Body: Jangan Hanya `return object`

Response body juga harus dirancang.

Pertanyaan penting:

1. apakah response perlu body?
2. apakah body kecil atau besar?
3. apakah response cacheable?
4. apakah representation lengkap atau summary?
5. apakah sensitive fields harus disembunyikan?
6. apakah response shape stabil?
7. apakah response harus streaming?
8. apakah error body konsisten?

### 11.1 204 No Content

Gunakan `204` ketika operasi sukses tetapi tidak perlu body.

Contoh:

```http
DELETE /sessions/current HTTP/1.1
```

Response:

```http
HTTP/1.1 204 No Content
```

Jangan kirim JSON body dengan `204`.

Buruk:

```http
HTTP/1.1 204 No Content
Content-Type: application/json

{"success":true}
```

### 11.2 201 Created

Untuk resource creation:

```http
HTTP/1.1 201 Created
Location: /cases/C-123
Content-Type: application/json

{
  "id": "C-123",
  "status": "DRAFT"
}
```

Body bisa berisi representation awal. `Location` memberi URI resource baru.

### 11.3 202 Accepted

Untuk async operation:

```http
HTTP/1.1 202 Accepted
Location: /operations/OP-999
Content-Type: application/json

{
  "operationId": "OP-999",
  "status": "PENDING"
}
```

Jangan memakai `200 OK` untuk operasi yang sebenarnya belum selesai jika client perlu tahu state async.

---

## 12. Streaming Response

Streaming response berguna ketika:

1. data besar,
2. data dihasilkan bertahap,
3. client bisa mengonsumsi incremental,
4. response tidak perlu diketahui total length di awal.

Contoh:

1. export NDJSON,
2. event feed,
3. large report download,
4. server-sent events,
5. progressive processing result.

### 12.1 NDJSON

```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
Transfer-Encoding: chunked

{"id":"C-1","status":"OPEN"}
{"id":"C-2","status":"CLOSED"}
{"id":"C-3","status":"ESCALATED"}
```

Keuntungan:

1. setiap baris bisa diparse sendiri,
2. tidak perlu menunggu array JSON lengkap,
3. memory lebih rendah,
4. cocok untuk export besar.

Dibandingkan JSON array besar:

```json
[
  {"id":"C-1"},
  {"id":"C-2"},
  ... millions more ...
]
```

Array besar sering membuat server/client menunggu sampai struktur selesai.

### 12.2 Proxy buffering

Streaming bisa gagal diam-diam jika reverse proxy melakukan buffering.

Contoh masalah:

```text
backend flush tiap 1 detik
proxy buffer sampai 1 MB
client baru menerima setelah lama
```

Maka ketika mendesain streaming, cek:

1. Nginx proxy buffering,
2. API gateway buffering,
3. CDN buffering,
4. load balancer idle timeout,
5. client read timeout,
6. compression buffering,
7. TLS record flushing.

---

## 13. Blocking vs Non-Blocking Body Consumption

### 13.1 Servlet/Spring MVC

Spring MVC pada umumnya memakai thread-per-request.

Conceptual flow:

```text
request thread
  -> read body
  -> parse JSON
  -> call service
  -> write response
```

Untuk request kecil/sedang, ini sederhana dan efektif.

Risiko muncul ketika:

1. body sangat besar,
2. client upload lambat,
3. downstream lambat,
4. streaming response panjang,
5. thread pool kecil,
6. timeout tidak jelas.

Jika banyak request lambat memegang thread, service bisa thread-starved.

### 13.2 WebFlux/Reactor Netty

WebFlux memakai non-blocking model.

Conceptual flow:

```text
event loop receives chunks
  -> emits DataBuffer stream
  -> codec decodes
  -> reactive pipeline processes
  -> writes response asynchronously
```

Kelebihan:

1. scalable untuk I/O-bound concurrency,
2. streaming lebih natural,
3. cancellation/backpressure lebih eksplisit.

Risiko:

1. blocking call di event loop sangat berbahaya,
2. DataBuffer leak,
3. operator chain sulit dipahami,
4. backpressure tidak otomatis menyelesaikan semua bottleneck,
5. parser/codec masih bisa buffer memory jika salah konfigurasi.

### 13.3 Aturan praktis

| Kondisi | Spring MVC cukup? | WebFlux lebih menarik? |
|---|---:|---:|
| CRUD JSON biasa | Ya | Tidak selalu |
| Banyak downstream blocking JDBC | Ya, dengan pool dan timeout | Tidak jika tetap blocking |
| Streaming banyak concurrent clients | Mungkin, dengan async | Ya |
| Large upload/download | Bisa, jika streaming benar | Ya, jika non-blocking end-to-end |
| Tim belum mature reactive | Ya | Hati-hati |

Reactive bukan magic. Jika pipeline berakhir ke blocking JDBC tanpa isolasi scheduler, manfaatnya hilang dan risikonya naik.

---

## 14. Body Read Once Problem

Request body stream biasanya hanya bisa dibaca sekali.

Anti-pattern:

```java
// filter reads body for logging
String raw = request.getReader().lines().collect(joining());

// controller tries to read @RequestBody
// body already consumed
```

Akibat:

1. controller menerima body kosong,
2. parsing gagal,
3. logging filter merusak request,
4. behavior berbeda antar endpoint.

### 14.1 Solusi MVC

Gunakan wrapper/caching dengan hati-hati:

```java
ContentCachingRequestWrapper wrapped = new ContentCachingRequestWrapper(request);
```

Namun ingat:

1. caching body berarti memory/disk overhead,
2. jangan cache body besar,
3. jangan log sensitive body,
4. batasi ukuran log.

### 14.2 Solusi desain

Lebih baik jangan bergantung pada raw body untuk logging kecuali diperlukan. Log metadata:

```text
method, path, status, duration, requestId, userId, tenantId, contentLength, contentType
```

Bukan body penuh.

---

## 15. Logging Body: Hampir Selalu Berbahaya

Body sering berisi:

1. password,
2. token,
3. PII,
4. health data,
5. financial data,
6. legal/regulatory evidence,
7. secret keys,
8. internal notes,
9. uploaded document content.

Logging raw body bisa melanggar privacy, compliance, dan security.

### 15.1 Kebijakan aman

1. default: jangan log body,
2. log body hanya di environment terbatas,
3. redaction wajib,
4. max size wajib,
5. sampling wajib,
6. disable untuk multipart/binary,
7. jangan log authorization/cookie,
8. gunakan structured logging,
9. punya retention policy.

Contoh metadata log:

```json
{
  "event": "http_request_completed",
  "method": "POST",
  "pathTemplate": "/cases/{caseId}/evidence",
  "status": 201,
  "durationMs": 182,
  "requestContentType": "multipart/form-data",
  "requestContentLength": 1849231,
  "responseContentType": "application/json",
  "requestId": "req-abc",
  "tenantId": "tenant-1",
  "userId": "user-9"
}
```

---

## 16. Response Compression

Response compression mengurangi bandwidth, tetapi punya trade-off.

### 16.1 Kapan berguna?

1. JSON besar,
2. HTML/text,
3. CSV,
4. NDJSON,
5. repetitive payload.

### 16.2 Kapan kurang berguna?

1. JPEG/PNG/video sudah compressed,
2. payload sangat kecil,
3. CPU lebih mahal daripada bandwidth,
4. sensitive response dengan compression side-channel concern.

### 16.3 Backend considerations

1. compression biasanya di proxy/gateway,
2. pastikan `Vary: Accept-Encoding`,
3. jangan compress semua tanpa ukuran minimum,
4. perhatikan streaming karena compression bisa buffering,
5. ukur CPU impact.

---

## 17. Range Requests and Partial Content

Untuk download besar, client bisa meminta sebagian content:

```http
Range: bytes=1000-1999
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 1000-1999/5000000
```

Ini berguna untuk:

1. resume download,
2. media streaming,
3. large report retrieval,
4. unstable network.

Backend perlu hati-hati:

1. authorize resource before serving range,
2. validate range,
3. avoid expensive random reads,
4. set correct `Content-Range`,
5. handle unsatisfiable range dengan `416 Range Not Satisfiable`,
6. don't leak existence/size of unauthorized files.

Untuk banyak sistem, lebih baik delegate large file serving ke object storage/CDN setelah authorization.

---

## 18. Body Size Limits: Harus Ada di Banyak Layer

Size limit tidak cukup hanya di controller.

Tempat limit:

```text
CDN/WAF
  -> load balancer
  -> reverse proxy/API gateway
  -> app server connector
  -> framework multipart/parser
  -> application validation
  -> downstream storage/message broker
```

Jika limit tidak konsisten:

1. proxy menerima tapi app menolak,
2. app menerima tapi downstream gagal,
3. client mendapat 500 bukan 413,
4. retry storm,
5. disk temp penuh.

### 18.1 Status code untuk terlalu besar

Gunakan:

```http
413 Content Too Large
```

Sertakan error body yang aman:

```json
{
  "type": "https://api.example.com/problems/content-too-large",
  "title": "Request body is too large",
  "status": 413,
  "detail": "Maximum upload size is 20 MB."
}
```

Jangan mengembalikan generic 500.

---

## 19. Body Parsing Failure Taxonomy

Ketika body gagal, jangan semuanya menjadi 400 generic.

| Failure | Status kandidat | Contoh |
|---|---:|---|
| malformed JSON | 400 | `{ "a":` |
| unsupported media type | 415 | XML ke endpoint JSON |
| unsupported content encoding | 415 / 400 | `Content-Encoding: br` tidak didukung |
| body too large | 413 | upload > limit |
| semantic validation gagal | 422 | field valid JSON tapi business invalid |
| conflict dengan current state | 409 | update outdated state |
| precondition gagal | 412 | ETag mismatch |
| timeout membaca body | 408 / 400 / proxy-specific | slow upload |
| unauthorized file access | 403/404 | download evidence unauthorized |

Status code harus membantu client dan observability.

---

## 20. Java/Spring MVC Implementation Patterns

### 20.1 JSON endpoint dengan explicit consumes/produces

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @PostMapping(
        consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
    )
    ResponseEntity<CaseResponse> create(
            @Valid @RequestBody CreateCaseRequest request) {

        CaseResponse response = caseService.create(request);

        URI location = URI.create("/cases/" + response.id());

        return ResponseEntity.created(location).body(response);
    }
}
```

### 20.2 Validation object

```java
public record CreateCaseRequest(
    @NotBlank String subjectId,
    @NotBlank String allegation,
    @NotNull LocalDate receivedDate
) {}
```

### 20.3 Global error mapping

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ProblemDetail> malformedBody(HttpMessageNotReadableException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Malformed request body");
        problem.setDetail("Request body could not be parsed as the declared media type.");
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ProblemDetail> tooLarge(MaxUploadSizeExceededException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.PAYLOAD_TOO_LARGE);
        problem.setTitle("Request body is too large");
        problem.setDetail("The uploaded content exceeds the configured limit.");
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(problem);
    }
}
```

Catatan: nama enum/status dapat berbeda tergantung versi Spring/Java. Intinya adalah mapping eksplisit dari failure ke status yang benar.

### 20.4 Multipart upload

```java
@PostMapping(
    path = "/{caseId}/evidence",
    consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
ResponseEntity<EvidenceResponse> uploadEvidence(
        @PathVariable String caseId,
        @RequestPart("metadata") @Valid EvidenceMetadata metadata,
        @RequestPart("file") MultipartFile file) throws IOException {

    EvidenceResponse response = evidenceService.store(caseId, metadata, file);

    return ResponseEntity.status(HttpStatus.CREATED).body(response);
}
```

Butuh policy di service:

```java
void validate(MultipartFile file) {
    if (file.isEmpty()) {
        throw new InvalidUploadException("file is empty");
    }
    if (file.getSize() > maxBytes) {
        throw new ContentTooLargeException();
    }
    if (!allowedContentTypes.contains(file.getContentType())) {
        throw new UnsupportedFileTypeException();
    }
}
```

Namun content type dari client tidak cukup. Lakukan server-side detection/scanning bila file high-risk.

---

## 21. Java/WebFlux Implementation Patterns

### 21.1 Request body sebagai Mono DTO

```java
@PostMapping(
    path = "/cases",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
Mono<ResponseEntity<CaseResponse>> create(@Valid @RequestBody Mono<CreateCaseRequest> body) {
    return body
        .flatMap(caseService::create)
        .map(response -> ResponseEntity
            .created(URI.create("/cases/" + response.id()))
            .body(response));
}
```

### 21.2 Streaming NDJSON response

```java
@GetMapping(
    path = "/cases/export",
    produces = MediaType.APPLICATION_NDJSON_VALUE
)
Flux<CaseExportRow> exportCases() {
    return caseQueryService.streamCases();
}
```

### 21.3 File upload with FilePart

```java
@PostMapping(
    path = "/cases/{caseId}/evidence",
    consumes = MediaType.MULTIPART_FORM_DATA_VALUE
)
Mono<EvidenceResponse> upload(
        @PathVariable String caseId,
        @RequestPart("file") FilePart filePart) {

    return evidenceService.storeStreaming(caseId, filePart);
}
```

Service harus menjaga:

1. jangan aggregate seluruh file ke memory,
2. tulis ke temporary/object storage secara streaming,
3. enforce limit,
4. cleanup partial files on cancellation/error,
5. jangan blocking event loop.

### 21.4 DataBuffer warning

Di WebFlux, `DataBuffer` merepresentasikan buffer byte. Jika dipakai manual, perhatikan lifecycle dan memory release. Banyak use case sebaiknya memakai abstraction level lebih tinggi seperti `FilePart.transferTo(...)`, selama sesuai kebutuhan.

---

## 22. Cancellation: Client Pergi Sebelum Body Selesai

Client bisa disconnect kapan saja:

1. user menutup browser,
2. mobile network putus,
3. client timeout,
4. gateway menutup connection,
5. load balancer idle timeout.

Backend harus mempertimbangkan:

1. apakah processing harus dibatalkan?
2. apakah partial upload harus dihapus?
3. apakah database transaction sudah commit?
4. apakah async job sudah dibuat?
5. apakah object storage sudah menerima sebagian file?
6. apakah audit event perlu dicatat?

### 22.1 Upload cancellation

Flow buruk:

```text
client upload 80%
connection lost
backend leaves temp file forever
```

Flow lebih baik:

```text
client upload
  -> temp object
  -> on complete: finalize metadata
  -> on cancellation/error: cleanup temp object asynchronously
```

### 22.2 Response cancellation

Jika backend sedang streaming export dan client disconnect, hentikan query/processing jika memungkinkan.

Jika tidak, server bisa tetap menghabiskan CPU/DB walau tidak ada penerima.

---

## 23. Timeout Saat Membaca atau Menulis Body

Timeout terkait body:

| Timeout | Meaning |
|---|---|
| request header timeout | client lambat mengirim headers |
| request body timeout | client lambat upload body |
| idle timeout | connection diam terlalu lama |
| response write timeout | client lambat membaca response |
| upstream timeout | proxy menunggu backend terlalu lama |

### 23.1 Slowloris-like risk

Client bisa mengirim body sangat lambat:

```text
1 byte per 10 seconds
```

Jika server menahan thread/connection terlalu lama, kapasitas habis.

Mitigasi:

1. header/body read timeout,
2. minimum data rate,
3. connection limit per IP/client,
4. reverse proxy protection,
5. request size limit,
6. reject suspicious slow uploads.

---

## 24. Body and Transaction Boundaries

Jangan mulai database transaction terlalu awal saat body besar masih dibaca.

Buruk:

```text
open DB transaction
read 500 MB upload
validate file
write object storage
commit DB
```

Risiko:

1. transaction lama,
2. lock lama,
3. connection pool exhausted,
4. rollback mahal,
5. deadlocks.

Lebih baik:

```text
read/stream upload to temp storage
validate/scan
open short DB transaction
create metadata/bind object
commit
```

Untuk create command JSON kecil, transaction di service layer biasa cukup. Untuk large body, pisahkan resource transfer dari domain commit.

---

## 25. Body and Domain Command Design

DTO request body bukan domain entity.

Buruk:

```java
@PostMapping("/cases")
CaseEntity create(@RequestBody CaseEntity entity) { ... }
```

Risiko:

1. mass assignment,
2. client bisa set field internal,
3. persistence model bocor,
4. validation kacau,
5. evolution sulit.

Lebih baik:

```java
public record CreateCaseRequest(
    String subjectId,
    String allegation,
    LocalDate receivedDate
) {}

public record CreateCaseCommand(
    SubjectId subjectId,
    Allegation allegation,
    LocalDate receivedDate,
    UserId submittedBy,
    TenantId tenantId
) {}
```

Mapping:

```text
HTTP body DTO
  -> validation
  -> authenticated context enrichment
  -> application command
  -> domain model
```

Client tidak boleh mengirim `createdBy`, `tenantId`, `status`, `approvalLevel`, atau field internal yang harus berasal dari server-side context.

---

## 26. Safe Response Body Design

Response body juga tidak boleh langsung entity.

Buruk:

```java
@GetMapping("/users/{id}")
UserEntity get(@PathVariable String id) { ... }
```

Risiko:

1. password hash bocor,
2. internal flags bocor,
3. lazy-loading surprise,
4. circular reference,
5. unstable schema,
6. tenant data leakage.

Lebih baik:

```java
public record UserResponse(
    String id,
    String displayName,
    String email,
    List<String> roles
) {}
```

Response representation harus dipilih berdasarkan:

1. caller authorization,
2. use case,
3. API contract,
4. privacy rule,
5. caching behavior.

---

## 27. Handling Binary Responses

Untuk download file:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="decision-letter.pdf"
Content-Length: 184923
```

### 27.1 Content-Disposition

Gunakan untuk mengontrol download/display:

```http
Content-Disposition: attachment; filename="report.pdf"; filename*=UTF-8''report.pdf
```

Perhatikan:

1. sanitize filename,
2. hindari CRLF injection,
3. gunakan fallback ASCII,
4. jangan expose internal storage key,
5. authorization before response.

### 27.2 Content-Type untuk binary

Jangan asal `application/octet-stream` jika media type jelas. Tetapi jangan percaya metadata file dari client saja.

---

## 28. Gateway/Proxy Interaction dengan Body

Proxy dapat:

1. buffer request body,
2. stream request body,
3. enforce max body size,
4. decompress/compress,
5. rewrite headers,
6. reject invalid framing,
7. time out slow body,
8. generate its own error page.

### 28.1 Proxy buffering trade-off

Request buffering ON:

| Kelebihan | Kekurangan |
|---|---|
| backend hanya menerima body lengkap | latency lebih tinggi |
| protect backend dari slow client | proxy disk/memory pressure |
| retry upstream lebih mudah | streaming upload tidak end-to-end |

Request buffering OFF:

| Kelebihan | Kekurangan |
|---|---|
| streaming end-to-end | backend expose ke slow client |
| lower latency for large body | thread/connection risk |
| good for large uploads | more cancellation complexity |

Tidak ada default universal. Pilih sesuai endpoint.

---

## 29. Testing Body and Framing Behavior

Jangan hanya test happy path JSON.

### 29.1 Test cases minimal

Untuk endpoint JSON:

1. valid body,
2. empty body,
3. malformed JSON,
4. wrong `Content-Type`,
5. missing `Content-Type`,
6. too large body,
7. unknown field,
8. null required field,
9. wrong data type,
10. invalid date format,
11. unsupported charset,
12. gzip body jika tidak didukung,
13. duplicate JSON keys jika parser behavior penting.

### 29.2 Multipart tests

1. file missing,
2. metadata missing,
3. empty file,
4. too large file,
5. too many parts,
6. wrong media type,
7. filename traversal,
8. duplicate file field,
9. corrupted boundary,
10. upload cancellation.

### 29.3 Streaming tests

1. client disconnect,
2. slow client,
3. proxy timeout,
4. partial response,
5. large response,
6. compression on/off,
7. backpressure behavior.

### 29.4 Security tests

1. CL.TE request smuggling probes,
2. TE.CL probes,
3. duplicate `Content-Length`,
4. invalid chunk size,
5. header/body mismatch,
6. decompression bomb simulation,
7. XML entity expansion,
8. body logging redaction.

---

## 30. Observability for Body Handling

Jangan observasi body content. Observasi metadata dan failure.

Metrics:

1. request body size histogram,
2. response body size histogram,
3. parse error count,
4. unsupported media type count,
5. too large count,
6. upload duration,
7. download duration,
8. stream cancellation count,
9. multipart failure count,
10. decompression failure count.

Logs:

1. content type,
2. content length if available,
3. endpoint template,
4. status,
5. failure reason category,
6. request id,
7. tenant/user if safe,
8. duration.

Traces:

1. parse span,
2. validation span,
3. storage upload span,
4. scan span,
5. response streaming span.

Avoid high-cardinality labels:

```text
bad: filename as metric label
bad: content-type with arbitrary raw value as unbounded label
bad: exception message as label
```

---

## 31. Common Anti-Patterns

### 31.1 “Body kecil jadi aman”

Tidak aman jika client bisa mengirim body besar.

Set limit.

### 31.2 “Framework sudah handle semua”

Framework handle banyak hal, tapi policy tetap milik sistem:

1. max size,
2. media type,
3. unknown fields,
4. logging,
5. upload lifecycle,
6. error shape,
7. proxy alignment.

### 31.3 “Log body untuk debugging”

Ini sering menjadi data leak.

Gunakan request id dan reproducer safe.

### 31.4 “MultipartFile.getBytes() aja”

Ini memory trap.

Gunakan streaming/storage abstraction.

### 31.5 “PUT/PATCH tinggal DTO partial”

Kalau DTO tidak membedakan missing/null, update semantics rusak.

### 31.6 “Response entity langsung dari JPA”

Ini security/evolution trap.

Gunakan response DTO.

### 31.7 “Compression selalu bagus”

Compression punya CPU, buffering, dan side-channel considerations.

### 31.8 “Proxy dan backend pasti sepakat”

Tidak selalu. Parser mismatch adalah akar request smuggling.

---

## 32. Backend Design Checklist

Gunakan checklist ini saat membuat endpoint yang menerima/mengirim body.

### 32.1 Request body checklist

- [ ] Apakah endpoint memang membutuhkan body?
- [ ] Method-nya sesuai semantics?
- [ ] `Content-Type` diwajibkan?
- [ ] `consumes` dikunci?
- [ ] Max request size ditentukan?
- [ ] Max decompressed size ditentukan jika menerima compressed body?
- [ ] Parser behavior untuk unknown fields jelas?
- [ ] Null/missing/empty semantics jelas?
- [ ] Validation error shape konsisten?
- [ ] Body logging disabled/redacted?
- [ ] Sensitive fields tidak boleh dari client?
- [ ] DTO dipisah dari entity?
- [ ] Multipart/file policy jelas jika ada?
- [ ] Timeout body upload jelas?
- [ ] Cancellation behavior jelas?

### 32.2 Response body checklist

- [ ] Status code sesuai body?
- [ ] `204` tidak punya body?
- [ ] `201` punya `Location` jika resource created?
- [ ] `202` punya operation tracking jika async?
- [ ] Error body machine-readable?
- [ ] Sensitive fields difilter?
- [ ] `Content-Type` benar?
- [ ] Compression policy jelas?
- [ ] Streaming perlu atau tidak?
- [ ] Large download memakai range/object storage jika perlu?
- [ ] Cache headers sesuai sensitivity?

### 32.3 Framing/security checklist

- [ ] Proxy dan backend strict terhadap invalid framing?
- [ ] Duplicate/conflicting `Content-Length` ditolak?
- [ ] `Content-Length` + `Transfer-Encoding` ambiguity ditolak?
- [ ] Invalid chunked body ditolak?
- [ ] Request smuggling test dilakukan di full edge chain?
- [ ] Header/body limits align antar layer?
- [ ] XML parser hardened jika XML diterima?
- [ ] Decompression bomb mitigated?

---

## 33. Case Study: Evidence Upload untuk Enforcement Case

### 33.1 Requirement

Sistem enforcement case management butuh endpoint untuk upload evidence.

Kebutuhan:

1. user harus authorized terhadap case,
2. file maksimum 25 MB,
3. hanya PDF/JPEG/PNG,
4. metadata wajib punya description dan evidenceType,
5. file harus discan sebelum bisa dipakai reviewer,
6. audit trail wajib,
7. client tidak boleh menentukan status evidence,
8. upload partial harus dibersihkan,
9. response harus memberi tracking id.

### 33.2 Endpoint design

```http
POST /cases/{caseId}/evidence
Content-Type: multipart/form-data
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /cases/C-123/evidence/E-999
Content-Type: application/json

{
  "evidenceId": "E-999",
  "caseId": "C-123",
  "status": "PENDING_SCAN",
  "links": {
    "self": "/cases/C-123/evidence/E-999"
  }
}
```

Kenapa `202`, bukan `201`?

Karena evidence belum sepenuhnya available untuk proses review sampai scanning selesai. Jika domain menganggap evidence record sudah created tapi belum active, `201` juga bisa dipertimbangkan. Pilihan harus mengikuti kontrak domain. Dalam desain ini, kita menekankan acceptance async.

### 33.3 Internal flow

```text
1. Authenticate user
2. Authorize access to case
3. Enforce multipart limits
4. Validate metadata part
5. Validate file size/content type
6. Stream file to quarantine storage
7. Create evidence record with PENDING_SCAN
8. Publish scan job / outbox event
9. Return 202 with evidence tracking URI
```

### 33.4 Failure mapping

| Failure | Status |
|---|---:|
| no auth | 401 |
| no access to case | 403 or 404 |
| case not found | 404 |
| case closed and cannot accept evidence | 409 |
| wrong content type | 415 |
| file too large | 413 |
| metadata invalid | 422 |
| malware detected later | evidence status `REJECTED`, not initial HTTP failure |
| storage unavailable before acceptance | 503 |
| scan queue unavailable after DB commit | handled by outbox/retry |

### 33.5 Domain invariant

```text
Evidence can be used in review only if status == AVAILABLE.
```

HTTP body handling only gets bytes into quarantine. Domain state machine decides whether evidence becomes usable.

---

## 34. Exercises

### Exercise 1 — JSON body policy

Design policy untuk endpoint:

```http
POST /penalty-assessments
Content-Type: application/json
```

Tentukan:

1. max body size,
2. unknown field policy,
3. null/missing policy,
4. numeric type untuk money,
5. date/time format,
6. validation error shape,
7. status codes untuk malformed vs invalid.

### Exercise 2 — PATCH missing/null problem

Untuk payload:

```json
{
  "assignedReviewerId": null
}
```

Apa bedanya dengan:

```json
{}
```

Bagaimana DTO Java Anda membedakan keduanya?

### Exercise 3 — Upload flow

Rancang upload architecture untuk file 2 GB. Apakah lewat app server? Jika tidak, bagaimana authorization, scanning, audit, dan finalization dilakukan?

### Exercise 4 — Request smuggling test plan

Buat test plan untuk memastikan CDN -> gateway -> backend tidak rentan parser mismatch. Apa request invalid yang harus ditolak?

### Exercise 5 — Streaming export

Rancang endpoint export 10 juta records. Pilih antara JSON array, NDJSON, CSV, async file generation, atau object storage download. Jelaskan trade-off.

---

## 35. Ringkasan Mental Model

Part ini bisa diringkas menjadi beberapa prinsip:

1. Body adalah byte stream sebelum menjadi DTO.
2. Framing menentukan batas body; parser mismatch bisa menjadi security issue.
3. `Content-Length`, `Transfer-Encoding`, `Content-Type`, dan `Content-Encoding` adalah kontrak penting.
4. Empty, missing, null, dan malformed bukan hal yang sama.
5. Large payload adalah resource-management problem.
6. Multipart adalah container kompleks, bukan sekadar file upload.
7. Streaming mengurangi memory tetapi menambah complexity: timeout, proxy buffering, cancellation, backpressure.
8. Jangan log raw body kecuali sangat terkendali.
9. Request DTO bukan domain entity; response DTO bukan persistence entity.
10. Body handling harus diuji pada edge cases, bukan hanya happy path.

Backend engineer yang matang melihat body handling sebagai kombinasi dari:

```text
protocol correctness
+ parser safety
+ resource limits
+ security boundary
+ domain contract
+ observability
+ operational behavior
```

---

## 36. Referensi

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
- OWASP Web Security Testing Guide — Testing for HTTP Request Smuggling: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/16-Testing_for_HTTP_Request_Smuggling
- Spring Framework Reference — WebFlux Reactive Core and Multipart Limits: https://docs.spring.io/spring-framework/reference/web/webflux/reactive-spring.html
- Spring Framework Reference — Web MVC: https://docs.spring.io/spring-framework/reference/web/webmvc.html

---

## 37. Posisi dalam Seri

Anda telah menyelesaikan:

- Part 000 — Orientation: HTTP Backend Mental Model
- Part 001 — HTTP Semantics from Server Point of View
- Part 002 — Request Lifecycle: From Socket to Controller
- Part 003 — Methods Deep Dive for Backend Correctness
- Part 004 — Status Codes as Backend State Contracts
- Part 005 — Headers as Backend Control Plane
- Part 006 — Request Body, Response Body, and Message Framing

Seri belum selesai. Berikutnya:

**Part 007 — URI, Routing, and Resource Modeling**

File berikutnya:

```text
learn-http-for-web-backend-perspective-part-007.md
```
