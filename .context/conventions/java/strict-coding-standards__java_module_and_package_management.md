# Strict Coding Standards — Java Module and Package Management

> Status: **Mandatory** for LLM-assisted Java implementation.  
> Scope: Java package structure, JPMS `module-info.java`, build modules, dependency exposure, artifact naming, package boundaries, and migration from classpath to module-path.  
> Applies to: Java 11, 17, 21, 25+ codebases unless a project-specific standard overrides it.

---

## 1. Purpose

This standard prevents LLM code agents from creating structurally weak Java systems through careless package movement, hidden dependencies, dependency cycles, split packages, accidental public APIs, over-exported JPMS modules, transitive dependency leaks, and reflection-based shortcuts.

The goal is not to force every Java project to use JPMS. The goal is to make package/module/dependency boundaries explicit, stable, testable, and reviewable.

---

## 2. Non-Negotiable Rules

1. **Do not move classes across packages without proving the impact.**
   - Imports, serialization names, reflection, persistence, component scanning, dependency injection, and public APIs can break.

2. **Do not introduce new top-level packages casually.**
   - A new package means a new architectural boundary or a new cohesive subdomain.

3. **Do not create cyclic package dependencies.**
   - Cycles must be treated as design defects unless they are test-only fixtures.

4. **Do not create split packages.**
   - The same package must not be spread across multiple JARs/modules.

5. **Do not expose internals through package names, JPMS exports, Maven dependencies, or Gradle `api` dependencies.**

6. **Do not add dependencies to fix compile errors without identifying why the type is needed.**
   - Every new dependency must have a stated owner, scope, and reason.

7. **Do not use `--add-opens`, `--add-exports`, or illegal reflection as a default solution.**
   - These are migration exceptions, not normal architecture.

8. **Do not mix `javax.*` and `jakarta.*` ecosystems in the same module unless the migration strategy explicitly allows it.**

9. **Do not publish unstable internal packages as public API.**
   - Public API must be minimal, documented, and backward-compatible.

10. **Do not use wildcard imports or broad package scanning as a substitute for explicit dependency design.**

---

## 3. Mental Model

Java has multiple boundary levels. Do not confuse them.

| Boundary | Meaning | Example | Review Question |
|---|---|---|---|
| Package | Source-level namespace and cohesion unit | `com.acme.billing.invoice` | Do these classes change for the same reason? |
| JPMS module | Runtime/compile-time readability and encapsulation unit | `com.acme.billing.invoice` | What packages are exported/opened? |
| Build module | Maven/Gradle project/module | `billing-invoice-service` | What artifact is produced? |
| Artifact | Published binary dependency | `billing-invoice-api.jar` | Is this a stable dependency contract? |
| Layer | Architectural dependency direction | `api -> application -> domain -> infrastructure` | Is dependency direction preserved? |
| Bounded context | Business/domain ownership boundary | `licensing`, `enforcement`, `payment` | Who owns this model and its invariants? |

A package name is not just a folder. It is a structural claim about ownership and coupling.

---

## 4. Package Naming Rules

### 4.1 Mandatory Format

Use lowercase reverse-domain package names.

```text
com.<organization>.<system>.<bounded_context>.<layer_or_capability>[.<subcapability>]
```

Examples:

```text
com.acme.enforcement.casework.domain
com.acme.enforcement.casework.application
com.acme.enforcement.casework.infrastructure.persistence
com.acme.enforcement.casework.adapter.http
com.acme.enforcement.casework.adapter.messaging
```

### 4.2 Forbidden Package Names

Forbidden:

```text
com.acme.common
com.acme.util
com.acme.helper
com.acme.misc
com.acme.manager
com.acme.service.impl
com.acme.model
com.acme.dto
com.acme.data
```

Allowed only when qualified by ownership and purpose:

```text
com.acme.enforcement.casework.sharedkernel
com.acme.enforcement.casework.application.util // only if very narrow and justified
com.acme.enforcement.casework.adapter.http.dto
```

### 4.3 Package Name Semantics

Package names must reflect **ownership**, not technical convenience.

Bad:

```text
com.acme.dto
com.acme.entity
com.acme.repository
com.acme.service
```

Better:

```text
com.acme.licensing.application.command
com.acme.licensing.domain.licence
com.acme.licensing.infrastructure.persistence
com.acme.licensing.adapter.rest
```

