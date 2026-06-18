# learn-jaxrs-advanced-part-038.md

# Bagian 038 — Migration: `javax.ws.rs` to `jakarta.ws.rs`: Namespace Shift, Dependency Alignment, Runtime Upgrade, OpenRewrite, Eclipse Transformer, CDI/Servlet/Validation/Persistence Ecosystem, Testing Strategy, and Migration Failure Modes

> Target pembaca: Java/Jakarta engineer yang ingin memigrasikan aplikasi REST dari **Java EE/Jakarta EE 8 era `javax.ws.rs`** ke **Jakarta EE 9+ / Jakarta REST `jakarta.ws.rs`** secara aman. Fokus bagian ini bukan hanya search-replace import, tetapi **ecosystem migration**: dependencies, app server, Servlet/CDI/Validation/Persistence namespace, JSON provider, JAX-RS implementation, tests, generated code, XML config, bytecode transformation, OpenRewrite, Eclipse Transformer, CI, rollback, dan contract validation.
>
> Namespace lama: `javax.ws.rs.*`  
> Namespace baru: `jakarta.ws.rs.*`
>
> Prinsip paling penting:
>
> ```text
> javax → jakarta migration is not only package rename.
> It is a full stack compatibility migration.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Namespace Migration adalah Ecosystem Migration](#2-mental-model-namespace-migration-adalah-ecosystem-migration)
3. [Sejarah Singkat: Java EE → Jakarta EE](#3-sejarah-singkat-java-ee--jakarta-ee)
4. [Jakarta EE 8 vs Jakarta EE 9+](#4-jakarta-ee-8-vs-jakarta-ee-9)
5. [`javax.ws.rs` vs `jakarta.ws.rs`](#5-javaxwsrs-vs-jakartawsrs)
6. [Apa yang Berubah di Jakarta REST 4.0](#6-apa-yang-berubah-di-jakarta-rest-40)
7. [Migration Scope Inventory](#7-migration-scope-inventory)
8. [Dependency Alignment](#8-dependency-alignment)
9. [Runtime/App Server Alignment](#9-runtimeapp-server-alignment)
10. [JAX-RS Implementation Alignment](#10-jax-rs-implementation-alignment)
11. [CDI/Servlet/Validation/Persistence Namespace Alignment](#11-cdiservletvalidationpersistence-namespace-alignment)
12. [JSON Provider Alignment](#12-json-provider-alignment)
13. [Build Tooling Alignment](#13-build-tooling-alignment)
14. [Source Code Migration](#14-source-code-migration)
15. [Imports That Must Change](#15-imports-that-must-change)
16. [Imports That Must NOT Change](#16-imports-that-must-not-change)
17. [Annotation and API Mapping](#17-annotation-and-api-mapping)
18. [Maven Migration](#18-maven-migration)
19. [Gradle Migration](#19-gradle-migration)
20. [OpenRewrite Migration](#20-openrewrite-migration)
21. [Eclipse Transformer Migration](#21-eclipse-transformer-migration)
22. [IDE-Assisted Migration](#22-ide-assisted-migration)
23. [Generated Code Migration](#23-generated-code-migration)
24. [XML/YAML/Properties Migration](#24-xyml-yamlproperties-migration)
25. [Reflection/String Literal Migration](#25-reflectionstring-literal-migration)
26. [ServiceLoader and META-INF/services Migration](#26-serviceloader-and-meta-infservices-migration)
27. [Tests Migration](#27-tests-migration)
28. [Client Code Migration](#28-client-code-migration)
29. [Provider/Filter/Mapper Migration](#29-providerfiltermapper-migration)
30. [EntityPart, Multipart, JAXB Removal, and New Jakarta REST 4.0 Considerations](#30-entitypart-multipart-jaxb-removal-and-new-jakarta-rest-40-considerations)
31. [ManagedBean Removal and CDI Migration](#31-managedbean-removal-and-cdi-migration)
32. [Jersey Migration Notes](#32-jersey-migration-notes)
33. [RESTEasy Migration Notes](#33-resteasy-migration-notes)
34. [Apache CXF Migration Notes](#34-apache-cxf-migration-notes)
35. [Open Liberty Migration Notes](#35-open-liberty-migration-notes)
36. [Quarkus Migration Notes](#36-quarkus-migration-notes)
37. [Spring Boot 2 → 3 Context](#37-spring-boot-2--3-context)
38. [Mixed Classpath Failure Mode](#38-mixed-classpath-failure-mode)
39. [Binary Compatibility and Third-Party Libraries](#39-binary-compatibility-and-third-party-libraries)
40. [Adapter/Bridge Strategy](#40-adapterbridge-strategy)
41. [Phased Migration Strategy](#41-phased-migration-strategy)
42. [Big Bang Migration Strategy](#42-big-bang-migration-strategy)
43. [Branching and Release Strategy](#43-branching-and-release-strategy)
44. [Contract Compatibility Strategy](#44-contract-compatibility-strategy)
45. [OpenAPI Diff Strategy](#45-openapi-diff-strategy)
46. [Runtime Integration Test Strategy](#46-runtime-integration-test-strategy)
47. [Performance/Regression Test Strategy](#47-performanceregression-test-strategy)
48. [Observability and Production Rollout](#48-observability-and-production-rollout)
49. [Rollback Strategy](#49-rollback-strategy)
50. [Migration Checklist](#50-migration-checklist)
51. [Common Failure Modes](#51-common-failure-modes)
52. [Best Practices](#52-best-practices)
53. [Anti-Patterns](#53-anti-patterns)
54. [Production Readiness Checklist](#54-production-readiness-checklist)
55. [Latihan](#55-latihan)
56. [Referensi Resmi](#56-referensi-resmi)
57. [Penutup](#57-penutup)

---

# 1. Tujuan Part Ini

Migrasi dari:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

ke:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

terlihat seperti search-replace.

Tetapi real-world migration biasanya melibatkan:

```text
javax.ws.rs-api → jakarta.ws.rs-api
javax.servlet → jakarta.servlet
javax.inject → jakarta.inject
javax.enterprise → jakarta.enterprise
javax.validation → jakarta.validation
javax.persistence → jakarta.persistence
javax.transaction → jakarta.transaction
javax.json → jakarta.json
javax.json.bind → jakarta.json.bind
app server Java EE/Jakarta EE 8 → Jakarta EE 9/10/11 runtime
Jersey/RESTEasy/CXF version upgrade
JSON provider upgrade
test framework upgrade
generated OpenAPI/client/server stubs
XML config references
ServiceLoader entries
third-party libraries
```

Jika hanya import diganti, aplikasi bisa compile tetapi gagal runtime.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami kenapa namespace berubah;
- membuat inventory semua `javax` dependencies;
- membedakan `javax.*` yang harus pindah vs yang tidak;
- memigrasikan `javax.ws.rs` ke `jakarta.ws.rs`;
- menyelaraskan runtime/app server;
- memakai OpenRewrite dan/atau Eclipse Transformer;
- memigrasikan tests, generated code, config, ServiceLoader;
- menghindari mixed-classpath bugs;
- membuat phased migration plan;
- menjalankan contract/integration/regression tests;
- menyiapkan rollout dan rollback.

## 1.2 Prinsip utama

```text
Do not migrate one package.
Migrate one compatible ecosystem.
```

---

# 2. Mental Model: Namespace Migration adalah Ecosystem Migration

Jakarta EE 9 memperkenalkan perubahan namespace besar:

```text
javax.* → jakarta.*
```

untuk spesifikasi Jakarta EE.

Tetapi tidak semua `javax.*` di Java harus berubah.

Contoh yang tetap `javax`:

```java
javax.net.ssl.SSLContext
javax.naming.InitialContext
javax.sql.DataSource
javax.xml.parsers.DocumentBuilder
javax.crypto.Cipher
javax.management.MBeanServer
```

Contoh yang berubah untuk Jakarta EE specs:

```java
javax.ws.rs.*          → jakarta.ws.rs.*
javax.servlet.*        → jakarta.servlet.*
javax.inject.*         → jakarta.inject.*
javax.enterprise.*     → jakarta.enterprise.*
javax.validation.*     → jakarta.validation.*
javax.persistence.*    → jakarta.persistence.*
javax.transaction.*    → jakarta.transaction.*
javax.json.*           → jakarta.json.*
javax.json.bind.*      → jakarta.json.bind.*
```

## 2.1 Why this matters

Blind global search-replace can break Java SE packages.

Bad:

```text
javax.net.ssl → jakarta.net.ssl
```

No such standard package.

## 2.2 Top-tier rule

```text
Use recipe/tooling and dependency analysis, not blind text replacement.
```

---

# 3. Sejarah Singkat: Java EE → Jakarta EE

## 3.1 Java EE 8 / Jakarta EE 8

Masih menggunakan namespace:

```text
javax.*
```

## 3.2 Jakarta EE 9

Memindahkan Jakarta EE specifications ke namespace:

```text
jakarta.*
```

## 3.3 Jakarta EE 10/11

Melanjutkan namespace baru dan menambahkan/meningkatkan spesifikasi.

## 3.4 Impact

Libraries compiled against `javax.ws.rs` are not type-compatible with `jakarta.ws.rs`.

Even if class names look similar:

```text
javax.ws.rs.core.Response
jakarta.ws.rs.core.Response
```

are different types.

## 3.5 Rule

Namespace migration breaks binary compatibility across Jakarta EE APIs.

---

# 4. Jakarta EE 8 vs Jakarta EE 9+

## 4.1 Jakarta EE 8

```text
javax.ws.rs-api
javax.servlet-api
javax.persistence-api
javax.validation-api
```

## 4.2 Jakarta EE 9+

```text
jakarta.ws.rs-api
jakarta.servlet-api
jakarta.persistence-api
jakarta.validation-api
```

## 4.3 Deployment implication

A WAR compiled against `javax.*` generally targets Java EE/Jakarta EE 8 era runtimes.

A WAR compiled against `jakarta.*` targets Jakarta EE 9+ runtimes.

## 4.4 Rule

Your compile-time APIs and runtime APIs must match.

---

# 5. `javax.ws.rs` vs `jakarta.ws.rs`

## 5.1 Old

```xml
<dependency>
  <groupId>javax.ws.rs</groupId>
  <artifactId>javax.ws.rs-api</artifactId>
  <version>2.1.1</version>
