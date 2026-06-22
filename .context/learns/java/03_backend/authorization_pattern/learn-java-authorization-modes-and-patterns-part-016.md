# learn-java-authorization-modes-and-patterns-part-016

# Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: memahami authorization di Jakarta EE modern secara presisi: container-managed authorization, role annotation, programmatic security, Jakarta Security, dan Jakarta Authorization/JACC SPI.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 15, kita sudah membangun mental model authorization dari sisi umum, Spring, domain, policy, RBAC, ABAC, ACL, ReBAC, object-level authorization, dan layered enforcement.

Part ini berpindah ke ekosistem **Jakarta EE**.

Tujuannya bukan mengulang authentication atau servlet/JAX-RS basic. Tujuannya adalah menjawab pertanyaan yang sering membingungkan engineer senior sekalipun:

1. Apa sebenarnya yang dilakukan Jakarta EE container ketika melihat `@RolesAllowed`?
2. Apa beda Jakarta Security, Jakarta Authentication, dan Jakarta Authorization?
3. Kapan cukup memakai declarative role authorization?
4. Kapan perlu programmatic authorization?
5. Kapan Jakarta Authorization/JACC relevan?
6. Bagaimana menggabungkan container authorization dengan domain authorization?
7. Apa batas model role-based container authorization untuk sistem enterprise/regulatory?
8. Bagaimana desain yang tetap masuk akal dari Java EE 8 era `javax.*` sampai Jakarta EE modern `jakarta.*`?

Mental model utama:

> Jakarta EE authorization adalah **container-mediated access control**. Ia kuat untuk boundary standar seperti web endpoint, servlet, EJB/CDI method, dan role declaration. Tetapi authorization domain yang kaya — tenant, case state, assignment, segregation of duties, object ownership, delegation, break-glass — tetap harus dimodelkan sebagai domain/policy decision, bukan dipaksa masuk semua ke `@RolesAllowed`.

---

## 1. Peta Istilah: Jangan Campur Tiga Spesifikasi

Di Jakarta EE, area security sering terlihat seperti satu hal, padahal ada beberapa lapisan.

### 1.1 Jakarta Security

Jakarta Security menyediakan API standar untuk mengamankan aplikasi Jakarta EE dengan paradigma modern. Pada Jakarta EE 11, Jakarta Security 4.0 adalah rilis terkait platform tersebut. Spesifikasi ini terutama membantu aplikasi mendefinisikan mekanisme authentication dan identity store yang berinteraksi dengan container.

Yang relevan untuk authorization:

- menyediakan caller identity/principal,
- menyediakan group/role information,
- menyediakan `SecurityContext`,
- memungkinkan aplikasi bertanya apakah caller berada dalam role tertentu.

Tetapi Jakarta Security bukan policy engine domain authorization penuh.

### 1.2 Jakarta Authentication

Jakarta Authentication mendefinisikan SPI low-level untuk authentication mechanism. Ia berurusan dengan bagaimana caller membuktikan identitasnya ke container.

Dalam seri ini, Jakarta Authentication hanya penting sebagai sumber identity dan group membership untuk authorization. Detail login flow tidak dibahas ulang.

### 1.3 Jakarta Authorization

Jakarta Authorization adalah spesifikasi low-level SPI untuk authorization module. Versi Jakarta Authorization 3.0 adalah rilis untuk Jakarta EE 11. Spesifikasi ini mendefinisikan model permission dan binding container access decisions ke permission classes, meneruskan warisan JACC.

Yang penting:

- ini level rendah,
- lebih ditujukan untuk container, integrator, vendor, library writer,
- bukan biasanya API harian developer aplikasi,
- memakai konsep `Policy`, `PolicyConfiguration`, permission classes, dan policy context.

### 1.4 Annotation Security

Annotation seperti berikut berada di package `jakarta.annotation.security` pada Jakarta era modern:

```java
@RolesAllowed("case-officer")
@PermitAll
@DenyAll
@DeclareRoles({"case-officer", "supervisor"})
@RunAs("system-worker")
```

Di era Java EE / Jakarta EE 8 lama, annotation ini berada di namespace `javax.annotation.security`.

---

## 2. Evolusi Namespace: `javax.*` ke `jakarta.*`

Salah satu hal penting untuk Java 8–25 adalah memahami perubahan namespace.

### 2.1 Era Java EE / Jakarta EE 8

Kode lama biasanya memakai:

```java
import javax.annotation.security.RolesAllowed;
import javax.annotation.security.PermitAll;
import javax.annotation.security.DenyAll;
```

Aplikasi Java 8 enterprise banyak berada di era ini.

### 2.2 Era Jakarta EE 9+

Jakarta EE 9 melakukan namespace switch besar-besaran dari `javax.*` ke `jakarta.*`.

Kode modern memakai:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.DenyAll;
```

### 2.3 Implikasi Migration

Migration authorization bukan hanya search-replace package.

Hal yang harus dicek:

1. Application server mendukung Jakarta namespace atau tidak.
2. Library/framework memakai `javax` atau `jakarta`.
3. CDI/JAX-RS runtime melakukan interception terhadap annotation security yang mana.
4. Test framework menggunakan security context yang sesuai.
5. Build dependency tidak mencampur `javax.annotation-api` dan `jakarta.annotation-api` secara tidak sengaja.
6. Legacy `javax.security.jacc` perlu dimigrasikan ke `jakarta.security.jacc` jika memakai JACC/Jakarta Authorization.

Anti-pattern:

```text
Aplikasi sudah pindah ke jakarta.*, tetapi sebagian library security masih membaca annotation javax.*.
```

Dampaknya: annotation authorization tampak ada di source code, tetapi runtime tidak menegakkannya.

---

## 3. Container-Managed Authorization Mental Model

Dalam Jakarta EE, container adalah runtime yang menangani banyak cross-cutting concern:

- lifecycle,
- dependency injection,
- transaction,
- servlet dispatch,
- security,
- concurrency,
- resource management.

Container-managed authorization berarti:

> Developer mendeklarasikan security constraints; container melakukan enforcement pada titik masuk atau method invocation yang berada dalam kendalinya.

Contoh:

```java
@Path("/cases")
@RolesAllowed("case-officer")
public class CaseResource {

