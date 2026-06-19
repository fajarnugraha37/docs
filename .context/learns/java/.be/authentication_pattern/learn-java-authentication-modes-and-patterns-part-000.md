# learn-java-authentication-modes-and-patterns-part-000

# Part 0 — Orientation: Mental Model of Authentication in Java Systems

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / architecture-grade / production-grade  
> Fokus Part 0: membangun mental model agar semua mode authentication dapat dipahami sebagai sistem, bukan sekadar konfigurasi framework.

---

## 0.1. Mengapa Part 0 Ini Penting

Authentication sering terlihat sederhana dari permukaan:

```text
user memasukkan username/password -> sistem cek database -> user login
```

Atau dalam sistem modern:

```text
browser redirect ke IdP -> user login -> aplikasi menerima token -> request dianggap authenticated
```

Namun di sistem nyata, terutama sistem enterprise, government, regulatory, financial, SaaS, microservices, dan multi-tenant, authentication bukan sekadar fitur login. Authentication adalah mekanisme untuk menjawab pertanyaan paling fundamental:

```text
Siapa aktor ini, bukti apa yang membuat sistem percaya, dalam konteks apa klaim itu valid,
dan risiko apa yang muncul jika sistem salah percaya?
```

Seorang engineer level biasa biasanya mengenal authentication sebagai:

```text
Spring Security config
JWT filter
Login form
OAuth2 login
Session cookie
```

Engineer yang jauh lebih matang melihat authentication sebagai kombinasi dari:

```text
actor model
credential model
proof model
trust boundary
session continuity
token lifecycle
identity propagation
key lifecycle
policy enforcement
failure handling
auditability
incident response
```

Tujuan Part 0 adalah memberi peta mental sebelum masuk ke detail teknis di part-part berikutnya.

---

## 0.2. Core Thesis

Authentication bukan hanya proses “membuktikan user”. Authentication adalah **proses sistemik untuk mengikat suatu aksi ke suatu aktor melalui bukti yang dapat diverifikasi dalam batas kepercayaan tertentu**.

Kalimat ini padat. Pecahannya:

```text
aktor      -> siapa atau apa yang melakukan aksi
aksi       -> operasi yang ingin dilakukan
bukti      -> credential/proof/assertion/token/certificate/signature
verifikasi -> proses sistem untuk mengecek bukti
batas      -> konteks tempat bukti itu valid
kepercayaan -> asumsi eksplisit tentang siapa/apa yang dipercaya
```

Contoh sederhana:

```text
Aktor:
  Fajar sebagai human user

Aksi:
  membuka halaman case management

Bukti:
  session cookie yang diterbitkan setelah login OIDC

Verifikasi:
  aplikasi mengecek session ID di server-side session store

Batas:
  hanya valid untuk aplikasi ACEAS, environment production, browser session saat ini

Kepercayaan:
  aplikasi percaya pada IdP, TLS, cookie security, session store, dan mapping user identity
```

Contoh machine-to-machine:

```text
Aktor:
  service screening-engine

Aksi:
  memanggil service case-management

Bukti:
  access token client credentials dengan audience case-management

Verifikasi:
  case-management memvalidasi signature, issuer, audience, expiry, scope

Batas:
  hanya valid untuk service-to-service API tertentu

Kepercayaan:
  case-management percaya pada authorization server dan private key yang menerbitkan token
```

Dari sini, authentication selalu memiliki minimal lima elemen:

1. **Actor** — siapa/apa yang bertindak.
2. **Credential/proof** — apa bukti yang diberikan.
3. **Verifier** — siapa yang memvalidasi bukti.
4. **Context** — kapan, di mana, dan untuk apa bukti valid.
5. **Resulting identity** — identitas apa yang diterima sistem setelah validasi.

Jika salah satu elemen tidak jelas, desain authentication rentan ambigu.

---

## 0.3. Authentication vs Authorization vs Identity vs Session

Empat istilah ini sering dicampur. Untuk engineer senior, pemisahannya harus tajam.

### 0.3.1. Identity

Identity adalah representasi aktor.

Contoh identity:

```text
user id: 12345
username: fajar
email: fajar@example.com
employee id: E00123
subject: 9f4a7d2c-....
service account: screening-engine-prod
certificate subject: CN=case-service-prod
```

Identity tidak otomatis berarti sudah authenticated. Identity bisa saja hanya klaim mentah.

Contoh:

```http
X-User-Id: fajar
```

Header itu menyatakan identity, tetapi tanpa verifikasi, ia bukan bukti yang cukup.

### 0.3.2. Authentication

Authentication adalah proses membuktikan bahwa aktor memang memiliki hubungan sah dengan identity tertentu.

Contoh:

```text
password cocok dengan password hash
private key dapat menandatangani challenge
certificate chain valid dan dipercaya
JWT signature valid dan issuer dipercaya
session ID ditemukan di session store
OIDC ID token valid dari issuer yang dipercaya
```

Authentication menjawab:

```text
Can I believe this actor is who/what they claim to be?
```

### 0.3.3. Authorization

Authorization menentukan apakah identity yang sudah dipercaya boleh melakukan sesuatu.

Contoh:

```text
user fajar boleh view case?
service A boleh call endpoint B?
admin boleh approve appeal?
operator boleh impersonate user?
token scope boleh melakukan write:document?
```

Authorization menjawab:

```text
Given this authenticated identity, is this action allowed?
```

### 0.3.4. Session

Session adalah kontinuitas setelah authentication berhasil.

Authentication sering terjadi sekali:

```text
login at 09:00
```

Session membuat sistem tetap mengenali aktor setelah itu:

```text
request at 09:01
request at 09:05
request at 09:15
```

Session bisa berbentuk:

```text
server-side session cookie
stateless JWT access token
opaque token
refresh token family
mTLS connection-level identity
Kerberos ticket
```

Session bukan authentication itu sendiri, melainkan hasil atau kelanjutan dari authentication.

### 0.3.5. Ringkasan Perbedaan

| Konsep | Pertanyaan | Contoh |
|---|---|---|
| Identity | Siapa/apa aktornya? | user id, service account, certificate subject |
| Authentication | Apakah klaim identity terbukti? | password verified, token signature valid |
| Authorization | Apa yang boleh dilakukan? | role, permission, scope, policy |
| Session | Bagaimana identity dipertahankan antar request? | cookie, token, ticket |

Kesalahan desain umum:

```text
Menganggap JWT valid == user boleh melakukan semua hal.
```

Yang benar:

```text
JWT valid hanya membuktikan bahwa token dapat dipercaya dalam konteks tertentu.
Authorization tetap perlu mengevaluasi scope, role, permission, ownership, tenant, state object, dan business rule.
```

---

## 0.4. Actor Model: Authentication Selalu Dimulai dari “Siapa Aktornya?”

Sistem Java modern jarang hanya punya satu tipe aktor. Minimal ada beberapa kategori.

### 0.4.1. Human User

Contoh:

```text
citizen
business user
agency officer
internal operator
system administrator
support staff
external partner user
```

Authentication mode umum:

```text
password
OIDC login
SAML SSO
MFA
passkey
Kerberos/SPNEGO
session cookie
```

Risiko utama:

```text
phishing
credential stuffing
session hijack
MFA fatigue
account recovery abuse
privilege escalation
shared account usage
```

### 0.4.2. Service / Workload

Contoh:

```text
case-service
screening-engine
notification-service
batch-worker
event-syncer
report-generator
```

Authentication mode umum:

```text
client credentials
mTLS
private_key_jwt
Kubernetes service account token
cloud workload identity
HMAC request signing
API key for internal integration
```

Risiko utama:

```text
secret leakage
over-broad service account
wrong audience token
token replay
service impersonation
confused deputy
stale credential after deployment
```

### 0.4.3. External Partner / API Client

Contoh:

```text
external agency system
payment gateway
regulatory data provider
third-party vendor
B2B integration client
```

Authentication mode umum:

```text
mTLS
OAuth2 client credentials
HMAC signing
SAML assertion
API key plus IP allowlist
signed JWT assertion
```

Risiko utama:

```text
partner key compromise
replay attack
weak onboarding/offboarding
no credential rotation
shared credential across environments
insufficient non-repudiation
```

### 0.4.4. Device

Contoh:

```text
mobile device
POS terminal
IoT device
scanner kiosk
field officer tablet
```

Authentication mode umum:

```text
device certificate
OAuth2 device flow
PKCE
hardware-backed key
attestation
refresh token binding
```

Risiko utama:

```text
lost device
cloned device credential
insecure local storage
offline replay
jailbroken/rooted device
```

### 0.4.5. Batch Job / Scheduler

Contoh:

```text
nightly archival job
email reminder scheduler
data reconciliation job
report generation job
message replay worker
```

Authentication mode umum:

```text
service account
client credentials
Kubernetes service account
cloud IAM role
mTLS
static secret loaded from secret manager
```

Risiko utama:

```text
job runs with too much privilege
no human accountability
credential forgotten after project handover
bad audit actor: “SYSTEM” for everything
scheduler endpoint exposed
```

### 0.4.6. Delegated Actor

Ini lebih kompleks.

Contoh:

```text
admin acts on behalf of user
support officer impersonates citizen view
service processes request originally submitted by human
workflow engine performs transition triggered by approver
batch job finalizes expired applications
```

Dalam kasus ini, ada dua identity:

```text
immediate actor  -> siapa yang secara teknis memanggil sistem sekarang
original actor   -> siapa yang menyebabkan aksi bisnis terjadi
```

Contoh audit yang buruk:

```text
updated_by = SYSTEM
```

Contoh audit yang lebih defensible:

```text
technical_actor = workflow-engine-prod
business_actor  = officer:U12345
on_behalf_of    = applicant:A7788
trigger         = appeal.approved
correlation_id  = ...
```

Top 1% engineer tidak hanya bertanya “login pakai apa?”, tetapi:

```text
actor apa saja yang ada?
apakah aktor manusia, mesin, atau delegated?
apakah identity langsung atau hasil propagasi?
apakah audit bisa membedakan technical actor dan business actor?
apakah authentication proof masih valid saat aksi benar-benar dieksekusi?
```

---

## 0.5. Credential, Proof, Assertion, Token, dan Session

Kata-kata ini sering dipakai bergantian, padahal berbeda.

### 0.5.1. Credential

Credential adalah sesuatu yang dimiliki/diketahui aktor untuk membuktikan identity.

Contoh:

```text
password
private key
client secret
API key
refresh token
TOTP seed
Kerberos keytab
certificate private key
```

Credential biasanya harus dilindungi karena pencurian credential memungkinkan impersonation.

### 0.5.2. Proof

Proof adalah hasil penggunaan credential untuk membuktikan possession/knowledge.

Contoh:

```text
password dikirim saat login
HMAC signature atas request
TLS client certificate handshake
WebAuthn signed challenge
private_key_jwt client assertion
```

Credential idealnya tidak selalu dikirim langsung. Pada proof-of-possession, sistem lebih baik meminta aktor membuktikan kepemilikan secret/private key tanpa mengirim secret itu sendiri.

### 0.5.3. Assertion

Assertion adalah pernyataan identity yang diterbitkan oleh pihak yang dipercaya.

Contoh:

```text
SAML assertion
OIDC ID token
JWT signed by authorization server
Kerberos ticket
```

Assertion tidak otomatis valid. Verifier harus mengecek:

```text
issuer
audience
signature
expiry
not-before
nonce/state jika relevan
binding ke request/session jika relevan
```

### 0.5.4. Token

Token adalah artefak yang dipakai untuk membawa atau mereferensikan hak akses/session/identity.

Contoh:

```text
access token
refresh token
ID token
opaque token
session token
CSRF token
one-time reset token
```

Tidak semua token adalah authentication token.

Contoh:

```text
CSRF token bukan bukti identity; ia bukti bahwa request berasal dari flow/session yang diharapkan.
```

### 0.5.5. Session

Session adalah hubungan berkelanjutan antara client dan sistem.

Session dapat diwakili oleh:

```text
cookie yang menunjuk server-side session
JWT access token dengan expiry
opaque token dengan introspection
TLS connection identity
Kerberos ticket
```

### 0.5.6. Model Hubungan

```text
Credential -> digunakan untuk menghasilkan Proof
Proof      -> diverifikasi oleh sistem
Verifier   -> menghasilkan Authenticated Identity
Identity   -> dimasukkan ke Security Context
Context    -> dipakai oleh Authorization dan Audit
Session    -> mempertahankan continuity antar request
```

Dalam bentuk flow:

```text
[Actor]
   |
   | presents proof using credential
   v
[Authentication Mechanism]
   |
   | verifies proof against trust source
   v
[Authenticated Principal]
   |
   | stored/propagated in context
   v
[Security Context]
   |
   | evaluated by authorization/audit/business logic
   v
[Action]
```

---

## 0.6. Trust Boundary: Authentication Adalah Masalah Kepercayaan

Authentication selalu bergantung pada sesuatu yang dipercaya.

Contoh:

```text
password auth       -> percaya pada password hash store
JWT auth            -> percaya pada issuer signing key
OIDC auth           -> percaya pada identity provider
mTLS auth           -> percaya pada CA/trust store
SAML auth           -> percaya pada IdP metadata/signing cert
API key auth        -> percaya pada key registry
Kerberos auth       -> percaya pada KDC
session cookie auth -> percaya pada session store dan cookie security
```

Pertanyaan desain utama:

```text
Siapa trust anchor-nya?
Bagaimana trust anchor itu dirotasi?
Apa yang terjadi jika trust anchor bocor?
Apa yang terjadi jika trust anchor unavailable?
Bagaimana sistem tahu trust anchor mana yang valid untuk tenant/env ini?
```

### 0.6.1. Trust Boundary dalam Arsitektur Umum

```text
[Browser]
   |
   | Internet / untrusted network
   v
[Edge / Load Balancer / WAF]
   |
   | trusted internal network? belum tentu
   v
[API Gateway]
   |
   | may authenticate or just route
   v
[Java Application]
   |
   | internal service calls
   v
[Database / Message Broker / External Systems]
```

