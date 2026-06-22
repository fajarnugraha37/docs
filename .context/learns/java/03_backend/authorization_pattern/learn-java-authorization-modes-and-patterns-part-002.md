# learn-java-authorization-modes-and-patterns-part-002

# Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Range Java: **Java 8 sampai Java 25**  
> Fokus: memahami primitive authorization bawaan platform Java, mana yang masih relevan, mana yang legacy, dan bagaimana menggunakannya dengan benar dalam desain authorization modern.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0 kita membangun mental model authorization sebagai **decision system**:

```text
Subject ingin melakukan Action terhadap Resource dalam Context tertentu.
Authorization menjawab: allow, deny, atau abstain/error, berdasarkan policy dan evidence.
```

Pada Part 1 kita membangun vocabulary:

```text
principal, subject, actor, role, permission, authority, claim, scope,
resource, action, context, policy, obligation, decision, invariant.
```

Part 2 membahas satu pertanyaan penting:

> Java sendiri punya banyak API keamanan seperti `Principal`, `Subject`, `Permission`, `Policy`, `AccessController`, `SecurityManager`, `ProtectionDomain`, JAAS, dan Jakarta Authorization. Apakah semua itu masih relevan untuk authorization modern?

Jawaban ringkasnya:

```text
Tidak semuanya.

Sebagian masih penting sebagai vocabulary dan integration point.
Sebagian historis/legacy.
Sebagian masih hidup di container Jakarta EE.
Sebagian tidak lagi cocok menjadi fondasi business authorization aplikasi modern.
```

Part ini akan membantu kita tidak membuat kesalahan umum seperti:

```java
// Salah arah untuk aplikasi modern Java 24/25
System.setSecurityManager(new SecurityManager());
```

atau:

```java
// Terlalu platform-centric untuk domain authorization
AccessController.checkPermission(new RuntimePermission("approveCase"));
```

Padahal authorization aplikasi enterprise biasanya butuh keputusan seperti:

```text
Apakah officer A boleh approve case C,
jika case C berada di agency X,
statusnya UNDER_REVIEW,
officer A bukan submitter,
dan officer A sedang acting sebagai reviewer untuk agency tersebut?
```

Model seperti itu **tidak cocok** dimasukkan langsung ke `java.security.Permission` sebagai satu-satunya mekanisme authorization.

---

## 1. Tujuan Pembelajaran

Setelah Part 2, kamu seharusnya bisa:

1. Membedakan **Java platform security** dari **application/domain authorization**.
2. Menjelaskan peran `Principal`, `Subject`, `Permission`, `Policy`, `ProtectionDomain`, `AccessController`, dan `SecurityManager`.
3. Memahami kenapa SecurityManager sudah bukan fondasi authorization modern.
4. Memahami apa dampak perubahan Java 17, 21, 24, dan 25 terhadap model security lama.
5. Menentukan kapan JAAS masih relevan dan kapan tidak.
6. Menentukan kapan Jakarta Authorization masih relevan.
7. Mendesain abstraction authorization sendiri tanpa melawan idiom Java ecosystem.
8. Membuat compatibility strategy untuk Java 8 sampai 25.
9. Menghindari jebakan legacy API yang tampak “security-ish” tapi tidak menyelesaikan business authorization.

---

## 2. Mental Model: Platform Authorization vs Application Authorization

Ada dua lapisan authorization yang harus dipisahkan.

### 2.1 Platform Authorization

Platform authorization menjawab pertanyaan seperti:

```text
Apakah code ini boleh membaca file tertentu?
Apakah library ini boleh membuka socket?
Apakah class ini boleh menggunakan reflection?
Apakah code dari protection domain ini boleh mengakses system property?
```

Ini historisnya domain `java.security`:

```text
CodeSource
ProtectionDomain
Permission
Policy
AccessControlContext
AccessController
SecurityManager
```

Fokusnya bukan “user Fajar boleh approve case?”, tetapi:

```text
Code dengan origin/signature tertentu boleh melakukan operation JVM/OS tertentu atau tidak.
```

### 2.2 Application Authorization

Application authorization menjawab pertanyaan seperti:

```text
Apakah user ini boleh melihat case ini?
Apakah reviewer ini boleh approve transition ini?
Apakah agency admin ini boleh export report untuk agency lain?
Apakah service account ini boleh publish event untuk tenant ini?
Apakah support engineer ini boleh impersonate user dengan approval tertentu?
```

Fokusnya:

```text
business invariant + data boundary + actor intent + domain state
```

### 2.3 Perbedaan Fundamental

| Aspek | Platform Authorization | Application Authorization |
|---|---|---|
| Subjek | Code, class, protection domain, sometimes subject | User, service, actor, organization, delegated authority |
| Resource | File, socket, property, reflection, runtime capability | Case, appeal, document, report, workflow task, tenant data |
| Action | JVM/OS operation | Business operation |
| Policy | JVM policy file, permission grants | Business/security policy |
| Context | Code source, classloader, call stack | Tenant, state, assignment, role, time, risk, workflow |
| Runtime | JVM/container | Application/service/domain |
| Modern relevance | Limited/legacy except specific integration cases | Central for enterprise systems |

Top-level rule:

```text
Do not confuse Java's historical code-access security model
with modern business authorization.
```

---

## 3. Historical Context: Why Java Had These APIs

Java awalnya banyak dipakai untuk environment di mana **untrusted code** bisa dijalankan di VM yang sama:

1. Applet.
2. Web Start.
3. Plugin.
4. Extensible desktop application.
5. Container/plugin sandbox.
6. Server runtime yang ingin membatasi library/plugin.

Maka Java perlu menjawab:

```text
Jika code dari origin A mencoba membaca file lokal, boleh atau tidak?
Jika plugin tidak dipercaya mencoba membuka socket, boleh atau tidak?
Jika code mencoba menggunakan reflection untuk akses private field, boleh atau tidak?
```

Dari sinilah muncul model:

```text
CodeSource -> ProtectionDomain -> Permission -> Policy -> AccessController/SecurityManager
```

Namun aplikasi server modern biasanya berjalan seperti ini:

```text
Semua code di server dianggap trusted application code.
Ancaman utama bukan untrusted bytecode,
tetapi input berbahaya, broken access control, data leakage,
misconfiguration, compromised credential, dan supply chain risk.
```

Karena itu, SecurityManager jarang menjadi alat efektif untuk business authorization server-side.

---

## 4. Big Picture Java Security Primitives

Mari lihat komponen utama.

```text
java.security.Principal
        |
javax.security.auth.Subject
        |
java.security.Permission
        |
java.security.Policy
        |
java.security.ProtectionDomain
        |
java.security.AccessControlContext
        |
java.security.AccessController
        |
java.lang.SecurityManager
```

Tidak semuanya berada di level yang sama.

| Primitive | Level | Masih relevan? | Catatan |
|---|---:|---:|---|
| `Principal` | identity abstraction | Ya | Masih umum di Java/Jakarta/security APIs |
| `Subject` | authenticated entity with principals/credentials | Terbatas | Masih relevan untuk JAAS/integration, bukan domain model utama |
| `Permission` | operation capability | Terbatas | Berguna untuk platform/container, kurang cocok untuk domain rich authorization |
| `Policy` | grants permissions | Legacy/terbatas | System-wide policy tidak cocok untuk modern app authz |
| `ProtectionDomain` | code identity/security domain | Mostly platform | Berguna untuk understanding classloader/security model |
| `AccessControlContext` | call context permissions | Legacy | Erat dengan SecurityManager |
| `AccessController` | check/do privileged | Legacy | Fitur access control lama sudah tidak menjadi jalur modern |
| `SecurityManager` | runtime enforcement | Tidak untuk desain baru | Deprecated for removal, disabled mulai JDK 24 |

---

## 5. `Principal`: Primitive Yang Masih Penting

### 5.1 Apa Itu `Principal`?

`java.security.Principal` adalah interface sederhana:

```java
public interface Principal {
    String getName();
}
```

Mental model:

```text
Principal adalah representasi nama/identitas yang dikenali sistem.
```

Contoh principal:

```text
username: fajar
user id: user-123
service account: svc-report-exporter
certificate subject: CN=service-a
Kerberos principal: user@REALM
OIDC subject: 248289761001
role principal: ADMIN
```

### 5.2 Principal Bukan Authorization Decision

Kesalahan umum:

```text
Principal ada -> user authorized.
```

Yang benar:

```text
Principal adalah evidence/input untuk authorization,
bukan decision authorization itu sendiri.
```

Contoh buruk:

```java
boolean canApprove(Principal principal) {
    return principal != null;
}
```

Contoh lebih baik:

```java
boolean canApprove(UserPrincipal user, CaseRecord caseRecord) {
    return user.hasPermission("case.approve")
        && caseRecord.isAssignedReviewer(user.userId())
        && caseRecord.status() == CaseStatus.UNDER_REVIEW
        && !caseRecord.submittedBy().equals(user.userId());
}
```

### 5.3 Principal Dalam Java Ecosystem

`Principal` muncul di banyak tempat:

```java
HttpServletRequest.getUserPrincipal()
```

```java
SecurityContext.getUserPrincipal() // JAX-RS/Jakarta REST
```

```java
Authentication.getPrincipal() // Spring Security, secara konseptual
```

```java
Subject.getPrincipals() // JAAS
```

### 5.4 Principal Design Dalam Aplikasi Modern

Jangan hanya menyimpan `String name` jika domain butuh lebih presisi.

Contoh Java 8-compatible:

```java
public final class AuthenticatedUser implements Principal {
    private final String userId;
    private final String username;
    private final String displayName;
    private final String identityProvider;

    public AuthenticatedUser(
            String userId,
            String username,
            String displayName,
            String identityProvider
    ) {
        if (userId == null || userId.isEmpty()) {
            throw new IllegalArgumentException("userId must not be empty");
        }
        this.userId = userId;
        this.username = username;
        this.displayName = displayName;
        this.identityProvider = identityProvider;
    }

    @Override
    public String getName() {
        return username;
    }

    public String userId() {
        return userId;
    }

    public String username() {
        return username;
    }

    public String displayName() {
        return displayName;
    }

    public String identityProvider() {
        return identityProvider;
    }
}
```

Java 16+ bisa memakai record:

```java
public record AuthenticatedUser(
        String userId,
        String username,
        String displayName,
        String identityProvider
) implements Principal {

    public AuthenticatedUser {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId must not be blank");
        }
    }

    @Override
    public String getName() {
        return username;
    }
}
```

### 5.5 Principal Pitfalls

#### Pitfall 1 — Menggunakan Display Name Sebagai Identity

Buruk:

```java
if (principal.getName().equals(caseRecord.getOwnerName())) {
    allow();
}
```

Masalah:

1. Display name bisa berubah.
2. Bisa tidak unique.
3. Bisa beda casing/format.
4. Bisa berasal dari IdP berbeda.

Lebih baik:

```java
if (user.userId().equals(caseRecord.ownerUserId())) {
    allow();
}
```

#### Pitfall 2 — Menganggap Principal Selalu Human User

Dalam sistem modern, principal bisa:

```text
human user
service account
batch job
scheduler
external partner system
support operator acting on behalf of user
delegated actor
```

Maka model subject harus lebih kaya daripada `Principal` tunggal.

#### Pitfall 3 — Role Sebagai Principal Tanpa Scope

Beberapa runtime mengekspresikan role sebagai principal. Ini boleh untuk integration, tapi berbahaya jika role butuh scope.

```text
Role: REVIEWER
Scope: agency = CEA
```

Jika hanya menyimpan:

```text
REVIEWER
```

maka authorization bisa bocor lintas agency.

Lebih baik:

```java
public final class ScopedRole {
    private final String role;
    private final String scopeType;
    private final String scopeId;
}
```

---

## 6. `Subject`: JAAS Entity Model

### 6.1 Apa Itu `Subject`?

`javax.security.auth.Subject` merepresentasikan entity yang sudah diautentikasi dan memiliki:

```text
principals
public credentials
private credentials
```

Secara konseptual:

```text
Subject = kumpulan identity evidence dan credential untuk satu entity.
```

Contoh:

```java
Subject subject = new Subject();
subject.getPrincipals().add(new UserPrincipal("fajar"));
subject.getPrincipals().add(new RolePrincipal("REVIEWER"));
```

### 6.2 JAAS Mental Model

JAAS adalah Java Authentication and Authorization Service.

Model utamanya:

```text
LoginModule melakukan authentication.
Jika berhasil, Subject diisi Principal/Credential.
Authorization lama bisa dilakukan berdasarkan Subject + Permission + Policy.
```

Flow sederhana:

```text
LoginContext.login()
        |
        v
LoginModule.authenticate()
        |
        v
Subject populated with Principals
        |
        v
Application/security check uses Subject
```

### 6.3 Kapan `Subject` Masih Berguna?

`Subject` masih berguna untuk:

1. Integrasi legacy JAAS.
2. Kerberos/GSSAPI environments.
3. Application server tertentu.
4. Library lama yang meminta `Subject`.
5. Bridging ke container security.
6. Menyimpan beberapa principal dari sumber berbeda.

Namun untuk aplikasi Spring Boot modern atau microservice biasa, `Subject` jarang menjadi domain model utama.

### 6.4 Kenapa `Subject` Kurang Cocok Sebagai Core Domain Authorization Model?

Karena `Subject` terlalu generic:

```java
Set<Principal> principals = subject.getPrincipals();
```

Aplikasi kemudian harus menebak:

```text
Principal mana user id?
Principal mana role?
Principal mana tenant?
Principal mana delegated actor?
Principal mana organization?
```

Ini sering menghasilkan kode rapuh:

```java
Optional<Principal> role = subject.getPrincipals()
        .stream()
        .filter(p -> p.getName().equals("ADMIN"))
        .findFirst();
```

Lebih baik subject domain dibuat eksplisit:

```java
public final class AuthorizationSubject {
    private final String subjectId;
    private final SubjectType subjectType;
    private final String tenantId;
    private final Set<ScopedRole> roles;
    private final Set<PermissionRef> permissions;
    private final Optional<DelegationContext> delegation;

    // constructor + getters
}
```

### 6.5 Subject vs Principal vs Actor

| Istilah | Makna |
|---|---|
| Principal | Identitas/nama tertentu |
| Subject | Entity security yang punya kumpulan principal/credential |
| Actor | Pihak yang melakukan aksi di domain |
| User | Human account, salah satu jenis actor |
| Service account | Non-human actor |

Contoh dalam support impersonation:

```text
Real actor: support engineer
Effective subject: customer user
Delegation/impersonation context: support session approved by ticket X
```

Jika hanya memakai `Principal`, konteks ini hilang.

---

## 7. `Permission`: Operation Capability Primitive

### 7.1 Apa Itu `Permission`?

`java.security.Permission` adalah abstract class untuk merepresentasikan hak melakukan operation tertentu.

Contoh permission bawaan:

```text
FilePermission
SocketPermission
RuntimePermission
ReflectPermission
PropertyPermission
SecurityPermission
```

Contoh:

```java
Permission p = new java.io.FilePermission("/tmp/data.txt", "read");
```

Secara historis, ini menjawab:

```text
Apakah code ini punya permission untuk melakukan operasi tertentu?
```

### 7.2 Struktur Umum Permission

Permission biasanya punya:

```text
name
actions
implies logic
```

Contoh:

```java
public final class CasePermission extends Permission {
    private final String action;

    public CasePermission(String caseId, String action) {
        super(caseId);
        this.action = action;
    }

    @Override
    public boolean implies(Permission permission) {
        if (!(permission instanceof CasePermission)) {
            return false;
        }
        CasePermission other = (CasePermission) permission;
        return getName().equals(other.getName())
            && action.equals(other.action);
    }

    @Override
    public boolean equals(Object obj) {
        if (!(obj instanceof CasePermission)) {
            return false;
        }
        CasePermission other = (CasePermission) obj;
        return getName().equals(other.getName())
            && action.equals(other.action);
    }

    @Override
    public int hashCode() {
        return 31 * getName().hashCode() + action.hashCode();
    }

    @Override
    public String getActions() {
        return action;
    }
}
```

