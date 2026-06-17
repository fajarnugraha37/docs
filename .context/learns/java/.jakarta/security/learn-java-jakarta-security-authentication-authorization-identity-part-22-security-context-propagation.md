# Part 22 — Security Context Propagation: Threads, Executors, Async, Virtual Threads, Reactive

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-22-security-context-propagation-threads-async-virtual-threads-reactive.md`  
> Target: Java 8–25, Java EE/Jakarta EE, Servlet, JAX-RS, CDI/EJB, Jakarta Security, Jakarta Concurrency, MicroProfile Context Propagation, modern async/reactive architecture.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun pemahaman tentang:

- identity,
- principal,
- subject,
- role,
- permission,
- `SecurityContext`,
- `IdentityStore`,
- Servlet security,
- authentication mechanism,
- declarative authorization,
- programmatic authorization,
- session,
- token,
- OIDC,
- OAuth2 resource server,
- SAML,
- mTLS,
- method security.

Sekarang kita masuk ke salah satu area paling sering menyebabkan bug security di sistem enterprise Java:

> Bagaimana security identity tetap benar ketika eksekusi tidak lagi berjalan linear di satu request thread?

Di aplikasi sederhana, kita sering membayangkan alur seperti ini:

```text
HTTP request
  -> container authenticates caller
  -> application gets SecurityContext
  -> service checks authorization
  -> repository queries data
  -> response returned
```

Tetapi aplikasi production jarang sesederhana itu. Eksekusi bisa berpindah ke:

- Servlet async thread,
- `ManagedExecutorService`,
- `CompletableFuture`,
- scheduled job,
- JMS listener,
- Kafka/RabbitMQ consumer,
- reactive pipeline,
- WebSocket handler,
- background worker,
- virtual thread,
- batch processor,
- downstream service call,
- retry handler,
- callback after transaction commit,
- event listener,
- audit pipeline.

Pertanyaan security-nya bukan hanya:

> User ini siapa?

Tetapi:

> Pada saat kode ini berjalan, identity siapa yang sedang berlaku, apakah identity itu sengaja dipropagasikan, apakah masih valid, apakah boleh dipakai untuk action ini, dan apakah audit bisa membuktikan rantai eksekusinya?

Bagian ini akan membangun mental model yang tajam agar kita tidak sekadar “copy ThreadLocal”, tetapi mampu mendesain security context propagation yang aman, eksplisit, auditable, dan cocok untuk enterprise/regulatory systems.

---

## 1. Masalah Utama: Security Context Itu Bukan Nilai Global yang Aman

Banyak framework security memakai konsep context:

- Jakarta Security: `jakarta.security.enterprise.SecurityContext`
- Servlet: `HttpServletRequest#getUserPrincipal()` dan `isUserInRole()`
- JAX-RS: `jakarta.ws.rs.core.SecurityContext`
- Spring Security: `SecurityContextHolder`
- JAAS: `Subject`
- MicroProfile JWT: `JsonWebToken`
- container-specific context

Di banyak implementasi, context ini dikaitkan dengan request/thread/container invocation.

Masalahnya:

```java
public void approveCase(String caseId) {
    Principal p = securityContext.getCallerPrincipal();
    // aman selama dipanggil dalam request container-managed yang benar
}
```

Kode di atas tampak aman jika berjalan langsung dalam request HTTP. Tetapi bagaimana jika:

```java
public void approveCaseAsync(String caseId) {
    CompletableFuture.runAsync(() -> {
        Principal p = securityContext.getCallerPrincipal();
        approve(caseId, p);
    });
}
```

Pertanyaan kritis:

1. Thread async itu container-managed atau unmanaged?
2. Apakah `SecurityContext` valid di thread itu?
3. Apakah CDI request context masih aktif?
4. Apakah principal masih tersedia?
5. Kalau tersedia, apakah itu caller yang benar atau context dari request lain?
6. Kalau tidak tersedia, apakah kode diam-diam memakai system identity?
7. Kalau system identity dipakai, apakah itu escalation?
8. Kalau gagal, apakah error menjadi 500, 401, atau silent bypass?
9. Apakah audit mencatat actor yang benar?

Security bug di area ini biasanya bukan karena developer tidak tahu `@RolesAllowed`, tetapi karena mereka salah memahami **lifetime identity**.

---

## 2. Core Mental Model: Security Context Memiliki Scope

Sebelum membahas API, pegang invariant ini:

> Security context selalu memiliki scope. Jika scope-nya tidak jelas, security decision tidak boleh dipercaya.

Scope bisa berupa:

| Scope | Contoh | Risiko |
|---|---|---|
| HTTP request | Servlet/JAX-RS request | Aman jika tetap di request thread/container lifecycle |
| HTTP session | login state browser | Bisa stale jika role berubah |
| Transaction | action bisnis tertentu | Bisa mismatch jika async diproses setelah state berubah |
| Method invocation | EJB/CDI method security | Bisa bypass karena self-invocation/proxy |
| Thread | `ThreadLocal` | Bisa bocor antar request jika thread reused |
| Task | queued job/event | Perlu actor snapshot eksplisit |
| Message | JMS/Kafka/RabbitMQ | Perlu signed/validated actor metadata atau system actor |
| Service call | downstream API | Perlu token propagation/exchange |
| Batch job | scheduled execution | Harus pakai system identity yang eksplisit |

Kesalahan umum adalah menganggap:

```text
securityContext == user yang login == aman dipakai di mana saja
```

Padahal lebih benar:

```text
securityContext adalah representasi identity dalam execution scope tertentu, disediakan oleh container/framework, dan validitasnya bergantung pada lifecycle scope tersebut.
```

---

## 3. Execution Model Tradisional: Satu Request, Satu Thread

Model lama Java web relatif sederhana:

```text
Tomcat/Jetty/Undertow/Payara/WildFly/Liberty thread pool
  -> worker thread menerima HTTP request
  -> container parsing session/token/cert
  -> authentication established
  -> servlet filter chain
  -> servlet/JAX-RS resource
  -> service method
  -> repository
  -> response
  -> thread dikembalikan ke pool
```

Dalam model ini, security context sering diasosiasikan dengan request/thread/container invocation.

Contoh:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    SecurityContext securityContext; // Jakarta Security

    @POST
    @Path("/{id}/approve")
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("id") String id) {
        Principal caller = securityContext.getCallerPrincipal();
        // domain authorization lanjut
        return Response.ok().build();
    }
}
```

Selama kode berjalan dalam request yang sama, container bisa menyediakan caller dengan benar.

Namun, begitu kita pindah ke async, thread pool, queue, atau event, asumsi ini pecah.

---

## 4. Apa Itu Propagation?

**Context propagation** adalah proses membawa sebagian context dari satu execution scope ke execution scope lain.

Dalam sistem enterprise, context bisa mencakup:

- security identity,
- tenant,
- locale,
- request id,
- correlation id,
- transaction context,
- CDI request context,
- classloader context,
- naming context,
- tracing span,
- MDC logging context,
- authorization snapshot,
- audit actor.

Tetapi tidak semua context aman dipropagasikan.

Contoh context yang sering boleh dipropagasikan:

```text
correlationId
requestId
tenantId
actorId snapshot
actor type
trace context
```

Contoh context yang berbahaya bila disalin mentah:

```text
raw SecurityContext object
HttpServletRequest object
HttpSession object
EntityManager transaction-bound object
JPA lazy entity
container internal principal object
mutable role set from session
raw token with too broad audience
```

Mental modelnya:

> Jangan memindahkan container context sebagai object hidup. Pindahkan security facts yang eksplisit, minimal, immutable, dan bisa divalidasi ulang.

---

## 5. Propagation vs Re-Authentication vs Delegation

Saat request berpindah ke async/downstream, ada tiga pendekatan besar.

### 5.1 Propagation

Membawa identity caller ke task berikutnya.

Contoh:

```text
User A submit approval
  -> async task continues as User A
