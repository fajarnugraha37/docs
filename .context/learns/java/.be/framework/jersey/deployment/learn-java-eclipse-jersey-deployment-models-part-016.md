# learn-java-eclipse-jersey-deployment-models-part-016  
# Part 16 — Jetty External Deployment: WAR vs Embedded Trade-Off

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 16 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey pada Jetty standalone/external server, serta trade-off terhadap embedded Jetty dan Tomcat.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: deployment WAR ke Jetty external/standalone, Jetty deployment manager, classloading, modules, connector/thread model, WAR lifecycle, operational ownership, dan perbandingan dengan embedded Jetty.

---

## 1. Apa Itu External Jetty Deployment?

External Jetty deployment adalah model ketika Jetty dijalankan sebagai server terpisah, lalu aplikasi Jersey dikemas sebagai WAR dan dideploy ke Jetty.

Topology:

```text
Client
  ↓
Reverse proxy / load balancer / ingress
  ↓
Jetty standalone server
  ↓
Jetty connector
  ↓
Jetty handler/context/deployment layer
  ↓
Web application context
  ↓
Jersey ServletContainer
  ↓
Jersey runtime
  ↓
Resource method
  ↓
Provider pipeline
  ↓
Jetty response
  ↓
Client
```

Dibanding embedded Jetty:

```text
Embedded Jetty:
  application creates Jetty Server from main()

External Jetty:
  Jetty server starts independently
  application is deployed into it
```

Dibanding Tomcat:

```text
Tomcat:
  servlet-container-first mental model

Jetty:
  server/connector/handler/module/context mental model
```

Jetty bisa menjadi Servlet container, tetapi arsitekturnya lebih general: Jetty juga kuat sebagai HTTP server library, handler-based server, dan embedded runtime.

---

## 2. Mental Model Utama

External Jetty memisahkan ownership:

```text
Jetty server owns:
  process startup
  connector configuration
  thread pool
  handler tree
  deployment manager
  webapp lifecycle
  server modules
  access logging
  TLS connector if configured
  operational server config

Application owns:
  WAR contents
  Jersey runtime dependencies unless server provides them
  Jersey ServletContainer configuration
  REST resources/providers
  application config
  business dependencies
  app lifecycle cleanup
```

Ini berbeda dari embedded Jetty:

```text
Embedded:
  app and server are one deployable runtime

External:
  server runtime and app artifact are separate
```

Trade-off inti:

```text
Embedded Jetty:
  stronger application self-containment

External Jetty:
  stronger platform/server separation
```

---

## 3. Kapan External Jetty Cocok?

External Jetty cocok ketika:

1. Tim ops ingin mengelola Jetty sebagai runtime platform.
2. WAR deployment menjadi standar organisasi.
3. Banyak webapp dideploy ke server yang sama.
4. Server config dikelola terpisah dari app release.
5. Butuh deployment manager, webapps directory, atau context XML.
6. Ingin Jetty-specific server config tanpa memasukkannya ke application code.
7. Aplikasi berasal dari WAR ecosystem.
8. Ingin runtime behavior lebih dekat ke servlet container.
9. Perlu memisahkan patch server dari patch aplikasi.
10. Ada compliance/governance yang mensyaratkan managed server installation.

External Jetty kurang cocok ketika:

- satu service satu process/image lebih disukai,
- app team ingin full ownership runtime,
- Kubernetes immutable image model lebih dominan,
- server config drift sulit dikendalikan,
- tidak ada kebutuhan WAR/server separation,
- startup/runtime parity local-prod lebih penting.

Rule:

```text
Choose external Jetty when server-as-platform separation is valuable.
Choose embedded Jetty when self-contained app runtime is more valuable.
```

---

## 4. Jetty 12: Core vs Servlet Environments

Jetty 12 penting karena arsitekturnya lebih eksplisit terhadap environment.

Jetty 12 memperkenalkan pemisahan yang lebih jelas antara Jetty Core dan Servlet/Jakarta EE environments. Dokumentasi Jetty menyebut adanya module `ee{8,9,10,11}-deploy` untuk deployment web applications sesuai spesifikasi Java/Jakarta EE masing-masing, dan beberapa environment dapat diaktifkan bersamaan untuk mendukung aplikasi lama dan baru.

Mental model:

```text
Jetty Core:
  HTTP server, connectors, handlers, core runtime

Jetty EE environments:
  ee8, ee9, ee10, ee11 deployment support
```

