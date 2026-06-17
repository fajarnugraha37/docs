# Part 026 — MicroProfile Config Deep Dive

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-026.md`  
Level: Advanced / Enterprise Runtime Engineering  
Java target: Java 8 → Java 25  
Namespace context: `javax.*` legacy, `jakarta.*` modern  
Primary focus: MicroProfile Config as a unified, type-safe, CDI-integrated configuration model

---

## 0. Why This Part Exists

Part 025 introduced configuration as a runtime contract. It explained that configuration is not merely “a property file”; it is the boundary between code, deployment, environment, secret management, runtime behavior, and operational safety.

This part goes deeper into **MicroProfile Config**.

MicroProfile Config is one of the most important specifications for modern Jakarta/MicroProfile style applications because it gives a standard model for reading configuration from multiple places as one consistent view.

The key mental shift is this:

```text
Old mental model:
    My app reads config from a file.

Better mental model:
    My app asks a configuration system for a typed property.
    The configuration system resolves the effective value from ordered sources.
    The source can be file, env var, system property, container, custom provider, secret store, database, etc.
```

In enterprise systems, this difference matters because production behavior is rarely controlled by one file. It is affected by:

- container environment variables,
- JVM system properties,
- application packaged defaults,
- Kubernetes ConfigMap/Secret projection,
- server-specific configuration,
- CI/CD deployment parameters,
- custom runtime sources,
- profile-specific overrides,
- feature flags,
- secret management systems,
- and sometimes database-backed operational settings.

MicroProfile Config gives a standard abstraction for this mess.

---

## 1. Position in the Series

You already learned:

- Part 000: enterprise runtime mental model.
- Part 001: dependency management.
- Part 002: API/SPI/implementation/provider separation.
- Part 003: `javax.*` → `jakarta.*` migration.
- Part 004: runtime/container ownership.
- Part 005: classloader/deployment isolation.
- Part 006–019: DI/CDI core, scopes, proxies, producers, events, interceptors, decorators, lifecycle, extensions.
- Part 020–024: Enterprise Beans, resource injection, JNDI, externalized resources.
- Part 025: configuration fundamentals.

This part connects configuration into CDI/runtime design.

We are not just learning API calls. We are learning how to design a configuration layer that remains:

- predictable,
- testable,
- typed,
- observable,
- secure,
- portable,
- and resilient under deployment drift.

---

## 2. What MicroProfile Config Solves

MicroProfile Config solves a concrete enterprise problem:

> How can an application read configuration from multiple environment-aware sources, apply deterministic precedence, convert values into Java types, and expose them through a portable API and CDI injection?

Without a configuration abstraction, code tends to degrade into this:

```java
String url = System.getenv("PAYMENT_URL");
if (url == null) {
    url = System.getProperty("payment.url");
}
if (url == null) {
    Properties p = new Properties();
    p.load(...);
    url = p.getProperty("payment.url");
}
if (url == null) {
    url = "http://localhost:8080";
}
```

This seems harmless at first. But in a large system, it creates:

- inconsistent precedence rules,
- inconsistent naming conventions,
- duplicated defaulting logic,
- string parsing everywhere,
- missing validation,
- no central observability,
- hard-to-test runtime behavior,
- accidental secret logging,
- and unclear responsibility between application and deployment.

MicroProfile Config centralizes the pattern:

```java
@Inject
@ConfigProperty(name = "payment.base-url")
URI paymentBaseUrl;
```

The application says what it needs. The configuration system resolves where it comes from.

---

## 3. Important Scope Clarification

MicroProfile Config is part of **Eclipse MicroProfile**, not Jakarta EE Platform 11 itself.

That means:

- Jakarta EE servers may or may not include MicroProfile Config unless they also support MicroProfile.
- Runtimes like Open Liberty, Payara, WildFly, Helidon, Quarkus, and others may support MicroProfile Config depending on version/profile.
- Jakarta Config is under development as a Jakarta EE specification project and is conceptually related to MicroProfile Config, but it should not be assumed to be part of all current Jakarta EE deployments.

For production design, always ask:

```text
Does my target runtime support MicroProfile Config version X?
Does it support it with jakarta.* packages?
Does it integrate with CDI in the way I expect?
Are vendor-specific profile features being used?
```

This matters during migration from Java EE 8 / MicroProfile 3.x / `javax.*` to Jakarta EE 10/11 / MicroProfile 6.x/7.x / `jakarta.*`.

---

## 4. The Core Architecture

MicroProfile Config has several core concepts:

```text
Application code
    |
    | asks for property by name and type
    v
Config
    |
    | searches ordered ConfigSources
    v
ConfigSource #1, #2, #3, ...
    |
    | returns raw String value
    v
Converter<T>
    |
    | converts String -> target Java type
    v
Typed value injected or returned
```

The main concepts are:

| Concept | Meaning |
|---|---|
| `Config` | Main API for retrieving configuration values. |
| `ConfigProvider` | Static access point for current `Config`. |
| `ConfigSource` | Source of raw configuration key/value pairs. |
| `Converter<T>` | Converts a raw string into a typed Java value. |
| `@ConfigProperty` | CDI injection annotation for config values. |
| Ordinal | Priority number used to decide which source wins. |
| Property name | Canonical key used to identify a configuration value. |
| Effective value | Final value after source precedence and conversion. |

The resolution process is deterministic:

```text
Given property name: app.timeout
Given desired type: Duration

1. Ask all ConfigSources whether they contain app.timeout.
2. Sort matching sources by ordinal.
3. Pick the value from the highest-priority source.
4. Convert String value into Duration.
5. Return/inject typed result.
```

---

## 5. ConfigSource: The Foundation

A `ConfigSource` is a provider of key/value pairs.

Conceptually:

```java
public interface ConfigSource {
    Map<String, String> getProperties();
    Set<String> getPropertyNames();
    String getValue(String propertyName);
    String getName();
    int getOrdinal();
}
```

A source can be:

- system properties,
- environment variables,
- packaged `META-INF/microprofile-config.properties`,
- external file,
- Kubernetes-projected file,
- database table,
- HTTP service,
- vault/secret manager,
- config server,
- tenant configuration store,
- runtime-specific source.

The power is not merely having multiple sources. The power is having a **portable precedence model**.

---

## 6. Default Config Sources and Ordinals

MicroProfile Config defines default sources. The common default priority model is:

| Source | Typical default ordinal | Meaning |
|---|---:|---|
| JVM system properties | 400 | Highest standard default priority. |
| Environment variables | 300 | External environment override. |
| `META-INF/microprofile-config.properties` | 100 | Application-packaged default. |

The higher ordinal wins.

Example:

```properties
# packaged inside application
payment.timeout.ms=5000
```

Environment:

```bash
PAYMENT_TIMEOUT_MS=2000
```

System property:

```bash
-Dpayment.timeout.ms=1000
```

Effective value:

```text
payment.timeout.ms = 1000
```

because system property ordinal 400 beats environment variable ordinal 300 and packaged property ordinal 100.

The mental model:

```text
Packaged defaults say: here is what the app can run with.
Environment variables say: here is what this deployment wants.
System properties say: here is an explicit JVM-level override.
Custom sources can be designed to sit above or below those depending on governance.
```

---

## 7. Ordinal Is a Governance Tool

Many engineers treat ordinal as a technical detail. Top engineers treat it as governance.

A bad ordinal design can make production behavior unpredictable.

Example bad design:

```text
Database ConfigSource ordinal = 900
Environment variable ordinal = 300
```

Now an operational database row can override deployment-controlled env vars.

That might be good for feature flags or emergency kill switches, but dangerous for:

- database URL,
- authentication issuer,
- TLS mode,
- encryption key alias,
- payment endpoint,
- external agency integration endpoint,
- regulatory deadline rule.

A better design separates categories:

| Config category | Recommended mutability | Suggested source style |
|---|---|---|
| Infrastructure endpoint | deploy-time immutable | env/system/K8s config |
| Secret reference | deploy-time immutable | secret manager/env injection |
| Feature flag | runtime mutable | flag store/custom source |
| Business threshold | controlled runtime mutable | governed config DB |
| Compliance rule version | explicit release or governed config | release artifact/config DB with audit |
| Local developer default | packaged file | low ordinal |

Ordinal should reflect control authority.

---

## 8. Effective Value vs Source Value

A key may exist in many places.

```text
payment.timeout.ms
    source A: 5000  ordinal 100
    source B: 2000  ordinal 300
    source C: 1000  ordinal 400
