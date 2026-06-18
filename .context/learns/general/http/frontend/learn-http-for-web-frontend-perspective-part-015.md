# learn-http-for-web-frontend-perspective-part-015.md

# Part 015 — HTTP Caching Part 2: ETag, Last-Modified, Revalidation, and 304

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin menguasai HTTP dari sisi browser/frontend  
> Status: Part 015 dari 035  
> Prasyarat: Part 014 — Browser Cache Mental Model

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 014, kita membangun mental model dasar caching:

- cache bukan sekadar performance optimization;
- cache adalah mekanisme correctness, consistency, latency, dan cost control;
- browser cache, CDN cache, service worker cache, dan application data cache adalah layer yang berbeda;
- `Cache-Control` menentukan apakah response boleh disimpan, kapan fresh, kapan stale, dan kapan harus divalidasi ulang.

Part 015 memperdalam satu area yang sangat sering menjadi sumber bug produksi:

> Apa yang terjadi ketika browser punya response lama, tapi belum yakin apakah response itu masih valid?

Jawaban HTTP-nya adalah **conditional request** dan **revalidation**.

Di sinilah kita bertemu:

- `ETag`
- `Last-Modified`
- `If-None-Match`
- `If-Modified-Since`
- `304 Not Modified`
- strong validator
- weak validator
- cache revalidation
- deployment cache strategy
- stale asset bug
- old HTML references deleted JS chunk
- API response revalidation
- CDN/browser cache layering

Jika Part 014 mengajarkan “bolehkah response ini disimpan?”, Part 015 mengajarkan “bagaimana membuktikan response lama masih boleh dipakai?”.

---

## 1. Core Mental Model

HTTP cache punya tiga kemungkinan saat browser ingin memakai resource:

```text
Request for /app.js
        |
        v
Browser cache punya stored response?
        |
        +-- No  --> network request normal --> 200 + body
        |
        +-- Yes --> response masih fresh?
                  |
                  +-- Yes --> pakai dari cache tanpa network
                  |
                  +-- No  --> revalidate ke server
                              |
                              +-- server: belum berubah --> 304, pakai body lama
                              |
                              +-- server: sudah berubah --> 200, pakai body baru
```

Hal penting:

> `304 Not Modified` tidak berarti browser menerima resource kosong.  
> `304` berarti browser boleh memakai body lama yang sudah ada di cache.

Jadi, `304` adalah **permission to reuse stored representation**, bukan “response data kosong” dalam arti aplikasi.

---

## 2. Revalidation: Masalah yang Diselesaikan

Tanpa revalidation, cache hanya punya dua pilihan kasar:

1. selalu ambil ulang resource dari server;
2. selalu percaya response lama sampai expiration time habis.

Keduanya tidak ideal.

Selalu ambil ulang berarti:

- latency lebih tinggi;
- bandwidth lebih boros;
- origin/CDN lebih sibuk;
- user experience lebih lambat.

Selalu percaya response lama berarti:

- user bisa melihat data stale;
- HTML lama bisa menunjuk asset yang sudah tidak ada;
- konfigurasi lama bisa tetap dipakai;
- bug fix frontend terlambat sampai ke user.

Revalidation memberi opsi ketiga:

> “Server, saya punya versi X. Apakah masih sama? Kalau sama, tidak perlu kirim ulang body.”

---

## 3. Validator: Bukti Identitas Versi Resource

Untuk melakukan revalidation, browser butuh validator.

Validator adalah metadata yang menggambarkan versi resource.

Ada dua validator utama:

1. `ETag`
2. `Last-Modified`

Contoh response awal:

```http
HTTP/1.1 200 OK
Content-Type: application/javascript
Cache-Control: no-cache
ETag: "app-js-v42"
Last-Modified: Tue, 16 Jun 2026 10:00:00 GMT

console.log("version 42")
```

Browser menyimpan:

- URL/cache key;
- status response;
- response headers;
- response body;
- metadata freshness;
- validator `ETag` dan/atau `Last-Modified`.

Saat response perlu divalidasi ulang, browser dapat mengirim conditional request:

```http
GET /app.js HTTP/1.1
Host: static.example.com
If-None-Match: "app-js-v42"
If-Modified-Since: Tue, 16 Jun 2026 10:00:00 GMT
```

Server lalu menjawab:

```http
HTTP/1.1 304 Not Modified
ETag: "app-js-v42"
Cache-Control: no-cache
```

Browser memakai body lama:

```js
console.log("version 42")
```

---

## 4. `ETag`: Entity Tag sebagai Version Identifier

`ETag` adalah identifier untuk representasi resource.

Contoh:

```http
ETag: "686897696a7c876b7e"
```

Atau:

```http
ETag: "user-profile-187263-version-9"
```

Atau weak validator:

```http
ETag: W/"profile-187263-v9"
```

Secara konseptual:

```text
Resource: /api/users/123
Representation: JSON profile user 123 dalam format saat ini
Validator: ETag yang berubah ketika representation berubah
```

Jika representation berubah, idealnya `ETag` berubah.

Jika `ETag` tidak berubah padahal body berubah, cache bisa salah memakai body lama.

Jika `ETag` berubah padahal body tidak berubah, cache tetap benar tetapi kehilangan efisiensi karena harus download ulang.

---

## 5. Strong ETag vs Weak ETag

Ada dua jenis `ETag`:

```http
ETag: "abc123"
```

Ini strong validator.

```http
ETag: W/"abc123"
```

Ini weak validator.

### 5.1 Strong Validator

Strong validator berarti dua representation dianggap byte-for-byte equivalent untuk tujuan tertentu.

Cocok untuk:

- static asset fingerprinting;
- file download;
- exact cache validation;
- range request;
- concurrency control dengan presisi tinggi.

Contoh:

```http
ETag: "sha256-8d969eef6ecad3c29a3a629280e686cf"
```

Jika file berubah satu byte, ETag berubah.

### 5.2 Weak Validator

Weak validator berarti representation dianggap semantically equivalent, walaupun byte-nya bisa berbeda.

Contoh:

```http
ETag: W/"article-123-v5"
```

