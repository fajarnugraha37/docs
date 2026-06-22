# Part 25 — Integration Pattern: Gateway, Adapter, Outbox, Inbox, Saga, Idempotency

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `25-integration-gateway-adapter-outbox-inbox-saga-idempotency.md`  
> Level: Advanced / Staff Engineer  
> Target Java: 8 sampai 25

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu memahami dan merancang integrasi antar sistem Java secara lebih matang, bukan hanya “panggil API lalu simpan database”. Fokus utama part ini adalah membangun mental model bahwa integrasi adalah **failure boundary**, **consistency boundary**, dan **semantic boundary** sekaligus.

Kamu akan belajar:

1. Kenapa integration design jauh lebih sulit daripada sekadar HTTP client, message producer, atau database transaction.
2. Perbedaan antara `Gateway`, `Adapter`, `Anti-Corruption Layer`, `Outbox`, `Inbox`, `Saga`, dan `Idempotency`.
3. Kenapa dual-write problem adalah salah satu sumber bug paling berbahaya di distributed system.
4. Bagaimana merancang integrasi yang tahan retry, duplicate message, partial failure, timeout, dan race condition.
5. Bagaimana membuat event publication yang reliable tanpa distributed transaction.
6. Bagaimana memakai Outbox Pattern untuk memastikan perubahan database dan publikasi event tidak terpisah secara berbahaya.
7. Bagaimana memakai Inbox Pattern untuk membuat consumer idempotent.
8. Bagaimana Saga digunakan untuk long-running business transaction lintas boundary.
9. Bedanya orchestration dan choreography saga.
10. Kenapa “exactly once” sering salah dipahami.
11. Bagaimana Java 8–25 memengaruhi desain integration pattern.
12. Bagaimana menguji, mengobservasi, dan mereview desain integrasi di sistem enterprise.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sebuah sistem regulatory case management.

Ketika user menyetujui sebuah application:

1. Status application berubah dari `PENDING_REVIEW` menjadi `APPROVED`.
2. License record dibuat.
3. Audit trail dicatat.
4. Email dikirim.
5. External registry harus diberi tahu.
6. Payment/revenue module mungkin perlu update.
7. Notification service harus mengirim notifikasi.
8. Search index perlu diperbarui.
9. Reporting projection perlu menerima event.
10. Sistem eksternal mungkin down, timeout, lambat, atau menerima request duplicate.

Naive implementation sering terlihat seperti ini:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = applicationRepository.findById(id);
    app.approve();
    applicationRepository.save(app);

    licenseService.createLicense(app);
    auditService.logApproval(app);
    externalRegistryClient.notifyApproved(app);
    emailClient.sendApprovalEmail(app);
    kafkaTemplate.send("application-approved", app.toEvent());
}
```

Di permukaan sederhana. Tetapi ada masalah besar:

1. Apa yang terjadi jika database commit berhasil tetapi Kafka publish gagal?
2. Apa yang terjadi jika Kafka publish berhasil tetapi database rollback?
3. Apa yang terjadi jika external registry berhasil menerima request, tetapi client timeout sebelum menerima response?
4. Apa yang terjadi jika job retry dan mengirim event dua kali?
5. Apa yang terjadi jika email terkirim dua kali?
6. Apa yang terjadi jika approval dilakukan dua kali karena user double click?
7. Apa yang terjadi jika consumer memproses event, lalu crash sebelum menandai event selesai?
8. Apa yang terjadi jika compensation harus dilakukan tetapi business domain tidak punya operasi pembalik yang valid?
9. Apa yang terjadi jika event schema berubah?
10. Apa yang terjadi jika event dikirim sebelum transaction commit dan consumer membaca state lama?

Integration pattern membantu menjawab masalah-masalah ini secara eksplisit.

---

## 3. Mental Model Utama

### 3.1 Integrasi Adalah Boundary, Bukan Implementation Detail

Ketika sebuah sistem berkomunikasi dengan sistem lain, kamu sedang melintasi banyak boundary:

| Boundary | Pertanyaan penting |
|---|---|
| Semantic boundary | Apakah istilah `approved`, `active`, `valid`, `submitted` berarti sama di kedua sistem? |
| Failure boundary | Jika sistem lain gagal, apakah sistem ini ikut gagal? |
| Consistency boundary | Apakah perubahan harus atomic atau boleh eventually consistent? |
| Ownership boundary | Siapa pemilik data sebenarnya? |
| Security boundary | Credential siapa yang dipakai? Scope apa yang boleh dilakukan? |
| Time boundary | Apakah operasi harus selesai sekarang atau boleh diproses nanti? |
| Version boundary | Apa yang terjadi ketika schema/API berubah? |
| Observability boundary | Bagaimana trace request lintas sistem? |

Top engineer tidak melihat integrasi sebagai “tinggal call API”. Mereka bertanya:

```text
Apa invariant bisnis yang harus tetap benar walaupun network, broker, database, atau sistem eksternal gagal sebagian?
```

---

### 3.2 Local Transaction Tidak Sama dengan Distributed Transaction

Di satu database, kamu bisa punya atomicity:

```text
update application + insert audit + insert outbox = satu local transaction
```

Tetapi begitu kamu menambahkan remote call:

```text
update database + call HTTP API + publish Kafka event
```

kamu tidak lagi punya satu transaction yang benar-benar atomic, kecuali memakai distributed transaction/2PC. Di microservice/cloud/modern enterprise system, distributed transaction biasanya dihindari karena complexity, availability impact, coupling, dan operational fragility.

Maka pendekatan yang lebih umum adalah:

1. Gunakan local transaction untuk state yang dimiliki service sendiri.
2. Rekam intent untuk komunikasi keluar dalam outbox.
3. Publish secara asynchronous dari outbox.
4. Buat consumer idempotent dengan inbox/dedup.
5. Gunakan saga untuk long-running transaction lintas service.
6. Gunakan compensation jika business domain memang mendukung.

---

### 3.3 Exactly Once Biasanya Bukan Yang Kamu Pikirkan

Banyak engineer ingin “message diproses exactly once”. Tetapi dalam distributed system, yang lebih realistis adalah:

```text
At-least-once delivery + idempotent processing + deduplication + deterministic state transition
```

Kamu mungkin bisa mendapatkan exactly-once semantics dalam boundary tertentu, misalnya antara Kafka producer dan Kafka topic dalam konfigurasi tertentu, atau antara consumer offset dan Kafka transaction dalam setup tertentu. Tetapi begitu efek samping keluar ke database, email, HTTP API, object storage, search index, atau sistem eksternal, kamu harus mendesain idempotency.

Pertanyaan yang lebih sehat:

```text
Jika operasi ini dikirim atau diproses lebih dari sekali, apakah hasil akhirnya tetap benar?
```

---

## 4. Pattern Map

Part ini membahas beberapa pattern yang sering muncul bersama.

```text
External system boundary
        |
        v
+-------------------+
| Gateway / Adapter |
+-------------------+
        |
        v
+-------------------+       local transaction       +----------------+
| Application Logic | ----------------------------> | Business DB    |
+-------------------+                               +----------------+
        |                                                   |
        |                                                   v
        |                                          +----------------+
        |                                          | Outbox Table   |
        |                                          +----------------+
        |                                                   |
        v                                                   v
+-------------------+                             +------------------+
| Remote API        |                             | Outbox Publisher |
+-------------------+                             +------------------+
                                                            |
                                                            v
                                                    +----------------+
                                                    | Message Broker |
                                                    +----------------+
                                                            |
                                                            v
                                                    +----------------+
                                                    | Consumer Inbox |
                                                    +----------------+
                                                            |
                                                            v
                                                    +----------------+
                                                    | Consumer Logic |
                                                    +----------------+
