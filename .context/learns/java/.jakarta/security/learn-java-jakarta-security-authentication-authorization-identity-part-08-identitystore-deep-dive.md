# Part 08 — IdentityStore Deep Dive

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-08-identitystore-deep-dive.md`  
> Target: Java 8–25, Java EE / Jakarta EE, Servlet/JAX-RS/CDI/EJB-based enterprise applications  
> Posisi seri: Part 08 dari 35

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas `SecurityContext` sebagai titik akses application code terhadap identity/security decision. Sekarang kita turun ke komponen yang sering menjadi sumber bug paling mahal dalam authentication: **IdentityStore**.

Kalau `HttpAuthenticationMechanism` adalah komponen yang **mengambil credential dari request**, maka `IdentityStore` adalah komponen yang **memvalidasi credential dan/atau menyediakan group untuk caller**.

Secara sederhana:

```text
HTTP Request
   |
   |-- cookie / Authorization header / form body / client cert / token
   v
HttpAuthenticationMechanism
   |
   |-- extract credential
   v
IdentityStore
   |
   |-- validate credential
   |-- produce caller principal
   |-- produce groups
   v
Container security identity
   |
   |-- getUserPrincipal()
   |-- isUserInRole()
   |-- @RolesAllowed
   |-- SecurityContext
```

Namun mental model seperti itu masih terlalu sederhana. Dalam sistem enterprise, `IdentityStore` dapat menjadi:

1. wrapper database user table,
2. LDAP/Active Directory lookup,
3. external identity provider adapter,
4. group provider,
5. account status resolver,
6. credential migration layer,
7. compatibility layer dari legacy authentication,
8. caching boundary,
9. risk scoring hook,
10. tempat bug authentication paling mudah menyamar sebagai “authorization issue”.

Part ini akan membedahnya dari level API, desain, lifecycle, failure semantics, sampai pattern produksi.

---

## 1. Core Mental Model: IdentityStore Bukan “User Repository” Biasa

Banyak developer melihat `IdentityStore` seperti repository biasa:

```java
User user = userRepository.findByUsername(username);
if (passwordMatches(password, user.passwordHash())) {
    return valid(user);
}
```

Itu belum salah, tetapi belum cukup.

`IdentityStore` berada di jalur authentication container. Artinya, output-nya bukan sekadar data user, tetapi **security identity** yang akan dipakai oleh container untuk:

1. menetapkan caller principal,
2. menetapkan group membership,
3. melakukan role check,
4. mengisi `HttpServletRequest#getUserPrincipal()`,
5. mengisi `SecurityContext#getCallerPrincipal()`,
6. mempengaruhi `isUserInRole()`,
7. mempengaruhi `@RolesAllowed`,
8. menjadi dasar audit login,
9. menjadi dasar session identity,
10. menjadi referensi actor di application layer.

Jadi `IdentityStore` bukan sekadar:

```text
username + password -> true/false
```

Melainkan:

```text
credential + context -> authentication result + principal + groups + semantics
```

Perhatikan kata **semantics**. Dua kondisi ini tidak boleh diperlakukan sama:

```text
password salah
backend LDAP down
user tidak ditemukan
user disabled
user locked
user harus reset password
user valid tapi tidak punya group aplikasi
credential type tidak didukung oleh store ini
store ini hanya provide groups, bukan validate password
```

Bagi user, sebagian mungkin sama-sama terlihat sebagai “login failed”. Bagi sistem, audit, alerting, dan incident response, semuanya berbeda.

---

## 2. Posisi IdentityStore dalam Jakarta Security

Jakarta Security menyediakan beberapa building block utama:

```text
SecurityContext
HttpAuthenticationMechanism
IdentityStore
Credential
CredentialValidationResult
CallerPrincipal
```

Hubungannya:

```text
+-----------------------------+
| Browser / API Client        |
+-----------------------------+
              |
              v
+-----------------------------+
| HttpAuthenticationMechanism |
| - Basic                     |
| - Form                      |
| - Custom Form               |
| - OIDC                      |
| - Custom Bearer             |
+-----------------------------+
              |
              | Credential
              v
+-----------------------------+
| IdentityStore               |
| - validate credential       |
| - return caller principal   |
| - return groups             |
+-----------------------------+
              |
              | CredentialValidationResult
              v
+-----------------------------+
| Container Security Context  |
+-----------------------------+
              |
              v
+-----------------------------+
| Application Code            |
| - SecurityContext           |
| - request.getUserPrincipal  |
| - @RolesAllowed             |
+-----------------------------+
```

`IdentityStore` adalah SPI yang dipakai application untuk membuat validasi identity portable di Jakarta Security. Jakarta Security 4.0 adalah bagian dari Jakarta EE 11 dan menyediakan API untuk authentication dan identity store, termasuk enhancement seperti in-memory identity store dan multiple authentication mechanism support.

---

## 3. Interface IdentityStore: Bentuk Konseptual

Secara konseptual, `IdentityStore` memiliki tiga tanggung jawab besar:

1. menerima `Credential`,
2. memvalidasi credential,
3. mengembalikan group untuk caller.

Bentuk sederhananya:

```java
public interface IdentityStore {

    CredentialValidationResult validate(Credential credential);

    Set<String> getCallerGroups(CredentialValidationResult validationResult);

    int priority();

    Set<ValidationType> validationTypes();
}
```

Detail implementasi API dapat berbeda antar versi minor, tetapi mental modelnya stabil:

```text
validate()              -> apakah credential valid? siapa caller-nya? group awal apa?
getCallerGroups()       -> group tambahan untuk caller yang sudah valid
priority()              -> urutan store ketika ada banyak store
validationTypes()       -> store ini bisa validate, provide group, atau keduanya
```

Poin penting: `IdentityStore` tidak harus selalu melakukan validasi credential. Ia bisa hanya menyediakan group.

Contoh:

```text
Store A: validate username/password dari LDAP
Store B: provide application groups dari database lokal
```

Hasil akhirnya:

```text
LDAP says: user fajar valid
DB says: fajar has groups [CASE_OFFICER, APPROVER]
Container says: authenticated caller principal fajar with groups CASE_OFFICER, APPROVER
```