Kesalahan umum:

```text
Gateway sudah authenticate, jadi backend percaya semua header X-User-Id.
```

Ini hanya aman jika ada invariant kuat:

```text
1. Backend tidak bisa diakses bypass gateway.
2. Gateway menghapus incoming identity headers dari client.
3. Gateway menambahkan identity headers sendiri.
4. Backend hanya menerima traffic dari gateway yang trusted.
5. Ada network policy/mTLS/firewall yang enforce boundary.
6. Header identity punya format dan signature/attestation bila perlu.
```

Jika invariant tidak ada, header injection bisa membuat impersonation.

---

## 0.7. Authentication sebagai State Machine

Salah satu cara paling kuat memahami authentication adalah melihatnya sebagai state machine.

### 0.7.1. Human Session State Machine

```text
[Anonymous]
   |
   | submit credential / redirect to IdP
   v
[Authentication In Progress]
   |
   | proof valid
   v
[Authenticated]
   |
   | session active
   v
[Authenticated + Elevated]
   |
   | step-up MFA success
   v
[Session Expired]

Failure paths:

[Authentication In Progress]
   | proof invalid
   v
[Failed Attempt]

[Authenticated]
   | idle timeout / absolute timeout / logout / revocation
   v
[Unauthenticated]
```

### 0.7.2. Token Lifecycle State Machine

```text
[Issued]
   |
   | used before expiry
   v
[Active]
   |
   | rotated / refreshed
   v
[Superseded]

[Issued]
   | expiry reached
   v
[Expired]

[Issued]
   | revoked due to logout/incident/admin action
   v
[Revoked]

[Refresh Token]
   | reuse detected after rotation
   v
[Compromised Family]
```

### 0.7.3. Why State Machine Thinking Matters

Tanpa state machine, desain sering menghasilkan celah:

```text
password reset token masih valid setelah password diubah
refresh token lama masih bisa dipakai setelah refresh token rotation
session tidak dirotate setelah login
MFA step-up tidak punya expiry sendiri
logout hanya hapus cookie tapi access token masih valid lama
role berubah tapi session lama masih membawa role lama
```

Authentication yang baik harus bisa menjawab:

```text
state apa saja yang mungkin?
transisi apa yang valid?
transisi mana yang harus ditolak?
apakah transisi tercatat di audit?
apakah ada race condition antar transisi?
```

---

## 0.8. Java Authentication Landscape dari Java 8 sampai Java 25

Java authentication tidak berada dalam satu layer saja. Ada beberapa lapisan.

### 0.8.1. Java SE Layer

Komponen relevan:

```text
java.security.Principal
javax.security.auth.Subject
javax.security.auth.login.LoginContext
javax.security.auth.spi.LoginModule
javax.net.ssl.SSLContext
KeyStore
TrustManager
KeyManager
GSS-API / Kerberos related APIs
```

JAAS memberi model pluggable authentication: aplikasi membuat `LoginContext`, konfigurasi menentukan `LoginModule`, lalu modul melakukan authentication dan mengasosiasikan `Principal` serta credential dengan `Subject`.

Mental model:

```text
Java SE tidak tahu HTTP login modern, tetapi tahu konsep Subject, Principal, credential, LoginModule, dan security context tertentu.
```

### 0.8.2. Servlet / Jakarta EE Layer

Komponen relevan:

```text
HttpServletRequest#getUserPrincipal
HttpServletRequest#isUserInRole
container-managed authentication
FORM/BASIC auth
Jakarta Security HttpAuthenticationMechanism
IdentityStore
SecurityContext
Jakarta Authentication ServerAuthModule
```

Mental model:

```text
Container dapat menjadi authentication boundary.
Application menerima caller principal dari container.
```

### 0.8.3. Spring Security Layer

Komponen relevan:

```text
SecurityContextHolder
SecurityContext
Authentication
AuthenticationManager
AuthenticationProvider
UserDetailsService
AuthenticationFilter
AuthenticationEntryPoint
OAuth2LoginAuthenticationFilter
BearerTokenAuthenticationFilter
```

Mental model:

```text
Spring Security membuat security context application-level yang bisa diisi oleh banyak mechanism.
```

Spring Security sendiri menyatakan bahwa pusat model authentication-nya adalah `SecurityContextHolder`, yang menyimpan detail siapa yang sedang authenticated dalam konteks Spring Security.

### 0.8.4. Framework-Specific Cloud Native Layer

Contoh:

```text
Quarkus OIDC
Micronaut Security
Helidon Security
Vert.x auth
Keycloak adapters / generic OIDC clients
```

Mental model:

```text
Framework cloud-native biasanya mengoptimalkan OIDC/JWT/token propagation untuk microservices.
```

### 0.8.5. Platform Layer

Contoh:

```text
Kubernetes service account
AWS IAM role
AWS STS
Azure workload identity
GCP workload identity
service mesh mTLS
API gateway authentication
```

Mental model:

```text
Banyak authentication modern tidak dimulai dari Java code, tetapi dari platform identity.
Java app hanya menerima, memvalidasi, atau memetakan identity tersebut.
```

### 0.8.6. Cross-Version Java 8–25 Relevance

| Area | Java 8 | Java 11/17 | Java 21 | Java 25 |
|---|---|---|---|---|
| JAAS | Relevan | Relevan | Relevan | Relevan |
| TLS/mTLS | Relevan | Lebih modern TLS defaults | Lebih matang | Tetap relevan |
| Keystore | JKS/PKCS12 | PKCS12 makin umum | PKCS12/PEM workflows umum | PEM support makin penting |
| Threads | Platform threads | Platform threads | Virtual threads | Virtual threads matang |
| Context propagation | ThreadLocal umum | ThreadLocal umum | ThreadLocal perlu hati-hati dengan virtual threads | semakin penting |
| Framework baseline | Spring Security 5 era | Spring Security 5/6 | Spring Boot 3.x common | Modern stacks menuju Java 25 |

Intinya:

```text
Java version memengaruhi runtime capability, TLS/key handling, threading model, dan framework support.
Tetapi prinsip authentication tetap sama: actor, proof, verifier, context, trust boundary.
```

---

## 0.9. Authentication Modes: Peta Awal

Mode authentication dapat diklasifikasikan berdasarkan bukti yang dipakai.

### 0.9.1. Password-Based

```text
actor proves knowledge of password
```

Contoh Java usage:

```text
Spring Security username/password
Jakarta Security DatabaseIdentityStore
custom LoginModule
legacy servlet FORM auth
```

Kekuatan:

```text
mudah dipahami
mudah diimplementasi
cocok untuk sistem kecil/internal tertentu
```

Kelemahan:

```text
phishing
credential stuffing
password reuse
reset flow sering menjadi celah
```

### 0.9.2. Session Cookie-Based

```text
actor presents session identifier issued after login
```

Kekuatan:

```text
bagus untuk browser app
mudah revoke server-side
bisa menyimpan state di server
```

Kelemahan:

```text
CSRF risk
session fixation
distributed session complexity
cookie security misconfiguration
```

### 0.9.3. Bearer Token-Based

