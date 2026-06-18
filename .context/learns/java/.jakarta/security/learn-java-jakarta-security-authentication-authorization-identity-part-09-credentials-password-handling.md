# Part 09 — Credentials and Password Handling in Jakarta Applications

**Series:** `learn-java-jakarta-security-authentication-authorization-identity`  
**File:** `learn-java-jakarta-security-authentication-authorization-identity-part-09-credentials-password-handling.md`  
**Scope:** Java 8–25, Java EE / Jakarta EE, Servlet, Jakarta Security, Jakarta Authentication, IdentityStore, enterprise authentication systems  
**Position:** Setelah memahami `IdentityStore`, sekarang kita masuk ke objek paling sensitif dalam proses authentication: **credential**.

---

## 0. Tujuan Bagian Ini

Bagian ini bertujuan membuat kita tidak hanya tahu bahwa password harus di-hash, tetapi memahami **bagaimana credential hidup, bergerak, divalidasi, bocor, disimpan, dimigrasikan, dan diaudit** di aplikasi Java/Jakarta enterprise.

Materi ini sengaja tidak mengulang seri kriptografi Java yang sudah selesai. Fokusnya bukan membahas detail matematika hash, signature, encryption, atau TLS dari nol, tetapi membahas:

1. Di mana credential berada dalam arsitektur Jakarta Security.
2. Apa batas tanggung jawab `HttpAuthenticationMechanism`, `IdentityStore`, `Credential`, dan password hash.
3. Kenapa password bukan sekadar field `String password`.
4. Bagaimana mendesain credential lifecycle yang aman.
5. Bagaimana menangani legacy password table.
6. Bagaimana membedakan password, token, API key, certificate, OTP, recovery code, dan external identity assertion.
7. Bagaimana membuat failure model credential yang realistis untuk production.

Target akhirnya: ketika melihat sistem login enterprise, kita bisa menjawab:

> “Credential apa yang diterima? Siapa yang memvalidasi? Apakah validasi ini reusable? Apakah credential tersimpan? Apakah credential bisa bocor di log, heap, session, database, trace, atau audit? Apakah hasil validasi menjadi caller identity yang benar di container?”

---

## 1. Mental Model: Credential Bukan Identity

Kesalahan paling umum adalah menyamakan:

```text
username/password = user
JWT = user
certificate = user
session id = user
```

Itu salah secara model.

Credential adalah **bukti** atau **material authentication** yang digunakan untuk membuktikan klaim identity.

Identity adalah entitas yang dikenali sistem.

Principal adalah representasi nama/identity yang dipakai container.

Role/group adalah atribut authorization.

Session adalah state setelah authentication.

Token bisa menjadi credential, assertion, atau authorization artifact tergantung konteks.

Model dasarnya:

```text
Caller presents credential
        |
        v
Authentication mechanism extracts credential
        |
        v
IdentityStore / verifier validates credential
        |
        v
CredentialValidationResult
        |
        v
Container establishes caller principal + groups
        |
        v
Application checks role / permission
```

Credential bukan tujuan akhir. Credential hanyalah input menuju establishment identity.

---

## 2. Credential Dalam Jakarta Security

Jakarta Security memiliki konsep `Credential` sebagai abstraction untuk data yang dipakai dalam authentication. Contoh umum:

```java
UsernamePasswordCredential credential =
    new UsernamePasswordCredential(username, password);
```

Lalu credential tersebut divalidasi oleh `IdentityStore`:

```java
CredentialValidationResult result = identityStore.validate(credential);
```

Jika valid, hasilnya berisi caller principal dan group:

```java
return new CredentialValidationResult(
    new CallerPrincipal(user.getUsername()),
    user.getGroups()
);
```

Penting:

```text
Credential input != authenticated identity
CredentialValidationResult == hasil validasi yang boleh diteruskan ke container
```

Di Jakarta Security, alur ini biasanya melibatkan tiga abstraction utama:

| Komponen | Fungsi |
|---|---|
| `HttpAuthenticationMechanism` | Mengambil credential dari HTTP request |
| `IdentityStore` | Memvalidasi credential dan/atau menyediakan group |
| `CredentialValidationResult` | Menyatakan hasil validasi caller |

Jadi, password handling bukan cuma “cek password di database”. Password handling adalah bagian dari authentication pipeline.

---

## 3. Apa Itu Credential?

Credential adalah material yang digunakan oleh caller untuk membuktikan klaim bahwa ia adalah identity tertentu atau memiliki hak untuk bertindak sebagai identity tertentu.

Contoh credential:

1. Password.
2. One-time password.
3. Recovery code.
4. API key.
5. Bearer access token.
6. ID token.
7. Refresh token.
8. Client certificate.
9. Private key proof.
10. Signed assertion.
11. SAML assertion.
12. Kerberos ticket.
13. Session cookie.
14. Device secret.
15. WebAuthn assertion.

Namun semua credential tidak setara.

Kita perlu membedakan berdasarkan sifatnya:

| Jenis | Reusable? | User-presented? | Server-stored? | Risk utama |
|---|---:|---:|---:|---|
| Password | Ya | Ya | Hash verifier | Offline cracking |
| OTP | Tidak/semi | Ya | Secret/transaction state | Replay / phishing |
| API key | Ya | Ya | Secret/hash | Long-lived leakage |
| Bearer token | Ya selama valid | Ya | Usually not stored raw | Replay |
| Refresh token | Ya | Ya | Often stored/rotated | Session takeover |
| Client certificate | Ya sampai expire | TLS layer | Public cert/trust anchor | Misbinding / expired cert |
| WebAuthn assertion | Tidak langsung reusable | Ya | Public key | Device loss / origin binding |
| Session cookie | Ya selama session | Browser-presented | Server/session store | Theft / fixation |

Pertanyaan desain pertama:

```text
Apakah credential ini reusable jika dicuri?
```

Kalau jawabannya ya, maka credential itu harus diperlakukan sebagai secret berisiko tinggi.

---

## 4. Credential Lifecycle

Credential punya lifecycle. Engineer top-level tidak hanya memikirkan saat login berhasil, tapi seluruh hidup credential.

Lifecycle umum:

```text
issued / created
        |
presented by caller
        |
extracted from request
        |
validated
        |
converted into authenticated identity
        |
possibly stored / cached / rotated
        |
expired / revoked / replaced
        |
audited / retained minimally
```

Untuk password:

```text
user chooses password
        |
password transmitted over TLS
        |
server receives password
        |
server checks password policy/blocklist
        |
server hashes with password hashing algorithm
        |
hash + parameters + salt stored
        |
login: password received again
        |
password verified against stored verifier
        |
if algorithm/params old, rehash on successful login
        |
password eventually changed/reset/disabled
```

Untuk access token:

```text
authorization server issues token
        |
client presents token to resource server
        |
resource server validates signature/introspection
        |
claims mapped to principal/groups/permissions
        |
token expires or is revoked
```

Untuk session cookie:

```text
authentication succeeds
        |
server creates session
        |
session id sent as cookie
        |
browser presents cookie
        |
server resolves session identity
        |
session expires / logout invalidates session
```

Setiap tahap punya leakage point.

---

## 5. Credential Leakage Points

Credential bisa bocor bahkan kalau hashing sudah benar.

Bocor bukan hanya dari database. Credential bisa bocor dari:

1. Access log.
2. Application log.
3. Exception message.
4. Stack trace.
5. HTTP trace/debug log.
6. Reverse proxy log.
7. Browser history.
8. Query string.
9. Referer header.
10. APM span/tag.
11. Audit trail.
12. Dead letter queue.
13. Message broker payload.
14. Heap dump.
15. Thread dump.
16. Crash dump.
17. Session serialization.
18. Distributed cache.
19. Metrics label.
20. Test fixture.
21. CI/CD logs.
22. Screenshot / support ticket.
23. Database replication / backup.
24. Search index.
25. Object storage export.

Rule:

```text
Credential must not become ordinary business data.
```

Kalau password masuk ke DTO umum, request audit, JSON log, cache, event, atau exception, desainnya sudah salah.

---

## 6. Password: Memorized Secret, Bukan Sekadar String

Password adalah **memorized secret**. Karakteristiknya buruk dari sisi security:

1. Dipilih manusia.
2. Sering reused antar sistem.
3. Bisa ditebak.
4. Bisa dipancing phishing.
5. Harus dikirim ke server saat login.
6. Server harus menyimpan verifier.
7. Jika database bocor, attacker bisa melakukan offline cracking.

Karena itu password adalah salah satu credential paling sulit diamankan.

OWASP merekomendasikan password tidak pernah disimpan dalam plain text, tetapi dilindungi dengan password hashing yang lambat dan kuat seperti Argon2id, bcrypt, atau PBKDF2, dengan salt unik untuk setiap password. Fast hash seperti SHA-256 tidak cocok untuk password storage karena terlalu cepat untuk brute-force/offline guessing.

NIST SP 800-63B juga menekankan penggunaan blocklist untuk password yang umum, expected, atau compromised, dan membandingkan keseluruhan password terhadap blocklist, bukan substring.

---

## 7. Password Storage: Hash, Salt, Pepper, Parameter

Password storage yang benar menyimpan **verifier**, bukan password.

Bentuk umum:

```text
user_id | password_hash | algorithm | parameters | salt | version | updated_at
```

Atau format encoded string:

```text
$argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>
```

Atau bcrypt:

```text
$2b$12$<salt+hash>
```

Atau PBKDF2 custom/standardized encoding:

```text
pbkdf2:sha256:600000:<salt>:<hash>
```

### Salt

Salt adalah nilai unik per password yang mencegah precomputed lookup table dan membuat dua password sama menghasilkan hash berbeda.

Salt:

1. Harus unik.
2. Harus random.
3. Tidak perlu secret.
4. Disimpan bersama hash.

### Pepper

Pepper adalah secret global atau per-domain yang disimpan terpisah dari database, misalnya di KMS/HSM/secret manager.

Pepper berguna jika database bocor tetapi secret manager tidak bocor.

Namun pepper punya konsekuensi:

1. Rotasi sulit.
2. Jika hilang, password verifier tidak bisa digunakan.
3. Harus ada strategi versioning.
4. Bisa menjadi single point of failure.

Model pepper:

```text
hash(password + pepper)
```

atau:

```text
HMAC(pepper, password_hash)
```

Untuk sistem enterprise, pepper harus didesain sebagai **key management problem**, bukan sekadar string di config file.

### Parameter

Password hash harus menyimpan parameter karena parameter akan berubah seiring waktu.

Contoh parameter:

1. Memory cost.
2. Iteration count.
3. Parallelism.
4. Algorithm version.
5. Salt length.
6. Hash length.

Invariant:

```text
Stored password verifier must be self-describing enough to verify old passwords and upgrade them safely.
```

---

## 8. Algorithm Choice: Argon2id, bcrypt, PBKDF2

Secara modern, pilihan yang umum:

| Algorithm | Kelebihan | Kekurangan | Kapan dipakai |
|---|---|---|---|
| Argon2id | Memory-hard, modern | Library/JCA support perlu dipastikan | Pilihan kuat untuk sistem baru |
| bcrypt | Mature, luas | Password length/truncation concern, tidak memory-hard modern | Sistem existing, compatibility |
| PBKDF2 | Standard, JDK/JCA friendly | Tidak memory-hard | FIPS/compliance/JDK-only environment |
| scrypt | Memory-hard | Support enterprise Java lebih bervariasi | Jika library dan policy mendukung |

Untuk Jakarta app murni tanpa library tambahan, `Pbkdf2PasswordHash` sering muncul karena Jakarta Security mendefinisikan password hash abstraction dan built-in PBKDF2 support di banyak implementasi.

Namun sebagai design principle:

```text
Do not choose algorithm only because it is easy in code.
Choose based on threat model, compliance, library maturity, operational support, and migration path.
```

---

## 9. Jakarta Security `PasswordHash`

Jakarta Security menyediakan interface `PasswordHash` untuk password hashing/verification.

Mental model:

```text
PasswordHash is not the identity store.
PasswordHash is a service used by an identity store to verify or generate password verifiers.
```

Contoh konsep:

```java
@ApplicationScoped
public class PasswordService {

    @Inject
    private PasswordHash passwordHash;

    public String hash(char[] password) {
        return passwordHash.generate(password);
    }

    public boolean verify(char[] password, String storedHash) {
        return passwordHash.verify(password, storedHash);
    }
}
```

Catatan: detail method signature bisa berbeda tergantung versi API/implementation; konsepnya adalah pemisahan antara:

1. Credential extraction.
2. Password verification.
3. Identity lookup.
4. Caller establishment.

Yang penting bukan hafal method, tetapi desain boundary-nya.

---

## 10. Basic Username/Password Flow di Jakarta Security