Secara teknis bisa dibuat, tetapi ini belum tentu desain terbaik untuk authorization domain modern.

### 7.3 Masalah Permission Untuk Business Authorization

Business authorization sering membutuhkan context kaya:

```text
caseId
caseStatus
agencyId
assignedOfficerId
submitterId
currentUserId
currentUserRoles
currentTime
delegationContext
riskLevel
workflowState
```

Jika semua dimasukkan ke `Permission`, object permission menjadi tidak natural.

Contoh desain yang mulai salah arah:

```java
new CasePermission(
    caseId,
    "approve",
    agencyId,
    caseStatus,
    assignedOfficerId,
    submitterId,
    currentUserId,
    now,
    delegationContext
)
```

Itu bukan lagi permission primitive. Itu sudah menjadi authorization request.

Lebih baik:

```java
AuthorizationRequest request = AuthorizationRequest.builder()
        .subject(subject)
        .action(Action.of("case.approve"))
        .resource(ResourceRef.of("case", caseId))
        .context(context)
        .build();

PolicyDecision decision = authorizationService.decide(request);
```

### 7.4 Permission Masih Berguna Untuk Apa?

`Permission` masih berguna untuk:

1. Integrasi dengan Jakarta Authorization.
2. Container-level permission mapping.
3. Legacy Java EE/Jakarta EE authorization providers.
4. Library/plugin sandbox yang masih target Java lama.
5. Model internal sederhana jika action/resource sangat stabil.
6. Bridging ke code yang sudah memakai `java.security.Permission`.

Namun jangan jadikan `Permission` sebagai satu-satunya vocabulary untuk semua authorization enterprise.

### 7.5 Business Permission vs Java `Permission`

Penting membedakan:

```text
Business permission: case.approve
Java Permission: java.security.Permission subclass
```

Keduanya tidak harus sama.

Dalam aplikasi modern, business permission biasanya lebih baik dimodelkan sebagai value object sederhana:

```java
public final class PermissionRef {
    private final String value;

    private PermissionRef(String value) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("permission must not be empty");
        }
        this.value = value;
    }

    public static PermissionRef of(String value) {
        return new PermissionRef(value);
    }

    public String value() {
        return value;
    }
}
```

Bukan subclass `java.security.Permission`.

---

## 8. `Policy`: Grant Repository Lama

### 8.1 Apa Itu `Policy`?

`java.security.Policy` secara historis adalah sumber grant:

```text
ProtectionDomain / CodeSource / Principal diberi Permission tertentu.
```

Contoh policy file historis:

```text
grant codeBase "file:/app/plugins/-" {
    permission java.io.FilePermission "/tmp/-", "read,write";
};
```

Mental model:

```text
Policy menentukan permission apa yang diberikan kepada code/security domain tertentu.
```

### 8.2 Kenapa Tidak Cocok Untuk Authorization Modern?

Aplikasi modern butuh policy seperti:

```text
Reviewer boleh approve case hanya jika:
- case status UNDER_REVIEW,
- reviewer assigned ke case,
- reviewer bukan submitter,
- reviewer berada dalam agency yang sama,
- reviewer tidak sedang suspended,
- case belum expired,
- tidak ada conflict of interest.
```

`java.security.Policy` tidak ergonomis untuk policy seperti itu.

### 8.3 Policy API dan Java 24/25

Karena SecurityManager sudah tidak menjadi enforcement utama, system-wide Java `Policy` juga bukan lagi fondasi yang bisa diandalkan untuk desain baru. Pada JDK modern, beberapa operasi yang dulu terkait SecurityManager/Policy sudah dibatasi atau tidak supported.

Implikasi engineering:

```text
Jangan membangun business authorization baru di atas system-wide java.security.Policy.
```

Gunakan:

```text
application authorization service
Spring Security AuthorizationManager
Jakarta container authorization jika berada di Jakarta EE
external PDP/policy engine jika policy kompleks
```

---

## 9. `ProtectionDomain` dan `CodeSource`

### 9.1 Apa Itu `ProtectionDomain`?

`ProtectionDomain` mengikat code ke security metadata:

```text
CodeSource
ClassLoader
Principals
Permissions
```

Secara historis, saat code melakukan operasi sensitif, JVM bisa mengecek:

```text
Apakah semua protection domain dalam call stack memiliki permission yang dibutuhkan?
```

### 9.2 Apa Itu `CodeSource`?

`CodeSource` merepresentasikan asal code:

```text
URL lokasi code
certificate/signature
```

Contoh ide:

```text
Code dari plugin A boleh melakukan hal tertentu,
code dari plugin B tidak boleh.
```

### 9.3 Relevansi Modern

Relevansinya sekarang terbatas:

1. Understanding classloader security.
2. Plugin/runtime extension architecture.
3. Legacy sandbox design.
4. Application server internals.
5. Security analysis pada library lama.

Untuk authorization bisnis:

```text
ProtectionDomain tidak tahu apa itu case, agency, workflow state, atau tenant.
```

Maka jangan paksa domain authorization ke sini.

---

## 10. `AccessController` dan Call Stack Authorization Lama

### 10.1 Apa Itu `AccessController`?

`AccessController` dulu dipakai untuk:

```java
AccessController.checkPermission(permission);
```

atau:

```java
AccessController.doPrivileged((PrivilegedAction<Void>) () -> {
    // privileged operation
    return null;
});
```

Mental model lama:

```text
Ketika code melakukan operasi sensitif,
Java mengecek permission sepanjang call stack.
```

### 10.2 `doPrivileged` Mental Model

`doPrivileged` digunakan untuk membatasi stack inspection.

Contoh historis:

```java
String home = AccessController.doPrivileged(
        (PrivilegedAction<String>) () -> System.getProperty("user.home")
);
```

Artinya kira-kira:

```text
Library trusted ini boleh melakukan operasi privileged,
meskipun dipanggil oleh code dengan permission lebih rendah,
asalkan permission library sendiri cukup.
```

### 10.3 Kenapa Ini Berbahaya Jika Disalahpahami?

Karena ini adalah model **code privilege**, bukan user privilege.

Kesalahan konsep:

```text
User adalah admin -> jalankan doPrivileged.
```

Itu salah. `doPrivileged` bukan mekanisme “run as admin user”.

`doPrivileged` historisnya berarti:

```text
trusted code melakukan operation dengan privilege code-nya,
bukan privilege user domain business.
```

### 10.4 Relevansi Java 24/25

Karena SecurityManager sudah permanently disabled mulai JDK 24, `AccessController` tidak lagi menjadi mekanisme authorization yang relevan untuk desain baru.

Implikasi:

```text
Jangan memakai AccessController.checkPermission sebagai basis business authorization.
Jangan memakai doPrivileged sebagai konsep privilege escalation domain.
```

---

## 11. `SecurityManager`: Yang Harus Dipahami Dan Ditinggalkan Untuk Desain Baru

### 11.1 Apa Itu SecurityManager?

`SecurityManager` dulu adalah enforcement hook JVM untuk operasi sensitif:

```text
file access
socket access
classloader access
reflection
system property
process execution
exit JVM
```

Contoh historis:

```java
SecurityManager sm = System.getSecurityManager();
if (sm != null) {
    sm.checkRead("/tmp/data.txt");
}
```

atau:

```java
System.setSecurityManager(new SecurityManager());
```

### 11.2 Kenapa Dulu Penting?

Karena Java ingin menjalankan code yang mungkin tidak dipercaya:

```text
Applet dari internet
plugin pihak ketiga
script/extension
multi-tenant code dalam JVM yang sama
```

### 11.3 Kenapa Tidak Lagi Cocok?

Beberapa alasan:

1. Applet/Web Start sudah tidak menjadi model utama.
2. Server-side Java biasanya menjalankan trusted application code.
3. SecurityManager kompleks dan sulit dikonfigurasi benar.
4. Banyak library tidak didesain dengan policy granular.
5. Tidak efektif untuk banyak ancaman modern seperti SQL injection, IDOR, broken access control, SSRF, insecure deserialization, dan supply-chain compromise.
6. Overhead maintenance tinggi pada platform.
7. Banyak use case lebih baik diselesaikan dengan OS/container isolation, process isolation, sandbox eksternal, container runtime, seccomp/AppArmor, Kubernetes policy, IAM, dan application-level authorization.