---

## 4. ValidationType: VALIDATE vs PROVIDE_GROUPS

Salah satu konsep paling penting adalah `ValidationType`.

Secara mental:

```text
VALIDATE
    Store dapat menjawab: credential ini valid atau tidak?

PROVIDE_GROUPS
    Store dapat menjawab: caller ini punya group apa?
```

Contoh store:

```text
PasswordIdentityStore
    validationTypes = VALIDATE

ApplicationRoleIdentityStore
    validationTypes = PROVIDE_GROUPS

DatabaseIdentityStore
    validationTypes = VALIDATE + PROVIDE_GROUPS

ExternalIdpIdentityStore
    validationTypes = VALIDATE

LocalGroupOverlayStore
    validationTypes = PROVIDE_GROUPS
```

Kenapa ini penting?

Karena dalam sistem enterprise, validasi identity dan pengambilan entitlement sering berasal dari sumber berbeda.

Contoh nyata:

```text
Authentication source:
    Corporate SSO / LDAP / OIDC IdP

Authorization source:
    Local application database

Reason:
    IdP tahu siapa user-nya.
    Aplikasi tahu user boleh approve case apa.
```

Kalau semua dipaksa ke satu store, desain bisa menjadi rapuh:

1. aplikasi terlalu bergantung pada struktur group IdP,
2. perubahan organisasi merusak authorization,
3. mapping role menjadi sulit diaudit,
4. tenant-specific permission sulit dimodelkan,
5. privilege bisa stale terlalu lama.

---

## 5. CredentialValidationResult: Output yang Sarat Makna

`CredentialValidationResult` bukan sekadar boolean. Ia merepresentasikan hasil validasi credential.

Secara konseptual hasilnya bisa berupa:

```text
VALID
INVALID
NOT_VALIDATED
```

Maknanya:

| Result | Makna |
|---|---|
| `VALID` | Store berhasil memvalidasi credential dan mengenali caller. |
| `INVALID` | Store memahami credential type tersebut, tetapi credential tidak valid. |
| `NOT_VALIDATED` | Store tidak menangani credential tersebut atau tidak melakukan validasi. |

Perbedaan `INVALID` dan `NOT_VALIDATED` sangat penting.

Misalnya ada multiple store:

```text
Store A: LDAP username/password
Store B: API key
Store C: token introspection
```

Jika request membawa API key, LDAP store sebaiknya tidak mengatakan `INVALID`. Ia harus mengatakan `NOT_VALIDATED`, karena credential itu bukan urusannya.

Jika LDAP store mengembalikan `INVALID` untuk credential yang bukan tipenya, maka authentication chain bisa berhenti terlalu cepat dan mekanisme lain tidak diberi kesempatan.

Mental model:

```text
INVALID       = Saya tahu credential ini untuk saya, dan credential ini salah.
NOT_VALIDATED = Saya tidak bisa/ tidak perlu memutuskan credential ini.
```

---

## 6. CallerPrincipal: Nama yang Akan Menjadi Identity Container

Saat credential valid, store mengembalikan caller principal.

Contoh:

```java
return new CredentialValidationResult(
    new CallerPrincipal("fajar"),
    Set.of("CASE_OFFICER", "APPROVER")
);
```

Di sinilah banyak desain salah.

Pertanyaan yang harus dijawab:

```text
Principal name sebaiknya apa?
```

Pilihan umum:

1. username,
2. email,
3. employee ID,
4. subject ID dari IdP,
5. internal immutable user ID,
6. composite tenant:user ID,
7. external federation ID.

Tidak ada jawaban tunggal, tetapi ada prinsip kuat:

> Principal name harus stabil, unik dalam boundary yang tepat, dan tidak mudah berubah karena atribut display.

Contoh yang rapuh:

```text
principal = email
```

Masalah:

1. email bisa berubah,
2. email bisa recycled,
3. email casing bisa berbeda,
4. email mungkin tidak unique lintas tenant,
5. personal email bisa diganti ke corporate email.

Contoh lebih stabil:

```text
principal = internalUserId
```

Atau untuk external IdP:

```text
principal = issuer + ":" + subject
```

Contoh:

```text
https://idp.company.com:00u123abc
```

Untuk aplikasi multi-tenant:

```text
principal = tenantId + ":" + immutableSubjectId
```

Namun hati-hati: active tenant sebaiknya tidak selalu menjadi bagian principal name, karena satu user bisa berpindah active tenant dalam satu session. Lebih baik pisahkan:

```text
Principal identity = immutable user identity
Active tenant      = selected organization context
```

---

## 7. Group Output: Bukan Selalu Role Final

IdentityStore dapat mengembalikan groups:

```java
Set<String> groups = Set.of("CASE_OFFICER", "APPROVER");
```

Container kemudian dapat memakai group untuk role check.

Namun group bukan selalu permission final.

Layer mapping bisa seperti ini:

```text
External group
   -> normalized group
      -> application role
         -> domain permission
            -> decision against resource/state/tenant
```

Contoh:

```text
LDAP group:
    CN=ACEAS_UAT_APPROVER,OU=Groups,DC=corp,DC=local

Normalized group:
    APPROVER

Application role:
    CASE_APPROVER

Domain permission:
    case.approve

Actual decision:
    user can approve case if:
      - role includes CASE_APPROVER
      - case.status == PENDING_APPROVAL
      - case.assignedAgency == user's active agency
      - user is not the maker
      - delegation is active
```

Kalau aplikasi langsung melakukan ini:

```java
if (securityContext.isCallerInRole("CN=ACEAS_UAT_APPROVER,OU=Groups,DC=corp,DC=local")) {
    approve(caseId);
}
```

maka business logic terikat pada struktur directory. Itu rapuh dan sulit dipertahankan.

---

## 8. Built-in Identity Stores

Jakarta Security menyediakan konsep built-in identity stores. Secara umum yang penting untuk dipahami:

1. database identity store,
2. LDAP identity store,
3. in-memory identity store,
4. custom identity store.

Jakarta Security 4.0 secara eksplisit menambahkan in-memory identity store sebagai salah satu enhancement.

