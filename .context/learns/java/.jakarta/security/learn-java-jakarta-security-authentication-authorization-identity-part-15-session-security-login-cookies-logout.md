# Learn Java Jakarta Security Authentication Authorization Identity

## Part 15 — Session Security: Login State, `HttpSession`, Cookies, Logout

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-15-session-security-login-cookies-logout.md`  
> Target: Java 8 sampai Java 25, Java EE / Jakarta EE, Servlet, Jakarta Security, enterprise application security

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membahas:

1. vocabulary identity/security,
2. container security architecture,
3. Servlet security foundation,
4. authentication mechanisms,
5. Jakarta Security API,
6. `SecurityContext`,
7. `IdentityStore`,
8. credential/password handling,
9. Jakarta Authentication/JASPIC,
10. Jakarta Authorization/JACC,
11. declarative authorization,
12. programmatic/domain authorization,
13. role/group/claim/scope mapping.

Part ini masuk ke pertanyaan yang sangat sering diremehkan:

> Setelah user berhasil login, **di mana status login disimpan, bagaimana browser membuktikan request berikutnya masih milik user yang sama, kapan identity harus dianggap kadaluarsa, dan bagaimana benar-benar logout?**

Di aplikasi enterprise Java/Jakarta, jawaban praktisnya sering melibatkan:

- `HttpSession`,
- session cookie,
- container-managed security state,
- application-managed login state,
- distributed session/cache,
- reverse proxy/load balancer,
- OIDC session,
- token lifetime,
- logout propagation,
- audit.

Security sistem tidak selesai saat password/token valid. Justru banyak privilege escalation, stale access, session hijacking, dan logout failure muncul **setelah authentication berhasil**.

---

## 1. Mental Model: Session Adalah Bukti Kontinuitas, Bukan Bukti Identitas Baru

Authentication menjawab:

```text
Apakah caller berhasil membuktikan identitasnya pada saat login/token validation?
```

Session menjawab:

```text
Apakah request sekarang dapat dikaitkan dengan authentication state yang sebelumnya sudah berhasil dibuat?
```

Artinya, session adalah mekanisme kontinuitas.

```text
Login time:
    credential/token/certificate diverifikasi
    identity dibentuk
    session dibuat atau security context dibangun

Subsequent request:
    browser mengirim session cookie
    server menemukan session
    container/application mengembalikan identity/security state
    authorization dievaluasi ulang berdasarkan identity/context tersebut
```

Kesalahan mental model yang umum:

```text
Salah:
    User sudah login, berarti semua request berikutnya aman.

Benar:
    User pernah login, tapi setiap request berikutnya tetap harus melewati:
    - session lookup,
    - session validity,
    - cookie integrity,
    - timeout check,
    - authorization check,
    - tenant/resource/state check.
```

Session bukan identitas itu sendiri. Session adalah **handle** ke identity state.

---

## 2. Request Lifecycle Dengan Session

Secara sederhana:

```text
[Browser]
    |
    | 1. GET /protected
    v
[Container]
    |
    | 2. No valid session / unauthenticated
    v
[Authentication Mechanism]
    |
    | 3. Challenge / redirect login
    v
[Browser]
    |
    | 4. Submit credential / OIDC callback
    v
[Container/Auth Mechanism]
    |
    | 5. Validate credential
    | 6. Establish caller principal + groups
    | 7. Create/associate HttpSession
    | 8. Send Set-Cookie: JSESSIONID=...
    v
[Browser]
    |
    | 9. Subsequent request with Cookie: JSESSIONID=...
    v
[Container]
    |
    | 10. Restore session + security identity
    | 11. Evaluate authorization
    v