</dependency>
```

## 5.2 New

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
</dependency>
```

## 5.3 Code

Old:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

New:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

## 5.4 Rule

Do not have both `javax.ws.rs-api` and `jakarta.ws.rs-api` in one module unless explicitly isolating legacy code.

---

# 6. Apa yang Berubah di Jakarta REST 4.0

Jakarta REST 4.0 is for Jakarta EE 11.

Important release goals include:

- removing JAXB dependency;
- removing ManagedBean support;
- adding TCK tests to fill verification gaps;
- maintaining backward compatibility with earlier releases where possible.

## 6.1 Practical impact

If legacy app relied on implicit JAXB entity binding or ManagedBean support, review carefully.

## 6.2 CDI direction

Modern Jakarta EE expects CDI as component model.

## 6.3 Rule

Migration is not only namespace; also review removed/deprecated programming models.

---

# 7. Migration Scope Inventory

Before changing code, inventory.

## 7.1 Search imports

```bash
grep -R "import javax\." src test
grep -R "javax\.ws\.rs" .
```

## 7.2 Dependency tree

Maven:

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencyInsight --dependency javax.ws.rs
./gradlew dependencyInsight --dependency jakarta.ws.rs
```

## 7.3 Runtime inventory

Document:

- app server/runtime version;
- JAX-RS implementation version;
- Servlet version;
- CDI version;
- JSON provider;
- Validation provider;
- Persistence provider;
- test runtime.

## 7.4 Binary artifacts

Inventory:

- internal jars;
- third-party libs;
- generated clients;
- generated server stubs;
- shaded jars;
- application server shared libs.

## 7.5 Rule

Migration starts with inventory, not code rewrite.

---

# 8. Dependency Alignment

## 8.1 Align all Jakarta EE APIs

Common migrations:

```text
javax.ws.rs-api         → jakarta.ws.rs-api
javax.servlet-api       → jakarta.servlet-api
javax.inject            → jakarta.inject-api
cdi-api                 → jakarta.enterprise.cdi-api
validation-api          → jakarta.validation-api
javax.persistence-api   → jakarta.persistence-api
javax.transaction-api   → jakarta.transaction-api
javax.json-api          → jakarta.json-api
javax.json.bind-api     → jakarta.json.bind-api
```

## 8.2 Provider implementations

Also align implementations:

- Jersey Jakarta version;
- RESTEasy Jakarta version;
- CXF Jakarta version;
- Hibernate ORM Jakarta version;
- Hibernate Validator Jakarta version;
- JSON-B/Yasson Jakarta version;
- Jackson Jakarta providers;
- Servlet container supporting Jakarta Servlet.

## 8.3 Rule

API dependencies and implementation dependencies must be from same namespace generation.

---

# 9. Runtime/App Server Alignment

## 9.1 Legacy runtimes

Java EE/Jakarta EE 8 runtimes expose `javax.*`.

## 9.2 Jakarta EE 9+ runtimes

Expose `jakarta.*`.

## 9.3 Example

If app compiles against `jakarta.ws.rs`, deploying to old Java EE 8 app server fails because runtime provides `javax.ws.rs`.

## 9.4 App server examples

Need align with runtime:

- Jakarta EE 10/11 compatible WildFly;
- Open Liberty features matching Jakarta REST level;
- Payara/GlassFish Jakarta EE versions;
- Tomcat 10+ for `jakarta.servlet`;
- Quarkus/Spring Boot 3+ for Jakarta namespace.

## 9.5 Rule

Upgrade runtime before or together with code migration.

---

# 10. JAX-RS Implementation Alignment

## 10.1 Jersey

Use Jersey versions built for Jakarta namespace.

## 10.2 RESTEasy

Use RESTEasy versions matching Jakarta REST/Jakarta EE target.

## 10.3 CXF

Use CXF Jakarta-compatible versions.

## 10.4 Open Liberty

Enable matching `restfulWS-*` feature.

## 10.5 Quarkus

Use Quarkus REST/RESTEasy extension matching platform version.

## 10.6 Rule

Do not mix Jakarta REST API 4.0 with old implementation compiled for `javax.ws.rs`.

---

# 11. CDI/Servlet/Validation/Persistence Namespace Alignment

REST apps rarely use only JAX-RS.

## 11.1 Servlet

Old:

```java
javax.servlet.http.HttpServletRequest
```

New:

```java
jakarta.servlet.http.HttpServletRequest
```

## 11.2 CDI

Old:

```java
javax.inject.Inject
javax.enterprise.context.ApplicationScoped
```

New:

```java
jakarta.inject.Inject
jakarta.enterprise.context.ApplicationScoped
```

## 11.3 Validation

Old:

```java
javax.validation.Valid
javax.validation.constraints.NotNull
```

New:

```java
jakarta.validation.Valid
jakarta.validation.constraints.NotNull
```

## 11.4 Persistence

Old:

```java
javax.persistence.Entity
```

New:

```java
jakarta.persistence.Entity
```

## 11.5 Rule

Boundary annotations must come from the same ecosystem generation.

---

# 12. JSON Provider Alignment

## 12.1 JSON-B

Old:

```text
javax.json.bind
```

New:

```text
jakarta.json.bind
```

## 12.2 JSON-P

Old:

```text
javax.json
```

New:

```text
jakarta.json
```

## 12.3 Jackson JAX-RS provider

Use Jackson modules that support Jakarta REST namespace.

Examples conceptually:

```text
jackson-jakarta-rs-json-provider
```

instead of older `jackson-jaxrs-json-provider`.

## 12.4 Rule

JSON provider mismatch causes runtime provider-not-found or serialization changes.

---

# 13. Build Tooling Alignment

## 13.1 Maven Compiler

Set Java version appropriate to runtime.

## 13.2 Maven Enforcer

Ban old dependencies.

Example concept:

```xml
<banDependencies>
  <excludes>
    <exclude>javax.ws.rs:javax.ws.rs-api</exclude>
    <exclude>javax.servlet:javax.servlet-api</exclude>
  </excludes>