    @GET
    @Path("/{id}")
    public Response getCase(@PathParam("id") String id) {
        return Response.ok().build();
    }
}
```

Secara konseptual, container melakukan:

```text
incoming request
  -> authenticate caller
  -> map caller to principal/groups/roles
  -> match target resource/method
  -> inspect security constraints/annotations
  -> check whether caller is in required role
  -> allow invocation or deny before method body runs
```

Hal penting:

> Container authorization biasanya menjawab “boleh memanggil operation ini?” berdasarkan role. Ia tidak otomatis menjawab “boleh memanggil operation ini terhadap object instance tersebut?”

Itu perbedaan endpoint-level authorization dan object-level/domain authorization.

---

## 4. Role-Based Declarative Authorization

### 4.1 `@RolesAllowed`

`@RolesAllowed` menyatakan role yang diizinkan mengakses class atau method.

```java
import jakarta.annotation.security.RolesAllowed;

@Path("/appeals")
@RolesAllowed("appeal-officer")
public class AppealResource {

    @GET
    public List<AppealSummary> list() {
        return List.of();
    }
}
```

Jika diletakkan di class, berlaku untuk semua method di class tersebut, kecuali method memiliki annotation yang lebih spesifik.

```java
@Path("/cases")
@RolesAllowed("case-user")
public class CaseResource {

    @GET
    public List<CaseSummary> list() {
        return List.of();
    }

    @POST
    @RolesAllowed("case-creator")
    public Response create(CreateCaseRequest request) {
        return Response.status(201).build();
    }
}
```

Mental model:

```text
class-level annotation = default rule for all operations in resource/class
method-level annotation = operation-specific override
```

### 4.2 `@PermitAll`

`@PermitAll` berarti semua caller boleh memanggil method tersebut.

```java
@GET
@Path("/public-config")
@PermitAll
public PublicConfig getPublicConfig() {
    return configService.getPublicConfig();
}
```

Hati-hati: “all” bisa berarti semua authenticated user atau benar-benar publik tergantung container, endpoint type, deployment descriptor, dan security configuration. Jangan pakai `@PermitAll` untuk data yang hanya terlihat “tidak sensitif” tanpa threat model.

### 4.3 `@DenyAll`

`@DenyAll` berarti tidak ada role yang boleh memanggil method tersebut.

```java
@DELETE
@Path("/{id}")
@DenyAll
public Response hardDelete(@PathParam("id") String id) {
    throw new UnsupportedOperationException();
}
```

Kegunaan nyata:

1. Menutup operation yang ada karena interface/legacy tetapi tidak boleh dipakai.
2. Mengamankan method default di class yang sebagian method-nya dibuka eksplisit.
3. Menjadi guard saat fitur belum siap.

### 4.4 `@DeclareRoles`

`@DeclareRoles` mendeklarasikan role yang dipakai aplikasi.

```java
@DeclareRoles({"case-officer", "supervisor", "auditor"})
@ApplicationPath("/api")
public class ApplicationConfig extends Application {
}
```

Ini membantu container memahami role universe aplikasi, tetapi tidak menggantikan assignment user-role.

### 4.5 `@RunAs`

`@RunAs` mengatur identity yang dipakai komponen saat memanggil komponen lain.

```java
@RunAs("system-worker")
public class ScheduledCaseNotifier {
    public void run() {
        notificationService.sendPendingNotifications();
    }
}
```

Ini berbahaya jika tidak dipahami.

`@RunAs` bukan “jalan pintas admin”. Ia harus diperlakukan sebagai **delegated technical authority** dengan audit yang jelas.

---

## 5. Programmatic Authorization di Jakarta EE

Declarative authorization tidak cukup untuk keputusan yang memerlukan resource instance atau context runtime.

Contoh:

```text
User punya role case-officer.
Tetapi apakah ia boleh membuka case #123?
Tergantung:
- agency case tersebut,
- assignment officer,
- state case,
- confidentiality flag,
- delegation,
- conflict of interest,
- break-glass status.
```

Untuk ini, gunakan programmatic authorization.

### 5.1 Servlet `HttpServletRequest.isUserInRole`

```java
@Inject
HttpServletRequest request;

public void check() {
    if (!request.isUserInRole("case-officer")) {
        throw new ForbiddenException();
    }
}
```

Kelemahan:

- terlalu servlet-specific,
- sulit dites jika tersebar di banyak service,
- tetap role-only,
- tidak menyelesaikan domain/object authorization.

### 5.2 Jakarta Security `SecurityContext`

```java
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

public class CurrentCaller {

    @Inject
    SecurityContext securityContext;

    public boolean isSupervisor() {
        return securityContext.isCallerInRole("supervisor");
    }

    public String principalName() {
        return securityContext.getCallerPrincipal().getName();
    }
}
```

Lebih portable untuk Jakarta Security dibanding langsung bergantung pada servlet request.

### 5.3 JAX-RS `SecurityContext`

```java
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.SecurityContext;

@Path("/cases")
public class CaseResource {

    @Context
    SecurityContext securityContext;

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id) {
        if (!securityContext.isUserInRole("case-user")) {
            throw new ForbiddenException();
        }
        return findCase(id);
    }
}
```

Cocok untuk resource-level logic, tetapi jangan biarkan domain authorization tersebar di resource class.

### 5.4 Domain Authorization Service

Untuk sistem serius, wrapper diperlukan:

```java
@ApplicationScoped
public class CaseAuthorizationService {

    @Inject
    CurrentCaller currentCaller;

    @Inject
    CaseRepository caseRepository;

    public AuthorizationDecision canViewCase(String caseId) {
        Caller caller = currentCaller.requireCaller();
        CaseRecord record = caseRepository.findAuthorizationView(caseId)
                .orElse(null);

        if (record == null) {
            return AuthorizationDecision.hidden("CASE_NOT_FOUND_OR_NOT_VISIBLE");
        }

        if (!caller.hasRole("case-user")) {
            return AuthorizationDecision.deny("MISSING_CASE_USER_ROLE");
        }

        if (!caller.agencyId().equals(record.agencyId())) {
            return AuthorizationDecision.hidden("CROSS_AGENCY_BOUNDARY");
        }

        if (record.confidential() && !caller.hasRole("confidential-case-reader")) {
            return AuthorizationDecision.deny("CONFIDENTIAL_CASE_REQUIRES_SPECIAL_PERMISSION");
        }

        return AuthorizationDecision.allow("CASE_VISIBLE_TO_CALLER");
    }
}
```

Resource usage:

```java
@GET
@Path("/{id}")
@RolesAllowed("case-user")
public CaseDto get(@PathParam("id") String id) {
    AuthorizationDecision decision = caseAuthorizationService.canViewCase(id);
    decision.throwIfDenied();
    return caseService.getCase(id);
}
```

Layering:

```text
@RolesAllowed("case-user")
  = coarse-grained entry guard

