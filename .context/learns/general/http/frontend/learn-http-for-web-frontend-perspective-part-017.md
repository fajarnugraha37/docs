# learn-http-for-web-frontend-perspective-part-017.md

# Part 017 — Content Negotiation, Localization, Compression, and Variants

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi browser/frontend secara dalam, praktis, dan arsitektural.  
> Posisi dalam seri: setelah caching dan redirect, sebelum resource loading, transport HTTP/1.1-HTTP/3, TLS, dan security headers.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- request/response model;
- headers sebagai control plane;
- body, media type, encoding;
- fetch dan non-fetch request;
- CORS;
- cookies/auth;
- cache;
- redirect.

Sekarang kita masuk ke topik yang sering terlihat sederhana, tetapi sering menjadi sumber bug produksi yang sulit dilacak:

> **content negotiation, localization, compression, dan variants.**

Pertanyaan utama bagian ini:

> Ketika satu URL dapat menghasilkan lebih dari satu bentuk response, bagaimana browser, server, cache, CDN, dan frontend memastikan bahwa user menerima representasi yang benar?

Contoh:

```http
GET /products/123 HTTP/1.1
Host: api.example.com
Accept: application/json
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
Accept-Encoding: gzip, br, zstd
```

Server mungkin membalas:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Language: id-ID
Content-Encoding: br
Vary: Accept, Accept-Language, Accept-Encoding
Cache-Control: public, max-age=300

...
```

Secara konseptual, URL-nya sama:

```text
/products/123
```

Tetapi representasinya bisa berbeda berdasarkan:

- media type yang diminta;
- bahasa user;
- encoding/compression yang didukung;
- device/client hints;
- authentication state;
- origin/CORS policy;
- A/B experiment;
- CDN routing;
- server feature flag.

Inilah dunia **variants**.

---

## 1. Mental Model Utama: Resource vs Representation vs Variant

HTTP tidak menganggap response body sebagai “resource itu sendiri”. HTTP membedakan:

| Konsep | Makna |
|---|---|
| Resource | sesuatu yang diidentifikasi oleh URI/URL |
| Representation | bentuk data yang dikirim untuk menggambarkan resource pada waktu tertentu |
| Variant | salah satu representation yang dipilih berdasarkan dimensi tertentu |

Contoh resource:

```text
https://example.com/docs/getting-started
```

Resource ini dapat punya banyak representation:

```text
HTML bahasa Inggris
HTML bahasa Indonesia
JSON metadata
PDF
HTML terkompresi gzip
HTML terkompresi br
HTML mobile-optimized
HTML desktop-optimized
```

Frontend sering berpikir:

> “URL ini mengembalikan data X.”

HTTP lebih presisi:

> “URL ini mengidentifikasi resource. Server memilih representation tertentu berdasarkan request metadata dan server policy.”

Itu perbedaan kecil yang efeknya besar.

---

## 2. Kenapa Content Negotiation Penting untuk Frontend Engineer

Sebagai frontend engineer, Anda biasanya tidak menulis server negotiation logic setiap hari. Tapi Anda akan terkena dampaknya.

Bug yang sering muncul:

1. User bahasa Indonesia menerima cache halaman bahasa Inggris.
2. API mengembalikan HTML error page, tetapi frontend memanggil `response.json()`.
3. CDN menyimpan response gzip lalu mengirim ke client yang tidak mendukung gzip.
4. Response berbeda karena `Accept` header berbeda antara browser navigation dan `fetch()`.
5. Image optimization CDN mengembalikan WebP/AVIF ke browser tertentu, tetapi cache key salah.
6. CORS response salah karena `Vary: Origin` tidak dipasang.
7. Personalized API response ter-cache sebagai public variant.
8. `Accept-Language` dipakai sebagai identitas user dan menyebabkan cache fragmentation besar.
9. API versioning melalui media type tidak konsisten.
10. Backend menganggap `Content-Encoding` sama dengan `Content-Type`.

Topik ini berada di persimpangan:

```text
HTTP semantics
browser defaults
CDN cache key
localization strategy
API contract
compression layer
security/privacy
performance
```

---

## 3. Content Negotiation: Definisi Praktis

**Content negotiation** adalah mekanisme ketika client dan server bekerja sama untuk memilih representation terbaik dari resource yang sama.

Ada dua model besar:

1. **Server-driven negotiation**  
   Client mengirim preferensi lewat header, server memilih response.

2. **Client-driven negotiation**  
   Server memberi pilihan, client memilih URL/representation berikutnya.

Dalam web modern, server-driven negotiation paling sering terlihat melalui header seperti:

```http
Accept: application/json
Accept-Language: id-ID,id;q=0.9,en;q=0.8
Accept-Encoding: br, gzip, deflate
```

Server kemudian membalas dengan metadata yang menjelaskan keputusan:

```http
Content-Type: application/json; charset=utf-8
Content-Language: id-ID
Content-Encoding: br
Vary: Accept, Accept-Language, Accept-Encoding
```

---

## 4. Empat Header Negotiation yang Paling Penting

Untuk frontend/browser, empat header ini sangat penting:

| Request Header | Server Memilih | Response Header Terkait |
|---|---|---|
| `Accept` | media type | `Content-Type` |
| `Accept-Language` | bahasa/lokal | `Content-Language` |
| `Accept-Encoding` | compression/content coding | `Content-Encoding` |
| Client hints seperti `Sec-CH-*` | device/browser variant | biasanya `Vary` + response berbeda |

Untuk seri ini, kita fokus dulu ke tiga klasik:

```text
Accept
Accept-Language
Accept-Encoding
```

Lalu kita bahas `Vary`, client hints, dan risiko variant explosion.

---

# SECTION A — `Accept` dan `Content-Type`

---

## 5. `Accept`: “Saya Bisa Menerima Format Ini”

Header `Accept` adalah request header yang memberi tahu server media type apa yang dapat dipahami client.

Contoh:

```http
Accept: application/json
```

Artinya:

> Client lebih ingin response dalam bentuk JSON.

Contoh lain:

```http
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8
```

Header seperti ini sering muncul pada browser navigation, bukan pada API fetch sederhana.

### 5.1. `Accept` Tidak Sama dengan `Content-Type`

Ini sangat penting.

| Header | Arah | Arti |
|---|---|---|
| `Accept` | request | format response yang client bersedia terima |
| `Content-Type` | request/response | format body yang benar-benar dikirim |

Contoh request JSON:

```http
POST /api/orders HTTP/1.1
Content-Type: application/json
Accept: application/json

