# learn-java-authentication-modes-and-patterns-part-005  
# Part 5 — Servlet Container Authentication

> Series: **Java Authentication Modes and Patterns**  
> Range: **Java 8 sampai Java 25**  
> Fokus part ini: **authentication yang dikelola oleh Servlet/Jakarta Servlet container** sebelum identitas masuk ke application framework seperti Spring Security, Jakarta Security, JAX-RS resource, JSF, MVC controller, atau custom filter.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

- **Part 0**: mental model authentication sebagai pembuktian identity di trust boundary.
- **Part 1**: konsep Java runtime seperti `Subject`, `Principal`, credential, dan context.
- **Part 2**: taxonomy authentication berdasarkan proof type, state model, dan trust model.
- **Part 3**: password authentication secara benar.
- **Part 4**: session-based authentication, cookies, browser behavior, dan server state.

Sekarang kita masuk ke lapisan yang secara historis sangat penting di Java web:

> **Servlet Container Authentication**.

Ini adalah model di mana container seperti Tomcat, Jetty, Undertow, GlassFish, Payara, WildFly, WebLogic, atau Open Liberty dapat ikut bertanggung jawab untuk:

- mendeteksi resource yang protected,
- memaksa authentication,
- menjalankan mechanism seperti BASIC, FORM, atau CLIENT-CERT,
- menyimpan authenticated identity pada request/session/container security context,
- menyediakan `Principal` dan role check ke aplikasi.

Part ini penting karena banyak engineer modern langsung mempelajari Spring Security atau OAuth2/OIDC, tetapi melewatkan pertanyaan dasar:

> Sebelum request mencapai controller, siapa yang sebenarnya punya hak untuk mengatakan “user ini sudah authenticated”?

Di Java web, jawabannya bisa salah satu dari:

1. reverse proxy / gateway,
2. servlet container,
3. Jakarta Security,
4. Spring Security,
5. custom filter,
6. application code,
7. external IdP callback handler,
8. service mesh,
9. combination dari beberapa lapisan.

Part ini membahas khusus **container-managed authentication**.

---

## 1. Problem yang Diselesaikan oleh Servlet Container Authentication

### 1.1 Masalah Dasar

Sebuah aplikasi web Java menerima HTTP request:

```text
GET /admin/users HTTP/1.1
Host: app.example.com
Cookie: JSESSIONID=...
```

Pertanyaannya:

```text
Apakah caller ini boleh diperlakukan sebagai user yang sudah login?
```

Sebelum aplikasi bisa menjawab:

```java
request.getUserPrincipal()
request.isUserInRole("ADMIN")
```

harus ada mekanisme yang:

1. menentukan apakah `/admin/users` protected,
2. menentukan bagaimana user harus authenticate,
3. memvalidasi credential,
4. membuat identity container-level,
5. mengikat identity itu ke request,
6. menyediakan principal/role untuk aplikasi.

Servlet container authentication menyelesaikan problem ini pada level web container.

---

### 1.2 Kenapa Container Authentication Pernah Sangat Penting?

Di Java EE/Jakarta EE tradisional, container bukan hanya HTTP server. Container juga menjadi runtime yang menyediakan:

- servlet lifecycle,
- session management,
- security constraint,
- role mapping,
- JNDI,
- connection pool,
- transaction integration,
- EJB integration,
- CDI integration,
- deployment descriptor,
- declarative security.

Karena itu authentication dapat dideklarasikan di deployment descriptor atau annotation, bukan selalu ditulis manual di aplikasi.

Contoh klasik:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin Area</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>admin</role-name>
    </auth-constraint>
</security-constraint>

<login-config>
    <auth-method>FORM</auth-method>
    <form-login-config>
        <form-login-page>/login.xhtml</form-login-page>
        <form-error-page>/login-error.xhtml</form-error-page>
    </form-login-config>
</login-config>
```

Aplikasi tidak perlu menulis filter login dari nol. Container membaca deklarasi ini dan mengatur challenge/authentication flow.

---

### 1.3 Kenapa Masih Relevan di Era Spring Security dan OIDC?

Karena production system sering tidak bersih secara teori.

Di dunia nyata, satu aplikasi bisa punya kombinasi:

```text
Browser
  -> WAF
  -> reverse proxy
  -> load balancer
  -> servlet container
  -> Spring Security filter chain
  -> controller/resource
```

Atau:

```text
Browser
  -> SSO Gateway
  -> Tomcat
  -> legacy servlet app
  -> internal module
```

Atau:

```text
Client with certificate
  -> TLS termination
  -> Tomcat CLIENT-CERT
  -> Jakarta Security
  -> JAX-RS resource
```

Jika engineer tidak memahami container authentication, beberapa masalah sulit akan terlihat “misterius”:

- `request.getUserPrincipal()` null padahal Spring `Authentication` ada.
- Spring user ada tetapi container role check gagal.
- `isUserInRole()` tidak sesuai role JWT.
- Form login redirect loop.
- Session fixation tidak ditangani di boundary yang tepat.
- Logout hanya membersihkan Spring context tetapi tidak container principal.
- BASIC authentication tetap login lagi setelah `request.logout()`.
- Reverse proxy mengirim client cert tetapi container tidak menganggap request authenticated.
- Container realm menerima password lama meski aplikasi sudah migrasi ke hash modern.
- Security constraint memblokir endpoint sebelum filter custom sempat jalan.
- Async dispatch kehilangan authentication context.

---

## 2. Mental Model: Container sebagai Security Gatekeeper

### 2.1 Container Authentication adalah Gate Sebelum Application Logic

Model dasarnya:

```text
HTTP Request
    |
    v
Connector / HTTP Engine
    |
    v
Servlet Container Security Layer
    |
    +-- Check URL security constraints
    +-- Determine required auth method
    +-- Challenge or validate credential
    +-- Build container principal
    +-- Associate identity with request/session
    |
    v
Filter Chain
    |
    v
Servlet / Controller / JAX-RS / JSF / Application
```

Container authentication bukan sekadar library. Ia adalah bagian dari request processing pipeline.

---

### 2.2 Authentication Output Container

Jika authentication berhasil, aplikasi biasanya dapat membaca:

```java
Principal principal = request.getUserPrincipal();

String username = request.getRemoteUser();

boolean admin = request.isUserInRole("admin");
```

Mental model:

```text
Credential masuk
    -> container memvalidasi
        -> container membuat Principal
            -> container mengikat Principal ke request
                -> aplikasi membaca Principal/role
```

Yang perlu dipahami:

- `Principal` bukan credential.
- `Principal` adalah identity result.
- role bukan selalu sama dengan group asli.
- role bisa melalui mapping.
- authentication success bukan berarti authorization success.
- request bisa authenticated tetapi tidak punya role yang dibutuhkan.

---

### 2.3 Container Authentication vs Application Authentication

Ada dua model besar.

#### Model A — Container-managed

```text
web.xml / annotations declare protected resources
container challenges user
container validates credential via realm/identity store
application trusts request principal
```

#### Model B — Application-managed

```text
all requests reach app
app/framework filter checks credential
app/framework creates its own security context
container may not know user identity
```

Spring Security biasanya memakai Model B, walaupun bisa berintegrasi dengan container.

Jakarta Security modern berada di tengah:

```text
application defines authentication mechanism using standard API
container participates in executing it
```

---

### 2.4 Invariant Utama

Untuk container-managed authentication, invariant-nya:

> Jika sebuah resource dilindungi oleh security constraint, container harus memastikan caller sudah authenticated dan memiliki role yang dibutuhkan sebelum resource dipanggil.

Jika invariant ini bocor, konsekuensinya besar:

- protected servlet bisa dipanggil anonymous,
- role check bisa salah,
- endpoint internal bisa terbuka,
- user bisa melihat data tenant lain,
- audit trail tidak bisa dipercaya.

---

## 3. Istilah Kunci

### 3.1 Servlet Container

Servlet container adalah runtime yang menjalankan servlet dan memproses request HTTP sesuai Servlet/Jakarta Servlet specification.

Contoh:

- Apache Tomcat,
- Eclipse Jetty,
- Undertow,
- GlassFish,
- Payara,
- WildFly,
- Open Liberty,
- WebLogic.

Container menyediakan:

- servlet lifecycle,
- filter chain,
- session management,
- request dispatch,
- security constraint,
- authentication challenge,
- role mapping.

---

### 3.2 Realm

Di banyak container, terutama Tomcat, **realm** adalah sumber data authentication dan role.

Realm dapat terhubung ke:

- file user,
- database,
- LDAP,
- JAAS,
- custom realm,
- memory realm,
- data source realm.

Mental model:

```text
Realm = container-side user/credential/role verification backend
```

Contoh konseptual:

```text
username + password
    -> Realm.authenticate(username, password)
        -> Principal(username, roles)
