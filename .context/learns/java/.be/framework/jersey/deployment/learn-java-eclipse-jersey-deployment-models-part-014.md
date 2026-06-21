# learn-java-eclipse-jersey-deployment-models-part-014  
# Part 14 — Jakarta EE Server Deployment: GlassFish, Payara, Open Liberty, WildFly, dan Runtime Managed Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 14 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey/Jakarta REST pada managed enterprise runtime, bukan hanya embedded server.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: bagaimana aplikasi Jersey/Jakarta REST berjalan ketika **runtime server** yang memiliki container, API implementation, CDI, security, transactions, resources, classloader, dan lifecycle.

---

## 1. Apa Itu Jakarta EE Server Deployment Model?

Jakarta EE Server Deployment Model adalah model ketika aplikasi tidak membawa seluruh HTTP/runtime stack sendiri.

Sebaliknya:

```text
Jakarta EE server starts first.
Application is deployed into the server.
Server creates and manages runtime context.
Application runs inside managed container.
```

Contoh server/runtime:

```text
GlassFish
Payara
Open Liberty
WildFly
```

Dalam model embedded sebelumnya:

```text
Application owns:
  HTTP server
  Jersey runtime
  lifecycle
  shutdown
  dependency ownership
```

Dalam Jakarta EE server model:

```text
Server owns:
  Servlet container
  Jakarta REST implementation
  CDI container
  transaction manager
  security integration
  resource pools
  deployment lifecycle
  classloader hierarchy
  monitoring/admin model
```

Aplikasi biasanya dikemas sebagai:

```text
WAR
EAR
```

Untuk REST API modern, WAR adalah bentuk paling umum.

---

## 2. Mental Model Utama

Mental model terpenting:

> Dalam managed server deployment, aplikasi adalah **component** di dalam runtime platform, bukan proses runtime independen.

Ini mengubah banyak hal:

| Area | Embedded Model | Jakarta EE Server Model |
|---|---|---|
| Process | App starts JVM/server | Server starts app |
| HTTP runtime | App owns | Server owns |
| Servlet container | Optional | Server owns |
| Jakarta REST | App may own Jersey | Server may provide implementation |
| CDI | App configures or embeds | Server owns CDI container |
| Transactions | App/library managed | Server-managed JTA |
| Security | App/gateway/filter | Server + app integration |
| DB pool | App Hikari/etc | Server datasource/JNDI possible |
| Classloading | App mostly owns | Server/module/webapp hierarchy |
| Deployment | jar/image | WAR/EAR/server deployment |
| Shutdown | app signal handling | server undeploy/stop lifecycle |

Top-tier insight:

```text
The biggest mistake in Jakarta EE deployment is treating the server like a dumb servlet launcher.
```

A Jakarta EE server is not just “Tomcat plus libraries”.

It is a managed runtime platform.

---

## 3. Jersey vs Jakarta REST in Full Server

Jersey is an implementation of JAX-RS/Jakarta REST.

But in full Jakarta EE servers, the server may already provide a Jakarta REST implementation.

Examples:

```text
GlassFish/Payara:
  historically Jersey-based

WildFly:
  commonly RESTEasy-based

Open Liberty:
  provides Jakarta REST feature via configured runtime features
```

This matters because your application may not be the owner of Jersey.

There are two major modes:

### Mode A — Container-Owned Jakarta REST

```text
Server provides Jakarta REST implementation.
Application uses Jakarta REST API.
```

Application dependency:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Application should usually not bundle Jersey implementation.

### Mode B — Application-Owned Jersey Inside Server

```text
Application bundles Jersey implementation in WAR.
Server provides Servlet only or allows override.
```

This is common with servlet-only containers like Tomcat/Jetty, but more delicate with full Jakarta EE servers.

In full servers, bundling your own Jersey can conflict with:

- server-provided Jakarta REST implementation,
- CDI integration,
- classloader modules,
- server REST bootstrap,
- server-managed injection/security.

Rule:

```text
On full Jakarta EE server, assume the server owns Jakarta REST unless you have explicit reason and tested override.
```

---

## 4. Jakarta EE Profiles

Jakarta EE has profiles.

Simplified:

```text
Core Profile:
  foundational modern APIs

Web Profile:
  web application APIs

Platform:
  full set of Jakarta EE APIs
```

The Jakarta EE tutorial describes Core, Web, and Platform as profile categories: Core profile contains foundational services; Web profile adds services for web applications; Platform includes Core and Web plus additional services such as mail, batch, messaging, and more.

For Jersey deployment:

```text
Core Profile:
  may be relevant for small REST runtimes

Web Profile:
  usually enough for REST + CDI + Servlet + JSON + Validation

Full Platform:
  needed if you rely on full enterprise APIs like messaging, batch, mail, etc.
```

Do not deploy to full platform just because it exists.

Choose based on required services.

---

## 5. Java 8 to Java 25 and Server Generations

### Java 8 Era

Likely stack:

```text
Java 8
Java EE / Jakarta EE 8
JAX-RS 2.x
javax.ws.rs
javax.servlet
Jersey 2.x
```

Examples:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

### Java 11 Transition Era

Possible stacks:

```text
Java 11 + Jersey 2.x + javax.*
Java 11 + Jersey 3.x + jakarta.*
```

This is migration-sensitive.

### Java 17 Modern Jakarta EE 10/11 Era

Jakarta EE 11 requires modern Java baseline. Jakarta EE 11 is aligned with Java SE 17 as a minimum platform baseline in its specifications and Core Profile references Java SE 17.

Typical stack:

```text
Java 17+
Jakarta EE 10/11
jakarta.*
Jersey 3.x / 4.x depending runtime
```

### Java 21 / Java 25 Era

For Java 21/25:

```text
validate server support
validate bytecode target
validate deployment tools
validate agents
validate reflection/proxy behavior
validate vendor certification/compatibility
```

Do not assume a Jakarta EE server supports Java 25 just because your code compiles on Java 25.

Runtime support is server-specific.

---

## 6. `javax.*` vs `jakarta.*` in Managed Servers

This is the highest-risk boundary.

Server generations:

```text
Java EE / Jakarta EE 8:
  javax.*

Jakarta EE 9+:
  jakarta.*
```

A Jakarta EE 10/11 server expects:

```java
jakarta.ws.rs.Path
jakarta.inject.Inject
jakarta.servlet.*
```

A Java EE 8 server expects:

```java
javax.ws.rs.Path
javax.inject.Inject
javax.servlet.*
```

If you deploy a `javax.ws.rs` application to a `jakarta.ws.rs` server:

```text
resources may not be discovered
CDI may fail
providers may fail
classloading may fail
```

If you deploy a `jakarta.ws.rs` app to Java EE 8 server:

```text
ClassNotFoundException: jakarta/ws/rs/...
```

Rule:

```text
Server generation and application namespace must match.
```

---

## 7. Packaging: WAR vs EAR

### WAR

Typical for REST service:

```text
my-service.war
├─ WEB-INF/classes
├─ WEB-INF/lib
└─ WEB-INF/web.xml optional
```

WAR contains:

- REST resources,
- CDI beans,
- DTOs,
- application services,
- persistence units if used,
- application config,
- app-specific dependencies.

### EAR

Enterprise archive:

```text
my-system.ear
├─ app1.war
├─ app2.war
├─ business.jar
├─ lib/
└─ META-INF/application.xml
```

EAR is useful when:

- multiple modules deployed together,
- shared EJB/business module,
- legacy enterprise packaging,
- centralized deployment unit,
- complex app server integration.

But EAR increases classloader complexity.

For most modern REST services:

```text
Prefer WAR unless EAR is justified.
```

---

## 8. Minimal Jakarta REST Application in Managed Server

A resource:

```java
package com.example.api;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/hello")
public final class HelloResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Application class:

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Endpoint if WAR context root is `my-service`:

```text
/my-service/api/hello
```

Path composition:

```text
context root:
  /my-service

@ApplicationPath:
  /api

@Resource @Path:
  /hello

final:
  /my-service/api/hello
```

This is similar to servlet mapping, but managed by server Jakarta REST bootstrap.

---

## 9. `Application` vs `ResourceConfig` in Managed Server

In pure Jakarta REST standard:

```java
public class ApiApplication extends Application {
}
```

Jersey-specific:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HelloResource.class);
        register(GlobalExceptionMapper.class);
    }
}
```

If the server uses Jersey, `ResourceConfig` can work.

But if the server uses another Jakarta REST implementation, `ResourceConfig` is Jersey-specific and not portable.

Decision:

```text
Want implementation portability?
  Use jakarta.ws.rs.core.Application.

Want Jersey-specific features?
  Use ResourceConfig, but accept implementation coupling.
```

Top-tier guidance:

```text
Inside full Jakarta EE server, avoid Jersey-specific bootstrap unless you deliberately depend on Jersey.
```

If you are targeting Payara/GlassFish and want Jersey-specific features, that may be fine.

If you need portability across WildFly/Open Liberty/Payara, use standard Jakarta REST APIs where possible.

---

## 10. Dependency Scope in Managed Server

A common mistake:

```text
Bundling server-provided APIs/implementations inside WAR.
```

