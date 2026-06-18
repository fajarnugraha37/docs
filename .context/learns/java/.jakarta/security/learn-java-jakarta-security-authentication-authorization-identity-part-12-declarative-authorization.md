# Part 12 — Declarative Authorization: URL, Method, Class, Role

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-12-declarative-authorization.md`  
> Target pembaca: Java/Jakarta engineer yang ingin memahami authorization bukan hanya sebagai annotation, tetapi sebagai kontrak enforcement yang bisa dipertanggungjawabkan di sistem enterprise/regulatory.  
> Scope versi: Java 8 sampai Java 25, Java EE 8 / Jakarta EE 8 sampai Jakarta EE 11+, namespace `javax.*` dan `jakarta.*`.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membedah:

1. apa itu identity, principal, subject, group, role, permission;
2. bagaimana container security bekerja;
3. bagaimana authentication mechanism membentuk caller identity;
4. bagaimana Jakarta Security API memberi akses ke `SecurityContext` dan `IdentityStore`;
5. bagaimana Jakarta Authentication/JASPIC menyerahkan principal dan group ke container;
6. bagaimana Jakarta Authorization/JACC menjadi SPI low-level untuk permission-based authorization.

Part ini masuk ke salah satu model authorization yang paling sering dipakai di aplikasi Jakarta/Java EE:

```text
Declarative authorization
```

Maksudnya: authorization dinyatakan sebagai **metadata** pada aplikasi, bukan ditulis manual sebagai `if` di setiap method.

Contoh bentuknya:

```java
@RolesAllowed("ADMIN")
public void approveCase(Long caseId) {
    ...
}
```

atau:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin Area</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
</security-constraint>
```

Sekilas terlihat sederhana. Tetapi di sistem enterprise, declarative authorization menyimpan banyak jebakan:

- annotation tidak selalu dieksekusi kalau object tidak dibuat oleh container;
- URL constraint tidak sama dengan domain permission;
- `@RolesAllowed` tidak otomatis berarti semua endpoint aman;
- `@PermitAll` bisa berubah menjadi bypass kalau dipakai salah;
- method-level security bisa gagal karena self-invocation/proxy boundary;
- role yang dicek container bisa berbeda dari group yang datang dari identity provider;
- default-allow sering membuat endpoint baru terbuka tanpa sadar;
- JAX-RS, Servlet, CDI, EJB, Spring, MicroProfile JWT, dan Jakarta Security punya boundary berbeda.

Tujuan part ini adalah membuat kita punya mental model yang kuat tentang **di mana declarative authorization cocok, bagaimana ia dievaluasi, di mana ia gagal, dan bagaimana mendesainnya agar tidak menjadi security theater**.

---

## 1. Posisi Declarative Authorization Dalam Peta Security

Security lifecycle request secara sederhana:

```text
Client
  ↓
Transport protection / TLS
  ↓
Authentication mechanism
  ↓
Credential validation
  ↓
Caller principal + groups/roles established
  ↓
Authorization enforcement
  ↓
Business logic
  ↓
Audit/log/response
```

Declarative authorization berada pada tahap:

```text
Caller sudah diketahui → container/framework mengecek apakah caller boleh mengakses resource/method tertentu
```

Artinya declarative authorization biasanya **bukan** tempat untuk:

- memvalidasi password;
- membaca token mentah;
- memverifikasi signature JWT;
- melakukan account linking;
- membaca user dari database;
- membuat session.

Declarative authorization adalah layer yang menjawab:

```text
Dengan identity yang sudah ada, apakah caller termasuk role yang diizinkan untuk resource/method ini?
```

Contoh:

```java
@RolesAllowed({"CASE_OFFICER", "CASE_SUPERVISOR"})
public CaseDto viewCase(Long id) {
    return caseService.find(id);
}
```

Yang dicek oleh annotation tersebut biasanya hanya:

```text
Apakah caller punya role CASE_OFFICER atau CASE_SUPERVISOR?
```

Bukan:

```text
Apakah case itu milik agency caller?
Apakah caller assigned officer untuk case tersebut?
Apakah case masih dalam state yang boleh dilihat?
Apakah caller sedang conflict of interest?
Apakah caller acting on behalf of someone else?
```

Itulah batas besar yang harus selalu diingat:

```text
Declarative authorization kuat untuk coarse-grained access control.
Domain authorization tetap dibutuhkan untuk fine-grained/business authorization.
```

---

## 2. Mental Model: Metadata → Container Policy → Enforcement

Declarative authorization bukan magic. Ia bekerja sebagai pipeline:

```text
Source metadata
  ↓
Container reads metadata at deployment/bootstrap/runtime
  ↓
Metadata transformed into security constraints / method permissions
  ↓
Caller identity established
  ↓
Container/framework checks caller roles/permissions
  ↓
Allow or deny invocation
```

Sumber metadata bisa berupa:

1. deployment descriptor:
   - `web.xml`,
   - `ejb-jar.xml`,
   - application server-specific descriptor;
2. annotation:
   - `@ServletSecurity`,
   - `@HttpConstraint`,
   - `@HttpMethodConstraint`,
   - `@RolesAllowed`,
   - `@PermitAll`,
   - `@DenyAll`,
   - `@DeclareRoles`,
   - `@RunAs`;
3. framework-specific configuration:
   - JAX-RS security integration;
   - MicroProfile JWT annotation support;
   - Spring Security method security;
4. external policy provider:
   - Jakarta Authorization/JACC provider;
   - vendor/container role mapping;
   - enterprise policy engine.

Container kemudian menafsirkan metadata tersebut dalam konteks:

- request URL;
- HTTP method;
- servlet/resource method;
- EJB method;
- CDI/interceptor invocation;
- role mapping;
- authenticated caller;
- security realm;
- application deployment.

Jadi jangan melihat annotation hanya sebagai label. Lihatlah sebagai:

```text
Authorization contract yang dikonsumsi oleh runtime.
```

Kalau runtime tidak melihat annotation tersebut, annotation itu hanya dekorasi.

---

## 3. Declarative Authorization vs Programmatic Authorization

### 3.1 Declarative Authorization

Contoh:

```java
@RolesAllowed("ADMIN")
public void deleteUser(String userId) {
    ...
}
```

Kelebihan:

- mudah dibaca;
- dekat dengan entry point;
- bisa dievaluasi oleh container;
- bisa di-audit secara statis;
- mengurangi duplikasi `if`;
- cocok untuk coarse-grained boundary;
- bisa membantu default-deny kalau diterapkan konsisten.

Kekurangan:

- biasanya role-based;
- tidak cukup untuk object-level permission;
- bisa tidak aktif kalau class tidak managed oleh container;
- bisa sulit melihat role mapping sebenarnya;
- bisa membingungkan bila annotation inheritance/proxy terlibat;
- tidak selalu portable antar runtime/framework.

### 3.2 Programmatic Authorization

Contoh:

```java
public CaseDto getCase(Long caseId) {
    Actor actor = actorProvider.currentActor();
    CaseRecord c = caseRepository.get(caseId);

    authorization.require(actor, Action.VIEW_CASE, c);

    return mapper.toDto(c);
}
```

Kelebihan:

- bisa mengecek resource spesifik;
- bisa state-aware;
- bisa relationship-aware;
- bisa tenant-aware;
- bisa menghasilkan denial reason;
- cocok untuk domain authorization;
- bisa centralize audit decision.

Kekurangan:

- lebih verbose;
- rawan lupa dipanggil;
- perlu discipline desain;
- lebih sulit distatic analyze;
- sering tercampur dengan business logic bila tidak dirancang baik.

### 3.3 Kombinasi Yang Sehat

Untuk aplikasi enterprise serius, pola sehat biasanya:

```text
Declarative authorization:
    Melindungi entry point dan coarse role boundary.

Programmatic/domain authorization:
    Melindungi resource, state, relationship, tenant, dan business invariant.
```

Contoh:

```java
@Path("/cases/{caseId}/approve")
@RolesAllowed({"CASE_SUPERVISOR", "APPROVER"})
public class ApproveCaseResource {

    @POST
    public Response approve(@PathParam("caseId") Long caseId) {
        Actor actor = actorProvider.currentActor();
        CaseRecord c = caseRepository.get(caseId);

        authorization.require(actor, Action.APPROVE_CASE, c);

        caseWorkflow.approve(c, actor);
        return Response.noContent().build();
    }
}
```

Interpretasi:

```text
@RolesAllowed:
    hanya role besar yang boleh masuk ke endpoint approve.

authorization.require:
    memastikan actor boleh approve case spesifik tersebut.
```

---

## 4. Jakarta/Java EE Annotation Utama

Annotation umum untuk method security berada di package:

Java EE / Jakarta EE 8 style:

```java
javax.annotation.security.RolesAllowed
javax.annotation.security.PermitAll
javax.annotation.security.DenyAll
javax.annotation.security.DeclareRoles
javax.annotation.security.RunAs
```

Jakarta EE 9+ style:

```java
jakarta.annotation.security.RolesAllowed
jakarta.annotation.security.PermitAll
jakarta.annotation.security.DenyAll
jakarta.annotation.security.DeclareRoles
jakarta.annotation.security.RunAs
```

Perubahan namespace ini penting:

```text
Java EE 8 / Jakarta EE 8:
    javax.annotation.security.*

Jakarta EE 9+:
    jakarta.annotation.security.*
```

Secara konsep hampir sama, tetapi secara binary/package berbeda. Salah import bisa membuat annotation tidak dikenali oleh runtime yang diharapkan.

---

## 5. `@RolesAllowed`

### 5.1 Makna Dasar

`@RolesAllowed` menyatakan role yang boleh memanggil class/method.

Contoh:

```java
@RolesAllowed("ADMIN")
public void rebuildIndex() {
    ...
}
```

Artinya:

```text
Caller harus berada dalam role ADMIN.
```

Multiple role:

```java
@RolesAllowed({"CASE_OFFICER", "CASE_SUPERVISOR"})
public CaseDto viewCase(Long id) {
    ...
}
```

Artinya biasanya OR:

```text
Caller boleh mengakses jika punya salah satu role: CASE_OFFICER atau CASE_SUPERVISOR.
```

Bukan AND.

Kalau butuh AND:

```text
caller harus punya role A dan role B
```

maka `@RolesAllowed({"A", "B"})` tidak cukup. Butuh programmatic check atau custom interceptor.

### 5.2 Class-Level vs Method-Level

Class-level:

```java
@RolesAllowed("ADMIN")
public class AdminService {

    public void rebuildIndex() {}

    public void purgeCache() {}
}
```

Semua method dianggap butuh `ADMIN`, kecuali ada aturan override tergantung spesifikasi/runtime.

Method-level:

```java
public class AdminService {

    @RolesAllowed("ADMIN")
    public void rebuildIndex() {}

    @RolesAllowed("SUPPORT")
    public void viewDiagnostics() {}
}
```

Biasanya method-level lebih spesifik.

Namun jangan hanya mengandalkan intuisi. Dalam sistem serius, dokumentasikan precedence rule sesuai runtime yang dipakai.

### 5.3 Anti-Pattern: Role Terlalu Generik

Buruk:

```java
@RolesAllowed("USER")
public void approveCase(Long caseId) {
    ...
}
```

Masalah:

- hampir semua authenticated user punya role `USER`;
- endpoint kritis menjadi terlalu luas;
- domain check mungkin lupa ditambahkan;
- audit review sulit membedakan capability.

Lebih baik:

```java
@RolesAllowed({"CASE_APPROVER", "CASE_SUPERVISOR"})
public void approveCase(Long caseId) {
    ...
}
```

Lebih baik lagi ditambah domain check:

```java
@RolesAllowed({"CASE_APPROVER", "CASE_SUPERVISOR"})
public void approveCase(Long caseId) {
    CaseRecord c = caseRepository.get(caseId);
    authorization.require(currentActor(), Action.APPROVE_CASE, c);
    workflow.approve(c);
}
```

---

## 6. `@PermitAll`

### 6.1 Makna Dasar

`@PermitAll` menyatakan bahwa semua role boleh mengakses method.

Contoh:

```java
@PermitAll
public ProfileDto myProfile() {
    ...
}
```

Tetapi frasa “all” sering disalahpahami.

Dalam banyak konteks Jakarta EE, `@PermitAll` berarti method tidak dibatasi role tertentu. Ia bukan selalu berarti anonymous boleh masuk. Authentication requirement bisa tetap datang dari layer lain, misalnya:

- URL constraint;
- application authentication policy;
- resource class-level rule;
- gateway;
- framework config.

Jadi ada dua pertanyaan berbeda:

```text
Apakah caller harus authenticated?
Apakah caller perlu role tertentu?
```

`@PermitAll` terutama menjawab pertanyaan kedua.

### 6.2 Risiko `@PermitAll`

`@PermitAll` aman untuk method yang memang boleh dipanggil oleh semua authenticated user atau semua caller sesuai konteks. Tetapi berbahaya bila dipakai sebagai “sementara biar jalan dulu”.

Buruk:

```java
@PermitAll
public void exportAllUsers() {
    ...
}
```

