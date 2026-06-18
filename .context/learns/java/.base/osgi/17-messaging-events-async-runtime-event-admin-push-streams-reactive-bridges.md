# Part 17 — Messaging, Events, and Async Runtime: Event Admin, Push Streams, Reactive Bridges

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `17-messaging-events-async-runtime-event-admin-push-streams-reactive-bridges.md`  
Target Java: 8 hingga 25  
Level: Advanced / platform engineering

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas persistence di OSGi: JDBC, JPA, transaction boundary, classloading provider, dan bagaimana state durable dikelola dalam runtime modular. Sekarang kita masuk ke area yang sering terlihat sederhana tetapi sangat menentukan kualitas arsitektur platform OSGi: **messaging, eventing, dan asynchronous runtime**.

Di OSGi, event bisa muncul dalam beberapa bentuk:

1. **Framework event**: event dari framework tentang bundle, service, framework lifecycle.
2. **Service dynamics event**: service muncul, berubah, hilang.
3. **Application/domain event**: event bisnis di dalam aplikasi.
4. **Configuration event**: konfigurasi berubah.
5. **External messaging event**: Kafka, RabbitMQ, JMS, MQTT, HTTP callback, scheduler, atau file watcher.
6. **Async computation event**: promise selesai, stream menghasilkan data, task gagal, cancellation, timeout.

Kesalahan umum engineer saat membawa konsep messaging ke OSGi adalah menyamakan semua event sebagai “publish-subscribe biasa”. Padahal OSGi punya realitas unik:

- runtime bersifat dinamis;
- handler bisa muncul/hilang saat aplikasi berjalan;
- dependency bisa berubah tanpa restart JVM;
- classloader identity bisa berbeda;
- event in-process tidak sama dengan broker durable;
- event asynchronous tidak otomatis aman dari race condition;
- service registry dan event bus sering bercampur secara tidak sehat;
- lifecycle bundle memengaruhi correctness event delivery.

Target part ini adalah membuat kamu punya mental model yang kuat untuk menjawab pertanyaan desain seperti:

- Kapan menggunakan service call langsung?
- Kapan menggunakan Event Admin?
- Kapan menggunakan external broker?
- Kapan menggunakan Promise/Push Stream?
- Bagaimana menghindari event storm?
- Bagaimana menjaga ordering dan idempotency?
- Bagaimana menangani handler yang hilang saat event sedang diproses?
- Bagaimana mendesain event contract yang versionable?
- Bagaimana membuat bridge dari OSGi runtime ke Kafka/RabbitMQ/JMS tanpa membuat sistem rapuh?

---

## 2. Mental Model: OSGi Messaging Bukan Satu Mekanisme

Dalam banyak aplikasi biasa, komunikasi internal sering hanya dibagi menjadi dua:

```text
method call vs message queue
```

Dalam OSGi, pembagiannya lebih kaya:

```text
+-------------------------+-----------------------------------------------+
| Mechanism               | Mental Model                                  |
+-------------------------+-----------------------------------------------+
| Service registry        | Dynamic in-process capability lookup          |
| Direct service call     | Synchronous typed collaboration               |
| Event Admin             | In-process pub/sub notification               |
| Promise                 | Async result abstraction                      |
| Push Stream             | Async stream/backpressure-ish composition     |
| Scheduler/whiteboard    | Time-driven dynamic service invocation        |
| External broker bridge  | Durable/distributed messaging boundary        |
| Framework events        | Runtime lifecycle telemetry                   |
+-------------------------+-----------------------------------------------+
```

Top 1% engineer tidak memilih event karena “loose coupling terdengar bagus”. Mereka bertanya:

1. Apakah producer membutuhkan hasil dari consumer?
2. Apakah consumer boleh tidak ada?
3. Apakah event harus durable?
4. Apakah ordering penting?
5. Apakah event boleh diproses lebih dari sekali?
6. Apakah event boleh hilang?
7. Apakah event harus melintasi process boundary?
8. Apakah handler bisa lambat?
9. Apakah failure handler boleh menggagalkan producer?
10. Apakah kontrak event akan berevolusi lintas versi?

OSGi memberi mekanisme powerful, tetapi tidak menghapus keputusan arsitektur tersebut.

---

## 3. Communication Decision Matrix

Gunakan tabel ini sebagai starting point:

| Kebutuhan | Mekanisme yang Umumnya Tepat |
|---|---|
| Butuh hasil langsung dan consumer wajib ada | Direct OSGi service call |
| Consumer optional dan hanya perlu notifikasi in-process | Event Admin |
| Banyak implementation dinamis dipanggil berdasarkan metadata | Whiteboard service pattern |
| Butuh async result dari operasi internal | Promise |
| Butuh stream data async in-process | Push Stream |
| Butuh durability, retry lintas restart, consumer beda process | External broker |
| Butuh audit trail bisnis legal/regulatory | Persist dulu, lalu publish event |
| Butuh orchestration long-running | BPM/workflow engine atau durable job model |
| Butuh broadcast lifecycle runtime | Framework/Bundle/Service listener |

Rule penting:

> Jangan gunakan Event Admin sebagai pengganti service contract yang sebenarnya synchronous dan mandatory.

Jika caller membutuhkan jawaban, error semantics, transaction semantics, atau authorization result, direct service lebih eksplisit.

---

## 4. OSGi Event Admin: Apa yang Diselesaikan

**Event Admin** adalah service OSGi Compendium untuk publish-subscribe event di dalam OSGi runtime.

Secara konseptual:

```text
Publisher Bundle
    |
    | Event(topic, properties)
    v
EventAdmin Service
    |
    +--> EventHandler A
    +--> EventHandler B
    +--> EventHandler C
```

Publisher tidak perlu tahu siapa subscriber-nya. Subscriber mendaftarkan dirinya sebagai `EventHandler` service dengan property topic tertentu.

Event Admin cocok untuk:

- notification in-process;
- loose coupling antar bundle;
- lifecycle-aware event handler;
- dynamic handler registration;
- management/monitoring notification;
- cache invalidation;
- plugin notification;
- local integration event;
- bridging dari domain event ke external broker.

Event Admin tidak cocok untuk:

- durable messaging;
- cross-process guarantee;
- exactly-once delivery;
- large payload transfer;
- long-running processing tanpa queue sendiri;
- workflow orchestration;
- transactional outbox replacement;
- distributed event sourcing.

---

## 5. Topic Model

Event Admin menggunakan **topic** sebagai string hierarkis. Pattern umum:

```text
com/company/domain/entity/action
```

Contoh:

```text
com/acme/case/created
com/acme/case/statusChanged
com/acme/compliance/ruleViolated
com/acme/document/generated
com/acme/connector/unavailable
```

Topic sebaiknya:

- stabil;
- meaningful;
- tidak terlalu teknis;
- tidak memuat data sensitif;
- tidak terlalu granular sampai handler meledak;
- tidak terlalu umum sampai semua handler perlu filter manual.

