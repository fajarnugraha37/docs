# Part 10 — Configuration Admin and Metatype: Runtime Configuration as First-Class Contract

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `10-configuration-admin-metatype-runtime-configuration-contract.md`  
Java scope: Java 8 through Java 25  
OSGi scope: Core/Compendium concepts, Configuration Admin, Metatype, Declarative Services integration, Felix/Karaf-style operational models

---

## 0. What This Part Is About

In many Java systems, configuration is treated as a secondary concern:

- a `properties` file read during startup,
- environment variables injected by deployment tooling,
- YAML consumed by a framework,
- command-line flags,
- database rows,
- or static constants accidentally promoted into production behavior.

In OSGi, configuration is not merely startup data. It is part of the runtime contract.

The OSGi Configuration Admin model exists because an OSGi framework is dynamic. Bundles can start, stop, update, refresh, and re-register services while the JVM remains alive. If runtime topology is dynamic, configuration must also be dynamic. Otherwise the system becomes inconsistent: services can change, but their operational parameters cannot.

This part builds the mental model for treating configuration as a first-class runtime artifact.

By the end, you should be able to reason about:

- what Configuration Admin solves,
- why `service.pid` is central,
- how singleton PID and factory PID differ,
- how Declarative Services receives configuration,
- what Metatype adds on top of raw dictionaries,
- how typed configuration is generated and consumed,
- how configuration update affects component lifecycle,
- how to model secrets, validation, schema evolution, and audit,
- how configuration failure can break a dynamic runtime,
- and how to design production-grade OSGi configuration systems.

This part intentionally does not repeat generic configuration concepts from Spring Boot, Kubernetes, Jakarta, or cloud deployment. We only discuss them where they intersect with OSGi runtime semantics.

---

## 1. The Core Mental Model

The simplest way to understand Configuration Admin is this:

```text
Configuration Admin is a runtime database of dictionaries,
keyed by persistent identities,
delivered dynamically to configuration targets.
```

A configuration is not “read by the bundle”.

Instead:

```text
A management agent writes configuration into Configuration Admin.
Configuration Admin stores it.
A runtime target registers interest in a PID.
Configuration Admin delivers the matching dictionary.
The target updates itself or is recreated by an extender such as Declarative Services.
```

So the model is inverted compared to ordinary application configuration.

In many Java apps:

```text
component -> reads config source
```

In OSGi Configuration Admin:

```text
config source / management agent -> Configuration Admin -> component target
```

That inversion matters.

It means configuration can be:

- supplied before the target exists,
- supplied after the target exists,
- updated while the target is active,
- removed while the target is active,
- targeted to a specific bundle version or location,
- shared across multiple bundles,
- observed as events,
- transformed by configuration plugins,
- described by Metatype metadata,
- and managed by local or remote agents.

This is why Configuration Admin is a runtime service, not a convenience parser.

---

## 2. Why OSGi Needs Configuration Admin

A static Java process can often get away with this model:

```text
read config at startup -> build object graph -> never change config until restart
```

OSGi cannot assume that.

OSGi systems commonly need:

- bundles that appear after the framework starts,
- components that activate only after dependencies and config are present,
- multiple runtime instances of the same logical component,
- hot configuration changes without JVM restart,
- runtime admin tools,
- remote management,
- embedded/edge deployments where filesystem assumptions are invalid,
- plugin systems where extensions are configured independently,
- product variants where different feature sets require different runtime parameters.

The important distinction:

```text
Static config answers: “What should this app use when it starts?”
OSGi config answers: “What should this runtime entity use whenever it exists?”
```

The second question is harder.

It requires identity.

That identity is the PID.

---

## 3. The PID: Persistent Identity

PID means Persistent Identity.

A PID is the stable key used by Configuration Admin to associate configuration with a target.

```text
PID -> configuration dictionary -> target service/component
```

Example PID:

```text
com.acme.case.escalation.rules
```

A PID is not necessarily:

- a class name,
- a bundle symbolic name,
- a service interface name,
- a file name,
- or a human-facing label.

It is a runtime identity key.

A good PID should be:

- stable across code refactoring,
- globally understandable inside the system,
- owned by a clear module/team,
- versionable through schema evolution rather than casual renaming,
- not dependent on physical deployment location,
- not randomly generated for singleton components,
- and not overloaded for unrelated configuration concerns.

Bad PID examples:

```text
Config
MyService
service
foo
com.acme.impl.DefaultCaseEscalationService
case
```

Better examples:

```text
com.acme.case.escalation.policy
com.acme.notification.email.smtp
com.acme.connector.onemap.client
com.acme.audit.retention.scheduler
com.acme.workflow.rule-engine
```

The PID should describe the configurable runtime concern, not the accidental Java class that currently consumes it.

---

## 4. Configuration Dictionary

Configuration Admin delivers configuration as a dictionary of properties.

Conceptually:

```text
PID: com.acme.notification.email.smtp

Dictionary:
  host = smtp.example.com
  port = 587
  tls.enabled = true
  connect.timeout.ms = 5000
  send.timeout.ms = 10000
  sender.address = no-reply@example.com
```

The dictionary is intentionally simple.

A property key is a string. A property value should be a supported simple type or array/collection of supported simple types.

Good values:

```text
String
Integer
Long
Boolean
Double
String[]
Integer[]
List<String>
```

Avoid:

```text
nested object graphs
mixed-type arrays
arbitrary serialized JSON blobs
custom Java objects
class instances
framework-specific objects
```

Why?

Because configuration is an integration boundary.

It may be edited by:

- web console,
- CLI,
- file watcher,
- remote management tool,
- deployment pipeline,
- custom admin service,
- test harness,
- or a config synchronization agent.

If the configuration format requires Java-specific object construction, the runtime contract becomes fragile.

A top-tier OSGi design treats configuration dictionaries like public API:

```text
stable keys
clear type
clear defaulting rule
validation rule
security classification
migration strategy
observability
```

---

## 5. Configuration Target

A configuration target is a runtime entity that receives configuration.

In raw Configuration Admin, the two classic target types are:

1. `ManagedService`
2. `ManagedServiceFactory`

In modern OSGi, most application code does not implement these directly. Declarative Services acts as the extender that consumes Configuration Admin and applies configuration to components.

Still, understanding the raw model is important because DS is built on top of these concepts.

---

## 6. ManagedService: One PID, One Logical Entity

`ManagedService` represents a singleton-style configurable target.

Mental model:

```text
One PID -> one configuration dictionary -> one logical component
```

Example:

```text
com.acme.audit.retention.scheduler
```

This might configure one scheduler component:

```text
retention.days = 365
cron = 0 0 2 * * ?
enabled = true
batch.size = 1000
```

A `ManagedService` receives:

```java
void updated(Dictionary<String, ?> properties) throws ConfigurationException;
```

If the configuration exists, `properties` contains the configuration.

If the configuration is deleted or unavailable, `properties` may be `null`.

That `null` is not a trivial case. It means:

```text
The target must define what it means to run without configuration.
```

Possible policies:

- deactivate,
- use defaults,
- enter degraded mode,
- fail fast,
- keep previous valid config,
- reject operations until config returns.

A weak implementation treats `null` as impossible.

A production implementation defines the behavior explicitly.

---

## 7. ManagedServiceFactory: One Factory PID, Many Instances

`ManagedServiceFactory` represents a configurable factory.

Mental model:

```text
One factory PID -> zero or more configuration dictionaries -> zero or more runtime instances
```

Example factory PID:

```text
com.acme.connector.remote-agency
```

Factory instance configurations:

```text
Instance A:
  agency.id = CEA
  base.url = https://cea.example
  timeout.ms = 5000

Instance B:
  agency.id = SLA
  base.url = https://sla.example
  timeout.ms = 8000

Instance C:
  agency.id = ROM
  base.url = https://rom.example
  timeout.ms = 6000
```

This is different from a singleton PID.

A singleton PID asks:

```text
What is the configuration for this one component?
```

A factory PID asks:

```text
How many configured component instances should exist, and what is each instance's config?
```

Typical use cases:

- multiple external connectors,
- multiple tenant definitions,
- multiple scheduled jobs,
- multiple data sources,
- multiple rule groups,
- multiple message consumers,
- multiple HTTP endpoint registrations,
- multiple document renderer profiles.

In raw API terms, a factory receives callbacks for:

- created instance configuration,
- updated instance configuration,
- deleted instance configuration.

In Declarative Services, this maps naturally to factory components.

---

## 8. Singleton PID vs Factory PID

This distinction is one of the most important design choices in OSGi configuration.

| Question | Singleton PID | Factory PID |
|---|---|---|
| Runtime cardinality | One logical target | Many target instances |
| Identity | PID | Factory PID + generated/instance PID |
| Example | One audit scheduler | Many agency connector clients |
| Update effect | Reconfigure one target | Reconfigure one instance |
| Delete effect | Component loses config | Instance removed |
| Common DS model | Configured component | Factory component |
| Operational concern | Safe reload | Instance lifecycle governance |

Bad modeling example:

```text
PID: com.acme.connector.remote-agency
Properties:
  agencies = CEA,SLA,ROM
  cea.base.url = ...
  sla.base.url = ...
  rom.base.url = ...
```

This puts a collection of runtime instances into one oversized configuration blob.

Better modeling:

```text
Factory PID: com.acme.connector.remote-agency

Instance 1:
  agency.id = CEA
  base.url = ...

Instance 2:
  agency.id = SLA
  base.url = ...

Instance 3:
  agency.id = ROM
  base.url = ...
```

Why better?

Because each connector instance becomes independently:

- created,
- updated,
- deleted,
- validated,
- observed,
- restarted,
- audited,
- and rolled back.

Top-tier heuristic:

```text
If a config object describes a list of independently manageable runtime things,
it probably wants a factory PID.
```

---

## 9. Declarative Services and Configuration Admin

Declarative Services is the normal way to consume Configuration Admin in modern OSGi.

A configured DS component might look like this:

```java
package com.acme.connector.onemap.internal;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;

@Component(service = PostalCodeLookup.class)
@Designate(ocd = OneMapClient.Config.class)
public class OneMapClient implements PostalCodeLookup {

    @ObjectClassDefinition(
        name = "OneMap Client",
        description = "Configuration for the OneMap postal code lookup client"
    )
    public @interface Config {
        @AttributeDefinition(name = "Base URL")
        String base_url();

        @AttributeDefinition(name = "Connect timeout in milliseconds")
        int connect_timeout_ms() default 3000;

        @AttributeDefinition(name = "Read timeout in milliseconds")
        int read_timeout_ms() default 5000;

        @AttributeDefinition(name = "Enabled")
        boolean enabled() default true;
    }

    private volatile RuntimeConfig config;

    @Activate
    void activate(Config cfg) {
        this.config = RuntimeConfig.from(cfg);
    }

    @Modified
    void modified(Config cfg) {
        this.config = RuntimeConfig.from(cfg);
    }

    @Override
    public Address lookup(String postalCode) {
        RuntimeConfig snapshot = config;
        if (!snapshot.enabled()) {
            throw new ServiceUnavailableException("OneMap lookup is disabled");
        }
        return doLookup(snapshot, postalCode);
    }
}
```

Several things are happening here:

1. `@Designate` links a Metatype Object Class Definition to the DS component.
2. The nested annotation `Config` defines typed configuration.
3. Build tooling generates Metatype XML.
4. DS receives the configuration and passes it into lifecycle methods.
5. `@Modified` allows update without full component destruction if the runtime can safely update in place.
6. The component converts external configuration into an immutable internal runtime config object.

This pattern is usually better than reading properties directly from files.

---

## 10. Configuration Policy in Declarative Services

DS components can declare how configuration affects activation.

The common policies are conceptually:

```text
optional
require
ignore
```

The practical meaning:

| Policy | Meaning | Typical use |
|---|---|---|
| Optional | Component can activate with or without config | Safe defaults exist |
| Require | Component cannot activate until config exists | Connector, credentials, external endpoint |
| Ignore | Component ignores Configuration Admin | Pure service, no runtime config |

Example:

```java
@Component(
    service = PostalCodeLookup.class,
    configurationPolicy = ConfigurationPolicy.REQUIRE
)
@Designate(ocd = OneMapClient.Config.class)
public class OneMapClient implements PostalCodeLookup {
    // ...
}
```

This says:

```text
Do not activate this component unless matching configuration is available.
```

That is powerful.

It prevents half-configured services from registering and failing later under traffic.

But it also has operational consequences:

- missing config means service absent,
- dependent components may become unsatisfied,
- startup readiness may fail,
- monitoring must distinguish “bundle active” from “component satisfied”.

A component with required config should have:

- clear PID documentation,
- Metatype metadata,
- validation error logging,
- health check visibility,
- deployment check before production rollout.

---

## 11. Activation vs Modification

There are two broad ways to handle configuration changes:

1. Recreate the component.
2. Modify the active component in place.

### 11.1 Recreate

A destructive update might do:

```text
Deactivate old component -> Activate new component with new config
```

This is safer when configuration affects:

- constructor dependencies,
- immutable service identity,
- thread pool sizing,
- network listener binding,
- database schema,
- security realm,
- persistence unit,
- service registration properties,
- factory instance identity.

### 11.2 Modify in Place

An in-place update might do:

```text
Call @Modified -> component changes internal runtime settings
```

This is useful when configuration affects:

- timeout values,
- enabled flag,
- retry count,
- cache TTL,
- rate limit,
- feature behavior,
- log verbosity,
- routing weight.

### 11.3 The Rule

The rule is not “always use `@Modified` because it avoids restart”.

The rule is:

```text
Use @Modified only when the component can transition atomically from old config to new config without violating invariants.
```

Unsafe modification example:

```java
@Modified
void modified(Config cfg) {
    this.host = cfg.host();
    this.port = cfg.port();
    this.timeout = cfg.timeout();
}
```

A concurrent call could observe:

```text
new host + old port + old timeout
```

Better:

```java
@Modified
void modified(Config cfg) {
    this.runtimeConfig = RuntimeConfig.from(cfg);
}
```

Where `runtimeConfig` is immutable and stored in a `volatile` field or `AtomicReference`.

Mental model:

```text
Never mutate configuration field-by-field if runtime calls can observe partial state.
Build a new immutable config snapshot, validate it, then publish it atomically.
```

---

## 12. Immutable Runtime Config Snapshot Pattern

External configuration is messy.

Internal runtime code should not consume raw dictionaries repeatedly.

Preferred pattern:

```text
external config -> validate -> normalize -> immutable runtime config -> atomic publish
```

Example:

```java
record RuntimeConfig(
    URI baseUri,
    Duration connectTimeout,
    Duration readTimeout,
    boolean enabled,
    int maxRetries
) {
    static RuntimeConfig from(Config cfg) {
        URI baseUri = URI.create(requireNonBlank(cfg.base_url(), "base_url"));

        if (cfg.connect_timeout_ms() <= 0) {
            throw new IllegalArgumentException("connect_timeout_ms must be > 0");
        }
        if (cfg.read_timeout_ms() <= 0) {
            throw new IllegalArgumentException("read_timeout_ms must be > 0");
        }
        if (cfg.max_retries() < 0 || cfg.max_retries() > 10) {
            throw new IllegalArgumentException("max_retries must be between 0 and 10");
        }

        return new RuntimeConfig(
            baseUri,
            Duration.ofMillis(cfg.connect_timeout_ms()),
            Duration.ofMillis(cfg.read_timeout_ms()),
            cfg.enabled(),
            cfg.max_retries()
        );
    }
}
```

In Java 8, use a final class instead of `record`:

```java
public final class RuntimeConfig {
    private final URI baseUri;
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final boolean enabled;
    private final int maxRetries;

    // constructor + getters
}
```

This pattern is useful from Java 8 to Java 25.

The implementation syntax changes, but the invariant does not.

---

## 13. Metatype: Configuration Schema for Humans and Tools

Configuration Admin stores dictionaries.

Metatype describes those dictionaries.

Think of Metatype as:

```text
configuration schema + UI metadata + type information + localization support
```

Without Metatype, an admin tool may know only:

```text
PID: com.acme.connector.onemap.client
Properties:
  base_url = ?
  connect_timeout_ms = ?
  enabled = ?
```

With Metatype, the tool can know:

- human-readable name,
- description,
- property type,
- default value,
- option list,
- cardinality,
- required fields,
- localization keys,
- icon metadata,
- singleton PID or factory PID association.

This enables tools like:

- Felix Web Console,
- Karaf config tooling,
- custom management UI,
- provisioning validators,
- config documentation generators,
- CI checks,
- and runtime admin dashboards.

Raw configuration answers:

```text
What values exist?
```

Metatype answers:

```text
What values are valid and what do they mean?
```

---

## 14. Object Class Definition

The central Metatype concept is the Object Class Definition, commonly shortened to OCD.

An OCD defines the shape of a configuration object.

Example:

```java
@ObjectClassDefinition(
    id = "com.acme.connector.onemap.client",
    name = "OneMap Client",
    description = "Controls endpoint, timeout, retry, and enablement for OneMap postal code lookup"
)
public @interface OneMapConfig {

    @AttributeDefinition(
        name = "Base URL",
        description = "Base URL of the OneMap API"
    )
    String base_url();

    @AttributeDefinition(
        name = "Connect timeout",
        description = "Connection timeout in milliseconds"
    )
    int connect_timeout_ms() default 3000;

    @AttributeDefinition(
        name = "Read timeout",
        description = "Read timeout in milliseconds"
    )
    int read_timeout_ms() default 5000;

    @AttributeDefinition(
        name = "Enabled",
        description = "Whether the client should accept lookup requests"
    )
    boolean enabled() default true;
}
```

Notice the naming style:

```text
base_url
connect_timeout_ms
read_timeout_ms
```

OSGi Metatype annotation method names map into property names. Underscore naming is often used to avoid awkward Java method naming for dotted property names.

Depending on tooling and component property type rules, names may be mapped. Be explicit in your project convention.

Top-tier advice:

```text
Do not let every team invent its own config key naming convention.
Define a convention early.
```

Recommended convention:

```text
For Java annotation methods: snake_case.
For external documented keys: dotted or snake_case, but consistent.
For PIDs: reverse-domain symbolic names.
For secrets: explicit secret reference keys, not secret values.
```

---

## 15. `@Designate`: Linking Schema to Component

`@ObjectClassDefinition` defines a schema.

`@Designate` links that schema to a component PID or factory PID.

Example singleton:

```java
@Component(configurationPolicy = ConfigurationPolicy.REQUIRE)
@Designate(ocd = OneMapConfig.class)
public class OneMapClient implements PostalCodeLookup {
    @Activate
    void activate(OneMapConfig config) {
        // ...
    }
}
```

Example factory:

```java
@Component(
    service = AgencyConnector.class,
    configurationPolicy = ConfigurationPolicy.REQUIRE
)
@Designate(ocd = AgencyConnectorConfig.class, factory = true)
public class AgencyConnectorImpl implements AgencyConnector {
    @Activate
    void activate(AgencyConnectorConfig config) {
        // each factory config creates one component configuration
    }
}
```

The difference is huge.

Singleton designate:

```text
one component configuration for the PID
```

Factory designate:

```text
zero or more component configurations for the factory PID
```

Use factory designate when administrators should be able to create multiple configured instances without changing code.

---

## 16. Configuration Properties vs Service Properties

Configuration properties are not the same as service properties.

Configuration properties are delivered to the component.

Service properties are published with service registration and used for service selection.

However, configuration properties can influence service properties.

Example:

```java
@Component(service = AgencyConnector.class)
@Designate(ocd = AgencyConnectorConfig.class, factory = true)
public class AgencyConnectorImpl implements AgencyConnector {

    @Activate
    Map<String, Object> activate(AgencyConnectorConfig cfg) {
        this.config = RuntimeConfig.from(cfg);

        return Map.of(
            "agency.id", cfg.agency_id(),
            "connector.kind", "remote-agency"
        );
    }
}
```

Then consumers can target a specific connector:

```java
@Reference(target = "(agency.id=CEA)")
AgencyConnector ceaConnector;
```

This is powerful but dangerous.

If service properties change after config update, DS may need to re-register the service or update service registration properties. Consumers using target filters can rebind.

That means a configuration change can alter service topology.

Top-tier mental model:

```text
Config changes do not only change values.
They may change the service graph.
```

Therefore, config review must consider:

- which service properties are derived from config,
- which consumers use LDAP filters,
- whether update causes rebinding,
- whether rebinding is safe under traffic,
- whether service ranking changes,
- whether multiple providers temporarily match.

---

## 17. Configuration Update as Runtime Event

A configuration update is not just “set property”.

It is a runtime event that can cause:

- component activation,
- component modification,
- component deactivation,
- service registration,
- service unregistration,
- reference rebinding,
- factory instance creation,
- factory instance deletion,
- connection pool recreation,
- thread pool resizing,
- cache invalidation,
- scheduled job rescheduling,
- external endpoint switch,
- health status change,
- readiness change,
- or runtime failure.

This is why production OSGi configuration must be treated as operationally sensitive.

Bad operational assumption:

```text
Changing config is safe because no code is deployed.
```

Better assumption:

```text
Changing config is a runtime topology mutation and must be designed, validated, audited, and observable.
```

---

## 18. Configuration Validation

Validation can happen at several layers.

### 18.1 Metatype Layer

Metatype can express basic shape:

- type,
- default,
- options,
- cardinality,
- name,
- description.

This helps admin tooling but does not replace runtime validation.

### 18.2 Activation Layer

Component activation should validate semantic rules:

```java
@Activate
void activate(Config cfg) {
    this.config = RuntimeConfig.from(cfg); // validates
}
```

Examples:

```text
base_url must be valid URI
connect_timeout_ms must be > 0
read_timeout_ms must be >= connect_timeout_ms
rate_limit_per_minute must be <= provider contract
cache_ttl_seconds must be lower than token TTL
credential_alias must exist in secret provider
```

### 18.3 Management Layer

A custom management UI or deployment pipeline should validate before writing config.

### 18.4 Integration Layer

Some validation requires external checks:

- can connect to endpoint,
- credentials work,
- database schema exists,
- message broker topic exists,
- OAuth token endpoint reachable,
- TLS certificate trusted.

Do not always run expensive integration validation inside `@Activate`, or startup may become slow/flaky.

A common pattern:

```text
strict local validation at activation
asynchronous external validation via health check
traffic only allowed after health is green
```

---

## 19. Required Config vs Default Config

Not every configuration should be required.

There are three broad categories.

### 19.1 Safe Defaults

Example:

```text
cache.enabled = true
cache.ttl.seconds = 300
retry.max.attempts = 3
```

A component can activate without explicit config.

### 19.2 Environment-Specific Required Config

Example:

```text
base.url
credential.alias
tenant.id
```

A component should not activate without this.

### 19.3 Policy-Specific Config

Example:

```text
case.escalation.deadline.days
audit.retention.years
risk.score.threshold
```

The component might technically run with defaults, but regulatory/domain correctness may require explicit approval.

Top-tier rule:

```text
Do not confuse technical default with business-approved default.
```

For regulatory or enforcement systems, a default value may be dangerous if it silently changes policy.

For those configs, prefer:

```text
configurationPolicy = REQUIRE
```

or require explicit `policy.version` / `approved.by` / `effective.date` metadata where appropriate.

---

## 20. Secrets Are Not Ordinary Configuration

Do not put secrets directly into normal OSGi configuration unless the runtime storage, access control, audit, and encryption model are explicitly designed for it.

Bad:

```text
client.secret = super-secret-value
smtp.password = password123
```

Better:

```text
client.secret.ref = ssm:/prod/onemap/client-secret
smtp.password.ref = vault:secret/mail/smtp-password
credential.alias = onemap-prod-client
```

Then a separate secret provider service resolves the secret at runtime:

```java
public interface SecretProvider {
    char[] resolve(String reference);
}
```

Configured component:

```java
@Reference
SecretProvider secretProvider;

@Activate
void activate(Config cfg) {
    RuntimeConfig base = RuntimeConfig.from(cfg);
    char[] secret = secretProvider.resolve(cfg.client_secret_ref());
    this.client = buildClient(base, secret);
}
```

Important details:

- avoid storing secrets in immutable `String` if you need memory hygiene,
- avoid logging raw config dictionaries,
- mark secret reference keys clearly,
- separate secret rotation from normal config update,
- define what happens when secret provider is unavailable,
- audit secret reference change without exposing secret value,
- ensure admin UI masks secret fields,
- do not put secrets in generated documentation.

In many cloud/container deployments, Configuration Admin should hold references, not secret material.

---

