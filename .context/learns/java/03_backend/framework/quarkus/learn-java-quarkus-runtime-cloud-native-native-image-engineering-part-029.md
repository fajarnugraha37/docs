# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-029
# Native Image II: Making Real Applications Native-Compatible

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `029`  
> Topik: Native Image II: Making Real Applications Native-Compatible  
> Status: Materi lanjutan advance — lanjutan langsung dari Part 028  
> Target: Software engineer yang mampu memigrasikan aplikasi Quarkus nyata ke native image secara sistematis, bukan trial-error native flags

---

## 0. Ringkasan Besar

Part 028 membahas fondasi:

- GraalVM/Mandrel,
- closed-world assumption,
- AOT,
- static initialization,
- runtime initialization,
- image heap,
- reflection/resource/proxy constraints.

Part 029 membahas praktik nyata:

```text
Bagaimana membuat aplikasi Quarkus real-world native-compatible?
```

Aplikasi nyata biasanya punya:

- REST API,
- Jackson/JSON-B serialization,
- Hibernate ORM,
- JDBC,
- REST client,
- TLS/SSL,
- OIDC/JWT,
- Redis,
- Kafka/RabbitMQ,
- templates,
- resources,
- validation,
- reflection-heavy libraries,
- scheduled jobs,
- observability,
- container image,
- CI/CD,
- performance baseline.

Native image compatibility bukan satu flag.

Native compatibility adalah disiplin engineering:

```text
1. Inventory dynamic behavior.
2. Prefer Quarkus extensions.
3. Make DTO/resource/reflection explicit.
4. Avoid runtime classpath scanning.
5. Avoid static runtime state.
6. Test native early.
7. Debug by failure category.
8. Compare JVM vs native with evidence.
9. Document build/runtime constraints.
```

---

## 1. Mental Model: Native Compatibility Is a Boundary Inventory

Aplikasi gagal native biasanya bukan karena “Quarkus tidak support native”.

Sering penyebabnya:

```text
Ada bagian aplikasi/library yang bergantung pada runtime dynamic behavior
yang tidak terlihat saat native-image build.
```

Maka langkah pertama bukan menambahkan flag.

Langkah pertama adalah membuat **dynamic behavior inventory**.

Daftar yang harus dicari:

1. Reflection.
2. Dynamic classloading.
3. Dynamic proxies.
4. ServiceLoader.
5. Resources/templates/certs.
6. Serialization/deserialization.
7. Polymorphism.
8. JNI/native libraries.
9. Static initializers.
10. Environment/secret access.
11. TLS/crypto.
12. Locale/timezone/font.
13. Frameworks without Quarkus extension.
14. Runtime plugin architecture.
15. Generated classes at runtime.

Native compatibility = membuat semua hal ini eksplisit atau menghilangkannya.

---

## 2. Native Compatibility Workflow

Gunakan workflow ini untuk aplikasi nyata:

```text
1. Build JVM and run full tests.
2. Build native without hacks.
3. Classify build/runtime failures.
4. Fix source design first.
5. Add reflection/resource/proxy config only where needed.
6. Prefer Quarkus extensions over manual config.
7. Run native smoke tests.
8. Run critical native integration tests.
9. Measure JVM vs native.
10. Create production checklist.
```

Jangan langsung:

```text
copy-paste random native-image flags from internet
```

Karena itu sering membuat binary membesar, menyembunyikan bug, atau membuat masalah baru.

---

## 3. Build Native: Baseline Command

Maven:

```bash
./mvnw package -Dnative
```

Container build:

```bash
./mvnw package -Dnative -Dquarkus.native.container-build=true
```

Gradle concept:

```bash
./gradlew build -Dquarkus.native.enabled=true
```

Native executable output biasanya:

```text
target/*-runner
```

Run:

```bash
./target/*-runner
```

Container build berguna jika:

- local machine tidak punya GraalVM/Mandrel,
- ingin builder environment konsisten,
- CI pakai Linux container,
- target production Linux.

Quarkus building native guide menjelaskan bahwa native executable memerlukan GraalVM distribution, dan Mandrel adalah downstream distribution dari GraalVM CE yang tujuannya menyediakan native executables yang dirancang untuk mendukung Quarkus.

