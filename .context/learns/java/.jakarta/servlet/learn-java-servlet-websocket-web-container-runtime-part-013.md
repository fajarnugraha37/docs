# learn-java-servlet-websocket-web-container-runtime-part-013

# Part 013 — Cookies, Headers, SameSite, and Browser Boundary

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Level: Advanced  
> Target: Java 8 sampai Java 25, `javax.servlet.*` sampai `jakarta.servlet.*`  
> Fokus: cookie, HTTP header, browser boundary, SameSite, domain/path, reverse proxy, SSO, dan failure modelling.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas `HttpSession`. Di sana kita melihat bahwa session di Servlet adalah **server-side continuity state**. Namun session jarang bekerja sendirian. Hampir selalu ada artefak kecil di sisi browser, biasanya `JSESSIONID`, yang dikirim bolak-balik melalui HTTP cookie.

Part ini membahas boundary tersebut:

```text
Browser cookie jar
  ↓ sends Cookie header
Reverse proxy / load balancer
  ↓ forwards request
Servlet container
  ↓ parses cookie/header
Application code
  ↓ writes response header
Servlet container
  ↓ emits Set-Cookie / header
Browser
  ↓ applies cookie rules
Future requests
```

Di titik inilah banyak bug web runtime muncul:

- login berhasil tetapi request berikutnya dianggap anonymous,
- logout tidak benar-benar logout,
- SSO gagal setelah browser upgrade,
- cookie tidak terhapus,
- cookie tidak terkirim di iframe/cross-site redirect,
- session hilang setelah pindah subdomain,
- redirect loop karena aplikasi mengira request datang dari HTTP, bukan HTTPS,
- cookie `Secure` tidak diset karena TLS terminate di reverse proxy,
- `SameSite=Lax` memblokir alur tertentu,
- header terlalu besar karena cookie bloat,
- Java code benar, tetapi browser menolak menyimpan cookie.

Mental model utama part ini:

> Cookie bukan sekadar key-value pair. Cookie adalah kontrak tiga pihak antara server, browser, dan URL context. Servlet hanya membuat header; browser yang memutuskan apakah cookie disimpan, dikirim, diganti, atau dihapus.

---

## 1. Apa yang Sebenarnya Terjadi Saat Server “Set Cookie”

Ketika aplikasi Java memanggil:

```java
Cookie cookie = new Cookie("theme", "dark");
cookie.setPath("/");
cookie.setHttpOnly(true);
cookie.setSecure(true);
response.addCookie(cookie);
```

kode ini tidak langsung “menyimpan cookie di browser”. Yang terjadi hanyalah container menambahkan header HTTP response:

```http
Set-Cookie: theme=dark; Path=/; Secure; HttpOnly
```

Setelah itu browser mengevaluasi header tersebut berdasarkan aturan cookie:

- apakah domain valid?
- apakah path valid?
- apakah `Secure` sesuai dengan skema request?
- apakah `SameSite=None` disertai `Secure`?
- apakah ukurannya terlalu besar?
- apakah policy browser memblokir third-party cookie?
- apakah user/browser privacy setting memblokir cookie?
- apakah cookie lama harus diganti?
- apakah cookie harus langsung dihapus karena `Max-Age=0` atau `Expires` masa lalu?

Servlet tidak bisa memaksa browser untuk menyimpan cookie. Servlet hanya bisa mengirim instruksi melalui `Set-Cookie`.

---

## 2. Cookie Flow dari Sudut Pandang Servlet

### 2.1 Response: server mengirim `Set-Cookie`

```http
HTTP/1.1 200 OK
Content-Type: text/html;charset=UTF-8
Set-Cookie: JSESSIONID=abc123; Path=/aceas; HttpOnly; Secure; SameSite=Lax

<html>...</html>
```

### 2.2 Browser menyimpan cookie

Browser menyimpan cookie dalam cookie jar dengan metadata kira-kira seperti ini:

```text
name       = JSESSIONID
value      = abc123
domain     = eservice.example.com
path       = /aceas
secure     = true
httpOnly   = true
sameSite   = Lax
expires    = session cookie / browser session
```

### 2.3 Request berikutnya: browser mengirim `Cookie`

Jika URL berikutnya match domain/path dan policy mengizinkan, browser mengirim:

```http
GET /aceas/application/list HTTP/1.1
Host: eservice.example.com
Cookie: JSESSIONID=abc123
```

Servlet membaca cookie melalui:

```java
Cookie[] cookies = request.getCookies();
```

Untuk session cookie, container memakai cookie tersebut sebelum aplikasi membaca cookie manual. Kalau `JSESSIONID` cocok dengan session aktif, `request.getSession(false)` akan mengembalikan session yang ada.

---

## 3. Cookie Bukan Header Biasa

Secara fisik cookie dikirim melalui header HTTP:

- response: `Set-Cookie`
- request: `Cookie`

Namun cookie berbeda dari header biasa karena browser memberi cookie **stateful behavior**. Header biasa seperti `X-Correlation-ID` tidak otomatis disimpan dan dikirim ulang oleh browser. Cookie iya.

Perbandingan:

| Aspek | Header biasa | Cookie |
|---|---:|---:|
| Dikirim server ke browser | Bisa | Bisa melalui `Set-Cookie` |
| Otomatis disimpan browser | Tidak | Ya, jika diterima policy browser |
| Otomatis dikirim request berikutnya | Tidak | Ya, jika domain/path/SameSite/Secure cocok |
| Bisa dibaca JavaScript | Tergantung header exposure | Bisa jika tidak `HttpOnly` |
| Cocok untuk session continuity | Tidak langsung | Ya |
| Risiko bloat setiap request | Rendah | Tinggi jika cookie besar |

Implikasinya: setiap byte cookie akan ikut pada banyak request yang cocok, termasuk static resource jika path/domain terlalu luas. Cookie besar bukan hanya masalah storage browser; ia memperbesar request header berkali-kali.

---

## 4. Anatomy `Set-Cookie`

Contoh lengkap:

```http
Set-Cookie: session=abc123; Path=/aceas; Domain=example.com; Max-Age=3600; Secure; HttpOnly; SameSite=Lax
```

Komponen:

