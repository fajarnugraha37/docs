# learn-java-servlet-websocket-web-container-runtime-part-012

# Part 012 — Session Management: `HttpSession` Deep Dive

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Rentang: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`  
> Fokus: Servlet session lifecycle, identity continuity, state boundary, distributed deployment, concurrency, logout, invalidation, fixation, and production failure modelling.

---

## 0. Tujuan Part Ini

Setelah bagian sebelumnya, kita sudah memahami:

1. `HttpServletRequest` sebagai representasi request masuk.
2. `HttpServletResponse` sebagai state machine untuk response keluar.
3. Servlet mapping dan dispatch resolution.
4. Filter sebagai boundary cross-cutting.
5. Listener sebagai observer lifecycle.
6. `ServletContext` sebagai application boundary.

Sekarang kita masuk ke salah satu area yang sering terlihat sederhana tetapi sangat berbahaya di production: **session management**.

Banyak engineer menganggap session hanya sebagai tempat menyimpan object user:

```java
request.getSession().setAttribute("user", user);
```

Padahal, di sistem nyata, session adalah gabungan dari:

- browser cookie behavior,
- server-side state,
- container lifecycle,
- timeout policy,
- authentication boundary,
- load balancing,
- cluster replication,
- serialization,
- memory pressure,
- logout semantics,
- concurrency,
- dan failure handling.

Mental model utamanya:

> `HttpSession` bukan sekadar map. `HttpSession` adalah kontrak continuity antara beberapa HTTP request yang secara alami stateless.

HTTP sendiri tidak mengingat request sebelumnya. Session adalah cara container memberi ilusi bahwa beberapa request berasal dari satu conversation yang sama.

---

## 1. Stateless HTTP dan Kenapa Session Ada

HTTP request secara fundamental berdiri sendiri.

Request pertama:

```http
GET /login HTTP/1.1
Host: example.com
```

Request kedua:

```http
GET /dashboard HTTP/1.1
Host: example.com
```

Secara native, server tidak otomatis tahu bahwa dua request ini berasal dari browser/user yang sama.

Session dibuat untuk menjawab pertanyaan:

> Bagaimana server mengasosiasikan beberapa request berbeda sebagai satu logical conversation?

Servlet container menyediakan `HttpSession` untuk menyimpan state per conversation tersebut.

Contoh:

```java
HttpSession session = request.getSession();
session.setAttribute("userId", userId);
```

Kemudian request berikutnya membawa identifier session, biasanya lewat cookie:

```http
Cookie: JSESSIONID=5D3E9F2A0B9C...
```

Container membaca session id itu, mencari session server-side, lalu request bisa mengakses state yang sama:

```java
HttpSession session = request.getSession(false);
String userId = (String) session.getAttribute("userId");
```

### 1.1 Session bukan authentication

Session dan authentication sering berdampingan, tapi tidak sama.

| Konsep | Makna |
|---|---|
| Session | Continuity mechanism antar request |
| Authentication | Pembuktian identitas user |
| Authorization | Keputusan apakah user boleh melakukan aksi |
| Session cookie | Carrier session id di browser |
| Principal | Representasi identity yang sudah diautentikasi |

Session bisa ada tanpa login. Misalnya:

- shopping cart anonymous,
- CSRF token,
- onboarding wizard,
- language preference,
- temporary workflow state.

Sebaliknya, authentication modern juga bisa stateless tanpa server session, misalnya pure bearer token. Namun pada banyak aplikasi Servlet/Jakarta EE/Spring MVC, authentication state tetap disimpan atau dikaitkan dengan session.

---

## 2. `HttpSession` sebagai Server-Side State Handle

`HttpSession` adalah interface Servlet HTTP untuk menyimpan data terkait satu client conversation.

Conceptually:

```text
Browser
  │
  │ Cookie: JSESSIONID=abc123
  ▼
Servlet Container
  │
  ├── session id lookup: abc123
  │
  ▼
HttpSession object / backing session record
  │
  ├── attributes["userId"]
  ├── attributes["csrfToken"]
  └── metadata: creationTime, lastAccessedTime, maxInactiveInterval
```

Important distinction:

```text
HttpSession object yang Anda pegang di kode
    ≠
selalu object fisik yang sama selamanya
```

Dalam container single-node, mungkin object Java yang sama masih ada di heap.

Dalam deployment cluster, session bisa:

- direplikasi,
- diserialisasi,
- dipersist,
- direkonstruksi,
- dipindahkan,
- atau hanya valid pada node tertentu.

Jadi sebaiknya pikirkan `HttpSession` sebagai **handle ke server-side conversation state**, bukan sekadar `HashMap` biasa.

---

## 3. Cara Mendapatkan Session

Ada dua method utama dari `HttpServletRequest`:

```java
HttpSession getSession();
HttpSession getSession(boolean create);
```

### 3.1 `request.getSession()`

```java
HttpSession session = request.getSession();
```

Artinya:

- kalau session sudah ada, return existing session;
- kalau belum ada, create session baru.

Ini berbahaya bila dipakai sembarangan di filter/controller yang seharusnya tidak membutuhkan session.

Contoh buruk:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {

    HttpServletRequest request = (HttpServletRequest) req;

    // Buruk: membuat session untuk semua request, termasuk static asset dan health check.
    HttpSession session = request.getSession();

    chain.doFilter(req, res);
}
```

Efek buruk:

- static asset bisa membuat session,
- health check bisa membuat session,
- crawler bisa membuat session,
- memory naik,
- cookie `JSESSIONID` tersebar ke client yang tidak perlu,
- cacheability response bisa terganggu.

### 3.2 `request.getSession(false)`

```java
HttpSession session = request.getSession(false);
if (session == null) {
    response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
    return;
}
```

Artinya:

- kalau session ada, return session;
- kalau tidak ada, return `null`;
- tidak membuat session baru.

Untuk code yang hanya ingin mengecek apakah session sudah ada, gunakan `getSession(false)`.

Rule praktis:

| Kebutuhan | Gunakan |
|---|---|
| Membuat conversation baru | `getSession(true)` atau `getSession()` |
| Mengecek session yang sudah ada | `getSession(false)` |
| Endpoint stateless | Jangan panggil `getSession()` |
| Filter logging/correlation | Hindari membuat session |
| Health check/static resource | Jangan membuat session |

---

## 4. Session ID dan `JSESSIONID`

Session id adalah identifier yang menghubungkan client dengan server-side session.

Default cookie yang umum digunakan oleh Servlet container adalah:

```text
JSESSIONID
```

Contoh response setelah session dibuat:

```http
HTTP/1.1 200 OK
Set-Cookie: JSESSIONID=ABCDEF1234567890; Path=/myapp; HttpOnly
```

Request berikutnya:

```http
GET /myapp/dashboard HTTP/1.1
Host: example.com
Cookie: JSESSIONID=ABCDEF1234567890
```

Container kemudian melakukan lookup:

```text
JSESSIONID=ABCDEF1234567890
       │
       ▼
session store lookup
       │
       ▼
HttpSession
```

### 4.1 Session ID bukan credential biasa, tapi harus diperlakukan seperti credential

Siapa pun yang memegang valid session id pada umumnya bisa bertindak sebagai session tersebut, tergantung security configuration.

Maka session id harus dilindungi:

- gunakan HTTPS,
- gunakan `Secure` cookie saat HTTPS,
- gunakan `HttpOnly`,
- gunakan `SameSite` sesuai kebutuhan,
- rotate session id setelah login,
- invalidate session saat logout,
- jangan log session id,
- jangan taruh session id di URL kecuali benar-benar legacy/terpaksa.

---

## 5. Session Tracking Modes

Servlet container bisa melacak session dengan beberapa mode.

Umumnya:

1. Cookie.
2. URL rewriting.
3. SSL session tracking dalam konteks tertentu/legacy.

### 5.1 Cookie-based session tracking

Ini mode normal di aplikasi modern.

```http
Set-Cookie: JSESSIONID=abc123; Path=/; HttpOnly; Secure; SameSite=Lax
```

Kelebihan:

- clean URL,
- browser mengirim otomatis,
- cocok untuk web app umum.

Risiko:

- tergantung browser cookie policy,
- rentan kalau cookie attribute salah,
- cross-site behavior harus dipahami.

### 5.2 URL rewriting

Jika cookie tidak tersedia, container bisa menyisipkan session id ke URL.

Contoh:

```text
/dashboard;jsessionid=abc123
```

Atau link hasil encoding:

```java
String url = response.encodeURL(request.getContextPath() + "/dashboard");
```

Masalah besar URL rewriting:

- session id bisa bocor ke log,
- session id bisa bocor via referer,
- URL bisa dishare user,
- bookmark bisa membawa session id lama,
- search engine/crawler bisa menangkap URL.

Untuk aplikasi modern, URL rewriting sering dinonaktifkan atau dihindari.

### 5.3 `encodeURL` dan `encodeRedirectURL`

Servlet API menyediakan:

```java
response.encodeURL(url);
response.encodeRedirectURL(url);
```

Fungsinya memberi kesempatan container menambahkan session id bila cookie tidak digunakan.

Namun di aplikasi modern yang hanya mengandalkan cookie, penggunaannya biasanya tidak terlihat karena framework mengelola URL generation.

---

## 6. Session Metadata

`HttpSession` menyediakan beberapa metadata penting.

```java
long creationTime = session.getCreationTime();
long lastAccessedTime = session.getLastAccessedTime();
int maxInactiveInterval = session.getMaxInactiveInterval();
String id = session.getId();
boolean isNew = session.isNew();
```

### 6.1 `creationTime`

Waktu session dibuat.

Berguna untuk:

- audit,
- session age limit,
- debugging session lifecycle,
- policy seperti absolute timeout.

### 6.2 `lastAccessedTime`

Waktu terakhir session diakses oleh request dari client.

Important nuance:

> `lastAccessedTime` umumnya diupdate saat request yang membawa session id diproses, bukan setiap kali attribute dibaca/ditulis di object session.

### 6.3 `maxInactiveInterval`

Timeout inactivity dalam detik.

```java
session.setMaxInactiveInterval(30 * 60); // 30 menit
```

Jika tidak ada request yang mengakses session melewati interval ini, session bisa expired.

### 6.4 `isNew()`

`isNew()` true bila session baru dibuat dan client belum mengakui session id itu.

Contoh kasus:

- response baru mengirim `Set-Cookie`,
- browser belum mengirim balik cookie,
- cookie disabled,
- client tidak menyimpan cookie.

Jangan memakai `isNew()` sebagai authorization signal. Ini hanya metadata tracking.

---

## 7. Session Attributes

Session menyimpan attributes:

```java
session.setAttribute("userId", "u-123");
session.setAttribute("roleIds", List.of("admin", "reviewer"));
```

Retrieve:

```java
String userId = (String) session.getAttribute("userId");
```

Remove:

```java
session.removeAttribute("userId");
```

### 7.1 Attribute naming

Gunakan nama key yang jelas dan namespaced.

Buruk:

```java
session.setAttribute("user", user);
session.setAttribute("data", data);
session.setAttribute("flag", true);
```

Lebih baik:

```java
session.setAttribute("auth.userId", userId);
session.setAttribute("auth.loginTime", Instant.now());
session.setAttribute("csrf.token", token);
session.setAttribute("wizard.caseCreation.draftId", draftId);
```

### 7.2 Jangan simpan object terlalu besar

Buruk:

```java
session.setAttribute("searchResult", listOf10000Rows);
session.setAttribute("uploadedFileBytes", hugeByteArray);
session.setAttribute("fullUserProfileGraph", profileGraph);
```

Dampak:

- heap pressure,
- GC pressure,
- session replication mahal,
- serialization lambat,
- failover berat,
- latency spike.

Lebih baik:

```java
session.setAttribute("search.queryId", queryId);
session.setAttribute("upload.tempFileId", tempFileId);
session.setAttribute("auth.userId", userId);
```

Simpan data besar di:

- database,
- object storage,
- temporary file storage,
- distributed cache dengan TTL,
- atau dedicated workflow state store.

Session menyimpan reference/logical id, bukan payload besar.

---

## 8. Session Scope vs Request/Application Scope

| Scope | Lifetime | Cocok untuk | Bahaya |
|---|---:|---|---|
| Request attribute | Satu request/dispatch | hasil parsing, DTO sementara, error info | hilang setelah request selesai |
| Session attribute | Banyak request user yang sama | login marker, CSRF token, wizard state ringan | memory bloat, stale state, concurrency |
| ServletContext attribute | Sepanjang aplikasi hidup | registry global, shared metadata | global mutable state, leak |
| Database/cache | Sesuai TTL/data lifecycle | durable business state | latency, consistency |

Decision rule:

```text
Apakah data ini masih diperlukan setelah response dikirim?
  Tidak → request attribute/local variable.
  Ya → apakah data ini per user conversation dan kecil?
       Ya → session attribute bisa dipertimbangkan.
       Tidak → simpan di DB/cache/storage dengan key di session.
```