```

Pattern yang akan kita bahas:

| Pattern | Tujuan utama |
|---|---|
| Gateway | Menyediakan interface internal yang stabil untuk komunikasi ke sistem eksternal |
| Adapter | Menerjemahkan model/protocol eksternal ke model internal |
| Outbox | Menjamin perubahan database dan intent publish event tersimpan atomic dalam local transaction |
| Inbox | Mencegah duplicate processing di consumer |
| Idempotency Key | Membuat operasi retry-safe |
| Deduplication Store | Menyimpan bukti bahwa message/request pernah diproses |
| Saga | Mengelola long-running transaction lintas boundary |
| Compensation | Menangani rollback bisnis secara eksplisit, bukan teknis semu |

---

## 5. Gateway Pattern

### 5.1 Definisi

Gateway adalah object/module yang membungkus komunikasi dengan sistem eksternal dan menyediakan interface internal yang stabil.

Contoh:

```java
public interface LicenseRegistryGateway {
    RegistryNotificationResult notifyLicenseApproved(LicenseApprovalNotification notification);
}
```

Internal code tidak perlu tahu:

1. URL endpoint.
2. HTTP method.
3. Auth token.
4. Retry policy detail.
5. JSON eksternal.
6. Error code vendor.
7. Timeout config.
8. Header khusus.

Semua itu menjadi tanggung jawab gateway/adapter layer.

---

### 5.2 Gateway vs Adapter

Keduanya sering berdekatan, tetapi tidak sama.

| Aspek | Gateway | Adapter |
|---|---|---|
| Fokus | Akses ke sistem eksternal | Translation antar interface/model |
| Pertanyaan | Bagaimana internal system berbicara ke external system? | Bagaimana bentuk eksternal diterjemahkan ke bentuk internal? |
| Contoh | `PaymentGateway`, `RegistryGateway` | `VendorStatusAdapter`, `LegacyCaseAdapter` |
| Bisa digabung? | Ya, untuk sistem kecil | Ya, tetapi untuk sistem besar lebih baik dipisah |

Contoh struktur:

```text
registry/
  application/
    LicenseRegistryGateway.java
  infrastructure/
    http/
      HttpLicenseRegistryGateway.java
      RegistryRequestMapper.java
      RegistryResponseMapper.java
      RegistryErrorTranslator.java
```

---

### 5.3 Gateway Interface yang Baik

Buruk:

```java
public interface RegistryGateway {
    RegistryResponse call(String url, Map<String, String> headers, String json);
}
```

Masalah:

1. Internal layer tahu terlalu banyak detail HTTP.
2. Semantics tidak jelas.
3. Tidak ada domain intent.
4. Error model tidak jelas.
5. Sulit dites dari sisi business behavior.

Lebih baik:

```java
public interface LicenseRegistryGateway {
    RegistryNotificationResult notifyApprovedLicense(ApprovedLicenseNotification notification);
}
```

Di sini internal code menyatakan intent, bukan protocol.

---

### 5.4 Gateway Result

Jangan bocorkan HTTP status langsung ke domain/application jika tidak perlu.

```java
public sealed interface RegistryNotificationResult
        permits RegistryNotificationResult.Accepted,
                RegistryNotificationResult.Rejected,
                RegistryNotificationResult.TemporaryFailure {

    record Accepted(String externalReference) implements RegistryNotificationResult {}

    record Rejected(String reasonCode, String message) implements RegistryNotificationResult {}

    record TemporaryFailure(String reason, boolean retryable) implements RegistryNotificationResult {}
}
```

Dengan ini application service bisa membuat keputusan jelas:

```java
RegistryNotificationResult result = registryGateway.notifyApprovedLicense(notification);

switch (result) {
    case RegistryNotificationResult.Accepted accepted -> markRegistrySynced(accepted.externalReference());
    case RegistryNotificationResult.Rejected rejected -> markRegistryRejected(rejected.reasonCode());
    case RegistryNotificationResult.TemporaryFailure failure -> scheduleRetry(failure.reason());
}
```

---

## 6. Adapter Pattern dalam Integrasi

Adapter bertugas menerjemahkan model eksternal ke model internal, dan sebaliknya.

### 6.1 External Model Tidak Boleh Menginfeksi Internal Model

Buruk:

```java
public void approve(VendorApplicationResponse response) {
    if ("A".equals(response.getStatusCode())) {
        application.approve();
    }
}
```

Masalah:

1. Status code vendor masuk ke domain logic.
2. Kalau vendor mengubah code, domain logic ikut berubah.
3. Business meaning tersebar.
4. Testing harus tahu detail vendor.

Lebih baik:

```java
public enum ExternalApprovalStatus {
    APPROVED,
    REJECTED,
    PENDING,
    UNKNOWN
}
```

```java
public final class VendorStatusAdapter {
    public ExternalApprovalStatus toInternalStatus(String vendorCode) {
        return switch (vendorCode) {
            case "A" -> ExternalApprovalStatus.APPROVED;
            case "R" -> ExternalApprovalStatus.REJECTED;
            case "P" -> ExternalApprovalStatus.PENDING;
            default -> ExternalApprovalStatus.UNKNOWN;
        };
    }
}
```

---

### 6.2 Adapter Harus Menangkap Semantic Mismatch

Masalah serius sering bukan format, tetapi makna.

Contoh:

```text
Internal APPROVED = legally approved and license may be issued.
External APPROVED = document format accepted by external registry.
```

Kalau dua istilah ini disamakan, sistem bisa mengeluarkan license terlalu cepat.

Adapter/ACL harus eksplisit:

```java
public enum RegistrySubmissionStatus {
    ACCEPTED_FOR_PROCESSING,
    REJECTED_BY_REGISTRY,
    PROCESSING,
    UNKNOWN
}
```

Jangan pakai nama yang terlalu business-final jika external status belum final.

---

## 7. Dual-Write Problem

### 7.1 Definisi

Dual-write terjadi ketika satu use case mencoba menulis ke dua resource berbeda dan berharap keduanya selalu konsisten.

Contoh:

```java
@Transactional
public void approve(ApplicationId id) {
    applicationRepository.approve(id);
    kafkaProducer.send(new ApplicationApprovedEvent(id));
}
```

Resource pertama: database.  
Resource kedua: Kafka.

Kemungkinan failure:

| DB commit | Kafka send | Hasil |
|---|---|---|
| gagal | gagal | aman, tidak ada perubahan |
| gagal | sukses | event bohong: consumer kira approved, DB tidak approved |
| sukses | gagal | state berubah, event hilang |
| sukses | sukses | ideal |
| sukses | timeout unknown | tidak tahu event terkirim atau tidak |

### 7.2 Kenapa Ini Berbahaya

Bug dual-write sering tidak terlihat saat testing lokal karena semua cepat dan stabil. Tetapi di production:

1. Broker restart.
2. Network timeout.
3. Database commit lambat.
4. Producer retry.
5. App crash setelah DB commit sebelum publish.
6. App crash setelah publish sebelum update status.
7. Deployment rolling restart.

Jika tidak dirancang, state antar sistem akan divergen.

---

## 8. Outbox Pattern

### 8.1 Definisi

Outbox Pattern menyimpan event/message yang harus dikirim ke sistem lain di database yang sama dengan business state, dalam local transaction yang sama.

Alih-alih:

```text
update DB + publish broker
```

Gunakan:

```text
update DB + insert outbox row dalam satu local transaction
```

Lalu proses terpisah membaca outbox dan publish message.

---

### 8.2 Alur Outbox

```text
1. Application service menjalankan use case.
2. Business entity berubah.
3. Outbox event dibuat.
4. Business state dan outbox event disimpan dalam satu transaction.
5. Transaction commit.
6. Outbox publisher mengambil event yang belum dipublish.
7. Publisher mengirim ke broker/external system.
8. Jika sukses, outbox ditandai published.
9. Jika gagal, outbox tetap pending dan akan retry.
```

---

### 8.3 Contoh Table

```sql
CREATE TABLE outbox_event (
    id                VARCHAR(64) PRIMARY KEY,
    aggregate_type    VARCHAR(100) NOT NULL,
    aggregate_id      VARCHAR(100) NOT NULL,
    event_type        VARCHAR(150) NOT NULL,
    event_version     INTEGER NOT NULL,
    payload_json      CLOB NOT NULL,
    status            VARCHAR(30) NOT NULL,
    retry_count       INTEGER NOT NULL,
    next_retry_at     TIMESTAMP NULL,
    created_at        TIMESTAMP NOT NULL,
    published_at      TIMESTAMP NULL,
    last_error        VARCHAR(1000) NULL
);

