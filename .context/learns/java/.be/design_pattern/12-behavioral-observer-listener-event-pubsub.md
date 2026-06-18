# 12 — Behavioral Pattern IV: Observer, Listener, Event, Pub/Sub

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 12 dari 35  
> File: `12-behavioral-observer-listener-event-pubsub.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: Observer, listener idiom, domain event, integration event, synchronous/asynchronous eventing, pub/sub, ordering, replay, duplication, lifecycle, dan anti-pattern event-driven design.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan antara **Observer**, **Listener**, **Domain Event**, **Integration Event**, dan **Pub/Sub**.
2. Membedakan event sebagai **notification** dan event sebagai **state transfer**.
3. Mendesain event yang eksplisit, audit-able, testable, dan tidak berubah menjadi coupling tersembunyi.
4. Menentukan kapan event harus diproses sinkron dan kapan harus diproses asinkron.
5. Memahami risiko ordering, duplication, retry, idempotency, replay, dan listener lifecycle.
6. Menghindari anti-pattern seperti:
   - event soup,
   - event as remote procedure call,
   - hidden synchronous dependency,
   - listener side-effect hell,
   - domain event yang bocor menjadi integration event,
   - pub/sub tanpa ownership.
7. Menggunakan Java 8–25 untuk membangun event model yang lebih aman:
   - functional listener,
   - immutable event object,
   - records,
   - sealed event hierarchy,
   - pattern matching,
   - virtual threads,
   - structured concurrency,
   - scoped context.
8. Memahami bagaimana event pattern dipakai dalam sistem enterprise/regulatory dengan requirement auditability, traceability, dan defensibility.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Dalam aplikasi enterprise, satu aksi bisnis sering memicu beberapa reaksi.

Contoh sederhana:

```text
User approves application
```

Setelah itu sistem mungkin perlu:

1. mengubah status application,
2. membuat audit trail,
3. mengirim email,
4. membuat notification,
5. memperbarui search index,
6. mengirim event ke sistem eksternal,
7. membuat task lanjutan,
8. menjalankan SLA timer,
9. menyimpan decision history,
10. mengirim metric.

Cara paling naif adalah memasukkan semuanya ke satu service method:

```java
public void approve(ApproveApplicationRequest request) {
    Application app = repository.findById(request.applicationId());

    app.approve(request.officerId(), request.reason());
    repository.save(app);

    auditTrailService.recordApproval(app);
    emailService.sendApprovalEmail(app);
    notificationService.notifyApplicant(app);
    searchIndexService.update(app);
    externalGateway.publishApproval(app);
    slaService.stopPendingTimer(app);
    metrics.increment("application.approved");
}
```

Pada awalnya ini terlihat jelas. Namun seiring sistem tumbuh, method ini berubah menjadi pusat gravitasi side effect.

Masalahnya:

1. Service utama tahu terlalu banyak hal.
2. Setiap side effect menambah alasan perubahan.
3. Satu dependency lambat bisa membuat approval gagal.
4. Satu dependency error bisa menyebabkan data utama rollback padahal side effect bukan bagian invariant utama.
5. Testing menjadi berat karena terlalu banyak mock.
6. Urutan side effect menjadi kontrak tersembunyi.
7. Tidak jelas mana business invariant dan mana reaction.
8. Retry bisa menggandakan email atau external call.
9. Observability menjadi sulit karena satu operation punya banyak akibat.

Event pattern muncul sebagai cara memisahkan:

```text
Hal utama yang terjadi
```

dari:

```text
Reaksi terhadap hal yang terjadi
```

Tetapi event pattern juga sering disalahgunakan. Banyak sistem menjadi lebih buruk setelah “event-driven” karena event dipakai tanpa ownership, tanpa contract, tanpa idempotency, dan tanpa semantic clarity.

Part ini akan membangun pemahaman dari bawah: mulai dari Observer in-memory sampai Pub/Sub distributed.

---

## 3. Mental Model

### 3.1 Event adalah Fakta, Bukan Perintah

Event yang baik biasanya berbentuk past tense:

```text
ApplicationApproved
DocumentUploaded
PaymentReceived
CaseEscalated
OfficerAssigned
LicenseSuspended
```

Event buruk biasanya berbentuk imperative command:

```text
SendApprovalEmail
UpdateSearchIndex
NotifyExternalSystem
CreateTask
```

Perbedaannya penting.

Command menyatakan:

```text
Tolong lakukan sesuatu.
```

Event menyatakan:

```text
Sesuatu sudah terjadi.
```

Jika event diberi nama seperti command, maka pub/sub berubah menjadi RPC terselubung.

Contoh buruk:

```java
publisher.publish(new SendEmailEvent(applicationId));
```

Ini bukan event domain. Ini command yang dikirim lewat event bus.

Lebih baik:

```java
publisher.publish(new ApplicationApproved(applicationId, approvedBy, approvedAt));
```

Lalu email listener boleh bereaksi:

```java
class ApprovalEmailListener implements DomainEventListener<ApplicationApproved> {
    @Override
    public void on(ApplicationApproved event) {
        emailService.sendApprovalEmail(event.applicationId());
    }
}
```

Mental modelnya:

```text
Command = intent sebelum perubahan
Event   = fact setelah perubahan
```

---

### 3.2 Event Memisahkan Core Change dari Consequence

Core change adalah perubahan yang harus benar agar operation dianggap berhasil.

Contoh:

```text
Application status berubah dari PENDING_REVIEW ke APPROVED.
Decision history tersimpan.
Audit decision minimal tersimpan.
```

Consequence adalah reaksi setelah fakta tersebut terjadi.

Contoh:

```text
Email terkirim.
Search index diperbarui.
Notification dibuat.
External system diberitahu.
Metrics naik.
```

Tidak semua consequence punya criticality sama.

| Consequence | Harus Satu Transaksi? | Bisa Retry? | Bisa Eventually Consistent? |
|---|---:|---:|---:|
| Decision history | Ya | Tidak secara bebas | Tidak |
| Audit core | Biasanya ya | Hati-hati | Biasanya tidak |
| Email | Tidak | Ya, dengan dedup | Ya |
| Search index | Tidak | Ya | Ya |
| External notification | Tidak langsung | Ya, dengan outbox/idempotency | Ya |
| Metrics | Tidak | Biasanya boleh drop/aggregate | Ya |

Event membantu memisahkan critical invariant dari side effect.

Namun event bukan excuse untuk membuat consistency tidak jelas. Top engineer tetap harus menentukan:

```text
Mana invariant transaksi?
Mana reaction?
Mana boleh async?
Mana harus idempotent?
Mana harus auditable?
```

---

### 3.3 Event Mengurangi Coupling Tertentu, Tetapi Menambah Coupling Lain

Event sering dijual sebagai cara mengurangi coupling. Itu benar, tapi tidak lengkap.

Event dapat mengurangi coupling langsung seperti ini:

```text
ApprovalService -> EmailService
ApprovalService -> NotificationService
ApprovalService -> SearchIndexService
```

menjadi:

```text
ApprovalService -> EventPublisher
ApplicationApproved -> EmailListener
ApplicationApproved -> NotificationListener
ApplicationApproved -> SearchIndexListener
```

Tetapi coupling tidak hilang. Ia berpindah ke:

1. event schema,
2. event semantics,
3. delivery guarantee,
4. ordering assumption,
5. idempotency requirement,
6. listener side effects,
7. operational observability.

Jadi event pattern bukan “decoupling magic”. Ia adalah trade-off.

```text
Direct call coupling diganti dengan semantic/event-contract coupling.
```

Kalau event contract tidak jelas, sistem menjadi lebih sulit dipahami daripada direct call.

---

### 3.4 Event Boundary Harus Punya Ownership

Setiap event harus memiliki owner.

Owner bertanggung jawab atas:

1. nama event,
2. arti event,
3. kapan event diterbitkan,
4. field event,
5. versioning,
6. compatibility,
7. retention,
8. replay semantics,
9. deprecation.

Tanpa ownership, event menjadi shared global object yang semua orang ubah sesuai kebutuhan masing-masing listener.

Anti-pattern:

```java
public record ApplicationEvent(
        String type,
        Map<String, Object> payload
) {}
```

Masalah:

1. Tidak ada schema jelas.
2. Tidak ada compiler help.
3. Tidak ada semantic boundary.
4. Field bisa berubah tanpa terdeteksi.
5. Listener parse string/map sendiri-sendiri.
6. Refactoring hampir mustahil.

Lebih baik:

```java
public sealed interface ApplicationDomainEvent
        permits ApplicationSubmitted,
                ApplicationApproved,
                ApplicationRejected,
                ApplicationWithdrawn {

    ApplicationId applicationId();
    Instant occurredAt();
}

public record ApplicationApproved(
        ApplicationId applicationId,
        OfficerId approvedBy,
        Instant occurredAt,
        DecisionReason reason
) implements ApplicationDomainEvent {}
```

Dengan sealed interface, event family eksplisit.

---

## 4. Core Concept

### 4.1 Observer Pattern

Observer pattern adalah pattern di mana sebuah subject menyimpan daftar observers dan memberi tahu mereka ketika state berubah.

Struktur klasik:

```text
Subject
  - attach(observer)
  - detach(observer)
  - notifyObservers(event)

