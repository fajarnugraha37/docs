# learn-http-for-web-frontend-perspective-part-004.md

# Part 004 — HTTP Methods: Semantics, Safety, Idempotency, and Frontend Consequences

> Seri: `learn-http-for-web-frontend-perspective`  
> Audience utama: Java software engineer yang ingin memahami HTTP dari perspektif browser/frontend secara sangat dalam.  
> Status: Part 004 dari 035.  
> Prasyarat: Part 000–003, terutama model request/response/header/body.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas bahwa HTTP message terdiri dari:

```text
request line / status line
headers
body
```

Sekarang kita masuk ke salah satu bagian paling sering terlihat, tapi paling sering disalahpahami: **HTTP method**.

Banyak engineer menggunakan method sebagai “nama operasi CRUD”:

```text
GET    = read
POST   = create
PUT    = update
PATCH  = partial update
DELETE = delete
```

Itu cukup untuk pemula, tetapi tidak cukup untuk production-grade frontend/backend systems.

Cara berpikir yang lebih benar:

```text
HTTP method adalah semantic signal tentang intent request.
```

Method memberi tahu server, browser, cache, proxy, CDN, gateway, observability system, security layer, dan retry logic tentang **jenis tindakan** yang dimaksud oleh request.

Method bukan hanya routing convention. Method memengaruhi:

1. apakah request boleh dianggap aman;
2. apakah request boleh diulang;
3. apakah response boleh di-cache;
4. apakah browser akan melakukan CORS preflight;
5. apakah browser/form/proxy/CDN memperlakukan request secara khusus;
6. bagaimana UI seharusnya melakukan retry, disable button, optimistic update, rollback, atau conflict handling;
7. bagaimana backend mendesain idempotency, audit, locking, dan duplicate prevention.

Referensi utama modern untuk HTTP semantics adalah **RFC 9110**. RFC 9110 mendefinisikan method standar seperti `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `CONNECT`, `OPTIONS`, dan `TRACE`, termasuk sifat safety dan idempotency. Untuk `PATCH`, referensi historis utamanya adalah RFC 5789.

---

## 1. Mental Model Utama: Method Bukan Action Name, Method Adalah Contract

Misalkan frontend mengirim:

```http
POST /orders HTTP/1.1
Content-Type: application/json

{
  "sku": "A-001",
  "quantity": 2
}
```

Secara teknis ini hanya message. Tetapi secara semantic, `POST` memberi sinyal:

```text
Server, lakukan pemrosesan resource-specific terhadap payload ini.
```

Bandingkan dengan:

```http
PUT /orders/123 HTTP/1.1
Content-Type: application/json

{
  "id": "123",
  "sku": "A-001",
  "quantity": 2,
  "status": "DRAFT"
}
```

`PUT` memberi sinyal berbeda:

```text
Server, jadikan representasi target resource ini sesuai payload yang saya kirim.
```

Dan:

```http
PATCH /orders/123 HTTP/1.1
Content-Type: application/json-patch+json

[
  { "op": "replace", "path": "/quantity", "value": 3 }
]
```

`PATCH` memberi sinyal:

```text
Server, terapkan perubahan parsial terhadap resource target.
```

Ketiganya sama-sama bisa “mengubah data”, tetapi kontraknya berbeda.

Untuk frontend engineer, ini penting karena UI behavior berbeda:

| Situation | Method Design Consequence |
|---|---|
| User refresh setelah submit | Apakah operation bisa duplicate? |
| Network timeout setelah click Save | Apakah aman retry? |
| User double-click button | Apakah server menghasilkan dua order? |
| Browser/tab mengulang request | Apakah state rusak? |
| Optimistic UI gagal | Apakah rollback bisa dilakukan? |
| Response terlambat dari request lama | Apakah boleh overwrite state terbaru? |
| API gateway retry otomatis | Apakah operation idempotent? |

Method adalah salah satu bagian dari kontrak yang menentukan semua hal itu.

---

## 2. Tiga Properti Kunci: Safe, Idempotent, Cacheable

Untuk memahami HTTP method secara mature, kita harus menguasai tiga istilah:

```text
safe
idempotent
cacheable
```

Ketiganya sering dicampuradukkan.

### 2.1 Safe

Sebuah method disebut **safe** jika secara semantic dimaksudkan untuk operasi read-only: request tersebut tidak meminta perubahan state pada server.

Contoh safe methods:

```text
GET
HEAD
OPTIONS
TRACE
```

Dalam praktik web modern, yang paling relevan untuk frontend:

```text
GET
HEAD
OPTIONS
```

Safe bukan berarti request pasti tidak punya efek samping internal sama sekali.

Contoh `GET /products/123` mungkin tetap menyebabkan:

```text
access log bertambah
analytics counter bertambah
cache warmed
rate limit counter bertambah
metrics tercatat
```

Tetapi efek samping tersebut bukan bagian dari semantic intent user. User tidak meminta “ubah produk”. User meminta representasi produk.

Safe berarti:

```text
Client tidak seharusnya dianggap bertanggung jawab atas perubahan state bisnis hanya karena melakukan request itu.
```

### 2.2 Idempotent

Sebuah method disebut **idempotent** jika beberapa request identik memiliki efek intended server-side yang sama dengan satu request.

Dalam bentuk sederhana:

```text
f(x) = f(f(x)) = f(f(f(x)))
```

Untuk HTTP:

```text
DELETE /sessions/abc
DELETE /sessions/abc
DELETE /sessions/abc
```

Efek akhirnya sama:

```text
session abc tidak ada
```

Request kedua dan ketiga mungkin menghasilkan status berbeda, misalnya `404 Not Found` atau `204 No Content`, tetapi intended state akhirnya sama.

Idempotent bukan berarti response selalu sama.

Idempotent berarti **efek akhir terhadap target resource** sama.

Method yang secara HTTP standard dianggap idempotent:

```text
GET
HEAD
OPTIONS
TRACE
PUT
DELETE
```

`POST` tidak idempotent secara default.

`PATCH` tidak otomatis idempotent; tergantung patch document dan server semantics.

### 2.3 Cacheable

Sebuah method disebut cacheable jika response-nya boleh disimpan dan digunakan ulang oleh cache ketika memenuhi aturan caching.

Dalam praktik browser/frontend, yang paling penting:

```text
GET response adalah kandidat utama untuk cache.
HEAD juga berkaitan dengan cache metadata.
POST bisa cacheable secara spesifikasi dalam kondisi tertentu, tetapi jarang dipakai dan jarang didukung sebagai strategi umum.
```

Untuk aplikasi frontend normal:

```text
Anggap caching HTTP utama berlaku untuk GET.
```

Tetapi jangan ubah rule ini menjadi dogma terlalu dangkal. Secara protocol, cacheability ditentukan oleh kombinasi method, status code, dan header seperti `Cache-Control`, `ETag`, `Expires`, `Vary`, dan sebagainya.

Kita akan bahas caching sangat dalam di Part 014 dan Part 015.

---

## 3. Matrix Method: Safe, Idempotent, Cacheable

Tabel ringkas:

| Method | Safe | Idempotent | Commonly Cacheable | Body? | Umum di Frontend? |
|---|---:|---:|---:|---:|---:|
| `GET` | Yes | Yes | Yes | Tidak dianjurkan | Sangat umum |
| `HEAD` | Yes | Yes | Yes metadata | Tidak | Kadang |
| `POST` | No | No by default | Jarang | Ya | Sangat umum |
| `PUT` | No | Yes | Umumnya tidak | Ya | Umum untuk API |
| `PATCH` | No | Tergantung | Umumnya tidak | Ya | Umum untuk API |
| `DELETE` | No | Yes | Umumnya tidak | Biasanya tidak | Umum untuk API |
| `OPTIONS` | Yes | Yes | Tidak umum | Biasanya tidak | Umum secara implisit via CORS |
| `CONNECT` | No | No | No | Khusus | Tidak langsung |
| `TRACE` | Yes | Yes | No | Tidak | Hampir tidak dipakai, sering disabled |

Hal penting:

```text
Safe ⊂ Idempotent
```

Semua safe method idempotent, tetapi tidak semua idempotent method safe.

Contoh:

```text
GET    safe + idempotent
PUT    unsafe + idempotent
DELETE unsafe + idempotent
POST   unsafe + non-idempotent by default
```

---

## 4. `GET`: Retrieve Representation, Jangan Mengubah State Bisnis

### 4.1 Semantics

`GET` meminta current representation dari target resource.

Contoh:

```http
GET /api/products/123 HTTP/1.1
Accept: application/json
```

Maksudnya:

```text
Berikan representasi saat ini dari resource /api/products/123.
```

Bukan:

```text
Jalankan aksi arbitrary yang kebetulan dibungkus URL.
```

### 4.2 GET dan Query Parameter

Untuk filter, search, sort, pagination, projection:

```http
GET /api/orders?status=PENDING&page=1&size=20&sort=createdAt,desc
```

Ini normal karena query parameter adalah bagian dari URI target resource.

Mental model:

```text
/api/orders?status=PENDING
```

adalah resource view/collection representation yang berbeda dari:

```text
/api/orders?status=APPROVED
```

### 4.3 GET dengan Body

Secara practical frontend/browser, jangan desain API yang membutuhkan body pada `GET`.

Alasannya:

1. banyak tooling tidak mendukung dengan baik;
2. cache/proxy/gateway sering tidak menganggap body sebagai bagian dari cache key;
3. browser APIs dan platform behavior bisa berbeda;
4. developer lain akan salah paham;
5. observability dan debugging menjadi buruk.

Jika search/filter terlalu kompleks untuk query string, pilihan realistis:

#### Opsi A — Pakai POST untuk search command

```http
POST /api/orders/search HTTP/1.1
Content-Type: application/json

