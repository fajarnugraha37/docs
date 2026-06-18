# learn-java-part-018 — Enterprise Java dan Backend Engineering

> Target pembaca: software engineer yang sudah memahami fondasi Java, object model, generics, collections, error handling, concurrency, I/O, JVM, GC, observability, security, testing, dan packaging/module.
>
> Tujuan bagian ini: membangun mental model untuk merancang, mengimplementasikan, menguji, mengoperasikan, dan mengevolusikan **backend enterprise Java** yang benar, aman, observable, transactional, scalable, dan maintainable.

---

## 0. Posisi Bagian Ini dalam Peta Belajar Java

Bagian-bagian sebelumnya membangun fondasi teknis:

- bahasa Java;
- object model;
- type system;
- functional style;
- collections;
- exception dan failure model;
- concurrency;
- I/O dan networking;
- JVM internal;
- memory/GC;
- observability;
- security;
- modules/packaging;
- testing.

Bagian 18 menggabungkan semua itu ke konteks **backend engineering**.

Enterprise Java bukan berarti “kode Java yang memakai Spring Boot”. Enterprise Java adalah kemampuan menggunakan Java untuk membangun sistem yang:

1. melayani proses bisnis penting;
2. menjaga invariant data;
3. menangani transaksi dan partial failure;
4. bisa diobservasi dan diaudit;
5. aman;
6. bisa dikembangkan banyak tim;
7. bisa dimigrasikan tanpa merusak compatibility;
8. bisa berjalan stabil di production.

Kalau fondasi Java adalah “cara mesin bekerja”, maka bagian ini adalah “cara mesin itu dipakai untuk membuat sistem nyata”.

---

## 1. Mental Model Enterprise Backend

### 1.1 Backend bukan hanya endpoint HTTP

Kesalahan umum engineer backend pemula adalah menganggap backend sebagai kumpulan controller:

```text
HTTP request -> Controller -> Service -> Repository -> Database
```

Model itu berguna sebagai awal, tetapi terlalu dangkal. Backend production sebenarnya adalah sistem yang mengelola:

```text
External actor
  -> API boundary
  -> authentication / authorization
  -> request validation
  -> command/query boundary
  -> application use case
  -> domain invariant
  -> transaction boundary
  -> persistence boundary
  -> integration boundary
  -> event/message boundary
  -> observability boundary
  -> audit boundary
  -> operational control boundary
```

Setiap boundary memiliki failure mode berbeda.

Contoh request sederhana:

```http
POST /cases/{caseId}/escalations
```

Secara teknis terlihat seperti insert row. Secara enterprise, operasi ini bisa berarti:

- user harus punya hak melakukan escalation;
- case harus berada pada state yang memperbolehkan escalation;
- escalation tidak boleh duplikat;
- SLA timer mungkin berubah;
- assignee mungkin berubah;
- audit trail wajib tercatat;
- notification perlu dikirim;
- event perlu dipublish;
- downstream system mungkin gagal;
- response harus jelas apakah request diterima, ditolak, atau gagal teknis.

Jadi backend bukan hanya “CRUD”. Backend adalah **system of decisions, invariants, effects, and evidence**.

### 1.2 Core abstraction backend enterprise

Backend enterprise biasanya terdiri dari beberapa abstraction utama:

| Abstraction | Pertanyaan yang dijawab |
|---|---|
| API | Bagaimana actor berinteraksi dengan sistem? |
| Command | Perubahan apa yang diminta? |
| Query | Informasi apa yang diminta? |
| Use case | Proses aplikasi apa yang dijalankan? |
| Domain model | Aturan bisnis apa yang harus selalu benar? |
| Transaction | Perubahan mana yang harus atomik? |
| Repository | Bagaimana state disimpan/dibaca? |
| Event | Fakta apa yang telah terjadi? |
| Integration | Sistem eksternal apa yang perlu diberi tahu/diminta? |
| Policy | Keputusan apa yang berbasis aturan? |
| Audit | Bukti apa yang harus tersedia? |
| Observability | Bagaimana kita tahu sistem sehat atau gagal? |

Engineer top-tier tidak hanya menulis class untuk setiap layer. Ia memahami **alasan boundary itu ada**.

---

## 2. Enterprise Java Landscape: Jakarta EE, Spring, dan Ekosistem Modern

### 2.1 Java Enterprise historis

Secara historis, enterprise Java tumbuh dari:

- Servlet;
- JSP;
- EJB;
- JPA;
- JMS;
- JTA;
- Bean Validation;
- CDI;
- JAX-RS;
- Jakarta EE.

Sebagian engineer modern lebih sering memakai Spring Boot daripada Jakarta EE server penuh. Tetapi banyak konsep Spring tetap beririsan dengan konsep enterprise Java klasik:

| Konsep | Jakarta EE | Spring ecosystem |
|---|---|---|
| Dependency injection | CDI | Spring IoC Container |
| Transaction | JTA / Jakarta Transactions | Spring Transaction Abstraction |
| Persistence | Jakarta Persistence/JPA | Spring Data JPA + Hibernate |
| Messaging | Jakarta Messaging/JMS | Spring JMS / Spring AMQP / Spring Kafka |
| REST | Jakarta REST | Spring MVC/WebFlux |
| Validation | Jakarta Bean Validation | Spring Validation integration |
| Security | Jakarta Security | Spring Security |

Mental model yang penting: **framework berbeda, masalah sama**.

### 2.2 Jakarta EE 11

Jakarta EE 11 adalah versi platform Jakarta EE modern. Untuk backend engineer Java, spesifikasi Jakarta penting karena banyak framework dan library menggunakan API Jakarta:

- `jakarta.persistence.*` untuk JPA;
- `jakarta.transaction.*` untuk transaksi;
- `jakarta.validation.*` untuk validation;
- `jakarta.servlet.*` untuk Servlet;
- `jakarta.jms.*` untuk messaging;
- `jakarta.ws.rs.*` untuk REST;
- `jakarta.enterprise.*` untuk CDI.

Walaupun kamu memakai Spring Boot, kamu tetap sering berinteraksi dengan Jakarta API, terutama sejak migrasi dari namespace `javax.*` ke `jakarta.*`.

### 2.3 Spring ecosystem

Spring Framework menyediakan programming dan configuration model untuk enterprise applications. Spring Boot menambahkan opini dan auto-configuration agar aplikasi bisa dibuat dan dijalankan dengan lebih sedikit konfigurasi manual.

Ekosistem penting:

| Area | Project |
|---|---|
| Core container | Spring Framework |
| Application bootstrap | Spring Boot |
| Web imperative | Spring MVC |
| Web reactive | Spring WebFlux |
| Persistence abstraction | Spring Data |
| Transaction | Spring Transaction |
| Security | Spring Security |
| Monitoring | Spring Boot Actuator / Micrometer |
| Messaging | Spring Kafka / Spring AMQP / Spring Integration |
| Batch | Spring Batch |
| Cloud patterns | Spring Cloud |

Jangan berpikir Spring Boot sebagai “magic”. Pikirkan sebagai:

```text
classpath + auto-configuration conditions + beans + configuration properties + runtime environment
```

Spring Boot menebak konfigurasi berdasarkan dependency, classpath, property, environment, dan bean yang sudah ada.

---

## 3. Backend Architecture: Layered, Hexagonal, Clean, Modulith, Microservices

### 3.1 Arsitektur bukan folder structure

Arsitektur bukan sekadar:

```text
controller/
service/
repository/
model/
```

Folder tersebut bisa ada, tetapi tidak otomatis membuat arsitektur bagus.

Arsitektur yang baik menjawab:

1. Apa boundary sistem?
2. Siapa boleh bergantung ke siapa?
3. Di mana business invariant dijaga?
4. Di mana transaksi dimulai/diakhiri?
5. Di mana dependency eksternal disembunyikan?
6. Bagaimana test dilakukan tanpa database/message broker nyata?
7. Bagaimana failure diklasifikasikan?
8. Bagaimana module bisa berubah tanpa merusak module lain?

### 3.2 Layered architecture

Model klasik:

```text
API Layer
  -> Application/Service Layer
    -> Domain Layer
      -> Persistence/Infrastructure Layer
```

Atau versi umum Spring:

```text
Controller -> Service -> Repository -> Database
```

#### Kelebihan

- mudah dipahami;
- cocok untuk CRUD sederhana;
- onboarding cepat;
- mapping ke framework mudah.

#### Kelemahan

- service layer sering menjadi God Service;
- domain logic bocor ke controller/repository;
- dependency ke database/framework mudah menyebar;
- testing domain sering berat karena bergantung ke Spring context;
- transaction boundary sering tidak eksplisit.

#### Kapan cukup?

Layered architecture cukup untuk:

- aplikasi kecil;
- CRUD administratif;
- domain rule ringan;
- tim kecil;
- sistem dengan lifecycle pendek.

Tetapi untuk enforcement lifecycle, regulatory case management, workflow, dan cross-entity impact, layered architecture polos biasanya tidak cukup.

### 3.3 Hexagonal architecture

Hexagonal architecture memisahkan core application/domain dari external adapter.

```text
              REST Adapter
                  |
CLI Adapter -> Application Core <- Scheduler Adapter
                  |
             Persistence Port
                  |
          Database Adapter
```

Konsep utamanya:

- core tidak tahu HTTP;
- core tidak tahu database vendor;
- core tidak tahu Kafka/RabbitMQ detail;
- core hanya tahu port/interface;
- adapter menerjemahkan dunia luar ke core.

#### Struktur contoh

```text
case-management/
  src/main/java/com/acme/caseapp/
    casecore/
      Case.java
      CaseState.java
      CaseTransitionPolicy.java
      CaseRepository.java        // port
      CaseEventPublisher.java    // port
      EscalateCaseUseCase.java
    adapter/
      web/
        CaseController.java
      persistence/
        JpaCaseRepository.java
        CaseEntity.java
      messaging/
        KafkaCaseEventPublisher.java
```

#### Port inbound vs outbound

Inbound port:

```java
public interface EscalateCaseUseCase {
    EscalateCaseResult escalate(EscalateCaseCommand command);
}
```

Outbound port:

```java
public interface CaseRepository {
    Optional<Case> findById(CaseId id);
    void save(Case aggregate);
}
```

Adapter web memanggil inbound port. Core memanggil outbound port. Implementasi outbound port ada di infrastructure.

#### Manfaat

- business logic testable tanpa Spring/database;
- dependency eksternal tidak mengkontaminasi domain;
- migration lebih mudah;
- command/event modeling lebih rapi;
- cocok untuk domain dengan state machine.

#### Risiko

- bisa over-engineered untuk aplikasi kecil;
- terlalu banyak interface jika tidak disiplin;
- developer bisa membuat port yang hanya copy repository CRUD;
- mapping antar layer bisa terlalu verbose.

### 3.4 Clean architecture

Clean architecture mirip hexagonal, dengan dependency rule sangat jelas:

```text
Frameworks/Drivers
  -> Interface Adapters
    -> Application Use Cases
      -> Enterprise Business Rules
```

Dependency mengarah ke dalam. Domain tidak bergantung pada framework.

Untuk Java/Spring, prinsip ini berarti:

- entity/domain object sebaiknya tidak perlu `@Entity` jika ingin benar-benar persistence-agnostic;
- use case tidak bergantung ke `HttpServletRequest`;
- domain tidak melempar `ResponseStatusException`;
- repository port tidak memaksa memakai `JpaRepository` di core;
- transaksi didefinisikan di application boundary, bukan sembarang method.

### 3.5 Modulith

Modulith adalah aplikasi tunggal yang modular secara internal.

```text
single deployable
  ├── licensing module
  ├── enforcement module
  ├── correspondence module
  ├── document module
  ├── audit module
  └── notification module
```

Modulith bukan monolith berantakan. Modulith yang baik punya:

- explicit module boundary;
- allowed dependency direction;
- internal package yang tidak boleh dipakai module lain;
- events antar module;
- database ownership yang jelas;
- test boundary antar module.

#### Kapan modulith lebih baik dari microservices?

Modulith sering lebih baik ketika:

- domain belum stabil;
- tim belum cukup besar;
- distributed transaction terlalu mahal;
- latency antar module harus rendah;
- deployment complexity ingin ditekan;
- operational maturity belum siap.

Microservices bukan upgrade otomatis. Microservices memindahkan kompleksitas dari code structure ke distributed system.

### 3.6 Microservices

Microservice adalah service kecil yang punya boundary bisnis dan operasional sendiri.

Ciri sehat:

- independent deployability;
- own data ownership;
- clear API/event contract;
- autonomous team ownership;
- isolated failure domain;
- observability per service;
- compatibility/versioning strategy.

Ciri buruk:

- service dipotong berdasarkan table CRUD;
- semua service sharing database;
- synchronous chain panjang;
- tidak ada idempotency;
- tidak ada tracing;
- tidak ada contract testing;
- deployment harus serentak;
- event schema berubah sembarangan.

#### Rule praktis

Jangan mulai dari “berapa microservice”. Mulai dari:

1. bounded context;
2. data ownership;
3. transaction boundary;
4. team boundary;
5. failure isolation;
6. release cadence;
7. compliance/audit boundary.

---

## 4. Spring Core dan Dependency Injection

### 4.1 Dependency Injection mental model

Dependency injection bukan sekadar `@Autowired`. DI adalah mekanisme untuk memisahkan:

- object creation;
- object wiring;
- object usage;
- object lifecycle;
- configuration.

Tanpa DI:

```java
class EscalateCaseService {
    private final CaseRepository repository = new JdbcCaseRepository();
}
```

Masalah:

- sulit test;
- concrete dependency tertanam;
- configuration tersebar;
- lifecycle tidak jelas;
- migration sulit.

Dengan DI:

```java
class EscalateCaseService {
    private final CaseRepository repository;

    EscalateCaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Sekarang service bergantung pada contract, bukan implementasi.

### 4.2 Spring IoC container

Spring IoC container mengelola object yang disebut bean.

Bean memiliki:

- name;
- type;
- dependencies;
- scope;
- lifecycle;
- configuration metadata;
- optional proxy.

Spring container bekerja kira-kira seperti ini:

```text
read configuration/classes
  -> discover bean definitions
  -> evaluate conditions
  -> create bean dependency graph
  -> instantiate beans
  -> inject dependencies
  -> apply post-processors
  -> create proxies if needed
  -> run lifecycle callbacks
  -> application ready
```

### 4.3 Constructor injection

Prefer constructor injection:

```java
@Service
public class EscalateCaseService {
    private final CaseRepository caseRepository;
    private final CaseTransitionPolicy transitionPolicy;

    public EscalateCaseService(
            CaseRepository caseRepository,
            CaseTransitionPolicy transitionPolicy
    ) {
        this.caseRepository = caseRepository;
        this.transitionPolicy = transitionPolicy;
    }
}
```

Manfaat:

- dependency eksplisit;
- object bisa immutable;
- test mudah;
- tidak bisa lupa injection;
- circular dependency lebih cepat ketahuan;
- tidak bergantung pada reflection field injection.

Hindari field injection:

```java
@Autowired
private CaseRepository repository;
```

Masalah:

- dependency tersembunyi;
- test manual sulit;
- object bisa ada dalam state tidak lengkap;
- circular dependency sering terlambat terlihat;
- final field tidak bisa dipakai.

### 4.4 Bean scope

Scope umum:

| Scope | Arti | Kapan dipakai |
|---|---|---|
| singleton | satu instance per container | default untuk service stateless |
| prototype | instance baru setiap request bean | jarang; perlu lifecycle hati-hati |
| request | satu per HTTP request | request-scoped context |
| session | satu per HTTP session | web session state |
| application | satu per servlet context | web app global state |

Default singleton bukan berarti global mutable state boleh sembarangan. Service singleton harus biasanya **stateless** atau state-nya thread-safe.

Buruk:

```java
@Service
public class CaseSearchService {
    private SearchCriteria lastCriteria; // shared mutable state: berbahaya
}
```

Baik:

```java
@Service
public class CaseSearchService {
    public SearchResult search(SearchCriteria criteria) {
        // criteria lokal per request
    }
}
```

### 4.5 Bean lifecycle

Lifecycle penting:

```text
constructor
  -> dependency injection
  -> aware callbacks
  -> bean post processors before init
  -> @PostConstruct / InitializingBean
  -> bean post processors after init
  -> ready
  -> @PreDestroy / DisposableBean on shutdown
```

Gunakan lifecycle hook untuk:

- validasi configuration;
- warming cache terbatas;
- membuka resource terkontrol;
- menutup resource.

Jangan gunakan lifecycle hook untuk:

- menjalankan migration data berat tanpa kontrol;
- memanggil downstream yang bisa membuat startup fail tidak perlu;
- menjalankan job bisnis otomatis tanpa lock/guard;
- menyembunyikan side effect besar.

### 4.6 Proxy dan AOP

Spring banyak memakai proxy untuk:

- transaction;
- security;
- caching;
- async;
- retry;
- metrics/tracing;
- validation.

Proxy berarti call harus melewati object proxy agar advice berjalan.

Masalah klasik: self-invocation.

```java
@Service
public class CaseService {

    public void outer() {
        inner(); // tidak melewati proxy
    }

    @Transactional
    public void inner() {
        // transaksi mungkin tidak aktif jika dipanggil dari outer dalam class yang sama
    }
}
```

Solusi desain:

- letakkan transactional boundary di method entry point public yang dipanggil dari luar bean;
- pisahkan use case ke bean lain;
- hindari desain yang membutuhkan self-proxy;
- pahami proxy mode.

### 4.7 Conditional configuration dan auto-configuration

Spring Boot auto-configuration biasanya berbasis condition:

- class ada di classpath;
- bean belum ada;
- property bernilai tertentu;
- resource ada;
- web application type;
- profile aktif.

Mental model:

```text
Dependency di build file mengubah classpath.
Classpath mengubah auto-configuration candidate.
Properties mengubah condition.
Condition mengubah bean graph.
Bean graph mengubah runtime behavior.
```

Ini alasan dependency kecil pun bisa mengubah aplikasi besar.

### 4.8 Configuration properties

Daripada membaca property manual:

```java
@Value("${case.escalation.max-attempts}")
int maxAttempts;
```

Lebih baik gunakan typed configuration:

```java
@ConfigurationProperties(prefix = "case.escalation")
public record EscalationProperties(
        int maxAttempts,
        Duration timeout,
        boolean auditEnabled
) {}
```

Manfaat:

- type-safe;
- bisa divalidasi;
- mudah dites;
- dokumentasi lebih jelas;
- mengurangi typo string property.

---

## 5. Application Layer: Use Case, Command, Query

### 5.1 Jangan membuat service layer sebagai tempat semua hal

Anti-pattern umum:

```java
@Service
public class CaseService {
    public CaseDto createCase(...)
    public CaseDto updateCase(...)
    public void assignCase(...)
    public void escalateCase(...)
    public void closeCase(...)
    public List<CaseDto> search(...)
    public void sendReminder(...)
    public void syncExternal(...)
}
```

Service seperti ini akan tumbuh menjadi God Service.

Lebih baik modelkan use case eksplisit:

```java
public interface EscalateCaseUseCase {
    EscalateCaseResult handle(EscalateCaseCommand command);
}
```

Command:

```java
public record EscalateCaseCommand(
        CaseId caseId,
        OfficerId requestedBy,
        EscalationReason reason,
        Instant requestedAt,
        IdempotencyKey idempotencyKey
) {}
```

Handler:

```java
@Service
public class EscalateCaseHandler implements EscalateCaseUseCase {
    private final CaseRepository cases;
    private final CaseTransitionPolicy policy;
    private final DomainEventPublisher events;

    public EscalateCaseHandler(
            CaseRepository cases,
            CaseTransitionPolicy policy,
            DomainEventPublisher events
    ) {
        this.cases = cases;
        this.policy = policy;
        this.events = events;
    }

