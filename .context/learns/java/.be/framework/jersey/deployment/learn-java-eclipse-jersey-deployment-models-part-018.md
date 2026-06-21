# learn-java-eclipse-jersey-deployment-models-part-018  
# Part 18 — Open Liberty Deployment: Feature-Based Runtime

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 18 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey/Jakarta REST pada Open Liberty sebagai runtime Jakarta EE yang modular dan feature-based.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey/Jakarta REST: **Jersey 2.x, 3.x, 4.x, Jakarta REST/JAX-RS features**  
> Fokus utama: Open Liberty `server.xml`, feature selection, Jakarta REST/JAX-RS runtime ownership, WAR deployment, classloading, configuration, MicroProfile, Docker/Kubernetes, health/readiness, dan production failure model.

---

## 1. Apa Itu Open Liberty Deployment Model?

Open Liberty adalah lightweight Java runtime untuk menjalankan aplikasi enterprise Java, microservices, dan modern monoliths dengan model konfigurasi berbasis fitur.

Berbeda dari server yang selalu memuat platform penuh, Open Liberty bekerja dengan prinsip:

```text
enable only what you need
```

Di Open Liberty, runtime capability ditentukan oleh `server.xml`.

Contoh:

```xml
<server>
    <featureManager>
        <feature>restfulWS-3.1</feature>
        <feature>cdi-4.0</feature>
        <feature>jsonb-3.0</feature>
        <feature>beanValidation-3.0</feature>
    </featureManager>

    <httpEndpoint
        id="defaultHttpEndpoint"
        host="*"
        httpPort="9080"
        httpsPort="9443" />

    <webApplication
        location="my-api.war"
        contextRoot="/case-api" />
</server>
```

Mental model:

```text
Open Liberty server
  ↓
enabled features
  ↓
HTTP endpoint
  ↓
deployed application
  ↓
Jakarta REST/JAX-RS runtime
  ↓
resource method
```

The key:

> Open Liberty deployment is not just “deploy WAR to server”.  
> It is “declare a runtime capability set, then deploy application into that capability set”.

---

## 2. Feature-Based Runtime Mental Model

IBM documentation describes Liberty features as units of functionality that control which pieces of the runtime environment are loaded into a server.

This is the core design.

Instead of asking:

```text
Does the server support Jakarta EE?
```

ask:

```text
Which features are enabled for this server?
```

Examples:

```text
restfulWS-3.1
cdi-4.0
jsonb-3.0
jsonp-2.1
beanValidation-3.0
persistence-3.1
transaction-2.0
mpHealth-4.0
mpConfig-3.0
mpMetrics
```

Or convenience features:

```text
webProfile-10.0
jakartaee-10.0
```

Feature selection defines runtime behavior.

Top-tier insight:

```text
Open Liberty makes platform capability explicit.
That is its biggest strength and also a configuration responsibility.
```

If feature is not enabled, runtime support may not exist.

---

## 3. Open Liberty vs GlassFish/Payara

GlassFish/Payara mental model:

```text
full Jakarta EE server / domain / admin model
```

Open Liberty mental model:

```text
composable runtime / server.xml / enabled features
```

Comparison:

| Dimension | GlassFish/Payara | Open Liberty |
|---|---|---|
| Runtime style | full Jakarta EE server lineage | feature-based composable runtime |
| Config center | domain/admin/asadmin | `server.xml` |
| Feature loading | platform-oriented | explicit features |
| Deployment artifact | WAR/EAR | WAR/EAR, server package, container image |
| Production mode | domain/server admin model | server package/container-friendly |
| MicroProfile | supported depending runtime | strong first-class fit |
| Kubernetes fit | possible | very strong |
| Runtime size | often broader | can be minimal |
| Operational style | app-server admin | config-as-code/cloud-native |

Open Liberty is especially good when you want:

```text
managed Jakarta EE behavior
but with explicit, minimal runtime features
```

---

## 4. Open Liberty vs Tomcat

Tomcat provides Servlet runtime.

Open Liberty can provide:

```text
Servlet
Jakarta REST
CDI
JSON-B
Bean Validation
JPA
JTA
Security
MicroProfile Health
MicroProfile Config
MicroProfile Metrics
MicroProfile Fault Tolerance
```

but only when features are enabled.

Tomcat + Jersey:

```text
Tomcat owns Servlet
app owns Jersey
```

Open Liberty:

```text
Liberty can own Jakarta REST/JAX-RS implementation through features
app uses platform APIs
```

So dependency strategy differs.

On Open Liberty, do not automatically package Jersey like Tomcat.