```

Penting:

- Realm adalah konsep container implementation.
- Jakarta Servlet specification tidak memaksa semua container memakai istilah “Realm”.
- Tomcat memakai istilah Realm.
- WebLogic/Open Liberty/WildFly punya model security domain/registry/realm masing-masing.

---

### 3.3 Security Constraint

Security constraint adalah deklarasi resource mana yang protected dan role apa yang diperlukan.

Contoh:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin APIs</web-resource-name>
        <url-pattern>/api/admin/*</url-pattern>
        <http-method>GET</http-method>
        <http-method>POST</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
</security-constraint>
```

Makna:

```text
Untuk GET/POST ke /api/admin/*, caller harus authenticated dan punya role ADMIN.
```

---

### 3.4 Login Config

`login-config` menentukan authentication method.

Contoh BASIC:

```xml
<login-config>
    <auth-method>BASIC</auth-method>
    <realm-name>Admin Area</realm-name>
</login-config>
```

Contoh FORM:

```xml
<login-config>
    <auth-method>FORM</auth-method>
    <form-login-config>
        <form-login-page>/login</form-login-page>
        <form-error-page>/login-error</form-error-page>
    </form-login-config>
</login-config>
```

Contoh CLIENT-CERT:

```xml
<login-config>
    <auth-method>CLIENT-CERT</auth-method>
</login-config>
```

---

### 3.5 Principal

`Principal` adalah representasi identity.

```java
Principal principal = request.getUserPrincipal();
```

Biasanya `principal.getName()` mengembalikan username, user id, subject name, atau identifier lain.

Peringatan penting:

> Jangan menganggap `principal.getName()` selalu immutable, globally unique, atau cocok sebagai primary key audit.

Di enterprise system, `principal.getName()` bisa berupa:

- username,
- email,
- employee ID,
- LDAP DN,
- SAML NameID,
- certificate subject,
- service account name,
- mapped display name.

Untuk audit serius, butuh canonical internal subject ID.

---

### 3.6 Role

Role adalah label authorization container-level.

```java
request.isUserInRole("ADMIN")
```

Role bisa berasal dari:

- database role,
- LDAP group,
- container realm,
- deployment role mapping,
- application mapping,
- identity store,
- external IdP claim.

Jangan mencampur:

```text
group != role
permission != role
scope != role
authority != role
```

Role container biasanya kasar. Authorization detail sering tetap perlu application-level permission model.

---

### 3.7 Programmatic Security

Servlet API menyediakan method untuk authentication dan role checking secara programmatic.

Contoh:

```java
if (request.getUserPrincipal() == null) {
    request.authenticate(response);
}
```

```java
request.login(username, password);
```

```java
request.logout();
```

```java
boolean allowed = request.isUserInRole("ADMIN");
```

Ini memberi kontrol lebih dibanding declarative-only security.

---

## 4. Authentication Mechanism di Servlet Container

Servlet/Jakarta Servlet container tradisional mengenal beberapa authentication mechanism utama:

1. BASIC,
2. FORM,
3. DIGEST,
4. CLIENT-CERT.

Dalam Jakarta EE, mechanism yang wajib umum adalah BASIC, FORM, dan certificate/mutual TLS. DIGEST ada secara historis tetapi tidak selalu ideal untuk sistem modern.

---

## 5. BASIC Authentication

### 5.1 Cara Kerja

HTTP BASIC memakai header:

```text
Authorization: Basic base64(username:password)
```

Flow:

```text
Client request protected resource
    |
    v
Container sees no credential
    |
    v
Respond 401 WWW-Authenticate: Basic realm="..."
    |
    v
Browser/client sends Authorization header
    |
    v
Container validates username/password via realm
    |
    v
Request proceeds if valid
```

---

