# Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization

**Series:** `learn-java-jakarta-security-authentication-authorization-identity`  
**File:** `learn-java-jakarta-security-authentication-authorization-identity-part-04-servlet-security-foundation.md`  
**Scope:** Java 8–25, Java EE `javax.servlet.*`, Jakarta EE `jakarta.servlet.*`, Servlet Security, Authentication, Authorization, Roles, Sessions, URL Constraints  
**Prerequisite:** Part 00–03

---

## 0. Why This Part Matters

Servlet Security adalah salah satu fondasi paling penting dalam security aplikasi Java enterprise karena hampir semua security web-tier Jakarta/Java EE pada akhirnya melewati request HTTP yang diproses oleh **Servlet container**.

Walaupun aplikasi modern sering memakai JAX-RS, MVC, JSF, framework internal, gateway, reverse proxy, atau Spring-style abstraction, web request lifecycle tetap sering berakhir pada model seperti ini:

```text
HTTP request
   ↓
connector / proxy integration
   ↓
Servlet container
   ↓
security constraint matching
   ↓
authentication mechanism
   ↓
caller principal + roles/groups established
   ↓
filters
   ↓
servlet / JAX-RS dispatcher / framework endpoint
   ↓
method/domain authorization
   ↓
response
```

Tujuan Part 04 bukan hanya membuat kamu tahu `web.xml`, `@ServletSecurity`, atau `request.isUserInRole()`. Tujuan lebih pentingnya adalah membentuk mental model:

> Servlet security adalah **container-level web access control contract**: ia menentukan request mana yang perlu authenticated, role apa yang boleh masuk, transport security apa yang wajib, dan bagaimana caller identity tersedia untuk application code.

Kalau mental model ini salah, aplikasi sering jatuh ke masalah klasik:

1. Endpoint terlihat dilindungi di UI, tetapi URL langsung masih bisa dipanggil.
2. API menganggap user authenticated karena ada session, padahal principal tidak terpasang di container.
3. `@RolesAllowed` tidak bekerja karena role tidak pernah dideklarasikan atau tidak pernah dipetakan.
4. Filter custom login membuat session sendiri, tetapi container tidak tahu user tersebut siapa.
5. Logout hanya menghapus attribute aplikasi, tetapi container principal masih hidup.
6. Form login redirect loop karena protected/unprotected path salah.
7. CORS/CSRF/session cookie dianggap bagian dari authentication, padahal layer-nya berbeda.
8. Authorization hanya berbasis URL, padahal resource/domain permission lebih kompleks.

Part ini membahas Servlet Security sebagai **web-tier enforcement boundary**.

---

## 1. Positioning Servlet Security in Jakarta/Java EE Security Stack

Dalam seri sebelumnya kita sudah memetakan bahwa security enterprise Java punya beberapa layer:

```text
Java SE security / JAAS primitives
    ↓
Jakarta Authentication / JASPIC SPI
    ↓
Jakarta Security API
    ↓
Servlet container security
    ↓
JAX-RS / CDI / EJB method security
    ↓
Domain authorization
```

Servlet Security berada di area:

```text
HTTP request boundary + URL/method access control + container web identity
```

Ia menjawab pertanyaan seperti:

1. Apakah request ke `/admin/*` boleh masuk tanpa login?
2. Apakah `POST /cases/*/approve` butuh role tertentu?
3. Apakah request harus lewat HTTPS?
4. Authentication mechanism apa yang dipakai untuk user browser?
5. Setelah login, siapa caller principal-nya?
6. Apakah caller berada dalam role tertentu menurut container?
7. Apa yang terjadi saat `request.logout()`?
8. Bagaimana session berubah setelah authentication?

Ia tidak menjawab seluruh domain authorization seperti:

1. Apakah officer A boleh approve case milik team B?
2. Apakah user boleh melihat document milik tenant lain?
3. Apakah maker boleh menjadi checker untuk transaksi yang sama?
4. Apakah user boleh edit case setelah state `SUBMITTED`?
5. Apakah delegation masih valid hari ini?

Untuk itu kita butuh domain authorization layer di atas Servlet Security. Tetapi Servlet Security tetap penting karena ia memberi **first line of enforcement**.

---

## 2. Java EE `javax.servlet` vs Jakarta `jakarta.servlet`

Secara konsep, banyak API Servlet Security stabil sejak era Java EE 6/7/8. Perubahan besar Jakarta adalah namespace:

```java
// Java EE / Jakarta EE 8 style
import javax.servlet.http.HttpServletRequest;

// Jakarta EE 9+ style
import jakarta.servlet.http.HttpServletRequest;
```

Contoh lain:

```java
// Java EE
import javax.servlet.annotation.ServletSecurity;
import javax.servlet.annotation.HttpConstraint;
import javax.servlet.annotation.HttpMethodConstraint;

// Jakarta EE
import jakarta.servlet.annotation.ServletSecurity;
import jakarta.servlet.annotation.HttpConstraint;
import jakarta.servlet.annotation.HttpMethodConstraint;
```

Mental model-nya sama:

```text
Java EE 8 / Jakarta EE 8
  package: javax.servlet.*

Jakarta EE 9+
  package: jakarta.servlet.*
```

Dalam materi ini, contoh utama akan memakai `jakarta.*`, tetapi konsepnya berlaku untuk `javax.*` dengan package migration.

---

## 3. Core Servlet Security Vocabulary

Sebelum masuk API, kita perlu vocabulary yang presisi.

### 3.1 Protected resource

Resource yang tidak boleh diakses bebas.

Contoh:

```text
/admin/*
/api/cases/*
/reports/download/*
```

Protected resource bisa berupa:

1. Servlet endpoint.
2. Static file.
3. JAX-RS endpoint di balik servlet dispatcher.
4. MVC route.
5. Download endpoint.
6. Callback endpoint tertentu.

### 3.2 Security constraint

Rule yang diterapkan terhadap URL pattern dan HTTP method.

Constraint biasanya menjawab:

```text
Untuk URL pattern ini dan method ini:
- apakah authentication diperlukan?
- role apa yang boleh?
- apakah transport harus confidential?
```

### 3.3 Web resource collection

Bagian dari constraint yang mendefinisikan target URL dan HTTP method.

Contoh mental:

```text
Target:
  URL pattern: /admin/*
  HTTP method: GET, POST, PUT, DELETE

Rule:
  roles allowed: ADMIN
  transport guarantee: CONFIDENTIAL
```

### 3.4 Authorization constraint

Bagian dari security constraint yang mendefinisikan role yang boleh.

Maknanya:

```text
Request boleh masuk jika caller authenticated dan memiliki role yang sesuai.
```

Jika authorization constraint ada tetapi tidak ada role, maka secara konsep request menjadi inaccessible untuk semua caller. Ini berguna untuk eksplisit menutup endpoint tertentu.

### 3.5 User data constraint

Constraint transport-level.

Biasanya:

```text
NONE
INTEGRAL
CONFIDENTIAL
```

Dalam praktik modern, `CONFIDENTIAL` berarti request harus lewat channel yang aman seperti HTTPS.

### 3.6 Login config

Konfigurasi authentication mechanism untuk web application.

Contoh mechanism historis:

```text
BASIC
FORM
CLIENT-CERT
DIGEST
```

Dalam Jakarta Security modern, mechanism bisa didefinisikan juga via annotation/CDI, misalnya Basic/Form/Custom Form/OIDC mechanism.

### 3.7 Security role

Role yang dikenal oleh aplikasi/container.

Contoh:

```text
ADMIN
OFFICER
SUPERVISOR
CASE_REVIEWER
```

Role perlu dipahami sebagai **application security contract**, bukan otomatis sama dengan IdP group.

### 3.8 Caller principal

Identity yang sudah ditetapkan container setelah authentication.

Di Servlet API, caller bisa diakses via:

```java
request.getUserPrincipal();
```

---

## 4. Servlet Security as Request Admission Control

Cara paling bersih memahami Servlet Security:

> Servlet Security memutuskan apakah HTTP request boleh masuk ke web resource sebelum business code memproses request tersebut.

Bayangkan security sebagai beberapa gate:

```text
Gate 0 — Network / TLS / Proxy
Gate 1 — Servlet URL/method security constraint
Gate 2 — Authentication mechanism
Gate 3 — Container role check
Gate 4 — Framework/JAX-RS/CDI method security
Gate 5 — Domain/object/state authorization
Gate 6 — Data access constraint
```

Servlet Security terutama bekerja di Gate 1–3.

Artinya, Servlet Security cocok untuk:

1. Semua `/admin/*` harus login.
2. Semua `/api/internal/*` hanya role `SYSTEM_CLIENT`.
3. Semua `/reports/*` hanya role `REPORT_VIEWER`.
4. Semua request sensitif wajib HTTPS.
5. Semua public static asset boleh anonymous.
6. Login page/error page tidak boleh protected oleh constraint yang menyebabkan loop.

Servlet Security tidak cukup untuk:

1. User boleh lihat case hanya jika assigned.
2. Supervisor boleh approve hanya jika bukan creator.
3. Officer boleh modify hanya jika state `DRAFT` atau `RETURNED`.
4. Tenant A tidak boleh akses tenant B.
5. Role `ADMIN` boleh semua kecuali conflict-of-interest.

---

## 5. Two Ways to Declare Servlet Security

Ada dua cara umum:

```text
1. Deployment descriptor: web.xml
2. Annotation: @ServletSecurity
```

Dalam aplikasi modern, annotation terasa lebih dekat ke code. Namun `web.xml` masih penting karena:

1. Banyak enterprise app lama masih memakainya.
2. Ia memberi centralized view untuk security URL map.
3. Ia bisa override/augment annotation tergantung container/deployment rules.
4. Ia sering dipakai pada aplikasi yang perlu environment-specific deployment.
5. Ia membantu memahami bagaimana container memodelkan security.

---

## 6. `web.xml` Security Constraint Model