CREATE INDEX idx_outbox_status_retry
    ON outbox_event (status, next_retry_at, created_at);
```

Status umum:

```text
PENDING
PUBLISHING
PUBLISHED
FAILED
DEAD_LETTERED
```

Untuk beberapa database, status `PUBLISHING` membantu mengurangi duplicate work, tetapi harus hati-hati jika worker crash saat status `PUBLISHING`.

---

### 8.4 Domain Event ke Outbox Event

Domain event:

```java
public record ApplicationApproved(
        ApplicationId applicationId,
        OfficerId approvedBy,
        Instant approvedAt
) {}
```

Outbox envelope:

```java
public record OutboxEvent(
        String id,
        String aggregateType,
        String aggregateId,
        String eventType,
        int eventVersion,
        String payloadJson,
        OutboxStatus status,
        int retryCount,
        Instant createdAt,
        Instant nextRetryAt
) {}
```

Domain event menyatakan fakta bisnis. Outbox envelope menyatakan metadata delivery.

Jangan campur keduanya secara sembarangan.

---

### 8.5 Java Implementation Sketch

```java
public final class ApproveApplicationService {
    private final ApplicationRepository applicationRepository;
    private final OutboxRepository outboxRepository;
    private final JsonSerializer jsonSerializer;
    private final Clock clock;

    public void approve(ApproveApplicationCommand command) {
        Application application = applicationRepository.getRequired(command.applicationId());

        ApplicationApproved event = application.approve(command.officerId(), clock.instant());

        applicationRepository.save(application);

        OutboxEvent outboxEvent = OutboxEvent.pending(
                EventId.newId(),
                "Application",
                application.id().value(),
                "application.approved",
                1,
                jsonSerializer.toJson(event),
                clock.instant()
        );

        outboxRepository.save(outboxEvent);
    }
}
```

Dalam framework seperti Spring/Jakarta, method ini biasanya berjalan dalam satu transaction.

Hal penting:

```text
Jika business state commit, outbox row ikut commit.
Jika business state rollback, outbox row ikut rollback.
```

---

### 8.6 Outbox Publisher

```java
public final class OutboxPublisherJob {
    private final OutboxRepository outboxRepository;
    private final MessagePublisher messagePublisher;
    private final Clock clock;

    public void publishBatch() {
        List<OutboxEvent> events = outboxRepository.claimPendingEvents(100, clock.instant());

        for (OutboxEvent event : events) {
            try {
                messagePublisher.publish(event.eventType(), event.id(), event.payloadJson());
                outboxRepository.markPublished(event.id(), clock.instant());
            } catch (Exception ex) {
                outboxRepository.markFailedForRetry(
                        event.id(),
                        RetryBackoff.next(event.retryCount(), clock.instant()),
                        ErrorMessage.safe(ex)
                );
            }
        }
    }
}
```

---

### 8.7 Claim Pending Events

Kalau ada banyak instance publisher, harus ada mekanisme claim.

Contoh pendekatan SQL konseptual:

```sql
SELECT *
FROM outbox_event
WHERE status = 'PENDING'
  AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
ORDER BY created_at
FETCH FIRST 100 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Lalu update status menjadi `PUBLISHING` atau langsung publish dalam transaction claim yang pendek.

Prinsip:

1. Jangan lock terlalu lama saat publish remote.
2. Jangan publish HTTP/broker sambil menahan DB transaction panjang.
3. Claim event dalam transaction pendek.
4. Publish di luar transaction claim.
5. Mark success/failure setelah publish.
6. Buat recovery untuk event stuck di `PUBLISHING`.

---

### 8.8 Polling Publisher vs Transaction Log Tailing

Ada dua pendekatan umum:

| Pendekatan | Cara kerja | Kelebihan | Kekurangan |
|---|---|---|---|
| Polling publisher | App/job membaca table outbox | Sederhana, portable | Latency polling, query load |
| Transaction log tailing | CDC membaca DB log dan publish | Near-real-time, lebih scalable | Infrastruktur lebih kompleks |

Untuk banyak enterprise Java system, polling outbox cukup baik jika volume terkendali dan query/index didesain benar.

Untuk volume besar, CDC seperti Debezium sering lebih cocok.

---

## 9. Inbox Pattern

### 9.1 Definisi

Inbox Pattern menyimpan message/event yang diterima consumer sebelum atau saat processing, agar consumer dapat mendeteksi duplicate message dan memproses secara idempotent.

Masalah:

```text
Broker mengirim message.
Consumer memproses DB update.
Consumer crash sebelum commit offset/ack.
Broker mengirim message lagi.
DB update bisa terjadi dua kali.
```

Inbox menjawab:

```text
Apakah message ini sudah pernah diproses?
```

---

### 9.2 Inbox Table

```sql
CREATE TABLE inbox_message (
    message_id      VARCHAR(64) PRIMARY KEY,
    source          VARCHAR(100) NOT NULL,
    message_type    VARCHAR(150) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL,
    error_message   VARCHAR(1000) NULL
);
```

---

### 9.3 Consumer Flow

```text
1. Receive message.
2. Start local transaction.
3. Try insert inbox row with message_id.
4. If duplicate key and already processed, skip safely.
5. If new, process business update.
6. Mark inbox processed.
7. Commit transaction.
8. Ack message.
```

---

### 9.4 Java Sketch

```java
public final class ApplicationApprovedConsumer {
    private final InboxRepository inboxRepository;
    private final ProjectionRepository projectionRepository;
    private final JsonSerializer jsonSerializer;
    private final Clock clock;

    public void onMessage(ReceivedMessage message) {
        boolean firstTime = inboxRepository.tryStartProcessing(
                message.messageId(),
                message.source(),
                message.type(),
                clock.instant()
        );

        if (!firstTime) {
            return;
        }

        try {
            ApplicationApproved event = jsonSerializer.fromJson(
                    message.payload(),
                    ApplicationApproved.class
            );

            projectionRepository.upsertApprovedApplication(
                    event.applicationId(),
                    event.approvedAt()
            );

            inboxRepository.markProcessed(message.messageId(), clock.instant());
        } catch (Exception ex) {
            inboxRepository.markFailed(message.messageId(), ErrorMessage.safe(ex));
            throw ex;
        }
    }
}
```