Dua response mungkin berbeda di whitespace, serialization order, atau generated timestamp non-essential, tetapi secara semantic masih dianggap sama.

Weak validator cocok untuk:

- HTML generated dynamically;
- JSON yang serialization detail-nya tidak penting;
- response yang punya variasi minor tetapi secara domain dianggap sama.

Namun weak validator tidak cocok untuk semua skenario. Untuk exact byte serving, partial content, atau binary asset presisi tinggi, strong validator lebih tepat.

---

## 6. `Last-Modified`: Timestamp sebagai Validator

`Last-Modified` menyatakan waktu terakhir resource diubah.

Contoh:

```http
Last-Modified: Tue, 16 Jun 2026 10:00:00 GMT
```

Browser dapat mengirim:

```http
If-Modified-Since: Tue, 16 Jun 2026 10:00:00 GMT
```

Server menjawab:

```http
HTTP/1.1 304 Not Modified
```

jika resource tidak berubah sejak timestamp tersebut.

### 6.1 Kelebihan `Last-Modified`

- sederhana;
- mudah dihasilkan untuk file static;
- banyak server dan CDN mendukung otomatis;
- cukup baik untuk banyak resource.

### 6.2 Kelemahan `Last-Modified`

Timestamp punya resolusi terbatas.

Masalah umum:

```text
10:00:00.100 resource berubah ke v1
10:00:00.700 resource berubah ke v2
Last-Modified sama-sama terlihat 10:00:00 GMT
```

Jika precision hanya detik, perubahan cepat bisa tidak terdeteksi.

Masalah lain:

- clock server tidak sinkron;
- resource digenerate ulang tanpa perubahan semantic;
- deployment pipeline mengubah timestamp tanpa mengubah content;
- distributed system punya banyak node dengan waktu berbeda;
- restore backup bisa menghasilkan timestamp lama.

Karena itu, untuk correctness yang kuat, `ETag` sering lebih baik daripada hanya `Last-Modified`.

---

## 7. `If-None-Match`: Conditional Request Berbasis ETag

Jika browser punya `ETag`, browser dapat mengirim:

```http
GET /bundle.js HTTP/1.1
Host: static.example.com
If-None-Match: "abc123"
```

Maknanya:

> “Kirim body hanya jika current ETag tidak cocok dengan `abc123`.”

Jika current ETag masih sama:

```http
HTTP/1.1 304 Not Modified
ETag: "abc123"
Cache-Control: no-cache
```

Jika current ETag berbeda:

```http
HTTP/1.1 200 OK
Content-Type: application/javascript
ETag: "def456"
Cache-Control: no-cache

/* new bundle */
```

### 7.1 Mengapa Namanya `If-None-Match`?

Nama ini terasa membingungkan.

Untuk `GET`:

```text
If none of the provided ETags match current representation,
then send the full response.
```

Jika ada yang match, server tidak perlu kirim full body dan mengembalikan `304`.

---

## 8. `If-Modified-Since`: Conditional Request Berbasis Timestamp

Jika browser punya `Last-Modified`, browser dapat mengirim:

```http
GET /style.css HTTP/1.1
Host: static.example.com
If-Modified-Since: Tue, 16 Jun 2026 10:00:00 GMT
```

Maknanya:

> “Kirim body hanya jika resource berubah setelah waktu ini.”

Jika belum berubah:

```http
HTTP/1.1 304 Not Modified
```

Jika sudah berubah:

```http
HTTP/1.1 200 OK
Last-Modified: Tue, 16 Jun 2026 11:30:00 GMT
Content-Type: text/css

body { ... }
```

---

## 9. Jika Ada `ETag` dan `Last-Modified`, Mana yang Dipakai?

Dalam praktik modern, server sering mengirim keduanya:

```http
HTTP/1.1 200 OK
Cache-Control: no-cache
ETag: "abc123"
Last-Modified: Tue, 16 Jun 2026 10:00:00 GMT
```

Browser bisa mengirim keduanya:

```http
GET /app.js HTTP/1.1
If-None-Match: "abc123"
If-Modified-Since: Tue, 16 Jun 2026 10:00:00 GMT
```

Secara mental model:

> `ETag` lebih spesifik; `Last-Modified` adalah fallback.

Jika keduanya ada, evaluasi berbasis ETag menjadi lebih kuat untuk menentukan apakah representation berubah.

Practical rule:

```text
Prefer ETag for precise validation.
Use Last-Modified as useful fallback.
For static files, sending both is often fine.
For dynamic APIs, be intentional.
```

---

## 10. `304 Not Modified`: Response yang Sering Disalahpahami

`304` termasuk kelas 3xx, tetapi bukan redirect biasa.

`304` berarti:

> Stored response yang dimiliki cache masih valid dan bisa digunakan.

`304` biasanya tidak membawa body.

Contoh:

```http
HTTP/1.1 304 Not Modified
Date: Thu, 18 Jun 2026 03:15:00 GMT
ETag: "abc123"
Cache-Control: no-cache
```

Browser lalu menggabungkan metadata baru dengan stored response lama sesuai aturan caching.

### 10.1 DevTools Confusion

Di DevTools Network, Anda mungkin melihat:

```text
Status: 304
Size: 178 B
```

Lalu UI tetap menampilkan script/CSS/image penuh.

Itu normal.

Network hanya menerima metadata kecil dari server, tetapi browser memakai body dari cache.

### 10.2 `304` Bukan Error

Frontend engineer pemula kadang melihat 304 dan mengira request gagal.

Salah.

`304` adalah success path untuk cache revalidation.

Jika Anda melihat banyak 304, itu berarti browser masih melakukan network round-trip. Ini lebih hemat bandwidth daripada 200 full body, tetapi tetap punya latency.

Jika resource bisa benar-benar immutable, lebih baik browser tidak perlu revalidate sama sekali selama freshness lifetime.

---

## 11. Freshness vs Validation: Dua Konsep yang Harus Dipisah

Freshness menjawab:

> “Bolehkah cache memakai response ini tanpa bertanya ke server?”

Validation menjawab:

> “Jika harus bertanya, bagaimana server membuktikan response lama masih benar?”

Contoh 1:

```http
Cache-Control: max-age=31536000, immutable
ETag: "abc123"
```

Selama fresh, browser tidak perlu revalidate.

Contoh 2:

```http
Cache-Control: no-cache
ETag: "abc123"
```

Browser boleh menyimpan, tetapi harus revalidate sebelum reuse.

Contoh 3:

```http
Cache-Control: no-store
ETag: "abc123"
```

Browser seharusnya tidak menyimpan. `ETag` jadi tidak berguna untuk normal cache reuse karena tidak ada stored response.

### 11.1 `no-cache` Bukan `no-store`

Ini sangat penting.

```http
Cache-Control: no-cache
```

berarti:

```text
Boleh disimpan, tetapi harus divalidasi ulang sebelum dipakai.
```

Sedangkan:

```http
Cache-Control: no-store
```

berarti:

```text
Jangan simpan response.
```

Untuk HTML SPA, `no-cache` sering lebih baik daripada `no-store` karena browser bisa revalidate dengan `ETag` dan mendapat `304` jika belum berubah.

Untuk response sensitif seperti data finansial sangat personal, token, atau dokumen rahasia, `no-store` mungkin lebih tepat.

---

## 12. Timeline Revalidation Lengkap

Misal resource HTML:

```http
GET / HTTP/1.1
Host: app.example.com
```

Server:

```http
HTTP/1.1 200 OK
Content-Type: text/html
Cache-Control: no-cache
ETag: "html-v10"

<script src="/assets/app.abc123.js"></script>
```

Browser menyimpan HTML.

Beberapa menit kemudian user reload:

```http
GET / HTTP/1.1
Host: app.example.com
If-None-Match: "html-v10"
```

Jika HTML belum berubah:

```http
HTTP/1.1 304 Not Modified
ETag: "html-v10"
Cache-Control: no-cache
```

Browser memakai HTML lama.

Jika deploy baru mengubah HTML:

```http
HTTP/1.1 200 OK
Content-Type: text/html
Cache-Control: no-cache
ETag: "html-v11"

<script src="/assets/app.def456.js"></script>
```

Browser memakai HTML baru dan mengambil JS baru.

---

## 13. Static Asset Strategy: Fingerprinted Files

Frontend modern biasanya menghasilkan asset seperti:

```text
/assets/app.8f3a1c9.js
/assets/vendor.51aa2e1.css
/assets/logo.991af0d.svg
```

Hash di filename berubah ketika content berubah.

Ini sangat powerful.

Karena URL berubah saat content berubah, asset lama dan baru adalah resource berbeda.

Maka kita bisa memberi cache header agresif:

```http
Cache-Control: public, max-age=31536000, immutable
```

Mental model:

```text
/app.abc123.js tidak akan pernah berubah content-nya.
Jika app berubah, buat URL baru: /app.def456.js.
```

Dengan strategi ini:

- browser tidak perlu revalidate asset selama fresh;
- CDN bisa menyimpan lama;
- bandwidth hemat;
- page load cepat;
- deployment lebih aman.

### 13.1 Apakah Masih Butuh ETag untuk Fingerprinted Assets?

Tidak selalu.

Untuk asset fingerprinted dengan long max-age + immutable:

```http
Cache-Control: public, max-age=31536000, immutable
ETag: "..."
```

`ETag` tidak merugikan, tetapi sering tidak banyak dipakai selama resource fresh.

Jika user hard reload atau cache expired, validator bisa membantu.

Namun correctness utama berasal dari URL fingerprint, bukan ETag.

---

## 14. HTML Strategy: Jangan Cache Terlalu Lama

HTML adalah entry point yang menunjuk asset versi tertentu.

Contoh:

```html
<script type="module" src="/assets/app.abc123.js"></script>
```

Jika HTML dicache terlalu lama:

```http
Cache-Control: public, max-age=31536000
```

maka browser bisa terus memakai HTML lama yang menunjuk JS lama.

Jika server/CDN sudah menghapus JS lama, user akan mengalami:

```text
GET /assets/app.abc123.js -> 404
Application blank screen
```

Ini bug klasik frontend deployment.

### 14.1 Recommended HTML Header

Untuk SPA HTML:

```http
Cache-Control: no-cache
ETag: "html-v123"
```

Atau:

```http
Cache-Control: max-age=0, must-revalidate
ETag: "html-v123"
```

Artinya:

- browser boleh menyimpan HTML;
- sebelum reuse, browser harus revalidate;
- jika belum berubah, server bisa jawab 304;
- jika berubah, browser mendapat HTML baru.

### 14.2 Kapan `no-store` untuk HTML?

`no-store` bisa dipakai jika HTML mengandung data sangat sensitif atau personalized content yang tidak boleh disimpan.

Tetapi untuk SPA shell umum, `no-cache` sering lebih seimbang.

---

## 15. API Response Strategy: Tidak Semua Endpoint Sama

API response tidak boleh diberi satu strategi global tanpa berpikir.

Contoh endpoint:

```text
GET /api/me
GET /api/products?category=book
GET /api/config
GET /api/countries
GET /api/cases/123
GET /api/notifications/unread-count
```

Masing-masing punya freshness dan sensitivity berbeda.

### 15.1 Highly Personal Dynamic Data

Contoh:

```text
GET /api/me
GET /api/account/balance
GET /api/cases/123/private-notes
```

Header konservatif:

```http
Cache-Control: private, no-cache
ETag: "user-123-profile-v9"
```

atau untuk sangat sensitif:

```http
Cache-Control: no-store
```

Trade-off:

- `private, no-cache` memungkinkan browser revalidate;
- `no-store` memaksimalkan privacy tetapi kehilangan cache efficiency.

### 15.2 Semi-static Reference Data

Contoh:

```text
GET /api/countries
GET /api/currencies
GET /api/permission-catalog
```

Header mungkin:

```http
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
ETag: "countries-v2026-06-01"
```

Jika data sama untuk semua user, `public` bisa masuk akal.

Jika ada variasi auth/tenant/language, hati-hati.

