# learn-java-authentication-modes-and-patterns-part-008

# Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 sampai Java 25  
> Fokus part ini: memahami bagaimana identity/security context bergerak, hilang, bocor, atau berubah saat execution berpindah dari request thread ke async task, executor, reactive pipeline, virtual thread, structured concurrency, scheduler, dan background process.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas:

- authentication sebagai proses membuktikan identitas,
- runtime Java security foundation,
- taxonomy authentication modes,
- password authentication,
- session-based authentication,
- Servlet container authentication,
- Jakarta Security dan Jakarta Authentication,
- Spring Security authentication architecture.

Part ini membahas masalah yang sering tidak terlihat di tutorial authentication:

> Setelah user berhasil diautentikasi, **bagaimana identitas itu tetap benar sepanjang eksekusi request?**

Di aplikasi sederhana, jawabannya terlihat mudah:

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
```

Namun di sistem produksi, eksekusi tidak selalu linear:

- request masuk ke servlet thread,
- service method memanggil `CompletableFuture`,
- event dikirim ke executor,
- request turun ke WebClient reactive pipeline,
- job async berjalan setelah response dikirim,
- virtual thread dipakai untuk throughput tinggi,
- scheduler menjalankan retry,
- audit trail dibuat di layer berbeda,
- downstream service menerima propagated token atau technical identity.

Di titik-titik itulah authentication context sering rusak.

Part ini bukan sekadar “pakai wrapper executor”. Tujuannya adalah membangun mental model supaya kita bisa menjawab:

1. identity ini milik siapa?
2. berlaku di scope apa?
3. boleh dibawa ke thread lain atau tidak?
4. boleh dibawa ke waktu lain atau tidak?
5. boleh dipakai untuk call downstream atau hanya untuk audit?
6. kapan harus clear?
7. kapan harus snapshot?
8. kapan harus explicit parameter?
9. kapan harus berubah dari end-user identity menjadi service identity?
10. bagaimana failure mode-nya diuji?

---

## 1. Problem yang Diselesaikan

Authentication bukan berhenti di login.

Login menghasilkan *authenticated identity*, tetapi aplikasi masih harus menjaga agar identity itu:

- tersedia di tempat yang membutuhkan,
- tidak tersedia di tempat yang tidak boleh,
- tidak tertukar antar request,
- tidak bocor antar tenant,
- tidak hidup lebih lama dari scope-nya,
- tidak berubah diam-diam saat masuk async boundary,
- tidak dipakai untuk aksi yang semestinya memakai service identity,
- dapat diaudit setelah request selesai.

Masalah ini disebut **authentication context propagation**.

Secara sederhana:

> Authentication context propagation adalah desain bagaimana informasi identitas yang sudah diautentikasi dibawa dari satu execution boundary ke boundary lain secara aman, eksplisit, dan dapat diaudit.

Contoh boundary:

| Boundary | Contoh |
|---|---|
| Thread boundary | servlet thread ke executor thread |
| Async boundary | `@Async`, `CompletableFuture`, scheduled job |
| Reactive boundary | imperative code ke Reactor chain |
| Process boundary | service A ke service B |
| Time boundary | request sekarang ke background job nanti |
| Trust boundary | browser ke backend, backend ke internal service |
| Tenant boundary | tenant A ke tenant B |
| Privilege boundary | normal user ke admin operation |

Authentication context propagation harus diperlakukan sebagai bagian dari security architecture, bukan hanya helper teknis.

---

## 2. Mental Model Utama

### 2.1 Authentication Context Bukan User Object

Kesalahan umum:

> “Security context itu user yang sedang login.”

Lebih tepat:

> Security context adalah **snapshot klaim autentikasi** yang dianggap valid pada scope tertentu.

Context dapat berisi:

- principal identifier,
- authentication method,
- authority/group/role,
- credential metadata,
- tenant,
- issuer,
- session id,
- token id,
- correlation id,
- client id,
- actor chain,
- authentication time,
- assurance level,
- delegated identity.

Jangan anggap context sebagai object bebas yang bisa dipindahkan ke mana saja.

Context memiliki **scope**.

---

### 2.2 Scope adalah Kunci

Authentication context selalu harus dijawab dengan pertanyaan:

> Identity ini valid untuk scope apa?

Beberapa scope umum:

| Scope | Makna |
|---|---|
| Request scope | valid hanya selama HTTP request berjalan |
| Session scope | valid selama session masih valid |
| Token scope | valid selama token valid dan audience cocok |
| Transaction scope | valid selama unit of work tertentu |
| Job scope | valid selama job execution tertentu |
| Message scope | valid untuk pemrosesan message tertentu |
| Tenant scope | valid hanya dalam tenant tertentu |
| Delegation scope | valid hanya untuk aksi delegated tertentu |
| Audit scope | valid sebagai historical actor, bukan live authorization |

Authentication context yang benar di request scope belum tentu benar di background job scope.

Contoh:

```text
User A klik "generate report".
Report generation berjalan 30 menit di background.
```

Pertanyaan desain:

- Apakah report job masih berjalan sebagai User A?
- Bagaimana jika User A logout?
- Bagaimana jika role User A dicabut 5 menit setelah job dimulai?
- Bagaimana jika session expired?
- Bagaimana jika tenant User A disabled?
- Audit mencatat siapa: User A, system job, atau keduanya?

Jawaban production-grade biasanya bukan “copy SecurityContext ke background thread”, tetapi:

```text
initiatedBy = User A
executedBy = report-service
authorizationSnapshot = permission set at submission time OR revalidated at execution time
```

---

### 2.3 Propagation Bukan Selalu Hal yang Benar

Kadang context harus dipropagasikan.

Kadang context harus **diputus**.

Kadang context harus **ditransformasikan**.

| Situasi | Aksi yang benar |
|---|---|
| Service method masih dalam request yang sama | propagate request context |
| Async audit event | propagate minimal actor snapshot |
| Background job jangka panjang | transform menjadi job identity + initiatedBy |
| Downstream call atas nama user | propagate delegated user token/token exchange |
| Downstream call internal | use service identity |
| Scheduled retry | do not reuse old user session context |
| Batch cleanup | system identity, not last request user |
| Admin impersonation | explicit actor chain |

Top 1% engineer tidak bertanya “bagaimana copy context?”, tetapi:

> “Apakah context ini secara domain dan security boleh hidup di boundary berikutnya?”

---

## 3. Core Concepts

### 3.1 Principal

Principal adalah representasi identitas.

Contoh:

```text
user:12345
service:payment-api
client:partner-abc
device:terminal-009
job:daily-reconciliation
```

Principal harus stabil dan tidak bergantung pada display name.

Buruk:

```text
principal = "Fajar"
```

Lebih baik:

```text
principalId = "usr_01H..."
displayName = "Fajar Abdi Nugraha"
```

---

### 3.2 Authentication

Authentication adalah hasil pembuktian identitas.

Di Spring Security, `Authentication` biasanya berisi:

- principal,
- credentials,
- authorities,
- authenticated flag,
- details.

Namun secara mental model, authentication juga harus membawa metadata:

```text
method = password + totp
issuer = https://idp.example.com
sessionId = s_123
tokenId = jwt_jti_456
authTime = 2026-06-19T10:15:00Z
assuranceLevel = aal2
tenantId = agency-a
```

---

### 3.3 Security Context

Security context adalah container dari authentication state untuk execution scope tertentu.

Di Spring Security, `SecurityContextHolder` secara default menyimpan `SecurityContext` menggunakan `ThreadLocal`. Dokumentasi Spring Security menjelaskan bahwa default storage tersebut membuat context tersedia di method dalam thread yang sama, dan harus dibersihkan setelah request selesai.

Konsep penting:

```text
SecurityContext != session
SecurityContext != token
SecurityContext != database user
SecurityContext != current human user forever
```

SecurityContext adalah *current execution identity view*.

---

### 3.4 Execution Boundary

Execution boundary adalah titik di mana asumsi “kode berikutnya berjalan di context yang sama” bisa salah.

Contoh boundary:

```java
executor.submit(() -> doSomething());
```

```java
CompletableFuture.supplyAsync(() -> loadData());
```

```java
Mono.defer(() -> service.call());
```

```java
Thread.startVirtualThread(() -> handle());
```

```java
@Async
public void sendEmail() { ... }
```

```java
@Scheduled
public void retryFailedJobs() { ... }
```

Setiap boundary harus didesain.

---

### 3.5 Context Capture vs Context Lookup

Ada dua pola besar.

#### Context Lookup

Kode membaca context saat dibutuhkan:

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
```