[Application]
```

Important invariant:

```text
Session id is an authentication bearer artifact.
Whoever possesses a valid session id may be treated as the authenticated session owner.
```

Karena itu session id harus diperlakukan seperti secret.

---

## 3. `HttpSession`: Apa Itu dan Apa yang Bukan

`HttpSession` adalah container abstraction untuk mempertahankan state antara beberapa request dari client yang sama.

Di Servlet/Jakarta Servlet, session biasanya di-track melalui cookie seperti `JSESSIONID`, tetapi secara historis juga bisa via URL rewriting.

### 3.1 Apa yang cocok disimpan di `HttpSession`?

Cocok:

- session-scoped UI state,
- post-login marker,
- selected tenant/organization aktif,
- CSRF token,
- small session metadata,
- non-sensitive preference sementara,
- minimal identity snapshot kalau benar-benar dibutuhkan.

Tidak cocok:

- password,
- access token jangka panjang tanpa proteksi,
- refresh token raw tanpa encryption/rotation strategy,
- seluruh user profile besar,
- large object,
- entity JPA attached,
- permission matrix besar tanpa invalidation,
- data rahasia yang tidak perlu.

Mental model:

```text
HttpSession should contain minimal continuity state, not become a user database cache.
```

### 3.2 `HttpSession` bukan authorization engine

`HttpSession` dapat menyimpan state, tapi tidak boleh menjadi satu-satunya sumber keputusan authorization.

Contoh buruk:

```java
Boolean canApprove = (Boolean) session.getAttribute("canApprove");
if (Boolean.TRUE.equals(canApprove)) {
    approve(caseId);
}
```

Masalah:

- role bisa berubah setelah login,
- assignment bisa berubah,
- case state bisa berubah,
- tenant aktif bisa berubah,
- session bisa stale,
- data bisa tidak sinkron dengan database.

Lebih baik:

```java
Actor actor = actorResolver.resolve(securityContext, request);
CaseRecord record = caseRepository.findForUpdate(caseId);
authorizationService.check(actor, Action.APPROVE_CASE, record);
caseService.approve(actor, record);
```

Session boleh membantu resolve actor, tapi authorization harus tetap dievaluasi terhadap resource/state terkini.

---

## 4. Session Cookie: Kenapa Cookie Sangat Kritis

Dalam aplikasi browser-based, session id biasanya dikirim melalui cookie.

```http
Set-Cookie: JSESSIONID=abc123; Path=/aceas; Secure; HttpOnly; SameSite=Lax
```

Request berikutnya:

```http
Cookie: JSESSIONID=abc123
```

Cookie ini adalah bearer artifact.

Kalau attacker mencuri cookie valid:

```text
Attacker tidak perlu password.
Attacker tidak perlu OTP.
Attacker cukup mengirim session id valid.
```

Karena itu cookie harus didesain dengan atribut yang benar.

---

## 5. Cookie Attribute: `Secure`, `HttpOnly`, `SameSite`, `Path`, `Domain`, `Max-Age`

### 5.1 `Secure`

`Secure` berarti cookie hanya dikirim melalui HTTPS.

```http
Set-Cookie: JSESSIONID=abc; Secure
```

Tanpa `Secure`, browser dapat mengirim cookie melalui HTTP jika ada HTTP endpoint yang match domain/path.

Invariant production:

```text
Session cookie for authenticated application must be Secure.
```

Tapi ada jebakan reverse proxy.

Jika TLS terminate di load balancer, backend container mungkin melihat request sebagai HTTP.
Jika container tidak dikonfigurasi memahami `X-Forwarded-Proto`/`Forwarded`, cookie bisa tidak diberi `Secure` atau redirect bisa salah.

```text
Browser --HTTPS--> ALB/Nginx --HTTP--> Jakarta Container
```

Container perlu tahu original scheme adalah HTTPS.

### 5.2 `HttpOnly`

`HttpOnly` membuat cookie tidak dapat diakses melalui JavaScript `document.cookie`.

```http
Set-Cookie: JSESSIONID=abc; HttpOnly
```

Ini mengurangi dampak XSS terhadap session theft.

Namun `HttpOnly` bukan magic shield:

- XSS masih bisa melakukan request atas nama user,
- XSS masih bisa mencuri data dari DOM/API response,
- XSS bisa melakukan state-changing operation jika CSRF/authorization lemah.

Mental model:

```text
HttpOnly protects cookie confidentiality from JavaScript access.
It does not make XSS harmless.
```

### 5.3 `SameSite`

`SameSite` mengontrol kapan cookie dikirim pada cross-site request.

Pilihan umum:

```text
SameSite=Strict
SameSite=Lax
SameSite=None; Secure
```

Interpretasi sederhana:

- `Strict`: cookie tidak dikirim dalam cross-site navigation. Paling ketat, tapi bisa mengganggu SSO/deep link.
- `Lax`: cookie dikirim pada top-level navigation yang relatif aman, tetapi tidak pada banyak cross-site subrequest. Sering menjadi default baik untuk banyak aplikasi.
- `None`: cookie boleh dikirim cross-site, harus `Secure`. Dibutuhkan untuk beberapa SSO/iframe/third-party integration, tetapi meningkatkan exposure terhadap CSRF sehingga perlu defense lain.

Contoh:

```http
Set-Cookie: JSESSIONID=abc; Secure; HttpOnly; SameSite=Lax
```

Untuk OIDC login callback, `SameSite` perlu diuji. Flow OIDC melibatkan redirect dari IdP ke RP. Banyak aplikasi tetap dapat memakai `Lax` untuk top-level redirect, tetapi integrasi tertentu bisa butuh konfigurasi berbeda.

### 5.4 `Path`

`Path` membatasi path request yang akan menerima cookie.

```http
Set-Cookie: JSESSIONID=abc; Path=/aceas
```

Jika satu domain punya beberapa aplikasi:

```text
https://example.com/aceas
https://example.com/cpds
```

Maka `Path=/aceas` mencegah browser mengirim cookie ACEAS ke `/cpds`.

Tapi jangan salah paham:

```text
Path is browser sending rule, not strong isolation boundary.
```

Kalau aplikasi berada di domain sama, XSS/cookie interaction tetap harus dianalisis hati-hati.

### 5.5 `Domain`

`Domain` mengontrol host mana yang menerima cookie.

```http
Set-Cookie: JSESSIONID=abc; Domain=.example.com
```

Dengan domain luas, cookie bisa dikirim ke banyak subdomain.

Ini berisiko jika ada subdomain kurang dipercaya:

```text
admin.example.com
app.example.com
legacy.example.com
static.example.com
```

Kalau cookie auth memakai `.example.com`, compromise di satu subdomain dapat memengaruhi aplikasi lain.

Preferensi umum:

```text
Use host-only cookie unless cross-subdomain sharing is absolutely required.
```

### 5.6 `Max-Age` / `Expires`

Untuk session cookie tradisional, sering tidak ada `Max-Age`, sehingga cookie hilang saat browser session selesai.

Persistent cookie dengan `Max-Age` cocok untuk remember-me, bukan normal authenticated session tanpa pertimbangan.

```http
Set-Cookie: REMEMBERME=...; Max-Age=1209600; Secure; HttpOnly; SameSite=Lax
```

Remember-me harus diperlakukan berbeda dari active authenticated session.

---

## 6. Session Fixation

Session fixation terjadi ketika attacker membuat/mengetahui session id sebelum korban login, lalu korban login memakai session id tersebut. Setelah login, attacker memakai session id yang sama untuk mengambil alih session.

Flow buruk:

```text
1. Attacker obtains session id S1.
2. Attacker tricks victim into using S1.
3. Victim logs in.
4. Server binds authenticated identity to S1.
5. Attacker uses S1 as authenticated victim.
```

Defense utama:

```text
Regenerate/change session id after successful authentication.
```

Di Servlet modern ada API:

```java
request.changeSessionId();
```

Atau pola lama:

```java
HttpSession oldSession = request.getSession(false);
Map<String, Object> attributesToKeep = extractSafeAttributes(oldSession);

if (oldSession != null) {
    oldSession.invalidate();
}

HttpSession newSession = request.getSession(true);
restoreSafeAttributes(newSession, attributesToKeep);
```

Dalam container-managed login, container/framework biasanya menangani ini, tetapi tetap perlu diverifikasi.

Checklist:

```text
After login:
    old unauthenticated session id must not remain the authenticated session id.
```

---

## 7. Idle Timeout vs Absolute Timeout

Ada dua konsep berbeda.

### 7.1 Idle timeout

Session berakhir jika tidak ada aktivitas selama durasi tertentu.

```text
User inactive for 15 minutes -> session invalidated
```

Di Servlet:

```java
session.setMaxInactiveInterval(15 * 60);
```

Atau di `web.xml`:

```xml
<session-config>
    <session-timeout>15</session-timeout>