```text
actor presents token; whoever has token can use it
```

Contoh:

```text
JWT access token
opaque access token
API key
```

Kekuatan:

```text
mudah untuk API
cocok untuk stateless validation jika JWT
mudah digunakan lintas service
```

Kelemahan:

```text
leak = impersonation
revocation sulit untuk stateless JWT
wrong audience validation sering terjadi
```

### 0.9.4. Proof-of-Possession-Based

```text
actor proves possession of private key/secret for each auth event or request
```

Contoh:

```text
mTLS
HMAC request signing
DPoP
WebAuthn
private_key_jwt
```

Kekuatan:

```text
lebih tahan token theft
lebih kuat untuk partner/service integration
bisa memberi non-repudiation lebih baik jika didesain benar
```

Kelemahan:

```text
lebih kompleks
key lifecycle sulit
clock/canonicalization/certificate rotation bisa menjadi sumber incident
```

### 0.9.5. Federated Authentication

```text
application delegates authentication to trusted identity provider
```

Contoh:

```text
OIDC
SAML
Kerberos enterprise SSO
```

Kekuatan:

```text
centralized identity
MFA bisa dipusatkan
lifecycle user lebih mudah
SSO
```

Kelemahan:

```text
IdP outage impact besar
claim mapping risk
account linking risk
logout semantics kompleks
```

### 0.9.6. Workload/Platform Identity

```text
platform proves workload identity
```

Contoh:

```text
Kubernetes service account
AWS IAM role + STS
service mesh mTLS identity
cloud workload identity federation
```

Kekuatan:

```text
mengurangi static secrets
baik untuk cloud-native
rotation bisa otomatis
```

Kelemahan:

```text
platform misconfiguration fatal
trust boundary sering tidak dipahami app developer
local dev parity sulit
```

---

## 0.10. The Authentication Pipeline

Hampir semua authentication mechanism dapat dipetakan ke pipeline generik.

```text
1. Extract
2. Normalize
3. Verify
4. Resolve
5. Bind
6. Propagate
7. Enforce
8. Audit
```

### 0.10.1. Extract

Sistem mengambil bukti dari request/context.

Contoh:

```text
Authorization: Bearer <token>
Cookie: JSESSIONID=...
TLS client certificate
username/password form body
SAMLResponse parameter
X-API-Key header
X-Signature header
```

Pertanyaan:

```text
Dari mana bukti boleh dibaca?
Apakah banyak sumber credential boleh aktif sekaligus?
Jika ada cookie dan bearer token bersamaan, mana yang menang?
Apakah header dari external client bisa menimpa header dari gateway?
```

### 0.10.2. Normalize

Input dibuat menjadi bentuk internal.

Contoh:

```text
trim token prefix Bearer
parse JWT
parse certificate subject
parse username canonical form
normalize tenant domain
parse SAML assertion
```

Risiko:

```text
case sensitivity bug
Unicode confusion
email canonicalization error
header duplication ambiguity
multiple Authorization headers
```

### 0.10.3. Verify

Bukti diverifikasi.

Contoh:

```text
password hash check
JWT signature validation
certificate chain validation
HMAC signature comparison
introspection call
session lookup
OIDC nonce validation
```

Pertanyaan:

```text
Apa yang diverifikasi?
Apa yang sengaja tidak diverifikasi?
Apa default jika verifier timeout?
Apakah fail-open atau fail-closed?
```

### 0.10.4. Resolve

Identity hasil verifikasi dipetakan ke internal principal.

Contoh:

```text
sub -> internal user id
certificate SAN -> service account
API key id -> client application
SAML NameID -> enterprise user
```

Risiko:

```text
email berubah
same email from different issuer
sub berbeda antar tenant
account linking salah
stale user status
```

### 0.10.5. Bind

Identity diikat ke konteks eksekusi.

Contoh:

```text
Spring SecurityContext
Jakarta SecurityContext
HttpServletRequest principal
custom RequestContext
Reactor Context
AuditContext
```

Risiko:

```text
context hilang di async call
context bocor ke request lain
ThreadLocal tidak dibersihkan
identity tidak ikut ke message/job
```

### 0.10.6. Propagate

Identity diteruskan ke layer berikut.

Contoh:

```text
controller -> service -> repository
service A -> service B
HTTP request -> Kafka message
workflow engine -> task worker
batch job -> audit event
```

Pertanyaan:

```text
Apakah propagate end-user identity atau service identity?
Apakah downstream perlu original actor?
Apakah token relay aman?
Apakah perlu token exchange?
```

### 0.10.7. Enforce

Sistem memakai identity untuk policy decision.

Contoh:

```text
endpoint requires authenticated user
method requires role CASE_OFFICER
object-level rule: user can only view assigned case
state rule: only approver can approve pending appeal
```

Part 0 tidak membahas authorization dalam detail, tetapi authentication output harus cukup kaya agar authorization bisa benar.

### 0.10.8. Audit

Authentication event dan hasilnya dicatat.

Contoh:

```text
login success
login failure
MFA challenge
token issued
token refreshed
session expired
logout
service token used
API key rotated
certificate rejected
```

Audit harus bisa menjawab:

```text
siapa aktornya?
bukti apa yang digunakan?
issuer/verifier siapa?
kapan?
dari mana?
untuk tenant/app apa?
berhasil/gagal kenapa?
correlation id apa?
```

---

## 0.11. Authentication Boundary vs Authorization Boundary

Authentication boundary adalah titik tempat sistem menetapkan identity.

Authorization boundary adalah titik tempat sistem memutuskan boleh/tidak.

Dalam sistem sederhana, keduanya sering dekat:

```text
Spring Security filter authenticates -> controller method checks role
```

Dalam sistem kompleks, keduanya bisa tersebar:

```text
IdP authenticates user
API gateway validates token
Java backend maps claims
service layer checks business permission
workflow engine checks transition actor
DB row-level policy filters tenant data
```

Risiko jika boundary tidak jelas:

```text
satu layer menganggap layer lain sudah mengecek sesuatu
backend menerima claim yang belum divalidasi
service internal percaya request karena “dari network internal”
authorization memakai user id dari request body, bukan authenticated principal
```

Invariant yang harus ditetapkan:

```text
1. Hanya satu layer menjadi source of truth untuk authenticated principal dalam process.
2. Semua input identity dari client dianggap untrusted sampai diverifikasi.
3. Authorization tidak boleh mengambil actor identity dari payload bisnis.
4. Downstream service harus tahu apakah identity berasal dari end-user, gateway, service, atau batch.
5. Audit harus mencatat boundary tempat identity ditetapkan.
```

---

## 0.12. Authentication and Java Context Objects

Di Java, hasil authentication biasanya disimpan di context.

### 0.12.1. JAAS Subject

Model:

```text
Subject
  principals
  public credentials
  private credentials
```

JAAS berguna untuk memahami bahwa authenticated entity bukan hanya string username. Ia bisa punya banyak principal dan credential.

Contoh mental:

```text
Subject:
  Principal: UserPrincipal("fajar")
  Principal: TenantPrincipal("agency-a")
  Principal: RolePrincipal("CASE_OFFICER")
  PublicCredential: certificate
  PrivateCredential: kerberos ticket/private credential
```

### 0.12.2. Servlet Principal

Model:

```java
request.getUserPrincipal();
request.isUserInRole("ADMIN");
```

Servlet model membuat identity tersedia pada request.

Kelemahannya:

```text
terlalu request-centric
kurang kaya untuk distributed context
role sering terlalu coarse-grained
```

### 0.12.3. Jakarta SecurityContext

Model:

```text
SecurityContext gives caller principal, role checks, and authentication status.
```

Jakarta Security cocok untuk aplikasi yang ingin portable di Jakarta EE container.

### 0.12.4. Spring SecurityContext

Model:

```text
SecurityContextHolder
  -> SecurityContext
      -> Authentication
          -> principal
          -> credentials
          -> authorities
          -> authenticated flag
          -> details
```

Kekuatan:

```text
sangat extensible
banyak authentication mechanism
integrasi kuat dengan web/method security/reactive
```

Risiko:

```text
ThreadLocal leakage
custom Authentication object asal-asalan
principal berisi entity JPA lazy-loaded
credentials tidak dibersihkan
context tidak propagate ke async/reactive
```

### 0.12.5. Custom Domain Context

Pada sistem besar, sering perlu context domain sendiri:

```java
record ActorContext(
    String principalId,
    ActorType actorType,
    String tenantId,
    String sessionId,
    String authenticationMethod,
    String issuer,
    Instant authenticatedAt,
    Optional<String> originalActorId,
    Optional<String> correlationId
) {}
```

Bukan untuk menggantikan framework security context, tetapi untuk memberi bentuk eksplisit pada business/audit layer.

Pola yang baik:

```text
Framework SecurityContext -> Authentication Adapter -> Domain ActorContext
```

Bukan:

```text
Controller membaca raw JWT claims di mana-mana.
```

---

## 0.13. Authentication in Distributed Java Systems

Di monolith, identity biasanya hidup di satu process.

Di distributed system, identity harus menyeberang boundary:

```text
browser -> gateway -> service A -> service B -> database
                         |
                         v
                      Kafka topic -> worker -> external API
```

Masalah utama:

```text
identity propagation
trust degradation
token audience mismatch
service impersonation
loss of original actor
asynchronous audit gap
```

### 0.13.1. Token Relay

Service A menerima token dari user lalu meneruskannya ke Service B.

Kelebihan:

```text
simple
B bisa tahu end-user identity
```

Risiko:

```text
token audience mungkin bukan untuk B
token terlalu powerful jika bocor di service A
B menjadi tergantung token eksternal
sulit membedakan A sebagai caller vs user sebagai subject
```

### 0.13.2. Token Exchange

Service A menukar token user menjadi token baru untuk memanggil Service B.

Kelebihan:

```text
audience tepat
scope bisa diturunkan
caller chain lebih eksplisit
lebih cocok untuk zero-trust internal service
```

Risiko:

```text
lebih kompleks
butuh authorization server capability
latency dan availability dependency
```

### 0.13.3. Service Identity + Original Actor Context

Service A memanggil Service B dengan service credential, lalu menyertakan original actor sebagai signed/validated context.

Kelebihan:

```text
jelas technical caller siapa
jelas business actor siapa
cocok untuk workflow/event systems
```

Risiko:

```text
context bisa dipalsukan jika tidak ditandatangani/divalidasi
butuh aturan kuat untuk propagation
```

### 0.13.4. Async Boundary

Saat request berubah menjadi message:

```text
HTTP request from user -> publish event -> worker processes later
```

Pertanyaan authentication berubah:

```text
Apakah worker bertindak sebagai user?
Apakah worker bertindak sebagai system?
Apakah user consent/authorization masih valid?
Apakah role user saat event diproses harus sama seperti saat event dibuat?
Apakah event membawa actor snapshot atau hanya actor id?
```

Tidak ada jawaban universal. Tetapi sistem harus eksplisit.

---

## 0.14. Authentication and Time

Authentication selalu terikat waktu.

Contoh properti waktu:

```text
password last changed at
session created at
last activity at
absolute session expires at
access token expires at
refresh token expires at
MFA completed at
certificate notBefore/notAfter
SAML assertion NotOnOrAfter
JWT nbf/exp/iat
auth_time in OIDC
```

Pertanyaan desain:

```text
Berapa lama bukti valid?
Apakah expiry absolute atau sliding?
Apakah refresh memperpanjang session tanpa batas?
Apakah privilege change membatalkan session lama?
Apakah MFA step-up punya expiry berbeda dari session?
Apakah clock skew ditoleransi?
```

Failure mode umum:

```text
1. Access token berlaku terlalu lama.
2. Refresh token tidak dirotasi.
3. Password reset tidak membatalkan session lama.
4. User disabled tetapi token masih valid sampai expiry.
5. Role dicabut tetapi claim role di JWT masih hidup.
6. Certificate expired tetapi trust store cache belum reload.
7. Clock antar node tidak sinkron, menyebabkan token valid/invalid secara acak.
```

Top 1% engineer memperlakukan waktu sebagai bagian dari security model, bukan detail konfigurasi.

---

## 0.15. Authentication and Environment Boundaries

Authentication harus environment-aware.

Contoh environment:

```text
local
dev
sit
uat
staging
production
dr
```

Invariant penting:

```text
credential production tidak boleh diterima di non-production
issuer production dan UAT harus berbeda atau jelas dibedakan
token audience harus environment-specific jika perlu
API key tidak boleh reused lintas environment
cookie domain tidak boleh terlalu luas
redirect URI harus environment-specific
JWKS endpoint harus sesuai issuer environment
```

Failure mode:

```text
UAT token diterima backend production
production API key dipakai untuk testing
local callback URI bocor ke registered production OAuth client
same signing key untuk semua environment
cookie domain .example.com membuat app lain bisa konflik
```

Decision rule:

```text
Jika environment berbeda tingkat kepercayaannya, authentication trust material juga harus dipisah.
```

---

## 0.16. Authentication and Tenant Boundaries

Dalam multi-tenant system, authentication tidak cukup hanya mengenal user.

Harus jelas:

```text
user belongs to tenant apa?
issuer tenant apa?
token audience untuk tenant apa?
role berlaku di tenant mana?
session sedang aktif untuk tenant apa?
apakah user bisa switch tenant?
apakah user id global atau tenant-local?
```

Contoh bug serius:

```text
User dari tenant A login valid.
Token valid.
Backend mengambil tenantId dari request body.
User mengubah tenantId menjadi tenant B.
```

Authentication valid, tetapi tenant binding gagal.

Pattern yang lebih aman:

```text
authenticated principal contains allowed tenant context
active tenant resolved from trusted source
request tenant must match authenticated tenant membership
authorization checks object tenant ownership
```

Multi-tenant authentication harus memisahkan:

```text
identity proof      -> user valid
membership proof    -> user anggota tenant tertentu
tenant selection    -> user sedang bertindak untuk tenant mana
authorization scope -> user boleh apa di tenant itu
```

---

