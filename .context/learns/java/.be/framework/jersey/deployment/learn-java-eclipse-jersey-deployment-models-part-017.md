# learn-java-eclipse-jersey-deployment-models-part-017  
# Part 17 — GlassFish/Payara Deployment: Reference Runtime, Jakarta EE Alignment, dan Admin Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 17 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey/Jakarta REST pada GlassFish dan Payara sebagai managed Jakarta EE runtime.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: server-owned Jersey/Jakarta REST, domain/admin model, classloading, JDBC resources, deployment descriptors, monitoring, Docker/Kubernetes, migration, dan production failure model.

---

## 1. Apa Itu GlassFish/Payara Deployment Model?

GlassFish dan Payara adalah Jakarta EE application server lineage yang sangat dekat dengan Jersey.

Secara historis:

```text
Jersey adalah reference implementation / implementation lineage untuk JAX-RS/Jakarta REST.
GlassFish adalah reference implementation lineage untuk Java EE/Jakarta EE.
Payara berasal dari GlassFish dan menyediakan enterprise-oriented distribution/support/features.
```

Dalam deployment model ini, aplikasi umumnya dikemas sebagai:

```text
WAR
EAR
```

lalu dideploy ke server:

```text
GlassFish/Payara domain
  ↓
server instance
  ↓
HTTP listener
  ↓
web container
  ↓
Jakarta REST/Jersey runtime
  ↓
CDI / validation / security / resources
  ↓
application components
```

Topology:

```text
Client
  ↓
Load balancer / reverse proxy / ingress
  ↓
GlassFish/Payara HTTP listener
  ↓
Web container
  ↓
Jersey/Jakarta REST runtime
  ↓
Resource method
  ↓
CDI/service/transaction/resource layer
  ↓
Provider pipeline
  ↓
Response
```

Perbedaan besar dari Tomcat:

```text
Tomcat:
  provides Servlet container
  app usually packages Jersey

GlassFish/Payara:
  provides Jakarta EE platform
  server usually provides Jakarta REST/Jersey implementation
```

---

## 2. Mental Model Utama

Mental model paling penting:

> Pada GlassFish/Payara, Jersey bukan sekadar dependency aplikasi. Jersey/Jakarta REST sering menjadi bagian dari runtime server.

Artinya:

```text
Server owns:
  HTTP listener
  web container
  Jakarta REST implementation
  CDI container
  Bean Validation
  JSON-B/JSON-P
  JTA transaction manager
  JDBC resources/pools
  security realm/integration
  deployment lifecycle
  admin/config model
  monitoring/logging platform
```

Aplikasi owns:

```text
REST resources
providers/mappers if app-specific
domain services
DTOs
business logic
persistence mappings
application-specific libraries
deployment descriptors
app config bindings
```

Top-tier rule:

```text
Do not deploy to GlassFish/Payara as if it were Tomcat.
```

If you bundle your own Jersey into a GlassFish/Payara app without clear reason, you can create classloading and provider conflicts.

---

## 3. GlassFish vs Payara: Practical Difference

### GlassFish

GlassFish is the Eclipse Jakarta EE implementation lineage.

It is useful as:

- Jakarta EE reference-aligned server,
- learning/spec exploration runtime,
- compatibility target,
- Jersey-native environment,
- open-source application server.

Recent GlassFish 8 downloads state that the release corresponds with Jakarta EE 11 and requires JDK 21 or higher.

### Payara

Payara is derived from GlassFish and provides enterprise-focused distribution, documentation, support, patches, monitoring/admin features, and operational improvements.

It is useful as:

- production enterprise Jakarta EE server,
- GlassFish-compatible runtime,
- managed server with admin tooling,
- Jakarta EE platform deployment target.

Practical decision:

```text
GlassFish:
  strong for spec alignment, learning, RI-style validation.

Payara:
  stronger for enterprise operations/support model.
```

But exact production choice depends on organization, support, licensing, lifecycle, and compatibility requirements.

---

## 4. Java 8 to Java 25 Version Perspective

### Java 8 Era

Typical:

```text
Java 8
Java EE 7/8
javax.*
JAX-RS 2.x
Jersey 2.x
GlassFish 4/5 lineage
Payara 4/5 lineage
```

Resource imports:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

### Java 11 Transition

Possible but version-specific.

Need to verify server support.

Many apps remained on:

```text
javax.*
Jersey 2.x
Java EE/Jakarta EE 8 APIs
```

### Java 17 Era

Jakarta EE 10 generation commonly uses Java 11+ or 17 depending server.