### 8.1 Database Identity Store

Database identity store cocok untuk:

1. aplikasi internal dengan user lokal,
2. admin console sederhana,
3. migration dari legacy table,
4. prototype enterprise app,
5. aplikasi yang memang owner data user.

Model konseptual:

```text
USER_ACCOUNT
- id
- username
- password_hash
- status
- password_version
- failed_attempts
- locked_until
- password_changed_at

USER_GROUP
- user_id
- group_name
```

Contoh annotation konseptual:

```java
@DatabaseIdentityStoreDefinition(
    dataSourceLookup = "java:app/jdbc/securityDS",
    callerQuery = "select password_hash from user_account where username = ? and status = 'ACTIVE'",
    groupsQuery = "select group_name from user_group where username = ?",
    priority = 30
)
```

Hal penting:

1. query harus membedakan account status,
2. password hash format harus versioned,
3. group query harus stabil,
4. database identity store tidak otomatis menyelesaikan domain authorization,
5. jangan membuat query yang bisa leak informasi user lewat timing/log.

### 8.2 LDAP Identity Store

LDAP identity store cocok untuk:

1. corporate directory,
2. Active Directory integration,
3. centralized credential validation,
4. enterprise SSO legacy,
5. shared employee identity.

Model konseptual:

```text
User DN lookup
   -> bind as user / compare password
   -> retrieve group membership
   -> map LDAP groups to application groups
```

Risiko umum:

1. LDAP group terlalu noisy,
2. nested group tidak terbaca,
3. group DN berubah,
4. user rename memengaruhi DN,
5. service account password expired,
6. LDAP unavailable menyebabkan login outage,
7. referral/chasing issue,
8. TLS truststore salah,
9. bind user punya privilege berlebihan.

### 8.3 In-Memory Identity Store

In-memory identity store cocok untuk:

1. local development,
2. sample application,
3. integration test,
4. demo,
5. emergency isolated environment dengan hardening sangat terbatas.

Tidak cocok untuk production normal kecuali ada alasan sangat khusus.

Contoh risiko:

1. credential tertanam di source code,
2. password tidak bisa rotasi dinamis,
3. audit user management buruk,
4. sulit integrasi dengan account lifecycle,
5. privilege sering lupa dibersihkan setelah demo.

### 8.4 Custom Identity Store

Custom identity store dibutuhkan ketika:

1. credential berasal dari legacy system,
2. password hash format custom,
3. validasi ke external API,
4. group berasal dari local business database,
5. perlu account migration transparan,
6. perlu multi-tenant lookup,
7. perlu risk-based validation,
8. perlu combine IdP + application role.

Custom store adalah tempat yang powerful, tetapi juga tempat yang mudah menjadi god object.

Prinsip:

```text
IdentityStore should validate identity and provide groups.
It should not become the whole authorization engine.
```

---

## 9. Custom IdentityStore: Skeleton yang Benar

Contoh sederhana:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.security.enterprise.CallerPrincipal;
import jakarta.security.enterprise.credential.Credential;
import jakarta.security.enterprise.credential.UsernamePasswordCredential;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;
import jakarta.security.enterprise.identitystore.IdentityStore;

import java.util.Set;

import static jakarta.security.enterprise.identitystore.CredentialValidationResult.INVALID_RESULT;
import static jakarta.security.enterprise.identitystore.CredentialValidationResult.NOT_VALIDATED_RESULT;

@ApplicationScoped
public class ApplicationIdentityStore implements IdentityStore {

    private final UserAccountRepository users;
    private final PasswordVerifier passwordVerifier;
    private final GroupRepository groups;

    public ApplicationIdentityStore(
            UserAccountRepository users,
            PasswordVerifier passwordVerifier,
            GroupRepository groups
    ) {
        this.users = users;
        this.passwordVerifier = passwordVerifier;
        this.groups = groups;
    }

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof UsernamePasswordCredential usernamePassword)) {
            return NOT_VALIDATED_RESULT;
        }

        String username = normalizeUsername(usernamePassword.getCaller());

        UserAccount account = users.findByUsername(username)
                .orElse(null);

        if (account == null) {
            // Do not reveal user existence to caller.
            fakePasswordWork();
            return INVALID_RESULT;
        }

        if (!account.isLoginAllowed()) {
            // Externally often same as invalid; internally audit precisely.
            auditLoginBlocked(account);
            return INVALID_RESULT;
        }

        boolean passwordOk = passwordVerifier.verify(
                usernamePassword.getPasswordAsString(),
                account.passwordHash()
        );

        if (!passwordOk) {
            auditInvalidPassword(account);
            return INVALID_RESULT;
        }

        Set<String> callerGroups = groups.findSecurityGroups(account.id());

        return new CredentialValidationResult(
                new CallerPrincipal(account.stablePrincipalName()),
                callerGroups
        );
    }

    @Override
    public Set<ValidationType> validationTypes() {
        return Set.of(ValidationType.VALIDATE, ValidationType.PROVIDE_GROUPS);
    }

    @Override
    public int priority() {
        return 50;
    }

    private String normalizeUsername(String username) {
        return username == null ? "" : username.trim().toLowerCase();
    }

    private void fakePasswordWork() {
        // Optional mitigation to reduce user-enumeration timing signal.
    }

    private void auditLoginBlocked(UserAccount account) {
        // Audit internally. Do not leak exact reason to external caller.
    }

    private void auditInvalidPassword(UserAccount account) {
        // Increment counters, audit, trigger detection if needed.
    }
}
```

Perhatikan beberapa prinsip:

1. credential type yang tidak dikenali mengembalikan `NOT_VALIDATED`, bukan `INVALID`,
2. username dinormalisasi,
3. user-not-found tidak langsung leak informasi,
4. account status dicek sebelum password sukses digunakan sebagai login,
5. output principal memakai stable principal,
6. groups berasal dari repository terpisah,
7. audit internal berbeda dari error eksternal,
8. store tidak langsung melakukan domain authorization.

---

## 10. Password Verification: Boundary yang Harus Tegas

IdentityStore sering menjadi tempat password verification. Namun jangan mencampur aduk tanggung jawab.

Pisahkan:

```text
IdentityStore
    orchestrates authentication result

