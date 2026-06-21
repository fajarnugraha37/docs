# learn-java-eclipse-jersey-deployment-models-part-010  
# Part 10 — Embedded Grizzly Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 10 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey pada level arsitektur runtime, lifecycle, operasional, dan failure model.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: deployment Jersey sebagai aplikasi Java SE dengan embedded Grizzly HTTP server.

---

## 1. Apa Itu Embedded Grizzly Deployment Model?

Embedded Grizzly deployment adalah model di mana aplikasi Java menjalankan HTTP server sendiri di dalam proses JVM yang sama.

Model sederhananya:

```text
java -jar app.jar
```

Di dalam JVM:

```text
main()
  ├─ build ResourceConfig
  ├─ create Grizzly HTTP server
  ├─ attach Jersey runtime
  ├─ bind socket/port
  ├─ receive HTTP requests
  ├─ dispatch into Jersey resources
  └─ shutdown gracefully
```

Ini berbeda dari WAR deployment:

```text
WAR deployment:
  external servlet container owns HTTP server

Embedded Grizzly:
  application owns HTTP server
```

Pada WAR:

```text
Tomcat/Jetty/Payara starts first.
Your Jersey app is deployed into it.
```

Pada embedded Grizzly:

```text
Your main method starts first.
Your code creates the HTTP server.
```

Ini perubahan mental model yang besar.

---

## 2. Mental Model Utama

Embedded Grizzly bukan sekadar “cara menjalankan Jersey tanpa Tomcat”.

Embedded Grizzly berarti:

> aplikasi Anda bukan hanya business service, tetapi juga **runtime host**.

Artinya aplikasi harus bertanggung jawab atas:

- port binding,
- HTTP listener,
- TLS jika dipakai,
- thread pool,
- lifecycle startup,
- graceful shutdown,
- health/readiness semantics,
- logging bootstrap,
- config loading,
- dependency initialization,
- request timeout,
- connection close,
- overload behavior,
- signal handling,
- Docker/Kubernetes integration,
- error boundary saat startup,
- observability sejak proses mulai.

Pada servlet container, banyak hal ini disediakan oleh container.

Pada embedded model, kalau Anda tidak mendesainnya, maka ia tidak ada.

---

## 3. Kapan Embedded Grizzly Cocok?

Embedded Grizzly cocok ketika Anda ingin:

1. Aplikasi kecil sampai menengah yang self-contained.
2. Deployment sederhana: satu jar / satu image.
3. Tidak butuh full Jakarta EE server.
4. Kontrol penuh atas lifecycle.
5. Startup cepat dan eksplisit.
6. Integrasi mudah dengan Docker/Kubernetes.
7. REST API service yang tidak butuh servlet ecosystem luas.
8. Test harness/integration test yang menjalankan server sungguhan.
9. Tooling internal, admin service, local dev server, mock server, atau edge utility.
10. Migrasi dari monolith WAR ke service kecil dengan runtime minimal.

Embedded Grizzly kurang cocok ketika Anda butuh:

- full Jakarta EE container,
- container-managed transaction,
- full CDI managed runtime,
- JNDI resource management,
- Jakarta Security server integration,
- enterprise deployment console,
- multi-application shared container,
- standard WAR deployment governance,
- servlet filter ecosystem kompleks,
- JSP/static webapp legacy,
- ops team yang sudah standardisasi di app server.

Rule of thumb:

```text
Use embedded Grizzly when you want the application to own its runtime.

Use Servlet/Jakarta EE container when you want the platform to own runtime services.
```

---

## 4. Runtime Topology

Embedded Grizzly topology:

```text
Client
  ↓
Network socket
  ↓
Grizzly HTTP server
  ↓
Jersey-Grizzly container adapter
  ↓
Jersey server runtime
  ↓
Resource matching
  ↓
Resource method
  ↓
Provider pipeline
  ↓
Grizzly response writer
  ↓
Client
```

Layer ownership:

```text
Application owns:
  - main method
  - ResourceConfig
  - Grizzly server instance
  - Jersey runtime dependencies
  - JSON provider
  - DI integration
  - logging setup
  - shutdown behavior
  - packaging

JDK owns:
  - JVM
  - core networking primitives
  - signal behavior baseline
  - GC/runtime

OS/container owns:
  - process
  - network namespace
  - port exposure
  - file descriptors
  - cgroup resources
```

This model is clean if ownership is explicit.

It becomes dangerous if the team assumes an external container will provide missing behavior.

---

## 5. Minimal Jersey + Grizzly Application

A minimal Jersey 3.x style example:

```java
package com.example;

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

Application bootstrap:

```java
package com.example;

import java.net.URI;

import org.glassfish.grizzly.http.server.HttpServer;
import org.glassfish.jersey.grizzly2.httpserver.GrizzlyHttpServerFactory;
import org.glassfish.jersey.server.ResourceConfig;

public final class Main {