Important nuance:

```text
Business update dan inbox processed marker harus dalam transaction yang sama.
```

Kalau tidak, kamu masih punya window inconsistency.

---

## 10. Idempotency Pattern

### 10.1 Definisi

Idempotency berarti operasi yang dieksekusi beberapa kali dengan input yang sama menghasilkan efek akhir yang sama seperti dieksekusi satu kali.

Contoh idempotent:

```text
Set application status to APPROVED if currently PENDING_REVIEW.
```

Contoh non-idempotent:

```text
Increment approval count.
Send email.
Create new license number every call.
Append audit row without dedup key.
```

---

### 10.2 Idempotency Key

Idempotency key adalah identifier unik untuk operasi bisnis.

Contoh:

```text
ApproveApplication:{applicationId}:{requestId}
RegistryNotify:{licenseId}:{eventId}
PaymentCapture:{paymentId}:{attemptId}
```

Table:

```sql
CREATE TABLE idempotency_record (
    key             VARCHAR(200) PRIMARY KEY,
    operation       VARCHAR(100) NOT NULL,
    request_hash    VARCHAR(128) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    response_json   CLOB NULL,
    created_at      TIMESTAMP NOT NULL,
    completed_at    TIMESTAMP NULL
);
```

---

### 10.3 Request Hash

Idempotency key saja tidak cukup. Client bisa mengirim key sama dengan payload berbeda.

Maka simpan hash request.

```java
public record IdempotencyKey(String value) {}

public record IdempotencyRequest(
        IdempotencyKey key,
        String operation,
        String requestHash
) {}
```

Jika key sama tetapi hash berbeda, return conflict.

```text
409 Conflict: same idempotency key used with different request payload.
```

---

### 10.4 Idempotent State Transition

Daripada:

```java
application.approve();
licenseRepository.insert(new License(...));
```

Lebih aman:

```java
if (application.isApproved()) {
    return ApprovalResult.alreadyApproved(application.licenseId());
}

application.approve();
licenseRepository.insertIfAbsent(application.id(), license);
```

Invariant:

```text
Satu application hanya boleh punya satu license aktif hasil approval.
```

Enforce di database:

```sql
CREATE UNIQUE INDEX uq_license_application
ON license(application_id)
WHERE status = 'ACTIVE';
```

Jika database tidak mendukung partial unique index, gunakan constraint alternatif sesuai engine.

---

### 10.5 Idempotency Harus Didukung Storage Constraint

Idempotency yang hanya dicek di memory tidak cukup.

Buruk:

```java
if (!processedMessageIds.contains(messageId)) {
    process(message);
    processedMessageIds.add(messageId);
}
```

Masalah:

1. Hilang saat restart.
2. Tidak aman multi-instance.
3. Race condition.
4. Tidak bisa audit.

Lebih baik:

```text
Unique constraint + local transaction + durable record
```

---

## 11. Deduplication Store

Deduplication store menyimpan identifier event/request yang pernah diproses.

Bisa berupa:

1. Database table.
2. Redis dengan TTL.
3. Kafka compacted topic.
4. Object store marker.
5. Domain table unique constraint.

Pemilihan tergantung konsekuensi duplicate.

| Duplicate impact | Dedup storage |
|---|---|
| Bisa ditoleransi sementara | Redis TTL mungkin cukup |
| Tidak boleh terjadi karena legal/financial | Durable DB constraint |
| Projection bisa rebuild | Inbox/projection table |
| Event stream high volume | Log-compacted/partitioned dedup |

Top engineer bertanya:

```text
Berapa lama duplicate bisa datang?
Apa akibat duplicate?
Apakah dedup record boleh expire?
Apakah dedup harus survive disaster recovery?
```

---

## 12. Saga Pattern

### 12.1 Definisi

Saga adalah pattern untuk mengelola long-running transaction yang terdiri dari beberapa local transaction lintas service/boundary, dengan compensation jika ada langkah yang gagal.

Contoh approval:

```text
1. Approve application.
2. Create license.
3. Notify registry.
4. Generate certificate.
5. Send notification.
```

Jika langkah ke-4 gagal, apa yang harus dilakukan?

Tidak selalu bisa rollback teknis. Kamu perlu business compensation.

---

### 12.2 Local Transaction vs Saga Step

Setiap saga step harus punya:

1. Command/action.
2. Success condition.
3. Failure condition.
4. Retry policy.
5. Idempotency key.
6. Timeout/deadline.
7. Compensation, jika memungkinkan.
8. Audit trail.

Contoh:

| Step | Action | Compensation |
|---|---|---|
| Approve application | Set status APPROVED | Reopen/revert approval, jika legally allowed |
| Create license | Insert license | Mark license CANCELLED, bukan delete |
| Notify registry | Send registry message | Send cancellation/update, jika supported |
| Generate certificate | Create document | Mark obsolete |
| Send email | Notify applicant | Tidak bisa unsend email; kirim correction notice |

Compensation bukan `rollback`. Compensation adalah aksi bisnis baru.

---

### 12.3 Orchestration Saga

Dalam orchestration, satu orchestrator mengontrol langkah.

```text
Saga Orchestrator
   -> Application Service
   -> License Service
   -> Registry Service
   -> Document Service
   -> Notification Service
```

Kelebihan:

1. Flow eksplisit.
2. Mudah diaudit.
3. Cocok untuk business process kompleks.
4. Failure handling terpusat.
5. Lebih mudah dijelaskan ke stakeholder/regulator.

Kekurangan:

1. Orchestrator bisa menjadi god process.
2. Coupling ke banyak participant.
3. Perubahan participant memengaruhi orchestrator.
4. Risk bottleneck.

---

### 12.4 Choreography Saga

Dalam choreography, setiap service bereaksi terhadap event.

```text
ApplicationApproved event
   -> License service creates license
   -> LicenseCreated event
      -> Registry service notified
      -> Certificate service generates document
      -> Notification service sends email
```

Kelebihan:

1. Decentralized.
2. Loose coupling secara teknis.
3. Cocok untuk flow sederhana.
4. Service bisa bereaksi independently.

Kekurangan:

1. Flow tersembunyi.
2. Sulit diaudit end-to-end.
3. Event soup.
4. Debugging lebih sulit.
5. Compensation tersebar.

Untuk regulatory lifecycle yang harus defensible, orchestration sering lebih mudah dipertanggungjawabkan untuk proses utama, sementara choreography bisa dipakai untuk side-effect non-critical seperti projection/notification.

---

### 12.5 Saga State Table

```sql
CREATE TABLE saga_instance (
    id              VARCHAR(64) PRIMARY KEY,
    saga_type       VARCHAR(100) NOT NULL,
    business_key    VARCHAR(150) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    current_step    VARCHAR(100) NOT NULL,
    payload_json    CLOB NOT NULL,
    retry_count     INTEGER NOT NULL,
    next_retry_at   TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    completed_at    TIMESTAMP NULL
);

CREATE UNIQUE INDEX uq_saga_business_key
ON saga_instance(saga_type, business_key);
```

Unique business key mencegah saga duplicate untuk business operation yang sama.

---

### 12.6 Saga Java Sketch

