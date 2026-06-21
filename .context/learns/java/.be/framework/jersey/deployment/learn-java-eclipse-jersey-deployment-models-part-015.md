# learn-java-eclipse-jersey-deployment-models-part-015  
# Part 15 — Tomcat Deployment: Practical Production Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 15 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey di Apache Tomcat sebagai production-grade Servlet container.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: WAR deployment, dependency ownership, Tomcat connector/thread/classloader, reverse proxy, Docker/Kubernetes, health, graceful shutdown, dan failure diagnostics.

---

## 1. Apa Itu Tomcat Deployment Model untuk Jersey?

Tomcat deployment model adalah model ketika aplikasi Jersey dikemas sebagai WAR dan dijalankan di Apache Tomcat sebagai Servlet container.

Topology:

```text
Client
  ↓
Reverse proxy / load balancer / ingress
  ↓
Tomcat Connector
  ↓
Tomcat Engine / Host / Context
  ↓
Web application classloader
  ↓
Jersey ServletContainer
  ↓
Jersey runtime
  ↓
Resource method
  ↓
Provider pipeline
  ↓
Tomcat response
  ↓
Client
```

Tomcat menyediakan:

```text
Servlet container
HTTP connector
web application deployment
classloader isolation
session support if used
filter chain
access logging
static resource serving
lifecycle management
```

Tomcat tidak menyediakan full Jakarta EE platform seperti:

```text
CDI full runtime
JTA transaction manager
JPA provider
Jakarta Messaging
Jakarta Batch
full Jakarta Security platform
server-managed enterprise datasource in full app-server sense
```

Tomcat adalah Servlet/JSP/WebSocket container, bukan full Jakarta EE server.

Untuk Jersey, implikasinya:

> Tomcat biasanya memiliki Servlet runtime, sedangkan aplikasi membawa Jersey runtime sendiri.

---

## 2. Mental Model Utama

Tomcat + Jersey adalah model hybrid:

```text
Tomcat owns:
  HTTP connector
  Servlet container
  webapp lifecycle
  request/response servlet objects
  webapp classloader
  access logging
  deployment context

Application owns:
  Jersey runtime
  Jersey servlet adapter
  JSON provider
  validation provider if used
  dependency injection integration
  business dependencies
  application configuration
```

Ini berbeda dari:

```text
Full Jakarta EE server:
  server may own Jakarta REST implementation

Embedded Grizzly/Jetty/Netty:
  application owns HTTP server
```

Tomcat berada di tengah:

```text
server owns Servlet
app owns REST runtime
```

Rule:

```text
In Tomcat deployment, do not assume Tomcat provides Jersey.
```

Jersey documentation for servlet containers without integrated JAX-RS/Jakarta REST implementation says the application needs to include JAX-RS/Jakarta REST API and Jersey implementation in the deployed application. Tomcat falls into this practical category unless you have installed custom shared libraries deliberately.

---

## 3. Why Tomcat Remains Important

Tomcat remains common because it is:

- simpler than full Jakarta EE server,
- mature,
- widely understood by operations teams,
- WAR-friendly,
- production-proven,
- reverse-proxy friendly,
- Docker-friendly,
- enough for many REST APIs,
- less opinionated than full platform servers.

For Jersey, Tomcat is attractive when:

```text
You want Servlet deployment,
but not full Jakarta EE platform.
```

It is especially common in enterprise systems that want:

- WAR artifact,
- externalized Tomcat config,
- access logs,
- mature connector tuning,
- ops familiarity,
- simple app isolation.

---

## 4. Tomcat Version and Namespace Matrix

Tomcat major versions map to Servlet/Jakarta generations.

Simplified:

```text
Tomcat 8.5 / 9:
  Java EE / javax.servlet era
  Servlet 3.1 / 4.0 depending version
  Jersey 2.x / javax.ws.rs

Tomcat 10.1:
  Jakarta namespace
  Servlet 6.0
  Jakarta EE 10 related specs
  Jersey 3.x / jakarta.ws.rs

Tomcat 11:
  Jakarta EE 11 aligned generation
  Servlet 6.1 family
  Jersey 4.x may be relevant for Jakarta REST 4.0 alignment
```

The Apache Tomcat “Which Version?” page states that Tomcat 11.0.x is the current focus of development and builds on Tomcat 10.1.x, implementing the Servlet 6.1, JSP 4.0, EL 6.0, WebSocket 2.2, and Authentication 3.1 specifications required by Jakarta EE 11 platform.

Critical rule:

```text
Tomcat generation, Servlet namespace, Jersey major version, and application imports must align.
```

Examples:

```text
Tomcat 9:
  javax.servlet
  Jersey 2.x
  javax.ws.rs

Tomcat 10.1:
  jakarta.servlet
  Jersey 3.x
  jakarta.ws.rs

Tomcat 11:
  jakarta.servlet / Servlet 6.1 generation
  Jersey 4.x if targeting Jakarta REST 4.0 alignment
```

Do not deploy a `javax.ws.rs` Jersey 2 app unchanged to Tomcat 10/11.

---

## 5. WAR Structure

A Tomcat WAR:

```text
my-api.war
├─ index.html optional
├─ META-INF/
├─ WEB-INF/
│  ├─ web.xml optional
│  ├─ classes/
│  │  └─ com/example/...
│  └─ lib/
│     ├─ jersey-server.jar
│     ├─ jersey-container-servlet-core.jar
│     ├─ jersey-hk2.jar
│     ├─ jersey-media-json-jackson.jar
│     └─ application-dependencies.jar
```

Tomcat loads:

```text
WEB-INF/classes
WEB-INF/lib/*.jar
```

as part of the web application.

Tomcat itself has:

```text
$CATALINA_HOME/lib
$CATALINA_BASE/lib
```

for container/shared libraries.

Production rule:

```text
Application libraries belong in WEB-INF/lib unless intentionally shared.
```

Do not casually place application/Jersey libraries in Tomcat global `lib`.

---

## 6. Dependency Model

### 6.1 Jersey 3.x / Tomcat 10.1 Example

Maven:

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

  <dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>${servlet.version}</version>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

Why `jakarta.servlet-api` is `provided`?

Because Tomcat provides Servlet API.

Why Jersey is not `provided`?

Because Tomcat does not normally provide Jersey runtime.

---

## 7. Tomcat 9 / Jersey 2.x Example

For legacy Java 8/Java 11 apps:

```xml
<dependency>
  <groupId>org.glassfish.jersey.containers</groupId>
  <artifactId>jersey-container-servlet-core</artifactId>
  <version>${jersey2.version}</version>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.inject</groupId>
  <artifactId>jersey-hk2</artifactId>
  <version>${jersey2.version}</version>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-json-jackson</artifactId>
  <version>${jersey2.version}</version>
</dependency>

<dependency>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
  <version>${servlet.version}</version>
  <scope>provided</scope>
</dependency>
```

Resource imports:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

Do not mix with:

```java
jakarta.ws.rs.Path
```

---

## 8. ServletContainer Deployment

Jersey is attached to Tomcat through Jersey’s `ServletContainer`.

`web.xml` style:

```xml
<web-app
    xmlns="https://jakarta.ee/xml/ns/jakartaee"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                        https://jakarta.ee/xml/ns/jakartaee/web-app_6_0.xsd"
    version="6.0">

    <servlet>
        <servlet-name>jersey-api</servlet-name>
        <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>

        <init-param>
            <param-name>jakarta.ws.rs.Application</param-name>
            <param-value>com.example.ApiApplication</param-value>
        </init-param>

        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>jersey-api</servlet-name>
        <url-pattern>/api/*</url-pattern>
    </servlet-mapping>

</web-app>
```

`ApiApplication`:

```java
package com.example;

import org.glassfish.jersey.server.ResourceConfig;

public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);

        property("jersey.config.server.wadl.disableWadl", true);
    }
}
```

Endpoint composition:

```text
context path:
  /my-api

servlet mapping:
  /api/*

resource @Path:
  /users

final:
  /my-api/api/users
```

---

## 9. Annotation-Based Deployment

Instead of `web.xml`, you may use:

```java
@ApplicationPath("/api")
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(UserResource.class);
    }
}
```

This is convenient.

But `web.xml` remains useful when:

- servlet init params needed,
- load-on-startup ordering matters,
- servlet/filter mapping needs explicit governance,
- security constraints defined,
- multiple servlets/filters exist,
- ops expects deployment descriptor.

Top-tier guidance:

```text
Use annotation-based deployment for simple services.
Use web.xml when deployment contract must be explicit.
```

---

## 10. Servlet Mapping Choices

Common mappings:

```text
/api/*
/
 /*
```

### `/api/*`

Recommended for mixed web/API apps.

```text
/my-api/api/users
```

Pros:

- API clearly separated,
- static resources can exist elsewhere,
- health path clear,
- proxy routing easier.

### `/`

Default servlet mapping.

Can be useful for API-only app.

Endpoint:

```text
/my-api/users
```

But be careful with Tomcat default servlet/static resources.

### `/*`

Very broad.

Can swallow everything.

Use only when you understand filter/servlet/static implications.

