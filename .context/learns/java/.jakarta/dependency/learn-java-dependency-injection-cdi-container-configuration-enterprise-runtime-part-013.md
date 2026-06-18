# Part 013 — Producers and Disposers: Programmatic Object Supply

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-013.md`  
Status: Part 013 of 035  
Target Java: Java 8–25  
Target Enterprise Runtime: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI Full/Lite, application server runtimes, cloud-native CDI-style runtimes

---

## 0. What This Part Is About

In previous parts, we built the core model of CDI:

- a bean is not merely a class;
- a bean has bean types, qualifiers, scope, lifecycle, and contextual identity;
- injection is not a string lookup;
- CDI resolves dependency using type-safe rules;
- scopes define lifecycle and visibility;
- normal scoped beans are usually injected through proxies;
- qualifiers, alternatives, specialization, and priority control implementation selection.

This part introduces one of CDI's most important advanced mechanisms:

> **Producers let you teach the container how to supply an object when that object cannot, should not, or must not be created by the default bean-construction model.**

And its lifecycle counterpart:

> **Disposers let you teach the container how to clean up certain produced objects when their contextual lifecycle ends.**

This is where CDI stops being merely "automatic constructor injection" and becomes a runtime composition system.

A top engineer does not view producers as a convenient trick for "newing" objects. A top engineer sees producers as:

- an integration boundary between CDI and third-party libraries;
- a controlled object factory owned by the container;
- a lifecycle and cleanup contract;
- a way to transform configuration into typed runtime components;
- a way to make external resources injectable without leaking resource creation logic everywhere;
- a mechanism that can either improve architecture greatly or quietly destroy it if abused.

---

## 1. The Core Problem Producers Solve

CDI can automatically manage many application classes:

```java
@ApplicationScoped
public class CaseService {
    @Inject
    CaseRepository repository;
}
```

But real enterprise applications are not made only from your own CDI beans. They contain objects like:

- `Clock`
- `ObjectMapper`
- HTTP clients
- SDK clients
- cryptographic primitives
- database resources
- external connector clients
- generated API clients
- tenant-aware strategy registries
- feature flag clients
- configuration-derived value objects
- legacy classes with no CDI annotations
- classes from third-party libraries
- classes that require complex initialization
- classes that should be created differently per environment
- classes that require cleanup

A class may be unsuitable for default CDI construction because:

1. It is from a third-party library and has no CDI annotations.
2. It has no injectable constructor.
3. It needs values from configuration.
4. It needs another resource before it can be created.
5. It must be wrapped, decorated, adapted, or validated before use.
6. It should be created once and reused.
7. It should be created per request.
8. It needs a specific teardown action.
9. It is not proxyable as a CDI normal scoped bean.
10. It must be selected based on qualifier, profile, tenant, or feature flag.

Without producers, teams often fall back to poor patterns:

```java
public class BadCaseService {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ExternalClient client = new ExternalClient("https://api.example.com");
}
```

or:

```java
public class WorseCaseService {
    private final ExternalClient client = GlobalRegistry.get("externalClient");
}
```

or:

```java
public class AlsoBadCaseService {
    private final ExternalClient client;

    public AlsoBadCaseService() {
        String baseUrl = System.getenv("EXTERNAL_API_URL");
        this.client = new ExternalClient(baseUrl);
    }
}
```

These approaches create problems:

- creation is scattered;
- configuration is read everywhere;
- tests become difficult;
- lifecycle is unclear;
- cleanup is forgotten;
- secret/config handling leaks into business code;
- runtime replacement is painful;
- application startup validation becomes weak;
- observability of runtime wiring disappears.

A producer centralizes this decision:

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Inject
    ExternalClientConfig config;

    @Produces
    @ApplicationScoped
    public ExternalClient externalClient() {
        return ExternalClient.builder()
                .baseUrl(config.baseUrl())
                .connectTimeout(config.connectTimeout())
                .readTimeout(config.readTimeout())
                .build();
    }
}
```

Now application code consumes the dependency normally:

```java
@ApplicationScoped
public class CaseSubmissionService {

    private final ExternalClient externalClient;

    @Inject
    public CaseSubmissionService(ExternalClient externalClient) {
        this.externalClient = externalClient;
    }
}
```

The service does not know how the external client is built. It only knows what it needs.

That is the architectural value.

---

## 2. Producer Mental Model

A producer is not merely a method annotated with `@Produces`.

A better model:

```text
Injection point asks:
    "I need a bean of type T with qualifiers Q."

CDI resolves:
    "The matching bean is not necessarily a class bean.
     It may be a producer method or producer field."

When needed, CDI invokes producer:
    "Call this producer to obtain a contextual instance."

CDI then manages the produced object according to:
    - produced bean type
    - qualifiers
    - scope
    - lifecycle rules
    - disposer, if any
```

In other words:

```text
Producer method/field itself becomes a bean definition.
```

The produced object is the contextual instance of that bean.

---

## 3. Producer Method Basics

A producer method is a method annotated with `@Produces`.

Example:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

@ApplicationScoped
public class ClockProducer {

    @Produces
    @ApplicationScoped
    public Clock systemClock() {
        return Clock.systemUTC();
    }
}
```

Injection:

```java
@ApplicationScoped
public class DeadlineCalculator {

    private final Clock clock;

    @Inject
    public DeadlineCalculator(Clock clock) {
        this.clock = clock;
    }
}
```

Important point:

```text
The bean type is derived from the producer method return type.
```

Here the produced bean type includes `Clock`.

The producer method class, `ClockProducer`, is itself a CDI bean. That means the producer can use injection:

```java
@ApplicationScoped
public class ClientProducer {

    @Inject
    ExternalClientConfig config;

    @Inject
    JsonCodec jsonCodec;

    @Produces
    @ApplicationScoped
    public ExternalClient externalClient() {
        return new ExternalClient(config.baseUrl(), jsonCodec);
    }
}
```

The container creates `ClientProducer`, injects its dependencies, and later invokes its producer method when the produced bean is needed.

---

## 4. Producer Field Basics

A producer can also be a field:

```java
@ApplicationScoped
public class ClockProducer {

    @Produces
    @ApplicationScoped
    Clock clock = Clock.systemUTC();
}
```

Producer fields are simpler, but less flexible.

They are useful when:

- construction is trivial;
- no conditional logic is needed;
- no validation is needed;
- no parameter/injection point metadata is needed;
- no complex error handling is needed.

For enterprise systems, producer methods are usually clearer because they allow:

- validation;
- logging;
- explicit construction flow;
- config mapping;
- fail-fast errors;
- conditional creation;
- defensive wrapping.

Prefer producer methods for anything non-trivial.

---

## 5. Producer Is Still Type-Safe CDI Resolution

Given:

```java
@Produces
@ApplicationScoped
public ObjectMapper objectMapper() {
    return new ObjectMapper();
}
```

And:

```java
@Inject
ObjectMapper mapper;
```

CDI resolves the injection point by normal CDI rules:

```text
Required type: ObjectMapper
Required qualifiers: @Default, @Any
```

The producer method declares a produced bean of type `ObjectMapper` with default qualifiers.

So it matches.

If you add a qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface ExternalApiJson {}
```

Producer:

```java
@Produces
@ExternalApiJson
@ApplicationScoped
public ObjectMapper externalApiObjectMapper() {
    return JsonMapper.builder()
            .findAndAddModules()
            .build();
}
```

Injection:

```java
@Inject
@ExternalApiJson
ObjectMapper mapper;
```

Resolution becomes:

```text
Required type: ObjectMapper
Required qualifiers: @ExternalApiJson, @Any
```

The qualifier is not documentation. It is part of the dependency key.

---

## 6. Producer Scope: Scope of Producer vs Scope of Produced Bean

This is one of the most misunderstood parts.

There are two different things:

1. The scope of the bean that owns the producer method.
2. The scope of the bean produced by the producer method.

Example:

```java
@ApplicationScoped
public class HttpClientProducer {

    @Produces
    @ApplicationScoped
    public HttpClient httpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }
}
```

Here:

```text
HttpClientProducer is @ApplicationScoped.
Produced HttpClient bean is @ApplicationScoped.
```

But you could write:

```java
@ApplicationScoped
public class RequestMetadataProducer {

    @Produces
    @RequestScoped
    public RequestMetadata requestMetadata() {
        return new RequestMetadata(UUID.randomUUID().toString(), Instant.now());
    }
}
```

Here:

```text
Producer owner: @ApplicationScoped
Produced bean: @RequestScoped
```

The owner is long-lived. The produced object is request-scoped.

The scope annotation on the producer method defines the scope of the produced bean.

If no scope is declared on the producer method/field, the produced bean commonly has `@Dependent` scope.

That matters a lot.

---

## 7. The Danger of Accidental `@Dependent` Producers

Suppose:

```java
@ApplicationScoped
public class HttpClientProducer {

    @Produces
    public ExternalClient externalClient() {
        return ExternalClient.create();
    }
}
```

No scope is declared on `externalClient()`.

That means the produced bean is `@Dependent` unless another rule applies.

Potential result:

```text
Every injection target may receive a separate instance.
```

This may be fine for immutable lightweight values, but terrible for expensive resources:

- connection pools;
- SDK clients;
- HTTP clients;
- thread pools;
- cache clients;
- cryptographic providers;
- large mappers;
- remote stubs.

For expensive reusable resources, normally declare scope explicitly:

```java
@Produces
@ApplicationScoped
public ExternalClient externalClient() {
    return ExternalClient.create();
}
```

Rule:

> Never leave the scope of a producer implicit when the produced object has meaningful lifecycle, resource, memory, or performance cost.

---

## 8. Producer Parameters Are Injection Points Too

A producer method can receive parameters, and CDI injects those parameters:

```java
@Produces
@ApplicationScoped
public ExternalClient externalClient(
        ExternalClientConfig config,
        @ExternalApiJson ObjectMapper mapper
) {
    return new ExternalClient(config.baseUrl(), mapper);
}
```

This is often cleaner than field injection inside the producer class.

Compare:

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Inject
    ExternalClientConfig config;

    @Inject
    @ExternalApiJson
    ObjectMapper mapper;

    @Produces
    @ApplicationScoped
    public ExternalClient externalClient() {
        return new ExternalClient(config.baseUrl(), mapper);
    }
}
```

with:

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Produces
    @ApplicationScoped
    public ExternalClient externalClient(
            ExternalClientConfig config,
            @ExternalApiJson ObjectMapper mapper
    ) {
        return new ExternalClient(config.baseUrl(), mapper);
    }
}
```

Parameter injection makes dependencies visible at method level.

This is useful when a producer class contains multiple producers.

---

## 9. Producer as Adapter for Third-Party Classes

Many valuable classes should not be annotated with CDI annotations:

- they come from third-party libraries;
- they are shared across contexts;
- they should remain framework-neutral;
- they are generated;
- they live in infrastructure libraries.

Example:

```java
public final class ExternalRiskClient {
    public ExternalRiskClient(String baseUrl, String apiKey, Duration timeout) {
        // third-party or generated code
    }
}
```

Producer:

```java
@ApplicationScoped
public class ExternalRiskClientProducer {

    @Produces
    @ApplicationScoped
    public ExternalRiskClient externalRiskClient(RiskClientConfig config) {
        return new ExternalRiskClient(
                config.baseUrl(),
                config.apiKey(),
                config.timeout()
        );
    }
}
```

Consumer:

```java
@ApplicationScoped
public class RiskAssessmentService {

    private final ExternalRiskClient riskClient;

    @Inject
    public RiskAssessmentService(ExternalRiskClient riskClient) {
        this.riskClient = riskClient;
    }
}
```

The application service remains clean.

It does not know:

- where the base URL came from;
- how the API key was loaded;
- what timeout is used;
- how the client is constructed;
- whether the client is generated or handwritten.

That knowledge belongs at the infrastructure boundary.

---

## 10. Producer as Configuration-to-Object Boundary

Configuration values are strings or primitive values at the boundary.

Business and infrastructure code should prefer typed objects.

Poor design:

```java
@ApplicationScoped
public class NotificationService {

    public void send(String recipient, String body) {
        String baseUrl = System.getenv("NOTIFICATION_BASE_URL");
        String apiKey = System.getenv("NOTIFICATION_API_KEY");
        int timeoutMs = Integer.parseInt(System.getenv("NOTIFICATION_TIMEOUT_MS"));

        NotificationClient client = new NotificationClient(baseUrl, apiKey, timeoutMs);
        client.send(recipient, body);
    }
}
```

Problems:

- config reading hidden in business method;
- repeated construction;
- no fail-fast validation at startup;
- hard to test;
- no clear secret boundary;
- runtime failures occur late.

Better:

```java
public record NotificationClientConfig(
        URI baseUri,
        String apiKey,
        Duration timeout
) {
    public NotificationClientConfig {
        Objects.requireNonNull(baseUri, "baseUri must not be null");
        Objects.requireNonNull(apiKey, "apiKey must not be null");
        Objects.requireNonNull(timeout, "timeout must not be null");

        if (apiKey.isBlank()) {
            throw new IllegalArgumentException("apiKey must not be blank");
        }
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
    }
}
```

Producer:

```java
@ApplicationScoped
public class NotificationClientProducer {

    @Produces
    @ApplicationScoped
    public NotificationClient notificationClient(NotificationClientConfig config) {
        return NotificationClient.builder()
                .baseUri(config.baseUri())
                .apiKey(config.apiKey())
                .timeout(config.timeout())
                .build();
    }
}
```

Consumer:

```java
@ApplicationScoped
public class NotificationService {

    private final NotificationClient client;

    @Inject
    public NotificationService(NotificationClient client) {
        this.client = client;
    }

    public void send(String recipient, String body) {
        client.send(recipient, body);
    }
}
```

Now the architecture is clearer:

```text
Config source -> typed config -> producer -> runtime client -> application service
```

---

## 11. Producers and Fail-Fast Startup

A producer can validate runtime assumptions early.

Example:

```java
@Produces
@ApplicationScoped
public PaymentGatewayClient paymentGatewayClient(PaymentGatewayConfig config) {
    if (!config.baseUri().getScheme().equals("https")) {
        throw new DeploymentException("Payment gateway base URI must use HTTPS");
    }

    if (config.apiKey().isBlank()) {
        throw new DeploymentException("Payment gateway API key is required");
    }

    return new PaymentGatewayClient(config.baseUri(), config.apiKey());
}
```

Whether this fails at deployment/startup or first usage depends on:

- CDI implementation;
- bean scope;
- eager/lazy behavior;
- whether the bean is initialized at startup;
- whether the producer is invoked during validation.

For critical resources, consider explicit startup validation:

```java
@ApplicationScoped
public class StartupRuntimeValidator {

    @Inject
    PaymentGatewayClient paymentGatewayClient;

    public void onStart(@Observes StartupEvent event) {
        paymentGatewayClient.ping();
    }
}
```

The exact startup event depends on runtime. Jakarta EE and CDI implementations differ. Some runtimes provide proprietary or MicroProfile-oriented startup hooks. The principle is stable:

> Critical runtime dependencies should fail early, loudly, and observably.

---

## 12. Producer with `InjectionPoint`

CDI can inject metadata about the injection point into a producer method using `InjectionPoint`.

Example: create a logger per declaring class.

```java
import jakarta.enterprise.inject.Produces;
import jakarta.enterprise.inject.spi.InjectionPoint;
import java.util.logging.Logger;

@ApplicationScoped
public class LoggerProducer {

    @Produces
    public Logger logger(InjectionPoint injectionPoint) {
        Class<?> declaringClass = injectionPoint
                .getMember()
                .getDeclaringClass();

        return Logger.getLogger(declaringClass.getName());
    }
}
```

Usage:

```java
@ApplicationScoped
public class CaseReviewService {

    @Inject
    Logger logger;
}
```

The `Logger` name becomes `CaseReviewService`.

This pattern is useful for:

- loggers;
- metric names;
- audit source metadata;
- per-injection-point adapters;
- contextual labels;
- typed registry lookup.

But it can be abused.

Bad use:

```java
@Produces
public Object anything(InjectionPoint ip) {
    String fieldName = ip.getMember().getName();
    return GlobalMagicRegistry.lookup(fieldName);
}
```

That becomes string-based hidden wiring.

Rule:

> Use `InjectionPoint` for metadata enrichment, not for bypassing type-safe dependency resolution.

---

## 13. Producer Qualifier Members and `InjectionPoint`

Suppose you need named remote endpoints without using `@Named` strings everywhere.

Define a qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface RemoteEndpoint {
    String value();
}
```

Producer:

```java
@ApplicationScoped
public class RemoteClientProducer {

    @Inject
    RemoteEndpointRegistry registry;

    @Produces
    @RemoteEndpoint("")
    public RemoteClient remoteClient(InjectionPoint injectionPoint) {
        RemoteEndpoint qualifier = injectionPoint
                .getAnnotated()
                .getAnnotation(RemoteEndpoint.class);

        String endpointName = qualifier.value();
        EndpointConfig config = registry.get(endpointName);

        return new RemoteClient(config.baseUri(), config.timeout());
    }
}
```

Injection:

```java
@Inject
@RemoteEndpoint("risk")
RemoteClient riskClient;

@Inject
@RemoteEndpoint("notification")
RemoteClient notificationClient;
```

This pattern looks elegant, but has trade-offs.

Pros:

- compact injection site;
- config-driven client construction;
- avoids many producer methods;
- centralizes client creation.

Cons:

- qualifier member values become runtime keys;
- typo risk unless validated;
- harder to search usages;
- produced objects may be too dynamic;
- lifecycle may be unclear;
- if each injection point creates a client, resource count can explode.

If you use this pattern, add validation:

```java
if (!registry.exists(endpointName)) {
    throw new DeploymentException("Unknown remote endpoint: " + endpointName);
}
```

For critical clients, explicit qualifiers are often safer:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface RiskApi {}

@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface NotificationApi {}
```

Then:

```java
@Produces
@RiskApi
@ApplicationScoped
RemoteClient riskClient(...) { ... }

@Produces
@NotificationApi
@ApplicationScoped
RemoteClient notificationClient(...) { ... }
```

Trade-off:

```text
Dynamic qualifier member:
    less boilerplate, more runtime validation burden.

Explicit qualifier type:
    more boilerplate, stronger semantic clarity.
```

---

## 14. Producer and Custom Qualifier Design

A producer's qualifier should communicate semantic role, not construction detail.

Poor qualifier:

```java
@Qualifier
public @interface UsesTimeoutFiveSeconds {}
```

Better:

```java
@Qualifier
public @interface ExternalCaseApi {}
```

