# Part 12 — Structured Concurrency and Scoped Values for Enterprise Java

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `12-structured-concurrency-scoped-values-enterprise-java.md`  
**Target reader:** Java/Jakarta engineer yang sudah paham Java concurrency dasar, Jakarta EE, CDI, transaction, security, async boundary, dan ingin naik ke level desain runtime/workload orchestration yang lebih matang.  
**Scope versi:** Java 8–25, Jakarta EE 8–11, Jakarta Concurrency 3.x.  
**Baseline stabil:** Jakarta EE 11 + Jakarta Concurrency 3.1 + Java 21+.  
**Catatan status fitur:** Structured Concurrency masih preview pada Java 25. Scoped Values ditargetkan/tersedia sebagai fitur final pada Java 25 berdasarkan JEP 506. Karena itu, pemakaian Structured Concurrency dalam production enterprise harus diperlakukan sebagai desain konseptual/future-facing kecuali organisasi memang menerima preview feature.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami **Structured Concurrency** bukan sebagai API tambahan biasa, tetapi sebagai perubahan mental model: dari “task-task liar yang berjalan paralel” menjadi “tree of work” yang lifetime-nya jelas.
2. Memahami kenapa `Future`, `CompletableFuture`, dan executor tradisional sering menghasilkan concurrency yang sulit diamati, sulit dibatalkan, dan sulit dipulihkan.
3. Memahami hubungan antara:
   - virtual threads,
   - structured concurrency,
   - scoped values,
   - `ThreadLocal`,
   - Jakarta managed concurrency,
   - context propagation.
4. Bisa membedakan **context sebagai data immutable yang scoped** vs **context sebagai mutable ambient state**.
5. Bisa mendesain fan-out/fan-in enterprise workload dengan invariant yang jelas:
   - semua child task selesai sebelum parent selesai,
   - failure satu child dapat membatalkan sibling yang tidak lagi relevan,
   - cancellation menjadi bagian dari struktur,
   - context punya lifetime yang tidak bocor.
6. Bisa menilai kapan Structured Concurrency cocok, kapan belum cocok, dan kapan harus tetap memakai Jakarta `ManagedExecutorService`, Jakarta Batch, messaging, atau workflow engine.
7. Bisa membaca arah evolusi Java 21–25 tanpa salah menyimpulkan bahwa fitur Java SE otomatis portable di semua Jakarta EE container.

---

## 2. Problem yang Diselesaikan

Concurrency tradisional sering memberi kita primitive yang kuat, tetapi tidak otomatis memberi struktur.

Contoh umum:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);

Future<Customer> customerFuture = executor.submit(() -> loadCustomer(id));
Future<List<Order>> ordersFuture = executor.submit(() -> loadOrders(id));
Future<RiskScore> riskFuture = executor.submit(() -> calculateRisk(id));

Customer customer = customerFuture.get();
List<Order> orders = ordersFuture.get();
RiskScore risk = riskFuture.get();

return new CustomerProfile(customer, orders, risk);
```

Secara sekilas ini masuk akal. Tapi di production, banyak pertanyaan tersembunyi:

- Kalau `loadCustomer` gagal, apakah `loadOrders` dan `calculateRisk` harus tetap jalan?
- Kalau request timeout, siapa yang membatalkan child task?
- Kalau satu task hang, apakah parent akan hang selamanya?
- Kalau parent method sudah return/throw, apakah child task masih hidup?
- Kalau ada correlation ID, tenant ID, security identity, atau audit actor, bagaimana child task mendapatkannya?
- Kalau child task memakai `ThreadLocal`, apakah aman di virtual threads?
- Kalau task berjalan di Jakarta EE container, apakah executor itu managed?
- Kalau container redeploy/shutdown, siapa yang bertanggung jawab atas task?
- Kalau ada error dari beberapa task sekaligus, bagaimana error itu digabungkan?
- Bagaimana tracing menunjukkan bahwa task-task itu bagian dari satu operation?

Masalah intinya bukan sekadar “bagaimana menjalankan banyak task secara paralel”. Masalah sebenarnya adalah:

> Bagaimana membuat concurrency punya bentuk, lifetime, ownership, cancellation, failure propagation, dan context boundary yang eksplisit?

Structured Concurrency dan Scoped Values menjawab sebagian besar masalah ini di level Java SE modern. Namun dalam Jakarta EE, kita tetap harus menempatkannya di bawah constraint container-managed lifecycle.

---

## 3. Mental Model Utama

### 3.1 Unstructured Concurrency: Task Menjadi Yatim

Unstructured concurrency terjadi ketika parent membuat task, tetapi lifetime task tidak lagi jelas terikat ke parent.

```java
void handleRequest() {
    executor.submit(() -> doSomethingSlow());
    return;
}
```

Apa yang salah?

Bukan selalu salah secara teknis. Tetapi secara struktur:

- parent selesai lebih dulu,
- child task tetap berjalan,
- caller tidak tahu task berhasil/gagal,
- cancellation dari parent tidak otomatis memengaruhi child,
- observability pecah,
- context bisa bocor,
- redeploy bisa meninggalkan task hidup jika executor tidak managed.

Ini seperti membuat proses anak tanpa menunggu, tanpa pid tracking, tanpa cancellation policy, tanpa log correlation, dan tanpa owner.

Dalam sistem kecil, ini terlihat “praktis”. Dalam enterprise runtime, ini adalah sumber bug yang paling mahal.

---

### 3.2 Structured Concurrency: Work Membentuk Tree

Structured Concurrency memperlakukan sekelompok task paralel sebagai **satu unit kerja**.

Mental modelnya:

```text
Parent Operation
├── Child Task A
├── Child Task B
└── Child Task C
```

Invariant penting:

1. Parent tidak dianggap selesai sampai child yang relevan selesai atau dibatalkan.
2. Jika parent gagal/cancelled, child harus ikut dibatalkan.
3. Jika child gagal dan hasil keseluruhan tidak mungkin valid, sibling bisa dibatalkan.
4. Semua task punya owner yang jelas.
5. Observability dapat menunjukkan struktur parent-child.

Dengan kata lain:

> Structured Concurrency membuat concurrency mengikuti struktur lexical/block seperti resource management dengan `try-with-resources`.

Analogi:

```java
try (Resource r = open()) {
    use(r);
}
// resource pasti ditutup di sini
```

Structured Concurrency mencoba memberi jaminan serupa:

```java
try (var scope = openTaskScope()) {
    var a = scope.fork(...);
    var b = scope.fork(...);
    scope.join();
    return combine(a, b);
}
// task dalam scope tidak boleh bocor melewati scope ini
```

---

### 3.3 Scoped Values: Context Bukan Global Mutable State

Banyak enterprise code memakai `ThreadLocal` untuk menyimpan context:

- correlation ID,
- tenant ID,
- request ID,
- user ID,
- locale,
- trace span,
- security metadata,
- audit actor.

Contoh:

```java
public final class RequestContextHolder {
    private static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();