Rule:

```text
Prefer /api/* unless you deliberately want root API.
```

---

## 11. Context Path

Tomcat context path can come from:

```text
WAR filename:
  my-api.war -> /my-api

ROOT.war:
  /

server.xml Context
context XML file
deployment tool
container image convention
Kubernetes ingress path
```

Do not assume context path from local deployment equals production.

Production path contract:

```text
external path
reverse proxy rewrite
Tomcat context path
Jersey servlet mapping
resource path
```

Example:

```text
external:
  /aceas/api/cases

Tomcat context:
  /aceas

Jersey servlet mapping:
  /api/*

resource:
  /cases
```

Final path works.

If proxy strips `/aceas`, the internal path changes.

Document it.

---

## 12. Tomcat Connector Mental Model

Tomcat HTTP connector receives network traffic.

The Tomcat HTTP connector documentation describes the HTTP Connector as a Connector component supporting HTTP/1.1 and enabling Catalina to function as a stand-alone web server. A connector listens on a specific TCP port and forwards requests to the associated Engine to create responses.

Typical `server.xml`:

```xml
<Connector
    port="8080"
    protocol="org.apache.coyote.http11.Http11NioProtocol"
    connectionTimeout="20000"
    maxThreads="200"
    acceptCount="100"
    maxHttpHeaderSize="8192"
    redirectPort="8443" />
```

Important knobs:

```text
port
protocol
maxThreads
minSpareThreads
acceptCount
maxConnections
connectionTimeout
keepAliveTimeout
maxKeepAliveRequests
maxHttpHeaderSize
maxPostSize
compression
secure/proxyName/proxyPort/scheme
```

Do not copy values blindly.

Tune based on workload and proxy topology.

---

## 13. Thread Pool and Blocking

Tomcat connector threads execute servlet/Jersey request processing.

If Jersey resource blocks:

```java
@GET
public UserDto get() {
    return database.findUser(); // blocking
}
```

Tomcat request thread is occupied.

Capacity is bounded by:

```text
maxThreads
DB pool size
downstream latency
CPU
memory
request timeout
```

Common bad config:

```text
Tomcat maxThreads=500
DB pool max=20
downstream timeout=60s
```

Result:

```text
hundreds of threads waiting for 20 DB connections
latency explosion
memory pressure
retry storm
```

Better:

```text
Tomcat threads aligned with downstream capacity
timeouts bounded
queue/rejection behavior understood
load test performed
```

Top-tier invariant:

```text
Thread count is not throughput. It is concurrency budget.
```

---

## 14. acceptCount, maxConnections, and Overload

Simplified mental model:

```text
maxConnections:
  how many connections Tomcat can handle

maxThreads:
  how many request-processing threads

acceptCount:
  how many incoming connection requests can queue after max connections/threads pressure
```

Exact behavior depends on connector/protocol.

Overload can queue at:

```text
client
load balancer
kernel backlog
Tomcat accept queue
Tomcat executor
application downstream pool
database
```

If every queue is large, failure becomes slow and expensive.

Better overload strategy:

```text
small bounded queues
fast rejection
503 when saturated
timeouts
circuit breakers
readiness false under severe saturation
```

---

## 15. Keep-Alive

Keep-alive improves efficiency but consumes connection resources.

Important settings:

```text
keepAliveTimeout
maxKeepAliveRequests
maxConnections
connectionTimeout
```

Behind load balancers, align:

```text
client timeout
load balancer idle timeout
Tomcat keep-alive timeout
application timeout
```

Bad:

```text
LB idle timeout shorter than Tomcat expectation
```

can cause broken pipes or connection reset patterns.

Good production practice:

```text
Document timeout chain from client to Tomcat to downstream.
```

---

## 16. Request Size Limits

Tomcat and proxy should enforce request limits.

Concerns:

```text
maxHttpHeaderSize
maxPostSize
maxSwallowSize
multipart limits
proxy body size
application semantic limits
```

Do not rely only on Jersey DTO validation.

Example layered policy:

```text
nginx/client_max_body_size:
  10MB

Tomcat maxPostSize:
  10MB

Application endpoint limit:
  256KB JSON for normal commands
  separate configured limit for upload endpoint
```

Large payload handling must be explicit.

---

## 17. Compression

Tomcat can compress responses.

Reverse proxy can also compress.

Application can also compress.

Do not compress at multiple layers accidentally.

Consider:

```text
where compression happens
which content types
minimum size
CPU cost
security concerns for sensitive responses
proxy behavior
```

For most production topologies:

```text
compression at reverse proxy/gateway
```

is often simpler.

But Tomcat compression can be valid for direct deployments.

