# learn-java-authentication-modes-and-patterns-part-002

# Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models

> Series: **Java Authentication Modes and Patterns**  
> Scope: **Java 8 sampai Java 25**  
> Level: **Advanced / architecture-grade**  
> Fokus: membangun taxonomy agar semua authentication mode bisa dibandingkan secara sistematis, bukan dihafal sebagai daftar teknologi.

---

## 0. Posisi Part Ini Dalam Series

Pada Part 0 kita membangun orientasi: authentication adalah proses sistem untuk menjawab pertanyaan **“siapa atau apa yang sedang berinteraksi dengan sistem, dan seberapa kuat bukti yang mendukung klaim itu?”**

Pada Part 1 kita masuk ke fondasi runtime Java: `Subject`, `Principal`, credential, `LoginContext`, `LoginModule`, dan bagaimana identity dapat hidup di dalam runtime/framework.

Part 2 ini adalah **taxonomy**.

Artinya, kita tidak langsung belajar password, JWT, mTLS, SAML, OIDC, API key, session, atau passkey sebagai teknologi terpisah. Kita akan membuat kerangka berpikir untuk mengklasifikasikan semua mode authentication berdasarkan:

1. siapa aktornya,
2. klaim identity apa yang dibuat,
3. bukti apa yang diberikan,
4. siapa yang memverifikasi bukti,
5. bagaimana hasil authentication direpresentasikan,
6. apakah state disimpan,
7. bagaimana identity dipropagasikan,
8. bagaimana trust boundary dibentuk,
9. bagaimana failure dan attack terjadi,
10. kapan sebuah mode cocok atau berbahaya.

Tanpa taxonomy, engineer sering membuat keputusan seperti:

> “Pakai JWT saja biar stateless.”  
> “Pakai session saja lebih aman.”  
> “Internal API cukup pakai API key.”  
> “mTLS berarti sudah aman.”  
> “OAuth itu authentication.”  
> “OIDC berarti semua identity problem selesai.”

Semua kalimat itu bisa benar dalam konteks tertentu, tetapi juga bisa sangat salah jika trust model, threat model, dan lifecycle-nya tidak dipahami.

---

## 1. Problem Yang Diselesaikan Oleh Taxonomy

Authentication system di dunia nyata jarang hanya punya satu bentuk login.

Satu platform Java enterprise bisa memiliki:

- user login via username/password,
- admin login via SSO OIDC,
- partner API via mTLS + JWT,
- internal service call via client credentials,
- batch job via service account,
- scheduled worker via Kubernetes workload identity,
- message consumer via Kafka SASL,
- legacy endpoint via Basic Auth,
- browser session via cookie,
- mobile app via authorization code + PKCE,
- one-time link via signed token,
- password reset token,
- impersonation/admin support mode,
- audit actor propagation from frontend to async backend.

Jika semua ini diperlakukan sebagai “cara login”, sistem akan kacau.

Taxonomy membantu menjawab pertanyaan engineering berikut:

1. **Actor apa yang sedang diautentikasi?**
2. **Credential apa yang dipakai?**
3. **Credential tersebut membuktikan apa?**
4. **Apakah credential bisa dicuri dan dipakai ulang?**
5. **Apakah authentication menghasilkan session, token, atau security context?**
6. **Apakah authentication terjadi di edge, service, broker, container, atau IdP?**
7. **Apakah downstream service mempercayai hasil authentication upstream?**
8. **Bagaimana cara revoke?**
9. **Bagaimana cara rotate key/secret/certificate?**
10. **Apa failure mode paling berbahaya?**

Taxonomy bukan teori kosong. Ini adalah alat untuk desain, review, debugging, incident response, dan migration.

---

## 2. Core Mental Model

Authentication dapat dimodelkan sebagai pipeline:

```text
Actor
  -> presents claim
  -> proves claim using credential/proof
  -> verifier validates proof
  -> system binds result to authenticated identity
  -> identity is represented as principal/authentication object/session/token
  -> identity is propagated across execution boundary
  -> downstream components decide whether to trust it
```

Dalam bentuk lebih ringkas:

```text
Authentication = Claim + Proof + Verification + Binding + Propagation + Lifecycle
```

### 2.1 Claim

Claim adalah pernyataan identity.

Contoh:

```text
Saya adalah user 123.
Saya adalah service payment-api.
Saya adalah tenant ABC admin.
Saya adalah mobile device yang sudah diregistrasi.
Saya adalah partner system X.
Saya adalah scheduled reconciliation job.
```

Claim saja tidak cukup. Semua orang bisa mengklaim apa pun.

### 2.2 Proof

Proof adalah bukti yang mendukung claim.

Contoh:

```text
password yang cocok dengan password hash
private key yang bisa menandatangani challenge
certificate yang chain-nya trusted
bearer token yang valid
HMAC signature yang cocok
Kerberos ticket
SAML assertion signed by trusted IdP
OIDC ID token issued by trusted authorization server
```

### 2.3 Verification

Verification adalah proses memeriksa proof.

Contoh:

```text
compare password hash
verify JWT signature
check certificate chain
call token introspection endpoint
validate SAML XML signature
verify HMAC canonical request
bind mTLS certificate to client identity
validate session ID in Redis/database
```

### 2.4 Binding

Binding adalah proses mengikat hasil verification ke identity internal.

Contoh:

```text
subject = user:123
principal = alice@example.com
authentication = UsernamePasswordAuthenticationToken(...)
caller principal = CustomerAdminPrincipal(...)
session.userId = 123
request attribute authenticatedActor = partner:abc
```

Binding adalah titik kritis. Banyak bug authentication bukan terjadi pada verifikasi token, tetapi pada mapping identity setelah token dianggap valid.

Contoh bug:

```text
Token valid, tetapi aud salah.
Token valid, tetapi tenant salah.
Token valid, tetapi subject dimapping ke account lokal yang salah.
Certificate valid, tetapi CN dipakai sebagai identity padahal SAN yang seharusnya dipakai.
SAML assertion valid, tetapi NameID berubah format dan menyebabkan account duplication.
```

### 2.5 Propagation

Propagation adalah bagaimana identity dibawa ke bagian sistem lain.

Contoh:

```text
ThreadLocal security context
HTTP request attribute
Servlet session
JWT access token
opaque access token
message header
Kafka record header
MDC logging context
Reactor context
ScopedValue / explicit context passing
```