Kelebihan:

- mudah,
- framework-friendly,
- cocok untuk request synchronous.

Kekurangan:

- implicit dependency,
- rawan hilang di async boundary,
- rawan salah context jika thread reused,
- sulit dites,
- sulit dianalisis secara architecture.

#### Context Capture

Kode mengambil snapshot explicit di boundary:

```java
ActorContext actor = ActorContext.from(authentication);
executor.submit(() -> process(actor, command));
```

Kelebihan:

- jelas,
- testable,
- aman untuk async/job,
- mudah diaudit.

Kekurangan:

- lebih verbose,
- perlu disiplin desain,
- perlu membedakan snapshot vs live identity.

Production-grade system biasanya memakai kombinasi:

```text
request handling: framework context lookup
cross-boundary: explicit context capture/transform
long-running async: actor snapshot + system execution identity
```

---

## 4. Java 8–25 Relevance

### 4.1 Java 8 Baseline

Di Java 8, model umum context propagation adalah:

- `ThreadLocal`,
- `InheritableThreadLocal`,
- executor wrapper,
- explicit parameter,
- MDC logging context,
- framework-specific context.

Masalah utama:

- thread pool reuse,
- context leakage,
- missing clear,
- async execution losing context,
- `CompletableFuture.supplyAsync` memakai common pool jika executor tidak diberikan,
- context hidden dari method signature.

---

### 4.2 Java 9–17

Periode ini membawa modernisasi platform, tetapi untuk authentication context propagation, pola umum masih:

- thread-bound context,
- executor wrapping,
- framework propagation,
- explicit context passing.

Java 17 sebagai LTS banyak dipakai untuk Spring Boot 3 dan Jakarta EE modern, sehingga banyak aplikasi enterprise berada di fase:

```text
ThreadLocal security context + async/reactive boundary + distributed tracing MDC
```

Di sini masalah context propagation menjadi lebih terlihat.

---

### 4.3 Java 21: Virtual Threads Final

Java 21 memfinalkan virtual threads. Dokumentasi Oracle menyebut virtual threads sebagai lightweight threads yang dijadwalkan oleh Java runtime dan cocok untuk task yang banyak menunggu I/O, bukan untuk long-running CPU intensive operation.

Virtual threads penting untuk authentication context karena:

- setiap request bisa berjalan di virtual thread baru,
- `ThreadLocal` tetap didukung,
- thread pooling model berubah,
- asumsi lama tentang thread reuse tidak selalu sama,
- tetapi implicit context tetap bisa menjadi desain yang rapuh.

Virtual thread tidak otomatis menyelesaikan masalah context propagation.

Ia mengubah sebagian risiko:

| Sebelum virtual thread | Dengan virtual thread |
|---|---|
| platform thread pool reused antar request | virtual thread sering dibuat per task/request |
| ThreadLocal leak antar request sangat umum jika lupa clear | leak antar virtual thread lebih kecil, tapi tetap ada jika context dipakai salah |
| pool kecil, task banyak queue | virtual thread banyak, butuh desain throughput/resource control |
| async callback complexity tinggi | blocking style bisa kembali sederhana |

Namun tetap ada boundary:

```java
Thread.startVirtualThread(() -> doWork());
```

Thread baru tidak otomatis berarti context domain benar untuk dibawa.

---

### 4.4 Java 25: Scoped Values dan Structured Concurrency

Java 25 semakin relevan karena dokumentasi migrasi JDK 25 menyebut **Scoped Values** sebagai mekanisme untuk berbagi immutable data dengan callees dalam thread dan child threads, lebih mudah dipahami dibanding thread-local variables dan lebih murah terutama bersama virtual threads dan structured concurrency.

Mental model penting:

```text
ThreadLocal = mutable per-thread slot
ScopedValue = immutable value bound to dynamic execution scope
```

Scoped Values cocok untuk data yang:

- immutable,
- berlaku hanya selama dynamic scope tertentu,
- tidak boleh diubah downstream,
- perlu diteruskan ke child subtasks dalam structured concurrency.

Namun untuk security context framework saat ini, adopsi bergantung pada framework. Jangan mengasumsikan semua framework sudah otomatis memakai ScopedValue.

---

## 5. Architecture Pattern

### 5.1 Pattern 1 — Request-Bound Context

Cocok untuk:

- synchronous servlet request,
- controller/service/repository dalam thread yang sama,
- simple authorization check,
- request-scoped audit.

Flow:

```text
HTTP request
  -> authentication filter
  -> build SecurityContext
  -> bind to current thread/request
  -> controller/service reads context
  -> response
  -> clear context
```

Invariant:

```text
SecurityContext tidak boleh hidup melewati akhir request.
```

Failure mode:

- context tidak di-clear,
- thread pool reuse membawa user sebelumnya,
- async task memakai context setelah request selesai.

---

### 5.2 Pattern 2 — Explicit Actor Context

Cocok untuk:

- audit,
- command processing,
- domain service,
- async boundary,
- event-driven flow,
- testable use case.

Contoh:

```java
public record ActorContext(
    String actorType,
    String actorId,
    String tenantId,
    String sessionId,
    String authenticationMethod,
    Instant authenticatedAt,
    String correlationId
) {}
```

Usage:

```java
public void approveCase(ApproveCaseCommand command, ActorContext actor) {
    caseService.approve(command.caseId(), actor);
}
```

Kelebihan:

- actor terlihat di signature,
- domain event bisa membawa actor snapshot,
- audit lebih defensible,
- async aman.

Kekurangan:

- butuh discipline,
- banyak method signature berubah,
- perlu mapping dari framework authentication.

---

### 5.3 Pattern 3 — Context Wrapper Executor

Cocok untuk:

- short async task,
- task masih bagian dari request,
- operasi selesai cepat,
- tidak melewati semantic request boundary.

Flow:

```text
capture SecurityContext at submission time
wrap Runnable/Callable
set context in worker thread
run task
clear/restore previous context
```

Contoh sederhana:

```java
public final class SecurityContextAwareRunnable implements Runnable {
    private final SecurityContext captured;
    private final Runnable delegate;

    public SecurityContextAwareRunnable(SecurityContext captured, Runnable delegate) {
        this.captured = captured;
        this.delegate = delegate;
    }

    @Override
    public void run() {
        SecurityContext previous = SecurityContextHolder.getContext();
        try {
            SecurityContextHolder.setContext(captured);
            delegate.run();
        } finally {
            SecurityContextHolder.setContext(previous);
        }
    }
}
```

Catatan:

- restore previous context lebih aman daripada sekadar clear jika worker thread punya context lain,
- captured context sebaiknya immutable atau defensive-copy,
- jangan pakai untuk long-running background job tanpa model domain yang jelas.

---

### 5.4 Pattern 4 — Delegated Downstream Identity

Cocok untuk:

- service A memanggil service B atas nama user,
- downstream harus tahu end-user,
- authorization dilakukan di downstream,
- audit lintas service penting.

Flow:

```text
User -> Service A -> Service B
```

Pilihan:

1. token relay,
2. token exchange,
3. signed actor context header,
4. service token + user actor claims,
5. no user propagation, only service identity.

Top-level rule:

```text
Jangan relay token hanya karena mudah.
Relay token hanya jika audience, scope, TTL, dan trust model benar.
```

---

### 5.5 Pattern 5 — Initiated-By and Executed-By Split

Cocok untuk:

- background job,
- report generation,
- batch process,
- delayed workflow,
- message retry,
- saga orchestration.

Model:

```text
initiatedBy = human/client that requested the action
executedBy = service/job identity that performs the action
authorizedBy = rule/policy/snapshot used to allow execution
```

Contoh audit:

```json
{
  "action": "GENERATE_REPORT",
  "initiatedBy": {
    "type": "USER",
    "id": "usr_123"
  },
  "executedBy": {
    "type": "SERVICE",
    "id": "report-worker"
  },
  "tenantId": "agency-a",
  "authorizationMode": "SNAPSHOT_AT_SUBMISSION",
  "submittedAt": "2026-06-19T10:00:00Z",
  "executedAt": "2026-06-19T10:05:00Z"
}
```

Ini jauh lebih defensible daripada “worker thread punya SecurityContext user”.

---

## 6. Servlet Authentication Context Propagation

### 6.1 Servlet Request Model

Servlet model tradisional:

```text
one request -> one container thread -> filter chain -> servlet/controller -> response
```

Dalam model ini, thread-bound security context cukup masuk akal.

Contoh:

```java
public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
    try {
        Authentication auth = authenticate(request);
        SecurityContextHolder.getContext().setAuthentication(auth);
        chain.doFilter(request, response);
    } finally {
        SecurityContextHolder.clearContext();
    }
}
```

Framework seperti Spring Security mengelola ini melalui filter chain.

---

### 6.2 Container Principal vs Framework Principal

Dalam Servlet/Jakarta environment, bisa ada beberapa sumber identity:

```java
request.getUserPrincipal();
```

```java
SecurityContextHolder.getContext().getAuthentication();
```

```java
securityContext.getCallerPrincipal(); // Jakarta Security
```

Risiko:

```text
container principal != Spring principal != domain actor
```

Jika aplikasi mencampur container-managed auth, Jakarta Security, dan Spring Security, harus ada mapping rule yang eksplisit.

Checklist:

- siapa source of truth identity?
- apakah container auth masih aktif?
- apakah Spring Security membaca principal dari container?
- apakah domain layer membaca principal dari framework langsung?
- apakah audit memakai stable subject id?

---

### 6.3 Servlet Async

Servlet async memungkinkan request dilepas dari container thread dan dilanjutkan kemudian.

Risiko:

```text
SecurityContext bound to original thread may not exist in async continuation.
```

Rule:

- capture context sebelum async boundary,
- restore hanya selama continuation berjalan,
- clear/restore setelah selesai,
- jangan menyimpan raw mutable context terlalu lama,
- pertimbangkan explicit ActorContext untuk async domain operation.

---

## 7. Spring Security Context Propagation

### 7.1 SecurityContextHolder Strategy

Spring Security memakai `SecurityContextHolder` sebagai abstraction untuk menyimpan context.

Mode historis umum:

```text
MODE_THREADLOCAL
MODE_INHERITABLETHREADLOCAL
MODE_GLOBAL
```

Prinsip:

- `MODE_THREADLOCAL`: default umum untuk request processing.
- `MODE_INHERITABLETHREADLOCAL`: context inherited ke child thread saat thread dibuat.
- `MODE_GLOBAL`: tidak cocok untuk server multi-user.

Jangan memakai global mode di web application multi-user.

---

### 7.2 Why ThreadLocal Works in Servlet

ThreadLocal masuk akal karena:

```text
during request, same thread can access current context without passing parameter everywhere
```

Namun aman hanya jika:

1. context di-set di awal request,
2. context dibaca selama request,
3. context di-clear setelah request,
4. tidak dipakai sembarang di async boundary.

---

### 7.3 Delegating Security Context Wrappers

Spring Security menyediakan konsep `DelegatingSecurityContextRunnable`, `DelegatingSecurityContextCallable`, dan executor wrapper untuk menyalin security context ke task.

Mental model:

```text
capture current SecurityContext at submission or construction time
bind it to worker thread only for duration of task
clear/restore afterward
```

Contoh konseptual:

```java
Runnable secured = new DelegatingSecurityContextRunnable(() -> {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    service.doSomething(auth.getName());
});

new Thread(secured).start();
```

Namun keputusan pentingnya bukan “pakai wrapper atau tidak”, tetapi:

```text
Apakah task ini benar-benar bagian dari request identity yang sama?
```

---

### 7.4 `@Async` and Security Context

`@Async` sering menjadi sumber bug.

Contoh bug:

```java
@Async
public void sendNotification() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    audit(auth.getName()); // auth bisa null
}
```

Solusi teknis:

- use delegating security context async executor,
- pass explicit ActorContext,
- avoid reading SecurityContext in async service,
- separate immediate request auth from background execution identity.

Desain lebih baik:

```java
public void submitNotification(NotificationCommand command) {
    ActorContext actor = actorContextFactory.currentActor();
    notificationExecutor.submit(() -> sendNotification(command, actor));
}

private void sendNotification(NotificationCommand command, ActorContext initiatedBy) {
    auditNotification(command, initiatedBy, SystemActor.NOTIFICATION_SERVICE);
}
```

---

### 7.5 `CompletableFuture`

Bug klasik:

```java
CompletableFuture.supplyAsync(() -> {
    return SecurityContextHolder.getContext().getAuthentication().getName();
});
```

Jika executor tidak diberikan, `CompletableFuture` memakai default async execution facility, seringnya common pool. Context tidak otomatis ikut.

Lebih baik:

```java
ActorContext actor = actorContextFactory.currentActor();

CompletableFuture.supplyAsync(() -> {
    return service.load(actor);
}, applicationExecutor);
```

Atau jika memang harus security context framework:

```java
SecurityContext captured = SecurityContextHolder.getContext();

CompletableFuture.supplyAsync(() -> {
    SecurityContext previous = SecurityContextHolder.getContext();
    try {
        SecurityContextHolder.setContext(captured);
        return service.load();
    } finally {
        SecurityContextHolder.setContext(previous);
    }
}, executor);
```

Tetapi untuk domain logic, explicit actor biasanya lebih sehat.

---

## 8. Reactive Authentication Context Propagation

### 8.1 Mengapa Reactive Berbeda

Dalam servlet imperative, context sering diikat ke thread.

Dalam reactive programming:

```text
execution can hop across threads
thread is not the unit of logical request
```

Karena itu, ThreadLocal bukan abstraction utama untuk security context.

Reactor memiliki `Context`, yaitu key-value store yang terikat pada reactive sequence, bukan thread.

Spring Security reactive menyediakan `ReactiveSecurityContextHolder` untuk menyimpan/membaca `SecurityContext` dari Reactor Context.

---

### 8.2 Salah Mental Model

Buruk:

```java
Mono<UserProfile> profile() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    return userService.load(auth.getName());
}
```

Di WebFlux, ini bisa salah karena authentication context tidak selalu ada di ThreadLocal.

Lebih tepat:

```java
Mono<UserProfile> profile() {
    return ReactiveSecurityContextHolder.getContext()
        .map(SecurityContext::getAuthentication)
        .flatMap(auth -> userService.load(auth.getName()));
}
```

Atau gunakan injection framework yang sesuai:

```java
@GetMapping("/me")
Mono<UserProfile> me(@AuthenticationPrincipal CustomPrincipal principal) {
    return userService.load(principal.id());
}
```

---

### 8.3 Reactor Context Is Not HTTP Session

Reactor Context:

- immutable-like propagation model,
- tied to reactive subscription,
- flows downstream/upstream according to Reactor semantics,
- not a global store,
- not a long-term identity store.

Jangan menyimpan mutable user object besar di Reactor Context.

Simpan minimal authenticated identity view.

---

### 8.4 Reactive Boundary to Imperative Code

Masalah muncul saat reactive code memanggil imperative service yang membaca ThreadLocal.

Contoh buruk:

```java
Mono<Void> approve(String caseId) {
    return ReactiveSecurityContextHolder.getContext()
        .then(Mono.fromRunnable(() -> legacyService.approve(caseId)));
}
```

Jika `legacyService.approve` membaca `SecurityContextHolder`, context bisa tidak ada.

Lebih baik:

```java
Mono<Void> approve(String caseId) {
    return ReactiveSecurityContextHolder.getContext()
        .map(ctx -> ActorContext.from(ctx.getAuthentication()))
        .flatMap(actor -> Mono.fromRunnable(() -> legacyService.approve(caseId, actor)));
}
```

Prinsip:

```text
Jangan biarkan legacy imperative service diam-diam bergantung pada ThreadLocal saat dipanggil dari reactive pipeline.
```

---

## 9. Virtual Threads and Authentication Context

### 9.1 Apa yang Berubah

Virtual threads mengurangi kebutuhan async/reactive untuk banyak workload blocking I/O.

Dampaknya terhadap authentication:

- model imperative menjadi viable lagi untuk high concurrency,
- request-per-thread model bisa kembali sederhana,
- ThreadLocal masih bekerja,
- tetapi context lifecycle tetap harus benar.

Contoh server modern dapat menjalankan request dalam virtual thread:

```text
request -> virtual thread -> controller -> service -> blocking database call -> response
```

Ini bagus untuk readability.

Namun tidak berarti semua context propagation menjadi otomatis aman.

---

### 9.2 ThreadLocal di Virtual Threads

Virtual threads mendukung ThreadLocal.

Tetapi ada beberapa pertimbangan:

1. Jangan menyimpan object besar di ThreadLocal.
2. Jangan memakai ThreadLocal sebagai cache mahal per thread.
3. Jangan mengandalkan thread identity sebagai domain identity.
4. Jangan membawa mutable context ke child task tanpa desain.
5. Clear tetap penting jika framework lifecycle tidak mengelola.

Karena jumlah virtual thread bisa sangat besar, penggunaan ThreadLocal yang berat bisa berdampak pada memory.

Security context biasanya kecil, tetapi custom context sering membengkak.

Buruk:

```java
ThreadLocal<UserProfileWithPermissionsAndPreferencesAndMenuAndTenantConfig> CURRENT_USER;
```

Lebih baik:

```java
ThreadLocal<AuthenticatedActor> CURRENT_ACTOR;
```

---

### 9.3 Virtual Thread Does Not Mean Background Job Context Is Safe

Contoh:

```java
Thread.startVirtualThread(() -> generateReport());
```

Jika `generateReport()` membaca SecurityContextHolder, pertanyaannya:

- apakah context ikut?
- apakah context valid?
- apakah report generation masih bagian dari request?
- apakah response sudah dikirim?
- apakah user logout?
- apakah authorization harus direvalidasi?

Virtual thread membuat spawning murah, tetapi **tidak mengubah boundary semantik**.

---

### 9.4 ScopedValue as Future-Friendly Context Carrier

Scoped Values di Java 25 dapat menjadi model yang lebih aman untuk context immutable.

Contoh konseptual:

```java
static final ScopedValue<ActorContext> ACTOR = ScopedValue.newInstance();

void handle(Request request) {
    ActorContext actor = authenticate(request);

    ScopedValue.where(ACTOR, actor).run(() -> {
        service.process();
    });
}

void process() {
    ActorContext actor = ACTOR.get();
    // use actor
}
```

Kelebihan mental model:

- actor immutable,
- actor bound ke dynamic scope,
- otomatis tidak tersedia setelah scope selesai,
- lebih mudah dipikirkan daripada mutable ThreadLocal.

Namun caveat:

- Java 25 adoption belum universal,
- framework integration berbeda-beda,
- existing Spring Security/Jakarta Security ecosystem masih banyak ThreadLocal/request-context based,
- jangan membuat custom security framework premature hanya karena API baru.

