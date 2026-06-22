# Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-010.md`  
Status: Part 010 of 035  
Target Java: 8–25  
Target namespace: `javax.*` for Java EE / Jakarta EE 8 legacy, `jakarta.*` for Jakarta EE 9+

---

## 0. Why This Part Matters

CDI scope is often taught as a list of annotations:

```java
@RequestScoped
@SessionScoped
@ApplicationScoped
@Dependent
@ConversationScoped
```

That is not enough.

A top-tier engineer does not ask only:

> Which annotation should I put on this class?

They ask:

> What lifecycle boundary should own this state, who can see it, who may concurrently touch it, how long may it retain memory, and what happens when the context is not active?

A CDI scope is not decoration. It is a runtime contract.

A scope answers five questions:

1. **When is the real object created?**
2. **How long does it live?**
3. **Who can observe the same instance?**
4. **When is it destroyed?**
5. **What contextual boundary must be active for the proxy to resolve to a real instance?**

If you misunderstand scope, your system may still compile and deploy, but fail under real production behavior:

- request data leaks into another request,
- session memory grows without bound,
- singleton/application-scoped beans become race-condition factories,
- request-scoped beans fail inside async jobs,
- conversation scope behaves differently across tabs/windows,
- dependent objects are never cleaned up because their owner lives too long,
- passivation fails because a session-scoped bean is not serializable,
- a proxy exists but cannot resolve its target because the context is inactive.

This part builds a scope mental model that you can use to design and debug large enterprise applications.

---

## 1. Scope Is Lifecycle + Visibility + Ownership

A CDI scope is usually explained as “how long a bean lives”. That is true, but incomplete.

A better model:

```text
Scope = lifecycle boundary + identity boundary + sharing boundary + destruction boundary
```

Meaning:

| Dimension | Question |
|---|---|
| Lifecycle | When does the contextual instance begin and end? |
| Identity | Which invocations see the same underlying instance? |
| Sharing | Is the instance per injection, per request, per session, or per application? |
| Memory | How long can fields remain retained? |
| Concurrency | Can more than one thread touch the same object? |
| Context requirement | Which runtime context must be active? |
| Serialization/passivation | Can the runtime store/restore it if needed? |

Think of CDI scopes as runtime storage compartments.

```text
Application
└── HTTP Session / User Session
    └── Conversation
        └── Request
            └── Dependent objects owned by contextual parents
```

That tree is not perfect for every runtime, but it gives a practical mental model.

- `@ApplicationScoped`: one logical application-level contextual instance.
- `@SessionScoped`: one logical instance per user/session.
- `@ConversationScoped`: one logical instance per conversation, often a multi-step flow.
- `@RequestScoped`: one logical instance per request/unit of work.
- `@Dependent`: no independent context; lifecycle is tied to the object into which it is injected or to the lookup that created it.

---

## 2. The Two Important Categories: Normal Scope vs Pseudo-Scope

CDI scopes are not all equal.

The most important distinction:

```text
Normal scope    -> inject a client proxy
Pseudo-scope    -> inject the actual dependent instance
```

Common normal scopes:

- `@RequestScoped`
- `@SessionScoped`
- `@ApplicationScoped`
- `@ConversationScoped`

Common pseudo-scope:

- `@Dependent`

### 2.1 Normal-scoped injection

When you inject a normal-scoped bean, CDI usually injects a **client proxy**, not the real object.

Example:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class CaseService {
    @Inject
    CurrentUser currentUser; // likely a proxy if CurrentUser is @RequestScoped

    public void submitCase(String caseId) {
        String userId = currentUser.userId();
        // proxy resolves to the real CurrentUser for the active request
    }
}
```

If `CurrentUser` is `@RequestScoped`, the `CaseService` instance is application-scoped, but the `CurrentUser` proxy resolves differently per request.

This is why injecting a short-lived normal-scoped bean into a long-lived normal-scoped bean can work.

Without proxies, this would be impossible safely.

### 2.2 Dependent-scoped injection

`@Dependent` is different.

A dependent object is not retrieved from an independent contextual store. It is created for and owned by something else.

Example:

```java
import jakarta.enterprise.context.Dependent;