Typical:

```text
jakarta.*
Jersey 3.x
Servlet 6.0 / Jakarta REST 3.x generation
```

### Java 21 / Java 25 Era

GlassFish 8 requires JDK 21+ and corresponds with Jakarta EE 11.

Jakarta EE 11 aligns with Jakarta REST 4.0 and modern Jakarta namespace.

Java 25 may be usable depending server support, but never assume without vendor/server certification or testing.

Rule:

```text
For GlassFish/Payara, Java version support is server-version-specific.
Application bytecode target must not exceed server runtime support.
```

---

## 5. `javax.*` vs `jakarta.*` Boundary

This remains the central migration boundary.

### Old universe

```text
javax.ws.rs.*
javax.servlet.*
javax.inject.*
javax.persistence.*
javax.transaction.*
```

### New universe

```text
jakarta.ws.rs.*
jakarta.servlet.*
jakarta.inject.*
jakarta.persistence.*
jakarta.transaction.*
```

GlassFish/Payara generation determines expected namespace.

Bad:

```java
import javax.ws.rs.Path;
```

deployed to a Jakarta EE 10/11 server expecting `jakarta.ws.rs.Path`.

The resource may not be discovered.

Bad:

```java
import jakarta.ws.rs.Path;
```

deployed to Java EE 8 server.

Runtime fails with missing classes.

Rule:

```text
Server generation and app namespace must match.
```

Migration is not just changing imports. It includes:

- dependencies,
- deployment descriptors XML namespace,
- persistence descriptors,
- validation APIs,
- CDI APIs,
- servlet APIs,
- filters/listeners,
- third-party libraries.

---

## 6. Server-Owned Jersey vs Application-Owned Jersey

### Server-Owned Jersey

Typical for GlassFish/Payara.

Application depends on APIs:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <scope>provided</scope>
</dependency>
```

or smaller APIs:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>
```

WAR does not bundle:

```text
jersey-server
jersey-container-servlet-core
jersey-hk2
```

unless intentionally overriding/extending.

### Application-Owned Jersey

Possible but risky in full server.

WAR bundles Jersey implementation.

Risks:

- server Jersey and app Jersey conflict,
- provider duplication,
- classloader ambiguity,
- CDI/Jersey integration differences,
- server modules expect different versions,
- `NoSuchMethodError` / `ClassCastException`,
- deployment-specific behavior.

Rule:

```text
On GlassFish/Payara, prefer server-owned Jersey unless you have a tested override strategy.
```

---

## 7. Portable Jakarta REST Application

Standard application:

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Resource:

```java
package com.example.api;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

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
/{context-root}/api/hello
```

This is portable across Jakarta REST implementations.

---

## 8. Jersey-Specific `ResourceConfig`

GlassFish/Payara are Jersey-friendly, so `ResourceConfig` may be available.

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import org.glassfish.jersey.server.ResourceConfig;

@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(HelloResource.class);
        register(GlobalExceptionMapper.class);
    }
}
```

This is convenient, but it couples application to Jersey.

Decision:

```text
If target is GlassFish/Payara and Jersey features are useful:
  ResourceConfig is acceptable.

If portability to WildFly/Open Liberty without Jersey assumptions matters:
  prefer standard Application.
```

Architecture option:

```text
core-api:
  standard Jakarta REST resources/providers

deployment-payara:
  Jersey-specific bootstrapping/configuration
```

---

## 9. WAR Packaging

Typical WAR:

```text
my-api.war
├─ WEB-INF/
│  ├─ classes/
│  ├─ lib/
│  ├─ web.xml optional
│  ├─ glassfish-web.xml optional
│  └─ payara-web.xml optional
```

In GlassFish/Payara, do not include server-provided Jakarta EE implementation libraries unnecessarily.

Expected app libraries:

```text
application-specific dependencies
domain libraries
third-party utilities not provided by server
database driver if not installed as server library
```

Often `provided`:

```text
jakarta.jakartaee-api
jakarta.ws.rs-api
jakarta.servlet-api
jakarta.enterprise.cdi-api
jakarta.persistence-api
jakarta.transaction-api
```

Do not package:

```text
jakartaee-api implementation
server Jersey modules
CDI implementation
JTA implementation
Servlet implementation
```

unless explicitly required and tested.

---

## 10. EAR Packaging

EAR can contain:

```text
my-system.ear
├─ app-api.war
├─ app-admin.war
├─ business.jar
├─ lib/
└─ META-INF/application.xml
```

Use EAR when:

- multiple modules must deploy together,
- shared EJB/business JAR,
- legacy enterprise architecture,
- central classloader control,
- coordinated transactional modules.

Avoid EAR when:

- single REST service is enough,
- WAR is simpler,
- Docker/Kubernetes one-service-one-artifact model,
- EAR classloader complexity adds no value.

Top-tier rule:

```text
EAR is an architectural packaging decision, not a default.
```

---

## 11. Context Root

Context root may be controlled by:

- WAR filename,
- deployment command,
- admin console,
- `glassfish-web.xml`,
- `payara-web.xml`,
- deployment descriptor,
- server config.

Example:

```xml
<glassfish-web-app>
    <context-root>/case-api</context-root>
