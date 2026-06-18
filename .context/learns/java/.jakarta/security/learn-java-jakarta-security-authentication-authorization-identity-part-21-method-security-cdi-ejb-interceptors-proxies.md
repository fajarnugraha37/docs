# Learn Java Jakarta Security Authentication Authorization Identity — Part 21
# Method Security with CDI, EJB, Interceptors, and Proxies

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> Part: `21 / 35`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-21-method-security-cdi-ejb-interceptors-proxies.md`

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya kita sudah membangun fondasi:

- authentication mechanism,
- identity establishment,
- role/group/claim/scope mapping,
- declarative authorization,
- programmatic domain authorization,
- token/session/federation/mTLS.

Sekarang kita masuk ke salah satu enforcement boundary paling penting di aplikasi enterprise Java/Jakarta: **method security**.

Method security adalah mekanisme untuk menegakkan authorization pada boundary pemanggilan method, biasanya di service layer, resource layer, EJB layer, atau CDI bean layer.

Tujuan utamanya bukan sekadar menaruh annotation seperti:

```java
@RolesAllowed("ADMIN")
public void approve() { ... }
```

Melainkan memahami:

1. **method mana yang benar-benar diamankan oleh container/proxy/interceptor;**
2. **kapan annotation dievaluasi dan oleh siapa;**
3. **bagaimana security context tersedia di dalam method;**
4. **kenapa self-invocation bisa melewati interceptor;**
5. **bagaimana urutan security, transaction, validation, logging, dan audit memengaruhi correctness;**
6. **bagaimana membuat custom security annotation yang cocok untuk domain authorization;**
7. **bagaimana menghindari bypass yang sering terjadi di production.**

Bagian ini penting karena banyak sistem enterprise terlihat sudah aman di URL/API layer, tetapi sebenarnya service method internal masih bisa dipanggil dari path lain tanpa authorization yang setara.

---

## 1. Mental Model: Authorization Boundary Tidak Sama dengan Endpoint Boundary

Aplikasi biasanya punya beberapa lapisan:

```text
Client
  -> Gateway / Reverse Proxy
  -> Servlet Filter / Jakarta Security Mechanism
  -> JAX-RS Resource / Servlet Controller
  -> Application Service
  -> Domain Service
  -> Repository / DAO
  -> Database
```

Kalau security hanya dipasang di endpoint, maka asumsi implisitnya adalah:

```text
Setiap akses ke domain operation pasti lewat endpoint yang benar.
```

Ini asumsi yang lemah.

Dalam sistem nyata, operation yang sama bisa dipanggil dari:

- REST endpoint,
- batch job,
- event consumer,
- admin screen,
- workflow engine,
- scheduler,
- integration adapter,
- internal API,
- test endpoint,
- migration script,
- maintenance console.

Karena itu authorization sering lebih aman jika critical domain operation juga punya enforcement di method boundary.

Contoh:

```java
@ApplicationScoped
public class CaseApprovalService {

    @RolesAllowed("CASE_APPROVER")
    public void approveCase(String caseId) {
        // approve case
    }
}
```

Tetapi untuk sistem kompleks, role-only check tidak cukup:

```java
@CanApproveCase
public void approveCase(String caseId) {
    // approve case
}
```

Annotation custom seperti `@CanApproveCase` dapat diarahkan ke interceptor yang mengevaluasi:

```text
caller identity
+ active tenant
+ case ownership
+ current case state
+ assignment
+ delegation
+ conflict-of-interest rule
+ maker-checker rule
+ emergency override
```

Inilah pergeseran dari method security sebagai “role annotation” menuju method security sebagai **domain enforcement boundary**.

---

## 2. Apa Itu Method Security?

Method security adalah authorization yang dievaluasi sebelum, sesudah, atau sekitar eksekusi method.

Bentuknya bisa berupa:

1. **container-provided security annotation**
   - `@RolesAllowed`,
   - `@PermitAll`,
   - `@DenyAll`,
   - `@RunAs`.

2. **EJB method security**
   - role-based access pada EJB method.

3. **CDI interceptor-based custom security**
   - annotation custom seperti `@CanApproveCase`.

4. **JAX-RS name binding filter/interceptor**
   - lebih dekat ke endpoint method, bukan service method murni.

5. **manual programmatic check inside method**
   - `securityContext.isCallerInRole(...)`,
   - `authorizationService.assertCan(...)`.

6. **framework-specific security**
   - Spring Security method security,
   - Quarkus security annotations,
   - vendor-specific extensions.

Dalam seri ini kita fokus pada model Java/Jakarta, tetapi mental modelnya berlaku lintas framework.

---

## 3. Layer-Layer Method Security di Jakarta

### 3.1 Servlet/JAX-RS Resource Method

Contoh:

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseApprovalService approvalService;

    @POST
    @Path("/{id}/approve")
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("id") String id) {
        approvalService.approveCase(id);
        return Response.noContent().build();
    }
}
```

Ini mengamankan endpoint method.

Kelemahannya:

- kalau `approvalService.approveCase` dipanggil dari endpoint lain, check bisa hilang;
- kalau ada batch/admin path, bisa bypass;
- role check tidak memahami state case.

### 3.2 Application Service Method

```java
@ApplicationScoped
public class CaseApprovalService {

    @RolesAllowed("CASE_APPROVER")
    public void approveCase(String caseId) {
        // domain operation
    }
}
```

Ini lebih dekat ke domain operation.