Technical packages may exist only below a business/capability package.

---

## 5. Layered Package Rules

### 5.1 Default Dependency Direction

For business applications, the default dependency direction is:

```text
adapter -> application -> domain
infrastructure -> application/domain through interfaces where appropriate
```

Forbidden:

```text
domain -> adapter
domain -> infrastructure
domain -> web framework
domain -> persistence framework
domain -> messaging framework
application -> adapter.http
application -> adapter.kafka
```

### 5.2 Recommended Package Layout

```text
com.acme.<system>.<capability>
  domain/
    model/
    policy/
    event/
    exception/
  application/
    command/
    query/
    port/
    service/
  adapter/
    http/
    messaging/
    scheduler/
  infrastructure/
    persistence/
    external/
    config/
```

This is a default, not a dogma. Deviations require a short architecture note.

### 5.3 Package Privacy

Prefer package-private classes for implementation details.

Mandatory:

- Public classes must be part of an intentional API.
- Internal helper classes should be package-private.
- Package-private tests may test package-internal behavior only when that behavior is intentionally package-scoped.

Forbidden:

```java
public final class InternalMapperUtil { ... }
```

Better:

```java
final class InvoiceRowMapper { ... }
```

---

## 6. Public API Package Rules

A package is a public API package only if it is intentionally consumed outside its module/artifact.

Public API packages must have:

1. Stable names.
2. Minimal exported types.
3. No framework leakage unless the API is explicitly framework-specific.
4. Versioning policy.
5. Compatibility tests if used by other modules/services.
6. Clear ownership.

Forbidden in public API packages:

- Persistence entities as API contracts.
- Internal exceptions without stable error contract.
- Framework-specific annotations unless part of the contract.
- Mutable internal collections exposed directly.
- `impl`, `internal`, `util`, `helper` packages exported as API.

---

## 7. Internal Package Rules

Use internal packages for implementation details that must not be consumed directly.

Examples:

```text
com.acme.billing.invoice.internal
com.acme.billing.invoice.infrastructure.persistence.internal
```

Rules:

- Internal packages must not be exported in JPMS.
- Internal packages must not be referenced by other build modules.
- Internal package usage by another module is a review blocker.
- Do not make internals public just because tests need them.

---

## 8. JPMS Adoption Policy

JPMS is recommended when the codebase benefits from explicit module boundaries, custom runtime images, strong encapsulation, or library API governance.

JPMS is not mandatory for all application services. Classpath-based Spring Boot, Quarkus, Jakarta EE, or legacy apps may remain non-modular if the project explicitly chooses that model.

### 8.1 JPMS Is Appropriate When

Use JPMS when:

- Publishing reusable libraries.
- Building platform/runtime components.
- Reducing accidental API surface.
- Creating custom runtime images with `jlink`.
- Enforcing module-level boundaries.
- Avoiding classpath ambiguity.

### 8.2 JPMS May Be Overkill When

Avoid JPMS when:

- The ecosystem/framework relies heavily on runtime classpath scanning and reflection.
- Dependencies are mostly non-modular automatic modules.
- The application is a short-lived internal service with strong build-level boundaries already enforced.
- Migration cost is not justified.

Even without JPMS, package and build-module boundaries remain mandatory.

---

## 9. JPMS Module Naming Rules

Module names must be globally stable and usually match the root package.

Good:

```java
module com.acme.enforcement.casework {
}
```

Bad:

```java
module casework {
}

module app.core {
}

module service1 {
}
```

Rules:

- Use lowercase dot-separated names.
- Prefer reverse-domain ownership.
- Align module name with Maven/Gradle artifact identity where practical.
- Do not use version numbers in module names.
- Do not use generic names such as `core`, `common`, `shared`, `api` without organization/system prefix.

---

## 10. `module-info.java` Rules

### 10.1 Minimal Module Descriptor

A module descriptor must be minimal and intentional.

```java
module com.acme.billing.invoice {
    requires java.base;

    exports com.acme.billing.invoice.api;
}
```

Do not list `requires java.base`; it is implicitly required. The example above only shows the conceptual baseline.

Actual preferred form:

```java
module com.acme.billing.invoice {
    exports com.acme.billing.invoice.api;
}
```

### 10.2 `exports`

Use `exports` only for packages that are stable compile-time API.

Allowed:

```java
exports com.acme.billing.invoice.api;
```

