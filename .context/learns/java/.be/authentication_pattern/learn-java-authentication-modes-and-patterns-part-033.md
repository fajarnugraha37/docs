# learn-java-authentication-modes-and-patterns-part-033

# Part 33 — Migration Patterns: Legacy Java 8 to Modern Java 21/25 Authentication

> Seri: **Java Authentication Modes and Patterns**  
> Level: **Advanced / Top 1% Engineering**  
> Target Java: **Java 8 sampai Java 25**  
> Fokus: **modernisasi authentication tanpa rewrite brutal, dengan risiko terkontrol, rollback jelas, dan audit defensibility**

---

## 0. Posisi Part Ini dalam Series

Sampai Part 32, kita sudah membahas mode authentication dari sisi konsep, protokol, runtime Java, framework, threat model, performance, dan testing. Part 33 adalah bagian transisi dari **tahu desain yang benar** menjadi **mampu memigrasikan sistem lama ke desain yang benar**.

Di dunia nyata, engineer jarang mulai dari greenfield. Yang sering terjadi adalah:

- aplikasi Java 8 lama masih memakai session custom;
- password tersimpan dengan hash lama;
- Basic Auth masih dipakai oleh partner;
- user table lokal sudah menjadi sumber kebenaran selama bertahun-tahun;
- role authorization bercampur dengan authentication;
- container-managed auth, JAAS, LDAP, dan Spring Security hidup bersamaan;
- monolith mulai dipecah menjadi microservices;
- aplikasi ingin pindah ke OIDC, tetapi tidak bisa memutus user lama;
- regulator/auditor tetap membutuhkan bukti siapa melakukan apa sebelum, selama, dan setelah migrasi.

Tujuan part ini bukan memberi satu resep universal. Tujuannya adalah membangun **migration engineering mental model**: bagaimana mengubah authentication system tanpa menghancurkan trust boundary, user journey, compliance evidence, dan operasional production.

---

## 1. Problem yang Diselesaikan

Authentication migration adalah salah satu perubahan paling berisiko dalam sistem enterprise karena menyentuh:

1. **akses user ke sistem**;
2. **akses service ke service lain**;
3. **session continuity**;
4. **credential lifecycle**;
5. **audit trail**;
6. **role/group mapping**;
7. **integrasi partner**;
8. **incident response**;
9. **operational rollback**;
10. **regulatory defensibility**.

Kesalahan migration authentication biasanya tidak terlihat sebagai bug sederhana. Ia bisa muncul sebagai:

- user tidak bisa login setelah cutover;
- user bisa login tetapi kehilangan role;
- token valid di service yang salah;
- session lama tetap aktif setelah user dinonaktifkan;
- partner API gagal karena header berubah;
- audit trail berubah format sehingga investigasi historis sulit;
- duplicate account terjadi karena identity linking salah;
- password reset bypass MFA;
- rollback gagal karena data sudah dimutasi ke format baru;
- IdP outage membuat seluruh aplikasi tidak bisa dipakai.

Authentication migration harus diperlakukan sebagai **state machine migration**, bukan hanya dependency upgrade.

---

## 2. Mental Model: Authentication Migration sebagai Perubahan Root of Trust

Setiap authentication system punya **root of trust**: komponen atau data yang dipercaya untuk membuktikan identity.

Contoh:

| Sistem Lama | Root of Trust |
|---|---|
| username/password lokal | database user + password hash |
| session custom | server-side session table/cache |
| Basic Auth | shared password atau API credential |
| LDAP bind | directory server |
| JAAS | configured LoginModule + backing store |
| container auth | application server realm |
| Spring Security local login | AuthenticationProvider + UserDetailsService |
| OIDC | external IdP issuer + signing keys |
| mTLS | CA trust chain + certificate mapping |
| API key | key registry + hashed key store |
| HMAC | shared secret registry + canonicalization rules |

Migration berarti mengubah salah satu dari:

1. siapa yang dipercaya;
2. bukti apa yang diterima;
3. bagaimana bukti diverifikasi;
4. bagaimana principal dibentuk;
5. bagaimana role/permission diturunkan;
6. bagaimana session/token dibuat;
7. bagaimana event audit dicatat;
8. bagaimana revocation dilakukan.

Prinsip penting:

> Jangan migrasi authentication dengan hanya mengganti mekanisme login. Migrasikan juga identity semantics, trust boundary, lifecycle, observability, dan fallback behavior.

---

## 3. Migration Dimensions

Sebelum menulis kode, pecah migrasi authentication ke beberapa dimensi.

### 3.1 Credential Migration

Pertanyaan:

- Credential lama bentuknya apa?
- Apakah credential bisa dimigrasikan langsung?
- Apakah perlu re-authentication?
- Apakah hash lama bisa diverifikasi?
- Apakah perlu forced password reset?
- Apakah pepper lama tersedia?
- Apakah credential bisa tetap dipakai paralel selama grace period?

Contoh:

- MD5/SHA-1 password hash → BCrypt/Argon2/PBKDF2.
- Basic Auth password → OAuth2 client credential.
- API key plaintext → API key hash + prefix.
- keystore JKS lama → PKCS12/PEM/KMS-backed key.

### 3.2 Identity Migration

Pertanyaan:

- Identifier lama apa? `username`, `email`, `NRIC`, employee ID, UUID, LDAP DN?
- Identifier baru apa? OIDC `sub`, SAML `NameID`, AD `objectGUID`, custom immutable ID?
- Apakah email boleh menjadi primary key identity? Biasanya tidak ideal karena bisa berubah.
- Apakah satu user lama bisa cocok dengan banyak identity baru?
- Apakah satu identity baru bisa cocok dengan banyak user lama?

### 3.3 Principal Migration

Principal adalah bentuk identity yang aplikasi gunakan setelah authentication berhasil.

Pertanyaan:

- Apakah `Principal.getName()` berubah?
- Apakah audit memakai username atau immutable user ID?
- Apakah UI menampilkan display name dari IdP atau database lokal?
- Apakah downstream service mengandalkan username lama?

### 3.4 Role and Claim Migration

Pertanyaan:

