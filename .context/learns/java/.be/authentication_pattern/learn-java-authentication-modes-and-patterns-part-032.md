# learn-java-authentication-modes-and-patterns — Part 32
# Authentication Testing Strategy

> Seri: **Java Authentication Modes and Patterns**  
> Part: **032 / 035**  
> Topik: **Authentication Testing Strategy**  
> Target Java: **Java 8 hingga Java 25**  
> Fokus: membuat authentication dapat diuji secara sistematis, repeatable, defensible, dan production-grade.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas banyak bentuk authentication:

- password authentication,
- session-based authentication,
- servlet container authentication,
- Jakarta Security,
- Spring Security,
- context propagation,
- API key,
- HMAC request signing,
- JWT,
- opaque token introspection,
- OAuth2,
- OIDC,
- PKCE,
- client credentials,
- SAML,
- LDAP/AD/Kerberos,
- mTLS,
- passkeys/WebAuthn,
- MFA,
- mobile/CLI/device clients,
- token lifecycle,
- key management,
- IdP integration,
- multi-tenant authentication,
- microservices/distributed authentication,
- messaging/job/event-driven authentication,
- failure modeling,
- observability/audit/forensics,
- performance/scalability.

Part ini menjawab pertanyaan:

> Setelah semua authentication mode itu dirancang dan diimplementasikan, bagaimana kita membuktikan bahwa sistemnya benar, aman, stabil, dan tidak mudah rusak oleh perubahan?

Authentication testing bukan hanya:

```text
test login success
test login failed
```

Itu terlalu dangkal.

Authentication testing yang matang harus bisa membuktikan:

1. credential valid diterima,
2. credential invalid ditolak,
3. token expired ditolak,
4. token wrong issuer ditolak,
5. token wrong audience ditolak,
6. signature invalid ditolak,
7. replay ditolak,
8. session fixation dicegah,
9. CSRF dicegah bila relevan,
10. logout benar-benar memutus continuity,
11. role/claim mapping tidak salah,
12. tenant boundary tidak bocor,
13. service-to-service identity tidak bisa disubstitusi,
14. context tidak bocor antar thread/request,
15. IdP failure tidak membuat fail-open,
16. audit event tetap tercatat,
17. performance security control tidak menyebabkan sistem collapse,
18. perubahan dependency/framework tidak diam-diam mengubah behavior security.

---

## 1. Problem yang Diselesaikan

Authentication adalah pintu masuk trust ke sistem. Jika authentication salah, semua kontrol setelahnya menjadi rapuh.

Authorization, audit, data ownership, workflow state, escalation, approval, dan compliance biasanya bergantung pada jawaban authentication:

```text
Siapa aktor ini?
Bagaimana dia membuktikan identitasnya?
Seberapa kuat bukti tersebut?
Untuk tenant/realm/client apa identitas ini valid?
Apakah identitas ini user, service, job, device, atau delegated actor?
Apakah continuity/session/token masih valid?
```

Testing harus membuktikan bahwa jawaban-jawaban ini konsisten.

Masalah umum:

1. test hanya happy path;
2. test memakai mock terlalu tinggi sehingga filter/security chain asli tidak jalan;
3. test menganggap JWT valid hanya karena bisa di-decode;
4. test tidak menguji issuer/audience/expiry/signature;
5. test tidak menguji key rotation;
6. test tidak menguji logout dan revocation;
7. test tidak menguji tenant confusion;
8. test tidak menguji concurrency/context leakage;
9. test tidak menguji failure IdP/introspection/JWKS;
10. test tidak menjadi regression suite saat upgrade Spring Security/Jakarta/JDK.

Target part ini adalah membangun strategi testing berlapis.

---

## 2. Mental Model: Authentication Testing sebagai Pembuktian Invariant

Jangan mulai dari tool. Mulai dari invariant.

Authentication invariant adalah aturan yang **harus selalu benar**, apa pun framework, mode, atau deployment-nya.

Contoh invariant:

```text
Request tanpa credential ke endpoint protected harus ditolak.

Token dengan signature invalid harus ditolak.

Token valid tetapi audience salah harus ditolak.

Token dari issuer tenant A tidak boleh diterima untuk tenant B.

Session ID lama setelah login privilege elevation tidak boleh tetap valid.

Logout harus memutus server-side continuity.

Refresh token reuse harus terdeteksi jika rotation dipakai.

Authentication failure harus menghasilkan audit event tanpa membocorkan credential.

Security context tidak boleh bocor ke request berikutnya.

Service token untuk service A tidak boleh dipakai memanggil service B jika audience dibatasi.
```

Testing yang baik memetakan:

```text
Authentication Mode
    -> Invariant
        -> Test Layer
            -> Test Fixture
                -> Expected Result
                    -> Audit/Observability Evidence
```

Diagram mental:

```text
              ┌─────────────────────────┐
              │ Authentication Contract  │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        v                  v                  v
  Positive Path      Negative Path       Failure Path
        │                  │                  │
        v                  v                  v
 Valid credential   Invalid/tampered    IdP/JWKS/DB/cache
 accepted           credential rejected unavailable/slow
        │                  │                  │
        └──────────────────┼──────────────────┘
                           v
                  Security Invariants
```

Top 1% engineer tidak hanya bertanya:

```text
Apakah login berhasil?
```

Tapi:

```text
Bukti apa yang membuat login dianggap valid?
Apa boundary trust-nya?
Apa yang terjadi jika bukti diubah sedikit?
Apa yang terjadi jika dependency external down?
Apa yang terjadi jika request diulang?
Apa yang terjadi jika token lama dipakai setelah logout?
Apa yang terjadi jika tenant/issuer/audience tertukar?
Apa evidence audit-nya?
```

---

## 3. Testing Pyramid untuk Authentication

Authentication butuh beberapa lapis test.

```text
                   ┌────────────────────────────┐
                   │ Manual Security Assessment │
                   │ Pen-test / Threat Replay   │
                   └──────────────┬─────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │ End-to-End Auth Flow Tests       │
                 │ Browser / CLI / Device / IdP     │
                 └────────────────┬────────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │ Integration Tests                │
                 │ Filter Chain + Real Crypto + IdP │
                 └────────────────┬────────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │ Contract / Compatibility Tests   │
                 │ Token Claims, JWKS, SAML, LDAP   │
                 └────────────────┬────────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │ Unit Tests                       │
                 │ Validators, Mappers, Providers   │
                 └────────────────┬────────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │ Static / Build-Time Checks       │
                 │ Config, Secrets, Dependencies    │
                 └─────────────────────────────────┘
```

Setiap layer punya tujuan berbeda.

### 3.1 Static / Build-Time Checks

Menguji hal yang bisa dicegah sebelum runtime.

Contoh:

- dependency security test support tersedia;
- tidak ada hardcoded secret;
- test profile tidak dipakai di production;
- allowed algorithms tidak mengandung `none`;
- deprecated auth mode tidak aktif;
- TLS config minimal sesuai baseline;
- password encoder memakai modern algorithm;
- Spring Security config tidak accidentally `permitAll`;
- CSRF tidak dimatikan tanpa alasan;
- actuator/security endpoint tidak exposed.

### 3.2 Unit Tests

Menguji unit decision logic.

Contoh:

- password verifier;
- API key parser;
- HMAC canonicalizer;
- JWT claim mapper;
- tenant resolver;
- principal mapper;
- authorities converter;
- session policy evaluator;
- step-up decision engine;
- refresh token rotation validator;
- audit event builder.

Unit test tidak boleh berpura-pura membuktikan end-to-end authentication. Ia hanya membuktikan fungsi kecil benar.

### 3.3 Integration Tests

Menguji chain asli.

Contoh:

- `SecurityFilterChain` Spring Security;
- Servlet filter;
- Jakarta `HttpAuthenticationMechanism`;
- real JWT decoder;
- real JWK source;
- real password encoder;
- embedded LDAP/Keycloak/WireMock IdP;
- real session store test container;
- real cookie behavior where possible.

### 3.4 Contract Tests

Menguji kontrak dengan IdP/broker/client/service lain.

Contoh:

- claim `sub` selalu ada;
- `iss` sesuai expected issuer;
- `aud` sesuai resource server;
- `groups`/`roles` format stabil;
- JWKS key id tersedia sebelum token ditandatangani;
- SAML attribute name stabil;
- introspection response format stabil;
- tenant discovery metadata benar.

### 3.5 End-to-End Tests

Menguji user journey penuh.

Contoh:

- browser login via OIDC;
- authorization code + PKCE;
- session cookie diterbitkan;
- logout redirect;
- token refresh;
- MFA challenge;
- passkey registration/assertion;
- CLI device flow.

### 3.6 Manual Security Assessment

Tidak semua bisa diotomasi penuh.

Contoh:

- social recovery abuse;
- MFA fatigue;
- session hijack simulation;
- IdP admin misconfiguration;
- tenant onboarding mistake;
- browser extension risk;
- phishing journey;
- incident response drill.

---

## 4. Test Scope by Authentication Mode

### 4.1 Password Authentication

Invariant utama:

```text
Password yang benar diterima.
Password salah ditolak.
Hash tidak pernah reversible.
Password raw tidak pernah tersimpan atau ter-log.
Password reset tidak menjadi bypass.
Throttling tidak bisa dilewati dengan variasi username casing/IP/header.
Account enumeration tidak bocor lewat response.
```

Test cases:

| Area | Test |
|---|---|
| Hashing | stored value bukan raw password |
| Verification | valid password match |
| Negative | wrong password no match |
| Migration | legacy hash rehash saat login |
| Lockout | repeated failure triggers policy |
| Enumeration | unknown user dan wrong password punya response serupa |
| Reset | reset token single-use |
| Reset expiry | expired token ditolak |
| Logging | credential tidak muncul di log |
| Timing | no obvious user-existence timing leak |

Contoh unit test password encoder migration:

```java
class PasswordHashMigrationTest {

    @Test
    void shouldRequireUpgradeWhenLegacyHashIsUsed() {
        PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();

        String legacyHash = "{noop}secret";

        assertTrue(encoder.matches("secret", legacyHash));
        assertTrue(encoder.upgradeEncoding(legacyHash));
    }

    @Test
    void shouldRejectWrongPassword() {
        PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();

        String hash = encoder.encode("correct-password");

        assertFalse(encoder.matches("wrong-password", hash));
    }
}
```

Catatan penting:

`{noop}` hanya untuk contoh migration test. Jangan pakai untuk production credential.

---

### 4.2 Session-Based Authentication

Invariant utama:

```text
Protected endpoint butuh session valid.
Session ID dirotasi setelah login.
Cookie memakai Secure, HttpOnly, SameSite sesuai profil aplikasi.
Logout menghapus server-side session.
Session idle timeout bekerja.
Absolute timeout bekerja bila dipakai.
Session fixation dicegah.
```

Test cases:

| Area | Test |
|---|---|
| Anonymous access | protected endpoint returns 401/302 |
| Login | session cookie issued |
| Cookie flags | `HttpOnly`, `Secure`, `SameSite` present |
| Fixation | session ID before login != after login |
| Logout | old session cannot access protected endpoint |
| Timeout | expired session rejected |
| Concurrent session | policy enforced |
| CSRF | unsafe method without CSRF rejected if cookie session used |

MockMvc style example:

```java
@Test
void protectedEndpointRequiresAuthentication() throws Exception {
    mvc.perform(get("/account"))
       .andExpect(status().is3xxRedirection());
}

@Test
void unsafePostWithoutCsrfShouldBeRejectedForSessionBasedApp() throws Exception {
    mvc.perform(post("/profile/email")
            .with(user("alice").roles("USER")))
       .andExpect(status().isForbidden());
}

@Test
void unsafePostWithCsrfShouldPassSecurityLayer() throws Exception {
    mvc.perform(post("/profile/email")
            .with(user("alice").roles("USER"))
            .with(csrf())
            .param("email", "alice@example.com"))
       .andExpect(status().isOk());
}
```

Design rule:

```text
Jika auth continuity memakai browser cookie, CSRF harus diuji.
Jika auth memakai bearer token di Authorization header, CSRF model berbeda.
```

---

### 4.3 API Key Authentication

Invariant utama:

```text
API key valid diterima.
API key invalid ditolak.
Raw key tidak disimpan.
Revoked key ditolak.
Expired key ditolak.
Key hanya berlaku untuk tenant/scope/client yang benar.
Rate limit per key bekerja.
```

Test cases:

```text
valid key -> 200
missing key -> 401
malformed key -> 401
unknown prefix -> 401
known prefix wrong secret -> 401
revoked key -> 401
wrong tenant key -> 403 or 401 depending policy
over quota -> 429
rotated old key -> accepted/rejected according to grace policy
```

Example:

```java
@Test
void shouldRejectApiKeyWithValidPrefixButWrongSecret() {
    ApiKey presented = ApiKey.parse("ak_live_abc.invalid-secret-part");

    AuthenticationResult result = verifier.verify(presented);

    assertEquals(AuthenticationStatus.REJECTED, result.status());
    assertEquals("invalid_api_key", result.reasonCode());
}
```

Important:

Do not test API key by comparing raw strings in application code. Test against hashed storage behavior.

---

### 4.4 HMAC Request Signing

Invariant utama:

```text
Signature valid untuk canonical request diterima.
Perubahan method/path/query/header/body membuat signature invalid.
Timestamp lama ditolak.
Nonce replay ditolak.
Wrong key id ditolak.
Canonicalization stabil lintas client Java/non-Java.
```

Test cases:

| Mutation | Expected |
|---|---|
| change method | reject |
| change path | reject |
| reorder query params | accept if canonicalization normalizes |
| change query value | reject |
| change signed header | reject |
| add unsigned irrelevant header | depends policy |
| change body byte | reject |
| old timestamp | reject |
| repeated nonce | reject |
| wrong algorithm version | reject |

Golden vector test:

```java
@Test
void canonicalRequestShouldBeStable() {
    SignedRequest request = new SignedRequest(
        "POST",
        "/v1/payments",
        Map.of("b", "2", "a", "1"),
        Map.of("content-type", "application/json"),
        "{\"amount\":100}".getBytes(StandardCharsets.UTF_8)
    );

    String canonical = canonicalizer.canonicalize(request);

    String expected = String.join("\n",
        "POST",
        "/v1/payments",
        "a=1&b=2",
        "content-type:application/json",
        "e4a1887c00d9dca08773dd7df9afc92666b7e941e224ea25833dc085d4362b6e"
    );

    assertEquals(expected, canonical);
}
```

