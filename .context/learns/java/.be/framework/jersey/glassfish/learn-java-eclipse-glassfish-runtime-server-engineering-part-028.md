# learn-java-eclipse-glassfish-runtime-server-engineering-part-028  
# Part 28 — Legacy Modernization: GlassFish 4/5 Java EE ke GlassFish 7/8 Jakarta EE

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 28 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **modernisasi aplikasi legacy Java EE di GlassFish 4/5 menuju GlassFish 7/8 Jakarta EE**: namespace `javax` → `jakarta`, JDK upgrade, dependency compatibility, descriptor migration, runtime config, test strategy, deployment strategy, dan risk control

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami kenapa migrasi GlassFish 4/5 ke 7/8 bukan sekadar “replace import”;
2. memetakan perbedaan besar:
   - GlassFish 4/5;
   - Java EE 7/8;
   - Jakarta EE 9/10/11;
   - JDK 8/11/17/21/25;
3. membuat inventory aplikasi legacy:
   - source code;
   - dependencies;
   - deployment descriptors;
   - JNDI resources;
   - server-specific descriptors;
   - SOAP/JAX-WS/JAXB;
   - EJB;
   - JMS;
   - JPA;
   - CDI;
   - Servlet/JSP/JSF;
   - security realms;
4. menjalankan migrasi namespace `javax.*` ke `jakarta.*` secara aman;
5. memahami tool seperti Eclipse Transformer dan OpenRewrite;
6. memigrasikan build Maven/Gradle dependency dari `javaee-api` ke `jakarta.*`;
7. memahami compatibility trap library pihak ketiga;
8. menyusun strategi migrasi bertahap vs big bang;
9. menjalankan test matrix dan dual-runtime validation;
10. menyusun production migration checklist dan rollback plan.

Part ini adalah salah satu part paling penting untuk engineer yang memelihara sistem enterprise lama. Banyak organisasi tidak gagal karena “tidak tahu Jakarta EE”, tetapi karena meremehkan **surface area migration**.

---

## 1. Mental Model: Migrasi Ini adalah Ecosystem Migration

Banyak orang menganggap migrasi Java EE ke Jakarta EE seperti ini:

```text
javax.servlet.* -> jakarta.servlet.*
javax.persistence.* -> jakarta.persistence.*
javax.ws.rs.* -> jakarta.ws.rs.*
```

Lalu selesai.

Itu salah.

Migrasi sesungguhnya menyentuh:

```text
Source imports
Annotations
Deployment descriptors
Generated code
Reflection strings
JSP/Facelets/taglibs
JPA provider
CDI extensions
EJB remote/local interfaces
JAX-RS providers
JAXB/JAX-WS tooling
Bean Validation
Servlet filters/listeners
Security descriptors
JNDI resources
Maven/Gradle dependencies
Third-party libraries
Test framework
Build plugins
App server runtime
JDK version
GC/security/TLS behavior
CI/CD pipeline
Deployment rollback strategy
```

Top 1% engineer melihat migrasi ini sebagai:

```text
behavior-preserving ecosystem modernization
```

Bukan:

```text
search and replace.
```

---

## 2. Version Landscape

### 2.1 GlassFish 4

Umum terkait Java EE 7 era.

Karakter:

```text
javax namespace
older JDK assumptions
legacy dependencies
older CDI/JPA/Servlet/JAX-RS APIs
```

### 2.2 GlassFish 5

Umum terkait Java EE 8 / Jakarta EE 8 transition era.

Karakter:

```text
still javax namespace
Java EE 8 API surface
often runs with JDK 8 era assumptions
```

### 2.3 GlassFish 6

Jakarta EE 9 era.

Karakter:

```text
jakarta namespace
namespace transition release
functional goal close to Java EE/Jakarta EE 8, but package renamed
```

Jakarta EE 9 secara umum adalah turning point karena API pindah ke namespace `jakarta.*`.

### 2.4 GlassFish 7

Jakarta EE 10 era.

Karakter:

```text
jakarta namespace
newer APIs
runs on modern JDKs
better target for serious modernization from Java EE 8
```

GlassFish 7.x corresponds to Jakarta EE 10 in current official download line.

### 2.5 GlassFish 8

Jakarta EE 11 era.

Karakter:

```text
jakarta namespace
requires JDK 21 or higher
implements Jakarta EE 11
newer API/runtime baseline
```