Kelemahannya:

- behavior tergantung apakah annotation security didukung di CDI bean/container tersebut;
- self-invocation bisa bypass;
- role-only check masih dangkal.

### 3.3 Domain-Specific Method Security

```java
@ApplicationScoped
public class CaseApprovalService {

    @CanApproveCase(caseIdParam = "caseId")
    public void approveCase(String caseId) {
        // domain operation
    }
}
```

Ini lebih kuat karena check tidak hanya role, tetapi permission terhadap resource spesifik.

---

## 4. Annotation Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`

### 4.1 `@RolesAllowed`

`@RolesAllowed` mendeklarasikan role yang diperbolehkan memanggil method/class.

```java
@RolesAllowed("CASE_OFFICER")
public CaseDetail viewCase(String caseId) {
    return caseRepository.findDetail(caseId);
}
```

Jika caller tidak authenticated atau tidak punya role tersebut, container/interceptor seharusnya menolak.

Secara mental:

```text
caller groups/roles established by authentication layer
    -> role mapping container/application
    -> method security interceptor checks role
    -> allow or deny invocation
```

### 4.2 `@PermitAll`

`@PermitAll` berarti semua caller boleh mengakses.

```java
@PermitAll
public HealthStatus health() {
    return HealthStatus.ok();
}
```

Hati-hati: “all” bisa berarti authenticated dan unauthenticated tergantung konteks/container/endpoint. Untuk endpoint publik, pastikan juga URL layer tidak memaksa login.

### 4.3 `@DenyAll`

`@DenyAll` berarti tidak ada caller yang boleh mengakses.

```java
@DenyAll
public void dangerousMaintenanceOperation() {
    // disabled
}
```

Ini berguna untuk:

- method base class yang tidak boleh dipanggil langsung;
- operation deprecated;
- default deny di parent class;
- temporary shutdown of dangerous operation.

### 4.4 Annotation di Class vs Method

```java
@RolesAllowed("CASE_USER")
public class CaseResource {

    public CaseDetail view(String id) {
        return service.view(id);
    }

    @RolesAllowed("CASE_APPROVER")
    public void approve(String id) {
        service.approve(id);
    }
}
```

Mental model:

- class-level annotation memberi default untuk semua method;
- method-level annotation biasanya override atau mempersempit sesuai aturan container/spec;
- jangan mengandalkan intuisi tanpa test, karena detail bisa berbeda antar layer/framework.

Prinsip aman:

```text
Untuk operation sensitif, deklarasikan security secara eksplisit di method.
```

---

## 5. `@RunAs`: Identity Saat Memanggil Komponen Lain

`@RunAs` memungkinkan sebuah komponen berjalan dengan role tertentu ketika memanggil komponen lain.

Contoh konseptual:

```java
@RunAs("SYSTEM_INTEGRATION")
public class ReportSchedulerBean {

    @EJB
    ReportGenerationBean generator;

    public void runDailyReport() {
        generator.generateRestrictedReport();
    }
}
```

Mental model:

```text
external caller identity
    -> enters component A
    -> component A calls component B under run-as role
    -> B sees caller role as SYSTEM_INTEGRATION-style role
```

Gunakan sangat hati-hati.

Risiko:

1. privilege escalation tersembunyi;
2. audit kehilangan actor asli;
3. run-as role terlalu luas;
4. confused deputy;
5. scheduler/admin operation terlihat seperti user biasa atau sebaliknya.

Prinsip desain:

```text
Run-as harus selalu menyimpan actor asli + effective actor.
```

Contoh audit:

```json
{
  "event": "REPORT_GENERATED",
  "initiator": "scheduler:daily-report",
  "effectiveRole": "SYSTEM_INTEGRATION",
  "onBehalfOf": null,
  "reason": "scheduled_daily_generation"
}
```

Kalau run-as dipicu oleh user:

```json
{
  "event": "CASE_EXPORT",
  "initiator": "user:alice",
  "effectiveRole": "SYSTEM_EXPORTER",
  "onBehalfOf": "user:alice",
  "reason": "user_requested_export"
}
```

---

## 6. CDI, EJB, dan Interceptors: Kenapa Method Security Tergantung Invocation Model

### 6.1 Invocation Langsung vs Container Invocation

Security annotation biasanya bekerja jika method dipanggil melalui container/proxy/interceptor.

```text
Client -> proxy/interceptor -> target method
```

Bukan:

```text
this.method() -> target method directly
```

Ini sumber banyak bypass.

### 6.2 CDI Bean Proxy

CDI sering menggunakan proxy untuk menerapkan interception, scope, lifecycle, dan decorator.

Contoh:

```java
@ApplicationScoped
public class CaseService {

    @Secured
    public void securedOperation() {
        // protected by interceptor if invoked through CDI proxy
    }
}
```

Kalau bean ini diinjeksi:

```java
@Inject
CaseService caseService;

caseService.securedOperation();
```

maka invocation kemungkinan melewati proxy/interceptor.

Tetapi kalau dari dalam class yang sama:

```java
public void outer() {
    securedOperation(); // self-invocation
}

@Secured
public void securedOperation() {
}
```

interceptor bisa tidak jalan karena method dipanggil langsung pada `this`.

---

## 7. Self-Invocation Problem

Self-invocation adalah kondisi ketika method dalam satu class memanggil method lain di class yang sama, sehingga proxy/interceptor tidak dilewati.

Contoh berbahaya:

```java
@ApplicationScoped
public class CaseService {

    public void submitAndApprove(String caseId) {
        submit(caseId);
        approve(caseId); // bypass interceptor if approve is protected by proxy
    }

    @CanApproveCase
    public void approve(String caseId) {
        // approval logic
    }
}
```

Jika `@CanApproveCase` diimplementasikan sebagai CDI interceptor, pemanggilan `approve(caseId)` dari `submitAndApprove` mungkin tidak dievaluasi.

### 7.1 Cara Menghindari

#### Option A — Pisahkan Bean

```java
@ApplicationScoped
public class CaseWorkflowService {

    @Inject
    CaseApprovalService approvalService;

    public void submitAndApprove(String caseId) {
        // submit
        approvalService.approve(caseId); // goes through proxy
    }
}

@ApplicationScoped
public class CaseApprovalService {

    @CanApproveCase
    public void approve(String caseId) {
        // approval logic
    }
}
```

#### Option B — Explicit Authorization Service

```java
public void approve(String caseId) {
    authorizationService.assertCanApprove(currentActor(), caseId);
    // approval logic
}
```

Ini tidak bergantung pada proxy.

#### Option C — Self Proxy Injection

Beberapa framework memungkinkan inject proxy diri sendiri. Tetapi ini sering membingungkan dan lebih sulit dirawat.

```java
@Inject
CaseService self;

public void submitAndApprove(String caseId) {
    self.approve(caseId);
}
```

Gunakan hanya jika tim paham konsekuensinya.

### 7.2 Prinsip Praktis

Untuk operation sangat sensitif:

```text
Jangan hanya bergantung pada interceptor.
Letakkan assert authorization eksplisit dekat dengan mutasi domain.
```

---

## 8. Private, Final, Static Method dan Proxy Limitation

Interceptors/proxies umumnya tidak bisa mengintercept semua jenis method.

Perhatikan:

| Method Type | Risiko |
|---|---|
| `private` | tidak bisa dipanggil melalui proxy publik |
| `final` | proxy subclass tidak bisa override |
| `static` | bukan instance invocation |
| constructor | object belum fully proxied |
| self-invoked method | proxy dilewati |
| package-private | tergantung proxy strategy |

Contoh anti-pattern:

```java
@CanApproveCase
private void approveInternal(String caseId) {
    // annotation likely useless
}
```

Kalau annotation security ditaruh pada method yang tidak pernah dipanggil melalui interceptor boundary, annotation itu hanya dokumentasi palsu.

Prinsip:

```text
Security annotation harus berada pada method yang benar-benar menjadi intercepted invocation boundary.
```

---

## 9. Ordering: Security vs Transaction vs Validation vs Audit

Method invocation enterprise sering melewati banyak interceptor:

```text
logging
 -> metrics
 -> security
 -> validation
 -> transaction
 -> audit
 -> target method
```

Atau:

```text
transaction
 -> security
 -> validation
 -> target method
```

Urutan penting.

### 9.1 Security Sebelum Transaction

Keuntungan:

- request unauthorized ditolak sebelum membuka transaction;
- mengurangi lock/DB overhead;
- lebih aman untuk operation mahal.

Kekurangan:

- authorization yang butuh DB harus membuka read context sendiri;
- kalau permission harus konsisten dengan update, TOCTOU risk muncul.

### 9.2 Transaction Sebelum Security

Keuntungan:

- authorization dan mutasi bisa berada dalam transaction yang sama;
- data yang dibaca untuk authorization bisa konsisten dengan update.

Kekurangan:

- unauthorized request tetap membuka transaction;
- denial bisa lebih mahal;
- audit/rollback behavior perlu jelas.

### 9.3 Validation Sebelum Security

Risiko:

- validation error bisa membocorkan informasi sebelum authorization dicek;
- attacker bisa tahu resource ID valid atau format domain.

Contoh:

```text
Unauthorized caller submits caseId = real case
Validation returns: "case already approved"
```

Ini bocor.

Untuk resource-sensitive operation, lebih aman:

```text
authenticate -> coarse authorization -> resource existence/ownership authorization -> validation -> mutation
```

### 9.4 Audit Ordering

Audit denial harus tercatat meskipun transaction bisnis tidak jalan.

Artinya audit security sering tidak boleh bergantung pada transaction bisnis yang bisa rollback.

Model:

```text
security audit event -> separate audit channel / append-only log
business transaction -> domain update
```

---

## 10. Domain-Specific Method Security Annotation

Role annotation cocok untuk coarse-grained access.

Tetapi domain enterprise butuh annotation yang membawa makna bisnis.

Contoh:

```java
@CanApproveCase
public void approveCase(String caseId) {
    // approval mutation
}
```

Annotation ini secara mental berarti:

```text
Caller may approve this specific case in its current state.
```

Bukan hanya:

```text
Caller has CASE_APPROVER role.
```

### 10.1 Definisi Annotation

```java
import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@InterceptorBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface CanApproveCase {
    String caseIdParam() default "caseId";
}
```

Catatan:

- `@InterceptorBinding` membuat annotation bisa dipakai untuk CDI interceptor.
- `caseIdParam` digunakan untuk mengambil parameter method.

### 10.2 Interceptor Skeleton