Top 1% detail:

Canonicalization test harus punya golden vectors yang bisa dibagikan ke partner/client SDK. Kalau tidak, debugging signature mismatch akan mahal.

---

### 4.5 JWT Authentication

Invariant utama:

```text
JWT bukan valid hanya karena bisa di-decode.
JWT valid hanya jika signature, issuer, audience, expiry, not-before, algorithm, key, dan claim policy valid.
```

Test cases:

| Case | Expected |
|---|---|
| valid token | accepted |
| expired token | rejected |
| future `nbf` | rejected |
| wrong issuer | rejected |
| wrong audience | rejected |
| invalid signature | rejected |
| unsupported algorithm | rejected |
| `alg=none` | rejected |
| unknown `kid` | rejected |
| key rotation overlap | accepted during overlap |
| missing subject | rejected |
| missing required scope | authenticated but unauthorized, or rejected depending policy |
| wrong tenant issuer | rejected |

Spring MockMvc JWT test:

```java
@Test
void shouldAcceptJwtWithRequiredScope() throws Exception {
    mvc.perform(get("/api/cases")
            .with(jwt().jwt(jwt -> jwt
                .issuer("https://idp.example.com/realms/agency-a")
                .audience(List.of("case-api"))
                .subject("user-123"))
                .authorities(new SimpleGrantedAuthority("SCOPE_cases.read"))))
       .andExpect(status().isOk());
}
```

But be careful.

The `jwt()` test post-processor builds an authenticated security object for test convenience. It does not necessarily test real signature verification, JWKS retrieval, issuer validation, or audience validation.

Therefore use two levels:

```text
Controller slice test:
    use jwt() to test authorization behavior and controller integration.

Resource server integration test:
    use real signed JWT + configured JwtDecoder + JWKS mock.
```

Integration test concept:

```java
@Test
void shouldRejectJwtSignedByUnknownKey() {
    String token = jwtFactory.signedWithUnknownKey()
        .issuer("https://idp.example.com/realms/main")
        .audience("case-api")
        .subject("alice")
        .compact();

    ResponseEntity<String> response = rest.getForEntity(
        "/api/cases",
        String.class,
        headersWithBearer(token)
    );

    assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
}
```

---

### 4.6 Opaque Token and Introspection

Invariant utama:

```text
Resource server harus menerima token hanya jika introspection menyatakan active=true dan metadata sesuai policy.
```

Test cases:

| Introspection Response | Expected |
|---|---|
| `active=true`, valid scope | accept |
| `active=false` | reject |
| network timeout | reject unless explicit degraded policy |
| malformed response | reject |
| missing subject | reject |
| wrong audience | reject |
| wrong issuer/client | reject |
| cache hit active token | accept within TTL |
| revoked token cached too long | reject after cache invalidation or acceptable risk window |

Test with WireMock:

```java
@Test
void shouldRejectInactiveOpaqueToken() {
    wireMock.stubFor(post("/oauth2/introspect")
        .willReturn(okJson("""
            {
              "active": false
            }
            """)));

    ResponseEntity<String> response = callWithBearer("opaque-token-123");

    assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
}
```

Failure behavior is critical:

```text
If introspection is down, the default secure answer is reject.
Fail-open must be an explicit, reviewed, bounded, audited exception.
```

---

### 4.7 OAuth2/OIDC Login

Invariant utama:

```text
Authorization response harus diikat ke login attempt melalui state.
OIDC authentication harus memakai nonce untuk ID Token.
Redirect URI harus fixed/validated.
ID Token harus divalidasi.
Claims harus dipetakan secara deterministik.
```

Test cases:

| Area | Test |
|---|---|
| state | missing/wrong state rejected |
| nonce | ID token nonce mismatch rejected |
| redirect | unregistered redirect rejected |
| issuer | wrong issuer rejected |
| JWKS | invalid signature rejected |
| account linking | same external ID maps to expected local account |
| first login | required attributes created |
| logout | local session invalidated |
| claim mapping | roles/groups normalized |

E2E tests can use:

- a real local Keycloak container,
- WireMock OAuth2/OIDC mock,
- Spring Authorization Server test instance,
- fake OIDC provider with signed tokens.

---

### 4.8 SAML Authentication

Invariant utama:

```text
SAML assertion harus signed/validated sesuai trust config, tidak expired, tidak replayed, audience/recipient/destination benar, dan attribute mapping deterministik.
```

Test cases:

| Case | Expected |
|---|---|
| valid signed assertion | accept |
| unsigned assertion | reject |
| signed response but unsigned assertion if assertion signature required | reject |
| XML Signature Wrapping payload | reject |
| wrong audience | reject |
| wrong recipient | reject |
| expired assertion | reject |
| replayed assertion ID | reject |
| clock skew within allowed window | accept |
| clock skew beyond window | reject |

SAML testing biasanya membutuhkan fixture XML yang curated. Jangan hanya generate happy path.

---

### 4.9 LDAP / AD / Kerberos

Invariant utama:

```text
Credential diverifikasi oleh directory/KDC, bukan oleh aplikasi secara palsu.
Group mapping benar.
Directory outage tidak menjadi bypass.
Connection pooling tidak memakai identity user sebelumnya.
```

Test cases:

| Area | Test |
|---|---|
| valid bind | accept |
| invalid password | reject |
| unknown user | reject |
| disabled account | reject |
| expired password | reject or special flow |
| nested group | resolved if required |
| wrong base DN | no accidental accept |
| directory timeout | reject/degrade according to policy |
| service account failure | reject and alert |

Use embedded LDAP for basic integration tests. For AD/Kerberos, many teams rely on staging integration plus contract tests because real Kerberos environment is harder to containerize accurately.

---

### 4.10 mTLS

Invariant utama:

```text
Client certificate must be validated by TLS layer and mapped to application principal safely.
```

Test cases:

| Case | Expected |
|---|---|
| no client cert | reject |
| trusted client cert | accept |
| untrusted CA | reject |
| expired cert | reject |
| revoked cert if revocation enabled | reject |
| SAN mismatch | reject |
| subject mapping collision | reject |
| cert from tenant A on tenant B | reject |
| gateway forwarded cert header without trusted gateway | reject |

Important:

If TLS terminates at gateway, application must not blindly trust arbitrary `X-Client-Cert` header from the internet. Test must include direct request with spoofed forwarded cert header.

---

### 4.11 Passkeys / WebAuthn

Invariant utama:

```text
Registration and assertion must be challenge-bound, origin-bound, RP ID-bound, and replay-resistant.
```

Test cases:

| Case | Expected |
|---|---|
| valid registration | credential stored |
| reused challenge | reject |
| wrong origin | reject |
| wrong RP ID | reject |
| assertion with old challenge | reject |
| assertion counter rollback if counter used | reject/risk flag |
| credential for another user | reject |
| deleted credential | reject |
| account recovery flow | requires separate assurance |

Testing WebAuthn often requires browser automation for real flows, plus lower-level library unit tests for verifier logic.

---

### 4.12 MFA / Step-Up

Invariant utama:

```text
MFA should increase assurance, not add a bypass-prone second screen.
```

Test cases:

| Case | Expected |
|---|---|
| password only accessing low-risk endpoint | allowed |
| password only accessing high-risk endpoint | step-up required |
| valid TOTP | assurance upgraded |
| invalid TOTP | rejected and counted |
| reused OTP | rejected |
| recovery code | single-use |
| remembered device | bounded and revocable |
| MFA reset | high assurance required |
| push fatigue | rate limited / number matching if supported |
| OIDC `acr` insufficient | step-up required |

---

### 4.13 Microservices / Token Relay / Token Exchange

Invariant utama:

```text
Downstream service must not accept arbitrary upstream identity unless the token/audience/delegation model proves it.
```

Test cases:

| Case | Expected |
|---|---|
| token for service A sent to service B | reject |
| user token relayed where service token required | reject |
| service token without user delegation where user action required | reject |
| token exchange with allowed actor | accept |
| token exchange with disallowed actor | reject |
| gateway-injected principal header direct to backend | reject |
| missing correlation ID | reject or flag depending policy |
| tenant A service token calling tenant B | reject |

---

### 4.14 Messaging / Jobs / Event-Driven

Invariant utama:

```text
Message identity must be explicit, verifiable, and not confused with consumer process identity.
```

Test cases:

| Case | Expected |
|---|---|
| producer authenticates to broker | allowed |
| unauthorized producer topic | reject |
| consumer unauthorized topic | reject |
| message signed by known producer | accept |
| message signature invalid | reject/dead-letter |
| replayed message ID | reject/idempotent |
| missing actor metadata | reject or process as system actor |
| scheduler job identity | audited as system actor |
| end-user actor in async command | preserved as delegated actor |

---

## 5. Java 8–25 Relevance

Authentication testing spans many Java generations.

### 5.1 Java 8

Common reality:

- legacy Spring Security versions;
- Servlet 3.x/4.x;
- older Keycloak adapters;
- JKS still common;
- older TLS defaults;
- `CompletableFuture` context propagation problems;
- fewer modern testing conveniences.

Testing focus:

```text
Guard legacy behavior with regression tests before migration.
Do not trust old defaults.
Explicitly test TLS, algorithm, cookie, session, and token validation behavior.
```

### 5.2 Java 11 / 17

Common reality:

- long-term supported runtime in many enterprises;
- stronger TLS defaults than Java 8;
- Spring Boot 2.x/3.x transition;
- Jakarta namespace migration begins in modern stacks.

Testing focus:

```text
Migration test from javax.* to jakarta.*.
Spring Security 5 to 6 behavior changes.
Resource server JWT validation.
Session/cookie SameSite behavior through framework/container/gateway.
```

### 5.3 Java 21

Common reality:

- virtual threads available;
- modern Spring Boot 3.x;
- modern TLS/crypto providers;
- structured concurrency preview history;
- context propagation concerns become sharper.

Testing focus:

```text
ThreadLocal security context with virtual threads.
Async task identity propagation.
Executor wrappers.
No identity leakage between tasks.
```

### 5.4 Java 25

Common reality:

- continued modern concurrency model;
- KDF API relevance for key derivation testing;
- PEM handling preview relevance;
- stricter long-term modernization target.

Testing focus:

```text
Key material loading tests.
PEM/PKCS12 compatibility tests.
KDF output vector tests.
Virtual thread and scoped context behavior.
```

---

## 6. The Authentication Test Matrix

A useful test matrix:

| Dimension | Examples |
|---|---|
| Credential type | password, API key, HMAC, JWT, opaque token, cert, SAML, WebAuthn |
| Actor type | user, service, device, job, admin, delegated actor |
| Client type | browser, SPA/BFF, mobile, CLI, batch, partner API |
| State model | session, stateless token, reference token, broker session |
| Trust boundary | edge, gateway, service, broker, IdP, tenant |
| Failure type | invalid, expired, tampered, replayed, wrong tenant, IdP down |
| Expected result | accept, reject 401, reject 403, step-up, revoke, alert |
| Evidence | audit event, metric, trace, log, SIEM signal |

Example:

```text
Mode: JWT
Actor: service
Client: backend service
State: stateless
Trust boundary: service-to-service
Failure: wrong audience
Expected: 401
Evidence: auth.failure reason=invalid_audience, token not logged
```

This matrix avoids random testing. It turns authentication into explicit security contracts.

---

## 7. Test Data and Fixture Design

Authentication tests often fail because test data is sloppy.

Bad fixture:

```text
username: test
password: test
token: abc
role: ADMIN
```

Better fixture:

```text
User:
  id: user-0001
  username: alice.case.officer
  tenant: agency-a
  status: ACTIVE
  assurance: AAL1
  roles:
    - CASE_READ
    - CASE_UPDATE

User:
  id: user-0002
  username: bob.supervisor
  tenant: agency-a
  status: ACTIVE
  assurance: AAL2
  roles:
    - CASE_APPROVE

User:
  id: user-0003
  username: clara.other.tenant
  tenant: agency-b
  status: ACTIVE
  roles:
    - CASE_READ
```

For token tests:

```text
issuer:
  agency-a: https://idp.example.com/realms/agency-a
  agency-b: https://idp.example.com/realms/agency-b

audience:
  case-api
  workflow-api
  report-api

keys:
  kid-current
  kid-previous
  kid-unknown
```

For HMAC:

```text
key_id:
  partner-a-key-001
  partner-a-key-002-rotating
  revoked-key-003

nonce:
  fresh
  repeated
  expired
```

For session:

```text
session:
  anonymous-before-login
  authenticated-after-login
  stale-after-logout
  expired-idle
  expired-absolute
```

Golden rule:

```text
Fixtures must model real boundary conditions, not just convenient values.
```

---

## 8. Positive, Negative, and Mutational Testing

Authentication needs three broad families.

### 8.1 Positive Tests

Valid proof accepted.

Examples:

```text
valid password
valid session
valid JWT
valid OIDC login
valid SAML assertion
valid client certificate
valid HMAC signature
valid WebAuthn assertion
```

Positive tests are necessary but insufficient.

### 8.2 Negative Tests

Invalid proof rejected.

Examples:

```text
wrong password
expired token
invalid signature
wrong issuer
wrong audience
wrong tenant
missing CSRF
revoked API key
unsigned SAML
expired cert
```

### 8.3 Mutational Tests

Start from a valid credential, mutate one field, and prove rejection.

JWT mutation examples:

```text
change `sub`
change `aud`
change `iss`
change `exp`
change `kid`
change algorithm
change payload without resigning
sign with different key
remove required claim
add admin role claim without trusted mapper
```

HMAC mutation examples:

```text
change query order
change body whitespace
change content-type
change timestamp
change nonce
change path case
change percent encoding
```

Session mutation examples:

```text
reuse pre-login session id
reuse post-logout session cookie
change cookie value
remove Secure flag in deployment test
cross-site POST without CSRF
```

Top 1% testing strategy includes mutation because attackers mutate valid objects.

---

## 9. Mocking Strategy: What to Mock and What Not to Mock

A common mistake:

```text
Mock SecurityContext everywhere.
```

That can be useful for business logic tests, but dangerous if it becomes the only testing layer.

### 9.1 Safe to Mock

Mock when testing business logic that assumes authentication already happened.

Example:

```java
@Test
void caseOfficerCanSeeOwnQueue() {
    CurrentActor actor = new CurrentActor("user-123", "agency-a", Set.of("CASE_READ"));

    List<CaseSummary> result = service.findQueue(actor);

    assertThat(result).allMatch(c -> c.tenantId().equals("agency-a"));
}
```

Here authentication itself is not under test.

### 9.2 Do Not Mock When Testing Authentication

Do not mock these if the goal is to test authentication correctness:

- JWT signature verification,
- `iss` validation,
- `aud` validation,
- expiry validation,
- password hash verification,
- HMAC signature validation,
- SAML signature validation,
- CSRF behavior,
- session fixation protection,
- filter chain ordering,
- logout behavior.

For those, use real implementations.

### 9.3 Layered Rule

```text
Business service test:
    mock actor/security context.

Controller authorization test:
    use Spring Security test support.

Authentication integration test:
    use real filter chain and real validators.

External IdP contract test:
    use container/mock IdP with realistic tokens/metadata.
```

---

## 10. Spring Security Testing Patterns

Spring Security provides testing support for Servlet and Reactive applications.

### 10.1 MockMvc Security Setup

Typical setup:

```java
@SpringBootTest
@AutoConfigureMockMvc
class SecurityIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Test
    void shouldRequireAuthentication() throws Exception {
        mvc.perform(get("/api/me"))
           .andExpect(status().isUnauthorized());
    }
}
```

If using form/session app:

```java
@Test
void shouldAllowAuthenticatedUser() throws Exception {
    mvc.perform(get("/api/me").with(user("alice").roles("USER")))
       .andExpect(status().isOk());
}
```

If using CSRF:

```java
@Test
void postShouldRequireCsrf() throws Exception {
    mvc.perform(post("/api/profile").with(user("alice")))
       .andExpect(status().isForbidden());
}
```

If using JWT resource server:

```java
@Test
void shouldAllowJwtWithScope() throws Exception {
    mvc.perform(get("/api/cases")
            .with(jwt().authorities(new SimpleGrantedAuthority("SCOPE_cases.read"))))
       .andExpect(status().isOk());
}
```

### 10.2 What `jwt()` Test Support Proves

It proves:

```text
Given an authenticated JwtAuthenticationToken-like object,
does my controller/security authorization rule behave as expected?
```

It does not fully prove:

```text
real token signature verification,
real JWKS lookup,
real issuer validation,
real audience validation,
real algorithm constraints.
```

Therefore pair it with integration tests using real signed tokens.

### 10.3 Testing Custom JwtAuthenticationConverter

If your production converter maps:

```text
realm_access.roles -> ROLE_*
resource_access.case-api.roles -> ROLE_*
scope -> SCOPE_*
tenant -> tenant context
```

Test it directly.

```java
@Test
void shouldMapRealmRolesToAuthorities() {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .claim("sub", "user-123")
        .claim("realm_access", Map.of("roles", List.of("case_officer")))
        .build();

    Collection<GrantedAuthority> authorities = converter.convert(jwt).getAuthorities();

    assertThat(authorities)
        .extracting(GrantedAuthority::getAuthority)
        .contains("ROLE_case_officer");
}
```

Then test filter integration separately.

### 10.4 WebFlux / Reactive Security Testing

Reactive security does not rely on the same ThreadLocal model as Servlet. Use WebTestClient with Spring Security test configurers.

Conceptual example:

```java
@Test
void reactiveEndpointShouldUseMockJwt() {
    webTestClient
        .mutateWith(mockJwt().authorities(new SimpleGrantedAuthority("SCOPE_cases.read")))
        .get()
        .uri("/api/cases")
        .exchange()
        .expectStatus().isOk();
}
```

Test Reactor context propagation separately if application uses async/reactive boundaries.

---

## 11. Jakarta Security Testing Patterns

Jakarta Security tests should target:

- `HttpAuthenticationMechanism`,
- `IdentityStore`,
- `SecurityContext`,
- Servlet integration,
- container behavior.

### 11.1 IdentityStore Unit Test

```java
@Test
void shouldValidateValidCredential() {
    CredentialValidationResult result = identityStore.validate(
        new UsernamePasswordCredential("alice", new Password("correct"))
    );

    assertEquals(CredentialValidationResult.Status.VALID, result.getStatus());
    assertEquals("alice", result.getCallerPrincipal().getName());
}
```

### 11.2 Authentication Mechanism Integration Test

Use container integration where possible:

- Arquillian,
- Payara Micro test,
- Open Liberty test,
- embedded container,
- black-box HTTP test against packaged application.

Test:

```text
GET protected endpoint without credential -> 401/redirect
POST login with valid credential -> authenticated session
POST login with invalid credential -> reject
Principal visible through SecurityContext
Roles/groups match expected mapping
```

### 11.3 Important Container Differences

Different Jakarta EE containers may differ in:

- default session behavior,
- role mapping,
- realm integration,
- cookie defaults,
- SameSite support,
- TLS client cert exposure,
- interaction between Servlet and Jakarta Security.

Therefore for portable enterprise systems:

```text
Unit tests prove your code.
Container integration tests prove runtime behavior.
```

---

## 12. Testing IdP Integration

IdP integration is where many bugs hide.

### 12.1 What to Test

OIDC IdP contract:

```text
discovery document contains expected endpoints
JWKS exposes current and previous keys
ID Token has expected issuer
ID Token has expected audience/client
subject identifier stable enough for account linking
groups/roles claims stable
acr/amr/auth_time available if step-up relies on them
logout endpoint behavior known
```

### 12.2 Keycloak Testcontainers Pattern

A Keycloak container can be used for higher-fidelity tests:

```text
Start Keycloak container
Import realm JSON
Create test users/clients/roles
Run app against container issuer
Perform real OAuth/OIDC flow or token acquisition
Validate app behavior
```

This is heavier but valuable for:

- authorization code flow,
- client credentials,
- token exchange,
- realm role mapping,
- JWKS rotation behavior,
- logout behavior.

### 12.3 WireMock OIDC Pattern

WireMock can simulate:

- discovery endpoint,
- JWKS endpoint,
- token endpoint,
- userinfo endpoint,
- introspection endpoint.

Use it when you need:

- deterministic responses,
- failure injection,
- malformed metadata,
- latency/timeouts,
- key rotation simulation,
- active/inactive token responses.

Trade-off:

```text
WireMock gives control.
Keycloak gives realism.
Use both at different layers.
```

---

## 13. Testing Token Expiry and Clock Skew

Authentication has a time dimension.

Test these:

```text
expired access token
token not yet valid
token issued far in future
clock skew within tolerance
clock skew beyond tolerance
refresh token expired
refresh token reuse after rotation
session idle timeout
session absolute timeout
SAML assertion validity window
WebAuthn challenge expiry
password reset token expiry
email magic link expiry
```

Avoid `Thread.sleep()` in tests.

Use injectable clock:

```java
final class TokenPolicy {
    private final Clock clock;

    TokenPolicy(Clock clock) {
        this.clock = clock;
    }

    boolean isExpired(Instant expiresAt) {
        return !Instant.now(clock).isBefore(expiresAt);
    }
}
```

Test:

```java
@Test
void shouldRejectExpiredToken() {
    Clock fixed = Clock.fixed(Instant.parse("2026-06-19T10:00:00Z"), ZoneOffset.UTC);
    TokenPolicy policy = new TokenPolicy(fixed);

    assertTrue(policy.isExpired(Instant.parse("2026-06-19T09:59:59Z")));
}
```

For Spring Security JWT, configure decoders/validators with controlled clock or lower-level validator tests where possible.

---

## 14. Testing Revocation and Logout

Many teams test login but not logout.

Logout is not one thing.

It can mean:

```text
delete local session
clear browser cookie
invalidate refresh token
revoke access token
clear remembered device
logout from IdP
front-channel logout
back-channel logout
clear server-side security context
```

Test matrix:

| Auth Mode | Logout/Revocation Test |
|---|---|
| Session | old session cookie rejected |
| JWT access token | cannot revoke unless denylist/introspection/short TTL |
| Refresh token | revoked token cannot refresh |
| Opaque token | introspection active=false rejected |
| OIDC login | local session invalidated |
| OIDC RP logout | redirect/IdP behavior as expected |
| SAML SLO | session index/name ID handled |
| API key | revoked key rejected |
| mTLS | revoked cert rejected if revocation enforced |

Important:

```text
If JWT access tokens are not revocable, test the explicit design:
short TTL + refresh revocation + incident playbook.
```

Do not pretend stateless JWT logout revokes already-issued access tokens unless the system really implements it.

---

## 15. Testing Tenant Isolation

Multi-tenant authentication has unique failure modes.

Invariant:

```text
No credential from tenant A can authenticate as tenant B.
No issuer/JWKS/role mapping from tenant A can authorize access to tenant B resources.
```

Test cases:

```text
tenant A token -> tenant A endpoint -> accept
tenant A token -> tenant B endpoint -> reject
tenant B issuer with tenant A subject -> reject
tenant A JWKS key id collision with tenant B key -> reject
shared issuer but tenant claim mismatch -> reject
admin from tenant A attempts tenant B admin action -> reject
gateway tenant header differs from token tenant -> reject
```

Example:

```java
@Test
void shouldRejectCrossTenantToken() throws Exception {
    String token = jwtFactory
        .issuer("https://idp.example.com/realms/agency-a")
        .audience("case-api")
        .claim("tenant_id", "agency-a")
        .subject("alice")
        .sign();

    mvc.perform(get("/tenant/agency-b/cases")
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
       .andExpect(status().isForbidden());
}
```

Security decision:

```text
Wrong credential validity -> usually 401.
Valid identity but not allowed -> usually 403.
Cross-tenant mismatch can be treated as 403 or hard 401 depending leakage policy.
```

Be consistent.

---

## 16. Testing Authentication Context Propagation

From Part 8, authentication context can be lost or leaked.

Test cases:

```text
SecurityContext available in controller
SecurityContext propagated to async task only if explicitly designed
SecurityContext not leaked to next request
Reactive context available downstream
Virtual thread request does not reuse stale context
Scheduled job uses system actor, not previous user
```

Example leak test concept:

```java
@Test
void shouldNotLeakSecurityContextBetweenTasks() throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(1);

    try {
        Future<String> first = executor.submit(() -> {
            SecurityContextHolder.getContext()
                .setAuthentication(new TestingAuthenticationToken("alice", "n/a"));
            return SecurityContextHolder.getContext().getAuthentication().getName();
        });

        assertEquals("alice", first.get());

        Future<Authentication> second = executor.submit(() ->
            SecurityContextHolder.getContext().getAuthentication()
        );

        assertNull(second.get(), "Authentication leaked across tasks");
    } finally {
        executor.shutdownNow();
        SecurityContextHolder.clearContext();
    }
}
```

In real Spring apps, use the appropriate delegating security context executor only where propagation is intended.

Critical invariant:

```text
Identity propagation must be explicit.
Identity cleanup must be guaranteed.
```

---

## 17. Testing Audit and Observability

Authentication testing is incomplete without evidence testing.

For each important event, test that audit event exists.

Events:

```text
login_success
login_failure
mfa_challenge
mfa_success
mfa_failure
token_issued
token_refreshed
refresh_reuse_detected
logout
session_expired
api_key_used
api_key_revoked
hmac_replay_detected
jwt_rejected
introspection_failed
saml_replay_detected
tenant_mismatch
step_up_required
```

Audit invariant:

```text
Audit must include stable principal ID when known.
Audit must not include password, raw token, raw API key, private key, OTP, passkey private material.
```

Test example:

```java
@Test
void failedLoginShouldEmitAuditEventWithoutPassword() {
    authenticationService.login("alice", "wrong-password");

    AuditEvent event = auditSink.lastEvent();

    assertEquals("login_failure", event.type());
    assertEquals("alice", event.attributes().get("username"));
    assertFalse(event.toString().contains("wrong-password"));
}
```

Observability tests can include:

- log capture,
- in-memory audit sink,
- metric registry assertions,
- trace attribute assertions,
- SIEM pipeline contract tests.

---

## 18. Testing Failure Dependencies

Authentication often depends on external systems:

- IdP,
- JWKS endpoint,
- introspection endpoint,
- LDAP,
- Redis session store,
- database user store,
- KMS/HSM,
- broker,
- network gateway.

Test scenarios:

| Dependency | Failure | Expected |
|---|---|---|
| JWKS | unavailable at startup | app behavior explicit |
| JWKS | unavailable after cache warm | use cache until TTL |
| Introspection | timeout | reject or bounded degraded policy |
| LDAP | timeout | reject, alert |
| Redis session | down | reject or degrade by design |
| KMS | key unavailable | fail closed |
| DB credential store | down | login unavailable |
| IdP | discovery changes | contract fail |
| Clock source | skew | reject beyond tolerance |

Example WireMock timeout:

```java
wireMock.stubFor(post("/oauth2/introspect")
    .willReturn(aResponse()
        .withFixedDelay(5000)
        .withStatus(200)
        .withBody("{\"active\":true}")));
```

Then assert:

```text
request times out within configured auth timeout
result is 401/503 depending policy
audit event emitted
metric incremented
raw token not logged
```

Top 1% mindset:

```text
Authentication failure modes must be deterministic.
Ambiguous degraded security is worse than explicit outage.
```

---

## 19. Testing Security Headers and Cookie Behavior

For browser-based auth, test HTTP response details.

Cookie assertions:

```text
Set-Cookie has HttpOnly
Set-Cookie has Secure
Set-Cookie has SameSite=Lax/Strict/None as designed
Session cookie path/domain scoped correctly
Logout clears cookie with matching path/domain
```

Headers:

```text
Cache-Control no-store on sensitive pages
Pragma no-cache if legacy required
Content-Security-Policy if login page is sensitive
X-Frame-Options or frame-ancestors for login/MFA pages
Referrer-Policy
HSTS if TLS enforced
```

Example:

```java
@Test
void sessionCookieShouldHaveSecureFlags() throws Exception {
    MvcResult result = mvc.perform(post("/login")
            .param("username", "alice")
            .param("password", "correct")
            .with(csrf()))
        .andExpect(status().is3xxRedirection())
        .andReturn();

    String setCookie = result.getResponse().getHeader(HttpHeaders.SET_COOKIE);

    assertThat(setCookie).contains("HttpOnly");
    assertThat(setCookie).contains("Secure");
    assertThat(setCookie).contains("SameSite");
}
```

