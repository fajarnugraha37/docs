# learn-java-authentication-modes-and-patterns-part-027

# Part 27 — Authentication in Microservices and Distributed Systems

> Seri: **Java Authentication Modes and Patterns**  
> Bagian: **27 dari 35**  
> Target pembaca: software engineer Java senior/lead yang ingin mampu mendesain authentication untuk sistem enterprise, microservices, distributed workload, API gateway, service mesh, async worker, dan platform regulatoris.  
> Rentang Java: **Java 8 sampai Java 25**  
> Fokus: **authentication architecture in distributed systems**, bukan tutorial framework dasar.

---

## 0. Ringkasan Besar

Authentication di monolith biasanya terasa sederhana:

```text
Browser/User -> Application -> Database
```

Aplikasi menerima credential, membuat session, lalu setiap request punya user yang sama.

Di microservices, pertanyaannya berubah total:

```text
User -> Edge/Gateway -> Service A -> Service B -> Service C -> Queue -> Worker -> Database
```

Pertanyaan authentication tidak lagi hanya:

> “Apakah user sudah login?”

Tetapi menjadi:

> “Siapa aktor asalnya, siapa service yang sedang bertindak, untuk resource mana token ini ditujukan, apakah delegation ini sah, apakah downstream boleh menerima identity ini, dan apakah audit trail bisa membedakan user action, service action, retry, scheduler, dan admin impersonation?”

Di distributed system, authentication adalah **identity propagation + trust boundary management + credential lifecycle + delegation control**.

Part ini membangun mental model untuk menjawab desain seperti:

- Apakah token user boleh diteruskan ke semua service?
- Apakah gateway boleh menyisipkan header `X-User-Id`?
- Kapan perlu token exchange?
- Apa beda user identity dan service identity?
- Bagaimana authentication untuk Kafka/RabbitMQ/worker?
- Bagaimana audit actor di async processing?
- Bagaimana mTLS/service mesh berhubungan dengan JWT/OIDC?
- Bagaimana menghindari confused deputy?
- Bagaimana resource server Java memvalidasi `iss`, `aud`, `exp`, `scope`, `tenant`, dan key?

---

## 1. Problem yang Diselesaikan

### 1.1 Masalah Dasar

Microservices memecah aplikasi menjadi banyak proses yang saling memanggil. Pemecahan ini membantu modularity, deployment independence, dan team ownership, tetapi membuat authentication lebih sulit karena:

1. Request melewati banyak hop.
2. Identity bisa berubah bentuk.
3. Token bisa diteruskan secara tidak tepat.
4. Service internal menjadi protected resource juga.
5. Gateway sering terlalu dipercaya.
6. Async processing memutus continuity request.
7. Service account bisa memiliki privilege terlalu besar.
8. Audit trail bisa kehilangan aktor asal.
9. Session browser tidak otomatis cocok untuk backend-to-backend call.
10. Network internal tidak boleh dianggap trusted.

### 1.2 Monolith vs Microservices

Dalam monolith:

```text
[HTTP Request]
   |
   v
[One App Process]
   |
   +-- authn
   +-- authz
   +-- business logic
   +-- DB access
```

Identity biasanya hidup dalam satu process context, misalnya:

- Servlet `HttpSession`
- Spring `SecurityContextHolder`
- Jakarta `SecurityContext`
- ThreadLocal principal

Dalam microservices:

```text
[Client]
   |
   v
[Gateway]
   |
   +--> [Service A]
            |
            +--> [Service B]
                    |
                    +--> [Queue]
                            |
                            +--> [Worker C]
```

Identity tidak otomatis berpindah dengan aman. Ia harus **dibawa, ditukar, dikurangi, diverifikasi ulang, atau direkonstruksi**.

### 1.3 Tujuan Part Ini

Setelah part ini, kamu harus bisa:

1. Membedakan **edge authentication** dan **internal authentication**.
2. Mendesain propagation identity user dan service secara eksplisit.
3. Menentukan kapan memakai token relay, token exchange, mTLS, internal JWT, opaque token, atau signed message.
4. Memvalidasi token di Java resource server dengan benar.
5. Menghindari trust pada header internal tanpa proof.
6. Mendesain authentication untuk async message/job.
7. Membuat audit actor model yang defensible.
8. Mengidentifikasi failure mode authentication di distributed system.

---

## 2. Mental Model: Distributed Authentication Is Not Login

### 2.1 Login Hanya Satu Event

Login adalah event awal:

```text
credential proof -> authentication decision -> session/token issued
```

Tetapi distributed authentication melanjutkan pertanyaan itu di setiap hop:

```text
request arrives -> caller identity verified -> token audience checked -> delegation checked -> local principal derived -> downstream credential chosen
```

Setiap service harus bertanya:

1. Siapa caller langsung?
2. Siapa aktor asal?
3. Token ini ditujukan untuk service saya atau bukan?
4. Apakah token masih valid?
5. Apakah token cukup kuat untuk operasi ini?
6. Apakah saya boleh meneruskan identity ini?
7. Apakah saya harus menukar token?
8. Bagaimana audit mencatat keputusan ini?

### 2.2 Dua Identity yang Sering Tercampur

Dalam distributed system, hampir selalu ada minimal dua identity:

```text
End-user identity      = manusia / browser / mobile user / admin / customer
Workload identity      = service / job / worker / scheduled task / integration client
```

Contoh:

```text
User Alice calls Service A.
Service A calls Service B.
```

Service B menerima call dari siapa?

Jawaban buruk:

```text
Alice
```

Jawaban lebih akurat:

```text
Immediate caller : service-a
Original actor   : Alice
Delegation mode  : service-a is acting on behalf of Alice
Target audience  : service-b
```

Ini perbedaan besar.

Service B tidak hanya perlu tahu Alice. Service B juga perlu tahu apakah **Service A memang sah bertindak atas nama Alice**.

### 2.3 Authentication Has Three Layers

Di distributed system, authentication biasanya perlu dilihat dalam tiga layer:

```text
+--------------------------------------------------+
| 1. Transport Identity                            |
|    e.g. mTLS cert, service mesh workload ID      |
+--------------------------------------------------+
| 2. Request/Token Identity                        |
|    e.g. JWT, opaque token, OAuth2 token          |
+--------------------------------------------------+
| 3. Business Actor Identity                       |
|    e.g. userId, officerId, agencyId, tenantId    |
+--------------------------------------------------+
```

