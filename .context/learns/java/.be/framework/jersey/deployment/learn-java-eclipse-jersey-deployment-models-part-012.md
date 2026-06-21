# learn-java-eclipse-jersey-deployment-models-part-012  
# Part 12 — JDK HTTP Server and Lightweight Deployment

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 12 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey pada level runtime, dependency ownership, lifecycle, operational boundary, dan failure model.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: deployment Jersey memakai **JDK built-in HTTP server** melalui `jersey-container-jdk-http`.

---

## 1. Apa Itu JDK HTTP Server Deployment Model?

JDK HTTP Server deployment model adalah model ketika Jersey dijalankan di atas HTTP server ringan bawaan JDK, yaitu API di package:

```java
com.sun.net.httpserver
```

Sejak Java SE 6, JDK menyediakan HTTP server sederhana yang dapat dipakai untuk embedded HTTP server. Pada Java 9+, API ini berada dalam module:

```text
jdk.httpserver
```

Jersey menyediakan integrasi melalui modul:

```text
jersey-container-jdk-http
```

dan factory:

```java
org.glassfish.jersey.jdkhttp.JdkHttpServerFactory
```

Mental model sederhananya:

```text
main()
  ├─ build ResourceConfig
  ├─ call JdkHttpServerFactory.createHttpServer(...)
  ├─ JDK HttpServer listens on host/port
  ├─ Jersey handles JAX-RS/Jakarta REST resources
  └─ application stops server explicitly
```

Topology:

```text
Client
  ↓
JDK HttpServer
  ↓
Jersey JDK HTTP container adapter
  ↓
Jersey runtime
  ↓
Resource method
  ↓
MessageBodyWriter
  ↓
Client
```

Ini adalah model embedded Java SE yang lebih minimal dibanding Grizzly atau Jetty.

---

## 2. Mental Model Utama

JDK HTTP Server deployment adalah:

> model paling ringan untuk menjalankan Jersey tanpa servlet container dan tanpa embedded HTTP server eksternal seperti Grizzly/Jetty.

Namun ringan tidak berarti otomatis cocok untuk production.

Lebih tepat:

```text
JDK HTTP Server = minimal built-in HTTP host.
Jersey = REST runtime.
Application = lifecycle owner.
```

Ia cocok untuk:

- local development,
- test harness,
- internal tool,
- admin endpoint sederhana,
- mock/stub server,
- educational runtime,
- embedded utility,
- controlled low-traffic internal service.

Ia tidak otomatis cocok untuk:

- high-throughput public API,
- complex TLS/mTLS deployment,
- HTTP/2/HTTP/3 needs,
- advanced connector tuning,
- mature servlet filter chain,
- complex observability/access logging,
- high-volume file upload/download,
- strict reverse proxy integration,
- production edge service.

Top-tier engineer tidak bertanya:

```text
"Apakah bisa jalan?"
```

Tetapi:

```text
"Apakah runtime ini punya operational capability yang cukup untuk failure model saya?"
```

---

## 3. Kenapa Model Ini Ada?

Karena tidak semua Jersey application butuh app server.

Kadang Anda hanya butuh:

```text
- expose small REST endpoint
- run inside integration test
- start mock service quickly
- build internal CLI tool with HTTP control plane
- run lightweight diagnostics endpoint
- avoid external container dependency
```

JDK HTTP Server memberi baseline embedded HTTP server yang sudah ada di JDK.

Jersey memberi JAX-RS/Jakarta REST programming model di atasnya.

Kombinasi ini menarik karena dependency eksternal untuk HTTP server bisa dikurangi.

Tetapi konsekuensinya:

```text
Anda memakai HTTP server sederhana.
Bukan full production-grade web server ecosystem.
```

---

## 4. JDK HTTP Server Bukan Servlet Container

Ini sangat penting.

JDK HTTP Server bukan:

```text
Tomcat
Jetty Servlet Container
Undertow Servlet
GlassFish
Payara
Open Liberty
WildFly
```

Ia tidak memberi servlet model seperti:

```text
ServletContext
ServletConfig
FilterChain
HttpServletRequest
HttpServletResponse
web.xml
Servlet security model
Servlet session management
Servlet async model
WAR deployment
```

Jadi jangan mencari:

```java
jakarta.servlet.Filter
jakarta.servlet.http.HttpServletRequest
```

dalam deployment ini.

Yang tersedia di JDK HTTP Server adalah konsep seperti:

```text
HttpServer
HttpContext
HttpHandler
HttpExchange
Authenticator
Filter
HttpsServer
HttpsConfigurator
```

Jersey container adapter menerjemahkan HTTP exchange dari JDK server ke Jersey request processing model.

---

## 5. JDK HTTP Server vs Servlet Filter

JDK HTTP Server punya konsep filter sendiri:

```java
com.sun.net.httpserver.Filter
```

Ini bukan:

```java
jakarta.servlet.Filter
```

Perbedaannya fundamental:

```text
JDK HTTP filter:
  part of jdk.httpserver API

Servlet filter:
  part of Servlet API / Jakarta Servlet
```

Jangan campur mental model.

Kalau Anda butuh servlet filter ecosystem, gunakan:

```text
embedded Jetty Servlet
Tomcat
external Servlet container
Jakarta EE server
```

Bukan JDK HTTP Server.

---

## 6. Minimal Jersey + JDK HTTP Server

Contoh Jersey 3.x / Jakarta style resource:

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

Bootstrap:

```java
package com.example;

import java.net.URI;

import com.sun.net.httpserver.HttpServer;

import org.glassfish.jersey.jdkhttp.JdkHttpServerFactory;
import org.glassfish.jersey.server.ResourceConfig;

public final class Main {

    public static void main(String[] args) {
        URI baseUri = URI.create("http://0.0.0.0:8080/");

        ResourceConfig config = new ResourceConfig()
            .register(HelloResource.class);

        HttpServer server = JdkHttpServerFactory.createHttpServer(
            baseUri,
            config
        );

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(0);
        }, "shutdown-hook"));

        System.out.println("Started at " + baseUri);
    }
}
```

Endpoint:

```text
GET http://localhost:8080/hello
```

This is intentionally simple.

For production-grade deployment, this is incomplete.

---

## 7. Dependencies

### 7.1 Jersey 3.x Style Maven

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
    <artifactId>jersey-container-jdk-http</artifactId>
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
jersey-container-jdk-http:
  adapts JDK HttpServer to Jersey.

jersey-hk2:
  Jersey injection/lifecycle integration.

jersey-media-json-jackson:
  JSON entity provider.
```

### 7.2 Java Module Dependency

If using JPMS, you may need:

```java
module com.example.app {
    requires jdk.httpserver;
    requires jakarta.ws.rs;
    requires org.glassfish.jersey.server;
    requires org.glassfish.jersey.container.jdk.http;

    exports com.example;
}
```

Exact module names depend on actual artifacts and automatic module metadata.

Do not assume without verifying:

```bash
jar --describe-module --file your-jar.jar
```

or inspecting module descriptors.

---

## 8. Java 8 to Java 25 Considerations

### Java 8

JDK HTTP Server exists.

Typical universe:

```text
Java 8
Jersey 2.x
javax.ws.rs
classpath
```

Imports:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

### Java 11

`jdk.httpserver` is a JDK module.

If running modularized app, explicitly require:

```text
jdk.httpserver
```

Jersey 2.x or 3.x depending migration state.

### Java 17

Good modern baseline for Jakarta era.

Use:

```text
Jersey 3.x or 4.x depending target
jakarta.ws.rs
```

### Java 21/25

Modern LTS targets.

Validate:

- Jersey major version,
- `jdk.httpserver` module presence in runtime image,
- jlink custom runtime includes `jdk.httpserver`,
- observability agent compatibility,
- container base image,
- build `--release`,
- native image if attempted separately.

Important with jlink:

```text
If you build custom runtime image and forget jdk.httpserver,
JDK HTTP Server deployment will fail.
```

---

## 9. `javax.*` vs `jakarta.*`

Same rule as every Jersey deployment model:

```text
Jersey 2.x:
  javax.ws.rs.*

Jersey 3.x/4.x:
  jakarta.ws.rs.*
```

Wrong example:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

with Jersey 3.x runtime.

Jersey 3.x will look for:

```java
jakarta.ws.rs.Path
```

and your resource may not be recognized.

Correct Jersey 3.x resource:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
```