---

## 9. Session Lifecycle State Machine

Secara konseptual, session memiliki lifecycle:

```text
          ┌──────────────┐
          │ No Session   │
          └──────┬───────┘
                 │ getSession(true)
                 ▼
          ┌──────────────┐
          │ Created      │
          └──────┬───────┘
                 │ client returns session id
                 ▼
          ┌──────────────┐
          │ Active       │◄──────────────┐
          └──────┬───────┘               │
                 │ request access         │
                 │ updates lastAccessed   │
                 └────────────────────────┘

Active can end via:

  invalidate()       timeout         container shutdown/redeploy
       │                │                    │
       ▼                ▼                    ▼
 ┌───────────┐    ┌───────────┐       ┌──────────────┐
 │Invalidated│    │ Expired   │       │ Passivated / │
 └───────────┘    └───────────┘       │ Destroyed    │
                                      └──────────────┘
```

From application perspective, after invalidation/expiration, accessing old session object can throw `IllegalStateException`.

---

## 10. Session Creation: Avoid Accidental Sessions

Accidental session creation adalah masalah klasik.

Contoh filter yang tampak harmless:

```java
public class UserPreferenceFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpSession session = request.getSession();

        Object theme = session.getAttribute("theme");
        request.setAttribute("theme", theme == null ? "light" : theme);

        chain.doFilter(req, res);
    }
}
```

Masalah:

- semua request membuat session,
- asset seperti `/css/app.css` bisa punya session,
- unauthenticated visitor punya server-side state.

Lebih baik:

```java
HttpSession session = request.getSession(false);
Object theme = session == null ? null : session.getAttribute("theme");
request.setAttribute("theme", theme == null ? "light" : theme);
```

Atau untuk preference yang tidak sensitif, gunakan cookie/client storage.

---

## 11. Session Timeout

Session timeout biasanya inactivity-based.

Konfigurasi di `web.xml` legacy/Jakarta:

```xml
<session-config>
    <session-timeout>30</session-timeout>
</session-config>
```

Satuan `session-timeout` di `web.xml` adalah menit.

Programmatic:

```java
session.setMaxInactiveInterval(30 * 60); // detik
```

### 11.1 Inactivity timeout vs absolute timeout

Inactivity timeout:

```text
Expire jika tidak ada request selama 30 menit.
```

Absolute timeout:

```text
Expire meskipun aktif, misalnya setelah 8 jam dari login.
```

Servlet `HttpSession` memberi inactivity timeout, tapi absolute timeout biasanya perlu logic aplikasi.

Contoh:

```java
Instant loginTime = (Instant) session.getAttribute("auth.loginTime");
if (loginTime != null && loginTime.plus(Duration.ofHours(8)).isBefore(Instant.now())) {
    session.invalidate();
    response.sendRedirect(request.getContextPath() + "/login?reason=expired");
    return;
}
```

### 11.2 Session timeout tidak sama dengan token timeout

Pada aplikasi modern, Anda bisa punya:

- Servlet session timeout,
- access token expiry,
- refresh token expiry,
- IdP session timeout,
- frontend idle timeout,
- reverse proxy timeout.

Semua harus disejajarkan.

Jika tidak:

```text
Frontend merasa user masih login
  tetapi server session expired
    → AJAX 401 tiba-tiba.

Server session masih hidup
  tetapi IdP session expired
    → silent refresh gagal.

Access token hidup
  tetapi Servlet session invalidated
    → inconsistent auth state.
```

---

## 12. Session Invalidation

Logout biasanya memanggil:

```java
HttpSession session = request.getSession(false);
if (session != null) {
    session.invalidate();
}
```

Setelah `invalidate()`, session tidak boleh dipakai lagi.

Buruk:

```java
HttpSession session = request.getSession(false);
if (session != null) {
    session.invalidate();
    session.setAttribute("logoutTime", Instant.now()); // salah
}
```

Benar:

```java
HttpSession session = request.getSession(false);
if (session != null) {
    session.invalidate();
}

response.sendRedirect(request.getContextPath() + "/login?logout=1");
```

### 12.1 Invalidation tidak otomatis menghapus semua cookie custom

`session.invalidate()` menghancurkan server-side session.

Tapi cookie lain seperti:

- remember-me cookie,
- custom auth cookie,
- UI preference cookie,
- CSRF cookie,
- IdP-related cookie,

harus dihapus sesuai path/domain masing-masing.

Contoh hapus cookie:

```java
Cookie cookie = new Cookie("MY_COOKIE", "");
cookie.setMaxAge(0);
cookie.setPath(request.getContextPath().isEmpty() ? "/" : request.getContextPath());
cookie.setHttpOnly(true);
cookie.setSecure(request.isSecure());
response.addCookie(cookie);
```

Cookie deletion hanya berhasil jika `name`, `path`, dan `domain` match cookie asli.

---

## 13. Session Fixation

Session fixation terjadi ketika attacker membuat/menentukan session id sebelum user login, lalu user login pada session yang sama, sehingga attacker dapat memakai session id itu.

Simplified attack:

```text
1. Attacker memperoleh session id S.
2. Attacker membuat korban memakai session id S.
3. Korban login.
4. Server menandai session S sebagai authenticated.
5. Attacker memakai S untuk akses sebagai korban.
```

Mitigasi utama:

> Rotate/change session id setelah authentication sukses.

Servlet API menyediakan:

```java
request.changeSessionId();
```

Contoh login flow:

```java
HttpSession session = request.getSession(true);

// Setelah credential valid
request.changeSessionId();

session.setAttribute("auth.userId", userId);
session.setAttribute("auth.loginTime", Instant.now());
```

Atau pattern invalidate lalu create baru:

```java
HttpSession old = request.getSession(false);
if (old != null) {
    old.invalidate();
}

HttpSession session = request.getSession(true);
session.setAttribute("auth.userId", userId);
```

Namun `changeSessionId()` lebih mempertahankan attributes yang masih diperlukan dan memang didesain untuk rotate ID.

### 13.1 Jangan rotate session id setiap request

Rotate setelah event security penting:

- login,
- privilege elevation,
- account switch,
- MFA completion,
- sensitive role activation.

Tidak perlu rotate setiap request karena bisa menyebabkan race condition antar parallel request.

---

## 14. Session Cookie Configuration

Servlet menyediakan `SessionCookieConfig` melalui `ServletContext`.

