# Part 14 — Apache Karaf: OSGi Distribution, Features, Provisioning, and Operations

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `14-apache-karaf-osgi-distribution-features-provisioning-operations.md`  
Target Java: 8 sampai 25  
Status: Part 14 dari 35

---

## 1. Tujuan Part Ini

Sampai Part 13, kita sudah membangun fondasi:

- OSGi sebagai dynamic module runtime.
- Bundle lifecycle dan framework layers.
- Manifest dan metadata bundle.
- Class loading dan visibility.
- Dependency model dan resolver.
- Semantic versioning.
- Service registry dan Declarative Services.
- Configuration Admin.
- Tooling dengan bnd.
- Apache Felix sebagai lightweight framework.
- Eclipse Equinox sebagai platform-oriented OSGi runtime.

Part ini membahas **Apache Karaf**.

Karaf bukan sekadar framework OSGi. Karaf adalah **distribution/runtime container** di atas framework OSGi seperti Felix atau Equinox. Ia menyediakan paket operasional yang biasanya harus kamu bangun sendiri jika memakai Felix murni:

- shell interaktif,
- provisioning features,
- bundle repository,
- configuration deployment,
- logging,
- security,
- SSH remote console,
- service wrapper,
- hot deployment,
- custom distribution,
- operational commands,
- runtime assembly model.

Mental model penting:

> Felix/Equinox adalah kernel OSGi. Karaf adalah operating environment di atas kernel OSGi.

Karaf membantu ketika pertanyaan engineering berubah dari:

> “Bagaimana bundle saya resolve dan start?”

menjadi:

> “Bagaimana saya menjalankan, meng-upgrade, mengamankan, mengobservasi, dan mengoperasikan banyak bundle secara konsisten di production?”

---

## 2. Apa Itu Apache Karaf?

Apache Karaf adalah lightweight OSGi-based runtime/container yang menyediakan distribusi siap pakai untuk menjalankan aplikasi modular berbasis OSGi.

Karaf biasanya terdiri dari:

1. **OSGi framework**
   - Apache Felix default di banyak distribusi.
   - Bisa juga memakai Equinox.

2. **Karaf shell**
   - Command-line runtime untuk inspect, install, start, stop, update, debug.

3. **Features service**
   - Provisioning unit di atas bundle.
   - Mengelompokkan bundle, config, dependency, repository, dan capability menjadi satu logical deployable unit.

4. **Config Admin integration**
   - File konfigurasi di `etc/` dipetakan ke OSGi Configuration Admin.

5. **Logging subsystem**
   - Biasanya berbasis Pax Logging.

6. **Security subsystem**
   - JAAS realm, user/role, command access control, SSH security.

7. **Deployment scanner**
   - Deploy folder untuk bundle, feature, config, KAR archive.

8. **Remote management**
   - SSH console.
   - JMX.

9. **Custom distribution mechanism**
   - Kamu bisa membuat runtime Karaf sendiri yang sudah berisi feature tertentu.

---

## 3. Kenapa Karaf Ada?

OSGi framework murni seperti Felix menyediakan runtime minimal:

- install bundle,
- resolve bundle,
- start/stop bundle,
- service registry,
- lifecycle,
- resolver.

Tetapi production system butuh lebih dari itu:

- bagaimana mengelompokkan 80 bundle menjadi satu aplikasi,
- bagaimana install dependency transitive secara konsisten,
- bagaimana deploy config bersama bundle,
- bagaimana bootstrap runtime dari nol,
- bagaimana remote troubleshooting,
- bagaimana mengontrol permission command,
- bagaimana membuat custom distribution untuk setiap environment,
- bagaimana rollback dari versi bermasalah,
- bagaimana memastikan runtime tidak bergantung pada “urutan manual install bundle”.

Karaf menjawab sebagian besar kebutuhan itu dengan konsep **feature** dan **distribution**.

---

## 4. Karaf Bukan App Server Tradisional

Karaf sering disalahpahami sebagai app server Java EE/Jakarta EE. Ini keliru.

| Aspek | Jakarta EE App Server | Karaf |
|---|---|---|
| Unit deployment | WAR/EAR/JAR | Bundle/Feature/KAR |
| Runtime model | Application container | OSGi modular runtime |
| Dependency visibility | Container + app classloader hierarchy | Per-bundle classloader wiring |
| Service composition | CDI/EJB/JNDI/Servlet | OSGi service registry, DS, Blueprint |
| Dynamic update | Terbatas | Native OSGi lifecycle |
| Provisioning | App deployment | Feature-based provisioning |
| Main problem | enterprise web/app hosting | modular runtime operation |

Karaf bisa menjalankan web app, REST, messaging, integration stack, dan enterprise libraries. Tetapi identitas utamanya tetap: **OSGi runtime distribution**.

---

