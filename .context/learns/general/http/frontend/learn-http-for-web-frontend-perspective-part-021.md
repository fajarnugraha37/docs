# learn-http-for-web-frontend-perspective-part-021

# Security Headers for Frontend Engineers

> Seri: `learn-http-for-web-frontend-perspective`  
> Bagian: `021`  
> Topik: Security Headers for Frontend Engineers  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi browser/frontend secara dalam, sistematis, dan production-grade.

---

## 0. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- URL, origin, site, scheme, host, port.
- HTTP message model.
- Method semantics.
- Status codes.
- Headers sebagai control plane.
- Body, media type, representation.
- Fetch dan non-fetch requests.
- CORS.
- Cookies, session, CSRF, SPA auth.
- HTTP caching.
- Redirect.
- Content negotiation.
- Browser resource loading.
- HTTP/1.1, HTTP/2, HTTP/3.
- TLS, HTTPS, mixed content, secure contexts.

Bagian ini membahas **security headers**: response headers yang dikirim server untuk memberi instruksi keamanan kepada browser.

Ini penting karena banyak proteksi frontend modern bukan hanya ditentukan oleh kode JavaScript, melainkan oleh **policy yang dikirim lewat HTTP response**.

Kalau disederhanakan:

```text
Backend / CDN / Gateway mengirim header
        ↓
Browser membaca header
        ↓
Browser menerapkan security policy
        ↓
Frontend code dieksekusi di dalam batasan policy tersebut
```

Security headers bukan “hiasan checklist pentest”. Mereka adalah **runtime policy boundary**.

---

## 1. Core Mental Model

### 1.1 Security Headers adalah Policy Delivery Mechanism

HTTP response body membawa content.

HTTP response headers membawa metadata dan policy.

Untuk security, server dapat mengirim instruksi seperti:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

Browser lalu memakai instruksi tersebut untuk memutuskan:

- apakah script boleh dijalankan;
- apakah halaman boleh di-embed di iframe;
- apakah koneksi harus HTTPS;
- apakah MIME type boleh ditebak;
- seberapa banyak referrer boleh dikirim;
- apakah API seperti camera/geolocation boleh dipakai;
- apakah resource cross-origin boleh dibaca/dijalankan/di-embed;
- apakah violation harus dilaporkan.

Security headers mengubah browser dari “renderer pasif” menjadi **policy enforcement engine**.

---

### 1.2 Header Tidak Mengamankan Server secara Langsung

Security headers biasanya tidak mencegah request mencapai server.

Contoh:

```http
Content-Security-Policy: default-src 'self'
```

Header ini tidak membuat server kebal dari SQL injection, broken auth, atau IDOR. Yang terjadi adalah browser membatasi apa yang boleh dilakukan oleh dokumen yang menerima header tersebut.

Dengan kata lain:

```text
Security header melindungi eksekusi browser-side.
Bukan menggantikan validasi server-side.
```

Frontend engineer harus menghindari asumsi berikut:

```text
Kami sudah pakai CSP, jadi XSS tidak perlu dicegah dari template/rendering.
```

Yang benar:

```text
CSP adalah defense-in-depth.
Escaping, sanitization, safe rendering, dependency hygiene, dan backend validation tetap wajib.
```

---

### 1.3 Security Headers adalah Kontrak Antar Tim

Di sistem nyata, security headers bisa dikontrol oleh banyak layer:

- aplikasi backend;
- SSR server;
- frontend static host;
- CDN;
- reverse proxy;
- API gateway;
- ingress controller;
- WAF;
- identity provider;
- third-party platform.

Akibatnya, ownership sering kabur.

Contoh masalah:

```text
Frontend butuh load script dari analytics vendor.
Security team menambahkan CSP script-src 'self'.
Marketing tag manager berhenti bekerja.
SRE override header di CDN.
Backend tidak sadar header berubah.
Pentest menemukan CSP terlalu longgar.
```

Security headers harus dianggap sebagai **shared interface**.

Minimal perlu jelas:

- siapa owner header;
- di layer mana header diset;
- apakah header berlaku untuk HTML, API, asset, atau semua response;
- bagaimana header diuji;
- bagaimana perubahan header direview;
- bagaimana violation dimonitor;
- bagaimana rollback dilakukan.

---

## 2. Threat Model: Apa yang Dicoba Dicegah?

Security headers biasanya ditujukan untuk mengurangi risiko berikut.

### 2.1 Cross-Site Scripting / XSS

XSS terjadi ketika attacker berhasil membuat browser menjalankan script yang tidak seharusnya dalam origin aplikasi.

Contoh sumber XSS:

- unsafe template rendering;
- `innerHTML` dari input user;
- markdown renderer yang tidak aman;
- third-party script compromised;
- dependency supply chain;
- stored user content;
- JSON embedded ke HTML tanpa escaping;
- DOM-based injection.

Header yang relevan:

- `Content-Security-Policy`;
- `X-Content-Type-Options`;
- `Trusted Types` melalui CSP directive;
- `Subresource Integrity` untuk subresource tertentu.

---

### 2.2 Clickjacking

Clickjacking terjadi ketika aplikasi sensitif di-embed dalam frame milik attacker, lalu user ditipu untuk melakukan aksi.

Header yang relevan:

- `Content-Security-Policy: frame-ancestors ...`;
- `X-Frame-Options` sebagai compatibility layer.

---

### 2.3 MIME Confusion / MIME Sniffing

Browser historically bisa mencoba menebak tipe content jika `Content-Type` salah.

Risiko:

```text
Server mengirim file user-uploaded sebagai text/plain,
browser menebak sebagai JavaScript,
lalu script bisa dieksekusi dalam konteks yang tidak diinginkan.
```

Header relevan:

```http
X-Content-Type-Options: nosniff
```

---

### 2.4 Referrer Leakage

Browser dapat mengirim `Referer` header saat navigasi atau subresource request.

Jika URL mengandung data sensitif:

```text
https://app.example.com/reset-password?token=abc123
```

lalu halaman memuat image dari third-party:

```html
<img src="https://analytics.example.net/pixel.png">
```

maka tanpa policy yang tepat, sebagian informasi URL bisa bocor ke third-party.

Header relevan:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

atau lebih ketat:

```http
Referrer-Policy: no-referrer
```

---

### 2.5 HTTPS Downgrade / TLS Stripping

Jika user pertama kali mengakses lewat HTTP, attacker on-path bisa mencoba menahan user di HTTP.

Header relevan:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

HSTS membuat browser mengingat bahwa host harus diakses via HTTPS.

---

### 2.6 Excessive Browser Capability

Browser menyediakan API sensitif:

- geolocation;
- camera;
- microphone;
- fullscreen;
- payment;
- USB;
- serial;
- accelerometer;
- browsing topics / privacy-related APIs tergantung browser.

Header relevan:

```http
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

Prinsipnya:

```text
Jika aplikasi tidak membutuhkan capability tertentu, matikan secara eksplisit.
```

---

### 2.7 Cross-Origin Data Exposure

Modern browser punya beberapa header untuk mengontrol hubungan antar origin:

- `Cross-Origin-Resource-Policy` / CORP;
- `Cross-Origin-Embedder-Policy` / COEP;
- `Cross-Origin-Opener-Policy` / COOP.

Header ini akan dibahas lebih dalam di Part 022, tetapi Part 021 akan memberi orientasi awal karena masih termasuk security headers.

---

## 3. Peta Security Headers

Security headers yang perlu dipahami frontend engineer:

| Header | Fokus Utama | Dampak Frontend |
|---|---|---|
| `Content-Security-Policy` | XSS, resource allowlist, framing, reporting | Bisa memblokir script/style/image/font/API |
| `Content-Security-Policy-Report-Only` | Observasi sebelum enforce | Membantu rollout aman |
| `Strict-Transport-Security` | Force HTTPS | Mengubah akses browser ke host |
| `X-Content-Type-Options` | Disable MIME sniffing | Membuat MIME salah menjadi error nyata |
| `X-Frame-Options` | Anti-clickjacking legacy | Mengatur embedding page |
| `Referrer-Policy` | Batasi referrer leakage | Mengubah data yang dikirim saat navigasi/request |
| `Permissions-Policy` | Batasi browser features | Mengontrol API sensitif |
| `Cross-Origin-Opener-Policy` | Window/opener isolation | Berpengaruh pada popup dan cross-origin isolation |
| `Cross-Origin-Embedder-Policy` | Require embeddable resource policy | Bisa memblokir resource cross-origin |
| `Cross-Origin-Resource-Policy` | Resource exposure boundary | Bisa memblokir embedding/read tertentu |
| `Origin-Agent-Cluster` | Isolasi agent cluster | Advanced isolation behavior |
| `Report-To` / `Reporting-Endpoints` | Reporting pipeline | Observability security violation |
| `NEL` | Network Error Logging | Observability network errors |

Header deprecated / legacy yang harus dipahami agar tidak salah pakai:

| Header | Status Praktis |
|---|---|
| `X-XSS-Protection` | Legacy/deprecated; umumnya jangan diandalkan |
| `Public-Key-Pins` / HPKP | Deprecated/berbahaya secara operasional |
| `Expect-CT` | Largely obsolete setelah Certificate Transparency menjadi mandatory di browser besar |
| `Feature-Policy` | Digantikan oleh `Permissions-Policy` |

---

## 4. Content-Security-Policy / CSP

### 4.1 Apa Itu CSP?

`Content-Security-Policy` adalah response header yang memberi tahu browser resource apa yang boleh dimuat/dijalankan oleh dokumen.

Contoh sederhana:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'
```

Artinya secara konseptual:

```text
Secara default hanya boleh load dari origin sendiri.
Script hanya boleh dari origin sendiri.
Object/plugin tidak boleh.
Base URL hanya boleh dari origin sendiri.
```

MDN menjelaskan CSP sebagai fitur untuk mencegah atau meminimalkan beberapa risiko keamanan, terutama XSS dan data injection. OWASP juga memperlakukan CSP sebagai defense-in-depth di sisi client.

---

### 4.2 CSP Bukan Satu Policy Tunggal, tapi Banyak Directive

CSP tersusun dari directive.

Contoh:

```http
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' 'nonce-r4nd0m';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api.example.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
  report-to csp-endpoint
```

Directive umum:

| Directive | Mengontrol |
|---|---|
| `default-src` | Fallback untuk banyak fetch directive |
| `script-src` | JavaScript source |
| `style-src` | CSS source |
| `img-src` | Image source |
| `font-src` | Font source |
| `connect-src` | Fetch/XHR/WebSocket/EventSource destinations |
| `media-src` | Audio/video |
| `frame-src` | Frame yang boleh dimuat oleh halaman |
| `frame-ancestors` | Siapa yang boleh meng-embed halaman ini |
| `object-src` | Plugin/object/embed |
| `base-uri` | `<base>` element |
| `form-action` | Form submission destination |
| `worker-src` | Worker/service worker source |
| `manifest-src` | Web app manifest |
| `upgrade-insecure-requests` | Upgrade HTTP subresource ke HTTPS |
| `block-all-mixed-content` | Legacy-ish; banyak kasus sudah covered modern mixed content handling |
| `report-uri` | Legacy reporting endpoint |
| `report-to` | Reporting API-based endpoint |

---

### 4.3 CSP Source Expressions

Contoh source expression:

| Expression | Makna |
|---|---|
| `'self'` | Origin dokumen sendiri |
| `'none'` | Tidak boleh dari mana pun |
| `https:` | Semua HTTPS origin |
| `https://cdn.example.com` | Origin tertentu |
| `*.example.com` | Subdomain tertentu sesuai matching rule |
| `'nonce-...'` | Inline script/style dengan nonce cocok |
| `'sha256-...'` | Inline script/style dengan hash cocok |
| `'unsafe-inline'` | Izinkan inline script/style; berisiko |
| `'unsafe-eval'` | Izinkan eval/string compilation; berisiko |
| `data:` | Data URL; sering dibutuhkan untuk image, berisiko untuk script |
| `blob:` | Blob URL; sering untuk media/worker tertentu |

Top 1% mental model:

```text
CSP bukan hanya allowlist domain.
CSP juga mengontrol inline execution, dynamic script insertion, eval, base URI, form target, frame ancestry, dan reporting.
```

---

### 4.4 `default-src` Bukan Mengontrol Semuanya

`default-src` adalah fallback untuk banyak directive, tetapi tidak semua directive jatuh ke `default-src`.

Contoh:

```http
Content-Security-Policy: default-src 'self'
```

Ini tidak otomatis menggantikan kebutuhan directive seperti:

```text
frame-ancestors
base-uri
form-action
```

Untuk aplikasi enterprise, policy baseline sebaiknya eksplisit:

```http
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

---

### 4.5 `script-src`: Bagian Paling Sensitif

XSS biasanya berujung pada script execution.

CSP paling berdampak saat membatasi `script-src`.

Policy lemah:

```http
Content-Security-Policy: script-src * 'unsafe-inline' 'unsafe-eval'
```

Masalah:

- semua origin boleh menjalankan script;
- inline script boleh;
- `eval()` boleh;
- attacker lebih mudah menjalankan payload.

Policy lebih defensible:

```http
Content-Security-Policy: script-src 'self' 'nonce-random-per-response'; object-src 'none'; base-uri 'self'
```

Dengan nonce:

```html
<script nonce="random-per-response">
  window.__BOOTSTRAP__ = {...};
</script>
```

Header:

```http
Content-Security-Policy: script-src 'self' 'nonce-random-per-response'
```

Browser hanya menjalankan inline script yang nonce-nya cocok.

Important invariant:

```text
Nonce harus unik per response dan tidak boleh bisa ditebak.
Nonce bukan static config.
```

---

### 4.6 Hash-based CSP

Untuk inline script static, hash dapat digunakan.

Contoh:

```http
Content-Security-Policy: script-src 'self' 'sha256-abc...'
```

Kelebihan:

- cocok untuk static snippet;
- tidak butuh server generate nonce per response.

Kekurangan:

- perubahan script sekecil apa pun mengubah hash;
- kurang nyaman untuk dynamic SSR data;
- build pipeline harus aware.

Cocok untuk:

- static documentation site;
- minimal inline bootstrap;
- fixed loader snippet.

Kurang cocok untuk:

- SSR app dengan inline serialized state dinamis.

---

### 4.7 `strict-dynamic`

`strict-dynamic` adalah advanced CSP feature untuk mempercayai script yang diberi nonce/hash, lalu script tersebut dapat memuat script lanjutan.

Contoh konseptual:

```http
Content-Security-Policy: script-src 'nonce-random' 'strict-dynamic' https: 'self'
```

Ini berguna untuk modern loader pattern, tetapi perlu dipahami dengan hati-hati karena behavior-nya tidak intuitif bagi banyak engineer.

Mental model:

```text
Tanpa strict-dynamic:
  allowlist origin sangat penting.