@Dependent
public class JsonMapperHelper {
    public String normalize(String value) {
        return value == null ? null : value.trim();
    }
}
```

If injected into an `@ApplicationScoped` bean, the dependent helper may live as long as that application-scoped bean.

If injected into a `@RequestScoped` bean, it lives with the request-scoped owner.

This is subtle and important:

```text
@Dependent does not mean short-lived.
@Dependent means lifecycle follows the owner.
```

---

## 3. Built-in CDI Scopes Overview

| Scope | Identity boundary | Typical use | Risk |
|---|---|---|---|
| `@Dependent` | Owner/injection/lookup | Stateless helpers, produced values, lightweight adapters | Accidentally retained by long-lived owner |
| `@RequestScoped` | Request/unit of work | current user, request metadata, per-request cache | Context inactive outside request |
| `@SessionScoped` | User/session | user preferences, wizard state, auth-adjacent UI state | memory retention, serialization/passivation |
| `@ApplicationScoped` | Application | stateless services, caches, clients, shared runtime services | race conditions, stale mutable state |
| `@ConversationScoped` | Explicit multi-request conversation | multi-step flow, wizard, draft editing | hard lifecycle, tab/window confusion, leaks |

A useful first-pass selection rule:

```text
If it has no mutable state: ApplicationScoped is often fine.
If it has per-request state: RequestScoped.
If it has per-user state across requests: SessionScoped, but be careful.
If it has multi-step flow state: ConversationScoped, but be very careful.
If it is just a helper or owned object: Dependent.
```

But real design requires deeper thinking.

---

## 4. `@Dependent`: The Default Scope and the Most Misunderstood One

If a CDI bean has no explicit scope, it is often treated as `@Dependent`.

Example:

```java
public class AuditDescriptionBuilder {
    public String build(String action, String module) {
        return action + " on " + module;
    }
}
```

In CDI, this class may become a bean depending on discovery mode and bean-defining annotations. But if it is a bean and has no normal scope, its default scope is dependent.

### 4.1 Mental model

```text
Dependent object = object whose lifecycle is attached to the injection target or lookup result
```

If this dependent bean is injected here:

```java
@ApplicationScoped
public class AuditService {
    @Inject
    AuditDescriptionBuilder builder;
}
```

Then the builder can effectively live for the lifetime of `AuditService`.

If injected here:

```java
@RequestScoped
public class AuditRequestContext {
    @Inject
    AuditDescriptionBuilder builder;
}
```

Then the builder follows the request context.

### 4.2 When `@Dependent` is good

Use `@Dependent` for:

- lightweight stateless helpers,
- simple calculators,
- small domain policies with no retained external resource,
- objects whose lifecycle must be exactly tied to their owner,
- producer-created values,
- annotation-driven strategies where each owner should have its own instance.

Example:

```java
@Dependent
public class CaseNumberFormatter {
    public String format(long sequence) {
        return "CASE-" + sequence;
    }
}
```

### 4.3 When `@Dependent` is dangerous

Danger appears when the dependent bean holds resources or mutable state.

Bad example:

```java
@Dependent
public class ExportBuffer {
    private final List<byte[]> chunks = new ArrayList<>();

    public void append(byte[] data) {
        chunks.add(data);
    }
}
```

If injected into an application-scoped service, this buffer may live forever.

### 4.4 Dependent + provider lookup

With `Instance<T>` or `Provider<T>`, each lookup may create a dependent object.

```java
@Inject
Instance<TemporaryWorker> workers;

public void run() {
    TemporaryWorker worker = workers.get();
    worker.execute();
}
```

For dependent objects obtained programmatically, you must understand destruction semantics. In CDI, programmatic lookup can require explicit destruction depending on how the object is obtained. Otherwise, you may create lifecycle leaks.

### 4.5 Design rule

Before using `@Dependent`, ask:

```text
If the owner lived for one hour, one day, or forever, would this dependent object be safe to retain that long?
```

If not, use another scope or explicitly manage its lifecycle.

---

## 5. `@RequestScoped`: The Unit-of-Work Scope

`@RequestScoped` usually means one contextual instance per request.

In a web application, this maps naturally to an HTTP request.

```java
import jakarta.enterprise.context.RequestScoped;

@RequestScoped
public class RequestCorrelation {
    private String correlationId;

    public String correlationId() {
        return correlationId;
    }

    public void correlationId(String correlationId) {
        this.correlationId = correlationId;
    }
}
```

### 5.1 Mental model

```text
RequestScoped = state valid only for one request / one unit of work
```

Good examples:

- correlation ID,
- current authenticated user view,
- request locale,
- per-request cache,
- request validation context,
- one-request audit accumulator,
- request-scoped external API rate/call metadata.

### 5.2 Why request scope is powerful

It avoids passing request metadata through every method parameter.

Without request scope:

```java
caseService.submit(caseId, currentUser, correlationId, locale, requestTimestamp);
```

With request scope:

```java
caseService.submit(caseId);
```

And inside the service:

```java
@Inject CurrentUser currentUser;
@Inject RequestCorrelation correlation;
```

This reduces parameter pollution.

But it also hides dependency on runtime context. That is both a benefit and a danger.

### 5.3 Request scope and long-lived services

This is common and valid:

```java
@ApplicationScoped
public class CaseSubmissionService {
    @Inject
    CurrentUser currentUser; // @RequestScoped proxy

    public void submit(String caseId) {
        // currentUser resolves to the active request's actual instance
    }
}
```

The application-scoped service does not hold one user forever. It holds a proxy.

Each invocation resolves to the current request context.

### 5.4 The most common request-scope failure

```text
jakarta.enterprise.context.ContextNotActiveException
```

This means:

```text
A proxy tried to resolve a contextual instance, but the required context was not active.
```

Common causes:

- calling a request-scoped bean from a background thread,
- using it inside an async completion stage after the request ended,
- using it from a scheduler/timer,
- using it during startup before request context exists,
- storing a proxy and invoking it later outside the original request.

Bad example:

```java
@ApplicationScoped
public class AsyncReportService {
    @Inject
    CurrentUser currentUser;

    public void generateAsync() {
        CompletableFuture.runAsync(() -> {
            // likely fails: request context is not active here
            String user = currentUser.userId();
        });
    }
}
```

Better pattern:

```java
public void generateAsync() {
    String userId = currentUser.userId(); // capture immutable data while context is active

    managedExecutor.runAsync(() -> {
        reportGenerator.generateFor(userId);
    });
}
```

Even better: use a container-managed executor/context propagation mechanism where appropriate. But do not assume plain `CompletableFuture.runAsync` is safe in a Jakarta runtime.

### 5.5 Request-scoped cache pattern

Useful for avoiding duplicate per-request work:

```java
@RequestScoped
public class RequestLookupCache {
    private final Map<String, Object> values = new HashMap<>();