## 5. Karaf Architecture Mental Model

Bayangkan Karaf sebagai beberapa lapisan:

```text
+---------------------------------------------------------+
| Your Applications / Domain Bundles / Integration Bundles |
+---------------------------------------------------------+
| Karaf Features, Configs, Shell Commands, Deploy Scanner  |
+---------------------------------------------------------+
| OSGi Services: Config Admin, Event Admin, HTTP, SCR, ... |
+---------------------------------------------------------+
| OSGi Framework: Felix or Equinox                        |
+---------------------------------------------------------+
| JVM: Java 8 ... Java 25                                 |
+---------------------------------------------------------+
| OS / Container / Kubernetes / VM                         |
+---------------------------------------------------------+
```

Karaf tidak menghilangkan OSGi complexity. Ia memberikan **operational surface** untuk mengelolanya.

---

## 6. Directory Layout Karaf

Layout umum Karaf:

```text
apache-karaf/
  bin/
    karaf
    karaf.bat
    client
    shell
    start
    stop
  etc/
    config.properties
    org.apache.karaf.features.cfg
    org.ops4j.pax.logging.cfg
    users.properties
    custom PID configs
  deploy/
    *.jar
    *.xml
    *.kar
    *.cfg
  data/
    cache/
    log/
    txlog/
  lib/
    boot/
    endorsed/        historical / Java 8-era concern
  system/
    Maven-style local repository
  instances/
    child instances, if used
```

Key directory:

- `bin/`: launcher scripts.
- `etc/`: runtime configuration.
- `deploy/`: hot deploy input.
- `data/`: mutable runtime state.
- `system/`: local Maven-style repository used by Karaf.

Production invariant:

> Treat `etc/`, `system/`, and boot features as part of release artifact; treat `data/` as runtime state that must be deliberately preserved or discarded.

---

## 7. Karaf Feature: Unit of Provisioning

OSGi bundle adalah unit modular runtime. Tetapi real application jarang hanya satu bundle.

Karaf introduces **feature** as higher-level unit:

```xml
<feature name="case-management" version="1.0.0">
    <feature>scr</feature>
    <feature>http-whiteboard</feature>

    <bundle>mvn:com.example.case/case-api/1.0.0</bundle>
    <bundle>mvn:com.example.case/case-service/1.0.0</bundle>
    <bundle>mvn:com.example.case/case-web/1.0.0</bundle>

    <config name="com.example.case.service">
        escalation.enabled=true
        max.pending.days=14
    </config>
</feature>
```

Feature dapat berisi:

- bundle,
- dependency feature,
- config,
- configfile,
- repository,
- capability requirement,
- library,
- conditional bundle,
- prerequisite feature.

Mental model:

> Bundle adalah runtime module. Feature adalah deployment recipe.

---

## 8. Bundle vs Feature vs KAR

| Konsep | Fungsi | Analogi |
|---|---|---|
| Bundle | OSGi module individual | satu deployable component |
| Feature | kumpulan bundle + config + dependency | application slice / capability package |
| KAR | Karaf archive berisi feature repo + artifact | offline/installable distribution package |

Contoh:

```text
Bundle:
  case-api-1.0.0.jar

Feature:
  case-management 1.0.0
  includes case-api, case-service, case-web, required configs

KAR:
  case-management-1.0.0.kar
  contains feature descriptor and referenced artifacts
```

Engineering implication:

- Jangan deploy puluhan bundle manual di production.
- Buat feature sebagai unit operasional.
- Gunakan KAR/custom distribution untuk environment yang perlu reproducibility/offline readiness.

---

## 9. Feature Repository

Feature repository adalah XML yang mendefinisikan feature.

Contoh sederhana:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<features name="example-features" xmlns="http://karaf.apache.org/xmlns/features/v1.6.0">

    <repository>mvn:org.apache.karaf.features/standard/LATEST/xml/features</repository>

    <feature name="enforcement-validation-platform" version="1.0.0">
        <feature>scr</feature>
        <feature>config</feature>
        <feature>eventadmin</feature>

        <bundle>mvn:com.example.enforcement/enforcement-api/1.0.0</bundle>
        <bundle>mvn:com.example.enforcement/enforcement-core/1.0.0</bundle>
        <bundle>mvn:com.example.enforcement/enforcement-rules-default/1.0.0</bundle>
    </feature>

</features>
```

Feature repository harus diperlakukan seperti kontrak release:

- versi jelas,
- dependency explicit,
- tidak pakai `LATEST` untuk production,
- artifacts immutable,
- tersedia di repository release,
- diuji resolver/provisioning-nya di CI.

---

## 10. Karaf Shell

Karaf shell adalah salah satu alasan utama Karaf nyaman untuk operasi.

Contoh command umum:

```text
bundle:list
bundle:headers <id>
bundle:start <id>
bundle:stop <id>
bundle:restart <id>
bundle:update <id>
bundle:diag <id>