```java
public sealed interface ApprovalSagaState
        permits ApprovalSagaState.Started,
                ApprovalSagaState.LicenseCreated,
                ApprovalSagaState.RegistryNotified,
                ApprovalSagaState.Completed,
                ApprovalSagaState.Failed {

    record Started(ApplicationId applicationId) implements ApprovalSagaState {}

    record LicenseCreated(ApplicationId applicationId, LicenseId licenseId)
            implements ApprovalSagaState {}

    record RegistryNotified(ApplicationId applicationId, LicenseId licenseId, String registryRef)
            implements ApprovalSagaState {}

    record Completed(ApplicationId applicationId, LicenseId licenseId)
            implements ApprovalSagaState {}

    record Failed(ApplicationId applicationId, String reason)
            implements ApprovalSagaState {}
}
```

```java
public final class ApprovalSagaOrchestrator {
    private final LicenseGateway licenseGateway;
    private final RegistryGateway registryGateway;
    private final CertificateGateway certificateGateway;
    private final SagaRepository sagaRepository;

    public void advance(SagaId sagaId) {
        ApprovalSaga saga = sagaRepository.getRequired(sagaId);

        switch (saga.state()) {
            case ApprovalSagaState.Started started -> createLicense(saga, started);
            case ApprovalSagaState.LicenseCreated licenseCreated -> notifyRegistry(saga, licenseCreated);
            case ApprovalSagaState.RegistryNotified registryNotified -> generateCertificate(saga, registryNotified);
            case ApprovalSagaState.Completed completed -> { }
            case ApprovalSagaState.Failed failed -> { }
        }

        sagaRepository.save(saga);
    }
}
```

Dengan sealed interface dan pattern matching, state saga bisa dibuat lebih eksplisit dan exhaustiveness checking membantu mengurangi missed branch.

---

## 13. Compensation Pattern

### 13.1 Compensation Bukan Rollback

Rollback database menghapus perubahan yang belum commit. Compensation membuat aksi bisnis baru untuk mengimbangi efek sebelumnya.

Contoh:

| Efek awal | Compensation realistis |
|---|---|
| License issued | License revoked/cancelled |
| Email sent | Correction email sent |
| Payment captured | Refund issued |
| Registry notified approved | Registry notified cancelled/amended |
| Case assigned | Case reassigned |

Jangan tulis:

```java
licenseRepository.delete(licenseId);
```

untuk domain yang legally auditable. Lebih baik:

```java
license.cancel(CancellationReason.SAGA_COMPENSATION, officerOrSystemActor);
```

---

### 13.2 Compensation Harus Idempotent

Compensation juga bisa di-retry.

```java
public CancellationResult cancelLicense(LicenseId licenseId, CancellationCommand command) {
    License license = licenseRepository.getRequired(licenseId);

    if (license.isCancelled()) {
        return CancellationResult.alreadyCancelled(license.cancelledAt());
    }

    license.cancel(command.reason(), command.actor(), command.now());
    licenseRepository.save(license);

    return CancellationResult.cancelled(license.cancelledAt());
}
```

---

## 14. Event Design for Integration

### 14.1 Event Harus Punya Identity

Minimal event envelope:

```java
public record IntegrationEventEnvelope<T>(
        String eventId,
        String eventType,
        int eventVersion,
        String aggregateType,
        String aggregateId,
        Instant occurredAt,
        String correlationId,
        String causationId,
        T payload
) {}
```

Field penting:

| Field | Fungsi |
|---|---|
| eventId | Dedup/idempotency |
| eventType | Routing dan deserialization |
| eventVersion | Schema evolution |
| aggregateId | Ordering per aggregate |
| occurredAt | Business time |
| correlationId | Trace end-to-end |
| causationId | Event causality |

---

### 14.2 Event Jangan Menjadi Remote Procedure Call

Buruk:

```text
PleaseCreateLicenseEvent
PleaseSendEmailEvent
PleaseUpdateRegistryEvent
```

Ini sering sebenarnya command yang menyamar sebagai event.

Event harus menyatakan fakta yang sudah terjadi:

```text
ApplicationApproved
LicenseIssued
RegistryNotificationAccepted
CertificateGenerated
```

Jika kamu ingin service lain melakukan sesuatu, gunakan command/message dengan semantics yang jelas, atau event dengan subscription policy yang jelas.

---

### 14.3 Event-Carried State vs Thin Event

Thin event:

```json
{
  "eventId": "evt-123",
  "eventType": "ApplicationApproved",
  "applicationId": "APP-001"
}
```

Consumer harus query source service untuk detail.

Event-carried state:

```json
{
  "eventId": "evt-123",
  "eventType": "ApplicationApproved",
  "applicationId": "APP-001",
  "approvedAt": "2026-06-18T10:15:00Z",
  "approvedBy": "OFFICER-9",
  "applicantId": "APPLICANT-7",
  "licenseCategory": "REAL_ESTATE_AGENT"
}
```

Trade-off:

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Thin event | Payload kecil, less duplication | Consumer perlu call back, coupling runtime, risk thundering herd |
| Event-carried state | Consumer independent, replay lebih mudah | Payload/versioning lebih kompleks, risk stale data |

Untuk projection/reporting, event-carried state sering lebih berguna. Untuk sensitive data, payload harus dibatasi.

---

## 15. Ordering

### 15.1 Global Ordering Biasanya Mahal

Yang biasanya dibutuhkan bukan global ordering, tetapi ordering per aggregate.

```text
Application APP-001 events harus urut.
Application APP-002 tidak harus menunggu APP-001.
```

Dengan Kafka, ini biasanya dicapai dengan partition key `aggregateId`.

Dengan database outbox, ordering bisa berdasarkan `(aggregate_id, sequence)`.

---

### 15.2 Aggregate Sequence

```sql
ALTER TABLE outbox_event
ADD aggregate_sequence BIGINT NOT NULL;

CREATE UNIQUE INDEX uq_outbox_aggregate_sequence
ON outbox_event(aggregate_type, aggregate_id, aggregate_sequence);
```

Sequence membantu consumer mendeteksi gap/out-of-order.

Tetapi jangan overdesign jika use case tidak butuh strict ordering.

---

## 16. Transaction Boundary

### 16.1 Jangan Remote Call Dalam DB Transaction Panjang

Buruk:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.getRequired(id);
    app.approve();
    registryClient.notify(app); // remote call while transaction open
    repository.save(app);
}
```

Masalah:

1. DB lock ditahan selama network call.
2. Jika remote lambat, transaction panjang.
3. Timeout ambiguity.
4. Deadlock/lock contention meningkat.
5. Retry menjadi berbahaya.

Lebih baik:

```text
Transaction 1:
  update app
  insert outbox
commit

Async publisher:
  call registry
  update delivery status