</glassfish-web-app>
```

or Payara-specific descriptor depending version.

Path composition:

```text
context root:
  /case-api

@ApplicationPath:
  /api

@Path:
  /cases

final:
  /case-api/api/cases
```

Production checklist:

```text
[ ] external route documented
[ ] proxy rewrite documented
[ ] context root documented
[ ] application path documented
[ ] health path documented
```

---

## 12. Admin Model: Domain, Server, Instance

GlassFish/Payara use domain-based administration.

Conceptual:

```text
Domain
  ├─ configuration
  ├─ resources
  ├─ applications
  ├─ server instances
  ├─ clusters if supported/configured
  └─ admin server
```

Common command tool:

```text
asadmin
```

Examples conceptually:

```bash
asadmin start-domain domain1
asadmin deploy target/my-api.war
asadmin undeploy my-api
asadmin list-applications
asadmin list-domains
```

The admin model is part of deployment architecture.

Do not treat deployment as “copy WAR somewhere” only.

---

## 13. Deployment via `asadmin`

Typical commands:

```bash
asadmin deploy target/my-api.war
```

With context root:

```bash
asadmin deploy --contextroot case-api target/my-api.war
```

Undeploy:

```bash
asadmin undeploy my-api
```

Redeploy:

```bash
asadmin redeploy --name my-api target/my-api.war
```

Production concerns:

```text
- command authentication
- target server/cluster
- context root
- libraries option
- precompile JSP if relevant
- rollback
- deployment timeout
- deployment logs
- app versioning
```

Automate these commands.

Manual admin console deployment is not a robust release process.

---

## 14. Class Loader Universe

Payara documentation explains that each individually deployed EJB JAR or web WAR has its own class loader universe that loads classes in the module.

This matters because dependencies can be placed in different locations:

```text
WAR WEB-INF/lib
EAR lib
deployment --libraries option
domain/server lib
server modules
```

Where you place a JAR changes visibility and ownership.

Rule:

```text
Application-specific libraries belong in application.
Shared infrastructure libraries require governance.
```

Do not put app libraries into domain/global lib casually.

Risks:

- version conflict across apps,
- hidden dependency,
- upgrade blast radius,
- ClassCastException,
- NoSuchMethodError,
- redeploy leak,
- provider ambiguity.

---

## 15. Libraries Option and Shared Libraries

Payara docs mention resources/JARs can be accessed through locations such as a directory pointed to by the Libraries field or `--libraries` option during deployment.

This is useful for:

- JDBC drivers,
- shared libraries,
- vendor libraries,
- platform-managed dependencies.

But it is dangerous for app-specific code.

Use shared libs when:

```text
- version is centrally governed
- multiple apps intentionally share it
- compatibility is tested
- rollback strategy exists
```

Do not use shared libs to “fix missing dependency quickly”.

---

## 16. JDBC Resources and Connection Pools

GlassFish/Payara can manage JDBC connection pools and resources.

Conceptual:

```text
JDBC Connection Pool
  ↓
JDBC Resource / JNDI Name
  ↓
Application lookup/injection
```

Example Payara command documentation shows `create-jdbc-connection-pool`.

Conceptual command:

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=app:password=secret:URL=jdbc:oracle:thin:@host:1521/service \
  appPool
```

Then create resource:

```bash
asadmin create-jdbc-resource \
  --connectionpoolid appPool \
  jdbc/AppDataSource
```

Application injection:

```java
@Resource(lookup = "jdbc/AppDataSource")
DataSource dataSource;
```

Benefits:

- server manages pool,
- monitoring/admin console,
- centralized config,
- environment-specific binding,
- JTA integration potential,
- no app-owned pool lifecycle.

---

## 17. JDBC Pool Sizing

Pool sizing must align with:

```text
HTTP thread pool
transaction duration
DB capacity
query latency
external load
number of server instances
```

Bad:

```text
each pod/server instance:
  pool max 100

replicas:
  10

database max sessions:
  300
```

Total possible:

```text
1000 DB connections
```

DB collapses.

Top-tier sizing:

```text
total max DB connections across all instances <= DB safe capacity
```

Formula:

```text
per_instance_pool_max * instance_count <= DB_connection_budget_for_app
```

Also consider:

- admin sessions,
- background jobs,
- migration tools,
- report queries,
- other applications.

---

## 18. SQL Tracing and Monitoring

Payara documentation includes JDBC monitoring/tracing capabilities such as logging JDBC calls through administration console settings.

Use carefully.

SQL tracing can help diagnose:

- slow queries,
- connection leaks,
- transaction behavior,
- pool exhaustion.

But in production:

```text
SQL tracing can be expensive and may log sensitive data.
```

Use:

- temporary enablement,
- lower environment reproduction,
- sampling if available,
- scrub sensitive values,
- clear operational procedure.

---

## 19. JNDI Naming Strategy

Define stable JNDI names:

```text
jdbc/AppDataSource
jms/AppQueue
mail/AppMailSession
```

Avoid environment in name:

```text
jdbc/AppDataSourceDev
jdbc/AppDataSourceProd
```

Better:

```text
same JNDI name
different server resource binding per environment
```

This allows the same WAR to run across DEV/UAT/PROD.

Production checklist:

```text
[ ] required JNDI resources documented
[ ] provisioning automated
[ ] startup validates resources
[ ] secrets not committed
[ ] resource names stable
```

---

## 20. CDI and Jersey Integration

GlassFish/Payara provide CDI.

Resource can inject service:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    CaseService caseService;

    @GET
    public List<CaseDto> list() {
        return caseService.list();
    }
}
```

Service:

```java
@ApplicationScoped
public class CaseService {
    public List<CaseDto> list() {
        return List.of();
    }
}
```

Provider injection:

```java
@Provider
@ApplicationScoped
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {

    @Inject
    ErrorResponseFactory errorResponseFactory;

    @Override
    public Response toResponse(Throwable exception) {
        return Response.status(500)
            .entity(errorResponseFactory.internal())
            .build();
    }
}
```

Test injection into:

- resources,
- filters,
- exception mappers,
- context resolvers,
- validators.

Do not assume everything is CDI-managed unless verified.

---

## 21. Bean Discovery

CDI bean discovery depends on:

- annotations,
- `beans.xml`,
- bean discovery mode,
- CDI version,
- server behavior.

Modern CDI can discover annotated beans.

But for predictable enterprise deployment, know your discovery mode.

`beans.xml` example:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated"
       version="4.0">
</beans>
```

Potential issue:

```text
class exists
but CDI does not discover it
```

Symptoms:

```text
UnsatisfiedResolutionException
injection null
provider not CDI-managed
```

Fix:

- annotate bean scope,
- add/adjust `beans.xml`,
- verify deployment logs,
- write integration test on target server.

---

## 22. Transactions

GlassFish/Payara provide Jakarta Transactions.

Example:

```java
@ApplicationScoped
public class CaseService {

    @Transactional
    public void approve(String caseId) {
        // update case state
        // insert audit trail
        // persist decision record
    }
}
```

Key concerns:

```text
transaction boundary
rollback rules
exception types
self-invocation
CDI proxy/interceptor
resource enlistment
JTA vs resource-local JPA
timeout
isolation
audit consistency
```

Test rollback:

```text
force exception after DB update
verify update rolled back
verify audit behavior
```

Do not assume transaction works because annotation exists.

---

## 23. JPA and Persistence Units

Managed server can provide JPA provider/integration.

`persistence.xml`:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence"
             version="3.1">
    <persistence-unit name="appPU" transaction-type="JTA">
        <jta-data-source>jdbc/AppDataSource</jta-data-source>
        <properties>
            <property name="jakarta.persistence.schema-generation.database.action" value="none"/>
        </properties>
    </persistence-unit>
