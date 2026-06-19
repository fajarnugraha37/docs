# learn-java-authentication-modes-and-patterns-part-023

# Part 23 — Token Lifecycle Engineering

## Status

**Series:** Java Authentication Modes and Patterns  
**Part:** 23 of 35  
**Status:** In progress series, this is not the final part.  
**Previous part:** Part 22 — Authentication for Mobile, Desktop, CLI, and Device Clients  
**Next part:** Part 24 — Key Management for Authentication Systems in Java 8–25

## Learning Goals

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat token bukan sebagai string, tetapi sebagai **credential object with lifecycle**.
2. Membedakan lifecycle access token, refresh token, ID token, session token, one-time token, device code, authorization code, recovery token, dan internal delegation token.
3. Mendesain expiry, rotation, revocation, reuse detection, sender constraint, dan introspection dengan trade-off yang jelas.
4. Menentukan kapan token harus stateless, kapan harus reference/opaque, dan kapan perlu hybrid.
5. Mendesain respons insiden ketika token bocor tanpa panik dan tanpa mematikan seluruh sistem.
6. Menghindari kesalahan umum: token terlalu panjang umur, token disimpan sembarangan, logout dianggap otomatis mencabut JWT, refresh token diperlakukan seperti access token, ID token dipakai untuk memanggil API, dan revocation tidak terdefinisi.
7. Membangun model production-grade untuk Java 8 sampai Java 25, Spring Security, Jakarta Security, OAuth2/OIDC, gateway, mobile, SPA, CLI, service-to-service, dan event-driven systems.

## 1. Problem yang Diselesaikan

Pada banyak sistem Java, token sering diperlakukan sebagai benda teknis sederhana:

```text
client sends token -> backend validates token -> request allowed
```

Model ini terlalu dangkal.

Dalam sistem production, pertanyaan yang lebih penting adalah:

```text
Where did this token come from?
What does it prove?
Who can use it?
Where can it be used?
How long is it valid?
Can it be revoked?
Can it be rotated?
Can reuse be detected?
Can compromise be contained?
Can the system explain why this request was accepted?
```

Token lifecycle engineering menyelesaikan masalah berikut:

1. **Continuity** — bagaimana user/service tetap dikenali setelah authentication awal.
2. **Delegation** — bagaimana akses diberikan ke client tanpa memberikan credential asli user.
3. **Containment** — bagaimana membatasi dampak kalau token bocor.
4. **Revocation** — bagaimana mencabut akses sebelum expiry natural.
5. **Rotation** — bagaimana mengganti credential tanpa downtime.
6. **Auditability** — bagaimana membuktikan token diterbitkan, digunakan, diperbarui, dan dicabut secara benar.
7. **Scalability** — bagaimana validasi token tetap cepat tanpa membuat authorization server menjadi bottleneck.
8. **Interoperability** — bagaimana token bekerja lintas Java application, gateway, IdP, mobile, CLI, service, dan message worker.

Mental model utamanya:

> Token adalah **temporary authority container**. Ia membawa atau mereferensikan otoritas sementara yang harus dikelola dari lahir sampai mati.

## 2. Token Bukan Identity, Token Adalah Bukti Sementara

Kesalahan konseptual pertama adalah menganggap token sebagai identity.

Token bukan user. Token bukan session. Token bukan account. Token adalah **bukti sementara** bahwa issuer pernah memberikan otoritas tertentu kepada holder token.

Contoh:

```text
User:             fajar@example.com
Subject:          user-123
Session:          browser login continuity
Access token:     permission to call API A for 5 minutes
Refresh token:    permission to obtain new access tokens
ID token:         assertion that user was authenticated by IdP
API key:          long-lived client credential
Device code:      temporary user authorization bridge for limited-input device
One-time token:   single-use credential for reset, invite, verification, magic link
```

Karena token bukan identity, maka pertanyaan validasi token tidak cukup:

```text
Is signature valid?
```

Pertanyaan yang benar:

```text
Is this token valid for this operation, this API, this client, this actor, this tenant, this time, this assurance level, and this context?
```

## 3. Lifecycle View

Token lifecycle dapat dilihat sebagai state machine.

```text
[Requested]
     |
     v
[Issued]
     |
     v
[Delivered]
     |
     v
[Stored]
     |
     v
[Presented]
     |
     v
[Validated]
     |
     +--------------------+
     |                    |
     v                    v
[Accepted]            [Rejected]
     |
     v
[Refreshed / Rotated]
     |
     v
[Expired]
     |
     v
[Archived for audit]
```

Lifecycle alternatif:

```text
[Issued]
   |
   +--> [Revoked]
   |
   +--> [Compromised]
   |
   +--> [Reused after rotation]
   |
   +--> [Superseded by newer token]
   |
   +--> [Invalidated due to session logout]
   |
   +--> [Invalidated due to password/MFA/key change]
```

Top 1% engineer tidak hanya mendesain token format. Mereka mendesain **state transitions**, **failure transitions**, dan **operator response**.

## 4. Token Family

Tidak semua token memiliki fungsi yang sama. Kesalahan besar terjadi ketika satu token dipakai untuk semua hal.

### 4.1 Access Token

Access token digunakan untuk mengakses protected resource.

Properti ideal:

1. Short-lived.
2. Audience-bound.
3. Scope/permission-bound.
4. Client-bound jika memungkinkan.
5. Tidak dipakai sebagai identity source utama UI.
6. Tidak disimpan terlalu lama di browser.
7. Tidak digunakan untuk refresh.

Contoh claim umum JWT access token:

```json
{
  "iss": "https://idp.example.com/realms/agency",
  "sub": "user-123",
  "aud": "case-management-api",
  "azp": "aceas-web-bff",
  "scope": "case:read case:update",
  "exp": 1760000300,
  "iat": 1760000000,
  "jti": "at-01J...",
  "tenant_id": "cea"
}
```

Access token menjawab:

```text
Can this caller access this resource now?
```

Bukan:

```text
Is this user logged in forever?
```

### 4.2 Refresh Token

Refresh token digunakan untuk mendapatkan access token baru.

Properti ideal:

1. Lebih sensitif daripada access token.
2. Lebih panjang umur, tetapi harus dikontrol ketat.
3. Disimpan hanya di tempat yang lebih aman.
4. Diputar melalui refresh token rotation.
5. Dapat dicabut.
6. Dapat mendeteksi reuse.
7. Sebaiknya sender-constrained atau rotated untuk public client.

RFC 9700 menekankan bahwa refresh token untuk public client harus sender-constrained atau memakai refresh token rotation.

Refresh token menjawab:

```text
Can this client obtain a new access token without forcing the user to authenticate again?
```

### 4.3 ID Token

ID token adalah assertion dari OpenID Provider bahwa user telah diautentikasi.

ID token dipakai oleh client/Relying Party untuk login flow, bukan untuk memanggil API resource server.

ID token menjawab:

```text
Who was authenticated by the identity provider, for this client, in this authentication event?
```