Komentar developer:

```text
Nanti authorization-nya ditambah belakangan.
```

Risiko:

- endpoint terlupakan;
- QA hanya test happy path;
- security scan tidak tahu domain sensitivity;
- production incident.

### 6.3 Penggunaan Sehat

Contoh public endpoint:

```java
@PermitAll
@GET
@Path("/health")
public Response health() {
    return Response.ok("OK").build();
}
```

Tetapi untuk health endpoint production, tetap perlu dibedakan:

```text
Public liveness:
    minimal info, no dependency details.

Internal readiness/diagnostics:
    restricted.
```

Contoh authenticated-but-any-user endpoint:

```java
@RolesAllowed("AUTHENTICATED_USER")
public UserProfile getMyProfile() {
    ...
}
```

Dalam banyak enterprise app, role eksplisit seperti `AUTHENTICATED_USER` lebih jelas daripada `@PermitAll`, karena reviewer langsung tahu endpoint bukan anonymous.

---

## 7. `@DenyAll`

### 7.1 Makna Dasar

`@DenyAll` menyatakan tidak ada role yang boleh memanggil method tersebut.

Contoh:

```java
@DenyAll
public void internalOnlyMigrationHook() {
    ...
}
```

Ia berguna untuk:

- menutup method warisan;
- menandai method tidak boleh diakses via remote/business interface;
- defensive default pada base class;
- menghindari accidental exposure.

### 7.2 Use Case Nyata

Misal satu service punya public API dan internal helper:

```java
@RolesAllowed("CASE_OFFICER")
public class CaseApplicationService {

    public CaseDto getCase(Long id) {
        ...
    }

    @DenyAll
    public void rebuildSearchProjection() {
        ...
    }
}
```

Tetapi hati-hati: kalau method ini dipanggil langsung dari class yang sama dan container interception tidak terjadi, annotation mungkin tidak berefek. Jangan jadikan `@DenyAll` satu-satunya pelindung untuk operasi sangat kritis.

---

## 8. `@DeclareRoles`

### 8.1 Makna Dasar

`@DeclareRoles` mendeklarasikan role yang digunakan oleh aplikasi.

Contoh:

```java
@DeclareRoles({"ADMIN", "CASE_OFFICER", "CASE_SUPERVISOR"})
public class SecurityConfigMarker {
}
```

Tujuannya bukan untuk memberi role ke user. Tujuannya untuk menyatakan bahwa aplikasi mengenal role tersebut.

Role assignment/mapping biasanya tetap berada di:

- identity store;
- container realm;
- app server role mapping;
- IdP claim/group mapping;
- deployment descriptor;
- custom authentication mechanism;
- external policy system.

### 8.2 Kesalahan Umum

Salah kaprah:

```text
Saya sudah menulis @DeclareRoles("ADMIN"), berarti user sekarang punya ADMIN.
```

Benar:

```text
@DeclareRoles hanya mendeklarasikan role name yang dipakai aplikasi.
User tetap harus dipetakan ke role tersebut oleh container/security runtime.
```

---

## 9. `@RunAs`

### 9.1 Makna Dasar

`@RunAs` mengubah security identity yang digunakan saat komponen memanggil komponen lain.

Contoh konseptual:

```java
@RunAs("SYSTEM_BATCH")
public class NightlyJobBean {

    @EJB
    private ReportGenerationBean reportGeneration;

    public void run() {
        reportGeneration.generateAllReports();
    }
}
```

Saat `NightlyJobBean` memanggil bean lain, ia bisa diperlakukan sebagai role tertentu.

### 9.2 Kapan Berguna

- service internal perlu memanggil komponen yang dilindungi role tertentu;
- scheduled job perlu memakai system identity;
- cross-component invocation butuh identity konsisten;
- audit ingin membedakan user actor vs system actor.

### 9.3 Risiko Besar

`@RunAs` bisa menjadi confused deputy bila tidak dikontrol.

Contoh buruk:

```java
@RunAs("ADMIN")
public class UserUploadProcessor {
    public void processUploadedFile(...) {
        adminService.performPrivilegedOperation(...);
    }
}
```

Kalau input user biasa bisa memicu privileged call, maka sistem internal menjadi deputy yang menyalahgunakan authority.

Rule penting:

```text
Run-as identity harus diperlakukan sebagai privilege escalation internal.
Ia wajib punya audit, scope kecil, dan reason jelas.
```

---

## 10. Servlet Declarative Authorization

Servlet web-tier punya model declarative authorization sendiri melalui:

1. `web.xml`;
2. `@ServletSecurity`;
3. `@HttpConstraint`;
4. `@HttpMethodConstraint`.

### 10.1 `web.xml` Security Constraint

Contoh:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin Pages</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
        <http-method>GET</http-method>
        <http-method>POST</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
    <user-data-constraint>
        <transport-guarantee>CONFIDENTIAL</transport-guarantee>
    </user-data-constraint>