GlassFish 8 is a bigger step because JDK minimum jumps to 21 and Jakarta EE level moves to 11.

---

## 3. Migration Strategy Choice

Ada tiga strategi besar.

### 3.1 Direct Big Bang: GF 4/5 → GF 8

```text
Java EE javax + JDK 8 era
  -> Jakarta EE 11 + JDK 21+
```

Pros:

- langsung ke target modern;
- tidak perlu migrasi berkali-kali;
- future-ready.

Cons:

- risk tinggi;
- banyak variabel berubah sekaligus;
- dependency breakage besar;
- rollback lebih sulit;
- testing surface besar.

Cocok jika:

- aplikasi kecil/menengah;
- test coverage kuat;
- dependency modern;
- team punya migration window cukup;
- downtime/parallel run memungkinkan.

---

### 3.2 Stepwise: GF 4/5 → GF 6/7 → GF 8

```text
Step 1: stabilize on Java EE 8 / GF5 if needed
Step 2: namespace migration to Jakarta EE 9/10 / GF7
Step 3: JDK 21 + Jakarta EE 11 / GF8
```

Pros:

- risiko dipisah;
- easier root cause isolation;
- progress incremental;
- lebih cocok untuk sistem besar.

Cons:

- lebih lama;
- intermediate states;
- perlu maintain multiple branches/environments.

Cocok untuk aplikasi enterprise besar.

---

### 3.3 Strangler / Parallel Modernization

```text
Legacy GF 4/5 app remains.
New modules/services built on GF 7/8 or other runtime.
Traffic/features migrated gradually.
```

Pros:

- risiko lebih rendah;
- cocok untuk sistem besar;
- bisa migrate bounded context;
- business continuity lebih baik.

Cons:

- integration complexity;
- duplicated logic sementara;
- data consistency;
- routing/SSO complexity.

Cocok jika sistem sangat besar, critical, dan tidak realistis big bang.

---

## 4. Golden Rule: Kurangi Variabel yang Berubah Sekaligus

Jangan ubah sekaligus:

```text
JDK
GlassFish
Jakarta namespace
JPA provider
DB driver
logging framework
security mechanism
CI/CD
containerization
database schema besar
```

Jika semua berubah, saat gagal kamu tidak tahu penyebabnya.

Better:

```text
Phase 1:
  inventory + tests

Phase 2:
  build modernization

Phase 3:
  namespace migration

Phase 4:
  runtime migration

Phase 5:
  dependency upgrade

Phase 6:
  performance/security hardening

Phase 7:
  production rollout
```

---

## 5. Migration Inventory

Buat inventory sebelum menyentuh kode.

### 5.1 Source Code Scan

Cari:

```text
javax.
import javax
@ManagedBean
@Stateless
@EJB
@Resource
@PersistenceContext
@Context
@Path
@WebServlet
@WebFilter
@WebListener
```

Command:

```bash
grep -R "javax\." -n src/
grep -R "javaee-api\|javax:" -n pom.xml build.gradle
```

PowerShell:

```powershell
Select-String -Path .\src\**\*.java -Pattern "javax\."
```

### 5.2 Descriptor Scan

Cari dalam:

```text
WEB-INF/web.xml
WEB-INF/glassfish-web.xml
META-INF/application.xml
META-INF/ejb-jar.xml
META-INF/persistence.xml
META-INF/ra.xml
META-INF/beans.xml
META-INF/validation.xml
faces-config.xml
*.tag
*.xhtml
*.jsp
```

### 5.3 Runtime Config Scan

GlassFish:

```text
domain.xml
JDBC resources
JMS resources
security realms
thread pools
JVM options
libraries
connector resources
keystores/truststores
password aliases
```

### 5.4 Dependency Scan

```bash
mvn dependency:tree
gradle dependencies
```

Look for:

- `javax.*` APIs;
- Java EE API jars;
- old Jersey;
- old Hibernate/EclipseLink;
- old JSF/Mojarra;
- old CDI/Weld;
- old Bean Validation;
- old JAXB/JAX-WS;
- old logging bridges;
- old database drivers;
- vendor SDK compiled against `javax`.

---

## 6. Namespace Migration: `javax` ke `jakarta`

Jakarta EE 9 introduced the big namespace switch.

Examples:

```java
javax.servlet.http.HttpServlet
  -> jakarta.servlet.http.HttpServlet

javax.ws.rs.GET
  -> jakarta.ws.rs.GET

javax.persistence.Entity
  -> jakarta.persistence.Entity

javax.ejb.Stateless
  -> jakarta.ejb.Stateless

javax.inject.Inject
  -> jakarta.inject.Inject

javax.validation.constraints.NotNull
  -> jakarta.validation.constraints.NotNull
```

Important exception:

```text
javax.sql.DataSource remains javax.sql because JDBC is Java SE.
javax.naming remains javax.naming because JNDI is Java SE.
javax.net.ssl remains Java SE.
javax.xml.* may be Java SE depending package.
```

Do not blindly replace every `javax` with `jakarta`.

---

## 7. Common Packages That Migrate

Common Jakarta EE packages:

```text
javax.annotation       -> jakarta.annotation
javax.ejb              -> jakarta.ejb
javax.enterprise       -> jakarta.enterprise
javax.inject           -> jakarta.inject
javax.interceptor      -> jakarta.interceptor
javax.jms              -> jakarta.jms
javax.json             -> jakarta.json
javax.json.bind        -> jakarta.json.bind
javax.mail             -> jakarta.mail
javax.persistence      -> jakarta.persistence
javax.resource         -> jakarta.resource
javax.security         -> jakarta.security
javax.servlet          -> jakarta.servlet
javax.transaction      -> jakarta.transaction
javax.validation       -> jakarta.validation
javax.websocket        -> jakarta.websocket
javax.ws.rs            -> jakarta.ws.rs
javax.xml.bind         -> jakarta.xml.bind
javax.xml.soap         -> jakarta.xml.soap
javax.xml.ws           -> jakarta.xml.ws
javax.faces            -> jakarta.faces
```

But verify exact spec/version.

---

## 8. Packages That Often Stay `javax`

Examples:

```text
javax.sql
javax.naming
javax.net
javax.crypto
javax.xml.parsers
javax.xml.transform
javax.xml.stream
javax.management
```

These are Java SE/JDK APIs, not Jakarta EE namespace migration targets.

This is why automated migration must use a curated rule set, not global text replacement.

---

## 9. Source Migration Tools

### 9.1 Eclipse Transformer

Eclipse Transformer can transform Java/Jakarta package names in:

- compiled binaries;
- source-like text;
- descriptors;
- archives.

Useful for:

- third-party jar transformation if source unavailable;
- WAR/EAR migration experiments;
- descriptor/package transformation.

But:

- transformed binaries need testing;
- legal/vendor support matters;
- not all libraries safe to transform;
- reflection strings/custom protocols may still fail;
- generated code may need rebuild.

### 9.2 OpenRewrite

OpenRewrite provides recipes for automated Java source migration.

Useful for:

- source imports;
- dependencies;
- API migration;
- repeatable refactoring;
- CI-driven modernization.

Better for projects where you own source.

### 9.3 IDE Refactor

Works for small codebases.

Risk:

- misses descriptors;
- misses string references;
- misses generated sources;
- not repeatable.

### 9.4 Manual Review

Still required.

Automated tools reduce mechanical work, but humans verify semantics.

---

## 10. Build Dependency Migration

Old Maven example:

```xml
<dependency>
    <groupId>javax</groupId>
    <artifactId>javaee-api</artifactId>
    <version>8.0</version>
    <scope>provided</scope>
</dependency>
```

Jakarta platform API example:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>10.0.0</version>
    <scope>provided</scope>
</dependency>
```

For Jakarta EE 11, use appropriate Jakarta EE 11 API version.

Rule:

```text
Application server provides Jakarta EE APIs.
Use provided scope for platform APIs.
Do not bundle full platform API jars into WAR/EAR.
```

---

## 11. Dependency Compatibility Trap

You cannot mix randomly:

```text
Application code: jakarta.*
Library expects: javax.*
Runtime: Jakarta EE 10/11
```

If library takes Servlet API type:

```java
javax.servlet.Filter
```

it is not assignable to:

```java
jakarta.servlet.Filter
```

Same concept for:

- JAX-RS providers;
- Servlet filters/listeners;
- CDI extensions;
- JPA annotations;
- Bean Validation;
- JMS;
- EJB;
- JSF components.

You need library versions built for Jakarta namespace.

---

## 12. Third-Party Library Audit

For every dependency ask:

```text
Does this library touch Jakarta EE APIs?
Does it have Jakarta-compatible version?
Is it still maintained?
Does it use reflection over javax names?
Does it generate code?
Does it ship servlet filter/listener?
Does it integrate with JPA/CDI/JAX-RS/JSF?
```

High-risk dependencies:

- old Jersey/RESTEasy;
- old Hibernate/EclipseLink;
- old JSF component libraries;
- old PrimeFaces versions;
- old Apache CXF/JAX-WS;
- old Spring versions;
- old security filters;
- old SAML/OIDC libraries;
- old Bean Validation providers;
- old JPA entity listeners;
- old resource adapters.

---

## 13. Descriptor Migration

XML descriptors may contain namespace/schema changes and class names.

Examples:

### `web.xml`

Old:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         version="4.0">
```