- Role lama disimpan di DB lokal, LDAP group, atau hardcoded config?
- Role baru datang dari token claim, IdP group, atau tetap dari aplikasi?
- Apakah role authoritative di IdP atau aplikasi?
- Bagaimana mapping role lama ke claim baru?
- Bagaimana mencegah privilege escalation karena mapping salah?

### 3.5 Session/Token Migration

Pertanyaan:

- Apakah session lama tetap valid setelah cutover?
- Apakah user harus login ulang?
- Apakah token lama masih diterima?
- Apakah refresh token perlu dicabut?
- Apakah session store harus dibersihkan?
- Apakah logout lama dan logout baru saling sinkron?

### 3.6 Protocol Migration

Pertanyaan:

- Form login → OIDC authorization code?
- Basic Auth → OAuth2 client credentials?
- custom token → JWT/Opaque token?
- LDAP direct auth → IdP-backed OIDC?
- SAML → OIDC?
- API key → HMAC/mTLS?

### 3.7 Runtime Migration

Pertanyaan:

- Java 8 → Java 17/21/25?
- `javax.*` → `jakarta.*`?
- Spring Security 4/5 → 6/7?
- App server realm → application-level security?
- Thread-per-request → virtual thread/Reactor?

### 3.8 Operational Migration

Pertanyaan:

- Bagaimana monitor login success rate?
- Bagaimana detect account linking anomaly?
- Bagaimana rollback?
- Bagaimana support desk membedakan user salah password vs migration mapping bug?
- Bagaimana audit sebelum dan sesudah cutover disambungkan?

---

## 4. Migration Invariants

Dalam migration authentication, invariant lebih penting daripada desain ideal.

### 4.1 No Silent Identity Change

User yang sama tidak boleh diam-diam berubah menjadi principal berbeda.

Buruk:

```text
before: username = fajar
new token: email = fajar@example.com
application principal = email
```

Jika audit lama memakai `fajar` dan audit baru memakai `fajar@example.com`, investigasi historis menjadi sulit. Lebih buruk lagi, jika email bisa berubah atau didaur ulang, identity continuity rusak.

Lebih baik:

```text
application_user_id = immutable local ID
legacy_username = fajar
external_subject = issuer + sub
email = display/contact attribute only
```

### 4.2 No Privilege Gain by Default

Saat mapping role tidak jelas, default harus lebih aman.

```text
unknown group -> no elevated role
missing claim -> deny or minimal access
ambiguous account link -> require manual review
```

### 4.3 No Credential Downgrade

Migration tidak boleh membuat credential baru lebih lemah daripada lama.

Contoh buruk:

- migrate password hash kuat ke plaintext temporary table;
- menerima unsigned JWT selama transition;
- menerima Basic Auth tanpa TLS;
- fallback dari OIDC ke password lokal tanpa MFA untuk privileged user.

### 4.4 No Audit Gap

Setiap fase migrasi harus punya event audit.

Minimal event:

- legacy login success/failure;
- new login success/failure;
- account link created;
- account link failed;
- role mapping applied;
- credential migrated;
- fallback used;
- token/session revoked;
- forced re-authentication;
- manual override.

### 4.5 Rollback Must Preserve Security

Rollback bukan berarti menerima semua credential lama tanpa kontrol.

Rollback harus menjawab:

- apakah session baru akan dicabut?
- apakah login lama bisa dipakai lagi?
- apakah account linking yang sudah terjadi harus dipertahankan?
- apakah role mapping baru harus tetap aktif?
- apakah audit event tetap konsisten?

---

## 5. Pattern 1 — Password Hash Migration Without Forced Reset

### 5.1 Problem

Aplikasi lama Java 8 menyimpan password dengan hash lama, misalnya:

```text
user.password_hash = SHA-256(salt + password)
```

Target baru ingin memakai BCrypt/PBKDF2/Argon2 dengan work factor modern.

Tidak semua user bisa dipaksa reset password sekaligus karena:

- user base besar;
- support desk overload;
- downtime bisnis;
- user lama jarang login;
- partner/operator kritikal.

### 5.2 Pattern: Verify Old, Rehash on Successful Login

Flow:

```text
1. User submit username/password.
2. System load password record.
3. System detect hash scheme.
4. If old scheme:
   a. verify with old verifier.
   b. if valid, rehash with new scheme.
   c. update record atomically.
5. If new scheme:
   a. verify with new verifier.
6. Continue authentication.
```

### 5.3 Data Model

```sql
CREATE TABLE app_user_credential (
    user_id              VARCHAR(64) PRIMARY KEY,
    password_hash        VARCHAR(512) NOT NULL,
    password_scheme      VARCHAR(64)  NOT NULL,
    password_version     INTEGER      NOT NULL,
    migrated_at          TIMESTAMP NULL,
    last_verified_at     TIMESTAMP NULL,
    must_reset_password  BOOLEAN NOT NULL DEFAULT FALSE
);
```

Atau gunakan hash prefix:

```text
{bcrypt}$2a$12$...
{pbkdf2}...
{legacy-sha256}...
```

Spring Security `DelegatingPasswordEncoder` memakai konsep `{id}` prefix untuk memilih encoder yang sesuai. Ini sangat cocok untuk migration karena sistem bisa memverifikasi beberapa format sekaligus sambil menghasilkan format baru untuk password baru.

### 5.4 Java Sketch

```java
public final class MigratingPasswordVerifier {

    private final PasswordVerifier legacyVerifier;
    private final PasswordVerifier modernVerifier;
    private final PasswordHasher modernHasher;
    private final CredentialRepository credentials;

    public AuthenticationResult verify(String username, char[] password) {
        CredentialRecord record = credentials.findByUsername(username)
                .orElseThrow(() -> AuthenticationResult.invalid());

        boolean valid;

        if (record.scheme().isLegacy()) {
            valid = legacyVerifier.verify(password, record.passwordHash(), record.salt());

            if (valid) {
                String newHash = modernHasher.hash(password);
                credentials.upgradeHashIfUnchanged(
                        record.userId(),
                        record.passwordHash(),
                        newHash,
                        PasswordScheme.BCRYPT_V2
                );
            }
        } else {
            valid = modernVerifier.verify(password, record.passwordHash(), record.salt());
        }

        if (!valid) {
            return AuthenticationResult.invalid();
        }

        return AuthenticationResult.authenticated(record.userId());
    }
}
```