Propagation sering menjadi sumber bug di Java karena aplikasi modern memakai:

- thread pool,
- async executor,
- reactive stream,
- virtual thread,
- scheduled job,
- message listener,
- retry worker,
- distributed tracing.

### 2.6 Lifecycle

Credential dan authentication result selalu punya lifecycle.

Pertanyaan penting:

```text
Kapan dibuat?
Kapan valid?
Kapan expired?
Bagaimana revoke?
Bagaimana rotate?
Bagaimana refresh?
Bagaimana audit?
Bagaimana recover setelah leak?
```

Engineer top-tier tidak hanya bertanya “cara validasi token”, tetapi juga “apa yang terjadi ketika token bocor, key harus dirotasi, IdP down, cache stale, user disabled, tenant moved, atau clock skew terjadi?”

---

## 3. Authentication Actor Taxonomy

Langkah pertama dalam taxonomy adalah mengidentifikasi aktor.

Authentication mode yang cocok sangat bergantung pada aktor.

### 3.1 Human User

Contoh:

```text
citizen
customer
employee
administrator
case officer
support operator
external partner user
```

Karakteristik:

- punya browser/mobile/desktop client,
- bisa lupa password,
- bisa terkena phishing,
- bisa resign/berubah role,
- butuh MFA untuk risiko tinggi,
- butuh recovery flow,
- identity sering berasal dari IdP.

Mode umum:

- username/password,
- session cookie,
- OIDC login,
- SAML SSO,
- passkey/WebAuthn,
- MFA,
- Kerberos/SPNEGO untuk intranet enterprise.

### 3.2 Machine Client

Contoh:

```text
backend service
batch job
scheduler
integration adapter
ETL process
report generator
internal worker
external partner API client
```

Karakteristik:

- tidak bisa melakukan interactive login,
- butuh secret/key/certificate,
- lifecycle harus bisa dirotasi,
- butuh least privilege,
- sering berjalan di container/orchestrator,
- sering butuh audit actor yang membedakan system actor vs user actor.

Mode umum:

- client credentials,
- mTLS,
- private key JWT,
- HMAC request signing,
- API key,
- workload identity,
- Kerberos service principal,
- SASL untuk broker.

### 3.3 Device

Contoh:

```text
mobile phone
POS terminal
IoT device
registered browser/device
hardware token
smart card
```

Karakteristik:

- punya device identity,
- bisa hilang/dicuri,
- bisa jailbreak/root,
- butuh binding ke user atau organisasi,
- mungkin perlu attestation.

Mode umum:

- device code flow,
- certificate provisioning,
- platform authenticator,
- passkey,
- device-bound refresh token,
- signed challenge.

### 3.4 Delegated Actor

Contoh:

```text
admin acting on behalf of user
support agent impersonating customer
workflow engine executing user-submitted request
service processing event originally triggered by user
AI/automation agent acting under delegated scope
```

Karakteristik:

- ada actor asli dan actor yang bertindak,
- audit harus menyimpan dua identity,
- authorization tidak boleh hanya berdasarkan effective user,
- sangat rawan abuse.

Model identity:

```text
effectiveActor = user being acted upon
initiatingActor = admin/support/service that initiated action
delegationReason = ticket/case/approval
scope = allowed delegated actions
```

### 3.5 Anonymous or Pre-Authenticated Actor

Tidak semua request mulai dari authenticated user.

Contoh:

```text
public landing page
login page
password reset request
callback endpoint from IdP
health check
webhook endpoint before signature validation
```

Penting:

- anonymous bukan berarti tidak ada security concern,
- pre-auth endpoint sering menjadi attack surface utama,
- callback endpoint harus sangat ketat.

---

## 4. Credential Taxonomy

Credential adalah material yang digunakan untuk membuktikan claim.

Credential bukan selalu password. Dalam Java systems, credential bisa berupa object apa pun, termasuk private credential dalam JAAS `Subject`, token string, certificate, cookie, ticket, signed assertion, atau runtime identity.

### 4.1 Knowledge Credential

Credential yang membuktikan sesuatu karena aktor “tahu” secret.

Contoh:

```text
password
PIN
shared secret
client secret
API secret
HMAC secret
```

Kelebihan:

- mudah dipahami,
- mudah diimplementasikan,
- cocok untuk banyak legacy system.

Kelemahan:

- bisa dicuri,
- bisa di-phishing,
- bisa reuse,
- sering sulit dirotasi tanpa downtime,
- harus disimpan dengan aman.

Failure mode:

```text
credential stuffing
brute force
secret in source code
secret in logs
shared across environments
weak password reset flow
```

### 4.2 Possession Credential

Credential yang membuktikan aktor memiliki sesuatu.

Contoh:

```text
private key
client certificate
hardware security key
passkey private key
Kerberos ticket
refresh token
session cookie
```

Penting: possession credential masih bisa dicuri jika tidak dilindungi.

Bearer token juga bentuk possession: siapa pun yang “memegang” token bisa memakainya.

### 4.3 Cryptographic Proof Credential

Credential tidak selalu dikirim langsung. Kadang aktor membuktikan kepemilikan secret/private key dengan signature.

Contoh:

```text
HMAC signature over request
JWT signed with private key
DPoP proof JWT
mTLS TLS handshake
WebAuthn assertion
SAML signed assertion
```

Kelebihan:

- secret/private key tidak harus dikirim,
- bisa membatasi replay jika ada nonce/timestamp/challenge,
- lebih kuat untuk machine-to-machine.

Kelemahan:

- canonicalization sulit,
- key lifecycle kompleks,
- debugging signature mismatch bisa mahal,
- library misuse dapat fatal.

### 4.4 Assertion Credential

Assertion adalah pernyataan identity yang dibuat oleh pihak lain yang dipercaya.

Contoh:

```text
SAML assertion
OIDC ID token
JWT access token
Kerberos service ticket
x509 certificate issued by trusted CA
```

Di sini, verifier tidak selalu memverifikasi credential asli user. Verifier memverifikasi assertion dari issuer terpercaya.

Mental model:

```text
User proves identity to IdP.
IdP issues assertion.
Application verifies assertion.
Application trusts IdP's authentication result.
```

Risiko:

- wrong issuer,
- wrong audience,
- weak claim mapping,
- stale assertion,
- replay,
- compromised issuer key,
- confused deputy.