Restricted:

```java
exports com.acme.billing.invoice.internal;
```

Forbidden by default.

### 10.3 Qualified `exports`

Use qualified exports only for controlled friend-module APIs.

```java
exports com.acme.billing.invoice.spi to
    com.acme.billing.invoice.testkit,
    com.acme.billing.invoice.adapter;
```

Rules:

- Must include a comment explaining why the API is not generally public.
- Must not be used to bypass architecture problems.

### 10.4 `opens`

`opens` allows reflective access. It is not the same as `exports`.

Allowed only for:

- Serialization frameworks.
- Dependency injection frameworks.
- Persistence frameworks.
- Test frameworks.

Preferred:

```java
opens com.acme.billing.invoice.adapter.json to com.fasterxml.jackson.databind;
opens com.acme.billing.invoice.infrastructure.persistence to org.hibernate.orm.core;
```

Forbidden by default:

```java
open module com.acme.billing.invoice {
}
```

An `open module` opens all packages reflectively and must not be used as the default solution.

### 10.5 `requires`

Use `requires` for direct compile-time dependencies.

```java
requires java.sql;
requires com.fasterxml.jackson.databind;
```

Rules:

- Every `requires` must correspond to a real direct usage.
- Do not rely on transitive dependency leakage.
- Remove unused `requires` entries.

### 10.6 `requires transitive`

Use `requires transitive` only when the dependency type appears in your exported API.

Allowed:

```java
module com.acme.payment.api {
    requires transitive com.acme.money;
    exports com.acme.payment.api;
}
```

Because exported API might expose `com.acme.money.Money`.

Forbidden:

```java
requires transitive org.slf4j;
requires transitive com.fasterxml.jackson.databind;
```

Unless those types are intentionally part of the exported API.

### 10.7 `requires static`

Use `requires static` only for compile-time optional dependencies.

Examples:

```java
requires static org.jetbrains.annotations;
requires static lombok;
```

Rules:

- Runtime behavior must not require the dependency unless guarded.
- Must be tested without the optional dependency when applicable.

### 10.8 `uses` and `provides`

Use service loading only for actual plugin/SPIs.

```java
uses com.acme.billing.spi.TaxProvider;

provides com.acme.billing.spi.TaxProvider
    with com.acme.billing.tax.DefaultTaxProvider;
```

Rules:

- Service interface must be stable.
- Provider initialization must be lightweight.
- Failures must be explicit and testable.
- Do not use ServiceLoader as hidden dependency injection.

---

## 11. JPMS Examples

### 11.1 Good API Module

```java
module com.acme.casework.api {
    exports com.acme.casework.api.command;
    exports com.acme.casework.api.event;
}
```

### 11.2 Good Implementation Module

```java
module com.acme.casework.application {
    requires com.acme.casework.api;
    requires com.acme.casework.domain;

    exports com.acme.casework.application.port;
}
```

### 11.3 Good Persistence Adapter Module

```java
module com.acme.casework.persistence.jpa {
    requires com.acme.casework.application;
    requires com.acme.casework.domain;
    requires jakarta.persistence;

    opens com.acme.casework.persistence.jpa.entity to org.hibernate.orm.core;
}
```

### 11.4 Bad Module Descriptor

```java
open module com.acme.casework {
    requires transitive spring.context;
    requires transitive com.fasterxml.jackson.databind;
    requires transitive org.hibernate.orm.core;

    exports com.acme.casework;
    exports com.acme.casework.internal;
    exports com.acme.casework.util;
}
```

Problems:

- Everything is open to reflection.
- Implementation packages exported.
- Framework dependencies leaked transitively.
- Root package too broad.
- No stable API boundary.

---

## 12. Split Package Policy

A split package exists when the same package is present in more than one module/JAR.

Forbidden:

```text
billing-api.jar      -> com.acme.billing.model.Invoice
billing-domain.jar   -> com.acme.billing.model.InvoiceStatus
```

Better:

```text
billing-api.jar      -> com.acme.billing.api.InvoiceDto
billing-domain.jar   -> com.acme.billing.domain.invoice.Invoice
```

Rules:

- Do not split packages across Maven/Gradle modules.
- Do not use split packages for test fixtures.
- Do not relocate packages into an existing package owned by another artifact.
- Fix split packages by renaming ownership boundaries, not by suppressing module errors.

---

