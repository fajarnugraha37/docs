# Part 00 — Orientation: Enterprise Java Security Mental Model

**Series:** `learn-java-jakarta-security-authentication-authorization-identity`  
**File:** `learn-java-jakarta-security-authentication-authorization-identity-part-00-orientation-and-mental-model.md`  
**Target reader:** Java backend / enterprise engineer yang sudah memahami Java core, Servlet, JAX-RS, CDI, persistence, reliability, testing, JVM, dan cryptography dasar.  
**Java scope:** Java 8 sampai Java 25.  
**Jakarta/Javax scope:** Java EE 8 / Jakarta EE 8 sampai Jakarta EE 11, dengan catatan transisi `javax.*` ke `jakarta.*`.

---

## 0. Tujuan Part Ini

Bagian ini adalah fondasi mental model sebelum masuk ke API, annotation, SPI, container behavior, OIDC, token, role mapping, dan authorization design.

Setelah bagian ini, tujuan utamanya bukan agar kita langsung hafal semua class seperti `SecurityContext`, `HttpAuthenticationMechanism`, `IdentityStore`, `ServerAuthModule`, atau `PolicyConfiguration`. Tujuan yang lebih penting adalah punya peta konseptual yang stabil:

1. **Security di Java enterprise adalah kerja sama antara aplikasi, container, identity provider, transport layer, session layer, policy layer, dan domain model.**
2. **Authentication bukan authorization.** Login berhasil tidak berarti caller boleh melakukan aksi tertentu.
3. **Role bukan permission.** Role biasanya coarse-grained; permission adalah hak melakukan aksi terhadap resource dalam konteks tertentu.
4. **Token bukan authorization final.** Token membawa klaim, tetapi aplikasi tetap perlu memutuskan apakah klaim itu cukup untuk aksi domain tertentu.
5. **Container security bukan hanya library.** Container memiliki lifecycle, deployment metadata, request context, thread context, policy mapping, dan enforcement point.
6. **Security bug sering muncul dari mismatch antar-layer**, bukan hanya dari salah menulis `if`.

Part ini akan membentuk kerangka berpikir untuk membaca seluruh seri berikutnya.

---

## 1. Kenapa Enterprise Java Security Perlu Dibahas Terpisah?

Pada banyak aplikasi sederhana, security sering direduksi menjadi:

```text
login page -> cek username/password -> simpan user di session -> cek role di controller
```

Untuk aplikasi kecil, model itu terlihat cukup. Tetapi pada sistem enterprise, apalagi sistem yang punya regulatory impact, workflow panjang, audit requirement, multi-role, multi-organization, dan integrasi SSO, model itu terlalu dangkal.

Security enterprise Java biasanya melibatkan:

```text
browser / client
  -> TLS / reverse proxy / API gateway
  -> web container / servlet container
  -> authentication mechanism
  -> identity store / external IdP
  -> application session / token context
  -> Jakarta Security / Servlet Security / JAX-RS / CDI / EJB
  -> role/group/claim mapping
  -> domain authorization policy
  -> persistence/data access guard
  -> audit trail
```

Di sistem nyata, satu request bisa membawa banyak konteks:

- caller identity,
- session id,
- access token,
- ID token,
- tenant id,
- organization id,
- active role,
- delegated actor,
- request correlation id,
- originating IP,
- device/browser context,
- route/API endpoint,
- target resource,
- current workflow state,
- previous approval history,
- data classification.

Kalau engineer hanya memahami “security = login”, maka banyak bug serius tidak terlihat:

- user sudah tidak punya role tapi session lama masih diberi akses,
- role dari IdP langsung dipakai sebagai permission bisnis,
- tenant id dari request parameter dipercaya begitu saja,
- API menganggap UI sudah menyembunyikan tombol sehingga backend tidak mengecek ulang,
- token diterima tanpa validasi audience,
- logout hanya menghapus cookie lokal tetapi token masih aktif,
- service internal percaya header `X-User` dari gateway tanpa spoofing protection,
- async job kehilangan identity atau memakai identity user sebelumnya,
- approval bisa dilakukan oleh maker yang sama karena rule tidak ada di domain authorization.

Enterprise security adalah tentang **menjaga invariant**, bukan sekadar menjalankan authentication flow.

---

## 2. Core Mental Model: Security Sebagai Rantai Keputusan

Security request lifecycle dapat dipahami sebagai rantai keputusan:

```text
[1] Request masuk
    |
[2] Apakah channel aman? TLS? trusted proxy? forwarded header valid?
    |
[3] Apakah request membawa credential/session/token?
    |
[4] Authentication mechanism memilih cara memvalidasi caller
    |
[5] Credential divalidasi ke identity store / IdP / token verifier
    |
[6] Caller identity dibentuk: principal + groups/claims
    |
[7] Identity ditempelkan ke container security context
    |
[8] Container/app melakukan authorization awal: URL/method/role
    |
[9] Domain authorization mengecek action-resource-context
    |
[10] Data access memastikan query tidak melewati boundary
    |
[11] Aksi dieksekusi
    |
[12] Audit event dicatat
```

Poin penting: setiap langkah memiliki failure mode berbeda.

Contoh:

| Langkah | Pertanyaan | Failure umum |
|---|---|---|
| Transport | Apakah channel aman? | TLS terminate di proxy tapi app mengira request HTTPS tanpa validasi forwarded header |
| Credential | Apa bukti caller? | Bearer token bocor, cookie tanpa `Secure`, password dilog |
| Authentication | Siapa caller? | issuer token salah diterima, session fixation, certificate mapping salah |
| Identity Mapping | Caller punya group/role apa? | group IdP berubah nama, role mapping stale |
| Container Authorization | Endpoint boleh diakses role apa? | annotation tidak aktif karena proxy/self-invocation/path mismatch |
| Domain Authorization | Boleh approve case ini? | role benar tapi user bukan assignee / maker-checker dilanggar |
| Data Access | Query dibatasi tenant/resource? | endpoint aman tapi repository leak cross-tenant |
| Audit | Bisa dibuktikan siapa melakukan apa? | audit hanya mencatat username, tidak mencatat delegated actor atau denial reason |

Engineer senior perlu melihat security sebagai **pipeline enforcement**, bukan satu check tunggal.

---

## 3. Peta Besar Spesifikasi dan Layer

Dalam dunia Java enterprise, ada banyak istilah yang tampak tumpang tindih:

- Java SE security,
- JAAS,
- Java EE Security,
- Servlet Security,
- JAX-RS Security,
- EJB method security,
- JASPIC,
- JACC,
- Jakarta Authentication,
- Jakarta Authorization,
- Jakarta Security,
- MicroProfile JWT,
- Spring Security,
- Keycloak adapter/integration,
- application-level domain authorization.

Agar tidak bingung, kita pecah menjadi layer.

### 3.1 Java SE Security

Java SE security adalah layer paling dasar di platform Java. Historisnya mencakup:

- class loading security,
- permissions,
- policy file,
- security manager,
- cryptography providers,
- keystore/truststore,
- JAAS primitives,
- TLS APIs,
- certificates,
- secure random,
- JCA/JCE.

Namun untuk aplikasi Jakarta modern, Java SE security biasanya bukan tempat utama kita mendefinisikan user access control. Ia lebih banyak menjadi fondasi untuk:

- TLS,
- certificate handling,
- cryptography,
- keystore/truststore,
- token signature verification,
- classpath/module behavior,
- low-level JAAS compatibility.

Catatan Java 8–25:

- Java 8 masih umum ditemukan di legacy Java EE 8.
- Java 11 dan 17 banyak dipakai sebagai LTS enterprise.
- Java 21 membawa virtual threads sebagai fitur final, yang penting untuk diskusi context propagation.
- Java 25 adalah LTS terbaru di rentang seri ini, sehingga kita perlu mempertimbangkan runtime modern sekaligus legacy compatibility.

### 3.2 Servlet Security

Servlet security adalah layer web container. Ia mengatur:

- URL security constraint,
- HTTP method constraint,
- form login,
- basic auth,
- client certificate auth,
- session identity,
- `HttpServletRequest.getUserPrincipal()`,
- `HttpServletRequest.isUserInRole()`.

Servlet security penting karena banyak aplikasi Jakarta berjalan di atas HTTP request lifecycle.

Mental model:

```text
Servlet container menerima request -> mengevaluasi security constraint -> menjalankan auth mechanism -> memasang principal ke request -> memutus akses URL/method
```

Kelemahannya: Servlet security biasanya coarse-grained. Ia bagus untuk menjawab:

```text
Apakah caller boleh mengakses /admin/*?
```

Tetapi tidak cukup untuk menjawab:

```text
Apakah officer A boleh approve case X pada state Y untuk agency Z, sementara officer A sebelumnya membuat recommendation?
```

Itu domain authorization.

### 3.3 Jakarta Security

Jakarta Security adalah API yang lebih developer-facing untuk membangun security pada aplikasi Jakarta EE modern. Ia menyediakan abstraction seperti:

- `SecurityContext`,
- `HttpAuthenticationMechanism`,
- `IdentityStore`,
- `Credential`,
- `CredentialValidationResult`,
- built-in authentication mechanism,
- annotation konfigurasi authentication,
- integrasi CDI.

Jakarta Security bukan pengganti seluruh security architecture. Ia adalah facade dan programming model yang lebih nyaman di atas container security.

Gunakan Jakarta Security ketika ingin:

- membuat custom authentication mechanism secara lebih mudah dibanding SPI low-level,
- menghubungkan login ke database/LDAP/custom identity store,
- mengecek caller principal dan role secara portable,
- menggunakan model security yang lebih dekat dengan kode aplikasi.

### 3.4 Jakarta Authentication

Jakarta Authentication adalah low-level SPI untuk authentication mechanism. Sebelumnya dikenal sebagai JASPIC.

Ia relevan ketika kita perlu mengintegrasikan mekanisme authentication yang sangat dekat dengan container request/response lifecycle.

Contoh kebutuhan:

- custom message authentication,
- container-level authentication module,
- authentication yang harus berjalan sebelum aplikasi melihat request,
- integrasi vendor/container yang membutuhkan SPI lebih rendah.

Secara sederhana:

```text
Jakarta Security = API lebih nyaman untuk developer aplikasi
Jakarta Authentication = SPI rendah untuk authentication module/container integration
```

### 3.5 Jakarta Authorization

Jakarta Authorization adalah low-level SPI untuk authorization provider. Sebelumnya dikenal sebagai JACC.

Ia mendefinisikan bagaimana container dapat mentransformasi metadata security seperti Servlet/EJB constraints menjadi permission, lalu menyerahkan evaluasi permission kepada provider.

Gunakan pemahaman Jakarta Authorization untuk:

- memahami bagaimana container memutus akses berbasis permission,
- memahami role mapping dan policy configuration,
- membuat integration dengan authorization engine enterprise,
- debugging masalah deployment-time permission mapping.

Tetapi dalam banyak aplikasi modern, engineer tidak selalu menulis provider Jakarta Authorization sendiri. Yang penting adalah memahami konsepnya karena ia menjelaskan bagaimana declarative authorization diproses oleh container.

### 3.6 JAAS

JAAS adalah Java Authentication and Authorization Service. Ia memperkenalkan konsep:

- `Subject`,
- `Principal`,
- `LoginContext`,
- `LoginModule`,
- `CallbackHandler`.

JAAS historis dan masih sering muncul di:

- app server configuration,
- legacy realm,
- vendor-specific login module,
- integration dengan LDAP/Kerberos/custom realm,
- internal container implementation.

Namun JAAS bukan programming model utama untuk aplikasi Jakarta modern. Ia penting sebagai vocabulary dan compatibility layer.

### 3.7 Framework Security seperti Spring Security

Spring Security sering berjalan di atas Servlet filter chain dan menyediakan model security sendiri:

- `SecurityContextHolder`,
- `Authentication`,
- `GrantedAuthority`,
- filter chain,
- method security,
- OAuth2/OIDC resource server/client,
- CSRF/CORS/session management.

Dalam aplikasi Spring Boot embedded container, Spring Security biasanya mengambil alih banyak fungsi yang di Jakarta EE dilakukan oleh container/Jakarta Security.

Poin penting: jangan mencampur dua model enforcement tanpa desain jelas.

Pertanyaan desain:

```text
Siapa source of truth identity?
Siapa melakukan token validation?
Siapa memutus URL access?
Siapa memutus method access?
Siapa memutus domain permission?
Bagaimana audit event dibuat?
```

---

## 4. Namespace: `javax.*` vs `jakarta.*`

Satu hal penting dalam seri ini adalah transisi namespace.

Secara historis:

- Java EE menggunakan package `javax.*`.
- Setelah pindah ke Eclipse Foundation, platform menjadi Jakarta EE.
- Jakarta EE 8 masih mempertahankan banyak API dengan namespace `javax.*`.
- Jakarta EE 9 melakukan namespace switch ke `jakarta.*`.
- Jakarta EE 10/11 melanjutkan namespace `jakarta.*`.

Contoh:

```java
// Java EE / Jakarta EE 8 style
import javax.annotation.security.RolesAllowed;
import javax.servlet.http.HttpServletRequest;

// Jakarta EE 9+ style
import jakarta.annotation.security.RolesAllowed;
import jakarta.servlet.http.HttpServletRequest;
```

Dampak praktis:

1. Library `javax` dan `jakarta` tidak selalu bisa dicampur sembarangan.
2. App server harus sesuai namespace aplikasi.
3. Dependency transitive bisa menyebabkan konflik.
4. Migration bukan hanya find-replace package, tetapi juga kompatibilitas runtime, CDI, Servlet, JAX-RS, validation, persistence, dan security module.
5. Security regression setelah migration perlu diuji khusus, karena annotation bisa tidak terbaca jika package tidak sesuai runtime.

Mental model:

```text
Namespace mismatch dapat membuat security annotation terlihat ada di source code, tetapi tidak diproses oleh container runtime.
```

Ini sangat berbahaya karena aplikasi tampak berjalan, tetapi enforcement bisa hilang.

---

## 5. Versi Besar: Java 8 sampai 25 dan Jakarta/Javax Security

Seri ini membahas Java 8–25. Tetapi tidak semua kombinasi Java runtime dan Jakarta EE version realistis.

### 5.1 Java 8 Era

Java 8 banyak ditemukan bersama:

- Java EE 7,
- Java EE 8,
- Servlet 3.x/4.x,
- JAX-RS 2.x,
- CDI 1.x/2.x,
- `javax.*` namespace,
- legacy app server,
- JAAS realm,
- form/basic/container auth,
- JASPIC/JACC integrations.

Security concern utama:

- legacy auth mechanism,
- password table lama,
- app server realm,
- container-specific role mapping,
- migration risk,
- lack of modern OIDC integration built-in.

### 5.2 Java 11/17 Era

Java 11 dan 17 banyak dipakai untuk modernization:

- Jakarta EE 9/10,
- namespace `jakarta.*`,
- more modern TLS defaults,
- container modernization,
- Spring Boot 2/3 migration,
- Keycloak/OIDC integration,
- MicroProfile JWT.

Security concern utama:

- namespace migration,
- token-based APIs,
- OIDC adoption,
- session/token hybrid,
- app-server vs framework security decision,
- cloud gateway/reverse proxy integration.

### 5.3 Java 21+ Era

Java 21 penting karena virtual threads final. Walaupun virtual threads tidak otomatis mengubah API Jakarta Security, ia mempengaruhi cara kita berpikir tentang:

- thread-local security context,
- context propagation,
- async execution,
- request-scoped identity,
- background job dengan identity user,
- leaking identity antar-task.

Security context yang aman bukan hanya “disimpan di ThreadLocal”. Dalam dunia async/reactive/virtual-thread, kita harus eksplisit tentang kapan identity dicapture, kapan dicek ulang, dan siapa actor sebenarnya.

### 5.4 Java 25 Era

Java 25 adalah target modern di rentang seri ini. Untuk security Jakarta, Java 25 berarti:

- runtime modern,
- stronger ecosystem expectation,
- dependency harus compatible,
- app server harus mendukung runtime,
- operational baseline lebih baru,
- migration dari Java 8 semakin perlu diperhitungkan.

Tetapi prinsip security tetap sama:

```text
authenticate caller -> establish identity -> map identity -> authorize action -> enforce data boundary -> audit decision
```

---

## 6. Vocabulary Awal yang Harus Stabil

Kita akan bahas detail di Part 01, tetapi Part 00 perlu memberi definisi kerja.

### 6.1 Caller

Caller adalah pihak yang memanggil aplikasi.

Caller bisa berupa:

- human user via browser,
- SPA frontend,
- mobile app,
- backend service,
- scheduled job,
- admin script,
- external agency system,
- integration partner.

Jangan selalu menganggap caller = human user.

Contoh:

```text
A scheduled archival job has no human user, but it still needs an identity model.
A downstream service call may represent a service account, or a user acting through a service.
```

### 6.2 Credential

Credential adalah bukti yang digunakan untuk authentication.

Contoh:

- password,
- OTP,
- client certificate,
- bearer token,
- authorization code,
- session cookie,
- API key,
- signed assertion,
- Kerberos ticket.

Credential bukan identity. Credential adalah bukti untuk memperoleh identity.

### 6.3 Principal

Principal adalah representasi identity yang sudah dikenal oleh security runtime.

Contoh:

```java
Principal principal = request.getUserPrincipal();
String name = principal.getName();
```

`principal.getName()` bisa berupa username, subject id, email, employee id, UUID, service account name, atau mapped local account. Karena itu, jangan langsung mengasumsikan formatnya.

### 6.4 Subject

Subject adalah kumpulan principals dan credentials yang merepresentasikan caller dalam JAAS-style model.

Satu subject bisa punya banyak principal:

```text
Subject
  - UserPrincipal("u123")
  - EmailPrincipal("a@example.com")
  - GroupPrincipal("case-officer")
  - TenantPrincipal("agency-A")
```

### 6.5 Role

Role adalah abstraction untuk mengelompokkan hak akses.

Contoh:

- `ADMIN`,
- `CASE_OFFICER`,
- `APPROVER`,
- `SUPERVISOR`,
- `READ_ONLY_AUDITOR`.

Role biasanya terlalu kasar untuk domain rule yang kompleks.

### 6.6 Group

Group biasanya berasal dari identity provider atau directory.

Contoh:

- LDAP group,
- AD group,
- Keycloak group,
- organization unit,
- agency membership.

Group perlu dimapping ke role aplikasi. Jangan mencampur group eksternal langsung ke business logic tanpa abstraction.

### 6.7 Permission

Permission adalah hak melakukan aksi tertentu terhadap resource tertentu.

Contoh:

```text
case.read
case.assign
case.approve
case.reopen
appeal.submit
audit.export
user.disable
```

Permission bisa lebih bermakna jika dinilai bersama context:

```text
subject = officerA
action = approve
resource = case123
resourceState = PENDING_APPROVAL
tenant = agencyA
relationship = assignedReviewer
history = officerA was not maker
```

### 6.8 Claim

Claim adalah pernyataan dalam token/assertion.

Contoh OIDC/JWT claim:

```json
{
  "sub": "248289761001",
  "iss": "https://idp.example.gov",
  "aud": "aceas-api",
  "exp": 1760000000,
  "groups": ["agency-a-case-officer"],
  "email": "user@example.gov"
}
```

Claim adalah input untuk authorization, bukan otomatis keputusan akhir.

### 6.9 Scope

Scope biasanya berasal dari OAuth2. Scope menyatakan delegasi akses pada API/client.

Contoh:

```text
case.read case.write profile.read
```

Scope tidak selalu sama dengan role user. Scope bisa berarti client diberi izin memanggil API tertentu, tetapi user tetap perlu authorization domain.

---

## 7. Authentication vs Authorization

Ini perbedaan paling fundamental.

### 7.1 Authentication

Authentication menjawab:

```text
Siapa caller ini, dan apakah buktinya valid?
```

Contoh:

- username/password cocok,
- OIDC code valid dan ID token valid,
- bearer token signature valid,
- client certificate dipercaya,
- SAML assertion valid,
- session cookie mengarah ke session authenticated.

Output authentication:

```text
caller identity established
```

Misalnya:

```text
principal = "user-123"
groups = ["case-officer", "agency-a"]
```

### 7.2 Authorization

Authorization menjawab:

```text
Apakah caller ini boleh melakukan action ini terhadap resource ini dalam context ini?
```

Contoh:

```text
Bolehkan user-123 approve case-987?
```

Jawabannya mungkin membutuhkan:

- role user,
- tenant/agency membership,
- assignment,
- case state,
- previous action history,
- conflict-of-interest rule,
- time window,
- delegation status,
- emergency override.

Authentication berhasil tidak berarti authorization berhasil.

### 7.3 Kesalahan Umum

Kesalahan klasik:

```java
if (request.getUserPrincipal() != null) {
    approveCase(caseId);
}
```

Ini hanya mengecek authenticated, bukan authorized.

Lebih baik berpikir:

```text
authenticated? yes
role candidate? yes
same tenant? yes
resource state allows action? yes
relationship allows action? yes
segregation-of-duties satisfied? yes
audit decision? yes
execute action
```

---

## 8. Authentication Is Not Identity Governance

Dalam enterprise system, identity lifecycle sering lebih besar daripada aplikasi.

Pertanyaan identity governance:

- Siapa membuat user account?
- Kapan user dinonaktifkan?
- Bagaimana user pindah department/agency?
- Bagaimana role direview berkala?
- Bagaimana external user diverifikasi?
- Bagaimana duplicate account dicegah?
- Bagaimana user linking antara IdP dan local account?
- Bagaimana service account dirotasi?

Aplikasi Jakarta biasanya bukan source of truth penuh untuk identity. Ia menerima identity dari:

- LDAP/AD,
- OIDC provider,
- SAML IdP,
- IAM platform,
- internal user registry,
- HR system,
- partner registry.

Aplikasi tetap harus punya boundary:

```text
IdP proves who the caller is.
Application decides what the caller can do here.
```

---

## 9. Container-Managed vs Application-Managed Security

### 9.1 Container-Managed Security

Container-managed security berarti container ikut bertanggung jawab:

- membaca security metadata,
- menjalankan authentication mechanism,
- memasang principal ke request,
- mengecek URL/method role,
- menyediakan `SecurityContext`,
- menghubungkan annotation dengan enforcement.

Contoh:

```java
@RolesAllowed("ADMIN")
public void disableUser(String userId) {
    // business logic
}
```

Jika container/interceptor aktif, method hanya boleh dipanggil oleh caller dengan role yang sesuai.

Keunggulan:

- lebih declarative,
- portable pada spec level,
- enforcement dekat runtime,
- lebih mudah audit pattern-nya,
- mengurangi boilerplate check.

Kelemahan:

- vendor differences,
- debugging bisa sulit,
- tidak cukup untuk domain-level rule,
- bisa gagal diam-diam jika annotation tidak diproses,
- context propagation perlu hati-hati.

### 9.2 Application-Managed Security

Application-managed security berarti aplikasi sendiri melakukan:

- token parsing,
- credential validation,
- session management,
- role check,
- permission check,
- audit event.

Contoh:

```java
if (!authorizationService.canApprove(currentUser, caseId)) {
    throw new ForbiddenException();
}
```

Keunggulan:

- fleksibel,
- cocok untuk domain complex,
- bisa framework-agnostic,
- policy bisa diuji sebagai business logic.

Kelemahan:

- rawan inconsistent enforcement,
- rawan lupa check,
- rawan duplikasi logic,
- lebih berat untuk standardisasi,
- harus desain audit sendiri.

### 9.3 Hybrid yang Umum di Production

Banyak sistem production menggunakan hybrid:

```text
container/framework security:
  - authentication
  - session/token integration
  - coarse URL/method role guard

domain authorization service:
  - object-level permission
  - workflow rule
  - tenant boundary
  - maker-checker
  - audit-rich decision
```

Ini biasanya paling realistis untuk enterprise case management.

---

## 10. Request Lifecycle Detail: Dari Network Sampai Audit

Mari buat request lifecycle yang lebih detail.

### 10.1 Phase 1 — Network and Transport Boundary

Sebelum aplikasi Java melihat request, request mungkin melewati:

```text
browser
  -> CDN/WAF
  -> load balancer
  -> reverse proxy / ingress
  -> API gateway
  -> app server/container
```

Pertanyaan security:

- Apakah TLS terminate di mana?
- Apakah app tahu original scheme HTTPS?
- Apakah `X-Forwarded-*` dipercaya hanya dari proxy resmi?
- Apakah client IP asli dibutuhkan untuk audit/rate limit?
- Apakah header identity bisa dipalsukan?
- Apakah internal network dianggap terlalu dipercaya?

Failure contoh:

```text
Gateway menambahkan X-User: alice.
Aplikasi percaya X-User.
Tetapi endpoint internal juga bisa diakses langsung oleh attacker yang mengirim X-User: admin.
```

Mitigasi:

- hanya percaya trusted proxy,
- strip inbound identity headers di edge,
- validasi mTLS antar-service,
- app tetap validasi token jika perlu,
- network policy membatasi direct access,
- audit mencatat source layer.

### 10.2 Phase 2 — Credential Extraction

Aplikasi/container mencari credential di:

- `Authorization` header,
- cookie,
- form parameter,
- client certificate,
- OIDC redirect callback,
- SAML POST,
- API key header,
- mutual TLS session,
- existing server-side session.

Pertanyaan:

- Credential mana yang prioritas?
- Kalau ada session cookie dan bearer token, mana dipakai?
- Apakah endpoint API harus redirect ke login page atau return 401 JSON?
- Apakah login endpoint terkena CSRF?
- Apakah credential pernah masuk log?

### 10.3 Phase 3 — Authentication Mechanism

Authentication mechanism memutus cara memvalidasi credential.

Contoh mekanisme:

- Basic auth,
- form login,
- custom form,
- client certificate,
- OIDC authorization code,
- bearer token validation,
- SAML assertion processing,
- custom header behind trusted gateway.

Dalam Jakarta Security, kita akan melihat `HttpAuthenticationMechanism`. Dalam Jakarta Authentication, kita akan melihat SPI level lebih rendah.

### 10.4 Phase 4 — Credential Validation

Credential divalidasi terhadap:

- database identity store,
- LDAP,
- OIDC provider,
- JWT signature and claims,
- introspection endpoint,
- certificate trust chain,
- SAML signature,
- app server realm.

Outputnya tidak hanya true/false. Output ideal:

```text
status = valid
principal = stable subject id
groups = normalized group set
attributes = safe subset of identity attributes
authentication_strength = password / MFA / certificate / system
freshness = authentication time
```

### 10.5 Phase 5 — Identity Establishment

Setelah credential valid, container/app membentuk identity.

Di Servlet:

```java
request.getUserPrincipal();
request.isUserInRole("ADMIN");
```

Di Jakarta Security:

```java
securityContext.getCallerPrincipal();
securityContext.isCallerInRole("ADMIN");
```

Pertanyaan:

- Principal name pakai apa?
- Email boleh berubah, apakah aman sebagai primary key?
- Subject claim stabil atau tidak?
- Local account linking bagaimana?
- Group dari token langsung dipakai atau dimapping?
- Role berubah selama session, kapan refresh?

### 10.6 Phase 6 — Coarse Authorization

Coarse authorization biasanya menjawab:

```text
Apakah caller dengan role X boleh masuk endpoint/class/method ini?
```

Contoh:

```java
@RolesAllowed("CASE_OFFICER")
@GET
@Path("/cases/{id}")
public CaseDto getCase(@PathParam("id") String id) { ... }
```

Ini penting sebagai guard awal. Namun jangan berhenti di sini.

### 10.7 Phase 7 — Domain Authorization

Domain authorization menjawab pertanyaan yang lebih spesifik:

```text
Apakah caller boleh melakukan action terhadap resource ini sekarang?
```

Contoh:

```java
authorizationService.assertCanApproveCase(actor, caseId);
```

Di sistem workflow/regulatory, ini biasanya membutuhkan:

- case state,
- assignment,
- agency/tenant,
- maker-checker,
- escalation,
- conflict rule,
- delegation,
- time limit,
- data classification,
- legal hold,
- override policy.

### 10.8 Phase 8 — Data Access Enforcement

Bahkan jika service method aman, data access juga perlu boundary.

Contoh bug:

```java
@RolesAllowed("CASE_OFFICER")
public CaseDto getCase(String id) {
    return caseRepository.findById(id); // no tenant filter
}
```

Jika `id` dari tenant lain ditebak, data bocor.

Lebih aman:

```java
public CaseDto getCase(Actor actor, String id) {
    Case c = caseRepository.findVisibleCase(actor.tenantId(), id)
        .orElseThrow(NotFoundOrForbiddenException::new);
    authorizationService.assertCanRead(actor, c);
    return mapper.toDto(c);
}
```

Poin penting:

```text
Authorization dan data filtering harus konsisten.
```

### 10.9 Phase 9 — Audit

Audit bukan sekadar log debug.

Audit event ideal menjawab:

- siapa actor,
- atas nama siapa,
- kapan,
- dari mana,
- action apa,
- resource apa,
- tenant apa,
- keputusan authorization apa,
- alasan deny/allow apa,
- state sebelum/sesudah,
- correlation id,
- authentication method,
- session/token id reference,
- apakah delegated/system action.

Untuk regulatory system, auditability sering sama pentingnya dengan enforcement.

---

## 11. Security Invariants

Security invariant adalah aturan yang harus selalu benar, tidak peduli request datang dari UI, API, batch job, admin console, atau service internal.

Contoh invariant:

```text
I1. Unauthenticated caller must never mutate protected business data.
I2. Caller from tenant A must never read tenant B data unless explicit cross-tenant privilege exists.
I3. User who created recommendation cannot approve the same recommendation if maker-checker applies.
I4. Role removal must eventually prevent new privileged actions.
I5. Logout must terminate local session and prevent silent reuse of stale app session.
I6. Token must only be accepted from trusted issuer and intended audience.
I7. Admin action must be audited with actor, target, before/after, and correlation id.
I8. UI hiding is never considered authorization enforcement.
I9. Internal service call must have service identity or delegated user identity; anonymous internal trust is not enough.
I10. Deny decision must be safe by default when identity, role, tenant, or policy cannot be resolved.
```

Top-level engineer mendesain security dari invariant, bukan dari endpoint per endpoint.

---

## 12. Threat Model Ringkas untuk Seri Ini

Part ini bukan seri threat modelling penuh, tetapi kita perlu threat categories.

### 12.1 Authentication Threats

- credential theft,
- credential stuffing,
- brute force,
- phishing,
- session fixation,
- token replay,
- invalid token accepted,
- weak certificate validation,
- open redirect in login flow,
- IdP mix-up,
- nonce/state bypass.

### 12.2 Authorization Threats

- broken access control,
- privilege escalation,
- horizontal access breach,
- vertical access breach,
- IDOR / insecure direct object reference,
- tenant boundary bypass,
- stale permission cache,
- role mapping drift,
- method security bypass,
- workflow state bypass.

### 12.3 Session/Token Threats

- cookie theft,
- missing `Secure` / `HttpOnly` / `SameSite`,
- token stored in unsafe browser storage,
- long-lived token,
- refresh token abuse,
- logout not revoking token,
- JWKS cache poisoning/mismanagement,
- clock skew causing denial or acceptance bug.

### 12.4 Infrastructure Boundary Threats

- spoofed forwarded header,
- gateway bypass,
- trusting internal network too much,
- mTLS misconfiguration,
- wrong TLS termination assumption,
- CORS overly permissive,
- admin endpoint exposed,
- environment-specific config drift.

### 12.5 Audit/Forensic Threats

- missing audit event,
- wrong actor recorded,
- delegated action not represented,
- logs contain credential/PII,
- audit can be tampered,
- correlation id missing,
- denial not audited.

---

## 13. Jangan Mengulang Materi yang Sudah Selesai

Karena sebelumnya sudah ada seri:

- Java core,
- collections/streams,
- concurrency/reactive,
- data types,
- reliability,
- DSA,
- IO/networking,
- cryptography/integrity,
- SQL/JDBC/HikariCP,
- OOP/reflection/modules,
- testing/performance/JVM,
- memory/offheap/GC,
- Jakarta,
- validation,
- persistence,
- CDI,
- Servlet/WebSocket,
- JSON/XML/SOAP,
- JAX-RS advanced,

maka seri ini tidak akan mengulang secara panjang:

- hashing algorithm detail kecuali konteks password credential,
- TLS cryptographic primitive detail,
- low-level HTTP basics,
- JAX-RS basics,
- CDI basics,
- Servlet lifecycle basics,
- database transaction basics,
- Java concurrency basics,
- general testing basics,
- general OOP design pattern basics.

Yang akan kita lakukan adalah memakai pengetahuan tersebut untuk membangun security mental model yang lebih tinggi:

```text
How security is enforced, propagated, audited, broken, migrated, and reasoned about in Java/Jakarta enterprise systems.
```

---

## 14. Layer Decision Map

Ketika menghadapi requirement security, jangan langsung memilih annotation/API. Pecah dulu requirement-nya.

### 14.1 Requirement: “User harus login sebelum akses halaman.”

Layer yang relevan:

- Servlet/Jakarta Security authentication mechanism,
- session management,
- login page/OIDC redirect,
- security constraint.

Pertanyaan:

- login lokal atau SSO?
- session timeout berapa?
- logout lokal atau global?
- MFA diperlukan?

### 14.2 Requirement: “Hanya admin boleh akses menu user management.”

Layer yang relevan:

- URL/method role check,
- UI menu filtering,
- backend endpoint guard,
- audit admin action.

Pertanyaan:

- role admin berasal dari mana?
- role mapping environment-specific?
- apakah read dan mutate dibedakan?

### 14.3 Requirement: “Officer hanya boleh melihat case agency sendiri.”

Layer yang relevan:

- tenant identity,
- data access filter,
- domain authorization,
- audit data access,
- repository query design.