```java
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.interceptor.AroundInvoke;
import jakarta.interceptor.Interceptor;
import jakarta.interceptor.InvocationContext;

@CanApproveCase
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class CanApproveCaseInterceptor {

    @Inject
    AuthorizationService authorizationService;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        String caseId = extractCaseId(ctx);

        authorizationService.assertCanApproveCase(caseId);

        return ctx.proceed();
    }

    private String extractCaseId(InvocationContext ctx) {
        Object[] params = ctx.getParameters();

        // Simplified example. Production code should not rely on fragile index assumptions.
        if (params.length == 0 || !(params[0] instanceof String)) {
            throw new IllegalStateException("Cannot extract caseId from method parameters");
        }

        return (String) params[0];
    }
}
```

### 10.3 Production-Grade Parameter Extraction

Naive parameter extraction by index is fragile.

Better options:

#### Option A — Parameter Annotation

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface ResourceId {
    String value();
}
```

Usage:

```java
@CanApproveCase
public void approveCase(@ResourceId("case") String caseId) {
}
```

Interceptor:

```java
private String findResourceId(InvocationContext ctx, String resourceName) {
    Annotation[][] annotations = ctx.getMethod().getParameterAnnotations();
    Object[] values = ctx.getParameters();

    for (int i = 0; i < annotations.length; i++) {
        for (Annotation annotation : annotations[i]) {
            if (annotation instanceof ResourceId resourceId
                    && resourceId.value().equals(resourceName)) {
                return String.valueOf(values[i]);
            }
        }
    }

    throw new IllegalStateException("Missing @ResourceId(" + resourceName + ")");
}
```

Java 8-compatible style:

```java
if (annotation instanceof ResourceId) {
    ResourceId resourceId = (ResourceId) annotation;
    if (resourceId.value().equals(resourceName)) {
        return String.valueOf(values[i]);
    }
}
```

#### Option B — Command Object

```java
public record ApproveCaseCommand(String caseId, String comment) {}
```

Java 8-compatible:

```java
public final class ApproveCaseCommand {
    private final String caseId;
    private final String comment;

    public ApproveCaseCommand(String caseId, String comment) {
        this.caseId = caseId;
        this.comment = comment;
    }

    public String getCaseId() {
        return caseId;
    }

    public String getComment() {
        return comment;
    }
}
```

Usage:

```java
@CanApproveCase
public void approveCase(ApproveCaseCommand command) {
}
```

Interceptor reads `command.getCaseId()`.

This is often more robust for workflow systems.

---

## 11. Authorization Service Behind Method Security

A custom annotation should not contain policy logic directly inside interceptor.

Bad:

```java
if (securityContext.isCallerInRole("ADMIN")) return ctx.proceed();
if (securityContext.isCallerInRole("APPROVER") && case.status == SUBMITTED) return ctx.proceed();
throw new ForbiddenException();
```

Better:

```java
authorizationService.assertCanApproveCase(caseId);
```

The interceptor is only enforcement wiring.

The authorization service owns policy.

```java
@ApplicationScoped
public class AuthorizationService {

    @Inject
    ActorResolver actorResolver;

    @Inject
    CaseRepository caseRepository;

    @Inject
    PermissionAuditLogger auditLogger;

    public void assertCanApproveCase(String caseId) {
        Actor actor = actorResolver.currentActor();
        CaseSummary caze = caseRepository.findSummaryForAuthorization(caseId)
                .orElseThrow(() -> deny(actor, "CASE_NOT_ACCESSIBLE"));

        AuthorizationDecision decision = canApproveCase(actor, caze);

        auditLogger.logDecision(decision);

        if (!decision.allowed()) {
            throw new ForbiddenOperationException(decision.safeReason());
        }
    }