PasswordVerifier
    verifies password hash

PasswordPolicyService
    decides password change/reset policy

AccountLockService
    handles failed attempt and lockout

AuditService
    records authentication event
```

Contoh:

```java
public interface PasswordVerifier {
    boolean verify(String rawPassword, String storedHash);
    boolean needsRehash(String storedHash);
}
```

Kenapa `needsRehash` penting?

Karena password hash work factor berubah seiring waktu.

Contoh migration:

```text
legacy SHA-1 hash
   -> login sukses
   -> verify old hash
   -> rehash with Argon2/bcrypt/PBKDF2
   -> save new hash format
```

Pattern ini disebut opportunistic rehash.

Namun IdentityStore jangan membuat password migration tanpa transaksi dan audit yang jelas.

---

## 11. Username Normalization dan Canonical Identity

Authentication bug sering muncul dari username yang terlihat sama tetapi diperlakukan berbeda.

Contoh:

```text
Fajar
fajar
 fajar
fajar@example.com
FAJAR@example.com
fajar@EXAMPLE.com
fajar@example.com.
fájař
```

Normalization harus diputuskan secara eksplisit.

Untuk username lokal:

```text
trim
case-folding jika username case-insensitive
unicode normalization jika diperlukan
reject invisible/control characters
```

Untuk email:

```text
lowercase domain
hati-hati lowercase local-part secara teori tidak selalu valid
gunakan canonical email yang diverifikasi
jangan normalisasi Gmail-style dot/plus kecuali memang policy aplikasi
```

Untuk external IdP:

```text
issuer + subject adalah canonical identity
email hanya atribut display/contact
```

Golden rule:

> Jangan gunakan atribut yang bisa berubah sebagai primary security identity.

---

## 12. Account Status: Valid Password Tidak Selalu Berarti Login Boleh

IdentityStore harus memahami bahwa credential valid belum tentu authentication boleh selesai.

Status umum:

```text
ACTIVE
DISABLED
LOCKED
EXPIRED
PENDING_ACTIVATION
PASSWORD_RESET_REQUIRED
MFA_REQUIRED
TERMINATED
SUSPENDED
MIGRATED
MERGED
DELETED
```

Semua status ini perlu semantik.

Contoh matrix:

| Status | Password Valid? | Login Allowed? | External Message | Internal Audit |
|---|---:|---:|---|---|
| ACTIVE | yes | yes | success | login_success |
| DISABLED | maybe | no | login failed | account_disabled |
| LOCKED | maybe | no | login failed or locked | account_locked |
| PASSWORD_RESET_REQUIRED | yes | conditional | reset required | password_reset_required |
| MFA_REQUIRED | yes | not complete | continue auth | mfa_required |
| TERMINATED | maybe | no | login failed | terminated_account_login_attempt |

Jangan menyederhanakan semua menjadi `boolean valid` di domain internal. Boleh menyederhanakan output ke user, tapi jangan menyederhanakan event internal.

---

## 13. Multiple Identity Stores

Jakarta Security mendukung konsep multiple identity stores melalui priority dan validation type.

Contoh arsitektur:

```text
+--------------------------+
| LDAP Credential Store    |
| VALIDATE                 |
| priority 10              |
+--------------------------+
             |
             v
+--------------------------+
| Local Group Store        |
| PROVIDE_GROUPS           |
| priority 20              |
+--------------------------+
             |
             v
+--------------------------+
| Emergency Admin Store    |
| VALIDATE + PROVIDE_GROUPS|
| priority 100             |
+--------------------------+
```

Pertanyaan desain:

1. Jika LDAP down, apakah emergency admin boleh login?
2. Apakah local database boleh override LDAP disabled user?
3. Jika dua store mengenali username yang sama, siapa menang?
4. Apakah group dari semua store digabung?
5. Apakah `INVALID` dari satu store menghentikan chain?
6. Apakah `NOT_VALIDATED` memungkinkan store berikutnya mencoba?
7. Bagaimana audit mencatat store mana yang memvalidasi caller?

Multiple store adalah powerful tetapi harus punya rule deterministik.

Rule yang baik:

```text
For each credential type, exactly one validation authority should be authoritative.
Group enrichment may come from multiple stores, but with explicit precedence and namespace.
```

---

## 14. Priority: Jangan Mengandalkan Kebetulan

`priority()` menentukan urutan store. Jangan biarkan default tanpa sadar.

Contoh bahaya:

```text
Store A: test in-memory admin/admin
Store B: production LDAP
```

Jika Store A aktif di production dan priority lebih tinggi, maka production punya backdoor.

Checklist:

1. semua store production harus jelas priority-nya,
2. store test/dev tidak boleh masuk artifact production,
3. feature flag auth store harus fail-closed,
4. log startup harus menampilkan store aktif,
5. health endpoint internal bisa menampilkan security provider configuration secara aman,
6. integration test harus memastikan store yang expected aktif.

---

## 15. Group Provider Store

Kadang store hanya bertugas menyediakan group.

Contoh:

```java
@ApplicationScoped
public class LocalApplicationGroupStore implements IdentityStore {

    private final GroupRepository groupRepository;

    public LocalApplicationGroupStore(GroupRepository groupRepository) {
        this.groupRepository = groupRepository;
    }

    @Override
    public Set<ValidationType> validationTypes() {
        return Set.of(ValidationType.PROVIDE_GROUPS);
    }

    @Override
    public Set<String> getCallerGroups(CredentialValidationResult validationResult) {
        String principal = validationResult.getCallerPrincipal().getName();
        return groupRepository.findGroupsByPrincipal(principal);
    }

