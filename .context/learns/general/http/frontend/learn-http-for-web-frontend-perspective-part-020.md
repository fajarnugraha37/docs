# learn-http-for-web-frontend-perspective-part-020.md

# Part 020 — TLS, HTTPS, Certificates, Mixed Content, and Secure Contexts

> Seri: `learn-http-for-web-frontend-perspective`  
> Perspektif: Java software engineer yang ingin memahami HTTP dari sisi browser/frontend secara tajam, praktis, dan defensible.  
> Status: Part 020 dari 035.  
> Prasyarat langsung: Part 001–019, terutama origin/site, cookies, CORS, caching, redirects, resource loading, dan HTTP/1.1/2/3.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **HTTPS/TLS dari perspektif frontend/browser**.

Banyak engineer backend melihat HTTPS sebagai urusan infra:

- pasang certificate;
- terminate TLS di load balancer;
- redirect HTTP ke HTTPS;
- selesai.

Untuk frontend engineer, HTTPS jauh lebih luas. HTTPS memengaruhi:

- apakah browser mengizinkan API tertentu;
- apakah cookie `Secure` bisa dikirim;
- apakah service worker boleh aktif;
- apakah clipboard/geolocation/WebAuthn tersedia;
- apakah mixed content diblokir;
- apakah redirect login aman;
- apakah HSTS mencegah downgrade attack;
- apakah local development menyerupai production;
- apakah certificate error bisa diabaikan;
- apakah corporate proxy/MITM membuat bug aneh;
- apakah resource dari CDN bisa dimuat dengan benar;
- apakah aplikasi dianggap berada dalam **secure context**.

Target setelah menyelesaikan bagian ini:

1. memahami HTTPS bukan hanya “HTTP + encryption”, tapi boundary trust browser;
2. bisa menjelaskan peran TLS, certificate, CA, SNI, ALPN, HSTS, dan secure context;
3. bisa mendiagnosis mixed content, certificate error, cookie `Secure`, service worker, dan local HTTPS issue;
4. bisa membedakan tanggung jawab frontend, backend, gateway, CDN, dan platform/security team;
5. bisa membuat checklist production-readiness untuk HTTPS di aplikasi web modern.

---

## 1. Mental Model Utama

### 1.1 HTTP menjawab: “apa yang dikirim?”

HTTP mendefinisikan semantic message:

- method;
- URL;
- status code;
- header;
- body;
- cache directive;
- redirect;
- representation metadata.

Contoh:

```http
GET /api/me HTTP/1.1
Host: api.example.com
Accept: application/json
Cookie: session=...
```

HTTP menjelaskan struktur request/response.

---

### 1.2 TLS menjawab: “apakah channel ini aman dan endpoint ini benar?”

TLS memberi beberapa properti utama:

1. **confidentiality** — pihak lain di jaringan tidak mudah membaca isi traffic;
2. **integrity** — traffic tidak mudah dimodifikasi tanpa terdeteksi;
3. **server authentication** — browser dapat memverifikasi bahwa server yang dihubungi benar-benar pemegang identitas domain tersebut;
4. opsional, **client authentication** — dalam beberapa sistem, client juga punya certificate, tapi ini jauh lebih jarang untuk web publik.

HTTPS pada praktiknya adalah HTTP yang berjalan di atas TLS.

Secara konseptual:

```text
Browser JavaScript
    ↓
Fetch / Navigation / Resource Loading
    ↓
HTTP semantics
    ↓
HTTP/1.1 or HTTP/2 or HTTP/3 mapping
    ↓
TLS or QUIC crypto layer
    ↓
TCP or UDP
    ↓
IP network
```

---

### 1.3 Browser menjawab: “apakah halaman ini boleh dipercaya untuk memakai kemampuan tertentu?”

Browser tidak hanya melihat apakah request berhasil.

Browser juga menilai:

- apakah page berjalan di secure context;
- apakah resource insecure dimuat dari page secure;
- apakah certificate valid;
- apakah host punya HSTS policy;
- apakah cookie `Secure` boleh dikirim;
- apakah API powerful boleh dipakai;
- apakah origin dipercaya;
- apakah user harus diperingatkan.

Inilah inti perspektif frontend:

> HTTPS bukan hanya transport security. HTTPS adalah prasyarat kepercayaan browser.

---

## 2. HTTPS Bukan Sekadar “Encrypt Traffic”

Kalimat “HTTPS mengenkripsi traffic” benar, tapi tidak cukup.

Dari sudut browser, HTTPS memberi jawaban atas tiga pertanyaan:

```text
1. Apakah saya berbicara ke server yang benar?
2. Apakah isi komunikasi dilindungi dari pembacaan/modifikasi pihak jaringan?
3. Apakah konteks ini cukup aman untuk diberi akses ke fitur browser yang sensitif?
```

Tanpa HTTPS, attacker di jaringan dapat melakukan hal seperti:

- membaca cookie/session token jika terkirim lewat HTTP;
- menyisipkan JavaScript ke HTML;
- mengganti file JS dari CDN;
- mengganti form action;
- mengubah API response;
- menyuntikkan redirect ke phishing site;
- memodifikasi asset aplikasi;
- melakukan downgrade attack dari HTTPS ke HTTP;
- memantau URL path/query yang berisi data sensitif.

Untuk SPA modern, satu file JavaScript yang termodifikasi berarti attacker dapat mengendalikan seluruh aplikasi di browser user.

Itulah kenapa “asset statis saja” tetap harus HTTPS.

---

## 3. Apa yang Dilindungi HTTPS?

### 3.1 Dilindungi

HTTPS melindungi terhadap pihak jaringan yang mencoba membaca atau memodifikasi traffic antara browser dan endpoint TLS.

Dilindungi dari observer jaringan:

- path dan query setelah host;
- request header;
- response header;
- request body;
- response body;
- cookie header;
- authorization header;
- HTML/JS/CSS/image bytes;
- API payload.

Contoh URL:

```text
https://example.com/account/123?tab=billing
```

Pihak jaringan biasanya masih dapat mengetahui domain tujuan melalui metadata tertentu, tetapi tidak dapat membaca path/query/body secara normal.

---

### 3.2 Tidak sepenuhnya disembunyikan

HTTPS tidak menyembunyikan semua metadata.

Pihak jaringan masih mungkin melihat atau menyimpulkan:

- IP address tujuan;
- domain melalui DNS jika DNS tidak terenkripsi;
- SNI dalam beberapa kondisi lama/non-ECH;
- ukuran traffic;
- timing traffic;
- frekuensi request;
- certificate metadata dalam beberapa kondisi;
- bahwa user mengakses suatu host tertentu.