    @Transactional
    @Override
    public EscalateCaseResult handle(EscalateCaseCommand command) {
        CaseRecord record = cases.getRequired(command.caseId());
        CaseEscalation escalation = record.escalate(command, policy);
        cases.save(record);
        events.publish(escalation.toEvent());
        return EscalateCaseResult.accepted(record.id(), record.version());
    }
}
```

### 5.2 Application layer responsibility

Application service/use case bertanggung jawab untuk:

- mengorkestrasi domain object;
- membuka transaction boundary;
- memanggil repository;
- memanggil domain service/policy;
- memproduksi event;
- mengatur idempotency;
- mengatur authorization use-case level;
- mengubah domain result menjadi application result.

Application layer **bukan** tempat terbaik untuk:

- semua business rule detail;
- SQL query kompleks yang domain-specific;
- HTTP response construction;
- framework annotation berlebihan;
- formatting UI;
- mapping entity persistence langsung ke response publik.

### 5.3 Command vs Query

Command mengubah state.

```java
public record AssignCaseCommand(CaseId caseId, OfficerId officerId) {}
```

Query membaca state.

```java
public record SearchCasesQuery(
        CaseStatus status,
        OfficerId assignedTo,
        PageRequest page
) {}
```

Pisahkan command dan query karena:

- transaksi berbeda;
- consistency expectation berbeda;
- authorization bisa berbeda;
- cacheability berbeda;
- observability berbeda;
- scalability berbeda.

Command biasanya:

- validated strictly;
- idempotent;
- audited;
- transactional;
- menghasilkan domain event.

Query biasanya:

- optimized for read;
- boleh eventual consistent dalam sistem tertentu;
- bisa memakai projection;
- bisa paginated;
- harus hati-hati dengan PII/filter authorization.

### 5.4 Result object

Jangan semua kegagalan domain dilempar sebagai exception. Domain rejection bisa dimodelkan eksplisit.

```java
public sealed interface EscalateCaseResult {
    record Accepted(CaseId caseId, long version) implements EscalateCaseResult {}
    record Rejected(CaseId caseId, String reasonCode, String message) implements EscalateCaseResult {}
}
```

Exception lebih cocok untuk failure teknis:

- database unreachable;
- timeout;
- serialization error;
- message broker down;
- programming bug.

Domain rejection:

- case sudah closed;
- user tidak punya authority;
- escalation reason tidak valid;
- SLA rule tidak terpenuhi.

---

## 6. Domain Modeling dalam Backend Java

### 6.1 Domain bukan entity JPA

Kesalahan besar:

```java
@Entity
public class CaseEntity {
    @Id Long id;
    String status;
    String assignee;
}
```

Lalu semua rule diletakkan di service:

```java
if (caseEntity.getStatus().equals("CLOSED")) throw ...
caseEntity.setStatus("ESCALATED");
```

Ini membuat domain menjadi data bag.

Model domain lebih baik:

```java
public final class CaseRecord {
    private final CaseId id;
    private CaseStatus status;
    private OfficerId assignee;
    private long version;

    public CaseEscalation escalate(EscalateCaseCommand command, CaseTransitionPolicy policy) {
        policy.assertCanEscalate(this, command);
        this.status = CaseStatus.ESCALATED;
        this.version++;
        return new CaseEscalation(id, version, command.reason(), command.requestedAt());
    }
}
```

Domain object menjaga invariant.

### 6.2 Entity, value object, aggregate

#### Entity

Punya identity stabil.

```java
public final class CaseRecord {
    private final CaseId id;
}
```

Dua case dengan ID sama merepresentasikan identity yang sama, walau field berubah.

#### Value object

Tidak punya identity sendiri. Equality berdasarkan value.

```java
public record CaseId(UUID value) {
    public CaseId {
        Objects.requireNonNull(value);
    }
}
```

```java
public record Money(BigDecimal amount, Currency currency) {}
```

Value object idealnya immutable.

#### Aggregate

Aggregate adalah consistency boundary. Satu aggregate menjaga invariant internalnya.

```text
CaseAggregate
  ├── case state
  ├── assignments
  ├── escalation history
  └── active reminders
```

Aturan: update aggregate harus lewat aggregate root.

### 6.3 Domain service vs application service

Application service mengorkestrasi use case.

Domain service mengekspresikan rule domain yang tidak natural menjadi method satu entity/value object.

Contoh domain policy:

```java
public interface CaseTransitionPolicy {
    void assertCanEscalate(CaseRecord record, EscalateCaseCommand command);
}
```

Implementasi:

```java
public class DefaultCaseTransitionPolicy implements CaseTransitionPolicy {
    @Override
    public void assertCanEscalate(CaseRecord record, EscalateCaseCommand command) {
        if (record.isClosed()) {
            throw new DomainRuleViolation("CASE_ALREADY_CLOSED");
        }
        if (!record.isAssigned()) {
            throw new DomainRuleViolation("CASE_NOT_ASSIGNED");
        }
    }
}
```

### 6.4 State machine modeling

Backend enterprise sering punya state machine.

Buruk:

```java
caseEntity.setStatus("APPROVED");
```

Baik:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED,
    REJECTED
}
```

Lebih kuat dengan transition object:

```java
public record CaseTransition(
        CaseStatus from,
        CaseStatus to,
        String reasonCode
) {}
```

Atau sealed transition:

```java
public sealed interface CaseCommand permits SubmitCase, EscalateCase, CloseCase {}

public record SubmitCase(CaseId id, OfficerId by) implements CaseCommand {}
public record EscalateCase(CaseId id, OfficerId by, EscalationReason reason) implements CaseCommand {}
public record CloseCase(CaseId id, OfficerId by, ClosureReason reason) implements CaseCommand {}
```

Handler bisa exhaustive:

```java
public CaseEvent handle(CaseCommand command) {
    return switch (command) {
        case SubmitCase submit -> submit(submit);
        case EscalateCase escalate -> escalate(escalate);
        case CloseCase close -> close(close);
    };
}
```

### 6.5 Auditability as domain concern

Untuk regulatory system, audit bukan “log biasa”. Audit harus menjawab:

- siapa melakukan aksi;
- kapan;
- dari state apa ke state apa;
- alasan keputusan;
- data apa yang berubah;
- rule/policy apa yang diterapkan;
- evidence/document apa yang relevan;
- correlation/request ID;
- apakah aksi sukses atau ditolak.

Domain event bisa menjadi basis audit:

```java
public record CaseEscalated(
        CaseId caseId,
        long version,
        OfficerId requestedBy,
        EscalationReason reason,
        Instant occurredAt,
        CorrelationId correlationId
) implements DomainEvent {}
```

---

## 7. Transaction Management

### 7.1 Transaction mental model

Transaction bukan annotation. Transaction adalah boundary atomicity dan isolation.

Transaction menjawab:

> Perubahan mana yang harus commit bersama atau rollback bersama?

Contoh:

```text
Escalate case transaction:
  1. load case row
  2. validate version/state
  3. update status
  4. insert audit row
  5. insert outbox event
  commit
```

Jika publish Kafka dilakukan langsung di tengah transaksi database, kamu akan masuk masalah dual-write.

### 7.2 ACID

| Properti | Makna praktis |
|---|---|
| Atomicity | semua perubahan commit atau tidak sama sekali |
| Consistency | invariant database/domain tidak dilanggar |
| Isolation | transaksi paralel tidak saling merusak secara tidak terkendali |
| Durability | commit tetap tersimpan setelah failure |

ACID bukan jaminan semua rule bisnis benar. ACID membantu menjaga konsistensi teknis. Rule bisnis tetap harus kamu modelkan.

### 7.3 Spring transaction abstraction

Spring menyediakan abstraction di atas berbagai transaction technology:

- JDBC `DataSourceTransactionManager`;
- JPA `JpaTransactionManager`;
- JTA transaction manager;
- reactive transaction manager.

`@Transactional` biasanya diletakkan di application service/use case boundary.

```java
@Transactional
public EscalateCaseResult handle(EscalateCaseCommand command) {
    ...
}
```

### 7.4 `@Transactional` proxy trap

`@Transactional` bekerja lewat proxy dalam konfigurasi umum Spring. Konsekuensi:

- method harus dipanggil dari luar proxy;
- self-invocation tidak kena advice;
- visibility method berpengaruh tergantung proxy mode;
- final class/method bisa bermasalah pada proxy subclass;
- exception rollback rule harus dipahami.

### 7.5 Rollback rules

Secara umum Spring rollback otomatis untuk unchecked exception (`RuntimeException`) dan `Error`, tetapi checked exception tidak selalu rollback kecuali dikonfigurasi.

Contoh:

```java
@Transactional(rollbackFor = ExternalVerificationException.class)
public void verify(...) throws ExternalVerificationException {
    ...
}
```

Namun jangan sembarang `rollbackFor = Exception.class`. Pahami arti exception.

Domain rejection bisa jadi tidak perlu rollback jika kamu memang ingin menyimpan audit rejection. Tetapi biasanya command invalid tidak mengubah state.

### 7.6 Propagation

Propagation umum:

| Propagation | Makna |
|---|---|
| REQUIRED | ikut transaksi yang ada atau buat baru |
| REQUIRES_NEW | suspend transaksi lama, buat transaksi baru |
| SUPPORTS | ikut jika ada, tidak buat baru |
| MANDATORY | wajib ada transaksi |
| NOT_SUPPORTED | jalankan tanpa transaksi |
| NEVER | gagal jika ada transaksi |
| NESTED | nested transaction/savepoint jika didukung |

#### `REQUIRES_NEW` untuk audit?

