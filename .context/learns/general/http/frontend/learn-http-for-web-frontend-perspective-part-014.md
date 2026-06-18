# learn-http-for-web-frontend-perspective-part-014.md

# Part 014 — HTTP Caching Part 1: Browser Cache Mental Model

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java Software Engineer yang ingin menguasai HTTP dari sisi browser/frontend  
> Status: Part 014 dari 035  
> Fokus: mental model browser HTTP cache, freshness, cache key, `Cache-Control`, private/shared cache, dan failure mode produksi

---

## 0. Apa yang Akan Dipelajari

Pada bagian sebelumnya kita sudah membangun fondasi HTTP message, headers, body, Fetch, CORS, cookies, session, CSRF, dan realitas auth SPA. Sekarang kita masuk ke salah satu topik yang paling sering terlihat sederhana tetapi paling sering menyebabkan bug produksi: **HTTP caching**.

Caching dari perspektif frontend bukan sekadar “biar cepat”. Caching adalah persoalan **correctness**, **privacy**, **deployment safety**, **latency**, **bandwidth**, **origin load**, dan **debuggability**.

Seorang frontend engineer biasa bertanya:

```text
Bagaimana supaya halaman lebih cepat?
```

Engineer yang lebih matang bertanya:

```text
Resource apa yang boleh dipakai ulang?
Selama berapa lama?
Oleh cache mana?
Dengan cache key apa?
Kapan harus divalidasi ulang?
Apa risikonya jika data stale?
Apa risikonya jika response privat masuk shared cache?
Bagaimana browser, CDN, service worker, dan aplikasi data cache saling berinteraksi?
```

Di bagian ini kita akan fokus pada **browser HTTP cache mental model**, bukan dulu detail ETag/304. ETag dan conditional request akan dibahas secara lebih dalam di Part 015.

Target setelah bagian ini:

1. Anda bisa menjelaskan perbedaan antara browser cache, CDN cache, service worker cache, dan application data cache.
2. Anda bisa membaca `Cache-Control` bukan sebagai hafalan directive, tetapi sebagai policy reuse response.
3. Anda bisa membedakan `no-store`, `no-cache`, `private`, `public`, `max-age`, `s-maxage`, `must-revalidate`, dan `immutable`.
4. Anda bisa memahami kenapa “tidak memasang header cache” bukan berarti “tidak cache”.
5. Anda bisa membuat strategi cache aman untuk HTML, static asset, API publik, API privat, dan response autentikasi.
6. Anda bisa mendiagnosis bug stale page, stale API, chunk 404 setelah deploy, dan potensi data leak karena cache.

---

## 1. Mental Model Utama: Cache adalah Mesin Reuse Response

HTTP cache menyimpan response yang pernah diterima untuk request tertentu, lalu mencoba memakai ulang response itu untuk request berikutnya jika aturan HTTP mengizinkan.

Secara sederhana:

```text
Request A
  ↓
Browser mencari cached response yang cocok
  ↓
Jika cocok dan masih fresh → pakai cached response
Jika cocok tapi stale → validasi / fetch ulang / tergantung policy
Jika tidak cocok → kirim request ke network
```

Tetapi “cocok” dan “boleh dipakai ulang” tidak sesederhana URL sama.

Cache perlu menjawab beberapa pertanyaan:

```text
1. Apakah response ini boleh disimpan?
2. Cache mana yang boleh menyimpan?
3. Request berikutnya dianggap cocok berdasarkan key apa?
4. Apakah cached response masih fresh?
5. Jika stale, apakah boleh tetap dipakai?
6. Jika harus validasi, header apa yang dipakai?
7. Jika response mengandung data user, apakah boleh disimpan oleh shared cache?
8. Jika ada header Authorization/Cookie, apakah cache behavior berubah?
9. Jika browser reload, apakah cache masih dipakai?
10. Jika service worker aktif, apakah HTTP cache masih menjadi sumber utama?
```

HTTP caching adalah aturan tentang **reuse**, bukan hanya storage.

---

## 2. Kenapa Caching adalah Correctness Problem

Caching sering diposisikan sebagai performance optimization. Itu benar, tapi tidak lengkap.

Caching bisa membuat aplikasi cepat. Caching juga bisa membuat aplikasi salah.

Contoh correctness bug:

### 2.1 User melihat data lama

```text
GET /api/profile
Response: { "name": "Budi", "role": "viewer" }
Cache-Control: max-age=3600
```

Jika role user baru saja berubah menjadi `admin`, browser atau intermediary cache mungkin masih memakai response lama selama satu jam.

Masalahnya bukan “cache lambat update”. Masalahnya adalah policy cache tidak sesuai dengan domain correctness.

### 2.2 User A melihat data User B

```text
GET /api/me
Cookie: session=alice

Response:
Cache-Control: public, max-age=300
Body: { "user": "Alice" }
```

Jika response personal ditandai `public`, shared cache seperti CDN/proxy bisa menyimpan dan menyajikan ulang ke user lain jika cache key tidak membedakan cookie/session.

Ini bukan bug performance. Ini **data leak**.

### 2.3 Deploy frontend rusak karena cache asset

```text
index.html cached terlalu lama
index.html menunjuk ke /assets/app.abc123.js
file app.abc123.js sudah dihapus setelah deploy
```

User membuka aplikasi, HTML lama dipakai, JS chunk lama tidak ada lagi, aplikasi blank.

### 2.4 API mutation terlihat tidak terjadi

User mengubah data, request sukses, tetapi screen tetap menampilkan cached GET lama.

Ini sering terjadi karena ada tiga cache yang tertukar:

```text
HTTP cache
application query cache
service worker cache
```

Masing-masing punya aturan invalidasi sendiri.

---

## 3. Peta Besar: Jenis Cache di Web App Modern

Frontend modern biasanya punya beberapa lapisan cache.

```text
Browser memory cache
Browser disk HTTP cache
Service Worker Cache API
CDN / edge cache
Reverse proxy cache
Backend application cache
Database cache
Frontend application data cache
Framework prefetch cache
BFCache / page lifecycle cache
```

Bagian ini fokus pada **HTTP cache** di browser dan shared cache. Tetapi engineer yang baik harus tahu bahwa masalah yang terlihat di Network tab bisa berasal dari lapisan berbeda.

---

## 4. Browser HTTP Cache vs Application Data Cache

Ini perbedaan yang sangat penting.

### 4.1 Browser HTTP cache

Browser HTTP cache bekerja di level HTTP response.

Contoh:

```http
GET /api/products?page=1 HTTP/1.1
Host: api.example.com

HTTP/1.1 200 OK
Cache-Control: max-age=60
Content-Type: application/json

{ "items": [...] }
```

Jika browser menganggap response ini cacheable, request berikutnya ke URL yang sama bisa dilayani dari HTTP cache.

Browser HTTP cache memahami:

```text
URL
method
status code
Cache-Control
Expires
ETag
Last-Modified
Vary
Age
request cache mode
browser reload semantics
```

Browser HTTP cache tidak memahami:

```text
React component state
TanStack Query key
Vue store
Redux action
business entity invalidation
user clicked Save
mutation succeeded
```

### 4.2 Application data cache

Application cache biasanya dikelola library seperti TanStack Query, SWR, Apollo, urql, Relay, Redux Toolkit Query, atau custom store.

Contoh query key:

```ts
['products', { page: 1, filter: 'active' }]
```

Application data cache memahami:

```text
screen state
query key
stale time
refetch on focus
mutation invalidation
optimistic update
application-level retry
```

Tetapi application data cache tidak secara otomatis memahami HTTP `Cache-Control` kecuali library Anda explicitly mengintegrasikannya.

### 4.3 Bug akibat mencampur keduanya

Banyak engineer berkata:

```text
Datanya masih cache.
```

Pertanyaan pertama harus:

```text
Cache yang mana?
```

Kemungkinan:

```text
1. Browser HTTP cache menyajikan response lama.
2. Service worker menyajikan response lama.
3. CDN menyajikan response lama.
4. React Query/SWR menyajikan data lama.
5. Backend cache menyajikan data lama.
6. Browser BFCache mengembalikan page lama.
7. LocalStorage/sessionStorage menyimpan snapshot lama.
```