### 15.3 User-specific but Revalidatable Data

Contoh:

```text
GET /api/cases/123
```

Header:

```http
Cache-Control: private, no-cache
ETag: "case-123-rowversion-881"
Vary: Authorization
```

Namun `Vary: Authorization` di browser/CDN harus dipahami matang. Untuk shared cache, response ber-Authorization umumnya perlu konfigurasi eksplisit agar tidak bocor.

---

## 16. CDN + Browser Cache Layering

Dalam produksi, request tidak langsung browser → app server.

Biasanya:

```text
Browser
  -> ISP/network
  -> CDN edge
  -> load balancer
  -> reverse proxy/API gateway
  -> app server
```

Ada beberapa cache layer:

```text
Browser HTTP cache
CDN edge cache
Reverse proxy cache
Application-level cache
Database/query cache
```

Revalidation bisa terjadi di beberapa layer.

Contoh:

```text
Browser sends If-None-Match to CDN
CDN has fresh object -> CDN returns 304 or 200 from edge
CDN has stale object -> CDN revalidates to origin
Origin returns 304 to CDN
CDN updates metadata and returns appropriate response to browser
```

### 16.1 Shared Cache vs Private Cache

Browser cache adalah private cache.

CDN adalah shared cache.

Implikasi:

```http
Cache-Control: private
```

Response hanya untuk private cache, bukan shared cache.

```http
Cache-Control: public
```

Response boleh disimpan oleh shared cache jika aturan lain juga memungkinkan.

### 16.2 `s-maxage`

`s-maxage` berlaku untuk shared cache.

Contoh:

```http
Cache-Control: public, max-age=60, s-maxage=3600
```

Artinya secara konseptual:

- browser fresh selama 60 detik;
- shared cache/CDN fresh selama 3600 detik.

Ini berguna ketika ingin browser cepat revalidate, tapi CDN tetap mengurangi beban origin.

---

## 17. `stale-while-revalidate` dan `stale-if-error`

Dua directive penting untuk resilience:

```http
Cache-Control: max-age=60, stale-while-revalidate=300, stale-if-error=86400
```

Makna konseptual:

- selama 60 detik: response fresh;
- setelah itu sampai 300 detik: cache boleh menyajikan stale response sambil revalidate di belakang;
- jika origin error, cache boleh menyajikan stale response sampai batas tertentu.

Ini sangat berguna untuk:

- reference data;
- static content;
- halaman konten publik;
- config non-critical;
- API read-only yang toleran stale.

Tidak cocok untuk:

- saldo rekening;
- data compliance yang harus fresh;
- permission real-time;
- status pembayaran final;
- mutation result.

---

## 18. Revalidation vs Application Data Cache

Frontend modern sering memakai TanStack Query, SWR, Apollo, RTK Query, atau cache internal.

Jangan samakan dengan HTTP cache.

```text
HTTP cache:
- dikontrol via HTTP headers
- ada di browser/network layer
- bekerja per URL/request metadata
- bisa terjadi sebelum JS menerima response

Application data cache:
- dikontrol oleh JS library
- menyimpan parsed/domain data
- punya staleTime, cacheTime, invalidation key
- tidak otomatis mengikuti HTTP semantics
```

Keduanya bisa bekerja bersama, tetapi juga bisa konflik.

Contoh konflik:

```text
HTTP cache menyajikan response lama,
TanStack Query mengira baru saja fetch fresh data,
UI tetap stale.
```

Atau:

```text
HTTP no-store,
application cache menyimpan data sensitif di memory terlalu lama.
```

Rule:

> HTTP cache mengontrol network representation.  
> Application cache mengontrol domain/UI state.

Jangan desain salah satu tanpa memikirkan yang lain.

---

## 19. Conditional Requests untuk Concurrency: Preview ke Part Mutation

`ETag` tidak hanya untuk caching.

Ia juga bisa dipakai untuk mencegah lost update.

Read:

```http
GET /api/cases/123 HTTP/1.1
```

Response:

```http
HTTP/1.1 200 OK
ETag: "case-123-v8"
Content-Type: application/json

{"id":"123","status":"OPEN","assignee":"alice"}
```

Update:

```http
PUT /api/cases/123 HTTP/1.1
If-Match: "case-123-v8"
Content-Type: application/json

{"status":"CLOSED"}
```

Jika server masih di v8, update diterima.

Jika resource sudah berubah ke v9, server bisa mengembalikan:

```http
HTTP/1.1 412 Precondition Failed
```

Ini bukan caching flow, tetapi validator yang sama dipakai untuk concurrency control.

Untuk frontend, ini sangat penting pada:

- edit form lama;
- multi-tab editing;
- collaborative workflow;
- regulatory case management;
- approval/review process;
- optimistic locking.

---

## 20. Deployment Failure: Old HTML References Deleted Chunk

Ini salah satu incident frontend paling umum.

### 20.1 Scenario

Build v1:

```text
index.html -> /assets/app.abc123.js
```

Deploy v2:

```text
index.html -> /assets/app.def456.js
```

Jika deploy process menghapus asset lama:

```text
/assets/app.abc123.js deleted
```

User yang masih punya HTML lama mencoba load:

```text
GET /assets/app.abc123.js -> 404
```

Hasil:

- blank page;
- app gagal boot;
- error di console;
- user tidak bisa self-heal kecuali hard refresh;
- service worker bisa memperparah jika menyajikan shell lama.

### 20.2 Prevention

Rule kuat:

```text
Never delete old immutable assets immediately after deploy.
```

Strategi:

1. HTML revalidate setiap load.
2. Static assets immutable long cache.
3. Simpan asset lama untuk beberapa release/window waktu.
4. Jangan overwrite file hash yang sama dengan content berbeda.
5. Gunakan atomic deployment jika memungkinkan.
6. CDN invalidation untuk HTML, bukan semua assets.
7. Tambahkan fallback/reload strategy untuk chunk load failure.

### 20.3 Header yang Disarankan

HTML:

```http
Cache-Control: no-cache
ETag: "html-build-20260618-001"
```

Assets:

```http
Cache-Control: public, max-age=31536000, immutable
```

---

## 21. Deployment Failure: HTML Cached Too Long

Jika HTML dikirim dengan:

```http
Cache-Control: public, max-age=86400
```

maka user bisa memakai HTML lama selama 1 hari tanpa revalidation.

Ini berbahaya jika:

- API contract berubah;
- feature flag config berubah;
- route table berubah;
- asset manifest berubah;
- JS chunk lama dihapus;
- security fix perlu cepat sampai ke user.

Frontend deployment harus menganggap HTML sebagai **mutable pointer document**.

Static assets boleh immutable.

HTML tidak boleh diperlakukan sama dengan asset hash.

---

## 22. Deployment Failure: ETag Tidak Stabil

ETag yang buruk bisa mengurangi cache efficiency.

Contoh buruk:

```text
ETag dihitung dari timestamp build server lokal
ETag berbeda di setiap node
```

Jika load balancer mengarah ke node berbeda:

```text
Request 1 -> node A -> ETag "abc"
Request 2 -> node B -> ETag "def" walau body sama
```

Hasil:

- browser sering dapat 200, bukan 304;
- cache miss semu;
- bandwidth boros;
- debugging membingungkan.

Rule:

```text
ETag harus stabil untuk representation yang sama di semua server/CDN node.
```

Untuk static files, hash content adalah pilihan baik.

Untuk dynamic resource, gunakan version/rowversion/updatedAt yang benar-benar merepresentasikan perubahan domain atau representation.

---

## 23. Deployment Failure: ETag Terlalu Stabil

Kebalikannya juga berbahaya.

Contoh:

```http
ETag: "users-api"
```

Jika body berubah tetapi ETag tetap sama, server bisa mengirim:

```http
304 Not Modified
```

padahal response lama sudah salah.

Hasil:

- user melihat data stale;
- bug sulit direproduksi;
- DevTools menunjukkan 304 “sukses”;
- backend merasa endpoint benar karena current response 200 di curl terlihat benar.

Rule:

```text
Jika representation berubah secara bermakna, validator harus berubah.
```

---

## 24. Deployment Failure: Weak ETag untuk Response yang Butuh Exactness

Weak ETag tidak selalu salah.

Tetapi gunakan dengan sadar.

Jika frontend membutuhkan exact file bytes, strong ETag lebih cocok.

Jika API memakai weak ETag untuk optimistic concurrency, hati-hati. Jika server menganggap dua representation “semantically same” padahal user melihat field berbeda, conflict bisa gagal terdeteksi.

Rule:

```text
For caching semantic equivalence, weak ETag can be fine.
For exact bytes or strict concurrency, prefer strong validators.
```

---

## 25. `Vary` dan Revalidation

`Vary` menentukan request header apa yang mempengaruhi cache variant.

Contoh:

```http
Vary: Accept-Encoding
```

Artinya gzip/br/plain bisa menjadi variant berbeda.

Contoh:

```http
Vary: Accept-Language
```

Artinya response Inggris dan Indonesia tidak boleh dicampur.

Contoh:

```http
Vary: Origin
```

Sering muncul untuk CORS.

### 25.1 ETag Harus Sesuai Variant

Jika response berbeda berdasarkan language:

```http
GET /api/content
Accept-Language: en-US
```

Response:

```http
ETag: "content-v5-en"
Vary: Accept-Language
```

Untuk Indonesia:

```http
ETag: "content-v5-id"
Vary: Accept-Language
```

Jangan memberi ETag sama untuk representation berbeda.

### 25.2 Variant Explosion

Terlalu banyak `Vary` bisa membuat cache tidak efektif.

Contoh berbahaya:

```http
Vary: User-Agent
```

User-Agent sangat beragam, sehingga cache fragmentation besar.

Rule:

```text
Gunakan Vary hanya ketika request header benar-benar mengubah response representation.
```

---

## 26. Browser Reload Behavior

Reload tidak selalu sama.

Secara praktis:

### 26.1 Normal Navigation

Browser memakai cache jika fresh.

Jika stale dan punya validator, browser revalidate.

### 26.2 Reload

Browser cenderung revalidate resource.

Anda sering melihat banyak conditional request.

### 26.3 Hard Reload

Browser memaksa mengambil ulang lebih agresif.

Cache bisa diabaikan untuk banyak resource.

### 26.4 Disable Cache di DevTools

Ketika DevTools Network dibuka dan “Disable cache” aktif, behavior Anda tidak mewakili user normal.

Ini sering membuat engineer salah menyimpulkan:

```text
"Cache header tidak bekerja."
```

Padahal cache memang dinonaktifkan selama DevTools terbuka.

Rule:

> Saat debugging cache, selalu sadar mode reload dan DevTools cache setting.

---

## 27. DevTools: Cara Membaca Revalidation

Di Chrome/Edge/Firefox DevTools Network, perhatikan:

- Status: `200`, `304`, `(from memory cache)`, `(from disk cache)`;
- Size: transferred vs resource size;
- Response headers;
- Request headers;
- `If-None-Match`;
- `If-Modified-Since`;
- `ETag`;
- `Last-Modified`;
- `Cache-Control`;
- `Age`;
- `Vary`;
- Timing: apakah ada network round-trip.

### 27.1 Pattern: Served from Cache Without Network

```text
Status: 200 (from memory cache)
Transferred: 0 B
```

atau:

```text
Status: 200 (from disk cache)
```

Artinya browser tidak perlu revalidate.

### 27.2 Pattern: Revalidated Successfully

Request:

```http
If-None-Match: "abc123"
```

Response:

```http
304 Not Modified
```

Artinya ada network round-trip, tetapi body tidak dikirim ulang.

### 27.3 Pattern: Cache Miss / Updated Resource

Request:

```http
If-None-Match: "abc123"
```

Response:

```http
200 OK
ETag: "def456"
```

Artinya stored version tidak cocok; browser menerima body baru.

### 27.4 Pattern: No Validator

Response awal:

```http
Cache-Control: no-cache
```

Tapi tidak ada:

```http
ETag
Last-Modified
```

Maka browser tidak punya validator yang baik.