</session-config>
```

`session-timeout` biasanya dalam menit.

### 7.2 Absolute timeout

Session berakhir setelah durasi total sejak login, meskipun user aktif.

```text
User logged in at 09:00
Absolute timeout = 8 hours
At 17:00 session must expire even if still active
```

Servlet container tidak selalu menyediakan absolute timeout built-in universal. Sering perlu application-level metadata:

```java
public final class SessionTimes {
    public static final String AUTHENTICATED_AT = "AUTHENTICATED_AT";
    public static final String LAST_REAUTH_AT = "LAST_REAUTH_AT";
}
```

Filter:

```java
Instant authenticatedAt = (Instant) session.getAttribute(SessionTimes.AUTHENTICATED_AT);
if (authenticatedAt != null && authenticatedAt.plus(Duration.ofHours(8)).isBefore(clock.instant())) {
    session.invalidate();
    response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
    return;
}
```

### 7.3 Kenapa keduanya perlu?

Idle timeout melindungi dari unattended browser.

Absolute timeout melindungi dari session yang hidup terlalu lama karena aktivitas terus-menerus atau automation.

Enterprise pattern:

```text
Idle timeout      : 15-30 minutes depending risk
Absolute timeout  : 8-12 hours or shorter for high-risk apps
Step-up timeout   : shorter for sensitive operation
Remember-me       : separate low-assurance state, not full session
```

Nilai akhirnya tergantung risk profile, UX, compliance, dan threat model.

---

## 8. Reauthentication dan Step-Up Session

Tidak semua action memiliki risk sama.

Contoh low risk:

- melihat dashboard,
- membaca public-ish data internal,
- melihat daftar task.

Contoh high risk:

- approve enforcement action,
- update bank/payment data,
- create admin user,
- change role,
- export large dataset,
- override workflow,
- close case,
- delete record.

Untuk high-risk action, session login biasa mungkin tidak cukup. Dibutuhkan reauthentication atau step-up.

```text
Authenticated session:
    assurance level = normal

Sensitive operation:
    require recent authentication within 5 minutes
    or require MFA/stronger assurance
```

Model sederhana:

```java
public void requireRecentAuthentication(HttpSession session, Duration maxAge) {
    Instant lastAuth = (Instant) session.getAttribute("LAST_STRONG_AUTH_AT");
    if (lastAuth == null || lastAuth.plus(maxAge).isBefore(clock.instant())) {
        throw new ReauthenticationRequiredException();
    }
}
```

OIDC/MFA-aware pattern:

- cek `acr` claim,
- cek `amr` claim,
- cek `auth_time`,
- pakai `prompt=login` atau `max_age` saat redirect ke IdP,
- setelah callback, update assurance state di session.

Mental model:

```text
Session answers continuity.
Step-up answers freshness and assurance for sensitive action.
```

---

## 9. Session vs Token: Jangan Campur Semantik

Browser app sering memakai session cookie. API sering memakai bearer token. OIDC login memakai ID token dan kadang access token.

Kesalahan umum:

```text
User login via OIDC, then app stores ID token in session and treats it as API authorization token.
```

Harus dibedakan:

| Artifact | Fungsi | Umum disimpan di | Risiko utama |
|---|---|---|---|
| Session cookie | Menghubungkan browser ke server-side session | Browser cookie | theft/hijack/fixation/CSRF |
| ID token | Bukti authentication dari OP ke client | server-side session temporarily | wrong audience/use as API token |
| Access token | Akses API/resource server | server-side, memory, secure storage | replay/leakage/wrong audience |
| Refresh token | Mendapat access token baru | secure server-side storage | long-lived compromise |
| Remember-me token | Recreate login session | persistent cookie + server store | long-lived theft |

Untuk server-side Jakarta app:

```text
Prefer storing tokens server-side if needed, while browser only gets opaque session cookie.
```

Ini mendekati Backend-for-Frontend/BFF mindset.

---

## 10. Logout: Local Logout, Global Logout, OIDC Logout

Logout sering terlihat sederhana:

```java
request.logout();
session.invalidate();
```

Tapi di SSO/OIDC environment, logout punya beberapa lapisan.

### 10.1 Local logout

Local logout hanya menghapus session aplikasi lokal.

```text
User logged out from App A.
App A session invalid.
IdP session may still exist.
App B session may still exist.
```

Contoh:

```java
@PostMapping("/logout")
public void logout(HttpServletRequest request, HttpServletResponse response) throws Exception {
    request.logout();
    HttpSession session = request.getSession(false);
    if (session != null) {
        session.invalidate();
    }
    response.sendRedirect("/logged-out");
}
```

Urutan penting:

1. clear app security state,
2. invalidate session,
3. expire cookies if needed,
4. redirect ke safe location.

### 10.2 Global logout / SSO logout

Global logout mencoba mengakhiri session di IdP dan/atau aplikasi lain.

OIDC punya beberapa spesifikasi terkait:

- RP-Initiated Logout,
- Front-Channel Logout,
- Back-Channel Logout,
- Session Management.

Mental model:

```text
Local logout logs out this application.
IdP logout logs out identity provider session.
Front-channel/back-channel logout propagate logout to relying parties.
```

### 10.3 RP-Initiated Logout

Aplikasi sebagai Relying Party mengarahkan browser ke logout endpoint IdP.

Parameter umum:

```text
id_token_hint
post_logout_redirect_uri
state
client_id
```

Flow:

```text
1. User clicks logout in RP.
2. RP invalidates local session or marks logout in progress.
3. RP redirects browser to OP end_session_endpoint.
4. OP logs out user / asks confirmation.
5. OP redirects to post_logout_redirect_uri.
6. RP shows logged-out page.
```

Important invariant:

```text
Do not rely only on IdP redirect to clear local session.
Clear local session deterministically.
```

### 10.4 Front-channel logout

IdP notifies RPs through browser-loaded URLs/iframes.

Kelemahan:

- bergantung browser,
- third-party cookie restrictions bisa mengganggu,
- iframe blocking/security headers bisa mengganggu,
- user menutup browser sebelum selesai,
- unreliable untuk critical cleanup.

### 10.5 Back-channel logout

IdP mengirim server-to-server logout notification ke RP.

Kelebihan:

- tidak bergantung browser,
- lebih reliable untuk server-side session cleanup.

Tantangan:

- RP harus bisa map logout token/session id ke local session,
- distributed session store harus mendukung invalidation,
- perlu validasi signature/issuer/audience/event.

### 10.6 Logout di aplikasi enterprise multi-app

Misalnya:

```text
ACEAS <-> CPDS app switcher
same IdP / SSO
separate app sessions
possibly separate domains/paths
```

Logout policy harus jelas:

| User action | Expected behavior |
|---|---|
| Logout dari ACEAS | hanya ACEAS atau semua aplikasi? |
| Session timeout ACEAS | apakah CPDS ikut logout? |
| IdP global logout | apakah semua app session invalid? |
| Role revoked di IdP | apakah session aktif langsung kehilangan akses? |

Tanpa policy eksplisit, implementasi biasanya inkonsisten.

---

## 11. Expiring Cookies Saat Logout

Invalidate session di server tidak selalu cukup untuk membersihkan cookie di browser. Browser akan tetap menyimpan cookie sampai expired, walaupun server sudah tidak menerima session id itu.

Untuk menghapus cookie:

```java
Cookie cookie = new Cookie("JSESSIONID", "");
cookie.setPath(request.getContextPath().isEmpty() ? "/" : request.getContextPath());
cookie.setMaxAge(0);
cookie.setSecure(true);
cookie.setHttpOnly(true);
response.addCookie(cookie);
```

Jebakan penting:

```text
Cookie deletion must match original cookie name, path, and domain.
```

Jika cookie dibuat dengan:

```http
Set-Cookie: JSESSIONID=abc; Path=/aceas; Domain=example.com
```

Maka deletion harus match `Path=/aceas` dan `Domain=example.com`.

Jika tidak match, browser menganggapnya cookie berbeda dan cookie lama tetap ada.

---

## 12. Concurrent Session Control

Pertanyaan design:

```text
Bolehkah satu user login dari banyak browser/device bersamaan?
```

Pilihan:

### 12.1 Allow multiple sessions

Kelebihan:

- UX fleksibel,
- cocok untuk banyak enterprise user,
- tidak mengganggu multi-device.

Risiko:

- stolen session lebih sulit dideteksi,
- role revocation harus invalidate banyak session,
- audit harus bisa membedakan session/device.

### 12.2 One active session per user

Kelebihan:

- lebih sederhana untuk beberapa risk model,
- mengurangi stale session.

Risiko:

- UX buruk,
- browser tab/device conflict,
- race saat login bersamaan,
- distributed invalidation lebih rumit.

### 12.3 Risk-based concurrent session

Lebih realistis:

```text
Normal user        : multiple sessions allowed
Admin user         : limited sessions
Break-glass admin  : single session + short TTL + MFA
Service account    : no browser session
```

Data model:

```sql
CREATE TABLE USER_SESSION_REGISTRY (
    SESSION_ID_HASH      VARCHAR2(128) PRIMARY KEY,
    USER_ID              VARCHAR2(128) NOT NULL,
    TENANT_ID            VARCHAR2(128),
    CREATED_AT           TIMESTAMP NOT NULL,
    LAST_SEEN_AT         TIMESTAMP NOT NULL,
    EXPIRES_AT           TIMESTAMP,
    IP_ADDRESS_HASH      VARCHAR2(128),
    USER_AGENT_HASH      VARCHAR2(128),
    ASSURANCE_LEVEL      VARCHAR2(32),
    REVOKED_AT           TIMESTAMP,
    REVOKED_REASON       VARCHAR2(256)
);
```

Jangan simpan raw session id kalau tidak perlu. Simpan hash.

---

## 13. Role Changed Mid-Session

Problem:

```text
User login at 09:00 with ROLE_APPROVER.
At 10:00 admin removes ROLE_APPROVER.
At 10:05 user still has active session.
Can user approve?
```

Ada beberapa strategi.

### 13.1 Role snapshot until session expiry

Role dievaluasi saat login, lalu disimpan di session.

Kelebihan:

- cepat,
- sederhana,
- stabil sepanjang session.

Kekurangan:

- revocation lambat efektif,
- tidak cocok untuk high-risk role.

### 13.2 Role checked live on every request/action

Role dibaca dari DB/IdP/cache tiap request/action.

Kelebihan:

- revocation cepat,
- lebih akurat.

Kekurangan:

- latency,
- availability dependency,
- cache complexity.

### 13.3 Versioned authorization snapshot

Saat login, session menyimpan `authorizationVersion`.

User/account/tenant menyimpan current version.

Jika version berubah, session dipaksa refresh/relogin/reenrich.

```java
if (!sessionAuthVersion.equals(user.currentAuthVersion())) {
    session.invalidate();
    throw new ReauthenticationRequiredException();
}
```

Ini sering menjadi trade-off bagus.

### 13.4 High-risk action always live-check

Untuk action sensitif, jangan hanya percaya role snapshot.

```java
authorizationService.checkLive(actor, APPROVE_CASE, caseRecord);
```

Practical recommendation:

```text
Use session snapshot for coarse UI convenience.
Use live/versioned authorization for high-risk domain action.
```

---

## 14. Session Freshness vs Permission Freshness

Ada dua freshness berbeda:

```text
Session freshness:
    Apakah login masih cukup baru?

