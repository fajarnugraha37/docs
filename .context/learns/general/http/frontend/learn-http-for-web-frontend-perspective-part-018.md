# learn-http-for-web-frontend-perspective-part-018.md

# Part 018 — Resource Loading: HTML Parser, Preload Scanner, Priority, and Waterfall

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `018 / 035`  
> Topik: resource loading dari perspektif browser/frontend  
> Target pembaca: Java software engineer yang ingin memahami HTTP web/frontend sampai level production-grade

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas HTTP sebagai pesan, method, status code, header, body, `fetch`, CORS, cookie, caching, redirect, dan content negotiation.

Bagian ini naik satu level ke pertanyaan yang sering jauh lebih penting untuk performa frontend:

> “Browser sudah tahu resource apa saja yang dibutuhkan halaman? Kalau sudah tahu, kapan resource itu ditemukan, kapan diminta, seberapa tinggi prioritasnya, apakah ia memblokir rendering, dan bagaimana kita membacanya dari waterfall?”

HTTP dari sisi frontend tidak hanya soal `GET /api/users`. Browser juga membuat request untuk:

- dokumen HTML;
- stylesheet;
- JavaScript;
- module graph;
- gambar;
- font;
- video;
- iframe;
- favicon;
- manifest;
- preload;
- prefetch;
- service worker;
- API calls;
- analytics;
- ads;
- third-party SDK;
- source map dalam development;
- WebSocket/SSE connection;
- browser update checks tertentu;
- dan berbagai request internal yang muncul akibat platform web.

Dari sudut pandang top 1% engineer, resource loading bukan sekadar “network request banyak atau sedikit”. Ini adalah masalah **dependency scheduling**.

Halaman lambat biasanya bukan karena satu request lambat saja, tetapi karena browser baru menemukan resource penting terlambat, resource penting kalah prioritas, cache tidak bekerja, origin terlalu banyak, resource render-blocking terlalu berat, atau waterfall membentuk rantai dependensi yang tidak perlu.

---

## 1. Mental Model Inti

Bayangkan browser sebagai sistem runtime yang memiliki beberapa subsistem paralel:

```text
URL/navigation
   ↓
Network stack
   ↓
HTML parser ───────────────┐
   ↓                       │
DOM construction            │
   ↓                       │
CSSOM construction          │
   ↓                       │
Render tree/layout/paint    │
                           │
Preload scanner ────────────┘
   ↓
Resource scheduler
   ↓
HTTP cache / service worker / network
   ↓
Connection pool / TLS / HTTP/2 / HTTP/3
```

Ada beberapa ide penting:

1. **Browser tidak menunggu seluruh HTML selesai untuk mulai fetch resource.** Saat parser menemukan resource, browser bisa langsung menjadwalkan request.
2. **Browser punya preload scanner.** Ia mencoba menemukan resource lebih awal dari HTML yang masih diparse agar critical resource tidak terlambat.
3. **Tidak semua resource punya prioritas sama.** CSS render-blocking biasanya lebih penting daripada gambar jauh di bawah viewport.
4. **Tidak semua request memblokir rendering.** Sebagian memblokir parsing, sebagian memblokir render, sebagian hanya mempengaruhi UX setelah halaman muncul.
5. **Waterfall adalah gejala dependency graph.** Ia bukan hanya daftar request kronologis.
6. **HTTP/2/3 tidak menghapus critical path.** Multiplexing membantu, tetapi late discovery, blocking CSS, JavaScript execution, cache miss, dan origin handshake tetap bisa dominan.
7. **Optimasi terbaik sering bukan “lebih cepatkan server”, tetapi “ubah kapan browser menemukan dan memprioritaskan resource”.**

---

## 2. Browser Loading Pipeline secara Konseptual

Ketika user membuka URL:

```text
https://app.example.com/dashboard
```

browser kira-kira melakukan alur berikut:

```text
1. Resolve URL dan policy navigation.
2. Cek cache / service worker / navigation preload.
3. DNS lookup bila koneksi belum ada.
4. TCP/TLS atau QUIC handshake.
5. Kirim request dokumen HTML.
6. Terima HTML secara streaming.
7. HTML parser mulai membangun DOM.
8. Preload scanner mencari resource lebih awal.
9. Resource scheduler memberi prioritas request.
10. CSS diunduh dan diparse menjadi CSSOM.
11. Script blocking bisa menghentikan parser.
12. DOM + CSSOM menghasilkan render tree.
13. Layout, paint, compositing.
14. Gambar/font/script tambahan terus dimuat.
15. JavaScript membuat request API, route hydration, lazy chunks.
16. Halaman terus berubah setelah initial load.
```

Hal yang sering dilupakan: browser tidak hanya “download halaman”. Browser menjalankan pipeline kompleks yang sebagian network-bound, sebagian CPU-bound, sebagian policy-bound, dan sebagian cache-bound.

---

## 3. HTML Parser: Mesin yang Menemukan Dependency

HTML adalah dokumen yang diparse secara incremental. Saat bytes HTML masuk, parser mulai membangun DOM.

Contoh:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/app.js"></script>
  </head>
  <body>
    <img src="/hero.jpg" alt="Hero">
  </body>
</html>
```

Browser tidak perlu menunggu seluruh HTML selesai. Saat menemukan:

```html
<link rel="stylesheet" href="/assets/app.css">
```

browser bisa menjadwalkan request CSS.

Saat menemukan:

```html
<script src="/assets/app.js"></script>
```

browser harus mempertimbangkan apakah script itu memblokir parsing.

Saat menemukan:

```html
<img src="/hero.jpg">
```

browser menjadwalkan image request, tetapi prioritasnya tergantung konteks seperti posisi, ukuran, viewport, lazy loading, dan sinyal lain.

### 3.1 Parser-blocking Script

Script klasik tanpa `async`, `defer`, atau `type="module"` adalah salah satu penyebab utama waterfall buruk.

```html
<script src="/app.js"></script>
```

Secara konseptual:

```text
HTML parser menemukan script
   ↓
parser berhenti
   ↓
browser fetch script bila belum ada
   ↓
browser execute script
   ↓
parser lanjut
```

Kenapa parser harus berhenti? Karena JavaScript bisa mengubah dokumen yang sedang diparse:

```js
document.write('<link rel="stylesheet" href="/late.css">');
```

Atau membaca/mengubah DOM yang belum lengkap.

Jadi dari sudut browser, script klasik sinkron adalah dependency yang harus dihormati.

### 3.2 CSS dan Render Blocking

CSS tidak selalu memblokir parsing HTML, tetapi CSS biasanya memblokir rendering. Browser perlu CSSOM untuk memastikan halaman tidak dicat dengan style salah lalu berubah drastis.

```html
<link rel="stylesheet" href="/app.css">
```

Konsekuensi:

```text
HTML bisa terus diparse
CSS diunduh paralel
render pertama menunggu CSS penting
```

Ini sebabnya CSS besar, CSS yang terlambat ditemukan, atau CSS dari origin lambat dapat menunda first render.

### 3.3 CSS juga Bisa Memblokir Script

Ada interaksi penting:

```html
<link rel="stylesheet" href="/app.css">
<script src="/app.js"></script>
```

Script mungkin butuh computed style atau layout. Karena itu browser sering perlu memastikan stylesheet sebelumnya sudah tersedia sebelum mengeksekusi script.

Akibatnya dependency chain bisa menjadi:

```text
HTML → CSS download/parse → JS execute → parser lanjut → render
```

Banyak engineer hanya melihat “JS lambat”, padahal JS tertahan menunggu CSS.

---

## 4. Preload Scanner: Browser Tidak Mau Menunggu Parser Utama

HTML parser bisa terhenti oleh script blocking. Agar resource penting tidak terlalu terlambat ditemukan, browser memakai mekanisme yang sering disebut **preload scanner** atau speculative parser.

Tugasnya:

- memindai HTML yang sudah diterima;
- menemukan resource seperti CSS, JS, image, font tertentu, preload hints;
- menjadwalkan fetch sebelum parser utama mencapai titik itu;
- mengurangi late discovery.

Contoh:

```html
<head>
  <script src="/slow-blocking-script.js"></script>
  <link rel="stylesheet" href="/app.css">