Saat harus revalidate, server mungkin perlu mengirim 200 full body.

---

## 28. API Design: Kapan Menggunakan ETag?

Gunakan ETag ketika:

- resource punya identity jelas;
- representation bisa berubah;
- response cukup besar sehingga 304 menghemat bandwidth;
- frontend sering reload/polling;
- Anda ingin optimistic concurrency;
- resource read-heavy;
- data bisa divalidasi lebih murah daripada dikirim ulang.

Tidak terlalu berguna ketika:

- response sangat kecil;
- data berubah hampir setiap request;
- endpoint non-deterministic;
- response personalized tetapi tidak ada version model;
- server butuh cost besar untuk menghitung ETag setara dengan generate response.

Namun hati-hati: ETag bisa dihitung dari domain version, bukan selalu hash full body.

Contoh domain ETag:

```text
caseId + rowVersion + representationVersion + locale
```

Misalnya:

```http
ETag: "case-123-v881-repr3-id-ID"
```

---

## 29. Hash Body vs Domain Version untuk ETag

Ada dua pendekatan umum.

### 29.1 Hash Body

```text
ETag = hash(serialized response body)
```

Kelebihan:

- akurat terhadap bytes;
- cocok untuk static asset;
- simple untuk file.

Kekurangan:

- perlu generate body dulu;
- mahal untuk response besar;
- serialization order bisa membuat ETag berubah tanpa perubahan semantic;
- compression dapat membingungkan jika tidak hati-hati.

### 29.2 Domain Version

```text
ETag = resource version / rowversion / updatedAt / event sequence
```

Kelebihan:

- murah;
- cocok untuk database-backed resource;
- bisa dipakai untuk optimistic concurrency.

Kekurangan:

- harus memasukkan semua faktor yang mengubah representation;
- harus memperhitungkan locale, permissions, included fields, tenant, representation version;
- bisa salah jika domain version tidak berubah padahal response berubah.

### 29.3 Practical Formula

Untuk API enterprise:

```text
ETag input =
  resource identity
  + domain version
  + representation schema version
  + projection/filter/include parameters
  + locale if response localized
  + tenant/authorization variant if response differs by viewer
```

---

## 30. Conditional Request dengan Query Parameters

Cache key biasanya memasukkan URL, termasuk query string.

```text
/api/products?page=1&sort=name
/api/products?sort=name&page=1
```

Secara semantic mungkin sama, tetapi secara raw URL bisa dianggap berbeda jika tidak dinormalisasi.

Practical rule:

- gunakan query parameter ordering konsisten;
- hindari parameter random jika ingin cache efektif;
- jangan tambahkan timestamp query seperti `?t=Date.now()` kecuali benar-benar ingin bust cache;
- pastikan ETag merepresentasikan variant query tersebut.

Contoh:

```http
GET /api/products?page=1&sort=name
ETag: "products-page1-sort-name-v44"
```

---

## 31. Cache Busting: Kapan Boleh, Kapan Buruk

Cache busting umum:

```text
/app.js?v=123
/app.abc123.js
/api/config?t=1718612123
```

### 31.1 Good Cache Busting

Fingerprint filename:

```text
/assets/app.abc123.js
```

Ini bagus karena URL berubah hanya saat content berubah.

### 31.2 Bad Cache Busting

Random timestamp per request:

```text
/api/products?t=1718612123
```

Ini buruk jika tidak perlu karena:

- menghancurkan cache;
- membuat CDN tidak efektif;
- meningkatkan server load;
- menyembunyikan masalah cache header yang salah.

### 31.3 Acceptable Emergency Cache Busting

Kadang `?v=buildId` pada config atau manifest bisa diterima.

Namun jangan jadikan default untuk semua API.

Rule:

```text
Cache busting harus deterministic dan berdasarkan versi, bukan waktu acak.
```

---

## 32. Frontend Runtime Config

Banyak aplikasi SPA punya runtime config:

```text
/config.json
/env.js
/runtime-config.json
```

Ini sering lebih mutable daripada static JS.

Jika config dicache terlalu lama, aplikasi bisa menunjuk API endpoint lama atau feature flag lama.

Recommended:

```http
Cache-Control: no-cache
ETag: "config-v42"
```

Untuk config yang tidak sensitif tetapi harus cepat update, revalidation adalah pilihan baik.

Jangan beri:

```http
Cache-Control: max-age=31536000, immutable
```

kecuali URL config juga difingerprint.

---

## 33. Service Worker Interaction

Service worker bisa mengintercept request sebelum browser HTTP cache normal terlihat seperti yang Anda harapkan.

Flow bisa menjadi:

```text
Page JS fetch
  -> service worker fetch event
    -> Cache API
    -> fetch(request)
      -> browser HTTP cache/network
```

Atau service worker langsung menyajikan response dari Cache API.

Bug umum:

- service worker menyajikan HTML lama;
- service worker menyajikan asset lama walau HTTP cache header sudah benar;
- runtime cache tidak menghormati `Cache-Control`;
- update service worker tidak langsung aktif;
- old app shell references deleted chunks.

Rule:

> Jika aplikasi memakai service worker, debugging HTTP cache harus memasukkan Cache API dan service worker lifecycle.

Di DevTools, cek:

- Application → Service Workers;
- Application → Cache Storage;
- Network → “from ServiceWorker”;
- update/skipWaiting/clientClaim behavior.

---

## 34. Security and Privacy Considerations

Caching bisa membocorkan data jika salah.

### 34.1 Personalized Response di Shared Cache

Bahaya:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=600