Jadi HTTPS bukan anonimity system.

Ia adalah confidentiality + integrity + endpoint authentication untuk channel transport.

---

### 3.3 Tidak melindungi dari server sendiri

HTTPS melindungi traffic **ke server**, bukan dari server.

Jika server jahat, compromised, salah konfigurasi, atau log sensitif data, HTTPS tidak membantu.

Contoh:

- backend menyimpan password plaintext;
- API response membocorkan PII;
- server log mencatat token;
- aplikasi frontend mengirim data sensitif ke analytics pihak ketiga;
- server mengirim JavaScript berbahaya;
- XSS terjadi dari HTML/JS yang sah secara TLS.

HTTPS adalah necessary, not sufficient.

---

## 4. TLS Handshake: Yang Perlu Dipahami Frontend Engineer

Frontend engineer tidak perlu menghafal seluruh detail kriptografi TLS, tapi perlu memahami konsekuensi operasionalnya.

Secara konseptual, TLS handshake melakukan:

1. browser menghubungi server;
2. browser dan server menyepakati versi/properti TLS;
3. server mengirim certificate chain;
4. browser memverifikasi certificate chain;
5. browser memastikan certificate cocok dengan hostname;
6. browser dan server menyepakati secret key sesi;
7. setelah itu HTTP traffic dikirim lewat channel terenkripsi.

Simplified:

```text
Browser → Server: hello, supported TLS versions/ciphers, target host info
Server → Browser: certificate chain, chosen parameters
Browser: verify certificate, hostname, validity, trust chain
Browser ↔ Server: derive shared keys
Browser ↔ Server: encrypted HTTP traffic
```

Untuk frontend diagnosis, yang paling penting:

- handshake bisa gagal sebelum HTTP request pernah dikirim;
- kalau TLS gagal, backend application mungkin tidak melihat request sama sekali;
- error TLS sering muncul sebagai browser security error, bukan HTTP status code;
- tidak ada `500` kalau handshake gagal;
- DevTools bisa menunjukkan request gagal dengan status kosong atau `(failed)`.

---

## 5. Certificate Chain

### 5.1 Apa itu certificate?

Certificate mengikat identitas domain ke public key.

Secara sederhana, certificate menyatakan:

```text
Domain ini boleh menggunakan public key ini,
dan klaim ini ditandatangani oleh Certificate Authority yang dipercaya.
```

Certificate biasanya memuat:

- subject / domain names;
- Subject Alternative Name/SAN;
- public key;
- validity period;
- issuer;
- signature;
- key usage;
- extended key usage;
- chain information.

Modern browser terutama menggunakan SAN untuk mencocokkan hostname.

---

### 5.2 Apa itu certificate chain?

Certificate tidak berdiri sendiri.

Umumnya ada chain:

```text
Root CA
  ↓ signs
Intermediate CA
  ↓ signs
Leaf certificate for app.example.com
```

Browser/device menyimpan root CA yang dipercaya.

Server biasanya mengirim leaf certificate + intermediate certificate.

Browser memverifikasi bahwa leaf certificate dapat ditelusuri ke root CA yang dipercaya.

---

### 5.3 Common certificate chain problems

Masalah umum:

1. certificate expired;
2. hostname mismatch;
3. missing intermediate certificate;
4. certificate revoked;
5. certificate signed by untrusted CA;
6. certificate hanya valid untuk `www.example.com`, bukan `api.example.com`;
7. wildcard tidak cocok dengan level domain;
8. local development memakai self-signed cert yang belum dipercaya;
9. corporate proxy menyisipkan certificate root internal;
10. CDN certificate belum terprovision untuk custom domain.

Contoh mismatch:

```text
URL:         https://api.example.com
Certificate: *.internal.example.com
Result:      browser blocks
```

Contoh wildcard misconception:

```text
Certificate: *.example.com
Matches:     app.example.com
Does not match: a.b.example.com
```

---

## 6. CA Trust: Kenapa Browser Percaya Certificate?

Browser tidak “percaya server” secara langsung.

Browser percaya certificate karena chain-nya mengarah ke root CA yang ada dalam trust store.

Trust store bisa berasal dari:

- operating system;
- browser sendiri;
- enterprise-managed device;
- mobile platform;
- corporate security agent;
- local developer machine configuration.

Implikasi:

- certificate yang valid di laptop A bisa gagal di laptop B;
- corporate laptop bisa mempercayai corporate CA yang tidak dipercaya laptop pribadi;
- mobile device bisa punya trust behavior berbeda;
- container/dev VM bisa tidak punya root CA terbaru;
- Java backend service bisa gagal memanggil HTTPS endpoint karena JVM truststore berbeda dari OS/browser truststore.

Untuk Java engineer, ini penting:

> Browser trust store dan JVM truststore tidak selalu sama.

Itulah kenapa API call dari browser bisa berhasil, tetapi call dari Java service gagal dengan error certificate; atau sebaliknya.

---

## 7. Hostname Verification

Certificate valid secara kriptografis belum cukup.

Browser juga harus memastikan hostname URL cocok dengan nama pada certificate.

Contoh benar:

```text
URL: https://app.example.com
Certificate SAN: app.example.com
```

Contoh salah:

```text
URL: https://app.example.com
Certificate SAN: api.example.com
```

Browser akan memblokir.

Dari perspektif frontend, gejalanya:

- halaman tidak bisa dibuka;
- API request gagal sebelum HTTP response;
- DevTools tidak menunjukkan response body;
- user melihat interstitial security warning;
- `fetch()` gagal sebagai network error, bukan HTTP error.

---

## 8. SNI: Server Name Indication

SNI memungkinkan browser memberi tahu hostname yang ingin diakses saat TLS handshake.

Kenapa penting?

Satu IP/load balancer/CDN bisa melayani banyak domain:

```text
203.0.113.10:
  app.example.com
  api.example.com
  static.example.com
  tenant-a.example.net
```

Tanpa informasi hostname, server sulit memilih certificate yang benar.

Dengan SNI:

```text
Browser: saya ingin app.example.com
Server/CDN: kirim certificate untuk app.example.com
```

Masalah umum:

- CDN belum mengenali custom domain;
- load balancer default certificate salah;
- SNI tidak diteruskan dengan benar di proxy tertentu;
- old client tidak mendukung SNI;
- internal mTLS gateway salah memilih certificate.

Gejala frontend:

- hanya domain tertentu yang gagal;
- direct origin berhasil, custom domain gagal;
- staging domain gagal tapi production domain berhasil;
- error hostname mismatch.