Diagnosis tidak boleh berhenti di kata “cache”.

---

## 5. Private Cache vs Shared Cache

HTTP caching membedakan cache berdasarkan siapa yang bisa memakai cache tersebut.

### 5.1 Private cache

Private cache hanya digunakan oleh satu user agent/user.

Contoh:

```text
Browser HTTP cache di laptop user
```

Private cache boleh menyimpan response yang hanya cocok untuk user tertentu, jika policy mengizinkan.

### 5.2 Shared cache

Shared cache bisa digunakan oleh banyak user.

Contoh:

```text
CDN
corporate proxy
reverse proxy cache
edge cache
shared gateway cache
```

Shared cache sangat sensitif terhadap data personal.

Jika response mengandung data user dan shared cache menyimpannya tanpa cache key yang benar, risiko data leak sangat besar.

### 5.3 Directive `private`

```http
Cache-Control: private, max-age=300
```

Artinya response boleh disimpan oleh private cache seperti browser, tetapi tidak boleh disimpan oleh shared cache.

Cocok untuk response personal yang boleh dipakai ulang di browser user sendiri.

Contoh:

```http
GET /api/me/preferences HTTP/1.1

HTTP/1.1 200 OK
Cache-Control: private, max-age=60
Content-Type: application/json

{ "theme": "dark", "language": "id" }
```

### 5.4 Directive `public`

```http
Cache-Control: public, max-age=86400
```

Artinya response boleh disimpan oleh shared cache, asalkan directive lain juga mengizinkan.

Cocok untuk:

```text
static asset fingerprinted
public image
public product catalog jika tidak personalized
public documentation
public feature flag snapshot jika aman
```

Tidak cocok untuk:

```text
/api/me
/api/account
/api/orders
/api/billing
response bergantung cookie/session/authorization
```

### 5.5 Default aman untuk API privat

Untuk API privat yang membawa data user, default konservatif:

```http
Cache-Control: no-store
```

Atau jika ingin browser boleh revalidate tapi tidak shared cache:

```http
Cache-Control: private, no-cache
```

Namun `private, no-cache` masih membolehkan penyimpanan, hanya mengharuskan validasi sebelum reuse. Jika data sangat sensitif, gunakan `no-store`.

---

## 6. Cache Key: Response Disimpan Berdasarkan Apa?

Mental model sederhana sering mengatakan cache key adalah URL. Itu kurang lengkap.

Cache key minimum biasanya melibatkan:

```text
method + URL + selected request headers via Vary + partitioning context + cache implementation details
```

Untuk HTTP cache umum, `GET` dan `HEAD` adalah kandidat utama untuk caching. Method lain punya aturan lebih terbatas dan biasanya tidak dipakai sebagai cache lookup normal di browser.

### 6.1 URL sebagai bagian cache key

Request ini berbeda:

```http
GET /api/products?page=1
GET /api/products?page=2
GET /api/products?page=1&sort=name
GET /api/products?sort=name&page=1
```

Secara konseptual URL berbeda dapat menghasilkan cache entry berbeda.

Query parameter order bisa menjadi isu, tergantung normalisasi. Jangan mengandalkan browser/CDN menormalisasi sesuai keinginan domain Anda.

### 6.2 Method sebagai bagian cache semantics

```http
GET /api/products/123
HEAD /api/products/123
POST /api/products/123
```

Tidak sama secara semantic. Browser HTTP cache terutama bekerja untuk response GET/HEAD.

### 6.3 `Vary` memperluas cache key

`Vary` memberi tahu cache bahwa response bergantung pada request header tertentu.

Contoh:

```http
Vary: Accept-Encoding
```

Artinya response gzip dan brotli bisa berbeda.

Contoh lain:

```http
Vary: Accept-Language
```

Artinya response bahasa Indonesia dan Inggris bisa berbeda.

Request:

```http
Accept-Language: id-ID
```

berbeda dari:

```http
Accept-Language: en-US
```

Jika server mengirim konten lokal berbeda tetapi lupa `Vary: Accept-Language`, cache bisa menyajikan bahasa yang salah.

### 6.4 `Vary: Origin` untuk CORS

Jika response CORS berbeda per origin:

```http
Access-Control-Allow-Origin: https://app.example.com
Vary: Origin
```

`Vary: Origin` penting agar shared cache tidak menyajikan response dengan `Access-Control-Allow-Origin` milik origin A ke origin B.

Tanpa `Vary: Origin`, CDN/proxy bisa menyimpan response pertama lalu memberi header CORS yang salah ke origin berikutnya.

### 6.5 `Vary: Cookie` adalah tanda bahaya

Secara teknis bisa:

```http
Vary: Cookie
```

Tetapi ini sering menghancurkan cache hit ratio karena setiap variasi cookie bisa menjadi varian berbeda.

Untuk response personalized, lebih baik eksplisit:

```http
Cache-Control: private, no-cache
```

atau:

```http
Cache-Control: no-store
```

Untuk public asset, jangan membuat response bergantung cookie.

### 6.6 Cache partitioning browser modern

Browser modern semakin banyak mempartisi cache berdasarkan top-level site/origin context untuk mengurangi tracking lintas situs. Artinya resource yang sama dari domain pihak ketiga belum tentu berbagi cache antar top-level site seperti asumsi lama.

Implikasinya:

```text
Dulu: CDN third-party library mungkin sangat sering cache hit lintas situs.
Sekarang: privacy partitioning bisa mengurangi manfaat cache lintas situs.
```

Jadi jangan terlalu mengandalkan “semua user sudah punya jQuery dari CDN lain” sebagai strategi performance modern.

---

## 7. Freshness: Fresh vs Stale

HTTP cache harus menentukan apakah response masih **fresh**.

Fresh berarti:

```text
Cache boleh memakai response tanpa bertanya lagi ke origin.
```

Stale berarti:

```text
Response sudah melewati freshness lifetime. Cache tidak boleh begitu saja reuse, kecuali ada directive yang mengizinkan stale behavior tertentu atau validasi berhasil.
```

### 7.1 Freshness lifetime dari `max-age`

```http
Cache-Control: max-age=60
```

Artinya response fresh selama 60 detik sejak response diterima/disimpan, dengan detail perhitungan usia mengikuti aturan HTTP cache.

Timeline:

```text
t=0s   response diterima
t=20s  request ulang → cache hit, masih fresh
t=59s  request ulang → cache hit, masih fresh
t=61s  response stale → perlu revalidate/fetch tergantung policy
```

### 7.2 Freshness dari `Expires`

```http
Expires: Wed, 18 Jun 2026 10:00:00 GMT
```

`Expires` adalah mekanisme lama berbasis timestamp absolut.

Jika ada `Cache-Control: max-age`, biasanya `max-age` lebih diutamakan daripada `Expires`.

Masalah `Expires`:

```text
bergantung clock
lebih sulit untuk policy relatif
lebih rawan salah konfigurasi
```

Tetapi masih ditemukan di sistem lama.

### 7.3 Heuristic caching

Jika server tidak memberi `Cache-Control` atau `Expires`, cache masih bisa melakukan heuristic caching untuk beberapa response berdasarkan metadata seperti `Last-Modified`.

Ini poin penting:

```text
Tidak mengirim Cache-Control bukan berarti response tidak akan di-cache.
```

Karena itu API dan static hosting sebaiknya selalu eksplisit.

### 7.4 Age header

Shared cache bisa mengirim:

```http
Age: 120
```

Artinya response sudah berada di cache selama kira-kira 120 detik.

Jika response:

```http
Cache-Control: max-age=300
Age: 120
```

Maka sisa freshness kira-kira 180 detik.

`Age` sering berguna untuk membedakan response dari origin vs CDN cache.

---

## 8. `Cache-Control`: Directive Utama

`Cache-Control` adalah header utama untuk mengontrol caching modern.

Bentuk umum:

```http
Cache-Control: private, max-age=60, must-revalidate
```

Directive dapat muncul di request dan response. Pada bagian ini kita fokus response directives.

---

## 9. `max-age`: Boleh Dipakai Ulang Selama N Detik