Anti-pattern:

```text
caseEvent
update
notification
x/y/z/tmp
com/acme/internal/impl/SomeClassChanged
```

Topic adalah bagian dari contract. Perlakukan seperti API.

---

## 6. Event Object dan Properties

Event Admin event biasanya berupa:

```java
Event event = new Event("com/acme/case/statusChanged", properties);
eventAdmin.postEvent(event);
```

Properties adalah map key-value.

Contoh:

```java
Map<String, Object> props = new HashMap<>();
props.put("caseId", caseId);
props.put("oldStatus", oldStatus);
props.put("newStatus", newStatus);
props.put("changedBy", userId);
props.put("changedAt", Instant.now().toString());
props.put("schemaVersion", "1.0.0");

Event event = new Event("com/acme/case/statusChanged", props);
eventAdmin.postEvent(event);
```

Untuk OSGi platform serius, jangan asal memasukkan object domain mutable sebagai property.

Lebih aman:

- gunakan primitive/string/immutable value;
- gunakan DTO stabil;
- hindari entity JPA;
- hindari service object;
- hindari object dari implementation package;
- hindari class yang hanya visible pada producer bundle;
- hindari payload besar.

Karena OSGi classloading per-bundle, object yang terlihat aman di producer bisa tidak visible bagi consumer.

---

## 7. `sendEvent` vs `postEvent`

Event Admin biasanya membedakan dua mode:

```text
sendEvent  = synchronous delivery
postEvent  = asynchronous delivery
```

### 7.1 `sendEvent`

`sendEvent` mengirim event secara synchronous. Publisher thread akan melakukan delivery ke handler sebelum call kembali.

Kelebihan:

- deterministik;
- mudah dites;
- caller tahu semua handler sudah dipanggil saat method selesai;
- cocok untuk event kecil internal yang harus selesai sebelum lanjut.

Risiko:

- handler lambat menahan publisher;
- handler error bisa memengaruhi path eksekusi;
- deadlock jika handler memanggil balik dependency yang salah;
- transaction boundary menjadi ambigu;
- event storm bisa menghentikan thread penting.

### 7.2 `postEvent`

`postEvent` mengirim event secara asynchronous. Publisher tidak menunggu handler selesai.

Kelebihan:

- tidak menahan publisher;
- cocok untuk notification;
- lebih resilient terhadap handler lambat;
- mengurangi coupling temporal.

Risiko:

- ordering lebih sulit;
- failure handler tidak langsung terlihat;
- queue bisa penuh;
- backpressure perlu dipikirkan;
- event bisa diproses setelah state berubah lagi;
- debugging lebih sulit.

Rule praktis:

```text
Jika event adalah side-effect optional, gunakan postEvent.
Jika event adalah bagian dari invariant synchronous, pertimbangkan ulang: mungkin direct service call lebih tepat.
```

---

## 8. Event Handler sebagai Service

Handler Event Admin biasanya mendaftarkan service `EventHandler` dengan property topic.

Contoh Declarative Services:

```java
@Component(
    service = EventHandler.class,
    property = EventConstants.EVENT_TOPIC + "=com/acme/case/statusChanged"
)
public class CaseStatusChangedAuditHandler implements EventHandler {

    @Override
    public void handleEvent(Event event) {
        String caseId = (String) event.getProperty("caseId");
        String oldStatus = (String) event.getProperty("oldStatus");
        String newStatus = (String) event.getProperty("newStatus");

        // Write audit entry or trigger local cache update
    }
}
```

Multi-topic:

```java
@Component(
    service = EventHandler.class,
    property = {
        EventConstants.EVENT_TOPIC + "=com/acme/case/created",
        EventConstants.EVENT_TOPIC + "=com/acme/case/statusChanged"
    }
)
public class CaseEventHandler implements EventHandler {
    @Override
    public void handleEvent(Event event) {
        switch (event.getTopic()) {
            case "com/acme/case/created" -> handleCreated(event);
            case "com/acme/case/statusChanged" -> handleStatusChanged(event);
            default -> throw new IllegalArgumentException("Unsupported topic: " + event.getTopic());
        }
    }
}
```

Wildcard topic biasanya tersedia dengan format hierarkis tertentu tergantung spec/runtime behavior. Namun untuk sistem serius, eksplisit lebih baik daripada handler global yang menerima terlalu banyak topic.

---

## 9. Event Handler Lifecycle Dynamics

Karena handler adalah service, handler bisa:

- belum ada saat event dikirim;
- muncul setelah event dikirim;
- hilang saat event sedang antre;
- berhenti karena bundle update;
- tidak aktif karena config missing;
- berubah ranking/properties.

Ini berarti Event Admin adalah dynamic pub/sub. Jangan desain seolah semua subscriber selalu ada.

Pertanyaan desain:

```text
Jika handler belum ada, apakah event boleh hilang?
```

Jika jawabannya “tidak”, Event Admin bukan mekanisme utama. Gunakan durable store/broker/outbox.

---

## 10. Event Admin Delivery Semantics

Secara arsitektur, treat Event Admin sebagai:

```text
best-effort in-process notification
```

Jangan menganggap:

- durable;
- persistent;
- exactly-once;
- ordered global;
- transactional;
- replayable;
- cross-JVM;
- guaranteed across framework restart.

Untuk event bisnis kritikal:

```text
1. Commit state durable.
2. Commit outbox/event log durable.
3. Publish asynchronously to Event Admin or external broker.
4. Handler idempotent.
```

---

## 11. Direct Service Call vs Event

Kesalahan desain umum:

```java
// Bad: menggunakan event untuk operasi yang sebenarnya command wajib.
eventAdmin.postEvent(new Event("case/validate", props));
```

Jika caller membutuhkan validation result, gunakan service:

```java
public interface CaseValidationService {
    ValidationResult validate(CaseDraft draft);
}
```

Event cocok untuk notification setelah fakta terjadi:

```java
caseRepository.save(caseEntity);
eventAdmin.postEvent(new Event("com/acme/case/created", props));
```

Bedakan:

```text
Command: please do something.
Event: something happened.
Query: please return information.
```

Event Admin lebih natural untuk event, bukan command/query.

---

## 12. Domain Event vs Integration Event vs Runtime Event

Jangan campur semua event dalam satu model.

### 12.1 Domain Event

Merepresentasikan fakta dalam domain:

```text
CaseSubmitted
PenaltyCalculated
AppealApproved
InspectionScheduled
```

Ciri:

- bermakna bisnis;
- bagian dari domain model;
- sering perlu audit;
- mungkin perlu durability;
- mungkin perlu replay.

### 12.2 Integration Event

Merepresentasikan pesan yang dikirim ke sistem lain:

```text
CaseSubmittedForExternalAgency
EmailNotificationRequested
DocumentIndexingRequested
```

Ciri:

- schema lebih stabil;
- backward compatibility penting;
- payload disesuaikan consumer eksternal;
- biasanya melewati broker/API.

