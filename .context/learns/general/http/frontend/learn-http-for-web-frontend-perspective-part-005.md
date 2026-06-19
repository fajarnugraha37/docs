# learn-http-for-web-frontend-perspective-part-005.md

# Part 005 — Status Codes: Reading Outcomes Like a Protocol Engineer

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java Software Engineer yang ingin memahami HTTP dari sisi browser/frontend secara tajam, praktis, dan defensible.  
> Posisi dalam seri: setelah memahami HTTP methods, kita masuk ke **status code** sebagai bahasa outcome antara server, browser, JavaScript client, CDN, proxy, security layer, dan UI.

---

## 0. Tujuan Bagian Ini

Setelah menyelesaikan bagian ini, Anda diharapkan bisa:

1. membaca status code bukan sebagai “angka error”, tetapi sebagai **semantic signal**;
2. membedakan failure transport, failure HTTP, dan failure domain;
3. merancang branching frontend yang tidak rapuh;
4. menentukan kapan request aman di-retry dan kapan berbahaya;
5. menghindari anti-pattern seperti `200 OK` dengan `{ success: false }` untuk semua hal;
6. mendesain error contract yang membantu UI, observability, support, audit, dan backend debugging;
7. memahami kenapa status code yang benar membuat sistem lebih mudah dioperasikan;
8. membangun matrix status code untuk aplikasi enterprise/frontend SPA.

Status code adalah salah satu bagian HTTP yang sering dianggap sederhana, padahal di production ia menjadi pusat keputusan untuk:

- UI behavior;
- retry policy;
- cache behavior;
- auth state machine;
- observability dashboard;
- alerting;
- API gateway routing;
- CDN behavior;
- browser redirect handling;
- security controls;
- audit trail;
- SLO/SLA classification.

Mental model yang benar:

```text
HTTP status code bukan hanya “hasil request”.
HTTP status code adalah sinyal outcome terstandar yang dipakai banyak layer untuk mengambil keputusan.
```

---

## 1. Status Code sebagai Bahasa Outcome

Sebuah HTTP response secara sederhana membawa:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id": 123, "name": "Alice"}
```

Bagian paling penting untuk topik ini adalah:

```http
200 OK
```

Status code menjawab pertanyaan:

```text
Bagaimana server/proxy/origin menilai hasil dari request ini pada level HTTP?
```

Bukan selalu:

```text
Apakah operasi bisnis benar-benar berhasil secara domain?
```

Itu penting.

Contoh:

```http
HTTP/1.1 202 Accepted
```

Artinya request diterima untuk diproses, tetapi proses belum selesai. Dari sisi HTTP, request valid dan diterima. Dari sisi bisnis, outcome final belum terjadi.

Contoh lain:

```http
HTTP/1.1 409 Conflict
```

Artinya request dapat dipahami, user mungkin authorized, payload mungkin valid, tetapi operasi tidak dapat diterapkan karena konflik dengan current state resource.

Dalam sistem frontend yang matang, status code menjadi input untuk state machine:

```text
Request Sent
  -> Response 2xx -> Success path
  -> Response 3xx -> Redirect path / browser-handled path
  -> Response 4xx -> Client/action/data/auth problem path
  -> Response 5xx -> Server/platform/transient failure path
  -> Network error -> No HTTP response path
  -> Abort -> Intentional cancellation path
  -> Timeout -> Client-imposed uncertainty path
```

---

## 2. Tiga Layer Outcome yang Harus Dipisahkan

Frontend engineer sering mencampur tiga hal ini:

1. **Transport outcome**
2. **HTTP outcome**
3. **Domain outcome**

### 2.1 Transport Outcome

Transport outcome menjawab:

```text
Apakah browser berhasil mendapatkan HTTP response?
```

Contoh failure sebelum ada response HTTP:

- DNS gagal;
- TCP connection gagal;
- TLS handshake gagal;
- koneksi putus;
- request diblokir browser policy;
- request dibatalkan dengan `AbortController`;
- request timeout pada client wrapper;
- offline;
- captive portal;
- CORS failure yang membuat JS tidak bisa membaca response.

Pada `fetch()`, banyak kondisi ini muncul sebagai rejected promise atau opaque/unreadable response tergantung mode.

Contoh:

```ts
try {
  const response = await fetch('/api/users/123');
  // Kalau sampai sini, biasanya ada HTTP-level response yang bisa dibaca.
} catch (error) {
  // Bisa DNS, TLS, offline, CORS blocked, abort, browser policy, dll.
}
```

Catatan penting:

```text
HTTP status code hanya ada jika HTTP response berhasil tersedia untuk layer yang membaca.
```

Jika tidak ada HTTP response yang bisa dibaca JavaScript, maka tidak ada `response.status` yang bermakna.

### 2.2 HTTP Outcome

HTTP outcome menjawab:

```text
Menurut HTTP/server/proxy, request ini menghasilkan status apa?
```

Contoh:

```http
HTTP/1.1 404 Not Found
```

Atau:

```http
HTTP/1.1 503 Service Unavailable
```

Pada `fetch()`, status 404/500 **tidak otomatis reject**.

```ts
const response = await fetch('/api/users/999');
console.log(response.status); // 404
console.log(response.ok);     // false
```

`fetch()` reject untuk network-level failure, bukan untuk HTTP error status.

### 2.3 Domain Outcome

Domain outcome menjawab:

```text
Apa arti bisnis dari response ini?
```

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "eligibility": "REJECTED",
  "reason": "AGE_BELOW_THRESHOLD"
}
```

Ini bukan HTTP error. Request sukses. Server berhasil mengevaluasi eligibility. Domain result-nya adalah rejected.

Kesalahan umum:

```json
{
  "success": false,
  "error": "User not found"
}
```

dengan status:

```http
HTTP/1.1 200 OK
```

Untuk resource lookup yang benar-benar tidak menemukan user, status `404` lebih masuk akal. Tetapi untuk domain workflow seperti “loan application rejected”, `200` atau `201` bisa benar karena rejection adalah hasil bisnis valid.

Pembedaan tajam:

```text
HTTP error = request tidak dapat dipenuhi sesuai kontrak HTTP/API.
Domain negative result = request berhasil diproses, tetapi hasil bisnisnya negatif.
```

---

## 3. Status Code Classes

HTTP status code dikelompokkan dalam lima kelas besar:

```text
1xx = Informational
2xx = Successful
3xx = Redirection
4xx = Client Error
5xx = Server Error
```

Mental model praktis:

| Class | Makna Utama | Pertanyaan Frontend |
|---|---|---|
| 1xx | Server memberi informasi intermediate | Apakah browser/tooling menampilkan ini? Apakah ada Early Hints? |
| 2xx | Request berhasil pada level HTTP | Apa body-nya? Apakah final atau async? |
| 3xx | Client perlu mengikuti lokasi lain / browser melakukan redirect | Apakah redirect transparan? Apakah method berubah? Apakah CORS/auth terpengaruh? |
| 4xx | Request bermasalah dari sisi client/action/authorization/input/state | Apa yang harus user ubah? Apakah perlu login? |
| 5xx | Server/upstream/platform gagal memenuhi request valid | Apakah retry aman? Apakah tampilkan fallback? |

Kelas status code bukan detail kecil. Ia memberi sinyal kepada:

- browser;
- HTTP cache;
- CDN;
- reverse proxy;
- API gateway;
- monitoring;
- alerting;
- synthetic test;
- frontend HTTP client;
- load balancer;
- mobile/web SDK;
- support tooling.

---

## 4. The Golden Rule: Status Code Harus Mewakili Layer yang Gagal

Salah satu prinsip paling penting:

```text
Gunakan status code untuk menunjukkan di layer mana request gagal.
```

Contoh:

| Situasi | Status yang Cocok | Kenapa |
|---|---:|---|
| Payload JSON invalid | 400 | Request malformed |
| Field `email` tidak valid | 422 atau 400 | Request syntactically valid, semantically invalid |
| Belum login | 401 | Authentication dibutuhkan |
| Sudah login tapi tidak punya izin | 403 | Authorization gagal |
| Resource tidak ada | 404 | Target resource tidak ditemukan |
| Update konflik dengan versi terbaru | 409 atau 412 | State conflict/precondition failed |
| Terlalu banyak request | 429 | Rate limiting |
| Dependency service down | 502/503 | Upstream/platform issue |
| Request terlalu lama di gateway | 504 | Gateway timeout |

Jika semua error dijadikan `500`, frontend kehilangan kemampuan membedakan:

- user perlu login;
- user perlu memperbaiki input;
- data sudah berubah;
- server sedang down;
- request boleh di-retry;
- request harus dihentikan.

Jika semua error dijadikan `200`, maka:

- monitoring menganggap sistem sehat;
- CDN/proxy bisa salah cache;
- SDK harus parse body untuk semua keputusan;
- browser/devtools misleading;
- API gateway sulit membuat policy;
- SLO error rate menjadi palsu;
- alerting tidak bekerja.

---

## 5. 2xx: Successful Responses

### 5.1 `200 OK`

`200 OK` berarti request sukses dan response biasanya berisi representasi hasil.

Contoh:

```http
GET /api/users/123 HTTP/1.1
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "123",
  "name": "Alice"
}
```

Gunakan `200` untuk:

- successful GET;
- successful POST yang mengembalikan result umum;
- successful PUT/PATCH yang mengembalikan updated representation;
- domain evaluation yang berhasil dihitung;
- search result, termasuk hasil kosong.

Contoh hasil kosong yang tetap `200`:

```http
GET /api/users?role=admin&status=inactive HTTP/1.1
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "items": [],
  "total": 0
}
```

Kenapa bukan `404`?

Karena resource collection/search endpoint ditemukan dan query berhasil diproses. Hasilnya saja kosong.

Mental model:

```text
404 = endpoint/resource target tidak ditemukan.
200 dengan empty list = query valid, result set kosong.
```

### 5.2 `201 Created`

`201 Created` berarti request berhasil membuat resource baru.

Contoh:

```http
POST /api/orders HTTP/1.1
Content-Type: application/json

{
  "sku": "BOOK-1",
  "quantity": 2
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /api/orders/ord_123
Content-Type: application/json

{
  "id": "ord_123",
  "status": "PENDING_PAYMENT"
}
```

Frontend consequence:

- navigasi ke detail page bisa memakai `Location`;
- cache bisa invalidasi collection;
- UI bisa menampilkan created state;
- analytics bisa mencatat successful creation;
- idempotency perlu dipikirkan untuk duplicate submit.

Kapan `201` lebih baik dari `200`?

Gunakan `201` saat resource baru jelas dibuat dan memiliki identity baru.

Kapan `200` masih masuk akal?

- endpoint tidak merepresentasikan resource creation;
- operasi command menghasilkan domain result;
- resource sudah ada karena idempotency dan server mengembalikan existing state;
- API contract lama sudah menetapkan `200`.

### 5.3 `202 Accepted`

`202 Accepted` berarti request diterima, tetapi belum selesai diproses.

Contoh:

```http
POST /api/reports/export HTTP/1.1
Content-Type: application/json

{
  "from": "2026-01-01",
  "to": "2026-06-01"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /api/jobs/job_789
Content-Type: application/json

{
  "jobId": "job_789",
  "status": "QUEUED"
}
```

Frontend consequence:

- jangan tampilkan “selesai”;
- tampilkan “processing”;
- lakukan polling ke status resource;
- sediakan cancel jika ada;
- handle timeout berbeda dari failure;
- status akhir bisa success/failure.

State machine:

```text
Submit export
  -> 202 Accepted
  -> Poll /api/jobs/job_789
      -> RUNNING
      -> SUCCEEDED -> download available
      -> FAILED -> show failure reason
      -> CANCELLED -> show cancelled
```

Anti-pattern:

```http
HTTP/1.1 200 OK

{"message": "Your export will be processed later"}
```

Ini kurang jelas karena `200` terlihat final. `202` memberi sinyal bahwa outcome final asynchronous.

### 5.4 `204 No Content`

`204 No Content` berarti request berhasil, tetapi response tidak memiliki body.

Contoh:

```http
DELETE /api/users/123 HTTP/1.1
```

Response:

```http
HTTP/1.1 204 No Content
```

Frontend consequence:

- jangan panggil `response.json()` tanpa cek;
- update UI berdasarkan status;
- tidak ada representation baru untuk merge;
- cocok untuk delete, toggle sederhana, atau update yang tidak butuh body.

Bug umum:

```ts
const response = await fetch('/api/users/123', { method: 'DELETE' });
const data = await response.json(); // bisa gagal kalau 204 empty body
```

Lebih aman:

```ts
const response = await fetch('/api/users/123', { method: 'DELETE' });

if (response.status === 204) {
  return undefined;
}

return await response.json();
```

### 5.5 `206 Partial Content`

`206 Partial Content` digunakan untuk range request.

Contoh use case:

- video streaming;
- resume download;
- large file partial read.

Request:

```http
GET /videos/intro.mp4 HTTP/1.1
Range: bytes=0-999999
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-999999/5000000
```

Frontend biasanya tidak menangani ini manual untuk media element, tetapi penting untuk debugging video/audio/file delivery.

---

## 6. 3xx: Redirect Responses

3xx berarti client perlu memakai resource/lokasi lain, atau response terkait cache validation.