Flow sederhana:

```text
POST /login
  username=alice
  password=secret
        |
        v
HttpAuthenticationMechanism extracts username/password
        |
        v
IdentityStore receives UsernamePasswordCredential
        |
        v
User repository finds account by username
        |
        v
PasswordHash verifies presented password against stored verifier
        |
        v
Account status checked
        |
        v
CredentialValidationResult returned
        |
        v
Container establishes CallerPrincipal + groups
```

Pseudo-code:

```java
@ApplicationScoped
public class ApplicationIdentityStore implements IdentityStore {

    @Inject
    UserRepository users;

    @Inject
    PasswordHash passwordHash;

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof UsernamePasswordCredential upc)) {
            return NOT_VALIDATED_RESULT;
        }

        String username = normalizeUsername(upc.getCaller());
        Optional<UserAccount> accountOpt = users.findByUsername(username);

        if (accountOpt.isEmpty()) {
            fakePasswordVerificationToReduceTimingSignal(upc);
            return INVALID_RESULT;
        }

        UserAccount account = accountOpt.get();

        if (!account.isLoginAllowed()) {
            fakePasswordVerificationToReduceTimingSignal(upc);
            return INVALID_RESULT;
        }

        boolean ok = passwordHash.verify(
            upc.getPassword().getValue(),
            account.passwordVerifier()
        );

        if (!ok) {
            return INVALID_RESULT;
        }

        if (needsRehash(account.passwordVerifier())) {
            users.updatePasswordVerifier(
                account.id(),
                passwordHash.generate(upc.getPassword().getValue())
            );
        }

        return new CredentialValidationResult(
            new CallerPrincipal(account.stableSubjectId()),
            account.groups()
        );
    }
}
```

Conceptual notes:

1. Username normalization happens before lookup.
2. Account existence should not leak easily.
3. Account status is checked before success.
4. Password verification is separated from role lookup.
5. CallerPrincipal should usually be stable subject ID, not display name.
6. Groups returned should be security groups, not UI labels.
7. Rehash can happen after successful login.

---

## 11. Username Normalization

Credential handling includes username handling.

Username pitfalls:

1. Case sensitivity mismatch.
2. Unicode normalization issue.
3. Leading/trailing spaces.
4. Email alias behavior.
5. Different login identifiers mapping to one account.
6. Same email across tenants.
7. Local-part email case assumptions.
8. Homoglyph attacks.
9. Account enumeration through normalization errors.

Better model:

```text
login_identifier_input -> canonical_login_key -> account -> stable_subject_id
```

Example:

```java
public String canonicalizeLogin(String raw) {
    if (raw == null) {
        throw new InvalidCredentialException();
    }

    return Normalizer.normalize(raw.trim(), Normalizer.Form.NFKC)
        .toLowerCase(Locale.ROOT);
}
```

But be careful: not every identifier should be lowercased. Email normalization rules are provider-specific. Enterprise employee IDs may be case-insensitive. External IdP subjects should not be transformed casually.

Invariant:

```text
Canonicalization must be explicit, documented, and consistent at registration, login, lookup, and migration.
```

---

## 12. Account Status Is Part of Credential Validation

A password can be correct but login must still fail.

Examples:

1. Account disabled.
2. Account locked.
3. Account pending activation.
4. Password expired.
5. Must reset password.
6. User left organization.
7. Tenant suspended.
8. IdP migration incomplete.
9. MFA required.
10. Terms not accepted.

But these statuses are not all the same.

| Status | Auth result | UX behavior | Audit |
|---|---|---|---|
| Disabled | Fail | Generic or admin contact | Security event |
| Locked due to attempts | Fail | Generic or reset flow | Security event |
| Password expired | Partial/special flow | Force change | Audit |
| MFA required | Continue | Challenge MFA | Auth event |
| Tenant suspended | Fail | Contact admin | Security/admin event |
| Must accept terms | Authenticated but gated | Terms page | Business audit |

Do not collapse everything into:

```java
return INVALID_RESULT;
```

from the domain perspective. The caller-facing response may be generic, but internal audit reason must be precise.

---

## 13. Timing and Enumeration Considerations

Login endpoints often leak information:

1. “User not found” vs “Wrong password”.
2. Faster response for non-existing username.
3. Different error page.
4. Different HTTP status.
5. Different lockout behavior.
6. Different email reset response.

A safer public response:

```text
Invalid username or password.
```

Internal audit:

```text
AUTH_FAILURE_USER_NOT_FOUND
AUTH_FAILURE_BAD_PASSWORD
AUTH_FAILURE_ACCOUNT_LOCKED
AUTH_FAILURE_DISABLED_ACCOUNT
```

Timing mitigation:

```java
if (accountNotFound) {
    passwordHash.verify(inputPassword, knownDummyHash);
    return INVALID_RESULT;
}
```

But do not overestimate this. Network jitter helps, but high-volume attackers can still gather signals. The goal is reducing easy enumeration, not proving perfect constant-time behavior for the whole request.

---

## 14. Password Policy: What To Validate

Modern password policy should not rely mainly on arbitrary complexity rules.

Better requirements:

1. Minimum length.
2. Allow long passwords/passphrases.
3. Allow spaces and broad characters where practical.
4. Block known compromised/common passwords.
5. Prevent password equal to username/email/known user attributes.
6. Rate-limit attempts.
7. Support MFA for riskier contexts.
8. Avoid forced periodic rotation unless compromise or policy reason requires it.
9. Provide password manager compatibility.
10. Do not silently truncate passwords.

Weak policy:

```text
Must contain uppercase, lowercase, number, symbol, exactly 8-12 chars.
```

Better policy:

```text
Minimum 12 or more depending on context, allow long passphrases, block compromised/common values, rate-limit attempts, do not impose weird composition rules unless compliance requires it.
```

Enterprise nuance: if compliance policy mandates complexity, document it as compliance constraint, not as ideal security design.

---

## 15. Password Reset Is Authentication Too

Password reset is often more dangerous than login.

If attacker can reset password, attacker does not need password.

Password reset flow must be modelled as credential issuance.

Flow:

```text
User requests reset
        |
System issues reset credential/token
        |
Token delivered over email/SMS/admin channel
        |
User presents token
        |
System validates token
        |
User sets new password
        |
Old sessions/tokens may be revoked
        |
Audit event emitted
```

Reset token design:

1. High entropy.
2. One-time use.
3. Short lifetime.
4. Stored hashed server-side if stored.
5. Bound to account and purpose.
6. Invalidated after use.
7. Invalidated after password change.
8. Does not reveal account existence.
9. Not logged.
10. Not sent in referer to third-party assets.

Bad reset token:

```text
/reset?userId=123&token=md5(email+timestamp)
```

Better model:

```text
opaque random token -> hash stored in reset_token table -> purpose + account + expiry + consumed_at
```

---

## 16. Change Password vs Reset Password

Change password:

```text
authenticated user + old password + new password
```

Reset password:

```text
reset credential + new password
```

Admin reset:

```text
admin actor + target account + temporary credential or reset link
```

These are different security events.

| Flow | Existing auth? | Old password required? | Risk |
|---|---:|---:|---|
| Change password | Yes | Usually yes | Session hijacker could change if no reauth |
| Forgot password | No | No | Email/channel takeover |
| Admin reset | Admin auth | No | Insider/admin abuse |
| Forced reset | User may be logged in | No/varies | Account recovery complexity |

For sensitive systems, password change should require recent authentication.

---

## 17. Password Migration from Legacy Systems

Legacy systems often store password badly:

1. Plain text.
2. Reversible encrypted password.
3. MD5.
4. SHA-1.
5. SHA-256 without salt.
6. Shared salt.
7. Old PBKDF2 iteration count.
8. bcrypt with low cost.
9. Unknown custom hash.

Migration strategy should avoid forcing all users to reset immediately unless risk demands it.

### Strategy A — Rehash on Login

```text
User logs in with password
        |
Verify using legacy algorithm
        |
If valid, rehash using modern algorithm
        |
Store new verifier
        |
Mark password version upgraded
```

Pros:

1. Good user experience.
2. Gradual migration.
3. No mass reset.

Cons:

1. Inactive users remain legacy.
2. Need legacy verifier code temporarily.
3. Breach risk remains until migration completes.

### Strategy B — Forced Reset

```text
Invalidate legacy password
        |
Require reset on next login
```

Pros:

1. Removes old verifier risk quickly.
2. Stronger compliance posture.

Cons:

1. Operational load.
2. User friction.
3. Helpdesk burden.
4. Risk of reset-channel attack.

### Strategy C — Dual Verifier Field

```text
legacy_hash | modern_hash | password_version
```

On successful login, populate modern hash and eventually drop legacy.

Invariant:

```text
Legacy verifier must have an explicit retirement plan.
```

---

## 18. Reversible Encryption of Passwords

Storing encrypted password is almost always wrong.

Why?

If the application can decrypt it, then anyone who obtains application key + database can recover all passwords.

Password verification does not require decryption. It requires comparing a derived verifier.

Bad:

```text
AES(password) stored in database
```

Better:

```text
PasswordHash(password, salt, parameters) stored in database
```

Rare cases where reversible secrets exist are not password storage cases. Examples:

1. External API credential vault.
2. Service account secret needed for outbound integration.
3. OAuth client secret.
4. Legacy protocol credential.

Those are **secrets management** problems, not password storage problems.

---

## 19. API Keys as Credentials

API key is often treated casually, but it is a reusable bearer credential.

API key design:

1. Generate high entropy random value.
2. Show only once.
3. Store hash of key, not raw key.
4. Include key prefix for lookup.
5. Scope key to client/application/tenant.
6. Support expiry.
7. Support rotation.
8. Support revocation.
9. Audit last used time.
10. Rate-limit and anomaly-detect.

Common pattern:

```text
full key: live_abc123.<random-secret>
          |prefix|   |secret part|
```

Database:

```text
key_id | prefix | secret_hash | owner | scopes | expires_at | revoked_at | last_used_at
```

Lookup:

```text
extract prefix -> find candidate -> verify secret hash -> check status/scope
```

Never store API key raw unless there is an unavoidable product requirement, and even then treat it as vault material.

---

## 20. Bearer Tokens as Credentials

Bearer token means:

```text
Whoever holds the token can use it.
```

So access token is a credential when presented to resource server.

Risks:

1. Replay if stolen.
2. Logging leakage.
3. Browser storage leakage.
4. Wrong audience accepted.
5. Expired token accepted due to clock bug.
6. ID token mistakenly accepted as access token.
7. Token from another issuer accepted.
8. Algorithm confusion.
9. JWKS cache poisoning or stale keys.
10. Overbroad scopes.

Bearer token handling rule:

```text
Never log Authorization header.
Never put bearer token in query string.
Never treat decoded JWT as valid before cryptographic and semantic validation.
```

Token is credential input. Validated token claims can become identity attributes.

---

## 21. Refresh Tokens

Refresh token is usually more sensitive than access token because it can mint new access tokens.

Refresh token should be:

1. Long random opaque value or securely issued token.
2. Stored securely by client.
3. Rotated on use where possible.
4. Revocable.
5. Bound to client/session/device where possible.
6. Audited.
7. Never exposed to browser JS unless architecture explicitly accepts the risk.

For Jakarta backend using OIDC login, refresh token usually belongs in server-side secure storage/session, not in front-end JavaScript.

---

## 22. Session Cookie as Credential

After login, the browser usually no longer sends password; it sends a session cookie.

Session cookie is a credential.

If stolen, attacker may impersonate user.

Session cookie must have:

```text
Secure
HttpOnly
SameSite appropriate for flow
narrow Path/Domain
reasonable lifetime
server-side invalidation
```

Session id must be regenerated after authentication to prevent fixation.

Never put session id in URL.

Do not store password or raw token in `HttpSession` unless absolutely necessary and protected by strong server-side controls.

---

## 23. Client Certificate Credential

Client certificate authentication uses certificate proof at TLS layer.

The certificate itself is public material, but possession of private key is the real proof.

Important distinction:

```text
Certificate subject != automatically application user
```

You still need mapping:

```text
certificate chain valid?
        |
trusted CA?
        |
revoked?
        |
subject/SAN maps to account/service?
        |
account/service active?
        |
groups/permissions resolved?
```

If TLS terminates at reverse proxy, forwarding certificate identity through headers must be protected. Otherwise attacker can spoof identity headers.

---

## 24. OTP, Recovery Codes, and MFA Credentials

OTP and recovery code are credentials too.

TOTP/HOTP secret storage:

1. Secret must be encrypted or protected at rest.
2. Backup/recovery codes should be stored hashed.
3. Used recovery code must be invalidated.
4. OTP replay must be prevented within a time window.
5. MFA challenge state must bind to login transaction.