    private AuthorizationDecision canApproveCase(Actor actor, CaseSummary caze) {
        if (!actor.isAuthenticated()) {
            return AuthorizationDecision.deny("NOT_AUTHENTICATED");
        }

        if (!actor.belongsToTenant(caze.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH");
        }

        if (!actor.hasPermission("case.approve")) {
            return AuthorizationDecision.deny("MISSING_PERMISSION");
        }

        if (!caze.status().equals("SUBMITTED")) {
            return AuthorizationDecision.deny("INVALID_CASE_STATE");
        }

        if (caze.createdBy().equals(actor.userId())) {
            return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION");
        }

        return AuthorizationDecision.allow();
    }

    private RuntimeException deny(Actor actor, String reason) {
        auditLogger.logDecision(AuthorizationDecision.deny(reason));
        return new ForbiddenOperationException("Access denied");
    }
}
```

Important design:

```text
Interceptor = enforcement hook.
AuthorizationService = policy decision.
Domain model/repository = facts.
Audit logger = accountability.
```

---

## 12. Method Security and Transactional Consistency

Authorization can suffer from TOCTOU: time-of-check to time-of-use.

Example:

```text
1. Check: case status is SUBMITTED, actor may approve.
2. Another transaction changes case to CLOSED.
3. Original transaction approves based on stale status.
```

### 12.1 Safer Pattern: Conditional Update

```sql
UPDATE cases
SET status = 'APPROVED', approved_by = ?, approved_at = ?
WHERE id = ?
  AND tenant_id = ?
  AND status = 'SUBMITTED'
  AND created_by <> ?
```

Then check affected rows.

In Java:

```java
@Transactional
public void approveCase(String caseId) {
    Actor actor = actorResolver.currentActor();

    authorizationService.assertCanApproveCase(caseId);

    int updated = caseRepository.approveIfStillAllowed(
            caseId,
            actor.tenantId(),
            actor.userId(),
            Instant.now()
    );

    if (updated != 1) {
        throw new ConcurrentAuthorizationFailureException(
                "Case can no longer be approved"
        );
    }
}
```

But note: if `assertCanApproveCase` and update are separate, still possible race exists unless update rechecks critical predicates.

### 12.2 Security Invariant

```text
Any authorization predicate that protects a state transition must be enforced at the same consistency boundary as the transition.
```

For database-backed workflow systems, that often means:

- row lock,
- optimistic version check,
- conditional update,
- serializable transaction for critical flows,
- database constraint,
- unique index for maker-checker relation where applicable.

---

## 13. Method Security and Async Execution

Method security often assumes caller context is bound to request thread.

But async execution breaks that assumption.

Example:

```java
@CanExportCase
public void requestExport(String caseId) {
    executor.submit(() -> exportCase(caseId));
}
```

Inside background task:

```java
private void exportCase(String caseId) {
    // security context may be missing
}
```

Questions:

1. Should export run as original user?
2. Should export run as system identity?
3. What happens if user loses role before export executes?
4. What is audited?
5. Can user cancel it?

### 13.1 Capture Authorization Snapshot

For background work, often you need an explicit authorization snapshot:

```java
public final class AuthorizedJobRequest {
    private final String jobId;
    private final String requestedByUserId;
    private final String tenantId;
    private final String caseId;
    private final Set<String> permissionsAtRequestTime;
    private final Instant requestedAt;
    private final String authorizationDecisionId;
}
```

Then worker executes:

```text
system identity executes job
but audit says requestedBy = user
and policy may optionally be rechecked at execution time
```

### 13.2 Recheck vs Snapshot

| Strategy | Meaning | Risk |
|---|---|---|
| Snapshot only | allowed if user was allowed when submitted | user may lose role before execution |
| Recheck only | allowed if user is allowed at execution time | job may fail unexpectedly later |
| Snapshot + recheck critical facts | balanced | more complex |

For regulatory systems, prefer:

```text
Record approval/request authorization at submission time,
then recheck critical resource state and tenant boundary at execution time.
```

---

## 14. Method Security and Virtual Threads Java 21+

Virtual threads reduce cost of blocking operations, but do not magically solve context propagation.

If security context is stored in thread-local, then:

- new virtual thread may not have inherited context;
- context must be captured/passed deliberately;
- thread-local semantics still matter;
- container-managed request execution may handle some context, but app-created threads remain risky.

Bad pattern:

```java
Thread.startVirtualThread(() -> {
    // assumes current user security context exists here
    service.doSensitiveWork();
});
```

Better:

```java
Actor actor = actorResolver.currentActorSnapshot();

Thread.startVirtualThread(() -> {
    actorContext.runAs(actor, () -> service.doSensitiveWork());
});
```

But even this must be designed carefully:

- do not propagate mutable session object;
- do not propagate raw `SecurityContext` outside request lifecycle;
- propagate minimal actor snapshot;
- audit delegation explicitly.

Principle:

```text
Never assume method security follows execution automatically across thread boundaries.
```

Part 22 will go deeper into context propagation.

---

## 15. Method Security and JAX-RS Resource Methods

JAX-RS resource methods are often annotated with roles:

```java
@Path("/cases")
@RolesAllowed("CASE_USER")
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id) {
        return caseService.get(id);
    }

    @POST
    @Path("/{id}/approve")
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("id") String id) {
        caseService.approve(id);
        return Response.noContent().build();
    }
}
```

This is useful as coarse-grained guard.

But for secure domain design:

```java
@POST
@Path("/{id}/approve")
@RolesAllowed("CASE_APPROVER")
public Response approve(@PathParam("id") String id) {
    caseService.approve(id); // still performs domain permission check
    return Response.noContent().build();
}
```

Resource method role check answers:

```text
Can this category of caller access this endpoint?
```

Service method/domain authorization answers:

```text
Can this caller perform this action on this resource right now?
```

Both are useful. They are not substitutes.

---

## 16. Method Security and EJB

EJB historically has strong support for declarative method security.

Example:

```java
@Stateless
@RolesAllowed("CASE_USER")
public class CaseBean {

    @RolesAllowed("CASE_APPROVER")
    public void approve(String caseId) {
        // protected operation
    }

    @PermitAll
    public CaseSummary publicSummary(String caseId) {
        // less restricted
    }
}
```

EJB method security is usually container-managed and integrated with:

- caller principal,
- roles,
- transaction,
- run-as,
- remote/local invocation.

In older enterprise systems, method security was often centered around EJB.

Modern Jakarta apps may use CDI services more often, but EJB concepts still matter because:

- legacy systems use EJB;
- Jakarta Authorization/JACC transforms EJB method permissions;
- `@RunAs` and role reference mapping are often understood through EJB history;
- remote invocation raises different security propagation concerns.

---

## 17. Custom Annotation Design Patterns

### 17.1 Action-Specific Annotation

```java
@CanApproveCase
public void approve(String caseId) { }

@CanAssignCase
public void assign(String caseId, String assigneeId) { }