```http
Cache-Control: max-age=3600
```

Artinya response fresh selama 3600 detik untuk cache yang menyimpannya.

Cocok untuk response yang aman dipakai ulang selama periode tertentu.

Contoh static asset:

```http
Cache-Control: public, max-age=31536000, immutable
```

Contoh public API yang berubah jarang:

```http
Cache-Control: public, max-age=300
```

Contoh user preference yang boleh sedikit stale hanya di browser user:

```http
Cache-Control: private, max-age=60
```

### 9.1 Risiko `max-age` terlalu panjang

Jika URL tidak fingerprinted dan Anda memberi `max-age` panjang:

```http
/app.js
Cache-Control: public, max-age=31536000
```

Saat Anda deploy versi baru ke URL yang sama, browser bisa terus memakai versi lama sampai satu tahun.

Solusi untuk asset panjang cache:

```text
Gunakan filename fingerprint/hash.
/app.8f3a92c1.js
```

Lalu aman memberi:

```http
Cache-Control: public, max-age=31536000, immutable
```

---

## 10. `s-maxage`: Khusus Shared Cache

```http
Cache-Control: max-age=60, s-maxage=600
```

`max-age` berlaku untuk cache umum/private. `s-maxage` berlaku untuk shared cache dan biasanya mengoverride `max-age` di shared cache.

Artinya:

```text
Browser cache: fresh 60 detik
CDN/shared cache: fresh 600 detik
```

Ini berguna saat Anda ingin CDN menyerap traffic lebih lama, tetapi browser user melakukan validasi lebih cepat.

Contoh:

```http
Cache-Control: public, max-age=60, s-maxage=600
```

Untuk API publik:

```text
Browser boleh cache 1 menit.
CDN boleh cache 10 menit.
```

### 10.1 Jangan pakai `s-maxage` untuk response privat

Response personal tidak boleh diberi `public`/`s-maxage` kecuali Anda benar-benar memahami cache key dan CDN behavior.

Untuk API user-specific:

```http
Cache-Control: private, no-store
```

atau:

```http
Cache-Control: private, no-cache
```

---

## 11. `public`: Shared Cache Boleh Menyimpan

```http
Cache-Control: public, max-age=86400
```

`public` membuat response boleh disimpan oleh shared cache meskipun kondisi tertentu biasanya membuat shared cache berhati-hati, misalnya response dengan Authorization dalam skenario tertentu.

Gunakan untuk response yang memang sama untuk banyak user.

Contoh aman:

```text
/assets/logo.svg
/assets/app.abc123.js
/public/catalog/categories
/public/docs/http-caching
```

Contoh berbahaya:

```text
/api/me
/api/orders
/api/billing
/api/notifications
```

Rule praktis:

```text
Jika response berbeda tergantung user login, jangan public.
```

---

## 12. `private`: Hanya Private Cache

```http
Cache-Control: private, max-age=300
```

`private` berarti shared cache tidak boleh menyimpan response, tetapi browser cache boleh.

Cocok untuk response personal yang tidak terlalu sensitif dan boleh stale sebentar di browser user sendiri.

Contoh:

```http
GET /api/me/preferences
Cache-Control: private, max-age=120
```

Namun untuk data sensitif seperti billing, token, medical, financial, legal/enforcement case detail, lebih aman:

```http
Cache-Control: no-store
```

Dalam sistem regulatori atau case management, default aman untuk data kasus sensitif biasanya `no-store`, kecuali ada alasan kuat dan kontrol tambahan.

---

## 13. `no-store`: Jangan Simpan

```http
Cache-Control: no-store
```

Ini directive paling kuat untuk mencegah cache menyimpan request/response.

Gunakan untuk:

```text
auth token response
session bootstrap sensitif
personal identifiable information berat
billing
medical/legal/regulatory case detail
admin data
one-time download link
private document
```

Contoh:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json

