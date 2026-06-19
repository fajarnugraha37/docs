# learn-http-for-web-backend-perspective-part-004.md

# Part 004 — Status Codes as Backend State Contracts

> Seri: **HTTP for Web/Backend Perspective**  
> Target pembaca: **Java Software Engineer / Backend Engineer**  
> Fokus: memahami HTTP status code sebagai **kontrak state, recovery, observability, dan operational behavior**, bukan sekadar angka di response.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas HTTP method sebagai kontrak operasi:

- `GET` untuk retrieval.
- `POST` untuk process/command/create subordinate resource.
- `PUT` untuk replace.
- `PATCH` untuk partial modification.
- `DELETE` untuk removal/cancellation semantics.

Namun method saja belum cukup. Setelah server menerima request, server harus menjawab:

1. Apakah request berhasil?
2. Berhasil dalam arti apa?
3. Kalau gagal, siapa yang harus memperbaiki?
4. Apakah client boleh retry?
5. Apakah failure berasal dari input, permission, conflict, dependency, overload, atau bug?
6. Apakah response bisa dipakai oleh cache/proxy/client decision logic?
7. Apakah observability system bisa mengklasifikasikan kejadian secara benar?

Jawaban-jawaban itu dikodekan sebagian besar melalui **HTTP status code**.

Mental model penting:

> **HTTP status code adalah externalized state transition result.**  
> Ia adalah ringkasan formal tentang bagaimana server memahami request dan apa state interaksi berikutnya.

Status code yang salah membuat API terlihat bekerja, tetapi rusak secara sistemik:

- client salah retry;
- monitoring salah membaca health;
- gateway salah mengklasifikasikan error;
- cache salah menyimpan response;
- audit trail kehilangan makna;
- integration partner salah membangun workflow;
- incident response menjadi kabur.

Di backend production, status code bukan detail kecil. Ia adalah bagian dari **protocol contract**.

---

## 1. Core Mental Model: Status Code Menjawab “Apa State Relasi Client-Server Setelah Request Ini?”

Ketika backend mengirim response, status code menjawab pertanyaan:

```text
Request diterima oleh server.
Server memprosesnya sampai titik tertentu.
Sekarang client perlu memahami hasilnya.
```

Status code bukan hanya menyatakan “sukses/gagal”. Ia menyatakan kategori hubungan antara:

- request yang dikirim client;
- resource yang ditargetkan;
- authorization context;
- current server state;
- downstream dependency;
- server capacity;
- protocol constraints;
- representasi yang diminta/dikirim.

Contoh sederhana:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{ "respondentId": "R-123", "allegation": "..." }
```

Kemungkinan response:

```http
201 Created
Location: /cases/C-2026-0001
```

Artinya:

- request valid;
- caller berhak;
- case dibuat;
- resource baru punya URI;
- client bisa mengambil resource tersebut.

Tetapi:

```http
202 Accepted
Location: /case-submissions/S-9981
```

Artinya berbeda:

- request diterima;
- processing belum selesai;
- mungkin ada workflow asynchronous;
- client perlu cek status submission.

Sedangkan:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/duplicate-open-case",
  "title": "Duplicate open case",
  "status": 409,
  "detail": "An open case already exists for respondent R-123 under the same allegation category."
}
```

Artinya:

- request syntactically valid;
- caller mungkin authorized;
- tetapi current state domain menolak transisi;
- client perlu resolve conflict, bukan sekadar retry buta.

Status code adalah **boundary language** antara backend dan dunia luar.

---

## 2. Status Code Family: Jangan Hafalkan, Pahami Kategori State

HTTP status code dibagi menjadi lima kelas.

| Class | Meaning | Mental Model Backend |
|---|---|---|
| `1xx` | Informational | Server memberi informasi intermediate; request belum final |
| `2xx` | Success | Request diterima, dipahami, dan berhasil diproses sesuai semantics |
| `3xx` | Redirection | Client perlu action tambahan ke URI/representation lain |
| `4xx` | Client Error | Ada masalah pada request/client context; client harus mengubah sesuatu |
| `5xx` | Server Error | Server/dependency/capacity gagal memenuhi request valid |

Backend engineer top-tier tidak bertanya:

> “Ini error atau bukan?”

Melainkan:

> “Apakah caller dapat memperbaiki request/context-nya, atau server yang gagal memenuhi request valid?”

Itu pembeda paling penting antara `4xx` dan `5xx`.

---

## 3. `2xx`: Success Bukan Selalu `200 OK`

Banyak API amatir mengembalikan `200 OK` untuk semua keberhasilan. Ini kehilangan informasi penting.

### 3.1 `200 OK`

Gunakan ketika request berhasil dan response membawa representation/result normal.

Contoh:

```http
GET /cases/C-123 HTTP/1.1
```

```http
200 OK
Content-Type: application/json

{
  "id": "C-123",
  "status": "UNDER_REVIEW"
}
```

`200` cocok untuk:

- successful retrieval;
- successful command yang mengembalikan result;
- successful update yang mengembalikan representation terbaru;
- successful search/query.

Contoh:

```http
PATCH /cases/C-123 HTTP/1.1
If-Match: "v7"
Content-Type: application/json

{ "assignedOfficerId": "O-9" }
```

```http
200 OK
ETag: "v8"
Content-Type: application/json

{
  "id": "C-123",
  "assignedOfficerId": "O-9",
  "version": 8
}
```

Makna:

- update berhasil;
- server mengembalikan state terbaru;
- client bisa sinkron.

### 3.2 `201 Created`

Gunakan ketika request berhasil membuat resource baru dan server bisa mengidentifikasi URI resource tersebut.

Contoh:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{ "respondentId": "R-123" }
```

```http
201 Created
Location: /cases/C-2026-0001
Content-Type: application/json

{
  "id": "C-2026-0001",
  "status": "DRAFT"
}
```

Invariants:

- resource baru benar-benar tercipta;
- `Location` sebaiknya menunjuk URI resource baru;
- body boleh berisi representation resource baru.

Jangan pakai `201` jika:

- request hanya diterima untuk diproses nanti;
- resource belum pasti dibuat;
- operation hanya menjalankan action tanpa resource baru;
- server tidak punya URI resource baru.

### 3.3 `202 Accepted`

Gunakan ketika request valid dan diterima, tetapi processing belum selesai.

Contoh:

```http
POST /case-imports HTTP/1.1
Content-Type: multipart/form-data
```

```http
202 Accepted
Location: /case-imports/IMP-7788
Content-Type: application/json

