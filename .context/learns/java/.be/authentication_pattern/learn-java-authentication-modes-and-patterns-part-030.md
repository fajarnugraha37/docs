# learn-java-authentication-modes-and-patterns-part-030

# Part 30 — Observability, Audit, and Forensics for Authentication

## Status

**Series:** Java Authentication Modes and Patterns  
**Part:** 30 of 35  
**Level:** Advanced / Production Engineering  
**Scope:** Java 8–25, Servlet/Jakarta, Spring Security, OAuth2/OIDC, SAML, mTLS, API key, messaging, distributed systems  
**Goal:** Membuat authentication bukan hanya “berhasil/gagal”, tetapi dapat diamati, diaudit, dijelaskan, dan direkonstruksi saat terjadi insiden.

---

## 1. Problem yang Diselesaikan

Authentication sering dianggap selesai ketika sistem bisa menjawab:

> user ini boleh login atau tidak?

Di sistem production, pertanyaannya jauh lebih besar:

1. Siapa yang mencoba masuk?
2. Siapa yang berhasil masuk?
3. Dari mana, menggunakan metode apa, dengan device/session/client apa?
4. Apakah login ini normal atau abnormal?
5. Apakah token/session yang dipakai valid, dicuri, di-replay, atau disalahgunakan?
6. Apakah ada brute force, credential stuffing, password spraying, MFA fatigue, session fixation, atau token substitution?
7. Apakah kita bisa membuktikan urutan kejadian saat audit/regulator bertanya?
8. Apakah log cukup aman sehingga tidak membocorkan credential/token/PII?
9. Apakah kita bisa menghubungkan event login, token issuance, API call, async job, message consumption, dan data change?
10. Apakah kita bisa menjelaskan “who did what, when, from where, through which authentication path, under which assurance level?”

Part ini menyelesaikan masalah tersebut dengan membangun model **authentication observability**.

Kita tidak hanya membahas logging. Kita akan membedakan:

- **Application log**: informasi runtime untuk debugging dan operasi.
- **Security log**: informasi keamanan untuk deteksi dan respons.
- **Audit log**: bukti historis yang tahan investigasi.
- **Trace**: aliran request lintas service.
- **Metric**: agregasi numerik untuk alerting dan trend.
- **Forensic evidence**: data yang bisa dipakai untuk rekonstruksi insiden.

Authentication tanpa observability adalah black box. Black box mungkin terlihat bekerja, tetapi tidak bisa dipercaya saat terjadi anomali.

---

## 2. Mental Model: Authentication as Evidence-Producing State Machine

Authentication bukan hanya fungsi boolean:

```text
username + password -> true/false
```

Authentication adalah state machine yang menghasilkan bukti:

```text
Unauthenticated
  -> Credential Presented
  -> Credential Verified / Rejected
  -> Challenge Required
  -> MFA Verified / Rejected
  -> Session Created
  -> Token Issued
  -> Token Refreshed
  -> Token Revoked
  -> Session Expired
  -> Logout Requested
  -> Logout Completed
```

Setiap transisi penting harus menghasilkan event.

### 2.1 Event, bukan sekadar message string

Log biasa sering seperti ini:

```text
Login failed for user fajar
```

Ini tidak cukup.

Event authentication yang baik harus berbentuk struktur:

```json
{
  "event_type": "auth.login.failed",
  "event_time": "2026-06-19T13:45:23.123Z",
  "correlation_id": "req-8b6f...",
  "actor": {
    "user_id": "usr_123",
    "username_hash": "...",
    "tenant_id": "tenant_abc"
  },
  "client": {
    "client_id": "web-portal",
    "ip": "203.0.113.10",
    "user_agent_hash": "..."
  },
  "auth": {
    "method": "password",
    "result": "failed",
    "failure_reason_class": "bad_credentials",
    "assurance_level": "aal1"
  },
  "risk": {
    "risk_score": 72,
    "signals": ["new_ip", "many_failures"]
  }
}
```

Perhatikan: event bukan hanya teks. Event adalah record yang bisa di-query, di-correlate, di-alert, dan dianalisis.

### 2.2 Authentication event harus menjawab 7 pertanyaan

Untuk setiap event penting, desainlah agar bisa menjawab:

```text
Who?
What?
When?
Where?
How?
Why did it succeed/fail?
What was the resulting security state?
```

Contoh:

| Question | Authentication Meaning |
|---|---|
| Who | User/service/client/tenant/device yang terlibat |
| What | Login, token refresh, MFA challenge, logout, revocation |
| When | Timestamp akurat dan timezone-normalized |
| Where | IP, region, network zone, gateway, service |
| How | Password, OIDC, SAML, mTLS, API key, passkey, token exchange |
| Why | Success, bad credential, expired token, invalid audience, replay suspected |
| Resulting state | Session created, token denied, MFA pending, account locked, refresh revoked |

### 2.3 Auditability bukan verbosity

Top 1% engineer tidak menambah log sembarangan.

Mereka mendesain event yang:

1. Bermakna.
2. Stabil secara schema.
3. Cukup detail untuk investigasi.
4. Tidak membocorkan secret.
5. Dapat dikorelasikan lintas sistem.
6. Memiliki retention policy.
7. Bisa dipakai untuk alerting.
8. Bisa dipakai sebagai bukti perubahan security state.

Log banyak tetapi tidak terstruktur adalah noise. Log sedikit tetapi kehilangan event penting adalah blind spot.

---

## 3. Observability vs Audit vs Forensics

Ketiga istilah ini sering dicampur. Untuk authentication, perbedaannya penting.

### 3.1 Observability

Observability menjawab:

> Apa yang sedang terjadi pada sistem authentication sekarang?

Contoh:

- login success rate turun.
- token introspection latency naik.
- banyak invalid JWT audience.
- MFA challenge meningkat dari ASN tertentu.
- IdP callback error rate naik.
- LDAP bind timeout meningkat.
- JWKS refresh gagal.

Observability biasanya memakai:

- metrics,
- logs,
- traces,
- dashboards,
- alerts.

### 3.2 Audit

Audit menjawab:

> Apa yang terjadi, siapa yang melakukannya, dan apakah bisa dibuktikan secara konsisten?

Contoh:

- user A login jam 10:01.
- user A melakukan step-up MFA jam 10:03.
- user A mengubah role user B jam 10:04.
- session user A di-revoke admin jam 10:20.
- token client service X dipakai untuk memanggil service Y.

Audit lebih fokus pada:

- completeness,
- integrity,
- retention,
- traceability,
- tamper resistance,
- regulatory defensibility.

### 3.3 Forensics

Forensics menjawab:

> Bagaimana kita merekonstruksi insiden setelah kejadian?

Contoh pertanyaan forensik:

- Apakah token dicuri sebelum data berubah?
- Apakah login sukses berasal dari credential stuffing?
- Session mana yang digunakan untuk tindakan kritikal?
- Apakah refresh token reuse terdeteksi?
- Apakah user sungguhan atau attacker yang melewati MFA?
- Apakah perubahan privilege terjadi sebelum atau sesudah login abnormal?

Forensics membutuhkan:

- timeline,
- correlation ID,
- actor ID stabil,
- session ID hash,
- token ID hash,
- request ID,
- source IP,
- user agent fingerprint yang privacy-safe,
- service identity,
- immutable audit trail,
- clock synchronization.