</head>
```

Tanpa speculative scanning, browser mungkin baru menemukan `/app.css` setelah script selesai. Dengan scanner, browser bisa melihat `link` lebih awal dan mulai fetch.

Namun scanner tidak mahakuasa. Ia sulit atau tidak bisa menemukan resource yang dibuat secara dinamis oleh JavaScript:

```js
const script = document.createElement('script');
script.src = '/late-discovered-feature.js';
document.head.appendChild(script);
```

Atau URL yang tersembunyi di CSS:

```css
.hero {
  background-image: url('/hero-bg.avif');
}
```

Browser harus mengunduh dan memparse CSS dulu sebelum tahu bahwa `/hero-bg.avif` diperlukan.

Inilah akar dari banyak kasus LCP image terlambat.

---

## 5. Discovery Time: Kapan Resource Diketahui Browser?

Untuk setiap resource, tanyakan:

> “Kapan browser pertama kali tahu resource ini dibutuhkan?”

Ini sering lebih penting daripada ukuran file.

### 5.1 Early-discovered Resource

Contoh:

```html
<head>
  <link rel="stylesheet" href="/assets/app.css">
  <script type="module" src="/assets/app.js"></script>
</head>
```

Browser menemukan CSS dan JS sejak awal.

### 5.2 Late-discovered Resource

Contoh hero image sebagai background CSS:

```html
<div class="hero"></div>
```

```css
.hero {
  background-image: url('/images/hero.avif');
}
```

Waterfall:

```text
HTML download
   ↓
CSS discovered
   ↓
CSS download
   ↓
CSS parse
   ↓
hero image discovered
   ↓
image download
   ↓
LCP delayed
```

Jika hero image adalah LCP, ini buruk.

### 5.3 Very Late-discovered Resource

Contoh route-based JavaScript:

```js
const Dashboard = lazy(() => import('./DashboardPage'));
```

Flow:

```text
HTML
  ↓
main JS
  ↓
main JS execute
  ↓
router decides route
  ↓
dynamic import chunk discovered
  ↓
chunk download
  ↓
component render
  ↓
component triggers API/image/font
```

Ini bisa benar untuk code splitting, tetapi buruk bila chunk tersebut berada di critical path halaman pertama.

### 5.4 Discovery Matrix

| Resource | Umumnya ditemukan oleh | Risiko late discovery |
|---|---:|---:|
| HTML document | navigation | rendah |
| CSS `<link>` di head | HTML parser/preload scanner | rendah |
| classic script di head | HTML parser/preload scanner | rendah, tapi blocking |
| module import dependency | module graph fetch | sedang |
| CSS background image | CSS parser | tinggi |
| font dari `@font-face` | CSS parser + layout need | tinggi |
| dynamic import | JS execution | tinggi |
| API call | JS execution | tinggi |
| lazy image | layout/viewport heuristics | sengaja ditunda |
| third-party SDK children | third-party script execution | sangat tinggi |

---

## 6. Render-blocking, Parser-blocking, and Critical Path

Tidak semua resource sama. Ada beberapa kategori perilaku.

### 6.1 Parser-blocking

Resource yang menghentikan HTML parser.

Biasanya:

```html
<script src="/app.js"></script>
```

tanpa `defer`, `async`, atau module semantics.

Konsekuensi:

```text
DOM construction tertunda
resource setelah script mungkin terlambat ditemukan
render/hydration tertunda
```

### 6.2 Render-blocking

Resource yang membuat browser menunda first render.

Biasanya:

```html
<link rel="stylesheet" href="/app.css">
```

Konsekuensi:

```text
HTML parser bisa lanjut
namun paint menunggu CSSOM yang diperlukan
```

### 6.3 Execution-blocking

Resource yang tidak hanya harus diunduh, tetapi harus dieksekusi sebelum UI siap.

Contoh SPA:

```text
HTML shell downloaded
  ↓
JS bundle downloaded
  ↓
JS parsed/compiled
  ↓
JS executed
  ↓
framework bootstraps
  ↓
route resolved
  ↓
API calls start
  ↓
UI data visible
```

Di sini network waterfall hanya sebagian cerita. CPU parse/compile/execute bisa dominan.

### 6.4 User-visible Critical Path

Critical path bukan hanya render pertama. Untuk user, bisa jadi:

- halaman mulai menampilkan skeleton;
- heading utama muncul;
- hero image muncul;
- konten utama muncul;
- tombol bisa diklik;
- data dashboard tampil;
- route transition selesai;
- search result pertama muncul.

Untuk setiap page, definisikan critical user-visible moment.

Contoh dashboard enterprise:

```text
Critical moment = user melihat tabel kasus + filter utama usable
```

Maka resource critical mungkin:

- HTML shell;
- CSS layout utama;
- JS route/dashboard chunk;
- auth/session check;
- `/api/cases?status=open`;
- font hanya jika layout bergantung pada font;
- icon set mungkin tidak critical;
- analytics jelas tidak critical.

---

## 7. JavaScript Loading Attributes

### 7.1 Classic Script Tanpa Attribute

```html
<script src="/app.js"></script>
```

Perilaku konseptual:

```text
fetch + execute segera
parser blocked saat execution
order terjaga
```

Cocok untuk kasus langka yang benar-benar membutuhkan script sinkron. Untuk aplikasi modern, sering menjadi default buruk.

### 7.2 `defer`

```html
<script defer src="/app.js"></script>
```

Perilaku:

```text
fetch paralel dengan HTML parsing
execute setelah HTML parsed
order antar defer scripts terjaga
DOMContentLoaded menunggu defer scripts selesai
```

Ini cocok untuk banyak script aplikasi klasik.

### 7.3 `async`

```html
<script async src="/analytics.js"></script>
```

Perilaku:

```text
fetch paralel
execute segera ketika selesai download
order tidak dijamin
parser bisa terinterupsi saat execution
```

Cocok untuk script independen seperti analytics, tetapi tetap hati-hati karena execution dapat mengganggu main thread.

### 7.4 `type="module"`

```html
<script type="module" src="/app.js"></script>
```

Module script secara default deferred-like: tidak memblokir parser seperti classic blocking script, tetapi punya module graph.

```text
main module discovered
  ↓