| Bagian | Fungsi |
|---|---|
| `session=abc123` | Nama dan value cookie |
| `Path=/aceas` | URL path minimum agar cookie dikirim |
| `Domain=example.com` | Domain scope cookie |
| `Max-Age=3600` | Umur cookie dalam detik |
| `Expires=...` | Waktu kedaluwarsa absolut |
| `Secure` | Cookie hanya dikirim lewat HTTPS |
| `HttpOnly` | Cookie tidak bisa dibaca melalui `document.cookie` |
| `SameSite=Lax/Strict/None` | Membatasi pengiriman cookie pada cross-site request |

Beberapa atribut tidak dikirim kembali oleh browser dalam request. Request hanya membawa nama=value:

```http
Cookie: session=abc123; theme=dark
```

Browser tidak mengirim kembali `Path`, `Domain`, `HttpOnly`, `Secure`, atau `SameSite`. Metadata tersebut hanya dipakai browser untuk memutuskan apakah cookie dikirim.

---

## 5. Servlet API untuk Cookie

### 5.1 Membuat cookie

Modern Jakarta:

```java
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;

public void addThemeCookie(HttpServletResponse response) {
    Cookie cookie = new Cookie("theme", "dark");
    cookie.setPath("/");
    cookie.setMaxAge(60 * 60 * 24 * 30); // 30 days
    cookie.setSecure(true);
    cookie.setHttpOnly(true);
    response.addCookie(cookie);
}
```

Legacy Java EE:

```java
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletResponse;
```

Konsepnya sama; package berubah saat migrasi ke Jakarta EE 9+.

### 5.2 Membaca cookie

```java
public Optional<String> findCookie(HttpServletRequest request, String name) {
    Cookie[] cookies = request.getCookies();
    if (cookies == null) {
        return Optional.empty();
    }

    for (Cookie cookie : cookies) {
        if (name.equals(cookie.getName())) {
            return Optional.ofNullable(cookie.getValue());
        }
    }
    return Optional.empty();
}
```

Perhatikan `request.getCookies()` bisa `null`. Banyak bug kecil muncul karena developer menganggap selalu array kosong.

### 5.3 Menghapus cookie

Menghapus cookie berarti mengirim cookie dengan nama, domain, dan path yang sama, lalu memberi umur nol:

```java
public void deleteCookie(HttpServletResponse response) {
    Cookie cookie = new Cookie("theme", "");
    cookie.setPath("/");
    cookie.setMaxAge(0);
    cookie.setSecure(true);
    cookie.setHttpOnly(true);
    response.addCookie(cookie);
}
```

Kalau cookie awal dibuat dengan `Path=/aceas`, tetapi penghapusan memakai `Path=/`, browser bisa melihatnya sebagai cookie berbeda. Akibatnya cookie lama tetap hidup.

---

## 6. Domain: Scope Paling Sering Disalahpahami

### 6.1 Host-only cookie

Jika server tidak mengirim atribut `Domain`, cookie menjadi host-only cookie.

Contoh response dari:

```text
https://app.example.com/aceas
```

Header:

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly
```

Cookie hanya dikirim ke:

```text
app.example.com
```

Tidak otomatis dikirim ke:

```text
admin.example.com
api.example.com
example.com
```

### 6.2 Domain cookie

Jika server mengirim:

```http
Set-Cookie: sid=abc; Domain=example.com; Path=/; Secure; HttpOnly
```

cookie dapat dikirim ke:

```text
example.com
app.example.com
admin.example.com
api.example.com
```

Ini berguna untuk SSO antar subdomain, tetapi memperbesar blast radius. Jika satu subdomain rentan, cookie yang scope-nya terlalu luas bisa ikut terekspos dalam skenario tertentu.

### 6.3 Domain tidak boleh asal

Server di `app.example.com` tidak boleh set cookie untuk `evil.com`. Browser akan menolak. Server juga tidak boleh set cookie untuk public suffix seperti `.com`.

### 6.4 Leading dot modern

Secara historis orang menulis:

```http
Domain=.example.com
```

Browser modern memperlakukan leading dot sebagai detail kompatibilitas; mental model yang lebih penting adalah domain-match, bukan titik awalnya.

### 6.5 Domain decision matrix

| Kebutuhan | Domain disarankan |
|---|---|
| Cookie hanya untuk satu aplikasi | jangan set `Domain` / host-only |
| Cookie untuk semua subdomain internal | `Domain=example.com`, hati-hati blast radius |
| Multi-tenant per subdomain | host-only, hindari domain luas |
| SSO antar subdomain | pertimbangkan central auth domain, bukan membagi semua cookie aplikasi |
| API beda domain penuh | cookie mungkin bukan pilihan terbaik; pertimbangkan token flow yang benar |

---

## 7. Path: Bukan Security Boundary Kuat

`Path` menentukan URL path yang membuat browser mengirim cookie.

Contoh:

```http
Set-Cookie: sid=abc; Path=/aceas; Secure; HttpOnly
```

Cookie dikirim ke:

```text
/aceas
/aceas/
/aceas/application
/aceas/api/cases
```

Tidak dikirim ke:

```text
/cpds
/admin
/
```

Namun `Path` bukan security boundary kuat. Path membantu scoping dan mengurangi cookie leakage ke aplikasi lain dalam host yang sama, tetapi jangan mengandalkan path sebagai isolasi keamanan utama jika aplikasi berbeda berada pada host yang sama.

### 7.1 Path dan context path Servlet

Jika aplikasi deploy di:

```text
/aceas
```

maka session cookie biasanya memakai:

```http
Path=/aceas
```

Jika aplikasi deploy di root:

```text
/
```

maka cookie path biasanya:

```http
Path=/
```

Masalah muncul saat reverse proxy mengubah path.

Contoh external URL:

```text
https://eservice.example.com/aceas
```

Internal container menerima:

```text
http://app:8080/
```

Jika container mengira context path `/`, session cookie bisa dibuat dengan `Path=/`. Itu mungkin masih bekerja, tetapi cookie menjadi terlalu luas. Sebaliknya jika aplikasi mengirim path yang tidak cocok dengan external browser path, cookie tidak terkirim pada request berikutnya.

---

## 8. Max-Age, Expires, Session Cookie, Persistent Cookie

### 8.1 Session cookie

Jika cookie tidak punya `Max-Age` atau `Expires`, browser memperlakukannya sebagai session cookie.

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly
```

