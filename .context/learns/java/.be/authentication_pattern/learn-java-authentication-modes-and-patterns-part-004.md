# learn-java-authentication-modes-and-patterns-part-004

# Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality

> Target: Java 8 sampai Java 25.  
> Posisi materi: advanced authentication engineering.  
> Fokus: session-based authentication sebagai **state continuity problem**, bukan sekadar `HttpSession` atau cookie konfigurasi.

---

## 0. Ringkasan Eksekutif

Session-based authentication adalah pola di mana proses login menghasilkan **kontinuitas autentikasi** untuk request berikutnya. Browser tidak mengirim ulang password pada setiap request. Sebagai gantinya, browser membawa **session identifier** melalui cookie, lalu server memakai identifier itu untuk menemukan state autentikasi yang tersimpan di server, container, framework, atau storage eksternal seperti Redis.

Mental model terpenting:

```text
login proof + policy decision
        ↓
server creates authenticated continuity
        ↓
session id is delivered to browser as cookie
        ↓
browser automatically attaches cookie on matching requests
        ↓
server resolves session id into authenticated principal/context
        ↓
application handles request as that principal
```

Kesalahan umum adalah menganggap cookie adalah “session”. Secara teknis, cookie hanyalah **transport mechanism** untuk membawa identifier atau token. Session adalah **state relationship** antara user-agent dan server/application. Dalam sistem Java, state itu bisa berada di:

1. Servlet container `HttpSession`.
2. Spring Security `SecurityContext` yang disimpan di session.
3. Jakarta Security caller principal di container context.
4. Redis/JDBC-backed distributed session.
5. Gateway/session manager di depan aplikasi.
6. Custom session table.
7. Hybrid session + token.

Satu kalimat inti:

> Session-based authentication bukan masalah “menyimpan user login”, tetapi masalah menjaga identitas yang benar, pada request yang benar, dalam waktu yang benar, melalui browser yang tidak sepenuhnya bisa dipercaya, di atas infrastruktur yang bisa scale, fail, retry, dan race.

---

## 1. Problem yang Diselesaikan

HTTP secara desain bersifat request/response dan tidak menyimpan state autentikasi antar request. Setelah user membuktikan identitasnya, aplikasi butuh cara menjawab pertanyaan ini pada request berikutnya:

```text
Apakah request ini masih berasal dari user/browser yang sudah login sebelumnya?
```

Ada beberapa pilihan:

| Pilihan | Karakter | Contoh |
|---|---|---|
| Kirim password setiap request | Buruk, exposure tinggi | Tidak direkomendasikan |
| Basic Auth | Credential dikirim berulang | Cocok untuk kasus terbatas, bukan browser app modern |
| Bearer token | Client menyimpan token | JWT/Opaque access token |
| Session cookie | Browser menyimpan session id | Web app tradisional, BFF, enterprise app |

Session-based authentication menyelesaikan masalah ini dengan membuat **server-side continuity handle**. Handle itu biasanya berupa random session id yang disimpan di cookie.

### 1.1 Contoh web flow sederhana

```text
1. User submit username/password.
2. Server validasi credential.
3. Server membuat session record: session_id -> principal + metadata.
4. Server mengirim Set-Cookie: SESSION=<session_id>; HttpOnly; Secure; SameSite=Lax
5. Browser menyimpan cookie.
6. Request berikutnya otomatis membawa Cookie: SESSION=<session_id>.
7. Server lookup session_id.
8. Server restore principal.
9. Request diproses sebagai user tersebut.
```

### 1.2 Mengapa session masih penting di era OAuth/OIDC?

OIDC sering dipakai untuk login modern, tetapi aplikasi web tetap butuh local session.

Flow umum:

```text
Browser → App → Authorization Server → App callback → App local session → Browser
```

Setelah OIDC login selesai, aplikasi biasanya tidak ingin memvalidasi authorization code atau ID token pada setiap request. Aplikasi membuat **local session** sendiri.

Jadi OIDC tidak menghilangkan session. OIDC sering hanya menjadi mekanisme **initial authentication**, lalu session menjadi mekanisme **request continuity**.

### 1.3 Session cocok untuk apa?

Session-based authentication cocok ketika:

1. Client adalah browser.
2. Aplikasi ingin cookie otomatis dikirim browser.
3. Server ingin revocation kuat.
4. Aplikasi butuh logout yang bermakna.
5. Aplikasi ingin menyimpan state kecil terkait login.
6. Ada UI web interaktif dengan navigation biasa.
7. Ada compliance requirement untuk invalidasi, audit, timeout, dan concurrent session control.
8. App menggunakan BFF pattern sehingga token tidak diekspos ke JavaScript.

Session kurang cocok ketika:

1. Client adalah service-to-service API murni.
2. Client bukan browser dan tidak memakai cookie jar.
3. Request harus stateless secara penuh.
4. Sistem cross-domain kompleks tanpa BFF.
5. Edge/gateway tidak bisa mengakses session store.
6. Latency lookup session tidak dapat diterima.

---

## 2. Mental Model: Session sebagai Authenticated Continuity

Session bukan sekadar map di memory. Session adalah kontrak temporal:

```text
Between time T1 and T2,
for browser B carrying identifier S,
server accepts S as continuity of prior authentication A,
subject to timeout, revocation, rotation, privilege changes, and policy checks.
```

Ada beberapa entity:

```text
+------------------+       Cookie        +---------------------+
| Browser/User     | ------------------> | Java Application    |
| Agent            |                     | / Gateway           |
+------------------+                     +---------------------+
        |                                           |
        | stores cookie                             | resolves id
        v                                           v
+------------------+                     +---------------------+
| Cookie Jar       |                     | Session Store       |
+------------------+                     +---------------------+
```

### 2.1 Session identifier vs session record

Session identifier:

```text
Random opaque value sent to browser.
```

Session record:

```text
Server-side state bound to the identifier.
```

Contoh session record:

```json
{
  "sessionIdHash": "...",
  "principalId": "user-123",
  "tenantId": "agency-A",
  "authTime": "2026-06-19T10:12:00Z",
  "lastAccessTime": "2026-06-19T10:29:15Z",
  "absoluteExpiry": "2026-06-19T11:12:00Z",
  "idleExpiry": "2026-06-19T10:44:15Z",
  "mfaLevel": "phishing-resistant",
  "rolesVersion": 71,
  "ipFingerprint": "weak-signal-only",
  "userAgentHash": "weak-signal-only",
  "status": "ACTIVE"
}
```

Session id harus diperlakukan seperti bearer secret:

```text
Whoever has the session id can usually act as the session owner.
```

Maka session id harus:

1. Random kuat.
2. Tidak mudah ditebak.
3. Tidak mengandung data user.
4. Tidak bisa direkonstruksi.
5. Tidak muncul di URL.
6. Tidak masuk log.
7. Dikirim hanya lewat HTTPS.
8. Dibatasi akses JavaScript dengan `HttpOnly`.

### 2.2 Session bukan identitas final

Session harus menjawab:

```text
Sesi ini merepresentasikan siapa?
```

Tetapi identity source of truth tetap bisa berubah:

1. User dinonaktifkan.
2. Password direset.
3. Role berubah.
4. Tenant access dicabut.
5. MFA requirement naik.
6. Akun dikunci.
7. IdP mengirim logout.

Karena itu session validation tidak boleh hanya:

```java
if (sessionExists) allow();
```

Untuk sistem serius, session validation adalah kombinasi:

```text
session exists
AND session not expired
AND session not revoked
AND principal still valid enough
AND tenant still valid enough
AND authentication strength sufficient for requested action
AND policy version still acceptable
```

---

## 3. Java Stack Model: Di Mana Session Hidup?

Di Java web stack, session bisa muncul pada beberapa layer.

```text
Browser Cookie
     ↓
Servlet Container Session Tracking
     ↓
HttpSession
     ↓
Framework Security Context
     ↓
Application Principal / Domain User
     ↓
Business Authorization
```

### 3.1 Servlet `HttpSession`

`HttpSession` adalah abstraction standar di Servlet/Jakarta Servlet.

Contoh:

```java
HttpSession session = request.getSession(false);
if (session != null) {
    Object userId = session.getAttribute("userId");
}
```

Ada dua mode penting:

```java
request.getSession();      // create if absent
request.getSession(false); // do not create if absent
```

Kesalahan umum:

```java
request.getSession().getAttribute("userId");
```

Pada endpoint publik, ini bisa membuat session tidak perlu, meningkatkan memory pressure, dan menambah cookie untuk anonymous user.

### 3.2 Spring Security `SecurityContext`

Dalam Spring Security servlet stack, authentication result direpresentasikan sebagai `Authentication` di dalam `SecurityContext`.

Modelnya:

```text
Cookie SESSION/JSESSIONID
        ↓
HttpSession
        ↓
SecurityContextRepository
        ↓
SecurityContext
        ↓
Authentication
        ↓
Principal + authorities
```

Secara konseptual:

```java
Authentication authentication = SecurityContextHolder
    .getContext()
    .getAuthentication();
```

Masalahnya bukan mengambil object ini. Masalahnya adalah memastikan object ini:

1. Dibuat hanya setelah authentication valid.
2. Disimpan dengan benar.
3. Dihapus saat logout.
4. Tidak bocor antar thread/request.
5. Tidak stale setelah role berubah.
6. Tidak dipakai sebagai source of truth absolut.

### 3.3 Jakarta Security caller principal

Di Jakarta Security, aplikasi bisa mendapatkan principal dari container:

```java
Principal principal = request.getUserPrincipal();
```

Atau melalui API Jakarta Security sesuai environment.

Container dapat mengelola authentication mechanism, identity store, dan caller principal. Dalam environment enterprise, ini penting karena authentication bisa berada di container, bukan langsung di aplikasi.

### 3.4 Gateway-managed session

Dalam arsitektur modern, session bisa dikelola gateway atau reverse proxy:

```text
Browser → Gateway Session → Java App receives identity header
```

Ini tampak nyaman, tetapi memiliki risiko besar:

1. App percaya header identity.
2. Header bisa dipalsukan jika akses langsung ke app tidak ditutup.
3. Perlu mTLS atau network policy antara gateway dan app.
4. Perlu header stripping.
5. Perlu audit `authenticated_by=gateway`.

Rule:

> Jika identity dikirim lewat header internal, aplikasi harus yakin header itu hanya bisa dibuat oleh trusted component.

---

## 4. Browser Reality: Cookie Bukan Storage Biasa

Cookie adalah state kecil yang dikelola browser dan otomatis dikirim berdasarkan rule domain/path/scheme/same-site.

### 4.1 `Set-Cookie` dan `Cookie`

Server mengirim:

```http
Set-Cookie: SESSION=abc123; Path=/; HttpOnly; Secure; SameSite=Lax
```

Browser mengirim balik:

```http
Cookie: SESSION=abc123
```

Aplikasi tidak sepenuhnya mengontrol kapan cookie dikirim. Browser mengikuti rule.

### 4.2 Attribute penting

| Attribute | Fungsi | Catatan |
|---|---|---|
| `HttpOnly` | Mencegah akses cookie dari JavaScript biasa | Mengurangi dampak XSS terhadap pencurian cookie, tapi tidak mencegah XSS melakukan action atas nama user |
| `Secure` | Cookie hanya dikirim melalui HTTPS | Wajib untuk session auth production |
| `SameSite` | Mengatur pengiriman cookie pada cross-site request | Mitigasi CSRF sebagian, bukan pengganti semua CSRF defense |
| `Path` | Membatasi path pengiriman cookie | Jangan terlalu luas jika tidak perlu |
| `Domain` | Membatasi domain/subdomain | Domain terlalu luas meningkatkan blast radius |
| `Max-Age`/`Expires` | Persistent cookie lifetime | Session cookie browser vs persistent cookie berbeda |

### 4.3 Cookie host-only vs domain cookie

Jika tidak memakai `Domain`, cookie biasanya host-only:

```http
Set-Cookie: SESSION=...; Path=/; Secure; HttpOnly
```

Jika memakai `Domain=example.com`, cookie dapat dikirim ke subdomain yang cocok.

Risiko domain terlalu luas:

```text
app.example.com
admin.example.com
legacy.example.com
blog.example.com
```

Jika salah satu subdomain lemah atau takeover-able, session cookie domain-wide bisa menjadi risiko.

### 4.4 `__Host-` prefix

Untuk cookie session penting, pertimbangkan prefix `__Host-` jika kompatibel dengan kebutuhan.

Contoh:

```http
Set-Cookie: __Host-SESSION=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

Karakter desain:

1. Harus `Secure`.
2. Tidak memakai `Domain`.
3. `Path=/`.
4. Host-bound lebih kuat.

Ini membantu mengurangi risiko cookie domain scoping yang salah.

### 4.5 `SameSite`: Strict, Lax, None

`SameSite` membantu mengontrol apakah cookie dikirim pada request cross-site.

| Value | Behavior umum | Use case |
|---|---|---|
| `Strict` | Sangat ketat, cookie tidak dikirim pada navigasi cross-site | Aplikasi sensitif, tetapi UX bisa terganggu |
| `Lax` | Lebih seimbang, cookie dikirim pada navigasi top-level tertentu | Default bagus untuk banyak web app |
| `None` | Cookie dikirim cross-site | Perlu `Secure`; dipakai untuk embedded/cross-site SSO tertentu |

Untuk aplikasi enterprise biasa:

```http
SameSite=Lax
```

sering menjadi default yang masuk akal.

Untuk use case iframe, cross-site SSO callback tertentu, atau domain terpisah, mungkin perlu `SameSite=None; Secure`, tetapi ini memperbesar exposure CSRF sehingga perlu defense tambahan.

### 4.6 Cookie bukan CSRF token

Session cookie otomatis dikirim browser. Itulah kenapa session auth rentan CSRF.

CSRF terjadi ketika:

```text
User login di app.example.com
User membuka attacker.com
attacker.com membuat browser user mengirim request ke app.example.com
browser otomatis melampirkan cookie session app.example.com
server melihat request authenticated
```

`SameSite` membantu, tetapi CSRF defense yang kuat biasanya melibatkan:

1. CSRF token untuk state-changing request.
2. Origin/Referer validation.
3. SameSite cookie policy.
4. Tidak menerima state-changing action via GET.
5. Content-Type validation untuk API tertentu.

---

## 5. Session Lifecycle: Dari Anonymous sampai Revoked

Session lifecycle bukan hanya login/logout.

```text
NONE
  ↓
