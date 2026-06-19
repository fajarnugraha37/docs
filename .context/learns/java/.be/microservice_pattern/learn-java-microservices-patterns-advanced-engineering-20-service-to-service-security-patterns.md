# learn-java-microservices-patterns-advanced-engineering
# Part 20 — Service-to-Service Security Patterns

> Seri: Java Microservices Pattern — Advanced Engineering  
> File: `learn-java-microservices-patterns-advanced-engineering-20-service-to-service-security-patterns.md`  
> Status: Part 20 dari 35 — seri belum selesai  
> Target: Java 8 sampai Java 25  
> Fokus: service identity, trust boundary, mTLS, OAuth2 client credentials, token propagation, token exchange, PDP/PEP, service authorization, secret rotation, certificate rotation, audit identity, dan failure mode security antar microservice.

---

## 0. Tujuan Part Ini

Setelah mempelajari bagian ini, tujuan utamanya bukan sekadar tahu bahwa microservices bisa memakai JWT, OAuth2, mTLS, atau API Gateway.

Target sebenarnya adalah mampu menjawab pertanyaan arsitektural berikut:

1. **Service A boleh memanggil Service B karena apa?**
2. **Identitas yang dipakai adalah identitas user, service, workload, client application, atau delegation chain?**
3. **Token yang diterima Service B memang dibuat untuk Service B, atau token itu kebetulan valid secara kriptografis tetapi salah audience?**
4. **Apakah authorization dilakukan di gateway saja, di setiap service, atau di policy engine terpisah?**
5. **Bagaimana sistem membedakan aksi yang dilakukan oleh user langsung, service otomatis, scheduled job, retry worker, workflow engine, atau admin operation?**
6. **Apa yang terjadi saat certificate expired, JWKS berubah, token issuer berubah, secret bocor, service mesh salah konfigurasi, atau clock antar node drift?**
7. **Bagaimana security decision bisa diaudit dan dipertanggungjawabkan dalam sistem enterprise/regulatory?**

Microservices security bukan hanya “pasang token di header”. Itu adalah desain eksplisit tentang **identity, trust, authority, delegation, policy, isolation, observability, and recovery**.

---

## 1. Mental Model: Security Antar Service Adalah Masalah Trust Boundary

Dalam monolith, banyak call terjadi di memory process yang sama. Method `approveApplication()` memanggil `auditService.record()` tanpa melewati network boundary. Security biasanya terjadi di edge: user login, session dibuat, lalu application code melakukan authorization internal.

Dalam microservices, call antar komponen melewati network. Setiap hop membuka pertanyaan baru:

```text
User / System Actor
        |
        v
API Gateway / BFF
        |
        v
Service A
        |
        v
Service B
        |
        v
Service C
```

Pada setiap panah, sistem harus menjawab:

```text
Who is calling?
Who is the original user, if any?
Which service is acting?
What authority is being delegated?
What resource is being accessed?
What policy applies?
Can this request be replayed?
Can this token be used here?
Can this identity be forged?
Can this decision be audited?
```

Security dalam microservices adalah **distributed authorization problem**, bukan hanya authentication problem.

---

## 2. Prinsip Zero Trust untuk Microservices

Pendekatan tradisional sering menganggap bahwa traffic internal cluster aman. Ini premis yang lemah.

Microservices modern sebaiknya memakai prinsip:

```text
Do not trust a request only because it comes from internal network.
Authenticate every workload.
Authorize every operation.
Constrain every token.
Audit every meaningful decision.
Rotate every credential.
Assume compromise is possible.
```

NIST SP 800-207 mendefinisikan Zero Trust Architecture sebagai pendekatan yang menggeser pertahanan dari perimeter jaringan statis menuju fokus pada user, asset, dan resource. Dalam microservices, ini berarti service internal tetap dianggap melewati trust boundary, bukan otomatis trusted hanya karena berada di VPC, subnet, namespace, atau cluster yang sama. Referensi: NIST SP 800-207 — Zero Trust Architecture, https://csrc.nist.gov/pubs/sp/800/207/final.

### Implikasi Praktis

| Area | Pendekatan Lemah | Pendekatan Lebih Kuat |
|---|---|---|
| Network | “Internal network aman” | Authenticate service/workload |
| Token | “JWT valid berarti boleh” | Validate issuer, audience, expiry, scope, subject, tenant |
| Gateway | Semua auth di gateway | Gateway + service-level enforcement |
| Service | Trust header dari upstream | Verify trusted source atau signed context |
| Secret | Static secret lama | Short-lived credential + rotation |
| Audit | Log endpoint hit | Log actor, service, policy, decision, resource, correlation |

---

## 3. Identity Taxonomy: Jangan Campur User, Service, dan Workload

Salah satu sumber bug security terbesar adalah mencampur berbagai jenis identity.

### 3.1 User Identity

User identity menjawab:

```text
Manusia mana yang meminta aksi ini?
```

Contoh:

```text
sub = user-12345
type = human_user
roles = [case_officer]
agencies = [CEA]
```

User identity biasanya berasal dari login flow: OIDC Authorization Code + PKCE, enterprise SSO, Singpass/Corppass-like IdP, atau internal identity provider.

### 3.2 Service Identity

Service identity menjawab:

```text
Aplikasi/service mana yang memanggil?
```

Contoh:

```text
client_id = application-service
service = application-management
```

Service identity biasanya dipakai pada OAuth2 client credentials, mTLS client certificate, SPIFFE ID, Kubernetes service account identity, atau workload identity provider.