### 4.5 Derived Credential

Credential yang dibuat dari credential lain.

Contoh:

```text
session ID created after password login
access token created after OIDC login
refresh token created after authorization code flow
remember-me token created after browser login
one-time reset token created after email verification request
```

Derived credential sering lebih berbahaya daripada credential awal karena dipakai berulang di runtime.

Contoh:

```text
Password tidak bocor, tetapi session cookie bocor.
User MFA berhasil, tetapi refresh token dicuri.
OIDC login valid, tetapi local app session tidak pernah expired.
```

---

## 5. Proof Type Taxonomy

Credential dan proof sering dicampuradukkan.

Credential adalah materialnya. Proof adalah cara material itu digunakan untuk membuktikan identity.

### 5.1 Direct Secret Presentation

Aktor mengirim secret langsung ke verifier.

Contoh:

```text
username + password
client_id + client_secret
Basic Auth
API key in header
```

Model:

```text
Client -> secret -> Server
Server compares/validates secret
```

Risiko:

- secret terlihat oleh server,
- secret bisa masuk log,
- setiap request membawa secret,
- replay mudah jika transport bocor.

Harus selalu menggunakan TLS.

### 5.2 Bearer Proof

Aktor mengirim token, dan token itu sendiri cukup sebagai proof.

Contoh:

```text
Authorization: Bearer <access-token>
Cookie: SESSION=<session-id>
```

Model:

```text
Whoever has token can use token.
```

Kelebihan:

- sederhana,
- efisien,
- cocok untuk browser session dan API.

Kelemahan:

- token theft = impersonation,
- butuh expiry ketat,
- butuh secure transport,
- revocation bisa sulit untuk JWT stateless.

### 5.3 Proof-of-Possession

Aktor harus membuktikan bahwa ia memiliki private key/secret, bukan hanya membawa token.

Contoh:

```text
mTLS-bound token
DPoP
HMAC request signing
WebAuthn challenge-response
private_key_jwt client authentication
```

Model:

```text
Token/claim is only usable together with cryptographic proof.
```

Kelebihan:

- token theft saja tidak cukup,
- replay lebih sulit,
- cocok untuk high-risk API.

Kelemahan:

- lebih kompleks,
- butuh key management,
- client implementation lebih sulit,
- failure mode lebih banyak.

### 5.4 Third-Party Attestation

Verifier mempercayai pihak ketiga yang menyatakan authentication sudah terjadi.

Contoh:

```text
OIDC ID token
SAML assertion
Kerberos ticket
certificate issued by CA
```

Model:

```text
Verifier trusts issuer, not raw user credential.
```

Pertanyaan penting:

```text
Issuer siapa?
Audience untuk siapa?
Kapan assertion dibuat?
Bagaimana assertion ditandatangani?
Bagaimana key issuer diperoleh?
Bagaimana trust anchor dirotasi?
```

---

## 6. Authentication Result Taxonomy

Setelah authentication berhasil, sistem harus merepresentasikan hasilnya.

### 6.1 In-Memory Security Context

Contoh Java/Spring:

```text
SecurityContextHolder -> SecurityContext -> Authentication
```

Contoh JAAS:

```text
Subject -> Principal(s) + Credential(s)
```

Karakteristik:

- hanya hidup dalam proses/runtime,
- sering terikat ke thread/request,
- tidak otomatis aman di async boundary,
- perlu cleanup.

### 6.2 Server-Side Session

Contoh:

```text
SESSION_ID -> session store -> user identity
```

State disimpan di server.

Kelebihan:

- mudah revoke,
- data session bisa diubah,
- token kecil.

Kelemahan:

- butuh session store,
- scaling lebih kompleks,
- race condition logout/session renewal,
- Redis/database dependency.

### 6.3 Self-Contained Token

Contoh:

```text
JWT access token
signed remember-me token
signed reset token
```

State dibawa oleh token.

Kelebihan:

- tidak perlu lookup per request,
- bagus untuk distributed resource servers,
- mudah diverifikasi offline jika key tersedia.

Kelemahan:

- revocation sulit,
- stale claims,
- token bloat,
- key rotation complexity,
- audience/issuer validation wajib benar.

### 6.4 Reference Token

Contoh:

```text
opaque access token
session ID
random API token ID
```

Token hanya pointer ke state server-side.

Kelebihan:

- mudah revoke,
- server bisa mengontrol metadata,
- token tidak mengungkap claim.

Kelemahan:

- butuh introspection/lookup,
- latency,
- availability dependency,
- cache invalidation.

### 6.5 Certificate-Bound Identity

Contoh:

```text
client cert -> subject/SAN -> service identity
```

Hasil authentication berasal dari TLS handshake.

Kelebihan:

- kuat untuk service identity,
- tidak ada bearer secret di application header,
- cocok untuk mesh/gateway.

Kelemahan:

- certificate lifecycle rumit,
- mapping identity harus hati-hati,
- revocation tidak trivial,
- termination proxy dapat mengubah trust boundary.

---

## 7. State Taxonomy: Stateful, Stateless, and Hybrid

Salah satu kesalahan umum adalah menganggap “stateless” selalu lebih baik.

### 7.1 Stateful Authentication

Server menyimpan state authentication.

Contoh:

```text
HTTP session
Redis session
database session
opaque token introspection store
```

Cocok ketika:

- butuh revoke cepat,
- user state sering berubah,
- audit/session control penting,
- browser app tradisional,
- admin dashboard,
- regulatory system dengan session control ketat.

Trade-off:

- butuh distributed state,
- butuh HA session store,
- failover harus dirancang,
- bottleneck bisa muncul di session lookup.

### 7.2 Stateless Authentication

Server tidak menyimpan state authentication per token/session.

Contoh:

```text
JWT signed access token
signed one-time link tanpa persistence
HMAC signed request dengan timestamp/nonce window minimal
```

Cocok ketika:

- banyak resource server,
- high throughput,
- token short-lived,
- claims jarang berubah,
- revocation bukan requirement kuat.

Trade-off:

- logout/revoke sulit,
- claim bisa stale,
- compromised token tetap valid sampai expiry,
- key rotation harus rapi.

### 7.3 Hybrid Authentication

Gabungan stateful dan stateless.

Contoh:

```text
JWT access token short-lived + refresh token server-side
JWT with jti blacklist for high-risk events
session cookie + backend token exchange
opaque external token + cached introspection result
```

Hybrid sering paling realistis untuk enterprise.

Namun hybrid juga mudah menjadi kompleks jika tidak ada lifecycle model yang jelas.

---

## 8. Trust Model Taxonomy

Authentication selalu bergantung pada trust.

Pertanyaan dasarnya:

```text
Siapa yang dipercaya untuk menyatakan identity?
Atas dasar apa kita percaya?
Apa batas kepercayaan itu?
```

### 8.1 Direct Trust

Application langsung memverifikasi credential.

Contoh:

```text
app checks password hash
app validates API key
app validates HMAC signature
app validates session ID
```

Kelebihan:

- kontrol penuh,
- mudah dipahami,
- tidak tergantung IdP eksternal.

Kelemahan:

- app bertanggung jawab penuh atas credential lifecycle,
- risiko implementasi custom,
- sulit scale untuk enterprise SSO.

### 8.2 Federated Trust

Application mempercayai IdP/issuer.

Contoh:

```text
OIDC
SAML
Kerberos
enterprise SSO
```

Kelebihan:

- centralized identity,
- SSO,
- MFA di IdP,
- lifecycle user terpusat.

Kelemahan:

- claim mapping rumit,
- trust misconfiguration fatal,
- IdP outage berdampak besar,
- tenant/issuer confusion.

### 8.3 Delegated Trust

Application mempercayai komponen upstream untuk melakukan authentication.

Contoh:

```text
API gateway validates JWT then forwards headers
service mesh performs mTLS and injects identity
reverse proxy performs SSO
container performs pre-auth
```

Kelebihan:

- konsistensi di edge,
- app lebih sederhana,
- security centralized.

Kelemahan:

- app bisa salah percaya header,
- bypass path fatal,
- internal network dianggap terlalu trusted,
- perlu header sanitization.

Rule penting:

```text
Never trust identity headers unless they are injected by a trusted component across a protected boundary and stripped from external input.
```

### 8.4 Transitive Trust

Service A mempercayai identity dari Service B karena Service B dipercaya.

Contoh:

```text
frontend authenticates user
backend receives user token
backend calls another service with same or exchanged token
worker processes message with actor header
```

Risiko:

- confused deputy,
- actor spoofing,
- overbroad token audience,
- user identity lost in async flow,
- service acts with its own privilege instead of user privilege.

---

## 9. Boundary Taxonomy

Authentication harus dilihat dari boundary.

### 9.1 Network Boundary

Contoh:

```text
internet -> gateway
intranet -> service
pod -> pod
service mesh -> workload
```

Pertanyaan:

```text
Apakah request bisa masuk tanpa melalui gateway?
Apakah internal network dianggap trusted?
Apakah mTLS diterapkan end-to-end atau hanya sampai proxy?
```

### 9.2 Process Boundary

Contoh:

```text
Servlet container -> application code
Spring filter -> controller
message listener -> service method
batch scheduler -> job handler
```

Pertanyaan:

```text
Di mana identity pertama kali dibentuk?
Apakah code downstream menerima explicit actor atau membaca global context?
Apakah context dibersihkan setelah request?
```

### 9.3 Thread/Execution Boundary

Contoh:

```text
request thread -> executor
servlet async -> callback
reactive chain -> scheduler switch
virtual thread -> carrier thread
scheduled retry -> original actor
```

Pertanyaan:

```text
Apakah security context ikut berpindah?
Apakah seharusnya ikut berpindah?
Apakah context bisa bocor antar task?
```

### 9.4 Time Boundary

Authentication result tidak abadi.

Contoh:

```text
login happened 10 hours ago
MFA happened 2 days ago
access token issued 5 minutes ago
role changed after token issued
user disabled after session created
certificate revoked yesterday
```

Pertanyaan:

```text
Apakah authentication masih cukup fresh?
Apakah butuh step-up?
Apakah stale claim diterima?
```

### 9.5 Tenant Boundary

Dalam multi-tenant system, identity tanpa tenant sering tidak cukup.

Contoh:

```text
sub = 123
```

Tidak cukup jika user ID 123 bisa ada di banyak tenant.

Lebih aman:

```text
issuer = https://idp.example.com/tenant-a
subject = 123
tenant = tenant-a
audience = service-x
```

Failure mode:

```text
valid token from tenant A accepted for tenant B
shared email address maps to wrong local account
role from tenant A used in tenant B
```

---

## 10. Mode Taxonomy: Main Authentication Modes

Berikut peta mode besar yang akan kita pelajari lebih detail pada part berikutnya.

### 10.1 Password-Based Authentication

```text
actor: human
proof: knowledge secret
state: usually session/token after login
risk: phishing, stuffing, weak reset, password reuse
```

Cocok untuk:

- simple internal app,
- legacy systems,
- fallback account,
- local admin with strong controls.

Tidak ideal untuk:

- high-risk public app tanpa MFA,
- partner API,
- machine-to-machine.

### 10.2 Session Cookie Authentication

```text
actor: browser user
proof: bearer session cookie
state: server-side
risk: session theft, fixation, CSRF, logout race
```

Cocok untuk:

- server-rendered app,
- BFF pattern,
- enterprise web app,
- apps needing strong server-side session control.

### 10.3 API Key Authentication

```text
actor: app/developer/partner/system
proof: bearer secret
state: server-side key registry
risk: key leakage, no user identity, overbroad access
```

Cocok untuk:

- simple partner integration,
- low/medium risk service access,
- developer platform with rate limiting.

Tidak cukup untuk:

- high-risk financial/regulatory APIs tanpa signing/mTLS,
- user delegation,
- fine-grained identity.

### 10.4 HMAC Request Signing

```text
actor: machine/partner
proof: shared secret signature
state: key registry + replay cache/window
risk: canonicalization bugs, clock skew, secret leakage
```

Cocok untuk:

- partner API,
- webhook verification,
- request integrity,
- anti-replay requirements.

### 10.5 JWT Bearer Token

```text
actor: user/service depending on issuer
proof: bearer signed token
state: mostly stateless
risk: token theft, stale claim, wrong aud/iss, alg misuse
```

Cocok untuk:

- resource server,
- distributed APIs,
- short-lived access tokens,
- OIDC/OAuth integration.