@CanCloseCase
public void close(String caseId) { }
```

Pros:

- expressive;
- readable;
- easy to audit codebase;
- policy meaning clear.

Cons:

- many annotations;
- repeated interceptor patterns;
- can become fragmented.

### 17.2 Generic Permission Annotation

```java
@RequiresPermission(action = "case.approve", resource = "case")
public void approve(@ResourceId("case") String caseId) { }
```

Pros:

- flexible;
- fewer annotations;
- policy engine friendly.

Cons:

- less domain expressive;
- stringly typed;
- refactoring risk;
- harder for business reviewers.

### 17.3 Hybrid

```java
@CanApproveCase
@RequiresPermission(action = "case.approve", resource = "case")
public void approve(@ResourceId("case") String caseId) { }
```

Or make `@CanApproveCase` meta-driven internally.

In complex regulatory systems, hybrid often works well:

```text
Domain-specific annotation for readability,
generic authorization engine behind it.
```

---

## 18. Avoiding Stringly-Typed Permission Chaos

Bad:

```java
@RequiresPermission("approve")
```

Better:

```java
@RequiresPermission(action = CasePermissions.APPROVE)
```

But annotation values must be compile-time constants.

```java
public final class CasePermissions {
    public static final String VIEW = "case.view";
    public static final String APPROVE = "case.approve";
    public static final String ASSIGN = "case.assign";
    public static final String CLOSE = "case.close";

    private CasePermissions() {}
}
```

Even better for policy registry:

```java
public enum CaseAction {
    VIEW,
    APPROVE,
    ASSIGN,
    CLOSE
}
```

But enum cannot always be used conveniently across annotations/policy DSLs. Choose based on toolchain.

Principle:

```text
Permission names are API contracts. Version and govern them like API contracts.
```

---

## 19. Exception Semantics: Unauthorized, Forbidden, Not Found

Method security must decide what error to throw.

Common categories:

| Condition | HTTP-level Mapping | Meaning |
|---|---:|---|
| no authentication | 401 | caller must authenticate |
| authenticated but not allowed | 403 | caller lacks permission |
| resource hidden | 404 | do not reveal existence |
| invalid state | 409 or 403 | depends on whether caller may know state |
| policy unavailable | 503 or fail-closed 403 | depends on architecture |

At service layer, avoid HTTP exceptions unless layer is explicitly web-specific.

Better domain exceptions:

```java
public class NotAuthenticatedException extends RuntimeException {}
public class ForbiddenOperationException extends RuntimeException {}
public class ResourceNotAccessibleException extends RuntimeException {}
public class ConcurrentAuthorizationFailureException extends RuntimeException {}
```

JAX-RS exception mapper translates:

```java
@Provider
public class SecurityExceptionMapper implements ExceptionMapper<ForbiddenOperationException> {

    @Override
    public Response toResponse(ForbiddenOperationException ex) {
        return Response.status(Response.Status.FORBIDDEN)
                .entity(new ErrorDto("FORBIDDEN", "Access denied"))
                .build();
    }
}
```

Security invariant:

```text
Internal denial reason can be specific.
External denial message should be safe.
Audit reason should be detailed.
```

---

## 20. Method Security and Auditability

Every sensitive denial and allow decision may need an audit event.

At minimum for sensitive operations:

```text
who attempted
what action
which resource
which tenant
when
from where
result allow/deny
reason code
policy version
correlation id
```

Example event:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decisionId": "authz-2026-000001",
  "actorId": "user:alice",
  "tenantId": "agency-1",
  "action": "case.approve",
  "resourceType": "case",
  "resourceId": "CASE-123",
  "result": "DENY",
  "reasonCode": "MAKER_CHECKER_VIOLATION",
  "policyVersion": "case-policy-v7",
  "correlationId": "req-abc",
  "occurredAt": "2026-06-17T10:15:30Z"
}
```

Avoid logging sensitive credential/token data.

Audit design must also handle:

- interceptor denial before transaction;
- business exception after allow;
- retry;
- idempotency;
- async job;
- on-behalf-of;
- system actor;
- emergency override.

---

## 21. Method Security Testing Strategy

### 21.1 Unit Test Policy Logic

Authorization service should be testable without container.

```java
@Test
void makerCannotApproveOwnCase() {
    Actor actor = actorWithPermission("user-1", "tenant-1", "case.approve");
    CaseSummary caze = submittedCase("case-1", "tenant-1", "user-1");

    AuthorizationDecision decision = policy.canApproveCase(actor, caze);

    assertFalse(decision.allowed());
    assertEquals("MAKER_CHECKER_VIOLATION", decision.reasonCode());
}
```

### 21.2 Interceptor Test

Test that annotation actually invokes interceptor.

```text
Call annotated method through CDI container/proxy.
Expect AuthorizationService called.
```

### 21.3 Bypass Test

Test self-invocation risk explicitly.

```text
Call public method that internally calls annotated method.
Verify whether interceptor runs.
```

If it does not, document and refactor.

### 21.4 Integration Test

For secured endpoint:

```text
no token/session -> 401
wrong role -> 403
right role but wrong tenant -> 403/404
right role + right tenant + wrong state -> 409/403
right role + right tenant + valid state -> 204/200
```

### 21.5 Mutation Thinking

Try to break your own security:

- call service from alternate endpoint;
- call with another tenant's resource ID;
- call after role removed;
- call twice concurrently;
- call with stale case state;
- call through async job;
- call with system actor;
- call with admin role;
- call through migration path;
- call through test-only endpoint.

---

## 22. Common Production Failure Patterns

### 22.1 Annotation on Wrong Layer

Endpoint is secured, but service is not. Later a new endpoint calls same service without security.

Fix:

```text
Put coarse guard at endpoint and domain guard at service/domain operation.
```

### 22.2 Self-Invocation Bypass

