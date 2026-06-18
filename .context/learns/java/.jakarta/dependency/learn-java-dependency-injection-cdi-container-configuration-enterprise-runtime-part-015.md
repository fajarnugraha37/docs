# Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-015.md`  
> Status: Part 015 dari 035  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Tujuan Pembelajaran

Di part sebelumnya kita sudah membahas:

- CDI bean model.
- Bean discovery.
- Scope dan context.
- Client proxy.
- Qualifier, alternatives, specialization, priority.
- Producer/disposer.
- CDI events.

Sekarang kita masuk ke salah satu mekanisme paling penting di enterprise runtime: **interceptor**.

Tujuan part ini bukan sekadar tahu cara menulis:

```java
@AroundInvoke
public Object around(InvocationContext ctx) throws Exception {
    return ctx.proceed();
}
```

Melainkan memahami:

1. kenapa interceptor ada;
2. kapan interceptor lebih tepat daripada filter, decorator, event, helper, atau base class;
3. bagaimana interceptor bekerja lewat proxy/container;
4. bagaimana ordering ditentukan;
5. apa efeknya terhadap transaction, security, tracing, audit, retry, idempotency, dan feature gate;
6. kenapa self-invocation sering membuat interceptor tidak terpanggil;
7. bagaimana mendesain interceptor yang aman, observable, dan tidak menyembunyikan business logic.

---

## 1. Mental Model Utama

Interceptor adalah **runtime boundary** yang mengizinkan container menyisipkan behavior di sekitar invocation tertentu.

Secara sederhana:

```text
Caller
  |
  v
Client Proxy / Container Dispatch
  |
  v
Interceptor 1
  |
  v
Interceptor 2
  |
  v
Target Method
  |
  v
Return / Exception flows back through chain
```

Interceptor bukan sekadar “method dipanggil sebelum method lain”. Interceptor adalah mekanisme container untuk mengontrol perjalanan invocation.

Artinya, interceptor dapat:

- membaca method yang sedang dipanggil;
- membaca/mengubah parameter;
- menyimpan data di context invocation;
- memutus invocation sebelum target method dipanggil;
- memanggil target method;
- menangkap exception;
- membungkus return value;
- menjalankan logic setelah method selesai;
- membuat cross-cutting concern menjadi reusable.

Namun karena ia berada di jalur invocation, interceptor juga bisa menjadi sumber bug serius:

- hidden behavior;
- ordering yang salah;
- transaction boundary yang tidak sesuai;
- retry yang menggandakan side effect;
- logging PII;
- feature gate yang tidak konsisten;
- latency overhead;
- error yang sulit dibaca.

Top engineer melihat interceptor bukan sebagai “AOP magic”, tetapi sebagai **explicit runtime contract**.

---

## 2. Masalah yang Diselesaikan Interceptor

Dalam enterprise system, banyak behavior tidak benar-benar milik satu use case saja.

Contoh:

- audit log;
- metrics;
- tracing;
- authorization check;
- transaction demarcation;
- retry;
- timeout guard;
- idempotency;
- feature flag gate;
- input/output masking;
- correlation id propagation;
- rate limiting;
- compliance event capture.

Jika semua concern ini ditulis langsung di service method, maka business method menjadi penuh noise:

```java
public ApprovalResult approveCase(ApproveCaseCommand command) {
    long start = System.nanoTime();
    String correlationId = correlation.current();

    audit.start("approveCase", command.caseId());

    if (!featureFlags.enabled("case.approval")) {
        throw new FeatureDisabledException("case.approval");
    }

    if (!security.canApprove(command.caseId())) {
        throw new ForbiddenException();
    }

    try {
        tx.begin();
        ApprovalResult result = doApproval(command);
        tx.commit();
        audit.success("approveCase", command.caseId());
        metrics.record("approveCase", System.nanoTime() - start);
        return result;
    } catch (Exception e) {
        tx.rollback();
        audit.failure("approveCase", command.caseId(), e);
        metrics.recordFailure("approveCase");
        throw e;
    }
}
```

Kode di atas punya masalah:

1. business intent tenggelam;
2. setiap method rawan lupa audit/metrics/security;
3. cross-cutting policy tidak konsisten;
4. perubahan policy harus menyentuh banyak method;
5. test menjadi berat karena harus selalu membawa concern yang sama;
6. code review sulit membedakan domain logic dan infrastructural policy.

Dengan interceptor, method bisa menjadi:

```java
@Audited(action = "CASE_APPROVAL")
@Measured(name = "case.approve")
@FeatureGate("case.approval")
@RequiredPermission("CASE_APPROVE")
public ApprovalResult approveCase(ApproveCaseCommand command) {
    return approvalDomainService.approve(command);
}
```

Business method tetap jelas, sementara runtime boundary tetap eksplisit melalui annotation.

---

## 3. Interceptor vs Decorator vs Filter vs Event vs Helper

Interceptor sering disalahgunakan karena terlihat fleksibel. Untuk memilih dengan benar, gunakan mental model berikut.

| Mekanisme | Posisi | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|---|
| Interceptor | sekitar method invocation | audit, metrics, tracing, security, transaction-like wrapper, feature gate | domain branching kompleks |
| Decorator | membungkus business interface | semantic enrichment, alternative behavior, compliance wrapper | generic logging di semua method |
| Servlet/JAX-RS Filter | sekitar HTTP request/response | auth HTTP, CORS, headers, request logging | service-layer policy |
| CDI Event | setelah sesuatu terjadi | local notification, cache invalidation, loose coupling | mandatory precondition sebelum method |
| Helper/Utility | dipanggil manual | simple reusable operation | policy yang wajib konsisten di banyak boundary |
| Base Class | inheritance reuse | shared template dalam hierarchy stabil | cross-cutting concern lintas class berbeda |

Rule sederhana:

- Gunakan **filter** untuk boundary HTTP.
- Gunakan **interceptor** untuk boundary invocation method/container.
- Gunakan **decorator** untuk semantic wrapping berdasarkan interface bisnis.
- Gunakan **event** untuk notification setelah fakta terjadi.
- Gunakan **helper** untuk operasi biasa yang tidak perlu container semantics.

---

## 4. Jakarta Interceptors dan CDI

Jakarta Interceptors menyediakan programming model dasar untuk menyisipkan logic pada:

- business method invocation;
- lifecycle callback;
- timeout method, terutama dalam konteks Enterprise Beans.