Why?

Because timeout is an implementation/config detail. The semantic role is the external case API.

Injection site should say what dependency role is needed:

```java
@Inject
@ExternalCaseApi
ExternalClient client;
```

not how it is internally configured:

```java
@Inject
@UsesTimeoutFiveSeconds
ExternalClient client;
```

Good qualifier names:

- `@InternalSystem`
- `@ExternalSystem`
- `@CaseManagementApi`
- `@DocumentServiceApi`
- `@AuditWriter`
- `@RegulatoryClock`
- `@SystemClock`
- `@BusinessCalendarClock`
- `@PrimaryDataSource`
- `@ReportingDataSource`
- `@ReadModel`
- `@CommandModel`

Bad qualifier names:

- `@Fast`
- `@New`
- `@Impl1`
- `@Prod`
- `@Debug`
- `@Timeout30`
- `@HttpClientA`

Unless those names are truly domain semantics, avoid them.

---

## 15. Producer for `Clock`: A Small Example with Big Design Value

Time is one of the most common hidden dependencies.

Bad:

```java
public boolean isExpired(Deadline deadline) {
    return Instant.now().isAfter(deadline.instant());
}
```

This is hard to test.

Better:

```java
@ApplicationScoped
public class TimeProducer {

    @Produces
    @ApplicationScoped
    public Clock clock() {
        return Clock.systemUTC();
    }
}
```

Usage:

```java
@ApplicationScoped
public class DeadlinePolicy {

    private final Clock clock;

    @Inject
    public DeadlinePolicy(Clock clock) {
        this.clock = clock;
    }

    public boolean isExpired(Deadline deadline) {
        return clock.instant().isAfter(deadline.instant());
    }
}
```

Test override:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class FixedClockProducer {

    @Produces
    @ApplicationScoped
    public Clock fixedClock() {
        return Clock.fixed(
                Instant.parse("2026-01-01T00:00:00Z"),
                ZoneOffset.UTC
        );
    }
}
```

This small decision changes architecture quality:

- deterministic tests;
- consistent time zone;
- central place to define business clock;
- easier simulation;
- no hidden `Instant.now()` spread across code.

---

## 16. Producer for JSON Mapper

JSON mappers are often shared infrastructure resources.

Bad:

```java
ObjectMapper mapper = new ObjectMapper();
```

repeated everywhere.

Better:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface ExternalJson {}
```

Producer:

```java
@ApplicationScoped
public class JsonMapperProducer {

    @Produces
    @ExternalJson
    @ApplicationScoped
    public ObjectMapper externalJsonMapper() {
        return JsonMapper.builder()
                .findAndAddModules()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .serializationInclusion(JsonInclude.Include.NON_NULL)
                .build();
    }
}
```

Consumer:

```java
@Inject
@ExternalJson
ObjectMapper mapper;
```

But be careful:

- object mapper config is a contract;
- changing mapper behavior can break external integration;
- different APIs may need different mappers;
- do not use one global mapper for incompatible JSON contracts.

Better for strict systems:

```java
@CaseApiJson
ObjectMapper caseApiMapper;

@PaymentApiJson
ObjectMapper paymentApiMapper;

@InternalEventJson
ObjectMapper internalEventMapper;
```

The qualifier makes serialization contract explicit.

---

## 17. Producer for HTTP Client

Java 11 introduced the standard `java.net.http.HttpClient`.

Producer:

```java
@ApplicationScoped
public class HttpClientProducer {

    @Produces
    @ApplicationScoped
    public HttpClient httpClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_2)
                .build();
    }
}
```

Consumer:

```java
@ApplicationScoped
public class AddressLookupGateway {

    private final HttpClient httpClient;

    @Inject
    public AddressLookupGateway(HttpClient httpClient) {
        this.httpClient = httpClient;
    }
}
```

This is fine if all clients share the same generic HTTP client.

But external APIs often need distinct semantic clients:

```java
@Inject
@OneMapApi
HttpClient oneMapHttpClient;

@Inject
@MyInfoApi
HttpClient myInfoHttpClient;
```

Or better, hide `HttpClient` behind a domain adapter:

```java
@Inject
AddressLookupClient addressLookupClient;
```

A producer may produce the higher-level client:

```java
@Produces
@ApplicationScoped
public AddressLookupClient addressLookupClient(
        HttpClient httpClient,
        AddressLookupConfig config,
        @ExternalJson ObjectMapper mapper
) {
    return new DefaultAddressLookupClient(httpClient, config.baseUri(), mapper);
}
```

Rule:

> Application services should usually inject semantic clients, not raw transport clients.

Raw HTTP client injection belongs closer to infrastructure adapter code.

---

## 18. Producer for SDK Clients

Cloud SDK clients, payment clients, messaging clients, and external API clients often have builder APIs.

Example:

```java
@Produces
@ApplicationScoped
public DocumentStorageClient documentStorageClient(DocumentStorageConfig config) {
    return DocumentStorageClient.builder()
            .endpoint(config.endpoint())
            .region(config.region())
            .credentialsProvider(config.credentialsProvider())
            .build();
}
```

Important design questions:

1. Is the client thread-safe?
2. Is it expensive to create?
3. Does it own connection pools?
4. Does it own background threads?
5. Does it need explicit close?
6. Does it refresh credentials internally?
7. Does it cache DNS or endpoint data?
8. Is it safe to share across tenants?
9. Does it contain secret material?
10. Does it behave differently in local/dev/prod?

If the client is expensive and thread-safe, use `@ApplicationScoped`.

If it is not thread-safe, do not share it globally. Instead:

- produce a factory;
- use `@Dependent` carefully;
- create per operation;
- wrap with thread-safe adapter;
- use a pool if appropriate.

Producer decision depends on object semantics, not convenience.

---

## 19. Producer for Factories

Sometimes the right injectable dependency is not the final object, but a factory.

Example: client varies by tenant.

Bad:

```java
@Inject
TenantConfigRepository configRepository;

public void process(TenantId tenantId) {
    TenantConfig config = configRepository.get(tenantId);
    ExternalClient client = new ExternalClient(config.baseUrl(), config.apiKey());
    client.call();
}
```

Better:

```java
public interface TenantClientFactory {
    ExternalClient forTenant(TenantId tenantId);
}
```

Implementation:

```java
@ApplicationScoped
public class DefaultTenantClientFactory implements TenantClientFactory {

    private final TenantConfigRepository configRepository;
    private final ExternalClientCache cache;

    @Inject
    public DefaultTenantClientFactory(
            TenantConfigRepository configRepository,
            ExternalClientCache cache
    ) {
        this.configRepository = configRepository;
        this.cache = cache;
    }

    @Override
    public ExternalClient forTenant(TenantId tenantId) {
        return cache.getOrCreate(tenantId, () -> {
            TenantConfig config = configRepository.get(tenantId);
            return new ExternalClient(config.baseUrl(), config.apiKey());
        });
    }
}
```

Producer if the factory needs custom construction:

```java
@Produces
@ApplicationScoped
public TenantClientFactory tenantClientFactory(
        TenantConfigRepository repository,
        ExternalClientCache cache
) {
    return new DefaultTenantClientFactory(repository, cache);
}
```

This keeps runtime variability explicit.

Rule:

> If the dependency varies per request, tenant, user, case, or operation, injecting a singleton final object may be wrong. Inject a factory, registry, or strategy selector instead.

---

## 20. Producer vs `Instance<T>`

CDI provides `Instance<T>` for dynamic lookup.

Example:

```java
@Inject
Instance<PaymentProcessor> processors;
```

You can select by qualifier:

```java
PaymentProcessor processor = processors
        .select(new CreditCardLiteral())
        .get();
```

A producer can also use `Instance<T>`:

```java
@Produces
@RequestScoped
public PaymentProcessor paymentProcessor(
        PaymentRequestContext context,
        Instance<PaymentProcessor> processors
) {
    return switch (context.method()) {
        case CREDIT_CARD -> processors.select(new CreditCardLiteral()).get();
        case BANK_TRANSFER -> processors.select(new BankTransferLiteral()).get();
    };
}
```

But be careful.

This can turn into hidden service locator logic if overused.

Good use:

- bridge request context into selected strategy;
- select based on explicit domain decision;
- centralize routing;
- fail if no strategy exists.

Bad use:

- inject `Instance<Object>` and dynamically fetch anything;
- hide arbitrary dependency lookup in business logic;
- avoid constructor dependencies;
- bypass design clarity.

A producer using `Instance<T>` should still produce a semantically meaningful dependency.

---

## 21. Producers and Circular Dependencies

Producers can accidentally create circular graphs.

Example:

```java
@ApplicationScoped
public class AProducer {

    @Produces
    @ApplicationScoped
    public A a(B b) {
        return new A(b);
    }
}

@ApplicationScoped
public class BProducer {

    @Produces
    @ApplicationScoped
    public B b(A a) {
        return new B(a);
    }
}
```

Graph:

```text
A -> B -> A
```

CDI may detect this directly, or it may fail at runtime depending on proxyability and scopes.

A producer does not magically solve circular dependencies. It can hide them.

If you see circular producer graphs, ask:

- Are these two concepts actually one concept?
- Should one side depend on an interface instead?
- Should a domain event decouple them?
- Should a factory delay one side explicitly?
- Should the relationship be inverted?
- Is there a missing application service boundary?

