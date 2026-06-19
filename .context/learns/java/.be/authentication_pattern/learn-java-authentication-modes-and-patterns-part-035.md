# learn-java-authentication-modes-and-patterns-part-035

# Part 35 — Capstone: Designing a Top 1% Authentication Architecture

> Seri: `learn-java-authentication-modes-and-patterns`  
> Bagian: 35 dari 35  
> Topik: Capstone end-to-end authentication architecture  
> Target Java: Java 8 sampai Java 25  
> Status: Bagian terakhir

---

## 0. Tujuan Bagian Ini

Bagian ini adalah capstone. Artinya, kita tidak lagi mempelajari satu mode authentication secara terpisah seperti password, session, JWT, opaque token, OIDC, SAML, mTLS, API key, HMAC signing, WebAuthn, LDAP, Kerberos, atau client credentials. Di sini kita belajar cara **mendesain arsitektur authentication secara utuh**.

Seorang engineer biasa biasanya bertanya:

> “Pakai JWT atau session?”  
> “Pakai Keycloak atau Spring Security?”  
> “Pakai OAuth2 atau SAML?”

Engineer yang lebih matang bertanya:

> “Siapa aktornya?”  
> “Bukti authentication apa yang benar untuk boundary ini?”  
> “Di mana trust dimulai dan berhenti?”  
> “Token ini ditujukan untuk siapa?”  
> “Apa yang terjadi ketika IdP down?”  
> “Bagaimana kita revoke, rotate, audit, dan reconstruct incident?”  
> “Apa invariant yang harus tetap benar saat sistem gagal sebagian?”

Bagian ini akan membangun cara berpikir tersebut.

---

## 1. Ringkasan Mental Model Seluruh Series

Authentication bukan sekadar login. Authentication adalah proses sistem membentuk keyakinan terukur bahwa suatu request, session, service call, job, message, atau action berasal dari actor tertentu.

Authentication yang baik selalu menjawab lima pertanyaan:

1. **Who is the actor?**  
   User, service, batch job, external partner, device, admin, support operator, IdP, gateway, atau broker?

2. **What proof is presented?**  
   Password, cookie session, bearer token, signed JWT, opaque token, client certificate, SAML assertion, Kerberos ticket, API key, HMAC signature, WebAuthn assertion, atau workload identity?

3. **Who validates the proof?**  
   Application, framework, container, gateway, service mesh, authorization server, IdP, LDAP server, broker, atau trusted platform?

4. **What trust is established?**  
   Direct identity, delegated access, session continuity, proof-of-possession, tenant identity, workload identity, atau user-on-behalf-of-service identity?

5. **How is the trust bounded?**  
   Expiry, audience, issuer, tenant, scope, certificate chain, session timeout, refresh lifecycle, replay window, nonce, one-time challenge, revocation, audit event, and operational control.

Top 1% engineer tidak memilih teknologi authentication berdasarkan popularitas. Ia memilihnya berdasarkan **actor model, boundary, proof strength, operational model, incident response, dan auditability**.

---

## 2. Capstone Scenario

Kita akan mendesain authentication architecture untuk sistem Java enterprise/regulatory case management platform dengan karakter seperti berikut:

- public internet portal untuk external users;
- internal intranet portal untuk agency officers;
- backend Java services berbasis Spring Boot/Jakarta runtime;
- SPA frontend;
- BFF/API gateway layer;
- microservices internal;
- asynchronous events via Kafka/RabbitMQ/JMS;
- scheduled/batch jobs;
- integration dengan external agency/partner;
- audit trail yang harus defensible;
- multi-tenant atau multi-agency possibility;
- Java runtime campuran: legacy Java 8 service dan modern Java 21/25 service;
- deployment di Kubernetes/EKS atau equivalent container platform;
- identity provider eksternal seperti Keycloak, Entra ID, Okta, Ping, atau government IdP;
- high compliance requirement.

Tujuan desain:

1. User login aman.
2. Service-to-service authentication kuat.
3. Token/session lifecycle jelas.
4. Identity propagation tidak bocor.
5. Audit event bisa merekonstruksi tindakan.
6. Revocation dan incident handling tersedia.
7. Migration dari legacy tidak memerlukan big-bang rewrite.
8. Performance authentication tidak menjadi bottleneck besar.
9. Failure mode terencana.
10. Desain dapat dijelaskan kepada security reviewer, auditor, architect, developer, dan operator.

---

## 3. Requirement Discovery

Sebelum memilih mode authentication, lakukan requirement discovery. Ini lebih penting daripada memilih framework.

### 3.1 Pertanyaan tentang actor

Tanyakan:

- Siapa saja actor manusia?
- Apakah actor berasal dari public internet atau intranet?
- Apakah ada officer internal?
- Apakah ada support/admin impersonation?
- Apakah ada external partner API?
- Apakah ada service account?
- Apakah ada scheduler?
- Apakah ada event consumer yang bertindak atas nama user?
- Apakah ada batch job yang menjalankan action tanpa user aktif?
- Apakah ada device atau CLI client?

Contoh actor model:

| Actor | Channel | Authentication Mode | Risk |
|---|---|---|---|
| Public citizen/user | Browser internet | OIDC Authorization Code + PKCE + BFF session | phishing, session theft, CSRF |
| Agency officer | Intranet/browser | OIDC/SAML/AD federation + MFA | privilege abuse, stale role |
| System admin | Internal admin portal | OIDC + strong MFA + step-up | high privilege compromise |
| Partner system | HTTPS API | mTLS + OAuth client credentials/private_key_jwt | key leakage, replay |
| Internal service | Kubernetes network | workload identity/mTLS + JWT audience | confused deputy |
| Batch job | Scheduler | service identity + scoped token | overprivileged account |
| Event consumer | Broker | broker auth + message actor metadata | lost user context |
| Legacy Java 8 app | Internal network | adapter/proxy/OIDC bridge | inconsistent identity |