---

## 10. Structured Concurrency and Authentication

Structured concurrency memperlakukan beberapa subtask sebagai satu unit kerja.

Contoh use case:

```text
GET /dashboard
  -> load profile
  -> load cases
  -> load notifications
  -> load permissions
```

Dengan structured concurrency:

```text
parent request scope
  -> child task A
  -> child task B
  -> child task C
all children finish/cancel before parent continues
```

Authentication context implication:

- semua child task bisa memakai actor yang sama,
- child task tidak boleh outlive request scope,
- cancellation lebih jelas,
- failure handling lebih centralized,
- audit lebih mudah.

Pattern:

```text
capture immutable ActorContext once
bind to structured scope
fork child tasks
join
return response
scope ends
actor no longer accessible
```

Ini lebih sehat daripada unstructured async fire-and-forget.

---

## 11. Security Context vs Logging MDC vs Tracing Context

Authentication context sering tercampur dengan logging MDC dan distributed tracing.

Bedakan:

| Context | Isi | Tujuan |
|---|---|---|
| Security context | authenticated identity | authn/authz decision |
| Actor context | domain actor snapshot | audit/domain action |
| MDC | log enrichment | observability |
| Trace context | trace/span id | distributed tracing |
| Request context | request metadata | request processing |

Jangan menjadikan MDC sebagai source of truth identity.

Buruk:

```java
String userId = MDC.get("userId");
approveCase(userId, caseId);
```

MDC boleh mengandung user id untuk log, tetapi authorization dan domain decision harus memakai trusted actor/security context.

---

## 12. Process Boundary: Calling Downstream Services

Authentication context di memory tidak melewati process boundary.

Jika service A memanggil service B, perlu bentuk representasi baru:

| Strategy | Makna |
|---|---|
| token relay | service A meneruskan access token user |
| token exchange | service A menukar token user menjadi token audience B |
| service token | service A memakai identity sendiri |
| signed actor header | service A mengirim actor snapshot yang ditandatangani/dipercaya |
| message metadata | actor snapshot masuk event/message |

Pertanyaan desain:

1. Apakah B perlu authorize end-user?
2. Apakah token user audience-nya valid untuk B?
3. Apakah B boleh mempercayai header dari A?
4. Apakah gateway/service mesh sudah authenticate A?
5. Apakah user identity harus masuk audit B?
6. Apakah call dilakukan synchronously atas request user?
7. Apakah call bisa retry setelah token expired?

Rule:

```text
In-memory context propagation stops at process boundary.
After that, use protocol-level identity propagation.
```

---

## 13. Time Boundary: Delayed Execution

Time boundary lebih berbahaya daripada thread boundary.

Contoh:

```text
User submits action at 10:00.
Job runs at 10:30.
```

Jangan menyimpan raw session/token untuk dipakai nanti kecuali memang flow-nya dirancang untuk itu.

Alternatif:

1. actor snapshot untuk audit,
2. authorization snapshot,
3. reauthorization saat execution,
4. service identity execution,
5. workflow token dengan scope terbatas,
6. outbox event dengan immutable metadata.

Decision matrix:

| Requirement | Pattern |
|---|---|
| harus memakai permission saat submit | authorization snapshot |
| harus mengikuti permission terbaru | reauthorize at execution |
| harus tetap jalan walau user logout | service identity + initiatedBy |
| harus batal jika user disabled | check actor status at execution |
| harus audit siapa yang memicu | initiatedBy snapshot |

---

## 14. Tenant Boundary

Authentication context harus tenant-aware.

Minimal actor context di multi-tenant system:

```java
public record ActorContext(
    String subjectId,
    String tenantId,
    String issuer,
    String clientId,
    Set<String> authorities
) {}
```

Failure mode serius:

```text
ThreadLocal tenantId dari request sebelumnya terbawa ke request berikutnya.
```

Akibat:

- data leak antar tenant,
- audit salah tenant,
- permission check salah,
- cache key salah,
- query filter salah.

Rule:

```text
Tenant context dan authentication context harus dipropagasikan dan di-clear bersama.
```

Jangan punya dua lifecycle berbeda:

```text
SecurityContext cleared, TenantContext not cleared.
```

Atau sebaliknya.

---

## 15. Privilege Boundary and Impersonation

Admin impersonation adalah kasus context propagation yang sering salah.

Buruk:

```text
currentUser = targetUser
```

Jika admin A impersonate user B, context tidak boleh hanya menjadi B.

Harus ada actor chain:

```json
{
  "effectiveActor": {
    "type": "USER",
    "id": "user-b"
  },
  "initiatingActor": {
    "type": "ADMIN",
    "id": "admin-a"
  },
  "mode": "IMPERSONATION",
  "reason": "support-ticket-123",
  "startedAt": "2026-06-19T10:00:00Z"
}
```

Authorization check harus tahu apakah sedang impersonation.

Beberapa aksi harus dilarang saat impersonation:

- change password,
- update MFA,
- approve financial transaction,
- export sensitive data,
- create admin user.

Propagation rule:

```text
Never flatten impersonation context into a normal user context.
```

---

## 16. Implementation Pattern: ActorContext

Framework security context bagus di edge, tetapi domain sering butuh abstraction sendiri.

Contoh production-oriented:

```java
public enum ActorType {
    USER,
    SERVICE,
    JOB,
    SYSTEM,
    CLIENT,
    ANONYMOUS
}
```

```java
public record ActorContext(
    ActorType actorType,
    String actorId,
    String tenantId,
    String issuer,
    String clientId,
    String sessionId,
    String tokenId,
    String authenticationMethod,
    Instant authenticatedAt,
    Instant capturedAt,
    Set<String> authorities,
    ActorContext delegatedBy,
    String correlationId
) {
    public boolean isHumanUser() {
        return actorType == ActorType.USER;
    }

    public boolean isService() {
        return actorType == ActorType.SERVICE || actorType == ActorType.JOB || actorType == ActorType.SYSTEM;
    }
}
```

Important:

- immutable,
- minimal,
- no raw password,
- no access token unless absolutely necessary,
- no huge profile object,
- no lazy-loaded entity,
- serializable only if intentionally designed,
- clear actor type.

---

## 17. Implementation Pattern: ActorContextFactory

```java
public interface ActorContextFactory {
    ActorContext currentActor();
}
```

Spring implementation:

```java
public final class SpringSecurityActorContextFactory implements ActorContextFactory {

    @Override
    public ActorContext currentActor() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        if (authentication == null || !authentication.isAuthenticated()) {
            return anonymousActor();
        }

        return map(authentication);
    }

    private ActorContext map(Authentication authentication) {
        CustomPrincipal principal = (CustomPrincipal) authentication.getPrincipal();

        return new ActorContext(
            ActorType.USER,
            principal.userId(),
            principal.tenantId(),
            principal.issuer(),
            principal.clientId(),
            principal.sessionId(),
            principal.tokenId(),
            principal.authenticationMethod(),
            principal.authenticatedAt(),
            Instant.now(),
            Set.copyOf(authentication.getAuthorities()
                .stream()
                .map(GrantedAuthority::getAuthority)
                .toList()),
            null,
            MDC.get("correlationId")
        );
    }
}
```