CDI memperluas model ini dengan **type-safe interceptor binding**. Dengan CDI, kita tidak harus mengikat interceptor memakai string XML saja. Kita bisa membuat annotation binding seperti:

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    String action();
}
```

Lalu interceptor:

```java
@Audited(action = "")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        return ctx.proceed();
    }
}
```

Dan target:

```java
@Audited(action = "CASE_APPROVAL")
public ApprovalResult approveCase(ApproveCaseCommand command) {
    return approvalService.approve(command);
}
```

Namun contoh di atas sengaja belum sempurna. Ada detail penting: member `action()` biasanya perlu `@Nonbinding` jika value berbeda-beda tidak dimaksudkan menjadi bagian dari matching binding interceptor.

Versi yang lebih benar:

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    @Nonbinding
    String action();
}
```

Tanpa `@Nonbinding`, CDI dapat menganggap `@Audited(action = "CASE_APPROVAL")` dan `@Audited(action = "CASE_REJECTION")` sebagai binding berbeda. Itu sering membuat interceptor tidak match seperti yang diharapkan.

---

## 5. Vocabulary Utama

### 5.1 Interceptor Binding

Interceptor binding adalah annotation yang menjadi tanda bahwa suatu target method/class harus dilewati interceptor tertentu.

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Measured {
    @Nonbinding
    String value() default "";
}
```

Binding adalah kontrak deklaratif.

Target:

```java
@Measured("case.approve")
public ApprovalResult approveCase(ApproveCaseCommand command) {
    return approvalService.approve(command);
}
```

Interceptor:

```java
@Measured
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class MetricsInterceptor {
    @AroundInvoke
    public Object measure(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        try {
            return ctx.proceed();
        } finally {
            long elapsed = System.nanoTime() - start;
            // record metric
        }
    }
}
```

### 5.2 `@Interceptor`

Menandai class sebagai interceptor class.

```java
@Interceptor
public class MetricsInterceptor { }
```

Class ini bukan service biasa. Ia punya peran khusus dalam invocation chain.

### 5.3 `@AroundInvoke`

Menandai method yang membungkus business method invocation.

```java
@AroundInvoke
public Object around(InvocationContext ctx) throws Exception {
    return ctx.proceed();
}
```

Method ini biasanya:

- return `Object`;
- menerima `InvocationContext`;
- melempar `Exception`;
- memanggil `ctx.proceed()` untuk melanjutkan chain.

Jika tidak memanggil `proceed()`, target method tidak akan dijalankan.

### 5.4 `InvocationContext`

`InvocationContext` adalah object yang mengekspos informasi invocation.

Hal yang umumnya dipakai:

```java
ctx.getTarget();          // target object
ctx.getMethod();          // method yang dipanggil
ctx.getParameters();      // parameter saat ini
ctx.setParameters(args);  // ubah parameter
ctx.getContextData();     // map data antar interceptor
ctx.proceed();            // lanjut ke interceptor berikutnya / target method
```

Dalam Jakarta Interceptors 2.2 / CDI 4.1 era, ada juga peningkatan untuk mengakses interceptor binding dari `InvocationContext` pada API modern.

### 5.5 `@Priority`

`@Priority` sering dipakai untuk mengaktifkan sekaligus mengurutkan interceptor.

```java
@Interceptor
@Measured
@Priority(Interceptor.Priority.APPLICATION + 100)
public class MetricsInterceptor { }
```

Semakin kecil angka priority, semakin lebih awal biasanya interceptor berada dalam chain.

Namun jangan sekadar menghafal “angka kecil dulu”. Yang penting adalah mendesain ordering sebagai contract.

Contoh urutan yang masuk akal:

```text
1. Correlation / tracing context
2. Feature gate / permission precondition
3. Idempotency guard
4. Transaction boundary
5. Business method
6. Audit outcome
7. Metrics finalization
```

Tetapi urutan bisa berbeda tergantung sistem.

---

## 6. Basic Example: Metrics Interceptor

### 6.1 Binding Annotation

```java
package com.example.runtime.interceptor;

import jakarta.interceptor.InterceptorBinding;
import jakarta.enterprise.util.Nonbinding;

import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Measured {
    @Nonbinding
    String value() default "";
}
```

### 6.2 Interceptor Class

```java
package com.example.runtime.interceptor;

import jakarta.annotation.Priority;
import jakarta.interceptor.AroundInvoke;
import jakarta.interceptor.Interceptor;
import jakarta.interceptor.InvocationContext;

@Measured
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 100)
public class MetricsInterceptor {

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        long startNanos = System.nanoTime();
        boolean success = false;

        try {
            Object result = ctx.proceed();
            success = true;
            return result;
        } finally {
            long elapsedNanos = System.nanoTime() - startNanos;

            String className = ctx.getMethod().getDeclaringClass().getSimpleName();
            String methodName = ctx.getMethod().getName();

            // In real code, inject a metrics recorder instead of printing.
            System.out.printf(
                "method=%s.%s success=%s elapsedNanos=%d%n",
                className,
                methodName,
                success,
                elapsedNanos
            );
        }
    }
}
```

### 6.3 Target Bean

```java
@ApplicationScoped
public class CaseApprovalService {

    @Measured("case.approve")
    public ApprovalResult approve(ApproveCaseCommand command) {
        // business logic
        return ApprovalResult.approved(command.caseId());
    }
}
```

Key point:

- Annotation pada method membuat invocation eligible untuk interception.
- Interceptor berjalan hanya jika invocation melalui container/proxy path.
- Kalau object dibuat manual dengan `new CaseApprovalService()`, CDI interceptor tidak berjalan.

---

## 7. Interceptor Chain

Jika satu method punya banyak binding:

```java
@Traced
@Audited(action = "CASE_APPROVAL")
@Measured("case.approve")
@FeatureGate("case.approval")
public ApprovalResult approve(ApproveCaseCommand command) {
    return approvalDomainService.approve(command);
}
```

Maka runtime membangun chain:

```text
Caller
  -> Client Proxy
    -> TracingInterceptor
      -> FeatureGateInterceptor
        -> AuditInterceptor
          -> MetricsInterceptor
            -> Target Method
          <- Metrics finally
        <- Audit outcome
      <- FeatureGate return/exception
    <- Tracing span close
  <- Caller
```

Ordering penting karena hasil berbeda.

Contoh:

```text
FeatureGate before Audit:
  disabled feature tidak tercatat sebagai business attempt, kecuali audit interceptor ada di luar.

Audit before FeatureGate:
  disabled feature tetap tercatat sebagai rejected/blocked attempt.