Ask:

```text
Is Liberty providing Jakarta REST through restfulWS feature?
```

If yes, application should usually depend on API as `provided`.

---

## 5. Jersey-Specific vs Jakarta REST Runtime

Open Liberty generally should be treated as a Jakarta REST/JAX-RS runtime provider, not as “Jersey server”.

This is critical.

Your application should preferably use portable Jakarta REST APIs:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

and:

```java
import jakarta.ws.rs.core.Application;
```

Avoid Jersey-specific APIs unless you deliberately target Jersey.

Portable:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Jersey-specific:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(MyResource.class);
    }
}
```

In Open Liberty, `ResourceConfig` is not a portable assumption.

Top-tier rule:

```text
On Open Liberty, think "Jakarta REST feature", not "Jersey implementation", unless you explicitly bring Jersey yourself.
```

If your app depends heavily on Jersey-specific HK2 binders, Jersey properties, or `ResourceConfig`, Liberty portability may be reduced.

---

## 6. Feature Convenience: Web Profile and Platform

Open Liberty documentation states that you can quickly add Jakarta EE support by specifying Web Profile or Jakarta EE Platform convenience features in `server.xml`.

Examples:

```xml
<featureManager>
    <feature>webProfile-10.0</feature>
</featureManager>
```

or:

```xml
<featureManager>
    <feature>jakartaee-10.0</feature>
</featureManager>
```

Difference:

```text
webProfile:
  common web application stack

jakartaee platform:
  broader full platform stack
```

For REST APIs, `webProfile` may often be enough.

For apps requiring full platform APIs, use `jakartaee`.

But do not enable full platform just because it is easier.

Rule:

```text
Prefer the smallest feature set that satisfies application requirements.
```

---

## 7. Individual Feature Selection

Instead of convenience features, you can enable only needed features.

Example:

```xml
<featureManager>
    <feature>restfulWS-3.1</feature>
    <feature>cdi-4.0</feature>
    <feature>jsonb-3.0</feature>
    <feature>beanValidation-3.0</feature>
    <feature>mpConfig-3.0</feature>
    <feature>mpHealth-4.0</feature>
</featureManager>
```

Benefits:

- smaller runtime,
- clearer capability set,
- less accidental behavior,
- faster startup potential,
- better dependency reasoning,
- less attack surface.

Risks:

- missing feature causes runtime failure,
- version mismatch,
- config complexity,
- developers may not know which feature provides which API.

Top-tier practice:

```text
Use explicit features for production services.
Use convenience profiles when standard platform completeness is more valuable than minimality.
```

---

## 8. Jakarta REST Feature

Open Liberty has `restfulWS-*` features for JAX-RS/Jakarta REST.

Examples across generations:

```text
jaxrs-2.0
jaxrs-2.1
restfulWS-3.0
restfulWS-3.1
restfulWS-4.0
```

Actual available feature depends on Open Liberty version.

Open Liberty docs list Jakarta RESTful Web Services features, including 4.0, 3.1, 3.0, 2.1, and 2.0 references.

Mental mapping:

```text
jaxrs-2.x:
  javax.ws.rs era

restfulWS-3.x:
  jakarta.ws.rs era

restfulWS-4.0:
  Jakarta REST 4.0 / Jakarta EE 11 generation
```

Rule:

```text
Application imports must match the enabled REST feature generation.
```

---

## 9. Java 8 to Java 25 Perspective

### Java 8

Typical legacy stack:

```text
Java 8
Java EE 7/8
javax.*
jaxrs-2.x
```

Open Liberty can support older Java EE/JAX-RS features depending version.

### Java 11

Transition stack:

```text
javax or jakarta depending target
JAX-RS 2.x or Jakarta REST 3.x
```

### Java 17

Modern Jakarta EE 10 baseline is common.

```text
jakarta.*
restfulWS-3.1
webProfile-10.0
jakartaee-10.0
```

### Java 21

Jakarta EE 11 and modern Liberty releases increasingly align with Java 21 features.

Open Liberty beta/release notes in 2026 show Jakarta EE 11 Platform support work including `webProfile-11.0` and `jakartaee-11.0` features. For production, confirm whether the exact Open Liberty version you run has the required compatible feature certification.

### Java 25

As of this series date, Java 25 is current LTS-era target for your learning path, but actual Open Liberty support must be checked per release.

Rule:

```text
Do not target Java 25 bytecode unless the Open Liberty runtime version explicitly supports running on Java 25.
```

Use:

```text
maven.compiler.release
Gradle toolchains/options.release
```

to align bytecode.

---

## 10. `javax.*` vs `jakarta.*`

Open Liberty can support multiple Java EE/Jakarta EE generations depending version/features.

But one application should be coherent.

Old:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

New:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
```