MFA is not simply “after password ask OTP”. It has state:

```text
primary credential valid
        |
partial authentication state created
        |
MFA challenge issued
        |
MFA credential validated
        |
full session established
```

Do not establish full privileged session before MFA is complete.

---

## 25. WebAuthn / Passkey Credential Conceptual Placement

Even if Jakarta Security does not directly define WebAuthn as core built-in login for all containers, understanding the credential model matters.

WebAuthn uses public key cryptography:

1. Server stores public key credential.
2. Authenticator holds private key.
3. Browser mediates assertion bound to origin.
4. Server verifies signature and challenge.

Credential model:

```text
challenge issued by server
        |
authenticator signs challenge
        |
server verifies signature with stored public key
        |
identity established
```

WebAuthn reduces phishing/replay risk compared to password, but introduces recovery/device lifecycle complexity.

---

## 26. Java Memory Handling: `String` vs `char[]`

Classic Java advice says passwords should be `char[]`, not `String`, because `String` is immutable and may remain in memory until GC.

Reality is nuanced:

1. `String` cannot be cleared manually.
2. `char[]` can be overwritten.
3. Many frameworks still convert password to `String` internally.
4. HTTP request parsing may already materialize strings.
5. Heap dumps can contain credentials either way.
6. Modern compact strings and JVM internals complicate assumptions.

Guideline:

```text
Use char[]/Password abstraction where API supports it, clear it when possible, but do not pretend this alone solves credential leakage.
```

Stronger controls:

1. Do not heap-dump production casually.
2. Protect heap dumps as secrets.
3. Disable verbose request logging for auth endpoints.
4. Redact secrets in log frameworks/APM.
5. Avoid storing credential in long-lived objects.
6. Clear temporary arrays where practical.
7. Keep authentication code path narrow.

Example:

```java
char[] password = credential.getPassword().getValue();
try {
    boolean valid = passwordHash.verify(password, storedHash);
    // ...
} finally {
    Arrays.fill(password, '\0');
}
```

But note: if the underlying credential object still retains a copy, clearing your local array may not clear all copies.

---

## 27. DTO Design for Credentials

Bad DTO:

```java
public record LoginRequest(String username, String password) {}
```

This is common and sometimes unavoidable in JSON APIs, but it has risks:

1. `toString()` may log password.
2. Serialization/deserialization may keep copies.
3. Validation error may expose field value.
4. Debugger may show it.
5. APM may capture request body.

Safer DTO design:

```java
public final class LoginRequest {
    private String username;

    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    private char[] password;

    public String username() {
        return username;
    }

    public char[] password() {
        return password;
    }

    @Override
    public String toString() {
        return "LoginRequest{username='" + username + "', password=<redacted>}";
    }

    public void clear() {
        if (password != null) {
            Arrays.fill(password, '\0');
        }
    }
}
```

For enterprise systems, also configure logging and JSON frameworks to prevent body capture.

---

## 28. Validation Error Handling

Bad:

```json
{
  "error": "Password superSecret123 is invalid"
}
```

Bad:

```text
User alice@example.com does not exist
```

Better public response:

```json
{
  "error": "invalid_credentials",
  "message": "Invalid username or password."
}
```

Internal audit:

```json
{
  "event": "AUTH_FAILURE",
  "reason": "BAD_PASSWORD",
  "loginKeyHash": "...",
  "ip": "...",
  "userAgentHash": "...",
  "correlationId": "..."
}
```

Notice: audit can contain enough for investigation without storing raw credential.

---

## 29. Logging and Redaction

A mature application has redaction at multiple layers:

1. Application logs.
2. HTTP access logs.
3. Reverse proxy logs.
4. API gateway logs.
5. APM traces.
6. Exception reporting.
7. Audit logs.
8. Database logs.
9. Message broker logs.
10. Test logs.

Patterns to redact:

```text
password
passwd
pwd
secret
credential
authorization
cookie
set-cookie
access_token
refresh_token
id_token
api_key
client_secret
assertion
saml_response
otp
recovery_code
```

Header redaction:

```text
Authorization: <redacted>
Cookie: <redacted>
Set-Cookie: <redacted>
X-Api-Key: <redacted>
```

Structured logging rule:

```text
Never log a whole request object from authentication endpoint.
```

---

## 30. Credential in URL Is Almost Always Wrong

Never put credential in query string:

```text
/login?username=alice&password=secret
/callback?access_token=...
/reset?token=...
```

Why?

Query strings leak through:

1. Browser history.
2. Server access logs.
3. Reverse proxy logs.
4. Referer header.
5. Analytics.
6. Screenshots.
7. Support tickets.

Reset token in URL is common because email links need URLs, but then additional care is needed:

1. Short lifetime.
2. One-time use.
3. No third-party resources on reset page before token consumed.
4. Referrer-Policy.
5. Hash token at rest.
6. Consume/exchange token quickly into server-side flow state.

---

## 31. Rate Limiting and Lockout

Password hashing protects database compromise. It does not stop online guessing.

Online protection:

1. Rate-limit by account.
2. Rate-limit by IP/network.
3. Rate-limit by device fingerprint where allowed.
4. Progressive delay.
5. Temporary lockout.
6. CAPTCHA only as secondary/friction measure.
7. Risk-based MFA.
8. Alerting for credential stuffing.
9. Password spraying detection.

Lockout trade-off:

| Strategy | Benefit | Risk |
|---|---|---|
| Hard lock account | Stops guessing | Enables denial-of-service |
| Progressive delay | Reduces attack speed | More complex UX |
| IP rate limit | Stops simple bots | NAT/proxy collateral damage |
| Risk-based challenge | Flexible | Needs more signals |

Good design separates:

```text
password correctness
attempt tracking
account lock policy
risk decision
user messaging
audit event
```

---

## 32. Credential Stuffing and Password Spraying

Credential stuffing:

```text
attacker has username/password pairs from other breaches
tries them against your app
```

Password spraying:

```text
attacker tries common password against many accounts
```

Defenses:

1. Block compromised passwords during registration/change.
2. Detect many usernames from one IP/range.
3. Detect same password attempt pattern if privacy-safe.
4. MFA for risky login.
5. Rate limiting.
6. Bot detection.
7. Security event correlation.
8. User notification for suspicious login.

A password hash algorithm does not solve credential stuffing because attacker is using the real password online.

---

## 33. Credential Caching

Caching credential validation is dangerous.

Do not cache raw password.

Possible caches:

1. User account lookup cache.
2. Group membership cache.
3. Password hash verification result cache.
4. Token introspection cache.
5. JWKS cache.
6. Session cache.

Password verification result caching is usually a bad idea:

```text
(username, password) -> valid
```

because it effectively creates another credential verifier and can preserve password-derived material.

Better:

```text
After successful authentication, create session.
```

For external token introspection, cache carefully by token hash and expiry, but consider revocation freshness.

---

## 34. Secret Management for Credential Infrastructure

Credential handling depends on other secrets:

1. Pepper.
2. OAuth client secret.
3. JWT signing key.
4. Token encryption key.
5. Database password.
6. LDAP bind password.
7. SMTP credential for reset email.
8. mTLS private key.
9. HMAC key for API key storage.

These should not live in source code or ordinary config file.

Use:

1. Secret manager.
2. KMS/HSM where appropriate.
3. Environment-specific secret injection.
4. Rotation process.
5. Access control.
6. Audit of secret access.
7. Versioning.
8. Break-glass procedure.

Credential system security is only as strong as secret management around it.

---

## 35. Key Rotation and Password Hash Parameter Upgrade

Password hashes are upgraded differently from encryption keys.

For password hash parameter upgrade:

```text
verify old hash successfully
        |
if old algorithm/params
        |
rehash presented password with new params
        |
store new verifier
```

For pepper rotation:

Option A — rehash on login with new pepper.

Option B — store pepper version and support multiple peppers temporarily.

Option C — force reset if old pepper compromised.

For API keys:

1. Issue new key.
2. Allow overlap window.
3. Track last used old key.
4. Revoke old key.
5. Alert if old key used after deadline.

For OAuth client secrets:

1. Register new secret with IdP.
2. Deploy app config.
3. Verify traffic.
4. Remove old secret.

Rotation must be rehearsed. Otherwise “we support rotation” is theoretical.

---

## 36. Credentials and Audit

Audit should answer:

1. Who attempted authentication?
2. Which credential type was used?
3. Did it succeed?
4. Why did it fail internally?
5. Which account/tenant was targeted?
6. Which IP/user agent/client did it come from?
7. Was MFA required/completed?
8. Was password changed/reset?
9. Were old sessions revoked?
10. Was an admin involved?

Audit should not store:

1. Raw password.
2. Raw token.
3. Full session id.
4. Full reset token.
5. Full API key.
6. OTP.
7. Recovery code.

Use hashed identifiers for correlation:

```text
loginKeyHash = HMAC(auditKey, canonicalLoginKey)
tokenHash = SHA-256(rawToken) or HMAC(auditKey, rawToken)
sessionIdHash = HMAC(auditKey, sessionId)
```

Prefer HMAC with audit key if correlation value itself could be brute-forced.

---

## 37. Credential Handling in Distributed Systems

In microservices or modular Jakarta enterprise systems, credential handling must be minimized.

Bad model:

```text
Frontend -> Service A password
Service A -> Service B password
Service B -> Service C password
```

Better:

```text
User authenticates once
        |
Session/token established
        |
Downstream receives constrained identity/token/context
```

Even better:

```text
Service-to-service identity uses mTLS/client credentials/token exchange
User identity propagated separately as on-behalf-of context
```

Do not propagate user password downstream.

If a downstream system requires a password, treat it as legacy integration and isolate it behind a credential vault/service boundary.

---

## 38. Java 8–25 Considerations

### Java 8

1. Legacy enterprise systems common.
2. Older app servers may support Java EE 8 / `javax.*`.
3. Limited modern language features.
4. PBKDF2 available via JCA.
5. Argon2 usually needs third-party library.
6. TLS defaults and crypto policy may require attention.

### Java 11/17

1. Common long-term server baselines.
2. Better TLS defaults than older Java 8 builds.
3. Stronger ecosystem support.
4. Jakarta EE 10 often targets Java 11+ depending on runtime.

### Java 21

1. Virtual threads become relevant for context propagation.
2. Authentication code using ThreadLocal assumptions must be reviewed.
3. Heap/thread dump discipline still matters.

### Java 25

1. Modern runtime baseline for newer systems.
2. Security design does not fundamentally change just because runtime is newer.
3. Main concern remains library/container support and operational maturity.

Version principle:

```text
Credential security depends more on architecture and operational controls than on Java syntax version.
```

---

## 39. `javax` vs `jakarta` Credential Handling

In Java EE 8 / Jakarta EE 8 era, packages may use `javax.security.enterprise.*`.

In Jakarta EE 9+, namespace moved to `jakarta.security.enterprise.*`.

Conceptually:

```text
javax.security.enterprise.Credential
    -> jakarta.security.enterprise.Credential

javax.security.enterprise.identitystore.IdentityStore
    -> jakarta.security.enterprise.identitystore.IdentityStore

javax.security.enterprise.identitystore.CredentialValidationResult
    -> jakarta.security.enterprise.identitystore.CredentialValidationResult
```

Migration concern:

1. Imports change.
2. Container version changes.
3. Dependencies change.
4. App server behavior may differ.
5. Password hash implementations may have vendor-specific config.
6. Test all login/reset/migration flows after namespace migration.

Do not assume security behavior is identical just because code compiles.

---

## 40. Designing a Credential Boundary

A robust Jakarta app should have a narrow credential boundary.

Example package structure:

```text
com.example.security.authentication
  LoginAuthenticationMechanism
  ApplicationIdentityStore
  CredentialAuditService
  LoginAttemptService
  PasswordService
  PasswordPolicyService
  PasswordResetService
  ApiKeyService
  TokenCredentialValidator

com.example.identity
  UserAccount
  UserRepository
  AccountStatus
  GroupResolver

com.example.authorization
  PermissionService
  RoleMapper
```

Boundary rule:

```text
Only authentication package should touch raw credentials.
```

Domain services should receive:

```java
AuthenticatedActor actor
```

not:

```java
String password
String accessToken
HttpServletRequest request
```

---

## 41. Example: Safer Password Service

Conceptual service:

```java
@ApplicationScoped
public class PasswordService {

    @Inject
    PasswordHash passwordHash;

    @Inject
    PasswordPolicyService policy;

    public PasswordVerifier createVerifier(char[] password, UserPasswordContext context) {
        policy.validateNewPassword(password, context);

        String encoded = passwordHash.generate(password);

        return new PasswordVerifier(
            encoded,
            detectAlgorithm(encoded),
            detectVersion(encoded),
            Instant.now()
        );
    }

    public PasswordVerification verify(char[] presentedPassword, PasswordVerifier verifier) {
        boolean valid = passwordHash.verify(presentedPassword, verifier.encodedHash());

        if (!valid) {
            return PasswordVerification.invalid();
        }

        boolean upgradeRequired = shouldUpgrade(verifier);

        return PasswordVerification.valid(upgradeRequired);
    }
}
```