```

The application sees only:

```text
payment.timeout.ms = 1000
```

This is the **effective value**.

A mature production system often needs to know:

- what is the effective value?
- which source won?
- which lower-priority sources also had values?
- was the value defaulted?
- was the value erased?
- was the value converted successfully?
- is it safe to expose this value?

Basic application code only needs the effective value. Operational diagnostics need more.

---

## 9. Property Naming Strategy

Configuration naming is architecture.

Bad names:

```properties
url=http://...
timeout=5000
enabled=true
mode=prod
```

These names lack ownership. They collide across modules.

Better names:

```properties
case.external.onemap.base-url=https://...
case.external.onemap.connect-timeout=2s
case.external.onemap.read-timeout=5s
case.external.onemap.enabled=true
case.external.onemap.rate-limit.per-minute=250
```

A strong naming structure:

```text
<bounded-context>.<adapter-or-feature>.<specific-setting>
```

Examples:

```properties
case.audit.enabled=true
case.audit.writer=database
case.workflow.escalation.enabled=true
case.workflow.escalation.default-days=14
case.external.onemap.base-url=https://www.onemap.gov.sg
case.external.onemap.token-cache-ttl=55m
case.notification.email.sender=noreply@example.gov
```

Good names should be:

- specific,
- stable,
- grep-friendly,
- module-owned,
- environment-neutral,
- not secret-revealing,
- consistent in units,
- explicit about semantics.

Avoid names like:

```properties
prod.url=...
dev.url=...
uat.url=...
```

because environment selection should be handled by source/profile/deployment, not encoded into every key.

---

## 10. Environment Variable Name Mapping

Environment variables have naming restrictions and conventions. They commonly use uppercase and underscores.

Property names often use lowercase, dots, and hyphens:

```properties
case.external.onemap.base-url
```

Environment equivalent might be:

```bash
CASE_EXTERNAL_ONEMAP_BASE_URL=https://...
```

MicroProfile Config defines mapping rules so environment variables can map to property names.

Important practical lesson:

```text
Do not design property names that become ambiguous when dots, hyphens, and underscores are normalized.
```

Avoid having both:

```properties
foo.bar-baz
foo.bar_baz
```

because both may collapse into similar env var names.

A conservative convention:

```text
Use lowercase property names with dots for hierarchy and hyphens for words.
Use uppercase env vars with underscores.
Do not mix underscores inside property keys unless necessary.
```

Example:

```properties
# property name
case.external.onemap.read-timeout

# env var
CASE_EXTERNAL_ONEMAP_READ_TIMEOUT
```

---

## 11. Access Model 1: Programmatic Lookup with Config

Programmatic lookup:

```java
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;

Config config = ConfigProvider.getConfig();
String baseUrl = config.getValue("case.external.onemap.base-url", String.class);
Integer maxRetries = config.getValue("case.external.onemap.max-retries", Integer.class);
```

This is useful when:

- code is outside CDI,
- lookup is dynamic,
- key names are constructed carefully,
- library code cannot rely on injection,
- integration code needs optional/dynamic retrieval.

But programmatic lookup can become a hidden global dependency if abused.

Bad:

```java
public class CaseService {
    public void submit(CaseCommand command) {
        boolean enabled = ConfigProvider.getConfig()
            .getValue("case.workflow.enabled", Boolean.class);

        // business logic...
    }
}
```

This hides configuration dependency inside method body.

Better:

```java
@ApplicationScoped
public class WorkflowConfig {
    private final boolean enabled;

    @Inject
    public WorkflowConfig(
            @ConfigProperty(name = "case.workflow.enabled") boolean enabled) {
        this.enabled = enabled;
    }

    public boolean enabled() {
        return enabled;
    }
}
```

Then inject `WorkflowConfig` into the service.

Programmatic lookup is powerful. It should be intentional.

---

## 12. Access Model 2: CDI Injection with @ConfigProperty

The most common model:

```java
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class OneMapClientConfig {

    @Inject
    @ConfigProperty(name = "case.external.onemap.base-url")
    URI baseUrl;

    @Inject
    @ConfigProperty(name = "case.external.onemap.connect-timeout")
    Duration connectTimeout;

    @Inject
    @ConfigProperty(name = "case.external.onemap.max-retries", defaultValue = "3")
    int maxRetries;
}
```

Benefits:

- dependencies are visible,
- failure happens at deployment/startup,
- values are type-converted,
- testing can override config sources,
- configuration requirements become part of bean contract.

But be careful with field injection. In high-quality design, prefer a typed config object or constructor injection where supported by your runtime/testing style.

Example with constructor:

```java
@ApplicationScoped
public class OneMapSettings {
    private final URI baseUrl;
    private final Duration connectTimeout;
    private final int maxRetries;

    @Inject
    public OneMapSettings(
            @ConfigProperty(name = "case.external.onemap.base-url") URI baseUrl,
            @ConfigProperty(name = "case.external.onemap.connect-timeout") Duration connectTimeout,
            @ConfigProperty(name = "case.external.onemap.max-retries", defaultValue = "3") int maxRetries) {
        this.baseUrl = baseUrl;
        this.connectTimeout = connectTimeout;
        this.maxRetries = maxRetries;
    }

    public URI baseUrl() {
        return baseUrl;
    }

    public Duration connectTimeout() {
        return connectTimeout;
    }

