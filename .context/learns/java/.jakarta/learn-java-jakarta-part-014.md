# learn-java-jakarta-part-014.md

# Bagian 14 — Jakarta Transactions: Transaction Boundary, Rollback, XA, dan Consistency Engineering

> Target pembaca: Java engineer yang ingin memahami `jakarta.transaction` bukan hanya sebagai `@Transactional`, tetapi sebagai **consistency boundary** dalam aplikasi enterprise: kapan transaction dimulai, kapan commit/rollback, bagaimana JPA/JDBC/JMS ikut dalam transaction, apa risiko long transaction, kapan XA masuk akal, dan kapan outbox/saga lebih cocok.
>
> Fokus bagian ini: Jakarta Transactions / JTA, `@Transactional`, `UserTransaction`, `TransactionManager`, `Synchronization`, XA, local vs distributed transaction, transaction propagation, rollback rules, timeout, resource enlistment, outbox pattern, idempotency, retry, failure modes, testing, dan production checklist.

---

## Daftar Isi

1. [Orientasi: Transaction Bukan Sekadar Annotation](#1-orientasi-transaction-bukan-sekadar-annotation)
2. [Mental Model: Transaction sebagai Consistency Boundary](#2-mental-model-transaction-sebagai-consistency-boundary)
3. [Jakarta Transactions dalam Jakarta EE](#3-jakarta-transactions-dalam-jakarta-ee)
4. [API Surface: `jakarta.transaction`](#4-api-surface-jakartatransaction)
5. [Dependency, Runtime, dan Provider](#5-dependency-runtime-dan-provider)
6. [Local Transaction vs Global/Distributed Transaction](#6-local-transaction-vs-globaldistributed-transaction)
7. [ACID dan Realita Production](#7-acid-dan-realita-production)
8. [Transaction Manager, Resource Manager, dan Application](#8-transaction-manager-resource-manager-dan-application)
9. [Resource Enlistment](#9-resource-enlistment)
10. [`@Transactional`: Declarative Transaction Boundary](#10-transactional-declarative-transaction-boundary)
11. [`TxType`: REQUIRED, REQUIRES_NEW, MANDATORY, SUPPORTS, NOT_SUPPORTED, NEVER](#11-txtype-required-requires_new-mandatory-supports-not_supported-never)
12. [Rollback Rules: RuntimeException, Checked Exception, `rollbackOn`, `dontRollbackOn`](#12-rollback-rules-runtimeexception-checked-exception-rollbackon-dontrollbackon)
13. [Class-Level vs Method-Level `@Transactional`](#13-class-level-vs-method-level-transactional)
14. [Interceptor/Proxy Boundary dan Self-Invocation](#14-interceptorproxy-boundary-dan-self-invocation)
15. [`UserTransaction`: Programmatic Transaction Boundary](#15-usertransaction-programmatic-transaction-boundary)
16. [`TransactionManager`: Untuk Container/Application Server](#16-transactionmanager-untuk-containerapplication-server)
17. [`TransactionSynchronizationRegistry` dan `Synchronization`](#17-transactionsynchronizationregistry-dan-synchronization)
18. [Transaction Status dan Heuristic Outcomes](#18-transaction-status-dan-heuristic-outcomes)
19. [Timeout](#19-timeout)
20. [JPA dan Transaction](#20-jpa-dan-transaction)
21. [JDBC/DataSource dan Transaction](#21-jdbcdatasource-dan-transaction)
22. [JMS/Messaging dan Transaction](#22-jmsmessaging-dan-transaction)
23. [XA dan Two-Phase Commit](#23-xa-dan-two-phase-commit)
24. [Kenapa XA Mahal dan Sulit](#24-kenapa-xa-mahal-dan-sulit)
25. [Outbox Pattern sebagai Alternatif XA](#25-outbox-pattern-sebagai-alternatif-xa)
26. [Saga dan Process Manager](#26-saga-dan-process-manager)
27. [Idempotency dan Retry](#27-idempotency-dan-retry)
28. [Transaction Boundary di Layered Architecture](#28-transaction-boundary-di-layered-architecture)
29. [Transaction dalam REST API](#29-transaction-dalam-rest-api)
30. [Transaction dalam Worker/Consumer](#30-transaction-dalam-workerconsumer)
31. [Transaction dalam Batch Job](#31-transaction-dalam-batch-job)
32. [Long-Running Transaction](#32-long-running-transaction)
33. [Deadlock, Lock Wait, dan Isolation](#33-deadlock-lock-wait-dan-isolation)
34. [Optimistic Locking vs Pessimistic Locking](#34-optimistic-locking-vs-pessimistic-locking)
35. [Error Handling dan Exception Mapping](#35-error-handling-dan-exception-mapping)
36. [Observability: Log, Metrics, Trace, dan Audit](#36-observability-log-metrics-trace-dan-audit)
37. [Testing Strategy](#37-testing-strategy)
38. [Migration Notes: Java EE/Spring ke Jakarta Transactions](#38-migration-notes-java-eespring-ke-jakarta-transactions)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices dan Anti-Patterns](#40-best-practices-dan-anti-patterns)
41. [Checklist Review](#41-checklist-review)
42. [Case Study 1: Case Approval dengan JPA dan Audit Outbox](#42-case-study-1-case-approval-dengan-jpa-dan-audit-outbox)
43. [Case Study 2: External HTTP Call di Dalam Transaction](#43-case-study-2-external-http-call-di-dalam-transaction)
44. [Case Study 3: Kafka/JMS Publish Setelah DB Commit](#44-case-study-3-kafkajms-publish-setelah-db-commit)
45. [Case Study 4: `REQUIRES_NEW` untuk Audit — Berguna atau Berbahaya?](#45-case-study-4-requires_new-untuk-audit--berguna-atau-berbahaya)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Transaction Boundary Lab](#47-mini-project-transaction-boundary-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Transaction Bukan Sekadar Annotation

Banyak developer mengenal transaction dari annotation:

```java
@Transactional
public void approveCase(ApproveCase command) {
    ...
}
```

Lalu mental model-nya berhenti di:

```text
Kalau sukses commit.
Kalau error rollback.
```

Itu benar, tetapi belum cukup untuk production.

Dalam production, transaction menyentuh:

- consistency;
- lock;
- isolation;
- timeout;
- connection pool;
- retry;
- idempotency;
- messaging;
- external system;
- audit;
- observability;
- failure recovery;
- deadlock;
- partial failure;
- database performance;
- distributed system design.

## 1.1 Transaction adalah keputusan arsitektur

Annotation `@Transactional` tampak kecil, tetapi ia menjawab pertanyaan besar:

```text
Perubahan apa saja yang harus berhasil bersama-sama?
Perubahan apa saja yang boleh terjadi terpisah?
Kapan state dianggap committed?
Apa yang terjadi jika ada error di tengah jalan?
Apa yang boleh di-retry?
Apa yang harus idempotent?
Apa yang terjadi jika process mati setelah DB commit tapi sebelum publish event?
```

Jika jawaban ini salah, bug-nya bukan sekadar exception. Bisa menjadi:

- duplicate payment;
- lost notification;
- audit gap;
- orphan row;
- inconsistent state;
- stuck workflow;
- infinite retry;
- deadlock storm;
- data corruption.

## 1.2 Transaction bukan replacement untuk business invariant

Transaction menjaga atomicity di resource boundary, tetapi business invariant tetap harus didesain.

Buruk:

```java
@Transactional
public void approve(UUID caseId) {
    caseEntity.status = APPROVED;
}
```

Lebih baik:

```java
@Transactional
public void approve(ApproveCase command) {
    EnforcementCase c = repository.get(command.caseId());
    c.approve(command.actor(), command.reason(), clock.instant());
    repository.save(c);
}
```

Transaction menjaga perubahan disimpan atomically. Domain model menjaga rule apakah approval valid.

## 1.3 Goal bagian ini

Setelah bagian ini, kamu harus bisa:

1. menentukan transaction boundary yang benar;
2. memilih `TxType` dengan sadar;
3. memahami rollback rules;
4. membedakan local transaction, JTA, dan XA;
5. memahami JPA/JDBC/JMS dalam transaction;
6. mendesain outbox/saga ketika XA tidak cocok;
7. menghindari long-running transaction;
8. men-debug deadlock/timeout/rollback;
9. menulis test transaction yang meaningful;
10. membuat production checklist untuk transaction-heavy service.

---

# 2. Mental Model: Transaction sebagai Consistency Boundary

Transaction adalah boundary yang mengatakan:

> Semua perubahan di dalam boundary ini harus terlihat sebagai satu unit: berhasil bersama atau dibatalkan bersama.

## 2.1 Unit of work

Dalam aplikasi enterprise, satu use case biasanya adalah unit of work.

Contoh:

```text
Approve Case
  1. load case
  2. verify current state
  3. change status to APPROVED
  4. store approval reason
  5. store audit event/outbox event
  6. commit
```

Jika step 3 berhasil tapi step 5 gagal, state tidak boleh committed jika audit wajib.

Maka transaction boundary harus mencakup step 3 dan 5.

## 2.2 Transaction boundary bukan sama dengan method boundary sembarang

Tidak semua method butuh transaction.

Buruk:

```java
@Transactional
private boolean isValidStatus(CaseStatus status) {
    return status == OPEN;
}
```

Baik:

```java
@Transactional
public ApproveCaseResult handle(ApproveCase command) {
    ...
}
```

Boundary harus berada di use case/application service, bukan helper internal.

## 2.3 Read transaction

Read operation juga bisa butuh transaction untuk:

- repeatable read;
- consistent snapshot;
- lazy loading/persistence context;
- resource lifecycle;
- database statement timeout;
- read-only optimization jika provider mendukung.

Tetapi read-only endpoint tidak selalu perlu write transaction.

## 2.4 Transaction ≠ lock everything

Transaction tidak berarti semua data terkunci sampai selesai. Behavior tergantung:

- isolation level;
- query;
- row locks;
- index;
- DB engine;
- optimistic/pessimistic locking;
- JPA provider;
- transaction manager.

## 2.5 Transaction duration matters

Semakin lama transaction terbuka:

- lock makin lama ditahan;
- connection makin lama dipakai;
- deadlock risk meningkat;
- MVCC cleanup tertunda;
- throughput turun;
- retry makin mahal;
- user request makin lambat.

Prinsip:

```text
Transaction should be as short as possible, but as wide as necessary.
```

---

# 3. Jakarta Transactions dalam Jakarta EE

Jakarta Transactions adalah spesifikasi yang menyediakan interface standar untuk transaction management di lingkungan Jakarta.

Spesifikasi Jakarta Transactions menjelaskan API-nya terdiri dari tiga elemen besar:

1. high-level application transaction demarcation interface;
2. high-level transaction manager interface untuk application server;
3. standard Java mapping dari X/Open XA protocol untuk transactional resource manager.

Dalam Jakarta EE application, transaction adalah serangkaian aksi yang harus semuanya sukses atau semua perubahan dibatalkan. Transaction berakhir dengan commit atau rollback.

## 3.1 Nama historis: JTA

Jakarta Transactions sebelumnya dikenal sebagai Java Transaction API / JTA.

Banyak dokumentasi/framework masih menyebut “JTA transaction”.

Dalam package modern:

```java
jakarta.transaction
```

bukan:

```java
javax.transaction
```

## 3.2 Jakarta Transactions 2.0

Jakarta Transactions 2.0 adalah versi yang digunakan luas di Jakarta EE 9+ namespace era.

Artifact API modern:

```xml
<groupId>jakarta.transaction</groupId>
<artifactId>jakarta.transaction-api</artifactId>
<version>2.0.1</version>
```

Dalam Jakarta EE Platform/Web Profile, API ini biasanya sudah tercakup oleh aggregate API.

## 3.3 Jakarta Transactions dan Jakarta EE runtime

Jakarta EE runtime menyediakan transaction manager.

Aplikasi memakai:

```java
@Transactional
```

Runtime/container melakukan:

```text
before method:
  inspect transaction context
  create/join/suspend transaction depending TxType

invoke method

after method:
  commit/rollback/resume transaction
```

## 3.4 Jakarta Transactions bukan database library

`jakarta.transaction-api` hanya API/contract.

Behavior butuh:

- transaction manager;
- resource manager;
- runtime/container integration;
- JDBC/JPA/JMS resources yang transaction-aware.

---

# 4. API Surface: `jakarta.transaction`

Package `jakarta.transaction` berisi beberapa API penting.

## 4.1 Application-facing API

Paling sering dipakai aplikasi:

```java
@Transactional
UserTransaction
TransactionScoped
TransactionSynchronizationRegistry
Synchronization
```

## 4.2 Transaction manager API

Lebih container/server-level:

```java
TransactionManager
Transaction
```

Biasanya application code tidak langsung memakai `TransactionManager`.

## 4.3 Exceptions

Contoh exception/status related:

```java
RollbackException
HeuristicMixedException
HeuristicRollbackException
NotSupportedException
SystemException
InvalidTransactionException
TransactionRequiredException
TransactionalException
```

## 4.4 Status constants

Transaction status biasanya melalui `Status`:

```java
STATUS_ACTIVE
STATUS_MARKED_ROLLBACK
STATUS_PREPARED
STATUS_COMMITTED
STATUS_ROLLEDBACK
STATUS_UNKNOWN
STATUS_NO_TRANSACTION
STATUS_PREPARING
STATUS_COMMITTING
STATUS_ROLLING_BACK
```

## 4.5 XA package note

Sejarahnya JTA berkaitan dengan XA. Namun package `javax.transaction.xa` sekarang dimiliki Java SE. Jadi di Jakarta Transactions modern, kamu bisa melihat kombinasi:

```java
jakarta.transaction.*
javax.transaction.xa.*
```

Jangan blind-replace `javax.transaction.xa` menjadi `jakarta.transaction.xa`.

---

# 5. Dependency, Runtime, dan Provider

## 5.1 Maven dependency individual

```xml
<dependency>
  <groupId>jakarta.transaction</groupId>
  <artifactId>jakarta.transaction-api</artifactId>
  <version>2.0.1</version>
</dependency>
```

## 5.2 Dalam Jakarta EE runtime

Jika target Jakarta EE Platform/Web Profile:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

atau:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 5.3 API jar bukan transaction manager

Menambahkan `jakarta.transaction-api` tidak membuat transaction jalan.

Butuh:

- Jakarta EE runtime;
- Narayana/Atomikos/Bitronix-like transaction manager;
- Quarkus/Spring/Jakarta runtime integration;
- JPA/JDBC/JMS integration.

## 5.4 Spring/Quarkus integration

Spring Framework mendukung standard `jakarta.transaction.Transactional` sebagai annotation deklaratif, tetapi Spring juga punya `org.springframework.transaction.annotation.Transactional` yang lebih kaya di Spring ecosystem.

Quarkus juga memakai `jakarta.transaction.Transactional` untuk mendefinisikan transaction boundary.

Tetapi behavior detail tetap bergantung framework/runtime.

## 5.5 Scope dependency

Untuk container-deployed WAR:

```xml
<scope>provided</scope>
```

Untuk executable runtime/framework:

```text
ikuti dependency management runtime/framework
```

Jangan menambahkan transaction manager manual jika runtime sudah mengelola.

---

# 6. Local Transaction vs Global/Distributed Transaction

## 6.1 Local transaction

Local transaction melibatkan satu resource.

Contoh:

```text
one PostgreSQL database
one Oracle database
one JDBC connection/resource
```

Flow:

```text
begin
  SQL statements
commit/rollback
```

## 6.2 Global transaction

Global transaction dikelola transaction manager dan bisa melibatkan lebih dari satu resource.

Contoh:

```text
DB + JMS
DB1 + DB2
JMS1 + JMS2
```

## 6.3 Distributed transaction / XA

Distributed transaction memakai XA/two-phase commit untuk koordinasi multiple XA resources.

Flow konseptual:

```text
begin global tx
  resource A enlisted
  resource B enlisted
prepare A
prepare B
if all prepared:
  commit A
  commit B
else:
  rollback A/B
```

## 6.4 Local transaction lebih sederhana

Jika hanya satu database, local/JTA-integrated transaction cukup.

Jangan gunakan XA jika tidak perlu.

## 6.5 Distributed system reality

Di microservices modern, transaction across services jarang menggunakan XA karena:

- service boundary independen;
- network unreliable;
- message broker semantics;
- deployment independent;
- scale;
- operational complexity.

Sering lebih baik:

- outbox;
- saga;
- idempotency;
- compensating action;
- eventual consistency.

---

# 7. ACID dan Realita Production

## 7.1 Atomicity

Semua perubahan di transaction berhasil bersama atau rollback bersama.

Tetapi atomicity hanya berlaku pada resources yang benar-benar ikut transaction.

Jika kamu melakukan HTTP call ke external service di dalam `@Transactional`, external system tidak ikut rollback.

## 7.2 Consistency

Transaction membawa database dari satu valid state ke valid state lain.

Tetapi database tidak tahu semua business rule.

Business code tetap harus enforce invariant.

## 7.3 Isolation

Concurrent transactions tidak saling mengganggu melebihi isolation level.

Namun isolation level yang umum seperti READ COMMITTED masih memungkinkan anomaly tertentu.

## 7.4 Durability

Setelah commit, perubahan bertahan.

Tetapi durability juga dipengaruhi:

- database config;
- replication;
- fsync;
- disk/cloud storage;
- transaction log;
- backup/restore;
- failover.

## 7.5 Realita

ACID tidak otomatis menyelesaikan:

- duplicate request;
- retry after timeout;
- message publish after commit;
- cache invalidation;
- external API side effect;
- eventual consistency;
- reporting lag;
- read replica staleness.

---

# 8. Transaction Manager, Resource Manager, dan Application

## 8.1 Application

Application code menjalankan business operation.

```java
@Transactional
public void approve(...) { ... }
```

## 8.2 Transaction Manager

Transaction manager mengoordinasi transaction:

- begin;
- commit;
- rollback;
- suspend/resume;
- enlist resources;
- timeout;
- status;
- XA prepare/commit jika distributed.

## 8.3 Resource Manager

Resource manager adalah resource transactional.

Contoh:

- database;
- JMS broker;
- XA datasource;
- XA connection factory.

## 8.4 Resource adapter/driver

Driver/adapter membuat resource bisa ikut transaction.

Contoh:

- JDBC XADataSource;
- JMS XAConnectionFactory.

## 8.5 Container integration

Container menghubungkan:

```text
application method
transaction interceptor
transaction manager
resources
```

Itulah kenapa `@Transactional` hanya bekerja pada managed component.

---

# 9. Resource Enlistment

Resource enlistment adalah proses memasukkan resource ke transaction yang sedang aktif.

## 9.1 Contoh JPA/JDBC

```java
@Transactional
public void createCase(...) {
    em.persist(caseEntity);
}
```

Ketika `EntityManager` memakai connection, connection ikut transaction.

## 9.2 Contoh JMS

```java
@Transactional
public void approve(...) {
    repository.save(caseEntity);
    jmsContext.createProducer().send(destination, event);
}
```

Jika JMS resource enlisted dalam JTA transaction, message send bisa commit/rollback bersama transaction.

Tetapi ini bergantung resource/provider/runtime.

## 9.3 Enlistment tidak selalu otomatis

Jika kamu membuat connection sendiri:

```java
DriverManager.getConnection(...)
```

connection itu mungkin tidak ikut container transaction.

Gunakan container-managed DataSource.

## 9.4 Non-transactional side effects

Hal berikut tidak otomatis rollback:

- HTTP call;
- file write;
- S3 upload;
- email sent;
- external payment API;
- cache write;
- log line;
- metrics;
- Kafka publish if not integrated transactionally with same boundary.

## 9.5 Design implication

Dalam transaction, hanya lakukan side effect yang:

1. ikut transaction; atau
2. aman jika tidak rollback; atau
3. dicatat sebagai intent untuk dieksekusi setelah commit.

---

# 10. `@Transactional`: Declarative Transaction Boundary

`@Transactional` memberi aplikasi kemampuan untuk mengontrol transaction boundary secara deklaratif pada CDI managed beans dan managed classes di Jakarta EE.

## 10.1 Basic example

```java
import jakarta.transaction.Transactional;

@ApplicationScoped
public class ApproveCaseUseCase {

    @Inject
    CaseRepository repository;

    @Transactional
    public ApproveCaseResult handle(ApproveCase command) {
        EnforcementCase c = repository.get(command.caseId());
        c.approve(command.actor(), command.reason());
        repository.save(c);
        return ApproveCaseResult.from(c);
    }
}
```

## 10.2 What happens conceptually

```text
caller invokes proxy
  ↓
transaction interceptor checks TxType
  ↓
begin or join transaction
  ↓
method executes
  ↓
if success: commit if transaction started here
if failure needing rollback: mark rollback / rollback
  ↓
return/throw
```

## 10.3 Annotation target

`@Transactional` dapat dipakai pada class atau method level. Method-level annotation override class-level annotation.

## 10.4 Managed object requirement

`@Transactional` bekerja saat:

- class adalah managed bean/component;
- method dipanggil melalui container/proxy;
- transaction interceptor aktif.

Jika object dibuat manual dengan `new`, annotation tidak otomatis bekerja.

## 10.5 Method visibility

Gunakan pada public business method yang dipanggil dari luar component/proxy.

Private/internal helper biasanya bukan boundary transaction yang baik.

---

# 11. `TxType`: REQUIRED, REQUIRES_NEW, MANDATORY, SUPPORTS, NOT_SUPPORTED, NEVER

`@Transactional` memiliki `value` berupa `TxType`.

## 11.1 REQUIRED

Default paling umum.

Behavior:

```text
if transaction exists:
  join it
else:
  create new transaction
```

Use for application use case.

```java
@Transactional
public void approve(...) { ... }
```

atau eksplisit:

```java
@Transactional(Transactional.TxType.REQUIRED)
```

## 11.2 REQUIRES_NEW

Behavior:

```text
if transaction exists:
  suspend it
create new transaction
commit/rollback new transaction
resume previous transaction
```

Use carefully.

Contoh yang mungkin:

- audit attempt independent from main transaction;
- write failure log independent;
- reserve idempotency key separately.

Risiko:

- partial commit;
- audit committed walau main rollback;
- breaks atomicity;
- can surprise readers.

## 11.3 MANDATORY

Behavior:

```text
must be called inside existing transaction
else error
```

Use for lower-level method that must never create transaction sendiri.

```java
@Transactional(Transactional.TxType.MANDATORY)
public void saveAggregate(...) { ... }
```

Good for enforcing boundary in application service.

## 11.4 SUPPORTS

Behavior:

```text
if transaction exists:
  join it
else:
  run without transaction
```

Use for methods that can work both ways.

Be careful: behavior may differ with/without transaction.

## 11.5 NOT_SUPPORTED

Behavior:

```text
if transaction exists:
  suspend it
run without transaction
resume previous transaction
```

Use for operations that should not be inside transaction.

Examples:

- slow external call;
- report generation that should not hold transaction;
- non-transactional health check.

But consider whether caller expects atomicity.

## 11.6 NEVER

Behavior:

```text
if transaction exists:
  error
else:
  run without transaction
```

Use to explicitly forbid transaction.

Example:

```java
@Transactional(Transactional.TxType.NEVER)
public ExternalRiskScore callExternalRiskEngine(...) { ... }
```

## 11.7 Decision table

| TxType | Starts new? | Joins existing? | Suspends existing? | Typical use |
|---|---:|---:|---:|---|
| REQUIRED | yes if none | yes | no | default use case |
| REQUIRES_NEW | yes always | no | yes | independent audit/log/idempotency segment |
| MANDATORY | no | yes required | no | lower-level method requiring caller tx |
| SUPPORTS | no | yes if exists | no | read/helper that can run both ways |
| NOT_SUPPORTED | no | no | yes | non-transactional slow/external work |
| NEVER | no | error if exists | no | enforce no transaction |

---

# 12. Rollback Rules: RuntimeException, Checked Exception, `rollbackOn`, `dontRollbackOn`

Rollback behavior is subtle.

## 12.1 Default intuition

Most frameworks/specs treat unchecked exceptions as rollback triggers.

Checked exceptions may not trigger rollback by default unless configured.

Always verify Jakarta Transactions semantics and runtime behavior.

## 12.2 `rollbackOn`

`@Transactional` supports specifying exception classes that must trigger rollback.

```java
@Transactional(rollbackOn = BusinessRuleViolation.class)
public void submit(...) throws BusinessRuleViolation {
    ...
}
```

Use when checked exception should rollback.

## 12.3 `dontRollbackOn`

Specify exceptions that should not trigger rollback.

```java
@Transactional(dontRollbackOn = NonCriticalNotificationException.class)
public void approve(...) {
    ...
}
```

Use sparingly. It can lead to commit despite exception.

## 12.4 Exception hierarchy matters

If both `rollbackOn` and `dontRollbackOn` could apply via hierarchy, understand resolution rule.

Design exception hierarchy carefully.

## 12.5 Swallowing exception causes commit

Bad:

```java
@Transactional
public void approve(...) {
    try {
        repository.save(...);
        outbox.write(...);
    } catch (Exception e) {
        log.error("failed", e);
    }
}
```

Method returns normally, transaction may commit.

If failure should rollback, rethrow or mark rollback.

## 12.6 Mark rollback only

Sometimes code marks transaction rollback-only but catches exception.

This can lead to rollback at commit time and `RollbackException` later.

Use clear flow.

## 12.7 Checked business exceptions

For business validation failure, ask:

```text
Did state change happen before exception?
Should transaction rollback?
Should validation occur before mutation?
```

Often validation should happen before mutation.

## 12.8 Exception mapping to REST

Do not leak transaction exceptions directly.

Map:

- optimistic lock → 409;
- timeout/deadlock transient → 503/409 with retry guidance;
- validation → 400/422;
- not found → 404;
- unexpected rollback → 500 with correlation ID.

---

# 13. Class-Level vs Method-Level `@Transactional`

## 13.1 Class-level default

```java
@Transactional
@ApplicationScoped
public class CaseCommandService {
    public void approve(...) {}
    public void reject(...) {}
}
```

All business methods inherit default transaction behavior.

## 13.2 Method-level override

```java
@Transactional
public class CaseCommandService {

    public void approve(...) {}

    @Transactional(Transactional.TxType.NOT_SUPPORTED)
    public ExternalPreview previewExternal(...) {}
}
```

Method-level overrides class-level.

## 13.3 When class-level is good

Good if all methods are command operations requiring same boundary.

## 13.4 When class-level is dangerous

Dangerous if class mixes:

- commands;
- queries;
- external calls;
- health methods;
- helper methods;
- batch operations.

Then accidental transactions happen.

## 13.5 Recommendation

For clarity in large codebase, prefer method-level on use case methods, or class-level only on cohesive command service.

---

# 14. Interceptor/Proxy Boundary dan Self-Invocation

`@Transactional` is interceptor-like/declarative behavior.

Therefore proxy boundary matters.

## 14.1 Self-invocation trap

```java
@ApplicationScoped
public class CaseService {

    public void outer() {
        inner(); // self-call
    }

    @Transactional
    public void inner() {
        ...
    }
}
```

If `outer()` is called externally but `inner()` is invoked via `this.inner()`, `inner()` may not pass through transaction interceptor.

## 14.2 Symptom

- transaction not active;
- EntityManager complains;
- data not committed as expected;
- rollback rules not applied;
- metrics/security interceptors not called.

## 14.3 Fix

- put `@Transactional` on external use case method;
- move inner operation to another bean;
- make boundary explicit;
- avoid transaction annotations on internal helper.

## 14.4 Good design

```java
@Transactional
public void outerUseCase() {
    step1();
    step2();
}

private void step1() {}
private void step2() {}
```

Boundary on use case, not internal step.

---

# 15. `UserTransaction`: Programmatic Transaction Boundary

`UserTransaction` defines methods that allow an application to explicitly manage transaction boundaries.

## 15.1 Basic API

Conceptually:

```java
userTransaction.begin();
try {
    ...
    userTransaction.commit();
} catch (Exception e) {
    userTransaction.rollback();
    throw e;
}
```

## 15.2 Example

```java
@Resource
UserTransaction tx;

public void runManually() throws Exception {
    tx.begin();
    try {
        repository.step1();
        repository.step2();
        tx.commit();
    } catch (Exception e) {
        tx.rollback();
        throw e;
    }
}
```

## 15.3 When use programmatic transaction?

Use when:

- transaction boundary cannot be expressed declaratively;
- multiple transaction segments in one method;
- legacy integration;
- batch chunk manual control;
- framework code.

## 15.4 Prefer declarative where possible

Declarative `@Transactional` is clearer for common use cases.

Programmatic transaction is more error-prone.

## 15.5 Common bug

```java
tx.begin();
doWork();
tx.commit();
```

No rollback in catch/finally.

Correct:

```java
boolean committed = false;
tx.begin();
try {
    doWork();
    tx.commit();
    committed = true;
} finally {
    if (!committed) {
        try { tx.rollback(); } catch (Exception ignored) {}
    }
}
```

## 15.6 Restriction

Some managed environments restrict `UserTransaction` usage in certain components. Always check runtime/spec.

---

# 16. `TransactionManager`: Untuk Container/Application Server

`TransactionManager` is high-level transaction manager interface intended for application server.

## 16.1 Application code should rarely use it

Most application code should use:

```java
@Transactional
```

or, if needed:

```java
UserTransaction
```

## 16.2 What TransactionManager does

- begin;
- commit;
- rollback;
- suspend;
- resume;
- get transaction;
- set rollback only;
- set timeout.

## 16.3 Why not directly?

Direct use couples application to container-level transaction control and can break portability.

## 16.4 When used?

- application server internals;
- framework integration;
- custom resource adapter;
- advanced infrastructure code;
- tests/admin tooling.

## 16.5 Rule

If normal business application code needs `TransactionManager`, revisit design.

---

# 17. `TransactionSynchronizationRegistry` dan `Synchronization`

Sometimes you need to run code after transaction completes.

## 17.1 `Synchronization`

A `Synchronization` callback has concept of:

```text
beforeCompletion
afterCompletion(status)
```

Useful for:

- cleanup;
- cache invalidation after commit;
- deferred event dispatch;
- logging transaction outcome;
- resource coordination.

## 17.2 TransactionSynchronizationRegistry

Allows registering synchronization with current transaction and storing transaction-scoped resources.

## 17.3 After commit vs after completion

Important distinction:

```text
afterCompletion(COMMITTED)
```

is different from:

```text
afterCompletion(ROLLEDBACK)
```

Only send irreversible side effect after commit.

## 17.4 Warning: afterCompletion is not outbox

If process dies after DB commit before afterCompletion callback executes side effect, side effect can be lost.

For critical event publishing, use durable outbox.

## 17.5 Good use

- clear transaction-local cache;
- invalidate in-memory cache;
- log debug;
- non-critical local cleanup.

## 17.6 Risky use

- send email;
- publish critical domain event;
- call payment gateway;
- write mandatory audit outside DB.

Use outbox instead.

---

# 18. Transaction Status dan Heuristic Outcomes

## 18.1 Status

Transaction can be:

```text
active
marked rollback
prepared
committed
rolled back
unknown
no transaction
preparing
committing
rolling back
```

Status matters for diagnostics.

## 18.2 Marked rollback

If transaction is marked rollback-only, method may continue executing, but commit will fail/rollback later.

This can surprise code.

## 18.3 Heuristic outcome

In distributed transaction, resource might make heuristic decision:

- commit some resource;
- rollback another;
- mixed outcome;
- unknown state.

Exceptions:

```java
HeuristicMixedException
HeuristicRollbackException
```

## 18.4 Why heuristic is scary

It means transaction manager cannot guarantee simple all-or-nothing outcome after certain failure.

Manual recovery may be required.

## 18.5 Production implication

If using XA/distributed transaction, you need:

- transaction logs;
- recovery process;
- admin tooling;
- monitoring;
- operational runbook;
- resource manager consistency checks.

---

# 19. Timeout

Transaction timeout prevents transaction from running forever.

## 19.1 Why timeout matters

Without timeout:

- locks can be held too long;
- connection pool exhausted;
- user request hangs;
- deadlock resolution delayed;
- throughput collapses.

## 19.2 Where configured?

Timeout can be configured at:

- transaction manager default;
- runtime/server config;
- annotation/framework-specific config;
- programmatic `UserTransaction.setTransactionTimeout`;
- database statement timeout;
- JDBC query timeout.

## 19.3 Transaction timeout vs query timeout

Transaction timeout:

```text
entire transaction duration
```

Query timeout:

```text
single SQL statement duration
```

Need both.

## 19.4 Timeout does not mean safe retry

If client times out, server transaction may still commit.

Therefore API should have idempotency key for retryable commands.

## 19.5 Recommended practice

- set default transaction timeout;
- set shorter timeout for request operations;
- set longer but bounded timeout for batch chunks;
- set statement timeout;
- monitor timeout count;
- design retry/idempotency.

---

# 20. JPA dan Transaction

## 20.1 Persistence context joins transaction

In Jakarta EE, container-managed `EntityManager` can join current transaction.

```java
@PersistenceContext
EntityManager em;

@Transactional
public void create(...) {
    em.persist(entity);
}
```

## 20.2 Dirty checking

Within transaction:

```java
CaseEntity c = em.find(CaseEntity.class, id);
c.setStatus(APPROVED);
```

At flush/commit, provider detects changes and writes SQL.

## 20.3 Flush

Flush may happen:

- before query;
- at commit;
- when explicitly called.

Flush sends SQL but transaction not committed yet.

## 20.4 Rollback

If transaction rolls back, database changes are undone, but Java object state in memory may still be mutated.

Do not reuse entity after rollback casually.

## 20.5 Lazy loading

Lazy loading needs active persistence context/session.

If outside transaction/context, failure may occur.

## 20.6 Transaction boundary and DTO mapping

Map entity to DTO inside transaction if lazy fields needed.

But avoid loading huge graph.

## 20.7 Optimistic lock

`@Version` helps detect concurrent updates at flush/commit.

Map optimistic lock failure to `409 Conflict` or retry depending semantics.

## 20.8 Common JPA transaction mistakes

- no transaction for write;
- transaction too wide;
- external call inside transaction;
- catching exception then commit;
- lazy loading after transaction;
- N+1 query inside transaction;
- expecting `persist` to immediately commit;
- using detached entity incorrectly.

---

# 21. JDBC/DataSource dan Transaction

## 21.1 Use container-managed DataSource

Good:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource ds;
```

or CDI producer wrapping resource.

Bad:

```java
DriverManager.getConnection(...)
```

in Jakarta EE app.

## 21.2 Connection enlistment

When DataSource is transaction-aware, connection participates in transaction.

## 21.3 Auto-commit

Container-managed transaction usually controls commit/rollback. Do not manually call:

```java
connection.commit();
connection.rollback();
```

inside managed transaction unless specifically allowed/required.

## 21.4 Connection pool

Transaction duration holds connection.

Long transaction consumes pool slot.

## 21.5 Pool sizing

If replicas × max connections exceeds DB capacity, production incident happens.

Transaction design and pool sizing are connected.

## 21.6 Statement timeout

Set query timeout/statement timeout to prevent runaway SQL.

## 21.7 Mixed JPA and JDBC

If using JPA and JDBC in same transaction, ensure they use same transaction-aware datasource and understand flush ordering.

---

# 22. JMS/Messaging dan Transaction

## 22.1 JMS in JTA transaction

If JMS connection factory is XA/JTA integrated, send/receive can participate in transaction.

Example:

```java
@Transactional
public void approve(...) {
    repository.save(...);
    jmsContext.createProducer().send(queue, event);
}
```

If both DB and JMS enlisted in same global transaction, commit/rollback can coordinate.

## 22.2 Message consumption transaction

Consumer processing can be transactional:

```text
receive message
process DB update
commit transaction
ack message
```

If rollback, message redelivered depending broker config.

## 22.3 Poison message

If same message always fails, it can retry forever.

Need:

- max redelivery;
- DLQ;
- idempotency;
- error classification;
- observability.

## 22.4 JMS vs Kafka

Jakarta Transactions/JTA integration with JMS is classic Jakarta EE.

Kafka has its own transaction model and is not automatically part of Jakarta Transactions with DB.

For DB + Kafka, outbox pattern is often preferred.

## 22.5 Messaging side effect rule

If message publish must reflect DB state, avoid:

```java
repository.save(entity);
kafka.send(event);
```

without transactional strategy.

Use:

- JMS XA if appropriate;
- outbox;
- transaction log CDC;
- idempotent consumer.

---

# 23. XA dan Two-Phase Commit

XA coordinates multiple transactional resources.

## 23.1 Two-phase commit

Phase 1: prepare.

```text
TM asks each resource: can you commit?
Resource writes prepare state and replies yes/no.
```

Phase 2: commit/rollback.

```text
If all yes: TM tells all commit.
If any no: TM tells all rollback.
```

## 23.2 Participants

- Transaction Manager;
- Resource Manager A;
- Resource Manager B;
- XAResource interface;
- transaction log.

## 23.3 What problem XA solves

Ensures atomic outcome across multiple XA-capable resources, within limitations.

Example:

```text
DB update + JMS message send
```

## 23.4 Requirements

- XA-capable resources;
- transaction manager recovery log;
- stable storage;
- correct configuration;
- operational recovery process.

## 23.5 XA is not magic distributed system solution

XA does not cover:

- non-XA HTTP APIs;
- external SaaS;
- email;
- file/S3 if not XA resource;
- independent microservices without XA participation;
- human workflow.

---

# 24. Kenapa XA Mahal dan Sulit

## 24.1 Performance cost

Two-phase commit adds:

- extra round trips;
- prepare log writes;
- locks held longer;
- commit coordination;
- recovery overhead.

## 24.2 Availability cost

If coordinator/resource fails after prepare, transaction can be in-doubt.

Recovery needed.

## 24.3 Operational complexity

Need manage:

- transaction logs;
- recovery scanner;
- resource unique names;
- orphan/in-doubt transactions;
- monitoring;
- admin tooling.

## 24.4 Lock duration

During distributed commit, resources may hold locks longer.

High contention systems suffer.

## 24.5 Cloud/microservices mismatch

XA assumes coordinated resources. Microservices often own their databases independently.

Cross-service transaction via XA couples services tightly.

## 24.6 When XA can be okay

- single monolith/application server;
- DB + JMS in same enterprise environment;
- low/medium throughput;
- strong atomicity requirement;
- team has ops expertise;
- resources truly XA-capable;
- recovery runbook exists.

## 24.7 When avoid XA

- service-to-service boundary;
- external APIs;
- high-throughput event system;
- cloud-native independent services;
- team lacks recovery expertise;
- resources not XA-capable;
- eventual consistency acceptable.

---

# 25. Outbox Pattern sebagai Alternatif XA

Outbox pattern solves DB + message publish consistency without distributed transaction.

## 25.1 Problem

```java
@Transactional
public void approve(...) {
    repository.save(caseEntity);
}

publisher.publish(event); // after commit
```

If app crashes after commit but before publish, event lost.

## 25.2 Outbox solution

Within same DB transaction:

```text
update business table
insert outbox event row
commit
```

Then separate relay publishes outbox events.

## 25.3 Flow

```text
Command transaction:
  update case
  insert outbox(event_id, aggregate_id, type, payload)
  commit

Relay:
  read unpublished outbox
  publish to broker
  mark published / rely on CDC
```

## 25.4 Benefits

- no XA;
- DB state and event intent atomic;
- recoverable after crash;
- works with Kafka/event streaming;
- auditability;
- replay capability.

## 25.5 Requirements

- unique event ID;
- idempotent producer/consumer;
- relay reliability;
- ordering strategy;
- retention/cleanup;
- monitoring lag;
- poison event handling.

## 25.6 Outbox and Debezium

CDC tools can stream outbox table to broker.

This is common in event-driven microservices.

## 25.7 Outbox is not free

Costs:

- extra table;
- relay/CDC infrastructure;
- eventual consistency;
- duplicate event handling;
- monitoring;
- schema evolution.

## 25.8 When use outbox

Use when:

- DB change must produce event;
- broker not part of same transaction;
- microservice architecture;
- recovery matters;
- eventual consistency acceptable.

---

# 26. Saga dan Process Manager

Saga coordinates long-running business process across transactions.

## 26.1 Why saga?

Some workflows cannot fit in one ACID transaction:

- human approval;
- payment external API;
- document verification;
- multi-service orchestration;
- delivery process;
- regulator review.

## 26.2 Saga model

Each step commits local transaction.

If later step fails, run compensating action.

```text
Reserve item
  ↓
Charge payment
  ↓
Create shipment
```

If shipment fails:

```text
refund payment
release reservation
```

## 26.3 Process manager

A process manager tracks saga state:

```text
REQUESTED → RESERVED → PAID → SHIPPED
                    ↘ FAILED_COMPENSATING
```

## 26.4 Difference from transaction

Transaction rollback undoes uncommitted changes automatically.

Saga compensation is explicit business action.

## 26.5 Jakarta transaction role

Each saga step can use local `@Transactional` boundary.

But entire saga is not one DB transaction.

## 26.6 Saga requirements

- durable saga state;
- idempotent commands;
- correlation IDs;
- timeout/retry;
- compensation logic;
- observability;
- manual recovery.

---

# 27. Idempotency dan Retry

Transaction alone does not make retry safe.

## 27.1 Client timeout ambiguity

Client calls:

```http
POST /cases/123/approve
```

Server commits, but response lost due to network timeout.

Client retries.

Without idempotency, duplicate approval/audit/event can occur.

## 27.2 Idempotency key

Client sends:

```http
Idempotency-Key: abc-123
```

Server stores:

```text
key
request hash
status
result
```

inside transaction.

## 27.3 Unique constraints

Use unique constraint:

```sql
unique(operation, idempotency_key)
```

## 27.4 Retry only safe operations

Retry safe:

- read query;
- idempotent command with key;
- transient deadlock with bounded retry;
- optimistic lock with re-read and business policy.

Retry dangerous:

- payment charge without idempotency;
- email send;
- external API with side effect;
- DB write without unique guard.

## 27.5 Deadlock retry

Deadlocks are often transient.

But retry must be:

- bounded;
- jittered;
- idempotent;
- logged;
- metric-tracked.

## 27.6 Retry inside or outside transaction?

Usually retry outside transaction boundary:

```text
attempt 1: begin tx → deadlock → rollback
wait
attempt 2: begin new tx → success → commit
```

Do not retry multiple times inside same failed transaction.

---

# 28. Transaction Boundary di Layered Architecture

## 28.1 Recommended boundary

```text
API Resource
  ↓
Application Use Case  ← @Transactional here
  ↓
Domain Model
  ↓
Repository
  ↓
Database
```

## 28.2 API layer should not own transaction normally

Bad:

```java
@Path("/cases")
public class CaseResource {
    @Transactional
    @POST
    public Response approve(...) { ... }
}
```

This ties transaction to transport layer.

Better:

```java
@Path("/cases")
public class CaseResource {
    @Inject ApproveCaseUseCase useCase;

    @POST
    public Response approve(...) {
        return Response.ok(useCase.handle(...)).build();
    }
}
```

Use case owns transaction:

```java
@Transactional
public ApproveCaseResult handle(...) { ... }
```

## 28.3 Domain should not know transactions

Domain model should not be annotated with `@Transactional`.

```java
public final class EnforcementCase {
    public void approve(...) { ... }
}
```

## 28.4 Repository usually MANDATORY or no annotation

Repository should typically expect caller transaction for writes.

```java
@Transactional(MANDATORY)
public void save(...) { ... }
```

or rely on application service boundary.

## 28.5 Infrastructure external clients

External HTTP clients should usually be outside DB transaction or called before transaction if purely validation and safe.

---

# 29. Transaction dalam REST API

## 29.1 Command endpoint

```http
POST /cases/{id}/approve
```

Should map to application use case transaction.

## 29.2 Query endpoint

```http
GET /cases/{id}
```

May use read-only transaction or no transaction depending persistence strategy.

## 29.3 Do not stream response while transaction open

Bad:

```text
open tx
stream huge response for minutes
commit
```

This holds DB connection/transaction too long.

## 29.4 Request timeout vs transaction timeout

Ensure transaction timeout < request timeout or aligned.

If request times out but transaction continues, client may retry while first still executing.

## 29.5 Status codes

- success commit → 200/201/204;
- accepted async → 202;
- validation before transaction → 400/422;
- optimistic lock → 409;
- duplicate idempotency key in progress → 409/425/202 depending contract;
- timeout → 503/504;
- rollback unexpected → 500.

## 29.6 Never commit after sending response

If response says success but commit fails afterward, client sees false success.

Ensure commit happens before success response is finalized.

---

# 30. Transaction dalam Worker/Consumer

## 30.1 Message handling flow

```text
receive message
begin transaction
process
update DB
commit transaction
ack message
```

If rollback:

```text
message redelivery / DLQ
```

## 30.2 Idempotent consumer

Message can be delivered more than once.

Store processed message ID:

```sql
processed_message(event_id primary key, processed_at)
```

Within transaction:

```text
insert processed_message
apply business update
commit
```

If insert duplicate, skip safely.

## 30.3 Poison message

If message always fails:

- redelivery count;
- DLQ;
- alert;
- manual replay tooling.

## 30.4 Transaction size

One transaction per message or per small batch.

Large batch transaction increases lock time and rollback cost.

## 30.5 External call in consumer

If consumer calls external API inside transaction, same risks apply.

Consider:

- local state update + outbox;
- saga;
- async orchestration.

---

# 31. Transaction dalam Batch Job

## 31.1 Chunk transaction

Batch processing often uses chunk transaction:

```text
read 100 items
process
write
commit
```

If failure, rollback chunk.

## 31.2 Why not one giant transaction?

Processing 1 million rows in one transaction:

- huge undo/redo;
- long locks;
- timeout;
- memory pressure;
- painful rollback;
- operational risk.

## 31.3 Checkpoint

Batch should checkpoint progress.

If crash, resume from last committed checkpoint.

## 31.4 Idempotent batch

Batch steps should be rerunnable.

Use:

- job instance ID;
- unique constraints;
- processed marker;
- idempotent writes;
- audit logs.

## 31.5 Transaction timeout in batch

Batch chunks may need different timeout than REST request.

But still bounded.

---

# 32. Long-Running Transaction

Long-running transaction is a common production killer.

## 32.1 Causes

- external API inside transaction;
- user think time;
- huge report query;
- batch too large;
- file upload processing;
- slow lock wait;
- downstream database latency;
- N+1 query;
- no timeout.

## 32.2 Symptoms

- connection pool exhausted;
- locks held;
- deadlocks;
- slow requests;
- CPU idle but system stuck;
- DB active sessions pile up;
- transaction timeout;
- rollback storms.

## 32.3 Fix patterns

- move external call outside transaction;
- reduce transaction scope;
- chunk batch;
- use outbox;
- pre-validate before transaction;
- fetch only needed rows;
- add indexes;
- use optimistic locking;
- set timeout;
- split workflow into saga.

## 32.4 Human workflow

Never hold DB transaction while waiting for human approval.

Persist state:

```text
PENDING_APPROVAL
```

Later command opens new transaction:

```text
APPROVE/REJECT
```

---

# 33. Deadlock, Lock Wait, dan Isolation

## 33.1 Deadlock

Deadlock occurs when transactions wait on each other cyclically.

```text
Tx A locks row 1, wants row 2
Tx B locks row 2, wants row 1
```

DB aborts one.

## 33.2 Prevention

- access rows in consistent order;
- keep transaction short;
- proper indexes;
- avoid full table scan update;
- reduce lock scope;
- optimistic locking;
- retry bounded.

## 33.3 Lock wait timeout

Transaction waits too long for lock.

Can be caused by:

- long transaction;
- missing index;
- hot row;
- batch update;
- pessimistic lock.

## 33.4 Isolation level

Higher isolation can reduce anomalies but increase contention.

Common levels:

- READ COMMITTED;
- REPEATABLE READ;
- SERIALIZABLE.

Jakarta Transactions abstracts transaction demarcation; database isolation config may be datasource/provider-specific.

## 33.5 Write skew

Even with transactions, certain isolation levels allow anomalies.

Use constraints/locks/versioning for critical invariants.

---

# 34. Optimistic Locking vs Pessimistic Locking

## 34.1 Optimistic locking

Assume conflict rare.

Use version column:

```java
@Version
long version;
```

At commit/update, DB checks version.

If changed, fail.

## 34.2 Good for

- user edits;
- moderate contention;
- REST command conflict;
- scalable reads.

## 34.3 Pessimistic locking

Lock row before update.

Good for:

- high contention critical resource;
- inventory reservation;
- sequence-like state;
- short transaction.

## 34.4 Risks pessimistic lock

- deadlock;
- lock wait;
- throughput drop;
- long transaction harmful.

## 34.5 Retry strategy

Optimistic lock failure can be mapped to:

```http
409 Conflict
```

or retried if operation is automatic and safe.

## 34.6 Business meaning

Conflict is not just technical. It may mean user must re-evaluate current state.

---

# 35. Error Handling dan Exception Mapping

## 35.1 Transaction exceptions

Potential exceptions:

- `RollbackException`;
- `TransactionRequiredException`;
- `TransactionalException`;
- `SystemException`;
- `NotSupportedException`;
- heuristic exceptions;
- provider-specific persistence exceptions.

## 35.2 Do not expose directly

REST response should not show:

```text
jakarta.transaction.RollbackException: ARJUNA...
```

Return stable error contract with correlation ID.

## 35.3 Error classification

Classify:

- business validation;
- conflict;
- transient infrastructure;
- timeout;
- permanent infrastructure;
- programming/config error.

## 35.4 Retryable?

Not every rollback is retryable.

Retryable examples:

- deadlock;
- transient connection issue;
- serialization failure;
- lock timeout maybe.

Non-retryable:

- validation;
- unique constraint duplicate without idempotency semantics;
- missing required data;
- authorization.

## 35.5 Mark rollback with meaningful exception

Throw domain/application exception that maps properly.

Avoid generic `RuntimeException("failed")` everywhere.

---

# 36. Observability: Log, Metrics, Trace, dan Audit

## 36.1 Logs

Log transaction boundary at debug/trace for troubleshooting:

- operation name;
- transaction ID if available;
- correlation ID;
- start/end;
- outcome;
- duration;
- rollback cause.

Do not log secrets/PII.

## 36.2 Metrics

Track:

- transaction duration;
- commit count;
- rollback count;
- timeout count;
- deadlock count;
- lock wait;
- active transactions;
- connection pool active/pending;
- outbox lag;
- retry count.

## 36.3 Tracing

Trace spans:

```text
HTTP request
  → application use case
    → DB queries
    → outbox write
```

Do not create span for every tiny helper.

## 36.4 Audit

Audit should be transactionally consistent with business state if required.

Options:

- write audit row in same transaction;
- write outbox audit event in same transaction;
- use `REQUIRES_NEW` only when semantics allow audit independent of business commit.

## 36.5 Transaction ID

Some transaction managers expose transaction ID in logs. Correlate with app correlation ID.

## 36.6 Dashboards

Dashboard should show:

- API latency;
- DB latency;
- transaction duration;
- rollbacks by cause;
- pool saturation;
- deadlocks;
- outbox relay lag.

---

# 37. Testing Strategy

## 37.1 Unit tests

Domain logic should not require transaction.

Test domain/application logic with fake repository where possible.

## 37.2 Integration tests

Need real transaction manager/runtime for:

- `@Transactional` behavior;
- rollback;
- propagation;
- JPA flush/commit;
- `REQUIRES_NEW`;
- `MANDATORY`;
- timeout;
- synchronization callbacks.

## 37.3 Test rollback

Example:

```java
@Transactional
public void createThenFail() {
    repository.save(entity);
    throw new RuntimeException("boom");
}
```

Test entity not persisted.

## 37.4 Test checked exception rollback

If using `rollbackOn`, test it.

## 37.5 Test self-invocation

Write test proving transaction not applied to self-invoked method if runtime behaves that way.

## 37.6 Test concurrency

Use multi-thread test for:

- optimistic lock;
- unique constraint race;
- deadlock retry;
- idempotency key.

## 37.7 Test outbox

Test:

- business row + outbox row committed together;
- rollback removes both;
- relay publishes;
- duplicate relay safe;
- consumer idempotent.

## 37.8 Test with real DB

Use Testcontainers/real database because H2 may not reproduce locking/isolation behavior.

## 37.9 Test transaction timeout

Set small timeout and force slow query/work.

Verify rollback and error mapping.

---

# 38. Migration Notes: Java EE/Spring ke Jakarta Transactions

## 38.1 Namespace migration

Old:

```java
import javax.transaction.Transactional;
import javax.transaction.UserTransaction;
```

New:

```java
import jakarta.transaction.Transactional;
import jakarta.transaction.UserTransaction;
```

## 38.2 Do not migrate XA package blindly

`javax.transaction.xa` belongs to Java SE.

Keep:

```java
javax.transaction.xa.XAResource
```

where appropriate.

## 38.3 Spring Boot 2 to 3

Spring Boot 3 moved to Jakarta namespace.

If using standard JTA annotation, migrate to `jakarta.transaction.Transactional`.

But many Spring apps use Spring's own:

```java
org.springframework.transaction.annotation.Transactional
```

which has Spring-specific attributes.

## 38.4 Behavior comparison

Before migration, compare:

- rollback rules;
- propagation options;
- timeout config;
- read-only behavior;
- transaction manager bean;
- JPA provider version;
- datasource config;
- test behavior.

## 38.5 Do not assume annotation equivalence

`jakarta.transaction.Transactional` and Spring `@Transactional` overlap but are not identical in attributes/semantics.

Use project standard intentionally.

---

# 39. Production Failure Modes

## 39.1 Transaction not active

Causes:

- object not managed;
- self-invocation;
- method not public/business method;
- transaction interceptor disabled;
- wrong annotation namespace;
- called from async thread without context.

## 39.2 Unexpected commit

Causes:

- exception swallowed;
- checked exception not configured for rollback;
- `dontRollbackOn` misused;
- manual transaction commit in wrong place.

## 39.3 Unexpected rollback

Causes:

- transaction marked rollback-only;
- timeout;
- constraint violation;
- exception from interceptor;
- resource failure;
- optimistic lock failure;
- nested call marked rollback.

## 39.4 Partial side effect

Causes:

- external HTTP call inside transaction;
- email sent before rollback;
- message published outside transaction;
- cache updated before commit.

## 39.5 Connection pool exhaustion

Causes:

- long transactions;
- slow queries;
- external call while holding connection;
- too many concurrent requests;
- pool too small or replicas too many.

## 39.6 Deadlock storm

Causes:

- inconsistent row access order;
- long transaction;
- missing indexes;
- batch update;
- hot rows.

## 39.7 Lost event

DB commit succeeds, app crashes before publish.

Fix: outbox.

## 39.8 Duplicate processing

Client retry or message redelivery.

Fix: idempotency key / processed message table.

## 39.9 XA in-doubt transaction

Resource/coordinator crash during 2PC.

Need recovery tooling.

## 39.10 Timeout ambiguity

Client sees timeout but server committed.

Fix: idempotency + status query.

---

# 40. Best Practices dan Anti-Patterns

## 40.1 Best practices

- Put transaction boundary at application use case.
- Keep transaction short.
- Avoid external calls inside transaction.
- Use `REQUIRED` as default.
- Use `REQUIRES_NEW` only with explicit semantics.
- Use `MANDATORY` for repository/helper methods that require caller transaction.
- Configure timeouts.
- Use optimistic locking for concurrent edits.
- Use unique constraints for idempotency/invariants.
- Use outbox for DB + message consistency.
- Make consumers idempotent.
- Test rollback/timeout/concurrency.
- Monitor rollback/deadlock/timeout/pool metrics.

## 40.2 Anti-pattern: Transaction in controller everywhere

Transport layer should not own business consistency.

## 40.3 Anti-pattern: External call inside transaction

```java
@Transactional
public void approve(...) {
    repository.save(...);
    externalApi.call(...);
}
```

If external call is slow, transaction stays open.

If transaction rolls back after external call, external side effect remains.

## 40.4 Anti-pattern: Catch and log

```java
catch (Exception e) {
    log.error("failed", e);
}
```

Can commit bad partial state.

## 40.5 Anti-pattern: `REQUIRES_NEW` everywhere

Breaks atomicity and creates surprising partial commits.

## 40.6 Anti-pattern: One giant batch transaction

Rollback and lock cost huge.

Use chunks.

## 40.7 Anti-pattern: No transaction timeout

Every production system needs timeouts.

## 40.8 Anti-pattern: Assuming message publish is atomic with DB

Unless using XA or outbox, it is not.

## 40.9 Anti-pattern: Retrying non-idempotent command

Can duplicate side effects.

---

# 41. Checklist Review

## 41.1 Boundary

- [ ] Is transaction boundary at use case/application service?
- [ ] Is transaction as short as possible?
- [ ] Are helper/internal methods not pretending to own transaction?
- [ ] Is self-invocation avoided?

## 41.2 Propagation

- [ ] Is `REQUIRED` default sufficient?
- [ ] Is `REQUIRES_NEW` justified with ADR/comment?
- [ ] Is `MANDATORY` used where lower layer requires caller transaction?
- [ ] Are `NOT_SUPPORTED`/`NEVER` used for external/forbidden transaction cases?

## 41.3 Rollback

- [ ] Are checked exceptions configured with `rollbackOn` if needed?
- [ ] Are exceptions not swallowed?
- [ ] Is `dontRollbackOn` justified?
- [ ] Are rollback-only cases observable?

## 41.4 Side effects

- [ ] Are external calls outside transaction or explicitly safe?
- [ ] Is message publish coordinated via XA/outbox?
- [ ] Is email/payment/cache side effect safe?
- [ ] Is audit transactionally consistent if required?

## 41.5 Concurrency

- [ ] Is optimistic/pessimistic locking chosen consciously?
- [ ] Are unique constraints used for invariants?
- [ ] Is retry bounded and idempotent?
- [ ] Are deadlock scenarios tested?

## 41.6 Operations

- [ ] Transaction timeout configured?
- [ ] Query timeout configured?
- [ ] Connection pool sized correctly?
- [ ] Rollback/timeout/deadlock metrics present?
- [ ] Outbox lag monitored?

## 41.7 Testing

- [ ] Rollback integration test?
- [ ] Propagation test?
- [ ] Timeout test?
- [ ] Concurrency test?
- [ ] Outbox/idempotency test?
- [ ] Real DB test?

---

# 42. Case Study 1: Case Approval dengan JPA dan Audit Outbox

## 42.1 Requirement

When officer approves case:

- case status changes to APPROVED;
- approval reason stored;
- audit event must exist;
- domain event must be published eventually;
- no audit gap allowed.

## 42.2 Good design

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    @Inject CaseRepository repository;
    @Inject OutboxRepository outbox;
    @Inject Clock clock;

    @Transactional
    public ApproveCaseResult handle(ApproveCase command) {
        EnforcementCase c = repository.get(command.caseId());
        c.approve(command.actor(), command.reason(), clock.instant());

        repository.save(c);

        outbox.append(DomainEventEnvelope.from(
            c.pullDomainEvents(),
            command.correlationId()
        ));

        return ApproveCaseResult.from(c);
    }
}
```

## 42.3 Why good?

Business state and outbox event commit atomically.

If transaction rolls back, no outbox event.

If app crashes after commit, relay later publishes.

## 42.4 Add idempotency

Within same transaction:

```text
insert idempotency key
apply approval
insert outbox
commit
```

## 42.5 Observability

Track:

- approval transaction duration;
- rollback count;
- outbox append failure;
- outbox relay lag;
- duplicate idempotency key.

---

# 43. Case Study 2: External HTTP Call di Dalam Transaction

## 43.1 Bad design

```java
@Transactional
public void approve(ApproveCase command) {
    Case c = repository.get(command.caseId());
    c.approve(...);
    repository.save(c);
    riskEngine.notifyApproval(c); // HTTP call
}
```

## 43.2 Problems

- DB transaction open while waiting network;
- external call may succeed then DB rollback;
- external call may timeout but still succeed remotely;
- retries can duplicate notification;
- connection pool held longer.

## 43.3 Better design

Inside transaction:

```text
update case
insert outbox event RiskApprovalNotificationRequested
commit
```

After commit:

```text
worker sends HTTP call with idempotency key
records result
retries safely
```

## 43.4 If external validation needed before approval

Call external service before transaction if it does not depend on locked DB state.

Then open transaction, re-check state, commit.

## 43.5 Lesson

External side effects and DB transaction need explicit coordination pattern.

---

# 44. Case Study 3: Kafka/JMS Publish Setelah DB Commit

## 44.1 Bad design

```java
@Transactional
public void createApplication(...) {
    repository.save(application);
}

kafka.send(event);
```

If crash between commit and send, event lost.

## 44.2 JMS XA option

If using JMS XA and JTA, message send can participate in same transaction.

Good for classic Jakarta EE monolith with JMS.

## 44.3 Kafka/outbox option

For Kafka:

```text
DB transaction writes outbox
CDC/relay publishes to Kafka
consumer idempotent
```

## 44.4 Consumer side

Store processed event ID to prevent duplicate side effect.

## 44.5 Lesson

DB + broker consistency must be designed. It is not automatic.

---

# 45. Case Study 4: `REQUIRES_NEW` untuk Audit — Berguna atau Berbahaya?

## 45.1 Design

```java
@Transactional
public void approve(...) {
    auditService.recordAttempt(...); // REQUIRES_NEW
    repository.save(...);
    maybeFail();
}
```

`auditService.recordAttempt` commits even if main transaction rolls back.

## 45.2 When useful

If audit requirement says:

```text
Every attempt must be recorded, even failed attempts.
```

Then `REQUIRES_NEW` may be valid.

## 45.3 When dangerous

If audit says:

```text
Record only committed business state change.
```

Then `REQUIRES_NEW` produces misleading audit.

## 45.4 Better separation

Use two audit event types:

- attempt audit independent;
- committed state audit in same transaction/outbox.

## 45.5 Lesson

`REQUIRES_NEW` is a semantic decision, not a logging trick.

---

# 46. Latihan Bertahap

## Latihan 1 — Basic rollback

Buat method `@Transactional` yang persist row lalu throw runtime exception.

Verifikasi row rollback.

## Latihan 2 — Checked exception rollback

Throw checked exception.

Lihat apakah rollback terjadi.

Tambahkan `rollbackOn` dan test lagi.

## Latihan 3 — `REQUIRES_NEW`

Main transaction save row A then call audit `REQUIRES_NEW` row B then fail.

Verifikasi B committed, A rollback.

Diskusikan semantics.

## Latihan 4 — `MANDATORY`

Repository method annotated `MANDATORY`.

Call inside and outside transaction.

## Latihan 5 — Self-invocation

Method A calls method B annotated `@Transactional` inside same class.

Test whether transaction active.

## Latihan 6 — Timeout

Set transaction timeout small.

Simulate slow operation.

Verify rollback and error mapping.

## Latihan 7 — Optimistic locking

Two transactions update same entity with `@Version`.

Expect conflict.

## Latihan 8 — Deadlock simulation

Two threads update rows in opposite order.

Observe deadlock and implement bounded retry.

## Latihan 9 — Outbox

Within transaction, update business row + insert outbox.

Crash simulation before relay.

Verify relay publishes after restart.

## Latihan 10 — Idempotency

Send same command twice with same key.

Ensure second request returns same result or known duplicate response.

---

# 47. Mini Project: Transaction Boundary Lab

## 47.1 Goal

Buat project:

```text
jakarta-transaction-boundary-lab/
```

## 47.2 Modules

```text
basic-transaction/
rollback-rules/
propagation/
jpa-flush-locking/
outbox-pattern/
idempotent-command/
message-consumer/
batch-chunk/
timeout-deadlock/
```

## 47.3 Requirements

- Jakarta EE 11 or compatible runtime/framework;
- `jakarta.transaction.Transactional`;
- real database via Testcontainers;
- optional JMS/Kafka/outbox module;
- integration tests;
- metrics/logging;
- failure mode docs.

## 47.4 Deliverables

```text
README.md
TRANSACTION-MENTAL-MODEL.md
BOUNDARY-DECISIONS.md
ROLLBACK-RULES.md
PROPAGATION-MATRIX.md
OUTBOX-DESIGN.md
IDEMPOTENCY.md
DEADLOCK-REPORT.md
PRODUCTION-CHECKLIST.md
```

## 47.5 Suggested domain

```text
Regulatory case approval
License application submission
Document verification
Audit event publishing
Notification dispatch
```

## 47.6 Evaluation questions

1. Where is transaction boundary?
2. Which operations are inside transaction?
3. Which side effects are outside?
4. What causes rollback?
5. What happens on checked exception?
6. What is idempotency key?
7. How is event publishing made reliable?
8. What is timeout?
9. What happens on deadlock?
10. Is XA needed or outbox enough?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta Transactions 2.0 Specification  
   https://jakarta.ee/specifications/transactions/2.0/jakarta-transactions-spec-2.0.html

2. Jakarta Transactions Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/transactions/transactions.html

3. Jakarta Transactions 2.0 API Docs  
   https://jakarta.ee/specifications/transactions/2.0/apidocs/

4. Package `jakarta.transaction` API Summary  
   https://jakarta.ee/specifications/transactions/2.0/apidocs/jakarta/transaction/package-summary.html

5. `jakarta.transaction.Transactional` API Docs  
   https://javadoc.io/static/jakarta.transaction/jakarta.transaction-api/2.0.1/jakarta/transaction/Transactional.html

6. Maven Central — `jakarta.transaction:jakarta.transaction-api`  
   https://central.sonatype.com/artifact/jakarta.transaction/jakarta.transaction-api

7. Jakarta Transactions GitHub Project  
   https://github.com/jakartaee/transactions

8. Jakarta Persistence 3.2  
   https://jakarta.ee/specifications/persistence/3.2/

9. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

10. Jakarta EE Platform 11  
    https://jakarta.ee/specifications/platform/11/

---

# Penutup

Jakarta Transactions adalah fondasi consistency dalam Jakarta EE.

Tetapi mental model yang benar bukan:

```text
Tambah @Transactional lalu aman.
```

Mental model yang benar:

```text
Transaction is a carefully chosen consistency boundary.
```

Kamu harus tahu:

- kapan transaction dimulai;
- resource mana yang ikut;
- kapan commit;
- kapan rollback;
- exception mana yang memicu rollback;
- apakah side effect ikut transaction;
- apakah retry aman;
- apakah operation idempotent;
- apakah lock/timeout terkendali;
- apakah event publish reliable.

Ringkasnya:

```text
Use @Transactional for local consistency.
Use XA only when strong atomicity across XA resources is truly required and ops can support it.
Use outbox/saga/idempotency for distributed systems and external side effects.
```

Engineer top-tier tidak hanya membuat data “tersimpan”. Ia mendesain sistem agar tetap benar saat timeout, retry, crash, duplicate request, deadlock, broker down, dan partial failure.

Bagian berikutnya akan membahas **Jakarta Validation (`jakarta.validation`)**, yaitu cara membuat validation contract yang benar: input validation, bean validation, method validation, groups, cascaded validation, custom constraints, error mapping, dan batas antara validation annotation vs domain invariant.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-013.md">⬅️ Bagian 13 — Jakarta Data: Repository Abstraction Standar</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-015.md">Bagian 15 — Jakarta Validation (`jakarta.validation`): Contract Validation, Constraints, Groups, dan Integration Boundary ➡️</a>
</div>