---

## 9. ALPN: Memilih HTTP/1.1, HTTP/2, atau HTTP/3

ALPN adalah mekanisme negosiasi protocol di TLS handshake.

Browser dan server bisa menyepakati apakah koneksi menggunakan:

- HTTP/1.1;
- HTTP/2;
- atau protokol lain yang didukung.

Untuk HTTP/3, karena berjalan di atas QUIC/UDP, detailnya berbeda, tetapi dari sisi frontend penting memahami bahwa browser/CDN/server bernegosiasi protocol capability.

Kenapa frontend peduli?

Karena pilihan protocol memengaruhi:

- multiplexing;
- connection reuse;
- head-of-line blocking;
- waterfall shape;
- resource scheduling;
- latency;
- CDN behavior;
- debugging di Network panel.

Di DevTools, Anda bisa melihat protocol seperti:

```text
h2
http/1.1
h3
```

Jika expected HTTP/2 tapi ternyata HTTP/1.1, kemungkinan ada masalah di:

- CDN config;
- TLS termination;
- proxy;
- browser support;
- certificate/TLS settings;
- origin protocol support.

---

## 10. TLS Termination: Di Mana HTTPS Berakhir?

Dalam arsitektur modern, TLS sering tidak berakhir di aplikasi Java langsung.

Kemungkinan termination point:

```text
Browser
  ↓ HTTPS
CDN
  ↓ HTTPS or HTTP
Load Balancer
  ↓ HTTPS or HTTP
Ingress / API Gateway
  ↓ HTTP or HTTPS
Service Mesh Sidecar
  ↓ HTTP/gRPC
Java Service
```

Pertanyaan penting:

```text
Di mana TLS terminate?
Apakah traffic internal setelah termination tetap encrypted?
Siapa yang menambahkan redirect HTTPS?
Siapa yang menambahkan HSTS?
Siapa yang tahu original scheme?
Siapa yang memutuskan Secure cookie?
```

---

### 10.1 Common bug: aplikasi mengira request adalah HTTP

Jika TLS terminate di load balancer, request ke backend bisa masuk sebagai HTTP internal.

Backend mungkin melihat:

```text
request.isSecure() == false
scheme == http
```

Padahal user mengakses:

```text
https://app.example.com
```

Akibat:

- redirect dibuat ke `http://...`;
- cookie `Secure` tidak diset;
- absolute URL salah;
- OAuth redirect URI salah;
- generated links salah;
- HATEOAS/self link salah.

Solusi biasanya melibatkan trusted proxy headers:

```http
X-Forwarded-Proto: https
X-Forwarded-Host: app.example.com
Forwarded: proto=https;host=app.example.com
```

Namun ini harus dikonfigurasi hati-hati. Backend tidak boleh mempercayai header forwarded dari internet mentah-mentah; gateway/proxy harus sanitize dan set header tersebut.

---

## 11. HTTPS Redirect: HTTP ke HTTPS

Umum:

```text
http://example.com → https://example.com
```

Redirect ini biasanya memakai:

```http
301 Moved Permanently
Location: https://example.com/...
```

atau:

```http
308 Permanent Redirect
Location: https://example.com/...
```

Untuk browser, redirect HTTPS penting, tetapi punya kelemahan:

> Request pertama ke `http://` sudah terlanjur tidak aman sebelum redirect diterima.

Attacker jaringan dapat mencegah redirect itu sampai ke browser.

Itulah kenapa HSTS ada.

---

## 12. HSTS: Strict-Transport-Security

### 12.1 Apa itu HSTS?

HSTS adalah response header yang memberi tahu browser:

```text
Untuk host ini, ke depan pakai HTTPS saja.
Jangan coba HTTP.
Jangan izinkan user bypass certificate error.
```

Contoh:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

Meaning:

- `max-age=31536000`: berlaku sekitar 1 tahun;
- `includeSubDomains`: berlaku untuk subdomain juga;
- `preload`: sinyal intent untuk masuk preload list jika memenuhi syarat ekosistem browser.

---

### 12.2 HSTS mengubah urutan request

Tanpa HSTS:

```text
User enters http://example.com
Browser requests http://example.com
Server redirects to https://example.com
Browser requests https://example.com
```

Dengan HSTS cached:

```text
User enters http://example.com
Browser internally upgrades to https://example.com
Browser requests https://example.com directly
```

Tidak ada HTTP request pertama.

---

### 12.3 HSTS production caution

HSTS sangat kuat. Salah konfigurasi bisa membuat domain/subdomain tidak bisa diakses jika HTTPS rusak.

Risiko:

- `includeSubDomains` mengunci semua subdomain;
- staging/dev subdomain ikut terkena jika berada di bawah domain sama;
- subdomain lama yang belum HTTPS bisa break;
- certificate expiry menjadi fatal;
- rollback tidak instan karena browser cache HSTS sampai `max-age` berakhir.

Deployment strategy:

```text
1. Pastikan semua endpoint HTTPS valid.
2. Mulai max-age kecil.
3. Naikkan bertahap.
4. Baru pertimbangkan includeSubDomains.
5. Preload hanya setelah benar-benar yakin.
```

Contoh bertahap:

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

## 13. Secure Context

### 13.1 Definisi konseptual

Secure context adalah konteks browser yang memenuhi standar minimum keamanan, biasanya karena halaman dimuat lewat HTTPS atau berasal dari localhost yang diperlakukan khusus untuk development.

Banyak API browser hanya tersedia di secure context.

Contoh API/fitur yang umumnya memerlukan secure context:

- Service Worker;
- Push API;
- Notifications API dalam banyak skenario;
- Geolocation;
- Clipboard API modern;
- WebAuthn;
- Payment Request;
- Media Capture/getUserMedia;
- some Storage/Device APIs;
- Web Crypto dalam konteks tertentu;
- SharedArrayBuffer dengan syarat isolation tambahan.

Cek di browser:

```js
window.isSecureContext
```

Jika `false`, aplikasi modern bisa kehilangan fitur penting.

---

### 13.2 Kenapa browser membatasi API ke secure context?

Karena API tersebut powerful.

Misal jika attacker bisa MITM halaman HTTP dan menyisipkan JS, lalu halaman boleh memakai API sensitif, attacker bisa:

- membaca lokasi user;
- mengakses clipboard;
- mendaftarkan service worker malicious;
- mengakses kamera/mikrofon;
- melakukan phishing credential lebih canggih;
- mengontrol cache/offline behavior;
- berinteraksi dengan authenticator/WebAuthn.