Kadang audit harus tetap tersimpan walau transaksi utama rollback.

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void recordFailureAudit(...) { ... }
```

Hati-hati:

- bisa menghabiskan connection pool;
- bisa membuat audit commit walau domain rollback;
- harus disengaja dan terdokumentasi.

### 7.7 Isolation

Isolation level umum:

| Isolation | Mencegah | Trade-off |
|---|---|---|
| READ_UNCOMMITTED | sangat lemah | jarang cocok |
| READ_COMMITTED | dirty read | umum default DB |
| REPEATABLE_READ | non-repeatable read | masih ada phantom tergantung DB |
| SERIALIZABLE | banyak anomaly | paling mahal |

Jangan naikkan isolation tanpa memahami anomaly yang ingin dicegah.

Untuk update state machine, sering lebih baik memakai optimistic locking daripada isolation tinggi global.

### 7.8 Optimistic locking

```java
@Entity
class CaseEntity {
    @Id
    private UUID id;

    @Version
    private long version;
}
```

Optimistic locking cocok ketika:

- conflict jarang;
- throughput penting;
- user bisa retry;
- update berdasarkan versi.

Failure mode:

- `OptimisticLockException` harus diterjemahkan ke conflict/retryable result;
- retry buta bisa membuat double effect;
- perlu idempotency.

### 7.9 Pessimistic locking

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
Optional<CaseEntity> findById(UUID id);
```

Cocok ketika:

- conflict sering;
- operasi singkat;
- invariant sulit dijaga dengan optimistic retry;
- duplicate processing sangat mahal.

Risiko:

- deadlock;
- lock wait timeout;
- throughput turun;
- chain blocking.

### 7.10 Transaction boundary dan external call

Anti-pattern:

```java
@Transactional
public void approveCase(...) {
    updateDatabase();
    externalSystem.notifyApproval(); // HTTP call dalam DB transaction
}
```

Masalah:

- transaction terbuka lama;
- lock tertahan;
- connection pool terpakai;
- external timeout membuat DB transaction lambat;
- rollback tidak bisa membatalkan external side effect.

Pattern lebih sehat:

```text
transaction:
  update database
  insert outbox event
commit

async publisher:
  read outbox
  publish message
  mark published
```

### 7.11 Outbox pattern

Outbox menyelesaikan masalah dual-write database + message broker.

```sql
CREATE TABLE outbox_event (
  id UUID PRIMARY KEY,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP NULL
);
```

Dalam transaksi domain:

```text
update case
insert audit
insert outbox event
commit
```

Publisher terpisah:

```text
poll unpublished outbox
publish to Kafka/RabbitMQ
mark published
```

Atau gunakan CDC seperti Debezium.

Invariant:

- jika database commit, event tidak hilang;
- event bisa duplicate, consumer harus idempotent;
- publish order harus dipikirkan per aggregate;
- payload event harus versioned.

---

## 8. Persistence: JDBC, JPA, Hibernate, Spring Data, jOOQ, MyBatis

### 8.1 Persistence bukan hanya “save entity”

Persistence layer menjawab:

- bagaimana domain state direpresentasikan di storage;
- bagaimana invariant didukung constraint;
- bagaimana query dieksekusi efisien;
- bagaimana transaksi dikontrol;
- bagaimana schema berevolusi;
- bagaimana concurrency conflict dideteksi;
- bagaimana data di-audit;
- bagaimana migration dilakukan.

### 8.2 JDBC

JDBC adalah abstraction dasar untuk SQL database.

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    try (PreparedStatement statement = connection.prepareStatement("""
            UPDATE cases
            SET status = ?, version = version + 1
            WHERE id = ? AND version = ?
            """)) {
        statement.setString(1, "ESCALATED");
        statement.setObject(2, caseId.value());
        statement.setLong(3, expectedVersion);
        int updated = statement.executeUpdate();
        if (updated != 1) {
            throw new ConcurrentModificationException();
        }
    }

    connection.commit();
} catch (SQLException e) {
    // translate exception
}
```

JDBC memberi kontrol tinggi, tetapi verbose.

Kelebihan:

- eksplisit;
- performa predictable;
- cocok untuk query kompleks;
- tidak ada hidden flush/lazy loading;
- mudah memahami SQL yang berjalan.

Kekurangan:

- mapping manual;
- boilerplate;
- error translation manual;
- sulit untuk graph object kompleks.

### 8.3 Spring JDBC

Spring JDBC mengurangi boilerplate:

- `JdbcTemplate`;
- `NamedParameterJdbcTemplate`;
- exception translation;
- resource management;
- transaction integration.

Contoh:

```java
@Repository
public class JdbcCaseRepository implements CaseRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public JdbcCaseRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<CaseSnapshot> findById(CaseId id) {
        return jdbc.query("""
                SELECT id, status, assignee, version
                FROM cases
                WHERE id = :id
                """,
                Map.of("id", id.value()),
                rs -> rs.next() ? Optional.of(map(rs)) : Optional.empty());
    }
}
```

### 8.4 JPA mental model

Jakarta Persistence/JPA adalah standard object-relational mapping.

Konsep utama:

- entity;
- persistence context;
- entity manager;
- managed/detached/transient/removed state;
- dirty checking;
- flush;
- lazy loading;
- JPQL/Criteria;
- transaction integration.

JPA bukan “SQL generator biasa”. JPA memiliki unit-of-work/persistence context.

```text
transaction starts
  -> load entity into persistence context
  -> entity becomes managed
  -> mutate fields
  -> dirty checking detects changes
  -> flush executes SQL
transaction commit
```

### 8.5 Entity lifecycle

State entity:

| State | Arti |
|---|---|
| transient/new | object belum dikenal persistence context |
| managed | dilacak persistence context |
| detached | pernah managed, sekarang tidak dilacak |
| removed | dijadwalkan dihapus |

Bug umum:

- mengubah detached entity lalu berharap auto-save;
- lazy loading setelah session/transaction tertutup;
- serializing entity langsung ke JSON;
- equals/hashCode entity salah;
- collection relationship memicu query tak terduga.

### 8.6 Persistence context

Persistence context adalah first-level cache dan identity map.

Dalam satu persistence context:

```text
find CaseEntity id=123 -> object A
find CaseEntity id=123 lagi -> object A yang sama
```

Ini membantu consistency, tetapi bisa membingungkan:

- query native update bisa membuat persistence context stale;
- flush timing mempengaruhi SQL;
- memory bisa naik jika batch processing tidak clear;
- long transaction menyimpan terlalu banyak managed entity.

### 8.7 Flush

Flush adalah sinkronisasi persistence context ke database.

Flush bisa terjadi:

- sebelum commit;
- sebelum query tertentu;
- manual `flush()`;
- tergantung flush mode.

Jangan menganggap SQL hanya berjalan di akhir method.

### 8.8 Lazy loading dan N+1

N+1:

```text
1 query: select cases
N query: select assignee for each case
```

Contoh buruk:

```java
List<CaseEntity> cases = caseRepository.findAll();
for (CaseEntity c : cases) {
    System.out.println(c.getAssignee().getName()); // lazy load N times
}
```

Solusi:

- fetch join;
- entity graph;
- projection query;
- batch size;
- DTO query;
- query khusus read model.

### 8.9 Entity design

Entity JPA perlu hati-hati:

- constructor protected/no-arg untuk JPA;
- jangan gunakan record sebagai entity mutable biasa;
- gunakan `@Version` untuk optimistic locking;
- jangan expose mutable collection langsung;
- hati-hati `equals/hashCode`;
- hindari logic bisnis berat bergantung pada lazy proxy;
- jangan serialize entity sebagai API response.

### 8.10 DTO dan projection

Untuk read API, jangan selalu return entity graph.

```java
public record CaseSummaryView(
        UUID id,
        String referenceNo,
        String status,
        String assigneeName,
        Instant updatedAt
) {}
```

Manfaat projection:

- query lebih ringan;
- response shape eksplisit;
- menghindari lazy loading surprise;
- menghindari expose internal schema;
- versioning API lebih aman.

### 8.11 Spring Data JPA

Spring Data JPA menyediakan repository abstraction di atas JPA.

Contoh:

```java
public interface CaseJpaRepository extends JpaRepository<CaseEntity, UUID> {
    Optional<CaseEntity> findByReferenceNo(String referenceNo);

    @Query("""
        select new com.acme.caseapp.CaseSummaryView(
            c.id, c.referenceNo, c.status, a.name, c.updatedAt
        )
        from CaseEntity c
        left join c.assignee a
        where c.status = :status
        """)
    Page<CaseSummaryView> findSummariesByStatus(CaseStatus status, Pageable pageable);
}
```

Kelebihan:

- cepat untuk CRUD;
- query method convenient;
- pagination/sorting;
- integration transaction;
- auditing support;
- specification/query by example.

Risiko:

- repository interface menjadi API publik terlalu luas;
- query method name terlalu panjang;
- entity bocor ke application/API layer;
- hidden query cost;
- delete/update behavior tidak dipahami;
- sulit mengontrol SQL kompleks.

### 8.12 Hibernate

Hibernate adalah ORM populer dan implementasi JPA. Hibernate juga punya fitur non-standard JPA.

Pahami:

- session/persistence context;
- dirty checking;
- proxies;
- bytecode enhancement;
- caching;
- batch fetching;
- query plan;
- dialect;
- schema generation;
- Envers auditing;
- connection handling.

Jangan treat Hibernate sebagai black box. Aktifkan SQL logging/profiling saat belajar, tetapi jangan logging full SQL bind value di production tanpa security review.

### 8.13 jOOQ

jOOQ cocok jika kamu ingin:

- SQL-first;
- type-safe query builder;
- kontrol query kuat;
- database-specific feature;
- reporting/query kompleks;
- compile-time generated table metadata.

Pattern umum:

- JPA untuk command aggregate sederhana;
- jOOQ untuk read model/reporting kompleks;
- atau jOOQ sepenuhnya untuk sistem SQL-heavy.

### 8.14 MyBatis

MyBatis cocok untuk:

- SQL manual;
- mapping semi-otomatis;
- legacy database;
- stored procedure;
- query yang ingin tetap eksplisit.

Trade-off:

- lebih banyak SQL manual;
- mapping harus dijaga;
- refactoring schema perlu disiplin;
- tidak punya unit-of-work seperti JPA.

### 8.15 Database migration

Gunakan migration tool:

- Flyway;
- Liquibase.

Prinsip:

- schema migration versioned;
- backward compatible deployment;
- avoid destructive change langsung;
- expand-contract pattern;
- migration besar dipisah dari deploy aplikasi;
- setiap index baru dianalisis impact lock-nya;
- data migration punya retry/restartability.

### 8.16 Transactional read model

Untuk query kompleks, read model bisa dipisah:

```text
Command model: normalized tables untuk invariant
Read model: denormalized projection untuk search/reporting
```

Dalam satu service:

- command table menjaga consistency;
- projection table mempercepat query;
- projection update via event/outbox.

Dalam microservice:

- service lain subscribe event;
- maintain own projection;
- eventual consistency perlu dikomunikasikan.

---

## 9. Web Backend: Spring MVC, WebFlux, Servlet, HTTP

### 9.1 HTTP boundary mental model

HTTP API boundary memiliki tanggung jawab:

- authentication;
- authorization coarse-grained;
- request parsing;
- request validation;
- idempotency key extraction;
- correlation ID extraction;
- content negotiation;
- response mapping;
- error mapping;
- rate limiting/throttling;
- API versioning;
- observability.

Controller sebaiknya tipis:

```java
@RestController
@RequestMapping("/cases")
public class CaseCommandController {
    private final EscalateCaseUseCase escalateCase;