```

Cocok jika task adalah kelanjutan langsung dari action user.

Risiko:

- role user berubah setelah task dibuat,
- task berjalan jauh setelah session logout,
- actor context terlalu luas,
- audit sulit membedakan direct vs async execution.

### 5.2 Re-Authentication / Re-Validation

Task membawa actor id/token lalu memvalidasi ulang saat dieksekusi.

Contoh:

```text
Task contains actorId + tenantId + requestedAction
Worker reloads user + roles + domain state
Authorization checked again before execution
```

Lebih aman untuk long-running/queued job.

Risiko:

- behavior berubah jika role berubah antara submit dan execute,
- perlu definisi bisnis: apakah hak dievaluasi saat request dibuat atau saat action dieksekusi?

### 5.3 Delegation / System Actor

Task berjalan sebagai system identity, tetapi mencatat `initiatedBy`.

Contoh:

```text
User A approves case
  -> system sends email as SYSTEM
  -> audit: action=email.sent, actor=SYSTEM, initiatedBy=User A
```

Cocok untuk side effect teknis seperti:

- send email,
- generate PDF,
- sync search index,
- publish event,
- push notification,
- cleanup temp file.

Risiko:

- system identity terlalu kuat,
- developer memakai system identity untuk bypass authorization,
- audit tidak membedakan actor dan initiator.

---

## 6. Golden Rule: Actor, Initiator, Executor Harus Dibedakan

Dalam sistem regulatory/case management, selalu bedakan tiga istilah ini.

| Istilah | Arti | Contoh |
|---|---|---|
| Actor | Pihak yang secara bisnis dianggap melakukan aksi | Officer A approve case |
| Initiator | Pihak yang memicu proses | Officer A klik approve |
| Executor | Komponen teknis yang menjalankan step | Async worker / SYSTEM |

Contoh audit yang buruk:

```json
{
  "action": "CASE_APPROVED",
  "actor": "SYSTEM"
}
```

Masalah: approval terlihat dilakukan system, bukan officer.

Contoh audit yang lebih defensible:

```json
{
  "eventType": "CASE_APPROVED",
  "businessActor": {
    "type": "USER",
    "id": "u-1001",
    "displayName": "Officer A"
  },
  "technicalExecutor": {
    "type": "SYSTEM_WORKER",
    "id": "case-workflow-worker"
  },
  "initiatedBy": {
    "type": "USER",
    "id": "u-1001"
  },
  "tenantId": "agency-01",
  "caseId": "case-123",
  "correlationId": "corr-abc",
  "authorizationDecisionId": "authz-789"
}
```

Untuk action yang benar-benar dilakukan system:

```json
{
  "eventType": "REMINDER_EMAIL_SENT",
  "businessActor": {
    "type": "SYSTEM",
    "id": "notification-service"
  },
  "initiatedBy": {
    "type": "USER",
    "id": "u-1001"
  },
  "reason": "case approval triggered notification"
}
```

---

## 7. ThreadLocal: Powerful, Dangerous, Often Misunderstood

Banyak framework memakai `ThreadLocal` untuk menyimpan context.

Contoh sederhana:

```java
public final class CurrentActorHolder {
    private static final ThreadLocal<ActorContext> CURRENT = new ThreadLocal<>();

    public static void set(ActorContext actor) {
        CURRENT.set(actor);
    }