Browser mencegah ini dengan rule:

> Powerful APIs hanya boleh dipakai dari konteks yang cukup aman.

---

### 13.3 Secure context bug pattern

Gejala:

```js
navigator.serviceWorker === undefined
navigator.clipboard === undefined
window.isSecureContext === false
```

Atau error:

```text
Only secure origins are allowed
The operation is insecure
Service workers can only be registered in secure contexts
```

Root cause umum:

- app dibuka via `http://` bukan `https://`;
- pakai IP address insecure;
- local dev bukan `localhost`;
- staging tidak HTTPS valid;
- iframe parent/child context tidak secure;
- certificate invalid;
- mixed/insecure embedding;
- WebView memiliki security model berbeda.

---

## 14. Mixed Content

### 14.1 Apa itu mixed content?

Mixed content terjadi ketika halaman HTTPS mencoba memuat resource melalui HTTP/insecure protocol.

Contoh:

```html
<script src="http://cdn.example.com/app.js"></script>
<img src="http://images.example.com/photo.jpg">
```

Page utama aman:

```text
https://app.example.com
```

Tetapi resource diminta via HTTP:

```text
http://cdn.example.com/app.js
```

Masalahnya: attacker jaringan bisa memodifikasi resource HTTP tersebut.

Jika yang dimodifikasi adalah JavaScript, attacker bisa mengontrol aplikasi.

---

### 14.2 Blockable vs upgradable mixed content

Browser modern membedakan jenis mixed content. Beberapa resource diblokir, beberapa mungkin di-upgrade otomatis ke HTTPS jika memungkinkan.

High-risk resources seperti script, stylesheet, iframe, fetch/XHR biasanya diblokir jika insecure.

Image/audio/video historically sering diperlakukan lebih longgar, tetapi tetap berisiko dan perilaku browser terus mengeras.

Prinsip praktis:

> Jangan mengandalkan toleransi mixed content. Semua subresource aplikasi production harus HTTPS.

---

### 14.3 Mixed content symptoms

Gejala di browser:

- script tidak jalan;
- stylesheet tidak diterapkan;
- image hilang;
- font tidak load;
- API request gagal;
- iframe blank;
- console warning/error;
- Network tab menunjukkan request blocked/mixed-content.

Contoh error:

```text
Mixed Content: The page at 'https://app.example.com' was loaded over HTTPS,
but requested an insecure script 'http://cdn.example.com/app.js'.
This request has been blocked.
```

---

### 14.4 Common root causes

1. hardcoded `http://` URL di source code;
2. CMS content berisi image HTTP;
3. backend generate absolute URL dengan scheme salah;
4. proxy tidak mengirim `X-Forwarded-Proto` dengan benar;
5. asset CDN belum HTTPS;
6. third-party widget lama masih HTTP;
7. environment variable `API_BASE_URL=http://...` terbawa ke production;
8. markdown/user-generated content berisi HTTP image;
9. redirect dari HTTPS ke HTTP;
10. service worker cache menyimpan URL lama.

---

## 15. `upgrade-insecure-requests`

CSP directive `upgrade-insecure-requests` memberi instruksi browser untuk meng-upgrade request insecure dari HTTP ke HTTPS sebelum dikirim.

Contoh:

```http
Content-Security-Policy: upgrade-insecure-requests
```

Ini berguna saat migrasi dari HTTP ke HTTPS.

Namun jangan dianggap solusi permanen untuk desain URL buruk.

Kelemahan:

- jika target tidak mendukung HTTPS, resource tetap gagal;
- tidak memperbaiki hardcoded absolute URL secara konseptual;
- bisa menyembunyikan masalah deployment;
- perlu observability agar tahu resource apa yang masih insecure.

Lebih baik:

```text
1. audit URL;
2. ubah source/cms/config ke HTTPS;
3. gunakan relative/protocol-correct URL bila tepat;
4. pakai CSP sebagai guardrail;
5. monitor report.
```

---

## 16. Cookie `Secure` dan HTTPS

Cookie dengan attribute `Secure` hanya dikirim lewat HTTPS.

Contoh:

```http
Set-Cookie: session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Implication:

- cookie tidak dikirim pada `http://`;
- server tidak boleh mengandalkan session cookie pada HTTP;
- local dev perlu strategi khusus;
- staging harus HTTPS jika ingin meniru production;
- `SameSite=None` untuk cross-site cookie modern juga mensyaratkan `Secure` di browser modern.

---

### 16.1 Common bug: login berhasil tetapi cookie tidak tersimpan/terkirim

Kemungkinan root cause:

1. response datang dari HTTP, tetapi cookie memakai `Secure`;
2. frontend akses `http://localhost`, API `https://api...`, cookie domain/path tidak cocok;
3. `SameSite=None` tanpa `Secure`;
4. CORS credential config salah;
5. backend tidak melihat original scheme sebagai HTTPS setelah TLS termination;
6. browser menolak cookie karena domain invalid;
7. third-party cookie restriction;
8. local dev memakai IP address bukan localhost/HTTPS.

Diagnosis:

```text
1. Buka DevTools → Network → login response.
2. Lihat Set-Cookie di response headers.
3. Cek apakah browser menampilkan warning cookie rejected.
4. Buka Application/Storage → Cookies.
5. Cek domain, path, Secure, HttpOnly, SameSite, Partitioned.
6. Lakukan request berikutnya dan cek apakah Cookie header terkirim.
7. Pastikan URL request benar-benar https jika cookie Secure.
```

---

## 17. Local Development HTTPS

### 17.1 Kenapa local dev sering berbeda dari production?

Production biasanya:

```text
https://app.example.com
https://api.example.com
Secure cookies
valid certificate
HSTS
CORS controlled
CDN/proxy layer
```

Local dev sering:

```text
http://localhost:5173
http://localhost:8080
self-signed cert
no HSTS
dev proxy
different hostnames
no CDN
```

Perbedaan ini memicu bug yang hanya muncul di production/staging.

---

### 17.2 Localhost special case

Browser memperlakukan `localhost` sebagai konteks yang biasanya cukup aman untuk beberapa fitur development, walaupun memakai HTTP.

Namun jangan menyamaratakan:

```text
http://localhost:3000      sering diperlakukan khusus
http://127.0.0.1:3000      bisa berbeda untuk cookie/domain/origin detail
http://192.168.1.10:3000   bukan localhost secure context secara umum
http://myapp.local:3000    tergantung setup/certificate
```

Untuk fitur yang benar-benar sensitif atau untuk meniru production, gunakan HTTPS local.