{
  "status": ["PENDING", "APPROVED"],
  "createdAfter": "2026-01-01",
  "includeArchived": false,
  "sort": [
    { "field": "createdAt", "direction": "DESC" }
  ]
}
```

Ini trade-off: lebih ergonomis untuk body kompleks, tetapi kehilangan semantic caching natural dari GET kecuali didesain khusus.

#### Opsi B — Buat saved query resource

```http
POST /api/order-searches
Content-Type: application/json

{
  "filters": { ... }
}
```

Server mengembalikan:

```http
201 Created
Location: /api/order-searches/q-123
```

Lalu frontend membaca:

```http
GET /api/order-searches/q-123/results
```

Ini cocok untuk query besar, report, export, atau long-running search.

### 4.4 GET Tidak Boleh Memicu State Mutation Bisnis

Anti-pattern:

```http
GET /api/orders/123/approve
GET /api/logout
GET /api/email/send?to=...
GET /api/invoices/991/pay
```

Masalahnya:

1. crawler bisa memicu aksi;
2. browser prefetch bisa memicu aksi;
3. link preview bisa memicu aksi;
4. cache bisa menyimpan response yang salah;
5. retry/proxy behavior bisa tidak sesuai;
6. CSRF risk meningkat;
7. observability menyesatkan;
8. user bisa melakukan aksi hanya dengan membuka link.

Corrective design:

```http
POST /api/orders/123/approval-requests
POST /api/logout
POST /api/emails
POST /api/invoices/991/payment-attempts
```

Atau untuk command eksplisit:

```http
POST /api/orders/123:approve
```

Format `:approve` bukan standar HTTP khusus, tetapi kadang dipakai untuk command-style endpoint. Gunakan dengan disiplin dan dokumentasi jelas.

### 4.5 Frontend Consequences

Untuk `GET`, frontend boleh lebih agresif melakukan:

```text
prefetch
revalidate
deduplicate
cache
retry
background refresh
stale-while-revalidate
```

Tetapi tetap perlu memperhatikan:

```text
authorization
personalized response
cache headers
query key stability
race conditions
```

Contoh query key:

```ts
const key = ["orders", { status: "PENDING", page: 1, size: 20 }];
```

Jika query key tidak stabil, frontend cache bisa salah.

---

## 5. `HEAD`: GET Tanpa Body

### 5.1 Semantics

`HEAD` meminta response metadata yang sama seperti `GET`, tetapi tanpa response body.

Contoh:

```http
HEAD /downloads/report-2026.pdf HTTP/1.1
```

Server bisa membalas:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 24830191
ETag: "abc123"
Last-Modified: Wed, 17 Jun 2026 10:00:00 GMT
```

Tanpa body PDF.

### 5.2 Kapan Berguna

`HEAD` berguna untuk:

1. mengecek resource exists;
2. mengambil `Content-Length` sebelum download;
3. validasi cache metadata;
4. mengecek `ETag` atau `Last-Modified`;
5. health-ish lightweight metadata check;
6. preflight custom application logic, bukan CORS preflight.

Contoh UI:

```text
User akan download file besar.
Frontend ingin menampilkan ukuran file sebelum mulai download.
```

```http
HEAD /api/files/987/content
```

Lalu UI:

```text
Download report.pdf (23.7 MB)
```

### 5.3 Pitfall

Banyak server/framework tidak mengimplementasikan `HEAD` secara benar.

Kadang:

1. route `GET` ada, `HEAD` 404;
2. `HEAD` mengembalikan header berbeda dari `GET`;
3. server tetap generate body internal lalu membuangnya;
4. middleware auth/cors berbeda;
5. CDN memperlakukan berbeda.

Jadi `HEAD` bagus, tetapi harus diuji end-to-end.

---

## 6. `POST`: Resource-Specific Processing

### 6.1 Semantics

`POST` adalah method paling fleksibel. Ia meminta server melakukan pemrosesan terhadap request content sesuai aturan resource target.

Contoh create:

```http
POST /api/orders HTTP/1.1
Content-Type: application/json

{
  "sku": "A-001",
  "quantity": 2
}
```

Tetapi `POST` tidak hanya create.

Ia juga umum untuk:

```text
submit form
login
logout
search dengan body kompleks
start long-running job
send email
execute command
upload file
calculate quote
create payment attempt
refresh token
batch operation
```

### 6.2 POST Tidak Idempotent by Default

Ini sangat penting.

Jika frontend mengirim dua request identik:

```http
POST /api/orders
POST /api/orders
```

Server bisa membuat dua order berbeda.

Itu bukan bug menurut semantics `POST`.

Maka frontend harus hati-hati terhadap:

```text
double click
retry otomatis
user refresh
browser back/forward
mobile network retry
slow response
race condition
```

### 6.3 POST dan Duplicate Submit

Scenario:

```text
User klik “Place Order”.
Network lambat.
Button masih enabled.
User klik lagi.
```

Tanpa protection:

```text
2 POST requests
2 order rows
2 payment attempts
2 emails
```

Frontend mitigation:

```text
disable submit button while pending
show loading state
dedupe in-flight mutation
abort impossible duplicate path if needed
```

Backend mitigation:

```text
idempotency key
unique business constraint
transactional outbox
payment provider idempotency
operation state machine
```

Frontend-only mitigation tidak cukup untuk critical operation.

### 6.4 Idempotency-Key Pattern