module fetched
  ↓
static imports discovered/fetched
  ↓
module graph linked
  ↓
execute
```

### 7.5 `modulepreload`

```html
<link rel="modulepreload" href="/assets/dashboard.js">
```

`modulepreload` memberi browser sinyal untuk fetch module script lebih awal dan mempersiapkannya sebagai module, bukan sekadar preload biasa. MDN menjelaskan `rel="modulepreload"` sebagai cara deklaratif untuk mem-fetch, parse, compile, dan menyimpan module script di module map sebelum eksekusi. Ini sudah widely available sejak 2023 menurut MDN. 

Gunakan untuk module yang akan segera dibutuhkan, misalnya entry chunk atau route chunk critical.

---

## 8. CSS Loading dan Dampaknya

### 8.1 Stylesheet Normal

```html
<link rel="stylesheet" href="/app.css">
```

Ini biasanya render-blocking.

Dampak:

- first paint menunggu CSS;
- CSS besar memperlambat render;
- CSS dari origin lain menambah handshake;
- `@import` di dalam CSS bisa memperburuk waterfall.

### 8.2 `@import` di CSS

```css
@import url('/base.css');
@import url('/components.css');
```

Ini sering buruk karena dependency baru ditemukan setelah CSS pertama diunduh dan diparse.

```text
HTML discovers app.css
  ↓
app.css downloaded
  ↓
CSS parser discovers base.css/components.css
  ↓
more CSS downloaded
  ↓
render delayed
```

Lebih baik bundling CSS critical atau link langsung di HTML bila diperlukan.

### 8.3 Media-specific Stylesheets

```html
<link rel="stylesheet" href="/print.css" media="print">
```

Stylesheet dengan media yang tidak cocok biasanya tidak memblokir render untuk current media, tetapi tetap bisa diunduh dengan prioritas berbeda tergantung browser.

### 8.4 Critical CSS

Critical CSS adalah CSS minimum yang diperlukan untuk render awal.

Strategi:

```html
<style>
  /* layout shell / above-the-fold critical styles */
</style>
<link rel="stylesheet" href="/app.css">
```

Trade-off:

- inline CSS mengurangi request dan mempercepat first render;
- tetapi menambah HTML size;
- mengurangi caching CSS terpisah;
- bisa kompleks untuk maintainability.

Gunakan untuk halaman dengan performance target ketat, bukan sebagai default tanpa pengukuran.

---

## 9. Image Loading: LCP, Lazy, Priority, and Discovery

Gambar sering menjadi resource paling besar dan sering menentukan LCP.

### 9.1 Image dalam HTML

```html
<img src="/hero.avif" width="1200" height="600" alt="Dashboard overview">
```

Keuntungan:

- ditemukan cepat oleh parser/preload scanner;
- bisa diberi ukuran untuk menghindari layout shift;
- bisa diberi `fetchpriority`;
- browser bisa melakukan responsive image selection.

### 9.2 CSS Background Image

```css
.hero {
  background-image: url('/hero.avif');
}
```

Kelemahan:

- baru ditemukan setelah CSS diunduh/diparse;
- sering terlambat untuk LCP;
- lebih sulit memberi semantic `alt`;
- preload mungkin diperlukan jika benar-benar critical.

### 9.3 Lazy Loading

```html
<img src="/below-fold.jpg" loading="lazy" alt="...">
```

Bagus untuk gambar non-critical di bawah viewport.

Buruk untuk hero/LCP image.

Anti-pattern:

```html
<img src="/hero.jpg" loading="lazy" alt="Hero">
```

Jika hero image adalah LCP, lazy loading membuat browser sengaja menunda resource yang justru critical.

### 9.4 Responsive Images

```html
<img
  src="/hero-800.avif"
  srcset="/hero-400.avif 400w, /hero-800.avif 800w, /hero-1600.avif 1600w"
  sizes="(max-width: 800px) 100vw, 800px"
  width="800"
  height="400"
  alt="Hero">
```

Tujuannya bukan hanya kualitas visual, tetapi menghindari download gambar terlalu besar untuk viewport kecil.

### 9.5 `fetchpriority` untuk Image Critical

```html
<img
  src="/hero.avif"
  width="1200"
  height="600"
  fetchpriority="high"
  alt="Hero">
```

Fetch Priority API memberi sinyal prioritas relatif ke browser. Web.dev menjelaskan bahwa API ini dapat membantu optimalisasi loading dan Core Web Vitals, sedangkan MDN menyebut `fetchpriority` bisa melengkapi preload untuk resource penting seperti LCP image.

Gunakan dengan hemat. Jika semua resource diberi priority tinggi, tidak ada yang benar-benar tinggi.

---

## 10. Font Loading: Invisible Performance Trap

Font sering terlihat kecil, tetapi berdampak besar pada perceived performance dan layout.

### 10.1 Font Discovery

Font biasanya dideklarasikan di CSS:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
}
```

Flow:

```text
HTML discovers CSS
  ↓
CSS downloaded
  ↓
CSS parsed
  ↓
font-face discovered
  ↓
layout determines font needed
  ↓
font request
```

Font bisa terlambat ditemukan.

### 10.2 `font-display`

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
}
```

Nilai umum:

- `auto`
- `block`
- `swap`
- `fallback`
- `optional`

Trade-off:

- `block`: menghindari font swap, tetapi bisa membuat teks invisible sementara;
- `swap`: teks cepat terlihat, tetapi bisa berubah saat font datang;
- `optional`: browser boleh tidak memuat font bila tidak layak untuk performance.

### 10.3 Preload Font

```html
<link
  rel="preload"
  href="/fonts/inter.woff2"
  as="font"
  type="font/woff2"
  crossorigin>