feature:list
feature:repo-list
feature:repo-add <url>
feature:install <feature>
feature:uninstall <feature>

service:list
service:get <id>

scr:list
scr:info <component>

config:list
config:property-list <pid>
config:edit <pid>
config:property-set <key> <value>
config:update

log:tail
log:set DEBUG com.example

jaas:realm-list
jaas:user-list
```

Shell command bukan sekadar convenience. Ia adalah runtime observability tool.

Top-tier practice:

> Setiap incident OSGi harus bisa diterjemahkan ke command inspection: bundle state, feature state, service state, component state, config state, log state, dan wiring diagnostic.

---

## 11. Runtime State Inspection Model

Saat aplikasi Karaf bermasalah, jangan langsung melihat stack trace saja. Gunakan layered diagnosis:

```text
1. Feature installed?
2. Bundle installed?
3. Bundle resolved?
4. Bundle active?
5. DS component satisfied?
6. Service registered?
7. Config present and valid?
8. Endpoint/event/command exposed?
9. Logs show activation/runtime error?
10. Wiring consistent?
```

Contoh symptoms:

| Symptom | Kemungkinan Layer |
|---|---|
| Feature install gagal | repository/artifact/resolver |
| Bundle INSTALLED | dependency unresolved |
| Bundle RESOLVED tapi tidak ACTIVE | start level/manual start/activation failure |
| Bundle ACTIVE tapi service tidak ada | DS unsatisfied/component disabled/config missing |
| Service ada tapi endpoint mati | HTTP whiteboard/context/security/filter issue |
| Config berubah tapi tidak berefek | PID salah/metatype mismatch/component tidak handle modified |
| Error hanya setelah update | stale classloader/service reference/refresh issue |

---

## 12. Provisioning Lifecycle

Feature installation tidak sama dengan sekadar copy JAR.

Provisioning biasanya melibatkan:

1. Add feature repository.
2. Resolve feature dependencies.
3. Download artifacts.
4. Install bundles.
5. Apply configs/configfiles.
6. Start prerequisite features.
7. Start bundles according to start level/policy.
8. Activate DS components when references/config are satisfied.
9. Register services/endpoints.

Failure bisa terjadi di banyak titik.

Contoh failure:

```text
feature:install enforcement-validation-platform

Failure possibilities:
- Maven artifact missing
- transitive feature missing
- version conflict
- package import unresolved
- execution environment mismatch
- bundle start exception
- DS component unsatisfied
- config invalid
```

Jangan menyebut semua failure sebagai “Karaf tidak bisa install”. Pisahkan provisioning failure, resolver failure, activation failure, dan service composition failure.

---

## 13. Boot Features

Karaf dapat dikonfigurasi untuk menginstall feature saat startup.

Biasanya di:

```text
etc/org.apache.karaf.features.cfg
```

Konsep:

```properties
featuresRepositories = \
    mvn:org.apache.karaf.features/standard/4.x.x/xml/features, \
    mvn:com.example/features/1.0.0/xml/features

featuresBoot = \
    standard, \
    scr, \
    config, \
    enforcement-validation-platform
```

Boot features cocok untuk:

- runtime base capabilities,
- aplikasi utama,
- mandatory production components.

Hindari:

- boot feature terlalu banyak tanpa grouping,
- environment-specific accidental feature,
- dependency yang berubah via `SNAPSHOT`,
- feature boot yang hanya sukses karena local developer cache.

---

## 14. Start Level di Karaf

Karaf memakai OSGi start level untuk mengatur urutan startup.

Namun start level sering disalahgunakan.

Benar:

- framework/system bundles start dulu,
- config/services dasar tersedia sebelum app,
- management plane aktif sebelum business plane.

Salah:

- memaksa business dependency ordering dengan start level,
- menutupi design service dependency yang buruk,
- mengandalkan “bundle A harus start sebelum B” padahal service dependency harus dynamic.

Rule:

> Use start level for coarse runtime phases, not for business dependency choreography.

Jika bundle B membutuhkan service dari A, modelkan dengan DS reference, bukan start-level ordering.

---

## 15. Config Management di Karaf

Karaf `etc/` biasanya terhubung dengan OSGi Config Admin.

File:

```text
etc/com.example.case.service.cfg
```

Isi:

```properties
escalation.enabled=true
max.pending.days=14
notification.channel=email
```

PID:

```text
com.example.case.service
```

DS component:

```java
@Component(configurationPid = "com.example.case.service")
public class CaseService {
    @Activate
    void activate(Config config) { ... }
}
```

Karaf operational model:

- file config bisa diedit,
- Config Admin menerima update,
- component bisa modified/restarted,
- command `config:*` bisa inspect/update config.

Production caution:

- Jangan edit manual config production tanpa audit.
- Jangan menyimpan secret plaintext jika bisa memakai indirection ke secret provider.
- Jangan campur release config dan runtime override tanpa ownership jelas.

---

## 16. Deploy Folder

Karaf `deploy/` memungkinkan hot deployment.

Bisa menaruh:

- bundle JAR,
- feature XML,
- KAR file,
- config file.

Contoh:

```text
deploy/case-service-1.0.0.jar
deploy/example-features.xml
deploy/case-management-1.0.0.kar
deploy/com.example.case.service.cfg
```

Keuntungan:

- mudah untuk development,
- quick operational testing,
- simple deploy path.

Risiko:

- production drift,
- deployment tidak reproducible,
- manual copy error,
- ordering ambiguity,
- sulit rollback dengan disiplin.

Recommendation:

```text
Development:
  deploy folder acceptable.