Dengan strict-dynamic:
  trust berpindah ke script bootstrap yang diberi nonce/hash.
```

Jangan gunakan hanya karena terlihat “advanced”. Gunakan jika build/runtime script loading memang membutuhkan model tersebut.

---

### 4.8 `style-src` dan Masalah Inline Style

Banyak frontend framework, CSS-in-JS library, design system, dan third-party widget menggunakan inline style atau injected style tag.

Policy ketat:

```http
Content-Security-Policy: style-src 'self'
```

Bisa memblokir:

- inline `<style>`;
- style attribute;
- runtime CSS injection;
- third-party CSS.

Sering ditemukan policy kompromi:

```http
Content-Security-Policy: style-src 'self' 'unsafe-inline'
```

Ini lebih lemah, tetapi kadang masih realistis untuk migrasi.

Pendekatan lebih baik:

- gunakan nonce untuk style tag jika memungkinkan;
- minimalkan style attribute dynamic dari input user;
- evaluasi library CSS-in-JS;
- gunakan report-only sebelum enforce;
- pisahkan policy untuk app shell dan halaman legacy.

---

### 4.9 `connect-src`: Directive yang Sering Dilupakan Frontend

`connect-src` mengontrol destinasi network request dari:

- `fetch()`;
- `XMLHttpRequest`;
- `WebSocket`;
- `EventSource`;
- Beacon API;
- beberapa API koneksi lain.

Contoh:

```http
Content-Security-Policy: connect-src 'self' https://api.example.com wss://realtime.example.com
```

Jika frontend memanggil API baru:

```ts
fetch("https://reporting.example.com/v1/events")
```

tetapi `connect-src` tidak mengizinkan host tersebut, browser akan memblokir request.

Bug umum:

```text
CORS sudah benar.
API sehat.
Token benar.
Tetap gagal di browser.
Root cause: CSP connect-src tidak mengizinkan API host.
```

Diagnosis:

- DevTools Console biasanya menampilkan CSP violation.
- Network tab bisa menunjukkan request blocked/canceled/failed tergantung browser.
- Security/Issues panel bisa memberi detail.

---

### 4.10 `frame-ancestors`: Anti-clickjacking Modern

`frame-ancestors` mengontrol siapa yang boleh meng-embed halaman ini.

Contoh melarang semua framing:

```http
Content-Security-Policy: frame-ancestors 'none'
```

Mengizinkan self:

```http
Content-Security-Policy: frame-ancestors 'self'
```

Mengizinkan portal tertentu:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.com
```

Bedakan dengan `frame-src`:

```text
frame-src:
  siapa yang boleh dimuat oleh halaman ini sebagai frame.

frame-ancestors:
  siapa yang boleh memuat halaman ini sebagai frame.
```

Ini sering tertukar.

---

### 4.11 `base-uri`: Proteksi dari Base Tag Injection

HTML `<base>` dapat mengubah cara relative URL di-resolve.

Jika attacker bisa inject:

```html
<base href="https://evil.example/">
```

maka link/form/script relative bisa diarahkan ke tempat lain tergantung konteks.

Policy:

```http
Content-Security-Policy: base-uri 'self'
```

Untuk aplikasi yang tidak butuh `<base>`:

```http
Content-Security-Policy: base-uri 'none'
```

---

### 4.12 `form-action`: Batasi Tujuan Form Submit

Walaupun SPA banyak memakai `fetch`, HTML form tetap relevan:

- login form;
- payment flow;
- legacy page;
- fallback behavior;
- hidden form IdP integration.

Policy:

```http
Content-Security-Policy: form-action 'self' https://idp.example.com
```

Tanpa `form-action`, injection HTML bisa membuat form submit ke domain attacker.

---

### 4.13 CSP Reporting

Enforcement langsung berisiko mematahkan produksi.

Gunakan report-only terlebih dahulu:

```http
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; report-to csp-endpoint
```

Browser tidak memblokir, tetapi mengirim violation report.

Pattern rollout:

```text
1. Inventory resource yang benar-benar dipakai.
2. Pasang Report-Only baseline.
3. Kumpulkan violation.
4. Pisahkan noise dari real dependency.
5. Perbaiki app/build/vendor usage.
6. Enforce policy minimal.
7. Tighten bertahap.
8. Monitor terus.
```

Jangan membuat policy dari hasil scanner saja tanpa observability runtime. Aplikasi modern punya banyak route, role, feature flag, dan lazy-loaded module.

---

## 5. Strict-Transport-Security / HSTS

### 5.1 Apa Itu HSTS?

Header:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Instruksi ke browser:

```text
Untuk host ini, selama max-age, gunakan HTTPS saja.
Jika user mencoba HTTP, upgrade ke HTTPS sebelum request dikirim.
```

MDN menjelaskan `Strict-Transport-Security` sebagai response header yang memberi tahu browser bahwa semua koneksi ke host harus memakai HTTPS.

---

### 5.2 HSTS Hanya Dipercaya dari HTTPS Response

Browser tidak boleh mempercayai HSTS yang dikirim lewat HTTP karena attacker bisa memodifikasi HTTP response.

Jadi flow-nya:

```text
User mengakses https://example.com
Server mengirim HSTS
Browser menyimpan policy
Akses berikutnya ke http://example.com di-upgrade lokal ke https://example.com
```

---

### 5.3 `max-age`

Contoh:

```http
Strict-Transport-Security: max-age=31536000
```

Artinya policy berlaku sekitar satu tahun.

Untuk rollout awal, jangan langsung satu tahun jika belum yakin.

Tahapan realistis:

```http
Strict-Transport-Security: max-age=300
```

lalu:

```http
Strict-Transport-Security: max-age=86400
```

lalu:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

### 5.4 `includeSubDomains`

Header:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Artinya semua subdomain juga harus HTTPS.

Ini powerful, tetapi berbahaya jika masih ada subdomain legacy yang hanya HTTP.

Checklist sebelum `includeSubDomains`:

- semua subdomain support HTTPS;
- certificate automation stabil;
- tidak ada internal host di bawah domain publik yang HTTP-only;
- staging/dev domain tidak ikut rusak;
- ownership subdomain jelas;
- expired certificate incident plan ada.

---

### 5.5 `preload`

Header:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

`preload` berarti domain bisa didaftarkan ke HSTS preload list browser.

Dampaknya besar:

```text
Browser sudah tahu domain harus HTTPS bahkan sebelum kunjungan pertama.
```

Tetapi rollback preload tidak instan. Untuk organisasi besar, ini adalah keputusan platform/security, bukan sekadar config frontend.

---

## 6. X-Content-Type-Options

### 6.1 Apa Itu MIME Sniffing?

Jika server mengirim:

```http
Content-Type: text/plain
```

tetapi body terlihat seperti JavaScript, beberapa browser historis bisa mencoba menebak tipe sebenarnya.

Header:

```http
X-Content-Type-Options: nosniff
```

Instruksi:

```text
Browser harus menghormati Content-Type yang dideklarasikan.
Jangan menebak tipe lain.
```

MDN menjelaskan `X-Content-Type-Options` sebagai header yang meminta browser menghormati MIME type dari `Content-Type` dan tidak mengubahnya melalui sniffing.