### 10.6 Opaque Token

```text
actor: user/service
proof: bearer reference token
state: authorization server/introspection store
risk: introspection dependency, cache staleness
```

Cocok untuk:

- centralized control,
- revocation-heavy enterprise,
- high-risk APIs.

### 10.7 OIDC Authentication

```text
actor: human user
proof: ID token / auth result from IdP
state: local session or token lifecycle
risk: issuer/audience/nonce/state/claim mapping bugs
```

Cocok untuk:

- SSO,
- browser/mobile login,
- enterprise identity integration.

### 10.8 OAuth2 Client Credentials

```text
actor: machine client
proof: client authentication to authorization server
state: access token lifecycle
risk: secret leakage, overbroad scopes, wrong audience
```

Cocok untuk:

- service-to-service,
- scheduled jobs,
- backend integration.

### 10.9 SAML

```text
actor: enterprise human user
proof: signed XML assertion
state: local session after assertion
risk: XML signature wrapping, clock skew, metadata/key rollover
```

Cocok untuk:

- legacy enterprise SSO,
- government/corporate IdP integration.

### 10.10 mTLS

```text
actor: machine/service/partner/client device
proof: private key possession during TLS handshake
state: certificate lifecycle/trust store
risk: cert mapping error, CA trust sprawl, proxy termination
```

Cocok untuk:

- service-to-service,
- partner high-trust API,
- zero-trust internal network,
- workload identity.

### 10.11 Kerberos/SPNEGO

```text
actor: enterprise user/service
proof: ticket from KDC
state: ticket lifecycle
risk: KDC dependency, SPN mismatch, delegation risk
```

Cocok untuk:

- Windows/AD intranet,
- enterprise SSO,
- legacy Java enterprise.

### 10.12 WebAuthn/Passkey

```text
actor: human user/device
proof: public-key challenge response
state: registered credential public key
risk: recovery flow, device loss, relying party mismatch
```

Cocok untuk:

- phishing-resistant login,
- passwordless,
- high-security MFA.

---

## 11. Authentication Strength Taxonomy

Tidak semua successful authentication memiliki strength yang sama.

Authentication strength bergantung pada:

1. jenis credential,
2. cara proof diberikan,
3. freshness,
4. verifier trust,
5. transport security,
6. replay resistance,
7. binding ke client/session/device,
8. recovery flow,
9. operational controls.

### 11.1 Weak Authentication

Contoh:

```text
password only without MFA
long-lived API key
Basic Auth reused across services
JWT long-lived without revocation
session cookie without secure flags
```

Ciri:

- bearer/secret mudah dipakai ulang,
- compromise sulit dideteksi,
- recovery/revocation lemah.

### 11.2 Moderate Authentication

Contoh:

```text
password + MFA
short-lived access token
server-side session with rotation
API key with scopes and rate limits
HMAC with timestamp
```

Ciri:

- cukup untuk banyak enterprise apps,
- butuh monitoring dan lifecycle management.

### 11.3 Strong Authentication

Contoh:

```text
mTLS with strict certificate lifecycle
WebAuthn/passkey with user verification
private_key_jwt client auth
short-lived token bound to client certificate
step-up MFA for sensitive actions
```

Ciri:

- proof-of-possession,
- replay-resistant,
- phishing-resistant,
- scoped and auditable.

Namun strong authentication tetap bisa gagal jika:

```text
identity mapping salah
authorization salah
session setelah login lemah
recovery flow lemah
trusted proxy bisa dibypass
logs membocorkan token
```

---

## 12. Freshness Taxonomy

Authentication bukan hanya valid atau invalid. Ada konsep freshness.

Contoh:

```text
User login 8 jam lalu.
MFA dilakukan 3 hari lalu.
Password diubah 1 menit lalu.
Admin action butuh recent authentication.
```

### 12.1 Initial Authentication

Authentication pertama untuk membentuk session.

Contoh:

```text
login with password + MFA
OIDC redirect callback
SAML assertion consumption
```

### 12.2 Continuous Authentication

Sistem terus mengevaluasi risiko selama session berlangsung.

Contoh sinyal:

```text
IP berubah
device berubah
impossible travel
role changed
session idle too long
refresh token reuse detected
```

### 12.3 Step-Up Authentication

Action tertentu butuh authentication lebih fresh/strong.

Contoh:

```text
change password
approve high-value transaction
export sensitive report
create admin user
disable audit setting
impersonate user
```

Rule:

```text
Do not treat old login as sufficient proof for high-risk action.
```

---

## 13. Replay Resistance Taxonomy

Replay adalah ketika attacker memakai ulang proof yang pernah valid.

### 13.1 Replay-Prone

Contoh:

```text
API key
Basic Auth
bearer token
session cookie
long-lived JWT
```

Jika dicuri, bisa langsung dipakai.

### 13.2 Replay-Limited

Contoh:

```text
HMAC with timestamp window
short-lived token
one-time token
nonce-based callback
```

Masih bisa replay dalam window jika tidak ada nonce cache.

### 13.3 Replay-Resistant

Contoh:

```text
challenge-response
WebAuthn
mTLS-bound token
DPoP with nonce/jti controls
Kerberos with ticket protections
```

Tetap butuh implementasi benar.

---

## 14. Identity Binding Taxonomy

Authentication result harus dibinding ke identity internal.

### 14.1 Stable Identifier Binding

Gunakan identifier yang stabil dan tidak mudah berubah.

Baik:

```text
issuer + subject
tenant + external immutable user id
certificate fingerprint/public key id
service account id
```

Berbahaya:

```text
email as only key
full name
certificate CN
display username
phone number
```

Email bisa berubah, didaur ulang, atau sama di tenant berbeda.

### 14.2 Tenant Binding

Untuk multi-tenant:

```text
identity = issuer + subject + tenant
```

Jangan hanya:

```text
identity = email
```

### 14.3 Session Binding

Session harus dibinding ke properti tertentu jika diperlukan:

```text
user id
tenant id
authentication time
MFA state
device id
risk level
roles snapshot version
```

### 14.4 Token Binding

Token harus dibinding ke:

```text
issuer
audience
subject
client id
scope
time
key id
confirmation claim if proof-of-possession
```

---

## 15. Lifecycle Taxonomy

Setiap authentication material punya lifecycle.

### 15.1 Issuance

Siapa membuat credential/token/session?