Bukan:

```text
Can this token call the payment API?
```

Kesalahan umum:

```text
Frontend gets ID token -> sends ID token to backend API -> backend treats it as access token
```

Ini salah secara desain karena `aud` ID token biasanya client, bukan API.

### 4.4 Session Token / Session ID

Session token biasanya berupa session ID di cookie.

Properti:

1. Bearer credential.
2. Server-side state reference.
3. Bisa dicabut cepat.
4. Cocok untuk browser/BFF.
5. Butuh CSRF protection jika cookie otomatis dikirim browser.
6. Butuh rotation setelah login/privilege change.

Session ID menjawab:

```text
Which server-side session state should be loaded for this browser request?
```

### 4.5 Authorization Code

Authorization code adalah short-lived one-time credential dalam OAuth2/OIDC flow.

Properti:

1. Sangat pendek umur.
2. Single-use.
3. Bound ke client.
4. Bound ke redirect URI.
5. Dengan PKCE, bound ke code verifier.
6. Tidak boleh dianggap access token.

Authorization code menjawab:

```text
Can this client exchange this code for tokens?
```

### 4.6 Device Code and User Code

Dalam device flow:

1. Device menerima `device_code`.
2. User menerima `user_code`.
3. User authorize di browser lain.
4. Device polling token endpoint.

Device code menjawab:

```text
Has the user completed authorization for this limited-input device?
```

### 4.7 One-Time Token

Dipakai untuk:

1. Password reset.
2. Email verification.
3. Magic link.
4. Invitation.
5. Account recovery.
6. Device enrollment.

Properti:

1. Single-use.
2. Short-lived.
3. Purpose-bound.
4. Account-bound.
5. Risk-bound.
6. Must be stored hashed.
7. Invalidated after use.

One-time token menjawab:

```text
Can this holder complete exactly one specific action?
```

### 4.8 Internal Delegation Token

Dalam microservices, service A kadang perlu memanggil service B atas nama user atau sebagai dirinya sendiri.

Delegation token menjawab:

```text
Is service A allowed to perform this downstream call with this actor context?
```

Desainnya harus membedakan:

```text
user identity     -> who initiated the business action
service identity  -> which workload performed the technical call
authority         -> what operation is allowed downstream
```

## 5. Token Classification Matrix

| Token Type | Primary Purpose | Typical Lifetime | Revocable | Format | Holder Risk |
|---|---:|---:|---:|---|---|
| Access token | API access | Seconds-minutes | Sometimes | JWT or opaque | High |
| Refresh token | Obtain new access token | Hours-days-months | Yes | Usually opaque | Very high |
| ID token | Authentication assertion | Minutes | Usually not relied on after login | JWT | Medium/high if misused |
| Session ID | Browser continuity | Minutes-hours | Yes | Opaque random ID | High |
| Authorization code | Token exchange | Seconds | Single-use | Opaque | Medium short window |
| Device code | Device authorization bridge | Minutes | Yes | Opaque | Medium |
| One-time token | Specific single action | Minutes-hours | Yes | Opaque random | High |
| API key | Client authentication | Days-years | Yes | Opaque secret | Very high |
| HMAC key | Request signing | Months-years | Yes via key registry | Secret key | Very high |
| Certificate-bound token | API access with PoP | Minutes | Sometimes | JWT/opaque | Lower replay risk |

## 6. Token Issuance

Issuance adalah saat token lahir. Banyak bug security berasal dari issuance yang terlalu longgar.

Pertanyaan issuance:

```text
Who requested the token?
Was the requester authenticated?
Which client requested it?
Which user/resource owner is involved?
Which grant produced it?
Which scopes are allowed?
Which audience is allowed?
Which tenant is allowed?
Which assurance level was satisfied?
Which session is it linked to?
Which device is it linked to?
Which key/certificate is it bound to?
```

### 6.1 Issuance Invariants

Token issuance harus memenuhi invariant:

1. Token must have one issuer.
2. Token must have clear subject semantics.
3. Token must have intended audience.
4. Token must have expiry.
5. Token must have issuance time.
6. Token must have grant/source context.
7. Token must have client binding or client identity.
8. Token must have traceability.
9. Token must not contain secrets unnecessary for resource server.
10. Token must not contain mutable business attributes without strategy.

### 6.2 Issuance Event

Setiap issuance sebaiknya menghasilkan audit event:

```json
{
  "event_type": "TOKEN_ISSUED",
  "token_type": "ACCESS_TOKEN",
  "issuer": "https://idp.example.com/realms/agency",
  "subject": "user-123",
  "client_id": "aceas-web-bff",
  "audience": "case-management-api",
  "scope": "case:read case:update",
  "grant_type": "authorization_code",
  "auth_time": "2026-06-19T00:10:00+07:00",
  "issued_at": "2026-06-19T00:12:00+07:00",
  "expires_at": "2026-06-19T00:17:00+07:00",
  "jti_hash": "sha256:...",
  "correlation_id": "req-...",
  "ip_hash": "sha256:...",
  "user_agent_hash": "sha256:..."
}
```

Jangan log raw token.

## 7. Token Delivery

Setelah diterbitkan, token harus dikirim ke holder.

Delivery channel bisa:

1. HTTPS response body.
2. Secure HTTP-only cookie.
3. Redirect fragment legacy implicit flow.
4. Redirect query authorization code.
5. Back-channel token endpoint.
6. Device polling flow.
7. Message/event metadata.
8. Secret distribution system.

Rule penting:

> Token security tidak hanya ditentukan oleh format token, tetapi juga oleh channel pengirimannya.

### 7.1 Bad Delivery Patterns

Contoh buruk:

```text
/access?token=eyJhbGciOi...
```

Masalah:

1. Token masuk browser history.
2. Token masuk server logs.
3. Token masuk reverse proxy logs.
4. Token bisa bocor lewat Referer header.
5. Token sulit dicabut jika JWT stateless.

Contoh buruk lain:

```text
Set-Cookie: access_token=...; SameSite=None
```

tanpa:

```text
Secure; HttpOnly
```

Masalah:

1. Bisa terbaca JavaScript jika bukan HttpOnly.
2. Bisa dikirim lewat non-HTTPS jika bukan Secure.
3. CSRF risk jika cookie otomatis dikirim dan tidak ada CSRF mitigation.

## 8. Token Storage

Storage adalah tempat token hidup di sisi client/server.

### 8.1 Browser Storage

Pilihan umum:

| Storage | Benefit | Risk |
|---|---|---|
| Memory | Hilang saat reload, lebih sulit dicuri persistent | UX sulit, refresh kompleks |
| `localStorage` | Mudah | XSS membaca token |
| `sessionStorage` | Per-tab | XSS tetap bisa baca |
| HttpOnly cookie | Tidak bisa dibaca JS | CSRF perlu mitigasi |
| BFF server session | Token tidak diberikan ke browser | Butuh backend session/state |