---

## 4. Use Quarkus Extensions First

Quarkus extensions membawa native metadata.

Contoh:

| Need | Prefer |
|---|---|
| REST JSON | `quarkus-rest-jackson` / JSON-B extension |
| Hibernate ORM | `quarkus-hibernate-orm` |
| JDBC datasource | Quarkus JDBC extension |
| Redis | `quarkus-redis-client` |
| Kafka | `quarkus-messaging-kafka` |
| RabbitMQ/AMQP | Quarkus messaging connectors |
| OIDC | `quarkus-oidc` |
| REST Client | `quarkus-rest-client-*` |
| Validation | `quarkus-hibernate-validator` |
| Health | `quarkus-smallrye-health` |
| Metrics | `quarkus-micrometer` / OTel |
| OpenTelemetry | `quarkus-opentelemetry` |

Why?

Because extensions can:

- scan at build time,
- generate metadata,
- register reflection,
- register resources,
- register proxies,
- configure runtime init,
- adapt framework behavior for native.

If library has no Quarkus extension, you own native compatibility.

---

## 5. Reflection Compatibility

### 5.1 Symptoms

Reflection issue can show as:

```text
NoSuchMethodException
NoSuchFieldException
IllegalAccessException
ClassNotFoundException
Cannot construct instance
Jackson cannot deserialize
Hibernate/validator metadata missing
```

### 5.2 Prefer Avoiding Reflection

Bad:

```java
Class<?> clazz = Class.forName(typeName);
Object instance = clazz.getDeclaredConstructor().newInstance();
```

Better:

```java
Map<String, Function<JsonNode, Command>> registry = Map.of(
    "SUBMIT", SubmitCommand::fromJson,
    "APPROVE", ApproveCommand::fromJson
);
```

Native-friendly:

```text
Types are explicit.
No runtime classloading.
No unknown reflection.
```

### 5.3 `@RegisterForReflection`

If reflection needed:

```java
import io.quarkus.runtime.annotations.RegisterForReflection;

@RegisterForReflection
public class PartnerResponseDto {
    public String code;
    public String message;
}
```

Use for:

- DTO used by external reflection library,
- class constructed reflectively outside Quarkus awareness,
- legacy library requirement.

Do not annotate everything blindly.

### 5.4 Register Multiple Classes

```java
@RegisterForReflection(targets = {
        PartnerResponseDto.class,
        PartnerErrorDto.class
})
public final class NativeReflectionConfiguration {
}
```

This centralizes reflection registration.

### 5.5 Reflection Config JSON

GraalVM native-image supports `reflect-config.json`.

Quarkus native tips warn that relying on GraalVM configuration files means you are responsible for keeping them up to date as GraalVM/Mandrel versions evolve; it also notes Quarkus generates native-image config in `src/main/resources/META-INF/native-image/`, so placement matters.

Use JSON config when:

- third-party library requires standard GraalVM config,
- generated by tracing agent,
- cannot use annotations,
- multi-module support needs external config.

But prefer Quarkus-native registration where possible.

---

## 6. Resource Inclusion

### 6.1 Symptoms

Resource issue:

```text
template not found
config schema missing
font missing
certificate not found
resource stream null
message bundle missing
```

### 6.2 Include Resources

Quarkus native tips say the easiest way to include more resources in native executable is `quarkus.native.resources.includes`, which supports glob patterns.

Example:

```properties
quarkus.native.resources.includes=templates/**,schemas/**,certs/*.pem
```

Exclude if needed:

```properties
quarkus.native.resources.excludes=secrets/**,dev-only/**
```

### 6.3 Resource Checklist

Check:

- email templates,
- report templates,
- SQL scripts,
- JSON schema,
- OpenAPI specs,
- certificates,
- truststores,
- keystores,
- fonts,
- i18n bundles,
- static assets,
- mapping files,
- XML config,
- ServiceLoader files.

### 6.4 Test Resource Existence

```java
@Test
void approvalEmailTemplate_shouldExist() {
    assertNotNull(
            getClass().getResourceAsStream("/templates/approval-email.html")
    );
}
```