```

Catatan penting:

- `as="font"` penting agar request punya destination benar;
- `crossorigin` sering diperlukan untuk font bahkan same-origin-ish tertentu tergantung kebijakan dan cache mode;
- preload font yang tidak digunakan segera akan membuang bandwidth.

### 10.4 Font Anti-pattern

- terlalu banyak font weight;
- font dari third-party origin tanpa preconnect;
- preload semua font;
- tidak memakai `font-display`;
- font menyebabkan layout shift;
- icon font besar untuk beberapa icon kecil.

---

## 11. Resource Hints

Resource hints adalah cara developer memberi browser informasi lebih awal.

Penting: hint bukan perintah mutlak. Browser boleh mengabaikan atau menyesuaikan.

### 11.1 `dns-prefetch`

```html
<link rel="dns-prefetch" href="https://cdn.example.com">
```

Tujuan: lakukan DNS lookup lebih awal.

Cocok untuk origin yang mungkin dibutuhkan, tetapi belum pasti sangat critical.

### 11.2 `preconnect`

```html
<link rel="preconnect" href="https://api.example.com" crossorigin>
```

Tujuan: mulai koneksi lebih awal, biasanya DNS + TCP + TLS untuk HTTPS. MDN menjelaskan `preconnect` sebagai hint bahwa user kemungkinan membutuhkan resource dari origin target sehingga browser bisa memulai koneksi lebih awal, termasuk DNS/TCP/TLS untuk HTTPS.

Cocok untuk origin critical:

- API origin yang dipanggil segera setelah JS boot;
- CDN gambar hero;
- font provider critical.

Jangan preconnect terlalu banyak origin. MDN speculative loading guide memperingatkan bahwa preconnect untuk banyak third-party domain bisa kontraproduktif dan sebaiknya dipakai untuk koneksi paling critical.

### 11.3 `preload`

```html
<link rel="preload" href="/hero.avif" as="image">
```

Tujuan: deklarasikan resource yang dibutuhkan sangat segera, agar browser memulai fetch lebih awal. MDN menjelaskan `rel="preload"` sebagai deklarasi fetch request di `<head>` untuk resource yang akan segera dibutuhkan, sebelum browser main rendering machinery menemukannya secara natural.

Contoh bagus:

```html
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/hero.avif" as="image">
```

Contoh buruk:

```html
<link rel="preload" href="/below-fold-gallery-1.jpg" as="image">
<link rel="preload" href="/below-fold-gallery-2.jpg" as="image">
<link rel="preload" href="/below-fold-gallery-3.jpg" as="image">
```

Preload resource non-critical bisa mengambil bandwidth dari resource critical.

### 11.4 `prefetch`

```html
<link rel="prefetch" href="/next-page.js">
```

Tujuan: fetch resource yang mungkin dibutuhkan untuk navigasi/aksi berikutnya, dengan prioritas rendah.

Cocok untuk:

- route berikutnya yang sangat mungkin dikunjungi;
- chunk hover/intent-based;
- data static non-sensitive untuk next step.

Risiko:

- membuang bandwidth;
- buruk untuk user dengan koneksi terbatas;
- bisa bocorkan intent bila URL sensitif;
- bisa mengganggu cache strategy.

### 11.5 `modulepreload`

```html
<link rel="modulepreload" href="/assets/app.js">
```

Tujuan: preload module script dan dependency module tertentu dengan semantics module.

Gunakan untuk:

- module entry critical;
- route chunk yang pasti dibutuhkan;
- module dependency yang late-discovered oleh graph.

### 11.6 Resource Hint Decision Table

| Hint | Menghemat apa | Untuk apa | Risiko |
|---|---|---|---|
| `dns-prefetch` | DNS lookup | origin mungkin dibutuhkan | manfaat kecil jika tidak dipakai |
| `preconnect` | DNS/TCP/TLS handshake | origin critical | boros socket/battery/bandwidth jika terlalu banyak |
| `preload` | late discovery | resource critical segera | bandwidth competition jika salah pilih |
| `prefetch` | future navigation latency | resource kemungkinan nanti | boros bandwidth/cache pollution |
| `modulepreload` | late module graph discovery | ES module critical | over-preload chunks |

---

## 12. Priority: Browser Scheduler Tidak Sama dengan FIFO Queue

Browser tidak mengirim semua request seolah antrian FIFO sederhana.

Ia mempertimbangkan:

- resource type;
- render-blocking status;
- viewport relevance;
- preload hints;
- fetch priority hints;
- current connection constraints;
- cache state;
- protocol HTTP/1.1 vs HTTP/2/3;
- origin;
- service worker;
- browser heuristics;
- user settings/data saver;
- tab visibility;
- CPU pressure;
- memory pressure.

### 12.1 Priority Bukan Kontrak Absolut

`fetchpriority="high"` tidak berarti resource pasti selesai pertama. Itu sinyal relatif.

Jika resource high priority:

- ditemukan terlambat;
- dari origin baru dengan TLS handshake;
- besar sekali;
- server lambat;
- cache miss;
- blocked oleh service worker;

maka tetap bisa lambat.

### 12.2 Priority Inversion

Priority inversion terjadi ketika resource yang tidak critical mengambil bandwidth/connection/main-thread dari resource critical.

Contoh:

```html
<head>
  <script async src="https://third-party.example.com/ads.js"></script>
  <link rel="preload" href="/below-fold.jpg" as="image">
  <link rel="stylesheet" href="/app.css">
</head>
```

Ads dan gambar non-critical bisa bersaing dengan CSS critical.

### 12.3 Semua High = Tidak Ada High

Anti-pattern:

```html
<img src="/hero.jpg" fetchpriority="high">
<img src="/product1.jpg" fetchpriority="high">
<img src="/product2.jpg" fetchpriority="high">
<img src="/product3.jpg" fetchpriority="high">
<script src="/analytics.js" fetchpriority="high"></script>
```

Gunakan high untuk satu-dua resource yang benar-benar critical.

---

## 13. Network Waterfall: Cara Membaca dengan Benar

Waterfall di DevTools adalah representasi waktu request. Tetapi ia harus dibaca sebagai hasil dari dependency graph.

Kolom/timing yang umum:

```text
Queueing/Stalled
DNS Lookup
Initial connection
SSL/TLS
Request sent
Waiting for server response / TTFB
Content download
```

Tidak semua browser menamai fase sama, tetapi mental modelnya mirip.

### 13.1 Queueing / Stalled

Artinya request belum benar-benar dikirim. Penyebab:

- menunggu socket available;
- browser scheduler menurunkan prioritas;
- connection coalescing/negotiation;
- proxy/service worker;
- request belum boleh jalan karena dependency;
- disk cache lookup;
- main thread busy bisa mempengaruhi observasi.

Jangan langsung menyalahkan server jika waktu banyak di Queueing/Stalled.

### 13.2 DNS Lookup

Browser mencari IP untuk hostname.

Jika DNS berulang tinggi:

- terlalu banyak origin;
- DNS cache tidak efektif;
- third-party domain berlebihan;
- preconnect/dns-prefetch mungkin membantu origin critical.

### 13.3 Initial Connection

TCP handshake untuk HTTP/1.1/2 over TCP atau koneksi setara untuk transport tertentu.

Jika tinggi:

- origin baru;
- network jauh;
- packet loss;
- tidak ada connection reuse;
- domain sharding buruk.

### 13.4 SSL/TLS

TLS handshake.

Jika tinggi:

- HTTPS origin baru;
- certificate chain besar/bermasalah;
- network latency;
- tidak ada resumption;
- corporate proxy.

### 13.5 Request Sent

Biasanya kecil untuk GET, bisa besar untuk upload.

Jika besar:

- upload file;
- request body besar;
- slow client uplink;
- body streaming;
- service worker/proxy overhead.

### 13.6 Waiting / TTFB

Time to first byte: waktu dari request dikirim sampai byte response pertama diterima.

Bisa berarti:

- server processing lambat;
- backend dependency lambat;
- cold start;
- DB query;
- queueing di gateway;
- cache miss di CDN;
- origin jauh;
- upload belum selesai;
- server menunggu flush.

TTFB adalah titik pertemuan frontend dan backend. Jangan simpulkan tanpa trace/server timing.

### 13.7 Content Download

Waktu mengunduh response body.

Jika besar:

- payload besar;
- bandwidth rendah;
- compression kurang;
- streaming panjang;
- browser backpressure;
- throttling.

---

## 14. Resource Timing API: Mengukur dari Browser

DevTools bagus untuk debugging manual. Untuk observability produksi, gunakan API seperti Resource Timing.

MDN menjelaskan `PerformanceResourceTiming` sebagai interface untuk mengambil dan menganalisis timing network detail dari resource seperti XHR, image, script, dan lain-lain.

Contoh sederhana:

```js
const resources = performance.getEntriesByType('resource');