Untuk browser/frontend, redirect adalah area berbahaya karena:

- browser bisa follow otomatis;
- `fetch()` bisa follow otomatis;
- method bisa berubah pada beberapa redirect;
- credential/cookie behavior bisa berubah;
- CORS bisa gagal karena redirect;
- auth flow sering memakai redirect;
- token bisa bocor lewat URL jika desain buruk.

Bagian redirect akan dibahas khusus pada Part 016, tetapi status utama perlu dipahami sejak sekarang.

### 6.1 `301 Moved Permanently`

Resource dipindahkan permanen.

Frontend consequence:

- browser/cache dapat mengingat redirect;
- SEO terpengaruh;
- method rewriting historis bisa terjadi di beberapa client;
- hati-hati untuk API mutation.

Umumnya cocok untuk:

- canonical URL;
- HTTP ke HTTPS;
- domain migration;
- trailing slash canonicalization jika stabil.

### 6.2 `302 Found`

Redirect sementara. Secara historis sering mengubah POST menjadi GET pada browser.

Banyak auth flow lama memakai `302`.

Frontend issue:

- API `fetch()` yang mendapat HTML login page karena `302` ke `/login`;
- SPA mengira response sukses karena redirect final `200 text/html`;
- CORS bisa gagal karena redirect ke origin lain.

Contoh masalah:

```text
fetch('/api/me')
  -> 302 /login
  -> 200 text/html login page
  -> response.json() gagal
```

Untuk API, lebih baik mengembalikan `401` daripada redirect ke HTML login page, kecuali endpoint memang navigation endpoint.

### 6.3 `303 See Other`

Cocok setelah POST ketika client harus mengambil resource lain dengan GET.

Contoh:

```http
POST /checkout HTTP/1.1
```

Response:

```http
HTTP/1.1 303 See Other
Location: /orders/ord_123
```

Artinya:

```text
POST selesai, lihat hasilnya di URL lain menggunakan GET.
```

### 6.4 `304 Not Modified`

`304` bukan redirect ke URL lain. Ini status validasi cache.

Flow:

```http
GET /app.js HTTP/1.1
If-None-Match: "abc123"
```

Response:

```http
HTTP/1.1 304 Not Modified
ETag: "abc123"
```

Browser memakai cached body lama.

Frontend consequence:

- DevTools bisa menunjukkan 304;
- content body tidak dikirim ulang;
- sangat penting untuk cache performance;
- bisa membingungkan jika tidak paham cache validation.

### 6.5 `307 Temporary Redirect`

Redirect sementara yang mempertahankan method dan body.

Jika request awal POST, request redirect tetap POST.

Ini lebih aman secara semantic untuk API dibanding `302` jika method harus dipertahankan.

### 6.6 `308 Permanent Redirect`

Versi permanen dari `307`: method dan body dipertahankan.

Cocok untuk permanent redirect yang tidak boleh mengubah method.

---

## 7. 4xx: Client Error Responses

4xx berarti request tidak dapat dipenuhi karena sesuatu pada request/client/user/auth/state.

Jangan baca “client error” sebagai “frontend bug” selalu. Bisa berarti:

- user belum login;
- user tidak punya izin;
- input invalid;
- resource sudah tidak ada;
- state sudah berubah;
- request terlalu besar;
- rate limit;
- precondition gagal.

Namun dari perspektif server, request tidak bisa diproses sebagai successful outcome.

### 7.1 `400 Bad Request`

`400` berarti request malformed atau invalid secara umum.

Contoh:

- JSON invalid;
- required header hilang;
- query parameter format salah;
- body tidak sesuai struktur minimum;
- enum value tidak dikenal;
- malformed multipart.

Response:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "type": "https://api.example.com/problems/bad-request",
  "title": "Bad Request",
  "detail": "Request body is not valid JSON."
}
```

Frontend behavior:

- biasanya tidak retry otomatis;
- jika akibat bug client, log/report;
- jika akibat user input, tampilkan validasi;
- pisahkan parse error vs validation error jika bisa.

### 7.2 `401 Unauthorized`

Nama `Unauthorized` agak membingungkan. Dalam praktik HTTP, `401` berarti authentication dibutuhkan atau authentication gagal.

Gunakan saat:

- belum login;
- access token expired;
- session invalid;
- credential tidak valid.

Biasanya response menyertakan `WWW-Authenticate` untuk skema tertentu.

Frontend behavior:

```text
401 -> auth state machine
    -> coba refresh token jika policy mengizinkan
    -> kalau refresh gagal, logout / redirect login
```

Jangan campur `401` dan `403`.

```text
401 = who are you?
403 = I know who you are, but you cannot do this.
```

### 7.3 `403 Forbidden`

`403` berarti server memahami request dan user mungkin sudah authenticated, tetapi tidak boleh melakukan operasi itu.

Contoh:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "code": "MISSING_PERMISSION",
  "requiredPermission": "CASE_APPROVE"
}
```

Frontend behavior:

- jangan auto logout;
- tampilkan forbidden/permission error;
- sembunyikan/disable aksi bila permission model tersedia;
- log sebagai authorization failure, bukan auth expiration;
- bisa arahkan ke request access flow.

### 7.4 `404 Not Found`

`404` berarti target resource tidak ditemukan atau server tidak ingin mengungkap keberadaannya.

Contoh:

```http
GET /api/cases/case_999 HTTP/1.1
```

Response:

```http
HTTP/1.1 404 Not Found
```

Frontend behavior:

- detail page: tampilkan “not found”;
- list query kosong: jangan gunakan 404, gunakan 200 empty list;
- delete idempotency: bisa memperlakukan 404 sebagai already gone tergantung contract;
- security: kadang 404 dipakai untuk menyembunyikan resource forbidden.

Contoh distinction:

```text
GET /api/users/999 -> 404 jika user id 999 tidak ada.
GET /api/users?name=unknown -> 200 dengan items: []
```

### 7.5 `405 Method Not Allowed`

Method tidak didukung untuk resource tersebut.

Contoh:

```http
DELETE /api/reports/summary HTTP/1.1
```

Response:

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
```

Frontend behavior:

- ini biasanya integration bug;
- jangan retry;
- cek API contract;
- cek proxy/gateway route.

### 7.6 `408 Request Timeout`

Server timeout menunggu request dari client.

Jarang terlihat langsung di frontend aplikasi biasa, tetapi bisa muncul dari server/proxy.

Frontend behavior:

- retry mungkin aman untuk idempotent methods;
- hati-hati untuk non-idempotent mutation;
- tampilkan uncertainty jika request mungkin sudah sebagian diterima.

### 7.7 `409 Conflict`

`409` berarti request konflik dengan current state resource.

Sangat penting untuk aplikasi enterprise.

Contoh:

- optimistic locking version mismatch;
- case sudah closed tetapi user mencoba approve;
- username sudah dipakai;
- workflow transition tidak valid karena state berubah;
- duplicate business key.

Response:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "code": "CASE_STATE_CONFLICT",
  "message": "Case can no longer be approved because it is already closed.",
  "currentState": "CLOSED",
  "expectedState": "PENDING_APPROVAL"
}
```