### 5.5 Critical Detail: Atomic Upgrade

Password upgrade harus atomic agar tidak menimpa perubahan concurrent seperti password reset.

```sql
UPDATE app_user_credential
SET password_hash = ?,
    password_scheme = ?,
    password_version = password_version + 1,
    migrated_at = CURRENT_TIMESTAMP
WHERE user_id = ?
  AND password_hash = ?;
```

Jika row count `0`, artinya credential sudah berubah. Jangan retry membabi buta.

### 5.6 Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| password lama tidak bisa diverifikasi | salt/pepper hilang | forced reset |
| hash upgrade menimpa reset | update tidak conditional | compare-and-set update |
| login timing leak | verifier berbeda durasi ekstrem | normalize response dan rate limit |
| support spike | forced reset massal | lazy migration + campaign |
| downgrade attack | attacker memaksa scheme legacy | scheme dari DB, bukan request |

---

## 6. Pattern 2 — Forced Password Reset Migration

### 6.1 Kapan Dipakai

Forced reset cocok jika:

- hash lama terlalu lemah;
- pepper hilang;
- credential compromise terjadi;
- password lama tidak bisa diverifikasi dengan aman;
- policy baru mensyaratkan MFA/passkey enrollment;
- user population kecil atau high-risk.

### 6.2 Flow Aman

```text
1. Mark account as must_reset_password.
2. User login attempt with old credential.
3. If old credential valid, do not create full session.
4. Create limited reset session.
5. Require password reset + optional MFA enrollment.
6. Invalidate all old sessions/tokens.
7. Create new full session.
8. Audit reset migration.
```

### 6.3 Jangan Kirim Password Baru

Hindari pola lama:

```text
System emails temporary password.
```

Lebih baik:

```text
System sends one-time reset link/token with short expiry,
rate limit,
replay protection,
and full audit.
```

### 6.4 Reset Token Model

```sql
CREATE TABLE password_reset_token (
    token_id        VARCHAR(64) PRIMARY KEY,
    user_id         VARCHAR(64) NOT NULL,
    token_hash      VARCHAR(256) NOT NULL,
    purpose         VARCHAR(64) NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    consumed_at     TIMESTAMP NULL,
    created_ip_hash VARCHAR(128) NULL,
    created_at      TIMESTAMP NOT NULL
);
```

Store hash of token, not token plaintext.

---

## 7. Pattern 3 — Local User Table to External OIDC IdP

### 7.1 Problem

Aplikasi lama punya user table lokal:

```text
app_user(id, username, email, password_hash, status)
app_user_role(user_id, role)
```

Target baru:

- login lewat OIDC provider;
- aplikasi tidak lagi menyimpan password;
- user tetap memiliki data historis, cases, audit, assignments;
- role mungkin tetap di aplikasi atau dipindah ke IdP.

### 7.2 Prinsip Utama

Jangan langsung mengganti primary identity aplikasi menjadi `email` atau OIDC `sub` tanpa model linking.

Gunakan model:

```text
local user id = stable application identity
external identity = login method binding
```

### 7.3 Data Model

```sql
CREATE TABLE app_user (
    user_id          VARCHAR(64) PRIMARY KEY,
    legacy_username  VARCHAR(128) UNIQUE,
    display_name     VARCHAR(256),
    email            VARCHAR(256),
    status           VARCHAR(32) NOT NULL,
    created_at       TIMESTAMP NOT NULL
);

CREATE TABLE external_identity_link (
    link_id          VARCHAR(64) PRIMARY KEY,
    user_id          VARCHAR(64) NOT NULL,
    provider         VARCHAR(64) NOT NULL,
    issuer           VARCHAR(512) NOT NULL,
    subject          VARCHAR(256) NOT NULL,
    email_at_link    VARCHAR(256),
    linked_at        TIMESTAMP NOT NULL,
    link_status      VARCHAR(32) NOT NULL,
    UNIQUE (issuer, subject),
    UNIQUE (provider, issuer, subject)
);
```

### 7.4 Login Flow During Migration

```text
1. User clicks Login with IdP.
2. App receives OIDC authentication result.
3. Validate issuer, audience, nonce, signature, expiry.
4. Extract issuer + subject.
5. Lookup external_identity_link by issuer + subject.
6. If found:
   a. load app_user.
   b. create application session.
7. If not found:
   a. run linking policy.
   b. maybe match by verified email / employee id / manual claim.
   c. if confident, create link.
   d. if ambiguous, require manual support workflow.
```

### 7.5 Linking Confidence

| Signal | Confidence | Notes |
|---|---:|---|
| immutable employee ID from trusted IdP | high | best mapping key |
| government agency ID from trusted source | high | verify issuer and claim semantics |
| verified email | medium | email can change/recycle |
| username string match | medium/low | collision risk |
| display name | low | not sufficient |
| user self-claims account | low | require existing auth or support verification |

### 7.6 First Login Flow

First login harus eksplisit.

```text
OIDC login success
    -> no existing link
        -> matching candidate found
            -> require confirmation / existing credential / admin approval
        -> no candidate
            -> create new user or deny based on business policy
```

### 7.7 Failure Modes

| Failure | Dampak | Mitigasi |
|---|---|---|
| email used as identity | account takeover after email reuse | use issuer+sub |
| wrong account link | user sees another user's data | linking evidence + manual review |
| duplicate account | data fragmented | pre-migration matching report |
| role claim trusted blindly | privilege escalation | allowlist role mapping |
| old local login still open | bypass IdP/MFA | phase-out policy |

---

## 8. Pattern 4 — Local Roles to Claims/Groups

### 8.1 Problem

Role lama:

```text
ROLE_ADMIN
ROLE_CASE_OFFICER
ROLE_APPROVER
ROLE_VIEWER
```

IdP baru mengirim:

```json
{
  "groups": ["/agency/aceas/approver"],
  "realm_access": {
    "roles": ["aceas-approver"]
  }
}
```

### 8.2 Jangan Campur Authentication dan Authorization Migration

Login berhasil tidak berarti role migration benar.

Pisahkan:

```text
authentication identity -> app principal
authorization mapping -> permissions/roles
```