caseAuthorizationService.canViewCase(id)
  = object/domain guard
```

Ini jauh lebih defensible daripada memaksa seluruh domain rule menjadi role string.

---

## 6. Coarse-Grained vs Fine-Grained Jakarta Authorization

Jakarta annotation security sangat baik untuk coarse-grained boundary.

Contoh cocok:

```java
@RolesAllowed("report-user")
@Path("/reports")
public class ReportResource { }
```

Artinya:

> Hanya user dengan role report-user yang boleh masuk ke area report.

Tetapi ini belum cukup untuk:

```text
Report mana yang boleh dilihat?
Agency mana?
Periode mana?
Data sensitif mana?
Boleh preview tapi tidak export?
Boleh aggregate tapi tidak row-level detail?
```

Fine-grained harus memakai domain/policy layer.

### 6.1 Rule of Thumb

Gunakan annotation untuk:

- endpoint group,
- module-level access,
- operation class,
- coarse permission,
- default deny/open declaration,
- simple admin/internal endpoint.

Gunakan domain authorization service untuk:

- object instance,
- tenant/agency boundary,
- workflow state,
- maker-checker,
- assignment,
- confidential record,
- delegation,
- export/report/query filtering,
- field-level masking,
- historical/audit-sensitive decision.

---

## 7. Jakarta Authorization / JACC Mental Model

Jakarta Authorization melanjutkan konsep JACC.

Spesifikasi ini mendefinisikan bagaimana security constraint container diterjemahkan menjadi permission object dan bagaimana policy provider mengevaluasi apakah subject memiliki permission tertentu.

### 7.1 Konsep Inti

Konseptual:

```text
Container constraint
  -> translated into permission objects
  -> stored/managed in policy configuration
  -> evaluated by policy provider
  -> decision returned to container
```

Komponen penting:

1. `Policy`
2. `PolicyConfiguration`
3. `PolicyConfigurationFactory`
4. `PolicyContext`
5. permission classes untuk servlet/EJB/container-specific operation

### 7.2 Kenapa Developer Jarang Menyentuh Ini Langsung?

Karena Jakarta Authorization adalah SPI, bukan high-level application authorization API.

Biasanya disentuh oleh:

- application server vendor,
- security provider integrator,
- platform engineer,
- library/framework engineer,
- enterprise yang ingin mengganti/menambah policy provider container.

Untuk aplikasi biasa, `@RolesAllowed`, `SecurityContext`, dan domain authorization service lebih praktis.

### 7.3 Kapan Jakarta Authorization/JACC Relevan?

Relevan jika:

1. Anda menulis atau mengintegrasikan authorization provider untuk application server.
2. Anda butuh custom container authorization behavior.
3. Anda membangun platform internal di atas Jakarta EE server.
4. Anda perlu compliance dengan model permission Jakarta EE container.
5. Anda memigrasikan legacy Java EE yang sudah memakai JACC provider.
6. Anda perlu memahami kenapa annotation authorization berperilaku berbeda antar server.

Tidak ideal jika:

1. Anda hanya butuh object-level authorization per case/order/document.
2. Anda ingin policy engine domain yang business-readable.
3. Anda membangun microservice Spring Boot biasa.
4. Anda ingin ABAC/ReBAC kompleks di application service.

---

## 8. Java EE / Jakarta EE Security Annotations in Practice

### 8.1 Endpoint Resource Example

```java
package com.example.caseapp.boundary;

import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;

@Path("/cases")
@RolesAllowed("case-user")
public class CaseResource {

    @Inject
    CaseApplicationService caseApplicationService;

    @GET
    @Path("/{caseId}")
    public Response getCase(@PathParam("caseId") String caseId) {
        CaseDto dto = caseApplicationService.getCase(caseId);
        return Response.ok(dto).build();
    }
}
```

This means:

```text
Only callers mapped to role case-user may invoke methods in this resource.
```

It does not mean:

```text
The caller may access every case ID passed to this endpoint.
```

### 8.2 Service-Level Domain Check

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    CaseAuthorizationService authorization;

    @Inject
    CaseRepository cases;

    public CaseDto getCase(String caseId) {
        AuthorizationDecision decision = authorization.canViewCase(caseId);
        decision.throwIfDenied();

        CaseRecord record = cases.getRequired(caseId);
        return CaseDto.from(record);
    }
}
```

### 8.3 Why Not Put Everything in JAX-RS Resource?

Bad:

```java
@GET
@Path("/{caseId}")
public Response getCase(@PathParam("caseId") String caseId) {
    if (!securityContext.isUserInRole("case-user")) {
        throw new ForbiddenException();
    }
    CaseRecord record = repository.find(caseId);
    if (!record.agencyId().equals(currentAgency())) {
        throw new NotFoundException();
    }
    if (record.confidential() && !securityContext.isUserInRole("confidential-reader")) {
        throw new ForbiddenException();
    }
    return Response.ok(toDto(record)).build();
}
```

Problem:

- authorization duplicated in resource,
- hard to test,
- hard to audit,
- easy to bypass from batch/internal service,
- no reusable decision object,
- no reason taxonomy,
- no domain language.

Better:

```java
AuthorizationDecision decision = caseAuthorization.canView(caseId);
decision.throwIfDenied();
```

---

## 9. Role Mapping: The Hidden Source of Bugs

`@RolesAllowed("supervisor")` hanya bekerja jika container tahu caller memiliki role `supervisor`.

Sumber role bisa berasal dari:

- identity store group,
- realm group,
- LDAP group,
- OIDC claim,
- application server role mapping,
- deployment descriptor,
- vendor-specific config,
- custom Jakarta Security identity store.

### 9.1 Role Name Mismatch

Common failure:

```text
Token/group contains: CASE_SUPERVISOR
Code expects: supervisor
```

At runtime:

```java
@RolesAllowed("supervisor")
```

will deny.

### 9.2 Prefix Mistakes