Untuk aplikasi enterprise yang serius, pattern yang sering lebih aman:

```text
Browser -> HttpOnly SameSite Secure session cookie -> BFF -> tokens stored server-side -> APIs
```

### 8.2 Mobile/Desktop Storage

Gunakan OS secure storage:

1. Android Keystore.
2. iOS Keychain.
3. macOS Keychain.
4. Windows Credential Manager/DPAPI.
5. Linux Secret Service/libsecret jika tersedia.

Jangan menyimpan refresh token dalam plain file config.

### 8.3 Server Storage

Server-side token store harus menyimpan:

1. Token hash, bukan raw token.
2. Token family ID.
3. Subject.
4. Client ID.
5. Device/session ID.
6. Expiry.
7. Revoked flag/time/reason.
8. Last used time.
9. Rotation pointer.
10. Risk metadata.

Contoh table refresh token:

```sql
CREATE TABLE oauth_refresh_token (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    token_family_id VARCHAR(64) NOT NULL,
    subject_id VARCHAR(128) NOT NULL,
    client_id VARCHAR(128) NOT NULL,
    session_id VARCHAR(128),
    device_id VARCHAR(128),
    issued_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    last_used_at TIMESTAMP,
    rotated_to_hash CHAR(64),
    revoked_at TIMESTAMP,
    revoked_reason VARCHAR(128),
    reuse_detected_at TIMESTAMP,
    created_ip_hash CHAR(64),
    created_user_agent_hash CHAR(64)
);

CREATE INDEX idx_refresh_token_family ON oauth_refresh_token(token_family_id);
CREATE INDEX idx_refresh_token_subject_client ON oauth_refresh_token(subject_id, client_id);
CREATE INDEX idx_refresh_token_expiry ON oauth_refresh_token(expires_at);
```

## 9. Token Presentation

Presentation adalah saat token dibawa ke resource server.

Umum:

```http
Authorization: Bearer <access-token>
```

Atau cookie:

```http
Cookie: SESSION=<session-id>
```

Atau mTLS-bound token:

```text
Bearer token + TLS client certificate proof
```

Atau DPoP-style proof-of-possession:

```text
Bearer-like access token + signed proof per request
```

Pertanyaan saat token dipresentasikan:

1. Apakah token berada di header yang benar?
2. Apakah scheme benar?
3. Apakah token dikirim via TLS?
4. Apakah ada lebih dari satu credential dalam request?
5. Jika ada cookie dan Authorization header sekaligus, mana yang menang?
6. Apakah token boleh dipakai untuk endpoint ini?
7. Apakah token terikat pada sender?
8. Apakah request ini replay?

### 9.1 Multiple Credential Ambiguity

Contoh berbahaya:

```http
Authorization: Bearer attacker-token
Cookie: SESSION=victim-session
```

Aplikasi harus punya aturan eksplisit:

```text
For API endpoints: reject if both session cookie and bearer token exist.
For browser endpoints: use session only, ignore bearer token or reject.
For token endpoint: require client authentication mode exactly one.
```

Ambiguitas credential sering menjadi sumber privilege confusion.

## 10. Token Validation

Validation berbeda untuk JWT dan opaque token.

### 10.1 JWT Validation

Resource server harus memvalidasi:

1. Signature.
2. Algorithm allowlist.
3. Key ID and key source.
4. Issuer.
5. Audience.
6. Expiry.
7. Not-before.
8. Issued-at sanity.
9. Scope/permission.
10. Token type.
11. Client/authorized party.
12. Tenant.
13. Assurance if relevant.
14. Revocation strategy if needed.
15. Sender constraint if token is bound.

Pseudo-flow Java:

```java
public AuthenticatedPrincipal validateAccessToken(String token, RequestContext request) {
    Jwt jwt = jwtDecoder.decode(token);

    requireIssuer(jwt, trustedIssuerFor(request));
    requireAudience(jwt, "case-management-api");
    requireTokenUse(jwt, "access");
    requireNotExpired(jwt, clock);
    requireNotBefore(jwt, clock);
    requireAllowedAlgorithm(jwt);
    requireTenant(jwt, request.tenantId());
    requireScope(jwt, request.requiredScope());

    if (isSenderConstrained(jwt)) {
        requireSenderProof(jwt, request);
    }

    return mapPrincipal(jwt);
}
```

### 10.2 Opaque Token Validation

Opaque token biasanya divalidasi dengan introspection.

Flow:

```text
Resource server receives token
        |
        v
Resource server calls introspection endpoint
        |
        v
Authorization server returns active + metadata
        |
        v
Resource server enforces audience/scope/client/tenant
```

Jangan hanya percaya `active=true`.

Tetap validasi:

1. Issuer/AS trust.
2. Audience/resource indicator.
3. Scope.
4. Client ID.
5. Subject semantics.
6. Expiry.
7. Tenant.
8. Token type.

## 11. Expiry Design

Expiry adalah kontrol dasar untuk blast radius.

Terlalu pendek:

1. UX buruk.
2. Refresh storm.
3. Authorization server load tinggi.
4. Mobile/CLI sering putus.

Terlalu panjang:

1. Token leak berdampak lama.
2. Revocation sulit jika stateless.
3. Permission changes tidak cepat berlaku.
4. Offboarding lambat efektif.

### 11.1 Typical Lifetime Heuristics

Ini bukan aturan mutlak, tetapi starting point desain:

| Token | Suggested Lifetime | Notes |
|---|---:|---|
| Authorization code | 30-120 seconds | Single-use, PKCE-bound |
| Access token browser/BFF | 5-15 minutes | Short-lived |
| Access token service-to-service | 5-30 minutes | Audience-bound |
| ID token | 5-15 minutes | Used at login/client validation |
| Refresh token public client | Hours-days with rotation | Sender-constrained or rotated |
| Refresh token confidential web client | Hours-days-weeks | Server-side storage preferred |
| Session cookie idle timeout | 15-60 minutes | Depends risk |
| Session absolute timeout | 8-24 hours | Enterprise policy dependent |
| Password reset token | 10-30 minutes | Single-use |
| Email verification token | Hours-days | Lower privilege but still bounded |
| Invitation token | Hours-days | Depends business risk |
| API key | Days-months | Rotation required |

### 11.2 Expiry Should Match Risk

High-risk operation:

```text
change bank account
change MFA
export regulated data
approve enforcement action
issue legal notice
admin role assignment
```

Should require:

1. Fresh authentication.
2. Step-up MFA.
3. Shorter token/session window.
4. Stronger audit.
5. Possibly transaction signing.

## 12. Sliding vs Absolute Expiry

### 12.1 Sliding Expiry

Sliding expiry extends validity on activity.

Example:

```text
Idle timeout = 30 minutes
User active at minute 25 -> expiry extends another 30 minutes
```

Benefit:

1. Good UX.
2. Natural for sessions.

Risk:

1. Stolen token can stay alive if attacker keeps using it.
2. Harder to reason about absolute risk window.

