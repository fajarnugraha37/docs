# learn-http-for-web-frontend-perspective-part-002.md

# Part 002 — URL, Origin, Site, Scheme, Host, Port, Path, Query, Fragment

> Seri: `learn-http-for-web-frontend-perspective`  
> Target pembaca: Java Software Engineer yang ingin menguasai HTTP dari perspektif browser/frontend secara mendalam.  
> Posisi dalam seri: setelah Part 000/001 membangun peta besar, bagian ini membedah konsep alamat dan boundary keamanan browser.  
> Status seri: **belum selesai**. Ini bukan bagian terakhir.

---

## 0. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan fundamental:

> Ketika browser melihat sebuah URL, apa sebenarnya yang dianggap sama, berbeda, aman, berbahaya, bisa berbagi cookie, bisa membaca response, bisa memakai storage, bisa dicakup service worker, dan bisa dianggap satu security boundary?

Sebagai backend engineer, kita sering melihat URL sebagai routing string:

```text
GET /api/users/123
Host: api.example.com
```

Dari sisi browser, URL bukan hanya routing string. URL adalah input untuk banyak subsistem:

- DNS resolution
- TLS certificate validation
- HTTP request construction
- connection pooling
- cache key calculation
- CORS decision
- cookie inclusion
- storage partitioning
- service worker scope matching
- referrer behavior
- mixed content blocking
- secure context decision
- navigation history
- resource prioritization
- security policy enforcement

Jadi URL adalah **identity + routing + security boundary + cache coordinate + browser policy coordinate**.

Di akhir bagian ini, Anda harus bisa menjawab secara presisi:

1. Apa beda URL, origin, site, host, domain, registrable domain, dan path?
2. Kenapa `localhost`, `127.0.0.1`, dan `app.localhost` bisa berperilaku berbeda?
3. Kenapa `https://app.example.com` dan `https://api.example.com` cross-origin tetapi same-site?
4. Kenapa `http://example.com` dan `https://example.com` bukan same-origin dan pada browser modern juga diperlakukan cross-site untuk beberapa kebijakan?
5. Kenapa fragment tidak pernah sampai ke server?
6. Kenapa query parameter bisa menjadi bagian dari cache key, observability, dan security risk?
7. Kenapa desain URL adalah desain arsitektur, bukan kosmetik routing?

---

## 1. Mental Model Utama: URL Adalah Koordinat Sistem

Bayangkan aplikasi web sebagai sistem terdistribusi kecil yang hidup di dalam browser. Browser harus menjawab banyak pertanyaan sebelum mengizinkan sesuatu terjadi:

```text
Request ini menuju resource mana?
Apakah resource ini berada pada origin yang sama dengan page saat ini?
Apakah request ini same-site atau cross-site?
Apakah cookie boleh dikirim?
Apakah JavaScript boleh membaca response?
Apakah response boleh masuk cache?
Apakah service worker boleh mengintersepsi?
Apakah ini secure context?
Apakah ini mixed content?
Apakah header policy mengizinkan resource ini?
```

Jawaban atas pertanyaan-pertanyaan itu banyak ditentukan oleh URL.

Karena itu, jangan melihat URL hanya sebagai string. Lihat URL sebagai struktur:

```text
scheme://userinfo@host:port/path?query#fragment
```

Contoh:

```text
https://user:pass@app.example.com:8443/orders/123?tab=history&page=2#comments
```

Komponen besarnya:

```text
scheme      = https
userinfo    = user:pass       (jarang dipakai, berisiko, biasanya dihindari)
host        = app.example.com
port        = 8443
path        = /orders/123
query       = tab=history&page=2
fragment    = comments
```

Namun untuk browser security, komponen paling penting sering kali hanya:

```text
origin = scheme + host + port
```

Untuk cookie dan beberapa policy modern, kita juga butuh konsep:

```text
site = scheme + registrable domain
```

Perbedaan antara `origin` dan `site` adalah salah satu sumber bug HTTP/browser paling sering di produksi.

---

## 2. URL vs URI vs Resource: Jangan Terjebak Terminologi, Tapi Pahami Batasnya

Dalam praktik web modern, engineer sering memakai kata URL untuk semua alamat resource. Itu biasanya cukup. Namun untuk reasoning yang presisi:

- **URI** adalah identifier umum untuk resource.
- **URL** adalah locator: identifier yang juga memberi tahu cara menemukan resource.
- Di browser modern, istilah praktis yang paling sering Anda pakai adalah **URL**.

Contoh URL:

```text
https://api.example.com/v1/users/123
```

Ia mengandung:

- cara akses: `https`
- host target: `api.example.com`
- resource path: `/v1/users/123`

Namun resource bukan file fisik. `/v1/users/123` bisa diproses oleh:

- CDN rule
- API Gateway route
- reverse proxy
- Java Spring controller
- Node BFF
- serverless function
- edge worker
- service worker di browser

Jadi URL menunjuk ke resource **secara konseptual**, bukan selalu ke file.

### Backend instinct yang perlu dikoreksi

Backend engineer sering berpikir:

```text
URL path = endpoint mapping
```

Frontend/browser perspective lebih luas:

```text
URL = identity coordinate used by browser policies and network stack
```

Path memang penting untuk routing, tapi browser security boundary terutama bukan path. Browser tidak menganggap `/admin` dan `/public` sebagai origin berbeda jika scheme, host, dan port sama.

Contoh:

```text
https://app.example.com/admin
https://app.example.com/public
```

Keduanya same-origin.

Artinya JavaScript dari `/public` secara origin-level berada dalam boundary yang sama dengan `/admin`, kecuali ada mekanisme tambahan seperti authentication, authorization, CSP, iframe sandbox, atau server-side access control.

---

## 3. Anatomy URL Secara Detail

Mari bedah contoh berikut:

```text
https://app.example.com:443/products/search?q=phone&sort=price#reviews
```

### 3.1 Scheme

```text
https
```

Scheme memberi tahu protokol atau mekanisme akses.

Contoh umum:

```text
http
https
ws
wss
file
data
blob
mailto
```

Untuk HTTP frontend, scheme paling penting:

- `http`
- `https`
- `ws`
- `wss`

Scheme memengaruhi:

- origin
- secure context
- cookie `Secure`
- mixed content
- service worker eligibility
- HTTP/2/HTTP/3 negotiation
- HSTS behavior
- browser permission APIs
- cache separation
- same-site calculation modern

#### Contoh jebakan

```text
http://example.com
https://example.com
```

Host sama, tetapi scheme berbeda. Maka origin berbeda.

Origin pertama:

```text
http://example.com:80
```

Origin kedua:

```text
https://example.com:443
```

Mereka tidak same-origin.

Pada browser modern, same-site juga semakin dipahami secara schemeful: scheme ikut berpengaruh terhadap definisi site dalam konteks cookie/security modern.

### 3.2 Host

```text
app.example.com
```

Host adalah nama target authority. Bisa berupa:

```text
example.com
app.example.com
localhost
127.0.0.1
[::1]
192.168.1.10
```

Host memengaruhi:

- DNS lookup
- TLS certificate validation
- origin
- cookie domain matching
- CORS origin comparison
- service worker scope
- storage boundary
- connection pooling
- CDN routing

#### Host bukan selalu domain publik

`localhost` bukan domain publik biasa. `127.0.0.1` adalah IP loopback. `app.localhost` juga bisa punya perlakuan khusus tergantung resolver/browser/dev setup.

