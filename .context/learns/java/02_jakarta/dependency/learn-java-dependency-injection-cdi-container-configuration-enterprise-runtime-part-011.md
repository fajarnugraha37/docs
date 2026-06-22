# Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-011.md`  
Target Java: 8–25  
Target Enterprise Runtime: Java EE 8 `javax.*`, Jakarta EE 9–11+ `jakarta.*`  
Focus: CDI client proxy, contextual instance, normal scope dispatch, proxyability, self-invocation, interception boundary, passivation, and runtime diagnostics.

---

## 0. Why This Part Matters

By this point, we already understand:

- a class is not automatically a CDI bean just because it exists on the classpath;
- a CDI bean is resolved by type, qualifier, scope, and archive discovery;
- scope is not merely an annotation; it defines lifecycle, visibility, and context ownership;
- a container does not merely call constructors; it controls object creation, injection, callbacks, proxying, interception, and destruction.

This part goes one level deeper: **what exactly gets injected?**

Many engineers assume this:

```java
@Inject
OrderService orderService;
```

means:

```text
field contains the actual OrderService object
```

Often, that is wrong.

In CDI, especially for **normal scoped beans**, the injected value is commonly a **client proxy**.

The proxy is not the real contextual instance. It is a stable reference that knows how to find the real instance for the currently active context.

That one idea explains many “mysterious” production behaviors:

- why `@ApplicationScoped` beans are usually proxied;
- why `@RequestScoped` can be injected into `@ApplicationScoped` safely;
- why certain final classes fail deployment;
- why self-invocation bypasses interceptors;
- why `this.someMethod()` behaves differently from `injectedBean.someMethod()`;
- why constructors see incomplete object state;
- why `equals`, `hashCode`, and identity assumptions can become dangerous;
- why `ContextNotActiveException` may appear only in async/background flows;
- why passivation requires serializable/proxy-safe dependencies;
- why debugging CDI often requires asking “am I looking at the proxy or the contextual instance?”

A top-level engineer does not memorize CDI proxy trivia. They understand the **dispatch boundary**:

```text
caller → injected reference → proxy → active context → actual contextual instance → method body
```

Once you understand that chain, CDI becomes predictable.

---

## 1. Core Mental Model

### 1.1 The wrong model

The beginner model of dependency injection is:

```text
Container creates object A
Container creates object B
Container puts B into A
A calls B directly
```

Example:

```java
@ApplicationScoped
public class CheckoutService {

    @Inject
    PaymentService paymentService;

    public void checkout() {
        paymentService.charge();
    }
}
```

The naive model says:

```text
CheckoutService has direct pointer to PaymentService instance
```

Sometimes this is close enough. But for CDI normal scopes, it is incomplete.

---

### 1.2 The better model

A better CDI model is:

```text
Container injects a stable reference.
That reference may be a client proxy.
The proxy resolves the actual instance from the active context at invocation time.
```

So the real path is closer to:

```text
CheckoutService
  → paymentService field
  → CDI client proxy
  → current active context
  → actual PaymentService contextual instance
  → charge()
```

Text diagram:

```text
+-----------------------+
| CheckoutService       |
| @ApplicationScoped    |
|                       |
| paymentService -------+----+
+-----------------------+    |
                             v
                    +------------------+
                    | Client Proxy     |
                    | stable reference |
                    +------------------+
                             |
                             | lookup by active context
                             v
                    +-------------------------+
                    | Request/Application/... |
                    | Context                 |
                    +-------------------------+
                             |
                             v
                    +-------------------------+
                    | Actual PaymentService   |
                    | contextual instance     |
                    +-------------------------+
```

The proxy allows a long-lived object to hold a reference to a shorter-lived object without accidentally pinning the shorter-lived object forever.

Example:

```java
@ApplicationScoped
public class AuditFacade {

    @Inject
    CurrentRequestContext currentRequestContext;
}

@RequestScoped
public class CurrentRequestContext {
    public String correlationId() { ... }
}
```

If `AuditFacade` directly held the real `CurrentRequestContext`, then one application-wide singleton-like object would capture one request object forever. That would be incorrect.

Instead, the injected field is a proxy.

At call time:

```text
currentRequestContext.correlationId()
```

means:

```text
ask the active request context for the CurrentRequestContext instance of this request;
then call correlationId() on that instance
```

That is the reason CDI normal scoped injection is powerful.

---

## 2. What Is a CDI Client Proxy?

A **client proxy** is an object injected into a client bean in place of the actual contextual instance.

It has three jobs:

1. provide a stable reference that can be stored in another bean;
2. defer the selection of the real target instance until method invocation time;
3. route calls to the correct contextual instance for the currently active context.

This matters because the same injection point may resolve to different real objects depending on runtime context.

Example with request scope:

```java
@RequestScoped
public class CurrentUser {
    public String username() { ... }
}

@ApplicationScoped
public class AuditService {

    @Inject
    CurrentUser currentUser;

    public void audit(String action) {
        System.out.println(currentUser.username() + " did " + action);
    }
}
```

The `AuditService` object may live for the whole application lifetime.

The `CurrentUser` object must be different per HTTP request.

So the injected `currentUser` cannot be one fixed user instance.

It must be a proxy.

Request A:

```text
AuditService.currentUser proxy → request A CurrentUser
```

Request B:

```text
AuditService.currentUser proxy → request B CurrentUser
```

Same injected proxy reference. Different underlying contextual instance.

---

## 3. Normal Scope vs Pseudo-Scope

The proxy story depends heavily on scope type.

CDI has two broad categories relevant here:

```text
normal scopes
pseudo-scopes
```

### 3.1 Normal scopes

Common normal scopes include:

```java
@RequestScoped
@SessionScoped
@ApplicationScoped
@ConversationScoped
```

A normal scope usually means CDI injects a **client proxy** rather than the actual instance.

Normal scope semantics:

```text
Injected reference is stable.
Actual object is resolved from the active context.
The injected reference may outlive the actual object.
```

That is why this is legal and useful:

```java
@ApplicationScoped
public class LongLivedService {

    @Inject
    RequestScopedBean requestScopedBean;
}
```

The field does not pin one request-scoped instance. It points to a proxy.

---

### 3.2 Pseudo-scopes

The most important pseudo-scope is:

```java
@Dependent
```

`@Dependent` behaves differently.

A dependent object is dependent on the lifecycle of the object into which it is injected.

Usually, there is no normal-scope client proxy for a plain dependent bean injection.

Example:

```java
@Dependent
public class PriceCalculator {
    public BigDecimal calculate(...) { ... }
}

@ApplicationScoped
public class PricingService {

    @Inject
    PriceCalculator calculator;
}
```

Here, the `PriceCalculator` instance is typically created as a dependent object of `PricingService`.