Note:

- mapping dilakukan di boundary,
- domain tidak perlu tahu Spring Security,
- test bisa membuat ActorContext langsung.

---

## 18. Implementation Pattern: Domain Command with Actor

Buruk:

```java
public void approve(String caseId) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    approvalService.approve(caseId, auth.getName());
}
```

Lebih baik:

```java
public record ApproveCaseCommand(
    String caseId,
    String decision,
    String comment
) {}
```

```java
public void approve(ApproveCaseCommand command, ActorContext actor) {
    authorizationPolicy.ensureCanApprove(actor, command.caseId());
    caseRepository.approve(command.caseId(), actor.actorId(), command.comment());
    audit.log("CASE_APPROVED", actor, command.caseId());
}
```

Controller:

```java
@PostMapping("/cases/{caseId}/approve")
public ResponseEntity<Void> approve(@PathVariable String caseId, @RequestBody ApproveRequest request) {
    ActorContext actor = actorContextFactory.currentActor();
    service.approve(new ApproveCaseCommand(caseId, request.decision(), request.comment()), actor);
    return ResponseEntity.noContent().build();
}
```

Kelebihan:

- actor explicit,
- authorization explicit,
- audit explicit,
- async migration lebih mudah,
- domain tidak tergantung ThreadLocal.

---

## 19. Implementation Pattern: Context Snapshot for Events

Event tidak boleh membawa raw framework `Authentication`.

Buruk:

```java
public record CaseApprovedEvent(String caseId, Authentication authentication) {}
```

Lebih baik:

```java
public record CaseApprovedEvent(
    String eventId,
    String caseId,
    ActorSnapshot actor,
    Instant occurredAt
) {}
```

```java
public record ActorSnapshot(
    String actorType,
    String actorId,
    String tenantId,
    String delegatedByActorId,
    String correlationId
) {}
```

ActorSnapshot adalah historical fact.

Jangan gunakan event actor snapshot untuk live authorization kecuali memang desainnya snapshot-based.

---

## 20. Implementation Pattern: Safe Executor Wrapper

Contoh generic context propagation untuk ActorContext, bukan framework context:

```java
public final class ActorContextHolder {
    private static final ThreadLocal<ActorContext> CURRENT = new ThreadLocal<>();

    public static ActorContext get() {
        return CURRENT.get();
    }

    public static void set(ActorContext actor) {
        CURRENT.set(actor);
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static Scope bind(ActorContext actor) {
        ActorContext previous = CURRENT.get();
        CURRENT.set(actor);
        return () -> {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        };
    }

    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
```

Usage:

```java
ActorContext actor = actorContextFactory.currentActor();

executor.submit(() -> {
    try (ActorContextHolder.Scope ignored = ActorContextHolder.bind(actor)) {
        service.process();
    }
});
```

Caveat:

- ini tetap implicit,
- gunakan hanya untuk infrastructure boundary,
- domain service tetap lebih baik menerima ActorContext explicit.

---

## 21. Failure Modes

### 21.1 Missing Context

Gejala:

```text
Authentication is null
anonymous user in async task
audit actor unknown
authorization denied unexpectedly
```

Penyebab:

- async boundary tidak propagate,
- reactive pipeline memakai ThreadLocal,
- task berjalan setelah request context cleared,
- executor common pool,
- test tidak setup security context.

Mitigasi:

- explicit ActorContext,
- delegating executor,
- reactive context access,
- fail fast jika actor required,
- test async path.

---

### 21.2 Stale Context

Gejala:

```text
user masih bisa melakukan aksi setelah role dicabut
background job memakai permission lama
revoked session masih dipakai
```

Penyebab:

- context snapshot dipakai terlalu lama,
- tidak ada revalidation,
- token TTL terlalu panjang,
- job memakai user context dari submission time tanpa policy.

Mitigasi:

- define snapshot vs live authorization,
- short TTL,
- revalidate for sensitive action,
- store authorization mode in audit.

---

### 21.3 Leaked Context

Gejala:

```text
request user B terlihat sebagai user A
tenant A mengakses data tenant B
log mencatat actor salah
```

Penyebab:

- ThreadLocal not cleared,
- MDC not cleared,
- TenantContext not cleared,
- pooled thread reuse,
- exception path skip cleanup.

Mitigasi:

- always cleanup in finally,
- use try-with-resources scope,
- test same-thread reused scenario,
- centralize context filters.

---

### 21.4 Over-Propagated Context

Gejala:

```text
scheduled job berjalan sebagai user terakhir
retry message memakai old user context
email worker punya full authorities user
```

Penyebab:

- copy SecurityContext blindly,
- no boundary semantics,
- fire-and-forget async treated as request continuation.

Mitigasi:

- split initiatedBy/executedBy,
- context minimization,
- service identity for workers,
- explicit actor snapshot.

---

### 21.5 Mutated Context

Gejala:

```text
authorities berubah di tengah request
audit berbeda dengan authorization decision
child task modifies parent context
```

Penyebab:

- mutable principal object,
- shared SecurityContext instance,
- mutable authorities list,
- context reused across tasks.

Mitigasi:

- immutable actor snapshot,
- defensive copy,
- avoid modifying Authentication after established,
- create new context for privilege transition.

---

## 22. Security Risks

### 22.1 Confused Deputy

Service menerima user context dan melakukan aksi yang user tidak boleh lakukan karena service punya privilege lebih tinggi.

Mitigasi:

```text
separate caller identity from executor capability
check audience/scope/action explicitly
```

---

### 22.2 Tenant Confusion

Tenant context tidak sinkron dengan auth context.

Mitigasi:

```text
tenantId must come from trusted authentication claim or resolved binding
never from arbitrary request parameter alone
```

---

### 22.3 Privilege Escalation via Async

User melakukan aksi low-risk yang trigger async high-privilege operation memakai context yang terlalu kuat.

Mitigasi:

```text
async operation must have its own policy and service identity
```

---

### 22.4 Audit Forgery via Header Propagation

Service B mempercayai `X-User-Id` dari client langsung.

Mitigasi:

```text
only trusted gateway/service may inject actor headers
internal headers must be stripped at edge
prefer signed claims or token-based propagation
```

---

### 22.5 Context Reuse After Logout

Background operation memakai context user setelah logout.

Mitigasi:

```text
logout invalidates session, not necessarily submitted jobs
job policy must define behavior explicitly
```

---

## 23. Production Checklist

### 23.1 Request Context

- [ ] Security context set once at authentication boundary.
- [ ] Security context cleared in finally/filter lifecycle.
- [ ] Tenant context cleared with security context.
- [ ] MDC cleared with request lifecycle.
- [ ] Domain does not rely blindly on framework ThreadLocal.