## 13. Classpath vs Module Path Rules

### 13.1 Classpath Mode

Classpath mode is allowed for many application services.

Rules:

- Still enforce package boundaries.
- Still avoid split packages.
- Still avoid relying on transitive dependencies.
- Still avoid reflective access to JDK internals.

### 13.2 Module Path Mode

Module path mode requires:

- Valid `module-info.java`.
- No split packages.
- Explicit exports/opens.
- No illegal reflective access.
- Compatible dependencies.

### 13.3 Automatic Modules

Automatic modules are allowed only as migration bridge.

Rules:

- Do not design public architecture around automatic module names unless stable.
- Prefer dependencies with explicit module descriptors or stable `Automatic-Module-Name`.
- Track automatic modules in migration notes.
- Do not publish an artifact with accidental automatic module name if it is intended for modular users.

---

## 14. Dependency Management Rules

### 14.1 Dependency Ownership

Every dependency must have:

- Owner module.
- Reason.
- Scope.
- Version source.
- Security review status.
- Replacement/removal condition when temporary.

Example dependency decision note:

```text
Dependency: org.apache.commons:commons-compress
Owner: document-import adapter
Reason: read ZIP/TAR uploads
Scope: implementation
Version: platform BOM
Risk: archive bomb/path traversal mitigated in java_io standard
Removal condition: none
```

### 14.2 Direct vs Transitive Dependencies

If code imports a type from a dependency, declare it directly.

Forbidden:

```java
import com.fasterxml.jackson.databind.ObjectMapper;
```

while relying on a framework starter's transitive dependency without declaring Jackson directly when the module owns Jackson usage.

Rules:

- Direct usage requires direct dependency declaration.
- Transitive dependencies must not become hidden API.
- Do not expose transitive dependency types in public API unless intentionally managed.

### 14.3 Gradle `api` vs `implementation`

Default to `implementation`.

Use `api` only when the dependency type appears in exported/public API.

Bad:

```kotlin
dependencies {
    api("com.fasterxml.jackson.core:jackson-databind")
}
```

Good:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Use `api` only if public method signatures expose Jackson types, which should be rare.

### 14.4 Maven Dependency Scope

Default to compile only when needed at compile and runtime.

Rules:

- Use `test` for test-only dependencies.
- Use `provided` only when runtime/container definitely provides it.
- Use `runtime` only when code does not compile against the dependency but needs it at runtime.
- Avoid optional dependencies unless the optional behavior is explicitly guarded and documented.

### 14.5 BOM and Version Catalog

Mandatory:

- Centralize versions.
- Do not hardcode dependency versions across many modules.
- Use Maven BOM or Gradle version catalog/platform.
- Pin plugin versions.
- Lock dependencies for reproducible builds where required.

Forbidden:

```xml
<dependency>
  <groupId>...</groupId>
  <artifactId>...</artifactId>
  <version>LATEST</version>
</dependency>
```

Forbidden:

```kotlin
implementation("com.example:lib:+")
```

---

## 15. Artifact Naming Rules

Artifact names must reflect deployable/library purpose.

Good:

```text
casework-api
casework-domain
casework-application
casework-persistence-jpa
casework-adapter-rest
casework-service
casework-test-fixtures
```

Bad:

```text
core
common
utils
service
impl
new-module
module2
```

Rules:

- `api` artifact exposes stable DTO/command/event/SPIs.
- `domain` artifact contains framework-free domain logic.
- `application` artifact orchestrates use cases.
- `adapter-*` artifacts integrate with external mechanisms.
- `test-fixtures` artifact must not leak into production dependency scope.

---

## 16. Package Boundary by Architecture Type

### 16.1 Domain Package

Allowed:

- Entities/value objects.
- Domain services.
- Domain events.
- Domain policies.
- Domain exceptions.

Forbidden:

- REST annotations.
- ORM annotations unless the project explicitly chooses active-record/entity-as-persistence model.
- JSON annotations.
- Kafka/RabbitMQ/AWS SDK types.
- Spring/Quarkus/Jakarta DI annotations unless explicitly allowed.

### 16.2 Application Package

Allowed:

- Use case orchestration.
- Commands/queries.
- Ports/interfaces.
- Transaction boundary abstractions.
- Authorization decision calls.

Forbidden:

- HTTP request/response types.
- Database row/result set mapping.
- Messaging record classes.
- Framework-specific endpoint types.