    @SuppressWarnings("unchecked")
    public <T> T getOrCompute(String key, Supplier<T> supplier) {
        return (T) values.computeIfAbsent(key, ignored -> supplier.get());
    }
}
```

Example use:

```java
@ApplicationScoped
public class PostalCodeResolver {
    @Inject
    RequestLookupCache cache;

    public Address resolve(String postalCode) {
        return cache.getOrCompute("postal:" + postalCode,
            () -> callExternalAddressService(postalCode));
    }
}
```

This is safe because the cache is discarded after request completion.

### 5.6 Request scope design rules

Use request scope when:

- the state is invalid after one request,
- the object should not be shared across users,
- the object is naturally tied to a request/unit-of-work,
- you need per-request deduplication or metadata.

Avoid request scope when:

- object must be used outside request context,
- state must survive multiple requests,
- object is expensive to create and stateless,
- object holds resources better managed at application level.

---

## 6. `@SessionScoped`: User-Session State

`@SessionScoped` means one contextual instance per session.

In a web app, this is usually the HTTP session.

```java
import jakarta.enterprise.context.SessionScoped;
import java.io.Serializable;

@SessionScoped
public class UserPreferences implements Serializable {
    private String theme;
    private String timezone;

    public String theme() { return theme; }
    public void theme(String theme) { this.theme = theme; }
}
```

### 6.1 Mental model

```text
SessionScoped = per-user/session state that survives multiple requests
```

Typical use cases:

- UI preferences,
- selected organization/tenant/agency,
- short-lived wizard coordination,
- user-specific non-sensitive cached metadata,
- state needed across multiple screens.

### 6.2 Serialization and passivation

Session-scoped beans generally need to be serializable in many CDI/Jakarta environments. The Jakarta EE tutorial explicitly notes that session, application, and conversation scoped beans must be serializable, while request-scoped beans do not have to be serializable.

Why this matters:

- clustering may replicate sessions,
- server may passivate session state,
- runtime may serialize objects across nodes or storage,
- deployment may fail validation if dependencies are not passivation-capable.

Bad example:

```java
@SessionScoped
public class UserWorkspace implements Serializable {
    private HttpClient httpClient; // not necessarily serializable, bad session state
}
```

Better:

```java
@SessionScoped
public class UserWorkspace implements Serializable {
    private String selectedAgencyCode;
    private List<String> recentCaseIds;
}

@ApplicationScoped
public class ExternalCaseClient {
    // shared client/resource managed at application level
}
```

### 6.3 Session scope memory risk

Session scope is dangerous because its lifetime is human-driven and often longer than engineers expect.

A request may last 100 ms. A session may last 15 minutes, 60 minutes, 8 hours, or longer depending on timeout.

If you store large data in session scope, memory grows with active users.

Memory estimate:

```text
session memory = active sessions × average session object graph size
```

If:

```text
10,000 sessions × 500 KB = ~5 GB retained heap
```

That is before application caches, request allocations, class metadata, DB drivers, framework overhead, etc.

### 6.4 What not to store in session scope

Avoid storing:

- large search results,
- uploaded file bytes,
- JPA entities with lazy-loaded relationships,
- database connections,
- HTTP clients,
- transaction objects,
- security secrets,
- raw tokens unless your security model explicitly supports it,
- unbounded maps/lists,
- mutable global policy state.

Store IDs and small stable values instead.

Bad:

```java
@SessionScoped
public class SearchSession implements Serializable {
    private List<CaseEntity> allResults; // huge, persistence-bound, stale
}
```

Better:

```java
@SessionScoped
public class SearchSession implements Serializable {
    private String lastQueryId;
    private List<String> selectedCaseIds;
}
```

### 6.5 Session scope and concurrency

A single browser user can create concurrent requests:

- double-click submit,
- multiple tabs,
- background AJAX polling,
- retry from network layer,
- browser prefetch,
- SPA parallel API calls.

So session-scoped object state may be accessed concurrently.

Bad:

```java
@SessionScoped
public class DraftBasket implements Serializable {
    private final List<String> selected = new ArrayList<>();

    public void add(String id) {
        selected.add(id); // not inherently thread-safe
    }
}
```

Better options:

- avoid mutable session state,
- use immutable replacement,
- synchronize carefully,
- move state to database with optimistic locking,
- design API operations idempotently.

Example safer pattern:

```java
@SessionScoped
public class SelectedAgency implements Serializable {
    private volatile String agencyCode;

    public String agencyCode() {
        return agencyCode;
    }

    public void agencyCode(String agencyCode) {
        this.agencyCode = Objects.requireNonNull(agencyCode);
    }
}
```

Even here, `volatile` only solves visibility for a simple value. It does not make complex workflows safe.

### 6.6 Session scope design rules

Use session scope when:

- the state is user-specific,
- the state must survive multiple requests,
- the state is small,
- the state is serializable/passivation-friendly,
- the state is not security-critical unless carefully designed,
- concurrent access is understood.

Avoid session scope when:

- data is large,
- data is canonical business state,
- data must be audited/transactional,
- data needs strong consistency,
- state belongs in database or distributed cache,
- multi-tab behavior would be ambiguous.

---

## 7. `@ApplicationScoped`: Shared Application Runtime State

`@ApplicationScoped` means one contextual instance for the application context.

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CasePolicyService {
    public boolean canSubmit(CaseDraft draft) {
        return draft.hasRequiredDocuments();
    }
}
```