### 12.2 Absolute Expiry

Absolute expiry ends session/token regardless of activity.

Example:

```text
Absolute session lifetime = 8 hours
After 8 hours user must authenticate again
```

Benefit:

1. Bounded risk.
2. Better compliance.

Risk:

1. User disruption.

Production design often combines both:

```text
idle timeout: 30 minutes
absolute timeout: 8 hours
refresh token max lifetime: 7 days
refresh token inactivity timeout: 24 hours
```

## 13. Token Rotation

Rotation means replacing an old token with a new token.

### 13.1 Access Token Rotation

Access tokens are naturally rotated by refresh:

```text
refresh token -> new access token
```

Access token rotation is usually not tracked individually unless:

1. Opaque tokens are used.
2. High-risk environment.
3. Need revocation/audit.
4. Token family tracking is required.

### 13.2 Refresh Token Rotation

Refresh token rotation is critical.

Flow:

```text
Client has RT1
Client uses RT1 at token endpoint
AS validates RT1
AS revokes/supersedes RT1
AS issues AT2 + RT2
Client stores RT2
RT1 must never be used again
```

If RT1 appears again:

```text
reuse detected -> possible theft -> revoke token family -> force re-authentication
```

State model:

```text
RT1 [ACTIVE]
  -> used successfully
RT1 [ROTATED]
RT2 [ACTIVE]

RT1 used again
  -> [REUSE_DETECTED]
  -> revoke RT2 and token family
```

### 13.3 Refresh Token Rotation SQL Transaction

Pseudo-code:

```java
@Transactional
public TokenResponse refresh(String presentedRefreshToken, Client client, RequestContext ctx) {
    String hash = sha256(presentedRefreshToken);

    RefreshTokenRecord current = refreshTokenRepository.findByHashForUpdate(hash)
        .orElseThrow(() -> invalidGrant());

    if (!current.clientId().equals(client.id())) {
        auditSuspicious("REFRESH_CLIENT_MISMATCH", current, client, ctx);
        throw invalidGrant();
    }

    if (current.isExpired() || current.isRevoked()) {
        throw invalidGrant();
    }

    if (current.isRotated()) {
        refreshTokenRepository.revokeFamily(current.familyId(), "REUSE_DETECTED");
        auditCritical("REFRESH_TOKEN_REUSE_DETECTED", current, client, ctx);
        throw invalidGrant();
    }

    String newRefreshToken = secureRandomToken();
    String newHash = sha256(newRefreshToken);

    current.markRotatedTo(newHash, clock.instant());

    refreshTokenRepository.insert(new RefreshTokenRecord(
        newHash,
        current.familyId(),
        current.subjectId(),
        current.clientId(),
        current.sessionId(),
        current.deviceId(),
        clock.instant(),
        calculateRefreshExpiry(current, ctx)
    ));

    String accessToken = accessTokenIssuer.issue(current.subjectId(), client, ctx);

    return new TokenResponse(accessToken, newRefreshToken);
}
```

Important invariants:

1. Lock current refresh token row.
2. Rotate atomically.
3. Store only hash.
4. Revoke token family on reuse.
5. Do not reveal whether token existed.
6. Audit high-risk events.

## 14. Refresh Token Reuse Detection

Reuse detection detects token theft but creates operational complexity.

Scenario:

```text
1. Legitimate client uses RT1 and receives RT2.
2. Attacker had stolen RT1 earlier.
3. Attacker later uses RT1.
4. AS detects RT1 was already rotated.
5. AS revokes token family.
```

But false positives can happen:

1. Client retry after network timeout.
2. Race between two browser tabs.
3. Mobile app concurrent refresh.
4. Load-balanced client not synchronizing storage.
5. User restores old app backup.

### 14.1 Grace Window?

Some systems use a tiny grace window for idempotent refresh retry.

Example:

```text
If RT1 was rotated less than 5 seconds ago by same client/device/IP fingerprint, return same RT2 response or tolerate once.
```

Trade-off:

1. Reduces false positives.
2. Slightly increases replay window.
3. Requires careful idempotency design.

Safer model:

```text
Use refresh operation idempotency key from client where possible.
```

But for public clients, do not over-trust client-generated metadata.

## 15. Revocation

Revocation means token is invalid before natural expiry.

Reasons:

1. User logout.
2. User password change.
3. MFA reset.
4. Admin disables account.
5. Role/permission revoked.
6. Device lost.
7. Token leak detected.
8. Client compromised.
9. Tenant disabled.
10. Key compromise.

### 15.1 Revocation Scope

Revocation can target:

| Scope | Example |
|---|---|
| Single token | Revoke one refresh token |
| Token family | Revoke all tokens derived from same grant |
| Session | Revoke all tokens tied to session |
| Device | Revoke all tokens for device |
| Client | Revoke all tokens for OAuth client |
| User | Revoke all sessions/tokens for user |
| Tenant | Revoke all tokens in tenant |
| Issuer key | Invalidate tokens signed by compromised key |
| Scope/permission | Force re-evaluation of access |

### 15.2 JWT Revocation Problem

JWT is self-contained.

If resource server validates only signature and expiry, then revoked JWT may remain usable until `exp`.

Options:

1. Short access token lifetime.
2. Maintain denylist by `jti` until expiry.
3. Use token version claim checked against user/session version.
4. Use opaque token/introspection for high-risk resources.
5. Use event-driven revocation cache invalidation.
6. Use sender-constrained tokens to reduce replay risk.

### 15.3 Denylist Pattern

```java
public final class JwtRevocationChecker {
    private final RevokedTokenRepository repository;
    private final Cache<String, Boolean> cache;

    public void checkNotRevoked(Jwt jwt) {
        String jti = jwt.getId();
        if (jti == null) {
            throw new BadCredentialsException("Missing token id");
        }

        boolean revoked = cache.get(jti, id -> repository.existsActiveRevocation(id));
        if (revoked) {
            throw new BadCredentialsException("Token revoked");
        }
    }
}
```

Trade-off:

1. Adds lookup/cache.
2. Requires `jti` in token.
3. Denylist entries need TTL until token expiry.
4. Cache invalidation must be designed.

### 15.4 Token Version Pattern

Store version on user/session/client:

```text
user.token_version = 42
JWT claim token_version = 42
```

If admin revokes all user tokens:

```text
user.token_version = 43
```

Any token with `token_version < 43` rejected.

Benefit:

1. Efficient broad revocation.
2. No per-token denylist.

Risk:

1. Requires lookup/cache.
2. Coarse-grained.
3. Must be tenant-aware.
4. Race conditions if update not propagated.

## 16. Logout Semantics

Logout is not one thing.

Types:

1. Local application logout.
2. Authorization server logout.
3. OIDC RP-initiated logout.
4. Front-channel logout.
5. Back-channel logout.
6. Global logout from all devices.
7. Logout from current device only.
8. Token revocation without browser logout.

### 16.1 Local Logout