## 21. Configuration Admin Storage Is an Implementation Detail

Configuration Admin does not require that configuration be stored in files.

The configuration database may be backed by:

- local files,
- bundle cache,
- database,
- remote management system,
- cloud parameter store,
- custom provisioning service,
- Karaf configuration files,
- Felix FileInstall watched files,
- or an embedded device management subsystem.

Do not design application components around one storage mechanism.

A component should care about this:

```text
I receive validated configuration for my PID.
```

It should not care whether it came from:

```text
config.properties
Kubernetes ConfigMap
AWS SSM Parameter Store
HashiCorp Vault
Karaf etc/*.cfg
Felix FileInstall
custom admin console
```

This separation is the point.

---

## 22. Felix FileInstall and File-Based Configuration

Apache Felix FileInstall is a common way to manage bundles and configuration files by watching directories.

Conceptual model:

```text
watched directory -> FileInstall -> Configuration Admin / framework bundle operations
```

It can:

- detect new bundles,
- install/start them,
- detect updated bundles,
- update them,
- detect deleted bundles,
- stop/uninstall them,
- detect configuration files,
- update Configuration Admin.

This is convenient for local development and simple operations.

But it introduces operational concerns:

- polling delay,
- partial file writes,
- encoding issues,
- file syntax differences,
- write-back behavior,
- accidental deletion,
- config drift,
- race between bundle deployment and config deployment,
- inconsistent rollout if many files change independently.

Safer file deployment pattern:

```text
write new config to temp file
validate syntax
atomic rename into watched directory
observe Configuration Event
verify component state
```

Unsafe pattern:

```text
edit live config file directly in production with text editor
```

The unsafe pattern can lead to partial reads or invalid configuration being applied during edit.

---

## 23. Karaf Configuration Model

Apache Karaf commonly exposes configuration through files under `etc/` and shell commands such as config edit/update workflows.

Operationally, Karaf makes OSGi configuration feel more like a server distribution:

```text
etc/<pid>.cfg
etc/<factoryPid>-<alias>.cfg
Karaf shell config commands
Feature provisioning
Config Admin underneath
```

The key mental model remains the same:

```text
files/shell are management surfaces;
Configuration Admin is the runtime delivery mechanism.
```

Do not confuse Karaf file naming conventions with the OSGi spec itself.

When designing portable bundles, rely on:

- PIDs,
- Metatype,
- DS config policy,
- service properties,
- Configuration Admin semantics.

Let distribution-specific tooling adapt those into files, shell commands, or UI.

---

## 24. Configuration File Formats

Different OSGi distributions and tooling may support different formats:

- `.cfg`
- `.config`
- properties-style files
- typed configuration syntax
- JSON/YAML through custom tooling
- generated Configuration Admin updates through APIs

Engineering advice:

```text
Standardize one operational format per distribution.
Do not allow each team to choose randomly.
```

A good standard defines:

- file extension,
- encoding,
- array syntax,
- escaping rules,
- secret reference convention,
- comments policy,
- ownership metadata,
- validation pipeline,
- promotion path from DEV to UAT to PROD,
- rollback method,
- audit trail.

Configuration syntax errors should fail before production runtime receives them.

---

## 25. Configuration Plugins

Configuration Admin supports configuration plugin services that can inspect or modify dictionaries before they are delivered to targets.

This is powerful.

Use cases:

- inject environment-specific values,
- resolve placeholders,
- mask sensitive values,
- apply defaults,
- normalize legacy keys,
- enforce policy,
- add metadata,
- decrypt values,
- validate global constraints,
- enrich configuration with runtime data.

But configuration plugins are also dangerous.

They can make delivered configuration differ from stored configuration.

That means debugging requires answering:

```text
What was stored?
What plugins ran?
In what order?
What was delivered?
What did the target accept?
```

If you use configuration plugins, provide diagnostics:

- plugin ordering,
- before/after diff with secret masking,
- target PID,
- timestamp,
- plugin bundle/version,
- error reporting,
- whether delivery was blocked or modified.

Avoid hidden magic.

Top-tier rule:

```text
A configuration plugin must be observable as part of the configuration pipeline.
```

---

## 26. Configuration Events

Configuration changes can emit events.

These are useful for:

- audit,
- monitoring,
- cache invalidation,
- admin UI refresh,
- diagnostics,
- compliance logging,
- drift detection.

But do not make business behavior depend casually on configuration events.

The primary delivery path should be:

```text
Configuration Admin -> target update / DS lifecycle
```

Events are secondary observation.

Bad:

```text
Component ignores @Modified and instead listens to config event to reload itself.
```

Better:

```text
Component receives config through DS lifecycle.
Audit bundle observes configuration events for logging.
Admin dashboard observes events for UI update.
```

---

## 27. Configuration and Service Topology

Configuration can control service topology.

Examples:

### 27.1 Enable/Disable Service

```text
enabled = false
```

Choices:

- keep service registered but reject calls,
- unregister service,
- register degraded service,
- expose service with property `enabled=false`,
- use target filters so consumers only bind enabled providers.

Each has different consequences.

If service remains registered:

```text
consumers keep reference, calls fail fast
```

If service unregisters:

```text
consumers with mandatory reference deactivate or rebind
```

If service property changes:

```text
consumers using target filters may rebind
```

There is no universal right answer.

Choose based on contract.

### 27.2 Service Ranking

Configuration might change:

```text
service.ranking = 100
```

This affects which service is preferred.

Be careful. A ranking update can shift traffic from one implementation to another.

Treat ranking changes like routing changes.

### 27.3 Target Filters

Configuration can change reference target:

```java
@Reference(target = "(agency.id=CEA)")
AgencyConnector connector;
```

If target is externally configurable, rebinding becomes a runtime behavior.

A top-tier design documents which references may be dynamically retargeted.

---

## 28. Dynamic Configuration Failure Modes

Configuration errors are not all equal.

Here is a useful taxonomy.

### 28.1 Missing Configuration

Symptoms:

- component unsatisfied,
- service missing,
- dependent components inactive,
- readiness fails.

Typical causes:

- PID typo,
- config file missing,
- wrong factory PID,
- wrong bundle targeting,
- config deployed after bundle,
- configuration policy require.

### 28.2 Invalid Type

Symptoms:

- configuration delivery error,
- activation exception,
- default value unexpectedly used,
- property ignored.

Typical causes:

- string where integer expected,
- array syntax wrong,
- boolean encoded inconsistently,
- tooling format mismatch.

### 28.3 Invalid Semantic Value

Symptoms:

- component activates then fails operations,
- external calls fail,
- health check red,
- traffic errors after config change.

Typical causes:

- URL unreachable,
- timeout too low,
- credentials invalid,
- rate limit above provider allowance,
- business threshold invalid.

### 28.4 Partial Update

Symptoms:

- component observes inconsistent config,
- some instances updated, others not,
- traffic split unexpectedly.

Typical causes:

- multi-file deployment without transaction,
- field-by-field mutable update,
- config plugin failure,
- manual edit.

### 28.5 Wrong Target

Symptoms:

- config exists but component does not receive it,
- another bundle receives it,
- old bundle version receives it,
- factory instance not created.

Typical causes:

- PID mismatch,
- targeted PID mismatch,
- location binding,
- factory vs singleton confusion,
- duplicate PID reuse.

### 28.6 Secret Resolution Failure

Symptoms:

- activation fails,
- health check red,
- external auth fails,
- retry storm.

Typical causes:

- missing secret alias,
- permission issue,
- secret provider unavailable,
- rotated secret incompatible,
- stale cached secret.

### 28.7 Configuration Drift

Symptoms:

- PROD differs from expected Git state,
- restart changes behavior,
- rollback does not restore config,
- node A differs from node B.

Typical causes:

- manual console edits,
- FileInstall write-back,
- local persistent config store,
- non-idempotent provisioning,
- no config audit.

---

## 29. Configuration Schema Evolution

Configuration schema evolves just like API.

Changes include:

- adding property,
- removing property,
- renaming property,
- changing type,
- changing default,
- changing meaning,
- splitting singleton into factory,
- merging multiple configs,
- changing secret reference format,
- changing validation rules.

Each change has compatibility impact.

### 29.1 Adding Optional Property

Usually backward-compatible.

```text
retry.jitter.enabled = true
```

Old config still works if default is safe.

### 29.2 Adding Required Property

Potentially breaking.