Do not use `Provider<T>` or `Instance<T>` merely to silence a circular dependency unless the laziness is a real domain/runtime requirement.

---

## 22. Disposer Methods: The Cleanup Counterpart

A producer can create objects that require cleanup.

Examples:

- file handles;
- temporary directories;
- socket clients;
- custom connection objects;
- cryptographic session handles;
- native resources;
- manually created SDK clients;
- test containers;
- unmanaged legacy resources.

A disposer method is associated with a producer and called when the produced contextual instance is destroyed.

Example:

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Produces
    @ApplicationScoped
    public ExternalClient externalClient(ExternalClientConfig config) {
        return ExternalClient.create(config.baseUri(), config.apiKey());
    }

    public void closeExternalClient(@Disposes ExternalClient client) {
        client.close();
    }
}
```

The parameter annotated with `@Disposes` identifies what this disposer disposes.

The disposer matches by:

- type;
- qualifier;
- produced bean association rules.

If the producer has a qualifier, the disposer should generally match it:

```java
@Produces
@RiskApi
@ApplicationScoped
public ExternalClient riskClient(RiskConfig config) {
    return ExternalClient.create(config.baseUri(), config.apiKey());
}

public void closeRiskClient(@Disposes @RiskApi ExternalClient client) {
    client.close();
}
```

---

## 23. When Is Disposer Called?

The disposer is called when CDI destroys the contextual instance.

That depends on scope:

```text
@ApplicationScoped produced bean:
    disposed when application context shuts down.

@RequestScoped produced bean:
    disposed when request context ends.

@SessionScoped produced bean:
    disposed when session ends.

@Dependent produced bean:
    disposed when owning bean/injection point lifecycle ends, subject to CDI dependent object rules.
```

This is why scope matters.

Example:

```java
@Produces
@RequestScoped
public TemporaryRequestWorkspace workspace() {
    return TemporaryRequestWorkspace.create();
}

public void deleteWorkspace(@Disposes TemporaryRequestWorkspace workspace) {
    workspace.deleteRecursively();
}
```

This makes sense if each request needs temporary workspace cleanup.

But this would be dangerous:

```java
@Produces
@RequestScoped
public ExpensiveSharedHttpClient httpClient() {
    return new ExpensiveSharedHttpClient();
}

public void close(@Disposes ExpensiveSharedHttpClient client) {
    client.close();
}
```

You would create and close an expensive client per request.

Better:

```java
@Produces
@ApplicationScoped
public ExpensiveSharedHttpClient httpClient() {
    return new ExpensiveSharedHttpClient();
}
```

---

## 24. Disposer Method Parameters Can Also Be Injected

A disposer method can receive additional injected parameters.

Example:

```java
public void closeClient(
        @Disposes @RiskApi ExternalClient client,
        ShutdownAudit audit
) {
    try {
        client.close();
        audit.record("Risk client closed");
    } catch (Exception e) {
        audit.recordFailure("Risk client close failed", e);
    }
}
```

Use this carefully.

Disposer logic should usually be:

- simple;
- reliable;
- idempotent where possible;
- safe during shutdown;
- not dependent on fragile external services.

During shutdown, not every service may still be healthy. Avoid complex disposer operations that require active remote systems.

---

## 25. Disposer Should Be Idempotent and Defensive

Shutdown logic is often called under degraded conditions.

Example:

```java
public void closeClient(@Disposes ExternalClient client) {
    try {
        client.close();
    } catch (Exception e) {
        LOGGER.log(Level.WARNING, "Failed to close external client", e);
    }
}
```

But do not always swallow errors silently. Decide based on phase:

- during startup failure cleanup, logging may be enough;
- during normal shutdown, logging may be enough;
- during request-scoped resource cleanup, failure may need request failure or metric;
- during transaction-bound cleanup, failure may affect consistency.

A good disposer answers:

```text
If cleanup fails, who needs to know?
Can the system continue?
Is data consistency affected?
Is resource leakage acceptable temporarily?
Should this increment a metric?
Should it trigger alerting?
```

---

## 26. Producer and Disposer for Resource-Like Object

Example: temporary file workspace.

```java
@RequestScoped
public class WorkspaceProducer {

    @Produces
    @RequestScoped
    public RequestWorkspace requestWorkspace() {
        try {
            Path dir = Files.createTempDirectory("case-workspace-");
            return new RequestWorkspace(dir);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to create request workspace", e);
        }
    }

    public void cleanup(@Disposes RequestWorkspace workspace) {
        try {
            workspace.deleteRecursively();
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to delete request workspace", e);
        }
    }
}
```

Consumer:

```java
@ApplicationScoped
public class DocumentUploadService {

    private final RequestWorkspace workspace;

    @Inject
    public DocumentUploadService(RequestWorkspace workspace) {
        this.workspace = workspace;
    }
}
```

This only works if `RequestWorkspace` is used while request context is active.

If used in async tasks after response returns, the request context may be gone.

Then the workspace may already be disposed.

This connects to Part 030 on managed executors and context propagation.

---

## 27. Producer for Managed vs Unmanaged Resources

Not all resources should be manually produced.

In Jakarta EE, the container may already manage resources such as:

- `DataSource`
- JMS connection factories
- managed executors
- mail sessions
- JTA transaction manager
- security context

Often these should be injected using Jakarta resource injection, JNDI, or platform-specific config rather than manually created.

Bad:

```java
@Produces
@ApplicationScoped
public DataSource dataSource() {
    HikariDataSource ds = new HikariDataSource();
    ds.setJdbcUrl(System.getenv("DB_URL"));
    ds.setUsername(System.getenv("DB_USER"));
    ds.setPassword(System.getenv("DB_PASSWORD"));
    return ds;
}
```

This may be fine in a standalone runtime, but questionable in a full Jakarta EE server where datasource pooling, transaction enlistment, security, monitoring, and lifecycle should be container-managed.

Jakarta EE-style:

```java
@Resource(lookup = "java:comp/env/jdbc/CaseManagementDS")
DataSource dataSource;
```

Bridge to CDI if needed:

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(lookup = "java:comp/env/jdbc/CaseManagementDS")
    DataSource dataSource;

    @Produces
    @PrimaryDataSource
    public DataSource primaryDataSource() {
        return dataSource;
    }
}
```

This producer does not create the datasource. It adapts a container-managed resource into a qualified CDI dependency.

That is a strong pattern.

---

## 28. Producer as Resource Adapter Boundary

A producer can translate platform resource lookup into domain-specific abstractions.

Example:

```java
public interface CaseRepositoryConnectionProvider {
    Connection getConnection() throws SQLException;
}
```

Producer:

```java
@ApplicationScoped
public class RepositoryConnectionProviderProducer {

    @Resource(lookup = "java:comp/env/jdbc/CaseManagementDS")
    DataSource dataSource;

    @Produces
    @ApplicationScoped
    public CaseRepositoryConnectionProvider provider() {
        return dataSource::getConnection;
    }
}
```

Consumer:

```java
@ApplicationScoped
public class JdbcCaseRepository {

    private final CaseRepositoryConnectionProvider connectionProvider;

    @Inject
    public JdbcCaseRepository(CaseRepositoryConnectionProvider connectionProvider) {
        this.connectionProvider = connectionProvider;
    }
}
```

This makes testing easier:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class TestConnectionProviderProducer {

    @Produces
    @ApplicationScoped
    public CaseRepositoryConnectionProvider provider() {
        return new InMemoryConnectionProvider();
    }
}
```

But be cautious not to abstract platform resources unnecessarily. Abstractions should encode useful semantics, not just hide standard APIs.

---

## 29. Producer and Transaction Boundary

A producer should generally not open long-lived transactions.

Bad:

```java
@Produces
@RequestScoped
public EntityManager entityManager(EntityManagerFactory emf) {
    EntityManager em = emf.createEntityManager();
    em.getTransaction().begin();
    return em;
}
```

Why risky:

- transaction lifecycle becomes hidden;
- rollback behavior unclear;
- exception handling scattered;
- integration with container-managed transaction may break;
- request duration may become transaction duration;
- DB locks may be held too long.

In Jakarta EE, use container-managed persistence and transactions when available:

```java
@PersistenceContext
EntityManager entityManager;
```

or CDI-integrated transaction boundary if your runtime supports it.

A producer may adapt an `EntityManager` only with clear rules and in runtimes where this is appropriate. Do not build your own transaction manager casually.

Rule:

> Producers are good for object supply. They are not a replacement for transaction boundary design.

---

## 30. Producer and Security Boundary

Producers often create clients that use credentials.

Example:

```java
@Produces
@ApplicationScoped
public ExternalClient externalClient(SecretProvider secrets, ExternalClientConfig config) {
    String apiKey = secrets.get("external-api-key");
    return new ExternalClient(config.baseUri(), apiKey);
}
```

Security considerations:

- avoid logging secrets;
- avoid storing secrets in public fields;
- avoid exposing client config through unsafe debug endpoints;
- ensure secret rotation strategy exists;
- decide whether client must refresh credentials dynamically;
- avoid putting user-specific credentials in application-scoped singleton unless intended;
- be careful with multi-tenant credentials.

If secret can rotate, an `@ApplicationScoped` client with secret captured at startup may become stale.

Alternative:

```java
@ApplicationScoped
public class ExternalClientFactory {

    private final SecretProvider secrets;
    private final ExternalClientConfig config;