### 12.3 Runtime Event

Merepresentasikan perubahan runtime:

```text
bundle started
service registered
config changed
connector degraded
```

Ciri:

- teknis;
- observability;
- operational automation;
- tidak selalu punya makna bisnis.

OSGi Event Admin sering paling cocok untuk runtime event dan local integration event. Domain event kritikal sebaiknya punya durable model sendiri.

---

## 13. Transaction Boundary: Event Setelah Commit atau Sebelum Commit?

Ini salah satu failure mode paling mahal.

Contoh buruk:

```java
@Transactional
public void submitCase(CaseDraft draft) {
    CaseEntity entity = repository.save(draft);

    eventAdmin.postEvent(caseSubmitted(entity.getId()));

    // kemudian transaction rollback karena error lain
    auditService.writeSomethingThatFails();
}
```

Consumer menerima `CaseSubmitted`, tetapi database rollback. Event menyatakan sesuatu terjadi padahal tidak terjadi.

Prinsip:

```text
Event yang menyatakan fakta durable harus dipublish setelah commit durable.
```

Pilihan desain:

1. **After-commit hook** jika runtime transaction mendukung.
2. **Transactional outbox**.
3. **Persist event bersama aggregate**, lalu dispatcher publish.
4. **Event Admin hanya digunakan setelah state visible.**

Untuk OSGi, Transaction Control/JPA integration perlu dipahami bersama lifecycle handler. Jangan membuat handler event membaca entity yang belum commit.

---

## 14. Transactional Outbox di OSGi

Transactional outbox pattern:

```text
Business transaction:
  - update domain table
  - insert outbox row
commit

Dispatcher:
  - read pending outbox rows
  - publish to Event Admin/external broker
  - mark as sent or retry
```

Dalam OSGi:

```text
+----------------------+       +------------------------+
| case-domain bundle   |       | outbox-dispatch bundle |
+----------------------+       +------------------------+
| CaseService          |       | OutboxDispatcher       |
| CaseRepository       |       | EventAdminPublisher    |
| OutboxWriter service | ----> | BrokerBridge service   |
+----------------------+       +------------------------+
```

Keuntungan:

- event tidak hilang saat runtime restart;
- retry bisa dilakukan;
- audit lebih mudah;
- external broker downtime tidak menggagalkan domain transaction;
- handler idempotency bisa dibangun.

Kekurangan:

- lebih kompleks;
- butuh cleanup;
- perlu ordering strategy;
- perlu dead letter;
- perlu schema versioning.

Untuk domain regulatory/case management, outbox biasanya lebih defensible daripada event in-memory murni.

---

## 15. Idempotency

Dalam semua sistem event-driven serius, handler harus diasumsikan bisa menerima event lebih dari sekali.

Penyebab duplicate:

- retry dispatcher;
- external broker redelivery;
- handler crash setelah side effect tapi sebelum ack;
- manual replay;
- rolling restart;
- race dalam bridge;
- outbox mark-sent gagal.

Gunakan event id:

```java
props.put("eventId", UUID.randomUUID().toString());
props.put("eventType", "CaseStatusChanged");
props.put("schemaVersion", "1.0.0");
props.put("occurredAt", Instant.now().toString());
```

Handler menyimpan processed event:

```text
processed_event(event_id, handler_name, processed_at)
```

Pseudo-flow:

```text
handle(event):
  if alreadyProcessed(event.id, thisHandler):
      return

  perform side effect
  markProcessed(event.id, thisHandler)
```

Untuk side-effect seperti email, document generation, external API call, idempotency key harus ikut ke downstream bila memungkinkan.

---

## 16. Ordering

Event ordering sering disalahpahami.

Ada beberapa jenis ordering:

| Ordering | Makna |
|---|---|
| Per producer thread | Event dari thread yang sama dikirim urut |
| Per aggregate | Event untuk `caseId=123` harus diproses urut |
| Global ordering | Semua event sistem diproses urut total |
| Causal ordering | Event akibat event lain tidak boleh mendahului penyebabnya |

Global ordering mahal dan jarang perlu.

Untuk case management, biasanya yang penting:

```text
ordering per aggregate/caseId
```

Contoh:

```text
CaseSubmitted(caseId=123, version=1)
CaseAssigned(caseId=123, version=2)
CaseClosed(caseId=123, version=3)
```

Gunakan sequence/version:

```java
props.put("aggregateId", caseId);
props.put("aggregateVersion", 3L);
```

Handler bisa mendeteksi out-of-order:

```text
if event.version <= lastProcessedVersion:
    ignore duplicate/old
if event.version > lastProcessedVersion + 1:
    delay/retry/load current state
```

Event Admin sendiri tidak seharusnya dijadikan satu-satunya ordering guarantee untuk domain kritikal.

---

## 17. Event Schema Versioning

Event adalah contract. Contract harus versioned.

Minimal metadata:

```text
eventId
correlationId
causationId
eventType
schemaVersion
occurredAt
producer
aggregateType
aggregateId
aggregateVersion
```

Contoh event envelope:

```java
public final class EventEnvelope<T> {
    private final String eventId;
    private final String eventType;
    private final String schemaVersion;
    private final String correlationId;
    private final String causationId;
    private final Instant occurredAt;
    private final String aggregateType;
    private final String aggregateId;
    private final long aggregateVersion;
    private final T payload;
}
```

Tetapi hati-hati: jika envelope class berasal dari package yang tidak visible ke handler, event gagal. Karena itu envelope harus berada di API bundle stabil:

```text
com.acme.platform.events.api
```

Versioning rules:

- tambah field optional: minor version;
- rename field: breaking;
- ubah semantic field: breaking;
- hapus field: breaking;
- ubah type: breaking;
- ubah topic meaning: breaking;
- ubah ordering assumption: breaking;
- ubah idempotency key: breaking.

---

## 18. Payload Design: Jangan Kirim Entity

Anti-pattern:

```java
props.put("case", jpaEntity);
```

Masalah:

- entity class mungkin private ke persistence bundle;
- lazy proxy membawa classloader provider;
- transaction/session sudah closed;
- handler bisa mutate entity;
- payload terlalu besar;
- schema implicit;
- versioning buruk;
- serialization buruk.

Lebih baik:

```java
props.put("caseId", caseId);
props.put("newStatus", "CLOSED");
props.put("changedAt", instant.toString());
```

Atau DTO immutable di API bundle:

```java
public record CaseStatusChangedPayload(
    String caseId,
    String oldStatus,
    String newStatus,
    String changedBy,
    Instant changedAt
) {}
```

Untuk Java 8, gunakan final class biasa karena `record` belum tersedia.

---

## 19. Correlation dan Causation

Dalam modular runtime, event chain cepat menjadi sulit di-debug.

Gunakan:

```text
correlationId = id untuk satu business/request flow
causationId  = event/command/request yang menyebabkan event ini
eventId      = id unik event ini
```

Contoh:

```text
HTTP request submit case
  correlationId = req-abc
  commandId     = cmd-001

CaseSubmitted event
  eventId       = evt-100
  correlationId = req-abc
  causationId   = cmd-001

EmailRequested event
  eventId       = evt-101
  correlationId = req-abc
  causationId   = evt-100
```

Di OSGi, correlation harus melewati:

- direct service call;
- Event Admin event;
- Promise callback;
- external broker message;
- scheduler job;
- logging MDC;
- audit table.

Jangan bergantung pada `ThreadLocal` saja karena async boundary memutus thread.

---

## 20. Event Storm dan Feedback Loop

Event storm terjadi ketika event memicu handler yang memicu event lagi tanpa kendali.

Contoh:

```text
CaseUpdated
  -> SearchIndexHandler updates search index
      -> SearchIndexUpdated
          -> CaseProjectionHandler updates projection
              -> CaseUpdated
                  -> ... loop
```

Mitigasi:

1. Bedakan command/event/projection update.
2. Gunakan causation id untuk mendeteksi loop.
3. Batasi event dari handler tertentu.
4. Gunakan debounce/coalescing untuk event frekuensi tinggi.
5. Gunakan topic yang spesifik.
6. Jangan publish event untuk perubahan internal yang tidak meaningful.
7. Gunakan idempotency dan version guard.
8. Pisahkan domain event dari projection event.

Rule:

```text
Tidak semua state mutation perlu event publik.
```

---

## 21. Backpressure Reality

Event Admin bukan Kafka. Jika producer lebih cepat daripada consumer, sesuatu harus terjadi:

- queue internal tumbuh;
- event dibuang;
- thread tertahan;
- memory naik;
- latency naik;
- runtime menjadi tidak stabil.

Karena itu event design harus punya pressure strategy:

| Scenario | Strategy |
|---|---|
| Cache invalidation high frequency | coalesce/debounce |
| External notification | outbox + worker limit |
| Metrics | sampling/aggregation |
| Audit | write durable directly |
| Long-running handler | enqueue job, return quickly |
| Slow downstream | circuit breaker/backoff |

Handler Event Admin sebaiknya cepat. Untuk pekerjaan berat:

```text
EventHandler receives event
  -> validate metadata
  -> enqueue durable/local work item
  -> return
Worker processes work item separately
```

---

## 22. Long-Running Work: Handler Bukan Worker Abadi

Anti-pattern:

```java
@Override
public void handleEvent(Event event) {
    // calls external API for 5 minutes
    // generates large PDF
    // sends 10,000 emails
}
```

Lebih baik:

```java
@Override
public void handleEvent(Event event) {
    jobQueue.enqueue(toJob(event));
}
```

Kemudian worker service:

```java
@Component
public class NotificationWorker {
    @Activate
    void start() {
        // start controlled executor / scheduler
    }

    @Deactivate
    void stop() {
        // drain or stop gracefully
    }
}
```

Dalam OSGi, worker harus lifecycle-aware:

- stop saat bundle deactivate;
- tidak meninggalkan thread;
- tidak menggunakan stale service reference;
- graceful shutdown;
- tidak menjalankan task setelah config berubah tanpa snapshot valid;
- tidak leak classloader.

---

## 23. Executor Management di OSGi

Jangan membuat executor sembarangan tanpa lifecycle.

Anti-pattern:

```java
private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(10);
```

Masalah:

- static executor menahan classloader bundle;
- thread tidak berhenti saat bundle update;
- stale service object tetap direferensikan;
- memory leak setelah refresh;
- tidak ada observability.

Lebih baik:

```java
@Component
public class WorkerComponent {
    private ExecutorService executor;

    @Activate
    void activate() {
        executor = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "case-worker-");
            t.setDaemon(false);
            return t;
        });
    }

    @Deactivate
    void deactivate() throws InterruptedException {
        executor.shutdown();
        if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
            executor.shutdownNow();
        }
    }
}
```

Untuk production, gunakan wrapper yang:

- expose metrics;
- enforce queue limit;
- enforce rejection policy;
- supports graceful stop;
- captures correlation;
- clears MDC/TCCL;
- reports uncaught exceptions.

---

## 24. Thread Context ClassLoader dalam Async Boundary

Async code sering membawa problem TCCL.

Jika library menggunakan:

```java
Thread.currentThread().getContextClassLoader()
```

maka worker thread yang dibuat oleh bundle bisa punya TCCL yang salah.

Guideline:

1. Set TCCL secara eksplisit saat memanggil library yang butuh discovery.
2. Restore TCCL di finally.
3. Jangan biarkan TCCL bundle tertahan di thread pool global setelah bundle stop.

Pattern:

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
    libraryCall();
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Dalam platform besar, buat utility agar consistent.

---

## 25. OSGi Promise

OSGi Promise adalah abstraction untuk async result.

Mental model:

```text
Promise<T> = hasil masa depan yang bisa success atau fail
```

Mirip `CompletableFuture`, tetapi bagian dari OSGi utility model dan dipakai oleh beberapa service OSGi.

Use case:

- async initialization;
- async connector call;
- composing async service operation;
- avoiding blocking event handler;
- bridging callback API.

Konsep penting:

- `then` / chaining;
- success/failure propagation;
- timeout;
- recovery;
- cancellation consideration;
- executor/thread behavior.

Pseudo-example:

```java
Promise<RemoteResult> promise = remoteConnector.fetchAsync(request);

promise
    .then(result -> process(result))
    .recover(failure -> fallback(failure));
```

Prinsip desain:

```text
Promise cocok untuk async result, bukan broadcast event.
```

Jika satu caller menunggu satu hasil, Promise lebih tepat. Jika banyak consumer mendengar notifikasi, Event Admin lebih tepat.

---

## 26. Java `CompletableFuture` vs OSGi Promise

Di Java 8+, `CompletableFuture` sudah tersedia luas.

Perbandingan:

| Aspek | CompletableFuture | OSGi Promise |
|---|---|---|
| Standard Java | Ya | OSGi utility |
| Familiarity | Tinggi | Lebih niche |
| OSGi integration | Tidak spesifik | Lebih natural di OSGi APIs |
| Ecosystem | Sangat luas | OSGi-centric |
| Composition | Kuat | Cukup |
| Java 8–25 support | Native | Tergantung OSGi util bundle |

Dalam sistem modern, tidak salah memakai `CompletableFuture` jika boundary internal jelas. Tetapi untuk API OSGi-centric yang sudah memakai Promise, jangan buru-buru mengonversi semua tanpa alasan.

Rule:

```text
Gunakan abstraction yang paling natural di boundary tersebut.
```

Jika API OSGi menggunakan Promise, expose Promise. Jika API Java umum digunakan banyak non-OSGi consumer, CompletableFuture bisa lebih praktis.

---

## 27. Push Stream

OSGi Push Stream menyediakan model stream async. Mental model:

```text
PushEventSource -> PushStream -> consumers
```

Cocok untuk:

- event stream in-process;
- monitoring data;
- dynamic feed;
- adapter dari listener callback;
- composition/filter/map/reduce async.

Namun jangan samakan dengan broker stream durable seperti Kafka.

Push Stream bukan:

- durable log;
- replayable event store;
- distributed partitioned topic;
- replacement untuk Kafka;
- audit event store.

Gunakan untuk runtime stream in-process yang lifecycle-aware.

---

## 28. Reactive Bridges

Dalam enterprise runtime, kamu mungkin perlu bridge antara:

- OSGi Event Admin;
- Java `Flow` API;
- Reactive Streams;
- Project Reactor;
- RxJava;
- Akka Streams;
- Kafka consumer;
- RabbitMQ listener;
- WebSocket/SSE stream.

Bridge pattern:

```text
External source
  -> connector bundle
  -> normalize envelope
  -> publish local service/event
  -> domain handler bundle
```

Atau:

```text
Domain event/outbox
  -> broker bridge service
  -> Kafka/RabbitMQ/JMS
```

Jangan biarkan library reactive mendominasi boundary OSGi. Boundary platform sebaiknya tetap:

- typed service;
- event contract;
- capability;
- configuration;
- lifecycle.

Reactive library adalah implementation detail kecuali memang menjadi public API bundle.

---

## 29. External Broker Bridge

Event Admin in-process sering perlu dihubungkan ke external broker.

Arsitektur:

```text
+---------------------+       +------------------+       +----------------+
| Domain Bundle       |       | Outbox Bundle    |       | Broker Bridge  |
+---------------------+       +------------------+       +----------------+
| writes domain state | ----> | durable outbox   | ----> | Kafka/RabbitMQ |
+---------------------+       +------------------+       +----------------+
                                      |
                                      v
                               Event Admin local notification
```

Atau inbound:

```text
Kafka/RabbitMQ/JMS
    |
    v
Broker Consumer Bundle
    |
    +--> validates schema
    +--> maps to command/event
    +--> calls domain service or publishes Event Admin event
```

Important decision:

```text
Inbound external messages should usually become commands to domain services, not blindly become domain events.
```

Karena external message often says:

```text
please process this
```

bukan:

```text
this already happened in your domain
```

---

## 30. Kafka Bridge Design

Kafka cocok untuk:

- durable distributed event log;
- consumer groups;
- replay;
- partitioning;
- high-throughput events;
- integration events.

OSGi bridge design:

```text
com.acme.messaging.kafka.api
  - BrokerPublisher
  - BrokerConsumerRegistration
  - MessageEnvelope

com.acme.messaging.kafka.impl
  - KafkaProducerService
  - KafkaConsumerManager
  - ConfigAdmin-backed Kafka config

com.acme.case.integration.kafka
  - CaseEventKafkaPublisher
  - CaseCommandKafkaConsumer
```

Key concerns:

- Kafka client classloading;
- serializer/deserializer visibility;
- schema registry client;
- config update;
- producer lifecycle;
- consumer rebalance;
- partition ordering;
- idempotent producer;
- transaction support;
- shutdown;
- metrics;
- retry/dead letter;
- schema evolution.

Do not expose raw Kafka classes in domain API unless Kafka is truly part of domain contract.

---

## 31. RabbitMQ Bridge Design

RabbitMQ cocok untuk:

- command queues;
- work queues;
- routing exchange;
- retry/DLX;
- moderate throughput messaging;
- operationally simpler queue workflows.

OSGi bridge concerns:

- connection factory lifecycle;
- channel per thread/task;
- reconnect strategy;
- publisher confirms;
- manual ack;
- prefetch/backpressure;
- DLX/dead letter;
- poison messages;
- topology declaration;
- config update;
- TLS/credential rotation.

Pattern:

```text
RabbitConnectionService
RabbitPublisherService
RabbitConsumerWhiteboard
```

Consumer whiteboard model:

```java
public interface RabbitMessageHandler {
    String queue();
    MessageHandlingResult handle(MessageEnvelope message);
}
```

Handlers register as OSGi services. Consumer manager tracks them and starts/stops queue consumers dynamically.

This is OSGi-native design: broker consumer topology is dynamic but controlled.

---

## 32. JMS Bridge Design

JMS cocok untuk enterprise legacy integration.

Concerns:

- provider bundle wrapping;
- JNDI assumptions;
- connection factory discovery;
- transaction integration;
- XA vs local transaction;
- message listener lifecycle;
- classloading of object messages;
- avoid Java serialization payload;
- durable subscriptions;
- redelivery policy.

Guideline:

```text
Avoid JMS ObjectMessage across OSGi boundaries.
Use text/json/avro/protobuf or stable DTO serialization.
```

Because classloader identity and versioning issues become severe with object serialization.

---

## 33. Message Contract Boundary

For external broker, create a message envelope independent from OSGi runtime:

```json
{
  "messageId": "evt-123",
  "messageType": "CaseStatusChanged",
  "schemaVersion": "1.0.0",
  "correlationId": "corr-456",
  "causationId": "cmd-789",
  "occurredAt": "2026-06-17T10:15:30Z",
  "producer": "case-domain",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-001",
  "aggregateVersion": 7,
  "payload": {
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED"
  }
}
```

This should not leak:

- OSGi bundle symbolic name unless needed;
- Java class name;
- internal package;
- entity type;
- framework version;
- service implementation class.

External contract must survive runtime refactoring.

---

## 34. Whiteboard Pattern for Messaging Handlers

Whiteboard is often better than event bus for plugin-like handlers.

Instead of:

```text
publish event -> all handlers inspect
```

Use service registry:

```java
public interface NotificationChannel {
    String channelType();
    boolean supports(NotificationRequest request);
    NotificationResult send(NotificationRequest request);
}
```

Implementations:

```text
EmailNotificationChannel service
SmsNotificationChannel service
WebhookNotificationChannel service
```

Router tracks services:

```text
NotificationRouter
  -> dynamic list of NotificationChannel
  -> select by metadata/ranking/config
  -> invoke typed service
```

Why better?

- typed result;
- better error handling;
- explicit contract;
- easier testing;
- service dynamics still supported;
- avoids hidden event coupling.

Use Event Admin when producer does not need result. Use whiteboard when producer/router needs controlled invocation.

---

## 35. Scheduler and Time-Driven Events

Many OSGi platforms have scheduled jobs:

- polling external API;
- outbox dispatcher;
- retry worker;
- cleanup job;
- SLA escalation;
- report generation;
- cache refresh.

Scheduler can be implemented with:

- Quartz bundle;
- custom ScheduledExecutorService;
- whiteboard scheduler service;
- Karaf features;
- external orchestrator/Kubernetes CronJob.

OSGi concerns:

- job service appears/disappears;
- config changes schedule;
- bundle stop must cancel job;
- job should not overlap unless allowed;
- stale service references;
- idempotency;
- cluster coordination;
- lock ownership;
- persistent schedule state.