    @Override
    public int priority() {
        return 80;
    }
}
```

Use case:

```text
OIDC validates user externally.
Local DB defines application roles.
```

Ini sangat umum untuk enterprise app.

Kenapa?

Karena IdP biasanya tahu:

```text
who the user is
which corporate groups they belong to
whether account is active
```

Aplikasi tahu:

```text
which module the user can access
which agency/company/tenant they represent
which workflow action they can perform
which cases they can approve
which delegation is active
```

Jangan paksa IdP menyimpan seluruh domain permission aplikasi.

---

## 16. External IdP dan IdentityStore: Kapan Perlu?

Jika menggunakan OIDC built-in mechanism, validasi identity sering terjadi di OIDC mechanism. Lalu apakah masih butuh IdentityStore?

Jawabannya: sering iya, tetapi bukan untuk password.

IdentityStore bisa dipakai untuk:

1. local account linking,
2. group enrichment,
3. application role mapping,
4. account status overlay,
5. tenant membership lookup,
6. first-login provisioning,
7. blocked-user check,
8. audit metadata enrichment.

Contoh flow:

```text
OIDC login success:
    issuer = https://idp.example.com
    subject = abc123
    email = fajar@example.com

Local account lookup:
    external_identity(issuer, subject) -> internal_user_id

Application group lookup:
    internal_user_id -> [CASE_OFFICER, AGENCY_ADMIN]

Container identity:
    principal = internal_user_id or issuer:subject
    groups = [CASE_OFFICER, AGENCY_ADMIN]
```

Failure cases:

```text
OIDC user valid but not provisioned locally
OIDC user valid but local account disabled
OIDC email changed
OIDC subject changed due to IdP migration
User linked to wrong local account
Two local accounts linked to same external subject
```

IdentityStore atau adjacent service harus menangani ini secara eksplisit.

---

## 17. Caching IdentityStore Results

Identity lookup bisa mahal:

1. database query,
2. LDAP lookup,
3. external API call,
4. group mapping computation,
5. tenant permission load.

Caching menggoda, tetapi berbahaya jika tidak memahami freshness.

Ada beberapa level cache:

```text
Request cache
Session cache
Application cache
Distributed cache
IdP/token cache
Database query cache
```

### 17.1 Request Cache

Aman dan umum:

```text
Dalam satu request, jangan lookup group berkali-kali.
```

Risiko kecil karena lifetime pendek.

### 17.2 Session Cache

Umum untuk web app:

```text
Setelah login, principal dan group disimpan di session/container security context.
```

Risiko:

```text
role user dicabut tetapi session lama masih punya role
```

Mitigasi:

1. short idle timeout,
2. absolute session timeout,
3. session revocation list,
4. security version claim,
5. force logout on role change,
6. check critical permission live.

### 17.3 Application Cache

Misalnya cache group selama 5 menit.

Risiko:

```text
privilege remains after removal for up to TTL
```

Gunakan TTL sesuai risk.

Untuk admin privilege, TTL harus jauh lebih ketat.

### 17.4 Distributed Cache

Contoh Redis/Hazelcast/Infinispan.

Risiko tambahan:

1. stale replication,
2. cache poisoning,
3. key collision,
4. tenant leakage,
5. serialization bug,
6. insecure cache transport,
7. missing invalidation.

### 17.5 Cache Key Design

Cache key harus mencakup boundary yang benar.

Buruk:

```text
groups:fajar
```

Lebih baik:

```text
groups:v2:issuer=https://idp.example.com:sub=abc123:tenant=agency-001
```

Atau jika tenant dipilih terpisah:

```text
user-groups:v2:userId=U123
active-tenant-roles:v2:userId=U123:tenantId=T456
```

---

## 18. Freshness vs Performance

Security selalu punya trade-off:

```text
Fresh authorization data
    -> lebih aman
    -> lebih mahal
    -> lebih rentan dependency outage

Cached authorization data
    -> lebih cepat
    -> lebih resilient terhadap latency
    -> privilege bisa stale
```

Tidak semua permission butuh freshness sama.

Contoh:

| Data | Freshness Recommended | Reason |
|---|---:|---|
| User display name | long cache | low risk |
| Basic group membership | minutes/session | medium risk |
| Admin role | short/live | high risk |
| Account disabled | live or near-live | high risk |
| Case assignment | live | workflow correctness |
| Approval permission | live | segregation of duties |
| Emergency override | live + audit | high risk |

Prinsip:

> Semakin besar dampak permission, semakin fresh decision harus dibuat.

---

## 19. IdentityStore dan Domain Authorization: Jangan Dicampur

IdentityStore boleh mengembalikan group seperti:

```text
CASE_OFFICER
AGENCY_ADMIN
APPROVER
```

Tapi jangan menjadikannya tempat logic seperti:

```text
canApproveCase(caseId)
canReopenAppeal(appealId)
canAssignOfficer(caseId, officerId)
```

Kenapa?

Karena IdentityStore dipanggil dalam authentication lifecycle, bukan setiap domain action.

Domain authorization butuh data runtime:

```text
resource state
resource owner
tenant
assignment
delegation
time window
maker-checker relation
risk flag
appeal status
case lifecycle
```

IdentityStore tidak memiliki context penuh untuk itu.

Desain yang benar:

```text
IdentityStore:
    authenticate user
    provide broad application groups

AuthorizationService:
    decide whether caller can do action on resource now
```

Contoh:

```java
if (!authorizationService.canApproveCase(actor, caseId)) {
    throw new ForbiddenException("Caller is not allowed to approve this case");
}