for (const r of resources) {
  console.log({
    name: r.name,
    initiatorType: r.initiatorType,
    startTime: r.startTime,
    duration: r.duration,
    dns: r.domainLookupEnd - r.domainLookupStart,
    connect: r.connectEnd - r.connectStart,
    request: r.responseStart - r.requestStart,
    download: r.responseEnd - r.responseStart,
    transferSize: r.transferSize,
    encodedBodySize: r.encodedBodySize,
    decodedBodySize: r.decodedBodySize,
  });
}
```

### 14.1 Cross-Origin Timing Restriction

Untuk cross-origin resource, banyak detail timing bisa disembunyikan kecuali server mengirim:

```http
Timing-Allow-Origin: https://app.example.com
```

atau sesuai policy yang aman.

MDN content menyebut banyak properti timing dibatasi menjadi `0` atau string kosong untuk cross-origin request kecuali `Timing-Allow-Origin` disetel.

### 14.2 Server-Timing

Backend bisa mengirim:

```http
Server-Timing: db;dur=42, app;dur=12, cache;desc="MISS";dur=3
```

Lalu browser/RUM bisa membaca sebagian informasi tersebut melalui performance entries.

Ini sangat berguna untuk membedakan:

```text
server lambat karena DB
vs
server cepat tapi network/download lambat
vs
CDN cache miss
```

---

## 15. HTTP/2 dan HTTP/3: Mengubah Waterfall, Bukan Menghapusnya

### 15.1 HTTP/1.1

Dengan HTTP/1.1, browser biasanya punya batas koneksi per origin. Banyak request bisa antri karena connection limit.

Optimasi lama:

- concatenation besar;
- domain sharding;
- sprite sheets;
- aggressive bundling.

### 15.2 HTTP/2

HTTP/2 membawa multiplexing: banyak stream dalam satu koneksi.

Dampak:

- lebih sedikit kebutuhan domain sharding;
- request kecil lebih murah;
- waterfall terlihat overlap;
- tetapi bandwidth tetap terbatas;
- server/browser priority behavior tetap penting;
- head-of-line blocking TCP masih bisa terjadi di level transport.

### 15.3 HTTP/3

HTTP/3 memakai QUIC over UDP dan dapat mengurangi efek head-of-line blocking transport. Namun:

- late discovery tetap late discovery;
- CSS blocking tetap blocking;
- JS CPU tetap CPU;
- server TTFB tetap TTFB;
- origin handshake tetap relevan, meski karakteristiknya berbeda.

Jadi jangan berpikir “pakai HTTP/3 maka waterfall otomatis bagus”.

---

## 16. Early Hints 103

`103 Early Hints` memungkinkan server memberi hint resource sebelum response final siap.

Konsep:

```http
HTTP/1.1 103 Early Hints
Link: </app.css>; rel=preload; as=style
Link: </app.js>; rel=modulepreload

HTTP/1.1 200 OK
Content-Type: text/html
...
```

Tujuan: browser bisa mulai fetch resource critical saat server masih menyiapkan HTML final.

Cocok bila:

- server punya TTFB cukup tinggi;
- resource critical bisa diketahui lebih awal;
- CDN/proxy mendukung;
- deployment manifest dapat dipakai untuk generate Link hints.

Risiko:

- hint salah membuang bandwidth;
- asset hash berubah dan hint stale;
- kompleksitas server/CDN;
- tidak semua jalur proxy memperlakukan 103 sama.

---

## 17. SPA, Hydration, dan Hidden Waterfall

Banyak SPA punya waterfall tersembunyi:

```text
HTML shell
  ↓
main JS
  ↓
framework bootstrap
  ↓
route chunk
  ↓
component render
  ↓
API request
  ↓
render data
```

Secara visual, ini buruk karena API baru dimulai setelah JS selesai.

### 17.1 Solusi Umum

1. **Server render atau streaming render** agar HTML mengandung konten awal.
2. **Route-level preload** untuk chunk critical.
3. **Data prefetch** berdasarkan route sebelum component mount.
4. **BFF endpoint** untuk mengurangi request fan-out.
5. **HTTP cache** untuk data yang aman di-cache.
6. **Skeleton yang jujur**, bukan menutupi waterfall buruk.
7. **Avoid waterfall inside components.**

### 17.2 Component Waterfall

Anti-pattern:

```text
Page loads
  ↓
Parent component fetches user
  ↓
Child component sees user.id
  ↓
Child fetches permissions
  ↓
Grandchild fetches dashboard
```

Lebih baik:

```text
Route loader determines data needs
  ↓
parallel fetch user + permissions + dashboard
  ↓
render with coordinated state
```

Atau backend menyediakan composite endpoint bila domain dan latency menuntut.

---

## 18. API Calls dalam Resource Loading

API call dari JS berbeda dari resource declarative di HTML.

HTML parser bisa menemukan:

```html
<link rel="stylesheet" href="/app.css">
```

Tetapi API ini baru muncul setelah JS jalan:

```js
fetch('/api/dashboard');
```

Konsekuensi:

```text
HTML → JS download → JS execute → API discovered → API TTFB → UI data
```

Jika data adalah konten utama, API call late discovery bisa menjadi bottleneck terbesar.

### 18.1 Pattern Buruk

```js
useEffect(() => {
  fetch('/api/dashboard').then(...);
}, []);
```

Jika component baru mount setelah route chunk selesai, request data telat.

### 18.2 Pattern Lebih Baik

```text
router knows target route
  ↓
start importing route chunk and fetching data in parallel
  ↓
render when enough critical data ready
```

Atau SSR:

```text
server fetches critical data
  ↓
HTML includes initial data
  ↓
client hydrates
```

### 18.3 Fetch Priority untuk API?

Browser support untuk priority hints pada `fetch()` lebih terbatas/berbeda dibanding declarative resources. Walaupun ada properti `priority` dalam beberapa implementasi/eksperimen, jangan jadikan satu-satunya mekanisme desain.

Yang lebih kuat:

- mulai request lebih awal;
- kurangi dependency sequential;
- gunakan cache;
- desain endpoint sesuai screen;
- batasi third-party contention;
- optimalkan server TTFB.

---

## 19. Third-party Resources: Sering Menang Karena Datang Terlalu Awal

Third-party script dapat merusak loading:

```html
<script async src="https://tag-manager.example.com/tm.js"></script>
```

Masalah:

- origin tambahan;
- DNS/TCP/TLS tambahan;
- script execution di main thread;
- script bisa inject resource lain;
- prioritas sulit dikontrol;
- caching di luar kontrol;
- CSP/CORP/COEP constraints;
- observability terbatas.

### 19.1 Third-party Loading Policy

Untuk aplikasi serius, buat policy:

| Pertanyaan | Keputusan |
|---|---|
| Apakah script critical untuk first interaction? | Jika tidak, delay |
| Apakah bisa load setelah consent? | Jika ya, jangan load awal |
| Apakah perlu di semua route? | Jika tidak, route-scope |
| Apakah bisa pakai server-side tagging? | Evaluasi |
| Apakah bisa sandbox iframe? | Evaluasi |
| Apakah script punya SLO/performance budget? | Wajib |

---

## 20. Service Worker dan Resource Loading

Service worker bisa berada di antara browser dan network.

```text
page request
  ↓
