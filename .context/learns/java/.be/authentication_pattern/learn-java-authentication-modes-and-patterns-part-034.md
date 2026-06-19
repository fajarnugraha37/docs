# learn-java-authentication-modes-and-patterns-part-034
# Part 34 — Reference Architectures and Decision Framework

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 sampai Java 25  
> Posisi: Part 34 dari 35  
> Fokus: menyatukan seluruh mode authentication menjadi arsitektur referensi, decision matrix, dan reasoning framework production-grade.

---

## 0. Tujuan Part Ini

Sampai Part 33, kita sudah membahas banyak mode dan pola authentication:

- password authentication,
- session authentication,
- Servlet/Jakarta/Spring Security authentication,
- API key,
- HMAC request signing,
- JWT,
- opaque token dan introspection,
- OAuth2,
- OIDC,
- PKCE,
- client credentials,
- SAML,
- LDAP/AD/Kerberos,
- mTLS,
- WebAuthn/passkey,
- MFA,
- mobile/CLI/device clients,
- token lifecycle,
- key management,
- IdP integration,
- multi-tenant authentication,
- distributed systems,
- messaging/job authentication,
- failure modeling,
- audit/forensics,
- performance,
- testing,
- migration.

Masalahnya: engineer yang kuat bukan hanya tahu semua mekanisme itu. Engineer top-tier mampu menjawab:

> “Untuk sistem seperti ini, authentication architecture yang paling masuk akal apa, kenapa, apa trade-off-nya, apa failure mode-nya, bagaimana migration-nya, dan bagaimana membuktikan bahwa desainnya defensible?”

Part ini adalah **decision framework**.

Kita akan membahas:

1. cara membaca requirement authentication,
2. cara memilih mode authentication,
3. reference architecture untuk berbagai jenis aplikasi,
4. decision matrix,
5. anti-pattern,
6. checklist review arsitektur,
7. cara berpikir seperti architect, security engineer, dan reliability engineer sekaligus.

---

## 1. Prinsip Besar: Authentication Architecture Bukan “Login Flow”

Authentication architecture adalah desain menyeluruh untuk menjawab:

1. siapa aktornya,
2. bagaimana aktor membuktikan identitasnya,
3. siapa yang dipercaya sebagai issuer identity,
4. bagaimana bukti itu dibawa antar boundary,
5. bagaimana bukti itu divalidasi,
6. bagaimana session/token dikelola,
7. bagaimana identity dipropagasi,
8. bagaimana credential dirotasi,
9. bagaimana akses dihentikan,
10. bagaimana sistem membuktikan apa yang terjadi setelah insiden.

Kesalahan umum:

```text
"User login pakai OAuth, berarti authentication selesai."
```

Itu terlalu dangkal.

Yang benar:

```text
Authentication architecture mencakup browser, backend, IdP, token/session, resource server,
service-to-service call, async job, audit event, key rotation, logout, failure behavior,
incident response, dan migration path.
```

---

## 2. Core Mental Model

### 2.1 Authentication Mode = Proof + Transport + Validation + Lifecycle

Setiap mode authentication harus dipecah menjadi empat bagian:

```text
Authentication Mode
= proof type
+ transport mechanism
+ validation authority
+ lifecycle management
```

Contoh JWT:

```text
Proof type          : signed assertion
Transport           : HTTP Authorization: Bearer
Validation authority: issuer + JWKS
Lifecycle           : exp, refresh, revocation strategy, key rotation
```

Contoh session cookie:

```text
Proof type          : possession of session id
Transport           : browser cookie
Validation authority: server-side session store
Lifecycle           : rotation, idle timeout, absolute timeout, invalidation
```

Contoh mTLS:

```text
Proof type          : possession of private key matching certificate
Transport           : TLS handshake
Validation authority: truststore / CA / PKI
Lifecycle           : certificate issuance, rotation, revocation
```

Contoh HMAC:

```text
Proof type          : possession of shared secret
Transport           : signed HTTP headers
Validation authority: server-side key registry
Lifecycle           : key issuance, versioning, rotation, replay window
```

### 2.2 Good Architecture Memisahkan Tiga Identity

Dalam sistem serius, biasanya ada tiga identity sekaligus:

```text
1. End-user identity
   "Siapa manusia yang meminta aksi?"

2. Client/application identity
   "Aplikasi/channel mana yang membawa request ini?"

3. Workload/service identity
   "Service/process mana yang menjalankan operasi ini?"
```

Contoh:

```text
User:            officer-123
Client app:      aceas-web-bff
Service:         case-service
Downstream job:  enforcement-escalation-worker
```

Anti-pattern:

```text
Semua identity disimpan sebagai satu string "createdBy".
```

Lebih baik:

```text
actor_user_id
actor_type
client_id
service_id
delegation_chain
auth_method
auth_time
correlation_id
```

### 2.3 Authentication Boundary Tidak Sama Dengan Network Boundary

Banyak sistem lama berpikir:

```text
Kalau sudah di internal network, berarti trusted.
```

Itu lemah.

Authentication boundary seharusnya berdasarkan:

- validated identity,
- cryptographic proof,
- issuer trust,
- audience binding,
- scope/role/claim constraint,
- session/token lifecycle,
- observability.

Dalam microservices, service di internal network tetap harus diautentikasi.

### 2.4 Authentication Bukan Authorization

Authentication menjawab:

```text
Who are you?
How did you prove it?
Who asserted it?
Can I trust that assertion?
```

Authorization menjawab:

```text
Are you allowed to perform this action on this resource?
```

Tetapi authentication architecture harus menyediakan input yang cukup untuk authorization.

Contoh buruk:

```text
JWT valid => allow access.
```

Contoh benar:

```text
JWT valid
+ issuer trusted
+ audience matches service
+ token not expired
+ tenant matches request tenant
+ actor has required assurance
+ authorization policy allows action on resource.
```

---

## 3. Requirement Discovery Framework

Sebelum memilih mode authentication, tanyakan pertanyaan berikut.

### 3.1 Actor Questions

```text
- Siapa aktornya?
- Human user, service, batch job, device, partner system, internal admin?
- Apakah aktor bisa menyimpan secret dengan aman?
- Apakah aktor browser-based, server-side, native mobile, CLI, IoT, atau backend service?
- Apakah aktor mewakili dirinya sendiri atau mendelegasikan user lain?
```

### 3.2 Channel Questions

