# Part 10 — S3 as Integration Boundary, Archive, and Event Source

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-10-s3-as-integration-boundary-archive-and-event-source.md`  
Target Java: 8–25  
Primary SDK: AWS SDK for Java 2.x

---

## 0. Posisi Bagian Ini Dalam Seri

Pada Part 8 kita memandang S3 sebagai **object storage**: bucket, object key, metadata, encryption, consistency, lifecycle, access control, dan model biaya. Pada Part 9 kita naik ke sisi **high-throughput Java implementation**: streaming, multipart upload, download besar, Transfer Manager, checksum, retry, cleanup, dan memory pressure.

Bagian ini berbeda.

Di Part 10, S3 tidak lagi dilihat hanya sebagai tempat menyimpan file. S3 akan dipandang sebagai:

1. **Integration boundary** antar sistem.
2. **Durable landing zone** untuk data mentah.
3. **Archive layer** untuk evidence, audit, export, dan regulatory retention.
4. **Event source** untuk workflow asynchronous.
5. **Recovery surface** ketika downstream gagal.
6. **Governance boundary** untuk access, immutability, retention, dan lineage.

Mental model utamanya:

> S3 object bukan hanya blob. Dalam sistem enterprise, object adalah fakta yang tahan lama, punya identitas, metadata, lifecycle, policy, dan konsekuensi operasional.

Kalau Java service hanya memperlakukan S3 sebagai `putObject()` dan `getObject()`, sistem akan terlihat bekerja saat happy path, tetapi rapuh saat terjadi duplicate event, partial processing, object overwrite, missing metadata, lifecycle conflict, access drift, replay, atau audit request.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Mendesain S3 bucket sebagai boundary antar service, bukan shared folder sembarangan.
2. Membuat struktur object key yang stabil, scalable, traceable, dan cocok untuk processing pipeline.
3. Memahami pola landing, staging, quarantine, processed, failed, dan archive zone.
4. Mendesain S3 event-driven workflow yang tahan duplicate event, out-of-order event, dan retry.
5. Menggunakan S3 event notifications ke SQS/SNS/Lambda/EventBridge dengan konsekuensi yang benar.
6. Mendesain idempotency untuk object processing.
7. Menentukan kapan metadata, tag, object key, database row, atau manifest file dipakai sebagai source of truth.
8. Mendesain archive dan retention dengan S3 Lifecycle, Object Lock, legal hold, versioning, dan KMS.
9. Membuat operational playbook untuk replay, reprocess, quarantine, delete, restore, dan audit.
10. Menilai trade-off S3 sebagai integration boundary dibanding API synchronous, message broker, database, dan event bus.

---

## 2. S3 Sebagai Integration Boundary

### 2.1 Apa Itu Integration Boundary?

Integration boundary adalah batas di mana dua sistem berinteraksi tanpa harus berbagi runtime, memory, deployment, transaction, atau database internal.

Contoh:

```text
External System / User / Partner
        |
        | upload file / export file / evidence document
        v
      S3 Bucket
        |
        | event / polling / batch scan
        v
Java Processing Service / Lambda / Worker
```

S3 menjadi boundary karena:

- Producer hanya perlu menulis object.
- Consumer bisa memproses secara asynchronous.
- Object bertahan walaupun consumer down.
- Processing bisa diulang dari object yang sama.
- Object bisa diaudit, dienkripsi, diberi retention, dan dilifecycle.
- Data besar tidak perlu lewat message body.

Ini cocok untuk:

- file upload,
- document processing,
- regulatory evidence,
- data ingestion,
- batch import/export,
- report archive,
- data lake landing,
- inter-agency file exchange,
- asynchronous validation,
- virus scanning pipeline,
- ML/analytics input,
- large payload handoff.

### 2.2 S3 Bukan Queue

Walaupun S3 bisa menghasilkan event, S3 sendiri bukan queue.

S3 tidak memberi:

- consumer group semantics,
- visibility timeout,
- explicit acknowledgement,
- retry queue semantics,
- per-message dead-letter queue,
- strict ordering,
- backpressure contract,
- automatic consumer offset.

Jadi pola yang sehat biasanya:

```text
S3 object created
        |
        v
S3 Event Notification
        |
        v
SQS Queue
        |
        v
Java Worker / Lambda Consumer
```

Bukan:

```text
S3 object created
        |
        v
Lambda directly does everything with no idempotency, no DLQ, no replay model
```

Direct S3 → Lambda bisa valid untuk workload sederhana, tetapi untuk production workflow besar, SQS sering lebih aman karena menyediakan buffering, retry control, DLQ, visibility timeout, dan consumer scaling control.

### 2.3 S3 Bukan Database

S3 punya strong read-after-write consistency untuk PUT/DELETE object dan list operation di semua region AWS modern, tetapi itu tidak menjadikan S3 database relasional atau transactional store.

S3 tidak memberi:

- multi-object transaction,
- relational constraint,
- foreign key,
- secondary index fleksibel,
- row-level update,
- query predicate,
- transaction isolation,
- compare-and-set umum seperti database,
- business invariant enforcement lintas object.

S3 bisa menjadi source of truth untuk **object bytes**, tetapi metadata bisnis kompleks biasanya tetap perlu database.

Contoh desain sehat:

```text
S3:
  stores raw document bytes

Database:
  stores document record, owner, status, workflow state, checksum, S3 key, version id, validation result
```

Contoh desain berbahaya:

```text
S3 key naming convention menjadi satu-satunya source of truth untuk status bisnis,
tanpa database, tanpa idempotency table, tanpa audit state.
```

---

## 3. Mental Model: Object Sebagai Fakta Durable

Dalam sistem enterprise, setiap object penting harus diperlakukan sebagai fakta.

Sebuah object memiliki beberapa layer identitas:

```text
Business identity:
  caseId, applicationId, submissionId, documentType, agencyCode

Storage identity:
  bucket, key, versionId, etag, checksum, size, lastModified

Processing identity:
  pipelineRunId, attemptId, eventId, idempotencyKey, processedAt

Security identity:
  owner, uploaderPrincipal, kmsKeyId, encryptionContext, access policy

Governance identity:
  retentionClass, retentionUntil, legalHold, lifecycleClass, archiveReason
```

Top 1% engineer tidak berhenti di pertanyaan “file-nya ada di bucket mana?” tetapi bertanya:

- Object ini merepresentasikan fakta apa?
- Siapa yang berhak membuat, membaca, mengubah, menghapus?
- Apakah object boleh overwrite?
- Apakah object harus immutable?
- Apakah object bisa diproses ulang?
- Apakah event dari object ini bisa duplicate?
- Kalau downstream gagal, bagaimana recovery?
- Kalau audit meminta bukti 2 tahun kemudian, apa yang bisa ditunjukkan?
- Kalau object dipindah storage class, apakah aplikasi masih bisa membacanya?
- Kalau KMS key berubah/disabled, apa dampaknya?

---

## 4. Pola Zona Dalam Bucket

### 4.1 Kenapa Perlu Zona?

Tanpa zona, bucket akan menjadi dump folder:

```text
s3://app-bucket/file1.pdf
s3://app-bucket/new/file2.pdf
s3://app-bucket/test-final-final-v2.csv
s3://app-bucket/processed-old/abc.csv
```

Ini buruk karena:

- status tidak jelas,
- lifecycle sulit,
- permission sulit,
- event filter sulit,
- audit sulit,
- reprocess berisiko,
- cleanup berbahaya.

Zona membuat object lifecycle eksplisit.

### 4.2 Zona Umum

Contoh struktur:

```text
s3://case-documents-prod/
  landing/
  staging/
  quarantine/
  processed/
  failed/
  archive/
  manifests/
  reports/
  temp/