caseService.approve(caseId, actor);
```

IdentityStore memberi `actor`, bukan seluruh decision.

---

## 20. Store Result dan Session: Apa yang Membeku?

Setelah authentication sukses, container biasanya menyimpan identity di security context/session.

Pertanyaan penting:

```text
Apakah groups di-refresh setiap request?
Atau hanya saat login?
```

Jawaban tergantung container/mechanism/configuration.

Sebagai arsitek, jangan mengandalkan asumsi samar.

Tentukan policy:

1. group loaded at login only,
2. group refreshed every request,
3. group refreshed after TTL,
4. group refreshed on sensitive action,
5. group invalidated by event.

Contoh risiko:

```text
09:00 user login sebagai APPROVER
09:15 admin mencabut role APPROVER
09:30 user masih bisa approve karena session menyimpan group lama
```

Mitigasi:

```text
security_version column on user/account
session stores security_version at login
on sensitive request compare current security_version
if changed -> force re-auth or reload groups
```

Contoh:

```java
public void ensureSecurityContextFresh(Actor actor) {
    long currentVersion = accountRepository.securityVersion(actor.userId());
    if (actor.securityVersion() != currentVersion) {
        throw new ReauthenticationRequiredException();
    }
}
```

---

## 21. Failure Semantics

IdentityStore harus membedakan failure internal meskipun output eksternal sama.

### 21.1 User Not Found

External response:

```text
Invalid username or password
```

Internal event:

```text
auth.user_not_found
```

Risk:

1. user enumeration,
2. brute force,
3. credential stuffing.

Mitigation:

1. generic error,
2. rate limiting,
3. fake password hash work,
4. audit by username/IP/device.

### 21.2 Invalid Password

External response:

```text
Invalid username or password
```

Internal event:

```text
auth.invalid_password
```

Mitigation:

1. failed attempt counter,
2. exponential backoff,
3. account lock policy,
4. detection of distributed attack.

### 21.3 Backend Unavailable

External response could be:

```text
Login temporarily unavailable
```

Internal event:

```text
auth.identity_store_unavailable
```

Important:

Do not treat backend unavailable as invalid credential.

Why?

Because it affects:

1. alerting,
2. incident response,
3. retry behavior,
4. lockout correctness,
5. user communication.

If LDAP is down and every login increments failed password counter, you create a secondary incident.

### 21.4 Ambiguous Identity

Example:

```text
two accounts with same normalized username
same external subject linked to two users
same email mapped to multiple tenants incorrectly
```

External response:

```text
Login failed
```

Internal event:

```text
auth.ambiguous_identity
```

This should usually be fail-closed.

### 21.5 Duplicate User

This is not a user problem; this is data integrity/security problem.

Mitigation:

1. unique constraints,
2. identity linking table,
3. migration validation,
4. admin remediation workflow.

---

## 22. Fail-Open vs Fail-Closed

Security systems must decide what happens when identity infrastructure fails.

Fail-open:

```text
If identity store unavailable, allow access.
```

Fail-closed:

```text
If identity store unavailable, deny login/access.
```

For authentication, default should be fail-closed.

But there are nuanced cases:

```text
Existing session remains valid if group store temporarily down.
New login denied if credential store down.
Emergency break-glass account allowed through separate hardened store.
Read-only cached access allowed for low-risk module.
High-risk admin action requires live check.
```

Do not encode this implicitly. Write it as policy.

Example policy:

```text
New authentication:
    credential validation store unavailable -> deny login

Existing session:
    if user already authenticated and session not expired -> allow low-risk navigation
    sensitive action -> require live authorization freshness

Admin action:
    require live account status + live role check

Break-glass:
    separate credential store, hardware/MFA protected, audited, time-boxed
```

---

## 23. Account Lockout and Rate Limiting

IdentityStore often participates in failed attempt handling.

Naive pattern:

```java
if (!passwordOk) {
    account.failedAttempts++;
}
```

Problems:

1. user-not-found not tracked,
2. distributed attack bypasses per-account limit,
3. attacker can lock victim account,
4. backend outage can lock everyone,
5. race condition increments incorrectly,
6. no IP/device/user-agent dimension,
7. no reset after successful login.

Better model:

```text
Rate limit dimensions:
    username
    IP address
    device fingerprint if available
    tenant
    credential type
    endpoint

Lockout policy:
    account-level for repeated invalid password
    IP-level for distributed spray
    tenant-level alert for broad attack
    temporary lock with admin/unlock policy
```

IdentityStore should not necessarily own all rate limiting. It can emit events to a security service.

---

## 24. IdentityStore Observability

Authentication problems are hard to debug if IdentityStore is silent.

Log/audit should answer:

```text
which authentication mechanism ran?
which identity store attempted validation?
which credential type was presented?
what was the result category?
which principal was established?
which groups were returned?
how long did validation take?
was data served from cache?
which downstream dependency was called?
```

Do not log:

```text
raw password
token value
Authorization header
session ID
full credential secret
private key
sensitive personal data unnecessarily
```

Structured event example:

```json
{
  "event": "auth.identity_store.validation",
  "requestId": "req-123",
  "mechanism": "FORM",
  "store": "ApplicationIdentityStore",
  "credentialType": "UsernamePasswordCredential",
  "result": "VALID",
  "principal": "U123456",
  "groupsCount": 3,
  "cache": "MISS",
  "durationMs": 42
}
```

For invalid login:

```json
{
  "event": "auth.login.failed",
  "requestId": "req-124",
  "mechanism": "FORM",
  "store": "ApplicationIdentityStore",
  "credentialType": "UsernamePasswordCredential",
  "result": "INVALID",
  "reasonCategory": "INVALID_PASSWORD",
  "usernameHash": "sha256:...",
  "ip": "203.0.113.10",
  "durationMs": 38
}
```

Hash username in logs if user enumeration/privacy risk is high.

---

## 25. Database Schema Design for Local Identity Store

A robust local identity schema separates account, credential, group, external identity, and audit.

Example:

```sql
create table security_user (
    id                  varchar2(64) primary key,
    username            varchar2(255) not null,
    normalized_username varchar2(255) not null,
    display_name        varchar2(255),
    email               varchar2(255),
    status              varchar2(40) not null,
    security_version    number not null,
    created_at          timestamp not null,
    updated_at          timestamp not null,
    constraint uq_security_user_username unique (normalized_username)
);

create table security_credential_password (
    user_id             varchar2(64) primary key,
    password_hash       varchar2(1000) not null,
    hash_algorithm      varchar2(100) not null,
    password_version    number not null,
    password_changed_at timestamp not null,
    constraint fk_cred_user foreign key (user_id) references security_user(id)
);

create table security_group_membership (
    user_id             varchar2(64) not null,
    group_name          varchar2(100) not null,
    source              varchar2(50) not null,
    valid_from          timestamp,
    valid_until         timestamp,
    primary key (user_id, group_name, source),
    constraint fk_group_user foreign key (user_id) references security_user(id)
);