{"sku":"ABC","quantity":2}
```

Maknanya:

```text
Content-Type: body request ini JSON.
Accept: response yang saya harapkan JSON.
```

Banyak engineer mencampur keduanya.

Salah:

```http
GET /api/products HTTP/1.1
Content-Type: application/json
```

Untuk GET tanpa body, `Content-Type` biasanya tidak relevan. Yang relevan adalah:

```http
Accept: application/json
```

---

## 6. Browser `Accept` Header Tidak Selalu Sama

Browser mengirim `Accept` berbeda tergantung destination request.

Contoh konseptual:

| Request Type | Contoh `Accept` |
|---|---|
| Navigation HTML | `text/html,application/xhtml+xml,...` |
| Image | `image/avif,image/webp,image/*,*/*` |
| CSS | `text/css,*/*;q=0.1` |
| Script | `*/*` atau variasi browser |
| Fetch API default | sering `*/*` kecuali di-set manual |

Akibatnya, endpoint yang sama dapat berperilaku berbeda ketika dipanggil sebagai:

```text
browser address bar
fetch()
<img src="...">
<script src="...">
iframe
curl
Postman
```

Ini alasan mengapa:

> “Di browser address bar berhasil, tapi di `fetch()` gagal”

atau:

> “Di Postman dapat JSON, di browser dapat HTML”

bisa terjadi.

---

## 7. `q` Factor: Preferensi, Bukan Perintah Mutlak

Header negotiation bisa memakai quality value atau `q` factor.

Contoh:

```http
Accept: application/json;q=1.0, text/html;q=0.8, */*;q=0.1
```

Makna:

```text
Saya paling prefer JSON.
Saya masih bisa menerima HTML.
Saya bisa menerima apa pun sebagai fallback, tetapi prioritas rendah.
```

Nilai `q` berkisar dari 0 sampai 1.

Contoh:

```http
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
```

Makna:

```text
Prefer id-ID.
Kalau tidak ada, id.
Kalau tidak ada, en-US.
Kalau tidak ada, en.
```

Mental model:

```text
Accept-* header = preference vector
server = selector
response headers = selected variant metadata
Vary = cache dimension declaration
```

---

## 8. API Design: Haruskah API Mengandalkan `Accept`?

Untuk API internal/frontend, ada dua pendekatan.

### 8.1. Explicit API Path

Contoh:

```text
/api/products/123
/api/products/123.json
```

Atau API memang selalu JSON:

```http
Content-Type: application/json
```

Keuntungannya:

- sederhana;
- mudah di-debug;
- mudah untuk frontend;
- cache key lebih jelas;
- tidak tergantung variasi `Accept` browser.

Kelemahannya:

- kurang “pure REST”; 
- jika ingin multi-representation, perlu URL berbeda atau parameter.

### 8.2. Media Type Negotiation

Contoh:

```http
Accept: application/vnd.example.product+json;version=2
```

Keuntungannya:

- representasi bisa dinegosiasikan lewat HTTP;
- cocok untuk API platform tertentu;
- bisa dipakai untuk versioning media type.

Kelemahannya:

- lebih sulit di-debug;
- frontend harus konsisten set header;
- CDN/cache perlu `Vary: Accept`;
- tooling kadang kurang nyaman;
- error behavior sering tidak konsisten.

Untuk kebanyakan SPA/BFF/API enterprise, aturan pragmatis:

> Gunakan JSON contract eksplisit dan konsisten. Jangan membuat frontend bergantung pada negotiation kompleks kecuali ada kebutuhan nyata.

---

## 9. Anti-Pattern: API Mengembalikan HTML Error Page

Kasus umum:

```ts
const res = await fetch('/api/user');
const data = await res.json();
```

Lalu error:

```text
SyntaxError: Unexpected token '<', "<!doctype ..." is not valid JSON
```

Biasanya server mengembalikan:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: text/html

<!doctype html>...
```

Masalahnya bukan hanya “JSON parse gagal”. Masalah contract:

```text
Frontend mengharapkan JSON.
Server mengirim HTML.
Error handler frontend tidak memeriksa Content-Type.
```

Client yang defensif:

```ts
async function parseResponse(res: Response) {
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return await res.json();
  }

  const text = await res.text();
  return {
    _nonJson: true,
    status: res.status,
    contentType,
    bodyPreview: text.slice(0, 500),
  };
}
```

Top 1% habit:

> Jangan menganggap response body sesuai harapan hanya karena URL terlihat seperti API.

---

# SECTION B — `Accept-Language`, Localization, dan Cache

---

## 10. `Accept-Language`: Preferensi Bahasa Browser

`Accept-Language` adalah request header yang memberi tahu server bahasa/lokal yang disukai user agent.

Contoh:

```http
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
```

Server bisa memilih response bahasa Indonesia dan membalas:

```http
Content-Language: id-ID
```

Tetapi ini bukan identitas final user.

`Accept-Language` adalah sinyal preferensi, bukan sumber kebenaran mutlak.

---

## 11. Masalah Besar: `Accept-Language` Bisa Membuat Cache Meledak

Bayangkan response:

```http
GET /docs/getting-started
Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
```

Server balas:

```http
Content-Language: id-ID
Vary: Accept-Language
Cache-Control: public, max-age=3600
```

Cache sekarang harus membedakan response berdasarkan `Accept-Language`.

Masalahnya:

```text
Accept-Language user A: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7
Accept-Language user B: id,en-US;q=0.9,en;q=0.8
Accept-Language user C: id-ID,en;q=0.5
Accept-Language user D: en-US,en;q=0.9,id;q=0.3
```

Secara bisnis mungkin hanya ada dua bahasa:

```text
id
en
```

Tetapi cache melihat banyak variasi header.

Ini disebut **variant explosion**.

---

## 12. Strategy: Jangan Selalu Pakai `Accept-Language` untuk UI Locale

Ada beberapa strategi localization.

### 12.1. URL-Based Locale

Contoh:

```text
/id/docs/getting-started
/en/docs/getting-started
```

Keuntungan:

- cache key jelas;
- URL shareable;
- SEO lebih baik untuk public content;
- user dapat eksplisit memilih bahasa;
- tidak perlu `Vary: Accept-Language` untuk konten final.

Kelemahan:

- routing lebih kompleks;
- perlu redirect awal atau locale selector.

### 12.2. Subdomain-Based Locale

Contoh:

```text
id.example.com/docs/getting-started
en.example.com/docs/getting-started
```

Keuntungan:

- isolasi jelas;
- cocok untuk site besar.

Kelemahan:

- cookie/domain complexity;
- deployment dan SEO lebih kompleks.

### 12.3. Cookie/User Profile Locale

Contoh:

```http
Cookie: locale=id-ID
```

Keuntungan:

- personalized experience;
- user preference eksplisit.

Kelemahan:

- response mungkin private;
- cache harus hati-hati;
- SSR/CDN caching lebih kompleks.

### 12.4. `Accept-Language` sebagai Initial Guess

Strategi paling sehat untuk banyak aplikasi:

```text
1. Pertama kali user datang, gunakan Accept-Language sebagai tebakan.
2. Setelah user memilih locale, simpan pilihan eksplisit.
3. Gunakan URL/profile/cookie sebagai sumber kebenaran berikutnya.
```

Mental model:

```text
Accept-Language = hint
user setting = preference
URL = shareable contract
Content-Language = actual selected representation
```

---

## 13. Localization pada API: Terjemahkan di Mana?

Ada dua pendekatan.

### 13.1. API Mengembalikan Message Sudah Diterjemahkan

Contoh:

```json
{
  "errorCode": "ORDER_LIMIT_EXCEEDED",
  "message": "Jumlah pesanan melebihi batas."
}
```

Keuntungan:

- frontend sederhana;
- backend mengontrol message;
- cocok untuk email/PDF/server-generated content.

Kelemahan:

- frontend tidak fleksibel;
- cache bervariasi berdasarkan bahasa;
- testing lebih kompleks;
- pesan backend bisa tidak konsisten dengan UI copy.

### 13.2. API Mengembalikan Code, Frontend Menerjemahkan

Contoh:

```json
{
  "errorCode": "ORDER_LIMIT_EXCEEDED",
  "messageParams": {
    "limit": 10
  }
}
```

Frontend:

```ts
translate('errors.ORDER_LIMIT_EXCEEDED', { limit: 10 })
```

Keuntungan:

- konsisten dengan i18n frontend;
- response tidak perlu vary by language;
- lebih cache-friendly;
- UI copy bisa dikelola tim frontend/product.

Kelemahan:

- butuh mapping yang disiplin;
- error baru perlu translation entry;
- tidak semua message cocok diterjemahkan di frontend.

Rule of thumb:

| Jenis Response | Biasanya Lebih Baik |
|---|---|
| UI validation error | code + params, translate frontend |
| Legal/server document | server translated |
| Email content | server translated |
| Public CMS page | URL locale atau server render per locale |
| API domain object | jangan translate field domain kecuali memang content localized |
| Audit/log | stable code + raw technical context |

---

## 14. `Content-Language`: Bahasa Representation, Bukan Bahasa User

`Content-Language` menjelaskan bahasa representation yang dikirim.

Contoh:

```http
Content-Language: id-ID
```

Artinya:

> Response body ini ditujukan/ditulis dalam bahasa Indonesia Indonesia.

Ini berbeda dari:

```http
Accept-Language: id-ID,id;q=0.9
```

`Accept-Language` adalah preferensi request.  
`Content-Language` adalah metadata response.

---

# SECTION C — `Accept-Encoding`, `Content-Encoding`, dan Compression

---

## 15. Compression: Mengurangi Bytes, Bukan Mengubah Media Type

Compression di HTTP umumnya dinegosiasikan dengan:

```http
Accept-Encoding: gzip, br, zstd
```

Server memilih salah satu dan membalas:

```http
Content-Encoding: br
Content-Type: application/json; charset=utf-8
```

Makna:

```text
Representasi aslinya JSON.
JSON tersebut dikompresi dengan Brotli.
Client harus decode br untuk mendapatkan JSON.
```

Jadi:

```text
Content-Type = format asli setelah decode
Content-Encoding = transformasi encoding/compression yang diterapkan
```

Salah mental model:

```text
Content-Encoding: gzip berarti file-nya bertipe gzip.
```

Lebih tepat:

```text
Body dikirim dalam bentuk terkompresi gzip, tetapi representation media type tetap sesuai Content-Type.
```

---

## 16. Common Content Codings

| Coding | Umum Dipakai Untuk | Catatan |
|---|---|---|
| `gzip` | hampir semua text asset/API | dukungan sangat luas |
| `br` | static assets, HTML, JSON | sangat efektif, terutama static compression |
| `deflate` | legacy | lebih jarang diprioritaskan |
| `zstd` | makin relevan pada web modern | dukungan bergantung browser/server/CDN |
| `identity` | no encoding | tanpa compression |

Untuk frontend, Anda biasanya tidak mengatur `Accept-Encoding` secara manual di browser. Browser mengaturnya.

JavaScript juga tidak dapat sembarang mengatur beberapa header tertentu karena browser melindungi header yang dikontrol user agent.

---

## 17. Compression dan DevTools: Ukuran Mana yang Anda Lihat?

DevTools biasanya dapat menampilkan beberapa ukuran:

```text
transferred size
resource size / decoded size
encoded size
```

Perbedaan:

| Ukuran | Makna |
|---|---|
| Transferred | bytes yang benar-benar lewat network, setelah compression dan header overhead tertentu |
| Encoded | ukuran body ter-encoding/compressed |
| Decoded/resource | ukuran body setelah decompression |

Contoh:

```text
main.js decoded: 800 KB
main.js transferred: 180 KB
```

Artinya:

```text
Bundle asli 800 KB.
Yang lewat network setelah compression 180 KB.
Browser tetap harus parse/compile 800 KB JavaScript.
```

Pelajaran penting:

> Compression membantu network transfer, tetapi tidak menghapus biaya parse, compile, memory, dan execution di browser.

Ini sangat penting untuk JavaScript bundle.

---

## 18. Apa yang Cocok Dikompresi?

Biasanya cocok:

```text
HTML
CSS
JavaScript
JSON
SVG
text/plain
XML
WASM kadang tergantung delivery
```