Permission freshness:
    Apakah role/permission yang dipakai masih valid?
```

Contoh:

```text
User baru login 2 menit lalu.
Tapi role approver baru saja dicabut.

Session fresh, permission stale.
```

Contoh lain:

```text
Role masih valid.
Tapi user login 7 jam lalu dan ingin mengubah bank account.

Permission valid, session not fresh enough for sensitive action.
```

Top-level engineer harus memisahkan keduanya.

---

## 15. Session in Clustered Jakarta Applications

Aplikasi production biasanya berjalan di banyak node.

```text
Browser
  |
  v
Load Balancer
  |---------- Node A
  |---------- Node B
  |---------- Node C
```

Masalah:

```text
Request 1 masuk Node A -> session dibuat di Node A
Request 2 masuk Node B -> Node B tidak tahu session
```

Solusi:

1. sticky session,
2. session replication,
3. external session store,
4. stateless token-based auth,
5. BFF hybrid.

### 15.1 Sticky session

Load balancer mengarahkan client yang sama ke node yang sama.

Kelebihan:

- sederhana,
- tidak perlu replicate banyak session.

Kekurangan:

- node failure menghilangkan session,
- uneven load,
- deployment/rolling restart bisa logout user,
- tidak cukup untuk back-channel logout global.

### 15.2 Session replication

Container mereplikasi session antar node.

Kelebihan:

- failover lebih baik.

Kekurangan:

- serialisasi object,
- memory/network overhead,
- object version compatibility saat rolling deploy,
- large session disaster,
- stale replication race.

### 15.3 External session store

Session disimpan di Redis/database/distributed cache.

Kelebihan:

- shared across nodes,
- invalidation lebih mudah,
- rolling restart lebih aman.

Kekurangan:

- external dependency,
- latency,
- serialization security,
- operational complexity,
- harus proteksi data at rest/in transit.

### 15.4 Stateless token

Tidak menyimpan session server-side; setiap request membawa token.

Kelebihan:

- scalable,
- cocok API.

Kekurangan:

- revocation sulit,
- token theft berdampak sampai expiry,
- logout tidak langsung invalid kecuali ada denylist/introspection,
- browser storage risk.

Untuk web enterprise app, server-side session sering tetap lebih aman dan manageable daripada menyimpan token di browser.

---

## 16. Principal Serialization dan Session Replication

Jika session direplikasi, object di session mungkin harus serializable.

Anti-pattern:

```java
session.setAttribute("user", entityManager.find(User.class, id));
```

Masalah:

- JPA entity attached/detached confusion,
- lazy loading failure,
- serialization besar,
- sensitive fields ikut tersimpan,
- schema/class version berubah saat deploy.

Lebih baik:

```java
public record SessionActorSnapshot(
    String userId,
    String username,
    String tenantId,
    String displayName,
    String authVersion,
    Instant authenticatedAt,
    String assuranceLevel
) implements Serializable {}
```

Simpan minimal snapshot, bukan full entity.

---

## 17. URL Rewriting dan Session ID Leakage

Servlet historically mendukung URL rewriting untuk session tracking:

```text
/app/page;jsessionid=ABC123
```

Risiko:

- session id muncul di browser history,
- log server/proxy,
- Referer header,
- screenshot,
- copy-paste URL,
- analytics.

Untuk aplikasi modern enterprise:

```text
Disable URL-based session tracking where possible.
Use cookie-only session tracking.
```

Contoh `web.xml`:

```xml
<session-config>
    <tracking-mode>COOKIE</tracking-mode>