Old deployments may fail activation.

Migration needed.

### 29.3 Renaming Property

Breaking unless alias is supported.

Migration strategy:

```text
read old key + new key
warn if old key is used
write migrated config through management tool
remove old key in next major version
```

### 29.4 Changing Type

Often breaking.

Example:

```text
timeout.ms: int -> duration string
```

Migration strategy:

```text
accept both temporarily
normalize internally
emit deprecation warning
update config files
remove old format later
```

### 29.5 Changing Default

Can be dangerous.

Default changes alter behavior even if config file did not change.

For regulated systems, default changes should be treated like policy changes.

### 29.6 Splitting Config

Example:

```text
com.acme.connector.onemap
```

split into:

```text
com.acme.connector.onemap.auth
com.acme.connector.onemap.lookup
com.acme.connector.onemap.rate-limit
```

This may improve ownership but complicates activation dependencies.

Use only when lifecycle boundaries justify it.

---

## 30. Configuration Versioning Pattern

Sometimes it is useful to include schema metadata:

```text
schema.version = 2
config.owner = platform-team
config.effective.date = 2026-07-01
```

This is not automatically understood by OSGi, but it is useful for management tooling and validation.

For critical config, consider:

```text
schema.version
policy.version
approved.by
approved.at
change.ticket
environment
secret.rotation.policy
```

Do not overload application code with audit metadata unless needed at runtime.

Better separation:

```text
Runtime config keys -> consumed by component
Management metadata -> consumed by governance/audit tooling
```

You can prefix private/internal metadata keys if your tooling supports it.

---

## 31. Configuration Ownership

Every PID needs an owner.

Ownership answers:

- who defines schema,
- who approves changes,
- who validates values,
- who handles incident when invalid config breaks runtime,
- who migrates old configs,
- who documents operational runbook.

A production PID should have metadata like:

```text
PID: com.acme.connector.onemap.client
Owner: Platform Integration Team
Runtime criticality: High
Config policy: Required
Secret usage: credential.alias only
Change approval: Integration lead + operations
Rollback: restore previous config dictionary, verify health
```

Without ownership, dynamic config becomes a hidden production risk.

---

## 32. Configuration Granularity

Granularity is a design decision.

Too coarse:

```text
one giant PID for everything
```

Problems:

- unrelated changes restart same component,
- poor ownership,
- difficult validation,
- hard rollback,
- huge blast radius,
- no independent factory instances.

Too fine:

```text
one PID per tiny property
```

Problems:

- activation dependencies explode,
- ordering issues,
- hard to reason about complete state,
- inconsistent partial updates,
- too many files/entries.

Good granularity aligns with runtime lifecycle.

Heuristic:

```text
Configuration keys that must change atomically usually belong together.
Configuration keys with different lifecycle or ownership usually belong apart.
```

Examples:

### Good Together

```text
base.url
connect.timeout.ms
read.timeout.ms
retry.max
```

For one HTTP client.

### Better Separate

```text
HTTP client endpoint config
OAuth credential config
rate limit policy
business eligibility threshold
```

Because they may have different owners, lifecycle, and validation rules.

---

## 33. Configuration and Thread Safety

Configuration can change while service methods are running.

So component code must be thread-safe under reconfiguration.

Unsafe:

```java
private URI baseUri;
private int timeout;
private boolean enabled;

@Modified
void modified(Config cfg) {
    this.baseUri = URI.create(cfg.base_url());
    this.timeout = cfg.timeout_ms();
    this.enabled = cfg.enabled();
}

public Result call() {
    if (!enabled) throw new DisabledException();
    return httpCall(baseUri, timeout);
}
```

Safe:

```java
private volatile RuntimeConfig config;

@Modified
void modified(Config cfg) {
    this.config = RuntimeConfig.from(cfg);
}

public Result call() {
    RuntimeConfig snapshot = config;
    if (!snapshot.enabled()) throw new DisabledException();
    return httpCall(snapshot.baseUri(), snapshot.timeout());
}
```

For complex resources:

```text
new config -> build new resource -> health check -> atomically swap -> drain old resource -> close old resource
```

Example:

```java
@Modified
void modified(Config cfg) {
    RuntimeConfig nextConfig = RuntimeConfig.from(cfg);
    Client nextClient = ClientFactory.create(nextConfig);
    nextClient.probe();

    Client old = this.clientRef.getAndSet(nextClient);
    closeLaterAfterDrain(old);
}
```

This is safer for:

- HTTP clients,
- DB pools,
- broker connections,
- thread pools,
- caches,
- scheduler handles.

---

## 34. Configuration and Resource Lifecycle

Some config changes require resource recreation.

Examples:

| Config change | Resource effect |
|---|---|
| DB URL changes | recreate datasource/pool |
| Thread pool size changes | resize or recreate executor |
| TLS truststore changes | recreate SSL context/client |
| Consumer topic changes | unsubscribe/subscribe |
| Cron changes | reschedule job |
| HTTP port changes | rebind listener |
| Cache size changes | resize/recreate cache |
| Credential alias changes | rebuild authenticated client |

Resource lifecycle must be explicit.

Do not simply update fields and hope libraries adapt.

Pattern:

```text
validate new config
construct new resource
start/probe new resource
publish new resource
stop old resource gracefully
record transition
```

If construction fails:

- reject new config and keep old resource,
- or deactivate component,
- or enter degraded mode.

Choose deliberately.

---

## 35. Reject New Config or Fail Component?

When a new config is invalid, what should happen?

Options:

### 35.1 Reject and Keep Old Config

Good for high-availability services where old config is still valid.

```text
new config invalid -> log error -> keep current runtime snapshot -> health warning
```

But Configuration Admin may consider the config updated even if component refuses to apply it.

You need diagnostics showing:

```text
stored config version != applied config version
```

### 35.2 Fail Component

Good when running with stale config is dangerous.

```text
new config invalid -> throw activation/modified error -> component unsatisfied/deactivated
```

This is safer for policy-critical behavior.

### 35.3 Degraded Mode

Good when partial service is better than no service.

```text
external connector config invalid -> connector unavailable -> fallback to manual processing
```

Top-tier decision rule:

```text
If stale config can violate business/regulatory correctness, fail closed.
If stale config only affects optimization or non-critical integration, keeping last-known-good may be acceptable.
```

Document this per PID.

---

## 36. Last-Known-Good Pattern

For some systems, last-known-good configuration is valuable.

Runtime state:

```text
stored config: latest attempted config
applied config: last successfully validated config
```

This is not built into simple DS config usage. You must design it.

Useful metadata:

```text
applied.config.hash
applied.config.timestamp
failed.config.hash
failed.config.error
failed.config.timestamp
```

Health response example:

```json
{
  "pid": "com.acme.connector.onemap.client",
  "storedConfigHash": "sha256:abc",
  "appliedConfigHash": "sha256:def",
  "status": "DEGRADED",
  "reason": "latest config failed validation; using previous config"
}
```

This is especially useful for remote-managed or edge systems.

---

## 37. Configuration Drift

Drift occurs when runtime configuration differs from the intended source of truth.

Drift sources:

- manual web console edits,
- shell edits,
- local file changes,
- FileInstall write-back,
- emergency production fixes,
- failed deployment rollback,
- node-local persistent config,
- different config admin stores across cluster nodes.

Drift detection requires comparing:

```text
intended config -> deployed config -> Configuration Admin store -> delivered config -> applied config
```

Those are not always identical.

Production-grade systems should define:

- source of truth,
- allowed emergency override mechanism,
- drift detection job,
- audit logging,
- reconciliation process,
- rollback process.

In containerized OSGi, prefer immutable config injection and disable uncontrolled local mutation unless there is a clear operational reason.

---

## 38. Clustered Runtime Concern

OSGi Configuration Admin is local to a framework instance unless an implementation or management layer synchronizes it.

If you run multiple JVMs/pods/nodes:

```text
Node A Configuration Admin != Node B Configuration Admin
```

unless synchronized.

This matters for Kubernetes/cloud deployments.

If configuration is mounted from the same ConfigMap but each pod has local CM state, updates may still roll out differently depending on:

- file polling timing,
- pod restart timing,
- local cache,
- FileInstall behavior,
- management agent behavior,
- failed validation on one node,
- version skew between bundles.

Top-tier production rule:

```text
Do not assume OSGi configuration is cluster-consistent just because the application is deployed in a cluster.
```

Define consistency model:

- eventually consistent config,
- rolling config update,
- all-at-once config update,
- canary config update,
- per-tenant config update,
- per-node override.

---

## 39. Config in Kubernetes/Cloud Runtime

A common modern model:

```text
Git -> CI validation -> ConfigMap/Secret/SSM/Vault -> sync agent -> Configuration Admin -> DS components
```

Good separation:

- Kubernetes ConfigMap holds non-secret config files or config source references.
- Kubernetes Secret or cloud secret manager holds secret material.
- OSGi Configuration Admin receives runtime dictionaries.
- Components receive typed configuration.
- SecretProvider resolves secret references.

Avoid this:

```text
Component reads Kubernetes files directly.
```

That bypasses OSGi runtime semantics.

Prefer this:

```text
Kubernetes/files/cloud source -> management agent -> Configuration Admin -> DS
```

Then runtime behavior remains consistent across local, VM, Karaf, Felix, and container deployments.

---

## 40. Java 8 to 25 Considerations

Configuration Admin itself is not about Java language features, but Java version affects implementation style.

### Java 8

Use:

- final classes for config snapshots,
- `AtomicReference`,
- `Optional` carefully,
- no records,
- no text blocks,
- no pattern matching.

### Java 11

Useful improvements:

- better HTTP client if used by configured connector,
- `var` for local variables,
- improved TLS defaults.

### Java 17

Useful improvements:

- records for config snapshots,
- sealed classes for config validation result if useful,
- stronger encapsulation impact on libraries.

### Java 21

Useful improvements:

- virtual threads for blocking connector implementations, if framework/library compatible,
- pattern matching improvements,
- better structured modeling.

### Java 25

By Java 25-era systems, you should assume:

- strong encapsulation is normal,
- old reflective config libraries may break,
- Security Manager-era assumptions are obsolete,
- modern TLS/security provider behavior may differ from Java 8,
- old OSGi bundles compiled for Java 8 may still run if dependencies are compatible, but newer bytecode cannot run on old JVMs.

Configuration-specific warning:

```text
Do not encode Java-version-specific behavior in config without clear compatibility rules.
```

Bad:

```text
thread.mode = virtual
```

if runtime may be Java 8.

Better:

```text
execution.strategy = default
```

and runtime capability decides whether virtual threads are available.

Or explicitly validate:

```text
execution.strategy = virtual-thread
```

fails fast on Java versions that do not support it.

---

## 41. Configuring Thread Pools and Virtual Threads

Configuration often controls concurrency.

Examples:

```text
worker.pool.size = 16
queue.capacity = 1000
rate.limit.per.minute = 250
execution.strategy = platform-thread
```

With Java 21+, virtual threads may change the concurrency model.

But OSGi service lifecycle still matters.

If a config change recreates an executor:

- existing tasks must be drained or cancelled,
- component deactivation must close executor,
- old classloader must not be retained by running tasks,
- thread names should include bundle/component identity,
- metrics should distinguish old/new executor generations.

Classloader leak risk:

```text
old executor thread -> retains runnable -> retains component -> retains bundle classloader
```

Config update can cause memory leaks if old resources are not stopped.

This is not a Java syntax issue. It is a runtime lifecycle issue.

---

## 42. Configuring Schedulers

Schedulers are common OSGi config targets.

Example config:

```text
cron = 0 0 2 * * ?
enabled = true
batch.size = 500
max.duration.minutes = 30
```

Config update concerns:

- if cron changes, reschedule job,
- if enabled becomes false, stop future executions,
- if job currently running, decide whether to cancel or let it finish,
- if batch size changes mid-run, define snapshot behavior,
- if config is removed, unschedule,
- if bundle stops, cancel/drain tasks.

Good pattern:

```text
Each job execution captures config snapshot at start.
Running job is unaffected by later config update unless cancellation policy says otherwise.
```

This avoids half-run config changes.

---

## 43. Configuring Connectors

External connector config is high risk.

Typical keys:

```text
base.url
credential.alias
connect.timeout.ms
read.timeout.ms
retry.max
retry.backoff.ms
rate.limit.per.minute
circuit.breaker.enabled
cache.ttl.seconds
```

Design questions:

- Is the connector registered if disabled?
- Does credential change recreate client?
- Does base URL change require health probe before swap?
- Are old in-flight requests allowed to complete?
- Does rate limit update apply immediately?
- Does cache survive config update?
- Are metrics tagged by endpoint/config generation?
- Is secret material logged accidentally?

Connector config should almost always be modeled as a runtime contract, not just properties.

---

## 44. Configuring Business Rules

Business/rule config is different from technical config.

Example:

```text
case.escalation.days = 14
appeal.submission.window.days = 30
risk.score.threshold = 75
inspection.required.amount = 100000
```

This can affect legal/regulatory outcomes.

Therefore:

- defaults must be explicit,
- changes should be audited,
- effective date may matter,
- old cases may need old rules,
- config update may not apply retroactively,
- rule versioning may be required,
- runtime must expose which rule version was used.

Important invariant:

```text
Do not use mutable global runtime config as the sole record of rule behavior for historical decisions.
```

For case management or enforcement lifecycle systems, persist the rule version/config snapshot used for decisions.

Otherwise, later config changes make old outcomes hard to explain.

---

## 45. Configuration Audit

Audit should capture:

```text
who changed config
when
which PID
which factory instance
old value hash/diff
new value hash/diff
approval reference
source channel
whether applied successfully
which components were affected
```

For secret fields:

```text
record key changed, not secret value
record secret reference changed, not resolved secret
```

A useful audit model separates:

1. Config store mutation.
2. Config delivery to target.
3. Config application by component.
4. Runtime health after application.

Example audit timeline:

```text
10:00:01 config updated in admin store
10:00:02 ConfigurationEvent CM_UPDATED emitted
10:00:02 DS modified component com.acme.connector.onemap
10:00:03 component applied config hash sha256:abc
10:00:04 health check passed
```

This is much more useful than only recording “file changed”.

---

## 46. Configuration Observability

Expose configuration state safely.

Useful diagnostics:

- PID exists/missing,
- factory instance count,
- schema version,
- config hash,
- applied hash,
- last update timestamp,
- last successful apply timestamp,
- last failure reason,
- component state,
- service registration state,
- derived service properties,
- secret references present/missing,
- validation status.

Do not expose:

- passwords,
- access tokens,
- client secrets,
- private keys,
- full authorization headers,
- personal data embedded in config.

A safe diagnostic output:

```json
{
  "pid": "com.acme.connector.onemap.client",
  "status": "APPLIED",
  "schemaVersion": 2,
  "configHash": "sha256:abc123",
  "lastUpdatedAt": "2026-06-17T14:10:00Z",
  "lastAppliedAt": "2026-06-17T14:10:01Z",
  "secretRefs": ["credential.alias:onemap-prod"],
  "component": "ACTIVE",
  "serviceRegistered": true
}
```

---

## 47. Configuration Health Checks

Health checks should distinguish:

```text
configuration presence
configuration validity
configuration application
external dependency readiness
```

Example statuses:

| Status | Meaning |
|---|---|
| MISSING_CONFIG | Required PID absent |
| INVALID_CONFIG | Present but failed validation |
| APPLY_FAILED | Valid-looking config failed during resource creation |
| DEGRADED | Last config failed, last-known-good running |
| APPLIED | Config applied locally |
| READY | Config applied and external dependency verified |

This distinction helps operations.

Without it, all failures become vague:

```text
service unavailable
```

With it, you can say:

```text
service unavailable because required config PID is missing
```

or:

```text
connector active but external credential validation failed
```

---

## 48. Configuration and Rollback

Rollback is not always simple.

Rollback can mean:

- restore previous config dictionary,
- delete newly added factory instance,
- restore previous factory instance config,
- restore previous secret alias,
- restore previous service ranking,
- restore previous bundle version,
- refresh bundles,
- restart component,
- or restart framework.

A good rollback plan records:

```text
previous config hash
previous config content or version
affected PIDs
affected components
whether component supports @Modified rollback
whether resource recreation is required
health verification steps
```

Rollback should be tested.

Do not assume that because config can update forward, it can safely update backward.

Example problem:

```text
new config migration writes new property names
old bundle version expects old property names
rollback code but not config -> old bundle fails
```

