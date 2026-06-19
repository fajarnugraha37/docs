# learn-java-authentication-modes-and-patterns-part-016

# Part 16 — Client Credentials and Machine-to-Machine Authentication

> Seri: **Java Authentication Modes and Patterns**  
> Scope Java: **Java 8 sampai Java 25**  
> Fokus: **machine-to-machine authentication, workload identity, OAuth2 client credentials, private_key_jwt, mTLS, token exchange, service identity, secret lifecycle, dan production failure modeling**

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita membahas:

- JWT sebagai signed assertion.
- Opaque token dan introspection.
- OAuth2 sebagai delegated authorization.
- OpenID Connect sebagai authentication layer di atas OAuth2.
- Authorization Code + PKCE untuk user-facing browser/web/SPAs/BFF.

Part ini bergeser ke skenario berbeda:

> **Tidak ada human user yang sedang login.**  
> Yang berinteraksi adalah service, batch job, scheduler, worker, connector, integration adapter, daemon, CLI automation, atau platform workload.

Inilah domain **machine-to-machine authentication**.

Contoh:

- service A memanggil service B;
- batch job mengambil data dari partner API;
- scheduler memanggil endpoint internal;
- Kafka/RabbitMQ consumer memanggil downstream service;
- connector Java mengirim file ke external regulatory gateway;
- microservice mengambil token dari authorization server;
- platform job memakai workload identity untuk akses cloud API;
- backend-for-frontend memanggil downstream API atas nama dirinya sendiri;
- report generator malam hari mengakses data warehouse;
- migration tool memanggil internal admin API.

Part ini sangat penting karena banyak sistem enterprise terlihat aman di user login, tetapi rapuh di authentication antar service.

---

## 1. Problem yang Diselesaikan

Masalah inti machine-to-machine authentication bukan sekadar:

> “Bagaimana service mendapatkan token?”

Masalah sebenarnya:

> “Bagaimana sistem membuktikan bahwa caller adalah workload yang benar, sedang berjalan di lingkungan yang benar, membawa hak akses yang benar, dengan credential yang bisa dirotasi, diaudit, dibatasi, dan dicabut tanpa merusak sistem?”

Pertanyaan desainnya:

1. Siapa identitas caller?
2. Apakah caller mewakili user, service, tenant, system process, atau scheduled job?
3. Credential apa yang membuktikan caller?
4. Siapa yang menerbitkan credential?
5. Bagaimana downstream memvalidasi credential?
6. Apakah credential bearer atau proof-of-possession?
7. Apakah token bisa dicuri dan dipakai di tempat lain?
8. Apakah access token punya audience spesifik?
9. Apakah satu token dipakai ke banyak service?
10. Apakah secret bisa dirotasi tanpa downtime?
11. Bagaimana audit membedakan system actor vs human actor?
12. Apa yang terjadi jika authorization server down?
13. Apa yang terjadi jika secret bocor?
14. Apa yang terjadi jika service A menjadi compromised?
15. Bagaimana mencegah confused deputy antar service?

Machine-to-machine authentication adalah gabungan dari:

- identity architecture;
- key management;
- distributed systems;
- zero trust;
- operational security;
- credential lifecycle;
- Java runtime integration;
- token validation;
- service dependency modeling.

---

## 2. Mental Model Utama

### 2.1 Human Authentication vs Machine Authentication

Human authentication biasanya menjawab:

> “Apakah orang ini benar Fajar?”

Machine authentication menjawab:

> “Apakah workload ini benar `case-sync-worker-prod`, versi/instance/environment yang sah, dengan hak akses untuk memanggil endpoint tertentu?”

Perbedaan penting:

| Dimensi | Human Authentication | Machine Authentication |
|---|---|---|
| Actor | User/person | Service, job, worker, device, daemon |
| Credential | Password, session, MFA, passkey | Secret, private key, certificate, workload token |
| Interaction | Browser/mobile/CLI | HTTP client, queue consumer, scheduler, backend |
| Lifecycle | Login/logout | Boot/rotate/redeploy/revoke |
| Risk | Account takeover | Lateral movement, secret leakage, blast radius |
| Identity | User ID | Client ID / service ID / workload ID |
| Audit | “User did X” | “Service did X”, optionally “on behalf of user Y” |

### 2.2 Machine Auth is Not Automatically User Delegation

Kesalahan umum:

> Service A menerima request dari user, lalu service A memakai client credentials token untuk memanggil service B, tetapi service B mengira request itu berasal dari user.

Itu salah secara model.

Client credentials token membuktikan:

> “Ini service A.”

Bukan:

> “Ini user Fajar.”

Jika downstream perlu tahu end-user, desainnya harus eksplisit:

- token exchange;
- delegated token;
- on-behalf-of token;
- explicit actor chain;
- audit context terpisah;
- user assertion yang tervalidasi;
- service token plus user context dengan aturan validasi ketat.

### 2.3 The Four Identities in a Service Call

Dalam panggilan antar service, sering ada lebih dari satu identity.

```text
[User]
  |
  | browser session / user token
  v
[Service A]
  |
  | service credential / access token
  v
[Service B]
```

Ada minimal empat konsep:

1. **End-user identity**  
   Orang yang memulai tindakan.

2. **Calling service identity**  
   Service yang melakukan call ke downstream.

3. **Workload runtime identity**  
   Instance/container/pod/VM/function yang menjalankan service.

4. **Credential identity**  
   Client ID, certificate subject, key ID, token subject, SPIFFE ID, service account name.

Engineer top 1% tidak mencampur empat hal ini.

---

## 3. Core Concepts

### 3.1 Client

Dalam OAuth2, **client** adalah aplikasi yang meminta token.

Untuk machine-to-machine:

```text
client = service/job/daemon yang meminta access token
```

Contoh:

```text
client_id = aceas-case-sync-worker-prod
client_id = billing-report-generator-uat
client_id = partner-gateway-file-uploader
client_id = notification-service
```

Client ID harus bermakna secara operasional.

Buruk:

```text
client_id = backend
client_id = app
client_id = service
client_id = integration
```

Lebih baik:

```text
client_id = case-service-prod
client_id = email-dispatch-worker-prod
client_id = onemap-address-resolver-uat
client_id = audit-export-job-prod
```