Kesalahan umum adalah memakai salah satu layer untuk menggantikan semua layer.

Contoh anti-pattern:

- “Karena sudah mTLS, tidak perlu validasi JWT.”
- “Karena JWT valid, tidak perlu tahu service caller.”
- “Karena gateway sudah authenticate, service internal percaya semua header.”
- “Karena event punya `createdBy`, worker boleh percaya.”

Desain matang memisahkan layer ini.

---

## 3. Core Concepts

## 3.1 Edge Authentication

**Edge authentication** adalah authentication yang terjadi di boundary paling luar sistem.

Contoh edge:

- API Gateway
- Ingress Controller
- BFF
- Reverse proxy
- Identity-aware proxy
- Load balancer with OIDC integration
- Web application entry point

Edge authentication biasanya menangani:

1. Browser login.
2. OAuth2/OIDC authorization code flow.
3. Session cookie.
4. Initial bearer token validation.
5. API key validation untuk external API.
6. mTLS client auth untuk partner.
7. Request normalization.
8. Rejection early sebelum masuk internal network.

### 3.1.1 Edge Authentication Does Not End Authentication

Edge authentication menjawab:

```text
Apakah request dari client eksternal valid?
```

Tetapi tidak otomatis menjawab:

```text
Apakah Service B boleh percaya header dari Service A?
Apakah token ini memang untuk Service B?
Apakah identity boleh dipakai untuk operation downstream?
```

Karena itu, edge authentication harus dilanjutkan dengan internal authentication.

---

## 3.2 Internal Authentication

**Internal authentication** adalah authentication antar service/workload di dalam sistem.

Contoh:

```text
service-a -> service-b
worker-x  -> service-c
scheduler -> service-d
gateway   -> internal-api
```

Internal authentication bisa memakai:

- mTLS service identity
- OAuth2 client credentials
- private key JWT
- signed internal JWT
- opaque token introspection
- HMAC request signing
- service mesh identity
- cloud workload identity

Prinsipnya:

> Network internal bukan bukti identity.

Internal network hanya transport. Identity tetap harus dibuktikan.

---

## 3.3 Token Relay

**Token relay** berarti service meneruskan token yang diterimanya ke service lain.

```text
Client -> Service A with token T
Service A -> Service B with same token T
```

### Kapan Token Relay Masuk Akal

Token relay masuk akal jika:

1. Token memang memiliki audience untuk downstream service.
2. Service A tidak perlu privilege tambahan.
3. Downstream service memang harus mengambil keputusan berdasarkan user asli.
4. Token scope cukup sempit.
5. Chain call pendek dan terkendali.
6. Trust boundary jelas.

### Risiko Token Relay

Token relay berbahaya jika:

1. Token `aud` hanya untuk Service A tetapi diterima Service B.
2. Semua service menerima token yang sama.
3. Scope terlalu luas.
4. Service A yang compromised bisa memakai token ke banyak service.
5. Audit tidak tahu siapa immediate caller.
6. Token user dipakai untuk operation yang sebenarnya dilakukan system.

### Mental Model

Token relay adalah:

```text
same authority, same actor, same token, more exposure
```

Semakin banyak hop, semakin besar blast radius.

---

## 3.4 Token Exchange

**Token exchange** berarti service menukar token yang diterima menjadi token baru untuk downstream target.

```text
Client -> Service A with token T1 for service-a
Service A -> Authorization Server: exchange T1 for T2
Service A -> Service B with token T2 for service-b
```

RFC 8693 mendefinisikan OAuth 2.0 Token Exchange untuk memperoleh security token dari authorization server, termasuk skenario impersonation dan delegation.

### Mengapa Token Exchange Penting

Token exchange memungkinkan:

1. Audience dikurangi ke service tujuan.
2. Scope dikurangi.
3. Delegation dicatat eksplisit.
4. Masa berlaku token diperpendek.
5. Token downstream berbeda dari token upstream.
6. Immediate caller bisa direpresentasikan.
7. Confused deputy risk dikurangi.

### Delegation vs Impersonation

#### Delegation

```text
Service A acts on behalf of Alice.
```

Audit semestinya mencatat:

```text
actor        = Alice
client       = service-a
delegation   = on_behalf_of
resource     = service-b
```

#### Impersonation

```text
Service A becomes Alice for downstream call.
```

Ini lebih berbahaya karena downstream mungkin tidak tahu bahwa call sebenarnya datang dari service.

Prinsip desain:

> Prefer delegation over silent impersonation.

---

## 3.5 Audience

`aud` adalah claim yang menyatakan token ditujukan untuk siapa.

Contoh JWT:

```json
{
  "iss": "https://idp.example.com/realms/aceas",
  "sub": "user-123",
  "aud": "case-service",
  "scope": "case.read case.update",
  "exp": 1760000000
}
```

Service harus menolak token yang tidak ditujukan untuk dirinya.

```text
case-service receives token with aud = report-service
=> reject
```

### Mengapa Audience Penting

Tanpa audience validation, token untuk satu service bisa dipakai di service lain.

Itu menyebabkan:

1. Token substitution.
2. Lateral movement.
3. Confused deputy.
4. Privilege expansion.
5. Audit ambiguity.

Spring Boot/Spring Security resource server mendukung konfigurasi audience validation pada JWT resource server; `issuer-uri` memvalidasi `iss`, sedangkan `audiences` memvalidasi `aud` sebagai pihak yang dituju oleh JWT.

---

## 3.6 Immediate Caller vs Original Actor

Service yang matang membedakan:

```text
Immediate caller = siapa yang langsung memanggil saya
Original actor   = siapa sumber aksi awal
```

Contoh:

```text
Alice -> Gateway -> Case Service -> Document Service
```

Document Service sebaiknya bisa melihat:

```text
immediateCaller = case-service
originalActor   = Alice
requestSource   = gateway
operation        = attach-document
```

Ini penting untuk:

1. Authorization.
2. Audit.
3. Rate limiting.
4. Incident response.
5. Service accountability.
6. Debugging.