If server feature is:

```xml
<feature>jaxrs-2.1</feature>
```

then application is `javax.ws.rs`.

If server feature is:

```xml
<feature>restfulWS-3.1</feature>
```

then application is `jakarta.ws.rs`.

Bad combination:

```text
restfulWS-3.1 enabled
but application compiled with javax.ws.rs
```

or:

```text
jaxrs-2.1 enabled
but application compiled with jakarta.ws.rs
```

Failure mode:

- resources not found,
- class not found,
- deployment error,
- provider mismatch.

---

## 11. `server.xml` as Deployment Contract

`server.xml` is the center of Open Liberty deployment.

Example:

```xml
<server description="case-api">

    <featureManager>
        <feature>restfulWS-3.1</feature>
        <feature>cdi-4.0</feature>
        <feature>jsonb-3.0</feature>
        <feature>beanValidation-3.0</feature>
        <feature>mpConfig-3.0</feature>
        <feature>mpHealth-4.0</feature>
    </featureManager>

    <httpEndpoint
        id="defaultHttpEndpoint"
        host="*"
        httpPort="${http.port}"
        httpsPort="${https.port}" />

    <webApplication
        location="case-api.war"
        contextRoot="/case-api" />

</server>
```

This file declares:

```text
runtime features
HTTP endpoint
ports
application location
context root
resources
security
logging
classloading
variables
```

Top-tier perspective:

```text
server.xml is not environment decoration.
It is part of the deployment artifact contract.
```

Version it. Review it. Test it.

---

## 12. Variables and Configuration

Open Liberty supports variable substitution in configuration.

Example:

```xml
<httpEndpoint
    id="defaultHttpEndpoint"
    host="*"
    httpPort="${HTTP_PORT}"
    httpsPort="${HTTPS_PORT}" />
```

You can supply variables through:

- server.env,
- bootstrap.properties,
- environment variables,
- config dropins,
- container environment.

Design goals:

```text
same server.xml across environments
different values via environment/config
```

Avoid:

```text
server-dev.xml
server-uat.xml
server-prod.xml
```

unless there is a strong reason.

Prefer:

```text
one structure
environment-specific values
```

---

## 13. WAR Deployment

Declare application:

```xml
<webApplication
    location="case-api.war"
    contextRoot="/case-api" />
```

Path composition:

```text
contextRoot:
  /case-api

@ApplicationPath:
  /api

@Path:
  /cases

final:
  /case-api/api/cases
```

REST application:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Resource:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public Response list() {
        return Response.ok(List.of()).build();
    }
}
```

Probe path:

```text
/case-api/api/health/ready
```

Do not guess paths. Compose them.

---

## 14. Dependency Scope

For Open Liberty, application should usually depend on Jakarta APIs as provided:

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
```

If Liberty feature provides REST runtime, do not bundle Jersey runtime by default.

Bad for Liberty-managed REST:

```text
WEB-INF/lib/jersey-server.jar
WEB-INF/lib/jersey-container-servlet-core.jar
WEB-INF/lib/jersey-hk2.jar
```

unless explicitly intended.

Rule:

```text
If Open Liberty owns the feature, app should not bundle competing implementation.
```

---

## 15. When Would You Bundle Jersey on Open Liberty?

Only when:

```text
- you deliberately do not use Liberty REST feature
- you deploy Jersey like on servlet container
- you need Jersey-specific behavior not available otherwise
- you understand classloader implications
- you test conflict-free behavior
```

In that case, you are treating Liberty more like a servlet container for that app.

But this is usually not the cleanest Liberty model.

Better:

```text
use Liberty REST feature
write portable Jakarta REST app
```

---

## 16. Classloading

Open Liberty supports classloading configuration through server/application config.

Classloading questions:

```text
Does app see server classes?
Does server feature provide API?
Does WAR include duplicate API?
Are shared libraries used?
Is parent-first or parent-last behavior configured?
```

Common risk:

```text
bundled implementation conflicts with Liberty feature implementation
```

Production rule:

```text
Keep app classpath lean.
Use Liberty features for platform APIs.
Use app libraries only for application-specific dependencies.
```

If shared library is needed, define it explicitly and version it.

---

## 17. Feature Missing Failure Mode

If you forget a feature:

Example app uses:

```java
@Inject
CaseService service;
```

but `cdi-*` not enabled.

Failure:

```text
CDI injection not available or deployment failure
```