This separates:

1. Policy validation.
2. Hash generation.
3. Verification.
4. Upgrade decision.
5. Persistence.
6. Audit.

---

## 42. Example: Password Change Flow

```java
@Transactional
public void changePassword(AuthenticatedActor actor,
                           char[] oldPassword,
                           char[] newPassword) {
    UserAccount account = users.findBySubjectId(actor.subjectId())
        .orElseThrow();

    PasswordVerification oldOk = passwordService.verify(
        oldPassword,
        account.passwordVerifier()
    );

    if (!oldOk.valid()) {
        loginAttempts.recordPasswordChangeFailure(actor.subjectId());
        throw new InvalidCredentialException();
    }

    PasswordVerifier newVerifier = passwordService.createVerifier(
        newPassword,
        UserPasswordContext.forAccount(account)
    );

    users.updatePassword(account.id(), newVerifier);
    sessions.revokeOtherSessions(account.id(), actor.sessionId());

    audit.passwordChanged(actor, account.id());
}
```

Important design points:

1. Requires authenticated actor.
2. Verifies old password.
3. Applies new password policy.
4. Updates verifier transactionally.
5. Revokes other sessions where appropriate.
6. Audits action.
7. Does not log password.

---

## 43. Example: Password Reset Flow

```java
public void requestPasswordReset(String loginIdentifier) {
    String canonical = canonicalize(loginIdentifier);

    Optional<UserAccount> account = users.findByLoginKey(canonical);

    // Always return generic success externally.
    if (account.isEmpty()) {
        audit.passwordResetRequestedForUnknownLogin(hashLoginKey(canonical));
        return;
    }

    ResetToken token = resetTokens.issueFor(account.get().id());
    notification.sendPasswordReset(account.get(), token.rawTokenOnce());

    audit.passwordResetRequested(account.get().id());
}
```

```java
@Transactional
public void completePasswordReset(String rawToken, char[] newPassword) {
    ResetTokenRecord token = resetTokens.consume(rawToken)
        .orElseThrow(() -> new InvalidResetTokenException());

    UserAccount account = users.findById(token.accountId())
        .orElseThrow();

    PasswordVerifier verifier = passwordService.createVerifier(
        newPassword,
        UserPasswordContext.forAccount(account)
    );

    users.updatePassword(account.id(), verifier);
    sessions.revokeAll(account.id());
    resetTokens.revokeAllForAccount(account.id());

    audit.passwordResetCompleted(account.id());
}
```

Key property:

```text
Reset token is one-time, purpose-bound, short-lived, and stored hashed.
```

---

## 44. Credential Failure Model

Credential systems fail in predictable ways.

### Failure 1 — Password stored with fast hash

Symptom:

```text
Database breach leads to rapid password cracking.
```

Root cause:

```text
SHA-256/MD5/plain hash used instead of password hashing/KDF.
```

Prevention:

```text
Argon2id/bcrypt/PBKDF2 with salt and parameters.
```

### Failure 2 — Password leaked in logs

Symptom:

```text
Auth endpoint logs full request body.
```

Root cause:

```text
Generic request logging enabled globally.
```

Prevention:

```text
Redaction, endpoint-specific logging exclusion, DTO toString redaction.
```

### Failure 3 — Token accepted without audience check

Symptom:

```text
Token issued for app A accepted by app B.
```

Root cause:

```text
Signature verified but semantic claims ignored.
```

Prevention:

```text
Validate issuer, audience, expiry, authorized party, algorithm, key.
```

### Failure 4 — Reset token replay

Symptom:

```text
Same reset link can be reused.
```

Root cause:

```text
Token not consumed atomically.
```

Prevention:

```text
One-time token with transactional consume.
```

### Failure 5 — Role kept after password reset/session compromise

Symptom:

```text
Attacker remains logged in after victim resets password.
```

Root cause:

```text
Password reset does not revoke sessions/tokens.
```

Prevention:

```text
Session/token revocation strategy on credential reset.
```

### Failure 6 — Account enumeration

Symptom:

```text
Attackers discover valid usernames.
```

Root cause:

```text
Different response for unknown user.
```

Prevention:

```text
Generic response, similar timing, internal-only reason.
```

### Failure 7 — API key raw storage

Symptom:

```text
Database breach exposes all active API keys.
```

Root cause:

```text
API keys stored as plaintext.
```

Prevention:

```text
Hash API key secret part; show once; support rotation.
```

---

## 45. Production Checklist

### Password storage

- [ ] No plaintext passwords.
- [ ] No reversible encrypted user passwords.
- [ ] No MD5/SHA-1/SHA-256-only password storage.
- [ ] Salt unique per password.
- [ ] Algorithm and parameters versioned/stored.
- [ ] Rehash-on-login supported.
- [ ] Legacy verifier retirement plan exists.

### Credential transport

- [ ] Login only over HTTPS.
- [ ] Credentials never sent in query string.
- [ ] Authorization and Cookie headers redacted.
- [ ] Request body logging disabled/redacted for auth endpoints.
- [ ] TLS termination boundary understood.

### Password policy

- [ ] Minimum length enforced.
- [ ] Long passwords allowed.
- [ ] Common/compromised password blocklist used where possible.
- [ ] No silent truncation.
- [ ] Password manager friendly.
- [ ] Policy documented.

### Login protection

- [ ] Rate limit by account/IP/client.
- [ ] Failed attempts audited.
- [ ] Enumeration minimized.
- [ ] Lockout/progressive delay designed against DoS.
- [ ] Credential stuffing detection considered.

### Reset/change

- [ ] Reset tokens high entropy.
- [ ] Reset tokens one-time use.
- [ ] Reset tokens short-lived.
- [ ] Reset tokens stored hashed.
- [ ] Password reset revokes sessions/tokens as required.
- [ ] Password change requires old password or recent reauth.

### Token/API key

- [ ] API keys stored hashed.
- [ ] API key prefix used for lookup.
- [ ] API key rotation/revocation supported.
- [ ] Bearer tokens not logged.
- [ ] JWT validation includes issuer/audience/expiry/signature/algorithm.
- [ ] Refresh tokens protected and rotated where possible.