Spring sering punya isu `ROLE_` prefix. Jakarta EE tidak selalu memiliki semantik prefix yang sama, tetapi application server/vendor/realm mapping bisa punya konvensi sendiri.

Jangan asumsikan role string portable antar runtime.

### 9.3 Case Sensitivity

Role naming harus dianggap case-sensitive kecuali runtime secara eksplisit menyatakan lain.

Bad:

```text
CaseOfficer
case-officer
CASE_OFFICER
case_officer
```

Better:

```text
case-officer
case-supervisor
case-auditor
```

Satu grammar. Satu style. Satu registry.

### 9.4 Role Registry

Buat role registry di aplikasi:

```java
public final class Roles {
    private Roles() {}

    public static final String CASE_USER = "case-user";
    public static final String CASE_OFFICER = "case-officer";
    public static final String CASE_SUPERVISOR = "case-supervisor";
    public static final String AUDITOR = "auditor";
}
```

Usage:

```java
@RolesAllowed(Roles.CASE_OFFICER)
```

Catatan: annotation value harus compile-time constant. `public static final String` literal bisa dipakai.

---

## 10. Deployment Descriptor vs Annotation

Jakarta EE historis mendukung declarative security lewat deployment descriptor seperti `web.xml` dan annotation.

Modern code lebih sering memakai annotation, tetapi descriptor masih muncul di enterprise legacy.

### 10.1 Annotation Advantages

- dekat dengan code,
- mudah dibaca saat review,
- cocok untuk service/resource method,
- mudah dicari di IDE.

### 10.2 Descriptor Advantages

- bisa override deployment behavior,
- cocok untuk legacy server policy,
- bisa dipisahkan dari source code,
- kadang diperlukan oleh enterprise deployment process.

### 10.3 Risk

Jika annotation dan descriptor bertentangan, runtime behavior bisa membingungkan tergantung spesifikasi dan container.

Prinsip:

```text
Jangan campur declarative authorization style tanpa dokumentasi eksplisit.
```

Jika harus campur, buat matrix:

| Area | Source of Truth | Override Allowed | Owner |
|---|---|---:|---|
| REST endpoint roles | Annotation | No | Application team |
| Legacy servlet constraints | web.xml | Yes | Platform team |
| Container role mapping | Server config | Yes | Security/platform team |
| Domain object authorization | Java policy service | No | Domain team |

---

## 11. Jakarta EE Security Context Variants

Ada beberapa `SecurityContext` yang sering membingungkan.

### 11.1 Jakarta Security Enterprise Context

```java
import jakarta.security.enterprise.SecurityContext;
```

Dipakai untuk application security API.

### 11.2 JAX-RS Security Context

```java
import jakarta.ws.rs.core.SecurityContext;
```

Dipakai di JAX-RS resource via `@Context`.

### 11.3 Servlet Request Role Check

```java
jakarta.servlet.http.HttpServletRequest#isUserInRole
```

### 11.4 Rule

Buat adapter internal:

```java
@ApplicationScoped
public class CurrentCallerProvider {

    @Inject
    jakarta.security.enterprise.SecurityContext securityContext;

    public Caller currentCaller() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            return Caller.anonymous();
        }

        return new Caller(
                principal.getName(),
                role -> securityContext.isCallerInRole(role)
        );
    }
}
```

Tujuannya:

- domain service tidak bergantung ke API container,
- testing lebih mudah,
- role semantics bisa distandardisasi,
- caller attributes bisa ditambahkan.

---

## 12. Authorization Decision Object untuk Jakarta EE

Jangan hanya return boolean.

Bad:

```java
boolean canApprove(CaseId caseId);
```

Better:

```java
public final class AuthorizationDecision {

    private final boolean allowed;
    private final DenialMode denialMode;
    private final String reasonCode;
    private final Map<String, String> evidence;

    private AuthorizationDecision(
            boolean allowed,
            DenialMode denialMode,
            String reasonCode,
            Map<String, String> evidence
    ) {
        this.allowed = allowed;
        this.denialMode = denialMode;
        this.reasonCode = reasonCode;
        this.evidence = evidence;
    }

    public static AuthorizationDecision allow(String reasonCode) {
        return new AuthorizationDecision(true, DenialMode.NONE, reasonCode, Map.of());
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(false, DenialMode.FORBIDDEN, reasonCode, Map.of());
    }

    public static AuthorizationDecision hidden(String reasonCode) {
        return new AuthorizationDecision(false, DenialMode.NOT_FOUND, reasonCode, Map.of());
    }

    public void throwIfDenied() {
        if (allowed) {
            return;
        }
        if (denialMode == DenialMode.NOT_FOUND) {
            throw new jakarta.ws.rs.NotFoundException();
        }
        throw new jakarta.ws.rs.ForbiddenException();
    }
}
```

Java 8 note: `Map.of()` tidak tersedia. Untuk Java 8 gunakan `Collections.emptyMap()` atau builder kecil.

Java 17+ note: bisa dibuat sebagai `record`.

```java
public record AuthorizationDecision(
        boolean allowed,
        DenialMode denialMode,
        String reasonCode,
        Map<String, String> evidence
) { }
```

Tetapi jika target library Java 8, gunakan class biasa.

---

## 13. Jakarta EE and Java Version Compatibility

### 13.1 Java 8

Banyak aplikasi Java EE/Jakarta EE 8 berjalan di Java 8.

Constraints:

- tidak ada records,
- tidak ada sealed types,
- tidak ada switch expression,
- tidak ada virtual threads,
- banyak kode masih `javax.*`,
- container lama mungkin punya behavior vendor-specific.

Authorization style yang aman:

- constants untuk role,
- immutable class manual,
- explicit service methods,
- CDI beans,
- annotation security,
- integration tests di container nyata.

### 13.2 Java 11/17

Banyak Jakarta EE 9/10 runtime berjalan di Java 11/17.

Bisa mulai memakai:

- var lokal, jika disukai,
- records untuk DTO internal jika baseline 16+,
- sealed classes jika baseline 17+,
- better HTTP client untuk external PDP integration.

### 13.3 Java 21/25

Virtual threads dan structured concurrency dapat memengaruhi desain external PDP call, bulk authorization, dan audit publishing.

Tetapi authorization semantics tidak berubah hanya karena Java lebih baru.

Prinsip:

```text
Gunakan fitur Java baru untuk clarity/performance, bukan untuk mengubah model security.
```