{
  "importId": "IMP-7788",
  "status": "QUEUED"
}
```

Makna penting:

- belum tentu final success;
- server hanya menjanjikan request sudah diterima untuk diproses;
- client perlu follow-up melalui polling, callback, webhook, SSE, atau event.

Gunakan `202` untuk:

- long-running job;
- asynchronous workflow;
- export generation;
- document scanning;
- compliance screening;
- batch processing;
- command yang hasilnya tidak langsung diketahui.

Kesalahan umum:

```http
202 Accepted
```

lalu tidak menyediakan cara mengetahui hasil. Ini buruk. `202` hampir selalu perlu:

- `Location` ke job/submission/status resource;
- response body dengan current state;
- estimasi/progress bila tersedia;
- clear lifecycle state.

### 3.4 `204 No Content`

Gunakan ketika request berhasil tetapi server tidak mengirim response body.

Contoh:

```http
DELETE /sessions/current HTTP/1.1
```

```http
204 No Content
```

Cocok untuk:

- successful delete tanpa body;
- successful update ketika client tidak butuh representation;
- successful command tanpa result.

Penting:

- `204` tidak boleh punya message body.
- Jangan kirim JSON kosong `{}` dengan `204`.
- Jika perlu mengembalikan metadata meaningful, gunakan `200`.

### 3.5 `206 Partial Content`

Gunakan untuk range request ketika server mengirim sebagian representation.

Contoh:

```http
GET /exports/E-123/file HTTP/1.1
Range: bytes=0-999999
```

```http
206 Partial Content
Content-Range: bytes 0-999999/5000000
```

Penting untuk:

- download besar;
- resume download;
- media streaming;
- export file.

Backend yang mendukung file download besar perlu memahami `Range`, `Content-Range`, `Accept-Ranges`, dan authorization per-resource.

---

## 4. `3xx`: Redirection Bukan Hanya Urusan Browser

Redirect sering diasosiasikan dengan browser, tetapi backend API juga bisa memakainya dengan hati-hati.

### 4.1 `301 Moved Permanently`

Resource dipindah permanen. Client boleh memperbarui reference.

Risiko:

- cache/proxy/client mungkin menyimpan redirect lama;
- tidak cocok untuk eksperimen sementara;
- hati-hati untuk API karena client SDK mungkin tidak mengikuti redirect sesuai harapan.

### 4.2 `302 Found`

Redirect sementara historis. Dalam praktik, method handling bisa ambigu pada beberapa client lama.

Untuk API modern, lebih eksplisit gunakan `307` atau `308` jika method/body harus dipertahankan.

### 4.3 `303 See Other`

Cocok setelah `POST` ketika server ingin client mengambil result melalui `GET` ke URI lain.

Contoh:

```http
POST /reports HTTP/1.1
Content-Type: application/json

{ "type": "monthly" }
```

```http
303 See Other
Location: /reports/R-2026-06
```

Makna:

- command diterima/selesai;
- lihat resource hasil di URI lain dengan `GET`.

### 4.4 `304 Not Modified`

Digunakan untuk conditional retrieval.

Contoh:

```http
GET /cases/C-123 HTTP/1.1
If-None-Match: "v10"
```

```http
304 Not Modified
ETag: "v10"
```

Makna:

- representation yang dimiliki client/cache masih valid;
- response tidak membawa full body;
- sangat penting untuk caching dan bandwidth efficiency.

### 4.5 `307 Temporary Redirect`

Redirect sementara dengan method/body dipertahankan.

Cocok ketika:

- temporary routing;
- maintenance;
- upload endpoint dialihkan sementara.

### 4.6 `308 Permanent Redirect`

Redirect permanen dengan method/body dipertahankan.

Cocok untuk API migration permanen yang ingin mempertahankan method semantics.

---

## 5. `4xx`: Client/Request/Context Error

`4xx` berarti server menganggap masalah ada pada request atau context client. Bukan berarti user manusia selalu salah; bisa saja token expired, permission kurang, representation tidak valid, atau state conflict.

### 5.1 `400 Bad Request`

Gunakan untuk request yang malformed, tidak bisa diparse, atau melanggar syntax/protocol-level expectation.

Contoh:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{ invalid json
```

```http
400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/malformed-json",
  "title": "Malformed JSON",
  "status": 400,
  "detail": "Request body is not valid JSON."
}
```

Cocok untuk:

- malformed JSON;
- invalid query parameter syntax;
- invalid header format;
- missing required protocol-level parameter;
- impossible date format;
- body cannot be decoded.

Jangan pakai `400` untuk semua business validation jika ada status yang lebih tepat.

### 5.2 `401 Unauthorized`

Nama historisnya misleading. `401` berarti **unauthenticated** atau authentication gagal.

Gunakan ketika:

- tidak ada credential;
- token expired;
- token invalid;
- signature invalid;
- authentication scheme tidak diterima.

Response ideal menyertakan `WWW-Authenticate` bila relevan.

Contoh:

```http
401 Unauthorized
WWW-Authenticate: Bearer realm="case-api", error="invalid_token"
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-token",
  "title": "Invalid authentication token",
  "status": 401
}
```

Jangan pakai `401` untuk user yang sudah login tetapi tidak punya permission. Itu biasanya `403`.

### 5.3 `403 Forbidden`

Gunakan ketika caller sudah dikenali, tetapi tidak diizinkan melakukan action/access resource.

Contoh:

```http
GET /cases/C-123/evidence HTTP/1.1
Authorization: Bearer valid-token-for-wrong-role
```

```http
403 Forbidden
```

Makna:

- identity valid;
- authorization policy menolak;
- retry dengan request yang sama tidak akan berhasil kecuali permission/context berubah.

Catatan penting:

Kadang backend memilih `404` daripada `403` untuk menyembunyikan keberadaan resource. Itu keputusan security/product. Namun harus konsisten.

### 5.4 `404 Not Found`

Gunakan ketika resource target tidak ditemukan atau server tidak ingin mengungkap keberadaannya.

Contoh:

```http
GET /cases/C-NOT-EXIST HTTP/1.1
```

```http
404 Not Found
```

Makna:

- URI tidak menunjuk resource yang tersedia untuk caller;
- bisa benar-benar tidak ada;
- bisa disembunyikan oleh authorization boundary.

Jangan pakai `404` untuk business rule seperti “case cannot be approved”. Itu bukan resource missing.

### 5.5 `405 Method Not Allowed`

Gunakan ketika resource ada, tetapi method tidak didukung.

Contoh:

```http
DELETE /audit-events/A-100 HTTP/1.1
```

```http
405 Method Not Allowed
Allow: GET, HEAD
```

Penting:

- sertakan `Allow` header;
- beda dari `404`;
- membantu client dan API discoverability.

### 5.6 `406 Not Acceptable`

Gunakan ketika server tidak bisa menghasilkan representation yang sesuai dengan `Accept`.

Contoh:

```http
GET /cases/C-123 HTTP/1.1
Accept: application/xml
```

Jika API hanya mendukung JSON:

```http
406 Not Acceptable
```

Dalam banyak API, server kadang mengabaikan `Accept` dan tetap mengirim JSON. Itu pragmatis, tetapi jika API mengklaim strict negotiation, `406` lebih benar.