### 3.2 Pertanyaan tentang assurance

Tidak semua action butuh assurance yang sama.

| Action | Assurance Requirement |
|---|---|
| Browse public information | Low |
| View own profile | Medium |
| Submit regulatory application | Medium/high |
| Approve enforcement action | High |
| Change payout/bank/contact detail | High + step-up |
| Assign case officer | Medium/high |
| Admin user management | Very high |
| Export sensitive report | High + audit justification |

Authentication architecture harus mendukung step-up. Jangan membuat semua action memakai assurance rendah hanya karena login awal sukses.

### 3.3 Pertanyaan tentang compliance

Tanyakan:

- Apakah audit event harus legally defensible?
- Apakah user identity harus immutable?
- Apakah display name boleh berubah?
- Apakah actor harus bisa direkonstruksi setelah account dihapus?
- Apakah session/token event harus disimpan?
- Apakah ada regulatory retention?
- Apakah ada PII logging restriction?
- Apakah admin impersonation diperbolehkan?
- Apakah break-glass access dibutuhkan?

### 3.4 Pertanyaan tentang availability

Authentication sering menjadi single point of failure.

Tanyakan:

- Jika IdP down, apakah semua app harus down?
- Jika JWKS endpoint down, apakah resource server tetap bisa memvalidasi token dari cached key?
- Jika introspection endpoint down, fail-open atau fail-closed?
- Jika Redis session store down, apakah semua user logout?
- Jika LDAP/AD down, apakah internal login berhenti?
- Jika KMS/HSM down, apakah token signing berhenti?
- Jika gateway down, apakah service internal masih reachable?

Top 1% design selalu menyertakan failure policy, bukan hanya happy path.

---

## 4. System Boundary Model

Sebelum memilih authentication mode, gambar boundary.

```text
[Browser/User]
     |
     | 1. OIDC redirect / session cookie
     v
[Edge / WAF / ALB]
     |
     v
[BFF / API Gateway]
     |
     | 2. Internal token / token exchange / session-bound call
     v
[Java Application Services]
     |
     | 3. Service token / mTLS / workload identity
     v
[Domain Microservices]
     |
     | 4. Message identity / broker auth
     v
[Kafka/RabbitMQ/JMS]
     |
     v
[Workers / Batch / Scheduler]

[IdP / Authorization Server]
[LDAP / AD]
[KMS / HSM / Secret Manager]
[Audit Store]
[Observability Platform]
```

Setiap panah adalah boundary yang perlu authentication decision.

Kesalahan umum adalah menganggap login browser menyelesaikan authentication seluruh sistem. Padahal setelah login, request akan berubah bentuk:

- browser request menjadi backend request;
- backend request menjadi service call;
- service call menjadi event;
- event menjadi async worker action;
- worker action menjadi DB update;
- audit harus tetap tahu actor asli dan system actor yang mengeksekusi.

---

## 5. Authentication Decision Framework

Gunakan framework berikut untuk memilih mode.

### 5.1 Berdasarkan actor

| Actor Type | Recommended Pattern |
|---|---|
| Browser human user | OIDC Authorization Code + PKCE + BFF session |
| Server-rendered Java web app | Container/session or Spring session + OIDC login |
| SPA with backend | BFF session; avoid long-lived token in browser |
| Mobile/native app | Authorization Code + PKCE using system browser |
| CLI/device | Device Authorization Grant or Authorization Code + loopback |
| Partner API | mTLS + OAuth client credentials/private_key_jwt + scoped token |
| Internal service | mTLS/workload identity + token audience validation |
| Batch job | Service account + short-lived token + scoped permissions |
| Event consumer | Broker authentication + message actor metadata + audit event |
| Legacy app | Migration adapter, reverse proxy, or OIDC bridge |

### 5.2 Berdasarkan proof type

| Proof | Strength | Weakness |
|---|---:|---|
| Password | Low/medium | phishing, reuse, stuffing |
| Session cookie | Medium | theft, fixation, CSRF if weak |
| Bearer JWT | Medium | replay if stolen, revocation hard |
| Opaque token | Medium/high | introspection dependency |
| HMAC request signing | Medium/high | canonicalization complexity, shared secret |
| mTLS | High | PKI operational complexity |
| WebAuthn/passkey | High | recovery and device lifecycle |
| SAML assertion | Medium/high | XML signature pitfalls |
| Kerberos ticket | High in enterprise | environment complexity |
| API key | Low/medium | bearer secret leakage |

### 5.3 Berdasarkan state model

| Model | Use When | Avoid When |
|---|---|---|
| Server-side session | Browser apps, logout/revocation important | Massive stateless API-only workloads without session infra |
| JWT access token | Local validation, distributed resource servers | Immediate revocation is strict requirement |
| Opaque token | Central revocation/introspection required | Introspection endpoint cannot meet availability/latency need |
| mTLS | Strong service/partner identity | PKI operations immature |
| HMAC | Partner API request integrity | Client canonicalization cannot be standardized |

---

## 6. Recommended Reference Architecture

Untuk sistem enterprise/regulatory Java modern, desain rekomendasi:

```text
Browser
  -> BFF / Gateway
       - OIDC Authorization Code + PKCE
       - server-side session cookie
       - SameSite, Secure, HttpOnly
       - CSRF protection
       - session rotation
       - idle + absolute timeout

BFF / Gateway
  -> Internal Services
       - token exchange or service token
       - audience-limited JWT/opaque token
       - mTLS or workload identity
       - no blind user token relay unless explicitly needed

Internal Services
  -> Other Services
       - service identity
       - explicit delegation when acting for user
       - validate issuer/audience/scope/tenant

Services
  -> Broker
       - broker-level auth
       - producer identity
       - message metadata for original actor
       - signed/enveloped sensitive command where needed

Workers
  -> Domain DB
       - system actor + original actor persisted in audit
       - correlation ID and causation ID
```

### 6.1 Browser-facing authentication

Use:

- OIDC Authorization Code + PKCE;
- BFF session cookie;
- server-side session store;
- short-lived session ID rotation;
- step-up for high-risk actions;
- logout tied to session invalidation;
- CSRF protection for unsafe methods.

Avoid:

- storing long-lived access token in browser local storage;
- implicit flow;
- password grant;
- exposing refresh token directly to SPA;
- using JWT as browser session without revocation plan.

### 6.2 API-facing authentication

For external partner API:

- partner has registered client identity;
- use OAuth2 client credentials;
- prefer `private_key_jwt` or mTLS over static client secret for high assurance;
- issue audience-specific access token;
- optionally require request signing for high-risk non-repudiation/integrity;
- bind token to certificate for replay reduction if feasible;
- rate limit per client ID and tenant.

For public developer API:

- API key may identify application/client;
- do not treat API key as end-user identity;
- hash API key in storage;
- show full key only once;
- support rotation, expiration, revocation, scope, tenant binding.

### 6.3 Internal service authentication

Use:

- mTLS/workload identity at platform boundary;
- JWT/opaque token with explicit `aud` per service;
- service account identity;
- token exchange for user delegation;
- do not relay original user token through every service by default.

Key invariant:

> A service must reject tokens not intended for it.

This means `aud` validation is not optional in multi-service systems.

### 6.4 Async authentication

For events:

- broker authenticates producer/consumer;
- message contains `actor_type`, `actor_id`, `subject_id`, `tenant_id`, `correlation_id`, `causation_id`, `auth_time`, `assurance_level` where needed;
- do not trust message metadata just because it is present;
- trust only producers authorized to emit that event type;
- for high-risk commands, use message-level signature or command table with server-side authorization.

---

## 7. Core Invariants

A production authentication architecture should define invariants explicitly.

### Invariant 1 — Every authenticated action has an actor

No domain mutation should happen with anonymous, null, or ambiguous actor unless the use case explicitly allows system action.

Bad:

```text
created_by = null
updated_by = SYSTEM
```

Better:

```text
actor_type = USER
actor_id = user-123
subject_id = citizen-789
executing_service = case-service
correlation_id = c-abc
```

For batch:

```text
actor_type = SYSTEM_JOB
actor_id = renewal-expiry-job
triggered_by = scheduler
original_actor = null
```

For delegated action:

```text
actor_type = SERVICE
actor_id = notification-service
on_behalf_of_user = officer-123
reason = send_case_update_notification
```

### Invariant 2 — Authentication and authorization are separate but connected

Authentication establishes identity or client proof. Authorization decides whether that identity may perform the action.

Do not encode authorization solely as authentication success.

Bad:

```java
if (jwtIsValid(token)) {
    approveCase(caseId);
}
```

Better:

```java
Authentication authentication = authenticate(token);
AuthorizationDecision decision = authorizationService.canApproveCase(authentication, caseId);
if (!decision.allowed()) {
    throw new AccessDeniedException(decision.reasonCode());
}
approveCase(caseId, authentication.actor());
```

### Invariant 3 — Token audience must match receiver

A token issued for `profile-service` must not be accepted by `case-service`.

Bad:

```text
valid signature + known issuer = accepted
```

Better:

```text
valid signature + issuer + audience + expiry + tenant + scope + token type = accepted
```

### Invariant 4 — Session privilege must be re-evaluated after risk changes

If user changes password, enables MFA, changes role, switches tenant, or performs high-risk action, session may need rotation, step-up, or invalidation.

### Invariant 5 — Revocation strategy must match risk

If immediate revocation is required, pure stateless JWT without introspection or short TTL is weak.

### Invariant 6 — Identity propagation must be explicit

Never rely on accidental ThreadLocal propagation for async/reactive/message flows.

### Invariant 7 — Audit identity must be immutable enough

Store stable IDs, not only display names or emails.

Bad:

```text
approved_by = "John Tan"
```

Better:

```text
approved_by_user_id = "user-8f12"
approved_by_login_id = "john.tan@example.gov"
approved_by_display_name_snapshot = "John Tan"
approved_by_idp = "agency-idp"
approved_at = "2026-06-19T10:15:30Z"
```

---

## 8. End-to-End Flow Design

### 8.1 User login flow

```text
1. User opens SPA/BFF app.
2. BFF detects no valid session.
3. BFF redirects to IdP authorization endpoint.
4. Request includes client_id, redirect_uri, response_type=code, scope, state, nonce, code_challenge.
5. IdP authenticates user and applies MFA if policy requires.
6. IdP redirects back with authorization code and state.
7. BFF validates state.
8. BFF exchanges code + code_verifier at token endpoint.
9. BFF validates ID Token: issuer, audience, expiry, nonce, signature, auth_time as needed.
10. BFF creates server-side session.
11. BFF rotates session ID.
12. BFF stores minimal user identity and token metadata server-side.
13. Browser receives Secure, HttpOnly, SameSite cookie.
14. Application loads user context from BFF/session.
```