### 3.2 Confidential Client

OAuth2 client credentials grant ditujukan untuk **confidential client**, yaitu client yang mampu menjaga credential-nya.

Contoh confidential client:

- backend service di server;
- Java Spring Boot service di Kubernetes;
- batch job di controlled runtime;
- server-side integration adapter;
- internal daemon;
- service mesh workload;
- cloud function dengan managed identity.

Bukan confidential client:

- browser SPA murni;
- mobile app dengan embedded secret;
- desktop app dengan hardcoded client secret;
- distributed CLI tanpa secure credential storage.

Rule:

> Jika binary atau JavaScript bisa diambil user, secret di dalamnya bukan secret.

### 3.3 Client Credentials Grant

Client credentials grant adalah flow OAuth2 di mana client mengautentikasi dirinya ke authorization server dan menerima access token.

Bentuk konseptual:

```text
Service A ---- client authentication ----> Authorization Server
Service A <--------- access token -------- Authorization Server
Service A ---- access token -------------> Service B
```

Flow ini cocok ketika:

- tidak ada human user;
- client mengakses resource miliknya sendiri;
- client bertindak sebagai system actor;
- client punya permission langsung;
- service-to-service authorization cukup berbasis service identity/scope/audience.

Flow ini tidak cocok ketika:

- downstream harus tahu consent user;
- operasi harus dilakukan atas nama user tertentu;
- privilege harus mengikuti role user;
- per-user audit wajib;
- user logout harus langsung menghentikan akses downstream.

### 3.4 Client Authentication Method

Client credentials grant bukan hanya satu mekanisme. Ia membutuhkan cara client membuktikan identitasnya.

Beberapa metode umum:

1. `client_secret_basic`
2. `client_secret_post`
3. `client_secret_jwt`
4. `private_key_jwt`
5. mTLS client authentication
6. workload identity federation
7. platform-managed identity
8. signed request / HMAC custom

Perbedaan terbesar:

| Method | Secret Type | Proof Model | Risiko Utama |
|---|---|---|---|
| client secret | shared secret | bearer-ish | bocor = bisa dipakai langsung |
| private_key_jwt | private key | signed assertion | key management |
| mTLS | private key + cert | channel-bound proof | cert lifecycle |
| workload identity | platform attestation | runtime-bound | platform trust config |
| HMAC custom | shared secret | request signature | canonicalization error |

### 3.5 Access Token Audience

Access token untuk service-to-service harus memiliki audience yang jelas.

Buruk:

```json
{
  "aud": "internal-api"
}
```

Lebih baik:

```json
{
  "aud": "case-service-api"
}
```

Atau bahkan:

```json
{
  "aud": "https://api.internal.example.com/case-service"
}
```

Mengapa?

Karena token yang diterbitkan untuk service B tidak boleh bisa dipakai ke service C.

Audience adalah pagar blast radius.

### 3.6 Scope vs Role vs Permission

Untuk machine identity:

- **scope** biasanya hak akses token pada API tertentu;
- **role** biasanya assignment identity di domain atau tenant;
- **permission** biasanya capability konkret yang dicek resource server.

Contoh:

```text
client_id: audit-export-job-prod
scope: audit:export audit:read
role: system-audit-exporter
permission: EXPORT_AUDIT_TRAIL
```

Jangan membuat scope terlalu luas:

```text
scope: admin
scope: internal
scope: all
scope: service
```

Lebih baik:

```text
scope: case:read
scope: case:update-status
scope: correspondence:send
scope: audit:append
scope: report:generate
```

---

## 4. Machine-to-Machine Authentication Modes

### 4.1 Mode 1 — Static Client Secret

#### Model

Client menyimpan `client_id` dan `client_secret`, lalu menukarnya dengan token.

```text
POST /oauth2/token
Authorization: Basic base64(client_id:client_secret)
grant_type=client_credentials
scope=case:read
```

#### Cocok untuk

- internal service dengan risiko rendah/menengah;
- environment terkendali;
- fase awal integrasi;
- sistem yang belum mendukung private key atau mTLS;
- service kecil dengan rotation automation.

#### Kelebihan

- sederhana;
- support luas;
- mudah dipahami;
- mudah diintegrasikan dengan Spring Security OAuth2 Client;
- cocok sebagai baseline.

#### Kekurangan

- shared secret adalah bearer credential;
- jika bocor, attacker bisa meminta token;
- secret sering tersalin ke config, CI/CD log, developer machine;
- rotation sering manual;
- sulit membuktikan runtime asal;
- tidak mengikat token ke channel atau key possession.

#### Production rule

Client secret boleh digunakan hanya jika:

1. secret tidak hardcoded;
2. secret disimpan di secret manager;
3. ada rotation policy;
4. ada environment separation;
5. access token short-lived;
6. scope/audience sempit;
7. token endpoint dilindungi rate limit;
8. audit token issuance aktif;
9. secret leak response jelas;
10. tidak dipakai oleh public client.

### 4.2 Mode 2 — `private_key_jwt`

#### Model

Client tidak mengirim shared secret. Client membuat JWT assertion yang ditandatangani private key-nya sendiri.

```text
Client signs assertion with private key
Client sends assertion to token endpoint
Authorization Server verifies signature with registered public key/JWKS
```

Konseptual request:

```text
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=case-service-prod
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=<signed-jwt>
```

JWT assertion biasanya berisi:

```json
{
  "iss": "case-service-prod",
  "sub": "case-service-prod",
  "aud": "https://auth.example.com/oauth2/token",
  "jti": "unique-id-for-replay-defense",
  "iat": 1760000000,
  "exp": 1760000300
}
```

#### Cocok untuk

- high-security service-to-service;
- integrasi antar organisasi;
- FAPI-style security profile;
- sistem yang tidak ingin shared secret;
- environment dengan key management matang;
- authorization server yang mendukung registered JWKS.

#### Kelebihan

- private key tidak dikirim ke network;
- public key bisa diregistrasikan ke authorization server;
- key rotation bisa memakai JWKS dan `kid`;
- assertion short-lived;
- replay bisa dibatasi dengan `jti` dan expiry;
- lebih kuat daripada shared client secret.

#### Kekurangan