### 16.3 Adapter Package

Allowed:

- HTTP controllers/resources.
- Messaging consumers/producers.
- External API clients.
- Framework DTOs.
- Serialization annotations.

Forbidden:

- Business invariant ownership.
- Direct persistence transaction decisions unless adapter is infrastructure-specific.

### 16.4 Infrastructure Package

Allowed:

- Repositories.
- JDBC/JPA/Hibernate/MyBatis implementations.
- AWS/Redis/Kafka implementation details.
- Configuration and framework wiring.

Forbidden:

- Domain rule decisions hidden inside persistence queries without application/domain ownership.

---

## 17. Package Refactoring Rules

Before moving/renaming a package, the LLM agent must check:

1. Public API compatibility.
2. Serialization/deserialization type names.
3. Jackson/JAXB/JSON-B annotations.
4. JPA entity scanning.
5. Spring/Quarkus component scanning.
6. Reflection usages.
7. Configuration properties references.
8. ServiceLoader provider files.
9. Native image reflection configuration.
10. Test fixture imports.
11. Documentation/API clients.
12. Migration scripts or stored references.

Package moves must include:

- Before/after package map.
- Compile result.
- Test result.
- Search evidence for old package references.
- Compatibility decision.

---

## 18. Component Scanning Rules

Component scanning must be bounded.

Forbidden:

```java
@ComponentScan("com")
```

Forbidden:

```java
@ComponentScan("com.acme")
```

Allowed:

```java
@ComponentScan(basePackages = "com.acme.casework")
```

Better:

```java
@ComponentScan(basePackageClasses = CaseworkApplication.class)
```

Rules:

- Scan only owned packages.
- Do not rely on incidental scanning of neighboring modules.
- Test configuration must not accidentally scan production external adapters unless intended.

---

## 19. Reflection and Encapsulation Rules

Reflection must not define architecture.

Forbidden by default:

- `setAccessible(true)` against JDK internals.
- `--add-opens` as a permanent production flag.
- Package-private access bypassed by reflection.
- Reflective discovery of arbitrary packages from user input.

Allowed with justification:

- Framework integration.
- Serialization/deserialization.
- Dependency injection.
- Test utilities.
- Migration bridge with removal plan.

Every reflection exception must document:

```text
Package opened:
Target module/framework:
Reason:
Scope:
Removal plan:
Test coverage:
```

---

## 20. Service Provider Interface Rules

Use SPI only when extensions are genuinely runtime-pluggable.

Package layout:

```text
com.acme.payment.spi
com.acme.payment.internal.defaultprovider
```

Rules:

- SPI interfaces must be stable.
- Provider implementations must not leak internal dependencies into SPI.
- SPI discovery errors must be explicit.
- Multiple providers must have deterministic selection rules.
- Do not use SPI to avoid normal dependency injection.

---

## 21. Multi-Module Build Rules

### 21.1 Allowed Module Split

Split modules by:

- Stable API boundary.
- Independent lifecycle.
- Different deployment artifact.
- Different framework/runtime dependency.
- Different ownership/team.
- Different security/compliance boundary.

Do not split modules just because a package is “large”.

### 21.2 Forbidden Module Split

Forbidden:

- One class per module.
- Technical split with constant cross-module chatter.
- Cyclic module dependencies.
- Extracting `common` as a dumping ground.
- Creating shared libraries for code that has no stable contract.

### 21.3 Dependency Direction Example

Allowed:

```text
casework-service
  -> casework-adapter-rest
  -> casework-application
  -> casework-domain
  -> casework-api

casework-persistence-jpa
  -> casework-application
  -> casework-domain
```

Forbidden:

```text
casework-domain -> casework-persistence-jpa
casework-domain -> casework-adapter-rest
casework-application -> casework-adapter-rest
```

---

## 22. Shared Code Rules

Shared code is dangerous because it creates hidden coupling.

A shared module is allowed only if it is:

- Stable.
- Small.
- Owned.
- Versioned.
- Documented.
- Not business-context-specific unless it is a shared kernel.

Forbidden shared modules:

```text
common-utils
shared-stuff
platform-common
core-common
```

Allowed shared modules:

```text
acme-money
acme-error-contract
acme-test-fixtures
acme-observability-api
acme-security-context-api
```

Shared modules must not depend on application modules.

---

## 23. Test Package Rules