</banDependencies>
```

## 13.3 Gradle constraints

Use dependency constraints/resolution strategy to avoid old artifacts.

## 13.4 Rule

Prevent `javax` dependencies from returning through transitive dependencies.

---

# 14. Source Code Migration

## 14.1 Direct imports

Replace:

```java
javax.ws.rs.*
javax.ws.rs.core.*
javax.ws.rs.ext.*
javax.ws.rs.container.*
javax.ws.rs.client.*
javax.ws.rs.sse.*
```

with:

```java
jakarta.ws.rs.*
jakarta.ws.rs.core.*
jakarta.ws.rs.ext.*
jakarta.ws.rs.container.*
jakarta.ws.rs.client.*
jakarta.ws.rs.sse.*
```

## 14.2 Fully-qualified names

Search for:

```java
javax.ws.rs.core.Response.status(...)
```

## 14.3 Javadocs/examples

Update documentation.

## 14.4 Rule

Compile is not enough; update docs/tests/examples too.

---

# 15. Imports That Must Change

Typical REST imports:

```text
javax.ws.rs.ApplicationPath
javax.ws.rs.BeanParam
javax.ws.rs.Consumes
javax.ws.rs.CookieParam
javax.ws.rs.DefaultValue
javax.ws.rs.DELETE
javax.ws.rs.Encoded
javax.ws.rs.FormParam
javax.ws.rs.GET
javax.ws.rs.HEAD
javax.ws.rs.HeaderParam
javax.ws.rs.HttpMethod
javax.ws.rs.MatrixParam
javax.ws.rs.NameBinding
javax.ws.rs.OPTIONS
javax.ws.rs.PATCH
javax.ws.rs.Path
javax.ws.rs.PathParam
javax.ws.rs.POST
javax.ws.rs.Produces
javax.ws.rs.PUT
javax.ws.rs.QueryParam
javax.ws.rs.WebApplicationException
javax.ws.rs.ProcessingException
javax.ws.rs.NotFoundException
javax.ws.rs.BadRequestException
```

Core:

```text
javax.ws.rs.core.Application
javax.ws.rs.core.Response
javax.ws.rs.core.MediaType
javax.ws.rs.core.UriInfo
javax.ws.rs.core.HttpHeaders
javax.ws.rs.core.SecurityContext
javax.ws.rs.core.Request
javax.ws.rs.core.Context
javax.ws.rs.core.EntityTag
javax.ws.rs.core.CacheControl
javax.ws.rs.core.Link
javax.ws.rs.core.GenericEntity
javax.ws.rs.core.GenericType
```

Provider/container/client:

```text
javax.ws.rs.ext.*
javax.ws.rs.container.*
javax.ws.rs.client.*
javax.ws.rs.sse.*
```

## 15.1 Rule

REST API code should have zero `javax.ws.rs` imports after migration.

---

# 16. Imports That Must NOT Change

Do not blindly change Java SE `javax` packages.

Examples that remain:

```java
javax.net.ssl.SSLContext
javax.naming.InitialContext
javax.sql.DataSource
javax.xml.parsers.DocumentBuilderFactory
javax.crypto.Mac
javax.management.MBeanServer
javax.security.auth.Subject
```

## 16.1 Rule

Use curated migration recipes, not naive global replacement.

---

# 17. Annotation and API Mapping

Most JAX-RS annotations map directly:

```text
javax.ws.rs.Path          → jakarta.ws.rs.Path
javax.ws.rs.GET           → jakarta.ws.rs.GET
javax.ws.rs.Produces      → jakarta.ws.rs.Produces
javax.ws.rs.core.Response → jakarta.ws.rs.core.Response
```

## 17.1 Behavior

The annotation names and concepts are mostly the same.

## 17.2 But runtime changes

Even if source maps directly, runtime/provider behavior can differ due to implementation upgrade.

## 17.3 Rule

Treat source migration as first step; runtime validation is mandatory.

---

# 18. Maven Migration

## 18.1 Before

```xml
<dependency>
  <groupId>javax.ws.rs</groupId>
  <artifactId>javax.ws.rs-api</artifactId>
  <version>2.1.1</version>
  <scope>provided</scope>