---

## 3.7 Trust Boundary

Trust boundary adalah titik ketika data/identity dari luar harus diverifikasi sebelum dipercaya.

Dalam microservices:

```text
Internet -> Gateway                         boundary
Gateway -> Internal service                 boundary
Service A -> Service B                      boundary
Queue -> Worker                             boundary
Worker -> Database                          boundary
Partner API -> Ingress                      boundary
Service mesh sidecar -> App container       boundary
```

Setiap boundary membutuhkan aturan:

1. Credential apa yang diterima?
2. Proof apa yang diverifikasi?
3. Claim/header mana yang trusted?
4. Siapa issuer yang valid?
5. Audience apa yang valid?
6. Bagaimana failure ditangani?
7. Apa yang dicatat untuk audit?

---

## 4. Java 8–25 Relevance

## 4.1 Java 8

Java 8 masih banyak dipakai di enterprise legacy. Untuk distributed authentication, Java 8 biasanya berarti:

1. Servlet 3.x/4.x stack.
2. Spring Security 4/5 legacy.
3. Manual JWT library integration.
4. JAAS/Kerberos integration.
5. Apache HttpClient/OkHttp/RestTemplate.
6. Manual propagation ThreadLocal.
7. Older TLS defaults.
8. JKS/PKCS12 keystore complexity.

Risk terbesar Java 8 environment:

- ad-hoc token validation,
- weak TLS defaults jika tidak dikonfigurasi,
- security context propagation manual,
- library versi lama,
- mixed legacy session dan token architecture.

## 4.2 Java 11/17

Java 11/17 membawa baseline modern enterprise:

1. `java.net.http.HttpClient` tersedia sejak Java 11.
2. TLS stack lebih modern.
3. Spring Boot 2.x/3.x transition.
4. Jakarta namespace migration mulai relevan.
5. Container/cloud deployment lebih umum.
6. Better observability integration.

## 4.3 Java 21

Java 21 relevan karena:

1. Virtual threads final.
2. Banyak sistem mulai pindah dari Java 8/11 ke 21.
3. Spring Boot 3.x umum memakai Java 17+.
4. Concurrency model berubah: ThreadLocal propagation harus dipikirkan ulang.
5. High-throughput service-to-service call menjadi lebih murah dari sisi thread, tetapi identity propagation tetap tidak otomatis aman.

## 4.4 Java 25

Java 25 relevan untuk:

1. Virtual thread maturity.
2. Structured concurrency API evolution.
3. Scoped values untuk safer context passing.
4. KDF API dan PEM encoding direction yang berguna untuk key material lifecycle.
5. Modern TLS/crypto ecosystem.

Tetapi prinsipnya tetap:

> Java version membantu implementation ergonomics, tetapi tidak menggantikan architecture correctness.

---

## 5. Distributed Authentication Reference Model

## 5.1 Baseline Model

```text
+---------+       +---------+       +------------+       +------------+
| Client  | ----> | Gateway | ----> | Service A  | ----> | Service B  |
+---------+       +---------+       +------------+       +------------+
    |                  |                  |                    |
    | user credential  | edge token       | internal token      |
    | browser session  | validation       | validation          |
```

At each hop:

```text
1. verify caller proof
2. validate token/session/certificate
3. derive local principal
4. authorize operation
5. decide downstream credential
6. log audit event
```

## 5.2 Better Model With Separate Identities

```text
Client Alice
   |
   | OIDC code flow / session cookie
   v
Gateway / BFF
   |
   | token for case-service
   v
Case Service
   |
   | token exchange: Alice delegated via case-service to document-service
   v
Document Service
```

Document Service sees:

```text
transport_identity = case-service workload cert
request_identity   = token issued by trusted AS
original_actor     = Alice
client_actor       = case-service
intended_audience  = document-service
scope              = document.attach
```

This is a stronger model than simply passing `X-User-Id: Alice`.

---

## 6. Common Architecture Patterns

## 6.1 Pattern A — Gateway Authenticates, Services Trust Gateway Headers

### Flow

```text
Client -> Gateway authenticates user
Gateway -> Service with headers:
  X-User-Id: alice
  X-Roles: officer,approver
```

### Advantages

1. Simple.
2. Fast.
3. Centralized edge authentication.
4. Easy for legacy services.
5. Useful during migration.

### Problems

1. Header spoofing if service is reachable directly.
2. Gateway becomes over-trusted.
3. Service cannot validate cryptographic proof.
4. Harder zero-trust posture.
5. Audit may lose token metadata.
6. Internal lateral movement risk.

### Safe Variant

This pattern is only acceptable if:

1. Services are not externally reachable.
2. Gateway-to-service channel is authenticated, e.g. mTLS.
3. Internal services reject requests not from gateway/workload identity.
4. Headers are stripped/recreated at gateway.
5. Services treat headers as trusted only from verified gateway.
6. Audit records gateway identity and original request correlation.

### Java Implementation Hint

In Spring:

- create a filter that only accepts identity headers if caller is verified gateway,
- map headers into `Authentication`,
- reject missing gateway proof,
- never accept arbitrary `X-User-*` from public ingress.

Pseudo-flow:

```java
if (!isVerifiedGateway(request)) {
    reject(401);
}

String userId = request.getHeader("X-User-Id");
String tenant = request.getHeader("X-Tenant-Id");
String roles = request.getHeader("X-Roles");

Authentication auth = toAuthentication(userId, tenant, roles);
SecurityContextHolder.getContext().setAuthentication(auth);
```

But the real security depends on `isVerifiedGateway`, not on the mapping code.

---

## 6.2 Pattern B — Every Service Validates External JWT

### Flow

```text
Client -> Gateway -> Service A -> Service B
All services validate same JWT.
```

### Advantages

1. Cryptographic validation at every service.
2. Gateway is not the only enforcement point.
3. Services can inspect claims.
4. Works well for simple resource server design.

### Problems

1. Token may be over-broad.
2. Audience may be ignored.
3. Token relay increases exposure.
4. User token may reach services that do not need it.
5. Revocation is hard if JWT is self-contained.
6. Long-lived JWT is dangerous.

### Safe Variant