    public int maxRetries() {
        return maxRetries;
    }
}
```

---

## 13. Required Values

This injection requires the property to exist:

```java
@Inject
@ConfigProperty(name = "case.external.onemap.base-url")
URI baseUrl;
```

If missing, deployment/startup should fail.

This is good for required operational contracts.

Examples of required config:

```properties
case.external.onemap.base-url
case.datasource.jndi-name
case.auth.issuer-uri
case.audit.writer
case.notification.sender-address
```

Required config should fail fast.

The worst behavior is continuing with a fake default in production.

Bad:

```java
@ConfigProperty(
    name = "case.auth.issuer-uri",
    defaultValue = "http://localhost:8080/auth"
)
URI issuerUri;
```

This may accidentally let production run with local assumptions.

Better:

```java
@ConfigProperty(name = "case.auth.issuer-uri")
URI issuerUri;
```

and fail if missing.

---

## 14. Default Values

Default values are useful for safe defaults:

```java
@Inject
@ConfigProperty(name = "case.external.onemap.max-retries", defaultValue = "3")
int maxRetries;
```

Good defaults:

- retry count,
- connection pool min size,
- metrics enabled,
- local cache TTL,
- pagination default size,
- non-sensitive local behavior.

Dangerous defaults:

- security issuer,
- production endpoint,
- secret,
- credential,
- tenant id,
- encryption key alias,
- payment gateway,
- regulatory decision mode.

Rule:

```text
Default only when the default is safe in every environment where it might accidentally apply.
```

---

## 15. Optional Values

MicroProfile Config supports optional injection patterns:

```java
@Inject
@ConfigProperty(name = "case.external.proxy.host")
Optional<String> proxyHost;
```

This is useful when absence has a clear semantic meaning:

```text
missing proxy.host = no proxy
missing debug.header = no debug header
missing override.recipient = do not override recipients
```

But optional config can hide missing required config.

Bad:

```java
@Inject
@ConfigProperty(name = "case.auth.issuer-uri")
Optional<URI> issuerUri;
```

If authentication issuer is mandatory, make it mandatory.

A design question:

```text
Is missing value a valid state, or is it a broken deployment?
```

If valid, use `Optional<T>`. If broken, use required value.

---

## 16. Dynamic Lookup with Provider<T>

A normal injected config value is typically resolved at injection time.

Sometimes you want dynamic lookup:

```java
@Inject
@ConfigProperty(name = "case.feature.escalation.enabled")
Provider<Boolean> escalationEnabled;

public boolean isEscalationEnabled() {
    return escalationEnabled.get();
}
```

This allows the provider to retrieve current value when called, depending on implementation and source behavior.

Use cases:

- runtime mutable settings,
- feature flag bridge,
- operational kill switch,
- dynamic threshold.

But this introduces important questions:

```text
Does the underlying ConfigSource refresh?
Does the runtime cache values?
What is the consistency model across cluster nodes?
What is the latency of each get()?
What happens if source is down?
```

Do not assume dynamic lookup magically means live distributed configuration.

MicroProfile Config provides an access model. Your source implementation determines freshness and failure behavior.

---

## 17. Typed Conversion

All config source values are essentially strings. MicroProfile Config converts them into Java types.

Common target types include:

- `String`,
- primitive wrappers,
- primitive types,
- `Boolean`,
- `Integer`,
- `Long`,
- `Double`,
- `Float`,
- `URI`,
- `URL`,
- `Duration` depending on version/runtime support,
- `Optional<T>`,
- collections depending on spec/runtime.

Example:

```java
@Inject
@ConfigProperty(name = "case.page.default-size", defaultValue = "50")
int defaultPageSize;

@Inject
@ConfigProperty(name = "case.external.onemap.base-url")
URI baseUrl;
```

If conversion fails, startup should fail for injected required values.

That is desirable.

Bad config should not become random runtime behavior.

---

## 18. Custom Converter

Suppose you have a domain enum:

```java
public enum AuditWriterMode {
    DATABASE,
    QUEUE,
    BOTH,
    DISABLED
}
```

Config:

```properties
case.audit.writer-mode=database
```

A converter:

```java
import org.eclipse.microprofile.config.spi.Converter;
import jakarta.annotation.Priority;

@Priority(100)
public class AuditWriterModeConverter implements Converter<AuditWriterMode> {
    @Override
    public AuditWriterMode convert(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("audit writer mode must not be blank");
        }

        return switch (value.trim().toLowerCase()) {
            case "database", "db" -> AuditWriterMode.DATABASE;
            case "queue", "mq" -> AuditWriterMode.QUEUE;
            case "both" -> AuditWriterMode.BOTH;
            case "disabled", "off" -> AuditWriterMode.DISABLED;
            default -> throw new IllegalArgumentException(
                "Unsupported audit writer mode: " + value
            );
        };
    }
}
```

Register using service loader:

```text
META-INF/services/org.eclipse.microprofile.config.spi.Converter
```

Content:

```text
com.example.config.AuditWriterModeConverter
```

Then inject:

```java
@Inject
@ConfigProperty(name = "case.audit.writer-mode")
AuditWriterMode auditWriterMode;
```

Custom converters should:

- reject invalid values,
- be deterministic,
- be side-effect-free,
- not access network/database,
- not log secret values,
- provide clear error messages,
- normalize input intentionally.

---

## 19. Converter Priority

Multiple converters can exist for the same target type.

Priority determines which converter wins.

This is powerful but risky.

Do not casually override generic converters for common types like `Duration`, `URI`, `Boolean`, or `Integer` unless you fully understand the runtime effect.

Safer pattern:

```java
public record RetryPolicy(int maxAttempts, Duration backoff) {}
```

Converter for domain type:

```properties
case.external.onemap.retry-policy=3:250ms
```

```java
public class RetryPolicyConverter implements Converter<RetryPolicy> {
    @Override
    public RetryPolicy convert(String value) {
        String[] parts = value.split(":");
        if (parts.length != 2) {
            throw new IllegalArgumentException("Retry policy must be '<attempts>:<backoff>'");
        }
        return new RetryPolicy(
            Integer.parseInt(parts[0]),
            parseDuration(parts[1])
        );
    }
}
```

But ask whether custom compact syntax is worth it. Often separate properties are more readable:

```properties
case.external.onemap.retry.max-attempts=3
case.external.onemap.retry.backoff=250ms
```

---

## 20. Collections and Lists

Many runtimes/spec versions support collection-like config conversion.

Example:

```properties
case.allowed-agency-codes=CEA,CPDS,ROM
```

Injected as:

```java
@Inject
@ConfigProperty(name = "case.allowed-agency-codes")
List<String> allowedAgencyCodes;
```

When using collections, define:

- delimiter convention,
- escaping behavior,
- trimming behavior,
- case-sensitivity,
- duplicate handling,
- empty list semantics.

For critical values, prefer a typed wrapper:

```java
@ApplicationScoped
public class AgencyAccessConfig {
    private final Set<String> allowedAgencyCodes;

    @Inject
    public AgencyAccessConfig(
            @ConfigProperty(name = "case.allowed-agency-codes") List<String> codes) {
        this.allowedAgencyCodes = codes.stream()
            .map(String::trim)
            .filter(s -> !s.isBlank())
            .map(String::toUpperCase)
            .collect(Collectors.toUnmodifiableSet());

        if (allowedAgencyCodes.isEmpty()) {
            throw new IllegalStateException("case.allowed-agency-codes must not be empty");
        }
    }