```

---

### 16.2 After Commit Hook Tidak Cukup

Beberapa framework menyediakan after-commit event.

Masalah:

```text
DB commit sukses.
After-commit hook berjalan.
App crash sebelum publish.
Event hilang.
```

After-commit hook boleh dipakai untuk optimization, tetapi untuk reliable integration, outbox lebih aman.

---

## 17. Java 8–25 Perspective

### 17.1 Java 8

Java 8 memperkenalkan lambda, `CompletableFuture`, Stream, dan `Optional`. Untuk integration pattern:

1. Lambda bisa membantu membuat retry/backoff policy composable.
2. `CompletableFuture` bisa dipakai untuk fan-out, tetapi raw composition sering sulit dibaca.
3. `Optional` baik untuk boundary result tertentu, tetapi buruk jika dipakai untuk error semantics kompleks.
4. Functional interface berguna untuk wrapping external call dengan timeout/retry/circuit breaker.

Contoh:

```java
@FunctionalInterface
public interface RemoteCall<T> {
    T execute() throws Exception;
}
```

---

### 17.2 Java 9–11

Java 9 module system dapat membantu memisahkan boundary:

```text
module app.domain tidak boleh depend pada app.infrastructure.http
```

Java 11 `HttpClient` memberi client standar, tetapi pattern tetap sama: jangan biarkan HTTP detail bocor ke domain.

---

### 17.3 Java 16–17

Records sangat cocok untuk:

1. Event payload.
2. Command payload.
3. Idempotency key.
4. Gateway request/response internal.
5. Value object ringan.

Sealed classes cocok untuk:

1. Result type.
2. Saga state.
3. Error taxonomy.
4. Integration outcome.

---

### 17.4 Java 21–25

Virtual threads membuat blocking I/O jauh lebih scalable untuk banyak jenis integration worker. Tetapi virtual threads tidak menghapus kebutuhan:

1. Timeout.
2. Backpressure.
3. Rate limit.
4. Idempotency.
5. Connection pool sizing.
6. External system capacity protection.

Structured concurrency membantu menyusun fan-out/fan-in dengan cancellation yang lebih masuk akal. Scoped values dapat menggantikan sebagian penggunaan `ThreadLocal` untuk correlation/request context dalam model virtual-thread-friendly.

Tetapi pattern integration tetap bertumpu pada semantic correctness, bukan hanya concurrency primitive.

---

## 18. Anti-Pattern Catalog

### 18.1 Dual Write

Gejala:

```java
repository.save(entity);
broker.publish(event);
```

tanpa outbox atau transaction coordination.

Akibat:

1. Event hilang.
2. Event bohong.
3. State divergent.
4. Manual reconciliation.

Solusi:

```text
Local transaction + outbox + idempotent consumer
```

---

### 18.2 Distributed Transaction Fantasy

Gejala:

```text
“Kita butuh semuanya atomic lintas service.”
```

Padahal:

1. Business process long-running.
2. External system tidak mendukung XA.
3. Network unreliable.
4. Human approval bisa terlibat.

Solusi:

```text
Saga + explicit compensation + eventual consistency + audit trail
```

---

### 18.3 Event Without Idempotency

Gejala:

Consumer menganggap message hanya datang sekali.

```java
public void consume(Event event) {
    sendEmail(event.email());
    insertProjection(event);
}
```

Akibat:

1. Duplicate email.
2. Duplicate row.
3. Inflated count.
4. Wrong state.

Solusi:

```text
Inbox + unique constraint + idempotent operation
```

---

### 18.4 Event as RPC

Gejala:

Event bernama imperatif:

```text
CreateLicenseEvent
SendEmailEvent
UpdateRegistryEvent
```

Akibat:

1. Intent/fact rancu.
2. Ownership tidak jelas.
3. Retry semantics kabur.
4. Flow susah dipahami.

Solusi:

```text
Command untuk request melakukan aksi.
Event untuk fakta yang sudah terjadi.
```

---

### 18.5 Compensation Without Domain Meaning

Gejala:

```java
rollbackApproval();
deleteLicense();
deleteAudit();
```

Akibat:

1. Audit hilang.
2. Regulatory traceability rusak.
3. State legal tidak akurat.
4. Data forensic sulit.

Solusi:

```text
Compensation sebagai aksi bisnis eksplisit: cancel, revoke, amend, correction notice.
```

---

### 18.6 Shared Database Integration

Gejala:

Service A langsung baca/tulis table milik Service B.

Akibat:

1. Schema coupling.
2. Ownership kabur.
3. Migration sulit.
4. Business rule bypass.
5. Audit tidak lengkap.

Solusi:

```text
Expose API/event/query model yang dimiliki service owner.
```

Shared database kadang masih terjadi di modular monolith atau legacy system, tetapi harus diperlakukan sebagai transitional risk, bukan ideal architecture.

---

### 18.7 Polling Without Backoff

Gejala:

```text
Outbox job scan setiap detik tanpa index, tanpa batch limit, tanpa retry schedule.
```

Akibat:

1. DB load tinggi.
2. Hot table.
3. Retry storm.
4. Dead row menumpuk.

Solusi:

```text
Index by status/next_retry_at, batch size, exponential backoff, dead letter, archive.
```

---

### 18.8 Silent Dead Letter

Gejala:

Message gagal berkali-kali lalu dipindahkan ke DLQ tanpa alert dan owner.

Akibat:

1. Business process berhenti diam-diam.
2. SLA dilanggar.
3. Data inconsistent.
4. Incident terlambat diketahui.

Solusi:

```text
DLQ harus punya alert, dashboard, replay tooling, owner, runbook.
```

---

## 19. Refactoring Path dari Naive Integration ke Reliable Integration

### 19.1 Starting Point

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.getRequired(id);
    app.approve();
    repository.save(app);
    broker.publish(new ApplicationApprovedEvent(id));
    emailClient.sendApprovalEmail(app.email());
}
```

---

### 19.2 Step 1 — Pisahkan Domain Mutation dari Side Effect

```java
public ApplicationApproved approve(OfficerId officerId, Instant now) {
    if (status != ApplicationStatus.PENDING_REVIEW) {
        throw new IllegalStateException("Application cannot be approved from " + status);
    }

    this.status = ApplicationStatus.APPROVED;
    this.approvedBy = officerId;
    this.approvedAt = now;

    return new ApplicationApproved(id, officerId, now);
}
```

---

### 19.3 Step 2 — Simpan Event ke Outbox

```java
@Transactional
public void approve(ApproveApplicationCommand command) {
    Application app = repository.getRequired(command.applicationId());
    ApplicationApproved event = app.approve(command.officerId(), clock.instant());

    repository.save(app);
    outboxRepository.save(OutboxEvent.from(event));
}
```

---

### 19.4 Step 3 — Buat Publisher Terpisah

```java
public void publishPending() {
    List<OutboxEvent> events = outboxRepository.claimPendingEvents(100, clock.instant());
    for (OutboxEvent event : events) {
        publishOne(event);
    }
}
```

---

### 19.5 Step 4 — Buat Consumer Idempotent

```java
@Transactional
public void consume(Message message) {
    if (!inboxRepository.tryInsert(message.id(), message.type(), clock.instant())) {
        return;
    }

    processBusinessEffect(message);
    inboxRepository.markProcessed(message.id(), clock.instant());
}
```

---

### 19.6 Step 5 — Tambahkan Retry, Backoff, DLQ, Observability

Tambahkan:

1. `retry_count`.
2. `next_retry_at`.
3. `last_error`.
4. `dead_lettered_at`.
5. Metrics backlog.
6. Alert jika pending terlalu lama.
7. Replay command/tooling.
8. Correlation id.

---

### 19.7 Step 6 — Untuk Proses Panjang, Introduce Saga

Jika flow bukan sekadar publish event, tetapi proses lintas sistem dengan beberapa step dan compensation, introduce saga.

---

## 20. Testing Strategy

### 20.1 Unit Test Gateway Adapter

Test translation:

1. External success menjadi internal success.
2. External validation error menjadi rejected.
3. Timeout menjadi temporary failure.
4. Unknown code tidak dianggap success.
5. Sensitive error tidak bocor.

---

### 20.2 Outbox Transaction Test

Test invariant:

```text
Jika approval commit, outbox row ada.
Jika approval rollback, outbox row tidak ada.
```

Contoh skenario:

1. Approve valid application.
2. Verify application status approved.
3. Verify outbox event inserted.
4. Force exception after domain change before commit.
5. Verify no business change and no outbox event.

---

### 20.3 Publisher Test

Skenario:

1. Publish success marks event published.
2. Publish failure increments retry count.
3. Non-retryable error moves to dead letter.
4. Stuck publishing event recovered.
5. Batch respects limit.
6. Concurrent publishers do not publish same event excessively.