---

## 4. Authentication Event Taxonomy

Sistem authentication production harus memiliki vocabulary event yang stabil.

Jangan biarkan setiap service menulis event dengan nama berbeda:

```text
login_ok
userLoginSuccess
AUTH_SUCCESS
signin.done
Logged in
```

Gunakan taxonomy.

### 4.1 Core event groups

```text
auth.credential.*
auth.login.*
auth.session.*
auth.token.*
auth.mfa.*
auth.oidc.*
auth.saml.*
auth.apikey.*
auth.mtls.*
auth.password.*
auth.account.*
auth.risk.*
auth.admin.*
auth.logout.*
auth.revocation.*
auth.exchange.*
auth.impersonation.*
```

### 4.2 Credential events

Credential events menunjukkan credential lifecycle.

```text
auth.credential.created
auth.credential.updated
auth.credential.rotated
auth.credential.revoked
auth.credential.expired
auth.credential.compromised
auth.credential.validation.failed
auth.credential.validation.succeeded
```

Contoh penggunaan:

- password changed,
- API key created,
- client secret rotated,
- certificate registered,
- passkey added,
- recovery code generated,
- refresh token family revoked.

### 4.3 Login events

```text
auth.login.started
auth.login.succeeded
auth.login.failed
auth.login.blocked
auth.login.rate_limited
auth.login.locked_out
auth.login.step_up_required
auth.login.abandoned
```

Kunci penting: `failed` tidak cukup. Bedakan kelas alasan tanpa membocorkan detail ke attacker.

Internal log boleh mencatat failure class:

```text
bad_credentials
unknown_account
account_locked
password_expired
mfa_required
mfa_failed
risk_blocked
idp_error
idp_denied
protocol_error
```

Tetapi response ke user sebaiknya tetap generik.

### 4.4 Session events

```text
auth.session.created
auth.session.rotated
auth.session.validated
auth.session.expired_idle
auth.session.expired_absolute
auth.session.revoked
auth.session.logout_requested
auth.session.logout_completed
auth.session.concurrent_limit_exceeded
auth.session.fixation_prevented
```

Session event harus bisa menjawab:

- session dibuat dari login mana?
- session dirotasi karena apa?
- session berakhir karena idle, absolute timeout, logout, revocation, atau security incident?
- apakah session digunakan dari IP/device yang berubah drastis?

### 4.5 Token events

```text
auth.token.issued
auth.token.validated
auth.token.validation.failed
auth.token.refreshed
auth.token.refresh_reuse_detected
auth.token.revoked
auth.token.expired
auth.token.introspected
auth.token.exchanged
auth.token.sender_constraint.failed
```

Token event penting untuk JWT, opaque token, refresh token, token exchange, mTLS-bound token, DPoP-like proof, dan internal service token.

### 4.6 MFA and step-up events

```text
auth.mfa.challenge.created
auth.mfa.challenge.sent
auth.mfa.challenge.succeeded
auth.mfa.challenge.failed
auth.mfa.challenge.expired
auth.mfa.challenge.rate_limited
auth.mfa.device.enrolled
auth.mfa.device.removed
auth.mfa.recovery.used
auth.mfa.step_up.required
auth.mfa.step_up.succeeded
```

MFA observability harus menangkap:

- jenis faktor,
- alasan step-up,
- jumlah retry,
- latency user menyelesaikan challenge,
- abnormal prompt volume,
- recovery code usage.

### 4.7 Federated identity events

OIDC:

```text
auth.oidc.authorization.started
auth.oidc.callback.received
auth.oidc.state.validation.failed
auth.oidc.nonce.validation.failed
auth.oidc.id_token.validation.failed
auth.oidc.userinfo.fetched
auth.oidc.account.linked
auth.oidc.logout.received
```

SAML:

```text
auth.saml.request.created
auth.saml.response.received
auth.saml.signature.validation.failed
auth.saml.assertion.accepted
auth.saml.assertion.replayed
auth.saml.metadata.refreshed
auth.saml.account.linked
```

### 4.8 API key and HMAC events

```text
auth.apikey.created
auth.apikey.used
auth.apikey.validation.failed
auth.apikey.revoked
auth.apikey.rate_limited
auth.hmac.signature.validated
auth.hmac.signature.failed
auth.hmac.replay.detected
auth.hmac.clock_skew.rejected
```

Untuk API key, jangan log raw key. Gunakan `key_id`, prefix aman, atau hash fingerprint.

### 4.9 mTLS events

```text
auth.mtls.client_cert.presented
auth.mtls.client_cert.accepted
auth.mtls.client_cert.rejected
auth.mtls.principal.mapped
auth.mtls.revocation_check.failed
auth.mtls.cert.expiring_soon
```

mTLS audit harus mencatat certificate fingerprint, issuer, subject/SAN yang relevan, dan principal hasil mapping. Jangan mengandalkan subject string mentah sebagai identity final tanpa mapping policy.

### 4.10 Admin and impersonation events

```text
auth.admin.user_locked
auth.admin.user_unlocked
auth.admin.session_revoked
auth.admin.mfa_reset
auth.admin.credential_reset
auth.admin.impersonation.started
auth.admin.impersonation.ended
auth.admin.role_changed
```

Admin event sangat sensitif. Ia harus memiliki:

- actor admin,
- target user,
- reason,
- approval/reference ID jika ada,
- before/after state,
- correlation ID,
- source IP/device.

---

## 5. Event Schema Design

Event authentication yang baik bukan hanya nama event. Ia butuh schema.

### 5.1 Minimal schema

```json
{
  "event_id": "evt_01J...",
  "event_type": "auth.login.succeeded",
  "event_time": "2026-06-19T03:22:14.123Z",
  "schema_version": "1.0",
  "severity": "INFO",
  "outcome": "success",
  "correlation_id": "req_abc",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "service": {
    "name": "identity-service",
    "version": "2026.06.19",
    "environment": "prod"
  },
  "actor": {
    "type": "human_user",
    "user_id": "usr_123",
    "tenant_id": "tenant_001"
  },
  "client": {
    "client_id": "web-portal",
    "ip": "203.0.113.10",
    "user_agent_hash": "ua_sha256_..."
  },
  "auth": {
    "method": "password+mfa_totp",
    "assurance_level": "aal2",
    "session_id_hash": "sess_sha256_..."
  },
  "risk": {
    "score": 18,
    "signals": ["known_device"]
  }
}
```

### 5.2 Field groups

#### Event metadata

```text
event_id
event_type
event_time
schema_version
severity
outcome
reason_class
```

#### Correlation metadata

```text
correlation_id
request_id
trace_id
span_id
parent_event_id
causation_id
```

#### Actor metadata

```text
actor.type
actor.user_id
actor.service_id
actor.client_id
actor.tenant_id
actor.subject
actor.display_name_snapshot
actor.assurance_level
```

#### Target metadata

```text
target.type
target.user_id
target.session_id_hash
target.token_id_hash
target.client_id
target.resource_id
```

#### Authentication metadata

```text
auth.method
auth.factor
auth.protocol
auth.grant_type
auth.issuer
auth.audience
auth.acr
auth.amr
auth.session_id_hash
auth.token_jti_hash
auth.key_id
auth.cert_fingerprint
auth.failure_reason_class
```

