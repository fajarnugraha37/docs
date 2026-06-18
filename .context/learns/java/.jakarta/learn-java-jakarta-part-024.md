# learn-java-jakarta-part-024.md

# Bagian 24 — Jakarta Connectors (`jakarta.resource`): Resource Adapter, EIS Integration, Connection Management, XA, dan Message Inflow

> Target pembaca: Java engineer yang ingin memahami Jakarta Connectors / JCA bukan sebagai spesifikasi “jarang dipakai”, tetapi sebagai fondasi **enterprise integration antara application server dan Enterprise Information Systems (EIS)**: ERP, mainframe, transaction processor, messaging provider, file transfer gateway, proprietary protocol, dan sistem legacy.
>
> Fokus bagian ini: Jakarta Connectors 2.1, `jakarta.resource.*`, resource adapter, RAR packaging, outbound/inbound communication, connection pooling, transaction enlistment, XA, security contract, work management, message inflow, activation spec, administered objects, CCI, failure modes, dan kapan seorang application engineer perlu peduli walaupun tidak menulis resource adapter sendiri.

---

## Daftar Isi

1. [Orientasi: Kenapa Jakarta Connectors Masih Penting?](#1-orientasi-kenapa-jakarta-connectors-masih-penting)
2. [Mental Model: Resource Adapter sebagai Driver Enterprise](#2-mental-model-resource-adapter-sebagai-driver-enterprise)
3. [Jakarta Connectors 2.1 dalam Jakarta EE 11](#3-jakarta-connectors-21-dalam-jakarta-ee-11)
4. [Application Developer vs Resource Adapter Developer](#4-application-developer-vs-resource-adapter-developer)
5. [Jakarta Connectors vs JDBC Driver vs JMS Provider vs Custom Client Library](#5-jakarta-connectors-vs-jdbc-driver-vs-jms-provider-vs-custom-client-library)
6. [Dependency, Runtime, dan Packaging](#6-dependency-runtime-dan-packaging)
7. [Peta Package `jakarta.resource`](#7-peta-package-jakartaresource)
8. [Enterprise Information System / EIS](#8-enterprise-information-system--eis)
9. [Resource Adapter / RAR](#9-resource-adapter--rar)
10. [System Contracts: Gambaran Besar](#10-system-contracts-gambaran-besar)
11. [Lifecycle Management Contract](#11-lifecycle-management-contract)
12. [Connection Management Contract](#12-connection-management-contract)
13. [Connection Pooling dan Managed Connection](#13-connection-pooling-dan-managed-connection)
14. [`ManagedConnectionFactory`, `ManagedConnection`, `ConnectionFactory`, Connection Handle](#14-managedconnectionfactory-managedconnection-connectionfactory-connection-handle)
15. [Connection Sharing, Matching, dan Association](#15-connection-sharing-matching-dan-association)
16. [Transaction Management Contract](#16-transaction-management-contract)
17. [Local Transaction vs XA Transaction](#17-local-transaction-vs-xa-transaction)
18. [Security Contract](#18-security-contract)
19. [Work Management Contract](#19-work-management-contract)
20. [Generic Work Context dan Security Work Context](#20-generic-work-context-dan-security-work-context)
21. [Message Inflow Contract](#21-message-inflow-contract)
22. [Activation Spec dan Message Endpoint](#22-activation-spec-dan-message-endpoint)
23. [Transaction Inflow Contract](#23-transaction-inflow-contract)
24. [Common Client Interface / CCI](#24-common-client-interface--cci)
25. [Administered Objects](#25-administered-objects)
26. [Deployment Descriptor dan Annotation](#26-deployment-descriptor-dan-annotation)
27. [Outbound Resource Adapter: Aplikasi Memanggil EIS](#27-outbound-resource-adapter-aplikasi-memanggil-eis)
28. [Inbound Resource Adapter: EIS Memanggil Aplikasi](#28-inbound-resource-adapter-eis-memanggil-aplikasi)
29. [Bi-Directional Resource Adapter](#29-bi-directional-resource-adapter)
30. [JMS Provider sebagai Resource Adapter](#30-jms-provider-sebagai-resource-adapter)
31. [Jakarta Mail dan JDBC dalam Mental Model Connector](#31-jakarta-mail-dan-jdbc-dalam-mental-model-connector)
32. [XA, 2PC, Recovery, dan Heuristic Outcome](#32-xa-2pc-recovery-dan-heuristic-outcome)
33. [Connection Pool Tuning](#33-connection-pool-tuning)
34. [Threading dan WorkManager](#34-threading-dan-workmanager)
35. [Security Mapping dan Credential Management](#35-security-mapping-dan-credential-management)
36. [Error Handling, Retry, dan Idempotency](#36-error-handling-retry-dan-idempotency)
37. [Observability dan Operations](#37-observability-dan-operations)
38. [Testing Strategy](#38-testing-strategy)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices dan Anti-Patterns](#40-best-practices-dan-anti-patterns)
41. [Checklist Review](#41-checklist-review)
42. [Case Study 1: Resource Adapter untuk Mainframe Transaction Processor](#42-case-study-1-resource-adapter-untuk-mainframe-transaction-processor)
43. [Case Study 2: JMS Resource Adapter dan MDB](#43-case-study-2-jms-resource-adapter-dan-mdb)
44. [Case Study 3: XA Failure dan In-Doubt Transaction](#44-case-study-3-xa-failure-dan-in-doubt-transaction)
45. [Case Study 4: Pool Exhaustion pada Adapter ERP](#45-case-study-4-pool-exhaustion-pada-adapter-erp)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Jakarta Connectors Architecture Lab](#47-mini-project-jakarta-connectors-architecture-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Kenapa Jakarta Connectors Masih Penting?

Banyak Java developer tidak pernah menulis resource adapter.

Namun Jakarta Connectors tetap penting karena banyak enterprise system tidak berkomunikasi hanya lewat REST dan JDBC.

Contoh sistem enterprise:

- ERP;
- mainframe;
- transaction processing system;
- financial switch;
- message broker;
- proprietary queue;
- legacy government system;
- file transfer gateway;
- enterprise directory/integration platform;
- card/payment network;
- custom TCP protocol;
- vendor-specific EIS.

Jakarta Connectors menjawab pertanyaan:

```text
Bagaimana application server Jakarta EE berintegrasi dengan EIS secara standard,
termasuk connection pooling, transaction, security, lifecycle, threading, dan inbound message delivery?
```

## 1.1 Masalah jika integrasi EIS dibuat manual

Misal aplikasi langsung membuat client proprietary:

```java
LegacyClient client = new LegacyClient(host, port, username, password);
client.connect();
client.call(...);
```

Masalah production:

- connection pooling manual;
- reconnection manual;
- credential management manual;
- transaction enlistment tidak standar;
- XA/recovery sulit;
- thread management kacau;
- resource leak;
- classloader leak;
- server shutdown tidak tertib;
- monitoring tidak terintegrasi;
- inbound event dari EIS sulit masuk ke MDB/component;
- failover/recovery vendor-specific.

Resource adapter menstandardisasi integrasi itu.

## 1.2 Connector adalah “driver enterprise”

Seperti JDBC driver membuat database dapat diakses via standard pattern, resource adapter membuat EIS dapat diakses via Jakarta EE application server.

Mental model:

```text
JDBC driver:
  Java app ↔ database

Resource adapter:
  Jakarta EE server ↔ EIS
```

## 1.3 Kenapa top-tier engineer perlu tahu?

Karena di enterprise, banyak issue production muncul di lapisan:

- pool penuh;
- connection stale;
- XA recovery stuck;
- MDB tidak menerima pesan;
- activation spec salah;
- credential mapping salah;
- thread resource adapter liar;
- transaction imported dari EIS gagal;
- in-doubt transaction;
- resource adapter tidak stop saat undeploy;
- vendor RA classloader conflict.

Walaupun kamu tidak menulis resource adapter, kamu mungkin mengoperasikan, mengkonfigurasi, men-debug, atau memigrasikan aplikasi yang memakai resource adapter.

---

# 2. Mental Model: Resource Adapter sebagai Driver Enterprise

Resource adapter adalah komponen system-level yang plug into application server.

Ia berperan sebagai jembatan antara:

```text
Jakarta EE Application Server
```

and:

```text
Enterprise Information System / EIS
```

## 2.1 Resource adapter melakukan apa?

Resource adapter dapat menyediakan:

- outbound connectivity;
- inbound connectivity;
- connection pooling integration;
- transaction enlistment;
- security credential mapping;
- work submission to container;
- message inflow to endpoints;
- transaction inflow;
- lifecycle integration;
- administered object definitions.

## 2.2 Application server melakukan apa?

Application server menyediakan:

- deployment lifecycle;
- thread pool;
- transaction manager;
- security manager/context;
- pooling infrastructure;
- naming/JNDI;
- MDB/message endpoint management;
- monitoring;
- recovery.

## 2.3 EIS melakukan apa?

EIS adalah external enterprise system yang menjadi target integrasi.

Contoh:

```text
ERP system
Mainframe
Messaging provider
TP monitor
Legacy transaction system
```

## 2.4 Resource adapter bukan business service

Resource adapter adalah infrastructure integration layer.

Business logic tetap di aplikasi.

Bad:

```text
Resource adapter decides business approval workflow
```

Good:

```text
Resource adapter exposes reliable EIS operation
Application service applies business workflow
```

## 2.5 Resource adapter berada di address space server

Biasanya RA berjalan di dalam application server process/classloader environment.

Implikasi:

- resource leak RA memengaruhi server;
- thread RA memengaruhi server;
- connection RA memengaruhi server;
- classloader RA penting saat deploy/undeploy.

---

# 3. Jakarta Connectors 2.1 dalam Jakarta EE 11

Jakarta EE 11 Platform mencantumkan Connectors 2.1 sebagai bagian dari Platform.

Jakarta Connectors 2.1 sendiri adalah release yang awalnya ditargetkan untuk Jakarta EE 10 dan merupakan update minor dengan bug fixes, documentation cleanup, dan Java SE 11 baseline.

## 3.1 Apa yang didefinisikan?

Jakarta Connectors mendefinisikan standard architecture untuk Jakarta EE application components berhubungan dengan Enterprise Information Systems.

Secara umum spesifikasi mendefinisikan:

- system-level contracts antara application server dan EIS;
- Common Client Interface / CCI;
- deployment dan packaging protocol untuk resource adapter.

## 3.2 System-level contracts utama

Contracts penting:

- lifecycle management;
- connection management;
- transaction management;
- security;
- work management;
- generic work context;
- security work context;
- message inflow;
- transaction inflow.

## 3.3 Namespace

Modern package:

```java
jakarta.resource
jakarta.resource.cci
jakarta.resource.spi
jakarta.resource.spi.endpoint
jakarta.resource.spi.security
jakarta.resource.spi.work
```

Old Java EE:

```java
javax.resource
```

## 3.4 Jakarta Connectors bukan Web Profile

Connectors masuk Platform, bukan Web Profile.

Artinya runtime Web Profile ringan belum tentu mendukung Connectors penuh.

## 3.5 Siapa target audience?

Target audience meliputi:

- EIS vendors;
- resource adapter providers;
- messaging system vendors;
- application server vendors;
- enterprise application developers;
- system integrators;
- enterprise tools/EAI vendors.

Application developer biasanya konsumsi RA, bukan menulis RA.

---

# 4. Application Developer vs Resource Adapter Developer

## 4.1 Application developer

Biasanya menggunakan resource yang sudah disediakan:

```java
@Resource(lookup = "eis/LegacyConnectionFactory")
LegacyConnectionFactory factory;
```

atau menggunakan JMS/MDB yang provider-nya diintegrasikan via RA.

Tugas application developer:

- memakai connection factory;
- menutup connection handle;
- memahami transaction boundary;
- handle exception;
- desain retry/idempotency;
- monitoring business flow;
- konfigurasi resource lookup;
- tidak mengakali pool/container.

## 4.2 Resource adapter developer

Menulis implementasi:

- `ResourceAdapter`;
- `ManagedConnectionFactory`;
- `ManagedConnection`;
- `ConnectionEventListener`;
- `ActivationSpec`;
- endpoint delivery;
- work management;
- XA/local transaction integration;
- security credential handling.

Ini jauh lebih rendah dan kompleks.

## 4.3 System integrator

Mengkonfigurasi:

- RAR deployment;
- connection pool;
- endpoint activation;
- credentials;
- TLS;
- transaction mode;
- recovery;
- administered objects;
- classloading;
- monitoring.

## 4.4 Top-tier skill

Kamu harus tahu layer mana yang sedang kamu sentuh.

```text
Business bug?
Application code.

Connection leak?
Application usage or RA implementation.

Pool tuning?
Runtime config.

XA recovery stuck?
Transaction manager + RA + EIS.

Message not delivered to MDB?
Activation spec + RA inbound + endpoint.
```

---

# 5. Jakarta Connectors vs JDBC Driver vs JMS Provider vs Custom Client Library

## 5.1 JDBC Driver

JDBC driver menghubungkan Java app ke database.

JDBC punya spesifikasi sendiri.

Namun secara mental, JDBC driver mirip resource adapter:

- external resource;
- connection;
- pooling;
- transaction;
- security.

## 5.2 JMS Provider

JMS provider bisa dipasang ke app server via resource adapter, terutama untuk MDB/message inflow.

## 5.3 Custom client library

Custom library langsung dipakai aplikasi.

Pros:

- sederhana;
- cepat dibuat;
- cocok untuk microservice standalone.

Cons:

- pooling/transaction/security/lifecycle manual;
- tidak terintegrasi container;
- inbound EIS lebih sulit.

## 5.4 Resource adapter

Pros:

- container-managed;
- pooling;
- transaction enlistment;
- XA;
- security mapping;
- lifecycle;
- inbound message endpoint;
- vendor integration.

Cons:

- kompleks;
- app-server specific operational work;
- deployment/config overhead;
- harder to build/test;
- less common in lightweight microservices.

## 5.5 Decision table

| Need | Prefer |
|---|---|
| Simple HTTP API client | normal HTTP client |
| Database access | JDBC/JPA |
| Standard JMS messaging | Jakarta Messaging/provider |
| EIS with app server pooling/transaction/inbound | Resource adapter |
| Proprietary EIS used by many Jakarta apps | Resource adapter |
| Microservice direct cloud SDK | SDK/client library may be enough |
| XA integration with EIS | Resource adapter with XA |
| EIS pushes work to MDB | Resource adapter message inflow |

---

# 6. Dependency, Runtime, dan Packaging

## 6.1 Maven API dependency

```xml
<dependency>
  <groupId>jakarta.resource</groupId>
  <artifactId>jakarta.resource-api</artifactId>
  <version>2.1.0</version>
  <scope>provided</scope>
</dependency>
```

Use `provided` when deployed to Jakarta EE Platform runtime.

## 6.2 API jar bukan resource adapter

`jakarta.resource-api` hanya API.

Kamu tetap butuh:

- resource adapter implementation;
- RAR file;
- server configuration;
- EIS endpoint;
- credentials;
- transaction/security configuration.

## 6.3 RAR packaging

Resource adapter dikemas sebagai:

```text
something.rar
```

RAR dapat:

- deployed standalone ke server;
- contained inside EAR;
- configured as server resource.

## 6.4 Application packaging

Aplikasi biasanya memakai resource via JNDI lookup/injection.

```text
app.war / app.ear
  uses connection factory / administered object
```

## 6.5 Runtime support

Butuh Jakarta EE Platform/runtime yang mendukung Connectors.

Tidak semua runtime ringan menyediakan JCA/Connectors penuh.

## 6.6 Vendor-specific config

Walaupun API standard, konfigurasi sering vendor-specific:

- pool size;
- RA deployment command;
- credential store;
- recovery config;
- classloader isolation;
- activation spec properties;
- monitoring names.

Document operational config.

---

# 7. Peta Package `jakarta.resource`

## 7.1 `jakarta.resource`

Core exceptions/interfaces untuk resource API.

Contoh:

- `ResourceException`;
- `NotSupportedException`;
- `Referenceable`.

## 7.2 `jakarta.resource.cci`

Common Client Interface.

Contoh:

- `Connection`;
- `ConnectionFactory`;
- `Interaction`;
- `Record`;
- `RecordFactory`;
- `ConnectionSpec`.

## 7.3 `jakarta.resource.spi`

SPI untuk resource adapter dan system contracts.

Contoh:

- `ResourceAdapter`;
- `ManagedConnectionFactory`;
- `ManagedConnection`;
- `ConnectionManager`;
- `ConnectionRequestInfo`;
- `ManagedConnectionMetaData`;
- `ConnectionEvent`;
- `ActivationSpec`;
- annotations such as `@Connector`, `@ConnectionDefinition`, `@AdministeredObjectDefinition`.

## 7.4 `jakarta.resource.spi.endpoint`

Message endpoint contract.

Contoh:

- `MessageEndpoint`;
- `MessageEndpointFactory`.

## 7.5 `jakarta.resource.spi.security`

Security credential support.

Contoh:

- `PasswordCredential`;
- `GenericCredential`.

## 7.6 `jakarta.resource.spi.work`

Work management.

Contoh:

- `Work`;
- `WorkManager`;
- `WorkContext`;
- `ExecutionContext`;
- `WorkListener`;
- `WorkEvent`.

## 7.7 Mental map

```text
Application-facing:
  jakarta.resource.cci

Adapter/container-facing:
  jakarta.resource.spi
  jakarta.resource.spi.work
  jakarta.resource.spi.endpoint
  jakarta.resource.spi.security
```

---

# 8. Enterprise Information System / EIS

EIS adalah enterprise system di luar application server.

## 8.1 Contoh EIS

- ERP;
- CRM;
- mainframe;
- CICS-like transaction system;
- banking switch;
- payment gateway;
- message broker;
- document management system;
- file transfer gateway;
- legacy government system;
- proprietary middleware.

## 8.2 EIS characteristics

EIS sering punya:

- protocol proprietary;
- transaction model sendiri;
- credential/identity model sendiri;
- connection/session expensive;
- stateful connection;
- strict throughput limits;
- batch windows;
- old error codes;
- operational constraints.

## 8.3 EIS integration pain

Tanpa adapter:

- setiap app menulis integration sendiri;
- credential tersebar;
- pool tidak standar;
- retry inconsistent;
- transaction tidak atomic;
- monitoring tidak seragam.

## 8.4 Resource adapter as standard integration

Resource adapter membuat EIS terlihat seperti managed resource di Jakarta EE.

---

# 9. Resource Adapter / RAR

## 9.1 Apa itu resource adapter?

Resource adapter adalah Jakarta EE component yang mengimplementasikan Jakarta Connectors API untuk EIS tertentu.

## 9.2 RAR file

RAR = Resource Adapter Archive.

Structure concept:

```text
legacy-eis.rar
  META-INF/ra.xml
  adapter-classes.jar
  vendor-libs.jar
```

## 9.3 Deployment

RAR bisa deployed:

- standalone;
- inside EAR;
- as server-level shared adapter.

## 9.4 Descriptor

`ra.xml` mendeskripsikan:

- adapter class;
- connection definitions;
- transaction support;
- authentication mechanism;
- message listeners;
- activation spec;
- administered objects;
- config properties.

## 9.5 Annotation

Modern RA can use annotations such as:

```java
@Connector
@ConnectionDefinition
@AdministeredObjectDefinition
```

## 9.6 Versioning

Adapter version matters.

Changing RA can change:

- connection behavior;
- recovery behavior;
- error mapping;
- transaction behavior;
- performance.

Treat RA upgrade like infrastructure upgrade.

---

# 10. System Contracts: Gambaran Besar

Jakarta Connectors defines system-level contracts between application server and resource adapter.

## 10.1 Why contracts?

Because app server and EIS vendor need standard collaboration model.

Without contract:

```text
Every adapter must invent its own integration with every server.
```

This is the m × n integration problem.

## 10.2 Major contracts

```text
Lifecycle Management:
  start/stop adapter

Connection Management:
  pooling, allocation, cleanup

Transaction Management:
  local/XA transaction participation

Security:
  credential propagation/mapping

Work Management:
  adapter asks server for threads

Generic Work Context:
  contextual information from EIS

Security Work Context:
  identity propagation from EIS

Message Inflow:
  EIS/provider delivers messages to server endpoints

Transaction Inflow:
  external transaction imported into server
```

## 10.3 Application developer relevance

Even if you only use:

```java
connectionFactory.getConnection()
```

these contracts determine production behavior.

---

# 11. Lifecycle Management Contract

Lifecycle contract allows application server to manage RA lifecycle.

## 11.1 ResourceAdapter interface

Conceptual methods:

```java
public interface ResourceAdapter {
    void start(BootstrapContext ctx) throws ResourceAdapterInternalException;
    void stop();
    void endpointActivation(MessageEndpointFactory endpointFactory, ActivationSpec spec) throws ResourceException;
    void endpointDeactivation(MessageEndpointFactory endpointFactory, ActivationSpec spec);
    XAResource[] getXAResources(ActivationSpec[] specs) throws ResourceException;
}
```

## 11.2 Start

At deployment/server startup:

```text
server instantiates RA
server calls start(BootstrapContext)
```

RA can obtain:

- `WorkManager`;
- `XATerminator`;
- timer/context facilities.

## 11.3 Stop

At undeploy/orderly shutdown:

```text
server calls stop()
```

RA must:

- stop listeners;
- release connections;
- stop work;
- close sockets;
- cleanup timers;
- avoid thread leak.

## 11.4 Endpoint activation/deactivation

For inbound messaging:

```text
endpointActivation(...)
endpointDeactivation(...)
```

registers/unregisters message endpoints.

## 11.5 Failure mode

If RA ignores stop, redeploy leaks:

- threads;
- sockets;
- classloader;
- credentials;
- memory.

---

# 12. Connection Management Contract

Connection management contract lets app server pool and manage physical EIS connections.

## 12.1 Why pooling?

EIS connections can be expensive.

Pooling improves:

- scalability;
- latency;
- resource control;
- monitoring;
- throttling.

## 12.2 Logical vs physical connection

Application sees logical connection handle.

Container/RA manages physical managed connection.

```text
Application Connection Handle
  ↓
ManagedConnection
  ↓
Physical EIS connection/session
```

## 12.3 Allocation flow

```text
app asks connectionFactory.getConnection()
  ↓
connection factory delegates to ConnectionManager
  ↓
server pool finds/creates ManagedConnection
  ↓
RA creates logical connection handle
  ↓
app uses handle
```

## 12.4 Close behavior

Application calls:

```java
connection.close();
```

But physical connection is usually returned to pool, not necessarily closed.

## 12.5 Connection leak

If application does not close handle, pool can exhaust.

Use try-with-resources if API supports.

## 12.6 Matching

Pool must match connection request to appropriate managed connection based on:

- user credential;
- connection request info;
- transaction context;
- EIS target;
- configuration.

---

# 13. Connection Pooling dan Managed Connection

## 13.1 ManagedConnection

`ManagedConnection` represents physical connection to EIS under container/RA management.

It supports:

- cleanup;
- destroy;
- associateConnection;
- local transaction;
- XA resource;
- metadata;
- event listeners.

## 13.2 Connection handle

Connection handle is what application uses.

It delegates to ManagedConnection.

## 13.3 ConnectionEventListener

Container listens for:

- connection closed;
- error occurred;
- local transaction started/committed/rolled back.

## 13.4 Cleanup

When handle closes, container may call cleanup before returning to pool.

RA must clear state.

## 13.5 Destroy

Physical connection destroyed when invalid/stale/shutdown.

## 13.6 Pool config

Important settings:

- min pool size;
- max pool size;
- idle timeout;
- blocking timeout;
- validation;
- stale connection cleanup;
- retry/reconnect;
- statement/session cache if relevant.

## 13.7 Pool exhaustion symptoms

- requests hang;
- timeout waiting for connection;
- thread pool fills;
- error like “no managed connections available”;
- EIS max session reached.

---

# 14. `ManagedConnectionFactory`, `ManagedConnection`, `ConnectionFactory`, Connection Handle

## 14.1 ManagedConnectionFactory

`ManagedConnectionFactory` creates physical `ManagedConnection` instances and connection factories.

Conceptual responsibilities:

- hold EIS config;
- create connection factory;
- create managed connection;
- match managed connections;
- provide metadata;
- validate config.

## 14.2 ConnectionFactory

Application-facing factory.

Example conceptual:

```java
LegacyConnection connection = legacyConnectionFactory.getConnection();
```

## 14.3 ConnectionManager

Container-provided object that manages allocation/pooling.

If RA is used outside managed container, a default/simple connection manager may be needed.

## 14.4 ManagedConnection

Physical EIS connection.

## 14.5 Connection handle

Lightweight object returned to application.

Should not be shared across threads unless API says safe.

## 14.6 Separation matters

Bad application code often assumes:

```text
close() == physical disconnect
```

In managed environment:

```text
close() == return handle to pool
```

## 14.7 Application rule

Always close handle.

Never hold connection across long user think time.

---

# 15. Connection Sharing, Matching, dan Association

## 15.1 Connection sharing

Within same transaction/security context, container may share managed connection.

## 15.2 Matching

RA implements matching logic to determine if existing managed connection can satisfy new request.

Criteria can include:

- credential;
- connection spec;
- transaction;
- EIS endpoint;
- client info.

## 15.3 Association

`associateConnection` lets a logical handle be associated with a different managed connection.

Used by container for pooling optimization.

## 15.4 Wrong matching bug

If matching ignores credential, user A could use physical connection authenticated as user B.

Severe security issue.

## 15.5 Wrong association bug

If state not reset, one request inherits previous state.

Examples:

- tenant;
- locale;
- transaction mode;
- cursor;
- session variable.

## 15.6 Cleanup is critical

RA must cleanup connection state before returning to pool.

Application must close handle.

---

# 16. Transaction Management Contract

Transaction contract allows RA/EIS connections to participate in transactions coordinated by app server.

## 16.1 Transaction support levels

Resource adapter can support:

- NoTransaction;
- LocalTransaction;
- XATransaction.

## 16.2 NoTransaction

EIS operations are not transactional with server.

Good for read-only/non-critical operations.

## 16.3 LocalTransaction

One resource local transaction controlled by RA/EIS.

Cannot atomically coordinate with DB/JMS in same global transaction.

## 16.4 XATransaction

Resource can participate in distributed JTA transaction via XA.

## 16.5 Transaction enlistment

When application obtains connection inside JTA transaction, container can enlist RA's XAResource.

## 16.6 Commit/rollback

Transaction manager coordinates commit/rollback.

## 16.7 Application implication

If you rely on atomic DB + EIS operation, confirm:

- RA supports XA;
- EIS supports XA;
- server recovery configured;
- transaction timeout appropriate;
- ops team understands in-doubt recovery.

---

# 17. Local Transaction vs XA Transaction

## 17.1 Local transaction

```text
Begin EIS local transaction
perform EIS operations
commit/rollback EIS only
```

Cannot include database in same atomic transaction.

## 17.2 XA transaction

```text
Global JTA transaction
  includes DB XAResource
  includes EIS XAResource
2PC commit
```

## 17.3 XA benefit

Atomic across multiple resources.

## 17.4 XA cost

- two-phase commit overhead;
- recovery logs;
- heuristic outcomes;
- in-doubt transactions;
- vendor-specific bugs;
- operational complexity.

## 17.5 Alternative

For microservices/cloud-native:

- outbox;
- saga;
- idempotent retry;
- compensation;
- eventual consistency.

## 17.6 Decision rule

Use XA only if:

- strict atomicity required;
- resources support XA correctly;
- volume/performance acceptable;
- recovery is operationally mature.

---

# 18. Security Contract

Security contract handles authentication/authorization between app server and EIS.

## 18.1 Credential propagation

Application server can provide credentials to RA.

Examples:

- container-managed sign-on;
- component-managed sign-on;
- principal mapping;
- password credential;
- generic credential.

## 18.2 Container-managed sign-on

Container maps application caller/security identity to EIS credential.

## 18.3 Component-managed sign-on

Application supplies credential through connection spec.

## 18.4 PasswordCredential

`PasswordCredential` represents username/password credential.

## 18.5 Security mapping

Mapping examples:

```text
Jakarta principal fajar → EIS user FJAR01
role SYSTEM_SYNC → EIS service account SYNCAPP
```

## 18.6 Credential storage

Do not store EIS passwords in code.

Use:

- server credential store;
- vault;
- secrets manager;
- runtime config.

## 18.7 Failure mode

Wrong credential mapping can cause:

- access denied;
- wrong data visibility;
- audit attribution wrong;
- user A operation executed as user B;
- privilege escalation.

---

# 19. Work Management Contract

Work management lets resource adapter submit work to application server for execution.

## 19.1 Why?

RA may need to:

- monitor EIS endpoint;
- receive messages;
- poll socket;
- deliver inbound event;
- process protocol work.

Instead of creating its own unmanaged threads, RA uses server `WorkManager`.

## 19.2 WorkManager

`WorkManager` dispatches `Work` instances using app server managed threads.

Conceptual:

```java
workManager.scheduleWork(new Work() {
    public void run() { pollEis(); }
    public void release() { stop = true; }
});
```

## 19.3 Why not direct thread?

Because server wants control over:

- thread pool;
- shutdown;
- security;
- transaction context;
- monitoring;
- resource limits.

## 19.4 WorkListener

RA can listen to work lifecycle:

- accepted;
- rejected;
- started;
- completed.

## 19.5 ExecutionContext

Can carry transaction timeout/Xid-related info depending contract.

## 19.6 Application relevance

If RA's WorkManager threads are exhausted, inbound delivery may stop.

---

# 20. Generic Work Context dan Security Work Context

## 20.1 Generic Work Context

Allows RA to augment runtime context of Work submitted to app server.

## 20.2 Why context?

EIS may propagate contextual info:

- transaction context;
- security identity;
- tenant;
- correlation;
- locale;
- custom context.

## 20.3 Security Work Context

Allows RA to establish security information when executing Work or delivering message endpoint.

## 20.4 Principal propagation

EIS user/principal can be propagated to message endpoint.

## 20.5 Risk

Context propagation must be explicit and safe.

Wrong identity propagation causes audit/security failures.

## 20.6 Observability

Log incoming EIS identity/correlation safely.

Do not log credentials.

---

# 21. Message Inflow Contract

Message inflow lets RA asynchronously deliver messages to application server endpoints independent of messaging technology.

## 21.1 Why important?

It allows many message providers to plug into Jakarta EE server.

JMS provider can use RA to deliver to MDB.

## 21.2 Flow

```text
EIS/message provider receives message
  ↓
resource adapter receives/polls/listens
  ↓
resource adapter obtains MessageEndpoint from MessageEndpointFactory
  ↓
resource adapter invokes endpoint method
  ↓
container applies transaction/security/interceptor semantics
```

## 21.3 Message endpoint

Often MDB.

But contract is generic, not limited to JMS.

## 21.4 Endpoint activation

Container calls:

```text
endpointActivation(factory, activationSpec)
```

RA begins delivering messages for that endpoint.

## 21.5 Endpoint deactivation

Container calls:

```text
endpointDeactivation(factory, activationSpec)
```

RA must stop delivery.

## 21.6 Why generic?

Different messaging styles can plug in:

- JMS;
- proprietary queue;
- event system;
- inbound EIS protocol.

---

# 22. Activation Spec dan Message Endpoint

## 22.1 ActivationSpec

`ActivationSpec` contains configuration needed to activate inbound endpoint.

Examples:

- destination;
- subscription;
- selector;
- endpoint type;
- concurrency;
- acknowledgement/transaction mode;
- vendor-specific properties.

## 22.2 MDB activation config

Example JMS MDB:

```java
@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationLookup", propertyValue = "jms/CaseQueue"),
    @ActivationConfigProperty(propertyName = "destinationType", propertyValue = "jakarta.jms.Queue")
})
public class CaseMessageBean implements MessageListener {
    public void onMessage(Message message) { ... }
}
```

Behind the scenes, a JMS RA/provider may use activation spec.

## 22.3 MessageEndpointFactory

Container provides factory for RA to create endpoint instances.

## 22.4 MessageEndpoint

Endpoint instance is invoked by RA.

Container may wrap endpoint with:

- transaction;
- security;
- interceptor;
- classloader;
- lifecycle.

## 22.5 Delivery failure

If endpoint throws exception, RA/container must handle redelivery/rollback according to provider/transaction config.

## 22.6 Common problem

Wrong activation config means MDB never receives messages.

Check:

- destination name;
- JNDI lookup;
- selector;
- subscription name;
- connection factory;
- credentials;
- RA deployed;
- endpoint activated.

---

# 23. Transaction Inflow Contract

Transaction inflow allows RA to propagate imported transaction from EIS into application server.

## 23.1 Use case

External EIS starts distributed transaction and calls app server through RA.

RA imports transaction context so app work participates in that external transaction.

## 23.2 Flow

```text
EIS begins transaction
  ↓
EIS sends message/request with transaction context
  ↓
RA imports transaction
  ↓
RA submits work / delivers endpoint under imported transaction
  ↓
app server participates
  ↓
EIS drives completion/recovery
```

## 23.3 Why complex?

Application server acts like resource manager in transaction initiated externally.

Need:

- imported transaction context representation;
- association of Work with transaction;
- completion callbacks;
- crash recovery.

## 23.4 ACID preservation

Contract ensures ACID properties of imported transaction are preserved.

## 23.5 Application warning

Most application code should avoid depending on imported external transaction unless architecture demands it.

This is advanced enterprise integration.

## 23.6 Failure mode

Transaction inflow misconfiguration can create:

- in-doubt transaction;
- duplicate processing;
- rollback mismatch;
- resource lock retained;
- recovery failure.

---

# 24. Common Client Interface / CCI

CCI provides generic client API for EIS interactions.

## 24.1 Why CCI?

Goal: common way for tools/EAI systems to interact with multiple EIS through adapters.

## 24.2 CCI main abstractions

- `ConnectionFactory`;
- `Connection`;
- `Interaction`;
- `InteractionSpec`;
- `Record`;
- `MappedRecord`;
- `IndexedRecord`;
- `RecordFactory`;
- `ConnectionSpec`.

## 24.3 Example conceptual flow

```java
Connection connection = connectionFactory.getConnection();
Interaction interaction = connection.createInteraction();
Record input = recordFactory.createMappedRecord("request");
Record output = interaction.execute(interactionSpec, input);
connection.close();
```

## 24.4 Why less common today?

Modern applications often use typed SDK/client API rather than generic CCI.

But CCI remains useful for enterprise integration tooling.

## 24.5 CCI downside

Generic record API can be verbose and weakly typed.

## 24.6 Typed wrapper

Application should wrap CCI behind domain-specific gateway:

```java
interface LegacyCaseGateway {
    LegacyCaseStatus queryStatus(CaseId id);
}
```

not leak `MappedRecord` everywhere.

---

# 25. Administered Objects

Administered objects are configured objects provided to application.

Examples:

- connection factory;
- destination;
- queue/topic object;
- EIS-specific object.

## 25.1 Why administered?

Ops/runtime controls:

- physical EIS endpoint;
- credentials;
- pooling;
- security;
- transaction mode;
- vendor properties.

Application gets logical object via JNDI.

## 25.2 Injection

```java
@Resource(lookup = "eis/LegacyConnectionFactory")
LegacyConnectionFactory factory;
```

## 25.3 Naming

Use stable logical names:

```text
eis/MainframeConnectionFactory
eis/ErpOrderConnectionFactory
jms/CaseQueue
```

## 25.4 Avoid environment-specific names in code

Bad:

```text
eis/prod/mainframe-host-1
```

Better:

```text
eis/MainframeConnectionFactory
```

with server config mapping per environment.

## 25.5 Administered object lifecycle

Managed by app server, not application code.

---

# 26. Deployment Descriptor dan Annotation

## 26.1 `ra.xml`

Deployment descriptor for resource adapter.

Defines:

- adapter class;
- config properties;
- outbound connection definitions;
- transaction support;
- authentication mechanisms;
- inbound message listeners;
- activation spec;
- administered objects;
- security permissions.

## 26.2 Annotation model

Examples:

```java
@Connector
@ConnectionDefinition
@ConnectionDefinitions
@AdministeredObjectDefinition
@AdministeredObjectDefinitions
```

## 26.3 Descriptor vs annotation

Annotation:

- close to code;
- easier for adapter developer;
- less XML.

Descriptor:

- externalized;
- useful for deployment customization;
- familiar in enterprise ops.

## 26.4 Override

Deployment descriptors may override annotations depending rules.

## 26.5 Application developer

Usually sees server config/JNDI, not RA internals.

---

# 27. Outbound Resource Adapter: Aplikasi Memanggil EIS

Outbound means application initiates communication to EIS.

## 27.1 Flow

```text
Application component
  ↓ get connection from connection factory
Resource adapter
  ↓ physical protocol
EIS
```

## 27.2 Example use cases

- query mainframe record;
- submit ERP order;
- call transaction processor;
- send file transfer command;
- invoke legacy operation.

## 27.3 Application pattern

```java
@ApplicationScoped
public class LegacyCaseGateway {

    @Resource(lookup = "eis/LegacyConnectionFactory")
    LegacyConnectionFactory factory;

    public LegacyCaseStatus getStatus(CaseId id) {
        try (LegacyConnection c = factory.getConnection()) {
            return c.queryCaseStatus(id.value());
        }
    }
}
```

## 27.4 Gateway wrapper

Do not expose EIS API across domain.

Create gateway/adapter at infrastructure layer.

## 27.5 Transaction decision

If EIS call participates in transaction, document:

- local vs XA;
- timeout;
- retry;
- idempotency;
- compensation.

## 27.6 Timeout

Never allow EIS call to block indefinitely.

---

# 28. Inbound Resource Adapter: EIS Memanggil Aplikasi

Inbound means EIS initiates communication into application server.

## 28.1 Flow

```text
EIS event/message
  ↓
Resource adapter receives
  ↓
RA delivers to message endpoint/MDB
  ↓
Application processes
```

## 28.2 Use cases

- mainframe event delivered to MDB;
- proprietary message queue delivered to app;
- external transaction processor pushes work;
- file gateway notifies completion;
- EIS callback protocol.

## 28.3 Endpoint activation

Container tells RA which endpoints to activate.

## 28.4 Delivery semantics

Depend on RA/EIS:

- at-most-once;
- at-least-once;
- transactional delivery;
- ordered delivery;
- redelivery;
- DLQ.

Do not assume.

## 28.5 Idempotency

Inbound processing must be idempotent if duplicate possible.

## 28.6 Observability

Track inbound:

- received count;
- success/failure;
- redelivery;
- endpoint latency;
- transaction status;
- EIS message ID;
- correlation ID.

---

# 29. Bi-Directional Resource Adapter

RA can support both outbound and inbound communication.

## 29.1 Example

Messaging provider adapter:

- application sends messages outbound;
- provider delivers messages inbound to MDB.

## 29.2 Another example

ERP adapter:

- application submits commands;
- ERP sends status callbacks/events.

## 29.3 Complexity

Bi-directional RA must handle:

- outbound pool;
- inbound listeners;
- endpoint activation;
- transaction both ways;
- security mapping both ways;
- recovery;
- shutdown order.

## 29.4 Application design

Separate gateway interfaces:

```java
ErpCommandGateway
ErpEventConsumer
```

Do not mix command and event logic.

---

# 30. JMS Provider sebagai Resource Adapter

Jakarta Messaging provider often integrates with application server through resource adapter.

## 30.1 Why?

MDB needs message inflow.

RA provides standard contract for delivering messages to endpoints.

## 30.2 Flow

```text
JMS broker
  ↓
JMS resource adapter
  ↓
MessageEndpointFactory
  ↓
MDB.onMessage
```

## 30.3 Activation config

MDB activation properties configure destination/subscription/selector.

## 30.4 Transaction

Message delivery can be within JTA transaction.

If MDB fails/transaction rolls back, message can be redelivered.

## 30.5 XA

JMS RA can expose XAResource for distributed transaction.

## 30.6 Troubleshooting MDB

Check:

- RA deployed/started;
- broker connection;
- destination exists;
- activation spec correct;
- endpoint active;
- credentials;
- transaction config;
- redelivery/DLQ policy.

---

# 31. Jakarta Mail dan JDBC dalam Mental Model Connector

## 31.1 Jakarta Mail

Jakarta EE Tutorial notes Jakarta Mail can act like EIS access through resource adapter concept in server integration.

In practice, many servers expose mail session as managed resource.

## 31.2 JDBC

JDBC has its own API/spec and driver model, but connection pooling/transaction/security integration is conceptually similar.

## 31.3 Common pattern

For any external resource:

```text
managed factory
  ↓
logical handle
  ↓
pooled physical connection
  ↓
transaction/security integration
```

## 31.4 Unified mental model

Whether using DB, JMS, Mail, or EIS adapter, ask:

- who owns connection?
- who pools it?
- who closes it?
- who manages credentials?
- is it in transaction?
- what happens on failure?
- how monitored?

---

# 32. XA, 2PC, Recovery, dan Heuristic Outcome

## 32.1 XA resource

RA can provide `XAResource` for transaction manager.

## 32.2 Two-phase commit

Phase 1:

```text
prepare all resources
```

Phase 2:

```text
commit all prepared resources
```

or rollback.

## 32.3 Recovery

If crash happens after prepare, transaction manager must recover.

Need:

- transaction log;
- RA recovery config;
- EIS recovery access;
- stable resource identity.

## 32.4 In-doubt transaction

Resource prepared but final outcome unclear.

## 32.5 Heuristic outcome

Resource unilaterally commits/rolls back differently than coordinator decision.

Severe operational issue.

## 32.6 Why app developer cares

If you see:

```text
in-doubt
heuristic mixed
XA recovery failed
```

this is not normal application exception. It needs transaction manager/RA/EIS recovery procedure.

## 32.7 Use XA carefully

XA can be correct, but operationally expensive.

For many modern architectures, prefer outbox/saga unless strict atomic distributed transaction is required.

---

# 33. Connection Pool Tuning

## 33.1 Important settings

- min pool size;
- max pool size;
- initial pool size;
- idle timeout;
- blocking timeout;
- validation on borrow;
- validation interval;
- leak detection;
- retry/reconnect;
- flush strategy;
- transaction support;
- credential mapping.

## 33.2 Max pool size

Should reflect:

- EIS max sessions;
- app concurrency;
- transaction duration;
- downstream capacity;
- expected latency.

## 33.3 Too small

Symptoms:

- waiting for connection;
- request latency;
- timeouts;
- underutilized EIS.

## 33.4 Too large

Symptoms:

- EIS overload;
- license limit exceeded;
- memory/socket pressure;
- cascading failure.

## 33.5 Validation

Stale EIS connections are common.

Need validation/reconnect strategy.

## 33.6 Leak detection

Enable if available.

Application must close connection handles.

## 33.7 Observability

Monitor:

- active connections;
- idle connections;
- wait time;
- allocation failures;
- validation failures;
- EIS errors.

---

# 34. Threading dan WorkManager

## 34.1 RA should not freely create threads

App server wants to own threads for manageability.

## 34.2 WorkManager

RA submits `Work` to WorkManager.

## 34.3 Work types

- short running;
- long running;
- scheduled/periodic polling;
- inbound listener.

## 34.4 Thread starvation

If RA submits too much work, server thread resources can exhaust.

## 34.5 Work rejection

WorkManager can reject work if overloaded/shutting down.

RA must handle.

## 34.6 Application symptom

Inbound delivery stops or slows.

## 34.7 Tuning

Server may have work manager thread pool settings.

Monitor separately from servlet/request pool if available.

---

# 35. Security Mapping dan Credential Management

## 35.1 EIS credentials

Modes:

- shared service account;
- per-user credential mapping;
- delegated identity;
- certificate;
- token;
- Kerberos/SSO;
- custom credential.

## 35.2 Shared service account

Simpler but audit in EIS sees one account.

Use application audit to preserve caller.

## 35.3 Per-user mapping

Better audit but complex.

Needs:

- mapping store;
- credential vault;
- lifecycle;
- rotation;
- deprovisioning.

## 35.4 Principal propagation inbound

EIS principal can be propagated to message endpoint.

Application must validate/authorize appropriately.

## 35.5 Secrets

Never hardcode in RA/application.

## 35.6 Least privilege

EIS account should have minimum permissions.

## 35.7 Logging

Do not log:

- passwords;
- tokens;
- connection strings with secrets;
- full credential objects.

---

# 36. Error Handling, Retry, dan Idempotency

## 36.1 EIS errors

Can be:

- connection failure;
- timeout;
- authentication failure;
- authorization failure;
- business rejection;
- validation error;
- duplicate request;
- transaction rollback;
- protocol error;
- EIS unavailable.

## 36.2 Retry taxonomy

| Error | Retry? |
|---|---|
| transient network timeout | yes with backoff |
| EIS temporary unavailable | yes with backoff/circuit breaker |
| authentication failure | no until config fixed |
| validation error | no |
| duplicate request | idempotent success or no-op |
| transaction in-doubt | recovery workflow |
| pool exhaustion | backpressure/tune, not blind retry |

## 36.3 Idempotency

For outbound operations, include idempotency key if EIS supports.

If not, application must store request state and reconcile.

## 36.4 External side effect

EIS may perform side effect and connection fails before response received.

This creates ambiguous outcome.

Need:

- query-by-business-key;
- idempotency key;
- reconciliation job;
- manual repair.

## 36.5 Circuit breaker

If EIS down, stop hammering.

## 36.6 Timeout

Always configure timeouts.

No infinite blocking.

---

# 37. Observability dan Operations

## 37.1 Metrics

Monitor:

- connection pool active/idle/max;
- wait time;
- allocation failure;
- EIS call latency;
- EIS error rate;
- transaction enlistment failure;
- XA recovery failure;
- inbound message count;
- endpoint delivery failure;
- WorkManager queue/thread usage;
- activation status.

## 37.2 Logs

Include:

- correlation ID;
- EIS operation name;
- business key;
- transaction ID if safe;
- connection factory name;
- adapter name/version;
- error category;
- duration.

Do not log secrets.

## 37.3 Tracing

Wrap EIS calls in spans.

For inbound, create span from EIS message metadata/correlation if available.

## 37.4 Health checks

Health check should be careful.

Don't overload EIS with frequent expensive checks.

Use lightweight validation.

## 37.5 Runbook

Need runbook for:

- pool exhaustion;
- stale connection;
- RA redeploy;
- credential rotation;
- XA recovery;
- DLQ/inbound backlog;
- endpoint activation failure.

---

# 38. Testing Strategy

## 38.1 Application tests

Mock gateway for unit tests.

Do not require real EIS for domain tests.

## 38.2 Integration tests

Use:

- test EIS simulator;
- vendor test environment;
- embedded broker if JMS RA;
- container integration test.

## 38.3 RA developer tests

Test:

- connection allocation;
- matching;
- cleanup;
- destroy;
- local transaction;
- XA transaction;
- security mapping;
- endpoint activation;
- message inflow;
- work management;
- stop/redeploy.

## 38.4 Failure tests

Simulate:

- EIS down;
- connection stale;
- timeout;
- bad credentials;
- transaction rollback;
- crash during XA prepare;
- endpoint exception;
- pool exhaustion.

## 38.5 Load tests

Test realistic concurrency and EIS latency.

## 38.6 Recovery tests

If XA enabled, test crash recovery.

Do not enable XA without recovery test.

## 38.7 Contract tests

For EIS message/record formats, maintain contract tests.

---

# 39. Production Failure Modes

## 39.1 Connection leak

Cause:

- application does not close connection handle.

Symptoms:

- pool exhaustion;
- increasing active count;
- blocked threads.

## 39.2 Stale connection

Cause:

- EIS closes idle connection;
- firewall timeout;
- network reset.

Fix:

- validation;
- reconnect;
- idle timeout.

## 39.3 Wrong credential mapping

Cause:

- principal mapping config wrong.

Impact:

- access denied;
- wrong user audit;
- data leak.

## 39.4 XA recovery failure

Cause:

- recovery credentials wrong;
- RA not available;
- EIS lost prepared transaction;
- transaction log mismatch.

## 39.5 Inbound endpoint not activated

Cause:

- activation spec wrong;
- destination missing;
- RA not started;
- message listener type mismatch.

## 39.6 WorkManager exhaustion

Cause:

- RA submits too much work;
- blocking endpoint;
- EIS flood.

## 39.7 Thread leak on undeploy

Cause:

- RA creates unmanaged threads or fails stop.

## 39.8 Classloader conflict

Cause:

- RA bundles incompatible libs;
- app bundles same API/implementation;
- server shared library conflict.

## 39.9 Pool too large overloads EIS

Cause:

- max pool > EIS capacity.

## 39.10 Ambiguous outcome

Cause:

- EIS operation committed but response lost.

Need reconciliation/idempotency.

## 39.11 Transaction timeout

Cause:

- EIS call slow inside JTA transaction.

## 39.12 Shutdown hangs

Cause:

- RA stop does not terminate work/socket.

---

# 40. Best Practices dan Anti-Patterns

## 40.1 Best practices

- Wrap EIS access behind application gateway.
- Always close connection handles.
- Configure pool size based on EIS capacity.
- Set timeouts.
- Classify EIS errors.
- Design idempotency for side effects.
- Monitor pool and EIS latency.
- Use XA only when necessary and tested.
- Prefer outbox/saga for modern distributed workflows where suitable.
- Keep credentials in secure store.
- Test RA behavior on target runtime.
- Document activation specs and JNDI names.
- Monitor inbound endpoint activation and failures.
- Have XA recovery runbook if XA enabled.

## 40.2 Anti-pattern: EIS client everywhere

Bad:

```text
controllers/services directly use low-level EIS connection
```

Good:

```text
infrastructure gateway wraps EIS adapter
```

## 40.3 Anti-pattern: No close

Connection handle leak.

## 40.4 Anti-pattern: Blind retry

Can duplicate EIS side effects.

## 40.5 Anti-pattern: XA without recovery procedure

XA without tested recovery is operational risk.

## 40.6 Anti-pattern: Pool max equals app thread count blindly

EIS may not handle it.

## 40.7 Anti-pattern: Business logic in RA

RA is infrastructure.

## 40.8 Anti-pattern: Rely on queue/inbound exactly-once

Design idempotent endpoints.

---

# 41. Checklist Review

## 41.1 Architecture

- [ ] Is resource adapter actually needed?
- [ ] EIS integration boundary clear?
- [ ] Gateway abstraction exists?
- [ ] Outbound/inbound/bidirectional identified?
- [ ] Transaction model documented?
- [ ] Security model documented?

## 41.2 Connection

- [ ] Pool size configured?
- [ ] Timeout configured?
- [ ] Validation configured?
- [ ] Connection handles closed?
- [ ] Leak detection available?
- [ ] EIS capacity known?

## 41.3 Transaction

- [ ] NoTransaction/Local/XA known?
- [ ] XA tested if used?
- [ ] Recovery config complete?
- [ ] Transaction timeout correct?
- [ ] In-doubt runbook exists?

## 41.4 Security

- [ ] Credentials not hardcoded?
- [ ] Credential mapping correct?
- [ ] Least privilege?
- [ ] Rotation process?
- [ ] No secrets in logs?

## 41.5 Inbound

- [ ] Activation spec correct?
- [ ] Endpoint active?
- [ ] Redelivery semantics known?
- [ ] Idempotency implemented?
- [ ] Inbound metrics/alerts?

## 41.6 Operations

- [ ] RA version documented?
- [ ] Deployment procedure?
- [ ] Monitoring dashboard?
- [ ] Failure runbook?
- [ ] Load/recovery tests done?

---

# 42. Case Study 1: Resource Adapter untuk Mainframe Transaction Processor

## 42.1 Context

Application needs to submit licensing transaction to mainframe.

Mainframe has:

- proprietary protocol;
- limited sessions;
- transaction code;
- strict timeout;
- per-user audit.

## 42.2 Design

Resource adapter exposes:

```java
MainframeConnectionFactory
MainframeConnection
```

Application gateway:

```java
@ApplicationScoped
public class MainframeLicenseGateway {
    public SubmitResult submit(LicenseCommand command) { ... }
}
```

## 42.3 Pool

Max pool based on mainframe session capacity.

## 42.4 Transaction

If mainframe transaction cannot join XA, design idempotency and reconciliation.

## 42.5 Security

Map Jakarta user to mainframe user or use service account with audit field.

## 42.6 Failure handling

If timeout after submit, outcome ambiguous.

Use business key query to reconcile.

---

# 43. Case Study 2: JMS Resource Adapter dan MDB

## 43.1 Context

External broker sends case events.

Application consumes via MDB.

## 43.2 Behind the scenes

```text
Broker
  ↓
JMS Resource Adapter
  ↓
Message Inflow Contract
  ↓
MessageEndpointFactory
  ↓
MDB.onMessage
```

## 43.3 Transaction

MDB method runs in container transaction.

If exception/rollback, message redelivered.

## 43.4 Activation config

Misconfigured destination or selector means no messages.

## 43.5 Idempotency

MDB must deduplicate by event ID.

## 43.6 DLQ

Configure redelivery limit and DLQ in broker/RA.

---

# 44. Case Study 3: XA Failure dan In-Doubt Transaction

## 44.1 Context

Operation updates database and EIS under XA.

Crash happens after prepare before commit.

## 44.2 Result

Transaction is in-doubt.

DB and EIS may hold prepared transaction state.

## 44.3 Recovery

Transaction manager uses recovery log and asks XA resources to recover/commit/rollback.

## 44.4 Failure

Recovery credentials misconfigured.

EIS branch remains in-doubt.

## 44.5 Runbook

Need:

- transaction ID;
- resource names;
- recovery logs;
- EIS admin tool;
- decision record;
- manual heuristic resolution procedure.

## 44.6 Lesson

XA is not “set and forget”.

---

# 45. Case Study 4: Pool Exhaustion pada Adapter ERP

## 45.1 Problem

ERP adapter pool max 20.

Application has 200 request threads.

During spike, 20 connections active, 180 threads wait.

## 45.2 Symptoms

- high latency;
- timeout waiting connection;
- servlet thread exhaustion;
- CPU low but app unavailable.

## 45.3 Root causes

- EIS slow;
- no bulkhead;
- pool too small for SLA or app too concurrent;
- no timeout;
- connection leak;
- long transaction holding connection.

## 45.4 Fix

- set blocking timeout;
- isolate executor/bulkhead;
- close handles;
- reduce transaction duration;
- cache/read model if allowed;
- tune pool with EIS capacity;
- add circuit breaker/backpressure.

## 45.5 Lesson

External resource capacity controls app throughput.

---

# 46. Latihan Bertahap

## Latihan 1 — Draw connector architecture

Draw:

```text
Application Server ↔ Resource Adapter ↔ EIS
```

Label connection, transaction, security, lifecycle.

## Latihan 2 — Connection lifecycle

Explain logical connection vs managed physical connection.

## Latihan 3 — Pool exhaustion scenario

Given pool max 10 and EIS latency 2s, estimate throughput.

## Latihan 4 — Local vs XA transaction

Describe failure if DB commits but EIS local transaction fails.

## Latihan 5 — Message inflow

Explain how MDB receives messages via RA.

## Latihan 6 — Activation config debugging

List checks when MDB receives no messages.

## Latihan 7 — Credential mapping

Design shared service account vs per-user mapping.

## Latihan 8 — Ambiguous outcome

Design reconciliation for timeout after EIS submit.

## Latihan 9 — XA recovery

Write runbook skeleton for in-doubt transaction.

## Latihan 10 — Gateway abstraction

Wrap a hypothetical CCI/EIS API behind domain gateway.

---

# 47. Mini Project: Jakarta Connectors Architecture Lab

## 47.1 Goal

Create architecture documentation/lab:

```text
jakarta-connectors-architecture-lab/
```

## 47.2 Modules

```text
connector-mental-model/
outbound-adapter-gateway/
connection-pool-simulation/
local-vs-xa-transaction/
message-inflow-simulation/
activation-spec-debug/
credential-mapping/
work-manager-model/
xa-recovery-runbook/
observability-dashboard/
```

## 47.3 Deliverables

```text
README.md
CONNECTOR-MENTAL-MODEL.md
RESOURCE-ADAPTER.md
CONNECTION-MANAGEMENT.md
TRANSACTION-MANAGEMENT.md
MESSAGE-INFLOW.md
SECURITY-MAPPING.md
POOL-TUNING.md
XA-RECOVERY.md
FAILURE-MODES.md
```

## 47.4 Required experiments

1. Simulate connection pool checkout/return.
2. Simulate connection leak and pool exhaustion.
3. Compare local transaction vs XA flow.
4. Model message inflow to endpoint.
5. Design activation spec checklist.
6. Design credential mapping.
7. Simulate WorkManager submission.
8. Write XA recovery runbook.
9. Create metrics dashboard definition.
10. Create gateway abstraction over EIS.

## 47.5 Evaluation questions

1. What is a resource adapter?
2. What is an EIS?
3. What is a RAR?
4. What is difference between logical connection and ManagedConnection?
5. What does connection management contract solve?
6. What is message inflow?
7. What is transaction inflow?
8. When use XA?
9. Why is WorkManager important?
10. Why should application code close connection handles?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta Connectors 2.1  
   https://jakarta.ee/specifications/connectors/2.1/

2. Jakarta Connectors 2.1 Specification  
   https://jakarta.ee/specifications/connectors/2.1/jakarta-connectors-spec-2.1

3. Jakarta Connectors 2.1 API Docs  
   https://jakarta.ee/specifications/connectors/2.1/apidocs/

4. Jakarta EE Tutorial — Resource Adapters and Contracts  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/resources/resources.html

5. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

6. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

7. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

8. Jakarta Enterprise Beans 4.0  
   https://jakarta.ee/specifications/enterprise-beans/4.0/

9. Jakarta Concurrency 3.1  
   https://jakarta.ee/specifications/concurrency/3.1/

10. Jakarta Security 4.0  
    https://jakarta.ee/specifications/security/4.0/

---

# Penutup

Jakarta Connectors adalah spesifikasi yang sering tidak terlihat oleh application developer, tetapi sangat penting di enterprise integration.

Mental model ringkas:

```text
Resource Adapter:
  system-level driver between Jakarta EE server and EIS

Connection Management:
  pooling and logical/physical connection lifecycle

Transaction Management:
  local/XA resource participation

Security Contract:
  credential/principal mapping

Work Management:
  adapter uses server-managed threads

Message Inflow:
  EIS/provider delivers messages to endpoints/MDB

Transaction Inflow:
  external transaction context imported into server

RAR:
  deployment package for resource adapter
```

Prinsip paling penting:

```text
A resource adapter is infrastructure code.
Application code should consume it through a clean gateway and respect container-managed lifecycle, pooling, transaction, and security boundaries.
```

Engineer top-tier tidak harus selalu menulis resource adapter, tetapi harus bisa membaca arsitekturnya, men-debug pool exhaustion, memahami XA recovery risk, mengerti message inflow ke MDB, dan tahu kapan custom client library cukup versus kapan resource adapter memang diperlukan.

Bagian berikutnya akan membahas **Jakarta WebSocket (`jakarta.websocket`)**: full-duplex communication, endpoint lifecycle, session, encoder/decoder, backpressure, scaling, authentication, and production real-time messaging.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-jakarta-part-023.md](./learn-java-jakarta-part-023.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-025.md](./learn-java-jakarta-part-025.md)

</div>