For cluster deployment, in-process scheduler can duplicate work across pods unless guarded by distributed lock or external scheduler.

---

## 36. Cluster Reality

OSGi is in-process. If you run 3 pods/JVMs:

```text
Pod A has EventAdmin
Pod B has EventAdmin
Pod C has EventAdmin
```

Those are separate event buses.

Event Admin event in Pod A does not magically appear in Pod B.

For clustered event propagation, use external system:

- Kafka;
- RabbitMQ;
- JMS;
- database outbox polling;
- Redis pub/sub if loss acceptable;
- HTTP callback;
- distributed event store.

Do not confuse modular runtime with distributed runtime.

---

## 37. Error Handling in Event Handlers

Handler error strategy depends on mechanism.

For in-process notification:

```text
log + metric + maybe local retry
```

For business side effect:

```text
persist failure + retry + DLQ + operational alert
```

For synchronous `sendEvent`:

```text
decide whether handler failure should propagate
```

For `postEvent`:

```text
publisher cannot rely on seeing handler failure
```

Design event handler with explicit error taxonomy:

| Error Type | Example | Strategy |
|---|---|---|
| Validation error | unknown schema version | DLQ / reject |
| Transient external | timeout | retry with backoff |
| Permanent external | invalid recipient | mark failed, no retry |
| Internal bug | NPE | alert + DLQ |
| Dependency unavailable | service missing | retry/degrade |
| Duplicate event | already processed | ignore safely |

---

## 38. Retry Strategy

Retry must be bounded and observable.

Bad retry:

```text
while(true) retry every second
```

Better:

```text
attempt 1: immediate
attempt 2: 30s
attempt 3: 2m
attempt 4: 10m
attempt 5: 1h
then DLQ/manual intervention
```

For OSGi worker, retry metadata should be durable if the side effect matters:

```text
job_id
message_id
handler_name
attempt_count
next_attempt_at
last_error
status
created_at
updated_at
```

Do not keep retry-only in memory for critical workflows.

---

## 39. Dead Letter Queue / Dead Letter Store

DLQ is not just a broker feature. It is an operational contract.

A dead letter record should include:

- message/event id;
- type/topic;
- schema version;
- payload snapshot;
- failure reason;
- stack trace or error code;
- handler/consumer name;
- attempt count;
- first failure time;
- last failure time;
- correlation id;
- replay eligibility;
- operator notes.

For regulatory systems, DLQ should be auditable and replay controlled.

---

## 40. Observability for OSGi Eventing

Minimum metrics:

- events published by topic;
- handler invocation count;
- handler latency;
- handler failure count;
- queue depth;
- dropped events;
- retry count;
- DLQ count;
- broker publish latency;
- broker consume lag;
- outbox pending count;
- oldest outbox age;
- duplicate ignored count;
- dynamic handler count per topic;
- scheduler job duration;
- executor active/queued/rejected.

Logs should include:

```text
correlationId
eventId
topic/messageType
handlerName
bundleSymbolicName
bundleVersion
attempt
aggregateId
aggregateVersion
```

For OSGi diagnostics, also expose:

```text
which bundle registered which handler
which topics are subscribed
which services are required by handler
which config PID controls handler
```

---

## 41. Service Dynamics During Async Processing

Problem:

```text
Worker captures service reference at time T1.
Service is unregistered at T2.
Worker invokes stale object at T3.
```

Mitigation patterns:

### 41.1 Snapshot for Immutable Stateless Service

If service is stateless and deactivate waits for in-flight work, snapshot may be okay.

### 41.2 Lookup Per Task

Resolve service when task executes, not when enqueued.

### 41.3 Reference Guard

Maintain dynamic reference wrapper that refuses calls when service unavailable.

### 41.4 Drain Before Unregister

Provider stops accepting new work, waits for in-flight work, then unregisters.

### 41.5 Durable Job Retry

If service disappears, mark task retryable.

In high-quality OSGi systems, dynamic service disappearance is not exceptional. It is part of runtime model.

---

## 42. Graceful Shutdown

When bundle/runtime stops:

1. stop accepting new inbound messages;
2. pause broker consumers;
3. stop scheduling new jobs;
4. drain in-flight tasks up to timeout;
5. ack/nack broker messages correctly;
6. persist retry state;
7. close producers/consumers;
8. shutdown executors;
9. unregister services;
10. clear TCCL/MDC/thread locals.

Bad shutdown causes:

- duplicate side effects;
- lost messages;
- classloader leak;
- half-processed jobs;
- stuck framework stop;
- stale service references.

---

## 43. Configuration Changes in Async Components

Config can change while worker is running.

Bad model:

```java
volatile int batchSize;
volatile String endpoint;
// worker reads fields at random times
```

Better:

```java
final class WorkerConfigSnapshot {
    final int batchSize;
    final URI endpoint;
    final Duration timeout;
}
```

On config update:

```text
1. validate new config
2. create immutable config snapshot
3. atomically swap snapshot
4. decide whether existing in-flight work uses old or new config
5. log/audit config version
```

For broker consumers, config change may require:

- pause consumer;
- close connection;
- recreate with new config;
- resume;
- avoid duplicate consumers.

---

## 44. Security and Authorization in Eventing

Questions:

- Who is allowed to publish this event?
- Who is allowed to subscribe?
- Does event contain PII/secrets?
- Can low-trust plugin observe sensitive event?
- Can plugin publish fake domain event?
- Is event authenticated if inbound from broker?
- Is payload signed/verifiable?
- Is replay protected?

OSGi service registry can restrict via permissions in some environments, but modern Java Security Manager reality limits sandboxing. Design at architecture level:

- separate sensitive topics;
- expose restricted API service instead of broad event;
- sanitize payload;
- use trusted bridge bundles;
- validate inbound messages;
- include producer identity;
- audit event publication for sensitive actions;
- avoid broadcasting secrets.

---

## 45. Event Admin vs Framework Listeners

OSGi framework itself has listeners:

- `BundleListener`
- `ServiceListener`
- `FrameworkListener`

These are not the same as Event Admin domain events.

Use framework listeners for runtime infrastructure concerns:

- monitoring bundle lifecycle;
- custom extender;
- diagnostics;
- lifecycle automation;
- service tracking internals.

Use Event Admin for app-level notification when you want decoupled topic-based distribution.

Do not expose raw framework events as business events without translation.

---

## 46. Custom Extender with Eventing

An extender often listens for bundles/resources and publishes services/events.

Example:

```text
Rule Bundle installed
  -> RuleExtender scans metadata
  -> registers RuleProvider service
  -> publishes rule/catalog/changed event
```

Pitfalls:

- publishing event before service is fully registered;
- event topic too broad;
- repeated event during refresh;
- stale metadata after bundle update;
- handler expecting old service still valid;
- recursion between extender and handler.

Ordering invariant:

```text
If event says capability is available, service/capability must already be visible.
```

If event says capability is removed, decide whether event happens before or after unregister and document it.

---