    public static void set(RequestContext ctx) {
        CTX.set(ctx);
    }

    public static RequestContext get() {
        return CTX.get();
    }

    public static void clear() {
        CTX.remove();
    }
}
```

Masalah `ThreadLocal`:

- lifetime tidak eksplisit,
- mudah lupa `remove`,
- mutable,
- rawan leak di thread pool,
- propagation manual antar thread,
- semakin bermasalah jika jutaan virtual thread dibuat,
- context bisa hidup lebih lama dari request sebenarnya.

Scoped Values memberi model berbeda:

- nilai bersifat immutable atau diperlakukan immutable,
- binding berlaku hanya dalam lexical scope tertentu,
- dapat diwariskan ke child thread dalam structured concurrency,
- lebih mudah dipahami lifetime-nya,
- lebih cocok dengan virtual threads.

Mental model:

```text
Within this block, value X is bound.
Outside this block, value X no longer exists.
Child tasks created structurally inside the block may see X.
```

Ini bukan sekadar “ThreadLocal versi baru”. Ini adalah perubahan dari **ambient mutable context** menjadi **lexically scoped immutable context**.

---

## 4. Kenapa Ini Relevan untuk Jakarta EE?

Jakarta EE sudah punya managed concurrency:

- `ManagedExecutorService`
- `ManagedScheduledExecutorService`
- `ManagedThreadFactory`
- `ContextService`

Fasilitas ini memecahkan masalah container integrity:

- thread lifecycle,
- context propagation tertentu,
- container shutdown,
- classloader,
- naming,
- security,
- transaction rules,
- resource governance.

Structured Concurrency dan Scoped Values berasal dari Java SE, bukan Jakarta EE. Jadi pertanyaan pentingnya bukan:

> “Apakah kita bisa memakai Structured Concurrency di Jakarta EE?”

Pertanyaan yang lebih benar:

> “Bagaimana ide Structured Concurrency dan Scoped Values dapat diterapkan tanpa melanggar managed lifecycle, context rules, transaction boundary, security boundary, dan portability Jakarta EE?”

Pada Java 21+, Jakarta Concurrency 3.1 mulai memasukkan dukungan virtual threads pada managed executor resources. Ini penting karena virtual threads memberi execution model modern, tetapi container tetap harus menjadi owner resource.

---

## 5. Structured Concurrency: Masalah yang Ingin Dihilangkan

### 5.1 Fire-and-Forget yang Tidak Terlihat

```java
public void submitAudit(AuditEvent event) {
    executor.submit(() -> auditService.write(event));
}
```

Ini terlihat sederhana. Tetapi:

- caller tidak tahu audit berhasil atau gagal,
- task bisa gagal diam-diam,
- retry tidak jelas,
- shutdown bisa membunuh task,
- audit event penting bisa hilang,
- user operation bisa dinyatakan sukses padahal audit gagal.

Untuk audit defensible, ini biasanya buruk. Lebih aman menggunakan durable outbox atau batch/job request.

Structured concurrency tidak dimaksudkan untuk mengganti durable messaging. Ia membantu untuk task paralel yang masih menjadi bagian dari parent operation.

---

### 5.2 Fan-Out/Fan-In Tanpa Cancellation

Contoh fan-out:

```java
CompletableFuture<Customer> c = CompletableFuture.supplyAsync(() -> loadCustomer(id));
CompletableFuture<List<Order>> o = CompletableFuture.supplyAsync(() -> loadOrders(id));
CompletableFuture<RiskScore> r = CompletableFuture.supplyAsync(() -> loadRisk(id));

return c.thenCombine(o, ...).thenCombine(r, ...).join();
```

Masalah umum:

- default executor bisa `ForkJoinPool.commonPool`, bukan managed executor,
- kalau satu gagal, sibling belum tentu cancelled,
- timeout perlu dirancang manual,
- context propagation tidak otomatis sesuai Jakarta EE,
- exception wrapping kompleks,
- cancellation graph sulit.

Structured concurrency mencoba menjadikan pola ini lebih natural:

```text
Buka scope
  fork A
  fork B
  fork C
  tunggu semua / tunggu sampai satu gagal
  combine hasil
Tutup scope, pastikan task tidak bocor
```

---

### 5.3 Observability yang Tidak Memiliki Bentuk

Dalam sistem unstructured:

```text
Request thread
  submits task A
  submits task B
  returns