```

Tidak ada ordering yang “selalu benar”. Yang benar adalah ordering yang sesuai policy.

Untuk regulatory/case-management system, biasanya attempt yang diblokir karena permission/feature juga perlu audit minimal.

---

## 8. `ctx.proceed()` Adalah Titik Kontrol

Interceptor punya kekuatan besar karena `ctx.proceed()` menentukan apakah chain lanjut.

### 8.1 Normal wrapper

```java
try {
    before();
    Object result = ctx.proceed();
    afterSuccess(result);
    return result;
} catch (Exception e) {
    afterFailure(e);
    throw e;
}
```

### 8.2 Short-circuit

```java
if (!enabled) {
    throw new FeatureDisabledException(featureName);
}
return ctx.proceed();
```

Target method tidak dipanggil saat feature disabled.

### 8.3 Fallback

```java
try {
    return ctx.proceed();
} catch (ExternalServiceUnavailableException e) {
    return fallbackValue();
}
```

Ini harus hati-hati. Fallback di interceptor dapat menyembunyikan kegagalan domain.

### 8.4 Retry

```java
int attempts = 0;
while (true) {
    try {
        attempts++;
        return ctx.proceed();
    } catch (TransientException e) {
        if (attempts >= 3) {
            throw e;
        }
    }
}
```

Retry hanya aman untuk operation yang idempotent atau memiliki idempotency guard.

---

## 9. Binding Member dan `@Nonbinding`

Ini salah satu jebakan paling umum.

Misalnya:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    String action();
}
```

Interceptor:

```java
@Audited(action = "")
@Interceptor
public class AuditInterceptor { }
```

Target:

```java
@Audited(action = "CASE_APPROVAL")
public ApprovalResult approve(...) { }
```

Dalam banyak kasus, ini tidak match karena `action = ""` dan `action = "CASE_APPROVAL"` dianggap binding berbeda.

Solusi:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    @Nonbinding
    String action();
}
```

Gunakan rule:

```text
Jika member annotation hanya konfigurasi untuk interceptor,
beri @Nonbinding.

Jika member annotation memang bagian dari identitas binding,
jangan beri @Nonbinding.
```

Contoh member yang biasanya `@Nonbinding`:

- metric name;
- audit action;
- feature flag key;
- retry count;
- timeout duration;
- permission code.

Contoh member yang mungkin binding:

- mode yang benar-benar menentukan interceptor berbeda;
- semantic category yang digunakan untuk memilih chain yang berbeda.

Namun untuk sebagian besar aplikasi, lebih aman membuat member sebagai `@Nonbinding` agar interceptor tunggal bisa membaca value-nya.

---

## 10. Membaca Annotation Binding di Runtime

Satu kebutuhan umum: interceptor ingin tahu value annotation di method/class.

Contoh:

```java
@Audited(action = "CASE_APPROVAL")
public ApprovalResult approve(...) { }
```

Interceptor ingin membaca `CASE_APPROVAL`.

Pendekatan portable umum:

```java
private Audited findAudited(InvocationContext ctx) {
    Audited onMethod = ctx.getMethod().getAnnotation(Audited.class);
    if (onMethod != null) {
        return onMethod;
    }

    Class<?> targetClass = ctx.getTarget().getClass();
    return targetClass.getAnnotation(Audited.class);
}
```

Namun hati-hati: `ctx.getTarget().getClass()` dapat berupa class proxy/subclass tergantung provider. Kadang perlu melihat declaring class atau hierarchy.

Contoh lebih defensif:

```java
private Audited findAudited(InvocationContext ctx) {
    Audited methodAnnotation = ctx.getMethod().getAnnotation(Audited.class);
    if (methodAnnotation != null) {
        return methodAnnotation;
    }

    Class<?> declaringClass = ctx.getMethod().getDeclaringClass();
    Audited classAnnotation = declaringClass.getAnnotation(Audited.class);
    if (classAnnotation != null) {
        return classAnnotation;
    }

    Object target = ctx.getTarget();
    if (target != null) {
        return target.getClass().getAnnotation(Audited.class);
    }

    return null;
}
```

Di API modern Jakarta Interceptors 2.2 ada improvement terkait akses interceptor binding dari `InvocationContext`, namun tetap pahami fallback reflection karena sistem legacy sering masih berada di Java EE/Jakarta EE versi lama.

---

## 11. Class-Level vs Method-Level Binding

Binding bisa diletakkan di class:

```java
@Audited(action = "CASE_SERVICE")
@ApplicationScoped
public class CaseApprovalService {

    public ApprovalResult approve(...) { }

    public RejectionResult reject(...) { }
}
```

Atau method:

```java
@ApplicationScoped
public class CaseApprovalService {

    @Audited(action = "CASE_APPROVAL")
    public ApprovalResult approve(...) { }

    @Audited(action = "CASE_REJECTION")
    public RejectionResult reject(...) { }
}
```

Class-level cocok jika semua method punya policy sama.

Method-level cocok jika tiap operation punya semantic berbeda.

Dalam sistem regulatori, biasanya audit action harus method-level karena setiap action punya arti hukum/operasional berbeda.

---

## 12. Self-Invocation Problem

Ini salah satu jebakan paling penting.

```java
@ApplicationScoped
public class CaseService {

    public void outer() {
        inner();
    }

    @Audited(action = "INNER")
    public void inner() {
        // logic
    }
}
```

Ketika `outer()` memanggil `inner()` memakai `this.inner()`, invocation tidak melewati proxy/container. Akibatnya interceptor pada `inner()` bisa tidak berjalan.

Alurnya:

```text
External caller
  -> CDI proxy
    -> outer()
       -> this.inner()   // direct Java call, bypass proxy
```

Bukan:

```text
External caller
  -> CDI proxy
    -> outer()
       -> CDI proxy
          -> interceptor
             -> inner()
```

Solusi desain:

### 12.1 Pisahkan method ke bean lain

```java
@ApplicationScoped
public class CaseWorkflowService {

    @Inject
    CaseAuditOperation auditOperation;

    public void outer() {
        auditOperation.inner();
    }
}

@ApplicationScoped
public class CaseAuditOperation {

    @Audited(action = "INNER")
    public void inner() {
        // logic
    }
}
```

Ini solusi paling bersih.

### 12.2 Inject self-proxy dengan hati-hati

```java
@ApplicationScoped
public class CaseService {

    @Inject
    CaseService self;

    public void outer() {
        self.inner();
    }