## 0.17. Authentication and Audit Defensibility

Sistem enterprise/regulatory harus dapat membuktikan kejadian.

Audit authentication minimal mencatat:

```text
event_type
result
principal_id
actor_type
authentication_method
issuer
client_id
session_id/token_id hash
source_ip/user_agent/device jika relevan
tenant_id
correlation_id
failure_reason category
occurred_at
```

Namun audit tidak boleh sembarang log secret.

Jangan log:

```text
password
raw access token
raw refresh token
raw session id
raw API key
private key
full SAML assertion jika berisi sensitive data
full JWT jika mengandung PII/sensitive claims
```

Lebih aman:

```text
token hash prefix
key id
jti
session id hash
issuer
audience
subject
client id
failure category
```

Audit defensibility berarti sistem bisa menjawab:

```text
apakah aktor benar-benar authenticated?
metode authentication apa yang dipakai?
apakah MFA dilakukan?
apakah session/token masih valid saat aksi?
apakah ada privilege change sebelum aksi?
apakah aksi dilakukan langsung oleh user atau oleh job/service atas nama user?
```

---

## 0.18. Authentication Failure Modes: Peta Awal

Part berikutnya akan membahas detail. Di Part 0 kita buat peta.

### 0.18.1. Credential Compromise

```text
password leaked
API key committed to git
client secret exposed in frontend
private key copied from server
refresh token stolen from device
```

Pertanyaan response:

```text
bagaimana revoke?
bagaimana rotate?
bagaimana tahu credential mana terdampak?
bagaimana menurunkan blast radius?
```

### 0.18.2. Token Replay

```text
attacker captures token and reuses it
```

Mitigasi:

```text
short expiry
mTLS/DPoP proof-of-possession
nonce/timestamp for signed requests
jti replay cache for sensitive one-time assertions
```

### 0.18.3. Token Substitution

```text
token intended for service A dipakai ke service B
ID token dipakai sebagai access token
access token dari issuer lain diterima
```

Mitigasi:

```text
validate issuer
audience
token type
azp/client_id
scope
signature key bound to issuer
```

### 0.18.4. Session Fixation

```text
attacker forces victim to use known session id before login
```

Mitigasi:

```text
rotate session id after login
invalidate old anonymous session
use secure cookie attributes
```

### 0.18.5. Identity Header Injection

```text
client sends X-User-Id header and backend trusts it
```

Mitigasi:

```text
gateway strips incoming identity headers
backend inaccessible except through gateway
mTLS/gateway auth
signed internal identity assertion
```

### 0.18.6. Account Linking Error

```text
same email from different IdP linked to wrong internal account
```

Mitigasi:

```text
issuer + subject as stable external identity key
verified email semantics understood
explicit linking ceremony
admin review for high-risk linking
```

### 0.18.7. Logout Illusion

```text
user clicks logout, cookie deleted, but access token still valid for 1 hour
```

Mitigasi:

```text
short-lived access token
server-side session revocation
back-channel logout
refresh token revocation
introspection for high-risk APIs
```

### 0.18.8. Context Leakage

```text
ThreadLocal SecurityContext from request A reused in request B
```

Mitigasi:

```text
clear context finally
use framework-managed filters
avoid manual static context mutation
explicit context propagation wrappers
careful async/reactive design
```

---

## 0.19. Authentication Design Questions

Sebelum memilih mode authentication, jawab pertanyaan berikut.

### 0.19.1. Actor Questions

```text
Siapa aktornya?
Human, service, job, device, partner, admin, delegated actor?
Apakah ada original actor dan technical actor?
Apakah aktor bisa berpindah tenant/role/session?
```

### 0.19.2. Credential Questions

```text
Credential apa yang digunakan?
Apakah credential dikirim langsung atau dipakai untuk signature?
Di mana credential disimpan?
Bagaimana credential dirotasi?
Bagaimana credential dicabut?
Apa blast radius jika credential bocor?
```

### 0.19.3. Trust Questions

```text
Siapa issuer/verifier/trust anchor?
Apa yang membuat sistem percaya issuer?
Bagaimana trust anchor diperbarui?
Apa yang terjadi jika issuer down?
Apa yang terjadi jika signing key bocor?
```

### 0.19.4. Token/Session Questions

```text
Apakah sistem stateful atau stateless?
Berapa expiry access token?
Apakah refresh token dipakai?
Apakah refresh token rotation aktif?
Bagaimana logout bekerja?
Apakah session invalidated saat password/role berubah?
```

### 0.19.5. Boundary Questions

```text
Authentication dilakukan di app, gateway, container, IdP, atau service mesh?
Bisakah backend diakses bypass boundary?
Apakah identity headers trusted?
Apakah internal services memvalidasi ulang token?
```

### 0.19.6. Audit Questions

```text
Apa yang dilog saat login berhasil/gagal?
Apakah token/session id dilog sebagai hash?
Apakah MFA event dicatat?
Apakah service actor dan business actor dibedakan?
Apakah audit cukup untuk forensik incident?
```

---

## 0.20. Decision Heuristics: Kapan Pakai Mode Apa?

Ini bukan final decision matrix; Part 34 akan mendetail. Namun sebagai orientasi awal:

### 0.20.1. Browser Web App Internal/Enterprise

Biasanya:

```text
OIDC/SAML login + server-side session cookie
```

Kenapa:

```text
SSO enterprise
MFA di IdP
session mudah revoke
browser cocok dengan cookie
```

Hati-hati:

```text
CSRF
logout semantics
session timeout
claim mapping
role refresh
```

### 0.20.2. SPA Public App

Sering lebih aman:

```text
Backend-for-Frontend + OIDC Authorization Code with PKCE + secure HttpOnly cookie
```

Daripada:

```text
SPA menyimpan access token lama di localStorage
```

Hati-hati:

```text
XSS
CSRF
token leakage
refresh token in browser
```

### 0.20.3. Service-to-Service Internal

Biasanya:

```text
OAuth2 client credentials with audience-specific token
atau mTLS service identity
atau cloud workload identity
```

Hati-hati:

```text
shared client secret
broad scope
no rotation
trusting internal network blindly
```

### 0.20.4. Partner API

Biasanya:

```text
mTLS + OAuth2 client credentials
atau HMAC request signing
atau signed JWT client assertion
```

Hati-hati:

```text
onboarding/offboarding
key rotation ceremony
clock skew
replay prevention
non-repudiation expectation
```

### 0.20.5. High-Risk Admin Action

Biasanya:

```text
existing session + step-up MFA + fresh authentication time + audit event
```

Hati-hati:

```text
admin session hijack
privilege escalation
shared admin account
weak recovery path
```

### 0.20.6. Batch Job

Biasanya:

```text
platform workload identity or service account with least privilege
```

Hati-hati:

```text
using human credential
long-lived static secret
SYSTEM audit ambiguity
job endpoint exposed
```

---

## 0.21. Anti-Patterns yang Harus Langsung Dikenali

### Anti-Pattern 1 — Authentication by Request Parameter

```http
POST /approve?userId=admin
```

Masalah:

```text
identity berasal dari input untrusted
```