service worker fetch event
  ↓
cache/network/custom logic
  ↓
response
```

Dampaknya:

- waterfall bisa menunjukkan service worker overhead;
- cache bisa berasal dari Cache API, bukan HTTP cache;
- stale asset bisa disajikan;
- offline fallback bisa muncul;
- navigation preload bisa membantu mengurangi startup penalty.

Jangan membaca waterfall hanya sebagai network murni bila service worker aktif.

Debugging:

- cek Application → Service Workers;
- bypass for network;
- unregister saat diagnosis;
- lihat Cache Storage;
- cek apakah request served from service worker.

---

## 21. DevTools Network: Workflow Diagnosis

### 21.1 Pertanyaan Pertama

Saat membuka waterfall, jangan langsung cari request paling lambat. Mulai dari pertanyaan:

```text
Apa user-visible milestone yang lambat?
```

Contoh:

- LCP lambat?
- Data tabel lambat?
- Tombol tidak bisa diklik?
- Route transition lambat?
- Login redirect lambat?
- Font/text terlambat?

### 21.2 Filter Berdasarkan Criticality

Gunakan filter:

- Doc
- CSS
- JS
- Img
- Font
- Fetch/XHR
- WS
- Other

Lalu identifikasi resource critical.

### 21.3 Lihat Initiator

Kolom Initiator menjawab:

> “Siapa yang menyebabkan request ini?”

Contoh:

- parser HTML;
- CSS file;
- JS file;
- dynamic import;
- service worker;
- preload;
- redirect;
- fetch call stack.

Ini sangat penting untuk menemukan late discovery.

### 21.4 Lihat Priority

Chrome DevTools dapat menunjukkan priority resource. Gunakan sebagai sinyal, bukan kebenaran absolut.

Cari anomali:

- hero image low priority;
- below-fold image high priority;
- CSS critical terlambat;
- analytics high/early;
- route chunk late.

### 21.5 Lihat Cache Status

Cari:

- memory cache;
- disk cache;
- prefetch cache;
- service worker;
- 304;
- CDN cache HIT/MISS via headers;
- transfer size 0 vs resource size.

### 21.6 Lihat Connection Reuse

Jika banyak origin:

- DNS/connection/TLS berulang;
- handshake makan waktu;
- preconnect mungkin membantu;
- konsolidasi origin mungkin lebih baik.

### 21.7 Lihat Response Headers

Untuk resource critical, cek:

- `Cache-Control`;
- `Content-Encoding`;
- `Content-Type`;
- `Vary`;
- `Server-Timing`;
- `Timing-Allow-Origin`;
- `Cross-Origin-Resource-Policy`;
- `Access-Control-Allow-Origin` untuk font/API bila relevan.

---

## 22. Common Waterfall Smells

### 22.1 Long Chain

```text
HTML → JS → route JS → API → image
```

Kemungkinan:

- data fetch telat;
- route chunk telat;
- image discovered via JS/CSS;
- SSR/prefetch/preload bisa membantu.

### 22.2 CSS Late

```text
HTML → JS → inject CSS → CSS download → render
```

Kemungkinan:

- CSS-in-JS runtime injection;
- route CSS chunk late;
- critical CSS tidak inline/preloaded.

### 22.3 Hero Image Late

```text
HTML → CSS → background image → LCP
```

Solusi:

- gunakan `<img>` untuk hero semantic;
- preload image jika tetap background;
- set `fetchpriority="high"` untuk LCP image yang jelas;
- hindari lazy untuk hero.

### 22.4 Too Many Origins

```text
app.example.com
cdn.example.com
fonts.example.net
analytics.example.org
tag.example.io
ads.example.co
api.example.com
```

Masalah:

- DNS/TLS overhead;
- connection pool fragmentation;
- third-party unpredictability;
- privacy/security policy complexity.

### 22.5 Preload Everything

Banyak request mulai awal, tetapi critical resource tetap lambat.

Penyebab:

- bandwidth contention;
- wrong `as` type;
- preloaded resource tidak dipakai;
- duplicate request karena mismatch `crossorigin` atau URL;
- cache pollution.

### 22.6 API Sequential Fan-out

```text
/api/me
  ↓
/api/me/permissions
  ↓
/api/dashboard
  ↓
/api/dashboard/widgets
```

Solusi:

- parallelize bila dependency tidak nyata;
- composite endpoint;
- preload data berdasarkan route;
- server-side aggregation;
- cache immutable/reference data.

### 22.7 304 Storm

Banyak request 304 pada every navigation.

Artinya response body tidak dikirim, tetapi round-trip tetap terjadi.

Solusi tergantung resource:

- hashed static assets: `max-age=31536000, immutable`;
- HTML: revalidate boleh;
- API: explicit TTL atau app-level cache;
- jangan membuat semua asset `no-cache`.

---

## 23. Practical Optimization Patterns

### 23.1 Make Critical Resources Discoverable Early

Buruk:

```css
.hero { background-image: url('/hero.avif'); }
```

Lebih baik untuk LCP:

```html
<img src="/hero.avif" width="1200" height="600" fetchpriority="high" alt="Hero">
```

Atau bila harus CSS background:

```html
<link rel="preload" as="image" href="/hero.avif">
```

### 23.2 Keep Critical CSS Small

Buruk:

```html
<link rel="stylesheet" href="/all-pages-all-components-all-themes.css">
```

Lebih baik:

```text
critical layout CSS early
route/component CSS split carefully
non-critical CSS delayed
```

### 23.3 Avoid Parser-blocking Scripts

Buruk:

```html
<script src="/app.js"></script>
```

Lebih baik:

```html
<script type="module" src="/app.js"></script>
```

atau:

```html
<script defer src="/app.js"></script>
```

### 23.4 Preconnect Only Critical Origins

```html
<link rel="preconnect" href="https://api.example.com" crossorigin>
```

Jangan:

```html
<link rel="preconnect" href="https://analytics1.example.com">
<link rel="preconnect" href="https://ads1.example.com">
<link rel="preconnect" href="https://social1.example.com">
<link rel="preconnect" href="https://cdn-random.example.net">
```

### 23.5 Pair Preload with Correct Attributes

Untuk font:

```html
<link
  rel="preload"
  href="/fonts/inter.woff2"
  as="font"
  type="font/woff2"
  crossorigin>