It lives and dies with the owning `PricingService` instance.

This has consequences:

```text
@Dependent injected into @ApplicationScoped can effectively become application-lifetime.
```

So `@Dependent` is not “short-lived by default” in an absolute sense. It is **owned by whoever receives it**.

---

### 3.3 Practical comparison

| Scope | Usually proxied? | Lifecycle owner | Common risk |
|---|---:|---|---|
| `@RequestScoped` | Yes | active request context | used outside active request |
| `@SessionScoped` | Yes | HTTP/session context | serialization/passivation issue |
| `@ApplicationScoped` | Yes | application context | mutable shared state/thread safety |
| `@ConversationScoped` | Yes | conversation context | context not active / leak |
| `@Dependent` | Usually no normal client proxy | injection target / producer owner | accidental long lifetime |
| `@Singleton` from Jakarta Inject | pseudo-scope style, container-dependent integration | singleton-like object | not same semantics as `@ApplicationScoped` |

The practical takeaway:

```text
Normal scopes use proxies to separate reference lifetime from instance lifetime.
Dependent scope does not give you that same contextual indirection.
```

---

## 4. Why Proxies Exist

CDI proxies solve several hard runtime problems.

### 4.1 Injecting shorter-lived beans into longer-lived beans

Without proxy:

```text
ApplicationScoped bean → direct reference → RequestScoped object
```

This would leak request state and destroy request isolation.

With proxy:

```text
ApplicationScoped bean → stable proxy → active request instance
```

Correct behavior.

---

### 4.2 Lazy contextual resolution

The actual object may not exist yet when the client bean is created.

Example:

```java
@ApplicationScoped
public class ReportService {

    @Inject
    CurrentRequest currentRequest;
}
```

`ReportService` may be created at application startup.

At startup, there may be no active HTTP request.

If CDI needed the real `CurrentRequest` immediately, startup would fail.

With a proxy, CDI can inject the reference at startup and resolve the actual request only when a method is invoked during an active request.

---

### 4.3 Context switching

In a web application, request-scoped state changes per request.

Same application-scoped service:

```text
request 1 → user Alice
request 2 → user Bob
request 3 → user Carol
```

The same injected proxy can resolve different underlying instances depending on the current context.

---

### 4.4 Passivation and serialization

Session/conversation state may need to be passivated/serialized by the runtime.

A client proxy is usually more suitable to serialize than a direct object graph containing live runtime resources.

This is why passivating scopes impose stricter requirements.

Example risk:

```java
@SessionScoped
public class UserWorkspace implements Serializable {

    @Inject
    SomeNonSerializableDependentHelper helper;
}
```

If the helper is directly stored and not passivation-capable, deployment or runtime may fail.

---

### 4.5 Interceptor/decorator integration

Interceptors and decorators also depend on invocation boundaries.

A method call must cross the right container-managed boundary for cross-cutting behavior to apply.

Example:

```java
@Audited
public void approveCase(String caseId) { ... }
```

The audit interceptor can run only if the invocation goes through the container-managed interception chain.

That is why self-invocation matters, which we will cover later.

---

## 5. The Method Dispatch Chain

Suppose we have:

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    ApprovalPolicy policy;

    public void approve(String caseId) {
        policy.validateApproval(caseId);
    }
}

@RequestScoped
public class ApprovalPolicy {

    public void validateApproval(String caseId) {
        // business rule
    }
}
```

The method call is not simply:

```text
CaseApplicationService → ApprovalPolicy
```

It is:

```text
CaseApplicationService
  → policy proxy
  → CDI context lookup
  → request-specific ApprovalPolicy instance
  → validateApproval(caseId)
```

More explicitly:

```text
1. caller invokes approve(caseId)
2. approve() invokes policy.validateApproval(caseId)
3. policy field is a client proxy
4. proxy asks CDI context: what ApprovalPolicy instance is active now?
5. context returns actual ApprovalPolicy instance for current request
6. proxy dispatches validateApproval(caseId) to that instance
```

If there is no active request context, step 4 fails.

Typical result:

```text
ContextNotActiveException
```

This usually means:

```text
you are using a contextual bean outside the lifecycle where its context exists
```

Common places:

- unmanaged thread;
- scheduled job not activating request context;
- async callback;
- library callback invoked outside container;
- static singleton storing CDI proxy and using it later;
- custom executor instead of managed executor/context propagation.

---

## 6. Contextual Instance vs Client Proxy

This distinction is central.

### 6.1 Client proxy

A client proxy is:

```text
stable, injectable, serializable-ish container reference to a contextual bean
```

It is not necessarily the real object.

Its class may look weird in the debugger:

```text
OrderService$Proxy$_$$_WeldClientProxy
OrderService_ClientProxy
com.example.OrderService$$CDIProxy
```

Exact names vary by implementation.

---

### 6.2 Contextual instance

The contextual instance is:

```text
the real bean object associated with a specific active context
```

For `@RequestScoped`:

```text
one contextual instance per request context
```

For `@ApplicationScoped`:

```text
one contextual instance for the application context
```

For `@SessionScoped`:

```text
one contextual instance per session context
```

---

### 6.3 Why debugger can mislead you

In a debugger, you may see:

```text
paymentService = PaymentService$Proxy$_$$_WeldClientProxy
```

A beginner may think:

```text
CDI did not inject PaymentService correctly
```

But this is exactly correct.

You are looking at the proxy.

The real object may be resolved only when a method is called.

---

## 7. Proxyability Rules

Not every Java type can be proxied safely.

A CDI implementation commonly creates proxies by subclassing a class or generating a proxy object that must override methods to dispatch calls.

Certain Java language features prevent that.

Common unproxyable cases include:

- final class;
- final non-static method that needs to be intercepted/proxied;
- primitive type;
- array type;
- class with no accessible non-private no-argument constructor, depending on proxy strategy and CDI version/provider behavior;
- sealed/strongly encapsulated types in modern Java scenarios, depending on runtime/provider constraints;
- package/module access restrictions that prevent proxy generation or reflective access.

Example unproxyable bean:

```java
@ApplicationScoped
public final class PaymentGateway {
    public void charge() { ... }
}
```

Why risky?

```text
A final class cannot be subclassed.
If the CDI provider needs subclass-based proxying, it cannot create the client proxy.
```

Another risky example:

```java
@ApplicationScoped
public class PaymentGateway {

    public final void charge() { ... }
}
```

If CDI needs to intercept or proxy method dispatch, a final method may block override-based dispatch.

---

## 8. Practical Proxyability Design Rules

For CDI-managed service classes, prefer:

```java
@ApplicationScoped
public class PaymentGateway {

    protected PaymentGateway() {
        // CDI/proxy-friendly constructor
    }