### 11.4 Status Modern

Poin penting untuk Java 8–25:

```text
Java 8: SecurityManager masih aktif dan umum tersedia.
Java 11: masih ada.
Java 17: deprecated for removal melalui JEP 411.
Java 21: masih deprecated; jangan desain baru bergantung padanya.
Java 24: permanently disabled.
Java 25: tetap bukan fondasi authorization baru.
```

### 11.5 Dampak Untuk Engineer

Jika kamu maintenance legacy system Java 8/11:

```text
SecurityManager mungkin masih ada.
Pahami secukupnya untuk migration dan debugging.
```

Jika kamu membuat sistem baru:

```text
Jangan gunakan SecurityManager sebagai authorization architecture.
```

Jika kamu upgrade ke Java 24/25:

```text
Cari dependency/tooling yang masih memanggil:
- System.setSecurityManager
- Policy.setPolicy
- AccessController patterns yang mengasumsikan enforcement lama
```

### 11.6 Replacement Mindset

SecurityManager bukan diganti satu API tunggal.

Gunakan kombinasi:

```text
OS/container isolation
Kubernetes security context
filesystem permission
network policy
cloud IAM
library allowlist
module boundary
application authorization service
policy engine
runtime observability
supply chain scanning
```

Untuk business authorization:

```text
AuthorizationService / PolicyEngine / Spring AuthorizationManager / Jakarta container role checks
```

---

## 12. Java 8–25 Compatibility Map

### 12.1 Java 8

Di Java 8:

```text
SecurityManager masih normal.
JAAS masih tersedia.
No module system.
No records/sealed classes.
```

Design implication:

```text
Jika membuat library support Java 8,
gunakan class final biasa, interface sederhana, Optional dengan hati-hati,
dan jangan bergantung pada records/sealed types.
```

Authorization domain model Java 8-compatible:

```java
public interface AuthorizationPolicy {
    PolicyDecision decide(AuthorizationRequest request);
}
```

### 12.2 Java 9–11

Java 9 memperkenalkan module system.

Implikasi:

```text
Stronger encapsulation mulai menjadi tema.
Reflection access makin eksplisit.
SecurityManager masih ada, tapi module boundary mulai penting untuk code organization.
```

Authorization implication:

```text
Modularity membantu membatasi internal package,
tapi bukan pengganti authorization.
```

### 12.3 Java 17

Java 17 LTS penting karena:

```text
SecurityManager deprecated for removal.
Sealed classes tersedia.
Records stabil.
Pattern matching mulai berkembang.
```

Authorization domain model bisa lebih ekspresif:

```java
public sealed interface PolicyDecision permits Allow, Deny, NotApplicable {
}

public record Allow(String reasonCode) implements PolicyDecision {
}

public record Deny(String reasonCode) implements PolicyDecision {
}

public record NotApplicable(String reasonCode) implements PolicyDecision {
}
```

### 12.4 Java 21

Java 21 LTS membawa virtual threads.

Authorization implication:

```text
Authorization service yang melakukan blocking I/O ke PDP atau attribute store
bisa lebih scalable dengan virtual threads,
tetapi correctness, timeout, circuit breaker, dan fail-closed behavior tetap wajib.
```

Jangan salah:

```text
Virtual thread meningkatkan concurrency ergonomics,
bukan mengganti authorization design.
```

### 12.5 Java 24/25

Poin besar:

```text
SecurityManager sudah permanently disabled mulai JDK 24.
Java 25 meneruskan arah platform modern tanpa SecurityManager sebagai enforcement path.
```

Authorization implication:

```text
Business authorization harus explicit di application/container/policy layer.
Tidak bisa berharap JVM menahan operasi domain bisnis.
```

---

## 13. Java Module System: Batas Kode Bukan Batas Authorization

### 13.1 Apa Yang Diberikan Module System?

JPMS memberikan:

```text
module declaration
requires
exports
opens
strong encapsulation
service loader integration
```

Contoh:

```java
module com.example.caseapp.authorization {
    exports com.example.caseapp.authorization.api;
    exports com.example.caseapp.authorization.decision;

    requires java.base;
}
```

### 13.2 Apa Yang Tidak Diberikan?

JPMS tidak menjawab:

```text
Apakah user A boleh approve case C?
Apakah tenant X boleh melihat data tenant Y?
Apakah reviewer boleh approve own submission?
```

JPMS membatasi akses code/package, bukan akses user terhadap resource domain.

### 13.3 Module Boundary Yang Sehat Untuk Authorization

Gunakan module/package boundary untuk mencegah bypass internal.

Contoh struktur:

```text
com.example.authorization.api
com.example.authorization.model
com.example.authorization.policy
com.example.authorization.internal
```

Expose hanya API:

```java
public interface AuthorizationService {
    PolicyDecision decide(AuthorizationRequest request);
    void authorize(AuthorizationRequest request) throws AccessDeniedException;
}
```

Jangan expose internal mutability:

```text
internal role resolver
internal policy registry
internal cache mutation
internal audit publisher
```

### 13.4 Package Encapsulation Tanpa JPMS

Untuk Java 8, tetap bisa pakai package discipline:

```text
api package
internal package
architecture test
code review rule
build module separation
```

Contoh ArchUnit-style rule konseptual:

```text
Controller tidak boleh langsung akses repository authorization table.
Service harus lewat AuthorizationService.
```

---

## 14. JAAS Authorization: Relevansi Dan Batasnya

### 14.1 JAAS Bisa Authentication Dan Authorization

JAAS biasanya dikenal untuk authentication:

```text
LoginContext
LoginModule
CallbackHandler
Subject
Principal
```

Tapi model lama juga mendukung authorization berbasis `Subject` dan `Permission`.

### 14.2 Contoh Konseptual

```java
Subject subject = loginContext.getSubject();

Subject.doAs(subject, (PrivilegedAction<Void>) () -> {
    // code executed associated with subject
    return null;
});
```

Dulu bisa dikombinasikan dengan permission check.

### 14.3 Masalah Untuk Modern App

JAAS authorization:

1. Terlalu low-level.
2. Sulit mengekspresikan domain state.
3. Tidak natural untuk REST/microservice modern.
4. Tidak cocok dengan authorization yang butuh query scoping/filtering.
5. Tidak cocok untuk distributed authorization.
6. Banyak ekosistem modern memakai Spring Security/Jakarta Security/OIDC/OAuth2 abstraction sendiri.

### 14.4 Kapan Masih Dipakai?

JAAS masih bisa relevan di:

```text
Kerberos enterprise
legacy application server
JDBC driver / Hadoop / Kafka older integration tertentu
custom login module legacy
container security bridge
```

Rule:

```text
Pahami JAAS untuk integration dan migration,
tapi jangan otomatis menjadikannya authorization domain core.
```

---

## 15. Jakarta Authorization: Permission-Based Container Authorization

### 15.1 Apa Itu Jakarta Authorization?

Jakarta Authorization adalah spesifikasi yang mendefinisikan low-level SPI untuk authorization modules sebagai repository permission yang memfasilitasi subject-based security.

Model ini masih penting di Jakarta EE/container world.

### 15.2 Posisi Dalam Jakarta EE

Simplifikasi:

```text
Jakarta Security -> identity/authentication/caller security abstraction
Jakarta Authorization -> low-level authorization SPI/permission model
Servlet/JAX-RS/EJB annotations -> declarative security surface
Application server -> enforcement and provider integration
```

### 15.3 Declarative Authorization Yang Sering Terlihat

```java
@RolesAllowed("ADMIN")
public void deleteUser(String userId) {
    // ...
}
```

```java
@PermitAll
public String health() {
    return "OK";
}
```

```java
@DenyAll
public void dangerousOperation() {
    // ...
}
```

### 15.4 Batas Jakarta Declarative Authorization

`@RolesAllowed` bagus untuk coarse function authorization:

```text
Hanya role CASE_REVIEWER boleh masuk method approve.
```