```text
- Request datang dari browser, mobile app, server-to-server, queue, scheduler, atau file transfer?
- Apakah channel synchronous HTTP?
- Apakah asynchronous via Kafka/RabbitMQ/JMS?
- Apakah melewati gateway, CDN, WAF, service mesh, reverse proxy?
```

### 3.3 Trust Questions

```text
- Siapa identity provider-nya?
- Apakah kita mengelola credential sendiri?
- Apakah ada corporate IdP?
- Apakah ada banyak tenant/issuer?
- Apakah IdP eksternal bisa dipercaya penuh?
- Claims mana yang authoritative?
```

### 3.4 Assurance Questions

```text
- Apakah password cukup?
- Perlu MFA?
- Perlu step-up untuk aksi sensitif?
- Perlu WebAuthn/passkey?
- Perlu mTLS untuk proof-of-possession?
- Perlu hardware-bound credential?
```

### 3.5 Token/Session Questions

```text
- Stateful atau stateless?
- Perlu immediate revocation?
- Perlu SSO?
- Perlu logout lintas aplikasi?
- Perlu offline access?
- Berapa lifetime access token?
- Berapa lifetime refresh token?
- Perlu refresh token rotation?
```

### 3.6 Operational Questions

```text
- Bagaimana key rotation?
- Bagaimana secret rotation?
- Apa yang terjadi jika IdP down?
- Apa yang terjadi jika Redis/session store down?
- Apa yang terjadi jika JWKS endpoint down?
- Apa yang terjadi jika introspection endpoint lambat?
- Apa yang terjadi saat login storm?
```

### 3.7 Audit Questions

```text
- Apa event authentication yang dicatat?
- Apakah bisa membedakan login user vs token refresh vs service call?
- Apakah audit menyimpan auth_method?
- Apakah audit menyimpan assurance level?
- Apakah bisa rekonstruksi incident?
```

---

## 4. Decision Axes

Saat memilih authentication pattern, jangan mulai dari teknologi. Mulai dari axis.

### 4.1 Actor Type

| Actor | Bias Mode |
|---|---|
| Browser human user | Session + OIDC / BFF |
| SPA murni | Authorization Code + PKCE, hati-hati token storage |
| Server-rendered Java app | Session + OIDC atau container auth |
| Mobile native | Authorization Code + PKCE via system browser |
| CLI | Device flow atau authorization code with localhost redirect |
| Backend service | Client credentials, private key JWT, mTLS |
| Partner API | mTLS + OAuth2, HMAC signing, API key sebagai fallback |
| Batch job | Workload identity / client credentials |
| Kafka/RabbitMQ client | SASL/OAUTHBEARER, SCRAM, mTLS |
| Admin/operator | OIDC + MFA + step-up + privileged audit |

### 4.2 Client Confidentiality

```text
Confidential client:
- backend server,
- can protect secret,
- suitable for client secret, private_key_jwt, mTLS.

Public client:
- SPA,
- mobile app,
- desktop app,
- CLI on user machine,
- cannot safely protect static secret,
- should use PKCE/device flow and avoid assuming client secret is secret.
```

### 4.3 Revocation Requirement

| Requirement | Better Fit |
|---|---|
| Immediate revocation required | Session or opaque token introspection |
| Short-lived delegated API access | JWT with short exp |
| Long-lived offline access | Refresh token rotation |
| High-risk partner API | mTLS-bound token or HMAC |
| Emergency kill-switch needed | Central introspection or denylist |

### 4.4 Latency Requirement

| Requirement | Better Fit |
|---|---|
| Very low latency resource server | JWT local validation |
| Strong central control | Opaque token introspection |
| High assurance service auth | mTLS + cached cert validation |
| Partner request integrity | HMAC signing |

### 4.5 Federation Requirement

| Requirement | Better Fit |
|---|---|
| Enterprise SSO | OIDC or SAML |
| Legacy enterprise IdP | SAML / LDAP / Kerberos |
| Modern cloud IdP | OIDC |
| Government/cross-agency identity | OIDC/SAML with strict claim normalization |
| Multi-tenant SaaS | issuer-per-tenant or tenant-aware resource server |

### 4.6 Browser Security Requirement

| Requirement | Better Fit |
|---|---|
| Avoid token in browser storage | BFF + server session |
| SPA must call API directly | Authorization Code + PKCE + strict token lifetime |
| Strong CSRF defense needed | SameSite cookie + CSRF token |
| SSO across apps | OIDC + shared IdP + app-local session |

---

## 5. Reference Architecture 1 — Public Web Application

### 5.1 Use Case

Aplikasi publik dengan user manusia, browser, login, dashboard, profile, transaksi, dan backend Java.

Contoh:

```text
Browser -> Java Web App/BFF -> Internal APIs -> Database
```

### 5.2 Recommended Authentication

```text
Primary:
- OIDC Authorization Code + PKCE
- BFF/server-side session

Session:
- HttpOnly Secure SameSite cookie
- session rotation after login
- idle timeout + absolute timeout

Token handling:
- access token stored server-side
- refresh token stored server-side, encrypted or in secure session store
- browser never receives long-lived tokens
```

### 5.3 Why

Browser adalah hostile runtime. JavaScript dapat terpapar XSS. LocalStorage token memperbesar blast radius. BFF mengubah browser menjadi cookie-session client, sementara backend menangani OIDC/token exchange.

### 5.4 Diagram

```text
+---------+       +-------------+       +----------------+
| Browser | <---> | Java BFF    | <---> | Identity       |
|         | cookie| Spring/JEE  | code  | Provider       |
+---------+       +-------------+       +----------------+
                       |
                       | bearer token / token exchange
                       v
                 +-------------+
                 | API Service |
                 +-------------+
```

### 5.5 Java Fit

```text
Spring stack:
- Spring Security OAuth2 Login
- Spring Session if distributed session needed
- Resource Server for internal APIs

Jakarta stack:
- Jakarta Security OIDC mechanism where supported
- container session
- app-specific token handling
```

### 5.6 Must-Have Controls

```text
- Authorization Code + PKCE
- state validation
- nonce validation for OIDC
- strict redirect URI
- session id rotation after login
- CSRF protection for cookie-authenticated unsafe methods
- secure cookie flags
- short access token lifetime
- refresh token rotation where applicable
- audit login/logout/token refresh
```

### 5.7 Failure Modes

```text
- session fixation if session id not rotated
- CSRF if cookie session without CSRF control
- open redirect stealing authorization code
- storing access token in localStorage
- relying on ID Token as API token
- missing audience validation on API
- logout only local, not IdP-aware
```