### Memory/operations

- [ ] Heap dumps treated as secrets.
- [ ] APM does not capture credentials.
- [ ] DTO `toString()` redacts credentials.
- [ ] Sensitive arrays cleared where practical.
- [ ] Secrets managed through secret manager/KMS, not source code.

---

## 46. Design Heuristics

Use these heuristics when reviewing a Jakarta authentication system.

### Heuristic 1 — Raw credential has the smallest possible scope

Bad:

```text
Controller -> Service -> Repository -> Event -> Log
```

Good:

```text
Authentication mechanism / identity store only
```

### Heuristic 2 — Credential verification returns identity result, not business user object with secrets

Bad:

```java
User user = authService.login(username, password);
```

Better:

```java
CredentialValidationResult result = identityStore.validate(credential);
```

or domain-level:

```java
AuthenticationResult result = authenticator.authenticate(command);
```

### Heuristic 3 — Public error is generic, internal audit is precise

```text
Public: invalid credentials
Internal: bad password / disabled / locked / unknown login
```

### Heuristic 4 — Stored verifier is self-describing

```text
algorithm + params + salt + hash + version
```

### Heuristic 5 — Reset flow is treated as credential issuance

Reset password is not customer support convenience. It is a privileged authentication path.

### Heuristic 6 — Token is not identity until validated

Decoded JWT is just untrusted JSON until validated.

### Heuristic 7 — API key is a password for machines

Treat it with password-like storage and rotation.

---

## 47. Common Anti-Patterns

### Anti-pattern 1 — Plain `String password` everywhere

```java
public User login(String username, String password)
```

Risk:

1. Password leaks across layers.
2. Password appears in logs/debuggers.
3. No lifecycle boundary.

### Anti-pattern 2 — Password in audit trail

```json
{
  "activity": "LOGIN",
  "request": {"username":"alice", "password":"secret"}
}
```

Audit system becomes credential breach system.

### Anti-pattern 3 — Hashing password with SHA-256

```java
MessageDigest.getInstance("SHA-256").digest(password.getBytes())
```

This is fast hash, not password storage.

### Anti-pattern 4 — Storing JWT in localStorage for high-risk browser app

Risk:

1. XSS steals token.
2. Bearer replay.
3. Hard logout/revocation semantics.

For browser apps, consider session/BFF depending on architecture.

### Anti-pattern 5 — Accepting any valid JWT from trusted issuer

Bad validation:

```text
signature valid? ok
```

Required semantic validation:

```text
issuer, audience, expiry, nbf, algorithm, key, client, scope, tenant
```

### Anti-pattern 6 — Logging `HttpServletRequest` wholesale

Can log headers/cookies/body.

### Anti-pattern 7 — Password reset token not consumed atomically

Race condition can allow reuse.

### Anti-pattern 8 — Admin can view user password

If admin can view password, password is stored reversibly/plaintext. That is a severe design flaw.

---

## 48. Mini Reference Architecture

```text
[Browser]
   |
   | POST /login username/password over TLS
   v
[Jakarta Web Container]
   |
   | HttpAuthenticationMechanism extracts credential
   v
[ApplicationIdentityStore]
   |
   | canonicalize login key
   | lookup account
   | verify password hash
   | check account status
   | record failed/success attempt
   v
[CredentialValidationResult]
   |
   | principal = stable subject id
   | groups = application security groups
   v
[Container Security Context]
   |
   | create/regenerate session
   | expose SecurityContext
   v
[Application Services]
   |
   | use AuthenticatedActor, not raw credential
   v
[Authorization Service]
   |
   | role/domain permission/state/tenant checks
   v
[Audit]
   |
   | auth event without credential material
```

Credential should disappear after authentication. Identity and authorization context remain.

---

## 49. What A Top 1% Engineer Notices

A shallow implementation asks:

```text
How do I check password equals hash?
```

A stronger engineer asks:

```text
Where is the raw credential accepted?
Where is it copied?
Can it appear in logs?
Can it appear in heap dumps?
How is password reset protected?
How are old hashes migrated?
How are API keys stored?
How are bearer tokens validated semantically?
What sessions/tokens survive after credential reset?
How do we audit without leaking secrets?
How do we rotate algorithms, pepper, keys, and client secrets?
What happens when identity store is down?
What happens under brute force or credential stuffing?
```

That is the difference between implementing login and engineering an authentication system.

---

## 50. Summary

Credential handling in Jakarta applications is a boundary problem.

The key model:

```text
Credential is evidence.
Authentication validates evidence.
CredentialValidationResult establishes caller identity.
Container exposes security context.
Application performs authorization.
Audit records facts without secrets.
```

Password storage is important, but not enough. A mature credential system also includes:

1. Transport protection.
2. Narrow credential lifetime.
3. Strong password verifier storage.
4. Safe reset/change flows.
5. Token/API key handling.
6. Logging redaction.
7. Rate limiting.
8. Account enumeration resistance.
9. Migration strategy.
10. Rotation strategy.
11. Session revocation.
12. Auditability.
13. Failure modelling.

---

## 51. References

Official and authoritative references used as baseline for this part:

1. Jakarta Security 4.0 Specification — https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
2. Jakarta Security 4.0 API — https://jakarta.ee/specifications/security/4.0/apidocs/
3. Jakarta Security 4.0 Release Page — https://jakarta.ee/specifications/security/4.0/
4. Jakarta Authentication 3.1 Specification — https://jakarta.ee/specifications/authentication/3.1/
5. OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
6. OWASP Cryptographic Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
7. NIST SP 800-63B Digital Identity Guidelines — https://pages.nist.gov/800-63-4/sp800-63b.html
8. Oracle WebLogic Jakarta Security Documentation — https://docs.oracle.com/en/middleware/standalone/weblogic-server/15.1.1/scprg/sec-api.html

---

## 52. Status Seri

Selesai:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
Part 06 — Jakarta Security API Core
Part 07 — SecurityContext Deep Dive
Part 08 — IdentityStore Deep Dive
Part 09 — Credentials and Password Handling in Jakarta Applications
```

Berikutnya:

```text
Part 10 — Jakarta Authentication / JASPIC Deep Dive
```

Seri belum selesai. Ini baru Part 09 dari 35.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 08 — IdentityStore Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-08-identitystore-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 10 — Jakarta Authentication / JASPIC Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-10-jakarta-authentication-jaspic-deep-dive.md)