```

Makna setiap zona:

| Zone | Fungsi | Boleh Diproses? | Retention | Catatan |
|---|---:|---:|---:|---|
| `landing/` | object pertama kali masuk | ya | pendek/menengah | raw input, jangan dimodifikasi |
| `staging/` | intermediate processing | terbatas | pendek | hasil sementara |
| `quarantine/` | object bermasalah/berbahaya | tidak otomatis | menengah/panjang | butuh review |
| `processed/` | object yang sudah valid | ya/readonly | sesuai bisnis | bisa jadi canonical output |
| `failed/` | gagal proses non-security | manual/retry | menengah | untuk triage |
| `archive/` | record jangka panjang | readonly | panjang | lifecycle ke Glacier/Deep Archive |
| `manifests/` | manifest batch | ya | panjang | source of batch completeness |
| `reports/` | export/report output | download | sesuai SLA | bisa punya TTL |
| `temp/` | scratch object | tidak | sangat pendek | lifecycle agresif |

### 4.3 Zone Transition Bukan Rename Murah

Di S3, “move” object biasanya berarti copy ke key baru lalu delete key lama. Ini bukan operasi rename atomic seperti filesystem.

Implikasi:

- Move large object mahal dan butuh waktu.
- Bisa terjadi partial state: copy sukses delete gagal, atau sebaliknya tergantung implementasi.
- Event bisa muncul untuk copy dan delete.
- Versioning bisa membuat object lama tetap ada.
- KMS permission perlu valid untuk source dan destination.

Karena itu, jangan terlalu sering memindahkan object besar antar prefix hanya untuk menandai status. Untuk status bisnis, database lebih cocok.

Pola yang lebih baik:

```text
S3 key tetap immutable:
  landing/case/2026/06/19/case-123/doc-456/original.pdf

Database status berubah:
  UPLOADED -> VALIDATED -> PROCESSED -> ARCHIVED
```

Atau jika butuh output canonical:

```text
Input immutable:
  landing/...

Output baru:
  processed/...

Database menghubungkan input -> output.
```

---

## 5. Object Key Design Untuk Integration Pipeline

### 5.1 Prinsip Object Key

Object key harus memenuhi beberapa tujuan sekaligus:

1. Unik.
2. Stabil.
3. Dapat diaudit.
4. Mudah difilter event.
5. Tidak bocor data sensitif.
6. Tidak tergantung nama file user secara mentah.
7. Cocok untuk lifecycle rule.
8. Cocok untuk batch listing/reprocessing.
9. Tidak menyebabkan coupling berlebihan ke domain internal.

### 5.2 Contoh Key Buruk

```text
uploads/KTP Fajar terbaru.pdf
uploads/final.pdf
case-123.pdf
user/John Doe/passport.pdf
```

Masalah:

- nama bisa collide,
- mengandung PII,
- sulit dipartisi,
- tidak jelas environment,
- tidak jelas source,
- tidak jelas tanggal,
- tidak jelas document ID,
- susah replay batch,
- susah lifecycle.

### 5.3 Contoh Key Lebih Baik

```text
landing/source=portal/year=2026/month=06/day=19/caseId=CASE-123/documentId=DOC-456/original.bin
```

Atau lebih pendek dan aman:

```text
landing/portal/2026/06/19/CASE-123/DOC-456/original.bin
```

Untuk menghindari PII:

```text
landing/portal/2026/06/19/case-7f3a1d/doc-83be2a/original.pdf
```

### 5.4 Partition-Like Key Style

Untuk data lake / analytics integration, style berikut umum:

```text
dataset=applications/source=portal/year=2026/month=06/day=19/hour=13/part-00001.parquet
```

Kelebihan:

- cocok untuk Athena/Glue/Hive-style partitioning,
- mudah lifecycle per dataset/source/date,
- mudah reprocess per tanggal,
- mudah audit volume harian.

Kekurangan:

- verbose,
- jika dipakai untuk operational object kecil bisa terlalu berat,
- key mengandung metadata yang mungkin berubah.

### 5.5 Key Tidak Boleh Menjadi Satu-Satunya Metadata

Key boleh mengandung metadata yang stabil, tetapi jangan jadikan key sebagai satu-satunya sumber kebenaran untuk metadata bisnis.

Contoh metadata yang relatif aman di key:

- environment,
- source system,
- date partition,
- document ID,
- batch ID,
- object category.

Contoh metadata yang sebaiknya tidak hanya di key:

- approval status,
- officer assignment,
- risk level,
- workflow state,
- user-visible file name,
- retention decision,
- personally sensitive detail.

---

## 6. Metadata, Tags, Database, dan Manifest

### 6.1 Empat Tempat Menaruh Informasi

Dalam S3 pipeline, informasi tentang object bisa berada di empat tempat:

1. **Object key**
2. **Object metadata**
3. **Object tags**
4. **External database / manifest**

Masing-masing punya fungsi berbeda.

### 6.2 Object Key

Cocok untuk:

- routing kasar,
- lifecycle prefix,
- event filter prefix/suffix,
- partitioning,
- human operational browsing.

Tidak cocok untuk:

- metadata yang sering berubah,
- field panjang,
- field sensitif,
- status dinamis.

### 6.3 Object Metadata

Object metadata cocok untuk informasi yang melekat saat upload:

```text
x-amz-meta-correlation-id
x-amz-meta-source-system
x-amz-meta-uploaded-by
x-amz-meta-original-filename-hash
x-amz-meta-content-sha256
```

Namun metadata punya batasan penting:

- User-defined metadata ditetapkan saat object dibuat.
- Untuk mengubah metadata, biasanya perlu copy object ke dirinya sendiri dengan metadata baru.
- Metadata ikut dibaca saat HeadObject/GetObject.
- Jangan simpan secret/PII sensitif sembarangan.

### 6.4 Object Tags

Object tags cocok untuk:

- lifecycle rule,
- cost allocation,
- classification,
- retention class,
- processing label ringan.

Contoh:

```text
classification=confidential
retention=7y
pipeline=case-document-ingestion
source=portal
```

Tetapi tags juga bukan database. Jangan bergantung pada tags sebagai satu-satunya workflow state jika invariant bisnis penting.

### 6.5 Database Record

Database cocok untuk:

- workflow state,
- ownership,
- authorization,
- processing status,
- attempt count,
- validation result,
- error detail,
- audit relation,
- relation antar object.

Contoh tabel:

```sql
CREATE TABLE document_object (
  id                  VARCHAR(64) PRIMARY KEY,
  case_id             VARCHAR(64) NOT NULL,
  bucket              VARCHAR(255) NOT NULL,
  object_key          VARCHAR(1024) NOT NULL,
  version_id          VARCHAR(255),
  etag                VARCHAR(255),
  checksum_sha256     VARCHAR(128),
  size_bytes          BIGINT NOT NULL,
  content_type        VARCHAR(255),
  status              VARCHAR(32) NOT NULL,
  source_system       VARCHAR(64) NOT NULL,
  uploaded_at         TIMESTAMP NOT NULL,
  processed_at        TIMESTAMP,
  created_by          VARCHAR(128),
  correlation_id      VARCHAR(128),
  UNIQUE(bucket, object_key, version_id)
);
```

### 6.6 Manifest File

Manifest cocok untuk batch completeness.

Contoh manifest:

```json
{
  "batchId": "BATCH-20260619-001",
  "sourceSystem": "agency-x",
  "createdAt": "2026-06-19T08:15:00Z",
  "expectedObjects": [
    {
      "key": "landing/agency-x/2026/06/19/BATCH-20260619-001/part-00001.csv",
      "sha256": "...",
      "sizeBytes": 10485760
    },
    {
      "key": "landing/agency-x/2026/06/19/BATCH-20260619-001/part-00002.csv",
      "sha256": "...",
      "sizeBytes": 9437184
    }
  ]
}
```

Manifest berguna ketika:

- batch terdiri dari banyak file,
- processing baru boleh mulai setelah semua file masuk,
- perlu validasi checksum,
- perlu replay batch,
- perlu audit completeness.

---

## 7. S3 Event Notifications

### 7.1 Apa Yang Bisa Menjadi Event?

S3 dapat mengirim notification ketika event tertentu terjadi di bucket, misalnya object created, object removed, restore completed, replication, lifecycle, object tagging, ACL, dan lain-lain tergantung konfigurasi.

Destination umum:

```text
S3 Event Notification -> SNS
S3 Event Notification -> SQS
S3 Event Notification -> Lambda
S3 Event Notification -> EventBridge
```

Pilihan destination bukan sekadar teknis, tetapi arsitektural.

### 7.2 S3 → Lambda

Pola:

```text
S3 ObjectCreated
      |
      v