#### Network metadata

```text
network.client_ip
network.forwarded_for_validated
network.asn
network.geo_country
network.zone
network.tls_version
network.mtls_enabled
```

#### Runtime metadata

```text
service.name
service.instance_id
service.version
service.environment
host.name
container.id
k8s.pod.name
thread.name
java.version
```

### 5.3 Jangan simpan raw secret

Tidak boleh log:

```text
password
password hash jika tidak perlu
raw session ID
raw access token
raw refresh token
raw ID token
raw API key
raw client secret
raw authorization code
raw OTP
raw recovery code
private key
full SAML assertion jika berisi PII sensitif
full ID token claims jika berisi PII berlebihan
```

Gunakan fingerprint:

```text
session_id_hash = HMAC-SHA256(log_salt_key, raw_session_id)
token_id_hash   = HMAC-SHA256(log_salt_key, jti or token)
api_key_hash    = stored key fingerprint
```

Kenapa HMAC, bukan SHA-256 biasa?

Karena beberapa token/key bisa memiliki entropy tinggi, tetapi penggunaan HMAC dengan key logging khusus membuat fingerprint tidak mudah direplikasi oleh pihak yang hanya melihat log. Untuk ID yang entropy-nya rendah, hash biasa sangat berisiko brute-force.

### 5.4 Stable internal ID vs mutable display name

Audit harus memakai ID stabil:

```text
user_id = usr_123
```

Bukan hanya:

```text
username = fajar
email = fajar@example.com
```

Email, username, dan display name bisa berubah. Audit membutuhkan stable subject.

Namun snapshot display name bisa berguna untuk investigasi:

```json
{
  "actor": {
    "user_id": "usr_123",
    "username_snapshot": "fajar",
    "email_hash": "..."
  }
}
```

### 5.5 Reason class vs exact reason

Untuk security, gunakan dua lapisan:

Internal event:

```json
{
  "failure_reason_class": "bad_credentials",
  "failure_reason_detail": "password_mismatch"
}
```

User response:

```text
Invalid username or password.
```

Jangan bocorkan apakah account ada, password salah, MFA salah, atau account locked melalui response yang terlalu spesifik. Tapi internal event tetap perlu cukup detail untuk SOC dan debugging.

---

## 6. Correlation Model

Authentication rarely happens in one request.

Contoh OIDC login:

```text
GET /login
  -> redirect to IdP
  -> callback /oauth2/callback
  -> exchange code
  -> validate ID token
  -> fetch user info
  -> map account
  -> create local session
  -> redirect to app
  -> first API call
```

Jika tiap langkah punya log berbeda tanpa correlation, investigasi akan sulit.

### 6.1 Correlation ID vs trace ID vs audit event ID

| Identifier | Purpose |
|---|---|
| `event_id` | unique ID untuk satu event |
| `correlation_id` | mengikat beberapa event dalam satu business/security flow |
| `request_id` | satu HTTP request |
| `trace_id` | distributed trace lintas service |
| `span_id` | satu operation dalam trace |
| `session_id_hash` | mengikat event ke session tanpa membocorkan session ID |
| `token_jti_hash` | mengikat event ke token tanpa membocorkan token |
| `causation_id` | event yang menyebabkan event ini |
| `parent_event_id` | hubungan parent-child antar event |

### 6.2 Example: login-to-action chain

```text
auth.login.succeeded
  event_id=evt_001
  correlation_id=login_abc
  session_id_hash=sess_x

api.request.accepted
  event_id=evt_002
  correlation_id=req_123
  trace_id=trace_777
  session_id_hash=sess_x

business.case.updated
  event_id=evt_003
  causation_id=evt_002
  actor.user_id=usr_123
  session_id_hash=sess_x
```

Saat investigasi, kita bisa menjawab:

> Update case ini dilakukan oleh user mana, memakai session mana, yang berasal dari login mana?

### 6.3 Correlation across async boundaries

Untuk event-driven system:

```text
HTTP request -> command persisted -> Kafka message -> consumer -> DB update
```

Identity correlation harus dibawa sebagai metadata aman:

```json
{
  "message_id": "msg_123",
  "correlation_id": "corr_abc",
  "causation_id": "evt_command_submitted",
  "actor": {
    "type": "human_user",
    "user_id": "usr_123",
    "tenant_id": "tenant_001",
    "auth_time": "2026-06-19T03:22:14Z",
    "assurance_level": "aal2"
  },
  "producer": {
    "service_id": "case-api"
  }
}
```

Jangan membawa access token user secara sembarangan ke message broker kecuali benar-benar ada desain token exchange/delegation yang aman.

---

## 7. Authentication Metrics

Log/event berguna untuk investigasi. Metric berguna untuk deteksi cepat.

### 7.1 Core login metrics

```text
auth_login_attempts_total{method,tenant,client,outcome}
auth_login_success_total{method,tenant,client}
auth_login_failure_total{method,tenant,client,reason_class}
auth_login_latency_seconds{method,client}
auth_login_blocked_total{reason_class}
auth_login_rate_limited_total{tenant,client}
```

### 7.2 Password metrics

```text
auth_password_verify_duration_seconds{algorithm}
auth_password_rehash_total{from_algorithm,to_algorithm}
auth_password_reset_requested_total{tenant}
auth_password_reset_completed_total{tenant}
auth_password_compromised_rejected_total{tenant}
```

### 7.3 Session metrics

```text
auth_session_created_total{tenant,client}
auth_session_rotated_total{reason}
auth_session_revoked_total{reason}
auth_session_expired_total{type}
auth_active_sessions{tenant,client}
auth_concurrent_session_limit_exceeded_total{tenant}
```

### 7.4 Token metrics

```text
auth_token_issued_total{grant_type,client,audience}
auth_token_validation_total{issuer,audience,outcome}
auth_token_validation_failed_total{reason_class}
auth_token_refresh_total{client,outcome}
auth_refresh_token_reuse_detected_total{client}
auth_token_introspection_duration_seconds{issuer}
auth_token_introspection_error_total{issuer,error_class}
auth_jwks_refresh_total{issuer,outcome}
auth_jwks_key_miss_total{issuer,kid_present}
```

### 7.5 MFA metrics

```text
auth_mfa_challenge_created_total{factor,tenant}
auth_mfa_challenge_success_total{factor,tenant}
auth_mfa_challenge_failed_total{factor,reason}
auth_mfa_recovery_used_total{tenant}
auth_mfa_push_denied_total{tenant}
auth_mfa_prompt_count{user_risk_bucket}
```

### 7.6 IdP / federation metrics

```text
auth_oidc_callback_total{issuer,outcome}
auth_oidc_state_validation_failed_total{issuer}
auth_oidc_nonce_validation_failed_total{issuer}
auth_oidc_id_token_validation_failed_total{issuer,reason}
auth_saml_response_total{idp,outcome}
auth_saml_signature_failed_total{idp}
auth_saml_replay_detected_total{idp}
```

### 7.7 Directory metrics

```text
auth_ldap_bind_duration_seconds{directory}
auth_ldap_bind_failed_total{directory,reason}
auth_ldap_group_lookup_duration_seconds{directory}
auth_kerberos_login_failed_total{realm,reason}
auth_spnego_failed_total{reason}
```