---

## 6. Reference Architecture 2 — Server-Rendered Internal Enterprise Application

### 6.1 Use Case

Internal enterprise app, Java backend renders pages, users authenticate via corporate SSO.

### 6.2 Recommended Authentication

```text
Primary:
- OIDC or SAML with corporate IdP
- server-side session

Optional:
- Kerberos/SPNEGO for intranet SSO
- LDAP only for legacy/direct directory auth
```

### 6.3 Why

Enterprise user lifecycle usually managed by IdP/directory. App should avoid becoming password authority unless required.

### 6.4 Diagram

```text
+-------------+     +---------------+     +------------------+
| Employee    | --> | Java Web App  | --> | Corporate IdP    |
| Browser     |     | Session-based |     | OIDC/SAML/AD     |
+-------------+     +---------------+     +------------------+
                           |
                           v
                    +--------------+
                    | Enterprise DB|
                    +--------------+
```

### 6.5 Java Fit

```text
- Spring Security SAML2 Login or OAuth2 Login
- Jakarta Security OIDC where suitable
- Servlet container auth for legacy BASIC/FORM/client-cert
- JAAS/Kerberos for SPNEGO use cases
```

### 6.6 Design Rules

```text
- Do not copy all IdP groups blindly into local roles.
- Normalize claims into app-specific authorities.
- Maintain stable internal subject id.
- Treat email/display name as mutable.
- Keep audit principal stable.
- Support user deprovisioning.
```

### 6.7 Failure Modes

```text
- group explosion in token/session
- stale roles after IdP change
- using display name as principal id
- no fallback when IdP unavailable
- local admin bypass without audit
```

---

## 7. Reference Architecture 3 — SPA + API

### 7.1 Use Case

Vue/React/Angular SPA calling Java APIs.

### 7.2 Two Main Options

#### Option A — SPA Direct Token

```text
SPA -> IdP
SPA -> API with access token
```

Pros:

```text
- simpler deployment
- no BFF layer
- works for pure API platform
```

Cons:

```text
- browser handles access token
- XSS risk more severe
- refresh token handling is hard
- logout and session state harder
```

#### Option B — SPA + BFF

```text
SPA -> BFF cookie session
BFF -> API with access token
```

Pros:

```text
- token stays server-side
- browser only sees HttpOnly cookie
- easier API aggregation
- easier CSRF/session control
```

Cons:

```text
- more backend complexity
- BFF scalability/session design needed
- requires careful CSRF design
```

### 7.3 Recommended Default

For high-value enterprise/regulatory systems:

```text
Prefer SPA + BFF + server-side session.
```

For lower-risk public API integrations:

```text
SPA direct token can be acceptable with Authorization Code + PKCE,
short-lived access tokens, strict CSP, no long-lived tokens in localStorage,
and careful threat modeling.
```

### 7.4 Java Fit

```text
BFF:
- Spring Boot + Spring Security OAuth2 Client
- Spring Session + Redis if distributed
- WebFlux or MVC depending app

API:
- Spring Security Resource Server
- JWT or opaque token validation
- strict issuer/audience validation
```

### 7.5 Failure Modes

```text
- treating SPA as confidential client
- storing client secret in JavaScript
- storing refresh token in localStorage
- missing state/nonce validation
- token with wrong audience accepted by API
- CORS too permissive
- cookie session without CSRF
```

---

## 8. Reference Architecture 4 — Mobile Native App

### 8.1 Use Case

Mobile app calling Java backend APIs.

### 8.2 Recommended Authentication

```text
- Authorization Code + PKCE
- system browser or platform secure auth session
- short-lived access token
- refresh token rotation
- device binding if risk requires
- optional mTLS / DPoP / sender-constrained token for high-risk apps
```

### 8.3 Why

Mobile app is public client. It cannot protect static client secret. But it can use platform keystore/keychain for local token protection.

### 8.4 Diagram

```text
+-------------+       +-------------+       +---------+
| Mobile App  | ----> | System      | ----> | IdP     |
| Public      |       | Browser     |       |         |
+-------------+       +-------------+       +---------+
      |
      | access token
      v
+-------------+
| Java API    |
+-------------+
```

### 8.5 Java Backend Controls

```text
- validate issuer
- validate audience
- validate expiration
- validate scopes/claims
- detect refresh token reuse if AS supports signal
- log device/client metadata safely
- avoid trusting device id alone
```

### 8.6 Failure Modes

```text
- embedded webview stealing credentials
- hardcoded client secret
- refresh token without rotation
- no device revoke capability
- assuming mobile storage is perfect
```

---

## 9. Reference Architecture 5 — CLI/Desktop Client

### 9.1 Use Case

Developer CLI, admin CLI, desktop app, operator tool.

### 9.2 Recommended Authentication

```text
CLI:
- OAuth2 Device Authorization Grant
- or Authorization Code + PKCE with localhost redirect

Desktop:
- Authorization Code + PKCE via system browser

Backend:
- resource server validates access token
```

### 9.3 Why

CLI often lacks browser embedding or has poor UX for redirect. Device flow is user-friendly but polling and phishing risks must be managed.

### 9.4 Failure Modes

```text
- static API key in config forever
- token stored plaintext
- no token revoke
- excessive refresh token lifetime
- no separation between user CLI and service automation
```

### 9.5 Decision Rule

```text
If a human runs the CLI interactively:
  use user-based OAuth/OIDC.

If automation runs the CLI in CI/CD:
  use workload identity/client credentials, not human refresh token.
```

---

## 10. Reference Architecture 6 — Partner API

### 10.1 Use Case

External organization calls your Java API.

Examples:

```text
- government agency integration,
- bank/fintech partner API,
- logistics partner,
- enterprise B2B API.
```

### 10.2 Recommended Authentication

High assurance:

```text
- OAuth2 client credentials
- mTLS client authentication
- certificate-bound access token
- partner-specific audience/scope
```

Alternative/additional:

```text
- HMAC request signing for request integrity and replay defense
- API key only for low-risk identification or bootstrapping
```

### 10.3 Diagram

```text
+----------------+      mTLS/token       +-------------+
| Partner System | --------------------> | API Gateway |
+----------------+                       +-------------+
                                                 |
                                                 | validated identity
                                                 v
                                           +------------+
                                           | Java API   |
                                           +------------+
```

### 10.4 Controls