{"user":"Alice","balance":1000000}
```

Jika response ini disimpan CDN dan diberikan ke user lain, incident serius.

Untuk personalized response:

```http
Cache-Control: private, no-cache
```

atau:

```http
Cache-Control: no-store
```

tergantung sensitivity.

### 34.2 Sensitive Data in URL

URL bisa masuk ke:

- browser history;
- proxy logs;
- CDN logs;
- Referer header;
- analytics;
- cache key.

Jangan letakkan token/secrets di query string.

### 34.3 ETag Tracking

Secara historis, ETag dapat disalahgunakan untuk tracking jika server memberi identifier unik per user dan browser menyimpannya.

Modern browser privacy mechanism mengurangi beberapa risiko, tetapi prinsipnya tetap:

```text
Jangan gunakan cache validator sebagai user tracking identifier.
```

---

## 35. Decision Matrix: Header Strategy per Resource Type

| Resource type | Example | Suggested strategy | Reason |
|---|---|---|---|
| SPA HTML | `/index.html` | `Cache-Control: no-cache` + `ETag` | HTML adalah mutable pointer ke asset |
| Fingerprinted JS/CSS | `/assets/app.abc123.js` | `public, max-age=31536000, immutable` | URL berubah saat content berubah |
| Image with hash | `/assets/logo.991af0d.svg` | `public, max-age=31536000, immutable` | aman long cache |
| Runtime config | `/config.json` | `no-cache` + `ETag` | harus bisa update cepat |
| Public reference API | `/api/countries` | `public/private max-age` + `ETag` sesuai variasi | data jarang berubah |
| Personal API | `/api/me` | `private, no-cache` atau `no-store` | user-specific |
| Sensitive document | `/api/reports/secret` | `no-store` | jangan simpan |
| Polling endpoint | `/api/status` | short `max-age` atau `no-cache` + ETag | hemat bandwidth jika unchanged |
| Permission endpoint | `/api/permissions` | short/private/no-cache depending risk | stale permission berbahaya |

---

## 36. Practical Debugging Playbook

### 36.1 Symptom: User Masih Melihat UI Lama Setelah Deploy

Check:

1. HTML cache header.
2. CDN rule untuk HTML.
3. Service worker app shell cache.
4. Browser DevTools: apakah `index.html` 200 from disk cache?
5. Apakah HTML memakai `max-age` terlalu panjang?
6. Apakah CDN invalidation hanya untuk asset, bukan HTML?

Fix:

```http
Cache-Control: no-cache
ETag: "html-build-id"
```

Dan pastikan CDN tidak override.

### 36.2 Symptom: Chunk 404 Setelah Deploy

Check:

1. HTML lama menunjuk chunk lama?
2. Asset lama dihapus?
3. CDN purge terlalu agresif?
4. Build menghasilkan hash baru?
5. Service worker menyajikan manifest lama?

Fix:

- keep old assets;
- deploy atomically;
- cache HTML revalidatable;
- add chunk load error recovery.

### 36.3 Symptom: API Data Stale

Check:

1. Response `Cache-Control`.
2. `ETag` berubah ketika data berubah?
3. `Vary` benar?
4. Application data cache staleTime?
5. Service worker runtime cache?
6. CDN caching API tanpa auth awareness?

Fix:

- set endpoint-specific cache policy;
- correct validators;
- align HTTP cache with JS data cache;
- avoid accidental public caching for personalized responses.

### 36.4 Symptom: Banyak 200 Padahal Harusnya 304

Check:

1. Response awal punya `ETag`/`Last-Modified`?
2. Browser mengirim `If-None-Match`?
3. Server membandingkan validator dengan benar?
4. ETag berbeda antar node?
5. CDN strip header?
6. DevTools disable cache aktif?

Fix:

- stable ETag generation;
- preserve validators through proxy/CDN;
- configure server conditional GET support.

### 36.5 Symptom: Banyak 304 Tapi App Masih Terasa Lambat

304 menghemat bandwidth, bukan round-trip.

Check:

1. Resource seharusnya immutable?
2. `max-age` terlalu pendek?
3. Terlalu banyak small assets?
4. Reload behavior menyebabkan revalidation semua resource?
5. CDN edge jauh?
6. Critical path terlalu panjang?

Fix:

- fingerprint static assets;
- long cache immutable;
- reduce critical resource count;
- use preload/preconnect carefully;
- cache HTML with revalidation only.

---

## 37. Backend/Java Implementation Notes

Sebagai Java engineer, Anda akan sering mengendalikan header ini dari backend/framework/gateway.

### 37.1 Static Resources

Jika memakai Spring Boot/static resources/CDN, pastikan:

- hashed filenames;
- long cache for hashed assets;
- no long cache for HTML;
- ETag/Last-Modified tidak di-strip reverse proxy;
- compression tidak menghasilkan validator kacau.

### 37.2 Dynamic API ETag

Pseudo-code domain ETag:

```java
String etag = "\"case-" + caseId
    + "-v" + rowVersion
    + "-repr" + representationVersion
    + "-locale" + locale
    + "\"";
```

Response:

```http
ETag: "case-123-v881-repr2-locale-id-ID"
Cache-Control: private, no-cache
```

Conditional logic:

```text
if request If-None-Match matches current ETag:
    return 304 with relevant headers
else:
    return 200 with body + current ETag