## 47. Case Study: Dynamic Enforcement Rule Events

Imagine enforcement lifecycle platform:

- cases move through states;
- rules validate transitions;
- plugins add agency-specific checks;
- notifications sent after milestones;
- audit required;
- external systems need integration events.

### 47.1 Bad Design

```text
CaseService publishes EventAdmin event "caseChanged"
All plugins listen
Some validate
Some notify
Some call external API
Some write DB
Some throw exception
No event id
No ordering
No outbox
No schema
```

Failure:

- validation runs after state already changed;
- notification sent for rolled-back case;
- external API called twice;
- plugin failure hidden;
- handler ordering nondeterministic;
- audit incomplete;
- event cannot be replayed.

### 47.2 Better Design

```text
Command phase:
  CaseTransitionService.transition(caseId, targetState)
    -> calls RuleProvider services synchronously
    -> validates authorization
    -> writes case state
    -> writes domain_event table
    -> writes outbox row
    -> commit

After commit:
  OutboxDispatcher publishes local EventAdmin notification
  BrokerBridge publishes integration event to Kafka/RabbitMQ

Handlers:
  AuditProjectionHandler updates read model idempotently
  NotificationHandler enqueues notification job
  ExternalSyncHandler uses durable retry
```

Rule plugins are services, not Event Admin handlers, because transition validation is synchronous and mandatory.

Notifications are async because they are side effects after fact.

Integration uses durable outbox because external system reliability matters.

---

## 48. Case Study Code Sketch

API bundle:

```java
package com.acme.case.api;

public interface CaseTransitionValidator {
    ValidationResult validate(CaseTransitionRequest request);
}
```

Domain service:

```java
@Component(service = CaseTransitionService.class)
public class DefaultCaseTransitionService implements CaseTransitionService {

    @Reference(cardinality = ReferenceCardinality.MULTIPLE,
               policy = ReferencePolicy.DYNAMIC)
    volatile List<CaseTransitionValidator> validators;

    @Reference
    CaseRepository caseRepository;

    @Reference
    OutboxWriter outboxWriter;

    @Override
    public TransitionResult transition(CaseTransitionRequest request) {
        List<CaseTransitionValidator> snapshot = List.copyOf(validators);

        for (CaseTransitionValidator validator : snapshot) {
            ValidationResult result = validator.validate(request);
            if (!result.isValid()) {
                return TransitionResult.rejected(result);
            }
        }

        CaseStateChange change = caseRepository.applyTransition(request);

        outboxWriter.write(EventEnvelope.of(
            "CaseStatusChanged",
            "1.0.0",
            change.caseId(),
            change.version(),
            change.toPayload()
        ));

        return TransitionResult.accepted(change);
    }
}
```

Outbox dispatcher:

```java
@Component
public class OutboxDispatcher {

    @Reference
    EventAdmin eventAdmin;

    @Reference
    BrokerPublisher brokerPublisher;

    @Reference
    OutboxRepository outboxRepository;

    void dispatchBatch() {
        List<OutboxRecord> records = outboxRepository.fetchPending(100);

        for (OutboxRecord record : records) {
            try {
                Event event = toOsgiEvent(record);
                eventAdmin.postEvent(event);

                brokerPublisher.publish(record.toMessage());

                outboxRepository.markSent(record.id());
            } catch (TransientException ex) {
                outboxRepository.scheduleRetry(record.id(), ex);
            } catch (PermanentException ex) {
                outboxRepository.markDead(record.id(), ex);
            }
        }
    }
}
```

This separates:

- synchronous rule validation;
- durable domain mutation;
- local async notification;
- external durable integration.

---

## 49. Java 8–25 Considerations

### Java 8

- `CompletableFuture` available.
- No records, no virtual threads.
- Many legacy OSGi stacks target Java 8.
- javax ecosystem still common.

### Java 9–16

- JPMS strong encapsulation begins affecting reflective libraries.
- `Flow` API introduced in Java 9.
- Some reactive bridges may use `java.util.concurrent.Flow`.

### Java 17

- Common modern baseline.
- Strong encapsulation more painful for old libraries.
- Security Manager deprecation affects sandbox assumptions.

### Java 21

- Virtual threads become important for async strategy.
- Structured concurrency preview exists.
- Virtual threads can reduce need for callback-heavy code but do not remove messaging semantics.

### Java 25

- Treat as modern JDK target requiring library compatibility checks.
- Old bytecode manipulation, old JMS/JPA/JSON libraries may break.
- Strong encapsulation and removed/deprecated legacy mechanisms matter.

Virtual threads note:

```text
Virtual threads improve blocking scalability, but they do not provide durability, ordering, replay, idempotency, or cross-process messaging.
```

Do not replace broker/outbox semantics with virtual threads.

---

## 50. Virtual Threads in OSGi Async Runtime

Virtual threads can simplify worker code:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

Potential benefits:

- simpler blocking style;
- less callback nesting;
- high concurrency for IO-bound tasks;
- easier request/response async code.

OSGi-specific concerns:

- executor lifecycle still matters;
- TCCL still matters;
- service reference dynamics still matter;
- thread-local cleanup still matters;
- bundle stop must still cancel/drain tasks;
- library compatibility still matters;
- broker client threading model may not benefit.

Virtual threads solve thread cost, not distributed correctness.

---

## 51. Anti-Patterns

### 51.1 Event Bus as Hidden Monolith

Everything publishes to generic topic. Everything listens. Nobody owns contract.

Symptom:

```text
Changing one event breaks five bundles unexpectedly.
```

### 51.2 Command Disguised as Event

```text
"sendEmail" event
"validateCase" event
"generateReport" event
```

These are commands. Use service/job/message command contract.

### 51.3 Entity Payload

JPA entity/proxy sent through event.

### 51.4 No Event ID

No idempotency possible.

### 51.5 No Schema Version

Consumer cannot evolve safely.

### 51.6 Long Handler

Event handler does heavy blocking work.

### 51.7 Static Executor

Thread/classloader leak after bundle update.

### 51.8 Event Before Commit

Consumer observes state that later rolls back.

### 51.9 Local Event for Cluster Need

Using Event Admin to communicate across pods/JVMs.

### 51.10 Optional Handler for Mandatory Invariant

Business invariant enforced by event subscriber that might not be active.

---

## 52. Troubleshooting Playbook

### Problem: Event Not Received

Check:

1. Is Event Admin service active?
2. Is handler service registered?
3. Is handler topic property correct?
4. Is topic string exact?
5. Is component satisfied in SCR?
6. Is handler bundle ACTIVE?
7. Is handler filtered by configuration?
8. Is event sent before handler registration?
9. Is event async queue failing?
10. Is payload causing exception before visible log?

### Problem: Duplicate Processing

Check:

1. Is dispatcher retrying?
2. Did ack/mark-sent fail?
3. Are multiple runtime instances active?
4. Are multiple handlers registered accidentally?
5. Is feature deployed twice?
6. Is event replay running?
7. Is service ranking causing multiple invocation?

