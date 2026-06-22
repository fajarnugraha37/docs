# learn-java-jakarta-part-008.md

# Bagian 8 — Jakarta Interceptors dan CDI Decorators

> Target pembaca: Java engineer yang ingin memahami **cross-cutting behavior** di Jakarta EE/CDI secara mendalam: bagaimana logging, audit, security, metrics, transaction-like behavior, validation tambahan, enrichment, dan policy wrapper bisa diterapkan tanpa mencampur semua concern ke business method.
>
> Fokus bagian ini: `jakarta.interceptor.*` dan `jakarta.decorator.*`, termasuk interceptor binding, `@AroundInvoke`, `InvocationContext`, ordering/priority, lifecycle interception, CDI decorators, delegate injection, use case production, proxy boundary, self-invocation, testing, observability, dan failure modes.

---

## Daftar Isi

1. [Orientasi: Kenapa Interceptors dan Decorators Penting?](#1-orientasi-kenapa-interceptors-dan-decorators-penting)
2. [Mental Model: Core Logic vs Cross-Cutting Logic](#2-mental-model-core-logic-vs-cross-cutting-logic)
3. [Interceptors vs Decorators: Perbedaan Besar](#3-interceptors-vs-decorators-perbedaan-besar)
4. [Jakarta Interceptors 2.2 dalam Jakarta EE 11](#4-jakarta-interceptors-22-dalam-jakarta-ee-11)
5. [Dependency dan Packaging](#5-dependency-dan-packaging)
6. [Peta API `jakarta.interceptor`](#6-peta-api-jakartainterceptor)
7. [Interception Points: Business, Lifecycle, Timeout, Constructor](#7-interception-points-business-lifecycle-timeout-constructor)
8. [`@AroundInvoke`: Business Method Interception](#8-aroundinvoke-business-method-interception)
9. [`InvocationContext`: Jantung Interceptor](#9-invocationcontext-jantung-interceptor)
10. [Interceptor Binding: Annotation-Based Activation](#10-interceptor-binding-annotation-based-activation)
11. [Membuat Custom Binding Annotation](#11-membuat-custom-binding-annotation)
12. [Membuat Interceptor Class](#12-membuat-interceptor-class)
13. [Mengaktifkan Interceptor: `@Priority` dan `beans.xml`](#13-mengaktifkan-interceptor-priority-dan-beansxml)
14. [Ordering dan Priority](#14-ordering-dan-priority)
15. [Class-Level vs Method-Level Binding](#15-class-level-vs-method-level-binding)
16. [Binding dengan Attributes dan `@Nonbinding`](#16-binding-dengan-attributes-dan-nonbinding)
17. [`@Interceptors`: Explicit Interceptor Binding](#17-interceptors-explicit-interceptor-binding)
18. [Exclude Interceptors](#18-exclude-interceptors)
19. [Lifecycle Interceptors: `@PostConstruct`, `@PreDestroy`, `@AroundConstruct`](#19-lifecycle-interceptors-postconstruct-predestroy-aroundconstruct)
20. [Timeout Interceptors](#20-timeout-interceptors)
21. [Use Case 1: Audit Interceptor](#21-use-case-1-audit-interceptor)
22. [Use Case 2: Metrics/Latency Interceptor](#22-use-case-2-metricslatency-interceptor)
23. [Use Case 3: Security/Policy Interceptor](#23-use-case-3-securitypolicy-interceptor)
24. [Use Case 4: Idempotency/Command Guard Interceptor](#24-use-case-4-idempotencycommand-guard-interceptor)
25. [Use Case 5: Transaction-Like Logging Interceptor](#25-use-case-5-transaction-like-logging-interceptor)
26. [CDI Decorators: Business-Aware Wrapping](#26-cdi-decorators-business-aware-wrapping)
27. [Decorator API: `@Decorator` dan `@Delegate`](#27-decorator-api-decorator-dan-delegate)
28. [Membuat CDI Decorator](#28-membuat-cdi-decorator)
29. [Decorator Ordering dan Enablement](#29-decorator-ordering-dan-enablement)
30. [Interceptors vs Decorators dalam Use Case Nyata](#30-interceptors-vs-decorators-dalam-use-case-nyata)
31. [Proxy Boundary dan Self-Invocation](#31-proxy-boundary-dan-self-invocation)
32. [Final, Private, Static Method, dan Proxy Limitations](#32-final-private-static-method-dan-proxy-limitations)
33. [Exception Handling dan `proceed()`](#33-exception-handling-dan-proceed)
34. [ThreadLocal, Context Propagation, dan Async Boundary](#34-threadlocal-context-propagation-dan-async-boundary)
35. [Performance Cost Model](#35-performance-cost-model)
36. [Testing Strategy](#36-testing-strategy)
37. [Observability dan Debugging](#37-observability-dan-debugging)
38. [Production Failure Modes](#38-production-failure-modes)
39. [Best Practices dan Anti-Patterns](#39-best-practices-dan-anti-patterns)
40. [Checklist Review](#40-checklist-review)
41. [Latihan Bertahap](#41-latihan-bertahap)
42. [Mini Project: Jakarta Cross-Cutting Lab](#42-mini-project-jakarta-cross-cutting-lab)
43. [Referensi Resmi](#43-referensi-resmi)

---

# 1. Orientasi: Kenapa Interceptors dan Decorators Penting?

Dalam aplikasi production, business method jarang hanya menjalankan business logic.

Contoh use case:

```java
public CaseResult approve(ApproveCase command) {
    authorization.check(command.actor(), command.caseId());
    long start = System.nanoTime();

    try {
        audit.start("APPROVE_CASE", command);
        CaseResult result = doApprove(command);
        audit.success("APPROVE_CASE", command, result);
        metrics.recordSuccess("APPROVE_CASE", elapsed(start));
        return result;
    } catch (Exception e) {
        audit.failure("APPROVE_CASE", command, e);
        metrics.recordFailure("APPROVE_CASE", elapsed(start));
        throw e;
    }
}
```

Masalah:

- business logic tercampur audit;
- metrics tersebar;
- security checks bisa tidak konsisten;
- error handling berulang;
- logging pattern duplikat;
- review sulit;
- test sulit;
- cross-cutting concern menyebar ke banyak method.

Interceptors dan decorators membantu memisahkan concern tersebut.

Dengan interceptor:

```java
@Audited(action = "APPROVE_CASE")
@Measured(name = "case.approve")
public CaseResult approve(ApproveCase command) {
    return doApprove(command);
}
```

Runtime memanggil audit/metrics wrapper di sekitar method.

Dengan decorator:

```java
public interface CaseCommandService {
    CaseResult approve(ApproveCase command);
}
```

Decorator bisa menambahkan behavior yang business-aware di sekitar interface tersebut.

## 1.1 Apa itu cross-cutting concern?

Cross-cutting concern adalah concern yang melintasi banyak use case/class/layer.

Contoh:

- logging;
- audit;
- metrics;
- tracing;
- security;
- transaction;
- caching;
- idempotency;
- retry;
- validation;
- rate limiting;
- authorization;
- multi-tenancy;
- correlation ID;
- policy enforcement;
- exception normalization.

## 1.2 Kenapa tidak semua cross-cutting concern harus interceptor?

Karena interceptor bisa menyembunyikan logic.

Jika concern mengubah business semantic secara signifikan, decorator atau explicit application logic mungkin lebih jelas.

Contoh:

```text
audit log timing → interceptor cocok
case approval policy → explicit domain/application logic lebih cocok
notification fallback strategy → decorator/application orchestration bisa lebih cocok
```

## 1.3 Goal bagian ini

Setelah bagian ini, kamu harus bisa:

1. membedakan interceptor dan decorator;
2. membuat custom interceptor binding;
3. memahami `InvocationContext`;
4. memakai `@Priority`/`beans.xml`;
5. memahami ordering;
6. memakai decorators untuk business interface;
7. menghindari self-invocation trap;
8. memahami performance overhead;
9. men-test interceptor/decorator;
10. memilih mekanisme yang paling tepat untuk concern tertentu.

---

# 2. Mental Model: Core Logic vs Cross-Cutting Logic

## 2.1 Core logic

Core logic adalah alasan method ada.

Contoh:

```java
public CaseResult approve(ApproveCase command) {
    EnforcementCase c = repository.get(command.caseId());
    CaseApproved event = c.approve(command.actor(), command.reason(), clock.instant());
    repository.save(c);
    eventPublisher.publish(event);
    return CaseResult.from(c);
}
```

Core concern:

- load aggregate;
- enforce invariant;
- change state;
- persist;
- publish event;
- return result.

## 2.2 Cross-cutting logic

Cross-cutting concern bukan alasan utama method ada, tetapi penting secara operasional/sistemik.

Contoh:

- record latency;
- log correlation ID;
- audit invocation;
- enforce role;
- normalize exception;
- create tracing span.

## 2.3 Wrapper mental model

Interceptor/decorator seperti wrapper:

```text
caller
  ↓
wrapper before
  ↓
target method
  ↓
wrapper after
  ↓
caller
```

atau saat exception:

```text
caller
  ↓
wrapper before
  ↓
target method throws
  ↓
wrapper catch/finally
  ↓
rethrow/mapping
```

## 2.4 Chain mental model

Jika banyak interceptor:

```text
caller
  ↓
Interceptor A before
  ↓
Interceptor B before
  ↓
Interceptor C before
  ↓
target method
  ↑
Interceptor C after
  ↑
Interceptor B after
  ↑
Interceptor A after
  ↑
caller
```

Urutan penting.

Contoh:

```text
security before transaction?
audit before security?
metrics outermost?
tracing outermost?
```

## 2.5 Invisible behavior risk

Semakin banyak cross-cutting logic, semakin sulit membaca method.

Karena itu:

- binding annotation harus jelas;
- interceptor harus kecil;
- ordering harus terdokumentasi;
- test harus membuktikan behavior;
- jangan menyembunyikan domain decision penting.

---

# 3. Interceptors vs Decorators: Perbedaan Besar

## 3.1 Interceptor

Interceptor bekerja di sekitar invocation atau lifecycle event.

Cocok untuk:

- generic cross-cutting concern;
- metadata-driven behavior;
- audit invocation;
- logging;
- metrics;
- tracing;
- security wrapper;
- transaction-like boundary;
- retry generic;
- input/output inspection;
- lifecycle instrumentation.

Karakteristik:

- annotation/binding-driven;
- menggunakan `InvocationContext`;
- bisa applied ke banyak class/method;
- sering tidak business-interface-specific;
- bisa inspect method/parameters;
- perlu `proceed()`.

## 3.2 Decorator

Decorator membungkus bean yang mengimplementasikan type/interface tertentu.

Cocok untuk:

- business-aware wrapping;
- menambahkan behavior pada interface/domain service tertentu;
- augmenting result;
- fallback strategy;
- policy around a specific interface;
- validating semantic contract;
- adapting behavior of implementation.

Karakteristik:

- type/interface-driven;
- memakai `@Decorator` dan `@Delegate`;
- implement same interface;
- lebih explicit terhadap business type;
- bisa memanggil delegate method langsung;
- biasanya lebih semantically aware.

## 3.3 Contoh perbedaan

### Interceptor

```java
@Audited(action = "APPROVE_CASE")
public CaseResult approve(ApproveCase command) { ... }
```

Interceptor tidak harus tahu semua detail `CaseCommandService`.

### Decorator

```java
@Decorator
public class AuditingCaseCommandService implements CaseCommandService {
    @Inject
    @Delegate
    CaseCommandService delegate;

    public CaseResult approve(ApproveCase command) {
        audit.before(command);
        try {
            CaseResult result = delegate.approve(command);
            audit.after(command, result);
            return result;
        } catch (RuntimeException e) {
            audit.failure(command, e);
            throw e;
        }
    }
}
```

Decorator tahu interface `CaseCommandService`.

## 3.4 Decision shortcut

Gunakan interceptor jika:

```text
behavior generic and annotation-driven
```

Gunakan decorator jika:

```text
behavior business-interface-specific
```

Gunakan explicit code jika:

```text
behavior is core domain rule
```

---

# 4. Jakarta Interceptors 2.2 dalam Jakarta EE 11

Jakarta Interceptors 2.2 adalah release untuk Jakarta EE 11.

Spesifikasi ini mendefinisikan cara untuk melakukan interposing pada:

- business method invocations;
- lifecycle events;
- timeout events;

yang terjadi pada Jakarta EE components dan managed classes.

## 4.1 Apa arti interposing?

Interposing berarti menempatkan logic di antara caller dan target.

```text
caller → interceptor → target → interceptor → caller
```

## 4.2 Interceptor method

Interceptor method bisa berada di:

1. target class itu sendiri; atau
2. class interceptor terpisah yang diasosiasikan dengan target class.

## 4.3 Kenapa Jakarta Interceptors penting?

Karena banyak Jakarta specs/framework behaviors dibangun dengan konsep ini:

- transactions;
- security;
- CDI interceptor binding;
- logging;
- audit;
- metrics;
- lifecycle callbacks.

## 4.4 Jakarta Interceptors bukan CDI saja

Interceptors adalah spesifikasi sendiri. CDI memakai/interoperates dengannya.

Namun dalam aplikasi Jakarta modern, interceptor sering dipakai melalui CDI binding.

## 4.5 Jakarta Interceptors 2.2 highlight

Release 2.2 menambahkan API seperti access to interceptor bindings melalui `InvocationContext` default methods.

Ini membantu interceptor membaca binding annotation secara standard.

---

# 5. Dependency dan Packaging

## 5.1 Maven dependency individual

```xml
<dependency>
  <groupId>jakarta.interceptor</groupId>
  <artifactId>jakarta.interceptor-api</artifactId>
  <version>2.2.0</version>
</dependency>
```

## 5.2 Dalam Jakarta EE 11

Biasanya sudah tercakup melalui Platform/Web/Core API sesuai profile.

Misalnya:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 5.3 API jar bukan runtime

`jakarta.interceptor-api` hanya menyediakan annotation/interface.

Behavior interception dijalankan oleh runtime/container seperti CDI/Jakarta EE runtime.

## 5.4 Scope

Untuk WAR/container:

```xml
<scope>provided</scope>
```

Untuk standalone/custom DI container, dependency dan runtime model bisa berbeda.

## 5.5 Decorator dependency

Decorator annotations berada di CDI API package:

```java
jakarta.decorator.Decorator
jakarta.decorator.Delegate
```

Biasanya datang dari CDI/Jakarta EE API dependency.

---

# 6. Peta API `jakarta.interceptor`

Paket `jakarta.interceptor` berisi:

## 6.1 Annotation types

- `@AroundInvoke`;
- `@AroundConstruct`;
- `@AroundTimeout`;
- `@Interceptor`;
- `@InterceptorBinding`;
- `@Interceptors`;
- `@ExcludeClassInterceptors`;
- `@ExcludeDefaultInterceptors`.

## 6.2 Interface

- `InvocationContext`.

## 6.3 Classes

- `Interceptor.Priority`.

## 6.4 Mental map

```text
@InterceptorBinding
  defines binding annotation

@Interceptor
  marks interceptor class

@AroundInvoke
  method around business invocation

InvocationContext
  current invocation control/info

@Priority / beans.xml
  enable/order interceptor

@Interceptors
  explicit class-level/method-level interceptor declaration

Exclude...
  disable default/class interceptors
```

---

# 7. Interception Points: Business, Lifecycle, Timeout, Constructor

Jakarta Interceptors defines several interception points.

## 7.1 Business method interception

Most common.

```java
@AroundInvoke
Object around(InvocationContext ctx) throws Exception {
    return ctx.proceed();
}
```

Applies around method invocation.

## 7.2 Lifecycle callback interception

Can interpose lifecycle callback events such as initialization/destruction.

Used for:

- lifecycle logging;
- resource validation;
- instrumentation;
- framework integration.

## 7.3 Timeout method interception

Relevant especially in EJB timer context.

Less common in modern CDI-only apps.

## 7.4 Constructor interception

`@AroundConstruct` can intercept construction.

Advanced; use carefully.

## 7.5 Which one should you use?

Most application-level use cases use `@AroundInvoke`.

Lifecycle/constructor interception is more framework/infrastructure-level and should be used sparingly.

---

# 8. `@AroundInvoke`: Business Method Interception

`@AroundInvoke` marks a method that intercepts business method invocations.

## 8.1 Basic interceptor

```java
@Interceptor
@Measured
@Priority(Interceptor.Priority.APPLICATION)
public class MeasuredInterceptor {

    @AroundInvoke
    public Object measure(InvocationContext context) throws Exception {
        long start = System.nanoTime();
        try {
            return context.proceed();
        } finally {
            long elapsed = System.nanoTime() - start;
            // record metric
        }
    }
}
```

## 8.2 Return type

Usually:

```java
Object
```

because intercepted methods can return anything.

## 8.3 Throws

Interceptor method may throw `Exception`.

It can:

- let target exception propagate;
- wrap exception;
- translate exception;
- suppress exception.

Be careful. Changing exception semantics changes API behavior.

## 8.4 Must call `proceed()`?

If interceptor wants target method to execute, call:

```java
context.proceed();
```

If not called, target method is skipped.

This can be intentional for:

- cache hit;
- authorization deny;
- idempotency duplicate result;
- short-circuit.

But accidental missing `proceed()` is severe bug.

## 8.5 Around flow

```java
@AroundInvoke
Object around(InvocationContext ctx) throws Exception {
    before();
    try {
        Object result = ctx.proceed();
        afterSuccess(result);
        return result;
    } catch (Exception e) {
        afterFailure(e);
        throw e;
    } finally {
        always();
    }
}
```

## 8.6 Avoid swallowing exceptions

Bad:

```java
catch (Exception e) {
    log.error("failed", e);
    return null;
}
```

This hides failure.

---

# 9. `InvocationContext`: Jantung Interceptor

`InvocationContext` exposes contextual information about the intercepted invocation and operations that enable interceptor methods to control the invocation chain.

## 9.1 Key methods

Conceptually:

- `getTarget()`;
- `getMethod()`;
- `getConstructor()`;
- `getParameters()`;
- `setParameters(Object[])`;
- `getContextData()`;
- `getTimer()`;
- `proceed()`;
- interceptor binding accessors in newer API.

## 9.2 `getTarget()`

The target object being intercepted.

```java
Object target = ctx.getTarget();
```

Useful for:

- logging class;
- metadata inspection;
- avoiding generic messages.

## 9.3 `getMethod()`

The business method being intercepted.

```java
Method method = ctx.getMethod();
```

Useful for:

- metric name;
- annotation inspection;
- audit action mapping;
- validation.

## 9.4 `getParameters()`

Read parameters:

```java
Object[] params = ctx.getParameters();
```

Use carefully:

- avoid logging PII/secrets;
- parameters may be mutable;
- expensive to stringify;
- avoid leaking domain data.

## 9.5 `setParameters()`

Can replace parameters.

Dangerous.

Use only for very clear use cases:

- normalization;
- backward compatibility adapter;
- framework-level transformation.

Do not casually mutate command data invisibly.

## 9.6 `getContextData()`

A map for sharing data across interceptor chain.

Example:

```java
ctx.getContextData().put("startNanos", System.nanoTime());
```

Be careful with key names and types.

## 9.7 `proceed()`

Calls next interceptor or target method.

```java
return ctx.proceed();
```

## 9.8 Interceptor binding access

Jakarta Interceptors 2.2 added standard ways to access interceptor bindings from `InvocationContext`.

This allows interceptor to inspect binding metadata without custom reflection-only logic.

## 9.9 InvocationContext anti-pattern

Do not turn interceptor into giant reflection engine:

```java
if method name startsWith "approve" then ...
```

Prefer explicit binding annotation attributes.

---

# 10. Interceptor Binding: Annotation-Based Activation

Interceptor binding is a custom annotation that connects target method/class to interceptor.

## 10.1 Define binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    String action();
}
```

## 10.2 Apply binding to interceptor

```java
@Audited(action = "")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class AuditInterceptor {
    ...
}
```

## 10.3 Apply binding to target

```java
@Audited(action = "APPROVE_CASE")
public CaseResult approve(ApproveCase command) {
    ...
}
```

## 10.4 Why binding is better than global interception

Binding is explicit:

```text
This method is audited.
```

Global interception can surprise.

## 10.5 Binding on class

```java
@Audited(action = "CASE_SERVICE")
public class CaseCommandService {
    public CaseResult approve(...) { ... }
}
```

All relevant methods may inherit class-level binding depending spec rules.

## 10.6 Binding on method

```java
@Audited(action = "APPROVE_CASE")
public CaseResult approve(...) { ... }
```

More specific.

## 10.7 Binding design

Binding should express intent:

Good:

```java
@Audited
@Measured
@RequiresPolicy
@IdempotentCommand
```

Bad:

```java
@Interceptor1
@DoStuff
@HandleThis
```

---

# 11. Membuat Custom Binding Annotation

## 11.1 Minimal binding

```java
import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.*;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Measured {
    String value() default "";
}
```

## 11.2 Add documentation

```java
/**
 * Records latency and outcome of a business method invocation.
 * Do not use on methods with high-cardinality metric names.
 */
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Measured {
    String name();
}
```

## 11.3 Avoid unclear attributes

Bad:

```java
boolean flag() default true;
```

Good:

```java
boolean includeParameters() default false;
```

## 11.4 Sensitive data policy

If binding controls logging/audit, define:

```java
boolean logParameters() default false;
```

Default should be safe.

## 11.5 Repeatability

If needed, design repeatable binding carefully. Many use cases do not need repeatable interceptor bindings.

## 11.6 Meta-annotation composition

CDI/interceptor systems can support binding compositions depending rules.

Keep it simple until needed.

---

# 12. Membuat Interceptor Class

## 12.1 Basic class

```java
@Interceptor
@Measured(name = "")
@Priority(Interceptor.Priority.APPLICATION)
public class MeasuredInterceptor {

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        return ctx.proceed();
    }
}
```

## 12.2 Inject dependencies

Interceptors are managed classes, so CDI injection can work.

```java
@Inject
MetricsRecorder metrics;
```

But beware of dependency cycles:

```text
Interceptor depends on service that is intercepted by same interceptor
```

## 12.3 Use lightweight dependencies

Interceptors sit on many calls.

Avoid heavy dependencies or remote calls inside interceptor.

## 12.4 Error handling

If metrics/audit fails, should business call fail?

Depends.

For audit required by regulation:

```text
audit failure may fail command
```

For metrics:

```text
metrics failure should not fail business call
```

Document.

## 12.5 Example

```java
@Interceptor
@Measured(name = "")
@Priority(Interceptor.Priority.APPLICATION)
public class MeasuredInterceptor {

    @Inject
    MetricsRecorder metrics;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        boolean success = false;
        try {
            Object result = ctx.proceed();
            success = true;
            return result;
        } finally {
            long elapsed = System.nanoTime() - start;
            metrics.record(resolveName(ctx), elapsed, success);
        }
    }

    private String resolveName(InvocationContext ctx) {
        return ctx.getMethod().getDeclaringClass().getSimpleName() + "." + ctx.getMethod().getName();
    }
}
```

---

# 13. Mengaktifkan Interceptor: `@Priority` dan `beans.xml`

Interceptor binding alone may not be enough depending CDI/interceptor activation model.

## 13.1 `@Priority`

Use:

```java
@Priority(Interceptor.Priority.APPLICATION)
```

to enable interceptor globally with ordering.

Example:

```java
@Interceptor
@Audited(action = "")
@Priority(Interceptor.Priority.APPLICATION + 100)
public class AuditInterceptor { ... }
```

## 13.2 `beans.xml`

Alternative enabling via `beans.xml`:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
    <interceptors>
        <class>com.example.AuditInterceptor</class>
        <class>com.example.MetricsInterceptor</class>
    </interceptors>
</beans>
```

## 13.3 Why interceptor seems not working

Common reason:

```text
binding exists
interceptor class exists
but interceptor not enabled
```

Add `@Priority` or `beans.xml` config depending project style.

## 13.4 Project standard

Pick one style:

- annotation activation with `@Priority`; or
- centralized XML activation.

Modern code often uses `@Priority`, but `beans.xml` can make ordering explicit.

## 13.5 Avoid accidental global activation

If interceptor has `@Priority`, it may be enabled across archive/application where binding applies.

Know scope of deployment.

---

# 14. Ordering dan Priority

Ordering matters.

Example desired order:

```text
Tracing
  → Correlation
    → Security
      → Idempotency
        → Transaction
          → Audit
            → Metrics
              → Target
```

But another system may want metrics outermost.

## 14.1 Priority constants

`jakarta.interceptor.Interceptor.Priority` defines ranges for ordering.

Use constants instead of magic numbers:

```java
@Priority(Interceptor.Priority.APPLICATION + 200)
```

## 14.2 Lower vs higher ordering

Check spec/runtime semantics. In common Jakarta interceptor priority semantics, lower priority values are generally called before higher values in the chain. But always verify spec context and project rules.

## 14.3 Define project-specific constants

```java
public final class AppInterceptorPriority {
    public static final int TRACING = Interceptor.Priority.APPLICATION;
    public static final int SECURITY = Interceptor.Priority.APPLICATION + 100;
    public static final int IDEMPOTENCY = Interceptor.Priority.APPLICATION + 200;
    public static final int AUDIT = Interceptor.Priority.APPLICATION + 300;
    public static final int METRICS = Interceptor.Priority.APPLICATION + 400;
}
```

## 14.4 Test ordering

Create integration test that records order:

```text
Tracing.before
Security.before
Audit.before
Target
Audit.after
Security.after
Tracing.after
```

## 14.5 Ordering anti-pattern

Do not rely on incidental ordering without explicit priority/config.

## 14.6 Nested effect

If interceptor A wraps B:

```text
A before
  B before
    target
  B after
A after
```

Outermost interceptor sees full duration including inner interceptors.

---

# 15. Class-Level vs Method-Level Binding

## 15.1 Class-level

```java
@Measured(name = "case.service")
public class CaseService {
    public CaseResult approve(...) {}
    public CaseResult reject(...) {}
}
```

Applies broadly.

## 15.2 Method-level

```java
public class CaseService {
    @Measured(name = "case.approve")
    public CaseResult approve(...) {}

    @Measured(name = "case.reject")
    public CaseResult reject(...) {}
}
```

More precise.

## 15.3 Mixed

Class-level default, method-level override/specific.

Need understand binding inheritance/combination semantics.

## 15.4 Design guidance

Use class-level for:

- common policy applies to all methods;
- generic tracing/metrics.

Use method-level for:

- audit action name;
- idempotency key;
- security policy;
- operation-specific metadata.

## 15.5 Avoid broad binding on utility class

If class contains mixed methods, class-level binding can accidentally intercept methods that should not be intercepted.

---

# 16. Binding dengan Attributes dan `@Nonbinding`

## 16.1 Binding attributes affect binding identity

Interceptor binding attributes can participate in binding equality.

Example:

```java
@Audited(action = "APPROVE")
```

vs:

```java
@Audited(action = "REJECT")
```

may be treated as different binding values unless marked nonbinding.

## 16.2 Problem

Interceptor class:

```java
@Audited(action = "")
@Interceptor
public class AuditInterceptor { ... }
```

Target:

```java
@Audited(action = "APPROVE_CASE")
public void approve() {}
```

If `action` is binding member, interceptor with empty action may not match.

## 16.3 Use `@Nonbinding`

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    @Nonbinding
    String action();
}
```

`@Nonbinding` is CDI annotation:

```java
jakarta.enterprise.util.Nonbinding
```

## 16.4 Then read attribute inside interceptor

```java
Audited audited = ctx.getMethod().getAnnotation(Audited.class);
String action = audited.action();
```

or use standardized binding access if available.

## 16.5 Rule

If annotation attribute is configuration data for interceptor, not used to select different interceptor binding, mark it `@Nonbinding`.

## 16.6 Common attributes to mark nonbinding

- action name;
- metric name;
- log parameter flag;
- policy key;
- category;
- severity.

But if different attribute values should map to different interceptors, keep binding.

---

# 17. `@Interceptors`: Explicit Interceptor Binding

`@Interceptors` declares interceptor classes explicitly.

Example:

```java
@Interceptors(AuditInterceptor.class)
public class CaseService {
    ...
}
```

## 17.1 Difference from interceptor binding

`@Interceptors` directly names interceptor class.

Binding annotation decouples target from implementation.

## 17.2 Pros

- explicit;
- simple;
- no custom binding needed;
- clear class name.

## 17.3 Cons

- tight coupling to interceptor class;
- less semantic;
- harder to swap implementation;
- less elegant for cross-cutting policy.

## 17.4 Use cases

- legacy code;
- simple local interceptor;
- explicit component-specific interceptor;
- cases where annotation binding unnecessary.

## 17.5 Prefer binding for semantic cross-cutting

For reusable concern:

```java
@Audited
@Measured
```

is clearer than:

```java
@Interceptors({AuditInterceptor.class, MetricsInterceptor.class})
```

---

# 18. Exclude Interceptors

Jakarta Interceptors includes annotations to exclude interceptors:

- `@ExcludeClassInterceptors`;
- `@ExcludeDefaultInterceptors`.

## 18.1 Why needed?

Sometimes class-level/default interceptors apply broadly, but one method needs exemption.

Example:

```java
@Audited(action = "CASE_SERVICE")
public class CaseService {

    @ExcludeClassInterceptors
    public HealthCheckResult internalHealth() {
        ...
    }
}
```

## 18.2 Use sparingly

Excluding interceptors can break expectations.

If audit is mandatory, do not allow easy exclusion.

## 18.3 Document reason

```java
@ExcludeClassInterceptors
public String pureLocalComputation() {
    // Excluded because method is called thousands of times internally and has no side effect.
}
```

## 18.4 Security warning

Never exclude security interceptors casually.

---

# 19. Lifecycle Interceptors: `@PostConstruct`, `@PreDestroy`, `@AroundConstruct`

## 19.1 Lifecycle interception

Interceptors can interpose on lifecycle callbacks.

Use cases:

- log initialization;
- measure startup;
- validate initialization;
- framework hooks;
- cleanup instrumentation.

## 19.2 Around construct

`@AroundConstruct` intercepts construction.

Advanced.

Example conceptual:

```java
@AroundConstruct
public void aroundConstruct(InvocationContext ctx) throws Exception {
    ctx.proceed();
}
```

## 19.3 PostConstruct/PreDestroy

Lifecycle callback interceptors wrap lifecycle events.

## 19.4 Risks

- startup complexity;
- order confusion;
- error handling;
- hidden side effects;
- container-specific details.

## 19.5 Design guideline

Application teams should mostly use business method interceptors. Lifecycle interception is more for framework/platform/infrastructure code.

---

# 20. Timeout Interceptors

Timeout interception is relevant for timeout method invocations such as timer events in enterprise beans contexts.

## 20.1 Modern relevance

Many modern apps use:

- scheduled jobs;
- batch;
- messaging workers;
- Kubernetes CronJob;
- external scheduler.

EJB timer timeout interception may appear in legacy/full Platform apps.

## 20.2 Use cases

- audit scheduled task;
- measure timer execution;
- security/context;
- error handling.

## 20.3 Migration caution

If modernizing EJB timer-based app, inspect timeout interceptors because behavior may be hidden there.

---

# 21. Use Case 1: Audit Interceptor

Audit is common but dangerous if designed poorly.

## 21.1 Binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Audited {
    @Nonbinding
    String action();

    @Nonbinding
    boolean includeParameters() default false;
}
```

## 21.2 Interceptor

```java
@Interceptor
@Audited(action = "")
@Priority(AppInterceptorPriority.AUDIT)
public class AuditInterceptor {

    @Inject
    AuditTrail auditTrail;

    @AroundInvoke
    public Object audit(InvocationContext ctx) throws Exception {
        Audited audited = findAudited(ctx);
        String action = audited.action();

        AuditEventId eventId = auditTrail.start(action, safeMetadata(ctx));

        try {
            Object result = ctx.proceed();
            auditTrail.success(eventId, safeResultMetadata(result));
            return result;
        } catch (Exception e) {
            auditTrail.failure(eventId, e);
            throw e;
        }
    }
}
```

## 21.3 Design considerations

- Is audit best-effort or mandatory?
- Should audit be in same transaction?
- What data is sensitive?
- Is actor identity available?
- Is correlation ID included?
- Does audit happen before or after authorization?
- Is failure to write audit allowed to fail business command?
- Is audit immutable?

## 21.4 Audit interceptor risk

If audit is regulatory evidence, interceptor must not hide failures.

Maybe audit belongs in application transaction/outbox rather than generic interceptor.

## 21.5 Rule

Use interceptor for invocation audit.

Use domain event/audit model for business decision audit.

---

# 22. Use Case 2: Metrics/Latency Interceptor

## 22.1 Binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface Measured {
    @Nonbinding
    String name();
}
```

## 22.2 Interceptor

```java
@Interceptor
@Measured(name = "")
@Priority(AppInterceptorPriority.METRICS)
public class MetricsInterceptor {

    @Inject
    MetricsRecorder metrics;

    @AroundInvoke
    public Object measure(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        String name = metricName(ctx);

        try {
            Object result = ctx.proceed();
            metrics.success(name, System.nanoTime() - start);
            return result;
        } catch (Exception e) {
            metrics.failure(name, e.getClass().getSimpleName(), System.nanoTime() - start);
            throw e;
        }
    }
}
```

## 22.3 Cardinality warning

Metric labels must not include:

- caseId;
- userId;
- requestId;
- free-form input;
- exception message;
- SQL text.

High cardinality can destroy metrics backend.

## 22.4 Metric naming

Good:

```text
case.command.approve
case.command.reject
document.upload
```

Bad:

```text
case.command.CASE-12345
```

## 22.5 Failure policy

Metrics failure should usually not fail business call.

---

# 23. Use Case 3: Security/Policy Interceptor

## 23.1 Binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresPolicy {
    @Nonbinding
    String value();
}
```

## 23.2 Interceptor

```java
@Interceptor
@RequiresPolicy("")
@Priority(AppInterceptorPriority.SECURITY)
public class PolicyInterceptor {

    @Inject
    PolicyEngine policyEngine;

    @Inject
    SecurityIdentity identity;

    @AroundInvoke
    public Object enforce(InvocationContext ctx) throws Exception {
        RequiresPolicy policy = findPolicy(ctx);
        Object[] params = ctx.getParameters();

        policyEngine.check(identity.currentActor(), policy.value(), params);

        return ctx.proceed();
    }
}
```

## 23.3 Caution

Generic policy interceptor can become too magical.

For domain authorization, explicit application code is often clearer:

```java
authorization.checkCanApprove(actor, case);
```

## 23.4 Good use

Use interceptor for coarse policy:

- method requires authenticated actor;
- permission key check;
- tenant context exists;
- request has valid principal.

Use explicit code for domain-specific resource decision.

## 23.5 Audit security decision

Security decision should be auditable for regulated systems.

---

# 24. Use Case 4: Idempotency/Command Guard Interceptor

## 24.1 Binding

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target(METHOD)
public @interface IdempotentCommand {
    @Nonbinding
    String operation();
}
```

## 24.2 Use

```java
@IdempotentCommand(operation = "APPROVE_CASE")
public ApproveCaseResult approve(ApproveCase command) {
    ...
}
```

## 24.3 Interceptor logic

Conceptual:

```text
extract idempotency key
check request hash
if existing success → return stored result
if existing in progress → reject/409/202
else reserve key
proceed
store result
```

## 24.4 Risk

Idempotency is often business/API-specific.

Interceptor must know:

- where key is;
- how to hash request;
- how to serialize response;
- transaction boundary;
- error semantics.

This may be too much for generic interceptor.

## 24.5 Better design

Use interceptor only for infrastructure guard if contract standardized.

Otherwise implement idempotency explicitly in application service.

---

# 25. Use Case 5: Transaction-Like Logging Interceptor

Transaction should use Jakarta Transactions/JTA, not custom logging interceptor.

But you can log transaction boundary:

```java
@Transactional
@Measured(name = "case.approve")
@Audited(action = "APPROVE_CASE")
public CaseResult approve(...) { ... }
```

## 25.1 Ordering question

Should audit be inside transaction?

```text
Audit inside transaction:
  rollback removes audit unless separate/outbox

Audit outside transaction:
  can record attempted operations even if tx fails
```

## 25.2 Do not fake transaction

Bad:

```java
@AroundInvoke
public Object around(ctx) {
    db.begin();
    try { ... } finally { db.commit(); }
}
```

Use Jakarta Transaction or proper transaction manager.

## 25.3 Observability

Interceptors can add logs:

```text
transaction boundary entered/exited
duration
success/failure
```

But do not replace actual transaction semantics.

---

# 26. CDI Decorators: Business-Aware Wrapping

Decorator is a CDI feature for decorating beans implementing a bean type.

Jakarta CDI API package `jakarta.decorator` defines annotations relating to decorators. A decorator implements one or more bean types and intercepts business method invocations of beans implementing those decorated types.

## 26.1 Decorator mental model

```text
caller
  ↓
decorator
  ↓
delegate
  ↓
actual implementation
```

Decorator implements same interface:

```java
public interface NotificationSender {
    void send(Notification n);
}
```

## 26.2 Why decorator?

Because decorator is type-aware.

Unlike generic interceptor, decorator knows business interface.

## 26.3 Use cases

- add audit around specific service interface;
- add fallback for sender;
- enrich notification;
- validate semantic contract;
- add caching for repository interface;
- add retry to specific gateway;
- add masking to document storage;
- add dual-write migration wrapper;
- add feature flag around implementation.

## 26.4 Decorator should preserve contract

If decorated interface says:

```text
send() either succeeds or throws NotificationException
```

decorator must preserve semantics.

## 26.5 Decorator vs inheritance

Decorator is composition, not subclassing.

It avoids fragile inheritance.

---

# 27. Decorator API: `@Decorator` dan `@Delegate`

## 27.1 `@Decorator`

Marks class as CDI decorator.

```java
@Decorator
public class AuditingNotificationSender implements NotificationSender {
    ...
}
```

## 27.2 `@Delegate`

Marks injection point for decorated delegate.

```java
@Inject
@Delegate
NotificationSender delegate;
```

## 27.3 Decorated types

Decorator implements one or more bean types.

CDI uses delegate injection point to determine what it decorates.

## 27.4 Qualifiers

Delegate injection point can include qualifiers to restrict what gets decorated.

```java
@Inject
@Delegate
@EmailChannel
NotificationSender delegate;
```

## 27.5 Decorator is managed bean

Decorator can inject other dependencies:

```java
@Inject AuditTrail auditTrail;
```

## 27.6 Decorator lifecycle

Decorator is CDI-managed and follows CDI lifecycle/scope rules.

---

# 28. Membuat CDI Decorator

## 28.1 Interface

```java
public interface CaseCommandService {
    CaseResult approve(ApproveCase command);
    CaseResult reject(RejectCase command);
}
```

## 28.2 Implementation

```java
@ApplicationScoped
public class DefaultCaseCommandService implements CaseCommandService {
    @Override
    public CaseResult approve(ApproveCase command) {
        ...
    }

    @Override
    public CaseResult reject(RejectCase command) {
        ...
    }
}
```

## 28.3 Decorator

```java
@Decorator
@Priority(Interceptor.Priority.APPLICATION + 500)
public class AuditingCaseCommandService implements CaseCommandService {

    @Inject
    @Delegate
    CaseCommandService delegate;

    @Inject
    AuditTrail auditTrail;

    @Override
    public CaseResult approve(ApproveCase command) {
        AuditEventId id = auditTrail.start("APPROVE_CASE", command.caseId());
        try {
            CaseResult result = delegate.approve(command);
            auditTrail.success(id, result.caseId());
            return result;
        } catch (RuntimeException e) {
            auditTrail.failure(id, e);
            throw e;
        }
    }

    @Override
    public CaseResult reject(RejectCase command) {
        return delegate.reject(command);
    }
}
```

## 28.4 Notice

Decorator can choose to decorate only some methods with additional behavior and delegate others directly.

## 28.5 Business awareness

Decorator knows `ApproveCase`, `RejectCase`, `CaseResult`.

This can be good for business-specific wrapper.

## 28.6 Risk

Decorator can hide significant behavior.

Document it and test it.

---

# 29. Decorator Ordering dan Enablement

## 29.1 Enablement

Decorators can be enabled via:

- `beans.xml`; or
- `@Priority` depending CDI version/behavior.

## 29.2 Ordering

If multiple decorators apply, order matters.

Example:

```text
RetryDecorator
  → MetricsDecorator
    → DefaultGateway
```

or:

```text
MetricsDecorator
  → RetryDecorator
    → DefaultGateway
```

These produce different metrics.

## 29.3 Test order

As with interceptors, write integration tests if order matters.

## 29.4 Decorator + interceptor order

In classic CDI tutorial material, interceptors are invoked before decorators. Practical ordering should be verified against target CDI version/runtime.

## 29.5 Design guidance

Prefer small number of decorators.

If you have many decorators on same interface, consider making chain explicit or using application orchestration.

---

# 30. Interceptors vs Decorators dalam Use Case Nyata

## 30.1 Metrics

Interceptor usually best:

```java
@Measured(name = "case.approve")
```

Generic and annotation-driven.

## 30.2 Audit

Depends.

Invocation audit:

```text
interceptor
```

Business decision audit:

```text
domain/application event
```

Interface-specific audit wrapper:

```text
decorator
```

## 30.3 Retry

Generic retry interceptor may be risky.

Better:

- explicit resilience library;
- decorator around external gateway;
- clear idempotency;
- bounded retry.

## 30.4 Authorization

Coarse permission:

```text
interceptor
```

Domain resource authorization:

```text
application/domain policy
```

## 30.5 Caching

Generic caching interceptor can work for simple pure methods.

Business repository caching may be decorator.

But be careful with invalidation.

## 30.6 Migration dual-write

Decorator is useful:

```text
NewRepositoryDecorator writes old + new
```

Because it is interface-specific and migration-specific.

## 30.7 Tracing

Interceptor is usually good.

## 30.8 Data masking

Decorator can be better if masking is tied to specific interface/data contract.

---

# 31. Proxy Boundary dan Self-Invocation

## 31.1 The trap

Interception usually happens when call goes through proxy/container boundary.

```java
public class CaseService {

    public void outer() {
        inner(); // self-invocation
    }

    @Measured(name = "inner")
    public void inner() {}
}
```

`inner()` may not be intercepted if called via `this.inner()`.

## 31.2 Why?

Because proxy wraps external call:

```text
caller → proxy → target
```

Self call:

```text
target → target
```

No proxy.

## 31.3 Symptoms

- interceptor not called;
- transaction not active;
- security not checked;
- metrics missing;
- audit missing.

## 31.4 Fixes

- move intercepted method to another bean;
- call through injected interface/proxy carefully;
- redesign use case boundary;
- use explicit code for internal call;
- avoid relying on interception for internal helper methods.

## 31.5 Best fix

Usually:

```text
intercept use case boundary, not internal private/helper method
```

## 31.6 Example

Bad:

```java
public void approve() {
    validate();
    persistWithAudit(); // expected intercepted
}

@Audited(action = "PERSIST")
public void persistWithAudit() {}
```

Better:

```java
@Audited(action = "APPROVE_CASE")
public void approve() {
    validate();
    persist();
}
```

---

# 32. Final, Private, Static Method, dan Proxy Limitations

## 32.1 Private methods

Private methods are not good interception targets.

They are internal implementation details.

## 32.2 Static methods

Static methods are not normal container-managed instance invocations.

Avoid interception expectation.

## 32.3 Final methods/classes

Proxy/subclass mechanisms may not intercept final method/class depending runtime/proxy model.

## 32.4 Constructors

Constructor interception uses `@AroundConstruct`, not `@AroundInvoke`.

## 32.5 Interface vs class proxy

Runtime may use:

- interface proxy;
- subclass proxy;
- generated bytecode;
- reflection dispatch.

Limitations vary.

## 32.6 Design rule

Put interceptor bindings on public/protected business methods of managed components, preferably interface/application service boundary.

---

# 33. Exception Handling dan `proceed()`

## 33.1 Always consider target exception

`ctx.proceed()` can throw.

```java
try {
    return ctx.proceed();
} catch (Exception e) {
    ...
    throw e;
}
```

## 33.2 Do not double-log blindly

If every interceptor logs error, one exception creates many logs.

Define logging ownership.

## 33.3 Exception mapping

Interceptor can map exception:

```java
catch (SQLException e) {
    throw new RepositoryException(e);
}
```

But if used broadly, it may hide important semantics.

## 33.4 Finally block

Use `finally` for cleanup/metrics.

```java
long start = System.nanoTime();
try {
    return ctx.proceed();
} finally {
    recordElapsed(start);
}
```

## 33.5 Short-circuit

If not calling `proceed()`, document clearly.

Example cache:

```java
if (cache.contains(key)) {
    return cache.get(key);
}
return ctx.proceed();
```

## 33.6 `proceed()` exactly once?

Usually yes.

But retry interceptors may call multiple times.

This is dangerous unless target method is idempotent.

## 33.7 Retry warning

A generic retry interceptor can duplicate side effects.

Only retry safe/idempotent operations or external calls designed for retry.

---

# 34. ThreadLocal, Context Propagation, dan Async Boundary

## 34.1 ThreadLocal in interceptors

Interceptors often touch:

- correlation ID;
- security context;
- tenant context;
- MDC logging context;
- trace context.

These often rely on ThreadLocal or context propagation.

## 34.2 Clean up

If interceptor sets ThreadLocal:

```java
try {
    set();
    return ctx.proceed();
} finally {
    clear();
}
```

Failure to clear can leak context across requests.

## 34.3 Async boundary

If method starts async work:

```java
executor.submit(() -> doWork());
```

interceptor context may not propagate.

Use managed executor/context propagation mechanisms.

## 34.4 Virtual threads

Virtual threads reduce thread cost but not context correctness concerns.

ThreadLocal propagation and cleanup still matter.

## 34.5 MDC example

```java
try {
    MDC.put("caseId", caseId);
    return ctx.proceed();
} finally {
    MDC.remove("caseId");
}
```

Do not forget cleanup.

## 34.6 Security context

Do not assume security context is present in background thread.

---

# 35. Performance Cost Model

Interceptors/decorators add overhead.

Usually acceptable, but understand sources.

## 35.1 Overhead sources

- proxy dispatch;
- interceptor chain;
- reflection/metadata lookup;
- annotation scanning;
- parameter array access;
- logging string creation;
- JSON serialization for audit;
- metrics tags;
- ThreadLocal/MDC;
- dependency calls;
- exception handling.

## 35.2 Hot path danger

Bad in hot method:

```java
log.info("params={}", objectMapper.writeValueAsString(ctx.getParameters()));
```

This serializes every call.

## 35.3 Cache metadata

If reading annotations:

```java
ctx.getMethod().getAnnotation(...)
```

Consider caching method metadata in `ConcurrentHashMap<Method, Metadata>`.

But ensure classloader leak safety in app server environments.

## 35.4 Metrics label cardinality

Do not create metric name from raw method parameter.

## 35.5 Chain length

If every method has 10 interceptors, overhead and debugging complexity increase.

## 35.6 Measure

Use:

- JFR;
- load test;
- method profiling;
- allocation profiling;
- startup metrics.

Do not guess.

---

# 36. Testing Strategy

## 36.1 Unit test interceptor logic

You can unit test interceptor by mocking/stubbing `InvocationContext`.

```java
InvocationContext ctx = new FakeInvocationContext(...);
interceptor.around(ctx);
```

Test:

- calls proceed;
- records success;
- records failure;
- rethrows exception;
- handles metadata.

## 36.2 Integration test activation

Unit test does not prove interceptor is enabled.

Need runtime/CDI test to verify:

- binding works;
- interceptor enabled;
- ordering;
- injection into interceptor;
- target method intercepted.

## 36.3 Test decorator behavior

Decorator should be tested through interface injection.

```java
@Inject
CaseCommandService service;
```

Verify call goes through decorator.

## 36.4 Test self-invocation

Write explicit test showing internal call is or is not intercepted depending runtime.

Document.

## 36.5 Test security/audit

For audit/security interceptors:

- success path;
- failure path;
- unauthorized path;
- exception path;
- sensitive parameter masking;
- missing actor/correlation ID.

## 36.6 Test ordering

Make interceptors append to list:

```text
A.before
B.before
target
B.after
A.after
```

Assert order.

## 36.7 Test performance

For heavily used interceptor:

- benchmark overhead;
- JFR allocation profile;
- load test.

---

# 37. Observability dan Debugging

## 37.1 How to know interceptor active?

Add temporary debug logs or test probes.

Better:

- integration test;
- startup log of enabled interceptors if runtime provides;
- runtime dev tooling;
- metrics count.

## 37.2 Debug checklist

- Is class managed?
- Is method public/business method?
- Is binding annotation retained at runtime?
- Is interceptor annotated `@Interceptor`?
- Does interceptor have binding annotation?
- Is interceptor enabled via `@Priority` or `beans.xml`?
- Is `beans.xml` discovered?
- Is target method invoked through proxy/container?
- Is self-invocation involved?
- Are there final/private methods?
- Are qualifiers/scopes affecting decorator?
- Is runtime CDI enabled?
- Is correct namespace `jakarta.*` used?

## 37.3 Logs

For cross-cutting logs:

- include interceptor name;
- method name;
- correlation ID;
- outcome;
- duration;
- avoid sensitive params.

## 37.4 Tracing

An interceptor can create spans around method invocation.

But avoid too many spans for tiny methods.

Trace use case boundaries, not every helper.

## 37.5 JFR

JFR can show:

- method profiling;
- allocation from interceptors;
- lock contention;
- exception volume;
- thread activity.

## 37.6 Production debug flag

If adding debug behavior, make it bounded and safe. Do not log all method params in production.

---

# 38. Production Failure Modes

## 38.1 Interceptor not called

Causes:

- not enabled;
- binding missing;
- wrong retention;
- wrong namespace;
- target not managed;
- self-invocation;
- private/final method;
- wrong `beans.xml`;
- runtime missing CDI/interceptor support.

## 38.2 Interceptor called in wrong order

Causes:

- priority not explicit;
- multiple enablement mechanisms;
- `beans.xml` order mismatch;
- vendor-specific ordering;
- misunderstanding nested chain.

## 38.3 `proceed()` not called

Target skipped accidentally.

Symptoms:

- business method doesn't run;
- return null/default;
- missing DB changes;
- no exception.

## 38.4 `proceed()` called multiple times

Can duplicate side effects.

Common in retry/caching interceptor bugs.

## 38.5 Audit failure breaks business unexpectedly

Audit interceptor throws.

Maybe intended, maybe not.

Define policy.

## 38.6 Metrics/logging causes latency

Expensive serialization or high-cardinality labels.

## 38.7 Security bypass

Security interceptor not active due to self-invocation or unmanaged object.

## 38.8 Decorator not applied

Causes:

- not enabled;
- delegate type mismatch;
- qualifier mismatch;
- class not bean;
- direct injection of implementation instead of interface;
- alternative/specialization conflict.

## 38.9 Circular dependency

Interceptor/decorator depends on service that it intercepts/decorates.

## 38.10 Context leak

ThreadLocal/MDC not cleared in interceptor.

---

# 39. Best Practices dan Anti-Patterns

## 39.1 Best practices

- Use interceptor for generic cross-cutting concern.
- Use decorator for business-interface-specific wrapper.
- Keep domain rules explicit.
- Use binding annotation with clear name.
- Mark config attributes `@Nonbinding` when appropriate.
- Enable/order interceptors explicitly.
- Keep interceptor small and fast.
- Always call `proceed()` unless intentionally short-circuiting.
- Use `try/finally` for cleanup/metrics.
- Do not log sensitive parameters.
- Test activation/order in container.
- Document priority constants.
- Avoid self-invocation assumptions.

## 39.2 Anti-pattern: Business logic hidden in interceptor

Bad:

```java
@ApprovePolicy
public void approve(...) {}
```

where interceptor secretly changes case state.

Domain state transition should be explicit.

## 39.3 Anti-pattern: Generic retry interceptor everywhere

Can duplicate side effects.

Retry must be idempotency-aware.

## 39.4 Anti-pattern: Logging all params

Leaks PII/secrets and adds overhead.

## 39.5 Anti-pattern: Interceptor depends on intercepted service

Can cause cycles or recursion.

## 39.6 Anti-pattern: Magic priority numbers

Use constants and docs.

## 39.7 Anti-pattern: Decorator changes contract

Decorator must preserve interface contract unless explicitly documented.

## 39.8 Anti-pattern: Testing only interceptor class

Need integration test to ensure runtime applies it.

---

# 40. Checklist Review

## 40.1 Interceptor binding

- [ ] Binding annotation has `@InterceptorBinding`.
- [ ] Retention is `RUNTIME`.
- [ ] Target includes proper elements.
- [ ] Attributes marked `@Nonbinding` if config-only.
- [ ] Name expresses intent.

## 40.2 Interceptor class

- [ ] Annotated `@Interceptor`.
- [ ] Has binding annotation.
- [ ] Enabled via `@Priority` or `beans.xml`.
- [ ] Has one clear `@AroundInvoke`.
- [ ] Calls `proceed()` correctly.
- [ ] Handles exception correctly.
- [ ] Cleans ThreadLocal/MDC in finally.
- [ ] Does not log sensitive data.
- [ ] Does not do heavy remote work.
- [ ] Injection dependencies do not create cycle.

## 40.3 Ordering

- [ ] Priority explicit.
- [ ] Priority constants used.
- [ ] Ordering tested.
- [ ] Interaction with transaction/security/audit clear.

## 40.4 Decorator

- [ ] Implements decorated interface.
- [ ] Has `@Decorator`.
- [ ] Has exactly clear `@Delegate` injection point.
- [ ] Enabled/ordered.
- [ ] Preserves interface contract.
- [ ] Qualifiers correct.
- [ ] Tested through interface.

## 40.5 Production

- [ ] Performance overhead measured for hot path.
- [ ] Audit/security failure policy defined.
- [ ] Observability included.
- [ ] Sensitive data masked.
- [ ] Self-invocation considered.
- [ ] Runtime/container compatibility tested.

---

# 41. Latihan Bertahap

## Latihan 1 — Basic measured interceptor

Buat `@Measured` dan `MeasuredInterceptor`.

Apply ke service method.

Verifikasi metric/log.

## Latihan 2 — Interceptor not enabled

Hapus `@Priority` dan `beans.xml`.

Amati interceptor tidak jalan.

Aktifkan lagi.

## Latihan 3 — Ordering

Buat dua interceptors:

```text
A
B
```

Record order before/after.

Ubah priority dan amati.

## Latihan 4 — `@Nonbinding`

Buat binding dengan attribute `name`.

Tanpa `@Nonbinding`, lihat matching problem.

Tambahkan `@Nonbinding`.

## Latihan 5 — Audit interceptor

Buat `@Audited(action = "...")`.

Test success/failure path.

## Latihan 6 — Self-invocation

Method A memanggil method B dalam class sama, B diberi interceptor binding.

Buktikan apakah interceptor jalan di runtime kamu.

## Latihan 7 — Decorator

Buat interface `NotificationSender`.

Implementation `EmailNotificationSender`.

Decorator `AuditingNotificationSender`.

Test call through interface.

## Latihan 8 — Decorator qualifier

Buat Email/SMS sender.

Decorator hanya untuk Email.

## Latihan 9 — ThreadLocal cleanup

Buat interceptor yang set MDC.

Pastikan cleanup di finally.

Simulasi exception.

## Latihan 10 — Performance

Tambahkan logging parameter serialization.

Run load test/JFR.

Bandingkan overhead.

---

# 42. Mini Project: Jakarta Cross-Cutting Lab

## 42.1 Goal

Buat repository:

```text
jakarta-cross-cutting-lab/
```

## 42.2 Modules

```text
interceptor-basic/
audit-interceptor/
metrics-interceptor/
security-policy-interceptor/
decorator-notification/
self-invocation-trap/
ordering-lab/
performance-lab/
```

## 42.3 Requirements

- Jakarta EE 11 compatible runtime;
- CDI enabled;
- Jakarta Interceptors 2.2;
- custom interceptor bindings;
- decorators;
- integration tests;
- performance notes.

## 42.4 Deliverables

```text
README.md
INTERCEPTOR-BINDINGS.md
DECORATOR-DESIGN.md
ORDERING-RULES.md
SELF-INVOCATION-NOTES.md
SECURITY-AUDIT-NOTES.md
PERFORMANCE-REPORT.md
FAILURE-MODES.md
```

## 42.5 Experiments

1. Basic `@AroundInvoke`.
2. Missing enablement.
3. `@Priority` ordering.
4. `beans.xml` ordering.
5. Binding attributes with/without `@Nonbinding`.
6. Audit success/failure.
7. Metrics cardinality.
8. Decorator on interface.
9. Self-invocation trap.
10. Performance overhead with JFR.

## 42.6 Evaluation questions

1. Why is interceptor not called?
2. What does `InvocationContext.proceed()` do?
3. What happens if `proceed()` is not called?
4. What is interceptor binding?
5. Why use `@Nonbinding`?
6. When is decorator better than interceptor?
7. What is self-invocation?
8. How do you test ordering?
9. What data should not be logged?
10. How do interceptors affect performance?

---

# 43. Referensi Resmi

Referensi utama:

1. Jakarta Interceptors 2.2  
   https://jakarta.ee/specifications/interceptors/2.2/

2. Jakarta Interceptors 2.2 Specification  
   https://jakarta.ee/specifications/interceptors/2.2/jakarta-interceptors-spec-2.2

3. Jakarta Interceptors 2.2 API — `InvocationContext`  
   https://jakarta.ee/specifications/interceptors/2.2/apidocs/jakarta.interceptor/jakarta/interceptor/invocationcontext

4. Jakarta EE Tutorial — Using Jakarta EE Interceptors  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/interceptors/interceptors.html

5. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

6. Jakarta CDI 4.1 Specification  
   https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1

7. Jakarta CDI API — `jakarta.decorator` package  
   https://jakarta.ee/specifications/cdi/4.0/apidocs/jakarta.cdi/jakarta/decorator/package-summary

8. Jakarta EE Tutorial — CDI Advanced Topics  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/cdi/cdi-adv/cdi-adv.html

9. Jakarta EE Tutorial — Running CDI Advanced Examples  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/cdi/cdi-adv-examples/cdi-adv-examples.html

10. Jakarta Annotations — `@Priority`  
    https://jakarta.ee/specifications/annotations/3.0/apidocs/jakarta.annotation/jakarta/annotation/priority

---

# Penutup

Interceptors dan decorators adalah alat kuat untuk memisahkan cross-cutting concern dari core logic.

Tetapi kekuatan ini punya risiko:

```text
behavior becomes invisible
ordering becomes important
self-invocation can bypass behavior
proceed() can accidentally skip target
retry can duplicate side effects
logging can leak sensitive data
decorator can silently change contract
```

Mental model ringkas:

```text
Interceptor:
  annotation-driven, generic cross-cutting wrapper around invocation/lifecycle

Decorator:
  type/interface-driven, business-aware wrapper around delegate
```

Gunakan:

```text
interceptor untuk generic operational concern
decorator untuk interface-specific business wrapper
explicit code untuk domain rule
```

Engineer top-tier tidak hanya tahu cara membuat `@AroundInvoke`. Ia tahu kapan cross-cutting behavior sebaiknya invisible, kapan harus explicit, bagaimana menguji ordering, bagaimana menjaga observability, dan bagaimana menghindari side effect tersembunyi.

Bagian berikutnya akan masuk ke **Jakarta RESTful Web Services (`jakarta.ws.rs`)**, yaitu salah satu spesifikasi Jakarta paling sering dipakai untuk membangun REST API production-grade.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-007.md">⬅️ Bagian 7 — CDI: `jakarta.enterprise.*` sebagai Container Programming Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-009.md">Bagian 9 — Jakarta RESTful Web Services (`jakarta.ws.rs`) Production-Grade ➡️</a>
</div>