{ "accessToken": "...", "refreshToken": "..." }
```

### 13.1 `no-store` bukan hanya “jangan reuse”

`no-store` berarti cache tidak boleh menyimpan response. Ini berbeda dari `no-cache`.

Jika Anda ingin data sangat sensitif tidak tertulis ke disk cache, `no-store` lebih tepat.

### 13.2 Trade-off `no-store`

Kelebihan:

```text
lebih aman untuk data sensitif
mengurangi risiko stale sensitive data
mengurangi risiko shared cache leak
```

Kekurangan:

```text
lebih banyak network request
lebih sulit offline
lebih berat untuk latency
```

Security-sensitive system biasanya menerima trade-off ini.

---

## 14. `no-cache`: Boleh Simpan, Tapi Harus Revalidate Sebelum Reuse

Ini directive yang paling sering disalahpahami.

```http
Cache-Control: no-cache
```

Banyak orang mengira artinya “jangan cache”. Itu salah.

`no-cache` berarti:

```text
Cache boleh menyimpan response, tetapi sebelum memakai ulang response, cache harus validasi ke origin/server.
```

Jika validasi berhasil dan server berkata “tidak berubah”, cache bisa memakai body lama.

Contoh cocok:

```http
Cache-Control: no-cache
ETag: "abc123"
```

Flow berikutnya:

```text
1. Browser punya cached response.
2. Request berikutnya harus revalidate.
3. Browser mengirim conditional request.
4. Server menjawab 304 Not Modified jika belum berubah.
5. Browser memakai body lama dari cache.
```

ETag/304 detail ada di Part 015.

### 14.1 Kapan `no-cache` berguna?

Sangat berguna untuk HTML entrypoint SPA:

```http
/index.html
Cache-Control: no-cache
```

Artinya browser boleh menyimpan HTML, tetapi harus cek ke server sebelum memakai ulang. Jika HTML belum berubah, server bisa jawab 304 dan hemat bandwidth. Jika berubah, browser mendapat HTML baru.

Ini membantu mencegah user terjebak HTML lama setelah deploy.

### 14.2 `no-cache` untuk API privat

Untuk API privat:

```http
Cache-Control: private, no-cache
```

Artinya browser boleh menyimpan response user tersebut tetapi harus revalidate sebelum reuse, dan shared cache tidak boleh menyimpan.

Namun untuk data sensitif, tetap gunakan:

```http
Cache-Control: no-store
```

---

## 15. `must-revalidate`: Jangan Sajikan Stale Jika Tidak Bisa Validasi

```http
Cache-Control: max-age=60, must-revalidate
```

Artinya setelah response stale, cache harus validasi ke origin sebelum reuse. Jika origin tidak bisa dihubungi, cache tidak boleh begitu saja menyajikan stale response.

Tanpa `must-revalidate`, beberapa cache dalam kondisi tertentu mungkin bisa memakai stale response sesuai aturan/policy tertentu.

Cocok untuk response di mana data stale tidak boleh dipakai setelah freshness habis.

Contoh:

```http
Cache-Control: private, max-age=30, must-revalidate
```

Untuk data regulatory status yang berubah dan user harus melihat status cukup akurat, `must-revalidate` bisa membantu.

Namun jika data benar-benar tidak boleh stale, gunakan `no-store` atau validasi aplikasi eksplisit.

---

## 16. `immutable`: URL Ini Tidak Akan Berubah Selama Fresh

```http
Cache-Control: public, max-age=31536000, immutable
```

`immutable` memberi sinyal bahwa resource tidak akan berubah selama freshness lifetime.

Cocok untuk fingerprinted assets:

```text
/assets/app.a1b2c3d4.js
/assets/styles.8f9e0a1b.css
/assets/logo.3e4f5a.svg
```

Tidak cocok untuk:

```text
/index.html
/app.js tanpa hash
/api/config
/api/me
```

### 16.1 Rule asset modern

Untuk file yang namanya mengandung content hash:

```http
Cache-Control: public, max-age=31536000, immutable
```

Untuk file entrypoint seperti HTML:

```http
Cache-Control: no-cache
```

Atau:

```http
Cache-Control: max-age=0, must-revalidate
```

Tergantung strategi hosting.

---

## 17. `max-age=0`: Langsung Stale

```http
Cache-Control: max-age=0
```

Artinya response dianggap stale segera setelah disimpan, sehingga request berikutnya perlu validasi sebelum reuse.

Sering dikombinasikan:

```http
Cache-Control: max-age=0, must-revalidate
```

Mirip tujuan praktis dengan `no-cache`, tetapi semantic dan interaksi detail bisa berbeda.

Untuk HTML, banyak konfigurasi memakai salah satu dari:

```http
Cache-Control: no-cache
```

atau:

```http
Cache-Control: max-age=0, must-revalidate
```

Yang penting: jangan memberi cache panjang untuk HTML entrypoint SPA kecuali Anda punya strategi invalidasi sangat matang.

---

## 18. `stale-while-revalidate` dan `stale-if-error`

Directive ini penting untuk UX/performance modern, tetapi harus dipakai dengan hati-hati.

### 18.1 `stale-while-revalidate`

```http
Cache-Control: max-age=60, stale-while-revalidate=300
```

Artinya:

```text
Fresh 60 detik.
Setelah stale, selama 300 detik berikutnya cache boleh menyajikan response stale sambil melakukan revalidation di background.
```

Cocok untuk:

```text
public content
catalog yang boleh sedikit stale
homepage fragment
non-critical config publik
```

Tidak cocok untuk:

```text
saldo rekening
izin akses
status enforcement case kritikal
auth session validity
security decision
```

### 18.2 `stale-if-error`

```http
Cache-Control: max-age=60, stale-if-error=600
```

Artinya jika origin error, cache boleh menyajikan stale response dalam window tertentu.

Cocok untuk availability:

```text
public docs
marketing page
public catalog
read-only non-critical data
```

Risiko:

```text
User melihat data lama saat sistem sebenarnya berubah.
```

Dalam sistem kritikal, jangan memakai stale-if-error untuk data yang mempengaruhi keputusan hukum, finansial, izin akses, atau enforcement workflow kecuali jelas diberi label stale dan domain menyetujui.

---

## 19. `Expires` dan `Pragma`

### 19.1 `Expires`

Header lama:

```http
Expires: Wed, 18 Jun 2026 10:00:00 GMT
```

Jika timestamp masa depan, response fresh sampai waktu tersebut.

Jika timestamp masa lalu:

```http
Expires: 0
```

atau tanggal lama, response dianggap expired.

Tetapi untuk HTTP modern, gunakan `Cache-Control` sebagai sumber utama.

### 19.2 `Pragma: no-cache`

`Pragma` adalah header lama HTTP/1.0. Masih kadang dikirim untuk kompatibilitas legacy:

```http
Pragma: no-cache
```

Untuk response modern, jangan mengandalkan `Pragma`; gunakan `Cache-Control`.

Konfigurasi legacy kadang memakai:

```http
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Expires: 0
```

Untuk aplikasi modern, yang paling penting adalah `Cache-Control` yang benar.

---

## 20. Status Code dan Cacheability

Tidak semua status code diperlakukan sama untuk cache.

Secara umum, response terhadap GET dengan status tertentu bisa cacheable jika header mengizinkan atau secara default heuristik mengizinkan.

Contoh status yang sering relevan:

```text
200 OK
203 Non-Authoritative Information
204 No Content
206 Partial Content
300 Multiple Choices
301 Moved Permanently
308 Permanent Redirect
404 Not Found
405 Method Not Allowed
410 Gone
414 URI Too Long
501 Not Implemented
```

Yang sering mengejutkan: **404 bisa di-cache**.

### 20.1 404 yang di-cache

Jika user meminta asset yang belum ada:

```http
GET /assets/app.abc123.js
HTTP/1.1 404 Not Found
Cache-Control: max-age=600
```

Browser/CDN bisa cache 404 selama 10 menit.

Ini bisa memperparah masalah deploy jika file muncul setelahnya tetapi 404 sudah terlanjur cached.

Untuk dynamic missing resource, caching 404 kadang bagus. Untuk asset deploy race, perlu strategi hati-hati.

### 20.2 Redirect cache

301 dan 308 bisa cached sebagai permanent redirect.

Jika salah konfigurasi:

```text
http://app.example.com → https://wrong.example.com
```

Browser bisa menyimpan redirect itu. Debugging terasa aneh karena request tidak lagi menyentuh origin yang Anda perbaiki.

Part redirect sudah dibahas di Part 016 nanti, tetapi caching redirect perlu diingat sejak sekarang.

---

## 21. Request Header yang Mengubah Cache Behavior

Cache behavior bukan hanya response header. Request juga bisa membawa directive.

Contoh saat user reload:

```http
Cache-Control: max-age=0
```

Atau hard reload:

```http
Cache-Control: no-cache
Pragma: no-cache
```

Browser DevTools “Disable cache” juga mengubah behavior saat DevTools terbuka.

### 21.1 Fetch `cache` option

`fetch()` punya opsi cache mode:

```ts
fetch('/api/data', { cache: 'no-store' })
fetch('/api/data', { cache: 'reload' })
fetch('/api/data', { cache: 'no-cache' })
fetch('/api/data', { cache: 'force-cache' })
fetch('/api/data', { cache: 'only-if-cached', mode: 'same-origin' })
```

Namun jangan salah: opsi fetch ini berinteraksi dengan browser HTTP cache, bukan menggantikan server-side cache policy.

Server tetap harus mengirim header yang benar.

### 21.2 `cache: 'no-store'` pada fetch

```ts
await fetch('/api/me', { cache: 'no-store' })
```

Ini memberi instruksi ke browser untuk tidak menggunakan/menyimpan HTTP cache untuk request itu. Tetapi dari sisi keamanan dan shared cache, server tetap harus mengirim:

```http
Cache-Control: no-store
```

Frontend tidak bisa mengamankan shared cache di CDN hanya dengan opsi `fetch()`.

---

## 22. Browser Reload Semantics

Perilaku reload tidak selalu sama.

### 22.1 Normal navigation

Browser memakai cache sesuai freshness.

```text
Fresh cached response → bisa dipakai langsung.
Stale response → revalidate/fetch.
```

### 22.2 Reload

User menekan reload. Browser biasanya akan memaksa validasi untuk banyak resource, sering dengan request directive seperti `max-age=0`.

### 22.3 Hard reload

Browser lebih agresif mengambil ulang resource dari network.

### 22.4 Empty cache and hard reload

Di Chrome DevTools, opsi ini menghapus cache lalu reload. Berguna untuk debugging, tetapi tidak merepresentasikan user normal.

### 22.5 DevTools Disable cache

Jika “Disable cache” aktif di DevTools, Anda bisa salah menyimpulkan cache tidak bekerja.

Rule debugging:

```text
Saat menguji cache, pastikan tahu apakah DevTools Disable cache aktif.
```

---

## 23. Memory Cache, Disk Cache, dan “from memory cache”

DevTools bisa menampilkan:

```text
from memory cache
from disk cache
from prefetch cache
from service worker
```

### 23.1 Memory cache

Biasanya cache cepat untuk resource dalam session/tab/process browser. Hilang lebih cepat.

### 23.2 Disk cache

Persist lebih lama di storage browser.

### 23.3 Service worker

Jika response berasal dari service worker, DevTools bisa menunjukkan service worker sebagai source.

Service worker bukan HTTP cache biasa. Ia adalah programmable proxy yang bisa memilih network/cache secara manual.

### 23.4 Jangan terlalu bergantung pada label DevTools

Label DevTools membantu, tetapi diagnosis matang tetap melihat:

```text
status code
response headers
request headers
Age
Cache-Control
ETag/Last-Modified
Size column
Timing
Initiator
service worker status
CDN cache headers
```

---

## 24. CDN Cache vs Browser Cache

CDN cache adalah shared cache di edge.

Flow umum:

```text
Browser → CDN edge → origin server
```

Jika CDN punya cached response:

```text
Browser → CDN edge → cached response
```

Browser mungkin masih menganggap itu network response, karena dari browser request tetap pergi ke CDN. Tetapi origin tidak terkena.

### 24.1 Header untuk melihat CDN cache

Tiap CDN punya header sendiri, misalnya:

```text
CF-Cache-Status
X-Cache
X-Served-By
Age
Via
Server-Timing
```

Tidak standar sepenuhnya.

### 24.2 Browser cache hit vs CDN cache hit

Browser cache hit:

```text
request mungkin tidak keluar dari browser
DevTools size: from disk cache/from memory cache
origin/CDN tidak menerima request
```

CDN cache hit:

```text
browser tetap membuat network request
CDN menjawab tanpa origin
Age mungkin meningkat
CDN cache status mungkin HIT
```

### 24.3 Purge CDN tidak menghapus browser cache

Ini kesalahan umum.

```text
CDN purge ≠ browser cache purge
```

Jika browser sudah menyimpan asset dengan:

```http
Cache-Control: max-age=31536000
```

Menghapus CDN cache tidak membuat browser user otomatis membuang cached asset.

Itulah kenapa fingerprinted asset sangat penting.

---

## 25. Service Worker Cache: Programmable but Dangerous

Service worker bisa intercept request:

```js
self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request));
});
```

Ini sangat kuat. Juga sangat berbahaya jika strategi tidak matang.

Service worker dapat:

```text
serve stale app shell
cache API response privat
mengabaikan Cache-Control
menyajikan fallback offline
mengubah request routing
membuat bug hanya terjadi di browser yang pernah install PWA
```

Part 027 akan membahas service worker detail. Untuk sekarang cukup ingat:

```text
Jika DevTools menunjukkan response from ServiceWorker, jangan hanya melihat HTTP Cache-Control. Ada kode JavaScript network proxy yang ikut menentukan hasil.
```

---

## 26. BFCache Bukan HTTP Cache

Browser Back/Forward Cache atau BFCache menyimpan halaman utuh dalam memory agar navigasi back/forward sangat cepat.

Ini bukan HTTP cache.

BFCache bisa membuat user kembali ke page dengan JavaScript state lama tanpa network request.

Misalnya:

```text
User membuka detail case.
User navigasi ke halaman lain.
Status case berubah di server.
User tekan Back.
Browser mengembalikan page dari BFCache.
UI terlihat lama.
```

Solusi bukan hanya `Cache-Control` HTTP. Anda mungkin perlu mendengar event page lifecycle seperti `pageshow` dan melakukan refetch jika `event.persisted`.

Jadi lagi-lagi: “stale UI” tidak selalu HTTP cache.

---

## 27. Strategi Cache untuk SPA Modern

Untuk SPA modern, pola umum yang aman:

```text
HTML entrypoint: revalidate setiap kali.
Fingerprinted static assets: cache sangat lama.
API privat/sensitif: no-store atau private/no-cache.
API publik: cache eksplisit sesuai tolerance stale.
Images/fonts: cache lama jika fingerprinted/versioned.
Config runtime: pendek dan eksplisit.
```

### 27.1 HTML entrypoint

```http
Cache-Control: no-cache
```

atau:

```http
Cache-Control: max-age=0, must-revalidate
```

Kenapa?

HTML biasanya menunjuk ke asset versi terbaru:

```html
<script src="/assets/app.abc123.js"></script>
```

Jika HTML terlalu lama di-cache, user bisa menjalankan versi app lama.

### 27.2 Fingerprinted JS/CSS

```http
Cache-Control: public, max-age=31536000, immutable
```

Karena jika content berubah, filename berubah:

```text
app.abc123.js → app.def456.js
```

URL lama tetap valid jika file lama masih disimpan di CDN selama masa transisi.

### 27.3 Non-fingerprinted asset

Untuk `/app.js` tanpa hash:

```http
Cache-Control: no-cache
```

atau pendek:

```http
Cache-Control: max-age=60
```

Lebih baik: jangan pakai non-fingerprinted asset untuk bundle produksi.

### 27.4 Runtime config

Contoh:

```http
/config.json
Cache-Control: no-cache
```

atau:

```http
Cache-Control: max-age=60, must-revalidate
```

Runtime config sering berubah lebih sering daripada bundle.

### 27.5 API privat

Default aman:

```http
Cache-Control: no-store
```

Untuk data personal non-sensitif yang boleh revalidate:

```http
Cache-Control: private, no-cache
```

### 27.6 API publik

Contoh:

```http
Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=300
```

Namun pastikan response benar-benar tidak personalized.

---

## 28. Pattern Cache Header Berdasarkan Resource Type

### 28.1 HTML SPA entrypoint

```http
Cache-Control: no-cache
Content-Type: text/html; charset=utf-8
```

Atau:

```http
Cache-Control: max-age=0, must-revalidate
```

Tujuan:

```text
Browser boleh menyimpan, tetapi harus cek update sebelum reuse.
```

### 28.2 Fingerprinted assets

```http
Cache-Control: public, max-age=31536000, immutable
```

Tujuan:

```text
Cache sangat lama karena URL berubah saat content berubah.
```

### 28.3 Public images versioned

```http
Cache-Control: public, max-age=604800
```

Atau jika fingerprinted:

```http
Cache-Control: public, max-age=31536000, immutable
```

### 28.4 API privat sensitif

```http
Cache-Control: no-store
```

Tambahan legacy jika diperlukan:

```http
Pragma: no-cache
Expires: 0
```

### 28.5 API privat non-sensitif tapi personal

```http
Cache-Control: private, no-cache
ETag: "..."
```

### 28.6 API publik short-lived

```http
Cache-Control: public, max-age=30, s-maxage=300
```

### 28.7 Public content tolerant stale

```http
Cache-Control: public, max-age=300, stale-while-revalidate=600, stale-if-error=86400
```

### 28.8 Download sensitif

```http
Cache-Control: no-store
Content-Disposition: attachment; filename="case-report.pdf"
```

---

## 29. Personalized Response: Red Flags

Response harus dianggap personalized jika bergantung pada:

```text
Cookie
Authorization header
session
user id
tenant id
role/permission
locale user-specific
AB test user assignment
feature flags user-specific
account state
organization membership
```

Untuk response personalized, hindari:

```http
Cache-Control: public
```

Hindari cache key yang tidak memasukkan user/tenant identity di shared cache.

Default:

```http
Cache-Control: private, no-cache
```

atau:

```http
Cache-Control: no-store
```

Dalam multi-tenant enterprise/regulatory system, berhati-hati dengan URL seperti:

```http
GET /api/cases/123
```

Walaupun case ID sama, response bisa berbeda tergantung role, masking, jurisdiction, permission, workflow stage, dan tenant.

Jangan public-cache response seperti itu.

---

## 30. Authorization Header dan Caching

Request dengan `Authorization` header memiliki aturan caching khusus untuk shared cache. Shared cache umumnya tidak boleh reuse response untuk request lain kecuali response explicitly mengizinkan lewat directive tertentu.

Namun jangan jadikan ini alasan untuk lalai.

Jika response memakai bearer token:

```http
GET /api/me
Authorization: Bearer eyJ...
```

Response sebaiknya eksplisit:

```http
Cache-Control: no-store
```

atau minimal:

```http
Cache-Control: private, no-cache
```

Jangan berharap semua intermediary/proxy/CDN dikonfigurasi sempurna.

---

## 31. Cookie dan Caching

Cookie membuat caching lebih rumit.

Request:

```http
GET /api/dashboard
Cookie: session=abc; theme=dark; experiment=A
```

Response bisa bergantung pada cookie.

Jika CDN tidak bypass cache untuk cookie request atau tidak vary dengan benar, bisa terjadi leak.

### 31.1 Static asset jangan bergantung cookie

Asset seperti:

```text
/assets/app.abc123.js
/assets/style.def456.css
```

seharusnya tidak perlu cookie.

Jika CDN menerima cookie untuk asset static, cache hit ratio turun. Banyak deployment menghapus/ignore cookie untuk static asset path.

### 31.2 API with cookie session

Untuk cookie-authenticated API:

```http
Cache-Control: no-store
```

atau:

```http
Cache-Control: private, no-cache
```

Jangan public-cache.

---

## 32. Cache-Control pada Request vs Response

Response:

```http
Cache-Control: max-age=3600
```

Memberi instruksi bagaimana response boleh disimpan/dipakai ulang.

Request:

```http
Cache-Control: no-cache
```

Memberi instruksi ke cache dalam path request, misalnya “validasi dulu sebelum memberi cached response”.

Contoh request reload:

```http
GET /index.html HTTP/1.1
Cache-Control: max-age=0
```

Jangan bingung ketika melihat `Cache-Control` di request. Yang mengatur policy utama resource biasanya response header dari server.

---

## 33. Debugging Cache di DevTools

Saat debugging cache, jangan hanya lihat status code.

Checklist:

```text
1. Request URL persis apa?
2. Method apa?
3. Status code apa?
4. Response header Cache-Control apa?
5. Ada Expires?
6. Ada ETag/Last-Modified?
7. Ada Age?
8. Ada Vary?
9. Ada CDN-specific cache header?
10. Size menunjukkan from disk cache/memory cache/service worker?
11. Timing menunjukkan network atau instant?
12. DevTools Disable cache aktif?
13. Request dikirim karena reload/hard reload?
14. Ada service worker aktif?
15. Ada application data cache yang menyajikan data lama?
16. Ada BFCache karena back navigation?
```

### 33.1 Interpretasi umum Network tab

```text
Status 200, Size from disk cache
→ browser HTTP cache hit.