---

## 14. CDI Interceptors and Authorization

Jakarta EE memberi CDI dan interceptor model. Anda bisa membuat authorization annotation custom.

### 14.1 Custom Annotation

```java
import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresPermission {
    String value();
}
```

### 14.2 Interceptor

```java
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.interceptor.AroundInvoke;
import jakarta.interceptor.Interceptor;
import jakarta.interceptor.InvocationContext;

@Interceptor
@RequiresPermission("")
@Priority(Interceptor.Priority.APPLICATION)
public class RequiresPermissionInterceptor {

    @Inject
    PermissionAuthorizationService authorization;

    @AroundInvoke
    public Object authorize(InvocationContext ctx) throws Exception {
        RequiresPermission annotation = findAnnotation(ctx);
        if (annotation == null) {
            return ctx.proceed();
        }

        AuthorizationDecision decision = authorization.canExecute(annotation.value(), ctx.getParameters());
        decision.throwIfDenied();

        return ctx.proceed();
    }

    private RequiresPermission findAnnotation(InvocationContext ctx) {
        RequiresPermission methodAnnotation = ctx.getMethod().getAnnotation(RequiresPermission.class);
        if (methodAnnotation != null) {
            return methodAnnotation;
        }
        return ctx.getTarget().getClass().getAnnotation(RequiresPermission.class);
    }
}
```

### 14.3 Usage

```java
@ApplicationScoped
public class CaseCommandService {

    @RequiresPermission("case.approve")
    public void approve(ApproveCaseCommand command) {
        // command execution
    }
}
```

### 14.4 Caveat

Custom interceptor bagus untuk coarse permission, tetapi object-specific authorization membutuhkan parameter extraction yang hati-hati.

Bad:

```java
@RequiresPermission("case.approve")
public void approve(String caseId) { }
```

Interceptor harus tahu parameter mana adalah resource ID.

Lebih eksplisit:

```java
public void approve(ApproveCaseCommand command) {
    authorization.authorizeApprove(command.caseId());
    // execute
}
```

Top 1% heuristic:

> Annotation bagus untuk deklarasi intention. Domain authorization service bagus untuk correctness.

---

## 15. EJB Method Authorization Legacy and Lessons

Di sistem Java EE lama, EJB method security sering dipakai:

```java
@Stateless
@RolesAllowed("finance-approver")
public class PaymentApprovalBean {
    public void approve(String paymentId) { }
}
```

Pelajaran yang masih relevan:

1. Method boundary adalah titik authorization yang kuat.
2. Transaction dan authorization ordering harus jelas.
3. Role-based method security tidak menyelesaikan object-level rule.
4. Remote invocation membutuhkan identity propagation yang benar.
5. `RunAs` harus diaudit.

Dalam Jakarta EE modern, Anda mungkin memakai CDI/JAX-RS lebih banyak daripada EJB, tetapi konsep boundary tetap penting.

---

## 16. Jakarta REST / JAX-RS Authorization

JAX-RS resource sering menjadi entry point utama.

### 16.1 Recommended Baseline

```java
@Path("/admin")
@DenyAll
public class AdminResource {

    @GET
    @Path("/health")
    @PermitAll
    public Response health() {
        return Response.ok().build();
    }

    @POST
    @Path("/reindex")
    @RolesAllowed("system-admin")
    public Response reindex() {
        return Response.accepted().build();
    }
}
```

Pattern:

```text
Class default: DenyAll
Method exceptions: PermitAll / RolesAllowed
```

This is more defensible than:

```text
Class has no default rule, only some methods are annotated.
```

Because unannotated method exposure is a common mistake.

### 16.2 Runtime Differences

Some runtimes have configuration to deny unannotated endpoints by default. Others may not. Do not rely on assumptions.

Always verify:

1. Does runtime enforce annotations on JAX-RS resources?
2. Are CDI proxies/interceptors involved?
3. Does method-level annotation override class-level annotation as expected?
4. Are sub-resource locators protected?
5. Are inherited methods protected?
6. Are OPTIONS/preflight requests handled correctly?
7. Are exception mappers leaking denial details?

---

## 17. Default Deny Strategy in Jakarta EE

Authorization design should prefer deny-by-default.

### 17.1 Application Class Pattern

```java
@ApplicationPath("/api")
@DeclareRoles({
        Roles.CASE_USER,
        Roles.CASE_OFFICER,
        Roles.CASE_SUPERVISOR,
        Roles.AUDITOR,
        Roles.SYSTEM_ADMIN
})
public class CaseManagementApplication extends Application {
}
```

### 17.2 Resource Class Pattern

```java
@Path("/cases")
@DenyAll
public class CaseResource {

    @GET
    @RolesAllowed(Roles.CASE_USER)
    public List<CaseSummary> list() {
        return List.of();
    }

    @POST
    @RolesAllowed(Roles.CASE_OFFICER)
    public Response create(CreateCaseRequest request) {
        return Response.status(201).build();
    }
}
```

### 17.3 Why Class-Level `@DenyAll` Helps

If a developer adds:

```java
@DELETE
@Path("/{id}")
public Response delete(@PathParam("id") String id) { }
```

It remains denied unless explicitly opened.

This is one of the most effective low-cost controls.

---

## 18. Combining Jakarta Security with External Identity Provider

Modern Jakarta EE apps often authenticate via OIDC/SAML/enterprise IdP, but authorization is still mapped into container roles.

Conceptual flow:

```text
External IdP
  -> authenticates user
  -> emits identity/groups/claims
  -> Jakarta runtime/security mechanism validates identity
  -> groups mapped to application roles
  -> @RolesAllowed checks roles
  -> domain service performs object/context policy
```

Do not confuse:

```text
IdP group == application role == domain permission
```

They are different abstraction levels.

Recommended mapping:

```text
IdP group
  -> coarse application role
  -> application permission/capability
  -> domain decision
```

Example:

```text
IdP group: CEA-ACEAS-CASE-OFFICERS
Application role: case-officer
Permission: case.update
Domain rule: can update only assigned active case within same agency
```

---

## 19. Tenant and Agency Boundary in Jakarta EE

`@RolesAllowed("case-officer")` does not imply tenant access.

Bad:

```java
@GET
@Path("/{caseId}")
@RolesAllowed("case-officer")
public CaseDto get(@PathParam("caseId") String caseId) {
    return caseRepository.find(caseId).map(CaseDto::from).orElseThrow(NotFoundException::new);
}
```