Key checks:

- redirect URI exact match;
- state validation;
- nonce validation;
- PKCE validation;
- issuer validation;
- audience validation;
- signature validation;
- expiry and clock skew;
- user account linking;
- tenant resolution;
- role/group normalization.

### 8.2 API request from browser to BFF

```text
1. Browser sends session cookie.
2. BFF validates session ID.
3. BFF checks CSRF token for unsafe method.
4. BFF loads user principal.
5. BFF checks route-level authorization.
6. BFF calls backend using service token or token exchange.
7. Backend validates internal token audience.
8. Backend performs domain authorization.
9. Backend writes audit event.
```

Do not let frontend directly decide role-sensitive behavior. Frontend can hide buttons, but backend must enforce.

### 8.3 Service-to-service flow

```text
1. case-service needs profile-service data.
2. case-service obtains token for audience=profile-service.
3. profile-service validates token issuer, audience, expiry, subject/service identity.
4. profile-service checks whether case-service may call this API.
5. profile-service returns only allowed data.
6. Both services log correlation ID.
```

If user context matters:

```text
case-service exchanges incoming user-context token for delegated token:
subject = case-service
actor = officer-123
audience = profile-service
scope = read:profile-for-case
```

This is safer than blindly forwarding the browser access token everywhere.

### 8.4 Event-driven flow

```text
1. Officer approves case in UI.
2. case-service authenticates request and authorizes action.
3. case-service persists approval and outbox event atomically.
4. outbox publisher emits CaseApproved event.
5. Event includes actor snapshot and correlation ID.
6. notification-service consumes event.
7. notification-service authenticates to broker as notification-service.
8. notification-service validates event source/topic/schema.
9. notification-service sends notification as system actor caused by officer action.
10. audit trail links notification to original approval event.
```

Important distinction:

- Broker authentication proves which service produced/consumed.
- Message actor metadata explains why the event exists.
- Domain authorization happened before event emission.

---

## 9. Java Implementation Architecture

### 9.1 Layering

A clean Java authentication architecture should separate:

```text
Transport Security Layer
  - TLS/mTLS
  - client certificate
  - headers/cookies

Authentication Adapter Layer
  - Spring Security filter
  - Jakarta Security mechanism
  - Servlet container auth
  - token validator
  - API key validator

Identity Normalization Layer
  - Principal mapping
  - tenant mapping
  - role/group mapping
  - assurance mapping

Authorization Layer
  - permissions
  - policies
  - domain rules

Audit Layer
  - immutable actor snapshot
  - event model
  - correlation/causation

Domain Layer
  - business state changes
```

Do not allow domain code to parse JWT, inspect cookies, or read raw headers.

Bad:

```java
String token = request.getHeader("Authorization").substring(7);
String userId = parseJwt(token).get("sub");
caseService.approve(caseId, userId);
```

Better:

```java
AuthenticatedActor actor = currentActorProvider.requiredActor();
caseApplicationService.approveCase(new ApproveCaseCommand(caseId, actor));
```

### 9.2 Canonical internal actor model

Create internal model independent of IdP/framework.

```java
public enum ActorType {
    HUMAN_USER,
    SERVICE,
    SYSTEM_JOB,
    PARTNER_CLIENT,
    ADMIN_IMPERSONATION,
    ANONYMOUS
}
```

```java
public record AuthenticatedActor(
        ActorType type,
        String actorId,
        String subjectId,
        String tenantId,
        String issuer,
        String authenticationMethod,
        String assuranceLevel,
        Instant authenticatedAt,
        Set<String> authorities,
        Map<String, String> attributes
) {
    public boolean isHuman() {
        return type == ActorType.HUMAN_USER || type == ActorType.ADMIN_IMPERSONATION;
    }
}
```

For Java 8, use immutable class instead of record.

Why this matters:

- Spring `Authentication` is framework-specific.
- Jakarta `Principal` is too thin.
- JWT claims are protocol-specific.
- SAML attributes are IdP-specific.
- Domain needs stable canonical identity.

### 9.3 Current actor provider

```java
public interface CurrentActorProvider {
    Optional<AuthenticatedActor> currentActor();

    default AuthenticatedActor requiredActor() {
        return currentActor().orElseThrow(() -> new UnauthenticatedException("No authenticated actor"));
    }
}
```

Spring implementation can read `SecurityContextHolder`. Jakarta implementation can read `SecurityContext`. Async/message implementation can read explicit metadata.

### 9.4 Avoiding identity leakage

Never design your domain logic around ThreadLocal directly. ThreadLocal may work in servlet synchronous flows, but becomes fragile in async, executor, virtual thread, or reactive pipelines.

Better patterns:

- pass `AuthenticatedActor` explicitly in command objects;
- use framework context only at boundary;
- convert boundary identity to domain command;
- in async event, persist actor snapshot;
- in batch job, create system actor explicitly.

---

## 10. Token and Session Lifecycle Design

### 10.1 Browser session lifecycle

Recommended:

| Event | Action |
|---|---|
| Login success | Create session and rotate session ID |
| Privilege elevation | Rotate session ID and record assurance |
| Idle timeout | Invalidate session |
| Absolute timeout | Force reauthentication |
| Password change | Invalidate other sessions |
| MFA enrollment/reset | Step-up and invalidate risky sessions |
| Logout | Invalidate local session; optionally initiate IdP logout |
| Suspicious activity | Revoke session and require reauth |