```text
- partner-specific client_id
- no shared API key across partners
- scope per API capability
- audience per API
- mTLS cert bound to partner
- certificate expiry monitoring
- rate limit per partner
- request id / idempotency key
- audit every high-risk action
```

### 10.5 Failure Modes

```text
- one shared partner credential
- no environment separation
- no cert rotation plan
- no replay protection for signed requests
- partner identity trusted from header injected by gateway without protection
```

---

## 11. Reference Architecture 7 — Machine-to-Machine Internal Microservices

### 11.1 Use Case

Java services call each other inside platform.

### 11.2 Recommended Authentication

```text
Baseline:
- service-to-service mTLS or service mesh identity

Application-layer:
- OAuth2 client credentials
- JWT with service audience
- token exchange when carrying end-user delegation

High assurance:
- mTLS-bound token or private_key_jwt
```

### 11.3 Diagram

```text
+-----------+      token exchange       +--------------+
| BFF       | ------------------------> | Auth Server  |
+-----------+                           +--------------+
     |
     | user-delegated token for service A
     v
+-----------+      mTLS + aud token      +-----------+
| Service A | ------------------------> | Service B |
+-----------+                           +-----------+
```

### 11.4 Design Rules

```text
- Edge token should not be blindly relayed everywhere.
- Each service should validate audience.
- Internal tokens should be scoped to downstream service.
- Service identity and user identity should be separate.
- Delegation chain should be auditable.
```

### 11.5 Common Patterns

#### Pattern A — Token Relay

```text
User token enters service A.
Service A forwards same token to service B.
```

Acceptable when:

```text
- same audience covers both services,
- services are within same resource boundary,
- authorization model is simple.
```

Dangerous when:

```text
- token audience is wrong,
- downstream receives more authority than needed,
- user identity is confused with service identity.
```

#### Pattern B — Token Exchange

```text
Service A exchanges incoming token for token targeted to Service B.
```

Better when:

```text
- each downstream service has separate audience,
- delegation should be explicit,
- least privilege matters.
```

#### Pattern C — Service Credential Only

```text
Service A calls Service B using its own client credentials.
```

Better when:

```text
- operation is system-level,
- no user delegation is involved,
- audit should show system actor.
```

Dangerous when:

```text
- user-specific action becomes hidden behind service identity.
```

---

## 12. Reference Architecture 8 — Event-Driven Backend

### 12.1 Use Case

Kafka/RabbitMQ/JMS events processed by Java consumers.

### 12.2 Authentication Layers

```text
1. Broker client authentication
   Who can connect to broker?

2. Topic/queue authorization
   Who can publish/consume this stream?

3. Message identity
   On behalf of whom was this event produced?

4. Consumer execution identity
   Which service/job processed it?

5. Audit identity
   How to reconstruct the original actor and processing chain?
```

### 12.3 Recommended Pattern

```text
Broker:
- mTLS/SASL/SCRAM/OAUTHBEARER depending broker

Message:
- include actor metadata, not raw access token
- include event id, correlation id, causation id
- include producer service identity
- sign high-risk commands if crossing trust boundary

Consumer:
- authenticate to broker as service
- authorize topic access
- validate message provenance
- perform domain authorization if needed
```

### 12.4 Diagram

```text
+-------------+        event         +----------+       consume       +-------------+
| Case API    | -------------------> | Kafka    | -----------------> | Worker      |
| user action | actor metadata       | Broker   | service identity   | Java        |
+-------------+                      +----------+                    +-------------+
```

### 12.5 Failure Modes

```text
- raw user JWT stored in Kafka for days
- no producer identity
- no consumer identity
- assuming broker auth equals domain auth
- replayed message triggers duplicated action
- poison message causes repeated privileged action
```

---

## 13. Reference Architecture 9 — Regulatory / Case Management Platform

### 13.1 Use Case

Complex case management platform with officers, agencies, external applicants, internal workers, scheduled escalations, audit, and legal defensibility.

This is the type of system where authentication quality is not just security. It affects:

```text
- evidentiary confidence,
- audit defensibility,
- enforcement lifecycle,
- user accountability,
- agency boundary,
- delegation chain,
- incident response.
```

### 13.2 Recommended Authentication Architecture

For external applicants:

```text
- national/corporate IdP via OIDC/SAML
- session-based BFF
- strong identity binding
- clear account linking rules
```

For internal officers:

```text
- enterprise SSO OIDC/SAML
- MFA
- step-up for sensitive operations
- role/group mapping into app roles
```

For admin/support:

```text
- separate privileged role
- stronger MFA
- session timeout tighter
- just-in-time elevation where possible
- full audit
```

For service-to-service:

```text
- mTLS/service mesh identity
- OAuth2 client credentials or token exchange
- audience per service
```

For batch/workers:

```text
- workload identity
- explicit system actor
- no human token reuse
```

For external partner systems:

```text
- mTLS + OAuth2 client credentials
- partner-specific scopes
- HMAC signing if request integrity/non-repudiation-like traceability needed
```

### 13.3 Actor Model

```text
Human external actor:
- applicant
- representative
- salesperson
- company user

Human internal actor:
- officer
- supervisor
- approver
- auditor
- admin

Machine actor:
- workflow engine
- scheduler
- event worker
- notification service
- document service
- screening engine
- integration connector
```

### 13.4 Audit Identity Model

Minimum useful audit columns:

```text
actor_type
actor_user_id
actor_display_name_at_time
actor_org_id
actor_tenant_id
auth_method
auth_assurance_level
client_id
service_id
delegation_type
on_behalf_of_user_id
session_id_hash
token_id_hash
request_id
correlation_id
causation_id
source_ip_hash_or_classification
user_agent_hash_or_classification
event_time
```

### 13.5 Why This Matters

In regulatory systems, “who did what” is insufficient. You need:

```text
who authenticated,
how they authenticated,
who asserted their identity,
what app/client they used,
whether they acted directly or through delegation,
which service executed it,
what async processing followed,
and whether the chain is reconstructable.
```

---

## 14. Reference Architecture 10 — Multi-Tenant SaaS / Multi-Agency Platform

### 14.1 Use Case

One Java platform serves many tenants/agencies/customers.

### 14.2 Core Problem

Authentication must prevent:

```text
- tenant confusion,
- issuer confusion,
- audience confusion,
- claim collision,
- cross-tenant session reuse,
- admin impersonation ambiguity.
```

### 14.3 Recommended Options

#### Option A — Realm/Issuer Per Tenant