    @Audited(action = "INNER")
    public void inner() { }
}
```

Ini bisa bekerja dalam beberapa container, tapi sering dianggap smell karena dependency ke diri sendiri membingungkan dan dapat memicu circular/proxy issue.

### 12.3 Jadikan interceptor pada `outer()`

Jika policy sebenarnya untuk seluruh operation `outer()`, letakkan annotation di `outer()`.

---

## 13. Interceptor dan Proxyability

Karena interceptor biasanya bekerja lewat proxy/container dispatch, aturan proxy dari part 011 tetap penting.

Masalah umum:

- class final;
- method final;
- private method;
- static method;
- object dibuat dengan `new`;
- method dipanggil internal via `this`;
- bean tidak discoverable;
- method tidak berada pada bean yang dikelola CDI/container.

Contoh yang tidak cocok:

```java
@ApplicationScoped
public final class CaseService {
    @Audited(action = "APPROVE")
    public ApprovalResult approve(...) { }
}
```

Final class dapat membuat provider tidak bisa membuat proxy subclass.

Contoh lain:

```java
@Audited(action = "APPROVE")
private ApprovalResult approveInternal(...) { }
```

Private method bukan boundary container invocation normal.

Rule:

```text
Interceptor bekerja pada managed invocation boundary,
bukan pada semua Java method call.
```

---

## 14. Interceptor untuk Audit

Audit adalah use case populer, tetapi harus didesain hati-hati.

### 14.1 Binding

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    @Nonbinding
    String action();

    @Nonbinding
    AuditLevel level() default AuditLevel.BUSINESS;
}
```

```java
public enum AuditLevel {
    TECHNICAL,
    BUSINESS,
    REGULATORY
}
```

### 14.2 Interceptor

```java
@Audited(action = "")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 200)
public class AuditInterceptor {

    @Inject
    AuditSink auditSink;

    @Inject
    CurrentUser currentUser;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        Audited audited = findAudited(ctx);
        String action = audited != null ? audited.action() : ctx.getMethod().getName();

        AuditRecord.Builder record = AuditRecord.builder()
            .action(action)
            .actor(currentUser.idOrSystem())
            .method(ctx.getMethod().toGenericString())
            .startedAt(Instant.now());

        try {
            Object result = ctx.proceed();
            auditSink.success(record.finishedAt(Instant.now()).build());
            return result;
        } catch (Exception e) {
            auditSink.failure(
                record.finishedAt(Instant.now())
                    .exceptionType(e.getClass().getName())
                    .build()
            );
            throw e;
        }
    }

    private Audited findAudited(InvocationContext ctx) {
        Audited onMethod = ctx.getMethod().getAnnotation(Audited.class);
        if (onMethod != null) return onMethod;
        return ctx.getMethod().getDeclaringClass().getAnnotation(Audited.class);
    }
}
```

### 14.3 Audit Design Warnings

Jangan asal serialize semua parameter:

```java
Arrays.toString(ctx.getParameters())
```

Ini berbahaya karena bisa membocorkan:

- password;
- token;
- PII;
- dokumen;
- payload besar;
- data rahasia investigasi;
- data sebelum masking.

Gunakan audit extractor eksplisit atau annotation tambahan:

```java
@Audited(action = "CASE_APPROVAL")
public ApprovalResult approve(@AuditKey("caseId") ApproveCaseCommand command) { }
```

Atau desain command interface:

```java
public interface AuditableCommand {
    Map<String, String> auditAttributes();
}
```

Lalu interceptor hanya membaca field aman.

---

## 15. Interceptor untuk Feature Gate

Feature flag bisa diterapkan di application service boundary.

### 15.1 Binding

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface FeatureGate {
    @Nonbinding
    String value();

    @Nonbinding
    FailureMode failureMode() default FailureMode.THROW;
}
```

```java
public enum FailureMode {
    THROW,
    RETURN_DEFAULT,
    FALLBACK
}
```

### 15.2 Interceptor

```java
@FeatureGate("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 50)
public class FeatureGateInterceptor {

    @Inject
    FeatureFlagService featureFlags;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        FeatureGate gate = findGate(ctx);
        if (gate == null) {
            return ctx.proceed();
        }

        boolean enabled = featureFlags.isEnabled(gate.value(), evaluationContext(ctx));
        if (!enabled) {
            throw new FeatureDisabledException(gate.value());
        }

        return ctx.proceed();
    }

    private FeatureGate findGate(InvocationContext ctx) {
        FeatureGate onMethod = ctx.getMethod().getAnnotation(FeatureGate.class);
        if (onMethod != null) return onMethod;
        return ctx.getMethod().getDeclaringClass().getAnnotation(FeatureGate.class);
    }

    private FeatureEvaluationContext evaluationContext(InvocationContext ctx) {
        return FeatureEvaluationContext.builder()
            .method(ctx.getMethod().toGenericString())
            .build();
    }
}
```

### 15.3 Feature Gate Ordering

Feature gate harus ditempatkan dengan sengaja.

Jika sebelum audit:

```text
Feature disabled -> no audit unless feature gate logs separately
```

Jika setelah audit:

```text
Feature disabled -> audit sees blocked attempt
```

Untuk regulated workflow, sering lebih aman:

```text
Correlation -> Audit Attempt -> Feature Gate -> Permission -> Idempotency -> Business
```

Agar attempt yang ditolak tetap punya trace.

---

## 16. Interceptor untuk Idempotency

Idempotency cocok sebagai interceptor jika idempotency key dapat ditentukan dari invocation.

### 16.1 Binding

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface IdempotentOperation {
    @Nonbinding
    String namespace();
}
```

### 16.2 Command Contract

```java
public interface IdempotentCommand {
    String idempotencyKey();
}
```

### 16.3 Interceptor

```java
@IdempotentOperation(namespace = "")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 120)
public class IdempotencyInterceptor {

    @Inject
    IdempotencyStore store;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        IdempotentOperation op = findAnnotation(ctx);
        String key = resolveKey(op, ctx.getParameters());

        Optional<Object> existing = store.findCompleted(key);
        if (existing.isPresent()) {
            return existing.get();
        }

        store.markInProgress(key);
        try {
            Object result = ctx.proceed();
            store.markCompleted(key, result);
            return result;
        } catch (Exception e) {
            store.markFailed(key, e);
            throw e;
        }
    }

    private String resolveKey(IdempotentOperation op, Object[] parameters) {
        for (Object parameter : parameters) {
            if (parameter instanceof IdempotentCommand command) {
                return op.namespace() + ":" + command.idempotencyKey();
            }
        }
        throw new IllegalStateException("No IdempotentCommand parameter found");
    }

    private IdempotentOperation findAnnotation(InvocationContext ctx) {
        IdempotentOperation onMethod = ctx.getMethod().getAnnotation(IdempotentOperation.class);
        if (onMethod != null) return onMethod;
        return ctx.getMethod().getDeclaringClass().getAnnotation(IdempotentOperation.class);
    }
}
```

