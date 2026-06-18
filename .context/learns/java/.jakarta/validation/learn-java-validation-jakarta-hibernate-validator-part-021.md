# learn-java-validation-jakarta-hibernate-validator-part-021

# Validation in Event-Driven and Async Systems

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `021`  
> Topik: Java Validation, Jakarta Validation, Hibernate Validator, event-driven architecture, asynchronous processing, messaging, schema validation, DLQ, event versioning, and auditability  
> Target Java: 8 hingga 25  
> Namespace: `javax.validation` untuk legacy Java EE/Spring Boot 2 era, `jakarta.validation` untuk Jakarta EE/Spring Boot 3+ era

---

## 1. Tujuan Part Ini

Di part sebelumnya, kita membahas validasi di persistence layer: JPA lifecycle, Hibernate ORM, dan database constraints. Sekarang kita pindah ke boundary yang lebih berbahaya dalam sistem modern: **event-driven dan asynchronous systems**.

Di REST API, invalid request biasanya langsung dibalas ke caller. Di event-driven system, invalid payload sering tidak punya caller yang sedang menunggu response. Akibatnya, failure handling menjadi lebih kompleks:

- event bisa sudah dipublish ke broker,
- producer mungkin sudah commit transaksi,
- consumer mungkin memproses event beberapa menit atau jam kemudian,
- retry bisa memperparah masalah,
- poison message bisa menghambat partition/queue,
- event lama bisa tiba setelah schema berubah,
- invalid event bisa harus diaudit, bukan sekadar dibuang,
- consumer tidak selalu bisa mengembalikan error ke producer.

Karena itu, validation di async system bukan hanya “panggil `validator.validate(event)`”. Ia adalah desain **contract, compatibility, failure classification, operational recovery, and auditability**.

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan validation pada command, event, message envelope, payload, dan domain effect.
2. Menentukan kapan memakai Jakarta Validation, JSON Schema, Avro/Protobuf schema, database constraint, atau domain policy.
3. Mendesain consumer yang tahan terhadap invalid, stale, duplicate, unsupported, dan partially compatible events.
4. Mengklasifikasikan failure menjadi retryable/non-retryable secara defensible.
5. Mendesain DLQ/rejection model yang dapat diaudit.
6. Menghindari anti-pattern umum seperti “throw exception and retry forever”.
7. Menjaga backward/forward compatibility ketika event schema berevolusi.
8. Membuat validation strategy untuk Java 8 legacy hingga Java 21/25 modern codebase.

---

## 2. Mental Model: Event Validation Bukan Sama dengan Request Validation

REST request validation biasanya berbentuk:

```text
client -> API -> validate request -> reject immediately or process
```

Event-driven validation berbentuk:

```text
producer -> broker -> consumer -> validate message -> process / reject / retry / quarantine
```

Perbedaannya besar.

### 2.1 REST Validation

REST validation biasanya punya karakteristik:

- caller sedang menunggu response,
- error bisa dikembalikan dalam HTTP response,
- correlation relatif mudah,
- request biasanya diproses sekali,
- schema mismatch cepat terlihat,
- invalid input biasanya tanggung jawab caller.

### 2.2 Event Validation

Event validation punya karakteristik:

- producer dan consumer decoupled,
- error mungkin baru muncul setelah producer selesai,
- event bisa diretry berkali-kali,
- event bisa dikirim ulang,
- event bisa out-of-order,
- event bisa berasal dari versi producer lama,
- consumer harus membedakan invalid permanen vs gagal sementara,
- rejection harus bisa diobservasi dan, sering kali, diaudit.

### 2.3 Kesimpulan Mental Model

Dalam async system, validation harus menjawab minimal lima pertanyaan:

1. **Can I understand this message?**  
   Apakah envelope, encoding, schema version, dan payload bisa diparse?

2. **Is this message structurally valid?**  
   Apakah field required, type, format, size, dan container element benar?

3. **Is this message semantically meaningful?**  
   Apakah nilai field masuk akal dalam domain?

4. **Can I apply this message now?**  
   Apakah referensi tersedia, aggregate ada, state memungkinkan, dan event tidak stale?

5. **What should I do if I cannot apply it?**  
   Retry, skip, DLQ, quarantine, compensate, alert, atau create manual task?

Jakarta Validation terutama membantu pada pertanyaan nomor 2 dan sebagian nomor 3. Ia bukan solusi lengkap untuk semua pertanyaan.

---

## 3. Layer Validation dalam Event-Driven System

Dalam sistem event-driven, setidaknya ada beberapa layer yang berbeda.