Status 200, Age: 120, CDN header HIT
→ CDN cache hit, browser tetap network ke CDN.

Status 304
→ browser revalidated, body dipakai dari cache.

Status 200, no Age, long TTFB
→ kemungkinan origin hit.

Status 200 from ServiceWorker
→ service worker intercept.
```

### 33.2 Request Headers penting

Perhatikan:

```http
Cache-Control: max-age=0
If-None-Match: "..."
If-Modified-Since: ...
Pragma: no-cache
```

Ini menunjukkan browser sedang melakukan validasi/reload.

### 33.3 Response Headers penting

Perhatikan:

```http
Cache-Control: ...
ETag: ...
Last-Modified: ...
Expires: ...
Age: ...
Vary: ...
```

---

## 34. Common Production Bug #1: HTML Cached Too Long

### Symptom

User masih melihat UI lama setelah deploy.

### Evidence

```http
GET /index.html
Cache-Control: public, max-age=86400
```

### Root cause

HTML entrypoint di-cache satu hari. Browser tidak mengambil HTML baru yang menunjuk ke asset baru.

### Fix

```http
Cache-Control: no-cache
```

atau:

```http
Cache-Control: max-age=0, must-revalidate
```

### Prevention invariant

```text
HTML entrypoint boleh disimpan, tetapi harus cepat revalidate.
Static asset boleh cache panjang hanya jika URL fingerprinted.
```

---

## 35. Common Production Bug #2: Static Asset Not Fingerprinted

### Symptom

Sebagian user menjalankan JS lama walaupun deploy sudah selesai.

### Evidence

```http
GET /app.js
Cache-Control: public, max-age=31536000
```

### Root cause

URL `/app.js` tetap sama, tetapi content berubah. Browser punya izin memakai versi lama selama setahun.

### Fix

Gunakan fingerprint:

```text
/app.abc123.js
/app.def456.js
```

Header:

```http
Cache-Control: public, max-age=31536000, immutable
```

HTML entrypoint menunjuk versi terbaru.

---

## 36. Common Production Bug #3: Personalized API Public Cached

### Symptom

User melihat data user lain, atau data tenant lain.

### Evidence

```http
GET /api/me
Cache-Control: public, max-age=300
```

CDN cache status:

```http
X-Cache: HIT
```

### Root cause

Response personal ditandai public dan disimpan shared cache.

### Fix

```http
Cache-Control: no-store
```

atau:

```http
Cache-Control: private, no-cache
```

Konfigurasi CDN untuk bypass API private.

### Prevention invariant

```text
Jika response bergantung identity, permission, tenant, role, atau session, jangan shared-cache kecuali desain cache key dan privacy sudah terbukti benar.
```

---

## 37. Common Production Bug #4: CORS Header Cached Wrong

### Symptom

Origin A berhasil. Origin B gagal CORS secara random.

### Evidence

Server mengembalikan dynamic ACAO:

```http
Access-Control-Allow-Origin: https://app-a.example.com
```

Tetapi tidak ada:

```http
Vary: Origin
```

### Root cause

CDN/shared cache menyimpan response untuk Origin A lalu menyajikannya ke Origin B.

### Fix

```http
Access-Control-Allow-Origin: https://app-a.example.com
Vary: Origin
```

Atau gunakan fixed ACAO jika hanya satu origin.

---

## 38. Common Production Bug #5: API Still Stale After Mutation

### Symptom

User klik Save, API mutation sukses, tetapi screen tetap menampilkan data lama.

### Possible root causes

```text
1. Application query cache belum invalidated.
2. Browser HTTP cache menyajikan GET lama.
3. CDN cache menyajikan GET lama.
4. Backend cache belum invalidated.
5. Race condition: GET lama selesai setelah mutation.
```

### Diagnosis

Lihat Network:

```text
Apakah GET benar-benar dikirim?
Apakah response from memory/disk cache?
Apakah CDN HIT?
Apakah response body memang lama dari server?
Apakah application state overwritten oleh response lama?
```

### Fix depends on cache layer

Jika application cache:

```text
invalidate query setelah mutation
optimistic update dengan rollback
cancel in-flight stale query
```

Jika HTTP cache:

```http
Cache-Control: no-store
```

atau gunakan revalidation policy benar.

Jika CDN:

```text
bypass private API
short TTL
surrogate key purge
```

---

## 39. Common Production Bug #6: DevTools Disable Cache Menipu

### Symptom

Engineer menguji dan berkata:

```text
Cache tidak bekerja.
```

### Evidence

DevTools terbuka dengan “Disable cache” aktif.

### Root cause

Chrome/DevTools mem-bypass cache selama DevTools terbuka dan opsi aktif.

### Fix

Matikan “Disable cache”, ulangi test di normal browsing profile, atau gunakan controlled browser automation.

---

## 40. Common Production Bug #7: Service Worker Serving Old App

### Symptom

Hanya sebagian user melihat versi lama. Hard reload kadang tidak cukup.

### Evidence

Network tab:

```text
from ServiceWorker
```

Application tab menunjukkan service worker aktif.

### Root cause

Service worker cache strategy menyajikan app shell lama atau update lifecycle belum membuat worker baru mengontrol page.

### Fix

Perbaiki service worker versioning/update strategy. Jangan cache HTML entrypoint secara cache-first tanpa revalidation.

Part 027 akan membahas detail.

---

## 41. Browser Cache dan Security Boundary

Cache bisa menjadi security boundary problem.

Hal yang perlu dihindari:

```text
1. Menyimpan token di cacheable response.
2. Public-cache response personal.
3. Cache API berdasarkan URL tanpa tenant/user separation.
4. Meng-cache file download sensitif.
5. Mengandalkan frontend fetch option untuk melindungi shared cache.
6. Mengirim PII di URL karena URL bisa muncul di cache/log/history.
```

### 41.1 Sensitive URL problem

Jangan membuat URL seperti:

```text
/download?token=secret-jwt
/case?id=123&ssn=...
/reset-password?token=...
```

URL bisa tersimpan di:

```text
browser history
proxy logs
server logs
Referer header
analytics
cache key
```

Cache discussion sering membuka masalah desain URL/security.

---

## 42. Cache dan Regulatory/Case Management System

Untuk sistem regulatory, enforcement lifecycle, case management, atau workflow defensible, caching harus dipikirkan bersama auditability dan correctness.

Contoh resource:

```text
case details
case timeline
evidence attachment
assignee list
permission matrix
workflow status
decision record
notice document
public registry view
```

Tidak semua sama.

### 42.1 Case detail private

```http
Cache-Control: no-store
```

Alasan:

```text
sensitive
role-dependent
tenant/jurisdiction-dependent
audit-heavy
stale could mislead decision
```

### 42.2 Public registry entry

Jika memang publik:

```http
Cache-Control: public, max-age=60, s-maxage=600
```

Namun perlu domain decision: apakah publik boleh stale 10 menit?

### 42.3 Static legal document template

Jika versioned:

```http
Cache-Control: public, max-age=31536000, immutable
```

### 42.4 Evidence attachment download

Biasanya:

```http
Cache-Control: no-store
Content-Disposition: attachment
```

### 42.5 Workflow state

Untuk state yang mempengaruhi allowed action:

```http
Cache-Control: no-store
```

Atau revalidate ketat dengan ETag jika domain mengizinkan.

Invariant penting:

```text
Jika cached stale response bisa membuat user mengambil action yang tidak lagi valid, caching harus sangat konservatif atau action endpoint harus tetap enforce state server-side.
```

Frontend tidak boleh menjadi sumber kebenaran workflow permission.

---

## 43. Cache Policy as Contract

Cache header adalah contract lintas tim:

```text
Frontend team
Backend team
Platform team
CDN team
Security team
Compliance team
```

Setiap endpoint seharusnya punya deklarasi:

```text
Resource type: HTML/static/API/download
Personalized: yes/no
Sensitive: yes/no
Shared cache allowed: yes/no
Browser cache allowed: yes/no
Freshness tolerance: N seconds
Stale allowed on error: yes/no
Validation supported: ETag/Last-Modified/no
Invalidation mechanism: fingerprint/purge/revalidate/mutation invalidation
```

Tanpa ini, cache policy menjadi kumpulan magic header.

---

## 44. Cache Decision Framework

Gunakan pertanyaan ini saat mendesain endpoint/resource.

### 44.1 Apakah response sama untuk semua user?

Jika tidak:

```text
Jangan shared-cache.
Gunakan private/no-store/no-cache.
```

### 44.2 Apakah response mengandung data sensitif?

Jika ya:

```http
Cache-Control: no-store
```

### 44.3 Apakah URL berubah saat content berubah?

Jika ya, misalnya fingerprinted:

```http
Cache-Control: public, max-age=31536000, immutable
```

Jika tidak:

```text
Jangan cache panjang.
```

### 44.4 Berapa lama stale masih acceptable?

Jika 0:

```http
Cache-Control: no-cache
```

atau:

```http
Cache-Control: no-store
```

Jika 60 detik:

```http
Cache-Control: max-age=60
```

Jika CDN boleh lebih lama:

```http
Cache-Control: max-age=60, s-maxage=600
```

### 44.5 Apakah stale boleh dipakai saat origin error?

Jika ya:

```http
Cache-Control: stale-if-error=600
```

Jika tidak:

```http
Cache-Control: must-revalidate
```

### 44.6 Apakah response bervariasi berdasarkan request header?

Jika ya, set `Vary` dengan hati-hati:

```http
Vary: Accept-Encoding, Accept-Language
```

Untuk CORS dynamic origin:

```http
Vary: Origin
```

---

## 45. Cache Policy Examples

### 45.1 SPA production build

```text
/index.html
  Cache-Control: no-cache