Observer
  - update(event)
```

Contoh sederhana:

```java
public interface Observer<E> {
    void onEvent(E event);
}

public final class Subject<E> {
    private final List<Observer<E>> observers = new ArrayList<>();

    public void attach(Observer<E> observer) {
        observers.add(observer);
    }

    public void detach(Observer<E> observer) {
        observers.remove(observer);
    }

    public void notifyObservers(E event) {
        for (Observer<E> observer : observers) {
            observer.onEvent(event);
        }
    }
}
```

Ini tampak sederhana, tetapi ada banyak pertanyaan desain:

1. Apakah observer dipanggil sinkron?
2. Apa yang terjadi jika satu observer gagal?
3. Apakah observer boleh mengubah subject?
4. Apakah observer boleh menambahkan/menghapus observer lain saat notifikasi berjalan?
5. Apakah observer dipanggil dalam urutan tertentu?
6. Apakah event immutable?
7. Apakah observer leak memory?
8. Apakah observer lifecycle jelas?

Observer pattern bukan sekadar list callback. Ia membawa problem lifecycle, ordering, failure isolation, dan reentrancy.

---

### 4.2 Listener Idiom di Java

Java lama banyak memakai listener idiom.

Contoh umum:

```java
public interface ApplicationStatusListener {
    void onStatusChanged(ApplicationStatusChanged event);
}
```

Subject:

```java
public final class ApplicationStatusMonitor {
    private final List<ApplicationStatusListener> listeners = new CopyOnWriteArrayList<>();

    public void addListener(ApplicationStatusListener listener) {
        listeners.add(Objects.requireNonNull(listener));
    }

    public void removeListener(ApplicationStatusListener listener) {
        listeners.remove(listener);
    }

    public void statusChanged(ApplicationStatusChanged event) {
        for (ApplicationStatusListener listener : listeners) {
            listener.onStatusChanged(event);
        }
    }
}
```

Kenapa `CopyOnWriteArrayList`?

Karena listener list biasanya:

1. lebih sering dibaca daripada dimodifikasi,
2. harus aman saat listener ditambah/dihapus ketika dispatch berjalan,
3. cocok untuk jumlah listener kecil sampai sedang.

Namun tidak cocok untuk listener list yang sering berubah atau sangat besar.

---

### 4.3 Functional Listener Sejak Java 8

Java 8 membuat listener lebih ringan dengan functional interface.

```java
@FunctionalInterface
public interface EventListener<E> {
    void on(E event);
}
```

Registrasi:

```java
publisher.register(ApplicationApproved.class, event -> {
    System.out.println("Approved: " + event.applicationId());
});
```

Kelebihan:

1. simple,
2. mudah untuk small callback,
3. cocok untuk composition,
4. mudah digunakan di test.

Risiko:

1. lambda anonim sulit dilacak,
2. stack trace kurang memberi nama domain,
3. lifecycle listener bisa tidak jelas,
4. logic kompleks tersembunyi dalam lambda.

Guideline:

```text
Lambda listener bagus untuk wiring kecil.
Named listener class lebih baik untuk business side effect penting.
```

Contoh lebih baik untuk side effect penting:

```java
public final class ApprovalEmailListener
        implements EventListener<ApplicationApproved> {

    private final ApprovalEmailService emailService;

    public ApprovalEmailListener(ApprovalEmailService emailService) {
        this.emailService = Objects.requireNonNull(emailService);
    }

    @Override
    public void on(ApplicationApproved event) {
        emailService.sendApprovalEmail(event.applicationId());
    }
}
```

---

### 4.4 Domain Event

Domain event adalah event yang merepresentasikan fakta penting dalam domain.

Contoh:

```java
public record CaseEscalated(
        CaseId caseId,
        OfficerId escalatedBy,
        EscalationLevel fromLevel,
        EscalationLevel toLevel,
        EscalationReason reason,
        Instant occurredAt
) implements CaseDomainEvent {}
```

Domain event sebaiknya:

1. menggunakan bahasa domain,
2. immutable,
3. mengandung waktu kejadian,
4. memiliki identity/reference yang jelas,
5. tidak membawa object graph besar,
6. tidak bergantung pada framework,
7. tidak membawa persistence entity mutable,
8. punya semantic yang stabil.

Domain event biasanya diterbitkan oleh aggregate/domain object atau application service setelah invariant terpenuhi.

Contoh aggregate mengumpulkan event:

```java
public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;
    private final List<DomainEvent> pendingEvents = new ArrayList<>();

    public void approve(OfficerId officerId, DecisionReason reason, Instant now) {
        if (status != ApplicationStatus.PENDING_REVIEW) {
            throw new IllegalStateException("Application is not pending review");
        }

        status = ApplicationStatus.APPROVED;

        pendingEvents.add(new ApplicationApproved(
                id,
                officerId,
                now,
                reason
        ));
    }

    public List<DomainEvent> pullEvents() {
        List<DomainEvent> copy = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return copy;
    }
}
```

Application service:

```java
public void approve(ApproveApplicationCommand command) {
    Application app = repository.findById(command.applicationId());

    app.approve(command.officerId(), command.reason(), clock.instant());

    repository.save(app);

    domainEventPublisher.publishAll(app.pullEvents());
}
```

Catatan penting: kalau publish dilakukan setelah `save` tetapi sebelum transaction commit, listener sinkron bisa melihat state yang belum commit. Ini akan dibahas lebih jauh di bagian transaction boundary.

---

### 4.5 Integration Event

Integration event adalah event yang dipublikasikan keluar boundary service/application untuk dikonsumsi sistem lain.

Contoh:

```java
public record ApplicationApprovedIntegrationEvent(
        String eventId,
        String eventType,
        String schemaVersion,
        String applicationId,
        String approvedBy,
        String approvedAt,
        String correlationId
) {}
```

Integration event berbeda dari domain event.

| Aspek | Domain Event | Integration Event |
|---|---|---|
| Audience | Internal domain/application | External service/system |
| Bahasa | Domain-rich | Contract-stable |
| Evolusi | Lebih fleksibel internal | Harus versioned/compatible |
| Payload | Cukup untuk internal reaction | Cukup untuk consumer contract |
| Transport | In-memory/internal bus | Broker/API/outbox |
| Failure model | Sering bagian aplikasi | Distributed failure |
| Schema | Java type | Public schema/JSON/Avro/etc |

Kesalahan umum adalah mempublikasikan domain event langsung ke Kafka/RabbitMQ.

Masalahnya:

1. struktur internal bocor,
2. field domain berubah mematahkan consumer,
3. semantic internal menjadi public contract,
4. consumer ikut bergantung pada model internal,
5. refactoring domain menjadi mahal.

Lebih baik ada translation:

```java
public final class ApplicationApprovedIntegrationEventMapper {
    public ApplicationApprovedIntegrationEvent toIntegrationEvent(
            ApplicationApproved event,
            CorrelationId correlationId
    ) {
        return new ApplicationApprovedIntegrationEvent(
                UUID.randomUUID().toString(),
                "application.approved",
                "1.0",
                event.applicationId().value(),
                event.approvedBy().value(),
                event.occurredAt().toString(),
                correlationId.value()
        );
    }
}
```

---

### 4.6 Event Notification vs Event-Carried State Transfer

Ada dua gaya event utama.

#### Event Notification

Event hanya memberi tahu bahwa sesuatu terjadi.

```java
public record ApplicationApproved(
        ApplicationId applicationId,
        Instant occurredAt
) {}
```

Consumer perlu query kembali jika butuh detail.

Kelebihan:

1. payload kecil,
2. tidak menduplikasi data besar,
3. informasi selalu bisa diambil dari source of truth.

Kekurangan:

1. consumer perlu call balik,
2. bisa menyebabkan coupling runtime,
3. source state mungkin sudah berubah saat consumer membaca,
4. sulit untuk replay historis jika data current tidak sama dengan data saat event terjadi.

#### Event-Carried State Transfer

Event membawa state yang dibutuhkan consumer.

```java
public record ApplicationApproved(
        ApplicationId applicationId,
        ApplicantId applicantId,
        OfficerId approvedBy,
        ApplicationType applicationType,
        Instant approvedAt,
        String applicantEmail
) {}
```

Kelebihan:

1. consumer tidak perlu call balik,
2. lebih resilient terhadap source availability,
3. replay lebih meaningful,
4. cocok untuk building read model/projection.

Kekurangan:

1. payload lebih besar,
2. risiko data sensitif bocor,
3. schema evolution lebih sulit,
4. data duplication,
5. consumer mungkin memakai field di luar intended contract.

Decision heuristic:

```text
Gunakan notification jika consumer sedikit dan bisa query balik dengan aman.
Gunakan event-carried state jika consumer distributed, replay penting, atau read model perlu dibangun dari event.
```

Dalam regulatory system, audit-related events sering perlu membawa state yang cukup untuk menjelaskan keputusan saat itu, bukan hanya current state.

---

## 5. Pattern Anatomy

### 5.1 Observer

#### Context

Satu subject memiliki banyak dependent object yang perlu diberi tahu saat sesuatu berubah.

#### Problem

Subject tidak boleh tahu detail semua dependent object.

#### Forces

1. Perlu extensibility.
2. Perlu menghindari direct dependency.
3. Perlu menjaga consistency.
4. Perlu mengelola failure observer.
5. Perlu menghindari memory leak.

#### Solution

Subject menyimpan daftar observer dan memberi notifikasi lewat interface umum.

#### Consequences

Positif:

1. Subject lebih terbuka untuk extension.
2. Observer bisa ditambah tanpa mengubah subject.
3. Cocok untuk UI, monitoring, callback, in-process reaction.

Negatif:

1. Control flow menjadi tidak langsung.
2. Failure handling menjadi kompleks.
3. Ordering bisa tidak jelas.
4. Observer bisa menyebabkan leak.
5. Reentrancy risk.

---

### 5.2 Listener

Listener adalah idiom Java untuk Observer yang biasanya lebih spesifik terhadap event type.

Contoh:

```java
public interface CaseLifecycleListener {
    void onCaseOpened(CaseOpened event);
    void onCaseClosed(CaseClosed event);
}
```

Atau lebih generic:

```java
public interface EventListener<E> {
    void on(E event);
}
```

Listener cocok jika:

1. event terjadi dalam proses yang sama,
2. lifecycle listener bisa dikontrol,
3. failure model jelas,
4. tidak perlu broker.

---

### 5.3 Domain Event

Domain Event cocok jika:

1. event merepresentasikan fakta domain penting,
2. banyak reaksi internal terhadap fakta tersebut,
3. reaksi tidak harus semua berada di aggregate/service utama,
4. auditability dan traceability penting,
5. domain language perlu eksplisit.

Domain event bukan sekadar mekanisme teknis. Ia adalah bagian dari domain model.

---

### 5.4 Pub/Sub

Pub/Sub adalah model komunikasi di mana publisher mengirim message ke topic/channel, dan subscriber menerima message tanpa publisher mengetahui subscriber.

Struktur:

```text
Publisher -> Topic -> Subscriber A
                  -> Subscriber B
                  -> Subscriber C