Session cookie biasanya hilang saat browser session berakhir, tetapi perilaku browser modern bisa dipengaruhi fitur session restore. Jangan menganggap session cookie selalu hilang saat window ditutup.

### 8.2 Persistent cookie

```http
Set-Cookie: remember=xyz; Path=/; Max-Age=2592000; Secure; HttpOnly
```

Cookie hidup selama 30 hari, kecuali user/browser menghapusnya lebih dulu.

### 8.3 `Max-Age` vs `Expires`

- `Max-Age` relatif terhadap waktu saat response diterima.
- `Expires` absolut berdasarkan timestamp.
- Jika keduanya ada, browser modern umumnya memprioritaskan `Max-Age`.

Praktik umum: gunakan `Max-Age` untuk kontrol programatik; tambahkan `Expires` hanya untuk kompatibilitas legacy bila perlu.

### 8.4 Deletion pattern

```http
Set-Cookie: sid=; Path=/aceas; Max-Age=0; Secure; HttpOnly
```

Atau:

```http
Set-Cookie: sid=; Path=/aceas; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly
```

Syarat penting: **name + domain + path harus match cookie yang ingin dihapus**.

---

## 9. `Secure`: Browser Hanya Mengirim via HTTPS

Cookie dengan `Secure` hanya dikirim pada request HTTPS:

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly
```

Browser akan mengirim:

```text
https://app.example.com/
```

Tidak mengirim ke:

```text
http://app.example.com/
```

### 9.1 Reverse proxy problem

Di production, TLS sering terminate di load balancer atau reverse proxy:

```text
Browser --HTTPS--> ALB/Nginx --HTTP--> Servlet container
```

Dari sisi browser, request aman. Dari sisi container, request internal terlihat HTTP. Jika aplikasi menentukan `cookie.setSecure(request.isSecure())`, hasilnya bisa salah:

```java
cookie.setSecure(request.isSecure()); // bisa false di belakang TLS offload
```

Akibatnya session cookie tidak diberi `Secure` walaupun external traffic HTTPS.

Solusi konseptual:

- pastikan container memahami forwarded proto,
- konfigurasi reverse proxy header dengan benar,
- gunakan container valve/filter seperti RemoteIpValve di Tomcat atau equivalent,
- set cookie secure secara eksplisit untuk production HTTPS,
- jangan bergantung naif pada `request.isSecure()` tanpa forwarded-header normalization.

### 9.2 Secure bukan enkripsi cookie value

`Secure` tidak mengenkripsi isi cookie. Ia hanya membatasi pengiriman cookie agar hanya melalui HTTPS. Jika cookie value berisi data sensitif, data itu tetap bisa terlihat pada sisi server, proxy TLS termination, log yang salah, atau browser storage inspection oleh user.

Prinsip penting:

> Cookie value sebaiknya opaque identifier, bukan payload sensitif.

---

## 10. `HttpOnly`: Melindungi dari JavaScript Access, Bukan Semua Serangan

Cookie `HttpOnly` tidak dapat diakses melalui `document.cookie`.

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly
```

Ini mengurangi dampak XSS yang mencoba mencuri session ID lewat JavaScript:

```javascript
document.cookie // sid tidak terlihat jika HttpOnly
```

Namun `HttpOnly` tidak berarti XSS menjadi tidak berbahaya. Jika attacker bisa menjalankan JavaScript di origin yang sama, attacker masih bisa membuat request atas nama user karena browser tetap otomatis mengirim cookie ke server.

Contoh:

```javascript
fetch('/aceas/api/transfer', {
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify({ amount: 1000 })
});
```

Cookie tidak bisa dibaca, tetapi tetap dikirim oleh browser. Karena itu `HttpOnly` harus dipadukan dengan:

- output escaping,
- CSP,
- CSRF protection jika relevan,
- authorization per action,
- audit trail,
- short-lived session,
- step-up auth untuk aksi kritikal.

---

## 11. `SameSite`: Browser-Level Cross-Site Control

`SameSite` membatasi kapan browser mengirim cookie pada request yang berasal dari konteks site lain.

Nilai umum:

```http
SameSite=Strict
SameSite=Lax
SameSite=None
```

### 11.1 Site vs origin

Ini bagian yang sering membuat bingung.

Origin mencakup:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com:443
```

Site biasanya berbasis registrable domain plus scheme dalam model browser modern.

Contoh yang sering dianggap beda origin tetapi same-site:

```text
https://app.example.com
https://admin.example.com
```

Keduanya beda origin karena host berbeda, tetapi bisa same-site karena sama-sama berada di `example.com` dengan scheme HTTPS.

### 11.2 `SameSite=Strict`

Cookie hanya dikirim pada same-site request. Sangat ketat.

Cocok untuk:

- admin panel internal,
- high-risk area,
- cookie preferensi non-SSO,
- aplikasi yang tidak butuh cross-site login/redirect.

Risiko:

- link dari email ke aplikasi bisa tidak membawa cookie,
- SSO redirect flow bisa gagal,
- integrasi antar site bisa rusak.

### 11.3 `SameSite=Lax`

Cookie dikirim pada same-site request dan sebagian top-level navigation GET dari site lain.

Ini sering menjadi default yang aman untuk banyak aplikasi web biasa.

Cocok untuk:

- session web app normal,
- mengurangi CSRF sederhana,
- login form biasa tanpa embedded iframe/cross-site POST callback.

Risiko:

- beberapa flow SSO/OIDC/SAML bisa bermasalah tergantung method dan browser behavior,
- cross-site iframe tidak mengirim cookie,
- API call cross-site dengan `fetch` tidak otomatis membawa cookie.

### 11.4 `SameSite=None`

Cookie dapat dikirim dalam cross-site context, tetapi browser modern mensyaratkan `Secure`.

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly; SameSite=None
```

Cocok untuk:

- aplikasi embedded di iframe cross-site,
- SSO tertentu,
- third-party integration yang memang membutuhkan cookie cross-site,
- central identity domain yang berinteraksi dengan app domain berbeda.

Risiko:

- memperbesar CSRF/cross-site attack surface,
- tergantung browser privacy policy,
- third-party cookie blocking bisa tetap memblokir skenario tertentu,
- tidak semua user agent legacy menangani `None` dengan benar.