Untuk operation seperti payment/order creation, gunakan idempotency key.

```http
POST /api/orders HTTP/1.1
Content-Type: application/json
Idempotency-Key: 01J0VY3MM9D7KZ6G3CD9YH1T4J

{
  "sku": "A-001",
  "quantity": 2
}
```

Server menyimpan:

```text
idempotency_key
request fingerprint
operation result
expiration
status
```

Jika request yang sama dikirim ulang:

```text
server tidak membuat order kedua
server mengembalikan result yang sama / compatible
```

Untuk Java backend, idempotency key biasanya butuh:

```text
unique index on key + actor/context
request hash validation
transaction boundary jelas
locking atau insert-if-absent
stored response / resource reference
expiration policy
audit trail
```

### 6.5 POST untuk Search: Kapan Masuk Akal

`GET /search?...` baik untuk search sederhana.

Tetapi `POST /search` bisa masuk akal ketika:

1. filter sangat kompleks;
2. query terlalu panjang untuk URL;
3. search request mengandung struktur nested;
4. search adalah command yang menghasilkan job/report;
5. search tidak perlu HTTP cache semantics;
6. request body perlu divalidasi sebagai object kompleks.

Contoh:

```http
POST /api/cases/search
Content-Type: application/json

{
  "caseTypes": ["ENFORCEMENT", "INVESTIGATION"],
  "riskScore": { "gte": 80 },
  "assignedUnits": ["AML", "MARKET_ABUSE"],
  "include": ["latestAction", "primarySubject", "sla"]
}
```

Tetapi jangan menyebut semua operation “POST” hanya karena malas mendesain resource.

---

## 7. `PUT`: Replace Target Resource Representation

### 7.1 Semantics

`PUT` meminta server mengganti current representation dari target resource dengan representation yang dikirim client.

Contoh:

```http
PUT /api/users/42/profile HTTP/1.1
Content-Type: application/json

{
  "displayName": "Ayu",
  "bio": "Regulatory systems engineer",
  "timezone": "Asia/Jakarta"
}
```

Mental model:

```text
Set resource ini menjadi seperti payload ini.
```

### 7.2 PUT Idempotent

Jika request yang sama dikirim berkali-kali:

```http
PUT /api/users/42/profile
{ "displayName": "Ayu", "bio": "...", "timezone": "Asia/Jakarta" }
```

Efek akhir sama:

```text
profile user 42 memiliki field sesuai payload
```

Karena itu `PUT` lebih retry-friendly daripada `POST`.

### 7.3 PUT Bukan “Partial Update” Secara Default

Anti-pattern umum:

```http
PUT /api/users/42/profile
Content-Type: application/json

{
  "displayName": "Ayu"
}
```

Lalu server hanya update `displayName` dan membiarkan field lain.

Ini lebih mirip `PATCH`, bukan `PUT`.

Mengapa berbahaya?

Client A mengirim:

```json
{
  "displayName": "Ayu"
}
```

Client B mengira `PUT` berarti full replacement dan mengirim object hasil cache lama:

```json
{
  "displayName": "Ayu",
  "bio": null,
  "timezone": null
}
```

Hasilnya bisa data loss.

Jika API memilih `PUT` sebagai partial update karena konvensi internal lama, dokumentasikan jelas. Tapi untuk desain baru, lebih baik:

```text
PUT   = replace complete representation
PATCH = partial modification
```

### 7.4 PUT untuk Client-Chosen ID

`PUT` juga cocok ketika client menentukan URI resource.

Contoh:

```http
PUT /api/user-preferences/42/dashboard-layout
Content-Type: application/json

{
  "widgets": ["risk", "alerts", "tasks"]
}
```

Resource target sudah jelas:

```text
preference dashboard-layout milik user 42
```

Jika belum ada, server bisa membuatnya. Jika sudah ada, server menggantinya.

Ini disebut **upsert-like behavior**, tetapi harus didokumentasikan.

### 7.5 Frontend Consequences

`PUT` cocok untuk:

```text
save settings
replace profile
save draft complete representation
update document snapshot
replace preference object
```

Frontend bisa lebih percaya diri untuk retry jika:

1. request payload sama;
2. backend benar-benar idempotent;
3. tidak ada side effect non-idempotent seperti “send email on every PUT”;
4. concurrency dikontrol dengan version/ETag bila perlu.

---

## 8. `PATCH`: Partial Modification

### 8.1 Semantics

`PATCH` digunakan untuk menerapkan perubahan parsial ke resource.

Contoh simple merge patch style:

```http
PATCH /api/users/42/profile HTTP/1.1
Content-Type: application/merge-patch+json

{
  "displayName": "Ayu"
}
```

Artinya:

```text
Ubah displayName saja.
```

Contoh JSON Patch:

```http
PATCH /api/users/42/profile HTTP/1.1
Content-Type: application/json-patch+json

[
  { "op": "replace", "path": "/displayName", "value": "Ayu" }
]
```

### 8.2 PATCH Tidak Otomatis Idempotent

Ini bagian yang sering salah.

Patch ini idempotent:

```json
{
  "displayName": "Ayu"
}
```

Jika diterapkan berkali-kali, hasil akhir sama.

Tetapi patch ini tidak idempotent:

```json
{
  "incrementLoginCountBy": 1
}
```

Jika diterapkan tiga kali, nilai berubah tiga kali.

JSON Patch operation seperti `add` ke array juga bisa tidak idempotent tergantung path dan state.

Jadi jangan bilang:

```text
PATCH selalu idempotent.
```

Yang benar:

```text
PATCH bisa dibuat idempotent jika patch semantics dirancang idempotent.
```

### 8.3 PATCH Cocok untuk UI yang Mengubah Sebagian Field

Contoh form profile:

```text
User hanya mengubah timezone.
```

Request:

```http
PATCH /api/users/42/profile
Content-Type: application/merge-patch+json

{
  "timezone": "Asia/Jakarta"
}
```

Keuntungan:

1. payload kecil;
2. tidak butuh full object terbaru;
3. mengurangi lost update pada field lain;
4. cocok untuk inline edit;
5. cocok untuk partial autosave.

### 8.4 PATCH dan Concurrency

PATCH tidak otomatis menyelesaikan lost update.

Contoh:

```text
Client A membaca case version 7.
Client B membaca case version 7.
A PATCH priority = HIGH.
B PATCH priority = LOW.
```

Tanpa concurrency control, last writer wins.

Untuk domain penting, gunakan:

```http
PATCH /api/cases/123 HTTP/1.1
If-Match: "v7"
Content-Type: application/merge-patch+json

{
  "priority": "HIGH"
}
```

Jika server state sudah berubah ke version 8:

```http
HTTP/1.1 412 Precondition Failed
```

Atau:

```http
HTTP/1.1 409 Conflict
```

Tergantung desain.

### 8.5 JSON Merge Patch vs JSON Patch

#### JSON Merge Patch

Payload mirip partial object:

```json
{
  "name": "New Name",
  "description": null
}
```

Biasanya `null` bisa berarti remove field. Ini harus sangat jelas karena banyak domain memakai `null` sebagai value valid.

Kelebihan:

```text
simple
mudah dibaca
cocok untuk form
```

Kekurangan:

```text
ambigu untuk null
kurang ekspresif untuk array
sulit untuk operation conditional
```

#### JSON Patch

Payload berupa list operation:

```json
[
  { "op": "replace", "path": "/name", "value": "New Name" },
  { "op": "remove", "path": "/description" }
]
```

Kelebihan:

```text
ekspresif
bisa add/remove/replace/test
lebih eksplisit
```

Kekurangan:

```text
lebih kompleks
path fragile
lebih sulit divalidasi untuk domain business
```

Untuk product API biasa, banyak tim memilih custom partial JSON:

```http
PATCH /api/cases/123
Content-Type: application/json

{
  "priority": "HIGH"
}
```

Ini praktis, tetapi dokumentasikan semantics dengan jelas.

---

## 9. `DELETE`: Remove Target Resource Representation

### 9.1 Semantics

`DELETE` meminta server menghapus association/resource representation pada target URI.

Contoh:

```http
DELETE /api/notifications/789 HTTP/1.1
```

Maksudnya:

```text
Hapus notification 789.
```

### 9.2 DELETE Idempotent, Tetapi Response Bisa Berbeda

Request pertama:

```http
DELETE /api/notifications/789
```

Response:

```http
204 No Content
```

Request kedua:

```http
DELETE /api/notifications/789
```

Response bisa:

```http
404 Not Found
```

atau:

```http
204 No Content
```

Keduanya bisa dipertahankan sebagai desain, selama semantic state akhirnya sama:

```text
notification 789 tidak ada
```

Untuk frontend UX, `204` repeated delete sering lebih ergonomis jika delete dianggap “ensure absent”.

Tetapi `404` juga bisa berguna jika domain perlu memberitahu resource sudah tidak tersedia.

### 9.3 DELETE Body

Hindari membutuhkan body pada `DELETE` untuk API publik/frontend, kecuali sangat terkontrol.

Contoh yang kurang ideal:

```http
DELETE /api/orders/123
Content-Type: application/json

{
  "reason": "duplicate"
}
```

Masalah:

1. tool/proxy/framework support tidak selalu konsisten;
2. semantics kurang jelas;
3. observability sering mengabaikan body;
4. beberapa client tidak nyaman.

Alternatif:

```http
POST /api/orders/123/cancellation-requests
Content-Type: application/json

{
  "reason": "duplicate"
}
```

atau:

```http
DELETE /api/orders/123?reason=duplicate
```

Untuk reason kompleks/audit penting, command resource biasanya lebih baik.

### 9.4 Soft Delete vs Hard Delete

Dari perspektif HTTP, `DELETE` tidak harus berarti row fisik hilang dari database.

Bisa berarti:

```text
resource tidak lagi tersedia melalui URI normal
state berubah menjadi DELETED
record disembunyikan
association dihapus
audit tetap disimpan
```

Frontend tidak perlu tahu detail storage, tetapi perlu tahu outcome contract:

```text
Setelah DELETE sukses, apakah GET resource mengembalikan 404, 410, atau object dengan status DELETED?
```

Desain ini harus konsisten.

### 9.5 UI Consequences

DELETE sering dipakai untuk:

```text
remove item from list
archive notification
delete draft
remove attachment
revoke token
```

Frontend pattern:

```text
optimistic remove dari list
show undo jika domain mendukung
rollback jika gagal
handle 404 as already gone jika sesuai
invalidate related queries
```

Untuk destructive action, butuh:

```text
confirmation
permission check
clear error messaging
audit trail
possibly soft-delete/undo
```

---

## 10. `OPTIONS`: Capability Discovery dan CORS Preflight

### 10.1 Semantics

`OPTIONS` meminta informasi tentang communication options untuk target resource/server.

Contoh:

```http
OPTIONS /api/orders/123 HTTP/1.1
```

Server bisa membalas:

```http
HTTP/1.1 204 No Content
Allow: GET, PUT, PATCH, DELETE, OPTIONS
```

### 10.2 OPTIONS di Frontend: Biasanya Muncul karena CORS

Frontend jarang menulis:

```ts
fetch(url, { method: "OPTIONS" })
```

Tetapi browser sering mengirim `OPTIONS` otomatis sebagai **CORS preflight**.

Contoh frontend:

```ts
await fetch("https://api.example.com/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer token"
  },
  body: JSON.stringify({ sku: "A-001" })
});
```

Browser mungkin mengirim dulu:

```http
OPTIONS /orders HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type
```

Jika server menjawab dengan CORS headers yang benar, browser lanjut mengirim `POST` actual request.

Jika gagal, JavaScript melihat CORS error dan actual request bisa tidak pernah dikirim.

Detail CORS akan dibahas di Part 010–011, tetapi sekarang perlu dipahami:

```text
OPTIONS preflight bukan request bisnis dari app Anda.
Itu request browser policy negotiation.
```

### 10.3 Common Backend Bug

Backend security middleware sering mengharuskan auth untuk semua endpoint, termasuk `OPTIONS`.

Akibatnya:

```text
preflight request tidak membawa Authorization seperti actual request
server return 401
browser block actual request
frontend melihat CORS error
backend engineer bilang “token tidak dikirim”
```

Fix biasanya:

```text
CORS handling harus terjadi sebelum auth enforcement untuk preflight
OPTIONS preflight harus mendapat response yang sesuai
```

---

## 11. `CONNECT`: Tunnel, Bukan API Application Method

`CONNECT` digunakan untuk membuat tunnel ke server, terutama untuk HTTPS melalui proxy.

Contoh konseptual:

```http
CONNECT example.com:443 HTTP/1.1
Host: example.com:443
```

Frontend application engineer biasanya tidak langsung memakai `CONNECT`.

Browser/network stack/proxy yang mengurusnya.

Yang perlu diketahui:

```text
CONNECT berada di layer transport/proxy behavior, bukan REST API design.
```

Jika Anda melihat `CONNECT` di proxy log, jangan perlakukan seperti endpoint aplikasi.

---

## 12. `TRACE`: Diagnostic Method yang Hampir Selalu Disabled

`TRACE` meminta server mengembalikan request yang diterimanya untuk diagnostic loopback.

Di web modern, `TRACE` sering disabled karena security concerns seperti Cross-Site Tracing historis.

Frontend application engineer hampir tidak pernah membutuhkan `TRACE`.

Jika Anda mendesain API, biasanya:

```text
jangan enable TRACE kecuali ada alasan operasional yang sangat jelas
```

---

## 13. Method Override: Ketika Infrastruktur Tidak Mendukung Method Tertentu

Kadang client/proxy/form lama hanya mendukung `GET` dan `POST`. Maka muncul pattern:

```http
POST /api/orders/123
X-HTTP-Method-Override: PATCH
```

Atau form field:

```html
<form method="post" action="/orders/123">
  <input type="hidden" name="_method" value="DELETE">
</form>
```

### 13.1 Kapan Bisa Diterima

Method override bisa diterima untuk:

```text
legacy HTML form
old client compatibility
internal migration bridge
```

### 13.2 Risiko

Risiko:

1. security middleware membaca method asli, app membaca override;
2. audit log mencatat `POST`, domain event menganggap `DELETE`;
3. CDN/gateway policy tidak sinkron;
4. CORS/preflight behavior tidak sesuai ekspektasi;
5. observability membingungkan;
6. cache behavior salah.

Rule praktis:

```text
Gunakan real HTTP method jika platform mendukung.
Gunakan method override hanya sebagai compatibility shim yang terdokumentasi.
```

---

## 14. Method dan CORS Preflight

Method memengaruhi apakah request dianggap simple atau perlu preflight.

Secara ringkas, browser dapat mengirim CORS request tanpa preflight hanya dalam kondisi tertentu. Untuk method, simple methods adalah:

```text
GET
HEAD
POST
```

Tetapi `POST` pun hanya simple jika header dan content type memenuhi batasan tertentu.

Method berikut hampir pasti membuat preflight pada cross-origin browser request:

```text
PUT
PATCH
DELETE
```