    public boolean isAllowed(String agencyCode) {
        return allowedAgencyCodes.contains(agencyCode.toUpperCase());
    }
}
```

This moves normalization and validation into one explicit boundary.

---

## 21. Config Object Pattern

Directly injecting many properties into business services creates noisy code.

Bad:

```java
@ApplicationScoped
public class OneMapClient {
    @Inject @ConfigProperty(name = "case.external.onemap.base-url") URI baseUrl;
    @Inject @ConfigProperty(name = "case.external.onemap.connect-timeout") Duration connectTimeout;
    @Inject @ConfigProperty(name = "case.external.onemap.read-timeout") Duration readTimeout;
    @Inject @ConfigProperty(name = "case.external.onemap.max-retries") int maxRetries;
    @Inject @ConfigProperty(name = "case.external.onemap.rate-limit.per-minute") int rateLimit;

    // client logic...
}
```

Better:

```java
@ApplicationScoped
public class OneMapConfig {
    private final URI baseUrl;
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final int maxRetries;
    private final int rateLimitPerMinute;

    @Inject
    public OneMapConfig(
        @ConfigProperty(name = "case.external.onemap.base-url") URI baseUrl,
        @ConfigProperty(name = "case.external.onemap.connect-timeout") Duration connectTimeout,
        @ConfigProperty(name = "case.external.onemap.read-timeout") Duration readTimeout,
        @ConfigProperty(name = "case.external.onemap.max-retries", defaultValue = "3") int maxRetries,
        @ConfigProperty(name = "case.external.onemap.rate-limit.per-minute", defaultValue = "250") int rateLimitPerMinute
    ) {
        this.baseUrl = baseUrl;
        this.connectTimeout = connectTimeout;
        this.readTimeout = readTimeout;
        this.maxRetries = maxRetries;
        this.rateLimitPerMinute = rateLimitPerMinute;
        validate();
    }

    private void validate() {
        if (connectTimeout.isNegative() || connectTimeout.isZero()) {
            throw new IllegalArgumentException("connect timeout must be positive");
        }
        if (readTimeout.compareTo(connectTimeout) < 0) {
            throw new IllegalArgumentException("read timeout must be >= connect timeout");
        }
        if (maxRetries < 0 || maxRetries > 10) {
            throw new IllegalArgumentException("max retries must be between 0 and 10");
        }
        if (rateLimitPerMinute <= 0 || rateLimitPerMinute > 300) {
            throw new IllegalArgumentException("rate limit must be between 1 and 300");
        }
    }

    public URI baseUrl() { return baseUrl; }
    public Duration connectTimeout() { return connectTimeout; }
    public Duration readTimeout() { return readTimeout; }
    public int maxRetries() { return maxRetries; }
    public int rateLimitPerMinute() { return rateLimitPerMinute; }
}
```

Then:

```java
@ApplicationScoped
public class OneMapClient {
    private final OneMapConfig config;

    @Inject
    public OneMapClient(OneMapConfig config) {
        this.config = config;
    }
}
```

Benefits:

- business component receives one coherent config object,
- validation is centralized,
- invariants can compare multiple properties,
- test setup is easier,
- config naming is localized,
- secrets can be handled carefully,
- config can be documented as a contract.

---

## 22. Config Object vs @ConfigProperties

Some MicroProfile Config versions support `@ConfigProperties`, which maps a prefix into a bean-like object.

Example conceptual style:

```java
@ConfigProperties(prefix = "case.external.onemap")
public class OneMapProperties {
    public URI baseUrl;
    public Duration connectTimeout;
    public Duration readTimeout;
    public int maxRetries;
}
```

This can reduce annotation noise.

However, advanced engineers still ask:

- Is validation explicit?
- Are fields immutable?
- Are defaults obvious?
- Does the runtime support the exact mapping behavior?
- Is this portable across target runtimes?
- Is this feature supported in the MicroProfile Config version used by the project?

For highly critical configuration, an explicit config object with constructor validation is often clearer.

For lower-risk grouped config, prefix mapping can be productive.

---

## 23. Custom ConfigSource

Custom config sources let you plug new places into the configuration system.

Example use cases:

- database-backed operational config,
- tenant-specific config,
- secret manager integration,
- remote config server,
- Kubernetes API config,
- agency-specific override source,
- feature flag bridge.

Simplified example:

```java
import org.eclipse.microprofile.config.spi.ConfigSource;

public class DatabaseConfigSource implements ConfigSource {
    private final Map<String, String> cache;

    public DatabaseConfigSource() {
        this.cache = loadFromDatabaseAtStartup();
    }

    @Override
    public Map<String, String> getProperties() {
        return cache;
    }

    @Override
    public Set<String> getPropertyNames() {
        return cache.keySet();
    }

    @Override
    public String getValue(String propertyName) {
        return cache.get(propertyName);
    }

    @Override
    public String getName() {
        return "database-config-source";
    }

    @Override
    public int getOrdinal() {
        return 250;
    }
}
```

Register:

```text
META-INF/services/org.eclipse.microprofile.config.spi.ConfigSource
```

Content:

```text
com.example.config.DatabaseConfigSource
```

But this simplistic example hides real production issues.

A real custom source must answer:

```text
When is data loaded?
Is it cached?
How is it refreshed?
What happens if backend is down?
Can it block app startup?
Can it leak secrets through getProperties()?
How are errors reported?
Can one bad property break all config?
What is its ordinal relative to env vars?
Is it safe in every environment?
```

---

## 24. Custom ConfigSource Failure Model

Custom sources are dangerous when they turn startup into an uncontrolled distributed dependency.

Example:

```text
Application startup -> ConfigSource constructor -> HTTP call to config service -> timeout -> deployment fails
```

Sometimes this is correct. Sometimes it creates cascading failure.

Classify custom source data:

| Data type | Should app fail if source unavailable? | Suggested strategy |
|---|---|---|
| Required security config | Yes | fail fast, short timeout, clear error |
| Optional feature flag | No | fallback to safe default/cache |
| Business threshold | Depends | cached last-known-good + audit |
| Secret | Usually yes if required | secret manager with startup validation |
| Kill switch | Prefer highly available | local cache + fail-safe policy |

Avoid a single custom source becoming a hidden critical dependency for every service.

---

## 25. ConfigSourceProvider

Sometimes a provider needs to create multiple config sources dynamically.

Example:

- one config source per file in a directory,
- one config source per tenant,
- one config source per mounted secret,
- one config source per module.

Conceptually:

```java
public class DirectoryConfigSourceProvider implements ConfigSourceProvider {
    @Override
    public Iterable<ConfigSource> getConfigSources(ClassLoader classLoader) {
        return scanDirectoryAndCreateSources();
    }
}
```

Use carefully.

Dynamic source creation increases startup complexity and debugging difficulty.

Ask:

```text
Can operators predict which sources exist?
Can we list them safely?
Can we explain final value resolution?
Can we test source ordering?
Can we avoid tenant leakage?
```

---

## 26. Deletion / Empty Values

MicroProfile Config has semantics around empty values and overriding/erasing properties depending on spec version and context.

Operationally, be explicit.

Suppose packaged default:

```properties
case.external.proxy.host=proxy.internal
```

In a target environment, you want no proxy.

Possible approaches:

```properties
case.external.proxy.enabled=false
```

or:

```properties
case.external.proxy.host=
```

The first is usually clearer because absence and empty string are easy to confuse.

Better design:

```properties
case.external.proxy.enabled=false
case.external.proxy.host=proxy.internal
case.external.proxy.port=8080
```

Code:

```java
if (!proxyConfig.enabled()) {
    return HttpClient.newBuilder().build();
}
```

Do not overload blank values with too much meaning for critical configuration.

---

## 27. Profiles in MicroProfile Config

MicroProfile Config includes profile-related concepts in modern versions, but profile support and file naming behavior may also involve runtime-specific details.

Typical idea:

```text
Base property:
    case.audit.enabled=true