Production:
  prefer boot features, custom distribution, KAR, or controlled artifact pipeline.
```

---

## 17. KAR Archive

KAR adalah Karaf archive.

Ia bisa berisi:

- feature descriptor,
- bundle artifacts,
- config,
- repository metadata.

KAR berguna untuk:

- offline installation,
- packaging release unit,
- distributing application feature,
- controlled deployment.

Namun KAR bukan silver bullet. Jika artifact versioning buruk, KAR hanya membungkus kekacauan.

Good KAR discipline:

- release version immutable,
- no SNAPSHOT,
- dependency complete,
- tested on clean Karaf,
- includes feature descriptor,
- upgrade/rollback tested,
- checksum/signature managed.

---

## 18. Custom Karaf Distribution

Untuk production, sering lebih baik membuat custom distribution:

```text
my-platform-karaf-1.0.0/
  bin/
  etc/
  system/
  data/ empty
  README/RUNBOOK
```

Distribution sudah berisi:

- Karaf base,
- required framework,
- feature repositories,
- boot features,
- base config,
- security config,
- logging config,
- custom shell commands,
- application bundles in system repo.

Keuntungan:

- reproducible,
- predictable startup,
- no manual feature install,
- easier containerization,
- easier disaster recovery.

Mental model:

> A production Karaf runtime should be a release artifact, not a manually assembled machine.

---

## 19. Karaf Logging

Karaf usually uses Pax Logging to bridge logging APIs.

Common APIs:

- SLF4J,
- Log4j,
- java.util.logging,
- OSGi Log Service.

Karaf commands:

```text
log:tail
log:display
log:set DEBUG com.example.case
log:get
```

Common pitfalls:

1. Multiple logging bindings embedded in bundles.
2. Bundle includes its own Logback/Log4j implementation.
3. Framework logging and application logging not bridged.
4. Classloader conflict around SLF4J.
5. Debug level enabled globally in production.

Best practice:

- Export logging API from platform feature.
- Do not embed logging implementation in business bundles.
- Route all logs through runtime-managed logging.
- Use category-level control.
- Ensure correlation ID propagation across service/event flows.

---

## 20. Security in Karaf

Karaf includes security mechanisms for:

- shell access,
- SSH console,
- JMX,
- command authorization,
- JAAS realms,
- user/role management.

Files often involved:

```text
etc/users.properties
etc/org.apache.karaf.shell.cfg
etc/org.apache.karaf.management.cfg
```

Security concerns:

- default users/passwords,
- remote SSH shell exposed,
- command permissions too broad,
- JMX unrestricted,
- deploy folder writable by wrong user,
- config secrets readable,
- feature repository over insecure transport,
- unverified bundles.

Production rule:

> Karaf shell is powerful enough to change runtime state. Treat it as privileged administration surface.

Minimum hardening:

- disable remote shell if not needed,
- restrict SSH bind address,
- use strong credentials or external auth,
- lock file permissions,
- restrict command access,
- disable deploy folder in high-control production if necessary,
- sign/verify artifacts where applicable,
- audit runtime changes.

---

## 21. Karaf and JAAS

Karaf uses JAAS-based security realms.

Simple users file might look like:

```properties
admin = encryptedPassword,_g_:admingroup
auditor = encryptedPassword,_g_:readonlygroup
_g_\:admingroup = group,admin,manager,viewer
_g_\:readonlygroup = group,viewer
```

Roles can control command access.

A top-tier runtime separates:

- operator role,
- viewer/auditor role,
- deployment role,
- security admin role,
- application support role.

Do not give every support engineer full shell admin access “because it is easier”.

---

## 22. Remote Shell

Karaf supports SSH console.

Useful for:

- remote diagnostics,
- controlled operations,
- incident response.

Dangerous because:

- commands can install/update/stop bundles,
- config can be modified,
- logs can reveal sensitive data,
- a compromised shell means runtime compromise.

In Kubernetes/cloud environments, consider:

- disable SSH and use `kubectl exec` with RBAC,
- expose no management port publicly,
- require bastion/VPN,
- audit shell commands,
- prefer immutable rollout over live mutation.

---

## 23. JMX Management

Karaf can expose JMX for management.

JMX can inspect:

- bundles,
- services,
- features,
- config,
- logs,
- framework state.

Risks:

- remote code/control surface,
- credential leakage,
- weak TLS/auth,
- broad network exposure.

Production guidance:

- bind JMX locally unless explicitly needed,
- use secure transport,
- monitor access,
- prefer metrics endpoint for observability and reserve JMX for admin operations.

---

## 24. Feature Versioning

Feature version should be treated seriously.

Bad:

```xml
<feature name="case-management" version="1.0.0">
    <bundle>mvn:com.example/case-service/LATEST</bundle>