Tapi tidak cukup untuk:

```text
CASE_REVIEWER hanya boleh approve case yang assigned ke dia,
di agency yang sama,
statusnya UNDER_REVIEW,
dan bukan dia sendiri submitter-nya.
```

Maka tetap perlu domain authorization check:

```java
@RolesAllowed("CASE_REVIEWER")
public void approve(String caseId) {
    CaseRecord caseRecord = caseRepository.get(caseId);
    authorizationService.authorize(
            AuthorizationRequest.forAction(userContext.currentSubject(), "case.approve", caseRecord)
    );
    caseService.approve(caseRecord);
}
```

### 15.5 Jakarta Authorization Dalam Seri Ini

Kita akan bahas lebih dalam di Part 16. Untuk Part 2, cukup pahami:

```text
Jakarta Authorization masih relevan sebagai container-level integration,
tetapi business authorization tetap perlu model domain/policy yang eksplisit.
```

---

## 16. Spring Security: Bukan Java Platform Primitive, Tapi Modern Default Banyak Aplikasi

Walaupun Spring Security bukan bagian Java SE, ia penting karena banyak aplikasi Java modern memakainya.

Spring Security modern memakai model:

```text
Authentication
GrantedAuthority
AuthorizationManager
AuthorizationDecision
Method Security
SecurityExpression
PermissionEvaluator
```

Poin penting:

```text
Spring Security bukan SecurityManager.
Spring Security bekerja di application framework layer.
Ia lebih cocok untuk modern web/API authorization.
```

Tapi Spring pun punya jebakan:

```java
@PreAuthorize("hasRole('ADMIN')")
```

Jika semua authorization direduksi menjadi role check, sistem tetap rentan.

Lebih baik:

```java
@PreAuthorize("@caseAuthorization.canApprove(authentication, #caseId)")
public void approveCase(String caseId) {
    // ...
}
```

atau explicit service-level:

```java
public void approveCase(String caseId) {
    CaseRecord caseRecord = caseRepository.getById(caseId);
    authorizationService.authorize(subject(), Action.CASE_APPROVE, caseRecord);
    workflowService.approve(caseRecord);
}
```

Kita akan bahas lebih dalam di Part 13–15.

---

## 17. What Still Matters?

Mari kategorikan.

### 17.1 Masih Penting Secara Langsung

#### `Principal`

Masih penting sebagai identity abstraction.

Gunakan untuk:

```text
interoperability
servlet/JAX-RS/Jakarta APIs
custom user principal
certificate principal
service account principal
```

Tapi jangan jadikan satu-satunya subject model.

#### Explicit Authorization Service

Bukan Java SE primitive, tapi harus menjadi primitive arsitektur aplikasi.

```java
public interface AuthorizationService {
    PolicyDecision decide(AuthorizationRequest request);

    default void authorize(AuthorizationRequest request) {
        PolicyDecision decision = decide(request);
        if (!decision.isAllowed()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

#### Domain Action/Resource/Context Model

Ini yang harus kamu bangun.

```java
public final class AuthorizationRequest {
    private final AuthorizationSubject subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;
}
```

### 17.2 Penting Untuk Integration/Migration

#### `Subject`

Relevan untuk JAAS/container integration.

#### `Permission`

Relevan untuk Jakarta Authorization atau legacy permission provider.

#### `Policy`

Relevan untuk membaca legacy, bukan desain baru.

#### `ProtectionDomain`

Relevan untuk memahami classloader/plugin/security internals.

### 17.3 Tidak Untuk Desain Baru

#### `SecurityManager`

Jangan dipakai sebagai fondasi baru.

#### `AccessController` Untuk Business Authorization

Jangan pakai sebagai authorization user/domain.

#### System-wide `Policy.setPolicy`

Jangan dipakai untuk business policy baru.

---

## 18. Designing Modern Authorization Primitives In Java

Karena Java platform primitive lama tidak cukup, kita perlu primitive aplikasi sendiri.

### 18.1 Core Model

Minimal:

```text
AuthorizationSubject
Action
ResourceRef
AuthorizationContext
AuthorizationRequest
PolicyDecision
AuthorizationService
```

### 18.2 Java 8-Compatible Implementation

```java
public enum DecisionType {
    ALLOW,
    DENY,
    NOT_APPLICABLE,
    ERROR
}
```

```java
public final class PolicyDecision {
    private final DecisionType type;
    private final String reasonCode;
    private final String message;

    private PolicyDecision(DecisionType type, String reasonCode, String message) {
        this.type = type;
        this.reasonCode = reasonCode;
        this.message = message;
    }

    public static PolicyDecision allow(String reasonCode) {
        return new PolicyDecision(DecisionType.ALLOW, reasonCode, null);
    }

    public static PolicyDecision deny(String reasonCode, String message) {
        return new PolicyDecision(DecisionType.DENY, reasonCode, message);
    }

    public boolean isAllowed() {
        return type == DecisionType.ALLOW;
    }

    public DecisionType type() {
        return type;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public String message() {
        return message;
    }
}
```

```java
public final class Action {
    private final String value;

    private Action(String value) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("action must not be empty");
        }
        this.value = value;
    }

    public static Action of(String value) {
        return new Action(value);
    }

    public String value() {
        return value;
    }
}
```

```java
public final class ResourceRef {
    private final String type;
    private final String id;

    private ResourceRef(String type, String id) {
        if (type == null || type.isEmpty()) {
            throw new IllegalArgumentException("resource type must not be empty");
        }
        if (id == null || id.isEmpty()) {
            throw new IllegalArgumentException("resource id must not be empty");
        }
        this.type = type;
        this.id = id;
    }

    public static ResourceRef of(String type, String id) {
        return new ResourceRef(type, id);
    }

    public String type() {
        return type;
    }

    public String id() {
        return id;
    }
}
```

```java
public final class AuthorizationContext {
    private final Map<String, Object> attributes;

    public AuthorizationContext(Map<String, Object> attributes) {
        this.attributes = Collections.unmodifiableMap(new LinkedHashMap<String, Object>(attributes));
    }

    public Object get(String key) {
        return attributes.get(key);
    }

    public String getString(String key) {
        Object value = attributes.get(key);
        return value == null ? null : String.valueOf(value);
    }

    public Map<String, Object> asMap() {
        return attributes;
    }
}
```

```java
public final class AuthorizationRequest {
    private final AuthorizationSubject subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            AuthorizationSubject subject,
            Action action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.subject = Objects.requireNonNull(subject, "subject");
        this.action = Objects.requireNonNull(action, "action");
        this.resource = Objects.requireNonNull(resource, "resource");
        this.context = Objects.requireNonNull(context, "context");
    }

    public AuthorizationSubject subject() {
        return subject;
    }

    public Action action() {
        return action;
    }

    public ResourceRef resource() {
        return resource;
    }

    public AuthorizationContext context() {
        return context;
    }
}
```

### 18.3 Java 17+ Version

```java
public sealed interface PolicyDecision permits Allow, Deny, NotApplicable, DecisionError {
    String reasonCode();
}

public record Allow(String reasonCode) implements PolicyDecision {
}

public record Deny(String reasonCode, String safeMessage) implements PolicyDecision {
}

public record NotApplicable(String reasonCode) implements PolicyDecision {
}