</dependency>
```

## 18.2 After

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

or use platform BOM.

## 18.3 BOM

Prefer Jakarta EE/runtime BOM when available.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Version depends target platform.

## 18.4 Rule

Use BOM/platform-managed versions to avoid incompatible mix.

---

# 19. Gradle Migration

## 19.1 Before

```kotlin
compileOnly("javax.ws.rs:javax.ws.rs-api:2.1.1")
```

## 19.2 After

```kotlin
compileOnly("jakarta.ws.rs:jakarta.ws.rs-api:4.0.0")
```

## 19.3 Platform

```kotlin
implementation(platform("jakarta.platform:jakarta.jakartaee-bom:11.0.0"))
compileOnly("jakarta.ws.rs:jakarta.ws.rs-api")
```

## 19.4 Dependency insight

```bash
./gradlew dependencyInsight --dependency javax.ws.rs
```

## 19.5 Rule

Use dependency insight to find transitive legacy APIs.

---

# 20. OpenRewrite Migration

OpenRewrite provides recipes for Java/Jakarta migrations.

## 20.1 Relevant recipes

- `org.openrewrite.java.migrate.jakarta.JavaxMigrationToJakarta`
- `org.openrewrite.java.migrate.jakarta.JavaxWsToJakartaWs`
- Jakarta EE 10 migration recipes.

## 20.2 Benefits

- changes imports;
- changes dependencies;
- updates build files;
- repeatable;
- reviewable diff;
- CI-friendly.

## 20.3 Example Maven command concept

```bash
mvn -U org.openrewrite.maven:rewrite-maven-plugin:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-migrate-java:RELEASE \
  -Drewrite.activeRecipes=org.openrewrite.java.migrate.jakarta.JavaxMigrationToJakarta