</feature>
```

Better:

```xml
<feature name="case-management" version="1.4.2">
    <bundle>mvn:com.example/case-api/1.2.0</bundle>
    <bundle>mvn:com.example/case-service/1.4.2</bundle>
    <bundle>mvn:com.example/case-web/1.4.2</bundle>
</feature>
```

Feature version answers:

- what application composition is this?
- which bundle versions are expected?
- what config schema is expected?
- what dependency features are required?
- can this be rolled back?

Feature version is not a replacement for package versioning. It is release composition versioning.

---

## 25. Upgrade Semantics

Karaf supports update, install, uninstall, refresh.

But OSGi update is subtle.

Possible sequence:

```text
feature:install case-management/1.4.2
feature:uninstall case-management/1.4.1
bundle:update <id>
bundle:refresh <id>
```

Things to reason about:

- Will package wiring refresh?
- Will dependent bundles restart?
- Will DS components deactivate/reactivate?
- Are service references stale?
- Is in-flight work drained?
- Does config schema change?
- Are database migrations backward compatible?
- Can old and new bundle versions coexist?

Top-tier practice:

> Treat runtime update as a distributed-like state transition inside one JVM.

Even though it is in-process, there are still partial states.

---

## 26. Refresh Semantics

Bundle update does not always mean dependent bundles immediately use new classes.

OSGi can require refresh to rewire bundles.

Refresh impact:

- affected bundles stop,
- classloaders discarded,
- wiring recalculated,
- bundles restarted if persistently started,
- DS components deactivate/reactivate,
- services unregister/register.

Operational risk:

- temporary service disappearance,
- in-flight requests fail,
- memory leak if old classloader retained,
- event handler duplication if unregister not correct,
- threads from old bundle continue running.

Design rules:

- deactivation must stop threads,
- close resources,
- unregister listeners,
- release service objects,
- avoid static global references,
- make activation/deactivation idempotent.

---

## 27. Rollback Strategy

Rollback in Karaf is not simply “copy old JAR back”.

Need to align:

- feature version,
- bundle versions,
- config schema,
- database schema,
- runtime state,
- cached data,
- external integration contract.

Rollback matrix:

| Change Type | Easy Rollback? | Risk |
|---|---:|---|
| Pure implementation bundle | Usually yes | Low-medium |
| API package major change | No | High |
| Config schema change | Maybe | Medium-high |
| DB migration destructive | No | Critical |
| Service contract change | Maybe | High |
| Feature composition change | Maybe | Medium |

Production rollback checklist:

1. Previous feature repository available.
2. Previous artifacts available.
3. Config backup available.
4. DB migration rollback or forward-fix plan exists.
5. Runtime refresh impact understood.
6. Smoke test after rollback defined.
7. Logs/metrics observed after rollback.

---

## 28. Immutable vs Mutable Karaf Runtime

Karaf historically supports mutable runtime:

- install features live,
- update bundles live,
- edit config live,
- deploy folder hot reload.

Cloud/container practice prefers immutable runtime:

- build image,
- run image,
- replace image for change,
- avoid live mutation.

Both models are valid in different contexts.

| Model | Cocok Untuk | Risiko |
|---|---|---|
| Mutable runtime | long-lived appliance, embedded, operational hotfix | drift, audit complexity |
| Immutable runtime | Kubernetes/cloud, regulated release, reproducible deploy | less dynamic, slower hotfix |

Top-tier recommendation for regulated enterprise:

> Use immutable runtime for normal release; reserve controlled live mutation for emergency with explicit audit and rollback plan.

---

## 29. Karaf in Docker

A Karaf Docker image should be deterministic.

Example conceptual layout:

```dockerfile
FROM eclipse-temurin:21-jre

COPY target/my-karaf-distribution /opt/karaf
WORKDIR /opt/karaf

EXPOSE 8181