For Jakarta EE server, dependencies often use `provided`:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>${jakarta.ee.version}</version>
  <scope>provided</scope>
</dependency>
```

Or smaller:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>

<dependency>
  <groupId>jakarta.enterprise</groupId>
  <artifactId>jakarta.enterprise.cdi-api</artifactId>
  <scope>provided</scope>
</dependency>

<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Why?

Because the server supplies runtime implementation.

If you package API jars unnecessarily, sometimes harmless, sometimes conflict-prone.

If you package implementation jars that server also provides, risk increases:

```text
NoSuchMethodError
ClassCastException
provider duplication
CDI bootstrap conflict
REST implementation conflict
validation provider conflict
JSON-B provider conflict
```

Rule:

```text
In managed server, application should not casually bundle platform implementation libraries.
```

---

## 11. Server-Provided Services

Jakarta EE server may provide:

```text
Servlet
Jakarta REST
CDI
Bean Validation
JSON-B
JSON-P
JTA transactions
JPA provider
Jakarta Security
Jakarta Authentication
Jakarta Authorization
Jakarta Concurrency
Jakarta Mail
Jakarta Batch
Messaging/JMS
Connection pools
JNDI naming
Managed executors
Admin/monitoring
Deployment lifecycle
```

This is the value of full server.

If your application ignores all of these and bundles everything itself, ask:

```text
Why are we using a Jakarta EE server?
```

Maybe Tomcat/Jetty/embedded runtime is a better fit.

---

## 12. CDI Ownership

Jakarta CDI defines services that allow objects to be bound to lifecycle contexts, injected, associated with interceptors/decorators, and interact via events.

In managed server:

```text
CDI container owns bean discovery, scopes, injection, interceptors, decorators, events.
```

Example:

```java
@RequestScoped
@Path("/users")
public class UserResource {

    @Inject
    UserService userService;

    @GET
    public List<UserDto> list() {
        return userService.list();
    }
}
```

Service:

```java
@ApplicationScoped
public class UserService {
    public List<UserDto> list() {
        return List.of();
    }
}
```

Managed scopes:

```text
@RequestScoped
@ApplicationScoped
@SessionScoped
@Dependent
```

Top-tier point:

```text
In managed server, object lifecycle should be container-aware.
```

Do not mix:

```text
manual singleton registries
static service locators
custom DI container
```

without strong reason.

---

## 13. CDI and Jersey/Jakarta REST Integration

In a managed server, REST resources are often CDI-managed or integrated with CDI.

But behavior depends on server/runtime.

Questions:

```text
Are resource classes CDI beans?
Are providers CDI-managed?
Can ExceptionMapper inject beans?
Can ContainerRequestFilter inject beans?
What scope are resources?
Does @Transactional work in resource/service layer?
```

Do not assume from one server to another without testing.

Example provider:

```java
@Provider
@ApplicationScoped
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {

    @Inject
    ErrorResponseFactory errorResponseFactory;

    @Override
    public Response toResponse(Throwable exception) {
        return Response.status(500)
            .entity(errorResponseFactory.internalError())
            .build();
    }
}
```

Test this integration on the target server.

---

## 14. Transactions

In embedded apps, transaction management often comes from:

```text
HikariCP + manual transaction
Spring transaction
jOOQ transaction
custom unit-of-work
```

In Jakarta EE server, transactions can be container-managed.

Example:

```java
@ApplicationScoped
public class CaseService {

    @Transactional
    public void approveCase(String id) {
        // update DB
        // write audit
        // publish event if integrated transactionally
    }
}
```

Key questions:

```text
Which annotation?
Jakarta Transactions @Transactional?
EJB @TransactionAttribute?
Is CDI interceptor enabled?
Does method call go through proxy/interceptor?
Is self-invocation bypassing transaction?
What resource participates in JTA?
```

Common bug:

```java
public void outer() {
    inner(); // self-invocation may bypass interceptor depending model
}