```

Untuk script:

```html
<link rel="modulepreload" href="/assets/app.js">
```

Untuk image:

```html
<link rel="preload" href="/hero.avif" as="image">
```

Wrong `as`, missing `crossorigin`, atau URL mismatch bisa menyebabkan duplicate download.

### 23.6 Start Data Fetch Earlier

Buruk:

```text
component mount → fetch
```

Lebih baik:

```text
route match → import chunk + fetch data in parallel
```

Atau:

```text
server render → embed initial data → hydrate
```

### 23.7 Use CDN Caching for Static Assets

Untuk hashed assets:

```http
Cache-Control: public, max-age=31536000, immutable
```

Untuk HTML:

```http
Cache-Control: no-cache
```

atau TTL pendek sesuai strategi.

Ini mengurangi repeated asset request dan 304 storm.

---

## 24. Case Study 1: LCP Hero Lambat

### Symptom

LCP 4.8s pada koneksi 4G. Server HTML TTFB hanya 200ms.

### Waterfall

```text
0ms    document /product
250ms  /assets/app.css
900ms  /assets/app.css complete
930ms  /images/hero.avif discovered
950ms  /images/hero.avif request starts
3200ms /images/hero.avif complete
```

### Root Cause

Hero image ada di CSS background. Browser baru tahu image setelah CSS selesai.

### Fix Options

Option A: pakai `<img>` semantic:

```html
<img
  src="/images/hero.avif"
  width="1200"
  height="600"
  fetchpriority="high"
  alt="Product overview">
```

Option B: preload bila tetap background:

```html
<link rel="preload" href="/images/hero.avif" as="image">
```

### Prevention Invariant

Resource yang menentukan LCP harus ditemukan sedini mungkin dan tidak boleh lazy kecuali ada alasan kuat.

---

## 25. Case Study 2: API Lambat Padahal Backend Cepat

### Symptom

Dashboard data muncul setelah 3 detik. Backend trace menunjukkan `/api/dashboard` hanya 120ms.

### Waterfall

```text
0ms    document
300ms  app.js start
1200ms app.js complete
1700ms route chunk start
2200ms route chunk complete
2300ms /api/dashboard start
2420ms /api/dashboard response
```

### Root Cause

API baru dimulai setelah main JS dan route chunk selesai. Server cepat, request telat ditemukan.

### Fix Options

- route-level data loader;
- preload route chunk;
- server-side render dashboard shell/data;
- BFF endpoint embedded in HTML;
- start API request from bootstrap if route known.

### Prevention Invariant

Optimasi backend tidak membantu bila request backend baru dimulai terlambat.

---

## 26. Case Study 3: Preload Membuat Lebih Lambat

### Symptom

Setelah menambahkan banyak preload, LCP memburuk.

### HTML

```html
<link rel="preload" href="/hero.avif" as="image">
<link rel="preload" href="/gallery1.avif" as="image">
<link rel="preload" href="/gallery2.avif" as="image">
<link rel="preload" href="/gallery3.avif" as="image">
<link rel="preload" href="/marketing-video.mp4" as="video">
```

### Root Cause

Resource non-critical berebut bandwidth dengan CSS/JS/hero image.

### Fix

Preload hanya resource critical:

```html
<link rel="preload" href="/hero.avif" as="image">
```

Prefetch future resource hanya setelah load/idle atau berdasarkan user intent.

### Prevention Invariant

Preload adalah akselerator untuk critical path, bukan mekanisme cache semua resource.

---

## 27. Case Study 4: Font Membuat Text Invisible

### Symptom

Page terlihat blank sebagian selama 1.5 detik walau HTML dan CSS cepat.

### Root Cause

Custom font default behavior menyebabkan text rendering menunggu font.

### Fix

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
}
```

Optionally preload one critical font face:

```html
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
```

### Prevention Invariant

Text content harus terlihat dengan fallback strategy; custom font tidak boleh menjadi single point of blank UI.

---

## 28. Case Study 5: Third-party Script Mengganggu Interactivity

### Symptom

Network terlihat cepat, tetapi tombol tidak responsif saat page load.

### Diagnosis

Performance panel menunjukkan third-party script execution panjang di main thread.

### Root Cause

Script analytics/tag manager dieksekusi awal dan memblokir main thread saat app hydrate.

### Fix

- load after interaction/idle;
- route-scope third-party;
- consent-gated load;
- reduce vendor scripts;
- move non-critical tracking server-side;
- enforce performance budget.

### Prevention Invariant

Tidak semua performance issue terlihat sebagai network waterfall. Main thread adalah resource critical juga.

---

## 29. Checklist Desain Resource Loading

Untuk setiap halaman penting, jawab:

### 29.1 Critical User Moment

```text
Apa momen yang dianggap “halaman usable”?
```

Contoh:

- product hero visible;
- search result shown;
- dashboard table interactive;
- checkout form usable.

### 29.2 Critical Resources

```text
Resource apa saja yang wajib untuk momen itu?
```

- HTML;
- CSS critical;
- JS critical;
- route chunk;
- API data;
- hero image;
- font;
- auth/session;
- feature flag config.

### 29.3 Discovery

```text
Kapan browser menemukan resource itu?
```

- HTML parser;
- preload scanner;
- CSS parser;
- JS execution;
- route loader;
- component mount;
- user interaction.

### 29.4 Priority

```text
Apakah resource critical mendapat prioritas layak?
```

- preload?
- modulepreload?
- fetchpriority?
- not lazy?
- not blocked by third-party?

### 29.5 Blocking

```text
Apa yang memblokir parsing/render/execution?
```

- classic script;
- stylesheet;
- CSS import;
- font;
- JS CPU;
- service worker;
- long task;
- synchronous storage.

### 29.6 Origin

```text
Berapa origin yang dibutuhkan sebelum usable?
```

- app origin;
- API origin;
- CDN;
- font;
- third-party.

Kurangi origin critical bila mungkin.

### 29.7 Cache

```text
Apakah critical resource cacheable dengan benar?
```

- hashed assets long cache;
- HTML revalidation;
- API explicit TTL;
- font cache;
- image cache;
- CDN hit ratio.

### 29.8 Observability

```text
Bisakah kita membuktikan bottleneck dengan data?
```

- Resource Timing;
- Navigation Timing;
- Server-Timing;
- RUM;
- trace ID;
- CDN headers;
- lab + field metrics.

---

## 30. Anti-pattern Besar

### 30.1 “Bundle Satu File Besar agar Simpel”

Kadang mengurangi request, tetapi bisa memperlambat first route karena user mengunduh code yang belum dibutuhkan.

Better:

- split berdasarkan route/domain;
- preload critical chunk;
- hindari terlalu banyak micro-chunks;
- ukur dengan waterfall dan RUM.

### 30.2 “Split Semua Sekecil Mungkin”

Terlalu banyak chunk bisa membuat overhead discovery dan scheduling.

Better:

- chunk berdasarkan usage locality;
- jangan membuat route critical butuh 30 chunk sequential;
- gunakan modulepreload bila perlu.

### 30.3 “Preload Semua yang Penting Menurut Developer”

Yang penting menurut developer belum tentu critical untuk user-visible moment.

Better:

- preload resource yang terbukti critical;
- evaluasi dengan LCP/INP/TTFB/waterfall;
- hapus unused preload.

### 30.4 “Analytics Harus Paling Awal”

Sering tidak benar. Analytics penting untuk bisnis, tetapi jarang harus mengalahkan render/interactivity.

Better:

- minimal early beacon;
- defer heavy SDK;
- consent-aware;
- sample;
- server-side event bila cocok.

### 30.5 “HTTP/2 Membuat Jumlah Request Tidak Penting”