</persistence>
```

Inject:

```java
@PersistenceContext(unitName = "appPU")
EntityManager entityManager;
```

Managed JTA persistence gives:

- transaction participation,
- container-managed `EntityManager`,
- lifecycle integration.

But you must understand:

- transaction scope,
- lazy loading,
- flush behavior,
- entity manager thread confinement,
- schema generation disabled in production,
- migration tooling outside app startup.

---

## 24. Security Realm and Application Security

GlassFish/Payara can define security realms and integrate with Jakarta Security/container security.

Security layers:

```text
reverse proxy / SSO
server realm
container auth
Jakarta Security
Jersey filters
resource annotations
domain authorization
```

Resource:

```java
@RolesAllowed("CASE_OFFICER")
@GET
@Path("/{id}")
public CaseDto get(@PathParam("id") String id) {
    ...
}
```

SecurityContext:

```java
@Context
SecurityContext securityContext;
```

But role-based checks are coarse.

For regulatory systems:

```text
Can officer A access case B in state C for agency D?
```

must be domain authorization, not just container role.

Top-tier rule:

```text
Container security authenticates and gives coarse roles.
Domain layer enforces business permission.
```

---

## 25. JSON-B vs Jackson vs MOXy

GlassFish/Payara may provide JSON-B/JSON-P and Jersey media support depending server generation.

If your API contract requires Jackson-specific behavior, be explicit.

Questions:

```text
Which MessageBodyWriter is selected?
Is JSON-B default?
Is Jackson packaged?
Are Java time types serialized correctly?
Are nulls included/excluded as expected?
Are unknown properties allowed?
```

Avoid accidental provider selection.

Register provider if needed.

Test API JSON contract on the target server.

---

## 26. Bean Validation

Managed server provides Bean Validation integration.

DTO:

```java
public record CreateCaseRequest(
    @NotBlank String title,
    @Size(max = 2000) String description
) {
}
```

Resource:

```java
@POST
public Response create(@Valid CreateCaseRequest request) {
    ...
}
```

Define error response shape.

Default validation errors may not match your API contract.

Create mapper:

```java
@Provider
public class ConstraintViolationMapper
        implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        return Response.status(400)
            .entity(ValidationErrorResponse.from(exception))
            .build();
    }
}
```

---

## 27. Admin Console vs Automation

GlassFish/Payara provide admin console.

Admin console is useful for:

- inspecting resources,
- monitoring,
- debugging,
- one-off investigation,
- learning server state.

Production release should be automated:

```text
asadmin scripts
CI/CD pipeline
infrastructure as code
container image
versioned domain config
```

Manual console changes create drift.

Rule:

```text
Admin console is for visibility and controlled operations, not invisible production mutation.
```

---

## 28. Server Configuration as Code

Version-control:

```text
domain.xml or generated config
asadmin provisioning scripts
JDBC pool/resource creation
JVM options
system properties
logging config
monitoring config
deployment scripts
Dockerfile
Kubernetes manifests
```

Do not rely on:

```text
"someone configured it in admin console"
```

For auditability:

```text
environment can be rebuilt from code/config
```

---

## 29. Monitoring

Monitor:

```text
HTTP request metrics
Jersey/resource latency
JVM heap/GC
thread pools
JDBC pool active/free/wait time
transaction count/failures
deployment status
error rates
access logs
application logs
audit logs
health endpoints
```

GlassFish/Payara may expose server-level monitoring.

Application still needs domain-level observability:

```text
case creation count
approval failures
authorization denials
external system latency
audit write failures
```

Server monitoring does not replace business observability.

---

## 30. Logging

GlassFish/Payara server logs include:

```text
server startup
deployment
resource creation
warnings
exceptions
container messages
```

Application logs should include:

```text
correlation id
user/principal where safe
use case
module
case id/reference where safe
error code
dependency latency
```

Avoid:

- raw tokens,
- secrets,
- PII-heavy payloads,
- full request body by default.

For Docker/Kubernetes:

```text
logs should reach stdout/stderr or platform collector
```

If server writes to files, configure log collection.

---

## 31. Access Logs

Enable access logs as needed.

Fields:

```text
timestamp
method
path
status
duration
client IP
forwarded client
request id
user agent
bytes
```

Behind proxy, direct remote address may be proxy IP.

Need trusted forwarded header handling.

Do not confuse:

```text
access log:
  HTTP request happened

audit log:
  business action happened
```

---

## 32. Reverse Proxy and Load Balancer

Production topology:

```text
Client
  ↓
ALB / nginx / API Gateway / Ingress
  ↓
GlassFish/Payara
  ↓
WAR context
  ↓
Jersey app
```

Handle:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
Forwarded
Host
context path
proxy rewrite
TLS termination
timeout alignment
body size limits
```

Common bug:

```text
Generated Location header uses internal host/port.
```

Fix:

- configure proxy headers,
- configure public base URL,
- avoid absolute URL generation where possible,
- test behind actual proxy.

---

## 33. Health and Readiness

Use health endpoints:

```text
/{context-root}/api/health/live
/{context-root}/api/health/ready
```

Readiness should check:

```text
app deployed
CDI initialized
critical resources bound
DB pool available if critical
not in shutdown
```

Liveness should not fail on normal downstream outage unless restart truly helps.

In server-managed environment, server may be alive while app deployment failed.

Therefore:

```text
Kubernetes readiness must target app endpoint, not only server root.
```

---

## 34. Startup Validation

Validate critical resources during startup.

Example:

```java
@ApplicationScoped
public class StartupValidator {

    @Resource(lookup = "jdbc/AppDataSource")
    DataSource dataSource;

    public void onStart(@Observes @Initialized(ApplicationScoped.class) Object event) {
        validateDataSource();
    }

    private void validateDataSource() {
        try (Connection connection = dataSource.getConnection()) {
            if (!connection.isValid(2)) {
                throw new IllegalStateException("DataSource is invalid");
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot connect to datasource", e);
        }
    }
}
```

If validation fails, deployment should fail or readiness should remain false.

Do not allow app to start “half alive” silently.

---

## 35. Graceful Shutdown and Undeploy

On undeploy/shutdown:

```text
server stops app context
CDI destroys beans
resources released
transactions complete/rollback
HTTP listener stops routing
```

Application must close app-owned resources.

Use:

```java
@PreDestroy
public void shutdown() {
    // close app-owned clients/schedulers/exporters
}
```

For long-running jobs:

```text
stop accepting new work
finish or cancel safely
persist state
release locks
```

If server-managed resources are used, server handles pool lifecycle.

If app-managed resources are used, app must close them.

---

## 36. Redeploy Leak Risks

Redeploy leaks:

```text
static references
unmanaged threads
ThreadLocal values
custom classloaders
JDBC drivers
MBeans
HTTP clients
scheduled executors
logging appenders
telemetry exporters
```

In long-running GlassFish/Payara domains with redeploys, test:

```text
deploy -> load -> undeploy -> redeploy -> load
```

Monitor:

```text
threads
heap
metaspace
classloader count
open connections
JDBC pool state
```

---

## 37. Dockerizing GlassFish/Payara

Image contains:

```text
server runtime
domain/config
deployed WAR/EAR
JVM options
startup command
```

Concerns:

```text
server version
Java version
domain config
admin password/secure admin
non-root user
ports
logs
health path
JDBC driver placement
resource provisioning
secrets injection
startup time
graceful shutdown
```

Avoid baking secrets.

Common pattern:

```text
build image with app
provide environment config/secrets at runtime
provision resources via startup script or prebuilt domain config
```

But startup scripts must be deterministic.

---

## 38. Kubernetes Deployment

Example conceptual:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payara-case-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payara-case-api
  template:
    metadata:
      labels:
        app: payara-case-api
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: payara
          image: example/payara-case-api:1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /case-api/api/health/ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /case-api/api/health/live
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /case-api/api/health/live
              port: 8080
            periodSeconds: 3
            failureThreshold: 80