Lambda handler
```

Cocok untuk:

- processing sederhana,
- volume rendah/menengah,
- transform cepat,
- tidak butuh queue control kompleks,
- failure dapat ditangani dengan retry Lambda/DLQ/destination sesuai konfigurasi.

Risiko:

- burst object dapat menekan concurrency Lambda,
- retry semantics tersembunyi,
- sulit mengontrol backpressure,
- idempotency sering dilupakan,
- object besar bisa membuat timeout,
- downstream throttling dapat memperburuk retry storm.

### 7.3 S3 → SQS → Worker/Lambda

Pola:

```text
S3 ObjectCreated
      |
      v
SQS Queue
      |
      v
Java Worker / Lambda SQS Consumer
```

Cocok untuk:

- production-grade processing,
- butuh DLQ,
- butuh buffering,
- butuh visibility timeout,
- butuh controlled concurrency,
- downstream rate-limited,
- processing bisa lama,
- replay penting.

Ini sering menjadi default pilihan yang lebih aman.

### 7.4 S3 → SNS → Multiple SQS Subscribers

Pola:

```text
S3 ObjectCreated
      |
      v
SNS Topic
   /    |    \
  v     v     v
SQS A SQS B SQS C
```

Cocok untuk fan-out:

- virus scanner,
- metadata extractor,
- audit recorder,
- thumbnail generator,
- downstream data lake registrar.

Risiko:

- event contract harus stabil,
- filter policy harus jelas,
- setiap subscriber harus idempotent,
- retry/DLQ per subscriber perlu dirancang.

### 7.5 S3 → EventBridge

Pola:

```text
S3 Event
  |
  v
EventBridge Bus
  |
  +--> Rule A -> Lambda
  +--> Rule B -> Step Functions
  +--> Rule C -> SQS
```

Cocok untuk:

- routing kompleks,
- event governance,
- archive/replay event,
- cross-account event routing,
- integration dengan banyak target,
- pattern matching yang lebih ekspresif.

Trade-off:

- menambah komponen,
- biaya tambahan,
- latency tambahan,
- perlu governance event schema.

---

## 8. Event Payload: Jangan Percaya Terlalu Banyak

S3 event berisi informasi seperti bucket, object key, size, eTag, eventName, eventTime, request ID, dan sequencer untuk event tertentu. Tetapi event bukan pengganti validasi object.

Saat menerima event, consumer sebaiknya melakukan:

1. Decode object key dengan benar.
2. `HeadObject` untuk membaca metadata aktual.
3. Validasi size, content type, checksum/etag sesuai kebutuhan.
4. Cek database/idempotency store.
5. Baru proses object.

Jangan langsung percaya bahwa:

- event pasti hanya datang sekali,
- event selalu datang berurutan,
- object masih ada,
- object belum dioverwrite,
- object key aman,
- eTag selalu MD5,
- content type benar,
- metadata lengkap.

### 8.1 Contoh Handler Flow

```text
receive event
  -> parse bucket/key/versionId/eTag/sequencer
  -> normalize and validate key
  -> head object
  -> build idempotency key
  -> acquire processing lock / insert processing record
  -> process stream
  -> write result
  -> update status
  -> acknowledge message
```

Jika `HeadObject` gagal 404:

- object mungkin dihapus,
- event terlambat,
- key decode salah,
- versioning behavior belum dipahami,
- permission tidak cukup dan muncul sebagai AccessDenied tergantung policy.

---

## 9. Duplicate Event, Out-of-Order Event, dan Idempotency

### 9.1 Kenapa Duplicate Bisa Terjadi?

Dalam distributed system, event delivery sering at-least-once. S3 event notification dapat menghasilkan event yang perlu dianggap duplicate-safe. AWS juga menyediakan `sequencer` pada event object tertentu untuk membantu menentukan urutan relatif event pada object yang sama.

Prinsipnya:

> S3 event handler harus idempotent. Bukan “sebaiknya”. Harus.

### 9.2 Idempotency Key

Idempotency key harus merepresentasikan event/object version yang sedang diproses.

Kandidat:

```text
bucket + key + versionId
bucket + key + eTag
bucket + key + sequencer
businessDocumentId + checksum
```

Pilihan tergantung versioning dan overwrite policy.

Jika bucket versioning aktif:

```text
idempotencyKey = bucket + ":" + key + ":" + versionId
```

Jika versioning tidak aktif dan object immutable by convention:

```text
idempotencyKey = bucket + ":" + key + ":" + eTag
```

Jika eTag tidak reliable sebagai checksum karena multipart/SSE:

```text
idempotencyKey = bucket + ":" + key + ":" + metadata.contentSha256
```

### 9.3 Idempotency Table

Contoh tabel:

```sql
CREATE TABLE s3_processing_event (
  idempotency_key     VARCHAR(1024) PRIMARY KEY,
  bucket              VARCHAR(255) NOT NULL,
  object_key          VARCHAR(1024) NOT NULL,
  version_id          VARCHAR(255),
  etag                VARCHAR(255),
  sequencer           VARCHAR(128),
  status              VARCHAR(32) NOT NULL,
  first_seen_at       TIMESTAMP NOT NULL,
  last_seen_at        TIMESTAMP NOT NULL,
  attempt_count       INT NOT NULL,
  last_error_code     VARCHAR(128),
  last_error_message  VARCHAR(2048)
);
```

Status:

```text
RECEIVED
PROCESSING
PROCESSED
FAILED_RETRYABLE
FAILED_PERMANENT
QUARANTINED
SKIPPED_DUPLICATE
```

### 9.4 Insert-First Pattern

Pola idempotency yang aman:

```sql
INSERT INTO s3_processing_event(idempotency_key, status, first_seen_at, last_seen_at, attempt_count)
VALUES (?, 'PROCESSING', now(), now(), 1);
```

Jika insert gagal karena duplicate key:

- baca record existing,
- jika `PROCESSED`, skip,
- jika `PROCESSING` terlalu lama, lakukan stale recovery,
- jika `FAILED_RETRYABLE`, boleh retry dengan lock,
- jika `FAILED_PERMANENT`, jangan loop tanpa keputusan manual.

### 9.5 Out-of-Order Handling

Untuk object yang sama, event dapat datang dalam urutan yang tidak diharapkan. Misalnya:

```text
ObjectCreated v1
ObjectCreated v2
ObjectRemoved v2
```

Consumer menerima:

```text
ObjectRemoved v2
ObjectCreated v1
ObjectCreated v2
```

Kalau handler buta urutan, status bisa salah.

Strategi:

1. Aktifkan versioning untuk object penting.
2. Simpan `versionId` dan/atau `sequencer`.
3. Untuk key yang bisa di-overwrite, process hanya versi terbaru yang masih valid.
4. Untuk immutable key, larang overwrite melalui design/IAM/policy.
5. Gunakan database state transition monotonic.

Contoh monotonic transition:

```text
UPLOADED -> VALIDATING -> VALIDATED -> PROCESSING -> PROCESSED -> ARCHIVED
```

Jangan izinkan event lama mengubah status baru menjadi status lama.

---

## 10. Java Consumer Design Untuk S3 Event via SQS

### 10.1 Struktur Komponen

```text
SqsPoller
  -> S3EventParser
  -> ObjectIdentityNormalizer
  -> ObjectMetadataLoader
  -> IdempotencyService
  -> ObjectProcessor
  -> ProcessingResultWriter
  -> AuditPublisher