Artinya:

```ts
await fetch("https://api.example.com/users/42", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ displayName: "Ayu" })
});
```

Dalam cross-origin context, browser akan melakukan preflight.

Frontend consequence:

1. ada extra round-trip;
2. latency bertambah;
3. backend harus support `OPTIONS`;
4. failure sering tampak sebagai CORS error;
5. monitoring harus memisahkan preflight dari actual request;
6. CDN/gateway harus meng-handle CORS headers konsisten.

Jangan mengganti semua `PATCH`/`DELETE` menjadi `POST` hanya untuk menghindari preflight tanpa alasan kuat. Tetapi pahami trade-off-nya.

---

## 15. Method dan Browser HTML Forms

HTML form native hanya mendukung:

```text
GET
POST
```

Contoh:

```html
<form method="get" action="/search">
  <input name="q" />
</form>
```

Menghasilkan navigation:

```http
GET /search?q=... HTTP/1.1
```

Contoh:

```html
<form method="post" action="/orders">
  ...
</form>
```

Menghasilkan:

```http
POST /orders HTTP/1.1
Content-Type: application/x-www-form-urlencoded
```

atau multipart untuk file.

Karena native form tidak mendukung `PUT`, `PATCH`, `DELETE`, framework sering memakai method override.

Untuk SPA, kita biasanya memakai `fetch`/HTTP client sehingga bisa memakai method lain.

Tetapi progressive enhancement, server-rendered apps, dan fallback flows tetap perlu memahami form method limitation.

---

## 16. Method dan Redirect Behavior

Method juga berinteraksi dengan redirect.

Contoh:

```http
POST /login HTTP/1.1
```

Server membalas:

```http
303 See Other
Location: /dashboard
```

Browser akan melakukan:

```http
GET /dashboard HTTP/1.1
```

Ini cocok untuk post-redirect-get pattern.

Tetapi redirect lain punya behavior historis/berbeda:

| Redirect | Typical Method Behavior |
|---|---|
| `301` | Historically may rewrite POST to GET in browsers |
| `302` | Historically may rewrite POST to GET in browsers |
| `303` | Explicitly use GET for follow-up retrieval |
| `307` | Preserve method and body |
| `308` | Preserve method and body |

Detail akan dibahas di Part 016, tetapi sejak sekarang pegang prinsip:

```text
Redirect bukan hanya “pindah URL”. Redirect bisa mengubah atau mempertahankan method tergantung status code.
```

Frontend bug umum:

```text
POST /api/orders mendapat 302 ke /login HTML page.
fetch mengikuti redirect.
frontend mencoba parse HTML sebagai JSON.
error: Unexpected token '<'
```

Root cause bukan JSON parser, tetapi auth redirect tidak cocok untuk API client.

---

## 17. Method dan Cache

Caching paling natural untuk:

```text
GET
HEAD
```

Jika API memakai `GET` dengan benar, browser/CDN/client cache bisa membantu.

Contoh:

```http
GET /assets/app.8f3a9c.js
Cache-Control: public, max-age=31536000, immutable
```

Cocok.

Contoh:

```http
GET /api/me
Cache-Control: private, no-cache
```

Bisa disimpan private tetapi harus revalidate.

Contoh berbahaya:

```http
GET /api/me
Cache-Control: public, max-age=3600
```

Jika melewati shared cache, bisa membocorkan personalized response.

Method salah juga merusak caching.

Jika semua reads dibuat `POST`:

```http
POST /api/products/search
```

Maka HTTP cache standar tidak bekerja natural.

Anda mungkin masih memakai application cache seperti TanStack Query/SWR, tetapi kehilangan bantuan browser/CDN semantics.

---

## 18. Method dan Retry Policy

Frontend reliability harus method-aware.

### 18.1 Safe Retry Candidates

Biasanya aman retry:

```text
GET
HEAD
OPTIONS
```

Dengan catatan:

```text
rate limit
server load
user cancellation
freshness requirement
```

### 18.2 Idempotent Mutation Retry Candidates

Bisa retry dengan lebih aman:

```text
PUT
DELETE
```

Jika backend benar-benar menjaga idempotency.

### 18.3 Dangerous Retry

Hati-hati retry otomatis:

```text
POST
PATCH non-idempotent
```

Untuk `POST`, retry hanya jika:

```text
ada idempotency key
operation naturally deduped
backend contract explicitly retry-safe
```

### 18.4 Timeout Ambiguity

Timeout adalah kasus paling berbahaya.

Frontend mengirim:

```http
POST /api/payments
```

Lalu timeout.

Apa yang terjadi?

Kemungkinan:

```text
request tidak pernah sampai server
request sampai server tapi gagal sebelum commit
request commit sukses tapi response hilang
request commit sukses dan side effect berjalan
```

Frontend tidak tahu.

Maka untuk critical POST:

```text
jangan hanya retry blind
pakai idempotency key atau status check resource
```

Example:

```http
POST /api/payment-attempts
Idempotency-Key: k-123
```

Jika timeout, frontend bisa retry dengan key sama atau query:

```http
GET /api/payment-attempts/by-idempotency-key/k-123
```

Desain terakhir tergantung security dan API policy.

---

## 19. Method dan UI State Machine

HTTP method harus memengaruhi UI state machine.

### 19.1 GET State Machine

```text
idle
  -> loading
  -> success
  -> refreshing
  -> stale
  -> error
  -> retrying
```

GET biasanya bisa:

```text
background refetch
dedupe
cache
retry
cancel stale request
```

### 19.2 POST Create State Machine

```text
idle
  -> submitting
  -> submitted/success
  -> uncertain_timeout
  -> failed_retryable
  -> failed_final
```

Perhatikan state `uncertain_timeout`.

Untuk POST create/payment, timeout bukan sekadar failed. Timeout bisa berarti “unknown outcome”.

### 19.3 PUT Save State Machine

```text
dirty
  -> saving
  -> saved
  -> conflict
  -> failed
```

Karena `PUT` idempotent, retry bisa lebih aman, tetapi conflict tetap mungkin.

### 19.4 PATCH Inline Edit State Machine

```text
clean
  -> editing
  -> optimistic_applied
  -> saving_patch
  -> saved
  -> conflict_or_validation_error
  -> rollback_or_merge
```

PATCH sering butuh rollback granular.

### 19.5 DELETE State Machine

```text
visible
  -> optimistic_removed
  -> deleting
  -> deleted
  -> delete_failed_restore
```

DELETE sering cocok dengan optimistic UI, tetapi hanya jika failure jarang dan rollback jelas.

---

## 20. Method dan Domain Semantics: CRUD Tidak Selalu Cukup

CRUD mapping sering terlalu sederhana.

Misalnya domain regulatory/enforcement lifecycle:

```text
case
investigation
assignment
escalation
approval
notice
sanction
appeal
closure
```

Action seperti:

```text
approve
reject
escalate
assign
submit
withdraw
reopen
close
publish
acknowledge
```

Tidak selalu cocok dipaksa menjadi update field biasa.

### 20.1 Bad Design: Action Disamarkan Sebagai PATCH Field

```http
PATCH /api/cases/123
Content-Type: application/json

{
  "status": "APPROVED"
}
```

Ini terlihat simple, tetapi mungkin melewati domain invariant:

```text
apakah user punya authority?
apakah required evidence lengkap?
apakah SLA checkpoint terpenuhi?
apakah approval harus membuat audit event?
apakah downstream notice harus dikirim?
apakah transition valid dari status saat ini?
```

### 20.2 Better: Command Resource