Pertanyaan:

- tenant dari token/session/URL/database?
- user bisa punya multiple agency?
- active agency dipilih bagaimana?
- apakah super-admin bisa cross-tenant?

### 14.4 Requirement: “Approver tidak boleh approve case yang dia submit.”

Layer yang relevan:

- domain authorization,
- workflow state,
- action history,
- maker-checker invariant,
- transaction/race control,
- audit denial.

Tidak cukup dengan role:

```text
ROLE_APPROVER is necessary but not sufficient.
```

### 14.5 Requirement: “API hanya boleh dipanggil service partner tertentu.”

Layer yang relevan:

- mTLS,
- OAuth2 client credentials,
- API gateway,
- client identity,
- audience/scope validation,
- rate limiting,
- audit partner call.

Pertanyaan:

- partner identity dari certificate atau token?
- token opaque atau JWT?
- apakah gateway saja validasi cukup?
- apakah downstream app perlu defense-in-depth?

---

## 15. Security Context: Jangan Disamakan dengan Domain Actor

Dalam Jakarta/Servlet world, security context biasanya memberi informasi runtime:

- principal,
- roles/groups,
- authentication state.

Tetapi domain actor biasanya lebih kaya.

Contoh security context:

```text
principal = user-123
roles = [CASE_OFFICER]
```

Contoh domain actor:

```text
Actor
  principalId = user-123
  displayName = Alice Tan
  tenantId = CEA
  activeOrganization = Licensing Division
  effectiveRoles = [CASE_OFFICER]
  delegatedFrom = null
  authenticationMethod = OIDC_MFA
  sessionId = S-abc
  requestId = R-999
```

Kenapa ini penting?

Business rule jarang cukup dengan principal saja. Ia butuh tenant, organization, delegation, role, authentication strength, dan audit context.

Pattern yang baik:

```text
SecurityContext -> ActorResolver -> Domain Actor -> AuthorizationService
```

Bukan:

```text
Business method langsung memanggil request.isUserInRole() di mana-mana
```

---

## 16. Role Check vs Permission Check

Role check:

```java
securityContext.isCallerInRole("APPROVER")
```

Permission check:

```java
authorizationService.can(actor, Action.APPROVE, caseResource)
```

Perbedaannya:

| Aspek | Role Check | Permission/Policy Check |
|---|---|---|
| Granularity | kasar | halus |
| Resource-aware | biasanya tidak | ya |
| State-aware | tidak | bisa |
| Tenant-aware | tidak otomatis | harus |
| Workflow-aware | tidak | bisa |
| Audit reason | terbatas | bisa kaya |
| Cocok untuk | endpoint/method guard | business action |

Rule praktis:

```text
Use role check as a gate. Use domain permission check as the decision.
```

---

## 17. 401 vs 403 Mental Model

Walaupun detailnya nanti di Part 27, sejak awal harus stabil:

```text
401 Unauthorized = caller belum authenticated atau authentication tidak valid.
403 Forbidden = caller sudah authenticated tetapi tidak boleh melakukan action.
```

Nama HTTP `Unauthorized` memang membingungkan, karena secara praktis 401 berarti authentication problem.

Contoh:

| Kondisi | Response |
|---|---|
| Tidak ada token/session | 401 |
| Token expired | 401 |
| Token valid tapi role kurang | 403 |
| Role cukup tapi bukan assignee case | 403 |
| Resource tenant lain dan ingin disembunyikan | bisa 404 atau 403 sesuai policy |

Untuk browser app, 401 bisa redirect ke login. Untuk API, 401 biasanya JSON error + `WWW-Authenticate` header jika bearer token.

---

## 18. Default Deny

Security system yang sehat memakai default deny.

Artinya:

```text
Jika identity tidak jelas -> deny.
Jika role tidak jelas -> deny.
Jika tenant tidak jelas -> deny.
Jika policy tidak bisa diload -> deny, kecuali ada explicit degraded-mode design.
Jika resource tidak ditemukan dalam boundary caller -> deny/not-found.
Jika token issuer/audience tidak cocok -> deny.
```

Anti-pattern:

```java
if (user.hasRole("ADMIN")) {
    allow();
}
// else continue normal flow accidentally
```

Lebih aman:

```java
if (!authorizationService.can(actor, action, resource)) {
    throw new ForbiddenException();
}
```

Default deny juga berlaku untuk route:

```text
All endpoints protected by default.
Explicitly open public endpoints.
```

---

## 19. Trust Boundary

Trust boundary adalah batas tempat data/identity/credential berubah tingkat kepercayaannya.

Contoh boundary:

```text
Browser -> Internet -> WAF -> Load Balancer -> Ingress -> App
External IdP -> OIDC callback -> App session
Gateway -> Internal service
Service A -> Service B
App -> Database
App -> Audit sink
```

Setiap melewati boundary, tanyakan:

1. Apakah data ini bisa dipalsukan?
2. Siapa yang menandatangani/melindungi data ini?
3. Apakah kita validasi issuer/audience/origin?
4. Apakah ada replay protection?
5. Apakah identity masih sama atau berubah menjadi delegated identity?
6. Apakah audit mencatat boundary crossing?

Contoh:

```text
Header X-User dari gateway hanya trustworthy jika:
- gateway menghapus inbound X-User dari client,
- app hanya bisa diakses melalui gateway,
- network policy mencegah direct bypass,
- app tahu gateway mana yang trusted,
- idealnya ada mTLS atau signed header.
```

---

## 20. Identity Propagation

Identity propagation berarti membawa identity dari satu layer/service ke layer/service lain.

Contoh:

```text
User -> Web App -> Case Service -> Document Service -> Audit Service
```

Pertanyaan besar:

```text
Ketika Case Service memanggil Document Service, siapa caller-nya?
```

Pilihan:

1. **Service identity only**
   
   ```text
   caller = case-service
   ```

2. **User delegated identity**
   
   ```text
   caller = user-123 via case-service
   ```

3. **Both service and user identity**
   
   ```text
   client = case-service
   actor = user-123
   ```

Untuk audit dan authorization, opsi ketiga sering paling jelas.

Bahaya confused deputy:

```text
User tidak boleh akses document X langsung.
Tetapi user bisa meminta Case Service mengambil document X karena Case Service punya akses luas.
```

Mitigasi:

- downstream service mengecek delegated user permission,
- token exchange dengan audience benar,
- service membatasi action berdasarkan original actor,
- audit mencatat service actor dan user actor.

---

## 21. Session vs Token

Session dan token sering dicampur, tetapi modelnya berbeda.

### 21.1 Session

Session biasanya server-side state yang direferensikan oleh cookie.

```text
browser stores session cookie
server stores session data / principal / auth state
```

Keunggulan:

- mudah revoke lokal,
- credential tidak perlu dikirim terus selain cookie,
- cocok untuk server-rendered atau BFF,
- identity bisa disimpan server-side.

Risiko:

- CSRF,
- session fixation,
- distributed session complexity,
- sticky session,
- logout global sulit jika SSO,
- stale role dalam session.

### 21.2 Token

Token biasanya self-contained atau reference credential.

```text
client sends Authorization: Bearer <token>
server validates token
```

Keunggulan:

- stateless-ish,
- cocok untuk API,
- service-to-service,
- multi-system interoperability.

Risiko:

- bearer token theft,
- revocation sulit untuk JWT,
- audience/issuer validation bug,
- token terlalu panjang umur,
- claim stale,
- storage di browser rawan.

### 21.3 Hybrid

Banyak aplikasi enterprise memakai hybrid:

```text
Browser login via OIDC -> app creates local session -> backend calls API with service/delegated token
```

Ini bukan salah. Yang penting boundary jelas:

- ID token untuk login identity,
- access token untuk API authorization/delegation,
- session cookie untuk browser-app session,
- refresh token jika benar-benar diperlukan dan disimpan aman.

---

## 22. OIDC, SAML, OAuth2: Jangan Tertukar

Detail akan dibahas nanti, tetapi orientasi awal:

### 22.1 OAuth2

OAuth2 adalah authorization delegation framework. Fokusnya:

```text
client mendapatkan access token untuk mengakses resource server
```

OAuth2 tidak secara langsung mendefinisikan login user identity untuk aplikasi. OIDC dibangun di atas OAuth2 untuk identity.

### 22.2 OpenID Connect

OIDC adalah identity layer di atas OAuth2. Fokusnya:

```text
authenticate user through OpenID Provider and obtain identity claims
```

OIDC memperkenalkan ID token, UserInfo, discovery, nonce, dan identity claims.

### 22.3 SAML