```

### 37.3 Jangan Lupakan Authorization Variant

Jika representation berbeda berdasarkan user permission, ETag dari resource version saja bisa salah.

Contoh:

```text
User A melihat fields: id, status, confidentialNotes
User B melihat fields: id, status
```

Jika keduanya punya ETag sama, cache/application logic bisa kacau.

Include representation variant atau hindari shared caching.

---

## 38. Review Checklist untuk PR/API Design

Gunakan checklist ini saat review frontend/backend/API/CDN config.

### 38.1 Untuk HTML

- [ ] Apakah HTML tidak diberi long max-age?
- [ ] Apakah HTML punya `ETag` atau `Last-Modified`?
- [ ] Apakah CDN tidak memaksa HTML stale terlalu lama?
- [ ] Apakah deploy tidak menghapus asset lama terlalu cepat?

### 38.2 Untuk Static Assets

- [ ] Apakah filename difingerprint?
- [ ] Apakah content immutable untuk URL tersebut?
- [ ] Apakah header long cache aman?
- [ ] Apakah source map punya policy berbeda jika sensitif?

### 38.3 Untuk API

- [ ] Apakah endpoint personalized?
- [ ] Apakah response boleh disimpan browser?
- [ ] Apakah boleh disimpan CDN?
- [ ] Apakah data stale acceptable?
- [ ] Apakah ETag berubah saat representation berubah?
- [ ] Apakah `Vary` diperlukan?
- [ ] Apakah authorization/tenant/language mempengaruhi response?

### 38.4 Untuk Debugging

- [ ] Apakah DevTools disable cache aktif?
- [ ] Apakah status dari cache, 304, atau 200 network?
- [ ] Apakah request mengirim conditional headers?
- [ ] Apakah response membawa validator?
- [ ] Apakah service worker terlibat?
- [ ] Apakah CDN/proxy override header?

---

## 39. Anti-Patterns dan Penggantinya

### Anti-pattern 1: Semua Response `no-store`

Masalah:

- lambat;
- boros bandwidth;
- server/CDN load tinggi;
- kehilangan 304 optimization.

Pengganti:

- gunakan `no-store` hanya untuk data sensitif;
- gunakan `private, no-cache` untuk personalized revalidatable data;
- gunakan long immutable untuk fingerprinted assets.

### Anti-pattern 2: Semua Response `public, max-age=1d`

Masalah:

- personalized data bisa bocor;
- HTML stale;
- API stale;
- sulit deploy hotfix.

Pengganti:

- policy per resource type.

### Anti-pattern 3: Cache Busting dengan Timestamp Acak

Masalah:

- cache tidak pernah efektif;
- CDN miss terus;
- menyembunyikan desain header yang salah.

Pengganti:

- deterministic build/version hash.

### Anti-pattern 4: ETag dari Server Node Lokal

Masalah:

- berbeda antar node;
- 304 jarang terjadi;
- cache efficiency buruk.

Pengganti:

- content hash atau domain version stabil.

### Anti-pattern 5: Menghapus Old Assets Saat Deploy

Masalah:

- HTML lama reference chunk lama;
- blank screen.

Pengganti:

- retain old assets;
- atomic deployment;
- immutable hashed assets.

---

## 40. Latihan Mental Model

### Latihan 1: HTML dan Asset

Anda melihat response:

```http
GET /index.html
Cache-Control: public, max-age=86400
```

Dan:

```http
GET /assets/app.abc123.js
Cache-Control: public, max-age=31536000, immutable
```

Pertanyaan:

1. Apa yang salah?
2. Apa risiko deploy baru?
3. Header apa yang lebih tepat untuk HTML?

Jawaban yang diharapkan:

- HTML terlalu lama dicache;
- user bisa memakai HTML lama yang menunjuk asset lama;
- pakai `Cache-Control: no-cache` + validator untuk HTML.

### Latihan 2: API Personal

Response:

```http
GET /api/me
Cache-Control: public, max-age=600
ETag: "me-v1"
```

Pertanyaan:

1. Apa risikonya?
2. Apa header yang lebih aman?

Jawaban:

- data personal bisa masuk shared cache;
- gunakan `private, no-cache` atau `no-store` sesuai sensitivity.

### Latihan 3: ETag Tidak Berubah

Response awal:

```http
ETag: "profile"

{"name":"Alice"}
```

Response setelah update:

```http
ETag: "profile"

{"name":"Alice Smith"}
```

Pertanyaan:

Apa bug yang bisa terjadi?

Jawaban:

- client revalidate dengan `If-None-Match: "profile"`;
- server bisa salah mengembalikan 304;
- browser memakai body lama.

---

## 41. Key Takeaways

1. `304 Not Modified` berarti browser boleh memakai stored response lama.
2. `ETag` adalah validator versi representation; `Last-Modified` adalah validator berbasis waktu.
3. `If-None-Match` biasanya lebih presisi daripada `If-Modified-Since`.
4. `no-cache` berarti boleh simpan tetapi wajib revalidate; `no-store` berarti jangan simpan.
5. HTML SPA sebaiknya revalidatable, bukan immutable long-cache.
6. Fingerprinted static assets cocok untuk `max-age=31536000, immutable`.
7. Jangan hapus asset lama terlalu cepat setelah deploy.
8. API cache policy harus berbeda per endpoint, bukan global.
9. ETag harus berubah ketika representation berubah dan stabil ketika representation sama.
10. `Vary` menentukan variant cache; salah `Vary` bisa membuat cache bocor atau tidak efektif.
11. Service worker bisa mengubah semua asumsi HTTP cache.
12. Debugging cache harus melihat browser, service worker, CDN, proxy, dan server secara satu jalur.

---

## 42. Referensi Utama

- RFC 9111 — HTTP Caching.
- RFC 9110 — HTTP Semantics, terutama conditional requests dan validators.
- MDN — HTTP caching.
- MDN — HTTP conditional requests.
- MDN — `ETag`, `If-None-Match`, `Last-Modified`, `If-Modified-Since`, `Cache-Control`, dan `304 Not Modified`.
- web.dev — HTTP cache dan caching strategy untuk web performance.

---

## 43. Penutup

Di Part 014 kita belajar kapan response boleh disimpan dan kapan dianggap fresh. Di Part 015 kita belajar bagaimana browser dan server bernegosiasi saat response sudah stale tetapi mungkin masih valid.

Mental model paling penting:

```text
Fresh cache avoids network.
Revalidation avoids body download.
Immutable fingerprinted URLs avoid both until version changes.
```

Untuk frontend production system, caching strategy yang matang biasanya bukan satu header global, tetapi kombinasi:

```text
HTML: revalidate
Hashed assets: immutable long cache
Runtime config: revalidate
Public reference API: explicit freshness + validators
Personal API: private/no-cache or no-store
Sensitive data: no-store
```

Jika Anda bisa menjelaskan dan menerapkan matrix ini, Anda sudah jauh di atas rata-rata engineer yang hanya tahu “clear cache dulu”.

---

# Status Seri

```text
Part 015 selesai.
Seri belum selesai.
Lanjut ke Part 016: Redirects: 301, 302, 303, 307, 308 and Browser Behavior.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-014.md">⬅️ Part 014 — HTTP Caching Part 1: Browser Cache Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-016.md">Part 016 — Redirects: 301, 302, 303, 307, 308 and Browser Behavior ➡️</a>
</div>