### 8.3 Mapping Table

```sql
CREATE TABLE external_role_mapping (
    mapping_id       VARCHAR(64) PRIMARY KEY,
    provider         VARCHAR(64) NOT NULL,
    issuer           VARCHAR(512) NOT NULL,
    claim_name       VARCHAR(128) NOT NULL,
    claim_value      VARCHAR(512) NOT NULL,
    app_role         VARCHAR(128) NOT NULL,
    active           BOOLEAN NOT NULL,
    created_at       TIMESTAMP NOT NULL
);
```

### 8.4 Safer Role Resolution

```text
1. Validate token.
2. Extract trusted claims from expected issuer.
3. Normalize claim values.
4. Match against allowlisted mapping table.
5. Derive app roles.
6. Apply deny-by-default for unknown values.
7. Audit mapping result.
```

### 8.5 Dual-Read Migration

During migration:

```text
effective_roles = legacy_roles + mapped_external_roles
```

But do not allow uncontrolled privilege expansion.

Safer strategies:

1. **shadow compare only**: compute new roles but do not enforce;
2. **read-only diff report**: compare old vs new role result;
3. **limited cohort**: enable new roles for pilot users;
4. **deny elevation**: new mapping cannot grant admin until approved;
5. **cutover**: external mapping becomes authoritative.

### 8.6 Role Diff Report

```text
user_id: U123
legacy roles: [CASE_OFFICER, APPROVER]
external mapped roles: [CASE_OFFICER]
diff: missing APPROVER
risk: user may lose approval capability
resolution: fix group in IdP or mapping table
```

---

## 9. Pattern 5 — Form Login Session to OIDC + BFF Session

### 9.1 Problem

Legacy app:

```text
browser -> Java web app -> local form login -> server session
```

Modern target:

```text
browser -> Java BFF/web app -> OIDC authorization code + PKCE -> app session
```

### 9.2 Keep Browser Session Local

For enterprise Java web systems, a strong migration pattern is:

```text
OIDC authenticates user externally.
Application still maintains its own server-side session.
Browser does not directly handle access token.
```

This is the BFF-friendly approach.

### 9.3 Migration Flow

```text
1. Existing session-based app keeps working.
2. Add OIDC login endpoint.
3. On OIDC success:
   a. link external identity to app_user.
   b. create normal app session.
   c. store minimal auth metadata in session.
4. Maintain old form login for selected cohort.
5. Force new login for pilot users.
6. Disable old login for privileged users first.
7. Disable old login globally.
```

### 9.4 Session Data Before/After

Before:

```text
session.userId = U123
session.username = fajar
session.roles = [APPROVER]
```

After:

```text
session.userId = U123
session.authProvider = oidc-keycloak
session.issuer = https://idp.example/realms/aceas
session.subject = 8bd7...
session.authTime = 2026-06-19T10:00:00Z
session.acr = urn:...
session.roles = resolved application roles
```

### 9.5 Logout Migration

Logout must consider:

1. local application session invalidation;
2. IdP session logout;
3. front-channel/back-channel logout if supported;
4. stale tabs;
5. refresh token revocation;
6. downstream token invalidation.

Do not assume local logout equals IdP logout.

---

## 10. Pattern 6 — Basic Auth to OAuth2 Client Credentials

### 10.1 Problem

Partner/system integration currently uses:

```http
Authorization: Basic base64(clientId:password)
```

Target:

```text
client obtains access token using client_credentials
client calls API with Bearer token
```

### 10.2 Why Migrate

Basic Auth issues:

- credential sent on every request;
- no scoped token;
- hard rotation;
- difficult revocation by scope;
- no token expiry;
- often reused across environments.

OAuth2 client credentials improves:

- short-lived access tokens;
- scopes/audience;
- centralized revocation/control;
- better monitoring;
- clearer client identity.

### 10.3 Compatibility Window

Do not break partners instantly. Use controlled dual-mode.

```text
Phase 1: Basic Auth active, OAuth2 available.
Phase 2: Partner onboard to OAuth2.
Phase 3: Basic Auth deprecated, warning logs/events.
Phase 4: Basic Auth disabled for migrated clients.
Phase 5: Basic Auth removed globally.
```

### 10.4 Endpoint-Level Strategy

```text
/auth/token                 -> OAuth2 client credentials only
/api/v1/legacy/*            -> Basic Auth + OAuth2 accepted during transition
/api/v2/*                   -> OAuth2 only
```

### 10.5 Audit Events

Log:

- client authenticated with Basic;
- client authenticated with OAuth2;
- Basic Auth deprecated usage;
- invalid client secret;
- token issued;
- token rejected by audience/scope;
- client migration completed.

---

## 11. Pattern 7 — API Key Plaintext to Hashed API Key Store

### 11.1 Problem

Legacy API key table:

```sql
api_key(client_id, key_value, active)
```

This is dangerous because DB leak equals credential leak.

### 11.2 Target Model

```sql
CREATE TABLE api_client_key (
    key_id          VARCHAR(64) PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL,
    key_prefix      VARCHAR(16) NOT NULL,
    key_hash        VARCHAR(256) NOT NULL,
    hash_scheme     VARCHAR(64) NOT NULL,
    scopes          VARCHAR(1024),
    active          BOOLEAN NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    expires_at      TIMESTAMP NULL,
    last_used_at    TIMESTAMP NULL
);
```

Client receives key once:

```text
ak_live_3p4f9x...secret-random-material...
```

Server stores:

```text
prefix = ak_live_3p4f9x
hash = HMAC/slow hash depending use case
```

### 11.3 Migration Strategy

If plaintext still exists:

```text
1. Generate hash for existing key.
2. Store prefix + hash.
3. Stop reading plaintext column.
4. Null/drop plaintext column after verification period.
```

If plaintext no longer recoverable but clients hold it:

```text
1. Add key rotation endpoint/process.
2. Ask clients to generate/receive new key.
3. Store only hash for new key.
4. Deprecate old key.
```

---

## 12. Pattern 8 — JAAS / Container Realm to Spring Security or Jakarta Security

### 12.1 Problem

Legacy enterprise Java app may use:

- JAAS LoginModule;
- Tomcat Realm;
- WebLogic security realm;
- container-managed FORM auth;
- custom Servlet Filter;
- application-managed roles.

Target may be:

- Spring Security;
- Jakarta Security;
- OIDC with application session;
- resource server JWT validation.

### 12.2 Understand the Old Boundary

Before migration, identify:

```text
Where does authentication happen?
Where is Principal created?
Where are roles loaded?
Where is session created?
Where is logout handled?
Where is audit written?
```

### 12.3 Bridge Pattern

During migration, use adapter/bridge rather than big bang.

```text
container principal -> application principal -> Spring Authentication
```

Example conceptual adapter:

```java
public final class ContainerPrincipalAuthenticationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {

        Principal principal = request.getUserPrincipal();

        if (principal != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            Authentication authentication = convert(principal, request);
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }

        chain.doFilter(request, response);
    }
}
```

Use this only as transition. Long-term, avoid multiple competing sources of truth.

### 12.4 Migration Choices

| Old | Target | Strategy |
|---|---|---|
| JAAS LoginModule | Spring AuthenticationProvider | wrap old verifier first, then replace |
| Tomcat Realm | Spring Security LDAP/OIDC | bridge Principal, then move auth boundary |
| Container FORM | OIDC login | introduce OIDC endpoint, migrate sessions |
| WebLogic Realm | Jakarta Security | implement IdentityStore/HttpAuthenticationMechanism |
| Custom Filter | Spring Security filter chain | port logic to AuthenticationProvider/filter |

### 12.5 Key Risk

The most dangerous state is when two systems both think they are authoritative:

```text
Container says user=A role=admin
Spring says user=A role=user
App manually says user=A role=approver
```

During transition, define precedence explicitly.

---

## 13. Pattern 9 — Monolith Session to Microservice Token Architecture

### 13.1 Problem

Legacy monolith:

```text
Browser -> monolith session -> database
```

Modern architecture:

```text
Browser -> BFF/API Gateway -> services -> database/events
```

### 13.2 Bad Migration Pattern

```text
Copy browser session ID to downstream services.
```

This spreads session trust everywhere and makes revocation/audit messy.

### 13.3 Better Pattern

```text
Browser uses BFF session.
BFF authenticates user.
BFF calls downstream services with service token or exchanged token.
Downstream validates audience-specific token.
```

### 13.4 Token Relay vs Token Exchange

| Pattern | Meaning | Risk |
|---|---|---|
| Token relay | pass original user token downstream | broad audience misuse |
| Token exchange | exchange user/session context for service-specific token | more complexity, better boundary |
| Service token only | downstream sees service actor | user audit may be lost |
| Composite actor | downstream sees user actor + service actor | best for audit, needs design |

### 13.5 Audit Actor Model

For distributed systems, audit should distinguish:

```text
initiating_user = U123
calling_service = case-api
executing_service = workflow-engine
operation = approve_case
```

Do not collapse all of that into one string called `username`.

---

## 14. Pattern 10 — SAML to OIDC Migration

### 14.1 Problem

Enterprise app currently integrates with SAML IdP. Target wants OIDC.

### 14.2 Why It Is Hard

SAML and OIDC differ in:

- assertion format;
- metadata/discovery;
- signing keys;
- subject semantics;
- attribute names;
- session/logout model;
- binding/redirect behavior;
- clock skew handling.

### 14.3 Migration Strategy

```text
1. Inventory SAML attributes and NameID usage.
2. Define OIDC claim contract.
3. Map SAML NameID to stable OIDC subject or external identity link.
4. Run parallel login for pilot users.
5. Compare resolved principal and roles.
6. Validate logout/session behavior.
7. Cut over by tenant/app/client.
8. Keep SAML fallback only for defined grace period.
```

### 14.4 Attribute Mapping Example

| SAML Attribute | OIDC Claim | App Meaning |
|---|---|---|
| NameID | sub | external subject if stable |
| mail | email | contact/display, not primary key |
| employeeNumber | employee_id | strong matching candidate |
| groups | groups | role mapping source |
| authnContextClassRef | acr | assurance level |

---

## 15. Pattern 11 — LDAP Direct Authentication to IdP-Brokered Authentication

### 15.1 Problem

Legacy app authenticates directly to LDAP/AD:

```text
app -> LDAP bind -> groups -> app session
```

Target:

```text
app -> OIDC IdP -> IdP integrates with LDAP/AD -> app session
```

### 15.2 Why Migrate

Benefits:

- central MFA;
- central password policy;
- central account disablement;
- less LDAP coupling in app;
- federation support;
- better login observability at IdP.

### 15.3 Key Migration Risk

LDAP group semantics may not match OIDC claims.

Legacy:

```text
memberOf=CN=ACEAS_APPROVER,OU=Groups,...
```

OIDC:

```json
"groups": ["aceas-approver"]
```

Need explicit mapping and diff reports.

### 15.4 Directory Outage Behavior

When IdP brokers LDAP, outage behavior changes:

- existing IdP sessions may still work;
- new logins may fail;
- refresh may or may not require LDAP;
- group updates may be delayed;
- disabled account propagation may have latency.

Document this for operations.

---

## 16. Migration State Machine

A robust migration can be modeled as state machine.

### 16.1 User Migration State

```text
LEGACY_ONLY
  -> LINK_CANDIDATE
  -> LINKED_SHADOW
  -> LINKED_ACTIVE
  -> LEGACY_DISABLED
  -> MODERN_ONLY
```

Meaning:

| State | Meaning |
|---|---|
| LEGACY_ONLY | user only has old authentication path |
| LINK_CANDIDATE | system found possible external identity |
| LINKED_SHADOW | external identity linked but not primary login |
| LINKED_ACTIVE | external login allowed |
| LEGACY_DISABLED | old login disabled for user |
| MODERN_ONLY | only new authentication remains |

### 16.2 Client Migration State

```text
BASIC_ONLY
  -> OAUTH_REGISTERED
  -> DUAL_AUTH
  -> OAUTH_PRIMARY
  -> BASIC_DISABLED
  -> OAUTH_ONLY
```

### 16.3 Credential Migration State

```text
LEGACY_HASH
  -> VERIFIED_LEGACY
  -> REHASHED_MODERN
  -> LEGACY_REVOKED
```