Because JDK HTTP Server model is application-owned, there is no container to mediate this mismatch.

Your dependency graph must be coherent.

---

## 10. Base URI Semantics

When you create:

```java
URI.create("http://0.0.0.0:8080/")
```

and resource:

```java
@Path("/users")
```

endpoint:

```text
/users
```

If base URI:

```java
URI.create("http://0.0.0.0:8080/api/")
```

then:

```text
/api/users
```

This base URI acts like application root.

But be careful:

```text
bind address != public address
```

In Docker/Kubernetes:

```text
bind:
  http://0.0.0.0:8080/

public:
  https://api.example.com/my-service/
```

Do not use local bind URI as public URI for generated links.

Use explicit config:

```text
APP_BIND_HOST=0.0.0.0
APP_BIND_PORT=8080
APP_BASE_PATH=/
APP_PUBLIC_BASE_URI=https://api.example.com/my-service/
```

---

## 11. Bind Host: `localhost`, `127.0.0.1`, `0.0.0.0`

Inside containers, this matters.

```text
127.0.0.1:
  only loopback inside container/process namespace

0.0.0.0:
  all IPv4 interfaces

localhost:
  may resolve to IPv4 or IPv6 depending environment
```

For Docker/Kubernetes services:

```text
Bind to 0.0.0.0
```

unless intentionally local-only.

Bad:

```java
URI.create("http://localhost:8080/")
```

inside container.

Symptom:

```text
App says started.
Kubernetes probe cannot connect.
Service unreachable.
```

Fix:

```java
URI.create("http://0.0.0.0:8080/")
```

and expose port correctly.

---

## 12. Backlog Parameter

JDK `HttpServer` creation can include a backlog.

At lower level:

```java
HttpServer.create(new InetSocketAddress(host, port), backlog);
```

Backlog roughly relates to queued incoming TCP connections waiting to be accepted.

In Jersey factory usage, you may not always control every low-level server parameter unless using available overloads or manual setup.

Operationally:

```text
backlog too low:
  connection refusal under burst

backlog too high:
  may hide overload temporarily
```

But for serious production tuning, JDK HTTP Server has fewer controls than Jetty/Netty/Grizzly.

That is part of its trade-off.

---

## 13. Executor Model

JDK `HttpServer` can use an executor:

```java
server.setExecutor(executor);
```

If executor is `null`, implementation uses a default executor.

For production-like use, do not leave it implicit.

Example:

```java
ExecutorService executor = Executors.newFixedThreadPool(
    32,
    runnable -> {
        Thread thread = new Thread(runnable);
        thread.setName("jdk-http-" + thread.threadId());
        thread.setDaemon(false);
        return thread;
    }
);

server.setExecutor(executor);
```

But if Jersey factory creates and starts the server for you, you need to ensure you can configure executor before start. Use factory overloads or create server with `start=false` if available in your Jersey version, then set executor, then start.

Conceptual shape:

```java
HttpServer server = JdkHttpServerFactory.createHttpServer(
    baseUri,
    resourceConfig,
    false
);

server.setExecutor(executor);
server.start();
```

Threading concerns:

```text
- blocking resource methods occupy executor threads
- slow downstreams consume threads
- no executor sizing means unpredictable default
- too many threads can cause memory/context switching
- too few threads can cause queueing and timeouts
```

Rule:

```text
Never deploy JDK HTTP Server with unknown executor behavior in serious environments.
```

---

## 14. Virtual Threads

On Java 21/25, you may consider:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
server.setExecutor(executor);
```

This can be attractive for blocking Jersey resources.

But validate:

```text
- Does your Jersey/JDK HTTP integration work correctly with virtual threads?
- Are downstream libraries virtual-thread-friendly?
- Are blocking operations actually unpinned?
- Does observability handle virtual thread volume?
- Does load test show improvement?
```

Virtual threads reduce the cost of blocking concurrency, but they do not fix:

- missing timeouts,
- downstream saturation,
- database pool limits,
- memory-heavy request bodies,
- bad retry storms,
- synchronized bottlenecks,
- CPU-bound work.

Top-tier rule:

```text
Virtual threads improve concurrency mechanics.
They do not replace overload control.
```

---

## 15. Lifecycle: Start, Ready, Stop

A minimal lifecycle:

```text
create server
start server
stop on shutdown
```

A production-quality lifecycle:

```text
load config
validate config
initialize dependencies
build ResourceConfig
create server without starting
configure executor
register shutdown hook
start server
mark ready
wait for shutdown
mark not ready
stop accepting new work
stop server
shutdown executor
close dependencies
exit
```

Use a lifecycle wrapper.

```java
public final class LightweightJerseyServer implements AutoCloseable {