Programmatic setup biasanya dilakukan saat startup, sebelum context digunakan.

Contoh:

```java
public class AppInitializer implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        ServletContext context = sce.getServletContext();
        SessionCookieConfig config = context.getSessionCookieConfig();

        config.setName("JSESSIONID");
        config.setHttpOnly(true);
        config.setSecure(true);
        config.setPath(context.getContextPath().isEmpty() ? "/" : context.getContextPath());
    }
}
```

Important:

- `Secure=true` berarti cookie hanya dikirim via HTTPS.
- Kalau TLS terminated di reverse proxy, container harus tahu original request secure melalui forwarded header/proxy config.
- `HttpOnly=true` mencegah JavaScript membaca cookie, tapi tidak mencegah browser mengirim cookie otomatis.
- `SameSite` support sering container-specific atau via custom header/cookie processor, tergantung versi/container.

### 14.1 Cookie path

Cookie path menentukan URL path mana yang akan menerima cookie.

Jika aplikasi di `/aceas`:

```http
Set-Cookie: JSESSIONID=abc; Path=/aceas
```

Browser akan mengirim cookie ke:

```text
/aceas/dashboard
/aceas/api/cases
```

Tapi tidak ke:

```text
/cpds/dashboard
```

Jika path diset `/`, cookie dikirim ke semua app di domain yang sama.

Ini bisa menyebabkan collision jika beberapa aplikasi memakai cookie name sama di domain sama.

Mitigasi:

- gunakan path spesifik context,
- atau gunakan session cookie name berbeda per app,
- desain domain/subdomain dengan jelas.

---

## 15. Session and Authentication Boundary

Pattern sederhana:

```java
public final class AuthSession {
    public static final String USER_ID = "auth.userId";
    public static final String LOGIN_TIME = "auth.loginTime";
    public static final String ROLES = "auth.roles";
}
```

Login:

```java
private void login(HttpServletRequest request, String userId, Set<String> roles) {
    HttpSession session = request.getSession(true);
    request.changeSessionId();

    session.setAttribute(AuthSession.USER_ID, userId);
    session.setAttribute(AuthSession.LOGIN_TIME, Instant.now());
    session.setAttribute(AuthSession.ROLES, Set.copyOf(roles));
}
```

Check:

```java
private Optional<String> currentUserId(HttpServletRequest request) {
    HttpSession session = request.getSession(false);
    if (session == null) {
        return Optional.empty();
    }
    return Optional.ofNullable((String) session.getAttribute(AuthSession.USER_ID));
}
```

Logout:

```java
private void logout(HttpServletRequest request) {
    HttpSession session = request.getSession(false);
    if (session != null) {
        session.invalidate();
    }
}
```

### 15.1 Jangan simpan password/token sensitif mentah dalam session

Buruk:

```java
session.setAttribute("password", password);
session.setAttribute("accessToken", token);
session.setAttribute("refreshToken", refreshToken);
```

Lebih aman:

- simpan minimal identity marker,
- simpan token di server-side secure token store jika perlu,
- gunakan encryption/secret management sesuai kebutuhan,
- kurangi lifetime,
- audit access,
- jangan log.

Session compromise harus diasumsikan mungkin. Minimalkan blast radius.

---

## 16. Session Concurrency: Parallel Requests dari User yang Sama

Satu user/browser bisa mengirim banyak request paralel:

```text
GET /dashboard
GET /api/notifications
POST /api/save-draft
GET /api/menu
GET /api/profile
```

Semua membawa `JSESSIONID` yang sama.

Artinya beberapa thread server bisa mengakses session yang sama bersamaan.

### 16.1 Session attribute map tidak membuat object Anda thread-safe

Misalnya:

```java
List<String> steps = (List<String>) session.getAttribute("wizard.steps");
steps.add("APPROVAL");
```

Jika dua request paralel memodifikasi list yang sama:

- lost update,
- `ConcurrentModificationException`,
- corrupted state,
- inconsistent wizard flow.

Lebih baik:

```java
synchronized (session) {
    @SuppressWarnings("unchecked")
    List<String> existing = (List<String>) session.getAttribute("wizard.steps");
    List<String> next = new ArrayList<>(existing == null ? List.of() : existing);
    next.add("APPROVAL");
    session.setAttribute("wizard.steps", List.copyOf(next));
}
```

Namun hati-hati: synchronized session bisa menurunkan throughput dan tidak selalu cukup pada distributed session.

Untuk workflow penting, lebih baik gunakan DB dengan optimistic locking.

### 16.2 Immutable attribute pattern

Simpan immutable object.

```java
public record UserSessionView(
        String userId,
        Set<String> roles,
        Instant loginTime
) implements Serializable {}
```

Set:

```java
session.setAttribute("auth.view", new UserSessionView(userId, Set.copyOf(roles), Instant.now()));
```

Update dengan replace object, bukan mutate object existing.

---

## 17. Distributed Session

Saat aplikasi berjalan di lebih dari satu node:

```text
Browser
  │ JSESSIONID=abc
  ▼
Load Balancer
  ├── Node A
  ├── Node B
  └── Node C
```

Pertanyaan penting:

> Request berikutnya dengan session id yang sama akan masuk ke node yang sama atau node berbeda?

Ada beberapa strategi.

---

## 18. Sticky Session

Sticky session berarti load balancer mencoba mengirim request dari session yang sama ke node yang sama.

```text
JSESSIONID=abc → Node A
JSESSIONID=abc → Node A
JSESSIONID=abc → Node A
```

Kelebihan:

- sederhana,
- tidak perlu replication berat,
- latency rendah,
- session object tetap lokal.

Kekurangan:

- jika Node A mati, session hilang,
- imbalance jika banyak heavy user menempel pada node tertentu,
- rolling deployment perlu draining benar,
- WebSocket juga butuh koneksi tetap.

Cocok untuk:

- aplikasi internal,
- session kecil,
- toleransi relogin acceptable,
- deployment dengan graceful drain.

---

## 19. Session Replication

Session replication berarti session state dikirim ke node lain.

```text
Node A session update
  │
  ├── replicate to Node B
  └── replicate to Node C
```

Kelebihan:

- failover lebih baik,
- request bisa pindah node.

Kekurangan:

- serialization cost,
- network traffic,
- consistency lag,
- conflict update,
- session object harus serializable,
- object besar sangat mahal,
- debugging lebih kompleks.

### 19.1 All-to-all vs primary-secondary

All-to-all:

```text
A replicates to B and C and D
B replicates to A and C and D
...
```