</session-config>
```

---

## 18. CSRF dan Session Cookie

Jika browser otomatis mengirim session cookie, maka cross-site request dapat membawa session user.

Contoh:

```html
<form action="https://app.example.com/case/approve" method="POST">
  <input name="caseId" value="123" />
</form>
<script>document.forms[0].submit()</script>
```

Jika user sedang login dan cookie terkirim, server bisa melihat request sebagai authenticated.

Defense:

- CSRF token untuk state-changing request,
- SameSite cookie,
- Origin/Referer validation,
- require JSON + custom header untuk API tertentu,
- reauthentication untuk high-risk action.

Important invariant:

```text
Cookie session authentication must be paired with CSRF defense for state-changing browser requests.
```

CSRF akan dibahas lebih besar di Part 26, tetapi di Part 15 perlu dipahami karena akar risikonya adalah session cookie yang otomatis dikirim browser.

---

## 19. Browser Back Button Setelah Logout

Masalah umum:

```text
User logout.
Browser back button menampilkan halaman sebelumnya.
```

Kadang itu hanya browser cache, bukan session masih valid.

Tetapi dari UX/security, halaman sensitive tidak boleh mudah terlihat setelah logout.

Header:

```http
Cache-Control: no-store
Pragma: no-cache
Expires: 0
```

Untuk protected pages:

```java
response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
response.setHeader("Pragma", "no-cache");
response.setDateHeader("Expires", 0);
```

Namun jangan gunakan cache header sebagai authorization. Server tetap harus reject request setelah session invalid.

---

## 20. Remember-Me: Low Assurance, Bukan Full Login

Remember-me biasanya berarti:

```text
User menutup browser.
Nanti datang lagi.
Aplikasi dapat membuat session baru tanpa user memasukkan password lagi.
```

Risiko:

- token long-lived,
- device theft,
- cookie theft,
- shared computer,
- revocation complexity.

Safe design:

```text
Remember-me token should not be the same as session id.
Remember-me should be revocable.
Remember-me should rotate after use.
Remember-me should be stored hashed server-side.
Remember-me should create low-assurance session.
Sensitive action should require reauthentication/MFA.
```

Data model:

```sql
CREATE TABLE REMEMBER_ME_TOKEN (
    SERIES_ID          VARCHAR2(128) PRIMARY KEY,
    TOKEN_HASH         VARCHAR2(256) NOT NULL,
    USER_ID            VARCHAR2(128) NOT NULL,
    DEVICE_LABEL       VARCHAR2(256),
    CREATED_AT         TIMESTAMP NOT NULL,
    LAST_USED_AT       TIMESTAMP,
    EXPIRES_AT         TIMESTAMP NOT NULL,
    REVOKED_AT         TIMESTAMP
);
```

Cookie:

```http
Set-Cookie: REMEMBER_ME=<series>:<token>; Max-Age=1209600; Secure; HttpOnly; SameSite=Lax
```

On use:

1. parse series/token,
2. hash token,
3. compare to server hash,
4. if valid, rotate token,
5. create new session with low assurance,
6. log event.

If token mismatch for existing series:

```text
Possible token theft/replay. Revoke all remember-me tokens for user or device family.
```

---

## 21. Session Hijacking Detection

Session hijacking detection is probabilistic. Jangan terlalu agresif sampai false positive tinggi.

Signals:

- impossible travel,
- sudden IP ASN/country change,
- user-agent change,
- device fingerprint change,
- high-risk action from unusual context,
- concurrent active sessions from unusual locations,
- session used after logout event,
- CSRF token mismatch spike.

Caution:

```text
IP changes can be normal in mobile/corporate/VPN environments.
User-Agent can change due to browser update.
Fingerprinting can be privacy-invasive.
```

Practical response:

- require reauthentication,
- step-up MFA,
- notify user/admin,
- revoke session,
- lock only if high confidence.

---

## 22. Session Registry Pattern

A session registry tracks active sessions independently from `HttpSession` memory.

Use cases:

- admin can revoke user sessions,
- logout all devices,
- role change invalidates sessions,
- audit active sessions,
- back-channel logout mapping,
- detect concurrent sessions.

Minimal abstraction:

```java
public interface SessionRegistry {
    void register(SessionRecord record);
    void touch(String sessionIdHash, Instant now);
    void revoke(String sessionIdHash, String reason, Instant now);
    boolean isRevoked(String sessionIdHash);
    List<SessionRecord> findActiveByUser(String userId);
    void revokeAllForUser(String userId, String reason, Instant now);
}
```

Filter:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {

    HttpServletRequest request = (HttpServletRequest) req;
    HttpServletResponse response = (HttpServletResponse) res;

    HttpSession session = request.getSession(false);
    if (session != null) {
        String sessionIdHash = hash(session.getId());
        if (sessionRegistry.isRevoked(sessionIdHash)) {
            session.invalidate();
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        sessionRegistry.touch(sessionIdHash, Instant.now());
    }

    chain.doFilter(req, res);
}
```

Important:

```text
Do not store raw session id in registry if avoidable.
Hash it with appropriate keyed hashing/HMAC if matching is needed.
```

---

## 23. Logout Audit Events

Logout bukan cuma UX event. Ia adalah security lifecycle event.

Audit fields:

```text
EVENT_TYPE: LOGOUT
USER_ID
SESSION_ID_HASH
TENANT_ID
INITIATOR: USER / ADMIN / SYSTEM / IDP_BACKCHANNEL / TIMEOUT
REASON: USER_CLICK / IDLE_TIMEOUT / ABSOLUTE_TIMEOUT / ROLE_REVOKED / GLOBAL_LOGOUT / SUSPICIOUS_ACTIVITY
IP_ADDRESS_HASH
USER_AGENT_HASH
CORRELATION_ID
TIMESTAMP
RESULT: SUCCESS / PARTIAL / FAILED
```

Untuk SSO:

```text
LOCAL_LOGOUT_COMPLETED
IDP_LOGOUT_INITIATED
IDP_LOGOUT_CALLBACK_RECEIVED
BACKCHANNEL_LOGOUT_RECEIVED
SESSION_REVOKED_BY_BACKCHANNEL
```

Kenapa penting?

- forensic timeline,
- incident response,
- compliance,
- dispute resolution,
- support troubleshooting.

---

## 24. 401 vs Redirect to Login

Browser page dan API beda perilaku.

Untuk HTML page:

```text
Unauthenticated -> redirect to login
```

Untuk API:

```text
Unauthenticated -> 401 JSON / WWW-Authenticate
```

Jangan redirect API ke HTML login page secara membabi buta. SPA/API akan menerima HTML dan error jadi aneh.

Pattern:

```java
boolean apiRequest = request.getRequestURI().startsWith("/api/")
        || "XMLHttpRequest".equals(request.getHeader("X-Requested-With"))
        || Optional.ofNullable(request.getHeader("Accept")).orElse("").contains("application/json");

if (apiRequest) {
    response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
} else {
    response.sendRedirect(loginUrl);
}
```

Part 27 akan membahas error semantics lebih dalam.

---

## 25. Session Security in OIDC-Based Jakarta Application

OIDC web login biasanya menghasilkan local app session.

Flow ideal:

```text
1. User accesses Jakarta app.
2. App redirects to OP authorization endpoint.
3. User authenticates at OP.
4. OP redirects to app callback with code.
5. App exchanges code for tokens server-side.
6. App validates ID token.
7. App maps identity/claims/groups.
8. App creates local HttpSession.
9. Browser stores only app session cookie.
```

Local session state may include:

```text
subject
issuer
session id from OP if available
id token hash or reference
access token reference if needed
refresh token reference if needed
claims snapshot
role mapping version
auth_time
acr/amr
```

Avoid:

- storing raw tokens in browser localStorage,
- treating ID token as app session,
- treating OIDC OP session as same as app session,
- ignoring `auth_time` for sensitive action,
- failing to validate issuer/audience/nonce.

Logout mapping:

```text
App session id <-> OP sid claim / subject / client session
```

If OP sends back-channel logout, app must find and revoke local sessions.

---

## 26. Session Timeout vs Token Expiry

In OIDC apps, there are multiple clocks:

```text
Local HttpSession idle timeout
Local absolute session timeout
ID token exp
Access token exp
Refresh token exp
OP SSO session timeout
OP idle timeout
Remember-me token expiry
```

Common bug:

```text
Local session still alive but access token expired.
Downstream API calls fail unexpectedly.
```

Another bug:

```text
Access token refreshed forever while local session policy says user should be logged out.
```

Design rule:

```text
Define which clock is authoritative for interactive login lifetime.
```

Example:

```text
Interactive app session absolute max: 8 hours
Access token: 5 minutes
Refresh token: allowed only while local session valid and OP policy allows
Step-up freshness for approval: 5 minutes
```

---

## 27. Admin Session Revocation

Enterprise systems need admin/session revocation:

- user leaves organization,
- role removed,
- account compromised,
- admin demoted,
- device lost,
- suspicious login.

Operation:

```java
sessionRegistry.revokeAllForUser(userId, "ADMIN_REVOKE", now);
```

But if sessions are only in container memory and no registry exists, revocation across cluster becomes hard.

Better model:

```text
Every request checks a revocation/version marker.
```

Options:

- session registry revoke flag,
- user `sessionVersion`,
- authz version mismatch,
- distributed cache denylist,
- short session TTL + forced refresh.

---

## 28. Session and Tenant Switching

Multi-tenant users may switch active organization/tenant.

Example:

```text
User belongs to Agency A and Agency B.
Current session activeTenant = Agency A.
User switches to Agency B.
```

Rules:

1. active tenant must be explicit,
2. tenant switch must verify membership,
3. tenant switch may need new authorization snapshot,
4. CSRF protection required,
5. audit tenant switch,
6. clear tenant-scoped UI/session cache,
7. avoid mixing data from old tenant.

Example:

```java
public void switchTenant(Actor actor, String requestedTenantId, HttpSession session) {
    if (!membershipService.isMember(actor.userId(), requestedTenantId)) {
        throw new ForbiddenException();
    }

    session.setAttribute("ACTIVE_TENANT_ID", requestedTenantId);
    session.setAttribute("TENANT_SWITCHED_AT", Instant.now());
    session.removeAttribute("CACHED_MENU");
    session.removeAttribute("CACHED_PERMISSION_SUMMARY");

    audit.logTenantSwitch(actor.userId(), requestedTenantId);
}
```

Never trust tenant solely from UI hidden field.

---

## 29. Session and Authorization Cache

Authorization checks can be expensive. Caching may be needed.

But cache scope matters.

Bad:

```text
Cache all permissions in session forever.
```

Better:

```text
Cache small permission summary with version and short TTL.
```

Example:

```java
public record PermissionSnapshot(
    String userId,
    String tenantId,
    String authzVersion,
    Set<String> coarsePermissions,
    Instant loadedAt,
    Instant expiresAt
) implements Serializable {}
```

Before use:

```java
if (snapshot.expiresAt().isBefore(now) || !snapshot.authzVersion().equals(currentVersion)) {
    snapshot = permissionService.reload(userId, tenantId);
}
```

For high-risk action, prefer live check.

---

## 30. Security Context and Session Context Are Not Identical

`SecurityContext` represents current caller security state exposed to application code.

`HttpSession` represents per-client continuity state.

They overlap but are not the same.

```text
SecurityContext:
    Who is the caller for this request?
    Is caller in role?
    Can caller access web resource?

HttpSession:
    What state is associated with this browser continuity?
    When did login happen?
    Which tenant is active?
    What CSRF token is current?
```

Do not use session as replacement for container security context.

Do not use security context as generic session storage.

---

## 31. Secure Session Configuration Examples

### 31.1 `web.xml` baseline

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_0.xsd"
         version="6.0">

    <session-config>
        <session-timeout>15</session-timeout>
        <tracking-mode>COOKIE</tracking-mode>
        <cookie-config>
            <http-only>true</http-only>
            <secure>true</secure>
            <name>JSESSIONID</name>
            <path>/aceas</path>
        </cookie-config>
    </session-config>