### 7.1 Mental model

```text
ApplicationScoped = shared by the whole application deployment
```

This is the closest CDI equivalent to a singleton-like managed service, but it is not identical to a raw Java singleton.

Important differences:

- created/managed by CDI container,
- may be proxied,
- participates in injection/interception/lifecycle,
- destruction is managed by container,
- can depend on other contextual beans through proxies.

### 7.2 Good use cases

Use `@ApplicationScoped` for:

- stateless application services,
- policy/rule services,
- adapters/clients intended to be shared,
- caches with explicit concurrency and eviction design,
- configuration facades,
- feature flag services,
- object mappers if thread-safe,
- clock/time provider,
- ID generator if thread-safe,
- domain workflow orchestrators with no per-request mutable fields.

Example:

```java
@ApplicationScoped
public class FeatureFlagService {
    private final ConcurrentMap<String, Boolean> cache = new ConcurrentHashMap<>();

    public boolean enabled(String flagKey) {
        return cache.getOrDefault(flagKey, false);
    }
}
```

### 7.3 The main danger: mutable shared fields

Bad:

```java
@ApplicationScoped
public class CaseApprovalService {
    private String currentCaseId;

    public void approve(String caseId) {
        this.currentCaseId = caseId;
        // another request may overwrite this field
        validateCurrentCase();
    }
}
```

This is broken under concurrency.

Better:

```java
@ApplicationScoped
public class CaseApprovalService {
    public void approve(String caseId) {
        validate(caseId);
    }

    private void validate(String caseId) {
        // use method-local state
    }
}
```

Application-scoped services should usually be:

```text
stateless, immutable, thread-safe, or explicitly synchronized/concurrent
```

### 7.4 Application scope is not cluster scope

A common mistake:

```text
ApplicationScoped = one instance across the whole cluster
```

Usually false.

In a cluster:

```text
Pod A -> one application context instance
Pod B -> one application context instance
Pod C -> one application context instance
```

So `@ApplicationScoped` cache/state is per JVM/application deployment instance, not automatically globally consistent.

If you need cluster-wide state, use:

- database,
- distributed cache,
- message broker,
- config service,
- feature flag service,
- consensus/lease mechanism where needed.

### 7.5 Startup initialization

Application-scoped beans are not always eagerly initialized unless triggered by runtime rules or implementation-specific features.

Do not assume:

```text
@ApplicationScoped means created at application startup
```

It may be lazily instantiated on first use.

If startup initialization matters, use platform-supported startup hooks or vendor-specific features carefully, and document them.

### 7.6 Application scope design rules

Use application scope when:

- service is stateless,
- shared resource is thread-safe,
- cache has bounded size and eviction,
- object is expensive to create and safe to reuse,
- behavior is independent of one request/user.

Avoid application scope when:

- object stores per-request fields,
- object stores current user,
- object stores transaction-specific state,
- object stores per-case mutable workflow state,
- object assumes one JVM means whole system.

---

## 8. `@ConversationScoped`: Multi-Request Flow State

Conversation scope exists for state that spans multiple requests but is narrower than a session.

Classic example:

- a multi-step wizard,
- a draft form across several pages,
- a search/refine/confirm flow,
- a temporary business transaction UI flow.

```java
import jakarta.enterprise.context.ConversationScoped;
import java.io.Serializable;

@ConversationScoped
public class CaseFilingConversation implements Serializable {
    private String draftId;
    private int currentStep;

    public void nextStep() {
        currentStep++;
    }
}
```

### 8.1 Mental model

```text
ConversationScoped = session-contained but explicitly bounded flow state
```

It sits conceptually between request and session:

```text
Session
└── Conversation A: Create case wizard
└── Conversation B: Edit profile wizard
└── Conversation C: Appeal submission draft
```

### 8.2 Why conversation scope exists

Without conversation scope, engineers often abuse session scope.

They put every wizard/draft flow into session state:

```java
@SessionScoped
public class UserSessionState {
    private CreateCaseDraft createCaseDraft;
    private AppealDraft appealDraft;
    private RenewalDraft renewalDraft;
}
```

This causes:

- state collisions across tabs,
- memory retention after flow ends,
- unclear cleanup,
- accidental stale drafts,
- impossible debugging.

Conversation scope gives a narrower lifecycle.

### 8.3 Why conversation scope is hard

Conversation scope is powerful but tricky because humans do not follow clean linear flows.

Edge cases:

- user opens two tabs for same flow,
- user presses back,
- user bookmarks a URL,
- user refreshes after conversation ended,
- user times out,
- AJAX call misses conversation ID,
- user starts same wizard twice,
- cluster/session failover occurs,
- flow state must be persisted but is only in memory.

### 8.4 Design alternative

For serious enterprise workflows, consider storing flow state in durable storage:

```text
draft_id in URL/session
actual draft state in database
optimistic locking for concurrent edits
request-scoped view model per request
```

Then CDI conversation scope may be unnecessary.

For regulatory/case-management systems, durable draft/workflow state is usually safer than memory-bound conversation state because auditability and recovery matter.

### 8.5 Conversation scope design rules

Use conversation scope when:

- state spans a small number of requests,
- state is UI-flow state, not canonical business state,
- lifecycle begin/end is explicit,
- serialization/passivation is handled,
- tab/window behavior is understood,
- timeout behavior is acceptable.

Avoid conversation scope when:

- flow is business-critical,
- state must survive restart/failover,
- multiple tabs must edit independently,
- auditability is required,
- lifecycle cannot be reliably ended,
- team does not have operational familiarity with conversation IDs.

---

## 9. Scope and Thread Safety

Scope directly affects concurrency risk.

| Scope | Same instance may be accessed concurrently? | Notes |
|---|---:|---|
| `@Dependent` | Depends on owner | If owner is application-scoped, yes |
| `@RequestScoped` | Usually less likely, but possible with async/dispatch | Do not assume impossible |
| `@SessionScoped` | Yes | Multiple browser tabs/AJAX calls |
| `@ApplicationScoped` | Yes | All users/requests may share it |
| `@ConversationScoped` | Yes-ish | Multi-tab or overlapping requests possible |

Top-level rule:

```text
The longer the scope, the more dangerous mutable fields become.
```

### 9.1 Safe field patterns

Usually safe:

```java
@ApplicationScoped
public class TaxRatePolicy {
    private final BigDecimal defaultRate = new BigDecimal("0.07");
}
```

Safe if dependency is thread-safe:

```java
@ApplicationScoped
public class JsonService {
    private final ObjectMapper mapper = new ObjectMapper(); // typically reusable after configuration
}
```

Needs careful design:

```java
@ApplicationScoped
public class CacheService {
    private final Map<String, Value> cache = new HashMap<>(); // unsafe
}
```

Better:

```java
@ApplicationScoped
public class CacheService {
    private final ConcurrentMap<String, Value> cache = new ConcurrentHashMap<>();
}
```

But thread-safe collection alone does not solve:

- eviction,
- memory limits,
- stale data,
- distributed consistency,
- compound operation correctness.

---

## 10. Scope and Memory Retention

Scope decides how long object graphs remain reachable.

```text
RequestScoped      -> usually short retention
SessionScoped      -> user timeout retention
ApplicationScoped  -> deployment lifetime retention
Dependent          -> owner lifetime retention
ConversationScoped -> flow lifetime retention
```

### 10.1 Retention smell

Bad:

```java
@ApplicationScoped
public class LastRequestDebugHolder {
    private Object lastRequestPayload;
}
```

This retains request data beyond request lifetime.

Bad:

```java
@SessionScoped
public class UploadState implements Serializable {
    private byte[] uploadedExcelFile;
}
```

This retains file bytes across user session.

Better:

```text
Store file in object storage / temporary database table.
Keep only uploadId in session/request.
Apply TTL cleanup.
```

### 10.2 Scope memory checklist

For every scoped bean, ask:

```text
1. What is the largest object graph reachable from this bean?
2. How many instances can exist at once?
3. What is the maximum lifetime?
4. What clears it?
5. What happens if the user abandons the flow?
6. What happens in a cluster/restart?
7. Is the state canonical or merely a cache/view?
```

---

## 11. Scope and Serialization / Passivation

Passivation means the container may temporarily store contextual state outside active memory and later restore it.

Passivating scopes matter especially for session and conversation-like state.

Typical rule:

```text
Beans in passivating scopes must be passivation capable.
```

Practically, this often means:

- the bean implements `Serializable`,
- its non-transient fields are serializable or passivation-capable proxies,
- non-serializable resources are marked `transient` and restored safely,
- you do not store raw connections/clients/streams in session/conversation state.

Bad:

```java
@SessionScoped
public class UserApiContext implements Serializable {
    private Socket socket; // not suitable
}
```

Better:

```java
@SessionScoped
public class UserApiContext implements Serializable {
    private String selectedEndpointId;
}

@ApplicationScoped
public class ApiClientRegistry {
    public ApiClient clientFor(String endpointId) {
        // resolve shared client safely
    }
}
```

### 11.1 Serialization is not design correctness

Making a class implement `Serializable` is not enough.

Ask:

```text
After deserialization, is the object still meaningful, safe, and consistent?
```

For simple state: yes.

For live resources: usually no.

---

## 12. Injecting Across Scopes

One of CDI’s most powerful features is injecting beans of different scopes into each other.

But you must understand what is injected.

### 12.1 Long-lived bean injecting short-lived normal-scoped bean

```java
@ApplicationScoped
public class CaseService {
    @Inject
    CurrentRequestContext requestContext; // @RequestScoped proxy
}
```

This is usually okay because `requestContext` is a proxy.

Danger occurs if you call it when no request context is active.

### 12.2 Short-lived bean injecting long-lived bean

```java
@RequestScoped
public class CaseResourceModel {
    @Inject
    CaseService caseService; // @ApplicationScoped service
}
```

Usually safe.

### 12.3 Long-lived bean injecting dependent bean

```java
@ApplicationScoped
public class CaseService {
    @Inject
    MutableFormatter formatter; // @Dependent
}
```

This may be dangerous if `MutableFormatter` is stateful.

Because dependent follows the owner.

### 12.4 Session-scoped bean injecting request-scoped bean

Technically possible via proxy, but design carefully.

```java
@SessionScoped
public class UserSession implements Serializable {
    @Inject
    CurrentRequestMetadata metadata; // request proxy
}
```

This is valid only if methods using `metadata` are called during an active request.

If called during passivation/deserialization/background cleanup, it may fail.

### 12.5 Scope interaction matrix

