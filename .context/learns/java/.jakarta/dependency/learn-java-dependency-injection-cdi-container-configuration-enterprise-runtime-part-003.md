# Part 003 — Java EE to Jakarta EE Migration Model: `javax.*` to `jakarta.*`

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
Part: `003 / 035`  
Topic: Java EE to Jakarta EE Migration Model  
Target Java: 8 → 25  
Target reader: senior/lead Java engineer moving from usage-level knowledge into runtime/platform-level understanding

---

## 0. What This Part Is Really About

Most developers describe the Java EE → Jakarta EE transition as:

> "Just replace `javax.*` with `jakarta.*`."

That sentence is technically related to the change, but it is a dangerous mental model.

A better mental model is:

> Java EE → Jakarta EE migration is a **platform boundary migration**. It changes the API namespace, dependency graph, runtime provider compatibility, server baseline, deployment descriptors, generated code, bytecode references, reflection strings, third-party library compatibility, and sometimes the operational shape of the application.

The package rename is the most visible part. The deeper issue is that enterprise Java applications are not isolated source files. They are a runtime system made of:

```text
application source code
+ generated source code
+ compiled bytecode
+ annotation metadata
+ XML descriptors
+ JAR manifests
+ JSP/TLD files
+ persistence units
+ validation metadata
+ CDI bean archives
+ server-provided APIs
+ provider implementations
+ classloaders
+ deployment tooling
+ test harnesses
+ CI/CD packaging
+ operational config
```

A correct migration must align all of them.

This part gives the mental model needed before touching actual migration recipes.

---

## 1. Baseline Context: Java EE, Jakarta EE, and the Namespace Break

### 1.1 Java EE world

Historically, enterprise Java APIs lived mostly under `javax.*` packages:

```java
import javax.inject.Inject;
import javax.enterprise.context.ApplicationScoped;
import javax.ejb.Stateless;
import javax.annotation.PostConstruct;
import javax.persistence.Entity;
import javax.ws.rs.GET;
import javax.servlet.http.HttpServletRequest;
```

This is the Java EE 8 / Jakarta EE 8 style world.

Important point:

> Jakarta EE 8 still used the `javax.*` namespace.

That means the name "Jakarta EE" alone does not tell you whether a project uses `javax.*` or `jakarta.*`.

The namespace break begins with Jakarta EE 9.

---

### 1.2 Jakarta EE world

In Jakarta EE 9 and later, enterprise APIs moved to `jakarta.*`:

```java
import jakarta.inject.Inject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ejb.Stateless;
import jakarta.annotation.PostConstruct;
import jakarta.persistence.Entity;
import jakarta.ws.rs.GET;
import jakarta.servlet.http.HttpServletRequest;
```

The important architectural implication:

> `javax.persistence.Entity` and `jakarta.persistence.Entity` are different Java types.

They may look conceptually equivalent, but at runtime they are not interchangeable.

For the JVM:

```text
javax.persistence.Entity      !=      jakarta.persistence.Entity
```

The same applies to annotations, interfaces, exceptions, interceptors, CDI APIs, Servlet APIs, JAX-RS APIs, validation APIs, and more.

---

### 1.3 Why the rename matters so much

Java type identity is not based on simple class name. It is based on the fully qualified binary name and classloader.

So this:

```java
javax.servlet.Filter
```

and this:

```java
jakarta.servlet.Filter
```

are completely different interfaces.

If a runtime expects `jakarta.servlet.Filter`, but your compiled class implements `javax.servlet.Filter`, then from the runtime's perspective your class does not implement the required interface.

This is the root of many migration failures.

---

## 2. Migration Is Not Source Search-and-Replace

A beginner migration plan usually looks like this:

```text
1. Replace javax. with jakarta.
2. Update dependencies.
3. Build.
4. Deploy.
```

A senior migration plan looks more like this:

```text
1. Identify current platform generation.
2. Identify target platform generation.
3. Classify dependencies by namespace and provider role.
4. Classify runtime container compatibility.
5. Decide migration strategy.
6. Transform source, descriptors, generated files, and binary references.
7. Align test runtime.
8. Validate dependency graph.
9. Validate deployment unit.
10. Validate runtime behavior.
11. Validate operational assumptions.
12. Remove compatibility hacks.
```

The difference is that the senior plan treats migration as a graph alignment problem.

---

## 3. The Four Compatibility Axes

A Jakarta migration can fail even when the code compiles. To reason properly, separate four compatibility axes.

### 3.1 Source compatibility

Source compatibility asks:

> Can the source code compile after imports and APIs are updated?

Example:

```java
// old
import javax.inject.Inject;

// new
import jakarta.inject.Inject;
```

This is the easiest layer to see.

But source compatibility is not enough.

---

### 3.2 Binary compatibility

Binary compatibility asks:

> Can already compiled classes link against the runtime classes available at execution time?

A compiled class contains constant pool references such as:

```text
Ljavax/servlet/http/HttpServletRequest;
Ljavax/persistence/Entity;
Ljavax/ws/rs/Path;
```

Changing source imports does not update already compiled third-party JARs.

If a library was compiled against `javax.*`, it still contains `javax.*` bytecode references.

This is why mixed dependency graphs are dangerous.

---

### 3.3 Runtime compatibility

Runtime compatibility asks:

> Does the application server/container implement the same API generation that the application expects?

Example:

```text
Application compiled with jakarta.servlet.*
Runtime server exposes javax.servlet.*
Result: deployment failure
```

or:

```text
Application compiled with javax.servlet.*
Runtime server exposes jakarta.servlet.*
Result: deployment failure
```

You cannot fix this with source imports alone.

The server generation must match the app generation.

---

### 3.4 Semantic compatibility

Semantic compatibility asks:

> Even after compile and deployment, is the behavior still equivalent?

Examples:

- CDI bean discovery behavior may differ by platform version.
- Persistence provider version may change SQL generation or lazy loading behavior.
- Validation provider version may change message interpolation behavior.
- JAX-RS provider version may change parameter conversion behavior.
- Servlet version may change request/response edge behavior.
- Security integration may differ.
- Default transaction behavior may be unchanged by spec but changed by provider/server integration.