public record DecisionError(String reasonCode, String safeMessage) implements PolicyDecision {
}
```

```java
public record AuthorizationRequest(
        AuthorizationSubject subject,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
) {
    public AuthorizationRequest {
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(resource, "resource");
        Objects.requireNonNull(context, "context");
    }
}
```

### 18.4 Kenapa Ini Lebih Baik Dari Java `Permission` Langsung?

Karena model ini memisahkan:

```text
subject
business action
resource identity
context
policy decision
reason
audit evidence
```

Sementara `Permission` cenderung menyatukan action/resource menjadi object yang terlalu sempit.

---

## 19. Bridging Legacy Java Primitives To Modern Authorization

Kadang kamu tidak bisa menghindari legacy. Maka gunakan adapter.

### 19.1 Principal To AuthorizationSubject

```java
public final class SubjectFactory {
    public AuthorizationSubject fromPrincipal(Principal principal) {
        if (principal == null) {
            throw new IllegalArgumentException("principal must not be null");
        }

        return AuthorizationSubject.humanUser(
                principal.getName(),
                Collections.<ScopedRole>emptySet(),
                Collections.<PermissionRef>emptySet()
        );
    }
}
```

### 19.2 JAAS Subject To AuthorizationSubject

```java
public final class JaasSubjectMapper {
    public AuthorizationSubject map(Subject subject) {
        String userId = null;
        Set<ScopedRole> roles = new LinkedHashSet<ScopedRole>();

        for (Principal principal : subject.getPrincipals()) {
            if (principal instanceof UserPrincipal) {
                userId = principal.getName();
            } else if (principal instanceof RolePrincipal) {
                roles.add(ScopedRole.global(principal.getName()));
            }
        }

        if (userId == null) {
            throw new IllegalArgumentException("JAAS subject has no user principal");
        }

        return AuthorizationSubject.humanUser(userId, roles, Collections.<PermissionRef>emptySet());
    }
}
```

### 19.3 Java Permission To Internal Action

```java
public final class PermissionMapper {
    public Action toAction(Permission permission) {
        if (permission instanceof CasePermission) {
            return Action.of("case." + permission.getActions());
        }
        throw new IllegalArgumentException("Unsupported permission: " + permission.getClass().getName());
    }
}
```

Rule:

```text
Legacy API boleh menjadi input adapter,
tetapi jangan biarkan legacy shape mengendalikan seluruh domain model.
```

---

## 20. Example: Wrong vs Better Architecture

### 20.1 Wrong: Platform Permission As Business Policy

```java
public void approveCase(String caseId) {
    AccessController.checkPermission(new CasePermission(caseId, "approve"));
    caseRepository.approve(caseId);
}
```

Masalah:

1. Bergantung pada model access control lama.
2. Tidak jelas subject siapa.
3. Tidak jelas tenant/context.
4. Tidak bisa audit reason dengan baik.
5. Tidak cocok untuk Java 24/25 direction.
6. Tidak natural untuk state-based rule.

### 20.2 Better: Explicit Domain Authorization

```java
public void approveCase(String caseId) {
    AuthorizationSubject subject = currentSubjectProvider.currentSubject();
    CaseRecord caseRecord = caseRepository.getRequired(caseId);

    AuthorizationRequest request = AuthorizationRequests.forCase(
            subject,
            Action.of("case.approve"),
            caseRecord
    );

    authorizationService.authorize(request);

    caseWorkflow.approve(caseRecord, subject.subjectId());
}
```

### 20.3 Even Better: Transaction And TOCTOU Awareness

```java
@Transactional
public void approveCase(String caseId) {
    AuthorizationSubject subject = currentSubjectProvider.currentSubject();

    CaseRecord caseRecord = caseRepository.getForUpdate(caseId);

    authorizationService.authorize(
            AuthorizationRequests.forCase(subject, Action.of("case.approve"), caseRecord)
    );

    caseRecord.approveBy(subject.subjectId());
    caseRepository.save(caseRecord);
}
```

Kenapa lebih baik?

```text
Resource state yang dicek adalah state yang dimutasi.
Lock/transaction mengurangi TOCTOU.
Decision bisa diaudit.
Context bisa lengkap.
Policy bisa evolve.
```

---

## 21. Example: AuthorizationSubject Design

### 21.1 Java 8-Compatible

```java
public final class AuthorizationSubject {
    private final String subjectId;
    private final SubjectType subjectType;
    private final String tenantId;
    private final Set<ScopedRole> roles;
    private final Set<PermissionRef> permissions;
    private final DelegationContext delegationContext;

    private AuthorizationSubject(
            String subjectId,
            SubjectType subjectType,
            String tenantId,
            Set<ScopedRole> roles,
            Set<PermissionRef> permissions,
            DelegationContext delegationContext
    ) {
        this.subjectId = requireText(subjectId, "subjectId");
        this.subjectType = Objects.requireNonNull(subjectType, "subjectType");
        this.tenantId = tenantId;
        this.roles = Collections.unmodifiableSet(new LinkedHashSet<ScopedRole>(roles));
        this.permissions = Collections.unmodifiableSet(new LinkedHashSet<PermissionRef>(permissions));
        this.delegationContext = delegationContext;
    }

    public static AuthorizationSubject humanUser(
            String userId,
            String tenantId,
            Set<ScopedRole> roles,
            Set<PermissionRef> permissions
    ) {
        return new AuthorizationSubject(
                userId,
                SubjectType.HUMAN_USER,
                tenantId,
                roles,
                permissions,
                null
        );
    }

    public static AuthorizationSubject serviceAccount(
            String serviceAccountId,
            String tenantId,
            Set<PermissionRef> permissions
    ) {
        return new AuthorizationSubject(
                serviceAccountId,
                SubjectType.SERVICE_ACCOUNT,
                tenantId,
                Collections.<ScopedRole>emptySet(),
                permissions,
                null
        );
    }

    public String subjectId() {
        return subjectId;
    }

    public SubjectType subjectType() {
        return subjectType;
    }

    public String tenantId() {
        return tenantId;
    }

    public Set<ScopedRole> roles() {
        return roles;
    }

    public Set<PermissionRef> permissions() {
        return permissions;
    }

    public DelegationContext delegationContext() {
        return delegationContext;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be empty");
        }
        return value;
    }
}
```

```java
public enum SubjectType {
    HUMAN_USER,
    SERVICE_ACCOUNT,
    SYSTEM_JOB,
    EXTERNAL_PARTNER
}
```

### 21.2 Why SubjectType Matters

Karena policy untuk human user dan service account berbeda.

Contoh:

```text
Human reviewer boleh approve case jika assigned.
Service account boleh sync status tapi tidak boleh approve manual decision.
System job boleh auto-close expired case tapi tidak boleh export personal report.
```

Jika semua dianggap `Principal`, policy menjadi kabur.

---

## 22. Example: Platform Boundary And Domain Boundary Together

Misal aplikasi case management.

### 22.1 Platform Boundary

```text
Container hanya boleh mount read-only config.
Pod tidak boleh run as root.
Service account hanya punya IAM read secret tertentu.
Network policy hanya membuka DB dan message broker.
JVM tidak rely pada SecurityManager.
```

### 22.2 Application Boundary

```text
Officer hanya boleh lihat case agency sendiri.
Reviewer hanya boleh approve assigned case.
Maker tidak boleh checker untuk submission sendiri.
Admin agency tidak boleh export cross-agency report.
Support hanya boleh impersonate dengan ticket approved.
```

Keduanya penting, tapi berbeda.

Kesalahan desain:

```text
Karena sudah ada IAM/Kubernetes/network policy, business authorization dianggap tidak perlu.
```

atau sebaliknya:

```text
Karena sudah ada app authorization, platform boundary dianggap tidak perlu.
```

Top engineer melihat ini sebagai **layered control**.

---

## 23. Mapping Java Platform Primitive Ke Modern Architecture

| Java Primitive | Modern Equivalent/Usage | Recommendation |
|---|---|---|
| `Principal` | `UserPrincipal`, `ServicePrincipal`, caller identity | Use as identity evidence |
| `Subject` | `AuthorizationSubject`, security context | Map/adapter only unless JAAS-centric |
| `Permission` | `PermissionRef`, `Action`, capability | Use business value object; subclass only for integration |
| `Policy` | Policy engine, policy registry, authorization DB | Do not use system-wide Policy for app authz |
| `AccessController` | AuthorizationService check | Avoid for business authz |
| `SecurityManager` | Container/OS isolation + app authz | Do not use for new systems |
| `ProtectionDomain` | module/classloader/security internals | Understand, rarely use directly |
| `CodeSource` | supply-chain/code provenance | Not business authz |

---

## 24. Advanced Failure Modes

### 24.1 Mistaking Code Permission For User Permission

Bad reasoning:

```text
This code has permission to read file, therefore user can download document.
```

Correct reasoning:

```text
Code capability and user authorization are separate.
The service may technically read the file,
but the user may not be authorized to receive it.
```

### 24.2 Mistaking Authentication Principal For Authorization Subject

Bad:

```java
String username = principal.getName();
if (username != null) allow();
```

Correct:

```text
principal identifies caller;
authorization subject includes role, permission, tenant, delegation, risk, and context.
```

### 24.3 Mistaking Module Encapsulation For Data Access Control

Bad:

```text
Repository package is not exported, so data is safe.
```

Correct:

```text
Package encapsulation prevents accidental code coupling,
not malicious or mistaken business access.
```

### 24.4 Legacy SecurityManager Dependency During Upgrade

Symptoms:

```text
UnsupportedOperationException when setting SecurityManager
Policy.setPolicy no longer supported
library assumes access control stack inspection
```

Mitigation:

```text
inventory dependencies
run tests on target JDK
replace sandbox assumption
move isolation to process/container
remove SecurityManager-specific code path
```

### 24.5 Role As Principal Without Tenant Scope

Bad:

```text
Principal: ROLE_ADMIN
```

Better:

```text
Role: AGENCY_ADMIN
Scope: agency=CEA
```

Best:

```text
Subject has scoped role assignments with validity, source, and review lifecycle.
```

---

## 25. Migration Strategy For Legacy Java Security Usage

### 25.1 Inventory

Cari penggunaan:

```text
SecurityManager
System.setSecurityManager
System.getSecurityManager
AccessController
AccessControlContext
doPrivileged
Policy.getPolicy
Policy.setPolicy
checkPermission
Subject.doAs
custom Permission subclasses
JAAS LoginModule
```

Command contoh:

```bash
grep -R "SecurityManager\|AccessController\|doPrivileged\|Policy\.setPolicy\|checkPermission\|Subject.doAs" src/main/java
```

PowerShell:

```powershell
Get-ChildItem -Recurse -Include *.java |
  Select-String -Pattern "SecurityManager|AccessController|doPrivileged|Policy\.setPolicy|checkPermission|Subject\.doAs"