```http
POST /api/cases/123/approval-requests
Content-Type: application/json

{
  "comment": "Evidence complete",
  "decision": "APPROVE"
}
```

Atau:

```http
POST /api/cases/123:approve
Content-Type: application/json

{
  "comment": "Evidence complete"
}
```

POST cocok karena ini bukan sekadar replace representation. Ini command dengan domain processing.

### 20.3 Resource-Oriented Alternative

Jika approval itu entity:

```http
POST /api/cases/123/approvals
Content-Type: application/json

{
  "decision": "APPROVED",
  "comment": "Evidence complete"
}
```

Response:

```http
201 Created
Location: /api/cases/123/approvals/a-789
```

Ini lebih audit-friendly.

### 20.4 Rule of Thumb

Gunakan:

```text
PUT/PATCH untuk mengubah representasi resource.
POST untuk command/domain processing yang punya invariant, side effect, workflow transition, atau result resource baru.
```

---

## 21. Method Selection Framework

Gunakan decision tree berikut.

### 21.1 Apakah operation hanya membaca data?

Jika ya:

```text
GET
```

Jika hanya butuh metadata:

```text
HEAD
```

### 21.2 Apakah client membuat resource baru di collection dan server memilih ID?

Biasanya:

```text
POST /resources
```

Contoh:

```http
POST /api/orders
```

Response:

```http
201 Created
Location: /api/orders/123
```

### 21.3 Apakah client menentukan resource URI dan mengirim full representation?

Biasanya:

```text
PUT /resources/{id}
```

Contoh:

```http
PUT /api/preferences/user-42/dashboard
```

### 21.4 Apakah client mengubah sebagian field/resource?

Biasanya:

```text
PATCH /resources/{id}
```

### 21.5 Apakah client ingin resource tidak ada lagi?

Biasanya:

```text
DELETE /resources/{id}
```

### 21.6 Apakah operation adalah command/workflow transition?

Biasanya:

```text
POST /resources/{id}/commands
POST /resources/{id}:command
POST /command-resources
```

Contoh:

```http
POST /api/cases/123/escalations
POST /api/cases/123:reopen
POST /api/payment-attempts
```

### 21.7 Apakah operation long-running?

Biasanya:

```http
POST /api/reports
Content-Type: application/json

{ ... }
```

Response:

```http
202 Accepted
Location: /api/reports/jobs/j-123
```

Lalu:

```http
GET /api/reports/jobs/j-123
```

### 21.8 Apakah operation retry-sensitive?

Jika ya, tanya:

```text
Apakah method idempotent?
Apakah request punya idempotency key?
Apakah backend menyimpan operation result?
Apakah timeout outcome bisa diverifikasi?
```

---

## 22. Practical API Examples

### 22.1 Product List

```http
GET /api/products?category=books&page=1&size=20
```

Good karena read-only dan cacheable jika header mendukung.

### 22.2 Product Detail

```http
GET /api/products/p-123
```

Good.

### 22.3 Create Order

```http
POST /api/orders
Idempotency-Key: 01J0VY3MM9D7KZ6G3CD9YH1T4J
Content-Type: application/json

{
  "items": [
    { "sku": "A-001", "quantity": 2 }
  ]
}
```

Good untuk create server-assigned order.

### 22.4 Replace User Preferences

```http
PUT /api/users/42/preferences
Content-Type: application/json

{
  "theme": "dark",
  "language": "id-ID",
  "timezone": "Asia/Jakarta"
}
```

Good jika payload full representation.

### 22.5 Partial Profile Update

```http
PATCH /api/users/42/profile
Content-Type: application/merge-patch+json

{
  "displayName": "Ayu"
}
```

Good untuk partial update.

### 22.6 Delete Draft

```http
DELETE /api/drafts/d-123
```

Good.

### 22.7 Approve Case

Kurang baik:

```http
GET /api/cases/123/approve
```

Lebih baik:

```http
POST /api/cases/123/approvals
Content-Type: application/json

{
  "comment": "All requirements satisfied"
}
```

### 22.8 Reorder Items

Option 1: replace full order list.

```http
PUT /api/playlists/pl-123/items-order
Content-Type: application/json

{
  "itemIds": ["i-3", "i-1", "i-2"]
}
```

Idempotent.

Option 2: command move.

```http
POST /api/playlists/pl-123/item-moves
Content-Type: application/json

{
  "itemId": "i-3",
  "beforeItemId": "i-1"
}
```

Potentially non-idempotent unless operation ID/key is used.

### 22.9 Mark Notification as Read

Option A:

```http
PUT /api/notifications/n-123/read-state
Content-Type: application/json

{
  "read": true
}
```

Idempotent, clear state.

Option B:

```http
POST /api/notifications/n-123/read-events
```

Better if domain wants event history.

### 22.10 Bulk Delete

Avoid ambiguous:

```http
DELETE /api/items
Content-Type: application/json

{
  "ids": ["1", "2", "3"]
}
```

Often better:

```http
POST /api/item-deletion-jobs
Content-Type: application/json

{
  "ids": ["1", "2", "3"]
}
```

or:

```http
POST /api/items/bulk-deletions
Content-Type: application/json

{
  "ids": ["1", "2", "3"]
}
```

Especially if deletion is audited, async, partially successful, or requires reason.

---

## 23. Frontend HTTP Client: Method-Aware Design

A serious frontend HTTP client should not treat all requests equally.

### 23.1 Naive Client

```ts
async function request(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  return response.json();
}
```

Problems:

1. no timeout;
2. no method-aware retry;
3. no HTTP error handling;
4. no body parsing guard;
5. no idempotency support;
6. no correlation ID;
7. no cancellation strategy;
8. no distinction between query and mutation.

### 23.2 Better Method-Aware Shape

```ts
type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestPolicy = {
  timeoutMs: number;
  retry: "none" | "safe-only" | "idempotent-only" | "explicit";
  idempotencyKey?: string;
  parseAs: "json" | "text" | "blob" | "empty";
};

function defaultPolicy(method: HttpMethod): RequestPolicy {
  switch (method) {
    case "GET":
    case "HEAD":
      return { timeoutMs: 10_000, retry: "safe-only", parseAs: method === "HEAD" ? "empty" : "json" };

    case "PUT":
    case "DELETE":
      return { timeoutMs: 10_000, retry: "idempotent-only", parseAs: "json" };

    case "POST":
    case "PATCH":
      return { timeoutMs: 15_000, retry: "none", parseAs: "json" };
  }
}
```

### 23.3 Idempotency Key Injection for Critical POST

```ts
async function createOrder(input: CreateOrderInput) {
  return http.post("/api/orders", input, {
    idempotencyKey: crypto.randomUUID(),
    retry: "explicit"
  });
}
```

But key lifecycle matters.

Bad:

```ts
// Generates new key on every retry: defeats purpose
createOrder(input) // retry creates another key
```

Better:

```ts
const idempotencyKey = crypto.randomUUID();
await createOrder(input, { idempotencyKey });
// retry uses same key
```

### 23.4 Method-Aware Error Handling

For `GET` failure:

```text
show retry button
serve stale cache if available
background retry
```

For `POST /payments` timeout:

```text
show “Checking payment status…”
query status endpoint
avoid blind duplicate submission
```

For `PATCH` conflict:

```text
show merge/conflict UI
refresh latest resource
preserve user edits
```

For `DELETE` 404:

```text
maybe treat as success if UX means “ensure removed”
```

---

## 24. Java Backend Perspective: Why Frontend Should Care

Sebagai Java engineer, Anda tahu backend tidak hanya menerima method lalu routing.

Method berpengaruh pada:

```text
Spring Security config
CORS config
CSRF config
Controller mapping
Idempotency handling
Transaction boundary
Validation group
Audit event
OpenAPI contract
Gateway policy
WAF rule
CDN cache rule
Observability tagging
```

### 24.1 Spring Controller Example

```java
@RestController
@RequestMapping("/api/cases")
class CaseController {

    @GetMapping("/{id}")
    CaseDto getCase(@PathVariable String id) { ... }

    @PatchMapping("/{id}")
    CaseDto patchCase(@PathVariable String id, @RequestBody PatchCaseRequest request) { ... }

    @PostMapping("/{id}/approvals")
    ApprovalDto approveCase(@PathVariable String id, @RequestBody ApproveCaseRequest request) { ... }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> deleteCase(@PathVariable String id) { ... }
}
```

Good separation:

```text
GET = read case
PATCH = partial case representation update
POST approvals = domain workflow transition
DELETE = remove/archive case resource
```

### 24.2 Security Config Pitfall

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
    .anyRequest().authenticated()
)
```

This is often needed for CORS preflight.

But do not blindly allow business `OPTIONS` in all contexts without understanding. CORS config should be explicit and tested.

### 24.3 Idempotency Store Sketch

```sql
CREATE TABLE idempotency_record (
    actor_id          VARCHAR NOT NULL,
    idempotency_key   VARCHAR NOT NULL,
    request_hash      VARCHAR NOT NULL,
    status            VARCHAR NOT NULL,
    resource_type     VARCHAR,
    resource_id       VARCHAR,
    response_status   INTEGER,
    response_body     JSONB,
    created_at        TIMESTAMP NOT NULL,
    expires_at        TIMESTAMP NOT NULL,
    PRIMARY KEY (actor_id, idempotency_key)
);
```

Important invariant:

```text
Same key + same actor + different request hash should be rejected.
```

Otherwise a client bug can reuse key for different operation and receive wrong result.

---

## 25. Method Anti-Patterns and Replacements

### 25.1 GET with Business Mutation

Bad:

```http
GET /api/users/42/delete
```

Better:

```http
DELETE /api/users/42
```

Or, if deletion requires approval/reason:

```http
POST /api/users/42/deletion-requests
```

### 25.2 POST for Every Operation

Bad:

```http
POST /api/getUser
POST /api/updateUser
POST /api/deleteUser
POST /api/searchUsers
```

Consequences:

```text
poor cacheability
poor observability
unclear retry behavior
harder API consistency
harder gateway/security policy
```

Better:

```http
GET    /api/users/42
PATCH  /api/users/42
DELETE /api/users/42
GET    /api/users?query=ayu
```

### 25.3 PUT as Partial Update Without Documentation

Bad:

```http
PUT /api/users/42
{ "displayName": "Ayu" }
```

Better:

```http
PATCH /api/users/42
{ "displayName": "Ayu" }
```

Or full:

```http
PUT /api/users/42
{
  "displayName": "Ayu",
  "email": "ayu@example.com",
  "timezone": "Asia/Jakarta"
}
```

### 25.4 DELETE with Complex Body

Bad if public/browser API:

```http
DELETE /api/cases/123
{ "reason": "duplicate", "notify": true }
```

Better:

```http
POST /api/cases/123/closure-requests
{
  "reason": "duplicate",
  "notify": true
}
```

### 25.5 PATCH for Workflow Transition

Bad:

```http
PATCH /api/cases/123
{ "status": "ESCALATED" }
```

Better:

```http
POST /api/cases/123/escalations
{
  "reason": "SLA breach"
}
```

Especially when escalation has validation, audit, notification, assignment, SLA, or regulatory meaning.

### 25.6 Ignoring Idempotency for Critical POST

Bad:

```http
POST /api/payments
```

without idempotency key.

Better:

```http
POST /api/payments
Idempotency-Key: ...
```

Plus backend idempotency implementation.

---

## 26. Debugging Method-Related Bugs

### 26.1 Symptom: Works in Postman, Fails in Browser

Possible causes:

```text
browser sends CORS preflight because method/header/content-type
server fails OPTIONS
credentials/cookies not included
CORS headers missing
redirect to login page
```

Check DevTools:

```text
Is there an OPTIONS request before actual request?
What is OPTIONS status?
Does response include Access-Control-Allow-Methods?
Does it include requested method?
Does it include requested headers?
```

### 26.2 Symptom: Double Order Created

Possible causes:

```text
POST retried without idempotency key
double click
frontend mutation fired twice
React StrictMode dev confusion
network retry by client/proxy
backend no unique constraint
```

Check:

```text
How many POST requests in Network tab?
Same payload?
Same idempotency key?
Same correlation ID?
Backend logs?
DB unique constraints?
```

### 26.3 Symptom: DELETE Returns 404 After User Already Removed Item

Question:

```text
Is repeated DELETE considered success or not in this API?
```

If UX means “ensure removed”, frontend can treat 404 as success if contract allows.

If UX means “delete this specific existing entity and report if missing”, show not found.

### 26.4 Symptom: PATCH Overwrites Someone Else's Change

Possible causes:

```text
no version/ETag
last-write-wins
frontend sent stale state
PATCH semantics too broad
server treats missing fields incorrectly
```

Fix:

```text
ETag + If-Match
version field
conflict response
merge UI
field-level patch
```

### 26.5 Symptom: GET Endpoint Causes Unexpected Action

Possible causes:

```text
GET used for command
browser prefetch
crawler
link preview
user opening URL
cache warmup
monitoring probe
```

Fix:

```text
move action to POST/PUT/PATCH/DELETE according to semantics
add CSRF protection if cookie-authenticated
block unsafe GET action
```

---

## 27. Design Review Checklist

Saat review API/frontend integration, tanya:

### 27.1 Semantics

```text
Apakah method sesuai intent?
Apakah operation read-only memakai GET?
Apakah mutation memakai method unsafe?
Apakah command domain tidak dipaksa sebagai field update?
```

### 27.2 Safety

```text
Apakah GET benar-benar tidak mengubah state bisnis?
Apakah ada crawler/prefetch/link-preview risk?
Apakah logout/payment/approval tidak memakai GET?
```

### 27.3 Idempotency

```text
Apakah operation bisa diulang?
Apa yang terjadi jika user double-click?
Apa yang terjadi jika timeout lalu retry?
Apakah POST critical memakai idempotency key?
Apakah PUT/DELETE benar-benar idempotent?
```

### 27.4 CORS

```text
Apakah method akan memicu preflight?
Apakah backend support OPTIONS?
Apakah Access-Control-Allow-Methods lengkap?
Apakah auth middleware tidak memblokir preflight?
```

### 27.5 Cache

```text
Apakah reads memakai GET agar bisa cache?
Apakah personalized GET punya Cache-Control aman?
Apakah mutation response tidak ter-cache salah?
```

### 27.6 UI Behavior

```text
Apakah UI disable submit untuk non-idempotent action?
Apakah retry policy method-aware?
Apakah timeout outcome ditangani?
Apakah optimistic update punya rollback?
Apakah conflict punya UX?
```

### 27.7 Observability

```text
Apakah method terlihat benar di logs?
Apakah correlation ID ada?
Apakah preflight dipisah dari business request?
Apakah status code sesuai method outcome?
```

---

## 28. Worked Example: Case Management API

Misalkan kita mendesain API untuk regulatory case management.

### 28.1 Read Case

```http
GET /api/cases/C-2026-001
Accept: application/json
```

Response:

```http
200 OK
Content-Type: application/json
ETag: "case-v17"
```

```json
{
  "id": "C-2026-001",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "assignedUnit": "ENFORCEMENT",
  "version": 17
}
```

### 28.2 Partial Metadata Update

```http
PATCH /api/cases/C-2026-001
If-Match: "case-v17"
Content-Type: application/merge-patch+json