### 3.3 Workload Identity

Workload identity lebih runtime-specific:

```text
Instance/pod/workload mana yang sedang menjalankan service ini?
```

Contoh:

```text
spiffe://prod.example.gov/ns/aceas/sa/application-service
```

SPIFFE/SPIRE mendesain identitas workload berbasis SVID, termasuk X.509-SVID yang dapat dipakai untuk mTLS dan credential yang short-lived/rotated. Referensi: SPIRE Use Cases, https://spiffe.io/docs/latest/spire-about/use-cases/.

### 3.4 System Actor Identity

System actor menjawab:

```text
Apakah aksi ini dilakukan oleh scheduled job, workflow engine, retry worker, migration job, atau integration adapter?
```

Contoh:

```text
actor_type = system
actor_id = renewal-expiry-scheduler
initiated_by = scheduler
```

Ini penting karena banyak aksi sistem tidak memiliki user langsung.

### 3.5 Delegated Identity

Delegated identity menjawab:

```text
Service ini bertindak atas nama siapa, dengan batasan apa?
```

Contoh:

```text
original_user = officer-123
calling_service = application-service
delegation_reason = user_action
allowed_audience = document-service
allowed_operation = read_application_documents
```

Delegation tidak boleh diartikan sebagai “forward token user ke semua service”. Delegation harus dibatasi oleh audience, scope, expiry, dan policy.

---

## 4. Authentication vs Authorization vs Audit

Tiga hal ini sering dicampur.

### 4.1 Authentication

Authentication menjawab:

```text
Apakah caller benar seperti yang diklaim?
```

Contoh:

- Validasi mTLS certificate.
- Validasi JWT signature.
- Validasi client credentials.
- Validasi SPIFFE ID.

### 4.2 Authorization

Authorization menjawab:

```text
Apakah caller boleh melakukan aksi ini terhadap resource ini pada kondisi ini?
```

Contoh:

```text
User officer-123 boleh approve application A-1001?
Service case-service boleh mengambil risk snapshot dari screening-service?
Scheduler boleh auto-expire renewal application?
```

### 4.3 Audit

Audit menjawab:

```text
Siapa melakukan apa, terhadap resource apa, kapan, lewat service mana, berdasarkan policy apa, dengan hasil apa?
```

Audit bukan pengganti authorization. Audit adalah bukti bahwa authorization dan action dilakukan secara defensible.

---

## 5. Service-to-Service Authentication Patterns

## 5.1 Network-Level Allowlist

Pattern paling sederhana:

```text
Service B hanya menerima traffic dari IP/subnet/security group tertentu.
```

Kelebihan:

- mudah dimulai
- berguna sebagai outer control
- bisa mengurangi exposure

Kelemahan:

- IP/pod/node tidak cukup sebagai identity
- sulit pada autoscaling/dynamic scheduling
- tidak membuktikan service identity
- raw network access bisa disalahgunakan jika workload compromised

Gunakan ini sebagai **defense layer**, bukan identity utama.

---

## 5.2 Static Shared Secret

Pattern:

```text
Service A mengirim X-Internal-Secret: abc
Service B memvalidasi secret tersebut.
```

Ini sering muncul di sistem lama.

Masalah:

- secret tersebar di banyak service
- rotasi sulit
- tidak granular per caller
- jika bocor, semua caller bisa impersonate
- tidak cocok untuk audit identity

Masih bisa dipakai untuk integration sederhana, tetapi bukan pola ideal untuk platform microservices enterprise.

---

## 5.3 OAuth2 Client Credentials

Pattern:

```text
Service A authenticate ke Authorization Server sebagai client.
Authorization Server mengeluarkan access token.
Service A memanggil Service B dengan access token.
Service B memvalidasi token.
```

Flow:

```text
Service A
  -> POST /token grant_type=client_credentials
  <- access_token

Service A
  -> Service B Authorization: Bearer <token>
```

Cocok untuk:

- machine-to-machine API
- scheduled job
- backend integration
- system actor tanpa user langsung

Perhatian:

- token harus punya `audience` untuk target service/API
- scope harus minimal
- expiry pendek
- client secret harus rotated
- jangan reuse token lintas audience
- jangan pakai client credentials untuk mewakili user

OAuth 2.0 Security Best Current Practice RFC 9700 memperbarui dan memperluas guidance keamanan OAuth 2.0 berdasarkan pengalaman praktis sejak RFC awal, termasuk mode operasi yang lebih lemah atau tidak aman. Referensi: RFC 9700, https://datatracker.ietf.org/doc/rfc9700/.

---

## 5.4 mTLS Antar Service

Pattern:

```text
Service A dan Service B saling memvalidasi certificate saat TLS handshake.
```

mTLS memberi dua hal:

1. encrypted channel
2. client authentication

OAuth 2.0 mTLS RFC 8705 menjelaskan client authentication dan certificate-bound tokens menggunakan mutual TLS dengan X.509 certificates. Referensi: RFC 8705, https://datatracker.ietf.org/doc/html/rfc8705.

Cocok untuk:

- high-security service-to-service call
- service mesh
- regulated environment
- token binding
- internal APIs dengan trust boundary kuat

Kelebihan:

- caller identity berbasis certificate
- tidak hanya bearer token
- cocok untuk workload identity
- bisa dipadukan dengan OAuth token

Risiko:

- certificate lifecycle kompleks
- expired cert bisa menyebabkan outage besar
- misconfigured trust store bisa membuka akses salah
- certificate identity harus dipetakan ke policy yang benar

---