Contoh:

```text
application creates session
IdP issues ID token
authorization server issues access token
admin creates API key
CA issues certificate
KDC issues ticket
```

### 15.2 Distribution

Bagaimana credential sampai ke client?

Contoh:

```text
browser receives secure cookie
service receives secret via vault/SSM/Kubernetes secret
partner receives API key through secure onboarding
certificate provisioned via PKI
```

### 15.3 Storage

Di mana credential disimpan?

Contoh:

```text
browser cookie
mobile secure storage
server database hash
Kubernetes secret
JVM keystore
HSM/KMS
Redis session store
```

### 15.4 Use

Bagaimana credential dipakai?

Contoh:

```text
sent every request
used only to get token
used to sign challenge
used during TLS handshake
used to refresh access token
```

### 15.5 Rotation

Credential harus bisa diganti.

Pertanyaan:

```text
Apakah ada dual-key period?
Apakah old key masih diterima?
Berapa lama?
Bagaimana client tahu key baru?
Apakah rollout bisa bertahap?
```

### 15.6 Revocation

Credential harus bisa dicabut.

Pertanyaan:

```text
Apakah revoke langsung efektif?
Apakah cache membuat revoke delay?
Apakah JWT masih valid sampai expiry?
Apakah session store punya global logout?
Apakah certificate revocation dicek?
```

### 15.7 Expiry

Expiry bukan pengganti revocation, tetapi pembatas blast radius.

Rule praktis:

```text
Semakin sulit revoke, semakin pendek lifetime seharusnya.
Semakin tinggi risiko, semakin kuat proof dan semakin pendek session/token lifetime.
```

---

## 16. Java-Specific Taxonomy Mapping

Sekarang kita mapping taxonomy ke dunia Java.

### 16.1 Java SE / JAAS Layer

Konsep utama:

```text
Subject
Principal
Credential
LoginContext
LoginModule
CallbackHandler
```

JAAS cocok untuk memahami:

- pluggable authentication,
- subject composition,
- multiple principals,
- public/private credentials,
- login modules,
- Kerberos integration.

Namun di aplikasi web modern, JAAS sering bukan layer utama. Banyak sistem memakai Spring Security, Jakarta Security, atau external IdP.

### 16.2 Servlet/Jakarta Layer

Konsep utama:

```text
HttpServletRequest.getUserPrincipal()
HttpAuthenticationMechanism
IdentityStore
container-managed security
caller principal
groups/roles
```

Cocok untuk:

- Jakarta EE portable apps,
- container-level authentication,
- enterprise app server,
- standard security integration.

### 16.3 Spring Security Layer

Konsep utama:

```text
SecurityContextHolder
SecurityContext
Authentication
AuthenticationManager
AuthenticationProvider
AuthenticationFilter
AuthenticationEntryPoint
```

Cocok untuk:

- Spring Boot apps,
- resource server,
- form login,
- OAuth2/OIDC login,
- method security,
- custom provider,
- stateless/stateful hybrid.

### 16.4 JVM Execution Layer

Konsep utama:

```text
ThreadLocal
Executor
CompletableFuture
Reactor Context
Virtual Thread
ScopedValue
MDC
```

Authentication context harus diperlakukan sebagai execution-scoped data, bukan global data.

Failure mode:

```text
security context leaked between pooled threads
async job loses user identity
reactive chain reads empty security context
MDC has user id but security context does not
```

---

## 17. Decision Matrix Awal

Berikut matrix awal untuk memilih authentication mode.

| Use Case | Primary Actor | Recommended Modes | Avoid As Primary | Reason |
|---|---:|---|---|---|
| Browser enterprise app | Human | OIDC/SAML + server-side session | Long-lived JWT in browser | Session control, logout, CSRF controls |
| SPA with Java backend | Human | BFF + OIDC + HttpOnly session | Token in localStorage | Reduce browser token exposure |
| Mobile app | Human/device | Auth code + PKCE + refresh rotation | Password grant | Native client cannot keep secret |
| Partner API low/medium risk | Machine | API key + scope + rate limit | Shared global secret | Manage lifecycle and blast radius |
| Partner API high risk | Machine | mTLS + HMAC/JWT/PoP | Bearer API key only | Stronger proof and replay resistance |
| Internal microservice | Workload | mTLS/service identity + token exchange | Trust by network only | Internal network is not identity |
| Batch job | Machine | Service account/client credentials | Human credential reuse | Clear audit and lifecycle |
| Admin high-risk action | Human | Existing session + step-up MFA | Old session only | Freshness requirement |
| Webhook receiver | External system | HMAC signature + timestamp | IP allowlist only | IP is weak identity |
| Legacy intranet | Human | Kerberos/SPNEGO or SAML | Basic Auth everywhere | Enterprise SSO and centralized lifecycle |

---

## 18. Common Misclassifications

### 18.1 “JWT Is Authentication”

JWT adalah token format. Ia bisa membawa authentication result, authorization claims, atau arbitrary claims.

Yang penting:

```text
Siapa issuer?
Untuk audience siapa?
Bagaimana token diperoleh?
Apa proof bahwa presenter berhak memakai token?
Apakah bearer atau PoP?
```

### 18.2 “OAuth Is Login”

OAuth2 terutama adalah delegated authorization framework. Login biasanya dibangun dengan OIDC di atas OAuth2.

Kesalahan umum:

```text
Menggunakan access token sebagai bukti login tanpa memahami issuer/audience/userinfo.
Menganggap OAuth access token selalu berisi identity user.
Menggunakan implicit flow untuk use case modern.
```

### 18.3 “mTLS Means Fully Authenticated User”

mTLS biasanya membuktikan client/service/device, bukan end-user.

Jika service menerima request dari user melalui gateway:

```text
mTLS proves gateway/service identity.
It does not automatically prove the original human user.
```

### 18.4 “Internal Network Is Trusted”

Internal network bukan authentication.

Di Kubernetes/microservices:

```text
pod-to-pod reachability != service identity
namespace boundary != user identity
cluster network != authorization proof
```

### 18.5 “Session Is Less Modern Than JWT”

Session bukan teknologi kuno. Untuk browser app dan BFF, server-side session sering lebih aman dan operasionalnya lebih mudah dibanding menyimpan token di browser.

### 18.6 “API Key Is Enough Because It Is Server-to-Server”