    public static void main(String[] args) throws Exception {
        URI baseUri = URI.create("http://0.0.0.0:8080/");

        ResourceConfig config = new ResourceConfig()
            .register(HelloResource.class);

        HttpServer server = GrizzlyHttpServerFactory.createHttpServer(
            baseUri,
            config
        );

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.shutdownNow();
        }, "shutdown-hook"));

        Thread.currentThread().join();
    }
}
```

This works for demonstration, but it is not production-grade.

Problems:

- no config validation,
- no structured startup phase,
- no readiness state,
- no graceful shutdown timeout,
- no logging bootstrap,
- no dependency initialization sequence,
- no lifecycle abstraction,
- no port conflict handling strategy,
- no health endpoint,
- no startup failure classification,
- no metrics,
- no TLS/security model,
- no thread pool sizing strategy,
- `Thread.currentThread().join()` is crude.

Production code needs stronger lifecycle design.

---

## 6. Jersey 2.x vs 3.x vs 4.x Imports

### Jersey 2.x / Java 8 world

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
```

Maven dependencies will generally be Jersey 2.x.

### Jersey 3.x / Jakarta world

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
```

Maven dependencies are Jersey 3.x.

### Jersey 4.x / Jakarta REST 4.0 world

Also uses Jakarta namespace:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
```

But aligns with Jakarta EE 11 / Jakarta REST 4.0 era.

Critical rule:

```text
Do not mix javax.ws.rs resources with jakarta.ws.rs runtime.
Do not mix jakarta.ws.rs resources with javax.ws.rs runtime.
```

For Grizzly embedded deployment, this matters because the app owns all Jersey jars. If you bring the wrong version, there is no external container to normalize the environment.

---

## 7. Dependencies

### 7.1 Jersey 3.x Example with Maven

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.glassfish.jersey</groupId>
      <artifactId>jersey-bom</artifactId>
      <version>${jersey.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-grizzly2-http</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
  </dependency>
</dependencies>
```

Meaning:

```text
jersey-container-grizzly2-http:
  Adapter between Grizzly HTTP server and Jersey runtime.

jersey-hk2:
  Injection/lifecycle integration for Jersey-managed resources/providers.

jersey-media-json-jackson:
  JSON MessageBodyReader/MessageBodyWriter provider.
```

### 7.2 Why BOM Matters

Do not do this casually:

```xml
jersey-server:3.1.10
jersey-hk2:3.0.8
jersey-container-grizzly2-http:3.1.2
```

All Jersey artifacts should belong to a consistent version family.

Mismatch can cause:

- `NoSuchMethodError`,
- provider discovery errors,
- injection manager errors,
- incompatible transitive dependencies,
- startup failure,
- runtime behavior differences.

Rule:

```text
Treat Jersey as a coherent runtime family.
```

---

## 8. Production Bootstrap Shape

A more production-oriented bootstrap should look like this:

```text
main()
  ├─ install early logging
  ├─ load configuration
  ├─ validate configuration
  ├─ build application dependencies
  ├─ build ResourceConfig
  ├─ build HttpServer
  ├─ start server
  ├─ mark readiness true
  ├─ wait for shutdown signal
  ├─ mark readiness false
  ├─ stop accepting traffic
  ├─ drain in-flight requests
  ├─ close server
  ├─ close dependencies
  └─ exit with meaningful status
```

The top-tier mental model:

> startup and shutdown are part of the application contract, not incidental boilerplate.

---

## 9. Configuration Model

Avoid hardcoding:

```java
URI.create("http://0.0.0.0:8080/");
```

Use explicit config:

```java
public record ServerConfig(
    String host,
    int port,
    String basePath,
    boolean tlsEnabled,
    int shutdownTimeoutSeconds
) {
    public URI baseUri() {
        String normalizedBasePath = basePath.startsWith("/")
            ? basePath
            : "/" + basePath;

        if (!normalizedBasePath.endsWith("/")) {
            normalizedBasePath = normalizedBasePath + "/";
        }

        return URI.create("http://" + host + ":" + port + normalizedBasePath);
    }
}
```

Loading from environment:

```java
public final class ConfigLoader {

    public static ServerConfig load() {
        String host = env("APP_HOST", "0.0.0.0");
        int port = intEnv("APP_PORT", 8080);
        String basePath = env("APP_BASE_PATH", "/");

        int shutdownTimeoutSeconds = intEnv("APP_SHUTDOWN_TIMEOUT_SECONDS", 20);

        return new ServerConfig(
            host,
            port,
            basePath,
            false,
            shutdownTimeoutSeconds
        );
    }

    private static String env(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private static int intEnv(String name, int defaultValue) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                "Invalid integer env var " + name + ": " + value,
                e
            );
        }
    }
}
```

Production requirements:

```text
- fail fast on invalid config
- log effective non-secret config
- never log secrets
- distinguish bind host from public base URL
- make base path explicit
- support containerized port config
```

---

## 10. Bind URI vs Public URI

Embedded services often confuse:

```text
bind URI:
  where the process listens

public URI:
  how clients reach the service
```

Example in Kubernetes:

```text
Process binds:
  http://0.0.0.0:8080/

Client reaches:
  https://api.example.com/my-service/