Cocok untuk cluster kecil.

Primary-secondary:

```text
Session primary on A
Backup on B
```

Lebih scalable, tapi failover semantics lebih kompleks.

---

## 20. External Session Store

Session bisa disimpan di external store seperti:

- Redis,
- database,
- distributed cache,
- product-specific session store.

Flow:

```text
Request with JSESSIONID
  │
  ▼
Node any
  │
  ▼
External session store lookup
  │
  ▼
Session state
```

Kelebihan:

- node stateless-ish,
- failover lebih baik,
- scaling app node lebih mudah.

Kekurangan:

- latency per session access,
- store menjadi critical dependency,
- serialization still matters,
- consistency/TTL harus benar,
- outage store bisa logout massal.

Decision:

| Model | Use when |
|---|---|
| Local session + sticky | sederhana, internal app, relogin acceptable |
| Replicated session | small cluster, failover perlu, session kecil |
| External store | scale-out, cloud-native, rolling deploy sering |
| Stateless token | API-centric, minimal server-side state |
| Hybrid | web login session + token/cache for specific needs |

---

## 21. Serializable Session Attributes

Untuk distributed session, passivation, atau persistence, session attributes biasanya perlu serializable.

Baik:

```java
public record AuthView(
        String userId,
        Set<String> roles,
        Instant loginTime
) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}
```

Buruk:

```java
session.setAttribute("connection", jdbcConnection);
session.setAttribute("entityManager", entityManager);
session.setAttribute("service", userService);
session.setAttribute("thread", Thread.currentThread());
```

Jangan simpan:

- JDBC connection,
- EntityManager,
- transaction object,
- service bean,
- request/response object,
- stream,
- thread,
- socket,
- lambda capturing non-serializable context,
- huge object graph.

### 21.1 Serialization compatibility

Saat rolling deployment, versi class bisa berbeda antar node.

Risiko:

```text
Node A writes session attribute class v1
Node B after deployment reads class v2
→ InvalidClassException / deserialization failure
```

Mitigasi:

- session attributes sederhana,
- explicit serialVersionUID,
- backward-compatible changes,
- clear sessions on incompatible deploy jika acceptable,
- drain old nodes before new version handles old session,
- avoid storing rich domain object graph.

---

## 22. Session Bloat

Session bloat terjadi ketika session menyimpan terlalu banyak data.

Symptoms:

- heap usage naik seiring user aktif,
- full GC lebih sering,
- rolling deploy lambat,
- replication lag,
- Redis memory tinggi,
- response latency spike setelah session update,
- OOM saat traffic naik.

### 22.1 Estimasi kasar

Misalnya:

```text
10 KB per session × 10,000 active sessions = 100 MB logical payload
```

Tapi actual heap bisa jauh lebih besar karena:

- object overhead,
- map overhead,
- duplicate strings,
- collection overhead,
- serialization buffer,
- replication queue,
- cache metadata.

Jika 200 KB per session:

```text
200 KB × 10,000 = 2 GB payload sebelum overhead
```

Ini sudah berbahaya untuk banyak deployment.

### 22.2 Session budget

Tetapkan budget:

```text
Session attribute policy:
- auth marker: < 2 KB
- CSRF/security metadata: < 2 KB
- UI wizard key/reference: < 1 KB
- no large collection
- no binary payload
- no full entity graph
- no service/infrastructure object
```

Session harus dianggap resource mahal.

---

## 23. AJAX, SPA, dan Session Expiry

Pada aplikasi modern, request sering datang dari JavaScript.

Ketika session expired, server mungkin mengembalikan:

- 401 JSON,
- 403 JSON,
- 302 redirect ke login,
- HTML login page.

Masalah umum:

```text
AJAX request expects JSON
server returns 302 then HTML login page
frontend tries JSON.parse(html)
→ confusing error
```

Pattern yang lebih baik:

```java
if (isAjax(request) && sessionExpired) {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    response.setContentType("application/json");
    response.getWriter().write("{\"error\":\"SESSION_EXPIRED\"}");
    return;
}
```

Untuk browser navigation biasa, redirect masih masuk akal.

### 23.1 AJAX after logout

Scenario:

```text
Tab A: user clicks logout → session invalidated
Tab B: background polling still running → request with old JSESSIONID
```

Expected handling:

- return 401/SESSION_EXPIRED,
- frontend stops polling,
- redirect user to login or show logged-out state.

Jangan create session baru secara tidak sengaja pada polling endpoint setelah logout.

Gunakan `getSession(false)`.

---

## 24. Multiple Tabs and Same Session

Browser tab biasanya berbagi cookie untuk domain/path yang sama.

Artinya:

```text
Tab A and Tab B share same JSESSIONID
```

Dampaknya:

- logout di satu tab logout semua tab,
- wizard state di session bisa bentrok antar tab,
- account switch di satu tab mengubah identity semua tab,
- CSRF token rotation bisa mempengaruhi form di tab lama.

### 24.1 Wizard state per tab

Buruk:

```java
session.setAttribute("caseDraft", draft);
```

Jika user membuka dua case creation tab, state bisa overwrite.

Lebih baik:

```text
session stores current lightweight registry:
  wizard.caseCreation.activeDraftIds = [draft-1, draft-2]

actual draft stored in DB/cache by draftId
URL contains draftId:
  /cases/new?draftId=draft-1
```

Atau gunakan server-generated flow id:

```text
/cases/new/{flowId}/step/2
```

Session tidak boleh menjadi satu global scratchpad untuk semua tab.

---

## 25. Session and CSRF

CSRF token sering disimpan di session.

Pattern:

```java
String token = secureRandomToken();
session.setAttribute("csrf.token", token);
```

Form:

```html
<input type="hidden" name="_csrf" value="...">
```

Validasi:

```java
String expected = (String) session.getAttribute("csrf.token");
String actual = request.getParameter("_csrf");

if (!Objects.equals(expected, actual)) {
    response.sendError(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

Topik CSRF security detail tidak diulang di sini, tapi session implication-nya penting:

- token per session lebih sederhana,
- token per request lebih aman tapi lebih kompleks,
- multi-tab bisa bermasalah jika token sering di-rotate,
- AJAX perlu header token,
- session expiry harus menghasilkan response jelas.

---

## 26. Session Listener

`HttpSessionListener` dapat mengamati session created/destroyed.

```java
@WebListener
public class SessionMetricsListener implements HttpSessionListener {

    private final AtomicInteger activeSessions = new AtomicInteger();