### 5.7 `408 Request Timeout`

Server tidak menerima complete request dalam waktu yang siap ditunggu.

Biasanya muncul dari server/proxy, bukan controller.

Penting untuk:

- slow client;
- incomplete upload;
- slowloris defense;
- connection management.

### 5.8 `409 Conflict`

Gunakan ketika request valid tetapi conflict dengan current state resource/domain.

Contoh:

```http
POST /cases/C-123/approval HTTP/1.1
```

Jika case masih `DRAFT` dan belum bisa approved:

```http
409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-case-state",
  "title": "Case cannot be approved from DRAFT state",
  "status": 409,
  "detail": "Case C-123 must be UNDER_REVIEW before approval."
}
```

Cocok untuk:

- invalid state transition;
- duplicate resource conflict;
- concurrent modification conflict;
- domain invariant conflict.

Bedakan dengan `422`:

- `422`: request content semantically invalid regardless of current resource state.
- `409`: request conflicts with current state or another resource.

### 5.9 `410 Gone`

Resource dulu ada tetapi sudah tidak tersedia secara permanen.

Contoh:

```http
GET /exports/E-OLD/file HTTP/1.1
```

```http
410 Gone
```

Cocok untuk:

- expired export;
- deleted document with known tombstone;
- retired API resource;
- lifecycle yang butuh membedakan “never existed” vs “used to exist”.

Dalam sistem audit/regulatory, `410` bisa penting karena menunjukkan resource memang pernah ada tapi sudah tidak tersedia.

### 5.10 `411 Length Required`

Server membutuhkan `Content-Length`, tetapi request tidak menyediakannya.

Relevan pada upload/body handling, terutama bila backend atau gateway tidak menerima chunked upload untuk endpoint tertentu.

### 5.11 `412 Precondition Failed`

Gunakan ketika conditional request gagal.

Contoh:

```http
PUT /cases/C-123 HTTP/1.1
If-Match: "v7"
Content-Type: application/json

{ ... }
```

Jika current ETag adalah `"v8"`:

```http
412 Precondition Failed
```

Makna:

- request secara umum mungkin valid;
- tetapi precondition header tidak cocok;
- client harus refresh state atau resolve conflict.

Ini sangat penting untuk optimistic concurrency control.

### 5.12 `413 Content Too Large`

Gunakan ketika request body terlalu besar.

Contoh:

```http
413 Content Too Large
Retry-After: 3600
```

Cocok untuk:

- upload melebihi limit;
- JSON payload terlalu besar;
- batch request terlalu besar;
- decompressed body terlalu besar.

Jangan biarkan request besar masuk sampai application layer jika gateway/container bisa menolak lebih awal.

### 5.13 `414 URI Too Long`

Gunakan ketika URI terlalu panjang.

Relevan untuk:

- query parameter berlebihan;
- encoded filter besar;
- client salah memakai `GET` untuk payload besar;
- search complex yang seharusnya `POST /searches` atau `POST /query`.

### 5.14 `415 Unsupported Media Type`

Gunakan ketika request `Content-Type` tidak didukung.

Contoh:

```http
POST /cases HTTP/1.1
Content-Type: text/plain

hello
```

```http
415 Unsupported Media Type
```

Cocok untuk:

- API hanya menerima `application/json`;
- endpoint upload hanya menerima multipart;
- patch endpoint hanya menerima patch media type tertentu.

### 5.15 `416 Range Not Satisfiable`

Gunakan ketika range request tidak valid untuk resource.

Contoh:

```http
GET /exports/E-123/file HTTP/1.1
Range: bytes=999999999-1000000000
```

Jika file lebih kecil:

```http
416 Range Not Satisfiable
Content-Range: bytes */5000000
```

### 5.16 `422 Unprocessable Content`

Gunakan ketika request syntactically valid dan media type dipahami, tetapi content semantically invalid.

Contoh:

```http
POST /cases HTTP/1.1
Content-Type: application/json

{
  "respondentId": "",
  "allegationDate": "2035-01-01"
}
```

```http
422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "errors": [
    {
      "field": "respondentId",
      "code": "required"
    },
    {
      "field": "allegationDate",
      "code": "future_date_not_allowed"
    }
  ]
}
```

Cocok untuk:

- field validation;
- semantic validation;
- domain input constraints;
- payload understood but unacceptable.

Perbedaan praktis:

| Case | Better Status |
|---|---|
| JSON rusak | `400` |
| `Content-Type` tidak didukung | `415` |
| JSON valid tapi field tidak valid | `422` |
| field valid tapi state transition conflict | `409` |

### 5.17 `423 Locked`

Berasal dari WebDAV, tetapi kadang relevan untuk resource locked.

Gunakan hati-hati. Banyak API lebih memilih `409` untuk lock conflict.

Contoh:

```http
423 Locked
```

Cocok jika API secara eksplisit punya locking model yang diketahui client.

### 5.18 `428 Precondition Required`

Gunakan ketika server mengharuskan conditional request untuk mencegah lost update.

Contoh:

```http
PUT /cases/C-123 HTTP/1.1
Content-Type: application/json

{ ... }
```

Server menolak karena tidak ada `If-Match`:

```http
428 Precondition Required
```

Makna:

- request mungkin valid;
- tetapi policy resource mengharuskan precondition;
- client harus mengirim `If-Match` atau mekanisme concurrency lain.

### 5.19 `429 Too Many Requests`

Gunakan ketika caller melebihi rate limit/quota.

Contoh:

```http
429 Too Many Requests
Retry-After: 60
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 60
```

Makna:

- server sengaja menolak karena fairness/protection;
- client seharusnya back off;
- bukan server bug.

Bedakan dengan `503`:

- `429`: caller-specific or quota-specific limit.
- `503`: service-wide unavailable/overloaded/maintenance.

### 5.20 `431 Request Header Fields Too Large`

Gunakan ketika header terlalu besar.

Cocok untuk:

- cookie bloat;
- token terlalu besar;
- header abuse;
- proxy/header limit exceeded.

Sering muncul saat aplikasi menyimpan terlalu banyak state di cookie.

---

## 6. `5xx`: Server/Dependency/Capacity Failure

`5xx` berarti request mungkin valid, tetapi server tidak bisa memenuhi.

### 6.1 `500 Internal Server Error`

Fallback untuk unexpected server failure.

Contoh penyebab:

- unhandled exception;
- null pointer;
- serialization failure;
- bug;
- invariant internal pecah;
- unexpected database driver error.

Jangan gunakan `500` untuk:

- validation error;
- unauthorized;
- forbidden;
- not found;
- conflict;
- known business rejection.

`500` harus berarti: **server punya defect atau unexpected condition**.

### 6.2 `501 Not Implemented`

Server tidak mendukung functionality yang diperlukan untuk memenuhi request.

Contoh:

- method tidak dikenali secara server-wide;
- feature belum diimplementasikan.