1. Validate signature.
2. Validate `iss`.
3. Validate `aud`.
4. Validate `exp` and `nbf`.
5. Validate tenant/realm.
6. Validate scopes/permissions locally.
7. Keep token short-lived.
8. Avoid passing token to unnecessary services.

### Java/Spring Example Concept

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com/realms/main
          audiences: case-service
```

Then service-specific authorization:

```java
@PreAuthorize("hasAuthority('SCOPE_case.read')")
public CaseDetail getCase(String id) {
    ...
}
```

But do not confuse scope validation with complete business authorization.

---

## 6.3 Pattern C — Token Exchange Per Downstream Service

### Flow

```text
Client -> Service A with token for service-a
Service A -> AS token exchange
Service A -> Service B with token for service-b
```

### Advantages

1. Strong audience isolation.
2. Reduced privilege.
3. Better delegation semantics.
4. Better audit.
5. Smaller blast radius.
6. Supports service-specific claims.

### Problems

1. More moving parts.
2. Authorization server becomes hot path.
3. Caching needed carefully.
4. Retry/failure behavior more complex.
5. Requires IdP/AS support.

### Safe Variant

1. Use short-lived exchanged token.
2. Cache per actor/client/audience/scope tuple only if safe.
3. Preserve original actor claim.
4. Preserve delegating service claim.
5. Reject exchange to broader scope.
6. Log exchange event.
7. Monitor exchange failure rate.

---

## 6.4 Pattern D — Service Mesh mTLS + Application JWT

### Flow

```text
Service A --mTLS--> Service B
           + JWT/opaque token at HTTP layer
```

### Advantages

1. Transport-level workload authentication.
2. Encryption in transit.
3. Service identity independent of app token.
4. Works well for zero-trust network posture.
5. Mesh can enforce coarse service-to-service policy.

### Problems

1. mTLS proves service identity, not user identity.
2. Sidecar/app boundary can be misunderstood.
3. Mesh policy does not replace business authorization.
4. Certificate identity mapping must be controlled.
5. Operational complexity.

NIST SP 800-204A describes service mesh as infrastructure for microservice security capabilities including authentication, authorization, secure communication, and monitoring.

### Good Design

```text
mTLS cert says: caller workload = service-a
JWT says: original actor = Alice, audience = service-b
Business auth says: Alice may attach document to case 123
```

All three are checked.

---

## 6.5 Pattern E — Backend-for-Frontend as Authentication Boundary

### Flow

```text
Browser -> BFF session cookie
BFF -> Internal APIs using server-held tokens
```

### Advantages

1. Browser does not hold access token.
2. Better CSRF/session controls.
3. Internal token handling stays server-side.
4. Good for SPA security.
5. Easier token rotation.

### Problems

1. BFF becomes critical security component.
2. Session scaling needed.
3. CSRF must be handled.
4. BFF may become too broad.
5. Audit must distinguish BFF from user.

### Good Use

Use BFF when:

1. Browser app is first-party.
2. Tokens are sensitive.
3. You need central UX/session control.
4. Internal services should not be exposed to browser.

---

## 6.6 Pattern F — Async Event Actor Propagation

### Flow

```text
HTTP request by Alice -> Service A creates event -> Queue -> Worker B processes event
```

Question:

> Is Worker B acting as Alice or as system?

There are two common models.

### Model 1 — User-Initiated Async Work

```text
actor.type      = USER
actor.id        = Alice
initiator       = Alice
executor        = worker-b
reason          = async continuation of request R
```

### Model 2 — System-Owned Async Work

```text
actor.type      = SYSTEM
actor.id        = nightly-scheduler
initiator       = system
executor        = worker-b
reason          = scheduled reconciliation
```

### Anti-Pattern

```json
{
  "createdBy": "Alice"
}
```

with no proof, no context, no delegation metadata, no event signature, no source service, no correlation id.

### Better Event Envelope

```json
{
  "eventId": "evt-001",
  "eventType": "DocumentAttachmentRequested",
  "issuedAt": "2026-06-19T10:15:30Z",
  "sourceService": "case-service",
  "correlationId": "corr-123",
  "actor": {
    "type": "USER",
    "id": "alice",
    "tenantId": "agency-a",
    "assuranceLevel": "aal2"
  },
  "executorIntent": {
    "mode": "ON_BEHALF_OF",
    "allowedAction": "document.attach",
    "resource": "case-123"
  },
  "integrity": {
    "signatureVersion": "v1",
    "keyId": "case-service-2026-06"
  }
}
```

---

## 7. Token Relay vs Token Exchange vs Service Credential

## 7.1 Decision Matrix

| Situation | Recommended Pattern |
|---|---|
| Service B must know user and make user-specific decision | Token exchange or tightly controlled token relay |
| Service B only needs to know Service A is allowed | Service credential / client credentials / mTLS |
| Service B performs system maintenance | Service identity, not user token |
| Service B calls Service C with reduced scope | Token exchange |
| Legacy service cannot validate JWT | Gateway header with mTLS and network isolation as migration pattern |
| High-risk operation | Step-up token or assurance claim required |
| Async event continuation | Actor envelope + service authentication + audit |
| Partner API | API key/HMAC/mTLS/OAuth client credentials depending risk |

## 7.2 Token Relay Smell

Token relay becomes suspicious when:

1. Same token is accepted by all services.
2. `aud` is missing or ignored.
3. Internal services do not validate token.
4. Token contains many scopes unrelated to service.
5. Long call chain passes bearer token through logs/traces.
6. Downstream cannot tell immediate caller.

## 7.3 Token Exchange Smell

Token exchange becomes suspicious when:

1. Exchanged token has broader scope than original.
2. Exchange is used to hide original actor.
3. Exchange cache ignores actor/tenant/scope/audience.
4. All services can exchange to all audiences.
5. Authorization server is unavailable and services fail open.

## 7.4 Service Credential Smell

Service credential becomes suspicious when:

1. One service account is shared by many services.
2. Secret is copied to many pods/VMs.
3. Credential never rotates.
4. Downstream cannot distinguish callers.
5. System token is used for user-specific operations without delegation.

---

## 8. Designing Principal Model for Microservices

## 8.1 Minimal Principal Is Not Enough

Bad principal:

```java
record Principal(String userId) {}
```

Better principal:

```java
record DistributedPrincipal(
    Actor originalActor,
    Caller immediateCaller,
    TenantContext tenant,
    AuthenticationAssurance assurance,
    Set<String> scopes,
    String issuer,
    String audience,
    String tokenId,
    String correlationId
) {}
```

## 8.2 Actor Types

```java
enum ActorType {
    USER,
    SERVICE,
    SYSTEM,
    SCHEDULER,
    WORKER,
    ADMIN_IMPERSONATION,
    PARTNER_CLIENT
}
```

## 8.3 Actor Model

```java
record Actor(
    ActorType type,
    String id,
    String displayName,
    String tenantId,
    String organizationId
) {}
```

## 8.4 Caller Model

```java
record Caller(
    String serviceName,
    String workloadId,
    String clientId,
    String certificateSubject,
    String sourceIp
) {}
```

## 8.5 Why This Matters

For audit, these are different:

```text
Alice approved case directly.
Case-service approved case automatically for Alice.
Admin Bob impersonated Alice and approved case.
Nightly scheduler auto-closed inactive case.
Partner system submitted update for agency A.
```

If all become:

```text
createdBy = Alice
```

your audit model is weak.

---

## 9. Java Implementation Patterns

## 9.1 Spring Security Resource Server Pattern

A Spring Boot resource server can validate JWT at each service boundary.

Conceptual configuration:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com/realms/aceas
          audiences: case-service
```