- key management lebih kompleks;
- clock skew bisa membuat assertion gagal;
- `aud` salah menyebabkan token endpoint reject;
- `jti` replay cache perlu dipikirkan;
- private key harus dijaga dengan serius;
- library misuse bisa menghasilkan JWT yang lemah.

#### Design invariant

> `private_key_jwt` membuktikan bahwa caller memiliki private key yang cocok dengan public key yang sudah dipercaya authorization server.

### 4.3 Mode 3 — mTLS Client Authentication

#### Model

Client membuktikan identitasnya melalui TLS client certificate.

```text
Client opens TLS connection with client certificate
Authorization Server validates certificate
Client receives token
Resource Server may also validate certificate-bound token
```

#### Dua bentuk umum

1. **mTLS untuk client authentication ke token endpoint**  
   Authorization server memverifikasi certificate client.

2. **Certificate-bound access token**  
   Token yang diterbitkan diikat ke certificate tertentu, sehingga token yang dicuri tidak berguna tanpa private key certificate tersebut.

#### Cocok untuk

- high-assurance machine authentication;
- partner API;
- regulated industry;
- financial-grade API;
- internal platform dengan PKI matang;
- service mesh;
- zero-trust network.

#### Kelebihan

- proof-of-possession lebih kuat daripada bearer-only token;
- token theft impact lebih kecil jika token certificate-bound;
- identitas bisa diikat ke certificate subject/SAN/thumbprint;
- cocok untuk transport-level security;
- bisa dipakai lintas language.

#### Kekurangan

- PKI complexity;
- certificate issuance/renewal/revocation;
- Java keystore/truststore operational friction;
- gateway/load balancer termination harus didesain benar;
- observability handshake lebih sulit;
- certificate rotation bisa menyebabkan outage jika tidak gradual.

#### Design invariant

> mTLS bukan sekadar HTTPS. mTLS berarti **server juga memverifikasi client certificate**.

### 4.4 Mode 4 — Workload Identity Federation

#### Model

Service tidak menyimpan long-lived secret. Runtime platform memberikan identity token/attestation yang ditukar ke access token.

Contoh platform:

- Kubernetes service account token;
- AWS IAM role for service account;
- Google Workload Identity Federation;
- Azure Managed Identity;
- SPIFFE/SPIRE SVID;
- cloud metadata identity;
- service mesh workload certificate.

Konsep:

```text
Workload runtime proves: "I am this pod/service account/function/VM"
Authorization system maps runtime identity to application identity
Client receives scoped token
```

#### Cocok untuk

- cloud-native Java service;
- Kubernetes/EKS/GKE/AKS;
- environment yang ingin menghindari static secret;
- high automation;
- ephemeral workloads;
- short-lived credentials.

#### Kelebihan

- tidak perlu menyimpan static secret di aplikasi;
- identity bound ke runtime;
- rotation otomatis;
- lebih cocok untuk ephemeral infrastructure;
- mengurangi secret sprawl;
- audit bisa sampai ke workload/platform identity.

#### Kekurangan

- platform trust configuration kompleks;
- salah mapping service account bisa fatal;
- metadata service abuse;
- token audience/issuer harus divalidasi;
- local development lebih sulit;
- coupling ke cloud/provider/platform.

#### Design invariant

> Workload identity memindahkan root of trust dari application secret ke platform identity system.

### 4.5 Mode 5 — Service Mesh Identity

#### Model

Service mesh memberi identitas ke workload melalui sidecar/proxy dan certificate. Antar service menggunakan mTLS otomatis.

```text
Service A app -> local sidecar -> mTLS -> sidecar -> Service B app
```

Identity bisa berbentuk:

```text
spiffe://trust-domain/ns/prod/sa/case-service
```

#### Cocok untuk

- microservices besar;
- zero trust internal network;
- centralized mTLS;
- platform team kuat;
- policy-driven service communication.

#### Kelebihan

- aplikasi Java tidak selalu perlu mengelola certificate langsung;
- mTLS bisa transparan;
- policy bisa dipusatkan;
- traffic identity bisa konsisten;
- certificate rotation bisa otomatis.

#### Kekurangan

- app-level identity dan mesh identity bisa tidak sinkron;
- authorization di service tetap perlu desain;
- observability jadi dua layer;
- false sense of security: “sudah mTLS berarti semua aman”;
- sidecar/control plane outage risk.

#### Design invariant

> Service mesh bisa membuktikan workload-level identity, tetapi tidak otomatis menyelesaikan domain-level authorization.

---

## 5. OAuth2 Client Credentials Deep Dive

### 5.1 Flow Minimal

```text
+----------------+        +-----------------------+        +----------------+
| Java Service A |        | Authorization Server  |        | Java Service B |
+----------------+        +-----------------------+        +----------------+
        |                            |                             |
        | 1. token request            |                             |
        | grant_type=client_credentials                            |
        | client authentication       |                             |
        |---------------------------> |                             |
        |                            |                             |
        | 2. access token             |                             |
        |<--------------------------- |                             |
        |                            |                             |
        | 3. API request + token       |                             |
        |--------------------------------------------------------->|
        |                            |                             |
        |                            | 4. validate token             |
        |                            |<---------------------------->|
        |                            |                             |
        | 5. response                  |                             |
        |<---------------------------------------------------------|
```

### 5.2 What the Access Token Should Mean

Access token untuk client credentials idealnya berarti:

```text
The authorization server confirms that client X authenticated successfully,
was issued token T at time t,
for audience A,
with scopes S,
under policy P,
valid until expiry E.
```

Bukan:

```text
Anyone with token T can do anything internally.
```

### 5.3 Recommended Token Shape

Untuk JWT access token:

```json
{
  "iss": "https://auth.example.com",
  "sub": "case-sync-worker-prod",
  "client_id": "case-sync-worker-prod",
  "aud": "case-service-api",
  "scope": "case:read case:update-status",
  "iat": 1760000000,
  "exp": 1760000300,
  "jti": "b7b7c3e4-2e3d-47e6-b34e-...",
  "env": "prod",
  "tenant": "agency-a"
}
```

Catatan:

- `iss` harus divalidasi.
- `aud` harus service-specific.
- `exp` harus pendek.
- `scope` harus sempit.
- `client_id` harus di-audit.
- `tenant` hanya dipakai jika benar-benar diterbitkan dan dipercaya oleh authorization server.
- Jangan menerima claim custom dari caller tanpa validasi issuer.