ANONYMOUS_SESSION?        optional
  ↓
PRE_AUTH_SESSION?         optional, before login complete
  ↓
AUTHENTICATED_SESSION
  ↓
ELEVATED_SESSION?         optional, after MFA/step-up
  ↓
EXPIRED / LOGGED_OUT / REVOKED / TERMINATED
```

### 5.1 State machine session

```text
[No Session]
     |
     | visit site
     v
[Anonymous Session]
     |
     | login success
     v
[Authenticated Session]
     |
     | sensitive action requires stronger proof
     v
[Elevated Session]
     |
     | timeout/logout/revoke/password reset/admin kill
     v
[Invalid Session]
```

### 5.2 Anonymous session

Anonymous session bisa dipakai untuk:

1. Shopping cart.
2. CSRF token before login.
3. Pre-login state.
4. OIDC `state`/`nonce` storage.
5. Multi-step registration.

Risiko:

1. Session fixation jika session id tidak rotate setelah login.
2. Memory pressure dari anonymous traffic.
3. Bot menciptakan jutaan session.
4. Anonymous state bercampur dengan authenticated state.

Rule:

> Jika anonymous session berubah menjadi authenticated session, rotate session id.

### 5.3 Authenticated session

Authenticated session minimal perlu menyimpan:

1. Principal/user id.
2. Authentication timestamp.
3. Last access timestamp.
4. Expiry policy.
5. Authentication strength.
6. Session status.
7. Session version/policy version.

Jangan menyimpan terlalu banyak data mutable seperti seluruh profile, seluruh role tree, atau object entity besar.

### 5.4 Elevated session

Elevated session muncul setelah step-up authentication.

Contoh:

```text
User login dengan password.
User ingin approve high-risk transaction.
Aplikasi meminta MFA.
Setelah MFA sukses, session memiliki elevated_until = now + 10 minutes.
```

Ini lebih baik daripada membuat seluruh session menjadi “strong” sampai logout.

### 5.5 Invalid session

Invalid session bisa terjadi karena:

1. Idle timeout.
2. Absolute timeout.
3. User logout.
4. Admin revocation.
5. Password reset.
6. Role revoked.
7. Account disabled.
8. Concurrent session policy.
9. Session store eviction.
10. Deployment/session serialization failure.

User experience untuk invalid session harus jelas:

```text
Session expired. Please sign in again.
```

Jangan bocorkan apakah user disabled, revoked, atau password reset pada redirect publik.

---

## 6. Timeout Design: Idle, Absolute, Renewal, Grace

Timeout adalah security control dan UX control.

### 6.1 Idle timeout

Idle timeout mengukur tidak aktifnya session.

```text
if now - lastAccessTime > idleTimeout then expire
```

Contoh:

```text
idleTimeout = 15 minutes
```

Cocok untuk:

1. Enterprise internal apps.
2. Admin portal.
3. Case management system.
4. Financial/regulatory workflows.

Masalah:

1. Background polling bisa membuat session tidak pernah idle.
2. Multiple tabs memperpanjang session tanpa user sadar.
3. API call otomatis dari frontend bisa memperpanjang session.

Desain lebih baik:

```text
Only user activity extends interactive session.
Background heartbeat does not extend session.
```

### 6.2 Absolute timeout

Absolute timeout membatasi umur maksimum session sejak auth time.

```text
if now - authTime > absoluteTimeout then expire
```

Contoh:

```text
absoluteTimeout = 8 hours
```

Ini mencegah session hidup terlalu lama meski terus aktif.

### 6.3 Renewal timeout

Renewal timeout memaksa re-authentication atau session id rotation berkala.

```text
if now - lastCredentialProofTime > renewalInterval then require re-auth
```

Contoh:

```text
Every 60 minutes require fresh login or refresh via IdP.
```

### 6.4 Step-up timeout

Untuk aksi sensitif:

```text
if now - lastMfaTime > 10 minutes then require MFA again
```

Ini menjaga keamanan tanpa memaksa MFA untuk semua request.

### 6.5 Grace window

Saat session expired, ada desain opsional:

1. Hard expire langsung.
2. Grace period untuk auto-save draft.
3. Re-auth lalu restore pending action.

Untuk sistem case management/regulatory, re-auth + restore draft sering lebih manusiawi, tetapi harus hati-hati agar action sensitif tidak dieksekusi otomatis setelah re-auth tanpa konfirmasi.

---

## 7. Session Fixation

Session fixation adalah serangan di mana attacker membuat atau memilih session id sebelum korban login, lalu korban login menggunakan session id itu. Jika session id tidak berubah setelah login, attacker bisa memakai session id yang sama.

Flow buruk:

```text
1. Attacker obtains session id S.
2. Attacker tricks victim to use S.
3. Victim logs in.
4. Server binds user identity to S.
5. Attacker uses S as victim.
```

Defense utama:

```text
Rotate session id after successful authentication.
```

### 7.1 Servlet/Spring pattern

Pada login sukses:

```text
old anonymous session id → new authenticated session id
```

Spring Security memiliki session fixation protection pada session management. Secara konsep, behavior yang diinginkan:

1. Buat session id baru.
2. Migrasikan attribute aman jika diperlukan.
3. Jangan migrasikan attribute yang tidak trusted.
4. Hapus atau invalidasi session lama.

### 7.2 Attribute migration risk

Saat rotate session, ada pilihan:

1. Migrate all attributes.
2. Migrate selected attributes.
3. Create clean session.

Untuk sistem sensitif, lebih aman:

```text
migrate only allowlisted pre-login attributes
```

Misalnya boleh migrasi:

1. CSRF token baru/valid.
2. OIDC state setelah diverifikasi.
3. Return URL yang sudah divalidasi.
4. Locale.

Jangan migrasi sembarang:

1. Pre-auth role.
2. User id candidate.
3. Tenant override.
4. Privilege flags.
5. Unvalidated redirect URL.

---

## 8. Logout Semantics: Local, Global, Front-Channel, Back-Channel

Logout adalah salah satu area paling sering terlihat sederhana tetapi salah desain.

### 8.1 Local logout

Local logout mengakhiri session aplikasi lokal.

```text
Browser → /logout → App invalidates local session → expires cookie
```

Response:

```http
Set-Cookie: SESSION=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax
```

Harus dilakukan:

1. Invalidate server-side session.
2. Clear security context.
3. Expire cookie dengan attribute path/domain yang cocok.
4. Redirect ke page aman.
5. Log logout event.

### 8.2 Logout bukan hanya hapus cookie

Menghapus cookie di browser tidak cukup jika server-side session masih hidup. Attacker yang sudah memiliki session id masih bisa menggunakannya.

Harus:

```text
server session status = TERMINATED
```

atau record dihapus.

### 8.3 OIDC logout

Dalam OIDC/federated login, ada beberapa lapisan:

1. App local session.
2. Authorization Server/IdP session.
3. Other relying party sessions.

Local logout hanya keluar dari app. User mungkin masih punya IdP session dan bisa login ulang tanpa credential prompt.

### 8.4 Front-channel logout

Front-channel logout memakai browser redirect/iframe untuk memberi tahu aplikasi lain.

Kelemahan:

1. Bergantung pada browser.
2. Bisa gagal karena tracking prevention/third-party cookie restriction.
3. Tidak selalu reliable.
4. User menutup tab bisa menghentikan flow.

### 8.5 Back-channel logout

Back-channel logout memakai server-to-server notification.

Kelebihan:

1. Lebih reliable.
2. Tidak bergantung pada browser.
3. Cocok untuk enterprise.

Kebutuhan:

1. Endpoint logout aman.
2. Verifikasi logout token/message.
3. Mapping session by subject/session id.
4. Idempotency.
5. Audit.

### 8.6 Logout race

Race umum:

```text
T1: user clicks logout
T2: browser still has in-flight API request
T3: API request reaches server before invalidation commits
T4: action succeeds after user intended logout
```

Mitigasi:

1. Logout invalidation harus cepat dan atomic.
2. State-changing requests perlu CSRF and fresh session check.
3. Frontend harus cancel pending requests.
4. Backend harus reject after session status becomes terminated.
5. High-risk actions should require recent interaction/elevation.

---

## 9. Distributed Session: Scale, Failover, and Consistency

Dalam single JVM, `HttpSession` in-memory tampak mudah. Dalam production cluster, session menjadi distributed systems problem.

```text
Browser
  ↓