New Jakarta versions use Jakarta XML namespace depending spec version.

### Class references

```xml
<filter-class>com.example.LegacyFilter</filter-class>
```

The class itself may now implement `jakarta.servlet.Filter`.

### Role/resource mapping

GlassFish descriptors may still look similar, but app class/API names and schema may change.

Always validate descriptors against target runtime.

---

## 14. Persistence Migration

JPA package:

```text
javax.persistence -> jakarta.persistence
```

But migration also touches:

- provider version;
- persistence.xml namespace;
- entity annotations;
- criteria API;
- converters;
- entity listeners;
- second-level cache;
- weaving/enhancement;
- query behavior;
- transaction integration.

GlassFish historically uses EclipseLink as default provider. Version changes can change behavior.

Checklist:

```text
entity scan works
persistence unit name same
JTA datasource JNDI works
schema generation disabled/controlled
queries pass
lazy loading behavior same
converter/listener works
transaction rollback works
```

---

## 15. Servlet/JSP/JSF Migration

Servlet:

```text
javax.servlet -> jakarta.servlet
```

JSP/JSTL/EL/JSF can involve:

- taglib URI changes;
- JSF namespace changes;
- component library compatibility;
- custom tags;
- Facelets;
- filters/listeners;
- web fragments.

High risk:

- old JSF component libraries not Jakarta compatible;
- JSP custom tag classes;
- EL behavior differences;
- multipart config;
- servlet container default changes.

Test:

- login page;
- forms;
- file upload;
- session timeout;
- CSRF;
- view state;
- AJAX components;
- error pages.

---

## 16. JAX-RS Migration

Package:

```text
javax.ws.rs -> jakarta.ws.rs
```

Check:

- resource classes;
- providers;
- filters;
- exception mappers;
- entity readers/writers;
- JSON provider;
- multipart provider;
- client API;
- OpenAPI integration;
- security filters.

Library compatibility matters. Old Jersey extension built for `javax.ws.rs` will not work with `jakarta.ws.rs`.

---

## 17. EJB Migration

Package:

```text
javax.ejb -> jakarta.ejb
```

Check:

- stateless/stateful/singleton beans;
- timers;
- interceptors;
- transaction attributes;
- remote/local interfaces;
- portable JNDI names;
- EJB references;
- MDBs;
- passivation serialization.

Remote EJB is especially risky if clients remain old `javax` era.

Options:

- migrate client and server together;
- expose HTTP/gRPC/API boundary instead;
- keep legacy adapter bridge;
- run old and new systems in parallel.

---

## 18. JMS Migration

Package:

```text
javax.jms -> jakarta.jms
```

Check:

- connection factory JNDI;
- queue/topic resource;
- MDB activation config;
- message properties;
- serializers;
- transaction/redelivery;
- OpenMQ/resource adapter compatibility;
- client libraries.

Rolling migration risk:

```text
producer v2 sends message format consumer v1 cannot parse.
```

Namespace migration is only one part. Message schema compatibility is separate.

---

## 19. CDI Migration

Package:

```text
javax.enterprise -> jakarta.enterprise
javax.inject -> jakarta.inject
```

Check:

- beans.xml;
- producer methods;
- qualifiers;
- interceptors;
- decorators;
- extensions;
- portable extension SPI;
- alternatives;
- discovery mode;
- proxy generation;
- ambiguous/unsatisfied dependencies.

CDI extensions are high risk because they use container SPI.

---

## 20. Bean Validation Migration

Package:

```text
javax.validation -> jakarta.validation
```

Check:

- annotations;
- custom validators;
- validation.xml;
- message interpolator;
- method validation;
- integration with JAX-RS/JPA/JSF.

Old Hibernate Validator versions may not work.