{
  "priority": "CRITICAL"
}
```

Possible response:

```http
200 OK
ETag: "case-v18"
```

### 28.3 Workflow Escalation

Do not do:

```http
PATCH /api/cases/C-2026-001
{ "status": "ESCALATED" }
```

Better:

```http
POST /api/cases/C-2026-001/escalations
Idempotency-Key: 01J0VY...
Content-Type: application/json

{
  "reason": "Potential systemic risk",
  "targetUnit": "MARKET_ABUSE"
}
```

Response:

```http
201 Created
Location: /api/cases/C-2026-001/escalations/E-778
```

Why better?

```text
Escalation is not merely status mutation.
It is a domain event with validation, authority, audit, notification, SLA, and downstream implications.
```

### 28.4 Close Case

Could be:

```http
POST /api/cases/C-2026-001/closure-requests
Idempotency-Key: 01J0VY...
Content-Type: application/json

{
  "outcome": "NO_BREACH_FOUND",
  "summary": "Evidence insufficient for enforcement action."
}
```

Not simply:

```http
DELETE /api/cases/C-2026-001
```

Because closure is a business transition, not resource removal.

### 28.5 Delete Draft Attachment

This is closer to resource removal:

```http
DELETE /api/cases/C-2026-001/draft-attachments/A-22
```

Good.

---

## 29. Common Misconceptions

### Misconception 1: “POST means create.”

Better:

```text
POST means resource-specific processing of request content.
Create is one common use.
```

### Misconception 2: “PUT and PATCH are the same.”

Better:

```text
PUT replaces target representation.
PATCH applies partial modification.
```

### Misconception 3: “DELETE is not idempotent because second delete returns 404.”

Better:

```text
Idempotency is about intended final server state, not identical response.
```

### Misconception 4: “GET can be used for action if it is convenient.”

Better:

```text
GET should not request business mutation.
Convenience creates security, cache, crawler, and retry bugs.
```

### Misconception 5: “CORS error means method is wrong.”

Better:

```text
CORS error may mean browser preflight for that method/header failed.
The method can be semantically correct while server CORS config is wrong.
```

### Misconception 6: “If request timed out, it failed.”

Better:

```text
Timeout means client did not receive result.
Server-side outcome may be success, failure, or unknown.
```

---

## 30. Compact Decision Table

| Intent | Recommended Method | Example |
|---|---|---|
| Read resource | `GET` | `GET /api/users/42` |
| Read metadata only | `HEAD` | `HEAD /files/report.pdf` |
| Create in collection, server chooses ID | `POST` | `POST /api/orders` |
| Replace complete resource | `PUT` | `PUT /api/users/42/preferences` |
| Partial update | `PATCH` | `PATCH /api/users/42/profile` |
| Remove resource | `DELETE` | `DELETE /api/drafts/d-1` |
| Workflow command | `POST` | `POST /api/cases/123/escalations` |
| Long-running job | `POST` then `GET status` | `POST /api/report-jobs` |
| Complex search no cache need | `POST` acceptable | `POST /api/cases/search` |
| Simple search/list | `GET` | `GET /api/cases?status=OPEN` |

---

## 31. Exercises

### Exercise 1 — Classify Method

Untuk setiap endpoint, tentukan apakah method-nya baik atau buruk.

```text
GET /api/logout
POST /api/orders
GET /api/orders?status=PENDING
PUT /api/users/42/preferences
PATCH /api/users/42/profile
GET /api/cases/123/approve
POST /api/cases/123/escalations
DELETE /api/notifications/n-1
POST /api/products/search
```

Expected reasoning:

```text
GET /api/logout -> buruk jika logout mengubah session; gunakan POST.
POST /api/orders -> baik untuk create order; tambahkan idempotency key jika critical.
GET /api/orders?status=PENDING -> baik untuk read/filter.
PUT /api/users/42/preferences -> baik jika full replacement.
PATCH /api/users/42/profile -> baik untuk partial update.
GET /api/cases/123/approve -> buruk; approval adalah command.
POST /api/cases/123/escalations -> baik untuk workflow transition.
DELETE /api/notifications/n-1 -> baik jika remove notification.
POST /api/products/search -> acceptable jika query kompleks; GET lebih baik jika simple/cacheable.
```

### Exercise 2 — Retry Policy

Tentukan retry policy:

```text
GET /api/products
POST /api/payments
PUT /api/preferences/me
PATCH /api/cases/123 priority update
DELETE /api/drafts/d-123
```

Expected reasoning:

```text
GET /api/products -> retry safe dengan backoff.
POST /api/payments -> jangan blind retry; gunakan idempotency key/status check.
PUT /api/preferences/me -> retry lebih aman jika full idempotent save.
PATCH /api/cases/123 -> tergantung patch semantics; gunakan If-Match untuk conflict.
DELETE /api/drafts/d-123 -> retry biasanya aman; 404 may be treated as already removed if contract says so.
```

### Exercise 3 — Redesign Bad API

Bad API:

```http
POST /api/doAction
Content-Type: application/json

{
  "action": "APPROVE_CASE",
  "caseId": "C-1",
  "comment": "ok"
}
```

Better candidates:

```http
POST /api/cases/C-1/approvals
Content-Type: application/json

{
  "comment": "ok"
}
```

or:

```http
POST /api/cases/C-1:approve
Content-Type: application/json

{
  "comment": "ok"
}
```

Explain why:

```text
method expresses unsafe command
URL expresses domain target
body expresses command details
observability becomes clear
security policy can be resource/action aware
```

---

## 32. Key Takeaways

1. HTTP method is not merely CRUD naming; it is a protocol-level semantic contract.
2. `GET` should retrieve representation and not request business mutation.
3. `POST` is flexible resource-specific processing, not only create.
4. `PUT` means replace target resource representation and is idempotent.
5. `PATCH` means partial modification and is not automatically idempotent.
6. `DELETE` is idempotent in intended final state, even if repeated response differs.
7. `OPTIONS` matters heavily for CORS preflight.
8. Safe, idempotent, and cacheable are different properties.
9. Retry policy must be method-aware.
10. Timeout on mutation means unknown outcome, not guaranteed failure.
11. Workflow transitions often deserve command resources using `POST`, not fake field patches.
12. Method choice impacts browser behavior, CORS, cache, CDN, security, observability, and UI state machines.

---

## 33. References

- RFC 9110 — HTTP Semantics. Defines HTTP semantics, method definitions, safe methods, idempotent methods, and cacheable method concepts.
- RFC 9111 — HTTP Caching. Defines HTTP caching behavior and cache controls.
- RFC 5789 — PATCH Method for HTTP. Defines the PATCH method.
- MDN Web Docs — HTTP request methods. Practical method reference including safety, idempotency, and cacheability tables.
- MDN Web Docs — CORS. Explains browser cross-origin request behavior and preflight.
- WHATWG Fetch Standard. Defines browser fetching behavior used by `fetch()`, resource loading, CORS, redirect behavior, and request processing.

---

## 34. Status Seri

```text
Part 004 selesai.
Seri belum selesai.
Lanjut ke Part 005: Status Codes: Reading Outcomes Like a Protocol Engineer.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-003.md">⬅️ Part 003 — HTTP Message Model: Request, Response, Header, Body</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-005.md">Part 005 — Status Codes: Reading Outcomes Like a Protocol Engineer ➡️</a>
</div>