```text
Invalidate local session cookie only
```

Effect:

1. User logged out of this app.
2. IdP session may remain.
3. Refresh tokens may remain unless revoked.
4. Other apps unaffected.

### 16.2 Global Logout

```text
Invalidate local session + revoke refresh token family + end IdP session + notify relying parties
```

Hard because:

1. Browser channels can fail.
2. Back-channel delivery can fail.
3. Stateless access tokens may live until expiry.
4. Apps may have independent sessions.

### 16.3 Logout Invariant

After logout:

```text
No new access token should be obtainable using the old refresh token/session.
Existing short-lived access tokens may remain valid until expiry unless revocation/introspection/denylist is enforced.
```

This must be explicit in architecture docs.

## 17. Token Binding and Sender Constraint

Bearer token problem:

```text
Whoever has the token can use it.
```

Sender-constrained token reduces replay:

```text
Token can only be used by holder that proves possession of key/certificate.
```

Methods:

1. mTLS-bound access token.
2. DPoP-style proof-of-possession.
3. Private-key-bound client assertion.
4. Device-bound refresh token.
5. Platform key-bound credential.

### 17.1 mTLS-Bound Token Concept

```text
Authorization server issues token with cnf claim referencing certificate thumbprint.
Resource server validates token AND TLS client cert thumbprint.
```

Conceptual JWT claim:

```json
{
  "cnf": {
    "x5t#S256": "base64url-sha256-cert-thumbprint"
  }
}
```

Validation:

```text
token signature valid
issuer valid
audience valid
expiry valid
cnf thumbprint == client certificate thumbprint from TLS connection
```

### 17.2 Sender Constraint Trade-Off

Benefit:

1. Stolen token alone is insufficient.
2. Stronger for service-to-service.
3. Reduces replay.

Cost:

1. More complex key/cert lifecycle.
2. Harder through proxies/gateways.
3. Mobile key storage varies.
4. Operational debugging harder.

## 18. Token Exchange and Delegation Lifecycle

Token exchange allows one token to be exchanged for another token, often with different audience or subject semantics.

Use cases:

1. Gateway receives user token, exchanges for internal API token.
2. Service A calls Service B with narrower audience.
3. Batch job acts on behalf of system actor.
4. Admin support impersonation requires explicit delegated token.
5. Cross-domain identity bridging.

### 18.1 Avoid Raw Token Relay Everywhere

Bad pattern:

```text
Browser token -> Gateway -> Service A -> Service B -> Service C -> Queue -> Worker
```

Problem:

1. Too many services can replay original token.
2. Audience may be wrong.
3. Expiry may not match downstream task.
4. Audit cannot distinguish who delegated what.
5. Token leak blast radius grows.

Better:

```text
Browser token audience=gateway
Gateway validates
Gateway exchanges for audience=service-a
Service A exchanges/delegates for audience=service-b with narrower scope
Async worker receives job identity reference, not raw user access token
```

### 18.2 Delegation Record

For audit:

```json
{
  "event_type": "TOKEN_EXCHANGED",
  "actor_subject": "user-123",
  "requesting_client": "case-web-bff",
  "requesting_service": "case-service",
  "target_audience": "document-service",
  "delegation_mode": "on_behalf_of",
  "source_token_jti_hash": "sha256:...",
  "issued_token_jti_hash": "sha256:...",
  "scope_reduction": ["document:read"],
  "correlation_id": "req-..."
}
```

## 19. Token Lifecycle in Async and Event-Driven Systems

Do not put raw user access token into messages unless you have a very strong reason.

Bad:

```json
{
  "event": "CASE_APPROVED",
  "access_token": "eyJhbGci..."
}
```

Problems:

1. Token stored in broker.
2. Token replicated to DLQ.
3. Token appears in logs.
4. Token may expire before consumer processes.
5. Consumer may use token for wrong audience.
6. Replay risk.

Better:

```json
{
  "event_id": "evt-123",
  "event_type": "CASE_APPROVED",
  "business_actor": {
    "type": "USER",
    "subject_id": "user-123"
  },
  "technical_actor": {
    "type": "SERVICE",
    "service_id": "case-service"
  },
  "authorization_snapshot_id": "authz-snap-789",
  "correlation_id": "req-456"
}
```

Then consumer uses its own service credential and authorization snapshot/reference.

## 20. Token Lifecycle for Java Application Types

### 20.1 Server-Side Web App

Recommended:

```text
Browser stores HttpOnly Secure SameSite cookie
Server stores session and/or refresh token server-side
Access token kept server-side
API calls made by server/BFF
```

### 20.2 SPA with Backend-for-Frontend

Recommended:

```text
SPA -> BFF session cookie
BFF -> token endpoint/resource APIs
No refresh token in browser JavaScript
```

### 20.3 Native Mobile App

Recommended:

```text
Authorization Code + PKCE
External browser
Refresh token rotation
Secure OS storage
Device/session management
```

### 20.4 CLI

Recommended:

```text
Device flow or Authorization Code + PKCE loopback
Store refresh token in OS credential store if possible
Short access token
Explicit logout/revoke command
```

### 20.5 Service-to-Service

Recommended:

```text
Client credentials
mTLS/private_key_jwt where appropriate
Short-lived access token
Audience per API
No human refresh token
```

### 20.6 Batch Job

Recommended:

```text
Workload identity or client credentials
No copied user token
Explicit job actor
Auditable system principal
```

## 21. Java 8–25 Implementation Considerations

### 21.1 Java 8 Reality

Java 8 systems often have:

1. Legacy servlet sessions.
2. Old Spring Security versions.
3. JKS keystores.
4. Custom JWT validation.
5. Hand-rolled token stores.
6. Weak token random generation.
7. ThreadLocal-heavy security context.

Minimum principles:

1. Use `SecureRandom` for opaque tokens.
2. Store token hashes, not raw tokens.
3. Avoid writing crypto yourself.
4. Use well-maintained JWT/OAuth libraries.
5. Validate issuer/audience/expiry strictly.
6. Add rotation/revocation tables for refresh tokens.

### 21.2 Java 11/17/21/25 Improvements

Modern Java helps with:

1. Better TLS defaults.
2. Better HTTP client from Java 11.
3. Better container and cloud runtime practices.
4. Records for immutable token metadata.
5. Pattern matching and sealed types for lifecycle states in modern Java.
6. Virtual threads in Java 21+ for concurrent introspection/token calls, if used carefully.
7. Scoped values/structured concurrency in modern Java for safer context propagation patterns.
8. Java 25 crypto/key material improvements such as PEM encodings and KDF API are relevant for key handling around token systems.

### 21.3 Sealed Type Model for Token State

Modern Java can model lifecycle states explicitly:

```java
public sealed interface RefreshTokenState
        permits ActiveRefreshToken, RotatedRefreshToken, RevokedRefreshToken, ExpiredRefreshToken,
                ReuseDetectedRefreshToken {
}

public record ActiveRefreshToken(
        String tokenHash,
        String familyId,
        String subjectId,
        String clientId,
        Instant issuedAt,
        Instant expiresAt
) implements RefreshTokenState {
}

public record RotatedRefreshToken(
        String tokenHash,
        String rotatedToHash,
        Instant rotatedAt
) implements RefreshTokenState {
}

public record RevokedRefreshToken(
        String tokenHash,
        String reason,
        Instant revokedAt
) implements RefreshTokenState {
}

public record ExpiredRefreshToken(
        String tokenHash,
        Instant expiredAt
) implements RefreshTokenState {
}

public record ReuseDetectedRefreshToken(
        String tokenHash,
        Instant detectedAt
) implements RefreshTokenState {
}
```

This makes invalid transitions easier to detect.

## 22. Secure Random Token Generation

Opaque tokens should be high entropy.

Example:

```java
import java.security.SecureRandom;
import java.util.Base64;

public final class TokenGenerator {
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();

    public String generateOpaqueToken() {
        byte[] bytes = new byte[32]; // 256 bits
        SECURE_RANDOM.nextBytes(bytes);
        return BASE64_URL.encodeToString(bytes);
    }
}
```

Do not use:

```java
UUID.randomUUID().toString()
```

for high-value refresh tokens/password reset tokens unless you have explicitly evaluated entropy and format requirements. Prefer 256-bit random tokens for high-value bearer credentials.

## 23. Hashing Opaque Tokens