/assets/app.[hash].js
  Cache-Control: public, max-age=31536000, immutable

/assets/styles.[hash].css
  Cache-Control: public, max-age=31536000, immutable

/assets/logo.[hash].svg
  Cache-Control: public, max-age=31536000, immutable

/config.json
  Cache-Control: max-age=60, must-revalidate
```

### 45.2 Auth/session API

```text
POST /auth/login
  Cache-Control: no-store

POST /auth/refresh
  Cache-Control: no-store

GET /api/me
  Cache-Control: no-store
```

Atau untuk low-sensitivity profile display:

```text
GET /api/me/preferences
  Cache-Control: private, no-cache
```

### 45.3 Public catalog

```text
GET /api/public/categories
  Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=600
```

### 45.4 Case management private data

```text
GET /api/cases/{id}
  Cache-Control: no-store

GET /api/cases/{id}/timeline
  Cache-Control: no-store

GET /api/cases/{id}/attachments/{attachmentId}
  Cache-Control: no-store
```

### 45.5 Public regulatory publication

```text
GET /public/enforcement-notices/{id}
  Cache-Control: public, max-age=300, s-maxage=3600
```

Jika legal requirement menuntut immediate correction, TTL harus lebih pendek atau pakai purge.

---

## 46. Backend/Java Implementation Notes

Karena konteks Anda Java engineer, berikut contoh Spring-style header policy.

### 46.1 No-store untuk API sensitif

```java
@GetMapping("/api/me")
public ResponseEntity<UserProfileDto> me() {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(profileService.currentUserProfile());
}
```

Header result kira-kira:

```http
Cache-Control: no-store
```

### 46.2 Private no-cache

```java
@GetMapping("/api/me/preferences")
public ResponseEntity<UserPreferencesDto> preferences() {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noCache().cachePrivate())
        .body(preferenceService.getCurrentUserPreferences());
}
```

Pastikan framework menghasilkan header sesuai ekspektasi. Jangan hanya percaya fluent API; verifikasi di integration test.

### 46.3 Static asset di reverse proxy/CDN

Sering static asset tidak diserve oleh Java app, tetapi oleh CDN/Nginx/object storage.

Konfigurasi harus konsisten:

```text
HTML: no-cache
Assets hashed: public, max-age=31536000, immutable
```

### 46.4 Test header contract

Contoh test konseptual:

```java
mockMvc.perform(get("/api/me"))
    .andExpect(header().string("Cache-Control", containsString("no-store")));