Load Balancer
  ↓
App Node A / App Node B / App Node C
  ↓
Session Store
```

### 9.1 Sticky session

Load balancer mengirim user yang sama ke node yang sama.

Kelebihan:

1. Simpler.
2. Low latency.
3. Tidak perlu session store eksternal untuk basic use case.

Kekurangan:

1. Node failure kehilangan session.
2. Rebalancing sulit.
3. Scaling tidak merata.
4. Deployment rolling restart mengganggu session.
5. Tidak cocok untuk strict availability.

### 9.2 Replicated session

Session direplikasi antar node.

Kelebihan:

1. Failover lebih baik.
2. Tidak selalu perlu external store.

Kekurangan:

1. Serialization overhead.
2. Cluster chatter.
3. Object compatibility saat deployment.
4. Large session menjadi masalah besar.
5. Split-brain/consistency behavior bergantung vendor.

### 9.3 External session store

Session disimpan di Redis, database, atau dedicated session service.

Kelebihan:

1. Stateless-ish app nodes.
2. Rolling deployment lebih mudah.
3. Central revocation.
4. Horizontal scale.
5. Observability session lebih baik.

Kekurangan:

1. Latency per request.
2. Store menjadi dependency critical path.
3. Network partition behavior harus jelas.
4. Serialization/versioning tetap masalah.
5. Redis eviction bisa logout massal.

### 9.4 Redis-backed session

Redis umum dipakai karena TTL native dan latency rendah.

Pattern:

```text
session:<id> -> serialized session record, TTL = idle/absolute policy
user-sessions:<userId> -> set of active session ids
session-index:<tenantId>:<userId> -> optional
```

Desain penting:

1. Gunakan TTL.
2. Jangan simpan object Java besar.
3. Gunakan schema version.
4. Batasi ukuran session.
5. Pastikan eviction policy tidak diam-diam menghapus active session penting.
6. Monitor key count, memory, latency, rejected connections.

### 9.5 JDBC-backed session

JDBC session bisa dipakai untuk consistency/audit lebih kuat, tetapi latency lebih tinggi.

Cocok ketika:

1. Traffic tidak terlalu besar.
2. Audit session state penting.
3. Redis tidak tersedia.
4. Compliance menginginkan storage durable.

Risiko:

1. DB menjadi hot path.
2. Update `last_access_time` per request bisa membebani DB.
3. Lock contention.
4. Cleanup expired session harus baik.

### 9.6 Write amplification dari last access update

Jika setiap request memperbarui `lastAccessTime`, traffic tinggi akan menghasilkan banyak write.

Optimisasi:

```text
Update lastAccessTime only if now - lastAccessTime > threshold
```

Contoh:

```text
idle timeout = 15 min
last access update granularity = 60 sec
```

Trade-off:

1. Lebih sedikit write.
2. Timeout bisa sedikit kurang presisi.
3. Cocok untuk high-throughput app.

---

## 10. Session Payload Design

Session harus kecil, stabil, dan aman.

### 10.1 Simpan identifier, bukan object besar

Buruk:

```java
session.setAttribute("user", fullUserEntity);
session.setAttribute("permissions", hugePermissionTree);
session.setAttribute("caseList", listOfCases);
```

Lebih baik:

```java
session.setAttribute("principalId", userId);
session.setAttribute("tenantId", tenantId);
session.setAttribute("authTime", authTime);
session.setAttribute("authStrength", authStrength);
session.setAttribute("rolesVersion", rolesVersion);
```

Alasan:

1. Object entity bisa stale.
2. Serialization brittle.
3. Memory membesar.
4. Deployment antar versi bisa gagal deserialize.
5. Data sensitif tersebar ke session store.
6. Role revocation menjadi lambat.

### 10.2 Session schema version

Jika session disimpan eksternal, gunakan versioning.

```json
{
  "schemaVersion": 3,
  "principalId": "user-123",
  "tenantId": "tenant-A"
}
```

Saat aplikasi baru deploy:

```text
if schemaVersion old:
  migrate lazily or force re-login
```

### 10.3 Sensitive data di session

Jangan simpan:

1. Password.
2. Raw MFA secret.
3. Raw access token kecuali benar-benar perlu dan terenkripsi/terproteksi.
4. PII berlebihan.
5. Full identity document.
6. Private key.

Jika harus menyimpan token downstream:

1. Minimize scope.
2. Encrypt at rest in session store jika realistic.
3. Bind to session and audience.
4. Rotate/refresh safely.
5. Clear on logout.
6. Avoid logging.

### 10.4 Cache vs source of truth

Session boleh menyimpan snapshot kecil. Tetapi keputusan sensitif harus mempertimbangkan source of truth.

Contoh:

```text
Session says role=APPROVER.
But roleVersion in DB is now 72 while session has 70.
Require reload or terminate session.
```

Pattern:

```text
session.rolesVersion == user.currentRolesVersion
```

Jika tidak sama:

1. Reload authorities.
2. Rebuild security context.
3. Require re-auth.
4. Terminate session untuk kasus sensitif.

---

## 11. Session Rotation Beyond Login

Session id tidak hanya perlu rotate saat login.

Pertimbangkan rotation ketika:

1. Anonymous → authenticated.
2. Privilege elevation.
3. MFA success.
4. Tenant switch.
5. Admin mode entered.
6. User changes password.
7. Account recovery completed.
8. Suspicious activity detected.

### 11.1 Tenant switch

Dalam multi-tenant app, user mungkin bisa pindah tenant/agency.

Buruk:

```text
same session id, tenantId changed silently
```

Lebih aman:

```text
on tenant switch:
  validate membership
  rotate session id
  reset tenant-scoped caches
  log tenant switch