    public static ActorContext get() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Pola ini tampak mudah:

```java
try {
    CurrentActorHolder.set(actor);
    chain.doFilter(request, response);
} finally {
    CurrentActorHolder.clear();
}
```

Kuncinya ada pada `finally`.

Jika tidak dibersihkan, thread pool bisa menyebabkan identity leak:

```text
Request 1 oleh User A memakai Thread-17
CurrentActorHolder = User A
Request selesai, tapi clear lupa
Thread-17 kembali ke pool
Request 2 oleh User B memakai Thread-17
Kode membaca CurrentActorHolder -> User A
```

Ini adalah salah satu bug paling berbahaya:

> Cross-user context leakage.

Aturan:

1. Jika memakai `ThreadLocal`, selalu set di boundary dan clear di `finally`.
2. Jangan menyimpan mutable object besar.
3. Jangan menyimpan `HttpServletRequest`/`HttpSession`.
4. Jangan mengandalkan `ThreadLocal` melewati async boundary.
5. Jangan membuat fallback otomatis ke admin/system jika context null.
6. Jangan memakai `InheritableThreadLocal` tanpa alasan kuat.

---

## 8. Kenapa `InheritableThreadLocal` Berbahaya

`InheritableThreadLocal` menyalin nilai dari parent thread ke child thread saat thread dibuat.

Tampaknya cocok untuk async:

```java
private static final InheritableThreadLocal<ActorContext> CURRENT = new InheritableThreadLocal<>();
```

Tetapi dalam server Java modern, thread biasanya bukan dibuat per task, melainkan dipakai ulang oleh pool.

Masalah:

```text
Thread dibuat saat pool startup
Context parent saat itu mungkin null atau salah
Task-task berikutnya memakai thread yang sama
Propagation tidak terjadi seperti yang dibayangkan
```

Lebih buruk lagi, context bisa tertinggal di child thread.

Dalam application server, membuat thread sendiri juga sering melanggar container contract karena container tidak bisa mengelola:

- classloader context,
- naming context,
- transaction context,
- security context,
- lifecycle,
- resource cleanup.

Aturan:

> Jangan jadikan `InheritableThreadLocal` sebagai solusi security context propagation di enterprise server.

---

## 9. Unmanaged Threads: Jangan `new Thread()` di Jakarta EE App

Contoh buruk:

```java
public void generateReport(String reportId) {
    new Thread(() -> reportService.generate(reportId)).start();
}
```

Masalah:

1. Container tidak tahu thread ini.
2. Security context tidak dijamin tersedia.
3. CDI context tidak dijamin aktif.
4. JNDI/resource context tidak dijamin benar.
5. Classloader leak bisa terjadi saat redeploy.
6. Transaction boundary tidak jelas.
7. Shutdown tidak graceful.
8. Audit context hilang.

Di Jakarta EE, gunakan managed concurrency facility.

---

## 10. Jakarta Concurrency: ManagedExecutorService

Jakarta Concurrency menyediakan API standar untuk memakai concurrency dalam Jakarta EE tanpa merusak integritas container.

Contoh lookup:

```java
@Resource
ManagedExecutorService executor;
```

Atau JNDI default:

```java
@Resource(lookup = "java:comp/DefaultManagedExecutorService")
ManagedExecutorService executor;
```

Contoh penggunaan:

```java
public CompletionStage<Void> generateReportAsync(String reportId) {
    ActorContext actor = actorContextFactory.currentSnapshot();

    return CompletableFuture.runAsync(() -> {
        reportService.generate(reportId, actor);
    }, executor);
}
```

Perhatikan: meskipun executor managed, kita tetap membuat actor snapshot eksplisit.

Mengapa?

Karena container-managed executor membantu dengan konteks container tertentu, tetapi authorization bisnis tetap harus eksplisit. Kita tidak ingin service bisnis bergantung pada “apakah container vendor X mempropagasikan security context seperti vendor Y”.

Pola aman:

```java
public CompletionStage<ReportId> requestReport(String caseId) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();
    TenantId tenant = actor.requireTenant();

    authorizationService.requireAllowed(actor, "REPORT_GENERATE", caseId, tenant);

    ReportRequest request = reportRequestRepository.create(caseId, actor, tenant);

    return CompletableFuture.supplyAsync(() -> {
        return reportGenerationWorker.generate(request.id());
    }, executor);
}
```

Worker kemudian memuat ulang request:

```java
public ReportId generate(ReportRequestId id) {
    ReportRequest request = reportRequestRepository.get(id);

    ActorContext actor = request.initiatedBy();
    TenantId tenant = request.tenantId();

    // optional: re-check if business requires live authorization
    authorizationService.requireAllowed(actor, "REPORT_GENERATE_EXECUTE", request.caseId(), tenant);

    return reportEngine.generateAsSystemExecutor(request, actor);
}
```

---

## 11. Security Context Propagation ≠ Business Authorization Snapshot

Ada dua hal berbeda:

### 11.1 Runtime Security Context

Ini context dari container/framework:

```text
current principal
current roles
request auth state
session auth state
```

### 11.2 Business Authorization Snapshot

Ini fakta bisnis yang disimpan untuk membuktikan keputusan:

```text
actorId
actorType
tenantId
rolesAtDecisionTime
permission evaluated
domain resource id
resource state
decision result
decision reason
policy version
time
```

Untuk sistem defensible, sering perlu menyimpan snapshot keputusan.

Contoh:

```java
public record AuthorizationDecisionSnapshot(
        String decisionId,
        String actorId,
        String tenantId,
        String action,
        String resourceType,
        String resourceId,
        String resourceState,
        Set<String> rolesAtDecisionTime,
        Set<String> permissionsAtDecisionTime,
        String policyVersion,
        Instant decidedAt,
        boolean allowed,
        String reasonCode
) {}
```

Snapshot ini bukan pengganti live authorization. Ia adalah bukti dan input audit.

---

## 12. Servlet Async Processing

Servlet mendukung asynchronous processing untuk kasus saat request perlu menunggu resource/event tanpa menahan request thread utama terlalu lama.

Contoh:

```java
@WebServlet(urlPatterns = "/long-task", asyncSupported = true)
public class LongTaskServlet extends HttpServlet {

    @Resource
    ManagedExecutorService executor;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        AsyncContext async = req.startAsync();

        ActorContext actor = ActorContext.from(req.getUserPrincipal(), req);

        executor.submit(() -> {
            try {
                process(actor);
                HttpServletResponse response = (HttpServletResponse) async.getResponse();
                response.setStatus(200);
            } catch (Exception e) {
                handleError(async, e);
            } finally {
                async.complete();
            }
        });
    }
}
```

Hal penting:

1. Ambil actor snapshot sebelum pindah thread.
2. Jangan memakai `HttpServletRequest` secara sembarangan di thread async.
3. Jangan asumsikan injected request-scoped bean valid.
4. Pastikan `async.complete()` dipanggil.
5. Pastikan timeout ditangani.
6. Audit action yang terjadi di async thread.

Bug umum:

```java
executor.submit(() -> {
    Principal p = req.getUserPrincipal(); // object request dipakai lintas thread
});
```

Lebih aman:

```java
Principal principal = req.getUserPrincipal();
Set<String> roles = extractRelevantRoles(req);
ActorContext actor = ActorContext.from(principal, roles, tenantId);

executor.submit(() -> doWork(actor));
```

---

## 13. CompletableFuture: Default Executor Trap

`CompletableFuture.supplyAsync()` tanpa executor memakai common pool.

Contoh buruk:

```java
CompletableFuture.supplyAsync(() -> service.calculate());
```

Masalah:

- memakai `ForkJoinPool.commonPool`,
- bukan container-managed executor,
- security/CDI/request context tidak dijamin,
- MDC/correlation id hilang,
- blocking I/O di common pool bisa mengganggu aplikasi,
- tidak ada lifecycle integration dengan application server.

Lebih baik:

```java
CompletableFuture.supplyAsync(() -> service.calculate(actor), managedExecutorService);
```

Tetapi jangan hanya mengandalkan managed executor untuk security. Tetap kirim actor eksplisit.

```java
ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();

CompletableFuture
    .supplyAsync(() -> pricingService.calculate(caseId, actor), executor)
    .thenApplyAsync(result -> approvalService.prepare(caseId, result, actor), executor);
```

Lebih defensible:

```java
public CompletionStage<PreparedApproval> prepareApproval(String caseId) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();
    authorizationService.requireAllowed(actor, "CASE_PREPARE_APPROVAL", caseId);

    return CompletableFuture
            .supplyAsync(() -> loadCaseSnapshot(caseId, actor.tenantId()), executor)
            .thenApplyAsync(snapshot -> calculateEligibility(snapshot, actor), executor)
            .thenApplyAsync(result -> createPreparedApproval(caseId, result, actor), executor);
}
```

---

## 14. MicroProfile Context Propagation

MicroProfile Context Propagation dibuat untuk memudahkan propagation context lintas unit kerja/thread, terutama dengan `CompletionStage`/`CompletableFuture`.

Secara konseptual, context propagation bisa mengatur:

- context mana yang dipropagasikan,
- context mana yang dibersihkan,
- context mana yang tidak boleh ada,
- executor mana yang dipakai.

Contoh konseptual:

```java
@Inject
ManagedExecutor managedExecutor;

@Inject
ThreadContext threadContext;

public CompletionStage<Result> process(String caseId) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();

    return managedExecutor
            .supplyAsync(() -> service.step1(caseId, actor))
            .thenApply(result -> service.step2(result, actor));
}
```

MicroProfile context propagation membantu untuk context seperti CDI/request/tracing/security sesuai implementasi dan konfigurasi platform.

Tetapi prinsip enterprise tetap sama:

> Gunakan propagation framework untuk platform context; gunakan explicit actor snapshot untuk authorization bisnis.

Jangan membuat service domain bergantung pada magic context.

---

## 15. JAX-RS Async and Reactive Return Types

JAX-RS/Jakarta REST mendukung berbagai pola async tergantung versi dan implementasi:

- `CompletionStage<Response>`,
- suspended async response,
- server-sent events,
- non-blocking I/O via implementation,
- integration dengan reactive libraries.

Contoh:

```java
@GET
@Path("/{id}/summary")
public CompletionStage<Response> summary(@PathParam("id") String id) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();

    return caseQueryService.summaryAsync(id, actor)
            .thenApply(summary -> Response.ok(summary).build());
}
```

Anti-pattern:

```java
@GET
@Path("/{id}/summary")
public CompletionStage<Response> summary(@PathParam("id") String id) {
    return caseQueryService.summaryAsync(id)
            .thenApply(summary -> {
                // security check too late, context may be gone
                if (!securityContext.isCallerInRole("CASE_VIEWER")) {
                    throw new ForbiddenException();
                }
                return Response.ok(summary).build();
            });
}
```

Lebih baik:

```java
@GET
@Path("/{id}/summary")
public CompletionStage<Response> summary(@PathParam("id") String id) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();
    authorizationService.requireAllowed(actor, "CASE_VIEW", id);

    return caseQueryService.summaryAsync(id, actor)
            .thenApply(summary -> Response.ok(summary).build());
}
```

Security check di awal mencegah:

- data diproses dulu baru ditolak,
- side effect terjadi sebelum authorization,
- context hilang di stage berikutnya,
- denial audit tidak lengkap.

Namun, untuk long-running operation, check awal saja tidak cukup. Perlu check ulang saat commit/side effect.

---

## 16. Reactive Pipeline: Context Tidak Sama dengan Thread

Dalam reactive programming, eksekusi bisa berpindah thread berkali-kali.

Contoh konseptual:

```text
request thread
  -> event loop
  -> worker pool
  -> DB callback
  -> event loop
  -> response
```

Jika security context berbasis `ThreadLocal`, maka reactive pipeline bisa kehilangan context.

Pola buruk:

```java
Mono<CaseDto> getCase(String id) {
    return repository.findById(id)
        .map(c -> {
            ActorContext actor = CurrentActorHolder.get(); // mungkin null/salah
            authorizationService.requireAllowed(actor, "CASE_VIEW", c.id());
            return mapper.toDto(c);
        });
}
```

Pola lebih baik:

```java
Mono<CaseDto> getCase(String id, ActorContext actor) {
    return repository.findById(id)
        .doOnNext(c -> authorizationService.requireAllowed(actor, "CASE_VIEW", c.id()))
        .map(mapper::toDto);
}
```

Atau memakai context mechanism reactive library secara eksplisit, tetapi tetap hindari domain service yang diam-diam membaca global state.

Prinsip:

> Di reactive pipeline, actor sebaiknya menjadi bagian eksplisit dari command/query context, bukan asumsi ThreadLocal.

---

## 17. Virtual Threads Java 21+: Membantu Concurrency, Tidak Otomatis Menyelesaikan Security Propagation

Virtual threads membuat blocking style menjadi lebih scalable untuk banyak workload I/O-bound. Tetapi virtual thread bukan solusi otomatis untuk security context.

Beberapa poin:

1. Virtual thread tetap thread dari sudut pandang Java API.
2. `ThreadLocal` bisa bekerja, tetapi harus hati-hati karena jumlah virtual thread bisa sangat besar.
3. Copying context besar ke banyak virtual thread bisa mahal.
4. Context lifetime tetap harus jelas.
5. Container support berbeda-beda tergantung app server/framework.
6. Authorization invariant tidak berubah.

Contoh:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();

