# learn-java-eclipse-jersey-deployment-models-part-019  
# Part 19 — Fat Jar, Uber Jar, Thin Jar, dan Distribution Layout

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 19 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey dari sisi artifact engineering, packaging, classpath, service discovery, reproducibility, dan operational distribution.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: fat jar, uber jar, shaded jar, thin jar, WAR, distribution directory, `META-INF/services`, classpath manifest, Docker image layering, dependency ownership, dan failure model packaging.

---

## 1. Mengapa Packaging Penting untuk Jersey Deployment?

Dalam banyak aplikasi Java, packaging dianggap pekerjaan build tool:

```text
mvn package
gradle build
docker build
```

Lalu selesai.

Untuk aplikasi Jersey, ini cara berpikir yang terlalu dangkal.

Packaging menentukan:

```text
- class mana yang tersedia saat runtime
- versi dependency mana yang menang
- apakah provider Jersey ditemukan
- apakah JSON provider aktif
- apakah ServiceLoader masih bekerja
- apakah duplicate classes tersembunyi
- apakah classloader container bisa memuat dependency
- apakah deployment bisa direproduksi
- apakah Docker image efisien
- apakah rollback mudah
- apakah audit artifact bisa dibuktikan
```

Pada Jersey, packaging sering memengaruhi:

- `MessageBodyReader`,
- `MessageBodyWriter`,
- `ExceptionMapper`,
- `ContainerRequestFilter`,
- `Feature`,
- HK2 injection,
- Jakarta REST runtime delegate,
- JSON provider,
- Bean Validation provider,
- multipart provider,
- MicroProfile/Jakarta integration,
- service discovery.

Top-tier mental model:

> Packaging bukan output akhir build.  
> Packaging adalah **runtime topology yang dibekukan menjadi artifact**.

---

## 2. Artifact Shape adalah Deployment Contract

Sebuah aplikasi Jersey bisa dideploy dalam banyak bentuk:

```text
WAR
fat jar / uber jar
shaded jar
thin jar + lib directory
exploded distribution
Docker image
server package
jlink runtime image
native image
```

Setiap bentuk artifact menjawab pertanyaan:

```text
Siapa yang membawa dependency?
Siapa yang menyediakan server/container?
Bagaimana classpath dibentuk?
Bagaimana ServiceLoader membaca provider?
Bagaimana config disuntikkan?
Bagaimana app distart?
Bagaimana app distop?
Bagaimana artifact diaudit?
```

Contoh:

```text
WAR on Tomcat:
  Tomcat owns Servlet.
  WAR owns Jersey.

WAR on Payara:
  Payara may own Jakarta REST/Jersey.
  WAR should not bundle server Jersey casually.

Fat jar with Grizzly:
  jar owns app + Jersey + Grizzly.

Thin distribution:
  app.jar owns code.
  lib/*.jar owns dependencies.
  startup script owns classpath.

Docker image:
  image owns runtime + app + dependency layers.
```

Artifact shape adalah bagian dari architecture decision.

---

## 3. Terminology: Fat Jar, Uber Jar, Shaded Jar, Thin Jar

Istilah sering dipakai campur, jadi kita luruskan.

### Fat Jar

Jar besar yang berisi aplikasi dan dependencies.

```text
app-fat.jar
  ├─ com/example/App.class
  ├─ org/glassfish/jersey/...
  ├─ com/fasterxml/jackson/...
  └─ META-INF/...
```

Tujuan:

```text
java -jar app-fat.jar
```

### Uber Jar

Sering sinonim dengan fat jar.

Biasanya berarti:

```text
one jar containing everything needed to run
```

### Shaded Jar

Jar yang dibuat dengan shading tool.

Bisa hanya merge dependencies, atau juga relocate packages.

Relocation example:

```text
com.google.common -> shaded.com.google.common
```

Shaded jar bisa menjadi fat jar, tetapi shading lebih spesifik karena ada transform/relocation.

### Thin Jar

Jar kecil berisi aplikasi saja, dependencies tetap terpisah.

```text
dist/
├─ app.jar
├─ lib/
│  ├─ jersey-server.jar
│  ├─ jersey-hk2.jar
│  └─ jackson-databind.jar
└─ bin/
   └─ start.sh
```

Run:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

### Distribution Directory

Folder lengkap untuk menjalankan app:

```text
my-service/
├─ bin/
├─ conf/
├─ lib/
├─ app/
├─ logs/
└─ README/RUNBOOK
```

---

