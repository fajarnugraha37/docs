# learn-java-jakarta-part-036.md

# Bagian 36 — Jakarta Management (`javax.management.j2ee`): MEJB, JSR-77 Management Model, Managed Objects, JMX Bridge, dan Observability Legacy

> Target pembaca: Java engineer yang ingin memahami Jakarta Management bukan sebagai API aplikasi modern harian, tetapi sebagai **legacy management model** untuk Jakarta EE / Java EE servers: bagaimana platform mengekspos managed objects, attributes, operations, state, deployment/app/module/component model, dan Management Enterprise Bean / MEJB.
>
> Fokus bagian ini: Jakarta Management 1.1, sejarah JSR-77, package historis `javax.management.j2ee`, artifact `jakarta.management.j2ee-api`, MEJB interfaces, `Management`, `ManagementHome`, `ListenerRegistration`, relationship dengan JMX, object names, managed object model, server/application/module/component/resource monitoring, vendor-specific reality, security, production operations, dan kenapa di era Jakarta EE 11 observability modern lebih sering memakai MicroProfile Metrics/OpenTelemetry/JMX/vendor APIs daripada Jakarta Management langsung.

---

## Daftar Isi

1. [Orientasi: Jakarta Management Itu Apa?](#1-orientasi-jakarta-management-itu-apa)
2. [Status Modern: Jakarta Management 1.1, Jakarta EE 8, dan Jakarta EE 11](#2-status-modern-jakarta-management-11-jakarta-ee-8-dan-jakarta-ee-11)
3. [Mental Model: Managed Object Model untuk Jakarta EE Server](#3-mental-model-managed-object-model-untuk-jakarta-ee-server)
4. [Jakarta Management vs JMX vs Vendor Admin API vs OpenTelemetry](#4-jakarta-management-vs-jmx-vs-vendor-admin-api-vs-opentelemetry)
5. [Dependency, Artifact, dan Package yang Tetap `javax.management.j2ee`](#5-dependency-artifact-dan-package-yang-tetap-javaxmanagementj2ee)
6. [Peta API: `Management`, `ManagementHome`, `ListenerRegistration`](#6-peta-api-management-managementhome-listenerregistration)
7. [MEJB: Management Enterprise Bean](#7-mejb-management-enterprise-bean)
8. [`Management` Interface: Navigate dan Manipulate Managed Objects](#8-management-interface-navigate-dan-manipulate-managed-objects)
9. [`ManagementHome`: Home Interface Historis](#9-managementhome-home-interface-historis)
10. [`ListenerRegistration`: Event Listener Management](#10-listenerregistration-event-listener-management)
11. [JSR-77 Managed Object Model](#11-jsr-77-managed-object-model)
12. [ObjectName dan JMX Naming](#12-objectname-dan-jmx-naming)
13. [Managed Object Types: Server, JVM, Application, Module, Component](#13-managed-object-types-server-jvm-application-module-component)
14. [State Management: Running, Stopped, Failed, Starting](#14-state-management-running-stopped-failed-starting)
15. [Attributes, Operations, dan Notifications](#15-attributes-operations-dan-notifications)
16. [Relationship dengan JMX MBeanServer](#16-relationship-dengan-jmx-mbeanserver)
17. [Remote Management dan Security Boundary](#17-remote-management-dan-security-boundary)
18. [Classic Operations Use Cases](#18-classic-operations-use-cases)
19. [Why Application Developers Rarely Use It Directly](#19-why-application-developers-rarely-use-it-directly)
20. [Vendor Reality: GlassFish, Payara, WebLogic, WebSphere/Open Liberty, WildFly](#20-vendor-reality-glassfish-payara-weblogic-websphereopen-liberty-wildfly)
21. [Jakarta Management dan Deployment/Administration Tools](#21-jakarta-management-dan-deploymentadministration-tools)
22. [Jakarta Management vs MicroProfile Metrics](#22-jakarta-management-vs-microprofile-metrics)
23. [Jakarta Management vs OpenTelemetry](#23-jakarta-management-vs-opentelemetry)
24. [Jakarta Management vs Kubernetes/Cloud-Native Operations](#24-jakarta-management-vs-kubernetescloud-native-operations)
25. [Security: Remote Admin, Privilege, Audit, Credential Hygiene](#25-security-remote-admin-privilege-audit-credential-hygiene)
26. [Performance dan Polling Risks](#26-performance-dan-polling-risks)
27. [Operational Data Modeling](#27-operational-data-modeling)
28. [Using JMX Directly as Modern Fallback](#28-using-jmx-directly-as-modern-fallback)
29. [Bridging Legacy Management to Modern Observability](#29-bridging-legacy-management-to-modern-observability)
30. [Testing Strategy](#30-testing-strategy)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices dan Anti-Patterns](#32-best-practices-dan-anti-patterns)
33. [Checklist Review](#33-checklist-review)
34. [Case Study 1: Inventory Aplikasi di Legacy Jakarta EE Server](#34-case-study-1-inventory-aplikasi-di-legacy-jakarta-ee-server)
35. [Case Study 2: Monitoring Modul yang Stuck di State Starting](#35-case-study-2-monitoring-modul-yang-stuck-di-state-starting)
36. [Case Study 3: Remote Management Endpoint Terbuka](#36-case-study-3-remote-management-endpoint-terbuka)
37. [Case Study 4: Migrasi Operasional dari MEJB/JMX ke OpenTelemetry](#37-case-study-4-migrasi-operasional-dari-mejbjmx-ke-opentelemetry)
38. [Latihan Bertahap](#38-latihan-bertahap)
39. [Mini Project: Jakarta Management Legacy Observability Lab](#39-mini-project-jakarta-management-legacy-observability-lab)
40. [Referensi Resmi](#40-referensi-resmi)

---

# 1. Orientasi: Jakarta Management Itu Apa?

Jakarta Management adalah spesifikasi yang mendefinisikan standard management model untuk exposing dan accessing management information, operations, dan parameters dari Jakarta EE Platform components.

Nama historisnya:

```text
J2EE Management / JSR-77
```

Nama Jakarta:

```text
Jakarta Management
```

Package API historisnya tetap:

```java
javax.management.j2ee
```

Ini penting: walaupun nama spesifikasi menjadi Jakarta Management dan artifact ada di namespace Maven `jakarta.management.j2ee`, package Java-nya bukan `jakarta.management.j2ee`.

## 1.1 Problem yang ingin diselesaikan

Dulu, setiap application server punya admin API berbeda:

```text
Server A: cara sendiri untuk list aplikasi
Server B: cara sendiri untuk lihat modul
Server C: cara sendiri untuk monitor component state
```

Jakarta Management mencoba membuat standard model agar tool bisa:

- menemukan managed objects;
- membaca attributes;
- memanggil operations;
- menerima notifications;
- mengelola server/application/module/component secara portable.

## 1.2 Kenapa ada MEJB?

MEJB adalah Management Enterprise Bean.

Ia memberi remote programmatic access ke management model melalui EJB-style interface.

## 1.3 Kenapa jarang dipakai sekarang?

Karena dunia operational berubah:

- JMX langsung lebih umum;
- vendor admin APIs lebih powerful;
- Kubernetes menjadi deployment/orchestration layer;
- MicroProfile Metrics/Health/Config lebih cloud-native;
- OpenTelemetry menjadi standard observability modern;
- Jakarta Management tidak banyak berevolusi setelah Jakarta EE 8.

## 1.4 Namun kenapa tetap perlu tahu?

Karena di legacy enterprise kamu bisa menemukan:

- JSR-77 terminology;
- MEJB references;
- MBean names;
- old admin tools;
- app server monitoring scripts;
- vendor docs menyebut J2EE managed object model;
- migration dari Java EE 8-era servers.

## 1.5 Prinsip utama

```text
Jakarta Management is primarily a server/tooling management model,
not an application business API.
```

---

# 2. Status Modern: Jakarta Management 1.1, Jakarta EE 8, dan Jakarta EE 11

Jakarta Management 1.1 adalah initial Jakarta release untuk Jakarta EE 8.

Spesifikasi ini adalah re-release dari JSR-77 di bawah Eclipse Foundation Specification License.

## 2.1 Jakarta EE 8 context

Jakarta EE 8 adalah era compatibility dengan Java EE 8.

Banyak spesifikasi saat itu masih memiliki package `javax.*`.

Jakarta Management termasuk di situ.

## 2.2 Jakarta EE 11 context

Jakarta EE 11 Platform release page tidak mencantumkan Jakarta Management sebagai bagian Platform/Web/Core Profile modern.

Artinya untuk Jakarta EE 11 application development, Jakarta Management bukan API yang diasumsikan tersedia seperti Servlet, CDI, REST, Persistence, Concurrency, Security, dll.

## 2.3 Practical implication

Jika kamu bekerja dengan Jakarta EE 11 runtime:

```text
Do not assume MEJB/Jakarta Management is available.
```

Vendor mungkin punya support/legacy compatibility, tetapi cek dokumentasi runtime.

## 2.4 Artifact terbaru historis

Maven artifact yang umum:

```text
jakarta.management.j2ee:jakarta.management.j2ee-api:1.1.4
```

Namun package tetap:

```java
javax.management.j2ee
```

## 2.5 Tidak ada namespace migration besar

Berbeda dengan spec lain yang pindah dari `javax.*` ke `jakarta.*`, Jakarta Management 1.1 API docs tetap menggunakan `javax.management.j2ee`.

## 2.6 Modern posture

Treat as:

```text
legacy / tooling-level / vendor-dependent
```

bukan:

```text
core application programming model
```

---

# 3. Mental Model: Managed Object Model untuk Jakarta EE Server

Jakarta Management memodelkan server sebagai kumpulan managed objects.

Mental model:

```text
Jakarta EE Server
  ├── JVM(s)
  ├── Application(s)
  │   ├── Module(s)
  │   │   ├── EJB component(s)
  │   │   ├── Web component(s)
  │   │   ├── Resource adapter(s)
  │   │   └── ...
  ├── Resource(s)
  └── Service(s)
```

Setiap managed object punya:

- name / object name;
- type;
- attributes;
- operations;
- state;
- relationships;
- notifications/events.

## 3.1 Management model vs application model

Application model:

```text
CustomerService, OrderRepository, PaymentGateway
```

Management model:

```text
server, application, module, servlet, EJB, resource, JVM
```

## 3.2 Management model answers

- aplikasi apa yang deployed?
- modul apa yang running?
- component state apa?
- JVM resource apa?
- server mana targetnya?
- object mana punya relationship dengan object lain?
- event management apa yang terjadi?

## 3.3 Why this matters

Operational tooling needs stable model.

But modern systems often get this from:

- JMX;
- metrics endpoint;
- Kubernetes API;
- app server REST admin API;
- OpenTelemetry.

## 3.4 Object graph

Managed objects are related.

Example:

```text
J2EEServer contains J2EEApplication
J2EEApplication contains WebModule/EJBModule
WebModule contains Servlet
```

## 3.5 Management is not observability enough

Knowing component exists/running is useful.

But modern observability also needs:

- metrics;
- traces;
- logs;
- exemplars;
- RED/USE signals;
- business KPIs;
- SLOs.

---

# 4. Jakarta Management vs JMX vs Vendor Admin API vs OpenTelemetry

## 4.1 Jakarta Management

Standard management model for Jakarta EE components, using MEJB and JMX-related concepts.

## 4.2 JMX

Java Management Extensions.

Generic Java management/instrumentation system.

MBeans expose attributes/operations/notifications.

## 4.3 Vendor Admin API

Runtime-specific API:

- asadmin for GlassFish/Payara;
- WildFly CLI/management API;
- WebLogic WLST;
- Open Liberty server config/admin features;
- WebSphere admin;
- REST admin APIs.

More powerful but less portable.

## 4.4 MicroProfile Metrics/Health

Cloud-native metrics and health endpoints.

More app/platform observability oriented.

## 4.5 OpenTelemetry

Modern standard for traces, metrics, logs.

Vendor-neutral, cloud-native, ecosystem-wide.

## 4.6 Kubernetes API

Controls deployment/pods/services/config/secrets at orchestration layer.

## 4.7 Decision table

| Need | Better fit |
|---|---|
| Legacy EE server managed object model | Jakarta Management / JSR-77 |
| JVM-level attributes/ops | JMX |
| Runtime-specific admin | Vendor admin API |
| App health/readiness/liveness | Health endpoint / MicroProfile Health / Kubernetes probes |
| Metrics scraping | MicroProfile Metrics / Prometheus / OpenTelemetry |
| Distributed traces | OpenTelemetry |
| Cloud deployment state | Kubernetes API |
| Portable modern app programming | Jakarta EE specs like CDI/REST/Persistence |

## 4.8 Top-tier view

Jakarta Management is historically important, but not enough for modern operations.

---

# 5. Dependency, Artifact, dan Package yang Tetap `javax.management.j2ee`

## 5.1 Maven artifact

```xml
<dependency>
  <groupId>jakarta.management.j2ee</groupId>
  <artifactId>jakarta.management.j2ee-api</artifactId>
  <version>1.1.4</version>
</dependency>
```

## 5.2 Package

```java
javax.management.j2ee
```

This is surprising but correct for Jakarta Management 1.1.

## 5.3 API docs

The package summary says it provides Jakarta Management Enterprise Bean component interfaces.

## 5.4 Runtime dependency

API jar alone does not provide server management implementation.

A Jakarta EE server must expose MEJB/management model.

## 5.5 Jakarta EE 11 warning

Do not assume a modern EE 11 server provides it.

## 5.6 Compile-only use

If maintaining old tooling, dependency may be needed for compile.

## 5.7 Prefer vendor docs

Because implementation/support is vendor-dependent.

---

# 6. Peta API: `Management`, `ManagementHome`, `ListenerRegistration`

Package:

```java
javax.management.j2ee
```

Main interfaces:

```java
Management
ManagementHome
ListenerRegistration
```

## 6.1 `Management`

Provides APIs to navigate and manipulate managed objects.

## 6.2 `ManagementHome`

Required home interface for the Management Enterprise Bean component.

This reflects old EJB 2.x home interface style.

## 6.3 `ListenerRegistration`

Defines methods clients use to add/remove event listeners.

## 6.4 Why so small?

The spec relies heavily on JMX concepts/types for actual management operations.

## 6.5 Historical API style

This is older Java EE API style, not modern CDI/Jakarta REST style.

## 6.6 Practical implication

If the API feels old, it is because it is old.

Treat it as legacy/tooling integration.

---

# 7. MEJB: Management Enterprise Bean

MEJB stands for Management Enterprise Bean.

It is a special EJB exposing management access.

## 7.1 Purpose

MEJB provides interoperable remote access to server management model.

## 7.2 Client model

A management client obtains MEJB reference and calls management methods.

## 7.3 Old EJB home style

`ManagementHome` exists because MEJB follows old EJB model.

## 7.4 Security

MEJB access must be strongly protected.

It can expose sensitive operational data and operations.

## 7.5 Deployment

MEJB is provided by server/container, not your app.

## 7.6 Modern replacement

Most modern runtimes use:

- JMX remote;
- REST admin API;
- CLI;
- metrics/health endpoints;
- Kubernetes APIs.

## 7.7 Runbook

If maintaining MEJB tooling, document server-specific lookup and credentials.

---

# 8. `Management` Interface: Navigate dan Manipulate Managed Objects

`Management` is the core interface.

It lets clients navigate and manipulate managed objects.

## 8.1 Conceptual operations

Typical management capabilities include:

- query object names;
- get attributes;
- set attributes;
- invoke operations;
- query relationships;
- inspect state;
- work with notifications.

Actual methods follow JMX-related contracts.

## 8.2 Managed object lookup

Management clients need names/queries.

## 8.3 Attribute access

Read metrics/config/state from managed object.

## 8.4 Operation invocation

Start/stop/restart or other management operations depending object.

## 8.5 Safety

Operation invocation can be dangerous.

Never expose management client broadly.

## 8.6 Error handling

Management operation can fail because:

- object not found;
- permission denied;
- server unavailable;
- operation unsupported;
- runtime state changed;
- network/remote exception.

## 8.7 Portability

The model is standard, but actual object availability and behavior vary.

---

# 9. `ManagementHome`: Home Interface Historis

`ManagementHome` is the home interface for MEJB.

## 9.1 Old EJB style

Historically, EJB clients used home interfaces to create/find beans.

## 9.2 Why it matters

It signals that Jakarta Management comes from Java EE 1.4 / JSR-77 era.

## 9.3 Modern contrast

Modern Jakarta apps usually use:

```java
@Inject
```

or REST clients, not EJB home lookup.

## 9.4 Legacy tooling

Old admin tools may still have JNDI lookup code for MEJB.

## 9.5 Migration strategy

If replacing old tooling, map required capabilities to:

- vendor REST/admin API;
- JMX;
- OpenTelemetry/metrics;
- Kubernetes.

---

# 10. `ListenerRegistration`: Event Listener Management

`ListenerRegistration` lets MEJB clients add/remove event listeners.

## 10.1 Purpose

Management clients may subscribe to notifications/events.

## 10.2 Conceptual use

```text
listen for state changes
listen for deployment events
listen for resource events
```

## 10.3 JMX relationship

JMX notifications are central to Java management event model.

## 10.4 Practical caution

Remote event listeners can be fragile:

- network disconnect;
- listener leak;
- backpressure;
- missed events;
- server restart.

## 10.5 Modern alternative

Event-driven operations often use:

- metrics alerts;
- log pipelines;
- Kubernetes events;
- audit event topics;
- OpenTelemetry signals.

## 10.6 Security

Listener registration must be authorized.

---

# 11. JSR-77 Managed Object Model

JSR-77 standardizes manageable parts of Java EE architecture.

## 11.1 Object hierarchy

Common conceptual object types:

```text
J2EEDomain
J2EEServer
JVM
J2EEApplication
AppClientModule
EJBModule
WebModule
ResourceAdapterModule
EntityBean
StatefulSessionBean
StatelessSessionBean
MessageDrivenBean
Servlet
ResourceAdapter
JavaMailResource
JDBCResource
JCAResource
JMSResource
JNDIResource
JTAResource
RMI_IIOPResource
URLResource
```

Exact support varies.

## 11.2 Managed object identity

Objects are identified by names compatible with JMX ObjectName style.

## 11.3 Attributes

Examples:

- name;
- state;
- server;
- parent;
- children;
- statistics;
- deployment descriptor;
- start time.

## 11.4 Operations

Examples:

- start;
- stop;
- restart;
- get stats;
- reset stats.

## 11.5 Statistics

Management model can expose statistics, but modern metrics systems are usually richer.

## 11.6 Relationships

Managed objects can refer to related objects.

## 11.7 Portable ideal vs vendor reality

The model defines ideal, but vendor implementation depth differs.

---

# 12. ObjectName dan JMX Naming

Jakarta Management uses JMX style naming concepts.

## 12.1 JMX ObjectName

ObjectName looks like:

```text
domain:key=value,key2=value2
```

## 12.2 Example concept

```text
j2eeType=J2EEServer,name=server1
```

## 12.3 Why naming matters

Management clients query by names.

## 12.4 ObjectName can be tricky

Special characters need quoting/escaping.

## 12.5 Stable naming

Vendor naming conventions may differ.

## 12.6 Query pattern

JMX supports query patterns for object names.

## 12.7 Practical tip

Never hard-code too much without discovery step.

---

# 13. Managed Object Types: Server, JVM, Application, Module, Component

## 13.1 Server

Represents Jakarta EE server instance.

## 13.2 JVM

Represents Java VM.

May expose memory/thread/classloading stats.

## 13.3 Application

Enterprise application deployed to server.

## 13.4 Module

WAR, EJB module, resource adapter module, app client.

## 13.5 Component

Servlet, EJB, MDB, etc.

## 13.6 Resource

JDBC, JMS, JCA, JavaMail, JTA, JNDI resources.

## 13.7 Why this model matters

It mirrors old enterprise deployment packaging.

Modern microservices/Kubernetes model usually works at pod/container/service level instead.

## 13.8 Mapping to modern concepts

| JSR-77 object | Modern rough equivalent |
|---|---|
| J2EEServer | app server process / pod / VM |
| J2EEApplication | deployed app artifact |
| WebModule | WAR / web application |
| EJBModule | EJB module |
| Servlet | web endpoint/component |
| JDBCResource | datasource/pool |
| JMSResource | broker connection/factory/destination |
| JVM | JVM runtime metrics |

---

# 14. State Management: Running, Stopped, Failed, Starting

Managed objects can have lifecycle state.

## 14.1 Common states

Conceptual states:

- starting;
- running;
- stopping;
- stopped;
- failed;
- unknown.

## 14.2 Start/stop operations

Some managed objects support lifecycle operations.

## 14.3 Race condition

State can change between query and operation.

## 14.4 Partial failure

Application can be deployed but one module failed.

## 14.5 Modern operations

In Kubernetes, lifecycle is pod/container readiness/liveness, but app server internal state still matters for monoliths.

## 14.6 Alerting

Alert on:

- app/module failed;
- stuck starting;
- repeated restart;
- resource unavailable.

## 14.7 State not enough

Running does not mean healthy.

Need readiness/health/metrics.

---

# 15. Attributes, Operations, dan Notifications

## 15.1 Attributes

Read-only or writable properties.

Examples:

```text
state
name
statistics
deploymentDescriptor
server
modules
```

## 15.2 Operations

Actions invoked on managed object.

Examples:

```text
start()
stop()
resetStats()
```

## 15.3 Notifications

Events emitted by managed objects.

Examples:

```text
state changed
module deployed
resource failed
```

## 15.4 Management contract

Attributes/operations/notifications form management API.

## 15.5 Safety

Writable attributes and operations require strong access control.

## 15.6 Audit

Record who changed what and when.

## 15.7 Modern mapping

Attributes become metrics/config snapshots.

Notifications become events/logs/alerts.

---

# 16. Relationship dengan JMX MBeanServer

JMX is foundational for Java management.

## 16.1 MBeanServer

Central registry of MBeans.

## 16.2 MBean

Managed bean exposing attributes/operations/notifications.

## 16.3 Jakarta Management model

Standardizes EE-specific managed objects using JMX-like model.

## 16.4 Direct JMX

Many teams use JMX directly:

```java
ManagementFactory.getPlatformMBeanServer()
```

or remote JMX/Jolokia/vendor bridge.

## 16.5 Platform MBeans

JDK exposes:

- memory;
- threads;
- classloading;
- GC;
- runtime;
- operating system;
- logging.

## 16.6 Vendor MBeans

App servers expose their own MBeans.

## 16.7 JMX security

Remote JMX must be secured.

Never expose unauthenticated JMX.

---

# 17. Remote Management dan Security Boundary

Management APIs are high-risk.

## 17.1 Why high risk?

They can reveal or control:

- deployed apps;
- server state;
- resources;
- configuration;
- runtime internals;
- potentially operations.

## 17.2 Security requirements

- authentication;
- authorization;
- network restriction;
- TLS;
- auditing;
- least privilege;
- credential rotation.

## 17.3 Admin network

Expose only on admin network/VPN/private network.

## 17.4 Role separation

Read-only monitoring role vs operator role vs admin role.

## 17.5 Secrets

Management responses may expose config containing secrets.

Redact.

## 17.6 Audit

Every mutating operation must be auditable.

## 17.7 Zero trust

Do not assume internal network is trusted.

---

# 18. Classic Operations Use Cases

## 18.1 Inventory

List deployed applications/modules.

## 18.2 State checks

Check whether app/module is running.

## 18.3 Resource monitoring

Inspect datasource/JMS/JCA resources.

## 18.4 Deployment verification

After deploy, verify target module state.

## 18.5 Admin dashboard

Show app server health/state.

## 18.6 Automation

Scripts that stop/start/redeploy modules.

## 18.7 Migration discovery

Inventory legacy servers before modernization.

## 18.8 Audit

Report runtime deployment inventory.

---

# 19. Why Application Developers Rarely Use It Directly

## 19.1 Too platform/tooling-oriented

Most application code should not manage server internals.

## 19.2 Vendor support varies

Portable code may not work consistently.

## 19.3 Modern tooling supersedes

Metrics/health/tracing/admin APIs better fit current operations.

## 19.4 Security concerns

Apps calling management APIs can create privilege escalation risk.

## 19.5 Old API style

MEJB/home interfaces feel outdated.

## 19.6 App boundary

Application should expose its own business/operational signals via modern endpoints.

## 19.7 When app might use it

Rare cases:

- internal admin tool for legacy server;
- migration inventory scanner;
- platform engineering automation;
- compatibility monitoring.

---

# 20. Vendor Reality: GlassFish, Payara, WebLogic, WebSphere/Open Liberty, WildFly

## 20.1 GlassFish/Payara

Historically close to Jakarta reference implementations.

May support legacy management concepts/admin commands.

## 20.2 WebLogic

Rich proprietary management APIs and WLST.

JMX is heavily used.

## 20.3 WebSphere/Open Liberty

Management/monitoring model via Liberty features, JMX, metrics, admin tooling.

## 20.4 WildFly

Powerful management model via CLI/HTTP management API.

## 20.5 Vendor-specific wins

Vendor APIs usually expose more useful details than Jakarta Management.

## 20.6 Portability trade-off

Portable standard may be too shallow; vendor API more practical but locks in.

## 20.7 Strategy

Build abstraction layer if supporting multiple vendors.

Otherwise use vendor API intentionally and document lock-in.

---

# 21. Jakarta Management dan Deployment/Administration Tools

Jakarta Management pairs conceptually with Jakarta Deployment.

## 21.1 Deployment

Jakarta Deployment standardizes deploy/distribute/start/stop/undeploy tooling SPI.

## 21.2 Management

Jakarta Management standardizes runtime managed object inspection/control.

## 21.3 Classic tool flow

```text
Deploy app
  ↓ get TargetModuleID
  ↓ verify state through management
  ↓ monitor runtime object
```

## 21.4 Modern tool flow

```text
Build image
  ↓ deploy via Kubernetes/GitOps
  ↓ health/readiness probes
  ↓ metrics/traces/logs
```

## 21.5 Legacy integration

If old tool uses Deployment + Management, migration needs mapping to modern APIs.

## 21.6 Practical note

Modern Jakarta runtimes may not expose these standard APIs fully.

---

# 22. Jakarta Management vs MicroProfile Metrics

## 22.1 Jakarta Management

Object model for server/platform components.

## 22.2 MicroProfile Metrics

Metrics endpoint model for application/runtime metrics.

## 22.3 Metrics style

```text
http_server_requests_seconds
jvm_memory_used_bytes
datasource_connections_active
```

## 22.4 Management style

```text
ObjectName → attributes/operations/state
```

## 22.5 Cloud-native fit

Metrics fit Prometheus/Grafana/SLOs better.

## 22.6 Complement

Management can tell inventory/state.

Metrics can tell behavior/performance.

## 22.7 Modern preference

Use metrics for monitoring and alerting.

Use management/admin APIs for control/inventory.

---

# 23. Jakarta Management vs OpenTelemetry

## 23.1 OpenTelemetry

Standard for:

- traces;
- metrics;
- logs;
- context propagation.

## 23.2 Jakarta Management

Management model for EE managed objects.

## 23.3 Different questions

Jakarta Management:

```text
What is deployed? What is its state? What operations can I perform?
```

OpenTelemetry:

```text
What happened in requests? What is latency/error rate? Which service called which?
```

## 23.4 Modern observability

For distributed systems, OpenTelemetry is more relevant.

## 23.5 Legacy bridge

You can export management attributes as metrics.

## 23.6 Avoid overloading

Do not use Jakarta Management as tracing system.

---

# 24. Jakarta Management vs Kubernetes/Cloud-Native Operations

## 24.1 Kubernetes manages containers

- deployments;
- pods;
- services;
- configmaps;
- secrets;
- jobs;
- events.

## 24.2 Jakarta Management manages app server internals

- deployed apps;
- modules;
- EE resources;
- component state.

## 24.3 Different layers

```text
Kubernetes:
  process/container orchestration

Jakarta Management:
  app server internal model
```

## 24.4 Modern monolith on K8s

Both layers may matter:

- pod running;
- app server running;
- WAR deployed;
- datasource healthy.

## 24.5 Readiness

Use readiness endpoints, not just management state.

## 24.6 GitOps

Desired state lives in manifests, not imperative MEJB calls.

## 24.7 Migration

Classic admin scripts should be replaced with CI/CD + Kubernetes APIs where possible.

---

# 25. Security: Remote Admin, Privilege, Audit, Credential Hygiene

## 25.1 Never expose public

Management endpoints/APIs must not be internet-exposed.

## 25.2 Least privilege

Separate:

- read-only monitoring;
- deployer;
- operator;
- full admin.

## 25.3 Credentials

Use:

- secret manager;
- rotation;
- mTLS where possible;
- no hardcoded password.

## 25.4 Audit

Record:

- caller;
- operation;
- target;
- timestamp;
- result;
- reason/change ticket.

## 25.5 Network

Restrict by:

- VPN;
- private subnet;
- firewall;
- security group;
- Kubernetes network policy.

## 25.6 Sensitive data

Management attributes may expose:

- URLs;
- usernames;
- resource names;
- maybe secrets depending vendor.

Redact.

## 25.7 Break-glass

Define emergency admin procedure.

---

# 26. Performance dan Polling Risks

## 26.1 Polling overhead

Management polling can burden server.

## 26.2 Expensive attributes

Some attributes trigger computation or remote calls.

## 26.3 High cardinality

Many objects/modules/resources can create large result sets.

## 26.4 Poll interval

Avoid aggressive polling.

## 26.5 Cache inventory

Static inventory can be cached.

## 26.6 Prefer metrics scraping

Metrics systems optimized for periodic scrape.

## 26.7 Notification vs polling

Notifications can reduce polling, but remote listener reliability is complex.

## 26.8 Rate limit

Protect admin APIs.

---

# 27. Operational Data Modeling

## 27.1 Inventory model

Represent:

```text
server
application
module
component
resource
state
version
target
timestamp
source
```

## 27.2 State history

Track transitions:

```text
STARTING → RUNNING
RUNNING → FAILED
```

## 27.3 Correlate with deployment

Link state to:

- deployment ID;
- artifact version;
- build SHA;
- operator;
- change request.

## 27.4 Normalize vendor data

If using multiple vendors, normalize into internal model.

## 27.5 Avoid leaking vendor naming

Downstream tools should not depend on raw ObjectName if avoidable.

## 27.6 Data freshness

Every management snapshot needs timestamp.

## 27.7 Confidence

Mark if data is standard API, vendor API, or inferred.

---

# 28. Using JMX Directly as Modern Fallback

If Jakarta Management unavailable, JMX often remains.

## 28.1 Local platform MBeanServer

```java
MBeanServer server = ManagementFactory.getPlatformMBeanServer();
```

## 28.2 Query MBeans

```java
Set<ObjectName> names = server.queryNames(null, null);
```

## 28.3 Get attribute

```java
Object value = server.getAttribute(objectName, "State");
```

## 28.4 Invoke operation

```java
server.invoke(objectName, "start", null, null);
```

## 28.5 Remote JMX

Can expose JMX remotely, but secure carefully.

## 28.6 Jolokia

HTTP bridge for JMX often used, but secure carefully.

## 28.7 Vendor MBeans

Most useful app server details may be vendor-specific MBeans.

## 28.8 Exporting metrics

JMX exporter can convert MBeans to Prometheus metrics.

---

# 29. Bridging Legacy Management to Modern Observability

## 29.1 Pattern

```text
Legacy management/JMX
  ↓ collector
normalized model
  ↓ metrics/events/logs
OpenTelemetry/Prometheus/Grafana
```

## 29.2 Collector responsibilities

- authenticate to management API;
- query inventory/state;
- transform to metrics;
- redact;
- handle errors;
- limit polling.

## 29.3 Example metrics

```text
jakarta_app_module_state{server="s1",app="aceas",module="web"} 1
jakarta_deployed_application_count{server="s1"} 42
jakarta_datasource_available{server="s1",name="jdbc/main"} 1
```

## 29.4 Events

State transition becomes event:

```json
{
  "server": "s1",
  "module": "web",
  "from": "STARTING",
  "to": "RUNNING",
  "deploymentId": "..."
}
```

## 29.5 Alerts

Alert on:

- failed module;
- app missing;
- datasource unavailable;
- repeated restart;
- stale collector.

## 29.6 Long-term migration

Move from management polling to native health/metrics/tracing where possible.

---

# 30. Testing Strategy

## 30.1 Unit test parser/normalizer

If you normalize management data, test mapping.

## 30.2 Integration test with server

Use container/runtime in test environment.

## 30.3 Security test

Verify unauthorized users cannot access management API.

## 30.4 Failure test

Simulate:

- server down;
- object missing;
- permission denied;
- slow response;
- malformed vendor data.

## 30.5 Polling test

Ensure collector does not overload server.

## 30.6 Drift test

Deploy/undeploy app and verify inventory changes.

## 30.7 State transition test

Start/stop module and verify events.

## 30.8 Modern bridge test

Verify metrics exported correctly.

---

# 31. Production Failure Modes

## 31.1 MEJB unavailable

Runtime does not support Jakarta Management or feature disabled.

## 31.2 Package surprise

Developer expects `jakarta.management.j2ee`, but actual package is `javax.management.j2ee`.

## 31.3 Authentication failure

Credentials expired/rotated.

## 31.4 Authorization failure

Monitoring account lacks required permissions.

## 31.5 ObjectName mismatch

Vendor naming differs.

## 31.6 Object state stale

Cached snapshot outdated.

## 31.7 Management API slow

Polling overload or server under stress.

## 31.8 Remote listener lost

Notification listener disconnected.

## 31.9 Security exposure

Management endpoint exposed publicly.

## 31.10 Mutating operation accident

Automation stops wrong module.

## 31.11 Vendor upgrade break

Object names/attributes changed.

## 31.12 Alert false positive

State mapped incorrectly.

---

# 32. Best Practices dan Anti-Patterns

## 32.1 Best practices

- Treat Jakarta Management as legacy/tooling-level.
- Prefer modern metrics/health/tracing for app observability.
- Use vendor admin API intentionally when needed.
- Secure management endpoints strongly.
- Separate read-only monitoring and admin roles.
- Audit all mutating operations.
- Normalize vendor-specific data.
- Rate-limit polling.
- Use timestamps and source metadata.
- Build migration path to OpenTelemetry/Prometheus/Kubernetes.
- Do not put management calls in business code.

## 32.2 Anti-pattern: application business code calls management API

Business code should not manage app server internals.

## 32.3 Anti-pattern: public remote JMX/MEJB

High severity security risk.

## 32.4 Anti-pattern: hard-coded ObjectName everywhere

Vendor upgrade breaks scripts.

## 32.5 Anti-pattern: aggressive polling

Can overload management subsystem.

## 32.6 Anti-pattern: state = health

Running does not mean healthy.

## 32.7 Anti-pattern: no audit for stop/start/redeploy

Operational risk.

---

# 33. Checklist Review

## 33.1 Availability

- [ ] Runtime supports Jakarta Management/MEJB?
- [ ] Feature enabled?
- [ ] API dependency available?
- [ ] Package understood as `javax.management.j2ee`?
- [ ] Vendor docs reviewed?

## 33.2 Security

- [ ] Management endpoint private?
- [ ] TLS enabled?
- [ ] Authentication configured?
- [ ] Least privilege roles?
- [ ] Secrets managed?
- [ ] Audit enabled?
- [ ] Logs redacted?

## 33.3 Operations

- [ ] Inventory model defined?
- [ ] State mapping correct?
- [ ] Polling interval safe?
- [ ] Error handling?
- [ ] Timeout configured?
- [ ] Alerts tested?
- [ ] Runbook written?

## 33.4 Modern observability

- [ ] Health endpoint exists?
- [ ] Metrics exported?
- [ ] Tracing enabled?
- [ ] JMX exporter considered?
- [ ] Kubernetes probes configured?
- [ ] OpenTelemetry pipeline exists?

## 33.5 Migration

- [ ] Legacy scripts inventoried?
- [ ] Vendor API replacement mapped?
- [ ] Dashboard replacement defined?
- [ ] Alert parity tested?
- [ ] Old management endpoint decommission plan?

---

# 34. Case Study 1: Inventory Aplikasi di Legacy Jakarta EE Server

## 34.1 Problem

Company has many Java EE/Jakarta EE 8 servers.

No one knows exactly which apps/modules are deployed.

## 34.2 Approach

Use management/JMX/vendor API to collect:

- server;
- application;
- module;
- version;
- state;
- resource dependencies;
- datasource/JMS names.

## 34.3 Normalize

Store inventory in database.

## 34.4 Output

Dashboard:

```text
server → applications → modules → state → artifact version
```

## 34.5 Security

Read-only account.

Private network.

Audit access.

## 34.6 Lesson

Legacy management API is useful for discovery/migration.

---

# 35. Case Study 2: Monitoring Modul yang Stuck di State Starting

## 35.1 Problem

After deployment, application module remains `STARTING`.

Kubernetes pod is running, but app is not ready.

## 35.2 Diagnosis

Management model shows:

```text
WebModule state = STARTING
Datasource resource unavailable
```

## 35.3 Fix

Add readiness check that verifies app-level readiness, not just process alive.

## 35.4 Alert

Alert if module stuck in non-running state > threshold.

## 35.5 Lesson

Container orchestration state and app server internal state are different layers.

---

# 36. Case Study 3: Remote Management Endpoint Terbuka

## 36.1 Problem

Remote management/JMX endpoint exposed to broad network.

Weak credentials.

## 36.2 Risk

Attacker may:

- read server internals;
- invoke operations;
- deploy/stop apps;
- access sensitive config.

## 36.3 Fix

- close public access;
- private network/VPN;
- rotate credentials;
- enable TLS;
- least privilege;
- audit;
- scan for exposure.

## 36.4 Long-term

Use secure observability exporters instead of broad admin access.

## 36.5 Lesson

Management API is control plane. Treat it as critical asset.

---

# 37. Case Study 4: Migrasi Operasional dari MEJB/JMX ke OpenTelemetry

## 37.1 Context

Old monitoring polls MEJB/JMX every minute.

New platform uses Kubernetes + OpenTelemetry.

## 37.2 Migration steps

1. Inventory old metrics/states.
2. Classify signals:
   - inventory;
   - lifecycle state;
   - health;
   - metrics;
   - alerts.
3. Map to:
   - readiness/liveness;
   - Prometheus metrics;
   - OpenTelemetry traces/metrics/logs;
   - Kubernetes events.
4. Build parity dashboard.
5. Run both systems temporarily.
6. Decommission old polling.

## 37.3 Key insight

Not every management attribute should become metric.

Only export actionable signals.

## 37.4 Lesson

Modernization is semantic mapping, not only API replacement.

---

# 38. Latihan Bertahap

## Latihan 1 — Read Jakarta Management API docs

Identify the three main interfaces in `javax.management.j2ee`.

## Latihan 2 — Explore JMX local MBeans

Use `ManagementFactory.getPlatformMBeanServer()`.

List ObjectNames.

## Latihan 3 — Query JVM MBeans

Read memory/thread/GC attributes.

## Latihan 4 — Vendor MBeans

Run an app server and list vendor-specific MBeans.

## Latihan 5 — Build inventory snapshot

Create DTO:

```text
server, app, module, state
```

## Latihan 6 — Export metric

Convert state to Prometheus/OpenTelemetry-like metric.

## Latihan 7 — Security review

Write threat model for remote management endpoint.

## Latihan 8 — Polling load

Benchmark safe polling interval.

## Latihan 9 — Runbook

Write runbook for app module failed state.

## Latihan 10 — Migration map

Map legacy management dashboard to modern metrics/traces/logs.

---

# 39. Mini Project: Jakarta Management Legacy Observability Lab

## 39.1 Goal

Create:

```text
jakarta-management-legacy-observability-lab/
```

## 39.2 Modules

```text
api-overview/
local-jmx-explorer/
vendor-mbean-explorer/
inventory-model/
state-normalizer/
metrics-exporter/
security-review/
polling-strategy/
runbook/
modernization-map/
```

## 39.3 Deliverables

```text
README.md
JAKARTA-MANAGEMENT-MENTAL-MODEL.md
MEJB.md
JSR77-MANAGED-OBJECTS.md
JMX-BRIDGE.md
SECURITY.md
POLLING.md
OBSERVABILITY-BRIDGE.md
FAILURE-MODES.md
MIGRATION.md
```

## 39.4 Required experiments

1. Inspect Jakarta Management API.
2. List local JVM MBeans.
3. Query attributes.
4. Normalize ObjectName to inventory model.
5. Export simple metric.
6. Simulate state transition.
7. Threat model remote management.
8. Test polling interval.
9. Write incident runbook.
10. Design OpenTelemetry migration.

## 39.5 Evaluation questions

1. What is Jakarta Management?
2. What is MEJB?
3. Why is package still `javax.management.j2ee`?
4. What is JSR-77?
5. Difference Jakarta Management and JMX?
6. Why do app developers rarely use it?
7. Why is remote management high risk?
8. Why is Running not equal to Healthy?
9. How would you bridge legacy management to metrics?
10. What replaces Jakarta Management in cloud-native operations?

---

# 40. Referensi Resmi

Referensi utama:

1. Jakarta Management 1.1  
   https://jakarta.ee/specifications/management/1.1/

2. Jakarta Management 1.1 Specification  
   https://jakarta.ee/specifications/management/1.1/jakarta-management-spec-1.1

3. Jakarta Management 1.1 API Docs  
   https://jakarta.ee/specifications/management/1.1/apidocs/

4. API Docs — package `javax.management.j2ee`  
   https://jakarta.ee/specifications/management/1.1/apidocs/javax/management/j2ee/package-summary

5. Maven Central — `jakarta.management.j2ee-api`  
   https://central.sonatype.com/artifact/jakarta.management.j2ee/jakarta.management.j2ee-api

6. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

7. Java Management Extensions / JMX Guide  
   https://docs.oracle.com/javase/8/docs/technotes/guides/management/

8. Java Platform MBeanServer API  
   https://docs.oracle.com/en/java/javase/21/docs/api/java.management/javax/management/MBeanServer.html

9. OpenTelemetry  
   https://opentelemetry.io/

10. MicroProfile Metrics  
    https://microprofile.io/specifications/metrics/

---

# Penutup

Jakarta Management adalah spesifikasi management model historis untuk Jakarta EE / Java EE servers.

Mental model ringkas:

```text
Jakarta EE server
  ↓ exposes managed object model
MEJB / JMX-like management API
  ↓ attributes / operations / notifications
management tool
  ↓ inventory, state, operations
```

Konsep inti:

```text
MEJB:
  Management Enterprise Bean

Management:
  interface to navigate/manipulate managed objects

ManagementHome:
  old EJB home interface

ListenerRegistration:
  listener registration for management events

Managed objects:
  server, application, module, component, resource
```

Konteks modern penting:

```text
Jakarta Management 1.1 adalah initial Jakarta release untuk Jakarta EE 8.
Package API tetap javax.management.j2ee.
Jakarta EE 11 release page tidak mencantumkan Jakarta Management sebagai platform spec modern.
```

Jadi perlakukan sebagai:

```text
legacy/tooling/vendor-dependent management model
```

bukan API utama untuk aplikasi baru.

Prinsip paling penting:

```text
Management APIs are control-plane APIs.
Secure them like production infrastructure.
```

Engineer top-tier tahu bahwa observability modern tidak cukup hanya “server running”. Ia membedakan management state, health, metrics, traces, logs, deployment state, Kubernetes state, dan business readiness. Ia juga tahu kapan harus memakai legacy JSR-77/JMX/vendor API, dan bagaimana memigrasikannya ke OpenTelemetry/Prometheus/Kubernetes secara aman.

Bagian berikutnya akan membahas **Jakarta Managed Beans (`jakarta.annotation.ManagedBean` legacy / Managed Beans spec)**: historical managed bean model, why CDI replaced it, Jakarta EE 11 removal/deprecation context, migration to CDI, lifecycle annotations, injection differences, and how to reason about old code that still uses Managed Beans concepts.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-035.md">⬅️ Bagian 35 — Jakarta Deployment (`javax.enterprise.deploy` / `jakarta.enterprise.deploy-api`): Deployment SPI, Tooling Contract, TargetModuleID, ProgressObject, dan Relevansi Modern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-037.md">Bagian 37 — Jakarta Managed Beans / Legacy Managed Beans: `@ManagedBean`, Container-Managed POJO, Faces Managed Bean, dan Migrasi ke CDI ➡️</a>
</div>