---

## 18. Reverse Proxy Integration

Production Tomcat usually sits behind:

```text
nginx
Apache httpd
HAProxy
AWS ALB
Kubernetes Ingress
API Gateway
service mesh
```

Need to handle:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
Forwarded
Host header
scheme
server port
remote IP
```

Tomcat has mechanisms like RemoteIpValve for processing forwarded headers.

Without correct config:

- generated URLs use `http`,
- redirects go to internal host,
- security thinks request is not secure,
- access logs show proxy IP only,
- audit client IP is wrong,
- CORS may behave incorrectly.

Rule:

```text
Only trust forwarded headers from trusted proxy boundaries.
```

Do not accept arbitrary `X-Forwarded-For` from the internet.

---

## 19. Access Logs

Tomcat can emit access logs via AccessLogValve.

A good access log includes:

```text
timestamp
method
path
status
duration
bytes
remote IP / forwarded client
request id
user/principal if safe
user agent
```

But access logs are not audit logs.

Access log:

```text
HTTP traffic evidence
```

Audit log:

```text
business/regulatory action evidence
```

For regulated systems, both matter, but they answer different questions.

---

## 20. Classloader Model

Tomcat documentation explains that Tomcat installs multiple class loaders to let container internals and web applications access different class/resource repositories.

Simplified:

```text
Bootstrap
  ↓
System
  ↓
Common
  ↓