    private final HttpServer server;
    private final ExecutorService executor;
    private final HealthState healthState;
    private final AppComponents components;

    public LightweightJerseyServer(
            HttpServer server,
            ExecutorService executor,
            HealthState healthState,
            AppComponents components
    ) {
        this.server = server;
        this.executor = executor;
        this.healthState = healthState;
        this.components = components;
    }

    public void start() {
        server.start();
        healthState.markReady();
    }

    @Override
    public void close() {
        healthState.markNotReady();

        try {
            server.stop(0);
        } finally {
            executor.shutdown();
            components.close();
        }
    }
}
```

But `server.stop(0)` stops immediately.

See shutdown section for delay semantics.

---

## 16. Shutdown Semantics

JDK `HttpServer.stop(int delay)` takes delay in seconds.

Conceptually:

```text
stop accepting new exchanges
wait up to delay seconds for current handlers
then close connections
```

Example:

```java
server.stop(10);
```

This gives in-flight work some time.

Shutdown sequence:

```text
SIGTERM
  ↓
mark readiness false
  ↓
optional drain wait
  ↓
server.stop(delaySeconds)
  ↓
executor.shutdown()
  ↓
close app components
```

Important Kubernetes alignment:

```text
terminationGracePeriodSeconds > drain wait + server stop delay + dependency close time
```

Bad:

```text
terminationGracePeriodSeconds=10
server.stop(30)
```

Kubernetes may kill process before graceful stop completes.

---

## 17. Readiness and Liveness

Health resource:

```java
@Path("/health")
public final class HealthResource {

    private final HealthState healthState;

    public HealthResource(HealthState healthState) {
        this.healthState = healthState;
    }

    @GET
    @Path("/live")
    @Produces(MediaType.TEXT_PLAIN)
    public String live() {
        return "live";
    }

    @GET
    @Path("/ready")
    @Produces(MediaType.TEXT_PLAIN)
    public Response ready() {
        if (healthState.isReady()) {
            return Response.ok("ready").build();
        }

        return Response.status(Response.Status.SERVICE_UNAVAILABLE)
            .entity("not ready")
            .build();
    }
}
```

HealthState:

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

Do not make liveness depend on every downstream dependency.

Bad:

```text
/health/live fails if DB fails
```

This causes restart storms during dependency outages.

Better:

```text
live:
  process event loop/runtime alive

ready:
  app should receive traffic

deep:
  protected diagnostic dependency status
```

---

## 18. ResourceConfig Pattern

Use explicit registration.

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication(AppComponents components, HealthState healthState) {
        register(new HealthResource(healthState));
        register(new UserResource(components.userService()));

        register(GlobalExceptionMapper.class);
        register(RequestIdFilter.class);
        register(JacksonFeature.class);

        property("jersey.config.server.wadl.disableWadl", true);
    }
}
```

Avoid broad scanning:

```java
packages("com.example");
```

unless you control package contents carefully.

Why?

In lightweight deployment, explicitness matters:

```text
- startup faster
- fewer accidental providers
- easier debugging
- predictable artifact behavior
- better native/custom runtime compatibility
```

---

## 19. Resource Instance Warning

If you register instances:

```java
register(new UserResource(userService));
```

they may be shared.

Do not keep request state in resource fields.

Bad:

```java
@Path("/users")
public final class UserResource {

    private String currentUser;

    @GET
    public String get(@HeaderParam("X-User") String user) {
        this.currentUser = user;
        return currentUser;
    }
}
```

Concurrent requests can corrupt state.

Good:

```java
@GET
public String get(@HeaderParam("X-User") String user) {
    return user;
}
```

Rule:

```text
JAX-RS resources should be stateless unless lifecycle scope is explicitly understood.
```