    public PaymentResult charge(PaymentCommand command) {
        ...
    }
}
```

Or, more simply:

```java
@ApplicationScoped
public class PaymentGateway {

    public PaymentResult charge(PaymentCommand command) {
        ...
    }
}
```

Avoid for normal-scoped beans:

```java
@ApplicationScoped
public final class PaymentGateway { ... }
```

Avoid if method should be intercepted/decorated/proxied:

```java
public final PaymentResult charge(...) { ... }
```

Avoid injecting primitive/array types as beans directly:

```java
@Inject
String[] values; // usually not what you want
```

Use configuration injection/producer instead:

```java
@Produces
@ApplicationScoped
@SupportedCountries
List<String> supportedCountries(Config config) { ... }
```

---

## 9. Constructor Rules and Why No-Arg Constructors Appear

In plain Java, a constructor initializes the object.

In CDI, there are multiple object-related concerns:

```text
construct actual bean instance
construct proxy class
perform injection
call lifecycle callbacks
apply interception/decorators
bind contextual instance to context
```

Proxies may need to create subclass instances.

Subclass-based proxy generation often needs an accessible constructor path.

That is why CDI providers historically complain about missing no-argument constructors for some normal-scoped beans.

Example:

```java
@ApplicationScoped
public class CaseService {

    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

This constructor injection style is clean from a design standpoint.

But depending on CDI version/provider and proxying mechanism, the normal-scoped bean type may need to be proxyable. Some providers can handle constructor injection better than older runtimes; some situations still require proxyability constraints.

A conservative enterprise-compatible style is:

```java
@ApplicationScoped
public class CaseService {

    private CaseRepository repository;

    protected CaseService() {
        // for proxy/container
    }

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

But this can conflict with final-field purity.

So the senior-level decision is not “always use no-arg constructor” or “always use constructor injection”.

The real decision is:

```text
Which runtime/provider/version are we targeting, and what proxyability constraints does it enforce?
```

For modern CDI implementations, constructor injection is generally supported, but proxyability constraints can still apply to the bean type.

The safest guideline:

```text
Use constructor injection where your target runtime supports it cleanly.
Avoid final normal-scoped classes and final business methods.
Validate with actual container tests, not just unit tests.
```

---

## 10. Interfaces vs Classes as Injection Types

You can inject by concrete class:

```java
@Inject
DefaultRiskScorer riskScorer;
```

Or by interface:

```java
@Inject
RiskScorer riskScorer;
```

Both can work.

But proxy and architecture implications differ.

### 10.1 Injecting concrete class

Pros:

- simpler;
- less boilerplate;
- good when there is exactly one implementation;
- easy navigation in IDE.

Cons:

- can expose implementation details;
- may couple clients to proxyability constraints of the class;
- can make replacement/testing less explicit;
- can encourage an anemic “one interface per class” debate if misused.

---

### 10.2 Injecting interface

Pros:

- clear port/adapter boundary;
- easier implementation substitution;
- natural for decorators;
- natural for feature-flagged implementation selection;
- reduces coupling to concrete implementation.

Cons:

- useless boilerplate if interface has only one trivial implementation and no boundary meaning;
- can fragment code navigation;
- may hide lifecycle/scope concerns if abused.

---

### 10.3 Practical rule

Use concrete class injection for internal, stable application services where substitution is not meaningful.

Use interface injection for:

- infrastructure adapters;
- external connectors;
- policies with multiple implementations;
- feature-flagged strategies;
- decorated business interfaces;
- module boundaries;
- ports crossing architectural layers.

Example:

```java
public interface EligibilityPolicy {
    EligibilityDecision evaluate(ApplicationCase c);
}

@ApplicationScoped
@Default
public class StandardEligibilityPolicy implements EligibilityPolicy {
    ...
}

@ApplicationScoped
public class CaseDecisionService {

    private final EligibilityPolicy eligibilityPolicy;

    @Inject
    public CaseDecisionService(EligibilityPolicy eligibilityPolicy) {
        this.eligibilityPolicy = eligibilityPolicy;
    }
}
```

Here the interface is meaningful because it represents a policy boundary, not ceremony.

---

## 11. Self-Invocation Problem

This is one of the most important proxy-related topics.

Suppose:

```java
@ApplicationScoped
public class CaseService {

    public void submit(String caseId) {
        validate(caseId);
        persist(caseId);
    }

    @Audited
    public void validate(String caseId) {
        ...
    }
}
```

You might expect `@Audited` to run when `submit()` calls `validate()`.

But this is often wrong.

Why?

Because `validate()` is called through `this`, not through the CDI proxy.

The call path is:

```text
external caller → proxy → actual CaseService.submit()
inside submit(): this.validate()
```

The internal call does not re-enter the proxy/interceptor chain.

So the interceptor attached to `validate()` may not run.

---

### 11.1 Text diagram

External call:

```text
Caller
  → CaseService proxy
  → interceptor chain
  → actual CaseService.submit()
```

Internal self-call:

```text
actual CaseService.submit()
  → this.validate()
  → actual CaseService.validate()
```

The second call bypasses:

```text
proxy/interceptor/decorator dispatch
```

---

### 11.2 Why this is not a bug

This is normal object-oriented dispatch.

Inside the object, `this` is the actual object.

It is not the client proxy.

CDI cannot magically intercept every internal method call without bytecode weaving or a different programming model.

---

### 11.3 Common symptoms

You annotate method B:

```java
@Transactional
public void methodB() { ... }
```

Then method A calls method B:

```java
public void methodA() {
    methodB();
}
```

But transaction behavior does not apply as expected.

Or:

```java
@Retry
public void callExternal() { ... }
```

But a local method call does not retry.

Or:

```java
@RolesAllowed("ADMIN")
public void adminOnly() { ... }
```

But internal call bypasses security interceptor.

---

## 12. How to Handle Self-Invocation Correctly

### 12.1 Split intercepted behavior into another bean

Preferred when the method is a real boundary.

Bad:

```java
@ApplicationScoped
public class CaseService {

    public void approve(String caseId) {
        validateApproval(caseId);
        markApproved(caseId);
    }

    @Audited
    public void validateApproval(String caseId) { ... }
}
```

Better:

```java
@ApplicationScoped
public class CaseService {

    @Inject
    ApprovalValidator approvalValidator;

    public void approve(String caseId) {
        approvalValidator.validateApproval(caseId);
        markApproved(caseId);
    }
}

@ApplicationScoped
public class ApprovalValidator {

    @Audited
    public void validateApproval(String caseId) { ... }
}
```

Now the call crosses a CDI-managed boundary:

```text
CaseService → ApprovalValidator proxy → interceptor → actual ApprovalValidator
```

This is usually the cleanest solution.

---

### 12.2 Inject self proxy carefully

Some teams do this:

```java
@ApplicationScoped
public class CaseService {