create table security_external_identity (
    id                  varchar2(64) primary key,
    user_id             varchar2(64) not null,
    issuer              varchar2(500) not null,
    subject             varchar2(500) not null,
    created_at          timestamp not null,
    updated_at          timestamp not null,
    constraint uq_ext_identity unique (issuer, subject),
    constraint fk_ext_user foreign key (user_id) references security_user(id)
);
```

Notes:

1. `security_version` helps session invalidation,
2. external identity uses issuer+subject,
3. group has source,
4. group can be time-bound,
5. password credential is separated,
6. user status is explicit.

---

## 26. Role/Group Namespacing

Group names should avoid collision.

Bad:

```text
ADMIN
USER
APPROVER
```

Better:

```text
APP_CASE_OFFICER
APP_CASE_APPROVER
APP_SYSTEM_ADMIN
TENANT_ADMIN
REPORT_VIEWER
```

For multi-source groups:

```text
LDAP:CN=ACEAS_APPROVER
OIDC:realm:admin
LOCAL:CASE_APPROVER
```

Normalize into application groups:

```text
CASE_APPROVER
SYSTEM_ADMIN
```

Do not let arbitrary external group strings become direct application role names without mapping.

---

## 27. IdentityStore and Tenant-Aware Authentication

In multi-tenant applications, authentication and tenant selection are separate but related.

Pattern A: tenant chosen before login

```text
https://agency-a.example.com/login
```

Flow:

```text
subdomain -> tenantId
credential validated within tenant
principal established
```

Risk:

```text
same username across tenants
wrong tenant in login form
```

Pattern B: tenant chosen after login

```text
login as global user
show organization switcher
select active tenant
```

Flow:

```text
external identity -> user
user memberships -> list tenants
active tenant stored in session
authorization uses active tenant
```

Risk:

```text
active tenant spoofing
stale membership
cross-tenant data leak
```

Pattern C: token contains tenant claim

```text
access_token.tenant_id = agency-a
```

Risk:

```text
token tenant claim trusted without local membership check
```

Recommended model:

```text
IdentityStore establishes user identity.
TenantMembershipService establishes allowed tenant context.
AuthorizationService uses actor + activeTenant + resource.
```

---

## 28. Java 8–25 Considerations

IdentityStore code itself is mostly Jakarta API-level, but runtime era matters.

### Java 8

Common environment:

```text
Java EE 8
javax.security.enterprise
older application servers
JAAS/JASPIC/JACC naming
limited modern language features
```

Concern:

1. no records,
2. no pattern matching,
3. older TLS defaults,
4. older app server support,
5. weaker default crypto policies historically depending distribution/update,
6. old dependency versions.

### Java 11/17

Common migration target:

```text
Jakarta EE 9/10 era
namespace migration pressure
modern TLS support
LTS runtime stability
```

Concern:

1. `javax` to `jakarta`,
2. container compatibility,
3. dependency split,
4. test migration.

### Java 21

Common modern enterprise baseline:

```text
virtual threads available
records/sealed classes/pattern matching mature enough for domain models
modern GC/runtime
```

Concern:

1. context propagation with virtual threads,
2. ThreadLocal assumptions,
3. executor behavior,
4. security context lifecycle.

### Java 25

Modern/current generation runtime:

```text
newer platform baseline
Jakarta EE support depends on container readiness
```

Concern:

1. app server support matrix,
2. library bytecode compatibility,
3. observability agents,
4. security provider behavior,
5. production support policy.

Rule:

> IdentityStore design should be portable, but deployment reality depends on container + Jakarta EE version + Java runtime support matrix.

---

## 29. Testing IdentityStore

### 29.1 Unit Test

Test pure behavior:

```text
valid username/password -> VALID with expected principal/groups
wrong password -> INVALID
unknown user -> INVALID
unsupported credential -> NOT_VALIDATED
disabled user -> INVALID with audit event
locked user -> INVALID with audit event
backend exception -> fail-closed with correct event
```

Example pseudo-test:

```java
@Test
void unsupportedCredentialReturnsNotValidated() {
    IdentityStore store = new ApplicationIdentityStore(users, verifier, groups);

    CredentialValidationResult result = store.validate(new BearerTokenCredential("abc"));

    assertEquals(CredentialValidationResult.Status.NOT_VALIDATED, result.getStatus());
}
```

### 29.2 Integration Test

Test with container:

```text
form login creates principal
groups visible through SecurityContext
@RolesAllowed works
logout clears principal
session role refresh policy behaves as expected
```

### 29.3 Negative Test

Security needs negative tests:

```text
user without role cannot access protected endpoint
disabled user cannot login even with correct password
locked user cannot login
role removal invalidates sensitive action
unsupported credential does not accidentally authenticate
```

### 29.4 Performance Test

Authentication path can become bottleneck.

Measure:

```text
p50/p95/p99 validation latency
DB query count per login
LDAP call count
cache hit ratio
group lookup size
lock contention
connection pool pressure
```

---

## 30. Common Anti-Patterns

### Anti-Pattern 1: IdentityStore as God Service

Bad:

```text
IdentityStore validates password,
loads user profile,
loads all permissions,
checks case assignment,
updates last login,
sends email,
handles audit,
creates session metadata,
calls external workflow engine.
```

Better:

```text
IdentityStore orchestrates minimal authentication.
Specialized services handle supporting responsibilities.
```

### Anti-Pattern 2: Role Names Directly from LDAP

Bad:

```java
return new CredentialValidationResult(principal, ldapGroupDns);
```

Better:

```java
Set<String> appGroups = roleMapper.map(ldapGroupDns);
return new CredentialValidationResult(principal, appGroups);
```

### Anti-Pattern 3: `INVALID` for Unsupported Credential

Bad:

```java
if (!(credential instanceof UsernamePasswordCredential)) {
    return INVALID_RESULT;
}
```

Better:

```java
if (!(credential instanceof UsernamePasswordCredential)) {
    return NOT_VALIDATED_RESULT;
}
```

### Anti-Pattern 4: Email as Permanent Principal

Bad:

```text
principal = email
```

Better:

```text
principal = immutable user id or issuer:subject
```

### Anti-Pattern 5: Cache Forever

Bad:

```text
groups cached until application restart
```

Better:

```text
groups cached with TTL + security_version invalidation
```

### Anti-Pattern 6: User-Friendly Error Internally

Bad:

```text
internal audit: login failed
```

Better:

```text
external: login failed
internal: invalid_password / disabled_user / backend_unavailable / ambiguous_identity
```

---

## 31. Production Design Checklist

IdentityStore checklist:

```text
[ ] Credential types are explicitly handled.
[ ] Unsupported credential returns NOT_VALIDATED.
[ ] Invalid credential returns INVALID.
[ ] Backend unavailable is distinguishable internally.
[ ] Principal name is stable and unique.
[ ] External identity uses issuer + subject.
[ ] Email is not treated as immutable security identity.
[ ] Account status is explicit.
[ ] Disabled/locked/terminated users fail closed.
[ ] Group names are normalized.
[ ] External groups are mapped, not blindly trusted.
[ ] Multiple stores have explicit priority.
[ ] Test/dev stores are impossible in production artifact/config.
[ ] Caching policy is documented.
[ ] High-risk permissions are not stale for too long.
[ ] Audit events distinguish failure categories.
[ ] Raw credentials are never logged.
[ ] Password verification is delegated to dedicated component.
[ ] Hash migration is versioned and audited.
[ ] Rate limiting is coordinated outside or around store.
[ ] IdentityStore does not become domain authorization engine.
[ ] Integration tests verify SecurityContext and @RolesAllowed behavior.
[ ] Container-specific behavior is documented.
```

---

## 32. Debugging Checklist

When login succeeds but `@RolesAllowed` fails:

```text
[ ] Did IdentityStore return groups?
[ ] Are group names equal to declared application roles?
[ ] Is there role mapping in web.xml/application server?
[ ] Is @DeclareRoles configured if needed?
[ ] Is the secured method invoked through container/proxy?
[ ] Is JAX-RS using Jakarta Security or its own context?
[ ] Is the request actually authenticated?
[ ] Is session old/stale?
[ ] Are multiple stores overriding/omitting groups?
```

When login always fails:

```text
[ ] Is authentication mechanism active?
[ ] Is credential type what IdentityStore expects?
[ ] Is store discovered as CDI bean?
[ ] Is validationTypes() correct?
[ ] Is priority causing another store to decide first?
[ ] Is DB/LDAP reachable?
[ ] Are password hash formats compatible?
[ ] Is username normalization mismatching stored value?
[ ] Is account status blocking login?
[ ] Are exceptions swallowed into INVALID?
```

When roles are stale:

```text
[ ] Are groups cached in session?
[ ] Does container refresh groups?
[ ] Is there a security_version check?
[ ] Are role changes invalidating sessions?
[ ] Is distributed cache invalidated?
[ ] Are multiple nodes using different cache state?
```

---

## 33. Design Example: Enterprise Case Management Application

Suppose kita punya aplikasi case management regulatory.

Requirements:

```text
Users authenticate through corporate OIDC.
Application roles are maintained locally.
Users can belong to multiple agencies.
Approver cannot approve their own submitted case.
Role changes must take effect within 5 minutes.
Admin role changes must take effect immediately.
Audit must explain authentication and authorization decisions.
```

Recommended design:

```text
OIDC Authentication Mechanism
    validates external identity