## 5.5 SPIFFE/SPIRE Workload Identity

Pattern:

```text
Workload mendapatkan identity cryptographic short-lived dari platform.
Identity dipakai untuk mTLS atau token-based auth.
```

Contoh identity:

```text
spiffe://example.org/ns/payments/sa/payment-api
```

Kekuatan pattern ini adalah identitas tidak bergantung pada IP, hostname, atau static secret. Identity diikat ke workload/runtime attributes.

Cocok untuk:

- multi-cluster
- multi-cloud
- service mesh
- workload identity yang portable
- short-lived credential
- zero-trust service mesh

SPIRE dirancang untuk attestation workload identity dan delivery short-lived automatically rotated keys/certificates untuk mTLS. Referensi: SPIRE Use Cases, https://spiffe.io/docs/latest/spire-about/use-cases/.

---

## 6. Token Propagation Patterns

Masalah besar di microservices:

```text
User login ke Gateway.
Gateway memanggil Service A.
Service A memanggil Service B.
Service B memanggil Service C.
```

Token apa yang dipakai di setiap hop?

---

## 6.1 Forward Original User Token

Pattern:

```text
Gateway menerima user token.
Service A meneruskan token yang sama ke Service B.
```

Kelebihan:

- sederhana
- downstream tahu user asli
- mudah untuk user-level authorization

Bahaya:

- token mungkin audience-nya hanya untuk gateway/service A
- downstream terlalu banyak menerima privilege
- token replay risk
- semua service perlu memahami token eksternal
- sulit membatasi delegation

Gunakan hanya jika token memang dirancang untuk multi-resource audience dan policy-nya jelas. Dalam banyak sistem enterprise, ini terlalu longgar.

---

## 6.2 Token Relay dengan Audience Validation

Pattern yang lebih aman:

```text
Service menerima token.
Service hanya menerima token jika audience cocok.
```

Minimal validation:

```text
issuer valid
signature valid
expiry valid
not-before valid
audience contains this service/API
subject valid
scope/permission valid
tenant valid
```

JWT Best Current Practices RFC 8725 memberi guidance keamanan implementasi dan deployment JWT. Referensi: RFC 8725, https://datatracker.ietf.org/doc/html/rfc8725.

### Contoh Kesalahan Fatal

```text
JWT signature valid.
issuer valid.
expiry valid.
audience = frontend-api.
Service B tetap menerima.
```

Ini salah. Token yang valid secara kriptografis belum tentu valid untuk service tersebut.

---

## 6.3 Token Exchange

Pattern:

```text
Service A menukar token yang diterima menjadi token baru untuk Service B.
```

Flow:

```text
User Token for Service A
        |
        v
Service A asks Authorization Server:
  Exchange this token for a narrower token for Service B
        |
        v
Access Token for Service B
```

OAuth 2.0 Token Exchange RFC 8693 mendefinisikan protokol untuk meminta dan mendapatkan security token dari authorization server, termasuk skenario impersonation dan delegation. Referensi: RFC 8693, https://datatracker.ietf.org/doc/html/rfc8693.

Kelebihan:

- audience bisa dipersempit
- scope bisa dipersempit
- delegation explicit
- downstream tidak perlu menerima token upstream langsung
- audit chain lebih jelas

Cocok untuk:

- service-to-service delegation
- regulated workflows
- cross-domain API
- system yang perlu membedakan original user dan calling service

---

## 6.4 Service Token + User Context Header

Pattern:

```text
Service A authenticate ke Service B sebagai service.
User context dikirim sebagai signed/trusted context.
```

Contoh:

```text
Authorization: Bearer <service-token-for-B>
X-User-Context: <signed-context>
```

Bahaya jika header tidak signed/trusted:

```text
X-User-Id: admin
```

Header semacam itu mudah dipalsukan jika tidak ada trust boundary yang ketat.

Jika memakai user context header, pastikan:

- hanya trusted upstream boleh menulis header
- gateway/service menghapus incoming spoofed header
- context signed atau berada dalam authenticated channel
- downstream tahu mana identity caller dan mana original actor

---

## 7. Authorization Patterns Antar Service

## 7.1 Edge-Only Authorization

Pattern:

```text
Gateway memutuskan semua authorization.
Internal service percaya gateway.
```

Kelebihan:

- sederhana
- central enforcement
- cocok untuk coarse-grained API access

Kelemahan:

- internal calls bisa bypass policy jika network terbuka
- gateway tidak selalu tahu object-level rule
- policy domain sering berada di service
- privilege escalation bisa terjadi dari compromised internal service

Gunakan untuk coarse control, bukan satu-satunya enforcement.

---

## 7.2 Service-Level Authorization

Pattern:

```text
Setiap service memvalidasi authorization untuk resource miliknya.
```

Contoh:

```text
Application Service owns application lifecycle.
Only Application Service decides whether actor can approve application A-1001.
```

Kelebihan:

- policy dekat dengan data/resource owner
- object-level authorization lebih akurat
- service tetap aman walau dipanggil dari banyak upstream

Kelemahan:

- policy tersebar
- perlu konsistensi model identity
- sulit governance tanpa standard

Ini biasanya wajib untuk microservices yang serius.

---

## 7.3 PDP/PEP Pattern

Terminologi:

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
PIP = Policy Information Point
PAP = Policy Administration Point
```

Flow:

```text
Service endpoint / method = PEP
Policy engine = PDP
Attributes from DB/cache/context = PIP
Policy management = PAP
```

Contoh:

```text
Can officer-123 approve application A-1001?
Input:
  actor.role = CASE_OFFICER
  actor.agency = CEA
  application.status = PENDING_REVIEW
  application.assignedOfficer = officer-123
  application.riskLevel = NORMAL
  currentTime = 2026-06-19T10:00:00Z