```

### 11.2 Privilege elevation

Saat user masuk “admin mode”:

```text
normal session → step-up proof → rotate id → elevated session
```

Ini mengurangi risiko session id lama dipakai untuk elevated action.

---

## 12. Concurrent Session Control

Concurrent session control menjawab:

```text
Berapa banyak session aktif yang boleh dimiliki satu principal?
```

Policy contoh:

| Context | Policy |
|---|---|
| Consumer app | Many sessions allowed |
| Internal admin | Max 1–3 active sessions |
| Licensing system | Max N licensed sessions |
| High-risk operator | One active session, terminate old |
| API/BFF session | Depends on client/device model |

### 12.1 Strategies

Saat login baru melebihi batas:

1. Deny new login.
2. Terminate oldest session.
3. Ask user to choose session to terminate.
4. Allow but alert.
5. Require MFA.

### 12.2 Data model

```text
user_sessions:<principalId> = [sessionId1, sessionId2, ...]
session:<sessionId> = { principalId, createdAt, lastAccessAt, status }
```

Masalah distributed:

1. Atomicity antara create session dan update index.
2. Cleanup expired session dari index.
3. Race dua login bersamaan.
4. Node crash setelah session created sebelum index updated.

Gunakan atomic transaction/Lua script/DB transaction sesuai store.

### 12.3 Security vs UX

Max one session tampak aman, tetapi bisa buruk:

1. User pindah device.
2. Browser mobile/background reconnect.
3. SSO callback membuat session baru.
4. Multiple browser profile.
5. Race bisa menendang session aktif.

Untuk enterprise, sering lebih baik:

```text
max sessions = small number
show active sessions
allow user/admin revoke
alert suspicious new device
```

---

## 13. CSRF in Session-Based Authentication

Session cookie otomatis dikirim. Ini fitur dan risiko.

### 13.1 Threat model

```text
Victim authenticated at https://bank.example
Victim visits https://evil.example
Evil page submits POST to https://bank.example/transfer
Browser attaches bank session cookie automatically
```

Jika server hanya memeriksa session, action bisa sukses.

### 13.2 Defense pattern

Untuk browser form/app session:

1. CSRF token for unsafe methods.
2. `SameSite=Lax` or `Strict` where possible.
3. Validate `Origin` for unsafe requests.
4. Reject state changes via GET.
5. Use `Content-Type: application/json` and reject simple form posts for API where applicable.
6. Re-auth/step-up for high-risk actions.

### 13.3 CSRF token storage

Pattern umum:

1. Synchronizer token stored server-side in session.
2. Double-submit cookie pattern.
3. Encrypted/signed CSRF token.

Untuk server-side session, synchronizer token natural:

```text
session.csrfToken == request.csrfToken
```

### 13.4 SPA + session cookie

Jika SPA memakai session cookie ke backend, SPA tetap rentan CSRF karena browser otomatis mengirim cookie.

Maka perlu:

1. CSRF token endpoint.
2. Token dikirim di custom header.
3. Backend validate custom header + token.
4. CORS strict.
5. SameSite policy.

---

## 14. XSS and Session Cookie

`HttpOnly` mengurangi risiko pencurian cookie oleh JavaScript, tetapi tidak membuat XSS aman.

Jika attacker menjalankan JavaScript di origin aplikasi:

1. Attacker mungkin tidak bisa membaca session cookie.
2. Tetapi attacker bisa mengirim request authenticated dari halaman itu.
3. Attacker bisa membaca response jika same-origin.
4. Attacker bisa melakukan action atas nama user.

Jadi:

```text
HttpOnly protects cookie confidentiality, not application integrity under XSS.
```

Defense:

1. Output encoding.
2. CSP.
3. Template escaping.
4. Avoid unsafe HTML injection.
5. CSRF still useful but not enough against same-origin XSS.
6. Step-up for sensitive actions.
7. Transaction confirmation.

---

## 15. Remember-Me vs Session

Remember-me bukan session biasa. Remember-me adalah cara membuat session baru tanpa user memasukkan credential lagi.

Flow:

```text
Normal session expired
Browser still has remember-me cookie
Server validates remember-me token
Server creates new authenticated session
```

Risiko:

1. Long-lived bearer credential.
2. Stolen remember-me cookie bisa menghasilkan session baru.
3. Logout harus clear remember-me token.
4. Password reset harus revoke remember-me tokens.

### 15.1 Persistent remember-me token design

Jangan pakai token stateless long-lived tanpa revocation.

Lebih baik:

```text
selector + validator
```

Browser menyimpan:

```text
selector:validator
```

Server menyimpan:

```text
selector -> hash(validator), userId, expiresAt, deviceInfo
```

Saat dipakai:

1. Lookup selector.
2. Compare hash validator.
3. Rotate validator.
4. Create session.
5. Detect reuse of old validator sebagai theft signal.

### 15.2 Remember-me tidak boleh menaikkan privilege penuh

Untuk aksi sensitif:

```text
remember-me authenticated != recently authenticated
```

Maka require password/MFA lagi untuk:

1. Change password.
2. Add bank account.
3. Approve case.
4. Export data.
5. Admin actions.

---

## 16. BFF Pattern: Session Outside, Token Inside

Backend-for-Frontend sering memakai session cookie untuk browser dan token untuk backend calls.

```text
Browser
  ↓ cookie session
BFF Java App
  ↓ access token / mTLS / service token