### 11.5 Decision matrix SameSite

| Use case | SameSite awal yang masuk akal | Catatan |
|---|---|---|
| Web app biasa, same domain | `Lax` | Default aman untuk banyak kasus |
| Admin internal | `Strict` atau `Lax` | Uji link dari email dan redirect |
| OIDC/SAML login redirect | sering `Lax`, kadang butuh `None` | Tergantung flow dan cookie mana |
| App di iframe domain lain | `None; Secure` | Harus siap third-party cookie restriction |
| Cross-site API dengan cookie | `None; Secure` | Pertimbangkan apakah cookie cocok untuk API ini |
| CSRF-sensitive legacy form | `Lax` + CSRF token | Jangan hanya andalkan SameSite |

---

## 12. Servlet dan SameSite: API Evolution dan Workaround

### 12.1 `Cookie` API klasik

Pada banyak versi Servlet lama, `Cookie` API punya method seperti:

```java
cookie.setSecure(true);
cookie.setHttpOnly(true);
cookie.setPath("/");
cookie.setMaxAge(3600);
```

Namun dukungan eksplisit untuk atribut modern seperti `SameSite` lama tidak tersedia secara portable di semua versi API.

Akibatnya developer sering memakai header manual:

```java
response.addHeader(
    "Set-Cookie",
    "sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax"
);
```

Masalahnya: header manual rawan bug escaping/value encoding, duplikasi cookie, dan tidak selalu konsisten dengan container session cookie.

### 12.2 Servlet 6 era: generic cookie attributes

Pada API modern, `Cookie` dan `SessionCookieConfig` menyediakan kemampuan atribut tambahan/generic attributes melalui method seperti `setAttribute`/`getAttribute` pada implementasi yang mendukung Jakarta Servlet 6.x. Ini membuat atribut seperti `SameSite` bisa diatur lebih portable dibanding header manual.

Contoh konseptual modern:

```java
Cookie cookie = new Cookie("sid", "abc");
cookie.setPath("/");
cookie.setSecure(true);
cookie.setHttpOnly(true);
cookie.setAttribute("SameSite", "Lax");
response.addCookie(cookie);
```

Untuk session cookie:

```java
ServletContext context = event.getServletContext();
SessionCookieConfig config = context.getSessionCookieConfig();
config.setHttpOnly(true);
config.setSecure(true);
config.setPath("/aceas");
config.setAttribute("SameSite", "Lax");
```

Caveat: konfigurasi session cookie harus dilakukan sebelum session/context dipakai secara efektif. Biasanya di startup listener atau declarative config, bukan di tengah request setelah session dibuat.

### 12.3 Container-specific configuration

Banyak container juga menyediakan konfigurasi sendiri:

- Tomcat context/session cookie processor,
- Jetty session cookie config,
- Undertow/WildFly config,
- Spring Boot property layer di atas embedded container.

Prinsipnya:

> Untuk `JSESSIONID`, lebih baik atur melalui session cookie config/container config daripada menambahkan `Set-Cookie: JSESSIONID=...` manual.

Manual override session cookie mudah merusak tracking container.

---

## 13. Cookie Prefix: `__Host-` dan `__Secure-`

Browser modern mendukung cookie name prefix yang memberi constraint tambahan.

### 13.1 `__Secure-`

Cookie bernama:

```text
__Secure-sid
```

harus diset dengan `Secure` dari secure origin.

Contoh:

```http
Set-Cookie: __Secure-sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

### 13.2 `__Host-`

Cookie bernama:

```text
__Host-sid
```

umumnya harus:

- diset dari secure origin,
- punya `Secure`,
- tidak punya `Domain`,
- punya `Path=/`.

Contoh:

```http
Set-Cookie: __Host-sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Ini membantu mencegah subdomain tertentu menyetel cookie untuk domain induk dengan nama yang sama.

### 13.3 Kapan memakai prefix

| Prefix | Cocok untuk |
|---|---|
| `__Host-` | session cookie host-specific dengan path root dan domain tidak luas |
| `__Secure-` | cookie yang harus selalu secure tetapi masih mungkin butuh domain/path tertentu |

Namun untuk `JSESSIONID`, tidak semua container mudah mengubah nama cookie atau kompatibilitasnya. Jika bisa mengatur nama session cookie, prefix dapat dipertimbangkan, tetapi harus diuji menyeluruh.

---

## 14. Cookie Value: Encoding, Size, dan Sensitivity

### 14.1 Cookie value sebaiknya opaque

Buruk:

```text
role=admin
userEmail=fajar@example.com
permissions=CASE_READ,CASE_WRITE,...
```

Lebih baik:

```text
sid=72b0c7a6f8a34f13a8f0...
```

Server-side state disimpan di server/session store. Cookie hanya membawa identifier.

### 14.2 Hindari menyimpan data sensitif

Jangan menyimpan:

- password,
- token jangka panjang tanpa proteksi,
- PII,
- authorization list besar,
- role final yang dipercaya tanpa verifikasi server,
- serialized object,
- JSON besar.

Jika harus menyimpan token, pahami konsekuensi:

- apakah token bearer?
- apakah bisa dicuri dari log?
- apakah expiry pendek?
- apakah bisa direvoke?
- apakah binding ke device/session?
- apakah cookie `HttpOnly`, `Secure`, `SameSite` benar?

### 14.3 Size limit dan header bloat

Browser dan server punya batas ukuran cookie/header. Secara praktis, desain cookie harus kecil. Jangan mendekati limit. Banyak proxy/container punya batas request header seperti 8 KB, 16 KB, atau konfigurasi lain.

Gejala cookie bloat:

- HTTP 400 Bad Request,
- HTTP 431 Request Header Fields Too Large,
- login loop,
- hanya user tertentu gagal login,
- request static asset ikut membawa cookie besar,
- reverse proxy menolak sebelum request sampai aplikasi.

### 14.4 Encoding

Cookie value punya batas karakter. Hindari karakter raw yang ambigu. Gunakan encoding yang aman seperti Base64 URL tanpa padding jika perlu.

Contoh:

```java
String encoded = Base64.getUrlEncoder()
    .withoutPadding()
    .encodeToString(bytes);
```

Namun encoding bukan encryption. Base64 hanya representasi.

---