---

## 21. Security Migration

Check:

- Servlet security;
- Jakarta Security API;
- custom filters;
- JAAS/JASPIC/custom realm;
- role mapping descriptors;
- SSO libraries;
- OIDC/SAML adapters;
- password hashing;
- TLS/cert behavior under new JDK.

Custom GlassFish realm/security extension is high risk because it may depend on internal APIs and classloading behavior.

---

## 22. SOAP/JAX-WS/JAXB Migration

Legacy Java EE apps often use SOAP.

Risks:

- JAX-WS tooling;
- JAXB generated classes;
- WSDL-generated code;
- SOAP handlers;
- MTOM;
- WS-Security;
- old Metro/CXF versions;
- Java 11 removed some Java EE-related modules from JDK distribution, requiring explicit dependencies.

Migration options:

- upgrade SOAP stack to Jakarta-compatible version;
- regenerate sources;
- transform packages;
- isolate SOAP integration into adapter service;
- keep legacy runtime temporarily.

Test with real WSDL/messages.

---

## 23. JDK Upgrade Risks

Moving from JDK 8 to 17/21/25 changes:

- TLS defaults;
- disabled algorithms;
- illegal reflective access;
- class file version;
- GC defaults;
- container awareness;
- removed/changed JDK internals;
- Nashorn removed after Java 14;
- stronger encapsulation;
- date/time/locale behavior edge cases;
- performance characteristics.

Run:

```text
jdeps
jdeprscan
mvn dependency:tree
test under target JDK
```

Do not only compile. Runtime behavior matters.

---

## 24. GlassFish Runtime Config Migration

Do not copy old `domain.xml` blindly.

Better:

```text
1. Export old config inventory.
2. Build fresh GlassFish 7/8 domain.
3. Recreate resources intentionally.
4. Compare behavior.
5. Avoid carrying obsolete config.
```

Old configs may include:

- removed attributes;
- old TLS protocols;
- obsolete JVM flags;
- old library paths;
- old monitoring configs;
- deprecated services;
- incompatible ORB/IIOP settings;
- old security manager assumptions.

---

## 25. Resource Migration

Inventory:

```text
JDBC pools/resources
JMS connection factories/destinations
connector pools/resources
mail sessions
custom resources
admin objects
realms
password aliases
keystores
thread pools
```

For each:

```text
old name
new name
type
target
properties
secrets
owner
test
```

Do not migrate unused resources blindly.

---

## 26. Database Driver Upgrade

Old app may use old JDBC driver.

Upgrade driver for:

- target JDK support;
- database version support;
- TLS/security support;
- Jakarta/server compatibility;
- bug fixes.

Test:

- connection pool creation;
- validation;
- failover;
- transaction;
- LOB handling;
- time/date mapping;
- statement cache;
- SSL/TLS.

---

## 27. Test Strategy

Migration requires layered tests.

```text
Compile tests:
  code builds with jakarta APIs

Unit tests:
  business logic

Integration tests:
  JPA/JAX-RS/CDI/EJB behavior

Container tests:
  deploy to target GlassFish

Smoke tests:
  startup, health, login, key flows

Regression tests:
  business behavior

Performance tests:
  latency/pool/GC baseline

Security tests:
  auth/role/TLS/session

Data tests:
  migration SQL and compatibility
```

Without container deployment test, migration risk remains high.

---

## 28. Dual Runtime Test

For behavior preservation:

```text
Legacy runtime:
  GlassFish 5 + Java EE 8

Target runtime:
  GlassFish 7/8 + Jakarta EE
```

Run same black-box tests against both.

Compare:

- status codes;
- JSON/XML output;
- DB state;
- security behavior;
- validation messages;
- transaction semantics;
- error handling;
- performance.

This catches subtle behavior changes.

---

## 29. Migration Branch Strategy

Options:

### Option A — Long-Lived Migration Branch

Pros:

- isolates migration.

Cons:

- merge drift;
- painful sync with main.

### Option B — Incremental Mainline Changes

Pros:

- avoids huge branch;
- safer if changes can be backward-compatible.

Cons:

- harder if source must switch package namespace all at once.

### Option C — Module-by-Module

Works if codebase modular.

Guideline:

```text
Keep branch lifetime as short as feasible,
but do not force risky big bang without tests.
```

---

## 30. Automated Transformation Pipeline

For repeatability:

```text
1. checkout legacy source
2. run OpenRewrite/Eclipse Transformer
3. apply curated manual patches
4. update dependencies
5. run tests
6. package
7. deploy target GlassFish
8. run smoke/regression
```

Do not rely on one-time IDE migration that cannot be reproduced.

---

## 31. Handling Incompatible Library

Options:

```text
1. Upgrade to Jakarta-compatible version.
2. Replace library.
3. Transform library if license/support allows.
4. Isolate old library behind external legacy service.
5. Keep module on old runtime temporarily.
6. Reimplement small needed feature.
```

Decision factors:

- security support;
- maintenance;
- migration cost;
- runtime criticality;
- testability;
- vendor support.

---

## 32. Strangler Pattern

For large legacy systems:

```text
Legacy GlassFish 5 app
  |
  |-- keep old modules
  |-- extract one capability at a time
  |-- route new traffic to modern module
```

Examples:

- reporting module;
- notification service;
- address lookup;
- document generation;
- batch sync;
- API facade.

Use:

- API gateway;
- app switcher;
- shared DB with caution;
- event-driven integration;
- strangler facade.

---

## 33. Parallel Run

Run old and new system simultaneously.

Modes:

### Shadow

New system receives copy of traffic but response ignored.

### Read Compare

Both systems process read-only request; compare output.

### Dual Write

Dangerous. Requires idempotency and reconciliation.

### Canary

Small real traffic goes to new system.

Use for high-risk migration.

---

## 34. Data Compatibility

Even if app compiles, data behavior can change:

- date/time timezone;
- numeric precision;
- enum/string mapping;
- LOB handling;
- lazy loading;
- validation constraints;
- JSON null handling;
- XML namespace;
- default encoding;
- sorting/collation assumptions.

Regression tests should include real-like data.

---

## 35. Performance Re-baseline

After migration, performance changes due to:

- JDK GC;
- JPA provider;
- JSON/JAXB provider;
- classloading;
- TLS;
- thread pool defaults;
- JDBC driver;
- logging;
- CDI scanning;
- application code transformation.

Run baseline before and after:

```text
p50/p95/p99
CPU
heap/GC
JDBC pool wait
DB query count
startup time
deployment time
```

Don't assume new runtime is automatically faster.

---

## 36. Security Re-baseline

Migration can change:

- TLS protocols;
- cipher suites;
- disabled algorithms;
- cookie defaults;
- session behavior;
- role mapping;
- authentication filters;
- JAAS/JASPIC behavior;
- XML parser security defaults;
- serialization behavior.

Test:

```text
login
logout
session timeout
role access
CSRF
TLS handshake
mTLS if any
LDAP/realm
admin security
```

---

## 37. Rollback Planning

Rollback from Jakarta migration is hard if:

- DB schema changed;
- messages changed;
- session format changed;
- external clients migrated;
- old artifact no longer compatible.

Plan:

```text
Can old app run against new DB schema?
Can old consumers read new messages?
Can old UI/session continue?
Can traffic switch back?
How long is rollback window?
```

Prefer expand/contract DB migrations and compatible message schema.

---

## 38. Production Rollout Plan

Example:

```text
1. Freeze release scope.
2. Backup config and DB.
3. Deploy target GlassFish environment in parallel.
4. Apply resources/config/secrets.
5. Deploy migrated app.
6. Run smoke/regression.
7. Run performance sanity test.
8. Enable limited traffic/canary.
9. Monitor errors/latency/pools.
10. Expand traffic.
11. Keep legacy environment warm during rollback window.
12. Decommission old after stable period.
```

---

## 39. Migration Risk Register

Track:

| Risk | Impact | Mitigation |
|---|---|---|
| Library not Jakarta compatible | deploy/runtime failure | upgrade/replace/transform |
| SOAP client breaks | integration outage | regenerate/test WSDL |
| Session serialization mismatch | user logout/errors | reduce session/drain |
| DB driver behavior changes | data/runtime errors | integration tests |
| TLS defaults reject old endpoint | external call failure | update cert/protocol |
| Performance regression | SLA breach | load test/baseline |
| Descriptor mapping wrong | deploy failure/403 | preflight/smoke |
| Classloader conflict | runtime errors | dependency audit |

---

## 40. Migration Checklist