    public CaseCommandController(EscalateCaseUseCase escalateCase) {
        this.escalateCase = escalateCase;
    }

    @PostMapping("/{caseId}/escalations")
    ResponseEntity<EscalateCaseResponse> escalate(
            @PathVariable UUID caseId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody EscalateCaseRequest request,
            Principal principal
    ) {
        EscalateCaseCommand command = request.toCommand(caseId, principal, idempotencyKey);
        EscalateCaseResult result = escalateCase.handle(command);
        return EscalateCaseHttpMapper.toResponse(result);
    }
}
```

Controller tidak seharusnya:

- menjalankan query bisnis kompleks;
- membuka transaksi manual;
- memanggil repository langsung untuk command penting;
- melakukan domain transition detail;
- expose entity persistence langsung.

### 9.2 Spring MVC mental model

Spring MVC berbasis Servlet API. Request flow sederhananya:

```text
HTTP request
  -> Servlet container
  -> Filter chain
  -> DispatcherServlet
  -> HandlerMapping
  -> HandlerAdapter
  -> Controller method
  -> Argument resolvers
  -> Message converters
  -> Return value handlers
  -> Exception resolvers
  -> HTTP response
```

Komponen penting:

- `Filter` untuk cross-cutting HTTP concern sebelum DispatcherServlet;
- `HandlerInterceptor` untuk concern MVC-level;
- `@ControllerAdvice` untuk exception/error mapping;
- `HttpMessageConverter` untuk JSON/XML/body conversion;
- validation via `@Valid`;
- `WebMvcConfigurer` untuk customization.

### 9.3 WebFlux mental model

Spring WebFlux adalah stack reactive non-blocking.

Jangan pakai WebFlux hanya karena terdengar modern.

WebFlux cocok ketika:

- workload I/O-bound non-blocking end-to-end;
- banyak long-lived connection;
- streaming;
- reactive ecosystem digunakan penuh;
- tim paham backpressure dan reactive debugging.

Kurang cocok ketika:

- mayoritas dependency blocking JDBC/JPA;
- tim belum familiar Reactor;
- hanya CRUD biasa;
- ingin simplicity;
- virtual threads sudah cukup.

Java modern membuat pilihan menarik:

| Model | Cocok untuk |
|---|---|
| Spring MVC + platform threads | klasik, stabil, mudah |
| Spring MVC + virtual threads | blocking style dengan concurrency tinggi |
| WebFlux | non-blocking reactive end-to-end |

### 9.4 Validation

Gunakan validation di boundary, tetapi jangan jadikan validation annotation sebagai satu-satunya domain rule.

Request validation:

```java
public record EscalateCaseRequest(
        @NotBlank String reasonCode,
        @Size(max = 1000) String remarks
) {}
```

Domain invariant:

```java
if (!policy.canEscalate(record, reason)) {
    throw new DomainRuleViolation("ESCALATION_NOT_ALLOWED");
}
```

Boundary validation memastikan shape input benar. Domain validation memastikan business invariant benar.

### 9.5 Error response

Gunakan error response konsisten.

Contoh Problem Details style:

```json
{
  "type": "https://api.example.com/problems/domain-rule-violation",
  "title": "Domain rule violation",
  "status": 409,
  "detail": "Case cannot be escalated after closure",
  "code": "CASE_ALREADY_CLOSED",
  "correlationId": "01J..."
}
```

Mapping:

| Error | HTTP |
|---|---|
| validation error | 400 |
| authentication missing/invalid | 401 |
| forbidden | 403 |
| not found | 404 |
| conflict/optimistic lock/domain state conflict | 409 |
| semantic validation | 422, jika policy API menggunakannya |
| rate limited | 429 |
| downstream unavailable | 503 |
| unexpected server error | 500 |

### 9.6 Pagination

Jangan expose pagination tanpa order stabil.

Buruk:

```sql
SELECT * FROM cases LIMIT 20 OFFSET 40;
```

tanpa `ORDER BY`.

Offset pagination bisa mahal untuk data besar.

Alternatif:

- keyset/cursor pagination;
- index sesuai sort/filter;
- stable ordering;
- max page size;
- filter whitelist.

### 9.7 API versioning

Versioning strategi:

- URI version: `/v1/cases`;
- header version;
- media type version;
- backward-compatible additive changes;
- event schema version.

Rule praktis:

- jangan rename/remove field tanpa deprecation;
- tambah field harus optional bagi client lama;
- enum baru bisa merusak client lama;
- error code adalah contract;
- pagination/sort semantics adalah contract;
- idempotency behavior adalah contract.

---

## 10. Security in Backend Layer

### 10.1 Spring Security mental model

Spring Security menyediakan:

- authentication;
- authorization;
- protection terhadap common attacks;
- integration dengan Servlet/reactive stack;
- filter chain;
- method security;
- OAuth2/OIDC support.

Flow umum Servlet stack:

```text
HTTP request
  -> Security filter chain
  -> authentication extraction
  -> authentication manager/provider
  -> security context
  -> authorization decision
  -> controller/use case