## 15. Multiple Cookies dengan Nama Sama

Browser bisa mengirim beberapa cookie dengan nama sama tetapi path/domain berbeda.

Contoh:

```http
Cookie: sid=oldRoot; sid=newAceas
```

Aplikasi yang membaca cookie manual bisa mengambil yang salah jika hanya mencari nama pertama.

Untuk session cookie, container punya logic sendiri. Tetapi jika aplikasi custom membaca cookie manual, hati-hati terhadap:

- duplicate cookie name,
- path berbeda,
- migration domain/path,
- cookie lama tidak terhapus,
- environment berbeda memakai host sama.

Praktik baik:

- gunakan nama cookie spesifik aplikasi,
- hapus cookie lama dengan path/domain lama saat migration,
- hindari menaruh banyak app berbeda di host/path yang membingungkan,
- inspect `Cookie` header raw saat debugging.

---

## 16. Cookie Deletion: Kenapa Logout Sering Gagal

Logout yang benar biasanya harus melakukan beberapa hal:

1. invalidate server-side session,
2. hapus session cookie di browser,
3. hapus remember-me cookie jika ada,
4. clear auth-related local state di frontend jika ada,
5. koordinasi dengan IdP/SSO jika memakai SSO,
6. pastikan response tidak membuat session baru setelah logout.

### 16.1 Salah: invalidate session tetapi cookie masih ada

```java
HttpSession session = request.getSession(false);
if (session != null) {
    session.invalidate();
}
response.sendRedirect("/login");
```

Ini menghapus session server-side, tetapi browser masih punya `JSESSIONID`. Pada request berikutnya container melihat ID lama, tidak menemukan session, lalu mungkin membuat session baru. Ini bisa terlihat seperti logout berhasil, tetapi cookie lama masih ada.

### 16.2 Benar: invalidate dan expire cookie

```java
public void logout(HttpServletRequest request, HttpServletResponse response) throws IOException {
    HttpSession session = request.getSession(false);
    if (session != null) {
        session.invalidate();
    }

    Cookie expired = new Cookie("JSESSIONID", "");
    expired.setPath(request.getContextPath().isEmpty() ? "/" : request.getContextPath());
    expired.setMaxAge(0);
    expired.setHttpOnly(true);
    expired.setSecure(true);
    response.addCookie(expired);

    response.sendRedirect(request.getContextPath() + "/login");
}
```

### 16.3 Hidden bug: `getSession()` setelah invalidate

```java
session.invalidate();
request.getSession(); // creates new session accidentally
```

Filter, JSP, framework, flash message, CSRF token generator, atau view rendering bisa tidak sengaja membuat session baru setelah logout.

Pattern aman:

- setelah logout, jangan render view yang butuh session,
- redirect ke endpoint stateless,
- audit filter yang memanggil `getSession()` tanpa `false`,
- gunakan `request.getSession(false)` jika hanya ingin membaca session.

---

## 17. Request Headers Penting di Browser Boundary

Selain cookie, beberapa header sangat memengaruhi Servlet application behavior.

### 17.1 `Host`

```http
Host: eservice.example.com
```

Dipakai untuk:

- virtual host routing,
- absolute URL generation,
- redirect URL,
- origin calculation,
- multi-tenant routing.

Di belakang proxy, pastikan host external dipertahankan atau diteruskan melalui forwarded headers.

### 17.2 `Origin`

```http
Origin: https://portal.example.com
```

Biasanya dikirim pada CORS request dan beberapa POST/navigation modern. Penting untuk:

- CORS validation,
- CSRF defense tambahan,
- WebSocket origin validation.

### 17.3 `Referer`

```http
Referer: https://portal.example.com/page
```

Bisa membantu diagnostics, tetapi jangan menjadi satu-satunya security control karena bisa hilang akibat policy/privacy.

### 17.4 `User-Agent`

Berguna untuk troubleshooting compatibility, tetapi tidak boleh dipercaya sebagai identity/security basis.

### 17.5 `Accept`, `Accept-Language`, `Accept-Encoding`

Mempengaruhi response negotiation, localization, compression.

### 17.6 `Forwarded` / `X-Forwarded-*`

Penting di belakang proxy:

```http
Forwarded: proto=https;host=eservice.example.com;for=203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: eservice.example.com
X-Forwarded-For: 203.0.113.10
```

Aplikasi/container perlu tahu external scheme/host untuk:

- `request.isSecure()` benar,
- redirect tidak turun ke HTTP,
- cookie secure policy benar,
- absolute URL generation benar,
- audit client IP benar.

---

## 18. Response Headers Penting untuk Browser Boundary

### 18.1 `Set-Cookie`

Sudah dibahas panjang. Ini header state boundary utama.

### 18.2 `Location`

Dipakai redirect:

```http
HTTP/1.1 302 Found
Location: /aceas/login
```

Bug umum:

- redirect absolute URL memakai internal host,
- redirect memakai HTTP padahal external HTTPS,
- context path hilang,
- double context path,
- open redirect karena parameter `next` tidak divalidasi.

### 18.3 `Cache-Control`

Untuk halaman authenticated, biasanya:

```http
Cache-Control: no-store
Pragma: no-cache
```

`no-store` penting untuk mencegah browser menyimpan halaman sensitif. `Pragma` lebih untuk kompatibilitas lama.

### 18.4 `Content-Security-Policy`

Membatasi sumber script/style/frame. Relevan untuk mengurangi dampak XSS, walaupun bukan Servlet-specific.

### 18.5 `X-Frame-Options` / CSP `frame-ancestors`

Mencegah clickjacking atau mengontrol siapa boleh embed aplikasi dalam iframe.

### 18.6 `Strict-Transport-Security`

Memaksa browser memakai HTTPS untuk domain tersebut setelah policy diterima.

### 18.7 `Referrer-Policy`

Mengontrol data referer yang dikirim browser.

### 18.8 `Access-Control-*`

Untuk CORS. Jangan mencampur CORS dan cookie tanpa memahami `credentials`.

---

## 19. CORS dan Cookie

CORS bukan mekanisme auth. CORS adalah browser enforcement untuk cross-origin JavaScript request.

Jika frontend di:

```text
https://portal.example.com
```

memanggil API di:

```text
https://api.example.com
```

maka JavaScript `fetch` perlu konfigurasi:

```javascript
fetch('https://api.example.com/me', {
  credentials: 'include'
});
```

Server perlu response:

```http
Access-Control-Allow-Origin: https://portal.example.com
Access-Control-Allow-Credentials: true
```

Tidak boleh:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Untuk cookie cross-site, cookie juga perlu policy yang mengizinkan, seringnya:

```http
Set-Cookie: sid=abc; Path=/; Secure; HttpOnly; SameSite=None
```

Namun jika `portal.example.com` dan `api.example.com` masih same-site, SameSite behavior bisa berbeda dari cross-origin behavior. Ini sebabnya engineer perlu membedakan origin dan site.

---

## 20. SSO, OIDC, SAML, dan SameSite

SSO adalah area di mana cookie policy paling sering membuat bug sulit.

### 20.1 Redirect-based login

Flow sederhana:

```text
User opens app.example.com
  ↓
App redirects to idp.example-idp.com
  ↓
User authenticates
  ↓
IdP redirects back to app.example.com/callback?code=...
  ↓
App creates session cookie
```

Jika app menyimpan temporary state/nonce di cookie sebelum redirect ke IdP, cookie tersebut harus tersedia saat callback kembali.

`SameSite=Lax` biasanya masih mengizinkan cookie pada top-level GET navigation, tetapi flow tertentu memakai POST callback atau iframe silent refresh sehingga butuh evaluasi berbeda.

### 20.2 Hidden iframe silent refresh

Legacy OIDC SPA pattern sering memakai hidden iframe ke IdP. Browser privacy dan SameSite/third-party-cookie restrictions dapat merusak pattern ini.

Arsitektur modern cenderung menghindari implicit flow + silent iframe dan memakai authorization code + PKCE, BFF pattern, atau session server-side tergantung kebutuhan.

### 20.3 Multi-app SSO antar subdomain

Contoh:

```text
aceas.example.com
cpds.example.com
login.example.com
```

Pilihan desain:

1. masing-masing app punya session cookie sendiri,
2. IdP punya cookie sendiri di `login.example.com`,
3. app redirect ke IdP saat butuh login,
4. jangan membagi `JSESSIONID` antar app kecuali benar-benar satu runtime/session domain.

Pattern yang lebih sehat:

```text
App session cookie: host-only aceas.example.com
CPDS session cookie: host-only cpds.example.com
IdP cookie: host-only login.example.com
```

Jangan asal membuat:

```http
Domain=example.com
```

untuk semua session app. Itu membuat session boundary kabur.

---

## 21. Reverse Proxy dan Cookie Rewriting

Reverse proxy bisa mengubah host/path/scheme yang dilihat browser dibanding yang dilihat container.

### 21.1 Path rewrite

External:

```text
https://example.com/aceas
```

Internal:

```text
http://aceas-service:8080/
```

Problem:

- aplikasi set cookie `Path=/`, terlalu luas,
- aplikasi redirect ke `/login`, browser menuju `https://example.com/login` bukan `/aceas/login`,
- app generate absolute URL internal.

Solusi:

- align context path external/internal jika mungkin,
- gunakan forwarded prefix header jika didukung,
- configure proxy cookie path rewrite dengan hati-hati,
- hindari absolute URL generation manual,
- test via external URL, bukan hanya internal pod/container URL.

### 21.2 Domain rewrite

Internal app mungkin set:

```http
Set-Cookie: sid=abc; Domain=internal.local
```

Browser external tidak menerima/menggunakan domain internal. Proxy kadang bisa rewrite cookie domain, tetapi lebih baik aplikasi/container dikonfigurasi dengan external host awareness.

### 21.3 Secure flag di TLS offload

Jika TLS terminate di proxy, app harus tetap mengirim `Secure` untuk cookie external. Ini perlu forwarded proto handling.

### 21.4 Multiple layers

Real production path bisa seperti:

```text
Browser
  ↓ HTTPS
CloudFront/WAF
  ↓ HTTPS
ALB
  ↓ HTTP/HTTPS
Ingress Nginx
  ↓ HTTP
Service
  ↓ HTTP
Servlet container
```

Cookie/header behavior harus dipahami end-to-end. Satu layer saja yang salah bisa membuat seluruh auth flow terlihat rusak.

---

## 22. Header Size, Cookie Bloat, dan 431

Karena cookie ikut pada request, cookie besar memperbesar header.

Contoh buruk:

```http
Cookie: jwt=eyJhbGciOi...<very large>; preferences=...; tracking=...; appState=...
```

Jika melewati batas:

- browser mungkin tetap mengirim,
- reverse proxy bisa menolak,
- load balancer bisa menolak,
- servlet container bisa menolak,
- aplikasi tidak pernah menerima request.

Gejala:

```text
HTTP 400
HTTP 431
HTTP 502/503 from proxy
Login works in incognito but fails in normal browser
Only one user fails
Clearing cookies fixes issue
```

Root cause sering cookie accumulation.

Checklist:

- inspect request header size,
- cek semua `Set-Cookie`,
- cari duplicate cookie name/path/domain,
- hapus legacy cookie saat migration,
- jangan simpan JWT besar di cookie jika tidak perlu,
- batasi custom cookie,
- set path lebih sempit untuk cookie app tertentu.

---

## 23. Cache Header dan Authenticated Pages

Cookie/session membuat response personal. Response personal tidak boleh sembarangan dicache.

Untuk halaman sensitif:

```http
Cache-Control: no-store
```

Untuk API authenticated:

```http
Cache-Control: no-store
```

Untuk static asset fingerprinted:

```http
Cache-Control: public, max-age=31536000, immutable
```

Perbedaan penting:

| Resource | Cache policy |
|---|---|
| HTML authenticated | `no-store` |
| JSON API user-specific | `no-store` atau private policy ketat |
| Static JS/CSS fingerprinted | long cache |
| File download sensitive | `no-store` + careful content disposition |
| Public image/logo | public cache |

Bug umum: semua response diberi `no-store`, akibatnya static asset lambat. Atau sebaliknya, halaman authenticated dicache dan bisa dilihat setelah logout via back button.

---

## 24. Security Headers sebagai Servlet Filter

Banyak security header bisa diset di filter:

```java
public final class SecurityHeadersFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletResponse response = (HttpServletResponse) res;
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Cache-Control", "no-store");

        chain.doFilter(req, res);
    }
}
```