```text
[Inventory]
- source javax scan
- descriptor scan
- dependency tree
- runtime resources
- DB/JMS/external integrations
- custom GlassFish extensions

[Build]
- JDK target selected
- jakarta platform API provided
- dependencies upgraded
- duplicate APIs removed
- generated sources migrated

[Code]
- imports migrated
- annotations migrated
- reflection strings reviewed
- ThreadLocal/static lifecycle reviewed
- tests updated

[Descriptors]
- web.xml/persistence.xml/ejb-jar/application.xml migrated
- GlassFish descriptors validated
- JNDI mappings checked
- role mappings checked

[Runtime]
- fresh GlassFish target domain
- resources recreated intentionally
- secrets/certs migrated
- JVM flags updated
- monitoring enabled

[Test]
- deploy test
- smoke
- regression
- performance
- security
- failover if relevant

[Release]
- rollback plan
- legacy environment backup
- canary/parallel run
- observation window
```

---

## 41. Anti-Patterns

### Anti-pattern 1 — Global Search Replace `javax` to `jakarta`

Breaks Java SE packages like `javax.sql`.

### Anti-pattern 2 — Copy Old `domain.xml`

Carries obsolete/broken config.

### Anti-pattern 3 — Ignore Third-Party Libraries

Most failures come from libraries/extensions, not your own imports.

### Anti-pattern 4 — Compile Success Means Migration Done

Deployment/runtime behavior is the real test.

### Anti-pattern 5 — Migrate Runtime, JDK, DB Driver, Frameworks, and Architecture at Once

Too many variables.

### Anti-pattern 6 — No Rollback Compatibility

One-way migration with no rehearsal is risky.

### Anti-pattern 7 — No Performance Baseline

New runtime may change latency/GC/pools.

---

## 42. Top 1% Takeaways

1. **Java EE to Jakarta EE migration is ecosystem migration, not import replacement.**
2. **`javax.sql`, `javax.naming`, and other Java SE packages often stay `javax`.**
3. **Library compatibility is the hardest part.**
4. **Do not copy old domain config blindly; recreate target runtime intentionally.**
5. **Generated code, descriptors, reflection strings, and JSP/JSF tags are migration surface.**
6. **JDK upgrade changes TLS, reflection, GC, and runtime behavior.**
7. **Use automated tools, but require human review and container deployment tests.**
8. **Dual-runtime black-box comparison is powerful for behavior preservation.**
9. **Rollback must be designed before production cutover.**
10. **For large systems, strangler/parallel-run is often safer than big bang.**

---

## 43. Mini Exercise

You have:

```text
GlassFish 5
Java 8
Java EE 8 EAR
Modules:
- web.war with JSF
- services-ejb.jar
- integration.jar with SOAP clients
- JMS MDB consumers
- JPA/EclipseLink
- custom servlet filters
- LDAP realm
Target:
- GlassFish 8
- Java 21
- Jakarta EE 11
```

Answer:

1. What inventory do you collect first?
2. Which packages migrate and which stay?
3. Which dependencies are high risk?
4. What test environments do you create?
5. Do you migrate directly to GF8 or stepwise through GF7?
6. How do you handle SOAP/JAXB generated code?
7. How do you test JMS compatibility?
8. How do you handle session/JSF compatibility?
9. What rollback constraints exist?
10. What metrics do you compare before/after?

---

## 44. Referensi

Referensi utama:

- Eclipse GlassFish Release Notes, Release 8  
  https://glassfish.org/docs/latest/release-notes.html

- Eclipse GlassFish Upgrade Guide, Release 7  
  https://glassfish.org/docs/7.1.0/upgrade-guide.pdf

- Eclipse GlassFish Downloads — GlassFish 7/8 version and JDK notes  
  https://glassfish.org/download  
  https://glassfish.org/download_gf7.html

- Jakarta EE 9 Release Plan — namespace transition goal  
  https://jakartaee.github.io/platform/jakartaee9/JakartaEE9ReleasePlan

- Eclipse Transformer  
  https://github.com/eclipse-transformer/transformer

- OpenRewrite Jakarta migration recipes  
  https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

- Eclipse GlassFish Application Deployment Guide, Release 8  
  https://glassfish.org/docs/latest/application-deployment-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

---

## 45. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
Part 28 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 29 — Security Hardening dan Production Baseline
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-027.md">⬅️ Part 27 — CI/CD, Release Engineering, dan Safe Deployment Pipeline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-029.md">Part 29 — Security Hardening dan Production Baseline ➡️</a>
</div>