API key adalah bearer secret. Jika bocor, attacker menjadi client tersebut.

Untuk high-risk API, API key sebaiknya minimal dikombinasikan dengan:

```text
scope
tenant binding
rate limit
rotation
last-used monitoring
IP/network control where appropriate
HMAC or mTLS for stronger proof
```

---

## 19. Failure Modes By Taxonomy

### 19.1 Actor Failure

```text
wrong actor type assumed
batch job uses human admin account
service token treated as user token
support impersonation loses original actor
```

### 19.2 Credential Failure

```text
secret logged
password hash weak
API key shared across tenants
certificate private key copied across services
refresh token stored insecurely
```

### 19.3 Proof Failure

```text
JWT signature not verified
HMAC canonicalization mismatch accepted incorrectly
SAML signature wrapping
nonce not checked
state parameter ignored
```

### 19.4 Binding Failure

```text
email mapped to wrong user
issuer ignored
tenant ignored
audience ignored
certificate CN trusted incorrectly
```

### 19.5 Propagation Failure

```text
ThreadLocal context leak
async task loses actor
message consumer trusts spoofed header
gateway forwards untrusted identity header
```

### 19.6 Lifecycle Failure

```text
no key rotation
no token revocation
stale role in JWT
session remains valid after user disabled
certificate revoked but still accepted
```

---

## 20. Taxonomy Checklist For Architecture Review

Gunakan checklist ini saat mereview design authentication.

### 20.1 Actor

```text
[ ] Siapa aktor primer?
[ ] Human, service, device, partner, batch, admin, atau delegated actor?
[ ] Apakah original actor dan effective actor perlu dibedakan?
[ ] Apakah tenant/org/agency menjadi bagian identity?
```

### 20.2 Claim

```text
[ ] Identity claim apa yang dibuat?
[ ] Apakah claim stabil?
[ ] Apakah claim bisa berubah seperti email/username?
[ ] Apakah issuer ikut dipertimbangkan?
```

### 20.3 Credential

```text
[ ] Credential/proof apa yang digunakan?
[ ] Apakah bearer atau proof-of-possession?
[ ] Apakah credential bisa dicuri dan dipakai ulang?
[ ] Di mana credential disimpan?
```

### 20.4 Verification

```text
[ ] Siapa verifier?
[ ] Apakah verification lokal atau remote?
[ ] Apakah signature/issuer/audience/expiry dicek?
[ ] Apakah clock skew ditangani?
```

### 20.5 Binding

```text
[ ] Bagaimana external identity dimapping ke internal principal?
[ ] Apakah tenant binding aman?
[ ] Apakah account linking aman?
[ ] Apakah role/group snapshot atau live lookup?
```

### 20.6 State

```text
[ ] Stateful, stateless, atau hybrid?
[ ] Bagaimana revoke?
[ ] Bagaimana logout?
[ ] Bagaimana session/token expired?
```

### 20.7 Propagation

```text
[ ] Bagaimana identity dipropagasikan ke downstream service?
[ ] Bagaimana ke async job/message?
[ ] Apakah identity header bisa dipalsukan?
[ ] Apakah context cleanup aman?
```

### 20.8 Failure

```text
[ ] Apa yang terjadi jika IdP down?
[ ] Apa yang terjadi jika key rotation gagal?
[ ] Apa yang terjadi jika Redis/session store down?
[ ] Apa yang terjadi jika token bocor?
[ ] Apa yang terjadi jika user disabled setelah token issued?
```

---

## 21. Practical Java Design Heuristics

### 21.1 Jangan Jadikan Framework Sebagai Taxonomy

Framework seperti Spring Security/Jakarta Security membantu implementasi, tetapi taxonomy harus framework-agnostic.

Jangan mulai dari:

```text
Kita pakai filter apa?
Kita pakai annotation apa?
Kita pakai library JWT apa?
```

Mulai dari:

```text
Actor siapa?
Proof apa?
Verifier siapa?
Trust boundary di mana?
State disimpan di mana?
Failure mode apa?
```

### 21.2 Jangan Campur User Identity dan Service Identity

Contoh buruk:

```text
service A calls service B using admin user's token forever
```

Lebih baik:

```text
service identity: payment-service
end-user context: user:123 as delegated actor
scope/audience: limited to downstream service
```

### 21.3 Authentication Result Harus Explicit di Domain Boundary

Untuk domain service penting, jangan terlalu bergantung pada global context.

Buruk:

```java
public void approveCase(String caseId) {
    User user = SecurityContext.getCurrentUser();
    ...
}
```

Lebih baik secara domain clarity:

```java
public void approveCase(Actor actor, CaseId caseId, ApprovalCommand command) {
    ...
}
```

Security context boleh dipakai di adapter layer, tetapi domain layer sebaiknya menerima actor secara eksplisit jika action-nya audit-critical.

### 21.4 Treat Authentication As Input Validation For Identity

Authentication adalah validasi input paling penting: input-nya adalah identity claim.

Jika identity claim salah, semua authorization dan audit setelahnya ikut salah.

### 21.5 Model Authentication State Transition

Contoh state:

```text
ANONYMOUS
IDENTIFIED_BUT_UNVERIFIED
PRIMARY_AUTHENTICATED
MFA_REQUIRED
MFA_AUTHENTICATED
STEP_UP_REQUIRED
SESSION_EXPIRED
REVOKED
LOCKED
```

Authentication bukan boolean. Banyak sistem gagal karena hanya punya:

```text
isAuthenticated = true/false
```

Padahal realitasnya lebih kaya.

---

## 22. Mini Case Study: Regulatory Case Management System

Bayangkan Java enterprise system untuk enforcement/case management.

Actor:

```text
agency officer
supervisor
external applicant
system scheduler
email notification worker
integration partner
admin support user
```

Authentication modes:

```text
officer -> enterprise SSO OIDC/SAML + session
external applicant -> OIDC/social/national identity provider + session
scheduler -> service account/client credentials
partner -> mTLS + signed request
worker -> internal workload identity
admin support -> SSO + MFA + impersonation approval
```

Jika taxonomy tidak jelas, sistem bisa membuat kesalahan seperti:

```text
Worker melakukan action dengan user terakhir di ThreadLocal.
Partner API memakai API key global tanpa tenant binding.
Support impersonation hanya terlihat sebagai target user di audit log.
JWT dari external applicant diterima oleh internal officer endpoint karena audience tidak dicek.
Session officer tetap aktif setelah role dicabut di IdP.
```