### 16.4 Why State Machine Matters

Without explicit state, systems rely on implicit checks:

```text
if user has oidc_sub then use oidc else use password
```

This becomes brittle when rollback, support override, partial migration, and audit are needed.

---

## 17. Shadow Mode Migration

Shadow mode means compute new authentication/authorization result without enforcing it yet.

### 17.1 Role Shadowing

```text
actual roles = legacy roles
audit shadow_roles = roles derived from OIDC claims
```

Then compare:

```text
legacy: [CASE_OFFICER, APPROVER]
shadow: [CASE_OFFICER]
diff: missing APPROVER
```

### 17.2 Token Validation Shadowing

During transition from custom token to JWT:

```text
1. Continue accepting custom token.
2. If JWT also present or can be generated internally, validate it in shadow.
3. Log whether JWT validation would pass.
4. Fix issuer/audience/key/claim issues before enforcement.
```

### 17.3 Account Linking Shadowing

Before enabling OIDC login:

```text
For each local user:
  run matching algorithm against IdP export/claims
  produce confidence score
  flag ambiguous matches
```

Do not create links blindly.

---

## 18. Dual-Run and Dual-Write Patterns

### 18.1 Dual-Run

Dual-run means old and new logic run in parallel, but only one is authoritative.

Example:

```text
legacy login authenticates user
new OIDC mapping runs in background for comparison
```

### 18.2 Dual-Write

Dual-write means changes are written to old and new stores.

Example:

```text
role assignment updated in app DB and IdP group
```

Dual-write is risky because partial failure creates divergence.

### 18.3 Safer Alternative: Source of Truth + Projection

Better:

```text
source of truth: app DB role assignment
projection: IdP group sync
```

or:

```text
source of truth: IdP group
projection: app local cache
```

Pick one.

### 18.4 Reconciliation Job

If projection is unavoidable, add reconciliation:

```text
1. Read source of truth.
2. Read projection.
3. Compute diff.
4. Repair or alert.
5. Audit repair.
```

---

## 19. Cutover Strategies

### 19.1 Big Bang

All users switch at once.

Use only if:

- user base small;
- fallback clear;
- support ready;
- migration tested thoroughly;
- low business criticality window.

### 19.2 Cohort-Based Cutover

Switch by group:

```text
internal admins -> pilot team -> low-risk users -> high-volume users -> external partners
```

Benefits:

- controlled support load;
- early signal;
- easier rollback.

### 19.3 Tenant-Based Cutover

For multi-tenant systems:

```text
tenant A -> tenant B -> tenant C
```

Useful when tenants have different IdPs.

### 19.4 Endpoint-Based Cutover

For APIs:

```text
v1 accepts old and new auth
v2 requires new auth
```

### 19.5 Risk-Based Cutover

Privileged users may need stricter migration first:

```text
admin users -> MFA/OIDC mandatory before normal users
```

This reduces high-impact compromise risk.

---

## 20. Rollback Design

Rollback must be designed before cutover.

### 20.1 Rollback Questions

1. What triggers rollback?
2. Who approves rollback?
3. What data changed during cutover?
4. Can new sessions remain valid?
5. Are account links reversible?
6. Are role mappings reversible?
7. Can old login be re-enabled safely?
8. How do we notify users/partners?
9. How do we preserve audit?
10. How do we prevent rollback from reintroducing known vulnerabilities?

### 20.2 Rollback Types

| Type | Meaning |
|---|---|
| config rollback | disable new auth path |
| traffic rollback | route users back to old deployment |
| data rollback | revert link/mapping data |
| policy rollback | re-enable old login rules |
| partial rollback | only selected tenant/cohort/client |

### 20.3 Avoid Irreversible Cutover Early

Dangerous early actions:

- dropping password hash before OIDC stable;
- deleting old role table;
- changing audit principal format without mapping table;
- rotating all partner secrets at once;
- invalidating all sessions without fallback;
- removing old login endpoint before support readiness.

---

## 21. Observability During Migration

### 21.1 Key Metrics

Track at least:

```text
login_success_rate_by_auth_method
login_failure_rate_by_reason
account_link_success_count
account_link_ambiguous_count
role_mapping_diff_count
legacy_auth_usage_count
oauth_token_issuance_failure_count
jwt_validation_failure_by_reason
session_creation_count
logout_failure_count
support_ticket_count
```

### 21.2 Failure Reason Taxonomy

Do not log only `login failed`.

Use normalized reasons:

```text
INVALID_CREDENTIAL
ACCOUNT_DISABLED
ACCOUNT_LOCKED
MISSING_EXTERNAL_LINK
AMBIGUOUS_EXTERNAL_LINK
TOKEN_EXPIRED
TOKEN_INVALID_SIGNATURE
TOKEN_WRONG_ISSUER
TOKEN_WRONG_AUDIENCE
ROLE_MAPPING_EMPTY
MFA_REQUIRED
MFA_FAILED
IDP_UNAVAILABLE
```

### 21.3 Correlation

Migration observability must correlate:

- request ID;
- session ID hash;
- user ID;
- external issuer;
- external subject hash;
- client ID;
- tenant ID;
- auth method;
- migration state;
- deployment version.

Never log raw token, password, API key, or full sensitive identifier.

---

## 22. Testing Migration

### 22.1 Test Categories

| Test | Goal |
|---|---|
| identity mapping test | legacy user maps to correct external subject |
| role diff test | legacy role equals new mapped role |
| login journey test | browser/API clients can authenticate |
| token validation test | issuer/audience/signature/expiry enforced |
| session continuity test | old/new sessions behave correctly |
| rollback test | old path can be restored safely |
| performance test | IdP/JWKS/session store can handle load |
| chaos test | IdP/LDAP/introspection outage behavior |
| audit test | events reconstruct user journey |
| support test | failure reason understandable |

### 22.2 Golden User Set

Create test users representing:

- normal active user;
- admin user;
- disabled user;
- locked user;
- user with changed email;
- user with duplicate email;
- user with multiple roles;
- user with no role;
- user with ambiguous external match;
- external-only user;
- legacy-only user;
- service account;
- partner client.

### 22.3 Golden Token Set

Create test tokens:

- valid token;
- expired token;
- wrong issuer;
- wrong audience;
- unknown `kid`;
- invalid signature;
- missing subject;
- missing required claim;
- future `nbf`;
- unacceptable `acr`;
- unsigned/`none` token if parser might accept it.

---

## 23. Java 8 to Java 21/25 Considerations

### 23.1 Package Migration: `javax` to `jakarta`

Many older Java EE applications use `javax.servlet`, `javax.ws.rs`, `javax.validation`, etc. Jakarta EE uses `jakarta.*` packages.

Authentication migration may coincide with:

```text
javax.servlet.Filter -> jakarta.servlet.Filter
javax.security.enterprise -> jakarta.security.enterprise
```

Do not combine too many unknowns unless necessary.

Bad:

```text
Java 8 -> Java 21
Spring Security 4 -> 6
javax -> jakarta
local login -> OIDC
Tomcat -> new runtime
DB migration
all in one release
```

Better:

```text
1. Add observability.
2. Upgrade tests.
3. Upgrade framework/runtime.
4. Introduce new auth in shadow mode.
5. Pilot users.
6. Cut over.
```

### 23.2 Spring Security Changes

Modern Spring Security favors explicit `SecurityFilterChain` beans rather than older adapter patterns. Spring Security 6/7 migration can affect configuration style, OAuth2 support, JWT validation, and defaults.

Migration should include:

- inventory of filters;
- inventory of authentication providers;
- session management behavior;
- CSRF behavior;
- password encoder behavior;
- OAuth2 client/resource server config;
- method security behavior.

### 23.3 Java 25 Key Material Improvements

Java 25 includes modern cryptographic API evolution such as Key Derivation Function API and preview PEM Encodings. For authentication migration, this matters when modernizing:

- HMAC secret derivation;
- password-based key derivation;
- PEM key loading;
- JWT signing key operations;
- mTLS certificate/key management.

Do not use new APIs just because they are new. Use them when they simplify key lifecycle and reduce unsafe custom parsing.

### 23.4 Virtual Threads and Context Propagation

If migration also moves runtime to Java 21/25 and virtual threads, check:

- `ThreadLocal` security context assumptions;
- async executor propagation;
- audit context propagation;
- MDC/logging context;
- Reactor context if reactive paths exist.

Authentication migration can fail subtly if identity context disappears in async work.

---

## 24. Migration Architecture Blueprint

A robust migration architecture can be structured as:

```text
[Browser/API Client]
       |
       v
[Authentication Entry Layer]
       |-- legacy form/basic/api-key path
       |-- modern OIDC/OAuth2/mTLS path
       v
[Credential/Token Verifier]
       v
[Identity Resolution Layer]
       |-- local user lookup
       |-- external identity link
       |-- account status check
       v
[Authorization Mapping Layer]
       |-- legacy roles
       |-- external claims/groups
       |-- diff/shadow mode
       v
[Session/Token Issuance Layer]
       v
[Application Principal]
       v
[Audit + Observability]
```

Key idea:

> Put migration complexity in explicit boundary layers. Do not scatter `if legacy else oidc` across controllers and services.

---

## 25. Migration Decision Matrix

| From | To | Preferred Pattern | Main Risk |
|---|---|---|---|
| weak password hash | modern hash | verify old then rehash | lost pepper/salt |
| local login | OIDC | external identity link | wrong account linking |
| local roles | IdP claims | shadow role diff | privilege mismatch |
| Basic Auth | client credentials | dual mode with deadline | partner breakage |
| API key plaintext | hashed key store | prefix + hash migration | DB leak before cleanup |
| JAAS/container realm | Spring/Jakarta Security | bridge then replace | double authority |
| monolith session | BFF + service tokens | token exchange | audit actor loss |
| SAML | OIDC | claim contract + pilot | subject mismatch |
| LDAP direct | IdP broker | group diff + outage test | stale group/disablement |
| custom token | JWT/opaque token | shadow validation | invalid audience/revocation |

---

## 26. Common Anti-Patterns

### 26.1 “Email Is the User ID”

Email is an attribute, not a durable identity.

### 26.2 “JWT Means We Removed Sessions”

JWT often moves state problem into revocation, expiry, refresh, and client storage.

### 26.3 “OAuth Login” Without OIDC

OAuth2 alone is not authentication. Use OIDC if you need login identity.

### 26.4 “Temporary Fallback” That Never Dies

Every fallback must have owner, deadline, telemetry, and kill switch.

### 26.5 “Accept Both Tokens Forever”

Dual acceptance increases attack surface. Use it only as transition.

### 26.6 “Trust All Claims from IdP”

Claims need issuer validation, audience validation, mapping policy, and allowlist.

### 26.7 “Role Migration Without Diff”

Privilege bugs often appear only after cutover. Shadow diff first.

### 26.8 “No Support Playbook”

Authentication migration creates user-facing failures. Support needs reason taxonomy.

### 26.9 “No Rollback Test”

Rollback that was never tested is wishful thinking.

### 26.10 “Audit Format Changed Without Bridge”

Changing principal format can break historical traceability.

---

## 27. Production Checklist

### 27.1 Before Migration

- [ ] Inventory all authentication mechanisms.
- [ ] Inventory all credential stores.
- [ ] Inventory all session/token stores.
- [ ] Inventory all role/group sources.
- [ ] Inventory all service accounts and partner clients.
- [ ] Define source of truth per identity attribute.
- [ ] Define immutable application user ID.
- [ ] Define external identity link model.
- [ ] Define role/claim mapping.
- [ ] Define migration states.
- [ ] Define rollback plan.
- [ ] Define observability dashboard.
- [ ] Define support playbook.
- [ ] Define cutover cohorts.
- [ ] Define fallback expiration date.

### 27.2 During Migration

- [ ] Enable shadow mode.
- [ ] Compare role mapping diffs.
- [ ] Monitor login success/failure by method.
- [ ] Monitor account linking anomalies.
- [ ] Monitor deprecated auth usage.
- [ ] Audit all migration state transitions.
- [ ] Keep rollback ready.
- [ ] Communicate partner/user deadlines.
- [ ] Do not remove old data prematurely.

### 27.3 After Migration