    @Inject
    public ExternalClientFactory(SecretProvider secrets, ExternalClientConfig config) {
        this.secrets = secrets;
        this.config = config;
    }

    public ExternalClient currentClient() {
        String apiKey = secrets.current("external-api-key");
        return new ExternalClient(config.baseUri(), apiKey);
    }
}
```

Or use a client that supports credential provider abstraction:

```java
return ExternalClient.builder()
        .baseUri(config.baseUri())
        .credentialProvider(secrets::currentExternalApiKey)
        .build();
```

Producer design must match credential lifecycle.

---

## 31. Producer for Feature-Flagged Runtime Components

Suppose you are migrating from old connector to new connector.

```java
public interface AddressLookupClient {
    Address lookup(PostalCode postalCode);
}
```

Two implementations:

```java
@ApplicationScoped
@LegacyAddressLookup
public class LegacyAddressLookupClient implements AddressLookupClient { ... }

@ApplicationScoped
@NewAddressLookup
public class NewAddressLookupClient implements AddressLookupClient { ... }
```

Producer:

```java
@Produces
@RequestScoped
public AddressLookupClient addressLookupClient(
        FeatureFlags flags,
        @LegacyAddressLookup AddressLookupClient legacyClient,
        @NewAddressLookup AddressLookupClient newClient
) {
    if (flags.isEnabled("new-address-lookup")) {
        return newClient;
    }
    return legacyClient;
}
```

This is simple, but has implications:

- decision is made when request-scoped produced bean is resolved;
- different requests may use different implementation;
- if injected into an application-scoped bean, scope mismatch/proxy behavior matters;
- observability is needed to know which path was used;
- if flag changes mid-request, behavior should remain stable or intentionally dynamic.

Better for per-call decision:

```java
@ApplicationScoped
public class FeatureFlaggedAddressLookupClient implements AddressLookupClient {

    private final FeatureFlags flags;
    private final AddressLookupClient legacy;
    private final AddressLookupClient modern;

    @Inject
    public FeatureFlaggedAddressLookupClient(
            FeatureFlags flags,
            @LegacyAddressLookup AddressLookupClient legacy,
            @NewAddressLookup AddressLookupClient modern
    ) {
        this.flags = flags;
        this.legacy = legacy;
        this.modern = modern;
    }

    @Override
    public Address lookup(PostalCode postalCode) {
        if (flags.isEnabled("new-address-lookup")) {
            return modern.lookup(postalCode);
        }
        return legacy.lookup(postalCode);
    }
}
```

Then producer may not be needed.

Decision matrix:

```text
Startup-time fixed selection:
    producer or alternative.

Request-time selection:
    request-scoped producer or request-aware strategy.

Per-call dynamic selection:
    wrapper/decorator/strategy selector.

Cross-cutting enable/deny behavior:
    interceptor or decorator.
```

This topic returns in Part 028 and Part 029.

---

## 32. Producer vs Alternative

Both producers and alternatives can change wiring.

Alternative example:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class MockPaymentGateway implements PaymentGateway { ... }
```

Producer example:

```java
@Produces
@ApplicationScoped
public PaymentGateway paymentGateway(PaymentConfig config) {
    return switch (config.provider()) {
        case STRIPE -> new StripePaymentGateway(config.stripe());
        case ADYEN -> new AdyenPaymentGateway(config.adyen());
    };
}
```

Use alternative when:

- replacing one bean with another;
- test/dev override;
- environment-specific implementation;
- implementation itself is CDI-manageable.

Use producer when:

- object requires construction logic;
- object comes from third-party library;
- creation depends on config;
- creation needs validation;
- result is not naturally a CDI bean;
- cleanup may be needed.

Sometimes they combine:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class TestPaymentGatewayProducer {

    @Produces
    @ApplicationScoped
    public PaymentGateway testPaymentGateway() {
        return new FakePaymentGateway();
    }
}
```

But avoid too many layers of indirection.

---

## 33. Producer vs Decorator

Producer creates or supplies dependency.

Decorator wraps an existing dependency to alter/enrich behavior.

Producer:

```java
@Produces
@ApplicationScoped
public ExternalClient externalClient(Config config) {
    return new ExternalClient(config.baseUri());
}
```

Decorator:

```java
@Decorator
public class AuditedExternalClient implements ExternalClient {

    @Inject
    @Delegate
    ExternalClient delegate;

    @Override
    public Response call(Request request) {
        audit.before(request);
        Response response = delegate.call(request);
        audit.after(response);
        return response;
    }
}
```

Use producer for:

- construction;
- configuration;
- resource acquisition;
- third-party adaptation.

Use decorator for:

- semantic behavior wrapping;
- compliance enforcement;
- enrichment;
- fallback;
- audit behavior tied to interface semantics.

Do not put too much behavior in producer-created anonymous wrappers. It becomes hard to test and inspect.

Bad:

```java
@Produces
public ExternalClient client() {
    ExternalClient raw = new ExternalClient(...);
    return request -> {
        audit(request);
        validate(request);
        retry(() -> raw.call(request));
    };
}
```

Better:

- producer creates raw client;
- decorator/interceptor/wrapper service handles behavior;
- tests target each concern.

---

## 34. Producer vs Interceptor

Producer supplies object.

Interceptor surrounds method invocation.

Use interceptor for cross-cutting behavior:

- logging;
- metrics;
- tracing;
- transaction;
- security;
- retry;
- timeout;
- idempotency guard.

Use producer for object construction.

Bad producer:

```java
@Produces
public CaseService caseService() {
    return new CaseServiceWithManualMetrics(new CaseServiceImpl(...));
}
```

Better:

```java
@Measured
public void submitCase(...) { ... }
```

and an interceptor handles metrics.

Producer should not become your aspect framework.

---

## 35. Producer Return Type: Interface vs Concrete Type

Producer return type affects bean types.

Example:

```java
@Produces
@ApplicationScoped
public DefaultPaymentGateway paymentGateway() {
    return new DefaultPaymentGateway();
}
```

Injection:

```java
@Inject
DefaultPaymentGateway gateway; // works
```

But:

```java
@Inject
PaymentGateway gateway; // depends on bean types and producer return type rules
```

Safer:

```java
@Produces
@ApplicationScoped
public PaymentGateway paymentGateway() {
    return new DefaultPaymentGateway();
}
```

Now injection by interface is explicit.

Architectural rule:

> Return the most meaningful stable abstraction that consumers should depend on.

If consumers should depend on `PaymentGateway`, return `PaymentGateway`.

If consumers truly need `DefaultPaymentGateway`, return the concrete type.

Do not accidentally expose implementation type as the primary dependency contract.

---

## 36. Producer and Generic Types

Generic producer:

```java
@Produces
@ApplicationScoped
public Repository<Case> caseRepository() {
    return new JdbcRepository<>(Case.class);
}
```

Injection:

```java
@Inject
Repository<Case> caseRepository;
```

CDI type resolution understands parameterized types within its rules.

But generic producers can become tricky with:

- type erasure;
- wildcards;
- raw types;
- producer methods returning broad generic types;
- dynamic entity class selection.

Avoid this:

```java
@Produces
public Repository<?> repository(InjectionPoint ip) { ... }
```

unless you deeply understand the resolution and lifecycle consequences.

For enterprise code, explicit is often better:

```java
@Produces
@CaseRepositoryBean
@ApplicationScoped
Repository<Case> caseRepository(...) { ... }

@Produces
@AppealRepositoryBean
@ApplicationScoped
Repository<Appeal> appealRepository(...) { ... }
```

or use typed repository classes.

---

## 37. Producer and Primitive/String Values

You can produce simple values:

```java
@Produces
@ApplicationName
String applicationName() {
    return "aceas";
}
```

But this can go wrong quickly.

Bad:

```java
@Inject
String baseUrl;

@Inject
String apiKey;

@Inject
String moduleName;
```

Multiple unqualified `String` producers cause ambiguity.

If producing primitive/string values, always use qualifiers:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface NotificationBaseUrl {}
```

```java
@Produces
@NotificationBaseUrl
String notificationBaseUrl(Config config) {
    return config.get("notification.base-url");
}
```

But even better: produce typed config objects.

Instead of:

```java
@Inject @NotificationBaseUrl String baseUrl;
@Inject @NotificationApiKey String apiKey;
@Inject @NotificationTimeout Duration timeout;
```

Use:

```java
@Inject
NotificationClientConfig config;
```

Typed config is easier to validate and evolve.

---

## 38. Producer and Null Values

A producer must not return `null` for normal CDI dependency expectations unless the specification/runtime allows a specific case and you know exactly what you are doing.

Bad:

```java
@Produces
public ExternalClient externalClient(Config config) {
    if (!config.enabled()) {
        return null;
    }
    return new ExternalClient(config.baseUri());
}
```

This creates confusing failure behavior.

Better alternatives:

1. Produce a no-op implementation.

```java
@Produces
@ApplicationScoped
public ExternalClient externalClient(Config config) {
    if (!config.enabled()) {
        return new NoopExternalClient();
    }
    return new RealExternalClient(config.baseUri());
}
```

2. Use `Optional<ExternalClient>` carefully.

```java
@Produces
public Optional<ExternalClient> optionalExternalClient(Config config) {
    if (!config.enabled()) {
        return Optional.empty();
    }
    return Optional.of(new RealExternalClient(config.baseUri()));
}
```

3. Use feature flag at call boundary.

4. Fail deployment if required dependency is disabled.