### 7.8 mTLS metrics

```text
auth_mtls_handshake_failed_total{reason}
auth_mtls_client_cert_rejected_total{reason}
auth_mtls_cert_expiring_total{days_bucket}
auth_mtls_principal_mapping_failed_total{issuer}
```

### 7.9 Metric cardinality warning

Jangan jadikan label metric sebagai tempat data high-cardinality:

Buruk:

```text
auth_login_failure_total{username="fajar@example.com",ip="203.0.113.10"}
```

Lebih baik:

```text
auth_login_failure_total{tenant="tenant_001",method="password",reason="bad_credentials"}
```

Untuk user/IP detail, gunakan log/event store, bukan metric label.

---

## 8. Tracing Authentication Flow

Distributed tracing membantu memahami latency dan dependency.

Authentication flow bisa menyentuh:

- browser,
- gateway,
- identity service,
- IdP,
- LDAP,
- database,
- Redis session store,
- JWKS endpoint,
- token introspection endpoint,
- audit service,
- notification service untuk OTP.

### 8.1 Span design

Contoh span:

```text
HTTP POST /login
  auth.password.verify
  auth.risk.evaluate
  auth.mfa.challenge.create
  redis.session.create
  audit.event.publish
```

OIDC:

```text
HTTP GET /oauth2/callback
  auth.oidc.state.validate
  auth.oidc.code.exchange
  auth.oidc.id_token.validate
  auth.oidc.jwks.fetch/cache
  auth.account.link
  auth.session.create
  audit.event.publish
```

Opaque token resource server:

```text
HTTP GET /api/cases
  auth.bearer.extract
  auth.token.introspect
  auth.principal.map
  auth.authorization.evaluate
```

### 8.2 Trace attribute caution

Trace attributes should not contain secrets.

Allowed:

```text
auth.method=password
auth.protocol=oidc
auth.issuer=https://idp.example.com
auth.client_id=web-portal
auth.outcome=success
auth.failure_reason_class=expired_token
```

Avoid:

```text
auth.access_token=eyJ...
auth.password=...
auth.authorization_code=...
auth.saml_assertion=<Assertion>...
```

### 8.3 Trace sampling problem

Authentication events often need complete security audit, while traces may be sampled.

Therefore:

- Do not rely on tracing alone for audit.
- Audit events should be emitted independently.
- Trace ID should be attached to audit event when available.
- Sampling can be lower for normal API calls, but security failure traces may need tail-based sampling or special retention.

---

## 9. Privacy-Safe Logging

Authentication observability is dangerous if it leaks sensitive data.

### 9.1 Data classes

| Data | Risk | Logging Strategy |
|---|---:|---|
| Password | Critical | Never log |
| OTP | Critical | Never log |
| Recovery code | Critical | Never log |
| Access token | Critical | Never log raw |
| Refresh token | Critical | Never log raw |
| Session ID | Critical | Hash/HMAC only |
| API key | Critical | Key ID/fingerprint only |
| Authorization code | Critical | Never log raw |
| SAML assertion | High | Avoid raw; log assertion ID/hash |
| ID token | High | Avoid raw; log issuer/sub hash/jti hash |
| Email | Medium/High | Hash or masked unless necessary |
| IP address | Medium | Store with purpose/retention |
| User agent | Medium | Hash or normalize |
| Device fingerprint | High | Minimize and document |
| Geolocation | Medium/High | Coarse region if enough |

### 9.2 Masking vs hashing vs tokenization

Masking:

```text
f***@example.com
```

Good for human readability, weak for joins.

Hashing:

```text
sha256(email)
```

Good for joins, but vulnerable to dictionary attack for email/phone unless keyed.

HMAC fingerprint:

```text
hmac_sha256(log_key, email)
```

Better for privacy-safe correlation.

Tokenization:

```text
email_token = pii_abc123
```

Useful when a controlled service maps token to PII under strict access.

### 9.3 Do not log entire authentication objects

Common Java mistake:

```java
log.info("Authentication result: {}", authentication);
```

This can accidentally include credentials, authorities, details, tokens, remote address, or framework-specific sensitive fields.

Safer:

```java
log.info("auth.login.succeeded userId={} tenantId={} method={} sessionHash={} correlationId={}",
    userId,
    tenantId,
    method,
    sessionHash,
    correlationId);
```

Better: structured event object with explicit fields.

---

## 10. Java Implementation Patterns

### 10.1 Structured authentication event type

```java
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class AuthAuditEvent {
    private final String eventId;
    private final String eventType;
    private final Instant eventTime;
    private final String schemaVersion;
    private final String outcome;
    private final String correlationId;
    private final String traceId;
    private final Actor actor;
    private final Client client;
    private final AuthInfo auth;
    private final Map<String, Object> attributes;

    public AuthAuditEvent(
            String eventId,
            String eventType,
            Instant eventTime,
            String schemaVersion,
            String outcome,
            String correlationId,
            String traceId,
            Actor actor,
            Client client,
            AuthInfo auth,
            Map<String, Object> attributes) {
        this.eventId = requireNonBlank(eventId, "eventId");
        this.eventType = requireNonBlank(eventType, "eventType");
        this.eventTime = eventTime == null ? Instant.now() : eventTime;
        this.schemaVersion = requireNonBlank(schemaVersion, "schemaVersion");
        this.outcome = requireNonBlank(outcome, "outcome");
        this.correlationId = correlationId;
        this.traceId = traceId;
        this.actor = actor;
        this.client = client;
        this.auth = auth;
        this.attributes = attributes == null ? Map.of() : Map.copyOf(attributes);
    }

    private static String requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    public String eventId() { return eventId; }
    public String eventType() { return eventType; }
    public Instant eventTime() { return eventTime; }
    public String schemaVersion() { return schemaVersion; }
    public String outcome() { return outcome; }
    public String correlationId() { return correlationId; }
    public String traceId() { return traceId; }
    public Actor actor() { return actor; }
    public Client client() { return client; }
    public AuthInfo auth() { return auth; }
    public Map<String, Object> attributes() { return attributes; }

    public static final class Actor {
        private final String type;
        private final String userId;
        private final String serviceId;
        private final String tenantId;

        public Actor(String type, String userId, String serviceId, String tenantId) {
            this.type = type;
            this.userId = userId;
            this.serviceId = serviceId;
            this.tenantId = tenantId;
        }

        public String type() { return type; }
        public String userId() { return userId; }
        public String serviceId() { return serviceId; }
        public String tenantId() { return tenantId; }
    }

    public static final class Client {
        private final String clientId;
        private final String ipAddress;
        private final String userAgentHash;

        public Client(String clientId, String ipAddress, String userAgentHash) {
            this.clientId = clientId;
            this.ipAddress = ipAddress;
            this.userAgentHash = userAgentHash;
        }

        public String clientId() { return clientId; }
        public String ipAddress() { return ipAddress; }
        public String userAgentHash() { return userAgentHash; }
    }

    public static final class AuthInfo {
        private final String method;
        private final String protocol;
        private final String assuranceLevel;
        private final String sessionIdHash;
        private final String tokenIdHash;
        private final String failureReasonClass;

        public AuthInfo(
                String method,
                String protocol,
                String assuranceLevel,
                String sessionIdHash,
                String tokenIdHash,
                String failureReasonClass) {
            this.method = method;
            this.protocol = protocol;
            this.assuranceLevel = assuranceLevel;
            this.sessionIdHash = sessionIdHash;
            this.tokenIdHash = tokenIdHash;
            this.failureReasonClass = failureReasonClass;
        }

        public String method() { return method; }
        public String protocol() { return protocol; }
        public String assuranceLevel() { return assuranceLevel; }
        public String sessionIdHash() { return sessionIdHash; }
        public String tokenIdHash() { return tokenIdHash; }
        public String failureReasonClass() { return failureReasonClass; }
    }
}
```