---

### 6.2 Dampak ke Frontend

Jika asset salah `Content-Type`, browser bisa menolak menjalankan/memuatnya.

Contoh bug:

```text
JS bundle dikirim sebagai text/plain.
Tanpa nosniff mungkin masih tampak bekerja di beberapa kondisi.
Dengan nosniff browser menolak script.
```

Ini baik. Security header membuat konfigurasi salah menjadi fail-fast.

MIME yang harus benar:

| Resource | Content-Type Umum |
|---|---|
| HTML | `text/html; charset=utf-8` |
| JS | `text/javascript` atau `application/javascript` tergantung server convention |
| CSS | `text/css` |
| JSON | `application/json` |
| SVG | `image/svg+xml` |
| WASM | `application/wasm` |
| Font WOFF2 | `font/woff2` |

---

### 6.3 Uploaded Files

Untuk user-uploaded content, `nosniff` membantu, tetapi tidak cukup.

Perlu juga:

- simpan upload di origin/domain terpisah jika berisiko;
- set `Content-Disposition: attachment` untuk file yang tidak boleh dirender;
- validasi tipe file server-side;
- scan malware jika relevan;
- jangan serve upload user dari origin utama aplikasi sensitif;
- gunakan CSP ketat pada file viewer/upload domain.

---

## 7. X-Frame-Options

### 7.1 Apa Itu X-Frame-Options?

Header legacy:

```http
X-Frame-Options: DENY
```

atau:

```http
X-Frame-Options: SAMEORIGIN
```

Tujuannya: memberi tahu browser apakah dokumen boleh dirender di:

- `<frame>`;
- `<iframe>`;
- `<embed>`;
- `<object>`.

MDN menjelaskan header ini sebagai proteksi agar situs dapat menghindari clickjacking dan beberapa cross-site leaks.

---

### 7.2 Gunakan Bersama `frame-ancestors`

Modern CSP:

```http
Content-Security-Policy: frame-ancestors 'none'
```

Legacy compatibility:

```http
X-Frame-Options: DENY
```

Untuk banyak aplikasi enterprise:

```http
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

Jika aplikasi memang perlu di-embed oleh portal internal:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.com
```

`X-Frame-Options` tidak mendukung allowlist modern yang fleksibel; `ALLOW-FROM` tidak bisa diandalkan lintas browser modern.

---

### 7.3 Jangan Memasang Anti-frame Secara Buta

Beberapa flow memang butuh iframe:

- embedded dashboard;
- admin console dalam enterprise portal;
- payment provider;
- identity provider tertentu;
- widget integration;
- microfrontend shell;
- documentation preview;
- sandboxed internal tools.

Jadi design question-nya bukan:

```text
Apakah X-Frame-Options harus selalu DENY?
```

melainkan:

```text
Halaman mana yang boleh di-embed, oleh siapa, dan untuk tujuan apa?
```

Gunakan policy per route/page jika perlu.

---

## 8. Referrer-Policy

### 8.1 Apa Itu Referer?

`Referer` header dapat dikirim browser untuk memberitahu halaman asal request.

Contoh:

```http
Referer: https://app.example.com/orders/123?tab=payment
```

Nama header historisnya salah eja: `Referer`, bukan `Referrer`.

Security policy header-nya:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

---

### 8.2 Kenapa Berbahaya?

URL sering mengandung informasi sensitif:

- token reset password;
- magic login link;
- email address;
- customer id;
- order id;
- tenant id;
- query search;
- internal case id;
- feature flag;
- debug parameter.

Jika halaman memuat third-party resource, referrer bisa bocor.

---

### 8.3 Policy Umum

| Policy | Behavior Ringkas |
|---|---|
| `no-referrer` | Tidak kirim referrer sama sekali |
| `no-referrer-when-downgrade` | Tidak kirim saat downgrade HTTPS → HTTP |
| `origin` | Hanya kirim origin |
| `origin-when-cross-origin` | Full URL same-origin, origin untuk cross-origin |
| `same-origin` | Kirim hanya untuk same-origin |
| `strict-origin` | Origin saja dan tidak kirim ke downgrade |
| `strict-origin-when-cross-origin` | Full URL same-origin, origin cross-origin HTTPS, tidak downgrade |
| `unsafe-url` | Kirim full URL hampir selalu; biasanya buruk |

Default modern browser banyak bergerak ke `strict-origin-when-cross-origin`, tetapi aplikasi sensitif tetap sebaiknya eksplisit.

Baseline defensible:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

Lebih ketat:

```http
Referrer-Policy: same-origin
```

Paling ketat:

```http
Referrer-Policy: no-referrer
```

---

### 8.4 Jangan Taruh Secret di URL

Referrer policy adalah mitigasi, bukan izin untuk menaruh secret di URL.

Hindari:

```text
/reset?token=secret
/callback?access_token=secret
/invoice?email=user@example.com
```

Lebih baik:

- gunakan short-lived one-time code;
- segera exchange code lalu redirect ke URL bersih;
- gunakan fragment hanya jika memang flow mengharuskan, tetapi pahami risiko lain;
- gunakan POST untuk sensitive operation;
- bersihkan URL dengan `history.replaceState()` setelah bootstrap jika perlu.

---

## 9. Permissions-Policy

### 9.1 Apa Itu Permissions-Policy?

`Permissions-Policy` mengontrol browser features yang boleh dipakai oleh dokumen dan nested frame.

Contoh baseline ketat:

```http
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
```

Artinya:

```text
Halaman ini dan child frame-nya tidak boleh memakai geolocation, camera, microphone, payment, atau USB.
```

---

### 9.2 Kenapa Frontend Perlu Peduli?

Karena fitur browser sensitif sering dipakai oleh:

- product feature;
- third-party widget;
- analytics/ads script;
- embedded iframe;
- browser extension interaction;
- future code tanpa review.

Permissions-Policy memberi default-deny capability.

Contoh aplikasi case management biasa tidak butuh camera/microphone:

```http
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Jika halaman tertentu butuh camera untuk upload KYC:

```http
Permissions-Policy: camera=(self), microphone=()
```

---

### 9.3 Per-route Policy

Jangan semua halaman diberi izin yang sama.

Contoh:

| Route | Policy |
|---|---|
| `/dashboard` | camera/microphone/geolocation disabled |
| `/profile/photo-capture` | camera allowed self |
| `/map` | geolocation allowed self |
| `/payment` | payment allowed self atau provider tertentu |
| `/admin` | semua capability sensitif disabled |

Per-route policy lebih aman daripada global permissive policy.

---

## 10. Subresource Integrity / SRI

### 10.1 Apa Itu SRI?

SRI bukan response header utama, tetapi bagian dari security control untuk resource loading.

Contoh:

```html
<script
  src="https://cdn.example.com/library.js"
  integrity="sha384-..."
  crossorigin="anonymous">