Biasanya tidak perlu/kurang berguna:

```text
JPEG
PNG
WebP
AVIF
MP4
PDF yang sudah compressed
ZIP
GZIP file
```

Karena format tersebut biasanya sudah compressed.

Anti-pattern:

```text
compressing already-compressed media
```

Efeknya:

- CPU server/CDN terbuang;
- latency bisa naik;
- ukuran kadang hampir tidak berubah;
- pada kasus buruk bisa lebih besar.

---

## 19. Static Compression vs Dynamic Compression

### 19.1. Dynamic Compression

Server menerima request, menghasilkan response, lalu mengompresi on the fly.

Cocok untuk:

```text
HTML dinamis
JSON API
response personalized
```

Risiko:

```text
CPU overhead
latency tambahan
compression level terlalu tinggi
security side-channel untuk response sensitif
```

### 19.2. Static Precompression

Build pipeline menghasilkan file:

```text
app.js
app.js.gz
app.js.br
```

CDN/server memilih file sesuai `Accept-Encoding`.

Cocok untuk:

```text
JS bundle
CSS
static HTML
SVG
font tertentu
```

Keuntungan:

- compression level bisa tinggi;
- tidak membebani runtime server;
- bagus untuk immutable hashed assets.

Untuk frontend static assets, ini sering ideal.

---

## 20. Compression dan Cache Key

Karena response berbeda berdasarkan `Accept-Encoding`, response harus membawa:

```http
Vary: Accept-Encoding
```

Dalam praktik, banyak cache/CDN menangani compression sebagai fitur khusus dan menormalkan variasi encoding.

Tetapi secara prinsip:

```text
Client A mendukung br.
Client B hanya mendukung gzip.
Cache tidak boleh memberi br ke client yang tidak mendukung br.
```

Tanpa variant handling yang benar, browser bisa gagal decode.

---

## 21. Compression Security: Jangan Abaikan Side Channel

Compression bisa membocorkan informasi melalui ukuran response ketika attacker bisa:

1. mengontrol sebagian input response;
2. mengamati ukuran response compressed;
3. menebak secret yang berada dekat input tersebut.

Ini keluarga risiko seperti CRIME/BREACH-style attacks.

Untuk frontend/backend design, prinsip praktis:

```text
Jangan menaruh secret sensitif dan attacker-controlled reflection dalam response compressed yang sama tanpa mitigasi.
```

Contoh berisiko:

```text
HTML page berisi CSRF token secret
+ halaman juga merefleksikan query parameter attacker
+ response compressed
```

Mitigasi tergantung konteks:

- jangan refleksikan input attacker;
- gunakan CSRF token masking;
- pisahkan secret dari response yang dapat dimanipulasi;
- disable compression untuk response sangat sensitif tertentu;
- gunakan security framework modern.

---

# SECTION D — `Vary`: Header Kecil dengan Dampak Besar

---

## 22. Apa Itu `Vary`?

`Vary` adalah response header yang memberi tahu cache:

> Response ini dipilih berdasarkan request header tertentu. Jika request berikutnya punya nilai header berbeda, jangan asal reuse response yang sama.

Contoh:

```http
Vary: Accept-Encoding
```

Artinya:

```text
Response gzip/br/identity bisa berbeda.
Cache harus mempertimbangkan Accept-Encoding saat reuse.
```

Contoh lain:

```http
Vary: Accept-Language
```

Artinya:

```text
Response bahasa berbeda bergantung Accept-Language.
```

Contoh CORS:

```http
Vary: Origin
```

Artinya:

```text
Response CORS headers berbeda berdasarkan Origin.
Cache harus mempertimbangkan Origin.
```

---

## 23. `Vary` Adalah Kontrak Cache Key

Simplifikasi:

```text
cache key = URL + selected request header dimensions declared by Vary
```

Jika response:

```http
Vary: Accept-Language, Accept-Encoding
```

Maka cache tidak hanya melihat:

```text
GET /docs
```

Tetapi juga:

```text
GET /docs
Accept-Language: ...
Accept-Encoding: ...
```

Ini benar secara correctness, tapi bisa buruk untuk hit rate.

---

## 24. `Vary` yang Kurang: Bug Correctness

Contoh server:

```http
GET /home
Accept-Language: id-ID
```

Response:

```http
HTTP/1.1 200 OK
Content-Language: id-ID
Cache-Control: public, max-age=3600

Beranda
```

Tetapi lupa:

```http
Vary: Accept-Language
```

Cache menyimpan `/home`.

User lain:

```http
GET /home
Accept-Language: en-US
```

Cache bisa memberi:

```text
Beranda
```

Padahal user minta English.

Ini **under-varying**.

Akibat:

```text
wrong content served
wrong language
wrong CORS header
wrong compressed variant
wrong device variant
possible data exposure
```

---

## 25. `Vary` yang Berlebihan: Bug Performance

Contoh:

```http
Vary: User-Agent
```

Masalah:

```text
User-Agent sangat bervariasi.
Cache hit rate jatuh.
CDN menyimpan terlalu banyak variant.
Operational cost naik.
```

Atau:

```http
Vary: *
```

Ini praktis membuat response tidak reusable oleh shared cache.

Ini **over-varying**.

Akibat:

```text
cache fragmentation
low hit ratio
higher origin load
slower response
harder debugging
```

Top 1% habit:

> Setiap `Vary` harus bisa dijelaskan sebagai dimensi representation yang benar-benar diperlukan.

---

## 26. `Vary: Origin` untuk CORS

CORS sering perlu `Vary: Origin`.

Misal server mengizinkan origin tertentu secara dinamis:

```http
Origin: https://app-a.example.com
```

Response:

```http
Access-Control-Allow-Origin: https://app-a.example.com
Vary: Origin
```

Request lain:

```http
Origin: https://app-b.example.com
```

Response:

```http
Access-Control-Allow-Origin: https://app-b.example.com
Vary: Origin
```

Tanpa `Vary: Origin`, shared cache/CDN dapat menyimpan response untuk origin A lalu memberikannya ke origin B.

Efeknya bisa:

- CORS false negative;
- CORS false positive;
- data exposure risk jika digabung dengan cache policy buruk;
- debugging membingungkan karena kadang berhasil kadang gagal.

---