### 23.2 Async Context

- [ ] Every async boundary classified: continuation, background, delayed, retry, scheduled.
- [ ] Short continuation uses safe propagation wrapper if needed.
- [ ] Background job uses initiatedBy/executedBy split.
- [ ] Long-running jobs do not keep raw session/token.
- [ ] Authorization snapshot/revalidation policy documented.

### 23.3 Reactive Context

- [ ] WebFlux uses Reactor Context / `ReactiveSecurityContextHolder`.
- [ ] Imperative services do not read ThreadLocal when called from reactive chain.
- [ ] ActorContext mapped explicitly at boundary.
- [ ] Blocking calls are isolated appropriately.

### 23.4 Virtual Threads

- [ ] ThreadLocal values are small and cleared.
- [ ] No large per-thread cache in virtual threads.
- [ ] Virtual thread spawning not treated as authorization propagation.
- [ ] Structured concurrency considered for bounded request subtasks.
- [ ] Scoped Values considered for immutable context in Java 25-aware code.

### 23.5 Downstream Calls

- [ ] Token relay only when audience/scope valid.
- [ ] Token exchange preferred for downstream-specific audience.
- [ ] Service identity separated from end-user identity.
- [ ] Actor chain preserved for impersonation/delegation.
- [ ] Edge strips untrusted identity headers.

### 23.6 Audit

- [ ] Audit records stable actor id.
- [ ] Audit records tenant id.
- [ ] Audit distinguishes initiatedBy and executedBy.
- [ ] Audit records authentication method if relevant.
- [ ] Audit records correlation/trace id.
- [ ] Audit can explain snapshot vs live authorization decision.

---

## 24. Common Mistakes

### Mistake 1 — Reading SecurityContext Everywhere

```java
SecurityContextHolder.getContext().getAuthentication()
```

dipakai di repository, domain entity, mapper, event listener, scheduler.

Masalah:

- hidden dependency,
- sulit dites,
- async unsafe,
- reactive unsafe,
- context ambiguity.

Solusi:

```text
read framework context at boundary, map to ActorContext, pass explicitly to domain use case.
```

---

### Mistake 2 — Copying SecurityContext to Background Job

Masalah:

- context terlalu besar,
- session/token mungkin expired,
- role mungkin berubah,
- audit misleading,
- job outlives request.

Solusi:

```text
initiatedBy + executedBy + authorization policy.
```

---

### Mistake 3 — Using InheritableThreadLocal with Thread Pools

`InheritableThreadLocal` mewariskan nilai saat thread dibuat, bukan setiap task dikirim.

Di thread pool, thread sudah dibuat lama sebelum request.

Akibat:

- context tidak ikut,
- atau context lama salah terbawa.

Solusi:

- explicit propagation wrapper,
- avoid inheritable mode for pooled web workloads unless deeply understood.

---

### Mistake 4 — Trusting User ID Header

Buruk:

```text
X-User-Id: 123
```

Jika header datang dari internet, itu bukan authentication.

Solusi:

- authenticate at edge,
- strip inbound identity headers,
- inject trusted headers only after authentication,
- sign/verify internal actor claims,
- use mTLS/service identity.

---

### Mistake 5 — Mixing Authentication and Logging Context

MDC boleh dipakai untuk log enrichment, bukan source of truth.

Solusi:

- SecurityContext/ActorContext untuk decision,
- MDC untuk observability,
- sync them at boundary only.

---

### Mistake 6 — Not Modeling System Actors

Banyak sistem hanya mengenal “user”.

Lalu scheduler, migration, retry, consumer, dan integration job dipaksa memakai fake user.

Solusi:

```text
ActorType = USER | SERVICE | JOB | SYSTEM | CLIENT
```

Audit jauh lebih jujur.

---

## 25. Design Questions

Gunakan pertanyaan berikut saat review architecture.

### 25.1 Scope

1. Identity ini valid sampai kapan?
2. Identity ini valid di thread/task mana?
3. Identity ini boleh hidup setelah HTTP response selesai?
4. Identity ini request-scoped, session-scoped, token-scoped, atau job-scoped?

### 25.2 Boundary

1. Apakah ada executor boundary?
2. Apakah ada reactive boundary?
3. Apakah ada process boundary?
4. Apakah ada queue/message boundary?
5. Apakah ada time boundary?
6. Apakah ada tenant boundary?
7. Apakah ada privilege boundary?

### 25.3 Propagation Decision

1. Apakah context harus dibawa penuh?
2. Apakah cukup actor snapshot?
3. Apakah harus service identity?
4. Apakah harus token exchange?
5. Apakah harus reauthorize?
6. Apakah context harus diputus?

### 25.4 Failure Handling

1. Apa yang terjadi jika context hilang?
2. Apa yang terjadi jika context expired?
3. Apa yang terjadi jika user disabled?
4. Apa yang terjadi jika role berubah?
5. Apa yang terjadi jika tenant disabled?
6. Apa yang terjadi jika downstream menolak token?

### 25.5 Audit

1. Siapa yang memulai aksi?
2. Siapa yang menjalankan aksi?
3. Dengan authentication method apa?
4. Dengan tenant apa?
5. Dengan authorization decision apa?
6. Apakah audit bisa menjelaskan delegation/impersonation?

---

## 26. Reference Decision Matrix

| Scenario | Recommended Context Strategy |
|---|---|
| synchronous servlet request | framework SecurityContext + boundary ActorContext |
| Spring MVC service call | current request SecurityContext ok, domain ActorContext better |
| `@Async` notification | explicit ActorContext snapshot |
| `CompletableFuture` short subtask | explicit ActorContext or delegating executor |
| WebFlux endpoint | ReactiveSecurityContextHolder/Reactor Context |
| reactive to imperative legacy call | map to ActorContext before call |
| virtual-thread-per-request | request-bound context okay, still clear/minimize |
| structured child tasks | immutable ActorContext shared in structured scope |
| scheduled job | system/job actor |
| user-submitted background job | initiatedBy user + executedBy service |
| message consumer | producer/service identity + message actor metadata |
| service-to-service call | service identity + token exchange if acting for user |
| admin impersonation | actor chain, never flatten |
| audit event | actor snapshot, not raw SecurityContext |

---

## 27. Minimal Example: End-to-End Safe Flow

Scenario:

```text
User approves case.
System updates case synchronously.
System sends async notification.
System emits event.
Notification worker runs after response.
```

### 27.1 Controller

```java
@PostMapping("/cases/{caseId}/approve")
public ResponseEntity<Void> approve(
    @PathVariable String caseId,
    @RequestBody ApproveCaseRequest request
) {
    ActorContext actor = actorContextFactory.currentActor();

    approveCaseUseCase.approve(
        new ApproveCaseCommand(caseId, request.comment()),
        actor
    );

    return ResponseEntity.noContent().build();
}
```