    @Inject
    CaseService self;

    public void approve(String caseId) {
        self.validateApproval(caseId);
    }

    @Audited
    public void validateApproval(String caseId) { ... }
}
```

This forces the call through the proxy.

But it has drawbacks:

- more magical;
- can confuse lifecycle reasoning;
- can create circular dependency concerns;
- can hide poor boundary design;
- can produce subtle behavior if qualifiers/scopes change.

Use this only when you are deliberately preserving one class boundary and understand the proxy semantics.

---

### 12.3 Use `Instance<T>` for dynamic self lookup

Example:

```java
@Inject
Instance<CaseService> self;

public void approve(String caseId) {
    self.get().validateApproval(caseId);
}
```

This is even more explicit but also more service-locator-like.

Prefer splitting into another bean unless there is a strong reason.

---

### 12.4 Move the interceptor to the externally called method

Sometimes the problem is wrong annotation placement.

Instead of:

```java
public void approve(String caseId) {
    validateApproval(caseId);
    persistApproval(caseId);
}

@Transactional
public void persistApproval(String caseId) { ... }
```

Maybe the real transaction boundary is:

```java
@Transactional
public void approve(String caseId) {
    validateApproval(caseId);
    persistApproval(caseId);
}
```

This is often cleaner for application service use cases.

---

## 13. Method Visibility and Interception

Not every method is a good interception target.

Public business methods are the most natural target.

Private methods are not generally CDI business invocation boundaries.

Example:

```java
@Audited
private void validateInternal() { ... }
```

This is usually conceptually wrong.

A private method is implementation detail. It is not a container-managed call boundary.

Better:

```java
@Audited
public void validateApproval(...) { ... }
```

or place audit on the outer use-case method:

```java
@Audited
public void approveCase(...) { ... }
```

Practical design rule:

```text
Put interceptors on methods that represent externally meaningful operation boundaries.
Do not scatter interceptor annotations onto private helper methods.
```

---

## 14. Proxies and `final`

### 14.1 Final classes

A final class blocks subclassing.

```java
@ApplicationScoped
public final class ExchangeRateClient {
    ...
}
```

If CDI needs to create a subclass proxy, this is a problem.

Better:

```java
@ApplicationScoped
public class ExchangeRateClient {
    ...
}
```

If you want immutability, make fields private and final where supported by your runtime style, but do not make managed normal-scoped service classes final unless you know your provider supports the pattern.

---

### 14.2 Final methods

A final method blocks override.

```java
@ApplicationScoped
public class ExchangeRateClient {

    @Timed
    public final Rate fetchRate(String currency) { ... }
}
```

If a proxy/interceptor needs to override this method, the final modifier prevents it.

Better:

```java
@Timed
public Rate fetchRate(String currency) { ... }
```

---

### 14.3 Records

Java records are final.

They are excellent for data carriers:

```java
public record CaseDecision(String caseId, DecisionStatus status) {}
```

But they are usually poor candidates for normal-scoped CDI service beans.

Good:

```java
public record RiskScore(BigDecimal value, String band) {}
```

Bad:

```java
@ApplicationScoped
public record RiskScoringService(RiskRepository repository) {
    public RiskScore score(String caseId) { ... }
}
```

Reason:

```text
record is final and value-oriented; CDI service bean usually needs proxyability and lifecycle management.
```

Use records for DTOs/value objects/config snapshots, not normal-scoped service components.

---

### 14.4 Sealed classes

Sealed classes restrict subclassing.

That can also conflict with proxy generation.

Good sealed use:

```java
public sealed interface CaseCommand
        permits SubmitCase, ApproveCase, RejectCase {
}
```

Risky sealed use:

```java
@ApplicationScoped
public sealed class CaseWorkflowService permits InternalWorkflowService {
    ...
}
```

For managed service beans, keep proxyability in mind.

---

## 15. Proxies, Equality, and Identity

This is subtle.

When you inject a normal-scoped bean, you may hold a proxy, not the real instance.

So identity checks can mislead you.

Example:

```java
@Inject
CurrentUser currentUser;

public boolean isSame(CurrentUser other) {
    return currentUser == other;
}
```

This comparison may compare proxies, actual contextual instances, or some mix depending on how `other` was obtained.

Avoid identity comparisons for CDI service objects.

---

### 15.1 `equals` and `hashCode`

For service beans, avoid business-significant `equals()` and `hashCode()` unless there is a very deliberate reason.

Bad idea:

```java
@ApplicationScoped
public class PricingService {

    @Override
    public boolean equals(Object other) {
        return ...;
    }
}
```

Service beans are not domain value objects.

They are runtime components.

Their identity is container-managed.

Use equality on value objects/entities/IDs, not on CDI services.

---

### 15.2 Do not use CDI service proxies as map keys

Risky:

```java
Map<Object, Stats> statsByService = new HashMap<>();
statsByService.put(paymentService, stats);
```

Better:

```java
Map<String, Stats> statsByComponentName = new HashMap<>();
statsByComponentName.put("paymentService", stats);
```

or use explicit metadata:

```java
record ComponentKey(String module, String component) {}
```

---

### 15.3 Domain identity belongs in domain objects

Good:

```java
public record CaseId(String value) {}
```

Good:

```java
public class CaseEntity {
    private CaseId id;
}
```

Bad:

```java
@ApplicationScoped
public class CaseService {
    private String id;
}
```

Do not mix service identity with domain identity.

---

## 16. Proxies and Serialization

Passivating scopes such as session/conversation introduce serialization constraints.

Example:

```java
@SessionScoped
public class UserWorkspace implements Serializable {

    @Inject
    CurrentCaseSelection selection;
}
```

If `CurrentCaseSelection` is normal scoped and proxied, CDI may store a passivation-capable proxy.

But dependent objects injected into passivating scoped beans can be problematic if they are not serializable/passivation-capable.

Risky:

```java
@Dependent
public class CsvExporter {
    private final BufferedWriter writer; // runtime resource
}

@SessionScoped
public class ExportWorkspace implements Serializable {

    @Inject
    CsvExporter exporter;
}
```

This mixes session state with live I/O resource.

Better:

```java
@ApplicationScoped
public class CsvExportService {
    public ExportResult export(ExportCommand command) { ... }
}

@SessionScoped
public class ExportWorkspace implements Serializable {
    private ExportOptions options;
    private ExportJobId lastJobId;
}
```

Keep passivating scoped objects state-oriented.

Keep live resources in application/infrastructure services.

---

## 17. Proxies and Thread Safety

A proxy does not make the actual bean thread-safe.

Example:

```java
@ApplicationScoped
public class SequenceGenerator {
    private long value;