| Owner bean | Injected bean | Usually okay? | Key risk |
|---|---|---:|---|
| Application | Request | Yes via proxy | context inactive later |
| Application | Dependent | Yes | dependent retained forever |
| Request | Application | Yes | shared service must be thread-safe |
| Session | Request | Sometimes | context inactive / serialization concerns |
| Session | Application | Yes | application dependency must be proxy/passivation safe |
| Conversation | Request | Sometimes | flow/request boundary mismatch |
| Dependent | Any normal scope | Yes | proxy behavior still applies |

---

## 13. Context Active vs Bean Injectable

A bean may be injectable at deployment time but unusable at runtime if its context is inactive.

Important distinction:

```text
Deployment validation: can CDI resolve this dependency by type/qualifier?
Runtime invocation: is the required context active right now?
```

Example:

```java
@ApplicationScoped
public class StartupTask {
    @Inject
    CurrentUser currentUser; // deployment may be okay

    public void runAtStartup() {
        currentUser.userId(); // runtime failure: no request
    }
}
```

The injection point can be valid. The call can still fail.

This explains many confusing CDI issues.

---

## 14. Scope Selection by State Type

A practical way to choose scope is to classify the state.

### 14.1 Pure behavior, no mutable state

Example:

```java
public class EligibilityPolicy {
    public boolean eligible(Applicant applicant) { ... }
}
```

Recommended:

```java
@ApplicationScoped
```

or `@Dependent` if it is a tiny helper and you do not need sharing.

### 14.2 Per-request metadata

Example:

- correlation ID,
- request user,
- client IP abstraction,
- request locale.

Recommended:

```java
@RequestScoped
```

### 14.3 User preference across screens

Example:

- selected agency,
- display settings,
- UI filters.

Recommended:

```java
@SessionScoped
```

But keep it small and serializable.

### 14.4 Multi-step draft

Recommended options:

1. database-backed draft + request-scoped view model,
2. conversation scope for simple UI flows,
3. session scope only as a last resort for small temporary state.

For regulatory/case systems, prefer durable draft storage.

### 14.5 Shared cache

Recommended:

```java
@ApplicationScoped
```

But only with:

- bounded size,
- eviction,
- concurrency strategy,
- stale-data policy,
- cluster consistency decision.

### 14.6 Resource/client wrapper

Example:

- HTTP client,
- database abstraction,
- message producer,
- mapper,
- feature flag client.

Usually:

```java
@ApplicationScoped
```

if thread-safe and expensive to create.

Otherwise use producer/disposer or request-specific creation.

---

## 15. Scope Anti-Patterns

### 15.1 The “current user field” anti-pattern

Bad:

```java
@ApplicationScoped
public class CaseService {
    private String currentUserId;

    public void submit(String userId, String caseId) {
        this.currentUserId = userId;
        // unsafe under concurrent requests
    }
}
```

Better:

```java
@ApplicationScoped
public class CaseService {
    @Inject CurrentUser currentUser; // @RequestScoped proxy

    public void submit(String caseId) {
        String userId = currentUser.userId();
    }
}
```

Or pass user ID explicitly if you want clearer boundaries.

### 15.2 The “session as database” anti-pattern

Bad:

```java
@SessionScoped
public class CaseSessionState implements Serializable {
    private Map<String, CaseDraft> allDrafts = new HashMap<>();
}
```

Better:

```text
Persist drafts in DB with status DRAFT.
Store only draftId/currentStep in session or request.
```

### 15.3 The “application cache without owner” anti-pattern

Bad:

```java
@ApplicationScoped
public class AnythingCache {
    private final Map<String, Object> cache = new ConcurrentHashMap<>();
}
```

Problems:

- no eviction,
- no size bound,
- no type safety,
- no invalidation,
- no metrics,
- no cluster model.

### 15.4 The “dependent but resource-heavy” anti-pattern

Bad:

```java
@Dependent
public class ExternalApiClient {
    private final HttpClient client = HttpClient.newHttpClient();
}
```

If injected many times, you may create more clients than expected.

If injected into application scope, it may live forever anyway.

Better:

```java
@ApplicationScoped
public class ExternalApiClient {
    private final HttpClient client = HttpClient.newHttpClient();
}
```

assuming the client is safe to reuse.

### 15.5 The “scope fixes architecture” anti-pattern

Changing scope is not a substitute for modeling state correctly.

If your domain state needs audit, recovery, locking, approval, or escalation, it probably belongs in durable storage, not in CDI session/conversation state.

---

## 16. Scope in Java 8 to Java 25 Context

The conceptual model of CDI scopes remains stable across Java versions, but the runtime environment changes.

### 16.1 Java 8 era

Typical stack:

- Java EE 7/8,
- `javax.enterprise.context.*`,
- app servers like WildFly, WebLogic, Payara, GlassFish,
- WAR/EAR deployments,
- thread model dominated by platform threads.

Scope issues often appeared in:

- JSF backing beans,
- EJB + CDI integration,
- session passivation,
- EAR classloader boundaries.

### 16.2 Java 11/17 era

Typical changes:

- Jakarta namespace transition,
- containers modernized,
- JPMS exists but most enterprise apps still use classpath/server module models,
- cloud/container deployment becomes common,
- MicroProfile becomes common in Jakarta-style runtimes.

Scope issues now include:

- pod-local application scope,
- config/profile-driven bean behavior,
- async/context propagation,
- container image restart assumptions.

### 16.3 Java 21/25 era

Modern Java introduces stronger pressure to think about concurrency and runtime boundaries:

- virtual threads,
- structured concurrency ideas,
- more cloud-native deployment,
- faster startup expectations,
- build-time CDI variants in some frameworks,
- GraalVM/native-image constraints in some runtimes.