## 27. `Vary` Tidak Menggantikan `Cache-Control`

Kesalahan umum:

> “Sudah ada `Vary`, berarti aman.”

Tidak.

`Vary` menjelaskan **dimensi variasi**.

`Cache-Control` menjelaskan **apakah dan bagaimana response boleh disimpan**.

Contoh personalized response:

```http
GET /api/me
Authorization: Bearer ...
```

Response:

```http
Cache-Control: private, no-store
```

Jangan mengandalkan:

```http
Vary: Authorization
```

Karena:

- shared caches biasanya memang berhati-hati terhadap `Authorization`, tapi jangan bergantung pada asumsi proxy tertentu;
- data sensitif seharusnya tidak masuk shared cache;
- browser/local cache pun harus dipikirkan sesuai sensitivitas.

Untuk data user sensitif:

```http
Cache-Control: no-store
```

sering lebih defensible.

---

# SECTION E — Variants dalam Arsitektur Frontend Modern

---

## 28. Apa Itu Variant?

Variant adalah representasi berbeda untuk resource yang sama.

Dimensi variant umum:

```text
language
media type
encoding
device capability
auth state
A/B experiment
region
currency
theme
image format
image size
DPR
viewport width
feature flag
```

Tidak semua dimensi variant harus dikendalikan oleh HTTP negotiation. Banyak yang lebih baik dibuat eksplisit dalam URL atau application state.

---

## 29. Variant yang Baik vs Buruk

### 29.1. Variant Baik

Contoh static asset:

```text
/app.abc123.js
/app.abc123.js.br
/app.abc123.js.gz
```

Dimensi:

```text
Accept-Encoding
```

Bagus karena:

- dimensi jelas;
- CDN bisa handle;
- representation set kecil;
- cache hit tinggi.

### 29.2. Variant Berbahaya

Contoh:

```http
Vary: User-Agent, Accept-Language, Cookie, Origin, Accept, X-Experiment, X-Theme
```

Masalah:

```text
cache key explosion
inconsistent behavior
hard to reproduce bugs
privacy leakage
operational complexity
```

---

## 30. Variant Explosion

Variant explosion terjadi ketika satu URL menghasilkan terlalu banyak kombinasi response.

Misal dimensi:

```text
language: 5
encoding: 3
device: 4
experiment: 6
currency: 10
auth state: 3
```

Total kemungkinan:

```text
5 × 3 × 4 × 6 × 10 × 3 = 10,800 variants
```

Untuk satu URL.

Efek:

- CDN hit ratio turun;
- origin load naik;
- cache invalidation rumit;
- observability memburuk;
- debugging susah;
- user bisa mendapat variant salah.

Arsitektur yang baik mengurangi dimensi implicit.

---

## 31. Strategi Mengelola Variants

### 31.1. Buat Variant Penting Eksplisit di URL

Contoh:

```text
/en/products/123
/id/products/123
```

Atau:

```text
/image/hero?w=1200&format=webp
```

Keuntungan:

```text
cache key obvious
shareable
observable
reproducible
```

### 31.2. Gunakan Header Negotiation untuk Dimensi Teknis

Cocok:

```text
Accept-Encoding
possibly Accept for true multi-format API
some client hints for images when CDN configured carefully
```

### 31.3. Gunakan User Profile untuk Personal Preference

Cocok:

```text
theme
locale after login
currency preference
accessibility preference
```

Tapi hati-hati cache:

```http
Cache-Control: private
```

atau jangan cache shared.

### 31.4. Jangan Pakai Cookie sebagai Variant Serampangan

`Vary: Cookie` sering menghancurkan cache.

Karena cookie header bisa berisi banyak hal:

```text
session_id
analytics_id
experiment_id
csrf_token
locale
theme
tracking data
```

Kalau cache bervariasi berdasarkan seluruh cookie string, hit ratio bisa jatuh drastis.

Lebih baik:

- extract hanya cookie yang relevan di edge;
- normalize cache key;
- pindahkan variant ke URL;
- pisahkan static/public content dari personalized content.

---

# SECTION F — Client Hints dan Device-Aware Variants

---

## 32. Client Hints Overview

Client hints adalah mekanisme browser mengirim informasi tertentu tentang client/device/browser capability melalui header seperti:

```http
Sec-CH-UA
Sec-CH-UA-Mobile
Sec-CH-UA-Platform
DPR
Width
Viewport-Width
```

Tidak semua client hint dikirim begitu saja. Banyak yang perlu server opt-in melalui header seperti:

```http
Accept-CH: DPR, Width, Viewport-Width
```

Konteks utama:

```text
image optimization
responsive delivery
browser capability detection
privacy-aware replacement for User-Agent sniffing
```

---

## 33. Client Hints untuk Image Optimization

Contoh flow konseptual:

```http
GET /image/hero HTTP/1.1
```

Server response:

```http
Accept-CH: DPR, Width
```

Request berikutnya mungkin membawa:

```http
DPR: 2
Width: 800
```

Server/CDN memilih image variant:

```http
Content-Type: image/avif
Vary: Accept, DPR, Width
```

Manfaat:

```text
browser menerima image yang sesuai capability dan ukuran
bytes lebih kecil
LCP bisa membaik
```

Risiko:

```text
Vary terlalu banyak
cache fragmentation
privacy budget/restrictions
browser support differences
edge configuration complexity
```

Untuk frontend praktis, sering lebih eksplisit dan portable memakai:

```html
<img
  src="/img/hero-800.webp"
  srcset="/img/hero-400.webp 400w, /img/hero-800.webp 800w, /img/hero-1200.webp 1200w"
  sizes="(max-width: 768px) 100vw, 768px"
  alt="..."
/>
```

Atau memakai image CDN dengan URL parameters:

```text
https://cdn.example.com/hero.jpg?w=800&format=webp
```

---

## 34. User-Agent Sniffing: Hindari Jika Bisa

Dulu banyak server melakukan:

```text
if User-Agent contains iPhone -> send mobile page
else -> send desktop page
```

Lalu response:

```http
Vary: User-Agent
```

Masalah:

- User-Agent panjang dan tidak stabil;
- spoofable;
- cache fragmentation;
- browser privacy changes;
- maintenance buruk.

Alternatif:

```text
responsive design
feature detection
progressive enhancement
client hints jika perlu
explicit URL variants untuk media optimization
```