    public long next() {
        return ++value;
    }
}
```

This bean is application-scoped, so the contextual instance is shared.

The proxy does not solve race conditions.

Concurrent requests may call `next()` at the same time.

Better:

```java
@ApplicationScoped
public class SequenceGenerator {
    private final AtomicLong value = new AtomicLong();

    public long next() {
        return value.incrementAndGet();
    }
}
```

or use database sequence/ID service depending on domain correctness.

---

### 17.1 Request scoped does not mean thread-safe in all cases

`@RequestScoped` often maps naturally to one request thread.

But async request handling, reactive runtimes, custom executors, and context propagation can complicate this.

Do not assume:

```text
request scoped = impossible to access concurrently
```

A safer rule:

```text
Do not put mutable non-thread-safe state in a bean unless its access model is explicit and constrained.
```

---

## 18. Proxies and Async Execution

A proxy may be safely injected, but method invocation may fail if the needed context is not active.

Example:

```java
@RequestScoped
public class CurrentRequestInfo {
    public String correlationId() { ... }
}

@ApplicationScoped
public class BackgroundReporter {

    @Inject
    CurrentRequestInfo requestInfo;

    public void runLater() {
        CompletableFuture.runAsync(() -> {
            System.out.println(requestInfo.correlationId());
        });
    }
}
```

Problem:

```text
CompletableFuture.runAsync uses unmanaged thread by default.
Request context may not be active there.
```

The injected proxy exists, but invocation fails.

Better patterns:

1. capture plain data before async boundary;
2. use managed executor/context propagation;
3. avoid injecting request-scoped beans into long-running background code;
4. pass explicit command object.

Example:

```java
@ApplicationScoped
public class BackgroundReporter {

    @Inject
    CurrentRequestInfo requestInfo;

    @Inject
    ReportJobExecutor reportJobExecutor;

    public void runLater() {
        String correlationId = requestInfo.correlationId();
        reportJobExecutor.submit(new ReportCommand(correlationId));
    }
}
```

This is more reliable because the async job receives plain data, not a contextual dependency that requires an active request.

---

## 19. Proxies and Transaction Boundaries

CDI proxies and interceptor chains are often involved in transaction behavior.

Example:

```java
@ApplicationScoped
public class CaseCommandService {

    @Transactional
    public void approve(String caseId) {
        ...
    }
}
```

The transaction interceptor runs when the call enters through the managed boundary:

```text
caller → proxy/interceptor chain → approve()
```

But self-invocation can bypass it:

```java
public void approveAll(List<String> caseIds) {
    for (String caseId : caseIds) {
        approve(caseId); // self-call
    }
}

@Transactional
public void approve(String caseId) { ... }
```

If `approveAll()` is called externally, the invocation enters the bean once. The internal call to `approve()` may not pass through the transaction interceptor.

Correct design depends on desired transaction semantics:

### Option A: one transaction for all

```java
@Transactional
public void approveAll(List<String> caseIds) {
    for (String caseId : caseIds) {
        approveOneInternal(caseId);
    }
}

private void approveOneInternal(String caseId) { ... }
```

### Option B: one transaction per case

Split into another bean:

```java
@ApplicationScoped
public class BulkApprovalService {

    @Inject
    SingleApprovalService singleApprovalService;

    public void approveAll(List<String> caseIds) {
        for (String caseId : caseIds) {
            singleApprovalService.approveOne(caseId);
        }
    }
}

@ApplicationScoped
public class SingleApprovalService {

    @Transactional(REQUIRES_NEW)
    public void approveOne(String caseId) { ... }
}
```

Now each call crosses a container boundary.

This is not just a CDI technicality. It is a business consistency decision.

---

## 20. Proxies and Lazy Initialization

A normal-scoped bean may be initialized lazily by the container.

When exactly the real contextual instance is created can depend on:

- scope;
- runtime/provider;
- whether eager startup is configured;
- whether a method is invoked;
- whether observer methods or extensions force initialization.

Do not rely on incidental startup order unless explicitly defined.

Bad:

```java
@ApplicationScoped
public class A {
    @Inject B b;

    @PostConstruct
    void init() {
        // assumes B is fully initialized in a specific custom order
    }
}
```

Better:

- use explicit startup events if required;
- keep initialization idempotent;
- fail fast for required config;
- avoid implicit cross-bean startup ordering;
- test startup behavior in the actual runtime.

---

## 21. Proxies and Circular Dependencies

Proxies can make some circular dependencies technically possible.

Example:

```java
@ApplicationScoped
public class A {
    @Inject B b;
}

@ApplicationScoped
public class B {
    @Inject A a;
}
```

Because injected references may be proxies, the container may be able to construct the graph.

But the architecture is still suspicious.

Ask:

```text
Why does A need B and B need A?
Is there a missing abstraction?
Is there a coordinator/use-case service that should own the flow?
Is there a domain event or policy boundary hidden here?
```

Refactor example:

```java
@ApplicationScoped
public class CaseWorkflowCoordinator {

    @Inject
    ValidationService validationService;

    @Inject
    DecisionService decisionService;

    public void process(String caseId) {
        validationService.validate(caseId);
        decisionService.decide(caseId);
    }
}
```

Instead of:

```text
ValidationService ↔ DecisionService
```

Use:

```text
Coordinator → ValidationService
Coordinator → DecisionService
```

Proxies are not an excuse for cyclic design.

---

## 22. Proxies and `@Dependent` Edge Cases

Because `@Dependent` usually does not introduce a normal client proxy, it has different behavior.

Example:

```java
@Dependent
public class MutableAccumulator {
    private int total;

    public void add(int value) { total += value; }
    public int total() { return total; }
}

@ApplicationScoped
public class ReportService {

    @Inject
    MutableAccumulator accumulator;
}
```

Here, `MutableAccumulator` may effectively become shared for the lifetime of `ReportService`.

This is dangerous if `ReportService` is application-scoped and accessed concurrently.

Better:

- make dependent helper stateless;
- create per-operation state manually;
- use producer with explicit lifecycle;
- use request scope if state is request-bound;
- use local variables for temporary accumulation.

Better example:

```java
@ApplicationScoped
public class ReportService {