Seharusnya:

```text
actor identity berasal dari authenticated context
business payload tidak boleh menentukan caller identity
```

### Anti-Pattern 2 — JWT Without Audience Validation

Masalah:

```text
token untuk API A bisa diterima API B
```

Seharusnya:

```text
validate issuer + audience + signature + expiry + token type + relevant claims
```

### Anti-Pattern 3 — Storing JWT in localStorage by Default

Masalah:

```text
XSS dapat membaca token
```

Alternatif:

```text
BFF + HttpOnly Secure SameSite cookie
atau token handling yang sangat ketat sesuai threat model
```

### Anti-Pattern 4 — “Internal Network Is Trusted”

Masalah:

```text
lateral movement
pod compromise
misrouted traffic
SSRF
```

Seharusnya:

```text
service identity
mTLS/token validation
network policy
least privilege
```

### Anti-Pattern 5 — One Service Account for Everything

Masalah:

```text
no accountability
huge blast radius
hard to revoke safely
```

Seharusnya:

```text
service-specific identity
scope-specific permission
environment-specific credential
```

### Anti-Pattern 6 — Role Claims as Permanent Truth

Masalah:

```text
role in JWT can be stale
```

Seharusnya:

```text
short token lifetime
introspection or session lookup for high-risk actions
role versioning
re-auth or token refresh after privilege change
```

### Anti-Pattern 7 — Logout Only Deletes Frontend State

Masalah:

```text
token/session may remain valid
```

Seharusnya:

```text
server-side invalidation
refresh token revocation
IdP logout if needed
clear cookies
back-channel/front-channel logout according to architecture
```

### Anti-Pattern 8 — Authentication Logic Spread Everywhere

Masalah:

```text
controller parse JWT sendiri
service membaca header sendiri
repository menerima userId dari parameter
```

Seharusnya:

```text
central authentication mechanism
single principal mapping layer
domain ActorContext propagated explicitly
```

---

## 0.22. Production-Grade Authentication Invariants

Invariant adalah aturan yang harus selalu benar.

### 0.22.1. Identity Source Invariant

```text
Authenticated actor identity must come only from verified authentication context.
```

Bukan dari:

```text
request body
query parameter
untrusted header
frontend state
hidden form field
```

### 0.22.2. Boundary Invariant

```text
Every trust boundary crossing must either verify identity proof or receive identity through a protected channel with explicit trust contract.
```

### 0.22.3. Token Validation Invariant

```text
A token is accepted only if issuer, audience, signature, time validity, token type, and required claims are valid for this service and operation.
```

### 0.22.4. Session Rotation Invariant

```text
Session identifier must rotate after authentication and privilege elevation.
```

### 0.22.5. Secret Handling Invariant

```text
Raw credentials, tokens, session IDs, and private keys must never be logged or exposed to frontend unless explicitly part of a safe public protocol.
```

### 0.22.6. Least Privilege Invariant

```text
Machine identity must be scoped by service, environment, tenant if relevant, and operation class.
```

### 0.22.7. Audit Invariant

```text
Every authentication-significant event must be auditable without leaking secrets.
```

### 0.22.8. Context Cleanup Invariant

```text
Authentication context must not leak across requests, tasks, threads, virtual threads, reactive flows, or message processing units.
```

---

## 0.23. How to Think Like a Top 1% Engineer About Authentication

Engineer biasa bertanya:

```text
Pakai JWT atau session?
```

Engineer yang lebih matang bertanya:

```text
Siapa aktornya?
Apa proof-nya?
Siapa verifier-nya?
Apa trust anchor-nya?
Apa boundary-nya?
Apa lifetime-nya?
Apa blast radius jika bocor?
Apa mekanisme revocation-nya?
Apa audit evidence-nya?
Apa failure mode paling mungkin?
```

Engineer biasa bertanya:

```text
Bagaimana cara configure OAuth2 login?
```

Engineer yang lebih matang bertanya:

```text
Apakah ini authentication atau delegated authorization?
Apakah ID token dipakai di tempat yang benar?
Apakah access token audience sesuai resource server?
Apakah state/nonce/PKCE benar?
Apakah account linking aman?
Bagaimana logout bekerja?
Apa yang terjadi jika IdP down?
```

Engineer biasa bertanya:

```text
Bagaimana service A call service B?
```

Engineer yang lebih matang bertanya:

```text
Apakah B perlu tahu end-user atau cukup service A?
Apakah token relay aman?
Apakah perlu token exchange?
Apakah audience token B benar?
Apakah original actor harus masuk audit?
Apakah message async masih membawa actor context yang valid?
```

---

## 0.24. Minimal Vocabulary untuk Seluruh Series

| Istilah | Makna Praktis |
|---|---|
| Actor | Entitas yang melakukan aksi: user, service, job, device |
| Principal | Representasi identity di sistem/security framework |
| Credential | Secret/key/token dasar yang dipakai untuk membuktikan identity |
| Proof | Bukti yang diberikan pada authentication event/request |
| Assertion | Klaim identity yang diterbitkan pihak terpercaya |
| Token | Artefak pembawa/referensi identity/access/session |
| Session | Kontinuitas authenticated interaction |
| Issuer | Pihak yang menerbitkan token/assertion |
| Audience | Penerima yang dimaksud dari token/assertion |
| Subject | Entitas yang menjadi subjek token/assertion |
| Verifier | Komponen yang memvalidasi proof/assertion |
| Trust Anchor | Root of trust: CA, signing key, IdP, KDC, key registry |
| Security Context | Tempat identity disimpan selama eksekusi |
| Authentication Boundary | Titik sistem menetapkan identity |
| Authorization Boundary | Titik sistem memutuskan boleh/tidak |
| Token Relay | Meneruskan token dari caller ke downstream |
| Token Exchange | Menukar token menjadi token baru untuk downstream |
| Step-Up | Authentication tambahan untuk aksi lebih sensitif |
| Revocation | Membatalkan credential/token/session sebelum expiry normal |

---

## 0.25. Practical Architecture Sketches

### 0.25.1. Browser App with OIDC and Server Session

```text
[Browser]
   |
   | 1. access app
   v
[Java Web App]
   |
   | 2. redirect to OIDC provider
   v
[Identity Provider]
   |
   | 3. user authenticates + MFA
   v
[Java Web App]
   |
   | 4. validates code/id token, creates server-side session
   v
[Session Store]
   |
   | 5. browser receives HttpOnly Secure cookie
   v
[Browser]
```

Key questions:

```text
session timeout?
refresh strategy?
claim mapping?
logout semantics?
role refresh?
MFA evidence?
```

### 0.25.2. REST API with JWT Bearer Token

```text
[Client]
   |
   | Authorization: Bearer access_token
   v
[Java Resource Server]
   |
   | validate JWT signature via JWKS
   | validate iss/aud/exp/nbf/scope
   v
[SecurityContext]
   |
   | principal + authorities/scopes
   v
[Business Operation]
```

Key questions:

```text
issuer allowlist?
audience exact match?
JWKS cache TTL?
key rotation behavior?
revocation requirement?
clock skew?
```