---

# SECTION G — API Versioning via Media Type

---

## 35. Media Type Versioning

Beberapa API menggunakan `Accept` untuk versioning:

```http
Accept: application/vnd.company.orders.v2+json
```

Atau:

```http
Accept: application/vnd.company+json; version=2
```

Server membalas:

```http
Content-Type: application/vnd.company.orders.v2+json
Vary: Accept
```

Keuntungan:

- versioning berada di representation layer;
- URL tetap stabil;
- cocok untuk beberapa API platform.

Kelemahan untuk frontend app biasa:

- lebih sulit dilihat di browser address bar;
- debugging butuh inspect headers;
- CDN harus vary by Accept;
- generated client harus disiplin;
- reverse proxy/gateway harus preserve header;
- fallback error bisa ambigu.

Alternatif:

```text
/api/v1/orders
/api/v2/orders
```

Atau:

```text
/graphql
```

dengan schema evolution discipline.

Pragmatic rule:

> Untuk frontend application API yang dikendalikan satu organisasi, URL/path versioning atau BFF contract sering lebih mudah dioperasikan daripada media type versioning.

Tetapi untuk public platform API, media type versioning bisa masuk akal jika tooling dan governance kuat.

---

# SECTION H — Localization, Currency, Region, dan Personalization

---

## 36. Jangan Campur Locale, Language, Region, dan Currency

Ini sering kacau.

| Konsep | Contoh | Makna |
|---|---|---|
| Language | `id`, `en` | bahasa |
| Locale | `id-ID`, `en-US` | bahasa + region/culture |
| Region | `ID`, `US`, `SG` | lokasi/market/regulatory region |
| Currency | `IDR`, `USD`, `SGD` | mata uang |
| Time zone | `Asia/Jakarta` | zona waktu |

User bisa:

```text
berbahasa Inggris
tinggal di Indonesia
melihat harga IDR
pakai timezone Asia/Jakarta
```

Jangan mengasumsikan:

```text
Accept-Language: en-US berarti currency USD
```

Atau:

```text
IP Indonesia berarti bahasa Indonesia
```

Untuk aplikasi serius, pisahkan field:

```json
{
  "locale": "en-US",
  "region": "ID",
  "currency": "IDR",
  "timeZone": "Asia/Jakarta"
}
```

---

## 37. Regional Variant Bisa Punya Implikasi Legal

Di domain regulated/enterprise, region bukan hanya tampilan.

Contoh:

```text
terms and conditions
privacy notice
available products
compliance wording
tax rules
retention policy
consent behavior
```

Maka jangan menyembunyikan regional behavior hanya dalam `Accept-Language`.

Lebih defensible:

```text
explicit region selection
server-side entitlement/regulatory check
clear audit trail
cache-safe URL or private response
```

---

# SECTION I — Failure Models dan Debugging

---

## 38. Failure Model: Wrong Variant Served

Gejala:

```text
User menerima bahasa salah.
Image salah format.
API mengembalikan HTML.
Response compressed tidak bisa dibaca.
CORS kadang berhasil kadang gagal.
```

Checklist:

1. Apa URL-nya?
2. Apa request header yang relevan?
3. Apa response `Content-Type`?
4. Apa response `Content-Language`?
5. Apa response `Content-Encoding`?
6. Apa response `Vary`?
7. Apakah response cacheable?
8. Apakah CDN menormalisasi cache key?
9. Apakah request lewat service worker?
10. Apakah request navigation/fetch/image/script?

DevTools fields yang diperiksa:

```text
Request Headers
Response Headers
Status Code
Size / Transferred
Initiator
Timing
Preview / Response
```

---

## 39. Failure Model: JSON Parse Error karena Negotiation Salah

Symptom:

```text
Unexpected token '<'
```

Investigasi:

```text
Response tab: apakah HTML?
Content-Type: text/html?
Status: 302? 401? 500?
Redirected to login page?
Accept header apa?
Backend fallback error page aktif?
Gateway mengubah response?
```

Fix:

- frontend periksa `Content-Type` sebelum parse;
- backend API selalu mengembalikan JSON error envelope;
- gateway jangan mengganti API error dengan HTML page;
- auth failure untuk API jangan redirect ke HTML login page;
- pisahkan `/api/*` dari SPA fallback route.

---

## 40. Failure Model: Cache Mengirim Bahasa Salah

Symptom:

```text
User A melihat English, user B melihat Indonesian, kadang terbalik.
```

Kemungkinan:

```text
missing Vary: Accept-Language
CDN ignores Vary
locale based on cookie but cache public
URL tidak mengandung locale
Accept-Language terlalu granular
```

Fix options:

- gunakan URL locale;
- tambahkan `Vary: Accept-Language` jika memang negotiation;
- normalize language di edge;
- jadikan response private jika bergantung pada user preference;
- pisahkan public localized content dan personalized content.

---

## 41. Failure Model: CDN Cache Fragmentation

Symptom:

```text
cache hit ratio rendah
origin load tinggi
p95 latency naik
CDN storage besar
```

Kemungkinan:

```text
Vary: User-Agent
Vary: Cookie
Vary: Accept-Language dengan nilai granular
experiment header masuk cache key
Origin masuk cache key untuk semua endpoint
query parameter tidak dinormalisasi
```

Fix:

- audit cache key;
- batasi `Vary`;
- normalize headers;
- pindahkan variant ke path/query eksplisit;
- hilangkan tracking cookies dari cache key;
- gunakan CDN rules yang jelas;
- ukur hit ratio per route.

---

## 42. Failure Model: Compression Tidak Efektif

Symptom:

```text
large transferred size
slow download
LCP buruk
JS bundle besar
```

Investigasi:

```text
Accept-Encoding dikirim?
Content-Encoding ada?
Asset type compressible?
CDN compression aktif?
File sudah precompressed?
Cache hit/miss?
Content-Type benar?
```

Fix:

- aktifkan Brotli/gzip untuk text assets;
- precompress static assets;
- set `Content-Type` benar;
- jangan compress media yang sudah compressed;
- kurangi decoded JS size, bukan hanya transferred size;
- split critical/non-critical resources.

---

# SECTION J — Practical Design Rules

---

## 43. Rule 1: Jadikan Representation Metadata Eksplisit

Setiap response penting harus punya metadata yang benar:

```http
Content-Type: application/json; charset=utf-8
Content-Language: id-ID
Content-Encoding: br
Cache-Control: public, max-age=300
Vary: Accept-Encoding, Accept-Language
```

Jika metadata salah, browser/cache/CDN akan membuat asumsi.

Asumsi implisit adalah sumber bug.

---

## 44. Rule 2: Jangan Gunakan Negotiation untuk Semua Hal

Negotiation cocok untuk:

```text
compression
some media type selection
initial language hint
some image optimization
```

Negotiation kurang cocok untuk:

```text
business region
security entitlement
personalized user state
regulatory behavior
feature flags kompleks
critical API versioning tanpa governance
```

Untuk hal bisnis yang perlu reproducible, gunakan:

```text
explicit URL
explicit parameter
authenticated user profile
server-side policy
```

---

## 45. Rule 3: Cache dan Variant Harus Didesain Bersama

Jangan desain localization atau image optimization tanpa memikirkan cache.

Pertanyaan wajib:

```text
Apakah response public atau private?
Apa cache key-nya?
Apa Vary-nya?
Berapa banyak variants mungkin?
Apakah CDN menormalkan header?
Apa invalidation strategy?
Bagaimana debugging variant tertentu?
```

---

## 46. Rule 4: API Frontend Harus Stabil dalam Media Type

Untuk SPA/BFF biasa, gunakan:

```http
Accept: application/json
Content-Type: application/json; charset=utf-8
```

Dan pastikan error juga JSON:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/json; charset=utf-8