### 5.4 Access Token TTL

Untuk machine-to-machine:

| TTL | Cocok | Risiko |
|---|---|---|
| 1–5 menit | high security, internal service | token refresh sering |
| 5–15 menit | umum untuk service-to-service | balance baik |
| 30–60 menit | low-risk batch/integration | blast radius lebih besar |
| > 1 jam | jarang disarankan | revocation lambat |

Rule:

> Semakin mudah token dicuri dan semakin luas scope-nya, semakin pendek TTL harusnya.

### 5.5 Refresh Token untuk Client Credentials?

Umumnya client credentials tidak butuh refresh token.

Alasannya:

- client bisa mengautentikasi ulang ke token endpoint;
- refresh token menjadi credential tambahan yang harus dijaga;
- machine client tidak punya UX friction seperti human user;
- short-lived access token + client credential rotation biasanya cukup.

Jika authorization server memberikan refresh token untuk machine client, desainnya harus ditinjau sangat hati-hati.

---

## 6. Java 8–25 Relevance

### 6.1 Java 8 Reality

Banyak enterprise masih punya Java 8 services.

Karakteristik:

- banyak aplikasi memakai Apache HttpClient/OkHttp/RestTemplate;
- TLS stack cukup matang tetapi konfigurasi modern kadang manual;
- keystore sering JKS/PKCS12;
- tidak ada native HTTP client modern seperti Java 11 `HttpClient`;
- library OAuth/JWT perlu dipilih dengan hati-hati;
- secret sering berada di properties/env var;
- concurrency banyak memakai thread pool manual.

Implikasi:

- token caching perlu thread-safe;
- refresh harus single-flight;
- mTLS butuh konfigurasi `SSLContext` manual;
- private key JWT butuh library JOSE yang benar;
- clock skew handling harus eksplisit.

### 6.2 Java 11+

Java 11 memperkenalkan `java.net.http.HttpClient` sebagai client modern.

Relevansi:

- lebih mudah membuat token client tanpa library eksternal HTTP;
- TLS configuration tetap harus dilakukan melalui `SSLContext`;
- async API tersedia;
- cocok untuk internal OAuth client ringan.

### 6.3 Java 17/21 LTS

Java 17/21 banyak dipakai di Spring Boot modern.

Relevansi:

- Spring Security modern sangat kuat untuk OAuth2 client/resource server;
- records bisa membantu token response model;
- sealed interfaces bisa membantu modeling auth modes;
- virtual threads Java 21 bisa memengaruhi token client concurrency;
- structured code lebih mudah.

### 6.4 Java 25

Java 25 relevan untuk:

- virtual threads yang semakin matang;
- structured concurrency;
- scoped values;
- PEM encodings untuk cryptographic objects;
- KDF API;
- modern cryptographic/key material handling.

Implikasi desain:

- context propagation identity harus lebih disiplin;
- key material handling bisa lebih standar;
- blocking token endpoint call bisa lebih murah jika memakai virtual threads, tetapi rate limit dan single-flight tetap wajib.

---

## 7. Implementation Pattern di Java

### 7.1 Baseline Interface

Daripada menyebar logic token request di banyak class, buat abstraction:

```java
public interface ServiceTokenProvider {
    AccessToken getToken(TokenRequestContext context);
}
```

Model:

```java
public record TokenRequestContext(
        String audience,
        Set<String> scopes,
        String tenant,
        String purpose
) {}

public record AccessToken(
        String value,
        Instant issuedAt,
        Instant expiresAt,
        String tokenType,
        Set<String> scopes,
        String audience
) {
    public boolean expiresWithin(Duration skew) {
        return Instant.now().plus(skew).isAfter(expiresAt);
    }
}
```

Untuk Java 8, gunakan class biasa.

### 7.2 Token Cache Pattern

Jangan meminta token baru untuk setiap request.

Buruk:

```text
Every outbound API call -> request token -> call downstream
```

Masalah:

- latency tinggi;
- token endpoint bottleneck;
- rate limit;
- login storm versi machine;
- outage authorization server menyebar ke semua service.

Lebih baik:

```text
Cache token per audience + scope + tenant + client identity
Refresh before expiry
Single-flight refresh
Fail closed when token unavailable
```

Cache key:

```text
(client_id, audience, scopes, tenant, auth_method)
```

### 7.3 Single-Flight Token Refresh

Masalah umum:

```text
1000 request masuk
semua melihat token expired
semua request token baru bersamaan
Authorization server terkena spike
```

Pattern:

```text
Only one thread refreshes token
Other threads wait or reuse still-valid token
```

Pseudo:

```java
public final class CachedServiceTokenProvider implements ServiceTokenProvider {
    private final Object lock = new Object();
    private volatile AccessToken cached;
    private final Duration refreshSkew = Duration.ofSeconds(60);

    @Override
    public AccessToken getToken(TokenRequestContext context) {
        AccessToken token = cached;
        if (token != null && !token.expiresWithin(refreshSkew)) {
            return token;
        }

        synchronized (lock) {
            token = cached;
            if (token != null && !token.expiresWithin(refreshSkew)) {
                return token;
            }
            cached = requestNewToken(context);
            return cached;
        }
    }

    private AccessToken requestNewToken(TokenRequestContext context) {
        throw new UnsupportedOperationException("Call token endpoint here");
    }
}
```

Production improvement:

- cache per key;
- timeout;
- retry with jitter;
- circuit breaker;
- metrics;
- stale-while-revalidate only if policy allows;
- do not log token;
- do not expose token in exception.

### 7.4 Token Client Should Be Infrastructure Component

Buruk:

```java
orderService.callPaymentApi() {
    String token = fetchToken();
    http.post(...)
}
```

Lebih baik:

```text
Domain service -> Downstream client -> Authentication interceptor -> Token provider
```

Layering:

```text
Application Service
  -> Domain-specific API Client
      -> HTTP Client
          -> Auth Interceptor
              -> ServiceTokenProvider
```

Tujuannya:

- domain code tidak tahu token details;
- rotation tidak menyentuh business logic;
- test lebih mudah;
- token leakage lebih kecil;
- observability terpusat.