Untuk method yang tidak allowed pada resource tertentu, gunakan `405`, bukan `501`.

### 6.3 `502 Bad Gateway`

Gateway/proxy menerima response invalid dari upstream.

Biasanya berasal dari:

- reverse proxy;
- API gateway;
- service mesh;
- load balancer;
- backend-to-backend gateway.

Makna:

```text
Client -> Gateway -> Upstream
Gateway bisa dihubungi, tetapi upstream memberi response buruk/tidak valid.
```

Kemungkinan penyebab:

- upstream crash mid-response;
- invalid HTTP response;
- TLS/upstream protocol mismatch;
- connection reset;
- proxy cannot parse upstream response.

### 6.4 `503 Service Unavailable`

Server tidak tersedia sementara.

Cocok untuk:

- overload;
- maintenance;
- load shedding;
- dependency critical unavailable;
- instance draining;
- capacity protection.

Sebaiknya sertakan `Retry-After` jika masuk akal.

```http
503 Service Unavailable
Retry-After: 120
```

`503` yang baik adalah sinyal kepada client:

> “Jangan langsung hammer lagi. Tunggu/backoff.”

### 6.5 `504 Gateway Timeout`

Gateway/proxy tidak menerima response tepat waktu dari upstream.

Makna:

```text
Client -> Gateway -> Upstream
Gateway menunggu upstream, tetapi timeout.
```

Kemungkinan penyebab:

- backend lambat;
- DB lambat;
- deadlock;
- thread starvation;
- timeout mismatch;
- upstream overload.

Backend engineer perlu memahami bahwa `504` bisa muncul walaupun aplikasi akhirnya menyelesaikan transaksi setelah gateway timeout. Ini berbahaya untuk non-idempotent operations.

### 6.6 `507 Insufficient Storage`

Berasal dari WebDAV, tetapi dapat relevan jika server tidak bisa menyimpan representation/resource karena kapasitas storage.

Banyak API tetap menggunakan `500` atau `503`; gunakan `507` hanya jika client memang bisa memahami semantics-nya.

---

## 7. Decision Framework: Memilih Status Code dengan Benar

Gunakan alur berikut.

### 7.1 Langkah 1 — Apakah request bisa dipahami secara HTTP/protocol?

Jika tidak:

| Problem | Status |
|---|---|
| Malformed syntax | `400` |
| Header terlalu besar | `431` |
| Body terlalu besar | `413` |
| URI terlalu panjang | `414` |
| Content-Type tidak didukung | `415` |
| Method tidak diizinkan untuk resource | `405` |

### 7.2 Langkah 2 — Apakah caller authenticated?

| Condition | Status |
|---|---|
| Credential missing | `401` |
| Token invalid/expired | `401` |
| Authentication scheme unsupported | `401` |

### 7.3 Langkah 3 — Apakah caller authorized?

| Condition | Status |
|---|---|
| Authenticated but no permission | `403` |
| Hide resource existence | `404` |

### 7.4 Langkah 4 — Apakah resource ada?

| Condition | Status |
|---|---|
| Resource absent | `404` |
| Resource known removed permanently | `410` |

### 7.5 Langkah 5 — Apakah representation/request content valid?

| Condition | Status |
|---|---|
| Invalid JSON syntax | `400` |
| Valid JSON, invalid fields | `422` |
| Missing required domain field | `422` |
| Invalid enum value | `422` or `400` depending strictness |
| Unsupported media type | `415` |

### 7.6 Langkah 6 — Apakah state transition valid?

| Condition | Status |
|---|---|
| Current state prevents action | `409` |
| Duplicate resource conflict | `409` |
| Optimistic concurrency mismatch | `412` |
| Missing required precondition | `428` |

### 7.7 Langkah 7 — Apakah server berhasil memproses?

| Outcome | Status |
|---|---|
| Representation returned | `200` |
| Resource created | `201` |
| Accepted async | `202` |
| Success no body | `204` |
| Partial content | `206` |

### 7.8 Langkah 8 — Jika gagal bukan karena client?

| Failure | Status |
|---|---|
| Unexpected application bug | `500` |
| Gateway got invalid upstream response | `502` |
| Service overloaded/unavailable | `503` |
| Upstream timeout at gateway | `504` |

---

## 8. Status Code sebagai State Machine Output

Untuk workflow-heavy backend, status code bisa dipahami sebagai output dari state machine.

Contoh domain: regulatory case approval.

States:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
                         |              |
                         v              v
                      REJECTED       ESCALATED
```

Endpoint:

```http
POST /cases/{caseId}/approval
```

Decision table:

| Current State | Caller Role | Body Valid? | Result | Status |
|---|---:|---:|---|---:|
| `UNDER_REVIEW` | supervisor | yes | approval created | `201` or `200` |
| `DRAFT` | supervisor | yes | invalid transition | `409` |
| `UNDER_REVIEW` | officer | yes | not authorized | `403` |
| missing case | supervisor | yes | resource not found | `404` |
| `UNDER_REVIEW` | supervisor | no | validation failed | `422` |
| `UNDER_REVIEW` | supervisor | yes, stale version | precondition failed | `412` |
| any | unauthenticated | N/A | auth required | `401` |
| valid request | supervisor | yes, dependency down | service unavailable | `503` |

Backend dengan kualitas tinggi membuat mapping ini eksplisit, bukan tersebar acak dalam controller.

---

## 9. Status Code dan Retry Behavior

Status code memengaruhi apakah client/gateway/service mesh akan retry.

### 9.1 Umumnya aman untuk retry?

| Status | Retry? | Catatan |
|---|---:|---|
| `408` | maybe | jika request idempotent atau pakai idempotency key |
| `409` | no blind retry | perlu resolve conflict |
| `412` | no blind retry | perlu refresh representation/ETag |
| `429` | yes after delay | hormati `Retry-After` |
| `500` | maybe | hanya untuk idempotent operations atau protected by idempotency |
| `502` | maybe | transient upstream issue |
| `503` | yes after backoff | idealnya pakai `Retry-After` |
| `504` | dangerous | operation mungkin sukses di upstream setelah timeout |

### 9.2 Non-idempotent operation dan retry trap

Contoh:

```http
POST /payments
```

Gateway timeout:

```http
504 Gateway Timeout
```

Client tidak tahu apakah payment:

- belum diproses;
- sedang diproses;
- berhasil tapi response tidak sampai;
- gagal setelah partial side effect.

Karena itu untuk command non-idempotent, backend sebaiknya menyediakan:

- `Idempotency-Key`;
- operation status resource;
- transaction/outbox pattern;
- deduplication store;
- consistent error model.

Status code yang benar belum cukup; ia harus didukung oleh lifecycle design.

---

## 10. Status Code dan Observability

Monitoring backend sering mengelompokkan status code:

- `2xx` = success;
- `3xx` = redirect;
- `4xx` = client error;
- `5xx` = server error.

Tapi top-tier backend engineer melihat lebih detail.

### 10.1 Metrics yang sebaiknya ada

Minimal:

```text
http.server.request.count{method, route, status}
http.server.request.duration{method, route, status}
http.server.request.body.size{method, route}
http.server.response.body.size{method, route, status}
```

Tambahan production:

```text
business_error.count{operation, error_code}
auth.failure.count{reason}
validation.failure.count{route, field/code}
rate_limit.rejected.count{dimension}
concurrency_conflict.count{resource_type}
```

### 10.2 Jangan jadikan semua domain rejection sebagai `500`

Jika invalid state transition dikembalikan sebagai `500`, maka:

- SRE mengira service rusak;
- alert noise meningkat;
- client mungkin retry;
- error budget terpakai secara salah;
- root cause analysis kabur.

### 10.3 Jangan jadikan semua error sebagai `200`

Anti-pattern:

```http
200 OK
Content-Type: application/json