This is why real migration needs behavior-preserving tests.

---

## 4. Platform Generation Map

The following map is a practical decision tool.

```text
Java EE 7 / Java EE 8
    namespace: javax.*
    common Java baseline: Java 8
    common runtime style: traditional app server, WAR/EAR

Jakarta EE 8
    namespace: javax.*
    basically continuity from Java EE 8 under Eclipse/Jakarta governance

Jakarta EE 9 / 9.1
    namespace: jakarta.*
    main purpose: namespace transition

Jakarta EE 10
    namespace: jakarta.*
    stronger modernization baseline
    CDI 4 era, Servlet 6 era, Persistence 3.1 era

Jakarta EE 11
    namespace: jakarta.*
    Java SE 17+ baseline
    modernized platform, Jakarta Data introduced, updated specs
```

A simple but powerful rule:

> `javax.*` applications belong to the Java EE 8 / Jakarta EE 8 generation. `jakarta.*` applications belong to Jakarta EE 9+ generation.

There are exceptions for APIs not part of the renamed set, but as an enterprise platform migration rule, this is the right starting point.

---

## 5. The Big Trap: Mixed Namespace Runtime

The most common migration failure is not "forgot to change one import".

The most common architectural failure is:

> Some part of the application graph is `javax.*`, while another part is `jakarta.*`.

Example:

```text
Your code: jakarta.ws.rs.Path
JAX-RS runtime: jakarta.ws.rs.*
Third-party filter library: javax.servlet.Filter
Server: jakarta.servlet.*
```

This may compile if the old API JAR is accidentally included, but deployment fails because the server is not looking for `javax.servlet.Filter` implementations.

---

### 5.1 Mixed namespace example: Servlet filter

Old library:

```java
public final class LegacyAuditFilter implements javax.servlet.Filter {
    // ...
}
```

New runtime expects:

```java
jakarta.servlet.Filter
```

Even if method names look the same, this is not assignable.

From the JVM:

```text
LegacyAuditFilter implements javax.servlet.Filter
LegacyAuditFilter does not implement jakarta.servlet.Filter
```

Therefore the container cannot treat it as a Jakarta Servlet filter.

---

### 5.2 Mixed namespace example: JPA annotation

Old entity:

```java
@javax.persistence.Entity
public class CaseRecord {
}
```

New provider scans for:

```java
@jakarta.persistence.Entity
```

The class may still exist, but the new provider may not recognize it as a Jakarta Persistence entity.

This is a very important concept:

> Annotation identity is also type identity.

`javax.persistence.Entity` is not a synonym for `jakarta.persistence.Entity`.

---

### 5.3 Mixed namespace example: Bean Validation

Old constraint:

```java
import javax.validation.constraints.NotNull;

public record CreateCaseRequest(
    @NotNull String caseType
) {}
```

New runtime expects:

```java
jakarta.validation.constraints.NotNull
```

If the validation provider is Jakarta-generation and the model still uses old annotations, constraints may not be discovered or integration may fail depending on the stack.

---

## 6. Migration Boundary: What Actually Needs to Change?

Not every `javax.*` import must become `jakarta.*`.

This is subtle.

Some `javax.*` packages are Java SE packages, not Jakarta EE packages.

Examples that generally remain `javax.*`:

```java
javax.crypto.Cipher
javax.net.ssl.SSLContext
javax.xml.parsers.DocumentBuilderFactory
javax.management.MBeanServer
javax.naming.Context
javax.sql.DataSource
```

Examples that usually migrate to `jakarta.*`:

```java
javax.inject.Inject                 -> jakarta.inject.Inject
javax.enterprise.context.*          -> jakarta.enterprise.context.*
javax.ejb.*                         -> jakarta.ejb.*
javax.annotation.PostConstruct       -> jakarta.annotation.PostConstruct
javax.persistence.*                  -> jakarta.persistence.*
javax.validation.*                   -> jakarta.validation.*
javax.ws.rs.*                        -> jakarta.ws.rs.*
javax.servlet.*                      -> jakarta.servlet.*
javax.json.*                         -> jakarta.json.*
javax.json.bind.*                    -> jakarta.json.bind.*
javax.mail.*                         -> jakarta.mail.*
javax.jms.*                          -> jakarta.jms.*
javax.transaction.*                  -> jakarta.transaction.*
javax.security.enterprise.*          -> jakarta.security.enterprise.*
javax.faces.*                        -> jakarta.faces.*
```

The correct rule is:

> Migrate Java/Jakarta EE APIs, not every package beginning with `javax`.

A blind global replacement can break Java SE APIs.

---

## 7. Namespace Migration Table

| Old Java EE / Jakarta EE 8 API | New Jakarta EE 9+ API | Notes |
|---|---|---|
| `javax.inject.*` | `jakarta.inject.*` | Injection annotations |
| `javax.enterprise.*` | `jakarta.enterprise.*` | CDI |
| `javax.annotation.*` | `jakarta.annotation.*` | Common annotations, but not every old annotation has same status |
| `javax.ejb.*` | `jakarta.ejb.*` | Enterprise Beans |
| `javax.persistence.*` | `jakarta.persistence.*` | Persistence/JPA |
| `javax.transaction.*` | `jakarta.transaction.*` | JTA/Jakarta Transactions |
| `javax.validation.*` | `jakarta.validation.*` | Bean Validation |
| `javax.ws.rs.*` | `jakarta.ws.rs.*` | REST/JAX-RS |
| `javax.servlet.*` | `jakarta.servlet.*` | Servlet |
| `javax.websocket.*` | `jakarta.websocket.*` | WebSocket |
| `javax.json.*` | `jakarta.json.*` | JSON Processing |
| `javax.json.bind.*` | `jakarta.json.bind.*` | JSON Binding |
| `javax.jms.*` | `jakarta.jms.*` | Messaging |
| `javax.mail.*` | `jakarta.mail.*` | Mail |
| `javax.faces.*` | `jakarta.faces.*` | Faces/JSF |
| `javax.security.enterprise.*` | `jakarta.security.enterprise.*` | Security |
| `javax.resource.*` | `jakarta.resource.*` | Connectors |
| `javax.batch.*` | `jakarta.batch.*` | Batch |
| `javax.interceptor.*` | `jakarta.interceptor.*` | Interceptors |
| `javax.el.*` | `jakarta.el.*` | Expression Language |