Decision:
  allow = true
  obligations = [record_audit]
```

OPA adalah general-purpose policy engine yang dapat dipakai untuk enforcement policy di microservices, Kubernetes, CI/CD, API gateway, dan area lain. Referensi: Open Policy Agent documentation, https://openpolicyagent.org/docs.

Kelebihan PDP/PEP:

- policy lebih eksplisit
- audit decision lebih baik
- cocok untuk complex authorization
- policy bisa diuji sebagai artifact

Kelemahan:

- network call ke PDP bisa menambah latency
- PDP outage bisa memblokir sistem
- policy/data consistency harus dirancang
- policy terlalu jauh dari domain bisa kehilangan konteks

---

## 7.4 Embedded Policy vs External Policy

| Model | Cocok Untuk | Risiko |
|---|---|---|
| Embedded policy in code | Domain invariant kuat, latency rendah | Policy sulit diubah tanpa deploy |
| External PDP | Enterprise governance, cross-cutting policy | Latency, availability, data freshness |
| Hybrid | Kebanyakan sistem serius | Perlu boundary jelas |

Rule of thumb:

```text
Domain invariant should stay near domain owner.
Cross-cutting access policy can be externalized.
Do not externalize business meaning you do not understand.
```

---

## 8. Audience, Scope, Role, Permission, Claim: Jangan Disamakan

### 8.1 Audience

Audience menjawab:

```text
Token ini ditujukan untuk siapa?
```

Contoh:

```json
{
  "aud": "document-service"
}
```

Jika token audience-nya bukan service ini, service harus menolak.

### 8.2 Scope

Scope menjawab:

```text
Kategori akses apa yang diberikan token?
```

Contoh:

```text
application:read
application:approve
document:read
```

Scope biasanya coarse-grained.

### 8.3 Role

Role menjawab:

```text
User/service memiliki peran organisasi apa?
```

Contoh:

```text
CASE_OFFICER
SUPERVISOR
ADMIN
SYSTEM_SCHEDULER
```

Role bukan keputusan final. Role perlu diterjemahkan menjadi permission pada resource tertentu.

### 8.4 Permission

Permission menjawab:

```text
Aksi spesifik apa yang boleh dilakukan?
```

Contoh:

```text
APPROVE_APPLICATION
VIEW_RESTRICTED_DOCUMENT
ASSIGN_CASE
```

### 8.5 Attribute

Attribute menjawab konteks:

```text
agency = CEA
assignedOfficer = officer-123
riskLevel = HIGH
resourceStatus = PENDING_REVIEW
```

Object-level authorization biasanya membutuhkan attribute.

---

## 9. Common Authorization Models

## 9.1 RBAC

RBAC cocok saat permission relatif stabil berdasarkan role.

```text
CASE_OFFICER -> VIEW_APPLICATION, REVIEW_APPLICATION
SUPERVISOR -> APPROVE_APPLICATION
ADMIN -> MANAGE_CONFIG
```

Kelemahan:

- role explosion
- sulit object-level rule
- sulit context-aware rule

## 9.2 ABAC

ABAC memakai attributes.

```text
allow approve if:
  actor.role == SUPERVISOR
  actor.agency == resource.agency
  resource.status == PENDING_APPROVAL
  resource.riskLevel != HIGH
```

Kelebihan:

- fleksibel
- cocok untuk regulatory dan enterprise

Kelemahan:

- policy bisa sulit dipahami
- membutuhkan attribute freshness
- perlu testing kuat

## 9.3 ReBAC

Relationship-based access control.

Contoh:

```text
Officer boleh melihat case jika officer assigned ke case tersebut.
Manager boleh melihat case jika case berada di team manager tersebut.
```

Cocok untuk:

- collaboration system
- case assignment
- organization hierarchy
- delegated authority

## 9.4 Capability-Based Access

Caller membawa capability spesifik.

```text
capability = approve application A-1001 until 2026-06-19T12:00Z
```

Kuat tetapi implementasinya harus hati-hati.

---

## 10. Service-to-Service Security Architecture Reference

Contoh arsitektur production-grade:

```text
                 +---------------------+
                 | Identity Provider   |
                 | / Authorization     |
                 | Server              |
                 +----------+----------+
                            |
                            v
+---------+        +--------+---------+         +-------------------+
| Browser | -----> | API Gateway/BFF | ------> | Application Svc   |
+---------+        +------------------+         +---------+---------+
                                                        |
                                                        | token exchange
                                                        v
                                                +-------+--------+
                                                | Auth Server    |
                                                +-------+--------+
                                                        |
                                                        v
                                                +-------+--------+
                                                | Document Svc   |
                                                +-------+--------+
                                                        |
                                                        v
                                                +-------+--------+
                                                | Audit Svc      |
                                                +----------------+
```

Security layers:

```text
Edge:
  - TLS
  - user authentication
  - coarse route authorization
  - request header sanitization
  - rate limit

Service-to-service:
  - mTLS or workload identity
  - audience-specific token
  - service-level authorization
  - correlation and audit context

Domain service:
  - resource owner authorization
  - state transition guard
  - invariant enforcement
  - audit event emission