{
  "success": false,
  "error": "Unauthorized"
}
```

Dampak:

- gateway menganggap sukses;
- tracing/metrics tidak menunjukkan error;
- client generic tidak bisa menangani;
- cache bisa salah;
- retry policy salah;
- API contract lemah.

Boleh ada application-level error code, tetapi status code tetap harus benar.

---

## 11. Status Code dan Auditability

Untuk sistem regulatory, finance, government, healthcare, atau enforcement lifecycle, status code punya konsekuensi audit.

Audit event harus bisa membedakan:

- request tidak authenticated (`401`);
- caller authenticated tetapi forbidden (`403`);
- target tidak ditemukan (`404`);
- input invalid (`422`);
- state transition invalid (`409`);
- stale version (`412`);
- accepted for processing (`202`);
- created (`201`);
- server failed (`500/503/504`).

Contoh audit log buruk:

```json
{
  "event": "APPROVE_CASE_FAILED",
  "status": 500
}
```

Tidak cukup.

Audit log lebih baik:

```json
{
  "event": "APPROVE_CASE_REJECTED",
  "httpStatus": 409,
  "problemType": "invalid-case-state",
  "caseId": "C-123",
  "currentState": "DRAFT",
  "requestedTransition": "APPROVE",
  "actorId": "U-77",
  "correlationId": "req-abc"
}
```

HTTP status code bukan audit log penuh, tetapi menjadi dimensi klasifikasi yang sangat berguna.

---

## 12. Mapping Error Domain ke HTTP Status

Backend sering punya error taxonomy internal. Jangan langsung expose exception class.

Contoh taxonomy:

```text
AuthenticationError
AuthorizationError
ResourceNotFound
ValidationError
ConflictError
PreconditionError
RateLimitError
DependencyUnavailable
UnexpectedError
```

Mapping:

| Internal Error | HTTP Status | Public Category |
|---|---:|---|
| `MissingToken` | `401` | authentication_failed |
| `ExpiredToken` | `401` | authentication_failed |
| `PermissionDenied` | `403` | forbidden |
| `CaseNotFound` | `404` | not_found |
| `CaseArchivedGone` | `410` | gone |
| `MalformedJson` | `400` | bad_request |
| `BeanValidationFailed` | `422` | validation_failed |
| `InvalidStateTransition` | `409` | conflict |
| `OptimisticLockMismatch` | `412` | precondition_failed |
| `MissingIfMatch` | `428` | precondition_required |
| `QuotaExceeded` | `429` | rate_limited |
| `DatabaseUnavailable` | `503` | service_unavailable |
| `DownstreamBadResponse` | `502` | bad_gateway |
| `DownstreamTimeout` | `504` | gateway_timeout |
| `NullPointerException` | `500` | internal_error |

Tujuannya:

- domain tetap bersih;
- API response konsisten;
- observability konsisten;
- security leakage terkontrol.

---

## 13. Problem Details: Status Code Perlu Body yang Machine-Readable

Status code hanya angka ringkas. Untuk error yang meaningful, response body perlu struktur stabil.

Format umum yang direkomendasikan: `application/problem+json`.

Contoh:

```http
422 Unprocessable Content
Content-Type: application/problem+json
X-Correlation-ID: req-9f2a

{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request body contains invalid fields.",
  "instance": "/cases/submissions/S-123/errors/E-1",
  "correlationId": "req-9f2a",
  "errors": [
    {
      "field": "respondentId",
      "code": "required",
      "message": "respondentId is required."
    }
  ]
}
```

Prinsip:

1. `status` harus sama dengan HTTP status.
2. `type` harus stabil dan machine-readable.
3. `title` ringkas.
4. `detail` boleh human-readable, tetapi jangan bergantung untuk logic.
5. Jangan expose stack trace.
6. Sertakan correlation/request ID.
7. Gunakan error code stabil untuk client logic.

Part khusus error design akan dibahas lebih dalam di Part 010.

---

## 14. Spring MVC Mapping

### 14.1 Simple success response

```java
@GetMapping("/cases/{caseId}")
public ResponseEntity<CaseResponse> getCase(@PathVariable String caseId) {
    CaseResponse response = caseQueryService.getCase(caseId);
    return ResponseEntity.ok(response);
}
```

### 14.2 Created response

```java
@PostMapping("/cases")
public ResponseEntity<CaseResponse> createCase(@Valid @RequestBody CreateCaseRequest request) {
    CaseResponse created = caseCommandService.createCase(request);

    URI location = URI.create("/cases/" + created.id());

    return ResponseEntity
            .created(location)
            .body(created);
}
```

### 14.3 Accepted async response

```java
@PostMapping("/case-imports")
public ResponseEntity<ImportResponse> importCases(@RequestPart("file") MultipartFile file) {
    ImportResponse job = importService.enqueue(file);

    return ResponseEntity
            .accepted()
            .location(URI.create("/case-imports/" + job.importId()))
            .body(job);
}
```

### 14.4 No content response

```java
@DeleteMapping("/sessions/current")
public ResponseEntity<Void> logout() {
    sessionService.logoutCurrentSession();
    return ResponseEntity.noContent().build();
}
```

### 14.5 Exception mapping with `@ControllerAdvice`

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ProblemDetail> handleNotFound(ResourceNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setTitle("Resource not found");
        problem.setDetail(ex.getPublicMessage());
        problem.setType(URI.create("https://api.example.com/problems/not-found"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(InvalidStateTransitionException.class)
    public ResponseEntity<ProblemDetail> handleConflict(InvalidStateTransitionException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Invalid state transition");
        problem.setDetail(ex.getPublicMessage());
        problem.setType(URI.create("https://api.example.com/problems/invalid-state-transition"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

### 14.6 Common Spring mistake

Buruk:

```java
@PostMapping("/cases/{id}/approval")
public ResponseEntity<?> approve(@PathVariable String id) {
    try {
        return ResponseEntity.ok(caseService.approve(id));
    } catch (Exception e) {
        return ResponseEntity.ok(Map.of(
            "success", false,
            "message", e.getMessage()
        ));
    }
}
```

Masalah:

- semua error jadi `200`;
- exception leakage;
- observability rusak;
- client tidak bisa generic error handling;
- retry/gateway/cache salah.

Lebih baik:

```java
@PostMapping("/cases/{id}/approval")
public ResponseEntity<ApprovalResponse> approve(
        @PathVariable String id,
        @RequestHeader("If-Match") String etag,
        @Valid @RequestBody ApproveCaseRequest request
) {
    ApprovalResponse response = caseService.approve(id, etag, request);
    return ResponseEntity.ok(response);
}
```

Kemudian mapping exception dilakukan global di `@ControllerAdvice`.

---

## 15. Spring WebFlux Mapping

### 15.1 Success response

```java
@GetMapping("/cases/{caseId}")
public Mono<ResponseEntity<CaseResponse>> getCase(@PathVariable String caseId) {
    return caseQueryService.getCase(caseId)
            .map(ResponseEntity::ok);
}
```

### 15.2 Created response

```java
@PostMapping("/cases")
public Mono<ResponseEntity<CaseResponse>> createCase(@Valid @RequestBody Mono<CreateCaseRequest> request) {
    return request
            .flatMap(caseCommandService::createCase)
            .map(created -> ResponseEntity
                    .created(URI.create("/cases/" + created.id()))
                    .body(created));
}
```

### 15.3 Reactive caveat

Jangan mengubah error menjadi success signal tanpa status yang benar.

Buruk:

```java
return service.approve(id)
        .map(result -> ApiResponse.success(result))
        .onErrorResume(ex -> Mono.just(ApiResponse.failure(ex.getMessage())));