```text
Tenant A -> Issuer A
Tenant B -> Issuer B
```

Pros:

```text
- strong isolation
- clear JWKS/issuer boundary
- easier tenant-specific policy
```

Cons:

```text
- more operational overhead
- many client configs
- migration complexity
```

#### Option B — Shared Issuer With Tenant Claim

```text
All tenants -> same issuer
Tenant identity in claim
```

Pros:

```text
- simpler IdP operation
- easier shared SSO
```

Cons:

```text
- app must validate tenant claim strictly
- risk of cross-tenant confusion
- authorization layer must be tenant-aware everywhere
```

#### Option C — Hybrid

```text
High-risk tenants get dedicated issuer/realm.
Low-risk tenants share issuer with strict tenant claim.
```

### 14.4 Decision Rule

```text
If tenant boundaries are legal/security boundaries:
  prefer issuer/realm separation.

If tenant boundaries are product segmentation only:
  shared issuer may be acceptable with strong tenant-aware authorization.

If agencies have independent IdPs:
  support issuer-per-tenant federation.
```

### 14.5 Failure Modes

```text
- tenant selected from request path but token tenant ignored
- token from tenant A accepted for tenant B
- shared admin role across tenants
- email used as global user id
- no audit of tenant switch/impersonation
```

---

## 15. Reference Architecture 11 — High-Security Admin Console

### 15.1 Use Case

Privileged console for production ops, regulatory admin, user management, role management, configuration, or case override.

### 15.2 Recommended Authentication

```text
- OIDC/SAML with enterprise IdP
- MFA mandatory
- step-up for dangerous actions
- privileged session separate from normal session
- short idle timeout
- device/IP/risk checks if available
- full audit
```

### 15.3 Design Rule

Never treat normal login as enough for privileged operations.

Sensitive operations:

```text
- create admin user
- change role/group mapping
- view secret/token/key material metadata
- impersonate user
- export data
- override workflow state
- close/reopen enforcement case
- delete audit-relevant record
```

Need step-up:

```text
- recent authentication
- stronger factor
- privileged approval workflow
- signed reason/comment
```

### 15.4 Failure Modes

```text
- admin and normal app share same session
- no re-authentication for dangerous action
- impersonation not visible in audit
- admin API accepts same bearer token as normal API
- emergency admin backdoor not monitored
```

---

## 16. Reference Architecture 12 — Legacy Java 8 Monolith

### 16.1 Use Case

Old Java 8 web app with local users, custom login table, Servlet session, maybe LDAP.

### 16.2 Recommended Migration-Oriented Architecture

Phase 1:

```text
- harden existing session/password
- add password hash upgrade
- add login audit
- add session rotation
- add secure cookie flags
```

Phase 2:

```text
- introduce external IdP
- support OIDC/SAML login alongside local login
- map external subject to internal user
```

Phase 3:

```text
- migrate roles/claims
- phase out local password
- keep break-glass account with strict controls
```

Phase 4:

```text
- introduce API resource server boundary
- split BFF/API if needed
```

### 16.3 What Not To Do

```text
- big-bang rewrite authentication and business logic together
- change user identifier semantics without mapping
- remove local login before IdP fallback is tested
- migrate passwords by decrypting them
- treat email as permanent identity
```

---

## 17. Decision Matrix: Which Mode When?

### 17.1 Human Browser Login

| Context | Recommended |
|---|---|
| Public web app | OIDC Authorization Code + PKCE + BFF session |
| Internal enterprise web | OIDC/SAML + server session |
| Legacy intranet | Kerberos/SPNEGO or SAML/OIDC |
| High-risk admin | OIDC/SAML + MFA + step-up |

### 17.2 API Access

| Context | Recommended |
|---|---|
| Browser-to-BFF | Cookie session |
| SPA direct API | Authorization Code + PKCE + access token |
| Mobile API | Authorization Code + PKCE |
| Partner API | OAuth2 client credentials + mTLS |
| Internal service API | mTLS + client credentials/token exchange |
| Low-risk developer API | API key with scope/rate limit |

### 17.3 Token Type

| Need | Better Fit |
|---|---|
| Low-latency local validation | JWT |
| Immediate revocation | Opaque token + introspection |
| Small token and central policy | Opaque token |
| Offline verification | JWT |
| Sender constraint | mTLS-bound token / DPoP |
| Session continuity | Server-side session |

### 17.4 Credential Type

| Need | Better Fit |
|---|---|
| Human memorized secret | Password + strong hashing + MFA |
| Passwordless user auth | WebAuthn/passkey |
| Service auth simple | Client secret, but rotate aggressively |
| Service auth stronger | private_key_jwt or mTLS |
| Partner request integrity | HMAC signing |
| Enterprise workstation SSO | Kerberos/SPNEGO |

### 17.5 State Model

| Need | Better Fit |
|---|---|
| Central invalidation | Stateful session / opaque token |
| Horizontal scaling simplicity | JWT |
| Browser security | HttpOnly cookie session |
| Cross-device logout | Central session/token registry |
| API gateway validation | JWT or introspection depending revocation need |

---

## 18. Decision Tree

### 18.1 Is the actor human?

```text
Yes:
  Is the client browser?
    Yes:
      Is this high-value app?
        Yes -> OIDC + BFF session + MFA/step-up where needed.
        No  -> OIDC Code + PKCE, BFF preferred.
    No:
      Is it mobile/desktop?
        Yes -> Code + PKCE via system browser.
      Is it CLI?
        Yes -> Device flow or Code + PKCE localhost redirect.

No:
  Is it service-to-service?
    Yes:
      Use client credentials/private_key_jwt/mTLS.
      Validate audience per downstream.
      Use token exchange if carrying user delegation.

  Is it partner system?
    Yes:
      Use OAuth2 client credentials + mTLS.
      Add HMAC if request integrity/replay defense required.

  Is it async worker/job?
    Yes:
      Use workload identity.
      Do not reuse human token.
```

### 18.2 Do you need immediate revocation?

```text
Yes:
  Prefer session store or opaque token introspection.
  Or use JWT with very short lifetime + denylist for emergency.

No:
  JWT local validation acceptable if key rotation and audience validation are strong.
```

### 18.3 Can the client keep a secret?

```text
Yes:
  confidential client:
    client_secret, private_key_jwt, mTLS depending risk.

No:
  public client:
    PKCE.
    no static client secret.
    avoid long-lived token exposure.
```

---

## 19. Architecture Smells

### 19.1 “JWT Everywhere”