</script>
```

Browser menghitung hash resource yang didownload. Jika tidak cocok dengan `integrity`, resource tidak dijalankan.

---

### 10.2 Kapan Berguna?

SRI berguna untuk:

- script/style dari CDN third-party;
- library static dengan versi fixed;
- mengurangi risiko CDN compromise;
- memastikan file tidak berubah diam-diam.

Kurang cocok untuk:

- URL yang selalu berubah;
- asset yang digenerate dinamis;
- third-party tag manager yang memang berubah runtime;
- script yang intentionally self-updating.

---

### 10.3 SRI Tidak Mengganti CSP

SRI menjawab:

```text
Apakah file yang diunduh sama dengan hash yang saya harapkan?
```

CSP menjawab:

```text
Dari mana resource boleh dimuat dan bagaimana script boleh dieksekusi?
```

Keduanya berbeda dan saling melengkapi.

---

## 11. Cross-Origin Isolation Headers: Preview untuk Part 022

Part 022 akan membahas lebih dalam, tapi overview-nya penting di sini.

### 11.1 COOP

```http
Cross-Origin-Opener-Policy: same-origin
```

Mengontrol hubungan browsing context dengan opener/window lain.

Dampak:

- dapat memutus akses `window.opener` cross-origin;
- membantu isolasi terhadap cross-origin attacks;
- bagian dari requirement cross-origin isolation.

---

### 11.2 COEP

```http
Cross-Origin-Embedder-Policy: require-corp
```

Membuat halaman hanya dapat memuat resource cross-origin yang secara eksplisit mengizinkan embedding, misalnya lewat CORS atau CORP.

Dampak:

- bisa memblokir image/script/font/wasm dari third-party jika header tidak cocok;
- perlu koordinasi dengan CDN/vendor;
- sering mengejutkan frontend team.

---

### 11.3 CORP

```http
Cross-Origin-Resource-Policy: same-origin
```

Memberi tahu browser siapa yang boleh menggunakan resource ini secara cross-origin.

Nilai umum:

```text
same-origin
same-site
cross-origin
```

---

### 11.4 Cross-Origin Isolation

Untuk fitur tertentu seperti `SharedArrayBuffer`, browser modern membutuhkan cross-origin isolation.

Biasanya melibatkan:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Tetapi konsekuensinya besar pada resource loading, iframe, third-party scripts, dan CDN-hosted assets.

---

## 12. Reporting: Jangan Deploy Policy Tanpa Telemetry

### 12.1 CSP Violation Reports

Report-only CSP memungkinkan browser mengirim laporan pelanggaran.

Konsep:

```http
Content-Security-Policy-Report-Only: default-src 'self'; report-to csp-endpoint
Reporting-Endpoints: csp-endpoint="https://reports.example.com/csp"
```

Report dapat berisi:

- directive yang dilanggar;
- blocked URL;
- document URL;
- line/column tertentu;
- sample tergantung policy dan browser.

Jangan mengumpulkan report tanpa privacy review. URL bisa mengandung data sensitif.

---

### 12.2 Network Error Logging / NEL

NEL dapat membantu melaporkan network errors dari browser.

Contoh konseptual:

```http
NEL: {"report_to":"network-errors","max_age":86400,"include_subdomains":true}
Reporting-Endpoints: network-errors="https://reports.example.com/nel"
```

Berguna untuk:

- DNS failure;
- TLS failure;
- connection reset;
- outage regional;
- CDN issue;
- browser-observed errors.

Tetapi perlu governance:

- sampling;
- privacy;
- retention;
- report volume;
- separation antara security dan performance telemetry.

---

## 13. Header yang Deprecated atau Perlu Dihindari

### 13.1 `X-XSS-Protection`

Dulu dipakai untuk mengaktifkan browser XSS filter:

```http
X-XSS-Protection: 1; mode=block
```

Masalah:

- banyak browser modern sudah menghapus/mematikan fitur terkait;
- bisa menimbulkan behavior aneh;
- tidak menggantikan CSP.

Baseline modern biasanya:

```http
X-XSS-Protection: 0
```

atau tidak mengandalkannya sama sekali, tergantung standar organisasi.

---

### 13.2 HPKP / Public-Key-Pins

HPKP memungkinkan pinning public key lewat header.

Masalah besar:

```text
Salah pin bisa membuat domain tidak bisa diakses untuk waktu lama.
```

Header ini deprecated dan umumnya tidak boleh digunakan.

Gunakan:

- certificate automation;
- monitoring expiry;
- Certificate Transparency monitoring;
- HSTS;
- operational discipline.

---

### 13.3 `Expect-CT`

`Expect-CT` historisnya dipakai untuk Certificate Transparency enforcement/reporting.

Di browser besar, CT enforcement sudah menjadi bagian platform untuk publicly trusted certificates, sehingga header ini tidak lagi menjadi control utama.

---

### 13.4 `Feature-Policy`

Legacy predecessor dari `Permissions-Policy`.

Gunakan:

```http
Permissions-Policy: ...
```

bukan `Feature-Policy` untuk desain baru.

---

## 14. Baseline Security Header Profiles

Tidak ada satu config universal. Tetapi kita bisa membuat baseline per jenis response.

### 14.1 Baseline untuk HTML SPA / SSR App

Contoh awal defensible, masih perlu disesuaikan:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com
```

Catatan:

- `script-src 'self'` mungkin belum cukup jika ada CDN/vendor.
- `style-src 'self'` bisa memblokir CSS-in-JS inline style.
- `connect-src` harus mencakup API, WebSocket, reporting endpoint.
- `img-src data: https:` sering dipakai untuk avatar/base64/icon, tetapi perlu dievaluasi.
- `frame-ancestors 'none'` tidak cocok jika app harus embedded.

---

### 14.2 Baseline untuk API JSON Response

Untuk API response:

```http
Content-Type: application/json; charset=utf-8
X-Content-Type-Options: nosniff
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Security-Policy: frame-ancestors 'none'; default-src 'none'
```

Catatan:

- API JSON tidak butuh menjalankan script.
- `default-src 'none'` untuk API response bisa masuk akal sebagai belt-and-suspenders jika response dibuka langsung di browser.
- CORS headers tetap terpisah dari CSP.
- Cache-Control tergantung data; tidak semua API harus `no-store`, tapi auth/personalized response harus hati-hati.

---

### 14.3 Baseline untuk Static Assets

Untuk hashed JS/CSS assets:

```http
Content-Type: text/javascript
X-Content-Type-Options: nosniff
Cache-Control: public, max-age=31536000, immutable
```

Untuk CSS:

```http
Content-Type: text/css
X-Content-Type-Options: nosniff
Cache-Control: public, max-age=31536000, immutable
```

Static assets biasanya tidak perlu CSP sendiri, karena CSP diterapkan pada document yang memuat asset.

Tetapi response headers tetap harus benar.

---

### 14.4 Baseline untuk User Upload Domain

Idealnya user-uploaded files tidak diserve dari origin utama app.

Contoh:

```text
app.example.com       -> aplikasi utama
uploads.example-cdn.com -> user files
```

Headers untuk file download:

```http
X-Content-Type-Options: nosniff
Content-Disposition: attachment
Content-Security-Policy: default-src 'none'; sandbox
Cross-Origin-Resource-Policy: cross-origin
```

Tergantung use case, `CORP` bisa lebih ketat.

Untuk preview file, gunakan viewer dengan sandboxing dan CSP khusus.

---

## 15. Security Headers dan CDN/Proxy

### 15.1 Header Bisa Ditimpa Layer Lain

Response path bisa seperti ini:

```text
Browser
  ↑
CDN
  ↑
WAF
  ↑
Load Balancer
  ↑
Ingress
  ↑
Backend / SSR / Static Host
```

Header dapat:

- ditambahkan;
- dihapus;
- digabung;
- ditimpa;
- berbeda per path;
- berbeda per status code;
- berbeda untuk cached response.

Jangan hanya cek source code.