This is BOLA/IDOR risk.

Better:

```java
@GET
@Path("/{caseId}")
@RolesAllowed("case-officer")
public CaseDto get(@PathParam("caseId") String caseId) {
    AuthorizationDecision decision = caseAuthorization.canView(caseId);
    decision.throwIfDenied();
    return caseQuery.getVisibleCase(caseId, currentCaller.agencyId());
}
```

Even better:

```java
public Optional<CaseRecord> findVisibleCase(CaseId caseId, AgencyId agencyId) {
    return em.createQuery("""
        select c
        from CaseRecord c
        where c.id = :caseId
          and c.agencyId = :agencyId
        """, CaseRecord.class)
        .setParameter("caseId", caseId.value())
        .setParameter("agencyId", agencyId.value())
        .getResultStream()
        .findFirst();
}
```

Do not check tenant only after loading full object if the query itself can be scoped.

---

## 20. Query, Report, and Export Authorization

Jakarta annotation security protects the method call, not every row returned by your query.

Problem:

```java
@GET
@Path("/export")
@RolesAllowed("report-user")
public Response export() {
    byte[] csv = reportService.exportAllCases();
    return Response.ok(csv).build();
}
```

This is dangerous if `exportAllCases()` is not scoped.

Better:

```java
@GET
@Path("/export")
@RolesAllowed("report-user")
public Response export() {
    Caller caller = currentCaller.requireCaller();
    ExportScope scope = reportAuthorization.authorizedExportScope(caller);
    byte[] csv = reportService.exportCases(scope);
    return Response.ok(csv).build();
}
```

`ExportScope` should include:

- tenant/agency IDs,
- allowed case types,
- allowed fields,
- max sensitivity level,
- date range constraints,
- masking rules,
- export reason if required.

---

## 21. Async Jobs, Schedulers, and System Identity

Jakarta EE apps often have scheduled jobs, MDBs, batch jobs, or async tasks.

Question:

```text
Who is the subject when there is no human user?
```

Possible subjects:

1. system identity,
2. service account,
3. original initiating user,
4. delegated user,
5. batch role,
6. tenant-specific worker identity.

Bad:

```java
public void runJob() {
    // no authorization because it is internal
}
```

Better:

```java
public void runJob() {
    Caller system = Caller.system("case-expiry-worker");
    AuthorizationDecision decision = jobAuthorization.canExpireCases(system);
    decision.throwIfDenied();
    expiryService.expireEligibleCases(system);
}
```

Internal execution still needs authorization semantics, even if not `@RolesAllowed`.

### 21.1 Message-Driven Authorization

For message processing:

```text
message arrives
  -> validate producer/source
  -> determine subject/workload identity
  -> determine tenant/context
  -> authorize operation
  -> process idempotently
  -> audit decision
```

Do not assume queue/topic ACL equals business authorization.

---

## 22. Exception Handling: 401, 403, 404

Jakarta REST typically maps:

- unauthenticated: `401 Unauthorized`,
- authenticated but forbidden: `403 Forbidden`,
- hidden resource: `404 Not Found`.

Domain authorization decision should decide whether denial is visible or hidden.

Example:

```java
public void throwIfDenied() {
    if (allowed) return;

    switch (denialMode) {
        case NOT_FOUND:
            throw new NotFoundException();
        case FORBIDDEN:
            throw new ForbiddenException();
        default:
            throw new ForbiddenException();
    }
}
```

Rule:

```text
Cross-tenant/object existence leakage -> often 404.
Known operation but insufficient permission -> often 403.
Missing/invalid authentication -> 401.
```

---

## 23. Auditing Jakarta Authorization Decisions

Container denial may be logged by the server, but domain authorization needs application-level audit.

Audit fields:

| Field | Meaning |
|---|---|
| correlation_id | Trace request/job/message |
| subject_id | Caller principal/service identity |
| subject_type | human/system/service/delegated |
| roles | Effective coarse roles |
| action | Operation requested |
| resource_type | Case/report/document/etc. |
| resource_id | Object ID if safe to log |
| tenant_id | Tenant/agency boundary |
| decision | allow/deny/hidden |
| reason_code | Machine-readable reason |
| policy_version | Domain policy version |
| attributes_snapshot | Minimal decision evidence |
| source | web/api/job/message |

Example:

```java
@ApplicationScoped
public class AuthorizationAuditSink {

    public void record(AuthorizationAuditEvent event) {
        // write to audit log / event stream / append-only storage
    }
}
```

Do not log sensitive object details unnecessarily.

---

## 24. Testing Jakarta Authorization

### 24.1 Unit Test Domain Authorization

Domain authorization service should be testable without container.

```java
@Test
public void officerCannotViewCaseFromDifferentAgency() {
    Caller caller = Caller.human("u1")
            .withRole("case-officer")
            .withAgency("agency-a");

    CaseAuthorizationView record = new CaseAuthorizationView(
            "case-1",
            "agency-b",
            false,
            "ACTIVE"
    );

    AuthorizationDecision decision = policy.canView(caller, record);

    assertFalse(decision.allowed());
    assertEquals("CROSS_AGENCY_BOUNDARY", decision.reasonCode());
}
```

### 24.2 Integration Test Annotation Security

You must test in a runtime/container-compatible setup:

1. unauthenticated caller denied,
2. authenticated caller without role denied,
3. caller with role allowed,
4. method-level override works,
5. unannotated endpoint is denied if that is your policy,
6. role mapping from identity provider works.

### 24.3 Test Matrix

| Scenario | Expected |
|---|---|
| No identity calls protected endpoint | 401/403 depending runtime |
| User without role calls `@RolesAllowed` endpoint | 403 |
| User with role calls endpoint but wrong tenant object | 404/403 based policy |
| User with role calls own tenant object | 200 |
| New method added without annotation | denied |
| Export called by report viewer without export permission | 403 |
| Batch worker without system capability | denied/audited |

---

## 25. Common Failure Modes

### 25.1 Annotation Not Enforced

Cause:

- runtime not configured,
- wrong namespace,
- JAX-RS integration missing,
- CDI proxy bypass,
- method invoked internally not through container proxy.

Mitigation:

- integration test real runtime,
- default deny at resource class,
- architecture rule scanning annotations,
- avoid relying on self-invocation interception.