</web-app>
```

Note:

- SameSite support may be container-specific or set via response header/proxy depending environment.
- For Jakarta Servlet version, schema version must match target platform.

### 31.2 Programmatic session timeout

```java
HttpSession session = request.getSession(true);
session.setMaxInactiveInterval(Duration.ofMinutes(15).toSecondsPart()); // careful: wrong for >60 min
```

Better:

```java
session.setMaxInactiveInterval((int) Duration.ofMinutes(15).getSeconds());
```

### 31.3 Safe session creation

Avoid creating sessions unnecessarily:

```java
HttpSession session = request.getSession(false);
if (session == null) {
    response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
    return;
}
```

`getSession(true)` creates a session. Do not call it in every public/static request unless needed.

---

## 32. Common Production Bugs

### Bug 1 — Session cookie not `Secure` behind TLS terminator

Cause:

```text
Container sees HTTP because proxy-to-backend is HTTP.
```

Fix:

- configure forwarded headers,
- configure container proxy awareness,
- force secure cookie,
- HSTS at edge.

### Bug 2 — Logout invalidates session but cookie still appears

This may be normal because browser still sends stale cookie, but server creates new anonymous session.

Need verify:

- old session invalidated,
- cookie deletion path/domain match,
- app not auto-creating session on logged-out page.

### Bug 3 — User logged out in one tab but another tab still works

Causes:

- session not invalidated server-side,
- logout only cleared client state,
- SPA cached token,
- API accepts token not tied to session.

### Bug 4 — Role removed but user still has access

Causes:

- role snapshot stored in session,
- token contains old roles until expiry,
- no authz version check,
- no session revocation.

### Bug 5 — Back-channel logout received but session not found

Causes:

- no mapping from OP `sid` to local session,
- session id stored only in one node memory,
- session registry missing,
- token validation failure ignored.

### Bug 6 — Session lost after deployment

Causes:

- in-memory session,
- no sticky session,
- rolling deploy changed serialized class,
- session replication failure,
- external store flushed.

### Bug 7 — Login loop

Causes:

- cookie path/domain wrong,
- SameSite incompatible with login flow,
- Secure cookie not sent over perceived HTTP,
- callback path protected incorrectly,
- session created on one node but next request goes another node.

---

## 33. Design Pattern: Session Boundary Service

Instead of scattering session logic everywhere, create a boundary service.

```java
public interface SessionBoundary {
    void establishAuthenticatedSession(HttpServletRequest request, Actor actor, AuthMetadata metadata);
    ActorSession requireSession(HttpServletRequest request);
    void switchTenant(HttpServletRequest request, String tenantId);
    void requireFreshAuthentication(HttpServletRequest request, Duration maxAge);
    void logout(HttpServletRequest request, HttpServletResponse response, LogoutReason reason);
}
```

Implementation responsibilities:

- regenerate session id after login,
- set login timestamps,
- store minimal actor snapshot,
- register session,
- enforce absolute timeout,
- enforce revocation,
- clear tenant-scoped cache,
- emit audit events,
- delete cookies on logout.

This keeps session behavior consistent.

---

## 34. Design Pattern: Actor Session Snapshot

```java
public record ActorSession(
    String userId,
    String username,
    String displayName,
    String issuer,
    String subject,
    String activeTenantId,
    String authzVersion,
    String assuranceLevel,
    Instant authenticatedAt,
    Instant lastStrongAuthAt,
    Instant expiresAt
) implements Serializable {

    public boolean isAbsoluteExpired(Instant now) {
        return expiresAt != null && !expiresAt.isAfter(now);
    }

    public boolean hasRecentStrongAuth(Duration maxAge, Instant now) {
        return lastStrongAuthAt != null && lastStrongAuthAt.plus(maxAge).isAfter(now);
    }
}
```

Session attribute:

```java
session.setAttribute("ACTOR_SESSION", actorSession);
```

Do not put password/token/raw credential here.

---

## 35. Design Pattern: Logout Orchestrator

Logout often crosses multiple systems.

```java
public final class LogoutOrchestrator {
    public void logout(HttpServletRequest request,
                       HttpServletResponse response,
                       LogoutMode mode) {
        ActorSession actorSession = readActorSession(request);

        auditLocalLogoutStarted(actorSession, mode);
        revokeLocalSession(request, actorSession);
        clearCookies(request, response);

        if (mode == LogoutMode.GLOBAL_OIDC) {
            redirectToOidcLogout(response, actorSession);
        } else {
            redirectToLoggedOutPage(response);
        }
    }
}
```

Important behavior:

- local session invalidation must happen even if IdP logout fails,
- IdP logout failure should be visible/audited,
- post-logout redirect must be allowlisted,
- logout endpoint should be CSRF-protected or use safe design,
- avoid open redirect.

---

## 36. Session Security Checklist

### 36.1 Cookie checklist

```text
[ ] Session cookie has Secure.
[ ] Session cookie has HttpOnly.
[ ] SameSite is explicitly decided and tested.
[ ] Cookie Path is minimal.
[ ] Cookie Domain is host-only unless needed.
[ ] URL rewriting disabled for authenticated app.
[ ] Cookie deletion matches name/path/domain.
[ ] Reverse proxy preserves original scheme correctly.
```

### 36.2 Timeout checklist

```text
[ ] Idle timeout defined.
[ ] Absolute timeout defined.
[ ] Sensitive action freshness defined.
[ ] Remember-me lifetime separated from session lifetime.
[ ] Token expiry policy aligned with session policy.
[ ] Timeout events audited.
```

### 36.3 Login checklist

```text
[ ] Session id changes after authentication.
[ ] Anonymous session data copied carefully.
[ ] AuthenticatedAt stored.
[ ] Authz version stored.
[ ] Assurance level stored if needed.
[ ] Session registry updated.
[ ] Login event audited.
```

### 36.4 Authorization freshness checklist

```text
[ ] Role changes invalidate or refresh sessions.
[ ] High-risk action uses live/versioned authorization.
[ ] Tenant switch clears tenant-scoped cache.
[ ] Session snapshot is not final permission authority.
[ ] Admin revocation exists.
```

### 36.5 Logout checklist

```text
[ ] Local session invalidated.
[ ] Container logout called where applicable.
[ ] Cookies expired with correct path/domain.
[ ] OIDC logout behavior defined.
[ ] Back-channel logout supported if required.
[ ] Logout audited.
[ ] Browser cache protected for sensitive pages.
[ ] Post-logout redirect allowlisted.
```

### 36.6 Cluster checklist

```text
[ ] Sticky/replication/external store decision documented.
[ ] Session object is serializable and minimal.
[ ] Rolling deployment session compatibility considered.
[ ] Session registry works across nodes.
[ ] Back-channel/global revocation reaches all nodes.
[ ] External session store secured.
```

---

## 37. Testing Strategy

### 37.1 Session fixation test

Test:

```text
1. Access public page and obtain JSESSIONID A.
2. Login.
3. Verify JSESSIONID changed to B.
4. Verify A cannot access protected resource.
```

### 37.2 Cookie attribute test

Verify `Set-Cookie` contains expected attributes:

```text
Secure
HttpOnly
SameSite
Path
Domain absence/presence as intended
```

### 37.3 Logout test

```text
1. Login.
2. Access protected resource -> 200.
3. Logout.
4. Reuse same session cookie -> 401/redirect login.
5. Back button does not retrieve sensitive data from server.
```

### 37.4 Role revocation test

```text
1. Login as approver.
2. Verify approve allowed.
3. Remove approver role.
4. Verify approve denied without waiting for natural session timeout.
```

Expected behavior depends design, but must be explicit.

### 37.5 Cluster failover test

```text
1. Login through LB.
2. Hit Node A.
3. Kill Node A.
4. Hit Node B.
5. Verify expected behavior: session survives or user relogs in cleanly.
```

### 37.6 OIDC logout test

```text
1. Login via OP.
2. Logout RP local only.
3. Verify OP session expected behavior.
4. Logout via RP-initiated logout.
5. Verify local and OP behavior.
6. Send valid back-channel logout.
7. Verify local session revoked.
```

---

## 38. Java 8 sampai Java 25 Considerations

### Java 8 era

- Java EE 7/8 and `javax.servlet` common.
- Servlet 3.x/4.x depending container.
- Session handling mostly same conceptually.
- `SameSite` may require manual header/proxy/container-specific support.

### Java 11/17 era

- Jakarta EE migration increasingly relevant.
- Containers modernize session cookie support.
- Cloud/Kubernetes deployment makes sticky vs distributed session critical.

### Java 21+ era

- Virtual threads change request execution model in some servers/frameworks.
- Do not assume ThreadLocal security/session context propagates into arbitrary async work.
- Session remains request/browser continuity, not thread continuity.

### Java 25 era

- Same enterprise principles remain.
- Most differences come from container/spec version, not Java language itself.
- Verify target Jakarta EE runtime compatibility.

Key point:

```text
Session security is primarily Servlet/container/browser/protocol behavior, not Java syntax behavior.
```

---

## 39. Reference Architecture: Secure Session for Jakarta Web App

```text
Browser
  |
  | HTTPS + Secure HttpOnly SameSite cookie
  v