    Future<Result> f = executor.submit(() -> service.calculate(actor));
}
```

Dalam standalone Java, virtual thread executor boleh dipakai. Dalam Jakarta EE container, tetap perhatikan container-managed concurrency contract. App server mungkin menyediakan cara sendiri untuk virtual thread atau belum mendukung penuh konteks container.

Aturan praktis:

> Virtual thread mengubah model kapasitas, bukan model otorisasi.

Jangan berpikir:

```text
karena virtual thread per task, ThreadLocal pasti aman
```

Yang lebih benar:

```text
karena virtual thread per task, risiko thread reuse leak mungkin berkurang untuk executor tertentu, tetapi context lifetime, cleanup, propagation, audit, dan authorization recheck tetap harus didesain eksplisit.
```

---

## 18. Scoped Values Java 21+ Conceptual Relevance

Java modern memperkenalkan konsep `ScopedValue` sebagai alternatif immutable, lexically scoped untuk beberapa kasus context passing.

Konsepnya berguna untuk mental model:

- context dibound dalam scope tertentu,
- tidak mutable seperti `ThreadLocal`,
- lifetime lebih eksplisit,
- cocok dengan structured concurrency.

Contoh konseptual:

```java
static final ScopedValue<ActorContext> ACTOR = ScopedValue.newInstance();

ScopedValue.where(ACTOR, actor).run(() -> {
    service.process();
});
```

Namun dalam Jakarta EE:

1. Jangan langsung mengganti container security context dengan `ScopedValue` tanpa memahami lifecycle container.
2. Gunakan sebagai internal application context jika platform dan versi Java mendukung.
3. Tetap jangan sembunyikan authorization dependency terlalu dalam.
4. Untuk domain service penting, explicit parameter sering lebih jelas.

Pilihan desain:

| Pendekatan | Cocok untuk | Catatan |
|---|---|---|
| Explicit parameter | domain authorization, audit, workflow | paling jelas dan testable |
| Request-scoped bean | request synchronous | mudah tapi scope terbatas |
| ThreadLocal | legacy framework/interceptor | harus clear dan hati-hati async |
| ScopedValue | modern structured scope | Java modern, perlu platform support |
| Reactive context | reactive pipeline | library-specific |
| Message metadata | queue/event | harus signed/validated jika lintas trust boundary |

---

## 19. Scheduled Job Identity

Scheduled job tidak punya user login.

Contoh:

```text
Every night 01:00
  -> close expired applications
  -> send reminders
  -> archive old cases
```

Pertanyaan:

> Siapa actornya?

Jawaban buruk:

```text
null
```

Jawaban lebih baik:

```text
SYSTEM:SCHEDULER:case-expiry-job
```

Contoh model:

```java
public record ActorContext(
        ActorType type,
        String actorId,
        String displayName,
        String tenantId,
        Set<String> permissions,
        String authenticationMethod,
        Instant establishedAt
) {
    public static ActorContext systemJob(String jobName, String tenantId) {
        return new ActorContext(
                ActorType.SYSTEM_JOB,
                "system:job:" + jobName,
                jobName,
                tenantId,
                Set.of("CASE_EXPIRE_SYSTEM", "NOTIFICATION_SEND_SYSTEM"),
                "SYSTEM_INTERNAL",
                Instant.now()
        );
    }
}
```

Scheduled job harus punya permission khusus, bukan admin universal.

Buruk:

```java
ActorContext actor = ActorContext.superAdminSystem();
```

Lebih baik:

```java
ActorContext actor = ActorContext.systemJob("case-expiry-job", tenantId);
authorizationService.requireAllowed(actor, "CASE_EXPIRE", caseId);
```

Audit:

```json
{
  "eventType": "CASE_EXPIRED",
  "businessActor": {
    "type": "SYSTEM_JOB",
    "id": "system:job:case-expiry-job"
  },
  "reason": "application expiry date passed",
  "caseId": "case-123"
}
```

---

## 20. Message Consumer Identity

Message consumer juga tidak berjalan dalam original HTTP request.

Contoh:

```text
User submits application
  -> app publishes APPLICATION_SUBMITTED event
  -> worker consumes event
  -> creates screening task
```

Ada dua model.

### 20.1 Event as Fact

Event hanya menyatakan fakta masa lalu:

```json
{
  "eventType": "APPLICATION_SUBMITTED",
  "applicationId": "app-1",
  "submittedBy": "user-1",
  "tenantId": "agency-1"
}
```

Consumer melakukan action sebagai system:

```text
actor = SYSTEM:screening-worker
initiatedBy = user-1
```

Cocok untuk downstream side effects.

### 20.2 Command as Delegated Action

Message adalah command untuk melakukan action atas nama user:

```json
{
  "commandType": "APPROVE_CASE",
  "caseId": "case-1",
  "actorId": "user-1",
  "tenantId": "agency-1",
  "authorizationDecisionId": "authz-123"
}
```

Consumer harus:

1. Validasi message source.
2. Validasi integrity message.
3. Load actor.
4. Re-check authorization atau validate decision snapshot.
5. Check current case state.
6. Execute idempotently.
7. Audit actor/initiator/executor.

Jangan hanya percaya `actorId` dari message jika message melewati trust boundary.

---

## 21. Downstream Service Calls: Propagate Token or Exchange Token?

Misalnya API A menerima request dari User A lalu memanggil API B.

```text
Browser -> API A -> API B
```

Pilihan:

### 21.1 Propagate Original Access Token

API A meneruskan token user ke API B.

Kelebihan:

- API B tahu user asli.
- Authorization bisa dilakukan end-to-end.

Risiko:

- Token audience mungkin untuk API A, bukan API B.
- API A bisa menjadi confused deputy.
- Token terlalu powerful.
- Log downstream bisa membocorkan token.

### 21.2 Token Exchange

API A menukar token user menjadi token untuk API B.

```text
user token for API A
  -> token exchange
  -> delegated token for API B
```

Kelebihan:

- audience benar,
- scope lebih sempit,
- on-behalf-of semantics lebih jelas.

### 21.3 Service Token + Actor Metadata

API A memanggil API B memakai service credential, sambil mengirim actor metadata yang divalidasi/trusted.

Cocok untuk internal trusted boundary, tetapi butuh hardening:

- mTLS antar service,
- signed headers/JWT internal,
- gateway strips spoofed headers,
- API B hanya percaya header dari trusted caller,
- audit membedakan service caller dan business actor.

Contoh header internal:

```text
Authorization: Bearer <service-token>
X-Actor-Id: user-1
X-Actor-Type: USER
X-Tenant-Id: agency-1
X-Correlation-Id: corr-123
```

Ini hanya aman jika API B bisa memastikan header tidak berasal dari client luar.

---

## 22. Confused Deputy Problem

Confused deputy terjadi ketika komponen dengan privilege tinggi dipakai untuk melakukan sesuatu yang caller sebenarnya tidak boleh lakukan.

Contoh:

```text
User A tidak boleh melihat Case X
API A menerima request user A
API A memakai service admin token ke API B
API B return Case X karena token API A admin
API A mengembalikan data ke User A
```

Akar masalah:

- API B hanya melihat service identity,
- tidak tahu business actor,
- API A tidak enforce authorization dengan benar,
- service token terlalu broad.

Mitigasi:

1. Downstream menerima actor context.
2. Downstream enforce authorization juga.
3. Token audience/scope dibatasi.
4. Token exchange/on-behalf-of.
5. Service token tidak universal admin.
6. Audit caller chain.

Contoh caller chain:

```json
{
  "businessActor": "user-1",
  "serviceCaller": "api-a",
  "downstreamService": "api-b",
  "action": "CASE_READ",
  "resource": "case-x"
}
```

---

## 23. Context Snapshot Design

Untuk aplikasi enterprise, buat object immutable yang merepresentasikan actor.

Contoh:

```java
public record ActorContext(
        String actorId,
        ActorType actorType,
        String subject,
        String issuer,
        String tenantId,
        Set<String> roles,
        Set<String> permissions,
        String authenticationMethod,
        Instant authenticatedAt,
        Instant capturedAt,
        String sessionIdHash,
        String tokenId,
        String correlationId
) {
    public boolean isUser() {
        return actorType == ActorType.USER;
    }

    public boolean isSystem() {
        return actorType == ActorType.SYSTEM || actorType == ActorType.SYSTEM_JOB;
    }
}
```

Jangan masukkan:

- raw password,
- raw access token kecuali benar-benar perlu dan dilindungi,
- `HttpServletRequest`,
- `HttpSession`,
- `EntityManager`,
- mutable JPA entity,
- vendor-specific principal object yang tidak serializable,
- object yang lazy-load database saat audit.

Actor context harus:

1. Immutable.
2. Minimal.
3. Serialisasi aman jika perlu masuk queue.
4. Tidak mengandung secret raw.
5. Punya timestamp.
6. Punya issuer/source.
7. Punya tenant.
8. Punya correlation id.
9. Bisa divalidasi ulang.
10. Mudah dites.

---

## 24. ActorContextFactory

Buat adapter di boundary untuk mengubah container security context menjadi domain actor context.

```java
@RequestScoped
public class ActorContextFactory {