Tapi dari sisi origin:

```text
http://localhost:3000
http://127.0.0.1:3000
```

Itu origin berbeda karena host string berbeda.

Walaupun keduanya bisa menuju mesin yang sama, browser security tidak berkata “ini sama karena IP akhirnya sama”. Browser membandingkan origin berdasarkan scheme, host, dan port yang direpresentasikan dalam URL.

### 3.3 Port

```text
443
```

Port adalah nomor endpoint transport.

Default port:

```text
http  -> 80
https -> 443
ws    -> 80
wss   -> 443
```

Port adalah bagian dari origin.

Contoh:

```text
http://localhost:3000
http://localhost:8080
```

Origin berbeda.

Ini penyebab umum CORS issue di local development:

```text
Frontend dev server: http://localhost:5173
Backend API:          http://localhost:8080
```

Host sama, scheme sama, port berbeda. Maka cross-origin.

### 3.4 Path

```text
/products/search
```

Path adalah bagian URL yang biasa dipakai server untuk routing.

Path memengaruhi:

- server routing
- static asset lookup
- API route matching
- CDN cache key
- service worker scope matching
- cookie path matching
- browser history
- SPA routing

Path **tidak** membedakan origin.

Contoh:

```text
https://app.example.com/a
https://app.example.com/b
```

Same-origin.

Namun path tetap penting untuk cookie:

```http
Set-Cookie: adminSession=abc; Path=/admin
```

Cookie tersebut hanya dikirim untuk request path yang cocok dengan `/admin` menurut aturan cookie path matching. Tetapi ini bukan security boundary yang cukup kuat untuk authorization. Server tetap harus melakukan authorization.

### 3.5 Query

```text
?q=phone&sort=price
```

Query sering dipakai untuk:

- filtering
- sorting
- pagination
- search
- feature flags
- tracking
- cache busting
- signed URL
- OAuth callback parameters

Query dikirim ke server.

Query biasanya menjadi bagian dari cache key.

Contoh:

```text
/products?q=phone
/products?q=laptop
```

Dua URL berbeda. Browser/CDN bisa menyimpannya sebagai cache entry berbeda.

#### Query parameter bukan tempat aman untuk rahasia

Jangan taruh data sensitif di query parameter jika bisa dihindari.

Alasannya:

- muncul di browser history
- muncul di server logs
- muncul di proxy/CDN logs
- bisa muncul di analytics
- bisa masuk Referer header saat navigasi ke situs lain, tergantung policy
- mudah disalin dan dibagikan

Contoh buruk:

```text
https://app.example.com/reset-password?token=very-sensitive-token
```

Kadang reset token memang memakai URL karena user harus klik link email. Jika begitu, mitigate dengan:

- token one-time use
- short expiry
- no logging atau redaction
- Referrer-Policy ketat
- immediate token exchange
- tidak menyimpan token di long-lived browser state

### 3.6 Fragment

```text
#reviews
```

Fragment adalah bagian setelah `#`.

Fragment **tidak dikirim ke server** dalam HTTP request.

Jika browser membuka:

```text
https://example.com/page?x=1#section-2
```

Request line HTTP tidak membawa `#section-2`.

Server melihat kurang lebih:

```http
GET /page?x=1 HTTP/1.1
Host: example.com
```

Fragment dipakai oleh browser/client untuk:

- scroll ke element tertentu
- SPA hash routing
- client-side state
- OAuth legacy implicit flow fragment

#### Implikasi penting

Server tidak bisa melakukan routing berdasarkan fragment karena server tidak menerimanya.

Contoh:

```text
https://app.example.com/#/orders/123
```

Server hanya menerima request untuk:

```text
/
```

Routing `#/orders/123` terjadi di JavaScript.

Itu sebabnya hash-based SPA routing dulu populer untuk menghindari kebutuhan server fallback route.

Namun fragment punya risiko:

- bisa tersimpan di browser history
- bisa dibaca JavaScript pada page yang sama
- bisa bocor melalui client-side script jika dikirim manual
- kurang ideal untuk security-sensitive token flow modern

---

## 4. Origin: Security Boundary Dasar Browser

Origin adalah triple:

```text
scheme + host + port
```

Dua URL same-origin hanya jika ketiganya sama.

Contoh same-origin:

```text
https://app.example.com/orders
https://app.example.com/profile
```

Keduanya:

```text
scheme = https
host   = app.example.com
port   = 443 default
```

Contoh cross-origin:

```text
https://app.example.com
https://api.example.com
```

Host berbeda.

```text
https://example.com
http://example.com
```

Scheme berbeda.

```text
http://localhost:3000
http://localhost:8080
```

Port berbeda.

### 4.1 Origin comparison table

| URL A | URL B | Same-origin? | Alasan |
|---|---:|---:|---|
| `https://example.com/a` | `https://example.com/b` | Ya | scheme, host, port sama |
| `https://example.com` | `http://example.com` | Tidak | scheme berbeda |
| `https://example.com` | `https://www.example.com` | Tidak | host berbeda |
| `https://app.example.com` | `https://api.example.com` | Tidak | host berbeda |
| `http://localhost:3000` | `http://localhost:3000/a` | Ya | scheme, host, port sama |
| `http://localhost:3000` | `http://localhost:8080` | Tidak | port berbeda |
| `http://127.0.0.1:3000` | `http://localhost:3000` | Tidak | host berbeda |
| `https://example.com` | `https://example.com:443` | Ya | explicit default port sama |
| `http://example.com` | `http://example.com:80` | Ya | explicit default port sama |

### 4.2 Origin tidak peduli path

Ini sangat penting.

```text
https://bank.example.com/public
https://bank.example.com/admin
```

Same-origin.

Kalau `/public` punya XSS, attacker script yang berjalan di `/public` berada pada origin yang sama dengan `/admin`.

Dari sudut browser, script tersebut bisa mencoba:

```js
fetch('/admin/users')
```

Jika user sedang authenticated dan server tidak punya authorization kuat, masalahnya fatal.

Kesimpulan:

> Path bukan security boundary browser.

Jika Anda ingin isolation kuat, pertimbangkan origin berbeda:

```text
https://public.example.com
https://admin.example.com
```

Tetapi origin berbeda membawa konsekuensi CORS, cookie domain, deployment, dan observability.

---

## 5. Same-Origin Policy: Kenapa Origin Begitu Penting

Same-Origin Policy adalah mekanisme keamanan browser yang membatasi bagaimana document atau script dari satu origin dapat berinteraksi dengan resource dari origin lain.

Tanpa same-origin policy, situs jahat bisa melakukan ini:

1. User login ke `https://bank.example.com`.
2. User membuka `https://evil.example`.
3. Script dari `evil.example` melakukan request ke `https://bank.example.com/account`.
4. Browser otomatis menyertakan cookie bank.
5. Script jahat membaca response saldo user.

Same-Origin Policy mencegah langkah 5: script cross-origin tidak bebas membaca response.

Namun ada nuance penting:

- Browser mungkin tetap mengirim request cross-origin dalam kondisi tertentu.
- Cookie mungkin ikut terkirim tergantung cookie policy dan credentials mode.
- Yang dibatasi terutama adalah kemampuan script untuk membaca response atau mengakses object lintas origin.

CORS adalah mekanisme server untuk memberi izin eksplisit agar browser mengizinkan cross-origin read tertentu.