```

Untuk endpoint sensitif, cache header adalah bagian dari contract test.

---

## 47. Frontend Implementation Notes

### 47.1 Jangan hanya mengandalkan fetch cache mode

```ts
await fetch('/api/me', { cache: 'no-store' });
```

Ini bisa membantu browser behavior, tetapi server tetap harus mengirim:

```http
Cache-Control: no-store
```

### 47.2 Untuk critical data, refetch bukan jaminan jika HTTP cache salah

```ts
queryClient.invalidateQueries(['case', caseId]);
```

Jika `fetch` berikutnya dilayani browser/CDN cache lama, application cache tetap menerima data lama.

Jadi invalidasi application cache harus disertai HTTP cache policy yang benar.

### 47.3 Cache busting query parameter

Kadang orang memakai:

```ts
fetch(`/api/me?t=${Date.now()}`)
```

Ini memaksa URL unik dan menghindari cache. Tetapi ini bukan desain ideal untuk API sensitif.

Lebih baik:

```http
Cache-Control: no-store
```

Gunakan cache busting hanya sebagai debugging atau untuk resource yang memang didesain demikian.

### 47.4 Jangan mematikan semua cache global

Anti-pattern:

```text
Semua response diberi no-store.
```

Ini aman secara sederhana, tetapi buruk untuk performance static asset dan public content.

Lebih baik klasifikasikan resource.

---

## 48. Cache dan Build/Deployment Safety

### 48.1 Keep old assets after deploy

Jika HTML lama masih menunjuk asset lama, asset lama sebaiknya tetap tersedia untuk beberapa waktu.

Deploy berbahaya:

```text
1. Deploy versi baru.
2. Hapus semua asset lama.
3. User dengan HTML lama mencoba load chunk lama.
4. 404.
```

Deploy lebih aman:

```text
1. Asset hashed bersifat immutable.
2. HTML baru menunjuk asset baru.
3. Asset lama tetap tersedia selama TTL/cache window.
4. Cleanup dilakukan setelah aman.
```

### 48.2 Chunk splitting and lazy routes

SPA dengan lazy-loaded chunks punya risiko:

```text
User membuka app.
App shell versi lama loaded.
Beberapa jam kemudian user navigasi ke lazy route.
Browser meminta old chunk.
Old chunk sudah dihapus.
Aplikasi error.
```

Mitigasi:

```text
keep old chunks
handle chunk load failure
prompt user refresh
service worker strategy matang
short HTML cache
```

### 48.3 Runtime config compatibility

Jika `/config.json` cached lama, frontend bisa memanggil API endpoint lama setelah deploy.

Policy config harus jelas.

---

## 49. Observability untuk Cache

Cache yang tidak terlihat akan sulit didiagnosis.

Tambahkan header observability jika memungkinkan:

```http
Cache-Control: public, max-age=60, s-maxage=600
Age: 123
Server-Timing: cdn-cache;desc="HIT"
X-Request-Id: ...
```

CDN biasanya punya header sendiri:

```text
X-Cache: HIT
CF-Cache-Status: HIT
Fastly-Cache: HIT
```

Jangan mengandalkan satu header universal.

### 49.1 Log origin hit vs cache hit

Jika origin log tidak menunjukkan request, mungkin:

```text
browser cache hit
CDN cache hit
service worker served response
request blocked before network
```

### 49.2 User report debugging

Minta evidence:

```text
URL
timestamp
browser
DevTools HAR
response headers
request headers
screenshot Network tab
whether hard reload helps
whether incognito helps
whether unregistering service worker helps
```

---

## 50. Anti-Patterns

### 50.1 “Cache-Control tidak diset berarti tidak cache”

Salah. Browser/cache bisa memakai heuristic caching.

### 50.2 `no-cache` dianggap sama dengan `no-store`

Salah.

```text
no-cache: boleh store, harus revalidate sebelum reuse.
no-store: jangan store.
```

### 50.3 Public cache untuk authenticated API

Berbahaya.

### 50.4 Cache panjang untuk non-fingerprinted asset

Berbahaya untuk deploy.

### 50.5 Semua endpoint `no-store`

Aman tapi tidak efisien. Static asset harus cache optimal.

### 50.6 `Vary: *` atau `Vary` berlebihan

Bisa menghancurkan cacheability.

### 50.7 Mengabaikan `Vary: Origin` pada dynamic CORS

Bisa membuat CORS behavior random via CDN.

### 50.8 Cache busting query param sebagai desain utama

Biasanya tanda header policy tidak benar.

### 50.9 Menganggap CDN purge menyelesaikan browser cache

Tidak.

### 50.10 Service worker cache-first untuk HTML tanpa update strategy

Sering menyebabkan user stuck di app lama.

---

## 51. Checklist Desain Cache per Resource

Gunakan tabel mental ini.

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---|---|
| Response sama untuk semua user? | shared cache mungkin boleh | jangan shared-cache |
| Response sensitif? | `no-store` | bisa pertimbangkan cache |
| URL fingerprinted? | long cache + immutable | jangan long cache |
| Boleh stale N detik? | `max-age=N` | `no-cache`/`no-store` |
| CDN boleh cache lebih lama? | `s-maxage` | jangan set `s-maxage` |
| Boleh stale saat error? | `stale-if-error` | `must-revalidate`/tanpa stale |
| Response berbeda berdasarkan header? | set `Vary` | jangan vary berlebihan |
| Dynamic CORS per Origin? | `Vary: Origin` | fixed ACAO atau no Vary Origin |
| Auth/cookie-dependent? | `private`/`no-store` | public mungkin boleh |

---

## 52. Praktik Lab

### Lab 1: Lihat cache static asset

1. Buka website modern.
2. DevTools → Network.
3. Filter JS/CSS.
4. Klik asset hashed.
5. Perhatikan:

```text
Cache-Control
ETag
Age
Size
Timing
```

6. Reload normal.
7. Hard reload.
8. Bandingkan behavior.

### Lab 2: Bedakan browser cache dan CDN cache

Cari response dengan header:

```http
Age: ...
X-Cache: HIT
```

Jika browser tetap melakukan network request tetapi CDN `HIT`, itu CDN cache, bukan browser cache.

### Lab 3: Test HTML cache

Buka `/index.html` aplikasi Anda.

Pastikan header bukan:

```http
Cache-Control: public, max-age=31536000
```

Untuk SPA, itu hampir pasti salah.

### Lab 4: Test API privat

Buka endpoint seperti `/api/me` atau `/api/profile`.

Pastikan tidak ada:

```http
Cache-Control: public
```

Untuk data sensitif, pastikan:

```http
Cache-Control: no-store
```

### Lab 5: Simulasi stale application cache vs HTTP cache

1. Buat endpoint GET dengan `Cache-Control: max-age=300`.
2. Fetch dari frontend.
3. Mutasi data di server.
4. Fetch lagi.
5. Amati apakah browser memakai cached response.
6. Ubah header ke `no-store`.
7. Bandingkan.

---

## 53. Mini Design Exercise

Anda punya aplikasi case management dengan resource:

```text
/index.html
/assets/app.[hash].js
/assets/style.[hash].css
/api/me
/api/cases/{id}
/api/public/notices/{id}
/api/lookups/countries
/api/lookups/violation-types
/api/config/runtime
/api/cases/{id}/evidence/{fileId}
```

Tentukan cache policy.

Jawaban yang defensible:

```text
/index.html
  Cache-Control: no-cache