```

Pub/Sub cocok jika:

1. subscriber banyak,
2. publisher tidak boleh tahu consumer,
3. async processing diterima,
4. delivery/retry/retention dibutuhkan,
5. distributed system boundary ada.

Tetapi Pub/Sub membawa problem distributed system:

1. duplicate delivery,
2. out-of-order delivery,
3. consumer lag,
4. poison message,
5. schema compatibility,
6. broker outage,
7. replay semantics,
8. backpressure,
9. observability across async boundary.

---

## 6. Synchronous vs Asynchronous Event

### 6.1 Synchronous Event

Synchronous event berarti listener dipanggil dalam call stack yang sama.

```java
publisher.publish(new ApplicationApproved(...));
```

Lalu:

```text
ApprovalService
  -> EventPublisher
      -> AuditListener
      -> EmailListener
      -> NotificationListener
```

Kelebihan:

1. mudah dipahami,
2. mudah dites,
3. failure langsung terlihat,
4. transaction context bisa sama,
5. tidak butuh infrastructure tambahan.

Kekurangan:

1. satu listener lambat memperlambat operation utama,
2. satu listener gagal bisa menggagalkan operation utama,
3. coupling runtime tetap kuat,
4. stack trace panjang,
5. sulit scale independent,
6. listener bisa memodifikasi state secara tidak terduga.

Synchronous event cocok untuk:

1. invariant internal yang harus selesai sebelum operation berhasil,
2. local validation extension,
3. audit core dalam transaksi sama,
4. small plugin inside same process.

Tidak cocok untuk:

1. email,
2. external API call,
3. search indexing,
4. slow notification,
5. cross-service communication,
6. retry-heavy operation.

---

### 6.2 Asynchronous Event

Asynchronous event berarti listener diproses di thread/task/queue/broker berbeda.

```text
ApprovalService -> EventPublisher -> Queue/Broker
                                      -> EmailConsumer
                                      -> SearchIndexConsumer
                                      -> ExternalSyncConsumer
```

Kelebihan:

1. operation utama lebih cepat,
2. failure side effect bisa diisolasi,
3. retry bisa independen,
4. consumer bisa scale sendiri,
5. cocok untuk eventual consistency,
6. bisa replay.

Kekurangan:

1. consistency lebih kompleks,
2. duplicate delivery harus ditangani,
3. ordering tidak otomatis,
4. debugging lebih sulit,
5. tracing harus eksplisit,
6. user experience harus menerima delay,
7. schema compatibility penting.

Asynchronous event cocok untuk:

1. notification,
2. email,
3. integration event,
4. projection/read model,
5. search indexing,
6. audit export,
7. low-priority side effect.

---

### 6.3 Hybrid Event

Banyak sistem enterprise butuh hybrid:

1. domain event dikumpulkan saat aggregate berubah,
2. beberapa listener internal sinkron menjalankan invariant local,
3. integration event dimasukkan ke outbox dalam transaksi yang sama,
4. outbox relay mengirim ke broker asinkron,
5. consumer memproses idempotently.

Flow:

```text
Command Handler
  -> Aggregate mutation
  -> Repository save
  -> Domain events collected
  -> Transactional listeners / outbox insert
  -> Commit
  -> Outbox relay publishes integration events
  -> External consumers process async
```

Ini sering lebih aman daripada langsung publish ke broker dari service method.

---

## 7. Implementation Step-by-Step

Kita akan membangun event system in-process yang cukup serius untuk memahami design force. Ini bukan pengganti Kafka/RabbitMQ, tetapi membantu memahami pattern.

### 7.1 Define Event Marker

```java
import java.time.Instant;

public interface DomainEvent {
    Instant occurredAt();
}
```

Untuk domain application:

```java
public sealed interface ApplicationDomainEvent extends DomainEvent
        permits ApplicationSubmitted,
                ApplicationApproved,
                ApplicationRejected {

    ApplicationId applicationId();
}
```

Event concrete:

```java
import java.time.Instant;

public record ApplicationApproved(
        ApplicationId applicationId,
        OfficerId approvedBy,
        DecisionReason reason,
        Instant occurredAt
) implements ApplicationDomainEvent {}
```

Value objects:

```java
public record ApplicationId(String value) {
    public ApplicationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("application id is required");
        }
    }
}

public record OfficerId(String value) {
    public OfficerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("officer id is required");
        }
    }
}

public record DecisionReason(String value) {
    public DecisionReason {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("decision reason is required");
        }
    }
}
```

---

### 7.2 Define Listener Contract

```java
@FunctionalInterface
public interface DomainEventListener<E extends DomainEvent> {
    void on(E event);
}
```

Masalahnya, Java generic type erased. Jadi kita perlu menyimpan explicit event type.

```java
public record ListenerRegistration<E extends DomainEvent>(
        Class<E> eventType,
        DomainEventListener<? super E> listener
) {
    public ListenerRegistration {
        if (eventType == null) {
            throw new IllegalArgumentException("eventType is required");
        }
        if (listener == null) {
            throw new IllegalArgumentException("listener is required");
        }
    }
}
```

---

### 7.3 Define Publisher

```java
public interface DomainEventPublisher {
    <E extends DomainEvent> void register(
            Class<E> eventType,
            DomainEventListener<? super E> listener
    );

    void publish(DomainEvent event);

    default void publishAll(Iterable<? extends DomainEvent> events) {
        for (DomainEvent event : events) {
            publish(event);
        }
    }
}
```

---

### 7.4 Simple Synchronous Publisher

```java
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public final class SynchronousDomainEventPublisher implements DomainEventPublisher {

    private final Map<Class<?>, CopyOnWriteArrayList<DomainEventListener<?>>> listeners =
            new ConcurrentHashMap<>();

    @Override
    public <E extends DomainEvent> void register(
            Class<E> eventType,
            DomainEventListener<? super E> listener
    ) {
        Objects.requireNonNull(eventType, "eventType");
        Objects.requireNonNull(listener, "listener");

        listeners.computeIfAbsent(eventType, ignored -> new CopyOnWriteArrayList<>())
                .add(listener);
    }

    @Override
    public void publish(DomainEvent event) {
        Objects.requireNonNull(event, "event");

        List<DomainEventListener<?>> registered = listeners.getOrDefault(
                event.getClass(),
                new CopyOnWriteArrayList<>()
        );

        for (DomainEventListener<?> listener : registered) {
            invoke(listener, event);
        }
    }

    @SuppressWarnings("unchecked")
    private static <E extends DomainEvent> void invoke(
            DomainEventListener<?> listener,
            E event
    ) {
        ((DomainEventListener<E>) listener).on(event);
    }
}
```

Ini cukup, tapi belum production-grade.

Masalah:

1. hanya exact class match,
2. tidak ada ordering policy,
3. tidak ada failure policy,
4. tidak ada unregister,
5. tidak ada listener identity,
6. tidak ada observability,
7. tidak ada protection dari reentrant publish,
8. tidak ada context/correlation.

---

### 7.5 Support Supertype Listener

Kadang kita ingin listener menerima semua `ApplicationDomainEvent`.

```java
public final class TypeMatchingDomainEventPublisher implements DomainEventPublisher {

    private final CopyOnWriteArrayList<ListenerRegistration<?>> registrations =
            new CopyOnWriteArrayList<>();