---

## 20. JSON Provider

JDK HTTP Server only handles HTTP.

Jersey/provider handles JSON.

Add:

```text
jersey-media-json-jackson
```

Register:

```java
register(JacksonFeature.class);
```

Custom mapper:

```java
@Provider
public final class ObjectMapperProvider
        implements ContextResolver<ObjectMapper> {

    private final ObjectMapper mapper = new ObjectMapper()
        .findAndRegisterModules()
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Register:

```java
register(ObjectMapperProvider.class);
```

Test:

```text
GET JSON
POST JSON
invalid JSON
date/time serialization
unknown fields if relevant
validation errors
```

Do not consider deployment valid just because `/health/live` works.

---

## 21. Exception Mapping

Use explicit exception mappers.

```java
@Provider
public final class DomainExceptionMapper
        implements ExceptionMapper<DomainException> {

    @Override
    public Response toResponse(DomainException error) {
        return Response.status(422)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .entity(new ErrorResponse(error.code(), error.safeMessage()))
            .build();
    }
}
```

Unhandled mapper:

```java
@Provider
public final class UnhandledExceptionMapper
        implements ExceptionMapper<Throwable> {

    @Override
    public Response toResponse(Throwable error) {
        // log with request id, but do not leak stack trace
        return Response.status(500)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .entity(new ErrorResponse("INTERNAL_ERROR", "Unexpected server error"))
            .build();
    }
}
```

Important:

```text
Map domain errors intentionally.
Do not hide all errors as 500.
Do not leak stack traces.
Log correlation ID.
```

---

## 22. Request Correlation

Use Jersey filters:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class RequestIdFilter
        implements ContainerRequestFilter, ContainerResponseFilter {

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

For real logging:

```text
propagate request id into MDC
clear MDC after response
include request id in errors/access logs
```

If using virtual threads, validate MDC/logging context propagation.

---

## 23. Access Logging Limitations

JDK HTTP Server does not provide the same mature access logging model as Jetty/Tomcat/nginx out of the box.

Options:

```text
1. Access log at reverse proxy.
2. Jersey request/response filter.
3. JDK HTTP filter.
4. Custom wrapper.
```

A Jersey filter can log:

```text
method
path
status
duration
request id
```

But be careful with:

- request body logging,
- response body logging,
- streaming responses,
- exceptions before Jersey pipeline,
- low-level connection failures.

For production edge traffic, prefer access logging at gateway/proxy plus application-level structured request logging.

---

## 24. Security Boundary

JDK HTTP Server has basic support concepts like authenticator, but it is not a full enterprise security platform.

For serious APIs, security is usually layered:

```text
Gateway / reverse proxy:
  TLS termination
  WAF/rate limit
  mTLS if needed
  coarse authentication

Application:
  JWT/service token verification
  authorization
  audit
  domain permission enforcement
```

Management endpoints:

```text
/health
/metrics
/admin
/debug
```

must be explicitly protected or intentionally public.

Health endpoints can be public internally, but never expose sensitive diagnostic details.

Rule:

```text
Lightweight HTTP server does not mean lightweight security model.
```

---

## 25. TLS with HttpsServer

JDK provides:

```java
com.sun.net.httpserver.HttpsServer
```

It uses:

```java
HttpsConfigurator
SSLContext
```

Jersey factory overloads may create an `HttpsServer` when given SSL context, depending on version/API.

However, embedded TLS means the app owns:

- key store,
- trust store,
- certificate rotation,
- protocol/cipher policy,
- mTLS validation,
- secret loading,
- reload behavior,
- operational incident handling.

In most Kubernetes/cloud setups, prefer:

```text
TLS at ingress/load balancer/service mesh
HTTP internally to app
```

Use embedded HTTPS when:

```text
- direct exposure is required
- no gateway exists
- mTLS must terminate inside app
- appliance/on-prem deployment
- special compliance boundary
```

Do not implement TLS casually in app just because `HttpsServer` exists.

---

## 26. Request Size and Slow Client Risk

JDK HTTP Server is simple.

Be careful with:

```text
large request bodies
slow uploads
slow downloads
unbounded JSON parsing
streaming responses
multipart upload
```

Protection layers:

```text
reverse proxy body size limit
application-level body validation
JSON parser constraints
timeout policy
executor sizing
rate limiting
```

JDK HTTP Server gives fewer high-level knobs than production HTTP servers.

If you need advanced request control, consider:

```text
Jetty
Netty
Undertow
Tomcat
gateway-level enforcement
```

---

## 27. Timeout Model

You still need timeouts:

```text
client timeout
reverse proxy timeout
application request budget
downstream HTTP timeout
database query timeout
server shutdown delay
executor queue behavior
```

Do not leave downstream calls unlimited:

```java
httpClient.send(request, BodyHandlers.ofString());
```

without timeout.

Use:

```java
HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(5))
    .build();