### 10.2 Access token lifecycle

Recommended:

- short TTL;
- audience-specific;
- issuer-specific;
- scope-limited;
- tenant-bound;
- no sensitive PII if avoidable;
- key rotation compatible;
- reject unknown `kid` unless JWKS refresh succeeds safely;
- validate token type.

### 10.3 Refresh token lifecycle

Recommended:

- store server-side for BFF;
- rotation with reuse detection for public clients;
- sender-constrained when possible;
- revoke on logout/security event;
- do not expose refresh token to browser JS;
- bind refresh token to client, tenant, session, and device when possible.

### 10.4 One-time token lifecycle

Used for:

- password reset;
- email verification;
- invite acceptance;
- account recovery;
- magic link.

Rules:

- one-time use;
- short TTL;
- store hash, not raw token;
- bind to purpose;
- bind to account/tenant;
- invalidate after use;
- do not reveal user enumeration;
- rate limit issuance.

---

## 11. Key Lifecycle Design

Authentication architecture is only as strong as its key management.

### 11.1 Key classes

| Key | Used For | Rotation Need |
|---|---|---|
| JWT signing key | token signing | planned + emergency |
| HMAC client secret | request signing | partner rotation |
| mTLS private key | TLS client/server auth | cert expiry/compromise |
| SAML signing key | assertion signing/verification | metadata rollover |
| Session signing/encryption key | cookie/session protection | planned + emergency |
| Password pepper | password hash hardening | rare, high impact |
| WebAuthn credential public key | passkey assertion validation | per credential lifecycle |

### 11.2 Rotation design

Key rotation requires overlap.

```text
Phase 1: publish new verification key
Phase 2: start signing with new key
Phase 3: accept old + new until old tokens expire
Phase 4: remove old key
Phase 5: archive rotation evidence
```

Emergency rotation is different:

```text
1. Stop signing with compromised key.
2. Remove or quarantine compromised verification key if risk requires.
3. Revoke active sessions/tokens if needed.
4. Force reauthentication.
5. Notify dependent systems.
6. Preserve forensic evidence.
```

### 11.3 Java-specific considerations

Java 8 reality:

- many systems still use JKS;
- PKCS12 supported but migration may be needed;
- PEM often handled through libraries or manual parsing;
- TLS configuration may be container/application-server specific.

Java 21/25 reality:

- stronger platform APIs;
- modern TLS defaults;
- better runtime support;
- virtual threads affect context propagation design;
- JDK 25 includes new/preview crypto-related capabilities relevant to key handling.

---

## 12. Audit and Forensics Design

### 12.1 Authentication event model

Minimum events:

```text
AUTH_LOGIN_STARTED
AUTH_LOGIN_SUCCEEDED
AUTH_LOGIN_FAILED
AUTH_MFA_CHALLENGE_ISSUED
AUTH_MFA_SUCCEEDED
AUTH_MFA_FAILED
AUTH_SESSION_CREATED
AUTH_SESSION_ROTATED
AUTH_SESSION_EXPIRED
AUTH_LOGOUT
AUTH_TOKEN_ISSUED
AUTH_TOKEN_REFRESHED
AUTH_TOKEN_REVOKED
AUTH_STEP_UP_REQUIRED
AUTH_STEP_UP_SUCCEEDED
AUTH_PASSWORD_CHANGED
AUTH_PASSWORD_RESET_REQUESTED
AUTH_PASSWORD_RESET_COMPLETED
AUTH_API_KEY_CREATED
AUTH_API_KEY_ROTATED
AUTH_API_KEY_REVOKED
AUTH_CLIENT_CERT_ACCEPTED
AUTH_CLIENT_CERT_REJECTED
AUTH_IDP_ERROR
```

### 12.2 Audit fields

Recommended fields:

```text
event_id
occurred_at
event_type
actor_type
actor_id
subject_id
tenant_id
session_id_hash
token_id_hash / jti_hash
client_id
issuer
audience
authentication_method
assurance_level
source_ip
user_agent_hash/device_id
service_name
endpoint/action
result
failure_reason_code
correlation_id
causation_id
request_id
risk_score
```

Do not log raw:

- password;
- token;
- session ID;
- API key;
- private key;
- authorization code;
- OTP;
- recovery code.

Log hashes or stable identifiers where needed.

### 12.3 Reconstruction questions

A good audit design can answer:

- Who logged in?
- Which IdP authenticated them?
- Which session was created?
- What assurance level was achieved?
- Which role/claims were used?
- Which action was executed?
- Was step-up required?
- Was token refreshed?
- Was a session revoked?
- Which service performed the final mutation?
- Was the action user-driven or system-driven?

---

## 13. Failure Handling Architecture

### 13.1 IdP outage

Options:

| Strategy | Behavior | Risk |
|---|---|---|
| Fail closed | No new login | safest but availability impact |
| Existing session continues | users already logged in continue until timeout | stale privilege risk |
| Cached identity fallback | limited internal use | complex, risky |
| Break-glass admin | emergency only | must be audited heavily |

Recommended:

- no new login if IdP unavailable;
- existing sessions continue until bounded timeout;
- high-risk step-up unavailable means high-risk actions blocked;
- admin break-glass has separate control and audit.

### 13.2 JWKS outage

Recommended:

- cache JWKS;
- continue validating with cached key within TTL/staleness policy;
- refresh on unknown `kid`;
- fail closed for unknown key if refresh unavailable;
- alert on repeated unknown `kid`.