```

Itu berpotensi tetap mengirim `200`.

Lebih baik gunakan centralized error mapping:

```java
return service.approve(id)
        .map(ResponseEntity::ok);
```

Dan error ditangani oleh WebFlux exception handler.

---

## 16. Status Code, Gateway, dan Reverse Proxy

Tidak semua status code berasal dari aplikasi.

| Status | Sering Dihasilkan Oleh |
|---|---|
| `400` | gateway/proxy/app parser |
| `401` | gateway auth/app security |
| `403` | gateway WAF/app authorization |
| `404` | gateway routing/app resource lookup |
| `413` | gateway/container/app |
| `429` | gateway/rate limiter/app |
| `500` | app |
| `502` | gateway/proxy |
| `503` | load balancer/gateway/app |
| `504` | gateway/proxy |

Implikasi:

1. Jangan langsung menyalahkan controller saat melihat `502/504`.
2. Periksa proxy/gateway logs.
3. Pastikan correlation ID diteruskan sampai upstream.
4. Bedakan application status vs infrastructure status.
5. Pastikan timeout antar-layer konsisten.

Contoh path:

```text
Client
  -> CDN
  -> WAF
  -> API Gateway
  -> Load Balancer
  -> Service Mesh Sidecar
  -> Spring Boot App
  -> Database
```

`504` bisa muncul di API Gateway karena Spring Boot butuh 35 detik, sementara gateway timeout 30 detik. Aplikasi mungkin tetap commit di detik 33, tetapi client menerima timeout. Ini kembali ke idempotency design.

---

## 17. Status Code and Security Posture

Status code juga memengaruhi information disclosure.

### 17.1 `401` vs `403` vs `404`

Untuk endpoint private:

| Situation | Possible Status | Security Consideration |
|---|---:|---|
| no token | `401` | normal auth challenge |
| valid token, no permission | `403` | reveals resource may exist |
| valid token, resource belongs to another tenant | `404` | hides existence |

Contoh multi-tenant:

```http
GET /tenants/T-A/cases/C-1
Authorization: token for tenant T-B
```

Mengembalikan `403` bisa mengungkap bahwa `T-A` atau `C-1` ada. Mengembalikan `404` bisa lebih aman.

Namun jangan asal menyembunyikan semua. Operational support dan audit tetap perlu internal reason code.

Public response:

```http
404 Not Found
```

Internal audit:

```json
{
  "publicStatus": 404,
  "internalReason": "TENANT_BOUNDARY_DENIED",
  "actorTenant": "T-B",
  "targetTenant": "T-A"
}
```

### 17.2 Avoid stack trace with `500`

Buruk:

```json
{
  "status": 500,
  "exception": "java.lang.NullPointerException",
  "trace": "com.example.CaseService.approve(CaseService.java:82)..."
}
```

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal server error",
  "status": 500,
  "correlationId": "req-123"
}
```

Stack trace masuk log internal, bukan response.

---

## 18. Status Code and API Documentation

API documentation harus punya status matrix per endpoint.

Contoh endpoint:

```http
POST /cases/{caseId}/approval
```

Dokumentasi minimal:

| Status | Meaning | Body |
|---:|---|---|
| `200` | Case approved, approval result returned | `ApprovalResponse` |
| `400` | Malformed request | `Problem` |
| `401` | Missing/invalid authentication | `Problem` |
| `403` | Caller lacks approval permission | `Problem` |
| `404` | Case not found or hidden | `Problem` |
| `409` | Case current state does not allow approval | `Problem` |
| `412` | Version/ETag precondition failed | `Problem` |
| `422` | Approval request payload invalid | `Problem` |
| `429` | Rate limit exceeded | `Problem` |
| `500` | Unexpected server failure | `Problem` |
| `503` | Service temporarily unavailable | `Problem` |

OpenAPI yang hanya menulis `200` dan `500` biasanya belum production-grade.

---

## 19. Anti-Patterns

### 19.1 Always `200 OK`

```http
200 OK

{ "error": "NOT_FOUND" }
```

Dampak:

- observability false success;
- clients must parse body for basic control flow;
- caches/proxies may behave incorrectly;
- violates HTTP semantics.

### 19.2 Always `500 Internal Server Error`

```http
500 Internal Server Error

{ "error": "Validation failed" }
```

Dampak:

- false server error;
- alerts noisy;
- retry storms;
- error budget polluted.

### 19.3 Using `404` for every rejection

```http
404 Not Found
```

untuk:

- invalid input;
- invalid state;
- no permission;
- unsupported method.

Dampak:

- debugging sulit;
- client tidak bisa react;
- API contract miskin.

### 19.4 Using `400` for everything client-related

`400` sering menjadi tempat sampah untuk:

- validation error;
- conflict;
- authorization;
- unsupported media type;
- concurrency failure.

Lebih baik spesifik.

### 19.5 Exposing internal exception names

```json
{
  "error": "JpaOptimisticLockingFailureException"
}
```

Dampak:

- implementation leakage;
- coupling client ke framework;
- security risk.

Map ke public problem:

```http
412 Precondition Failed
```

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Resource version mismatch",
  "status": 412
}
```

### 19.6 Ignoring `Location` on `201`/`202`

`201` tanpa `Location` masih bisa valid dalam beberapa kasus, tetapi API yang bagus biasanya menyediakan URI resource baru.

`202` tanpa status resource membuat asynchronous workflow sulit dioperasikan.

### 19.7 Returning body with `204`

```http
204 No Content
Content-Type: application/json

{}
```

Salah secara semantics. Gunakan `200` jika ingin body.

---

## 20. Practical Status Code Selection Examples

### 20.1 Create case

```http
POST /cases
```

| Situation | Status |
|---|---:|
| created immediately | `201` |
| accepted for asynchronous screening | `202` |
| malformed JSON | `400` |
| invalid fields | `422` |
| duplicate open case | `409` |
| unauthenticated | `401` |
| no permission to create case | `403` |
| rate limited | `429` |
| database unavailable | `503` |

### 20.2 Get case

```http
GET /cases/{id}
```

| Situation | Status |
|---|---:|
| found | `200` |
| not found | `404` |
| hidden by tenant boundary | `404` |
| authenticated but forbidden and disclosure acceptable | `403` |
| conditional request not modified | `304` |
| unauthenticated | `401` |

### 20.3 Update case

```http
PUT /cases/{id}
```

| Situation | Status |
|---|---:|
| replaced and response returned | `200` |
| replaced, no body | `204` |
| resource not found | `404` |
| missing `If-Match` required by policy | `428` |
| stale `If-Match` | `412` |
| invalid body | `422` |
| invalid state for replacement | `409` |
| unsupported media type | `415` |

### 20.4 Upload evidence

```http
POST /cases/{id}/evidence
```

| Situation | Status |
|---|---:|
| evidence uploaded and resource created | `201` |
| upload accepted for virus scan | `202` |
| file too large | `413` |
| unsupported file type/media type | `415` or `422` |
| case not found | `404` |
| case closed, no more evidence accepted | `409` |
| storage unavailable | `503` or `507` |

### 20.5 Approve case

```http
POST /cases/{id}/approval
```

| Situation | Status |
|---|---:|
| approved | `200` or `201` |
| approval accepted async | `202` |
| case state invalid | `409` |
| stale version | `412` |
| invalid approval reason | `422` |
| not supervisor | `403` |
| case absent/hidden | `404` |

---

## 21. Designing a Status Policy for Your Backend

Production systems should have a status policy document.

Minimal policy:

```text
1. Authentication failures return 401.
2. Authorization failures return 403 unless resource existence must be hidden, then 404.
3. Malformed request syntax returns 400.
4. Unsupported request media type returns 415.
5. Semantic validation errors return 422.
6. Domain state conflicts return 409.
7. Optimistic concurrency mismatches return 412.
8. Missing required preconditions return 428.
9. Successful creation returns 201 with Location.
10. Accepted asynchronous commands return 202 with status resource Location.
11. Successful no-body operations return 204.
12. Rate limit rejection returns 429 with Retry-After when possible.
13. Unexpected defects return 500 with correlation ID only.
14. Temporary service unavailability returns 503 with Retry-After when possible.
15. Gateway/upstream timeout is represented as 504 at gateway layer.
```

Ini membuat API lintas-team konsisten.

---

## 22. Testing Status Code Correctness

Status code perlu dites eksplisit.

### 22.1 Unit/controller tests

```java
mockMvc.perform(post("/cases")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{ invalid json"))
    .andExpect(status().isBadRequest());
```

```java
mockMvc.perform(post("/cases")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
            { "respondentId": "" }
        """))
    .andExpect(status().isUnprocessableEntity());
```

```java
mockMvc.perform(post("/cases/C-123/approval")
        .header("Authorization", "Bearer supervisor-token")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{ \"reason\": \"ok\" }"))
    .andExpect(status().isConflict());
```

### 22.2 Contract tests

Consumer-driven tests should assert:

- expected success status;
- expected failure status;
- error body shape;
- headers such as `Location`, `ETag`, `Retry-After`.

### 22.3 Integration tests through gateway

Some status codes are produced by gateway/proxy. Test through real routing path:

- body too large -> `413`;
- rate limit -> `429`;
- upstream timeout -> `504`;
- maintenance/drain -> `503`;
- invalid auth -> `401`.

Controller tests alone are insufficient.

---

## 23. Operational Playbook by Status Code

A good backend team has rough playbook.

| Spike | Likely Meaning | First Investigation |
|---|---|---|
| `400` | malformed clients, schema drift | sample request, client version |
| `401` | auth expiry/config issue | identity provider, token validation |
| `403` | permission/policy change | authorization logs, role mapping |
| `404` | bad routing or missing resource | route config, IDs, tenant boundary |
| `409` | domain conflict increase | workflow changes, concurrent ops |
| `412` | stale clients/concurrency | ETag/version usage |
| `413` | payload growth/abuse | upload size, client behavior |
| `415` | content type mismatch | client SDK/media type |
| `422` | validation failure | field errors, schema rollout |
| `429` | quota/rate issue | traffic source, tenant usage |
| `500` | application bug | logs/traces, recent deploy |
| `502` | upstream/proxy issue | gateway logs, upstream health |
| `503` | overload/maintenance | saturation, dependency availability |
| `504` | latency/timeouts | traces, DB, downstream, timeout mismatch |

Status code adalah diagnosis index.

---

## 24. Mini Capstone: Approval Endpoint Status Matrix

Kita desain endpoint:

```http
POST /cases/{caseId}/approval
```

Request:

```json
{
  "decision": "APPROVE",
  "reason": "Evidence is sufficient",
  "effectiveDate": "2026-06-18"
}
```

Headers:

```http
Authorization: Bearer <token>
If-Match: "case-v12"
Content-Type: application/json
Accept: application/json
```

Status matrix:

| Layer | Condition | Status | Problem Type |
|---|---|---:|---|
| Protocol | malformed JSON | `400` | malformed-json |
| Content negotiation | unsupported `Content-Type` | `415` | unsupported-media-type |
| Authn | missing/expired token | `401` | authentication-failed |
| Authz | actor not supervisor | `403` | forbidden |
| Resource | case absent/hidden | `404` | not-found |
| Precondition policy | missing `If-Match` | `428` | precondition-required |
| Concurrency | stale ETag | `412` | precondition-failed |
| Validation | reason missing | `422` | validation-failed |
| Domain state | case still DRAFT | `409` | invalid-case-state |
| Success | approval applied and result returned | `200` | N/A |
| Success async | approval queued for legal review | `202` | N/A |
| Capacity | approval service overloaded | `503` | service-unavailable |
| Bug | unexpected exception | `500` | internal-error |

This is what mature backend API design looks like: each outcome has a clear status, reason, recovery path, and observability meaning.

---

## 25. Heuristics for Top 1% Backend Engineers

### 25.1 Think in recovery behavior

Ask:

```text
What should the client do next?
```

- retry now?
- retry later?
- refresh state?
- change input?
- re-authenticate?
- request permission?
- stop permanently?
- poll status resource?

Status code should help answer this.

### 25.2 Think in ownership of failure

Ask:

```text
Who owns the fix?
```

- client request construction -> `4xx`;
- user permission/authentication -> `401/403`;
- domain state -> `409`;
- concurrency -> `412/428`;
- quota -> `429`;
- server bug/dependency/capacity -> `5xx`.

### 25.3 Think in observability

Ask:

```text
Will metrics/traces/logs tell the truth if we use this status?
```

If not, status is probably wrong.

### 25.4 Think in contract evolution

Ask:

```text
Can clients safely build logic around this?
```

If status mapping changes randomly across releases, integration clients suffer.

### 25.5 Think in domain state machine

For workflow systems, map:

```text
method + URI + current state + actor + precondition + input -> status + response
```

This one formula prevents many design errors.

---

## 26. Checklist: Status Code Design Review

Gunakan checklist ini saat review API backend.

### Success

- [ ] Does creation return `201` when a resource is created?
- [ ] Does `201` include `Location` where appropriate?
- [ ] Does async processing return `202` with status resource?
- [ ] Does no-body success use `204` without body?
- [ ] Does retrieval use `200` with correct representation?

### Client errors

- [ ] Is malformed syntax separated from semantic validation?
- [ ] Are authn failures `401`?
- [ ] Are authz failures `403` or intentionally hidden as `404`?
- [ ] Is missing resource `404`?
- [ ] Is permanently gone resource `410` when lifecycle matters?
- [ ] Are domain state conflicts `409`?
- [ ] Are optimistic lock failures `412`?
- [ ] Is required precondition missing represented as `428`?
- [ ] Is rate limiting `429`?
- [ ] Is unsupported media type `415`?

### Server errors

- [ ] Are unexpected bugs `500`?
- [ ] Is overload/unavailability `503`?
- [ ] Are gateway/upstream failures distinguishable as `502/504`?
- [ ] Are `5xx` not used for expected business rejections?

### Error body

- [ ] Are error responses machine-readable?
- [ ] Is there a stable problem type/error code?
- [ ] Is correlation ID included?
- [ ] Are stack traces hidden?
- [ ] Are sensitive details redacted?

### Observability

- [ ] Are status codes included in metrics?
- [ ] Are route templates used instead of raw paths in metrics?
- [ ] Are 4xx/5xx dashboards separated?
- [ ] Are domain conflict/validation metrics tracked separately?

---

## 27. Latihan

### Latihan 1 — Classify outcomes

Untuk endpoint:

```http
PATCH /cases/{caseId}
```

Tentukan status code untuk:

1. JSON malformed.
2. `Content-Type: text/plain`.
3. caller tidak punya token.
4. caller punya token tetapi bukan pemilik case.
5. case tidak ditemukan.
6. `If-Match` hilang padahal policy mengharuskan.
7. `If-Match` stale.
8. field `priority` berisi nilai yang tidak dikenal.
9. case sudah `CLOSED` sehingga tidak bisa diubah.
10. update berhasil dan server mengembalikan representation terbaru.
11. update berhasil tanpa body.
12. database unavailable.

Jawaban yang diharapkan:

1. `400`
2. `415`
3. `401`
4. `403` atau `404` jika ingin hide existence
5. `404`
6. `428`
7. `412`
8. `422` atau `400` tergantung policy enum strictness; dalam API domain biasanya `422`
9. `409`
10. `200`
11. `204`
12. `503` jika dependency unavailable sementara; `500` jika unexpected internal defect

### Latihan 2 — Fix bad API

Bad API:

```http
POST /approveCase
```

Response untuk semua hasil:

```http
200 OK

{
  "success": false,
  "message": "Cannot approve case"
}
```

Perbaiki:

- URI;
- method;
- status matrix;
- error body;
- observability fields.

Salah satu solusi:

```http
POST /cases/{caseId}/approval
```

Outcomes:

| Condition | Status |
|---|---:|
| approved | `200` or `201` |
| async approval workflow started | `202` |
| missing token | `401` |
| no approval permission | `403` |
| case missing/hidden | `404` |
| invalid approval payload | `422` |
| invalid state | `409` |
| stale version | `412` |
| overloaded | `503` |

Error body:

```json
{
  "type": "https://api.example.com/problems/invalid-case-state",
  "title": "Case cannot be approved from its current state",
  "status": 409,
  "detail": "Case C-123 is DRAFT and must be UNDER_REVIEW before approval.",
  "correlationId": "req-abc"
}
```

### Latihan 3 — Build your team policy

Buat dokumen internal satu halaman:

```text
For our APIs:
- validation error = ?
- business conflict = ?
- stale version = ?
- async accepted = ?
- no-body success = ?
- rate limited = ?
- dependency unavailable = ?
- hidden unauthorized resource = ?
```

Tujuannya bukan sempurna, tetapi konsisten.

---

## 28. Ringkasan

Status code adalah salah satu bagian paling kecil tetapi paling menentukan dalam desain HTTP backend.

Poin utama:

1. Status code adalah **state contract**, bukan dekorasi.
2. `200` bukan satu-satunya success.
3. `4xx` berarti client/request/context perlu berubah.
4. `5xx` berarti server/dependency/capacity gagal memenuhi request valid.
5. `409`, `412`, dan `428` sangat penting untuk workflow dan concurrency.
6. `202` wajib dipikirkan bersama status resource/asynchronous lifecycle.
7. `429`, `503`, dan `504` sangat memengaruhi retry behavior.
8. Error body harus machine-readable, aman, dan observable.
9. Status mapping harus konsisten lintas endpoint dan tim.
10. Backend engineer yang kuat memilih status berdasarkan recovery behavior, ownership of failure, dan domain state transition.

Formula akhir:

```text
HTTP method + target resource + request representation + actor context
+ current resource/domain state + preconditions + server capacity
= status code + response representation + next action
```

Jika formula itu jelas, API Anda jauh lebih mudah diintegrasikan, dioperasikan, diamankan, dan dipertahankan.

---

## 29. Referensi

- RFC 9110 — HTTP Semantics.
- RFC 9111 — HTTP Caching.
- RFC 9112 — HTTP/1.1.
- RFC 9457 — Problem Details for HTTP APIs.
- Spring Framework Reference — Web MVC.
- Spring Framework Reference — WebFlux.
- OWASP REST Security Cheat Sheet.
- OWASP API Security Top 10.
- OpenTelemetry Semantic Conventions for HTTP.

---

## 30. Status Seri

Part ini adalah:

```text
Part 004 dari 032
```

Seri **belum selesai**.

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-005.md
```

Judul:

```text
Headers as Backend Control Plane
```