```

Setiap komponen punya tanggung jawab sempit.

### 10.2 Pseudocode Handler

```java
public final class S3ObjectEventProcessor {

    private final S3Client s3;
    private final ProcessingRepository repository;
    private final ObjectProcessor processor;
    private final AuditPublisher auditPublisher;

    public ProcessingDecision handle(S3ObjectEvent event) {
        ObjectIdentity identity = ObjectIdentity.from(event);

        HeadObjectResponse head = s3.headObject(b -> b
            .bucket(identity.bucket())
            .key(identity.key())
            .versionId(identity.versionId().orElse(null))
        );

        IdempotencyKey key = IdempotencyKey.from(identity, head);

        ProcessingClaim claim = repository.tryClaim(key, identity, head);

        if (claim.isAlreadyProcessed()) {
            return ProcessingDecision.ackDuplicate();
        }

        if (claim.isCurrentlyProcessing()) {
            return ProcessingDecision.retryLater();
        }

        try (ResponseInputStream<GetObjectResponse> input = s3.getObject(b -> b
            .bucket(identity.bucket())
            .key(identity.key())
            .versionId(identity.versionId().orElse(null))
        )) {
            ProcessingResult result = processor.process(identity, head, input);
            repository.markProcessed(key, result);
            auditPublisher.publishProcessed(identity, result);
            return ProcessingDecision.ackSuccess();
        } catch (PermanentObjectException e) {
            repository.markPermanentFailure(key, e);
            auditPublisher.publishPermanentFailure(identity, e);
            return ProcessingDecision.ackPermanentFailure();
        } catch (Exception e) {
            repository.markRetryableFailure(key, e);
            return ProcessingDecision.retry();
        }
    }
}
```

Catatan:

- `ackPermanentFailure()` bukan berarti error diabaikan. Artinya message tidak terus-menerus diproses ulang tanpa guna; statusnya dipindah ke failure/quarantine path.
- Retryable failure harus dibiarkan kembali ke SQS sesuai visibility timeout atau dilempar exception tergantung framework.
- Permanent failure harus menghasilkan audit dan triage signal.

### 10.3 Jangan Delete Message Sebelum State Aman

Urutan yang benar:

```text
process object
  -> persist result/status
  -> publish audit/side effect yang perlu
  -> baru ack/delete SQS message
```

Jika message dihapus dulu, lalu database update gagal, event hilang.

Jika database update dulu, lalu delete message gagal, event akan muncul lagi tetapi bisa diskip oleh idempotency.

Ini pola yang benar dalam at-least-once system.

---

## 11. Landing Zone Pattern

### 11.1 Fungsi Landing Zone

Landing zone adalah tempat object pertama kali diterima sebelum validasi penuh.

```text
producer -> s3://bucket/landing/... -> validation pipeline
```

Landing zone harus dianggap:

- untrusted,
- raw,
- immutable,
- belum business-valid,
- belum aman untuk downstream.

### 11.2 Validasi Landing Object

Validasi minimal:

1. Key sesuai pattern.
2. Size tidak nol dan tidak melebihi limit.
3. Content type diterima.
4. Extension tidak menjadi satu-satunya validasi.
5. Checksum valid jika disediakan.
6. Metadata wajib ada.
7. Object encryption sesuai policy.
8. Uploader principal valid.
9. Object bukan overwrite ilegal.
10. Malware scan jika file user upload.

### 11.3 Landing Object Tidak Boleh Langsung Dipakai

Anti-pattern:

```text
User uploads PDF to landing/
  -> event
  -> immediately visible to officer/downloadable
```

Lebih aman:

```text
User uploads PDF to landing/
  -> validate
  -> scan
  -> extract metadata
  -> mark VALIDATED in DB
  -> make available through application authorization layer