Untuk Java 16+, ini bisa jauh lebih ringkas memakai `record`, tetapi Java 8 compatibility membutuhkan class biasa.

### 10.2 Audit event publisher interface

```java
public interface AuthAuditPublisher {
    void publish(AuthAuditEvent event);
}
```

Implementasi bisa:

- write to structured log,
- send to Kafka,
- write to database audit table,
- send to SIEM,
- emit OpenTelemetry log,
- dual-write dengan outbox pattern.

Untuk authentication kritikal, pertimbangkan durability. Jangan sampai event login sukses hilang karena async publisher drop tanpa fallback.

### 10.3 Safe fingerprint utility

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;

public final class LogFingerprint {
    private static final String HMAC_ALGORITHM = "HmacSHA256";

    private final byte[] key;

    public LogFingerprint(byte[] key) {
        if (key == null || key.length < 32) {
            throw new IllegalArgumentException("log fingerprint key must be at least 256 bits");
        }
        this.key = key.clone();
    }

    public String fingerprint(String namespace, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(key, HMAC_ALGORITHM));
            mac.update(namespace.getBytes(StandardCharsets.UTF_8));
            mac.update((byte) ':');
            mac.update(value.getBytes(StandardCharsets.UTF_8));
            byte[] digest = mac.doFinal();
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Unable to calculate log fingerprint", e);
        }
    }
}
```

Gunakan namespace agar fingerprint session/token/email tidak saling tercampur:

```java
String sessionHash = fingerprint.fingerprint("session", rawSessionId);
String tokenHash = fingerprint.fingerprint("token", rawTokenIdOrJti);
String emailHash = fingerprint.fingerprint("email", normalizedEmail);
```

### 10.4 Spring Security authentication success/failure events

Spring Security memiliki event dan extension point yang bisa dipakai untuk audit.

Contoh listener konseptual:

```java
@Component
public final class AuthenticationAuditListener {
    private final AuthAuditPublisher publisher;

    public AuthenticationAuditListener(AuthAuditPublisher publisher) {
        this.publisher = publisher;
    }

    @EventListener
    public void onSuccess(AuthenticationSuccessEvent event) {
        Authentication authentication = event.getAuthentication();

        AuthAuditEvent auditEvent = new AuthAuditEvent(
                Ids.newEventId(),
                "auth.login.succeeded",
                Instant.now(),
                "1.0",
                "success",
                Correlation.currentIdOrNull(),
                Trace.currentTraceIdOrNull(),
                new AuthAuditEvent.Actor(
                        "human_user",
                        extractStableUserId(authentication),
                        null,
                        extractTenantId(authentication)
                ),
                ClientContext.currentClient(),
                new AuthAuditEvent.AuthInfo(
                        extractMethod(authentication),
                        "spring-security",
                        extractAssurance(authentication),
                        CurrentSession.safeHashOrNull(),
                        null,
                        null
                ),
                Map.of()
        );

        publisher.publish(auditEvent);
    }

    @EventListener
    public void onFailure(AbstractAuthenticationFailureEvent event) {
        Authentication authentication = event.getAuthentication();
        Exception exception = event.getException();

        publisher.publish(new AuthAuditEvent(
                Ids.newEventId(),
                "auth.login.failed",
                Instant.now(),
                "1.0",
                "failure",
                Correlation.currentIdOrNull(),
                Trace.currentTraceIdOrNull(),
                new AuthAuditEvent.Actor(
                        "unknown_or_human_user",
                        extractCandidateUserId(authentication),
                        null,
                        extractTenantId(authentication)
                ),
                ClientContext.currentClient(),
                new AuthAuditEvent.AuthInfo(
                        extractMethod(authentication),
                        "spring-security",
                        null,
                        null,
                        null,
                        classifyFailure(exception)
                ),
                Map.of("exception_class", exception.getClass().getSimpleName())
        ));
    }
}
```

Catatan:

- Jangan log `authentication.getCredentials()`.
- Jangan serialize object `Authentication` mentah.
- Mapping `exception` ke reason class harus dikontrol.
- Untuk unknown account, jangan bocorkan detail ke response, tetapi audit internal boleh mencatat class yang sesuai.

### 10.5 Servlet filter correlation ID

```java
public final class CorrelationIdFilter implements Filter {
    private static final String HEADER = "X-Correlation-Id";

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        String incoming = http.getHeader(HEADER);
        String correlationId = isValidCorrelationId(incoming) ? incoming : Ids.newCorrelationId();

        try {
            Correlation.set(correlationId);
            res.setHeader(HEADER, correlationId);
            chain.doFilter(request, response);
        } finally {
            Correlation.clear();
        }
    }

    private boolean isValidCorrelationId(String value) {
        return value != null && value.length() <= 128 && value.matches("[A-Za-z0-9._:-]+$");
    }
}
```

Catatan penting:

- Validate incoming correlation ID.
- Jangan percaya semua header internal dari internet.
- Di belakang gateway, tentukan header mana yang authoritative.
- Clear ThreadLocal di finally.

### 10.6 Audit outbox pattern

Untuk event kritikal, logging async biasa bisa hilang.

Pattern yang lebih kuat:

```text
Transaction:
  update security state
  insert audit_outbox event
Commit

Background publisher:
  read unpublished audit_outbox
  publish to log/SIEM/Kafka
  mark published
