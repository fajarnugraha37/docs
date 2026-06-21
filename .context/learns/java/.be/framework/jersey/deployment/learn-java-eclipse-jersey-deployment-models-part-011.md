# learn-java-eclipse-jersey-deployment-models-part-011  
# Part 11 — Embedded Jetty Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 11 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey pada level runtime, classloading, lifecycle, handler chain, servlet boundary, operasional, dan failure model.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: deployment Jersey memakai **embedded Jetty** sebagai HTTP server atau embedded Servlet container.

---

## 1. Apa Itu Embedded Jetty Deployment Model?

Embedded Jetty deployment adalah model ketika aplikasi Java membuat dan menjalankan Jetty server sendiri dari kode aplikasi.

Model besarnya:

```text
java -jar app.jar
```

Di dalam proses JVM:

```text
main()
  ├─ build Jetty Server
  ├─ configure connectors
  ├─ configure handlers / servlet context
  ├─ attach Jersey
  ├─ start server
  ├─ receive traffic
  ├─ dispatch request into Jersey
  └─ shutdown server
```

Embedded Jetty berbeda dari external Jetty.

External Jetty:

```text
Jetty server installed separately.
App is deployed into Jetty.
```

Embedded Jetty:

```text
App creates Jetty server.
App owns Jetty lifecycle.
```

Embedded Jetty juga berbeda dari embedded Grizzly.

Grizzly model sebelumnya:

```text
Jersey + Grizzly HTTP adapter
```

Jetty punya dua wajah:

```text
1. Jetty as HTTP server with Jersey Jetty container adapter.
2. Jetty as embedded Servlet container with Jersey ServletContainer.
```

Keduanya sama-sama “embedded Jetty”, tetapi berbeda secara arsitektur.

---

## 2. Dua Jalur Embedded Jetty

### Jalur A — Jersey Jetty HTTP Container

Topology:

```text
Client
  ↓
Jetty HTTP Server
  ↓
Jersey Jetty HTTP container adapter
  ↓
Jersey runtime
  ↓
Resource method
```

Karakteristik:

- lebih ringan,
- tidak memakai full servlet deployment model,
- cocok untuk Java SE style,
- mirip mental model Grizzly,
- integrasi langsung antara Jetty HTTP layer dan Jersey.

Dependency family:

```text
jersey-container-jetty-http
jersey-server
jersey-hk2
media providers
```

### Jalur B — Embedded Jetty Servlet Container

Topology:

```text
Client
  ↓
Jetty Server
  ↓
Jetty ServletContextHandler
  ↓
Servlet Filter/Servlet chain
  ↓
Jersey ServletContainer
  ↓
Jersey runtime
  ↓
Resource method
```

Karakteristik:

- memakai Servlet API,
- mirip WAR deployment tapi tanpa WAR file,
- mendukung servlet filters,
- mendukung servlet context,
- familiar bagi aplikasi yang biasa di Tomcat/Jetty external,
- bisa menjalankan Jersey dengan model `ServletContainer`.

Dependency family:

```text
Jetty server
Jetty servlet module
Jersey servlet container adapter
Jersey server
Jersey injection/media providers
```

Mental model:

```text
Direct Jetty adapter:
  Jetty HTTP -> Jersey

Embedded Servlet model:
  Jetty HTTP -> Servlet -> Jersey
```

---

## 3. Kapan Embedded Jetty Cocok?

Embedded Jetty cocok ketika Anda ingin:

1. Self-contained Java service.
2. Lebih banyak kontrol HTTP server dibanding Grizzly basic use case.
3. Menggunakan Jetty handler architecture.
4. Memakai embedded Servlet API tanpa deploy WAR.
5. Memakai filter chain seperti auth/CORS/compression/custom servlet filters.
6. Menjalankan REST API + static content + admin handler dalam satu proses.
7. Mengontrol connector, TLS, HTTP/2, handler tree, dan lifecycle.
8. Membuat integration test dengan runtime yang mirip production.
9. Menghindari external app server tetapi tetap ingin Servlet semantics.
10. Deploy ke Docker/Kubernetes sebagai standalone process.

Embedded Jetty kurang cocok jika:

- tim operasional sudah standardisasi external app server,
- butuh full Jakarta EE server services,
- ingin deployment WAR klasik,
- ingin app server mengelola banyak aplikasi,
- ingin minim runtime code dalam aplikasi,
- tidak siap mengelola lifecycle, TLS, thread pool, dan shutdown sendiri.

Rule:

```text
Use embedded Jetty when you want application-owned runtime with stronger HTTP/Servlet composition capabilities.
```

---

## 4. Jetty Mental Model: Server, Connector, Handler

Jetty core model:

```text
Server
  ├─ Connector(s)
  └─ Handler tree
```