Returning null is usually a smell.

---

## 39. Producer and Exceptions

Producer exceptions become dependency creation failures.

Example:

```java
@Produces
@ApplicationScoped
public ExternalClient externalClient(Config config) {
    try {
        return ExternalClient.create(config.baseUri());
    } catch (ExternalClientException e) {
        throw new DeploymentException("Failed to create ExternalClient", e);
    }
}
```

Good producer exception messages include:

- which dependency failed;
- which semantic qualifier/client/resource;
- which configuration key is relevant;
- whether secret value is missing without printing the secret;
- whether failure is retryable;
- whether startup should abort.

Bad:

```text
Failed to create client
```

Better:

```text
Failed to create @RiskApi ExternalClient: risk.api.base-url is invalid or unreachable
```

Never log raw secrets.

---

## 40. Producer and Lazy Initialization

CDI may not call a producer until the produced bean is needed.

For expensive clients, lazy creation can reduce startup time.

But for critical dependencies, lazy creation can move failure from startup to first production request.

Trade-off:

```text
Lazy producer:
    + faster startup
    + avoids unused resources
    - failures occur later
    - first request may be slow
    - operational readiness may be misleading

Eager validation:
    + fail fast
    + readiness is meaningful
    - slower startup
    - may initialize unused paths
```

For critical systems, distinguish:

- construction readiness;
- connectivity readiness;
- business readiness;
- degraded mode readiness.

A producer creates the object. A health/readiness check validates its runtime usability.

---

## 41. Producer and Caching

A producer is not always the right place for caching.

Bad:

```java
@Produces
public ExternalClient externalClient(Config config) {
    return cache.computeIfAbsent(config.key(), key -> new ExternalClient(...));
}
```

This may be acceptable for tenant-aware factories, but dangerous for ordinary CDI injection.

Ask:

- Is CDI scope already enough?
- Is cache key stable?
- Who evicts entries?
- Who closes clients on eviction?
- Is cache thread-safe?
- Are secrets rotated?
- Is tenant isolation required?
- What is max size?
- What happens on config change?

If caching is needed, prefer an explicit factory/cache component:

```java
@ApplicationScoped
public class TenantClientRegistry {
    public ExternalClient get(TenantId tenantId) { ... }
}
```

Then inject the registry.

Producer should not hide unbounded resource caches.

---

## 42. Producer and Thread Safety

Scope implies sharing.

If you produce:

```java
@Produces
@ApplicationScoped
public MutableFormatter formatter() {
    return new MutableFormatter();
}
```

Every injection point effectively shares the same contextual instance.

If `MutableFormatter` is not thread-safe, this is a bug.

For application-scoped produced objects, verify:

- immutable or thread-safe;
- safe publication;
- internal caches are concurrent;
- no request/user-specific mutable state;
- no transaction-specific mutable state;
- no security-principal-specific mutable state.

If not thread-safe:

- make it `@Dependent` only if lightweight;
- create per operation;
- use `ThreadLocal` only with extreme care;
- wrap access with synchronization if appropriate;
- choose a thread-safe alternative.

Top-level rule:

> Scope is also a concurrency decision.

---

## 43. Producer and Passivation

Session/conversation-scoped beans may need passivation capability depending on runtime and deployment mode.

If a produced object is injected into a passivating scope, consider serializability/passivation rules.

Example risk:

```java
@SessionScoped
public class UserWorkflowState implements Serializable {

    @Inject
    ExternalClient client;
}
```

If `ExternalClient` is not serializable and not safely proxied, passivation may fail.

Better:

- inject an application-scoped proxyable client;
- mark transient and reacquire safely if appropriate;
- avoid heavy external clients in session state;
- store only lightweight workflow state in session;
- keep infrastructure dependencies application scoped.

Passivation issues often appear only in clustered/session-replication environments. Do not ignore them in enterprise systems.

---

## 44. Producer and `@Dependent` Object Lifecycle

`@Dependent` is subtle.

A dependent produced object is tied to the lifecycle of the bean or injection point that receives it.

Example:

```java
@Produces
public Helper helper() {
    return new Helper();
}
```

If injected into an application-scoped bean:

```java
@ApplicationScoped
public class CaseService {
    @Inject
    Helper helper;
}
```

The helper may live as long as the `CaseService` instance.

If injected into a request-scoped bean, it lives with that request-scoped bean.

If programmatically obtained and not destroyed, dependent instances may leak.

This becomes important with:

- `Instance<T>.get()`;
- dynamic selection;
- produced resources;
- non-trivial cleanup.

When using `Instance<T>` to obtain dependent objects, understand destruction responsibility.

Modern CDI APIs provide mechanisms to destroy dependent instances obtained programmatically. Use them where applicable.

---

## 45. Producer and `AutoCloseable`

A common temptation:

```java
@Produces
@RequestScoped
public SomeResource resource() {
    return new SomeResource();
}
```

If `SomeResource` implements `AutoCloseable`, CDI does not automatically know your intended cleanup semantics unless supported by runtime-specific behavior or disposer rules.

Write disposer explicitly:

```java
public void close(@Disposes SomeResource resource) {
    resource.close();
}
```

This is clearer, portable, and reviewable.

Rule:

> Do not rely on implicit cleanup assumptions for produced external resources. Make cleanup explicit with a disposer.

---

## 46. Producer and Observability

Producer-created dependencies are operationally important.

For critical producers, consider logging safely at startup:

```java
@Produces
@ApplicationScoped
@RiskApi
public ExternalClient riskClient(RiskConfig config) {
    LOGGER.info(() -> "Creating @RiskApi ExternalClient for host="
            + config.baseUri().getHost());

    return ExternalClient.create(config.baseUri(), config.apiKey());
}
```

Do not log:

- API keys;
- passwords;
- full secret URLs;
- tokens;
- private certificates;
- PII-bearing config.

Do log:

- semantic client name;
- host/region/environment;
- timeout values if non-sensitive;
- pool size if relevant;
- feature flag mode if relevant;
- fallback mode;
- config source/version if safe.

Metrics to consider:

- producer creation success/failure;
- client initialization latency;
- connection pool size;
- failed disposer cleanup;
- feature-selected implementation count;
- stale credential count;
- config validation failures.

A dependency that is invisible operationally is hard to debug during incidents.

---

## 47. Producer and Health Checks

Producer creation does not prove dependency health.

Example:

```java
ExternalClient client = new ExternalClient("https://api.example.com");
```

This may succeed even if:

- DNS is broken;
- firewall blocks connection;
- certificate is invalid;
- credentials are wrong;
- remote service is down;
- route is misconfigured.

A readiness check should test the real contract:

```java
@ApplicationScoped
public class RiskApiReadinessCheck {

    private final ExternalClient client;

    @Inject
    public RiskApiReadinessCheck(@RiskApi ExternalClient client) {
        this.client = client;
    }

    public HealthResult check() {
        return client.ping()
                ? HealthResult.up("risk-api")
                : HealthResult.down("risk-api");
    }
}
```

But do not overload health checks:

- too frequent remote calls can harm dependencies;
- deep checks can cause cascading failures;
- readiness semantics differ from liveness;
- degraded mode may be acceptable.

Producer creates dependency. Health check validates runtime availability.

---

## 48. Producer and Testing

Producers make testing easier when used well.

Production producer:

```java
@ApplicationScoped
public class PaymentGatewayProducer {

    @Produces
    @ApplicationScoped
    public PaymentGateway paymentGateway(PaymentGatewayConfig config) {
        return new RealPaymentGateway(config.baseUri(), config.apiKey());
    }
}
```

Test alternative:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class TestPaymentGatewayProducer {

    @Produces
    @ApplicationScoped
    public PaymentGateway paymentGateway() {
        return new FakePaymentGateway();
    }
}
```

Or test-specific config:

```java
@Produces
@ApplicationScoped
public PaymentGateway paymentGateway() {
    return new StubPaymentGateway();
}
```

But tests should verify more than "CDI can inject".

Test dimensions:

- correct qualifier selected;
- required config is validated;
- invalid config fails fast;
- disposer closes resource;
- fake replacement works;
- ambiguous producer is detected;
- startup validation catches missing secrets;
- feature-flagged producer selects intended implementation.

---

## 49. Producer Anti-Pattern: Hidden Service Locator

Bad producer:

```java
@Produces
public Object produceAnything(InjectionPoint ip) {
    return GlobalRegistry.lookup(ip.getMember().getName());
}
```

Why bad:

- type safety lost;
- wiring becomes name-based;
- compile-time checks disappear;
- refactoring breaks runtime;
- dependency graph becomes invisible;
- container validation is weakened.

Better:

- explicit producer per semantic dependency;
- qualifier-based selection;
- typed factory;
- registry with typed key and validation;
- avoid arbitrary `Object` production.

A producer should increase clarity, not create magic.

---

## 50. Producer Anti-Pattern: Business Logic in Producer

Bad:

```java
@Produces
public ApprovalPolicy approvalPolicy(Config config, UserRepository users) {
    if (users.countSeniorOfficers() > 10 && config.region().equals("SG")) {
        return new ComplexApprovalPolicy(...);
    }
    return new SimpleApprovalPolicy(...);
}
```

Producer is now performing business decisioning.

Better:

```java
@ApplicationScoped
public class ApprovalPolicySelector {
    public ApprovalPolicy select(CaseContext context) { ... }
}
```

Producer may wire the selector, but should not embed per-case business rules.

Rule:

> Producers are for dependency construction and runtime wiring, not domain workflow execution.

---

## 51. Producer Anti-Pattern: Too Many Primitive Producers

Bad:

```java
@Produces @A String a() { ... }
@Produces @B String b() { ... }
@Produces @C String c() { ... }
@Produces @D Integer d() { ... }
@Produces @E Boolean e() { ... }
```

This creates dependency noise.

Better:

```java
public record ExternalApiConfig(
        URI baseUri,
        Duration timeout,
        int maxRetries,
        boolean enabled
) {}
```

```java
@Produces
@ApplicationScoped
public ExternalApiConfig externalApiConfig(Config config) { ... }
```

Then inject:

```java
ExternalApiConfig config
```

Typed config is cohesive and easier to validate.

---

## 52. Producer Anti-Pattern: Replacing Constructor Injection Everywhere

Bad:

```java
@Produces
public CaseService caseService() {
    return new CaseService(
        new CaseRepository(),
        new AuditWriter(),
        new NotificationClient()
    );
}
```

This bypasses CDI graph validation and reintroduces manual wiring.

Better:

```java
@ApplicationScoped
public class CaseService {
    private final CaseRepository repository;
    private final AuditWriter auditWriter;
    private final NotificationClient notificationClient;