Reverse Proxy / ALB
  |
  | forwarded proto/host configured
  v
Jakarta Web Container
  |
  | Servlet security / Jakarta Security / OIDC mechanism
  v
Session Boundary Service
  |-- change session id after login
  |-- store minimal actor snapshot
  |-- register session hash
  |-- enforce idle/absolute timeout
  |-- check revocation/version
  |-- clear on logout
  v
Authorization Service
  |-- live check for sensitive actions
  |-- tenant/state/resource relationship
  v
Audit Service
  |-- login/logout/session revoke/timeout/step-up
  v
Session Registry / Distributed Store
```

Core invariants:

```text
1. Session id is secret.
2. Session id changes after login.
3. Session lifetime is bounded.
4. Session does not replace authorization.
5. Role/permission freshness is handled explicitly.
6. Logout invalidates server-side state.
7. Cookie attributes are deliberate.
8. Cluster behavior is designed, not accidental.
9. High-risk action requires fresh assurance.
10. Every security lifecycle event is auditable.
```

---

## 40. Final Mental Model

Session security is the art of managing **authenticated continuity**.

Authentication proves identity at a point in time.

Session preserves that proof across requests.

Authorization decides what that identity can do now.

Logout destroys or revokes continuity.

A mature enterprise Java/Jakarta engineer should not think:

```text
Login success -> store user in session -> done.
```

Think instead:

```text
Login establishes a bounded, revocable, auditable continuity context.
Each request restores that context.
Each sensitive action checks current authority.
Each session has explicit timeout, freshness, cookie, propagation, and logout semantics.
```

That is the difference between a login feature and a security subsystem.

---

## 41. Part Summary

Dalam Part 15, kita membahas:

- session as continuity state,
- `HttpSession`,
- session cookie as bearer artifact,
- `Secure`, `HttpOnly`, `SameSite`, `Path`, `Domain`, `Max-Age`,
- session fixation,
- idle timeout,
- absolute timeout,
- step-up authentication,
- session vs token,
- local/global/OIDC logout,
- front-channel/back-channel logout,
- cookie expiry,
- concurrent session,
- role change mid-session,
- cluster/distributed session,
- URL rewriting risk,
- CSRF relationship,
- remember-me,
- session registry,
- tenant switching,
- authorization cache,
- production bugs,
- design patterns,
- testing strategy,
- Java 8–25 considerations.

---

## 42. References

- Jakarta Servlet Specification — session, cookies, `HttpSession`, session tracking, `SessionCookieConfig`.
- Jakarta Servlet API — `HttpSession`, `HttpServletRequest`, `Cookie`.
- Jakarta Security 4.0 Specification — authentication mechanisms, remember-me concepts, `SecurityContext`.
- OpenID Connect RP-Initiated Logout 1.0.
- OpenID Connect Front-Channel Logout 1.0.
- OpenID Connect Back-Channel Logout 1.0.
- OWASP Session Management Cheat Sheet.
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet.
- OWASP Authentication Cheat Sheet.

---

## 43. Status Seri

Selesai:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
Part 06 — Jakarta Security API Core
Part 07 — SecurityContext Deep Dive
Part 08 — IdentityStore Deep Dive
Part 09 — Credentials and Password Handling in Jakarta Applications
Part 10 — Jakarta Authentication / JASPIC Deep Dive
Part 11 — Jakarta Authorization / JACC Deep Dive
Part 12 — Declarative Authorization: URL, Method, Class, Role
Part 13 — Programmatic Authorization and Domain Permission Design
Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
Part 15 — Session Security: Login State, HttpSession, Cookies, Logout
```

Berikutnya:

```text
Part 16 — Token-Based Security in Jakarta Applications
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning](./learn-java-jakarta-security-authentication-authorization-identity-part-14-roles-groups-claims-scopes-authorities-mapping.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — Token-Based Security in Jakarta Applications](./learn-java-jakarta-security-authentication-authorization-identity-part-16-token-based-security.md)