### Problem: Handler Sees Old State

Check:

1. Was event published before commit?
2. Is handler reading stale projection/cache?
3. Is aggregate version included?
4. Is async event processed after newer update?
5. Is transaction isolation causing visibility delay?

### Problem: Runtime Memory Leak After Bundle Update

Check:

1. Executor not shutdown?
2. Thread TCCL points to old bundle classloader?
3. Static collection holds event payload class?
4. Broker consumer thread still running?
5. Scheduler job still references old service?
6. Event handler not unregistered?

### Problem: Event Storm

Check:

1. Are handlers publishing events recursively?
2. Is causation id tracked?
3. Is topic too broad?
4. Is projection update generating domain event?
5. Is retry loop immediate?
6. Is config update causing repeated reactivation?

---

## 53. Design Review Checklist

Before approving OSGi event/messaging design, ask:

### Contract

- Is this command, event, or query?
- Is topic/type stable?
- Is schema versioned?
- Is payload immutable/stable?
- Are internal implementation classes hidden?

### Delivery

- Can event be lost?
- Can event be duplicated?
- Is ordering required?
- Is durability required?
- Is replay required?
- Is cross-JVM delivery required?

### Runtime Dynamics

- What if handler is absent?
- What if handler disappears mid-processing?
- What if config changes?
- What if bundle updates?
- What if broker disconnects?

### Failure

- What is retry policy?
- What goes to DLQ?
- What alerts operator?
- Is handler idempotent?
- Is side effect reversible?

### Performance

- Could producer overwhelm consumer?
- Is handler quick?
- Are queues bounded?
- Is backpressure defined?
- Is event storm possible?

### Operations

- Are metrics exposed?
- Are correlation IDs propagated?
- Can we list subscribers per topic?
- Can we replay failed messages?
- Can we safely shutdown?

### Security

- Is event sensitive?
- Who can publish?
- Who can subscribe?
- Is inbound broker message authenticated/validated?
- Is payload sanitized?

---

## 54. Practical Architecture Heuristics

Use these heuristics:

1. Use **direct service call** for mandatory synchronous collaboration.
2. Use **whiteboard service pattern** for dynamic plugin handlers that return result.
3. Use **Event Admin** for local in-process notification where loss is acceptable or separately mitigated.
4. Use **outbox** for durable domain/integration events.
5. Use **external broker** for cross-process delivery, retry, replay, and durable integration.
6. Use **Promise/CompletableFuture** for one async result.
7. Use **Push Stream/reactive bridge** for in-process stream composition.
8. Use **scheduler/job model** for time-driven retry or batch work.
9. Keep event payload stable, small, immutable, and versioned.
10. Make every important handler idempotent.

---

## 55. What Top 1% Engineers Understand About OSGi Eventing

They understand that OSGi eventing is not about making everything asynchronous. It is about choosing the correct coupling model.

They do not blindly chase “loose coupling”. They distinguish:

```text
spatial coupling  = who knows whom
temporal coupling = must both exist at same time
semantic coupling = does producer depend on consumer meaning
failure coupling  = does consumer failure break producer
transaction coupling = same commit boundary or not
operational coupling = can we observe/retry/recover independently
```

Event Admin reduces spatial coupling but can hide semantic and operational coupling. External brokers reduce temporal coupling but introduce distributed-system complexity. Service calls preserve explicitness but couple availability.

Good platform design makes these couplings visible.

---

## 56. Summary

Part ini membangun mental model untuk messaging dan async runtime di OSGi:

- Event Admin adalah in-process pub/sub, bukan durable broker.
- `sendEvent` synchronous, `postEvent` asynchronous.
- Event handler adalah dynamic OSGi service.
- Handler bisa muncul/hilang saat runtime berjalan.
- Domain event, integration event, runtime event harus dibedakan.
- Event yang menyatakan fakta durable harus publish setelah commit atau via outbox.
- Idempotency, ordering, schema versioning, correlation, retry, DLQ, dan observability adalah bagian dari desain, bukan tambahan belakangan.
- Direct service call, whiteboard service, Event Admin, Promise, Push Stream, scheduler, dan external broker punya tempat masing-masing.
- Async code di OSGi harus lifecycle-aware agar tidak leak classloader, stale reference, atau thread.
- Java 8–25 menambah opsi seperti `CompletableFuture`, `Flow`, dan virtual threads, tetapi tidak menghapus kebutuhan durability, ordering, dan failure modeling.

Mental model akhirnya:

```text
OSGi gives dynamic in-process composition.
Messaging gives decoupled communication.
Durability gives recoverability.
Versioned contracts give evolvability.
Observability gives operability.

Do not confuse them.
```

---

## 57. Latihan

### Latihan 1 — Mechanism Selection

Untuk setiap scenario, pilih direct service, whiteboard, Event Admin, Promise, Push Stream, scheduler, atau external broker:

1. Validate case transition before state changes.
2. Notify UI projection after case state committed.
3. Send email after case approved.
4. Publish integration event to another agency.
5. Track bundle start/stop for diagnostics.
6. Stream runtime metrics to local dashboard.
7. Retry failed document generation every 10 minutes.
8. Dynamically discover notification channel plugins.

Jelaskan alasan dan failure semantics masing-masing.

### Latihan 2 — Event Contract Design

Desain event contract untuk:

```text
CaseStatusChanged
```

Harus mencakup:

- topic/message type;
- schema version;
- event id;
- correlation id;
- causation id;
- aggregate id;
- aggregate version;
- payload;
- compatibility strategy.

### Latihan 3 — Outbox Design

Buat desain outbox table untuk OSGi case management platform:

- fields;
- status model;
- retry model;
- DLQ model;
- dispatcher lifecycle;
- duplicate prevention;
- metrics.

### Latihan 4 — Troubleshooting

Sebuah handler `EmailNotificationHandler` kadang mengirim email dua kali setelah deploy ulang bundle. Susun investigasi:

- service registration;
- duplicate bundle;
- retry state;
- ack/mark-sent;
- executor shutdown;
- idempotency key;
- correlation log.

---

## 58. Preview Part 18

Part berikutnya akan membahas:

```text
Security Model: Permissions, Conditional Permission Admin, Signing, and Sandboxing Reality
```

Kita akan masuk ke security layer OSGi: permission model, bundle trust, service/package/admin permissions, conditional permission admin, signing, plugin security, Java Security Manager reality, post-Java-17 implications, dan batas nyata sandboxing OSGi modern.

---

## Status Series

```text
Part 17 dari 35 selesai.
Series belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 16 — Persistence in OSGi: JDBC, JPA, Transactions, Hibernate, EclipseLink](./16-persistence-osgi-jdbc-jpa-transactions-hibernate-eclipselink.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 18 — Security Model: Permissions, Conditional Permission Admin, Signing, and Sandboxing Reality](./18-security-model-permissions-conditional-permission-admin-signing-sandboxing-reality.md)

</div>