### 7.5 Spring Security OAuth2 Client Pattern

Spring Security mendukung OAuth2 Client role dan grant seperti client credentials, JWT bearer, dan token exchange.

Konseptual Spring:

```text
ClientRegistration
OAuth2AuthorizedClient
OAuth2AuthorizedClientManager
OAuth2AccessTokenResponseClient
```

Pattern umum:

```text
WebClient/RestClient interceptor
  -> authorized client manager
  -> client_credentials
  -> token endpoint
  -> attach Bearer token
```

Untuk sistem production, perhatikan:

- token cache location;
- principal name untuk machine client;
- registration per downstream service;
- audience/scope per service;
- timeout token endpoint;
- retry policy;
- error mapping;
- observability.

### 7.6 Resource Server Validation Pattern

Downstream service B harus validasi:

1. signature atau introspection active state;
2. issuer;
3. audience;
4. expiry;
5. not-before;
6. authorized party/client ID;
7. scope/permission;
8. tenant/environment if applicable;
9. token type;
10. certificate binding if PoP/mTLS.

Jangan hanya:

```text
JWT parse success => accepted
```

Atau:

```text
Token introspection active=true => accepted for all endpoints
```

Endpoint-level authorization tetap perlu.

---

## 8. Secret and Key Lifecycle

### 8.1 Static Secret Lifecycle

Lifecycle minimal:

```text
create -> distribute -> store -> use -> rotate -> revoke -> audit -> destroy
```

Checklist:

1. Secret generated by trusted system.
2. Entropy cukup.
3. Tidak dikirim lewat chat/email/plain ticket.
4. Disimpan di secret manager.
5. Inject ke runtime secara aman.
6. Tidak muncul di logs.
7. Tidak muncul di heap dump/JFR/thread dump jika bisa dihindari.
8. Tidak dicetak di exception.
9. Rotation punya overlap period.
10. Old secret dicabut setelah rollout selesai.

### 8.2 Key Pair Lifecycle

Untuk `private_key_jwt`:

```text
generate key pair
register public key/JWKS
store private key securely
sign assertions
rotate key with kid
retire old key
revoke compromised key
```

Key rotation dengan JWKS:

```text
T0: publish new public key with kid=new
T1: deploy clients signing with kid=new
T2: AS accepts old and new
T3: confirm all clients moved
T4: remove old public key
```

Jangan:

```text
remove old key before all clients stop using it
```

### 8.3 Certificate Lifecycle

Untuk mTLS:

```text
CSR/generate key -> issue cert -> deploy cert+key -> trust chain configured -> monitor expiry -> rotate -> revoke
```

Masalah umum:

- certificate expired silently;
- truststore tidak update;
- hostname/SAN mismatch;
- cert chain incomplete;
- load balancer tidak forward client cert;
- app percaya header `X-Client-Cert` dari network tidak trusted;
- old cert dicabut terlalu cepat.

### 8.4 Zero-Downtime Rotation Pattern

Prinsip:

```text
accept old + new before producing new only
```

Untuk secret:

```text
1. AS accepts secret_v1 and secret_v2
2. deploy clients with secret_v2
3. observe all token requests use v2
4. revoke secret_v1
```

Untuk keys:

```text
1. publish old + new public keys
2. deploy signer with new private key
3. observe kid=new
4. remove old public key
```

Untuk cert:

```text
1. trust old + new CA/cert where needed
2. deploy new cert
3. observe handshakes
4. revoke/remove old cert
```

---

## 9. Audience, Scope, Tenant, and Environment Binding

### 9.1 Audience Binding

Audience menjawab:

> Token ini ditujukan untuk siapa?

Service B harus reject token yang tidak berisi audience B.

Contoh validasi:

```text
expected aud = case-service-api
actual aud = report-service-api
=> reject
```

Tanpa audience validation, token untuk satu service bisa dipakai ke service lain.

### 9.2 Scope Binding

Scope menjawab:

> Token ini boleh melakukan operasi apa?

Contoh:

```text
GET /cases/{id} requires case:read
POST /cases/{id}/decision requires case:decide
POST /letters/send requires correspondence:send
```

Jangan mengandalkan client ID saja.

Client ID menjawab siapa caller. Scope menjawab permission token.

### 9.3 Tenant Binding

Dalam multi-tenant system:

```text
client_id = report-worker-prod
scope = report:generate
tenant = agency-a
```

Resource server harus memastikan:

- token tenant cocok dengan data tenant;
- caller memang allowed untuk tenant tersebut;
- token tidak bisa dipakai cross-tenant;
- tenant claim diterbitkan oleh issuer terpercaya;
- tenant tidak diambil dari request parameter tanpa validasi.

### 9.4 Environment Binding

Token PROD tidak boleh diterima UAT/DEV, dan sebaliknya.

Buruk:

```text
same issuer, same client, same secret across dev/uat/prod
```

Lebih baik:

```text
issuer: https://auth.dev.example.com
issuer: https://auth.uat.example.com
issuer: https://auth.example.com
```

Atau claim environment divalidasi ketat.

Rule:

> Jangan reuse credential lintas environment.

---

## 10. On-Behalf-Of, Token Relay, and Token Exchange

### 10.1 Token Relay

Token relay berarti service A meneruskan token yang diterima dari caller ke service B.

```text
User token -> Service A -> same user token -> Service B
```

Cocok jika:

- token audience mencakup service B;
- service B memang harus melihat user identity;
- Service A tidak mengubah privilege;
- trust boundary jelas;
- token lifetime dan scope sesuai.

Risiko:

- token terlalu luas;
- downstream tidak bisa membedakan direct call vs relayed call;
- service A bisa menyalahgunakan user token;
- token audience mismatch diabaikan;
- confused deputy.

### 10.2 Client Credentials Only

Service A memakai token dirinya sendiri.

```text
User -> Service A
Service A token -> Service B
```

Service B melihat:

```text
caller = Service A
```

Bukan user.

Jika butuh audit:

```text
actor = Service A
initiator = user-123
```

Tetapi `initiator` harus berasal dari context yang tervalidasi dan tidak boleh dipakai sebagai authorization utama tanpa desain.

### 10.3 Token Exchange