```

### 25.2 Classify

Kategorikan:

| Usage | Meaning | Action |
|---|---|---|
| SecurityManager sandbox | Runtime isolation | Replace with process/container sandbox |
| doPrivileged for property read | Legacy compatibility | Remove if unnecessary; test JDK target |
| JAAS login | Authentication integration | Keep if required; isolate adapter |
| Permission subclass for domain | Business authz | Migrate to AuthorizationRequest/PolicyDecision |
| Policy file grants | Code permission | Remove or replace architecture |
| checkPermission in service | App authz attempt | Replace with AuthorizationService |

### 25.3 Introduce Adapter Layer

Jangan refactor semua sekaligus.

Buat adapter:

```text
Legacy principal/subject/permission -> modern AuthorizationSubject/Action/ResourceRef
```

### 25.4 Shadow Decision

Untuk sistem production legacy:

```text
existing check still enforces
new authorization service computes decision in shadow mode
compare decision
log diff
fix policy gaps
gradually switch enforcement
```

### 25.5 Kill Direct Legacy Usage

Rule arsitektur:

```text
Business services must not call AccessController/SecurityManager directly.
Business services must call AuthorizationService.
```

---

## 26. Mini Case Study: Case Approval Authorization

### 26.1 Requirement

```text
A reviewer can approve a case if:
1. subject is human user,
2. subject has CASE_REVIEWER role scoped to the case agency,
3. case status is UNDER_REVIEW,
4. subject is assigned reviewer,
5. subject is not the submitter,
6. subject is not suspended,
7. decision occurs before review deadline.
```

### 26.2 Bad Java Platform-Centric Model

```java
AccessController.checkPermission(new CasePermission(caseId, "approve"));
```

Missing:

```text
case agency
case status
assignment
submitter
suspension
review deadline
reason code
audit evidence
```

### 26.3 Better Domain Policy

```java
public final class CaseApprovePolicy implements AuthorizationPolicy {
    @Override
    public PolicyDecision decide(AuthorizationRequest request) {
        AuthorizationSubject subject = request.subject();
        CaseRecordView caseRecord = (CaseRecordView) request.context().get("case");

        if (subject.subjectType() != SubjectType.HUMAN_USER) {
            return PolicyDecision.deny("SUBJECT_NOT_HUMAN", "Only human reviewers can approve cases.");
        }

        if (!hasScopedRole(subject, "CASE_REVIEWER", "AGENCY", caseRecord.agencyId())) {
            return PolicyDecision.deny("MISSING_SCOPED_REVIEWER_ROLE", "Reviewer role is required for this agency.");
        }

        if (caseRecord.status() != CaseStatus.UNDER_REVIEW) {
            return PolicyDecision.deny("CASE_NOT_UNDER_REVIEW", "Case is not under review.");
        }

        if (!caseRecord.assignedReviewerId().equals(subject.subjectId())) {
            return PolicyDecision.deny("NOT_ASSIGNED_REVIEWER", "Only the assigned reviewer can approve this case.");
        }

        if (caseRecord.submitterId().equals(subject.subjectId())) {
            return PolicyDecision.deny("MAKER_CHECKER_VIOLATION", "Submitter cannot approve own case.");
        }

        if (Boolean.TRUE.equals(request.context().get("subjectSuspended"))) {
            return PolicyDecision.deny("SUBJECT_SUSPENDED", "Suspended subject cannot approve case.");
        }

        Instant now = (Instant) request.context().get("now");
        if (now.isAfter(caseRecord.reviewDeadline())) {
            return PolicyDecision.deny("REVIEW_DEADLINE_EXPIRED", "Review deadline has expired.");
        }

        return PolicyDecision.allow("CASE_APPROVE_ALLOWED");
    }