```

These are not the same.

Bind URI is for Grizzly:

```java
URI.create("http://0.0.0.0:8080/")
```

Public URI is for:

- generated links,
- redirects,
- OpenAPI server URL,
- audit logs,
- callback URLs,
- absolute `Location` header.

Do not infer public URI blindly from local socket when behind reverse proxy.

Use config:

```text
APP_BIND_HOST=0.0.0.0
APP_BIND_PORT=8080
APP_PUBLIC_BASE_URI=https://api.example.com/my-service/
```

Mental model:

```text
Bind URI is infrastructure-facing.
Public URI is client-facing.
```

---

## 11. ResourceConfig Design

A simple `ResourceConfig`:

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(HelloResource.class);
        register(HealthResource.class);
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
    }
}
```

Better production shape:

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication(AppComponents components) {
        register(new HealthResource(components.health()));
        register(new UserResource(components.userService()));

        register(GlobalExceptionMapper.class);
        register(RequestIdFilter.class);
        register(LoggingFilter.class);
        register(JacksonFeature.class);

        property("jersey.config.server.wadl.disableWadl", true);
    }
}
```

Design decision:

### Register classes

```java
register(UserResource.class);
```

Jersey creates instances.

Pros:

- lifecycle managed by Jersey,
- injection can work,
- clean if DI integration is set up.

Cons:

- dependency injection must be configured correctly,
- constructor injection may need binder/DI integration.

### Register instances

```java
register(new UserResource(userService));
```

Application creates instances.

Pros:

- explicit dependencies,
- simple for small embedded apps,
- no hidden injection magic,
- test-friendly.

Cons:

- lifecycle is owned by app,
- request scope semantics must be understood,
- stateful resource instances can be dangerous.

Rule:

```text
For embedded deployment, explicit construction is often clearer.
But never register mutable singleton resources accidentally.
```

---

## 12. Resource Lifecycle Warning

JAX-RS resources are often conceptually request-scoped when classes are registered. But if you register an instance:

```java
register(new UserResource(userService));
```

that object is effectively shared.

Bad:

```java
@Path("/users")
public final class UserResource {

    private String lastUserId;

    @GET
    @Path("/{id}")
    public String get(@PathParam("id") String id) {
        this.lastUserId = id;
        return lastUserId;
    }
}
```

If resource is singleton, this is unsafe.

Top-tier rule:

```text
Resource objects should be stateless.
Request state belongs in method parameters, local variables, request context, or scoped objects.
```

---

## 13. Health Endpoint

Embedded apps need their own health endpoint.

Example:

```java
@Path("/health")
public final class HealthResource {

    private final HealthState state;

    public HealthResource(HealthState state) {
        this.state = state;
    }

    @GET
    @Path("/live")
    @Produces(MediaType.TEXT_PLAIN)
    public Response live() {
        return Response.ok("live").build();
    }

    @GET
    @Path("/ready")
    @Produces(MediaType.TEXT_PLAIN)
    public Response ready() {
        if (state.isReady()) {
            return Response.ok("ready").build();
        }
        return Response.status(Response.Status.SERVICE_UNAVAILABLE)
            .entity("not ready")
            .build();
    }
}
```

Health state:

```java
public final class HealthState {
    private final AtomicBoolean ready = new AtomicBoolean(false);

    public boolean isReady() {
        return ready.get();
    }

    public void markReady() {
        ready.set(true);
    }

    public void markNotReady() {
        ready.set(false);
    }
}
```

Kubernetes mapping:

```text
livenessProbe:
  /health/live

readinessProbe:
  /health/ready

startupProbe:
  /health/live or /health/ready depending startup behavior
```

Important:

```text
Liveness answers: should process be restarted?
Readiness answers: should traffic be sent?
```

Do not make liveness depend on database unless you intentionally want database outage to restart every pod.

---

## 14. Graceful Shutdown

A production embedded server must handle SIGTERM.

Typical Kubernetes sequence:

```text
1. Kubernetes sends SIGTERM.
2. Application should mark readiness false.
3. Service endpoint is removed eventually.
4. In-flight requests should finish within grace period.
5. Server stops.
6. JVM exits.
```

Minimal shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    healthState.markNotReady();
    server.shutdownNow();
}, "shutdown-hook"));
```

Better conceptual shape:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    try {
        healthState.markNotReady();

        // allow load balancer/proxy to stop sending new traffic
        Thread.sleep(5_000);

        // then stop server
        server.shutdownNow();

        // close app dependencies
        components.close();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}, "shutdown-hook"));
```

In real production code, avoid arbitrary sleeps if your platform gives better lifecycle hooks. But in Kubernetes, a small pre-drain window is often useful if aligned with readiness probe and termination grace period.

Rule:

```text
Readiness false must happen before server shutdown.
```

Otherwise the pod may receive traffic while it is already closing.

---

## 15. Server Lifecycle Wrapper

Avoid spreading server lifecycle across `main()`.

Create a wrapper:

```java
public final class EmbeddedJerseyServer implements AutoCloseable {

    private final HttpServer server;
    private final HealthState healthState;