Resource APIs
```

Keuntungan:

1. Token tidak disimpan di browser JavaScript.
2. Browser hanya punya HttpOnly session cookie.
3. BFF bisa melakukan token refresh server-side.
4. CSRF bisa dikontrol.
5. API internal tidak perlu expose CORS luas.

Risiko:

1. BFF menjadi sensitive component.
2. Session store penting.
3. Token cache per session harus aman.
4. Logout harus clear local session dan token cache.
5. Downstream token audience harus benar.

Rule:

> Browser session dan downstream access token adalah dua lifecycle berbeda. Jangan menyamakan expiry dan revocation keduanya tanpa desain eksplisit.

---

## 17. Session and OAuth/OIDC Login

Dalam OIDC web app:

```text
1. User visits app.
2. App creates pre-login state/nonce session.
3. App redirects to IdP.
4. IdP authenticates user.
5. Browser returns to callback with code.
6. App validates state.
7. App exchanges code for tokens.
8. App validates ID token.
9. App creates local authenticated session.
10. App clears transient state.
```

### 17.1 Pre-login session

Pre-login session menyimpan:

1. `state`.
2. `nonce`.
3. PKCE verifier.
4. Original target URL.

Security rules:

1. State random kuat.
2. Nonce random kuat.
3. PKCE verifier tidak bocor.
4. Return URL allowlisted/relative only.
5. Rotate session after login.
6. Clear transient values after callback.

### 17.2 Local session vs IdP session

Aplikasi punya local session. IdP punya SSO session.

Kemungkinan:

```text
App session expired, IdP session still valid → silent/quick re-login possible.
App session active, IdP session expired → app may continue until local session policy expires.
App logout local only → IdP session remains.
Global logout → both should end, but reliability depends protocol.
```

Desain harus eksplisit.

---

## 18. Session in Regulatory/Case Management Systems

Untuk sistem regulatory/case management, session design lebih dari UX login.

Masalah nyata:

1. Officer membuka case sensitif.
2. Role berubah setelah assignment dicabut.
3. User idle tetapi browser masih terbuka.
4. Approval dilakukan setelah session lama.
5. Multiple tabs membuka case yang berbeda.
6. Audit harus menjelaskan siapa melakukan apa dan kapan.
7. Admin impersonation harus transparan.
8. Concurrent login dari lokasi mencurigakan.

### 18.1 Policy contoh

```text
Idle timeout: 15 min
Absolute timeout: 60 min or 8 hours depending classification
Step-up for approval/export: required if auth older than 10 min
Session id rotation: login, MFA, tenant switch, admin mode
Concurrent sessions: max 2 or 3 for internal users
Role version check: every request or sensitive request
Audit: login, logout, expiry, revoke, elevation, tenant switch
```

### 18.2 Case-level authorization must not rely only on session

Session membuktikan user continuity. Case access tetap harus dicek saat action.

```text
session principal = officer-123
case assignment says officer-123 no longer assigned
=> reject action
```

Jangan simpan daftar case allowed di session tanpa refresh strategy.

### 18.3 Long-running forms

User bisa mengisi form panjang dan session expired.

Pattern:

1. Auto-save draft with explicit draft token.
2. Warn before idle timeout.
3. Re-auth modal.
4. Restore draft after re-auth.
5. Re-check authorization before final submit.

---

## 19. Java Implementation Patterns

### 19.1 Raw Servlet pattern

```java
public final class LoginServlet extends HttpServlet {

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws IOException, ServletException {

        String username = request.getParameter("username");
        String password = request.getParameter("password");

        AuthenticatedUser user = authenticate(username, password);
        if (user == null) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        // Prevent session fixation.
        HttpSession oldSession = request.getSession(false);
        if (oldSession != null) {
            oldSession.invalidate();
        }

        HttpSession session = request.getSession(true);
        session.setAttribute("principalId", user.id());
        session.setAttribute("authTimeEpochMillis", System.currentTimeMillis());
        session.setMaxInactiveInterval(15 * 60);

        response.sendRedirect(request.getContextPath() + "/home");
    }

    private AuthenticatedUser authenticate(String username, String password) {
        // Placeholder: real implementation must use password hashing, throttling,
        // enumeration defense, audit, and secure error handling.
        return null;
    }
}
```

Catatan:

1. Ini contoh konseptual, bukan final production code.
2. Cookie flags sebaiknya dikonfigurasi di container/framework.
3. Jangan membuat session sebelum perlu.
4. Login failure harus diaudit.

### 19.2 Servlet filter validation pattern

```java
public final class SessionAuthenticationFilter implements Filter {