{
  "errorCode": "VALIDATION_FAILED",
  "fields": {
    "email": "INVALID_EMAIL"
  }
}
```

Jangan biarkan API kadang mengembalikan HTML.

---

## 47. Rule 5: Localization Error Message Harus Punya Code

Jangan hanya kirim message natural language:

```json
{
  "message": "Email tidak valid"
}
```

Lebih baik:

```json
{
  "errorCode": "INVALID_EMAIL",
  "message": "Email tidak valid",
  "messageParams": {}
}
```

Atau jika frontend menerjemahkan:

```json
{
  "errorCode": "INVALID_EMAIL",
  "messageParams": {}
}
```

Kenapa?

- UI logic tidak bergantung pada teks;
- analytics bisa grouping;
- localization bisa berubah tanpa mengubah logic;
- test lebih stabil.

---

## 48. Rule 6: Bedakan Transfer Size dan Runtime Cost

Compression bisa membuat:

```text
800 KB JS -> 180 KB transferred
```

Tetapi browser tetap menghadapi:

```text
800 KB parse/compile/execution surface
```

Jangan menganggap “sudah Brotli” berarti bundle sehat.

---

# SECTION K — Java/Backend Perspective untuk Frontend Engineer

---

## 49. Kenapa Java Engineer Perlu Memahami Ini

Sebagai Java engineer, Anda mungkin terbiasa dengan controller seperti:

```java
@GetMapping(value = "/products/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
public ProductDto getProduct(@PathVariable String id) {
    return service.getProduct(id);
}
```

Tetapi browser/frontend melihat lebih banyak dari method controller:

```text
Accept header
Content-Type
Content-Encoding
Content-Language
Vary
Cache-Control
CORS headers
proxy/CDN behavior
error response body
redirect behavior
```

Framework bisa membantu, tetapi juga bisa menyembunyikan masalah.

Contoh:

```java
@GetMapping(value = "/report", produces = {"application/json", "text/csv"})
```

Jika API bisa menghasilkan JSON atau CSV, Anda harus memastikan:

```text
Accept negotiation benar
Vary: Accept benar jika cacheable
error response tetap jelas
frontend set Accept eksplisit
observability mencatat selected media type
```

---

## 50. Spring/Java Pitfalls Umum

### 50.1. Error Page HTML untuk API

Default error handling bisa mengembalikan HTML jika tidak dikonfigurasi.

Perlu API error handler yang konsisten:

```text
application/json
problem+json
custom error envelope
```

### 50.2. Missing `Vary`

Framework/proxy mungkin menambahkan beberapa `Vary`, tapi jangan bergantung buta.

Untuk response localized/cacheable, pastikan strategi `Vary` benar.

### 50.3. Compression di Layer yang Salah

Compression bisa terjadi di:

```text
application server
reverse proxy
CDN
edge worker
```

Jangan aktifkan tanpa tahu layer mana yang bertanggung jawab.

Double compression atau compression conflict bisa terjadi dalam konfigurasi buruk.

### 50.4. Locale Resolver Terlalu Magic

Framework dapat memilih locale dari:

```text
Accept-Language
cookie
session
query parameter
path
```

Pastikan sumber locale sesuai arsitektur cache dan UX.

---

# SECTION L — Checklist Review

---

## 51. Checklist untuk Endpoint API

Untuk setiap endpoint API, tanyakan:

```text
[ ] Apa media type response normal?
[ ] Apa media type error response?
[ ] Apakah frontend mengirim Accept eksplisit?
[ ] Apakah Content-Type selalu benar?
[ ] Apakah response bisa berubah berdasarkan Accept?
[ ] Jika iya, apakah Vary: Accept benar?
[ ] Apakah response localized?
[ ] Jika iya, locale berasal dari mana?
[ ] Apakah response cacheable?
[ ] Jika cacheable, apakah Vary lengkap tapi tidak berlebihan?
[ ] Apakah response personalized?
[ ] Jika personalized, apakah Cache-Control mencegah shared cache leak?
[ ] Apakah compression aktif pada layer yang tepat?
[ ] Apakah DevTools menunjukkan Content-Encoding sesuai harapan?
```

---

## 52. Checklist untuk Public Page

```text
[ ] Apakah locale eksplisit di URL?
[ ] Apakah canonical/hreflang strategy ada?
[ ] Apakah cache key stabil?
[ ] Apakah Vary: Accept-Language diperlukan atau bisa dihindari?
[ ] Apakah HTML cache strategy aman?
[ ] Apakah assets immutable?
[ ] Apakah compression aktif untuk HTML/CSS/JS?
[ ] Apakah image format negotiation/cache strategy jelas?
[ ] Apakah cookies tidak merusak public cache?
```

---

## 53. Checklist untuk CDN/Proxy

```text
[ ] Header apa saja yang masuk cache key?
[ ] Apakah Accept-Encoding dinormalisasi?
[ ] Apakah Accept-Language dinormalisasi atau dihindari?
[ ] Apakah Cookie masuk cache key?
[ ] Apakah Origin masuk cache key hanya saat perlu?
[ ] Apakah Vary dihormati?
[ ] Apakah response compressed di origin atau CDN?
[ ] Apakah CDN bisa serve precompressed br/gzip?
[ ] Apakah personalized route bypass shared cache?
[ ] Apakah hit/miss terlihat di response header?
```

---

# SECTION M — Exercises

---

## 54. Exercise 1: Diagnosis `Unexpected token '<'`

Anda punya code:

```ts
const res = await fetch('/api/profile');
const profile = await res.json();
```

User kadang mendapat:

```text
Unexpected token '<'
```

Tugas:

1. Buka DevTools Network.
2. Cari `/api/profile`.
3. Periksa status code.
4. Periksa final URL setelah redirect.
5. Periksa `Content-Type`.
6. Periksa response body preview.
7. Tentukan apakah masalahnya:
   - auth redirect;
   - server error page;
   - SPA fallback;
   - proxy misroute;
   - wrong `Accept` handling.
8. Buat fix frontend dan backend.

Expected high-quality fix:

```text
Frontend:
- check content-type
- normalize error
- handle 401/403 without assuming JSON blindly

Backend/gateway:
- API routes return JSON errors
- no HTML login redirect for fetch API
- correct status codes
- correct content-type
```

---

## 55. Exercise 2: Design Localization Strategy

Aplikasi Anda punya:

```text
public documentation
authenticated dashboard
transactional emails
API validation errors
```

Tentukan strategi localization:

| Area | Recommended Strategy |
|---|---|
| Public docs | URL locale: `/id/docs`, `/en/docs` |
| Dashboard | user profile locale, maybe cookie fallback |
| Transactional email | server-side locale from user preference |
| API validation errors | stable error code + params, frontend translate |

Jelaskan cache implication untuk masing-masing.

---

## 56. Exercise 3: Audit `Vary`

Response:

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Language: id-ID
Content-Encoding: br
Cache-Control: public, max-age=600
Vary: Accept-Encoding
```

Pertanyaan:

1. Jika bahasa dipilih dari `Accept-Language`, apa yang kurang?
2. Jika bahasa dipilih dari URL `/id/...`, apakah `Vary: Accept-Language` diperlukan?
3. Jika response personalized dari cookie, apakah `public` aman?
4. Jika response tergantung origin CORS, apa yang mungkin perlu ditambahkan?

Jawaban inti:

```text
1. Missing Vary: Accept-Language jika memang negotiation dari header.
2. Tidak perlu, jika URL sudah menentukan bahasa.
3. Tidak aman; gunakan private/no-store atau pisahkan personalized data.
4. Vary: Origin jika ACAO berbeda per Origin.
```

---

## 57. Exercise 4: Compression Reality Check

DevTools menunjukkan:

```text
app.js
Transferred: 230 KB
Resource size: 1.2 MB
Content-Encoding: br
```

Pertanyaan:

1. Apakah compression bekerja?
2. Apakah bundle otomatis sehat?
3. Apa next step performance?

Jawaban inti:

```text
1. Ya, network transfer dikurangi.
2. Tidak otomatis. Browser tetap parse/compile 1.2 MB JS.
3. Audit bundle, code splitting, remove unused deps, defer non-critical JS, measure main-thread cost.
```

---

# 58. Ringkasan Mental Model

Content negotiation bukan fitur dekoratif HTTP. Ia adalah mekanisme pemilihan representation.

Model yang harus Anda bawa:

```text
URL identifies a resource.
Request headers express preferences/capabilities.
Server selects a representation.
Response headers describe selected representation.
Vary tells caches which request dimensions mattered.
Cache-Control tells caches whether/how to store.
Frontend must verify Content-Type before parsing.
Localization must separate language, locale, region, currency, timezone.
Compression reduces transfer bytes, not runtime cost.
Too few variants cause wrong content.
Too many variants destroy cache efficiency.
```

---

# 59. Top 1% Takeaways

1. **`Accept` dan `Content-Type` adalah dua arah yang berbeda.**  
   `Accept` bicara tentang response yang diharapkan; `Content-Type` bicara tentang body yang benar-benar dikirim.

2. **`Accept-Language` adalah hint, bukan identity.**  
   Untuk UX dan cache yang baik, user-selected locale atau URL locale sering lebih stabil.

3. **`Content-Encoding` bukan media type.**  
   Ia menjelaskan compression/encoding yang harus didecode untuk mendapatkan representation asli.

4. **`Vary` adalah bagian dari cache correctness.**  
   Missing `Vary` menyebabkan wrong response; excessive `Vary` menghancurkan cache hit ratio.

5. **Variant harus didesain, bukan terjadi secara kebetulan.**  
   Setiap dimensi variant harus punya alasan, owner, observability, dan cache strategy.

6. **API frontend harus stabil.**  
   Jangan biarkan endpoint API kadang JSON, kadang HTML, kadang redirect login page.

7. **Compression bukan solusi untuk bundle bloat.**  
   Network bytes turun, tetapi browser CPU dan memory tetap membayar decoded resource.

8. **Untuk sistem enterprise/regulatory, region bukan locale.**  
   Jangan menggantungkan regulatory behavior pada `Accept-Language` atau IP guess semata.

---

# 60. Persiapan Part Berikutnya

Bagian berikutnya:

```text
Part 018 — Resource Loading: HTML Parser, Preload Scanner, Priority, and Waterfall
```

Kita akan masuk ke bagaimana browser benar-benar memuat resource:

```text
HTML parser
preload scanner
render-blocking CSS
parser-blocking JS
async/defer/module
font/image loading
resource hints
fetch priority
waterfall analysis
LCP impact
```

Part 017 memberi dasar penting karena resource loading sangat bergantung pada:

```text
Accept headers
Content-Type
Content-Encoding
cache headers
Vary
resource variants
compression
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-016.md">⬅️ Part 016 — Redirects: 301, 302, 303, 307, 308 and Browser Behavior</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-018.md">Part 018 — Resource Loading: HTML Parser, Preload Scanner, Priority, and Waterfall ➡️</a>
</div>