Contoh dasar:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_1.xsd"
         version="6.1">

    <security-constraint>
        <web-resource-collection>
            <web-resource-name>Admin Area</web-resource-name>
            <url-pattern>/admin/*</url-pattern>
            <http-method>GET</http-method>
            <http-method>POST</http-method>
        </web-resource-collection>

        <auth-constraint>
            <role-name>ADMIN</role-name>
        </auth-constraint>

        <user-data-constraint>
            <transport-guarantee>CONFIDENTIAL</transport-guarantee>
        </user-data-constraint>
    </security-constraint>

    <login-config>
        <auth-method>FORM</auth-method>
        <form-login-config>
            <form-login-page>/login.xhtml</form-login-page>
            <form-error-page>/login-error.xhtml</form-error-page>
        </form-login-config>
    </login-config>

    <security-role>
        <role-name>ADMIN</role-name>
    </security-role>

</web-app>
```

Baca konfigurasi ini sebagai kalimat:

```text
Untuk request GET/POST ke /admin/*:
- caller harus authenticated,
- caller harus memiliki role ADMIN,
- request harus lewat transport confidential,
- jika belum authenticated, gunakan FORM login.
```

---

## 7. Security Constraint Anatomy

### 7.1 `web-resource-collection`

```xml
<web-resource-collection>
    <web-resource-name>Case Approval API</web-resource-name>
    <url-pattern>/api/cases/*</url-pattern>
    <http-method>POST</http-method>
</web-resource-collection>
```

Ini mendefinisikan area request.

Important:

1. URL pattern bukan regex bebas.
2. URL pattern mengikuti Servlet URL pattern rules.
3. HTTP method constraint sangat penting untuk API.
4. Jika method tidak dispesifikkan, constraint bisa berlaku untuk semua method tergantung bentuk deklarasi.

### 7.2 `auth-constraint`

```xml
<auth-constraint>
    <role-name>CASE_OFFICER</role-name>
    <role-name>SUPERVISOR</role-name>
</auth-constraint>
```

Ini berarti role yang allowed adalah union:

```text
CASE_OFFICER OR SUPERVISOR
```

Bukan:

```text
CASE_OFFICER AND SUPERVISOR
```

Servlet role constraint adalah role membership sederhana, bukan expression language kompleks.

### 7.3 Empty `auth-constraint`

Contoh:

```xml
<auth-constraint />
```

Secara mental, ini berarti:

```text
Protected but no role is allowed.
```

Ini bisa dipakai untuk menutup resource, tetapi berbahaya jika tidak sengaja.

### 7.4 No `auth-constraint`

Jika constraint tidak punya authorization constraint, maka request bisa diterima tanpa authentication untuk bagian authorization. Jangan samakan dengan “semua role boleh”.

Mental rule:

```text
No auth-constraint    → not requiring authentication for authorization
Empty auth-constraint → deny all
Role auth-constraint  → authenticated + role check
```

### 7.5 `user-data-constraint`

```xml
<user-data-constraint>
    <transport-guarantee>CONFIDENTIAL</transport-guarantee>
</user-data-constraint>
```

Transport guarantee mengikat channel. Dalam deployment di balik reverse proxy, ini sering menjadi tricky karena container mungkin melihat request internal HTTP dari proxy, bukan original HTTPS dari browser.

Jika proxy termination tidak dikonfigurasi dengan benar, container bisa salah menganggap request tidak confidential dan melakukan redirect loop.

---

## 8. URL Pattern Security

Servlet URL pattern punya model matching khusus.

Jenis pattern umum:

```text
Exact match:       /login
Path prefix:       /admin/*
Extension match:   *.jsp
Default mapping:   /
```

Contoh:

```xml
<url-pattern>/admin/*</url-pattern>
<url-pattern>/api/*</url-pattern>
<url-pattern>*.jsp</url-pattern>
```

Security implication:

1. `/admin/*` tidak sama dengan `/administrator/*`.
2. `/admin/*` harus dipikirkan bersama static asset di bawah `/admin/assets/*`.
3. Extension mapping seperti `*.jsp` bisa terlalu luas atau terlalu sempit.
4. Default mapping `/` bisa tanpa sengaja melindungi atau membuka banyak resource.
5. JAX-RS dispatcher sering memakai mapping `/api/*`; semua endpoint JAX-RS di bawahnya bisa dipengaruhi satu constraint.

---

## 9. HTTP Method Security

REST/API security tidak boleh hanya berpikir URL. Method penting.

Contoh:

```text
GET    /api/cases/123        read case
POST   /api/cases            create case
PUT    /api/cases/123        replace case
PATCH  /api/cases/123        update case
DELETE /api/cases/123        delete case
POST   /api/cases/123/approve approve case
```

URL bisa sama, tetapi action berbeda.

Contoh constraint:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Case Read</web-resource-name>
        <url-pattern>/api/cases/*</url-pattern>
        <http-method>GET</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>CASE_VIEWER</role-name>
        <role-name>CASE_OFFICER</role-name>
    </auth-constraint>
</security-constraint>

<security-constraint>
    <web-resource-collection>
        <web-resource-name>Case Mutation</web-resource-name>
        <url-pattern>/api/cases/*</url-pattern>
        <http-method>POST</http-method>
        <http-method>PUT</http-method>
        <http-method>PATCH</http-method>
        <http-method>DELETE</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>CASE_OFFICER</role-name>
    </auth-constraint>
</security-constraint>
```

Mental model:

```text
URL tells what resource family.
HTTP method tells what operation class.
Domain authorization tells exact object/action/state permission.
```

---

## 10. The Dangerous Gap: Uncovered HTTP Methods

Salah satu failure paling umum adalah hanya melindungi GET/POST tetapi lupa method lain.

Contoh:

```xml
<http-method>GET</http-method>
<http-method>POST</http-method>
```

Bagaimana dengan:

```text
PUT
PATCH
DELETE
OPTIONS
HEAD
TRACE
```

Dalam API, uncovered methods bisa menjadi bypass jika endpoint/framework menerima method tersebut.

Design rule:

```text
For sensitive URL patterns, prefer default-deny for all methods, then open specific methods intentionally.
```

Atau secara policy:

```text
Every exposed HTTP method must have explicit security ownership.
```

Checklist:

1. Apakah `OPTIONS` dibutuhkan untuk CORS preflight?
2. Apakah `HEAD` mengikuti GET authorization?
3. Apakah `TRACE` disabled di server/container?
4. Apakah framework menerima method override header seperti `X-HTTP-Method-Override`?
5. Apakah static files bisa diakses via alternative method?

---

## 11. Servlet Annotation Security with `@ServletSecurity`

Selain `web.xml`, Servlet mendukung annotation.

Contoh:

```java
import jakarta.servlet.annotation.HttpConstraint;
import jakarta.servlet.annotation.ServletSecurity;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;

import static jakarta.servlet.annotation.ServletSecurity.TransportGuarantee.CONFIDENTIAL;

@WebServlet("/admin/dashboard")
@ServletSecurity(
    value = @HttpConstraint(
        rolesAllowed = {"ADMIN"},
        transportGuarantee = CONFIDENTIAL
    )
)
public class AdminDashboardServlet extends HttpServlet {
    // ...
}
```

Baca sebagai:

```text
Servlet /admin/dashboard hanya boleh diakses role ADMIN dan harus confidential.
```

Annotation cocok ketika:

1. Servlet endpoint spesifik.
2. Constraint dekat dengan code lebih mudah dipahami.
3. Aplikasi kecil/menengah.
4. Security policy tidak heavily environment-specific.

Namun untuk aplikasi enterprise besar, centralized `web.xml` atau platform-level config kadang lebih mudah diaudit.

---

## 12. `@HttpMethodConstraint`

Untuk method-specific security:

```java
import jakarta.servlet.annotation.HttpConstraint;
import jakarta.servlet.annotation.HttpMethodConstraint;
import jakarta.servlet.annotation.ServletSecurity;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;

@WebServlet("/reports/*")
@ServletSecurity(
    value = @HttpConstraint(rolesAllowed = "REPORT_VIEWER"),
    httpMethodConstraints = {
        @HttpMethodConstraint(
            value = "POST",
            rolesAllowed = "REPORT_ADMIN"
        ),
        @HttpMethodConstraint(
            value = "DELETE",
            rolesAllowed = "REPORT_ADMIN"
        )
    }
)
public class ReportServlet extends HttpServlet {
    // GET uses default REPORT_VIEWER
    // POST/DELETE require REPORT_ADMIN
}
```

Mental model:

```text
Default constraint applies to methods not otherwise represented by method constraints.
Specific method constraints override/narrow behavior for those methods.
```

---

## 13. `@DeclareRoles`

Role declaration tells the container that certain roles exist in the application.

```java
import jakarta.annotation.security.DeclareRoles;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;

@DeclareRoles({"ADMIN", "CASE_OFFICER", "CASE_VIEWER"})
@WebServlet("/cases/*")
public class CaseServlet extends HttpServlet {
    // ...
}
```

In `web.xml` equivalent:

```xml
<security-role>
    <role-name>ADMIN</role-name>
</security-role>
<security-role>
    <role-name>CASE_OFFICER</role-name>
</security-role>
<security-role>
    <role-name>CASE_VIEWER</role-name>
</security-role>
```

Important distinction:

```text
Declaring role ≠ assigning role to user.
```

Role declaration says:

```text
This application uses this role name.
```

Role mapping says:

```text
This caller/group/principal should be considered member of this application role.
```

---

## 14. Programmatic Servlet Security API

`HttpServletRequest` exposes several security-related methods.

Common methods:

```java
Principal getUserPrincipal();
String getRemoteUser();
String getAuthType();
boolean isUserInRole(String role);
boolean authenticate(HttpServletResponse response);
void login(String username, String password);
void logout();
String changeSessionId();
```

These methods are deceptively simple. They are not just convenience methods. They are the application-facing view of container security state.

---

## 15. `getUserPrincipal()`

Example:

```java
Principal principal = request.getUserPrincipal();

if (principal == null) {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    return;
}

String username = principal.getName();
```

Meaning:

```text
Who does the container believe the caller is?
```

Important:

1. It returns container-established identity.
2. It can be null for anonymous request.
3. Its `getName()` is not necessarily database user id.
4. It may be username, subject id, email, DN, IdP subject, or mapped principal.
5. Do not assume it is stable across IdP migrations unless explicitly designed.

Bad pattern:

```java
String userId = request.getParameter("userId");
```

Better pattern:

```java
String caller = request.getUserPrincipal().getName();
```

But best enterprise pattern:

```java
AuthenticatedActor actor = actorResolver.from(request.getUserPrincipal(), request);
```

Because domain code usually needs more than raw principal name.

---

## 16. `getRemoteUser()`

```java
String remoteUser = request.getRemoteUser();
```

This returns username of the authenticated user according to the container, often equivalent to principal name.

Use carefully:

1. Good for simple audit display.
2. Not sufficient for domain identity model.
3. Can be null.
4. Should not be confused with remote IP.

---

## 17. `getAuthType()`

```java
String authType = request.getAuthType();
```

Possible values are mechanism-dependent, historically:

```text
BASIC
FORM
CLIENT_CERT
DIGEST
```

Use cases:

1. Audit/debugging.
2. Distinguish login mechanism.
3. Enforce stronger auth for sensitive operations.

But be careful:

```text
Auth type tells how the user authenticated, not what the user may do.
```

---

## 18. `isUserInRole(String role)`

```java
if (!request.isUserInRole("ADMIN")) {
    response.sendError(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

Meaning:

```text
Does the container consider current caller to be in this application role?
```

Important:

1. Role name is application role name.
2. Role mapping may differ per deployment.
3. Role check is coarse-grained.
4. Role check should not replace domain permission check.
5. String role literals should be centralized.

Bad:

```java
if (request.isUserInRole("CN=SG-GOV-CASE-ADMINS,OU=Groups,DC=corp")) {
    // business operation
}
```

Better:

```java
if (request.isUserInRole(AppRoles.CASE_ADMIN)) {
    // coarse admission
}
```

Then domain check:

```java
authorizationService.requirePermission(actor, Action.APPROVE_CASE, caseId);
```

---

## 19. `authenticate(HttpServletResponse)`

```java
boolean authenticated = request.authenticate(response);

if (!authenticated) {
    return; // response may already be committed by container
}
```

Meaning:

```text
Ask the container to authenticate current request using configured login mechanism.
```

This is useful when:

1. You allow anonymous access to a page but need login for a specific action.
2. You need programmatic login challenge.
3. You want lazy authentication.

Important:

1. The container may commit response.
2. With FORM auth, it may redirect to login page.
3. With BASIC auth, it may send `WWW-Authenticate` challenge.
4. It does not mean user has required domain permission.

Pattern:

```java
if (request.getUserPrincipal() == null) {
    if (!request.authenticate(response)) {
        return;
    }
}

// authenticated, now check authorization
```

---

## 20. `login(username, password)`

```java
try {
    request.login(username, password);
} catch (ServletException ex) {
    response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
}
```

Meaning:

```text
Authenticate supplied username/password against container-configured login mechanism/realm.
```

This is not the same as:

```java
session.setAttribute("user", username);
```

`request.login()` integrates with container security.

Danger of fake login:

```java
// Anti-pattern
if (passwordService.matches(username, password)) {
    request.getSession().setAttribute("username", username);
}
```

This creates application session state, but the container still sees:

```text
getUserPrincipal() == null
isUserInRole(...) == false
@RolesAllowed may fail or be bypassed depending on code path
```

Correct principle:

```text
If using container security, login must establish container caller identity.
```

---

## 21. `logout()`

```java
request.logout();
request.getSession().invalidate();
```

Meaning:

```text
Logout current caller from container authentication state.
```

Subtleties:

1. `logout()` clears container authentication state.
2. `session.invalidate()` clears application session state.
3. For OIDC/SAML/SSO, this may not logout from external IdP.
4. Browser cached BASIC auth credentials may still be reused.
5. Token revocation is separate.
6. Back-channel logout is separate.

Robust local logout flow:

```java
try {
    request.logout();
} finally {
    HttpSession session = request.getSession(false);
    if (session != null) {
        session.invalidate();
    }
}
```

For SSO/OIDC:

```text
local app logout
  + session invalidation
  + optional IdP logout redirect/back-channel
  + token cleanup
  + CSRF protection for logout endpoint if state-changing
```

---

## 22. `changeSessionId()` and Session Fixation

Session fixation attack:

```text
1. Attacker obtains or sets a known session id.
2. Victim logs in using that session id.
3. Attacker reuses same session id to access victim session.
```

Mitigation:

```java
request.changeSessionId();
```

Modern containers often change session id automatically during authentication, but you need to understand the invariant:

```text
Authentication boundary should rotate session identifier.
```

If you implement custom login flow, ensure session id rotation happens.

Pattern:

```java
request.login(username, password);
request.changeSessionId();
```

But check container behavior; duplicate rotation is normally fine but understand operational impact.

---

## 23. Authentication Mechanisms in Servlet Security

Classic Servlet mechanisms:

```text
BASIC
FORM
CLIENT-CERT
DIGEST
```

Modern Jakarta Security adds more developer-facing mechanisms and customization possibilities:

```text
Basic authentication mechanism
Form authentication mechanism
Custom form authentication mechanism
OpenID Connect authentication mechanism
Custom HttpAuthenticationMechanism
```

Servlet `login-config` historically defines mechanism for the web app.

---

## 24. BASIC Authentication

`web.xml`:

```xml
<login-config>
    <auth-method>BASIC</auth-method>
    <realm-name>ApplicationRealm</realm-name>
</login-config>
```

Behavior:

```text
Unauthenticated request to protected resource
   ↓
container returns 401 + WWW-Authenticate: Basic realm="..."
   ↓
browser/client sends Authorization: Basic base64(username:password)
   ↓
container validates credential
   ↓
principal/roles established
```

Strengths:

1. Simple.
2. Works well for scripts/internal tools when combined with TLS.
3. Standard HTTP semantics.

Weaknesses:

1. Password sent on every request, protected only by TLS.
2. Browser caches credentials awkwardly.
3. Logout is difficult from browser perspective.
4. Not ideal for modern user-facing apps.
5. No MFA/SSO by itself.

Use when:

1. Internal service with TLS and strong controls.
2. Simple admin endpoint behind additional network protection.
3. Testing/debugging.

Avoid for:

1. Public browser login.
2. Modern enterprise SSO.
3. Complex session/logout requirements.

---

## 25. FORM Authentication

`web.xml`:

```xml
<login-config>
    <auth-method>FORM</auth-method>
    <form-login-config>
        <form-login-page>/login.html</form-login-page>
        <form-error-page>/login-error.html</form-error-page>
    </form-login-config>
</login-config>
```

Classic form login convention:

```html
<form method="post" action="j_security_check">
    <input type="text" name="j_username" />
    <input type="password" name="j_password" />
    <button type="submit">Login</button>
</form>
```

Flow:

```text
User requests protected resource
   ↓
container saves original request
   ↓
container redirects to login page
   ↓
user submits j_username / j_password
   ↓
container validates
   ↓
container redirects to original protected resource
```

Important:

1. Login page must be accessible anonymously.
2. Error page must be accessible anonymously.
3. Static assets for login page must be accessible.
4. CSRF around login should be considered.
5. Session fixation protection is critical.
6. Redirect after login must not become open redirect vulnerability.

Common failure:

```text
/login.html is protected
   ↓
container redirects to /login.html
   ↓
/login.html requires auth
   ↓
redirect loop
```

---

## 26. Custom Form Authentication

Custom form auth is often needed when:

1. Login page is SPA-based.
2. Credential format is not plain username/password.
3. Need MFA or step-up.
4. Need CAPTCHA/brute force logic.
5. Need IdP integration.
6. Need custom error model.

Danger:

```text
Custom form login often accidentally becomes application-managed fake authentication.
```

Correct direction in Jakarta Security:

```text
Implement or configure HttpAuthenticationMechanism
   ↓
validate credential via IdentityStore/external service
   ↓
return CredentialValidationResult
   ↓
container establishes caller principal/groups
```

Bad direction:

```text
POST /login
   ↓
check DB manually
   ↓
session.setAttribute("user", user)
   ↓
container security unaware
```

---

## 27. CLIENT-CERT Authentication

`web.xml`:

```xml
<login-config>
    <auth-method>CLIENT-CERT</auth-method>
</login-config>
```

Flow:

```text
TLS handshake asks client certificate
   ↓
client presents certificate
   ↓
server validates cert chain/trust
   ↓
container maps cert subject to principal
   ↓
role mapping happens
```

Use cases:

1. High-trust internal systems.
2. Machine-to-machine authentication.
3. Government/enterprise certificate-based login.
4. Admin endpoint with strong authentication.

Subtleties:

1. TLS may terminate at reverse proxy.
2. App server may not see client cert unless forwarded safely.
3. Forwarded certificate headers must not be trusted from arbitrary clients.
4. Certificate identity mapping must be deterministic.
5. Certificate revocation/rotation matters.

---

## 28. DIGEST Authentication

Digest exists historically, but modern usage is limited. In most modern enterprise systems, prefer:

1. TLS + form/OIDC for users.
2. TLS + token/mTLS for APIs.
3. Strong gateway/service identity.

Digest is rarely the center of modern Jakarta security design.

---

## 29. Role Declaration and Role Mapping

Servlet app declares roles:

```xml
<security-role>
    <role-name>CASE_OFFICER</role-name>
</security-role>
```

But actual users get roles from somewhere:

```text
LDAP group
Database group
IdentityStore result
OIDC claim
SAML attribute
Container realm mapping
App server deployment mapping
```

Mapping chain example:

```text
IdP group: SG-ACEAS-CASE-OFFICER
   ↓
container/Jakarta Security group: CASE_OFFICER
   ↓
Servlet role: CASE_OFFICER
   ↓
request.isUserInRole("CASE_OFFICER") == true
```

Bad:

```text
Business code checks raw IdP group name.
```

Better:

```text
Business code checks stable application role/permission.
```

---

## 30. URL-Level Authorization Is Necessary but Not Sufficient

Example:

```xml
<url-pattern>/api/cases/*</url-pattern>
<role-name>CASE_OFFICER</role-name>
```

This says:

```text
CASE_OFFICER may enter the case API area.
```

It does not say:

```text
This officer may access this exact case.
This officer may approve in this workflow state.
This officer belongs to this tenant/agency/company.
This officer is not the maker of this case.
```

So the correct layered model is:

```text
Servlet constraint:
    Is caller allowed to enter this API family?

Method/domain authorization:
    Is caller allowed to perform this action on this resource now?

Database/data filtering:
    Can caller only retrieve rows/resources they are allowed to see?
```

---

## 31. Security Filters: Powerful but Dangerous

Servlet filters are often used for security.

```java
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

public class SecurityHeaderFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request,
                         ServletResponse response,
                         FilterChain chain)
            throws IOException, ServletException {

        HttpServletResponse httpResponse = (HttpServletResponse) response;
        httpResponse.setHeader("X-Frame-Options", "DENY");
        httpResponse.setHeader("X-Content-Type-Options", "nosniff");

        chain.doFilter(request, response);
    }
}
```

Good uses:

1. Security headers.
2. Correlation ID.
3. Request logging/audit envelope.
4. CSRF checks.
5. Additional policy checks.
6. Token extraction if integrated properly.

Dangerous uses:

1. Replacing container authentication incorrectly.
2. Trusting headers from untrusted clients.
3. Doing authorization after servlet already performed action.
4. Skipping `chain.doFilter` incorrectly.
5. Not handling async dispatch.
6. Not applying to all dispatcher types.

---

## 32. Filter Ordering and Security

Filter order matters.

Example conceptual order:

```text
1. Request ID filter
2. Forwarded header normalization filter
3. Security headers filter
4. Authentication/token filter
5. CSRF filter
6. Authorization/audit filter
7. Application framework dispatcher
```

But container security constraints may run before your application filters depending on container lifecycle and mechanism.

Important lesson:

```text
Do not assume a custom filter is equivalent to container authentication.
```

If a filter validates token and sets request attributes only, then:

```text
request.getUserPrincipal() may still be null
isUserInRole() may still be false
container method security may not see caller
```

For proper integration, use:

1. Jakarta Security `HttpAuthenticationMechanism`.
2. Jakarta Authentication/JASPIC mechanism.
3. Container-specific principal establishment API if absolutely necessary.
4. Framework security that consistently replaces the whole security model.

---

## 33. Dispatcher Types and Security

Servlet requests can dispatch in different ways:

```text
REQUEST
FORWARD
INCLUDE
ERROR
ASYNC
```

Security implication:

1. A filter may only run on `REQUEST`, missing `FORWARD` or `ERROR`.
2. Error pages may leak sensitive data.
3. Forward to protected resource needs careful container behavior understanding.
4. Async continuation may run after original request thread leaves.

Example filter registration:

```java
import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;

import java.util.EnumSet;

public class FilterConfigListener implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        ServletContext context = sce.getServletContext();
        FilterRegistration.Dynamic reg = context.addFilter("auditFilter", new AuditFilter());
        reg.addMappingForUrlPatterns(
            EnumSet.of(DispatcherType.REQUEST, DispatcherType.ERROR, DispatcherType.ASYNC),
            false,
            "/*"
        );
    }
}
```

Design question:

```text
Should security/audit filter run for ERROR and ASYNC dispatches?
```

Often yes for audit envelope, but actual authorization check should be designed carefully.

---

## 34. Servlet Async and Security Context

Servlet async lets request processing continue after original thread returns.

Concept:

```java
AsyncContext async = request.startAsync();
async.start(() -> {
    // runs on container-managed thread
});
```

Security issue:

```text
Is caller identity available inside async task?
```

Potential problems:

1. `Principal` lost.
2. Thread-local security context not propagated.
3. Request object accessed after invalid lifecycle assumptions.
4. User logs out while async processing continues.
5. Background task performs action as stale user.

Robust pattern:

```java
Principal principal = request.getUserPrincipal();
String actorName = principal != null ? principal.getName() : null;
Set<String> rolesSnapshot = resolveRoles(request);
String correlationId = correlationIdProvider.current();

async.start(() -> {
    // use explicit actor snapshot for audit/authorization checks,
    // or re-resolve permissions using stable actor id
});
```

But for privileged operations, prefer explicit authorization service rather than relying on ambient request context.

---

## 35. Servlet Security and JAX-RS

JAX-RS usually runs inside Servlet container via an application mapping:

```text
/api/* → JAX-RS application servlet/filter
```

So a Servlet constraint like:

```xml
<url-pattern>/api/*</url-pattern>
```

can protect all JAX-RS endpoints.

Then inside JAX-RS:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.SecurityContext;

@Path("/cases")
public class CaseResource {

    @GET
    @RolesAllowed("CASE_VIEWER")
    public String listCases(@Context SecurityContext securityContext) {
        return "caller=" + securityContext.getUserPrincipal().getName();
    }
}
```

Layering:

```text
Servlet constraint protects /api/* broadly.
JAX-RS annotation protects resource/method more specifically.
Domain service protects object/action/state.
```

---

## 36. Servlet Security and CDI/EJB Method Security

If request reaches CDI/EJB service with established caller identity, method-level security can use it.

Example:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.Stateless;

@Stateless
public class CaseApprovalService {

    @RolesAllowed("SUPERVISOR")
    public void approve(String caseId) {
        // still needs domain authorization:
        // maker-checker, state, assignment, tenant, etc.
    }
}
```

Critical invariant:

```text
Method security depends on caller identity being correctly established in container context.
```

If custom login only sets session attribute, method security may not work.

---

## 37. 401 vs 403 in Servlet Security

Two statuses matter:

```text
401 Unauthorized     → caller is not authenticated / needs authentication challenge
403 Forbidden        → caller is authenticated but not allowed
```

Despite the name, `401 Unauthorized` is about authentication.

Examples:

```text
Anonymous user requests /admin/*
  → 401 or redirect to login page

Authenticated OFFICER requests /admin/* requiring ADMIN
  → 403
```

For browser form login:

```text
401 may appear as redirect to login page.
```

For API:

```text
401 should include proper challenge when applicable.
403 should not ask user to re-login unless auth may be insufficient/expired.
```

---

## 38. Login Page and Public Resource Design

A common web app structure:

```text
/login
/login-error
/assets/*
/public/*
/api/auth/*
/api/cases/*
/admin/*
```

Design:

```text
Anonymous:
  /login
  /login-error
  /assets/login/*
  /public/*

Authenticated:
  /home
  /api/me

Role protected:
  /admin/*
  /api/cases/*
  /api/reports/*
```

Trap:

```text
Protecting /assets/* can break login page CSS/JS.
```

Trap:

```text
Leaving /api/auth/debug public can leak identity/session info.
```

Trap:

```text
OIDC callback endpoint accidentally protected in a way that prevents IdP redirect from completing.
```

---

## 39. Static Resources and Security

Static files can be sensitive.

Examples:

```text
/export/report.pdf
/generated/invoice.csv
/uploads/private-document.docx
/WEB-INF/classes/application.properties
```

Servlet containers usually protect `WEB-INF` from direct access, but application-generated files under web root can be dangerous.

Rules:

1. Do not put private uploaded/generated documents under public web root.
2. Serve sensitive files through controlled endpoint.
3. Enforce authorization before streaming file.
4. Set content headers safely.
5. Audit downloads.

Example:

```java
@GET
@Path("/documents/{id}/download")
@RolesAllowed("DOCUMENT_VIEWER")
public Response download(@PathParam("id") String id) {
    authorizationService.requirePermission(actor(), Action.DOWNLOAD_DOCUMENT, id);
    // stream file from storage, not public web root
}
```

Servlet URL constraint can protect `/documents/*`, but object-level authorization must happen before streaming.

---

## 40. Transport Guarantee and Reverse Proxy Reality

In production, app server often sits behind:

```text
Browser
  ↓ HTTPS
ALB / nginx / Apache / Traefik / HAProxy
  ↓ HTTP or HTTPS internal
Servlet container
```

If TLS terminates at proxy, container may see:

```text
scheme = http
secure = false
server port = 8080
```

But original client used HTTPS.

If `<transport-guarantee>CONFIDENTIAL</transport-guarantee>` is configured, container may redirect to HTTPS incorrectly unless forwarded headers/proxy integration is configured.

Typical headers:

```text
X-Forwarded-Proto: https
X-Forwarded-Host: example.com
Forwarded: proto=https;host=example.com
```

Security rule:

```text
Only trust forwarded headers from trusted proxy boundary.
```

Never allow arbitrary internet clients to set identity/security headers.

---

## 41. Header-Based Identity Behind Proxy

Some enterprise deployments authenticate at gateway and forward identity via headers:

```text
X-Authenticated-User: alice
X-Authenticated-Groups: CASE_OFFICER,REPORT_VIEWER
```

This is dangerous unless designed rigorously.

Required controls:

1. App must only accept traffic from trusted proxy.
2. Proxy must strip incoming spoofed identity headers.
3. App must not trust those headers from direct internet traffic.
4. Header identity must be converted into container principal/roles or consistently used by a dedicated security layer.
5. Audit must record original authentication source.

Bad:

```java
String user = request.getHeader("X-Authenticated-User");
```

Better:

```text
Gateway validates token/session/cert
  ↓
Gateway forwards signed/internal identity assertion
  ↓
App validates assertion or trusts only mTLS-authenticated gateway
  ↓
App establishes principal through proper mechanism
```

---

## 42. Servlet Security and CSRF

Servlet Security authenticates caller. It does not automatically solve CSRF for your application semantics.

CSRF problem:

```text
User is logged in with cookie session.
Malicious site causes browser to POST to your app.
Browser includes cookies automatically.
Server sees authenticated session.
Action happens unless CSRF protection exists.
```

Servlet role check says:

```text
User has role.
```

CSRF check says:

```text
This state-changing request intentionally originated from your app/user interaction.
```

For form/session-based apps:

1. Use CSRF tokens for state-changing requests.
2. Use SameSite cookies where appropriate.
3. Validate Origin/Referer for sensitive endpoints if suitable.
4. Do not rely on CORS as CSRF defense.

This will be deep-dived in a later part.

---

## 43. Servlet Security and CORS

CORS controls whether browser JavaScript from another origin may read/use responses.

It is not authentication.

Wrong mental model:

```text
CORS blocks unauthorized users.
```

Correct mental model:

```text
CORS is a browser-enforced cross-origin read/access policy.
```

Your server still needs:

1. Authentication.
2. Authorization.
3. CSRF defense if cookie-based.
4. Token validation if bearer token-based.

Preflight `OPTIONS` handling can interact with Servlet constraints. If `/api/*` requires auth for all methods and browser sends unauthenticated preflight, API may fail before actual request.

Common design:

```text
OPTIONS preflight handled by CORS filter/gateway carefully.
Actual request still requires authentication and authorization.
```

---

## 44. Servlet Security and Error Pages

Error pages can leak sensitive data.

Example `web.xml`:

```xml
<error-page>
    <error-code>403</error-code>
    <location>/error/forbidden.html</location>
</error-page>

<error-page>
    <error-code>500</error-code>
    <location>/error/server-error.html</location>
</error-page>
```

Rules:

1. Error page should not reveal stack trace.
2. 403 page should not reveal exact missing internal role unless appropriate.
3. API error should use consistent JSON body.
4. Correlation ID should be shown/logged.
5. Denied access should be audited.
6. Error page itself must not trigger redirect loop.

---

## 45. A Practical Example: Enterprise Case Management Servlet Security

Suppose application has:

```text
/public/*
/login
/logout
/api/me
/api/cases/*
/api/admin/*
/api/reports/*
/assets/*
```

Roles:

```text
USER
CASE_VIEWER
CASE_OFFICER
SUPERVISOR
ADMIN
REPORT_VIEWER
```

A coarse web-tier policy:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Authenticated API</web-resource-name>
        <url-pattern>/api/me</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>USER</role-name>
    </auth-constraint>
</security-constraint>

<security-constraint>
    <web-resource-collection>
        <web-resource-name>Case API Read</web-resource-name>
        <url-pattern>/api/cases/*</url-pattern>
        <http-method>GET</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>CASE_VIEWER</role-name>
        <role-name>CASE_OFFICER</role-name>
        <role-name>SUPERVISOR</role-name>
    </auth-constraint>
</security-constraint>

<security-constraint>
    <web-resource-collection>
        <web-resource-name>Case API Write</web-resource-name>
        <url-pattern>/api/cases/*</url-pattern>
        <http-method>POST</http-method>
        <http-method>PUT</http-method>
        <http-method>PATCH</http-method>
        <http-method>DELETE</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>CASE_OFFICER</role-name>
        <role-name>SUPERVISOR</role-name>
    </auth-constraint>
</security-constraint>

<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin API</web-resource-name>
        <url-pattern>/api/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
</security-constraint>

<security-constraint>
    <web-resource-collection>
        <web-resource-name>Reports</web-resource-name>
        <url-pattern>/api/reports/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>REPORT_VIEWER</role-name>
        <role-name>ADMIN</role-name>
    </auth-constraint>
</security-constraint>
```

Then domain layer:

```java
public void approveCase(Actor actor, String caseId) {
    Case caze = caseRepository.get(caseId);

    authorization.require(actor, Permission.CASE_APPROVE, caze);

    caze.approve(actor.id());
    caseRepository.save(caze);
}
```

Servlet constraint says:

```text
Only CASE_OFFICER/SUPERVISOR can reach mutation API.
```

Domain authorization says:

```text
This exact actor can approve this exact case in this exact state.
```

---

## 46. Anti-Pattern: Security Only in Frontend

Bad architecture:

```text
Vue/React hides Admin button
  ↓
Backend endpoint /api/admin/delete-user is public or only weakly checked
  ↓
User calls endpoint manually
```

Correct architecture:

```text
Frontend may hide UI affordance for UX
  ↓
Backend Servlet/JAX-RS/method/domain layers enforce security
```

Rule:

```text
Frontend authorization is presentation logic, not enforcement.
```

---

## 47. Anti-Pattern: Only Servlet Role, No Domain Authorization

Bad:

```java
if (request.isUserInRole("SUPERVISOR")) {
    approve(caseId);
}
```

Missing checks:

1. Is case in approvable state?
2. Is supervisor assigned to same unit/tenant?
3. Is supervisor different from maker?
4. Is supervisor delegation valid?
5. Is case locked by another transaction?
6. Was permission evaluated against latest state?

Better:

```java
if (!request.isUserInRole("SUPERVISOR")) {
    response.sendError(403);
    return;
}

Actor actor = actorResolver.from(request);
authorizationService.require(actor, Action.APPROVE_CASE, caseId);
caseService.approve(actor, caseId);
```

---

## 48. Anti-Pattern: Application Session as Security Source of Truth

Bad:

```java
HttpSession session = request.getSession();
User user = (User) session.getAttribute("user");

if (user != null) {
    // authenticated
}
```

Problems:

1. Container principal may be null.
2. Session object may be stale.
3. Role changes not reflected.
4. Logout may be incomplete.
5. Session serialization may leak sensitive data.
6. Method security cannot see this identity.

Better:

```java
Principal principal = request.getUserPrincipal();
if (principal == null) {
    response.sendError(401);
    return;
}

Actor actor = actorResolver.resolve(principal);
```

Session may cache profile/display information, but should not casually become the ultimate authority.

---

## 49. Anti-Pattern: Trusting Request Parameters for Identity

Bad:

```java
String userId = request.getParameter("userId");
caseService.listCasesFor(userId);
```

An attacker can change `userId`.

Better:

```java
String caller = request.getUserPrincipal().getName();
caseService.listCasesForCaller(caller);
```

Even better:

```java
Actor actor = actorResolver.from(request);
caseService.listCasesVisibleTo(actor);
```

Rule:

```text
Caller identity must come from trusted authentication context, not client-supplied business parameters.
```

---

## 50. Anti-Pattern: Hardcoding Deployment Role Names Everywhere

Bad:

```java
request.isUserInRole("SG-GOV-ACEAS-PROD-APPROVER-GROUP")
```

Problems:

1. Environment-specific.
2. IdP-specific.
3. Hard to migrate.
4. Hard to test.
5. Business code polluted by infrastructure naming.

Better:

```java
request.isUserInRole(AppRoles.CASE_APPROVER)
```

Then mapping:

```text
PROD IdP group: SG-GOV-ACEAS-PROD-APPROVER-GROUP
  → App role: CASE_APPROVER

UAT IdP group: SG-GOV-ACEAS-UAT-APPROVER-GROUP
  → App role: CASE_APPROVER
```

---

## 51. Anti-Pattern: Overbroad URL Constraints

Bad:

```xml
<url-pattern>/*</url-pattern>
<auth-constraint>
    <role-name>USER</role-name>
</auth-constraint>
```

This may unintentionally protect:

1. Login page.
2. Error page.
3. OIDC callback.
4. Static assets.
5. Health check endpoint.
6. Public resources.

Sometimes all-protected is okay, but you need deliberate exceptions.

Better:

```text
Start from default deny for application areas,
then explicitly allow public endpoints,
then verify login/callback/assets/error/health behavior.
```

---

## 52. Anti-Pattern: Underbroad URL Constraints

Bad:

```xml
<url-pattern>/admin</url-pattern>
```

But actual endpoints:

```text
/admin/users
/admin/reports
/admin/settings
```

If only exact `/admin` is protected, deeper paths may be open.

Better:

```xml
<url-pattern>/admin/*</url-pattern>
```

Then test actual endpoint list.

---

## 53. Testing Servlet Security

Testing must include positive and negative cases.

Example matrix:

| Request | Anonymous | USER | OFFICER | ADMIN |
|---|---:|---:|---:|---:|
| `GET /public/info` | 200 | 200 | 200 | 200 |
| `GET /api/me` | 401 | 200 | 200 | 200 |
| `GET /api/cases/123` | 401 | 403 | 200 | maybe 200 |
| `POST /api/cases/123/approve` | 401 | 403 | depends | depends |
| `GET /api/admin/users` | 401 | 403 | 403 | 200 |

Minimum tests:

1. Anonymous access to protected endpoint returns 401/login redirect.
2. Authenticated wrong role returns 403.
3. Correct role passes URL gate.
4. Correct role but wrong domain permission still fails.
5. Login page accessible anonymous.
6. Error page accessible and safe.
7. Static login assets accessible.
8. Uncovered HTTP methods cannot bypass.
9. Logout clears session/principal.
10. Session id changes after login.

---

## 54. Debugging Servlet Security in Production

When security behaves strangely, ask in this order:

### 54.1 Did request hit the expected URL pattern?

Check:

```text
context path
servlet path
path info
query string
reverse proxy rewrite
trailing slash
case sensitivity
encoded path
```

### 54.2 Was security constraint matched?

Check:

```text
web.xml
annotation
container merged metadata
HTTP method
dispatcher type
```

### 54.3 Was authentication triggered?

Check:

```text
login-config
mechanism
realm
identity store
session cookie
redirect/challenge
```

### 54.4 Was principal established?

Log safely:

```java
Principal principal = request.getUserPrincipal();
log.debug("principalPresent={}, authType={}", principal != null, request.getAuthType());
```

Avoid logging sensitive token/password.

### 54.5 Were roles mapped?

Check:

```text
IdentityStore groups
container realm mapping
deployment role mapping
case sensitivity
prefix mismatch
```

### 54.6 Was there another layer?

Check:

```text
gateway auth
framework security
custom filter
JAX-RS annotation
CDI/EJB method security
domain authorization
```

### 54.7 Was session stale?

Check:

```text
role changed after login
session not invalidated
cluster session replication
sticky session
node mismatch
clock skew
```

---

## 55. Security Logging in Servlet Layer

Useful safe audit fields:

```text
correlation_id
request_id
timestamp
method
path template, not full sensitive URL when possible
principal id / subject id
auth type
roles/app role summary
client ip after trusted proxy normalization
user agent summary
outcome: allowed/denied/challenged/error
status code
denial category
```

Avoid:

```text
password
Authorization header
session cookie
raw ID token/access token
full PII payload
sensitive query parameters
```

For denied access:

```text
Audit event should answer:
- who attempted?
- what resource/action?
- from where?
- when?
- why denied at a high-level category?
- correlation id for investigation?
```

---

## 56. Java 8–25 Considerations

### 56.1 Java 8

Common in Java EE 7/8 era.

Package:

```text
javax.servlet.*
```

Typical app servers:

```text
WildFly older versions
Payara/GlassFish Java EE/Jakarta EE 8
WebLogic traditional
TomEE
```

Security often configured via:

```text
web.xml
container realm
JAAS login module
JASPIC module
vendor-specific config
```

### 56.2 Java 11/17

Common migration period.

Concerns:

1. App server compatibility.
2. `javax` to `jakarta` migration depending Jakarta EE version.
3. Stronger TLS defaults.
4. Dependency split.
5. Removed/deprecated Java EE modules from JDK after Java 8.

### 56.3 Java 21

Important because of virtual threads and modern runtime behavior.

Security context concern:

```text
Do not assume thread-local propagation works automatically across all async/virtual-thread boundaries.
```

Servlet containers may support virtual threads differently.

### 56.4 Java 25

By this point, SecurityManager is no longer the practical foundation for app-level security design. Jakarta Servlet 6.1 also removes references to SecurityManager at spec level. Design should focus on:

1. Container authentication/authorization.
2. Token/session/cert security.
3. Domain policy.
4. Runtime hardening.
5. Supply-chain/dependency security.
6. OS/container/cloud boundary.

---

## 57. Relationship with Jakarta Security API

Jakarta Security API gives developer-friendly constructs:

```text
SecurityContext
HttpAuthenticationMechanism
IdentityStore
CredentialValidationResult
```

Servlet Security gives web-tier runtime contract:

```text
HttpServletRequest principal/role/auth methods
security constraints
login config
session/auth integration
```

They meet here:

```text
Jakarta Security mechanism authenticates caller
   ↓
container establishes caller principal/groups
   ↓
Servlet request exposes principal and role checks
   ↓
application/JAX-RS/CDI uses identity
```

Example conceptual mapping:

```java
CredentialValidationResult result = identityStore.validate(credential);

// result contains caller principal and groups
// container integrates this into Servlet request security context
```

---

## 58. Relationship with Spring Security

Spring Security often runs as Servlet filters and maintains its own `SecurityContext` abstraction.

In Spring Boot embedded apps, Spring Security may be the primary security layer rather than Jakarta Security.

But Servlet API methods may still be bridged:

```java
request.getUserPrincipal();
request.isUserInRole("ADMIN");
```

Important:

```text
Do not mix multiple security systems casually.
```

If using Spring Security:

1. Know whether container security constraints are active.
2. Know whether roles are Spring authorities or Servlet roles.
3. Know how `Principal` is exposed.
4. Know filter order.
5. Know session/logout ownership.

This series focuses on Jakarta/Javax security, but production engineers must understand framework coexistence.

---

## 59. Design Heuristics for Servlet Security

### 59.1 Use Servlet constraints for coarse admission

Good:

```text
/admin/* requires ADMIN
/api/cases/* requires authenticated case role
/api/reports/* requires REPORT_VIEWER
```

### 59.2 Use domain authorization for business decisions

Good:

```text
CASE_APPROVE allowed only if assigned supervisor, state SUBMITTED, not maker, same tenant.
```

### 59.3 Keep role names stable

Good:

```text
CASE_OFFICER
SUPERVISOR
REPORT_VIEWER
```

Avoid environment/IdP-specific names in business code.

### 59.4 Treat session as security-sensitive state

Rotate session id on login. Invalidate on logout. Avoid storing secrets.

### 59.5 Test negative paths

Security confidence comes mostly from negative tests:

```text
anonymous denied
wrong role denied
wrong tenant denied
wrong state denied
uncovered method denied
stale session denied/refreshed
```

### 59.6 Do not trust inbound identity headers without a boundary

Headers are client-controlled unless stripped/inserted by trusted infrastructure.

### 59.7 Design login/logout as flows, not endpoints

Login/logout interacts with:

```text
session
cookie
CSRF
IdP
browser cache
token revocation
audit
redirect
```

---

## 60. A Mental Model Diagram

```text
                         ┌──────────────────────────────┐
                         │          Browser/API Client    │
                         └──────────────┬───────────────┘
                                        │
                                        │ HTTP request
                                        ▼
                         ┌──────────────────────────────┐
                         │ Reverse Proxy / Gateway       │
                         │ TLS, routing, optional auth    │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │ Servlet Container             │
                         │                              │
                         │ 1. Match URL/method constraint│
                         │ 2. Enforce transport guarantee│
                         │ 3. Trigger auth mechanism     │
                         │ 4. Establish principal/roles  │
                         │ 5. Decide 401/403/pass        │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │ Filters / JAX-RS / MVC        │
                         │ Additional web concerns       │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │ Method Security               │
                         │ @RolesAllowed, interceptors   │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │ Domain Authorization          │
                         │ subject/action/resource/state │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │ Data Access / Audit           │
                         │ tenant filters, audit events  │
                         └──────────────────────────────┘
```

---

## 61. Practical Checklist: Reviewing Servlet Security

Use this as review checklist.

### 61.1 URL coverage

- [ ] Are all sensitive URL patterns covered?
- [ ] Are exact/path-prefix/extension mappings correct?
- [ ] Are JAX-RS dispatcher mappings covered?
- [ ] Are admin/internal endpoints covered?
- [ ] Are generated/downloaded files protected?

### 61.2 HTTP method coverage

- [ ] Are GET/POST/PUT/PATCH/DELETE rules explicit?
- [ ] Is OPTIONS handled safely for CORS?
- [ ] Is TRACE disabled?
- [ ] Are HEAD/method override semantics understood?

### 61.3 Login flow

- [ ] Is login page public?
- [ ] Is error page public?
- [ ] Are login assets public?
- [ ] Is original request restoration safe?
- [ ] Is open redirect prevented?
- [ ] Is session id rotated after login?

### 61.4 Logout flow

- [ ] Does logout call container logout?
- [ ] Is session invalidated?
- [ ] Are cookies expired where needed?
- [ ] Is IdP/global logout handled if SSO?
- [ ] Is logout CSRF considered?

### 61.5 Role model

- [ ] Are roles declared?
- [ ] Are roles mapped from IdP/groups consistently?
- [ ] Are role names stable and app-level?
- [ ] Are roles case-sensitive where relevant?
- [ ] Are domain permissions separate?

### 61.6 Proxy/TLS

- [ ] Is transport guarantee compatible with TLS termination?
- [ ] Are forwarded headers trusted only from proxy?
- [ ] Are spoofed identity headers stripped?
- [ ] Is direct app-server access blocked?

### 61.7 Testing

- [ ] Anonymous denied tests.
- [ ] Wrong role denied tests.
- [ ] Correct role allowed tests.
- [ ] Domain denied tests.
- [ ] Uncovered method tests.
- [ ] Session fixation tests.
- [ ] Logout tests.

---

## 62. Key Takeaways

1. Servlet Security is the web-tier admission control layer.
2. It protects URL patterns and HTTP methods, not full business semantics.
3. `web.xml` and `@ServletSecurity` express security constraints.
4. `HttpServletRequest` exposes container security state through principal, auth type, role checks, login, logout, and authenticate methods.
5. Authentication must establish container-recognized identity; setting a session attribute is not equivalent.
6. URL-level role checks are necessary but insufficient for domain authorization.
7. Reverse proxies and TLS termination can break transport guarantees or identity assumptions.
8. Custom filters are powerful but can accidentally bypass or duplicate container security.
9. Session fixation, logout semantics, public login assets, and uncovered HTTP methods are common real-world failure points.
10. Servlet Security should be combined with JAX-RS/CDI/EJB/domain-level authorization and audit.

---

## 63. How This Connects to Next Part

Part 04 gave the Servlet foundation:

```text
URL/method constraints
  + login mechanisms
  + request principal/role API
  + session/logout/authenticate behavior
```

Part 05 will go deeper into authentication mechanisms:

```text
Basic
Form
Custom Form
Client Certificate
OIDC
Multiple mechanisms
Step-up
Fallback
Challenge behavior
Failure modes
```

The key transition:

```text
Part 04: where web-tier authentication/authorization is enforced.
Part 05: how the caller actually gets authenticated.
```

---

## 64. References

- Jakarta Servlet 6.1 Specification — Servlet API and web-tier contract.
- Jakarta Servlet API — `HttpServletRequest`, `authenticate`, `login`, `logout`, `getUserPrincipal`, `isUserInRole`, `changeSessionId`.
- Jakarta EE Tutorial — Web-tier security concepts, authorization constraints, roles, and transport guarantee.
- Jakarta Security 4.0 Specification — modern Jakarta Security APIs and HTTP authentication mechanisms.
- Jakarta Authentication 3.1 Specification — lower-level authentication SPI used by containers.
- Jakarta Authorization 3.0 Specification — lower-level authorization SPI used by containers.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-03-container-security-architecture.md">⬅️ Learn Java Jakarta Security Authentication Authorization Identity</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-05-authentication-mechanisms.md">Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Certificate, OIDC ➡️</a>
</div>