### 16.4 Warning

Idempotency di interceptor sangat kuat tetapi berisiko:

- result mungkin tidak serializable;
- transaction boundary harus jelas;
- failure state harus recoverable;
- concurrency race harus dikunci;
- key harus stable;
- idempotency record harus punya TTL/retention.

Interceptor hanya membungkus invocation. Ia tidak otomatis menyelesaikan distributed consistency.

---

## 17. Interceptor untuk Retry

Retry sering menggoda, tetapi berbahaya.

Retry aman jika:

- operation idempotent;
- exception benar-benar transient;
- ada batas attempt;
- ada backoff;
- tidak menggandakan side effect;
- transaction boundary dipahami;
- metrics mencatat attempt.

Contoh sederhana:

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RetryableOperation {
    @Nonbinding
    int maxAttempts() default 3;

    @Nonbinding
    long backoffMillis() default 100;
}
```

```java
@RetryableOperation
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 300)
public class RetryInterceptor {

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        RetryableOperation retry = findRetry(ctx);
        int maxAttempts = retry != null ? retry.maxAttempts() : 1;
        long backoffMillis = retry != null ? retry.backoffMillis() : 0;

        int attempt = 0;
        while (true) {
            try {
                attempt++;
                return ctx.proceed();
            } catch (Exception e) {
                if (!isTransient(e) || attempt >= maxAttempts) {
                    throw e;
                }
                sleep(backoffMillis);
            }
        }
    }

    private boolean isTransient(Exception e) {
        return e instanceof TransientExternalServiceException;
    }

    private void sleep(long millis) throws InterruptedException {
        if (millis > 0) {
            Thread.sleep(millis);
        }
    }

    private RetryableOperation findRetry(InvocationContext ctx) {
        RetryableOperation onMethod = ctx.getMethod().getAnnotation(RetryableOperation.class);
        if (onMethod != null) return onMethod;
        return ctx.getMethod().getDeclaringClass().getAnnotation(RetryableOperation.class);
    }
}
```

Problem: `Thread.sleep()` di managed runtime bisa tidak ideal. Untuk production, gunakan library/runtime resilience yang sesuai, misalnya MicroProfile Fault Tolerance di ekosistem MicroProfile, atau desain async/backoff melalui executor yang managed.

Jangan melakukan retry pada method yang:

- membuat payment;
- mengirim email tanpa idempotency key;
- membuat audit record irreversible;
- mengubah state workflow tanpa optimistic lock/idempotency;
- memanggil external API non-idempotent.

---

## 18. Interceptor dan Transaction Boundary

Transaction interceptor sering sudah disediakan platform, misalnya melalui Jakarta Transactions atau Enterprise Beans container-managed transaction.

Pertanyaan penting: custom interceptor berjalan di dalam atau di luar transaction?

Misalnya chain:

```text
AuditInterceptor
  -> TransactionInterceptor
    -> Business Method
```

Audit attempt terjadi sebelum transaction.

Sedangkan:

```text
TransactionInterceptor
  -> AuditInterceptor
    -> Business Method
```

Audit ikut dalam transaction.

Konsekuensi:

- Jika audit ikut transaction dan transaction rollback, audit mungkin ikut rollback.
- Jika audit di luar transaction, audit bisa mencatat attempt walau business rollback.
- Jika audit sink sendiri memakai transaction baru, ordering dan consistency harus jelas.

Untuk regulatory audit, sering dibutuhkan audit yang tidak hilang saat business transaction rollback. Tapi itu berarti audit harus dirancang sebagai outbox, independent durable log, atau transaction terpisah dengan semantics yang jelas.

Jangan menganggap `@Audited` otomatis “benar” secara compliance. Yang benar adalah desain transaction/audit semantics-nya.

---

## 19. Interceptor dan Exception Semantics

Interceptor dapat mengubah exception.

Contoh buruk:

```java
try {
    return ctx.proceed();
} catch (Exception e) {
    throw new RuntimeException("Failed");
}
```

Masalah:

- original exception hilang;
- transaction rollback rule bisa berubah;
- API error mapping berubah;
- troubleshooting sulit;
- caller contract rusak.

Lebih baik:

```java
try {
    return ctx.proceed();
} catch (BusinessException e) {
    recordBusinessFailure(e);
    throw e;
} catch (Exception e) {
    recordTechnicalFailure(e);
    throw e;
}
```

Jika perlu wrapping:

```java
throw new RuntimeInvocationException("Invocation failed", e);
```

Jaga cause chain.

---

## 20. Interceptor dan Security

Security check bisa dibuat interceptor, tetapi harus hati-hati membedakan:

- authentication;
- authorization;
- permission evaluation;
- data-level access control;
- workflow state authorization.

Contoh binding:

```java
@Inherited
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiredPermission {
    @Nonbinding
    String value();
}
```

Interceptor:

```java
@RequiredPermission("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 80)
public class PermissionInterceptor {

    @Inject
    PermissionService permissions;

    @Inject
    CurrentUser currentUser;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        RequiredPermission required = findRequiredPermission(ctx);
        if (required == null) {
            return ctx.proceed();
        }

        if (!permissions.has(currentUser.id(), required.value())) {
            throw new ForbiddenOperationException(required.value());
        }

        return ctx.proceed();
    }
}
```

Ini cocok untuk permission coarse-grained.

Namun untuk authorization yang tergantung data:

```text
User can approve this specific case only if:
- user belongs to agency X;
- case status is PENDING_REVIEW;
- user is not creator;
- threshold below delegation limit;
- no conflict of interest.
```

Jangan paksakan semuanya ke generic interceptor. Data-level policy sering lebih tepat berada di application service/domain policy.

Rule:

```text
Interceptor cocok untuk policy yang bisa dievaluasi dari invocation boundary.
Domain policy tetap harus berada di domain/application layer.
```

---

## 21. Interceptor dan Observability

Karena interceptor berada di semua method yang diberi binding, ia cocok untuk observability.

Namun desain metric/tag harus hati-hati.

Jangan membuat tag high-cardinality:

```text
metric: case.approve
labels:
  caseId=123456789   // buruk, cardinality tinggi
  userId=U12345      // buruk untuk metric umum
```

Lebih baik:

```text
metric: application_method_duration
labels:
  operation=case.approve
  outcome=success|failure
  exception=BusinessRuleViolation|None