    public ReportSummary summarize(List<Row> rows) {
        int total = 0;
        for (Row row : rows) {
            total += row.amount();
        }
        return new ReportSummary(total);
    }
}
```

Do not turn local computation state into injected mutable state.

---

## 23. Proxies and `Provider<T>` / `Instance<T>`

`Provider<T>` and `Instance<T>` allow lazy/dynamic retrieval.

Example:

```java
@Inject
Provider<CurrentUser> currentUserProvider;

public String username() {
    return currentUserProvider.get().username();
}
```

This can look similar to proxy behavior, but it is conceptually different.

Client proxy:

```text
field itself is a proxy to contextual instance
```

Provider/Instance:

```text
field is a handle that asks the container for an instance when get() is called
```

Use `Provider<T>` or `Instance<T>` when:

- dependency is optional/lazy;
- you need programmatic lookup;
- you need to iterate multiple implementations;
- you need to select by qualifier dynamically;
- you want to avoid creating something until truly needed.

Avoid using it as a casual service locator.

Bad:

```java
@Inject
Instance<Object> anything;

public Object getService(Class<?> type) {
    return anything.select(type).get();
}
```

This destroys type clarity.

Good:

```java
@Inject
@Any
Instance<NotificationChannel> channels;

public void send(Notification notification) {
    for (NotificationChannel channel : channels) {
        if (channel.supports(notification.type())) {
            channel.send(notification);
        }
    }
}
```

Even here, make the selection rule explicit and observable.

---

## 24. Proxies and Generic Types

CDI resolution is type-safe and considers parameterized types.

Example:

```java
public interface Repository<T> {
    Optional<T> findById(String id);
}

@ApplicationScoped
public class CaseRepository implements Repository<Case> { ... }

@Inject
Repository<Case> caseRepository;
```

This can work if the bean type closure includes `Repository<Case>`.

But raw types and wildcard-heavy designs can produce confusing resolution or proxy issues.

Risky:

```java
@Inject
Repository repository; // raw type
```

Better:

```java
@Inject
Repository<Case> caseRepository;
```

For multiple repositories:

```java
@Inject
@CaseStore
Repository<Case> caseRepository;

@Inject
@UserStore
Repository<User> userRepository;
```

Generics improve type clarity, but do not replace qualifiers when semantic distinction matters.

---

## 25. Proxies and Native / Build-Time CDI Runtimes

Modern runtimes such as Quarkus use CDI-inspired models with build-time augmentation.

The high-level concepts remain:

- bean discovery;
- injection point resolution;
- scope;
- proxies/interception;
- contextual references.

But implementation details may differ:

- build-time discovery instead of runtime-heavy scanning;
- generated bytecode at build time;
- stricter limits on reflection;
- native image constraints;
- CDI Lite vs CDI Full feature differences;
- different extension model.

Practical rule:

```text
Learn CDI semantics from the specification, then validate runtime-specific behavior in your target provider.
```

Do not assume Weld, OpenWebBeans, ArC/Quarkus, Open Liberty, Payara, and WildFly expose identical debugging behavior.

The portable behavior is the contract.

The generated class names, proxy implementation, diagnostics, and build-time behavior are provider-specific.

---

## 26. Design Patterns Enabled by Proxies

### 26.1 Current request context facade

```java
@RequestScoped
public class CurrentRequestContext {
    private String correlationId;
    private String actorId;

    public String correlationId() { return correlationId; }
    public String actorId() { return actorId; }
}

@ApplicationScoped
public class AuditService {

    @Inject
    CurrentRequestContext current;

    public void record(String action) {
        audit(current.actorId(), current.correlationId(), action);
    }
}
```

This works because `current` is proxied.

---

### 26.2 Per-request policy state

```java
@RequestScoped
public class AuthorizationDecisionContext {
    private final List<String> evaluatedRules = new ArrayList<>();

    public void addRule(String rule) {
        evaluatedRules.add(rule);
    }
}

@ApplicationScoped
public class AuthorizationService {

    @Inject
    AuthorizationDecisionContext decisionContext;