    @Inject
    public CaseService(
            CaseRepository repository,
            AuditWriter auditWriter,
            NotificationClient notificationClient
    ) {
        this.repository = repository;
        this.auditWriter = auditWriter;
        this.notificationClient = notificationClient;
    }
}
```

Use producers for objects that need programmatic supply, not for ordinary application services that CDI can construct naturally.

---

## 53. Producer Anti-Pattern: Runtime Profile Logic Everywhere

Bad:

```java
@Produces
public ExternalClient client() {
    String env = System.getenv("ENV");
    if (env.equals("prod")) return prodClient();
    if (env.equals("uat")) return uatClient();
    if (env.equals("dev")) return devClient();
    return localClient();
}
```

Problems:

- environment names hardcoded;
- fallback can be dangerous;
- prod may accidentally use dev config;
- test matrix unclear.

Better:

- use config source/profile mechanism;
- same producer reads typed config;
- deployment controls config values;
- fail if required config missing.

```java
@Produces
@ApplicationScoped
public ExternalClient client(ExternalClientConfig config) {
    return new ExternalClient(config.baseUri(), config.apiKey(), config.timeout());
}
```

Profile-specific values belong in configuration, not branching code, unless implementation truly differs.

---

## 54. Producer Anti-Pattern: Creating Threads

Bad:

```java
@Produces
@ApplicationScoped
public ExecutorService executorService() {
    return Executors.newFixedThreadPool(20);
}
```

In Jakarta EE, unmanaged threads are dangerous because they may not carry:

- security context;
- request context;
- transaction context;
- naming context;
- lifecycle integration;
- shutdown coordination;
- monitoring.

Prefer managed executor where available:

```java
@Resource
ManagedExecutorService executorService;
```

Bridge to CDI if necessary:

```java
@Produces
@ApplicationScoped
public ManagedExecutorService managedExecutor() {
    return executorService;
}
```

In non-Jakarta or cloud-native runtime, use runtime-provided managed executor abstractions if available.

Threading belongs to container/runtime design, not arbitrary producers.

---

## 55. Producer Anti-Pattern: Static Global Producer Access

Bad:

```java
public class Clients {
    public static ExternalClient client;
}

@Produces
public ExternalClient client() {
    Clients.client = new ExternalClient(...);
    return Clients.client;
}
```

This creates global mutable state and bypasses CDI.

Problems:

- tests leak state;
- classloader redeploy leaks;
- shutdown cleanup unclear;
- multiple deployments conflict;
- concurrency issues;
- impossible to reason about lifecycle.

If something must be globally shared within application runtime, use `@ApplicationScoped` and inject it.

---

## 56. Good Producer Design Checklist

Before writing a producer, answer:

1. Why can CDI not construct this object normally?
2. What semantic dependency is being supplied?
3. What is the correct abstraction type?
4. What qualifier identifies its role?
5. What scope matches its lifecycle?
6. Is the object thread-safe for that scope?
7. Does it hold external resources?
8. Does it need a disposer?
9. Does it capture secrets?
10. Does it need credential refresh?
11. Does it depend on environment/profile?
12. Should selection happen at startup, request, or per call?
13. What happens if creation fails?
14. Is failure message actionable?
15. How is it tested?
16. How is it observed in production?
17. What happens on shutdown?
18. Could this become a service locator?
19. Is business logic leaking into wiring?
20. Is the dependency graph still understandable?

If many answers are unclear, the producer design is not ready.

---

## 57. Producer Decision Matrix

| Situation | Good Fit for Producer? | Better Alternative |
|---|---:|---|
| Third-party class needs config-based construction | Yes | N/A |
| `Clock` / deterministic time dependency | Yes | N/A |
| Raw primitive config values | Sometimes | Typed config object |
| Container-managed `DataSource` | Bridge only | `@Resource`, JNDI, platform config |
| Ordinary application service | Usually no | Constructor injection |
| Runtime strategy selected per request | Maybe | Strategy selector / request-scoped producer |
| Runtime strategy selected per call | Usually no | Wrapper/decorator/selector |
| Cross-cutting metrics/audit/retry | Usually no | Interceptor/decorator |
| Heavy thread-safe client | Yes, `@ApplicationScoped` | N/A |
| Non-thread-safe client | Maybe | Factory/per-operation creation |
| Resource needing cleanup | Yes, with disposer | Container-managed resource if available |
| Tenant-varying client | Maybe | Tenant-aware factory/registry |
| Dynamic lookup by string | Risky | Qualifier/typed registry |

---

## 58. Example: Regulatory Case Management Runtime Producers

Assume a regulatory case management system with:

- case workflow;
- audit trail;
- document storage;
- external address lookup;
- notification connector;
- feature flags;
- security-sensitive configuration.

### 58.1 Domain-facing interfaces

```java
public interface AddressLookupClient {
    Address lookup(PostalCode postalCode);
}

public interface DocumentStorageClient {
    StoredDocument store(DocumentUpload upload);
}

public interface AuditWriter {
    void write(AuditEvent event);
}
```

### 58.2 Qualifiers

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface OneMapAddressLookup {}

@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface S3DocumentStorage {}

@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface DatabaseAuditWriter {}
```

### 58.3 Config records

```java
public record AddressLookupConfig(
        URI baseUri,
        Duration timeout,
        int maxRetries
) {}

public record DocumentStorageConfig(
        String bucket,
        String region,
        Duration timeout
) {}
```

### 58.4 Producers

```java
@ApplicationScoped
public class RuntimeClientProducers {

    @Produces
    @ApplicationScoped
    @OneMapAddressLookup
    public AddressLookupClient addressLookupClient(
            HttpClient httpClient,
            AddressLookupConfig config,
            @ExternalJson ObjectMapper mapper
    ) {
        return new OneMapAddressLookupClient(
                httpClient,
                config.baseUri(),
                config.timeout(),
                config.maxRetries(),
                mapper
        );
    }

    @Produces
    @ApplicationScoped
    @S3DocumentStorage
    public DocumentStorageClient documentStorageClient(DocumentStorageConfig config) {
        return new S3DocumentStorageClient(
                config.bucket(),
                config.region(),
                config.timeout()
        );
    }
}
```

### 58.5 Application service consumes semantic dependencies

```java
@ApplicationScoped
public class CaseSubmissionService {

    private final AddressLookupClient addressLookup;
    private final DocumentStorageClient documentStorage;
    private final AuditWriter auditWriter;

    @Inject
    public CaseSubmissionService(
            @OneMapAddressLookup AddressLookupClient addressLookup,
            @S3DocumentStorage DocumentStorageClient documentStorage,
            @DatabaseAuditWriter AuditWriter auditWriter
    ) {
        this.addressLookup = addressLookup;
        this.documentStorage = documentStorage;
        this.auditWriter = auditWriter;
    }
}
```

The service does not know:

- how OneMap token is acquired;
- where document bucket is configured;
- how HTTP client is built;
- how audit writer connects to DB;
- how JSON mapper is configured.

This separation allows:

- safer testing;
- easier migration;
- centralized config validation;
- clearer failure diagnosis;
- better runtime ownership.

---

## 59. Example: Producer with Disposer for Token-Aware Client

Suppose a client owns an internal scheduler or connection pool.

```java
public final class TokenAwareExternalClient implements AutoCloseable {

    public TokenAwareExternalClient(URI baseUri, TokenProvider tokenProvider) {
        // creates internal resources
    }

    public Response call(Request request) { ... }

    @Override
    public void close() {
        // stop scheduler / close pool
    }
}
```

Producer:

```java
@ApplicationScoped
public class TokenAwareClientProducer {

    @Produces
    @ApplicationScoped
    @ExternalCaseApi
    public TokenAwareExternalClient client(
            ExternalCaseApiConfig config,
            TokenProvider tokenProvider
    ) {
        return new TokenAwareExternalClient(config.baseUri(), tokenProvider);
    }

    public void close(@Disposes @ExternalCaseApi TokenAwareExternalClient client) {
        client.close();
    }
}
```

Important review questions:

- Is token provider thread-safe?
- Does client refresh token or token provider does?
- What happens when token refresh fails?
- Is `close()` idempotent?
- Are close failures logged?
- Should readiness check verify token acquisition?
- Are secrets excluded from logs?

---

## 60. Example: Avoiding Mixed Namespace Problems in Producers

In Java EE 8:

```java
import javax.enterprise.inject.Produces;
import javax.enterprise.context.ApplicationScoped;
```

In Jakarta EE 9+:

```java
import jakarta.enterprise.inject.Produces;
import jakarta.enterprise.context.ApplicationScoped;
```

Do not mix:

```java
import javax.enterprise.inject.Produces;
import jakarta.enterprise.context.ApplicationScoped;
```

A producer annotated with the wrong namespace may not be recognized by the target runtime.

Symptom:

```text
Unsatisfied dependency for type ExternalClient
```

The class exists. The method exists. But the annotation belongs to the wrong API namespace.

Migration checklist for producers:

- update `@Produces` namespace;
- update `@Disposes` namespace;
- update qualifiers;
- update scopes;
- update `InjectionPoint`;
- update `Instance<T>`;
- update `Provider<T>` if using `javax.inject` vs `jakarta.inject`;
- scan generated sources;
- scan test producers;
- scan shared test fixtures.

---

## 61. Producer Failure Taxonomy

| Symptom | Likely Cause | How to Think |
|---|---|---|
| Unsatisfied dependency | Producer not discovered, wrong qualifier, wrong return type, wrong namespace | Is the producer a bean? Does it match type + qualifier? |
| Ambiguous dependency | Class bean and producer both match, or multiple producers match | Which bean definitions expose same type + qualifier? |
| Unproxyable type | Produced bean has normal scope but type cannot be proxied | Change type/scope/interface/proxyability |
| Resource leak | Produced object needs cleanup but no disposer | Add disposer or use container-managed resource |
| Too many instances | Producer accidentally `@Dependent` | Declare scope explicitly |
| Stale credential | Application-scoped client captured rotating secret | Use credential provider or recreate strategy |
| Startup succeeds but first request fails | Lazy producer or no readiness check | Add validation/readiness |
| Wrong implementation selected | Qualifier/profile/feature flag mismatch | Log selection and test matrix |
| ClassCastException | Classloader duplicate API/client classes | Check deployment isolation and dependency scopes |
| Producer not called | Injection point resolved to another bean | Inspect bean graph/resolution |

---

## 62. Practical Debugging Flow

When a producer-based dependency fails, debug in this order:

```text
1. Is the producer class discoverable as a CDI bean?
2. Is the producer method/field annotated with the correct @Produces namespace?
3. What bean type does the producer expose?
4. What qualifiers does the produced bean have?
5. What scope does the produced bean have?
6. Does the injection point request exactly matching type + qualifiers?
7. Are there competing beans/producers with same type + qualifiers?
8. Is the produced type proxyable for its scope?
9. Does the producer require config that is missing/invalid?
10. Does the producer create a resource that needs cleanup?
11. Is the failure at deployment, first injection, first method call, or shutdown?
12. Is the runtime using javax or jakarta namespace?
13. Is the dependency provided by server or packaged in application?
14. Are classloaders loading duplicate versions?
```

This flow prevents random annotation tweaking.

---

## 63. Design Heuristics for Top-Level Engineering

### 63.1 Producers should be rare enough to review carefully

If every other class needs a producer, something is wrong.

Most application services should be ordinary CDI beans with constructor injection.

Producers are for boundary objects and special construction.

### 63.2 Producers should encode runtime ownership

A producer says:

```text
This runtime owns creation of this dependency here.
```

So make lifecycle explicit.

### 63.3 Qualifiers should encode semantics

Do not use qualifiers as random labels.

### 63.4 Producer logic should be boring

Good producer logic is straightforward:

```text
read typed config -> validate -> build dependency -> return
```

Not:

```text
perform business workflow -> query many repositories -> decide domain policy -> create object
```

### 63.5 Disposers should be reliable

Cleanup should not be more fragile than creation.

### 63.6 Test producer behavior at boundaries

Especially for:

- config validation;
- secret absence;
- wrong profile;
- alternative/test override;
- resource cleanup;
- feature-flagged selection.

### 63.7 Observe runtime wiring

During incident, you should be able to answer:

```text
Which implementation is active?
Which endpoint is configured?
Which feature mode is selected?
Was the client created?
Did cleanup run?
```

without exposing secrets.

---

## 64. Review Checklist for Pull Requests

When reviewing code that introduces a producer/disposer, ask:

```text
[ ] Is a producer actually necessary?
[ ] Could constructor injection handle this naturally?
[ ] Is the produced type the right abstraction?
[ ] Are qualifiers semantic and specific enough?
[ ] Is the scope explicit?
[ ] Is the produced object thread-safe for its scope?
[ ] Is config typed and validated?
[ ] Are secrets protected from logs/errors/debug endpoints?
[ ] Does the object need a disposer?
[ ] Is disposer qualifier matched correctly?
[ ] Is cleanup idempotent or defensive?
[ ] Is failure message actionable?
[ ] Is startup/readiness behavior intentional?
[ ] Are test overrides clear?
[ ] Does this hide service locator behavior?
[ ] Does this put business logic into wiring?
[ ] Does it behave correctly under javax/jakarta namespace target?
[ ] Does it avoid classloader/provider conflicts?
```

---

## 65. Mini Exercise 1 — Identify the Smell

Code:

```java
@ApplicationScoped
public class EverythingProducer {

    @Produces
    public ExternalClient client() {
        String env = System.getenv("ENV");
        if (env.equals("prod")) {
            return new ExternalClient("https://prod.example.com", System.getenv("PROD_KEY"));
        }
        return new ExternalClient("https://dev.example.com", "dev-key");
    }
}
```

Problems:

- scope implicit, probably `@Dependent`;
- hardcoded environment branching;
- dangerous default fallback to dev;
- secret read directly from env inside construction;
- no typed config;
- no validation;
- no disposer if client needs close;
- no qualifier;
- no safe logging;
- weak testability.

Better:

```java
@Produces
@ApplicationScoped
@ExternalCaseApi
public ExternalClient client(ExternalCaseApiConfig config, SecretProvider secrets) {
    String apiKey = secrets.required("external-case-api-key");
    return new ExternalClient(config.baseUri(), apiKey, config.timeout());
}
```

---

## 66. Mini Exercise 2 — Choose Scope

Dependency: `ObjectMapper`

Recommended scope:

```text
@ApplicationScoped, if configured once and thread-safe after construction.
```

Dependency: temporary request upload directory

Recommended scope:

```text
@RequestScoped with disposer.
```

Dependency: tenant-specific external API client with per-tenant credentials

Recommended design:

```text
Probably not one global produced client.
Use @ApplicationScoped factory/registry with bounded cache and explicit cleanup/rotation strategy.
```

Dependency: user-specific access token

Recommended scope:

```text
Usually request/session/security context, not application-scoped singleton.
Be careful with storage and leakage.
```

Dependency: `Clock`

Recommended scope:

```text
@ApplicationScoped for system clock; alternative producer for fixed test clock.
```

---

## 67. Mini Exercise 3 — Producer or Decorator?

Requirement:

```text
All calls to DocumentStorageClient must write audit event before and after storing.
```

Better fit:

```text
Decorator or interceptor, not producer.
```

Requirement:

```text
DocumentStorageClient must be built from bucket/region/credential config.
```

Better fit:

```text
Producer.
```

Requirement:

```text
Use old document storage for agency A, new document storage for agency B, per request.
```

Better fit:

```text
Strategy selector or request-aware wrapper. Producer only if selection lifecycle is clearly request-scoped.
```

---

## 68. Summary Mental Model

A producer is a CDI bean definition whose instance is supplied by a method or field instead of direct class construction.

Use producers when:

- object creation needs programmatic logic;
- object comes from a third-party library;
- object must be configured from external configuration;
- object needs validation before becoming injectable;
- object requires cleanup through a disposer;
- container-managed resource needs to be adapted into CDI;
- semantic runtime dependency must be made injectable.

Do not use producers to:

- manually wire ordinary services;
- hide service locator behavior;
- embed business workflow logic;
- create unmanaged threads in Jakarta EE;
- scatter primitive config values;
- bypass transaction/resource management;
- return null as a feature toggle;
- hide dynamic behavior that should be explicit.

A strong producer design has:

```text
clear semantic type
+ meaningful qualifier
+ explicit scope
+ typed config
+ safe failure behavior
+ cleanup if needed
+ test override strategy
+ production observability
```

---

## 69. How This Part Connects to the Next Parts

This part completes an important part of CDI composition:

- Part 008 explained CDI bean resolution.
- Part 009 explained bean discovery.
- Part 010 explained scopes.
- Part 011 explained proxies.
- Part 012 explained qualifiers and alternatives.
- Part 013 explained producers and disposers.

Next:

```text
Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
```

Events introduce another kind of runtime indirection:

```text
Instead of "who supplies this dependency?"
we ask:
"who reacts to this occurrence?"
```

That is powerful, but dangerous if it creates invisible workflow coupling.

---

## 70. Completion Status

This is **Part 013 of 035**.

The series is **not finished yet**.

Completed:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
[x] Part 013 — Producers and Disposers: Programmatic Object Supply
```

Next:

```text
[ ] Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 012 — Qualifiers, Alternatives, Specialization, and Priority](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-014.md)