    public EmbeddedJerseyServer(HttpServer server, HealthState healthState) {
        this.server = server;
        this.healthState = healthState;
    }

    public void start() throws IOException {
        server.start();
        healthState.markReady();
    }

    @Override
    public void close() {
        healthState.markNotReady();
        server.shutdownNow();
    }
}
```

Bootstrap:

```java
public final class Main {

    public static void main(String[] args) throws Exception {
        ServerConfig config = ConfigLoader.load();
        HealthState health = new HealthState();

        AppComponents components = AppComponents.create(config);
        ResourceConfig resourceConfig = new ApiApplication(components, health);

        HttpServer httpServer = GrizzlyHttpServerFactory.createHttpServer(
            config.baseUri(),
            resourceConfig,
            false
        );

        EmbeddedJerseyServer server = new EmbeddedJerseyServer(httpServer, health);

        Runtime.getRuntime().addShutdownHook(new Thread(server::close, "shutdown-hook"));

        server.start();

        Thread.currentThread().join();
    }
}
```

Notice:

```java
createHttpServer(..., false)
```

This means:

```text
create server but do not start it yet
```

That allows controlled startup sequencing.

---

## 16. Startup Failure Semantics

Startup can fail at many phases:

```text
config load
config validation
dependency creation
ResourceConfig build
Jersey model validation
port bind
server start
readiness transition
```

Do not collapse all startup failures into generic stack traces.

A useful startup sequence logs phase boundaries:

```text
[STARTUP] loading config
[STARTUP] validating config
[STARTUP] initializing dependencies
[STARTUP] registering Jersey resources
[STARTUP] creating Grizzly server
[STARTUP] binding http://0.0.0.0:8080/
[STARTUP] started
[STARTUP] ready
```

When it fails:

```text
[STARTUP_FAILED] phase=bind uri=http://0.0.0.0:8080 reason=Address already in use
```

This is operationally far better than:

```text
Exception in thread "main" ...
```

Exit code rule:

```text
Startup failure:
  exit non-zero

Runtime controlled shutdown:
  exit zero

Fatal runtime corruption:
  exit non-zero
```

---

## 17. Port Binding and Address Semantics

Common bind hosts:

```text
127.0.0.1:
  local only

0.0.0.0:
  all IPv4 interfaces

localhost:
  may resolve to IPv4 or IPv6 depending environment
```

In Docker/Kubernetes, usually bind to:

```text
0.0.0.0
```

Bad container bug:

```text
App binds to 127.0.0.1 inside container.
Container port is exposed.
Service still unreachable externally.
```

Why?

Because inside container:

```text
127.0.0.1 means container loopback
```

not host/network namespace interface.

Rule:

```text
In containerized deployment, bind to 0.0.0.0 unless there is a deliberate security reason not to.
```

---

## 18. Base Path Semantics

If you create server at:

```java
URI.create("http://0.0.0.0:8080/api/")
```

and resource:

```java
@Path("/users")
```

then endpoint is:

```text
http://host:8080/api/users
```

If you create server at:

```java
URI.create("http://0.0.0.0:8080/")
```

then endpoint is:

```text
http://host:8080/users
```

This is equivalent conceptually to servlet context/mapping base path, but now your code controls it.

Avoid hiding base path in multiple places:

```text
Reverse proxy rewrites /api/service -> /
App base URI is /
Resource @Path starts with /api
```

This creates confusion.

Preferred:

```text
public path:
  /my-service

server base path:
  /my-service

resource path:
  /users
```

Or:

```text
proxy strips /my-service

server base path:
  /

resource path:
  /users

but document explicitly
```

There must be one source of truth.

---

## 19. Threading Model

Embedded Grizzly has its own threading model.

At high level:

```text
network accept/read/write
  ↓
Grizzly worker threads
  ↓
Jersey request processing
  ↓
resource method execution
```

If resource methods block:

```java
@GET
public UserDto getUser() {
    return database.findUser(); // blocking
}
```

then worker threads can be occupied.

If enough requests block, service can saturate.

Threading risks:

- slow database consumes worker threads,
- slow downstream HTTP consumes worker threads,
- slow client consumes output resources,
- large uploads consume memory/threads,
- no timeout means unbounded wait,
- thread pool too small causes queueing,
- thread pool too large causes context switching/memory pressure.

Top-tier rule:

```text
Thread pool sizing must match blocking profile and downstream timeout policy.
```

Do not tune threads without understanding blocking.

---

## 20. Virtual Threads?

For Java 21/25, virtual threads are relevant, but do not assume they magically apply.

Questions:

```text
Does Grizzly/Jersey execution path use platform threads?
Can request handling be offloaded?
Are downstream operations virtual-thread-friendly?
Are libraries blocking in a virtual-thread-compatible way?
Is pinning a concern?
Is the runtime tested under load?
```

Virtual threads are excellent for many blocking application workloads, but embedded Grizzly integration must be validated in your actual stack.

Practical advice:

```text
First build a correct platform-thread deployment.
Then experiment with virtual threads behind benchmark and failure tests.
```

Do not combine:

```text
new Java version
new Jersey major version
new embedded runtime
virtual threads
Kubernetes rollout
```

all at once.

---

## 21. Timeouts

Embedded deployment must define timeout policy explicitly.

Important timeouts:

```text
server idle timeout
request header read timeout
request body read timeout
response write timeout
downstream HTTP timeout
database query timeout
application-level deadline
shutdown drain timeout
Kubernetes terminationGracePeriodSeconds
load balancer idle timeout
```

Timeouts must be aligned.

Bad:

```text
ALB idle timeout: 60s
App request timeout: 120s
Client timeout: 30s
DB timeout: unlimited
```

This causes:

- zombie work,
- client disconnect while server keeps working,
- retry storm,
- inconsistent audit logs,
- wasted threads.

Preferred:

```text
client timeout < gateway timeout < app timeout < shutdown grace
```

But details depend on workload.

Example policy:

```text
client timeout:
  10s