Executor thread 1 runs A
Executor thread 2 runs B
```

Trace/log sering terlihat seperti fragmen terpisah. Kamu punya correlation ID, tapi tidak selalu punya struktur kerja.

Structured concurrency memberi bentuk:

```text
Request: BuildCustomerProfile
├── LoadCustomer
├── LoadOrders
└── LoadRiskScore
```

Untuk engineer senior/top-tier, ini penting karena operability bukan tambahan belakangan. Desain concurrency yang tidak bisa diamati adalah desain yang belum selesai.

---

## 6. Structured Concurrency di Java 25: Konsep API

> Catatan: API Structured Concurrency masih preview pada Java 25. Nama class/method bisa berubah sampai final. Materi ini menekankan mental model dan pola desain, bukan mengunci semua detail API sebagai kontrak jangka panjang.

Secara konseptual, Structured Concurrency menyediakan:

- scope untuk menampung child tasks,
- fork untuk membuat subtask,
- join untuk menunggu,
- policy untuk success/failure,
- cancellation otomatis saat scope ditutup atau gagal,
- agregasi hasil/error.

Pseudo-code konseptual:

```java
try (var scope = StructuredTaskScope.open()) {
    var customer = scope.fork(() -> loadCustomer(id));
    var orders   = scope.fork(() -> loadOrders(id));
    var risk     = scope.fork(() -> loadRiskScore(id));

    scope.join();

    return new CustomerProfile(
        customer.get(),
        orders.get(),
        risk.get()
    );
}
```

Yang penting bukan syntax-nya, tetapi invariant-nya:

- semua subtask berada dalam lexical scope,
- parent menunggu child,
- child tidak bocor keluar scope,
- failure/cancellation dapat dikelola sebagai satu unit.

---

## 7. Dari Executor Thinking ke Scope Thinking

### 7.1 Executor Thinking

Executor thinking bertanya:

- pool berapa besar?
- queue berapa panjang?
- task dimasukkan ke mana?
- bagaimana submit?
- bagaimana get result?

Ini tetap penting, terutama di Jakarta EE.

Tetapi executor thinking cenderung membuat kita berpikir pada level mekanisme.

```text
Task -> Queue -> Worker Thread -> Result
```

---

### 7.2 Scope Thinking

Scope thinking bertanya:

- task-task ini milik operasi apa?
- apakah parent boleh selesai sebelum child selesai?
- jika child gagal, apa nasib sibling?
- jika caller membatalkan, apa yang harus dibatalkan?
- context apa yang valid selama scope ini?
- apakah hasil operasi valid jika sebagian child gagal?
- apa boundary transaksi dan auditnya?

```text
Operation Scope
├── Task A
├── Task B
└── Task C
```

Executor adalah mekanisme eksekusi. Scope adalah struktur ownership.

Top-tier engineer tidak berhenti di “pakai executor mana”. Mereka mendesain struktur kerja.

---

## 8. Scoped Values: Mengapa ThreadLocal Mulai Kurang Ideal

### 8.1 ThreadLocal di Dunia Platform Thread Pool

Pada thread pool biasa, thread dipakai ulang:

```text
Thread-1 handles Request A
Thread-1 later handles Request B
Thread-1 later handles Request C
```

Jika context tidak dibersihkan:

```java
REQUEST_ID.set("A");
// forgot remove
```

Maka Request B bisa melihat context Request A. Ini bug serius.

Karena itu pattern klasik:

```java
try {
    REQUEST_CONTEXT.set(ctx);
    doWork();
} finally {
    REQUEST_CONTEXT.remove();
}
```

Pattern ini benar, tetapi rentan human error.

---

### 8.2 ThreadLocal di Dunia Virtual Threads

Virtual threads murah dibuat dan biasanya tidak reused seperti platform thread pool worker. Ini mengurangi sebagian risiko reuse leak. Namun `ThreadLocal` tetap punya masalah:

- setiap virtual thread bisa membawa map ThreadLocal sendiri,
- overhead bisa besar jika digunakan masif,
- mutable context tetap sulit dipahami,
- propagation ke child task tidak otomatis mengikuti struktur yang jelas,
- lifetime tetap tidak sejelas lexical scope.

Virtual thread membuat blocking murah, tetapi tidak otomatis membuat context aman.

---

### 8.3 Scoped Value Mental Model

Scoped value seperti “parameter implisit yang lexical”.

Alih-alih:

```java
RequestContextHolder.set(ctx);
try {
    service.handle();
} finally {
    RequestContextHolder.clear();
}
```

Modelnya menjadi:

```java
ScopedValue.where(REQUEST_CONTEXT, ctx)
           .run(() -> service.handle());