```

Tracing boleh membawa correlation lebih detail, tapi PII tetap harus dimask.

---

## 22. Interceptor and `ctx.getContextData()`

`InvocationContext.getContextData()` menyediakan map untuk berbagi data antar interceptor dalam chain invocation yang sama.

Contoh:

```java
@AroundInvoke
public Object around(InvocationContext ctx) throws Exception {
    String correlationId = correlation.currentOrCreate();
    ctx.getContextData().put("correlationId", correlationId);
    return ctx.proceed();
}
```

Interceptor lain:

```java
String correlationId = (String) ctx.getContextData().get("correlationId");
```

Gunakan namespace key yang aman:

```java
private static final String KEY_CORRELATION_ID =
    "com.example.runtime.correlationId";
```

Jangan gunakan key terlalu generik seperti:

```text
id
user
data
context
```

Karena bisa collision.

---

## 23. Lifecycle Interceptors

Selain business method, Jakarta Interceptors juga mendukung lifecycle callback interception.

Contoh konsep:

```java
@PostConstruct
public void init() { }

@PreDestroy
public void destroy() { }
```

Interceptor lifecycle dapat digunakan untuk:

- initialization tracking;
- resource validation;
- startup metrics;
- cleanup monitoring.

Namun jangan memasukkan heavy business logic ke lifecycle interceptor. Lifecycle phase sering terjadi saat deployment/startup/shutdown, bukan request biasa.

Failure di lifecycle interceptor bisa menggagalkan deployment atau membuat shutdown tidak bersih.

---

## 24. Timeout Interception dan Enterprise Beans

Dalam konteks Enterprise Beans, interceptor juga dapat berlaku pada timeout method/timer.

Ini berguna untuk:

- audit scheduled job;
- measure timer execution;
- prevent overlapping job;
- job correlation id;
- failure alert.

Namun timer semantics berbeda dari HTTP/request invocation:

- tidak selalu ada user;
- security principal bisa system;
- transaction boundary bisa container-managed;
- retry scheduler bisa berinteraksi dengan retry interceptor;
- cluster/failover dapat memicu behavior khusus.

Karena itu interceptor untuk timer harus eksplisit mendukung actor `SYSTEM` dan job identity.

---

## 25. Enabling Interceptors: `@Priority` vs `beans.xml`

Ada dua model umum:

### 25.1 `@Priority`

```java
@Audited(action = "")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION + 200)
public class AuditInterceptor { }
```

Kelebihan:

- dekat dengan code;
- mudah dibaca;
- cocok untuk modern CDI;
- auto-enabled.

Kekurangan:

- ordering tersebar di annotation;
- environment-specific enabling lebih sulit;
- angka priority bisa menjadi magic number.

### 25.2 `beans.xml`

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
    <interceptors>
        <class>com.example.runtime.AuditInterceptor</class>
        <class>com.example.runtime.MetricsInterceptor</class>
    </interceptors>
</beans>
```

Kelebihan:

- ordering eksplisit dalam satu tempat;
- bisa berbeda per deployment;
- cocok untuk legacy Java EE/CDI.

Kekurangan:

- XML drift;
- class rename bisa tidak ketahuan sampai runtime;
- lebih sulit untuk modular library.

Modern practice: gunakan `@Priority` untuk interceptor application-wide yang stabil, tetapi dokumentasikan ordering constants dengan jelas.

Contoh:

```java
public final class RuntimeInterceptorPriority {
    private RuntimeInterceptorPriority() { }

    public static final int CORRELATION = Interceptor.Priority.APPLICATION + 10;
    public static final int AUDIT_ATTEMPT = Interceptor.Priority.APPLICATION + 20;
    public static final int FEATURE_GATE = Interceptor.Priority.APPLICATION + 30;
    public static final int PERMISSION = Interceptor.Priority.APPLICATION + 40;
    public static final int IDEMPOTENCY = Interceptor.Priority.APPLICATION + 50;
    public static final int METRICS = Interceptor.Priority.APPLICATION + 900;
}
```

---

## 26. Designing Interceptor Binding Annotations

Annotation design menentukan readability sistem.

Bad:

```java
@Check
@Log
@DoIt
@Handle
public void approve(...) { }
```

Good:

```java
@Audited(action = "CASE_APPROVAL")
@Measured("case.approve")
@RequiredPermission("CASE_APPROVE")
@FeatureGate("case.approval")
public ApprovalResult approve(...) { }
```

Principles:

1. Binding name harus menjelaskan policy.
2. Member annotation harus typed jika memungkinkan.
3. Value harus stable, bukan string asal.
4. Gunakan enum jika domain kecil dan stabil.
5. Gunakan string jika key berasal dari external config/feature flag registry.
6. Beri `@Nonbinding` untuk member konfigurasi.
7. Jangan membuat annotation yang terlalu generic.
8. Jangan meletakkan semua policy dalam satu annotation monster.

Bad annotation monster:

```java
@RuntimePolicy(
    audit = true,
    metric = true,
    permission = "CASE_APPROVE",
    feature = "case.approval",
    retry = 3,
    transaction = true
)
```

Lebih baik composable:

```java
@Audited(action = "CASE_APPROVAL")
@Measured("case.approve")
@RequiredPermission("CASE_APPROVE")
@FeatureGate("case.approval")
```

---

## 27. When Interceptor Becomes Dangerous

Interceptor menjadi dangerous ketika:

### 27.1 Menyembunyikan business decision

Bad:

```java
@ApproveCasePolicy
public ApprovalResult approve(...) { }
```

Jika `@ApproveCasePolicy` diam-diam memutuskan apakah case boleh approve berdasarkan status domain, reviewer tidak melihat business rule di service/domain layer.

### 27.2 Mengubah return value diam-diam

Bad:

```java
catch (Exception e) {
    return DefaultResult.success();
}
```

### 27.3 Melakukan I/O berat untuk semua method

Audit/logging/tracing yang tidak bounded bisa menambah latency besar.

### 27.4 Menggunakan reflection berlebihan per call

Membaca annotation dengan reflection per invocation bisa acceptable untuk banyak aplikasi, tetapi untuk hot path, cache metadata.

Contoh cache:

```java
private final ConcurrentMap<Method, AuditMetadata> cache = new ConcurrentHashMap<>();

private AuditMetadata metadataFor(Method method) {
    return cache.computeIfAbsent(method, this::inspectMethod);
}
```

### 27.5 Menangkap `Throwable`

Biasanya jangan:

```java
catch (Throwable t) { ... }
```

Karena `Error` seperti `OutOfMemoryError` bukan business failure biasa.

### 27.6 Mengubah parameter tanpa kontrak jelas

`ctx.setParameters()` bisa kuat, tetapi rawan membuat debugging sulit.