```

---

## 11. Token Validation Checklist

Setiap service yang menerima JWT access token harus memvalidasi minimal:

```text
Signature valid
Issuer trusted
Audience matches this service/API
Expiry not exceeded
Not-before valid
Token type expected
Algorithm allowed
Key id resolves to trusted key
Scope/permission sufficient
Subject/client valid
Tenant/agency context valid
Clock skew bounded
Token not from unexpected environment
```

Kesalahan umum:

```text
Only checking signature.
Ignoring audience.
Accepting alg=none or unexpected alg.
Trusting any JWKS URL from token header.
Using ID Token as access token.
Using access token from frontend directly across all services.
Storing long-lived bearer tokens in logs.
```

OpenID Connect Core menjelaskan ID Token dan sejumlah klaimnya, sedangkan JWT Best Current Practices membahas hardening JWT; keduanya penting karena banyak sistem keliru memakai ID Token seolah-olah access token untuk API. Referensi: OpenID Connect Core 1.0, https://openid.net/specs/openid-connect-core-1_0.html; RFC 8725, https://datatracker.ietf.org/doc/html/rfc8725.

---

## 12. Service Mesh Security: Kuat, Tapi Bukan Pengganti Authorization

Service mesh bisa menyediakan:

- mTLS antar workload
- service identity
- traffic policy
- retries/timeouts
- telemetry
- authorization policy tertentu

Namun mesh tidak otomatis tahu domain rule seperti:

```text
Officer ini boleh approve application ini?
Service ini boleh membaca document yang classified?
Scheduler ini boleh mengubah status case ini pada jam ini?
```

Mesh bagus untuk **transport-level identity and policy**, tetapi domain authorization tetap harus ada di service/domain owner.

Anti-pattern:

```text
Karena sudah pakai mesh mTLS, semua internal API bebas.
```

mTLS menjawab “siapa caller service/workload”. Itu belum cukup untuk menjawab “boleh melakukan apa terhadap resource mana”.

---

## 13. Secret Management Pattern

## 13.1 Secret Types

| Secret | Contoh |
|---|---|
| Client secret | OAuth confidential client secret |
| DB password | credential database |
| API key | external system key |
| Signing key | JWT signing key |
| Encryption key | data encryption key |
| Certificate private key | mTLS identity |

## 13.2 Secret Handling Rules

```text
Do not hardcode secrets.
Do not commit secrets.
Do not log secrets.
Do not expose secrets to browser.
Do not share one secret across many services.
Rotate secrets.
Prefer short-lived credentials.
Apply least privilege.
Audit secret access.
```

## 13.3 Secret Rotation

Rotation harus dirancang sebagai proses normal, bukan incident-only.

Pattern:

```text
1. Add new secret/cert/key.
2. Services can trust both old and new.
3. Roll callers to use new.
4. Verify usage moved.
5. Retire old.
6. Monitor failures.
```

Untuk signing key JWT:

```text
Publish new JWK.
Start signing with new kid.
Keep old JWK until old tokens expire.
Remove old JWK after safety window.
```

---

## 14. Certificate Rotation Pattern

mTLS/certificate-based system sering gagal bukan karena konsepnya buruk, tetapi karena lifecycle buruk.

Failure mode:

```text
Cert expired.
Trust store not updated.
Intermediate CA changed.
Clock drift makes cert not-yet-valid.
Service mesh sidecar uses stale cert.
Certificate identity mapping wrong.
```

Checklist:

```text
Certificates short-lived but auto-rotated.
Expiry monitored.
Trust anchors versioned.
Rotation tested in lower environment.
Emergency revoke path exists.
Service startup validates cert availability.
Cert identity maps to expected service identity.
```

---

## 15. Audit Identity Pattern

Dalam regulated microservices, audit record harus menyimpan identity chain, bukan hanya user id.

Contoh audit envelope:

```json
{
  "auditId": "aud-100001",
  "occurredAt": "2026-06-19T10:15:30Z",
  "action": "APPLICATION_APPROVED",
  "resourceType": "APPLICATION",
  "resourceId": "APP-2026-0001",
  "decision": "ALLOW",
  "actor": {
    "type": "HUMAN_USER",
    "subject": "officer-123",
    "agency": "CEA"
  },
  "caller": {
    "service": "application-service",
    "workloadId": "spiffe://prod.example/ns/aceas/sa/application-service"
  },
  "authorization": {
    "policyId": "application-approval-policy",
    "policyVersion": "2026.06.01",
    "reason": "assigned_supervisor_for_agency"
  },
  "request": {
    "correlationId": "corr-abc",
    "traceId": "trace-xyz"
  }
}
```

Audit answer yang baik:

```text
Who initiated?
Which service executed?
Which policy allowed/denied?
Which resource changed?
What was previous and next state?
What correlation/trace connects distributed calls?
Was this user action, system action, retry, or compensation?
```

---

## 16. Java 8–25 Considerations

## 16.1 Java 8

Java 8 masih umum di legacy enterprise.

Implikasi:

- gunakan mature security libraries
- TLS/JCE setup harus hati-hati
- tidak ada records/sealed classes
- banyak code identity/security context berbasis POJO biasa
- berhati-hati dengan old TLS defaults

## 16.2 Java 11

Java 11 membawa baseline modern untuk banyak enterprise.

Implikasi:

- built-in `java.net.http.HttpClient`
- TLS support lebih modern
- cocok untuk migration baseline

## 16.3 Java 17

Java 17 sering menjadi baseline modern Spring Boot 3/Jakarta modern.

Manfaat:

- records untuk immutable security context
- sealed classes untuk actor model
- stronger encapsulation

Contoh:

```java
public sealed interface Actor permits HumanActor, ServiceActor, SystemActor {
    String id();
}