```

S3 permission tidak boleh menggantikan authorization aplikasi.

---

## 12. Quarantine Pattern

### 12.1 Kapan Object Masuk Quarantine?

Object masuk quarantine jika:

- malware scan suspicious,
- checksum mismatch,
- content type mismatch,
- file corrupt,
- object terlalu besar,
- schema invalid,
- metadata wajib hilang,
- source tidak dikenal,
- decryption/access anomaly,
- policy violation,
- duplicate berbahaya,
- manual hold diperlukan.

### 12.2 Quarantine Bukan Sekadar Folder

Quarantine harus punya:

- restricted access,
- no automatic downstream processing,
- audit trail,
- reason code,
- reviewer workflow,
- retention rule,
- safe deletion/release procedure.

Contoh metadata database:

```text
status = QUARANTINED
reason = MALWARE_SCAN_FAILED
quarantinedAt = ...
quarantinedBy = system
reviewRequired = true
```

### 12.3 Jangan Memindahkan Object Berbahaya Sembarangan

Untuk file berbahaya, copy/move bisa membuat event baru dan memperluas risiko. Sering lebih aman:

- biarkan object di key immutable,
- ubah status database menjadi quarantined,
- tambahkan tag `quarantine=true`,
- pastikan policy mencegah read umum,
- disable automatic processing untuk prefix/tag tersebut.

---

## 13. Archive Pattern

### 13.1 Archive Untuk Apa?

Archive bukan tempat sampah. Archive adalah penyimpanan jangka panjang untuk object yang masih memiliki nilai hukum, audit, bisnis, atau recovery.

Contoh:

- submitted documents,
- official correspondence,
- generated reports,
- evidence files,
- signed forms,
- raw import batch,
- final export to agency,
- reconciliation file,
- audit bundle.

### 13.2 Archive Invariant

Archive object biasanya harus memenuhi invariant:

```text
1. immutable or append-only
2. encrypted
3. access restricted
4. retention known
5. lifecycle known
6. traceable to business record
7. restorable if moved to archive storage class
8. deletion requires controlled procedure
```

### 13.3 Object Lock

S3 Object Lock dapat digunakan untuk mencegah object version dihapus atau dioverwrite selama retention period atau legal hold. Legal hold tidak punya durasi tetap dan tetap aktif sampai dilepas oleh principal yang berwenang.

Mode umum:

- Governance mode
- Compliance mode
- Legal hold

Mental model:

```text
Versioning + Object Lock = stronger immutability boundary
```

Tetapi Object Lock harus direncanakan dari awal karena ada konfigurasi bucket-level yang perlu disiapkan. Jangan menganggap Object Lock bisa ditambahkan sembarangan di akhir tanpa implikasi.

### 13.4 Lifecycle ke Storage Class Lebih Dingin

S3 Lifecycle bisa mentransisikan object ke storage class lain untuk optimasi biaya.

Contoh lifecycle konseptual:

```text
0-30 days: S3 Standard
31-180 days: S3 Standard-IA / Intelligent-Tiering
181-2555 days: Glacier Flexible Retrieval / Deep Archive
After retention: expire/delete if legally allowed
```

Namun lifecycle harus mengikuti access pattern.

Kesalahan umum:

- object sering diakses dipindah terlalu cepat ke cold storage,
- aplikasi tidak siap restore delay,
- cost retrieval tidak dihitung,
- lifecycle menghapus object yang masih punya kewajiban retention,
- lifecycle rule terlalu broad karena prefix buruk.

---

## 14. Processed Zone dan Output Object

### 14.1 Output Sebagai Object Baru

Jika processing menghasilkan file baru, jangan overwrite input.

```text
landing/.../original.pdf
processed/.../normalized.pdf
processed/.../metadata.json
processed/.../thumbnail.png
```

Manfaat:

- input tetap sebagai evidence,
- output bisa diregenerate,
- audit lineage jelas,
- checksum input/output bisa dibandingkan,
- failure recovery lebih mudah.

### 14.2 Lineage Record

Simpan hubungan:

```text
inputObjectId -> outputObjectId
processorVersion
processedAt
processingConfigHash
resultChecksum
```

Ini penting untuk menjawab:

- output dibuat dari input mana?
- kode versi berapa yang membuat output?
- apakah output perlu direprocess setelah bug fix?
- apakah output masih valid setelah rule berubah?

---

## 15. Replay dan Reprocess

### 15.1 Kenapa Replay Diperlukan?

Replay diperlukan saat:

- event hilang atau gagal,
- bug processor ditemukan,
- downstream downtime,
- schema mapping salah,
- migration ulang,
- audit reconstruction,
- data recovery,
- reclassification.

### 15.2 Replay Dari S3 Listing

Karena object tetap ada, kita bisa replay dengan listing prefix:

```text
list landing/source=portal/year=2026/month=06/day=19/
  -> create synthetic processing command
  -> push to SQS replay queue
```

Namun listing harus hati-hati:

- pagination,
- prefix tepat,
- object version,
- lifecycle object yang sudah pindah cold,
- deleted marker,
- permission,
- idempotency.

### 15.3 Replay Queue Terpisah

Gunakan queue terpisah untuk replay besar:

```text
normal-s3-events-queue
replay-s3-events-queue
```

Manfaat:

- tidak mengganggu traffic normal,
- concurrency bisa dibatasi,
- audit replay lebih jelas,
- rollback lebih aman.

### 15.4 Reprocess Policy

Tidak semua object boleh direprocess bebas.

Pertanyaan:

- Apakah reprocess menghasilkan side effect eksternal?
- Apakah output lama harus diganti atau dibuat versi baru?
- Apakah workflow state boleh mundur?
- Apakah audit event baru harus dibuat?
- Apakah user perlu diberitahu?
- Apakah hasil lama harus tetap dipertahankan untuk evidentiary trail?

Pola aman:

```text
input immutable
new processing run id
new output version
old output retained
business pointer updated only after success
```

---

## 16. S3 Event Filter dan Prefix Strategy

### 16.1 Filter Prefix/Suffix

S3 event notification bisa difilter berdasarkan prefix/suffix. Ini sangat bergantung pada key design.

Contoh:

```text
Event only for:
  prefix = landing/portal/
  suffix = .pdf