## 4. Packaging vs Deployment Model

Mapping umum:

| Deployment Model | Common Artifact |
|---|---|
| Tomcat external | WAR |
| Jetty external | WAR |
| GlassFish/Payara | WAR/EAR |
| Open Liberty | WAR + server.xml / server package / image |
| Embedded Grizzly | fat jar or thin distribution |
| Embedded Jetty | fat jar or thin distribution |
| JDK HTTP Server | fat jar or thin distribution |
| Netty | fat jar or thin distribution |
| Kubernetes | Docker image, usually containing WAR or jar |
| Legacy VM/service | thin distribution often strong |
| CLI/internal tool | fat jar often convenient |

There is no universally best artifact.

The right artifact depends on:

```text
runtime ownership
dependency ownership
operational model
build reproducibility
startup speed
image layering
debuggability
security scanning
rollbacks
```

---

## 5. WAR Packaging

WAR is the canonical Servlet deployment artifact.

Structure:

```text
my-api.war
├─ META-INF/
├─ WEB-INF/
│  ├─ web.xml
│  ├─ classes/
│  └─ lib/
└─ static files optional
```

For Jersey on Tomcat/Jetty:

```text
WEB-INF/lib contains Jersey runtime
```

For Jersey on GlassFish/Payara/Open Liberty:

```text
server may provide Jakarta REST runtime
WAR should usually contain APIs as provided only
```

WAR strengths:

- standard servlet deployment,
- container-managed lifecycle,
- classloader isolation,
- compatible with mature app servers,
- good for external runtime ownership.

WAR risks:

- context path confusion,
- dependency scope mistakes,
- server-provided vs app-provided conflicts,
- redeploy leaks,
- classloader complexity,
- inconsistent server config.

WAR is excellent when server ownership is desired.

---

## 6. Fat Jar Packaging

Fat jar is common for embedded Jersey.

Example topology:

```text
java -jar case-api.jar

case-api.jar contains:
  app classes
  Jersey
  Grizzly/Jetty/Netty/JDK adapter
  JSON provider
  logging
  config library
  all dependencies
```

Strengths:

- simple to run,
- one file artifact,
- good for CLI/internal tools,
- simple Docker COPY,
- local/prod parity easier than external server.

Risks:

- service descriptor merge problems,
- duplicate classes hidden,
- package relocation mistakes,
- large artifact,
- hard to inspect dependency boundaries,
- difficult layer caching in Docker if one large jar changes often,
- signed jar metadata issues,
- multi-release jar handling.

Top-tier rule:

```text
Fat jar is operationally simple but build-semantically complex.
```

---

## 7. Thin Distribution

Thin distribution keeps dependencies as separate jars.

Example:

```text
case-api/
├─ bin/
│  ├─ start.sh
│  └─ start.ps1
├─ conf/
│  └─ application.properties
├─ app/
│  └─ case-api.jar
├─ lib/
│  ├─ jersey-server-3.1.x.jar
│  ├─ jersey-container-grizzly2-http-3.1.x.jar
│  ├─ jersey-hk2-3.1.x.jar
│  ├─ jackson-databind-2.x.jar
│  └─ ...
└─ README.md
```

Run:

```bash
java -cp "app/case-api.jar:lib/*" com.example.Main
```

Strengths:

- easier artifact inspection,
- no service descriptor merge needed,
- less shading risk,
- Docker dependency layer caching is easy,
- security scanning maps directly to jars,
- debugging classpath is clearer.

Risks:

- more files,
- classpath startup script must be correct,
- distribution assembly needed,
- file permissions/path separator issues,
- Windows/Linux script differences,
- dependency directory can drift if manually mutated.

Top-tier view:

```text
Thin distribution is often better for production than fat jar,
especially when dependency transparency matters.
```

---

## 8. Shaded Jar

Shaded jar is produced by merging dependencies into one jar, sometimes with relocation.

Maven Shade plugin and Gradle Shadow plugin are common.

Shading can do:

```text
merge classes
merge resources
relocate packages
remove signatures
set main class
minimize jar
```

For Jersey, the danger is resource merging.

Jersey and many dependencies rely on:

```text
META-INF/services/*
```

If shade overwrites service files instead of merging them, runtime discovery breaks.

Common symptom:

```text
MessageBodyWriter not found
MessageBodyReader not found
Feature not loaded
InjectionManagerFactory not found
RuntimeDelegate not found
```

Shading must be configured with service file merging.

---