Then map claims into authorities and domain principal.

```java
@Bean
JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
    scopes.setAuthorityPrefix("SCOPE_");
    scopes.setAuthoritiesClaimName("scope");

    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(scopes);
    converter.setPrincipalClaimName("sub");
    return converter;
}
```

This is only the baseline. For top-tier systems, add:

1. Audience validation.
2. Tenant validation.
3. Client ID validation.
4. Assurance validation.
5. Token type validation.
6. Delegation claim validation.
7. Custom domain principal mapping.

## 9.2 Custom JWT Validator

Conceptual example:

```java
final class TenantAwareJwtValidator implements OAuth2TokenValidator<Jwt> {
    private final String expectedAudience;
    private final Set<String> allowedIssuers;

    TenantAwareJwtValidator(String expectedAudience, Set<String> allowedIssuers) {
        this.expectedAudience = expectedAudience;
        this.allowedIssuers = Set.copyOf(allowedIssuers);
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (!allowedIssuers.contains(jwt.getIssuer().toString())) {
            return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Untrusted issuer", null)
            );
        }

        if (!jwt.getAudience().contains(expectedAudience)) {
            return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Invalid audience", null)
            );
        }

        String tenant = jwt.getClaimAsString("tenant_id");
        if (tenant == null || tenant.isBlank()) {
            return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Missing tenant", null)
            );
        }

        return OAuth2TokenValidatorResult.success();
    }
}
```

Important: validator should reject missing claims. Do not silently default.

## 9.3 Mapping JWT to Distributed Principal

```java
record AuthenticatedRequestActor(
    String subject,
    String tenantId,
    String issuer,
    List<String> audience,
    String clientId,
    Set<String> scopes,
    String tokenId
) {
    static AuthenticatedRequestActor from(Jwt jwt) {
        return new AuthenticatedRequestActor(
            jwt.getSubject(),
            jwt.getClaimAsString("tenant_id"),
            jwt.getIssuer().toString(),
            jwt.getAudience(),
            jwt.getClaimAsString("client_id"),
            Set.copyOf(jwt.getClaimAsStringList("scope")),
            jwt.getId()
        );
    }
}
```

Real implementation must handle claim shape differences:

- `scope` as string
- `scp` as array
- `azp`
- `client_id`
- `preferred_username`
- `groups`
- `roles`
- realm-specific claims

## 9.4 Outbound Token Relay

Avoid hidden global magic. Make outbound identity explicit.

Bad:

```java
restTemplate.getForObject(url, Response.class);
```

Better:

```java
DownstreamCallContext context = DownstreamCallContext.onBehalfOf(currentActor)
    .audience("document-service")
    .requiredScope("document.attach")
    .correlationId(correlationId);

documentClient.attachDocument(context, command);
```

Then your client can choose:

1. relay existing token,
2. exchange token,
3. use service credential,
4. reject because no safe credential exists.

## 9.5 Avoid Blind Token Forwarding Interceptor

Anti-pattern:

```java
String token = SecurityContextHolder.getContext()
    .getAuthentication()
    .getCredentials()
    .toString();

request.addHeader("Authorization", "Bearer " + token);
```

Why dangerous:

1. Assumes credentials contain raw token.
2. Relays token to any destination.
3. Ignores audience.
4. Ignores scope.
5. Might leak token to wrong host.
6. Breaks principle of least privilege.

Better:

```java
BearerToken token = tokenStrategy.issueFor(
    DownstreamAudience.DOCUMENT_SERVICE,
    RequiredScope.DOCUMENT_ATTACH,
    currentSecurityContext
);
```

The token strategy makes the architecture explicit.

---

## 10. Service-to-Service Authentication Models

## 10.1 OAuth2 Client Credentials

Used when service acts as itself.

```text
service-a -> AS using client credentials
AS -> access token for service-a to call service-b
service-a -> service-b with token
```

Good for:

1. machine-to-machine APIs,
2. scheduled jobs,
3. platform services,
4. no user context,
5. clear service identity.

Risk:

1. client secret theft,
2. overprivileged service account,
3. shared client ID,
4. no user-level audit if misused.

## 10.2 Private Key JWT

Instead of shared secret, client authenticates to authorization server by signing assertion with private key.

Good for:

1. high-trust service clients,
2. avoiding static shared secret,
3. easier key rotation with JWKS,
4. stronger non-repudiation semantics.

## 10.3 mTLS Client Authentication

Service proves identity with certificate during TLS handshake.

Good for:

1. service mesh,
2. partner API,
3. certificate-bound token,
4. zero-trust internal network.

## 10.4 HMAC Request Signing

Good for:

1. partner APIs,
2. webhook verification,
3. non-OAuth integrations,
4. payload integrity.

But HMAC is harder to operate at scale because shared secrets must be stored on both sides.

## 10.5 Internal Signed JWT