```

Check latest recipe/plugin usage from OpenRewrite docs.

## 20.4 Workflow

```text
run recipe
review diff
compile
run tests
fix manual leftovers
add enforcer to prevent regressions
```

## 20.5 Rule

OpenRewrite is best for source/build migration automation.

---

# 21. Eclipse Transformer Migration

Eclipse Transformer transforms resources/files/archives according to rules.

## 21.1 Use case

- transform compiled JAR/WAR;
- transform third-party/internal binary artifacts;
- temporary bridge when source not available;
- deployment-time transformation.

## 21.2 Strength

Can operate on archives/resources, not only source code.

## 21.3 Caveat

Transformed binary is not same as properly migrated source.

Need test carefully.

## 21.4 Rule

Use source migration when possible; use binary transformer as tactical bridge.

---

# 22. IDE-Assisted Migration

IDEs can help:

- optimize imports;
- package rename refactoring;
- migration inspections;
- dependency analysis.

## 22.1 IntelliJ

Provides Jakarta migration assistance.

## 22.2 Caveat

IDE migration may miss build files, generated code, XML, ServiceLoader, shaded jars.

## 22.3 Rule

IDE tools are helpful but should be combined with dependency/tree/CI checks.

---

# 23. Generated Code Migration

Generated code often contains old imports.

Sources:

- OpenAPI generated JAX-RS server stubs;
- OpenAPI generated clients;
- JAXB generated classes;
- WSDL/JAX-WS generated code;
- annotation processors;
- legacy internal generators.

## 23.1 Strategy

Upgrade generator/templates.

Do not patch generated output manually if regeneration overwrites changes.

## 23.2 Rule

Migrate generator configuration, not just generated files.

---

# 24. XML/YAML/Properties Migration

Search config files for `javax`.

## 24.1 Examples

- `web.xml`;
- `beans.xml`;
- `persistence.xml`;
- `validation.xml`;
- `faces-config.xml`;
- `application.properties`;
- `server.xml`;
- `META-INF/services`;
- logging config;
- reflection config;
- native-image config.

## 24.2 XML schema namespaces

Some XML schemas may change; others may remain for compatibility.

Review target spec docs.

## 24.3 Rule

Source import migration is incomplete without config/resource migration.

---

# 25. Reflection/String Literal Migration

Search:

```bash
grep -R "javax.ws.rs" src main resources test
```

## 25.1 Examples

```java
Class.forName("javax.ws.rs.core.Response")
```

```properties
provider.class=javax.ws.rs.ext.RuntimeDelegate
```

## 25.2 Native image/reflection config

Update class names.

## 25.3 Rule

Strings are invisible to compiler; test and scan them.

---

# 26. ServiceLoader and META-INF/services Migration

JAX-RS and providers may use ServiceLoader.

## 26.1 Example

```text
META-INF/services/javax.ws.rs.ext.RuntimeDelegate
```

may need:

```text
META-INF/services/jakarta.ws.rs.ext.RuntimeDelegate
```

depending provider mechanism.

## 26.2 Third-party libraries

Old service files in dependencies can cause runtime weirdness.

## 26.3 Rule

Inspect service descriptors in custom/provider libraries.

---

# 27. Tests Migration

Tests often contain:

- `javax.ws.rs.client.Client`;
- old test containers;
- JerseyTest old version;
- RESTEasy old test libs;
- old app server plugins;
- old JSON providers;
- mocked imports.

## 27.1 Update test dependencies

Use Jakarta-compatible test frameworks.

## 27.2 Update mock servers

Usually unaffected, unless generated clients/models change.

## 27.3 Rule

Migration is incomplete until integration tests run on Jakarta runtime.

---

# 28. Client Code Migration

Outbound clients also migrate.

Old:

```java
import javax.ws.rs.client.Client;
import javax.ws.rs.client.ClientBuilder;
import javax.ws.rs.core.Response;
```

New:

```java
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.core.Response;
```

## 28.1 Provider registration

JSON provider class may change.

## 28.2 Timeout config

Standard APIs similar, but implementation-specific properties may change.

## 28.3 Rule

Test outbound clients with mock server after migration.

---

# 29. Provider/Filter/Mapper Migration

## 29.1 ExceptionMapper

```java
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
```

## 29.2 Filters

```java
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerRequestContext;
```

## 29.3 Interceptors

```java
import jakarta.ws.rs.ext.ReaderInterceptor;
import jakarta.ws.rs.ext.WriterInterceptor;
```

## 29.4 Rule

Provider registration must be retested because discovery may change with runtime.

---

# 30. EntityPart, Multipart, JAXB Removal, and New Jakarta REST 4.0 Considerations

## 30.1 Multipart

Jakarta REST newer versions standardize `EntityPart`.

If legacy app uses vendor-specific multipart, decide:

- keep vendor API temporarily;
- migrate to `EntityPart`;
- test memory/stream behavior.

## 30.2 JAXB removal

Jakarta REST 4.0 removes JAXB dependency from specification.

If your app relied on XML/JAXB entity mapping, add explicit dependencies/providers and test.

## 30.3 Rule

Migration is an opportunity to remove legacy vendor-specific multipart/XML assumptions.

---

# 31. ManagedBean Removal and CDI Migration

Jakarta REST 4.0 removes ManagedBean support.

## 31.1 Legacy

```java
@ManagedBean
@Path("/...")
public class Resource { ... }
```

## 31.2 Modern

```java
@RequestScoped
@Path("/...")
public class Resource {
    @Inject Service service;
}
```

## 31.3 Rule

Use CDI as component model for Jakarta REST resources/providers.

---

# 32. Jersey Migration Notes

## 32.1 Dependencies

Use Jersey Jakarta-compatible artifacts.

Check:

- server;
- container servlet;
- JSON provider;
- multipart;
- client;
- CDI/HK2 integration.

## 32.2 `ResourceConfig`

Jersey-specific `ResourceConfig` remains Jersey API.

Keep in infrastructure layer.

## 32.3 Test

Update JerseyTest version.

## 32.4 Rule

Jersey migration requires module alignment, not just `jakarta.ws.rs-api`.

---

# 33. RESTEasy Migration Notes

## 33.1 WildFly/JBoss

Runtime-provided RESTEasy should match server version.

## 33.2 Standalone RESTEasy

Upgrade RESTEasy dependencies.

## 33.3 Quarkus

Distinguish RESTEasy Classic and Quarkus REST/RESTEasy Reactive migration.

## 33.4 Rule

RESTEasy behavior is often platform-bound; test in actual server.

---

# 34. Apache CXF Migration Notes

## 34.1 Dependencies

Use CXF versions compatible with Jakarta namespace.

## 34.2 CXF-specific config

Update packages/classes in:

- Spring XML;
- Blueprint;
- CXF bus config;
- providers;
- interceptors;
- features.

## 34.3 Rule

CXF migration includes CXF configuration resources.

---

# 35. Open Liberty Migration Notes

## 35.1 Features

Open Liberty uses feature configuration.

Legacy:

```xml
<feature>jaxrs-2.1</feature>
```

Jakarta REST feature depends target version, e.g.:

```xml
<feature>restfulWS-3.1</feature>
```

or Jakarta REST 4.0 feature in newer Liberty.

## 35.2 CDI integration

Enable compatible CDI/Jakarta EE features.

## 35.3 Rule

Liberty migration is feature-set migration plus app namespace migration.

---

# 36. Quarkus Migration Notes

## 36.1 Quarkus 3+

Quarkus 3 moved to Jakarta namespace.

## 36.2 REST extensions

Understand:

- RESTEasy Classic;
- Quarkus REST;
- JSON-B/Jackson extensions;
- REST Client.

## 36.3 Blocking/reactive

Quarkus REST execution model matters.

## 36.4 Rule

Quarkus migration includes namespace, extension, and runtime execution model review.

---

# 37. Spring Boot 2 → 3 Context

Many teams encounter `javax` → `jakarta` via Spring Boot 3/Spring Framework 6.

## 37.1 Impact

Spring Boot 3 requires Jakarta EE 9+ namespace for Servlet/JPA/Validation.

## 37.2 JAX-RS inside Spring

If using Jersey/CXF/RESTEasy with Spring Boot, all integrations must be Jakarta-compatible.

## 37.3 Rule

Spring Boot 3 migration is also Jakarta namespace migration for many APIs.

---

# 38. Mixed Classpath Failure Mode

Mixed classpath is the most common migration disaster.

## 38.1 Example

Resource class imports:

```java
jakarta.ws.rs.Path
```

but runtime scans only old `javax.ws.rs.Path`.

Result:

```text
resource not discovered
404 all endpoints
```

## 38.2 Example

Provider implements:

```java
javax.ws.rs.ext.ExceptionMapper
```

but runtime expects:

```java
jakarta.ws.rs.ext.ExceptionMapper
```

Result:

```text
mapper ignored
default error response
```

## 38.3 Example

JSON provider compiled for `javax.ws.rs.ext.MessageBodyReader`.

Runtime expects `jakarta.ws.rs.ext.MessageBodyReader`.

Result:

```text
No MessageBodyReader/Writer found
415/500/serialization failure
```

## 38.4 Rule

Any `javax` Jakarta EE API on Jakarta runtime classpath is suspicious.

---

# 39. Binary Compatibility and Third-Party Libraries

A library compiled against `javax.ws.rs` cannot generally be used as provider/resource in `jakarta.ws.rs` runtime.

## 39.1 Options

- upgrade library;
- replace library;
- transform binary;
- isolate in separate process;
- write adapter;
- keep old runtime temporarily.

## 39.2 Rule

Third-party readiness is migration gate.

---

# 40. Adapter/Bridge Strategy

If a critical library has no Jakarta version:

## 40.1 Adapter source

Write small Jakarta-compatible adapter that calls library code not exposing JAX-RS types.

## 40.2 Separate process

Run legacy library/service on old runtime and communicate via HTTP/message.

## 40.3 Binary transformer

Use Eclipse Transformer as temporary bridge.

## 40.4 Rule

Do not pollute new Jakarta codebase with old `javax` APIs for one library.

---

# 41. Phased Migration Strategy

## 41.1 Phase 0 — Inventory

List dependencies/imports/runtime.

## 41.2 Phase 1 — Upgrade non-namespace dependencies

Move to versions that support both or prepare.

## 41.3 Phase 2 — Runtime upgrade path

Prepare Jakarta-compatible runtime.

## 41.4 Phase 3 — Source transformation

OpenRewrite/IDE/manual.

## 41.5 Phase 4 — Dependency cleanup

Remove old `javax` artifacts.

## 41.6 Phase 5 — Tests

Unit/integration/contract/security.

## 41.7 Phase 6 — Staged rollout

Canary/blue-green.

## 41.8 Rule

Phased migration reduces blast radius.

---

# 42. Big Bang Migration Strategy

Sometimes necessary for monolith.

## 42.1 Use when

- deeply coupled app;
- app server changes force full switch;
- shared modules cannot straddle namespaces;
- small enough codebase.

## 42.2 Risks

- large diff;
- many failures at once;
- hard rollback;
- dependency blockers.

## 42.3 Mitigation

- freeze features;
- automate transform;
- contract tests;
- branch discipline;
- parallel test environment.

## 42.4 Rule

Big bang needs strong test safety net.

---

# 43. Branching and Release Strategy

## 43.1 Long-lived migration branch

Risk: painful merge conflicts.

## 43.2 Short-lived branch with automation

Better if OpenRewrite repeatable.

## 43.3 Dual maintenance

Old `javax` production and new `jakarta` branch may need security fixes.

## 43.4 Rule

Keep migration as reproducible transformation where possible.

---

# 44. Contract Compatibility Strategy

API external contract should remain same unless intentionally versioned.

## 44.1 Test

Compare before/after:

- status;
- headers;
- body JSON;
- errors;
- OpenAPI;
- auth behavior;
- CORS;
- ETag;
- pagination.

## 44.2 Snapshot

Use golden files for key endpoints.

## 44.3 Rule

Namespace migration should not change HTTP contract accidentally.

---

# 45. OpenAPI Diff Strategy

Generate OpenAPI before and after.

## 45.1 Compare

- paths;
- operations;
- request schemas;
- response schemas;
- status codes;
- security schemes;
- media types.

## 45.2 Expected changes

Some implementation upgrade can change generated spec ordering/descriptions.

Filter noise.

## 45.3 Rule

OpenAPI diff is powerful migration guardrail.

---

# 46. Runtime Integration Test Strategy

Test on target runtime:

- resource discovery;
- provider discovery;
- CDI injection;
- JSON serialization;
- validation;
- exception mapping;
- filters/interceptors;
- multipart;
- SSE;
- async;
- client;
- persistence;
- security.

## 46.1 Rule

Compile success is not migration success.

---

# 47. Performance/Regression Test Strategy

Runtime upgrade can change performance.

Test:

- startup time;
- memory/RSS/heap;
- first request latency;
- throughput;
- p95/p99 latency;
- JSON serialization cost;
- multipart memory;
- streaming behavior;
- client connection pool.

## 47.1 Rule

Namespace migration can have operational regressions due to runtime/library upgrades.

---

# 48. Observability and Production Rollout

## 48.1 Before rollout

Create dashboards:

- 2xx/4xx/5xx by endpoint;
- latency;
- error codes;
- JSON parsing errors;
- provider errors;
- 404/405/415/500 changes;
- memory/thread pools;
- DB errors.

## 48.2 Canary

Deploy to small traffic first.

## 48.3 Compare

Before/after metrics.

## 48.4 Rule

Migration rollout needs observability, not just deployment.

---

# 49. Rollback Strategy

## 49.1 Binary rollback

Can you redeploy old version?

## 49.2 Database compatibility

If DB migrations included, can old app still run?

## 49.3 API compatibility

Did gateway route change?

## 49.4 Artifact compatibility

Old and new app may need separate runtime/server image.

## 49.5 Rule

Plan rollback before migration deployment.

---

# 50. Migration Checklist

## 50.1 Inventory

- [ ] `javax.ws.rs` imports listed.
- [ ] All `javax.*` Jakarta EE imports listed.
- [ ] Java SE `javax.*` imports identified and excluded.
- [ ] Maven/Gradle dependency tree captured.
- [ ] Third-party libraries checked.
- [ ] Generated code sources identified.
- [ ] XML/YAML/properties scanned.
- [ ] ServiceLoader descriptors scanned.

## 50.2 Runtime

- [ ] Target Jakarta EE runtime selected.
- [ ] JAX-RS implementation version selected.
- [ ] Servlet/CDI/Validation/Persistence versions aligned.
- [ ] JSON provider selected.
- [ ] App server features configured.
- [ ] Test runtime aligned.

## 50.3 Code/build

- [ ] OpenRewrite/IDE/manual migration applied.
- [ ] Dependencies changed to Jakarta.
- [ ] Old `javax` Jakarta EE APIs removed.
- [ ] Enforcer/dependency rules added.
- [ ] Generated code migrated.
- [ ] Config resources migrated.
- [ ] Tests migrated.

## 50.4 Validation

- [ ] Unit tests pass.
- [ ] Runtime integration tests pass.
- [ ] OpenAPI diff reviewed.
- [ ] Contract tests pass.
- [ ] Security tests pass.
- [ ] Multipart/streaming/SSE tested if used.
- [ ] Performance smoke pass.
- [ ] Canary plan ready.
- [ ] Rollback plan ready.

---

# 51. Common Failure Modes

## 51.1 `NoClassDefFoundError: javax/ws/rs/...`

Old library still expects `javax.ws.rs`.

## 51.2 `ClassNotFoundException: jakarta/ws/rs/...`

Runtime too old or dependency missing.

## 51.3 All endpoints return 404

Resource annotations namespace mismatch or scanning config wrong.

## 51.4 ExceptionMapper ignored

Mapper implements old interface or not registered.

## 51.5 MessageBodyReader/Writer missing

JSON provider old namespace.

## 51.6 Validation not triggered

`javax.validation` annotations mixed with `jakarta.validation` runtime.

## 51.7 CDI injection null/fails

CDI dependency namespace/runtime mismatch.

## 51.8 Servlet filter not invoked

Old `javax.servlet.Filter` with Jakarta Servlet runtime.

## 51.9 Persistence annotations ignored

`javax.persistence.Entity` with Jakarta Persistence runtime.

## 51.10 Tests pass locally but fail server

Local test runtime not same as target runtime.

## 51.11 XML still references old classes

Runtime config fails.

## 51.12 Shaded jar hides old javax API

Dependency tree not enough; inspect jar contents.

---

# 52. Best Practices

## 52.1 Inventory first

Know scope.

## 52.2 Use automated recipes

OpenRewrite for source/build.

## 52.3 Align dependencies via BOM

Avoid mixed versions.

## 52.4 Upgrade runtime deliberately

Do not deploy Jakarta app to old runtime.

## 52.5 Ban old dependencies

Use Maven Enforcer/Gradle checks.

## 52.6 Keep Java SE `javax` packages

Do not blind replace.

## 52.7 Test target runtime

Provider/CDI/JSON behavior.

## 52.8 Use OpenAPI diff

Protect external contract.

## 52.9 Isolate legacy libraries

Do not contaminate new codebase.

## 52.10 Roll out gradually

Canary with observability.

---

# 53. Anti-Patterns

## 53.1 Global search-replace `javax` to `jakarta`

Breaks Java SE packages.

## 53.2 Only update imports, not dependencies

Compile/runtime mismatch.

## 53.3 Keep old app server

Jakarta classes unavailable.

## 53.4 Mix old JSON provider

No entity provider at runtime.

## 53.5 Ignore generated code

Regeneration reintroduces `javax`.

## 53.6 Ignore tests

Test code still old namespace.

## 53.7 Ignore XML/resources

Runtime config broken.

## 53.8 Deploy without contract diff

Accidental API break.

## 53.9 Migrate and upgrade business behavior simultaneously

Hard to debug.

## 53.10 No rollback

Risky production migration.

---

# 54. Production Readiness Checklist

## 54.1 Build

- [ ] No `javax.ws.rs` in source/test/generated code.
- [ ] No old Jakarta EE `javax` APIs except Java SE packages.
- [ ] Dependency tree clean.
- [ ] Enforcer/Gradle rule active.
- [ ] BOM/platform versions aligned.
- [ ] Reproducible OpenRewrite/transform step documented.

## 54.2 Runtime

- [ ] Target runtime supports Jakarta namespace.
- [ ] JAX-RS implementation compatible.
- [ ] CDI integration verified.
- [ ] Validation integration verified.
- [ ] JSON provider verified.
- [ ] Servlet filters/listeners migrated.
- [ ] Persistence provider migrated.

## 54.3 API contract

- [ ] OpenAPI before/after diff reviewed.
- [ ] Golden response tests pass.
- [ ] Problem Details unchanged unless intentional.
- [ ] Headers/status/media types unchanged unless intentional.
- [ ] Client SDK/generated artifacts updated.

## 54.4 Operations

- [ ] Performance smoke done.
- [ ] Observability dashboards ready.
- [ ] Canary deployment plan.
- [ ] Error budget/rollback criteria.
- [ ] Rollback artifact/runtime available.
- [ ] Support/runbook updated.

---

# 55. Latihan

## Latihan 1 — Inventory Report

Buat laporan:

```text
all javax imports
which should migrate
which should stay
dependencies using javax
generated code sources
runtime version
```

## Latihan 2 — OpenRewrite Dry Run

Jalankan OpenRewrite migration recipe di branch terpisah.

Review diff.

Catat manual fixes.

## Latihan 3 — Dependency Ban

Tambahkan Maven Enforcer/Gradle rule untuk melarang:

```text
javax.ws.rs:javax.ws.rs-api
javax.servlet:javax.servlet-api
javax.validation:validation-api
```

sesuaikan project.

## Latihan 4 — Provider Discovery Test

Migrasikan ExceptionMapper.

Pastikan runtime memakai mapper baru.

## Latihan 5 — Validation Namespace Test

Pastikan `jakarta.validation.constraints.NotBlank` memicu error.

Pastikan tidak ada annotation lama yang terlewat.

## Latihan 6 — JSON Provider Test

Test response DTO dengan:

- date-time;
- enum;
- null;
- unknown fields.

Bandingkan before/after.

## Latihan 7 — OpenAPI Diff

Generate OpenAPI sebelum dan sesudah migrasi.

Classify changes:

```text
expected
unexpected
breaking
non-breaking
```

## Latihan 8 — Runtime Canary Plan

Buat checklist deploy canary:

- traffic percentage;
- metrics to watch;
- rollback criteria;
- log queries;
- smoke endpoints.

## Latihan 9 — Legacy Library Strategy

Pilih satu dependency yang masih `javax`.

Tentukan:

```text
upgrade
replace
transform
adapter
separate service
```

---

# 56. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

2. Jakarta RESTful Web Services 4.0.0 Release Review  
   https://projects.eclipse.org/projects/ee4j.rest/releases/4.0.0/review

3. Jakarta EE Blog — Javax to Jakarta Namespace Ecosystem Progress  
   https://jakarta.ee/blogs/javax-jakartaee-namespace-ecosystem-progress/

4. OpenRewrite — Migrate to Jakarta EE 9  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

5. OpenRewrite — Migrate deprecated `javax.ws` packages to `jakarta.ws`  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxwstojakartaws

6. OpenRewrite — Migrate to Jakarta EE 10  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/jakartaee10

7. Eclipse Transformer Project  
   https://projects.eclipse.org/projects/technology.transformer

8. Eclipse Transformer GitHub  
   https://github.com/eclipse-transformer/transformer

9. Jakarta RESTful Web Services 4.0 API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/

---

# 57. Penutup

Migrasi `javax.ws.rs` ke `jakarta.ws.rs` adalah migrasi ekosistem.

Mental model final:

```text
Source imports
  +