Frontend behavior:

- jangan retry buta;
- refresh resource;
- tampilkan conflict resolution;
- minta user review state terbaru;
- untuk optimistic UI, rollback atau reconcile.

Mental model:

```text
409 bukan validation error biasa.
409 adalah tanda bahwa client bertindak berdasarkan model state yang sudah usang atau bertabrakan.
```

### 7.8 `410 Gone`

Resource dulu ada tetapi sekarang sudah tidak tersedia secara permanen.

Frontend behavior:

- cocok untuk deleted/deprecated resource;
- bisa tampilkan “resource removed” bukan “not found” generik;
- berguna untuk lifecycle/audit-heavy domain.

### 7.9 `412 Precondition Failed`

`412` dipakai saat conditional request gagal.

Contoh lost update prevention:

```http
PATCH /api/documents/doc_1 HTTP/1.1
If-Match: "version-7"
Content-Type: application/json

{"title": "New Title"}
```

Jika server punya ETag baru:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/json

{
  "code": "VERSION_MISMATCH",
  "currentETag": "version-8"
}
```

Frontend behavior:

- fetch latest version;
- tampilkan merge/conflict UI;
- jangan overwrite diam-diam;
- sangat penting untuk collaborative editing dan regulatory workflow.

Perbedaan `409` vs `412`:

```text
412 = precondition header gagal, misalnya If-Match.
409 = konflik state/domain secara umum.
```

### 7.10 `413 Content Too Large`

Request body terlalu besar.

Use case:

- file upload terlalu besar;
- JSON payload terlalu besar;
- batch operation kebesaran.

Frontend behavior:

- validasi ukuran sebelum upload;
- tampilkan limit;
- jangan retry payload yang sama;
- pertimbangkan chunked/resumable upload.

### 7.11 `415 Unsupported Media Type`

Server tidak mendukung `Content-Type` request.

Contoh:

```http
POST /api/import HTTP/1.1
Content-Type: text/plain
```

Server hanya menerima `application/json` atau `multipart/form-data`.

Frontend behavior:

- cek request construction;
- jangan set `Content-Type` manual untuk `FormData`; browser akan menambahkan boundary;
- integration bug biasanya.

### 7.12 `422 Unprocessable Content`

`422` sering dipakai untuk semantic validation error: payload valid secara syntax, tetapi tidak valid secara domain/input.

Contoh:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/json

{
  "code": "VALIDATION_FAILED",
  "fieldErrors": [
    {
      "field": "email",
      "code": "INVALID_EMAIL",
      "message": "Email format is invalid."
    },
    {
      "field": "birthDate",
      "code": "AGE_BELOW_MINIMUM",
      "message": "User must be at least 18 years old."
    }
  ]
}
```

Frontend behavior:

- map ke field-level errors;
- jangan tampilkan generic failure saja;
- jangan retry otomatis;
- preserve user input;
- fokuskan field pertama yang error;
- gunakan stable field path.

`400` vs `422`:

```text
400 = request generally invalid/malformed.
422 = request parsed, understood, but semantically invalid.
```

Banyak API tetap memakai `400` untuk semua validation error. Itu tidak selalu salah, tetapi `422` memberi sinyal lebih spesifik.

### 7.13 `429 Too Many Requests`

Rate limit.

Response ideal:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "code": "RATE_LIMITED",
  "message": "Too many requests. Try again later."
}
```

Frontend behavior:

- hormati `Retry-After` jika ada;
- hentikan aggressive retry;
- tampilkan cooldown;
- debounce user input;
- deduplicate request;
- untuk background polling, slow down;
- untuk global rate limit, tampilkan banner.

Anti-pattern:

```text
429 diterima -> client langsung retry -> 429 lagi -> retry storm
```

---

## 8. 5xx: Server Error Responses

5xx berarti server/gateway/upstream gagal memenuhi request yang secara umum valid.

Frontend harus memperlakukan 5xx sebagai:

```text
User mungkin tidak bisa memperbaiki langsung.
System/platform mungkin sedang bermasalah.
```

Namun retryability tetap bergantung pada method dan idempotency.

### 8.1 `500 Internal Server Error`

Generic server error.

Frontend behavior:

- tampilkan generic recoverable message;
- jangan tampilkan stack trace;
- log correlation ID;
- retry hanya jika operation aman;
- untuk mutation, tampilkan uncertainty jika status final tidak diketahui.

Server sebaiknya mengembalikan:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
X-Correlation-Id: req_abc123

{
  "code": "INTERNAL_ERROR",
  "message": "Something went wrong.",
  "correlationId": "req_abc123"
}
```

### 8.2 `502 Bad Gateway`

Gateway/proxy menerima invalid response dari upstream.

Contoh:

- upstream service crash;
- gateway tidak bisa parse response;
- TLS upstream issue;
- service mesh/proxy problem.

Frontend behavior:

- biasanya transient;
- retry GET dengan backoff mungkin aman;
- tampilkan temporary failure;
- observe if many endpoints affected.

### 8.3 `503 Service Unavailable`

Service sedang tidak tersedia.

Use case:

- maintenance;
- overload;
- dependency unavailable;
- circuit breaker open;
- deployment rolling issue.

Response ideal:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 120
```

Frontend behavior:

- hormati `Retry-After`;
- reduce polling;
- tampilkan maintenance/degraded state;
- fallback cached data jika aman;
- jangan spam retry.

### 8.4 `504 Gateway Timeout`

Gateway menunggu upstream terlalu lama.

Frontend interpretation:

```text
Request mungkin belum selesai di backend, atau backend selesai terlambat tapi gateway sudah menyerah.
```

Untuk mutation, ini sangat penting.

Contoh:

```text
User klik Submit Payment
  -> frontend menerima 504
```

Apakah payment gagal? Belum tentu.

Kemungkinan:

1. request tidak sampai ke service;
2. request sampai, payment diproses, response terlambat;
3. payment diproses sebagian;
4. gateway timeout tetapi job masih berjalan.

Frontend behavior untuk non-idempotent mutation:

- jangan langsung retry tanpa idempotency key;
- tampilkan “status uncertain”;
- cek status resource/order;
- gunakan idempotency key untuk retry aman;
- jangan membuat duplicate transaction.

---

## 9. Status Code yang Sering Disalahgunakan

### 9.1 `200 OK` untuk Semua Hal

Anti-pattern:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "error": "Unauthorized"
}
```