Some systems issue internal JWTs for service-to-service calls.

Good if:

1. issued by trusted internal STS,
2. short-lived,
3. audience-specific,
4. has key rotation,
5. validated by every service.

Bad if:

1. every service can mint its own trusted token,
2. keys are shared broadly,
3. `aud` ignored,
4. token lifetime long.

---

## 11. Message-Driven and Async Authentication

## 11.1 Why Async Breaks Authentication Assumptions

HTTP request has a live caller.

Queue message does not.

```text
At T1: Alice requests operation.
At T2: Worker processes event.
At T3: Retry happens after Alice logout.
At T4: Worker replays dead-letter event.
```

Question:

> Is Alice still the actor at T4?

The correct answer depends on business semantics.

## 11.2 Actor Continuation vs New System Action

### Actor Continuation

Use when async work is a direct continuation of user request.

Example:

```text
Alice submits application.
System asynchronously generates document.
```

Audit:

```text
initiatedBy = Alice
executedBy  = document-worker
mode        = async_continuation
```

### New System Action

Use when worker is acting independently.

Example:

```text
Nightly job closes expired draft applications.
```

Audit:

```text
initiatedBy = system-scheduler
executedBy  = expiry-worker
mode        = system_policy
```

## 11.3 Event Authentication

An event should be authenticated at least by:

1. broker-level producer authentication,
2. source service identity,
3. message integrity where needed,
4. schema validation,
5. idempotency key,
6. correlation id,
7. actor envelope.

## 11.4 Do Not Put Bearer Tokens in Messages by Default

Putting access token inside queue message is often dangerous because:

1. token may expire before processing,
2. token may be logged/stored,
3. DLQ may retain secret,
4. replay risk increases,
5. worker may misuse token,
6. logout/revocation semantics become unclear.

Better:

```text
message carries actor intent and command metadata;
worker authenticates as worker/service;
worker authorizes based on persisted command/intention/business state.
```

## 11.5 When Token in Message Is Acceptable

Rarely acceptable if:

1. token is short-lived,
2. message is processed immediately,
3. broker storage is encrypted,
4. no DLQ retention of secrets,
5. token is sender-constrained,
6. replay is prevented,
7. strong audit exists.

But most enterprise systems should avoid it.

---

## 12. Confused Deputy in Microservices

## 12.1 Definition

Confused deputy occurs when a privileged component is tricked into using its authority for another actor.

Example:

```text
User has access to Service A.
Service A has broad access to Service B.
User tricks Service A to request Service B resource user should not access.
```

## 12.2 Example

```text
Alice can call report-service.
report-service can call document-service with broad service credential.
Alice requests report for document she cannot access.
report-service fetches document using service credential.
```

If document-service only sees:

```text
caller = report-service
```

then Alice bypasses access control.

## 12.3 Prevention

1. Pass original actor context.
2. Use token exchange with reduced scope.
3. Downstream validates user entitlement.
4. Service credential must not bypass user-specific controls unless explicitly allowed.
5. Use audience-specific tokens.
6. Audit immediate caller and original actor.
7. Separate system operations from user-delegated operations.

---

## 13. Gateway and Header Trust

## 13.1 Dangerous Headers

Be careful with:

```text
X-User-Id
X-User-Roles
X-Tenant-Id
X-Forwarded-For
X-Original-User
X-Auth-Request-User
X-Client-Cert
```

These headers are just bytes unless protected by a trust boundary.

## 13.2 Header Trust Rules

A service may trust gateway headers only if:

1. Request comes from verified gateway identity.
2. Direct external access is impossible.
3. Gateway strips incoming spoofed headers.
4. Gateway recreates headers after authentication.
5. Header schema is versioned.
6. Service rejects requests without trusted source proof.
7. Sensitive headers are not logged casually.

## 13.3 Signed Header Alternative

Gateway can sign identity envelope:

```text
X-Identity-Envelope: base64(json)
X-Identity-Signature: HMAC/RSA signature
X-Identity-Key-Id: gateway-key-2026-06
```

Service validates signature before trusting envelope.

This can be useful for legacy migration but should not become a weaker reimplementation of JWT.

---

## 14. Authorization Server and STS Placement

## 14.1 Central Authorization Server

Common model:

```text
All services trust central AS/IdP.
```

Pros:

1. consistent issuance,
2. centralized key rotation,
3. token exchange,
4. revocation/introspection,
5. audit of token issuance.

Cons:

1. availability dependency,
2. latency,
3. operational bottleneck,
4. blast radius if compromised.

## 14.2 Internal Security Token Service

Large systems may use internal STS:

```text
External IdP -> Edge token
Internal STS -> service-specific internal token
```

Good when:

1. external IdP claims are not suitable internally,
2. multi-tenant mapping is complex,
3. downstream services need normalized claims,
4. internal audience/scope model differs,
5. token exchange should be controlled centrally.

## 14.3 STS Failure Mode

If STS unavailable:

1. new downstream tokens cannot be issued,
2. existing cached tokens may continue,
3. high-risk operations may fail closed,
4. low-risk read operations may use bounded stale cache if policy allows,
5. audit must mark degraded mode.

Never silently fail open.

---

## 15. Observability and Audit Model

## 15.1 Authentication Decision Log

Every service boundary should log authentication decision safely:

```json
{
  "event": "authn.accepted",
  "service": "document-service",
  "issuer": "https://idp.example.com/realms/main",
  "audience": "document-service",
  "subject": "user-123",
  "clientId": "case-service",
  "tenantId": "agency-a",
  "tokenIdHash": "sha256:...",
  "correlationId": "corr-123"
}
```

Do not log raw tokens.

## 15.2 Rejection Log

```json
{
  "event": "authn.rejected",
  "service": "document-service",
  "reason": "invalid_audience",
  "issuer": "https://idp.example.com/realms/main",
  "presentedAudience": "case-service",
  "expectedAudience": "document-service",
  "correlationId": "corr-123"
}
```

## 15.3 Audit Actor Fields

For business audit:

```text
business_event_id
business_action
resource_type
resource_id
original_actor_type
original_actor_id
immediate_caller_type
immediate_caller_id
execution_mode
tenant_id
correlation_id
authn_method
authn_assurance
token_issuer
token_audience
decision
reason
```