Test packages should mirror production package when testing package-private behavior.

Example:

```text
src/main/java/com/acme/casework/domain/CaseState.java
src/test/java/com/acme/casework/domain/CaseStateTest.java
```

Rules:

- Test-only helpers go under `src/test/java` or dedicated `test-fixtures` module.
- Test fixtures must not be included in production artifacts.
- Do not make production classes public only for tests.
- Do not put test fixtures under production `util` packages.

---

## 24. Dependency Cycle Policy

Package/module cycles are forbidden by default.

Examples of cycles:

```text
application -> infrastructure -> application
api -> domain -> api
adapter.http -> application -> adapter.http
```

Resolution strategies:

1. Extract interface/port to the owning direction.
2. Move shared value object to stable API/shared-kernel.
3. Split command/event contract from implementation.
4. Invert dependency through application port.
5. Merge packages/modules if the split was artificial.

Do not resolve cycles by creating `common` unless the shared concept is stable and truly independent.

---

## 25. Dependency Graph Review

Every non-trivial module change must include dependency graph evidence.

Allowed tools:

- `jdeps`
- Maven dependency tree
- Gradle dependencies/dependency insight
- ArchUnit
- jQAssistant
- custom static analysis

Minimum review evidence:

```text
Added dependencies:
Removed dependencies:
New transitive dependencies:
New exports/opens:
New cycles:
Split packages detected:
Reflection/module flags added:
```

---

## 26. `jdeps` Usage Rules

Use `jdeps` for JPMS migration and dependency visibility.

Examples:

```bash
jdeps --multi-release 21 --summary build/libs/app.jar
jdeps --multi-release 21 --recursive build/libs/app.jar
jdeps --multi-release 21 --generate-module-info target/modules target/*.jar
```

Rules:

- Use the target Java release matching the project baseline.
- Treat generated `module-info.java` as a starting point, not final architecture.
- Review every generated `requires` and `exports` manually.
- Do not blindly commit generated descriptors.

---

## 27. `jdeprscan` Usage Rules

Use `jdeprscan` during Java baseline upgrades.

Rules:

- Run it for major Java migrations.
- Treat deprecated-for-removal APIs as migration blockers.
- Do not silence warnings without replacement plan.

---

## 28. Versioning and Compatibility Rules

### 28.1 Public API Versioning

If a module/artifact is consumed by other modules or services, it must follow compatibility rules.

Breaking changes:

- Removing public type/method/field.
- Changing package name.
- Changing method signature.
- Changing serialized field name/type.
- Changing exception/error contract.
- Changing required dependency exposed through API.

### 28.2 Internal Versioning

Internal modules may change faster, but still require:

- All downstream compilation.
- Regression tests.
- Migration notes if many call sites are affected.

---

## 29. Shading and Relocation Rules

Shading is restricted.

Allowed only for:

- Avoiding dependency conflicts in published libraries.
- Isolating embedded tools.
- Building standalone CLI artifacts.

Forbidden by default:

- Shading to hide vulnerable dependency usage.
- Shading without relocation.
- Shading application framework dependencies.
- Shading libraries with service descriptors without merge strategy.

Mandatory when shading:

- Relocation rules.
- License review.
- Service file merge review.
- Security scanning strategy.
- Reproducible build output.

---

## 30. Package and Module Security Rules

Security-sensitive packages must be explicit.

Examples:

```text
com.acme.security.authentication
com.acme.security.authorization
com.acme.security.crypto
com.acme.audit
```

Rules:

- Security code must not be hidden in generic utilities.
- Authorization policy packages must not depend on web controllers.
- Crypto packages must not depend on business services.
- Internal security helpers must not be exported as public API.
- Do not expose secret-handling classes through DTO/API packages.

---

## 31. Serialization Boundary Rules

Package names can become serialized identity accidentally.

Before package refactor, check:

- Java native serialization.
- Jackson default typing or class-name polymorphism.
- Kryo/FST/custom binary serialization.
- JPA entity names if defaulted from class name.
- Kafka/RabbitMQ event type names.
- JSON/XML schema references.
- Audit logs containing class names.

Rule:

- Do not use Java package/class names as wire contracts unless explicitly versioned.

---

## 32. Framework-Specific Package Rules

### 32.1 Spring

- Keep application root package narrow.
- Do not put unrelated modules under the same scan root.
- Avoid package-private framework beans unless lifecycle is clear.
- Do not depend on component scan side effects across modules.