Important principle:

```text
Virtual threads do not automatically make CDI contexts propagate correctly.
```

Even if an operation runs cheaply, you still need correct context activation and safe state ownership.

---

## 17. Scope Design for Regulatory / Case Management Systems

For complex case management, enforcement lifecycle, appeal, renewal, compliance, correspondence, and audit-heavy systems, scope mistakes become business correctness issues.

### 17.1 Good scope mapping

| System concept | Recommended owner |
|---|---|
| Current authenticated principal view | Request scope or security context abstraction |
| Correlation ID | Request scope |
| Case workflow state | Database/domain model |
| Draft submission | Database draft table, not session blob |
| UI selected tab/filter | Request/session depending on UX |
| Feature flag decision | Application service + request evaluation context |
| Audit accumulator | Request scope, then persisted |
| Policy/rule service | Application scope |
| External connector client | Application scope if thread-safe |
| Per-request connector dedup cache | Request scope |
| Long-running job state | Database/job table, not CDI scope |

### 17.2 Example: case submission

Good model:

```text
HTTP request
└── RequestScoped: CurrentUser, CorrelationId, RequestAuditBuffer
    └── ApplicationScoped: CaseSubmissionService
        ├── ApplicationScoped: CasePolicyService
        ├── ApplicationScoped: CaseRepository
        ├── ApplicationScoped: AuditPublisher
        └── RequestScoped: RequestAuditBuffer proxy
```

Durable business state goes to database:

```text
CASE
CASE_STATUS_HISTORY
CASE_ASSIGNMENT
AUDIT_TRAIL
DOCUMENT
```

Not to session scope.

### 17.3 Example: multi-step application form

Avoid:

```text
SessionScoped bean holds entire application form, uploaded docs, validation result, payment response
```

Prefer:

```text
DRAFT_APPLICATION table
DRAFT_DOCUMENT table/object storage
RequestScoped view model
SessionScoped selectedDraftId only if needed
ApplicationScoped workflow/policy services
```

Why?

- user can resume,
- audit is possible,
- server restart is survivable,
- memory is bounded,
- concurrent tab conflicts can be handled with versioning.

---

## 18. Debugging Scope Problems

When scope-related bugs happen, debug by asking these questions.

### 18.1 What is the bean scope?

Check:

```java
@RequestScoped?
@SessionScoped?
@ApplicationScoped?
@Dependent?
@ConversationScoped?
```

If no annotation exists, ask whether it is `@Dependent` or even discovered as a bean.

### 18.2 Is the injected reference a proxy?

Normal-scoped beans are usually proxied.

Symptoms:

- class name contains generated/proxy markers,
- debugger shows unexpected subclass/proxy,
- method call fails only outside context.

### 18.3 Is the context active?

Ask:

```text
Am I inside an HTTP request?
Am I inside an async thread?
Am I inside startup/shutdown?
Am I inside a scheduler/timer?
Did the request already end?
```

### 18.4 Is state stored at the wrong lifetime?

Ask:

```text
Is request/user/case-specific state stored in ApplicationScoped?
Is large/canonical state stored in SessionScoped?
Is resource-heavy state stored in Dependent?
```

### 18.5 Is serialization/passivation failing?

Check:

- bean implements `Serializable`,
- fields are serializable or transient,
- injected dependencies are passivation capable,
- object graph does not include connections/streams/thread pools.

---

## 19. Scope Decision Framework

Use this framework before choosing a scope.

### Step 1: Classify the object

```text
Is this behavior, state, resource, cache, context, policy, or flow?
```

### Step 2: Identify owner

```text
Who should own this object?
- one request?
- one user session?
- one application instance?
- one flow?
- another bean?
```

### Step 3: Identify visibility

```text
Who may observe the same instance?
```

### Step 4: Identify mutation

```text
Does it have mutable fields?
If yes, who can mutate them concurrently?
```

### Step 5: Identify lifetime

```text
How long can it safely retain memory?
```

### Step 6: Identify recoverability

```text
If JVM restarts, does this state need to survive?
```

If yes, CDI scope is probably the wrong owner. Use durable storage.

### Step 7: Identify context availability

```text
Will this object be used in async jobs, schedulers, startup, shutdown, or non-HTTP flows?
```

If yes, be careful with request/session/conversation-scoped dependencies.

---

## 20. Practical Scope Selection Table

| Object | Recommended scope | Why |
|---|---|---|
| `CaseSubmissionService` | `@ApplicationScoped` | Stateless shared use case service |
| `CasePolicyService` | `@ApplicationScoped` | Shared stateless rules |
| `CurrentUser` | `@RequestScoped` | Current request identity view |
| `CorrelationContext` | `@RequestScoped` | One correlation ID per request |
| `RequestAuditBuffer` | `@RequestScoped` | Accumulate audit data for one request |
| `UserPreferences` | `@SessionScoped` | Small user-specific state across requests |
| `DraftWizardState` | Prefer DB; maybe `@ConversationScoped` | Multi-step flow state |
| `HttpClientWrapper` | `@ApplicationScoped` | Shared reusable client if thread-safe |
| `JsonMapper` | `@ApplicationScoped` producer | Expensive reusable mapper if configured immutably |
| `TemporaryFormatter` | `@Dependent` | Stateless helper follows owner |
| `LargeSearchResult` | Not CDI scope | Use paging/query/cache/storage |
| `WorkflowStateMachineInstance` | DB/domain state | Needs audit/recovery/consistency |

---