    @Inject
    jakarta.security.enterprise.SecurityContext securityContext;

    @Inject
    TenantResolver tenantResolver;

    @Inject
    CorrelationIdProvider correlationIdProvider;

    public ActorContext requireCurrentActorSnapshot() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new UnauthenticatedException("No authenticated caller");
        }

        String tenantId = tenantResolver.requireTenantId();
        Set<String> roles = extractApplicationRoles();

        return new ActorContext(
                resolveActorId(principal),
                ActorType.USER,
                principal.getName(),
                resolveIssuer(),
                tenantId,
                Set.copyOf(roles),
                Set.of(),
                resolveAuthMethod(),
                resolveAuthenticatedAt(),
                Instant.now(),
                sessionHashOrNull(),
                tokenIdOrNull(),
                correlationIdProvider.current()
        );
    }

    private Set<String> extractApplicationRoles() {
        // avoid enumerating every possible role in code if role universe is external;
        // often loaded from mapped user profile/session/identity service.
        return Set.of();
    }
}
```

Catatan penting:

- `SecurityContext#isCallerInRole` cocok untuk check role tertentu.
- Untuk snapshot semua role, Jakarta Security API tidak selalu menyediakan enumeration universal roles secara portable.
- Role/permission snapshot sering perlu berasal dari application profile/authorization service, bukan langsung dari container.

---

## 25. Explicit Command Context Pattern

Untuk write operation, jangan hanya passing primitive.

Kurang baik:

```java
approvalService.approve(caseId);
```

Lebih baik:

```java
approvalService.approve(new ApproveCaseCommand(
        caseId,
        actor,
        requestMetadata,
        expectedVersion,
        reason
));
```

Contoh:

```java
public record ApproveCaseCommand(
        String caseId,
        ActorContext actor,
        RequestMetadata request,
        long expectedVersion,
        String approvalReason
) {}
```

Service:

```java
@Transactional
public void approve(ApproveCaseCommand cmd) {
    Case c = caseRepository.findForUpdate(cmd.caseId());

    authorizationService.requireAllowed(
            cmd.actor(),
            "CASE_APPROVE",
            c.toAuthorizationResource()
    );

    c.approve(cmd.actor().actorId(), cmd.approvalReason());

    auditService.record(AuditEvent.caseApproved(
            c.id(),
            cmd.actor(),
            cmd.request().correlationId()
    ));
}
```

Keuntungan:

- actor eksplisit,
- audit eksplisit,
- test mudah,
- async mudah,
- domain invariant jelas,
- tidak bergantung ke global context.

---

## 26. System Identity Pattern

Buat system identity yang terbatas.

```java
public enum SystemActor {
    CASE_EXPIRY_JOB,
    EMAIL_WORKER,
    SEARCH_INDEXER,
    REPORT_GENERATOR,
    DATA_ARCHIVAL_JOB
}
```

Factory:

```java
public ActorContext systemActor(SystemActor actor, String tenantId, String correlationId) {
    return new ActorContext(
            "system:" + actor.name().toLowerCase(Locale.ROOT),
            ActorType.SYSTEM_JOB,
            actor.name(),
            "internal-system",
            tenantId,
            Set.of(),
            permissionsFor(actor),
            "SYSTEM_INTERNAL",
            Instant.now(),
            Instant.now(),
            null,
            null,
            correlationId
    );
}
```

Jangan gunakan:

```java
SYSTEM_ADMIN_ALL
```

Gunakan permission yang sempit:

```text
EMAIL_SEND_SYSTEM
CASE_EXPIRE_SYSTEM
SEARCH_INDEX_UPDATE_SYSTEM
REPORT_RENDER_SYSTEM
ARCHIVAL_EXPORT_SYSTEM
```

System actor harus bisa ditanya:

```text
Mengapa system ini boleh melakukan action ini?
```

Jika jawabannya “karena system boleh semua”, desainnya lemah.

---

## 27. Run-As vs On-Behalf-Of

`Run-As` dalam container security dan konsep `on-behalf-of` sering tercampur.

### 27.1 Run-As

Komponen berjalan dengan role tertentu untuk memanggil komponen lain.

Contoh konseptual:

```text
Component A run-as INTERNAL_SERVICE
calls Component B requiring INTERNAL_SERVICE
```

Ini mekanisme teknis intra-container.

### 27.2 On-Behalf-Of

Service melakukan action atas nama user asli.

```text
API A calls API B on behalf of User A
```

Dalam audit:

```json
{
  "serviceActor": "api-a",
  "businessActor": "user-a",
  "delegationType": "ON_BEHALF_OF"
}
```

Kesalahan umum:

```text
run-as role dianggap sama dengan user delegation
```

Padahal:

- run-as menjawab “role teknis apa yang dipakai komponen?”
- on-behalf-of menjawab “atas nama siapa aksi bisnis dilakukan?”

---

## 28. Authorization Timing: Submit-Time vs Execute-Time

Dalam async system, authorization bisa dievaluasi pada dua waktu.

### 28.1 Submit-Time Authorization

Check dilakukan saat user submit request.

```text
User A boleh generate report saat klik tombol
```

Cocok untuk:

- request pendek,
- side effect dimulai segera,
- keputusan bisnis terikat moment submission.

### 28.2 Execute-Time Authorization

Check dilakukan saat worker benar-benar menjalankan task.

```text
Saat worker memproses, cek apakah User A masih boleh generate report
```

Cocok untuk:

- task tertunda lama,
- role bisa berubah,
- resource state bisa berubah,
- action sensitif.

### 28.3 Hybrid

Check saat submit dan execute.

```text
submit: apakah boleh membuat request?
execute: apakah request masih valid terhadap state saat ini?
```

Contoh:

```java
public void submitApproval(String caseId) {
    ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();
    Case c = caseRepository.get(caseId);

    authorizationService.requireAllowed(actor, "CASE_APPROVAL_SUBMIT", c);

    approvalQueue.enqueue(new ApprovalCommand(
            caseId,
            actor.minimalSnapshot(),
            c.version(),
            authorizationDecisionRecorder.snapshot()
    ));
}

public void executeApproval(ApprovalCommand cmd) {
    Case c = caseRepository.findForUpdate(cmd.caseId());

    if (c.version() != cmd.expectedCaseVersion()) {
        throw new StaleCaseStateException();
    }

    authorizationService.requireAllowed(cmd.actor(), "CASE_APPROVAL_EXECUTE", c);
    c.approve(cmd.actor().actorId());
}
```

---

## 29. TOCTOU in Authorization

TOCTOU = Time Of Check To Time Of Use.

Contoh:

```java
authorizationService.requireAllowed(actor, "CASE_APPROVE", caseId);
Case c = caseRepository.get(caseId);
c.approve();
```

Masalah:

- authorization check dilakukan sebelum load/lock state final,
- case bisa berubah antara check dan approve,
- assignment bisa berubah,
- status bisa berubah,
- tenant could mismatch.

Lebih baik:

```java
@Transactional
public void approve(String caseId, ActorContext actor) {
    Case c = caseRepository.findForUpdate(caseId);

    authorizationService.requireAllowed(actor, "CASE_APPROVE", c.toAuthorizationResource());

    c.approve(actor.actorId());
}
```

Untuk async:

```java
@Transactional
public void executeQueuedApproval(ApprovalCommand cmd) {
    Case c = caseRepository.findForUpdate(cmd.caseId());

    authorizationService.requireAllowed(cmd.actor(), "CASE_APPROVE", c.toAuthorizationResource());

    c.approve(cmd.actor().actorId());
}
```

Security context propagation tidak boleh menutupi TOCTOU. Bahkan jika actor benar, resource state bisa sudah berubah.

---

## 30. Context Leakage Through MDC Logging

MDC/diagnostic context sering memakai ThreadLocal.

Contoh:

```java
MDC.put("actorId", actor.actorId());
MDC.put("tenantId", actor.tenantId());
MDC.put("correlationId", actor.correlationId());
try {
    chain.doFilter(req, resp);
} finally {
    MDC.clear();
}
```

Jika lupa clear:

```text
Log request B bisa tercatat dengan actor request A
```

Ini bukan hanya observability bug. Dalam forensic investigation, ini bisa menjadi false attribution.

Untuk async executor, wrap task:

```java
public Runnable withMdc(Map<String, String> contextMap, Runnable task) {
    return () -> {
        Map<String, String> old = MDC.getCopyOfContextMap();
        try {
            if (contextMap != null) {
                MDC.setContextMap(contextMap);
            } else {
                MDC.clear();
            }
            task.run();
        } finally {
            if (old != null) {
                MDC.setContextMap(old);
            } else {
                MDC.clear();
            }
        }
    };
}
```

Tetapi jangan anggap MDC sebagai source of truth authorization. MDC hanya observability.

---

## 31. Request Context vs Security Context vs Transaction Context

Tiga context ini sering tercampur.

| Context | Fungsi | Boleh dipropagasikan? |
|---|---|---|
| Request context | lifecycle object per HTTP request | biasanya tidak melewati async long-running |
| Security context | caller/security state | hati-hati, sering perlu snapshot/revalidation |
| Transaction context | database transaction | jangan dipropagasikan sembarangan ke async |

Anti-pattern:

```java
@Transactional
public void submit() {
    executor.submit(() -> repository.save(...)); // async keluar dari transaction boundary
}
```

Masalah:

- transaction parent tidak ikut,
- entity detached,
- security context hilang,
- error terjadi setelah response success,
- audit tidak transactional.

Lebih baik:

```java
@Transactional
public void submit() {
    OutboxEvent event = outbox.create(...);
    // transaction commits event
}

// worker reads outbox after commit
public void processOutbox() {
    // new transaction, explicit actor/system context
}
```

---

## 32. Outbox Pattern and Security Context

Outbox pattern membantu menjaga konsistensi antara database state dan event publishing.

Saat user melakukan action:

```java
@Transactional
public void approve(ApproveCaseCommand cmd) {
    Case c = caseRepository.findForUpdate(cmd.caseId());
    authorizationService.requireAllowed(cmd.actor(), "CASE_APPROVE", c);

    c.approve(cmd.actor().actorId());

    outboxRepository.save(new OutboxEvent(
            "CASE_APPROVED",
            c.id(),
            cmd.actor().minimalAuditSnapshot(),
            cmd.request().correlationId()
    ));
}
```

Worker:

```java
public void publishOutboxEvent(OutboxEvent event) {
    ActorContext executor = systemActorFactory.outboxPublisher(event.tenantId());

    auditService.recordTechnicalExecution(
            executor,
            event.originalActor(),
            event.eventType(),
            event.aggregateId()
    );

    messageBroker.publish(event);
}
```

Keuntungan:

- original actor tersimpan dengan event,
- event tidak hilang jika publish gagal,
- worker tidak perlu “mencari security context request lama”,
- audit chain jelas.

---

## 33. Security Context in WebSocket

WebSocket dimulai dari HTTP handshake, lalu menjadi long-lived connection.

Masalah:

- user login saat handshake,
- session bisa expire setelah WebSocket terbuka,
- role bisa berubah,
- user logout di HTTP session,
- connection masih hidup,
- message-level authorization sering lupa.

Pola:

1. Authenticate saat handshake.
2. Capture actor snapshot for connection.
3. Validate tenant/channel subscription.
4. Check authorization per message/action, bukan hanya saat connect.
5. Close connection jika session revoked/token expired jika model mensyaratkan.
6. Audit sensitive messages.

Contoh conceptual:

```java
public void onMessage(Session wsSession, ClientMessage msg) {
    ActorContext actor = (ActorContext) wsSession.getUserProperties().get("actor");

    authorizationService.requireAllowed(actor, msg.action(), msg.resource());

    messageHandler.handle(actor, msg);
}
```

Jangan anggap WebSocket connection yang pernah authenticated akan selamanya valid.

---

## 34. Security Context in Batch Processing

Batch job bisa memproses ribuan record. Actor biasanya system job.

Masalah:

- job butuh akses cross-tenant,
- data retention rules berbeda per tenant,
- audit volume besar,
- retry bisa membuat duplicate action,
- partial failure.

Pola:

```java
public void runArchivalJob() {
    String runId = UUID.randomUUID().toString();

    for (Tenant tenant : tenantRepository.activeTenants()) {
        ActorContext actor = systemActorFactory.archivalJob(tenant.id(), runId);
        archiveTenantData(actor, tenant.id());
    }
}
```

Jangan pakai satu actor global tanpa tenant.

```java
// buruk
ActorContext actor = SYSTEM_ARCHIVAL_ALL_TENANTS;
```

Lebih baik:

```java
ActorContext actor = SYSTEM_ARCHIVAL_FOR_TENANT_X;
```

Audit:

```json
{
  "eventType": "ARCHIVAL_BATCH_RECORD_PROCESSED",
  "systemActor": "system:job:data-archival",
  "tenantId": "agency-1",
  "batchRunId": "run-123",
  "recordId": "case-1"
}
```

---

## 35. Security Context in Caches

Caching authorization result bisa meningkatkan performa, tetapi bisa menyebabkan stale privilege.

Contoh:

```text
User A punya ROLE_APPROVER
Authorization result cached 30 minutes
Admin mencabut ROLE_APPROVER
User A masih bisa approve sampai cache expire
```

Pola mitigasi:

1. Cache role mapping pendek.
2. Cache permission with policy version.
3. Invalidate on role change.
4. Use event-driven invalidation.
5. Recheck sensitive action live.
6. Different cache TTL by sensitivity.
7. Store denial and allow separately with care.

Cache key harus mencakup:

```text
actorId
tenantId
action
resourceType
resourceId/resource attributes
resourceState/version
policyVersion
roleVersion
```

Cache key buruk:

```text
actorId + action
```

Karena mengabaikan tenant/resource/state.

---

## 36. Security Context and Tenant Context Must Move Together

Identity tanpa tenant sering tidak cukup.

Contoh user:

```text
User A belongs to Agency 1 and Agency 2
Role in Agency 1: APPROVER
Role in Agency 2: VIEWER
```

Jika async task hanya membawa `userId`, worker bisa salah tenant.

Buruk:

```json
{
  "actorId": "user-a",
  "action": "APPROVE_CASE",
  "caseId": "case-1"
}
```

Lebih baik:

```json
{
  "actorId": "user-a",
  "tenantId": "agency-1",
  "activeOrganizationId": "org-9",
  "action": "APPROVE_CASE",
  "caseId": "case-1"
}
```

Authorization harus memastikan:

```text
case.tenantId == actor.tenantId
```