Example app uses Jakarta REST annotations but no REST feature.

Failure:

```text
REST endpoints not deployed
```

Example app uses Bean Validation but feature missing.

Failure:

```text
validation does not occur or deployment error
```

Open Liberty explicit features are powerful but require a capability checklist.

---

## 18. Minimal REST App with Open Liberty

`server.xml`:

```xml
<server>
    <featureManager>
        <feature>restfulWS-3.1</feature>
    </featureManager>

    <httpEndpoint
        id="defaultHttpEndpoint"
        host="*"
        httpPort="9080"
        httpsPort="9443" />

    <webApplication
        location="hello.war"
        contextRoot="/" />
</server>
```

Application:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Resource:

```java
@Path("/hello")
public class HelloResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Endpoint:

```text
/api/hello
```

This is the smallest concept.

Production usually needs more features.

---

## 19. REST + CDI + JSON + Validation

More realistic `server.xml`:

```xml
<server>
    <featureManager>
        <feature>restfulWS-3.1</feature>
        <feature>cdi-4.0</feature>
        <feature>jsonb-3.0</feature>
        <feature>beanValidation-3.0</feature>
        <feature>mpConfig-3.0</feature>
        <feature>mpHealth-4.0</feature>
    </featureManager>

    <httpEndpoint
        id="defaultHttpEndpoint"
        host="*"
        httpPort="${HTTP_PORT}"
        httpsPort="${HTTPS_PORT}" />

    <webApplication
        location="case-api.war"
        contextRoot="/case-api" />
</server>
```

Resource:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    CaseService service;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response create(@Valid CreateCaseRequest request) {
        CaseDto created = service.create(request);
        return Response.status(Response.Status.CREATED)
            .entity(created)
            .build();
    }
}
```

This declares runtime capabilities explicitly.

---

## 20. MicroProfile Health

Open Liberty docs describe MicroProfile Health as exposing startup, liveness, and readiness endpoints that Kubernetes can poll through probes.

Enable:

```xml
<featureManager>
    <feature>mpHealth-4.0</feature>
</featureManager>
```

Health check:

```java
@Readiness
@ApplicationScoped
public class DatabaseReadinessCheck implements HealthCheck {

    @Override
    public HealthCheckResponse call() {
        boolean ok = checkDatabase();
        return HealthCheckResponse.named("database")
            .status(ok)
            .build();
    }
}
```

Endpoints are usually under:

```text
/health/live
/health/ready
/health/started
```

depending MicroProfile Health version.

Kubernetes probes can target these endpoints.

Important:

```text
liveness should not fail merely because database is down
readiness may fail if database is critical
startup indicates initialization progress
```

---

## 21. MicroProfile Config

Enable:

```xml
<feature>mpConfig-3.0</feature>
```

Usage:

```java
@Inject
@ConfigProperty(name = "case.max-page-size", defaultValue = "100")
int maxPageSize;
```

Configuration sources can include:

- environment variables,
- system properties,
- microprofile-config.properties,
- server config,
- Kubernetes config/secret integration patterns.

Mental model:

```text
server.xml configures runtime
MicroProfile Config configures application behavior
```

Do not put every business setting into `server.xml`.

Separate runtime config and app config.

---

## 22. MicroProfile Metrics / Telemetry

Depending Open Liberty version and feature set, you may enable MicroProfile Metrics or Telemetry.

Purpose:

```text
request metrics
application metrics
JVM/runtime metrics
custom business metrics
tracing/log correlation
```

Open Liberty has strong MicroProfile integration.

For production, decide:

```text
Prometheus scraping?
OpenTelemetry export?
MP Metrics?
MP Telemetry?
vendor monitoring?
```

Do not enable observability features without defining scrape/export path, security, and cardinality policy.

---

## 23. DataSource and JDBC

Open Liberty can configure data sources in `server.xml`.

Conceptual example:

```xml
<dataSource id="AppDataSource" jndiName="jdbc/AppDataSource">
    <jdbcDriver libraryRef="OracleLib" />
    <properties.oracle
        URL="${DB_URL}"
        user="${DB_USER}"
        password="${DB_PASSWORD}" />
</dataSource>

<library id="OracleLib">
    <fileset dir="${server.config.dir}/lib" includes="ojdbc*.jar" />
</library>
```

Application:

```java
@Resource(lookup = "jdbc/AppDataSource")
DataSource dataSource;
```

Or JPA:

```xml
<jta-data-source>jdbc/AppDataSource</jta-data-source>
```

Production concerns:

```text
JDBC driver placement
secret injection
pool sizing
replica count
DB max sessions
connection timeout
validation
monitoring
```

---

## 24. JPA and Transactions

Enable relevant features:

```xml
<feature>persistence-3.1</feature>
<feature>transaction-2.0</feature>
```

Example service:

```java
@ApplicationScoped
public class CaseService {

    @PersistenceContext(unitName = "appPU")
    EntityManager em;

    @Transactional
    public CaseDto create(CreateCaseRequest request) {
        CaseEntity entity = new CaseEntity(request.title());
        em.persist(entity);
        return CaseDto.from(entity);
    }
}
```

Questions:

```text
Is persistence feature enabled?
Is transaction feature enabled?
Is datasource JTA-capable?
Is persistence.xml using JTA?
Is transaction interceptor active?
Are rollback rules tested?
```

Do not assume annotations work without enabling features.

---

## 25. Security

Open Liberty supports security features, but you must enable and configure what you need.

Security concerns:

```text
TLS
basic/form/OIDC/JWT
role mapping
user registry
app security
JAX-RS SecurityContext
domain authorization
```

For REST APIs, common model:

```text
gateway/OIDC verifies token
Liberty/Jakarta Security or app filter validates identity
domain service enforces object permission
```

Resource:

```java
@RolesAllowed("CASE_OFFICER")
@GET
@Path("/{id}")
public Response get(@PathParam("id") String id) {
    ...
}
```

But for regulated systems:

```text
role != permission
```

Domain authorization remains mandatory.

---

## 26. TLS and HTTP Endpoints

Basic endpoint:

```xml
<httpEndpoint
    id="defaultHttpEndpoint"
    host="*"
    httpPort="9080"
    httpsPort="9443" />
```

In Kubernetes, often:

```text
Open Liberty listens HTTP internally.
Ingress/gateway terminates TLS.
```

If Liberty terminates TLS:

- configure keystore,
- configure truststore,
- rotate certificates,
- manage ciphers/protocols,
- configure mTLS if needed.

Choose TLS boundary explicitly.

---

## 27. Docker Image

Open Liberty has official container image guidance and Docker-based development guides.

Conceptual Dockerfile:

```Dockerfile
FROM icr.io/appcafe/open-liberty:kernel-slim-java21-openj9-ubi

COPY --chown=1001:0 src/main/liberty/config/server.xml /config/
COPY --chown=1001:0 target/case-api.war /config/apps/

RUN features.sh

EXPOSE 9080 9443
```

Common Open Liberty image pattern:

```text
copy server.xml
copy app
install/cache features
run server
```

Production concerns:

```text
- image tag pins Java/runtime
- features installed at build time if possible
- non-root user
- server config immutable
- secrets injected at runtime
- logs to stdout
- SBOM/scanning
- health endpoints exposed
```

---

## 28. Thin Server Package

Open Liberty can package a server with:

```text
server config
features
apps
libraries
```

This is useful outside containers.

Conceptual:

```bash
server package defaultServer --include=minify
```

Packaging strategy options:

```text
WAR only:
  deploy into existing Liberty server

server package:
  app + server config packaged together

container image:
  runtime + server config + app image
```

Decision:

```text
Use WAR-only when platform owns server.
Use server package/image when app owns deployable runtime config.
```

---

## 29. Dev Mode

Open Liberty has dev mode for iterative development.

Conceptually:

```bash
mvn liberty:dev
```

Benefits:

- fast code/config iteration,
- hot reload-like workflow,
- local test cycle,
- feature updates.

Do not confuse dev mode with production mode.

Production should use:

```text
immutable build
versioned server.xml
fixed features
tested image/package
```

---

## 30. Kubernetes Deployment

Example using MicroProfile Health:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: liberty-case-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: liberty-case-api
  template:
    metadata:
      labels:
        app: liberty-case-api
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: example/liberty-case-api:1.0.0
          ports:
            - containerPort: 9080
          env:
            - name: HTTP_PORT
              value: "9080"
            - name: HTTPS_PORT
              value: "9443"
          startupProbe:
            httpGet:
              path: /health/started
              port: 9080
            periodSeconds: 3
            failureThreshold: 60
          livenessProbe:
            httpGet:
              path: /health/live
              port: 9080
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 9080
            periodSeconds: 5
            failureThreshold: 3