Always verify exact package names for the specific API version you target.

---

## 8. Java Version Alignment

A migration is often also a Java version migration.

Typical enterprise modernization paths:

```text
Java 8 + Java EE 8 / Jakarta EE 8 + javax.*
        ↓
Java 11 or 17 + Jakarta EE 9/10 + jakarta.*
        ↓
Java 17/21/25 + Jakarta EE 11 + jakarta.*
```

Important distinctions:

- Java version controls language features, bytecode level, JVM behavior, GC options, module access, TLS defaults, etc.
- Jakarta EE version controls enterprise API namespace and specification versions.
- App server version controls actual runtime implementation and supported Java versions.
- Provider versions control behavior for CDI/JPA/Validation/JAX-RS/etc.

Do not collapse them into one vague idea of "upgrade Java".

---

## 9. Runtime Generation Alignment

The app and server must agree.

```text
Correct alignment:

App source:      jakarta.*
App dependencies: jakarta.* APIs
Third-party libs: jakarta-compatible
Server runtime: Jakarta EE 10/11 compatible
Providers:      jakarta-compatible

Incorrect alignment:

App source:      jakarta.*
Third-party libs: javax.*
Server runtime: Jakarta EE 10
Result: class/interface/annotation mismatch risk
```

Another incorrect alignment:

```text
App source:      javax.*
Server runtime: Jakarta EE 10/11
Result: deployment failure or silent missing metadata
```

Another incorrect alignment:

```text
App source:      jakarta.*
Server runtime: Java EE 8 / Jakarta EE 8
Result: classes not found, deployment failure
```

---

## 10. Dependency Graph Classification

Before migrating, classify every dependency.

### 10.1 Category A — Pure Java SE libraries

Examples:

```text
Apache Commons Lang
Guava
Jackson core without Jakarta integration
SLF4J API
Logback
Caffeine
```

Usually unaffected by namespace migration unless they integrate with enterprise APIs.

---

### 10.2 Category B — Jakarta/Java EE API dependencies

Examples:

```xml
<dependency>
  <groupId>javax</groupId>
  <artifactId>javaee-api</artifactId>
</dependency>
```

or:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
</dependency>
```

These must be aligned with the target platform.

---

### 10.3 Category C — Provider implementations

Examples:

```text
Hibernate ORM
EclipseLink
Weld
OpenWebBeans
RESTEasy
Jersey
Hibernate Validator
Yasson
Angus Mail
```

Provider generation matters. A `javax.*` provider version is not the same as a `jakarta.*` provider version.

---

### 10.4 Category D — Integration libraries

Examples:

```text
OpenAPI integration
Swagger/JAX-RS integration
Security filters
Servlet filters
JPA auditing libraries
Bean Validation custom integrations
JAX-RS providers
CDI extensions
```

These are often migration blockers because they directly reference enterprise APIs.

---

### 10.5 Category E — Framework/platform libraries

Examples:

```text
Spring Boot 2 vs Spring Boot 3
Quarkus old vs new versions
Micronaut versions
Helidon versions
Camel versions
Keycloak adapters/SPIs
```

These often define the migration timeline because they pull an entire ecosystem with them.

For example, a framework generation may force `javax` or `jakarta` compatibility.

---

### 10.6 Category F — Internal shared libraries

These are often underestimated.

Examples:

```text
company-common-web.jar
company-audit.jar
company-validation.jar
company-security-filter.jar
company-jpa-base.jar
company-rest-client.jar
company-exception-mapper.jar
```

Internal libraries compiled against `javax.*` can block Jakarta migration just like third-party libraries.

A common enterprise failure:

```text
Main app migrated to jakarta.*
Internal audit/security/common libraries still compiled against javax.*
Deployment fails or runtime behavior disappears
```

---

## 11. Migration Inventory Checklist

Before migration, produce an inventory like this.

```text
Application modules:
- api-web.war
- case-management.jar
- compliance.jar
- audit.jar
- common-core.jar
- common-web.jar

Runtime:
- current server: WildFly / Payara / WebLogic / TomEE / Open Liberty / Tomcat / Jetty / custom
- current Java: 8 / 11 / 17 / 21
- current target Java: 17 / 21 / 25
- current namespace: javax / mixed / jakarta
- target namespace: jakarta

Enterprise APIs used:
- CDI
- Servlet
- JAX-RS
- JPA
- Bean Validation
- Transactions
- EJB
- JMS
- Mail
- WebSocket
- JSON-B / JSON-P
- Security

Descriptors used:
- web.xml
- beans.xml
- persistence.xml
- ejb-jar.xml
- application.xml
- validation.xml
- faces-config.xml
- orm.xml
- vendor descriptors