ExternalIdentityLinkService
    issuer+subject -> internal user id

IdentityStore / Group Provider
    internal user id -> broad app groups

TenantMembershipService
    user id -> agencies/organizations

SecurityVersionService
    detects role/account changes

AuthorizationService
    evaluates domain action against case state/tenant/actor

AuditService
    records authn/authz events
```

Flow:

```text
1. User redirected to IdP.
2. IdP returns authorization code.
3. OIDC mechanism validates tokens.
4. Application maps issuer+subject to internal user.
5. IdentityStore provides groups: CASE_OFFICER, CASE_APPROVER.
6. User selects active agency.
7. Session stores actor snapshot + security_version.
8. User opens case.
9. AuthorizationService checks:
      - group includes CASE_APPROVER
      - active agency matches case agency
      - case status is PENDING_APPROVAL
      - user is not maker
      - delegation is active if acting on behalf
      - security_version is still current for high-risk action
10. Audit records actor, action, resource, decision, reason.
```

IdentityStore role:

```text
Provide who the user is and broad groups.
Do not decide canApproveCase directly.
```

---

## 34. Key Takeaways

1. `IdentityStore` is not just a user repository.
2. It is part of container authentication lifecycle.
3. Its output becomes caller principal and groups.
4. `VALID`, `INVALID`, and `NOT_VALIDATED` have different semantics.
5. `VALIDATE` and `PROVIDE_GROUPS` allow authentication and group enrichment to be separated.
6. Principal name must be stable, unique, and not based on mutable display attributes.
7. External groups should be mapped into application groups.
8. IdentityStore should not become domain authorization engine.
9. Caching must balance performance and privilege freshness.
10. Backend unavailable is not the same as invalid credential.
11. Multiple stores require deterministic priority and failure semantics.
12. Observability and audit are first-class requirements.
13. The hardest bugs usually happen at the seam between authentication success and authorization expectation.

---

## 35. Mental Model Akhir

Pegang model ini:

```text
Credential answers:
    What proof is presented?

IdentityStore answers:
    Is the proof valid?
    Who is the caller?
    What broad groups does the caller have?

Container answers:
    How is caller represented to app code?
    How do role checks work?

AuthorizationService answers:
    Can this actor perform this action on this resource now?

Audit answers:
    Who attempted what, under which identity, with what result, and why?
```

Jika lima pertanyaan ini dicampur dalam satu kelas, sistem akan cepat sulit dipahami.

Jika lima pertanyaan ini dipisah dengan boundary yang jelas, sistem menjadi lebih mudah di-debug, lebih aman, lebih portable, dan lebih defensible.

---

## 36. Posisi Seri

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
```

Berikutnya:

```text
Part 09 — Credentials and Password Handling in Jakarta Applications
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 07 — SecurityContext Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-07-securitycontext-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 09 — Credentials and Password Handling in Jakarta Applications](./learn-java-jakarta-security-authentication-authorization-identity-part-09-credentials-password-handling.md)

</div>