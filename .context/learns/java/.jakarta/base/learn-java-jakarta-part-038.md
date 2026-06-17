# learn-java-jakarta-part-038.md

# Bagian 38 — Jakarta EE Configuration, Runtime Selection, dan Production Architecture Strategy

> Target pembaca: Java engineer / tech lead yang ingin mengikat seluruh pengetahuan Jakarta EE sebelumnya menjadi keputusan arsitektur nyata: memilih profile, runtime, packaging, configuration model, deployment style, observability, security, migration strategy, dan production readiness.
>
> Fokus bagian ini: Jakarta EE 11 Platform/Web/Core Profile, status Jakarta Config yang masih under development, MicroProfile Config sebagai praktik portable yang umum, vendor/server config, environment variables, Kubernetes ConfigMap/Secret, WAR/EAR/JAR/container image, runtime selection, platform compatibility, TCK, build/deploy topology, cloud-native operations, and how to design Jakarta EE applications that are maintainable, portable, observable, secure, and migration-friendly.

---

## Daftar Isi

1. [Orientasi: Dari API Knowledge ke Architecture Decision](#1-orientasi-dari-api-knowledge-ke-architecture-decision)
2. [Status Jakarta EE 11: Platform, Web Profile, Core Profile](#2-status-jakarta-ee-11-platform-web-profile-core-profile)
3. [Jakarta Config: Status Under Development, Bukan Jakarta EE 11 Final](#3-jakarta-config-status-under-development-bukan-jakarta-ee-11-final)
4. [Mental Model Configuration: Build-Time, Deploy-Time, Runtime](#4-mental-model-configuration-build-time-deploy-time-runtime)
5. [Configuration Sources: Defaults, Files, Env Vars, System Properties, Secrets](#5-configuration-sources-defaults-files-env-vars-system-properties-secrets)
6. [MicroProfile Config sebagai Praktik Portable Saat Ini](#6-microprofile-config-sebagai-praktik-portable-saat-ini)
7. [Vendor Runtime Config: Powerful tapi Tidak Portable](#7-vendor-runtime-config-powerful-tapi-tidak-portable)
8. [Kubernetes ConfigMap dan Secret](#8-kubernetes-configmap-dan-secret)
9. [JNDI, Resource Definition, dan Container Resources](#9-jndi-resource-definition-dan-container-resources)
10. [Configuration Taxonomy: App Config, Infra Config, Secret, Feature Flag](#10-configuration-taxonomy-app-config-infra-config-secret-feature-flag)
11. [Twelve-Factor Config: Berguna, tapi Tidak Cukup](#11-twelve-factor-config-berguna-tapi-tidak-cukup)
12. [Profile Selection: Core vs Web vs Platform](#12-profile-selection-core-vs-web-vs-platform)
13. [Runtime Selection Matrix](#13-runtime-selection-matrix)
14. [Compatible Products, TCK, dan Portability Reality](#14-compatible-products-tck-dan-portability-reality)
15. [Full App Server vs Lightweight Runtime vs Framework Runtime](#15-full-app-server-vs-lightweight-runtime-vs-framework-runtime)
16. [Packaging Strategy: WAR, EAR, Thin JAR, Uber JAR, Container Image](#16-packaging-strategy-war-ear-thin-jar-uber-jar-container-image)
17. [Provided Scope dan Dependency Boundary](#17-provided-scope-dan-dependency-boundary)
18. [Runtime Image Strategy: One Server Many Apps vs One App One Image](#18-runtime-image-strategy-one-server-many-apps-vs-one-app-one-image)
19. [Database Resource Strategy](#19-database-resource-strategy)
20. [Messaging, Batch, Connectors, Mail, dan External Resource Strategy](#20-messaging-batch-connectors-mail-dan-external-resource-strategy)
21. [Security Architecture Strategy](#21-security-architecture-strategy)
22. [Transaction Architecture Strategy](#22-transaction-architecture-strategy)
23. [Data Access Strategy: JPA, JDBC, Jakarta Data, NoSQL](#23-data-access-strategy-jpa-jdbc-jakarta-data-nosql)
24. [REST/API Boundary Strategy](#24-restapi-boundary-strategy)
25. [UI Strategy: Faces, JSP, REST + Frontend](#25-ui-strategy-faces-jsp-rest--frontend)
26. [Async Strategy: Concurrency, Messaging, Batch, Events](#26-async-strategy-concurrency-messaging-batch-events)
27. [Observability Strategy: Logs, Metrics, Traces, Health](#27-observability-strategy-logs-metrics-traces-health)
28. [Cloud-Native Runtime Strategy](#28-cloud-native-runtime-strategy)
29. [Virtual Threads Strategy di Jakarta EE 11](#29-virtual-threads-strategy-di-jakarta-ee-11)
30. [Configuration Anti-Corruption Layer](#30-configuration-anti-corruption-layer)
31. [Environment Parity dan Deployment Promotion](#31-environment-parity-dan-deployment-promotion)
32. [Migration Strategy: Java EE/Jakarta EE 8 ke Jakarta EE 11](#32-migration-strategy-java-eejakarta-ee-8-ke-jakarta-ee-11)
33. [Decision Records dan Architecture Governance](#33-decision-records-dan-architecture-governance)
34. [Production Readiness Checklist](#34-production-readiness-checklist)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices dan Anti-Patterns](#36-best-practices-dan-anti-patterns)
37. [Case Study 1: Legacy WAR di App Server ke Containerized Jakarta EE 11](#37-case-study-1-legacy-war-di-app-server-ke-containerized-jakarta-ee-11)
38. [Case Study 2: Konfigurasi Berantakan Menjadi Typed Config Boundary](#38-case-study-2-konfigurasi-berantakan-menjadi-typed-config-boundary)
39. [Case Study 3: Salah Pilih Profile dan Runtime Menjadi Over-Engineering](#39-case-study-3-salah-pilih-profile-dan-runtime-menjadi-over-engineering)
40. [Case Study 4: ConfigMap Update Tidak Mengubah Environment Variable](#40-case-study-4-configmap-update-tidak-mengubah-environment-variable)
41. [Latihan Bertahap](#41-latihan-bertahap)
42. [Mini Project: Jakarta EE Production Architecture Lab](#42-mini-project-jakarta-ee-production-architecture-lab)
43. [Referensi Resmi](#43-referensi-resmi)

---

# 1. Orientasi: Dari API Knowledge ke Architecture Decision

Sampai titik ini, kita sudah membahas banyak spesifikasi Jakarta EE:

- CDI;
- REST;
- JSON-P/JSON-B;
- Persistence;
- Data;
- Transactions;
- Validation;
- Servlet;
- Security;
- Messaging;
- Mail;
- Batch;
- Concurrency;
- Enterprise Beans;
- Connectors;
- WebSocket;
- Faces;
- EL;
- Pages/JSP;
- Tags;
- XML/SOAP legacy specs;
- Activation;
- Deployment;
- Management;
- Managed Beans legacy.

Namun engineer top-tier tidak berhenti pada “tahu API”.

Ia harus bisa menjawab:

```text
Runtime apa yang harus dipilih?
Profile apa yang cukup?
Bagaimana konfigurasi dikelola?
Mana dependency yang provided dan mana yang packaged?
Bagaimana deploy ke Kubernetes?
Bagaimana migration path dari Java EE 8?
Bagaimana observability disiapkan?
Bagaimana secrets dipisahkan?
Bagaimana rollback dilakukan?
Apa yang portable dan apa yang vendor-specific?
```

## 1.1 Jakarta EE adalah platform contract

Jakarta EE bukan hanya library.

Jakarta EE adalah contract antara:

```text
application
  ↔ API specification
  ↔ runtime implementation
  ↔ deployment environment
```

## 1.2 Architecture decision lebih penting dari API call

Contoh:

```java
@Inject UserService service;
```

API-nya mudah.

Tapi keputusan arsitekturnya:

- scope apa?
- transaction boundary di mana?
- config source dari mana?
- runtime support CDI Lite atau Full?
- test strategy apa?
- observability bagaimana?
- deployment topology apa?

## 1.3 Goal bagian ini

Membangun mental model untuk membuat Jakarta EE application yang:

- maintainable;
- portable;
- production-ready;
- observable;
- secure;
- cloud-native enough;
- migration-friendly;
- tidak over-engineered.

## 1.4 Prinsip utama

```text
Jakarta EE architecture is the art of deciding what belongs to application code,
what belongs to the container, and what belongs to the deployment platform.
```

---

# 2. Status Jakarta EE 11: Platform, Web Profile, Core Profile

Jakarta EE 11 memiliki tiga level penting:

```text
Core Profile
Web Profile
Platform
```

## 2.1 Core Profile

Core Profile ditargetkan untuk modern cloud applications, terutama runtimes kecil dan microservices.

Fokusnya minimal APIs.

Mental model:

```text
small runtime
fast startup
lower memory footprint
microservice-friendly
AOT-friendly direction
```

## 2.2 Web Profile

Web Profile ditargetkan untuk web applications.

Mencakup lebih banyak spec dibanding Core, misalnya Servlet/Faces/REST/Persistence/Transactions/CDI/Data dan lain-lain sesuai profile.

## 2.3 Platform

Full Platform mencakup kumpulan spesifikasi paling luas.

Cocok ketika aplikasi membutuhkan:

- Messaging;
- Batch;
- Mail;
- Connectors;
- Enterprise Beans;
- advanced enterprise integration;
- legacy compatibility;
- resource adapters;
- full server capabilities.

## 2.4 Jakarta EE 11 notable changes

Jakarta EE 11 membawa:

- Java Records support;
- runtime-aware support untuk virtual threads;
- Jakarta Data 1.0;
- pruning ManagedBeans;
- removal of SecurityManager requirement;
- removal of optional specifications dari Platform.

## 2.5 Minimum Java

Jakarta EE 11 membutuhkan Java SE 17 atau lebih tinggi untuk Web Profile; platform release juga bergerak di baseline modern.

Untuk production modern, Java 21 sering menjadi target menarik karena virtual threads dan LTS.

## 2.6 Decision framing

Jangan langsung memilih Full Platform.

Pilih profile berdasarkan kebutuhan nyata.

```text
Need only REST + CDI + JSON?
  Core/Profile-compatible runtime may be enough.

Need Servlet/JPA/Validation/Security?
  Web Profile may be enough.

Need JMS/Batch/Mail/JCA/EJB?
  Full Platform or selected feature runtime.
```

---

# 3. Jakarta Config: Status Under Development, Bukan Jakarta EE 11 Final

Konfigurasi adalah area penting.

Namun pada Jakarta EE 11, **Jakarta Config 1.0 belum menjadi spesifikasi final platform**.

Halaman Jakarta Config menyatakan Jakarta Config 1.0 masih:

```text
under development
```

Jakarta EE Platform 12 under-development page menyebut kemungkinan new specification untuk Core Profile 12:

```text
Jakarta Config based off of MicroProfile Config
```

## 3.1 Implikasi untuk Jakarta EE 11

Untuk Jakarta EE 11 hari ini, konfigurasi portable umumnya memakai:

- MicroProfile Config jika runtime mendukung;
- vendor-specific config;
- environment variables;
- system properties;
- JNDI resources;
- Kubernetes ConfigMap/Secret;
- external secret manager;
- application properties loaded sendiri;
- CDI producers/config adapters.

## 3.2 Jangan salah asumsi

Jangan menulis:

```text
Jakarta EE 11 has final Jakarta Config standard.
```

Karena status resminya masih under development.

## 3.3 Practical recommendation

Untuk aplikasi Jakarta EE 11:

```text
Use MicroProfile Config when available.
Abstract configuration behind typed application config classes.
Avoid scattering direct config lookup everywhere.
```

## 3.4 Future-proofing

Jika Jakarta Config final mengadopsi model MicroProfile Config, aplikasi yang sudah memakai typed config boundary akan lebih mudah migrasi.

## 3.5 Top-tier stance

```text
Do not wait for perfect standard.
Use a stable config abstraction today, but isolate it.
```

---

# 4. Mental Model Configuration: Build-Time, Deploy-Time, Runtime

Konfigurasi tidak satu jenis.

Ada beberapa waktu keputusan:

```text
build-time
deploy-time
runtime startup
runtime dynamic
```

## 4.1 Build-time config

Contoh:

- dependency versions;
- compiler flags;
- generated code;
- native image build flags;
- feature inclusion;
- static resources.

Tidak boleh berubah tanpa rebuild.

## 4.2 Deploy-time config

Contoh:

- database URL;
- environment name;
- external endpoint;
- resource limits;
- Kubernetes manifest;
- server feature enablement.

Berubah saat deploy.

## 4.3 Runtime startup config

Dibaca saat aplikasi start.

Contoh:

- connection pool size;
- feature toggles;
- retry limits;
- cache TTL;
- security issuer URL.

Perubahan biasanya butuh restart.

## 4.4 Runtime dynamic config

Bisa berubah saat aplikasi hidup.

Contoh:

- feature flag dynamic;
- traffic shaping;
- rate limit dynamic;
- kill switch;
- emergency allow/block list.

Butuh desain khusus.

## 4.5 Mistake umum

Menganggap semua config bisa berubah live.

Tidak semua runtime/config source mendukung live reload.

## 4.6 Design rule

Untuk setiap config, jawab:

```text
When is it read?
Can it change?
Who owns it?
Is it secret?
Does change require restart?
How is it validated?
What is default?
```

---

# 5. Configuration Sources: Defaults, Files, Env Vars, System Properties, Secrets

Config bisa datang dari banyak sumber.

## 5.1 Default in code

```java
int timeoutMs = 3000;
```

Good for safe default.

Bad if environment-specific.

## 5.2 Properties file packaged

```text
META-INF/microprofile-config.properties
application.properties
```

Good for non-secret defaults.

Bad for production secrets.

## 5.3 External file

Mounted config file.

Good for Kubernetes ConfigMap volume.

## 5.4 Environment variables

Common for containerized apps.

Example:

```text
DATABASE_URL
PAYMENT_TIMEOUT_MS
```

## 5.5 Java system properties

```bash
-Dpayment.timeout.ms=3000
```

Useful for JVM/application startup overrides.

## 5.6 Kubernetes ConfigMap

Non-sensitive configuration.

## 5.7 Kubernetes Secret

Sensitive values, but remember Kubernetes Secret is only base64 by default unless encryption-at-rest/access control configured.

## 5.8 External secret manager

Examples:

- AWS Secrets Manager;
- AWS SSM Parameter Store;
- HashiCorp Vault;
- Azure Key Vault;
- GCP Secret Manager;
- CyberArk;
- internal secret service.

## 5.9 Database config

Can be useful for dynamic business config, but avoid bootstrapping chicken-and-egg.

## 5.10 Priority/ordinal

If multiple sources exist, precedence matters.

MicroProfile Config has ordinal/priority model.

## 5.11 Validation

Every config should be validated at startup.

Fail fast for invalid critical config.

---

# 6. MicroProfile Config sebagai Praktik Portable Saat Ini

MicroProfile Config defines a flexible system for application configuration and an SPI to extend configuration sources.

It is widely supported by MicroProfile/Jakarta-oriented runtimes.

## 6.1 Default source model

MicroProfile Config supports config from common sources such as:

- system properties;
- environment variables;
- `META-INF/microprofile-config.properties`;
- custom `ConfigSource`.

## 6.2 Basic injection

```java
@Inject
@ConfigProperty(name = "payment.timeout.ms", defaultValue = "3000")
int paymentTimeoutMs;
```

## 6.3 Programmatic lookup

```java
Config config = ConfigProvider.getConfig();
int timeout = config.getValue("payment.timeout.ms", Integer.class);
```

## 6.4 Prefer typed config object

Instead of scattering:

```java
@ConfigProperty(name = "x")
```

everywhere, centralize:

```java
@ApplicationScoped
public class PaymentConfig {
    @Inject
    @ConfigProperty(name = "payment.timeout.ms", defaultValue = "3000")
    int timeoutMs;

    public Duration timeout() {
        return Duration.ofMillis(timeoutMs);
    }
}
```

## 6.5 Custom ConfigSource

Useful for:

- secret manager;
- database config;
- remote config service;
- encrypted file;
- tenant-specific config.

## 6.6 Caution

MicroProfile Config may not be present in every Jakarta EE runtime by default.

Check runtime features.

## 6.7 Future Jakarta Config

Jakarta Config is expected to be based on MicroProfile Config direction, but until final, treat MicroProfile Config as separate spec.

---

# 7. Vendor Runtime Config: Powerful tapi Tidak Portable

Every runtime has its own config model.

Examples:

- GlassFish/Payara `domain.xml`, asadmin, deployment descriptors;
- WildFly management model/CLI/XML;
- Open Liberty `server.xml` features;
- WebLogic domain/config/WLST;
- WebSphere/Liberty config;
- Tomcat `server.xml`, context resources;
- Quarkus application properties/build-time config;
- Helidon config.

## 7.1 Vendor config controls

- datasource;
- thread pools;
- JMS resources;
- security realms;
- SSL/TLS;
- classloading;
- resource adapters;
- logging;
- feature enablement;
- clustering;
- HTTP listeners.

## 7.2 Why it matters

Jakarta specs define API behavior, but runtime config decides production behavior.

## 7.3 Portability trade-off

Using only spec APIs increases portability.

Using vendor features improves operational fit.

## 7.4 Rule

Use vendor config intentionally, not accidentally.

Document:

```text
which config is portable
which config is vendor-specific
why vendor-specific was chosen
migration cost
```

## 7.5 Keep vendor config outside business code

Application code should not depend on vendor classes unless absolutely necessary.

## 7.6 Infrastructure as code

Runtime config should be versioned:

- Helm chart;
- Kustomize;
- Terraform;
- Ansible;
- server XML in repo;
- GitOps repository.

---

# 8. Kubernetes ConfigMap dan Secret

Kubernetes provides ConfigMap and Secret resources.

## 8.1 ConfigMap

For non-sensitive config.

Can be exposed as:

- environment variable;
- mounted file/volume;
- command args.

## 8.2 Secret

For sensitive config.

Can be exposed as:

- environment variable;
- mounted volume;
- imagePullSecret;
- service account/token use cases.

## 8.3 Environment variable caveat

If ConfigMap/Secret is consumed as environment variable, changing the ConfigMap/Secret does not automatically update the already-running process environment.

Usually pod restart/rollout is required.

## 8.4 Volume mount caveat

Mounted ConfigMap/Secret files can update eventually, but application must watch/reload file if dynamic reload desired.

## 8.5 Secret security caveat

Kubernetes Secret is not automatically a complete secret-management solution.

Need:

- RBAC;
- encryption at rest;
- least privilege;
- audit;
- external secret operator if needed;
- avoid printing env vars/logs.

## 8.6 Recommendation

Use ConfigMap for non-secret deploy config.

Use Secret/external secret manager for secrets.

Use typed application config boundary to read them.

## 8.7 Example

```yaml
env:
  - name: PAYMENT_TIMEOUT_MS
    valueFrom:
      configMapKeyRef:
        name: payment-config
        key: timeout-ms
  - name: DATABASE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-secret
        key: password
```

## 8.8 Production rule

Every config change should be auditable and roll-backable.

---

# 9. JNDI, Resource Definition, dan Container Resources

Jakarta EE historically uses container-managed resources.

Examples:

- DataSource;
- JMS ConnectionFactory;
- Mail Session;
- ManagedExecutorService;
- resource adapters;
- security realm.

## 9.1 Resource injection

```java
@Resource(lookup = "java:comp/env/jdbc/Main")
DataSource dataSource;
```

## 9.2 Container ownership

The container owns:

- pooling;
- transactions;
- security;
- lifecycle;
- monitoring.

## 9.3 Application ownership

Application owns:

- business logic;
- query/transaction boundary;
- validation;
- error handling.

## 9.4 Resource configuration

Datasource URL/password/pool size typically belongs to runtime/deployment config.

## 9.5 CDI producer pattern

Centralize resource access:

```java
@ApplicationScoped
public class Resources {
    @Resource(lookup = "java:comp/env/jdbc/Main")
    DataSource ds;

    @Produces
    @Main
    DataSource mainDataSource() {
        return ds;
    }
}
```

## 9.6 Avoid hardcoded JNDI scattered

Use qualifiers/producers.

## 9.7 Portable vs vendor descriptors

Resource definitions can be standard or vendor-specific.

Check runtime.

---

# 10. Configuration Taxonomy: App Config, Infra Config, Secret, Feature Flag

Not all config should be handled same way.

## 10.1 App config

Examples:

- pagination default;
- retry count;
- timeout;
- business threshold;
- endpoint path.

## 10.2 Infra config

Examples:

- DB pool size;
- thread pool;
- resource adapter config;
- HTTP listener;
- TLS cert.

## 10.3 Secret

Examples:

- DB password;
- API key;
- signing key;
- OAuth client secret.

## 10.4 Feature flag

Examples:

- enable new checkout flow;
- route percentage;
- emergency kill switch.

## 10.5 Static vs dynamic

App config may be static at startup.

Feature flags may be dynamic.

Secrets may rotate.

Infra config may require restart.

## 10.6 Governance table

| Type | Source | Reload? | Owner |
|---|---|---|---|
| app default | code/properties | build/startup | dev team |
| app env override | env/ConfigMap | restart usually | platform/devops |
| secret | secret manager/K8s Secret | rotation policy | security/platform |
| runtime resource | server config | restart/redeploy | platform |
| feature flag | flag service/db | dynamic | product/platform |
| business parameter | admin UI/db | dynamic/audited | business ops |

## 10.7 Validation

Each type needs different validation and audit.

---

# 11. Twelve-Factor Config: Berguna, tapi Tidak Cukup

Twelve-Factor says config should be stored in environment.

Useful principle:

```text
Do not bake environment-specific config into artifact.
```

## 11.1 Good

- same image across environments;
- env-specific values injected at deploy;
- no secrets in code;
- easy promotion.

## 11.2 Not enough

Real enterprise config includes:

- secret rotation;
- typed validation;
- dynamic flags;
- config provenance;
- audit;
- schema/contract;
- resource config;
- tenant-specific config;
- regulatory constraints.

## 11.3 Avoid env var explosion

Hundreds of env vars become hard to manage.

Use structured config files or config service when appropriate.

## 11.4 Avoid secret env for high-security workloads

Env vars can leak via process dumps, debug endpoints, logs, or platform introspection depending setup.

Mounted secrets or secret manager may be better.

## 11.5 Jakarta EE context

Some config belongs to container resources, not app env vars.

Example datasource pool settings.

## 11.6 Rule

Use env vars for simple deployment config.

Use richer mechanisms for complex/dynamic/secret-heavy config.

---

# 12. Profile Selection: Core vs Web vs Platform

## 12.1 Choose Core Profile when

- microservice only needs CDI/REST/JSON;
- minimal runtime desired;
- small memory/startup;
- cloud-native API service;
- no Servlet/Faces/JPA full stack need beyond profile.

## 12.2 Choose Web Profile when

- web app;
- Servlet/JAX-RS;
- CDI;
- Validation;
- JPA/Persistence;
- transactions;
- Faces or Pages as needed;
- Jakarta Data;
- common enterprise web features.

## 12.3 Choose Platform when

Need full enterprise features:

- Messaging;
- Batch;
- Mail;
- Enterprise Beans;
- Connectors;
- full resource integration;
- legacy app compatibility.

## 12.4 Anti-pattern

Using Full Platform because “enterprise”.

Choose based on actual specs used.

## 12.5 Practical note

Some runtimes let you enable individual features instead of profile bundle.

This can be better for container image size and attack surface.

## 12.6 Decision question

```text
What specs does the app actually use in production?
```

Build runtime around that.

---

# 13. Runtime Selection Matrix

When choosing runtime, evaluate more than spec checklist.

## 13.1 Criteria

- Jakarta EE version/profile support;
- compatible product/TCK status;
- Java version support;
- CDI Full/Lite behavior;
- JPA provider;
- REST implementation;
- security integration;
- MicroProfile support;
- observability support;
- startup time;
- memory footprint;
- container image quality;
- clustering/HA;
- admin tooling;
- Kubernetes friendliness;
- vendor support/license;
- community maturity;
- operational team familiarity;
- migration compatibility;
- extension ecosystem.

## 13.2 Runtime categories

- full application server;
- modular application server;
- lightweight microservice runtime;
- embedded server/runtime;
- framework-oriented runtime using Jakarta APIs.

## 13.3 Example decision table

| App type | Runtime tendency |
|---|---|
| legacy EAR/EJB/JMS/JCA | Full Platform-capable server |
| modern REST + JPA | Web Profile/runtime feature set |
| tiny REST microservice | Core/Profile lightweight runtime |
| cloud-native + MicroProfile | MicroProfile-capable runtime |
| high legacy compatibility | app server close to current stack |
| fast startup/native image | runtime with AOT/native support |
| strict vendor support | commercial supported runtime |

## 13.4 Avoid resume-driven runtime choice

Choose based on constraints, not hype.

## 13.5 Proof of concept

Always test with:

- representative endpoints;
- security;
- DB;
- transactions;
- observability;
- deployment;
- load;
- failure scenarios.

---

# 14. Compatible Products, TCK, dan Portability Reality

Jakarta EE compatible products pass TCK for specific platform/profile/spec.

## 14.1 What compatibility means

Compatibility increases confidence that standard APIs behave as specified.

## 14.2 What it does not mean

It does not guarantee:

- identical performance;
- identical admin tooling;
- identical classloading quirks;
- identical default config;
- identical clustering;
- identical observability;
- identical vendor extensions.

## 14.3 TCK is necessary but not sufficient

Passing TCK validates spec compliance.

Production suitability requires your own tests.

## 14.4 Compatible products page

Use official Jakarta compatible products list for certification status.

## 14.5 Portability strategy

To maximize portability:

- avoid vendor APIs in business code;
- isolate vendor config;
- use standard descriptors where possible;
- run integration tests on target runtime;
- keep migration runbook.

## 14.6 Reality

Most serious systems use at least some vendor-specific configuration.

Document it.

---

# 15. Full App Server vs Lightweight Runtime vs Framework Runtime

## 15.1 Full app server

Pros:

- full spec support;
- mature admin;
- resource management;
- legacy compatibility;
- enterprise features.

Cons:

- larger footprint;
- more operational complexity;
- slower startup;
- more attack surface.

## 15.2 Lightweight runtime

Pros:

- smaller image;
- faster startup;
- cloud-friendly;
- feature selection;
- easier one-app-one-container.

Cons:

- may not support all specs;
- fewer legacy features;
- runtime-specific config.

## 15.3 Framework runtime

Examples may implement or consume Jakarta APIs with framework-specific model.

Pros:

- developer productivity;
- AOT/native;
- ecosystem integrations.

Cons:

- portability can be lower;
- build-time config constraints;
- framework-specific behavior.

## 15.4 Decision

```text
Use the smallest runtime that correctly supports your production requirements.
```

Not the smallest possible runtime.

## 15.5 Legacy exception

If migrating large legacy EAR/EJB/JMS/JCA app, full server may be the safest stepping stone.

---

# 16. Packaging Strategy: WAR, EAR, Thin JAR, Uber JAR, Container Image

## 16.1 WAR

Classic web application artifact.

Deployed to Servlet/Jakarta EE runtime.

Good for:

- web apps;
- standard deployment;
- container-provided APIs.

## 16.2 EAR

Enterprise archive.

Can contain multiple modules.

Good for:

- legacy enterprise apps;
- EJB modules;
- resource adapter integration;
- multi-module deployments.

Less common for microservices.

## 16.3 Thin JAR

Application classes/deps minimal, runtime provided externally.

## 16.4 Uber JAR

App + runtime/deps packaged together.

Good for:

- standalone execution;
- containers;
- immutable deploy.

## 16.5 Container image

Modern deployment unit.

Can contain:

- app server + WAR;
- app + embedded runtime;
- feature-enabled runtime image.

## 16.6 Decision table

| Context | Packaging |
|---|---|
| traditional shared app server | WAR/EAR |
| one app per container with server | server image + WAR |
| lightweight runtime | executable JAR/image |
| legacy multi-module | EAR |
| Kubernetes cloud-native | immutable image |
| vendor-managed platform | runtime-specific packaging |

## 16.7 Rule

Artifact should be immutable.

Environment-specific config should be injected externally.

---

# 17. Provided Scope dan Dependency Boundary

Jakarta EE APIs are usually provided by runtime.

## 17.1 Maven example

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 17.2 Why provided?

Runtime supplies implementation.

Packaging API jars into app can cause conflicts.

## 17.3 When not provided?

Standalone/embedded runtime may require dependencies packaged.

## 17.4 API vs implementation

Do not include only API when implementation required.

Examples:

- JSON-B implementation;
- JAXB runtime if standalone;
- MicroProfile Config implementation;
- vendor-specific runtime.

## 17.5 Classloading issues

Common:

- duplicate API jars;
- old `javax` jar;
- app bundles runtime implementation conflicting with server;
- library brings incompatible transitive dependency.

## 17.6 Rule

Know who owns each class:

```text
JDK
server runtime
application dependency
vendor library
```

## 17.7 Dependency hygiene

Use dependency tree and enforcer rules.

---

# 18. Runtime Image Strategy: One Server Many Apps vs One App One Image

## 18.1 One server many apps

Traditional:

```text
shared app server
  ├── app A
  ├── app B
  └── app C
```

Pros:

- shared resources;
- centralized admin;
- legacy-friendly.

Cons:

- noisy neighbor;
- harder isolation;
- coordinated upgrades;
- deployment coupling.

## 18.2 One app one image

Modern:

```text
container image = runtime + app
```

Pros:

- isolation;
- immutable;
- easier rollback;
- scaling per app;
- cloud-native.

Cons:

- duplicated runtime;
- more images;
- operational shift.

## 18.3 Hybrid

Some organizations run multiple WARs in one container/server for legacy cost reasons.

## 18.4 Recommendation

For new services:

```text
one app per image
```

For legacy monolith:

```text
migrate incrementally
```

## 18.5 Security

One app per image reduces blast radius.

## 18.6 Ops

Use standardized base images and patching process.

---

# 19. Database Resource Strategy

## 19.1 Container-managed DataSource

Jakarta EE classic approach.

Pros:

- pooling;
- transaction integration;
- JNDI;
- monitoring;
- config outside app.

## 19.2 App-managed datasource

Common in frameworks.

Pros:

- app owns config;
- easier in executable jar;
- portable outside server.

Cons:

- duplicate pooling config;
- transaction integration less container-managed.

## 19.3 JPA persistence unit

Configure persistence provider and datasource.

## 19.4 Production decisions

- pool size;
- timeout;
- leak detection;
- validation query;
- transaction isolation;
- statement cache;
- migration tool;
- read/write split;
- failover behavior.

## 19.5 Config validation

Fail startup if datasource invalid.

## 19.6 Observability

Expose pool metrics:

- active connections;
- idle connections;
- wait time;
- timeout count;
- leak count.

## 19.7 Secrets

DB password must be secret-managed.

---

# 20. Messaging, Batch, Connectors, Mail, dan External Resource Strategy

## 20.1 Messaging

Need decisions:

- broker;
- connection factory;
- destination naming;
- transactions;
- DLQ;
- retry;
- ordering;
- idempotency;
- observability.

## 20.2 Batch

Need:

- job repository;
- restart policy;
- scheduler;
- partitioning;
- checkpoint;
- failure handling;
- large input/output handling.

## 20.3 Connectors

Need:

- resource adapter lifecycle;
- security credential mapping;
- transaction support;
- work management;
- vendor adapter support.

## 20.4 Mail

Need:

- SMTP host;
- auth;
- TLS;
- rate limit;
- retry;
- DLQ;
- template strategy;
- bounce handling.

## 20.5 External resource config

Centralize resource definitions and references.

## 20.6 App boundary

Application should not create ad-hoc unmanaged connections everywhere.

Use managed resources or well-encapsulated clients.

---

# 21. Security Architecture Strategy

Security decisions span layers.

## 21.1 Identity provider

- OIDC;
- SAML;
- LDAP;
- custom;
- mTLS;
- service account.

## 21.2 Authentication

Use Jakarta Security if runtime supports and it fits.

For modern OIDC, runtime/vendor/framework integration matters.

## 21.3 Authorization

Separate:

- endpoint-level authorization;
- method/service authorization;
- data-level authorization;
- domain policy.

## 21.4 Secrets

Use secret manager/Kubernetes Secret.

Avoid secrets in images/logs.

## 21.5 TLS

Terminate at ingress or app server depending requirements.

mTLS for service-to-service/partner if required.

## 21.6 Security headers

For web apps:

- CSP;
- X-Frame-Options/frame-ancestors;
- HSTS;
- SameSite cookies;
- HttpOnly/Secure.

## 21.7 Audit

Audit security-relevant events.

## 21.8 Migration

Legacy JAAS/container realm may need migration to OIDC/CDI/Jakarta Security.

---

# 22. Transaction Architecture Strategy

Transactions are architectural boundaries.

## 22.1 Local transaction

Single resource.

Example: one database.

## 22.2 Global/XA transaction

Multiple XA resources.

Example: DB + JMS.

## 22.3 Cost of XA

- complexity;
- recovery;
- heuristics;
- performance;
- operational burden.

## 22.4 Modern alternative

Use:

- outbox pattern;
- saga;
- idempotency;
- retry;
- compensating action;
- eventual consistency.

## 22.5 Jakarta Transactions

Use standard `@Transactional` for boundary.

## 22.6 Rule

```text
Do not put remote HTTP/SOAP call inside DB transaction unless deliberately justified.
```

## 22.7 Observability

Log transaction boundary and correlation ID.

## 22.8 Failure design

Every transaction architecture must define:

- retry;
- duplicate handling;
- partial failure;
- compensation;
- recovery.

---

# 23. Data Access Strategy: JPA, JDBC, Jakarta Data, NoSQL

## 23.1 JPA/Persistence

Good for:

- domain/entity persistence;
- relational mapping;
- transactional CRUD;
- JPQL/Criteria.

## 23.2 JDBC

Good for:

- complex SQL;
- performance-critical queries;
- bulk operations;
- vendor-specific SQL.

## 23.3 Jakarta Data

New in Jakarta EE 11.

Repository abstraction standard.

Good for simple repository patterns.

## 23.4 NoSQL

Jakarta EE 11 Platform does not standardize all NoSQL usage broadly, but runtimes/libraries may support.

Jakarta EE 12 under-development page mentions possible Jakarta NoSQL 1.1 for Web Profile 12.

## 23.5 Strategy

Do not choose repository abstraction blindly.

Choose based on:

- query complexity;
- transaction needs;
- performance;
- schema ownership;
- migration;
- team skill.

## 23.6 Rule

Use DTO/projection for API boundaries.

Do not expose JPA entities directly from REST/Faces/SOAP.

---

# 24. REST/API Boundary Strategy

## 24.1 Jakarta REST

Good default for synchronous HTTP APIs.

## 24.2 JSON-B/JSON-P

Use JSON-B for object mapping.

Use JSON-P for low-level JSON manipulation/patch/pointer.

## 24.3 API design

Define:

- resource model;
- status codes;
- error format;
- pagination;
- sorting/filtering;
- idempotency;
- caching;
- versioning;
- OpenAPI;
- authentication/authorization.

## 24.4 Error contract

Use consistent error shape.

## 24.5 Validation

Use Jakarta Validation at DTO boundary.

## 24.6 Security

Never trust client-provided IDs/roles/tenant.

## 24.7 Observability

Log operation, status, latency, correlation ID.

## 24.8 Do not leak persistence model

API is contract, not entity dump.

---

# 25. UI Strategy: Faces, JSP, REST + Frontend

## 25.1 Jakarta Faces

Good for:

- server-side component UI;
- internal admin apps;
- form-heavy enterprise apps;
- teams familiar with JSF/Faces.

## 25.2 JSP/Jakarta Pages

Mostly legacy/maintenance.

Can still serve simple server-rendered pages.

Avoid scriptlets.

## 25.3 REST + frontend

Good for:

- modern SPA;
- mobile;
- separate frontend/backend teams;
- dynamic client-side UX.

## 25.4 Decision

| Need | UI approach |
|---|---|
| form-heavy internal app | Faces |
| legacy JSP app | modernize JSP or migrate |
| public web app with rich UX | REST + frontend |
| simple admin page | Faces or server templates |
| API only | REST |

## 25.5 Security

Server-rendered and SPA both need CSRF/session/token decisions.

## 25.6 Migration

Legacy JSP/JSF can be migrated incrementally.

---

# 26. Async Strategy: Concurrency, Messaging, Batch, Events

## 26.1 Managed Concurrency

Use for short async tasks within app server.

Not for durable work.

## 26.2 Messaging

Use for durable async communication.

Good for decoupling and retry.

## 26.3 Batch

Use for controlled long-running jobs.

Checkpoint/restartability.

## 26.4 Events/CDI

Use for in-process decoupling.

Not durable.

## 26.5 Scheduler

Use runtime/vendor/Kubernetes/CronJob/scheduler system.

## 26.6 Decision table

| Need | Prefer |
|---|---|
| short non-durable async | Jakarta Concurrency |
| durable cross-service event | Messaging/broker |
| long file processing | Batch |
| in-process domain event | CDI event |
| scheduled external job | Kubernetes CronJob / scheduler |
| reliable state transition | DB/outbox + worker |

## 26.7 Backpressure

Every async strategy needs queue/concurrency limits.

## 26.8 Idempotency

Async processing must handle duplicates.

---

# 27. Observability Strategy: Logs, Metrics, Traces, Health

Jakarta EE specs alone are not enough.

You need observability architecture.

## 27.1 Logs

Structured logs:

- timestamp;
- level;
- service;
- operation;
- correlation ID;
- user/tenant where safe;
- error category.

## 27.2 Metrics

Track:

- request rate;
- error rate;
- latency;
- saturation;
- DB pool;
- JMS backlog;
- job duration;
- business counters.

## 27.3 Traces

Distributed trace across:

- REST;
- messaging;
- DB;
- external APIs;
- batch jobs.

## 27.4 Health

Liveness and readiness:

- process alive;
- dependencies reachable;
- migration done;
- app initialized;
- queue/broker reachable if critical.

## 27.5 Tools

Common:

- OpenTelemetry;
- Prometheus;
- Grafana;
- Loki/ELK;
- Jaeger/Tempo;
- MicroProfile Metrics/Health if supported;
- vendor observability.

## 27.6 Design rule

Every external boundary must emit:

```text
latency
success/failure
error classification
correlation ID
```

## 27.7 Avoid log-only observability

Logs are not enough for SLOs.

---

# 28. Cloud-Native Runtime Strategy

## 28.1 Container image

Build immutable image.

## 28.2 Readiness/liveness

Use health checks.

## 28.3 Resource limits

Set CPU/memory requests/limits.

## 28.4 Graceful shutdown

Handle SIGTERM.

Stop accepting new requests.

Drain in-flight work.

## 28.5 Startup time

Optimize server feature set and classpath.

## 28.6 Horizontal scaling

Ensure statelessness or externalize session/state.

## 28.7 Session strategy

- stateless tokens;
- external session store;
- sticky sessions;
- server session replication.

Choose explicitly.

## 28.8 Config

Use ConfigMap/Secret/external config.

## 28.9 Logs

Write to stdout/stderr structured logs.

## 28.10 Persistent data

Use database/object storage, not container filesystem except temp.

---

# 29. Virtual Threads Strategy di Jakarta EE 11

Jakarta EE 11 includes runtime-aware support for virtual threads.

## 29.1 What it means

Jakarta EE runtime/specs acknowledge Java virtual threads.

But support details depend on spec/runtime.

## 29.2 Good use cases

- blocking I/O heavy workloads;
- high concurrency request handling;
- simple per-request blocking model.

## 29.3 Caution

Virtual threads do not make:

- database faster;
- external API faster;
- CPU-bound code faster;
- transaction issues disappear;
- connection pool unlimited.

## 29.4 Pool bottleneck

If DB pool has 50 connections, 5000 virtual threads will still wait.

## 29.5 Managed environment

Do not create unmanaged threads casually in Jakarta EE.

Use runtime-supported concurrency mechanisms.

## 29.6 Test

Benchmark with:

- real DB pool;
- real HTTP client;
- real transaction boundaries;
- realistic latency;
- memory/CPU metrics.

## 29.7 Rule

Virtual threads improve concurrency model, not architecture discipline.

---

# 30. Configuration Anti-Corruption Layer

Do not inject raw config everywhere.

Create typed boundary.

## 30.1 Bad

```java
@ConfigProperty(name = "payment.timeout.ms")
int timeout;

@ConfigProperty(name = "payment.retry.count")
int retry;

@ConfigProperty(name = "payment.url")
String url;
```

scattered across many classes.

## 30.2 Better

```java
@ApplicationScoped
public class PaymentClientConfig {
    private final URI endpoint;
    private final Duration timeout;
    private final int maxRetries;

    // validate once
}
```

## 30.3 Benefits

- central validation;
- default handling;
- documentation;
- testability;
- future migration;
- no duplicated keys;
- clear ownership.

## 30.4 Startup validation

Fail fast:

```text
payment.timeout.ms must be between 100 and 30000
payment.url must be https URL
```

## 30.5 Secret handling

Never expose secret via `toString()`.

## 30.6 Dynamic config

Separate static config class from dynamic feature flag client.

## 30.7 Documentation

Generate config reference.

---

# 31. Environment Parity dan Deployment Promotion

## 31.1 Same artifact

Build once, promote same image/artifact.

```text
dev → test → staging → prod
```

## 31.2 Different config

Only config changes by environment.

## 31.3 Avoid rebuild per environment

Bad:

```text
build app-prod.jar
build app-uat.jar
```

## 31.4 Promotion metadata

Track:

- artifact digest;
- git commit;
- config version;
- migration version;
- deployment ID;
- runtime version.

## 31.5 Drift detection

Ensure runtime config matches desired state.

## 31.6 Rollback

Rollback needs:

- artifact rollback;
- config rollback;
- DB migration strategy;
- message compatibility;
- feature flag rollback.

## 31.7 Database migration

Forward-only migrations are common.

Rollback may require compensating migration.

## 31.8 Compatibility

New app version must tolerate old/new messages/config during rolling deployment.

---

# 32. Migration Strategy: Java EE/Jakarta EE 8 ke Jakarta EE 11

## 32.1 Step 1 — Inventory

Find:

- Java version;
- runtime;
- specs used;
- `javax` imports;
- app packaging;
- vendor APIs;
- descriptors;
- resource config;
- SOAP/XML legacy;
- JSP/JSF legacy;
- EJB;
- JCA;
- JMS;
- database provider.

## 32.2 Step 2 — Decide migration path

Paths:

```text
Java EE 8 → Jakarta EE 8 → Jakarta EE 9/10/11
Java EE 8 → Spring/Quarkus/etc
Jakarta EE 8 → Jakarta EE 10 → 11
```

## 32.3 Step 3 — Namespace migration

`javax.*` to `jakarta.*` for Jakarta specs.

But not all `javax.*` becomes `jakarta.*`.

Examples that remain Java SE:

```java
javax.sql.DataSource
javax.naming.*
javax.net.*
javax.xml.parsers.*
```

## 32.4 Step 4 — Removed specs

Audit removed/deprecated:

- Managed Beans;
- XML Binding from EE 11 Platform;
- XML Web Services;
- SOAP with Attachments;
- optional specs removal;
- SecurityManager assumptions.

## 32.5 Step 5 — Runtime replacement

Choose target runtime and feature set.

## 32.6 Step 6 — Tests

Add integration tests before migration.

## 32.7 Step 7 — Observability and config

Do not migrate blindly without operational signals.

## 32.8 Step 8 — Incremental deployment

Use canary/blue-green where possible.

## 32.9 Step 9 — Performance benchmark

Spec migration can change runtime behavior.

Benchmark.

---

# 33. Decision Records dan Architecture Governance

Top teams document decisions.

## 33.1 ADR examples

- choose Web Profile over Full Platform;
- choose Open Liberty/Payara/WildFly/etc;
- choose MicroProfile Config;
- choose container-managed datasource;
- choose REST + frontend;
- choose outbox instead of XA;
- choose external secret manager.

## 33.2 ADR structure

```text
Title
Status
Context
Decision
Consequences
Alternatives
Rollback/Review date
```

## 33.3 Why useful

Prevents architecture memory loss.

## 33.4 Governance without bureaucracy

Lightweight ADRs are enough.

## 33.5 Review triggers

Review runtime/config decisions when:

- Jakarta version changes;
- Java LTS changes;
- traffic changes;
- security requirement changes;
- cloud platform changes.

## 33.6 Standards

Maintain project standards:

- dependency rules;
- config naming;
- logging format;
- health checks;
- security policies;
- packaging patterns.

---

# 34. Production Readiness Checklist

## 34.1 Runtime

- [ ] Jakarta EE version/profile chosen?
- [ ] Runtime compatible/certified where required?
- [ ] Java version supported?
- [ ] Feature set minimized?
- [ ] Vendor-specific config documented?

## 34.2 Configuration

- [ ] Config sources defined?
- [ ] Secrets separated?
- [ ] Typed config boundary?
- [ ] Startup validation?
- [ ] Config reference documented?
- [ ] Reload/restart behavior known?

## 34.3 Packaging/deployment

- [ ] Immutable artifact/image?
- [ ] Provided dependencies correct?
- [ ] No duplicate API jars?
- [ ] Docker image patched?
- [ ] Resource requests/limits set?
- [ ] Graceful shutdown tested?

## 34.4 Data/resources

- [ ] Datasource pool tuned?
- [ ] Migrations managed?
- [ ] JMS/broker configured?
- [ ] Mail config tested?
- [ ] Batch repository configured?
- [ ] External endpoints timeouts set?

## 34.5 Security

- [ ] AuthN/AuthZ model?
- [ ] TLS/mTLS?
- [ ] Secrets managed?
- [ ] Audit logs?
- [ ] Security headers?
- [ ] Dependency scan?
- [ ] Container scan?

## 34.6 Observability

- [ ] Structured logs?
- [ ] Metrics?
- [ ] Traces?
- [ ] Health/readiness?
- [ ] Dashboards?
- [ ] Alerts?
- [ ] Runbooks?

## 34.7 Resilience

- [ ] Timeout?
- [ ] Retry?
- [ ] Circuit breaker?
- [ ] Bulkhead?
- [ ] Idempotency?
- [ ] DLQ?
- [ ] Backpressure?

## 34.8 Testing

- [ ] Unit tests?
- [ ] Integration tests?
- [ ] Contract tests?
- [ ] Load tests?
- [ ] Security tests?
- [ ] Migration tests?
- [ ] Disaster/restart tests?

---

# 35. Production Failure Modes

## 35.1 Config missing at startup

Cause:

- env var missing;
- ConfigMap key wrong;
- secret not mounted.

Fix:

- startup validation;
- fail fast;
- config checklist.

## 35.2 Wrong config precedence

Cause:

- system property overrides file unexpectedly;
- MicroProfile ordinal misunderstood.

Fix:

- document source precedence;
- log config source without secret values.

## 35.3 ConfigMap update not applied

Cause:

- env var is immutable after process start.

Fix:

- rollout restart or file-based reload design.

## 35.4 Dependency conflict

Cause:

- packaged Jakarta API jar conflicts with runtime.

Fix:

- `provided` scope and dependency enforcer.

## 35.5 Runtime missing spec

Cause:

- chose Web Profile but app uses Messaging/Batch/Mail.

Fix:

- profile/runtime validation.

## 35.6 Secret leak

Cause:

- config object `toString()` logs secret.

Fix:

- secret wrapper/redaction.

## 35.7 DB pool exhaustion

Cause:

- virtual threads/high concurrency but fixed pool small.

Fix:

- tune pool/backpressure.

## 35.8 Rolling deploy incompatibility

Cause:

- new version cannot read old messages/config.

Fix:

- compatibility window.

## 35.9 Observability blind spot

Cause:

- no metrics/traces for external dependency.

Fix:

- instrument boundaries.

## 35.10 Vendor lock-in surprise

Cause:

- business code uses vendor API.

Fix:

- isolate vendor integration.

---

# 36. Best Practices dan Anti-Patterns

## 36.1 Best practices

- Choose smallest sufficient Jakarta EE profile.
- Use compatible products/TCK status as baseline, not final proof.
- Use MicroProfile Config when available; isolate behind typed config.
- Do not assume Jakarta Config final in Jakarta EE 11.
- Separate secrets from non-secret config.
- Version runtime config as code.
- Keep vendor-specific config documented and isolated.
- Use immutable artifacts/images.
- Use `provided` scope for runtime-provided APIs.
- Validate config at startup.
- Use container-managed resources where beneficial.
- Instrument all external boundaries.
- Use ADRs for runtime/profile/config decisions.
- Test on the actual target runtime.

## 36.2 Anti-pattern: full platform by default

Using all specs increases footprint/complexity.

## 36.3 Anti-pattern: config lookup everywhere

Centralize typed config.

## 36.4 Anti-pattern: secrets in image

Never bake secrets into container image.

## 36.5 Anti-pattern: vendor API in business code

Hard to migrate.

## 36.6 Anti-pattern: no timeout

Every external call must have timeout.

## 36.7 Anti-pattern: health = process alive

Need readiness.

## 36.8 Anti-pattern: Java version upgrade without runtime testing

Jakarta runtime + Java LTS compatibility must be tested.

---

# 37. Case Study 1: Legacy WAR di App Server ke Containerized Jakarta EE 11

## 37.1 Initial state

- Java EE 8 WAR;
- `javax.*`;
- deployed to shared app server;
- datasource in server config;
- JSP + JAX-RS + JPA;
- no container image;
- logs unstructured.

## 37.2 Target

- Jakarta EE 11 Web Profile runtime;
- Java 21;
- container image;
- config via Kubernetes;
- CDI/REST/JPA;
- structured logs;
- health/readiness;
- metrics/traces.

## 37.3 Steps

1. Add tests.
2. Migrate namespace.
3. Remove Managed Beans.
4. Replace deprecated specs.
5. Choose runtime.
6. Convert resource config to runtime image/K8s config.
7. Containerize.
8. Add config validation.
9. Add observability.
10. Canary deploy.

## 37.4 Risk

- classpath conflicts;
- missing spec;
- JNDI naming;
- config mismatch;
- session handling;
- DB pool tuning.

## 37.5 Lesson

Migration is architecture + operations, not import rewrite.

---

# 38. Case Study 2: Konfigurasi Berantakan Menjadi Typed Config Boundary

## 38.1 Problem

Config keys scattered:

```java
System.getenv("PAYMENT_URL")
System.getProperty("payment.timeout")
config.getValue("pay.retry")
```

Different names, no validation.

## 38.2 Fix

Create:

```java
@ApplicationScoped
public class PaymentConfig {
    URI endpoint;
    Duration timeout;
    int maxRetries;
    boolean enabled;
}
```

## 38.3 Add validation

At startup:

- endpoint must be HTTPS;
- timeout range;
- retries range;
- no secret in logs.

## 38.4 Add docs

Generate config reference.

## 38.5 Lesson

Typed config boundary reduces operational ambiguity.

---

# 39. Case Study 3: Salah Pilih Profile dan Runtime Menjadi Over-Engineering

## 39.1 Problem

Small REST service deployed on Full Platform app server with Messaging/EJB/JCA features enabled.

Memory high, startup slow, patching complex.

## 39.2 Analysis

Actual specs used:

- CDI;
- REST;
- JSON-B;
- Validation.

## 39.3 Fix

Move to Core/Web Profile/lightweight runtime.

Disable unused features.

## 39.4 Result

Smaller image, faster startup, lower attack surface.

## 39.5 Lesson

Choose runtime by spec usage, not by tradition.

---

# 40. Case Study 4: ConfigMap Update Tidak Mengubah Environment Variable

## 40.1 Problem

Ops updates ConfigMap.

App still uses old value.

## 40.2 Root cause

ConfigMap was injected as env var.

Environment variables are set at process start.

## 40.3 Fix

For static config:

```text
rollout restart
```

For dynamic config:

- mount ConfigMap as file;
- implement file watch/reload;
- use config service;
- use feature flag service.

## 40.4 Governance

Document which config requires restart.

## 40.5 Lesson

Config source update is not same as application config reload.

---

# 41. Latihan Bertahap

## Latihan 1 — Spec inventory

List specs used by your app.

Map to Core/Web/Platform.

## Latihan 2 — Runtime matrix

Compare 3 candidate runtimes.

## Latihan 3 — Dependency boundary

Run Maven dependency tree and identify API/implementation conflicts.

## Latihan 4 — Typed config

Build typed config class with validation.

## Latihan 5 — Secret redaction

Implement `toString()` that redacts secret fields.

## Latihan 6 — Kubernetes config

Create ConfigMap/Secret manifest.

## Latihan 7 — Readiness

Implement readiness check for DB and app initialization.

## Latihan 8 — Observability

Add structured logs and metric plan.

## Latihan 9 — Migration checklist

Build Java EE 8 → Jakarta EE 11 checklist.

## Latihan 10 — ADR

Write ADR for runtime selection.

---

# 42. Mini Project: Jakarta EE Production Architecture Lab

## 42.1 Goal

Create:

```text
jakarta-ee-production-architecture-lab/
```

## 42.2 Modules

```text
spec-inventory/
runtime-selection/
typed-config/
kubernetes-config/
secret-redaction/
datasource-resource/
health-readiness/
observability/
dependency-hygiene/
migration-plan/
```

## 42.3 Deliverables

```text
README.md
SPEC-INVENTORY.md
RUNTIME-SELECTION-ADR.md
CONFIGURATION-MODEL.md
KUBERNETES-CONFIG.md
SECURITY.md
OBSERVABILITY.md
DEPLOYMENT.md
MIGRATION-PLAN.md
PRODUCTION-READINESS.md
```

## 42.4 Required experiments

1. Choose Core/Web/Platform.
2. Create runtime decision matrix.
3. Implement typed config boundary.
4. Validate config at startup.
5. Inject ConfigMap/Secret.
6. Configure datasource.
7. Add readiness endpoint.
8. Add structured logging plan.
9. Detect dependency conflict.
10. Write production readiness checklist.

## 42.5 Evaluation questions

1. What is difference between Platform, Web Profile, Core Profile?
2. Is Jakarta Config final in Jakarta EE 11?
3. Why use MicroProfile Config today?
4. Why isolate config behind typed boundary?
5. What config belongs to container resource?
6. Why use provided scope?
7. Why is TCK not full production proof?
8. How do ConfigMap env vars behave on update?
9. What runtime should a REST-only service use?
10. What makes a Jakarta EE app production-ready?

---

# 43. Referensi Resmi

Referensi utama:

1. Jakarta EE 11 Platform  
   https://jakarta.ee/specifications/platform/11/

2. Jakarta EE Web Profile 11  
   https://jakarta.ee/specifications/webprofile/11/

3. Jakarta EE Core Profile 11  
   https://jakarta.ee/specifications/coreprofile/11/

4. Jakarta EE Specifications  
   https://jakarta.ee/specifications/

5. Jakarta Config  
   https://jakarta.ee/specifications/config/

6. Jakarta EE Platform 12 Under Development  
   https://jakarta.ee/specifications/platform/12/

7. Jakarta EE Compatible Products  
   https://jakarta.ee/compatibility/

8. MicroProfile Config 3.1  
   https://microprofile.io/specifications/config/3-1/

9. MicroProfile Config 3.1 Specification  
   https://download.eclipse.org/microprofile/microprofile-config-3.1/microprofile-config-spec-3.1.html

10. Kubernetes ConfigMaps  
    https://kubernetes.io/docs/concepts/configuration/configmap/

11. Kubernetes Secrets  
    https://kubernetes.io/docs/concepts/configuration/secret/

12. Kubernetes Environment Variables  
    https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/

---

# Penutup

Bagian ini adalah jembatan dari “menguasai spesifikasi” menuju “mendesain sistem produksi”.

Mental model ringkas:

```text
Jakarta EE API knowledge
  ↓
spec inventory
  ↓
profile selection
  ↓
runtime selection
  ↓
configuration model
  ↓
packaging/deployment
  ↓
security/resource strategy
  ↓
observability/resilience
  ↓
production readiness
```

Hal penting:

```text
Jakarta Config belum final di Jakarta EE 11.
Untuk konfigurasi portable hari ini, MicroProfile Config sering menjadi praktik utama,
tetapi sebaiknya tetap diisolasi di typed configuration boundary.
```

Prinsip paling penting:

```text
A Jakarta EE application is production-ready only when its runtime, configuration,
resources, security, observability, and deployment model are designed together.
```

Engineer top-tier tidak hanya tahu `@Inject`, `@Path`, atau `@Entity`. Ia tahu runtime mana yang harus dipilih, kenapa Web Profile cukup, kapan Full Platform dibutuhkan, bagaimana menghindari classpath conflict, bagaimana config di-validate, bagaimana secrets tidak bocor, bagaimana ConfigMap update bekerja, bagaimana rollback dilakukan, dan bagaimana migration Java EE/Jakarta EE direncanakan secara evidence-based.

Bagian berikutnya akan membahas **Jakarta EE Migration & Modernization Playbook**: step-by-step migration dari Java EE/Jakarta EE legacy ke Jakarta EE 11/modern runtime, termasuk namespace migration, removed specs, testing strategy, dependency cleanup, runtime certification, observability uplift, and safe rollout.