Smell:

```text
Every internal service accepts the same end-user JWT.
```

Why bad:

```text
- audience too broad,
- least privilege broken,
- revocation hard,
- downstream confused about delegation,
- token claims become global coupling.
```

Better:

```text
- validate audience,
- use token exchange,
- separate user identity from service identity.
```

### 19.2 “API Key as User Login”

Smell:

```text
User authenticates by sending API key forever.
```

Why bad:

```text
- no phishing resistance,
- no MFA,
- no session lifecycle,
- hard revocation granularity,
- poor user assurance.
```

Better:

```text
- use API key for client/app identity,
- use OIDC/session for user identity.
```

### 19.3 “Gateway Authenticated, Services Trust Headers”

Smell:

```text
Gateway validates token and injects X-User-Id.
Services trust X-User-Id blindly.
```

Why bad:

```text
- header spoofing if bypass path exists,
- weak zero-trust posture,
- no service-local audience validation,
- gateway config becomes single failure point.
```

Better:

```text
- enforce network path,
- sign internal headers or use mTLS,
- pass validated token or exchanged token,
- services validate critical identity.
```

### 19.4 “Email as Principal”

Smell:

```text
email = user id
```

Why bad:

```text
- email changes,
- email can be reused,
- external IdP email verification differs,
- cross-tenant collision.
```

Better:

```text
- stable subject id,
- issuer + subject pair,
- internal immutable user id.
```

### 19.5 “No Auth Event Model”

Smell:

```text
Only business events are audited.
Authentication events are not modeled.
```

Why bad:

```text
- impossible to reconstruct incident,
- cannot detect token/session abuse,
- cannot prove assurance level at time of action.
```

Better:

```text
- login/logout/token/session/MFA events,
- correlation id,
- auth method,
- assurance level,
- client/service identity.
```

---

## 20. Framework Selection Guidance

### 20.1 Spring Security

Use when:

```text
- Spring Boot application,
- modern OAuth2/OIDC resource server/client,
- flexible filter chain,
- rich test support,
- microservice/API architecture.
```

Strengths:

```text
- mature authentication architecture,
- resource server JWT/opaque support,
- OAuth2 client/login support,
- SAML2 support,
- integration testing support.
```

Watch out:

```text
- filter chain order complexity,
- SecurityContext propagation,
- session/stateless confusion,
- custom AuthenticationProvider mistakes.
```

### 20.2 Jakarta Security

Use when:

```text
- Jakarta EE application server,
- portable enterprise security desired,
- container-managed identity model,
- IdentityStore abstraction useful.
```

Strengths:

```text
- standard API,
- container integration,
- identity store model,
- OIDC support in modern versions.
```

Watch out:

```text
- container-specific behavior,
- slower ecosystem movement than Spring,
- cloud-native examples less abundant.
```

### 20.3 Servlet Container Auth

Use when:

```text
- legacy app,
- simple BASIC/FORM/client-cert auth,
- container-managed realm already exists.
```

Watch out:

```text
- app/framework principal mismatch,
- limited modern OAuth/OIDC abstraction,
- portability differences.
```

### 20.4 JAAS

Use when:

```text
- Kerberos,
- legacy enterprise auth,
- custom pluggable login modules,
- runtime-level subject concepts needed.
```

Watch out:

```text
- not a complete modern web authentication architecture,
- Subject propagation can be hard,
- SecurityManager-era assumptions may be outdated.
```

---

## 21. Java 8–25 Considerations

### 21.1 Java 8 Reality

Common realities:

```text
- legacy Servlet apps,
- older Spring Security versions,
- JKS still common,
- older TLS defaults,
- local password auth,
- LDAP/AD integrations,
- session-heavy monoliths.
```

Design advice:

```text
- do not introduce fragile custom JWT libraries,
- prefer battle-tested frameworks,
- improve password/session/key hygiene first,
- plan migration path.
```

### 21.2 Java 11/17/21 Modern Baseline

Better baseline:

```text
- stronger TLS/runtime defaults,
- modern Spring Boot/Spring Security compatibility,
- container/runtime improvements,
- better observability tooling,
- virtual thread option from Java 21.
```

Design advice:

```text
- standardize Resource Server boundaries,
- use OIDC/OAuth2 libraries,
- avoid custom crypto,
- model context propagation explicitly.
```

### 21.3 Java 25 Direction

Relevant areas:

```text
- modern crypto/key material APIs continue improving,
- virtual threads/structured concurrency affect context propagation,
- PEM/KDF improvements affect key management ergonomics.
```

Design advice:

```text
- do not rely on accidental ThreadLocal behavior,
- design security context propagation consciously,
- centralize key loading/rotation logic,
- keep algorithm agility.
```

---

## 22. Production Decision Checklist

Use this before approving an authentication architecture.

### 22.1 Actor and Trust

```text
[ ] Actor types identified.
[ ] Human, service, device, job, partner separated.
[ ] IdP/issuer authority defined.
[ ] Tenant/issuer relationship defined.
[ ] Internal subject id stable.
```

### 22.2 Protocol and Flow

```text
[ ] Flow matches client type.
[ ] Public clients use PKCE.
[ ] Browser high-risk apps avoid long-lived browser tokens.
[ ] Service clients use confidential credentials.
[ ] Redirect URI/state/nonce handled correctly.
```

### 22.3 Token and Session

```text
[ ] Token type chosen intentionally.
[ ] Issuer validation exists.
[ ] Audience validation exists.
[ ] Expiration validation exists.
[ ] Clock skew policy exists.
[ ] Refresh token policy exists.
[ ] Revocation strategy exists.
[ ] Session rotation exists.
[ ] Logout semantics defined.
```

### 22.4 Key and Secret

```text
[ ] Key owner defined.
[ ] Key rotation plan defined.
[ ] JWKS/cache behavior defined.
[ ] Secret storage defined.
[ ] Emergency key compromise runbook exists.
[ ] Environment separation enforced.
```

### 22.5 Distributed Systems

```text
[ ] Edge auth and internal auth separated.
[ ] Service identity exists.
[ ] User delegation model exists.
[ ] Token relay/exchange decision documented.
[ ] Async/message identity modeled.
[ ] Gateway header trust protected.
```

### 22.6 Audit and Forensics

```text
[ ] Login success/failure logged.
[ ] MFA/step-up logged.
[ ] Token refresh/revocation logged.
[ ] Service credential use logged.
[ ] Actor/client/service identities logged.
[ ] Correlation and causation ids logged.
[ ] Sensitive data not overlogged.
```