### Server

`Server` adalah root runtime object.

Ia mengelola:

- lifecycle,
- thread pool,
- connectors,
- handlers,
- start/stop,
- join,
- resources.

### Connector

Connector menerima koneksi network.

Contoh:

```text
HTTP connector on port 8080
HTTPS connector on port 8443
HTTP/2 connector
admin connector on localhost
```

### Handler

Handler memproses request.

Jetty handler chain bisa berisi:

```text
ContextHandler
ServletContextHandler
ResourceHandler
HandlerCollection
StatisticsHandler
GzipHandler
Custom Handler
```

Dalam embedded Servlet model, `ServletContextHandler` menjadi container Servlet kecil di dalam Jetty.

---

## 5. Jalur A: Direct Jersey Jetty HTTP Container

> Detail API factory bisa berbeda antar versi Jersey/Jetty. Untuk production, selalu cocokkan Jersey major version dengan Jetty major version dan baca API sesuai versi yang digunakan.

Konsep minimal:

```java
ResourceConfig config = new ResourceConfig()
    .register(HelloResource.class)
    .register(JacksonFeature.class);

Server server = JettyHttpContainerFactory.createServer(
    URI.create("http://0.0.0.0:8080/"),
    config
);
```

Mental model:

```text
JettyHttpContainerFactory
  creates Jetty Server
  wires Jersey container into Jetty
  exposes ResourceConfig through Jetty HTTP layer
```

Kelebihan:

- ringkas,
- direct,
- mirip Grizzly deployment,
- cocok untuk service kecil.

Kekurangan:

- kurang fleksibel dibanding manual Jetty handler tree,
- tidak sama dengan Servlet filter chain,
- beberapa Servlet-centric features tidak relevan,
- API compatibility perlu dicek ketat antar Jersey/Jetty version.

Gunakan jalur ini jika Anda ingin Jetty sebagai HTTP engine, bukan sebagai Servlet container.

---

## 6. Jalur B: Embedded Jetty Servlet + Jersey ServletContainer

Ini jalur yang sangat penting.

Alih-alih membuat WAR, kita membuat Servlet context secara programmatic.

Topology:

```text
Jetty Server
  └─ ServletContextHandler
      └─ Jersey ServletContainer mapped to /api/*
```

Contoh konseptual Jersey 3.x / Jakarta style:

```java
package com.example;

import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;
import org.glassfish.jersey.servlet.ServletContainer;
import org.glassfish.jersey.server.ResourceConfig;

public final class Main {

    public static void main(String[] args) throws Exception {
        Server server = new Server(8080);

        ServletContextHandler context = new ServletContextHandler();
        context.setContextPath("/");

        ResourceConfig resourceConfig = new ResourceConfig()
            .register(HelloResource.class)
            .register(JacksonFeature.class);

        ServletHolder jerseyServlet = new ServletHolder(
            new ServletContainer(resourceConfig)
        );

        context.addServlet(jerseyServlet, "/api/*");

        server.setHandler(context);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                server.stop();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, "shutdown-hook"));

        server.start();
        server.join();
    }
}
```

For Jetty 9/10/11/12, package names and artifact coordinates differ.

Examples:

```text
Jetty 9:
  javax.servlet era

Jetty 10:
  jakarta namespace but transitional ecosystem

Jetty 11:
  Jakarta EE 9 / Servlet 5 era

Jetty 12:
  newer Jetty architecture with ee8/ee9/ee10/ee11-style modules/packages
```

Do not copy code across Jetty major versions blindly.

---

## 7. Why Embedded Servlet Jetty Is Powerful

Embedded Jetty Servlet model gives you:

```text
- ServletContext
- servlet mappings
- filters
- sessions if enabled
- security handlers if configured
- static resources if configured
- multiple servlets
- custom handlers around servlet context
- programmatic configuration
```

This is useful when migrating from WAR to standalone process.

WAR model:

```text
web.xml + WEB-INF/lib + external container
```

Embedded Servlet model:

```text
Java code + dependencies + application-owned Jetty
```

Same conceptual servlet pipeline, different ownership.

---

## 8. Version Compatibility Matrix

A simplified mental matrix:

```text
Java 8:
  Jersey 2.x
  javax.ws.rs
  javax.servlet
  Jetty 9.x style ecosystem

Java 11:
  Jersey 2.x or 3.x depending namespace
  Jetty 9/10/11 depending migration

Java 17:
  Jersey 3.x/4.x possible
  Jakarta namespace
  Jetty 11/12 likely candidates

Java 21/25:
  Jersey 3.x/4.x modern deployment
  Jetty 12+ likely for modern platform alignment
```

Key compatibility axes:

```text
Jersey major version
Jetty major version
Servlet API namespace
Java baseline
Jakarta EE level
Dependency coordinates
```