---

### 17.3 Strategi local HTTPS

Pilihan:

1. pakai dev server HTTPS;
2. pakai local CA seperti `mkcert`;
3. pakai reverse proxy lokal;
4. pakai Docker/Traefik/Caddy/Nginx dengan cert lokal;
5. pakai preview/staging environment remote;
6. pakai tunnel HTTPS seperti ngrok/cloudflared untuk integrasi webhook/mobile testing.

Kriteria setup bagus:

```text
- app memakai HTTPS;
- API memakai HTTPS atau dev proxy jelas;
- cookie behavior mendekati production;
- origin/site relationship eksplisit;
- tidak perlu disable browser security;
- certificate dipercaya lokal;
- mudah direplikasi satu tim.
```

---

## 18. Self-Signed Certificate

Self-signed certificate adalah certificate yang ditandatangani dirinya sendiri, bukan CA yang dipercaya browser.

Browser akan menolak kecuali user/device secara eksplisit mempercayainya.

Problem:

- user melihat warning;
- API call gagal;
- service worker tidak register;
- mobile device berbeda trust store;
- automated test environment gagal;
- WebView behavior berbeda;
- developers mulai membiasakan “ignore cert error”, yang buruk untuk security hygiene.

Lebih baik gunakan local CA yang diinstall ke trust store development.

---

## 19. Certificate Expiry Incident

Certificate expiry adalah salah satu incident paling memalukan tapi umum.

Gejala:

- seluruh site tidak bisa dibuka;
- API request gagal;
- status HTTP tidak muncul;
- monitoring HTTP application mungkin tidak melihat traffic;
- mobile apps/webview gagal;
- HSTS membuat user tidak bisa bypass;
- browser menampilkan security warning.

Prevention:

```text
1. Gunakan certificate automation.
2. Monitor expiry date dari luar jaringan.
3. Alert jauh sebelum expiry.
4. Test renewal path.
5. Pastikan intermediate chain benar.
6. Jangan hanya monitor 200 OK dari internal network.
7. Monitor semua hostname: app, api, cdn, auth, static, tenant domains.
```

Runbook incident:

```text
1. Identifikasi hostname yang gagal.
2. Cek certificate chain dari external vantage point.
3. Cek expiry/SAN/intermediate.
4. Renew/reissue certificate.
5. Deploy ke CDN/LB/gateway yang benar.
6. Purge/reload TLS config jika perlu.
7. Verify dari browser dan CLI.
8. Audit automation supaya tidak terulang.
```

---

## 20. Corporate Proxy, Antivirus, dan TLS Inspection

Di enterprise environment, traffic HTTPS kadang diinspeksi oleh corporate proxy.

Cara kerjanya secara konseptual:

```text
Browser ↔ Corporate Proxy ↔ Real Server
```

Proxy memasang root CA internal di device perusahaan, lalu membuat certificate per domain secara dinamis.

Bagi browser corporate device, certificate tersebut trusted.

Dampak:

- certificate issuer berbeda dari yang Anda lihat di laptop pribadi;
- beberapa TLS/security feature bisa gagal;
- certificate pinning bisa bermasalah;
- WebSocket/SSE kadang diputus;
- HTTP/2/3 bisa didowngrade;
- large upload/download bisa terganggu;
- CORS/debugging menjadi membingungkan;
- privacy/security posture berubah.

Frontend diagnosis harus mempertimbangkan:

```text
Apakah bug hanya terjadi di corporate network/device?
Apakah certificate issuer berubah?
Apakah VPN/proxy/antivirus aktif?
Apakah request gagal sebelum mencapai server?
Apakah protocol berubah dari h2/h3 ke http/1.1?
```

---

## 21. HTTPS dan Referrer Leakage

HTTPS melindungi traffic, tetapi browser masih dapat mengirim `Referer` header ke tujuan request tertentu, tergantung Referrer Policy.

Risiko:

```text
https://app.example.com/reset?token=secret
```

Jika halaman ini memuat third-party resource, URL penuh atau sebagian bisa bocor melalui `Referer` tergantung policy.

Mitigasi:

```http
Referrer-Policy: strict-origin-when-cross-origin
```

atau lebih ketat:

```http
Referrer-Policy: no-referrer
```

Praktik desain:

- jangan taruh token sensitif di query jika bisa dihindari;
- gunakan short-lived one-time token;
- gunakan fragment jika flow memang browser-only dan server tidak perlu melihat;
- bersihkan URL setelah token diproses;
- set Referrer-Policy;
- hindari third-party resource di halaman sangat sensitif.

---

## 22. HTTPS dan OAuth/OIDC Redirect

OAuth/OIDC browser flow sangat bergantung pada HTTPS.

Common requirements:

- redirect URI production harus HTTPS;
- cookie/session state harus secure;
- authorization code tidak boleh bocor;
- callback URL harus exact match;
- IdP sering menolak insecure redirect URI kecuali localhost development;
- HSTS membantu mencegah downgrade;
- Referrer Policy penting agar code/state tidak bocor ke third-party resource.

Common bug:

```text
User login → IdP redirects to https://app.example.com/callback
Backend/proxy thinks original scheme is http
App generates redirect_uri=http://app.example.com/callback
IdP rejects redirect_uri mismatch
```

Root cause biasanya forwarded headers/TLS termination.

---

## 23. HTTPS dan WebSocket/SSE

WebSocket secure memakai `wss://`, bukan `ws://`.

Jika halaman HTTPS mencoba membuka insecure WebSocket:

```js
new WebSocket("ws://example.com/socket")
```

Browser dapat memblokir sebagai mixed content/security issue.

Gunakan:

```js
new WebSocket("wss://example.com/socket")
```

SSE memakai HTTP(S) biasa:

```js
new EventSource("https://api.example.com/events")
```

Perhatikan:

- proxy/CDN timeout;
- TLS termination;
- idle connection;
- certificate validity;
- CORS untuk cross-origin SSE;
- corporate proxy behavior;
- HTTP/2/h3 support;
- reconnect behavior.

---

## 24. HTTPS dan Service Worker

Service worker membutuhkan secure context.

Kenapa?

Karena service worker bisa menjadi programmable network proxy untuk origin.

Jika attacker bisa menyisipkan service worker lewat HTTP, attacker bisa persistently hijack app.

Gejala jika tidak secure:

```text
Failed to register a ServiceWorker: The URL protocol of the current origin is not supported.
```

atau:

```js
if (!('serviceWorker' in navigator)) {
  // maybe insecure context or unsupported browser
}
```

Checklist:

```text
- App served via HTTPS.
- Certificate valid.
- Scope benar.
- No mixed content for service worker script.
- Service worker file has correct Content-Type.
- Cache does not serve old insecure URLs.
```

---

## 25. HTTPS dan CDN/Static Assets

Frontend modern sering memuat asset dari CDN:

```text
https://cdn.example.com/assets/app.a1b2c3.js
https://fonts.example.com/font.woff2
https://images.example.com/hero.webp
```

Hal yang perlu dicek:

- custom domain punya certificate valid;
- certificate mencakup CDN hostname;
- CDN supports HTTP/2/3;
- asset URL HTTPS;
- CORS headers benar untuk fonts/canvas/images jika perlu;
- cache headers benar;
- HSTS policy tidak merusak subdomain;
- origin pull ke storage juga aman jika required;
- redirect HTTP → HTTPS tidak menciptakan waterfall tambahan.

Bug umum:

```text
HTML: https://app.example.com
JS:   http://cdn.example.com/app.js
Result: blocked mixed content
```

atau:

```text
CDN custom domain active,
but certificate provisioning pending.
Result: certificate error in browser.
```

---

## 26. HTTPS dan API Base URL

Frontend sering punya config:

```env
VITE_API_BASE_URL=https://api.example.com
```

Kesalahan fatal:

```env
VITE_API_BASE_URL=http://api.example.com
```

Akibat:

- mixed content blocked dari HTTPS app;
- cookie `Secure` tidak terkirim;
- CORS debugging membingungkan;
- redirect tambahan;
- token bisa bocor jika benar-benar HTTP;
- production incident.

Guardrail:

```ts
const apiBaseUrl = new URL(import.meta.env.VITE_API_BASE_URL);

if (import.meta.env.PROD && apiBaseUrl.protocol !== 'https:') {
  throw new Error('Production API base URL must use HTTPS');
}
```

Untuk runtime config:

```js
if (location.protocol === 'https:' && apiUrl.protocol === 'http:') {
  console.error('Refusing insecure API URL from secure page');
}
```

---

## 27. HTTPS dan Absolute URL Generation di Backend

Backend sering membuat absolute URL untuk:

- email link;
- reset password;
- OAuth redirect;
- file download;
- pagination link;
- HATEOAS link;
- Open Graph URL;
- canonical URL;
- asset URL;
- webhook callback.

Jika backend salah memahami scheme/host, hasilnya:

```json
{
  "downloadUrl": "http://api.example.com/files/123"
}
```

Ketika frontend HTTPS memakai URL itu, browser bisa memblokir atau membuat user turun ke insecure channel.

Akar masalah:

- proxy headers salah;
- backend tidak dikonfigurasi trusted proxy;
- hardcoded base URL;
- environment config salah;
- multi-tenant domain tidak dipertimbangkan.

Prinsip:

> Jangan biarkan backend asal-asalan membuat absolute URL tanpa memahami external URL canonical.

---

## 28. Debugging TLS/HTTPS dari Browser

### 28.1 Di DevTools Network

Lihat:

- scheme URL: `https://` atau `http://`;
- status kosong atau `(failed)`;
- protocol: `h2`, `h3`, `http/1.1`;
- timing: stalled/SSL/TLS;
- security tab;
- certificate detail;
- mixed content warning;
- cookie warning;
- redirect chain;
- response headers: HSTS/CSP/Referrer-Policy.

---

### 28.2 Di browser Security panel

Cek:

- certificate valid;
- issuer;
- SAN;
- expiry;
- TLS version;
- mixed content;
- secure context;
- insecure origins.

---

### 28.3 JavaScript checks

```js
console.log(location.protocol);
console.log(location.origin);
console.log(window.isSecureContext);
console.log('serviceWorker' in navigator);
console.log('clipboard' in navigator);
```

Untuk resource URL:

```js
[...document.querySelectorAll('script[src],link[href],img[src]')]
  .map(el => el.src || el.href)
  .filter(url => url.startsWith('http://'));
```

---

### 28.4 Command-line checks

Untuk certificate:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com -showcerts
```

Untuk headers:

```bash
curl -I https://app.example.com
```

Untuk redirect:

```bash
curl -I -L http://app.example.com
```

Untuk protocol negotiation:

```bash
curl -I --http2 https://app.example.com
```

Catatan: hasil CLI tidak selalu identik dengan browser karena trust store, ALPN, HTTP/3, DNS, proxy, dan cache bisa berbeda.

---

## 29. HTTPS Failure Taxonomy

Gunakan taxonomy ini saat incident.

### 29.1 Pre-HTTP failure

Request gagal sebelum HTTP layer.

Contoh:

- DNS failure;
- TCP connection failure;
- TLS handshake failure;
- certificate expired;
- hostname mismatch;
- untrusted CA;
- protocol negotiation failure.

Gejala:

- tidak ada status code;
- server app log kosong;
- browser security error;
- `fetch()` reject sebagai network error.

---

### 29.2 HTTP-level failure

TLS berhasil, HTTP response ada.

Contoh:

- 301 redirect loop;
- 403 gateway;
- 502 CDN;
- 503 origin unavailable;
- 404 asset;
- 500 backend.

Gejala:

- status code terlihat;
- response headers terlihat;
- backend/gateway/CDN log mungkin ada.

---

### 29.3 Browser-policy failure

HTTP response ada atau resource target ada, tetapi browser memblokir.

Contoh:

- mixed content;
- CORS;
- CORP/COEP/COOP;
- CSP;
- insecure context;
- cookie rejected;
- MIME type blocked.

Gejala:

- Network mungkin menunjukkan response;
- Console menunjukkan policy error;
- JavaScript tidak bisa membaca response;
- request tampak “berhasil” di server tapi gagal di app.

---

## 30. Production HTTPS Checklist

### 30.1 Domain/certificate

```text
[ ] Semua public hostname punya certificate valid.
[ ] SAN mencakup hostname yang benar.
[ ] Intermediate chain lengkap.
[ ] Certificate renewal otomatis.
[ ] Expiry monitoring aktif dari external location.
[ ] CDN custom domain certificate sudah aktif.
[ ] Staging/preview environment juga HTTPS valid.
```

---

### 30.2 Redirect/HSTS

```text
[ ] HTTP redirect ke HTTPS.
[ ] Tidak ada HTTPS → HTTP redirect.
[ ] Tidak ada redirect loop.
[ ] HSTS diaktifkan bertahap.
[ ] includeSubDomains dipakai hanya jika semua subdomain siap.
[ ] preload hanya jika benar-benar matang.
```

---

### 30.3 Browser security context

```text
[ ] `window.isSecureContext === true` di production.
[ ] Service worker dapat register jika dibutuhkan.
[ ] Clipboard/geolocation/WebAuthn/API sensitif diuji di HTTPS.
[ ] Tidak ada mixed content warning/error.
[ ] Semua asset/API URL memakai HTTPS.
```

---

### 30.4 Cookies/auth

```text
[ ] Session cookie memakai Secure.
[ ] HttpOnly untuk cookie sensitif.
[ ] SameSite sesuai flow.
[ ] SameSite=None selalu disertai Secure.
[ ] Cookie domain/path benar.
[ ] TLS termination tidak membuat backend gagal set Secure cookie.
[ ] Logout membersihkan cookie dengan domain/path yang sama.
```

---

### 30.5 Proxy/gateway

```text
[ ] Trusted proxy headers dikonfigurasi benar.
[ ] Backend mengetahui original scheme/host.
[ ] Forwarded headers tidak bisa dipalsukan dari internet.
[ ] TLS termination point terdokumentasi.
[ ] Internal traffic encryption policy jelas.
[ ] API gateway/CDN tidak downgrade tanpa sengaja.
```

---

### 30.6 Local/staging parity

```text
[ ] Local dev punya opsi HTTPS.
[ ] Staging mendekati production untuk cookie/CORS/HTTPS.
[ ] Tidak ada kebiasaan disable browser security.
[ ] Test environment dapat memvalidasi certificate issue.
[ ] Mobile/WebView testing memakai HTTPS nyata.
```

---

## 31. Case Study 1 — Login Sukses tapi Session Hilang

### Symptom

User submit login form.

Response login:

```http
HTTP/1.1 200 OK
Set-Cookie: session=abc; Secure; HttpOnly; SameSite=None; Path=/
```

Frontend kemudian request:

```http
GET /api/me
```

Tapi server menganggap user anonymous.

---

### Investigation

Di DevTools:

- login response punya `Set-Cookie`;
- Application → Cookies tidak ada session;
- Console menunjukkan cookie rejected;
- API base URL ternyata `http://api.example.com`;
- page berasal dari `https://app.example.com`.