Catatan: Karena at-least-once tetap mungkin, test tidak boleh mengasumsikan publish hanya bisa terjadi sekali. Yang harus dijamin adalah downstream idempotent.

---

### 20.4 Inbox Consumer Test

Skenario:

1. First message processed.
2. Duplicate message skipped.
3. Crash before processed marker causes retry.
4. Business update and inbox marker atomic.
5. Same message id with different payload rejected/flagged.

---

### 20.5 Saga Test

Skenario:

1. Happy path completes.
2. Step temporary failure retries.
3. Step permanent failure triggers compensation.
4. Compensation failure retries.
5. Duplicate saga start returns existing saga.
6. Timeout moves saga to manual review.
7. Illegal state transition rejected.

---

### 20.6 Chaos/Failure Test

Simulasikan:

1. Broker down.
2. Consumer crash after DB update before ack.
3. Publisher crash after publish before mark published.
4. External API timeout after success.
5. Duplicate messages.
6. Out-of-order messages.
7. Slow DB.
8. DLQ replay.

Top engineer tidak hanya test happy path. Mereka test ambiguity window.

---

## 21. Observability and Operations

### 21.1 Metrics Penting

Outbox metrics:

```text
outbox.pending.count
outbox.oldest.pending.age.seconds
outbox.publish.success.count
outbox.publish.failure.count
outbox.deadletter.count
outbox.retry.count
outbox.publish.latency
```

Inbox metrics:

```text
inbox.processed.count
inbox.duplicate.count
inbox.failed.count
inbox.processing.latency
```

Saga metrics:

```text
saga.active.count
saga.completed.count
saga.failed.count
saga.compensating.count
saga.oldest.active.age.seconds
saga.step.failure.count
```

---

### 21.2 Logs

Log harus punya:

1. `correlationId`.
2. `causationId`.
3. `eventId`.
4. `aggregateId`.
5. `sagaId` jika ada.
6. `idempotencyKey` jika ada.
7. Step name.
8. Retry count.
9. Outcome.

Contoh structured log:

```json
{
  "message": "outbox_event_publish_failed",
  "eventId": "evt-123",
  "eventType": "application.approved",
  "aggregateId": "APP-001",
  "retryCount": 3,
  "nextRetryAt": "2026-06-18T10:20:00Z",
  "correlationId": "corr-999",
  "errorCategory": "TEMPORARY_REMOTE_FAILURE"
}
```

---

### 21.3 Runbook

Untuk setiap integration pattern, harus ada runbook:

1. Bagaimana melihat backlog outbox.
2. Bagaimana replay dead letter.
3. Bagaimana mem-pause publisher.
4. Bagaimana memverifikasi duplicate processing.
5. Bagaimana reconcile dengan external system.
6. Bagaimana memperbaiki stuck saga.
7. Bagaimana audit event chain.
8. Bagaimana menangani schema mismatch.

Pattern tanpa operational tooling hanya setengah desain.

---

## 22. Security and Compliance Angle

Integration pattern juga punya risiko security/compliance:

1. Event payload mungkin mengandung PII.
2. Outbox table menyimpan payload JSON sensitif.
3. DLQ bisa menjadi tempat bocornya data sensitif.
4. Log error dari external system bisa mengandung token/request body.
5. Replay tooling bisa disalahgunakan.
6. Idempotency key bisa memuat data sensitif jika dibuat asal.
7. Audit trail harus membedakan user action dan system action.
8. Compensation harus tercatat.

Prinsip:

```text
Payload minimal, masking jelas, access control ke outbox/DLQ/replay, dan audit untuk operasi administratif.
```

---

## 23. Performance Consideration

### 23.1 Outbox Table Growth

Outbox table bisa tumbuh cepat.

Strategi:

1. Index tepat.
2. Batch size terkendali.
3. Archive published events.
4. Partition by date jika volume besar.
5. Separate retention policy.
6. Avoid scanning CLOB payload for polling.
7. Keep status columns small and indexed.

---

### 23.2 Publisher Throughput

Throughput dipengaruhi:

1. Batch size.
2. Broker latency.
3. Serialization cost.
4. DB claim strategy.
5. Retry storm.
6. Payload size.
7. Network bandwidth.
8. External rate limit.

Virtual threads bisa membantu jika bottleneck I/O, tetapi tidak menggantikan rate limit dan backpressure.

---

### 23.3 Inbox Hotspot

Jika semua consumer menulis ke inbox table yang sama dengan high volume:

1. Index contention.
2. Insert hotspot.
3. Cleanup problem.
4. Large table degradation.

Solusi:

1. Partition inbox by time/source.
2. TTL/retention.
3. Use compact dedup if domain allows.
4. Keep payload out of inbox if not needed.
5. Use unique business constraint when better than generic inbox.

---

## 24. Design Review Checklist

Gunakan checklist ini saat review integrasi:

### Boundary

```text
[ ] Apakah external model tidak bocor ke domain?
[ ] Apakah gateway interface menyatakan intent, bukan protocol detail?
[ ] Apakah error eksternal diterjemahkan ke internal error/result yang jelas?
[ ] Apakah ownership data jelas?
```

### Consistency

```text
[ ] Apakah ada dual-write?
[ ] Jika ada event publish setelah DB update, apakah memakai outbox?
[ ] Apakah consumer idempotent?
[ ] Apakah dedup durable jika duplicate berdampak serius?
[ ] Apakah invariant bisnis didukung constraint storage?
```

### Failure

```text
[ ] Apa yang terjadi jika remote call timeout?
[ ] Apa yang terjadi jika remote call sukses tetapi response hilang?
[ ] Apa yang terjadi jika publisher crash setelah publish?
[ ] Apa yang terjadi jika consumer crash sebelum ack?
[ ] Apa yang terjadi jika message diproses dua kali?
[ ] Apa yang terjadi jika event out-of-order?
```

### Saga

```text
[ ] Apakah proses benar-benar butuh saga?
[ ] Apakah setiap step punya idempotency key?
[ ] Apakah compensation punya makna bisnis?
[ ] Apakah saga state persisted?
[ ] Apakah stuck saga bisa dipulihkan?
[ ] Apakah ada manual intervention path?
```

### Observability

```text
[ ] Apakah ada correlation id dan causation id?
[ ] Apakah backlog outbox terlihat?
[ ] Apakah DLQ punya alert?
[ ] Apakah retry storm bisa terdeteksi?
[ ] Apakah replay tercatat?
```

### Security

```text
[ ] Apakah payload event tidak membocorkan data sensitif?
[ ] Apakah DLQ/outbox access dibatasi?
[ ] Apakah replay tooling diaudit?
[ ] Apakah error log di-sanitize?
```

---

## 25. Common Staff-Level Discussion

### Pertanyaan 1 — “Kenapa tidak langsung publish Kafka dalam transaction?”

Jawaban matang:

```text
Karena database transaction dan broker publish bukan satu atomic unit. Jika DB commit sukses tetapi publish gagal, event hilang. Jika publish sukses tetapi DB rollback, event menjadi bohong. Outbox menyimpan intent publish dalam database yang sama dengan business state, sehingga local transaction tetap atomic. Publish dilakukan async dan consumer dibuat idempotent karena delivery minimal at-least-once.
```

---

### Pertanyaan 2 — “Apakah outbox menjamin event tidak pernah duplicate?”

Tidak. Outbox membantu mencegah event hilang akibat dual-write, tetapi duplicate publish tetap mungkin.