```

If using custom health under context root, adjust path.

With MicroProfile Health, root health endpoints can be outside app context depending configuration/version.

Verify actual endpoint path.

---

## 31. Startup Probe Importance

Liberty may take time to:

- start server,
- load features,
- deploy WAR,
- initialize CDI,
- initialize JPA,
- validate resources,
- warm caches,
- connect to dependencies.

Use startup probe so Kubernetes does not kill slow-starting pods before they become ready.

Failure pattern:

```text
liveness starts too early
pod killed repeatedly
CrashLoopBackOff
```

Fix:

```text
startupProbe with enough failureThreshold
readiness for traffic
liveness for dead process
```

---

## 32. Readiness Semantics

Readiness should mean:

```text
Liberty started
app deployed
features initialized
critical dependencies ready
not shutting down
can serve traffic
```

MicroProfile Readiness check can encode dependency readiness.

Example:

```java
@Readiness
@ApplicationScoped
public class CaseApiReadiness implements HealthCheck {
    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.up("case-api");
    }
}
```

For database-critical service:

```java
@Readiness
public class DatabaseReadiness implements HealthCheck {
    public HealthCheckResponse call() {
        return isDatabaseOk()
            ? HealthCheckResponse.up("database")
            : HealthCheckResponse.down("database");
    }
}
```

Avoid flapping readiness for non-critical dependencies.

---

## 33. Liveness Semantics

Liveness should answer:

```text
Should Kubernetes restart this container?
```

Do not include normal downstream outage.

Bad:

```text
liveness fails when DB is down
```

Result:

```text
all pods restart
outage amplified
```

Better:

```text
readiness down if DB critical
liveness up unless process/runtime is broken
```

---

## 34. Graceful Shutdown

Open Liberty receives SIGTERM in container.

Shutdown should:

```text
stop accepting new traffic
allow in-flight requests to finish
undeploy/stop app
close resources
exit
```

Application should use lifecycle callbacks for app-owned resources:

```java
@ApplicationScoped
public class AppResources {

    @PreDestroy
    public void close() {
        // close app-owned clients/exporters/schedulers
    }
}
```

Align:

```text
terminationGracePeriodSeconds
Liberty shutdown time
load balancer drain
request timeout
```

If app uses managed resources, Liberty handles more lifecycle.

If app creates unmanaged executors, app must close them.

---

## 35. Logging

Open Liberty logs include:

- messages.log,
- console.log,
- trace.log if enabled,
- FFDC files for diagnostics,
- application logs depending config.

In containers, configure logs to platform-friendly output.

Application logs should include:

```text
correlation id
request id
module
operation
safe principal/user id
domain reference
error code
dependency latency
```

Avoid logging:

- tokens,
- secrets,
- raw PII payloads,
- credentials.

---

## 36. Access Logs

Enable access logging if required.

Access logs should include:

```text
timestamp
method
path
status
duration
client IP
forwarded client
request id
bytes
user agent
```

Behind proxy, configure trusted forwarding behavior.

Do not confuse access log with audit log.

---

## 37. Reverse Proxy and Forwarded Headers

Production topology:

```text
Client
  ↓
Ingress / API Gateway / ALB / nginx
  ↓
Open Liberty HTTP endpoint
  ↓
WAR context
  ↓
Jakarta REST resource
```

Handle:

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
Host
X-Request-Id
```

Problems if ignored:

- generated URLs wrong,
- redirects wrong,
- secure cookies wrong,
- audit IP wrong,
- CORS wrong.

Rule:

```text
Trust forwarded headers only from trusted proxy boundary.
```

---

## 38. Classloader and Libraries

Application dependencies go in WAR:

```text
WEB-INF/lib
```

Shared libraries can be configured in Liberty, but use deliberately.

Use shared libraries for:

- JDBC driver,
- organization-approved common library,
- vendor integration library.

Avoid for:

- app-specific domain code,
- Jersey implementation when Liberty owns REST,
- random transitive conflict workaround.

A shared library is a platform dependency. Treat it with governance.

---

## 39. JDBC Driver Placement

Options:

```text
WAR WEB-INF/lib
server shared library
container image /config/lib
```

For Liberty datasource config, driver is often declared as a library.

Benefits:

- server-managed datasource can access driver,
- app does not need to carry driver,
- central pool config.

Risk:

- driver version shared across apps,
- upgrade blast radius,
- environment drift.

Production rule:

```text
driver placement must match datasource ownership.
```

If datasource is Liberty-managed, server must see driver.

---

## 40. Configuration and Secrets

Do not put secrets directly in committed `server.xml`.

Options:

- environment variables,
- Kubernetes secrets,
- external secret manager,
- Liberty variable substitution,
- mounted secret files.

Example conceptual:

```xml
<properties.oracle
    URL="${DB_URL}"
    user="${DB_USER}"
    password="${DB_PASSWORD}" />
```