## 9. `META-INF/services` and ServiceLoader

Java ServiceLoader uses files like:

```text
META-INF/services/jakarta.ws.rs.ext.RuntimeDelegate
META-INF/services/org.glassfish.jersey.internal.spi.AutoDiscoverable
META-INF/services/org.glassfish.jersey.internal.inject.InjectionManagerFactory
```

Content:

```text
com.example.SomeImplementation
org.glassfish.jersey.SomeProvider
```

When dependencies are separate jars:

```text
lib/a.jar has META-INF/services/X
lib/b.jar has META-INF/services/X
```

ServiceLoader can see both.

When shaded:

```text
app-fat.jar has only one META-INF/services/X
```

unless merge configured.

Correct behavior:

```text
all service entries must be combined
```

Incorrect behavior:

```text
last file wins
```

This is one of the most common packaging bugs in Jersey fat jars.

---

## 10. Maven Shade Service Merge

Conceptual Maven Shade config:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-shade-plugin</artifactId>
  <version>${maven.shade.version}</version>
  <executions>
    <execution>
      <phase>package</phase>
      <goals>
        <goal>shade</goal>
      </goals>
      <configuration>
        <transformers>
          <transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
          <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
            <mainClass>com.example.Main</mainClass>
          </transformer>
        </transformers>
      </configuration>
    </execution>
  </executions>
</plugin>
```

This matters because Maven Shade’s `ServicesResourceTransformer` relocates class names in `META-INF/services` and appends entries.

Without it, ServiceLoader-based discovery may break.

---

## 11. Gradle Shadow Service Merge

Conceptual Gradle Shadow config:

```groovy
plugins {
    id 'com.github.johnrengelman.shadow' version '8.1.1'
}