### 27.2 Use Case

```java
public void approve(ApproveCaseCommand command, ActorContext actor) {
    authorizationPolicy.ensureCanApprove(actor, command.caseId());

    caseRepository.markApproved(command.caseId(), actor.actorId(), Instant.now());

    auditLog.record(AuditEvent.caseApproved(command.caseId(), actor));

    outbox.save(new CaseApprovedEvent(
        UUID.randomUUID().toString(),
        command.caseId(),
        ActorSnapshot.from(actor),
        Instant.now()
    ));
}
```

### 27.3 Worker

```java
public void process(CaseApprovedEvent event) {
    ActorContext executedBy = ActorContext.service("notification-worker", event.actor().tenantId());

    notificationService.sendCaseApprovedNotification(
        event.caseId(),
        event.actor(),       // initiatedBy snapshot
        executedBy           // executedBy service
    );
}
```

Audit result:

```text
Case approved by user usr_123.
Notification sent by service notification-worker because usr_123 initiated approval.
```

This is defensible.

---

## 28. Testing Strategy

### 28.1 Test Missing Context

```java
@Test
void asyncTaskShouldNotDependOnThreadLocalSecurityContext() {
    ActorContext actor = testActor("usr_123", "tenant-a");

    service.submitWork(command, actor);

    SecurityContextHolder.clearContext();

    worker.runNext();

    assertThat(audit.last().initiatedBy()).isEqualTo("usr_123");
    assertThat(audit.last().executedBy()).isEqualTo("worker-service");
}
```

---

### 28.2 Test Context Cleanup

```java
@Test
void contextMustNotLeakBetweenTasksOnSameThread() {
    ExecutorService executor = Executors.newSingleThreadExecutor();

    runAs(executor, actor("user-a"), () -> service.readCurrentActor());
    String second = runWithoutActor(executor, () -> service.readCurrentActorOrAnonymous());

    assertThat(second).isEqualTo("anonymous");
}
```

---

### 28.3 Test Tenant Leakage

```java
@Test
void tenantContextMustBeClearedWithSecurityContext() {
    handleRequest(user("usr-a", "tenant-a"));
    handleRequest(user("usr-b", "tenant-b"));

    assertThat(repository.lastTenantFilter()).isEqualTo("tenant-b");
}
```

---

### 28.4 Test Impersonation Chain

```java
@Test
void impersonationMustPreserveInitiatingAdmin() {
    ActorContext admin = actor("admin-a");
    ActorContext effective = impersonate(admin, actor("user-b"));

    service.performSupportAction(command, effective);

    assertThat(audit.last().effectiveActor()).isEqualTo("user-b");
    assertThat(audit.last().initiatingActor()).isEqualTo("admin-a");
}
```

---

## 29. Practical Heuristics

### Heuristic 1

```text
Inside request: framework context is acceptable.
Across boundary: explicit actor is safer.
Across time: never raw security context.
Across process: protocol-level identity.
```

### Heuristic 2

```text
If operation can run after response is returned, it is no longer the same authentication scope.
```

### Heuristic 3

```text
If audit matters, store actor snapshot.
If authorization matters, revalidate or document snapshot policy.
```

### Heuristic 4

```text
ThreadLocal is an implementation detail, not an architecture model.
```

### Heuristic 5

```text
A system actor is better than a fake user.
```

### Heuristic 6

```text
Do not propagate more identity than the next boundary needs.
```

### Heuristic 7

```text
When in doubt, split initiatedBy and executedBy.
```

---

## 30. Summary

Authentication context propagation adalah salah satu area yang membedakan engineer biasa dari engineer senior/top-tier.

Engineer biasa biasanya berpikir:

```text
Bagaimana cara membaca current user di mana saja?
```

Engineer kuat berpikir:

```text
Identity ini valid di scope apa, boleh melewati boundary mana, dan bagaimana failure/audit-nya?
```

Inti Part 8:

1. Authentication context punya scope.
2. Thread bukan selalu logical request.
3. ThreadLocal berguna, tapi bukan model arsitektur.
4. Servlet synchronous relatif aman jika lifecycle clear benar.
5. Async boundary harus explicit.
6. Reactive boundary memakai Reactor Context, bukan ThreadLocal biasa.
7. Virtual threads membuat imperative concurrency lebih scalable, tetapi tidak menghapus kebutuhan boundary modeling.
8. Scoped Values memberi arah lebih baik untuk immutable scoped context di Java 25, tetapi framework adoption tetap harus diperhatikan.
9. Background job harus memisahkan `initiatedBy` dan `executedBy`.
10. Audit harus menyimpan actor snapshot yang defensible.
11. Tenant, impersonation, delegation, dan service identity harus dimodelkan eksplisit.
12. Jangan copy `SecurityContext` secara membabi buta.

Jika satu kalimat harus diingat:

> Authentication context propagation bukan tentang membawa “current user” ke semua tempat, tetapi tentang menjaga agar identity yang tepat tersedia hanya di scope yang tepat, dengan bukti, lifecycle, dan audit yang benar.

---

## 31. Referensi Resmi dan Bacaan Lanjutan

Referensi utama yang relevan untuk part ini:

1. Spring Security Reference — Servlet Authentication Architecture  
   `https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html`

2. Spring Security API — `ReactiveSecurityContextHolder`  
   `https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/core/context/ReactiveSecurityContextHolder.html`

3. Spring Security Reference — WebFlux Security  
   `https://docs.spring.io/spring-security/reference/reactive/configuration/webflux.html`

4. Project Reactor Reference — Context  
   `https://projectreactor.io/docs/core/release/reference/advancedFeatures/context.html`

5. Oracle Java 25 Documentation — Virtual Threads  
   `https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html`

6. Oracle Java 25 Documentation — Structured Concurrency  
   `https://docs.oracle.com/en/java/javase/25/core/structured-concurrency.html`

7. Oracle Java SE 25 API — `ScopedValue`  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html`

8. Oracle JDK 25 Migration Guide — Significant Changes in JDK 25  
   `https://docs.oracle.com/en/java/javase/25/migrate/significant-changes-jdk-25.html`

9. OpenJDK JEP 444 — Virtual Threads  
   `https://openjdk.org/jeps/444`

10. OpenJDK JEP 505 — Structured Concurrency  
   `https://openjdk.org/jeps/505`

---

## 32. Status Series

Part yang sudah selesai:

- Part 0 — Orientation: Mental Model of Authentication in Java Systems
- Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
- Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
- Part 3 — Password Authentication Done Properly
- Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
- Part 5 — Servlet Container Authentication
- Part 6 — Jakarta Security and Jakarta Authentication Deep Dive
- Part 7 — Spring Security Authentication Architecture
- Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads

Series belum selesai.

Part berikutnya:

> **Part 9 — API Key Authentication**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-007.md">⬅️ Part 7 — Spring Security Authentication Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-009.md">Part 9 — API Key Authentication ➡️</a>
</div>