Token exchange memungkinkan client menukar satu token/subject token menjadi token lain dengan audience/scope berbeda.

Use case:

```text
Service A receives user token for A
Service A requests token for B, representing delegated context
Authorization Server issues token for B
Service B receives token with correct audience and actor/delegation semantics
```

Konseptual:

```text
subject_token = user token
actor_token = service A token
requested_audience = service B
requested_scope = case:read
```

Manfaat:

- audience benar per downstream;
- delegation eksplisit;
- audit chain lebih jelas;
- scope bisa dikurangi;
- AS bisa enforce policy terpusat.

Risiko:

- kompleksitas naik;
- policy token exchange harus ketat;
- actor/subject confusion;
- privilege escalation jika exchange terlalu permisif.

### 10.4 Decision Table

| Scenario | Recommended Pattern |
|---|---|
| Service A calls B for its own job | client credentials |
| Service A calls B because user requested action | token exchange / delegated token |
| Service A merely proxies user request | token relay, if audience and trust correct |
| Batch job no user | client credentials / workload identity |
| High assurance partner API | private_key_jwt or mTLS |
| Mesh-internal low-latency calls | service mesh mTLS + app token if needed |
| Cross-tenant action | tenant-bound token + strict resource check |

---

## 11. Failure Modes

### 11.1 Secret Leakage

Symptoms:

- token requests from unusual IP/workload;
- token issuance spike;
- access from unexpected environment;
- downstream calls outside normal pattern;
- audit client ID legitimate but origin suspicious.

Mitigation:

1. Revoke client secret/key/cert.
2. Rotate credential.
3. Invalidate affected tokens if possible.
4. Reduce token TTL.
5. Audit all actions by client ID.
6. Check CI/CD logs, config repo, secret manager access logs.
7. Add anomaly alerting.

### 11.2 Token Replay

Bearer token stolen and reused.

Mitigation:

- short TTL;
- audience restriction;
- scope minimization;
- mTLS certificate-bound token;
- DPoP/proof-of-possession where applicable;
- replay detection for high-risk operations;
- network egress control.

### 11.3 Over-Broad Token

Token issued with:

```text
scope=internal admin all
```

Consequence:

- one compromised service becomes platform-wide compromise.

Mitigation:

- per-service audience;
- per-operation scopes;
- client-specific grants;
- policy review;
- least privilege;
- deny-by-default.

### 11.4 Token Endpoint Outage

If token endpoint is unavailable:

- new token cannot be acquired;
- existing cached token may continue until expiry;
- services may fail in waves as tokens expire.

Design options:

| Option | Behavior | Risk |
|---|---|---|
| Fail closed | reject when no valid token | safer, may cause outage |
| Stale token grace | temporarily use recently expired token | availability higher, security risk |
| Pre-fetch | refresh before expiry | reduces outage impact |
| Token endpoint HA | solve at infra level | operational cost |

Default security stance:

> Fail closed unless explicit business continuity policy says otherwise.

### 11.5 Thundering Herd Refresh

Many instances refresh tokens at same time.

Mitigation:

- jitter refresh time;
- per-instance random skew;
- single-flight per instance;
- distributed token cache carefully;
- token endpoint rate limit;
- exponential backoff.

### 11.6 Cross-Environment Credential Reuse

DEV secret works in PROD.

Impact:

- lower environment compromise escalates to production.

Mitigation:

- separate issuer;
- separate clients;
- separate secrets/keys;
- environment-bound claims;
- network isolation;
- CI/CD policy.

### 11.7 Confused Deputy

Service A has broad permission. User tricks service A into calling Service B to perform action user cannot do.

Mitigation:

- separate service permission from user permission;
- explicit delegation;
- resource-level authorization;
- actor chain;
- token exchange;
- never trust caller-provided user ID blindly.

### 11.8 Client Identity Collision

Multiple workloads share one client ID:

```text
client_id = internal-service
```

Impact:

- audit cannot distinguish caller;
- revocation affects many services;
- blast radius unclear;
- least privilege impossible.

Mitigation:

- one client identity per deployable workload/purpose;
- separate client for high-risk operations;
- client naming standard;
- ownership registry.

---

## 12. Security Design Rules

### Rule 1 — Never Use One Internal Super Token

Buruk:

```text
All services use same internal token
```

Akibat:

- no attribution;
- no isolation;
- no revocation per service;
- compromise one = compromise all.

### Rule 2 — Bind Token to Audience

Every resource server validates `aud`.

No exception for “internal network”.

### Rule 3 — Separate User Identity from Service Identity

Audit model harus bisa mencatat:

```text
actor_type = SERVICE
actor_id = case-sync-worker-prod
initiator_type = USER
initiator_id = user-123
```

Atau:

```text
actor_type = SERVICE
actor_id = nightly-report-job-prod
initiator = SYSTEM_SCHEDULE
```

### Rule 4 — Prefer Short-Lived Access Tokens

Long-lived machine tokens adalah credential risk.

### Rule 5 — Prefer Proof-of-Possession for High-Risk Calls

Untuk high-value APIs:

- `private_key_jwt` for token endpoint client authentication;
- mTLS for token endpoint and resource call;
- certificate-bound access tokens;
- signed request for partner API;
- DPoP where appropriate.

### Rule 6 — Credential Rotation Must Be a Designed Feature

Jika rotation masih manual dan menakutkan, sistem belum production-grade.

### Rule 7 — Do Not Trust Network Location Alone

Internal network bukan authentication.

```text
source IP allowlist != identity proof
```

IP allowlist bisa menjadi defense-in-depth, bukan pengganti authentication.

### Rule 8 — Token Validation Must Be Local and Deterministic Where Possible

JWT validation lokal bagus untuk availability, tetapi revocation sulit.

Opaque introspection bagus untuk control, tetapi availability bergantung authorization server.

Pilih sadar trade-off.

### Rule 9 — Every Machine Client Must Have an Owner

Metadata client:

```text
client_id
owner team
system name
environment
allowed audience
allowed scopes
credential type
rotation date
last used
risk level
```

### Rule 10 — Logs Must Identify Machine Actor Without Leaking Credential

Log:

```text
client_id=case-sync-worker-prod aud=case-service-api scope=case:read token_jti=abc... request_id=...
```

Jangan log:

```text
Authorization: Bearer eyJ...
client_secret=...
private_key=...
```

---

## 13. Architecture Patterns

### 13.1 Pattern A — Simple Internal Client Credentials

```text
Service A --client_secret--> AS --token--> Service A --Bearer--> Service B
```

Cocok:

- low/medium risk;
- internal service;
- controlled runtime;
- strong secret manager;
- short TTL.

Jangan dipakai jika:

- partner-facing high-risk API;
- no rotation automation;
- client secret ditanam di source code;
- broad admin scope.

### 13.2 Pattern B — Private Key Client Authentication

```text
Service A --signed client assertion--> AS
AS verifies public key
AS issues token
Service A calls Service B
```

Cocok:

- high assurance;
- cross-organization;
- no shared secret preference;
- strong key lifecycle.

### 13.3 Pattern C — mTLS Client Authentication + Certificate-Bound Token

```text
Service A --mTLS--> AS
AS issues cert-bound token
Service A --mTLS + token--> Service B
Service B verifies token bound to cert
```

Cocok:

- regulated environment;
- financial/government APIs;
- high-risk operations;
- strong PKI.

### 13.4 Pattern D — Workload Identity to Token

```text
Pod/VM/Function identity -> STS/Auth Server -> access token -> Resource Server
```

Cocok:

- Kubernetes/cloud-native;
- ephemeral workload;
- avoid static secret;
- platform-managed identity.

### 13.5 Pattern E — Service Mesh Identity + App Authorization Token

```text
mTLS mesh proves workload identity
App token proves application permission/context
Resource server enforces both
```

Cocok:

- microservices platform;
- zero trust internal;
- platform + application policy separation.

---

## 14. Production Checklist

### Client Registration

- [ ] Client ID descriptive.
- [ ] Owner team recorded.
- [ ] Environment separated.
- [ ] Allowed grant types minimal.
- [ ] Allowed auth method explicit.
- [ ] Allowed scopes minimal.
- [ ] Allowed audiences explicit.
- [ ] Rotation policy defined.
- [ ] Last-used telemetry enabled.
- [ ] Emergency revoke procedure exists.

### Token Issuance

- [ ] Token TTL short.
- [ ] `iss` correct.
- [ ] `aud` specific.
- [ ] `scope` minimal.
- [ ] `client_id` included/auditable.
- [ ] `jti` included for traceability.
- [ ] Token endpoint rate limited.
- [ ] Token issuance logged.
- [ ] Failed client auth logged.
- [ ] Anomaly detection exists.

### Java Client

- [ ] Token provider centralized.
- [ ] Token cache keyed correctly.
- [ ] Single-flight refresh.
- [ ] Refresh jitter.
- [ ] Timeout configured.
- [ ] Retry bounded.
- [ ] Token not logged.
- [ ] Secret not logged.
- [ ] Metrics available.
- [ ] Circuit breaker considered.

### Resource Server

- [ ] Signature/introspection validation.
- [ ] Issuer validation.
- [ ] Audience validation.
- [ ] Expiry validation.
- [ ] Scope/permission validation.
- [ ] Tenant validation if applicable.
- [ ] Client ID authorization.
- [ ] Certificate binding validation if applicable.
- [ ] Deny by default.
- [ ] Security event logging.

### Operations

- [ ] Rotation tested.
- [ ] Credential expiry monitored.
- [ ] Token endpoint SLO defined.
- [ ] Secret manager access audited.
- [ ] Incident playbook exists.
- [ ] Lower env cannot access prod.
- [ ] CI/CD masks secrets.
- [ ] Heap/thread/log dumps protected.
- [ ] Ownership reviewed periodically.
- [ ] Unused clients removed.

---

## 15. Common Mistakes

### Mistake 1 — Treating Client Credentials as User Login

Client credentials authenticate application, not human user.

### Mistake 2 — Reusing One Client ID for Many Services

Audit and revocation become impossible.

### Mistake 3 — Not Validating Audience

A token for Service A becomes accepted by Service B.

### Mistake 4 — Long-Lived Access Token

Token leak impact becomes large.

### Mistake 5 — Hardcoding Client Secret

Source code becomes credential storage.

### Mistake 6 — Logging Authorization Header

Bearer token leaks through logs.

### Mistake 7 — Manual Rotation Only

Rotation becomes rare, risky, and usually skipped.

### Mistake 8 — Trusting Internal Network

Internal network does not prove identity.

### Mistake 9 — Using Service Token for End-User Authorization

Downstream loses user permission semantics.

### Mistake 10 — No Token Endpoint Resilience

Authorization server hiccup becomes platform outage.

---

## 16. Design Questions

Sebelum memilih client credentials / private key / mTLS / workload identity, tanyakan:

1. Caller ini service, job, user, device, atau hybrid?
2. Apakah call dilakukan atas nama user?
3. Apakah downstream perlu user identity?
4. Apakah token harus audience-specific?
5. Apakah operation high-risk?
6. Apakah token theft harus dibatasi dengan proof-of-possession?
7. Apakah platform mendukung workload identity?
8. Apakah secret rotation otomatis?
9. Apakah client punya owner?
10. Apakah client ID granular?
11. Apakah authorization server highly available?
12. Apakah token endpoint punya rate limit?
13. Apakah downstream validate issuer/audience/scope?
14. Apakah audit dapat membedakan service actor vs user initiator?
15. Apakah tenant/environment binding ada?
16. Apakah ada emergency revocation?
17. Apakah local development flow aman?
18. Apakah CI/CD menyimpan secret dengan benar?
19. Apakah logs bebas credential?
20. Apakah failure behavior fail-closed atau fail-open?

---

## 17. Reference Decision Matrix

| Requirement | Recommended Mode |
|---|---|
| Simple internal service call | client credentials + short TTL + audience |
| High-security internal service | private_key_jwt or mTLS |
| Partner API | mTLS or private_key_jwt, often both |
| No static secrets desired | workload identity federation |
| Kubernetes zero trust | service mesh mTLS + app-level token |
| Need user delegation downstream | token exchange / on-behalf-of |
| Need immediate revocation | opaque token + introspection or short JWT TTL |
| Need low latency/high availability | JWT with JWKS cache |
| Need token theft resistance | certificate-bound token / PoP |
| Multi-tenant service | tenant-bound token + resource-level validation |

