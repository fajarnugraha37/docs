# learn-java-jakarta-part-039.md

# Bagian 39 — Jakarta EE Migration & Modernization Playbook: Java EE/Jakarta Legacy ke Jakarta EE 11 dan Runtime Modern

> Target pembaca: Java engineer / tech lead yang akan memigrasikan aplikasi Java EE/Jakarta EE legacy ke Jakarta EE 11, Java 17/21, containerized runtime, dan praktik production modern.
>
> Fokus bagian ini: migration bukan sekadar `javax.*` → `jakarta.*`. Migration yang benar mencakup inventory, dependency graph, namespace migration, removed specs, runtime selection, TCK/compatible product validation, test safety net, build pipeline, descriptors/resources, persistence provider, security, SOAP/XML legacy, JSF/JSP legacy, observability uplift, performance benchmark, rollout strategy, rollback plan, and long-term modernization.

---

## Daftar Isi

1. [Orientasi: Migration Bukan Search-Replace](#1-orientasi-migration-bukan-search-replace)
2. [Target Modern: Jakarta EE 11, Java 17/21, dan Runtime yang Tepat](#2-target-modern-jakarta-ee-11-java-1721-dan-runtime-yang-tepat)
3. [Migration Mental Model: Preserve Behavior, Then Modernize](#3-migration-mental-model-preserve-behavior-then-modernize)
4. [Phase 0 — Define Scope, Risk, dan Success Criteria](#4-phase-0--define-scope-risk-dan-success-criteria)
5. [Phase 1 — Application Inventory](#5-phase-1--application-inventory)
6. [Phase 2 — Spec Usage Inventory](#6-phase-2--spec-usage-inventory)
7. [Phase 3 — Runtime dan Deployment Inventory](#7-phase-3--runtime-dan-deployment-inventory)
8. [Phase 4 — Dependency Graph dan Classpath Hygiene](#8-phase-4--dependency-graph-dan-classpath-hygiene)
9. [Phase 5 — Test Safety Net Sebelum Migrasi](#9-phase-5--test-safety-net-sebelum-migrasi)
10. [Phase 6 — Namespace Migration `javax.*` ke `jakarta.*`](#10-phase-6--namespace-migration-javaxx-ke-jakartax)
11. [Important: Tidak Semua `javax.*` Berubah ke `jakarta.*`](#11-important-tidak-semua-javaxx-berubah-ke-jakartax)
12. [Automated Refactoring: OpenRewrite, Eclipse Transformer, dan IDE](#12-automated-refactoring-openrewrite-eclipse-transformer-dan-ide)
13. [Phase 7 — Maven/Gradle Dependency Migration](#13-phase-7--mavengradle-dependency-migration)
14. [Phase 8 — Removed/Deprecated Spec Audit](#14-phase-8--removeddeprecated-spec-audit)
15. [Phase 9 — Managed Beans ke CDI](#15-phase-9--managed-beans-ke-cdi)
16. [Phase 10 — XML Binding, XML Web Services, SOAP Attachments sebagai Explicit Dependencies](#16-phase-10--xml-binding-xml-web-services-soap-attachments-sebagai-explicit-dependencies)
17. [Phase 11 — Servlet, REST, JSON, Validation, CDI Behavior Changes](#17-phase-11--servlet-rest-json-validation-cdi-behavior-changes)
18. [Phase 12 — Persistence/JPA dan Database Provider Migration](#18-phase-12--persistencejpa-dan-database-provider-migration)
19. [Phase 13 — Security Migration](#19-phase-13--security-migration)
20. [Phase 14 — Messaging, Batch, Mail, Concurrency, EJB, Connectors](#20-phase-14--messaging-batch-mail-concurrency-ejb-connectors)
21. [Phase 15 — UI Layer: Faces, JSP, Tags, EL](#21-phase-15--ui-layer-faces-jsp-tags-el)
22. [Phase 16 — Descriptors, XML Namespaces, dan Deployment Metadata](#22-phase-16--descriptors-xml-namespaces-dan-deployment-metadata)
23. [Phase 17 — Runtime Selection dan Compatible Products](#23-phase-17--runtime-selection-dan-compatible-products)
24. [Phase 18 — Build Pipeline dan Artifact Strategy](#24-phase-18--build-pipeline-dan-artifact-strategy)
25. [Phase 19 — Configuration & Secret Migration](#25-phase-19--configuration--secret-migration)
26. [Phase 20 — Observability Uplift](#26-phase-20--observability-uplift)
27. [Phase 21 — Performance Benchmark dan Capacity Model](#27-phase-21--performance-benchmark-dan-capacity-model)
28. [Phase 22 — Security Hardening dan Compliance](#28-phase-22--security-hardening-dan-compliance)
29. [Phase 23 — Deployment Strategy: Blue-Green, Canary, Rolling](#29-phase-23--deployment-strategy-blue-green-canary-rolling)
30. [Phase 24 — Rollback dan Forward Compatibility](#30-phase-24--rollback-dan-forward-compatibility)
31. [Phase 25 — Post-Migration Modernization](#31-phase-25--post-migration-modernization)
32. [Migration Decision Tree](#32-migration-decision-tree)
33. [Common Migration Failure Modes](#33-common-migration-failure-modes)
34. [Best Practices dan Anti-Patterns](#34-best-practices-dan-anti-patterns)
35. [Checklist: Java EE/Jakarta Legacy ke Jakarta EE 11](#35-checklist-java-eejakarta-legacy-ke-jakarta-ee-11)
36. [Case Study 1: Spring Boot 2 / Java EE Dependency ke Jakarta Stack](#36-case-study-1-spring-boot-2--java-ee-dependency-ke-jakarta-stack)
37. [Case Study 2: Java EE 8 WAR ke Jakarta EE 11 Web Profile](#37-case-study-2-java-ee-8-war-ke-jakarta-ee-11-web-profile)
38. [Case Study 3: Legacy SOAP/JAXB Tidak Jalan di Jakarta EE 11](#38-case-study-3-legacy-soapjaxb-tidak-jalan-di-jakarta-ee-11)
39. [Case Study 4: Migrasi Berhasil Compile tapi Gagal Production karena Config/Runtime](#39-case-study-4-migrasi-berhasil-compile-tapi-gagal-production-karena-configruntime)
40. [Latihan Bertahap](#40-latihan-bertahap)
41. [Mini Project: Jakarta EE 11 Migration Factory](#41-mini-project-jakarta-ee-11-migration-factory)
42. [Referensi Resmi](#42-referensi-resmi)

---

# 1. Orientasi: Migration Bukan Search-Replace

Banyak migrasi Jakarta gagal karena diperlakukan sebagai:

```text
replace javax. with jakarta.
```

Padahal migrasi enterprise Java modern adalah perubahan multi-layer:

```text
source code
dependencies
runtime
deployment descriptors
generated code
test containers
application server
build pipeline
security model
observability
configuration
resource definitions
third-party libraries
```

## 1.1 Namespace hanya satu bagian

Jakarta EE 9 memperkenalkan `jakarta.*` namespace untuk menggantikan `javax.*` pada spesifikasi Jakarta EE.

Tapi migrasi ke Jakarta EE 11 juga menyentuh:

- Java baseline;
- removed specs;
- optional specs removed;
- CDI as modern component model;
- Java Records support;
- virtual threads-aware runtime;
- Jakarta Data;
- SecurityManager removal;
- runtime compatibility.

## 1.2 Preserve behavior dulu

Goal pertama migrasi:

```text
same behavior on new platform
```

Baru setelah itu:

```text
modernize architecture
```

Jika kamu menggabungkan terlalu banyak perubahan sekaligus, debugging menjadi sulit.

## 1.3 Migration != modernization

Migration:

```text
move from old platform to new platform with minimal behavior change
```

Modernization:

```text
improve architecture, deployment, observability, security, and maintainability
```

## 1.4 Prinsip utama

```text
Separate migration risk from modernization risk.
```

---

# 2. Target Modern: Jakarta EE 11, Java 17/21, dan Runtime yang Tepat

Jakarta EE 11 mendukung Java 17 atau lebih tinggi, dengan enhancement unik untuk Java 21+ seperti virtual threads-aware runtime support.

## 2.1 Target umum

Untuk sistem modern:

```text
Java 21 LTS
Jakarta EE 11 compatible runtime
container image
typed configuration
structured observability
secure dependency chain
```

## 2.2 Jakarta EE 11 Platform changes

Jakarta EE 11 Platform mencatat fitur/arah seperti:

- Java Records support;
- JDK runtime-aware support for virtual threads;
- Jakarta Data 1.0;
- prune ManagedBeans;
- remove SecurityManager requirement;
- remove all optional specifications.

## 2.3 Runtime matters

Jakarta EE adalah spec.

Aplikasi berjalan di implementation/runtime.

Pilih runtime berdasarkan:

- profile support;
- compatible product/TCK;
- Java 17/21 support;
- feature set;
- operational tooling;
- Kubernetes support;
- vendor/community support;
- migration compatibility.

## 2.4 Do not upgrade blindly

Sebelum migration, tentukan:

```text
target Java version
target Jakarta EE version
target runtime
target profile
target deployment topology
```

Tanpa target jelas, migration akan melebar.

---

# 3. Migration Mental Model: Preserve Behavior, Then Modernize

Gunakan dua track:

## 3.1 Compatibility track

Tujuan:

- compile;
- tests pass;
- runtime boot;
- endpoints behave same;
- resource config works;
- security works;
- data access works;
- performance acceptable.

## 3.2 Modernization track

Tujuan:

- remove deprecated APIs;
- improve CDI usage;
- typed config;
- observability;
- cloud-native packaging;
- remove vendor lock-in;
- simplify architecture;
- adopt Jakarta Data where useful;
- improve security posture.

## 3.3 Jangan campur terlalu banyak

Bad:

```text
javax→jakarta + runtime change + DB migration + architecture rewrite + auth provider migration
```

Good:

```text
Step 1: test baseline
Step 2: namespace/dependency migration
Step 3: runtime migration
Step 4: observability/config uplift
Step 5: architecture modernization
```

## 3.4 Migration unit

Pilih unit migrasi:

- per module;
- per repository;
- per service;
- per app;
- per runtime environment.

Untuk monolith besar, gunakan branch strategy dan integration pipeline yang ketat.

## 3.5 Evidence-driven

Setiap statement “sudah migrate” harus dibuktikan dengan:

- compile;
- dependency tree;
- integration tests;
- runtime smoke test;
- compatibility tests;
- logs/metrics;
- performance data;
- security scan.

---

# 4. Phase 0 — Define Scope, Risk, dan Success Criteria

Sebelum menyentuh kode, definisikan scope.

## 4.1 Scope questions

- aplikasi mana?
- module mana?
- target runtime apa?
- target Java apa?
- target profile apa?
- specs apa yang dipakai?
- environment apa yang ikut migrasi?
- production rollout kapan?
- backward compatibility perlu?
- data migration perlu?
- downtime boleh?

## 4.2 Success criteria

Contoh:

```text
All unit/integration tests pass.
All critical endpoints pass contract tests.
App boots on target Jakarta EE 11 runtime.
No javax Jakarta EE API remains in application source.
No old Java EE API dependency remains.
P95 latency regression < 10%.
Memory footprint within budget.
Security scan no critical finding.
Canary runs 24h without elevated error rate.
```

## 4.3 Risk categories

- compile risk;
- runtime classloading risk;
- spec behavior risk;
- dependency risk;
- database risk;
- security risk;
- performance risk;
- deployment risk;
- operational risk.

## 4.4 Owner

Assign owners:

- application code;
- build/dependency;
- runtime/server;
- database;
- security;
- deployment;
- QA;
- operations.

## 4.5 Rollback criteria

Define before rollout:

```text
If error rate > X for Y minutes, rollback.
If memory > threshold, rollback.
If key flow fails, rollback.
```

---

# 5. Phase 1 — Application Inventory

Inventory first.

## 5.1 Code inventory

Capture:

- repositories;
- modules;
- package structure;
- build tool;
- Java version;
- test coverage;
- generated code;
- annotation processors;
- code generators.

## 5.2 Runtime inventory

- server/runtime version;
- Java version;
- OS/base image;
- server features;
- domains/profiles;
- cluster topology;
- JNDI resources;
- security realm;
- logging config.

## 5.3 API inventory

Search imports:

```text
javax.
jakarta.
org.hibernate.
org.eclipse.persistence.
com.sun.
weblogic.
org.jboss.
fish.payara.
com.ibm.
```

## 5.4 Descriptor inventory

Find:

```text
web.xml
ejb-jar.xml
persistence.xml
beans.xml
faces-config.xml
application.xml
ra.xml
glassfish-web.xml
weblogic.xml
jboss-deployment-structure.xml
server.xml
domain.xml
```

## 5.5 External dependency inventory

- database;
- broker;
- SMTP;
- LDAP;
- IdP/OIDC;
- SOAP partners;
- REST partners;
- SFTP;
- object storage;
- scheduler;
- cache.

## 5.6 Operational inventory

- dashboards;
- alerts;
- log queries;
- runbooks;
- deployment scripts;
- rollback scripts;
- batch jobs;
- cron jobs.

## 5.7 Output

Create:

```text
MIGRATION-INVENTORY.md
SPEC-USAGE.csv
DEPENDENCY-TREE.txt
RUNTIME-CONFIG.md
EXTERNAL-INTEGRATIONS.md
RISK-REGISTER.md
```

---

# 6. Phase 2 — Spec Usage Inventory

Map every Jakarta/Java EE spec used.

## 6.1 Search by imports

Examples:

```text
javax.servlet
javax.ws.rs
javax.persistence
javax.validation
javax.transaction
javax.enterprise
javax.inject
javax.annotation
javax.ejb
javax.jms
javax.mail
javax.batch
javax.resource
javax.websocket
javax.faces
javax.el
javax.xml.bind
javax.xml.ws
javax.xml.soap
```

## 6.2 Map to Jakarta equivalents

```text
javax.servlet → jakarta.servlet
javax.ws.rs → jakarta.ws.rs
javax.persistence → jakarta.persistence
javax.validation → jakarta.validation
javax.transaction → jakarta.transaction
javax.enterprise → jakarta.enterprise
javax.inject → jakarta.inject
javax.annotation → jakarta.annotation
javax.ejb → jakarta.ejb
javax.jms → jakarta.jms
javax.mail → jakarta.mail
javax.batch → jakarta.batch
javax.resource → jakarta.resource
javax.websocket → jakarta.websocket
javax.faces → jakarta.faces
javax.el → jakarta.el
```

## 6.3 Special cases

Some are removed from Jakarta EE 11 Platform but available standalone:

```text
jakarta.xml.bind
jakarta.xml.ws
jakarta.xml.soap
```

Some legacy specs are removed/deprecated:

```text
Managed Beans
```

Some Java SE packages remain `javax.*`:

```text
javax.sql
javax.naming
javax.net
javax.xml.parsers
javax.xml.stream
javax.xml.transform
javax.xml.validation
```

## 6.4 Output matrix

| Spec | Used? | Old package | New package | EE11 Platform? | Action |
|---|---:|---|---|---|---|
| Servlet | yes | `javax.servlet` | `jakarta.servlet` | yes | migrate |
| JPA | yes | `javax.persistence` | `jakarta.persistence` | yes | migrate/provider |
| JAXB | yes | `javax.xml.bind` | `jakarta.xml.bind` | no Platform | explicit dep |
| JAX-WS | yes | `javax.xml.ws` | `jakarta.xml.ws` | no Platform | explicit runtime |
| ManagedBean | yes | `javax.annotation.ManagedBean` | deprecated/removed | no | CDI migration |

## 6.5 Why this matters

Spec inventory determines:

- runtime profile;
- dependency changes;
- removed spec strategy;
- tests required;
- migration complexity.

---

# 7. Phase 3 — Runtime dan Deployment Inventory

## 7.1 Current runtime

Capture:

- server name;
- version;
- profile/features;
- Java version;
- OS;
- memory/CPU;
- cluster mode;
- session replication;
- datasource config;
- JMS config;
- security realm;
- certificates;
- logging.

## 7.2 Current deployment

- WAR/EAR/JAR;
- manual deploy;
- CI/CD;
- server admin CLI;
- container image;
- Kubernetes;
- VM;
- blue-green/canary or not.

## 7.3 Current runtime-specific dependencies

Search for vendor APIs and descriptors.

## 7.4 Target runtime

Pick candidates.

Evaluate:

- Jakarta EE 11 compatibility;
- profile;
- spec coverage;
- Java 21 support;
- operational features;
- migration compatibility;
- image size;
- startup;
- docs/community/support.

## 7.5 Compatibility products

Use official compatible products list to check certification status.

## 7.6 Output

```text
RUNTIME-CANDIDATE-MATRIX.md
TARGET-RUNTIME-ADR.md
```

---

# 8. Phase 4 — Dependency Graph dan Classpath Hygiene

Dependency issues are a major migration risk.

## 8.1 Generate tree

Maven:

```bash
mvn dependency:tree
```

Gradle:

```bash
./gradlew dependencies
```

## 8.2 Find old Java EE dependencies

Look for:

```text
javax:javaee-api
javax.ws.rs
javax.servlet
javax.persistence
javax.validation
javax.annotation
javax.ejb
javax.jms
javax.mail
javax.xml.bind
javax.xml.ws
javax.xml.soap
```

## 8.3 Find mixed libraries

Danger:

```text
jakarta.servlet-api + javax.ws.rs-api
jakarta.persistence-api + javax.validation
old Hibernate + jakarta.persistence
old Jersey + jakarta.ws.rs
```

## 8.4 Provider compatibility

JPA provider must support Jakarta Persistence version.

Examples:

- Hibernate ORM 6+ for Jakarta Persistence 3.x;
- EclipseLink versions aligned with Jakarta.

## 8.5 Transitive dependency traps

A third-party library may still compile against `javax`.

If your application is Jakarta namespace, that library may fail unless it has Jakarta version.

## 8.6 Enforcer rules

Use build checks:

- ban `javax.*` Jakarta EE APIs;
- enforce dependency convergence;
- ban duplicate API jars;
- require explicit versions.

## 8.7 Output

```text
DEPENDENCY-CLEANUP-PLAN.md
BANNED-DEPENDENCIES.md
```

---

# 9. Phase 5 — Test Safety Net Sebelum Migrasi

Never migrate without test safety net.

## 9.1 Minimum tests

- unit tests;
- integration tests;
- REST contract tests;
- persistence tests;
- security tests;
- UI smoke tests if Faces/JSP;
- messaging tests;
- batch tests;
- SOAP/XML tests if used.

## 9.2 Characterization tests

If legacy code lacks tests, add characterization tests.

Goal:

```text
capture current behavior
```

not necessarily prove ideal behavior.

## 9.3 Golden samples

For XML/SOAP/JSON:

- sample requests;
- sample responses;
- golden files.

## 9.4 Database tests

Use testcontainers or dedicated test DB.

## 9.5 Runtime boot test

Application must boot on target runtime in CI.

## 9.6 Smoke test

At minimum:

- health endpoint;
- one REST endpoint;
- one DB transaction;
- one security flow;
- one external client mock;
- one batch/messaging flow if relevant.

## 9.7 Baseline performance

Capture before migration:

- startup time;
- memory;
- P50/P95/P99 latency;
- throughput;
- DB pool usage;
- GC;
- CPU.

Without baseline, you cannot judge regression.

---

# 10. Phase 6 — Namespace Migration `javax.*` ke `jakarta.*`

## 10.1 What changes

Jakarta EE specifications moved package namespace from `javax.*` to `jakarta.*` beginning Jakarta EE 9.

Examples:

```java
javax.servlet.http.HttpServletRequest
```

becomes:

```java
jakarta.servlet.http.HttpServletRequest
```

## 10.2 What else changes

- imports;
- annotation names;
- generated code;
- XML descriptors;
- persistence provider versions;
- CDI extensions;
- service provider configs;
- reflection strings;
- class names in configs;
- serialized class names if any;
- JSP taglibs/faces config namespaces in some cases;
- test code;
- mock classes.

## 10.3 Search beyond Java files

Search in:

```text
.java
.kt
.groovy
.xml
.yml
.yaml
.properties
.jsp
.xhtml
.tag
.tld
.md docs
Dockerfile
scripts
generated sources
```

## 10.4 Reflection strings

Example:

```java
Class.forName("javax.servlet.Filter")
```

will not be fixed by import migration.

## 10.5 ServiceLoader

Files under:

```text
META-INF/services/
```

may mention old classes.

## 10.6 Generated code

Regenerate:

- JAXB classes;
- JAX-WS stubs;
- QueryDSL/JPA metamodel if impacted;
- OpenAPI clients if use Jakarta annotations;
- annotation processor output.

## 10.7 Test

Compile is not enough.

Runtime classloading catches hidden strings/configs.

---

# 11. Important: Tidak Semua `javax.*` Berubah ke `jakarta.*`

This is critical.

Some `javax.*` packages are Java SE and remain `javax`.

Do not migrate blindly.

## 11.1 Keep these

Examples:

```java
javax.sql.DataSource
javax.naming.Context
javax.naming.InitialContext
javax.net.ssl.SSLContext
javax.xml.parsers.DocumentBuilderFactory
javax.xml.stream.XMLInputFactory
javax.xml.transform.Transformer
javax.xml.validation.SchemaFactory
javax.crypto.Cipher
javax.security.auth.Subject
javax.management.MBeanServer
```

## 11.2 Migrate Jakarta EE specs

Examples:

```java
javax.servlet → jakarta.servlet
javax.persistence → jakarta.persistence
javax.ws.rs → jakarta.ws.rs
javax.enterprise → jakarta.enterprise
javax.inject → jakarta.inject
javax.validation → jakarta.validation
javax.transaction → jakarta.transaction
javax.annotation → jakarta.annotation
```

## 11.3 Danger of global regex

Bad:

```text
replace all "javax." with "jakarta."
```

This breaks Java SE APIs.

## 11.4 Use curated tools

Use tools/recipes that understand package mappings.

## 11.5 Manual review still required

Automated migration reduces effort, but humans must review.

---

# 12. Automated Refactoring: OpenRewrite, Eclipse Transformer, dan IDE

## 12.1 OpenRewrite

OpenRewrite provides automated refactoring recipes.

It has Jakarta migration recipes, including migration to Jakarta EE 9/10 and package renames.

Good for:

- source code migration;
- Maven/Gradle dependency updates;
- repeatable recipe-based changes;
- large repositories.

## 12.2 Eclipse Transformer

Eclipse Transformer can transform class/resource/text artifacts from Javax to Jakarta namespaces.

Good for:

- source/text transformation;
- binary/resource transformation in some migration workflows;
- third-party artifacts when source unavailable, with caution.

## 12.3 IDE migration

IDE can update imports but usually not enough.

It may miss:

- dependencies;
- descriptors;
- generated code;
- reflection strings;
- service files;
- transitive libraries.

## 12.4 Recommended approach

```text
1. Run inventory.
2. Run automated recipe/tool.
3. Compile.
4. Run static search.
5. Run tests.
6. Review generated diff.
7. Fix runtime issues.
```

## 12.5 Tooling principle

Automation should be idempotent and reproducible.

Keep migration scripts in repo.

## 12.6 Do not transform blindly

Review changes especially around:

- Java SE `javax` packages;
- XML parser/security packages;
- JNDI;
- SQL;
- crypto;
- management;
- custom generated code.

---

# 13. Phase 7 — Maven/Gradle Dependency Migration

## 13.1 Replace platform API

Old:

```xml
<dependency>
  <groupId>javax</groupId>
  <artifactId>javaee-api</artifactId>
  <version>8.0</version>
  <scope>provided</scope>
</dependency>
```

New example:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

or full platform:

```xml
<artifactId>jakarta.jakartaee-api</artifactId>
```

## 13.2 Choose API set

- Core Profile API;
- Web Profile API;
- Platform API;
- individual APIs.

## 13.3 Avoid over-wide API dependency

If app is Web Profile, don't compile against full Platform unless needed.

## 13.4 Provider dependencies

Add implementation dependencies only if not provided by runtime.

Examples:

- JSON-B provider;
- JPA provider;
- JAXB runtime standalone;
- Mail implementation;
- MicroProfile Config implementation.

## 13.5 Remove old Javax artifacts

Examples:

```text
javax.servlet-api
javax.ws.rs-api
javax.persistence-api
javax.validation-api
javax.annotation-api
javax.ejb-api
javax.jms-api
javax.mail-api
jaxb-api
```

## 13.6 Dependency convergence

Use Maven Enforcer/Gradle constraints.

## 13.7 Build profiles

Avoid hiding migration issues behind environment-specific build profiles.

---

# 14. Phase 8 — Removed/Deprecated Spec Audit

Jakarta EE 11 removed optional specs and pruned ManagedBeans.

## 14.1 Managed Beans

Replace with CDI.

## 14.2 SecurityManager

Do not rely on Java SecurityManager behavior.

SecurityManager has been deprecated/removed direction in Java platform, and Jakarta EE 11 removes requirement.

## 14.3 XML Binding

Removed from Jakarta EE 11 Platform.

Use explicit dependency if needed.

## 14.4 XML Web Services

Removed from Jakarta EE 11 Platform.

Use explicit JAX-WS runtime if needed.

## 14.5 SOAP with Attachments

Removed from Jakarta EE 11 Platform.

Use explicit SAAJ implementation if needed.

## 14.6 Other optional specs

Audit all optional/legacy dependencies.

## 14.7 Output

```text
REMOVED-SPECS-ACTION-PLAN.md
```

For each removed spec:

```text
use? yes/no
replacement?
explicit dependency?
runtime support?
tests?
long-term modernization?
```

---

# 15. Phase 9 — Managed Beans ke CDI

## 15.1 Find

Search:

```text
javax.annotation.ManagedBean
jakarta.annotation.ManagedBean
javax.faces.bean.ManagedBean
jakarta.faces.bean.ManagedBean
javax.faces.bean.ManagedProperty
```

## 15.2 Replace general ManagedBean

Before:

```java
@ManagedBean("report")
public class ReportBean { ... }
```

After:

```java
@Named("report")
@RequestScoped
public class ReportBean { ... }
```

## 15.3 Replace Faces managed bean

Before:

```java
@javax.faces.bean.ManagedBean
@javax.faces.bean.SessionScoped
```

After:

```java
@Named
@jakarta.enterprise.context.SessionScoped
```

or Faces CDI-compatible view scope:

```java
@jakarta.faces.view.ViewScoped
```

## 15.4 Replace ManagedProperty

Before:

```java
@ManagedProperty("#{service}")
private Service service;
```

After:

```java
@Inject
private Service service;
```

## 15.5 Scope audit

Add explicit scope.

Do not accidentally leave everything `@Dependent`.

## 15.6 EL name preservation

Preserve `#{beanName}` used by pages.

## 15.7 Test

UI tests and CDI boot tests.

---

# 16. Phase 10 — XML Binding, XML Web Services, SOAP Attachments sebagai Explicit Dependencies

Because Jakarta EE 11 removes these from Platform, explicit dependency is needed if still used.

## 16.1 JAXB / XML Binding

If using:

```java
jakarta.xml.bind
```

add:

```text
jakarta.xml.bind-api
JAXB runtime implementation
```

## 16.2 JAX-WS / XML Web Services

If consuming/exposing SOAP:

```text
jakarta.xml.ws-api
JAX-WS runtime
jakarta.xml.bind runtime
jakarta.xml.soap implementation
jakarta.activation
```

## 16.3 SAAJ / SOAP with Attachments

If manipulating SOAP messages:

```text
jakarta.xml.soap-api
SAAJ implementation
```

## 16.4 Regenerate code

Regenerate:

- JAXB classes;
- SOAP stubs;
- WSDL bindings.

## 16.5 Long-term strategy

Ask whether SOAP/XML should remain or be wrapped/replaced.

But do not rewrite during migration unless necessary.

## 16.6 Tests

Use golden XML/SOAP samples.

---

# 17. Phase 11 — Servlet, REST, JSON, Validation, CDI Behavior Changes

## 17.1 Servlet

Migrate:

```text
javax.servlet → jakarta.servlet
```

Check:

- filters;
- listeners;
- servlet initializers;
- multipart;
- async;
- session config;
- security constraints.

## 17.2 REST

Migrate:

```text
javax.ws.rs → jakarta.ws.rs
```

Check:

- Application subclass;
- filters/interceptors;
- providers;
- exception mappers;
- client API;
- JSON provider integration.

## 17.3 JSON-B/JSON-P

Check provider version.

Record/Java time support may differ.

## 17.4 Validation

Migrate:

```text
javax.validation → jakarta.validation
```

Check:

- custom constraints;
- `ConstraintValidator`;
- method validation;
- message interpolation;
- integration with REST/Faces/JPA.

## 17.5 CDI

Check:

- bean discovery;
- proxies;
- scopes;
- alternatives;
- interceptors;
- ambiguous dependencies;
- unsatisfied dependencies.

## 17.6 Test all boundaries

Many changes compile but fail in runtime integration.

---

# 18. Phase 12 — Persistence/JPA dan Database Provider Migration

## 18.1 Namespace

```text
javax.persistence → jakarta.persistence
```

## 18.2 Provider

Use Jakarta-compatible provider.

Example: Hibernate 6+ for Jakarta Persistence 3.x.

## 18.3 persistence.xml

Update schema/namespaces if needed.

## 18.4 Entity scanning

Check packaging and classpath.

## 18.5 Generated metamodel

Regenerate.

## 18.6 Query behavior

Provider upgrade can change:

- SQL generation;
- lazy loading;
- criteria behavior;
- dialect handling;
- sequence strategies;
- timezone mapping;
- enum mapping.

## 18.7 Migration tests

Run:

- schema validation;
- repository tests;
- N+1 tests;
- transaction tests;
- locking tests.

## 18.8 Performance

Benchmark critical queries.

Provider upgrade can affect execution plans.

---

# 19. Phase 13 — Security Migration

## 19.1 Old security model

May use:

- container realms;
- JAAS;
- BASIC/FORM auth;
- custom filters;
- Keycloak adapter;
- legacy SSO agent;
- web.xml constraints.

## 19.2 Jakarta Security

Modern Jakarta Security can help with standardized authentication mechanisms and identity stores.

But OIDC integration may be runtime/vendor/framework-specific.

## 19.3 Keycloak/IdP

Old Keycloak adapters may be deprecated/removed.

Modern approach often uses OIDC standard flow via runtime/library.

## 19.4 Test security flows

- login;
- logout;
- token refresh;
- role mapping;
- method security;
- URL constraints;
- session fixation;
- CSRF;
- CORS.

## 19.5 Cookies

Check:

- SameSite;
- Secure;
- HttpOnly;
- domain/path.

## 19.6 Authorization

Do not only test authentication.

Data-level authorization matters.

## 19.7 Audit

Security migration must preserve audit events.

---

# 20. Phase 14 — Messaging, Batch, Mail, Concurrency, EJB, Connectors

## 20.1 Messaging

```text
javax.jms → jakarta.jms
```

Check:

- broker client;
- resource adapter;
- destination config;
- MDB;
- redelivery;
- DLQ;
- transactions.

## 20.2 Batch

```text
javax.batch → jakarta.batch
```

Check job repository and restartability.

## 20.3 Mail

```text
javax.mail → jakarta.mail
```

Check Activation dependency and SMTP config.

## 20.4 Concurrency

```text
javax.enterprise.concurrent → jakarta.enterprise.concurrent
```

Check managed executors/threading.

## 20.5 EJB

```text
javax.ejb → jakarta.ejb
```

Check remote clients, timers, MDB, transactions, security.

## 20.6 Connectors

```text
javax.resource → jakarta.resource
```

Check resource adapter version compatibility.

## 20.7 Resource adapters

Old RARs may not be Jakarta-compatible.

Vendor update may be needed.

---

# 21. Phase 15 — UI Layer: Faces, JSP, Tags, EL

## 21.1 Faces

```text
javax.faces → jakarta.faces
```

Check:

- CDI backing beans;
- old Faces managed beans removed;
- view scope;
- component libraries;
- PrimeFaces/OmniFaces versions;
- converters/validators;
- faces-config.

## 21.2 JSP/Jakarta Pages

Check:

- taglib URI changes;
- JSTL/Jakarta Tags dependencies;
- scriptlets;
- generated servlet errors.

## 21.3 EL

Check custom EL resolvers/functions.

## 21.4 Component libraries

Many UI libraries have separate Javax vs Jakarta versions.

## 21.5 Static resources

Check resource paths and cache.

## 21.6 UI smoke tests

Render key pages.

Submit forms.

Validate session/view scope.

---

# 22. Phase 16 — Descriptors, XML Namespaces, dan Deployment Metadata

Migration affects XML descriptors.

## 22.1 Common descriptors

- `web.xml`;
- `persistence.xml`;
- `beans.xml`;
- `faces-config.xml`;
- `ejb-jar.xml`;
- `application.xml`;
- `ra.xml`;
- `validation.xml`;
- vendor descriptors.

## 22.2 XML schema versions

Update namespaces/schema locations where needed.

## 22.3 Class names inside XML

Search `javax.` strings.

## 22.4 TLD/taglib

Update JSTL/Jakarta Tags URI if needed:

```text
jakarta.tags.core
jakarta.tags.fmt
jakarta.tags.functions
```

## 22.5 Vendor descriptors

Vendor descriptors may need new versions or replacements.

## 22.6 Test descriptor parsing

Runtime boot catches many descriptor issues.

---

# 23. Phase 17 — Runtime Selection dan Compatible Products

## 23.1 Official compatibility

Use Jakarta EE compatible products list to verify product certification for Platform/Web/Core.

## 23.2 Candidate evaluation

For each runtime:

- target Jakarta EE version;
- profile;
- Java 21 support;
- specs used;
- MicroProfile support;
- container image availability;
- operational config;
- vendor support;
- migration docs.

## 23.3 POC

Run real app or representative slice.

## 23.4 TCK vs your app

TCK means spec compliance.

Your app can still fail due to:

- vendor config;
- classloading;
- dependency conflicts;
- performance;
- unsupported extension;
- old descriptors.

## 23.5 Choose intentionally

Document ADR.

---

# 24. Phase 18 — Build Pipeline dan Artifact Strategy

## 24.1 Build once

Use same artifact/image across environments.

## 24.2 Artifact type

Choose:

- WAR;
- EAR;
- executable JAR;
- runtime image + app;
- container image.

## 24.3 CI gates

- compile;
- unit tests;
- integration tests;
- dependency scan;
- container scan;
- SBOM;
- license check;
- runtime boot;
- smoke tests.

## 24.4 Generated code

Regenerate in build.

Do not commit inconsistent generated code unless policy says so.

## 24.5 SBOM

Produce SBOM for supply chain visibility.

## 24.6 Reproducibility

Pin versions.

Avoid downloading arbitrary latest at build time.

---

# 25. Phase 19 — Configuration & Secret Migration

## 25.1 Find config sources

- properties files;
- XML descriptors;
- server config;
- env vars;
- system properties;
- DB table;
- hardcoded constants;
- secret files;
- CI variables.

## 25.2 Remove hardcoded secrets

No secrets in code/image.

## 25.3 Typed config

Create typed config classes.

## 25.4 Validate startup

Fail fast for invalid critical config.

## 25.5 Secret manager

Use Kubernetes Secret or external secret manager.

## 25.6 ConfigMap behavior

If using env vars, update requires restart.

## 25.7 Document

Create config reference:

```text
key
type
default
required
secret?
source
restart required?
owner
```

---

# 26. Phase 20 — Observability Uplift

Migration is opportunity to improve observability.

## 26.1 Logs

Structured logs with correlation ID.

## 26.2 Metrics

RED/USE metrics:

- rate;
- errors;
- duration;
- saturation.

## 26.3 Traces

Instrument:

- REST;
- DB;
- messaging;
- external HTTP/SOAP;
- batch jobs.

## 26.4 Health

Readiness and liveness.

## 26.5 Dashboards

Build before production rollout.

## 26.6 Alerts

Alert on user-impacting signals.

## 26.7 Runbooks

Every critical alert needs runbook.

## 26.8 Compare before/after

Use observability to prove migration health.

---

# 27. Phase 21 — Performance Benchmark dan Capacity Model

## 27.1 Baseline before migration

Capture:

- startup time;
- memory;
- CPU;
- throughput;
- latency;
- GC;
- DB pool usage;
- thread usage.

## 27.2 After migration

Compare.

## 27.3 Java 21 changes

Virtual threads may change concurrency model, but not all bottlenecks.

## 27.4 Runtime differences

Different app server/JPA/JSON provider may change performance.

## 27.5 Benchmark scenarios

- normal load;
- peak load;
- cold start;
- rolling restart;
- DB slow;
- external API slow;
- messaging backlog;
- batch workload.

## 27.6 Capacity plan

Update resource requests/limits.

## 27.7 Regression threshold

Define acceptable regression.

---

# 28. Phase 22 — Security Hardening dan Compliance

## 28.1 Dependency vulnerabilities

Scan dependencies.

## 28.2 Container vulnerabilities

Scan images.

## 28.3 TLS/certificates

Update algorithms, truststores, keystores.

## 28.4 Secrets

Move to secret manager.

## 28.5 Authentication

Validate OIDC/SAML/session behavior.

## 28.6 Authorization

Test roles and data-level permissions.

## 28.7 Headers

For web:

- CSP;
- HSTS;
- SameSite;
- X-Frame-Options/frame-ancestors;
- X-Content-Type-Options.

## 28.8 XML security

If JAXB/SOAP/XML parser used:

- disable XXE;
- limit size/depth;
- restrict external schemas;
- test malicious XML.

## 28.9 Audit

Ensure audit continuity.

---

# 29. Phase 23 — Deployment Strategy: Blue-Green, Canary, Rolling

## 29.1 Rolling deployment

Gradually replace pods/instances.

Requires backward compatibility.

## 29.2 Blue-green

Two environments.

Switch traffic.

Good rollback.

## 29.3 Canary

Small percentage traffic to new version.

Monitor.

## 29.4 Shadow traffic

Replay/duplicate read-only traffic to new version.

Useful for migration confidence.

## 29.5 Database compatibility

Deployment strategy must align with DB migration.

## 29.6 Session compatibility

Rolling deploy with session state can fail if serialized session classes changed.

## 29.7 Message compatibility

Consumers/producers must handle old/new message versions.

## 29.8 Choose based on risk

High-risk migration: canary/blue-green preferred.

---

# 30. Phase 24 — Rollback dan Forward Compatibility

## 30.1 Rollback plan

Define:

- artifact rollback;
- config rollback;
- database rollback/forward fix;
- message compatibility;
- cache invalidation;
- session handling.

## 30.2 Rollback is not always possible

DB migrations may be forward-only.

Plan forward recovery.

## 30.3 Feature flags

Use flags to disable risky paths.

## 30.4 Backward compatible schema

Use expand/contract pattern:

```text
add nullable column
deploy app writing both
backfill
switch reads
remove old later
```

## 30.5 Message versioning

Consumers tolerate unknown fields.

## 30.6 API compatibility

Do not break clients during rolling deploy.

## 30.7 Test rollback

A rollback plan not tested is wishful thinking.

---

# 31. Phase 25 — Post-Migration Modernization

After stable migration, modernize.

## 31.1 Remove dead code

Old adapters, compatibility shims.

## 31.2 Replace legacy Managed Beans

If not already done.

## 31.3 Modernize config

Typed config, secret manager.

## 31.4 Modernize observability

OpenTelemetry, metrics, dashboards.

## 31.5 Modernize transactions

Replace unnecessary XA with outbox/saga where appropriate.

## 31.6 Modernize SOAP

Wrap, isolate, or replace if partner allows.

## 31.7 Modernize UI

Migrate scriptlet JSP to tags/Faces/REST frontend.

## 31.8 Adopt Jakarta Data selectively

For repository patterns where it fits.

## 31.9 Reduce vendor lock-in

Isolate vendor APIs.

---

# 32. Migration Decision Tree

## 32.1 Is app Java EE 8 using `javax.*`?

Yes:

```text
inventory → tests → namespace migration → dependency migration → runtime migration
```

## 32.2 Does app use SOAP/JAXB?

Yes:

```text
explicit Jakarta XML dependencies/runtime
or keep legacy stack isolated
or replace integration
```

## 32.3 Does app use Managed Beans/Faces managed beans?

Yes:

```text
migrate to CDI
```

## 32.4 Does app use EJB/JMS/JCA?

Yes:

```text
need Full Platform/runtime support or redesign
```

## 32.5 Is app REST/JPA/CDI only?

Likely Web Profile sufficient.

## 32.6 Is app tiny REST/JSON?

Core/lightweight runtime may be enough.

## 32.7 Is runtime vendor-specific heavily?

Decide:

```text
keep vendor and migrate version
or abstract and switch runtime
```

## 32.8 Is downtime allowed?

If no:

```text
backward compatible DB/messages/sessions
rolling/canary/blue-green
```

---

# 33. Common Migration Failure Modes

## 33.1 Blind replace all javax

Breaks Java SE packages.

## 33.2 Mixed javax/jakarta dependencies

Classloading and type mismatch.

## 33.3 API jar but no implementation

JAXB/SAAJ/JAX-WS/MicroProfile providers missing.

## 33.4 Runtime profile too small

App uses Messaging/Batch but runtime only Web Profile.

## 33.5 Generated code not migrated

JAXB/JAX-WS stubs still `javax`.

## 33.6 Descriptors still old

XML references old classes/namespaces.

## 33.7 Tests compile but runtime fails

Because classloading, CDI discovery, provider lookup.

## 33.8 Security flow broken

Role mapping/session/cookies/OIDC changes.

## 33.9 Performance regression

Provider/runtime changed SQL/JSON/threading.

## 33.10 No rollback

Migration fails in prod with no safe rollback.

---

# 34. Best Practices dan Anti-Patterns

## 34.1 Best practices

- Inventory before changing code.
- Add tests before migration.
- Use automated refactoring tools but review diff.
- Do not globally replace every `javax`.
- Clean dependency tree.
- Migrate generated code.
- Handle removed specs explicitly.
- Choose runtime based on spec usage.
- Test on target runtime in CI.
- Add observability before rollout.
- Benchmark before/after.
- Use canary/blue-green for high-risk migration.
- Keep ADRs and runbooks.
- Separate migration from modernization where possible.

## 34.2 Anti-pattern: compile success means migration success

Runtime behavior matters.

## 34.3 Anti-pattern: no inventory

You will miss hidden specs/resources.

## 34.4 Anti-pattern: change runtime and architecture simultaneously

Hard to debug.

## 34.5 Anti-pattern: vendor lock-in hidden in business code

Migration pain.

## 34.6 Anti-pattern: no golden files for XML/SOAP

Interop breaks silently.

## 34.7 Anti-pattern: no performance baseline

Cannot prove regression.

---

# 35. Checklist: Java EE/Jakarta Legacy ke Jakarta EE 11

## 35.1 Inventory

- [ ] repos/modules identified;
- [ ] specs used;
- [ ] runtime current;
- [ ] external integrations;
- [ ] descriptors;
- [ ] generated code;
- [ ] vendor APIs;
- [ ] deployment scripts;
- [ ] dashboards/alerts.

## 35.2 Tests

- [ ] unit tests;
- [ ] integration tests;
- [ ] REST contract tests;
- [ ] XML/SOAP golden tests;
- [ ] UI smoke tests;
- [ ] security tests;
- [ ] runtime boot tests;
- [ ] baseline performance.

## 35.3 Namespace

- [ ] Jakarta EE `javax` migrated;
- [ ] Java SE `javax` preserved;
- [ ] descriptors updated;
- [ ] generated code regenerated;
- [ ] reflection strings fixed;
- [ ] service files fixed.

## 35.4 Dependencies

- [ ] old Java EE APIs removed;
- [ ] Jakarta APIs added;
- [ ] providers compatible;
- [ ] no mixed namespace;
- [ ] enforcer rules;
- [ ] SBOM.

## 35.5 Runtime

- [ ] target runtime selected;
- [ ] compatible product checked;
- [ ] profile sufficient;
- [ ] Java version supported;
- [ ] server config migrated;
- [ ] resource config tested.

## 35.6 Removed specs

- [ ] Managed Beans replaced;
- [ ] XML Binding explicit if used;
- [ ] XML Web Services explicit if used;
- [ ] SOAP Attachments explicit if used;
- [ ] SecurityManager assumptions removed.

## 35.7 Production

- [ ] config validated;
- [ ] secrets managed;
- [ ] logs/metrics/traces;
- [ ] readiness/liveness;
- [ ] deployment strategy;
- [ ] rollback plan;
- [ ] runbooks.

---

# 36. Case Study 1: Spring Boot 2 / Java EE Dependency ke Jakarta Stack

## 36.1 Context

App uses Spring Boot 2 and Java EE `javax` APIs.

Migration to Spring Boot 3 requires Jakarta namespace.

## 36.2 Problem

Third-party libs still use `javax.servlet`.

## 36.3 Approach

- inventory dependencies;
- upgrade Spring Boot to 3-compatible libraries;
- migrate source imports;
- replace Javax validation/persistence/servlet;
- run OpenRewrite recipes;
- test REST/security/JPA behavior.

## 36.4 Lesson

Jakarta namespace migration affects whole ecosystem, not only Jakarta EE app servers.

---

# 37. Case Study 2: Java EE 8 WAR ke Jakarta EE 11 Web Profile

## 37.1 Context

WAR uses:

- Servlet;
- JAX-RS;
- CDI;
- JPA;
- Validation;
- JSP/JSTL.

## 37.2 Target

Jakarta EE 11 Web Profile runtime.

## 37.3 Steps

1. Add baseline tests.
2. Migrate imports.
3. Replace dependencies.
4. Update JSP taglibs to Jakarta Tags if needed.
5. Upgrade JPA provider.
6. Update descriptors.
7. Containerize runtime + WAR.
8. Add readiness/metrics/logs.
9. Canary.

## 37.4 Pitfall

JSTL taglib not found because API present but implementation missing in runtime/container.

## 37.5 Lesson

Web migration includes view tags and runtime dependencies, not only Java imports.

---

# 38. Case Study 3: Legacy SOAP/JAXB Tidak Jalan di Jakarta EE 11

## 38.1 Context

App consumes SOAP service with generated `javax.xml.ws` stubs.

After Jakarta EE 11 migration, compile/runtime fails.

## 38.2 Root causes

- XML Web Services removed from Platform;
- XML Binding removed from Platform;
- SOAP Attachments removed from Platform;
- generated stubs still `javax`.

## 38.3 Fix

- add explicit Jakarta JAX-WS/JAXB/SAAJ runtime;
- regenerate stubs with Jakarta-compatible tool;
- update handlers;
- golden SOAP tests;
- verify WS-Security/MTOM.

## 38.4 Long-term

Consider isolating SOAP in adapter module or sidecar service.

## 38.5 Lesson

Removed specs need explicit strategy.

---

# 39. Case Study 4: Migrasi Berhasil Compile tapi Gagal Production karena Config/Runtime

## 39.1 Problem

App compiles and tests pass locally.

Production fails because datasource JNDI name differs in new runtime.

## 39.2 Root cause

Code migration done, runtime config migration incomplete.

## 39.3 Fix

- inventory server resources;
- map old JNDI to new runtime config;
- add startup validation;
- add readiness check for DB;
- test packaged app on target runtime.

## 39.4 Lesson

Jakarta migration is code + runtime + config.

---

# 40. Latihan Bertahap

## Latihan 1 — Import scan

Write script to count `javax` imports.

## Latihan 2 — Spec matrix

Map imports to specs and EE 11 availability.

## Latihan 3 — Dependency cleanup

Run dependency tree and ban old APIs.

## Latihan 4 — OpenRewrite migration

Run Jakarta migration recipe on sample app.

## Latihan 5 — Descriptor migration

Update `web.xml`, `persistence.xml`, `faces-config.xml`.

## Latihan 6 — Managed Beans migration

Replace old Managed Beans with CDI.

## Latihan 7 — JAXB explicit dependency

Migrate a JAXB sample.

## Latihan 8 — Runtime boot test

Deploy migrated app to target runtime in CI.

## Latihan 9 — Observability uplift

Add structured logs/metrics/health.

## Latihan 10 — Rollout plan

Write canary + rollback plan.

---

# 41. Mini Project: Jakarta EE 11 Migration Factory

## 41.1 Goal

Create:

```text
jakarta-ee11-migration-factory/
```

## 41.2 Structure

```text
README.md
inventory/
  spec-usage.csv
  dependency-tree.txt
  descriptors.md
migration/
  namespace-plan.md
  dependency-plan.md
  removed-specs-plan.md
runtime/
  runtime-selection-adr.md
  server-config-map.md
testing/
  test-safety-net.md
  golden-samples/
observability/
  dashboards.md
  alerts.md
deployment/
  canary-plan.md
  rollback-plan.md
```

## 41.3 Required deliverables

- inventory report;
- spec usage matrix;
- dependency cleanup plan;
- automated migration script;
- runtime decision ADR;
- removed specs plan;
- test safety net;
- observability plan;
- rollout plan;
- rollback plan.

## 41.4 Evaluation questions

1. Why is migration not search-replace?
2. Which `javax` packages must remain?
3. What specs were removed from Jakarta EE 11 Platform?
4. How do you handle JAXB/SOAP?
5. How do you migrate Managed Beans?
6. Why test on target runtime?
7. Why is compatible product/TCK not enough?
8. How do you avoid mixed namespace dependencies?
9. What signals prove migration is safe?
10. What is rollback strategy?

---

# 42. Referensi Resmi

Referensi utama:

1. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

2. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

3. Jakarta EE Compatible Products  
   https://jakarta.ee/compatibility/

4. Javax to Jakarta Namespace Ecosystem Progress  
   https://jakarta.ee/blogs/javax-jakartaee-namespace-ecosystem-progress/

5. Jakarta EE 9 Release Plan  
   https://jakartaee.github.io/platform/jakartaee9/JakartaEE9ReleasePlan

6. OpenRewrite Jakarta migration recipes  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

7. OpenRewrite Migration to Jakarta EE 10  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/jakartaee10

8. OpenRewrite project  
   https://docs.openrewrite.org/

9. Apache TomEE — From javax to jakarta namespace  
   https://tomee.apache.org/javax-to-jakarta.html

10. Jakarta EE Specifications  
    https://jakarta.ee/specifications/

---

# Penutup

Migration yang benar adalah engineering program, bukan regex.

Mental model ringkas:

```text
Inventory
  ↓
Test safety net
  ↓
Namespace migration
  ↓
Dependency cleanup
  ↓
Removed spec strategy
  ↓
Runtime selection
  ↓
Config/resource migration
  ↓
Observability/security uplift
  ↓
Performance benchmark
  ↓
Controlled rollout
  ↓
Post-migration modernization
```

Prinsip paling penting:

```text
Preserve behavior first. Modernize second.
```

Jakarta EE 11 membawa baseline modern: Java 17+, support Java 21/virtual-thread-aware runtime, Jakarta Data, removal of optional specs, and CDI direction.

Namun keberhasilan migration tetap ditentukan oleh:

```text
dependency hygiene
runtime compatibility
tests
configuration correctness
observability
rollback plan
```

Engineer top-tier tahu bahwa compile success bukan akhir. Ia membuktikan migration dengan runtime boot, integration tests, golden XML/SOAP samples, dependency tree, dashboards, canary metrics, and rollback readiness.

Bagian berikutnya akan menjadi bagian synthesis terakhir/lanjutan: **Jakarta EE Production Readiness & Top 1% Engineering Playbook** — bagaimana mengoperasikan aplikasi Jakarta EE modern dengan reliability, security, observability, performance, cost, governance, and long-term maintainability.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 38 — Jakarta EE Configuration, Runtime Selection, dan Production Architecture Strategy](./learn-java-jakarta-part-038.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 40 — Jakarta EE Production Readiness & Top 1% Engineering Playbook: Reliability, Security, Observability, Performance, Cost, Governance, dan Long-Term Maintainability](./learn-java-jakarta-part-040.md)