### 5.1 SOP bukan firewall

Same-Origin Policy bukan firewall server.

Server tetap menerima request jika request sampai.

Karena itu, jangan menganggap CORS/SOP sebagai authorization.

Server harus tetap melakukan:

- authentication
- authorization
- CSRF mitigation jika memakai ambient credential seperti cookies
- rate limiting
- audit logging
- input validation

### 5.2 SOP bukan CORS

Same-Origin Policy adalah default restriction.

CORS adalah mekanisme opt-in untuk melonggarkan restriction itu secara terkendali.

CORS tidak membuat request “lebih aman”. CORS membuat browser boleh membagikan response ke script origin lain jika server menyetujuinya.

---

## 6. Site: Boundary yang Berbeda dari Origin

Origin:

```text
scheme + host + port
```

Site modern secara konseptual:

```text
scheme + registrable domain
```

Registrable domain sering disebut eTLD+1.

Contoh:

```text
www.example.com
api.example.com
app.example.com
```

Registrable domain-nya:

```text
example.com
```

Maka:

```text
https://app.example.com
https://api.example.com
```

cross-origin, tetapi same-site.

Ini penting untuk cookies, terutama `SameSite`.

### 6.1 Same-origin vs same-site examples

| URL A | URL B | Same-origin? | Same-site? | Catatan |
|---|---:|---:|---:|---|
| `https://app.example.com` | `https://app.example.com` | Ya | Ya | sama penuh |
| `https://app.example.com` | `https://api.example.com` | Tidak | Ya | subdomain berbeda |
| `https://example.com` | `https://www.example.com` | Tidak | Ya | host berbeda, site sama |
| `https://example.com` | `https://evil.com` | Tidak | Tidak | domain berbeda |
| `http://example.com` | `https://example.com` | Tidak | Umumnya diperlakukan berbeda dalam schemeful same-site | scheme beda |
| `https://shop.example.co.uk` | `https://auth.example.co.uk` | Tidak | Ya | registrable domain `example.co.uk` |

### 6.2 eTLD+1 dan Public Suffix List

Menentukan site tidak cukup dengan “ambil dua label terakhir”.

Contoh:

```text
example.co.uk
```

Registrable domain adalah:

```text
example.co.uk
```

Bukan:

```text
co.uk
```

Karena `co.uk` adalah public suffix.

Browser menggunakan konsep public suffix agar cookie dan site boundary tidak kacau.

Jika tidak ada public suffix logic, situs `attacker.co.uk` bisa mencoba mengatur cookie untuk `co.uk`, yang akan berdampak ke banyak domain lain. Itu tidak boleh.

### 6.3 Kenapa site penting untuk frontend

Site memengaruhi:

- `SameSite` cookie behavior
- CSRF risk modeling
- first-party vs third-party context
- iframe embedding behavior
- tracking prevention
- storage partitioning
- browser privacy model

Contoh arsitektur:

```text
Frontend SPA: https://app.example.com
API:          https://api.example.com
```

Dari sisi origin:

```text
cross-origin
```

Dari sisi site:

```text
same-site
```

Konsekuensinya:

- `fetch()` ke API butuh CORS karena cross-origin.
- Cookie `SameSite=Lax` atau `SameSite=Strict` mungkin masih relevan karena same-site, tergantung konteks request.
- Browser storage tetap origin-scoped, jadi localStorage app dan api tidak sama.
- Service worker app tidak bisa mengontrol API origin.

Ini contoh klasik kenapa “same-site” tidak sama dengan “same-origin”.

---

## 7. Domain, Host, Subdomain: Istilah yang Sering Tertukar

### 7.1 Host

Host adalah komponen URL.

```text
api.example.com
```

### 7.2 Domain

Domain sering dipakai longgar. Bisa berarti:

- registered domain: `example.com`
- fully qualified domain name: `api.example.com`
- organizational domain: `example.com`

Dalam diskusi teknis, lebih baik gunakan istilah spesifik:

```text
host
registrable domain
subdomain
origin
site
```

### 7.3 Subdomain

Dalam:

```text
api.example.com
```

`api` adalah subdomain dari `example.com`.

Tetapi browser origin tidak berkata “subdomain masih sama”. Host berbeda berarti origin berbeda.

### 7.4 Cookie domain nuance

Cookie bisa diset untuk domain tertentu:

```http
Set-Cookie: session=abc; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Cookie ini bisa dikirim ke:

```text
example.com
app.example.com
api.example.com
```

Tetapi localStorage tidak dibagi seperti itu. CORS juga tidak otomatis hilang.

Jangan menyamakan cookie domain sharing dengan same-origin.

---

## 8. Path: Routing Surface, Not Origin Boundary

Path terlihat sederhana, tapi desain path memengaruhi banyak hal.

### 8.1 Path untuk API resource

Contoh REST-ish:

```text
/api/users
/api/users/123
/api/users/123/orders
```

Path menyatakan resource hierarchy. Ini memudahkan:

- caching
- observability
- authorization mapping
- documentation
- frontend query organization
- reverse proxy routing

### 8.2 Path untuk SPA routes

Contoh:

```text
/dashboard
/orders/123
/settings/security
```

Pada SPA dengan history mode, browser melakukan navigation ke `/orders/123`. Server harus mengembalikan app shell HTML jika route itu route client-side.

Jika server tidak dikonfigurasi fallback, refresh halaman akan menghasilkan 404.

Flow:

```text
User buka /orders/123
Browser request GET /orders/123
Server harus return index.html
JS router membaca path /orders/123
SPA render OrderDetail page
```

### 8.3 Path untuk reverse proxy boundary

Contoh:

```text
https://example.com/app
https://example.com/api
```

Keduanya same-origin.

Keuntungannya:

- CORS lebih sederhana karena same-origin.
- Cookie behavior lebih sederhana.
- Browser storage satu origin.

Risikonya:

- Security isolation lebih lemah dibanding subdomain terpisah.
- CSP/connect-src perlu lebih hati-hati.
- XSS di app bisa request `/api` same-origin.
- Routing/proxy rewrite bisa kompleks.

Alternatif:

```text
https://app.example.com
https://api.example.com
```

Keuntungannya:

- Origin isolation lebih jelas.
- Bisa pisahkan cookie scope.
- Bisa pisahkan security headers.

Biayanya:

- Butuh CORS.
- Credentialed CORS harus benar.
- Dev/prod environment lebih kompleks.

Tidak ada jawaban universal. Ini desain trade-off.

---

## 9. Query Parameter: Contract Surface yang Sering Diremehkan

Query parameter sering terlihat remeh, tapi sebenarnya bagian penting dari API dan UX.

Contoh:

```text
GET /orders?status=pending&page=2&sort=-createdAt
```

Query parameter membawa:

- filter
- sort
- pagination
- search term
- view mode
- correlation parameter
- campaign tracking
- cache busting
- signed URL metadata

### 9.1 Query sebagai bagian dari cache key

Secara praktis, URL lengkap termasuk query biasanya menjadi basis cache key.

```text
/products?page=1
/products?page=2
```

Dua cache entry berbeda.

Masalah muncul jika query parameter tidak distandardisasi.

Contoh:

```text
/products?page=1&sort=name
/products?sort=name&page=1
```

Secara semantik sama, tapi bisa dianggap berbeda oleh cache jika normalisasi tidak dilakukan.

### 9.2 Query ordering dan canonicalization

Frontend harus konsisten membangun URL.

Buruk:

```js
const url = '/products?' + Math.randomlyOrderedParams(params)
```

Lebih baik:

```js
const params = new URLSearchParams()
params.set('page', String(page))
params.set('sort', sort)
const url = `/products?${params.toString()}`
```

Untuk cache stability, gunakan ordering konsisten jika memungkinkan.

### 9.3 Query dan observability

Query muncul di:

- access log
- CDN log
- APM trace
- browser DevTools
- HAR file
- analytics
- monitoring dashboard

Jangan menaruh PII atau secret sembarangan.

Contoh buruk:

```text
/search?email=john@example.com&nationalId=123456
```

Lebih baik:

- minimalkan data sensitif
- gunakan POST untuk complex sensitive search jika perlu
- redaksi logs
- buat policy jelas untuk query logging

### 9.4 Query untuk state UI

Untuk frontend, query bisa menjadi state yang shareable.

Contoh:

```text
/orders?status=pending&assignedTo=me&page=3
```

Keuntungan:

- user bisa bookmark
- bisa share link
- back/forward browser natural
- reload mempertahankan state
- debugging lebih mudah

Namun jangan taruh state volatile atau sensitive tanpa pertimbangan.

---

## 10. Fragment: Client-Side Coordinate

Fragment tidak dikirim ke server.

Contoh:

```text
https://docs.example.com/http#origin
```

Server hanya melihat:

```text
/docs.example.com/http
```

Fragment dipakai browser untuk:

- scroll ke anchor
- client-side routing
- preserving UI state
- historical OAuth implicit callback

### 10.1 Hash routing

Contoh:

```text
https://app.example.com/#/orders/123
```

Server hanya perlu serve `/`.

Keuntungan:

- tidak butuh server fallback route
- mudah untuk static hosting lama

Kekurangan:

- URL kurang clean
- analytics/SEO/history behavior bisa kurang ideal
- server tidak tahu route aktual
- observability server-side kurang lengkap

### 10.2 History routing

Contoh:

```text
https://app.example.com/orders/123
```

Lebih natural, tapi server harus tahu untuk fallback ke app shell.

Server/CDN config harus menangani:

```text
GET /orders/123 -> index.html
GET /assets/app.abc123.js -> static JS
GET /api/orders/123 -> API response
```

Kesalahan routing dapat menyebabkan:

- refresh 404
- asset path salah
- API tertangkap fallback HTML
- browser mencoba parse HTML sebagai JSON

---

## 11. Default Ports and URL Equivalence

Browser melakukan normalisasi tertentu.

Contoh:

```text
https://example.com
https://example.com:443
```

Origin dianggap sama karena port default HTTPS adalah 443.

```text
http://example.com
http://example.com:80
```

Origin dianggap sama karena port default HTTP adalah 80.

Namun:

```text
https://example.com:8443
https://example.com
```

Origin berbeda.

### 11.1 Local dev implication

Contoh setup umum:

```text
Vite dev server: http://localhost:5173
Spring Boot API:  http://localhost:8080
```

Walaupun sama-sama localhost, origin berbeda karena port berbeda.

Maka request frontend ke backend adalah cross-origin:

```js
fetch('http://localhost:8080/api/users')
```

Butuh CORS dari backend atau dev proxy.

### 11.2 Dev proxy mengubah origin story

Jika dev server proxy:

```text
Frontend code calls: /api/users
Browser URL:         http://localhost:5173/api/users
Dev server proxies:  http://localhost:8080/api/users
```

Dari browser, request terlihat same-origin ke `localhost:5173`.

CORS tidak terjadi di browser karena cross-origin hop dilakukan server-side oleh dev server proxy.

Ini menjelaskan kenapa:

```text
works in local dev proxy, fails in production
```

atau sebaliknya.

---

## 12. Hostname Nuance: localhost, 127.0.0.1, 0.0.0.0, ::1

### 12.1 localhost vs 127.0.0.1

```text
http://localhost:3000
http://127.0.0.1:3000
```

Origin berbeda.

Cookie untuk `localhost` tidak otomatis sama dengan cookie untuk `127.0.0.1`.

Storage juga berbeda.

CORS juga menganggapnya berbeda.

### 12.2 0.0.0.0

`0.0.0.0` biasanya dipakai server untuk bind ke semua interface:

```bash
server.listen(3000, '0.0.0.0')
```

Tetapi sebagai URL browser, `http://0.0.0.0:3000` bukan identitas yang sama dengan `http://localhost:3000`.

Jangan jadikan `0.0.0.0` sebagai canonical frontend URL.

### 12.3 IPv6 loopback

```text
http://[::1]:3000
```

Ini juga origin berbeda dari:

```text
http://localhost:3000
http://127.0.0.1:3000
```

### 12.4 Practical rule

Untuk local development, pilih satu canonical host dan konsisten:

```text
http://localhost:5173
```

atau

```text
http://app.localhost:5173
```

Jangan campur:

```text
localhost
127.0.0.1
[::1]
```

terutama jika sedang debug cookie/session/CORS.

---

## 13. Unicode, Punycode, IDN, and Security Risk

Domain modern bisa mengandung karakter internasional.

Contoh konseptual:

```text
https://bücher.example
```

Di bawahnya, domain bisa direpresentasikan dengan punycode.

Masalah keamanan muncul karena karakter berbeda bisa terlihat mirip.

Contoh homograph risk:

```text
аpple.com
apple.com
```

Huruf pertama bisa berasal dari alfabet berbeda meskipun terlihat mirip.

Frontend engineer perlu sadar karena URL bisa muncul di:

- link rendering
- redirect target
- OAuth callback validation
- email template
- user-generated content
- admin console

### 13.1 Practical rule

Jangan validasi URL dengan string contains sederhana.

Buruk:

```js
if (url.includes('example.com')) allowRedirect(url)
```

Ini bisa tertipu oleh:

```text
https://evil-example.com
https://example.com.evil.com
https://evil.com/?next=example.com
```

Lebih baik parse URL:

```js
const parsed = new URL(input)
if (parsed.origin === 'https://app.example.com') {
  // allowed
}
```

Untuk allowlist multi-origin, bandingkan struktur, bukan substring.

---

## 14. URL Parsing: Jangan Pakai Regex Sembarangan

URL parsing penuh edge cases:

- percent encoding
- unicode
- punycode
- default ports
- relative URL
- base URL
- path normalization
- credentials in URL
- IPv6 host
- opaque origin schemes
- encoded slash
- query encoding

Gunakan API standar:

```js
const url = new URL('/api/users?page=1', window.location.origin)
console.log(url.origin)
console.log(url.pathname)
console.log(url.searchParams.get('page'))
```

### 14.1 Relative URL resolution

Jika page saat ini:

```text
https://app.example.com/orders/123
```

Maka:

```js
new URL('items', window.location.href).href
```

bisa menjadi:

```text
https://app.example.com/orders/items
```

Sedangkan:

```js
new URL('/items', window.location.href).href
```

menjadi:

```text
https://app.example.com/items
```

Perbedaan relative path ini sering menyebabkan bug asset/API path.

### 14.2 Base tag hazard

HTML bisa punya:

```html
<base href="/app/">
```

Ini memengaruhi resolution relative URL di document.

Jika Anda menggunakan relative paths tanpa sadar, base tag bisa mengubah target resource.

### 14.3 Encoded slash

URL path bisa mengandung encoded slash `%2F`.