Ini penting untuk Jersey:

```text
Jersey 2.x / javax.ws.rs:
  cocok dengan Java EE 8 / javax servlet environment

Jersey 3.x / jakarta.ws.rs:
  cocok dengan Jakarta EE 9/10 style environment

Jersey 4.x / Jakarta REST 4.0:
  cocok dengan Jakarta EE 11 generation
```

Jetty 12 can support multiple EE environments, but that does not mean one WAR can mix namespaces.

Each application still must be coherent.

---

## 5. Version and Namespace Matrix

Simplified practical matrix:

```text
Java 8:
  Jetty 9.x era
  javax.servlet
  Jersey 2.x
  javax.ws.rs

Java 11:
  Jetty 9/10/11 depending migration
  Jersey 2.x or 3.x depending namespace

Java 17:
  Jetty 11/12
  Jakarta namespace for modern apps
  Jersey 3.x/4.x depending target

Java 21/25:
  Jetty 12.x likely for modern deployment
  Jakarta EE 10/11 environments
  Jersey 3.x/4.x
```

Critical invariant:

```text
Jetty EE environment + Servlet namespace + Jersey major + app imports must align.
```

Bad combinations:

```text
Jetty ee10/ee11 + Jersey 2.x javax.ws.rs app
Jetty ee8 + Jersey 3.x jakarta.ws.rs app
Jersey 3.x runtime + javax.ws.rs resource imports
Jersey 2.x runtime + jakarta.ws.rs resource imports
```

---

## 6. WAR Deployment Format

Jetty supports deployment of web applications as:

```text
*.war file
directory with WAR structure
```

WAR structure:

```text
my-api.war
├─ index.html optional
├─ META-INF/
├─ WEB-INF/
│  ├─ web.xml optional
│  ├─ jetty-web.xml optional
│  ├─ classes/
│  │  └─ com/example/...
│  └─ lib/
│     ├─ jersey-server.jar
│     ├─ jersey-container-servlet-core.jar
│     ├─ jersey-hk2.jar
│     ├─ jersey-media-json-jackson.jar
│     └─ app-dependencies.jar
```

Jetty may also use context XML files to configure deployment.

In Jetty 12 documentation, Jakarta EE web applications are described as usual WAR files or WAR-structured directories, optionally with in-application Jetty context XML under `WEB-INF`.

---

## 7. Deployment Manager and Webapps

External Jetty typically uses a deployment mechanism.

Conceptually:

```text
$JETTY_BASE/webapps/
  ├─ my-api.war
  ├─ root.war
  └─ my-api.xml optional context config
```

Jetty deployment manager scans configured deployment locations and deploys webapps.

Deployment flow:

```text
Jetty starts
  ↓
modules initialize
  ↓
deployment manager scans webapps
  ↓
WAR/context XML found
  ↓
WebAppContext created
  ↓
Servlet/Jersey initialized
  ↓
webapp available
```

Operational implication:

```text
A Jetty process can be up while a specific webapp failed deployment.
```

Therefore readiness must probe the application path, not just Jetty port.

---

## 8. `JETTY_HOME` vs `JETTY_BASE`

Jetty commonly separates:

```text
JETTY_HOME:
  Jetty distribution installation

JETTY_BASE:
  specific server instance configuration
```

Mental model:

```text
JETTY_HOME is product/runtime.
JETTY_BASE is environment/server instance.
```

This allows multiple server bases to share one Jetty installation.

Production rule:

```text
Version and manage JETTY_BASE configuration.
Do not mutate JETTY_HOME casually.
```

For Docker images, often:

```text
image contains Jetty distribution + server config + WAR
```

But still conceptually separate runtime from server instance config.

---

## 9. Dependency Ownership

For external Jetty + Jersey, typical ownership is similar to Tomcat.

Jetty owns:

```text
HTTP server
Servlet container environment
webapp lifecycle
connector/thread pool
server modules
```

Application owns:

```text
Jersey runtime
Jersey servlet adapter
Jersey injection integration
JSON provider
business dependencies
```

Unless you explicitly install shared libraries/modules.

Usually:

```text
Servlet API:
  provided by Jetty environment

Jersey implementation:
  packaged in WAR
```

Do not place Jersey jars in Jetty global/shared location unless you intentionally want shared runtime and have tested classloader behavior.

---

## 10. Maven Dependency Example: Jersey 3.x on Jakarta Jetty