---

## 18. Example Architecture: Regulatory Case Platform

Misalkan ada sistem case management:

```text
case-service
correspondence-service
audit-service
report-job
notification-worker
integration-connector
```

### 18.1 Bad Design

```text
All services use:
client_id = internal
client_secret = same-secret
scope = admin
```

Masalah:

- audit tidak jelas;
- satu bocor semua bocor;
- impossible least privilege;
- no service ownership;
- no per-service revoke;
- cross-service token misuse.

### 18.2 Better Design

```text
client_id = case-service-prod
scopes = correspondence:send audit:append
allowed_audience = correspondence-service, audit-service

client_id = report-job-prod
scopes = case:read report:generate audit:append
allowed_audience = case-service, report-service, audit-service

client_id = notification-worker-prod
scopes = notification:send audit:append
allowed_audience = notification-service, audit-service
```

Each service:

- uses own credential;
- token TTL 5–10 minutes;
- validates audience;
- logs `client_id`, `jti`, `request_id`;
- separates system actor from user initiator;
- has rotation playbook.

### 18.3 High-Assurance Upgrade

For critical connectors:

```text
integration-connector-prod uses private_key_jwt
partner-gateway uses mTLS
high-value token is certificate-bound
```

For Kubernetes:

```text
pod service account -> workload identity -> token exchange -> app token
```

---

## 19. Minimal Java Pseudocode: Token Provider and Interceptor

### 19.1 Token Provider

```java
public interface MachineTokenProvider {
    String bearerTokenFor(String audience, Set<String> scopes);
}
```

### 19.2 HTTP Interceptor Concept

```java
public final class BearerTokenInterceptor {
    private final MachineTokenProvider tokenProvider;

    public BearerTokenInterceptor(MachineTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    public HttpRequest addAuthentication(HttpRequest request, String audience, Set<String> scopes) {
        String token = tokenProvider.bearerTokenFor(audience, scopes);
        return request.withHeader("Authorization", "Bearer " + token);
    }
}
```

### 19.3 Resource Server Concept

```java
public final class MachineTokenValidator {
    public AuthenticatedClient validate(String token, String expectedAudience, String requiredScope) {
        TokenClaims claims = verifyToken(token);

        requireIssuer(claims.issuer());
        requireAudience(claims.audience(), expectedAudience);
        requireNotExpired(claims.expiresAt());
        requireScope(claims.scopes(), requiredScope);

        return new AuthenticatedClient(
                claims.clientId(),
                claims.scopes(),
                claims.audience()
        );
    }
}
```

The important part is not the syntax. The important part is the invariant:

> Authentication and authorization checks must be explicit, centralized, and auditable.

---

## 20. Summary

Machine-to-machine authentication is not “user login without user”.

It is a distinct authentication domain where the actor is a service, job, worker, device, or workload. The main engineering challenge is not only issuing tokens, but managing identity, credential lifecycle, audience, scope, tenant binding, rotation, audit, revocation, and blast radius.

Key takeaways:

1. Client credentials authenticate the client, not a human user.
2. Service identity and user identity must not be confused.
3. Static client secrets are simple but high-risk if poorly managed.
4. `private_key_jwt` avoids sending shared secrets and improves proof of possession.
5. mTLS provides strong client authentication and can bind tokens to certificates.
6. Workload identity reduces static secret sprawl in cloud-native systems.
7. Every token should have narrow audience and scope.
8. Token caching must avoid thundering herd refresh.
9. Rotation must be designed, tested, and observable.
10. Audit must show machine actor, optional user initiator, tenant, scope, audience, and request correlation.

The top 1% mental model:

> A machine token is not just a string that allows access. It is a time-limited, policy-constrained, audience-bound, issuer-backed assertion that a specific workload is allowed to perform specific actions under specific operational assumptions.

---

## 21. References

- RFC 6749 — The OAuth 2.0 Authorization Framework: https://datatracker.ietf.org/doc/html/rfc6749
- RFC 7523 — JSON Web Token Profile for OAuth 2.0 Client Authentication and Authorization Grants: https://datatracker.ietf.org/doc/html/rfc7523
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens: https://datatracker.ietf.org/doc/html/rfc8705
- RFC 8693 — OAuth 2.0 Token Exchange: https://datatracker.ietf.org/doc/html/rfc8693
- RFC 9700 — OAuth 2.0 Security Best Current Practice: https://datatracker.ietf.org/doc/html/rfc9700
- Spring Security OAuth2 Client Reference: https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html
- Spring Security OAuth2 Resource Server Reference: https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html
- Spring Authorization Server Reference: https://docs.spring.io/spring-authorization-server/reference/
- NIST SP 800-204A — Building Secure Microservices-based Applications Using Service Mesh Architecture: https://www.nist.gov/publications/building-secure-microservices-based-applications-using-service-mesh-architecture
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

---

## 22. Status Series

- Part 0 selesai — Orientation: Mental Model of Authentication in Java Systems
- Part 1 selesai — Java Runtime Security Foundations
- Part 2 selesai — Authentication Taxonomy
- Part 3 selesai — Password Authentication Done Properly
- Part 4 selesai — Session-Based Authentication
- Part 5 selesai — Servlet Container Authentication
- Part 6 selesai — Jakarta Security and Jakarta Authentication
- Part 7 selesai — Spring Security Authentication Architecture
- Part 8 selesai — Authentication Context Propagation
- Part 9 selesai — API Key Authentication
- Part 10 selesai — HMAC Request Signing
- Part 11 selesai — JWT Authentication
- Part 12 selesai — Opaque Token and Introspection
- Part 13 selesai — OAuth 2.0 for Java Engineers
- Part 14 selesai — OpenID Connect
- Part 15 selesai — Authorization Code + PKCE
- Part 16 selesai — Client Credentials and Machine-to-Machine Authentication

Series belum selesai.

Part berikutnya:

> **Part 17 — SAML 2.0 Authentication in Java Enterprise Systems**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-015.md">⬅️ Part 15 — Authorization Code + PKCE for Java Web and SPA Backends</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-017.md">Part 17 — SAML 2.0 Authentication in Java Enterprise Systems ➡️</a>
</div>