```text
┌────────────────────────────────────────────────────────────┐
│ Broker message                                              │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Envelope / headers                                      │ │
│ │ - messageId                                             │ │
│ │ - eventType                                             │ │
│ │ - source                                                │ │
│ │ - timestamp                                             │ │
│ │ - schemaVersion                                         │ │
│ │ - correlationId                                         │ │
│ │ - causationId                                           │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Payload                                                 │ │
│ │ - business fields                                       │ │
│ │ - nested object                                         │ │
│ │ - collection                                            │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

Validation dapat terjadi di beberapa titik:

| Layer | Contoh | Cocok dengan |
|---|---|---|
| Transport validation | message size, encoding, content type | broker/client config |
| Envelope validation | `eventId`, `eventType`, `source`, `schemaVersion` | manual validation, schema, Jakarta Validation |
| Schema validation | JSON/Avro/Protobuf compatibility | schema registry, JSON Schema, Avro/Protobuf tooling |
| Payload object validation | `@NotNull`, `@Size`, `@Valid`, container constraints | Jakarta Validation/Hibernate Validator |
| Domain semantic validation | status transition, ownership, duplicate business key | domain policy/service |
| Persistence consistency | unique, FK, check constraint | database |
| Operational validation | retryability, idempotency, ordering | consumer framework/policy |

Kesalahan umum adalah memakai satu alat untuk semua layer.

---

## 4. Event vs Command vs Notification

Sebelum mendesain validation, bedakan jenis message.

### 4.1 Command Message

Command adalah permintaan agar sesuatu dilakukan.

Contoh:

```text
SubmitApplicationCommand
ApproveCaseCommand
GenerateInvoiceCommand
```

Karakteristik:

- bersifat imperative,
- biasanya punya target handler,
- caller mengharapkan action terjadi,
- bisa divalidasi seperti API request,
- failure sering harus dikembalikan ke caller atau workflow.

Validation command bisa ketat karena command merepresentasikan intent baru.

### 4.2 Domain Event

Domain event adalah fakta bahwa sesuatu sudah terjadi.

Contoh:

```text
ApplicationSubmitted
CaseAssigned
InvoiceGenerated
LicenceSuspended
```

Karakteristik:

- bersifat factual,
- seharusnya immutable,
- producer menyatakan “ini sudah terjadi”,
- consumer tidak boleh memperlakukan invalid event sama seperti invalid command,
- rejection berarti ada kontrak producer-consumer yang rusak atau consumer tidak kompatibel.

Validation event harus berhati-hati. Jika event adalah fakta historis, consumer tidak boleh “meminta user memperbaiki request” begitu saja.

### 4.3 Notification/Event Integration Message

Notification/integration event adalah pesan antar bounded context atau sistem eksternal.

Contoh:

```text
PaymentCompletedIntegrationEvent
ExternalAgencyLicenceStatusChanged
DocumentUploadedNotification
```

Karakteristik:

- bisa berasal dari sistem lain,
- schema compatibility penting,
- contract lebih stabil,
- versioning harus eksplisit,
- invalid message sering perlu quarantine/audit.

### 4.4 Kenapa Perbedaan Ini Penting

Constraint yang benar untuk command belum tentu benar untuk event.

Contoh command:

```java
public record SubmitApplicationCommand(
        @NotBlank String applicantName,
        @NotBlank String postalCode,
        @NotNull ApplicationType type
) {}
```

Untuk command, `applicantName` wajib karena user sedang submit.

Event historis mungkin berbeda:

```java
public record ApplicationMigratedEvent(
        @NotBlank String applicationId,
        String applicantName,
        @NotBlank String sourceSystem,
        @NotNull Instant migratedAt
) {}
```

Legacy migration event bisa punya `applicantName = null` karena data lama tidak lengkap. Jika consumer memaksa `@NotBlank`, event historis akan gagal terus dan masuk DLQ, padahal strategi yang benar mungkin adalah enrichment, warning, atau partial processing.

---

## 5. Jakarta Validation pada Event Payload

Jakarta Validation tetap sangat berguna untuk payload object.

Contoh event DTO:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

public record ApplicationSubmittedEvent(
        @NotBlank
        String eventId,

        @NotBlank
        String applicationId,

        @NotBlank
        String applicantId,

        @NotNull
        Instant submittedAt,

        @Size(max = 50)
        List<@NotBlank String> declaredBusinessActivities,

        @Valid
        @NotNull
        ApplicantSnapshot applicant
) {}

public record ApplicantSnapshot(
        @NotBlank
        String name,

        @NotBlank
        String identifier,

        @NotBlank
        String email
) {}
```

Consumer validation:

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;

import java.util.Set;

public final class EventPayloadValidator {
    private final Validator validator;

    public EventPayloadValidator(Validator validator) {
        this.validator = validator;
    }

    public <T> ValidationOutcome validate(T event) {
        Set<ConstraintViolation<T>> violations = validator.validate(event);

        if (violations.isEmpty()) {
            return ValidationOutcome.valid();
        }

        return ValidationOutcome.invalid(
                violations.stream()
                        .map(ViolationView::from)
                        .toList()
        );
    }
}
```

Untuk Java 8:

```java
public final class ApplicationSubmittedEvent {
    @NotBlank
    private final String eventId;

    @NotBlank
    private final String applicationId;

    @NotBlank
    private final String applicantId;

    @NotNull
    private final Instant submittedAt;

    @Size(max = 50)
    private final List<@NotBlank String> declaredBusinessActivities;

    @Valid
    @NotNull
    private final ApplicantSnapshot applicant;

    public ApplicationSubmittedEvent(
            String eventId,
            String applicationId,
            String applicantId,
            Instant submittedAt,
            List<String> declaredBusinessActivities,
            ApplicantSnapshot applicant
    ) {
        this.eventId = eventId;
        this.applicationId = applicationId;
        this.applicantId = applicantId;
        this.submittedAt = submittedAt;
        this.declaredBusinessActivities = declaredBusinessActivities;
        this.applicant = applicant;
    }

    public String getEventId() {
        return eventId;
    }

    public String getApplicationId() {
        return applicationId;
    }