HTTP/2 mengurangi beberapa overhead, tetapi request tetap punya:

- discovery time;
- header overhead;
- prioritization;
- server processing;
- cache lookup;
- JS scheduling;
- bandwidth competition.

Jumlah request bukan satu-satunya metric, tetapi tetap relevan.

---

## 31. Hubungan dengan Bagian Sebelumnya

Bagian ini menyambungkan banyak konsep sebelumnya:

- **URL/origin**: origin baru berarti DNS/TLS/koneksi baru.
- **Headers**: `Link`, `Cache-Control`, `Content-Encoding`, `Server-Timing`, `Timing-Allow-Origin` mempengaruhi loading.
- **Body/media type**: resource type dan `as` menentukan prioritas dan processing.
- **Fetch**: API request biasanya late-discovered oleh JS.
- **CORS/cookies**: font/API/image cross-origin bisa gagal atau timing-nya tersembunyi.
- **Caching**: cache hit mengubah waterfall drastis.
- **Redirect**: redirect chain menambah critical path.
- **Content negotiation**: `Vary`, compression, localization bisa mempengaruhi cache dan payload.

---

## 32. Praktik Lab Mandiri

Gunakan halaman nyata atau app lokal Anda.

### Lab 1 — Identify Critical Path

1. Buka DevTools Network.
2. Disable cache.
3. Reload halaman.
4. Tentukan user-visible moment paling penting.
5. Tandai semua request yang dibutuhkan untuk moment itu.
6. Buat graph dependency sederhana:

```text
HTML → CSS → JS → API → render
```

atau lebih detail.

### Lab 2 — Find Late-discovered Resource

Cari resource yang:

- mulai jauh setelah HTML selesai;
- initiator-nya CSS atau JS;
- critical untuk user;
- tidak punya alasan untuk telat.

Tentukan apakah bisa:

- dipindah ke HTML;
- diberi preload;
- diganti dari CSS background ke `<img>`;
- dimulai oleh route loader;
- di-cache lebih baik.

### Lab 3 — Compare Cache Modes

Reload dengan:

1. Disable cache;
2. normal reload;
3. hard reload;
4. second navigation.

Amati:

- transfer size;
- 304;
- memory/disk cache;
- service worker;
- CDN HIT/MISS.

### Lab 4 — Measure with Resource Timing

Jalankan:

```js
performance.getEntriesByType('resource')
  .map(r => ({
    name: r.name,
    type: r.initiatorType,
    duration: Math.round(r.duration),
    ttfb: Math.round(r.responseStart - r.requestStart),
    download: Math.round(r.responseEnd - r.responseStart),
    transfer: r.transferSize,
  }))
  .sort((a, b) => b.duration - a.duration)
  .slice(0, 20);
```

Tanyakan:

- resource mana paling lambat;
- apakah ia critical;
- apakah ia late-discovered;
- apakah server lambat atau download besar;
- apakah timing cross-origin tersembunyi.

---

## 33. Decision Framework

Ketika menghadapi masalah loading, jangan langsung memilih solusi. Gunakan urutan ini:

```text
1. Define user-visible critical moment.
2. List critical resources.
3. Determine discovery time for each resource.
4. Determine blocking behavior.
5. Determine priority and competition.
6. Determine origin/connection cost.
7. Determine cache behavior.
8. Determine server/TTFB contribution.
9. Determine payload/download contribution.
10. Apply smallest change that shortens critical path.
```

Contoh mapping:

| Symptom | Kemungkinan akar | Solusi kandidat |
|---|---|---|
| LCP image telat | image late-discovered | `<img>`, preload, fetchpriority |
| First paint telat | CSS besar/blocking | critical CSS, split CSS, reduce CSS |
| Data telat | API late-discovered | route loader, SSR, parallel fetch, BFF |
| TTFB tinggi | server/CDN/cache miss | server timing, CDN cache, backend optimize |
| Banyak DNS/TLS | terlalu banyak origin | consolidate, preconnect critical |
| Text invisible | font loading | font-display, preload critical font |
| Interactivity buruk | JS/main thread | reduce JS, defer third-party, code split |
| Banyak 304 | cache strategy salah | immutable hashed assets |

---

## 34. Invariant untuk Top 1% Engineer

Pegang invariant ini:

1. **Resource yang tidak ditemukan tidak bisa diunduh.** Late discovery adalah bottleneck fundamental.
2. **Resource yang diunduh awal belum tentu dieksekusi/dirender awal.** Ada parsing, CSSOM, JS execution, layout, dan policy.
3. **Render-blocking bukan selalu buruk.** CSS critical memang perlu block render; yang buruk adalah CSS terlalu besar atau terlambat.
4. **Preload adalah alat bedah, bukan palu.** Gunakan untuk resource critical yang late-discovered.
5. **Priority adalah sinyal, bukan jaminan.** Discovery time dan dependency tetap utama.
6. **HTTP/2/3 membantu transport, bukan dependency graph.** Critical path tetap harus didesain.
7. **Waterfall harus dibaca sebagai graph, bukan daftar.** Initiator dan timing lebih penting daripada sekadar duration.
8. **Frontend performance adalah kontrak lintas tim.** Build pipeline, backend, CDN, security headers, cache, dan browser semuanya terlibat.
9. **Optimasi tanpa milestone user-visible mudah salah arah.** Mulai dari pengalaman user, bukan dari request terbesar.
10. **Third-party harus dianggap untrusted performance dependency.** Ia perlu budget, isolation, dan loading policy.

---

## 35. Ringkasan

Resource loading adalah lapisan tempat HTTP bertemu browser rendering engine.

Untuk memahami performa frontend secara serius, Anda harus bisa menjawab:

- kapan resource ditemukan;
- siapa initiator-nya;
- apakah resource memblokir parser/render/execution;
- apakah prioritasnya sesuai;
- apakah origin/koneksi menambah biaya;
- apakah cache bekerja;
- apakah server TTFB atau download payload yang dominan;
- apakah JavaScript menyebabkan hidden waterfall;
- apakah third-party mengganggu critical path.

Jika Anda hanya melihat “request ini 2 detik”, Anda masih berada di permukaan. Jika Anda bisa menjelaskan mengapa request itu baru mulai pada detik ke-1.5, resource apa yang menahannya, apakah ia critical, dan perubahan apa yang memotong dependency chain, Anda mulai berpikir seperti engineer yang benar-benar memahami HTTP dari perspektif browser/frontend.

---

## 36. Referensi Utama

Referensi yang relevan untuk topik ini:

- MDN — `rel="preload"`
- MDN — `rel="preconnect"`
- MDN — `rel="modulepreload"`
- MDN — `fetchpriority` HTML attribute
- MDN — Speculative loading
- MDN — `PerformanceResourceTiming`
- W3C — Resource Timing
- web.dev — Fetch Priority API
- web.dev — Resource hints
- web.dev — Preload critical assets
- WHATWG HTML — link types

---

## 37. Status Seri

```text
Part 018 selesai.
Seri belum selesai.
Lanjut ke Part 019: HTTP/1.1, HTTP/2, HTTP/3: What Frontend Engineers Actually Need.
```