Store only token hash.

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class TokenHasher {
    public String sha256(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
```

For Java 8, `HexFormat` is not available; implement hex encoding manually or use a vetted library.

Why hash?

1. Database leak does not immediately reveal active tokens.
2. Operators cannot accidentally copy usable tokens.
3. Logs and support tooling can use token hash prefix safely.

For very high-value tokens, consider HMAC hashing with server-side pepper:

```text
stored_token_digest = HMAC-SHA256(server_pepper, raw_token)
```

This prevents offline guessing if tokens have insufficient entropy, though high-entropy token remains the primary defense.

## 24. Token Prefix Pattern

API keys and opaque tokens often use a visible prefix:

```text
ak_live_3Fh9...secret...
rt_prod_8Kf2...secret...
```

Prefix benefits:

1. Identifies token type.
2. Identifies environment.
3. Helps routing lookup.
4. Helps support without exposing secret.
5. Helps secret scanners detect leaked tokens.

But prefix must not be enough to authenticate.

Split model:

```text
public prefix/key id + secret random part
```

Database:

```sql
key_prefix VARCHAR(32) NOT NULL,
token_hash CHAR(64) NOT NULL UNIQUE
```

Lookup:

1. Extract prefix.
2. Find small candidate set.
3. Hash full presented token.
4. Constant-time compare if comparing in memory.

## 25. Constant-Time Comparison

When comparing secrets in application code, use constant-time comparison where applicable.

```java
import java.security.MessageDigest;

public boolean constantTimeEquals(byte[] a, byte[] b) {
    return MessageDigest.isEqual(a, b);
}
```

Do not write early-exit comparison for secrets:

```java
for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
}
```

For database lookup by hash, timing risk is usually dominated by DB behavior, but internal secret comparison should still be disciplined.

## 26. Token Cache Design

Token validation often uses caches:

1. JWKS cache.
2. Introspection response cache.
3. Revocation cache.
4. User token version cache.
5. Session cache.
6. Authorization snapshot cache.

### 26.1 Cache Invariants

1. Cache TTL must not exceed token expiry.
2. Negative cache must be short-lived.
3. Revocation must have invalidation strategy.
4. Cache key must include issuer/audience/tenant where relevant.
5. Cache must not cause cross-tenant acceptance.
6. Cache outage behavior must be explicit.

### 26.2 Introspection Cache

If introspection response says:

```json
{
  "active": true,
  "sub": "user-123",
  "aud": "case-api",
  "scope": "case:read",
  "exp": 1760000300
}
```

Cache TTL should be:

```text
min(configuredMaxTtl, exp - now, revocationFreshnessRequirement)
```

For high-risk endpoint, use shorter cache or no cache.

## 27. Fail-Open vs Fail-Closed

When validation dependency is down:

```text
JWKS endpoint unavailable
Introspection endpoint unavailable
Revocation store unavailable
Redis session store unavailable
Database unavailable
```

What should happen?

### 27.1 Fail-Closed

Reject request if validation cannot be completed.

Benefit:

1. Safer security posture.
2. Prevents accepting revoked/invalid tokens.

Cost:

1. Availability impact.
2. IdP outage can take down business APIs.

### 27.2 Fail-Open

Accept based on cached last-known-good data.

Benefit:

1. Better availability.
2. Useful for low-risk read-only APIs.

Risk:

1. Revoked tokens may continue working.
2. Compromised users may retain access.
3. Compliance issue if not documented.

### 27.3 Better Model: Risk-Tiered Behavior

```text
Low-risk read endpoint:
  accept cached validation for up to 5 minutes

Medium-risk write endpoint:
  require fresh validation or short cache

High-risk admin/financial/legal endpoint:
  fail closed if revocation/introspection unavailable
```

Document this explicitly.

## 28. Token Lifecycle and Permission Changes

When roles/scopes change, existing tokens may still contain old permissions.

Options:

1. Short access token lifetime.
2. Opaque token introspection with live permission lookup.
3. JWT with permission version claim.
4. Token revocation on role change.
5. Force refresh after role change.
6. Step-up for high-risk actions.

### 28.1 Permission Version Pattern

```text
user.permission_version = 17
JWT claim pv = 17
```

Resource server checks cached user permission version.

If current version > token version:

```text
reject token / require refresh
```

Trade-off:

1. Adds lookup/cache.
2. Enables faster permission revocation.
3. Requires consistent update on permission mutation.

## 29. Token Lifecycle and Tenant Changes

Multi-tenant systems need tenant-bound tokens.

Bad:

```json
{
  "sub": "user-123",
  "roles": ["ADMIN"]
}
```

Better:

```json
{
  "sub": "user-123",
  "tenant_id": "cea",
  "aud": "case-api",
  "roles": ["CASE_MANAGER"]
}
```

Even better for multi-tenant membership:

```json
{
  "sub": "user-123",
  "active_tenant": "cea",
  "tenant_membership_version": 9,
  "aud": "case-api",
  "scope": "case:read case:update"
}
```

Avoid tokens that grant access across tenants unless explicitly designed.

## 30. Token Lifecycle and Account Events

Account events should trigger token lifecycle actions.

| Account Event | Token Action |
|---|---|
| Password changed | Revoke refresh tokens, maybe sessions |
| MFA enrolled | Optionally require re-auth for sensitive sessions |
| MFA reset | Revoke sessions/refresh tokens |
| Email changed | Re-auth and audit |
| Account disabled | Revoke all tokens/sessions |
| Role removed | Revoke or force refresh |
| Device lost | Revoke device tokens |
| Suspicious login | Revoke token family, challenge user |
| Tenant access removed | Revoke tenant-bound tokens |
| Client secret compromised | Revoke client tokens and rotate secret |

## 31. Incident Response: Token Leak

A token leak response depends on token type.

### 31.1 Access Token Leak

Questions:

1. Is it expired?
2. Is it JWT or opaque?
3. Is it sender-constrained?
4. Which subject/client/audience/scope?
5. Which logs reveal usage?
6. Can we denylist `jti`?
7. Is refresh token also leaked?

Actions:

1. Revoke/denylist if possible.
2. Revoke related refresh token family if uncertain.
3. Review access logs by token hash/jti.
4. Notify affected user/admin if needed.
5. Rotate signing key only if key compromise, not for single token leak.

### 31.2 Refresh Token Leak

Higher severity.

Actions:

1. Revoke refresh token family.
2. Revoke related sessions.
3. Mark device/session suspicious.
4. Force re-authentication.
5. Check reuse detection events.
6. Check access token issuance after suspected compromise time.
7. Notify user/admin if appropriate.

### 31.3 Signing Key Leak

Critical.

Actions:

1. Stop using compromised key immediately.
2. Publish new JWKS.
3. Revoke/invalidate tokens signed by compromised key if possible.
4. Shorten acceptance of old key.
5. Audit all tokens issued in compromise window.
6. Rotate downstream trust stores/caches.
7. Communicate incident timeline.

## 32. Token Lifecycle Observability

You need events, not raw tokens.

Important events:

1. `TOKEN_ISSUED`
2. `TOKEN_REFRESHED`
3. `REFRESH_TOKEN_ROTATED`
4. `REFRESH_TOKEN_REUSE_DETECTED`
5. `TOKEN_REVOKED`
6. `TOKEN_INTROSPECTED`
7. `TOKEN_REJECTED`
8. `TOKEN_EXPIRED`
9. `TOKEN_DENYLIST_HIT`
10. `TOKEN_EXCHANGED`
11. `SESSION_LOGOUT`
12. `GLOBAL_LOGOUT_REQUESTED`

### 32.1 Token Rejection Reasons

Classify rejection:

```text
missing_token
malformed_token
invalid_signature
unknown_issuer
invalid_audience
expired
not_yet_valid
revoked
insufficient_scope
tenant_mismatch
sender_constraint_failed
token_type_invalid
reuse_detected
introspection_inactive
```

Expose generic error to client, but log structured internal reason.

Client response:

```json
{
  "error": "invalid_token"
}
```

Internal log:

```json
{
  "event_type": "TOKEN_REJECTED",
  "reason": "invalid_audience",
  "issuer": "https://idp.example.com/realms/agency",
  "audience_claim": "other-api",
  "expected_audience": "case-api",
  "client_id": "aceas-web-bff",
  "correlation_id": "req-123"
}
```

## 33. Token Lifecycle Metrics

Useful metrics:

1. Token issuance rate by client.
2. Refresh success/failure rate.
3. Refresh token reuse detected count.
4. Revocation count by reason.
5. Introspection latency.
6. JWKS fetch failures.
7. JWT validation failures by reason.
8. Expired token rate.
9. Invalid audience rate.
10. Access token average age at use.
11. Session logout count.
12. Token exchange count.
13. Token endpoint error rate.
14. Authorization server dependency failure.
15. Revocation propagation lag.

Alert examples:

```text
refresh_token_reuse_detected > 0 in 5 minutes for same client
invalid_token_rate increases 5x baseline
introspection_p95_latency > 500ms
jwks_fetch_failure for > 10 minutes
access_token_issued_rate spikes 10x for one client
```

## 34. Common Anti-Patterns

### 34.1 Long-Lived JWT Access Token

```text
JWT access token valid for 24 hours
No revocation
Contains roles
Used by browser
```

Problem:

1. Stolen token works for 24 hours.
2. Role changes not reflected.
3. Logout ineffective.
4. Browser exposure risk.

### 34.2 Refresh Token in LocalStorage

Problem:

1. XSS can steal long-lived credential.
2. Attacker can mint access tokens.
3. Rotation helps but cannot fully save poor storage.

### 34.3 ID Token Used as API Token

Problem:

1. Wrong audience.
2. Wrong semantics.
3. API may accept login assertion as authorization.

### 34.4 No Token Type Claim

If JWT does not distinguish token type:

```text
ID token accidentally accepted as access token
access token accepted at endpoint expecting refresh-like token
```

Use explicit token type or enforce by issuer/audience/client endpoint.

### 34.5 No `jti`

Without token ID, denylist and forensic tracing become harder.

### 34.6 Logging Raw Token

Never log:

```text
Authorization: Bearer eyJ...
refresh_token=...
```

Log:

```text
token_hash_prefix=ab12cd34
token_jti=at-...
```

### 34.7 Reusing One Token Across APIs

Bad:

```text
aud = ["api-a", "api-b", "api-c", "api-d"]
```

Better:

```text
one audience per token or narrow resource indicator
```

### 34.8 No Revocation Story

Every token design must answer:

```text
What happens if this token leaks?
```

If the answer is unclear, lifecycle design is incomplete.

## 35. Production Design Checklist

### 35.1 Issuance

- [ ] Token type is explicit.
- [ ] Issuer is explicit.
- [ ] Subject semantics are documented.
- [ ] Audience is narrow.
- [ ] Scope/permissions are minimal.
- [ ] Expiry is present.
- [ ] Client binding exists where relevant.
- [ ] Tenant binding exists where relevant.
- [ ] Token ID or equivalent trace ID exists.
- [ ] Issuance event is audited.

### 35.2 Storage

- [ ] Refresh tokens are not stored raw server-side.
- [ ] Browser does not store high-value refresh token in `localStorage`.
- [ ] Server-side token store has expiry indexes.
- [ ] Token family is tracked.
- [ ] Device/session association is tracked.
- [ ] Token logs are redacted.

### 35.3 Validation

- [ ] JWT signature is validated.
- [ ] Algorithm is allowlisted.
- [ ] Issuer is validated.
- [ ] Audience is validated.
- [ ] Expiry and clock skew are handled.
- [ ] Token type is enforced.
- [ ] Tenant is enforced.
- [ ] Scope is enforced.
- [ ] Revocation strategy is implemented where required.
- [ ] Sender constraint is validated where used.

### 35.4 Rotation

- [ ] Refresh token rotation is atomic.
- [ ] Reuse detection exists.
- [ ] Token family revocation exists.
- [ ] Race/concurrent refresh behavior is defined.
- [ ] Retry/idempotency behavior is defined.

### 35.5 Revocation

- [ ] Single-token revocation exists where needed.
- [ ] Session-level revocation exists.
- [ ] Device-level revocation exists.
- [ ] User-level revocation exists.
- [ ] Client-level revocation exists.
- [ ] Permission change behavior is defined.
- [ ] Logout behavior is documented.

### 35.6 Operations

- [ ] Token events are logged safely.
- [ ] Token metrics exist.
- [ ] Alerts exist for reuse/spikes/failures.
- [ ] Incident playbook exists.
- [ ] Key rotation procedure exists.
- [ ] Cache invalidation behavior is tested.
- [ ] Fail-open/fail-closed decision is documented by endpoint risk tier.

## 36. Design Questions

Use these questions during architecture review:

1. What token types exist in the system?
2. Who issues each token?
3. Who validates each token?
4. What does each token prove?
5. What does each token not prove?
6. What is the holder of each token?
7. Where is each token stored?
8. What is the lifetime of each token?
9. Can each token be revoked?
10. What happens after logout?
11. What happens after password change?
12. What happens after MFA reset?
13. What happens after role removal?
14. What happens after account disablement?
15. What happens after tenant access removal?
16. What happens if access token leaks?
17. What happens if refresh token leaks?
18. What happens if signing key leaks?
19. Is the token bearer or sender-constrained?
20. Is the audience narrow enough?
21. Does the API reject token with wrong audience?
22. Does the system distinguish ID token and access token?
23. Does the system detect refresh token reuse?
24. Are token stores indexed for expiry cleanup?
25. Are raw tokens excluded from logs?
26. How is revocation propagated to resource servers?
27. How long can a revoked token remain usable?
28. What is the maximum blast radius by token type?
29. Can audit reconstruct token issuance and usage?
30. What is the operational runbook during IdP outage?

## 37. Reference Architecture: Browser BFF Token Lifecycle

```text
+---------+        +------+        +----------------------+        +-------------+
| Browser |        | BFF  |        | Authorization Server |        | Resource API |
+---------+        +------+        +----------------------+        +-------------+
    |                |                       |                          |
    | Login click    |                       |                          |
    |--------------->|                       |                          |
    | Redirect to AS |                       |                          |
    |<---------------|                       |                          |
    | Authenticate with AS                   |                          |
    |--------------------------------------->|                          |
    | Auth code redirect                     |                          |
    |--------------------------------------->|                          |
    |                | Exchange code+PKCE    |                          |
    |                |---------------------->|                          |
    |                | AT + RT               |                          |
    |                |<----------------------|                          |
    | Set session cookie                     |                          |
    |<---------------|                       |                          |
    | API request with session cookie        |                          |
    |--------------->|                       |                          |
    |                | Load server session    |                          |
    |                | Use AT                 |                          |
    |                |--------------------------------------------------->|
    |                | Response              |                          |
    |<---------------|<---------------------------------------------------|
    |                |                       |                          |
    | AT expires     |                       |                          |
    |                | Use RT, rotate         |                          |
    |                |---------------------->|                          |
    |                | new AT + new RT        |                          |
    |                |<----------------------|                          |
```

Important properties:

1. Browser never sees refresh token.
2. Session cookie is HttpOnly/Secure/SameSite.
3. BFF stores refresh token hash/server-side encrypted secret depending design.
4. Refresh token rotates.
5. API access token audience is API-specific.
6. Logout revokes refresh token family.

## 38. Reference Architecture: Service-to-Service Token Lifecycle

```text
+-----------+        +----------------------+        +-----------+
| Service A |        | Authorization Server |        | Service B |
+-----------+        +----------------------+        +-----------+
     |                          |                         |
     | client authentication     |                         |
     | private_key_jwt / mTLS    |                         |
     |-------------------------> |                         |
     | access token aud=B        |                         |
     |<------------------------- |                         |
     | call B with AT            |                         |
     |---------------------------------------------------->|
     |                          |                         | validate issuer/aud/scope/sender
     |                          |                         |
```

Important properties:

1. Service A has workload identity.
2. Token audience is Service B.
3. Access token is short-lived.
4. No user refresh token is involved.
5. Sender constraint preferred for high trust environments.
6. Logs include service identity and business correlation ID.

## 39. Minimal Java Token Lifecycle Service Model

A production authorization server is complex, but internally you can think in interfaces:

```java
public interface TokenIssuer {
    IssuedToken issue(TokenRequest request);
}

public interface TokenValidator {
    ValidatedToken validate(String token, ValidationContext context);
}

public interface TokenRevoker {
    void revoke(TokenRevocationCommand command);
}

public interface TokenRotator {
    RotationResult rotateRefreshToken(String refreshToken, ClientContext client, RequestContext request);
}

public interface TokenAuditSink {
    void record(TokenLifecycleEvent event);
}
```

The design goal is not to implement your own OAuth server blindly. The point is to know what lifecycle responsibilities must exist, whether provided by Keycloak, Spring Authorization Server, custom internal service, gateway, or IdP.

## 40. Summary

Token lifecycle engineering is about controlling temporary authority.

The key lessons:

1. Token is not identity; token is temporary proof or authority reference.
2. Each token type has a different purpose and lifecycle.
3. Access tokens should be short-lived and audience-bound.
4. Refresh tokens are high-value credentials and need rotation/reuse detection.
5. ID tokens must not be used as API access tokens.
6. Session IDs are bearer credentials and need rotation, timeout, and invalidation.
7. Stateless JWT improves local validation but complicates revocation.
8. Opaque tokens improve central control but add introspection dependency.
9. Revocation must be designed by scope: token, family, session, device, user, client, tenant, key.
10. Logout semantics must be explicit; logout does not magically invalidate every stateless token.
11. Sender-constrained tokens reduce replay risk but increase operational complexity.
12. Async systems should carry actor context, not raw user tokens.
13. Token stores should keep hashes, family IDs, expiry, revocation state, and audit metadata.
14. Token events and metrics are required for incident response.
15. Every token design must answer: “What happens if this leaks?”

## 41. References

1. RFC 6749 — The OAuth 2.0 Authorization Framework.
2. RFC 7009 — OAuth 2.0 Token Revocation.
3. RFC 7519 — JSON Web Token.
4. RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients.
5. RFC 7662 — OAuth 2.0 Token Introspection.
6. RFC 8252 — OAuth 2.0 for Native Apps.
7. RFC 8628 — OAuth 2.0 Device Authorization Grant.
8. RFC 8693 — OAuth 2.0 Token Exchange.
9. RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.
10. RFC 9700 — Best Current Practice for OAuth 2.0 Security.
11. OpenID Connect Core 1.0.
12. Spring Security Reference — OAuth2 Client, Resource Server, JWT, Opaque Token, and Authentication Architecture.
13. OWASP Cheat Sheet Series — Authentication, Session Management, JSON Web Token for Java, REST Security, Secrets Management.
14. NIST SP 800-63B — Digital Identity Guidelines: Authentication and Lifecycle Management.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-022.md">⬅️ Part 22 — Authentication for Mobile, Desktop, CLI, and Device Clients</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-024.md">Part 24 — Key Management for Authentication Systems in Java 8–25 ➡️</a>
</div>