Dampak:

- monitoring tidak melihat error;
- frontend harus parse body sebelum tahu auth gagal;
- cache/proxy salah interpretasi;
- API gateway policy sulit;
- observability rusak;
- log analysis misleading.

Lebih baik:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "AUTH_REQUIRED",
  "message": "Please sign in."
}
```

### 9.2 `500` untuk Validation Error

Anti-pattern:

```http
HTTP/1.1 500 Internal Server Error

{"message": "Email is invalid"}
```

Dampak:

- alert palsu;
- SLO error rate naik;
- user tidak mendapat field error;
- backend terlihat rusak padahal input invalid.

Lebih baik:

```http
HTTP/1.1 422 Unprocessable Content
```

atau:

```http
HTTP/1.1 400 Bad Request
```

### 9.3 `401` untuk Semua Permission Problem

Jika user sudah login tetapi tidak punya akses, gunakan `403`, bukan `401`.

Kesalahan ini membuat frontend:

- mencoba refresh token terus;
- logout user secara salah;
- redirect login padahal masalahnya permission;
- menciptakan loop auth.

### 9.4 `404` untuk Empty Search Result

Search/list kosong bukan resource not found.

Anti-pattern:

```http
GET /api/products?keyword=zzzz
HTTP/1.1 404 Not Found
```

Lebih baik:

```http
HTTP/1.1 200 OK

{
  "items": [],
  "total": 0
}
```

### 9.5 `400` untuk Conflict

Jika user update data versi lama, `400` kurang informatif.

Lebih baik:

```http
HTTP/1.1 409 Conflict
```

atau jika memakai ETag/precondition:

```http
HTTP/1.1 412 Precondition Failed
```

### 9.6 Redirect HTML Login untuk API

Anti-pattern:

```text
GET /api/me
  -> 302 /login
  -> 200 text/html
```

Frontend `fetch()` bisa mencoba parse HTML sebagai JSON.

Lebih baik untuk API:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "AUTH_REQUIRED"
}
```

Untuk browser navigation page, redirect login masih bisa benar. Boundary-nya:

```text
Navigation endpoint boleh redirect ke page.
API endpoint sebaiknya mengembalikan API-shaped auth error.
```

---

## 10. `fetch()` dan Status Code

`fetch()` punya behavior yang sering menjebak.

### 10.1 404/500 Tidak Masuk `catch`

Contoh:

```ts
try {
  const response = await fetch('/api/users/999');
  console.log(response.status); // 404
} catch (error) {
  // Tidak masuk sini hanya karena 404.
}
```

`catch` biasanya untuk network/browser-level failure, bukan HTTP status error.

Wrapper yang benar biasanya:

```ts
async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw await toHttpError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
```

### 10.2 `response.ok`

`response.ok` bernilai true untuk status 200 sampai 299.

```ts
if (response.ok) {
  // 2xx
}
```

Tapi jangan hanya pakai `ok` jika perlu membedakan:

- `200` vs `201`;
- `202` async accepted;
- `204` no body;
- `206` partial content.

### 10.3 Body Error Bisa Berbeda-Beda

Server error bisa mengembalikan:

- JSON problem detail;
- HTML error page dari proxy;
- empty body;
- plain text;
- malformed JSON;
- CDN-branded response.

Robust parser:

```ts
async function parseErrorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (response.status === 204) {
    return undefined;
  }

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return { code: 'MALFORMED_JSON_ERROR_BODY' };
    }
  }

  try {
    const text = await response.text();
    return text ? { message: text } : undefined;
  } catch {
    return undefined;
  }
}
```

---

## 11. Designing a Frontend HTTP Error Model

Untuk aplikasi serius, jangan lempar raw `Response` ke seluruh UI.

Buat model error normalized.

Contoh TypeScript:

```ts
type HttpFailureKind =
  | 'network'
  | 'timeout'
  | 'abort'
  | 'http'
  | 'parse'
  | 'unknown';

type HttpError = {
  kind: 'http';
  status: number;
  statusText: string;
  code?: string;
  message?: string;
  correlationId?: string;
  retryAfter?: number;
  body?: unknown;
};

type NetworkError = {
  kind: 'network';
  message: string;
};

type TimeoutError = {
  kind: 'timeout';
  timeoutMs: number;
};

type AbortFailure = {
  kind: 'abort';
  reason?: unknown;
};

type ApiFailure = HttpError | NetworkError | TimeoutError | AbortFailure;
```

Lalu mapping:

```ts
function classifyHttpStatus(status: number) {
  if (status === 401) return 'auth_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 412) return 'precondition_failed';
  if (status === 422) return 'validation_failed';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'unknown';
}
```

UI tidak perlu tahu detail `fetch()` mentah. UI perlu tahu:

```text
Apa kategori masalahnya?
Apa yang user bisa lakukan?
Apakah retry masuk akal?
Apakah butuh login?
Apakah butuh refresh data?
Apakah field error tersedia?
```

---

## 12. Mapping Status Code ke UI Behavior

Matrix praktis:

| Status | Typical UI Behavior | Retry? | User Action |
|---:|---|---|---|
| 200 | Render data/result | Tidak perlu | Lanjut |
| 201 | Show created / navigate detail | Tidak | Lihat resource baru |
| 202 | Show processing / poll status | Poll, bukan retry submit | Tunggu / cancel |
| 204 | Remove item / mark done | Tidak | Lanjut |
| 304 | Browser cache handles | Tidak | Tidak terlihat langsung |
| 400 | Generic bad request / bug or input issue | Tidak | Perbaiki input jika relevan |
| 401 | Refresh session / login | Refresh token mungkin | Login ulang |
| 403 | Forbidden message | Tidak | Request access / stop |
| 404 | Not found / empty detail page | Tidak | Kembali/search |
| 409 | Conflict resolution | Tidak buta | Refresh/reconcile |
| 412 | Version conflict | Tidak buta | Fetch latest/merge |
| 413 | File/payload too large | Tidak | Kecilkan payload |
| 415 | Client integration bug | Tidak | Fix client/content-type |
| 422 | Field validation errors | Tidak | Perbaiki field |
| 429 | Rate limit UI/cooldown | Setelah Retry-After | Tunggu |
| 500 | Generic server error | Mungkin untuk safe request | Retry later |
| 502 | Temporary upstream issue | Mungkin dengan backoff | Retry later |
| 503 | Service unavailable | Setelah Retry-After | Tunggu |
| 504 | Timeout/uncertain | Hati-hati | Check status/retry safely |

---

## 13. Retry Semantics Berdasarkan Status Code dan Method