## 15.4 Avoid Token Leakage in Logs

Never log:

- `Authorization` header,
- access token,
- refresh token,
- ID token,
- session ID,
- cookie value,
- private key,
- HMAC secret,
- signed SAML assertion raw XML unless sanitized.

---

## 16. Failure Modes

## 16.1 Missing Audience Validation

Symptom:

```text
Any valid token from issuer accepted by any service.
```

Impact:

- token substitution,
- lateral movement,
- privilege confusion.

Fix:

- validate `aud` per service,
- issue per-service tokens,
- reject missing audience.

## 16.2 Gateway Header Spoofing

Symptom:

```text
Attacker sends X-User-Id header directly to service.
```

Fix:

- block direct access,
- mTLS gateway-to-service,
- strip/recreate headers,
- signed identity envelope.

## 16.3 Overprivileged Service Account

Symptom:

```text
service-a can call every downstream API with admin-like scope.
```

Fix:

- service-specific client,
- scope minimization,
- audience-specific token,
- rotate credentials,
- audit client usage.

## 16.4 Lost Actor in Async Worker

Symptom:

```text
Worker updates data as system, but business expected user-initiated audit.
```

Fix:

- event actor envelope,
- execution mode,
- correlation id,
- command persistence.

## 16.5 Blind Token Relay

Symptom:

```text
Authorization header copied to every outbound call.
```

Fix:

- outbound token strategy,
- token exchange,
- audience validation,
- allowlist downstream destinations.

## 16.6 JWKS/Key Rotation Breakage

Symptom:

```text
Services reject new tokens after key rotation.
```

Fix:

- JWKS cache refresh,
- overlapping old/new keys,
- monitor `kid` failures,
- emergency rollback key policy.

## 16.7 Identity Context Leakage

Symptom:

```text
Request B sees principal from Request A.
```

Common in:

- ThreadLocal misuse,
- executor reuse,
- async callbacks,
- Reactor context misuse,
- virtual thread assumptions.

Fix:

- clear context,
- explicit context passing,
- framework-supported delegation wrappers,
- scoped context patterns.

---

## 17. Security Risks

## 17.1 Token Substitution

A token valid for one service is accepted by another.

Control:

- audience validation,
- issuer validation,
- token type validation,
- scope validation.

## 17.2 Replay

Captured token/request is reused.

Control:

- short token lifetime,
- sender-constrained token,
- mTLS,
- nonce/timestamp for HMAC,
- jti replay cache for high-risk operations.

## 17.3 Lateral Movement

Compromised service credential allows moving across internal services.

Control:

- per-service credentials,
- mTLS identity,
- least privilege,
- network policy,
- token audience,
- workload identity.

## 17.4 Confused Deputy

Service uses its authority for user who should not have access.

Control:

- delegation token,
- actor context,
- downstream entitlement check,
- service credential separation.

## 17.5 Claim Injection

Gateway/service injects claim that downstream trusts blindly.

Control:

- signed token,
- signed envelope,
- trusted source verification,
- claim normalization.

## 17.6 Token Leakage in Traces

Authorization header appears in logs/APM/traces.

Control:

- header redaction,
- logging filter,
- secure telemetry pipeline,
- secret scanning.

---

## 18. Production Checklist

## 18.1 Service Boundary Checklist

For every service endpoint:

- [ ] Does it require authentication?
- [ ] What credential types are accepted?
- [ ] Is issuer validated?
- [ ] Is audience validated?
- [ ] Is expiration validated?
- [ ] Is token type validated?
- [ ] Is tenant validated?
- [ ] Are scopes/permissions validated?
- [ ] Is immediate caller known?
- [ ] Is original actor known if relevant?
- [ ] Are invalid tokens rejected fail-closed?
- [ ] Are auth failures logged safely?

## 18.2 Outbound Call Checklist

For every downstream call:

- [ ] Is this call user-delegated or service-owned?
- [ ] Is token relay allowed?
- [ ] Is token exchange required?
- [ ] Is audience correct?
- [ ] Is scope reduced?
- [ ] Is token cached safely?
- [ ] Is destination allowlisted?
- [ ] Is correlation propagated?
- [ ] Are tokens redacted from logs?

## 18.3 Async Checklist

For every event/message:

- [ ] Who produced the message?
- [ ] How is producer authenticated?
- [ ] Is actor context included?
- [ ] Is actor context trusted or merely informational?
- [ ] Is message integrity needed?
- [ ] Are secrets absent from payload?
- [ ] What happens on replay?
- [ ] What happens after actor account disabled?
- [ ] What is audit execution mode?

## 18.4 Gateway Checklist

- [ ] Are incoming spoofed identity headers stripped?
- [ ] Is gateway-to-service authenticated?
- [ ] Are services unreachable except through approved paths?
- [ ] Are identity headers signed or otherwise protected?
- [ ] Is TLS terminated intentionally?
- [ ] Is client certificate forwarded safely if needed?
- [ ] Are raw tokens hidden from browser when BFF is used?

## 18.5 Credential Lifecycle Checklist

- [ ] Per-service credential?
- [ ] Per-environment credential?
- [ ] Rotation schedule?
- [ ] Emergency revocation?
- [ ] Secret storage?
- [ ] No shared service account?
- [ ] No static token in config?
- [ ] No token in queue/log?

---

## 19. Common Mistakes

## 19.1 Treating Gateway Authentication as Universal Authentication

Gateway authentication is important but not enough.

Internal services still need clear trust rules.

## 19.2 Accepting Any Token From Trusted Issuer

Valid issuer alone is not enough.

You must validate audience and intended use.

## 19.3 Copying Authorization Header Everywhere

Blind forwarding is convenient but dangerous.

Credential propagation must be deliberate.

## 19.4 Using Service Account for User Operation

If downstream operation depends on user entitlement, do not hide behind broad service account.

## 19.5 Trusting `X-User-Id` Without Source Proof

Headers are not authentication.

## 19.6 Putting Access Tokens in Kafka/RabbitMQ Messages

Message queues retain, retry, dead-letter, and replay. Treat them as persistent systems, not transient pipes.

## 19.7 Losing Actor in Batch Jobs

Scheduled/system jobs require their own actor model.