### 5.2 Contoh `web.xml`

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.0">

    <security-constraint>
        <web-resource-collection>
            <web-resource-name>Protected API</web-resource-name>
            <url-pattern>/api/*</url-pattern>
        </web-resource-collection>
        <auth-constraint>
            <role-name>api-user</role-name>
        </auth-constraint>
    </security-constraint>

    <login-config>
        <auth-method>BASIC</auth-method>
        <realm-name>Example API</realm-name>
    </login-config>

    <security-role>
        <role-name>api-user</role-name>
    </security-role>
</web-app>
```

---

### 5.3 Kelebihan

BASIC sederhana:

- mudah dipakai oleh API client,
- tidak butuh login page,
- cocok untuk tool internal kecil,
- cocok untuk prototyping protected endpoint,
- didukung luas.

---

### 5.4 Kekurangan

BASIC punya beberapa kelemahan:

1. Credential dikirim berulang pada setiap request.
2. Harus selalu memakai HTTPS.
3. Browser dapat menyimpan credential.
4. Logout sulit secara UX.
5. Tidak punya session lifecycle yang kaya.
6. Tidak punya built-in MFA.
7. Tidak ideal untuk user-facing modern web app.
8. Password exposure blast radius tinggi.

BASIC bukan berarti password dikirim plain text di network jika HTTPS aktif. Tetapi secara HTTP semantic, credential berada di header setiap request dan hanya base64-encoded, bukan encrypted oleh BASIC itu sendiri.

---

### 5.5 Failure Mode: Logout BASIC

`request.logout()` dapat membersihkan authenticated identity di container, tetapi browser mungkin tetap menyimpan credential BASIC dan mengirim ulang pada request berikutnya.

Flow failure:

```text
User logout
    |
    v
Server clears identity
    |
    v
Browser sends Authorization: Basic ... again
    |
    v
Server authenticates user again
    |
    v
User appears not logged out
```

Karena itu BASIC tidak cocok jika logout UX adalah requirement penting.

---

### 5.6 Kapan BASIC Masuk Akal?

BASIC masih bisa masuk akal untuk:

- internal endpoint sementara,
- development-only protected endpoint,
- legacy integration,
- simple monitoring endpoint dengan network restriction,
- low-risk machine client over HTTPS,
- bootstrap flow yang kemudian diganti token.

Namun untuk production public user authentication, BASIC biasanya bukan pilihan ideal.

---

## 6. FORM Authentication

### 6.1 Cara Kerja

FORM authentication adalah container-managed browser login.

Flow umum:

```text
User requests /admin
    |
    v
Container detects protected resource
    |
    v
Container redirects to login page
    |
    v
User submits username/password to special login action
    |
    v
Container validates credential
    |
    v
Container redirects to originally requested resource
```

Dalam Servlet FORM authentication klasik, form login biasanya submit ke endpoint khusus:

```text
j_security_check
```

Dengan field:

```text
j_username
j_password
```

Contoh:

```html
<form method="post" action="j_security_check">
    <input type="text" name="j_username">
    <input type="password" name="j_password">
    <button type="submit">Login</button>
</form>
```

---

### 6.2 Contoh `web.xml`

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin Area</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>admin</role-name>
    </auth-constraint>
</security-constraint>

<login-config>
    <auth-method>FORM</auth-method>
    <form-login-config>
        <form-login-page>/login.xhtml</form-login-page>
        <form-error-page>/login-error.xhtml</form-error-page>
    </form-login-config>
</login-config>

<security-role>
    <role-name>admin</role-name>
</security-role>
```

---

### 6.3 Saved Request

FORM authentication biasanya perlu mengingat request asli.

Contoh:

```text
User: GET /admin/report
Container: redirect /login
User: POST /j_security_check
Container: success
Container: redirect back /admin/report
```

Ini berarti container dapat menyimpan state sementara di session.

Masalah yang muncul:

- request asli terlalu besar,
- method POST perlu disimpan,
- body perlu dibuffer,
- session bisa dibuat sebelum login,
- session fixation harus ditangani,
- redirect target harus aman.

---

### 6.4 Kelebihan

FORM auth:

- cocok untuk browser app tradisional,
- UX lebih baik dari BASIC,
- dapat memakai custom login page,
- integrasi dengan session,
- role check container bisa langsung dipakai.

---

### 6.5 Kekurangan

FORM auth klasik:

- kurang fleksibel dibanding OIDC modern,
- raw password masuk ke aplikasi/container,
- MFA tidak natural kecuali custom flow,
- forgot password tidak standard,
- CSRF login perlu dipikirkan,
- `j_security_check` behavior bisa vendor-specific,
- integrasi SPA tidak ideal,
- session state harus dikelola benar.

---

### 6.6 Failure Mode: Login Page Protected

Kesalahan umum:

```xml
<url-pattern>/*</url-pattern>
```

Lalu login page sendiri juga ikut protected.

Akibat:

```text
Request /admin
    -> redirect /login
        -> /login protected
            -> redirect /login
                -> loop
```

Solusi:

- exclude login page,
- exclude static assets,
- define constraint dengan hati-hati,
- pastikan error page bisa diakses anonymous.

---

### 6.7 Failure Mode: Static Asset Protected

Login page butuh CSS/JS/image:

```html
<link rel="stylesheet" href="/assets/login.css">
```

Tetapi `/assets/*` protected.

Akibat:

- login page tampil rusak,
- browser gagal memuat JS,
- form tidak submit benar,
- user mengira aplikasi down.

Rule:

```text
Login resources must be anonymously accessible.
```

---

## 7. DIGEST Authentication

### 7.1 Gambaran

DIGEST authentication dirancang untuk menghindari pengiriman password langsung seperti BASIC. Ia memakai challenge-response digest.

Secara historis:

```text
server sends nonce
client computes digest(username, realm, password, method, URI, nonce, ...)
server verifies
```

---

### 7.2 Kenapa DIGEST Kurang Populer Modern?

DIGEST punya banyak masalah praktis:

- kompleks,
- tidak cocok dengan modern password hashing storage,
- butuh server mengetahui password equivalent,
- browser support dan behavior tidak ideal,
- kalah oleh HTTPS + better auth protocols,
- tidak cocok untuk federated login,
- jarang dipilih untuk sistem baru.

Jika password disimpan dengan BCrypt/Argon2, server tidak punya raw password untuk menghitung HA1 kecuali menyimpan format khusus. Ini menciptakan trade-off buruk.

---

### 7.3 Kapan Perlu Dipahami?

DIGEST perlu dipahami untuk:

- maintenance legacy app,
- container security compatibility,
- audit security lama,
- migration analysis.

Namun untuk sistem baru, biasanya pilih:

- FORM + session untuk legacy browser,
- OIDC authorization code + PKCE untuk modern browser,
- API key/HMAC/mTLS/OAuth2 client credentials untuk machine client.

---

## 8. CLIENT-CERT Authentication

### 8.1 Cara Kerja

CLIENT-CERT authentication memakai TLS client certificate. Ini bentuk mutual TLS.

Flow:

```text
Client opens TLS connection
    |
    v
Server requests client certificate
    |
    v
Client proves possession of private key
    |
    v
TLS handshake succeeds
    |
    v
Container receives certificate chain
    |
    v
Container maps certificate to principal
    |
    v
Request proceeds as authenticated user/service
```

---

### 8.2 Contoh `web.xml`

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Certificate Protected</web-resource-name>
        <url-pattern>/secure/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>cert-user</role-name>
    </auth-constraint>
</security-constraint>

<login-config>
    <auth-method>CLIENT-CERT</auth-method>
</login-config>

<security-role>
    <role-name>cert-user</role-name>
</security-role>
```

---

### 8.3 Kelebihan

CLIENT-CERT kuat karena:

- credential tidak dikirim sebagai shared secret,
- private key tidak perlu meninggalkan client,
- replay resistance lebih kuat,
- cocok untuk service-to-service,
- cocok untuk high assurance partner API,
- bisa dipakai dengan hardware-backed key,
- cocok untuk regulated environment.

---

### 8.4 Kekurangan

CLIENT-CERT rumit secara operasional:

- certificate issuance,
- CA trust,
- revocation,
- rotation,
- expiry,
- client onboarding,
- keystore/truststore management,
- proxy/TLS termination,
- certificate-to-principal mapping,
- debugging handshake.

---

### 8.5 App-level vs Connector-level Enforcement

Ini penting.

mTLS bisa ditegakkan di:

1. load balancer,
2. ingress controller,
3. reverse proxy,
4. service mesh,
5. servlet connector,
6. web application security constraint.

Jika TLS diterminate sebelum container, container mungkin tidak melihat client certificate secara native.

Topology:

```text
Client
  -> LB terminates mTLS
  -> forwards HTTP to Tomcat
```

Dalam topology ini, Tomcat tidak otomatis tahu client certificate kecuali LB meneruskan informasi certificate secara aman, misalnya via header internal yang dipercaya hanya dari LB.

Risiko:

```text
Attacker sends forged X-Client-Cert header
    -> app trusts header
    -> attacker impersonates certificate identity
```

Rule:

> Jika certificate identity diteruskan melalui header, header itu harus disanitasi dan hanya diterima dari trusted proxy path.

---

### 8.6 Failure Mode: Certificate Auth Only at Connector

Dalam beberapa setup, client certificate diverifikasi di connector/TLS layer, tetapi aplikasi tidak memiliki security constraint yang menuntut CLIENT-CERT untuk resource tersebut.

Risiko:

- asumsi “TLS sudah cukup”,
- endpoint lain terbuka,
- connector behavior tidak sama dengan app-level authorization,
- role mapping tidak terjadi,
- audit tidak punya principal container.

Rule:

```text
Transport authentication must be connected to application identity model.
```

---

## 9. Declarative Security

### 9.1 Konsep

Declarative security berarti security policy dinyatakan melalui metadata, bukan imperative code.

Bentuknya:

- `web.xml`,
- annotation seperti `@ServletSecurity`,
- deployment descriptor override,
- container configuration.

Contoh annotation:

```java
import jakarta.servlet.annotation.HttpConstraint;
import jakarta.servlet.annotation.ServletSecurity;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;

@WebServlet("/admin")
@ServletSecurity(
    @HttpConstraint(rolesAllowed = {"admin"})
)
public class AdminServlet extends HttpServlet {
}
```

---

### 9.2 Kelebihan Declarative Security

- Policy terlihat di deployment/config.
- Container dapat enforce sebelum servlet dipanggil.
- Mengurangi duplikasi check di code.
- Cocok untuk coarse-grained boundary.
- Bisa diaudit dengan scanning descriptor.
- Standardized di Java web ecosystem.

---

### 9.3 Kekurangan Declarative Security

- Kurang fleksibel untuk business authorization kompleks.
- Role model cenderung coarse-grained.
- Sulit jika rule tergantung object ownership.
- Bisa tersebar antara XML, annotation, container config.
- Bisa bertabrakan dengan framework security.
- Debugging matching URL/method bisa sulit.

---

### 9.4 Rule of Thumb

Gunakan declarative security untuk:

```text
coarse boundary:
- /admin/*
- /internal/*
- /api/partner/*
- /monitoring/*
```

Gunakan application authorization untuk:

```text
fine-grained decision:
- user boleh lihat case tertentu?
- officer boleh approve transition ini?
- tenant boleh akses record ini?
- role ini boleh edit hanya field tertentu?
```

---

## 10. Programmatic Security

### 10.1 `request.authenticate(response)`

Method ini meminta container melakukan authentication untuk request saat ini.

Contoh:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws IOException, ServletException {

    if (request.getUserPrincipal() == null) {
        boolean success = request.authenticate(response);
        if (!success) {
            return;
        }
    }

    response.getWriter().println("Hello " + request.getUserPrincipal().getName());
}
```

Mental model:

```text
Application explicitly asks container:
"authenticate this request according to configured mechanism."
```

---

### 10.2 `request.login(username, password)`

Method ini melakukan programmatic login menggunakan username/password.

Contoh:

```java
try {
    request.login(username, password);
} catch (ServletException ex) {
    response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
    return;
}
```

Jika berhasil, container principal tersedia:

```java
Principal principal = request.getUserPrincipal();
```

---

### 10.3 Kapan `request.login()` Dipakai?

- custom login form,
- programmatic login after registration,
- bridging legacy login UI to container auth,
- testing simple container auth behavior,
- migration dari manual auth ke container auth.

Namun di sistem modern, hati-hati:

- raw password masuk ke application layer,
- error handling harus aman,
- throttling tidak otomatis,
- CSRF login perlu dipikirkan,
- session fixation tetap perlu dipastikan.

---

### 10.4 `request.logout()`

`request.logout()` membersihkan authenticated identity dari request/container.

Contoh:

```java
request.logout();
request.getSession().invalidate();
response.sendRedirect("/login?logout");
```

Penting:

`logout()` dan `session.invalidate()` bukan hal yang sama.

```text
request.logout()
    -> clears container authentication state

session.invalidate()
    -> destroys HTTP session
```

Pada FORM auth, biasanya butuh keduanya.

Pada BASIC, browser bisa mengirim credential lagi.

Pada OIDC/SAML, perlu federated logout terpisah.

---

### 10.5 `request.isUserInRole(role)`

Contoh:

```java
if (!request.isUserInRole("admin")) {
    response.sendError(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

Gunakan untuk coarse role check. Jangan jadikan satu-satunya authorization model jika aplikasi punya domain rule kompleks.

---

## 11. Request Lifecycle dengan Container Security

### 11.1 Simplified Lifecycle

```text
1. Connector menerima HTTP request
2. Container membuat request/response object
3. Container mencari matching context/app
4. Container mengevaluasi security constraint
5. Jika protected:
   a. cek existing authenticated session
   b. jika belum, trigger auth mechanism
   c. validasi credential via realm/security domain
   d. attach principal/roles
6. Filter chain berjalan
7. Servlet/resource dipanggil
8. Response dikirim
```

---

### 11.2 Posisi Filter

Filter bisa berada setelah beberapa keputusan container security.

Simplified:

```text
Container Security Check
    -> Application Filter Chain
        -> Servlet
```

Tetapi detail bisa berbeda tergantung container, dispatch type, dan integration framework.

Implikasi:

- custom filter mungkin tidak dipanggil untuk unauthenticated protected request,
- redirect ke login bisa terjadi sebelum filter application,
- global logging filter mungkin tidak melihat semua failure auth,
- metrics auth failure perlu instrumentasi container/framework.

---

### 11.3 Dispatch Type

Servlet punya dispatch type:

- REQUEST,
- FORWARD,
- INCLUDE,
- ERROR,
- ASYNC.

Security constraint dan filter mapping bisa dipengaruhi dispatch.

Failure mode:

```text
Endpoint /secure protected
    -> forwards to /internal/view
        -> /internal/view assumed protected but direct access not blocked
```

Rule:

> Jangan mengandalkan forward path saja. Protect direct URL jika bisa diakses langsung.

---

## 12. URL Pattern dan Constraint Matching

### 12.1 URL Pattern

Servlet security constraint memakai URL pattern seperti:

```text
/admin/*
/api/*
*.jsp
/
```

Kesalahan matching dapat menyebabkan endpoint terbuka.

Contoh masalah:

```xml
<url-pattern>/admin*</url-pattern>
```

Banyak engineer mengira ini match `/admin/users`, padahal Servlet URL pattern punya aturan khusus dan bukan regex bebas.

---

### 12.2 Method-Specific Constraint

Security constraint bisa dibatasi method:

```xml
<web-resource-collection>
    <web-resource-name>Admin Write</web-resource-name>
    <url-pattern>/admin/*</url-pattern>
    <http-method>POST</http-method>
    <http-method>PUT</http-method>
    <http-method>DELETE</http-method>
</web-resource-collection>
```

Risiko:

- GET protected, POST lupa.
- POST protected, DELETE lupa.
- OPTIONS tidak dipikirkan.
- TRACE tidak dimatikan.
- method override header tidak diperhitungkan.

---

### 12.3 Deny Uncovered HTTP Methods

Beberapa deployment perlu memastikan method yang tidak disebut tidak otomatis terbuka.

Mental model:

```text
If you protect only selected methods,
what happens to the methods you did not mention?
```

Untuk sistem sensitif, lebih aman:

- define all methods explicitly,
- deny uncovered methods,
- block unsupported methods di edge/container,
- test matrix method × path.

---

## 13. Role Declaration dan Mapping

### 13.1 Security Role

Di `web.xml`:

```xml
<security-role>
    <role-name>admin</role-name>
</security-role>
```

Ini mendeklarasikan role yang dipakai aplikasi.

---

### 13.2 Role Mapping

Container bisa memetakan role aplikasi ke group/role external.

Contoh konsep:

```text
Application role: admin
External LDAP group: CN=ACEAS_Admin,OU=Groups,DC=example,DC=com
```

Mapping bisa hidup di:

- container config,
- deployment descriptor,
- vendor-specific descriptor,
- realm,
- identity store,
- framework adapter.

---

### 13.3 Failure Mode: Role Name Drift

Aplikasi pakai:

```java
request.isUserInRole("ADMIN")
```

Descriptor pakai:

```xml
<role-name>admin</role-name>
```

External group pakai:

```text
APP_ADMIN
```

Jika tidak ada mapping konsisten, user authenticated tetapi selalu forbidden.

Rule:

> Authentication identifier dan authorization role vocabulary harus distandardisasi.

---

### 13.4 Role bukan Permission

Role seperti `admin` tidak menjawab:

- admin tenant mana?
- admin modul mana?
- boleh approve state transition apa?
- boleh edit case yang sudah submitted?
- boleh act on behalf user lain?
- boleh view sealed document?

Untuk sistem regulatori/case management, role container hanya boundary awal. Domain authorization tetap harus eksplisit.

---

## 14. Container Realm dan Credential Backend

### 14.1 Memory/File Realm

Untuk development:

```text
user alice password secret roles admin
```

Tidak cocok untuk production serius kecuali sangat terbatas.

Risiko:

- password plain/weak hash,
- tidak terpusat,
- sulit rotate,
- tidak ada audit,
- deployment restart untuk update.

---

### 14.2 JDBC/DataSource Realm

Container memvalidasi credential ke database.

Pattern:

```text
username/password
    -> query users table
    -> verify password
    -> query roles table
    -> build principal
```

Masalah yang harus dicek:

- hash algorithm,
- timing attack,
- account status,
- locked/disabled user,
- password migration,
- SQL query performance,
- connection pool exhaustion during login storm.

---

### 14.3 LDAP Realm

Pattern:

```text
search user DN
    -> bind as user
    -> lookup group
    -> map group to role
```

Masalah:

- nested group,
- referral,
- LDAP timeout,
- service account lockout,
- group explosion,
- caching stale role,
- directory outage.

---

### 14.4 JAAS Realm

Container dapat mendelegasikan ke JAAS LoginModule.

Pattern:

```text
container auth
    -> JAAS LoginContext
        -> LoginModule chain
            -> Subject + Principals
```

Ini berguna untuk integrasi legacy/security domain, tetapi kompleks.

---

### 14.5 Custom Realm

Custom realm sering dipakai untuk:

- legacy password database,
- external service validation,
- proprietary SSO,
- certificate mapping khusus,
- multi-tenant authentication.

Risiko custom realm:

- implementasi password verification salah,
- tidak handle timing,
- tidak handle lockout,
- tidak cache dengan benar,
- tidak thread-safe,
- tidak observability,
- vendor lock-in,
- sulit migrasi.

---

## 15. Session Interaction

### 15.1 FORM Auth dan Session

FORM auth biasanya memakai session untuk:

- menyimpan saved request,
- menyimpan authenticated state,
- mempertahankan login,
- tracking timeout.

Flow:

```text
Unauthenticated request /admin
    -> create/session use JSESSIONID
    -> save original request
    -> redirect login
    -> login success
    -> associate principal with session
    -> redirect original request
```

---

### 15.2 Session Fixation

Jika session sudah ada sebelum login, attacker bisa mencoba memaksa victim memakai session ID tertentu.

Mitigation:

```text
on successful authentication:
    rotate/change session ID
```

Modern container/framework biasanya punya mekanisme session ID change, tetapi engineer harus memastikan behavior pada setup-nya.

---

### 15.3 Logout dan Session Invalidation

Untuk FORM auth:

```java
request.logout();

HttpSession session = request.getSession(false);
if (session != null) {
    session.invalidate();
}

response.sendRedirect("/login?logout");
```

Jangan hanya invalidate session jika container auth state masih ada di tempat lain. Jangan hanya logout jika session menyimpan state aplikasi sensitif.

---

### 15.4 Clustered Session

Container-managed auth dalam cluster butuh jawaban:

- apakah session replicated?
- apakah sticky session aktif?
- apakah principal serializable?
- apakah role update langsung terlihat?
- apakah logout node A invalid di node B?
- apakah session timeout konsisten?
- apakah saved request survive failover?

Untuk sistem modern, sering lebih jelas menggunakan:

```text
central session store
or
stateless token + explicit revocation strategy
or
BFF session with Redis
```

Namun jika memakai container session replication, pahami behavior container yang digunakan.

---

## 16. Container Authentication dan Spring Security

### 16.1 Dua Security Context Berbeda

Spring Security punya context sendiri:

```java
SecurityContextHolder.getContext().getAuthentication()
```

Servlet container punya request principal:

```java
request.getUserPrincipal()
```

Mereka tidak otomatis sama.

Kemungkinan:

```text
Container principal exists, Spring Authentication null.
Spring Authentication exists, request.getUserPrincipal() null.
Both exist but represent different users.
Both exist but roles differ.
```

Ini bahaya.

---

### 16.2 Spring Security Filter Chain

Spring Security biasanya melakukan authentication di filter chain application.

Simplified:

```text
Container
    -> Spring Security Filter Chain
        -> Controller
```

Jika container security constraints juga aktif, urutan dan tanggung jawab harus jelas.

---

### 16.3 Mode Integrasi

Beberapa model:

#### Model 1 — Spring owns authentication

```text
container does not enforce auth constraints
Spring Security authenticates all protected routes
```

Ini paling umum untuk Spring Boot.

#### Model 2 — Container owns authentication

```text
container authenticates
Spring reads pre-authenticated principal
```

Cocok untuk:

- SSO gateway,
- container realm,
- mTLS at container,
- legacy app modernization.

#### Model 3 — Mixed

```text
some routes container auth
some routes Spring auth
```

Ini paling berisiko kecuali dirancang eksplisit.

---

### 16.4 Failure Mode: Double Authentication

Contoh:

```text
Container FORM auth protects /admin/*
Spring Security also has formLogin for /admin/*
```

Akibat:

- double redirect,
- login loop,
- inconsistent logout,
- different session strategies,
- principal mismatch,
- user authenticated in one layer but rejected by another.

Rule:

> Satu route harus punya satu owner utama authentication.

---

### 16.5 Pre-Authenticated Pattern

Jika container/gateway sudah authenticate, Spring dapat memakai pre-authenticated model.

Conceptual:

```text
Container Principal
    -> Spring pre-auth filter
        -> Authentication object
            -> application authorization
```

Tetap perlu validasi:

- principal source trusted?
- role mapping jelas?
- request header tidak spoofable?
- logout behavior jelas?
- anonymous path jelas?

---

## 17. Container Authentication dan Jakarta Security

### 17.1 Jakarta Security sebagai Modern Standard

Jakarta Security memperkenalkan API yang lebih ramah aplikasi dibanding hanya `web.xml` dan realm vendor-specific.

Konsep utama:

- `HttpAuthenticationMechanism`,
- `IdentityStore`,
- `SecurityContext`.

Jakarta Security tetap bekerja bersama container. Ia tidak sama dengan Spring Security yang umumnya application filter framework.

---

### 17.2 Relationship dengan Servlet Container

Mental model:

```text
Servlet Container
    -> Jakarta Authentication SPI / bridge
        -> Jakarta Security HttpAuthenticationMechanism
            -> IdentityStore
                -> CredentialValidationResult
```

Aplikasi bisa mendefinisikan mechanism standard seperti:

- Basic,
- Form,
- Custom Form,
- OpenID Connect,
- custom mechanism.

---

### 17.3 Kenapa Part Ini Dipisah dari Jakarta Security?

Karena container authentication adalah lapisan dasar:

```text
Servlet security constraint
login-config
request principal
request.login/logout
realm
role mapping
```

Jakarta Security membangun abstraksi lebih modern di atas/bersama container. Itu sudah dibahas di series lain dan akan disinggung lagi nanti saat identity provider integration.

Part ini fokus ke fondasi container agar saat membaca Jakarta Security/Spring Security, boundary-nya jelas.

---

## 18. Container Authentication dan JAX-RS

### 18.1 Principal Access di JAX-RS

Dalam JAX-RS, security context bisa membaca principal:

```java
@Context
SecurityContext securityContext;

@GET
@Path("/me")
public Response me() {
    Principal p = securityContext.getUserPrincipal();
    return Response.ok(p.getName()).build();
}
```

Jika JAX-RS berjalan di Servlet container, context ini biasanya berasal dari container/request.

---

### 18.2 Annotation Authorization

JAX-RS/Jakarta REST bisa memakai role annotations tergantung integrasi:

```java
@RolesAllowed("admin")
```

Namun behavior bergantung pada runtime dan integrasi security.

Rule:

> Jangan asumsikan annotation authorization aktif tanpa memastikan container/runtime security integration.

---

### 18.3 Failure Mode

```text
Servlet says user is authenticated
JAX-RS SecurityContext says null
```

Penyebab:

- JAX-RS runtime tidak terintegrasi dengan container security,
- filter custom mengganti principal,
- request tidak melewati security constraint,
- authentication dilakukan di framework lain,
- async/resource invocation kehilangan context.

---

## 19. Async Processing dan Principal

### 19.1 Servlet Async

Servlet mendukung async request:

```java
AsyncContext async = request.startAsync();
```

Pertanyaannya:

```text
Apakah principal tetap valid saat pekerjaan async berjalan?
```

Harus hati-hati karena:

- request lifecycle berubah,
- thread bisa berbeda,
- ThreadLocal tidak otomatis sama,
- session bisa invalidated saat async masih berjalan,
- user bisa logout sebelum async selesai.

---

### 19.2 Rule

Untuk async work:

```text
Capture identity snapshot explicitly.
Do not blindly depend on live request object.
```

Contoh identity snapshot:

```java
record AuthenticatedActor(
    String subjectId,
    String principalName,
    Set<String> roles,
    String sessionId,
    Instant authenticatedAt
) {}
```

Jika async job membuat perubahan bisnis, audit harus mencatat actor yang memulai job, bukan thread yang menjalankan job.

---

## 20. Error Handling

### 20.1 401 vs 403

Container harus membedakan:

```text
401 Unauthorized = caller belum authenticated / harus authenticate
403 Forbidden    = caller authenticated tetapi tidak punya akses
```

Dalam praktik:

- BASIC menghasilkan 401 challenge,
- FORM menghasilkan redirect login,
- role mismatch menghasilkan 403,
- invalid credential bisa kembali login error page.

---

### 20.2 Jangan Bocorkan Detail

Login failure jangan membedakan secara jelas:

```text
username not found
password wrong
account exists but disabled
```

Untuk user-facing:

```text
Invalid username or password
```

Untuk audit internal:

```text
FAILED_LOGIN_USER_NOT_FOUND
FAILED_LOGIN_BAD_PASSWORD
FAILED_LOGIN_DISABLED_ACCOUNT
```

Tetapi audit harus privacy-safe dan protected.

---

### 20.3 Custom Error Page

Pastikan error page:

- tidak protected,
- tidak memicu redirect loop,
- tidak membocorkan stacktrace,
- tidak membocorkan username,
- tetap punya correlation ID.

---

## 21. Browser Behavior yang Mempengaruhi Container Auth

### 21.1 BASIC Credential Cache

Browser dapat menyimpan BASIC credentials selama tab/session/browser lifetime.

Server tidak punya kontrol penuh untuk “hapus” cache browser.

---

### 21.2 Cookie dan FORM Auth

FORM auth biasanya memakai `JSESSIONID`.

Pastikan cookie:

- `Secure`,
- `HttpOnly`,
- `SameSite`,
- domain/path benar,
- tidak terlalu luas,
- tidak tercampur antar aplikasi.

---

### 21.3 SameSite dan Cross-Site Login

Jika login melibatkan cross-site redirect, SSO, atau embedded app, `SameSite` bisa mempengaruhi apakah session cookie terkirim.

Untuk pure container FORM auth same-site, lebih sederhana. Untuk federated auth, perlu analisis khusus.

---

## 22. Security Boundary dengan Reverse Proxy

### 22.1 Header Trust Problem

Reverse proxy sering menambahkan header:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Client-Cert
X-Authenticated-User
```

Jika aplikasi/container mempercayai header tersebut, harus ada invariant:

> Header identitas hanya boleh berasal dari trusted proxy dan harus dihapus/di-normalize dari request external.

---

### 22.2 Common Failure

```text
Internet client sends:
X-Authenticated-User: admin
```

Jika proxy tidak menghapus header dan aplikasi mempercayainya, authentication bypass terjadi.

---

### 22.3 Safe Pattern

```text
External request
    -> edge proxy strips identity headers
    -> proxy authenticates user/cert
    -> proxy injects identity header
    -> app accepts header only from proxy network/mTLS
```

Better:

- use mTLS between proxy and app,
- restrict source IP,
- strip incoming headers,
- sign forwarded identity,
- prefer standard token/assertion where possible,
- log trusted identity source.

---

## 23. API vs Browser: Jangan Salah Pakai Container FORM

### 23.1 FORM Tidak Cocok untuk Pure API

Jika REST API dipanggil oleh mobile/service/client, FORM auth bisa menghasilkan:

```text
302 redirect to /login
```

Client API mengharapkan:

```text
401 JSON error
```

Akibat:

- client bingung,
- retry salah,
- HTML login page masuk ke API response,
- observability kacau,
- security behavior tidak jelas.

Untuk API, pertimbangkan:

- bearer token,
- API key,
- HMAC,
- mTLS,
- OAuth2 resource server,
- BASIC hanya untuk kasus terbatas.

---

### 23.2 Mixed Web + API

Jika satu aplikasi punya browser UI dan API:

```text
/ui/*      -> FORM/session
/api/*     -> token or 401 JSON
```

Jangan satu `login-config FORM` memaksa semua endpoint API redirect ke login page.

Gunakan separation:

- different context path,
- different app,
- different filter chain,
- explicit route policy,
- BFF pattern.

---

## 24. Authentication State Machine

Untuk container FORM auth, state machine sederhana:

```text
ANONYMOUS
    |
    | request protected resource
    v
AUTHENTICATION_REQUIRED
    |
    | redirect login
    v
CREDENTIAL_SUBMITTED
    |
    | valid
    v
AUTHENTICATED
    |
    | lacks role
    v
FORBIDDEN
```

Dengan failure:

```text
CREDENTIAL_SUBMITTED
    |
    | invalid
    v
AUTHENTICATION_FAILED
    |
    | show error page
    v
ANONYMOUS or RETRY_ALLOWED
```

Dengan logout:

```text
AUTHENTICATED
    |
    | logout + session invalidate
    v
ANONYMOUS
```

Dengan timeout:

```text
AUTHENTICATED
    |
    | idle timeout
    v
SESSION_EXPIRED
    |
    | request protected
    v
AUTHENTICATION_REQUIRED
```

---

## 25. Identity Model: Jangan Berhenti di Username

Container sering memberi:

```java
principal.getName()
```

Tetapi aplikasi top-tier harus punya canonical actor model.

Contoh:

```text
Container Principal:
    name = "fajar@example.com"

Application Actor:
    subjectId = "usr_01J..."
    identityProvider = "local-db"
    externalSubject = "fajar@example.com"
    displayName = "Fajar"
    actorType = HUMAN_USER
    authenticationMethod = FORM_PASSWORD
    assuranceLevel = LOW/MEDIUM/HIGH
    sessionId = "..."
```

Kenapa?

Karena username/email bisa berubah. Audit dan authorization butuh identifier stabil.

---

## 26. Production Design Checklist

### 26.1 Ownership

- Siapa owner authentication untuk setiap route?
- Container?
- Spring Security?
- Jakarta Security?
- Gateway?
- Custom filter?

Tidak boleh ambigu.

---

### 26.2 Route Protection

- Apakah semua protected route tertutup?
- Apakah login page anonymous?
- Apakah static asset login anonymous?
- Apakah error page anonymous?
- Apakah API tidak redirect ke HTML login?
- Apakah method selain GET/POST diperiksa?

---

### 26.3 Session

- Apakah session ID rotate setelah login?
- Apakah idle timeout jelas?
- Apakah absolute timeout ada?
- Apakah logout invalidate session?
- Apakah concurrent session behavior jelas?
- Apakah cluster session valid?

---

### 26.4 Credential Backend

- Password hash aman?
- Credential backend punya timeout?
- LDAP/database outage behavior jelas?
- Login storm tidak menjatuhkan DB?
- Account lockout/throttling tersedia?
- Disabled user langsung ditolak?
- Role update propagation jelas?

---

### 26.5 Principal and Role

- Apakah `principal.getName()` stabil?
- Apakah role mapping terdokumentasi?
- Apakah role case-sensitive?
- Apakah group-to-role mapping diuji?
- Apakah role bukan satu-satunya domain authorization?

---

### 26.6 Reverse Proxy

- Apakah identity header di-strip?
- Apakah `X-Forwarded-Proto` benar?
- Apakah secure cookie tetap secure di TLS termination?
- Apakah client cert forwarding aman?
- Apakah app hanya menerima trusted proxy?

---

### 26.7 Observability

- Login success logged?
- Login failure logged?
- Logout logged?
- Session timeout observable?
- Role denied logged?
- Correlation ID ada?
- Audit tidak menyimpan password/token?
- Error page tidak bocor detail?

---

## 27. Common Mistakes

### Mistake 1 — Mengaktifkan Container Security dan Spring Security Tanpa Boundary

Gejala:

- double login,
- redirect loop,
- principal mismatch,
- logout tidak konsisten.

Solusi:

```text
Choose one primary auth owner per route.
```

---

### Mistake 2 — Menganggap `getUserPrincipal()` Selalu Ada

Jika Spring Security authenticates user tetapi tidak bridge ke container, ini bisa null.

Solusi:

```text
Define source of truth.
Bridge explicitly if needed.
```

---

### Mistake 3 — Menjadikan Role Container sebagai Domain Authorization

Role `admin` tidak cukup untuk case-level authorization.

Solusi:

```text
Container role = coarse access.
Domain policy = fine-grained decision.
```

---

### Mistake 4 — Login Page Ikut Protected

Akibat redirect loop.

Solusi:

```text
Exclude login page, error page, and required static assets.
```

---

### Mistake 5 — API Mengembalikan HTML Login Page

Akibat FORM auth applied ke API.

Solusi:

```text
Separate browser and API authentication behavior.
```

---

### Mistake 6 — Trust Header dari Proxy Tanpa Sanitasi

Akibat authentication bypass.

Solusi:

```text
Strip inbound identity headers and accept only from trusted internal path.
```

---

### Mistake 7 — Tidak Memikirkan Logout per Mechanism

Logout BASIC, FORM, OIDC, SAML, dan mTLS berbeda.

Solusi:

```text
Design logout according to auth mode.
```

---

### Mistake 8 — Tidak Test HTTP Method Matrix

Endpoint GET protected, DELETE terbuka.

Solusi:

```text
Test path × method × role.
```

---

### Mistake 9 — Principal Name Dipakai Sebagai Permanent ID

Email berubah, audit rusak.

Solusi:

```text
Map to canonical internal subject ID.
```

---

### Mistake 10 — Realm Custom Tidak Production-Grade

Custom realm tanpa throttling, hash aman, atau timeout.

Solusi:

```text
Treat custom realm as security-critical infrastructure.
```

---

## 28. Deep Reasoning: Kapan Memakai Servlet Container Authentication?

### 28.1 Cocok Jika

Container authentication cocok jika:

- aplikasi legacy Servlet/JSP/JSF,
- Jakarta EE full profile,
- security policy coarse-grained,
- user store sudah di container realm,
- deployment environment standardizes realm,
- mTLS ingin ditegakkan di container,
- aplikasi ingin portable declarative security,
- tidak butuh complex federated login.

---

### 28.2 Kurang Cocok Jika

Kurang cocok jika:

- SPA modern dengan OIDC,
- microservices dengan bearer token,
- complex MFA/step-up,
- multi-tenant dynamic issuer,
- per-route auth mechanism berbeda,
- fine-grained API error semantics,
- identity berasal dari external IdP dengan dynamic claims,
- perlu complex token lifecycle.

---

### 28.3 Keputusan Realistis

Untuk aplikasi baru, biasanya:

```text
Spring Boot app:
    Spring Security owns authentication.

Jakarta EE app:
    Jakarta Security owns authentication, container participates.

Legacy Servlet app:
    Container authentication may remain, but boundary must be documented.

Partner service API:
    mTLS/HMAC/OAuth2 client credentials, not FORM.

Internal admin UI:
    OIDC via gateway/framework, or container FORM only if environment simple.
```

---

## 29. Design Matrix

| Scenario | Container BASIC | Container FORM | CLIENT-CERT | Spring/Jakarta Security | OIDC/OAuth2 |
|---|---:|---:|---:|---:|---:|
| Legacy JSP admin UI | Possible | Good | Rare | Possible | Possible |
| Modern SPA | Poor | Poor | Poor | Good with BFF | Good |
| Machine-to-machine API | Limited | Poor | Good | Good | Good |
| Partner high assurance API | Poor | Poor | Good | Good | Good |
| Internal tool low risk | Possible | Possible | Possible | Possible | Optional |
| Regulated case system | Not enough | Possible as coarse layer | Useful for service auth | Needed | Often needed |
| Multi-tenant SaaS | Poor | Limited | Useful internally | Good | Good |
| CLI client | Possible but weak | Poor | Possible | Good | Device/OAuth better |

---

## 30. Testing Strategy

### 30.1 Test Matrix

Minimal matrix:

```text
anonymous GET protected
anonymous POST protected
authenticated no role
authenticated correct role
authenticated wrong role
logout then access protected
session timeout then access protected
direct access login page
direct access static asset
unsupported method
```

---

### 30.2 Example Test Cases

```text
Given anonymous user
When GET /admin
Then response is 302 to /login or 401 depending mechanism
```

```text
Given authenticated user with role USER
When GET /admin
Then response is 403
```

```text
Given authenticated user with role ADMIN
When GET /admin
Then response is 200
```

```text
Given login success
Then session ID changes
```

```text
Given logout
When GET /admin
Then user must authenticate again
```

---

### 30.3 Manual Debug Checklist

Check:

- generated `web.xml` effective config,
- annotation scanning,
- container realm config,
- role mapping,
- app context path,
- cookie path/domain,
- proxy forwarding,
- TLS termination,
- server logs,
- browser devtools network,
- response status before redirect,
- `JSESSIONID` behavior,
- principal output endpoint.

---

## 31. Example Diagnostic Servlet

Untuk debugging non-production:

```java
@WebServlet("/debug/whoami")
public class WhoAmIServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        response.setContentType("text/plain");

        Principal principal = request.getUserPrincipal();

        response.getWriter().println("remoteUser=" + request.getRemoteUser());
        response.getWriter().println("principal=" + (principal == null ? "null" : principal.getName()));
        response.getWriter().println("authType=" + request.getAuthType());
        response.getWriter().println("isAdmin=" + request.isUserInRole("admin"));
        response.getWriter().println("sessionId=" +
                (request.getSession(false) == null ? "none" : request.getSession(false).getId()));
    }
}
```

Peringatan:

- Jangan aktifkan endpoint ini di production.
- Jangan tampilkan roles/identity detail ke user.
- Gunakan hanya untuk local/UAT troubleshooting dengan protection.

---

## 32. Version Notes: Java 8 sampai 25

### 32.1 Java Version vs Servlet Version

Java version dan Servlet/Jakarta Servlet version tidak sama.

Contoh:

```text
Java 8:
    javax.servlet era umum
    Servlet 3.x/4.x banyak dipakai
    Java EE 7/8 ecosystem

Java 11/17:
    migration era
    Jakarta namespace mulai relevan
    Spring Boot 2 ke 3 migration

Java 21/25:
    jakarta.* ecosystem dominan untuk modern Jakarta/Spring Boot 3+
    virtual threads memengaruhi context propagation di framework
```

---

### 32.2 `javax.servlet` vs `jakarta.servlet`

Perubahan besar:

```text
javax.servlet.*
    -> jakarta.servlet.*
```

Contoh lama:

```java
import javax.servlet.http.HttpServletRequest;
```

Modern:

```java
import jakarta.servlet.http.HttpServletRequest;
```

Migrasi bukan sekadar import jika library/framework belum compatible.

---

### 32.3 Container Compatibility

Contoh umum:

```text
Tomcat 9  -> javax.servlet
Tomcat 10 -> jakarta.servlet
```

Jika aplikasi Spring Boot 3/Jakarta modern deploy ke container lama, mismatch terjadi.

Rule:

> Pastikan Java version, Servlet API namespace, framework version, dan container version sejajar.

---

## 33. Container Auth dalam Regulatory/Enterprise Case Management

Untuk sistem seperti enforcement lifecycle/case management, authentication container bisa menjadi boundary awal:

```text
/admin/*
/internal/*
/agency/*
/public/*
```

Namun sistem regulatori biasanya butuh lebih dari role:

- officer assignment,
- agency boundary,
- case confidentiality,
- appeal phase,
- escalation state,
- delegation,
- acting capacity,
- maker-checker separation,
- audit defensibility,
- temporal permission,
- user status at time of action.

Container role tidak cukup.

Model yang lebih baik:

```text
Container/Spring/OIDC authentication:
    establishes actor identity

Domain authorization:
    decides whether actor can perform action on resource in current state

Audit:
    records actor + authentication method + decision + domain context
```

---

## 34. Architecture Pattern: Coarse Gate + Domain Policy

Recommended pattern untuk enterprise app:

```text
Layer 1: Edge / WAF
    - TLS
    - basic request filtering

Layer 2: Authentication owner
    - OIDC/Spring/Jakarta/container
    - establish actor

Layer 3: Coarse route authorization
    - /admin/*
    - /api/internal/*
    - /agency/*

Layer 4: Domain authorization
    - case state
    - tenant/agency
    - role
    - assignment
    - separation of duty

Layer 5: Audit
    - who
    - how authenticated
    - what action
    - what resource
    - what decision
    - why allowed/denied
```

Servlet container authentication can participate in Layer 2/3, but rarely solves Layer 4 alone.

---

## 35. Practical Decision Questions

Saat melihat aplikasi Java web, tanyakan:

1. Apakah authentication dimiliki container atau framework?
2. Apakah ada `web.xml` security constraint?
3. Apakah ada `@ServletSecurity`?
4. Apakah ada container realm?
5. Apakah Spring Security juga aktif?
6. Apakah Jakarta Security juga aktif?
7. Apakah `request.getUserPrincipal()` sama dengan framework identity?
8. Apakah logout membersihkan semua security context?
9. Apakah API mendapatkan 401 JSON atau redirect HTML?
10. Apakah role mapping terdokumentasi?
11. Apakah session ID rotate setelah login?
12. Apakah reverse proxy meneruskan identity header?
13. Apakah certificate auth ditegakkan di app atau hanya connector?
14. Apakah direct URL access terlindungi?
15. Apakah audit memakai stable subject ID?

---

## 36. Summary

Servlet Container Authentication adalah fondasi penting dalam sejarah dan arsitektur Java web.

Inti pemahamannya:

1. Container bisa menjadi security gatekeeper sebelum servlet/application dipanggil.
2. Security constraint menentukan resource yang protected.
3. `login-config` menentukan authentication mechanism.
4. BASIC sederhana tetapi lemah untuk UX/logout dan password exposure.
5. FORM cocok untuk legacy browser session app tetapi kurang ideal untuk API/SPA modern.
6. DIGEST terutama relevan untuk legacy.
7. CLIENT-CERT kuat tetapi operasionalnya kompleks.
8. `request.getUserPrincipal()`, `getRemoteUser()`, dan `isUserInRole()` adalah output identity/role container.
9. Realm/security domain adalah backend validasi credential dan role.
10. Container auth dan Spring Security/Jakarta Security harus punya boundary jelas.
11. Authentication tidak boleh berhenti di username; production system butuh canonical actor model.
12. Role container hanya coarse authorization, bukan domain policy lengkap.
13. Reverse proxy dan TLS termination bisa mengubah trust boundary.
14. Session lifecycle tetap critical untuk FORM auth.
15. Testing harus mencakup path, method, role, session, logout, dan proxy behavior.

Mental model paling penting:

```text
Authentication owner must be explicit.
Principal source must be trusted.
Route protection must be complete.
Session lifecycle must be controlled.
Domain authorization must not be replaced by container role alone.
```

---

## 37. Latihan Desain

### Latihan 1 — Legacy Admin UI

Aplikasi JSP legacy memakai Tomcat FORM auth dan JDBC realm.

Pertanyaan:

1. Bagaimana memastikan password hashing aman?
2. Di mana role mapping didefinisikan?
3. Bagaimana session fixation dicegah?
4. Bagaimana logout harus dilakukan?
5. Bagaimana audit mendapat stable subject ID?

---

### Latihan 2 — Spring Boot App di Tomcat External

Aplikasi Spring Boot WAR dideploy ke Tomcat external. Tomcat punya realm, Spring Security juga aktif.

Pertanyaan:

1. Siapa owner authentication?
2. Apakah `web.xml` security constraint masih perlu?
3. Bagaimana bridge container principal ke Spring?
4. Apa risiko double login?
5. Bagaimana test principal mismatch?

---

### Latihan 3 — Partner API dengan Client Certificate

Partner API menggunakan mTLS di load balancer, lalu request diteruskan ke Tomcat.

Pertanyaan:

1. Apakah Tomcat melihat certificate?
2. Jika certificate diteruskan via header, siapa yang boleh set header?
3. Bagaimana mencegah spoofing?
4. Bagaimana mapping certificate ke partner account?
5. Bagaimana certificate rotation dilakukan?

---

### Latihan 4 — API Mengembalikan Login HTML

REST API tiba-tiba mengembalikan HTML login page saat token expired.

Pertanyaan:

1. Apakah FORM auth diterapkan ke `/api/*`?
2. Apakah API seharusnya memakai separate auth entry point?
3. Apakah browser UI dan API perlu dipisah context path?
4. Bagaimana client membedakan 401 vs 302?
5. Bagaimana observability mencatat failure ini?

---

## 38. Referensi Resmi dan Lanjutan

Gunakan referensi ini untuk grounding:

1. Jakarta Servlet Specification 6.1 — Security chapters and authentication mechanisms.
2. Jakarta EE Tutorial — Securing Web Applications.
3. Jakarta EE Tutorial — Introduction to Security in Jakarta EE.
4. Jakarta Security Specification and API.
5. Apache Tomcat Realm Configuration How-To.
6. Apache Tomcat HTTP Connector Configuration.
7. Spring Security Reference — Servlet Authentication Architecture.
8. OWASP Session Management Cheat Sheet.
9. OWASP Authentication Cheat Sheet.
10. RFC 6265 / cookies behavior.

---

## 39. Status Series

Part yang sudah selesai:

- Part 0 — Orientation: Mental Model of Authentication in Java Systems
- Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
- Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
- Part 3 — Password Authentication Done Properly
- Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
- Part 5 — Servlet Container Authentication

Series belum selesai.

Part berikutnya:

```text
Part 6 — Jakarta Security and Jakarta Authentication Deep Dive
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-004.md">⬅️ Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-006.md">Part 6 — Jakarta Security and Jakarta Authentication Deep Dive ➡️</a>
</div>