@Transactional
public void inner() {
}
```

Top-tier invariant:

```text
Transaction boundary must be explicit and tested at service/use-case boundary.
```

Do not put transaction policy randomly in resource methods unless intentionally doing HTTP-per-transaction boundary.

---

## 15. Database Resources: Server Pool vs Application Pool

Managed server can define datasource:

```text
jdbc/MyDataSource
```

Application injects/looks up:

```java
@Resource(lookup = "jdbc/MyDataSource")
DataSource dataSource;
```

Advantages:

- central pool configuration,
- admin monitoring,
- credential management integration,
- JTA participation,
- environment-specific resources,
- operational consistency.

Application-owned pool like HikariCP may still be valid, but then:

```text
application owns pool lifecycle
server may not manage transactions
monitoring is app-specific
resource config moves into app
```

Decision:

```text
If using full Jakarta EE server for managed resources, prefer server-managed datasource unless app has strong reason not to.
```

---

## 16. JNDI and Resource Naming

JNDI gives naming indirection:

```text
java:comp/env/jdbc/MyDataSource
java:global/...
jdbc/MyDataSource
```

Resource lookup can be configured by server deployment descriptors or annotations.

Benefits:

```text
same app artifact deployed to DEV/UAT/PROD with different resource binding
```

Risk:

```text
JNDI name mismatch causes deployment/runtime failure
```

Production practice:

```text
- document required JNDI resources
- validate at startup
- fail fast if missing
- include environment provisioning checklist
```

---

## 17. Security in Managed Server

Managed server may provide:

```text
Jakarta Security
Jakarta Authentication
container-managed auth
role mapping
principal propagation
security constraints
```

Example standard-ish resource use:

```java
@GET
@Path("/me")
public Response me(@Context SecurityContext securityContext) {
    Principal principal = securityContext.getUserPrincipal();
    return Response.ok(principal.getName()).build();
}
```

Authorization:

```java
@RolesAllowed("ADMIN")
@GET
@Path("/admin")
public Response admin() {
    return Response.ok().build();
}
```

But real enterprise systems often need domain authorization beyond roles:

```text
Can user X approve case Y in state Z for agency A?
```

That cannot be solved only by `@RolesAllowed`.

Top-tier rule:

```text
Use container security for identity and coarse access.
Use domain authorization for business decisions.
```

---

## 18. Context Root and Application Path

Managed server path composition:

```text
scheme://host:port/{context-root}/{application-path}/{resource-path}
```

Example:

```text
WAR name:
  aceas.war

context root:
  /aceas

@ApplicationPath:
  /api

@Path:
  /cases

final:
  /aceas/api/cases
```

But context root may be configured by:

- WAR name,
- server admin deployment option,
- `application.xml`,
- server-specific descriptor,
- Maven plugin/deployment script,
- container image/server config.

Never assume WAR filename is the final context root in production.

Document it.

---

## 19. `web.xml` and Annotation Scanning

Jakarta EE server can discover components via annotations.

But `web.xml` still matters for:

- explicit servlet/filter mapping,
- security constraints,
- context params,
- listener ordering,
- legacy compatibility,
- disabling/enabling metadata scanning behavior,
- deterministic deployment.

For Jakarta REST, `@ApplicationPath` often avoids `web.xml`.

But in complex deployments, explicit descriptors can be useful.

Top-tier view:

```text
Annotations are convenient.
Deployment descriptors are governance tools.
```

Use whichever gives clearer deployment contract.

---

## 20. Classloader Model

Managed servers have sophisticated classloading.

Typical boundaries:

```text
server runtime classes
server modules
shared libraries
application EAR lib
WAR WEB-INF/lib
WAR WEB-INF/classes
```

Payara documentation describes separate class loader universes for individually deployed modules such as WARs, and class access can be affected by deployment libraries and descriptors.

WildFly uses module-based classloading.

Open Liberty uses feature-based runtime and application classloading.

Implication:

```text
The same dependency may behave differently across servers.
```

Questions:

```text
Does parent classloader win?
Does webapp classloader win?
Can app override server library?
Are server modules visible?
Are provided dependencies really provided?
Is there an isolated classloader per WAR?
Does EAR lib leak into WAR?
```

Do not debug classloading by guessing.

Log code source for critical classes.

---

## 21. Code Source Diagnostic

Add diagnostic in non-prod:

```java
public final class RuntimeDiagnostics {