CMD ["bin/karaf", "server"]
```

Important choices:

- Should `data/` be baked empty?
- Should `data/` be ephemeral?
- Should framework cache persist?
- How are configs injected?
- Are features installed at build-time or startup-time?
- Is deploy folder disabled?
- Are logs written to stdout?

Container-friendly practice:

- build custom distribution with boot features,
- avoid installing feature at container startup from remote repo,
- log to stdout/stderr,
- externalize only environment-specific config,
- do not persist random mutable cache unless needed,
- expose health/readiness endpoint.

---

## 30. Karaf in Kubernetes

Kubernetes changes the operational assumptions.

Instead of:

```text
SSH into Karaf and install feature
```

Prefer:

```text
Build new image -> deploy new ReplicaSet -> readiness check -> rollout
```

Kubernetes concerns:

- readiness is not `bundle:list` all ACTIVE only.
- liveness should not kill slow startup prematurely.
- config should come from ConfigMap/Secret or mounted files.
- logs should go to stdout.
- management shell should not be publicly exposed.
- graceful shutdown must stop bundles/components cleanly.
- rolling update must consider in-flight requests.

Readiness should check:

- required features installed,
- required bundles active,
- required DS components satisfied,
- required services registered,
- HTTP endpoint ready,
- database/message broker reachable if needed.

---

## 31. Health Checks

Karaf may expose health through application-specific endpoints or management features.

Do not equate:

```text
Karaf process is running
```

with:

```text
Business capability is ready
```

Health model:

```text
Process health:
  JVM alive, framework running.

Platform health:
  core features active, config admin, DS, logging, HTTP.

Application health:
  required services available, connectors ready, DB reachable.

Business health:
  validation rules loaded, escalation engine enabled, case APIs responding.
```

A mature Karaf platform exposes layered health.

---

## 32. Karaf and Declarative Services

Karaf can run DS through SCR feature/runtime.

Common operational commands:

```text
scr:list
scr:info <component-name>
```

Typical troubleshooting:

```text
bundle:list | grep case
scr:list | grep case
scr:info com.example.case.internal.CaseServiceComponent
service:list com.example.case.api.CaseService
config:list '(service.pid=com.example.case.service)'
```

DS in Karaf works best when:

- components do not block activation,
- config PID is clear,
- service references are explicit,
- dynamic references are safe,
- logging explains unsatisfied states,
- required components have health checks.

---

## 33. Karaf and Blueprint

Karaf historically has strong Blueprint usage, especially via Apache Aries.

Blueprint provides XML-based dependency injection for OSGi.

Use cases:

- legacy OSGi applications,
- XML-heavy enterprise integration,
- CXF/Aries ecosystems,
- systems already standardized on Blueprint.

DS is generally simpler for modern component/service model.

Decision:

```text
New OSGi component model:
  prefer Declarative Services.

Legacy Karaf/Aries/CXF integration:
  Blueprint may be practical.

Mixed runtime:
  define clear ownership of component lifecycle.