    private boolean hasScopedRole(
            AuthorizationSubject subject,
            String role,
            String scopeType,
            String scopeId
    ) {
        for (ScopedRole scopedRole : subject.roles()) {
            if (scopedRole.role().equals(role)
                    && scopedRole.scopeType().equals(scopeType)
                    && scopedRole.scopeId().equals(scopeId)) {
                return true;
            }
        }
        return false;
    }
}
```

### 26.4 What This Shows

Authorization modern membutuhkan:

```text
explicit subject
explicit action
explicit resource
explicit context
explicit reason
explicit failure mode
explicit auditability
```

Bukan stack inspection.

---

## 27. Testing Platform Primitive Boundaries

### 27.1 Test Principal Mapping

```java
@Test
public void mapsPrincipalToAuthorizationSubject() {
    Principal principal = new AuthenticatedUser("u-1", "fajar", "Fajar", "idp-main");

    AuthorizationSubject subject = mapper.fromPrincipal(principal);

    assertEquals("u-1", subject.subjectId());
    assertEquals(SubjectType.HUMAN_USER, subject.subjectType());
}
```

### 27.2 Test No Domain Code Uses SecurityManager

Dengan architecture test:

```text
No class in ..domain.. or ..application.. may access java.lang.SecurityManager.
No class in ..domain.. or ..application.. may access java.security.AccessController.
```

### 27.3 Test Legacy Adapter

```java
@Test
public void mapsJaasRolePrincipalToScopedRole() {
    Subject jaasSubject = new Subject();
    jaasSubject.getPrincipals().add(new UserPrincipal("u-1"));
    jaasSubject.getPrincipals().add(new RolePrincipal("CASE_REVIEWER"));

    AuthorizationSubject subject = mapper.map(jaasSubject);

    assertTrue(subject.roles().contains(ScopedRole.global("CASE_REVIEWER")));
}
```

### 27.4 Test JDK Upgrade Compatibility

Dalam build pipeline:

```text
Run tests on lowest supported JDK.
Run tests on current LTS.
Run tests on target latest JDK.
Search for removed/disabled API usage.
```

Untuk Java 8–25 library:

```text
Compile target Java 8 if promised.
Run compatibility test on Java 8, 11, 17, 21, 25.
Avoid depending on SecurityManager behavior.
```

---

## 28. Production Checklist

Gunakan checklist ini saat review sistem Java.

### 28.1 Identity/Principal

- [ ] Principal tidak dipakai sebagai authorization decision langsung.
- [ ] Principal ID stabil dan unique.
- [ ] Display name tidak dipakai sebagai primary identity.
- [ ] Human user dan service account dibedakan.
- [ ] Delegated/impersonated access direpresentasikan eksplisit.

### 28.2 Legacy Java Security API

- [ ] Tidak ada desain baru bergantung pada SecurityManager.
- [ ] Tidak ada business authorization memakai `AccessController.checkPermission`.
- [ ] Tidak ada `doPrivileged` untuk user privilege escalation.
- [ ] Penggunaan JAAS diisolasi sebagai adapter/integration.
- [ ] Custom `Permission` tidak menjadi domain model utama kecuali container integration.

### 28.3 Domain Authorization

- [ ] Ada `AuthorizationService` atau equivalent explicit policy decision layer.
- [ ] Request authorization memuat subject/action/resource/context.
- [ ] Decision memuat allow/deny dan reason code.
- [ ] Denial reason aman dari data leakage.
- [ ] Decision bisa diaudit.
- [ ] Tenant/resource boundary dicek di service/repository/query layer.

### 28.4 Java 8–25 Compatibility

- [ ] Java 8-compatible code tidak memakai records/sealed types langsung.
- [ ] Java 17+ code tidak bergantung pada SecurityManager.
- [ ] Java 24/25 test tidak gagal karena `System.setSecurityManager`/`Policy.setPolicy`.
- [ ] Build/test matrix mencakup JDK target.
- [ ] Library lama yang bergantung SecurityManager sudah diidentifikasi.

### 28.5 Platform Security Boundary

- [ ] Runtime isolation dilakukan di OS/container/cloud layer.
- [ ] Kubernetes/IAM/network/filesystem policy tidak dianggap pengganti business authorization.
- [ ] Business authorization tidak dianggap pengganti runtime isolation.

---

## 29. Design Heuristics Untuk Top 1% Engineer

### 29.1 Jangan Terpesona Oleh API Yang Namanya “Security”

Tidak semua API dengan package `java.security` cocok untuk authorization aplikasi.

Pertanyaan yang harus selalu diajukan:

```text
Security terhadap apa?
Threat model-nya apa?
Subjeknya siapa?
Resource-nya apa?
Decision-nya apa?
Enforcement point-nya di mana?
```

### 29.2 Pisahkan Code Capability Dan User Authority

Service mungkin punya kemampuan teknis membaca semua row di DB.

Tapi user belum tentu boleh melihat semua row itu.

```text
Technical capability != business authority
```

### 29.3 Gunakan Legacy API Sebagai Adapter, Bukan Arsitektur

Jika harus memakai JAAS/Jakarta Authorization/Permission:

```text
map into domain authorization model
avoid leaking low-level model everywhere
```

### 29.4 Jadikan Authorization Request Eksplisit

Jika function signature authorization tidak memuat resource/context, kemungkinan rule akan kabur.

Buruk:

```java
boolean canApprove(User user);
```

Lebih baik:

```java
PolicyDecision canApprove(AuthorizationSubject subject, CaseRecord caseRecord, AuthorizationContext context);
```

### 29.5 Jangan Andalkan Global Mutable Security State

Global state seperti system-wide policy/security manager sulit dites, sulit diisolasi, dan tidak cocok untuk distributed system.

Lebih baik:

```text
explicit dependency injection
explicit AuthorizationService
explicit policy registry
explicit decision audit
```

### 29.6 Authorization Harus Bisa Dijelaskan

Jika sistem hanya punya boolean:

```java
false
```

maka troubleshooting, audit, dan regulatory defensibility lemah.

Lebih baik:

```json
{
  "decision": "DENY",
  "reasonCode": "MAKER_CHECKER_VIOLATION",
  "policyVersion": "case-approval-v3",
  "subjectId": "u-123",
  "resourceType": "case",
  "resourceId": "case-789"
}
```

---

## 30. Common Interview / Principal Engineer Discussion Questions

Gunakan pertanyaan ini untuk menguji kedalaman pemahaman.

### Question 1

> Apa bedanya `Principal` dan `Subject`?

Jawaban kuat:

```text
Principal adalah identity/name tertentu.
Subject adalah entity security yang bisa memiliki banyak principal dan credential.
Dalam app modern, keduanya biasanya menjadi input untuk AuthorizationSubject yang lebih domain-aware.
```

### Question 2

> Apakah `SecurityManager` bisa dipakai untuk authorization aplikasi?

Jawaban kuat:

```text
Untuk desain baru, tidak. SecurityManager adalah historical code-access security mechanism, bukan business authorization system. Ia deprecated for removal di Java 17 dan permanently disabled mulai JDK 24. Untuk app authorization gunakan framework/application policy layer.
```

### Question 3

> Apa bedanya Java `Permission` dan business permission?

Jawaban kuat:

```text
Java Permission adalah class platform untuk permission check historically tied to code/security domain. Business permission adalah semantic capability seperti case.approve atau report.export. Business permission tidak harus subclass java.security.Permission.
```

### Question 4

> Jika aplikasi berjalan di Kubernetes dengan IAM ketat, apakah masih perlu application authorization?

Jawaban kuat:

```text
Ya. IAM/Kubernetes membatasi capability service/runtime. Application authorization membatasi apa yang boleh dilakukan user/subject terhadap domain resource. Keduanya layer berbeda.
```

### Question 5

> Bagaimana migrasi dari legacy `AccessController.checkPermission`?

Jawaban kuat:

```text
Inventory usage, classify purpose, introduce AuthorizationService, map legacy Permission to Action/ResourceRef if needed, run shadow decision, compare results, switch enforcement gradually, remove direct dependency from domain/application code.
```

---

## 31. Ringkasan Inti

Java punya banyak primitive security historis, tetapi authorization modern tidak boleh disamakan dengan model lama JVM code-access security.

Yang perlu diingat:

```text
Principal masih penting sebagai identity evidence.
Subject masih berguna untuk JAAS/integration.
Permission masih berguna untuk container/legacy integration.
Policy/AccessController/SecurityManager bukan fondasi business authorization modern.
```

Untuk aplikasi enterprise Java 8–25, desain yang lebih sehat adalah:

```text
explicit AuthorizationSubject
explicit Action
explicit ResourceRef
explicit AuthorizationContext
explicit AuthorizationRequest
explicit PolicyDecision
explicit AuthorizationService
```

SecurityManager harus dipahami untuk legacy/migration, tetapi tidak dipakai sebagai desain baru. Java 24/25 mempertegas arah ini karena SecurityManager sudah tidak menjadi mekanisme enforcement yang bisa diandalkan.

Top 1% authorization engineering bukan tentang memakai API security paling tua atau paling low-level, tetapi tentang memilih boundary yang tepat:

```text
Platform boundary -> OS/container/cloud/runtime controls
Application boundary -> policy/domain authorization
Data boundary -> query scoping/tenant enforcement
Workflow boundary -> state transition guard
Audit boundary -> explainable decision evidence
```

---

## 32. Referensi Otoritatif

1. OpenJDK JEP 411 — **Deprecate the Security Manager for Removal**  
   https://openjdk.org/jeps/411

2. OpenJDK JEP 486 — **Permanently Disable the Security Manager**  
   https://openjdk.org/jeps/486

3. Oracle Java SE 25 API — `SecurityManager`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/SecurityManager.html

4. Oracle Java SE 25 API — `AccessController`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/AccessController.html

5. Oracle Java SE 25 Security Guide — **The Security Manager is Permanently Disabled**  
   https://docs.oracle.com/en/java/javase/25/security/security-manager-is-permanently-disabled.html

6. Oracle Java SE 25 API — `Principal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/Principal.html

7. Oracle Java SE 25 API — `Permission`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/Permission.html

8. Jakarta Authorization 3.0 Specification  
   https://jakarta.ee/specifications/authorization/3.0/jakarta-authorization-spec-3.0

9. Spring Security Reference — Authorization Architecture  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

---

## 33. Status Seri

Selesai:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
```

Belum selesai. Part berikutnya:

```text
[ ] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-001.md">⬅️ Part 1 — Authorization Vocabulary, Semantics, and Invariants</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-003.md">Java Authorization Modes and Patterns — Advanced Engineering ➡️</a>
</div>