    public static String codeSource(Class<?> type) {
        var source = type.getProtectionDomain().getCodeSource();
        return type.getName() + " -> " +
            (source == null ? "<unknown>" : source.getLocation().toString());
    }
}
```

Check:

```java
RuntimeDiagnostics.codeSource(jakarta.ws.rs.core.Response.class);
RuntimeDiagnostics.codeSource(jakarta.enterprise.inject.spi.CDI.class);
RuntimeDiagnostics.codeSource(jakarta.servlet.http.HttpServletRequest.class);
RuntimeDiagnostics.codeSource(org.glassfish.jersey.server.ResourceConfig.class);
```

If `ResourceConfig` exists in an app that should be portable standard Jakarta REST, ask why.

If Jakarta API classes are loaded from `WEB-INF/lib` instead of server modules, confirm this is intended.

---

## 22. Server-Specific Reality

### GlassFish

Reference implementation lineage for Jakarta EE.

Often closely aligned with Jersey.

Good for:

- spec alignment,
- learning Jakarta EE behavior,
- Jersey-native deployment patterns.

Concerns:

- production support choice,
- version lifecycle,
- vendor governance.

### Payara

Derived from GlassFish, enterprise-focused.

Often Jersey-based for REST.

Good for:

- Jakarta EE platform services,
- admin tooling,
- commercial support options,
- server-managed resources.

Concerns:

- server version compatibility,
- bundled Jersey version,
- classloader overrides,
- deployment descriptor behavior.

### Open Liberty

Feature-based runtime.

You enable only needed features.

Good for:

- Jakarta EE/MicroProfile service deployment,
- container-friendly runtime,
- explicit feature selection.

Concerns:

- feature version alignment,
- server.xml governance,
- app dependency scope.

### WildFly

Modular application server.

Typically RESTEasy for Jakarta REST/JAX-RS, not Jersey.

Good for:

- enterprise runtime,
- module system,
- managed resources,
- mature app server ecosystem.

Concern for Jersey series:

```text
If deploying to WildFly, you may not be using Jersey as implementation.
```

If you require Jersey-specific features, WildFly portability becomes a design issue.

---

## 23. Jersey-Specific Features vs Jakarta REST Portability

Jersey-specific:

```text
ResourceConfig
Jersey properties
Jersey filters/features
HK2 binders
Jersey-specific media modules
Jersey-specific tracing
```

Standard Jakarta REST:

```text
Application
@Path
@GET
@POST
@Provider
ExceptionMapper
ContainerRequestFilter
ContainerResponseFilter
MessageBodyReader/Writer
ContextResolver
```

Decision:

```text
If targeting GlassFish/Payara specifically:
  Jersey-specific features may be acceptable.

If targeting multiple Jakarta EE servers:
  avoid Jersey-specific APIs in application core.
```

A good architecture can isolate Jersey-specific bootstrap:

```text
api-standard module:
  Jakarta REST resources/providers only

deployment-payara module:
  Jersey-specific config if needed
```

---

## 24. Provider Selection in Managed Server

Managed server may already provide:

```text
JSON-B provider
JSON-P
Jackson provider maybe not
MOXy maybe depending server
Bean Validation provider
```

If you bundle Jackson provider, you need to know:

```text
Will it be picked?
Will server JSON-B still be picked?
Which MessageBodyWriter wins?
Is priority deterministic?
```

If response serialization differs across servers, provider selection may be the reason.

Production advice:

```text
Register critical providers explicitly.
Test JSON shape on target server.
Do not rely on accidental default provider if contract matters.
```

---

## 25. Bean Validation

Jakarta Bean Validation integration may be server-provided.

Example:

```java
public record CreateUserRequest(
    @NotBlank String name,
    @Email String email
) {
}
```

Resource:

```java
@POST
public Response create(@Valid CreateUserRequest request) {
    ...
}
```

Questions:

```text
Is validation provider present?
Are validation errors mapped to desired response?
Is method validation enabled?
Are custom validators CDI-injected?
```

Do not assume error response shape.

Define exception mapper for validation errors if API contract matters.

---

## 26. Managed Concurrency

Jakarta EE has managed concurrency services.

Do not casually create unmanaged threads:

```java
new Thread(...)
Executors.newFixedThreadPool(...)
```

Inside managed server, unmanaged threads can cause:

- classloader leak,
- lifecycle leak,
- security context loss,
- transaction context confusion,
- shutdown problems,
- monitoring blind spots.

Use managed executor where appropriate:

```java
@Resource
ManagedExecutorService executor;
```

or Jakarta Concurrency annotations/configuration depending platform version.

Jakarta EE 11 notes include Jakarta Concurrency 3.1 support for virtual threads in managed resources such as `@ManagedExecutorDefinition`.

Top-tier rule:

```text
In managed server, concurrency should be managed by the container unless deliberately isolated.
```

---

## 27. Scheduled Work and Background Tasks

Avoid starting background scheduler from REST resource constructor.

Bad:

```java
@ApplicationScoped
public class StartupBean {
    private final ScheduledExecutorService scheduler =
        Executors.newScheduledThreadPool(4);
}
```

Better in managed runtime:

- server-managed scheduled executor,
- EJB timer if available,
- Jakarta Concurrency,
- external scheduler,
- Kubernetes CronJob for coarse jobs.

If you must use unmanaged executor:

```text
- start/stop in lifecycle callbacks
- ensure classloader cleanup
- name threads
- handle shutdown
- document why not managed
```

---

## 28. Lifecycle: Deploy, Undeploy, Redeploy

Managed server lifecycle:

```text
deploy WAR
  ↓