    @Override
    public void sessionCreated(HttpSessionEvent se) {
        activeSessions.incrementAndGet();
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        activeSessions.decrementAndGet();
    }
}
```

Use cases:

- active session metrics,
- cleanup lightweight resources,
- audit event,
- debugging lifecycle.

Jangan gunakan listener untuk:

- business process berat,
- remote call lambat,
- transaction kompleks,
- blocking cleanup lama,
- logic yang harus exactly-once.

Session destruction bisa terjadi karena:

- explicit invalidate,
- timeout,
- undeploy,
- container shutdown,
- replication/passivation behavior.

Jangan asumsikan listener selalu berjalan pada waktu yang ideal.

---

## 27. HttpSessionBindingListener dan Activation Listener

Object yang disimpan dalam session bisa menerima callback jika mengimplementasikan listener tertentu.

### 27.1 Binding listener

```java
public class Cart implements HttpSessionBindingListener, Serializable {
    @Override
    public void valueBound(HttpSessionBindingEvent event) {
        // called when added to session
    }

    @Override
    public void valueUnbound(HttpSessionBindingEvent event) {
        // called when removed from session or session invalidated
    }
}
```

Use sparingly.

Risiko:

- hidden side effects,
- sulit diuji,
- unexpected callback during session invalidation,
- serialization/passivation complexity.

### 27.2 Activation listener

Activation/passivation relevan ketika container memindahkan session antara memory dan secondary store atau antar JVM.

Object bisa diberi tahu saat session passivated/activated.

Namun pada aplikasi modern, lebih baik session attributes sederhana dan tidak membutuhkan lifecycle hook rumit.

---

## 28. Logout Semantics

Logout bukan hanya `session.invalidate()`.

Logout design harus menjawab:

1. Apakah server-side session dihancurkan?
2. Apakah session cookie dihapus?
3. Apakah remember-me cookie dihapus?
4. Apakah IdP/global session logout diperlukan?
5. Apakah frontend state dibersihkan?
6. Apakah WebSocket connection ditutup?
7. Apakah background polling dihentikan?
8. Apakah CSRF token invalid?
9. Apakah audit event dicatat?
10. Apakah redirect target aman?

Basic logout flow:

```text
POST /logout
  │
  ├── validate CSRF if browser form/session auth
  ├── find session with getSession(false)
  ├── capture userId for audit before invalidation
  ├── invalidate session
  ├── clear relevant cookies
  ├── close/revoke app-specific server-side resources
  ├── optionally initiate IdP logout
  └── return redirect/204/JSON depending client type
```

### 28.1 Capture data before invalidation

```java
HttpSession session = request.getSession(false);
String userId = null;

if (session != null) {
    userId = (String) session.getAttribute("auth.userId");
    session.invalidate();
}

auditLogout(userId);
```

After invalidation, jangan baca attribute lagi.

---

## 29. Session with WebSocket

WebSocket memiliki `jakarta.websocket.Session`, berbeda dari `HttpSession`.

HTTP handshake bisa membawa cookie `JSESSIONID`, sehingga saat upgrade, endpoint bisa mengetahui user/session dari HTTP context tergantung konfigurasi.

Namun setelah WebSocket connection established:

```text
HTTP request lifecycle selesai
WebSocket session hidup sebagai koneksi long-lived
```

Implication:

- invalidating `HttpSession` tidak selalu otomatis menutup WebSocket,
- WebSocket perlu auth state sendiri atau registry,
- logout harus menutup connection milik user,
- cluster perlu node-local connection registry.

Pattern:

```text
On WebSocket open:
  - authenticate handshake
  - map userId -> websocket session id

On logout:
  - invalidate HttpSession
  - find active WebSocket sessions for user
  - close them with policy close code/reason
```

Detail WebSocket akan dibahas di part khusus, tapi session boundary-nya harus sudah dipahami dari sekarang.

---

## 30. Session with Reverse Proxy and Load Balancer

Session behavior sering rusak bukan karena Java code, tapi karena proxy/LB.

### 30.1 HTTPS termination

Client:

```text
https://example.com/app
```

LB to app:

```text
http://app:8080/app
```

Jika container tidak tahu original scheme HTTPS, aplikasi bisa:

- tidak set `Secure` cookie,
- generate redirect ke HTTP,
- salah menentukan absolute URL,
- salah SameSite/Secure behavior.

Solusi:

- konfigurasi forwarded headers di container/framework,
- pastikan proxy mengirim `X-Forwarded-Proto` atau `Forwarded`,
- jangan blindly trust forwarded headers dari internet tanpa trusted proxy boundary.

### 30.2 Sticky session cookie dari LB

LB bisa menambahkan cookie sendiri:

```http
Set-Cookie: AWSALB=...
Set-Cookie: JSESSIONID=...
```

Jangan campuradukkan:

| Cookie | Pemilik | Fungsi |
|---|---|---|
| `JSESSIONID` | Servlet container/app | server-side session id |
| LB cookie | Load balancer | routing affinity |
| IdP cookie | Identity provider | identity provider session |
| Remember-me cookie | app/security layer | persistent login marker |

Saat debugging session, lihat semua cookie, bukan hanya `JSESSIONID`.

---

## 31. Kubernetes and Rolling Deployment

Di Kubernetes, app pod bisa mati/diganti kapan saja.

Session impact:

```text
Pod A has local sessions
Rolling update terminates Pod A
Users stuck to Pod A lose sessions unless:
  - graceful drain works, and/or
  - session externalized/replicated, and/or
  - relogin acceptable
```

### 31.1 Graceful shutdown

Saat pod termination:

1. readiness menjadi false,
2. load balancer berhenti kirim traffic baru,
3. in-flight request diberi waktu selesai,
4. app shutdown,
5. local sessions hilang.

Untuk session local, draining hanya membantu request aktif, bukan mempertahankan session setelah pod mati.

### 31.2 WebSocket lebih sulit

WebSocket connection long-lived menempel ke pod.

Rolling deploy harus mempertimbangkan:

- connection drain,
- close message,
- client reconnect,
- session validity after reconnect,
- sticky routing or external auth/session store.

---

## 32. Session Design Patterns

### 32.1 Minimal Auth Session Pattern

Simpan minimal identity data.

```java
public record AuthSessionData(
        String userId,
        String username,
        Set<String> roleCodes,
        Instant loginTime
) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}
```

Pros:

- kecil,
- serializable,
- mudah direplikasi,
- tidak membawa domain graph,
- aman dari stale object berlebihan.

### 32.2 Session Reference Pattern

Session hanya menyimpan key.

```java
session.setAttribute("caseDraft.id", draftId);
```

Data asli:

```text
DB/cache/object store
```

Pros:

- session kecil,
- durable,
- multi-tab lebih mudah,
- distributed deployment lebih aman.

### 32.3 Session Registry Pattern

Untuk melacak session aktif per user.

```text
userId -> set of sessionIds
sessionId -> userId
```

Use cases:

- force logout user,
- limit concurrent sessions,
- admin terminate session,
- close WebSocket on logout,
- audit login/logout.

Caveat:

- registry harus cleanup saat sessionDestroyed,
- distributed registry butuh external store,
- race condition saat timeout/logout bersamaan.

### 32.4 Flash Attribute Pattern

Data hanya hidup satu redirect.

```text
POST /save
  -> set flash message in session
  -> redirect GET /page
  -> display and remove flash message