Caution:

Some SameSite behavior is set by container/proxy, not app code. Test at the closest layer to production where possible.

---

## 20. Testing Authentication Performance

Authentication correctness can collapse under load.

Test:

```text
password hashing latency at selected work factor
login burst behavior
rate limiting behavior
introspection cache hit ratio
JWKS cache refresh
Redis session latency
LDAP pool saturation
TLS handshake overhead
mTLS client cert validation cost
audit sink backpressure
```

Performance tests should assert security behavior too.

Example:

```text
Given 1000 failed login attempts,
system should:
  - not exhaust DB pool
  - apply throttling
  - emit aggregate metrics
  - avoid log flood with raw details
  - keep legitimate login path available
```

Do not optimize by weakening authentication silently.

Bad:

```text
BCrypt too slow under login burst, switch to plaintext/noop.
```

Good:

```text
Use appropriate work factor, rate limit, queueing, autoscaling, caching for non-secret metadata, and separate login capacity planning.
```

---

## 21. Contract Testing with External Clients and Partners

For partner APIs using API key/HMAC/JWT/mTLS, provide executable contracts.

Examples:

```text
HMAC canonical request test vectors
JWT required claim contract
JWKS rotation contract
OAuth2 token endpoint contract
mTLS certificate subject/SAN mapping contract
API key prefix format contract
error response contract
rate limit header contract
```

Contract example:

```json
{
  "case": "hmac-valid-post-payment",
  "method": "POST",
  "path": "/v1/payments",
  "query": "a=1&b=2",
  "headers": {
    "content-type": "application/json",
    "x-key-id": "partner-a-key-001",
    "x-timestamp": "2026-06-19T10:00:00Z",
    "x-nonce": "nonce-001"
  },
  "body": "{\"amount\":100}",
  "expectedCanonicalRequestSha256": "....",
  "expectedSignature": "...."
}
```

This reduces integration ambiguity.

---

## 22. Security Regression Suite

Authentication tests must run continuously.

Recommended suite:

```text
auth-unit
auth-web-slice
auth-integration
auth-idp-contract
auth-negative
auth-replay
auth-tenant
auth-logout
auth-observability
auth-performance-smoke
```

CI stages:

```text
Pull Request:
  - unit tests
  - fast security slice tests
  - negative JWT/session/API-key tests

Main branch:
  - integration tests with WireMock/Testcontainers
  - IdP contract tests
  - tenant isolation tests

Nightly:
  - browser E2E login/logout/MFA
  - performance/security smoke
  - dependency upgrade compatibility

Pre-release:
  - full auth regression
  - manual threat replay checklist
  - audit evidence verification
```

Important:

```text
Authentication regression tests should block release.
```

---

## 23. Common Mistakes

### Mistake 1 — Only Testing Happy Login

Bad:

```text
valid username/password -> OK
```

Missing:

```text
wrong password
unknown user
locked user
disabled user
expired password
reset token reuse
brute force
audit
enumeration
```

### Mistake 2 — Treating Mock User as Authentication Test

`@WithMockUser` or `with(user(...))` does not prove real credential validation.

It proves behavior after authentication.

### Mistake 3 — Decoding JWT Instead of Validating JWT

JWT decoding is not validation.

Validation requires:

```text
signature
algorithm
issuer
audience
expiry
not-before
key
claims
tenant
policy
```

### Mistake 4 — Not Testing Logout

Many systems have login tests but no logout/revocation tests.

### Mistake 5 — Not Testing Failure of IdP/JWKS/Introspection

If external auth dependency fails, behavior must be explicit and tested.

### Mistake 6 — No Cross-Tenant Negative Tests

Multi-tenant systems without cross-tenant negative tests are fragile.

### Mistake 7 — Logging Raw Credential in Test Failure

Tests sometimes print token/password/API key on assertion failure. Avoid this.

### Mistake 8 — Test Profile Weaker Than Production

Example:

```text
test disables security entirely
test uses permitAll
test uses noop password
test disables CSRF
test accepts unsigned JWT
```

This is acceptable only for tests not about authentication. For authentication tests, it invalidates the test.

### Mistake 9 — Not Testing Time

Expiry, skew, timeout, rotation, reuse detection, and challenge validity are time-based. They need controlled clock tests.

### Mistake 10 — No Upgrade Regression

Spring Security, Servlet container, JDK, Keycloak, and IdP upgrades can change behavior. Authentication regression must protect against accidental drift.

---

## 24. Production Checklist

Use this checklist before release.

### 24.1 Password

- [ ] password hash verification tested;
- [ ] wrong password tested;
- [ ] unknown user response tested;
- [ ] password reset single-use tested;
- [ ] reset expiry tested;
- [ ] throttling/lockout tested;
- [ ] raw password absent from logs.

### 24.2 Session

- [ ] protected endpoint requires auth;
- [ ] session ID rotates after login;
- [ ] logout invalidates session;
- [ ] cookie flags tested;
- [ ] CSRF tested if cookie auth;
- [ ] idle timeout tested;
- [ ] absolute timeout tested if configured.

### 24.3 Token

- [ ] signature validation tested;
- [ ] issuer validation tested;
- [ ] audience validation tested;
- [ ] expiry tested;
- [ ] wrong key tested;
- [ ] key rotation tested;
- [ ] revocation/denylist/introspection tested if required;
- [ ] raw token absent from logs.

### 24.4 OIDC/OAuth2

- [ ] state validation tested;
- [ ] nonce validation tested for OIDC;
- [ ] redirect URI behavior tested;
- [ ] claim mapping tested;
- [ ] JWKS failure tested;
- [ ] IdP outage behavior tested;
- [ ] logout behavior tested.

### 24.5 SAML

- [ ] signature validation tested;
- [ ] XML Signature Wrapping negative fixture tested;
- [ ] audience/recipient/destination tested;
- [ ] assertion expiry tested;
- [ ] replay detection tested;
- [ ] attribute mapping tested.

### 24.6 mTLS

- [ ] no cert rejected;
- [ ] untrusted CA rejected;
- [ ] expired cert rejected;
- [ ] SAN/subject mapping tested;
- [ ] spoofed forwarded cert header rejected;
- [ ] rotation tested.

### 24.7 Multi-Tenant

- [ ] tenant A token rejected for tenant B;
- [ ] wrong issuer rejected;
- [ ] wrong tenant claim rejected;
- [ ] role mapping tenant-bound;
- [ ] admin impersonation audited.

### 24.8 Distributed

- [ ] downstream audience tested;
- [ ] token relay tested;
- [ ] token exchange tested;
- [ ] gateway header spoofing tested;
- [ ] async actor propagation tested.

### 24.9 Observability

- [ ] login success event tested;
- [ ] login failure event tested;
- [ ] token rejection event tested;
- [ ] logout event tested;
- [ ] tenant mismatch event tested;
- [ ] sensitive data absent from logs;
- [ ] metrics exist for auth failures.

---

## 25. Design Questions

Ask these before building authentication tests:

1. What is the authentication mode?
2. What credential or proof is presented?
3. Who issued the credential?
4. Who validates the credential?
5. What makes the credential valid?
6. What makes it invalid?
7. What is the expected failure status?
8. Is the response allowed to reveal the failure reason?
9. Is there a tenant boundary?
10. Is there an audience/resource boundary?
11. Is the credential stateful or stateless?
12. Can it be revoked?
13. What happens after logout?
14. What happens if IdP/JWKS/introspection is down?
15. What audit event must exist?
16. What must never be logged?
17. Is the test using real security chain or mocked identity?
18. What attack mutation is being tested?
19. What regression should block release?
20. How will this test behave during framework/JDK upgrade?

---

## 26. Example End-to-End Strategy for a Java Enterprise App

Assume a Java 21/Spring Boot 3 app:

```text
Browser app:
  OIDC login with authorization code + PKCE through BFF.
  Local session cookie.
  CSRF for unsafe browser methods.

API:
  JWT bearer token for service-to-service.
  Audience validation per service.

Admin:
  MFA/step-up required for sensitive actions.

Async:
  Kafka commands include delegated actor metadata.
```

Test plan:

### PR Tests

```text
- JwtAuthenticationConverter unit tests
- TenantResolver unit tests
- StepUpPolicy unit tests
- AuditEventBuilder unit tests
- MockMvc endpoint tests with mock JWT/session
- CSRF positive/negative tests
- API key parser tests if used
```

### Integration Tests

```text
- real signed JWT accepted
- wrong issuer rejected
- wrong audience rejected
- expired token rejected
- JWKS unknown kid rejected
- local session logout invalidates cookie
- session fixation prevention
- Redis session unavailable behavior
```

### IdP Contract Tests

```text
- OIDC discovery reachable
- JWKS contains current signing key
- ID token contains expected claims
- groups/roles mapping stable
- acr/amr available for MFA policy
```

### E2E Tests

```text
- browser login success
- browser logout
- access protected page after logout rejected
- MFA step-up for admin action
- expired session redirects to login
```

### Distributed Tests

```text
- service A token rejected by service B
- token exchange preserves actor
- Kafka command with missing actor rejected/dead-lettered
- scheduler job audited as system actor
```

### Failure Tests

```text
- IdP unavailable at login
- JWKS unavailable after cache expiry
- introspection timeout if opaque token path exists
- audit sink slow
- login burst throttled
```

---

## 27. Minimal Code Pattern: Authentication Test Utilities

Authentication tests become clean if you build internal test utilities.

Example JWT factory:

```java
final class TestJwtFactory {
    private final KeyPair currentKey;
    private final String issuer;

    TestJwtFactory(KeyPair currentKey, String issuer) {
        this.currentKey = currentKey;
        this.issuer = issuer;
    }

    String validUserToken(String subject, String audience, String tenantId) {
        Instant now = Instant.now();

        return JwtTestSigner.sign(
            Map.of("kid", "kid-current", "alg", "RS256"),
            Map.of(
                "iss", issuer,
                "sub", subject,
                "aud", audience,
                "tenant_id", tenantId,
                "iat", now.getEpochSecond(),
                "exp", now.plusSeconds(300).getEpochSecond(),
                "scope", "cases.read"
            ),
            currentKey.getPrivate()
        );
    }

    String expiredToken(String subject, String audience) {
        Instant now = Instant.now();

        return JwtTestSigner.sign(
            Map.of("kid", "kid-current", "alg", "RS256"),
            Map.of(
                "iss", issuer,
                "sub", subject,
                "aud", audience,
                "iat", now.minusSeconds(600).getEpochSecond(),
                "exp", now.minusSeconds(300).getEpochSecond()
            ),
            currentKey.getPrivate()
        );
    }
}
```

Use such utilities to avoid copy-paste test tokens.

But keep them honest:

```text
Do not make test factory bypass production validation.
Do not generate impossible tokens unless testing invalid cases.
Keep invalid token factory methods explicit.
```

---

## 28. Authentication Test Naming Convention

Bad:

```text
testLogin()
testJwt()
testSecurity()
```

Good:

```text
shouldRejectExpiredJwt()
shouldRejectJwtWithWrongAudience()
shouldRotateSessionIdAfterLogin()
shouldRejectPostWithoutCsrfWhenUsingCookieSession()
shouldRejectApiKeyFromDifferentTenant()
shouldEmitAuditEventWhenRefreshTokenReuseDetected()
shouldRejectSpoofedClientCertHeaderWhenRequestBypassesTrustedGateway()
```

Naming rule:

```text
should + expected outcome + condition
```

This makes security intent visible.

---

## 29. Summary

Authentication testing is not only about proving that valid users can log in.

It is about proving authentication invariants:

```text
valid proof accepted
invalid proof rejected
tampered proof rejected
expired proof rejected
wrong issuer rejected
wrong audience rejected
wrong tenant rejected
replay rejected
logout/revocation works as designed
context does not leak
dependencies fail safely
audit evidence exists
secrets are not exposed
```

A mature strategy uses layers:

```text
unit tests
integration tests
contract tests
end-to-end tests
negative/mutation tests
failure injection
observability assertions
security regression suite
```

The most important mindset:

```text
Do not test authentication by trusting a mock identity.

Test authentication by attacking the boundary where trust is established.
```

---

## 30. References

Primary references used for this part:

1. Spring Security Reference — Servlet Authentication Architecture  
   https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html

2. Spring Security Reference — Testing  
   https://docs.spring.io/spring-security/reference/servlet/test/index.html

3. Spring Security Reference — Reactive Testing with WebTestClient  
   https://docs.spring.io/spring-security/reference/reactive/test/web/setup.html

4. Spring Security API — `SecurityMockMvcRequestPostProcessors.jwt()`  
   https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/test/web/servlet/request/SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor.html

5. Spring Security Reference — OAuth2 Resource Server JWT  
   https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html

6. Spring Security Reference — OAuth2 Resource Server Opaque Token  
   https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html

7. OWASP Web Security Testing Guide — Authentication Testing  
   https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/README

8. OWASP Authentication Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

9. OWASP Session Management Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

10. OWASP JSON Web Token for Java Cheat Sheet  
    https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html

11. Testcontainers for Java  
    https://java.testcontainers.org/

12. Testcontainers Keycloak Module  
    https://testcontainers.com/modules/keycloak/

13. WireMock JWT Extension  
    https://wiremock.org/docs/jwt/

14. WireMock OAuth2 / OpenID Connect Mock  
    https://docs.wiremock.io/security/oauth2-mock

15. RFC 7519 — JSON Web Token  
    https://datatracker.ietf.org/doc/html/rfc7519

16. RFC 8725 — JSON Web Token Best Current Practices  
    https://datatracker.ietf.org/doc/html/rfc8725

17. RFC 7662 — OAuth 2.0 Token Introspection  
    https://datatracker.ietf.org/doc/html/rfc7662

18. RFC 7009 — OAuth 2.0 Token Revocation  
    https://datatracker.ietf.org/doc/html/rfc7009

19. RFC 9700 — OAuth 2.0 Security Best Current Practice  
    https://datatracker.ietf.org/doc/html/rfc9700

---

## 31. Status

Part 32 selesai.

Series belum selesai.

Part berikutnya:

```text
Part 33 — Migration Patterns: Legacy Java 8 to Modern Java 21/25 Authentication
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-031.md">⬅️ Part 31 — Performance and Scalability of Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-033.md">Part 33 — Migration Patterns: Legacy Java 8 to Modern Java 21/25 Authentication ➡️</a>
</div>