```

Tetapi jangan terlalu percaya suffix untuk security. Suffix hanya routing awal.

### 16.2 Hindari Event Loop

Event loop terjadi jika processor menulis output ke prefix yang juga memicu processor yang sama.

Buruk:

```text
S3 event prefix: documents/
processor reads documents/a.pdf
processor writes documents/a.normalized.pdf
new event triggers same processor again
```

Lebih baik:

```text
input prefix: landing/
output prefix: processed/
event configured only for landing/
```

Atau gunakan metadata/tag/state untuk mencegah recursive processing.

### 16.3 Multiple Pipelines

Jika bucket punya banyak pipeline, pisahkan prefix:

```text
landing/documents/
landing/imports/
landing/images/
landing/reports/
```

Atau pisahkan bucket jika boundary security/ownership berbeda.

---

## 17. Bucket Per Domain atau Shared Bucket?

### 17.1 Shared Bucket

Kelebihan:

- lebih sedikit resource,
- lifecycle bisa centralized,
- monitoring consolidated,
- naming lebih sederhana.

Kekurangan:

- policy kompleks,
- blast radius besar,
- event config crowded,
- lifecycle rule riskier,
- ownership kabur.

### 17.2 Bucket Per Domain

Kelebihan:

- boundary jelas,
- IAM lebih sederhana,
- lifecycle spesifik,
- audit lebih mudah,
- blast radius kecil.

Kekurangan:

- resource lebih banyak,
- naming/account governance perlu matang,
- cross-domain sharing perlu eksplisit.

### 17.3 Rule of Thumb

Gunakan bucket terpisah jika berbeda:

- data classification,
- retention policy,
- owner team,
- access model,
- KMS key,
- lifecycle,
- compliance requirement,
- event pipeline,
- environment/account.

Gunakan prefix dalam bucket yang sama jika:

- data classification sama,
- owner sama,
- access policy mirip,
- lifecycle mirip,
- event pipeline terkendali.

---

## 18. Security Boundary

### 18.1 Jangan Biarkan S3 Menjadi Backdoor Authorization

Aplikasi sering punya authorization kompleks:

```text
Officer A boleh lihat case X tapi tidak case Y.
Agency B hanya boleh lihat dokumen miliknya.
Supervisor bisa approve, normal officer hanya read.
```

Jika user diberi akses S3 langsung terlalu luas, authorization aplikasi bisa dibypass.

Pola lebih aman:

```text
User -> Application -> authorization check -> generate short-lived presigned URL / stream through app
```

Atau:

```text
User -> Application -> authorization check -> temporary scoped credentials via STS
```

Untuk banyak enterprise, presigned URL lebih sederhana, tetapi harus:

- short TTL,
- bind ke object yang tepat,
- tidak expose bucket browsing,
- log issuance,
- hindari object key mengandung PII,
- pertimbangkan content-disposition.

### 18.2 IAM Role Untuk Processor

Processor role harus minimal:

```text
Allow s3:GetObject only on landing prefix yang diproses
Allow s3:PutObject only on processed/quarantine prefix yang ditulis
Allow s3:PutObjectTagging jika butuh tag
Allow kms:Decrypt untuk source key
Allow kms:Encrypt/GenerateDataKey untuk destination key
Deny delete kecuali diperlukan
```

Jangan beri:

```text
s3:*
Resource: *
```

### 18.3 Bucket Policy Guardrail

Guardrail umum:

- deny non-TLS,
- deny unencrypted upload,
- deny wrong KMS key,
- deny public ACL,
- deny access outside VPC endpoint jika relevan,
- require specific principal/role,
- restrict prefix by role.

Contoh konseptual:

```json
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::example-bucket/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}
```

Policy detail harus disesuaikan dengan service, KMS, principal, dan account.

---

## 19. KMS dan Encryption Dalam S3 Pipeline

### 19.1 SSE-S3 vs SSE-KMS

SSE-S3 lebih sederhana. SSE-KMS memberi governance lebih kuat melalui KMS key, CloudTrail visibility, key policy, grants, dan separation of duty.

Untuk regulated workloads, SSE-KMS sering lebih cocok.

### 19.2 Cross-Account KMS Problem

Jika producer dan consumer beda account, jangan hanya memberi S3 permission. KMS permission juga harus benar.

Consumer butuh:

```text
s3:GetObject
kms:Decrypt
```

Producer butuh:

```text
s3:PutObject
kms:Encrypt
kms:GenerateDataKey
```

Jika salah, error bisa terlihat seperti S3 AccessDenied, padahal akar masalahnya KMS.

### 19.3 Encryption Context

KMS encryption context bisa dipakai untuk binding tambahan, tetapi harus konsisten dengan service integration. Jangan mendesain encryption context rumit tanpa memastikan semua producer/consumer bisa menggunakannya.

---

## 20. Lifecycle dan Cost Engineering

### 20.1 Cost Surface

S3 cost bukan hanya storage GB-month.

Ada:

- PUT/COPY/POST/LIST request,
- GET request,
- data transfer,
- lifecycle transition,
- retrieval cost,
- minimum storage duration untuk beberapa class,
- monitoring/automation cost,
- KMS request cost,
- CloudTrail data event cost jika diaktifkan,
- replication cost.

### 20.2 Lifecycle Rule by Prefix/Tag

Contoh:

```text
landing/temp/      expire after 7 days
failed/            expire after 90 days unless tagged retain=true
archive/legal/     retain according to legal policy
reports/export/    expire after 30 days
```

Prefix/tag design menentukan apakah lifecycle aman atau berbahaya.

### 20.3 Restore From Archive

Jika object pindah ke Glacier/Deep Archive, `GetObject` biasa bisa gagal sampai object direstore. Aplikasi harus tahu:

- storage class,
- restore status,
- expected restore delay,
- user-facing message,
- operational approval,
- cost implication.

Jangan mendesain sistem yang mengharuskan immediate read pada object yang sudah dipindah ke cold archive.

---

## 21. Auditability dan Regulatory Defensibility

### 21.1 Pertanyaan Audit

Untuk object penting, sistem harus bisa menjawab:

1. Siapa upload object?
2. Kapan upload terjadi?
3. Dari channel mana?
4. Apa checksum object saat diterima?
5. Apakah object pernah berubah?
6. Siapa membaca object?
7. Siapa menghapus object?
8. Apakah object terkena retention/legal hold?
9. Processor apa yang memproses object?
10. Output apa yang dihasilkan?
11. Error apa yang pernah terjadi?
12. Apakah object pernah direprocess?

### 21.2 Audit Sources

Sumber audit:

- application audit table,
- S3 object metadata/tag,
- CloudTrail management event,
- CloudTrail S3 data event jika diaktifkan,
- SQS processing logs,
- Lambda logs,
- processing result table,
- checksum manifest,
- KMS CloudTrail event,
- access logs/CloudWatch logs.

CloudTrail S3 data events dapat mahal dan verbose, jadi aktifkan secara selektif untuk bucket/prefix penting.

### 21.3 Evidence Bundle

Untuk regulatory system, pertimbangkan membuat evidence bundle:

```text
archive/evidence/caseId=CASE-123/bundle-20260619/
  manifest.json
  original-document.pdf
  normalized-document.pdf
  processing-log.json
  checksum.txt
  audit-events.jsonl
```

Manifest berisi:

```json
{
  "caseId": "CASE-123",
  "bundleId": "BUNDLE-20260619-001",
  "createdAt": "2026-06-19T10:30:00Z",
  "objects": [
    {
      "role": "original-submission",
      "bucket": "case-documents-prod",
      "key": "landing/.../original.pdf",
      "versionId": "...",
      "sha256": "..."
    }
  ]
}
```

---

## 22. S3 Object Versioning Strategy

### 22.1 Kapan Perlu Versioning?

Versioning sangat berguna jika:

- object tidak boleh hilang akibat overwrite/delete,
- audit penting,
- user bisa upload revisi,
- event ordering perlu dibedakan per version,
- Object Lock diperlukan,
- rollback object perlu.

### 22.2 Versioning Bukan Gratis Secara Operasional

Konsekuensi:

- storage bertambah karena versi lama tetap ada,
- delete menghasilkan delete marker,
- lifecycle perlu handle noncurrent versions,
- processing harus aware versionId,
- UI harus membedakan current/latest/selected version,
- compliance deletion lebih rumit.

### 22.3 Immutable Key vs Versioned Key

Dua pendekatan:

#### Immutable Key

```text
landing/case-123/doc-456/upload-20260619T101530Z/original.pdf
landing/case-123/doc-456/upload-20260620T090000Z/original.pdf
```

Kelebihan:

- mudah dipahami,
- tidak tergantung versionId,
- replay jelas,
- no overwrite convention.

Kekurangan:

- perlu database untuk current pointer,
- key panjang,
- cleanup/lifecycle perlu rapi.

#### Stable Key + Versioning

```text
landing/case-123/doc-456/original.pdf
versionId=A
versionId=B
```

Kelebihan:

- key stabil,
- versi disediakan S3,
- cocok dengan Object Lock.

Kekurangan:

- app harus version-aware,
- event handler harus memperhatikan versionId,
- presigned URL/versioning handling lebih kompleks.

---

## 23. Batch Ingestion Pattern

### 23.1 Problem Batch

Batch sering terdiri dari:

```text
header.csv
part-00001.csv
part-00002.csv
part-00003.csv
trailer.csv
manifest.json
```

Masalah:

- file datang tidak bersamaan,
- event datang per object,
- processing terlalu cepat sebelum batch lengkap,
- salah satu part missing,
- checksum mismatch,
- duplicate upload,
- retry upload menyebabkan overwrite.

### 23.2 Manifest-Driven Batch

Pola aman:

```text
1. Producer upload all data files.
2. Producer upload manifest terakhir.
3. Event hanya trigger manifest.json.
4. Consumer membaca manifest.
5. Consumer validasi semua object ada dan checksum cocok.
6. Consumer proses batch.
```

Event filter:

```text
prefix = landing/agency-x/
suffix = manifest.json
```

Dengan pola ini, manifest menjadi signal completeness.

### 23.3 Marker File Pattern

Alternatif sederhana:

```text
_SUCCESS
_READY
```

Namun manifest lebih kuat karena bisa menyimpan daftar file dan checksum.

---

## 24. Large Payload Handoff Pattern

S3 sering digunakan saat payload terlalu besar untuk message broker.

Buruk:

```text
SQS message body contains huge JSON/file/base64
```

Lebih baik:

```json
{
  "eventType": "DocumentUploaded",
  "bucket": "case-documents-prod",
  "key": "landing/.../original.pdf",
  "versionId": "...",
  "sha256": "...",
  "sizeBytes": 104857600,
  "correlationId": "..."
}
```

Message membawa pointer dan metadata minimum. Bytes tetap di S3.

Risiko yang harus ditangani:

- object missing,
- permission mismatch,
- object changed,
- pointer stale,
- lifecycle expired,
- KMS decrypt denied.

---

## 25. S3 Dengan Database Transaction: The Hard Part

### 25.1 Tidak Ada Atomic Transaction S3 + DB

Kamu tidak bisa melakukan atomic transaction tunggal:

```text
PutObject to S3 + INSERT row to DB
```

Jika S3 sukses lalu DB gagal, object orphan.
Jika DB sukses lalu S3 gagal, row menunjuk object yang tidak ada.

### 25.2 Pola 1: S3 First, DB Reconcile

```text
1. Put object to S3.
2. Insert DB row.
3. If DB insert fails, mark object orphan via lifecycle/reconciliation.
```

Cocok jika object upload adalah fakta awal.

Perlu:

- orphan scanner,
- lifecycle temp cleanup,
- idempotent upload token.

### 25.3 Pola 2: DB Intent First

```text
1. Create DB row status UPLOAD_PENDING.
2. Generate presigned URL for exact key.
3. Client uploads to S3.
4. S3 event confirms object exists.
5. DB status -> UPLOADED.
```

Cocok untuk user upload.

Kelebihan:

- app tahu upload yang diharapkan,
- unknown object bisa ditolak/quarantine,
- state transition jelas.

### 25.4 Pola 3: Outbox/Event After Commit

Untuk service internal:

```text
1. DB transaction saves business state and outbox event.
2. Outbox publisher uploads/links object or publishes pointer.
3. Consumer processes asynchronously.
```

Cocok jika database adalah source of truth bisnis.

---

## 26. End-to-End Reference Architecture

### 26.1 Document Ingestion Pipeline

```text
[User / External System]
        |
        | presigned upload / service upload
        v