```

Database:

```text
statement timeout
transaction timeout
connection pool timeout
```

JDK HTTP Server cannot save you from downstream waits.

---

## 28. Overload Model

Overload happens when:

```text
incoming work > processing capacity
```

For JDK HTTP Server deployment, capacity is constrained by:

- executor threads,
- request processing time,
- downstream pool sizes,
- CPU,
- memory,
- file descriptors,
- request body sizes.

If executor has fixed threads and unbounded queue, overload becomes latency explosion.

If executor rejects tasks, clients fail fast.

Better fail fast than die slowly.

A production-minded executor:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    16,
    64,
    60,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    namedThreadFactory("jdk-http"),
    new ThreadPoolExecutor.AbortPolicy()
);
```

But behavior on rejected execution must be tested with JDK HTTP Server/Jersey integration.

Rule:

```text
Overload policy is architecture, not tuning detail.
```

---

## 29. Docker Deployment

Simple Dockerfile:

```Dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app

COPY target/app.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Better:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY target/app.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

If using `jlink`, ensure:

```text
jdk.httpserver module included
```

Example conceptual jlink:

```bash
jlink \
  --add-modules java.base,java.logging,jdk.httpserver \
  --output runtime
```

But real module list depends on Jersey, JSON provider, logging, and your app.

---

## 30. Kubernetes Deployment

Example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jersey-jdk-http-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: jersey-jdk-http-api
  template:
    metadata:
      labels:
        app: jersey-jdk-http-api
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: example/jersey-jdk-http-api:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: APP_BIND_HOST
              value: "0.0.0.0"
            - name: APP_BIND_PORT
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

Caution:

```text
JDK HTTP Server can run in Kubernetes,
but that does not make it equivalent to Jetty/Tomcat/Netty for demanding workloads.
```

Use only when operational needs match runtime capability.

---

## 31. Integration Testing

JDK HTTP Server is useful for integration tests.

Test shape:

```java
class ApiIntegrationTest {

    private HttpServer server;
    private URI baseUri;