    public String getApplicantId() {
        return applicantId;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public List<String> getDeclaredBusinessActivities() {
        return declaredBusinessActivities;
    }

    public ApplicantSnapshot getApplicant() {
        return applicant;
    }
}
```

Perhatikan bahwa container element constraint `List<@NotBlank String>` tersedia sejak Bean Validation 2.0, sehingga relevan untuk Java 8+ stack dengan provider yang mendukung Bean Validation 2.0, seperti Hibernate Validator 6.x.

---

## 6. Envelope Validation

Sering kali yang paling penting divalidasi bukan hanya payload, tetapi envelope.

Contoh generic envelope:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;

public record EventEnvelope<T>(
        @NotBlank
        String messageId,

        @NotBlank
        String eventType,

        @NotBlank
        String source,

        @Pattern(regexp = "v[0-9]+")
        String schemaVersion,

        @NotNull
        Instant occurredAt,

        String correlationId,

        String causationId,

        @Valid
        @NotNull
        T payload
) {}
```

Envelope validation menjawab:

- apakah message punya identity?
- apakah event type dikenali?
- apakah source valid?
- apakah schema version didukung?
- apakah timestamp masuk akal?
- apakah payload ada?
- apakah correlation id tersedia untuk tracing?

Namun ada bagian yang tidak ideal jika hanya memakai annotation.

Contoh:

```text
schemaVersion must be one of currently supported versions for this eventType
```

Ini sering lebih baik divalidasi dengan explicit registry:

```java
public final class EventTypeRegistry {
    private final Map<String, Set<String>> supportedVersions;

    public boolean supports(String eventType, String schemaVersion) {
        return supportedVersions
                .getOrDefault(eventType, Set.of())
                .contains(schemaVersion);
    }
}
```

Kenapa? Karena supported version adalah compatibility policy, bukan sekadar structural validation.

---

## 7. Schema Validation vs Jakarta Validation

Top-tier engineer harus membedakan **wire schema validation** dan **object validation**.

### 7.1 Wire Schema Validation

Wire schema validation memastikan data yang dikirim melalui broker sesuai format kontrak.

Contoh alat:

- JSON Schema,
- Avro schema,
- Protobuf schema,
- AsyncAPI,
- schema registry,
- CloudEvents envelope.

Cocok untuk:

- field type,
- required/optional,
- default value,
- enum symbol,
- schema compatibility,
- serialization/deserialization,
- producer-consumer contract.

### 7.2 Jakarta Validation

Jakarta Validation bekerja setelah data menjadi Java object.

Cocok untuk:

- object-level constraints,
- nested object validation,
- container element validation,
- class-level consistency,
- reusable Java-side constraint,
- integration dengan service/domain/API model.

### 7.3 Beda Failure Mode

Schema validation failure biasanya berarti:

```text
I cannot safely deserialize/understand this message.
```

Jakarta Validation failure biasanya berarti:

```text
I can deserialize this message, but its Java object violates declared constraints.
```

Domain policy failure berarti:

```text
The message is structurally valid, but cannot be applied to current business state.
```

Database failure berarti:

```text
The processing result violates final storage consistency.
```

Jangan campur semua menjadi `ValidationException` generik.

---

## 8. Recommended Consumer Pipeline

Consumer yang matang biasanya punya pipeline seperti ini:

```text
1. Receive raw broker message
2. Validate transport limits
3. Parse envelope
4. Validate envelope structure
5. Check event type and schema version support
6. Deserialize payload
7. Validate payload object with Jakarta Validation
8. Check idempotency / duplicate message
9. Load target aggregate/reference data
10. Apply domain policy/state transition validation
11. Persist changes atomically
12. Publish resulting events/outbox messages
13. Ack message
```

Dalam bentuk kode:

```java
public final class ApplicationSubmittedConsumer {
    private final EventEnvelopeParser parser;
    private final EventTypeRegistry eventTypeRegistry;
    private final EventPayloadValidator payloadValidator;
    private final IdempotencyStore idempotencyStore;
    private final ApplicationService applicationService;
    private final InvalidEventHandler invalidEventHandler;

    public void onMessage(RawMessage rawMessage) {
        ParsedEnvelope<ApplicationSubmittedEvent> parsed;

        try {
            parsed = parser.parse(rawMessage, ApplicationSubmittedEvent.class);
        } catch (MalformedMessageException ex) {
            invalidEventHandler.reject(rawMessage, RejectionReason.MALFORMED_MESSAGE, ex);
            return;
        }

        EventEnvelope<ApplicationSubmittedEvent> envelope = parsed.envelope();

        if (!eventTypeRegistry.supports(envelope.eventType(), envelope.schemaVersion())) {
            invalidEventHandler.reject(rawMessage, RejectionReason.UNSUPPORTED_SCHEMA_VERSION, null);
            return;
        }

        ValidationOutcome validation = payloadValidator.validate(envelope);
        if (!validation.isValid()) {
            invalidEventHandler.reject(rawMessage, RejectionReason.CONSTRAINT_VIOLATION, validation);
            return;
        }

        if (idempotencyStore.alreadyProcessed(envelope.messageId())) {
            return;
        }

        try {
            applicationService.handleSubmitted(envelope.payload(), envelope.messageId());
            idempotencyStore.markProcessed(envelope.messageId());
        } catch (TransientDependencyException ex) {
            throw ex; // allow retry
        } catch (DomainConflictException ex) {
            invalidEventHandler.reject(rawMessage, RejectionReason.DOMAIN_CONFLICT, ex);
        }
    }
}
```

Kode di atas menunjukkan ide penting: tidak semua failure dilempar untuk retry.

---

## 9. Failure Classification: Retry, DLQ, Quarantine, Skip, Alert

Event-driven system gagal bukan hanya karena validasi. Klasifikasi failure menentukan operasional sistem.

| Failure | Contoh | Retry? | Tindakan |
|---|---|---:|---|
| Malformed message | JSON rusak, encoding salah | Tidak | reject/DLQ |
| Unknown event type | `eventType` tidak dikenal | Tidak/semi | quarantine, alert |
| Unsupported schema version | consumer belum support `v5` | Tidak sampai deploy baru | quarantine, alert |
| Jakarta constraint violation | required field missing | Biasanya tidak | DLQ/reject, notify owner |
| Reference not found | `applicationId` belum ada | Mungkin | retry delayed atau parking lot |
| Duplicate message | same messageId | Tidak | skip/ack |
| Out-of-order event | approved before submitted | Mungkin | retry delayed, reorder, parking lot |
| Stale event | older version than current aggregate | Tidak | skip with audit |
| DB deadlock/timeout | transient DB failure | Ya | retry with backoff |
| External API down | transient dependency | Ya | retry/backoff/circuit breaker |
| Unique constraint conflict | duplicate business effect | Tidak/depends | idempotency/domain conflict handling |
| Authorization/ownership invalid | event source not allowed | Tidak | security alert/quarantine |

### 9.1 Poison Message

Poison message adalah message yang selalu gagal jika diproses ulang.

Contoh:

```json
{
  "eventType": "ApplicationSubmitted",
  "schemaVersion": "v1",
  "payload": {
    "applicationId": null
  }
}
```

Jika consumer terus melempar exception, broker akan retry terus. Dampaknya:

- queue/partition macet,
- consumer lag meningkat,
- biaya naik,
- alert noise,
- message valid di belakangnya tertahan.

Solusi:

- deteksi non-retryable validation failure,
- ack message setelah disimpan ke rejection/DLQ,
- sertakan alasan rejection yang machine-readable,
- alert hanya jika pattern signifikan.

---

## 10. DLQ Tidak Cukup: Butuh Rejection Model

Dead Letter Queue sering dipakai sebagai tempat buangan. Ini berbahaya jika tidak ada struktur.

DLQ message minimal harus menyimpan:

```text
- original broker topic/queue
- partition/shard
- offset/delivery tag
- message id
- event type
- schema version
- source
- correlation id
- causation id
- occurredAt
- receivedAt
- rejectedAt
- consumer name/version
- rejection category
- rejection code
- validation violations
- safe payload excerpt/hash
- full payload location if stored securely
- retryable flag
- owner/team
- remediation hint
```

Contoh rejection record:

```java
public record RejectedEventRecord(
        String rejectionId,
        String sourceTopic,
        String messageId,
        String eventType,
        String schemaVersion,
        String source,
        String correlationId,
        Instant occurredAt,
        Instant receivedAt,
        Instant rejectedAt,
        String consumerName,
        String consumerVersion,
        RejectionCategory category,
        String rejectionCode,
        boolean retryable,
        List<EventViolation> violations,
        String payloadHash,
        String securePayloadLocation,
        String remediationHint
) {}
```

Violation view:

```java
public record EventViolation(
        String path,
        String code,
        String message,
        String constraint,
        Map<String, Object> attributes
) {}
```

### 10.1 Jangan Simpan Payload Sensitif Sembarangan

Event payload bisa mengandung:

- nama,
- email,
- nomor identitas,
- alamat,
- dokumen,
- financial information,
- enforcement/case data.

Untuk rejection logging:

- simpan hash payload untuk deduplication,
- simpan payload lengkap hanya di storage yang terenkripsi dan akses terbatas,
- redaksi field sensitif,
- jangan log `rejectedValue` mentah dari `ConstraintViolation` tanpa klasifikasi.

---

## 11. Inbound vs Outbound Validation

### 11.1 Inbound Event Validation

Inbound validation melindungi consumer.

```text
external/producer event -> consumer boundary -> validate -> apply safely
```

Tujuannya:

- mencegah corrupt state,
- melindungi consumer dari payload rusak,
- mengklasifikasikan failure,
- memberi observability.

### 11.2 Outbound Event Validation

Outbound validation melindungi downstream consumers.

```text
domain transaction -> build event -> validate outbound event -> publish
```

Tujuannya:

- producer tidak mempublish event invalid,
- kontrak downstream stabil,
- bug internal ketahuan sebelum publish,
- event store/outbox tidak terisi event rusak.

Contoh:

```java
public final class OutboxEventPublisher {
    private final Validator validator;
    private final OutboxRepository outboxRepository;

    public void publish(ApplicationSubmittedEvent event) {
        Set<ConstraintViolation<ApplicationSubmittedEvent>> violations = validator.validate(event);

        if (!violations.isEmpty()) {
            throw new InvalidOutboundEventException(event.getClass().getSimpleName(), violations);
        }

        outboxRepository.save(OutboxMessage.from(event));
    }
}
```

Outbound event validation failure biasanya bug internal, bukan user input error. Jadi responsnya berbeda:

- fail transaction,
- alert engineering,
- jangan publish event invalid,
- buat regression test.

---

## 12. Event Versioning dan Validation Compatibility

Event schema tidak boleh berubah sembarangan.

### 12.1 Safe Evolution Rules

Secara umum, perubahan yang relatif aman:

- menambah optional field,
- menambah field dengan default value pada schema yang mendukung default,
- menambah enum hanya jika consumer toleran unknown value,
- memperluas format tanpa mengubah semantics lama,
- menambah event type baru.

Perubahan berbahaya:

- mengganti nama field,
- menghapus field,
- mengubah type field,
- membuat optional field menjadi required,
- mempersempit enum,
- mengubah semantics field lama,
- mengubah meaning timestamp/timezone,
- mengubah identity/idempotency key.

### 12.2 Jakarta Validation dan Compatibility

Annotation bisa membuat compatibility break.

Sebelumnya:

```java
public record PaymentCompletedEvent(
        @NotBlank String paymentId,
        String externalReference
) {}
```

Kemudian berubah:

```java
public record PaymentCompletedEvent(
        @NotBlank String paymentId,
        @NotBlank String externalReference
) {}
```

Ini terlihat kecil, tetapi consumer lama/producers lama bisa mengirim event tanpa `externalReference`. Jika event lama diputar ulang dari log, consumer baru akan menolak event historis.

Karena itu, sebelum menambahkan constraint ke event:

1. Apakah field selalu ada di semua historical event?
2. Apakah semua producer sudah mengirim field itu?
3. Apakah replay akan gagal?
4. Apakah ada default/enrichment strategy?
5. Apakah constraint berlaku untuk semua schema version?
6. Apakah perlu DTO berbeda per version?

### 12.3 Versioned DTO

Untuk event yang punya kontrak jangka panjang, versioned DTO sering lebih aman.

```java
public sealed interface PaymentCompletedPayload
        permits PaymentCompletedPayloadV1, PaymentCompletedPayloadV2 {
}

public record PaymentCompletedPayloadV1(
        @NotBlank String paymentId,
        String externalReference
) implements PaymentCompletedPayload {}

public record PaymentCompletedPayloadV2(
        @NotBlank String paymentId,
        @NotBlank String externalReference,
        @NotBlank String paymentMethod
) implements PaymentCompletedPayload {}
```

Java 8 alternatif:

```java
public interface PaymentCompletedPayload {
}

public final class PaymentCompletedPayloadV1 implements PaymentCompletedPayload {
    // fields and getters
}

public final class PaymentCompletedPayloadV2 implements PaymentCompletedPayload {
    // fields and getters
}
```

### 12.4 Upcaster Pattern

Consumer bisa mengubah payload lama ke model internal baru.

```java
public interface EventUpcaster<S, T> {
    T upcast(S source);
}
```

Contoh:

```java
public final class PaymentCompletedV1ToV2Upcaster
        implements EventUpcaster<PaymentCompletedPayloadV1, PaymentCompletedPayloadV2> {

    @Override
    public PaymentCompletedPayloadV2 upcast(PaymentCompletedPayloadV1 source) {
        return new PaymentCompletedPayloadV2(
                source.paymentId(),
                source.externalReference() == null ? "UNKNOWN" : source.externalReference(),
                "UNKNOWN"
        );
    }
}
```

Namun hati-hati: default `UNKNOWN` harus domain-valid dan auditably explainable. Jangan membuat default palsu yang terlihat seperti data asli.

---

## 13. Idempotency Validation

Async systems hampir selalu harus mengasumsikan at-least-once delivery.

Artinya, message bisa diproses lebih dari sekali.

Idempotency bukan Bean Validation constraint. Ini operational/domain consistency rule.

### 13.1 Message Identity

Envelope harus punya stable message id:

```java
public record EventEnvelope<T>(
        @NotBlank String messageId,
        @NotBlank String eventType,
        @NotBlank String schemaVersion,
        @Valid @NotNull T payload
) {}
```

`@NotBlank` memastikan message id ada. Tapi tidak memastikan message belum pernah diproses.

### 13.2 Idempotency Store

```java
public interface ProcessedMessageRepository {
    boolean exists(String consumerName, String messageId);
    void insertProcessed(String consumerName, String messageId);
}
```

Harus didukung unique constraint:

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(100) NOT NULL,
    message_id VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Kenapa database constraint penting? Karena dua consumer instance bisa memproses duplicate secara concurrent. Check-then-insert tanpa unique constraint bisa race.

### 13.3 Idempotency Key Bukan Selalu Message ID

Kadang message id berbeda tapi business effect sama.

Contoh:

```text
PaymentCaptured event dikirim ulang oleh external gateway dengan messageId berbeda,
tetapi gatewayTransactionId sama.
```

Maka idempotency key bisa:

```text
source + eventType + businessTransactionId
```

Validation harus memastikan field pembentuk idempotency key ada, tetapi enforcement idempotency harus di service/database layer.

---

## 14. Out-of-Order, Stale, and Missing Reference Events

### 14.1 Out-of-Order Event

Contoh:

```text
CaseApproved arrives before CaseSubmitted
```

Apakah ini invalid? Belum tentu. Mungkin hanya ordering delay.

Tindakan:

- delayed retry,
- parking lot queue,
- state reconciliation,
- read model rebuild,
- reject only after policy threshold.

### 14.2 Stale Event

Contoh:

```text
CaseAssigned version=4 arrives after aggregate already at version=7
```

Ini mungkin stale. Tidak perlu retry.

Gunakan aggregate version:

```java
public record CaseAssignedEvent(
        @NotBlank String caseId,
        @Positive long aggregateVersion,
        @NotBlank String assignedOfficerId,
        @NotNull Instant assignedAt
) {}
```

Constraint `@Positive` memastikan version > 0, tetapi stale detection butuh current aggregate state.

```java
if (event.aggregateVersion() <= current.version()) {
    auditSkippedStaleEvent(event, current.version());
    return;
}
```

### 14.3 Missing Reference

Contoh:

```text
DocumentUploaded event references applicationId that is not yet replicated.
```

Ini bisa transient.

Jangan langsung DLQ jika sistem punya eventual consistency.

Klasifikasi:

| Kondisi | Tindakan |
|---|---|
| Reference harus sudah ada secara strongly consistent | reject/domain conflict |
| Reference mungkin delayed oleh replication | retry delayed |
| Reference berasal dari external system unreliable | parking lot + reconciliation |
| Reference optional/enrichable | process partial + warning |

---

## 15. Validation Groups untuk Event Lifecycle

Validation groups bisa membantu, tetapi jangan dijadikan workflow engine.

Contoh:

```java
public interface InboundStructural {}
public interface OutboundContract {}
public interface ReplayCompatibility {}
```

Event:

```java
public record LicenceStatusChangedEvent(
        @NotBlank(groups = {InboundStructural.class, OutboundContract.class})
        String eventId,

        @NotBlank(groups = {InboundStructural.class, OutboundContract.class})
        String licenceId,

        @NotNull(groups = OutboundContract.class)
        LicenceStatus newStatus,

        String legacyReasonCode
) {}
```

Penggunaan:

```java
validator.validate(event, InboundStructural.class);
validator.validate(event, OutboundContract.class);
validator.validate(event, ReplayCompatibility.class);
```

Use case groups untuk event:

- inbound external event,
- outbound internal event,
- replay/historical event,
- strict producer test,
- tolerant consumer mode.

Anti-pattern:

```java
validator.validate(event, CaseSubmittedToApprovedWorkflow.class);
```

Workflow transition bukan validation group. Itu domain/workflow guard.

---

## 16. Soft Validation vs Hard Validation

Dalam event-driven systems, tidak semua violation harus blocking.

### 16.1 Hard Validation

Hard validation berarti event tidak boleh diproses.

Contoh:

- missing event id,
- unknown event type,
- corrupt payload,
- missing aggregate id,
- invalid critical amount,
- unsupported schema version.

### 16.2 Soft Validation

Soft validation berarti event masih bisa diproses, tetapi perlu warning/audit.

Contoh:

- optional display name kosong,
- legacy field missing,
- deprecated enum value,
- enrichment data unavailable,
- non-critical field format unusual.

### 16.3 Implementasi Soft Validation

Jakarta Validation secara default menghasilkan violations, tetapi tidak menentukan blocking/non-blocking. Kamu bisa pakai groups atau payload severity.

```java
public interface HardValidation {}
public interface SoftValidation {}
```

```java
public record ImportedLegacyApplicationEvent(
        @NotBlank(groups = HardValidation.class)
        String applicationId,

        @NotBlank(groups = SoftValidation.class)
        String applicantEmail
) {}
```

Pipeline:

```java
Set<ConstraintViolation<ImportedLegacyApplicationEvent>> hard =
        validator.validate(event, HardValidation.class);

if (!hard.isEmpty()) {
    reject(event, hard);
    return;
}

Set<ConstraintViolation<ImportedLegacyApplicationEvent>> soft =
        validator.validate(event, SoftValidation.class);

if (!soft.isEmpty()) {
    auditWarnings(event, soft);
}

process(event);
```

Namun untuk production, severity model yang eksplisit sering lebih baik daripada group yang terlalu banyak.

---

## 17. Batch and Bulk Event Validation

Batch event berbeda dari single message.

Contoh:

```java
public record ApplicationBatchImportedEvent(
        @NotBlank String batchId,
        @NotNull Instant importedAt,
        @Size(min = 1, max = 10_000)
        List<@Valid @NotNull ImportedApplicationRecord> records
) {}
```

Masalah batch:

- satu record invalid, apakah seluruh batch gagal?
- berapa violation maksimal yang dilaporkan?
- apakah valid records tetap diproses?
- apakah error dilaporkan per row/index?
- apakah memory aman untuk 10.000 records?

### 17.1 All-or-Nothing

Cocok jika batch harus atomic.

```text
if any record invalid -> reject entire batch
```

Kelebihan:

- consistency sederhana,
- rollback jelas.

Kekurangan:

- satu record buruk menghambat semuanya,
- buruk untuk import besar.

### 17.2 Partial Accept

Cocok untuk import/event ingestion massal.

```text
valid records -> process
invalid records -> rejection report
```

Kelebihan:

- throughput lebih baik,
- user/operator bisa memperbaiki sebagian.

Kekurangan:

- perlu tracking detail,
- retry lebih rumit,
- harus jelas idempotency per record.

### 17.3 Limit Violations

Jangan selalu kumpulkan semua violation jika payload besar.

Strategi:

```text
- max 1000 violations per message
- max 50 violations per record
- max depth
- max collection size
- fail after structural threshold
```

Jakarta Validation tidak otomatis menyediakan semua policy operasional ini. Kamu harus desain di layer consumer.

---

## 18. Event Validation and Security

Event-driven systems sering dianggap internal, lalu validation dilonggarkan. Ini keliru.

Ancaman:

- producer compromised,
- rogue internal service,
- replay attack,
- oversized message,
- deep nested payload,
- malicious regex input,
- path traversal field,
- poisoned DLQ payload,
- PII leakage in logs,
- unauthorized event source.

### 18.1 Validate Source

Envelope harus punya source.

```java
public record EventEnvelope<T>(
        @NotBlank String source,
        @NotBlank String eventType,
        @NotBlank String messageId,
        @Valid @NotNull T payload
) {}
```

Tetapi `@NotBlank source` tidak cukup. Perlu allowlist:

```java
if (!trustedSourceRegistry.isAllowed(envelope.source(), envelope.eventType())) {
    rejectSecurity(envelope, "EVENT_SOURCE_NOT_ALLOWED");
    return;
}
```

### 18.2 Payload Size and Depth

Broker biasanya punya max message size, tetapi application juga perlu guard:

- max collection size dengan `@Size`,
- max string length,
- max nested object depth jika parse manual,
- avoid unbounded `Map<String,Object>`,
- avoid raw polymorphic deserialization tanpa allowlist.

### 18.3 PII-safe Rejection

Jangan log:

```text
email invalid: john.sensitive@example.com
identifier invalid: S1234567A
address invalid: full address...
```

Lebih aman:

```json
{
  "path": "payload.applicant.email",
  "code": "EMAIL_INVALID_FORMAT",
  "constraint": "Email",
  "rejectedValueClass": "String",
  "redacted": true
}
```

---

## 19. Validation in Outbox Pattern

Outbox pattern sering dipakai agar DB transaction dan event publishing tidak inconsistent.

Flow:

```text
1. command handled
2. domain state persisted
3. outbox row inserted in same transaction
4. outbox relay publishes event asynchronously
```

Pertanyaannya: kapan validate event?

### 19.1 Validate Before Insert Outbox

```text
domain transaction -> build event -> validate -> insert outbox -> commit
```

Kelebihan:

- outbox tidak berisi event invalid,
- failure terjadi dekat source,
- lebih mudah rollback.

Kekurangan:

- event validation masuk critical transaction path,
- jika validation bergantung external dependency, transaksi terganggu.

Karena itu, outbound validation harus pure dan local.

### 19.2 Validate Again Before Publish?

Bisa dilakukan sebagai defense-in-depth.

```text
outbox relay -> load event -> validate contract -> publish or quarantine
```

Jika gagal di relay, berarti:

- bug di producer,
- migration issue,
- outbox data corrupt,
- event class/schema mismatch.

Tindakan:

- quarantine outbox row,
- alert engineering,
- jangan retry publish event yang sama tanpa perubahan.

---

## 20. Validation in Event Sourcing

Event sourcing lebih sensitif karena event adalah source of truth.

### 20.1 Append-Time Validation

Sebelum event disimpan:

- validate event structure,
- validate aggregate transition,
- validate expected version,
- validate event metadata.

```text
command -> aggregate decides events -> validate events -> append if expectedVersion matches
```

### 20.2 Replay-Time Validation

Saat replay event lama, jangan selalu pakai validation terbaru secara ketat.

Jika validation terbaru lebih strict daripada event lama, replay bisa gagal.

Strategi:

- versioned event classes,
- upcasters,
- tolerant reader,
- replay compatibility group,
- immutable historical contract,
- migration event.

### 20.3 Do Not Rewrite History Casually

Jika event lama invalid menurut rule baru, belum tentu event itu “salah”. Mungkin rule berubah.

Untuk regulated systems, historical facts harus diperlakukan hati-hati:

- catat rule version,
- catat interpretation version,
- gunakan migration event jika perlu,
- jangan diam-diam mengubah payload historis tanpa audit.

---

## 21. Tolerant Reader Pattern

Consumer sebaiknya tidak terlalu rapuh terhadap field tambahan.

Tolerant reader berarti consumer:

- membaca field yang ia butuhkan,
- mengabaikan unknown fields,
- toleran terhadap optional fields,
- tidak gagal hanya karena producer menambah data.

Namun tolerant bukan berarti menerima apa saja.

Consumer tetap harus strict terhadap:

- envelope identity,
- event type,
- schema version policy,
- fields yang dibutuhkan untuk side effect,
- security source,
- idempotency key,
- critical business amount/status.

Rule praktis:

```text
Be tolerant about data you do not need.
Be strict about data you rely on.
```

---

## 22. Observability for Event Validation

Validation failure di async system harus terlihat.

Metrics penting:

```text
event_validation_total{eventType,source,result}
event_validation_rejected_total{eventType,source,reason}
event_validation_warning_total{eventType,source,code}
event_dlq_total{eventType,source,reason}
event_retry_total{eventType,source,reason}
event_processing_lag_seconds{topic,consumer}
event_schema_unsupported_total{eventType,schemaVersion}
```

Log fields:

```text
messageId
correlationId
causationId
eventType
schemaVersion
source
consumerName
consumerVersion
rejectionCode
retryable
violationCount
payloadHash
```

Avoid:

- full payload in normal logs,
- raw rejected value,
- stack trace for expected validation failures,
- high-cardinality label values like full message id in metrics.

---

## 23. Auditability in Regulatory Systems

Untuk case management/regulatory platform, invalid event handling bukan hanya technical concern.

Pertanyaan audit:

- Event apa yang ditolak?
- Ditolak oleh consumer apa?
- Ditolak kapan?
- Rule apa yang dilanggar?
- Rule version berapa?
- Apakah event berasal dari source terpercaya?
- Apakah rejection blocking atau warning?
- Apakah ada remediation?
- Apakah ada manual override?
- Apakah user/case officer terdampak?
- Apakah downstream system diberi tahu?

Contoh rejection audit:

```json
{
  "rejectionId": "rej-2026-00001234",
  "messageId": "msg-abc-123",
  "eventType": "LicenceStatusChanged",
  "schemaVersion": "v2",
  "source": "licensing-service",
  "consumer": "compliance-case-consumer",
  "consumerVersion": "2026.06.16-1",
  "category": "CONSTRAINT_VIOLATION",
  "code": "EVENT_REQUIRED_FIELD_MISSING",
  "retryable": false,
  "violations": [
    {
      "path": "payload.licenceId",
      "code": "NOT_BLANK",
      "constraint": "NotBlank"
    }
  ],
  "payloadHash": "sha256:...",
  "rejectedAt": "2026-06-16T10:00:00Z"
}
```

Auditability bukan berarti semua payload dibuka. Justru sistem yang baik memisahkan:

- audit metadata,
- secure payload vault,
- redacted operational logs,
- access-controlled investigation tooling.

---

## 24. Practical Design: Event Validation Result Model

Jangan biarkan validation result berupa exception string.

Desain model eksplisit:

```java
public enum EventValidationStatus {
    VALID,
    WARNING,
    INVALID_RETRYABLE,
    INVALID_NON_RETRYABLE
}
```

```java
public enum EventRejectionCategory {
    MALFORMED_MESSAGE,
    UNSUPPORTED_EVENT_TYPE,
    UNSUPPORTED_SCHEMA_VERSION,
    CONSTRAINT_VIOLATION,
    DOMAIN_CONFLICT,
    MISSING_REFERENCE,
    STALE_EVENT,
    DUPLICATE_EVENT,
    SECURITY_REJECTION,
    TRANSIENT_DEPENDENCY_FAILURE
}
```

```java
public record EventValidationResult(
        EventValidationStatus status,
        EventRejectionCategory category,
        String code,
        boolean retryable,
        List<EventViolation> violations
) {
    public static EventValidationResult valid() {
        return new EventValidationResult(
                EventValidationStatus.VALID,
                null,
                null,
                false,
                List.of()
        );
    }
}
```

For Java 8:

```java
public final class EventValidationResult {
    private final EventValidationStatus status;
    private final EventRejectionCategory category;
    private final String code;
    private final boolean retryable;
    private final List<EventViolation> violations;

    private EventValidationResult(
            EventValidationStatus status,
            EventRejectionCategory category,
            String code,
            boolean retryable,
            List<EventViolation> violations
    ) {
        this.status = status;
        this.category = category;
        this.code = code;
        this.retryable = retryable;
        this.violations = Collections.unmodifiableList(new ArrayList<>(violations));
    }

    public static EventValidationResult valid() {
        return new EventValidationResult(
                EventValidationStatus.VALID,
                null,
                null,
                false,
                Collections.emptyList()
        );
    }

    public boolean isValid() {
        return status == EventValidationStatus.VALID;
    }

    public boolean isRetryable() {
        return retryable;
    }

    public List<EventViolation> getViolations() {
        return violations;
    }
}
```

---

## 25. Example: Mapping ConstraintViolation to EventViolation

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.metadata.ConstraintDescriptor;
import java.util.Map;
import java.util.stream.Collectors;

public record EventViolation(
        String path,
        String messageTemplate,
        String constraint,
        Map<String, Object> attributes
) {
    public static EventViolation from(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();

        Map<String, Object> safeAttributes = descriptor.getAttributes().entrySet().stream()
                .filter(entry -> isSafeAttribute(entry.getKey()))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        return new EventViolation(
                violation.getPropertyPath().toString(),
                violation.getMessageTemplate(),
                descriptor.getAnnotation().annotationType().getSimpleName(),
                safeAttributes
        );
    }

    private static boolean isSafeAttribute(String name) {
        return switch (name) {
            case "min", "max", "regexp", "integer", "fraction" -> true;
            default -> false;
        };
    }
}
```

Java 8 version:

```java
private static boolean isSafeAttribute(String name) {
    return "min".equals(name)
            || "max".equals(name)
            || "regexp".equals(name)
            || "integer".equals(name)
            || "fraction".equals(name);
}
```

Important: avoid exposing `validatedValue` unless classified safe.

---

## 26. Framework Placement Examples

### 26.1 Kafka-like Consumer Conceptual Flow

```java
public void consume(ConsumerRecord<String, byte[]> record) {
    try {
        EventEnvelope<ApplicationSubmittedEvent> envelope = decode(record.value());
        EventValidationResult result = validateEnvelopeAndPayload(envelope);

        if (!result.isValid()) {
            rejectionStore.save(record, result);
            commitOffset(record);
            return;
        }

        process(envelope);
        commitOffset(record);
    } catch (TransientProcessingException ex) {
        throw ex; // retry according to container policy
    } catch (Exception ex) {
        rejectionStore.saveUnexpected(record, ex);
        commitOffset(record);
    }
}
```

### 26.2 RabbitMQ-like Consumer Conceptual Flow

```java
public void handleDelivery(byte[] body, MessageMetadata metadata) {
    EventHandlingDecision decision = handler.handle(body, metadata);

    switch (decision.action()) {
        case ACK -> ack(metadata.deliveryTag());
        case REQUEUE -> nack(metadata.deliveryTag(), true);
        case DEAD_LETTER -> nack(metadata.deliveryTag(), false);
    }
}
```

Key idea:

```text
Validation failure usually should not be requeued forever.
Transient dependency failure may be requeued or retried with backoff.
```

---

## 27. Common Anti-Patterns

### 27.1 Retry Everything

```java
try {
    process(event);
} catch (Exception ex) {
    throw ex;
}
```

Masalah:

- validation failure diretry selamanya,
- poison message menahan queue,
- tidak ada classification.

### 27.2 DLQ Without Context

```text
message moved to DLQ, no reason stored
```

Masalah:

- operator tidak tahu apa yang harus diperbaiki,
- producer team tidak bisa debug,
- audit trail lemah.

### 27.3 Strict New Constraints Break Replay

Menambahkan `@NotNull` ke event lama tanpa memikirkan historical replay.

Masalah:

- replay gagal,
- projection rebuild gagal,
- old event dianggap invalid oleh rule baru.

### 27.4 Domain Workflow in Annotation

```java
@ValidCaseCanBeApproved
public record CaseApprovedEvent(...) {}
```

Jika validator memuat DB dan mengecek workflow state, ini biasanya terlalu berat untuk Bean Validation. Lebih baik gunakan domain/workflow guard.

### 27.5 Logging Full Payload on Violation

Masalah:

- PII leakage,
- sensitive case data leak,
- compliance risk,
- log storage exposure.

### 27.6 Event DTO Reused as REST DTO

REST request dan event contract punya lifecycle berbeda. Reuse berlebihan menyebabkan:

- constraint salah konteks,
- compatibility break,
- coupling producer-consumer dengan API UI.

---

## 28. Testing Strategy

### 28.1 Unit Test Payload Validation

```java
@Test
void shouldRejectMissingApplicationId() {
    ApplicationSubmittedEvent event = new ApplicationSubmittedEvent(
            "evt-1",
            null,
            "applicant-1",
            Instant.now(),
            List.of("Brokerage"),
            new ApplicantSnapshot("Alice", "ID-1", "alice@example.com")
    );

    Set<ConstraintViolation<ApplicationSubmittedEvent>> violations = validator.validate(event);

    assertThat(violations)
            .extracting(v -> v.getPropertyPath().toString())
            .contains("applicationId");
}
```

### 28.2 Contract Test Producer Event

Producer test:

```text
Given domain state
When event is produced
Then outbound event passes Jakarta Validation
And matches schema contract
And contains required envelope metadata
```

### 28.3 Consumer Compatibility Test

Consumer test with historical event samples:

```text
- v1 minimal event
- v1 with unknown extra field
- v2 event
- missing optional field
- deprecated enum value
- old timestamp
```

### 28.4 DLQ Classification Test

Test bukan hanya exception, tetapi decision:

```text
malformed JSON -> non-retryable DLQ
unsupported version -> quarantine
missing reference -> retry delayed
duplicate message -> ack skip
constraint violation -> non-retryable reject
DB timeout -> retry
```

### 28.5 Replay Test

Untuk event sourcing/projection:

```text
Given archived event stream from old versions
When projection rebuild runs with current consumer
Then replay completes or known compatibility exceptions are handled
```

---

## 29. Java 8 hingga Java 25 Notes

### 29.1 Java 8

Ciri:

- class DTO biasa,
- Bean Validation 2.0 relevant,
- `javax.validation.*`,
- Hibernate Validator 6.x common,
- type-use constraints available if provider/spec version supports it,
- no records/sealed classes.

Rekomendasi:

- gunakan immutable POJO jika mungkin,
- pisahkan DTO per event version,
- gunakan explicit constructors,
- hati-hati dengan Lombok jika ada,
- jangan overload validation groups untuk versioning kompleks.

### 29.2 Java 11/17

Ciri:

- migration bridge era,
- Java 17 menjadi baseline banyak modern frameworks,
- Spring Boot 3 menggunakan Jakarta namespace,
- records available from Java 16.

Rekomendasi:

- mulai pindahkan event payload ke records jika feasible,
- explicit versioned payload type,
- gunakan `jakarta.validation.*` untuk modern stack,
- test migration `javax` ke `jakarta`.

### 29.3 Java 21/25

Ciri:

- records/sealed classes matang,
- virtual threads memudahkan concurrency tetapi tidak menghilangkan retry/idempotency problem,
- pattern matching membantu event dispatch modeling,
- modern AOT/native-image awareness bisa relevan di beberapa runtime.

Rekomendasi:

- gunakan sealed hierarchy untuk event families,
- pakai record untuk immutable event payload,
- validation tetap pure dan local,
- jangan melakukan blocking DB/API call dari `ConstraintValidator`,
- observability dan failure classification tetap wajib.

---

## 30. Design Checklist

Saat review event validation design, tanyakan:

### Contract

- Apakah event type dan schema version eksplisit?
- Apakah envelope punya message id, source, timestamp, correlation id?
- Apakah payload DTO berbeda dari REST DTO?
- Apakah schema contract dan Java validation konsisten?

### Compatibility

- Apakah constraint baru akan mematahkan event lama?
- Apakah replay historical event diuji?
- Apakah unknown field ditoleransi?
- Apakah unsupported version diklasifikasikan jelas?

### Failure Handling

- Apakah failure retryable/non-retryable dibedakan?
- Apakah validation failure tidak diretry selamanya?
- Apakah missing reference bisa delayed retry jika eventual consistency?
- Apakah duplicate event di-skip secara idempotent?

### Security

- Apakah source event diverifikasi?
- Apakah payload size dibatasi?
- Apakah rejected value disensor?
- Apakah full payload tidak masuk log biasa?

### Auditability

- Apakah rejection punya code, category, rule, timestamp, consumer version?
- Apakah operator tahu remediation?
- Apakah payload hash/location disimpan aman?
- Apakah ada dashboard rejection rate?

### Architecture

- Apakah Jakarta Validation hanya dipakai untuk structural/object constraints?
- Apakah domain workflow tidak disembunyikan dalam annotation?
- Apakah database constraints tetap menjadi final consistency guard?
- Apakah outbound event divalidasi sebelum publish/outbox?

---

## 31. Ringkasan Inti

Event-driven validation berbeda dari REST validation karena failure tidak langsung kembali ke caller. Dalam async system, validation harus menjadi bagian dari message lifecycle, bukan sekadar annotation call.

Mental model yang benar:

```text
schema says: can I deserialize this message?
Jakarta Validation says: is this Java object structurally valid?
domain policy says: can this event be applied to current state?
idempotency says: have I already applied this effect?
database says: is final persisted state consistent?
operations says: should I retry, reject, quarantine, skip, or alert?
audit says: can I explain what happened later?
```

Jakarta Validation dan Hibernate Validator sangat berguna untuk:

- payload object constraints,
- envelope object constraints,
- nested/cascaded validation,
- container element validation,
- outbound event validation,
- structured violation extraction.

Namun mereka bukan pengganti untuk:

- schema registry,
- event versioning,
- idempotency store,
- ordering strategy,
- retry/DLQ policy,
- domain workflow guard,
- database constraints,
- audit/rejection governance.

Top-tier event validation design bukan yang paling banyak annotation-nya, tetapi yang failure behavior-nya paling jelas, kompatibel, observable, aman, dan dapat dijelaskan.

---

## 32. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Validation 3.1 Specification — mendefinisikan object-level constraint declaration, metadata API, method/constructor validation, dan dapat digunakan di Java SE maupun Jakarta EE.
- Jakarta Validation 3.1 Release Page — release untuk Jakarta EE 11, metadata model/API untuk JavaBean dan method validation, termasuk clarification untuk Java Records.
- Hibernate Validator Reference Guide — reference implementation Jakarta Validation, termasuk container element constraints, custom constraints, value extractors, executable validation, dan provider-specific features.
- CloudEvents Specification — spesifikasi untuk mendeskripsikan event data secara umum demi interoperabilitas antar service/platform.
- Apache Avro / Schema Registry documentation — referensi penting untuk schema evolution dan compatibility strategy pada event streaming.

---

## 33. Status Seri

Seri **belum selesai**.

Bagian ini adalah:

```text
021 - Validation in Event-Driven and Async Systems
```

Bagian berikutnya:

```text
022 - Validation for Workflow, State Machines, and Regulatory Case Management
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-020](./learn-java-validation-jakarta-hibernate-validator-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-022](./learn-java-validation-jakarta-hibernate-validator-part-022.md)

</div>