Dangerous combinations:

```text
Jersey 2.x + jakarta servlet/resource imports
Jersey 3.x + javax servlet/resource imports
Jetty 9 + jakarta.servlet classes
Jetty 12 ee10 servlet packages + old examples using javax.servlet
ServletContainer from Jersey 2 with ResourceConfig from Jersey 3
```

Rule:

```text
Pick a coherent universe:
  Java version + Jetty major + Jersey major + Servlet namespace.
```

---

## 9. Dependency Model: Embedded Jetty Servlet

Conceptual Maven dependencies for Jersey 3.x style:

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
    <artifactId>jersey-container-servlet-core</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
  </dependency>

  <!-- Jetty server + servlet dependencies depend on Jetty major version -->
</dependencies>
```

For Jetty 12, artifact names and EE-specific modules must be selected according to Jetty documentation.

Do not assume:

```text
org.eclipse.jetty:jetty-servlet
```

from an old tutorial is correct for every Jetty generation.

Jetty 12 introduced more explicit EE environment module separation, so package and artifact choices matter.

---

## 10. Dependency Model: Direct Jersey Jetty HTTP Container

Conceptual dependency:

```xml
<dependency>
  <groupId>org.glassfish.jersey.containers</groupId>
  <artifactId>jersey-container-jetty-http</artifactId>
</dependency>
```

Plus:

```xml
<dependency>
  <groupId>org.glassfish.jersey.inject</groupId>
  <artifactId>jersey-hk2</artifactId>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-json-jackson</artifactId>
</dependency>
```

Important:

```text
jersey-container-jetty-http is not the same as jersey-container-servlet-core.
```

One adapts Jetty HTTP container directly.

The other adapts Servlet API.

---

## 11. Embedded Jetty vs Embedded Grizzly

| Dimension | Embedded Grizzly | Embedded Jetty |
|---|---|---|
| Typical Jersey docs usage | Very common getting-started path | Supported but more nuanced |
| HTTP server model | Grizzly HTTP server | Jetty Server/Connector/Handler |
| Servlet model | Not the primary mental model | Strong embedded Servlet support |
| Handler composition | Less central for most users | Core Jetty concept |
| HTTP/2/TLS ecosystem | Possible | Strong Jetty ecosystem |
| Migration from WAR | Less direct | More natural through ServletContextHandler |
| Operational flexibility | Good | Very good |
| Complexity | Lower | Higher |
| Best for | Lightweight REST service | REST + Servlet/filter/handler composition |

Rule:

```text
If you want lightweight REST only:
  Grizzly is simple.

If you want embedded server composition and servlet semantics:
  Jetty is more flexible.
```

---

## 12. Embedded Jetty vs WAR on External Jetty

### External Jetty WAR

```text
Jetty installed separately.
WAR deployed into server.
Ops owns server.
App owns webapp.
```

Pros:

- standard app server operation,
- multiple apps possible,
- ops can tune server separately,
- WAR deployment lifecycle familiar.

Cons:

- app/server version coupling,
- external container config drift,
- classloader complexity,
- deployment artifact not fully self-contained.

### Embedded Jetty

```text
Application includes Jetty.
Application starts Jetty.
One process per service.
```

Pros:

- self-contained,
- explicit runtime version,
- Docker-friendly,
- easier local parity,
- one artifact owns all runtime dependencies.

Cons:

- app team owns server tuning,
- server upgrades require app release,
- lifecycle mistakes are app bugs,
- less separation between platform/app.

Modern microservice deployment often favors embedded because Docker/Kubernetes already provide process orchestration.

Enterprise shared-hosting deployments may favor external container.

---

## 13. Building a Production Bootstrap

Basic shape:

```text
main()
  ├─ load config
  ├─ validate config
  ├─ build app components
  ├─ build ResourceConfig
  ├─ build Jetty Server
  ├─ configure connectors
  ├─ configure handler tree
  ├─ configure Jersey servlet/container
  ├─ start server
  ├─ mark ready
  ├─ join/wait
  ├─ mark not ready on shutdown
  ├─ stop server
  └─ close components