public record HumanActor(String id, String agency) implements Actor {}
public record ServiceActor(String serviceName, String clientId) implements Actor {}
public record SystemActor(String jobName) implements Actor {}
```

## 16.4 Java 21

Java 21 penting untuk virtual threads dan modern runtime.

Implikasi security:

- virtual threads memudahkan blocking service calls
- tetapi security context propagation harus jelas
- jangan mengandalkan `ThreadLocal` secara sembarangan
- structured concurrency style perlu context propagation design

## 16.5 Java 25

Java 25 adalah latest generation. Untuk microservices security, prinsipnya tetap sama: gunakan language/runtime feature untuk membuat model lebih eksplisit, bukan mengganti security architecture.

Gunakan newer Java untuk:

- immutable context model
- pattern matching untuk decision model
- better runtime ergonomics
- stronger type modeling

Jangan berpikir Java version otomatis membuat security benar. Security correctness tetap berasal dari identity, policy, validation, rotation, and audit design.

---

## 17. Security Context Modeling di Java

Contoh model yang lebih eksplisit:

```java
public record SecurityContext(
        Actor actor,
        Caller caller,
        Tenant tenant,
        Set<Permission> permissions,
        Correlation correlation
) {}

public sealed interface Actor permits HumanUser, ServicePrincipal, SystemPrincipal {}

public record HumanUser(
        String subject,
        String agency,
        Set<String> roles
) implements Actor {}

public record ServicePrincipal(
        String clientId,
        String serviceName,
        String workloadIdentity
) implements Actor {}

public record SystemPrincipal(
        String jobName,
        String reason
) implements Actor {}

public record Caller(
        String serviceName,
        String audience,
        String tokenId
) {}

public record Tenant(String id) {}

public record Correlation(String correlationId, String traceId) {}
```

Design point:

```text
Actor = who initiated semantic action.
Caller = which service technically called this service.
Tenant = isolation context.
Permissions = allowed operations from current token/policy.
Correlation = observability/audit context.
```

Jangan hanya menyimpan:

```java
String userId;
```

Itu terlalu miskin untuk distributed security.

---

## 18. Authorization Guard Example

Contoh domain guard:

```java
public final class ApplicationAuthorization {

    public void requireCanApprove(SecurityContext ctx, Application app) {
        if (!ctx.permissions().contains(Permission.APPROVE_APPLICATION)) {
            throw new ForbiddenException("Missing APPROVE_APPLICATION permission");
        }

        if (ctx.actor() instanceof HumanUser user) {
            if (!user.agency().equals(app.agency())) {
                throw new ForbiddenException("Cross-agency approval is not allowed");
            }
        } else {
            throw new ForbiddenException("Only human supervisor can approve application");
        }

        if (app.status() != ApplicationStatus.PENDING_APPROVAL) {
            throw new ConflictException("Application is not pending approval");
        }
    }
}
```

Important:

- permission check saja tidak cukup
- resource attribute harus dicek
- state harus dicek
- actor type harus dicek
- error harus tidak leak sensitive details

---

## 19. Service-to-Service Call Example

Bad pattern:

```java
request.header("Authorization", incomingUserToken);
```

Masalah:

- audience mungkin salah
- scope terlalu luas
- downstream menerima token yang tidak ditujukan untuknya
- delegation tidak eksplisit

Better pattern:

```java
AccessToken tokenForDocumentService = tokenExchange.exchange(
        incomingToken,
        new TokenExchangeRequest(
                "document-service",
                Set.of("document:read"),
                "read supporting documents for application review"
        )
);