SAML adalah federated identity protocol berbasis XML assertion. Masih banyak di enterprise SSO.

SAML umum untuk:

- browser SSO,
- legacy enterprise IdP,
- government/agency integration,
- B2B federation.

### 22.4 Kesalahan Umum

- memakai ID token sebagai access token API,
- menganggap OAuth scope = application role,
- menerima JWT tanpa cek audience,
- menerima token dari issuer salah,
- menyimpan access token di localStorage tanpa threat analysis,
- tidak menggunakan state/nonce pada OIDC flow,
- menganggap SAML assertion valid hanya karena XML parse berhasil.

---

## 23. Jakarta Security dalam Peta Besar

Jakarta Security cocok ditempatkan di tengah peta ini:

```text
HTTP Request
  -> Servlet Container
    -> Jakarta Security HttpAuthenticationMechanism
      -> IdentityStore / OIDC / custom validator
    -> Container establishes caller principal/groups
  -> Application code
    -> SecurityContext
    -> @RolesAllowed / isCallerInRole
    -> Domain AuthorizationService
    -> Audit
```

Ia membantu menjembatani container dan aplikasi.

Namun, ia bukan pengganti:

- IdP governance,
- OAuth/OIDC provider,
- domain policy engine,
- data authorization,
- audit pipeline,
- gateway hardening,
- threat modelling,
- secure SDLC.

---

## 24. Diagram: End-to-End Enterprise Java Security

```text
+------------------+
| Browser / Client |
+------------------+
         |
         | HTTPS / Cookie / Authorization Header
         v
+------------------+
| WAF / LB / Proxy |
+------------------+
         |
         | Forwarded request, stripped unsafe headers
         v
+-----------------------------+
| Servlet / Jakarta Container |
+-----------------------------+
         |
         | security constraints / auth mechanism
         v
+-----------------------------------+
| Jakarta Security / Authentication |
+-----------------------------------+
         |
         | credential validation
         v
+--------------------------+
| IdP / IdentityStore      |
| DB / LDAP / OIDC / SAML  |
+--------------------------+
         |
         | principal + groups + claims
         v
+----------------------------+
| Container Security Context |
+----------------------------+
         |
         | coarse authorization
         v
+-------------------------+
| JAX-RS / Servlet / CDI  |
+-------------------------+
         |
         | domain actor resolution
         v
+-----------------------------+
| Domain AuthorizationService |
+-----------------------------+
         |
         | allow / deny with reason
         v
+-------------------------+
| Business Operation      |
+-------------------------+
         |
         | tenant-filtered query / mutation
         v
+-------------------------+
| Database / Resource     |
+-------------------------+
         |
         | audit event
         v
+-------------------------+
| Audit / Monitoring      |
+-------------------------+
```

---

## 25. Common Architecture Patterns

### 25.1 Classic Jakarta Server-Rendered App

```text
Browser -> Jakarta app -> DB
```

Typical security:

- form login or OIDC login,
- server-side session,
- Servlet security constraints,
- `@RolesAllowed`,
- domain authorization service,
- audit.

Risk:

- CSRF,
- session fixation,
- stale role,
- insufficient domain checks.

### 25.2 SPA + Jakarta REST Backend

```text
Browser SPA -> Jakarta REST API -> DB
```

Possible security models:

1. SPA stores access token and calls API directly.
2. BFF/session model: browser uses secure session cookie to backend.
3. Gateway validates token and forwards identity.
4. Backend validates token itself.

Trade-off:

- Direct token in browser increases token storage threat.
- BFF reduces token exposure but needs CSRF/session design.
- Gateway-only validation simplifies app but can create trust-boundary risk.
- App validation improves defense-in-depth but adds complexity.

### 25.3 Enterprise SSO App

```text
Browser -> App -> OIDC/SAML IdP -> App session
```

Key concerns:

- redirect URI,
- state/nonce,
- account linking,
- logout,
- role mapping,
- IdP downtime,
- session lifetime vs IdP token lifetime.

### 25.4 API Resource Server

```text
Client/service -> Bearer token -> Jakarta API
```

Key concerns:

- issuer,
- audience,
- signature,
- expiration,
- scope,
- role mapping,
- 401/403,
- token propagation downstream.

### 25.5 Workflow/Case Management System

```text
User -> App -> Case workflow -> DB -> Audit
```

Key concerns:

- state-aware permission,
- maker-checker,
- assignment,
- tenant isolation,
- escalation,
- delegation,
- auditability,
- race conditions.

---

## 26. Security Failure Thinking

Top engineer tidak hanya bertanya:

```text
Bagaimana membuat fitur login?
```

Tetapi juga:

```text
Bagaimana fitur ini bisa gagal secara berbahaya?
```

Contoh failure thinking untuk login:

| Area | Pertanyaan |
|---|---|
| Credential | Apakah password/token bisa muncul di log? |
| Session | Apakah session id berubah setelah login? |
| Redirect | Apakah ada open redirect setelah login? |
| CSRF | Apakah login/logout endpoint aman? |
| Role | Apakah role terbaru atau cached? |
| Logout | Apakah logout invalidate session dan IdP state? |
| Audit | Apakah failed login dan successful login dicatat? |
| Lockout | Apakah brute force dimitigasi? |

Contoh failure thinking untuk authorization:

| Area | Pertanyaan |
|---|---|
| Endpoint | Apakah semua path terlindungi? |
| Method | Apakah annotation benar-benar diproses? |
| Resource | Apakah user boleh resource tersebut? |
| Tenant | Apakah tenant filter diterapkan di query? |
| Workflow | Apakah state saat ini memungkinkan action? |
| Race | Apakah state berubah setelah check sebelum update? |
| Audit | Apakah denial dicatat? |
| Bypass | Apakah ada API lain yang melewati service policy? |

---

## 27. Design Principle: Separate Authentication, Identity Mapping, Authorization, and Audit

Jangan membuat satu class besar seperti:

```java
public class LoginService {
    boolean loginAndCheckPermissionAndAuditAndLoadTenant(...) { ... }
}
```

Lebih sehat memisahkan:

```text
AuthenticationMechanism
  validates credential / obtains caller identity

IdentityMapper
  maps external identity to local principal / groups / account

ActorResolver
  builds domain actor from security context + tenant/session/account

AuthorizationService
  decides if actor can perform action on resource

AuditService
  records security-relevant event and decision
```

Contoh aliran:

```text
OIDC callback -> AuthenticationMechanism -> principal established
Request -> ActorResolver -> Actor(userId, tenantId, roles, delegation)
Service method -> AuthorizationService.assertCanApprove(actor, case)
Decision -> AuditService.recordAuthorizationDecision(...)
Business action -> AuditService.recordStateChange(...)
```

Keuntungan:

- lebih mudah diuji,
- lebih mudah diaudit,
- lebih mudah migration IdP,
- role mapping tidak bocor ke business code,
- domain policy bisa berkembang tanpa mengganti authentication flow.

---

## 28. Model Actor yang Disarankan untuk Domain Layer

Jangan terus membawa `HttpServletRequest` atau `SecurityContext` ke domain service.

Buat model eksplisit:

```java
public record Actor(
    String principalId,
    String displayName,
    String tenantId,
    Set<String> roles,
    Set<String> permissions,
    String authenticationMethod,
    String sessionId,
    String requestId,
    Delegation delegation
) {}
```

Untuk Java 8, gunakan class immutable biasa:

```java
public final class Actor {
    private final String principalId;
    private final String displayName;
    private final String tenantId;
    private final Set<String> roles;
    private final Set<String> permissions;
    private final String authenticationMethod;
    private final String sessionId;
    private final String requestId;
    private final Delegation delegation;

    public Actor(
            String principalId,
            String displayName,
            String tenantId,
            Set<String> roles,
            Set<String> permissions,
            String authenticationMethod,
            String sessionId,
            String requestId,
            Delegation delegation) {
        this.principalId = principalId;
        this.displayName = displayName;
        this.tenantId = tenantId;
        this.roles = Collections.unmodifiableSet(new HashSet<>(roles));
        this.permissions = Collections.unmodifiableSet(new HashSet<>(permissions));
        this.authenticationMethod = authenticationMethod;
        this.sessionId = sessionId;
        this.requestId = requestId;
        this.delegation = delegation;
    }

    public String principalId() { return principalId; }
    public String displayName() { return displayName; }
    public String tenantId() { return tenantId; }
    public Set<String> roles() { return roles; }
    public Set<String> permissions() { return permissions; }
    public String authenticationMethod() { return authenticationMethod; }
    public String sessionId() { return sessionId; }
    public String requestId() { return requestId; }
    public Delegation delegation() { return delegation; }
}
```