```

Server startup can be slower than embedded app.

Use startup probe.

Readiness must target deployed app path.

---

## 39. Session and Clustering

For REST APIs, prefer stateless.

Avoid HTTP session unless required.

If using sessions:

```text
session persistence
cluster replication
sticky sessions
timeout
security
memory footprint
failover behavior
```

For REST/Jersey APIs, stateless token/session externalization is usually cleaner.

Do not accidentally create sessions in filters or security mechanisms unless intended.

---

## 40. Migration: Tomcat/Embedded to Payara/GlassFish

When moving from Tomcat/embedded Jersey to Payara/GlassFish:

Review:

```text
Does app bundle Jersey?
Does server already provide Jersey?
Are dependencies marked provided?
Is CDI now available?
Are resources JNDI/server-managed?
Are transaction boundaries changing?
Is JSON provider changing?
Is context root changing?
Are deployment descriptors needed?
Are classloader conflicts introduced?
```

Migration is not just “deploy WAR to Payara”.

The runtime contract changes.

---

## 41. Migration: Jersey 2 to Jersey 3/4 on GlassFish/Payara

Steps:

```text
1. Identify server target generation.
2. Align Java version.
3. Migrate imports javax -> jakarta.
4. Update deployment descriptors XML namespace.
5. Update dependencies to Jakarta generation.
6. Remove bundled Jersey if server owns it.
7. Validate JSON provider behavior.
8. Validate CDI injection.
9. Validate transactions.
10. Validate JPA/persistence.xml.
11. Validate security.
12. Validate health/proxy paths.
13. Test on target server, not only unit tests.
```

Do not combine:

```text
Java 8 -> 21/25
Jersey 2 -> 4
Tomcat -> Payara
javax -> jakarta
Hikari -> server datasource
manual transactions -> JTA
```

all in one uncontrolled change.

---

## 42. Common Failure Modes

### 42.1 Bundled Jersey Conflict

Symptom:

```text
NoSuchMethodError
ClassCastException
provider duplicate
deployment failure
```

Cause:

```text
WAR bundles Jersey while server provides Jersey
```

Fix:

```text
remove Jersey implementation from WAR
use provided scope
or define explicit override strategy
```

---

### 42.2 Namespace Mismatch

Symptom:

```text
ClassNotFoundException: javax/ws/rs/Path
or jakarta/ws/rs/Path
resource not found
```

Cause:

```text
server generation and app namespace mismatch
```

Fix:

```text
align Jakarta EE generation
```

---

### 42.3 JNDI Resource Missing

Symptom:

```text
NameNotFoundException
deployment/startup failure
```

Cause:

```text
jdbc resource not provisioned
wrong JNDI name
wrong target/domain
```

Fix:

```text
automate resource creation
startup validate
document required resources
```

---

### 42.4 CDI Injection Failure

Cause:

```text
bean not discovered
wrong scope
missing beans.xml
ambiguous dependency
provider not CDI-managed
```

Fix:

```text
bean discovery config
scope annotations
integration test
deployment log review
```

---

### 42.5 Transaction Not Applied

Cause:

```text
method not intercepted
self-invocation
bean not managed
wrong annotation
resource-local persistence unit
```

Fix:

```text
move transaction to managed service boundary
test rollback
```

---

### 42.6 Context Root Wrong

Symptom:

```text
/health 404
/app/api/health works
```

Cause:

```text
context root differs from assumption
```

Fix:

```text
document and configure context root
align probes/proxy/routes
```

---

## 43. Anti-Patterns

### Anti-Pattern 1 — Treating Payara Like Tomcat

Payara is full Jakarta EE platform.

If you ignore server services but keep server complexity, re-evaluate runtime choice.

### Anti-Pattern 2 — Bundling Platform Implementations

Do not bundle server-owned implementations casually.

### Anti-Pattern 3 — Manual Admin Console Drift

Manual changes without config-as-code create environment inconsistency.

### Anti-Pattern 4 — Business Authorization Only in Roles

Use domain authorization for case/state/entity-level decisions.

### Anti-Pattern 5 — No Resource Provisioning Automation

JNDI/JDBC resources must be repeatable across environments.

### Anti-Pattern 6 — Probe Server Root Instead of App Readiness

Server alive does not mean app ready.

---

## 44. Decision Matrix

| Dimension | GlassFish/Payara |
|---|---|
| Runtime type | Full Jakarta EE server |
| Jersey ownership | usually server-owned |
| Artifact | WAR/EAR |
| CDI | server-managed |
| Transactions | server-managed JTA |
| Datasource | server-managed JDBC resources |
| Classloading | module/app classloader universe |
| Admin model | domain/asadmin/admin console |
| Best for | enterprise Jakarta EE apps |
| Main strength | integrated platform services |
| Main risk | dependency/classloader/resource config mismatch |
| Docker/Kubernetes fit | possible but heavier |
| Portability | good for Jakarta APIs, lower for server-specific descriptors/features |

---

## 45. When to Choose GlassFish/Payara

Choose GlassFish/Payara when:

```text
- Jakarta EE platform services are valuable
- Jersey/Jakarta REST server ownership is desired
- CDI/JTA/JPA/security/resource management matter
- ops model supports domains/admin tooling
- enterprise support/spec alignment is important
- WAR/EAR deployment fits organization
```

Do not choose it when:

```text
- you only need lightweight REST
- app team wants single jar/process ownership
- full platform services will be unused
- server config complexity outweighs benefits
- Kubernetes-native minimal service is preferred
```

---

## 46. Top-Tier Engineering Perspective

A basic engineer says:

```text
Deploy WAR to Payara.
```

A senior engineer asks:

```text
Which server version and Jakarta EE generation?
```

A top-tier engineer defines:

```text
- Java runtime support
- Jakarta namespace generation
- server-owned vs app-owned Jersey
- dependency scopes
- classloader placement
- JDBC/JNDI resources
- transaction boundaries
- CDI discovery model
- JSON provider selection
- security realm/domain authorization split
- context root/application path
- deployment automation
- monitoring/logging/access/audit strategy
- Docker/Kubernetes readiness path
- rollback and redeploy strategy
```

GlassFish/Payara are powerful when the managed runtime contract is explicit.

They are fragile when treated as a generic servlet launcher.

---

## 47. Production Readiness Checklist

```text
[ ] GlassFish/Payara version pinned.
[ ] Java runtime version supported.
[ ] Jakarta EE generation identified.
[ ] javax/jakarta namespace aligned.
[ ] Server-owned Jersey decision documented.
[ ] Jersey implementation not bundled accidentally.
[ ] Jakarta EE APIs marked provided.
[ ] Final WAR/EAR inspected.
[ ] Context root documented.
[ ] ApplicationPath documented.
[ ] Deployment command scripted.
[ ] Domain/server config versioned.
[ ] Required JDBC pools/resources automated.
[ ] JDBC pool size aligned with DB capacity and replica count.
[ ] JNDI names stable across environments.
[ ] CDI bean discovery verified.
[ ] Resource/provider injection tested.
[ ] JSON provider behavior tested.
[ ] Bean Validation error shape tested.
[ ] Transaction rollback tested.
[ ] Security roles/realm configured.
[ ] Domain authorization implemented where needed.
[ ] Health live/ready endpoints exposed.
[ ] Kubernetes probes target app path.
[ ] Startup validation implemented.
[ ] App-owned resources closed on shutdown.
[ ] Redeploy tested if operationally used.
[ ] Monitoring enabled for HTTP/JDBC/threads/JVM.
[ ] Access logs configured.
[ ] Correlation ID implemented.
[ ] Reverse proxy headers configured/trusted.
[ ] Admin console manual drift avoided.
[ ] Rollback tested.
```

---

## 48. Summary

GlassFish/Payara deployment is fundamentally different from Tomcat or embedded deployment.

Its essence:

```text
Server owns Jakarta EE runtime.
Application runs as a managed component.
Jersey/Jakarta REST is often server-provided.
```

This gives strong platform features:

- CDI,
- JTA,
- JPA,
- Bean Validation,
- Jakarta REST/Jersey,
- JDBC resources,
- security,
- admin tools,
- monitoring.

But it requires discipline:

- do not bundle conflicting platform implementations,
- align namespace and server generation,
- manage JNDI/resources as code,
- understand classloader universe,
- test CDI/transaction/provider behavior on target server,
- avoid admin-console drift.

Top-tier conclusion:

> GlassFish/Payara are not “heavier Tomcat”.  
> They are managed Jakarta EE runtimes with a different ownership contract.

---

## 49. How This Part Connects to the Next Part

This part covered GlassFish/Payara.

Next:

```text
Part 18 — Open Liberty Deployment: Feature-Based Runtime
```

Open Liberty changes the managed-server model:

```text
Instead of one monolithic platform runtime,
you explicitly enable features in server.xml.
```

Part 18 will focus on:

- feature-based Jakarta EE runtime,
- server.xml,
- Jakarta REST feature selection,
- CDI/JPA/security features,
- thin packaging,
- config externalization,
- Docker/Kubernetes,
- dev mode,
- classloading,
- why Liberty is a managed runtime with more explicit modularity.

---

## References

- Eclipse GlassFish Downloads: https://glassfish.org/download
- Eclipse GlassFish GitHub Releases: https://github.com/eclipse-ee4j/glassfish/releases
- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/3.0.1/deployment.html
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/
- Payara Community Documentation — Class Loaders: https://docs.payara.fish/community/docs/Technical%20Documentation/Application%20Development/Class%20Loaders.html
- Payara Enterprise Documentation — Class Loaders: https://docs.payara.fish/enterprise/docs/Technical%20Documentation/Application%20Development/Class%20Loaders.html
- Payara Documentation — create-jdbc-connection-pool: https://docs.payara.fish/community/docs/Technical%20Documentation/Payara%20Server%20Documentation/Command%20Reference/create-jdbc-connection-pool.html
- Payara Documentation — Using the JDBC API for Database Access: https://docs.payara.fish/community/docs/Technical%20Documentation/Application%20Development/Using%20the%20JDBC%20API%20for%20Database%20Access.html
- Payara Documentation — Elements of Deployment Descriptors: https://docs.payara.fish/community/docs/Technical%20Documentation/Payara%20Server%20Documentation/Application%20Deployment/Elements%20of%20Deployment%20Descriptors.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-016.md">⬅️ Part 16 — Jetty External Deployment: WAR vs Embedded Trade-Off</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-018.md">Part 18 — Open Liberty Deployment: Feature-Based Runtime ➡️</a>
</div>