Profile-specific override:
    %dev.case.audit.enabled=false
```

or profile-specific files depending on runtime/spec support:

```text
META-INF/microprofile-config.properties
META-INF/microprofile-config-dev.properties
META-INF/microprofile-config-prod.properties
```

Activation might be based on:

```properties
mp.config.profile=dev
```

But do not design blindly. Profile behavior must be verified against the exact runtime and MicroProfile Config version.

The deeper rule:

```text
Profile is a deployment selection mechanism.
Feature flag is a runtime decision mechanism.
Qualifier is an injection selection mechanism.
Do not confuse them.
```

Part 027 will go deeper into profiles.

---

## 28. Secrets and MicroProfile Config

MicroProfile Config can expose secrets as config values, but it is not automatically a complete secret-management solution.

Example:

```java
@Inject
@ConfigProperty(name = "case.external.onemap.client-secret")
String clientSecret;
```

This works technically, but ask:

- Where does the secret come from?
- Is it in environment variable?
- Is it in Kubernetes Secret?
- Is it in a mounted file?
- Is it in a secret manager?
- Is it logged anywhere?
- Is it exposed by config debug endpoint?
- Is it stored in memory longer than necessary?
- Who can read it operationally?
- How is it rotated?

Do not print all config values in logs.

Bad:

```java
config.getPropertyNames().forEach(name ->
    log.info("{}={}", name, config.getOptionalValue(name, String.class).orElse(""))
);
```

Better:

```java
private static final List<String> SENSITIVE_TOKENS = List.of(
    "password", "secret", "token", "credential", "private-key", "apikey", "api-key"
);

String safeValue(String name, String value) {
    String lower = name.toLowerCase(Locale.ROOT);
    boolean sensitive = SENSITIVE_TOKENS.stream().anyMatch(lower::contains);
    return sensitive ? "<redacted>" : value;
}
```

Even better: expose only selected non-sensitive diagnostics.

---

## 29. Config Validation as Startup Gate

MicroProfile Config will validate missing/conversion failure for injected properties, but cross-property validation is your responsibility.

Example invariant:

```text
read-timeout >= connect-timeout
rate-limit.per-minute <= vendor maximum
retry.max-attempts * retry.backoff should not exceed request SLA
if proxy.enabled=true then proxy.host and proxy.port must exist
if mtls.enabled=true then keystore path and password reference must exist
```

Use a startup validator:

```java
@ApplicationScoped
public class RuntimeConfigValidator {
    private final OneMapConfig oneMapConfig;
    private final AuditConfig auditConfig;

    @Inject
    public RuntimeConfigValidator(OneMapConfig oneMapConfig, AuditConfig auditConfig) {
        this.oneMapConfig = oneMapConfig;
        this.auditConfig = auditConfig;
    }

    @PostConstruct
    void validate() {
        oneMapConfig.validate();
        auditConfig.validate();
    }
}
```

But avoid heavy external calls in validation unless necessary.

Validation should be:

- deterministic,
- fast,
- clear,
- non-secret-leaking,
- environment-aware only through config,
- fail-fast for broken deployment.

---

## 30. Configuration Documentation Pattern

Every production-grade config key should have documentation.

Recommended table:

| Property | Type | Required | Default | Source authority | Secret | Mutability | Description |
|---|---|---:|---|---|---:|---|---|
| `case.external.onemap.base-url` | URI | yes | none | deployment | no | startup | Base URL for OneMap API. |
| `case.external.onemap.client-secret` | String | yes | none | secret manager | yes | startup/rotation | Client secret reference/value. |
| `case.external.onemap.rate-limit.per-minute` | int | no | 250 | deployment | no | startup | Internal worker cap below vendor 300/min. |
| `case.feature.escalation.enabled` | boolean | no | false | flag store | no | runtime | Enables escalation workflow. |

A top-level config catalog should answer:

```text
What keys exist?
Who owns them?
Which are required?
Which are secrets?
Which can change at runtime?
Which are safe defaults?
Which environment owns them?
Which release introduced them?
```

This is especially important in regulated systems.

---

## 31. Avoiding Configuration Sprawl

Configuration sprawl happens when every developer adds keys ad hoc.

Symptoms:

```text
app.mode
mode
env
environment
profile
case.env
app.profile
case.module.enabled
case.module.disable
case.module.use-new-flow
case.module.new-flow-enabled
```

The same concept appears under multiple names.

Prevention:

1. Define naming conventions.
2. Define ownership per prefix.
3. Review config keys in code review.
4. Document all production keys.
5. Remove dead keys.
6. Add startup warnings for deprecated keys.
7. Use typed config objects per module.
8. Forbid direct `ConfigProvider` lookup in business code except justified cases.

A useful policy:

```text
Every new production config key must include:
- name,
- type,
- default behavior,
- valid range,
- source authority,
- mutability,
- rollback behavior,
- owner,
- test coverage.
```

---

## 32. Runtime Mutable Config Is Not Free

Dynamic config looks attractive:

```java
Provider<Integer> maxBatchSize;
```

But mutable config changes the system model.

Questions:

```text
If value changes during a request, which value should the request use?
If cluster node A sees new value and node B does not, is that acceptable?
Should audit record the config version used for a decision?
Can a config change break in-flight workflows?
Is rollback possible?
Who is allowed to change it?
Is the change approved?
Is it logged?
```

For regulatory workflows, dynamic config can be dangerous unless versioned.

Example:

```text
Escalation deadline changed from 14 days to 7 days.
A case created yesterday was evaluated under which rule?
Can we prove it?
```

For compliance-sensitive decisions, store:

- rule version,
- config version,
- evaluation timestamp,
- decision inputs,
- operator/system actor,
- effective config value used.

---

## 33. Feature Flags vs MicroProfile Config

A feature flag can be implemented using MicroProfile Config, but they are not identical.

MicroProfile Config gives:

- key/value access,
- source precedence,
- injection,
- conversion.

Feature flag system should additionally provide:

- targeting,
- rollout percentage,
- user/tenant context,
- audit history,
- flag lifecycle,
- emergency kill switch,
- decision reason,
- consistency model,
- admin UI/API,
- stale flag cleanup.

Simple flags can use MicroProfile Config:

```java
@Inject
@ConfigProperty(name = "case.feature.escalation.enabled", defaultValue = "false")
Provider<Boolean> escalationEnabled;
```

Complex flags should use a dedicated flag service, possibly configured via MicroProfile Config.

Part 028 will go deeper.

---

## 34. Config and CDI Producers

MicroProfile Config is commonly used inside CDI producers.

Example: producing HTTP client settings.

```java
@ApplicationScoped
public class HttpClientProducer {
    private final OneMapConfig config;