Contoh:

```text
Publisher berhasil publish event.
Publisher crash sebelum mark published.
Event tetap pending.
Publisher berikutnya publish lagi.
```

Karena itu consumer tetap harus idempotent.

---

### Pertanyaan 3 — “Kapan pakai saga?”

Gunakan saga ketika:

1. Proses melibatkan beberapa local transaction lintas boundary.
2. Tidak bisa memakai single DB transaction.
3. Business process long-running.
4. Ada step yang bisa gagal setelah step sebelumnya sukses.
5. Butuh retry/compensation/manual intervention.

Jangan pakai saga untuk flow sederhana yang sebenarnya cukup satu local transaction dan outbox event.

---

### Pertanyaan 4 — “Orchestration atau choreography?”

Untuk proses utama yang harus audit-able, regulated, dan banyak conditional path, orchestration sering lebih jelas. Untuk side-effect independen seperti projection, notification, cache update, choreography bisa lebih ringan.

Tidak harus memilih satu untuk semua. Banyak sistem sehat memakai kombinasi.

---

### Pertanyaan 5 — “Bagaimana menangani duplicate email?”

Email adalah side effect yang sulit di-undo. Gunakan:

1. Notification idempotency key.
2. Unique notification record.
3. Send only if record not sent.
4. Store provider message id.
5. If duplicate request arrives, return existing sent record.
6. Jika salah kirim, compensation adalah correction email, bukan unsend.

---

## 26. Case Study: Approval Integration

### 26.1 Requirement

Ketika application approved:

1. Application status berubah.
2. License dibuat.
3. Event `ApplicationApproved` dipublish.
4. Registry eksternal diberi tahu.
5. Email dikirim.
6. Audit lengkap.
7. Duplicate approval tidak boleh membuat license ganda.
8. Jika registry down, approval tetap tersimpan dan retry dilakukan.

---

### 26.2 Design

Local transaction:

```text
approve application
create license with unique application_id
insert audit trail
insert outbox ApplicationApproved
commit
```

Async consumers:

```text
License projection consumer uses inbox.
Registry notification worker consumes outbox/integration command with idempotency key.
Email notification uses notification table unique by template + business key.
```

---

### 26.3 Invariants

```text
Invariant 1: Application cannot move from APPROVED back to PENDING without explicit amendment/reopen process.
Invariant 2: One application has at most one active license.
Invariant 3: Every approved application must eventually have ApplicationApproved outbox event.
Invariant 4: Registry notification may retry, but same approval event must not create multiple registry records.
Invariant 5: Email may retry, but notification key prevents duplicate successful sends.
Invariant 6: Every compensation is recorded as a new auditable business action.
```

---

### 26.4 Package Structure

```text
application-approval/
  domain/
    Application.java
    ApplicationStatus.java
    ApplicationApproved.java
    License.java
    LicenseId.java
  application/
    ApproveApplicationCommand.java
    ApproveApplicationService.java
    ApprovalResult.java
  integration/
    outbox/
      OutboxEvent.java
      OutboxRepository.java
      OutboxPublisherJob.java
    inbox/
      InboxMessage.java
      InboxRepository.java
    registry/
      LicenseRegistryGateway.java
      RegistryNotificationResult.java
  infrastructure/
    persistence/
      JpaApplicationRepository.java
      JdbcOutboxRepository.java
      JdbcInboxRepository.java
    messaging/
      KafkaMessagePublisher.java
    registry/
      HttpLicenseRegistryGateway.java
      RegistryRequestMapper.java
      RegistryErrorTranslator.java
```

---

## 27. Summary

Integration design adalah salah satu area yang membedakan engineer menengah dan engineer senior/staff. Engineer menengah sering berpikir:

```text
Saya update database lalu publish event.
```

Engineer yang lebih matang bertanya:

```text
Apa yang terjadi jika hanya salah satu berhasil?
Apa yang terjadi jika message duplicate?
Apa yang terjadi jika response timeout tapi operasi eksternal sebenarnya sukses?
Apa invariant bisnis yang harus tetap benar?
Bagaimana sistem akan direkonsiliasi?
Bagaimana failure terlihat oleh operator?
Bagaimana compensation dilakukan secara legal dan auditable?
```

Gateway dan Adapter melindungi semantic boundary. Outbox melindungi local transaction dari dual-write. Inbox dan idempotency melindungi consumer dari duplicate delivery. Saga mengelola long-running process lintas service. Compensation menggantikan fantasi rollback teknis dengan aksi bisnis eksplisit. Observability dan runbook memastikan pattern ini bisa dioperasikan, bukan hanya terlihat bagus di diagram.

Prinsip akhirnya:

```text
Dalam distributed integration, jangan mengejar ilusi “tidak pernah gagal”.
Rancang sistem supaya ketika gagal sebagian, duplicate, timeout, retry, dan delay terjadi, invariant bisnis tetap benar dan recovery path tetap jelas.
```

---

## 28. Latihan

### Latihan 1 — Identifikasi Dual Write

Cari satu use case di codebase yang melakukan:

```text
DB update + publish event / call remote API / send email
```

Jawab:

1. Apa resource pertama?
2. Apa resource kedua?
3. Apa yang terjadi jika resource pertama sukses dan kedua gagal?
4. Apa yang terjadi jika kedua sukses tetapi app crash sebelum mencatat sukses?
5. Apakah butuh outbox?

---

### Latihan 2 — Desain Idempotency Key

Untuk operasi berikut, desain idempotency key:

1. Approve application.
2. Issue license.
3. Send approval email.
4. Notify external registry.
5. Consume `ApplicationApproved` event.

Pastikan key tidak mengandung PII dan bisa dipakai untuk dedup durable.

---

### Latihan 3 — Saga Decision

Ambil proses bisnis yang melibatkan minimal tiga sistem. Tentukan:

1. Apakah cukup outbox/inbox?
2. Apakah butuh saga?
3. Apakah orchestration atau choreography lebih cocok?
4. Apa compensation untuk setiap step?
5. Apa step yang tidak bisa di-compensate?
6. Apa manual intervention path?

---

## 29. Design Heuristic

Gunakan heuristic ini:

```text
Jika hanya perlu memberi tahu sistem lain setelah local state berubah,
gunakan Outbox + idempotent consumer.

Jika consumer bisa menerima duplicate,
gunakan Inbox atau domain-level unique constraint.

Jika request bisa di-retry oleh client,
gunakan Idempotency Key.

Jika proses melibatkan beberapa local transaction dengan failure/compensation,
gunakan Saga.

Jika external model berbeda secara semantic,
gunakan Gateway + Adapter + Anti-Corruption Layer.

Jika operasi tidak bisa diulang dengan aman,
desain ulang sampai retry aman atau buat manual recovery eksplisit.
```

---

## 30. Penutup

Part ini menutup jembatan antara behavioral/application pattern dan architecture/distributed-system pattern. Setelah memahami integration pattern, kita bisa masuk ke area yang juga sangat kritis: security design pattern dan anti-pattern.

Security bukan dekorasi setelah sistem jadi. Security adalah boundary, policy, context, audit, capability, dan failure mode yang harus didesain sejak awal.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./24-resilience-retry-timeout-circuit-breaker-bulkhead-fallback.md">⬅️ Resilience Pattern: Retry, Timeout, Circuit Breaker, Bulkhead, Fallback</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./26-security-design-patterns-authz-context-policy-boundary.md">Security Design Patterns: Authorization Context, Policy Boundary, Capability, and Auditability ➡️</a>
</div>