### 22.7 Failure Behavior

```text
[ ] IdP outage behavior defined.
[ ] JWKS endpoint outage behavior defined.
[ ] Introspection outage behavior defined.
[ ] Session store outage behavior defined.
[ ] Login storm behavior defined.
[ ] Rate limit and brute-force controls defined.
[ ] Fail-open/fail-closed decisions documented.
```

---

## 23. Minimal Design Documents You Should Produce

For serious systems, authentication design should not live only in code.

Produce at least:

```text
1. Actor and trust boundary diagram.
2. Authentication flow diagram.
3. Token/session lifecycle diagram.
4. Claim mapping table.
5. Key/secret lifecycle document.
6. Failure mode table.
7. Audit event model.
8. Migration/cutover plan.
9. Incident response runbook.
10. Test strategy.
```

### 23.1 Claim Mapping Table Example

| Source Claim | Internal Field | Mutable? | Authoritative? | Notes |
|---|---|---:|---:|---|
| `iss` | issuer_id | No | Yes | Trust anchor |
| `sub` | external_subject | No | Yes | Pair with issuer |
| `email` | email | Yes | Maybe | Do not use as primary ID |
| `groups` | external_groups | Yes | Maybe | Map to app roles |
| `tenant_id` | tenant_id | Maybe | Yes | Validate against request tenant |
| `acr` | assurance_level | Yes | Yes | Useful for step-up |

### 23.2 Failure Mode Table Example

| Failure | Impact | Detection | Mitigation |
|---|---|---|---|
| JWKS endpoint down | New key validation fails | auth error spike | cache old keys with TTL |
| IdP down | login unavailable | IdP health alert | existing sessions continue if safe |
| token leaked | unauthorized API use | anomaly detection | short exp, revoke, rotate |
| session store down | user requests fail | Redis alert | degrade or fail closed |
| wrong audience accepted | token confusion | security test | strict audience validation |

---

## 24. How to Explain Authentication Architecture in Review

A strong architecture review answer should sound like this:

```text
We have three actor classes: browser users, backend services, and async workers.

Browser users authenticate through OIDC Authorization Code + PKCE. The browser receives
only an HttpOnly Secure SameSite session cookie. Tokens are stored server-side by the BFF.

Internal APIs are Resource Servers. They validate issuer, audience, expiry, and key id.
For downstream calls, we do not blindly relay edge tokens. We use token exchange where
delegation is required and service credentials where the operation is system-owned.

Service-to-service traffic is protected with mTLS at the mesh/gateway layer. Application
tokens still carry audience and scope because network-level identity alone is not enough.

For async events, we do not put raw access tokens on Kafka. We store stable actor metadata,
correlation id, causation id, producer service identity, and domain event id.

Audit events include auth method, assurance level, client id, service id, actor id,
tenant id, and session/token hash. This lets us reconstruct who authenticated, how,
through which client, and which service executed the action.
```

That level of explanation is far above “we use JWT”.

---

## 25. Scenario-Based Recommendations

### 25.1 “We Need Login for a Java Web App”

Default:

```text
OIDC Authorization Code + PKCE + server-side session.
```

Avoid:

```text
custom password login unless there is strong reason.
```

### 25.2 “We Need SPA Login”

Default for serious enterprise:

```text
SPA + BFF + session cookie.
```

Alternative:

```text
SPA direct Code + PKCE for lower-risk APIs with careful token handling.
```

### 25.3 “We Need Partner API”

Default:

```text
OAuth2 client credentials + mTLS.
```

Add:

```text
HMAC request signing for replay/integrity-sensitive operations.
```

Avoid:

```text
one static API key shared by all partners.
```

### 25.4 “We Need Internal Microservice Auth”

Default:

```text
mTLS/service identity + OAuth2 audience-bound token.
```

Use:

```text
token exchange for delegated user action.
```

Avoid:

```text
global JWT accepted everywhere.
```

### 25.5 “We Need Fast API Token Validation”

Default:

```text
JWT local validation.
```

But only if:

```text
issuer, audience, exp, nbf, algorithm, kid, and key rotation are handled.
```

### 25.6 “We Need Immediate Access Revocation”

Default:

```text
opaque token introspection or stateful session.
```

Alternative:

```text
short-lived JWT + emergency denylist.
```

### 25.7 “We Need High-Assurance User Auth”

Default:

```text
OIDC/SAML + MFA + step-up.
```

Stronger:

```text
WebAuthn/passkey as first or second factor.
```

### 25.8 “We Need Legacy AD Login”

Default:

```text
OIDC/SAML via corporate IdP if possible.
```

Fallback:

```text
LDAP bind or Kerberos/SPNEGO.
```

Avoid:

```text
direct password synchronization into app database.
```

---

## 26. Common Trade-Offs

### 26.1 JWT vs Opaque Token

JWT:

```text
+ local validation
+ low latency
+ works if AS temporarily unavailable
- hard immediate revocation
- claim staleness
- token bloat
```

Opaque:

```text
+ central revocation
+ smaller token
+ central policy
- introspection latency
- dependency on AS
- caching complexity
```

### 26.2 Session vs Token

Session:

```text
+ browser-friendly
+ central invalidation
+ mature CSRF/cookie controls
- session store scaling
- cross-domain complexity
```

Token:

```text
+ API-friendly
+ works well across services
+ stateless validation possible
- leakage risk
- revocation complexity
- browser storage risk
```

### 26.3 mTLS vs HMAC

mTLS:

```text
+ strong transport-level client auth
+ private key proof
+ works well service-to-service
- cert lifecycle complexity
- termination boundary complexity
```

HMAC:

```text
+ request-level integrity
+ replay window control
+ useful across proxies
- canonicalization complexity
- shared secret lifecycle
```

### 26.4 OIDC vs SAML

OIDC:

```text
+ JSON/HTTP friendly
+ modern app ecosystem
+ mobile/SPAs/API integration better
```

SAML:

```text
+ enterprise legacy support
+ mature federation with older IdPs
+ XML signature complexity
```

### 26.5 BFF vs SPA Direct Token

BFF:

```text
+ safer browser token posture
+ simpler backend control
+ good for high-value systems
- more backend complexity
```

SPA direct:

```text
+ simpler architecture
+ fewer backend layers
- token in browser
- harder refresh/logout security
```

---

## 27. Anti-Pattern Catalog

### 27.1 Authentication By Header Convention