```

Avoid mixing DS, Blueprint, and Spring casually in the same component graph.

---

## 34. Karaf and HTTP

Karaf can run HTTP stacks via features such as Pax Web / HTTP Whiteboard depending on distribution/version.

Possible web model:

- OSGi HTTP Service,
- HTTP Whiteboard,
- JAX-RS through CXF/Jersey integrations,
- web console,
- static resource serving.

Operational issues:

- servlet registered but context missing,
- HTTP feature not installed,
- endpoint service active but port not bound,
- security filter ordering,
- classloading conflict with servlet API,
- javax/jakarta servlet mismatch.

Java 8 to 25 caution:

- older Karaf/web stack may use `javax.servlet`,
- newer Jakarta ecosystems use `jakarta.servlet`,
- do not mix casually,
- define platform servlet API version explicitly.

---

## 35. Karaf and Enterprise Integration

Karaf is often used with:

- Apache Camel,
- Apache CXF,
- ActiveMQ/Artemis,
- Aries Blueprint,
- JPA/Transaction features,
- custom connectors.

This makes Karaf attractive as integration runtime.

But beware:

- integration stacks bring many bundles,
- dependency graph becomes large,
- classloading conflicts become likely,
- feature versions must be pinned,
- operational diagnostics must be mature.

A top-tier engineer treats Karaf integration runtime as a platform product, not a folder of bundles.

---

## 36. Java 8 to Java 25 Considerations

Karaf runtime compatibility depends on:

- Karaf version,
- Felix/Equinox version,
- Pax Logging version,
- Pax Web version,
- Aries/Camel/CXF versions,
- bytecode level of bundles,
- javax/jakarta dependency choices,
- reflective access needs,
- JDK internal API usage.

Common migration risks:

1. Java 8-era libraries using removed Java EE modules.
2. Old ASM/ByteBuddy/CGLIB incompatible with newer bytecode.
3. Reflective access blocked by stronger encapsulation.
4. `javax.*` dependencies missing on Java 11+.
5. Security Manager assumptions broken.
6. Logging binding conflicts.
7. Old Karaf distribution not tested on Java 21/25.

Upgrade practice:

```text
1. Upgrade Karaf to version supporting target JDK.
2. Upgrade framework and core features.
3. Upgrade bytecode tools/libraries.
4. Remove JDK-internal API dependencies.
5. Fix javax/jakarta module assumptions.
6. Run clean runtime resolver tests.
7. Run full feature install on empty cache.
8. Run refresh/update tests.
```

Do not upgrade only the JVM and hope an old Karaf runtime behaves correctly.

---

## 37. Diagnosing Karaf Startup Failure

Layered startup diagnosis:

```text
1. JVM starts?
2. Karaf launcher starts?
3. OSGi framework starts?
4. Boot features repository available?
5. Boot features install?
6. Bundles resolve?
7. Bundles start?
8. DS/Blueprint components activate?
9. HTTP/security/logging ready?
10. Application health ready?
```

Example:

```text
Error: feature install failed
```

Ask:

- Is repository URL reachable?
- Is artifact present in `system/` or Maven repo?
- Is version pinned correctly?
- Is dependency feature missing?
- Is package import unresolved?
- Is Java execution environment compatible?

Example:

```text
Bundle stays INSTALLED
```

Ask:

- `bundle:diag <id>` output?
- Missing package?
- Missing capability?
- Wrong version range?
- javax/jakarta mismatch?
- Optional import incorrectly expected to exist?

Example:

```text
Bundle ACTIVE but app not working
```

Ask:

- DS component satisfied?
- Service registered?
- Config PID correct?
- Endpoint registered?
- Logs from activation?

---

## 38. Common Karaf Anti-Patterns

### 38.1 Manual Bundle Soup

Installing bundles one by one manually until it works.

Problem:

- not reproducible,
- no release contract,
- hidden dependency order,
- impossible rollback.

Fix:

- define feature,
- test clean install,
- create custom distribution.

### 38.2 SNAPSHOT in Production Feature

Problem:

- non-repeatable deploy,
- rollback impossible,
- artifact may change under same coordinate.

Fix:

- immutable release versions only.

### 38.3 Editing Production Runtime Without Audit

Problem:

- drift,
- no traceability,
- incident postmortem unclear.

Fix:

- config pipeline,
- shell command audit,
- immutable release where possible.

### 38.4 Overusing Start Levels

Problem:

- hides missing service dependency design,
- brittle startup.

Fix:

- model dependencies with DS references and readiness.

### 38.5 Embedding Platform Libraries in Bundles

Problem:

- duplicate SLF4J/Servlet/Jackson/etc.,
- classloading conflict,
- `ClassCastException`.

Fix:

- platform feature owns shared APIs,
- bundles import packages.

### 38.6 Exposing SSH/JMX Publicly

Problem:

- admin compromise.

Fix:

- restrict network,
- authz,
- disable if not needed.

### 38.7 Treating ACTIVE as Ready

Problem:

- app accepts traffic before required services/config/connectors ready.

Fix:

- layered readiness.

---

## 39. Case Study: Enforcement Rule Plugin Platform on Karaf

Imagine a regulatory enforcement platform with dynamic rule plugins.

Architecture:

```text
Feature: enforcement-platform
  - enforcement-api
  - enforcement-core
  - enforcement-web
  - enforcement-observability
  - enforcement-config

Feature: enforcement-rules-default
  - rule-license-expiry
  - rule-risk-score
  - rule-repeat-offender

Feature: enforcement-connectors
  - connector-case-db
  - connector-notification
  - connector-document
```

Rule plugin service contract:

```java
public interface EnforcementRule {
    RuleDecision evaluate(CaseSnapshot snapshot);
}
```

Each rule bundle registers DS service:

```java
@Component(
    service = EnforcementRule.class,
    property = {
        "rule.id=repeat-offender",
        "rule.version=1.0.0",
        "rule.severity=HIGH"
    }
)
public final class RepeatOffenderRule implements EnforcementRule {
    @Override
    public RuleDecision evaluate(CaseSnapshot snapshot) {
        // rule logic
    }
}
```

Karaf feature for rules:

```xml
<feature name="enforcement-rules-default" version="1.0.0">
    <bundle>mvn:com.example.rules/rule-license-expiry/1.0.0</bundle>
    <bundle>mvn:com.example.rules/rule-risk-score/1.0.0</bundle>
    <bundle>mvn:com.example.rules/rule-repeat-offender/1.0.0</bundle>