Conceptual:

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
    <scope>provided</scope>
  </dependency>
</dependencies>
```

For Jersey 2.x / Java EE 8 style:

```xml
<dependency>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
```

and resources import:

```java
javax.ws.rs.*
```

---

## 11. Jersey ServletContainer in External Jetty

`web.xml`:

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

Path composition:

```text
Jetty context path:
  /my-api

Jersey servlet mapping:
  /api/*

Resource:
  /users

Final:
  /my-api/api/users
```

---

## 12. `jetty-web.xml` and Context XML

Jetty supports Jetty-specific deployment descriptors/config.

Examples:

```text
WEB-INF/jetty-web.xml
```

or external context XML:

```text
$JETTY_BASE/webapps/my-api.xml
```

Use cases:

- context path override,
- webapp-specific classloader settings,
- temp directory/extract WAR settings,
- environment entries,
- server-specific configuration.

Good use:

```text
server-specific deployment metadata separated from portable web.xml
```

Risk:

```text
application becomes Jetty-specific
```

Top-tier rule:

```text
Use Jetty-specific descriptors for deployment concerns, not business behavior.
```

---

## 13. WAR vs Context XML Deployment

### Direct WAR

```text
webapps/my-api.war
```

Simple.

Context path often from filename:

```text
/my-api
```

### Context XML pointing to WAR

```xml
<Configure class="org.eclipse.jetty.ee10.webapp.WebAppContext">
  <Set name="contextPath">/api</Set>
  <Set name="war">/opt/apps/my-api.war</Set>
</Configure>
```

Actual class names differ by Jetty version/environment.

Benefits:

- context path explicit,
- WAR location external,
- additional config,
- easier advanced deployment.

Risk:

- Jetty-version-specific XML,
- more moving parts,
- misalignment with app assumptions.

---

## 14. WAR Extraction and Quickstart

Jetty can run WARs directly or unpack them.

Jetty documentation notes that for quickstart optimization, if the application is a WAR, it may need to be unpacked manually or configured with `WebAppContext.setExtractWAR(true)`. By default, Jetty may unpack to temporary locations that are not reused between executions.

Implications:

```text
startup time
temporary disk usage
container filesystem behavior
read-only filesystem compatibility
repeatability
quickstart optimization
```

In Docker/Kubernetes with read-only root filesystem, WAR extraction needs careful temp directory setup.

Checklist:

```text
[ ] Is WAR extracted?
[ ] Where is temp directory?
[ ] Is filesystem writable?
[ ] Is startup time acceptable?
[ ] Is quickstart/precompiled metadata used?
```

---

## 15. Classloader Model

External Jetty has classloader boundaries similar in spirit to other servlet containers, but implementation details differ.

Main idea:

```text
server classes
  vs
webapp classes
```

Webapp has:

```text
WEB-INF/classes
WEB-INF/lib
```

Server has:

```text
Jetty modules
server libraries
environment libraries
```

Problems occur when:

- Jersey jars exist both in server and webapp,
- Servlet API packaged in WAR,
- wrong Jakarta EE environment enabled,
- app-specific library placed globally,
- multiple webapps require conflicting versions,
- context XML changes classloader behavior.

Production rule:

```text
Keep application dependencies in WAR.
Keep Jetty server libraries server-owned.
Avoid shared libs unless governed.
```

---

## 16. Jetty Modules

Jetty standalone uses modules to enable features.

Examples conceptually:

```text
http
server
deploy
ee10-deploy
ee11-deploy
jsp
websocket
ssl
http2
logging
```

Jetty 12 has environment-specific deployment modules:

```text
ee8-deploy
ee9-deploy
ee10-deploy
ee11-deploy
```

Each supports corresponding Java/Jakarta EE web application generation.

This is powerful:

```text
one server may support multiple EE environments
```

But also dangerous if misunderstood.

Do not deploy by guessing module set.

Document required Jetty modules for each app generation.

---

## 17. External Jetty vs Embedded Jetty

| Dimension | External Jetty | Embedded Jetty |
|---|---|---|
| Server process | Separate platform | Created by app |
| Artifact | WAR + server config | jar/image |
| Ownership | Ops/platform owns server | App owns server |
| Config | Jetty base/modules/XML | Java code/app config |
| Deployment | webapps/deployment manager | process start |
| Runtime parity | depends on server config | artifact self-contained |
| Upgrade server | can patch separately | app release needed |
| Classloading | webapp/server split | usually simpler |
| Kubernetes fit | good but heavier | very good |
| Multi-app server | natural | not typical |
| Local dev parity | harder | easier |

Decision:

```text
External Jetty is platform-oriented.
Embedded Jetty is application-oriented.
```

---

## 18. External Jetty vs Tomcat

| Dimension | External Jetty | Tomcat |
|---|---|---|
| Core model | server/handler/module | servlet container |
| Servlet support | yes via EE environment | yes |
| Handler composition | strong | less central |
| Module system | explicit Jetty modules | more traditional config |
| Operational familiarity | strong but less common than Tomcat in some orgs | very common |
| Embedded parity | Jetty is strong embedded and external | Tomcat embedded possible but less central |
| HTTP/2/modern protocol flexibility | strong | strong but different model |
| Classloader | server/webapp | container/webapp |
| Best fit | teams that value Jetty architecture | teams that value servlet container standard simplicity |

Neither is universally better.

Choose based on platform standard, team expertise, and operational model.

---

## 19. Connector and Thread Pool

Jetty threading documentation states that Jetty’s default thread pool implementation is `QueuedThreadPool`, integrating with Jetty’s component model and supporting virtual threads in modern versions.

External Jetty config should consider:

```text
thread pool min/max
connector idle timeout
acceptors/selectors
request header size
response header size
HTTP/2 config
TLS config
low resource behavior
```

Blocking Jersey resources use server threads.

If resource method blocks on database:

```text
Jetty worker thread waits
```

If too many requests block:

```text
thread pool saturates
requests queue
latency rises
health may slow
```

Same invariant as Tomcat:

```text
Thread pool must align with downstream capacity.
```

---

## 20. Virtual Threads in Jetty

Jetty supports virtual thread integration in modern versions.

But do not assume it solves all blocking issues.

Virtual threads can help blocking application code scale better, but:

- DB pool still has finite connections,
- downstream services still have finite capacity,
- CPU-heavy work still consumes CPU,
- synchronized blocking can pin,
- observability changes,
- thread-local/MDC behavior must be validated,
- server and Java version must support it.

Use virtual threads as a tested execution strategy, not a magic config.

Migration rule:

```text
Do not combine Jetty major upgrade, Jersey major upgrade, Java major upgrade, and virtual threads in one uncontrolled release.
```

---

## 21. Context Path and Application Path

External Jetty path composition:

```text
external URL
  ↓
proxy rewrite
  ↓
Jetty context path
  ↓
Jersey servlet mapping
  ↓
Jersey resource path
```

Example:

```text
external:
  https://api.example.com/customer/api/users

Jetty context:
  /customer

Jersey mapping:
  /api/*

Resource:
  /users
```

Final internal path:

```text
/customer/api/users
```

Common bug:

```text
context path configured in Jetty XML differs from Kubernetes probe path
```

or:

```text
proxy strips /customer but app expects it
```

Document path contract.

---

## 22. Reverse Proxy and Forwarded Headers

External Jetty often sits behind:

```text
nginx
HAProxy
Apache httpd
AWS ALB
Kubernetes ingress
API gateway
service mesh
```

Need policy for:

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Request-Id
```

Problems if ignored:

- wrong scheme,
- wrong generated URL,
- wrong redirects,
- wrong audit client IP,
- wrong CORS behavior,
- secure cookie mistakes.

Rule:

```text
Trust forwarded headers only from known proxy boundary.
```

Configure at Jetty/proxy/app layer intentionally.

---

## 23. Access Logging

Jetty can provide access logs.

Standardize:

```text
timestamp
method
path
status
duration
request id
remote address
forwarded client
bytes
user agent
principal if safe
```

If multiple webapps run in one Jetty server, access logs should allow identifying:

```text
which context/app handled the request
```

Access log and app log correlation requires request ID propagation.

---

## 24. JSON Provider in External Jetty

Jetty does not magically provide Jersey JSON provider for your app.

WAR should include:

```text
jersey-media-json-jackson
```

or equivalent provider.

Register explicitly:

```java
register(JacksonFeature.class);
```

Test:

```text
GET JSON
POST JSON
invalid JSON
date/time serialization
validation errors
```

If using server/global providers, document and lock versions.

---

## 25. Dependency Injection

External Jetty alone does not mean full CDI platform.

Your Jersey app commonly uses:

```text
jersey-hk2
```

or explicit construction.

If you need CDI:

```text
configure CDI integration intentionally
or use Jakarta EE server/Open Liberty/Payara/etc.
```

Do not assume because Jetty supports Jakarta EE webapp environment that all full platform services are available like a full Jakarta EE server.

Jetty is not the same as Payara/WildFly/Open Liberty full platform.

---

## 26. Security

Security layers:

```text
reverse proxy/gateway
Jetty server/security handlers
Servlet filters
Jersey filters
resource annotations
domain authorization
```

For many Jersey-on-Jetty apps:

- authentication happens in gateway or Jersey filter,
- authorization happens in domain/service layer,
- TLS terminates at proxy,
- Jetty enforces connector-level policies.

If using Jetty security features, document:

```text
realm
auth mechanism
role mapping
constraint mapping
session behavior
```

Do not put complex regulatory authorization only in URL path constraints.

---

## 27. Health and Readiness

Application health path depends on context/mapping.

Example:

```text
Jetty context path:
  /case-api

Jersey servlet mapping:
  /api/*

Resource:
  /health/ready

Probe path:
  /case-api/api/health/ready
```

Important:

```text
Jetty server up != webapp ready
```

Probe application endpoint.

If deployment manager has failed the WAR, Jetty may still return something on port 8080 for other contexts, but your app is not ready.

---

## 28. Graceful Shutdown

External Jetty shutdown involves:

```text
stop accepting new traffic
stop contexts
destroy webapps
call lifecycle callbacks
stop connectors
stop thread pool
exit process
```

Application must clean up in webapp lifecycle:

```java
public final class AppLifecycleListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent event) {
        AppComponents.start();
        Readiness.markReady();
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        Readiness.markNotReady();
        AppComponents.close();
    }
}
```

Close:

- DB pools,
- HTTP clients,
- executors,
- schedulers,
- telemetry exporters,
- file watchers.

If running in Kubernetes, align:

```text
terminationGracePeriodSeconds
Jetty stop timeout
application shutdown time
load balancer drain
```

---

## 29. Redeploy Risk

External Jetty supports deployment/redeployment.

Redeploy risk:

```text
unclosed threads
ThreadLocal leaks
static singletons
unclosed classloader references
MBeans not unregistered
JDBC drivers
logging framework references
scheduled tasks
```

If using hot redeploy:

```text
test deploy/undeploy/redeploy loop
monitor heap/metaspace/thread count
watch server logs for leak warnings
```

If using container replacement:

```text
redeploy leaks matter less but still matter in local/test or long-running servers
```

---

## 30. Startup Performance

External Jetty startup includes:

```text
server startup
module initialization
deployment scan
WAR extraction if needed
annotation scanning
Jersey resource/provider initialization
app dependency initialization
```

Large WARs with many dependencies can start slowly due to scanning.

Optimization options:

- explicit Jersey registration,
- reduce classpath,
- avoid broad package scanning,
- use Jetty quickstart where appropriate,
- pre-extract WAR if needed,
- avoid unnecessary modules,
- remove unused dependencies.

Do not optimize until you measure.

---

## 31. Dockerizing External Jetty

Conceptual Dockerfile:

```Dockerfile
FROM eclipse-temurin:21-jre

ENV JETTY_HOME=/opt/jetty
ENV JETTY_BASE=/var/lib/jetty

# install/copy Jetty distribution and base config
# copy WAR into webapps

COPY target/my-api.war /var/lib/jetty/webapps/root.war

EXPOSE 8080

CMD ["/opt/jetty/bin/jetty.sh", "run"]
```

In real images, prefer official/reputable Jetty base image if available and aligned with your security requirements.

Concerns:

```text
- Jetty version
- Java version
- enabled modules
- JETTY_BASE config
- non-root user
- writable temp dir for WAR extraction
- logs to stdout
- context path
- health probes
- TLS/proxy config
- SBOM/vulnerability scanning
```

---

## 32. Kubernetes Deployment

Example if WAR deployed as root context and Jersey mapping `/api/*`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jersey-jetty-external-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jersey-jetty-external-api
  template:
    metadata:
      labels:
        app: jersey-jetty-external-api
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: jetty
          image: example/jersey-jetty-external-api:1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 8080
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 8080
          startupProbe:
            httpGet:
              path: /api/health/live
              port: 8080
            periodSeconds: 2
            failureThreshold: 60
```

If context is `/my-api`:

```text
/my-api/api/health/ready
```

Probe path must match actual deployment context.

---

## 33. Multiple Applications in One Jetty Server

External Jetty can deploy multiple webapps:

```text
/app-a
/app-b
/app-c
```

Pros:

- shared server platform,
- fewer processes,
- centralized config.

Cons:

- blast radius,
- noisy neighbor,
- classloader complexity,
- coordinated server upgrades,
- resource contention,
- harder Kubernetes scaling per app,
- harder per-app release isolation.

Modern containerized architecture often prefers:

```text
one app per container/process
```

But shared Jetty can still be valid in legacy or platform-managed environments.

Top-tier decision:

```text
Do not deploy multiple apps together unless shared runtime is a deliberate platform choice.
```

---

## 34. Failure Modes

### 34.1 Wrong EE Environment Module

Symptom:

```text
ClassNotFoundException: javax.servlet.*
or jakarta.servlet.*
```

Cause:

```text
Jetty environment module does not match WAR namespace
```

Fix:

```text
enable correct ee8/ee9/ee10/ee11 deployment module
align app namespace
```

---

### 34.2 Jersey ServletContainer Not Found

Symptom:

```text
ClassNotFoundException: org.glassfish.jersey.servlet.ServletContainer
```

Cause:

```text
WAR missing jersey-container-servlet-core
```

Fix:

```text
package Jersey servlet container adapter in WAR
```

---

### 34.3 Server Up, App Not Deployed

Symptom:

```text
Jetty port responds
app endpoint 404/503
```

Cause:

```text
WAR deployment failed
wrong context path
deployment manager did not pick up WAR
startup exception
```

Fix:

```text
check deployment logs
probe app endpoint
verify webapps path/context XML
```

---

### 34.4 Wrong Context Path

Symptom:

```text
/api/health returns 404
/my-api/api/health works
```

Cause:

```text
context path mismatch
```

Fix:

```text
document context path
align ingress/probes/tests
```

---

### 34.5 Thread Pool Saturation

Symptoms:

```text
latency high
requests queue
health slow
thread dump shows blocking DB/downstream calls
```

Fix:

```text
align Jetty threads with DB/downstream pools
timeouts
circuit breaker
load shedding
readiness degradation
```

---

### 34.6 Redeploy Leak

Symptoms:

```text
metaspace grows after redeploy
old threads still running
old classloader retained
```

Fix:

```text
close resources on contextDestroyed
avoid static singletons
test redeploy
```

---

## 35. Anti-Patterns

### Anti-Pattern 1 — Treating External Jetty and Embedded Jetty as the Same

They share Jetty, but ownership is different.

### Anti-Pattern 2 — Guessing EE Module

Jetty 12 environment module must match app generation.

### Anti-Pattern 3 — Putting App Dependencies in Server Lib

This increases blast radius.

### Anti-Pattern 4 — Relying on Port Probe

Jetty up does not mean your WAR is deployed.

### Anti-Pattern 5 — Manual Webapps Mutation in Production

Copying files manually into webapps without versioned release process is fragile.

### Anti-Pattern 6 — Multiple Apps Without Isolation Reasoning

Shared runtime can create hidden coupling.

---

## 36. Operational Decision Matrix

| Dimension | External Jetty |
|---|---|
| Runtime ownership | Server/platform |
| App artifact | WAR |
| Servlet support | yes via EE environment |
| Jersey ownership | usually application |
| Server config | JETTY_BASE/modules/XML |
| Classloading | server/webapp split |
| Best for | platform-managed WAR deployment |
| Main strength | flexible Jetty server architecture |
| Main risk | module/context/classloader mismatch |
| Docker/Kubernetes fit | good but heavier than embedded |
| Multi-app support | natural |
| App self-containment | lower than embedded |

---

## 37. WAR vs Embedded Trade-Off Summary

Choose WAR on external Jetty when:

```text
- ops/platform owns server
- WAR deployment standard exists
- multiple apps share runtime intentionally
- server config must be separate from app code
- deployment manager/context XML is useful
- app team should not own low-level server setup
```

Choose embedded Jetty when:

```text
- one app per process/image
- app team owns runtime
- local/prod parity matters
- Docker/Kubernetes immutable image is primary
- server config belongs with app release
- simpler classpath/process model desired
```

There is no universal winner.

The right choice depends on ownership, release model, and operational constraints.

---

## 38. Top-Tier Engineering Perspective

A basic engineer says:

```text
Deploy WAR to Jetty.
```

A senior engineer asks:

```text
Which Jetty version and which EE environment?
```

A top-tier engineer defines:

```text
- Jetty runtime version
- enabled modules
- Java version
- namespace generation
- context path
- Jersey servlet mapping
- dependency ownership
- classloader policy
- WAR extraction/quickstart strategy
- thread/connector configuration
- reverse proxy headers
- access log format
- health/readiness path
- shutdown/redeploy lifecycle
- Docker/Kubernetes packaging
- rollback strategy
```

External Jetty is powerful when these are explicit.

It is fragile when they are implicit.

---

## 39. Production Readiness Checklist

```text
[ ] Jetty version pinned.
[ ] Java runtime version pinned.
[ ] Correct Jetty EE deployment module enabled.
[ ] Jersey major version aligned with namespace.
[ ] No mixed javax/jakarta dependencies.
[ ] WAR contains Jersey runtime and servlet adapter.
[ ] Servlet API dependency marked provided.
[ ] Jersey BOM used.
[ ] Final WAR inspected.
[ ] Context path documented.
[ ] Jersey servlet mapping documented.
[ ] Reverse proxy path documented.
[ ] Jetty modules documented.
[ ] JETTY_BASE config versioned.
[ ] Access log strategy defined.
[ ] Forwarded header strategy defined.
[ ] Thread pool reviewed.
[ ] Connector timeouts reviewed.
[ ] Request size limits reviewed.
[ ] JSON provider registered and tested.
[ ] Health endpoints implemented.
[ ] Probe path validated against actual context.
[ ] WAR deployment failure detected by readiness.
[ ] Shutdown lifecycle tested.
[ ] App resources closed on contextDestroyed.
[ ] Redeploy tested if operationally used.
[ ] Docker image has writable temp if WAR extraction needed.
[ ] Logs routed to platform.
[ ] Rollback tested.
```

---

## 40. Summary

External Jetty deployment is a strong model when you want Jetty as an independently managed server and Jersey as a WAR-deployed web application.

Its essence:

```text
Jetty owns server runtime.
Application owns Jersey REST runtime.
WAR bridges the two.
```

Compared to embedded Jetty:

```text
External Jetty separates platform and application.
Embedded Jetty makes application self-contained.
```

The main risks are:

- wrong EE environment,
- namespace mismatch,
- context path confusion,
- classloader pollution,
- WAR deployment not detected,
- thread/timeout misconfiguration,
- redeploy leaks,
- server config drift.

Used well, external Jetty is flexible, mature, and operationally strong.

Used casually, it becomes harder to reason about than embedded deployment.

---

## 41. How This Part Connects to the Next Part

This part covered external Jetty deployment.

Next:

```text
Part 17 — GlassFish/Payara Deployment: Reference Runtime, Jakarta EE Alignment, dan Admin Model
```

The next part shifts to Jersey-native/full Jakarta EE lineage.

We will focus on:

- GlassFish/Payara as Jakarta EE server,
- server-bundled Jersey,
- admin/domain model,
- classloader delegation,
- resources/JDBC pools,
- deployment descriptors,
- monitoring/admin console,
- when to use container-owned Jersey,
- how to avoid bundling conflicts.

---

## References

- Eclipse Jetty 12.1 Operations Guide — Web Application Deployment: https://jetty.org/docs/jetty/12.1/operations-guide/deploy/index.html
- Eclipse Jetty 12.1 Operations Guide: https://jetty.org/docs/jetty/12.1/operations-guide/index.html
- Eclipse Jetty 12.1 Standard Modules — `ee{8,9,10,11}-deploy`: https://jetty.org/docs/jetty/12.1/operations-guide/modules/standard.html
- Eclipse Jetty 12.1 Programming Guide: https://jetty.org/docs/jetty/12.1/programming-guide/index.html
- Eclipse Jetty 12.1 Threading Architecture: https://jetty.org/docs/jetty/12.1/programming-guide/arch/threads.html
- Eclipse Jetty 12.1 Quickstart: https://jetty.org/docs/jetty/12.1/operations-guide/quickstart/index.html
- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-015.md">⬅️ Part 15 — Tomcat Deployment: Practical Production Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-017.md">Part 17 — GlassFish/Payara Deployment: Reference Runtime, Jakarta EE Alignment, dan Admin Model ➡️</a>
</div>