Retry tidak boleh hanya berdasarkan status code. Harus mempertimbangkan:

1. method;
2. idempotency;
3. apakah request sampai ke server;
4. apakah operasi punya idempotency key;
5. apakah user action bisa diduplikasi;
6. apakah server memberi `Retry-After`;
7. apakah response failure berasal dari gateway atau origin.

### 13.1 Generally Retryable

Untuk GET/HEAD safe requests:

- network error;
- 408;
- 429 dengan delay;
- 500 kadang;
- 502;
- 503;
- 504.

Dengan:

- exponential backoff;
- jitter;
- retry budget;
- cancellation saat route berubah;
- no infinite retry.

### 13.2 Dangerous to Retry Blindly

Untuk mutation:

- POST create order;
- payment;
- transfer;
- submit application;
- approve case;
- send email;
- create ticket.

Jika mendapat 500/502/503/504, operation outcome bisa uncertain.

Solusi:

- idempotency key;
- status resource;
- operation ID;
- deduplication;
- server-side idempotency store;
- UI “checking status” instead of “submit again blindly”.

Contoh request:

```http
POST /api/payments HTTP/1.1
Idempotency-Key: 9d6d8a0c-51aa-4e39-a771-2fd27cfe93a1
Content-Type: application/json

{
  "invoiceId": "inv_123",
  "amount": 100000
}
```

Jika timeout:

```text
Client retries with same Idempotency-Key.
Server returns same resulting payment or current operation state.
```

---

## 14. Status Code and Observability

Status code adalah dimensi observability utama.

Dashboard biasanya memecah:

```text
2xx success rate
4xx client error rate
5xx server error rate
latency by route/status
error budget burn
```

Jika API selalu mengembalikan `200`, observability hancur.

Contoh buruk:

```http
HTTP/1.1 200 OK

{"success": false, "error": "Database unavailable"}
```

Monitoring melihat success, padahal user gagal.

Contoh baik:

```http
HTTP/1.1 503 Service Unavailable
X-Correlation-Id: req_123

{
  "code": "DEPENDENCY_UNAVAILABLE",
  "correlationId": "req_123"
}
```

Frontend bisa:

- log status;
- attach correlation ID;
- report route/screen/action;
- differentiate user error vs platform error;
- avoid noisy alerts untuk validation errors;
- escalate 5xx.

### 14.1 Correlation ID

Response header:

```http
X-Correlation-Id: req_abc123
```

Body:

```json
{
  "code": "INTERNAL_ERROR",
  "message": "Something went wrong.",
  "correlationId": "req_abc123"
}
```

UI support message:

```text
Something went wrong. Reference: req_abc123
```

Ini sangat membantu support dan backend tracing.

---

## 15. Status Code and Caching

Status code mempengaruhi cacheability.

Contoh:

- `200` bisa cacheable tergantung headers;
- `301` bisa cached;
- `304` bagian dari validation;
- beberapa 404 bisa cached jika header mengizinkan;
- `500` umumnya jangan dicache kecuali sangat eksplisit dan hati-hati.

Bug:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600

{"success": false, "error": "User not found"}
```

Kalau error domain/resource dibungkus `200` dan cache public, CDN/browser bisa menyimpan error sebagai success representation.

Untuk personalized API:

```http
Cache-Control: private, no-store
```

atau strategi eksplisit sesuai kebutuhan.

---

## 16. Status Code and Security

Status code juga punya aspek security.

### 16.1 401 vs 403 vs 404 for Sensitive Resources

Kadang server mengembalikan `404` untuk resource yang ada tetapi user tidak boleh tahu keberadaannya.

Contoh:

```text
GET /api/cases/secret_case_id
```

Jika user unauthorized, server bisa memilih:

- `403`: user tahu resource ada tapi tidak boleh akses;
- `404`: server tidak mengungkap apakah resource ada.

Ini keputusan security/product.

Frontend harus mengikuti contract.

### 16.2 Error Message Leakage

Jangan expose internal error detail:

Buruk:

```json
{
  "message": "NullPointerException at CaseService.java:342, SQL table enforcement_case missing"
}
```

Baik:

```json
{
  "code": "INTERNAL_ERROR",
  "message": "Something went wrong.",
  "correlationId": "req_123"
}
```

Detail teknis masuk log server/tracing, bukan response user.

### 16.3 Rate Limit

`429` membantu mengendalikan abuse dan accidental client storm.

Frontend harus tidak melawan rate limit dengan retry agresif.

---

## 17. Error Envelope yang Baik

Status code saja tidak cukup untuk UI. Body error perlu structured.

Contoh general problem:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "message": "Some fields are invalid.",
  "correlationId": "req_abc123",
  "fieldErrors": [
    {
      "field": "customer.email",
      "code": "INVALID_EMAIL",
      "message": "Email format is invalid."
    }
  ]
}
```

Field yang berguna:

| Field | Fungsi |
|---|---|
| `type` | stable problem type URI/string |
| `title` | human-readable summary |
| `status` | duplicate HTTP status for clients/logs |
| `code` | machine-readable app code |
| `message` | user/developer-safe message |
| `correlationId` | support/tracing |
| `fieldErrors` | form mapping |
| `retryAfter` | rate limit/temporary failure |
| `details` | structured contextual info jika aman |

Prinsip:

```text
Status code memberi kategori HTTP.
Error code memberi kategori aplikasi.
Field errors memberi UI mapping.
Correlation ID memberi operability.
```

---

## 18. Frontend Branching Pattern yang Sehat

Contoh arsitektur client:

```ts
async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw { kind: 'abort', reason: error };
    }

    throw { kind: 'network', cause: error };
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const body = await parseErrorBody(response);
    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));

    throw {
      kind: 'http',
      status: response.status,
      statusText: response.statusText,
      category: classifyHttpStatus(response.status),
      retryAfter,
      correlationId: response.headers.get('X-Correlation-Id') ?? undefined,
      body,
    };
  }

  return response.json() as Promise<T>;
}
```

Then UI/domain layer:

```ts
try {
  await approveCase(caseId);
  showToast('Case approved.');
} catch (error) {
  if (isHttpError(error, 409)) {
    showConflictDialog(error.body);
    await refetchCase();
    return;
  }

  if (isHttpError(error, 401)) {
    authMachine.send({ type: 'AUTH_REQUIRED' });
    return;
  }

  if (isHttpError(error, 422)) {
    form.setErrors(toFieldErrors(error.body));
    return;
  }

  showGenericError(error);
}
```

Ini jauh lebih baik daripada:

```ts
catch (e) {
  alert('Error');
}
```

---

## 19. Case Study 1: Login Sukses tapi Frontend Tetap Anonymous

Symptom:

```text
POST /api/login -> 200 OK
GET /api/me -> 401 Unauthorized
```

Kemungkinan:

- cookie tidak disimpan;
- cookie `SameSite` salah;
- cookie `Secure` tidak cocok dengan HTTP local dev;
- `credentials: 'include'` tidak dipakai;
- CORS credential header kurang;
- domain/path cookie tidak match;
- login response sebenarnya domain failure tapi tetap 200;
- session store backend tidak menyimpan session.

Status code membantu:

- `POST /api/login` jika credential salah seharusnya `401`, bukan `200 success false`;
- `GET /api/me` `401` benar jika tidak authenticated;
- frontend auth state machine bisa transisi ke unauthenticated.

---

## 20. Case Study 2: Submit Form Menghasilkan `500`, padahal Input Salah

Symptom:

```text
POST /api/users -> 500 Internal Server Error
```

Body:

```json
{
  "message": "email must not be blank"
}
```

Masalah:

- validation exception tidak dimapping ke 400/422;
- backend observability melihat ini sebagai server failure;
- frontend tidak tahu field mana yang salah;
- SLO error rate tercemar user input.

Perbaikan:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/json

{
  "code": "VALIDATION_FAILED",
  "fieldErrors": [
    {
      "field": "email",
      "code": "REQUIRED",
      "message": "Email is required."
    }
  ]
}
```

Frontend:

```text
422 -> map ke form field -> user memperbaiki input
```

---

## 21. Case Study 3: Update Case Gagal karena State Berubah

Domain:

```text
User A membuka case PENDING_APPROVAL.
User B menutup case.
User A klik Approve.
```

Request:

```http
POST /api/cases/case_123/approve HTTP/1.1
```

Response buruk:

```http
HTTP/1.1 400 Bad Request

{"message":"Cannot approve case"}
```

Response lebih baik:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "code": "INVALID_STATE_TRANSITION",
  "message": "Case can no longer be approved because it is already closed.",
  "currentState": "CLOSED",
  "attemptedAction": "APPROVE"
}
```

Frontend behavior:

```text
409 -> stop optimistic success -> refresh case -> show conflict explanation
```

Ini penting untuk sistem regulatory, case management, workflow approval, dan audit-heavy domain.

---

## 22. Case Study 4: API Redirect ke Login Page

Symptom:

```ts
const response = await fetch('/api/cases');
const data = await response.json(); // SyntaxError: Unexpected token '<'
```

Network:

```text
GET /api/cases -> 302 /login -> 200 text/html
```

Masalah:

- backend/security framework menganggap API request sebagai browser navigation;
- expired session diarahkan ke HTML login;
- frontend mengharapkan JSON.

Perbaikan:

Untuk API:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "AUTH_REQUIRED"
}
```

Untuk page navigation:

```http
HTTP/1.1 302 Found
Location: /login
```

Boundary:

```text
API endpoint: machine-readable status/body.
Page endpoint: browser navigation behavior boleh redirect.
```

---

## 23. Case Study 5: 504 pada Payment Submit

Symptom:

```text
POST /api/payments -> 504 Gateway Timeout
```

User bertanya:

```text
Apakah pembayaran saya berhasil?
```

Jawaban teknis:

```text
Tidak bisa disimpulkan dari 504 saja.
```

Kemungkinan:

- request tidak sampai ke payment service;
- request sampai dan payment berhasil, tapi response timeout;
- payment masih processing;
- duplicate retry bisa membuat charge ganda jika tidak idempotent.

Desain yang benar:

```http
POST /api/payments
Idempotency-Key: <uuid>
```

Jika timeout, frontend:

```text
1. Jangan langsung submit ulang dengan key berbeda.
2. Check payment status menggunakan invoice/order id.
3. Jika retry, pakai idempotency key yang sama.
4. Tampilkan “Checking payment status...” bukan “Payment failed” langsung.
```

---

## 24. Practical Status Code Decision Matrix untuk API Design

### 24.1 Read Resource

| Scenario | Status |
|---|---:|
| Resource found | 200 |
| Resource not found | 404 |
| User not logged in | 401 |
| User forbidden | 403 atau 404 by policy |
| Backend dependency down | 503/502 |

### 24.2 Search/List

| Scenario | Status |
|---|---:|
| Query valid with results | 200 |
| Query valid empty results | 200 |
| Query parameter invalid | 400/422 |
| User not logged in | 401 |
| User forbidden | 403 |

### 24.3 Create Resource

| Scenario | Status |
|---|---:|
| Created | 201 |
| Accepted async | 202 |
| Validation failed | 400/422 |
| Duplicate business key | 409 |
| Payload too large | 413 |
| Unsupported media type | 415 |
| Rate limited | 429 |

### 24.4 Update Resource

| Scenario | Status |
|---|---:|
| Updated with body | 200 |
| Updated without body | 204 |
| Resource not found | 404 |
| Validation failed | 400/422 |
| State conflict | 409 |
| ETag/precondition mismatch | 412 |
| Forbidden | 403 |

### 24.5 Delete Resource

| Scenario | Status |
|---|---:|
| Deleted, no body | 204 |
| Deleted, returns state | 200 |
| Already gone | 204 or 404 depending contract |
| Cannot delete due state | 409 |
| Forbidden | 403 |

### 24.6 Long-Running Operation

| Scenario | Status |
|---|---:|
| Job accepted | 202 |
| Job status found | 200 |
| Job not found | 404 |
| Job failed domain-wise | 200 with status `FAILED`, or 4xx/5xx depending endpoint semantics |

---

## 25. Browser DevTools: Cara Membaca Status Code

Di DevTools Network, lihat:

1. **Status**
   - 200, 304, 404, 500, dll.

2. **Initiator**
   - script?
   - document?
   - parser?
   - preload?
   - service worker?

3. **Type**
   - fetch/xhr?
   - document?
   - script?
   - stylesheet?
   - image?

4. **Response Headers**
   - cache?
   - CORS?
   - content-type?
   - set-cookie?
   - location?

5. **Request Headers**
   - origin?
   - cookie?
   - authorization?
   - content-type?

6. **Preview/Response**
   - JSON?
   - HTML error page?
   - empty body?

7. **Timing**
   - request blocked?
   - waiting TTFB?
   - content download?

Important:

```text
Status code alone is evidence, not full diagnosis.
Always combine with method, URL, headers, body, initiator, timing, and browser console error.
```

---

## 26. Status Code Checklist untuk Frontend Engineer

Saat melihat response error, tanyakan:

1. Apakah ada HTTP response atau ini network/browser-policy failure?
2. Method apa yang dipakai?
3. Endpoint ini read atau mutation?
4. Status code class apa?
5. Apakah status code sesuai dengan failure layer?
6. Apakah response body machine-readable?
7. Apakah ada field error?
8. Apakah ada correlation ID?
9. Apakah ada `Retry-After`?
10. Apakah request aman di-retry?
11. Apakah user bisa memperbaiki masalah?
12. Apakah auth state harus berubah?
13. Apakah local cache harus invalidated?
14. Apakah data harus direfresh?
15. Apakah ini harus masuk monitoring sebagai 5xx?
16. Apakah status ini mungkin berasal dari CDN/proxy, bukan app server?
17. Apakah response sebenarnya HTML error page?
18. Apakah CORS membuat status tidak bisa dibaca JS?
19. Apakah service worker ikut campur?
20. Apakah status code contract sudah terdokumentasi?

---

## 27. Backend/API Review Checklist dari Perspektif Frontend

Saat review API design, minta status matrix eksplisit:

```text
Endpoint: POST /api/cases/{id}/approve