shadowJar {
    archiveClassifier.set("all")
    mergeServiceFiles()

    manifest {
        attributes 'Main-Class': 'com.example.Main'
    }
}
```

If using package relocation, be careful.

Do not casually relocate:

```text
jakarta.*
javax.*
org.glassfish.jersey.*
org.glassfish.hk2.*
com.fasterxml.jackson.*
```

unless you fully understand provider discovery, reflection, and service descriptors.

Relocation is safer for private helper libraries than framework APIs.

---

## 12. Signature Files

Some jars contain signature metadata:

```text
META-INF/*.SF
META-INF/*.DSA
META-INF/*.RSA
```

When shaded, signatures often become invalid because jar contents changed.

Symptoms:

```text
SecurityException: Invalid signature file digest
```

Common shade config excludes them:

```xml
<filters>
  <filter>
    <artifact>*:*</artifact>
    <excludes>
      <exclude>META-INF/*.SF</exclude>
      <exclude>META-INF/*.DSA</exclude>
      <exclude>META-INF/*.RSA</exclude>
    </excludes>
  </filter>
</filters>
```

But understand compliance implications.

If your org requires signed artifacts, define a signing process for final artifact.

---

## 13. Duplicate Classes

Duplicate classes can exist across dependencies.

Example:

```text
lib-a.jar: com/example/Util.class
lib-b.jar: com/example/Util.class
```

Or version conflict:

```text
jackson-databind-2.15.jar
jackson-databind-2.17.jar
```

In fat jar, duplicate classes may be silently overwritten during merge.

In thin distribution, classpath order determines winner.

Symptoms:

- `NoSuchMethodError`,
- `NoSuchFieldError`,
- `ClassCastException`,
- provider not found,
- behavior differs between local and Docker.

Production build should check duplicate classes.

Maven/Gradle plugins or custom scripts can enforce this.

Rule:

```text
Duplicate classes should fail the build unless explicitly accepted.
```

---

## 14. Dependency Convergence

Jersey should be version-aligned.

Bad:

```text
jersey-server 3.1.8
jersey-hk2 3.0.5
jersey-container-grizzly2-http 3.1.1
```

Good:

```text
Jersey BOM controls all Jersey artifacts
```

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
```

Gradle:

```groovy
dependencies {
    implementation platform("org.glassfish.jersey:jersey-bom:${jerseyVersion}")
}
```

Use convergence checks:

```text
mvn dependency:tree
mvn enforcer:enforce
gradle dependencyInsight
```

---

## 15. Dependency Scope by Artifact Type

### WAR on Servlet Container

```text
servlet-api:
  provided

Jersey runtime:
  packaged for Tomcat/Jetty

Jersey runtime:
  usually provided/not packaged for full Jakarta EE server
```

### Embedded Fat/Thin Jar

```text
HTTP server adapter:
  packaged

Jersey runtime:
  packaged

Servlet API:
  not needed unless using embedded Servlet
```

### Open Liberty/Payara/GlassFish

```text
Jakarta EE APIs:
  provided

Platform implementations:
  server-owned

App libraries:
  packaged
```

Incorrect scope is a deployment bug.

Example:

```text
Mark jersey-container-servlet-core as provided in Tomcat app.
```

Then runtime fails:

```text
ClassNotFoundException: org.glassfish.jersey.servlet.ServletContainer
```

---

## 16. Classpath Manifest

Jar manifest can specify main class and classpath:

```text
META-INF/MANIFEST.MF
```

Example:

```text
Main-Class: com.example.Main
Class-Path: lib/jersey-server.jar lib/jersey-hk2.jar lib/jackson-databind.jar
```

This allows:

```bash
java -jar app.jar
```

with external lib directory.

Risks:

- manifest classpath is space-separated,
- paths relative to jar location,
- long classpath,
- OS/package layout constraints,
- harder to generate correctly manually.

For production, startup scripts often provide clearer classpath.

---

## 17. Startup Scripts

Thin distribution usually needs scripts.

Linux:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_HOME="$(cd "$(dirname "$0")/.." && pwd)"

exec java \
  ${JAVA_OPTS:-} \
  -cp "$APP_HOME/app/case-api.jar:$APP_HOME/lib/*" \
  com.example.Main
```

Windows PowerShell:

```powershell
$ErrorActionPreference = "Stop"

$AppHome = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Classpath = "$AppHome\app\case-api.jar;$AppHome\lib\*"

java $env:JAVA_OPTS -cp $Classpath com.example.Main
```

Important:

```text
Linux classpath separator:
  :

Windows classpath separator:
  ;
```

Operational concerns:

- quote paths,
- propagate exit code,
- use `exec` in shell to receive signals,
- avoid swallowing SIGTERM,
- support JAVA_OPTS,
- support config path.

---

## 18. Signal Handling

In Docker, process PID 1 matters.

Bad shell script:

```bash
java -jar app.jar
```

without `exec`.

The shell remains PID 1 and may not forward signals properly.

Better:

```bash
exec java -jar app.jar
```

For thin script:

```bash
exec java -cp "$CP" com.example.Main
```

This allows JVM to receive SIGTERM.

If JVM does not receive SIGTERM, graceful shutdown fails.

Packaging affects lifecycle.

---

## 19. Distribution Layout for Embedded Jersey

Recommended thin layout:

```text
case-api-1.0.0/
├─ bin/
│  ├─ start.sh
│  ├─ start.ps1
│  └─ env.example
├─ app/
│  └─ case-api-1.0.0.jar
├─ lib/
│  └─ *.jar
├─ conf/
│  ├─ application.conf
│  └─ logging.xml
├─ docs/
│  ├─ README.md
│  └─ RUNBOOK.md
└─ sbom/
   └─ sbom.json
```

Benefits:

- clear runtime boundary,
- config separated,
- libraries inspectable,
- scripts controlled,
- docs packaged,
- SBOM attached.

Avoid:

```text
random jars in root directory
config mixed with logs
manual copied dependencies
mutable production directory
```

---

## 20. Distribution Layout for WAR on Server

For external server:

```text
release/
├─ app/
│  └─ case-api.war
├─ server-config/
│  ├─ server.xml
│  ├─ context.xml
│  └─ domain-config scripts
├─ deploy/
│  ├─ deploy.sh
│  └─ rollback.sh
├─ docs/
│  ├─ RUNBOOK.md
│  └─ CHANGELOG.md
└─ sbom/
   └─ sbom.json
```

This is stronger than only producing WAR.

Why?

Because real deployment needs:

- app artifact,
- server config,
- deployment script,
- rollback script,
- resource provisioning,
- runbook,
- SBOM.

Top-tier deployment includes operational artifacts, not just binaries.

---

## 21. Docker Image Layering

For fat jar:

```Dockerfile
COPY target/app-all.jar /app/app.jar
```

Every code change changes the entire jar layer.

For thin layout:

```Dockerfile
COPY build/dependency/lib/ /app/lib/
COPY build/app/app.jar /app/app.jar
```

Dependency layer changes less often.

Better caching:

```text
base JRE layer
dependency jars layer
application jar layer
config layer
```

Layered Dockerfile:

```Dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app

COPY lib/ /app/lib/
COPY app/case-api.jar /app/app.jar

USER 10001

ENTRYPOINT ["java", "-cp", "/app/app.jar:/app/lib/*", "com.example.Main"]
```

For Spring Boot there are special layered jars, but Jersey plain apps often need custom layering.

---

## 22. Docker Image with WAR

Tomcat/Jetty/Liberty/Payara image:

```text
base server image
  ↓
server config layer
  ↓
WAR layer
```

Example Tomcat:

```Dockerfile
FROM tomcat:10.1-jre21

RUN rm -rf /usr/local/tomcat/webapps/*

COPY server.xml /usr/local/tomcat/conf/server.xml
COPY target/case-api.war /usr/local/tomcat/webapps/ROOT.war
```

Packaging decision:

```text
WAR name determines context path
unless server config overrides it
```

If copied as:

```text
ROOT.war
```

context is:

```text
/
```

If copied as:

```text
case-api.war
```

context is:

```text
/case-api
```

This affects health probes, ingress paths, and clients.

---

## 23. Reproducible Builds

A production artifact should be reproducible enough that you can answer:

```text
Which source commit produced this?
Which dependency versions are included?
Which build tool version?
Which Java version?
Which timestamp?
Which environment?
Which SBOM?
Which checksum?
```

Practical steps:

- pin plugin versions,
- pin dependency versions/BOM,
- use lockfiles where possible,
- archive dependency tree,
- generate SBOM,
- compute checksum,
- embed build metadata,
- avoid dynamic versions,
- avoid “latest” Docker tags,
- use `--release`,
- keep build environment controlled.

Example build metadata endpoint:

```text
GET /build-info
```

returns:

```json
{
  "name": "case-api",
  "version": "1.0.0",
  "commit": "abc123",
  "buildTime": "2026-06-21T10:00:00Z",
  "javaTarget": "21",
  "jerseyVersion": "3.1.x"
}
```

Protect if it reveals sensitive info.

---

## 24. SBOM

SBOM means Software Bill of Materials.

It lists components included in artifact/image.

Useful for:

- vulnerability response,
- license review,
- audit,
- dependency ownership,
- incident investigation,
- supply chain security.

For Jersey deployment, SBOM helps answer:

```text
Which Jersey version?
Which Jackson version?
Which Netty version?
Which servlet API?
Which JSON provider?
Which transitive vulnerable jar?
```

Generate SBOM at build time.

Attach it to release.

Do not generate SBOM after artifact mutation.

---

## 25. Build Metadata in Artifact

Include:

```text
Implementation-Title
Implementation-Version
Build-Commit
Build-Time
Build-Java-Version
```

Manifest example:

```text
Implementation-Title: case-api
Implementation-Version: 1.0.0
Build-Commit: abc123
Build-Java-Version: 21
```

This helps runtime diagnostics.

For WAR:

```text
META-INF/MANIFEST.MF
```

For jar:

```text
META-INF/MANIFEST.MF
```

Expose safe subset via health/info endpoint.

---

## 26. Config Packaging

Never bake secrets into artifact.

Bad:

```text
src/main/resources/application-prod.properties contains DB password
```

Better:

```text
artifact contains default config structure
runtime injects values
```

Sources:

- env vars,
- mounted config files,
- Kubernetes ConfigMaps/Secrets,
- cloud secret manager,
- server resource config,
- system properties,
- MicroProfile Config.

For Jersey plain apps, define config precedence.

Example:

```text
1. command line system properties
2. environment variables
3. external config file
4. packaged defaults
```

Document it.

---

## 27. Logging Config Packaging

Logging config can be:

```text
inside artifact
external file
server-managed
environment variable controlled
```

Production preference:

```text
safe default inside artifact
environment override possible
```

Do not require editing jar/WAR to change log level.

For containers:

```text
logs to stdout/stderr
structured if possible
```

If file logging is used, ensure collector reads files and rotation is configured.

---

## 28. Classpath Ordering

Thin distribution classpath order matters.

Example:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

`lib/*` order is not always something to rely on for conflict resolution.

Do not depend on classpath order to pick correct version.

Instead:

```text
avoid duplicate versions
enforce dependency convergence
fail build on duplicates
```

Classpath ordering as conflict resolution is fragile.

---

## 29. Multi-Release JARs

Modern dependencies may be multi-release JARs.

Structure:

```text
META-INF/versions/9/
META-INF/versions/11/
META-INF/versions/17/
```

Runtime Java version selects version-specific classes.

Implications:

```text
same artifact may behave differently on Java 11 vs 21 vs 25
shading must preserve multi-release structure correctly
custom scanners must understand it
Docker base image Java version matters
```

If app works on Java 17 but fails on Java 25, check:

- dependency compatibility,
- multi-release behavior,
- illegal reflective access,
- removed/changed JDK internals,
- build `--release`,
- runtime image.

---

## 30. `--release` and Bytecode Target

Use `--release` for compile target.

Maven:

```xml
<properties>
    <maven.compiler.release>21</maven.compiler.release>
</properties>
```

Gradle:

```groovy
tasks.withType(JavaCompile).configureEach {
    options.release = 21
}
```

Do not compile with Java 25 APIs if runtime is Java 21.

Bad:

```text
compiled on JDK 25
target bytecode manually set to 21
but uses API introduced after 21
```

`--release` prevents this.

For server deployment:

```text
compile target <= server runtime Java version
```

---

## 31. jlink Runtime Image

For embedded Jersey, you may create custom runtime image.

Pros:

- smaller runtime,
- controlled modules,
- no full JDK needed,
- reproducibility.

Cons:

- module dependency analysis,
- reflection/service loading complexity,
- missing modules,
- harder debugging,
- server/container agents compatibility.

If using JDK HTTP Server:

```text
include jdk.httpserver
```

If using logging/XML/JNDI/etc:

```text
include required modules
```

Test final jlink image, not just full JDK.

---

## 32. Native Image

Native image packaging is separate topic, but relevant.

For Jersey:

- reflection,
- injection,
- JSON serialization,
- ServiceLoader,
- proxies,
- resources,
- dynamic classloading,

make native image non-trivial.

Do not treat native image as “another packaging option” without deep compatibility work.

For this Jersey deployment series, native image concerns will be revisited in Quarkus/Native-image style deployment contexts elsewhere, but here the rule is:

```text
Plain Jersey native image requires explicit runtime metadata and testing.
```

---

## 33. Artifact Inspection Checklist

For WAR:

```bash
jar tf target/case-api.war | sort > war-contents.txt
```

Check:

```text
WEB-INF/classes exists
WEB-INF/lib expected dependencies
no servlet-api packaged if provided
no javax/jakarta mismatch
no duplicate Jersey major versions
web.xml if expected
META-INF/MANIFEST.MF metadata
```

For fat jar:

```bash
jar tf target/case-api-all.jar | sort > jar-contents.txt
```

Check:

```text
Main-Class
META-INF/services entries
no duplicate signature files
expected Jersey classes
expected JSON provider
no accidental test classes
no secrets
```

For thin distribution:

```bash
find dist -type f | sort
```

Check:

```text
app jar
lib jars
scripts executable
config templates
SBOM
checksums
no duplicate versions
```

---

## 34. Runtime Code Source Diagnostic

At runtime, print where key classes come from:

```java
public final class CodeSourceDiagnostic {

    public static String source(Class<?> type) {
        var codeSource = type.getProtectionDomain().getCodeSource();
        return type.getName() + " -> " +
            (codeSource == null ? "<unknown>" : codeSource.getLocation());
    }
}
```

Check:

```java
source(jakarta.ws.rs.core.Response.class);
source(org.glassfish.jersey.server.ResourceConfig.class);
source(org.glassfish.jersey.servlet.ServletContainer.class);
source(com.fasterxml.jackson.databind.ObjectMapper.class);
```

For Jersey 2:

```java
source(javax.ws.rs.core.Response.class);
```

This answers:

```text
Which artifact actually supplied the class?
```

Do not expose this endpoint publicly in production.

---

## 35. Health of Packaging: Smoke Test Matrix

Every final artifact should be smoke-tested.

WAR:

```text
start target container
deploy WAR
GET health
GET JSON
POST JSON
validation error
exception mapper
shutdown/undeploy
```

Fat jar:

```text
java -jar artifact
GET health
GET JSON
POST JSON
SIGTERM
```

Thin distribution:

```text
run bin/start.sh
run bin/start.ps1 if Windows support needed
GET health
inspect classpath
SIGTERM
```

Docker image:

```text
docker run
GET health
inspect logs
send docker stop
verify graceful shutdown
```

Kubernetes:

```text
startupProbe
readinessProbe
livenessProbe
rolling update
termination under load
```

Testing source code is not enough.

Test the artifact.

---

## 36. Security Packaging Concerns

Packaging can create security issues:

- vulnerable transitive jar included,
- duplicate old jar shadows patched jar,
- dependency confusion,
- bundled secrets,
- leftover test resources,
- debug endpoints enabled,
- signed jar signatures invalid,
- global server lib shared across apps,
- Docker image uses vulnerable base,
- dependency downloaded from untrusted repo.

Production controls:

```text
dependency lock
SBOM
vulnerability scan
license scan
artifact checksum
repository allowlist
no dynamic versions
no secrets in artifact
image scanning
base image pinning
```

Security is not only code review. It is also artifact review.

---

## 37. Rollback and Artifact Immutability

Rollback requires old artifact still available.

Bad:

```text
deploy latest.war
overwrite old file
manual changes in server
no checksum
```

Good:

```text
case-api-1.0.0.war
case-api-1.0.1.war
image tags immutable by digest
deployment metadata archived
SBOM archived
config version known
rollback command tested
```

Do not rely on mutable tags:

```text
latest
prod
stable
```

without digest pinning.

Use immutable release identifiers.

---

## 38. Environment Parity

Artifact should behave the same across:

```text
local
CI
DEV
UAT
PROD
```

Differences should be external config, not artifact mutation.

Bad:

```text
different WAR built for UAT and PROD
```

unless there is a strict reason.

Better:

```text
same artifact promoted through environments
different config injected at runtime
```

This improves confidence and auditability.

---

## 39. Common Packaging Failure Modes

### 39.1 `MessageBodyWriter not found`

Causes:

```text
JSON provider missing
service descriptor lost
wrong provider namespace
provider not registered
```

### 39.2 `InjectionManagerFactory not found`

Causes:

```text
jersey-hk2 missing
service descriptor lost
Jersey versions mixed
```

### 39.3 `ClassNotFoundException: ServletContainer`

Causes:

```text
jersey-container-servlet-core missing
dependency scope provided incorrectly
```

### 39.4 `NoSuchMethodError`

Causes:

```text
version mismatch
duplicate older dependency wins
server library conflicts with app library
```

### 39.5 Works Locally, Fails in Docker

Causes:

```text
Docker image has different Java version
fat jar lost service files
working directory/config path different
bind host localhost
missing external config
```

### 39.6 Works as Thin Jar, Fails as Fat Jar

Causes:

```text
META-INF/services not merged
resource collision
relocation problem
signature issue
multi-release jar issue
```

---

## 40. Anti-Patterns

### Anti-Pattern 1 — “Just Make a Fat Jar”

Fat jar requires service/resource merge discipline.

### Anti-Pattern 2 — Packaging Platform APIs Everywhere

Servlet/Jakarta EE APIs should often be `provided` in server deployment.

### Anti-Pattern 3 — Depending on Classpath Order

Fix dependency conflict; do not rely on classpath accident.

### Anti-Pattern 4 — No Artifact Inspection

If you do not inspect the final artifact, you do not know what you deploy.

### Anti-Pattern 5 — Mutable Production Directory

Manual changes destroy reproducibility.

### Anti-Pattern 6 — No SBOM

You cannot respond well to vulnerability incidents.

### Anti-Pattern 7 — Rebuilding Per Environment

Promote same artifact with different config instead.

---

## 41. Decision Matrix

| Artifact Type | Strength | Main Risk | Best Use |
|---|---|---|---|
| WAR | standard servlet/server deployment | server/app dependency conflict | Tomcat, Jetty, Jakarta EE servers |
| Fat jar | simple single-file run | service descriptor/shading issues | embedded services/tools |
| Shaded jar | relocation/merge capability | provider discovery breakage | special dependency isolation |
| Thin distribution | transparent dependencies | more files/scripts | production embedded services |
| Docker image | immutable runtime bundle | base image/config drift | Kubernetes/cloud |
| Server package | app + server config bundle | server-specific packaging | Open Liberty/managed runtime |
| jlink image | smaller controlled JRE | missing modules | optimized embedded deployments |

---

## 42. Recommended Defaults

### For Tomcat/External Jetty

```text
WAR
Servlet API provided
Jersey packaged
Jersey BOM
explicit ResourceConfig
final WAR inspection
```

### For GlassFish/Payara/Open Liberty

```text
WAR/EAR or server package
Jakarta EE APIs provided
server owns platform implementation
avoid bundled Jersey unless intentional
server config as code
```

### For Embedded Grizzly/Jetty/Netty/JDK HTTP

```text
thin distribution for production transparency
fat jar acceptable if shade configured correctly
Docker image with dependency layering
explicit startup script/lifecycle
```

### For Kubernetes

```text
immutable image
health probes tested
same artifact promoted
SBOM generated
config/secrets externalized
```

---

## 43. Top-Tier Engineering Perspective

A basic engineer says:

```text
Build succeeded.
```

A senior engineer asks:

```text
What artifact did we build?
```

A top-tier engineer asks:

```text
Which runtime owns which dependencies?
Which classes are in the final artifact?
Are ServiceLoader descriptors preserved?
Are duplicate classes banned?
Is the namespace coherent?
Can we reproduce this artifact?
Can we prove dependency versions?
Can we run smoke tests against final packaging?
Can we roll back by digest/checksum?
Can we answer vulnerability impact quickly?
```

This is packaging as engineering, not packaging as build afterthought.

---

## 44. Production Readiness Checklist

```text
[ ] Artifact type chosen deliberately.
[ ] Deployment model matched to artifact type.
[ ] Java compile target uses --release.
[ ] Jersey BOM/version alignment enforced.
[ ] Dependency convergence checked.
[ ] Duplicate classes checked.
[ ] javax/jakarta namespace checked.
[ ] Final artifact inspected.
[ ] No secrets inside artifact.
[ ] Build metadata embedded.
[ ] SBOM generated.
[ ] Artifact checksum generated.
[ ] Vulnerability scan run.
[ ] License scan run if required.
[ ] Service descriptors merged for fat/shaded jar.
[ ] Signature files handled correctly for shaded jar.
[ ] Main-Class present if executable jar.
[ ] Startup scripts use exec and preserve signals.
[ ] Thin distribution classpath tested.
[ ] WAR dependency scopes correct.
[ ] Server-provided dependencies not bundled accidentally.
[ ] Docker image uses pinned base.
[ ] Docker layers structured for caching.
[ ] Runtime config externalized.
[ ] Logging config override possible.
[ ] Smoke test runs final artifact.
[ ] Docker stop/SIGTERM tested.
[ ] Kubernetes probes tested.
[ ] Rollback artifact/digest available.
```

---

## 45. Summary

Packaging determines whether Jersey deployment actually works.

The code may be correct, but deployment can fail because:

```text
- provider service files were overwritten
- Jersey modules are mixed versions
- servlet API packaged incorrectly
- server-owned implementation conflicts with WAR
- JSON provider missing
- classpath order hides wrong version
- Docker image runs different Java version
- fat jar loses metadata
```

The key insight:

> Artifact shape is runtime architecture.

A top-tier engineer treats packaging as part of system design:

- dependency ownership,
- service discovery,
- classpath,
- reproducibility,
- observability,
- security,
- rollback.

If deployment must be reliable, artifact engineering must be deliberate.

---

## 46. How This Part Connects to the Next Part

This part covered artifact shapes and distribution layout.

Next:

```text
Part 20 — Docker Deployment Model for Jersey
```

We will go deeper into:

- base image selection,
- JDK/JRE versions,
- non-root containers,
- JVM ergonomics under cgroups,
- memory/CPU limits,
- layering strategies,
- health checks,
- signal handling,
- read-only filesystem,
- secrets/config injection,
- SBOM/image scanning,
- deployment model differences for WAR vs embedded jar.

---

## References

- Maven Shade Plugin — Resource Transformers: https://maven.apache.org/plugins/maven-shade-plugin/examples/resource-transformers.html
- Maven Shade Plugin — `ServicesResourceTransformer`: https://maven.apache.org/plugins/maven-shade-plugin/apidocs/org/apache/maven/plugins/shade/resource/ServicesResourceTransformer.html
- Gradle Shadow Plugin — Merging Service Descriptor Files: https://gradleup.com/shadow/configuration/merging/
- Oracle Java SE API — `ServiceLoader`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ServiceLoader.html
- Apache Tomcat Class Loader How-To: https://tomcat.apache.org/tomcat-10.1-doc/class-loader-howto.html
- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Open Liberty documentation — Container images and Docker guide: https://openliberty.io/guides/docker.html
- CycloneDX Maven Plugin: https://github.com/CycloneDX/cyclonedx-maven-plugin
- SPDX Software Bill of Materials: https://spdx.dev/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-018.md">⬅️ Part 18 — Open Liberty Deployment: Feature-Based Runtime</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-020.md">Part 20 — Docker Deployment Model for Jersey ➡️</a>
</div>