```

### 10.2 Authentication vs authorization

Authentication:

> Siapa kamu?

Authorization:

> Apa yang boleh kamu lakukan?

Jangan campur.

### 10.3 Coarse-grained vs fine-grained authorization

Coarse-grained di HTTP/security layer:

```java
@PreAuthorize("hasAuthority('CASE_ESCALATE')")
```

Fine-grained di domain/application layer:

```java
policy.assertOfficerCanEscalate(caseRecord, officer);
```

Karena permission global belum tentu cukup. User mungkin punya role escalation, tetapi tidak boleh escalate case yang bukan jurisdiction-nya.

### 10.4 Security context propagation

Dengan virtual threads dan async code, pahami context propagation. Jangan mengandalkan static/global mutable state. Gunakan explicit context atau mechanism framework yang benar.

Command sebaiknya membawa actor identity eksplisit:

```java
public record EscalateCaseCommand(
        CaseId caseId,
        OfficerId actor,
        Set<Authority> authorities,
        Jurisdiction jurisdiction,
        IdempotencyKey idempotencyKey
) {}
```

### 10.5 Common backend security pitfalls

- trust-all TLS client;
- expose entity field sensitif;
- log token/PII;
- mass assignment;
- broken object level authorization;
- missing idempotency on financial/state-changing endpoint;
- SSRF via URL input;
- path traversal pada file download;
- deserialization polymorphic unsafe;
- CORS terlalu permissive;
- SQL injection via string concat;
- missing rate limit;
- weak audit.

---

## 11. Messaging: Kafka, RabbitMQ, JMS, Events

### 11.1 Messaging mental model

Messaging dipakai untuk:

- decoupling temporal;
- async processing;
- buffering load;
- integration antar service;
- event notification;
- fan-out;
- workflow continuation.

Messaging tidak menghapus kompleksitas. Ia mengubahnya menjadi:

- ordering;
- retry;
- duplicate;
- poison message;
- schema compatibility;
- lag;
- backpressure;
- idempotency;
- observability.

### 11.2 Command vs event message

Command message:

> Tolong lakukan sesuatu.

```json
{
  "type": "SendCaseEscalationEmail",
  "caseId": "...",
  "recipient": "..."
}
```

Event message:

> Sesuatu telah terjadi.

```json
{
  "type": "CaseEscalated",
  "caseId": "...",
  "version": 12,
  "occurredAt": "2026-06-11T10:15:30Z"
}
```

Jangan namai command sebagai event. `CaseShouldBeEscalated` bukan event; itu command/request.

### 11.3 Kafka mental model

Kafka adalah distributed event streaming platform.

Konsep inti:

- topic;
- partition;
- offset;
- producer;
- consumer;
- consumer group;
- broker;
- replication;
- retention;
- compaction;
- key-based ordering;
- commit offset.

Ordering Kafka hanya dijamin dalam partition.

Jika semua event case perlu ordered per case:

```text
message key = caseId
```

Maka event case yang sama masuk partition yang sama.

### 11.4 Kafka producer concern

Producer decision:

- topic name;
- key;
- value schema;
- headers;
- `acks`;
- retries;
- idempotence;
- delivery timeout;
- compression;
- batching;
- partitioner;
- transaction, jika perlu.

Jangan publish event tanpa key jika ordering per aggregate penting.

### 11.5 Kafka consumer concern

Consumer harus memikirkan:

- consumer group;
- offset commit;
- retry;
- idempotency;
- DLQ;
- ordering;
- max poll interval;
- concurrency;
- rebalancing;
- poison message;
- backpressure;
- lag monitoring.

Pseudo consumer:

```java
public void onMessage(CaseEscalated event) {
    if (processedEventRepository.exists(event.eventId())) {
        return;
    }

    process(event);
    processedEventRepository.markProcessed(event.eventId());
}
```

### 11.6 RabbitMQ mental model

RabbitMQ/AMQP mental model:

- producer publishes to exchange;
- exchange routes to queues via bindings;
- consumer consumes from queue;
- ack/nack menentukan delivery;
- routing key menentukan route;
- dead-letter exchange untuk failed messages.

Kafka lebih log/event-stream oriented. RabbitMQ lebih queue/routing oriented.

### 11.7 JMS/Jakarta Messaging

JMS/Jakarta Messaging adalah standard API untuk messaging di Java enterprise. Cocok dalam lingkungan Jakarta EE atau sistem yang butuh abstraction standard di atas provider messaging.

Konsep:

- connection factory;
- destination;
- queue/topic;
- message producer;
- message consumer;
- acknowledgement;
- transaction/session.

### 11.8 Retry strategy

Retry harus diklasifikasikan.

| Failure | Retry? |
|---|---|
| transient network timeout | yes, with backoff |
| database deadlock | often yes |
| validation error | no |
| unknown enum schema | maybe quarantine/DLQ |
| downstream 400 | no |
| downstream 503 | yes |
| poison message | no after threshold |

Retry tanpa idempotency bisa membuat duplicate side effect.

### 11.9 DLQ

DLQ bukan tempat sampah permanen. DLQ adalah operational workflow.

DLQ message harus punya:

- original topic/queue;
- original key;
- payload;
- headers;
- failure reason;
- stack/message;
- retry count;
- timestamp;
- correlation ID;
- consumer name/version.

DLQ harus punya:

- dashboard;
- alert;
- replay tool;
- ownership;
- retention policy;
- PII/security policy.

### 11.10 Event schema evolution

Event adalah contract.

Rule:

- tambah field optional lebih aman;
- jangan rename field tanpa compatibility;
- jangan ubah semantic field;
- enum baru bisa breaking;
- timestamp format harus konsisten;
- ID harus stable;
- gunakan schema registry jika sistem besar;
- version payload atau event type jika perlu.

### 11.11 Exactly-once illusion

Distributed system jarang benar-benar exactly once secara end-to-end.

Lebih realistis:

```text
at-least-once delivery + idempotent consumer + deduplication + transactional state update
```

Untuk setiap consumer tanya:

1. Apa idempotency key-nya?
2. Di mana processed marker disimpan?
3. Apakah process dan marker commit atomik?
4. Apa yang terjadi jika crash setelah side effect sebelum commit offset?
5. Apa yang terjadi jika message duplicate?

---

## 12. API Design: REST, RPC, GraphQL, Async API

### 12.1 API sebagai contract

API bukan endpoint. API adalah contract antara provider dan consumer.

Contract meliputi:

- resource/operation;
- request shape;
- response shape;
- error format;
- status code;
- auth requirement;
- idempotency;
- pagination;
- sorting/filtering;
- rate limit;
- consistency semantics;
- versioning;
- deprecation policy.

### 12.2 REST design

REST-ish resource design:

```text
GET    /cases/{id}
POST   /cases
PATCH  /cases/{id}
POST   /cases/{id}/escalations
POST   /cases/{id}/assignments
GET    /cases?status=OPEN&assignedTo=...
```

Command yang bukan CRUD natural boleh dimodelkan sebagai sub-resource/action resource:

```text
POST /cases/{id}/escalations
POST /cases/{id}/closures
POST /cases/{id}/reopen-requests
```

Hindari:

```text
POST /doEscalateCase
GET  /approve?id=123
```

### 12.3 Idempotency

State-changing API harus mempertimbangkan duplicate request.

Header:

```http
Idempotency-Key: 01JXYZ...
```

Table:

```sql
CREATE TABLE idempotency_record (
  key VARCHAR(100) PRIMARY KEY,
  request_hash VARCHAR(128) NOT NULL,
  status VARCHAR(20) NOT NULL,
  response_body JSONB,
  created_at TIMESTAMP NOT NULL
);
```

Invariant:

- key sama + payload sama => return result sama;
- key sama + payload beda => reject;
- record punya TTL;
- storage update atomik dengan business operation jika perlu.

### 12.4 Async API

Untuk proses panjang:

```http
POST /case-import-jobs
202 Accepted
Location: /case-import-jobs/{jobId}
```

Kemudian:

```http
GET /case-import-jobs/{jobId}
```

Response:

```json
{
  "jobId": "...",
  "status": "PROCESSING",
  "processed": 1000,
  "failed": 2
}
```

Jangan menahan HTTP connection lama untuk proses berat jika tidak perlu.

### 12.5 RPC/gRPC

gRPC cocok untuk:

- service-to-service low latency;
- strongly typed contract;
- streaming;
- internal platform;
- polyglot environment.

Pertimbangkan:

- browser support;
- load balancer/proxy;
- observability;
- error model;
- backward compatibility protobuf;
- governance schema.

### 12.6 GraphQL

GraphQL cocok untuk:

- client membutuhkan shape fleksibel;
- banyak aggregate read;
- frontend-driven query;
- mengurangi over/under-fetching.

Risiko:

- query complexity tinggi;
- N+1 resolver;
- authorization per field sulit;
- caching berbeda;
- observability query-level perlu;
- schema governance penting.

### 12.7 API error code taxonomy

Error code harus stabil.

Contoh:

```text
CASE_NOT_FOUND
CASE_ALREADY_CLOSED
CASE_VERSION_CONFLICT
ESCALATION_REASON_INVALID
OFFICER_NOT_AUTHORIZED_FOR_JURISDICTION
DOWNSTREAM_DOCUMENT_SERVICE_UNAVAILABLE
```

Jangan gunakan message manusia sebagai contract utama. Message bisa berubah; code harus stabil.

---

## 13. Observability di Backend Enterprise

### 13.1 Minimum observability per request

Setiap request penting harus punya:

- correlation ID;
- trace ID/span ID;
- user/actor ID jika aman;
- endpoint/use case name;
- latency;
- result status;
- error code;
- domain outcome;
- dependency calls;
- DB latency;
- message publish status.

### 13.2 Structured logging

Buruk:

```java
log.info("case escalated " + caseId);
```

Lebih baik:

```java
log.info("case_escalated caseId={} version={} actor={} correlationId={}",
        caseId, version, actor, correlationId);
```

Atau JSON structured logs dengan field standar.

### 13.3 Metrics

Gunakan metrik:

- request count;
- request latency;
- error count;
- DB pool usage;
- transaction duration;
- message lag;
- DLQ count;
- retry count;
- domain rejection count;
- SLA breach count;
- thread pool saturation.

Hati-hati cardinality:

Buruk:

```text
case_id sebagai label metric
```

Baik:

```text
status, endpoint, outcome, error_code
```

### 13.4 Tracing

Trace membantu melihat request lintas service:

```text
API Gateway
  -> Case Service
    -> Database
    -> Document Service
    -> Kafka publish
      -> Notification Service consumer
```

Trace bukan pengganti log. Trace menunjukkan flow dan latency. Log memberi detail event. Metric memberi agregasi.

### 13.5 Audit vs log vs event

| Jenis | Tujuan |
|---|---|
| Log | diagnosis teknis |
| Metric | health dan trend |
| Trace | flow request lintas komponen |
| Audit | bukti bisnis/regulatory |
| Domain event | fakta bisnis untuk integrasi/projection |

Jangan campur. Audit harus immutable dan governed. Log bisa rotate.

---

## 14. Production Runtime Concerns

### 14.1 Thread pool

Backend Java sering punya banyak pool:

- HTTP server worker;
- DB connection pool;
- Kafka consumer threads;
- async executor;
- scheduler;
- virtual thread scheduler/carrier;
- blocking I/O pool;
- reactive event loop.

Mismatch pool bisa menyebabkan bottleneck.

Contoh:

```text
HTTP concurrency = 200
DB pool = 10
Each request needs DB
=> 190 requests wait; latency naik; timeout cascading
```

### 14.2 Connection pool

DB connection pool harus dilihat sebagai constrained resource.

Parameter penting:

- max pool size;
- min idle;
- connection timeout;
- idle timeout;
- max lifetime;
- leak detection;
- validation query/health;
- transaction duration.

Jangan menaikkan pool size tanpa melihat DB capacity.

### 14.3 Timeout

Setiap dependency call harus punya timeout.

- connect timeout;
- read timeout;
- request timeout;
- transaction timeout;
- message processing timeout;
- lock wait timeout.

Timeout harus lebih kecil dari upstream timeout agar error terkendali.

```text
client timeout 10s
API gateway timeout 9s
service timeout 8s
downstream timeout 2s with retry budget
```

### 14.4 Retry budget

Retry bisa memperburuk incident jika tidak dibatasi.

Gunakan:

- max attempts;
- exponential backoff;
- jitter;
- retry only transient errors;
- circuit breaker jika perlu;
- idempotency;
- retry budget per request.

### 14.5 Graceful shutdown

Aplikasi harus menangani shutdown:

- stop menerima request baru;
- selesaikan request berjalan;
- commit/rollback transaksi;
- stop consumer;
- flush metrics/logs;
- close connection pool;
- release lock;
- respect Kubernetes termination grace period.

### 14.6 Health checks

Readiness:

> Apakah service siap menerima traffic?

Liveness:

> Apakah process harus direstart?

Jangan jadikan liveness bergantung ke database sehingga DB outage membuat semua pod restart loop.

### 14.7 Configuration management

Configuration harus:

- typed;
- validated at startup;
- environment-specific;
- secret tidak masuk log;
- default aman;
- documented;
- observable via sanitized config endpoint jika perlu.

---

## 15. Spring Boot Production Engineering

### 15.1 Auto-configuration discipline

Spring Boot cepat, tetapi auto-configuration perlu governance.

Checklist:

- tahu starter apa yang dipakai;
- tahu bean apa yang auto-created;
- tahu property apa yang mengubah behavior;
- review condition evaluation saat debugging;
- hindari dependency tidak perlu;
- pin dependency via BOM;
- upgrade dengan release notes.

### 15.2 Actuator

Spring Boot Actuator biasanya dipakai untuk:

- health;
- metrics;
- info;
- env/configprops sanitized;
- loggers;
- threaddump;
- heapdump;
- prometheus endpoint.

Security:

- jangan expose actuator sensitif publik;
- batasi endpoint;
- masking secrets;
- separate management port/network jika perlu.

### 15.3 Profiles

Profile membantu environment-specific configuration, tetapi jangan jadikan profile sebagai conditional business logic.

Buruk:

```java
if (activeProfile.equals("prod")) {
    applyDifferentBusinessRule();
}
```

Business rule harus dikonfigurasi eksplisit atau dimodelkan sebagai policy.

### 15.4 Startup performance

Startup dipengaruhi oleh:

- classpath size;
- component scanning;
- reflection;
- auto-configuration;
- connection initialization;
- schema migration;
- cache warmup;
- JIT warmup;
- AOT/CDS jika dipakai.

Jangan masukkan pekerjaan bisnis berat ke startup tanpa alasan kuat.

### 15.5 Native image/GraalVM consideration

Native image bisa menurunkan startup time dan memory footprint, tetapi punya trade-off:

- reflection configuration;
- dynamic proxy;
- JNI/native resources;
- library compatibility;
- build time;
- debugging/profiling berbeda;
- peak throughput bisa berbeda.

Untuk enterprise service biasa, ukur dulu. Jangan mengadopsi hanya karena hype.

---

## 16. Integration Patterns

### 16.1 Synchronous integration

HTTP/gRPC call cocok ketika:

- response dibutuhkan segera;
- consistency expectation kuat;
- dependency reliable;
- timeout kecil;
- fallback jelas.

Risiko:

- cascading failure;
- latency chaining;
- retry storm;
- circuit breaker complexity;
- distributed tracing wajib.

### 16.2 Asynchronous integration

Event/message cocok ketika:

- proses bisa eventual consistent;
- fan-out diperlukan;
- load perlu buffer;
- downstream tidak harus tersedia saat command masuk;
- audit/event log dibutuhkan.

Risiko:

- duplicate;
- ordering;
- lag;
- replay;
- schema evolution;
- operational tooling.

### 16.3 Saga

Saga mengelola long-running transaction lintas service.

Choreography:

```text
CaseEscalated event
  -> Notification service sends email
  -> SLA service updates timer
  -> Audit service records