Namun hati-hati:

- `Cache-Control: no-store` global bisa buruk untuk static assets,
- `X-Frame-Options: DENY` bisa merusak fitur embed yang sah,
- CSP terlalu ketat bisa merusak frontend,
- CSP terlalu longgar tidak berguna,
- security header harus didesain per resource class.

Lebih baik pisahkan filter/mapping:

```text
/api/*          -> no-store, JSON security headers
/app/*          -> no-store, CSP app
/static/*       -> long cache, no auth cookie dependency
/download/*     -> no-store, content disposition
```

---

## 25. Cookie dan CSRF

Cookie otomatis dikirim oleh browser. Itulah kekuatan sekaligus risiko.

Jika user login ke:

```text
https://bank.example.com
```

lalu mengunjungi attacker site, attacker bisa mencoba membuat browser user mengirim request ke bank. Browser akan membawa cookie jika policy mengizinkan.

`SameSite=Lax` membantu untuk banyak CSRF form POST sederhana, tetapi jangan hanya bergantung pada SameSite untuk aksi kritikal.

Defense umum:

- CSRF token synchronizer/double-submit pattern,
- SameSite cookie,
- Origin/Referer validation untuk state-changing request,
- require non-simple content type + CORS restriction untuk API tertentu,
- re-auth/step-up untuk aksi kritikal,
- idempotency key untuk request sensitif,
- authorization check per action.

Servlet-level understanding penting karena CSRF defense sering diwujudkan sebagai filter yang membaca cookie/header/session.

---

## 26. Practical Cookie Builder Pattern

Agar tidak tersebar raw cookie logic di banyak endpoint, buat util/policy object.

```java
public final class CookiePolicies {
    private CookiePolicies() {}

    public static Cookie secureHttpOnlyCookie(String name, String value, String path, int maxAgeSeconds) {
        Cookie cookie = new Cookie(name, value);
        cookie.setPath(path);
        cookie.setMaxAge(maxAgeSeconds);
        cookie.setSecure(true);
        cookie.setHttpOnly(true);
        cookie.setAttribute("SameSite", "Lax");
        return cookie;
    }

    public static Cookie expiredCookie(String name, String path) {
        Cookie cookie = new Cookie(name, "");
        cookie.setPath(path);
        cookie.setMaxAge(0);
        cookie.setSecure(true);
        cookie.setHttpOnly(true);
        cookie.setAttribute("SameSite", "Lax");
        return cookie;
    }
}
```

Untuk Java EE lama tanpa `setAttribute`, Anda mungkin perlu fallback header manual atau container-specific config. Tetapi tetap pusatkan logic supaya tidak ada 20 varian cookie yang berbeda.

---

## 27. Configuring Session Cookie via `ServletContextListener`

Contoh modern Jakarta:

```java
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.SessionCookieConfig;
import jakarta.servlet.annotation.WebListener;

@WebListener
public class SessionCookiePolicyListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        SessionCookieConfig cookieConfig = context.getSessionCookieConfig();

        String contextPath = context.getContextPath();
        String path = contextPath == null || contextPath.isBlank() ? "/" : contextPath;

        cookieConfig.setName("JSESSIONID");
        cookieConfig.setPath(path);
        cookieConfig.setHttpOnly(true);
        cookieConfig.setSecure(true);
        cookieConfig.setAttribute("SameSite", "Lax");
    }
}
```

Catatan:

- ini harus berjalan sebelum session dibuat,
- jangan set path asal jika aplikasi berada di belakang reverse proxy path rewrite,
- untuk SSO/cross-site flow, `SameSite=Lax` mungkin perlu dievaluasi,
- untuk local HTTP development, `Secure=true` membuat cookie tidak terkirim di HTTP biasa; gunakan profile config yang jelas.

---

## 28. Local Development vs Production

Problem umum:

```text
Production: HTTPS, Secure cookie works
Local: http://localhost:8080, Secure cookie not sent
```

Solusi tidak boleh membuat production turun standar.

Pisahkan policy:

| Environment | Cookie Secure | SameSite | Catatan |
|---|---:|---|---|
| local HTTP | false atau pakai HTTPS local | Lax | Jangan copy ke prod |
| local HTTPS | true | Lax | Lebih mirip prod |
| staging HTTPS | true | sama dengan prod | Wajib test SSO |
| production HTTPS | true | Lax/Strict/None sesuai desain | Jangan bergantung default |

Jangan biarkan `Secure` ditentukan oleh request internal yang mungkin HTTP karena proxy.

---

## 29. Testing Cookie Behavior

### 29.1 Browser DevTools

Inspect:

- Network tab response headers,
- Application/Storage cookies,
- blocked cookie reasons,
- request `Cookie` header,
- path/domain/SameSite/Secure/HttpOnly.

Pertanyaan debugging:

1. Apakah server mengirim `Set-Cookie`?
2. Apakah browser menerima atau memblokir?
3. Apakah cookie disimpan dengan domain/path yang benar?
4. Apakah request berikutnya match domain/path?
5. Apakah SameSite mengizinkan konteks request?
6. Apakah request HTTPS jika cookie `Secure`?
7. Apakah cookie duplicate dengan nama sama?
8. Apakah proxy mengubah/menghapus header?

### 29.2 curl

`curl` bagus untuk melihat header, tetapi tidak sepenuhnya meniru browser SameSite/privacy behavior.

```bash
curl -i https://app.example.com/login
```

Simpan cookie:

```bash
curl -i -c cookies.txt https://app.example.com/login
curl -i -b cookies.txt https://app.example.com/me
```

### 29.3 Integration test dengan MockMvc/Servlet test

Mock test dapat memastikan aplikasi mengirim header benar, tetapi tidak membuktikan browser akan menerima cookie.

### 29.4 End-to-end browser test

Untuk SameSite, SSO, iframe, dan cross-site behavior, perlu test browser nyata.

---

## 30. Production Debugging Playbook

### Case A — Login berhasil, request berikutnya anonymous

Kemungkinan:

- browser tidak menyimpan cookie,
- `Secure` cookie dikirim via HTTP local,
- `SameSite=None` tanpa `Secure`,
- path/domain tidak cocok,
- cookie diblokir third-party policy,
- proxy menghapus `Set-Cookie`,
- session store tidak shared antar node,
- sticky session tidak aktif,
- session expired cepat.