### 13.3 Introspection outage

Options:

- fail closed for high-risk APIs;
- bounded cache for low/medium risk;
- circuit breaker;
- degraded mode;
- alert and dashboard.

### 13.4 Session store outage

Recommended:

- fail closed for mutation;
- possibly serve public/static content;
- no new sessions;
- clear error to user;
- operational alert.

### 13.5 Clock skew

Authentication protocols are time-sensitive.

Define:

- allowed skew window;
- NTP requirement;
- monitoring for host time drift;
- test cases for expiry/nbf/auth_time.

---

## 14. Security Review Checklist

Use this checklist before production.

### 14.1 Protocol checklist

- [ ] OIDC Authorization Code + PKCE used for browser/native flows.
- [ ] Implicit grant is not used.
- [ ] Password grant is not used for new systems.
- [ ] Redirect URI is exact and pre-registered.
- [ ] `state` is generated, stored, and validated.
- [ ] `nonce` is used and validated for OIDC.
- [ ] ID Token is validated before use.
- [ ] Access token is not treated as ID Token.
- [ ] `iss` is validated.
- [ ] `aud` is validated.
- [ ] Expiry and clock skew are enforced.
- [ ] Token type is checked where applicable.
- [ ] JWKS cache and rotation strategy exist.

### 14.2 Session checklist

- [ ] Session ID rotates after login.
- [ ] Session ID rotates after privilege elevation.
- [ ] Cookie has `HttpOnly`.
- [ ] Cookie has `Secure`.
- [ ] Cookie has appropriate `SameSite`.
- [ ] Idle timeout exists.
- [ ] Absolute timeout exists.
- [ ] Logout invalidates server-side session.
- [ ] CSRF protection exists for unsafe methods.
- [ ] Session store failure behavior is defined.

### 14.3 Service authentication checklist

- [ ] Service identity exists.
- [ ] Tokens are audience-specific.
- [ ] Service-to-service calls are authenticated.
- [ ] mTLS/workload identity considered for high-trust boundary.
- [ ] No blind token relay unless justified.
- [ ] Token exchange used where delegation is required.
- [ ] Internal gateway headers cannot be spoofed.
- [ ] Network trust is not treated as authentication.

### 14.4 API key/HMAC checklist

- [ ] API keys are stored hashed.
- [ ] API keys have prefix/key ID.
- [ ] API keys are scoped.
- [ ] API keys are tenant-bound.
- [ ] Rotation and revocation exist.
- [ ] HMAC canonical request is deterministic.
- [ ] Timestamp/nonce replay defense exists.
- [ ] Signature comparison is constant-time.

### 14.5 Audit checklist

- [ ] Login success/failure logged.
- [ ] Session creation/rotation/logout logged.
- [ ] Token issuance/refresh/revocation logged.
- [ ] MFA events logged.
- [ ] API key lifecycle logged.
- [ ] Authentication failure reason is safe and normalized.
- [ ] Raw secrets are never logged.
- [ ] Actor ID is stable.
- [ ] Tenant ID is recorded.
- [ ] Correlation ID exists.
- [ ] Audit store has retention policy.

---

## 15. Architecture Review Template

Use this template in real design review.

### 15.1 Context

```text
System:
Business capability:
Deployment environment:
Java versions:
Frameworks:
Identity provider:
User populations:
External integrations:
Compliance constraints:
```

### 15.2 Actor model

```text
Actor:
Channel:
Credential/proof:
Assurance level:
Tenant boundary:
Primary risks:
```

### 15.3 Authentication flow

```text
Entry point:
Protocol:
Session/token issued:
Validation point:
Principal mapping:
Failure behavior:
Logout/revocation behavior:
```

### 15.4 Token/session policy

```text
Token/session type:
TTL:
Idle timeout:
Absolute timeout:
Refresh strategy:
Revocation strategy:
Storage location:
Rotation policy:
```

### 15.5 Key policy

```text
Key type:
Owner:
Storage:
Access control:
Rotation frequency:
Emergency rotation:
Verification key publication:
Audit evidence:
```

### 15.6 Failure policy

```text
IdP outage:
JWKS outage:
Introspection outage:
Session store outage:
Broker auth outage:
KMS outage:
Clock skew:
```

### 15.7 Audit policy

```text
Events:
Fields:
PII handling:
Retention:
Correlation:
Forensics query examples:
```

---

## 16. Concrete Design: Regulatory Case Management Platform

### 16.1 Human user portal

Design:

- OIDC Authorization Code + PKCE;
- BFF-managed session;
- session cookie `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict` depending UX;
- CSRF token for unsafe methods;
- ID Token used only to authenticate login result;
- access token kept server-side if needed;
- refresh token kept server-side, encrypted or protected by secret manager/KMS;
- step-up for sensitive actions.

Why:

- browser does not need direct long-lived token access;
- session revocation is straightforward;
- CSRF can be managed;
- IdP integration remains standard;
- backend controls token exchange.

### 16.2 Internal officer portal

Design:

- federated IdP via OIDC/SAML/AD;
- MFA required;
- role/group mapping normalized into internal roles;
- high-risk action requires `auth_time` freshness or step-up;
- break-glass separated from normal admin.

Important:

- group names from IdP are not domain permissions;
- map external groups to internal roles through controlled configuration;
- store snapshot of role/claim used at decision time for audit.

### 16.3 Backend resource services

Design:

- resource services validate tokens;
- validate issuer and audience;
- use domain authorization inside service;
- do not rely solely on gateway;
- service has no direct dependency on browser cookie.