Kenapa actor domain perlu immutable?

- mencegah role/tenant berubah di tengah request,
- lebih aman untuk audit,
- lebih mudah reasoning,
- mengurangi accidental mutation,
- membantu test determinism.

Tetapi hati-hati: immutable actor adalah snapshot. Jika role berubah di IdP selama session, actor lama bisa stale. Karena itu perlu policy refresh/session lifetime.

---

## 29. Security Decision Object

Untuk sistem kompleks, authorization jangan hanya return boolean.

Boolean:

```java
boolean allowed = authorizationService.canApprove(actor, caseId);
```

Lebih baik:

```java
AuthorizationDecision decision = authorizationService.decide(
    actor,
    Action.APPROVE_CASE,
    resource
);

if (!decision.allowed()) {
    auditService.recordDenial(decision);
    throw new ForbiddenException(decision.publicMessage());
}
```

Contoh model:

```java
public record AuthorizationDecision(
    boolean allowed,
    String actorId,
    String action,
    String resourceType,
    String resourceId,
    String tenantId,
    String reasonCode,
    String publicMessage,
    Map<String, String> diagnosticAttributes
) {}
```

Manfaat:

- audit lebih kaya,
- denial reason konsisten,
- troubleshooting lebih mudah,
- security test bisa assert reason,
- policy engine bisa dievolusi.

Untuk Java 8, gunakan immutable class.

---

## 30. Where to Enforce?

Security harus enforced di beberapa tempat, tetapi dengan tanggung jawab berbeda.

| Layer | Enforcement |
|---|---|
| Gateway/WAF | rate limit, TLS, coarse route, bot protection, header cleanup |
| Container | authentication, session, URL constraints, role constraints |
| JAX-RS/Servlet | endpoint-level guard, request validation |
| Service layer | domain authorization, transaction boundary |
| Repository/query | tenant/resource filtering |
| Database | optional RLS/constraints/view grants for defense-in-depth |
| Audit | accountability and detection |

Rule praktis:

```text
Do not rely on only one layer for high-risk authorization.
```

Tetapi juga jangan membuat logic tidak konsisten di semua layer. Gunakan layered guard:

- Gateway: coarse allow traffic.
- Container: authenticated and role-eligible.
- Service: final domain decision.
- Repository: prevent data leak.
- Audit: record decision/action.

---

## 31. Example: Case Approval Request Lifecycle

Misalnya request:

```http
POST /api/cases/CASE-123/approve
Cookie: JSESSIONID=...
```

Lifecycle yang baik:

```text
1. TLS already terminated at trusted proxy.
2. Container receives request with secure session cookie.
3. Session maps to authenticated principal user-123.
4. Container checks endpoint requires CASE_APPROVER role.
5. ActorResolver builds Actor:
   - user-123
   - tenant CEA
   - roles [CASE_APPROVER]
   - request id R-789
6. Service loads case CASE-123 with tenant filter CEA.
7. AuthorizationService evaluates:
   - actor has CASE_APPROVER? yes
   - case tenant == actor tenant? yes
   - case state == PENDING_APPROVAL? yes
   - actor is assigned approver? yes
   - actor was maker? no
   - case not locked? yes
8. Decision allowed.
9. Audit records authorization allow.
10. Transaction updates case state APPROVED.
11. Audit records state transition.
12. Response returned.
```

Jika actor adalah maker:

```text
Authorization decision:
  allowed = false
  reasonCode = MAKER_CHECKER_VIOLATION
  publicMessage = You are not allowed to approve this case.
  diagnostic = actor created recommendation at 2026-06-01T10:15:00Z
```

Backend return 403, audit denial dicatat.

---

## 32. API Design Smell: Security Logic di Controller

Controller/resource method yang penuh security logic biasanya smell.

Buruk:

```java
@POST
@Path("/cases/{id}/approve")
public Response approve(@PathParam("id") String id) {
    Principal p = request.getUserPrincipal();
    if (p == null) return Response.status(401).build();

    if (!request.isUserInRole("APPROVER")) return Response.status(403).build();

    Case c = caseRepository.findById(id);
    if (!c.getTenantId().equals(session.getAttribute("tenantId"))) {
        return Response.status(403).build();
    }

    if (c.getCreatedBy().equals(p.getName())) {
        return Response.status(403).build();
    }

    c.approve();
    caseRepository.save(c);
    return Response.ok().build();
}
```

Lebih baik:

```java
@POST
@Path("/cases/{id}/approve")
@RolesAllowed("CASE_APPROVER")
public Response approve(@PathParam("id") String id) {
    Actor actor = actorResolver.currentActor();
    caseApprovalService.approve(actor, id);
    return Response.ok().build();
}
```

Service:

```java
public void approve(Actor actor, String caseId) {
    Case c = caseRepository.findByTenantAndId(actor.tenantId(), caseId)
        .orElseThrow(NotFoundOrForbiddenException::new);

    AuthorizationDecision decision = authorizationService.decide(
        actor,
        Action.APPROVE_CASE,
        CaseResource.from(c)
    );

    auditService.recordAuthorizationDecision(decision);

    if (!decision.allowed()) {
        throw new ForbiddenException(decision.publicMessage());
    }

    c.approve(actor.principalId());
    caseRepository.save(c);
    auditService.recordCaseApproved(actor, c);
}
```

Keuntungan:

- controller tipis,
- security decision reusable,
- audit konsisten,
- test service lebih mudah,
- authorization tidak bergantung pada HTTP layer.

---

## 33. Security and Transaction Boundary

Authorization sering membutuhkan data yang bisa berubah.

Contoh race:

```text
T1: User A checks case state = PENDING_APPROVAL
T2: User B approves case, state = APPROVED
T1: User A continues approve based on old check
```

Mitigasi:

- authorization check dan state mutation dalam transaction,
- optimistic locking,
- recheck state before update,
- conditional update,
- database constraint untuk critical invariant,
- audit conflict.

Contoh conditional update:

```sql
UPDATE case_table
SET status = 'APPROVED', approved_by = ?
WHERE id = ?
  AND tenant_id = ?
  AND status = 'PENDING_APPROVAL'
  AND maker_user_id <> ?
```

Jika affected rows = 0, treat as forbidden/conflict depending semantics.

Security bukan hanya check di Java. Untuk invariant penting, database-level condition bisa menjadi defense-in-depth.

---

## 34. Security Context and Threads

Banyak container/framework menyimpan security context terkait request/thread. Ini berbahaya jika kita tidak paham propagation.

Contoh:

```java
CompletableFuture.runAsync(() -> {
    // Apakah security context masih ada di sini?
});
```

Jawabannya: tergantung. Sering tidak aman mengasumsikan ada.

Risiko:

- context hilang,
- context salah,
- identity user sebelumnya leak karena thread reuse,
- background task berjalan sebagai anonymous,
- background task berjalan sebagai system tanpa audit.

Pattern yang lebih aman:

```java
Actor actor = actorResolver.currentActor();
executor.submit(() -> service.doWork(actor, command));
```

Tetapi jangan hanya capture actor untuk aksi yang harus revalidate permission saat eksekusi lama. Untuk long-running task, perlu desain:

- snapshot actor untuk audit,
- re-check permission saat execution,
- system identity untuk actual job,
- on-behalf-of metadata,
- cancellation jika user disabled.

Ini akan dibahas detail di Part 22.

---

## 35. Public Endpoint, Anonymous Caller, and System Actor

Tidak semua request punya human caller.

### 35.1 Public Endpoint

Contoh:

- health check,
- login page,
- OIDC callback,
- public static asset,
- password reset initiation,
- public application form.

Public endpoint tetap perlu security:

- rate limiting,
- CSRF where relevant,
- input validation,
- open redirect prevention,
- audit for sensitive public operation,
- no accidental data leak.

### 35.2 Anonymous Caller

Anonymous bukan berarti tidak ada security model. Anonymous harus eksplisit.

```text
actor = AnonymousActor
permissions = [PUBLIC_READ] maybe
```

Jangan biarkan null principal menyebar tanpa definisi.

### 35.3 System Actor

System actor adalah actor non-human untuk job internal.

Contoh:

- scheduled reconciliation,
- archival job,
- notification sender,
- integration sync,
- migration script.

System actor perlu:

- identity jelas,
- permission terbatas,
- audit,
- separation dari human admin,
- credential rotation.

Anti-pattern:

```text
if no user, assume admin
```

---

## 36. Security Metadata: Annotation, Descriptor, Config, Database Policy

Security rule bisa berasal dari banyak tempat:

- Java annotation,
- `web.xml`,
- app server config,
- realm config,
- IdP client config,
- database mapping table,
- policy engine,
- environment variables,
- gateway route config,
- IaC manifests.