Cek actual response di browser/curl:

```bash
curl -I https://app.example.com/
```

Cek redirect chain:

```bash
curl -IL https://app.example.com/
```

Cek asset:

```bash
curl -I https://app.example.com/assets/app.abc123.js
```

Cek API:

```bash
curl -I https://api.example.com/me
```

---

### 15.2 Duplicate Header Bisa Berbahaya

Contoh buruk:

```http
Content-Security-Policy: default-src 'self'
Content-Security-Policy: script-src https://cdn.example.com
```

Multiple CSP headers dapat digabung secara enforcement dalam cara yang mungkin tidak sesuai harapan. Result-nya bisa lebih restriktif atau membingungkan.

Better:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com
```

Pastikan hanya satu owner yang menghasilkan final policy, atau gunakan merger yang benar-benar dipahami.

---

### 15.3 Header per Status Code

Security headers sering hilang pada:

- 404 page;
- 500 error page;
- 301/302 redirect;
- maintenance page;
- CDN error page;
- auth gateway login page;
- static file fallback;
- localized error page.

Attack surface tidak hanya happy path.

Checklist:

```text
Apakah CSP/HSTS/nosniff/referrer policy ada pada:
- 200 HTML?
- 404 HTML?
- 500 HTML?
- redirect response?
- maintenance page?
- unauthenticated page?
- authenticated page?
- admin route?
```

---

## 16. Security Headers dan Frontend Build System

### 16.1 Nonce Integration

Jika menggunakan CSP nonce, build/runtime perlu mendukung:

- server generate nonce per response;
- nonce disisipkan ke inline `<script>`/`style>`;
- header CSP memakai nonce yang sama;
- nonce tidak di-cache salah;
- CDN tidak menyajikan HTML bernonce static ke semua user;
- hydration/bootstrap script kompatibel.

SSR pseudo-flow:

```text
request masuk
  ↓
generate nonce random
  ↓
render HTML dengan <script nonce="...">
  ↓
set Content-Security-Policy: script-src 'nonce-...'
  ↓
response dikirim
```

Jika HTML di-cache di CDN, nonce per response menjadi rumit. Perlu edge generation, hole punching, atau hash-based design.

---

### 16.2 Inline Runtime Config

Banyak frontend menyisipkan config:

```html
<script>
  window.__APP_CONFIG__ = {
    apiBaseUrl: "https://api.example.com"
  }
</script>
```

Dengan CSP ketat, inline script ini diblokir kecuali:

- diberi nonce;
- diberi hash;
- dipindah ke external JSON/config endpoint;
- policy mengizinkan unsafe-inline, yang lebih lemah.

Alternative:

```html
<script nonce="...">
  window.__APP_CONFIG__ = {...}
</script>
```

atau:

```html
<script type="application/json" id="app-config">
  {"apiBaseUrl":"https://api.example.com"}
</script>
```

Tetap perlu escaping aman saat menyisipkan JSON ke HTML.

---

### 16.3 CSS-in-JS

Library tertentu menyisipkan `<style>` runtime.

CSP impact:

```http
style-src 'self'
```

bisa memblokir injected style.

Solusi tergantung library:

- nonce support;
- extract CSS at build time;
- accept temporary `'unsafe-inline'` untuk style;
- migrate styling architecture;
- isolate legacy page.

---

### 16.4 Third-party Scripts

Third-party scripts paling sulit untuk CSP:

- analytics;
- tag manager;
- chat widget;
- payment;
- A/B testing;
- monitoring;
- session replay;
- fraud detection.

Masalah:

- mereka load script lanjutan dari host lain;
- host bisa berubah;
- inline snippets;
- eval usage;
- data exfiltration risk;
- privacy constraints.

Jangan asal menambahkan:

```http
script-src * 'unsafe-inline' 'unsafe-eval'
```

Lebih baik:

- inventory vendor;
- batasi route yang memuat vendor;
- gunakan nonce/hash untuk snippet;
- isolate dalam iframe jika mungkin;
- pakai SRI untuk fixed script;
- review data yang dikirim;
- monitor CSP reports;
- punya kill switch.

---

## 17. Debugging Security Header Issues

### 17.1 Gejala Umum

| Gejala | Kemungkinan Header |
|---|---|
| Script tidak jalan | CSP `script-src`, MIME + `nosniff` |
| CSS hilang | CSP `style-src`, MIME + `nosniff` |
| API call blocked sebelum CORS | CSP `connect-src` |
| Image/font tidak muncul | CSP `img-src`/`font-src`, CORP/COEP |
| App tidak bisa di-iframe | `frame-ancestors`, `X-Frame-Options` |
| Camera/geolocation tidak bisa dipakai | `Permissions-Policy` |
| Link keluar tidak membawa referrer | `Referrer-Policy` |
| HTTP otomatis jadi HTTPS | HSTS |
| Local/staging domain rusak HTTPS | HSTS includeSubDomains/preload/cert issue |
| WebAssembly/SharedArrayBuffer gagal | COOP/COEP/cross-origin isolation |

---

### 17.2 Cara Membaca DevTools

Gunakan:

- Network tab → response headers.
- Console → CSP/security violation.
- Issues tab → browser-detected security problems.
- Security tab → HTTPS/certificate/mixed content.
- Application tab → service worker/cache/cookies jika terkait.

Langkah diagnosis:

```text
1. Reproduce di browser yang sama.
2. Cek Console error exact.
3. Cek request/response di Network.
4. Cek apakah request benar-benar dikirim atau diblokir sebelum network.
5. Cek response header final, bukan source config.
6. Cek redirect chain.
7. Cek apakah header beda antara HTML/API/asset/error page.
8. Cek CDN/proxy mutation.
9. Cek browser-specific behavior.
10. Tambahkan report-only/telemetry jika issue sulit direproduksi.
```

---

### 17.3 Blocked by CSP vs CORS vs Network

Ini penting.

```text
CSP block:
  Browser policy document melarang resource/request.
  Biasanya Console menyebut Content Security Policy directive.

CORS block:
  Browser sudah melakukan request atau preflight,
  tetapi response tidak memenuhi CORS policy untuk dibaca JS.

Network failure:
  DNS/TLS/TCP/QUIC/timeout/server unreachable.
```

Jangan menyelesaikan semua dengan “tambahkan CORS”.

Contoh:

```text
Refused to connect to 'https://api.example.com' because it violates the following Content Security Policy directive: "connect-src 'self'".
```

Ini bukan CORS. Ini CSP.

---

## 18. Rollout Strategy: Dari Tidak Ada ke Production-Grade

### 18.1 Urutan Implementasi yang Realistis

Untuk aplikasi existing besar:

1. Inventory current headers.
2. Tambahkan low-risk headers:
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy` deny untuk capability yang jelas tidak dipakai
3. Pastikan HTTPS penuh.
4. Rollout HSTS bertahap.
5. Tambahkan anti-framing policy sesuai requirement.
6. CSP Report-Only baseline.
7. Perbaiki violation.
8. Enforce CSP minimal.
9. Tighten CSP bertahap.
10. Tambahkan reporting observability.
11. Review cross-origin isolation jika dibutuhkan.

---

### 18.2 Jangan Mulai dari CSP Paling Ketat

Policy seperti ini bagus di slide:

```http
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

Tetapi pada aplikasi existing, ini sering langsung mematahkan:

- runtime config inline;
- CSS-in-JS;
- analytics;
- CDN fonts;
- image CDN;
- API subdomain;
- WebSocket;
- payment widget;
- auth redirect helpers.

Gunakan report-only dulu.

---

### 18.3 Policy per Surface

Jangan satu policy untuk semua.

| Surface | Policy Strategy |
|---|---|
| Public marketing page | Ada third-party scripts; CSP perlu vendor-specific |
| Auth pages | Sangat ketat; minim third-party |
| Main app shell | Ketat, connect-src jelas, script nonce/hash |
| Admin app | Sangat ketat, no embedding |
| API response | default-src none, nosniff, no-store jika sensitif |
| Static assets | MIME benar, nosniff, long cache |
| Upload domain | attachment/sandbox/origin isolation |
| Error pages | Tetap diberi baseline security headers |

---

## 19. Review Checklist untuk Pull Request / Architecture Review

Gunakan checklist ini saat review aplikasi frontend/backend/CDN.

### 19.1 General

- Apakah response final punya header yang diharapkan?
- Apakah header dicek pada HTML, API, asset, redirect, dan error page?
- Apakah header diset di satu layer atau banyak layer?
- Apakah ada duplicate/conflicting headers?
- Apakah header berbeda antar environment?
- Apakah staging mendekati production?

### 19.2 CSP

- Apakah ada CSP?
- Apakah masih memakai `unsafe-inline` untuk script?
- Apakah masih memakai `unsafe-eval`?
- Apakah `connect-src` eksplisit?
- Apakah `frame-ancestors` diset?
- Apakah `base-uri` diset?
- Apakah `form-action` diset?
- Apakah third-party domains terinventarisasi?
- Apakah CSP report-only pernah dijalankan?
- Apakah violation dimonitor?

### 19.3 HSTS

- Apakah semua traffic HTTPS?
- Apakah `max-age` sesuai maturity?
- Apakah `includeSubDomains` aman?
- Apakah preload benar-benar keputusan sadar?
- Apakah certificate automation reliable?

### 19.4 MIME / nosniff

- Apakah `X-Content-Type-Options: nosniff` ada?
- Apakah JS/CSS/WASM/font punya MIME benar?
- Apakah upload user tidak diserve sembarangan dari app origin?

### 19.5 Framing

- Apakah halaman sensitif bisa di-iframe?
- Apakah `frame-ancestors` sesuai business requirement?
- Apakah `X-Frame-Options` dipakai untuk compatibility jika relevan?

### 19.6 Referrer

- Apakah `Referrer-Policy` eksplisit?
- Apakah URL mengandung secret/PII?
- Apakah OAuth/reset/magic-link flow membersihkan URL?

### 19.7 Permissions

- Apakah capability browser yang tidak dipakai dimatikan?
- Apakah route yang butuh camera/geolocation diberi policy khusus?
- Apakah iframe third-party diberi izin minimum?

---

## 20. Case Studies

### 20.1 Case: API Call Gagal Setelah CSP Diperketat

Gejala:

```text
Frontend tidak bisa fetch ke https://api.example.com.
CORS sudah benar.
Postman berhasil.
```

Console:

```text
Refused to connect to 'https://api.example.com/me' because it violates the following Content Security Policy directive: "connect-src 'self'".
```

Root cause:

```text
CSP connect-src hanya mengizinkan origin frontend.
API subdomain belum masuk allowlist.
```

Fix:

```http
Content-Security-Policy: connect-src 'self' https://api.example.com
```

Prevention:

```text
Semua API/WebSocket/beacon/reporting endpoint harus masuk connect-src review.
```

---

### 20.2 Case: App Blank Setelah `nosniff`

Gejala:

```text
Deploy sukses.
Browser menolak app.js.
```

Network:

```http
Content-Type: text/plain
X-Content-Type-Options: nosniff
```

Console:

```text
Refused to execute script because its MIME type is not executable, and strict MIME type checking is enabled.
```

Root cause:

```text
Static host/CDN salah mengirim MIME type untuk .js.
```

Fix:

```http
Content-Type: text/javascript
```

Prevention:

```text
Tambahkan smoke test untuk MIME type asset utama.
```

---

### 20.3 Case: Dashboard Tidak Bisa Di-embed di Enterprise Portal

Gejala:

```text
Portal internal ingin iframe dashboard.
Browser menolak render iframe.
```

Headers:

```http
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

Root cause:

```text
Anti-clickjacking policy global tidak sesuai requirement embedding.
```

Fix option:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.com
```

Hapus/adjust `X-Frame-Options` jika konflik dengan kebutuhan allowlist modern.

Prevention:

```text
Tentukan per route mana yang embeddable dan siapa allowed ancestor-nya.
```

---

### 20.4 Case: Camera API Tidak Bisa Dipakai

Gejala:

```text
Halaman KYC tidak bisa membuka camera walau user sudah memberi permission.
```

Header:

```http
Permissions-Policy: camera=()
```

Root cause:

```text
Policy global mematikan camera untuk semua route.
```

Fix:

```http
Permissions-Policy: camera=(self), microphone=()
```

khusus route KYC.

Prevention:

```text
Capability policy harus per surface, bukan satu config global buta.
```

---

### 20.5 Case: Reset Token Bocor ke Third-party

Gejala:

```text
Security review menemukan reset URL masuk log analytics vendor.
```

Flow:

```text
/reset-password?token=abc
  ↓
Halaman memuat analytics script/image
  ↓
Referer berisi full URL/token
```

Root cause:

```text
Sensitive token di URL + referrer policy terlalu longgar + third-party resource.
```

Fix:

- jangan taruh long-lived secret di URL;
- exchange token segera;
- redirect ke URL bersih;
- set `Referrer-Policy` lebih ketat;
- hindari third-party scripts di auth/reset pages.

---

## 21. Practical Header Examples

### 21.1 Modern SPA Conservative Baseline

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), usb=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Catatan:

```text
Ini bukan copy-paste final.
Ini starting point untuk review.
```

---

### 21.2 SPA dengan API, WebSocket, Image CDN, Font CDN

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://images.examplecdn.com; font-src 'self' https://fonts.examplecdn.com; connect-src 'self' https://api.example.com wss://realtime.example.com https://reports.example.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

---

### 21.3 SSR dengan Nonce

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{RANDOM_PER_RESPONSE}'; style-src 'self' 'nonce-{RANDOM_PER_RESPONSE}'; img-src 'self' data: https:; connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

HTML:

```html
<script nonce="{RANDOM_PER_RESPONSE}">
  window.__BOOTSTRAP__ = {"user":"..."};
</script>
```

Important:

```text
Jangan cache HTML bernonce secara shared tanpa memastikan nonce digenerate ulang per response.
```

---

### 21.4 API JSON Sensitive Response

```http
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

---

## 22. Common Anti-patterns

### Anti-pattern 1: CSP Terlalu Longgar agar “Tidak Error”

```http
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval' data: blob:
```

Masalah:

```text
Policy hampir tidak memberi proteksi berarti.
```

Lebih baik:

- mulai dari report-only;
- allowlist eksplisit;
- nonce/hash untuk inline;
- kurangi third-party;
- route-specific exception.

---

### Anti-pattern 2: Mengira CORS dan CSP Sama

CORS:

```text
Apakah JS dari origin A boleh membaca response dari origin B?
```

CSP:

```text
Apakah dokumen ini boleh memuat/menjalankan/menghubungi source tertentu?
```