### 32.2 Quarkus

- Keep CDI beans under indexed/application packages.
- Avoid reflection-heavy package structures.
- Ensure native-image reflection needs are explicit.

### 32.3 JPA/Hibernate/EclipseLink

- Entity packages must be clearly separated.
- Do not scan all domain packages as entities unless entity-as-domain is intentional.
- Package move of entity classes requires migration review.

### 32.4 Jackson/JAXB/JSON-B

- DTO packages must be separated from domain packages.
- Polymorphic serialization must not rely on arbitrary class/package names.

---

## 33. Native Image and AOT Rules

For GraalVM/Quarkus/Spring AOT/native image:

- Reflection needs must be explicit.
- Resource inclusion must be explicit.
- ServiceLoader usage must be tested in native mode.
- Package scanning assumptions must be validated.
- Do not add broad reflection config for entire root packages.

Forbidden:

```json
{
  "name": "com.acme",
  "allDeclaredFields": true,
  "allDeclaredMethods": true
}
```

Allowed only if narrowly scoped and justified:

```json
{
  "name": "com.acme.casework.adapter.json.CaseCreatedDto",
  "allDeclaredConstructors": true,
  "allDeclaredFields": true
}
```

---

## 34. LLM Dependency Addition Protocol

Before adding any dependency, the LLM must answer:

```text
1. What problem requires a new dependency?
2. Is the functionality available in the JDK or existing dependencies?
3. Is this a direct compile dependency, runtime dependency, test dependency, or plugin?
4. Does it expose types in public API?
5. Does it add transitive dependencies?
6. Does it conflict with existing BOM/platform versions?
7. Does it introduce security/licensing risk?
8. Does it work with the project Java baseline?
9. Does it work with JPMS/native image if applicable?
10. What tests prove the integration?
```

If these cannot be answered, do not add the dependency.

---

## 35. LLM Package Creation Protocol

Before creating a package, the LLM must answer:

```text
1. What capability/layer owns this package?
2. What classes belong here and why?
3. What packages may depend on it?
4. What packages may it depend on?
5. Is it public API or internal?
6. Does the name reflect business ownership or technical convenience?
7. Could this create a cycle?
8. Could this duplicate an existing package?
9. Is there a better existing package?
10. Does this package need module export/open rules?
```

---

## 36. LLM Class Move Protocol

Before moving a class across packages, the LLM must produce:

```text
Class moved:
Old package:
New package:
Reason:
Affected imports:
Affected reflection/config scanning:
Affected serialization/API contract:
Affected persistence/entity name:
Affected tests:
Compatibility risk:
Rollback plan:
```

Do not move classes as part of unrelated edits.

---

## 37. Module Migration Protocol

When migrating to JPMS:

1. Inventory dependencies.
2. Detect split packages.
3. Run `jdeps`.
4. Identify automatic modules.
5. Define API packages.
6. Define internal packages.
7. Add minimal `module-info.java`.
8. Compile on module path.
9. Fix reflection with targeted `opens`.
10. Remove illegal reflective access flags.
11. Run full tests.
12. Document migration exceptions.

Do not attempt JPMS migration and business feature implementation in the same change unless explicitly requested.

---

## 38. Anti-Patterns

### 38.1 `common` Dumping Ground

Bad:

```text
com.acme.common.StringUtil
com.acme.common.DateUtil
com.acme.common.EntityMapper
```

Better:

```text
com.acme.time.BusinessClock
com.acme.casework.adapter.http.CaseResponseMapper
com.acme.money.MoneyFormatter
```

### 38.2 Package by Technical Type Only

Bad:

```text
controller/
service/
repository/
dto/
entity/
```

Better:

```text
casework/adapter/http/
casework/application/
casework/infrastructure/persistence/
casework/domain/
```

### 38.3 Leaky API Module

Bad:

```java
public interface CaseApi {
    org.hibernate.Session session();
    com.fasterxml.jackson.databind.JsonNode payload();
}
```

### 38.4 Accidental Transitive Dependency API

Bad:

```java
public record ApiResponse(JsonNode body) {}
```

Unless Jackson is intentionally part of the API contract.

### 38.5 Reflection as Boundary Bypass

Bad:

```java
field.setAccessible(true);
```

because a package/class boundary was inconvenient.