But ensure secret values are not logged.

For regulated systems:

```text
configuration source and access must be auditable.
```

---

## 41. Failure Modes

### 41.1 Missing Feature

Symptom:

```text
REST endpoint not available
CDI injection fails
validation not triggered
JPA unavailable
```

Cause:

```text
feature not enabled
```

Fix:

```text
add correct feature in server.xml
```

---

### 41.2 Wrong Feature Generation

Symptom:

```text
javax/jakarta class not found
resources not detected
```

Cause:

```text
enabled jaxrs-2.x but app uses jakarta
or enabled restfulWS-3.x but app uses javax
```

Fix:

```text
align feature generation and imports
```

---

### 41.3 Bundled Jersey Conflict

Symptom:

```text
NoSuchMethodError
ClassCastException
provider duplicate
deployment error
```

Cause:

```text
WAR bundles Jersey while Liberty REST feature also provides runtime
```

Fix:

```text
remove Jersey implementation jars
use provided APIs
or intentionally run app-owned Jersey with careful classloading
```

---

### 41.4 Probe Path Wrong

Symptom:

```text
Kubernetes marks pod unhealthy
app works at different path
```

Cause:

```text
context root/application path/health path mismatch
```

Fix:

```text
verify actual URL
align probes
```

---

### 41.5 Config Variable Missing

Symptom:

```text
server fails to start
datasource invalid
port not configured
```

Cause:

```text
missing environment variable or server variable
```

Fix:

```text
fail fast
validate config
provide defaults only where safe
```

---

### 41.6 JDBC Driver Not Visible

Symptom:

```text
cannot load JDBC driver
datasource creation fails
```

Cause:

```text
driver not in Liberty library path
wrong libraryRef
driver packaged only in WAR while server datasource needs it
```

Fix:

```text
place driver in configured library
verify datasource config
```

---

## 42. Anti-Patterns

### Anti-Pattern 1 — Enabling Full Platform Without Need

This increases runtime scope and hides capability reasoning.

### Anti-Pattern 2 — Bundling Jersey Like Tomcat

Open Liberty can provide REST runtime. Do not duplicate unless intentional.

### Anti-Pattern 3 — Treating `server.xml` as Ops-Only

It is part of app runtime contract.

### Anti-Pattern 4 — Missing Health Feature in Kubernetes

Use MicroProfile Health or app-specific health.

### Anti-Pattern 5 — Putting Secrets in `server.xml`

Use externalized secure configuration.

### Anti-Pattern 6 — No Feature Drift Control

Different environments with different features cause impossible-to-reproduce bugs.

---

## 43. Decision Matrix

| Dimension | Open Liberty |
|---|---|
| Runtime style | feature-based managed runtime |
| App artifact | WAR/EAR/server package/container image |
| REST ownership | Liberty feature usually owns Jakarta REST |
| Jersey-specific portability | avoid unless intentional |
| Config center | `server.xml` |
| Best strength | explicit capability set |
| MicroProfile support | strong |
| Kubernetes fit | strong |
| Main risk | missing/wrong feature or dependency conflict |
| Best for | cloud-native Jakarta EE/MicroProfile services |
| Compared to Payara | more composable/minimal |
| Compared to Tomcat | more platform features |
| Compared to embedded | less app-owned server code |

---

## 44. When to Choose Open Liberty

Choose Open Liberty when:

```text
- you want Jakarta EE/MicroProfile features
- you value explicit runtime feature selection
- you deploy cloud-native Java services
- server.xml/config-as-code fits your process
- Kubernetes/container deployment is important
- you want managed runtime without full heavyweight domain model
- you need REST + CDI + Health + Config + Metrics/Telemetry
```

Do not choose Open Liberty when:

```text
- you only need a tiny embedded REST server
- app team wants complete server control in Java code
- org standardizes on Tomcat/Payara/WildFly
- you require Jersey-specific runtime behavior everywhere
- feature/config discipline is not in place
```

---

## 45. Top-Tier Engineering Perspective

A basic engineer says:

```text
Deploy WAR to Liberty.
```

A senior engineer asks:

```text
Which features are enabled?
```

A top-tier engineer defines:

```text
- Java version
- Jakarta/Java EE generation
- REST feature generation
- feature set minimality
- dependency scopes
- Jersey-specific coupling decision
- server.xml ownership
- application context root
- MicroProfile Health endpoints
- MicroProfile Config sources
- datasource ownership and driver placement
- classloader/shared library policy
- observability/export strategy
- Docker/Kubernetes probes
- shutdown behavior
- feature drift prevention
- rollback package/image
```