```text
X-User-Id: 123
```

Bad unless:

```text
- header is injected only by trusted gateway,
- backend cannot be reached directly,
- header is signed or protected by mTLS,
- service still validates trust boundary.
```

### 27.2 Permanent Admin Token

```text
ADMIN_TOKEN=...
```

Bad because:

```text
- no human accountability,
- hard rotation,
- large blast radius,
- often bypasses audit.
```

### 27.3 Shared Service Account For Everything

```text
client_id=backend-service
```

used by all services.

Bad because:

```text
- no service-level accountability,
- no least privilege,
- no targeted revocation.
```

### 27.4 Auth Logic Spread Across Controllers

Bad because:

```text
- inconsistent behavior,
- hard testing,
- easy bypass,
- no central audit.
```

Better:

```text
- authentication in framework/security layer,
- authorization in policy/service layer,
- business invariants in domain layer.
```

### 27.5 Long-Lived Bearer Token Without Sender Constraint

Bad because:

```text
- stolen token is usable by attacker,
- no proof-of-possession,
- revocation often weak.
```

Better:

```text
- short lifetime,
- refresh rotation,
- mTLS-bound token,
- DPoP where appropriate,
- introspection for high-risk APIs.
```

---

## 28. Architecture Review Rubric

Score your design from 1 to 5.

### 28.1 Identity Clarity

```text
1 = user/service/client identity mixed
3 = mostly separated, some ambiguity
5 = actor, client, service, tenant, delegation explicit
```

### 28.2 Protocol Fit

```text
1 = mode chosen by familiarity
3 = mostly matches client type
5 = each flow selected based on actor, channel, and assurance
```

### 28.3 Token/Session Lifecycle

```text
1 = token issued and forgotten
3 = expiry and basic refresh defined
5 = rotation, revocation, replay, logout, incident response defined
```

### 28.4 Distributed Boundary

```text
1 = gateway auth only
3 = internal validation for some services
5 = edge/internal/service/async identity model explicit
```

### 28.5 Auditability

```text
1 = only business logs
3 = login logs exist
5 = authentication, delegation, service execution, and async chain reconstructable
```

### 28.6 Failure Handling

```text
1 = unknown behavior on IdP/JWKS/session outage
3 = some fallback behavior
5 = fail-open/fail-closed decisions documented and tested
```

### 28.7 Migration Safety

```text
1 = big-bang change
3 = staged rollout
5 = dual-run, rollback, audit comparison, compatibility mapping
```

---

## 29. A Practical Selection Table

| System Type | Recommended Baseline | Strengthen With | Avoid |
|---|---|---|---|
| Public Java web | OIDC + BFF session | MFA, passkey | localStorage refresh token |
| Enterprise internal app | OIDC/SAML + session | MFA, step-up | app-owned passwords |
| SPA/API | BFF session or Code+PKCE | CSP, short token | implicit flow |
| Mobile | Code+PKCE system browser | refresh rotation, device binding | embedded webview |
| CLI | Device flow / PKCE | secure local storage | permanent API key |
| Partner API | client credentials + mTLS | HMAC signing | shared API key |
| Internal service | mTLS + audience token | token exchange | global JWT |
| Async worker | workload identity | signed event metadata | raw user JWT in queue |
| Admin console | OIDC/SAML + MFA | step-up, JIT privilege | same session as normal user |
| Multi-tenant | issuer/tenant-aware validation | tenant-specific keys | email as global principal |

---

## 30. Source Anchors

This part is grounded in the following primary references and standards:

1. Spring Security Resource Server JWT audience/issuer validation  
   `https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html`

2. OAuth 2.0 Security Best Current Practice, RFC 9700  
   `https://www.rfc-editor.org/info/rfc9700/`

3. OpenID Connect Core 1.0  
   `https://openid.net/specs/openid-connect-core-1_0.html`

4. OAuth 2.0 Token Exchange, RFC 8693  
   `https://www.rfc-editor.org/info/rfc8693/`

5. OAuth 2.0 Mutual TLS Client Authentication and Certificate-Bound Access Tokens, RFC 8705  
   `https://datatracker.ietf.org/doc/html/rfc8705`

6. OWASP Authentication Cheat Sheet  
   `https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html`

7. OWASP Session Management Cheat Sheet  
   `https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html`

8. OWASP API Security Top 10 2023 — Broken Authentication  
   `https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/`

9. NIST SP 800-204A — Building Secure Microservices-based Applications Using Service-Mesh Architecture  
   `https://csrc.nist.gov/pubs/sp/800/204/a/final`

---

## 31. Summary

Authentication architecture is not a technology choice. It is a system design discipline.

A strong authentication architecture answers:

```text
Who is the actor?
What proof do they present?
Who issued or validated that proof?
What boundary does the proof cross?
What lifecycle governs the credential/session/token?
How is the identity propagated?
How is delegation represented?
How is misuse detected?
How is access revoked?
How is the event reconstructed later?
```

The top-level design rule:

```text
Choose authentication mode from actor + channel + trust boundary + assurance + lifecycle,
not from framework familiarity.
```

The strongest recurring patterns are:

```text
- OIDC + BFF session for high-value browser apps.
- Authorization Code + PKCE for public clients.
- OAuth2 client credentials/private_key_jwt/mTLS for machine clients.
- JWT when local validation and latency matter.
- Opaque token/session when revocation and central control matter.
- Token exchange when delegation crosses service boundary.
- mTLS/service mesh for workload identity.
- MFA/step-up for privileged or high-risk actions.
- Explicit audit identity model for defensibility.
```

If Part 0–33 gave you the components, Part 34 gives you the architecture selection lens.

---

## 32. What Comes Next

Next part:

```text
Part 35 — Capstone: Designing a Top 1% Authentication Architecture
```

Part 35 will apply the entire series to an end-to-end architecture design exercise with:

```text
- actor modeling,
- trust boundary diagram,
- mode selection,
- flow design,
- token/session lifecycle,
- key lifecycle,
- service-to-service authentication,
- async authentication,
- audit event model,
- failure mode table,
- review checklist,
- final architecture defense.
```

Status:

```text
Part 34 selesai.
Series belum selesai.
Part terakhir berikutnya adalah Part 35.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-033.md">⬅️ Part 33 — Migration Patterns: Legacy Java 8 to Modern Java 21/25 Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-035.md">Part 35 — Capstone: Designing a Top 1% Authentication Architecture ➡️</a>
</div>