Dan untuk cross-tenant admin:

```text
actor has CROSS_TENANT permission with explicit target tenant
```

---

## 37. Null Security Context: Fail Closed

Jika context hilang, jangan fallback ke permissive behavior.

Buruk:

```java
ActorContext actor = CurrentActorHolder.get();
if (actor == null) {
    actor = ActorContext.systemAdmin(); // dangerous fallback
}
```

Lebih baik:

```java
ActorContext actor = CurrentActorHolder.get();
if (actor == null) {
    throw new MissingSecurityContextException();
}
```

Untuk job/system process, actor harus eksplisit:

```java
public void runJob() {
    ActorContext actor = systemActorFactory.caseExpiryJob(tenantId);
    service.expireCases(actor);
}
```

Jangan membuat service domain menebak actor.

---

## 38. Testing Security Context Propagation

Security context propagation harus dites sebagai failure scenario, bukan hanya happy path.

### 38.1 Unit Test Actor Explicitness

```java
@Test
void approveRequiresActor() {
    assertThrows(NullPointerException.class, () -> {
        service.approve(new ApproveCaseCommand("case-1", null, metadata, 1L, "ok"));
    });
}
```

Lebih baik custom exception:

```java
if (cmd.actor() == null) {
    throw new MissingActorException();
}
```

### 38.2 Async Context Lost Test

Test bahwa service tidak bergantung pada `ThreadLocal`.

```java
@Test
void asyncTaskUsesExplicitActor() throws Exception {
    ActorContext actor = fixture.actor("user-1", "agency-1", Set.of("CASE_VIEWER"));

    CompletionStage<CaseSummary> stage = service.summaryAsync("case-1", actor);

    CaseSummary result = stage.toCompletableFuture().get(5, TimeUnit.SECONDS);

    assertEquals("case-1", result.id());
}
```

### 38.3 ThreadLocal Leakage Test

```java
@Test
void threadLocalMustBeCleared() {
    CurrentActorHolder.set(actorA);
    CurrentActorHolder.clear();

    assertNull(CurrentActorHolder.get());
}
```

For executor:

```java
@Test
void executorMustNotLeakActorBetweenTasks() throws Exception {
    ExecutorService executor = Executors.newSingleThreadExecutor();

    Future<?> f1 = executor.submit(() -> {
        CurrentActorHolder.set(actorA);
        // simulate bug: no clear
    });
    f1.get();

    Future<ActorContext> f2 = executor.submit(CurrentActorHolder::get);

    assertNull(f2.get(), "actor leaked from previous task");
}
```

This test intentionally fails if implementation forgets cleanup.

### 38.4 Tenant Propagation Test

```java
@Test
void queuedCommandMustContainTenant() {
    ApprovalCommand cmd = queue.dequeue();
    assertNotNull(cmd.tenantId());
}
```

### 38.5 Execute-Time Recheck Test

```java
@Test
void queuedApprovalFailsIfAssignmentChangedBeforeExecution() {
    ApprovalCommand cmd = submitApprovalAs(userA);

    reassignCaseTo(userB);

    assertThrows(ForbiddenException.class, () -> worker.execute(cmd));
}
```

---

## 39. Observability Checklist

For every async/security context boundary, log/audit:

```text
correlationId
requestId
actorId
actorType
tenantId
action
resourceType
resourceId
executorType
executorId
initiatedBy
onBehalfOf
policyVersion
decisionId
threadName/taskId/jobRunId
```

But do not log:

```text
raw password
raw token
session id raw
refresh token
private key
client secret
full certificate private data
unredacted PII unless required and controlled
```

For logs, prefer:

```text
sessionIdHash
tokenId/jti
certificate thumbprint
actor stable id
```

---

## 40. Production Failure Patterns

### 40.1 User Identity Lost in Async Task

Symptom:

```text
Async report generation fails with null principal
```

Root cause:

```text
Worker tried to inject/read request SecurityContext outside request lifecycle
```

Fix:

```text
Capture ActorContext at submit time and pass explicitly
```

### 40.2 Previous User Leaked to Next Request

Symptom:

```text
Audit log shows wrong user for random requests
```

Root cause:

```text
ThreadLocal/MDC not cleared in finally
```

Fix:

```text
Boundary filter/interceptor must always clear context
```

### 40.3 Role Revoked but Async Task Still Executes

Symptom:

```text
User removed from approver group but queued approval still completes
```

Root cause:

```text
Only submit-time authorization, no execute-time recheck
```

Fix:

```text
Define business semantics; for sensitive action, recheck at execute time
```

### 40.4 System Worker Has Too Much Power

Symptom:

```text
Email worker can mutate case state
```

Root cause:

```text
SYSTEM_ADMIN_ALL permission reused
```

Fix:

```text
Use narrow system permissions per worker/job
```

### 40.5 Tenant Context Missing

Symptom:

```text
Queued job updates record in wrong tenant
```

Root cause:

```text
Message carried actorId but not tenantId/organization context
```

Fix:

```text
Tenant must be mandatory part of actor/task context
```

### 40.6 Downstream Service Uses Service Token Only

Symptom:

```text
API B returns data user should not see
```

Root cause:

```text
API B authorizes service identity but ignores business actor
```

Fix:

```text
Token exchange, actor propagation, downstream authorization
```

### 40.7 MDC False Attribution

Symptom:

```text
Logs show user A for user B request
```

Root cause:

```text
MDC ThreadLocal not cleared in pooled thread
```

Fix:

```text
MDC set/restore/clear wrapper
```

---

## 41. Design Decision Matrix

| Scenario | Recommended identity model |
|---|---|
| Synchronous HTTP request | Use container `SecurityContext`, convert to `ActorContext` at boundary |
| Short async continuation | Capture explicit actor snapshot; use managed executor |
| Long-running queued command | Store actor/tenant/decision snapshot; recheck if sensitive |
| Technical side effect | System executor + initiatedBy original user |
| Scheduled job | Narrow system job actor per job/tenant |
| Downstream service | Token exchange or service token + verified actor context |
| Reactive pipeline | Pass actor explicitly or use reactive context deliberately |
| Virtual threads | Still use explicit actor; do not rely on magic propagation |
| Batch processing | System actor + tenant-scoped execution + batch run id |
| WebSocket | Capture at handshake, check per message/action |

---

## 42. A Practical Architecture for Jakarta Apps

Recommended structure:

```text
HTTP/JAX-RS Boundary
  -> authenticate via container/Jakarta Security
  -> resolve tenant
  -> create ActorContext snapshot
  -> create RequestMetadata
  -> call application service with explicit command/query

Application Service
  -> authorization check using actor + resource + state
  -> transactional domain mutation
  -> audit/outbox writes with actor snapshot

Async Worker
  -> system executor identity
  -> load queued command/event
  -> validate message/source
  -> recheck authorization if needed
  -> execute idempotently
  -> audit business actor + technical executor

Downstream Client
  -> choose token propagation/exchange/service token
  -> include correlation id and actor chain
  -> never forward raw user token blindly to wrong audience
```

Diagram:

```text
[HTTP Request]
      |
      v
[Container Authentication]
      |
      v
[SecurityContext]
      |
      v
[ActorContextFactory] ---> [RequestMetadata]
      |
      v
[Application Command]
      |
      v
[AuthorizationService]
      |
      v
[Domain Mutation + Audit + Outbox]
      |
      v
[Async Worker / Downstream Service]
      |
      v
[System Executor + InitiatedBy + Optional Recheck]
```

---

## 43. Code Example: End-to-End Approval with Async Notification