Keduanya bisa sama-sama memblokir request, tapi layer-nya berbeda.

---

### Anti-pattern 3: Satu Header Global untuk Semua Response

Masalah:

```text
HTML, API, asset, upload, iframe page, error page punya kebutuhan berbeda.
```

Lebih baik:

```text
Policy per surface.
```

---

### Anti-pattern 4: Menaruh Secret di URL Lalu Mengandalkan Referrer-Policy

Referrer policy membantu, tetapi desain aman adalah tidak menaruh secret long-lived di URL.

---

### Anti-pattern 5: HSTS Preload Tanpa Governance

HSTS preload sulit rollback.

Harus ada:

- domain inventory;
- HTTPS readiness;
- certificate automation;
- incident plan;
- subdomain ownership;
- security/platform approval.

---

### Anti-pattern 6: CSP Report Dikumpulkan tapi Tidak Dianalisis

Report endpoint tanpa triage hanya menjadi log sink.

Harus ada:

- sampling;
- deduplication;
- dashboard;
- alert rule;
- owner;
- privacy handling;
- retention policy.

---

## 23. Mental Model Final

Security headers bekerja seperti ini:

```text
Server/CDN/proxy mengirim policy
        ↓
Browser menerapkan policy pada dokumen/resource
        ↓
Frontend code berjalan dalam sandbox yang lebih sempit
        ↓
Bug/injection/vendor compromise punya ruang gerak lebih kecil
```

Tetapi:

```text
Security headers bukan pengganti secure coding.
Security headers bukan pengganti authz server-side.
Security headers bukan pengganti validation.
Security headers bukan pengganti dependency hygiene.
Security headers bukan pengganti threat modelling.
```

Security headers adalah **defense-in-depth yang sangat efektif** karena enforcement dilakukan oleh browser di sisi user, dekat dengan tempat serangan frontend terjadi.

---

## 24. Practical Decision Framework

Saat menentukan header, jangan mulai dari “best practice list”. Mulai dari pertanyaan berikut.

### 24.1 Apa Surface-nya?

```text
HTML app?
API JSON?
Static asset?
Upload file?
Error page?
Embedded widget?
Admin page?
Auth page?
```

### 24.2 Apa Threat Model-nya?

```text
XSS?
Clickjacking?
MIME confusion?
Referrer leakage?
Third-party script compromise?
Browser capability abuse?
Cross-origin embedding?
HTTPS downgrade?
```

### 24.3 Apa Dependency-nya?

```text
API host?
WebSocket host?
Image CDN?
Font CDN?
Payment provider?
Analytics?
Tag manager?
Iframe parent/child?
Service worker?
CSS-in-JS?
```

### 24.4 Apa Rollout Strategy-nya?

```text
Canary?
Report-only?
Per route?
Per environment?
Fallback?
Rollback?
Monitoring?
```

### 24.5 Apa Invariant yang Harus Dijaga?

Contoh invariant:

```text
Admin pages must never be framed.
Auth pages must not load third-party scripts.
Main app can only call approved API origins.
User uploads must not execute in app origin.
No route should require unsafe-eval.
No personalized API response may be cached publicly.
All production subdomains must support HTTPS before HSTS includeSubDomains.
```

Invariant seperti ini lebih kuat daripada checklist header karena bisa dipakai dalam review desain dan incident analysis.

---

## 25. Latihan

### Latihan 1: Audit Header Aplikasi

Ambil satu aplikasi web dan cek:

```bash
curl -IL https://your-app.example.com/
curl -I https://your-app.example.com/assets/app.js
curl -I https://your-api.example.com/me
curl -I https://your-app.example.com/non-existing-page
```

Jawab:

1. Header security apa yang ada?
2. Header apa yang hilang?
3. Apakah HTML/API/asset/error page berbeda?
4. Apakah redirect response punya header penting?
5. Apakah ada duplicate/conflicting headers?

---

### Latihan 2: Design CSP untuk SPA

Diberikan app:

```text
Frontend: https://app.example.com
API: https://api.example.com
Realtime: wss://realtime.example.com
Images: https://img.examplecdn.com
Fonts: https://fonts.examplecdn.com
Analytics: https://analytics.vendor.com
Tidak boleh iframe
Tidak butuh camera/mic/geolocation
```

Buat:

- CSP;
- HSTS;
- Referrer-Policy;
- Permissions-Policy;
- X-Content-Type-Options;
- X-Frame-Options compatibility decision.

---

### Latihan 3: Debug CSP Violation

Error:

```text
Refused to load the script 'https://cdn.vendor.com/widget.js' because it violates the following Content Security Policy directive: "script-src 'self'".
```

Pertanyaan:

1. Apakah ini CORS?
2. Apa fix paling cepat?
3. Apa fix paling aman?
4. Apa risiko menambahkan vendor tersebut?
5. Apakah perlu SRI?
6. Apakah route tersebut memang butuh widget?

---

### Latihan 4: HSTS Rollout Plan

Buat rollout untuk domain:

```text
example.com
app.example.com
api.example.com
legacy.example.com masih HTTP-only
```

Pertanyaan:

1. Apakah aman memakai `includeSubDomains`?
2. Apa `max-age` awal?
3. Apa syarat sebelum preload?
4. Apa incident plan jika certificate expired?

---

## 26. Ringkasan

Security headers adalah cara server mengirim instruksi keamanan ke browser.

Yang paling penting:

- `Content-Security-Policy` membatasi resource loading dan script execution.
- `Strict-Transport-Security` memaksa HTTPS setelah browser menerima policy.
- `X-Content-Type-Options: nosniff` mencegah MIME sniffing.
- `X-Frame-Options` dan `CSP frame-ancestors` melindungi dari clickjacking.
- `Referrer-Policy` membatasi kebocoran URL melalui `Referer`.
- `Permissions-Policy` membatasi browser capabilities.
- COOP/COEP/CORP mengatur isolasi cross-origin dan akan dibahas lebih dalam di Part 022.
- Reporting penting agar policy bisa di-rollout tanpa mematahkan aplikasi secara buta.

Top 1% engineer tidak hanya bertanya:

```text
Header apa yang harus saya pasang?
```

Tetapi bertanya:

```text
Policy boundary apa yang saya butuhkan?
Threat apa yang saya mitigasi?
Surface mana yang terdampak?
Dependency apa yang harus diizinkan?
Bagaimana saya tahu policy bekerja tanpa mematahkan user flow?
```

---

## 27. Referensi

Referensi utama untuk bagian ini:

- MDN Web Docs — Content Security Policy.
- MDN Web Docs — Strict-Transport-Security.
- MDN Web Docs — X-Content-Type-Options.
- MDN Web Docs — X-Frame-Options.
- MDN Web Docs — Referrer-Policy.
- MDN Web Docs — Permissions-Policy.
- OWASP HTTP Security Response Headers Cheat Sheet.
- OWASP Content Security Policy Cheat Sheet.
- OWASP Secure Headers Project.

---

## 28. Status Seri

```text
Part 021 selesai.
Seri belum selesai.
Lanjut ke Part 022: Browser Isolation Policies: CORP, COEP, COOP, CORS, and Fetch Metadata.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-020.md">⬅️ Part 020 — TLS, HTTPS, Certificates, Mixed Content, and Secure Contexts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-022.md">Part 022 — Browser Isolation Policies: CORP, COEP, COOP, CORS, and Fetch Metadata ➡️</a>
</div>