## 19.8 Ignoring Logout/Revocation Semantics

JWT relay with long TTL may keep access alive after user logout or disablement.

## 19.9 Not Separating Tenant From User

In multi-tenant systems:

```text
sub = user-123
```

is not enough.

Need:

```text
tenant_id = agency-a
issuer    = tenant-specific or trusted mapping
```

## 19.10 Treating mTLS as Business Authorization

mTLS authenticates workload/channel. It does not decide whether Alice may approve Case 123.

---

## 20. Design Questions

Use these questions when reviewing a microservice authentication design.

### 20.1 Actor Questions

1. Who is the original actor?
2. Who is the immediate caller?
3. Is the action user-initiated, service-owned, or system-scheduled?
4. Is there admin impersonation?
5. Is delegation explicit?

### 20.2 Token Questions

1. Who issued the token?
2. Who is the token intended for?
3. What scopes are present?
4. Is the token bearer or sender-constrained?
5. Is it relay token or exchanged token?
6. How long does it live?
7. How is it revoked?
8. Is it logged anywhere?

### 20.3 Service Questions

1. Does the service authenticate every inbound request?
2. Does it reject wrong audience?
3. Does it know caller service identity?
4. Does it trust gateway headers? Why?
5. Does it perform business authorization locally?
6. Does it propagate actor context correctly?

### 20.4 Async Questions

1. Does the event carry actor context?
2. Is the event signed or produced by authenticated producer?
3. Is replay safe?
4. Is retry safe?
5. What happens if the original user is disabled before processing?
6. What does audit show?

### 20.5 Failure Questions

1. What happens if IdP is down?
2. What happens if JWKS rotation breaks?
3. What happens if STS is slow?
4. What happens if token introspection times out?
5. Is fail-open ever allowed?
6. Are degraded modes visible?

---

## 21. Practical Reference Architectures

## 21.1 Internal Enterprise Web Platform

```text
Browser -> BFF/Gateway -> Services -> Queue -> Workers
```

Recommended:

1. Browser uses session cookie with BFF.
2. BFF holds tokens server-side.
3. Services validate audience-specific JWT or opaque token.
4. Service-to-service uses token exchange or service credential.
5. Async events carry actor envelope, not raw access token.
6. Audit records original actor and executor.

## 21.2 Public API Platform

```text
External Client -> API Gateway -> Resource Service
```

Recommended:

1. External client authenticates using OAuth2 client credentials, mTLS, HMAC, or API key depending risk.
2. Gateway validates coarse access.
3. Resource service validates token/audience or trusted signed identity envelope.
4. Per-client rate limiting.
5. Per-client audit and revocation.

## 21.3 Service Mesh Platform

```text
Service A -> Sidecar -> mTLS -> Sidecar -> Service B
```

Recommended:

1. Mesh mTLS authenticates workload.
2. Application token carries user/delegation context.
3. Service B validates both workload and token.
4. Mesh policy handles coarse communication allowlist.
5. App handles business authorization.

## 21.4 Event-Driven Case Management System

```text
Officer -> Case Service -> Event Bus -> Document Worker -> Notification Service
```

Recommended:

1. Case Service validates officer token/session.
2. Case Service persists command with actor context.
3. Event contains command ID and actor envelope.
4. Worker authenticates as worker service.
5. Worker loads command and verifies state.
6. Worker audit: initiated by officer, executed by worker.

---

## 22. Advanced Invariants

These invariants should hold in a strong design.

### Invariant 1 — No Service Accepts a Token Not Intended for It

```text
token.aud must contain current service audience
```

### Invariant 2 — Immediate Caller Is Not the Same as Original Actor

```text
caller != actor unless request is direct
```

### Invariant 3 — Service Credential Cannot Silently Override User Authorization

```text
system privilege must not bypass user entitlement accidentally
```

### Invariant 4 — Async Execution Must Declare Its Actor Mode

```text
USER_CONTINUATION vs SYSTEM_ACTION must be explicit
```

### Invariant 5 — Identity Headers Are Trusted Only Across Protected Boundaries

```text
headers need source proof
```

### Invariant 6 — Token Propagation Is a Design Decision

```text
no blind global Authorization forwarding
```

### Invariant 7 — Authentication Failure Must Be Visible

```text
reject safely, log safely, alert appropriately
```

---

## 23. Summary

Authentication in microservices and distributed Java systems is not a simple continuation of login.

It is a design problem involving:

1. **Edge authentication** for external clients.
2. **Internal authentication** for service-to-service calls.
3. **Workload identity** for service, worker, scheduler, and jobs.
4. **Original actor identity** for user accountability.
5. **Audience validation** to prevent token substitution.
6. **Token exchange** to reduce privilege and encode delegation.
7. **mTLS/service mesh** for transport-level workload proof.
8. **Actor envelope** for async/event-driven flows.
9. **Audit model** that distinguishes user, service, system, worker, and impersonation.
10. **Failure modeling** for IdP, STS, JWKS, introspection, propagation, and replay.

The senior-level shift is this:

> Do not ask only “how do I authenticate this request?”  
> Ask “what identity proof crosses this boundary, what authority is delegated, what actor is accountable, and how can the next service independently verify it?”

---

## 24. Sumber Referensi

- Spring Security Reference — OAuth2 Resource Server JWT and audience validation.
- Spring Security Reference — Servlet authentication architecture.
- RFC 8693 — OAuth 2.0 Token Exchange.
- RFC 9700 — OAuth 2.0 Security Best Current Practice.
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.
- NIST SP 800-204A — Building Secure Microservices-based Applications Using Service Mesh Architecture.
- OWASP API Security Top 10 2023.
- OWASP Microservices Security / REST Security / JWT guidance.
- OpenID Connect Core 1.0.
- Jakarta Security and Spring Security documentation for Java integration context.

---

## 25. Status Series

- Part 0–27 selesai.
- Series belum selesai.
- Berikutnya: **Part 28 — Authentication for Messaging, Jobs, and Event-Driven Java Systems**.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-026.md">⬅️ Part 26 — Multi-Tenant Authentication Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-028.md">Part 28 — Authentication for Messaging, Jobs, and Event-Driven Java Systems ➡️</a>
</div>