---

### Root cause

Cookie `Secure` tidak akan dikirim via HTTP.

Selain itu request HTTP dari page HTTPS dapat dianggap mixed/insecure.

---

### Fix

```text
1. API base URL wajib https.
2. CORS credential config benar.
3. Cookie Secure dipertahankan.
4. Staging/local dibuat mirip production.
5. Tambahkan build/runtime guardrail agar prod tidak boleh pakai http API.
```

---

## 32. Case Study 2 — Service Worker Tidak Aktif di Staging

### Symptom

PWA bekerja di production, tapi staging tidak offline-capable.

Console:

```text
Service workers can only be registered in secure contexts
```

---

### Investigation

```js
window.isSecureContext
// false
```

Staging dibuka via:

```text
http://staging.example.internal
```

---

### Root cause

Service worker membutuhkan secure context.

---

### Fix

- pasang HTTPS valid untuk staging;
- jangan test PWA behavior di insecure staging;
- tambahkan smoke test untuk `window.isSecureContext`;
- dokumentasikan local HTTPS setup.

---

## 33. Case Study 3 — Production Blank Page Setelah CDN Migrasi

### Symptom

Production page load, tapi blank.

Console:

```text
Mixed Content: The page at 'https://app.example.com' was loaded over HTTPS,
but requested an insecure script 'http://cdn.example.com/app.js'. This request has been blocked.
```

---

### Root cause

Asset manifest masih mengarah ke HTTP CDN URL.

---

### Fix

- update CDN asset base URL ke HTTPS;
- audit semua generated asset URL;
- tambahkan CSP `upgrade-insecure-requests` sementara jika cocok;
- tambahkan CI check untuk `http://` di built HTML/manifest;
- monitor console error/RUM.

---

## 34. Case Study 4 — OAuth Redirect URI Mismatch

### Symptom

Login ke IdP gagal.

Error:

```text
redirect_uri mismatch
```

Expected:

```text
https://app.example.com/callback
```

Actual generated:

```text
http://app.example.com/callback
```

---

### Root cause

TLS terminate di load balancer. Backend melihat request internal sebagai HTTP dan generate redirect URI dengan `http://`.

---

### Fix

- konfigurasi trusted forwarded headers;
- backend pakai external base URL canonical;
- gateway sanitize `X-Forwarded-*`;
- test OAuth flow lewat jalur production-like, bukan direct backend.

---

## 35. Design Principles

### Principle 1 — Treat HTTPS as app correctness, not infra decoration

Jika HTTPS salah, aplikasi bukan hanya “kurang aman”.

Aplikasi bisa tidak jalan:

- service worker gagal;
- cookie gagal;
- OAuth gagal;
- asset gagal;
- API gagal;
- browser API hilang.

---

### Principle 2 — Do not let production depend on HTTP tolerance

Jangan bergantung pada:

- browser auto-upgrade;
- redirect HTTP;
- user bypass certificate error;
- insecure local behavior;
- wildcard CORS untuk menutupi scheme issue;
- disabling browser security.

---

### Principle 3 — Model TLS termination explicitly

Selalu gambar:

```text
Browser → CDN → LB → Gateway → Service
```

Tandai:

- HTTPS segment;
- HTTP segment;
- termination point;
- header rewrite;
- redirect owner;
- HSTS owner;
- cookie owner;
- certificate owner.

---

### Principle 4 — Use browser evidence, not assumption

Untuk issue HTTPS, jangan mulai dari server code.

Mulai dari browser evidence:

```text
- URL scheme
- Security panel
- Certificate detail
- Console error
- Network protocol
- Cookie rejection reason
- Mixed content warning
- window.isSecureContext
```

---

## 36. Anti-Patterns

### Anti-pattern 1 — “Coba disable browser security”

Ini hanya menyembunyikan masalah.

Jika browser memblokir sesuatu, cari policy boundary-nya:

- mixed content;
- CORS;
- insecure context;
- certificate;
- cookie;
- CSP;
- CORP/COEP.

---

### Anti-pattern 2 — Production asset memakai protocol-relative URL

Dulu sering dipakai:

```html
<script src="//cdn.example.com/app.js"></script>
```

Masalahnya:

- jika page HTTP, asset ikut HTTP;
- intent tidak eksplisit;
- security posture kurang jelas.

Lebih baik eksplisit HTTPS:

```html
<script src="https://cdn.example.com/app.js"></script>
```