Protected method is called from same class.

Fix:

```text
Refactor protected method into separate bean or use explicit authorization check.
```

### 22.3 Role Check Used for Object Permission

`CASE_APPROVER` can approve all cases across tenants.

Fix:

```text
Role grants capability category; object permission grants specific access.
```

### 22.4 Annotation Not Active in Runtime

Annotation exists but container does not enforce it for that bean type.

Fix:

```text
Write integration test proving denial works.
Do not trust annotation presence.
```

### 22.5 Transaction Race

Authorization checks state before mutation, but state changes before update.

Fix:

```text
Recheck critical predicates in transactional update.
```

### 22.6 Async Identity Loss

Background method assumes request security context exists.

Fix:

```text
Pass actor snapshot and define execution identity explicitly.
```

### 22.7 Over-Broad Run-As

Scheduler runs with admin-equivalent role and can perform too much.

Fix:

```text
Use purpose-specific system role and audit initiator/effective actor separately.
```

### 22.8 Validation Leaks Resource Existence

Validation runs before authorization and exposes case status.

Fix:

```text
Check resource accessibility before detailed validation response.
```

---

## 23. Design Heuristics for Top-Tier Engineers

### 23.1 Treat Method Security as a Contract

A secured method should have a clear contract:

```text
Precondition:
  caller is authenticated
  caller belongs to tenant
  caller has action capability
  caller has relationship to resource
  resource is in allowed state

Postcondition:
  mutation only occurs if authorization predicate still holds
  audit event exists
```

### 23.2 Prefer Domain Language

Instead of:

```java
@RolesAllowed("APPROVER")
void approve(String id)
```

Prefer:

```java
@CanApproveCase
void approveCase(String caseId)
```

Then implement role/permission/state logic behind it.

### 23.3 Never Trust UI Authorization

UI can hide buttons. Method security must enforce backend truth.

### 23.4 Use Default-Deny for Sensitive Service APIs

If a method mutates regulated state, assume it needs explicit authorization.

### 23.5 Authorization Must Be Close to Mutation

The further authorization is from mutation, the easier it is to bypass or race.

### 23.6 Audit Decisions, Not Just Actions

A denial can be as important as an approval.

### 23.7 Security Annotation Presence Is Not Proof

Proof requires integration test that unauthorized caller is denied.

---

## 24. Reference Architecture Pattern

For a case approval system:

```text
JAX-RS Resource
  - parses HTTP
  - coarse @RolesAllowed("CASE_APPROVER")
  - calls application service

Application Service
  - @CanApproveCase
  - starts transaction
  - invokes domain service

Authorization Interceptor
  - extracts caseId
  - asks AuthorizationService
  - logs decision

AuthorizationService
  - resolves Actor
  - loads minimal authorization facts
  - evaluates tenant, role, permission, state, relationship
  - returns decision

Domain Service
  - performs transition
  - enforces state transition invariant

Repository
  - conditional update / optimistic lock

Audit Pipeline
  - records authorization and business action
```

Text diagram:

```text
HTTP Request
   |
   v
CaseResource.approve()
   |  coarse role guard
   v
CaseApprovalService.approveCase()
   |  @CanApproveCase interceptor
   v
AuthorizationService.assertCanApproveCase()
   |  actor + resource + tenant + state + relationship
   v
Domain transition
   |  conditional update / lock / version check
   v
Audit action outcome
```

---

## 25. Java 8 sampai Java 25 Considerations

### Java 8

- No records.
- No pattern matching.
- Lambdas exist, but async context propagation still manual.
- Java EE 8 uses `javax.*` namespace.
- Many legacy app servers are Java 8-era.

### Java 11

- Common enterprise LTS baseline for older Jakarta/Spring systems.
- Migration from Java EE to Jakarta often starts here.

### Java 17

- Stronger modern LTS baseline.
- Records available if project allows.
- Pattern matching improvements begin to help code clarity.

### Java 21

- Virtual threads available.
- Method security context propagation must be explicitly understood.
- Scoped values may influence future context propagation designs.

### Java 25

- Modern LTS generation.
- More mature platform features, but Jakarta container compatibility must be checked.
- Do not assume every Jakarta EE server immediately supports newest JDK in production.

Cross-version rule:

```text
Security semantics should not depend on language convenience features.
Use newer Java features for clarity, not as hidden enforcement assumptions.
```

---

## 26. `javax.*` vs `jakarta.*`

Older Java EE style:

```java
import javax.annotation.security.RolesAllowed;
import javax.interceptor.AroundInvoke;
import javax.interceptor.Interceptor;
```