Bundle rollback and config rollback must be compatible.

---

## 49. Configuration and Feature Flags

Feature flags can be modeled through Configuration Admin, but be careful.

Simple technical flag:

```text
new.renderer.enabled = true
```

May be fine.

Complex rollout flag:

```text
new.workflow.enabled.for.tenants = A,B,C
percentage = 25
```

May require a dedicated feature flag service.

OSGi-friendly model:

```java
public interface FeatureFlagService {
    boolean isEnabled(String flag, EvaluationContext context);
}
```

Configuration Admin configures the feature flag service, not every component independently.

This centralizes:

- evaluation rules,
- audit,
- rollout,
- targeting,
- defaults,
- kill switch,
- metrics.

Avoid scattering feature flags across many unrelated PIDs without governance.

---

## 50. Configuration and Multi-Tenancy

Multi-tenant OSGi systems need careful config identity.

Bad:

```text
tenant.config = giant JSON map
```

Better:

```text
Factory PID: com.acme.tenant.profile
Instance per tenant:
  tenant.id = tenant-a
  feature.policy = standard
  data.partition = p01
```

But be careful with tenant isolation.

Configuration must not leak across tenants.

Consider:

- tenant ID in service property,
- LDAP target filters,
- tenant-aware service lookup,
- permission checks,
- audit per tenant,
- config ownership per tenant,
- factory instance lifecycle,
- config deletion behavior.

Do not allow arbitrary components to bind to all tenant configs unless designed.

---

## 51. Targeted PIDs and Location Binding

Configuration Admin supports more advanced targeting semantics where a configuration can be targeted to a specific bundle symbolic name, version, or location.

The high-level purpose:

```text
same logical PID, but apply different configuration to specific bundle target
```

Use cases:

- different bundle versions temporarily deployed,
- migration/canary scenarios,
- same PID used by multiple bundles,
- region-like isolation,
- management agent scoping.

However, targeted PIDs and location binding are advanced features.

They can make diagnostics harder.

If config exists but is not delivered, the reason may be:

- bundle symbolic name mismatch,
- version mismatch,
- location mismatch,
- dynamic binding behavior,
- multi-location visibility,
- permission rules.

Top-tier advice:

```text
Use ordinary PIDs for most application components.
Use targeted PIDs only when you have a clear operational need and diagnostics.
```

For multi-tenant/business separation, factory PIDs and service properties are often clearer than targeted PIDs.

---

## 52. Configuration Naming Conventions

Recommended PID naming:

```text
<reverse-domain>.<domain>.<component>.<concern>
```

Examples:

```text
com.acme.audit.retention.scheduler
com.acme.connector.onemap.client
com.acme.workflow.escalation.policy
com.acme.notification.smtp.sender
com.acme.case.assignment.rule-engine
```

Recommended key naming:

```text
base.url
connect.timeout.ms
read.timeout.ms
enabled
max.retries
credential.alias
rate.limit.per.minute
cache.ttl.seconds
```

Recommended factory instance identity key:

```text
instance.id
agency.id
tenant.id
connector.id
job.id
```

Avoid ambiguous names:

```text
name
id
type
url
timeout
flag
mode
```

Unless qualified by context.

Better:

```text
agency.id
base.url
read.timeout.ms
execution.mode
```

---

## 53. Configuration Documentation Template

Every production PID should be documented.

Template:

```markdown
## PID: com.acme.connector.onemap.client

### Purpose
Configures the OneMap postal-code lookup connector.

### Cardinality
Singleton PID.

### Configuration Policy
Required in UAT/PROD. Optional in local DEV with mock mode.

### Owner
Platform Integration Team.

### Runtime Impact
Changing endpoint or credential recreates the client.
Changing timeout applies atomically to new requests.
Changing enabled=false causes service to reject calls but remain registered.

### Keys
| Key | Type | Required | Default | Secret | Description |
|---|---|---:|---|---:|---|
| base.url | String/URI | yes | - | no | Base URL of OneMap API |
| credential.alias | String | yes | - | no | Reference to secret provider credential |
| connect.timeout.ms | int | no | 3000 | no | HTTP connect timeout |
| read.timeout.ms | int | no | 5000 | no | HTTP read timeout |
| enabled | boolean | no | true | no | Enables lookup operations |

### Validation
- base.url must be HTTPS in PROD.
- connect.timeout.ms must be between 100 and 30000.
- read.timeout.ms must be between connect.timeout.ms and 60000.
- credential.alias must exist in SecretProvider.

### Rollback
Restore previous config version and verify connector health.

### Audit
All changes require change ticket.
```

This level of documentation prevents runtime surprises.

---

## 54. Development Workflow

A healthy development workflow:

```text
1. Define PID and ownership.
2. Define typed config annotation.
3. Add Metatype metadata.
4. Add DS @Designate.
5. Validate config into immutable runtime config.
6. Decide activation policy.
7. Decide @Modified behavior.
8. Add tests for missing/invalid/updated config.
9. Add diagnostics/health.
10. Add sample config file.
11. Add config documentation.
12. Add CI validation for Metatype and sample configs.
```

Do not start by writing arbitrary `.cfg` files.

Start by defining the runtime contract.

---

## 55. Testing Configuration

Test cases should cover:

### 55.1 Missing Config

```text
required config absent -> component unsatisfied / service absent
```

### 55.2 Valid Config

```text
config present -> component active -> service registered
```

### 55.3 Invalid Type

```text
timeout = abc -> validation/delivery failure
```

### 55.4 Invalid Semantic Value

```text
rate.limit.per.minute = 100000 -> validation failure
```

### 55.5 Modification

```text
old timeout = 1000
new timeout = 5000
new calls use 5000 atomically
```

### 55.6 Delete Config

```text
config deleted -> component deactivated or fallback behavior
```

### 55.7 Factory Instance Create/Delete

```text
add agency connector config -> service appears
remove config -> service disappears
```

### 55.8 Secret Reference Missing

```text
credential.alias missing -> component fails or degraded mode
```

### 55.9 Service Property Change

```text
agency.id changes -> consumers rebind safely
```

### 55.10 Rollback

```text
apply config v2 -> apply config v1 -> service returns to previous behavior
```

---

## 56. Example: Factory-Based Agency Connectors

Imagine a regulatory platform that must integrate with multiple external agencies.

We want each agency connector to be configured independently.

### Contract

Factory PID:

```text
com.acme.connector.agency.http
```

Each instance:

```text
agency.id
base.url
credential.alias
connect.timeout.ms
read.timeout.ms
enabled
```

### Code Sketch

```java
@Component(
    service = AgencyConnector.class,
    configurationPolicy = ConfigurationPolicy.REQUIRE
)
@Designate(ocd = AgencyHttpConnector.Config.class, factory = true)
public class AgencyHttpConnector implements AgencyConnector {

    @ObjectClassDefinition(
        name = "Agency HTTP Connector",
        description = "Creates one HTTP connector instance for an external agency"
    )
    public @interface Config {
        String agency_id();
        String base_url();
        String credential_alias();
        int connect_timeout_ms() default 3000;
        int read_timeout_ms() default 10000;
        boolean enabled() default true;
    }

    private volatile RuntimeConfig config;
    private volatile HttpClient client;

    @Activate
    Map<String, Object> activate(Config cfg) {
        RuntimeConfig rc = RuntimeConfig.from(cfg);
        HttpClient hc = buildClient(rc);
        this.config = rc;
        this.client = hc;

        return Map.of(
            "agency.id", rc.agencyId(),
            "connector.protocol", "http",
            "enabled", rc.enabled()
        );
    }

    @Modified
    Map<String, Object> modified(Config cfg) {
        RuntimeConfig rc = RuntimeConfig.from(cfg);
        HttpClient hc = buildClient(rc);

        HttpClient old = this.client;
        this.config = rc;
        this.client = hc;
        closeQuietly(old);

        return Map.of(
            "agency.id", rc.agencyId(),
            "connector.protocol", "http",
            "enabled", rc.enabled()
        );
    }

    @Deactivate
    void deactivate() {
        closeQuietly(client);
    }
}
```

### Consumer

```java
@Component
public class CeaSubmissionGateway {

    @Reference(target = "(agency.id=CEA)")
    AgencyConnector ceaConnector;
}
```

### Runtime Behavior