Gunakan hanya untuk concern yang benar-benar jelas, misalnya normalisasi input teknis yang disepakati. Jangan diam-diam mengubah command bisnis.

---

## 28. Testing Interceptors

Testing interceptor punya beberapa level.

### 28.1 Unit test pure method

Test logic helper yang dipakai interceptor.

```java
class FeatureGatePolicyTest {
    @Test
    void disabledFeatureBlocksInvocation() { }
}
```

### 28.2 Unit test interceptor dengan fake `InvocationContext`

Buat fake context sederhana.

```java
final class FakeInvocationContext implements InvocationContext {
    private final Callable<Object> action;

    FakeInvocationContext(Callable<Object> action) {
        this.action = action;
    }

    @Override
    public Object proceed() throws Exception {
        return action.call();
    }

    // implement methods needed by test
}
```

Cocok untuk testing:

- proceed called once;
- exception rethrown;
- fallback behavior;
- context data;
- metrics recorded.

### 28.3 Container test

Dibutuhkan untuk memastikan:

- binding match;
- interceptor enabled;
- ordering benar;
- self-invocation behavior benar;
- CDI injection ke interceptor berjalan;
- proxy semantics sesuai.

Gunakan runtime test sesuai stack:

- Weld JUnit untuk CDI unit/container ringan;
- Arquillian-style untuk app server legacy;
- Quarkus test jika memakai Quarkus/ArC;
- Open Liberty/WildFly/Payara integration test untuk behavior server.

### 28.4 Negative tests

Test bahwa interceptor tidak terpanggil jika:

- method tidak diberi annotation;
- object dibuat manual;
- self-invocation;
- bean tidak discoverable.

Ini penting agar tim tidak salah asumsi.

---

## 29. Performance Model

Interceptor menambah overhead karena:

- proxy dispatch;
- chain invocation;
- reflection metadata lookup;
- allocation context data;
- logging/metrics sink;
- exception handling;
- serialization/masking.

Untuk enterprise business service, overhead ini biasanya kecil dibanding DB/network I/O.

Namun untuk hot path sangat sering dipanggil, desain perlu hati-hati:

- cache annotation metadata;
- hindari string formatting jika log disabled;
- hindari serialize parameter besar;
- gunakan async/non-blocking sink jika cocok;
- batasi tag cardinality;
- jangan melakukan remote call di interceptor umum;
- ukur overhead dengan benchmark realistis.

Rule:

```text
Interceptor boleh ada di business boundary.
Jangan asal letakkan interceptor berat pada method granular yang dipanggil ribuan kali dalam satu request.
```

---

## 30. Real-World Example: Regulatory Case Approval Boundary

Bayangkan operation:

```java
@ApplicationScoped
public class EnforcementApprovalService {

    @Traced("enforcement.case.approve")
    @Audited(action = "ENFORCEMENT_CASE_APPROVAL", level = AuditLevel.REGULATORY)
    @Measured("enforcement.case.approve")
    @FeatureGate("enforcement.approval.v2")
    @RequiredPermission("ENFORCEMENT_CASE_APPROVE")
    @IdempotentOperation(namespace = "enforcement-case-approval")
    public ApprovalResult approve(ApproveEnforcementCaseCommand command) {
        return workflow.approve(command);
    }
}
```

Possible chain:

```text
CorrelationInterceptor
  -> TracingInterceptor
    -> AuditAttemptInterceptor
      -> FeatureGateInterceptor
        -> PermissionInterceptor
          -> IdempotencyInterceptor
            -> TransactionInterceptor
              -> Target approve()
            <- transaction commit/rollback
          <- idempotency record complete/failure
        <- permission result
      <- feature result
    <- audit outcome
  <- tracing close
<- metrics finalize
```

Design questions:

1. Apakah blocked permission harus diaudit?
2. Apakah feature disabled harus diaudit?
3. Apakah idempotency record harus dibuat sebelum atau setelah permission?
4. Apakah audit success harus menunggu transaction commit?
5. Apakah audit failure harus tetap ditulis walau transaction rollback?
6. Apakah metrics mengukur full chain atau hanya business method?
7. Apakah tracing span mencakup retry attempts?
8. Apakah command boleh diserialisasi ke audit?
9. Apakah error domain dan error technical dibedakan?
10. Apakah operation idempotent terhadap double click/retry API gateway?

Top engineer tidak hanya menaruh annotation. Ia menjawab pertanyaan semantics di atas.

---

## 31. Failure Model

### 31.1 Interceptor tidak terpanggil

Kemungkinan:

- bean tidak managed;
- method dipanggil via `this`;
- interceptor tidak enabled;
- binding annotation salah package (`javax` vs `jakarta`);
- binding member lupa `@Nonbinding`;
- method private/final;
- class final/unproxyable;
- `beans.xml` discovery mode tidak menemukan bean;
- invocation dari constructor/lifecycle phase tertentu;
- menggunakan implementation class yang bypass proxy.

### 31.2 Ambiguous/unsatisfied dependency di interceptor

Interceptor sendiri bisa punya injection.

```java
@Inject
AuditSink auditSink;
```

Jika `AuditSink` ambiguous, deployment bisa gagal.

### 31.3 Ordering salah

Gejala:

- audit tidak mencatat blocked operation;
- metrics tidak mencatat failure;
- feature gate berjalan setelah side effect;
- retry terjadi di dalam transaction yang sama;
- permission check terjadi setelah expensive work.

### 31.4 Exception berubah

Gejala:

- HTTP response berubah;
- transaction rollback tidak sesuai;
- caller menerima generic error;
- original cause hilang.

### 31.5 Performance degradation

Gejala:

- latency naik semua endpoint;
- log volume meledak;
- metric cardinality tinggi;
- audit sink bottleneck;
- reflection overhead di hot method.

---

## 32. Checklist Desain Interceptor

Sebelum membuat interceptor baru, jawab:

1. Apakah concern ini benar-benar cross-cutting?
2. Apakah ia harus terjadi di method invocation boundary?
3. Apakah lebih cocok filter, decorator, event, atau explicit service?
4. Apakah annotation binding jelas dan domain-readable?
5. Apakah member annotation perlu `@Nonbinding`?
6. Apakah target method managed bean dan proxyable?
7. Apakah ordering sudah didefinisikan?
8. Apakah exception semantics jelas?
9. Apakah transaction semantics jelas?
10. Apakah data sensitif tidak bocor?
11. Apakah performance overhead bounded?
12. Apakah self-invocation sudah dihindari?
13. Apakah behavior testable di unit dan container test?
14. Apakah failure mode terdokumentasi?
15. Apakah ada observability untuk interceptor itu sendiri?