Modern Jakarta style:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.interceptor.AroundInvoke;
import jakarta.interceptor.Interceptor;
```

Migration concern:

- annotation package changes;
- interceptor package changes;
- container version must match namespace;
- mixing `javax` annotation in `jakarta` runtime may silently not work;
- tests must verify enforcement, not just compilation.

Important invariant:

```text
A security annotation imported from the wrong namespace can become a decorative no-op.
```

---

## 27. Checklist: Method Security Design Review

Use this checklist for critical operations.

### Boundary

- [ ] Is the operation protected at endpoint layer?
- [ ] Is the domain/service method protected?
- [ ] Can the method be called from another path?
- [ ] Can batch/job/integration path bypass the same checks?

### Invocation Model

- [ ] Is annotation applied to an intercepted method?
- [ ] Is the method public/proxyable where required?
- [ ] Is there self-invocation?
- [ ] Is there final/private/static method issue?
- [ ] Is CDI/EJB/JAX-RS enforcement verified in this container?

### Policy

- [ ] Is role check enough?
- [ ] Is tenant checked?
- [ ] Is resource ownership/assignment checked?
- [ ] Is state checked?
- [ ] Is maker-checker checked?
- [ ] Is delegation checked?
- [ ] Is emergency override controlled?

### Transaction

- [ ] Can authorization facts change before mutation?
- [ ] Are critical predicates rechecked in update/lock?
- [ ] Is denial audited even if transaction rolls back?

### Async

- [ ] Does method spawn async work?
- [ ] What identity does async work run as?
- [ ] Is actor snapshot recorded?
- [ ] Is execution-time recheck required?

### Error/Audit

- [ ] Are denial reasons safe externally?
- [ ] Are detailed reasons audited internally?
- [ ] Is correlation ID recorded?
- [ ] Is policy version recorded?

### Testing

- [ ] Positive test exists.
- [ ] Negative role test exists.
- [ ] Negative tenant test exists.
- [ ] Negative state test exists.
- [ ] Self-invocation/bypass test exists.
- [ ] Concurrent transition test exists.

---

## 28. Mini Case Study: Approval Operation

### Requirement

A case may be approved only if:

1. caller is authenticated;
2. caller belongs to same tenant as case;
3. caller has `case.approve` permission;
4. case status is `SUBMITTED`;
5. caller is not the creator;
6. caller is assigned as approver or belongs to approval queue;
7. approval is audited.

### Endpoint

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseApprovalService approvalService;

    @POST
    @Path("/{caseId}/approve")
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("caseId") String caseId) {
        approvalService.approveCase(caseId);
        return Response.noContent().build();
    }
}
```

### Service

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    ActorResolver actorResolver;

    @Transactional
    @CanApproveCase
    public void approveCase(@ResourceId("case") String caseId) {
        Actor actor = actorResolver.currentActor();

        int updated = caseRepository.approveIfAllowedStillHolds(
                caseId,
                actor.tenantId(),
                actor.userId(),
                Instant.now()
        );

        if (updated != 1) {
            throw new ConcurrentAuthorizationFailureException(
                    "Case can no longer be approved"
            );
        }
    }
}
```

### Interceptor

```java
@CanApproveCase
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class CanApproveCaseInterceptor {

    @Inject
    AuthorizationService authorizationService;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        String caseId = ResourceIdExtractor.extract(ctx, "case");
        authorizationService.assertCanApproveCase(caseId);
        return ctx.proceed();
    }
}
```

### Why Both Interceptor and Conditional Update?

Interceptor gives clear denial and audit before mutation.

Conditional update protects against race and stale state.

Together:

```text
interceptor = policy decision and audit
conditional update = transactional invariant enforcement
```

---

## 29. What You Should Be Able To Explain After This Part

You should be able to explain:

1. why endpoint security is not enough;
2. how method security works through proxy/interceptor/container invocation;
3. why self-invocation is dangerous;
4. when to use `@RolesAllowed` vs domain-specific annotation;
5. how CDI/EJB/JAX-RS method security differ conceptually;
6. how ordering with transaction/validation/audit affects correctness;
7. how async execution breaks request-bound security context;
8. how to design `@CanApproveCase`-style annotation;
9. how to separate interceptor wiring from policy decision;
10. how to test method security beyond happy path;
11. how to reason about method security as an invariant, not decoration.

---

## 30. Core Takeaways

1. Method security is an enforcement boundary, not documentation.
2. Security annotation only works if invocation passes through the container/proxy/interceptor path.
3. Self-invocation is one of the most common bypass sources.
4. Role checks are useful for coarse guards but insufficient for domain authorization.
5. Critical domain operations should check subject, action, resource, tenant, state, and relationship.
6. Authorization must be close to mutation and protected against race conditions.
7. Async work must define explicit execution identity.
8. Audit must record both allow and deny decisions for sensitive operations.
9. Integration tests are required to prove security annotation is active.
10. In enterprise/regulatory systems, method security should be designed as a defensible policy boundary.

---

## 31. Status Seri

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
Part 10 — Jakarta Authentication / JASPIC Deep Dive
Part 11 — Jakarta Authorization / JACC Deep Dive
Part 12 — Declarative Authorization: URL, Method, Class, Role
Part 13 — Programmatic Authorization and Domain Permission Design
Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
Part 15 — Session Security: Login State, HttpSession, Cookies, Logout
Part 16 — Token-Based Security in Jakarta Applications
Part 17 — OpenID Connect in Jakarta Security
Part 18 — OAuth2 Resource Server Pattern for JAX-RS and Servlet APIs
Part 19 — SAML, Enterprise SSO, and Legacy Federation Integration
Part 20 — mTLS, Client Certificates, and Strong Caller Authentication
Part 21 — Method Security with CDI, EJB, Interceptors, and Proxies
```

Berikutnya:

```text
Part 22 — Security Context Propagation: Threads, Executors, Async, Virtual Threads, Reactive
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 20 — mTLS, Client Certificates, and Strong Caller Authentication](./learn-java-jakarta-security-authentication-authorization-identity-part-20-mtls-client-certificates.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Security Context Propagation: Threads, Executors, Async, Virtual Threads, Reactive](./learn-java-jakarta-security-authentication-authorization-identity-part-22-security-context-propagation.md)

</div>