### 43.1 Resource Boundary

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    ActorContextFactory actorContextFactory;

    @Inject
    RequestMetadataFactory requestMetadataFactory;

    @Inject
    CaseApprovalService approvalService;

    @POST
    @Path("/{caseId}/approve")
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("caseId") String caseId, ApproveRequest body) {
        ActorContext actor = actorContextFactory.requireCurrentActorSnapshot();
        RequestMetadata metadata = requestMetadataFactory.current();

        approvalService.approve(new ApproveCaseCommand(
                caseId,
                actor,
                metadata,
                body.expectedVersion(),
                body.reason()
        ));

        return Response.noContent().build();
    }
}
```

### 43.2 Application Service

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    AuthorizationService authorizationService;

    @Inject
    AuditService auditService;

    @Inject
    OutboxRepository outboxRepository;

    @Transactional
    public void approve(ApproveCaseCommand cmd) {
        Case c = caseRepository.findForUpdate(cmd.caseId());

        if (c.version() != cmd.expectedVersion()) {
            throw new StaleStateException("Case was changed by another operation");
        }

        AuthorizationDecision decision = authorizationService.requireAllowed(
                cmd.actor(),
                "CASE_APPROVE",
                c.toAuthorizationResource()
        );

        c.approve(cmd.actor().actorId(), cmd.reason());

        auditService.record(AuditEvent.caseApproved(
                c.id(),
                cmd.actor(),
                cmd.requestMetadata(),
                decision
        ));

        outboxRepository.save(OutboxEvent.notificationRequested(
                c.id(),
                cmd.actor().minimalSnapshot(),
                cmd.requestMetadata().correlationId()
        ));
    }
}
```

### 43.3 Outbox Worker

```java
@ApplicationScoped
public class NotificationOutboxWorker {

    @Inject
    SystemActorFactory systemActorFactory;

    @Inject
    NotificationService notificationService;

    @Transactional
    public void process(OutboxEvent event) {
        ActorContext executor = systemActorFactory.notificationWorker(
                event.tenantId(),
                event.correlationId()
        );

        notificationService.sendCaseApprovedNotification(
                event.caseId(),
                executor,
                event.originalActor()
        );
    }
}
```

### 43.4 Notification Service

```java
public void sendCaseApprovedNotification(
        String caseId,
        ActorContext executor,
        ActorContext initiatedBy
) {
    authorizationService.requireAllowed(executor, "NOTIFICATION_SEND_SYSTEM", caseId);

    emailClient.send(...);

    auditService.record(AuditEvent.notificationSent(
            caseId,
            executor,
            initiatedBy
    ));
}
```

This design preserves:

- user actor,
- system executor,
- tenant,
- correlation id,
- authorization decision,
- transactional consistency,
- async safety.

---

## 44. Security Context Propagation Checklist

Before moving work to another thread/task/message, ask:

1. What identity should apply in the new execution scope?
2. Is it the same user, system, service, or delegated actor?
3. Is this continuation immediate or delayed?
4. Should authorization be checked at submit time, execute time, or both?
5. Is tenant context included?
6. Is resource state/version included?
7. Is correlation id included?
8. Is audit actor different from technical executor?
9. Are roles/permissions snapshot or live?
10. What happens if user logs out?
11. What happens if role is revoked?
12. What happens if resource is reassigned?
13. What happens if task retries tomorrow?
14. Is message source trusted?
15. Can headers/metadata be spoofed?
16. Does downstream validate audience/scope?
17. Are ThreadLocal/MDC values cleared?
18. Is the executor container-managed?
19. Are exceptions audited?
20. Does missing context fail closed?

---

## 45. Java 8–25 Notes

### Java 8

- `CompletableFuture` introduced.
- Common pool trap common in enterprise apps.
- No virtual threads.
- Jakarta EE namespace usually still `javax` era depending stack.

### Java 9–17

- Module system can affect reflective/security integrations.
- Many Jakarta EE runtimes move gradually from Java EE to Jakarta namespace.
- `SecurityManager` deprecation/removal direction reduces relevance of old Java SE permission model for app-level authorization.

### Java 21

- Virtual threads become a major concurrency option.
- Structured concurrency and scoped values become important concepts, though adoption depends on final/preview/incubator status and platform support.
- ThreadLocal assumptions need performance and lifecycle review.

### Java 25

- Treat virtual-thread/container integration as platform-specific.
- Use official app server support matrix.
- Do not assume old Java EE context propagation behavior is identical under virtual-thread-based execution.

Across Java 8–25, stable architecture principle remains:

```text
Boundary creates explicit ActorContext.
Domain receives explicit actor.
Async receives explicit command/context.
System work uses explicit system actor.
Authorization is checked against current resource state when needed.
Audit records actor + executor + initiator.
```

---

## 46. What a Top 1% Engineer Should Internalize

A strong engineer does not merely ask:

```text
How do I access SecurityContext in async code?
```

They ask:

```text
Should this async code run as the user, as system, or as a delegated actor?
What is the security boundary?
What is the lifetime of this identity?
What must be revalidated?
What must be audited?
What failure mode is acceptable?
```

Key mental shifts:

1. Security context is scoped, not global.
2. Thread is an execution detail, not an identity boundary.
3. Async changes authorization semantics.
4. System identity must be narrow and explicit.
5. Actor and executor are different concepts.
6. Tenant must propagate with actor.
7. Missing context should fail closed.
8. ThreadLocal must be treated as hazardous material.
9. Authorization should be close to state mutation.
10. Audit should be designed before incident happens.

---

## 47. Summary

Security context propagation is the discipline of preserving correct identity semantics across execution boundaries.

In Jakarta/Java enterprise systems, execution boundaries include:

- Servlet async,
- managed executors,
- `CompletableFuture`,
- scheduled jobs,
- message consumers,
- downstream APIs,
- reactive pipelines,
- WebSocket,
- virtual threads,
- batch workers.

The safest design is not to blindly copy framework context. Instead:

1. Authenticate at the boundary.
2. Convert container identity to explicit immutable actor context.
3. Include tenant and request metadata.
4. Pass actor explicitly to domain/application services.
5. For async, store actor/decision snapshot deliberately.
6. Recheck authorization when business semantics require it.
7. Use narrow system actors for technical work.
8. Differentiate actor, initiator, and executor.
9. Clear ThreadLocal/MDC in all paths.
10. Audit every sensitive boundary.

If you master this, you can design security architecture that remains correct even when the codebase grows from simple synchronous request handling into complex distributed workflow execution.

---

## 48. References

- Jakarta Security 4.0 Specification — https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta Security 4.0 API — `SecurityContext` — https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/securitycontext
- Jakarta Servlet 6.1 Specification — Async Processing — https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Concurrency 3.0 Specification — https://jakarta.ee/specifications/concurrency/3.0/jakarta-concurrency-spec-3.0
- Jakarta Concurrency `ManagedExecutorService` API — https://jakarta.ee/specifications/concurrency/3.1/apidocs/jakarta.concurrency/jakarta/enterprise/concurrent/managedexecutorservice
- MicroProfile Context Propagation — https://microprofile.io/specifications/microprofile-context-propagation/
- Java Platform Documentation — Virtual Threads, Scoped Values, Structured Concurrency concepts depend on Java version and feature status.

---

## 49. Status Seri

Selesai:

- Part 00 — Orientation: Enterprise Java Security Mental Model
- Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
- Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
- Part 03 — Container Security Architecture
- Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
- Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
- Part 06 — Jakarta Security API Core
- Part 07 — SecurityContext Deep Dive
- Part 08 — IdentityStore Deep Dive
- Part 09 — Credentials and Password Handling in Jakarta Applications
- Part 10 — Jakarta Authentication / JASPIC Deep Dive
- Part 11 — Jakarta Authorization / JACC Deep Dive
- Part 12 — Declarative Authorization: URL, Method, Class, Role
- Part 13 — Programmatic Authorization and Domain Permission Design
- Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
- Part 15 — Session Security: Login State, HttpSession, Cookies, Logout
- Part 16 — Token-Based Security in Jakarta Applications
- Part 17 — OpenID Connect in Jakarta Security
- Part 18 — OAuth2 Resource Server Pattern for JAX-RS and Servlet APIs
- Part 19 — SAML, Enterprise SSO, and Legacy Federation Integration
- Part 20 — mTLS, Client Certificates, and Strong Caller Authentication
- Part 21 — Method Security with CDI, EJB, Interceptors, and Proxies
- Part 22 — Security Context Propagation: Threads, Executors, Async, Virtual Threads, Reactive

Berikutnya:

- Part 23 — Multi-Tenancy, Organization Boundary, and Cross-Entity Authorization

Seri belum selesai.