```

Implementation manual:

```java
session.setAttribute("flash.success", "Saved");
response.sendRedirect("/page");
```

On next request:

```java
String message = (String) session.getAttribute("flash.success");
session.removeAttribute("flash.success");
```

Caveat:

- multi-tab can consume flash unexpectedly,
- use framework support if available.

---

## 33. Anti-Patterns

### 33.1 Session as database

```java
session.setAttribute("case", entireCaseAggregate);
```

Masalah:

- stale data,
- lost update,
- memory bloat,
- replication cost,
- inconsistent business state.

### 33.2 Session as service locator

```java
session.setAttribute("userService", userService);
```

Masalah:

- non-serializable,
- lifecycle salah,
- classloader leak,
- dependency injection kacau.

### 33.3 Session as global workflow scratchpad

```java
session.setAttribute("currentApplication", app);
```

Masalah:

- multi-tab conflict,
- stale workflow,
- back button bug,
- confusing user journey.

### 33.4 Creating session for every anonymous request

```java
request.getSession();
```

Masalah:

- memory waste,
- useless cookies,
- poor cache behavior.

### 33.5 Logging session id

```java
logger.info("session={}", session.getId());
```

Masalah:

- session hijacking risk if logs leak,
- compliance exposure.

Jika perlu korelasi, gunakan request correlation id, bukan session id mentah.

---

## 34. Production Failure Model

### 34.1 Session expired during form submit

Scenario:

```text
User opens form
Waits 45 minutes
Clicks Submit
Session expired
```

Bad behavior:

- NullPointerException,
- new empty session created,
- form processed as anonymous,
- redirect loses user input.

Better behavior:

- detect missing session with `getSession(false)`,
- return clear session expired page,
- preserve non-sensitive draft if designed,
- require login again.

### 34.2 Parallel logout and API call

Scenario:

```text
Request A: POST /logout invalidates session
Request B: GET /api/notifications still running
```

Possible result:

- Request B sees valid session before invalidation,
- Request B sees invalid session after invalidation,
- Request B throws `IllegalStateException` if using session after invalidated.

Mitigation:

- read needed data early,
- handle `IllegalStateException` defensively at boundary,
- use auth filter consistently,
- make logout idempotent.

### 34.3 Node failover loses session

Scenario:

```text
User on Node A
Node A killed
Next request to Node B
```

If local sticky only:

- session missing,
- user relogin.

If replicated/external:

- session may continue,
- but only if replication was current and attributes compatible.

### 34.4 Session deserialization failure after deploy

Scenario:

```text
Old version stores UserSessionData v1
New version expects incompatible v2
```

Result:

- session cannot load,
- user logged out,
- error storm if not handled.

Mitigation:

- stable DTO,
- backward compatibility,
- simple attributes,
- planned session invalidation on breaking changes.

### 34.5 Session bloat causes OOM

Scenario:

```text
Each user stores 5 MB report result in session
500 active users
```

Result:

- heap explosion,
- GC pause,
- OOM,
- container restart,
- all local sessions lost.

Correct design:

- store report output in object storage/temp store,
- keep report id in session or DB,
- stream/download separately.

---

## 35. Practical Implementation: Robust Session Helper

Untuk aplikasi non-framework atau servlet-level utility, buat helper kecil.

```java
package com.example.web.session;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import java.time.Instant;
import java.util.Optional;
import java.util.Set;

public final class Sessions {

    public static final String AUTH = "auth.data";

    private Sessions() {
    }

    public static Optional<AuthData> currentAuth(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return Optional.empty();
        }

        Object value;
        try {
            value = session.getAttribute(AUTH);
        } catch (IllegalStateException ex) {
            return Optional.empty();
        }

        if (value instanceof AuthData authData) {
            return Optional.of(authData);
        }

        return Optional.empty();
    }

    public static void login(HttpServletRequest request, AuthData authData) {
        HttpSession session = request.getSession(true);
        request.changeSessionId();
        session.setAttribute(AUTH, authData);
    }

    public static void logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }

    public record AuthData(
            String userId,
            String username,
            Set<String> roles,
            Instant loginTime
    ) implements java.io.Serializable {
        @java.io.Serial
        private static final long serialVersionUID = 1L;

        public AuthData {
            roles = Set.copyOf(roles);
        }
    }
}
```

Notes:

- `getSession(false)` untuk read.
- `getSession(true)` hanya saat login/session creation sengaja.
- `changeSessionId()` setelah authentication.
- immutable serializable auth data.
- handle `IllegalStateException` saat session invalidated race.

---

## 36. Practical Implementation: Auth Filter with Session

```java
package com.example.web.filter;

import com.example.web.session.Sessions;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.annotation.WebFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

@WebFilter(urlPatterns = "/app/*")
public class SessionAuthFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        var auth = Sessions.currentAuth(request);
        if (auth.isEmpty()) {
            if (isApiRequest(request)) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"SESSION_EXPIRED\"}");
            } else {
                response.sendRedirect(request.getContextPath() + "/login?reason=session_expired");
            }
            return;
        }

        request.setAttribute("auth.userId", auth.get().userId());
        chain.doFilter(req, res);
    }

    private boolean isApiRequest(HttpServletRequest request) {
        String accept = request.getHeader("Accept");
        String requestedWith = request.getHeader("X-Requested-With");
        return request.getRequestURI().startsWith(request.getContextPath() + "/app/api/")
                || "XMLHttpRequest".equalsIgnoreCase(requestedWith)
                || (accept != null && accept.contains("application/json"));
    }
}
```

Important:

- filter tidak membuat session baru untuk unauthenticated request;
- API request mendapat JSON 401;
- browser navigation mendapat redirect;
- authenticated user id dipindahkan ke request attribute untuk current request.

---

## 37. Practical Implementation: Session Lifecycle Metrics

```java
package com.example.web.listener;