[S3 landing prefix]
        |
        | ObjectCreated event
        v
[SQS object-events queue]
        |
        v
[Java ingestion worker]
        |
        +--> HeadObject validation
        +--> Idempotency claim
        +--> Malware scan / schema validation
        +--> DB document status update
        +--> S3 processed/quarantine output
        +--> Audit event publish
        v
[DLQ if retry exhausted]
```

### 26.2 Invariants

```text
1. Every accepted upload has DB intent or known source rule.
2. Landing object is immutable.
3. Event handler is idempotent.
4. Processing result is persisted before SQS ack.
5. Failed object has reason code.
6. Quarantined object is not automatically consumed downstream.
7. Output object never overwrites input.
8. Audit trail links business ID, S3 identity, processing run, and principal.
9. Replay uses same idempotency rules.
10. Lifecycle never deletes object before retention decision allows it.
```

---

## 27. Java Implementation Skeleton

### 27.1 Domain Types

```java
public record S3ObjectIdentity(
    String bucket,
    String key,
    Optional<String> versionId,
    Optional<String> eTag,
    Optional<String> sequencer
) {}

public record ObjectProcessingContext(
    S3ObjectIdentity identity,
    long sizeBytes,
    String contentType,
    Map<String, String> userMetadata,
    String idempotencyKey,
    String correlationId
) {}

public enum ProcessingStatus {
    RECEIVED,
    PROCESSING,
    PROCESSED,
    FAILED_RETRYABLE,
    FAILED_PERMANENT,
    QUARANTINED,
    SKIPPED_DUPLICATE
}
```

### 27.2 Processor Contract

```java
public interface S3ObjectProcessor {
    ProcessingResult process(ObjectProcessingContext context, InputStream objectStream) throws Exception;
}
```

### 27.3 Idempotency Repository Contract

```java
public interface ProcessingRepository {
    ClaimResult tryClaim(ObjectProcessingContext context);

    void markProcessed(String idempotencyKey, ProcessingResult result);

    void markRetryableFailure(String idempotencyKey, Throwable error);

    void markPermanentFailure(String idempotencyKey, Throwable error);

    void markQuarantined(String idempotencyKey, String reasonCode, String detail);
}
```

### 27.4 Failure Classification

```java
public enum FailureKind {
    RETRYABLE_INFRA,
    RETRYABLE_DOWNSTREAM,
    PERMANENT_INVALID_OBJECT,
    PERMANENT_UNAUTHORIZED_SOURCE,
    QUARANTINE_SECURITY_RISK,
    DUPLICATE_ALREADY_PROCESSED
}
```

### 27.5 Handler Decision

```java
public enum MessageDecision {
    ACK,
    RETRY,
    SEND_TO_DLQ_OR_ACK_WITH_FAILURE_STATE
}
```

---

## 28. Failure Scenarios dan Respons Yang Benar

| Scenario | Kemungkinan Penyebab | Respons |
|---|---|---|
| Event duplicate | at-least-once delivery | idempotency skip |
| Event old datang belakangan | out-of-order delivery | compare version/sequencer/state |
| HeadObject 404 | object deleted, stale event, wrong key | classify; retry short or mark missing |
| AccessDenied | IAM/KMS/policy issue | retry terbatas; alert; no blind loop |
| Checksum mismatch | corrupt upload/wrong metadata | quarantine/permanent failure |
| File too large | source violation | quarantine/permanent failure |
| Downstream DB down | transient infra | retry with backoff; message not acked |
| Output PutObject gagal | S3/KMS/network | retry; ensure idempotent output key |
| DB update succeeds but SQS delete fails | ack failure | duplicate later skipped |
| Processor bug | code defect | DLQ/replay after fix |
| Lifecycle expired object | retention mismatch | operational incident; restore/improve policy |

---

## 29. Anti-Patterns

### 29.1 Treating S3 as Shared Network Drive

Gejala:

- semua service tulis ke bucket sama,
- tidak ada owner,
- tidak ada prefix contract,
- lifecycle rule campur aduk,
- event loop sering terjadi.

### 29.2 Processing Without Idempotency

Gejala:

- duplicate DB rows,
- duplicate notification,
- double billing,
- repeated officer task,
- inconsistent status.

### 29.3 Object Key Contains Sensitive Human Data

Buruk:

```text
landing/John-Doe/Passport-Number-A1234567.pdf
```

Object key muncul di logs, events, monitoring, URLs, audit, dan errors.

### 29.4 Move Object For Every State Change

Buruk:

```text
uploaded/ -> validating/ -> validated/ -> processing/ -> processed/
```

Untuk object besar dan volume tinggi, ini mahal dan rawan event loop. Gunakan database state.

### 29.5 Direct S3 Event to Heavy Lambda Without Queue

Untuk workload berat, ini sering menghasilkan concurrency spike, retry storm, timeout, dan observability buruk.

### 29.6 Lifecycle Without Business Retention Review

Lifecycle yang salah bisa menghapus evidence penting atau memindahkan object ke archive sebelum aplikasi siap.

---

## 30. Checklist Desain S3 Integration Boundary

### 30.1 Object Identity

- [ ] Bucket jelas.
- [ ] Prefix jelas.
- [ ] Key tidak mengandung PII sensitif.
- [ ] Key immutable atau version-aware.
- [ ] Versioning decision eksplisit.
- [ ] Checksum strategy jelas.

### 30.2 Event Processing

- [ ] Event destination dipilih sadar: Lambda/SQS/SNS/EventBridge.
- [ ] Consumer idempotent.
- [ ] Duplicate event aman.
- [ ] Out-of-order event aman.
- [ ] Event loop dicegah.
- [ ] DLQ/replay strategy ada.

### 30.3 Security

- [ ] IAM least privilege.
- [ ] Bucket policy guardrail.
- [ ] KMS permission benar.
- [ ] Public access blocked.
- [ ] Presigned URL TTL pendek.
- [ ] Application authorization tetap enforced.

### 30.4 Lifecycle and Archive

- [ ] Lifecycle per prefix/tag.
- [ ] Retention sesuai kewajiban bisnis/legal.
- [ ] Object Lock dipertimbangkan untuk evidence.
- [ ] Restore procedure ada.
- [ ] Noncurrent version lifecycle ada jika versioning aktif.

### 30.5 Operations

- [ ] Dashboard object event failure.
- [ ] DLQ alarm.
- [ ] Oldest message age alarm.
- [ ] Processing latency metric.
- [ ] Quarantine review procedure.
- [ ] Replay tool tersedia.
- [ ] Audit evidence link tersedia.

---

## 31. Mini Case Study: Regulatory Case Document Upload

### 31.1 Requirement

Sistem case management menerima dokumen dari portal. Dokumen harus:

- terkait case,
- tidak boleh hilang,
- dipindai malware,
- divalidasi ukuran/type,
- bisa diaudit,
- bisa direprocess,
- tidak boleh dibaca user yang tidak berwenang,
- disimpan minimal 7 tahun setelah case closed,
- bisa dikenai legal hold.

### 31.2 Design

```text
DB first:
  create document record status UPLOAD_PENDING
  generate presigned URL for exact landing key