</security-constraint>
```

Interpretasi:

```text
GET/POST ke /admin/* hanya boleh oleh ADMIN dan harus lewat confidential transport.
```

### 10.2 Security Constraint Tanpa Auth Constraint

Hati-hati dengan variasi XML. Dalam Servlet security, detail semantic `auth-constraint` penting. Salah konfigurasi bisa berarti:

- semua boleh;
- tidak ada yang boleh;
- hanya transport constraint;
- hanya method tertentu yang protected.

Karena itu, untuk sistem penting, jangan mengandalkan asumsi. Buat test eksplisit untuk:

- anonymous access;
- authenticated wrong role;
- authenticated correct role;
- unsupported HTTP method;
- encoded path;
- trailing slash;
- case sensitivity;
- dispatcher type bila relevan.

### 10.3 `@ServletSecurity`

Contoh:

```java
@WebServlet("/admin/*")
@ServletSecurity(
    value = @HttpConstraint(rolesAllowed = {"ADMIN"})
)
public class AdminServlet extends HttpServlet {
    ...
}
```

Method-specific:

```java
@WebServlet("/reports/*")
@ServletSecurity(
    value = @HttpConstraint(rolesAllowed = {"REPORT_VIEWER"}),
    httpMethodConstraints = {
        @HttpMethodConstraint(
            value = "POST",
            rolesAllowed = {"REPORT_ADMIN"}
        )
    }
)
public class ReportServlet extends HttpServlet {
    ...
}
```

Interpretasi:

```text
Default access ke /reports/* butuh REPORT_VIEWER.
POST butuh REPORT_ADMIN.
```

### 10.4 URL Pattern Pitfalls

URL-level security punya banyak jebakan:

```text
/admin/*
/admin
/admin/
/admin;jsessionid=...
/admin%2fsecret
/api/v1/admin
/api/v1/admin/
/api/v1/admin/export.csv
```

Pertanyaan review:

1. Apakah `/admin` dan `/admin/` sama-sama protected?
2. Apakah extension mapping seperti `*.jsp` punya constraint terpisah?
3. Apakah static files sensitif ikut terlindungi?
4. Apakah error page expose detail?
5. Apakah forwarded request melewati constraint yang sama?
6. Apakah reverse proxy rewrite path sebelum sampai container?
7. Apakah JAX-RS `Application` path membuat URL yang berbeda dari asumsi?

### 10.5 HTTP Method Pitfalls

Sering ada constraint hanya untuk GET/POST:

```xml
<http-method>GET</http-method>
<http-method>POST</http-method>
```

Lalu lupa:

```text
PUT
PATCH
DELETE
OPTIONS
HEAD
TRACE
```

Masalah:

- endpoint REST biasanya memakai PUT/PATCH/DELETE;
- browser/preflight memakai OPTIONS;
- HEAD bisa mengikuti GET semantics;
- TRACE harus biasanya disabled;
- method override header bisa mem-bypass asumsi.

Untuk default-deny, lebih aman mendesain constraint yang mencakup semua method kecuali benar-benar perlu exception.

---

## 11. EJB Declarative Authorization

EJB/session bean adalah salah satu tempat classic method-level security Jakarta EE bekerja paling kuat.

Contoh:

```java
@Stateless
@RolesAllowed("CASE_OFFICER")
public class CaseService {

    public CaseDto getCase(Long id) {
        ...
    }

    @RolesAllowed("CASE_SUPERVISOR")
    public void assignCase(Long id, String officerId) {
        ...
    }

    @DenyAll
    public void dangerousMaintenanceOperation() {
        ...
    }
}
```

### 11.1 Kenapa EJB Security Relatif Kuat

Karena EJB memang container-managed component. Invocation biasanya melalui container proxy, sehingga container punya kesempatan untuk:

- memeriksa caller;
- mengecek role;
- mengelola transaction;
- mengelola security context;
- menerapkan `@RunAs`;
- menerapkan interceptor lifecycle.

### 11.2 Bypass Lewat Internal Method Call

Contoh:

```java
@Stateless
public class CaseService {

    public void outer(Long id) {
        inner(id); // direct self-invocation
    }

    @RolesAllowed("ADMIN")
    public void inner(Long id) {
        ...
    }
}
```

Kalau `inner()` dipanggil langsung melalui `this.inner()`, container proxy bisa tidak ikut. Akibatnya `@RolesAllowed` pada `inner()` mungkin tidak dievaluasi.

Pola aman:

- jangan mengandalkan annotation pada method internal yang dipanggil langsung;
- letakkan security di entry point;
- gunakan separate bean/service bila butuh proxy boundary;
- gunakan programmatic authorization untuk domain-critical action.

---

## 12. CDI, Interceptors, dan Method Security

Jakarta Security sendiri menyediakan API security, tetapi method-level security pada CDI murni historisnya tidak selalu identik dengan EJB. Dukungan nyata bisa bergantung pada container, extension, MicroProfile, atau framework.

### 12.1 Proxy Boundary

CDI banyak menggunakan proxy/interceptor. Ini menciptakan rule penting:

```text
Security annotation hanya efektif bila invocation melewati layer yang melakukan interception.
```

Contoh risiko:

```java
@RequestScoped
public class UserAction {

    public void submit() {
        approve(); // direct call
    }

    @RolesAllowed("APPROVER")
    public void approve() {
        ...
    }
}
```

Kalau `approve()` tidak dipanggil melalui proxy/interceptor, authorization bisa tidak jalan.

### 12.2 Final Class / Final Method

Interception/proxy bisa bermasalah pada:

- final class;
- final method;
- private method;
- static method;
- direct construction via `new`;
- object not managed by container.

Contoh buruk:

```java
public final class ApprovalService {

    @RolesAllowed("APPROVER")
    public final void approve(Long id) {
        ...
    }
}
```

Kalau runtime membutuhkan subclass proxy, ini bisa gagal.

### 12.3 Object Dibuat Manual

Buruk:

```java
ApprovalService service = new ApprovalService();
service.approve(id);
```

Kalau object tidak dibuat oleh container, annotation security tidak punya runtime yang mengeksekusi.

Rule:

```text
Annotation security adalah kontrak dengan runtime container/framework.
Kalau object berada di luar runtime itu, annotation tidak otomatis berarti apa pun.
```

---

## 13. JAX-RS Declarative Authorization

JAX-RS resource sering diberi annotation security:

```java
@Path("/cases")
@RolesAllowed("CASE_OFFICER")
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") Long id) {
        ...
    }

    @POST
    @Path("/{id}/approve")
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("id") Long id) {
        ...
    }
}
```

Namun detail dukungan method security di JAX-RS bergantung pada platform/runtime/profile yang dipakai.

Dalam Jakarta EE modern, Jakarta Security specification membahas dukungan REST resource constraints ketika Jakarta Security dan Jakarta REST tersedia bersama. Namun engineer tetap harus memverifikasi runtime yang digunakan:

- apakah `@RolesAllowed` pada resource class aktif?
- apakah method-level override aktif?
- apakah sub-resource locator ikut protected?
- apakah exception mapper expose detail?
- apakah pre-matching filter mem-bypass security?
- apakah application path dan servlet path sesuai constraint?

### 13.1 JAX-RS Resource vs Service Layer

Jangan menaruh semua authorization hanya di JAX-RS resource bila service yang sama juga bisa dipanggil dari:

- batch job;
- message listener;
- EJB remote call;
- internal scheduler;
- gRPC bridge;
- GraphQL resolver;
- admin console;
- test harness;
- migration script.

Endpoint-level security hanya melindungi endpoint tersebut.

Domain-critical action tetap perlu domain authorization di service layer.

---

## 14. Role Declaration dan Role Mapping

Declarative authorization mengecek role name. Tetapi role name tersebut harus berasal dari suatu mapping.

Pipeline umum:

```text
IdP group / token claim / LDAP group / database group
  ↓
authentication mechanism / identity store
  ↓
container group/principal
  ↓
application role mapping
  ↓
@RolesAllowed("ROLE_NAME") check
```

Masalah umum:

```text
@RolesAllowed("ADMIN")
```

tetapi identity provider mengirim:

```json
{
  "groups": ["aceas-admin"]
}
```

Jika tidak ada mapping:

```text
aceas-admin → ADMIN
```

maka user tidak dianggap punya role `ADMIN`.

### 14.1 Jangan Hardcode IdP Group Di Business Code

Buruk:

```java
@RolesAllowed("CN=ACEAS_PROD_SUPER_ADMIN,OU=Groups,DC=corp,DC=example")
public void approve() {}
```

Masalah:

- environment-specific;
- susah dibaca;
- susah migrasi IdP;
- role rename menyebabkan code change;
- tidak mencerminkan business capability.

Lebih baik:

```java
@RolesAllowed("CASE_APPROVER")
public void approve() {}
```

Mapping external group ke application role dilakukan di layer security mapping.

### 14.2 Stable Role Contract

Role aplikasi sebaiknya stable, business-readable, dan versionable.

Contoh:

```text
CASE_VIEWER
CASE_OFFICER
CASE_APPROVER
CASE_SUPERVISOR
SYSTEM_AUDITOR
TENANT_ADMIN
PLATFORM_ADMIN
```

Hindari role yang terlalu teknis:

```text
KC_REALM_ROLE_123
LDAP_GRP_ACEAS_UAT_XYZ
TOKEN_SCOPE_a_b_c
```

---

## 15. Default-Allow vs Default-Deny

### 15.1 Default-Allow

Default-allow berarti:

```text
Kalau tidak ada annotation/constraint, resource boleh diakses.
```

Ini berbahaya untuk sistem besar karena endpoint baru bisa lupa diberi annotation.

Contoh:

```java
@Path("/admin/rebuild")
public class RebuildResource {

    @POST
    public Response rebuild() {
        ...
    }
}
```

Tanpa annotation, bisa saja terbuka tergantung runtime/config.

### 15.2 Default-Deny

Default-deny berarti:

```text
Semua resource tertutup kecuali secara eksplisit dibuka.
```

Pola:

```java
@DenyAll
@Path("/admin")
public class AdminResource {

    @POST
    @Path("/rebuild")
    @RolesAllowed("PLATFORM_ADMIN")
    public Response rebuild() {
        ...
    }
}
```

Atau class-level role ketat:

```java
@RolesAllowed("ADMIN")
@Path("/admin")
public class AdminResource {
    ...
}
```

Untuk API besar, default-deny perlu didukung dengan:

- convention;
- static check;
- test scan;
- runtime route inventory;
- security review checklist.

### 15.3 Practical Rule

Untuk production enterprise app:

```text
Public endpoint harus diberi label eksplisit.
Protected endpoint harus diberi role eksplisit.
Unclear endpoint harus fail closed.
```

Jangan biarkan endpoint “diam-diam public karena tidak ada annotation”.

---

## 16. Annotation Inheritance dan Override

Annotation inheritance adalah area yang sering menyebabkan bug.

Pertanyaan yang harus dijawab per runtime:

1. Jika class memiliki `@RolesAllowed`, apakah semua method mewarisi?
2. Jika method memiliki `@PermitAll`, apakah override class-level `@RolesAllowed`?
3. Jika interface punya annotation, apakah implementation mewarisi?
4. Jika superclass punya annotation, apakah subclass mewarisi?
5. Jika resource method override method parent, annotation mana yang berlaku?
6. Jika annotation ada pada CDI bean tetapi method dipanggil melalui interface, apa yang dibaca runtime?

Contoh ambigu:

```java
public interface CaseOperations {
    @RolesAllowed("CASE_VIEWER")
    CaseDto view(Long id);
}

public class CaseOperationsImpl implements CaseOperations {
    public CaseDto view(Long id) {
        ...
    }
}
```

Apakah annotation pada interface dihormati? Tergantung specification/runtime/framework. Jangan menebak untuk sistem penting.

Pola aman:

- taruh annotation pada class/method konkret yang dikelola container;
- buat integration test;
- hindari split annotation antara interface dan implementation kecuali sudah diverifikasi;
- dokumentasikan convention internal.

---

## 17. Ordering Dengan Transaction, Validation, dan Business Logic

Dalam enterprise Java, method invocation bisa melewati banyak interceptor:

```text
Security interceptor
  ↓
Transaction interceptor
  ↓
Validation interceptor
  ↓
Business method
  ↓
Exception mapping
```

Atau urutan lain tergantung runtime.

Mengapa ini penting?

### 17.1 Security Sebelum Transaction

Idealnya authorization gagal sebelum membuka transaction berat.

```text
Unauthorized request → deny quickly → no DB transaction
```

### 17.2 Validation Sebelum Security?

Kalau validation berjalan sebelum security, attacker bisa mendapat informasi dari error validation meskipun tidak authorized.

Contoh:

```text
Field X invalid
Case ID format invalid
Tenant ID missing
```

Informasi ini bisa membantu probing.

### 17.3 Security Sebelum Entity Load?

Untuk domain authorization, sering perlu load entity dulu:

```java
CaseRecord c = repo.get(caseId);
authorization.require(actor, VIEW, c);
```

Tetapi load entity sendiri bisa menjadi data existence leak:

```text
404 vs 403
```

Pola untuk sistem sensitif:

```text
If resource belongs to unauthorized tenant:
    return generic 404 or 403 based on policy
    audit internally
```

Declarative authorization tidak menyelesaikan problem ini. Ia hanya gate awal.

---

## 18. 401 vs 403 Dalam Declarative Authorization

Ketika caller tidak authenticated:

```text
401 Unauthorized
```

Artinya sebenarnya:

```text
Authentication required or failed.
```

Ketika caller authenticated tapi tidak punya role:

```text
403 Forbidden
```

Artinya:

```text
Identity known, but not authorized.
```

Namun di browser app dengan form login, unauthenticated request sering redirect ke login page, bukan 401 JSON.

Untuk API, perilaku sebaiknya jelas:

```text
Missing/invalid token → 401 + WWW-Authenticate where applicable
Authenticated insufficient role → 403
Domain permission denied → 403 or masked 404 according to policy
```

Jangan campur semua menjadi 500 atau generic redirect.

---

## 19. Declarative Authorization di Layer Berbeda

### 19.1 Web/URL Layer

Melindungi:

```text
Path + HTTP method
```

Contoh:

```text
/admin/* requires ADMIN
```

Kuat untuk:

- admin area;
- static protected resources;
- coarse API groups;
- login-required pages.

Lemah untuk:

- object-specific permission;
- tenant isolation;
- state-machine authorization.

### 19.2 Resource/Controller Layer

Melindungi:

```text
Endpoint method
```

Contoh:

```java
@POST
@Path("/{id}/approve")
@RolesAllowed("CASE_APPROVER")
```

Kuat untuk:

- operation-level coarse role;
- API documentation;
- route inventory;
- security review.

Lemah kalau service bisa dipanggil dari channel lain.

### 19.3 Service Layer

Melindungi:

```text
Business operation
```

Contoh:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(...) {}
```

Lebih dekat ke domain, tetapi masih role-based bila hanya annotation.

### 19.4 Domain Policy Layer

Melindungi:

```text
Subject + action + resource + context
```

Contoh:

```java
authorization.require(actor, Action.APPROVE_CASE, caseRecord);
```

Paling kuat untuk fine-grained decision.

### 19.5 Kombinasi Recommended

```text
URL layer:
    Blocks obviously invalid/public access.

Resource layer:
    Declares operation role boundary.

Service/domain layer:
    Enforces actual business permission.
```

---

## 20. Case Management Example

Misal regulatory case system punya roles:

```text
CASE_VIEWER
CASE_OFFICER
CASE_APPROVER
CASE_SUPERVISOR
SYSTEM_AUDITOR
TENANT_ADMIN
```

Actions:

```text
VIEW_CASE
ASSIGN_CASE
UPDATE_CASE
APPROVE_CASE
REJECT_CASE
CLOSE_CASE
REOPEN_CASE
EXPORT_CASE
```

States:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_APPROVAL
APPROVED
REJECTED
CLOSED
```

### 20.1 Declarative Layer

```java
@Path("/cases")
@RolesAllowed({"CASE_VIEWER", "CASE_OFFICER", "CASE_APPROVER", "CASE_SUPERVISOR"})
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto view(@PathParam("id") Long id) {
        return caseApplication.view(id);
    }

    @POST
    @Path("/{id}/approve")
    @RolesAllowed({"CASE_APPROVER", "CASE_SUPERVISOR"})
    public Response approve(@PathParam("id") Long id) {
        caseApplication.approve(id);
        return Response.noContent().build();
    }
}
```

### 20.2 Domain Layer

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject ActorProvider actorProvider;
    @Inject CaseRepository caseRepository;
    @Inject AuthorizationService authorization;
    @Inject CaseWorkflow workflow;

    public CaseDto view(Long id) {
        Actor actor = actorProvider.currentActor();
        CaseRecord c = caseRepository.get(id);

        authorization.require(actor, Action.VIEW_CASE, c);

        return CaseDto.from(c);
    }

    public void approve(Long id) {
        Actor actor = actorProvider.currentActor();
        CaseRecord c = caseRepository.getForUpdate(id);

        authorization.require(actor, Action.APPROVE_CASE, c);

        workflow.approve(c, actor);
    }
}
```

### 20.3 Why Both?

Declarative check answers:

```text
Is this caller broadly allowed to use approval endpoint?
```

Domain check answers:

```text
Can this caller approve this specific case now?
```

Different questions. Both are needed.

---

## 21. Permission Matrix Design

A permission matrix helps translate declarative role checks into explicit reviewable rules.

Example:

| Operation | Endpoint | Declarative Role | Domain Check Required | Notes |
|---|---|---:|---:|---|
| View case | `GET /cases/{id}` | `CASE_VIEWER`, `CASE_OFFICER`, `CASE_APPROVER`, `CASE_SUPERVISOR` | Yes | tenant + assignment + confidentiality |
| Update case | `PUT /cases/{id}` | `CASE_OFFICER` | Yes | state must allow edit |
| Approve case | `POST /cases/{id}/approve` | `CASE_APPROVER`, `CASE_SUPERVISOR` | Yes | maker-checker rule |
| Export case | `GET /cases/{id}/export` | `CASE_SUPERVISOR`, `SYSTEM_AUDITOR` | Yes | audit event mandatory |
| Reopen case | `POST /cases/{id}/reopen` | `CASE_SUPERVISOR` | Yes | only closed/rejected cases |
| Admin reindex | `POST /admin/reindex` | `PLATFORM_ADMIN` | Maybe | operational audit mandatory |

Matrix ini bisa dipakai untuk:

- security review;
- QA test design;
- audit evidence;
- onboarding developer;
- preventing endpoint drift.

---

## 22. Static Analysis dan Route Inventory

Untuk sistem besar, kita perlu tahu:

```text
Semua endpoint apa saja?
Annotation security-nya apa?
Default access-nya apa?
Domain check-nya apa?
```

Output ideal:

| Resource | Method | Path | Annotation | Domain Check | Risk |
|---|---|---|---|---|---|
| `CaseResource` | `view` | `GET /cases/{id}` | `@RolesAllowed(...)` | `VIEW_CASE` | Medium |
| `CaseResource` | `approve` | `POST /cases/{id}/approve` | `@RolesAllowed(CASE_APPROVER)` | `APPROVE_CASE` | High |
| `AdminResource` | `reindex` | `POST /admin/reindex` | `@RolesAllowed(PLATFORM_ADMIN)` | none | High |
| `HealthResource` | `live` | `GET /health/live` | `@PermitAll` | none | Low |

Tooling bisa dibuat dengan:

- annotation scanning saat build;
- ArchUnit test;
- reflection-based test;
- JAX-RS resource model inspection;
- OpenAPI generation + security metadata;
- manual registry.

Contoh ArchUnit-style pseudo-rule:

```java
// Pseudocode
allClasses()
    .that().areAnnotatedWith(Path.class)
    .should().beAnnotatedWith(RolesAllowed.class)
    .orShould().beAnnotatedWith(PermitAll.class)
    .orShould().beAnnotatedWith(DenyAll.class);
```

Intinya:

```text
Tidak boleh ada endpoint tanpa security intent eksplisit.
```

---

## 23. Testing Declarative Authorization

### 23.1 Test Matrix Minimal

Untuk setiap protected endpoint/method:

1. anonymous caller;
2. authenticated caller tanpa role;
3. authenticated caller dengan wrong role;
4. authenticated caller dengan correct role;
5. correct role tapi wrong tenant/resource;
6. correct role dan correct domain permission;
7. expired session/token;
8. role changed after login;
9. unsupported HTTP method;
10. path variant.

### 23.2 Example Test Cases

Endpoint:

```text
POST /cases/123/approve
```

Expected:

| Caller | Role | Domain | Expected |
|---|---|---|---:|
| anonymous | none | none | 401 / login redirect |
| authenticated user | `CASE_VIEWER` | irrelevant | 403 |
| authenticated user | `CASE_APPROVER` | not assigned / wrong tenant | 403 or masked 404 |
| authenticated user | `CASE_APPROVER` | assigned + valid state | 204 |
| authenticated user | `CASE_SUPERVISOR` | valid override | 204 |
| authenticated user | `PLATFORM_ADMIN` | no domain permission | depends on explicit policy |

### 23.3 Testing Annotation Actually Works

Bukan hanya test service method langsung.

Buruk:

```java
new CaseResource().approve(123L);
```

Ini tidak melewati container/security runtime.

Lebih baik:

- integration test via HTTP;
- embedded/container test;
- Arquillian-like test;
- Testcontainers with app server;
- framework-specific security test harness;
- mock identity injected through runtime-supported mechanism.

---

## 24. Observability dan Audit

Declarative authorization denial sebaiknya menghasilkan audit/log yang cukup untuk troubleshooting, tanpa membocorkan data sensitif.

Minimum event internal:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "layer": "DECLARATIVE_ROLE_CHECK",
  "actorId": "u-123",
  "principalName": "alice",
  "roles": ["CASE_VIEWER"],
  "requiredRoles": ["CASE_APPROVER", "CASE_SUPERVISOR"],
  "resource": "POST /cases/{id}/approve",
  "correlationId": "req-abc",
  "tenantId": "agency-01",
  "decision": "DENY",
  "reasonCode": "MISSING_REQUIRED_ROLE"
}
```

Tapi jangan log:

- raw token;
- password;
- full session cookie;
- sensitive personal data;
- full IdP assertion;
- private certificate key;
- excessive claims.

### 24.1 User-Facing Error

Untuk user:

```json
{
  "error": "forbidden",
  "message": "You do not have permission to perform this action.",
  "correlationId": "req-abc"
}
```

Untuk admin/audit internal, detail bisa dicari via correlation ID.

---

## 25. Common Failure Modes

### 25.1 Annotation Tidak Aktif

Penyebab:

- class tidak managed by container;
- method dipanggil via self-invocation;
- wrong namespace import;
- runtime tidak mendukung annotation pada component type tersebut;
- final/private/static method;
- proxy tidak terbentuk;
- security extension belum enabled.

### 25.2 Role Mapping Salah

Penyebab:

- IdP group name berbeda;
- case sensitivity;
- prefix mismatch;
- environment mapping beda antara DEV/UAT/PROD;
- token claim berubah;
- LDAP group rename;
- container realm salah.

### 25.3 URL Constraint Bolong

Penyebab:

- path variant;
- method variant;
- reverse proxy rewrite;
- missing trailing slash;
- static resource path;
- error dispatcher;
- sub-resource locator.

### 25.4 Default-Allow Endpoint Baru

Penyebab:

- developer lupa annotation;
- no CI rule;
- code review fokus business logic;
- generated endpoint;
- health/admin endpoint sementara.

### 25.5 Domain Permission Dilewati

Penyebab:

- hanya `@RolesAllowed`;
- service dipakai dari channel lain;
- batch job memakai system role terlalu luas;
- admin role dianggap boleh semua;
- tenant check dilakukan di UI saja.

### 25.6 Role Terlalu Luas

Penyebab:

- `USER`, `ADMIN`, `STAFF` terlalu generik;
- privilege creep;
- composite role tidak direview;
- temporary access tidak dicabut;
- role dipakai untuk convenience.

---

## 26. Design Heuristics Untuk Engineer Senior

### 26.1 Treat Annotation As Entry Gate, Not Final Truth

Annotation bagus untuk boundary awal. Jangan jadikan satu-satunya authorization untuk data/action kritis.

### 26.2 Make Security Intent Explicit

Setiap endpoint harus terlihat jelas:

```text
public?
authenticated?
role-protected?
domain-protected?
internal-only?
```

### 26.3 Use Business Role Names

Role harus merepresentasikan capability bisnis, bukan detail IdP.

### 26.4 Default Deny For Sensitive Areas

Admin, case management, financial, regulatory, audit, document, profile, and integration endpoints harus fail closed.

### 26.5 Verify Runtime Behavior

Jangan asumsikan annotation pada CDI/JAX-RS/interface/final method aktif. Test di runtime target.

### 26.6 Separate Role From Permission

Role menjawab “kelompok capability besar”. Permission menjawab “boleh melakukan action ini pada resource ini dalam context ini”.

### 26.7 Audit Denial and Privileged Access

Deny event dan privileged success event sama-sama penting.

### 26.8 Avoid Silent Bypass Path

Jika service bisa dipanggil dari HTTP, batch, message, dan admin console, authorization harus berada di shared domain boundary.

---

## 27. Practical Blueprint

Untuk aplikasi Jakarta enterprise:

### 27.1 Define Role Catalog

```java
public final class AppRoles {
    public static final String CASE_VIEWER = "CASE_VIEWER";
    public static final String CASE_OFFICER = "CASE_OFFICER";
    public static final String CASE_APPROVER = "CASE_APPROVER";
    public static final String CASE_SUPERVISOR = "CASE_SUPERVISOR";
    public static final String SYSTEM_AUDITOR = "SYSTEM_AUDITOR";
    public static final String TENANT_ADMIN = "TENANT_ADMIN";
    public static final String PLATFORM_ADMIN = "PLATFORM_ADMIN";

    private AppRoles() {}
}
```

Note: annotation values must be compile-time constants, so constants like this can help avoid typo.

```java
@RolesAllowed(AppRoles.CASE_APPROVER)
public void approve(...) {}
```

### 27.2 Define Permission Catalog

```java
public enum Action {
    VIEW_CASE,
    UPDATE_CASE,
    APPROVE_CASE,
    REJECT_CASE,
    ASSIGN_CASE,
    CLOSE_CASE,
    REOPEN_CASE,
    EXPORT_CASE
}
```

### 27.3 Resource Layer

```java
@Path("/cases")
@RolesAllowed({AppRoles.CASE_VIEWER, AppRoles.CASE_OFFICER, AppRoles.CASE_APPROVER, AppRoles.CASE_SUPERVISOR})
public class CaseResource {

    @Inject CaseApplicationService app;

    @GET
    @Path("/{id}")
    public CaseDto view(@PathParam("id") Long id) {
        return app.view(id);
    }

    @POST
    @Path("/{id}/approve")
    @RolesAllowed({AppRoles.CASE_APPROVER, AppRoles.CASE_SUPERVISOR})
    public Response approve(@PathParam("id") Long id) {
        app.approve(id);
        return Response.noContent().build();
    }
}
```

### 27.4 Application Service Layer

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject ActorProvider actorProvider;
    @Inject CaseRepository cases;
    @Inject AuthorizationService authz;
    @Inject CaseWorkflow workflow;

    public CaseDto view(Long id) {
        Actor actor = actorProvider.currentActor();
        CaseRecord c = cases.get(id);
        authz.require(actor, Action.VIEW_CASE, c);
        return CaseDto.from(c);
    }

    public void approve(Long id) {
        Actor actor = actorProvider.currentActor();
        CaseRecord c = cases.getForUpdate(id);
        authz.require(actor, Action.APPROVE_CASE, c);
        workflow.approve(c, actor);
    }
}
```

### 27.5 Authorization Service

```java
@ApplicationScoped
public class AuthorizationService {

    public void require(Actor actor, Action action, CaseRecord c) {
        AuthorizationDecision decision = decide(actor, action, c);
        audit(decision);

        if (!decision.allowed()) {
            throw new ForbiddenException(decision.safeReasonCode());
        }
    }

    private AuthorizationDecision decide(Actor actor, Action action, CaseRecord c) {
        if (!actor.tenantId().equals(c.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH");
        }

        if (action == Action.APPROVE_CASE) {
            if (!actor.hasAnyRole(AppRoles.CASE_APPROVER, AppRoles.CASE_SUPERVISOR)) {
                return AuthorizationDecision.deny("MISSING_ROLE");
            }
            if (!c.state().equals(CaseState.PENDING_APPROVAL)) {
                return AuthorizationDecision.deny("INVALID_STATE");
            }
            if (c.createdBy().equals(actor.userId())) {
                return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION");
            }
            return AuthorizationDecision.allow();
        }

        return AuthorizationDecision.deny("UNSUPPORTED_ACTION");
    }
}
```

---

## 28. Review Checklist

Untuk setiap endpoint/method baru, tanyakan:

1. Apakah endpoint punya explicit security annotation/constraint?
2. Apakah public endpoint memang public?
3. Apakah `@PermitAll` dipakai sengaja atau karena malas?
4. Apakah role name adalah business role stabil?
5. Apakah mapping IdP group → app role jelas?
6. Apakah method ini bisa dipanggil dari channel lain?
7. Apakah domain permission diperlukan?
8. Apakah tenant/resource/state/relationship dicek?
9. Apakah wrong role menghasilkan 403?
10. Apakah anonymous menghasilkan 401/login redirect?
11. Apakah denial diaudit?
12. Apakah success privileged action diaudit?
13. Apakah test mencakup wrong role?
14. Apakah test mencakup correct role but wrong resource?
15. Apakah annotation aktif di runtime target?
16. Apakah self-invocation/proxy issue mungkin terjadi?
17. Apakah method final/private/static?
18. Apakah ada path/method variant yang tidak protected?
19. Apakah OpenAPI/security docs sesuai runtime?
20. Apakah behavior DEV/UAT/PROD sama?

---

## 29. Java 8 sampai Java 25 Considerations

### 29.1 Java 8 Era

Banyak aplikasi Java EE 7/8 masih memakai:

```java
javax.annotation.security.*
javax.servlet.*
javax.ejb.*
```

App server:

- WebLogic older;
- JBoss/WildFly older;
- Payara/GlassFish older;
- TomEE;
- traditional enterprise containers.

Concern:

- older annotation behavior;
- JACC/JASPIC vendor-specific config;
- SecurityManager era assumptions;
- legacy JAAS realm;
- servlet XML-heavy config.

### 29.2 Jakarta EE 9+ Era

Namespace berpindah ke:

```java
jakarta.annotation.security.*
jakarta.servlet.*
jakarta.ejb.*
```

Concern:

- import migration;
- dependencies mixed `javax` and `jakarta`;
- library compatibility;
- app server support;
- annotation not recognized due to wrong package.

### 29.3 Java 17+ / Jakarta EE 11

Jakarta EE 11 specs generally align with newer Java baseline. Jakarta Servlet 6.1, for example, targets Jakarta EE 11 and has Java SE 17 as minimum for containers.

Concern:

- older Java EE app cannot just run unchanged;
- build tool source/target release matters;
- app server supports specific Jakarta EE level;
- annotation package mismatch becomes common migration bug.

### 29.4 Java 21+ / Virtual Threads

Declarative authorization itself is not about virtual threads, but security context propagation can be affected by runtime/thread model.

Questions:

- is security context thread-local?
- does managed executor propagate it?
- does virtual-thread execution preserve expected context?
- does async callback happen after request context closed?

These will be deeper in Part 22.

---

## 30. Summary Mental Model

Declarative authorization is best understood as:

```text
Security intent written as metadata and enforced by container/framework at known boundaries.
```

It is excellent for:

- URL-level protection;
- endpoint-level role boundary;
- EJB/method-level role checks;
- making coarse access rules visible;
- reducing repetitive authorization boilerplate;
- providing a reviewable security map.

It is not enough for:

- tenant isolation;
- object-level permission;
- state-machine-aware actions;
- maker-checker control;
- assignment/delegation;
- row-level access;
- conflict-of-interest rule;
- emergency override audit;
- cross-channel service invocation.

The senior-engineer rule:

```text
Use declarative authorization to close the front door.
Use domain authorization to decide whether the actor may perform this action on this resource in this context.
```

The production rule:

```text
Every endpoint must have explicit security intent.
Every critical action must have domain authorization.
Every denial and privileged success must be auditable.
Every assumption about annotation enforcement must be tested in the real runtime.
```

---

## 31. References

- Jakarta Security 4.0 Specification: https://jakarta.ee/specifications/security/4.0/
- Jakarta Security 4.0 Specification Document: https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta Annotations 3.0 Specification: https://jakarta.ee/specifications/annotations/3.0/annotations-spec-3.0
- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Authorization 3.0 Specification: https://jakarta.ee/specifications/authorization/3.0/
- Jakarta Enterprise Beans 4.0 Core Specification: https://jakarta.ee/specifications/enterprise-beans/4.0/jakarta-enterprise-beans-spec-core-4.0
- Jakarta EE Tutorial — Securing Enterprise Applications: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-jakartaee/security-jakartaee.html
- Jakarta EE Starter Guide — Securing RESTful Web Service: https://jakarta.ee/learn/starter-guides/how-to-secure-a-restful-web-service/

---

## 32. Status Seri

Selesai sampai:

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
Part 10 — Jakarta Authentication / JASPIC Deep Dive
Part 11 — Jakarta Authorization / JACC Deep Dive
Part 12 — Declarative Authorization: URL, Method, Class, Role
```

Berikutnya:

```text
Part 13 — Programmatic Authorization and Domain Permission Design
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — Jakarta Authorization / JACC Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-11-jakarta-authorization-jacc-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 13 — Programmatic Authorization and Domain Permission Design](./learn-java-jakarta-security-authentication-authorization-identity-part-13-programmatic-authorization-domain-permissions.md)