    @Inject
    public HttpClientProducer(OneMapConfig config) {
        this.config = config;
    }

    @Produces
    @ApplicationScoped
    @OneMap
    public HttpClient oneMapHttpClient() {
        return HttpClient.newBuilder()
            .connectTimeout(config.connectTimeout())
            .build();
    }
}
```

This pattern is strong because:

- config is read once,
- resource creation is centralized,
- client construction is testable,
- config validation can happen before producer use,
- qualifiers make injection explicit.

But avoid producers that read arbitrary config keys dynamically for each injection point unless you are deliberately building a framework.

---

## 35. Config and Interceptors

Config can drive cross-cutting behavior.

Example:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface FeatureGated {
    String value();
}
```

Interceptor:

```java
@FeatureGated("")
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class FeatureGateInterceptor {
    @Inject
    FeatureFlagService flags;

    @AroundInvoke
    Object around(InvocationContext ctx) throws Exception {
        FeatureGated binding = findBinding(ctx);
        if (!flags.enabled(binding.value())) {
            throw new FeatureDisabledException(binding.value());
        }
        return ctx.proceed();
    }
}
```

MicroProfile Config can back simple `FeatureFlagService`:

```java
@ApplicationScoped
public class ConfigBackedFeatureFlagService implements FeatureFlagService {
    @Inject
    Config config;

    @Override
    public boolean enabled(String key) {
        return config.getOptionalValue("case.feature." + key + ".enabled", Boolean.class)
            .orElse(false);
    }
}
```

This is useful, but be careful:

- dynamic lookup per method invocation can add overhead,
- missing flag names can silently disable behavior,
- flag keys inside annotations become API contract,
- audit may need to capture flag decision.

---

## 36. Config and Decorators

A decorator can use config to wrap a business interface.

Example:

```java
public interface CaseSubmissionService {
    SubmissionResult submit(SubmissionCommand command);
}
```

Decorator:

```java
@Decorator
public class FeatureAwareCaseSubmissionDecorator implements CaseSubmissionService {
    @Inject
    @Delegate
    CaseSubmissionService delegate;

    @Inject
    @ConfigProperty(name = "case.submission.new-validation.enabled", defaultValue = "false")
    Provider<Boolean> newValidationEnabled;

    @Override
    public SubmissionResult submit(SubmissionCommand command) {
        if (newValidationEnabled.get()) {
            // apply additional validation
        }
        return delegate.submit(command);
    }
}
```

This is better than scattering:

```java
if (ConfigProvider.getConfig().getValue(...))
```

through business methods.

But config-driven decorators must be documented because they change semantic behavior.

---

## 37. Testing MicroProfile Config

Testing config-heavy code should avoid relying on developer machine environment.

Bad test:

```java
@Test
void test() {
    String url = System.getenv("CASE_EXTERNAL_URL");
    // test depends on machine state
}
```

Better patterns:

1. Construct typed config object directly:

```java
OneMapConfig config = new OneMapConfig(
    URI.create("https://example.test"),
    Duration.ofSeconds(2),
    Duration.ofSeconds(5),
    3,
    250
);
```

2. Use test config source.
3. Use runtime-specific test profile.
4. Override properties via system properties in controlled setup.
5. Use container test support if testing CDI injection.

For unit tests, the best design is often:

```text
Test typed config object validation separately.
Test business service by passing config object directly.
Test MicroProfile injection in a small integration/container test.
```

Do not make every unit test boot a CDI runtime just to parse config.

---

## 38. Testing Missing and Invalid Config

You should test failure behavior.

Examples:

```text
missing required base URL -> startup/config validation fails
negative timeout -> validation fails
rate limit above vendor maximum -> validation fails
invalid enum -> conversion fails
blank secret -> validation fails
unknown mode -> validation fails
```

This type of testing prevents production misconfiguration.

Example validation test:

```java
@Test
void rejectsRateLimitAboveVendorLimit() {
    assertThrows(IllegalArgumentException.class, () ->
        new OneMapConfig(
            URI.create("https://example.test"),
            Duration.ofSeconds(2),
            Duration.ofSeconds(5),
            3,
            999
        )
    );
}
```

Startup failure is not a bad thing if the deployment is invalid.

Silent misconfiguration is worse.

---

## 39. Observability: Safe Config Diagnostics

In production, operators need to diagnose config issues.

Useful diagnostics:

- active profile,
- source names and ordinals,
- selected non-sensitive effective values,
- missing required config report,
- config validation status,
- config version/hash,
- feature flag source status,
- custom source health,
- last refresh timestamp,
- conversion failures.

Dangerous diagnostics:

- dumping all config values,
- exposing secrets,
- exposing internal endpoints publicly,
- exposing credentials via health endpoints,
- logging full environment variables.

Safe config endpoint idea:

```json
{
  "profile": "uat",
  "sources": [
    {"name": "system-properties", "ordinal": 400},
    {"name": "environment-variables", "ordinal": 300},
    {"name": "META-INF/microprofile-config.properties", "ordinal": 100}
  ],
  "validated": true,
  "nonSensitiveEffectiveValues": {
    "case.external.onemap.rate-limit.per-minute": "250",
    "case.external.onemap.max-retries": "3",
    "case.audit.writer-mode": "DATABASE"
  },
  "redacted": [
    "case.external.onemap.client-secret"
  ]
}
```

Expose only to secured internal/admin contexts.

---

## 40. Debugging Resolution Issues

When a config value is unexpected, debug in this order:

```text
1. Confirm exact property key.
2. Confirm expected type and converter.
3. List all ConfigSources and ordinals.
4. Check whether source contains the key.
5. Check environment variable mapping.
6. Check system property override.
7. Check profile-specific override.
8. Check empty value / erased value semantics.
9. Check custom source caching/refresh behavior.
10. Check runtime-specific behavior.
```

Typical mistakes:

```text
- typo in property name
- wrong env var name
- packaged default wins because env var did not map
- system property accidentally set in server startup
- custom source ordinal too high
- config file not packaged under META-INF
- test uses stale system property from previous test
- invalid converter registered
- Optional hides missing required value
- Provider<T> assumed dynamic but source is static
```

---

## 41. ConfigSource Ordering Example

Suppose we have:

Packaged file:

```properties
case.external.onemap.rate-limit.per-minute=250
case.external.onemap.max-retries=3
case.audit.writer-mode=database
```

Environment:

```bash
CASE_EXTERNAL_ONEMAP_RATE_LIMIT_PER_MINUTE=200
```