### 25.2 Role Mapping Broken

Cause:

- IdP group mismatch,
- realm mapping missing,
- different case/prefix,
- server-specific deployment config.

Mitigation:

- role registry,
- role mapping tests,
- startup validation,
- admin diagnostics endpoint restricted to security admin.

### 25.3 Endpoint Protected, Object Not Protected

Cause:

- `@RolesAllowed` mistaken as full authorization,
- repository not scoped,
- report/export bypass.

Mitigation:

- domain authorization service,
- query scoping,
- BOLA tests,
- export scope model.

### 25.4 Internal Method Bypass

Cause:

- method annotation only works through container/proxy,
- direct `this.method()` call bypasses interceptor,
- batch job calls service method directly.

Mitigation:

- explicit authorization inside application service,
- boundary tests,
- avoid using annotations as the only domain guard.

### 25.5 `@PermitAll` Used Too Broadly

Cause:

- health/config/version endpoints expanded over time,
- public endpoint starts returning sensitive info,
- developer assumes “metadata is safe”.

Mitigation:

- public endpoint inventory,
- response contract review,
- security regression tests,
- minimal public DTO.

---

## 26. Jakarta EE Authorization Design Patterns

### 26.1 Boundary Guard + Domain Guard

```text
@RolesAllowed
  -> protects operation entry
DomainAuthorizationService
  -> protects object/context/state
Repository scope
  -> protects query result
Audit
  -> records decision
```

### 26.2 Default Deny Resource

```java
@Path("/cases")
@DenyAll
public class CaseResource {
    @GET
    @RolesAllowed(Roles.CASE_USER)
    public List<CaseSummary> list() { }
}
```

### 26.3 Caller Adapter

```text
Jakarta SecurityContext
  -> CurrentCallerProvider
  -> Caller value object
  -> Domain authorization service
```

### 26.4 Role Registry

```text
No raw role strings except in one registry.
```

### 26.5 Explicit Decision Object

```text
Never return only boolean for non-trivial authorization.
```

### 26.6 Query Scope Object

```java
public final class CaseQueryScope {
    private final String agencyId;
    private final Set<String> allowedCaseTypes;
    private final boolean includeConfidential;
}
```

Use this to prevent report/search/export leakage.

---

## 27. Jakarta EE vs Spring Security: Conceptual Comparison

| Concern | Jakarta EE | Spring Security |
|---|---|---|
| Runtime model | Container-managed | Filter/proxy/framework-managed |
| Annotation role check | `@RolesAllowed`, `@PermitAll`, `@DenyAll` | `@PreAuthorize`, `@Secured`, JSR-250 support |
| Security context | Jakarta Security/JAX-RS/Servlet context | `SecurityContextHolder` / reactive context |
| Core request authorization | Servlet/container constraints | Security filter chain + `AuthorizationManager` |
| Low-level authorization SPI | Jakarta Authorization/JACC | custom `AuthorizationManager`, ACL, method security |
| Domain authorization | application-defined | application-defined |
| Typical pitfall | assuming container role == object authorization | assuming `hasRole` == object authorization |

Key conclusion:

> Different framework, same invariant: endpoint/method role checks are not enough for object-level/domain authorization.

---

## 28. Practical Architecture for Jakarta EE Case Management

Imagine regulatory case management.

### 28.1 Requirements

- Case officer can view assigned cases in same agency.
- Supervisor can view team cases.
- Auditor can view read-only case audit data across agencies only if audit assignment exists.
- Case officer cannot approve own submitted recommendation.
- Confidential cases need extra permission.
- Export requires explicit export capability.
- Support access requires break-glass with reason.

### 28.2 Role Layer

```java
public final class Roles {
    public static final String CASE_USER = "case-user";
    public static final String CASE_OFFICER = "case-officer";
    public static final String CASE_SUPERVISOR = "case-supervisor";
    public static final String CASE_AUDITOR = "case-auditor";
    public static final String EXPORT_USER = "export-user";
    public static final String SUPPORT_OPERATOR = "support-operator";
}
```

### 28.3 Resource Layer

```java
@Path("/cases")
@DenyAll
public class CaseResource {

    @Inject
    CaseApplicationService service;

    @GET
    @Path("/{id}")
    @RolesAllowed(Roles.CASE_USER)
    public CaseDto get(@PathParam("id") String id) {
        return service.getCase(id);
    }

    @POST
    @Path("/{id}/approve")
    @RolesAllowed(Roles.CASE_SUPERVISOR)
    public Response approve(@PathParam("id") String id, ApproveRequest request) {
        service.approve(id, request);
        return Response.noContent().build();
    }

    @GET
    @Path("/export")
    @RolesAllowed(Roles.EXPORT_USER)
    public Response export() {
        return service.exportVisibleCases();
    }
}
```

### 28.4 Application Service Layer

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    CaseAuthorizationService authorization;

    @Inject
    CaseRepository repository;

    public CaseDto getCase(String id) {
        AuthorizationDecision decision = authorization.canViewCase(id);
        decision.throwIfDenied();
        return repository.findVisibleCase(decision.queryScope(), id)
                .map(CaseDto::from)
                .orElseThrow(NotFoundException::new);
    }

    public void approve(String id, ApproveRequest request) {
        AuthorizationDecision decision = authorization.canApproveCase(id);
        decision.throwIfDenied();
        // execute transition
    }
}
```

### 28.5 Authorization Service Layer

```java
@ApplicationScoped
public class CaseAuthorizationService {

    @Inject
    CurrentCallerProvider callers;

    @Inject
    CaseAuthorizationRepository cases;