    public void check(...) {
        decisionContext.addRule("CASE_OWNER");
    }
}
```

Works if always used in active request context.

Dangerous if used from background jobs without activating/substituting context.

---

### 26.3 Decorated business interface

```java
public interface CaseApprovalPort {
    void approve(String caseId);
}

@ApplicationScoped
public class DefaultCaseApprovalPort implements CaseApprovalPort {
    public void approve(String caseId) { ... }
}
```

A decorator can wrap invocations to `CaseApprovalPort`.

The call must go through the injected interface/proxy chain.

---

### 26.4 Transaction boundary service split

```text
Bulk service → Single-item transactional service
```

This is a proxy-aware architecture pattern.

It makes transaction behavior explicit and avoids self-invocation traps.

---

## 27. Anti-Patterns

### 27.1 Treating CDI service as value object

Bad:

```java
if (serviceA == serviceB) { ... }
```

CDI services are runtime components. Use domain IDs for business identity.

---

### 27.2 Final everything

“Make everything final” is common in modern Java style.

But for normal-scoped CDI beans, final classes and final methods can be hostile to proxy generation.

Use immutability where it belongs:

- records;
- DTOs;
- value objects;
- command objects;
- immutable config snapshots.

Be careful with managed service classes.

---

### 27.3 Stateful dependent helper injected into long-lived service

Bad:

```java
@Dependent
class Accumulator { int total; }

@ApplicationScoped
class ReportService {
    @Inject Accumulator accumulator;
}
```

The dependent instance can become application-lifetime mutable state.

---

### 27.4 Assuming annotation works on self-call

Bad:

```java
public void outer() {
    inner();
}

@Transactional
public void inner() { ... }
```

If `inner()` needs a transaction boundary, call it through another bean or annotate the outer boundary.

---

### 27.5 Starting unmanaged threads with contextual dependencies

Bad:

```java
new Thread(() -> currentUser.username()).start();
```

The proxy may exist, but the context may not.

Use managed concurrency/context propagation or capture plain data.

---

### 27.6 Debugging only the class name

Seeing a proxy class is not a bug.

Do not panic at:

```text
$Proxy
WeldClientProxy
ClientProxy
Subclass
```

Ask:

```text
Which context is active?
Which actual instance is behind the proxy now?
Is this call crossing the container boundary?
```

---

## 28. Failure Model

### 28.1 Deployment-time failures

These happen while the container validates beans.

Common causes:

- unproxyable normal-scoped bean;
- final class;
- final method with interceptor/decorator requirement;
- missing accessible constructor path;
- ambiguous dependencies;
- unsatisfied dependencies;
- passivation violation;
- invalid decorator/interceptor binding.

Example message shape:

```text
UnproxyableResolutionException
WELD-001435 Normal scoped bean class ... is not proxyable
DeploymentException
DefinitionException
```

Meaning:

```text
The container cannot legally create the runtime structure required by the bean definition.
```

---

### 28.2 Invocation-time failures

These happen when a method is called.

Common causes:

- context not active;
- request-scoped proxy used in background thread;
- session expired;
- destroyed context;
- lazy target creation fails;
- transaction/security interceptor throws;
- decorator delegate failure.

Example:

```text
ContextNotActiveException: Request context is not active
```

Meaning:

```text
The proxy exists, but it cannot find a valid contextual instance for the current execution.
```

---

### 28.3 Semantic failures

These are the most dangerous because the app runs but behavior is wrong.

Examples:

- transaction did not apply due to self-invocation;
- audit interceptor did not run;
- retry did not trigger;
- application-scoped mutable state races;
- dependent helper retains state across calls;
- `equals`/identity logic produces wrong result;
- feature gate decorator bypassed because object created manually.

These require architecture-level reasoning, not just stack trace reading.

---

## 29. Diagnostic Checklist

When CDI proxy behavior seems wrong, ask in order:

### 29.1 Is the object managed?

Was it created by CDI/container?

Bad:

```java
new CaseService().approve(...);
```

Good:

```java
@Inject
CaseService caseService;
```

If you use `new`, CDI does not inject/proxy/intercept it.

---

### 29.2 What is the injection type?

Concrete class or interface?

```java
@Inject
PaymentGateway gateway;
```

Ask:

```text
Is PaymentGateway proxyable?
Is there a decorator/interceptor requiring method override?
Is the type final/sealed/record?
```

---

### 29.3 What is the scope?

```java
@RequestScoped?
@ApplicationScoped?
@Dependent?
@SessionScoped?
```

Ask:

```text
Does this scope require a client proxy?
Is the context active when method is called?
Is the actual instance shared or per-context?
```

---

### 29.4 Is there self-invocation?

Search for:

```java
this.someMethod()
someMethod()
```

inside the same class where `someMethod` has:

```java
@Transactional
@Audited
@Retry
@RolesAllowed
@Timed
```

If yes, the call may bypass the interceptor chain.

---

### 29.5 Is the class proxyable?

Check:

- final class;
- final methods;
- private constructor only;
- no accessible constructor path;
- primitive/array bean type;
- record/sealed service;
- module access restrictions.

---

### 29.6 Is context crossing async/thread boundary?

Check:

- `CompletableFuture.runAsync`;
- `new Thread`;
- custom `ExecutorService`;
- scheduler;
- message listener;
- callback from external library;
- reactive pipeline.

If yes, do not assume CDI request/session context is active.

---

### 29.7 Is passivation involved?

Check:

```java
@SessionScoped
@ConversationScoped
```

Ask:

```text
Are injected dependencies passivation-capable?
Are dependent objects serializable?
Are live resources stored in session state?
```

---

### 29.8 Is the behavior portable?

If something works only in one CDI provider, ask:

```text
Is this defined by CDI spec or provider-specific convenience?
```

Do not build critical architecture on accidental provider behavior.

---

## 30. Practical Coding Guidelines

### 30.1 For service beans

Prefer:

```java
@ApplicationScoped
public class CaseDecisionService {
    ...
}
```

Avoid:

```java
@ApplicationScoped
public final class CaseDecisionService {
    ...
}
```

Avoid final intercepted business methods.

---

### 30.2 For value/data objects

Prefer records/immutability:

```java
public record ApprovalCommand(String caseId, String actorId) {}
public record ApprovalDecision(boolean allowed, String reason) {}
```

Do not make these CDI normal-scoped service beans.

---

### 30.3 For request/session state

Keep request/session state small, serializable when needed, and free from live resources.

Bad:

```java
@SessionScoped
class Workspace implements Serializable {
    Socket socket;
    EntityManager entityManager;
    BufferedWriter writer;
}
```

Good:

```java
@SessionScoped
class Workspace implements Serializable {
    String selectedCaseId;
    List<String> recentCaseIds;
}
```

---

### 30.4 For cross-cutting behavior

Put interceptors on externally meaningful boundaries:

```java
@Audited
@Transactional
public void approveCase(ApproveCaseCommand command) { ... }
```

Not on private helper fragments.

---

### 30.5 For async

Do not carry contextual proxies blindly across threads.

Prefer command data:

```java
record AsyncAuditCommand(String correlationId, String actorId, String action) {}
```

Then submit the command to a managed executor or message queue.

---

## 31. Worked Example: Regulatory Case Approval

### 31.1 Initial design

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    CurrentUser currentUser;

    @Inject
    CaseRepository caseRepository;

    @Inject
    AuditService auditService;

    public void approve(String caseId) {
        validate(caseId);
        CaseRecord record = caseRepository.find(caseId);
        record.approve(currentUser.id());
        caseRepository.save(record);
        auditService.record("CASE_APPROVED", caseId);
    }

    @Audited
    public void validate(String caseId) {
        ...
    }
}
```

Potential issues:

1. `CurrentUser` is likely request-scoped and injected as proxy. Fine during request, not fine outside request.
2. `validate()` has `@Audited` but is called via self-invocation. Audit may not run.
3. Transaction boundary is unclear.
4. Audit event after save may happen inside/outside transaction depending on hidden interceptor placement.

---

### 31.2 Improved design

```java
@ApplicationScoped
public class CaseApprovalService {

    private final CurrentUser currentUser;
    private final ApprovalValidator approvalValidator;
    private final CaseRepository caseRepository;
    private final AuditService auditService;

    @Inject
    public CaseApprovalService(
            CurrentUser currentUser,
            ApprovalValidator approvalValidator,
            CaseRepository caseRepository,
            AuditService auditService) {
        this.currentUser = currentUser;
        this.approvalValidator = approvalValidator;
        this.caseRepository = caseRepository;
        this.auditService = auditService;
    }

    @Transactional
    @AuditedOperation("CASE_APPROVE")
    public void approve(ApproveCaseCommand command) {
        String actorId = currentUser.id();

        approvalValidator.validate(command.caseId(), actorId);

        CaseRecord record = caseRepository.find(command.caseId());
        record.approve(actorId);
        caseRepository.save(record);

        auditService.record(AuditCommand.caseApproved(command.caseId(), actorId));
    }
}
```

Separate validator:

```java
@ApplicationScoped
public class ApprovalValidator {

    public void validate(String caseId, String actorId) {
        ...
    }
}
```

Request user:

```java
@RequestScoped
public class CurrentUser {
    public String id() { ... }
}
```

Why better?

- `approve()` is the explicit transaction/audit boundary.
- `CurrentUser` proxy is used only within active request execution.
- `validate()` is plain business logic unless it truly needs separate boundary behavior.
- No self-invocation trap.
- Dependencies reveal architecture.

---

### 31.3 Async-safe variant

If approval can be triggered asynchronously, do not depend on `CurrentUser` at job execution time.

Command:

```java
public record ApproveCaseCommand(
        String caseId,
        String actorId,
        String correlationId
) {}
```

Request boundary:

```java
@ApplicationScoped
public class CaseApprovalResourceBoundary {

    @Inject
    CurrentUser currentUser;

    @Inject
    CurrentRequestContext requestContext;

    @Inject
    CaseApprovalJobQueue queue;

    public void submitApproval(String caseId) {
        queue.enqueue(new ApproveCaseCommand(
                caseId,
                currentUser.id(),
                requestContext.correlationId()
        ));
    }
}
```

Worker:

```java
@ApplicationScoped
public class CaseApprovalWorker {

    @Inject
    CaseApprovalService approvalService;

    public void process(ApproveCaseCommand command) {
        approvalService.approve(command);
    }
}
```

The async worker receives plain values, not request-scoped proxies.

---

## 32. Java 8–25 Considerations

### 32.1 Java 8 era

Typical stack:

```text
Java EE 7/8
javax.* namespace
classic app server
runtime scanning
reflection-heavy container behavior
```

Proxy issues commonly appear as:

- missing no-arg constructor;
- final class/method;
- classloader conflict;
- `javax` API duplicated in WAR;
- older CDI provider limitations.

---

### 32.2 Java 11/17 era

Important changes:

- stronger module/access awareness;
- Jakarta namespace migration begins to matter;
- app servers modernize;
- MicroProfile becomes common;
- container image deployment becomes common.

Proxy impact:

- reflective access can be more visible;
- classpath/module-path choices matter;
- migration can create `javax`/`jakarta` mixed proxy errors.

---

### 32.3 Java 21/25 era

Important changes:

- records/sealed classes are common language tools;
- virtual threads become relevant in server runtimes;
- build-time DI/native image patterns are more common;
- Jakarta EE 11 targets modern Java baseline;
- more frameworks optimize startup and reduce reflection.

Proxy impact:

- records are good for values, not service beans;
- sealed/final design needs care in managed components;
- virtual threads do not automatically solve CDI context propagation;
- build-time CDI may detect failures earlier;
- provider-specific constraints must be tested.

---

## 33. Top 1% Mental Model

A top engineer sees this code:

```java
@Inject
CurrentUser currentUser;
```

and immediately asks:

```text
What is CurrentUser's scope?
Is this a client proxy?
When is the actual instance resolved?
What context must be active?
Can this object cross async boundaries?
Is this injection into a longer-lived bean?
What happens during passivation?
Is the type proxyable?
Will interception/decorators apply to calls?
Is any method called through self-invocation?
```

They see this:

```java
@Transactional
public void inner() { ... }
```

and ask:

```text
Who calls this method?
Does the call enter through the container proxy?
Or is it a self-call?
What transaction boundary does the business process actually require?
```

They see this:

```java
@ApplicationScoped
public final class Service { ... }
```

and ask:

```text
Can the CDI provider proxy this?
Is final valuable here, or is it accidentally hostile to runtime behavior?
```

They see this:

```java
CompletableFuture.runAsync(() -> currentRequest.userId())
```

and ask:

```text
Which executor is this using?
Is the request context active?
Should we capture plain data before crossing the async boundary?
```

That is the difference between annotation-level knowledge and runtime-level engineering.

---

## 34. Summary

CDI proxies exist because CDI separates:

```text
reference lifetime
```

from:

```text
actual contextual instance lifetime
```

A normal-scoped injected bean is often not the actual object. It is a client proxy that resolves the real object from the active context at method invocation time.

This enables:

- request-scoped injection into application-scoped beans;
- lazy contextual resolution;
- session/conversation passivation support;
- interceptor/decorator dispatch boundaries;
- cleaner separation of lifecycle and reference graph.

But it also introduces design obligations:

- avoid final normal-scoped service classes unless your provider supports it;
- avoid final business methods that need interception/proxying;
- understand self-invocation;
- do not carry request/session proxies blindly across threads;
- avoid identity/equality assumptions on service beans;
- keep dependent mutable objects out of long-lived services;
- test container behavior in the actual runtime;
- treat proxy-related errors as architectural signals, not random framework noise.

The main formula:

```text
Injected reference ≠ always actual object.
Normal scoped injection often means proxy.
Proxy dispatch requires active context.
Interceptors/decorators require managed invocation boundary.
```

---

## 35. Review Questions

1. Why can `@ApplicationScoped` safely inject a `@RequestScoped` bean?
2. What is the difference between a client proxy and a contextual instance?
3. Why can a final class be problematic as a normal-scoped CDI bean?
4. Why can `this.method()` bypass an interceptor?
5. When should you split a method into another bean instead of using self-injection?
6. Why is `@Dependent` injected into `@ApplicationScoped` potentially dangerous?
7. Why can a request-scoped proxy fail inside `CompletableFuture.runAsync()`?
8. Why should CDI service beans usually not implement business `equals()`/`hashCode()`?
9. What is the difference between `Provider<T>` and a normal CDI client proxy?
10. How should you design an async command so it does not depend on request-scoped context?

---

## 36. Practical Exercises

### Exercise 1 — Identify proxy boundaries

Given:

```java
@ApplicationScoped
class A {
    @Inject B b;
}

@RequestScoped
class B {
    String value() { return "x"; }
}
```

Answer:

- What is likely stored in `A.b`?
- When is the actual `B` instance resolved?
- What happens if `b.value()` is called outside request context?

---

### Exercise 2 — Fix self-invocation

Given:

```java
@ApplicationScoped
class PaymentService {

    public void checkout() {
        charge();
    }

    @Transactional
    public void charge() {
        ...
    }
}
```

Refactor so transaction behavior is explicit and reliable.

---

### Exercise 3 — Detect dangerous dependent state

Given:

```java
@Dependent
class Buffer {
    List<String> rows = new ArrayList<>();
}

@ApplicationScoped
class ExportService {
    @Inject Buffer buffer;
}
```

Explain why this is dangerous and propose a better design.

---

### Exercise 4 — Async-safe request data

Given:

```java
@RequestScoped
class CurrentActor {
    String id() { ... }
}

@ApplicationScoped
class JobSubmitter {
    @Inject CurrentActor actor;

    void submit() {
        CompletableFuture.runAsync(() -> send(actor.id()));
    }
}
```

Refactor this so the async job receives safe data.

---

## 37. References

- Jakarta Contexts and Dependency Injection 4.1 Specification: `https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1`
- Jakarta Dependency Injection 2.0 Specification: `https://jakarta.ee/specifications/dependency-injection/2.0/`
- Jakarta Interceptors Specification: `https://jakarta.ee/specifications/interceptors/`
- Jakarta EE Platform Specification: `https://jakarta.ee/specifications/platform/`
- Weld Documentation: `https://docs.jboss.org/weld/reference/`
- OpenWebBeans Documentation: `https://openwebbeans.apache.org/`
- Quarkus CDI Guide: `https://quarkus.io/guides/cdi`

---

## 38. Status

This is **Part 011 of 035** in the series.

Previous parts completed:

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

Next part:

- Part 012 — Qualifiers, Alternatives, Specialization, and Priority

The series is **not finished yet**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-010.md">⬅️ Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-012.md">Part 012 — Qualifiers, Alternatives, Specialization, and Priority ➡️</a>
</div>