```

Di dalam `service.handle()`, code dapat membaca:

```java
RequestContext ctx = REQUEST_CONTEXT.get();
```

Tetapi di luar scope, binding itu tidak ada.

Ini membuat context lifetime lebih jelas:

```text
Before scope: no context
Inside scope: context exists
After scope: no context
```

---

## 9. Scoped Values vs ThreadLocal

| Aspek | ThreadLocal | Scoped Value |
|---|---|---|
| Mutability | Umumnya mutable via `set/remove` | Binding scoped dan lebih immutable-oriented |
| Lifetime | Manual, rawan lupa clear | Lexical scope |
| Propagation | Manual/khusus framework | Dirancang cocok dengan child tasks structured |
| Virtual thread cost | Bisa mahal jika banyak | Lebih ringan untuk banyak skenario |
| Reasoning | Ambient mutable state | Scoped implicit parameter |
| Leak risk | Tinggi jika pool thread dan cleanup buruk | Lebih rendah karena scope-bound |
| Enterprise fit | Masih banyak dipakai oleh framework | Arah modern untuk context ringan |

Namun scoped values bukan pengganti semua `ThreadLocal`.

Masih ada kasus ThreadLocal yang valid:

- framework internal compatibility,
- legacy libraries,
- mutable per-thread cache yang benar-benar lokal,
- existing tracing/logging ecosystem,
- container-managed context yang belum expose scoped value model.

Tetapi untuk application-level context seperti correlation ID, tenant ID, atau immutable request metadata, Scoped Values adalah model yang lebih baik secara konseptual.

---

## 10. Apa yang Tidak Boleh Disalahpahami

### 10.1 Structured Concurrency Bukan Durable Job

Structured concurrency cocok untuk child task yang merupakan bagian langsung dari parent operation.

Cocok:

```text
Build response by calling three independent read services in parallel.
```

Tidak cocok sebagai pengganti:

```text
Run nightly reconciliation for 10 million records with restartability.
```

Untuk workload durable, gunakan:

- Jakarta Batch,
- messaging,
- database-backed job request,
- workflow engine,
- Kubernetes Job/CronJob,
- external orchestrator.

Structured concurrency bukan persistence model.

---

### 10.2 Scoped Values Bukan Security Context Jakarta EE

Scoped value bisa membawa immutable metadata seperti:

```java
record AuditActor(String userId, String username, Set<String> roles) {}
```

Tetapi itu tidak otomatis menjadi container security identity.

Dalam Jakarta EE, security identity punya aturan container sendiri. Jangan menganggap:

```java
ScopedValue.where(ACTOR, actor).run(...)
```

sama dengan “task ini berjalan sebagai user tersebut” dalam arti Jakarta Security/JACC/container authorization.

Untuk audit, scoped value bisa membantu membawa attribution. Untuk authorization container, tetap gunakan mekanisme security container.

---

### 10.3 Structured Concurrency Tidak Menghapus Kebutuhan Managed Executor

Di Java SE standalone, structured concurrency dapat memakai thread factory atau virtual threads secara langsung.

Di Jakarta EE, pertanyaan penting:

- apakah thread dikelola container?
- apakah classloader benar?
- apakah naming context benar?
- apakah security context sesuai?
- apakah lifecycle task diketahui container?
- apakah shutdown/redeploy aman?
- apakah fitur ini portable di server target?

Jadi, Structured Concurrency harus dipahami sebagai model struktur. Managed concurrency tetap dibutuhkan untuk container contract.

---

### 10.4 Virtual Threads Tidak Berarti Unlimited Concurrency

Virtual threads murah, tetapi downstream tetap terbatas:

- DB connection pool,
- transaction manager,
- external API rate limit,
- CPU,
- memory,
- lock contention,
- row locks,
- message broker capacity.

Structured concurrency membuat fan-out lebih mudah. Justru karena mudah, engineer harus lebih disiplin memberi limit.

Contoh buruk:

```java
for (Customer c : customers) {
    scope.fork(() -> enrichCustomer(c));
}
```

Kalau `customers` berisi 100.000 item, kamu baru saja membuat fan-out masif tanpa backpressure.

Structured concurrency tidak mengganti bulkhead, rate limiter, dan batch partitioning.

---

## 11. Enterprise Fan-Out/Fan-In Pattern

### 11.1 Problem

Misalnya endpoint regulatory case profile perlu mengambil:

- case master,
- parties,
- open enforcement actions,
- pending correspondence,
- risk score,
- SLA ageing,
- related cases.

Sebagian data independen dan dapat diparalelkan.

Naive sequential:

```text
load case         150 ms
load parties      200 ms
load actions      300 ms
load letters      180 ms
load risk         250 ms
load related      350 ms
------------------------
total             1430 ms
```

Parallel fan-out bisa menurunkan latency menjadi sekitar max task latency + overhead.

Namun parallel fan-out menambah risiko:

- lebih banyak DB/API call bersamaan,
- partial failure,
- timeout aggregation,
- authorization consistency,
- audit attribution,
- observability complexity.

---

### 11.2 Scope-Based Design

Design invariant:

```text
BuildCaseProfileOperation
├── LoadCaseMaster
├── LoadParties
├── LoadOpenActions
├── LoadPendingCorrespondence
├── LoadRiskScore
└── LoadRelatedCases
```

Business rule:

- `case master` wajib.
- `parties` wajib.
- `actions` wajib.
- `correspondence` optional dengan degradation.
- `risk score` optional jika risk service timeout.
- `related cases` optional.

Ini berarti policy failure tidak seragam.

Structured concurrency membantu, tetapi kamu tetap harus mendesain semantic policy:

```text
Required child failed  -> fail whole operation, cancel optional siblings.
Optional child failed  -> record degraded result, continue if required children succeed.
Timeout exceeded       -> cancel unfinished children, return fail/degraded depending business rule.
```

---

### 11.3 Pseudo-code dengan Policy

```java
public CaseProfile buildProfile(CaseId caseId) {
    OperationContext ctx = currentOperationContext();

    return withOperationContext(ctx, () -> {
        try (var scope = openStructuredScope("BuildCaseProfile")) {
            var caseTask = scope.fork("LoadCaseMaster", () -> caseService.load(caseId));
            var partiesTask = scope.fork("LoadParties", () -> partyService.loadByCase(caseId));
            var actionsTask = scope.fork("LoadOpenActions", () -> actionService.loadOpen(caseId));

            var correspondenceTask = scope.fork("LoadPendingCorrespondence", () ->
                optional(correspondenceService.loadPending(caseId))
            );

            var riskTask = scope.fork("LoadRiskScore", () ->
                optional(riskService.score(caseId))
            );

            scope.joinUntil(deadlineFromRequestTimeout());

            return CaseProfile.builder()
                .caseMaster(required(caseTask))
                .parties(required(partiesTask))
                .openActions(required(actionsTask))
                .pendingCorrespondence(optionalResult(correspondenceTask))
                .riskScore(optionalResult(riskTask))
                .build();
        }
    });
}
```

Kode di atas sengaja pseudo-code. Tujuannya menekankan desain:

- ada operation context,
- ada lexical scope,
- task diberi nama,
- ada deadline,
- required/optional child dibedakan,
- hasil optional tidak disamakan dengan error fatal,
- child task tidak bocor keluar method.

---

## 12. Deadline, Timeout, dan Cancellation dalam Structured Thinking

### 12.1 Timeout Bukan Angka Random

Timeout harus diturunkan dari budget operation.

Contoh:

```text
HTTP gateway timeout:          5 seconds
Application target response:   3 seconds
DB query max:                  1.5 seconds
External risk API max:         800 ms
Internal fan-out budget:       2 seconds
```

Structured concurrency memungkinkan child task dibatalkan ketika deadline parent habis.

Mental model:

```text
Parent deadline = T+3000ms
├── Child A deadline <= T+2500ms
├── Child B deadline <= T+2500ms
└── Child C deadline <= T+2500ms
```

Jangan membiarkan child task punya timeout lebih panjang dari parent request.

---

### 12.2 Cancellation Harus Cooperative

Cancellation bukan magic kill.

Agar task bisa dibatalkan:

- cek interrupt status,
- gunakan client library yang mendukung timeout/cancel,
- set JDBC query timeout,
- set HTTP request timeout,
- jangan swallow `InterruptedException`,
- bersihkan resource di `finally`,
- jangan memulai side effect irreversible setelah cancellation diminta.

Contoh anti-pattern:

```java
try {
    Thread.sleep(10_000);
} catch (InterruptedException e) {
    // ignored
}
continueProcessing();
```

Lebih benar:

```java
try {
    Thread.sleep(10_000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new CancellationException("Task interrupted");
}
```

---

### 12.3 Cancellation dan Transaction

Jika child task membuka transaction sendiri, cancellation harus memicu rollback atau stop sebelum commit.

Bahaya:

```text
Parent cancelled
Child still committing transaction
Caller sees timeout
Database state already changed
Retry creates duplicate side effect
```

Untuk operasi read-only fan-out, risiko lebih rendah. Untuk write side effect, perlu desain jauh lebih hati-hati:

- durable command,
- outbox,
- idempotency key,
- compensation,
- status table,
- job repository.

Structured concurrency lebih natural untuk read/fetch/enrich. Untuk write workflow besar, gunakan durable orchestration.

---

## 13. Scoped Values untuk Operation Context

### 13.1 Context yang Cocok

Scoped Values cocok untuk context yang:

- immutable,
- kecil,
- sering dibaca,
- berlaku selama operation tertentu,
- bukan secret mentah,
- bukan mutable transaction/session object,
- bukan entity manager,
- bukan request object penuh.

Contoh cocok:

```java
record OperationContext(
    String correlationId,
    String requestId,
    String tenantId,
    String initiatedBy,
    Instant startedAt,
    String entryPoint
) {}
```

Contoh tidak cocok:

```java
EntityManager em;
User mutableUser;
HttpServletRequest request;
Connection jdbcConnection;
AccessToken rawToken;
Large mutable Map<String, Object> bag;
```

---

### 13.2 Scoped Context Pseudo-code

```java
public final class OperationContexts {
    public static final ScopedValue<OperationContext> CURRENT = ScopedValue.newInstance();

    public static OperationContext current() {
        return CURRENT.get();
    }
}
```

Binding:

```java
OperationContext ctx = new OperationContext(
    correlationId,
    requestId,
    tenantId,
    userId,
    Instant.now(),
    "GET /cases/{id}/profile"
);

ScopedValue.where(OperationContexts.CURRENT, ctx)
           .run(() -> caseProfileService.build(caseId));
```

Reading:

```java
public void logBusinessEvent(String eventType) {
    OperationContext ctx = OperationContexts.current();

    auditLog.write(new AuditEvent(
        ctx.correlationId(),
        ctx.tenantId(),
        ctx.initiatedBy(),
        eventType,
        Instant.now()
    ));
}
```

---

### 13.3 Why This Is Better Than Context Map Everywhere

Alternatif buruk:

```java
Map<String, Object> context = new HashMap<>();
context.put("correlationId", correlationId);
context.put("tenant", tenant);
context.put("user", user);
service.handle(context);
```

Masalah:

- key string rawan typo,
- type unsafe,
- mutable,
- mudah ditambah data sembarangan,
- tidak jelas lifecycle,
- API menjadi kotor.

Scoped value memberi implicit parameter yang tetap strongly typed dan scoped.

Namun jangan terlalu banyak membuat scoped value global. Gunakan context object yang jelas.

---

## 14. Jakarta EE Integration Reality

### 14.1 Portable Baseline Hari Ini

Untuk Jakarta EE portable code, baseline yang aman masih:

- `ManagedExecutorService`,
- `ManagedScheduledExecutorService`,
- `ContextService`,
- Jakarta Batch,
- CDI/JTA/Jakarta Security rules sesuai spesifikasi.

Structured Concurrency di Java 25 masih preview, sehingga:

- tidak boleh dijadikan portable Jakarta EE assumption,
- perlu compile/run dengan preview enablement,
- API bisa berubah,
- server support berbeda-beda,
- compliance Jakarta EE tidak otomatis mencakup Structured Concurrency.

---

### 14.2 Cara Memakai Ide Structured Concurrency Tanpa API Preview

Walaupun belum memakai API Structured Concurrency secara langsung, kamu bisa menerapkan mental modelnya dengan `ManagedExecutorService`.

Pattern manual:

```java
public Result aggregate(Request request) {
    List<Future<?>> futures = new ArrayList<>();

    try {
        Future<A> a = executor.submit(() -> loadA(request));
        Future<B> b = executor.submit(() -> loadB(request));
        Future<C> c = executor.submit(() -> loadC(request));

        futures.add(a);
        futures.add(b);
        futures.add(c);

        A av = a.get(remainingTime(), MILLISECONDS);
        B bv = b.get(remainingTime(), MILLISECONDS);
        C cv = c.get(remainingTime(), MILLISECONDS);

        return combine(av, bv, cv);
    } catch (Exception e) {
        cancelAll(futures);
        throw translate(e);
    } finally {
        cancelUnfinished(futures);
    }
}
```

Invariants yang ingin dijaga:

- semua future dicatat,
- saat parent gagal, semua child dibatalkan,
- timeout dihitung dari parent deadline,
- tidak ada task yang sengaja dibiarkan orphan,
- executor yang dipakai managed,
- context propagation dilakukan eksplisit.

Ini belum sebersih Structured Concurrency native, tetapi secara mental model jauh lebih baik daripada fire-and-forget.

---

### 14.3 Adapter Internal: Scope di Atas ManagedExecutorService

Di enterprise codebase besar, kamu bisa membangun abstraction internal:

```java
public interface OperationScope extends AutoCloseable {
    <T> Subtask<T> fork(String name, Callable<T> task);
    void joinUntil(Instant deadline);
    void cancelAll();
    @Override void close();
}
```

Implementasi Java 8–20 bisa memakai `ManagedExecutorService` + `Future`.

Implementasi Java 21–25 tertentu bisa memakai virtual thread capable managed executor jika server mendukung.

Implementasi future bisa memakai Structured Concurrency API ketika final/stabil.

Keuntungannya:

- application code berpikir dalam scope,
- mekanisme bisa berubah per runtime,
- portability lebih terjaga,
- observability bisa distandardisasi,
- task naming/correlation bisa konsisten.

---

## 15. Example: Manual Structured Scope dengan ManagedExecutorService

Berikut contoh konseptual portable-ish untuk Java 8+ di Jakarta EE. Ini bukan library lengkap, tetapi memberi mental model.

```java
public final class ManagedOperationScope implements AutoCloseable {

    private final ManagedExecutorService executor;
    private final String operationName;
    private final List<Future<?>> futures = new ArrayList<>();
    private boolean closed;

    public ManagedOperationScope(String operationName, ManagedExecutorService executor) {
        this.operationName = Objects.requireNonNull(operationName);
        this.executor = Objects.requireNonNull(executor);
    }

    public <T> Future<T> fork(String taskName, Callable<T> task) {
        ensureOpen();

        Callable<T> namedTask = () -> {
            String previous = MDC.get("taskName");
            MDC.put("operationName", operationName);
            MDC.put("taskName", taskName);
            try {
                return task.call();
            } finally {
                if (previous == null) {
                    MDC.remove("taskName");
                } else {
                    MDC.put("taskName", previous);
                }
            }
        };

        Future<T> future = executor.submit(namedTask);
        futures.add(future);
        return future;
    }

    public void cancelAll() {
        for (Future<?> future : futures) {
            if (!future.isDone()) {
                future.cancel(true);
            }
        }
    }

    @Override
    public void close() {
        if (!closed) {
            cancelAll();
            closed = true;
        }
    }

    private void ensureOpen() {
        if (closed) {
            throw new IllegalStateException("Operation scope already closed");
        }
    }
}
```

Usage:

```java
public CaseProfile loadProfile(CaseId caseId) {
    Instant deadline = Instant.now().plusMillis(2500);

    try (ManagedOperationScope scope = new ManagedOperationScope("LoadCaseProfile", executor)) {
        Future<CaseMaster> master = scope.fork("LoadCaseMaster", () -> caseRepo.find(caseId));
        Future<List<Party>> parties = scope.fork("LoadParties", () -> partyRepo.findByCase(caseId));
        Future<RiskScore> risk = scope.fork("LoadRisk", () -> riskClient.score(caseId));

        return new CaseProfile(
            getRequired(master, deadline),
            getRequired(parties, deadline),
            getOptional(risk, deadline).orElse(RiskScore.unavailable())
        );
    } catch (Exception e) {
        throw translateProfileFailure(e);
    }
}
```

Ini belum sempurna:

- `getRequired` masih perlu deadline calculation yang benar,
- cancellation tidak sekuat structured API native,
- MDC propagation perlu hati-hati,
- context propagation sebaiknya memakai `ContextService` jika sesuai,
- exception aggregation masih manual.

Tetapi desain ini sudah memaksa invariant:

> semua child task dimiliki oleh operation scope, dan scope menutup/cancel task yang belum selesai.

---

## 16. Context Propagation: Jakarta ContextService vs Scoped Values

### 16.1 ContextService

`ContextService` memungkinkan membuat contextual proxy/function agar invocation berjalan dengan context container tertentu.

Secara konseptual:

```java
Callable<Result> contextual = contextService.createContextualProxy(
    () -> service.load(),
    Callable.class
);

executor.submit(contextual);
```

Context yang dikelola adalah context container/spec tertentu, bukan semua application-level context.

---

### 16.2 Scoped Values

Scoped Values lebih cocok untuk application-defined immutable context.

Contoh:

```java
ScopedValue.where(OPERATION_CONTEXT, ctx)
           .run(() -> service.handle());
```

Dalam structured child task, binding dapat terlihat oleh child sesuai aturan structured concurrency.

---

### 16.3 Keduanya Bisa Saling Melengkapi

| Concern | Tool yang Cocok |
|---|---|
| Container naming/classloader/security context | Jakarta managed concurrency / ContextService |
| Application correlation ID | Scoped Value atau MDC wrapper |
| Tenant ID immutable | Scoped Value |
| JTA transaction | Jangan propagate sembarangan; buat boundary eksplisit |
| CDI request context | Jangan diasumsikan hidup di async task |
| Audit actor metadata | Scoped Value / explicit command payload |
| Durable job identity | Job parameter / job request table |

Kesalahan umum adalah menganggap satu mekanisme context dapat menyelesaikan semuanya.

Top-tier model:

```text
Different contexts have different owners, lifetimes, propagation rules, and safety constraints.
```

---

## 17. Scoped Values dan Audit Defensibility

Untuk regulatory system, audit attribution harus kuat.

Jangan hanya menyimpan:

```text
currentUser = ThreadLocal.get()
```

Karena dalam async/batch/concurrent execution:

- thread bisa berbeda,
- user session bisa habis,
- task bisa dijalankan system identity,
- retry bisa terjadi jam berikutnya,
- job bisa direstart operator lain.

Lebih defensible:

```java
record AuditAttribution(
    String initiatedByUserId,
    String initiatedByUsername,
    String executionIdentity,
    String correlationId,
    String reason,
    Instant initiatedAt,
    String sourceOperation
) {}
```

Gunakan scoped values untuk short-lived request fan-out:

```java
ScopedValue.where(AUDIT_ATTRIBUTION, attribution)
           .run(() -> performParallelReadOperation());
```

Untuk durable async/batch:

- persist attribution di job request/outbox table,
- jangan hanya bergantung pada in-memory scoped value,
- saat job berjalan, rehydrate attribution sebagai execution metadata,
- audit event harus membedakan `initiatedBy` dan `executedBy`.

---

## 18. Pattern: Read Aggregation with Structured Concurrency

Cocok untuk:

- agregasi data read-only,
- endpoint yang perlu mengambil beberapa resource independen,
- latency-sensitive request,
- fan-out kecil dan bounded,
- child task pendek,
- hasil tidak perlu durable jika request gagal.

Contoh:

```text
GET /cases/{id}/dashboard
├── Load case summary
├── Load SLA status
├── Load latest correspondence
├── Load open enforcement actions
└── Load risk flags
```

Invariants:

- max child count diketahui,
- timeout mengikuti request budget,
- read-only atau idempotent,
- optional data boleh degraded,
- required data failure menggagalkan response,
- sibling cancelled jika tidak diperlukan.

---

## 19. Pattern: Parallel Validation

Cocok untuk validasi independen:

```text
Validate Application Submission
├── Validate applicant profile
├── Validate document completeness
├── Validate eligibility
├── Validate duplicate application
└── Validate outstanding enforcement issue
```

Namun hati-hati:

- kalau validasi memakai DB locks, parallel bisa memperburuk contention,
- kalau validasi butuh urutan business rule, jangan diparalelkan sembarangan,
- kalau hasil harus lengkap untuk user feedback, jangan cancel setelah first failure,
- kalau validasi expensive, batasi concurrency.

Policy:

```text
Mode A: fail fast
- cocok untuk internal dependency required

Mode B: collect all failures
- cocok untuk user validation feedback
```

Structured concurrency tidak otomatis memilih policy. Engineer harus mendesain semantic join.

---

## 20. Pattern: Bounded Fan-Out to External API

Misalnya memanggil external registry untuk 20 identifiers.

Jangan langsung:

```java
ids.forEach(id -> scope.fork(() -> registryClient.lookup(id)));
```

Tambahkan limit:

```java
Semaphore limit = new Semaphore(5);

for (String id : ids) {
    scope.fork(() -> {
        limit.acquire();
        try {
            return registryClient.lookup(id);
        } finally {
            limit.release();
        }
    });
}
```

Lebih enterprise lagi:

- global rate limiter,
- circuit breaker,
- per-tenant fairness,
- timeout per call,
- retry budget,
- request deduplication,
- metrics per downstream.

Structured concurrency memberi bentuk. Bulkhead memberi keselamatan kapasitas.

---

## 21. Pattern: Request-Scoped Context with Scoped Values

Misalnya context:

```java
record RequestMetadata(
    String correlationId,
    String tenantId,
    String userId,
    String operation
) {}
```

Entry point:

```java
public Response handle(HttpRequest request) {
    RequestMetadata metadata = extractMetadata(request);

    return ScopedValue.where(REQUEST_METADATA, metadata)
        .call(() -> service.handle(request));
}
```

Nested service:

```java
public void writeBusinessLog(String event) {
    RequestMetadata metadata = REQUEST_METADATA.get();
    logger.info("event={} correlationId={} tenantId={} userId={}",
        event,
        metadata.correlationId(),
        metadata.tenantId(),
        metadata.userId()
    );
}
```

Benefit:

- no parameter pollution,
- no mutable ThreadLocal,
- no manual clear,
- context lifetime jelas.

Caveat:

- framework logging MDC belum otomatis membaca Scoped Values,
- third-party library mungkin masih ThreadLocal-based,
- Jakarta server support dan integration perlu diuji.

---

## 22. Anti-Patterns

### 22.1 Forking Unbounded Tasks

```java
for (Record r : millionsOfRecords) {
    scope.fork(() -> process(r));
}
```

Ini bukan structured concurrency yang baik. Ini hanya unbounded concurrency dengan syntax baru.

Gunakan:

- Jakarta Batch partitioning,
- chunk processing,
- bounded executor,
- queue/backpressure,
- stream with bounded parallelism,
- database-driven pagination.

---

### 22.2 Menyimpan Mutable Object di Scoped Value

```java
ScopedValue<Map<String, Object>> CTX = ScopedValue.newInstance();
```

Lalu:

```java
CTX.get().put("role", "admin");
```

Ini menghancurkan benefit scoped value. Binding-nya scoped, tetapi object-nya mutable dan bisa disalahgunakan.

Gunakan record immutable.

---

### 22.3 Menganggap Scoped Value Sama dengan Authorization

```java
ScopedValue.where(USER_ID, "alice").run(() -> adminService.deleteCase(id));
```

Ini bukan authorization. Itu hanya metadata aplikasi.

Authorization tetap harus dicek melalui mekanisme security yang benar.

---

### 22.4 Menggunakan Preview API sebagai Fondasi Portable Enterprise

Jika organisasi tidak menerima preview feature, jangan menjadikan Structured Concurrency API preview sebagai dependency core production.

Lebih aman:

- gunakan abstraction internal,
- implement dengan managed executor sekarang,
- siapkan adapter future ketika API final,
- isolasi kode preview di module terpisah jika harus eksperimen.

---

### 22.5 Fan-Out Write Operation Tanpa Idempotency

```text
Approve case
├── update case status
├── send email
├── notify external agency
└── create audit event
```

Ini bukan kandidat ideal untuk naive structured concurrency, karena side effect-nya irreversible/partially committed.

Gunakan:

- transaction untuk state internal,
- outbox untuk side effect external,
- idempotency key,
- durable retry,
- compensation bila perlu,
- audit event yang transactional dengan state change.

---

## 23. Failure Model

### 23.1 Failure Kategori

Dalam structured operation, child task failure perlu diklasifikasikan:

| Failure | Contoh | Policy |
|---|---|---|
| Required dependency failure | case master not found | fail whole operation |
| Optional dependency failure | risk service timeout | degrade result |
| Timeout | API too slow | cancel unfinished tasks |
| Authorization failure | user cannot access related case | fail or omit based policy |
| Data conflict | stale version | fail, ask retry |
| Downstream overload | 429/503 | retry if within budget, otherwise degrade/fail |
| Cancellation | caller disconnected | cancel child tasks |

---

### 23.2 Error Aggregation

Unstructured code sering kehilangan error kedua/ketiga.

Dalam fan-out, bisa terjadi:

```text
Task A fails with DB timeout
Task B fails with 403
Task C cancelled
```

Error response harus punya primary cause, tetapi logs/metrics harus mencatat semua relevant outcomes.

Design:

```java
record ChildTaskOutcome(
    String taskName,
    TaskStatus status,
    Duration duration,
    Throwable failure
) {}
```

Untuk observability, outcome per child task jauh lebih berguna daripada satu stacktrace parent.

---

### 23.3 Partial Result

Partial result harus explicit.

Buruk:

```json
{
  "riskScore": null
}
```

Lebih baik:

```json
{
  "riskScore": null,
  "riskScoreStatus": "UNAVAILABLE",
  "warnings": [
    {
      "code": "RISK_SERVICE_TIMEOUT",
      "message": "Risk score is temporarily unavailable."
    }
  ]
}
```

Dalam regulatory system, partial result harus tidak menyesatkan user.

---

## 24. Observability Design

### 24.1 Task Naming

Selalu beri nama child task secara business-readable:

```text
LoadCaseMaster
LoadParties
LoadOpenActions
CalculateSlaAgeing
FetchExternalRegistryStatus
```

Jangan hanya:

```text
task-1
task-2
task-3
```

Nama task masuk ke:

- logs,
- metrics,
- traces,
- JFR events,
- debug dumps,
- admin diagnostics.

---

### 24.2 Metrics

Minimal:

```text
operation.duration
operation.success.count
operation.failure.count
operation.timeout.count
operation.cancelled.count
child_task.duration{taskName}
child_task.failure.count{taskName, failureType}
child_task.cancelled.count{taskName}
child_task.timeout.count{taskName}
fanout.child.count{operationName}
```

Untuk capacity:

```text
executor.active
executor.queue.depth
executor.rejected.count
downstream.concurrent.calls{service}
downstream.rate_limited.count{service}
```

---

### 24.3 Trace Shape

Ideal trace:

```text
HTTP GET /cases/123/profile
└── BuildCaseProfile
    ├── LoadCaseMaster
    ├── LoadParties
    ├── LoadOpenActions
    ├── LoadRiskScore
    └── LoadRelatedCases
```

Jika trace hanya menunjukkan unrelated spans, kamu belum mendapatkan benefit struktural.

---

## 25. Testing Strategy

### 25.1 Unit Test untuk Policy

Test:

- semua child sukses,
- required child gagal,
- optional child gagal,
- required child timeout,
- optional child timeout,
- multiple failures,
- parent cancellation,
- child interrupted,
- partial result semantics.

---

### 25.2 Integration Test untuk Context

Test:

- correlation ID terlihat di child task,
- tenant ID benar,
- user attribution benar,
- context tidak bocor ke request berikutnya,
- context hilang setelah scope selesai,
- MDC/log context sesuai,
- CDI/security/JTA context tidak diasumsikan sembarangan.

---

### 25.3 Load Test untuk Fan-Out

Test:

- request concurrency tinggi,
- fan-out child count,
- DB pool saturation,
- downstream API rate limit,
- cancellation under timeout,
- queue growth,
- memory usage,
- virtual thread count jika digunakan.

Concurrency feature yang benar secara unit test masih bisa gagal secara capacity.

---

## 26. Migration Thinking Java 8–25

### 26.1 Java 8–20

Available:

- `ExecutorService`,
- `Future`,
- `CompletableFuture`,
- Jakarta/Java EE managed concurrency,
- ThreadLocal.

Recommended:

- jangan gunakan raw executor di Jakarta EE,
- gunakan `ManagedExecutorService`,
- bangun manual operation scope jika perlu,
- context propagation eksplisit,
- gunakan durable outbox/job untuk side effect async.

---

### 26.2 Java 21+

Available:

- virtual threads final,
- better blocking concurrency model,
- Jakarta Concurrency 3.1 support for virtual-thread-capable managed executor resources.

Recommended:

- gunakan virtual threads untuk bounded I/O concurrency jika server support,
- jangan hilangkan capacity limit,
- tetap managed executor di Jakarta EE,
- evaluasi ThreadLocal usage.

---

### 26.3 Java 25

Relevant:

- Scoped Values sebagai model context modern,
- Structured Concurrency masih preview,
- Java ecosystem bergerak menuju structured, virtual-thread-friendly programming.

Recommended:

- Scoped Values bisa mulai dieksplor untuk application-level immutable context jika runtime mendukung,
- Structured Concurrency sebaiknya dipakai untuk eksperimen atau module terisolasi kecuali organisasi menerima preview,
- gunakan abstraction agar mudah migrasi saat API final.

---

## 27. Decision Matrix

| Use Case | Structured Concurrency | Scoped Values | ManagedExecutorService | Jakarta Batch | Messaging/Outbox |
|---|---:|---:|---:|---:|---:|
| Request read aggregation | Strong fit | Strong fit | Strong fit | Weak | Weak |
| Short-lived parallel validation | Fit | Fit | Fit | Weak | Weak |
| Fire-and-forget audit | Poor | Weak | Weak alone | Maybe | Strong |
| Durable side effect retry | Poor | Weak | Weak alone | Fit | Strong |
| Nightly million-record job | Poor | Weak | Support only | Strong | Maybe |
| External API fan-out small bounded | Fit | Fit | Fit | Maybe | Maybe |
| External API bulk sync | Weak alone | Weak | Support only | Strong | Strong |
| Cross-request workflow | Poor | Weak | Weak | Maybe | Strong/workflow |
| Request context immutable metadata | N/A | Strong | N/A | Maybe via job params | Via command payload |

---

## 28. Production Checklist

Sebelum memakai structured/fan-out pattern:

- [ ] Apakah child task benar-benar bagian dari parent operation?
- [ ] Apakah parent boleh selesai sebelum child selesai? Jika tidak, structured model cocok.
- [ ] Apakah semua child task bounded jumlahnya?
- [ ] Apakah ada deadline parent?
- [ ] Apakah timeout child lebih pendek dari deadline parent?
- [ ] Apakah required vs optional child jelas?
- [ ] Apakah failure policy tertulis?
- [ ] Apakah cancellation cooperative?
- [ ] Apakah semua side effect idempotent atau read-only?
- [ ] Apakah executor managed oleh container?
- [ ] Apakah context propagation explicit?
- [ ] Apakah JTA transaction tidak dipropagasikan sembarangan?
- [ ] Apakah audit attribution jelas?
- [ ] Apakah observability menunjukkan parent-child shape?
- [ ] Apakah metrics per child tersedia?
- [ ] Apakah load test menguji downstream saturation?
- [ ] Apakah preview API tidak bocor ke portable production core?

---

## 29. Thought Experiment

### Scenario

Endpoint:

```text
POST /cases/{id}/evaluate-escalation
```

Operation perlu:

1. load case,
2. load enforcement history,
3. call risk scoring service,
4. check outstanding payment,
5. check open appeal,
6. update escalation recommendation,
7. write audit event,
8. send notification if recommended.

Pertanyaan desain:

1. Mana yang cocok diparalelkan?
2. Mana yang harus sequential?
3. Mana yang read-only?
4. Mana yang write side effect?
5. Mana yang harus durable?
6. Apakah Structured Concurrency cocok untuk seluruh operation?
7. Apakah notification boleh dilakukan dalam same request?
8. Bagaimana jika risk service timeout?
9. Bagaimana jika audit write gagal?
10. Apa yang harus masuk ke transaction?

### Jawaban Arah

Parallel read cocok untuk:

```text
load enforcement history
call risk scoring service
check outstanding payment
check open appeal
```

Tetapi update recommendation, audit event, dan notification bukan sekadar child read task.

Desain lebih aman:

```text
Request operation
├── Load case
├── Parallel read/evaluation fan-out
│   ├── Enforcement history
│   ├── Risk scoring
│   ├── Outstanding payment
│   └── Open appeal
├── Decide recommendation
├── Transaction:
│   ├── update recommendation
│   ├── insert audit event
│   └── insert notification outbox
└── Return response

Async durable worker / batch
└── send notification from outbox idempotently
```

Structured concurrency cocok untuk read/evaluation fan-out. Tidak cocok menggantikan durable outbox untuk notification.

---

## 30. Ringkasan

Structured Concurrency mengajarkan bahwa concurrency harus punya struktur:

- parent-child ownership,
- lexical lifetime,
- bounded child tasks,
- cancellation propagation,
- failure aggregation,
- observability shape.

Scoped Values mengajarkan bahwa context sebaiknya:

- immutable,
- scoped secara lexical,
- tidak mutable ambient global,
- tidak bergantung pada manual cleanup,
- cocok dengan virtual threads dan structured task tree.

Namun dalam Jakarta EE:

- managed lifecycle tetap penting,
- container context tidak otomatis sama dengan scoped value,
- transaction boundary tetap harus eksplisit,
- security identity tidak boleh dipalsukan oleh application context,
- durable workload tetap butuh Jakarta Batch/messaging/outbox/workflow,
- preview API harus diperlakukan hati-hati.

Kalimat kunci:

> Virtual threads membuat blocking murah. Structured Concurrency membuat parallel work punya bentuk. Scoped Values membuat context punya lifetime. Jakarta managed concurrency membuat semuanya tetap berada dalam kontrak container.

---

## 31. Referensi

- OpenJDK JEP 444 — Virtual Threads
- OpenJDK JEP 505 — Structured Concurrency, Fifth Preview
- OpenJDK JEP 506 — Scoped Values
- Jakarta Concurrency 3.1 Specification
- Jakarta EE 11 Platform Specification
- Java SE `CompletableFuture`, `ExecutorService`, `Future`, `ThreadLocal`
- Jakarta Concurrency `ManagedExecutorService`, `ContextService`, `ManagedThreadFactory`

---

## 32. Status Seri

Part ini adalah **Part 12** dari maksimal 35 part.

Seri **belum selesai**.

Part berikutnya:

```text
Part 13 — Concurrency Control: Capacity, Backpressure, Bulkheads, and Fairness
File: 13-concurrency-control-capacity-backpressure-bulkheads.md
```