reverse proxy timeout:
  15s

application request budget:
  12s

downstream HTTP timeout:
  3s connect, 5s read

database statement timeout:
  8s

shutdown grace:
  30s
```

The exact numbers matter less than the invariant:

```text
No layer should wait indefinitely.
```

---

## 22. JSON Provider Registration

If using Jackson:

```java
ResourceConfig config = new ResourceConfig()
    .register(HelloResource.class)
    .register(JacksonFeature.class);
```

Or with custom mapper:

```java
@Provider
public final class ObjectMapperProvider
        implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper;

    public ObjectMapperProvider() {
        this.mapper = new ObjectMapper()
            .findAndRegisterModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Register:

```java
register(ObjectMapperProvider.class);
register(JacksonFeature.class);
```

Failure mode:

```text
GET works
POST application/json fails
```

Usually means:

- JSON provider missing,
- provider not registered,
- wrong media type,
- DTO not deserializable,
- module reflection issue,
- shaded service file missing.

Top-tier practice:

```text
Always include a startup or integration test that performs JSON roundtrip.
```

Not just `GET /health`.

---

## 23. Exception Mapping

Embedded deployment needs consistent error boundary.

Example:

```java
@Provider
public final class GlobalExceptionMapper
        implements ExceptionMapper<Throwable> {

    @Override
    public Response toResponse(Throwable error) {
        ErrorResponse body = new ErrorResponse(
            "INTERNAL_ERROR",
            "Unexpected server error"
        );

        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .entity(body)
            .build();
    }
}
```

But do not map everything carelessly.

Better structure:

```text
ValidationExceptionMapper
NotFoundExceptionMapper
DomainExceptionMapper
AuthenticationExceptionMapper
AuthorizationExceptionMapper
UnhandledExceptionMapper
```

Important:

```text
Do not leak stack traces to clients.
Do log correlation id.
Do preserve status semantics.
Do distinguish client error vs server error.
```

---

## 24. Request Correlation

Embedded apps should install request ID handling early.

Example container request filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class RequestIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String HEADER = "X-Request-Id";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String requestId = requestContext.getHeaderString(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }
        requestContext.setProperty(HEADER, requestId);
    }

    @Override
    public void filter(
            ContainerRequestContext requestContext,
            ContainerResponseContext responseContext
    ) {
        Object requestId = requestContext.getProperty(HEADER);
        if (requestId != null) {
            responseContext.getHeaders().putSingle(HEADER, requestId.toString());
        }
    }
}
```

Register:

```java
register(RequestIdFilter.class);
```

For real observability, propagate it into logging MDC if using a logging framework.

Invariant:

```text
Every request should have a correlation id before business logic executes.
```

---

## 25. Access Logging

Servlet containers often provide access logs.

Embedded Grizzly does not automatically follow your container standard unless you configure it.

You need to decide:

```text
Where are access logs emitted?
Application logs?
Grizzly access log?
Reverse proxy logs only?
All of them?
```

Minimum fields:

```text
timestamp
method
path
status
duration
request id
remote address or forwarded client
user/subject if authenticated
bytes in/out if possible
user agent if useful
```

Be careful with:

- PII,
- tokens,
- authorization headers,
- query parameters with secrets,
- request/response body logging.

For regulated systems:

```text
Access log is operational evidence.
Application audit log is business evidence.
Do not confuse them.
```

---

## 26. Security Boundary

Embedded Grizzly security can be implemented at several layers:

```text
Reverse proxy / API gateway
  ├─ TLS termination
  ├─ mTLS
  ├─ WAF
  ├─ rate limit
  ├─ auth pre-check

Application
  ├─ auth filter
  ├─ authorization logic
  ├─ resource-level checks
  ├─ audit
  └─ response hardening