</feature>
```

Operations:

```text
feature:install enforcement-rules-default
service:list com.example.enforcement.api.EnforcementRule
scr:list | grep Rule
log:set DEBUG com.example.rules
```

Upgrade concern:

- If `enforcement-api` changes major version, old rule plugins may not wire.
- If config schema changes, rule components may not activate.
- If rule bundle updates, in-flight evaluation must use stable snapshot of rule services.

Correct design:

- API package semver enforced.
- Rule service list read via atomic snapshot.
- Rule bundle deactivation idempotent.
- Feature versions pinned.
- Rollback tested.
- Rule health/status exposed.

---

## 40. Karaf Decision Framework

Use Karaf when:

- you need OSGi runtime plus production operations,
- you have many bundles/features,
- you need shell-based diagnostics,
- you need feature provisioning,
- you need long-lived modular runtime,
- you need integration stack like Camel/CXF/Aries,
- you need custom distribution,
- your team can maintain OSGi versioning discipline.

Use plain Felix when:

- you want minimal embedded runtime,
- you build your own launcher/ops layer,
- runtime is simple,
- you want full control.

Use Equinox when:

- you are in Eclipse/RCP/p2 ecosystem,
- extension registry/platform model matters,
- product/update-site model matters.

Avoid Karaf when:

- application is simple REST service,
- team does not understand OSGi,
- mutable runtime would violate operational model,
- dependencies are not OSGi-friendly and no one will curate them,
- Kubernetes deployment can be simpler with normal Spring Boot/Quarkus service.

---

## 41. Production Readiness Checklist

Before running Karaf in production:

### Runtime

- [ ] Karaf version supports target Java version.
- [ ] Felix/Equinox framework version pinned.
- [ ] Boot features defined.
- [ ] No production dependency on developer local Maven cache.
- [ ] Clean startup tested from empty `data/`.

### Features

- [ ] Feature XML versioned.
- [ ] No `LATEST` or mutable SNAPSHOT.
- [ ] Feature dependencies explicit.
- [ ] Feature install tested in CI.
- [ ] Feature uninstall/upgrade tested where relevant.

### Bundles

- [ ] Bundle manifests generated and reviewed.
- [ ] No accidental exports.
- [ ] Import ranges sane.
- [ ] Baseline checks enabled for API packages.
- [ ] Shared libraries not duplicated unnecessarily.

### Configuration

- [ ] Config PID documented.
- [ ] Config schema versioned.
- [ ] Secrets not stored casually in plaintext.
- [ ] Config changes auditable.
- [ ] Invalid config behavior tested.

### Security

- [ ] Default users removed/changed.
- [ ] Shell/JMX access restricted.
- [ ] Deploy folder permissions controlled.
- [ ] Feature repository trusted.
- [ ] Admin commands role-protected.

### Observability

- [ ] Logging configured.
- [ ] Logs go to expected sink.
- [ ] Health/readiness implemented.
- [ ] Bundle/service/component diagnostics documented.
- [ ] Runtime command runbook available.

### Deployment

- [ ] Custom distribution or immutable image created.
- [ ] Rollback path tested.
- [ ] Upgrade/refresh impact known.
- [ ] Smoke tests automated.
- [ ] Runtime state ownership clear.

---

## 42. Key Takeaways

Karaf is best understood as:

> an operational OSGi distribution for assembling, provisioning, diagnosing, securing, and running modular Java systems.

Do not use Karaf merely because it can run bundles. Use it when its operational model fits your system.

The most important Karaf concepts:

1. **Feature** is the main provisioning abstraction.
2. **Bundle** remains the runtime modularity abstraction.
3. **Config Admin** connects `etc/` files and dynamic runtime config.
4. **Shell** is a powerful diagnostic and mutation interface.
5. **Custom distribution** is usually better than manually assembled runtime.
6. **Production Karaf** requires security, versioning, feature discipline, and rollback design.
7. **ACTIVE does not mean ready**.
8. **Mutable runtime is powerful but dangerous without governance**.

A top 1% engineer does not just know Karaf commands. They understand Karaf as a release and operations substrate for OSGi systems.

---

## 43. What Comes Next

Part 15 akan membahas:

```text
Web and HTTP in OSGi:
Http Service, HTTP Whiteboard, Servlets, REST
```

Kita akan masuk ke bagaimana OSGi mengekspos HTTP endpoint secara modular dan dinamis, termasuk servlet registration, filters, contexts, JAX-RS integration, classloading web stack, javax/jakarta migration, dan runtime endpoint diagnostics.

---

## 44. Status Series

```text
Part 14 dari 35 selesai.
Series belum selesai.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./13-eclipse-equinox-runtime-eclipse-platform-p2-extension-registry-enterprise-lessons.md">⬅️ Part 13 — Eclipse Equinox Runtime: Eclipse Platform, p2, Extension Registry, Enterprise Lessons</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./15-web-http-osgi-http-service-whiteboard-servlets-rest.md">Part 15 — Web and HTTP in OSGi: Http Service, HTTP Whiteboard, Servlets, REST ➡️</a>
</div>