import jakarta.servlet.annotation.WebListener;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;

import java.util.concurrent.atomic.AtomicInteger;

@WebListener
public class ActiveSessionListener implements HttpSessionListener {

    private static final AtomicInteger ACTIVE = new AtomicInteger();

    @Override
    public void sessionCreated(HttpSessionEvent se) {
        int count = ACTIVE.incrementAndGet();
        se.getSession().getServletContext().log("Session created. activeSessions=" + count);
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        int count = ACTIVE.decrementAndGet();
        se.getSession().getServletContext().log("Session destroyed. activeSessions=" + count);
    }

    public static int activeSessions() {
        return ACTIVE.get();
    }
}
```

Caveat:

- static metric per JVM only;
- cluster-wide metric perlu aggregation;
- listener count bisa tidak akurat jika process crash;
- jangan gunakan static count untuk billing/security decision.

---

## 38. Checklist Desain Session

Gunakan checklist ini saat review aplikasi Servlet/session-based.

### 38.1 Creation

- Apakah session dibuat hanya saat diperlukan?
- Apakah static asset/health check tidak membuat session?
- Apakah filter menggunakan `getSession(false)` untuk read-only?

### 38.2 Cookie

- Apakah `JSESSIONID` memakai `HttpOnly`?
- Apakah `Secure` aktif di HTTPS?
- Apakah cookie path/domain benar?
- Apakah SameSite sesuai kebutuhan SSO/cross-site flow?
- Apakah session id tidak muncul di URL/log?

### 38.3 Authentication

- Apakah session id dirotasi setelah login?
- Apakah logout invalidate session?
- Apakah logout clear cookie lain yang relevan?
- Apakah AJAX setelah logout/expired mendapat response jelas?

### 38.4 Data

- Apakah session attribute kecil?
- Apakah tidak menyimpan entity graph besar?
- Apakah tidak menyimpan service/connection/request/response?
- Apakah distributed session attributes serializable?
- Apakah class version kompatibel saat rolling deploy?

### 38.5 Concurrency

- Apakah mutable object di session aman dari parallel request?
- Apakah multi-tab workflow tidak overwrite state?
- Apakah session registry cleanup benar?

### 38.6 Deployment

- Apakah strategy session sesuai scaling model?
- Sticky, replicated, external, atau stateless?
- Apakah graceful shutdown mempertimbangkan session/WebSocket?
- Apakah failover behavior diketahui dan diterima?

### 38.7 Observability

- Apakah active session count dimonitor?
- Apakah session creation rate dimonitor?
- Apakah session timeout/logout event tercatat?
- Apakah session bloat bisa dideteksi?
- Apakah 401/expired dibedakan dari 403/forbidden?

---

## 39. Mental Model Final

Session management yang matang bukan soal menghafal `setAttribute` dan `getAttribute`.

Session adalah intersection dari:

```text
HTTP statelessness
  + browser cookie behavior
  + server-side state
  + authentication lifecycle
  + timeout policy
  + concurrency
  + deployment topology
  + memory/serialization
  + proxy/load balancer behavior
  + user journey
```

Cara berpikir top-tier:

1. Jangan membuat session kecuali perlu.
2. Jangan menyimpan data besar dalam session.
3. Jangan menganggap session single-threaded.
4. Jangan menganggap session selalu local.
5. Jangan menganggap logout hanya redirect.
6. Jangan menganggap cookie path/domain/SameSite tidak penting.
7. Jangan menganggap sticky session adalah high availability.
8. Jangan menganggap `HttpSession` sama dengan WebSocket session.
9. Jangan menganggap session timeout sama dengan token timeout.
10. Jangan menganggap deployment tidak mempengaruhi session.

Formula praktis:

```text
Session should contain the smallest possible server-side continuity state
needed to safely connect multiple requests into one user/application conversation.
```

---

## 40. Ringkasan

Di Part 012, kita membahas:

- mengapa session ada di atas HTTP stateless;
- `HttpSession` sebagai server-side conversation handle;
- `getSession()` vs `getSession(false)`;
- `JSESSIONID` dan session tracking;
- cookie-based tracking vs URL rewriting;
- session metadata;
- session attributes dan scope decision;
- timeout, invalidation, logout;
- session fixation dan `changeSessionId()`;
- session cookie configuration;
- authentication boundary;
- concurrency dalam satu session;
- distributed session, sticky routing, replication, external store;
- serialization dan rolling deployment compatibility;
- AJAX/session expiry;
- multi-tab behavior;
- CSRF relation;
- session listener;
- WebSocket boundary;
- reverse proxy/LB/Kubernetes impact;
- robust implementation patterns;
- anti-pattern dan production failure model.

Session terlihat kecil di API, tapi dampaknya besar di arsitektur.

Engineer biasa bertanya:

> “Bagaimana cara simpan user di session?”

Engineer kuat bertanya:

> “Apa lifecycle, timeout, concurrency, cluster, logout, memory, dan failure semantics dari state ini?”

Itulah level berpikir yang dibutuhkan untuk membangun web runtime yang stabil.

---

## 41. Referensi

- Jakarta Servlet 6.1 Specification and API.
- Jakarta Servlet `HttpSession` API documentation.
- Jakarta Servlet `HttpServletRequest#getSession` API documentation.
- Jakarta Servlet `SessionCookieConfig` API documentation.
- Apache Tomcat 11 Servlet API documentation.
- Apache Tomcat clustering and session replication documentation.
- Java EE / Jakarta EE historical Servlet session tracking model.

---

## 42. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
- Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`
- Part 002 — HTTP Fundamentals for Servlet Engineers
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle Deep Dive
- Part 005 — Request Object Internals: `HttpServletRequest`
- Part 006 — Response Object Internals: `HttpServletResponse`
- Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
- Part 008 — Request Dispatching: Forward, Include, Async, Error
- Part 009 — Filters: Cross-Cutting Boundary Before Frameworks
- Part 010 — Listeners: Observing Web Application Lifecycle
- Part 011 — ServletContext and Application Scope
- Part 012 — Session Management: `HttpSession` Deep Dive

Part berikutnya:

- Part 013 — Cookies, Headers, SameSite, and Browser Boundary

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 011](./learn-java-servlet-websocket-web-container-runtime-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-013](./learn-java-servlet-websocket-web-container-runtime-part-013.md)

</div>