```

Do not let `main()` become an unstructured bag of setup code.

Create objects:

```text
ServerConfig
AppComponents
JerseyApplicationFactory
JettyServerFactory
LifecycleController
HealthState
```

This makes runtime behavior testable.

---

## 14. ServerConfig

```java
public record ServerConfig(
    String bindHost,
    int bindPort,
    String contextPath,
    String jerseyMapping,
    String publicBaseUri,
    int stopTimeoutMillis
) {
    public void validate() {
        if (bindHost == null || bindHost.isBlank()) {
            throw new IllegalArgumentException("bindHost is required");
        }
        if (bindPort < 1 || bindPort > 65535) {
            throw new IllegalArgumentException("bindPort out of range: " + bindPort);
        }
        if (!contextPath.startsWith("/")) {
            throw new IllegalArgumentException("contextPath must start with /");
        }
        if (!jerseyMapping.startsWith("/")) {
            throw new IllegalArgumentException("jerseyMapping must start with /");
        }
    }
}
```

Example config:

```text
APP_BIND_HOST=0.0.0.0
APP_BIND_PORT=8080
APP_CONTEXT_PATH=/
APP_JERSEY_MAPPING=/api/*
APP_PUBLIC_BASE_URI=https://api.example.com/my-service
APP_STOP_TIMEOUT_MILLIS=30000
```

Keep separate:

```text
context path:
  Jetty Servlet context boundary

jersey mapping:
  Servlet mapping for Jersey

resource path:
  @Path inside Jersey

public base URI:
  external URL seen by clients
```

---

## 15. Jetty Server Factory

Conceptual factory:

```java
public final class JettyServerFactory {

    public Server create(ServerConfig config, ResourceConfig jerseyConfig) {
        Server server = new Server();

        ServerConnector connector = new ServerConnector(server);
        connector.setHost(config.bindHost());
        connector.setPort(config.bindPort());

        server.addConnector(connector);
        server.setStopTimeout(config.stopTimeoutMillis());
        server.setStopAtShutdown(false);

        ServletContextHandler context = new ServletContextHandler();
        context.setContextPath(config.contextPath());

        ServletHolder jersey = new ServletHolder(
            new ServletContainer(jerseyConfig)
        );
        jersey.setName("jersey");

        context.addServlet(jersey, config.jerseyMapping());

        server.setHandler(context);

        return server;
    }
}
```

Why not just `new Server(8080)`?

Because production often needs:

- explicit host,
- explicit connector,
- stop timeout,
- TLS connector,
- HTTP config,
- request header size,
- idle timeout,
- access logging,
- handler wrapping,
- graceful shutdown behavior.

---

## 16. Mapping Semantics in Embedded Jetty Servlet

Example:

```text
contextPath = "/"
jerseyMapping = "/api/*"
resource @Path = "/users"
```

Endpoint:

```text
/api/users
```

Example:

```text
contextPath = "/my-service"
jerseyMapping = "/api/*"
resource @Path = "/users"
```

Endpoint:

```text
/my-service/api/users
```

Example:

```text
contextPath = "/"
jerseyMapping = "/*"
resource @Path = "/users"
```

Endpoint:

```text
/users
```

But `/*` can swallow static resources or other servlets if not carefully ordered/designed.

Preferred simple API service:

```text
contextPath = "/"
jerseyMapping = "/*"
```

Preferred mixed app:

```text
contextPath = "/"
jerseyMapping = "/api/*"
static handler = /assets/*
admin handler = /admin/*
```

Top-tier invariant:

```text
Every externally visible path must map cleanly to:
  proxy path
  Jetty context path
  servlet mapping
  Jersey resource path
```

---

## 17. Filters in Embedded Jetty

Embedded Servlet model lets you add filters:

```java
context.addFilter(RequestIdServletFilter.class, "/*", EnumSet.of(DispatcherType.REQUEST));
context.addFilter(SecurityFilter.class, "/api/*", EnumSet.of(DispatcherType.REQUEST));
```

Filter order matters.

Typical order:

```text
1. request id / correlation
2. forwarded header normalization
3. security/authentication
4. authorization context
5. CORS
6. compression or response filters
7. Jersey ServletContainer
```

But actual order depends on how you register filters.

For CORS, be careful:

```text
CORS preflight OPTIONS may need to pass before auth
or auth must explicitly allow preflight.
```

Bad symptom:

```text
Browser says CORS failed.
Server actually returned 401 to OPTIONS.
```

Deployment issue, not resource issue.

---

## 18. Handler Tree Design

Jetty handler tree can wrap servlet context.

Conceptual:

```text
Server
  └─ StatisticsHandler
      └─ GzipHandler
          └─ HandlerCollection
              ├─ ServletContextHandler for API
              └─ ResourceHandler for static files
```

This gives power but adds responsibility.

Questions:

```text
Should gzip happen in app or reverse proxy?
Should access logging be Jetty handler or proxy?
Should static files be served by Jetty or CDN/nginx?
Should metrics come from Jetty statistics or app metrics?
Should admin endpoints be separate connector/context?
```

Do not add handlers just because Jetty supports them.

Each handler changes operational behavior.

---

## 19. Thread Pool

Jetty server uses a thread pool.

Production should not ignore it.

Conceptual:

```java
QueuedThreadPool threadPool = new QueuedThreadPool();
threadPool.setName("jetty");
threadPool.setMinThreads(10);
threadPool.setMaxThreads(200);

Server server = new Server(threadPool);
```

Thread pool concerns:

- max request concurrency,
- blocking resource methods,
- downstream latency,
- queue behavior,
- memory usage per thread,
- CPU oversubscription,
- graceful shutdown,
- thread names for diagnostics.

If resource methods block on DB/downstream HTTP:

```text
more Jetty threads may increase throughput until downstream saturates
```

If CPU-bound:

```text
too many threads can reduce performance
```

Rule:

```text
Thread pool tuning follows workload profile, not arbitrary defaults.
```

---

## 20. Virtual Threads with Jetty/Jersey

Java 21/25 make virtual threads attractive, but do not assume automatic benefit.

Questions:

```text
Which Jetty version?
Does Jetty support virtual-thread execution strategy in your configuration?
Does Jersey resource execution run on virtual threads?
Are your dependencies virtual-thread-friendly?
Do you have blocking synchronized sections causing pinning?
Does your observability tooling handle virtual threads?
```

Practical strategy:

```text
1. Build correct platform-thread deployment.
2. Add benchmarks and load tests.
3. Enable virtual-thread mode if supported.
4. Compare latency, throughput, memory, thread dumps.
5. Roll out separately from Jersey/Jetty major upgrades.
```

Avoid “modernization bundles”:

```text
Java 8 -> 25
Jersey 2 -> 4
Jetty 9 -> 12
javax -> jakarta
platform threads -> virtual threads
WAR -> embedded
```

all at once.

---

## 21. Timeouts and Limits

Jetty connector/server must be configured according to workload.

Important concerns:

```text
idle timeout
request header size
response header size
request body size
form size
upload size
TLS handshake timeout
server stop timeout
downstream timeout
application deadline
load balancer timeout
```

If these are not aligned, you get:

- slowloris exposure,
- thread exhaustion,
- memory pressure,
- gateway 504,
- client retry storm,
- partial writes,
- broken audit consistency.

Good invariant:

```text
No network or downstream wait should be infinite.
```

Timeouts should form a coherent budget.

---

## 22. Graceful Shutdown

Jetty has lifecycle support, but application must integrate it with readiness.

Shutdown sequence:

```text
SIGTERM
  ↓
mark readiness false
  ↓
stop accepting new traffic
  ↓
drain in-flight requests
  ↓
stop Jetty
  ↓
close application dependencies
  ↓
exit
```

Conceptual shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    healthState.markNotReady();

    try {
        server.stop();
    } catch (Exception e) {
        e.printStackTrace();
    } finally {
        components.close();
    }
}, "shutdown-hook"));
```

Important:

```text
server.setStopTimeout(...)
```

should be aligned with Kubernetes:

```text
terminationGracePeriodSeconds
```

Readiness must go false before server stop.

---

## 23. Health Endpoints

In embedded Jetty Servlet model, health can be Jersey resource:

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
        return Response.status(503).entity("not ready").build();
    }
}
```

If Jersey itself fails to initialize, these endpoints may not exist.

For very advanced systems, you can expose a low-level Jetty handler health endpoint outside Jersey, but this adds complexity.

Decision:

```text
Health in Jersey:
  verifies Jersey pipeline is alive.

Health in Jetty handler:
  can report before/without Jersey.

Both:
  useful but must avoid contradictory signals.
```

Most services should start simple:

```text
/health/live and /health/ready as Jersey resources
```

Then only add lower-level health if required.

---

## 24. Static Content and SPA Coexistence

Embedded Jetty can serve:

```text
/api/* via Jersey
/assets/* via static ResourceHandler
/index.html for SPA
```

But be careful.

Common bug:

```text
Jersey mapped to /*
SPA fallback mapped to /*
static handler mapped after Jersey
```

Result:

- API 404 returns SPA HTML,
- browser displays wrong error,
- API clients parse HTML as JSON,
- observability misclassifies errors.

Good separation:

```text
/api/*      -> Jersey
/assets/*   -> static
/           -> SPA index
```

Avoid:

```text
everything /* with ambiguous fallback
```

unless handler order is deliberate and tested.

---

## 25. Access Logging

Jetty can provide access logging, but you need a strategy.

Access logging options:

```text
1. Reverse proxy only
2. Jetty access log
3. Application-level request logging
4. Combination
```

Minimum fields:

```text
timestamp
method
path
status
duration
request id
client IP / forwarded client
bytes sent
user agent
authenticated subject if safe
```

Avoid logging:

```text
Authorization header
cookies
full request body
PII query parameters
tokens
passwords
```

Remember:

```text
Access log shows HTTP traffic.
Audit log shows business/legal event.
They are not the same.
```

---

## 26. Forwarded Headers

Embedded Jetty behind reverse proxy must deal with:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
Forwarded
```

Problems if ignored:

- generated absolute URL uses `http://localhost:8080`,
- redirects go to internal address,
- audit logs show proxy IP only,
- security logic thinks request is HTTP not HTTPS,
- wrong CORS origin behavior.

But blindly trusting forwarded headers is dangerous.

Rule:

```text
Trust forwarded headers only from trusted proxy boundary.
```

Architecture options:

```text
- normalize in reverse proxy
- configure Jetty forwarded request customizer if appropriate
- handle public base URI in app config
- avoid generating absolute URLs unless necessary
```

For regulated systems, be explicit:

```text
client_ip = trusted proxy interpretation
remote_addr = direct TCP peer
```

Do not mix them silently.

---

## 27. TLS and HTTP/2

Jetty has strong support for modern HTTP features.

But embedded TLS means application owns:

- keystore loading,
- truststore loading,
- certificate rotation,
- TLS protocols,
- cipher suites,
- mTLS client auth,
- HTTP/2 connector setup,
- reload strategy,
- secret handling.

In cloud/Kubernetes, TLS is often terminated at:

```text
ALB / ingress / gateway / service mesh
```

Then app listens HTTP internally:

```text
0.0.0.0:8080
```

Embedded TLS is appropriate when:

- service is directly exposed,
- mTLS is required at app layer,
- no gateway handles certs,
- appliance/on-prem model,
- special compliance boundary.

Rule:

```text
Do not move TLS into application unless ownership is intentional.
```

---

## 28. Security Model

Embedded Jetty Servlet gives several layers:

```text
Jetty security handler
Servlet Filter
Jersey ContainerRequestFilter
Resource method authorization
Domain service authorization
```

Where should auth live?

### Servlet Filter

Good for:

- coarse authentication,
- request normalization,
- rejecting unauthenticated requests before Jersey,
- integration with servlet context.

### Jersey ContainerRequestFilter

Good for:

- resource-aware authentication,
- annotation-based auth,
- JAX-RS context usage,
- per-endpoint authorization.

### Domain service

Good for:

- business authorization,
- object-level permission,
- state transition rules,
- regulatory defensibility.

Top-tier rule:

```text
Authentication can happen near transport boundary.
Authorization must be enforced near the domain decision.
```

Do not rely only on path filter for complex permission systems.

---

## 29. JSON and Provider Pipeline

For JSON:

```java
ResourceConfig config = new ResourceConfig()
    .register(UserResource.class)
    .register(JacksonFeature.class)
    .register(ObjectMapperProvider.class);
```

Custom mapper:

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

In embedded Jetty Servlet model, JSON behavior is still Jersey provider behavior, not Jetty behavior.

Jetty handles HTTP.

Jersey handles entity mapping.

Jackson/JSON-B/MOXy handles serialization.

Keep responsibility separate.

---

## 30. Request Body Limits

A dangerous embedded deployment mistake:

```text
No request size limit.
```

Concerns:

- memory pressure,
- slow upload,
- disk temp usage if multipart,
- denial of service,
- thread occupation.

Limits can be enforced at:

```text
reverse proxy
Jetty connector/server
Servlet layer
Jersey resource/provider
application validation
```

Best practice:

```text
enforce coarse limit at proxy/server
enforce semantic limit in application
```

Example:

```text
max HTTP request body:
  10 MB

max JSON payload by endpoint:
  256 KB

max file upload:
  endpoint-specific and authenticated
```

---

## 31. Handler/Servlet/Resource Responsibility Boundary

Do not put all logic in one layer.

Good boundary:

```text
Jetty handler:
  low-level HTTP/server composition

Servlet filter:
  transport/request cross-cutting concern

Jersey filter:
  JAX-RS request cross-cutting concern

Resource:
  HTTP API contract

Service:
  use case/business operation

Domain:
  invariant/state transition

Repository/client:
  external persistence/integration
```

Bad boundary:

```text
Jetty handler directly calls database
Servlet filter implements business authorization
Resource opens raw sockets
Domain object reads HTTP headers
```

Top-tier deployment architecture keeps runtime concerns separated from business decisions.

---

## 32. Docker Deployment

Embedded Jetty Dockerfile:

```Dockerfile
FROM eclipse-temurin:21-jre

RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app

COPY target/app.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

Consider:

```text
- non-root user
- CA certificates
- memory ratio
- GC choice
- timezone if needed
- signal handling
- startup logs
- health probes in Kubernetes, not necessarily Docker HEALTHCHECK
- SBOM
- vulnerability scanning
```

Do not bake config/secrets into image.

---

## 33. Kubernetes Deployment

Conceptual deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jersey-jetty-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jersey-jetty-api
  template:
    metadata:
      labels:
        app: jersey-jetty-api
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: example/jersey-jetty-api:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: APP_BIND_HOST
              value: "0.0.0.0"
            - name: APP_BIND_PORT
              value: "8080"
            - name: APP_CONTEXT_PATH
              value: "/"
            - name: APP_JERSEY_MAPPING
              value: "/api/*"
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /api/health/live
              port: 8080
            periodSeconds: 2
            failureThreshold: 30
```

Notice path:

```text
/api/health/ready
```

because:

```text
jerseyMapping = /api/*
resource @Path = /health
method @Path = /ready
```

Many readiness bugs are path mapping bugs.

---

## 34. Integration Testing Embedded Jetty

Embedded Jetty is excellent for real runtime tests.

Test targets:

```text
- server starts
- resource path mapping correct
- JSON provider works
- filters run in expected order
- CORS preflight works
- exception mapper works
- 404 is JSON if expected
- static route does not swallow API errors
- health readiness transitions
- shutdown closes server
```

Use random port in tests.

Avoid hardcoding:

```text
8080
```

because parallel tests will collide.

A good test harness exposes actual bound URI.

---

## 35. Common Failure Modes

### 35.1 Wrong Jetty/Jersey Namespace

Symptom:

```text
ClassNotFoundException: jakarta.servlet.Servlet
```

or:

```text
ClassNotFoundException: javax.servlet.Servlet
```

Cause:

```text
Jetty/Servlet/Jersey namespace mismatch
```

Fix:

```text
Align Jetty major + Jersey major + Servlet API namespace.
```

---

### 35.2 Jersey Servlet Not Receiving Requests

Symptom:

```text
Jetty starts, /api/users returns 404
```

Causes:

- servlet mapping wrong,
- context path wrong,
- resource not registered,
- request path missing `/api`,
- proxy rewrite mismatch.

Diagnostic:

```text
Log contextPath
Log jerseyMapping
Log registered resources
Test direct container port before proxy
```

---

### 35.3 Static Handler Swallows API

Symptom:

```text
API client receives index.html
```

Cause:

```text
SPA fallback handler catches /api/*
```

Fix:

```text
Route /api/* to Jersey before SPA fallback.
Return proper API 404 for API paths.
```

---

### 35.4 Filters Not Running

Causes:

- wrong dispatcher type,
- wrong path mapping,
- filter added after servlet in unexpected order,
- using Jersey direct adapter instead of Servlet model,
- filter registered in wrong context.

Remember:

```text
Servlet filters only exist in Servlet deployment path.
```

If using direct `jersey-container-jetty-http`, Servlet filters are not part of the model.

---

### 35.5 Shutdown Hangs

Causes:

- non-daemon threads from app dependencies,
- Jetty not stopped,
- scheduler not closed,
- HTTP client pools not closed,
- DB pool not closed,
- server.join() waiting forever without signal coordination.

Fix:

```text
own lifecycle of every component
close dependencies
name threads
dump threads on slow shutdown
```

---

### 35.6 Provider Not Found in Fat Jar

Cause:

```text
META-INF/services lost during shading
```

Fix:

```text
merge service files
inspect artifact
prefer thin distribution if shading complexity is high
```

---

## 36. Anti-Patterns

### Anti-Pattern 1 — Treating Embedded Jetty Like Tomcat

Embedded Jetty is not an external app server.

Bad assumption:

```text
Ops will configure server separately.
```

In embedded model:

```text
server config is application config.
```

---

### Anti-Pattern 2 — Copy-Pasting Jetty 9 Code into Jetty 12

Jetty major versions matter.

APIs, package names, artifact coordinates, and EE environment modules can differ.

Always align examples with your Jetty major version.

---

### Anti-Pattern 3 — Using `/*` for Everything Without Handler Design

```text
Jersey /*
SPA /*
static /*
admin /*
```

This produces ambiguous behavior.

Use explicit route ownership.

---

### Anti-Pattern 4 — No Readiness Transition

App receives SIGTERM but still reports ready.

Result:

```text
traffic sent to shutting-down pod
```

Fix:

```text
readiness false before server stop
```

---

### Anti-Pattern 5 — Business Logic in Servlet Filter

Filters should not contain complex domain decisions.

They lack the domain context needed for defensible authorization.

---

## 37. Production Decision Matrix

| Decision | Direct Jersey Jetty HTTP | Embedded Jetty Servlet |
|---|---|---|
| Uses Servlet API | No / minimal | Yes |
| Servlet filters | No | Yes |
| Closer to WAR semantics | No | Yes |
| Lightweight REST service | Good | Good but heavier |
| Static + API + filter composition | Limited | Strong |
| Migration from Tomcat/WAR | Less direct | More direct |
| Handler tree control | Possible | Strong |
| Classpath complexity | Moderate | Higher |
| Compatibility axes | Jersey + Jetty adapter | Jersey + Servlet + Jetty EE module |
| Best use | Self-contained REST server | Self-contained web/API runtime |

---

## 38. Top-Tier Engineering Perspective

A basic question:

```text
How do I run Jersey on Jetty?
```

A better question:

```text
Which Jetty deployment path am I using?
```

A top-tier question:

```text
Is Jersey attached directly to Jetty HTTP,
or through ServletContainer inside ServletContextHandler?

Who owns the connector?
Who owns the thread pool?
What is the path mapping contract?
Which filters execute before Jersey?
How is readiness coordinated with shutdown?
How is the public URI reconstructed behind proxy?
How do we validate version compatibility?
Can we prove the final artifact contains the intended Jersey/Jetty universe?
```

Embedded Jetty gives a lot of architectural control.

But more control means more failure modes.

---

## 39. Production Readiness Checklist

```text
[ ] Deployment path chosen: direct Jetty HTTP or embedded Servlet.
[ ] Java version pinned.
[ ] Jersey major version selected.
[ ] Jetty major version selected.
[ ] Servlet namespace aligned if using Servlet model.
[ ] No mixed javax/jakarta dependencies.
[ ] Jersey artifacts aligned through BOM.
[ ] Jetty artifacts aligned through Jetty BOM/version governance.
[ ] ResourceConfig uses explicit registration for critical resources/providers.
[ ] JSON provider present and tested.
[ ] Context path documented.
[ ] Jersey servlet mapping documented.
[ ] External proxy path documented.
[ ] Health probe paths tested against final image.
[ ] Bind host set to 0.0.0.0 for container deployment.
[ ] Public base URI separated from bind address.
[ ] Thread pool configured or consciously accepted.
[ ] Timeouts configured and aligned.
[ ] Request size limits defined.
[ ] Shutdown hook installed.
[ ] Readiness false before server stop.
[ ] Jetty stop timeout aligned with Kubernetes grace.
[ ] Access logging strategy defined.
[ ] Correlation ID installed.
[ ] Forwarded headers strategy defined.
[ ] TLS ownership decided.
[ ] Filters ordered and tested.
[ ] Static/API route ownership tested.
[ ] Final artifact inspected.
[ ] Fat jar service descriptors preserved if applicable.
[ ] Duplicate classes checked.
[ ] Integration tests start real embedded Jetty.
```

---

## 40. Summary

Embedded Jetty is a powerful deployment model for Jersey because it can act as:

```text
1. lightweight embedded HTTP server
2. embedded Servlet runtime
```

This gives two valid architectures:

```text
Jetty HTTP -> Jersey

Jetty HTTP -> ServletContextHandler -> Jersey ServletContainer
```

The second path is especially useful when migrating from WAR/Servlet deployments into standalone service processes.

Core insight:

> Embedded Jetty is not just “a way to avoid Tomcat”.  
> It is a programmable HTTP/Servlet runtime that your application owns.

That means you must design:

- connector,
- handler tree,
- servlet mapping,
- filter order,
- lifecycle,
- readiness,
- shutdown,
- timeouts,
- security,
- observability,
- dependency compatibility.

Used well, embedded Jetty gives precise control and strong deployment portability.

Used casually, it creates invisible routing, lifecycle, and dependency problems.

---

## 41. How This Part Connects to the Next Part

This part covered embedded Jetty.

Next:

```text
Part 12 — JDK HTTP Server and Lightweight Deployment
```

That part will examine the most minimal Java SE hosting model:

```text
JDK built-in HTTP server + Jersey integration
```

The key contrast:

```text
Jetty:
  powerful, production-grade HTTP/Servlet ecosystem

JDK HTTP Server:
  very lightweight, minimal, useful for tools/tests/internal endpoints,
  but limited as production runtime
```

We will evaluate where the built-in JDK server is useful, where it is dangerous, and how to reason about lightweight deployment without overengineering.

---

## References

- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Eclipse Jersey 2.x User Guide — Jetty HTTP Server section: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/user-guide.html
- Jersey container artifact — jersey-container-jetty-http: https://central.sonatype.com/artifact/org.glassfish.jersey.containers/jersey-container-jetty-http
- Eclipse Jetty 12.1 Programming Guide: https://jetty.org/docs/jetty/12.1/programming-guide/index.html
- Eclipse Jetty 12.1 HTTP Server Libraries: https://jetty.org/docs/jetty/12.1/programming-guide/server/http.html
- Eclipse Jetty 12 documentation: https://jetty.org/docs/jetty/12.1/index.html
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-010.md">⬅️ Part 10 — Embedded Grizzly Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-012.md">Part 12 — JDK HTTP Server and Lightweight Deployment ➡️</a>
</div>