Risk dependencies:
- servlet filters
- JAX-RS providers
- CDI extensions
- JPA listeners
- validation constraints
- EJB remote clients
- XML descriptors
- generated code
```

This inventory prevents blind migration.

---

## 12. Where `javax` References Hide

A naive source grep misses many places.

Search these locations:

```text
src/main/java/**/*.java
src/test/java/**/*.java
src/main/resources/**/*.xml
src/main/resources/**/*.properties
src/main/webapp/**/*.jsp
src/main/webapp/**/*.tag
src/main/webapp/WEB-INF/**/*.tld
src/main/webapp/WEB-INF/**/*.xml
META-INF/services/*
Maven/Gradle build files
Dockerfiles
server config
CI scripts
generated source directories
annotation processor output
OpenAPI generated clients
JAXB generated classes
JPA static metamodel classes
serialized config strings
reflection-based class names
JNDI/resource mapping descriptors
```

Also inspect compiled artifacts:

```bash
jar tf app.war | grep '\.class$'
```

and bytecode/string references:

```bash
jdeps --multi-release 17 --recursive target/app.war
```

or rough string scan:

```bash
zipgrep 'javax\.' target/app.war
```

The rough scan is not perfect, but it catches many descriptor and string issues.

---

## 13. Descriptor Migration

Namespace changes affect XML descriptors too.

Examples:

- `web.xml`
- `beans.xml`
- `persistence.xml`
- `orm.xml`
- `validation.xml`
- `ejb-jar.xml`
- `application.xml`
- `faces-config.xml`
- `ra.xml`
- vendor-specific descriptors

Common mistake:

> Java source migrated, but XML schema remains old or class names inside descriptors still reference `javax.*` classes.

Example risk:

```xml
<listener>
  <listener-class>com.example.LegacyListener</listener-class>
</listener>
```

If `LegacyListener` implements `javax.servlet.ServletContextListener`, it is not a Jakarta Servlet listener.

Another example:

```xml
<provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
```

Provider class may differ or provider version may be wrong for the Jakarta Persistence generation.

---

## 14. Generated Code Risk

Enterprise apps often contain generated code.

Common generated sources:

```text
JAXB generated classes
JAX-WS generated clients
OpenAPI clients
JPA static metamodel
MapStruct output
QueryDSL generated classes
Annotation processor generated files
SOAP stubs
REST clients
```

Generated code may import `javax.*` even if handwritten source is clean.

Migration rule:

> Regenerate from a Jakarta-compatible generator where possible. Transform generated code only as a fallback.

Why?

Because generated code is usually recreated during build. If the generator still emits `javax.*`, your manual edits will be overwritten.

---

## 15. Testing Runtime Risk

Many teams migrate application code but forget test runtime.

Examples:

```text
JUnit extension still starts javax-based container
Arquillian adapter targets old server
Weld JUnit version is javax generation
REST-assured/JAX-RS integration pulls old API
embedded servlet container is old generation
```

Result:

```text
Production build looks fine
Tests fail mysteriously
or worse: tests pass against old runtime while production uses new runtime
```

A migration must align:

```text
main dependencies
test dependencies
test container
embedded runtime
mock framework integrations
contract test server
CI runtime image
```

---

## 16. Dependency Scope Trap

In Jakarta EE applications, API dependencies are often `provided` because the application server provides them.

Example:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

But for executable JAR or embedded runtimes, dependencies may not be provided by a full server.

Wrong assumption:

> Jakarta API dependency is always provided.

Better rule:

> API scope depends on deployment model.

Deployment model matrix:

| Deployment model | API dependency scope tendency |
|---|---|
| Full Jakarta EE server WAR/EAR | usually `provided` |
| Servlet container only | servlet API provided, others app-provided or framework-provided |
| Quarkus/MicroProfile executable | platform-managed by framework extension |
| Spring Boot executable | dependencies packaged or managed by Boot |
| Plain Java SE CDI bootstrap | APIs and implementation included by app |

---

## 17. API JAR vs Implementation JAR Trap

Do not confuse API coordinates with provider implementation.

API dependency:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
</dependency>
```

Provider dependency:

```xml
<dependency>
  <groupId>org.hibernate.orm</groupId>
  <artifactId>hibernate-core</artifactId>
</dependency>
```

An API JAR gives compile-time types. It does not necessarily provide runtime behavior.

Similarly:

```text
jakarta.enterprise.cdi-api != CDI runtime
jakarta.ws.rs-api          != JAX-RS runtime
jakarta.validation-api     != validation runtime
jakarta.servlet-api        != servlet container
```

In a full Jakarta EE server, provider implementations are usually supplied by the server.

In embedded or plain Java SE style, you must include compatible implementations.

---

## 18. Migration Strategy Options

There is no single best migration strategy. Choose based on system shape.

---

### 18.1 Big-bang migration

```text
Migrate entire codebase and runtime generation at once.
```

Good when:

- app is small/medium
- dependency graph is controlled
- test coverage is strong
- deployment pipeline is simple
- third-party libraries are Jakarta-compatible

Bad when:

- many internal libraries
- legacy server constraints
- many modules
- weak tests
- many generated artifacts
- active delivery pressure

Risk:

```text
Too many simultaneous failure sources.
```

---

### 18.2 Module-by-module source migration

```text
Migrate internal modules gradually, then switch runtime once graph is ready.
```

This is harder than it sounds because a module compiled against `jakarta.*` may not be usable by a `javax.*` app.

Useful only if module boundaries are clean and not exposing enterprise API types.

A good internal library API avoids exposing platform types:

```java
// Better boundary
public interface AuditWriter {
    void write(AuditEvent event);
}
```

A harder-to-migrate boundary exposes platform types:

```java
// Migration-hostile boundary
public interface RequestAuditWriter {
    void write(javax.servlet.http.HttpServletRequest request);
}
```

The second interface forces callers and implementors into the same namespace generation.

---

### 18.3 Compatibility adapter boundary

Use adapters to isolate `javax` or `jakarta` edge types.

Example:

```text
Servlet/JAX-RS layer converts platform request into internal request context.
Core modules do not depend on javax/jakarta APIs.
```

Internal model:

```java
public record RequestContextView(
    String correlationId,
    String userId,
    String remoteAddress
) {}
```

Boundary adapter:

```java
@ApplicationScoped
public class RequestContextMapper {
    public RequestContextView from(jakarta.servlet.http.HttpServletRequest request) {
        return new RequestContextView(
            request.getHeader("X-Correlation-ID"),
            request.getRemoteUser(),
            request.getRemoteAddr()
        );
    }
}
```

This reduces migration blast radius.

---

### 18.4 Binary transformation

Tools can transform compiled artifacts from `javax.*` to `jakarta.*`.

This is useful when:

- source is unavailable
- dependency has no Jakarta version
- migration is temporary
- you need proof-of-concept quickly

But it is risky as a permanent solution because:

- transformed artifacts may diverge from upstream support
- subtle semantic issues may remain
- stack traces/debugging can be confusing
- licenses/support policies may matter
- CI/CD must reproduce transformation deterministically

Treat binary transformation as a bridge, not the ideal end state.

---

### 18.5 Strangler migration

Run old and new systems side-by-side with clear integration boundaries.

Example:

```text
Old Java EE 8 / javax system continues handling legacy flows.
New Jakarta EE 11 service handles new module or API.
Integration through HTTP/event/database boundary.
```

Good when:

- system is large
- business cannot stop feature delivery
- migration risk is high
- modules can be separated by capability

Bad when:

- database coupling is too strong
- transaction boundary spans both systems
- session state is shared deeply
- security context cannot be bridged safely

---

## 19. Practical Migration Decision Matrix

| System condition | Recommended strategy |
|---|---|
| Small app, few dependencies, strong tests | Big-bang |
| Many modules, clean internal boundaries | Module-by-module prep + final platform switch |
| Legacy internal libraries expose servlet/JPA/CDI APIs | Refactor boundaries first |
| Third-party library unavailable in Jakarta version | Replace, upgrade, transform temporarily, or isolate |
| Mission-critical weakly tested system | Strangler or phased migration |
| Heavy EJB/EAR legacy | Runtime/server migration plan first |
| Mostly REST/JPA/CDI modern app | Direct Jakarta EE 10/11 migration likely feasible |
| Old Spring Boot 2 app | Boot 3 migration path because Boot 3 is Jakarta generation |
| Servlet-only app on Tomcat 9 | Tomcat 10+ migration path with servlet namespace change |

---

## 20. Code Example: Before and After

### 20.1 Java EE / Jakarta EE 8 style

```java
package com.example.caseapp.boundary;

import javax.inject.Inject;
import javax.enterprise.context.RequestScoped;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;

@RequestScoped
@Path("/cases")
public class CaseResource {

    @Inject
    private CaseService caseService;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public CaseSummary listCases() {
        return caseService.listCases();
    }
}
```

### 20.2 Jakarta EE 9+ style

```java
package com.example.caseapp.boundary;

import jakarta.inject.Inject;
import jakarta.enterprise.context.RequestScoped;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@RequestScoped
@Path("/cases")
public class CaseResource {

    @Inject
    private CaseService caseService;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public CaseSummary listCases() {
        return caseService.listCases();
    }
}
```

At source level, this looks trivial.

At platform level, you must also ensure:

```text
JAX-RS runtime is Jakarta-compatible
CDI runtime is Jakarta-compatible
server recognizes jakarta.ws.rs.Path
test runtime recognizes jakarta.* annotations
all filters/providers are jakarta-compatible
deployment descriptors are updated
BOM/dependencies are aligned
```

---

## 21. Code Example: Boundary-Friendly Internal Service

Avoid leaking platform APIs into core services.

### 21.1 Migration-hostile design

```java
public interface UserContextResolver {
    UserContext resolve(javax.servlet.http.HttpServletRequest request);
}
```

This interface forces internal modules to depend on Servlet API.

Migration impact:

```text
When servlet namespace changes, internal module changes too.
```

---

### 21.2 Migration-friendly design

```java
public interface UserContextResolver {
    UserContext resolve(RequestMetadata metadata);
}

public record RequestMetadata(
    String principalName,
    String remoteAddress,
    String correlationId
) {}
```

Then only the web adapter depends on Servlet:

```java
@ApplicationScoped
public class ServletRequestMetadataFactory {

    public RequestMetadata from(jakarta.servlet.http.HttpServletRequest request) {
        return new RequestMetadata(
            request.getRemoteUser(),
            request.getRemoteAddr(),
            request.getHeader("X-Correlation-ID")
        );
    }
}
```

Now migration impact is localized.

Lesson:

> Good boundaries make platform migrations smaller.

---

## 22. Code Example: Annotation Identity Problem

Suppose you write a custom scanner:

```java
boolean isEntity(Class<?> type) {
    return type.isAnnotationPresent(javax.persistence.Entity.class);
}
```

After migration, your entity uses:

```java
@jakarta.persistence.Entity
public class CaseRecord {
}
```

The scanner now returns false.

Correct Jakarta version:

```java
boolean isEntity(Class<?> type) {
    return type.isAnnotationPresent(jakarta.persistence.Entity.class);
}
```

This demonstrates that migration affects reflection code too.

Search for:

```text
Class.forName("javax.
getAnnotation(javax.
isAnnotationPresent(javax.
META-INF/services/javax.
```

---

## 23. ServiceLoader and SPI Migration

Some integrations use Java `ServiceLoader`.

Example file:

```text
META-INF/services/javax.ws.rs.ext.RuntimeDelegate
```

Jakarta generation may require:

```text
META-INF/services/jakarta.ws.rs.ext.RuntimeDelegate
```

If only source imports are migrated but service provider files are not, provider discovery can fail.

This matters for:

```text
JAX-RS providers
JSON-B providers
JSON-P providers
CDI extensions
validation providers
custom framework integrations
```

Migration rule:

> Check `META-INF/services` as part of namespace migration.

---

## 24. CDI Migration Concerns

CDI migration is not only:

```text
javax.enterprise -> jakarta.enterprise
```

Also check:

```text
beans.xml namespace/version
CDI provider generation
portable extensions
interceptor bindings
decorators
alternatives
stereotypes
qualifiers
custom scopes
annotation literals
```

Example old custom qualifier:

```java
import javax.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface ExternalGateway {
}
```

Jakarta version:

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface ExternalGateway {
}
```

The custom annotation's identity remains your package, but its meta-annotation changes.

If it remains meta-annotated with `javax.inject.Qualifier`, a Jakarta CDI runtime may not treat it as a CDI qualifier.

---

## 25. JPA/Persistence Migration Concerns

Check:

```text
entity annotations
persistence.xml schema/provider
JPA provider version
JPA static metamodel
entity listeners
attribute converters
criteria API imports
transaction integration
second-level cache provider compatibility
```

Example old converter:

```java
import javax.persistence.AttributeConverter;
import javax.persistence.Converter;

@Converter(autoApply = true)
public class YesNoConverter implements AttributeConverter<Boolean, String> {
    // ...
}
```

Jakarta version:

```java
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class YesNoConverter implements AttributeConverter<Boolean, String> {
    // ...
}
```

If converter remains old namespace, provider discovery may fail.

---

## 26. Servlet/JAX-RS Migration Concerns

Check:

```text
filters
listeners
servlets
JAX-RS resources
exception mappers
container request/response filters
message body readers/writers
features
dynamic features
application class
web.xml
servlet initializer equivalents
```

Example old exception mapper:

```java
import javax.ws.rs.ext.ExceptionMapper;
import javax.ws.rs.ext.Provider;

@Provider
public class BusinessExceptionMapper implements ExceptionMapper<BusinessException> {
    // ...
}
```

Jakarta version:

```java
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class BusinessExceptionMapper implements ExceptionMapper<BusinessException> {
    // ...
}
```

If your mapper remains `javax`, the Jakarta JAX-RS runtime will not see it as the correct provider type.

---

## 27. Bean Validation Migration Concerns

Check:

```text
constraints on DTOs
custom constraints
constraint validators
validation.xml
message interpolation
method validation integration
JAX-RS validation integration
JPA validation integration
```

Old custom validator:

```java
import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;

public class PostalCodeValidator implements ConstraintValidator<PostalCode, String> {
    // ...
}
```

Jakarta version:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class PostalCodeValidator implements ConstraintValidator<PostalCode, String> {
    // ...
}
```

Also check custom constraint annotation meta-annotations:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
```

If the constraint annotation still uses old validation meta-annotations, the Jakarta provider may not treat it as a constraint.

---

## 28. EJB Migration Concerns

Check:

```text
@Stateless
@Stateful
@Singleton
@Schedule
@Asynchronous
@TransactionAttribute
@Local
@Remote
@EJB injection
ejb-jar.xml
remote clients
application-client modules
security annotations
JNDI names
```

EJB remote clients are especially risky.

Why?

Because remote interfaces may be compiled and distributed separately.

If server interface changes from:

```java
javax.ejb.Remote
```

to:

```java
jakarta.ejb.Remote
```

clients must align too.

For internal migration, prefer converting remote EJB contracts into explicit HTTP/message contracts where possible, but only when business and operational constraints allow.

---

## 29. Common Failure Modes and What They Mean

### 29.1 `ClassNotFoundException: javax.servlet.Filter`

Likely cause:

```text
Running javax-compiled code on Jakarta servlet runtime.
```

Fix direction:

```text
Migrate code/dependency to jakarta.servlet.* or replace library.
```

---

### 29.2 `ClassNotFoundException: jakarta.servlet.Filter`

Likely cause:

```text
Running Jakarta-compiled code on old Java EE/Jakarta EE 8 runtime.
```

Fix direction:

```text
Upgrade server/runtime to Jakarta EE 9+ generation or revert app to javax generation.
```

---

### 29.3 `NoSuchMethodError`

Likely cause:

```text
Compile-time API/provider version differs from runtime version.
```

Fix direction:

```text
Inspect dependency tree and server-provided modules.
```

---

### 29.4 CDI unsatisfied dependency after migration

Possible causes:

```text
bean not discovered
qualifier meta-annotation still javax
producer not discovered
generated class still old namespace
beans.xml wrong/missing
provider version mismatch
```

Fix direction:

```text
Inspect bean archive, qualifiers, scopes, and CDI provider logs.
```

---

### 29.5 Entity not found / not managed type

Possible causes:

```text
entity annotations still javax.persistence
persistence.xml wrong version/provider
JPA provider mismatch
entity package scanning changed
static metamodel stale
```

Fix direction:

```text
Inspect compiled entity annotations and persistence unit config.
```

---

### 29.6 JAX-RS resource not exposed

Possible causes:

```text
@Path annotation still javax.ws.rs.Path
Application class mismatch
JAX-RS provider generation mismatch
web.xml/application config not updated
resource packaged in non-discovered archive
```

Fix direction:

```text
Inspect resource class bytecode/imports and deployment logs.
```

---

## 30. Migration Verification Pipeline

A robust pipeline has multiple layers.

### 30.1 Source scan

```bash
grep -R "javax\." src pom.xml build.gradle settings.gradle
```

But remember: not all `javax.*` is wrong.

Classify findings.

---

### 30.2 Dependency tree scan

Maven:

```bash
mvn dependency:tree -Dverbose
```

Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency javax
./gradlew dependencyInsight --dependency jakarta
```

Look for old API artifacts and old provider generations.

---

### 30.3 Bytecode scan

```bash
jdeps --recursive target/app.war
```

String scan:

```bash
zipgrep 'javax\.' target/app.war
zipgrep 'jakarta\.' target/app.war
```

Caution:

> String scanning can produce false positives and false negatives, but it is useful as a quick guardrail.

---

### 30.4 Deployment validation

Deploy to the target runtime and require startup to fail fast.

Check:

```text
CDI deployment validation
JPA persistence unit bootstrap
JAX-RS application registration
Servlet filters/listeners
EJB deployment
resource injection
transaction manager integration
validation provider bootstrap
```

---

### 30.5 Behavioral smoke test

Minimum smoke tests:

```text
health endpoint
one JAX-RS endpoint
one DB transaction
one validation failure
one CDI injection path
one configuration read
one security/auth path
one external connector mock
one scheduled/async path if used
```

---

### 30.6 Regression test

Run domain-level regression tests, not only framework startup tests.

Example for case management:

```text
create case
assign case
transition case state
validate invalid transition
generate correspondence
audit event created
search/list case
permission denied for wrong role
```

This catches semantic regressions.

---

## 31. Build Configuration Example: Maven

### 31.1 Old Java EE 8 style

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>javax</groupId>
      <artifactId>javaee-api</artifactId>
      <version>8.0</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

or:

```xml
<dependency>
  <groupId>javax.ws.rs</groupId>
  <artifactId>javax.ws.rs-api</artifactId>
  <version>2.1.1</version>
  <scope>provided</scope>
</dependency>
```

### 31.2 Jakarta EE 11 style

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

For Web Profile:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Important:

> Use the API dependency that matches the runtime profile you actually deploy to.

Do not compile against full Platform if you deploy to a Web Profile server unless you intentionally restrict usage by other means.

---

## 32. Build Guardrails

Add explicit guardrails so the graph does not drift back.

### 32.1 Maven Enforcer idea

Useful rules:

```text
dependency convergence
ban duplicate classes
ban old javax API artifacts
require Java version
require Maven version
```

Example conceptual policy:

```text
No dependency may bring:
- javax:javaee-api
- javax.ws.rs:javax.ws.rs-api
- javax.servlet:javax.servlet-api
- javax.persistence:javax.persistence-api
- javax.validation:validation-api

unless explicitly whitelisted for a known Java SE package or temporary migration bridge.
```

---

### 32.2 CI namespace gate

Example simple CI check:

```bash
#!/usr/bin/env bash
set -euo pipefail

ARTIFACT="target/app.war"

if zipgrep -q 'javax\.ws\.rs\|javax\.servlet\|javax\.enterprise\|javax\.persistence\|javax\.validation\|javax\.ejb' "$ARTIFACT"; then
  echo "Forbidden Java EE javax references found in artifact: $ARTIFACT"
  exit 1
fi
```

This should be refined to avoid false positives, but it captures the idea.

---

## 33. Tooling Options

Tooling can help, but it does not replace understanding.

Common tooling categories:

```text
source rewriting
binary transformation
dependency analysis
server-specific migration reports
IDE migration assists
CI guardrails
```

Examples:

- OpenRewrite recipes for Javax-to-Jakarta source migration.
- Eclipse Transformer for transforming artifacts/binaries/resources.
- Apache Tomcat migration tool for Tomcat/Servlet-oriented migration.
- Server vendor migration tools/reports.
- Maven/Gradle dependency analysis.
- `jdeps` and artifact scanning.

Tooling principle:

> Use tools for mechanical transformation. Use engineering judgment for compatibility, semantics, and runtime correctness.

---

## 34. Migration Playbook

### Phase 1 — Discover

Deliverables:

```text
current platform map
dependency graph
server/runtime version map
Java version map
namespace inventory
risk dependency list
descriptor inventory
generated code inventory
smoke test list
```

Questions:

```text
Are we currently pure javax, pure jakarta, or mixed?
Which dependencies expose enterprise APIs?
Which internal libraries must be migrated first?
Which server will host the target app?
Which Java version will target runtime support?
```

---

### Phase 2 — Decide target

Decide:

```text
Jakarta EE 10 or 11?
Java 17, 21, or 25?
Full platform or Web Profile?
Traditional WAR/EAR or executable service?
Keep EJB or migrate to CDI/service style?
Keep JNDI resources or wrap behind producers?
```

Do not start mechanical migration before target is clear.

---

### Phase 3 — Stabilize boundaries

Before changing imports, reduce blast radius.

Actions:

```text
remove servlet/JAX-RS/JPA/CDI types from core modules where possible
introduce internal request/context models
wrap JNDI/resource lookup
wrap framework-specific APIs
extract platform adapters
add missing regression tests
```

This makes migration easier and improves architecture even if migration is delayed.

---

### Phase 4 — Align dependencies

Actions:

```text
switch BOM/API dependencies
upgrade providers
upgrade framework versions
replace incompatible libraries
migrate internal common libraries
remove old javax API artifacts
```

Important:

> Do not let both old `javax` enterprise API artifacts and new `jakarta` API artifacts coexist unless you have a deliberate temporary bridge and understand the classloader implications.

---

### Phase 5 — Transform source/resources

Actions:

```text
update imports
update descriptors
update META-INF/services
regenerate generated code
update reflection strings
update documentation examples
update test fixtures
```

---

### Phase 6 — Compile and package

Actions:

```text
clean build
verify no stale generated output
inspect dependency tree
scan artifact
confirm provided/runtime scopes
```

---

### Phase 7 — Deploy to target runtime

Actions:

```text
deploy to actual target server/container
inspect startup logs
validate CDI/JPA/JAX-RS/Servlet/EJB bootstrap
validate resource injection
validate config
```

Never claim migration success from compilation alone.

---

### Phase 8 — Validate behavior

Actions:

```text
run smoke tests
run regression tests
run security flow
run transaction behavior tests
run async/scheduler tests
run failure path tests
run performance sanity checks
```

---

### Phase 9 — Remove migration residue

Actions:

```text
remove binary transformation hacks when possible
remove compatibility dependencies
remove duplicate APIs
remove stale javax comments/config
remove old server descriptors
remove obsolete tests
add CI guardrails
record ADR
```

---

## 35. Architecture Principle: Keep Platform Types at Platform Boundaries

One of the best long-term lessons from this migration:

> The more your domain/application core depends on platform-specific types, the harder every platform migration becomes.

Platform types include:

```text
HttpServletRequest
Response
EntityManager
ConstraintValidatorContext
InvocationContext
SecurityContext
UserTransaction
SessionContext
```

They are not bad. They belong at the boundary.

A healthy architecture has this shape:

```text
[ HTTP / JAX-RS / Servlet / Messaging / Scheduler ]
                    |
                    v
          [ Platform Adapter Layer ]
                    |
                    v
          [ Application Use Cases ]
                    |
                    v
              [ Domain Model ]
                    |
                    v
          [ Infrastructure Ports ]
                    |
                    v
       [ JPA / External Client / Queue / Mail ]
```

Migration blast radius should mostly affect:

```text
Platform Adapter Layer
Infrastructure Adapter Layer
Build/runtime configuration
```

not the domain core.

---

## 36. How This Connects to CDI and Dependency Injection

The migration changes the type system CDI uses.

CDI resolution depends on:

```text
bean type
qualifier annotation type
scope annotation type
interceptor binding type
stereotype type
producer method metadata
observer event type
```

All of these can be affected by namespace migration.

Example:

```java
@javax.enterprise.context.ApplicationScoped
public class CaseService {}
```

A Jakarta CDI runtime expects:

```java
@jakarta.enterprise.context.ApplicationScoped
```

If the annotation is not recognized as a bean-defining annotation in the target CDI generation, the class may not be discovered as a bean.

That means migration affects object graph construction.

This directly connects to the core theme of this series:

> Enterprise Java is not just code. It is code interpreted by a runtime/container using metadata, type identity, classloaders, and deployment rules.

---

## 37. Migration Risk Model

Use this risk model when planning.

| Risk | Signal | Mitigation |
|---|---|---|
| Mixed namespace | Both `javax.enterprise` and `jakarta.enterprise` in graph | dependency scan, artifact scan, ban rules |
| Server mismatch | App compiles but deployment fails | align server generation early |
| Provider mismatch | `NoSuchMethodError`, bootstrap failure | use platform BOM, check provider compatibility |
| Descriptor drift | Source clean but deployment broken | scan XML/resources |
| Generated code drift | Build regenerates old imports | upgrade generator |
| Internal library lag | common JAR still `javax` | migrate common libs first or isolate |
| Test/runtime mismatch | tests pass old generation | upgrade test runtime/container |
| Semantic regression | app starts but behavior changes | behavior tests and smoke tests |
| Operational drift | works locally not in server | deploy to real target runtime early |
| Hidden reflection | scanner or string references old classes | search reflection and service loader references |

---

## 38. Senior Engineer Checklist

Before saying "migration is done", verify:

```text
[ ] Target Jakarta EE version is explicit.
[ ] Target Java version is explicit.
[ ] Target server/runtime version is explicit.
[ ] Full Platform vs Web Profile decision is explicit.
[ ] API dependencies match target platform.
[ ] Provider dependencies match target namespace.
[ ] No accidental old Java EE API JARs remain.
[ ] Third-party libraries are Jakarta-compatible.
[ ] Internal shared libraries are migrated or isolated.
[ ] Source imports are migrated.
[ ] XML descriptors are migrated.
[ ] META-INF/services entries are checked.
[ ] Generated code is regenerated with Jakarta-compatible tooling.
[ ] Reflection strings are checked.
[ ] CDI bean discovery works.
[ ] JPA persistence units bootstrap.
[ ] JAX-RS resources register.
[ ] Servlet filters/listeners register.
[ ] EJBs deploy if used.
[ ] Validation works.
[ ] Transaction behavior is tested.
[ ] Security flow is tested.
[ ] Config/resource injection works.
[ ] Smoke tests pass on real target runtime.
[ ] Regression tests pass.
[ ] CI has guardrails against namespace regression.
[ ] Migration notes/ADR are written.
```

---

## 39. Mental Model Summary

Remember these invariants:

1. `javax.*` and `jakarta.*` are different Java types.
2. Migration is a graph alignment problem, not just an import rewrite.
3. Server/runtime generation must match application generation.
4. Third-party and internal libraries can block migration.
5. Annotation identity matters for CDI, JPA, validation, JAX-RS, EJB, and Servlet discovery.
6. XML descriptors, generated code, and service loader files are part of the migration surface.
7. Binary transformation can be useful, but should usually be treated as a bridge.
8. Compile success is not deployment success.
9. Deployment success is not semantic success.
10. Good architecture keeps platform types near platform boundaries.

---

## 40. Practical Exercise

Take one existing Java EE/Jakarta EE module and produce this report:

```text
Module name:
Current Java version:
Current namespace generation: javax / jakarta / mixed
Target Java version:
Target Jakarta EE version:
Deployment model: WAR / EAR / executable JAR / other
Enterprise APIs used:
Server/runtime:
Provider implementations:
Internal shared libraries:
Third-party integration libraries:
Descriptors present:
Generated code present:
Known javax references:
Known jakarta references:
Migration blockers:
Recommended migration strategy:
Smoke tests required:
Rollback plan:
```

Then classify each `javax.*` reference as:

```text
A. Java SE package: should remain javax
B. Java/Jakarta EE package: must migrate
C. third-party package/string: inspect manually
D. generated output: regenerate or transform
E. descriptor/service metadata: update carefully
```

This exercise builds the instinct needed before touching large systems.

---

## 41. What Comes Next

This part gave the migration model.

The next part moves from platform namespace into the runtime itself:

```text
Part 004 — Runtime / Container Model: Who Owns Your Object?
```

That part will explain what the container actually does during bootstrap, scanning, validation, injection, proxying, lifecycle callbacks, interception, destruction, and shutdown.

---

## 42. References

- Jakarta EE Platform 11 Specification and release pages: `https://jakarta.ee/specifications/platform/11/`
- Jakarta EE 11 release overview: `https://jakarta.ee/release/11/`
- Jakarta CDI 4.1: `https://jakarta.ee/specifications/cdi/4.1/`
- Jakarta Enterprise Beans specification pages: `https://jakarta.ee/specifications/enterprise-beans/`
- Eclipse Transformer project: `https://projects.eclipse.org/projects/technology.transformer`
- Apache Tomcat Migration Tool for Jakarta EE: `https://tomcat.apache.org/download-migration.cgi`
- OpenRewrite Javax to Jakarta migration recipe: `https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta`

---

# Status Seri

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[ ] Part 004 — Runtime / Container Model: Who Owns Your Object?
...
[ ] Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton
```

Seri belum selesai. Ini adalah Part 003 dari total rencana 035 part.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 004 — Runtime / Container Model: Who Owns Your Object?](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-004.md)