```

Contoh:

```sql
CREATE TABLE auth_audit_outbox (
    id              VARCHAR2(64) PRIMARY KEY,
    event_type      VARCHAR2(128) NOT NULL,
    event_time      TIMESTAMP WITH TIME ZONE NOT NULL,
    aggregate_type  VARCHAR2(64),
    aggregate_id    VARCHAR2(128),
    correlation_id  VARCHAR2(128),
    payload_json    CLOB NOT NULL,
    published       NUMBER(1) DEFAULT 0 NOT NULL,
    published_at    TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX idx_auth_audit_outbox_unpub
ON auth_audit_outbox (published, created_at);
```

Use case:

- password changed,
- MFA reset,
- API key created,
- refresh token family revoked,
- admin impersonation,
- role changed,
- account locked/unlocked.

---

## 11. Audit Trail Storage Design

### 11.1 Append-only mindset

Audit log sebaiknya append-only.

Jangan update event lama kecuali untuk metadata teknis sangat terbatas.

Buruk:

```sql
UPDATE audit_log SET status = 'resolved' WHERE event_id = ?
```

Lebih baik:

```text
auth.login.failed
security.case.created
security.case.resolved
```

Audit adalah timeline, bukan mutable status table.

### 11.2 Tamper resistance

Tingkat proteksi bisa bertahap:

Level 1:

- DB permissions ketat.
- App hanya insert.
- Admin terbatas.
- Backup.

Level 2:

- Append-only table policy.
- Separate audit schema.
- Separate audit service.
- Immutable object storage.
- WORM storage jika tersedia.

Level 3:

- Hash chain per event.
- External timestamping.
- Signed audit batches.
- SIEM ingestion with immutable retention.

### 11.3 Hash chain concept

```text
event_1_hash = H(event_1_payload)
event_2_hash = H(event_2_payload + event_1_hash)
event_3_hash = H(event_3_payload + event_2_hash)
```

Jika event lama diubah, chain rusak.

Namun hash chain bukan magic. Ia butuh:

- canonical serialization,
- protected key if using HMAC/signature,
- external anchoring,
- rotation strategy,
- recovery plan.

### 11.4 Partitioning and retention

Authentication audit bisa sangat besar.

Desain storage:

```text
partition by event_date
subpartition by tenant_id or event_type if needed
index event_type + event_time
index actor_user_id + event_time
index session_id_hash
index token_id_hash
index correlation_id
```

Retention berbeda per data:

| Event Type | Possible Retention |
|---|---:|
| Debug login traces | days/weeks |
| Security logs | months |
| Audit trail | years |
| Raw IP/device signals | shorter/minimized |
| Admin action logs | longer |
| Token validation success logs | sampled/shorter unless needed |
| Failed login logs | enough for detection/investigation |

Retention harus mengikuti regulasi dan kebutuhan organisasi.

---

## 12. Detection and Alerting

Authentication observability harus menghasilkan alert yang berguna.

### 12.1 Brute force

Signal:

```text
many failures for one account from one IP
```

But modern attacks rotate IP. Jadi jangan hanya hitung per IP.

Alert:

```text
auth.login.failed count by user_id over 10 minutes > threshold
```

### 12.2 Credential stuffing

Signal:

```text
many accounts attempted from same IP/ASN/client fingerprint
low success rate
high username diversity
```

Alert dimensions:

```text
source IP
ASN
user agent family
client_id
tenant
```

### 12.3 Password spraying

Signal:

```text
one/few passwords tried across many accounts
low per-account failure count
wide account spread
```

Jangan log password untuk mendeteksi ini. Gunakan derived signal, bukan raw password.

Contoh derived signal:

```text
same normalized failure pattern
same source
same timing
same client fingerprint
```

### 12.4 Refresh token reuse

Signal:

```text
refresh token family reuse detected
```

Ini high severity karena bisa berarti token theft.

Action:

- revoke token family,
- revoke sessions,
- require re-authentication,
- notify user/admin,
- create security case.

### 12.5 Impossible travel

Signal:

```text
same user successful login from distant geolocation within impossible time
```

Caution:

- VPN,
- mobile network egress,
- corporate proxy,
- cloud desktops,
- shared NAT.

Jangan auto-lock semua kasus. Gunakan risk scoring/step-up.

### 12.6 MFA fatigue

Signal:

```text
many push challenges
multiple denies
eventual accept after many prompts
```

Action:

- throttle push,
- require stronger factor,
- notify user,
- block suspicious session,
- require helpdesk verification.

### 12.7 OIDC/SAML protocol anomalies

Alert on:

```text
state validation failure spike
nonce validation failure
invalid issuer
invalid audience
unknown kid spike
SAML signature failure
SAML assertion replay
clock skew failure spike
metadata refresh failure
```

These may indicate:

- attack,
- IdP misconfiguration,
- key rotation issue,
- clock drift,
- deployment mismatch.

### 12.8 mTLS anomalies

Alert on:

```text
client certificate rejected spike
certificate expiring soon
principal mapping failed
unexpected issuer
revocation check failed
```

### 12.9 Alert quality

Bad alert:

```text
Login failed
```

Good alert:

```text
Credential stuffing suspected:
- tenant=agency-a
- window=10m
- failed_attempts=12,480
- unique_accounts=4,200
- top_asn=ASXXXXX
- success_rate=0.3%
- affected_client=public-web
- recommended_action=rate_limit + captcha/step-up + SOC review
```

---

## 13. Forensic Reconstruction

### 13.1 Build a timeline

For an incident, reconstruct:

```text
T-60m suspicious failed login attempts begin
T-30m successful login from new ASN
T-29m MFA challenge accepted
T-28m session created
T-25m high-value data viewed
T-20m role changed
T-10m refresh token used from second IP
T-09m refresh token reuse detected
T-08m token family revoked
T-07m admin reset initiated
```

### 13.2 Required joins

You need fields to join:

```text
actor.user_id
actor.tenant_id
session_id_hash
token_jti_hash
refresh_token_family_id_hash
correlation_id
trace_id
client_id
source_ip
user_agent_hash
device_id_hash
admin_actor_id
target_user_id
```

### 13.3 Forensic questions checklist

#### Identity

```text
Which principal was authenticated?
Was it human, service, device, or admin impersonation?
Was account linking involved?
Was tenant resolved correctly?
```

#### Authentication method

```text
Which method was used?
Password? OIDC? SAML? mTLS? API key? Passkey?
Was MFA used?
What ACR/AMR was present?
```

#### Credential/token

```text
Which credential was used?
Was it newly created?
Was it rotated recently?
Was it revoked later?
Was refresh token reuse detected?
```

#### Session

```text
Which session performed the action?
When was it created?
Was it rotated after login?
Was it used from unusual IP/device?
Was it revoked?
```

#### Chain of custody

```text
Which logs are authoritative?
Were logs tamper-resistant?
Are clocks synchronized?
Are there gaps?
Was any logging pipeline down?
```

### 13.4 Common forensic failure

#### Missing stable user ID

Only logs email. Email changed. Audit broken.

#### Missing session hash

Cannot connect business action to login session.

#### Missing token ID/JTI

Cannot identify which token was abused.

#### Raw token logged

Security incident made worse by observability leak.

#### Clock drift

Timeline impossible to trust.

#### Sampled traces only

Critical security event absent because trace was sampled out.

#### No admin actor

Audit says “user reset”, but not which admin performed reset.

---

## 14. Authentication Event Severity

Define severity by security meaning, not by exception level.

| Event | Suggested Severity |
|---|---|
| Login success | INFO |
| Login failed bad credentials | INFO/WARN depending rate |
| Account lockout | WARN |
| MFA failed repeatedly | WARN |
| Refresh token reuse | ERROR/CRITICAL |
| SAML assertion replay | ERROR/CRITICAL |
| OIDC nonce failure | WARN/ERROR |
| Invalid audience token | WARN |
| Signature validation failed | WARN/ERROR |
| Admin MFA reset | WARN |
| Privilege escalation | WARN/INFO with audit-critical flag |
| mTLS unexpected issuer | ERROR |
| Audit event publish failure | ERROR/CRITICAL |

Do not map every failed login to `ERROR`. That creates noise and alert fatigue.

But do not hide high-value anomalies under `INFO` only.

---

## 15. Logging Authentication Failures Safely

### 15.1 Internal reason classes

```text
bad_credentials
unknown_account
account_disabled
account_locked
password_expired
mfa_required
mfa_failed
mfa_expired
risk_blocked
rate_limited
session_expired
csrf_failed
token_expired
token_invalid_signature
token_invalid_issuer
token_invalid_audience
token_replay_suspected
state_mismatch
nonce_mismatch
saml_signature_invalid
saml_replay_detected
mtls_cert_untrusted
apikey_revoked
hmac_signature_mismatch
hmac_replay_detected
```

### 15.2 External response normalization

Internal:

```text
unknown_account
password_mismatch
account_locked
```

External:

```text
Invalid username or password.
```

For account locked, you may need user-friendly message depending policy, but avoid making enumeration easy.

### 15.3 Java exception mapping

Do not log stack trace for every expected auth failure.

Expected:

```text
bad credentials
expired token
invalid audience
csrf missing
```

Unexpected:

```text
IdP HTTP 500
JWKS parse failure
database unavailable
crypto provider failure
clock service failure
```

Expected failures should be structured events, not noisy exception stack traces.

---

## 16. Clock and Time Discipline

Authentication depends heavily on time:

- token expiry,
- `nbf`,
- `iat`,
- OIDC nonce lifetime,
- SAML assertion validity,
- HMAC timestamp window,
- session idle timeout,
- password reset token expiry,
- MFA challenge expiry,
- forensic timeline.

### 16.1 Use UTC in events

Store:

```text
2026-06-19T03:22:14.123Z
```

Display in local timezone only at UI/reporting layer.

### 16.2 Record clock skew errors

```text
auth.token.validation.failed reason=clock_skew_exceeded
auth.saml.assertion.rejected reason=not_before_in_future
auth.hmac.clock_skew.rejected
```

A spike may indicate:

- node time drift,
- IdP time drift,
- client bug,
- replay attempt,
- wrong environment key/config.

### 16.3 Inject Clock in Java code

```java
import java.time.Clock;
import java.time.Instant;

public final class TokenExpiryValidator {
    private final Clock clock;

    public TokenExpiryValidator(Clock clock) {
        this.clock = clock;
    }

    public boolean isExpired(Instant expiresAt) {
        return !Instant.now(clock).isBefore(expiresAt);
    }
}
```

This makes expiry tests reliable.

---

## 17. Actor Modeling for Audit

Authentication audit fails when actor model is weak.

### 17.1 Actor types

```text
human_user
service_account
machine_client
api_client
scheduled_job
batch_worker
admin_user
support_impersonation
device
external_idp
anonymous
unknown
```

### 17.2 Human actor vs system actor

Example: user submits request, async worker processes it.

```json
{
  "actor": {
    "type": "service_account",
    "service_id": "case-worker"
  },
  "on_behalf_of": {
    "type": "human_user",
    "user_id": "usr_123",
    "auth_time": "2026-06-19T03:22:14Z",
    "assurance_level": "aal2"
  }
}
```

Do not overwrite service identity with user identity.

Correct audit needs both:

```text
who executed technically?
who initiated semantically?
```

### 17.3 Admin impersonation

Impersonation must never look like normal user login.

Bad:

```text
actor.user_id = targetUser
```

Good:

```json
{
  "actor": {
    "type": "admin_user",
    "user_id": "admin_1"
  },
  "impersonation": {
    "active": true,
    "target_user_id": "usr_123",
    "reason": "support_case_456",
    "started_event_id": "evt_001"
  }
}
```

Every action during impersonation should show both admin and target.

---

## 18. Authentication Observability by Mode

### 18.1 Password

Must observe:

- success/failure count,
- reason class,
- hash algorithm version,
- rehash events,
- reset request/complete,
- lockout/rate-limit,
- compromised password rejection,
- unusual source patterns.

Never log:

- password,
- password hash,
- reset token.

### 18.2 Session

Must observe:

- created,
- rotated,
- expired,
- revoked,
- concurrent session limit,
- fixation prevention,
- session store latency.

Never log raw session ID.

### 18.3 JWT

Must observe:

- issuer,
- audience,
- algorithm,
- `kid`,
- validation result,
- failure class,
- token `jti` hash if present,
- JWKS cache hit/miss,
- key refresh.

Never log raw JWT.

### 18.4 Opaque token

Must observe:

- introspection latency,
- active=false,
- auth server errors,
- cache hit/miss,
- fail-open/fail-closed decision,
- token hash.

### 18.5 OIDC

Must observe:

- authorization started,
- callback received,
- state validation,
- nonce validation,
- ID token validation,
- userinfo fetch,
- account linking,
- session creation,
- logout.

### 18.6 SAML

Must observe:

- request ID,
- response ID,
- assertion ID hash,
- signature validation,
- issuer,
- audience,
- clock validation,
- replay detection,
- metadata refresh.

Avoid raw assertions in general logs.

### 18.7 API key

Must observe:

- key ID,
- tenant,
- client,
- scope,
- rate limit,
- revoked/expired usage,
- key creation/rotation/revocation.

Never log raw key.

### 18.8 HMAC

Must observe:

- key ID,
- signature version,
- canonical request hash,
- timestamp skew,
- nonce replay,
- failure class.

Never log shared secret.

### 18.9 mTLS

Must observe:

- client cert fingerprint,
- issuer,
- SAN,
- trust decision,
- mapping decision,
- expiry,
- revocation status.

### 18.10 Passkey/WebAuthn

Must observe:

- challenge created,
- challenge verified,
- credential ID hash,
- sign count anomaly,
- authenticator attachment,
- user verification flag,
- recovery flow.

Do not log raw challenge response beyond safe metadata.

---

## 19. Dashboards

### 19.1 Executive security dashboard

Shows:

- login success/failure trend,
- suspicious login trend,
- account lockouts,
- MFA failures,
- token reuse incidents,
- top affected tenants,
- IdP availability.

### 19.2 Engineering dashboard

Shows:

- login latency,
- password hash duration,
- Redis session latency,
- JWKS fetch errors,
- introspection latency,
- LDAP bind latency,
- OIDC callback errors,
- SAML validation failures.

### 19.3 SOC dashboard

Shows:

- brute force clusters,
- credential stuffing signals,
- impossible travel,
- refresh token reuse,
- admin security actions,
- MFA reset events,
- suspicious IP/ASN,
- replay detection.

### 19.4 Audit dashboard

Shows:

- privileged actions,
- authentication before high-value transactions,
- admin impersonation,
- credential lifecycle,
- role changes,
- session revocation,
- retention/export status.

---

## 20. Failure Modes in Authentication Observability

### 20.1 Logging too little

Impact:

- cannot investigate incident,
- cannot prove user action,
- cannot detect attack early,
- regulator/auditor loses confidence.

### 20.2 Logging too much

Impact:

- secrets leak,
- privacy violation,
- storage explosion,
- alert fatigue,
- harder forensics due to noise.

### 20.3 Logging wrong identity

Example:

```text
actor = service-api
```

But action was on behalf of user.

Or:

```text
actor = user
```

But actual executor was batch job.

Correct audit requires both.

### 20.4 Unsynchronized clocks

Impact:

- impossible timeline,
- false token expiry,
- false SAML validity errors,
- replay detection broken.

### 20.5 No schema version

Impact:

- old and new events incompatible,
- SIEM parsing breaks,
- dashboards silently wrong.

### 20.6 Correlation lost at async boundary

Impact:

- command cannot be traced to user action,
- message processing looks system-generated,
- audit chain broken.

### 20.7 Audit pipeline failure ignored

Impact:

- security state changes happen with no audit record.

For critical events, decide fail-open/fail-closed:

```text
If audit store unavailable, can admin reset MFA proceed?
If token revocation event cannot be persisted, can revocation proceed?
If login success cannot be audited, should login be allowed?
```

There is no universal answer. But there must be an explicit decision.

---

## 21. Production Checklist

### 21.1 Event model

- [ ] Authentication event taxonomy exists.
- [ ] Event schema is versioned.
- [ ] Event IDs are unique.
- [ ] Event timestamps are UTC.
- [ ] Stable actor IDs are used.
- [ ] Tenant ID is present for multi-tenant systems.
- [ ] Client/service identity is present.
- [ ] Session/token/key fingerprints are safe.
- [ ] Raw secrets are never logged.
- [ ] Failure reasons are internally useful but externally safe.

### 21.2 Correlation

- [ ] Correlation ID is generated at boundary.
- [ ] Trace ID is attached when available.
- [ ] Session hash links login and business actions.
- [ ] Token hash/JTI hash links token validation events.
- [ ] Async messages carry safe causation metadata.
- [ ] Admin actions include target and actor.
- [ ] Impersonation includes admin and target.

### 21.3 Detection

- [ ] Brute force detection exists.
- [ ] Credential stuffing detection exists.
- [ ] Password spraying detection exists.
- [ ] Refresh token reuse alert exists.
- [ ] MFA fatigue detection exists.
- [ ] OIDC/SAML protocol anomaly alert exists.
- [ ] mTLS certificate expiry alert exists.
- [ ] Audit pipeline failure alert exists.

### 21.4 Storage and retention

- [ ] Audit store is append-oriented.
- [ ] Retention policy is defined.
- [ ] Sensitive fields are minimized.
- [ ] Audit logs are access-controlled.
- [ ] Tamper resistance is considered.
- [ ] Export/reporting is controlled.
- [ ] Deletion/anonymization policy is defined where legally required.

### 21.5 Operations

- [ ] Dashboards exist for auth health.
- [ ] Runbook exists for token theft.
- [ ] Runbook exists for credential stuffing.
- [ ] Runbook exists for IdP outage.
- [ ] Runbook exists for audit pipeline failure.
- [ ] Clock sync is monitored.
- [ ] Key rotation events are audited.
- [ ] Break-glass admin access is audited.

---

## 22. Common Mistakes

### Mistake 1 — Logging raw token for debugging

This turns logs into credential storage.

Correct:

```text
log token hash, jti hash, issuer, audience, kid, expiry, validation outcome
```

### Mistake 2 — Treating successful login as low-value log

Successful login is one of the most important security events.

### Mistake 3 — Only logging failures

Without success events, you cannot reconstruct account takeover.

### Mistake 4 — No session linkage

Business audit says user changed data, but cannot identify which login/session did it.

### Mistake 5 — No admin target

Admin event says “reset MFA” but does not say for whom.

### Mistake 6 — High-cardinality metric labels

Putting user ID/IP/token ID in metric labels can destroy monitoring systems.

### Mistake 7 — Framework object serialization

Serializing `Authentication`, `Principal`, JWT claims, or SAML assertion wholesale leaks sensitive fields.

### Mistake 8 — No audit when authentication is delegated

OIDC/SAML login still needs local audit events. “The IdP has logs” is not enough for application accountability.

### Mistake 9 — No event for denied authentication

Blocked attempts matter. A prevented attack still needs visibility.

### Mistake 10 — No explicit audit pipeline failure behavior

If audit fails silently, the system appears compliant while losing evidence.

---

## 23. Design Questions

Use these during architecture review.

### 23.1 Event design

1. What are the top 20 authentication events we must always capture?
2. Which events are operational only, and which are audit-critical?
3. Which fields are mandatory for each event type?
4. How do we version the event schema?
5. Which fields are forbidden because they contain secrets?

### 23.2 Correlation

1. How do we connect login to session to API call to business action?
2. How do we connect user request to async message to worker update?
3. Do we preserve both technical actor and semantic initiator?
4. How do we represent impersonation?
5. How do we correlate IdP callback with original login request?

### 23.3 Privacy

1. Which fields are PII?
2. Which fields are secrets?
3. Which fields can be hashed/HMACed?
4. Who can access raw audit logs?
5. How long should each field be retained?

### 23.4 Detection

1. What would credential stuffing look like in our event model?
2. What would stolen refresh token reuse look like?
3. What would SAML replay look like?
4. What would API key abuse look like?
5. What would MFA fatigue look like?

### 23.5 Incident response

1. Can we list all sessions for a user?
2. Can we revoke all tokens for a client?
3. Can we identify all actions performed by a compromised session?
4. Can we prove whether MFA was used before a high-risk action?
5. Can we export a complete timeline for auditors?

---

## 24. Reference Architecture

```text
                         +---------------------+
                         | Browser / Client    |
                         +----------+----------+
                                    |
                                    v
                         +---------------------+
                         | Gateway / WAF       |
                         | - request id        |
                         | - source metadata   |
                         +----------+----------+
                                    |
                                    v
                         +---------------------+
                         | Java App / API      |
                         | - auth filter       |
                         | - security context  |
                         | - audit emitter     |
                         +----+-----------+----+
                              |           |
                              |           v
                              |   +------------------+
                              |   | Metrics/Tracing  |
                              |   | OTel/Prometheus  |
                              |   +------------------+
                              |
                              v
                    +-----------------------+
                    | Auth Audit Publisher  |
                    +-----+------------+----+
                          |            |
                          v            v
              +----------------+   +----------------+
              | Audit Outbox   |   | Structured Log |
              | DB / durable   |   | JSON logs      |
              +-------+--------+   +-------+--------+
                      |                    |
                      v                    v
              +----------------+   +----------------+
              | Audit Store    |   | SIEM / Search  |
              | immutable-ish  |   | alerting       |
              +----------------+   +----------------+
```

Key idea:

```text
Authentication decision and authentication evidence must be designed together.
```

---

## 25. Summary

Authentication observability is not “add logs”.

It is the discipline of making every security-relevant authentication transition:

1. visible,
2. structured,
3. correlated,
4. privacy-safe,
5. durable enough,
6. actionable,
7. auditable,
8. forensically reconstructable.

A strong authentication system answers not only:

```text
Can this caller access the system?
```

But also:

```text
How do we know?
What proof was presented?
What state changed?
What evidence was recorded?
Can we detect abuse?
Can we reconstruct the incident?
Can we defend this timeline under audit?
```

That is the difference between basic login implementation and production-grade authentication engineering.

---

## References

- OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Application Logging Vocabulary Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Top 10 2021 A09 Security Logging and Monitoring Failures — https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/
- NIST SP 800-92 Guide to Computer Security Log Management — https://csrc.nist.gov/pubs/sp/800/92/final
- OpenTelemetry Semantic Conventions — https://opentelemetry.io/docs/concepts/semantic-conventions/
- OpenTelemetry Logs Specification — https://opentelemetry.io/docs/specs/otel/logs/
- Spring Security Servlet Authentication Architecture — https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html
- Spring Security OAuth2 Resource Server — https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-029.md">⬅️ Part 29 — Authentication Failure Modeling and Attack Simulation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-031.md">Part 31 — Performance and Scalability of Authentication ➡️</a>
</div>