Webapp ClassLoader
```

Webapp loads:

```text
/WEB-INF/classes
/WEB-INF/lib/*.jar
```

Tomcat common loader loads:

```text
$CATALINA_BASE/lib
$CATALINA_HOME/lib
```

Production rule:

```text
Do not put application dependencies in Tomcat lib unless intentionally shared.
```

Why?

Because global libs affect all webapps.

Bad:

```text
Put jersey-server.jar in Tomcat/lib
Also package jersey-server.jar in WEB-INF/lib
```

Risk:

```text
ClassCastException
NoSuchMethodError
provider duplication
redeploy leak
```

---

## 21. Dependency Ownership Checklist for Tomcat

Tomcat owns:

```text
Servlet API
JSP/EL if used
WebSocket API if used
Tomcat internals
```

Application owns:

```text
Jersey runtime
Jersey servlet adapter
Jersey injection integration
JSON provider
validation provider if not container-provided
business libraries
database pool if app-managed
HTTP clients
observability libraries
```

Usually `provided`:

```text
jakarta.servlet-api for Tomcat 10/11
javax.servlet-api for Tomcat 9
```

Usually packaged:

```text
jersey-server
jersey-container-servlet-core
jersey-hk2
jersey-media-json-jackson
```

---

## 22. JSON Provider

Tomcat does not provide your Jersey JSON provider.

If you want Jackson:

```xml
<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-json-jackson</artifactId>
</dependency>
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

Test:

```text
GET JSON
POST JSON
invalid JSON
date/time fields
validation error body
```

If `/health` works but JSON endpoint fails, deployment is not valid.

---

## 23. Dependency Injection

In Tomcat, you usually do not have full CDI unless you add/configure it.

Jersey default injection commonly uses HK2:

```xml
<dependency>
  <groupId>org.glassfish.jersey.inject</groupId>
  <artifactId>jersey-hk2</artifactId>
</dependency>
```

Jersey resource:

```java
@Path("/users")
public final class UserResource {

    private final UserService userService;

    public UserResource() {
        this.userService = ServiceRegistry.userService();
    }
}
```

Better with explicit registration:

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        UserService userService = new UserService();

        register(new UserResource(userService));
        register(GlobalExceptionMapper.class);
    }
}
```

Or use HK2 binder:

```java
register(new AbstractBinder() {
    @Override
    protected void configure() {
        bind(UserService.class).to(UserService.class).in(Singleton.class);
    }
});
```

But avoid overcomplicating DI.

If your app needs full enterprise DI:

```text
Tomcat + CDI integration
or Jakarta EE server
or another app framework
```

may be more appropriate.

---

## 24. Resource Lifecycle Warning

If you register instances:

```java
register(new UserResource(userService));
```

the resource instance is shared.

Do not store per-request mutable state in fields.

Bad:

```java
private String currentUserId;
```

Good:

```java
public Response get(@PathParam("id") String id) {
    String currentUserId = id;
    ...
}
```

This rule matters especially in Tomcat because many request threads can invoke the same singleton instance concurrently if you registered it that way.

---

## 25. Database Pooling

Tomcat can define JNDI resources, but many Jersey-on-Tomcat apps use application-managed pools such as HikariCP.

Two options:

### App-managed HikariCP

Pros:

- portable,
- app owns config,
- easy in Docker,
- common for microservices.

Cons:

- app owns lifecycle,
- app owns monitoring,
- not server-managed transaction integration.

### Tomcat JNDI DataSource

Pros:

- configured in Tomcat,
- can be environment-specific,
- visible to container,
- traditional enterprise style.

Cons:

- more server config coupling,
- container deployment complexity,
- less self-contained app artifact.

Decision:

```text
If using Tomcat as lightweight servlet container in Kubernetes:
  app-managed pool is common.

If using shared Tomcat managed by ops:
  JNDI datasource may align better.
```

Either way:

```text
DB pool size must align with Tomcat threads and workload.
```

---

## 26. Health Endpoints

Health resource:

```java
@Path("/health")
public final class HealthResource {

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
        if (Readiness.isReady()) {
            return Response.ok("ready").build();
        }
        return Response.status(503).entity("not ready").build();
    }
}
```

Paths depend on context and servlet mapping.

Example:

```text
context:
  /my-api

servlet mapping:
  /api/*

resource:
  /health/ready

final:
  /my-api/api/health/ready
```

Kubernetes probe must use final internal path.

---

## 27. Readiness Semantics in Tomcat

Readiness should represent:

```text
webapp deployed
Jersey initialized
critical config loaded
critical dependencies available if required
not shutting down
not overloaded beyond policy
```

Tomcat itself may be up while webapp failed deployment.

A load balancer checking only:

```text
/
```

or Tomcat port open is insufficient.

Probe the application endpoint:

```text
/my-api/api/health/ready
```

not merely port 8080.

---

## 28. Graceful Shutdown

Tomcat process receives SIGTERM.

Shutdown should:

```text
stop accepting new requests
allow in-flight requests to finish within timeout
destroy webapp context
call listener/resource cleanup
stop connector
exit process
```

In Docker/Kubernetes:

```text
terminationGracePeriodSeconds
```

must align with Tomcat shutdown behavior and request duration.

Application must close:

- DB pools,
- HTTP clients,
- schedulers,
- custom executors,
- telemetry exporters.

Use `ServletContextListener`:

```java
public final class AppLifecycleListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        AppComponents.start();
        Readiness.markReady();
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        Readiness.markNotReady();
        AppComponents.close();
    }
}
```

Register in `web.xml` or annotation.

---

## 29. ServletContextListener

`ServletContextListener` is useful for:

```text
startup initialization
fail-fast validation
dependency container creation
readiness state
cleanup
```

Example:

```java
@WebListener
public final class AppLifecycleListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent event) {
        AppComponents.initialize();
        Readiness.markReady();
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        Readiness.markNotReady();
        AppComponents.shutdown();
    }
}
```

Be careful:

```text
If initialization fails, deployment should fail.
Do not swallow startup exceptions.
```

---

## 30. Logging

Tomcat has its own logging.

Your app has its own logging.

You need to avoid confusion:

```text
catalina.out
localhost.log
access log
application log
GC log
container stdout
```

In Docker/Kubernetes, prefer:

```text
application logs to stdout/stderr
structured JSON logs if platform supports it
Tomcat logs routed consistently
```

Avoid writing important logs only to files inside ephemeral containers unless log collector reads them.

---

## 31. Security

Security layers:

```text
reverse proxy/gateway
Tomcat connector/valves
Servlet filters
Jersey ContainerRequestFilter
resource annotations
domain authorization
```

Typical auth filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class AuthenticationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String authorization = requestContext.getHeaderString("Authorization");

        if (authorization == null || authorization.isBlank()) {
            throw new NotAuthorizedException("Missing Authorization header");
        }

        // validate token
    }
}
```

CORS can be Jersey filter or servlet filter.

Important:

```text
OPTIONS preflight may need special handling.
Do not log tokens.
Do not trust forwarded headers from untrusted clients.
Do not rely only on URL path role rules for domain authorization.
```

---

## 32. Tomcat Behind TLS Termination

Most production Tomcat setups terminate TLS at:

```text
ALB
nginx
Apache httpd
Ingress
API Gateway
```

Tomcat sees HTTP internally.

Need to configure scheme awareness via proxy headers/RemoteIpValve or connector attributes.

Otherwise:

```text
request.isSecure() false
generated URLs use http
redirects wrong
cookies may miss Secure assumptions
```

If Tomcat terminates TLS itself, then Tomcat owns:

- keystore,
- ciphers,
- protocols,
- cert rotation,
- mTLS config,
- TLS monitoring.

In Kubernetes/cloud, gateway TLS is usually simpler.

---

## 33. Static Resources and SPA

Tomcat can serve static resources.

If Jersey mapped to `/api/*`, static resources can exist at:

```text
/assets/*
/index.html
```

If Jersey mapped to `/*`, it may intercept all paths.

Avoid API/SPAs ambiguity:

```text
/api/*      -> Jersey
/assets/*   -> static
/           -> SPA
```

If SPA fallback returns `index.html` for `/api/missing`, API clients get HTML instead of JSON error.

Make API 404 and SPA fallback separate.

---

## 34. Dockerizing Tomcat + WAR

Simple Dockerfile:

```Dockerfile
FROM tomcat:10.1-jre21

RUN rm -rf /usr/local/tomcat/webapps/*

COPY target/my-api.war /usr/local/tomcat/webapps/ROOT.war

EXPOSE 8080
```

Concerns:

```text
base image version
Java version
Tomcat version
non-root user
server.xml config
logging config
context path
health endpoint
shutdown
timezone
CA certificates
SBOM
vulnerability scanning
```

Using `ROOT.war` means context path:

```text
/
```

Using `my-api.war` means context path:

```text
/my-api
```

unless overridden.

---

## 35. Kubernetes with Tomcat

Example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jersey-tomcat-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jersey-tomcat-api
  template:
    metadata:
      labels:
        app: jersey-tomcat-api
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: tomcat
          image: example/jersey-tomcat-api:1.0.0
          ports:
            - containerPort: 8080
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
            failureThreshold: 60
```

This assumes:

```text
WAR deployed as ROOT.war
Jersey mapping /api/*
Health resource /health
```

If WAR context is `/my-api`, probe path becomes:

```text
/my-api/api/health/ready
```

Probe path mistakes are common.

---

## 36. Deployment Modes in Tomcat

### Exploded WAR

```text
webapps/my-api/
```

Pros:

- easier inspection,
- faster incremental dev in some setups.

Cons:

- can drift,
- harder immutable artifact discipline.

### Packed WAR

```text
webapps/my-api.war
```

Pros:

- immutable artifact,
- clean deploy,
- easy checksum.

Cons:

- Tomcat may unpack,
- startup includes unpack/deploy.

### Docker Image with WAR

Pros:

- immutable runtime,
- environment parity,
- Kubernetes-friendly.

Cons:

- server config and app release coupled in image.

Production recommendation:

```text
Use immutable image or immutable WAR deployment.
Avoid manual mutation of exploded webapps.
```

---

## 37. Hot Redeploy Risk

Tomcat supports redeploy, but redeploy can leak if app is careless.

Common leaks:

```text
threads not stopped
ThreadLocal not cleared
JDBC driver leak
HTTP client pool not closed
scheduler still running
static singleton references
MBean not unregistered
logging classloader references
```

If your operation model uses rolling container replacement, hot redeploy matters less.

If you deploy WARs into long-running Tomcat, test redeploy.

Tomcat may warn about webapp memory leaks.

Do not ignore those warnings.

---

## 38. Startup Failure Diagnostics

Common startup failures:

```text
ClassNotFoundException: org.glassfish.jersey.servlet.ServletContainer
  missing jersey-container-servlet-core

NoClassDefFoundError: jakarta/ws/rs/core/Application
  missing Jakarta REST API or wrong dependency scope

ClassNotFoundException: javax/ws/rs/Path
  namespace mismatch

InjectionManagerFactory not found
  missing jersey-hk2

MessageBodyWriter not found
  missing/unregistered JSON provider

404 for all resources
  servlet mapping/application path/resource registration mismatch
```

First diagnostic steps:

```text
inspect WAR WEB-INF/lib
check dependency tree
check Tomcat version
check imports javax vs jakarta
check servlet mapping
check context path
check startup logs
```

---

## 39. Inspect Final WAR

Commands:

```bash
jar tf target/my-api.war | grep WEB-INF/lib
jar tf target/my-api.war | grep jersey
jar tf target/my-api.war | grep jakarta.ws.rs
jar tf target/my-api.war | grep javax.ws.rs
jar tf target/my-api.war | grep ServletContainer
```

Expected for Tomcat 10.1 + Jersey 3.x:

```text
jersey-server
jersey-container-servlet-core
jersey-hk2
jersey-media-json-jackson
jakarta.ws.rs-api maybe packaged depending dependency
NO javax.ws.rs-api
NO javax.servlet-api if scope provided
```

Expected for Tomcat 9 + Jersey 2.x:

```text
jersey-server 2.x
jersey-container-servlet-core 2.x
jersey-hk2 2.x
javax.ws.rs-api
NO jakarta.ws.rs-api
NO javax.servlet-api if scope provided
```

---

## 40. Code Source Diagnostic

Add temporary diagnostic endpoint in non-prod:

```java
@Path("/diagnostics/runtime")
public final class RuntimeDiagnosticResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String runtime() {
        return String.join("\n",
            codeSource(jakarta.ws.rs.core.Response.class),
            codeSource(org.glassfish.jersey.servlet.ServletContainer.class),
            codeSource(org.glassfish.jersey.server.ResourceConfig.class)
        );
    }

    private static String codeSource(Class<?> type) {
        var source = type.getProtectionDomain().getCodeSource();
        return type.getName() + " -> " +
            (source == null ? "<unknown>" : source.getLocation());
    }
}
```

For Jersey 2/Tomcat 9, use `javax.ws.rs.core.Response`.

This tells you where classes are actually loaded from.

Protect or remove this endpoint in production.

---

## 41. Performance Tuning Approach

Do not start with random `maxThreads`.

Use measurement.

Steps:

```text
1. Define workload:
   read/write ratio, payload size, downstream latency.

2. Define SLO:
   p95/p99 latency, error rate, throughput.

3. Tune DB pool:
   based on DB capacity.

4. Tune Tomcat maxThreads:
   based on blocking profile and DB/downstream limits.

5. Tune timeouts:
   client, proxy, Tomcat, app, downstream.

6. Load test:
   normal, burst, slow downstream, DB saturation.

7. Observe:
   thread usage, GC, CPU, heap, DB pool, response codes.
```

Tomcat tuning without downstream tuning is incomplete.

---

## 42. Failure Under Downstream Slowness

Scenario:

```text
Downstream API latency rises from 100ms to 10s.
```

If app timeout is 60s and Tomcat maxThreads is 200:

```text
200 Tomcat threads block
new requests queue
health may still pass
client retries increase
system collapses
```

Better:

```text
downstream timeout 2s
circuit breaker opens
return controlled 503/ fallback
readiness maybe degrades if critical
threads recover
```

Deployment model includes failure policy.

---

## 43. Practical Production Defaults

For many Tomcat + Jersey APIs:

```text
- use /api/* Jersey mapping
- deploy as ROOT.war in container image if service dedicated
- keep Tomcat lib clean
- package Jersey in WAR
- servlet-api scope provided
- use Jersey BOM
- explicit ResourceConfig registration
- explicit JSON provider
- request id filter
- global exception mapper
- health live/ready
- access logs enabled
- reverse proxy headers configured
- app-managed DB pool unless org standard says JNDI
- Docker image immutable
- Kubernetes startup/readiness/liveness probes
- graceful shutdown tested
```

This is a strong baseline.

---

## 44. Anti-Patterns

### Anti-Pattern 1 — Putting Jersey in Tomcat Global Lib

This increases blast radius and classloader risk.

### Anti-Pattern 2 — Mixing Tomcat 9 with Jakarta Imports

Tomcat 9 is `javax.servlet` era.

### Anti-Pattern 3 — Mixing Tomcat 10/11 with `javax.ws.rs`

Tomcat 10/11 are Jakarta namespace era.

### Anti-Pattern 4 — Probe Only Tomcat Port

Port open does not mean webapp ready.

### Anti-Pattern 5 — Massive `maxThreads` with Tiny DB Pool

This creates waiting, not throughput.

### Anti-Pattern 6 — SPA Fallback Catches API Errors

API clients should not receive `index.html`.

### Anti-Pattern 7 — Manual Mutation of Exploded WAR in Production

This destroys artifact reproducibility.

---

## 45. Decision Matrix

| Dimension | Tomcat + Jersey |
|---|---|
| Runtime ownership | Tomcat owns Servlet; app owns Jersey |
| Artifact | WAR |
| Best for | practical REST APIs needing Servlet container |
| Full Jakarta EE services | No |
| Classloader complexity | moderate |
| Operational maturity | high |
| Docker/Kubernetes fit | good |
| Main strength | simple, mature, familiar |
| Main risk | namespace/dependency/classloader mismatch |
| Good for enterprise REST | yes |
| Good for full platform needs | no, use Jakarta EE server |

---

## 46. When to Choose Tomcat

Choose Tomcat + Jersey when:

```text
- REST API fits Servlet model
- you do not need full Jakarta EE server
- ops team understands Tomcat
- WAR deployment is desired
- app can own Jersey/runtime dependencies
- Docker/Kubernetes image can bundle Tomcat+WAR
- servlet filters/access logs/reverse proxy integration are enough
```

Do not choose Tomcat when:

```text
- you need server-managed JTA/CDI/JPA/JMS platform
- you need embedded single-jar runtime
- you require Netty event-driven networking
- you want vendor Jakarta EE full platform features
```

---

## 47. Top-Tier Engineering Perspective

A basic engineer says:

```text
Deploy WAR to Tomcat.
```

A senior engineer asks:

```text
Which Tomcat version and which Jersey namespace?
```

A top-tier engineer defines:

```text
- Tomcat generation
- Java version
- Servlet namespace
- Jersey major version
- dependency ownership
- classloader boundary
- context path
- servlet mapping
- proxy rewrite contract
- thread/connection/timeout policy
- access log and correlation strategy
- health/readiness semantics
- graceful shutdown behavior
- Docker/Kubernetes path
- rollback artifact
```

Tomcat is simple only when the deployment contract is explicit.

---

## 48. Production Readiness Checklist

```text
[ ] Tomcat version pinned.
[ ] Java runtime version pinned and supported.
[ ] Tomcat namespace generation known.
[ ] Jersey major version aligned.
[ ] No mixed javax/jakarta dependency.
[ ] Servlet API dependency scope is provided.
[ ] Jersey runtime packaged in WAR.
[ ] Jersey BOM used.
[ ] Final WAR inspected.
[ ] Tomcat global lib kept clean.
[ ] Context path documented.
[ ] Jersey servlet mapping documented.
[ ] Reverse proxy path documented.
[ ] Health endpoints implemented.
[ ] Kubernetes probe paths validated.
[ ] Access logs enabled.
[ ] Request correlation implemented.
[ ] Remote/proxy IP handling configured.
[ ] TLS termination ownership decided.
[ ] Connector maxThreads reviewed.
[ ] DB pool size aligned with request threads.
[ ] Timeouts aligned across client/proxy/Tomcat/app/downstream.
[ ] Request size limits enforced.
[ ] JSON provider registered and tested.
[ ] Exception mapper registered.
[ ] Startup failure fails deployment.
[ ] App resources close on contextDestroyed.
[ ] Redeploy leak tested if relevant.
[ ] Docker image immutable.
[ ] Rollback tested.
```

---

## 49. Summary

Tomcat is one of the most practical production deployment models for Jersey.

Its essence:

```text
Tomcat handles HTTP + Servlet.
Jersey handles REST.
Application owns Jersey dependencies.
```

It is simpler than full Jakarta EE server, but more structured than embedded raw server models.

Its most important risks are:

- wrong namespace,
- wrong dependency scope,
- missing Jersey servlet adapter,
- context path/mapping confusion,
- classloader pollution,
- connector/thread misconfiguration,
- poor timeout alignment,
- weak readiness/shutdown behavior.

Used well, Tomcat + Jersey is boring, stable, and production-friendly.

Used casually, it becomes a source of invisible deployment bugs.

---

## 50. How This Part Connects to the Next Part

This part covered Tomcat as a practical Servlet container.

Next:

```text
Part 16 — Jetty External Deployment: WAR vs Embedded Trade-Off
```

We already discussed embedded Jetty in Part 11.

Part 16 will focus on external Jetty:

```text
Jetty installed/running as server
WAR deployed into it
application no longer owns server process
```

We will compare:

- external Jetty vs embedded Jetty,
- Jetty handler/server config vs WAR app config,
- classloader behavior,
- deployment manager,
- startup scanning,
- operational model,
- thread pool/connectors,
- when external Jetty is better than Tomcat or embedded Jetty.

---

## References

- Apache Tomcat 10.1 Class Loader How-To: https://tomcat.apache.org/tomcat-10.1-doc/class-loader-howto.html
- Apache Tomcat Which Version Do I Want?: https://tomcat.apache.org/whichversion.html
- Apache Tomcat 10.1 HTTP Connector Configuration Reference: https://tomcat.apache.org/tomcat-10.1-doc/config/http.html
- Apache Tomcat 10.1 Connectors How-To: https://tomcat.apache.org/tomcat-10.1-doc/connectors.html
- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Eclipse Jersey 2.x User Guide — Servlet containers without integrated JAX-RS implementation: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/user-guide.html
- Jersey `ServletContainer` API: https://eclipse-ee4j.github.io/jersey.github.io/apidocs/2.35/jersey/org/glassfish/jersey/servlet/ServletContainer.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-014.md">⬅️ Part 14 — Jakarta EE Server Deployment: GlassFish, Payara, Open Liberty, WildFly, dan Runtime Managed Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-016.md">Part 16 — Jetty External Deployment: WAR vs Embedded Trade-Off ➡️</a>
</div>