Masalah production sering terjadi karena metadata tidak sinkron.

Contoh:

```text
Code expects role CASE_APPROVER.
IdP sends group case-approvers.
App server maps case-approvers to Approver.
@RolesAllowed expects CASE_APPROVER.
Result: always forbidden.
```

Atau lebih buruk:

```text
UAT gateway protects /api/admin/*.
PROD route typo protects /api/admin only.
/admin/users endpoint exposed.
```

Prinsip:

- security config harus versioned,
- role mapping harus documented,
- environment drift harus diuji,
- deny-by-default route policy,
- automated security regression test.

---

## 37. Portability vs Vendor Reality

Jakarta specs memberi kontrak portable, tetapi app server berbeda dalam detail:

- Payara/GlassFish lineage,
- WildFly/JBoss/Elytron,
- Open Liberty,
- TomEE,
- WebLogic,
- WebSphere lineage,
- embedded vs full profile differences.

Perbedaan bisa muncul pada:

- realm configuration,
- group-to-role mapping,
- OIDC support,
- JASPIC registration,
- JACC provider support,
- classloading,
- annotation scanning,
- CDI integration,
- session clustering,
- security context propagation.

Mental model portable:

```text
Design against the spec, verify against the target runtime.
```

Jangan menganggap contoh dari satu container pasti sama di container lain.

---

## 38. Migration Mindset: Legacy to Modern

Banyak enterprise Java app tidak dibangun greenfield. Migration umum:

```text
Java EE 8 javax + app server realm + form login
  -> Jakarta EE 10/11 jakarta + OIDC + external IdP
```

Migration risk:

- annotation namespace mismatch,
- old JAAS realm tidak compatible,
- role mapping berubah,
- session behavior berubah,
- logout behavior berubah,
- password store migrasi,
- ID subject berubah,
- audit actor berubah,
- CORS/CSRF behavior berubah karena SPA adoption,
- old integration pakai header trust.

Migration strategy:

1. Inventory current authentication mechanisms.
2. Inventory all role checks and security constraints.
3. Identify source of truth user identity.
4. Define stable principal id.
5. Define role/group/claim mapping contract.
6. Build compatibility adapter if needed.
7. Add security regression tests.
8. Migrate namespace and runtime.
9. Run dual verification for identity mapping.
10. Audit production behavior after cutover.

---

## 39. Practical Checklist Saat Mendesain Fitur Security

Gunakan checklist ini sebelum memilih API.

### 39.1 Identity

- Siapa caller?
- Human, service, job, external partner, anonymous?
- Apa stable identifier-nya?
- Dari mana identity berasal?
- Apakah account linking diperlukan?

### 39.2 Authentication

- Credential apa yang digunakan?
- Siapa yang memvalidasi credential?
- Apakah MFA/step-up diperlukan?
- Bagaimana expiry?
- Bagaimana failure response?

### 39.3 Session/Token

- Session atau token?
- Token disimpan di mana?
- Cookie flags apa?
- Logout seperti apa?
- Role refresh bagaimana?

### 39.4 Authorization

- Action apa?
- Resource apa?
- Tenant apa?
- State apa?
- Relationship apa?
- Role hanya gate atau final decision?
- Deny reason apa?

### 39.5 Propagation

- Apakah call downstream membawa user identity?
- Apakah service identity dibedakan?
- Apakah token audience benar?
- Apakah context hilang di async?

### 39.6 Audit

- Apa event yang dicatat?
- Actor siapa?
- On behalf of siapa?
- Resource apa?
- Decision allow/deny?
- Correlation id?
- Sensitive data direduksi?

### 39.7 Failure

- Jika IdP down, apa yang terjadi?
- Jika policy store down, allow atau deny?
- Jika role mapping kosong, allow atau deny?
- Jika token expired, response apa?
- Jika audit gagal, action tetap jalan atau fail closed?

---

## 40. Minimal Reference Architecture untuk Seri Ini

Kita akan sering memakai reference architecture berikut:

```text
Frontend SPA / Browser
  -> HTTPS
  -> Reverse Proxy / Ingress / Gateway
  -> Jakarta REST Application
      - Servlet container
      - Jakarta Security
      - JAX-RS resources
      - CDI services
      - AuthorizationService
      - ActorResolver
      - AuditService
  -> Database
  -> External IdP (OIDC/SAML)
  -> Internal downstream services
```

Untuk variasi, kita juga akan bahas:

- server-rendered Jakarta app,
- service-to-service API,
- mTLS integration,
- legacy JAAS realm,
- Spring Security interoperability,
- MicroProfile JWT,
- Keycloak-like IdP integration.

---

## 41. What “Top 1% Understanding” Means Here

Dalam konteks seri ini, “top 1%” bukan berarti tahu semua annotation. Itu baseline.

Level yang lebih tinggi berarti mampu:

1. Mendesain security boundary end-to-end.
2. Menjelaskan siapa source of truth untuk identity, role, permission, dan audit.
3. Membedakan authentication, identity mapping, authorization, and audit secara tajam.
4. Mendeteksi privilege escalation dari requirement yang tampak normal.
5. Mendesain domain authorization untuk workflow kompleks.
6. Memahami container security lifecycle.
7. Debug issue role mapping, session, token, issuer, audience, logout, context propagation.
8. Membuat security invariant dan test negatif.
9. Membaca spec/API dengan mental model yang benar.
10. Mendesain migration dari `javax` ke `jakarta` tanpa kehilangan enforcement.
11. Menjelaskan trade-off gateway validation vs app validation.
12. Menghasilkan audit trail yang defensible.
13. Mengantisipasi failure mode production.

---

## 42. Preview Part Berikutnya

Part berikutnya akan masuk ke vocabulary mendalam:

```text
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
```

Kita akan membedah perbedaan konsep yang sering dicampur:

- identity vs account,
- user vs caller,
- principal vs subject,
- group vs role,
- role vs permission,
- claim vs authority,
- scope vs application permission,
- tenant vs organization,
- delegated actor vs effective actor.

Ini penting karena desain security yang buruk sering dimulai dari vocabulary yang kabur.

---

## 43. Ringkasan Inti Part 00

1. Enterprise Java security adalah pipeline, bukan satu login check.
2. Authentication menjawab siapa caller; authorization menjawab boleh melakukan apa.
3. Jakarta Security, Jakarta Authentication, dan Jakarta Authorization berada di layer berbeda.
4. Servlet/container security memberi enforcement awal, tetapi domain authorization tetap diperlukan.
5. Role bukan permission; group bukan role; token bukan keputusan final.
6. Session dan token punya threat model berbeda.
7. Trust boundary harus eksplisit, terutama di belakang gateway/reverse proxy.
8. Security context runtime sebaiknya diterjemahkan menjadi domain actor yang eksplisit.
9. Authorization decision sebaiknya auditable, bukan sekadar boolean tersembunyi.
10. Security invariant harus berlaku lintas UI, API, job, dan service internal.
11. `javax.*` ke `jakarta.*` migration bisa mematahkan security annotation jika tidak diuji.
12. Top-level engineer berpikir dalam failure model, auditability, propagation, dan defensibility.

---

## 44. Sumber Referensi Resmi dan Penting

Referensi ini menjadi dasar orientasi seri. Detail spesifik akan dibahas dan ditambahkan lagi pada part-part berikutnya.

1. Jakarta Security specifications  
   https://jakarta.ee/specifications/security/

2. Jakarta Security 4.0 specification page  
   https://jakarta.ee/specifications/security/4.0/

3. Jakarta Authentication specifications  
   https://jakarta.ee/specifications/authentication/

4. Jakarta Authentication 3.1 specification page  
   https://jakarta.ee/specifications/authentication/3.1/

5. Jakarta Authorization specifications  
   https://jakarta.ee/specifications/authorization/

6. Jakarta Authorization 3.0 specification page  
   https://jakarta.ee/specifications/authorization/3.0/

7. Jakarta EE specification overview  
   https://jakarta.ee/specifications/

8. Jakarta EE 11 release page  
   https://jakarta.ee/release/11/

9. OpenJDK JDK 25 project page  
   https://openjdk.org/projects/jdk/25/

---

## 45. Status Seri

Seri **belum selesai**. Ini adalah:

```text
Part 00 dari 35 — Orientation: Enterprise Java Security Mental Model
```

Part berikutnya:

```text
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 032 — Capstone: Designing a Production-Grade Persistence Layer for a Complex Case Management System](../persistence/learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-032.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission](./learn-java-jakarta-security-authentication-authorization-identity-part-01-identity-principal-subject-role-permission.md)