Langkah:

1. cek response login `Set-Cookie`,
2. cek browser cookie jar,
3. cek request berikutnya membawa `Cookie`,
4. cek node/container log apakah session ID ditemukan,
5. cek LB stickiness/session replication.

### Case B — Logout tidak menghapus session

Kemungkinan:

- cookie deletion path/domain salah,
- session invalidated tetapi cookie browser masih ada,
- endpoint setelah logout membuat session baru,
- IdP SSO session masih aktif,
- frontend state belum clear,
- multiple cookies dengan nama sama.

Langkah:

1. cek semua cookie bernama session,
2. cek `Set-Cookie Max-Age=0`,
3. cocokkan path/domain,
4. cek apakah ada `Set-Cookie` baru setelah deletion,
5. cek SSO logout flow.

### Case C — Hanya gagal di iframe

Kemungkinan:

- `SameSite=Lax/Strict`,
- butuh `SameSite=None; Secure`,
- third-party cookie blocked,
- `X-Frame-Options`/CSP `frame-ancestors`,
- CORS/credentials mismatch jika API dipanggil dari iframe app.

### Case D — Cookie works in Chrome but not Safari/Firefox

Kemungkinan:

- browser privacy policy berbeda,
- third-party cookie restrictions,
- legacy SameSite behavior,
- ITP/storage partitioning,
- local dev/non-HTTPS differences.

### Case E — Request rejected before reaching app

Kemungkinan:

- header/cookie too large,
- invalid cookie character,
- proxy header limit,
- container max header size,
- duplicate/legacy cookie accumulation.

---

## 31. Design Checklist untuk Cookie di Servlet App

Gunakan checklist ini sebelum production:

```text
[ ] Semua session/auth cookie HttpOnly?
[ ] Semua session/auth cookie Secure di HTTPS production?
[ ] SameSite dipilih sadar berdasarkan flow, bukan default tidak diketahui?
[ ] Cookie Domain sesempit mungkin?
[ ] Cookie Path sesuai context path external?
[ ] Logout menghapus cookie dengan name/domain/path yang sama?
[ ] Tidak ada endpoint setelah logout yang membuat session baru?
[ ] Cookie value opaque, bukan PII/role/permission besar?
[ ] Cookie size kecil?
[ ] Tidak ada duplicate cookie nama sama dari path/domain lama?
[ ] Reverse proxy meneruskan proto/host/prefix dengan benar?
[ ] Aplikasi tidak memakai request.isSecure() secara naif di balik TLS offload?
[ ] CORS + credentials + SameSite diuji untuk cross-origin flow?
[ ] SSO redirect/iframe/callback diuji di browser nyata?
[ ] Static asset tidak ikut membawa cookie yang tidak perlu?
[ ] Cache-Control untuk authenticated response benar?
[ ] Security headers tidak merusak use case iframe/SSO yang sah?
```

---

## 32. Mental Model: Cookie sebagai Capability Handle

Untuk engineer biasa, cookie adalah storage kecil.

Untuk engineer senior, cookie adalah state mechanism.

Untuk engineer top-tier, cookie adalah **capability handle** yang dikirim otomatis oleh browser berdasarkan URL dan browser policy.

Jika cookie berisi session ID, maka siapa pun yang memiliki cookie tersebut secara efektif memiliki handle ke server-side session selama belum expired/revoked dan selama server menerimanya. Karena itu:

- cookie harus kecil,
- cookie harus scoped sempit,
- cookie harus `Secure`,
- cookie harus `HttpOnly` jika auth-related,
- cookie harus punya `SameSite` sadar desain,
- cookie harus bisa dihapus dengan benar,
- cookie harus tidak muncul di log,
- cookie harus tidak menyimpan data sensitif mentah,
- cookie harus tidak menjadi satu-satunya authorization source.

---

## 33. Relationship dengan Part Sebelumnya dan Berikutnya

Part 012 membahas `HttpSession`: server-side state.

Part 013 ini membahas cookie/header: browser boundary yang membuat session continuity bekerja atau gagal.

Part berikutnya, Part 014, akan masuk ke **Async Servlet**. Di sana boundary berubah: request tidak selalu selesai di thread yang sama, response bisa ditulis nanti, timeout/race menjadi lebih penting, dan context propagation menjadi persoalan nyata.

Pemahaman cookie/header tetap relevan di async karena response commit, redirect, error, dan `Set-Cookie` tetap harus terjadi sebelum response committed.

---

## 34. Ringkasan Inti

1. Servlet tidak menyimpan cookie di browser; Servlet mengirim `Set-Cookie`, browser yang memutuskan.
2. Cookie identity ditentukan oleh kombinasi name, domain, dan path.
3. Cookie deletion harus memakai name/domain/path yang sama dengan cookie asli.
4. `Secure` wajib untuk session/auth cookie di HTTPS production, tetapi harus dipahami dalam setup TLS offload.
5. `HttpOnly` melindungi dari pembacaan JavaScript, tetapi tidak menghapus risiko XSS sepenuhnya.
6. `SameSite` adalah browser-level cross-site policy; pilih berdasarkan flow aplikasi, bukan asal ikut default.
7. SSO, iframe, CORS, dan cross-origin API adalah area paling rawan cookie bug.
8. Reverse proxy dapat mengubah scheme/host/path sehingga cookie dan redirect menjadi salah.
9. Cookie bloat menyebabkan request ditolak sebelum sampai ke aplikasi.
10. Cookie harus dianggap capability handle, bukan storage bebas.

---

## 35. Referensi

- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/
- Jakarta Servlet `Cookie` API: https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/cookie
- Jakarta/Tomcat `SessionCookieConfig` API: https://tomcat.apache.org/tomcat-11.0-doc/servletapi/jakarta/servlet/SessionCookieConfig.html
- RFC 6265 — HTTP State Management Mechanism: https://www.rfc-editor.org/info/rfc6265/
- HTTPWG RFC6265bis draft: https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html
- MDN `Set-Cookie`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- MDN HTTP Cookies Guide: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-012](./learn-java-servlet-websocket-web-container-runtime-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-014](./learn-java-servlet-websocket-web-container-runtime-part-014.md)