## 21. Mini Case Study: Wrong Scope Diagnosis

### Problem

A production system has an `@ApplicationScoped` service:

```java
@ApplicationScoped
public class AssignmentService {
    private String currentOfficerId;

    public void assign(String officerId, String caseId) {
        currentOfficerId = officerId;
        validateOfficer(caseId);
        persistAssignment(caseId, currentOfficerId);
    }
}
```

Under load, cases are sometimes assigned to the wrong officer.

### Root cause

`currentOfficerId` is stored in an application-scoped singleton-like service. Multiple requests share the same instance and overwrite the field.

### Correct design

Make request-specific data method-local:

```java
@ApplicationScoped
public class AssignmentService {
    public void assign(String officerId, String caseId) {
        validateOfficer(caseId, officerId);
        persistAssignment(caseId, officerId);
    }
}
```

Or get user/request data from a request-scoped contextual bean:

```java
@ApplicationScoped
public class AssignmentService {
    @Inject
    CurrentUser currentUser;

    public void assignToMe(String caseId) {
        String officerId = currentUser.userId();
        validateOfficer(caseId, officerId);
        persistAssignment(caseId, officerId);
    }
}
```

### Lesson

```text
ApplicationScoped services may contain dependencies.
They should rarely contain per-invocation mutable state.
```

---

## 22. Mini Case Study: Context Not Active in Async

### Problem

```java
@ApplicationScoped
public class NotificationService {
    @Inject
    CurrentUser currentUser; // @RequestScoped

    public void sendLater(String message) {
        CompletableFuture.runAsync(() -> {
            emailClient.send(currentUser.email(), message);
        });
    }
}
```

Failure:

```text
ContextNotActiveException
```

### Root cause

The async task runs outside the active request context. The injected reference is a proxy. When invoked, it cannot resolve the actual request-scoped instance.

### Fix

Capture immutable data while request context is active:

```java
public void sendLater(String message) {
    String email = currentUser.email();

    managedExecutor.runAsync(() -> {
        emailClient.send(email, message);
    });
}
```

### Better enterprise design

For reliable notifications:

```text
Persist notification command -> transaction commits -> async worker/message broker processes -> retry/audit
```

Do not rely on request scope surviving into async execution.

---

## 23. Scope Review Checklist

Use this during code review.

### For every `@ApplicationScoped`

- [ ] Are all fields immutable, thread-safe, or explicitly protected?
- [ ] Are there any per-request/per-user fields?
- [ ] Are caches bounded and observable?
- [ ] Is cluster behavior documented?
- [ ] Are external clients thread-safe?
- [ ] Is startup/lazy initialization understood?

### For every `@RequestScoped`

- [ ] Is state valid only for one request?
- [ ] Is it used only while request context is active?
- [ ] Is async usage capturing immutable data first?
- [ ] Is it free from large/unbounded memory?
- [ ] Is it not used as hidden global context excessively?

### For every `@SessionScoped`

- [ ] Is it serializable/passivation-safe?
- [ ] Is state small?
- [ ] Is concurrent multi-tab access safe?
- [ ] Is security exposure understood?
- [ ] Is timeout/cleanup acceptable?
- [ ] Is canonical business state stored elsewhere?

### For every `@ConversationScoped`

- [ ] Is lifecycle begin/end explicit?
- [ ] Is conversation ID propagation reliable?
- [ ] Are multi-tab/back-button cases handled?
- [ ] Is state serializable/passivation-safe?
- [ ] Is this really better than durable draft storage?

### For every `@Dependent`

- [ ] Is the owner lifecycle safe?
- [ ] Is the object stateless or lightweight?
- [ ] Does it avoid unmanaged resources?
- [ ] If programmatically obtained, is destruction handled if required?

---

## 24. Top 1% Mental Model Summary

Do not choose scope by habit. Choose scope by ownership.

```text
RequestScoped:
  state belongs to one request/unit of work.

SessionScoped:
  state belongs to one user session and is small, serializable, and concurrency-aware.

ApplicationScoped:
  behavior/resource belongs to the application instance and must be thread-safe.

ConversationScoped:
  state belongs to an explicit multi-request flow, with careful lifecycle and tab behavior.

Dependent:
  object belongs to whoever injected or created it.
```

The most important scope invariants:

```text
1. Longer scope must not hold shorter-scope real state directly.
2. Application-scoped mutable fields are shared across users.
3. Session-scoped state is multiplied by active users.
4. Request-scoped proxies fail when request context is inactive.
5. Dependent beans live as long as their owner.
6. CDI scope is not durable business storage.
7. Application scope is not cluster-wide scope.
8. Serialization compatibility is not the same as design correctness.
```

If you internalize those invariants, you can predict CDI behavior instead of memorizing annotation recipes.

---

## 25. What Comes Next

This part explained scope ownership and runtime lifecycle.

The next part goes deeper into how CDI can inject proxies instead of real objects, why normal scopes require proxyable types, why `final` classes can break injection, and why self-invocation can bypass interception.

Next file:

```text
learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-011.md
```

Next topic:

```text
Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
```

---

## References

- Jakarta CDI 4.1 Specification — scopes, contexts, normal scopes, passivation, contextual instances.
- Jakarta EE Tutorial — CDI basic and advanced topics, including scope examples and serialization notes.
- Jakarta EE Platform / CDI runtime model for managed contextual objects.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-009.md">⬅️ Part 009 — Bean Discovery and Archive Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-011.md">Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch ➡️</a>
</div>