Success:
- 200 OK with updated case representation
- or 204 No Content if no body

Client/domain errors:
- 400 invalid request shape
- 401 unauthenticated
- 403 missing permission
- 404 case not found
- 409 invalid state transition
- 422 validation failed, if approval comment invalid
- 429 rate limited

Server/platform errors:
- 500 internal error
- 503 dependency unavailable
- 504 gateway timeout
```

Untuk setiap status, definisikan:

- response body schema;
- frontend action;
- retry policy;
- user message;
- observability severity;
- correlation ID availability;
- cache invalidation behavior;
- domain audit implication.

---

## 28. Top 1% Mental Model

Engineer biasa bertanya:

```text
Status code-nya apa?
```

Engineer bagus bertanya:

```text
Apa arti status code ini untuk UI?
```

Engineer top-tier bertanya:

```text
Layer mana yang menghasilkan outcome ini?
Apakah status code ini mewakili semantic yang benar?
Apa konsekuensinya untuk browser, cache, retry, auth, observability, dan user trust?
Apakah response ini membuat client bisa mengambil keputusan tanpa heuristik rapuh?
```

Status code bukan dekorasi. Ia adalah bagian dari distributed contract.

---

## 29. Latihan Praktis

### Latihan 1 — Classify Outcomes

Tentukan status code yang cocok:

1. User submit form dengan email invalid.
2. User belum login memanggil `/api/me`.
3. User login tetapi tidak punya permission approve case.
4. User membuka detail case yang sudah dihapus.
5. Search menghasilkan kosong.
6. Create order sukses dan menghasilkan ID baru.
7. Export report diterima tetapi masih diproses.
8. Update document gagal karena ETag mismatch.
9. User upload file 200 MB padahal limit 10 MB.
10. Gateway timeout saat payment submit.

Jawaban yang diharapkan:

1. `422` atau `400`
2. `401`
3. `403`
4. `404` atau `410`
5. `200`
6. `201`
7. `202`
8. `412`
9. `413`
10. `504`, dengan outcome mutation uncertain

### Latihan 2 — Design Error Contract

Buat error body untuk:

```text
POST /api/cases/{id}/approve
```

Skenario:

```text
Case sudah CLOSED, user mencoba APPROVE.
```

Minimal sertakan:

- HTTP status;
- code;
- message;
- currentState;
- attemptedAction;
- correlationId.

Contoh:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json
X-Correlation-Id: req_789

{
  "code": "INVALID_STATE_TRANSITION",
  "message": "Case can no longer be approved because it is already closed.",
  "currentState": "CLOSED",
  "attemptedAction": "APPROVE",
  "correlationId": "req_789"
}
```

### Latihan 3 — Refactor Bad API

Bad response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": false,
  "error": "Token expired"
}
```

Refactor:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "code": "TOKEN_EXPIRED",
  "message": "Your session has expired. Please sign in again."
}
```

Frontend action:

```text
Auth machine handles token refresh or redirects to login.
```

---

## 30. Common Production Smells

Waspadai pola berikut:

```text
All errors return 200.
```

```text
Validation errors return 500.
```

```text
Expired session redirects API calls to HTML login page.
```

```text
Frontend retries POST after 504 without idempotency.
```

```text
429 ignored by client polling loop.
```

```text
409 displayed as generic “Something went wrong”.
```

```text
204 response parsed as JSON.
```

```text
404 used for empty search results.
```

```text
403 causes frontend logout.
```

```text
500 response leaks stack trace.
```

```text
No correlation ID in error response.
```

```text
Proxy/CDN returns HTML error page but frontend assumes JSON.
```

---

## 31. Summary

Status code adalah semantic signal, bukan angka kosmetik.

Core invariants:

```text
2xx = HTTP-level success.
3xx = redirect/cache validation/control flow.
4xx = request/client/user/auth/state problem.
5xx = server/upstream/platform failure.
```

Tetapi detailnya penting:

```text
200 != 201 != 202 != 204
400 != 401 != 403 != 404 != 409 != 422 != 429
500 != 502 != 503 != 504
```

Untuk frontend, status code menentukan:

- apakah UI render data;
- apakah user harus login;
- apakah permission ditolak;
- apakah form field error ditampilkan;
- apakah konflik state perlu resolution;
- apakah retry aman;
- apakah operation outcome uncertain;
- apakah cache invalidated;
- apakah observability harus alert;
- apakah user mendapat message yang jujur.

Status code yang buruk membuat frontend menebak. Status code yang baik membuat frontend mengambil keputusan.

---

## 32. Koneksi ke Part Berikutnya

Bagian ini membangun cara membaca outcome HTTP.

Part berikutnya akan masuk ke:

```text
Part 006 — Headers Deep Dive: The Real Control Plane of HTTP
```

Kenapa setelah status code kita masuk ke headers?

Karena status code memberi outcome, tetapi headers memberi control plane:

- `Content-Type` memberi tahu cara membaca body;
- `Cache-Control` mengendalikan cache;
- `Set-Cookie` mengubah auth/session state;
- `Location` mengarahkan redirect;
- `WWW-Authenticate` memberi konteks auth;
- `Retry-After` mengatur retry;
- `ETag` mengatur validation/concurrency;
- `Access-Control-*` mengatur CORS;
- security headers mengatur browser policy.

Jika status code adalah “apa yang terjadi”, header sering menjelaskan “bagaimana client harus memperlakukan response itu”.

---

## 33. Status Seri

```text
Part 005 selesai.
Seri belum selesai.
Lanjut ke Part 006: Headers Deep Dive: The Real Control Plane of HTTP.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-004.md">⬅️ Part 004 — HTTP Methods: Semantics, Safety, Idempotency, and Frontend Consequences</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-006.md">Part 006 — Headers Deep Dive: The Real Control Plane of HTTP ➡️</a>
</div>