Upload:
  client uploads to landing key
  bucket requires SSE-KMS

Event:
  S3 ObjectCreated -> SQS

Worker:
  parse event
  head object
  verify expected DB record
  claim idempotency
  malware scan
  validate metadata/checksum
  update DB status VALIDATED or QUARANTINED
  publish audit event

Archive:
  after case closure, tag retention=7y
  lifecycle moves to cold storage after access window
  legal hold available if investigation/litigation
```

### 31.3 Key Pattern

```text
landing/portal/year=2026/month=06/day=19/caseId=CASE-123/documentId=DOC-456/original.pdf
```

If case ID is sensitive, use opaque IDs:

```text
landing/portal/2026/06/19/case-7f3a1d/doc-83be2a/original.pdf
```

### 31.4 Invariant

```text
A document is visible in the case UI only if:
  DB status is VALIDATED or APPROVED
  malware scan status is CLEAN
  authorization check passes
  S3 object identity matches DB record
```

Not merely because object exists in S3.

---

## 32. What Top 1% Engineers Notice

Engineer biasa bertanya:

> “Bagaimana upload file ke S3?”

Engineer kuat bertanya:

> “Apa invariant object lifecycle-nya?”

Engineer biasa bertanya:

> “Bagaimana trigger Lambda dari S3?”

Engineer kuat bertanya:

> “Apa efek duplicate event, out-of-order event, retry, DLQ, dan replay terhadap state bisnis?”

Engineer biasa bertanya:

> “Prefix-nya apa?”

Engineer kuat bertanya:

> “Apakah prefix mendukung lifecycle, IAM boundary, event filter, audit, dan reprocessing?”

Engineer biasa bertanya:

> “File sudah diproses?”

Engineer kuat bertanya:

> “Processed oleh processor version apa, dari input checksum apa, dengan config apa, menghasilkan output apa, dan apakah replay aman?”

---

## 33. Ringkasan Mental Model

S3 sebagai integration boundary harus dipahami sebagai kombinasi:

```text
Object identity
+ object immutability
+ metadata governance
+ event semantics
+ idempotent processing
+ lifecycle/retention
+ security policy
+ auditability
+ replay capability
```

Jika salah satu hilang, sistem bisa tetap berjalan saat demo, tetapi gagal saat production incident.

Key takeaway:

1. S3 bukan filesystem.
2. S3 bukan queue.
3. S3 bukan database.
4. S3 sangat kuat sebagai durable object boundary.
5. Event dari S3 harus dianggap at-least-once dan tidak selalu sesuai intuisi urutan bisnis.
6. SQS sering menjadi buffer yang lebih aman antara S3 dan Java processor.
7. Object key design adalah architecture decision.
8. Metadata, tags, DB, dan manifest punya fungsi berbeda.
9. Archive membutuhkan retention, lifecycle, Object Lock, KMS, dan audit design.
10. Replay dan reprocess harus dirancang sejak awal.

---

## 34. Latihan Praktis

### Latihan 1 — Design Review

Ambil sistem upload dokumen sederhana. Jawab:

1. Bucket/prefix apa yang digunakan?
2. Apakah object key mengandung PII?
3. Apakah overwrite mungkin?
4. Apakah event duplicate aman?
5. Apakah object bisa direprocess?
6. Bagaimana object masuk quarantine?
7. Kapan object dihapus?
8. Bagaimana audit membuktikan object tidak berubah?

### Latihan 2 — Event Handler Invariant

Tulis invariant untuk handler:

```text
Given S3 ObjectCreated event,
handler must never create duplicate business processing result
for the same object version.
```

Lalu tentukan:

- idempotency key,
- table constraint,
- retry behavior,
- ack behavior,
- failure classification.

### Latihan 3 — Lifecycle Safety

Desain lifecycle rule untuk:

```text
landing/temp
landing/user-upload
processed/document
archive/evidence
reports/export
quarantine
```

Untuk setiap prefix, tentukan:

- retention,
- storage class transition,
- deletion rule,
- exception/legal hold behavior.

### Latihan 4 — Replay Tool

Desain CLI Java internal:

```text
java -jar s3-replay-tool.jar \
  --bucket case-documents-prod \
  --prefix landing/portal/2026/06/19/ \
  --queue-url ... \
  --dry-run true
```

Tentukan:

- filter,
- pagination,
- event payload format,
- rate limit,
- idempotency,
- audit log.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

- Amazon S3 Event Notifications — AWS Documentation.
- Amazon S3 Event message structure — AWS Documentation.
- Amazon S3 consistency model / strong consistency — AWS Documentation.
- Amazon S3 Object Lock — AWS Documentation.
- Amazon S3 Lifecycle transitions — AWS Documentation.
- AWS Storage Blog: managing event ordering and duplicate events with Amazon S3 Event Notifications.
- AWS SDK for Java 2.x S3 documentation.
- AWS Well-Architected Framework: Reliability, Security, Operational Excellence, Cost Optimization.

---

## 36. Penutup Part 10

Part 10 membangun mental model S3 sebagai boundary arsitektur. Kita tidak lagi sekadar mengirim dan mengambil object, tetapi mendesain alur hidup object sebagai bagian dari sistem distributed yang harus aman, reliable, observable, auditable, dan bisa dipulihkan.

Bagian berikutnya akan masuk ke **Part 11 — Secrets Manager and SSM Parameter Store**.

Di sana fokusnya bergeser dari object/data boundary ke configuration dan secret boundary: bagaimana Java application mengambil secret/config dari AWS dengan aman, cache yang benar, rotasi credential, failure mode, KMS, Spring Boot integration, dan operational playbook.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-09-s3-advanced-high-throughput-upload-download-streaming-transfer-manager.md">⬅️ Part 9 — S3 Advanced: High-Throughput Upload, Download, Streaming, and Transfer Manager</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-11-secrets-manager-and-ssm-parameter-store.md">Part 11 — Secrets Manager and SSM Parameter Store ➡️</a>
</div>