- Add CEA config -> CEA connector service appears.
- Add SLA config -> SLA connector service appears.
- Delete SLA config -> SLA connector service disappears.
- Change CEA URL -> CEA connector rebuilds client.
- Change CEA agency ID -> service properties change; consumers may rebind.

### Design Warning

Changing `agency.id` is not a harmless property change. It changes service identity.

Often, identity fields should be immutable. If agency ID changes, delete old factory instance and create a new one.

---

## 57. Example: Business Policy Config

PID:

```text
com.acme.case.escalation.policy
```

Config:

```text
policy.version = 2026.07
standard.deadline.days = 14
high.risk.deadline.days = 3
weekend.handling = NEXT_BUSINESS_DAY
effective.date = 2026-07-01
```

Design questions:

- Should config update affect existing cases?
- Should each case persist policy version?
- Should effective date be enforced by runtime?
- Can policy be changed without approval?
- What if config is missing?
- What if current date is before effective date?

Safer model:

```text
PolicyConfig service exposes current effective policy.
Case decision stores policy.version and relevant computed deadline.
Historical decisions do not depend on mutable current config.
```

This is the difference between technical config and regulatory policy configuration.

---

## 58. Anti-Patterns

### 58.1 Reading Files Directly from Components

Bad:

```java
Files.readString(Path.of("/etc/app/config.properties"));
```

Why bad:

- bypasses Configuration Admin,
- hard to update dynamically,
- hard to test,
- environment-specific,
- no Metatype,
- no PID identity,
- no lifecycle integration.

### 58.2 Giant JSON Blob

Bad:

```text
settings = { huge nested JSON }
```

Why bad:

- no typed metadata,
- hard to validate partially,
- poor diff/audit,
- hard for admin UI,
- hidden schema.

### 58.3 Secrets in Plain Config

Bad:

```text
password = actual-password
```

Use secret references.

### 58.4 Using Config as Database

Bad:

```text
users.1.name = ...
users.2.name = ...
orders.1.id = ...
```

Configuration is not operational data storage.

### 58.5 Overusing `@Modified`

Bad:

```text
update everything in place even when resources must be recreated
```

### 58.6 No Validation

Bad:

```text
accept config and fail later under traffic
```

### 58.7 PID Coupled to Impl Class

Bad:

```text
com.acme.connector.internal.DefaultClientImpl
```

Refactoring breaks operational identity.

### 58.8 Uncontrolled Console Edits

Bad:

```text
production config changed manually, source of truth not updated
```

### 58.9 No Factory PID for Multi-Instance Things

Bad:

```text
connector.ids = A,B,C
connector.A.url = ...
connector.B.url = ...
```

Use factory PID.

### 58.10 Logging Raw Config

Bad:

```java
log.info("Config updated: {}", dictionary);
```

May leak secrets or sensitive policy data.

---

## 59. Troubleshooting Playbook

### Problem: Bundle Active, Component Missing

Check:

```text
Is DS runtime active?
Is component description present?
Is configurationPolicy REQUIRE?
Does PID exist?
Is PID spelled correctly?
Is config targeted to correct bundle?
Did activation throw exception?
Are required references missing?
```

### Problem: Config Exists, Component Did Not Receive It

Check:

```text
PID mismatch
factory PID vs singleton PID confusion
location binding
targeted PID mismatch
wrong config file naming convention
Configuration Admin not running
FileInstall did not parse file
config syntax error
permissions
```

### Problem: Component Restarts on Every Config Change

Check:

```text
Does component lack @Modified?
Are service properties changing?
Does DS need to recreate due to static reference/config policy?
Does resource recreation fail?
```

### Problem: Consumers Rebind Unexpectedly

Check:

```text
service.ranking changed
target filter properties changed
service unregistered/re-registered
factory instance recreated
configuration changed service identity
```

### Problem: Config Works Locally but Not in Karaf/Felix

Check:

```text
file format
encoding
array syntax
PID file naming
metatype generated correctly
bundle has Service-Component header
Config Admin implementation installed
FileInstall settings
```

### Problem: Old Config Persists After Deployment

Check:

```text
Configuration Admin persistent store
local cache
FileInstall write-back
manual console changes
container volume persistence
framework cache not cleared
```

---

## 60. Design Review Checklist

Use this checklist before approving a configured OSGi component.

### PID and Schema

- [ ] PID is stable and reverse-domain style.
- [ ] PID is not tied to implementation class.
- [ ] Singleton vs factory PID decision is justified.
- [ ] Metatype metadata exists.
- [ ] Config keys have clear names and types.
- [ ] Defaults are explicit and safe.
- [ ] Required values are documented.

### Lifecycle

- [ ] Configuration policy is deliberate.
- [ ] Missing config behavior is defined.
- [ ] Config deletion behavior is defined.
- [ ] `@Modified` is used only if safe.
- [ ] Resource recreation is handled.
- [ ] Deactivation closes resources.

### Thread Safety

- [ ] Runtime config is immutable or atomically updated.
- [ ] No partial mutable update is visible to concurrent calls.
- [ ] Long-running operations define config snapshot behavior.

### Validation

- [ ] Type validation exists.
- [ ] Semantic validation exists.
- [ ] External dependency validation strategy exists.
- [ ] Invalid update behavior is defined.

### Security

- [ ] Secrets are references, not raw values.
- [ ] Logs mask sensitive values.
- [ ] Admin access is controlled.
- [ ] Audit records avoid secret leakage.

### Observability

- [ ] Config presence/status visible.
- [ ] Applied config hash visible.
- [ ] Last apply failure visible.
- [ ] Health distinguishes config vs dependency failure.

### Operations

- [ ] Sample config exists.
- [ ] Rollback procedure exists.
- [ ] Drift detection strategy exists.
- [ ] Config deployment order is known.
- [ ] Cluster consistency model is defined.

### Compatibility

- [ ] Schema evolution plan exists.
- [ ] Old config compatibility considered.
- [ ] Java 8–25 compatibility considered.
- [ ] Bundle rollback + config rollback compatibility considered.

---

## 61. Key Takeaways

Configuration Admin is not a properties parser.

It is a dynamic runtime configuration delivery system.

Metatype is not decoration.

It is schema and tooling metadata for configuration contracts.

Declarative Services makes configuration practical, but it does not remove the need to reason about lifecycle, validation, concurrency, and operations.

The most important mental models:

```text
PID is runtime identity.
Factory PID means runtime cardinality.
Configuration update is runtime topology mutation.
Metatype is configuration schema.
@Modified requires atomic invariants.
Secrets are references, not ordinary config.
Config schema evolves like API.
Config changes must be observable and auditable.
```

A top-tier OSGi engineer does not ask only:

```text
How do I read this property?
```

They ask:

```text
What runtime entity owns this configuration?
What lifecycle does it control?
Can it change safely while traffic is running?
How is it validated, audited, rolled back, and observed?
What happens when it is missing, invalid, deleted, or partially applied?
```

That is the difference between configuration as a convenience and configuration as a production-grade runtime contract.

---

## 62. How This Part Connects to the Next Parts

Part 10 completes the first major service-runtime foundation:

- Part 7 introduced the service registry.
- Part 8 introduced Declarative Services.
- Part 9 introduced advanced dynamic DS patterns.
- Part 10 introduced runtime configuration and Metatype.

Next, Part 11 moves into bnd and Bndtools.

That is where we connect the conceptual model to build-time intelligence:

- generating manifests,
- generating DS XML,
- generating Metatype XML,
- managing imports/exports,
- running OSGi runtimes locally,
- resolver testing,
- baseline checking,
- and producing reproducible bundles.

Configuration becomes much safer when build tooling generates and validates the metadata instead of relying on manually maintained runtime files.

---

## References

- OSGi Compendium Release 8 — Configuration Admin Service Specification: https://docs.osgi.org/specification/osgi.cmpn/8.0.0/service.cm.html
- OSGi Compendium Release 7 — Metatype Service Specification: https://docs.osgi.org/specification/osgi.cmpn/7.0.0/service.metatype.html
- OSGi Compendium Release 8 — Declarative Services Specification: https://docs.osgi.org/specification/osgi.cmpn/8.0.0/service.component.html
- Apache Felix FileInstall documentation: https://felix.apache.org/documentation/subprojects/apache-felix-file-install.html
- Bndtools Declarative Services and Metatype documentation: https://bndtools.org/doc/217-ds.html