```

Do not assume “internal service” means no security.

Security decisions:

```text
- Is TLS terminated before the app?
- Does app need TLS itself?
- Are forwarded headers trusted?
- Who authenticates user/service?
- Is JWT verified locally?
- Is authorization centralized or per-resource?
- Are CORS headers needed?
- Are error responses safe?
- Are management endpoints protected?
```

Management endpoints:

```text
/health/live
/health/ready
/metrics
/admin
/debug
```

must not accidentally expose sensitive data.

---

## 27. TLS in Embedded Model

You can terminate TLS at:

```text
1. reverse proxy / load balancer
2. sidecar proxy
3. embedded Grizzly itself
```

Most cloud/Kubernetes deployments terminate TLS before the app.

Pros:

- simpler app,
- centralized certificate management,
- standard gateway policy,
- easier rotation.

Embedded TLS may be needed for:

- direct service exposure,
- mTLS between services without mesh/proxy,
- local appliance-style deployment,
- edge runtime.

If app handles TLS, it now owns:

- key store loading,
- trust store loading,
- certificate rotation,
- cipher/protocol policy,
- mTLS client cert validation,
- reload strategy,
- secret protection.

Rule:

```text
Do embedded TLS only when runtime ownership is intentional.
```

---

## 28. Docker Image Shape

For embedded Grizzly, a Docker image can be simple:

```Dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app

COPY target/app.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Better production shape:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY target/app.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", \
  "-XX:MaxRAMPercentage=75", \
  "-jar", \
  "/app/app.jar"]
```

Concerns:

```text
- non-root user
- memory percentage
- signal handling
- port exposure
- timezone if relevant
- CA certificates
- container healthcheck or Kubernetes probes
- image SBOM
- reproducible build
```

Do not put secrets into image.

---

## 29. Kubernetes Deployment Shape

Example conceptual deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jersey-grizzly-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jersey-grizzly-api
  template:
    metadata:
      labels:
        app: jersey-grizzly-api
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: example/jersey-grizzly-api:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: APP_HOST
              value: "0.0.0.0"
            - name: APP_PORT
              value: "8080"
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health/live
              port: 8080
            periodSeconds: 2
            failureThreshold: 30
```

Important:

```text
readiness should go false before shutdown.
terminationGracePeriodSeconds should exceed expected drain time.
liveness should not flap under downstream outage.
startupProbe should protect slow startup.
```

---

## 30. Fat Jar vs Thin Distribution

### Fat Jar

```text
app-all.jar
```

Pros:

- simple copy,
- simple Dockerfile,
- fewer runtime moving parts.

Cons:

- service file merge risk,
- large artifact,
- duplicate classes hidden,
- harder dependency inspection,
- shading mistakes.

### Thin Distribution

```text
app.jar
lib/*.jar
```

Pros:

- dependency layer cache-friendly,
- easier inspect,
- fewer shading problems,
- clearer runtime classpath.

Cons:

- more files,
- startup command more complex,
- distribution packaging needed.

Example:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

For production, thin distribution is often underrated because it avoids shade-related provider discovery issues.

Rule:

```text
Use fat jar only if build process validates service descriptor merge and duplicate classes.
```

---

## 31. Integration Testing Embedded Server

Embedded Grizzly is excellent for integration tests.

Test shape:

```java
class ApiIntegrationTest {

    private static HttpServer server;

    @BeforeAll
    static void start() {
        ResourceConfig config = new ApiApplication(...);
        server = GrizzlyHttpServerFactory.createHttpServer(
            URI.create("http://127.0.0.1:0/"),
            config
        );
    }

    @AfterAll
    static void stop() {
        server.shutdownNow();
    }

    @Test
    void healthShouldReturnOk() {
        // call server endpoint
    }
}
```

Challenge:

```text
How to discover actual random port?
```

In production-grade tests, wrap server start and expose bound address.

Test matrix should include:

```text
GET text response
GET JSON response
POST JSON request
validation error
exception mapper
404
method not allowed
large request if relevant
auth filter
correlation id
shutdown behavior
```

Do not rely only on resource unit tests.

Deployment bugs occur in the runtime pipeline.

---

## 32. Observability Startup Checklist

On startup log:

```text
application name
version/build commit
Java version
Jersey version if available
Grizzly version if available
bind host
bind port
base path
public base URI
active profile/environment
configured timeouts
registered resource count if available
registered provider list if practical
readiness transition
```

Do not log:

```text
password
token
private key
raw authorization header
PII-heavy config
```

A startup log should allow an operator to answer:

```text
What exactly started?
Where is it listening?
Which version?
With which deployment mode?
Is it ready?
```

---

## 33. Common Failure Modes

### 33.1 Address Already in Use

Symptom:

```text
BindException: Address already in use
```

Cause:

- port conflict,
- previous process still running,
- test did not release server,
- container port reused.

Fix:

- use configurable port,
- use random port in tests,
- shutdown server properly,
- fail fast with clear log.

---

### 33.2 Resource Not Found

Symptom:

```text
GET /api/users returns 404
```

Possible causes:

- base URI includes `/api` but test calls `/users`,
- base URI is `/` but proxy strips `/api`,
- resource class not registered,
- using package scanning with wrong package,
- namespace mismatch,
- resource method path mismatch.

Diagnosis:

```text
Check base URI
Check ResourceConfig registration
Check actual request path
Check generated resource model if available
```

---