```

Orchestration:

```text
CaseWorkflowOrchestrator
  -> reserve resource
  -> create document
  -> notify officer
  -> compensate if failure
```

Saga bukan pengganti invariant lokal. Saga mengelola consistency lintas boundary.

### 16.4 Compensation

Tidak semua aksi bisa rollback. Banyak aksi butuh compensation.

Contoh:

- email sudah terkirim tidak bisa “ditarik”;
- dokumen sudah dibuat perlu dibuat status cancelled;
- pembayaran perlu refund;
- external case sync perlu reversal event.

Modelkan compensation sebagai domain command/event, bukan cleanup ad-hoc.

---

## 17. Backend Code Organization

### 17.1 Package by layer

```text
com.acme.caseapp
  controller
  service
  repository
  entity
  dto
```

Mudah untuk awal, tetapi domain tersebar.

### 17.2 Package by feature/module

```text
com.acme.caseapp.caseprocessing
  api
  application
  domain
  infrastructure

com.acme.caseapp.document
  api
  application
  domain
  infrastructure
```

Lebih baik untuk sistem besar karena boundary bisnis terlihat.

### 17.3 Internal package

Gunakan convention:

```text
caseprocessing
  api/            // exposed to other modules
  internal/       // not allowed from outside
```

Atau dengan JPMS:

```java
module com.acme.caseprocessing {
    exports com.acme.caseprocessing.api;
    // internal package not exported
}
```

### 17.4 Dependency direction

Rule sehat:

```text
api -> application -> domain
infrastructure -> application/domain ports
web adapter -> application
persistence adapter -> domain/application ports
```

Jangan biarkan domain bergantung ke infrastructure.

---

## 18. Enterprise Backend Anti-Patterns

### 18.1 God Service

Satu service tahu semua hal.

Gejala:

- ribuan baris;
- banyak dependency;
- banyak method unrelated;
- testing sulit;
- perubahan kecil risk besar.

Solusi:

- pecah per use case;
- ekstrak domain policy;
- ekstrak port;
- pisahkan command/query;
- buat module boundary.

### 18.2 Anemic domain model

Entity hanya getter/setter, rule di service.

Solusi:

- letakkan invariant di domain method;
- gunakan value object;
- modelkan transition;
- kurangi setter publik.

### 18.3 Repository as business API

Controller memanggil repository langsung.

Masalah:

- invariant bypass;
- audit bypass;
- transaction boundary kacau;
- authorization tersebar.

Solusi:

- controller memanggil use case;
- repository hanya persistence boundary.

### 18.4 Transaction soup

`@Transactional` ditempel di semua method.

Masalah:

- boundary tidak jelas;
- transaction terlalu panjang;
- external call dalam transaction;
- nested propagation kacau.

Solusi:

- tentukan use case transaction boundary;
- baca/write dipisah;
- external effect via outbox.

### 18.5 Entity leakage

JPA entity langsung jadi API response.

Masalah:

- lazy loading error;
- expose internal schema;
- circular serialization;
- security leak;
- API sulit evolve.

Solusi:

- DTO/projection;
- mapper eksplisit;
- contract versioning.

### 18.6 Magic framework dependency

Kode hanya bekerja karena magic framework, tidak bisa dites tanpa context.

Solusi:

- core logic plain Java;
- Spring hanya wiring/adapter;
- constructor injection;
- unit test domain tanpa Spring.

### 18.7 Distributed monolith

Banyak microservice tapi tightly coupled.

Gejala:

- deployment harus serentak;
- synchronous chain panjang;
- sharing DB;
- contract tidak stabil;
- observability buruk.

Solusi:

- bounded context review;
- event contract;
- data ownership;
- reduce sync dependency;
- contract testing;
- compatibility policy.

---

## 19. Decision Framework

### 19.1 Layered vs hexagonal vs modulith vs microservice

| Situasi | Pilihan awal |
|---|---|
| CRUD kecil | layered sederhana |
| domain rule kompleks | hexagonal/clean inside modulith |
| banyak module bisnis tapi deployment tunggal cukup | modulith |
| tim berbeda, data ownership jelas, scaling/release beda | microservices |
| distributed transaction tinggi | hindari microservices dulu |

### 19.2 JDBC vs JPA vs jOOQ vs MyBatis

| Kebutuhan | Pilihan |
|---|---|
| CRUD aggregate dan domain object | JPA/Hibernate |
| query/reporting SQL kompleks | jOOQ/JDBC |
| legacy SQL/stored procedure | MyBatis/JDBC |
| kontrol penuh dan performa predictable | JDBC/jOOQ |
| repository cepat untuk aplikasi Spring | Spring Data JPA |

### 19.3 MVC + virtual threads vs WebFlux

| Kebutuhan | Pilihan |
|---|---|
| imperative blocking app, JDBC/JPA | Spring MVC |
| banyak request blocking tapi ingin concurrency tinggi | Spring MVC + virtual threads, setelah benchmark |
| non-blocking end-to-end, streaming, reactive ecosystem | WebFlux |
| tim belum paham reactive | jangan paksa WebFlux |

### 19.4 Synchronous vs asynchronous integration

| Kebutuhan | Pilihan |
|---|---|
| perlu result langsung | sync HTTP/gRPC |
| proses panjang | async job + polling/event |
| fan-out | event |
| downstream unreliable | queue/event + retry |
| strong immediate consistency lintas sistem | rethink boundary; distributed consistency mahal |

---

## 20. Reference Implementation: Case Escalation Backend

### 20.1 Package structure

```text
com.acme.caseapp
  caseprocessing
    api
      CaseCommandController.java
      CaseErrorHandler.java
      EscalateCaseRequest.java
      EscalateCaseResponse.java
    application
      EscalateCaseUseCase.java
      EscalateCaseCommand.java
      EscalateCaseHandler.java
      EscalateCaseResult.java
    domain
      CaseRecord.java
      CaseId.java
      CaseStatus.java
      CaseTransitionPolicy.java
      DomainEvent.java
      CaseEscalated.java
    infrastructure
      persistence
        CaseEntity.java
        SpringDataCaseJpaRepository.java
        JpaCaseRepositoryAdapter.java
      messaging
        OutboxEventEntity.java
        OutboxEventRepository.java
        OutboxDomainEventPublisher.java
```

### 20.2 Domain

```java
public final class CaseRecord {
    private final CaseId id;
    private CaseStatus status;
    private long version;

    public CaseRecord(CaseId id, CaseStatus status, long version) {
        this.id = Objects.requireNonNull(id);
        this.status = Objects.requireNonNull(status);
        this.version = version;
    }

    public CaseEscalated escalate(EscalateCaseCommand command, CaseTransitionPolicy policy) {
        Objects.requireNonNull(command);
        Objects.requireNonNull(policy);

        policy.assertCanEscalate(this, command);

        CaseStatus previous = this.status;
        this.status = CaseStatus.ESCALATED;
        this.version++;

        return new CaseEscalated(
                id,
                previous,
                status,
                version,
                command.actor(),
                command.reason(),
                command.requestedAt(),
                command.correlationId()
        );
    }

    public boolean isClosed() {
        return status == CaseStatus.CLOSED;
    }

    public CaseId id() { return id; }
    public CaseStatus status() { return status; }
    public long version() { return version; }
}
```

### 20.3 Application handler

```java
@Service
public class EscalateCaseHandler implements EscalateCaseUseCase {
    private final CaseRepository cases;
    private final CaseTransitionPolicy policy;
    private final DomainEventPublisher events;
    private final IdempotencyService idempotency;

    public EscalateCaseHandler(
            CaseRepository cases,
            CaseTransitionPolicy policy,
            DomainEventPublisher events,
            IdempotencyService idempotency
    ) {
        this.cases = cases;
        this.policy = policy;
        this.events = events;
        this.idempotency = idempotency;
    }