---

## 33. Anti-Patterns

### 33.1 Annotation as Magic Spell

```java
@Audited
@Secure
@Measured
@Handled
@Magic
public void approve() { }
```

Tanpa semantics jelas, annotation hanya menjadi noise.

### 33.2 Business Rule Hidden in Interceptor

Jika rule menentukan validitas domain state, jangan sembunyikan di interceptor generic.

### 33.3 Catch-All Error Handler

Interceptor yang menangkap semua exception dan mengubahnya menjadi generic result merusak contract.

### 33.4 Logging All Parameters

Berbahaya untuk PII, secrets, payload besar, dan compliance.

### 33.5 Retry Everything

Retry tanpa idempotency adalah bug generator.

### 33.6 Priority Numbers Everywhere

Gunakan constants dan dokumentasi ordering.

### 33.7 Interceptor for Every Small Thing

Tidak semua concern perlu annotation/runtime chain. Kadang explicit method call lebih jelas.

---

## 34. Java 8 sampai Java 25 Considerations

### 34.1 Java 8 Era

Banyak sistem masih memakai:

```java
javax.interceptor.*
javax.enterprise.*
javax.annotation.*
```

CDI/EJB berada dalam Java EE / Jakarta EE server legacy.

### 34.2 Java 11/17 Migration

Mulai muncul isu:

- module access;
- reflective access warning/error;
- server compatibility;
- namespace migration;
- old library dependency.

### 34.3 Java 21/25 Era

Pertimbangan modern:

- virtual threads tidak otomatis mengubah semantics CDI interceptor;
- ThreadLocal-based correlation/security context perlu hati-hati;
- observability semakin penting;
- startup-time optimization pada runtime seperti Quarkus dapat memproses metadata lebih awal;
- reflection/proxy behavior dipengaruhi build-time augmentation pada beberapa framework.

Jangan asumsikan semua runtime Jakarta EE klasik dan cloud-native CDI runtime punya behavior optimasi yang sama. Portable semantics tetap di spec, tetapi implementation strategy bisa berbeda.

---

## 35. Ringkasan Mental Model

Interceptor adalah:

```text
container-managed invocation wrapper
```

Bukan:

```text
magic method listener untuk semua Java call
```

Interceptor bekerja jika:

- target adalah managed component/bean;
- invocation melewati container/proxy;
- interceptor binding match;
- interceptor enabled;
- type/method proxyable;
- ordering benar.

Interceptor cocok untuk:

- audit;
- metrics;
- tracing;
- coarse permission;
- feature gate;
- idempotency boundary;
- retry/fault wrapper dengan constraint ketat;
- lifecycle/timeout observation.

Interceptor tidak cocok untuk:

- menyembunyikan domain rule kompleks;
- mengubah business result diam-diam;
- heavy remote operation di semua method;
- generic catch-all error swallowing;
- retry non-idempotent side effects;
- mengganti desain boundary yang buruk.

---

## 36. Latihan Praktis

### Latihan 1 — Audit Binding

Buat:

- `@Audited(action = ...)`;
- `AuditInterceptor`;
- `AuditSink` fake;
- service method `approveCase()`.

Pastikan:

- success tercatat;
- failure tercatat;
- exception tetap dilempar;
- parameter sensitif tidak diserialisasi otomatis.

### Latihan 2 — Self-Invocation

Buat bean:

```java
public void outer() { inner(); }

@Measured
public void inner() { }
```

Buktikan interceptor tidak terpanggil saat `outer()` memanggil `inner()` secara langsung.

Lalu refactor `inner()` ke bean lain.

### Latihan 3 — Feature Gate Ordering

Buat chain:

- audit;
- feature gate;
- metrics.

Ubah priority dan amati apakah disabled feature tercatat audit atau tidak.

### Latihan 4 — Retry Danger

Buat method yang menambahkan record ke list/database simulasi lalu gagal transient.

Tambahkan retry interceptor.

Amati side effect dobel.

Tambahkan idempotency key untuk memperbaiki.

---

## 37. Review Questions

1. Apa perbedaan interceptor dan decorator?
2. Mengapa self-invocation membuat interceptor tidak berjalan?
3. Apa fungsi `@Nonbinding` pada interceptor binding member?
4. Apa risiko melakukan retry di interceptor?
5. Mengapa audit interceptor harus memperhatikan transaction boundary?
6. Mengapa logging semua parameter invocation berbahaya?
7. Apa bedanya class-level binding dan method-level binding?
8. Kapan `@Priority` lebih baik daripada `beans.xml`?
9. Apa yang terjadi jika interceptor tidak memanggil `ctx.proceed()`?
10. Bagaimana mendesain ordering untuk audit, feature gate, permission, idempotency, transaction, dan metrics?

---

## 38. Mini Cheat Sheet

```text
Interceptor = around method invocation boundary.
Binding = annotation that connects target and interceptor.
@AroundInvoke = method wrapper.
InvocationContext = invocation metadata + proceed control.
@Nonbinding = annotation member is config, not binding identity.
@Priority = enable/order interceptor.
Self-invocation = bypass proxy, interceptor may not run.
Do not log all parameters.
Do not retry non-idempotent operation.
Do not hide domain rules inside generic interceptor.
```

---

## 39. Koneksi ke Part Berikutnya

Part ini membahas interceptor sebagai cross-cutting invocation wrapper.

Part berikutnya akan membahas **decorator**.

Perbedaan besar:

```text
Interceptor:
  Generic cross-cutting behavior around method invocation.

Decorator:
  Semantic wrapping of business interface implementation.
```

Decorator lebih dekat ke pattern object composition dan business interface, sedangkan interceptor lebih dekat ke runtime policy boundary.

---

## 40. Status Seri

Selesai:

- Part 000 — Orientation: Enterprise Runtime Mental Model
- Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
- Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
- Part 003 — Java EE to Jakarta EE Migration Model: `javax.*` to `jakarta.*`
- Part 004 — Runtime / Container Model: Who Owns Your Object?
- Part 005 — Classloaders, Modules, and Deployment Isolation
- Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
- Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
- Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
- Part 009 — Bean Discovery and Archive Model
- Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
- Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
- Part 012 — Qualifiers, Alternatives, Specialization, and Priority
- Part 013 — Producers and Disposers: Programmatic Object Supply
- Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
- Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary

Belum selesai. Lanjut ke:

- Part 016 — Decorators: Semantic Wrapping of Business Interfaces

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 016 — Decorators: Semantic Wrapping of Business Interfaces](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-016.md)