### 0.25.3. Service-to-Service with mTLS

```text
[Service A]
   |
   | TLS handshake with client certificate
   v
[Service B]
   |
   | validates cert chain/SAN
   | maps certificate identity to service principal
   v
[Service Authorization]
```

Key questions:

```text
CA trust model?
certificate rotation?
SAN naming convention?
revocation?
gateway/service mesh termination?
```

### 0.25.4. Async Event with Actor Context

```text
[User Request]
   |
   | authenticated as officer U123
   v
[Case Service]
   |
   | publishes event with actor context
   v
[Message Broker]
   |
   v
[Worker]
   |
   | acts as service worker
   | preserves original actor for audit
   v
[Database/Audit]
```

Key questions:

```text
is actor context signed/trusted?
is original actor snapshot or lookup?
what if user disabled before worker runs?
what if authorization changed?
```

---

## 0.26. Java Implementation Design Principle: Separate Mechanism from Meaning

Authentication mechanism adalah cara bukti diverifikasi.

Contoh mechanism:

```text
password
OIDC
SAML
mTLS
API key
HMAC
Kerberos
```

Authentication meaning adalah identity dan context yang sistem hasilkan.

Contoh meaning:

```text
actorType = HUMAN_USER
principalId = U12345
tenantId = AGENCY_A
authenticationStrength = MFA
issuer = https://idp.example.com
sessionId = ...
originalActor = absent
```

Jangan biarkan business logic tergantung pada mechanism terlalu dalam.

Buruk:

```java
if (jwt.getClaim("groups").contains("APPROVER")) {
    approve();
}
```

Lebih baik:

```text
JWT/OIDC/SAML/password mechanism
   -> principal mapper
   -> domain ActorContext
   -> authorization policy
   -> business operation
```

Dengan begitu, jika nanti authentication berubah dari SAML ke OIDC, business logic tidak ikut hancur.

---

## 0.27. Java 8–25: Compatibility Mindset

Series ini membahas Java 8–25. Artinya, kita perlu membedakan:

```text
principle
API availability
framework baseline
runtime behavior
operational default
```

### 0.27.1. Principle Stable

Konsep ini stabil lintas Java 8–25:

```text
principal
credential
signature
certificate
session
token
issuer
audience
trust boundary
```

### 0.27.2. API and Runtime Evolves

Yang berubah:

```text
TLS defaults
keystore handling
cryptographic algorithms
framework versions
virtual thread behavior
container namespace javax -> jakarta
security manager deprecation/removal direction
```

### 0.27.3. javax vs jakarta

Java EE/Jakarta migration penting:

```text
javax.servlet -> jakarta.servlet
javax.security.enterprise -> jakarta.security.enterprise
```

Dampak authentication:

```text
library compatibility
container version
Spring Boot 2 vs Spring Boot 3
Jakarta EE 8/9/10/11 differences
```

### 0.27.4. Spring Boot 2 vs 3

Secara besar:

```text
Spring Boot 2.x commonly Java 8/11 era and javax ecosystem
Spring Boot 3.x requires newer Java baseline and Jakarta namespace
```

Konsekuensi:

```text
authentication config migration
filter chain style changes
adapter/library compatibility
OIDC/client/resource server behavior updates
```

Part berikutnya akan membahas detail ketika relevan.

---

## 0.28. Reference Source Orientation

Sumber resmi yang menjadi anchor series ini:

1. **Oracle Java SE Security / JAAS Reference Guide**  
   Untuk konsep `Subject`, `Principal`, `LoginContext`, `LoginModule`, dan JAAS pluggable authentication.

2. **Jakarta Security Specification**  
   Untuk `HttpAuthenticationMechanism`, `IdentityStore`, `SecurityContext`, built-in form/basic/custom/OIDC authentication mechanism.

3. **Jakarta Authentication Specification**  
   Untuk SPI authentication di container level.

4. **Spring Security Reference**  
   Untuk `SecurityContextHolder`, `Authentication`, `AuthenticationManager`, `AuthenticationProvider`, filter chain, OAuth2 login, resource server.

5. **OpenID Connect Core 1.0**  
   Untuk authentication di atas OAuth2, ID Token, claims, issuer, subject, audience, nonce, auth_time.

6. **OAuth 2.0 Security Best Current Practice / RFC 9700**  
   Untuk threat model dan rekomendasi keamanan OAuth2 modern.

7. **JDK 25 release/project documentation**  
   Untuk perubahan modern terkait crypto/key handling yang relevan dengan authentication engineering.

---

## 0.29. Checklist Setelah Part 0

Setelah memahami Part 0, Anda seharusnya bisa menjelaskan:

```text
1. Authentication bukan sekadar login, melainkan actor-proof-verifier-context-trust problem.
2. Identity, authentication, authorization, dan session adalah konsep berbeda.
3. Human, service, job, device, partner, dan delegated actor membutuhkan model berbeda.
4. Credential, proof, assertion, token, dan session bukan istilah yang sama.
5. Trust boundary menentukan apakah suatu identity boleh dipercaya.
6. Authentication dapat dimodelkan sebagai state machine.
7. Java authentication hidup di beberapa layer: Java SE, Servlet/Jakarta, Spring, framework cloud-native, dan platform.
8. Distributed systems membuat identity propagation menjadi masalah besar.
9. Time, environment, tenant, dan audit adalah bagian dari authentication design.
10. Pemilihan JWT/session/OIDC/mTLS/API key harus berbasis threat model dan operational constraint.
```

---

## 0.30. Summary

Part 0 membangun fondasi bahwa authentication adalah desain sistem, bukan hanya konfigurasi library.

Model inti:

```text
Actor presents Proof using Credential
Verifier checks Proof against Trust Anchor
System produces Authenticated Principal
Principal is bound to Security Context
Context is used for Authorization, Propagation, and Audit
Session/Token preserves continuity over time
```

Jika diringkas menjadi satu pertanyaan besar:

```text
Untuk setiap aksi penting di sistem, bisakah kita membuktikan siapa aktornya,
mengapa sistem percaya aktor itu, dalam konteks apa kepercayaan itu valid,
dan bagaimana bukti itu bertahan saat terjadi incident, audit, dan perubahan arsitektur?
```

Itulah cara berpikir authentication pada level architecture-grade.

---

## 0.31. What Comes Next

Part berikutnya:

```text
Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
```

Fokus Part 1:

```text
java.security.Principal
javax.security.auth.Subject
JAAS LoginContext
LoginModule
CallbackHandler
credential model
Subject propagation
Java runtime identity
thread/context problem
relevance in Java 8–25
```

---

## References

- Oracle Java SE 25, **Java Authentication and Authorization Service (JAAS) Reference Guide**: https://docs.oracle.com/en/java/javase/25/security/java-authentication-authorization-service-jaas-reference-guide.html
- Jakarta Security 4.0 Specification: https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta EE Tutorial, Security: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security.html
- Spring Security Reference, Servlet Authentication Architecture: https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- RFC 9700, OAuth 2.0 Security Best Current Practice: https://datatracker.ietf.org/doc/rfc9700/
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-001.md">Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context ➡️</a>
</div>