- [ ] Disable legacy authentication.
- [ ] Revoke unused credentials.
- [ ] Remove fallback code.
- [ ] Drop plaintext/legacy secret columns after retention approval.
- [ ] Validate audit continuity.
- [ ] Validate no privileged role drift.
- [ ] Review support tickets.
- [ ] Run post-migration security review.
- [ ] Update runbooks and architecture docs.

---

## 28. Deep Design Questions

Use these in architecture review.

1. What is the old root of trust?
2. What is the new root of trust?
3. What identity value remains stable across migration?
4. What is the authoritative source for role assignment?
5. What credential formats are accepted during transition?
6. How are old sessions handled?
7. How are new sessions handled if rollback happens?
8. How do we detect wrong account linking?
9. How do we detect role drift?
10. How do we revoke compromised legacy credentials?
11. What happens if IdP is unavailable?
12. What happens if LDAP behind IdP is unavailable?
13. What happens if JWKS rotation happens during cutover?
14. What happens if partner keeps using Basic Auth after deadline?
15. What is the first safe cohort?
16. What is the riskiest user group?
17. What audit evidence proves migration correctness?
18. What code can be deleted after migration?
19. What data can be deleted only after retention approval?
20. What rollback has been tested end-to-end?

---

## 29. Example End-to-End Migration Plan

Scenario:

```text
Legacy Java 8 Spring MVC app
Custom form login
Local password table
Local role table
Some Basic Auth partner APIs
Target Java 21/25 Spring Boot app
OIDC login for users
OAuth2 client credentials for partners
Server-side BFF session for browser
JWT resource server for internal APIs
```

### Phase 0 — Discovery

- inventory users, roles, password schemes;
- inventory Basic Auth clients;
- inventory session store;
- inventory audit principal format;
- inventory downstream assumptions.

### Phase 1 — Hardening Before Migration

- add structured audit events;
- add auth method metric;
- add failure reason taxonomy;
- add password hash scheme column;
- add external identity link table;
- add role mapping table;
- add feature flags.

### Phase 2 — Password Hash Upgrade

- support old and new password verifiers;
- rehash on successful login;
- force reset for weak/unverifiable users;
- monitor migration percentage.

### Phase 3 — OIDC Shadow

- configure OIDC client;
- validate ID token strictly;
- implement identity matching report;
- do not enforce yet;
- fix ambiguous matches.

### Phase 4 — Pilot OIDC Login

- enable OIDC for internal pilot;
- create external links;
- create normal app sessions after OIDC;
- compare old/new role mapping;
- monitor support tickets.

### Phase 5 — Role Mapping Cutover

- shadow role mapping;
- fix diffs;
- enable external mapping for pilot;
- keep admin elevation deny-by-default;
- audit all role derivation.

### Phase 6 — Partner API Migration

- register OAuth2 clients;
- support Basic + OAuth2 during grace period;
- add deprecation warnings;
- disable Basic per migrated client;
- eventually remove Basic.

### Phase 7 — Full Cutover

- disable local password login for normal users;
- keep emergency break-glass separately controlled;
- invalidate legacy sessions;
- enforce OIDC;
- require MFA/ACR for privileged actions.

### Phase 8 — Cleanup

- remove fallback code;
- revoke old credentials;
- archive old auth tables according to retention policy;
- update docs/runbooks;
- perform post-migration review.

---

## 30. Summary

Authentication migration is not primarily a framework upgrade. It is a controlled change to **identity proof, trust boundary, credential lifecycle, principal semantics, role mapping, session/token behavior, audit evidence, and rollback capability**.

The top-level mental model:

```text
Old proof -> verifier -> old principal -> old roles -> old session
New proof -> verifier -> identity link -> app principal -> mapped roles -> new session/token
```

A strong migration design protects these invariants:

1. no silent identity change;
2. no privilege gain by default;
3. no credential downgrade;
4. no audit gap;
5. rollback remains secure;
6. fallback has an expiry date;
7. source of truth is explicit;
8. account linking is evidence-based;
9. role migration is diffed before enforcement;
10. old code and old secrets are removed after cutover.

If Part 0–32 taught the available authentication modes and how they fail, Part 33 teaches how to **move real systems between those modes safely**.

---

## 31. References

Use these as grounding references for deeper reading:

1. Oracle Java SE 25 JAAS Reference Guide — `LoginContext`, `LoginModule`, `Subject`, and JAAS authentication flow.
2. Oracle Java SE 25 `LoginContext` API — pluggable authentication technology abstraction.
3. Jakarta Security 4.0 Specification — `HttpAuthenticationMechanism`, `IdentityStore`, `SecurityContext`.
4. Spring Security Servlet Authentication Architecture — `SecurityContextHolder`, `Authentication`, `AuthenticationManager`, `AuthenticationProvider`, filter chain.
5. Spring Security OAuth2 Resource Server Reference — JWT and opaque token support.
6. Spring Security OAuth2 Migration Guide — migration from older Spring OAuth2 approaches to modern Spring Security OAuth2 support.
7. Spring Security 7 Migration Documentation — migration preparation for newer security defaults.
8. Spring Authorization Server Project Documentation — modern authorization server direction in Spring ecosystem.
9. OpenID Connect Core 1.0 — ID Token, issuer, subject, nonce, claims, UserInfo.
10. RFC 6749 — OAuth 2.0 Authorization Framework.
11. RFC 7636 — PKCE.
12. RFC 7662 — Token Introspection.
13. RFC 7009 — Token Revocation.
14. RFC 8693 — Token Exchange.
15. RFC 8705 — OAuth2 Mutual TLS and certificate-bound tokens.
16. RFC 9700 — OAuth 2.0 Security Best Current Practice.
17. OWASP Authentication Cheat Sheet.
18. OWASP Session Management Cheat Sheet.
19. OWASP JSON Web Token for Java Cheat Sheet.
20. OWASP API Security Top 10 2023.

---

## 32. Status Series

- Part 0–33: **selesai**.
- Series: **belum selesai**.
- Berikutnya: **Part 34 — Reference Architectures and Decision Framework**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-032.md">⬅️ Part 32 — Authentication Testing Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-034.md">Part 34 — Reference Architectures and Decision Framework ➡️</a>
</div>