Run this in JVM and native.

---

## 7. Serialization Compatibility

Serialization is frequent native failure source.

### 7.1 Jackson/JSON-B

Quarkus REST/Jackson extension handles many DTO cases.

Still risky:

- polymorphic deserialization,
- abstract base classes,
- private constructors,
- reflection-based mapping,
- dynamic modules,
- custom serializers loaded dynamically,
- unknown enum handling,
- JPA entity serialization,
- records with unusual constructors,
- generic type erasure issues.

### 7.2 DTO Rules

Native-friendly DTOs:

- explicit,
- simple,
- public/record constructors supported,
- no lazy JPA proxies,
- no dynamic type names,
- no circular graphs,
- no entity exposure,
- unknown enum handled,
- schema version considered.

### 7.3 Avoid Serializing Entities

Bad:

```java
@GET
public Application getApplication(String id) {
    return entityManager.find(Application.class, id);
}
```

Better:

```java
@GET
public ApplicationDto getApplication(String id) {
    Application app = repository.get(id);
    return ApplicationDto.from(app);
}
```

Why:

- avoids lazy proxy,
- avoids infinite graph,
- avoids reflection surprises,
- stable API contract,
- native-friendly.

### 7.4 Polymorphism

Bad:

```json
{
  "type": "com.acme.SubmitCommand",
  "payload": {...}
}
```

Better:

```json
{
  "type": "SUBMIT",
  "payload": {...}
}
```

Application maps type explicitly.

---

## 8. Dynamic Classloading

Native image generally dislikes runtime dynamic classloading.

Risky patterns:

```java
Class.forName(config.get("handlerClass"))
ServiceLoader.load(Plugin.class)
scanClasspathForAnnotatedClasses()
URLClassLoader pluginLoader
```

Better patterns:

1. Build-time discovery with Quarkus extension.
2. Explicit registry.
3. CDI beans with qualifiers.
4. Enum-to-handler map.
5. Static config of known implementations.
6. Separate process for plugin-heavy architecture.

Example explicit registry:

```java
@ApplicationScoped
public class CommandHandlerRegistry {

    private final Map<String, CommandHandler> handlers;

    public CommandHandlerRegistry(List<CommandHandler> discoveredHandlers) {
        this.handlers = discoveredHandlers.stream()
                .collect(toMap(CommandHandler::type, Function.identity()));
    }

    public CommandHandler get(String type) {
        CommandHandler handler = handlers.get(type);

        if (handler == null) {
            throw new UnknownCommandTypeException(type);
        }

        return handler;
    }
}
```

CDI discovery is build-time known in Quarkus.

---

## 9. Dynamic Proxies

Symptoms:

```text
UnsupportedFeatureException: Proxy class defined by interfaces ... not found
```

If custom dynamic proxy is needed, register proxy interfaces.

Avoid ad-hoc dynamic proxies if Quarkus extension supports the use case.

Use supported clients:

- REST Client,
- CDI,
- messaging,
- OIDC,
- generated clients supported by extensions.

If you must use manual proxies:

- keep interfaces explicit,
- register proxy config,
- test native.

---

## 10. ServiceLoader

ServiceLoader relies on `META-INF/services`.

Native issues:

- provider file not included,
- provider class not reachable,
- provider reflection needed,
- dynamic provider unknown.

Quarkus extensions often convert ServiceLoader usage into build-time metadata.

For custom SPI:

- test provider discovery native,
- include service resource,
- prefer CDI alternative if possible,
- avoid runtime plugin addition.

---

## 11. JDBC and Database Drivers

Quarkus JDBC extensions provide native integration for supported drivers.

Use Quarkus datasource extensions:

```text
quarkus-jdbc-postgresql
quarkus-jdbc-mysql
quarkus-jdbc-mariadb
quarkus-jdbc-oracle
quarkus-jdbc-mssql
```

Native risks:

- driver native support,
- SSL/TLS,
- wallet/truststore,
- timezone,
- locale,
- Oracle-specific native behavior,
- reflection in driver,
- connection pool behavior,
- missing resources.

Test:

- connection acquisition,
- query,
- transaction,
- migration startup if used,
- TLS DB connection if used,
- prepared statement mapping,
- LOB handling if relevant.