    @BeforeEach
    void start() {
        baseUri = URI.create("http://127.0.0.1:0/");
        ResourceConfig config = new ApiApplication(...);

        server = JdkHttpServerFactory.createHttpServer(
            baseUri,
            config,
            false
        );

        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }
}
```

Challenge:

```text
port 0 / actual bound port retrieval
```

Depending on factory/server access, retrieving actual bound address may require manual server creation or version-specific support.

Test cases:

```text
GET /health/live
GET /health/ready
GET JSON endpoint
POST JSON endpoint
invalid JSON
exception mapping
404
method not allowed
request id propagation
shutdown
```

Do not test only resource class methods.

Deployment bugs live in the pipeline.

---

## 32. Fat Jar and Service Files

If packaging as fat jar, preserve:

```text
META-INF/services/*
```

Otherwise Jersey/provider discovery can fail.

Gradle Shadow:

```groovy
shadowJar {
    mergeServiceFiles()
}
```

Maven Shade:

```xml
<transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
```

Symptoms of broken service files:

```text
provider not found
JSON writer missing
runtime delegate missing
feature not loaded
```

Alternative:

```text
thin distribution with lib/*.jar
```

This avoids many shading issues.

---

## 33. jlink Runtime Image

JDK HTTP Server works well conceptually with custom runtime images because it is a JDK module.

But Jersey and dependencies may need many modules.

Potential issue:

```text
java.lang.module.FindException
NoClassDefFoundError
ClassNotFoundException
```

because runtime image omitted needed module.

Checklist:

```text
[ ] include jdk.httpserver
[ ] include java.logging if logging uses it
[ ] include java.naming if dependency needs it
[ ] include java.xml if JSON/XML dependency needs it
[ ] test final runtime image, not only normal JDK
```

Do not assume jlink image works because app works on full JDK.

---

## 34. Native Image?

JDK HTTP Server + Jersey native image is not automatically simple.

Risks:

- reflection config,
- resource config,
- service loader config,
- dynamic proxies,
- Jackson reflection,
- Jersey injection,
- class initialization,
- unsupported runtime behavior.

If native image is a goal, evaluate separately.

Do not combine:

```text
new deployment model
new Jersey major version
new Java major version
native image
```

in the same migration.

---

## 35. Common Failure Modes

### 35.1 `ClassNotFoundException: JdkHttpServerFactory`

Cause:

```text
jersey-container-jdk-http missing
```

Fix:

```text
add Jersey JDK HTTP container dependency
align version with Jersey BOM
```

---

### 35.2 `NoClassDefFoundError: com/sun/net/httpserver/HttpServer`

Possible cause:

```text
custom jlink runtime missing jdk.httpserver
```

Fix:

```text
include jdk.httpserver module
```

---

### 35.3 Endpoint 404

Causes:

```text
base URI includes path not expected
resource not registered
javax/jakarta mismatch
wrong request URL
package scanning did not find resource
```

Diagnostic:

```text
log base URI
use explicit registration
verify imports
test direct endpoint
```

---

### 35.4 Server Starts but Probe Fails in Kubernetes

Causes:

```text
binding to localhost
wrong probe path
readiness not marked true
base path mismatch
container port mismatch
```

Fix:

```text
bind 0.0.0.0
align probe path
log readiness transition
test inside pod/network namespace
```

---

### 35.5 Executor Saturation

Symptoms:

```text
requests hang
latency spikes
readiness still true
CPU maybe low
thread dump shows blocked downstream
```

Causes:

```text
fixed thread pool exhausted
slow downstream
no timeouts
unbounded queue
```

Fix:

```text
add timeouts
right-size executor
limit queue
fail fast
add metrics
```

---

### 35.6 JSON Provider Missing

Symptom:

```text
MessageBodyWriter not found
```

Causes:

```text
missing jersey-media-json-jackson
provider not registered
fat jar lost service descriptor
wrong namespace
DTO reflection issue
```

---

## 36. Anti-Patterns

### Anti-Pattern 1 — Using JDK HTTP Server for Public High-Traffic API Without Review

It may run, but does it have:

```text
access logging
timeouts
request limits
TLS policy
metrics
overload protection
HTTP feature support
operational familiarity
```

If not, use a stronger runtime.

---

### Anti-Pattern 2 — No Explicit Executor

Default behavior may be fine for demos, not for production reasoning.

Own your executor.

---

### Anti-Pattern 3 — Health Endpoint Without Readiness State

```text
/health/ready always returns 200
```

Then readiness is meaningless.

---

### Anti-Pattern 4 — Treating It Like Servlet

Trying to use:

```text
web.xml
Servlet filters
ServletContext
WAR semantics
```

This model is not Servlet.

---

### Anti-Pattern 5 — Hiding It Behind Kubernetes and Calling It Production-Ready

Kubernetes does not turn a minimal HTTP server into a mature web server.

It only orchestrates the process.

---

## 37. Decision Matrix

| Dimension | JDK HTTP Server |
|---|---|
| Runtime ownership | Application |
| Servlet support | No |
| Dependency footprint | Very small |
| Production maturity | Limited compared to Jetty/Tomcat/Netty/Grizzly |
| Best use | tests, tools, lightweight internal endpoints |
| HTTP features | Basic |
| TLS | Possible via `HttpsServer`, but app-owned |
| Thread control | Executor-based |
| Observability | Mostly app/proxy implemented |
| Kubernetes compatibility | Possible, but must design probes/shutdown |
| Classpath complexity | Lower than servlet container, still has Jersey/provider issues |
| Top risk | Underestimating operational limitations |

---

## 38. When to Choose It

Choose JDK HTTP Server when:

```text
- traffic is low/moderate and controlled
- endpoint is internal
- deployment simplicity matters
- no servlet features needed
- no advanced HTTP features needed
- team accepts app-owned lifecycle
- reverse proxy/gateway handles edge concerns
- integration testing speed matters
```

Do not choose it when:

```text
- public API with high load
- complex TLS/mTLS
- HTTP/2 required
- advanced access logging required
- mature server tuning required
- servlet filter ecosystem required
- large upload/download workload
- strict production runtime standard exists
```

---

## 39. Top-Tier Engineering Perspective

A basic engineer says:

```text
JDK already has HTTP server, use that.
```

A senior engineer asks:

```text
What operational capabilities do we lose compared to Jetty/Grizzly/Tomcat?
```

A top-tier engineer defines the runtime contract:

```text
This service is low traffic.
It sits behind gateway.
It has explicit executor.
It has bounded timeouts.
It has readiness/liveness.
It has structured logs.
It has no servlet requirement.
It has integration tests against final artifact.
It has rollback.
It has documented limitations.
```

Then choosing JDK HTTP Server can be valid.

The key is not whether the server is “simple”.

The key is whether the simplicity matches the risk envelope.

---

## 40. Production Readiness Checklist

```text
[ ] Java version pinned.
[ ] Jersey version family aligned.
[ ] jersey-container-jdk-http included.
[ ] jdk.httpserver module available, especially in jlink image.
[ ] No mixed javax/jakarta namespace.
[ ] ResourceConfig uses explicit registration.
[ ] JSON provider present and tested.
[ ] Bind host configurable.
[ ] App binds 0.0.0.0 in container.
[ ] Public base URI separated from bind URI.
[ ] Executor explicitly configured.
[ ] Executor queue/rejection policy understood.
[ ] Downstream timeouts configured.
[ ] Request body limits enforced at proxy/app layer.
[ ] Health live/ready endpoints implemented.
[ ] Readiness transitions on startup/shutdown.
[ ] server.stop(delay) aligned with Kubernetes grace.
[ ] Executor shuts down.
[ ] App dependencies close.
[ ] Access logging strategy defined.
[ ] Request correlation installed.
[ ] TLS termination ownership decided.
[ ] Management endpoints protected.
[ ] Final artifact inspected.
[ ] Fat jar service descriptors preserved if used.
[ ] Integration test starts actual server.
[ ] Operational limitations documented.
```

---

## 41. Summary

JDK HTTP Server deployment is the most lightweight Jersey hosting model in this series so far.

Its essence:

```text
JDK HttpServer handles basic HTTP.
Jersey handles REST.
Application owns lifecycle and operational behavior.
```

It is excellent for:

- demos,
- tests,
- internal utilities,
- lightweight service endpoints,
- controlled environments.

It is risky for:

- public high-throughput APIs,
- complex HTTP/server needs,
- servlet-dependent applications,
- advanced production traffic management.

The main lesson:

> Lightweight deployment is good when the problem is lightweight.  
> It becomes dangerous when lightweight infrastructure is used to hide heavyweight operational requirements.

---

## 42. How This Part Connects to the Next Part

This part covered JDK HTTP Server, the minimal Java SE embedded hosting model.

Next:

```text
Part 13 — Netty-Based Deployment Model
```

That part changes the mental model again:

```text
JDK HTTP Server:
  simple blocking/high-level embedded server

Netty:
  event-loop-driven network framework
```

In Part 13 we will focus on:

- event loop mental model,
- blocking boundary,
- Jersey on Netty,
- why blocking JAX-RS code can harm event-loop runtime,
- backpressure illusion,
- thread offload,
- when Netty deployment makes sense,
- when it is overengineering.

---

## References

- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Jersey API — `JdkHttpServerFactory`: https://eclipse-ee4j.github.io/jersey.github.io/apidocs/2.34/jersey/org/glassfish/jersey/jdkhttp/JdkHttpServerFactory.html
- Oracle JDK 25 API — `HttpServer`: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html
- Oracle JDK 25 API — `com.sun.net.httpserver` package: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/package-summary.html
- Oracle JDK 25 API — `HttpsServer`: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpsServer.html
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-011.md">⬅️ Part 11 — Embedded Jetty Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-013.md">Part 13 — Netty-Based Deployment Model ➡️</a>
</div>