### 38.6 Over-Modularization

Bad:

```text
user-name-value-object.jar
user-email-value-object.jar
user-validation-service.jar
```

Modules must reduce complexity, not create deployment/build friction.

---

## 39. Required Architecture Tests

For serious codebases, use architecture tests.

Minimum ArchUnit-style rules:

```text
Domain must not depend on adapter packages.
Domain must not depend on infrastructure packages.
Application must not depend on adapter packages.
Adapter packages must not be depended on by domain/application.
No package cycles.
Internal packages must not be accessed from outside owner package/module.
DTO packages must not be used as domain model.
Entity packages must not be returned by REST controllers.
```

---

## 40. Reviewer Checklist

A change touching package/module/dependency management is blocked unless the reviewer can answer yes:

### Package Structure

- [ ] Are new package names lowercase and ownership-based?
- [ ] Are package names business/capability-oriented rather than generic technical dumping grounds?
- [ ] Are internal packages protected from external use?
- [ ] Are package cycles avoided?
- [ ] Are split packages avoided?
- [ ] Are public API packages minimal?

### JPMS

- [ ] Is `module-info.java` minimal?
- [ ] Are `exports` limited to stable API packages?
- [ ] Are `opens` targeted to specific frameworks/modules?
- [ ] Is `requires transitive` used only for API-exposed dependency types?
- [ ] Are automatic modules documented if used?
- [ ] Are `--add-opens`/`--add-exports` absent or temporary with removal plan?

### Dependencies

- [ ] Is each new dependency direct and justified?
- [ ] Is dependency scope correct?
- [ ] Are versions controlled centrally?
- [ ] Are transitive dependencies reviewed?
- [ ] Are vulnerable/abandoned dependencies avoided?
- [ ] Is `api`/`implementation` or Maven scope correct?

### Architecture

- [ ] Does dependency direction follow architecture rules?
- [ ] Are domain packages free of framework dependencies unless intentional?
- [ ] Are DTO/entity/domain types separated?
- [ ] Are shared modules stable and not dumping grounds?

### Refactoring Safety

- [ ] Are package moves documented?
- [ ] Are reflection/scanning/config references updated?
- [ ] Are serialization/persistence/API compatibility risks checked?
- [ ] Are tests and dependency analysis run?

---

## 41. Prompt Contract for LLM Code Agents

Use this instruction when asking an LLM to modify Java code:

```text
Follow strict-coding-standards__java_module_and_package_management.md.

Before adding, moving, renaming, exporting, opening, or depending on any package/module/artifact:
1. Identify the owner capability/layer.
2. Preserve architecture dependency direction.
3. Avoid split packages and cycles.
4. Do not add dependencies without direct usage and scope justification.
5. Use implementation/internal scope by default; expose API only when required.
6. If JPMS is used, keep module-info minimal and targeted.
7. Do not use --add-opens, --add-exports, or reflection hacks unless explicitly approved.
8. Do not create generic common/util/helper packages.
9. Do not mix javax and jakarta namespaces without migration approval.
10. Provide a short impact note for any package move or dependency addition.
```

---

## 42. Source Anchors

This standard is based on the following primary/authoritative references and ecosystem rules:

- Java module learning path: `https://dev.java/learn/modules/`
- Java module descriptor/package APIs: `https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/module/package-summary.html`
- OpenJDK JEP 261, Module System: `https://openjdk.org/jeps/261`
- OpenJDK JEP 200, Modular JDK: `https://openjdk.org/jeps/200`
- OpenJDK JEP 396, Strongly Encapsulate JDK Internals by Default: `https://openjdk.org/jeps/396`
- Oracle package naming tutorial: `https://docs.oracle.com/javase/tutorial/java/package/namingpkgs.html`
- Oracle Java Code Conventions naming conventions: `https://www.oracle.com/java/technologies/javase/codeconventions-namingconventions.html`
- Oracle `jdeps` documentation: `https://docs.oracle.com/en/java/javase/11/tools/jdeps.html`
- Oracle migration guide for JDK 8 to later releases: `https://docs.oracle.com/en/java/javase/17/migrate/migrating-jdk-8-later-jdk-releases.html`

---

## 43. Final Rule

A package/module/dependency change is not a mechanical edit. It is an architecture change.  
If the LLM cannot explain the ownership, dependency direction, compatibility impact, and test evidence, it must not make the change.