    @Transactional
    @Override
    public EscalateCaseResult handle(EscalateCaseCommand command) {
        return idempotency.execute(command.idempotencyKey(), command.requestHash(), () -> {
            CaseRecord record = cases.getRequired(command.caseId());
            CaseEscalated event = record.escalate(command, policy);
            cases.save(record);
            events.publish(event); // outbox-backed publisher
            return EscalateCaseResult.accepted(record.id(), record.version());
        });
    }
}
```

### 20.4 Persistence adapter

```java
@Repository
public class JpaCaseRepositoryAdapter implements CaseRepository {
    private final SpringDataCaseJpaRepository repository;
    private final CaseEntityMapper mapper;

    public JpaCaseRepositoryAdapter(
            SpringDataCaseJpaRepository repository,
            CaseEntityMapper mapper
    ) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Override
    public CaseRecord getRequired(CaseId id) {
        return repository.findById(id.value())
                .map(mapper::toDomain)
                .orElseThrow(() -> new CaseNotFoundException(id));
    }

    @Override
    public void save(CaseRecord record) {
        CaseEntity entity = repository.findById(record.id().value())
                .orElseThrow(() -> new CaseNotFoundException(record.id()));
        mapper.updateEntity(record, entity);
    }
}
```

### 20.5 Outbox publisher

```java
@Component
public class OutboxDomainEventPublisher implements DomainEventPublisher {
    private final OutboxEventRepository outbox;
    private final ObjectMapper objectMapper;

    public OutboxDomainEventPublisher(OutboxEventRepository outbox, ObjectMapper objectMapper) {
        this.outbox = outbox;
        this.objectMapper = objectMapper;
    }

    @Override
    public void publish(DomainEvent event) {
        outbox.save(OutboxEventEntity.from(event, objectMapper));
    }
}
```

### 20.6 HTTP error handler

```java
@RestControllerAdvice
public class CaseErrorHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    ResponseEntity<ProblemDetail> handleNotFound(CaseNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setTitle("Case not found");
        problem.setProperty("code", "CASE_NOT_FOUND");
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(DomainRuleViolation.class)
    ResponseEntity<ProblemDetail> handleDomain(DomainRuleViolation ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Domain rule violation");
        problem.setDetail(ex.getMessage());
        problem.setProperty("code", ex.code());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

---

## 21. Production Checklist untuk Backend Java Enterprise

### 21.1 Architecture checklist

- [ ] Boundary module jelas.
- [ ] Dependency direction eksplisit.
- [ ] Domain invariant tidak tersebar di controller.
- [ ] Use case command/query eksplisit.
- [ ] Transaction boundary jelas.
- [ ] External side effect tidak dilakukan sembarang dalam DB transaction.
- [ ] Event schema versioned.
- [ ] API error code stabil.

### 21.2 Spring checklist

- [ ] Constructor injection.
- [ ] Tidak ada field injection.
- [ ] Bean singleton stateless/thread-safe.
- [ ] `@Transactional` hanya di boundary yang benar.
- [ ] Self-invocation trap dicegah.
- [ ] Configuration properties typed dan validated.
- [ ] Actuator aman.
- [ ] Auto-configuration dipahami.

### 21.3 Persistence checklist

- [ ] Query utama terukur.
- [ ] N+1 dicegah.
- [ ] Optimistic/pessimistic locking dipilih sadar.
- [ ] Index sesuai query.
- [ ] Pagination punya ordering stabil.
- [ ] Schema migration versioned.
- [ ] Entity tidak bocor sebagai API response.
- [ ] Transaction duration dipantau.

### 21.4 Messaging checklist

- [ ] Message key benar.
- [ ] Consumer idempotent.
- [ ] Retry diklasifikasikan.
- [ ] DLQ punya owner dan replay plan.
- [ ] Schema evolution aman.
- [ ] Lag dimonitor.
- [ ] Poison message tidak blocking partition/queue selamanya.

### 21.5 API checklist

- [ ] Validation boundary ada.
- [ ] Error response konsisten.
- [ ] Idempotency untuk command penting.
- [ ] Pagination dibatasi.
- [ ] Versioning/deprecation policy jelas.
- [ ] Authn/authz diuji.
- [ ] PII tidak bocor.

### 21.6 Observability checklist

- [ ] Correlation ID per request.
- [ ] Structured logs.
- [ ] Metrics untuk latency/error/dependency.
- [ ] Trace untuk cross-service.
- [ ] Audit terpisah dari log.
- [ ] Dashboard critical path.
- [ ] Alert actionable.

---

## 22. Latihan Bertahap

### Latihan 1 — Refactor CRUD Service

Ambil service CRUD sederhana dan pecah menjadi:

- controller;
- command;
- use case;
- domain object;
- repository port;
- persistence adapter;
- DTO response.

Fokus: dependency direction dan testability.

### Latihan 2 — Transaction Boundary Review

Cari semua `@Transactional` di project. Untuk tiap annotation jawab:

1. Apa invariant yang dilindungi?
2. Apakah method melakukan external call?
3. Apa rollback rule-nya?
4. Apakah propagation-nya perlu?
5. Apakah durasi transaksi bisa panjang?

### Latihan 3 — N+1 Detection

Buat endpoint list cases dengan assignee. Implementasikan versi:

1. naive lazy loading;
2. fetch join;
3. projection DTO;
4. query read model.

Bandingkan jumlah query dan latency.

### Latihan 4 — Outbox Pattern

Implementasikan:

- table outbox;
- insert event dalam transaksi use case;
- scheduled publisher;
- idempotent consumer;
- DLQ sederhana.

### Latihan 5 — API Contract

Desain API untuk:

```text
Submit case
Assign case
Escalate case
Close case
Search case
```

Untuk tiap API definisikan:

- method/path;
- request;
- response;
- error code;
- idempotency;
- audit event;
- transaction boundary.

### Latihan 6 — Messaging Failure Simulation

Simulasikan:

- duplicate event;
- broker down;
- consumer crash setelah side effect;
- poison message;
- schema unknown enum;
- lag tinggi.

Tulis behavior yang diharapkan.

---

## 23. Mini Project: Enterprise Case Management Backend

### 23.1 Scope

Bangun service Java/Spring Boot untuk case management dengan fitur:

- create case;
- assign case;
- escalate case;
- close case;
- search cases;
- audit trail;
- outbox event;
- idempotency key;
- optimistic locking;
- event consumer untuk notification projection.

### 23.2 Required architecture

```text
api
application
architecture/domain
infrastructure/persistence
infrastructure/messaging
infrastructure/observability
```

### 23.3 Required constraints

- Java 25.
- Spring Boot modern version yang kompatibel dengan stack yang dipilih.
- PostgreSQL.
- Flyway/Liquibase.
- Testcontainers.
- Structured logs.
- Metrics.
- Problem Details error response.
- No entity leakage to API response.
- No external call inside DB transaction except outbox insert.

### 23.4 Required tests

- domain unit tests;
- use case tests;
- repository integration tests;
- API tests;
- idempotency tests;
- optimistic locking conflict tests;
- outbox publisher tests;
- consumer duplicate tests;
- migration test.

### 23.5 Evaluation criteria

- correctness of invariant;
- transaction clarity;
- API contract stability;
- idempotency;
- observability;
- failure handling;
- test quality;
- code boundary clarity;
- operational readiness.

---

## 24. Ringkasan Mental Model

Enterprise Java backend yang baik bukan yang paling banyak memakai annotation. Backend yang kuat adalah backend yang boundary-nya jelas.

Pegangan utama:

1. Controller menerjemahkan HTTP, bukan menjalankan domain.
2. Application use case mengorkestrasi transaksi dan dependency.
3. Domain menjaga invariant.
4. Repository menyembunyikan persistence.
5. Transaction boundary harus eksplisit.
6. External effect harus dipikirkan sebagai failure-prone.
7. Event/message minimal at-least-once; consumer harus idempotent.
8. API adalah contract, bukan method Java yang diekspos.
9. Observability adalah bagian desain, bukan tambahan akhir.
10. Framework membantu, tetapi tidak menggantikan desain.

Jika kamu memahami bagian ini, kamu tidak hanya bisa membuat endpoint Spring Boot. Kamu bisa merancang sistem backend yang bisa bertahan di bawah concurrency, failure, migration, audit, dan perubahan requirement.

---

## 25. Referensi Resmi dan Lanjutan

Referensi utama yang digunakan untuk menyusun materi ini:

1. Spring Framework Reference Documentation  
   https://docs.spring.io/spring-framework/reference/index.html

2. Spring Boot Documentation Overview  
   https://docs.spring.io/spring-boot/documentation.html

3. Spring Boot Project Page  
   https://spring.io/projects/spring-boot

4. Spring Framework Transaction Management  
   https://docs.spring.io/spring-framework/reference/data-access/transaction.html

5. Spring Framework `@Transactional` Annotation Reference  
   https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html

6. Spring Web MVC Reference  
   https://docs.spring.io/spring-framework/reference/web/webmvc.html

7. Spring Data JPA Reference  
   https://docs.spring.io/spring-data/jpa/reference/index.html

8. Spring Security Reference  
   https://docs.spring.io/spring-security/reference/index.html

9. Jakarta EE Specifications  
   https://jakarta.ee/specifications/

10. Jakarta EE Platform 11  
    https://jakarta.ee/specifications/platform/11/

11. Jakarta Persistence 3.2  
    https://jakarta.ee/specifications/persistence/3.2/

12. Hibernate ORM Documentation  
    https://hibernate.org/orm/documentation/

13. Hibernate ORM 7.0 User Guide  
    https://docs.hibernate.org/orm/7.0/userguide/html_single/

14. Apache Kafka Documentation  
    https://kafka.apache.org/documentation/

15. RabbitMQ Java Client API Guide  
    https://www.rabbitmq.com/client-libraries/java-api-guide

16. RabbitMQ Documentation  
    https://www.rabbitmq.com/docs

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Part 017 — Testing di Java](./learn-java-part-017.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: learn-java-part-019.md](./learn-java-part-019.md)