### 16.4 Partner integration

Design:

- partner registers client;
- mTLS or private key JWT client authentication;
- client credentials grant;
- audience-specific token;
- narrow scopes;
- rate limiting;
- audit by client ID and tenant.

High-risk partner command:

- require request signing or idempotency key;
- store request digest;
- detect replay;
- sign response if non-repudiation is needed.

### 16.5 Asynchronous processing

Design:

- producer authenticates to broker;
- consumer authenticates to broker;
- event carries actor snapshot;
- outbox pattern ensures mutation and event consistency;
- worker writes audit event with both executing service and original actor.

Example event actor block:

```json
{
  "actor": {
    "type": "HUMAN_USER",
    "actorId": "officer-123",
    "tenantId": "agency-a",
    "authenticationMethod": "oidc+mfa",
    "assuranceLevel": "high",
    "authenticatedAt": "2026-06-19T03:15:30Z"
  },
  "execution": {
    "producerService": "case-service",
    "correlationId": "corr-001",
    "causationId": "cmd-approve-001"
  }
}
```

---

## 17. Anti-Patterns to Reject

### 17.1 “JWT means stateless and scalable”

JWT can reduce central lookup, but creates revocation, key rotation, claim staleness, and token theft problems. Scalability is not free.

### 17.2 “Internal network is trusted”

Network location is not identity. Internal services still need authentication.

### 17.3 “Gateway authenticated it, so services can trust everything”

Services should validate relevant identity boundary, especially for high-impact operations. At minimum, protect against spoofed headers and unintended bypass paths.

### 17.4 “API key is user authentication”

API key usually identifies client/application, not human user.

### 17.5 “Valid signature means valid token”

Signature is only one check. Need issuer, audience, expiry, key, token type, tenant, and sometimes scope/assurance.

### 17.6 “Logout is just deleting cookie”

Server-side session, refresh token, IdP session, and downstream token lifecycle may all matter.

### 17.7 “ThreadLocal identity is enough”

ThreadLocal breaks conceptually across async/reactive/message boundaries and must be handled explicitly.

### 17.8 “Audit log can be added later”

Auditability must be part of authentication design because actor context is lost if not captured at action time.

---

## 18. Testing Strategy for the Capstone

A top-level authentication design should be tested as a system.

### 18.1 Protocol tests

- valid OIDC login;
- invalid state;
- invalid nonce;
- expired ID Token;
- wrong issuer;
- wrong audience;
- unknown `kid`;
- stale JWKS;
- clock skew boundary;
- redirect URI mismatch.

### 18.2 Session tests

- session created after login;
- session ID rotates after login;
- logout invalidates session;
- idle timeout;
- absolute timeout;
- CSRF required for mutation;
- session fixation attempt rejected;
- concurrent session behavior.

### 18.3 Service tests

- token for service A rejected by service B;
- missing audience rejected;
- expired token rejected;
- insufficient scope rejected;
- gateway header spoof rejected;
- service token cannot perform user-only action.

### 18.4 Async tests

- event without actor metadata rejected or classified;
- unauthorized producer cannot emit command;
- replayed event detected if command semantics require it;
- audit causation chain preserved.

### 18.5 Failure tests

- IdP unavailable;
- JWKS unavailable;
- introspection unavailable;
- session store unavailable;
- KMS unavailable;
- broker auth failure;
- clock skew.

---

## 19. Operational Runbook

### 19.1 Token signing key compromise

```text
1. Declare security incident.
2. Stop signing with compromised key.
3. Generate new key in approved key store/HSM/KMS.
4. Publish new verification key.
5. Remove compromised key if risk requires immediate invalidation.
6. Revoke refresh tokens/sessions depending blast radius.
7. Force reauthentication for impacted users/clients.
8. Monitor failed validation and unknown key usage.
9. Preserve logs and key access audit.
10. Produce incident report.
```

### 19.2 Client secret/API key leak

```text
1. Identify key/client.
2. Disable or restrict key.
3. Notify owner if external.
4. Issue replacement credential.
5. Search logs for suspicious use.
6. Rotate related secrets.
7. Review scope and rate limits.
8. Add detection rule.
```

### 19.3 Account compromise

```text
1. Disable or lock account.
2. Revoke sessions and refresh tokens.
3. Force password reset or re-enrollment depending factor.
4. Review MFA devices/passkeys.
5. Review audit trail for sensitive actions.
6. Notify affected stakeholders.
7. Preserve evidence.
```

### 19.4 IdP outage

```text
1. Confirm IdP availability.
2. Switch login page to degraded message.
3. Allow existing bounded sessions if policy permits.
4. Block high-risk step-up actions if step-up unavailable.
5. Monitor session expiry wave.
6. Communicate recovery status.
```

---

## 20. Java 8 to Java 25 Compatibility Strategy

### 20.1 Java 8 services

Use:

- stable Spring Security versions compatible with runtime;
- adapter service for OIDC if direct upgrade hard;
- reverse proxy/BFF for browser auth modernization;
- explicit internal actor model;
- avoid introducing fragile custom crypto;
- backport token validation with vetted libraries.

### 20.2 Java 11/17/21/25 services

Use:

- modern Spring Security/Jakarta Security;
- resource server validation;
- virtual thread awareness;
- structured context passing;
- stronger TLS defaults;
- modern key management support;
- improved observability.

### 20.3 Migration rule

Do not migrate protocol, runtime, framework, identity store, role model, and session model all at once unless necessary.

Safer order:

```text
1. Introduce audit/observability.
2. Normalize internal actor model.
3. Add gateway/BFF identity boundary.
4. Federate login to IdP.
5. Introduce token validation to services.
6. Migrate roles/claims.
7. Reduce legacy password/session dependencies.
8. Remove legacy auth paths.
```

---

## 21. Final Architecture Decision Matrix

| Requirement | Prefer | Avoid |
|---|---|---|
| Browser app with sensitive data | OIDC + BFF session | Long-lived token in localStorage |
| SPA with backend | BFF pattern | Direct token-heavy SPA unless carefully controlled |
| Mobile app | Auth Code + PKCE system browser | Embedded webview login |
| Partner API high assurance | mTLS/private_key_jwt + client credentials | Static shared API key only |
| Internal microservices | mTLS/workload identity + audience token | Network trust only |
| Immediate revocation | Server session/opaque token/introspection | Long-lived stateless JWT only |
| High-scale local validation | Short-lived JWT + JWKS cache | Introspection for every request without cache |
| Enterprise SSO legacy | SAML/OIDC federation | Local password duplication |
| Passwordless | WebAuthn/passkeys | Email magic link as sole high-risk factor |
| Async command processing | Authenticated producer + actor snapshot | Trusting arbitrary message fields |
| Compliance audit | Immutable actor event model | Free-text logs only |

---

## 22. Final Design Principles

1. **Authenticate at every meaningful boundary.**  
   Browser, gateway, service, broker, worker, and admin path each need explicit identity handling.

2. **Validate more than signatures.**  
   Signature without issuer, audience, expiry, token type, tenant, and key lifecycle is incomplete.

3. **Prefer bounded trust.**  
   Short TTL, scoped token, tenant-bound identity, audience-specific access, and explicit delegation.

4. **Treat sessions as stateful security objects.**  
   They need rotation, timeout, invalidation, audit, and incident response.

5. **Do not confuse client identity with user identity.**  
   API key/client credentials identify client/service, not necessarily human actor.

6. **Do not let protocol objects leak into domain logic.**  
   Convert JWT/SAML/session/container principal into canonical actor model at boundary.

7. **Design for failure before production.**  
   IdP, JWKS, introspection, session store, KMS, and broker can fail.

8. **Audit at action time.**  
   Actor context must be captured when decision/action occurs, not reconstructed later from mutable user profile.

9. **Make high-risk actions require higher assurance.**  
   MFA/step-up is a policy tool, not just a login decoration.

10. **Make migration reversible.**  
   Authentication migration should have dual-run, fallback, rollback, metrics, and audit.

---

## 23. What “Top 1% Authentication Engineering” Looks Like

A top-tier engineer can explain:

- why OAuth2 is not the same as authentication;
- why OIDC adds ID Token and authentication semantics;
- why browser apps often benefit from BFF sessions;
- why JWT is not automatically better than opaque token;
- why audience validation is critical;
- why token relay can create confused deputy problems;
- why internal network is not identity;
- why async events need actor snapshots;
- why audit must be designed with authentication;
- why key rotation is part of authentication architecture;
- why failure mode matters as much as happy path;
- why framework configuration is only the last mile.

The essence:

> Authentication architecture is the engineering of trust boundaries, proof validation, identity propagation, lifecycle control, and evidence preservation.

---

## 24. Final Summary

In this capstone, we designed authentication as an end-to-end architecture rather than a feature.

We covered:

- requirement discovery;
- actor modeling;
- boundary mapping;
- mode selection;
- browser/BFF/session design;
- OAuth/OIDC service design;
- partner API authentication;
- service-to-service authentication;
- async/event authentication;
- Java implementation layering;
- canonical actor model;
- token/session lifecycle;
- key lifecycle;
- audit and forensics;
- failure handling;
- security checklist;
- testing strategy;
- operational runbook;
- Java 8 to Java 25 migration;
- final decision matrix.

This completes the `learn-java-authentication-modes-and-patterns` series.

---

## 25. References

- Oracle Java SE 25 Security Guide — JAAS Reference Guide: https://docs.oracle.com/en/java/javase/25/security/java-authentication-authorization-service-jaas-reference-guide.html
- Spring Security Reference — Servlet OAuth2 Resource Server JWT: https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html
- Spring Security Reference — Authentication Architecture: https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html
- Spring Security Reference — Session Management: https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- RFC 6749 — OAuth 2.0 Authorization Framework: https://datatracker.ietf.org/doc/html/rfc6749
- RFC 7636 — PKCE: https://datatracker.ietf.org/doc/html/rfc7636
- RFC 7662 — OAuth 2.0 Token Introspection: https://datatracker.ietf.org/doc/html/rfc7662
- RFC 8693 — OAuth 2.0 Token Exchange: https://datatracker.ietf.org/doc/html/rfc8693
- RFC 8705 — OAuth 2.0 Mutual TLS Client Authentication and Certificate-Bound Access Tokens: https://datatracker.ietf.org/doc/html/rfc8705
- RFC 9700 — OAuth 2.0 Security Best Current Practice: https://datatracker.ietf.org/doc/html/rfc9700
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- NIST SP 800-63B Digital Identity Guidelines — Authentication and Lifecycle Management: https://pages.nist.gov/800-63-3/sp800-63b.html

---

## 26. Status Series

`learn-java-authentication-modes-and-patterns` selesai.

Total bagian:

- Part 0 sampai Part 35
- 36 file markdown
- Status: selesai / mencapai bagian terakhir

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-034.md">⬅️ Part 34 — Reference Architectures and Decision Framework</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