scan classes/descriptors
  ↓
initialize CDI
  ↓
initialize REST application
  ↓
bind resources
  ↓
start accepting traffic
```

Undeploy:

```text
stop routing traffic
destroy app context
destroy CDI beans
close resources
release classloader
```

Redeploy risk:

```text
old classloader retained by static references
unclosed threads
unclosed JDBC drivers
unclosed HTTP clients
MBeans not unregistered
ThreadLocal leaks
```

Top-tier practice:

```text
Redeploy must be tested if your operational model uses redeploy.
```

In Kubernetes, you may avoid hot redeploy and replace container instead.

But in app server environments, redeploy leaks are real.

---

## 29. Startup Validation

Managed server deployment should fail fast if required resources are missing.

Example startup bean:

```java
@ApplicationScoped
public class StartupValidator {

    @Resource(lookup = "jdbc/AppDataSource")
    DataSource dataSource;

    public void validate(@Observes @Initialized(ApplicationScoped.class) Object event) {
        try (Connection connection = dataSource.getConnection()) {
            if (!connection.isValid(2)) {
                throw new IllegalStateException("DataSource is not valid");
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to validate datasource", e);
        }
    }
}
```

Exact startup event style may vary by CDI/server.

Principle:

```text
Validate critical dependencies before reporting ready.
```

---

## 30. Health and Readiness in Managed Server

Traditional app servers predate Kubernetes readiness semantics.

Modern deployment often needs:

```text
/health/live
/health/ready
```

Options:

- MicroProfile Health if server supports it,
- custom Jakarta REST endpoints,
- server admin health,
- Kubernetes probing app path.

For custom REST health:

```java
@Path("/health")
@ApplicationScoped
public class HealthResource {

    @GET
    @Path("/live")
    public String live() {
        return "live";
    }