httpClient.send(
        requestBuilder
                .uri(documentServiceUri)
                .header("Authorization", "Bearer " + tokenForDocumentService.value())
                .header("X-Correlation-Id", correlationId)
                .build(),
        BodyHandlers.ofString()
);
```

Even better in regulated systems:

```text
Token exchange is logged.
Downstream validates audience.
Downstream authorizes resource.
Audit record stores original actor and calling service.
```

---

## 20. Threat Model untuk Service-to-Service Security

Minimal threat model:

| Threat | Example | Mitigation |
|---|---|---|
| Token replay | stolen bearer token reused | short expiry, audience, mTLS-bound token, nonce where relevant |
| Header spoofing | fake X-User-Id | strip untrusted headers, signed context, trusted proxy chain |
| Audience confusion | token for A accepted by B | strict audience validation |
| Privilege escalation | service uses broad token | least privilege, token exchange |
| Lateral movement | compromised service calls all services | service-level auth, mTLS identity, network policy |
| Secret leakage | API key in logs | secret scanning, log redaction, rotation |
| JWKS poisoning | trust attacker key | pin issuer/JWKS, do not trust token-provided URL |
| Clock drift | valid token rejected/expired accepted | bounded clock skew, NTP, monitoring |
| Cert expiry | internal outage | expiry alerts, auto rotation |
| Policy drift | gateway and service disagree | policy versioning, tests, audit |
| Tenant leakage | wrong tenant context | tenant validation on every resource access |
| Confused deputy | service uses own privilege for user action | explicit delegation, policy checks |

---

## 21. Confused Deputy Problem

Confused deputy terjadi saat service dengan privilege tinggi menjalankan aksi untuk caller yang sebenarnya tidak punya hak.

Contoh:

```text
User tidak boleh membaca restricted document.
Application Service boleh membaca document.
User meminta Application Service mengambil restricted document.
Application Service memakai service privilege sendiri tanpa cek user authority.
Document bocor.
```

Mitigation:

```text
Separate service privilege from delegated user privilege.
Pass original actor context.
Downstream validates both caller service and delegated actor.
Use token exchange with reduced scope.
Audit decision.
```

Rule:

```text
Service authority is not automatically user authority.
User authority is not automatically service authority.
Delegation must be explicit.
```

---

## 22. Gateway Header Sanitization

Gateway/BFF harus menghapus header sensitif yang datang dari internet sebelum menambahkan trusted headers.

Contoh dangerous headers:

```text
X-User-Id
X-User-Roles
X-Tenant-Id
X-Forwarded-For
X-Internal-Auth
X-Service-Name
```

Rule:

```text
Never trust security headers from untrusted clients.
Only trusted infrastructure may create internal identity headers.
Downstream services must know which proxy chain is trusted.
```

---

## 23. Tenant-Aware Service Security

Jika sistem multi-tenant atau multi-agency, setiap authorization decision harus tenant-aware.

Checklist:

```text
Token contains tenant/agency context.
Resource belongs to tenant/agency.
Actor has relationship to tenant/agency.
Service call preserves tenant context.
Cache key includes tenant.
Message includes tenant.
Audit includes tenant.
Search index filters tenant.
```

Anti-pattern:

```java
repository.findById(applicationId);
```

Better:

```java
repository.findByIdAndTenant(applicationId, ctx.tenant().id());
```

---

## 24. Security Observability

Security observability bukan log semua token. Jangan pernah log raw token.

Log metadata aman:

```text
issuer
audience
subject hash
client_id
token_id/jti if allowed
scope count / scope names if not sensitive
policy_id
policy_version
decision allow/deny
resource type/id
correlation id
trace id
```

Metrics:

```text
authentication failures by reason
authorization denies by policy
token audience mismatch count
expired token count
JWKS refresh failures
certificate expiry days
secret rotation age
PDP latency
PDP error rate
mTLS handshake failures
cross-tenant access deny count
```

Alerts:

```text
Spike in 401/403
Audience mismatch spike
Certificate near expiry
JWKS cannot refresh
Policy engine unavailable
Unexpected service calling sensitive API
High denied cross-tenant access
Token validation failures after deployment
```

---

## 25. Failure Mode: Authorization Server Down

If auth server is down, what happens?

Case 1: issuing new tokens fails.

```text
Existing tokens may continue until expiry.
New service calls requiring fresh token fail.
```

Case 2: JWKS endpoint down.

```text
Services with cached keys may continue.
New key rotation may fail.
Services without cache fail token validation.
```

Design:

```text
Cache JWKS with bounded TTL.
Respect cache headers but define safe fallback.
Do not cache forever.
Alert on refresh failure.
Avoid synchronized refresh storm.
Have emergency key rollback plan.
```

---

## 26. Failure Mode: PDP Down

If external policy engine is down:

Options:

```text
Fail closed: deny all risky operations.
Fail open: allow under limited safe conditions.
Cached decision: allow based on recent decision.
Degraded mode: allow read-only, block mutation.
Manual override: require break-glass audit.
```

For regulated systems, mutation operations should usually fail closed or degrade to manual review.

Decision should be explicit per operation:

| Operation | PDP Down Behavior |
|---|---|
| Public read | maybe allow if low risk |
| User-specific read | maybe cached decision |
| Sensitive read | deny/degrade |
| State mutation | deny/degrade/manual override |
| Approval | deny/manual fallback |
| Audit write | must not silently skip |

---

## 27. Break-Glass Access

Break-glass is emergency access under strict control.

Requirements:

```text
Explicit reason required.
Time-limited.
Strong authentication.
Additional approval if possible.
Full audit.
Notification.
Post-use review.
Cannot be hidden.
Cannot bypass audit.
```

Break-glass is not “admin role with no checks”.

---

## 28. Security Anti-Patterns

## 28.1 JWT Signature-Only Validation

```text
Token signed by trusted issuer, therefore accepted everywhere.
```

Wrong. Validate audience and context.

## 28.2 Gateway-Only Authorization

```text
Gateway already checked auth, internal services do not need checks.
```

Wrong for resource-owning services.

## 28.3 Trusting Internal Headers

```text
X-User-Id from request = authenticated user.
```

Wrong unless created by trusted infrastructure and protected.

## 28.4 Shared Service Account

```text
All services use same client_id/internal-client.
```

Destroys accountability and least privilege.

## 28.5 Long-Lived Bearer Tokens

```text
One token valid for days/months.
```

High blast radius if leaked.

## 28.6 Role Explosion

```text
CASE_OFFICER_AGENCY_A_APPROVER_LEVEL_2_TEMP_SPECIAL
```

Often indicates role is being used to encode attributes.

## 28.7 Authorization in Frontend Only

Frontend checks improve UX, not security. Backend must enforce.

## 28.8 mTLS as Complete Authorization

mTLS authenticates service/workload. It does not decide object-level access.

## 28.9 Logging Raw Tokens

Raw token in logs becomes credential leakage.

## 28.10 No Token Rotation Test

If key/cert/secret rotation has never been tested, it is probably broken.

---

## 29. Design Decision Matrix

| Requirement | Preferred Pattern |
|---|---|
| Machine-to-machine call no user | OAuth2 client credentials and/or mTLS |
| High-security internal service identity | mTLS + workload identity |
| Delegated user action downstream | Token exchange or signed user context + service token |
| Object-level authorization | Service-level authorization near resource owner |
| Cross-cutting policy governance | PDP/PEP hybrid |
| Multi-tenant isolation | Tenant-aware token + resource-level tenant check |
| High auditability | Store actor + caller + policy + decision + resource |
| Frequent credential rotation | Short-lived credentials, automated rotation |
| Sensitive API | audience-specific token + mTLS + service-level policy |
| Emergency access | break-glass with strict audit |

---

## 30. Production Readiness Checklist

### Identity

```text
[ ] Every service has unique identity.
[ ] Workload identity is not based only on IP.
[ ] User identity and service identity are modeled separately.
[ ] System actors are modeled explicitly.
[ ] Delegation is explicit.
```

### Token Validation

```text
[ ] Issuer validation implemented.
[ ] Audience validation implemented.
[ ] Expiry and not-before validation implemented.
[ ] Algorithm allowlist configured.
[ ] JWKS source pinned/trusted.
[ ] ID Token is not used as API access token.
[ ] Raw tokens are never logged.
```

### Authorization

```text
[ ] Gateway handles coarse route policy.
[ ] Resource-owning services enforce object-level policy.
[ ] Tenant/agency checked at resource access.
[ ] State transition guards include authorization.
[ ] PDP failure behavior is defined.
[ ] Policy changes are tested.
```

### Secrets and Certificates

```text
[ ] No secrets in source code.
[ ] Secrets are rotated.
[ ] Certificates are rotated.
[ ] Expiry monitored.
[ ] Emergency revoke path exists.
[ ] Services tolerate key rollover.
```

### Audit

```text
[ ] Audit includes original actor.
[ ] Audit includes calling service.
[ ] Audit includes policy decision/version.
[ ] Audit includes resource and state transition.
[ ] Audit includes correlation/trace ID.
[ ] Break-glass access is audited.
```

### Operations

```text
[ ] Auth server outage behavior defined.
[ ] JWKS cache behavior defined.
[ ] PDP outage behavior defined.
[ ] 401/403 metrics exist.
[ ] mTLS handshake failure metrics exist.
[ ] Security dashboard exists.
[ ] Security incident runbook exists.
```

---

## 31. Architecture Review Questions

1. What identities exist in this system?
2. Which identity is used for user actions?
3. Which identity is used for service calls?
4. Which service owns authorization for each resource?
5. Can an internal service bypass authorization?
6. Are tokens audience-restricted?
7. Are scopes/permissions least-privilege?
8. Is token exchange required for downstream calls?
9. How is tenant/agency isolation enforced?
10. What happens if auth server is down?
11. What happens if policy engine is down?
12. What happens if certificate expires?
13. How are secrets rotated?
14. Are raw tokens ever logged?
15. Can audit reconstruct actor, caller, decision, and resource?
16. How does break-glass work?
17. How do we detect lateral movement?
18. Can one compromised service call all internal services?
19. Are system jobs distinguishable from human actions?
20. Are retry/compensation actions distinguishable in audit?

---

## 32. Practical Exercise

Ambil satu sistem microservices dengan service berikut:

```text
application-service
case-service
document-service
screening-service
audit-service
notification-service
workflow-service
```

Desain security model:

1. Tentukan identity setiap service.
2. Tentukan API mana yang memakai user delegation.
3. Tentukan API mana yang memakai service-only client credentials.
4. Tentukan apakah mTLS/service mesh diperlukan.
5. Tentukan audience setiap token.
6. Tentukan authorization owner per resource.
7. Buat audit envelope untuk satu approval flow.
8. Buat failure matrix untuk auth server, PDP, JWKS, dan certificate expiry.
9. Buat policy untuk cross-agency access.
10. Buat runbook untuk secret compromise.

---

## 33. Ringkasan

Service-to-service security dalam microservices tidak bisa direduksi menjadi “pakai JWT” atau “pakai mTLS”.

Model yang benar harus memisahkan:

```text
Authentication: siapa caller?
Authorization: boleh melakukan apa terhadap resource mana?
Delegation: bertindak atas nama siapa dan dengan batasan apa?
Identity: user, service, workload, system actor, tenant.
Audit: bagaimana keputusan dan aksi dibuktikan?
Operations: bagaimana credential/key/cert/policy hidup, berubah, rusak, dan dipulihkan?
```

Prinsip paling penting:

```text
Never trust internal network blindly.
Never accept token without audience validation.
Never confuse service privilege with user privilege.
Never put all authorization only at the gateway.
Never design security without rotation and audit.
```

Microservices security yang matang adalah gabungan dari:

```text
workload identity
short-lived credentials
mTLS where appropriate
audience-specific tokens
token exchange for delegation
service-level resource authorization
policy decision architecture
tenant isolation
strong audit identity
operational rotation discipline
```

Itulah fondasi agar microservices Java bisa aman bukan hanya saat happy path, tetapi juga saat credential bocor, service compromised, policy berubah, token salah audience, certificate expired, atau incident harus direkonstruksi.

---

## 34. Status Seri

Part ini adalah:

```text
Part 20 dari 35 — Service-to-Service Security Patterns
```

Seri belum selesai.

Part berikutnya:

```text
Part 21 — Multi-Tenancy, Isolation, and Regulatory Segmentation
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-21-multi-tenancy-isolation-regulatory-segmentation.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-19-state-machine-pattern.md">⬅️ Part 19 — State Machine Pattern for Microservices</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-21-multi-tenancy-isolation-regulatory-segmentation.md">Part 21 — Tenancy, Isolation, and Regulatory Segmentation ➡️</a>
</div>