System property:

```bash
-Dcase.audit.writer-mode=queue
```

Custom database source ordinal 250:

```text
case.external.onemap.max-retries=5
case.audit.writer-mode=both
```

Effective values:

| Property | Effective | Winning source |
|---|---|---|
| `case.external.onemap.rate-limit.per-minute` | `200` | environment variable, ordinal 300 |
| `case.external.onemap.max-retries` | `5` | custom database, ordinal 250 |
| `case.audit.writer-mode` | `queue` | system property, ordinal 400 |

This is deterministic.

But if operators do not know the ordinal model, the result feels mysterious.

---

## 42. Build-Time vs Runtime Config in Modern Runtimes

Some modern runtimes distinguish build-time and runtime config.

For example, ahead-of-time/build-time optimized runtimes may freeze certain configuration at build or augmentation time.

This matters because:

```text
Changing an environment variable at container start may not affect build-time config.
```

This is runtime-specific, but the design principle is general:

| Config timing | When value is consumed | Change requires |
|---|---|---|
| Build-time | build/augmentation/native image | rebuild |
| Deploy-time | deployment packaging/server deployment | redeploy |
| Startup-time | process startup | restart |
| Runtime | during request/job processing | refresh/propagation |

When using MicroProfile Config in a runtime like Quarkus, Open Liberty, Payara, or WildFly, verify timing semantics.

Do not assume every config key is runtime mutable.

---

## 43. Java 8 to Java 25 Considerations

MicroProfile Config can be used across a wide Java range depending on version/runtime.

Important concerns:

### Java 8

- Legacy MicroProfile versions often aligned with Java EE / `javax.*`.
- Avoid using modern Java language features in shared libraries.
- `Duration` support may vary by version/runtime.
- Migration path must consider namespace and baseline runtime.

### Java 11

- Common transitional baseline for many enterprise systems.
- Useful for migration staging.
- Still often seen with Jakarta EE 8/9/10-era runtimes.

### Java 17

- Modern Jakarta EE 11 baseline requires Java SE 17+.
- Good target for current enterprise modernization.

### Java 21

- LTS with virtual threads.
- Config source implementations must avoid blocking hot paths.
- Dynamic config lookup must not accidentally perform blocking network calls per request.

### Java 25

- Latest long-term platform direction after Java 21.
- Strong reason to clean up old `javax.*` assumptions and non-portable config hacks.

The main design is not tied to a Java syntax version. The architecture is stable:

```text
typed config boundary + deterministic source precedence + validation + safe diagnostics
```

---

## 44. Example: Production-Grade OneMap Config Boundary

Config keys:

```properties
case.external.onemap.base-url=https://www.onemap.gov.sg
case.external.onemap.connect-timeout=2s
case.external.onemap.read-timeout=5s
case.external.onemap.max-retries=3
case.external.onemap.retry-backoff=250ms
case.external.onemap.rate-limit.per-minute=250
case.external.onemap.token-cache-ttl=55m
case.external.onemap.client-id=${provided-by-secret-source}
case.external.onemap.client-secret=${provided-by-secret-source}
```

Typed config:

```java
@ApplicationScoped
public class OneMapRuntimeConfig {
    private final URI baseUrl;
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final int maxRetries;
    private final Duration retryBackoff;
    private final int rateLimitPerMinute;
    private final Duration tokenCacheTtl;
    private final String clientId;
    private final String clientSecret;

    @Inject
    public OneMapRuntimeConfig(
        @ConfigProperty(name = "case.external.onemap.base-url") URI baseUrl,
        @ConfigProperty(name = "case.external.onemap.connect-timeout", defaultValue = "2s") Duration connectTimeout,
        @ConfigProperty(name = "case.external.onemap.read-timeout", defaultValue = "5s") Duration readTimeout,
        @ConfigProperty(name = "case.external.onemap.max-retries", defaultValue = "3") int maxRetries,
        @ConfigProperty(name = "case.external.onemap.retry-backoff", defaultValue = "250ms") Duration retryBackoff,
        @ConfigProperty(name = "case.external.onemap.rate-limit.per-minute", defaultValue = "250") int rateLimitPerMinute,
        @ConfigProperty(name = "case.external.onemap.token-cache-ttl", defaultValue = "55m") Duration tokenCacheTtl,
        @ConfigProperty(name = "case.external.onemap.client-id") String clientId,
        @ConfigProperty(name = "case.external.onemap.client-secret") String clientSecret
    ) {
        this.baseUrl = baseUrl;
        this.connectTimeout = connectTimeout;
        this.readTimeout = readTimeout;
        this.maxRetries = maxRetries;
        this.retryBackoff = retryBackoff;
        this.rateLimitPerMinute = rateLimitPerMinute;
        this.tokenCacheTtl = tokenCacheTtl;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        validate();
    }

    private void validate() {
        requirePositive(connectTimeout, "connect-timeout");
        requirePositive(readTimeout, "read-timeout");
        requirePositive(retryBackoff, "retry-backoff");
        requirePositive(tokenCacheTtl, "token-cache-ttl");

        if (readTimeout.compareTo(connectTimeout) < 0) {
            throw new IllegalArgumentException("onemap read-timeout must be >= connect-timeout");
        }
        if (maxRetries < 0 || maxRetries > 5) {
            throw new IllegalArgumentException("onemap max-retries must be between 0 and 5");
        }
        if (rateLimitPerMinute <= 0 || rateLimitPerMinute > 300) {
            throw new IllegalArgumentException("onemap rate-limit.per-minute must be 1..300");
        }
        if (clientId.isBlank()) {
            throw new IllegalArgumentException("onemap client-id must not be blank");
        }
        if (clientSecret.isBlank()) {
            throw new IllegalArgumentException("onemap client-secret must not be blank");
        }
    }

    private static void requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException("onemap " + name + " must be positive");
        }
    }

    public URI baseUrl() { return baseUrl; }
    public Duration connectTimeout() { return connectTimeout; }
    public Duration readTimeout() { return readTimeout; }
    public int maxRetries() { return maxRetries; }
    public Duration retryBackoff() { return retryBackoff; }
    public int rateLimitPerMinute() { return rateLimitPerMinute; }
    public Duration tokenCacheTtl() { return tokenCacheTtl; }
    public String clientId() { return clientId; }

    public SecretValue clientSecret() {
        return SecretValue.of(clientSecret);
    }
}
```

A wrapper for secret value:

```java
public final class SecretValue {
    private final String value;

    private SecretValue(String value) {
        this.value = value;
    }

    public static SecretValue of(String value) {
        return new SecretValue(value);
    }

    public String reveal() {
        return value;
    }

    @Override
    public String toString() {
        return "<redacted>";
    }
}
```

This does not make Java strings magically secure, but it reduces accidental logging.

---

## 45. Example: Config-Backed Strategy Selection

Suppose audit writer can be selected:

```properties
case.audit.writer-mode=database
```

Interfaces:

```java
public interface AuditWriter {
    void write(AuditRecord record);
}
```

Implementations:

```java
@ApplicationScoped
@DatabaseAudit
public class DatabaseAuditWriter implements AuditWriter {
    public void write(AuditRecord record) { ... }
}

@ApplicationScoped
@QueueAudit
public class QueueAuditWriter implements AuditWriter {
    public void write(AuditRecord record) { ... }
}
```

Selector service:

```java
@ApplicationScoped
public class AuditWriterRouter implements AuditWriter {
    private final AuditWriterMode mode;
    private final AuditWriter database;
    private final AuditWriter queue;

    @Inject
    public AuditWriterRouter(
        @ConfigProperty(name = "case.audit.writer-mode") AuditWriterMode mode,
        @DatabaseAudit AuditWriter database,
        @QueueAudit AuditWriter queue
    ) {
        this.mode = mode;
        this.database = database;
        this.queue = queue;
    }

    @Override
    public void write(AuditRecord record) {
        switch (mode) {
            case DATABASE -> database.write(record);
            case QUEUE -> queue.write(record);
            case BOTH -> {
                database.write(record);
                queue.write(record);
            }
            case DISABLED -> {
                // only if explicitly allowed for non-prod/testing
            }
        }
    }
}
```

This is explicit and testable.

Avoid dynamic class names in config:

```properties
case.audit.writer-class=com.example.DatabaseAuditWriter
```

That creates brittle reflection-based service selection.

Prefer config selecting a domain mode, not arbitrary implementation class.

---

## 46. Anti-Patterns

### Anti-pattern 1: Config lookup everywhere

```java
ConfigProvider.getConfig().getValue("x", String.class)
```

scattered across codebase.

Consequence:

- no central validation,
- hard to find dependencies,
- inconsistent defaulting,
- difficult testing.

Fix:

- typed config objects,
- config boundary per module,
- CDI injection.

### Anti-pattern 2: Environment name in every key

```properties
uat.case.url=...
prod.case.url=...
```

Consequence:

- code becomes environment-aware,
- deployment selection leaks into app logic.

Fix:

- same key across environments,
- source/profile supplies value.

### Anti-pattern 3: Defaulting critical production values

```java
@ConfigProperty(name = "auth.issuer", defaultValue = "http://localhost")
```

Consequence:

- production might start with unsafe local default.

Fix:

- required config,
- fail fast.

### Anti-pattern 4: Secret dump

```java
log.info("Config: {}", config.getProperties());
```

Consequence:

- credential leak.

Fix:

- redaction,
- allowlist non-sensitive keys,
- secured diagnostics.

### Anti-pattern 5: Custom source with network call per property access

```java
public String getValue(String key) {
    return httpClient.get("/config/" + key);
}
```

Consequence:

- latency explosion,
- cascading failure,
- hot-path blocking,
- request instability.

Fix:

- cache,
- refresh loop,
- fail-safe behavior,
- health reporting.

### Anti-pattern 6: Runtime mutable compliance rules without versioning

Consequence:

- impossible to explain past decisions.

Fix:

- versioned config,
- decision audit,
- effective value recording.

---

## 47. Design Checklist

Before adding a new config key, answer:

```text
1. What is the exact key name?
2. Which module owns it?
3. What type is it?
4. Is it required?
5. What is the default, if any?
6. Is the default safe in production?
7. What values are valid?
8. Is it secret?
9. Who supplies it?
10. Which source should have authority?
11. Is it build-time, startup-time, or runtime mutable?
12. Does changing it require restart/redeploy?
13. How is it tested?
14. How is it documented?
15. How is it observed safely?
16. What happens if it is missing?
17. What happens if it is invalid?
18. What happens if different nodes have different values?
19. Does it need audit/versioning?
20. When should it be removed?
```

---

## 48. Mental Model Summary

MicroProfile Config is not “just property injection”.

It is a runtime contract system:

```text
Property name
    + source precedence
    + type conversion
    + CDI injection
    + validation
    + diagnostics
    + security discipline
    + mutability policy
    = production configuration model
```

A top engineer does not merely ask:

```text
How do I read env var X?
```

They ask:

```text
Who owns this value?
When is it resolved?
Which source wins?
Is it typed?
Is it validated?
Is it safe to default?
Is it safe to expose?
Can it change at runtime?
Can we explain old decisions after it changes?
Can this create a production incident?
```

That is the difference between coding configuration and engineering runtime behavior.

---

## 49. Practical Implementation Blueprint

For a serious enterprise service:

```text
src/main/resources/META-INF/microprofile-config.properties
    low-priority packaged defaults only

com.example.case.config
    OneMapRuntimeConfig
    AuditRuntimeConfig
    WorkflowRuntimeConfig
    RuntimeConfigValidator
    SafeConfigDiagnostics

com.example.case.config.converter
    DurationStyleConverter if needed
    AuditWriterModeConverter
    RateLimitPolicyConverter if justified

com.example.case.config.source
    Optional custom ConfigSource for governed runtime config
    Optional custom ConfigSource for secret manager bridge
```

Rules:

```text
- Business services do not call ConfigProvider directly.
- Infrastructure adapters receive typed config objects.
- Required production config has no unsafe local default.
- Secrets are not logged.
- Custom ConfigSource has health and timeout policy.
- Config keys are documented.
- Config validation is tested.
- Runtime mutable config is versioned if decision-critical.
```

---

## 50. What Comes Next

This part focused on MicroProfile Config mechanics and architecture.

The next part goes deeper into **profiles**:

```text
Part 027 — Profiles: Environment-Specific Behavior Without Code Forking
```

Profiles are related to config, but they answer a different question:

```text
How do we run the same application artifact differently in dev, test, UAT, staging, prod, migration, or tenant-specific contexts without forking the code?
```

---

## 51. References

- MicroProfile Config specification page: https://microprofile.io/specifications/config/
- MicroProfile Config 3.1 specification: https://download.eclipse.org/microprofile/microprofile-config-3.1/microprofile-config-spec-3.1.html
- MicroProfile Config API Javadocs: https://javadoc.io/doc/org.eclipse.microprofile.config/microprofile-config-api/latest/index.html
- Jakarta EE specifications: https://jakarta.ee/specifications/
- Jakarta Config project page: https://jakarta.ee/specifications/config/
- Open Liberty MicroProfile Config documentation: https://openliberty.io/docs/latest/reference/feature/mpConfig-3.1.html

---

## 52. Completion Status

Current part completed:

```text
[x] Part 026 — MicroProfile Config Deep Dive
```

Series status:

```text
[ ] Part 027 — Profiles: Environment-Specific Behavior Without Code Forking
[ ] Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery
[ ] Part 029 — Conditional Beans and Runtime Selection Patterns
[ ] Part 030 — Container Concurrency, Managed Executors, and Context Propagation
[ ] Part 031 — Testing CDI, EJB, and Configuration-Heavy Code
[ ] Part 032 — Observability and Debugging of Dependency/Container Problems
[ ] Part 033 — Architecture Patterns for Enterprise Java Runtime Design
[ ] Part 034 — Migration and Modernization Playbook
[ ] Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton
```

The series is **not finished yet**.