    public AuthorizationDecision canApproveCase(String caseId) {
        Caller caller = callers.requireCaller();
        CaseAuthorizationView view = cases.findAuthorizationView(caseId)
                .orElse(null);

        if (view == null) {
            return AuthorizationDecision.hidden("CASE_NOT_FOUND");
        }

        if (!caller.hasRole(Roles.CASE_SUPERVISOR)) {
            return AuthorizationDecision.deny("MISSING_SUPERVISOR_ROLE");
        }

        if (!caller.agencyId().equals(view.agencyId())) {
            return AuthorizationDecision.hidden("CROSS_AGENCY_BOUNDARY");
        }

        if (caller.userId().equals(view.submittedBy())) {
            return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION");
        }

        if (!"PENDING_APPROVAL".equals(view.state())) {
            return AuthorizationDecision.deny("CASE_NOT_PENDING_APPROVAL");
        }

        return AuthorizationDecision.allow("SUPERVISOR_CAN_APPROVE_CASE");
    }
}
```

This is Jakarta-compatible and domain-correct.

---

## 29. Advanced Considerations

### 29.1 Multi-Runtime Portability

If code must run on multiple Jakarta runtimes:

- avoid vendor-specific role APIs unless isolated,
- integration test each runtime,
- keep role mapping documented,
- use standard annotations where possible,
- isolate custom security provider code.

### 29.2 MicroProfile JWT

Many Jakarta EE-style runtimes support MicroProfile JWT for token-based identity. Even then, token groups/claims should map into application roles and then into domain decisions. Do not treat JWT claim as complete authorization.

### 29.3 External PDP

If integrating OPA/Cedar/custom PDP:

```text
Jakarta SecurityContext
  -> Caller
  -> Authorization input document
  -> External PDP
  -> Decision object
  -> JAX-RS exception/audit
```

Keep container annotation for coarse boundary if useful.

### 29.4 Virtual Threads

Jakarta EE 11 ecosystem increasingly discusses modern Java features including virtual threads, but authorization semantics remain the same. Be careful with thread-local security context if using custom concurrency. Always verify context propagation.

---

## 30. Review Checklist

Use this checklist for Jakarta EE authorization review.

### 30.1 Endpoint Boundary

- [ ] Every JAX-RS resource has explicit class-level security posture.
- [ ] Sensitive resources are not left unannotated.
- [ ] `@PermitAll` endpoints are inventoried.
- [ ] Admin/internal endpoints require explicit role.
- [ ] Method-level override is intentional.

### 30.2 Role Mapping

- [ ] Role names are centralized.
- [ ] IdP groups are mapped to app roles explicitly.
- [ ] Role mapping is tested.
- [ ] Case/prefix conventions are documented.
- [ ] No business logic depends on raw external group names.

### 30.3 Domain Authorization

- [ ] Object-level authorization exists.
- [ ] Tenant/agency boundary enforced before data exposure.
- [ ] Query/search/export uses scoped predicates.
- [ ] Workflow transitions have authorization guards.
- [ ] Maker-checker and separation of duty are tested.

### 30.4 Runtime and Migration

- [ ] No accidental mix of `javax.*` and `jakarta.*` security annotations.
- [ ] Container version supports chosen annotations.
- [ ] JACC/Jakarta Authorization usage is intentional.
- [ ] CDI interceptors are tested through proxy invocation.
- [ ] Application server differences are documented.

### 30.5 Audit

- [ ] Allow/deny decisions are auditable.
- [ ] Reason codes are stable.
- [ ] Sensitive data is not over-logged.
- [ ] Break-glass/support access is specially audited.
- [ ] Historical decisions can be reconstructed sufficiently.

---

## 31. Top 1% Insight

A strong engineer does not ask only:

```text
Can I annotate this method with @RolesAllowed?
```

They ask:

```text
What exact boundary is this annotation enforcing?
What authorization question remains unanswered?
Where is object-level access enforced?
Where is query scoping enforced?
How is role mapping proven?
How is denial audited?
What happens if this method is called internally, asynchronously, or through a different entry point?
```

Jakarta EE gives a useful container authorization mechanism. But the container cannot infer your domain invariants.

The mature design is layered:

```text
Container annotation
  -> coarse module/operation gate

Caller adapter
  -> stable internal subject model

Domain authorization service
  -> object/context/state decision

Query scope
  -> data boundary enforcement

Audit
  -> defensibility and reconstruction
```

That is the difference between “security annotation exists” and “authorization is actually correct.”

---

## 32. Summary

In this part, we learned:

1. Jakarta Security, Jakarta Authentication, and Jakarta Authorization solve different problems.
2. `@RolesAllowed`, `@PermitAll`, and `@DenyAll` are useful but mostly coarse-grained.
3. Jakarta Authorization/JACC is a low-level SPI, not usually the application-level authorization model.
4. Role mapping is a major source of production bugs.
5. `javax.*` to `jakarta.*` migration affects authorization enforcement.
6. Container authorization should be combined with domain authorization service.
7. Object-level, tenant-level, workflow-level, and export-level authorization must not be delegated blindly to annotations.
8. Deny-by-default class-level posture is a strong Jakarta EE pattern.
9. Internal jobs/messages/service calls still need authorization semantics.
10. Auditability is part of authorization design, not an afterthought.

---

## 33. References

1. Jakarta Authorization specification page — https://jakarta.ee/specifications/authorization/
2. Jakarta Authorization 3.0 specification — https://jakarta.ee/specifications/authorization/3.0/jakarta-authorization-spec-3.0
3. Jakarta Security specification page — https://jakarta.ee/specifications/security/
4. Jakarta Security 4.0 specification — https://jakarta.ee/specifications/security/4.0/
5. Jakarta Authentication specification page — https://jakarta.ee/specifications/authentication/
6. Jakarta EE Tutorial: Getting Started Securing Enterprise Applications — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-jakartaee/security-jakartaee.html
7. Jakarta EE Tutorial: Introduction to Security in Jakarta EE — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-intro/security-intro.html
8. Jakarta annotation security APIs — https://jakarta.ee/specifications/annotations/
9. Jakarta EE security/authorization/authentication explained — https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/
10. OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
11. OWASP API Security 2023: Broken Object Level Authorization — https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

---

## 34. Status Seri

Selesai:

- Part 0 — Authorization Mental Model
- Part 1 — Authorization Vocabulary, Semantics, and Invariants
- Part 2 — Java Platform Authorization Primitives
- Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- Part 4 — RBAC Done Properly
- Part 5 — Permission and Capability Modeling
- Part 6 — ABAC
- Part 7 — PBAC and Policy-as-Code
- Part 8 — ReBAC
- Part 9 — ACL and Domain Object Security
- Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- Part 11 — IDOR, BOLA, and Object-Level Authorization
- Part 12 — Authorization in Layered Java Applications
- Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- Part 14 — Spring Method Security: Service-Level Authorization
- Part 15 — Spring Domain Authorization Patterns
- Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization

Belum selesai. Part berikutnya:

**Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-015.md">⬅️ Part 15 — Spring Domain Authorization Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-017.md">Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging ➡️</a>
</div>