### 11.1 Oracle-Specific Caution

Oracle environments often have:

- wallet,
- TNS config,
- thick vs thin driver assumptions,
- timezone files,
- LOB handling,
- RDS-specific settings,
- SSL.

Do not assume native works without targeted tests.

---

## 12. Hibernate ORM Native Compatibility

Quarkus Hibernate ORM extension handles native integration.

Still review:

- entity model,
- reflection-free access,
- lazy loading,
- proxies,
- bytecode enhancement,
- custom user types,
- AttributeConverter,
- JSON/LOB mapping,
- native queries,
- database functions,
- second-level cache,
- validation integration.

Avoid:

- serializing entities,
- dynamic entity class names,
- reflection-based mappers over entities,
- relying on runtime scanning outside Quarkus.

Test native:

- basic CRUD,
- key repository queries,
- lazy loading behavior,
- transaction boundary,
- schema validation/migration,
- LOB read/write if used.

---

## 13. TLS/SSL Native Compatibility

Quarkus has a guide for using SSL with native executables. The guide states native executables do not support SSL out of the box in the same way JVM mode does, so native SSL support needs attention; if not using native, JVM mode SSL generally works without extra manipulation.

Modern Quarkus also has TLS Registry, which centralizes TLS configuration and lets multiple components reference named TLS configurations.

### 13.1 Test TLS Paths

Test in native:

- REST client HTTPS,
- OIDC discovery/JWKS,
- Redis TLS,
- Kafka TLS,
- RabbitMQ TLS,
- DB TLS,
- mTLS client cert,
- custom truststore,
- hostname verification.

### 13.2 Anti-Pattern

Bad:

```properties
trust-all=true
hostname-verification=NONE
```

This may make tests pass but weaken security.

Use proper truststore and TLS configuration.

---

## 14. Crypto and Secure Random

Native issues:

- crypto provider availability,
- SecureRandom initialization,
- native image random seeding,
- FIPS mode,
- unsupported algorithms,
- keystore type,
- key format.

Test:

- JWT signing/verification,
- password hashing,
- HMAC,
- encryption/decryption,
- TLS handshake,
- mTLS,
- keystore/truststore loading,
- signature algorithm.

Avoid static initialization:

```java
static final SecureRandom RANDOM = new SecureRandom();
```

Prefer runtime bean initialization or framework-provided secure random.

---

## 15. Locale, Timezone, Fonts, and Reports

Real enterprise apps often generate:

- PDF,
- Excel,
- email templates,
- localized messages,
- date/time formatting,
- currency formatting.

Native risk:

- locale data missing,
- timezone data missing,
- fonts missing,
- image rendering dependency,
- AWT/headless issue,
- native library dependency,
- resource not included.

Test native report generation.

For fonts:

- include font resources,
- ensure legal/licensing,
- ensure container has required font libs if needed,
- test rendering in target container.

---

## 16. Templates

Template engines may need:

- resource inclusion,
- reflection metadata,
- precompiled templates,
- runtime template lookup,
- file path differences,
- locale/message bundles.

Quarkus-supported template engines are preferable.

Test:

- template exists,
- template renders,
- variables resolved,
- native artifact can load template,
- production container includes resources.

---

## 17. REST Client Native Compatibility

Test native outbound calls:

- path/query serialization,
- headers,
- auth filter,
- correlation propagation,
- response mapping,
- error mapper,
- TLS,
- timeout,
- retry,
- JSON decoding,
- unknown enum.

REST Client interfaces supported by Quarkus are generally native-friendly, but custom providers/filters/serializers may need review.

---

## 18. OIDC/JWT Native Compatibility

Test:

- OIDC discovery,
- JWKS fetch,
- token validation,
- claim mapping,
- role mapping,
- token propagation,
- OIDC client credentials,
- token refresh,
- TLS trust,
- cache behavior.

Native issues often appear in:

- TLS,
- JSON parsing,
- reflection for custom claims,
- resource/config,
- build/runtime config.

---

## 19. Redis/Kafka/RabbitMQ Native Compatibility

Use Quarkus extensions.