    @GET
    @Path("/ready")
    public Response ready() {
        return Response.ok("ready").build();
    }
}
```

But readiness should account for:

```text
deployment complete
critical resources available
shutdown/drain state
optional dependency policy
```

If server owns deployment, readiness may need coordination with server/platform.

---

## 31. Observability

Managed server gives some built-in observability:

```text
server logs
access logs
deployment logs
thread pool metrics
connection pool metrics
JTA metrics
JVM metrics
admin console
MicroProfile Metrics possibly
```

Application still needs:

```text
structured logs
correlation IDs
domain error codes
request latency
dependency latency
audit logs
business events
OpenTelemetry/MicroProfile telemetry if available
```

Do not rely solely on server logs.

Server logs answer:

```text
What happened to runtime?
```

Application logs answer:

```text
What happened to use case?
```

Audit logs answer:

```text
What legally/business-relevant action occurred?
```

---

## 32. Access Logging

Server can provide access logs.

But format varies.

Standardize fields:

```text
timestamp
method
path
query policy
status
duration
request id
remote address
forwarded client
user/principal if safe
bytes
user agent
```

If behind reverse proxy:

```text
server direct remote address may be proxy
```

Use trusted forwarded header strategy.

For regulated systems, store enough to reconstruct request flow without exposing PII/secrets.

---

## 33. Reverse Proxy and Context Path

Common production topology:

```text
Client
  ↓
ALB / nginx / API Gateway
  ↓
Jakarta EE Server
  ↓
WAR context root
  ↓
Jakarta REST application path
```

Path rewriting risk:

```text
external:
  /aceas/api/cases

internal server:
  /api/cases

WAR context:
  /aceas

ApplicationPath:
  /api
```

If not aligned:

- 404,
- redirects wrong,
- generated links wrong,
- CORS wrong,
- cookies path wrong,
- auth callback wrong.

Document:

```text
external path
proxy rewrite
server context root
application path
resource path
```

---

## 34. Dockerizing Jakarta EE Server

Container image contains:

```text
server runtime
server config
deployed WAR
startup command
```

Compared to embedded app:

```text
embedded:
  app.jar contains server

managed:
  image contains server + app
```

Docker concerns:

```text
- server base image version
- Java runtime version
- server config layering
- deployment directory
- admin credentials
- non-root user
- health check path
- startup time
- graceful shutdown
- log routing
- config/secrets injection
```

Do not bake secrets into image.

---

## 35. Kubernetes Deployment for Jakarta EE Server

Example conceptual:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jakarta-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jakarta-api
  template:
    metadata:
      labels:
        app: jakarta-api
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: server
          image: example/jakarta-api:1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /my-service/api/health/ready
              port: 8080
          livenessProbe:
            httpGet:
              path: /my-service/api/health/live
              port: 8080
```

App server startup can be slower than embedded microservice.

Use `startupProbe` when needed.

Termination grace may need longer due to:

- server shutdown,
- pool closure,
- transaction completion,
- redeployment cleanup,
- log flush.

---

## 36. Deployment Scripts and Admin Model

Managed servers often support:

```text
admin CLI
REST admin API
deployment directory
Maven plugin
Gradle plugin
server config file
domain config
```

Examples conceptually:

```text
asadmin deploy my.war
server.xml features and apps
jboss-cli deployment
```

Production governance:

```text
- deployment must be repeatable
- server config must be versioned
- app artifact must be immutable
- environment-specific values externalized
- rollback must be practiced
```

Do not treat admin console manual deployment as production-grade release process.

---

## 37. Failure Modes

### 37.1 Server Provides Different REST Implementation

Symptom:

```text
Jersey-specific ResourceConfig not recognized
Jersey Feature not applied
HK2 binder ignored
```

Cause:

```text
server uses non-Jersey Jakarta REST implementation
```

Fix:

```text
use standard Application APIs
or target Jersey-based server
or configure server-specific override intentionally
```

---

### 37.2 Bundled Jersey Conflicts with Server REST

Symptom:

```text
NoSuchMethodError
ClassCastException
deployment failure
duplicate provider
```

Cause:

```text
WAR bundles Jersey while server already provides Jakarta REST runtime
```

Fix:

```text
remove implementation jars
use provided scope
or isolate/override per server docs
```

---

### 37.3 Namespace Mismatch

Symptom:

```text
ClassNotFoundException: javax/ws/rs/Path
or jakarta/ws/rs/Path
resources not found
```

Cause:

```text
server generation and app namespace mismatch
```

Fix:

```text
align Java EE/Jakarta EE generation
```

---

### 37.4 CDI Injection Fails in Resource

Symptom:

```text
Unsatisfied dependency
null injected field
resource constructed outside CDI
```

Cause:

```text
REST/CDI integration issue
bean discovery mode
missing bean archive
wrong scope
server-specific behavior
```

Fix:

```text
verify bean discovery
add beans.xml if needed
use CDI-managed resources
test target server
```

---

### 37.5 Transaction Annotation Does Nothing

Cause:

```text
self-invocation
method not intercepted
wrong annotation
bean not CDI-managed
private/final method issue
```

Fix:

```text
place transaction on managed service boundary
test rollback behavior
```

---

### 37.6 Redeploy Memory Leak

Causes:

```text
unmanaged thread
static reference
ThreadLocal
unclosed HTTP client
unregistered JDBC driver
MBean leak
```

Fix:

```text
use managed resources
close in @PreDestroy
avoid static singletons
test redeploy
```

---

## 38. Anti-Patterns

### Anti-Pattern 1 — Bundling Full Platform APIs and Implementations

```text
WAR contains jakartaee-api + Jersey + CDI implementation + validation implementation
```

inside full server.

Risk:

```text
classloading conflict
provider duplication
runtime confusion
```

---

### Anti-Pattern 2 — Using Jersey-Specific APIs While Claiming Server Portability

If you use:

```java
ResourceConfig
AbstractBinder
Jersey properties
```

you are coupled to Jersey.

That may be fine. Just do not claim portability.

---

### Anti-Pattern 3 — Creating Raw Threads in App Server

Unmanaged threads cause lifecycle and context leaks.

Use managed concurrency.

---

### Anti-Pattern 4 — Putting Business Authorization in Server Role Mapping Only

Roles are not enough for domain/state/entity-level authorization.

---

### Anti-Pattern 5 — Manual Admin Console Deployment in Production

It is not reproducible enough.

Use versioned deployment automation.

---

## 39. Decision Matrix

| Dimension | Jakarta EE Server Deployment |
|---|---|
| Runtime ownership | Server |
| App artifact | WAR/EAR |
| Jakarta REST | Usually server-owned |
| Jersey-specific portability | Server-dependent |
| CDI | Server-managed |
| Transactions | Server-managed possible |
| Security | Container + app |
| DB pool | Server-managed possible |
| Classloading | More complex |
| Operational model | Admin/deployment platform |
| Best for | enterprise managed runtime |
| Main strength | integrated platform services |
| Main risk | dependency/classloader/server coupling |

---

## 40. When to Choose Jakarta EE Server

Choose managed server when:

```text
- you need CDI/JTA/JPA/security/resource management integrated
- organization standardizes on Jakarta EE
- multiple enterprise APIs share platform governance
- admin/monitoring/deployment model is valuable
- server-managed datasource/transactions matter
- WAR/EAR deployment is required
- team understands server-specific behavior
```

Do not choose it when:

```text
- you only need a small REST process
- you will ignore all managed services
- Docker/Kubernetes process-per-service is enough
- embedded runtime is simpler
- server classloading adds more risk than value
```

---

## 41. Top-Tier Engineering Perspective

A basic engineer says:

```text
Deploy WAR to server.
```

A senior engineer asks:

```text
Which server owns which APIs and implementations?
```

A top-tier engineer defines:

```text
- server generation
- Java baseline
- namespace
- dependency scopes
- REST implementation ownership
- CDI/resource lifecycle
- transaction boundary
- security boundary
- context path contract
- classloader policy
- redeploy behavior
- readiness model
- observability contract
- rollback procedure
```

Managed deployment is powerful when these are explicit.

It is fragile when treated as magic.

---

## 42. Production Readiness Checklist

```text
[ ] Target server selected and version pinned.
[ ] Java runtime version supported by server.
[ ] Jakarta EE/Java EE generation identified.
[ ] javax/jakarta namespace aligned.
[ ] WAR/EAR packaging chosen deliberately.
[ ] Context root documented.
[ ] ApplicationPath documented.
[ ] REST implementation ownership known.
[ ] Jersey-specific APIs avoided or intentionally used.
[ ] Jakarta EE APIs marked provided.
[ ] Server-provided implementations not bundled accidentally.
[ ] Dependency tree reviewed.
[ ] Final WAR inspected.
[ ] CDI bean discovery verified.
[ ] REST resources CDI injection tested.
[ ] ExceptionMapper injection tested.
[ ] JSON provider behavior tested.
[ ] Validation error response tested.
[ ] Transaction rollback tested.
[ ] Datasource/JNDI resource provisioned.
[ ] Required server resources documented.
[ ] Managed executor used for background work.
[ ] No unmanaged long-lived threads.
[ ] @PreDestroy cleanup implemented where needed.
[ ] Redeploy tested if operationally used.
[ ] Health endpoints exposed.
[ ] Kubernetes probe paths include context root.
[ ] Access log strategy defined.
[ ] Correlation ID strategy implemented.
[ ] Security role mapping/domain authorization tested.
[ ] Server config versioned.
[ ] Deployment automated.
[ ] Rollback tested.
```

---

## 43. Summary

Jakarta EE Server Deployment changes the ownership model.

In embedded deployment:

```text
application owns runtime
```

In managed server deployment:

```text
server owns runtime
application participates as managed component
```

This gives access to powerful platform services:

- CDI,
- transactions,
- security,
- managed resources,
- connection pools,
- deployment lifecycle,
- admin monitoring.

But it also introduces:

- classloader complexity,
- dependency scope sensitivity,
- server-specific behavior,
- REST implementation ownership questions,
- redeploy lifecycle risks.

The key lesson:

> A Jakarta EE server is not just a place to put a WAR.  
> It is a managed runtime contract.

Top-tier engineers make that contract explicit.

---

## 44. How This Part Connects to the Next Part

This part covered managed Jakarta EE server deployment broadly.

Next:

```text
Part 15 — Tomcat Deployment: Practical Production Model
```

The mental model shifts from full platform server to servlet-only production runtime.

Tomcat does not provide full Jakarta EE platform services.

So Part 15 will focus on:

- servlet container ownership,
- application-owned Jersey,
- WAR packaging,
- Tomcat connector/thread pool,
- classloader behavior,
- access logs,
- deployment paths,
- Docker/Kubernetes Tomcat,
- practical operational tuning,
- why Tomcat is simpler than Jakarta EE server but more responsibility falls back to the app.

---

## References

- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Jakarta EE 11 release page: https://jakarta.ee/release/11/
- Jakarta EE Tutorial — Overview and Profiles: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/intro/overview/overview.html
- Jakarta CDI 4.1 specification: https://jakarta.ee/specifications/cdi/4.1/jakarta-cdi-spec-4.1
- Jakarta EE Platform specification page: https://jakarta.ee/specifications/platform/11/
- Jakarta EE Platform 8 specification — server support for application components: https://jakarta.ee/specifications/platform/8/platform-spec-8
- Payara Enterprise documentation — Class Loaders: https://docs.payara.fish/enterprise/docs/Technical%20Documentation/Application%20Development/Class%20Loaders.html
- Open Liberty guide — Creating a RESTful web service: https://openliberty.io/guides/rest-intro.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-013.md">⬅️ Part 13 — Netty-Based Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-015.md">Part 15 — Tomcat Deployment: Practical Production Model ➡️</a>
</div>