Contoh:

```text
/api/files/a%2Fb
```

Tergantung server/proxy/framework, `%2F` bisa:

- tetap encoded sebagai bagian segment
- didecode menjadi `/`
- ditolak karena security setting
- menyebabkan route mismatch

Jangan membuat API yang bergantung pada ambiguity encoded slash tanpa pengujian lintas proxy/framework.

---

## 15. Percent-Encoding and `URLSearchParams`

URL hanya bisa membawa karakter tertentu secara literal. Karakter lain perlu encoded.

Contoh:

```text
space -> %20 atau + dalam form-urlencoded context
&     -> %26 jika bagian value
=     -> %3D jika bagian value
#     -> %23 jika ingin menjadi bagian query/path, bukan fragment delimiter
```

### 15.1 Bug umum query manual

Buruk:

```js
const url = `/search?q=${query}`
```

Jika `query`:

```text
phone & laptop
```

URL menjadi:

```text
/search?q=phone & laptop
```

Atau jika query:

```text
a=b&role=admin
```

maka struktur query berubah.

Lebih baik:

```js
const params = new URLSearchParams()
params.set('q', query)
const url = `/search?${params}`
```

### 15.2 Path parameter encoding

Untuk path segment:

```js
const id = encodeURIComponent(userProvidedId)
const url = `/files/${id}`
```

Jangan pakai raw input dalam path.

Buruk:

```js
fetch(`/files/${filename}`)
```

Jika filename:

```text
../../admin
```

Anda membuka peluang route confusion. Server tetap harus aman, tetapi frontend jangan memperparah ambiguity.

---

## 16. Origin, Storage, and Browser State

Browser storage biasanya scoped by origin.

Contoh storage:

- localStorage
- sessionStorage
- IndexedDB
- Cache API
- service worker registration

Jika Anda menyimpan:

```js
localStorage.setItem('token', 'abc')
```

pada:

```text
https://app.example.com
```

Maka token itu tidak otomatis tersedia pada:

```text
https://api.example.com
```

Karena origin berbeda.

### 16.1 Cookie berbeda dari localStorage

Cookie bisa Domain-scoped ke parent domain:

```http
Set-Cookie: session=abc; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Maka cookie bisa dikirim ke `app.example.com` dan `api.example.com`.

Tetapi localStorage tetap tidak shared.

Ini perbedaan penting untuk auth design:

```text
Cookies can be site/domain scoped.
Web storage is origin scoped.
```

### 16.2 Subdomain split architecture

Jika arsitektur:

```text
app.example.com
api.example.com
admin.example.com
```

Maka:

- storage terpisah antar origin
- CORS diperlukan antar app/api
- cookie bisa dibagi jika Domain diset parent domain
- CSP bisa dibuat berbeda per origin
- service worker scope terpisah

Ini bagus untuk isolation, tapi lebih kompleks.

---

## 17. Origin and Service Worker Scope

Service worker hanya bisa mengontrol halaman dalam origin dan scope tertentu.

Jika service worker terdaftar dari:

```text
https://app.example.com/sw.js
```

dengan scope default:

```text
https://app.example.com/
```

Ia bisa mengintersepsi request navigasi/resource dalam scope origin tersebut.

Namun ia tidak bisa menjadi service worker untuk:

```text
https://api.example.com
```

karena origin berbeda.

Ia bisa mengintersepsi fetch dari page yang dikontrolnya ke API cross-origin dalam arti menerima fetch event untuk request yang dibuat page? Nuance-nya penting: service worker mengontrol client dan dapat observe/intercept fetches dari controlled page, termasuk cross-origin requests, tetapi kemampuan membaca/menyusun response tetap tunduk pada fetch/CORS rules. Jangan gunakan service worker sebagai asumsi bypass CORS.

### 17.1 Scope path

Jika service worker didaftarkan dengan scope:

```text
/app/
```

Maka ia tidak mengontrol:

```text
/admin/
```

kecuali scope diperluas dan diizinkan oleh server header tertentu.

Path penting untuk service worker scope, tetapi tetap di dalam origin yang sama.

---

## 18. Origin and Cookies: Inclusion Is Not Readability

Cookie punya dua aspek:

1. Apakah cookie dikirim dalam request?
2. Apakah JavaScript bisa membaca cookie?

HttpOnly cookie bisa dikirim tetapi tidak bisa dibaca JS.

```http
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax
```

Frontend JavaScript tidak bisa membaca:

```js
document.cookie
```

untuk cookie HttpOnly, tetapi browser bisa mengirimkannya otomatis pada request yang match.

### 18.1 Cookie inclusion depends on more than origin

Cookie inclusion dipengaruhi oleh:

- cookie domain
- cookie path
- Secure
- SameSite
- request URL
- top-level site
- credentials mode pada fetch/XHR
- browser privacy settings
- third-party cookie restrictions

Maka pertanyaan:

```text
Kenapa cookie tidak terkirim?
```

Tidak bisa dijawab hanya dengan “domain sama atau beda”.

Checklist awal:

```text
1. Request URL host apa?
2. Cookie Domain apa?
3. Cookie Path apa?
4. Scheme HTTP atau HTTPS?
5. Ada Secure?
6. SameSite apa?
7. Request same-site atau cross-site?
8. fetch credentials mode apa?
9. CORS credentialed response benar?
10. Browser memblok third-party cookie?
```

Detail cookies akan dibahas di Part 012 dan 013.

---

## 19. Origin and CORS: Reading Response Is the Key

Jika frontend di:

```text
https://app.example.com
```

memanggil:

```text
https://api.example.com/users
```

Maka request cross-origin.

Browser butuh CORS agar JavaScript boleh membaca response.

Server API harus mengembalikan header yang sesuai, misalnya:

```http
Access-Control-Allow-Origin: https://app.example.com
```

Jika memakai credentials/cookies:

```http
Access-Control-Allow-Credentials: true
```

Dan frontend harus memakai:

```js
fetch('https://api.example.com/users', {
  credentials: 'include'
})
```

Namun jangan loncat terlalu jauh. Bagian ini fokus pada URL/origin/site. CORS detail akan dibahas Part 010 dan 011.

Prinsip untuk sekarang:

> CORS dipicu oleh perbedaan origin, bukan perbedaan site.

`app.example.com` ke `api.example.com` tetap CORS meskipun same-site.

---

## 20. Secure Context: Scheme Matters

Banyak browser API hanya tersedia di secure context.

Umumnya:

```text
https://...
```

adalah secure context.

Localhost sering diberi perlakuan khusus untuk development.

Secure context memengaruhi API seperti:

- service worker
- geolocation
- clipboard advanced operations
- WebAuthn
- getUserMedia
- certain storage/security APIs

### 20.1 Mixed content

Jika page dibuka melalui HTTPS:

```text
https://app.example.com
```

lalu mencoba load resource HTTP:

```text
http://cdn.example.com/script.js
```

Browser bisa memblokir karena mixed content.

Scheme tidak bisa dianggap kosmetik.

HTTP vs HTTPS mengubah security posture.

---

## 21. URL Design for Frontend/API Collaboration

URL design adalah bagian dari API contract.

Desain buruk membuat frontend sulit:

- cache
- debug
- bookmark
- share
- retry
- observe
- reason about state

### 21.1 Good resource URL

```text
GET /api/orders/123
GET /api/orders?status=pending&cursor=abc
GET /api/customers/456/orders
```

Kelebihan:

- mudah dibaca
- mudah dicache selektif
- mudah ditrace
- mudah di-authorize secara konseptual
- mudah dibuat dokumentasi

### 21.2 Action URL yang masuk akal

Tidak semua operasi cocok dengan resource CRUD sederhana.

Contoh:

```text
POST /api/orders/123/cancel
POST /api/invoices/456/send-email
POST /api/reports/generate
```

Ini acceptable jika action adalah domain operation yang jelas.

Tapi hindari endpoint generik:

```text
POST /api/doAction?action=cancelOrder&id=123
```

Masalah:

- method semantics kabur
- observability buruk
- cache/proxy behavior tidak jelas
- auth mapping lebih sulit
- frontend sulit membangun client yang meaningful

### 21.3 URL stability

URL yang berubah sering merusak:

- bookmarks
- shared links
- browser history
- cache
- analytics
- deep linking
- external integrations

Jika resource identity stabil, URL sebaiknya stabil.

---

## 22. SPA Route vs API Route: Jangan Campur Tanpa Aturan

Contoh struktur umum:

```text
/app route: /orders/123
/api route: /api/orders/123
/assets:    /assets/app.abc123.js
```

CDN/server harus tahu bedanya.

### 22.1 Bug klasik: API response diganti HTML

Frontend code:

```js
const res = await fetch('/api/orders/123')
const data = await res.json()
```

Tetapi server fallback salah:

```text
GET /api/orders/123 -> index.html
```

Lalu browser error:

```text
Unexpected token '<', "<!doctype"... is not valid JSON
```

Root cause bukan JSON parser. Root cause adalah route/fallback configuration.

### 22.2 Rule praktis

Pisahkan namespace:

```text
/api/**     -> backend API
/assets/**  -> static assets
/*          -> SPA fallback
```

Pastikan fallback tidak menangkap API dan asset.

---

## 23. Redirect URLs and Open Redirect Risk

URL sering dipakai untuk redirect:

```text
/login?next=/dashboard
```

Atau:

```text
/login?redirect_uri=https://app.example.com/callback
```

Bahaya muncul jika server menerima arbitrary URL.

Contoh buruk:

```text
/login?next=https://evil.example/phishing
```

Setelah login, user diarahkan ke situs jahat.

### 23.1 Safe redirect rule

Lebih aman menerima relative path:

```text
next=/dashboard
```

Lalu validasi:

- harus diawali `/`
- tidak boleh `//evil.com`
- tidak boleh mengandung control characters
- tidak boleh path ke endpoint sensitif yang tak sesuai

Jika harus menerima absolute URL, gunakan allowlist origin presisi:

```text
https://app.example.com
https://admin.example.com
```

Jangan pakai substring matching.

---

## 24. Referrer and URL Leakage

Ketika user berpindah dari satu page ke page lain, browser bisa mengirim `Referer` header.

Jika URL berisi data sensitif:

```text
https://app.example.com/reset?token=secret
```

lalu page load third-party resource:

```html
<img src="https://analytics.example/pixel">
```

Ada risiko URL asal ikut terkirim sebagai referrer, tergantung Referrer-Policy.

Mitigasi:

- jangan taruh secret long-lived di URL
- gunakan Referrer-Policy
- token one-time short-lived
- exchange token segera
- hindari third-party loads pada halaman sensitive

Detail security headers akan dibahas di Part 021.

---

## 25. URL and Cache Busting

Frontend asset sering memakai fingerprint:

```text
/assets/app.8f3a91c.js
/assets/styles.a7c2e11.css
```

Ini lebih baik daripada query cache busting:

```text
/assets/app.js?v=123
```

Kenapa?

- fingerprint path lebih jelas sebagai immutable identity
- CDN lebih predictable
- cache invalidation lebih robust
- old and new assets bisa coexist

Namun query cache busting masih banyak dipakai dan bisa valid dalam beberapa sistem.

Strategi umum modern:

```text
HTML:          no-cache / revalidate
JS/CSS assets: long max-age, immutable, fingerprinted
API:           explicit resource-specific cache policy
```

Detail caching akan dibahas Part 014 dan 015.

---

## 26. URL and Connection Reuse

Browser dapat reuse connection untuk request ke origin yang sama, dan dalam kondisi tertentu untuk origin berbeda yang memenuhi syarat coalescing pada HTTP/2/3.

Namun mental model awal:

```text
fewer origins usually means fewer connection setup costs
more origins means more DNS/TLS/connection overhead
```

Contoh:

```text
https://app.example.com
https://api.example.com
https://cdn.example.com
https://fonts.example.net
https://analytics.vendor.com
```

Setiap origin bisa menambah:

- DNS lookup
- TCP/QUIC connection
- TLS handshake
- certificate validation
- privacy/security policy checks

Terlalu banyak origin memperumit performance dan security.

Namun memisahkan origin bisa memberi isolation dan caching benefit.

Ini trade-off arsitektur.

---

## 27. URL and Observability

URL adalah salah satu dimensi utama observability.

Di backend/APM, URL dipakai untuk:

- route grouping
- latency percentile
- error rate
- cache hit/miss
- rate limit bucket
- access audit
- WAF rules

Masalah jika URL terlalu high-cardinality.

Buruk:

```text
GET /api/search/john@example.com/2026/06/18/random-guid-abc
```

Lebih baik:

```text
GET /api/search?q=<redacted>&date=2026-06-18
```

Tetapi query juga bisa high-cardinality. Observability system perlu route templating dan redaction.

### 27.1 Path parameter vs query parameter

Rule praktis:

- Gunakan path untuk resource identity/hierarchy.
- Gunakan query untuk filtering/sorting/pagination/search modifiers.

Contoh:

```text
/orders/123               resource identity
/orders?status=pending    collection filter
```

Jangan absolutkan rule ini, tapi gunakan sebagai default.

---

## 28. Frontend Decision Matrix: Path-Based API vs Subdomain API

### Option A: Same-origin path-based API

```text
https://example.com/app
https://example.com/api
```

Atau:

```text
https://app.example.com
https://app.example.com/api
```

Kelebihan:

- CORS lebih sederhana atau tidak perlu.
- Cookie lebih sederhana.
- Local dev bisa dibuat mudah dengan proxy.
- Fewer origins.
- Browser policy lebih mudah dipahami.

Kekurangan:

- Origin isolation rendah.
- XSS impact bisa lebih besar.
- Security headers harus kompatibel untuk app dan API jika satu host.
- Routing/proxy config harus hati-hati.

### Option B: Cross-origin subdomain API

```text
https://app.example.com
https://api.example.com
```

Kelebihan:

- Origin isolation lebih jelas.
- API dan app bisa punya security headers berbeda.
- Deployment boundary jelas.
- CDN/gateway boundary jelas.

Kekurangan:

- Butuh CORS.
- Credentialed cookies lebih tricky.
- Local/staging/prod config lebih kompleks.
- Debugging lebih berat.

### Option C: BFF same-origin facade

```text
Browser -> https://app.example.com/api -> BFF -> internal services
```

Kelebihan:

- Browser berinteraksi same-origin.
- BFF menyembunyikan backend topology.
- Auth/session bisa lebih aman.
- Frontend payload bisa tailor-made.

Kekurangan:

- Tambahan service layer.
- BFF bisa menjadi bottleneck.
- Butuh governance agar tidak menjadi “god gateway”.

Untuk aplikasi enterprise/regulatory/case management yang kompleks, BFF sering masuk akal bila frontend butuh orchestration, auth boundary, audit-friendly interaction, dan stable UI contract.

---

## 29. Practical Debugging: Cara Menentukan Same-Origin/Same-Site

Saat melihat bug browser, lakukan ini.

### Step 1: Catat page origin

Di console:

```js
window.location.origin
```

Contoh:

```text
https://app.example.com
```

### Step 2: Parse target URL

```js
const target = new URL('https://api.example.com/users')
target.origin
```

Hasil:

```text
https://api.example.com
```

### Step 3: Bandingkan origin

```js
window.location.origin === target.origin
```

Jika false, request cross-origin.

### Step 4: Tentukan site secara konseptual

```text
app.example.com -> example.com
api.example.com -> example.com
```

Jika scheme sama dan registrable domain sama, same-site.

### Step 5: Tentukan konsekuensi

Jika cross-origin:

- CORS relevan.
- `Origin` header mungkin muncul.
- preflight mungkin muncul.
- response headers harus expose jika ingin dibaca.

Jika same-site tapi cross-origin:

- cookie SameSite mungkin masih allowed dalam beberapa konteks.
- tetap butuh CORS untuk JS read.
- storage tetap terpisah.

Jika cross-site:

- cookies lebih restrictive.
- CSRF/privacy model lebih ketat.
- third-party cookie restrictions bisa muncul.

---

## 30. Worked Example 1: App and API on Different Subdomains

Setup:

```text
SPA: https://app.example.com
API: https://api.example.com
```

Frontend:

```js
fetch('https://api.example.com/me', {
  credentials: 'include'
})
```

Analysis:

```text
same-origin? no
same-site? yes, assuming schemeful site https + example.com
CORS needed? yes
Cookie may be included? depends on cookie Domain, SameSite, Secure, credentials mode
localStorage shared? no
service worker shared? no
```

Required server response for credentialed CORS:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Cookie example:

```http
Set-Cookie: session=abc; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax
```

Potential bugs:

- Server returns `Access-Control-Allow-Origin: *` with credentials.
- Frontend forgets `credentials: 'include'`.
- Cookie set for `api.example.com` only when app expects domain-wide behavior.
- Cookie `Secure` not working on local HTTP.
- `SameSite=None` without `Secure` rejected by browser.

---

## 31. Worked Example 2: Localhost Port Difference

Setup:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8080
```

Frontend:

```js
fetch('http://localhost:8080/api/me')
```

Analysis:

```text
same-origin? no, port differs
same-site? localhost handling can be special, but for CORS origin comparison this is cross-origin
CORS needed? yes
Cookie shared? depends; port is not part of cookie domain, but fetch credentials/CORS still matter
localStorage shared? no because origin includes port
```

Common fix options:

Option 1: enable backend CORS for dev origin.

```text
Allow Origin: http://localhost:5173
```

Option 2: use dev server proxy.

```js
fetch('/api/me')
```

Browser sees request to:

```text
http://localhost:5173/api/me
```

Dev server proxies to:

```text
http://localhost:8080/api/me
```

CORS no longer appears in browser because browser request is same-origin.

Trade-off: dev proxy can hide production CORS issues.

---

## 32. Worked Example 3: Path-Based Same-Origin API

Setup:

```text
App: https://example.com
API: https://example.com/api
```

Frontend:

```js
fetch('/api/me')
```

Analysis:

```text
same-origin? yes
CORS needed? no
Cookie behavior? simple relative to origin
localStorage shared? same origin
service worker can potentially intercept depending scope
```

Advantages:

- simpler browser policy
- fewer CORS bugs
- easier credential handling

Risks:

- XSS in app can call `/api` directly
- API and app share origin-level trust
- security headers must be planned
- SPA fallback must not hijack `/api`

This model is common behind reverse proxy/BFF.

---

## 33. Worked Example 4: Fragment Routing

Setup:

```text
https://app.example.com/#/cases/CASE-123
```

Browser request:

```http
GET / HTTP/1.1
Host: app.example.com
```

Server does not see:

```text
#/cases/CASE-123
```

Consequences:

- server logs cannot directly tell which client route user opened
- backend cannot authorize based on fragment route
- analytics must be client-side aware
- refresh works even without server fallback

Better for modern apps usually:

```text
https://app.example.com/cases/CASE-123
```

with proper SPA fallback.

---

## 34. Worked Example 5: Query Secret Leakage

URL:

```text
https://app.example.com/invite?token=abc123
```

Page loads third-party script:

```html
<script src="https://cdn.vendor.com/widget.js"></script>
```

Potential leak paths:

- Referer header to vendor
- browser history
- logs
- screenshots
- support HAR files
- analytics events

Safer design:

1. Keep token short-lived.
2. Exchange token immediately via POST.
3. Remove token from URL using `history.replaceState`.
4. Use strict Referrer-Policy.
5. Avoid third-party resources on token handling page.
6. Redact token in logs.

Example:

```js
const url = new URL(window.location.href)
const token = url.searchParams.get('token')

if (token) {
  await fetch('/api/invitations/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  })

  url.searchParams.delete('token')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}
```

---

## 35. URL Invariants for Top 1% Frontend HTTP Reasoning

Gunakan invariant berikut sebagai pegangan.

### Invariant 1: Origin is not site

```text
origin = scheme + host + port
site   = scheme + registrable domain
```

`app.example.com` dan `api.example.com` bisa same-site tetapi cross-origin.

### Invariant 2: Path is not a browser security boundary

`/admin` dan `/public` pada origin yang sama tetap same-origin.

### Invariant 3: Query is visible operational data

Query bisa muncul di log, cache, history, analytics, dan referrer.

### Invariant 4: Fragment is client-side only

Server tidak menerima fragment.

### Invariant 5: Localhost aliases are not equivalent origins

`localhost`, `127.0.0.1`, dan `[::1]` berbeda sebagai host.

### Invariant 6: Port matters for origin

`localhost:5173` dan `localhost:8080` cross-origin.

### Invariant 7: Scheme matters

`http` dan `https` berbeda origin dan punya konsekuensi security besar.

### Invariant 8: Parse, do not regex

Gunakan `URL` dan `URLSearchParams` untuk membangun/memvalidasi URL.

### Invariant 9: Browser policy follows URL structure, not your infrastructure diagram

Walaupun dua host menuju cluster/backend yang sama, browser tetap membedakan berdasarkan URL.

### Invariant 10: URL design is architecture

Pilihan path vs subdomain vs BFF memengaruhi CORS, cookies, security, caching, performance, dan debugging.

---

## 36. Checklist Desain URL untuk Aplikasi Frontend Enterprise

Gunakan checklist ini saat design review.

### 36.1 Boundary

- Apa origin utama aplikasi?
- Apakah API same-origin atau cross-origin?
- Apakah admin/public dipisah origin?
- Apakah third-party resource perlu origin terpisah?
- Apakah iframe digunakan?

### 36.2 Cookie/Auth

- Cookie diset untuk host atau parent domain?
- Apakah API subdomain butuh credentialed CORS?
- Apakah `SameSite` cocok dengan flow login?
- Apakah local dev mereplikasi production enough?

### 36.3 Routing

- Namespace API jelas?
- Namespace assets jelas?
- SPA fallback tidak menangkap API?
- Refresh deep link bekerja?
- Reverse proxy rewrite transparan?

### 36.4 Query

- Query parameter canonical?
- Ada PII/secret di query?
- Query dipakai untuk shareable UI state?
- Pagination/filter/sort contract stabil?

### 36.5 Security

- Redirect target divalidasi dengan parse URL?
- Referrer leakage dipertimbangkan?
- IDN/homograph risk relevan?
- Mixed content dicegah?
- HTTPS enforced?

### 36.6 Observability

- URL route bisa digroup?
- High-cardinality path dihindari?
- Sensitive query redacted?
- Route template konsisten antara frontend/backend/APM?

### 36.7 Performance

- Origin count minimal tapi tetap aman?
- CDN/static asset origin jelas?
- Cache key behavior dipahami?
- Fingerprinted assets dipakai?

---

## 37. Common Anti-Patterns and Better Alternatives

### Anti-pattern 1: Treating subdomain as same-origin

Buruk:

```text
app.example.com dan api.example.com kan masih satu domain, harusnya tidak CORS.
```

Benar:

```text
Host berbeda berarti origin berbeda. CORS tetap relevan.
```

### Anti-pattern 2: Using query for secrets carelessly

Buruk:

```text
/callback?access_token=long-lived-token
```

Lebih baik:

```text
short-lived code -> server exchange -> HttpOnly session cookie
```

### Anti-pattern 3: Regex URL validation

Buruk:

```js
if (next.includes('example.com')) redirect(next)
```

Lebih baik:

```js
const url = new URL(next, 'https://app.example.com')
if (url.origin === 'https://app.example.com') redirect(url.href)
```

### Anti-pattern 4: Mixing SPA fallback and API routes

Buruk:

```text
/* -> index.html
```

sebelum API route.

Lebih baik:

```text
/api/**    -> API
/assets/** -> static
/*         -> index.html
```

### Anti-pattern 5: Switching between localhost and IP during debugging

Buruk:

```text
login at localhost, API call at 127.0.0.1
```

Lebih baik:

```text
choose one canonical local origin
```

---

## 38. Latihan Praktis

### Latihan 1: Same-origin atau tidak?

Untuk setiap pasangan, tentukan same-origin dan same-site.

```text
A. https://app.example.com dan https://api.example.com
B. https://example.com dan https://example.com:443
C. http://localhost:3000 dan http://localhost:8080
D. http://127.0.0.1:3000 dan http://localhost:3000
E. https://shop.example.co.uk dan https://auth.example.co.uk
F. https://example.com/a dan https://example.com/b
G. http://example.com dan https://example.com
```

Jawaban:

```text
A. cross-origin, same-site
B. same-origin, same-site
C. cross-origin, likely same-site-ish in local context but cross-origin for CORS
D. cross-origin, host berbeda
E. cross-origin, same-site jika registrable domain example.co.uk
F. same-origin, same-site
G. cross-origin, scheme berbeda; schemeful same-site treats scheme difference as site difference for relevant policy
```

### Latihan 2: Debug cookie tidak terkirim

Setup:

```text
Page:  http://localhost:5173
API:   http://localhost:8080
Cookie: Set-Cookie: session=abc; Secure; SameSite=None
```

Apa yang mencurigakan?

Jawaban:

- `Secure` cookie tidak akan bekerja di plain HTTP kecuali perlakuan local tertentu yang tidak boleh diasumsikan untuk semua skenario.
- Request cross-origin karena port berbeda.
- `SameSite=None` butuh `Secure` pada browser modern.
- Frontend perlu `credentials: 'include'`.
- Backend perlu credentialed CORS.

### Latihan 3: Server tidak melihat route

URL:

```text
https://app.example.com/#/cases/123
```

Kenapa server log hanya menunjukkan `GET /`?

Jawaban:

Fragment tidak dikirim dalam HTTP request. Routing setelah `#` terjadi di client.

### Latihan 4: Unexpected token `<` saat parse JSON

Frontend:

```js
const res = await fetch('/api/users')
const data = await res.json()
```

Error:

```text
Unexpected token '<'
```

Kemungkinan root cause:

- endpoint `/api/users` mengembalikan HTML, sering karena SPA fallback salah menangkap API route
- auth redirect mengembalikan HTML login page
- reverse proxy route salah
- server error page HTML

Langkah diagnosis:

- lihat Network response body
- lihat status code
- lihat content-type
- lihat final URL setelah redirect
- cek server/CDN routing rule

---

## 39. Mini Project: Origin/Site Inspector

Buat utility kecil di browser console atau app internal dev tool:

```js
function inspectUrl(input, base = window.location.href) {
  const current = new URL(window.location.href)
  const target = new URL(input, base)

  return {
    currentHref: current.href,
    currentOrigin: current.origin,
    targetHref: target.href,
    targetOrigin: target.origin,
    sameOrigin: current.origin === target.origin,
    targetProtocol: target.protocol,
    targetHost: target.hostname,
    targetPort: target.port || '(default)',
    targetPathname: target.pathname,
    targetSearch: target.search,
    targetHash: target.hash,
  }
}

console.table(inspectUrl('https://api.example.com/users'))
```

Extend utility ini dengan manual site detection untuk domain perusahaan Anda:

```js
function roughRegistrableDomain(hostname) {
  // Simplified only. Do not use for production PSL logic.
  const parts = hostname.split('.')
  return parts.slice(-2).join('.')
}
```

Catatan: fungsi di atas sengaja simplified. Production-grade site detection butuh Public Suffix List.

---

## 40. Ringkasan

Bagian ini membangun fondasi penting: URL bukan sekadar string endpoint.

Untuk frontend/browser, URL menentukan:

- target request
- origin
- site
- cookie behavior
- CORS behavior
- storage boundary
- service worker scope
- cache key
- routing
- observability
- security posture

Konsep paling penting:

```text
origin = scheme + host + port
site   = scheme + registrable domain
```

Dan rule praktis paling penting:

```text
Same-site does not mean same-origin.
Path is not a browser security boundary.
Fragment is not sent to server.
Query is operationally visible.
Scheme and port matter.
```

Jika Anda menguasai bagian ini, banyak bug yang biasanya terlihat misterius akan menjadi mekanis:

- CORS local dev
- cookie tidak terkirim
- redirect salah
- SPA refresh 404
- token bocor via URL
- API tertangkap fallback HTML
- storage tidak terbagi antar subdomain
- service worker tidak mengontrol route yang diharapkan

---

## 41. Referensi Resmi dan Lanjutan

Referensi ini dipakai sebagai basis konsep dan akan muncul lagi di bagian lanjutan:

1. WHATWG URL Standard — mendefinisikan model URL modern yang digunakan platform web.
2. MDN Web Docs — Same-Origin Policy.
3. MDN Web Docs — CORS.
4. web.dev — Same-site and same-origin.
5. web.dev — Schemeful Same-Site.
6. Public Suffix List — basis praktis untuk registrable domain/eTLD+1.
7. RFC 9110 — HTTP Semantics, untuk hubungan URL/resource/request semantics.

---

## 42. Status Seri

```text
Part 002 selesai.
Seri belum selesai.
Lanjut ke Part 003: HTTP Message Model: Request, Response, Header, Body.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-001.md">⬅️ Part 001 — Orientation: HTTP dari Sudut Pandang Browser</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-003.md">Part 003 — HTTP Message Model: Request, Response, Header, Body ➡️</a>
</div>