Test native:

### Redis

- connect,
- get/set,
- TTL,
- NX/idempotency command,
- JSON serialization,
- TLS if used,
- timeout.

### Kafka

- producer send,
- consumer receive,
- serialization/deserialization,
- schema registry if used,
- TLS/SASL,
- headers/correlation,
- DLQ/retry behavior.

### RabbitMQ/AMQP

- connection,
- publish/consume,
- ack/nack,
- TLS/auth,
- serialization,
- DLQ.

Native image failures in messaging often involve serializers, TLS, resources, and reflection.

---

## 20. Observability Native Compatibility

Do not assume observability works identically.

Test native:

- JSON logs,
- MDC/correlation,
- health endpoints,
- metrics endpoint,
- OpenTelemetry export,
- trace context propagation,
- REST client spans,
- error stack traces,
- logging categories,
- readiness/liveness probes.

Native artifact without observability is difficult to operate.

---

## 21. Native Image Tracing Agent Workflow

Quarkus Native Reference describes integration testing with the tracing agent: Quarkus users can run JVM mode integration tests with the native image tracing agent, using the Mandrel builder container image that contains agent libraries, avoiding local Mandrel/GraalVM installation.

Workflow:

```text
1. Run representative JVM integration tests with tracing agent.
2. Agent observes reflection/resource/proxy/JNI usage.
3. Agent writes config.
4. Review generated config.
5. Minimize config.
6. Add to project.
7. Build native.
8. Run native tests.
```

Important limitation:

```text
Agent only sees paths exercised by tests.
```

Therefore:

- run broad integration tests,
- include error paths,
- include serialization variants,
- include security paths,
- include report/template paths.

Do not blindly trust generated config.

---

## 22. Debugging Native Failure by Symptom

### 22.1 `ClassNotFoundException`

Possible causes:

- dynamic classloading,
- class not reachable,
- ServiceLoader provider missing,
- optional dependency excluded.

Fix:

- avoid dynamic lookup,
- use explicit registry,
- include/register provider,
- use Quarkus extension.

### 22.2 `NoSuchMethodException`

Possible causes:

- reflection constructor missing,
- DTO no default constructor,
- serialization issue.

Fix:

- explicit constructor support,
- reflection registration,
- DTO redesign,
- Jackson/JSON-B config.

### 22.3 Resource Is Null

Possible causes:

- resource not included,
- wrong path,
- case sensitivity,
- resource excluded.

Fix:

```properties
quarkus.native.resources.includes=templates/**,schemas/**
```

### 22.4 SSL Handshake Failure

Possible causes:

- truststore missing,
- TLS not configured,
- hostname mismatch,
- cert not included,
- wrong runtime path,
- crypto provider issue.

Fix:

- TLS registry,
- include truststore,
- configure properly,
- test in target container.

### 22.5 Image Build OOM

Possible causes:

- insufficient memory,
- huge dependency graph,
- overbroad reflection config,
- parallel builds,
- builder resource limit.

Fix:

- increase CI memory,
- reduce unnecessary deps,
- reduce reflection config,
- use container build with adequate resources,
- inspect build logs.

### 22.6 Static Init Error

Possible causes:

- runtime class initialized at build time,
- env/secret read during build,
- socket/random/file opened too early.

Fix:

- move to runtime init,
- remove static initializer,
- use config injection,
- adjust initialization configuration only if understood.

---

## 23. Native Build Tuning

Native build can be slow/heavy.

Tuning areas:

- builder image pinned,
- container build,
- CI runner memory,
- build cache,
- dependency minimization,
- avoid over-registration,
- avoid unused extensions,
- split modules,
- build only on main/nightly if needed.

Quarkus container image guide mentions that if you already have an existing native image and want to build a native container image, `-Dquarkus.native.reuse-existing=true` can avoid rerunning the native image build.

Use this for pipeline optimization when appropriate.

---

## 24. Container Image for Native Executable

Native app container can be smaller than JVM.

Options:

- UBI minimal/micro,
- distroless-like image,
- scratch-like if dependencies allow,
- Quarkus generated container image.

Consider:

- CA certificates,
- timezone data,
- libc compatibility,
- DNS,
- user permissions,
- file paths,
- truststores,
- writable temp dir,
- fonts/resources,
- observability agent sidecars,
- health endpoint port.

Native binary still needs runtime environment.

It is not magic.

---

## 25. Distroless/Scratch Caution

Very small images can break:

- TLS due missing CA certs,
- timezone/locales,
- DNS tools for troubleshooting,
- shell absent,
- font/rendering,
- native library dependencies,
- certificate path assumptions.

Use minimal image only after testing.

Production supportability matters.

---

## 26. Build-Time Secret Leakage Prevention

Native build can accidentally embed secrets.

Dangerous:

```java
static final String CLIENT_SECRET = System.getenv("CLIENT_SECRET");
```

Dangerous build pipeline:

```text
native build has production secrets in environment
class static init reads them
binary embeds value
```

Prevention:

- never expose production secrets to build,
- avoid secret reads in static init,
- use runtime config,
- scan binary/logs if needed,
- build in clean environment,
- separate build-time and runtime secret injection.

Rule:

```text
Build environment should not contain runtime production secrets.
```

---

## 27. Native Performance Validation

After compatibility, measure.

Compare JVM vs native:

- startup time,
- time to readiness,
- idle RSS,
- RSS under load,
- CPU,
- throughput,
- p95/p99 latency,
- error rate,
- GC/native memory behavior,
- image size,
- build time,
- deployment complexity.

Decision examples:

```text
Serverless endpoint: native likely wins.
Long-running CPU-heavy service: benchmark carefully.
Memory-constrained many small services: native attractive.
Reflection-heavy legacy app: native may be costly.
```

---

## 28. Native Migration Strategy

### 28.1 Big Bang Migration

Bad for large app.

```text
Turn on native at the end and fix 200 issues.
```

### 28.2 Incremental Migration

Better:

```text
1. Build native early.
2. Fix build-time static init issues.
3. Add native smoke.
4. Add critical REST serialization tests.
5. Add DB/client/TLS tests.
6. Add messaging/cache tests.
7. Add performance baseline.
8. Promote native to release gate.
```

### 28.3 Native Compatibility Budget

Track issues:

```text
reflection config
resource config
library replacement
static init cleanup
native test addition
performance measurement
container image adjustment
```

Make native compatibility visible in backlog.

---

## 29. Real-World Case Study: Regulatory Service

Service:

```text
Quarkus REST API
Hibernate ORM Oracle
OIDC Keycloak
REST Client to external identity/address API
Redis cache
Kafka events
Email templates
Scheduled expiry job
JSON logs/Micrometer/OTel
```

### 29.1 Native Risk Inventory

| Area | Risk |
|---|---|
| Oracle JDBC | driver/TLS/LOB/timezone |
| OIDC | JWKS TLS/claim mapping |
| REST client | TLS/error mapper/serialization |
| Redis | serialization/TLS |
| Kafka | serializers/schema headers |
| Email templates | resource inclusion |
| Scheduled job | startup/config/runtime secrets |
| Hibernate | proxies/entities/native queries |
| Observability | metrics/traces/logging |
| Static utils | env reads/random/time |

### 29.2 Required Native Tests

- `/q/health/ready`,
- submit application happy path,
- validation error response,
- OIDC secured endpoint with test token,
- DB read/write,
- REST client HTTPS mock,
- Redis get/set TTL,
- Kafka produce/consume,
- email template render,
- scheduled job manual trigger,
- metrics endpoint,
- JSON logs smoke.

### 29.3 Decision

Native viable only after:

```text
all critical paths pass native integration
JVM vs native benchmark acceptable
operational observability validated
CI native build stable
```

---

## 30. Real-World Case Study: Missing Template

Symptom:

```text
JVM works.
Native fails sending email:
template approval-email.html not found.
```

Diagnosis:

```text
Resource not included in native executable.
```

Fix:

```properties
quarkus.native.resources.includes=templates/**
```

Test:

```java
@Test
void approvalTemplateExists() {
    assertNotNull(getClass().getResourceAsStream("/templates/approval-email.html"));
}
```

Run:

```bash
./mvnw verify -Dnative
```

Prevention:

```text
Every runtime resource has test.
Native resource include config reviewed.
No file-system-only assumptions.
```

---

## 31. Real-World Case Study: Jackson Polymorphism Failure

Symptom:

```text
Native endpoint fails deserializing event payload subtype.
```

Cause:

```text
Subtype discovered dynamically/reflection not registered.
```

Fix options:

1. Avoid polymorphic dynamic class names.
2. Use explicit type enum and registry.
3. Register subtypes/reflection.
4. Add native test for every event type.
5. Add contract tests for event schema.

Better design:

```json
{
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "payload": { ... }
}
```

Then explicit mapping:

```java
switch (eventType) {
    case "ApplicationSubmitted" -> mapper.toSubmitted(payload);
    case "ApplicationApproved" -> mapper.toApproved(payload);
    default -> throw new UnknownEventTypeException(eventType);
}
```

---

## 32. Real-World Case Study: TLS Works JVM, Fails Native

Symptom:

```text
Native REST client cannot connect to external HTTPS API.
```

Possible causes:

- truststore not included,
- CA cert missing in minimal image,
- TLS not enabled/configured,
- hostname verification,
- mTLS key not mounted,
- wrong path in container,
- native SSL support issue.

Fix process:

```text
1. Verify container has CA certs.
2. Verify truststore path.
3. Use TLS Registry named config.
4. Avoid trust-all.
5. Run native REST client integration test.
6. Test in same base image as production.
```

---

## 33. Native Troubleshooting Checklist

When native fails:

1. Is failure during build or runtime?
2. Is it reflection/resource/proxy/class-init/TLS/JNI/config?
3. Does JVM integration test cover this path?
4. Does tracing agent reveal missing metadata?
5. Is there a Quarkus extension for the library?
6. Is resource included?
7. Is static initializer reading runtime state?
8. Is build using correct Mandrel/GraalVM version?
9. Is target container missing OS assets?
10. Is error hidden by overbroad catch/fallback?
11. Can a minimal reproducer be created?
12. Is native failure specific to container image?

---

## 34. Production Native Migration Checklist

### 34.1 Inventory

- [ ] Dependencies inventoried.
- [ ] Dynamic reflection found.
- [ ] Dynamic classloading found.
- [ ] Resources/templates/certs listed.
- [ ] Native libraries/JNI listed.
- [ ] TLS/crypto paths listed.
- [ ] Serialization polymorphism listed.
- [ ] Static initializers reviewed.

### 34.2 Build

- [ ] GraalVM/Mandrel version aligned.
- [ ] Builder image pinned.
- [ ] Container build works.
- [ ] CI resources sufficient.
- [ ] Build logs archived.
- [ ] Build does not access prod secrets.

### 34.3 Config

- [ ] Build-time vs runtime config documented.
- [ ] Native resource includes configured.
- [ ] Reflection/proxy config minimal.
- [ ] TLS registry configured.
- [ ] Runtime secret injection tested.
- [ ] Environment-specific config validated.

### 34.4 Tests

- [ ] Native smoke test.
- [ ] Native REST serialization test.
- [ ] Native DB test.
- [ ] Native security/OIDC test.
- [ ] Native REST client TLS test.
- [ ] Native cache/messaging test if used.
- [ ] Native template/resource test.
- [ ] Native observability test.

### 34.5 Performance

- [ ] Startup measured.
- [ ] Time to readiness measured.
- [ ] RSS idle/under load measured.
- [ ] CPU measured.
- [ ] p95/p99 latency measured.
- [ ] JVM vs native compared.
- [ ] Scale-out behavior tested.

### 34.6 Operations

- [ ] Container image base validated.
- [ ] CA certs/truststore present.
- [ ] Health probes work.
- [ ] Logs/metrics/traces work.
- [ ] Debug/runbook updated.
- [ ] Rollback to JVM mode possible if needed.
- [ ] On-call knows native-specific failure modes.

---

## 35. Anti-Pattern Umum

### 35.1 Solving Everything with Reflection Config

Reflection config should be minimal and intentional.

### 35.2 Ignoring Resource Files

Templates/certs/schema files disappear in native.

### 35.3 Testing Only Happy Path Native