/assets/app.[hash].js
/assets/style.[hash].css
  Cache-Control: public, max-age=31536000, immutable

/api/me
  Cache-Control: no-store

/api/cases/{id}
  Cache-Control: no-store

/api/public/notices/{id}
  Cache-Control: public, max-age=300, s-maxage=3600
  Catatan: hanya jika notice benar-benar publik dan stale 1 jam di CDN diterima domain.

/api/lookups/countries
  Cache-Control: public, max-age=86400, s-maxage=604800
  Catatan: jika tidak personalized dan jarang berubah.

/api/lookups/violation-types
  Cache-Control: public, max-age=300, s-maxage=3600
  Catatan: tergantung frekuensi perubahan dan dampak compliance.

/api/config/runtime
  Cache-Control: max-age=60, must-revalidate
  atau no-cache jika perubahan config harus cepat.

/api/cases/{id}/evidence/{fileId}
  Cache-Control: no-store
```

Prinsipnya:

```text
Public and versioned → cache aggressively.
Private and sensitive → no-store.
Public but mutable → short TTL/revalidation.
Entrypoint deployment coordinator → revalidate.
```

---

## 54. Ringkasan Mental Model

HTTP cache bukan tempat penyimpanan pasif. Ia adalah decision engine.

Setiap request akan melewati pertanyaan:

```text
Ada cached response yang cocok?
Masih fresh?
Boleh dipakai oleh cache ini?
Boleh dipakai untuk request ini?
Harus validasi dulu?
Boleh stale?
```

Directive penting:

```text
max-age=N              fresh selama N detik
s-maxage=N            fresh N detik khusus shared cache
public                shared cache boleh menyimpan
private               hanya private cache boleh menyimpan
no-store              jangan simpan
no-cache              boleh simpan, harus revalidate sebelum reuse
must-revalidate       kalau stale harus validasi, jangan serve stale sembarangan
immutable             selama fresh, content tidak berubah
stale-while-revalidate boleh serve stale sambil revalidate
stale-if-error        boleh serve stale jika origin error
```

Klasifikasi resource adalah inti:

```text
HTML entrypoint → revalidate
fingerprinted asset → cache very long immutable
private sensitive API → no-store
private non-sensitive API → private/no-cache jika perlu
public API → explicit TTL
public mutable data → short TTL or validation
```

---

## 55. Invariant yang Harus Dipegang

1. **Tidak ada cache policy universal yang benar untuk semua resource.**
2. **`no-cache` bukan `no-store`.**
3. **Response personal tidak boleh masuk shared cache.**
4. **Cache panjang aman hanya jika URL berubah saat content berubah.**
5. **CDN purge tidak menghapus browser cache.**
6. **Service worker bisa mengabaikan intuisi HTTP cache.**
7. **Stale UI tidak selalu HTTP cache.**
8. **Cache adalah bagian dari API contract.**
9. **Cache policy harus mempertimbangkan domain correctness, bukan hanya speed.**
10. **Jika stale response bisa membuat user mengambil keputusan salah, cache harus konservatif.**

---

## 56. Referensi

- RFC 9111 — HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
- MDN — HTTP caching: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- MDN — Cache-Control header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- web.dev — Prevent unnecessary network requests with the HTTP Cache: https://web.dev/articles/http-cache
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html

---

## 57. Status Seri

```text
Part 014 selesai.
Seri belum selesai.
Lanjut ke Part 015: HTTP Caching Part 2: ETag, Last-Modified, Revalidation, and 304.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-013.md">⬅️ Part 013 — Cookies Part 2: Session, CSRF, Auth, and SPA Reality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-015.md">Part 015 — HTTP Caching Part 2: ETag, Last-Modified, Revalidation, and 304 ➡️</a>
</div>