    @Override
    public void doFilter(ServletRequest servletRequest,
                         ServletResponse servletResponse,
                         FilterChain chain) throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        HttpSession session = request.getSession(false);
        if (session == null) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        String principalId = (String) session.getAttribute("principalId");
        if (principalId == null) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        // Optionally check role version, user status, tenant membership, etc.
        chain.doFilter(request, response);
    }
}
```

Advanced issue:

```text
Do not implement your own security framework unless necessary.
```

Framework seperti Spring Security/Jakarta Security sudah menangani banyak edge case. Tetapi memahami filter ini membantu membaca sistem.

### 19.3 Spring Security conceptual configuration

Untuk session-based login di Spring Security modern, konsep yang dicari:

1. Session creation policy sesuai kebutuhan.
2. Session fixation protection aktif.
3. Logout invalidates session.
4. Security context disimpan jelas.
5. Concurrent session control jika perlu.
6. CSRF aktif untuk browser session.

Contoh konseptual:

```java
@Bean
SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/login", "/assets/**").permitAll()
            .anyRequest().authenticated()
        )
        .formLogin(form -> form
            .loginPage("/login")
            .permitAll()
        )
        .sessionManagement(session -> session
            .sessionFixation(fixation -> fixation.migrateSession())
            .maximumSessions(3)
        )
        .logout(logout -> logout
            .invalidateHttpSession(true)
            .deleteCookies("JSESSIONID")
        )
        .csrf(csrf -> {})
        .build();
}
```

Catatan:

1. Detail API bisa berbeda antar versi Spring Security.
2. Tujuan di sini memahami komponen, bukan copy-paste.
3. Untuk stateless API, konfigurasi berbeda.
4. Untuk SPA+BFF, CSRF dan SameSite harus didesain eksplisit.

### 19.4 Spring Session + Redis mental model

```text
Spring Security SecurityContext
        ↓
HttpSession abstraction
        ↓
Spring Session
        ↓
Redis
```

Yang perlu diperhatikan:

1. Serialization format.
2. Namespace per environment.
3. TTL alignment.
4. Redis HA/failover behavior.
5. Session cleanup.
6. Metrics.
7. Class compatibility during deployment.

---

## 20. Failure Modes

### 20.1 Session id predictable

Penyebab:

1. Random lemah.
2. Custom session id generator buruk.
3. Sequential id.
4. Entropy rendah.

Dampak:

```text
attacker guesses active session id
```

Mitigasi:

1. Gunakan container/framework generator kuat.
2. Jangan buat sendiri kecuali sangat paham CSPRNG.
3. Session id panjang dan random.

### 20.2 Session not rotated after login

Dampak:

```text
session fixation
```

Mitigasi:

1. Rotate after login.
2. Rotate after privilege elevation.
3. Migrate only safe attributes.

### 20.3 Cookie sent over HTTP

Dampak:

```text
network attacker steals session cookie
```

Mitigasi:

1. HTTPS everywhere.
2. `Secure` cookie.
3. HSTS.
4. No mixed content.

### 20.4 Cookie accessible to JavaScript

Dampak:

```text
XSS steals session cookie
```

Mitigasi:

1. `HttpOnly`.
2. XSS prevention.
3. CSP.

### 20.5 Session stored only in node memory

Dampak:

```text
rolling restart logs out users
node crash loses sessions
sticky imbalance
```

Mitigasi:

1. External session store.
2. Planned session invalidation policy.
3. Graceful draining.

### 20.6 Session store unavailable

Decision:

```text
fail closed or fail open?
```

Untuk authentication, default harus fail closed.

Tetapi UX/availability bisa memerlukan:

1. Short local cache for already validated sessions.
2. Read-through cache.
3. Degraded mode for read-only actions.
4. Clear incident banner.

Hati-hati: local cache bisa melemahkan revocation.

### 20.7 Session stale after role change

Dampak:

```text
revoked user still has old role until logout
```

Mitigasi:

1. Role version check.
2. Short authority cache TTL.
3. Force session revocation on role change.
4. Step-up for sensitive actions.

### 20.8 Session logout incomplete

Dampak:

```text
user thinks logged out but server session active
```

Mitigasi:

1. Invalidate server session.
2. Clear cookie.
3. Clear security context.
4. Clear remember-me token.
5. Clear downstream token cache.

### 20.9 Same cookie name across apps

Contoh:

```text
app1.example.com uses JSESSIONID
app2.example.com uses JSESSIONID with Domain=.example.com
```

Dampak:

1. Cookie collision.
2. Random logout.
3. Session confusion.
4. Security boundary collapse.

Mitigasi:

1. Host-only cookie.
2. App-specific cookie name.
3. `__Host-` prefix if possible.
4. Avoid broad `Domain`.

### 20.10 Session object serialization failure

Penyebab:

1. Storing entity object.
2. Class changed between deployment.
3. Non-serializable object.
4. Different app versions during rolling deploy.

Mitigasi:

1. Store primitives/DTO minimal.
2. Schema versioning.
3. JSON/CBOR explicit schema.
4. Force re-login on incompatible version.

---

## 21. Design Invariants

Gunakan invariant ini saat review authentication session architecture.

### Invariant 1 — Session id is bearer secret

```text
Anyone possessing active session id can act as session owner unless additional binding exists.
```

Konsekuensi:

1. Jangan log session id.
2. Jangan masukkan ke URL.
3. Jangan expose ke JS.
4. Jangan kirim lewat HTTP.

### Invariant 2 — Authentication transition rotates identifier

```text
Any transition from less trusted to more trusted state must rotate session id.
```

Contoh:

1. Anonymous → authenticated.
2. Password-only → MFA elevated.
3. Normal → admin mode.

### Invariant 3 — Session is not authorization source of truth

```text
Session can cache identity, but sensitive authorization must tolerate policy changes.
```

### Invariant 4 — Logout invalidates server-side state

```text
Deleting cookie without server invalidation is incomplete logout.
```

### Invariant 5 — Timeout is policy, not UI timer

```text
Frontend idle countdown is advisory; backend expiry is authoritative.
```

### Invariant 6 — Browser automatically sends cookies

```text
Any cookie-based auth must consider CSRF.
```

### Invariant 7 — Session store is part of authentication critical path

```text
If the session store is down, authentication continuity is impaired.
```

### Invariant 8 — Session state must be small and versioned

```text
Large mutable session state creates scale, security, and deployment risks.
```

---

## 22. Decision Matrix

### 22.1 Where to store session?

| Situation | Recommended |
|---|---|
| Single-node dev app | Container memory acceptable |
| Small internal app with sticky LB | Sticky session possible but known trade-off |
| Production multi-node app | External session store preferred |
| High compliance audit | DB or Redis + audit event table |
| High traffic web app | Redis/session service with tuned TTL/write granularity |
| Fully stateless API | Do not use session; use token auth |

### 22.2 Cookie policy

| Context | Cookie policy |
|---|---|
| Normal first-party web app | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| Very sensitive app | Consider `SameSite=Strict` if UX permits |
| Cross-site embedding/SSO | `SameSite=None; Secure` plus strong CSRF/origin controls |
| Multi-subdomain app | Prefer host-only; avoid broad `Domain` unless required |
| Strong host binding | Consider `__Host-` prefix |

### 22.3 Timeout policy

| App type | Idle | Absolute | Step-up |
|---|---:|---:|---:|
| Public low-risk app | 30–120 min | days/weeks with remember-me | sensitive actions only |
| Internal business app | 15–30 min | 8–12 hours | approval/export/admin |
| High-risk admin/regulatory | 5–15 min | 30–120 min or workday | frequent for sensitive actions |
| BFF for SPA | 15–60 min | tied to IdP/session policy | sensitive API calls |

Angka di atas bukan standar universal. Ini starting point untuk desain. Real value harus mengikuti risk assessment, regulation, UX, dan threat model.

---

## 23. Production Checklist

### 23.1 Cookie

- [ ] Session cookie memakai `Secure`.
- [ ] Session cookie memakai `HttpOnly`.
- [ ] `SameSite` dipilih eksplisit.
- [ ] `Domain` tidak terlalu luas.
- [ ] `Path` sesuai.
- [ ] Cookie name tidak collision antar app.
- [ ] Session id tidak pernah di URL.
- [ ] Session id tidak muncul di log.
- [ ] HSTS aktif untuk production domain.

### 23.2 Lifecycle

- [ ] Session id rotate setelah login.
- [ ] Session id rotate setelah MFA/step-up.
- [ ] Session id rotate setelah tenant/admin mode switch.
- [ ] Idle timeout enforced server-side.
- [ ] Absolute timeout enforced server-side.
- [ ] Logout invalidates server-side session.
- [ ] Logout clears cookie.
- [ ] Password reset revokes sessions/remember-me tokens.
- [ ] Account disable revokes active sessions.

### 23.3 Distributed system

- [ ] Session store HA jelas.
- [ ] Failover behavior diuji.
- [ ] Redis eviction policy aman.
- [ ] Session TTL align dengan policy.
- [ ] Last access write amplification dikontrol.
- [ ] Session payload kecil.
- [ ] Serialization format versioned.
- [ ] Rolling deploy compatibility diuji.

### 23.4 Security controls

- [ ] CSRF protection aktif untuk browser session.
- [ ] Origin/Referer validation dipertimbangkan untuk unsafe methods.
- [ ] XSS prevention tidak bergantung pada `HttpOnly` saja.
- [ ] Concurrent session policy jelas.
- [ ] Role/policy version invalidation ada.
- [ ] Step-up untuk aksi sensitif.
- [ ] Audit login/logout/expiry/revoke/elevation.

### 23.5 Observability

- [ ] Metrics active sessions.
- [ ] Metrics session creation rate.
- [ ] Metrics session invalidation reason.
- [ ] Metrics session store latency.
- [ ] Alert login storm.
- [ ] Alert session store errors.
- [ ] Audit event correlation id.
- [ ] No sensitive cookie/token values in logs.

---

## 24. Common Mistakes

### Mistake 1 — Menganggap JWT selalu lebih modern dari session

JWT berguna, tetapi session memiliki keunggulan revocation, small browser exposure, dan server-side control. Untuk browser app, session+BFF sering lebih aman daripada menyimpan token di JavaScript.

### Mistake 2 — Menaruh terlalu banyak data di session

Session bukan cache semua object user. Simpan minimal identifier dan metadata.

### Mistake 3 — Tidak rotate session setelah login

Ini membuka risiko session fixation.

### Mistake 4 — Menghapus cookie tapi tidak invalidate server session

Ini logout palsu.

### Mistake 5 — Mengandalkan frontend idle timer

Frontend bisa dimanipulasi. Backend harus authoritative.

### Mistake 6 — CSRF dimatikan karena “kami pakai JSON API”

Jika authentication berbasis cookie dan browser otomatis mengirim cookie, CSRF tetap perlu dipikirkan.

### Mistake 7 — Cookie `Domain` terlalu luas

Satu subdomain lemah bisa memperbesar risiko terhadap semua app di domain.

### Mistake 8 — Menyimpan role selamanya di session

Role berubah, session masih lama, access tetap jalan. Gunakan role version atau revocation.

### Mistake 9 — Menganggap Redis session store pasti aman

Redis eviction, failover, latency, dan serialization tetap harus didesain.

### Mistake 10 — Tidak membedakan local logout dan global logout

OIDC/SSO membuat logout multi-layer. Local logout bukan global logout.

---

## 25. Review Questions

Gunakan pertanyaan ini untuk menguji desain session authentication.

1. Apa bentuk credential yang dibawa browser setelah login?
2. Apakah session id random opaque dan cukup kuat?
3. Apakah session id rotate setelah login?
4. Apakah session id rotate setelah privilege elevation?
5. Apakah cookie memakai `HttpOnly`, `Secure`, dan `SameSite` eksplisit?
6. Apakah session id pernah muncul di URL/log?
7. Di mana session record disimpan?
8. Apa yang terjadi jika session store down?
9. Apa yang terjadi saat Redis evict session key?
10. Apakah timeout enforced di server?
11. Apakah background polling memperpanjang idle timeout?
12. Apakah logout invalidates server-side session?
13. Apakah password reset mencabut active sessions?
14. Apakah role revoke langsung berlaku?
15. Apakah concurrent session policy jelas?
16. Apakah CSRF protection aktif?
17. Apakah XSS tetap bisa melakukan action meski cookie `HttpOnly`?
18. Apakah session payload kecil dan versioned?
19. Apakah rolling deployment bisa deserialize session lama?
20. Apakah audit bisa merekonstruksi login → action → logout?

---

## 26. Mini Architecture Patterns

### 26.1 Classic Java Server-Side Rendered App

```text
Browser
  ↓ JSESSIONID
Java Web App
  ↓
HttpSession in container / external store
```

Use when:

1. Server-rendered UI.
2. Enterprise internal app.
3. Simple deployment.

Focus:

1. Session fixation.
2. CSRF.
3. Timeout.
4. Session size.

### 26.2 Spring Boot BFF + SPA

```text
SPA Browser
  ↓ HttpOnly session cookie
Spring Boot BFF
  ↓ access token/service credential
Backend APIs
```

Use when:

1. SPA frontend.
2. Want to avoid token in browser JS.
3. Need OIDC login.

Focus:

1. CSRF token.
2. SameSite.
3. OIDC state/nonce session.
4. Token cache lifecycle.
5. Logout local + IdP.

### 26.3 Gateway Session

```text
Browser
  ↓ gateway cookie
Identity-Aware Gateway
  ↓ signed/mTLS-protected identity header
Java App
```

Use when:

1. Centralized auth platform.
2. Many apps behind gateway.
3. Legacy apps need identity injection.

Focus:

1. Header spoofing prevention.
2. Network isolation.
3. Header stripping.
4. Audit source.
5. App-level authorization still required.

### 26.4 External Session Service

```text
Browser
  ↓ session cookie
Java App nodes
  ↓
Session Service / Redis / DB
```

Use when:

1. Large cluster.
2. Need central revocation.
3. Multiple apps share session rules.

Focus:

1. Latency.
2. Consistency.
3. Store HA.
4. Session schema.
5. Revocation propagation.

---

## 27. How This Connects to Later Parts

Part ini menjadi dasar untuk beberapa part berikutnya:

1. **Part 11 JWT Authentication**: membandingkan session id opaque vs JWT stateless.
2. **Part 12 Opaque Token**: session id mirip reference token dalam beberapa aspek.
3. **Part 14 OIDC**: OIDC login sering menghasilkan local session.
4. **Part 15 Authorization Code + PKCE**: pre-login session menyimpan state, nonce, PKCE verifier.
5. **Part 21 MFA/Step-Up**: elevated session adalah state session khusus.
6. **Part 23 Token Lifecycle**: session lifecycle dan token lifecycle sering saling terikat.
7. **Part 27 Microservices**: session di edge, token di internal service.
8. **Part 30 Audit**: session event adalah tulang punggung forensic trail.

---

## 28. Latihan Desain

### Latihan 1 — Internal regulatory case app

Requirement:

```text
- User adalah officer internal.
- Idle timeout 15 menit.
- Approval case perlu MFA jika login lebih dari 10 menit.
- User bisa punya maksimum 2 session.
- Role bisa dicabut oleh admin kapan saja.
- Audit harus defensible.
```

Desain yang diharapkan:

1. Session cookie `HttpOnly; Secure; SameSite=Lax`.
2. Session store Redis/DB with TTL.
3. Session id rotate after login and MFA.
4. Store `principalId`, `tenantId`, `authTime`, `lastMfaTime`, `rolesVersion`.
5. Check role version on every sensitive action.
6. Concurrent session index per user.
7. Admin role revoke triggers active session revocation or role reload.
8. Approval requires recent MFA.
9. Audit login, MFA, approval, revoke, logout.
10. Backend authoritative timeout.

### Latihan 2 — SPA with OIDC login

Requirement:

```text
- Vue/React SPA.
- OIDC login via external IdP.
- Backend Java calls downstream APIs.
- Browser must not store access token in localStorage.
```

Desain yang diharapkan:

1. BFF pattern.
2. Browser holds HttpOnly session cookie.
3. BFF stores token server-side or retrieves per session.
4. OIDC state/nonce/PKCE verifier stored in pre-login session.
5. Rotate session after callback success.
6. CSRF token for unsafe methods.
7. CORS restrictive.
8. Local logout clears session and token cache.
9. Optional IdP logout.
10. Downstream token audience per API.

---

## 29. Summary

Session-based authentication adalah salah satu pola paling penting untuk Java web systems. Kekuatan utamanya adalah server-side control: revocation, timeout, logout, concurrent session policy, and auditability. Kelemahannya adalah state management: session store, scaling, CSRF, fixation, stale authorization, distributed consistency, dan browser cookie behavior.

Mental model final:

```text
Session authentication = prior proof + server-side continuity + browser-carried bearer id + lifecycle policy + distributed invalidation + audit trail.
```

Untuk top-tier engineering, jangan berhenti pada konfigurasi:

```java
sessionManagement()
```

Tanyakan:

1. Apa exact state machine session?
2. Kapan session id rotate?
3. Kapan session invalid?
4. Siapa source of truth untuk principal dan role?
5. Apa yang terjadi saat role berubah?
6. Bagaimana logout dibuktikan?
7. Bagaimana session store gagal?
8. Apakah CSRF sudah dimodelkan?
9. Apakah audit bisa menjelaskan semua transisi?
10. Apakah desain tetap benar saat scale, failover, dan deployment?

Jika jawaban atas pertanyaan ini jelas, session-based authentication berubah dari “fitur login” menjadi bagian defensible dari architecture.

---

## 30. References

Referensi utama untuk grounding materi:

1. OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
2. Spring Security Reference: Authentication Persistence and Session Management — https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html
3. MDN Web Docs: Set-Cookie Header — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
4. MDN Web Docs: Using HTTP Cookies — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies
5. RFC 6265: HTTP State Management Mechanism — https://www.rfc-editor.org/rfc/rfc6265.html
6. IETF HTTPbis draft: Cookies: HTTP State Management Mechanism / RFC6265bis — https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/
7. Jakarta Security documentation — https://jakarta.ee/specifications/security/
8. Jakarta Servlet documentation — https://jakarta.ee/specifications/servlet/

---

## 31. Status

Part 4 selesai.

Series belum selesai.

Part berikutnya: **Part 5 — Servlet Container Authentication**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-003.md">⬅️ Part 3 — Password Authentication Done Properly</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-005.md">Part 5 — Servlet Container Authentication ➡️</a>
</div>