Error paths often use different DTOs/resources/reflection.

### 35.4 No TLS Native Test

HTTPS works JVM but fails in native/container.

### 35.5 Reading Runtime Config Statically

Can freeze build-time state.

### 35.6 Native Build Uses Production Secrets

Risk of secret embedding.

### 35.7 Unsupported Library Kept Because “Works on JVM”

Native compatibility is separate.

### 35.8 No JVM vs Native Benchmark

Runtime choice based on assumption.

### 35.9 Minimal Container Without CA/Timezone/Fonts

Small image breaks real behavior.

### 35.10 Generated Agent Config Used Blindly

May be incomplete or too broad.

---

## 36. Latihan

### Latihan 1 — Native Compatibility Inventory

Untuk aplikasi:

```text
Quarkus REST + Hibernate ORM + Oracle + Keycloak OIDC + Redis + Kafka + email templates + PDF generation
```

Buat inventory native risk:

- reflection,
- resources,
- TLS,
- drivers,
- serialization,
- static init,
- native libs,
- tests.

### Latihan 2 — Reflection Fix

Code:

```java
Class<?> clazz = Class.forName(command.type());
Object handler = clazz.getConstructor().newInstance();
```

Buat alternatif native-friendly menggunakan CDI registry.

### Latihan 3 — Resource Failure

Native app gagal karena file `schemas/application-submitted-v1.json` tidak ditemukan.

Tentukan:

- property Quarkus,
- test yang ditambah,
- CI validation,
- production checklist.

### Latihan 4 — TLS Native Failure

Native REST client gagal connect ke partner API dengan SSL handshake error.

Buat diagnostic plan:

- truststore,
- CA certs,
- TLS registry,
- container image,
- hostname,
- mTLS,
- native SSL guide.

### Latihan 5 — Native Migration Plan

Aplikasi sudah production di JVM mode.

Buat roadmap 4 minggu untuk native migration:

- week 1 inventory/build,
- week 2 compatibility fixes,
- week 3 native integration/performance,
- week 4 release gate/runbook.

---

## 37. Ringkasan Invariants

Ingat invariants berikut:

```text
Native compatibility starts with dynamic behavior inventory.
Prefer Quarkus extensions over manual GraalVM config.
Reflection must be explicit or eliminated.
Resources must be explicitly included and tested.
Serialization must avoid dynamic object graphs.
Static initializers must not read runtime state.
TLS/crypto must be tested in native and target container.
Tracing agent helps but only covers exercised paths.
Native build success is not runtime correctness.
Native runtime correctness is not performance superiority.
JVM vs native decision must be measured.
Build environment must not contain production secrets.
Minimal container image must still contain required OS assets.
Every critical native path needs a native test.
```

---

## 38. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Building a Native Executable guide.
- Quarkus Native Reference Guide.
- Quarkus Tips for Writing Native Applications.
- Quarkus Using SSL With Native Executables guide.
- Quarkus TLS Registry reference.
- Quarkus Container Images guide.
- Quarkus Writing Extensions guide.
- Quarkus Testing Your Application guide.
- GraalVM Native Image reference.
- Mandrel release notes and Quarkus native compatibility announcements.

---

## 39. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan praktik native compatibility untuk aplikasi nyata.

Bagian berikutnya:

```text
Part 030 — Kubernetes and Container Engineering: Image Build, Probes, ConfigMap, Secret, Service Binding
```

Di part berikutnya, fokus bergeser dari native executable ke runtime deployment:

- container image engineering,
- JVM vs native image packaging,
- Dockerfile vs Jib vs Quarkus container-image extensions,
- Kubernetes manifests,
- liveness/readiness/startup probes,
- ConfigMap,
- Secret,
- ServiceAccount,
- service binding,
- resource requests/limits,
- graceful shutdown,
- pod lifecycle,
- deployment strategy,
- cloud-native production checklist.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-028.md">⬅️ Native Image I: GraalVM/Mandrel Mental Model, Closed-World Assumption, Static Init</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-030.md">Kubernetes and Container Engineering: Image Build, Probes, ConfigMap, Secret, Service Binding ➡️</a>
</div>