Taxonomy yang benar memaksa desain:

```text
ActorType = HUMAN_OFFICER | EXTERNAL_USER | SERVICE | PARTNER | SUPPORT_DELEGATE
AuthenticationStrength = PASSWORD | SSO | MFA | MTLS | SIGNED_REQUEST
OriginalActor != EffectiveActor
Tenant/Agency binding wajib
Sensitive action butuh fresh auth
Async command carries signed/internal actor envelope
Audit event stores authentication method and assurance level
```

---

## 23. Relation To Java 8–25

### Java 8 Reality

Banyak enterprise system Java 8 masih menggunakan:

- Servlet session,
- JAAS/Kerberos,
- container auth,
- Spring Security 4/5,
- SAML libraries,
- Basic Auth for internal APIs,
- manual JWT validation.

Risiko terbesar:

- legacy defaults,
- old crypto choices,
- weak context propagation,
- custom authentication code,
- old XML/SAML pitfalls.

### Java 11/17 Reality

Modernization mulai umum:

- Spring Boot 2/3 migration,
- OAuth2 resource server,
- OIDC login,
- containerized services,
- microservices,
- Kubernetes secrets,
- distributed tracing.

Risiko terbesar:

- token sprawl,
- misconfigured issuer/audience,
- internal trust assumptions,
- session/token hybrid tanpa lifecycle jelas.

### Java 21/25 Reality

Modern Java membawa:

- virtual threads,
- stronger platform security APIs,
- modern TLS/crypto updates,
- better runtime behavior,
- cloud-native deployment patterns.

Risiko baru:

- context propagation assumptions berubah,
- ThreadLocal-based security model harus direview,
- more async/concurrent execution,
- workload identity semakin penting.

---

## 24. Reference Anchors

Materi series ini akan banyak merujuk pada spesifikasi dan dokumentasi resmi berikut sebagai anchor konseptual:

1. **Java SE JAAS Reference Guide** — untuk `Subject`, `Principal`, credential, `LoginContext`, `LoginModule`, dan pluggable authentication.
2. **Spring Security Authentication Architecture** — untuk `SecurityContextHolder`, `SecurityContext`, dan `Authentication` di aplikasi Spring.
3. **Jakarta Security / Jakarta Authentication** — untuk authentication mechanism dan identity store di enterprise container.
4. **OpenID Connect Core 1.0** — untuk OIDC sebagai authentication layer di atas OAuth2.
5. **OAuth 2.0 Security Best Current Practice / RFC 9700** — untuk security posture modern OAuth2.
6. **RFC 9449 DPoP** dan **RFC 8705 OAuth mTLS** nanti akan relevan untuk proof-of-possession.
7. **SAML 2.0 specifications** untuk enterprise federation.
8. **WebAuthn/FIDO2 specifications** untuk passwordless dan phishing-resistant authentication.

---

## 25. Summary

Authentication taxonomy membantu kita berpikir secara lebih kuat daripada sekadar memilih framework atau token format.

Core model:

```text
Authentication = Claim + Proof + Verification + Binding + Propagation + Lifecycle
```

Taxonomy utama:

```text
Actor taxonomy       -> human, machine, device, delegated, anonymous
Credential taxonomy  -> knowledge, possession, cryptographic proof, assertion, derived
Proof taxonomy       -> direct secret, bearer, proof-of-possession, third-party attestation
Result taxonomy      -> security context, session, self-contained token, reference token, certificate identity
State taxonomy       -> stateful, stateless, hybrid
Trust taxonomy       -> direct, federated, delegated, transitive
Boundary taxonomy    -> network, process, execution, time, tenant
Lifecycle taxonomy   -> issuance, distribution, storage, use, rotation, revocation, expiry
```

Top-tier authentication design bukan bertanya:

```text
Pakai JWT atau session?
```

Melainkan:

```text
Actor siapa?
Claim apa?
Proof apa?
Verifier siapa?
Trust boundary di mana?
State di mana?
Bagaimana revoke?
Bagaimana rotate?
Bagaimana identity dipropagasikan?
Bagaimana audit membuktikan siapa melakukan apa?
Apa yang terjadi saat token/secret/session/key/IdP gagal?
```

Setelah taxonomy ini jelas, kita bisa masuk ke part berikutnya dengan fondasi yang lebih kuat.

---

## 26. Latihan Pemahaman

Jawab pertanyaan berikut untuk menguji apakah taxonomy sudah masuk ke mental model.

### 26.1 Basic Classification

Untuk masing-masing mode berikut, tentukan actor, credential, proof type, state model, dan trust model:

1. browser session cookie,
2. JWT access token,
3. API key,
4. mTLS,
5. OIDC login,
6. SAML assertion,
7. HMAC signed webhook,
8. Kerberos ticket,
9. WebAuthn passkey,
10. batch job service account.

### 26.2 Failure Thinking

Untuk JWT access token:

```text
Apa yang terjadi jika token bocor?
Apa yang terjadi jika user disabled setelah token issued?
Apa yang terjadi jika signing key dirotasi?
Apa yang terjadi jika audience tidak dicek?
Apa yang terjadi jika issuer dari tenant lain diterima?
```

### 26.3 Architecture Thinking

Untuk aplikasi regulatory case management:

```text
Mode apa untuk officer login?
Mode apa untuk external applicant?
Mode apa untuk partner API?
Mode apa untuk scheduled job?
Mode apa untuk async message processing?
Bagaimana audit menyimpan original actor dan effective actor?
```

---

## 27. Checklist Ringkas Untuk Dibawa Ke Part Berikutnya

Sebelum memilih authentication mode, selalu isi ini:

```text
Actor:
Claim:
Credential:
Proof type:
Verifier:
Trust anchor:
Authentication result:
State model:
Propagation model:
Revocation model:
Rotation model:
Freshness requirement:
Replay resistance:
Tenant binding:
Audit identity:
Primary failure mode:
```

Jika salah satu kosong, desain authentication belum matang.

---

# Status Series

- Part 0: selesai.
- Part 1: selesai.
- Part 2: selesai.
- Series belum selesai.
- Part berikutnya: **Part 3 — Password Authentication Done Properly**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-001.md">⬅️ Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