Open Liberty rewards engineers who make runtime capability explicit.

---

## 46. Production Readiness Checklist

```text
[ ] Open Liberty version pinned.
[ ] Java runtime version supported.
[ ] Jakarta/Java EE generation selected.
[ ] REST feature generation matches application imports.
[ ] No mixed javax/jakarta dependencies.
[ ] server.xml versioned.
[ ] Feature set reviewed and minimal/sufficient.
[ ] No accidental Jersey implementation bundled.
[ ] Jakarta APIs marked provided.
[ ] WAR inspected.
[ ] Context root documented.
[ ] ApplicationPath documented.
[ ] Health endpoints verified.
[ ] Kubernetes probes target actual health endpoints.
[ ] Startup probe configured.
[ ] MicroProfile Health enabled if used.
[ ] MicroProfile Config enabled if used.
[ ] Config variables validated.
[ ] Secrets externalized.
[ ] Datasource configured if needed.
[ ] JDBC driver visible to Liberty if server-managed datasource.
[ ] Pool size aligned with DB capacity and replica count.
[ ] CDI injection tested.
[ ] Validation behavior tested.
[ ] Transaction rollback tested if used.
[ ] JSON provider behavior tested.
[ ] Access logs configured if required.
[ ] Correlation ID implemented.
[ ] Forwarded header strategy defined.
[ ] Logs routed to platform.
[ ] App-owned resources close on shutdown.
[ ] Docker image immutable.
[ ] Feature drift across environments prevented.
[ ] Rollback tested.
```

---

## 47. Summary

Open Liberty deployment is best understood as:

```text
managed runtime + explicit feature set + application artifact
```

Its essence:

```text
server.xml declares runtime capability.
Open Liberty loads only enabled features.
Application uses those features through Jakarta EE/MicroProfile APIs.
```

This makes Open Liberty powerful for:

- REST APIs,
- microservices,
- cloud-native Jakarta EE,
- MicroProfile Health/Config/Metrics,
- containerized deployment,
- minimal managed runtime.

But it requires discipline:

- enable correct features,
- align namespace generation,
- avoid bundling conflicting implementations,
- version `server.xml`,
- externalize config/secrets,
- validate health/probes,
- test on the actual Liberty runtime.

Top-tier conclusion:

> Open Liberty is not “just another app server”.  
> It is a feature-composed runtime where the deployment contract is explicit in configuration.

---

## 48. How This Part Connects to the Next Part

This part covered Open Liberty as a feature-based managed runtime.

Next:

```text
Part 19 — Fat Jar, Uber Jar, Thin Jar, dan Distribution Layout
```

The mental model will shift from server type to artifact shape.

We will cover:

- fat jar vs thin jar,
- shaded jar risks,
- `META-INF/services`,
- dependency layering,
- app distribution layout,
- Docker image layering,
- startup script,
- classpath manifest,
- reproducible build,
- why packaging style can make or break Jersey deployment.

---

## References

- Open Liberty documentation — Jakarta EE overview: https://openliberty.io/docs/latest/jakarta-ee.html
- Open Liberty documentation — Jakarta EE Platform 10.0 feature: https://openliberty.io/docs/latest/reference/feature/jakartaee-10.0.html
- Open Liberty documentation — Jakarta EE Web Profile 10.0 feature: https://openliberty.io/docs/latest/reference/feature/webProfile-10.0.html
- Open Liberty documentation — Jakarta RESTful Web Services feature: https://openliberty.io/docs/latest/reference/feature/restfulWS-3.0.html
- Open Liberty documentation — Health checks for microservices: https://openliberty.io/docs/latest/health-check-microservices.html
- Open Liberty guide — Kubernetes MicroProfile Health: https://openliberty.io/guides/kubernetes-microprofile-health.html
- Open Liberty documentation — Java SE support: https://openliberty.io/docs/latest/java-se.html
- IBM documentation — Liberty features: https://www.ibm.com/docs/en/was-liberty/base?topic=management-liberty-features
- Open Liberty guide — Docker: https://openliberty.io/guides/docker.html
- Open Liberty blog — Jakarta EE 11 Platform, Java 26, and more in 26.0.0.4-beta: https://openliberty.io/blog/2026/04/07/26.0.0.4-beta.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-017.md">⬅️ Part 17 — GlassFish/Payara Deployment: Reference Runtime, Jakarta EE Alignment, dan Admin Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-019.md">Part 19 — Fat Jar, Uber Jar, Thin Jar, dan Distribution Layout ➡️</a>
</div>