Atau gunakan relative URL jika sama origin:

```html
<script src="/assets/app.js"></script>
```

---

### Anti-pattern 3 — HSTS preload terlalu cepat

HSTS preload powerful tapi sulit rollback.

Jangan preload sebelum:

- semua subdomain jelas;
- certificate automation matang;
- monitoring siap;
- disaster recovery siap;
- ownership domain jelas.

---

### Anti-pattern 4 — Backend generate URL berdasarkan internal request

Jika backend berada di belakang proxy, internal scheme/host sering bukan external scheme/host.

Jangan asal pakai:

```java
request.getScheme()
request.getServerName()
```

Tanpa trusted proxy configuration.

---

### Anti-pattern 5 — Menganggap localhost sama dengan production

Localhost punya special cases.

Production punya:

- real certificate;
- real domain;
- HSTS;
- CDN;
- real cookie domain;
- real CORS;
- real TLS termination.

Tes yang hanya lolos di localhost belum membuktikan production correctness.

---

## 37. Practical Architecture Checklist untuk Java + Frontend Team

Untuk sistem Java backend + SPA frontend, review ini:

```text
External domains:
[ ] app.example.com
[ ] api.example.com
[ ] auth.example.com
[ ] cdn.example.com
[ ] tenant-specific domains if any

TLS:
[ ] Semua HTTPS valid.
[ ] Certificate renewal otomatis.
[ ] SAN/wildcard sesuai.
[ ] HSTS policy jelas.

Proxy:
[ ] TLS termination point jelas.
[ ] Forwarded headers trusted dan sanitized.
[ ] Backend generate external URL benar.

Cookies:
[ ] Secure/HttpOnly/SameSite benar.
[ ] Cross-site auth flow diuji.
[ ] Local/staging parity cukup.

Frontend:
[ ] API base URL HTTPS di production.
[ ] Tidak ada mixed content.
[ ] window.isSecureContext true.
[ ] Service worker tested under HTTPS.
[ ] Resource URLs tidak hardcoded HTTP.

Observability:
[ ] Certificate expiry alert.
[ ] Synthetic HTTPS check external.
[ ] RUM captures resource load failures.
[ ] Console/security errors monitored where possible.
[ ] CDN/LB/gateway logs correlated.
```

---

## 38. Latihan Mental Model

### Exercise 1 — Klasifikasi Failure

Untuk setiap kasus, tentukan: pre-HTTP, HTTP-level, atau browser-policy failure.

1. `fetch()` reject dengan `TypeError: Failed to fetch`, server log kosong.
2. Network tab menunjukkan `200`, tapi JS tidak bisa baca response karena CORS.
3. Browser menunjukkan “certificate expired”.
4. Script CDN blocked karena mixed content.
5. API response `502` dari gateway.
6. Service worker undefined di staging.
7. Cookie session tidak dikirim karena `Secure` di HTTP.
8. OAuth redirect URI dibuat `http://`.

Jawaban:

```text
1. pre-HTTP or network/browser-level failure
2. browser-policy failure
3. pre-HTTP TLS/certificate failure
4. browser-policy failure
5. HTTP-level failure
6. secure-context/browser-policy failure
7. browser-policy/cookie transport rule
8. architecture/proxy-generated URL bug, manifests as auth flow HTTP-level/application failure
```

---

### Exercise 2 — Gambar TLS Termination

Ambil sistem Anda dan gambar:

```text
Browser
  ↓
CDN
  ↓
Load Balancer
  ↓
Ingress
  ↓
Java API Gateway
  ↓
Service
```

Untuk tiap edge, jawab:

```text
- HTTPS atau HTTP?
- Siapa punya certificate?
- Siapa terminate TLS?
- Siapa set HSTS?
- Siapa redirect HTTP ke HTTPS?
- Siapa set cookie?
- Siapa generate absolute URL?
- Header forwarded apa yang dipercaya?
```

Jika tidak bisa dijawab, berarti boundary security belum cukup eksplisit.

---

## 39. Ringkasan

HTTPS/TLS dari perspektif frontend adalah tentang **trust boundary**.

HTTP menjelaskan pesan.

TLS melindungi channel dan memverifikasi endpoint.

Browser policy menentukan apakah konteks cukup aman untuk menjalankan fitur modern.

Poin inti:

1. HTTPS bukan hanya encryption, tapi dasar trust browser.
2. Certificate valid harus cocok hostname dan chain-nya dipercaya.
3. TLS failure terjadi sebelum HTTP response ada.
4. HSTS memaksa browser memakai HTTPS untuk host tertentu.
5. Secure context adalah prasyarat banyak Web APIs.
6. Mixed content membuat resource HTTP dari page HTTPS diblokir/di-upgrade tergantung tipe dan browser policy.
7. Cookie `Secure` hanya berjalan benar pada HTTPS.
8. TLS termination harus dimodelkan eksplisit agar redirect, cookie, OAuth, dan URL generation tidak salah.
9. Localhost bukan production; local HTTPS sering diperlukan.
10. Diagnosis HTTPS harus dimulai dari browser evidence.

---

## 40. Referensi Utama

- MDN — Secure Contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts
- MDN — Features restricted to secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts
- MDN — Mixed Content: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content
- MDN — Strict-Transport-Security: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- MDN — Set-Cookie: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- MDN — Using HTTP cookies: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
- RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html
- RFC 9114 — HTTP/3: https://www.rfc-editor.org/rfc/rfc9114.html
- RFC 8446 — TLS 1.3: https://www.rfc-editor.org/rfc/rfc8446.html

---

## 41. Koneksi ke Part Berikutnya

Part 020 membahas HTTPS/TLS sebagai trust boundary.

Part berikutnya, **Part 021 — Security Headers for Frontend Engineers**, akan membahas bagaimana server mengirim kebijakan keamanan ke browser melalui header seperti:

- `Content-Security-Policy`;
- `Strict-Transport-Security`;
- `X-Content-Type-Options`;
- `X-Frame-Options`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- `Cross-Origin-Opener-Policy`;
- `Cross-Origin-Embedder-Policy`;
- `Cross-Origin-Resource-Policy`;
- Subresource Integrity.

Jika Part 020 menjawab:

```text
Apakah channel dan context cukup aman?
```

Part 021 menjawab:

```text
Kebijakan apa yang browser harus enforce setelah halaman dimuat?
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-019.md">⬅️ Part 019 — HTTP/1.1, HTTP/2, HTTP/3: What Frontend Engineers Actually Need</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-021.md">Security Headers for Frontend Engineers ➡️</a>
</div>