    @Override
    public <E extends DomainEvent> void register(
            Class<E> eventType,
            DomainEventListener<? super E> listener
    ) {
        registrations.add(new ListenerRegistration<>(eventType, listener));
    }

    @Override
    public void publish(DomainEvent event) {
        for (ListenerRegistration<?> registration : registrations) {
            if (registration.eventType().isAssignableFrom(event.getClass())) {
                invoke(registration, event);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static <E extends DomainEvent> void invoke(
            ListenerRegistration<?> registration,
            DomainEvent event
    ) {
        ListenerRegistration<E> typed = (ListenerRegistration<E>) registration;
        typed.listener().on((E) event);
    }
}
```

Trade-off:

1. Lebih fleksibel.
2. Sedikit lebih lambat karena scanning registrations.
3. Ordering antar exact/supertype listener perlu didefinisikan.
4. Bisa memicu listener terlalu luas.

Untuk codebase besar, listener supertype harus dipakai hati-hati. Listener “semua event” sering berubah menjadi god listener.

---

### 7.6 Add Failure Policy

Pertanyaan penting:

```text
Jika satu listener gagal, apakah publish berhenti atau lanjut?
```

Kita buat enum:

```java
public enum ListenerFailurePolicy {
    STOP_ON_FIRST_FAILURE,
    CONTINUE_AND_COLLECT_FAILURES
}
```

Exception:

```java
import java.util.List;

public final class EventPublicationException extends RuntimeException {
    private final DomainEvent event;
    private final List<Throwable> failures;

    public EventPublicationException(DomainEvent event, List<Throwable> failures) {
        super("Failed to publish event " + event.getClass().getSimpleName()
                + " to " + failures.size() + " listener(s)");
        this.event = event;
        this.failures = List.copyOf(failures);
    }

    public DomainEvent event() {
        return event;
    }

    public List<Throwable> failures() {
        return failures;
    }
}
```

Publisher:

```java
import java.util.ArrayList;
import java.util.List;

public final class PolicyAwareDomainEventPublisher implements DomainEventPublisher {

    private final CopyOnWriteArrayList<ListenerRegistration<?>> registrations =
            new CopyOnWriteArrayList<>();

    private final ListenerFailurePolicy failurePolicy;

    public PolicyAwareDomainEventPublisher(ListenerFailurePolicy failurePolicy) {
        this.failurePolicy = failurePolicy;
    }

    @Override
    public <E extends DomainEvent> void register(
            Class<E> eventType,
            DomainEventListener<? super E> listener
    ) {
        registrations.add(new ListenerRegistration<>(eventType, listener));
    }

    @Override
    public void publish(DomainEvent event) {
        List<Throwable> failures = new ArrayList<>();

        for (ListenerRegistration<?> registration : registrations) {
            if (!registration.eventType().isAssignableFrom(event.getClass())) {
                continue;
            }

            try {
                invoke(registration, event);
            } catch (Throwable failure) {
                if (failurePolicy == ListenerFailurePolicy.STOP_ON_FIRST_FAILURE) {
                    throw new EventPublicationException(event, List.of(failure));
                }
                failures.add(failure);
            }
        }

        if (!failures.isEmpty()) {
            throw new EventPublicationException(event, failures);
        }
    }

    @SuppressWarnings("unchecked")
    private static <E extends DomainEvent> void invoke(
            ListenerRegistration<?> registration,
            DomainEvent event
    ) {
        ListenerRegistration<E> typed = (ListenerRegistration<E>) registration;
        typed.listener().on((E) event);
    }
}
```

Design decision:

| Policy | Cocok Untuk | Risiko |
|---|---|---|
| Stop on first failure | Invariant-critical listener | Listener order menjadi penting |
| Continue and collect | Non-critical side effects | Side effect parsial bisa terjadi |

Untuk side effect eksternal, lebih baik jangan sinkron listener. Gunakan outbox/queue.

---

### 7.7 Add Ordered Listener

Kadang ordering memang dibutuhkan.

```java
public interface Ordered {
    int order();
}
```

Registration:

```java
public record OrderedListenerRegistration<E extends DomainEvent>(
        Class<E> eventType,
        DomainEventListener<? super E> listener,
        int order,
        String name
) {
    public OrderedListenerRegistration {
        if (eventType == null) throw new IllegalArgumentException("eventType is required");
        if (listener == null) throw new IllegalArgumentException("listener is required");
        if (name == null || name.isBlank()) throw new IllegalArgumentException("name is required");
    }
}
```

Guideline:

```text
Listener ordering adalah smell ringan.
Kalau order penting untuk correctness, mungkin kamu sedang menyembunyikan workflow dalam event listeners.
```

Ordering boleh untuk teknis:

1. tracing before metrics,
2. audit before notification,
3. validation before mutation dalam plugin pipeline.

Ordering berbahaya untuk domain workflow yang seharusnya eksplisit.

---

### 7.8 Event Publisher with Observability

Event dispatch perlu observable.

Minimal capture:

1. event type,
2. listener name,
3. duration,
4. success/failure,
5. correlation id,
6. event id,
7. number of listeners.

Contoh simplified:

```java
public interface EventPublicationMonitor {
    void listenerStarted(String eventType, String listenerName);
    void listenerSucceeded(String eventType, String listenerName, long durationNanos);
    void listenerFailed(String eventType, String listenerName, long durationNanos, Throwable failure);
}
```

Publisher memanggil monitor:

```java
long started = System.nanoTime();
monitor.listenerStarted(event.getClass().getSimpleName(), registration.name());
try {
    invoke(registration, event);
    monitor.listenerSucceeded(
            event.getClass().getSimpleName(),
            registration.name(),
            System.nanoTime() - started
    );
} catch (Throwable failure) {
    monitor.listenerFailed(
            event.getClass().getSimpleName(),
            registration.name(),
            System.nanoTime() - started,
            failure
    );
    throw failure;
}
```

Tanpa observability, event-driven system menjadi sulit dianalisis.

---

## 8. Code Example: Approval Domain Event End-to-End

### 8.1 Domain Event

```java
import java.time.Instant;

public sealed interface ApplicationEvent extends DomainEvent
        permits ApplicationApproved, ApplicationRejected {
    ApplicationId applicationId();
}

public record ApplicationApproved(
        ApplicationId applicationId,
        OfficerId approvedBy,
        DecisionReason reason,
        Instant occurredAt
) implements ApplicationEvent {}

public record ApplicationRejected(
        ApplicationId applicationId,
        OfficerId rejectedBy,
        DecisionReason reason,
        Instant occurredAt
) implements ApplicationEvent {}
```

---

### 8.2 Aggregate Collects Event

```java
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;

public final class Application {
    private final ApplicationId id;
    private ApplicationStatus status;
    private final List<DomainEvent> events = new ArrayList<>();

    public Application(ApplicationId id, ApplicationStatus status) {
        this.id = id;
        this.status = status;
    }

    public void approve(OfficerId officerId, DecisionReason reason, Clock clock) {
        if (status != ApplicationStatus.PENDING_REVIEW) {
            throw new IllegalStateException("Only pending application can be approved");
        }

        this.status = ApplicationStatus.APPROVED;

        events.add(new ApplicationApproved(
                id,
                officerId,
                reason,
                clock.instant()
        ));
    }

    public List<DomainEvent> pullEvents() {
        List<DomainEvent> result = List.copyOf(events);
        events.clear();
        return result;
    }
}
```

---

### 8.3 Application Service Publishes Event

```java
public final class ApproveApplicationHandler {
    private final ApplicationRepository repository;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    public ApproveApplicationHandler(
            ApplicationRepository repository,
            DomainEventPublisher eventPublisher,
            Clock clock
    ) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    public void handle(ApproveApplicationCommand command) {
        Application application = repository.get(command.applicationId());

        application.approve(command.officerId(), command.reason(), clock);

        repository.save(application);

        eventPublisher.publishAll(application.pullEvents());
    }
}
```

This is fine for in-process demonstration. But in a transactional database application, publication timing must be carefully designed.

Possible options:

1. publish before commit,
2. publish after commit,
3. insert outbox during transaction,
4. separate outbox relay publishes later.

For side effects beyond local process, option 3 is usually safer.

---

### 8.4 Audit Listener

```java
public final class ApprovalAuditListener
        implements DomainEventListener<ApplicationApproved> {

    private final AuditTrailRepository auditTrailRepository;

    public ApprovalAuditListener(AuditTrailRepository auditTrailRepository) {
        this.auditTrailRepository = auditTrailRepository;
    }

    @Override
    public void on(ApplicationApproved event) {
        auditTrailRepository.save(AuditTrailEntry.decision(
                event.applicationId(),
                "APPLICATION_APPROVED",
                event.approvedBy(),
                event.reason().value(),
                event.occurredAt()
        ));
    }
}
```

Audit listener mungkin harus berada dalam transaksi sama jika audit adalah invariant regulatory.

---

### 8.5 Email Listener

```java
public final class ApprovalEmailListener
        implements DomainEventListener<ApplicationApproved> {

    private final ApprovalEmailService emailService;

    public ApprovalEmailListener(ApprovalEmailService emailService) {
        this.emailService = emailService;
    }

    @Override
    public void on(ApplicationApproved event) {
        emailService.enqueueApprovalEmail(event.applicationId());
    }
}
```

Perhatikan `enqueue`, bukan `send` langsung. Email idealnya async dan idempotent.

---

### 8.6 Integration Event Mapper

```java
public final class ApplicationApprovedIntegrationMapper {
    public IntegrationEvent map(ApplicationApproved event, CorrelationId correlationId) {
        return new IntegrationEvent(
                EventId.newId(),
                "application.approved",
                "1.0",
                event.occurredAt(),
                correlationId,
                Map.of(
                        "applicationId", event.applicationId().value(),
                        "approvedBy", event.approvedBy().value(),
                        "approvedAt", event.occurredAt().toString()
                )
        );
    }
}
```

Integration event sebaiknya stabil dan versioned.

---

## 9. Java 8–25 Perspective

### 9.1 Java 8: Lambda dan Functional Interface

Java 8 membuat listener ringan:

```java
publisher.register(ApplicationApproved.class, event -> metrics.increment("approval"));
```

Gunakan untuk simple technical side effect. Untuk domain/business logic penting, named class tetap lebih jelas.

---

### 9.2 Java 9+: Module Boundary

Event API bisa ditempatkan di module terpisah.

```java
module com.example.application.events {
    exports com.example.application.events;
}
```

Ini membantu mencegah listener memakai internal domain class yang tidak diekspor.

---

### 9.3 Java 10: `var`

`var` boleh dipakai saat type obvious.

```java
var event = new ApplicationApproved(...);
```

Namun untuk event flow, explicit type sering lebih readable.

```java
ApplicationApproved event = new ApplicationApproved(...);
```

Karena event type adalah semantic signal.

---

### 9.4 Java 14–17: Records

Records sangat cocok untuk immutable event.

```java
public record CaseClosed(
        CaseId caseId,
        OfficerId closedBy,
        Instant occurredAt
) implements CaseEvent {}
```

Namun record bukan automatic good design.

Jangan buat event seperti:

```java
public record GenericEvent(String type, Map<String, Object> payload) {}
```

Itu hanya map dibungkus record.

---

### 9.5 Java 17+: Sealed Classes

Sealed hierarchy bagus untuk event family tertutup.

```java
public sealed interface CaseEvent extends DomainEvent
        permits CaseOpened, CaseAssigned, CaseClosed {}
```

Keuntungan:

1. event variants eksplisit,
2. switch exhaustive,
3. easier reasoning,
4. better documentation.

---

### 9.6 Pattern Matching Switch

Dengan sealed event hierarchy, event routing bisa lebih jelas.

```java
public void handle(CaseEvent event) {
    switch (event) {
        case CaseOpened opened -> handleOpened(opened);
        case CaseAssigned assigned -> handleAssigned(assigned);
        case CaseClosed closed -> handleClosed(closed);
    }
}
```

Gunakan pattern matching untuk local routing yang kecil dan eksplisit. Jangan mengganti seluruh event bus dengan giant switch jika listener extensibility dibutuhkan.

---

### 9.7 Java 21+: Virtual Threads

Virtual threads membuat async listener berbasis blocking IO lebih murah.

Contoh:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (DomainEvent event : events) {
        executor.submit(() -> publisher.publish(event));
    }
}
```

Namun virtual thread tidak menghapus kebutuhan:

1. timeout,
2. idempotency,
3. backpressure,
4. retry budget,
5. failure isolation,
6. connection pool sizing.

Virtual thread membuat thread murah, bukan dependency eksternal menjadi reliable.

---

### 9.8 Java 21–25: Scoped Values dan Context Propagation

Event processing sering butuh context:

1. correlation id,
2. causation id,
3. actor,
4. tenant,
5. request source,
6. security context.

ThreadLocal sering bermasalah dalam async/virtual-thread environment. Scoped values memberikan model context yang lebih terstruktur untuk lexical scope.

Namun untuk distributed event, context tetap harus masuk event metadata. Jangan mengandalkan ThreadLocal/ScopedValue untuk consumer di proses lain.

Rule:

```text
In-process context boleh lewat scoped context.
Cross-process context harus menjadi explicit event metadata.
```

---

### 9.9 Java 25: Structured Concurrency

Structured concurrency membantu menjalankan beberapa listener/task sebagai satu unit terstruktur.

Mental model:

```text
Jika beberapa async listener harus dianggap satu operasi bersama,
structured concurrency memberi lifecycle, cancellation, dan join yang lebih jelas.
```

Tetapi jangan gunakan structured concurrency untuk menyamarkan bahwa side effect sebenarnya harus durable. Untuk distributed side effect, outbox/broker tetap lebih aman.

---

## 10. Event Ordering

Ordering adalah salah satu sumber bug paling sering dalam event-driven system.

### 10.1 Local Listener Ordering

Dalam in-process event publisher, ordering biasanya mengikuti registration order atau explicit order.

Problem:

```text
Listener B diam-diam bergantung pada side effect Listener A.
```

Contoh buruk:

```text
ApplicationApproved
  -> Listener A creates notification record
  -> Listener B reads notification record and sends email
```

Jika B bergantung pada A, maka ini bukan independent listeners. Ini workflow tersembunyi.

Lebih baik:

```text
ApplicationApproved
  -> NotificationWorkflowHandler
       -> create notification
       -> send/queue email
```

atau terbitkan event baru:

```text
ApplicationApproved -> NotificationCreated -> EmailQueued
```

Tapi hati-hati jangan membuat event chain terlalu panjang tanpa ownership.

---

### 10.2 Distributed Ordering

Dalam broker, ordering bergantung pada partition/key/queue semantics.

Pertanyaan desain:

1. Apakah event untuk satu aggregate harus diproses berurutan?
2. Apa ordering key-nya?
3. Apakah consumer paralel bisa memproses event aggregate yang sama?
4. Apa yang terjadi jika event nomor 3 tiba sebelum nomor 2?
5. Apakah event punya sequence number?

Untuk aggregate lifecycle, sering perlu sequence:

```java
public record CaseLifecycleEventEnvelope(
        String eventId,
        String aggregateId,
        long aggregateVersion,
        String eventType,
        Instant occurredAt,
        Object payload
) {}
```

Consumer bisa menolak/menunda event jika version tidak sesuai.

---

### 10.3 Ordering vs Idempotency

Ordering tidak menggantikan idempotency.

Bahkan jika broker menjaga ordering per key, consumer tetap bisa menerima duplicate.

Consumer harus bisa berkata:

```text
Event ini sudah pernah saya proses.
```

Biasanya dengan table:

```text
processed_event
- consumer_name
- event_id
- processed_at
```

Atau dengan business idempotency key:

```text
email_type + application_id + recipient
```

---

## 11. Duplication, Retry, and Idempotency

### 11.1 Duplicate Delivery adalah Normal

Dalam distributed event system, duplicate delivery harus dianggap normal.

Penyebab:

1. producer retry,
2. broker redelivery,
3. consumer crash after side effect before ack,
4. network timeout,
5. outbox relay retry,
6. manual replay.

Jika consumer tidak idempotent, duplicate event menyebabkan:

1. email double send,
2. duplicate audit,
3. duplicate external request,
4. double charge,
5. duplicate task,
6. inconsistent projection.

---

### 11.2 Idempotent Consumer

Contoh idempotent consumer sederhana:

```java
public final class ApprovalEmailConsumer {
    private final ProcessedEventRepository processedEvents;
    private final EmailService emailService;

    public void consume(ApplicationApprovedIntegrationEvent event) {
        if (processedEvents.exists("approval-email", event.eventId())) {
            return;
        }

        emailService.sendApprovalEmail(event.applicationId());

        processedEvents.markProcessed("approval-email", event.eventId());
    }
}
```

Masalah: jika `sendApprovalEmail` berhasil tapi `markProcessed` gagal, email bisa terkirim dua kali saat retry.

Solusi lebih kuat:

1. email outbox internal,
2. unique business key,
3. transactional insert before side effect,
4. downstream idempotency key.

Contoh:

```java
public void consume(ApplicationApprovedIntegrationEvent event) {
    EmailRequest request = EmailRequest.approval(
            event.applicationId(),
            event.applicantEmail(),
            "approval:" + event.applicationId()
    );

    emailQueue.enqueueIfAbsent(request);
}
```

Idempotency key berdasarkan business meaning sering lebih kuat daripada hanya event id.

---

### 11.3 Retry Classification

Tidak semua failure boleh di-retry.

| Failure | Retry? | Contoh |
|---|---:|---|
| Network timeout | Ya | broker/external API timeout |
| 429 rate limit | Ya dengan backoff | external API limit |
| 5xx external | Ya dengan budget | temporary failure |
| Validation error | Tidak | invalid payload |
| Unknown event version | Tidak langsung | schema mismatch |
| Authorization failure | Tidak | wrong credential/policy |
| Business rule violation | Tidak | state incompatible |

Retry tanpa classification menyebabkan retry storm.

---

## 12. Event Replay

Replay berarti memproses ulang event lama.

Replay berguna untuk:

1. rebuild projection,
2. recover consumer,
3. backfill data,
4. fix bug after code repair,
5. audit reconstruction.

Tetapi replay berbahaya jika consumer punya side effect eksternal.

Contoh buruk:

```text
Replay ApplicationApproved 2020–2026 -> semua approval email terkirim ulang.
```

Consumer harus punya replay mode atau side effect isolation.

```java
public enum ProcessingMode {
    LIVE,
    REPLAY
}
```

Consumer:

```java
public void consume(ApplicationApproved event, ProcessingMode mode) {
    projection.update(event);

    if (mode == ProcessingMode.LIVE) {
        notification.enqueue(event);
    }
}
```

Guideline:

```text
Projection consumer harus replay-safe.
External side-effect consumer harus live-only atau idempotent dengan business key.
```

---

## 13. Listener Lifecycle

Listener lifecycle sering diabaikan.

Pertanyaan:

1. Kapan listener didaftarkan?
2. Kapan listener dilepas?
3. Apakah listener singleton?
4. Apakah listener punya resource?
5. Apakah listener thread-safe?
6. Apakah listener boleh stateful?
7. Apakah listener bisa didaftarkan dua kali?

### 13.1 Duplicate Registration

Bug umum:

```text
Application startup reload -> same listener registered twice -> side effect double.
```

Solusi:

1. registration id unik,
2. fail fast duplicate,
3. DI container-managed listeners,
4. startup diagnostics.

```java
public record ListenerId(String value) {}
```

Registration:

```java
public record NamedListenerRegistration<E extends DomainEvent>(
        ListenerId id,
        Class<E> eventType,
        DomainEventListener<? super E> listener
) {}
```

Publisher bisa reject duplicate id.

---

### 13.2 Memory Leak

Observer/listener dapat menyebabkan memory leak jika subject hidup lebih lama daripada observer.

Contoh:

```text
GlobalEventBus holds listener
Listener holds UI/controller/session object
Session should die but cannot be GC'd
```

Solusi:

1. explicit unregister,
2. weak reference listener untuk use case tertentu,
3. lifecycle-managed subscription,
4. avoid global event bus.

Subscription handle:

```java
public interface Subscription extends AutoCloseable {
    @Override
    void close();
}
```

Register returns subscription:

```java
public <E extends DomainEvent> Subscription register(
        Class<E> eventType,
        DomainEventListener<? super E> listener
) {
    ListenerRegistration<E> registration = new ListenerRegistration<>(eventType, listener);
    registrations.add(registration);
    return () -> registrations.remove(registration);
}
```

Usage:

```java
try (Subscription ignored = publisher.register(ApplicationApproved.class, listener)) {
    // listener active in this scope
}
```

---

## 14. Anti-Pattern Catalog

### 14.1 Event Soup

Event soup terjadi ketika terlalu banyak event dibuat tanpa taxonomy, ownership, dan semantic clarity.

Gejala:

1. Event names inconsistent.
2. Banyak event mirip.
3. Tidak jelas event mana authoritative.
4. Listener subscribe ke banyak event untuk menebak state.
5. Developer takut mengubah event.
6. Sequence event sulit dipahami.
7. Debugging memerlukan membaca log broker berjam-jam.

Contoh:

```text
ApplicationUpdated
ApplicationStatusUpdated
ApplicationStatusChanged
ApplicationApproved
ApplicationDecisionUpdated
ApplicationChanged
```

Pertanyaan:

```text
Mana yang harus consumer pakai?
Apa beda Updated dan Changed?
Apakah Approved juga StatusChanged?
Apakah semua diterbitkan dalam satu transaksi?
```

Solusi:

1. event taxonomy,
2. owner per event family,
3. naming convention,
4. schema registry/contract test,
5. deprecation policy,
6. event catalog,
7. reduce generic events.

---

### 14.2 Hidden Synchronous Dependency

Gejala:

```text
Service terlihat hanya publish event,
tetapi sebenarnya operation gagal jika listener tertentu gagal.
```

Contoh:

```java
application.approve(...);
repository.save(application);
publisher.publish(new ApplicationApproved(...));
```

Jika `publisher` sinkron dan listener email gagal, approval gagal.

Masalah:

1. dependency tersembunyi,
2. SLA operation utama tergantung side effect,
3. testing tidak mencerminkan runtime,
4. deployment listener baru bisa merusak command lama.

Solusi:

1. jelas bedakan sync internal event vs async integration event,
2. failure policy eksplisit,
3. listener criticality jelas,
4. gunakan outbox untuk side effect non-critical.

---

### 14.3 Event as Remote Procedure Call

Event dipakai untuk menyuruh service lain melakukan action.

Contoh:

```text
GeneratePdfEvent
SendEmailEvent
CreateUserEvent
UpdateCacheEvent
```

Ini mungkin valid sebagai message command, tetapi jangan disebut domain event.

Masalah:

1. publisher berharap subscriber tertentu melakukan sesuatu,
2. jika subscriber tidak ada, business flow gagal diam-diam,
3. coupling tetap kuat tapi tersembunyi,
4. response tidak jelas.

Solusi:

1. gunakan command message jika memang command,
2. gunakan request/reply jika perlu response,
3. gunakan domain event jika hanya mengumumkan fakta,
4. namai channel sesuai semantic.

---

### 14.4 Listener Side-Effect Hell

Gejala:

1. satu event memicu banyak listener,
2. listener menerbitkan event lain,
3. event chain panjang,
4. sulit tahu akibat akhir satu command,
5. circular event terjadi.

Contoh:

```text
ApplicationApproved
  -> CreateNotificationListener -> NotificationCreated
  -> SendEmailListener -> EmailSent
  -> UpdateCaseListener -> CaseUpdated
  -> ApplicationUpdatedListener -> ApplicationChanged
```

Solusi:

1. batasi event chaining,
2. gunakan workflow/orchestrator untuk flow kompleks,
3. dokumentasikan causation id,
4. deteksi cycle,
5. observability graph.

---

### 14.5 Generic Event with Map Payload

Contoh:

```java
public record Event(String type, Map<String, Object> payload) {}
```

Masalah:

1. tidak type-safe,
2. fragile runtime parsing,
3. refactoring sulit,
4. contract tersembunyi,
5. error terlambat ditemukan.

Boleh digunakan di boundary sangat dinamis, tetapi sebaiknya internal Java domain event tetap strongly typed.

---

### 14.6 Event Without Time

Event tanpa `occurredAt` kehilangan konteks waktu.

Buruk:

```java
public record CaseClosed(CaseId caseId) {}
```

Lebih baik:

```java
public record CaseClosed(
        CaseId caseId,
        OfficerId closedBy,
        Instant occurredAt
) {}
```

Untuk distributed event, sering juga perlu:

1. event id,
2. correlation id,
3. causation id,
4. aggregate version,
5. schema version.

---

### 14.7 Domain Event Leaking Persistence Entity

Buruk:

```java
public record ApplicationApproved(ApplicationEntity entity) {}
```

Masalah:

1. entity mutable,
2. lazy loading problem,
3. persistence concern bocor,
4. event historical meaning berubah jika entity berubah,
5. serialization berbahaya.

Lebih baik event membawa immutable snapshot/reference yang dibutuhkan.

---

### 14.8 No Subscriber Ownership

Event diterbitkan, tapi tidak ada yang jelas bertanggung jawab atas consumer.

Gejala:

1. listener tidak terdokumentasi,
2. consumer mati tanpa alert,
3. backlog tidak dimonitor,
4. event schema berubah tanpa koordinasi,
5. replay tidak diuji.

Solusi:

1. event catalog,
2. owner publisher dan subscriber,
3. consumer contract test,
4. dashboard lag/failure,
5. runbook replay.

---

## 15. Refactoring Path

### 15.1 Dari God Service ke Domain Event

Awal:

```java
public void approve(ApproveApplicationRequest request) {
    Application app = repository.findById(request.applicationId());
    app.setStatus(APPROVED);
    repository.save(app);

    auditService.record(...);
    emailService.send(...);
    notificationService.create(...);
    searchService.update(...);
    externalGateway.notify(...);
}
```

Step 1: pisahkan invariant utama.

```java
app.approve(officerId, reason, now);
repository.save(app);
```

Step 2: buat domain event.

```java
ApplicationApproved event = new ApplicationApproved(...);
```

Step 3: pindahkan side effect non-core ke listener.

```java
publisher.publish(event);
```

Step 4: klasifikasikan listener.

| Listener | Criticality | Mode |
|---|---|---|
| Audit decision | Critical | sync/transactional |
| Email | Non-critical | async |
| Search index | Non-critical | async |
| External sync | Integration | outbox |
| Metrics | Best effort | async/drop-tolerant |

Step 5: perkenalkan outbox untuk distributed side effect.

```text
ApplicationApproved domain event
  -> OutboxIntegrationEventWriter
      -> application.approved integration event
```

Step 6: tambahkan idempotency consumer.

Step 7: tambahkan observability.

---

### 15.2 Dari Generic Event ke Typed Event

Awal:

```java
publish("APPLICATION_APPROVED", Map.of("id", id));
```

Refactor:

```java
public record ApplicationApproved(
        ApplicationId applicationId,
        OfficerId approvedBy,
        Instant occurredAt
) implements ApplicationEvent {}
```

Kemudian:

```java
publisher.publish(new ApplicationApproved(id, officerId, now));
```

Manfaat:

1. compile-time safety,
2. searchable code,
3. easier refactoring,
4. explicit semantic,
5. better tests.

---

### 15.3 Dari Event RPC ke Command/Event Separation

Awal:

```text
SendApprovalEmailEvent
```

Refactor pilihan 1: domain event + listener

```text
ApplicationApproved -> ApprovalEmailListener
```

Refactor pilihan 2: command message

```text
SendApprovalEmailCommand
```

Gunakan pilihan 2 jika publisher memang meminta action spesifik dan membutuhkan command semantics.

---

## 16. Testing Strategy

### 16.1 Test Event Emission

Test aggregate/application service harus memastikan event diterbitkan saat state berubah.

```java
@Test
void approvingPendingApplicationEmitsApplicationApproved() {
    Application app = new Application(new ApplicationId("A-1"), PENDING_REVIEW);

    app.approve(new OfficerId("O-1"), new DecisionReason("valid"), fixedClock);

    List<DomainEvent> events = app.pullEvents();

    assertEquals(1, events.size());
    assertInstanceOf(ApplicationApproved.class, events.get(0));
}
```

Test ini tidak perlu email/search/external dependency.

---

### 16.2 Test Listener Independently

```java
@Test
void approvalEmailListenerQueuesEmail() {
    FakeApprovalEmailService emailService = new FakeApprovalEmailService();
    ApprovalEmailListener listener = new ApprovalEmailListener(emailService);

    listener.on(new ApplicationApproved(
            new ApplicationId("A-1"),
            new OfficerId("O-1"),
            new DecisionReason("valid"),
            Instant.parse("2026-01-01T00:00:00Z")
    ));

    assertTrue(emailService.hasQueuedApprovalEmail(new ApplicationId("A-1")));
}
```

---

### 16.3 Test Publisher Failure Policy

```java
@Test
void publisherContinuesAndCollectsFailures() {
    PolicyAwareDomainEventPublisher publisher = new PolicyAwareDomainEventPublisher(
            ListenerFailurePolicy.CONTINUE_AND_COLLECT_FAILURES
    );

    publisher.register(ApplicationApproved.class, event -> {
        throw new RuntimeException("boom-1");
    });
    publisher.register(ApplicationApproved.class, event -> {
        throw new RuntimeException("boom-2");
    });

    ApplicationApproved event = sampleApprovalEvent();

    EventPublicationException ex = assertThrows(
            EventPublicationException.class,
            () -> publisher.publish(event)
    );

    assertEquals(2, ex.failures().size());
}
```

---

### 16.4 Contract Test for Integration Event

Integration event harus punya contract test.

Test:

1. event type benar,
2. schema version benar,
3. required fields ada,
4. timestamp format stabil,
5. id/correlation ada,
6. backward compatibility.

Pseudo-test:

```java
@Test
void mapsApplicationApprovedToStableIntegrationContract() {
    ApplicationApproved domainEvent = sampleApprovalEvent();

    ApplicationApprovedIntegrationEvent integrationEvent = mapper.map(domainEvent, correlationId);

    assertEquals("application.approved", integrationEvent.eventType());
    assertEquals("1.0", integrationEvent.schemaVersion());
    assertEquals("A-1", integrationEvent.applicationId());
    assertNotNull(integrationEvent.eventId());
}
```

---

### 16.5 Replay Test

Consumer projection harus diuji dengan replay.

```java
@Test
void projectionCanBeRebuiltFromEvents() {
    List<ApplicationEvent> events = List.of(
            new ApplicationSubmitted(id, applicantId, t1),
            new ApplicationApproved(id, officerId, reason, t2)
    );

    ApplicationProjection projection = new ApplicationProjection();

    for (ApplicationEvent event : events) {
        projection.apply(event);
    }

    assertEquals(APPROVED, projection.statusOf(id));
}
```

---

## 17. Observability and Debugging Angle

Event-driven system wajib observable karena control flow tidak lagi linear.

### 17.1 Metadata Minimal

Untuk domain/integration event penting, metadata minimal:

```text
eventId
correlationId
causationId
eventType
schemaVersion
aggregateId
aggregateVersion
occurredAt
publishedAt
producer
```

Domain event internal mungkin tidak perlu semua field, tetapi integration event hampir selalu perlu metadata kaya.

---

### 17.2 Correlation and Causation

Correlation ID menjawab:

```text
Semua hal ini bagian dari request/process yang sama?
```

Causation ID menjawab:

```text
Event/command apa yang menyebabkan event ini?
```

Contoh:

```text
Command: ApproveApplicationCommand C-100
  -> Event: ApplicationApproved E-200
      correlationId = R-1
      causationId = C-100
  -> Event: ApprovalEmailQueued E-300
      correlationId = R-1
      causationId = E-200
```

Tanpa causation, event chain sulit dianalisis.

---

### 17.3 Metrics

Metrics penting:

1. events published by type,
2. listener duration,
3. listener failure count,
4. consumer lag,
5. retry count,
6. dead-letter count,
7. duplicate skipped count,
8. replay throughput,
9. outbox backlog,
10. event age at processing.

Metric yang sangat berguna:

```text
event_processing_lag = now - occurredAt/publishedAt
```

Ini menunjukkan seberapa jauh eventual consistency tertinggal.

---

### 17.4 Logs

Log event dispatch jangan berlebihan.

Buruk:

```text
Published event: {huge payload with PII}
```

Lebih baik:

```text
eventType=ApplicationApproved eventId=E-1 applicationId=A-1 correlationId=C-1 listener=ApprovalEmailListener status=SUCCESS durationMs=12
```

Hindari log payload sensitif.

---

### 17.5 Debugging Checklist

Saat event side effect tidak terjadi:

1. Apakah event benar-benar diterbitkan?
2. Apakah transaction commit berhasil?
3. Apakah listener terdaftar?
4. Apakah event type match?
5. Apakah listener gagal tapi failure disembunyikan?
6. Apakah async queue menerima message?
7. Apakah consumer lag?
8. Apakah event masuk dead-letter?
9. Apakah idempotency menganggap event sudah processed?
10. Apakah schema version tidak kompatibel?
11. Apakah correlation id tersedia untuk trace?

---

## 18. Security and Privacy Consideration

Event sering membawa data sensitif. Sekali event masuk broker/log/retention, data bisa sulit dihapus.

Pertanyaan:

1. Apakah event membawa PII?
2. Apakah field dibutuhkan consumer?
3. Apakah event terenkripsi?
4. Siapa yang boleh subscribe?
5. Berapa lama event disimpan?
6. Apakah event masuk log?
7. Apakah replay bisa membocorkan data lama?
8. Apakah event harus mask/tokenize field tertentu?

Guideline:

```text
Event payload harus minimum sufficient, bukan maximum convenient.
```

Buruk:

```java
public record ApplicantRegisteredEvent(
        String applicantId,
        String fullName,
        String nric,
        String email,
        String phone,
        String address,
        String dateOfBirth
) {}
```

Lebih baik jika consumer hanya butuh id:

```java
public record ApplicantRegisteredEvent(
        String applicantId,
        Instant occurredAt
) {}
```

Atau buat event berbeda untuk consumer authorized.

---

## 19. Performance Consideration

### 19.1 In-Process Event

Performance concern:

1. listener count,
2. dispatch overhead,
3. reflection/type matching,
4. allocation event object,
5. slow listener,
6. lock contention,
7. CopyOnWriteArrayList write cost.

Untuk kebanyakan enterprise domain event, overhead dispatch kecil dibanding DB/network. Tetapi slow listener bisa dominan.

---

### 19.2 Async Event

Performance concern:

1. queue throughput,
2. serialization cost,
3. payload size,
4. batching,
5. partitioning key,
6. consumer parallelism,
7. backpressure,
8. retry storm,
9. dead-letter handling,
10. outbox polling interval.

Jangan hanya bertanya:

```text
Berapa event/sec?
```

Tanyakan juga:

```text
Berapa event lag maksimal yang diterima?
Berapa retry budget?
Berapa payload size?
Apakah ordering per aggregate wajib?
Apakah consumer idempotent?
```

---

## 20. Event Design Checklist

Gunakan checklist ini sebelum membuat event baru.

### 20.1 Semantic Checklist

```text
[ ] Apakah event merepresentasikan fakta yang sudah terjadi?
[ ] Apakah namanya past tense?
[ ] Apakah event punya owner?
[ ] Apakah event berbeda jelas dari event lain?
[ ] Apakah event bukan command terselubung?
[ ] Apakah event punya domain meaning yang stabil?
```

### 20.2 Payload Checklist

```text
[ ] Apakah payload immutable?
[ ] Apakah payload minimum sufficient?
[ ] Apakah tidak membawa entity mutable?
[ ] Apakah tidak membawa data sensitif yang tidak perlu?
[ ] Apakah punya occurredAt?
[ ] Apakah integration event punya eventId dan schemaVersion?
[ ] Apakah correlationId/causationId dibutuhkan?
```

### 20.3 Delivery Checklist

```text
[ ] Apakah event diproses sync atau async?
[ ] Apakah failure policy jelas?
[ ] Apakah retry policy jelas?
[ ] Apakah duplicate delivery ditangani?
[ ] Apakah ordering requirement jelas?
[ ] Apakah replay semantics jelas?
[ ] Apakah dead-letter handling ada?
```

### 20.4 Consumer Checklist

```text
[ ] Siapa consumer-nya?
[ ] Apakah consumer owner jelas?
[ ] Apakah consumer idempotent?
[ ] Apakah consumer bisa handle unknown/new field?
[ ] Apakah consumer bisa handle old schema version?
[ ] Apakah consumer side effect replay-safe?
[ ] Apakah consumer lag dimonitor?
```

### 20.5 Observability Checklist

```text
[ ] Apakah event publication dilog secara aman?
[ ] Apakah listener failure terlihat?
[ ] Apakah processing lag dimonitor?
[ ] Apakah correlation id mengalir?
[ ] Apakah event bisa dicari berdasarkan aggregate id?
[ ] Apakah ada dashboard untuk backlog/dead-letter?
```

---

## 21. Common Interview / Staff-Level Discussion

### 21.1 “Apa beda Observer dan Pub/Sub?”

Observer biasanya in-process, subject mengetahui observer list atau mekanisme registrasi langsung. Pub/Sub biasanya memakai topic/channel/broker dan publisher tidak mengetahui subscriber. Observer lebih dekat ke object collaboration; Pub/Sub lebih dekat ke messaging/distributed communication.

Namun keduanya berbagi mental model:

```text
Publisher/subject mengumumkan perubahan kepada pihak yang tertarik.
```

Perbedaan terbesar ada pada failure model, delivery guarantee, lifecycle, dan observability.

---

### 21.2 “Kapan event lebih buruk daripada direct call?”

Event lebih buruk jika:

1. hanya ada satu consumer yang wajib dipanggil,
2. caller membutuhkan immediate response,
3. failure harus langsung diketahui,
4. ordering kompleks tapi disembunyikan,
5. team belum punya observability async,
6. event contract tidak dikelola,
7. idempotency tidak ada,
8. domain flow menjadi sulit dibaca.

Direct call lebih baik jika dependency eksplisit dan sinkron memang bagian dari invariant.

---

### 21.3 “Apa risiko terbesar event-driven system?”

Risiko terbesar bukan teknologinya, tetapi semantic ambiguity.

Event-driven system gagal ketika orang tidak tahu:

1. apa arti event,
2. kapan event diterbitkan,
3. apakah event reliable,
4. apakah duplicate mungkin,
5. apakah order dijamin,
6. siapa consumer,
7. apa yang terjadi saat consumer gagal,
8. apakah replay aman.

---

### 21.4 “Domain event harus diterbitkan dari aggregate atau service?”

Tergantung model.

Aggregate cocok menerbitkan event jika event adalah akibat langsung dari perubahan invariant aggregate.

Application service cocok menerbitkan event jika event adalah akibat use case orchestration atau melibatkan beberapa aggregate.

Yang penting:

```text
Event harus diterbitkan setelah fakta benar-benar terjadi secara domain.
```

Jangan publish event sebelum invariant berhasil.

---

### 21.5 “Apakah semua side effect harus event?”

Tidak.

Event cocok jika side effect adalah reaction terhadap fakta yang meaningful.

Tidak semua helper call perlu event. Jangan membuat event untuk menyembunyikan dependency biasa.

Gunakan direct call jika:

1. dependency adalah bagian langsung dari use case,
2. response dibutuhkan,
3. failure harus menggagalkan operation,
4. flow harus eksplisit.

Gunakan event jika:

1. ada multiple independent reactions,
2. reaction bisa evolve sendiri,
3. publisher tidak perlu tahu semua consequences,
4. async/eventual consistency diterima,
5. audit/event history berguna.

---

## 22. Case Study: Regulatory Approval Event Design

### 22.1 Problem

Operation:

```text
Officer approves application.
```

Consequences:

1. update application status,
2. save decision history,
3. record audit trail,
4. notify applicant,
5. notify supervisor dashboard,
6. update reporting read model,
7. sync external licensing system,
8. stop SLA timer.

### 22.2 Classification

| Consequence | Category | Suggested Pattern |
|---|---|---|
| Update application status | Core invariant | Direct aggregate mutation |
| Save decision history | Core/regulatory invariant | Same transaction |
| Record audit trail | Core/regulatory invariant | Same transaction or transactional listener |
| Notify applicant | Side effect | Async event consumer |
| Supervisor dashboard | Projection | Async projection consumer |
| Reporting read model | Projection | Event-carried state/replayable consumer |
| External licensing sync | Integration | Outbox + integration event |
| Stop SLA timer | Domain reaction | Could be sync or async depending invariant |

### 22.3 Domain Event

```java
public record ApplicationApproved(
        ApplicationId applicationId,
        OfficerId approvedBy,
        DecisionReason reason,
        ApplicationType applicationType,
        Instant occurredAt
) implements ApplicationEvent {}
```

### 22.4 Transactional Work

```text
Transaction:
  - load application
  - validate transition
  - set status APPROVED
  - insert decision history
  - insert audit entry
  - insert outbox event application.approved
  - commit
```

### 22.5 Async Work

```text
Outbox relay:
  - publishes application.approved integration event

Consumers:
  - applicant notification consumer
  - supervisor dashboard projection
  - reporting projection
  - external licensing sync consumer
```

### 22.6 Why This Design Is Better

1. Core approval is not blocked by email/external system.
2. Audit remains transactionally safe.
3. External sync is durable through outbox.
4. Consumers can retry independently.
5. Event metadata provides traceability.
6. Reporting projection can replay.
7. Event contract is explicit.
8. Side effects are testable independently.

### 22.7 Remaining Trade-Offs

1. Eventual consistency must be accepted.
2. Consumer lag must be monitored.
3. Duplicate events must be handled.
4. Schema versioning is required.
5. Operational tooling becomes important.

---

## 23. Summary

Observer, Listener, Event, dan Pub/Sub adalah pattern untuk memisahkan fakta dari reaksi. Tetapi mereka bukan magic decoupling. Mereka memindahkan coupling dari direct method call ke event contract, delivery semantics, ordering, idempotency, dan observability.

Mental model utama:

```text
Command = intent before change.
Event = fact after change.
Listener = reaction to fact.
Pub/Sub = distributed reaction through channel/topic.
```

Event yang baik:

1. past tense,
2. domain meaningful,
3. immutable,
4. minimum sufficient,
5. punya owner,
6. punya metadata waktu,
7. punya clear delivery semantics,
8. consumer-nya idempotent,
9. observable,
10. versioned jika keluar boundary.

Anti-pattern terbesar:

1. event soup,
2. event as RPC,
3. hidden synchronous dependency,
4. listener side-effect hell,
5. generic map payload,
6. domain event bocor sebagai integration event,
7. no idempotency,
8. no observability.

Untuk engineer senior, pertanyaan penting bukan:

```text
Bisa pakai event bus tidak?
```

Tetapi:

```text
Apa fakta domain yang terjadi?
Siapa yang perlu tahu?
Apakah reaction bagian invariant atau consequence?
Apakah sync atau async?
Apa failure semantics?
Apa ordering semantics?
Apa idempotency model?
Apa replay semantics?
Apa observability model?
```

Jika pertanyaan itu bisa dijawab, event pattern menjadi alat desain yang kuat. Jika tidak, event pattern akan berubah menjadi distributed confusion.

---

## 24. Design Review Checklist Ringkas

```text
[ ] Event dinamai sebagai fakta, bukan command.
[ ] Event punya owner.
[ ] Domain event dan integration event dipisahkan.
[ ] Payload immutable dan minimum sufficient.
[ ] Tidak membawa entity mutable/framework object.
[ ] occurredAt tersedia.
[ ] Integration event punya eventId, schemaVersion, correlationId.
[ ] Sync vs async dipilih secara sadar.
[ ] Failure policy jelas.
[ ] Retry policy jelas.
[ ] Consumer idempotent.
[ ] Ordering assumption terdokumentasi.
[ ] Replay behavior jelas.
[ ] Sensitive data dikontrol.
[ ] Listener lifecycle aman.
[ ] Observability mencakup event type, listener, duration, failure, lag.
```

---

## 25. Posisi Part Ini dalam Seri

Part ini menutup bagian awal behavioral pattern berbasis event. Pattern ini akan muncul lagi dalam part berikutnya:

1. Command/Handler sudah membahas intent sebelum perubahan.
2. Observer/Event membahas fakta setelah perubahan.
3. State Machine nanti membahas lifecycle dan transition.
4. Integration Pattern nanti membahas Outbox, Inbox, Saga, dan Idempotency secara distributed.
5. Observability Pattern nanti membahas correlation, causation, audit, dan telemetry lebih dalam.

Dengan demikian, event tidak dipahami sebagai fitur broker/framework, tetapi sebagai model desain untuk memisahkan core change, consequence, integration, dan traceability.

---

**Status:** Part 12 selesai.  
**Berikutnya:** `13-behavioral-template-method-hook-callback-extension-point.md`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./11-behavioral-command-handler-chain-of-responsibility.md">⬅️ Behavioral Pattern II: Command, Handler, Chain of Responsibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./13-behavioral-template-method-hook-callback-extension-point.md">Behavioral Pattern V: Template Method, Hook, Callback, Extension Point ➡️</a>
</div>