### 33.3 JSON Provider Missing

Symptom:

```text
MessageBodyWriter not found
```

Causes:

- no JSON media dependency,
- missing registration,
- service descriptor lost in fat jar,
- incompatible provider,
- module reflection issue.

Fix:

```text
Add provider dependency
Register JacksonFeature or provider
Test POST/GET JSON
Inspect fat jar META-INF/services
```

---

### 33.4 Application Starts but Kubernetes Readiness Fails

Causes:

- bound to `127.0.0.1`,
- readiness endpoint path wrong,
- base path mismatch,
- app marks ready too late/never,
- startupProbe missing,
- service mesh/proxy issue.

Fix:

```text
Bind to 0.0.0.0
Align probe path
Separate live and ready
Log readiness transition
```

---

### 33.5 Shutdown Drops Requests

Causes:

- `shutdownNow()` immediately kills active work,
- readiness not set false before shutdown,
- termination grace too short,
- proxy keeps sending traffic,
- no preStop/readiness drain.

Fix:

```text
Mark not ready first
Wait for drain window
Use graceful shutdown if available/appropriate
Align Kubernetes grace period
Test termination under load
```

---

## 34. Anti-Patterns

### Anti-Pattern 1 — Demo Main in Production

```java
server.start();
System.in.read();
server.shutdownNow();
```

Fine for tutorials. Weak for production.

Problems:

- no signal handling,
- no readiness,
- no lifecycle abstraction,
- no structured shutdown,
- no config validation.

---

### Anti-Pattern 2 — Package Scanning Everything

```java
packages("com.example");
```

Risk:

- accidental provider registration,
- startup slowdown,
- unexpected resources exposed,
- test/prod difference,
- module path issues.

Prefer explicit registration for critical services.

---

### Anti-Pattern 3 — Registering Mutable Resource Instances

```java
register(new StatefulResource());
```

Risk:

- shared mutable state,
- concurrency bugs,
- cross-request leakage.

---

### Anti-Pattern 4 — Health Endpoint Checks Everything

```text
/health/live checks DB, Redis, Kafka, downstream APIs
```

Risk:

- dependency outage restarts all pods,
- restart storm,
- outage amplification.

Better:

```text
live:
  process is alive

ready:
  app can serve traffic

deep health:
  diagnostic endpoint protected/internal
```

---

### Anti-Pattern 5 — No Artifact Inspection

```text
works locally
fails in Docker
```

because final jar lost service descriptors or contains wrong dependencies.

Always inspect final artifact.

---

## 35. Production-Grade Bootstrap Example

Below is a simplified but more serious skeleton.

```java
package com.example;

import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

import org.glassfish.grizzly.http.server.HttpServer;
import org.glassfish.jersey.grizzly2.httpserver.GrizzlyHttpServerFactory;
import org.glassfish.jersey.server.ResourceConfig;

public final class Main {

    public static void main(String[] args) {
        int exitCode = new Main().run();
        System.exit(exitCode);
    }

    private int run() {
        CountDownLatch shutdownLatch = new CountDownLatch(1);

        try {
            log("loading config");
            ServerConfig config = ConfigLoader.load();

            log("creating health state");
            HealthState healthState = new HealthState();

            log("creating components");
            AppComponents components = AppComponents.create(config);

            log("building ResourceConfig");
            ResourceConfig resourceConfig = new ApiApplication(components, healthState);

            URI baseUri = config.baseUri();
            log("creating server at " + baseUri);

            HttpServer httpServer = GrizzlyHttpServerFactory.createHttpServer(
                baseUri,
                resourceConfig,
                false
            );

            EmbeddedJerseyServer server = new EmbeddedJerseyServer(
                httpServer,
                healthState,
                components
            );

            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                log("shutdown signal received");
                server.close();
                shutdownLatch.countDown();
            }, "shutdown-hook"));

            log("starting server");
            server.start();

            log("started and ready");

            shutdownLatch.await();

            log("shutdown completed");
            return 0;
        } catch (Throwable error) {
            error.printStackTrace();
            return 1;
        }
    }

    private static void log(String message) {
        System.out.println("[APP] " + message);
    }
}
```

Server wrapper:

```java
public final class EmbeddedJerseyServer implements AutoCloseable {

    private final HttpServer server;
    private final HealthState healthState;
    private final AppComponents components;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    public EmbeddedJerseyServer(
            HttpServer server,
            HealthState healthState,
            AppComponents components
    ) {
        this.server = server;
        this.healthState = healthState;
        this.components = components;
    }

    public void start() throws Exception {
        server.start();
        healthState.markReady();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        healthState.markNotReady();

        try {
            server.shutdownNow();
        } finally {
            components.close();
        }
    }
}
```

Health state:

```java
public final class HealthState {

    private final AtomicBoolean ready = new AtomicBoolean(false);

    public boolean isReady() {
        return ready.get();
    }

    public void markReady() {
        ready.set(true);
    }

    public void markNotReady() {
        ready.set(false);
    }
}
```