Dependencies
  +
Runtime/app server
  +
Providers
  +
CDI/Servlet/Validation/Persistence
  +
Generated code
  +
Config/resources
  +
Tests
  +
Contracts
  =
Successful migration
```

Prinsip final:

```text
Do not mix javax and jakarta Jakarta EE APIs.
Do not blind replace all javax packages.
Do not trust compile success.
Do not migrate without runtime integration tests.
Do not deploy without OpenAPI/contract diff.
```

Top-tier JAX-RS engineer memastikan:

- inventory lengkap sebelum rewrite;
- OpenRewrite/Eclipse Transformer dipakai secara tepat;
- dependency tree bersih;
- runtime compatible;
- Java SE `javax.*` tidak rusak;
- third-party libraries siap;
- provider/JSON/CDI/validation/persistence dites;
- API contract tetap compatible;
- rollout dan rollback disiapkan.

Part berikutnya:

```text
Bagian 039 — Legacy JAX-RS 2.1 Features: Async, SSE, Reactive Client
```

Kita akan membahas fitur era JAX-RS 2.1 yang masih penting untuk maintenance legacy system: async server, SSE, reactive client, compatibility behavior, migration to Jakarta REST 4.0, and how to modernize without breaking old clients.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 037 — Implementation Deep Dive: Jersey, RESTEasy, Apache CXF, Open Liberty, Quarkus REST, Provider Discovery, CDI Integration, Client Connector, Multipart, SSE, Async, Testing Tools, Performance Knobs, and Migration Strategy](./learn-jaxrs-advanced-part-037.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 039 — Legacy JAX-RS 2.1 Features: Async, SSE, Reactive Client, Java EE 8 Maintenance, `javax.ws.rs`, Compatibility Behavior, and Modernization to Jakarta REST 4.0](./learn-jaxrs-advanced-part-039.md)