ResourceConfig:

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication(AppComponents components, HealthState healthState) {
        register(new HealthResource(healthState));
        register(new HelloResource());

        register(GlobalExceptionMapper.class);
        register(RequestIdFilter.class);
        register(JacksonFeature.class);

        property("jersey.config.server.wadl.disableWadl", true);
    }
}
```

This is still simplified, but it has the right shape.

---

## 36. Deployment Decision Matrix

| Question | Embedded Grizzly Answer |
|---|---|
| Who owns HTTP server? | Application |
| Who owns Jersey runtime? | Application |
| Who owns Servlet API? | Usually irrelevant unless servlet integration used elsewhere |
| Artifact type | Fat jar, thin distribution, or container image |
| Best for | Small/medium self-contained REST services |
| Main strength | Runtime control and simplicity |
| Main risk | Missing platform services usually provided by container |
| Classloader model | Simpler than WAR, but packaging risks remain |
| Operational requirement | Strong lifecycle, health, shutdown, config |
| Kubernetes fit | Good if readiness/shutdown are designed |
| Enterprise fit | Good for service-style deployment, weaker for full Jakarta EE platform needs |

---

## 37. Top-Tier Engineering Perspective

A basic engineer asks:

```text
How do I start Jersey with Grizzly?
```

A senior engineer asks:

```text
Who owns the runtime lifecycle?
What does readiness mean?
How do we stop safely?
What happens if binding fails?
What happens if JSON provider is missing?
What is the timeout budget?
What thread pool handles blocking work?
How do we test the real artifact?
How do we diagnose classpath problems?
How do we run under Kubernetes?
How do we know which version is serving traffic?
```

A top-tier engineer goes further:

```text
Can this deployment model fail safely under partial outage?
Can it be rolled back?
Can it be observed from process start to shutdown?
Can it reject traffic before corruption?
Can it avoid retry storms?
Can it prove which artifact and config were active?
Can it be upgraded from Java 17 to 21/25 without uncontrolled blast radius?
```

Embedded Grizzly is powerful because it is explicit.

But explicit power means explicit responsibility.

---

## 38. Production Readiness Checklist

```text
[ ] Java runtime version pinned.
[ ] Jersey version family aligned via BOM or equivalent.
[ ] Grizzly container adapter included.
[ ] Injection dependency included if needed.
[ ] JSON provider included and tested.
[ ] No mixed javax/jakarta namespace.
[ ] ResourceConfig uses explicit registration for critical resources/providers.
[ ] Config loading fails fast.
[ ] Bind host and port configurable.
[ ] Public base URI separated from bind URI.
[ ] Health live and ready endpoints exist.
[ ] Readiness false before shutdown.
[ ] Shutdown hook installed.
[ ] Termination grace tested.
[ ] Docker image runs as non-root.
[ ] App binds to 0.0.0.0 in container.
[ ] Kubernetes probes aligned with app paths.
[ ] Startup logs include version, Java, port, base path.
[ ] Request correlation ID installed.
[ ] Error responses do not leak stack traces.
[ ] JSON roundtrip integration test exists.
[ ] Final artifact inspected.
[ ] Service descriptors preserved if fat jar.
[ ] Duplicate classes checked.
[ ] Timeout policy documented.
[ ] Threading/blocking profile understood.
[ ] Rollback artifact available.
```

---

## 39. Summary

Embedded Grizzly deployment is one of the cleanest ways to run Jersey outside a servlet container.

Its essence:

```text
Jersey handles REST.
Grizzly handles HTTP.
Your application owns lifecycle.
```

This model gives:

- simple process model,
- explicit startup,
- explicit dependencies,
- easy Docker packaging,
- direct integration testing,
- less container magic.

But it requires you to own:

- config,
- health,
- shutdown,
- thread/timeout policy,
- security boundary,
- observability,
- packaging correctness,
- upgrade discipline.

The right mental model:

> Embedded Grizzly is not “less deployment”.  
> It is **deployment responsibility moved into your application**.

---

## 40. How This Part Connects to the Next Part

This part covered Jersey with **Grizzly** as embedded Java SE HTTP runtime.

Next:

```text
Part 11 — Embedded Jetty Deployment Model
```

Jetty changes the conversation because it can act both as:

```text
external servlet container
```

and:

```text
embedded HTTP/Servlet runtime
```

So Part 11 will compare:

- embedded Jetty as server,
- servlet handler model,
- Jersey servlet integration inside embedded Jetty,
- Jetty thread pool/connectors,
- HTTP/2/TLS considerations,
- operational trade-off vs Grizzly.

---

## References

- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Eclipse Jersey documentation — Getting Started examples using Grizzly: https://eclipse-ee4j.github.io/jersey.github.io/documentation/3.0.0/user-guide.html
- Eclipse Jersey documentation — Modules and Dependencies: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/modules-and-dependencies.html
- Eclipse Jersey 3.1.x User Guide: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/index.html
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-009.md">⬅️ Part 9 — Classpath, Module Path, JPMS, dan Split-Package Problem</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-011.md">Part 11 — Embedded Jetty Deployment Model ➡️</a>
</div>
