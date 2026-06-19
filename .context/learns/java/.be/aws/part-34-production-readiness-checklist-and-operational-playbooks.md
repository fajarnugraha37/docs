# Part 34 — Production Readiness Checklist and Operational Playbooks

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> Fokus: Java 8–25, AWS SDK for Java 2.x, Lambda, S3, SQS, SNS, EventBridge, Secrets Manager, SSM, KMS, CloudWatch, CloudTrail  
> Posisi seri: Part 34 dari 35  
> Status: **belum bagian terakhir**. Setelah ini masih ada Part 35 — Capstone: Designing a Top-Tier Java AWS Integration Platform.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas banyak komponen secara mendalam: SDK, IAM, timeout, retry, observability, S3, SQS, SNS, Lambda, EventBridge, Secrets Manager, KMS, multi-account, migration, outbox, idempotency, saga, dan compensation.

Bagian ini bukan memperkenalkan service baru. Bagian ini adalah **lapisan readiness dan operability**.

Seorang engineer yang kuat tidak hanya bertanya:

> Apakah kodenya bisa jalan?

Tetapi bertanya:

> Apakah sistem ini bisa bertahan saat dependency lambat, credential berubah, quota habis, event duplicate, Lambda timeout, SQS DLQ penuh, S3 event replay, secret rotation gagal, atau rollback harus dilakukan jam 02:00 pagi oleh engineer yang tidak menulis sistem ini?

Production readiness berarti sistem tidak hanya benar dalam happy path, tetapi juga punya:

1. **invariant yang jelas**,
2. **failure response yang eksplisit**,
3. **observability yang cukup untuk diagnosis**,
4. **runbook yang bisa dieksekusi**,
5. **rollback path yang aman**,
6. **audit trail yang bisa dipertanggungjawabkan**,
7. **cost/quota guardrail**,
8. **operational ownership**.

AWS Well-Architected Framework menekankan praktik untuk membangun workload yang secure, reliable, efficient, cost-effective, sustainable, dan operationally excellent. Bagian ini menerjemahkan prinsip itu menjadi checklist konkret untuk Java AWS integration workload. Referensi utama: AWS Well-Architected Framework, Operational Excellence Pillar, Lambda alias traffic shifting, SQS DLQ/redrive, dan Secrets Manager rotation/best practices. [1][2][3][4][5]

---

## 1. Mental Model: Production Readiness Bukan Checklist Kosmetik

Checklist sering gagal karena diperlakukan sebagai administrasi menjelang go-live.

Checklist yang baik bukan sekadar:

```text
[ ] Logging ada
[ ] Monitoring ada
[ ] IAM dibuat
[ ] DLQ dibuat
[ ] Secret pakai Secrets Manager
```

Checklist yang baik memaksa sistem menjawab pertanyaan operasional:

```text
Saat SQS message gagal 10 kali, siapa yang tahu?
Saat secret rotate dan koneksi DB gagal, aplikasi akan recover atau mati?
Saat S3 event duplicate, apakah file diproses dua kali?
Saat Lambda throttled, apakah upstream tahu?
Saat DLQ direplay, apakah side effect akan double?
Saat deployment buruk, bagaimana rollback dalam 5 menit?
Saat auditor meminta bukti siapa mengakses object, data event CloudTrail aktif atau tidak?
```

Production readiness adalah proses membuktikan bahwa desain sudah siap menghadapi kenyataan.

---

## 2. Tiga Level Readiness

Gunakan tiga level berikut untuk menilai kesiapan sistem.

### 2.1 Code Readiness

Sistem benar dari sisi implementasi lokal.

Contoh:

- AWS client dibuat sekali dan di-reuse.
- Timeout diset eksplisit.
- Retry tidak infinite.
- Exception taxonomy jelas.
- Request id dicatat.
- Secret tidak muncul di log.
- Handler idempotent.

### 2.2 Runtime Readiness

Sistem benar saat berjalan di AWS environment nyata.

Contoh:

- IAM role benar.
- KMS key policy benar.
- VPC endpoint tersedia bila workload private.
- Lambda memory/concurrency cukup.
- SQS visibility timeout sesuai processing time.
- DLQ redrive policy benar.
- CloudWatch alarm aktif.
- Quota cukup untuk peak.

### 2.3 Operational Readiness

Sistem bisa dioperasikan oleh tim manusia saat terjadi masalah.

Contoh:

- Ada runbook incident.
- Ada dashboard.
- Ada alarm actionable.
- Ada prosedur replay.
- Ada prosedur rollback.
- Ada owner per service.
- Ada audit evidence.
- Ada post-incident review template.

Banyak sistem lulus code readiness tetapi gagal operational readiness.

---

## 3. Readiness Map untuk Java AWS Integration

Sistem Java yang memakai AWS biasanya punya beberapa boundary:

```text
+-------------------+
| Java Application  |
+-------------------+
        |
        | AWS SDK call
        v
+-------------------+       +-------------------+
| AWS Control Plane |       | AWS Data Plane    |
| IAM, STS, KMS,    |       | S3, SQS, SNS,     |
| CloudWatch, etc.  |       | DynamoDB, Lambda  |
+-------------------+       +-------------------+
        |
        v
+-------------------+
| Operational Plane |
| Logs, metrics,    |
| trace, audit,     |
| alarms, runbooks  |
+-------------------+
```

Production readiness harus menilai semua boundary tersebut, bukan hanya application code.

---

## 4. Master Production Readiness Checklist

Ini adalah checklist utama. Bagian berikutnya akan membahas tiap area secara detail.

| Area | Pertanyaan Readiness |
|---|---|
| Ownership | Siapa owner service, queue, topic, bucket, secret, key, alarm? |
| Architecture | Apakah boundary, invariant, dan failure mode terdokumentasi? |
| IAM | Apakah permission least privilege dan bisa diaudit? |
| Credential | Apakah tidak ada static credential? |
| Region | Apakah region eksplisit dan multi-region assumption jelas? |
| SDK Client | Apakah client di-reuse dan dikonfigurasi? |
| Timeout | Apakah semua remote call punya timeout eksplisit? |
| Retry | Apakah retry bounded, jittered, dan tidak amplify failure? |
| Idempotency | Apakah semua mutating handler aman terhadap duplicate? |
| S3 | Apakah key design, lifecycle, encryption, event semantics jelas? |
| SQS | Apakah visibility timeout, DLQ, redrive, batch failure benar? |
| SNS | Apakah subscriber filtering, DLQ, schema, fan-out ownership jelas? |
| Lambda | Apakah timeout, memory, concurrency, cold start, rollback siap? |
| Secrets | Apakah rotation, cache, fallback, dan leakage control siap? |
| KMS | Apakah key policy, grants, throttling, dan audit siap? |
| Observability | Apakah logs, metrics, traces, request id, dashboards ada? |
| Auditability | Apakah CloudTrail/data events/log retention cukup? |
| Cost | Apakah cost driver dan quota diketahui? |
| Testing | Apakah failure injection dan integration test cukup? |
| Deployment | Apakah canary/rollback/promotion model jelas? |
| Runbook | Apakah incident/replay/rotation/rollback procedure tertulis? |

---

## 5. Architecture Readiness

### 5.1 Apa yang Harus Ada di Architecture Readiness

Sebelum production, setiap integration flow harus punya dokumen ringkas yang menjelaskan:

1. apa input sistem,
2. apa output sistem,
3. siapa producer,
4. siapa consumer,
5. service AWS apa yang menjadi boundary,
6. apa invariant bisnis,
7. apa invariant teknis,
8. apa failure mode,
9. apa recovery path,
10. bagaimana observability-nya.

Contoh flow:

```text
User upload document
  -> S3 landing bucket
  -> S3 event notification
  -> SQS document-processing queue
  -> Java worker
  -> metadata DB update
  -> SNS DocumentProcessed event
  -> audit trail
```

Architecture readiness bukan menggambar diagram indah. Tujuannya adalah memastikan sistem bisa dijelaskan saat incident.

### 5.2 Invariant

Invariant adalah aturan yang harus selalu benar meskipun terjadi retry, duplicate, timeout, atau partial failure.

Contoh invariant untuk file processing:

```text
1. Satu logical document version hanya boleh committed satu kali.
2. File yang gagal validasi harus masuk quarantine, bukan dihapus diam-diam.
3. Audit event harus mencatat setiap transisi status.
4. DLQ replay tidak boleh membuat double approval.
5. Object asli tidak boleh dimutasi setelah masuk archive zone.
```

Tanpa invariant, runbook hanya menjadi tebak-tebakan.

### 5.3 Boundary Decision

Untuk setiap AWS service, tulis keputusan boundary:

| Service | Boundary Role | Contoh |
|---|---|---|
| S3 | durable object boundary | file upload/archive |
| SQS | retry/reliability boundary | async worker queue |
| SNS | fan-out boundary | domain event distribution |
| EventBridge | routing/scheduler boundary | scheduled escalation |
| Secrets Manager | credential boundary | DB/password/API key |
| KMS | cryptographic boundary | data key/encryption |
| CloudTrail | audit boundary | who did what |
| CloudWatch | operational boundary | logs/metrics/alarms |

Jika boundary tidak jelas, service AWS mudah berubah menjadi dumping ground.

---

## 6. Ownership Readiness

Sistem production harus punya owner yang jelas.

### 6.1 Ownership Minimal

Untuk setiap resource, tentukan:

```text
Application owner:
Operational owner:
Security owner/reviewer:
Data owner:
On-call channel:
Escalation path:
Business impact:
Recovery time objective:
Recovery point objective:
```

### 6.2 Tagging Readiness

Resource AWS harus punya tag minimal:

```text
Application
Environment
Owner
CostCenter
DataClassification
Criticality
ManagedBy
Repository
RunbookUrl
```

Tag bukan hanya untuk cost. Tag membantu incident response dan audit.

### 6.3 Anti-Pattern

```text
Queue: document-processing-prod
Owner: unknown
Alarm: none
DLQ: exists but nobody checks
Runbook: none
```

Ini bukan production-ready meskipun queue-nya aktif dan sistem terlihat berjalan.

---

## 7. IAM and Access Readiness

IAM readiness menjawab:

> Apakah aplikasi hanya bisa melakukan hal yang memang perlu dilakukan, dan apakah kita bisa membuktikannya?

### 7.1 Checklist IAM

```text
[ ] Tidak ada long-lived access key di server/container/Lambda.
[ ] Aplikasi memakai execution role / instance role / task role / IRSA.
[ ] Policy dibatasi per action.
[ ] Policy dibatasi per resource ARN bila memungkinkan.
[ ] Condition dipakai untuk membatasi environment/account/path bila relevan.
[ ] KMS key policy sinkron dengan IAM policy.
[ ] S3 bucket policy tidak membuka akses publik.
[ ] SQS/SNS resource policy tidak membuka cross-account tanpa kontrol.
[ ] STS AssumeRole menggunakan trust policy yang eksplisit.
[ ] CloudTrail bisa merekam aktivitas penting.
[ ] Tidak ada wildcard `*` tanpa justifikasi tertulis.
```

### 7.2 IAM Review Questions

Tanyakan ini saat review:

```text
Mengapa service ini butuh s3:DeleteObject?
Mengapa butuh sqs:PurgeQueue?
Mengapa butuh secretsmanager:ListSecrets?
Mengapa butuh kms:Decrypt untuk semua key?
Apakah role ini bisa dipakai dari environment lain?
Apakah role DEV punya akses ke PROD?
```

### 7.3 Dangerous Permissions

Beberapa permission harus dianggap high-risk:

```text
s3:DeleteBucket
s3:DeleteObject
s3:PutBucketPolicy
sqs:PurgeQueue
sqs:DeleteQueue
sns:DeleteTopic
kms:ScheduleKeyDeletion
kms:DisableKey
secretsmanager:DeleteSecret
secretsmanager:PutSecretValue
lambda:UpdateFunctionCode
iam:PassRole
sts:AssumeRole
```

Jika aplikasi runtime punya permission ini, perlu alasan kuat.

### 7.4 IAM Failure Playbook

Gejala:

```text
AccessDeniedException
KMS AccessDenied
S3 403
SQS AccessDenied
SNS AuthorizationError
STS AssumeRole failure
```

Langkah diagnosis:

```text
1. Ambil AWS request ID dari log.
2. Identifikasi principal aktual yang dipakai aplikasi.
3. Verifikasi region dan account ID.
4. Cek identity policy principal.
5. Cek resource policy target service.
6. Cek KMS key policy/grants bila operasi terenkripsi.
7. Cek permission boundary/SCP/session policy bila ada.
8. Cek CloudTrail event untuk authorization failure.
9. Perbaiki policy minimal, bukan tambah wildcard.
10. Tambahkan test atau policy assertion agar tidak regress.
```

---

## 8. SDK Client Readiness

AWS SDK readiness memastikan Java app memakai SDK sebagai remote dependency yang terkontrol.

### 8.1 Checklist SDK Client

```text
[ ] AWS SDK for Java 2.x digunakan untuk pengembangan baru.
[ ] SDK v1 tidak digunakan untuk modul baru.
[ ] Semua client dibuat sebagai singleton/reused bean.
[ ] Region eksplisit atau region provider chain terdokumentasi.
[ ] Credentials provider eksplisit sesuai runtime.
[ ] HTTP client dipilih secara sadar.
[ ] Timeout diset eksplisit.
[ ] Retry strategy dipilih secara sadar.
[ ] Client ditutup saat shutdown bila lifecycle manual.
[ ] Async client tidak dipakai dengan blocking handler sembarangan.
[ ] SDK version dikelola via BOM.
```

AWS SDK for Java 2.x mempunyai best practice untuk client reuse, timeout, retry, dan konfigurasi HTTP client. Untuk production, jangan mengandalkan default tanpa memahami implikasinya.

### 8.2 Client Lifecycle Pattern

Spring Boot example:

```java
@Configuration
class AwsClientConfig {

    @Bean
    S3Client s3Client(AwsProperties props) {
        return S3Client.builder()
                .region(Region.of(props.region()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallTimeout(Duration.ofSeconds(30))
                        .apiCallAttemptTimeout(Duration.ofSeconds(10))
                        .build())
                .build();
    }
}
```

Hal yang penting bukan kodenya, tetapi invariant-nya:

```text
Client dibuat sekali.
Client punya region jelas.
Client punya credential source jelas.
Client punya timeout jelas.
Client tidak dibuat per request.
```

### 8.3 SDK Anti-Pattern

```java
public void upload(byte[] payload) {
    S3Client s3 = S3Client.create(); // anti-pattern jika dilakukan per request
    s3.putObject(...);
}
```

Masalah:

- connection pool tidak efektif,
- credential resolution berulang,
- resource leak risk,
- latency lebih tinggi,
- sulit mengontrol timeout/retry secara konsisten.

---

## 9. Timeout and Retry Readiness

Timeout dan retry adalah dua sisi pedang.

Tanpa timeout, thread bisa menggantung.

Dengan retry sembarangan, sistem bisa memperparah outage.

### 9.1 Checklist Timeout

```text
[ ] Semua AWS SDK call punya apiCallTimeout.
[ ] Semua AWS SDK call punya apiCallAttemptTimeout.
[ ] HTTP connect timeout diset.
[ ] Connection acquisition timeout diset bila memakai pool.
[ ] Lambda timeout lebih besar dari expected processing, tetapi tidak terlalu longgar.
[ ] SQS visibility timeout > max processing time + retry buffer.
[ ] API Gateway timeout dipahami bila Lambda dipanggil sync.
[ ] Worker shutdown lebih pendek dari orchestrator kill timeout.
```

### 9.2 Timeout Hierarchy

Contoh mental model:

```text
User/client timeout
  > API Gateway/inbound timeout
    > application request timeout
      > AWS SDK apiCallTimeout
        > AWS SDK apiCallAttemptTimeout
          > HTTP connect/socket/acquire timeout
```

Timeout harus berurutan. Jangan sampai inner timeout lebih besar dari outer timeout.

Buruk:

```text
API caller timeout: 5s
AWS SDK apiCallTimeout: 30s
```

Hasilnya caller sudah menyerah, tetapi backend masih bekerja.

### 9.3 Retry Checklist

```text
[ ] Retry hanya untuk error retryable.
[ ] Retry punya max attempt.
[ ] Retry memakai jitter/backoff.
[ ] Retry tidak melanggar idempotency.
[ ] Retry tidak digandakan berlebihan di banyak layer.
[ ] Retry budget dipahami.
[ ] Throttling diperlakukan sebagai pressure signal.
[ ] DLQ tidak dijadikan pengganti idempotency.
```

### 9.4 Retry Amplification

Misalnya:

```text
API Gateway retries: 2
Application retries: 3
SDK retries: 3
Database retries: 2
```

Satu request bisa menjadi:

```text
2 * 3 * 3 * 2 = 36 attempts
```

Saat dependency bermasalah, retry amplification bisa membuat outage lebih parah.

### 9.5 Readiness Question

Untuk setiap AWS call, jawab:

```text
Kalau call ini timeout, apakah aman retry?
Kalau retry berhasil setelah attempt pertama sebenarnya berhasil tapi response hilang, apakah side effect double?
Kalau dependency throttled, apakah kita memperlambat diri atau menambah pressure?
Kalau semua instance retry bersamaan, apakah ada jitter?
```

---

## 10. Idempotency Readiness

Idempotency adalah syarat dasar untuk event-driven dan retry-heavy system.

### 10.1 Checklist Idempotency

```text
[ ] Semua command/event punya idempotency key.
[ ] Idempotency key stabil saat retry.
[ ] Handler memeriksa previous processing result.
[ ] Duplicate message tidak menghasilkan duplicate side effect.
[ ] State transition monotonic.
[ ] Replay tidak merusak state final.
[ ] Partial success dicatat.
[ ] Idempotency record punya TTL sesuai kebutuhan.
[ ] Failure sebelum/after side effect dibedakan.
```

### 10.2 Idempotency State Machine

```text
NEW
  -> PROCESSING
  -> COMPLETED
  -> FAILED_RETRYABLE
  -> FAILED_TERMINAL
```

Jangan hanya simpan boolean `processed=true`.

Mengapa?

Karena failure bisa terjadi di tengah:

```text
1. message diterima
2. DB updated
3. SNS publish timeout
4. worker crash
5. message redelivered
```

Apakah DB update harus diulang? Apakah SNS publish harus diulang? Jawabannya bergantung pada state record.

### 10.3 Idempotency Store Minimal

```text
idempotency_key
operation_type
input_hash
status
result_reference
first_seen_at
last_updated_at
expires_at
error_code
attempt_count
```

### 10.4 Dangerous Assumption

```text
SQS FIFO exactly-once berarti handler tidak perlu idempotent.
```

Ini asumsi berbahaya.

FIFO membantu deduplication dan ordering dalam constraint tertentu, tetapi aplikasi tetap harus aman terhadap retry, timeout, partial failure, dan replay manual.

---

## 11. S3 Readiness

S3 production readiness memastikan object lifecycle, access, eventing, dan recovery aman.

### 11.1 S3 Checklist

```text
[ ] Bucket public access block aktif.
[ ] Bucket policy least privilege.
[ ] SSE-S3 atau SSE-KMS dipilih eksplisit.
[ ] KMS key policy benar bila SSE-KMS.
[ ] Versioning dipertimbangkan untuk critical bucket.
[ ] Lifecycle policy terdokumentasi.
[ ] Object retention/legal hold dipakai bila perlu compliance.
[ ] Object key design mendukung partitioning dan traceability.
[ ] Metadata/tag object tidak menyimpan secret/PII sembarangan.
[ ] Multipart upload cleanup disiapkan.
[ ] Event notification duplicate/out-of-order ditangani.
[ ] Presigned URL expiry pendek dan scope tepat.
[ ] CloudTrail data events aktif bila butuh audit object-level.
```

### 11.2 S3 Key Design Readiness

Object key harus bisa menjawab:

```text
Environment apa?
Tenant/agency apa?
Entity apa?
Tanggal apa?
Correlation id apa?
Version apa?
Status zone apa?
```

Contoh:

```text
landing/env=prod/agency=cea/caseId=CASE-2026-0001/documentId=DOC-001/version=3/uploadId=.../original.pdf
processed/env=prod/agency=cea/caseId=CASE-2026-0001/documentId=DOC-001/version=3/result.json
quarantine/env=prod/agency=cea/caseId=CASE-2026-0001/documentId=DOC-001/version=3/reason=virus-detected/original.pdf
```

### 11.3 S3 Event Readiness

Pertanyaan wajib:

```text
Apakah event duplicate aman?
Apakah event out-of-order aman?
Apakah object sudah tersedia saat event diterima?
Apakah handler memvalidasi bucket/key/version?
Apakah event dari bucket lain ditolak?
Apakah delete marker/versioning dipahami?
```

### 11.4 S3 Incident Playbook: Object Missing

Gejala:

```text
NoSuchKey
S3 event diterima tetapi object tidak ditemukan
Processing gagal karena object metadata berbeda
```

Langkah:

```text
1. Ambil bucket, key, versionId, eventTime, sequencer, request id.
2. Cek apakah bucket versioning aktif.
3. Cek apakah object delete marker ada.
4. Cek CloudTrail data event jika aktif.
5. Cek lifecycle rule apakah object dipindah/dihapus.
6. Cek apakah event berasal dari test/replay lama.
7. Cek object key encoding issue.
8. Cek permission KMS bila error terlihat seperti access issue.
9. Jika duplicate/out-of-order, dedup dan mark event ignored.
10. Buat post-incident evidence.
```

---

## 12. SQS Readiness

SQS readiness memastikan queue benar-benar menjadi reliability boundary, bukan tempat error bersembunyi.

### 12.1 SQS Checklist

```text
[ ] Queue type standard/FIFO dipilih berdasarkan ordering need.
[ ] Visibility timeout sesuai max processing time.
[ ] Long polling aktif.
[ ] DLQ dikonfigurasi.
[ ] maxReceiveCount realistis.
[ ] DLQ retention lebih panjang dari source queue.
[ ] Redrive allow policy dipahami.
[ ] Message body schema/version jelas.
[ ] Message attributes tidak menyimpan secret.
[ ] Consumer idempotent.
[ ] Batch delete hanya setelah per-message success.
[ ] Partial batch failure ditangani bila via Lambda.
[ ] Queue metrics dan alarms aktif.
```

AWS SQS DLQ berguna untuk mengisolasi message yang gagal diproses agar dapat dianalisis, dan AWS menyediakan mekanisme redrive dari DLQ ke source queue atau queue lain. [4][6]

### 12.2 SQS Alarm Minimal

```text
ApproximateAgeOfOldestMessage > threshold
ApproximateNumberOfMessagesVisible > threshold
ApproximateNumberOfMessagesNotVisible unexpectedly high
DLQ ApproximateNumberOfMessagesVisible > 0
NumberOfMessagesDeleted drops unexpectedly
NumberOfMessagesReceived spikes unexpectedly
```

### 12.3 SQS Visibility Timeout Rule

Visibility timeout harus lebih besar dari waktu processing normal.

Namun jangan terlalu besar.

Jika terlalu kecil:

```text
message diproses ulang saat handler pertama masih berjalan
```

Jika terlalu besar:

```text
message gagal butuh waktu lama untuk retry
```

Rule praktis:

```text
visibilityTimeout >= p99_processing_time + retry/cleanup_buffer
```

Untuk task yang durasinya tidak pasti, gunakan visibility extension.

### 12.4 DLQ Is Not a Solution

DLQ bukan penyelesaian. DLQ adalah sinyal bahwa penyelesaian dibutuhkan.

Runbook harus menjawab:

```text
Siapa yang mengecek DLQ?
Berapa SLA triage DLQ?
Bagaimana inspect message?
Bagaimana classify failure?
Kapan redrive aman?
Kapan message harus quarantine?
Kapan perlu data fix?
Bagaimana mencegah replay berbahaya?
```

### 12.5 SQS DLQ Triage Playbook

```text
1. Stop redrive otomatis bila root cause belum diketahui.
2. Sample message dari DLQ.
3. Kelompokkan berdasarkan error_code / schema_version / event_type.
4. Cek first failure time dan last receive count.
5. Cek deployment change sekitar waktu failure.
6. Cek dependency failure: DB, S3, KMS, downstream API.
7. Cek apakah message poison atau systemic failure.
8. Jika systemic, fix consumer dulu.
9. Jika poison, quarantine atau patch data.
10. Redrive batch kecil.
11. Monitor queue age, error rate, duplicate side effect.
12. Catat evidence dan prevention action.
```

---

## 13. SNS Readiness

SNS readiness memastikan fan-out tidak menjadi fan-out chaos.

### 13.1 SNS Checklist

```text
[ ] Topic owner jelas.
[ ] Publisher permission terbatas.
[ ] Subscriber permission/resource policy benar.
[ ] Message schema dan version jelas.
[ ] Message attributes dipakai untuk filter policy.
[ ] Filter policy terdokumentasi.
[ ] SNS-to-SQS subscription menggunakan raw delivery bila cocok.
[ ] Subscription DLQ dipertimbangkan.
[ ] Cross-account subscription diset aman.
[ ] Duplicate publish aman.
[ ] Event contract backward-compatible.
```

### 13.2 SNS Event Contract Minimal

```json
{
  "eventId": "evt-...",
  "eventType": "CaseApproved",
  "eventVersion": 2,
  "occurredAt": "2026-06-19T10:15:30Z",
  "producer": "case-service",
  "correlationId": "corr-...",
  "tenantId": "cea",
  "payload": {
    "caseId": "CASE-2026-0001",
    "approvedBy": "officer-123"
  }
}
```

### 13.3 SNS Failure Playbook

Gejala:

```text
Subscriber tidak menerima event
Filter policy tidak match
SQS subscription kosong
Delivery failure meningkat
Duplicate event diterima
```

Langkah:

```text
1. Ambil MessageId dari Publish response.
2. Verifikasi topic ARN, region, account.
3. Verifikasi publish permission.
4. Verifikasi subscription confirmed.
5. Verifikasi filter policy terhadap message attributes.
6. Verifikasi raw message delivery setting.
7. Verifikasi SQS queue policy mengizinkan SNS topic.
8. Cek subscription DLQ bila ada.
9. Cek CloudWatch metrics publish/delivery failure.
10. Replay event hanya jika subscriber idempotent.
```

---

## 14. Lambda Readiness

Lambda readiness bukan hanya function berhasil invoke.

### 14.1 Lambda Checklist

```text
[ ] Runtime Java dipilih sesuai support lifecycle.
[ ] Handler kecil dan jelas.
[ ] Dependency package minimal.
[ ] Memory size diuji dengan p95/p99 latency.
[ ] Timeout sesuai event source.
[ ] Reserved concurrency dipertimbangkan.
[ ] Provisioned concurrency/SnapStart dipertimbangkan bila latency kritis.
[ ] Execution role least privilege.
[ ] Environment variable tidak menyimpan secret plaintext sensitif.
[ ] AWS SDK client diinisialisasi di luar handler bila aman.
[ ] `/tmp` usage dibatasi dan dibersihkan.
[ ] Batch partial failure aktif untuk SQS bila perlu.
[ ] Alias/version dipakai untuk deployment production.
[ ] Rollback procedure diuji.
```

AWS Lambda mendukung traffic shifting menggunakan weighted alias untuk canary deployment dan rollback cepat jika versi baru bermasalah. [3]

### 14.2 Lambda Timeout vs Event Source

| Event Source | Timeout Concern |
|---|---|
| API Gateway | User-facing latency; caller may timeout earlier |
| SQS | Function timeout harus lebih kecil dari visibility timeout |
| SNS | Async retry behavior; duplicate possible |
| S3 | Async event; duplicate/out-of-order possible |
| EventBridge | Retry/DLQ behavior perlu dipahami |

### 14.3 Lambda Rollback Playbook

```text
1. Identifikasi alias production saat ini.
2. Identifikasi versi lama yang sehat.
3. Cek CloudWatch metrics: errors, duration, throttles, iterator age/queue age.
4. Jika canary, set routing weight versi baru ke 0%.
5. Jika full cutover, ubah alias ke versi lama.
6. Verifikasi invocations masuk ke versi lama.
7. Monitor error rate minimal beberapa window.
8. Freeze deployment berikutnya sampai root cause jelas.
9. Cek apakah event yang gagal masuk retry/DLQ.
10. Jalankan replay hanya setelah handler aman.
```

### 14.4 Lambda Incident: Timeout Spike

```text
1. Cek Duration p95/p99 dan timeout count.
2. Cek apakah cold start meningkat.
3. Cek downstream latency: S3/SQS/KMS/DB/API.
4. Cek memory pressure dan CPU allocation.
5. Cek package/dependency change.
6. Cek concurrency/throttle.
7. Untuk SQS, cek visibility timeout dan duplicate processing.
8. Untuk API Gateway, cek client-facing timeout.
9. Rollback bila terkait deployment.
10. Tambah memory/concurrency hanya jika root cause mendukung.
```

---

## 15. EventBridge Readiness

EventBridge readiness memastikan routing dan scheduler tidak menjadi black box.

### 15.1 EventBridge Checklist

```text
[ ] Event bus owner jelas.
[ ] Event pattern rule diuji.
[ ] Target DLQ dikonfigurasi bila perlu.
[ ] Retry policy dipahami.
[ ] Archive/replay dikonfigurasi untuk event penting.
[ ] Schema/version governance ada.
[ ] Scheduler timezone dan DST dipahami.
[ ] Idempotency key disertakan dalam event.
[ ] Replay tidak menghasilkan duplicate side effect.
[ ] Cross-account event bus policy aman.
```

### 15.2 EventBridge Replay Readiness

Sebelum mengaktifkan replay, jawab:

```text
Apakah target handler idempotent?
Apakah replay window jelas?
Apakah event lama masih compatible dengan schema sekarang?
Apakah replay harus diarahkan ke target yang sama atau staging queue?
Apakah replay akan memicu notification external?
Apakah audit trail membedakan original event dan replay event?
```

### 15.3 Scheduler Readiness

Scheduled workload harus punya:

```text
schedule name
owner
timezone
expected fire time
maximum lateness tolerated
idempotency key formula
missed execution policy
manual rerun procedure
```

Cron tanpa owner adalah bom waktu.

---

## 16. Secrets Manager, SSM, and Rotation Readiness

Secrets/config readiness memastikan runtime tidak tergantung pada credential statis atau config liar.

### 16.1 Secrets Checklist

```text
[ ] Secret tidak disimpan di source code.
[ ] Secret tidak disimpan di container image.
[ ] Secret tidak muncul di log/metric/error.
[ ] Secret disimpan di Secrets Manager bila credential sensitif.
[ ] Non-secret config bisa memakai SSM Parameter Store.
[ ] Secret encrypted dengan KMS yang benar.
[ ] IAM principal hanya bisa membaca secret yang dibutuhkan.
[ ] Client-side caching dipakai untuk mengurangi latency/cost/throttle.
[ ] Rotation strategy jelas.
[ ] App behavior saat rotation diuji.
[ ] AWSCURRENT/AWSPREVIOUS/AWSPENDING dipahami.
[ ] Emergency rollback secret procedure ada.
```

Secrets Manager mendukung automatic rotation; dokumentasi AWS menjelaskan bahwa rotation memperbarui secret dan credential di database/service terkait, sedangkan best practices AWS merekomendasikan rotation, caching, least privilege, dan perlindungan akses. [5][7]

### 16.2 Rotation Readiness Questions

```text
Saat secret rotate, apakah existing connection tetap valid?
Apakah connection pool bisa refresh credential?
Apakah aplikasi membaca secret setiap request atau cache?
Berapa TTL cache?
Apa yang terjadi jika rotation Lambda gagal di tengah?
Apa yang terjadi jika AWSCURRENT salah?
Apakah rollback ke AWSPREVIOUS aman?
```

### 16.3 Secret Rotation Incident Playbook

Gejala:

```text
Authentication failed
DB login failed
SecretsManager throttling
KMS decrypt AccessDenied
Sudden 5xx after rotation
```

Langkah:

```text
1. Identifikasi secret ARN dan version stage.
2. Cek waktu rotation terakhir.
3. Cek apakah AWSCURRENT mengarah ke credential valid.
4. Cek AWSPREVIOUS apakah masih bisa dipakai.
5. Cek rotation Lambda logs.
6. Cek aplikasi cache TTL.
7. Cek HikariCP/connection pool error.
8. Cek KMS decrypt permission.
9. Jika AWSCURRENT rusak, restore staging label secara controlled.
10. Restart/refresh pool hanya setelah secret valid.
11. Catat timeline dan root cause.
```

---

## 17. KMS Readiness

KMS readiness memastikan encryption tidak hanya aktif, tetapi bisa dioperasikan.

### 17.1 KMS Checklist

```text
[ ] CMK/customer managed key dipakai bila governance perlu.
[ ] Key policy tidak terlalu luas.
[ ] IAM policy dan key policy konsisten.
[ ] Encryption context dipakai bila relevan.
[ ] Key rotation policy dipahami.
[ ] KMS quota/throttling dipahami.
[ ] KMS usage metrics/alarm dipertimbangkan.
[ ] Key deletion protection/process jelas.
[ ] Cross-account KMS access diuji.
[ ] CloudTrail merekam KMS usage penting.
```

### 17.2 KMS Failure Playbook

Gejala:

```text
KMS.AccessDeniedException
ThrottlingException
InvalidCiphertextException
DisabledException
KeyUnavailableException
```

Langkah:

```text
1. Identifikasi key ARN, caller principal, region.
2. Cek key state: enabled/disabled/pending deletion.
3. Cek key policy.
4. Cek IAM policy caller.
5. Cek encryption context mismatch.
6. Cek grant bila service menggunakan grant.
7. Cek CloudTrail KMS event.
8. Cek request rate terhadap quota.
9. Terapkan caching/data key reuse bila aman.
10. Jangan mengganti key sembarangan tanpa data migration plan.
```

---

## 18. Observability Readiness

Observability readiness menjawab:

> Saat sistem gagal, apakah kita bisa tahu apa yang terjadi tanpa redeploy dan tanpa menebak?

### 18.1 Logging Checklist

```text
[ ] Structured logging dipakai.
[ ] correlationId selalu ada.
[ ] AWS request ID dicatat untuk AWS call penting.
[ ] eventId/messageId/objectKey dicatat.
[ ] tenant/agency/entity id dicatat sesuai kebijakan data.
[ ] Secret/token/password tidak dicatat.
[ ] Error log punya error_code stabil.
[ ] Stack trace tidak spam untuk expected failure.
[ ] Log level konsisten.
[ ] Log retention sesuai compliance.
```

### 18.2 Metric Checklist

```text
[ ] Request count.
[ ] Success count.
[ ] Failure count by error_code.
[ ] Latency p50/p95/p99.
[ ] Retry count.
[ ] Throttling count.
[ ] Timeout count.
[ ] Queue depth.
[ ] Queue age.
[ ] DLQ count.
[ ] Lambda cold start indicator.
[ ] Secret cache refresh failure.
[ ] KMS decrypt failure.
[ ] S3 upload/download failure.
```

### 18.3 Trace Checklist

```text
[ ] Inbound request creates/propagates trace id.
[ ] Async message carries correlation id.
[ ] Worker logs include parent event id.
[ ] AWS downstream call spans captured where feasible.
[ ] Trace sampling policy understood.
[ ] High-cardinality attributes avoided in metrics.
```

### 18.4 Dashboard Minimal

Untuk event-driven Java workload:

```text
Panel 1: inbound events/messages per minute
Panel 2: success/failure rate
Panel 3: p95/p99 processing duration
Panel 4: retry/throttle/timeout count
Panel 5: SQS visible/not visible/oldest age
Panel 6: DLQ depth
Panel 7: Lambda errors/throttles/duration/concurrency
Panel 8: downstream AWS service errors
Panel 9: cost-sensitive metric: log volume, KMS calls, Secrets calls
```

### 18.5 Alarm Readiness

Alarm harus actionable.

Buruk:

```text
Alarm: Error > 0
Action: unknown
```

Baik:

```text
Alarm: DLQ visible messages > 0 for 5 minutes
Severity: High
Owner: case-processing team
Runbook: /runbooks/sqs-dlq-triage
Action: inspect DLQ, classify poison/systemic, pause redrive until root cause known
```

---

## 19. Auditability Readiness

Auditability berbeda dari observability.

Observability menjawab:

```text
Apakah sistem sehat?
Mengapa latency naik?
Dependency mana yang gagal?
```

Auditability menjawab:

```text
Siapa melakukan apa?
Kapan dilakukan?
Data apa yang berubah?
Apakah proses mengikuti aturan?
Apakah evidence bisa diverifikasi?
```

### 19.1 Audit Checklist

```text
[ ] Business audit event dibuat untuk state transition penting.
[ ] Technical audit event tersedia untuk AWS access penting.
[ ] CloudTrail aktif untuk management events.
[ ] CloudTrail data events aktif untuk bucket/table penting bila perlu.
[ ] Audit event immutable atau tamper-evident bila compliance perlu.
[ ] Time source konsisten UTC.
[ ] Actor, system, correlationId, requestId dicatat.
[ ] Before/after state atau transition reason dicatat sesuai kebutuhan.
[ ] Retention policy sesuai compliance.
[ ] Evidence retrieval procedure ada.
```

### 19.2 Audit Event Minimal

```json
{
  "auditId": "aud-...",
  "occurredAt": "2026-06-19T10:15:30Z",
  "actorType": "USER",
  "actorId": "officer-123",
  "system": "case-service",
  "action": "CASE_APPROVED",
  "entityType": "Case",
  "entityId": "CASE-2026-0001",
  "fromState": "PENDING_REVIEW",
  "toState": "APPROVED",
  "reasonCode": "REVIEW_COMPLETED",
  "correlationId": "corr-...",
  "sourceIp": "...",
  "awsRequestId": "..."
}
```

### 19.3 Incident Timeline Reconstruction

Runbook audit harus bisa membuat timeline:

```text
09:00 deployment started
09:05 Lambda alias shifted 10%
09:07 error rate increased
09:08 SQS age increased
09:10 DLQ received first message
09:12 rollback initiated
09:15 alias restored
09:20 redrive paused
09:45 root cause identified
10:30 safe replay completed
```

Tanpa timestamp dan correlation id, timeline menjadi opini.

---

## 20. Cost and Quota Readiness

Cost/quota readiness mencegah sistem gagal karena limit dan mencegah biaya liar.

### 20.1 Cost Checklist

```text
[ ] Cost driver per service diketahui.
[ ] S3 request/storage/lifecycle cost dipahami.
[ ] SQS request cost dipahami.
[ ] SNS fan-out cost dipahami.
[ ] Lambda duration/memory/invocation cost dipahami.
[ ] KMS per-request cost dipahami.
[ ] Secrets Manager per-secret/API call cost dipahami.
[ ] CloudWatch log ingestion/retention cost dipahami.
[ ] Batching dipakai bila aman.
[ ] Cache dipakai untuk Secrets/KMS/config bila aman.
[ ] Cost anomaly alert aktif untuk workload penting.
```

### 20.2 Quota Checklist

```text
[ ] Lambda concurrency quota cukup.
[ ] Reserved concurrency tidak melumpuhkan function lain.
[ ] SQS in-flight messages dipahami.
[ ] SNS publish throughput dipahami.
[ ] KMS request quota dipahami.
[ ] Secrets Manager API rate dipahami.
[ ] CloudWatch PutMetric/log volume dipahami.
[ ] Service Quotas request diajukan sebelum peak event.
```

### 20.3 Retry Cost Trap

Retry bukan hanya reliability concern. Retry adalah cost concern.

```text
1 failed S3 upload with 3 attempts
x 1 million files
= 3 million requests
```

Jika failure systemic, retry bisa menghabiskan quota dan biaya tanpa menghasilkan recovery.

---

## 21. Deployment Readiness

Deployment readiness menjawab:

> Apakah perubahan bisa dipromosikan, diverifikasi, dan dibatalkan dengan aman?

### 21.1 Deployment Checklist

```text
[ ] Artifact immutable.
[ ] Version jelas.
[ ] Build reproducible.
[ ] Environment config terpisah dari artifact.
[ ] Migration backward-compatible.
[ ] Lambda alias/version dipakai.
[ ] Canary/blue-green strategy jelas.
[ ] Rollback diuji.
[ ] Feature flag dipakai untuk behavior berisiko.
[ ] Smoke test pasca deployment.
[ ] Alarm deployment window lebih sensitif.
[ ] Deployment log/audit tersedia.
```

### 21.2 Safe Deployment Invariant

Deployment aman jika versi lama dan baru bisa coexist sementara.

Contoh:

```text
Event schema v2 masih bisa dibaca consumer v1.
DB column baru nullable dulu.
Publisher tidak langsung menghapus field lama.
Lambda alias bisa rollback tanpa data corruption.
```

### 21.3 Deployment Anti-Pattern

```text
Deploy producer event schema baru
Deploy consumer belakangan
Tidak ada backward compatibility
Event mulai gagal
DLQ penuh
Rollback producer tidak menghapus event rusak yang sudah terkirim
```

Solusi:

```text
Consumer-first deployment untuk schema additive.
Dual-read/dual-write bila perlu.
Schema versioning.
Contract test.
Replay-safe handler.
```

---

## 22. Testing Readiness

Testing readiness bukan hanya coverage.

### 22.1 Test Checklist

```text
[ ] Unit test untuk mapping/error handling.
[ ] Contract test untuk event schema.
[ ] Integration test dengan AWS sandbox atau LocalStack sesuai risk.
[ ] IAM policy test/simulation bila memungkinkan.
[ ] Failure injection untuk timeout/throttle/AccessDenied.
[ ] Duplicate event test.
[ ] Out-of-order event test.
[ ] DLQ test.
[ ] Replay test.
[ ] Secret rotation test.
[ ] Lambda cold start/performance test.
[ ] Load test untuk peak queue/event rate.
```

### 22.2 Failure Injection Matrix

| Failure | Expected Behavior |
|---|---|
| S3 NoSuchKey | retry/ignore/quarantine sesuai event type |
| SQS delete fails | message may redeliver; idempotency protects side effect |
| SNS publish timeout | retry with idempotent event id |
| KMS AccessDenied | fail fast and alert |
| Secrets unavailable | use cache if valid, otherwise fail safely |
| Lambda timeout | no partial commit without recovery marker |
| Event duplicate | no duplicate state transition |
| Event old version | accepted or rejected with clear error |

---

## 23. Runbook Design

Runbook adalah instruksi operasional saat stress tinggi.

Runbook harus jelas, bukan esai panjang.

### 23.1 Runbook Template

```text
# Runbook: <Incident Name>

## Purpose
Apa masalah yang ditangani runbook ini.

## Severity
Kapan dianggap low/medium/high/critical.

## Symptoms
Alarm/log/metric yang biasanya muncul.

## Immediate Actions
Langkah cepat untuk mengurangi impact.

## Diagnosis
Langkah investigasi berurutan.

## Decision Points
Kapan rollback, pause consumer, redrive, scale, atau escalate.

## Recovery Steps
Langkah pemulihan.

## Validation
Cara memastikan sistem pulih.

## Evidence to Capture
Log, metric, request id, event id, timestamp.

## Escalation
Siapa dihubungi.

## Prevention Follow-up
Action item setelah incident.
```

---

## 24. Playbook: SQS DLQ Redrive

### 24.1 Purpose

Memproses ulang message dari DLQ setelah root cause diperbaiki.

### 24.2 Precondition

```text
[ ] Root cause diketahui.
[ ] Fix sudah deployed.
[ ] Handler idempotent.
[ ] Message schema masih compatible.
[ ] Side effect duplicate aman.
[ ] Monitoring aktif.
[ ] Redrive batch kecil disiapkan.
```

### 24.3 Steps

```text
1. Ambil sample message dari DLQ.
2. Kelompokkan berdasarkan eventType/schemaVersion/errorCode.
3. Pilih satu kelompok dengan risk rendah.
4. Redrive jumlah kecil.
5. Monitor source queue age, consumer error, DLQ new messages.
6. Verifikasi business state.
7. Naikkan batch secara bertahap.
8. Stop redrive jika error muncul lagi.
9. Catat message count before/after.
```

### 24.4 Do Not

```text
Jangan redrive semua message tanpa root cause.
Jangan purge DLQ tanpa approval/evidence.
Jangan edit message manual tanpa audit.
Jangan replay jika handler tidak idempotent.
```

---

## 25. Playbook: Lambda Rollback

### 25.1 Purpose

Mengembalikan production Lambda ke versi sehat.

### 25.2 Trigger

```text
Error rate naik setelah deployment.
Duration/timeout spike.
DLQ mulai terisi.
Business transaction gagal.
Cold start latency tidak acceptable.
```

### 25.3 Steps

```text
1. Freeze deployment pipeline.
2. Identifikasi alias production.
3. Identifikasi version sebelum deployment.
4. Ubah alias routing ke version lama.
5. Jika canary, set weight version baru ke 0.
6. Monitor invocation version distribution.
7. Monitor errors/duration/throttles.
8. Cek async retry/DLQ backlog.
9. Putuskan apakah backlog perlu replay.
10. Buat incident record.
```

---

## 26. Playbook: Secret Rotation Failure

### 26.1 Purpose

Memulihkan aplikasi saat secret rotation menyebabkan authentication failure.

### 26.2 Steps

```text
1. Identifikasi secret ARN.
2. Cek staging labels AWSCURRENT/AWSPREVIOUS/AWSPENDING.
3. Validasi credential current terhadap target service.
4. Cek rotation Lambda logs.
5. Cek aplikasi yang masih memakai cached old secret.
6. Jika current invalid, rollback label ke previous sesuai approval.
7. Refresh aplikasi/connection pool bila perlu.
8. Monitor auth failure turun.
9. Disable rotation sementara jika root cause belum jelas.
10. Perbaiki rotation function/playbook.
```

---

## 27. Playbook: S3 Processing Backlog

### 27.1 Symptoms

```text
SQS queue age naik.
Worker processing lambat.
S3 object belum berpindah dari landing ke processed.
DLQ mulai terisi.
```

### 27.2 Diagnosis

```text
1. Cek jumlah object baru di landing prefix.
2. Cek SQS visible/not visible.
3. Cek worker/Lambda concurrency.
4. Cek S3 GetObject latency/error.
5. Cek KMS decrypt throttle.
6. Cek downstream DB/API latency.
7. Cek file size distribution.
8. Cek deployment terbaru.
```

### 27.3 Recovery

```text
1. Jika downstream sehat, scale consumer/concurrency.
2. Jika downstream sakit, throttle consumer agar tidak memperparah.
3. Jika poison files, quarantine berdasarkan error class.
4. Jika KMS throttled, reduce concurrency/cache data key bila desain mendukung.
5. Jika deployment bug, rollback.
6. Monitor oldest message age sampai turun.
```

---

## 28. Playbook: KMS Access or Throttling Incident

### 28.1 Symptoms

```text
KMS AccessDeniedException
KMS ThrottlingException
S3 SSE-KMS object access fails
Secrets decrypt fails
SQS/SNS encrypted message failure
```

### 28.2 Steps

```text
1. Identifikasi key ARN dan operation.
2. Cek apakah failure AccessDenied atau throttling.
3. Untuk AccessDenied, cek caller principal, IAM policy, key policy, grants.
4. Untuk throttling, cek request rate dan caller distribution.
5. Kurangi concurrency sementara bila throttling.
6. Pastikan retry memakai backoff+jitter.
7. Tambahkan cache bila aman.
8. Jangan disable encryption untuk recovery cepat tanpa risk approval.
```

---

## 29. Playbook: Cost Spike

### 29.1 Symptoms

```text
AWS Budget alert.
CloudWatch log ingestion spike.
KMS request spike.
Lambda duration spike.
SQS/SNS request spike.
S3 request spike.
```

### 29.2 Diagnosis

```text
1. Identifikasi service cost driver.
2. Korelasikan dengan deployment/event spike.
3. Cek retry/throttle metrics.
4. Cek log volume dan error spam.
5. Cek queue backlog dan redrive activity.
6. Cek Lambda concurrency/duration.
7. Cek Secrets/KMS cache failure.
8. Cek runaway scheduler.
```

### 29.3 Recovery

```text
1. Stop runaway job/scheduler.
2. Reduce concurrency bila retry storm.
3. Lower log level sementara bila aman.
4. Pause non-critical redrive.
5. Fix cache/secret polling issue.
6. Add guardrail alarm.
```

---

## 30. Production Go-Live Gate

Sebelum go-live, lakukan readiness review dengan format ini.

### 30.1 Go/No-Go Table

| Gate | Status | Evidence |
|---|---:|---|
| Architecture diagram reviewed | PASS/FAIL | link |
| IAM least privilege reviewed | PASS/FAIL | policy diff |
| Timeout/retry configured | PASS/FAIL | config |
| Idempotency tested | PASS/FAIL | test result |
| DLQ configured and runbook ready | PASS/FAIL | runbook |
| Secret rotation tested | PASS/FAIL | test evidence |
| Rollback tested | PASS/FAIL | deployment log |
| Dashboard ready | PASS/FAIL | dashboard link |
| Alarm ready | PASS/FAIL | alarm list |
| Cost/quota reviewed | PASS/FAIL | quota sheet |
| Audit evidence available | PASS/FAIL | CloudTrail/log sample |
| On-call owner assigned | PASS/FAIL | roster |

### 30.2 No-Go Conditions

Jangan production jika:

```text
Tidak ada rollback path.
Tidak ada owner.
Tidak ada DLQ untuk async critical flow.
Handler tidak idempotent tetapi event source bisa duplicate.
Secret ada di source/image/plain env tanpa mitigasi.
IAM menggunakan wildcard luas tanpa approval.
Tidak ada alarm untuk failure critical.
Tidak ada cara melihat message/event yang gagal.
Tidak ada runbook untuk recovery.
```

---

## 31. Java-Specific Production Readiness

Karena seri ini fokus Java, beberapa readiness khusus Java perlu eksplisit.

### 31.1 JVM Runtime Checklist

```text
[ ] Java version sesuai runtime support target.
[ ] Heap size/memory limit dipahami.
[ ] Container memory behavior diuji.
[ ] GC logs/JFR strategy tersedia untuk service long-running.
[ ] Thread pool sizing eksplisit.
[ ] Async SDK event loop tidak diblokir.
[ ] Shutdown hook/graceful shutdown diuji.
[ ] Object allocation besar pada S3 streaming dihindari.
[ ] JSON serialization error tertangani.
[ ] Dependency tree dipantau vulnerability-nya.
```

### 31.2 Java Worker Shutdown

Untuk container worker SQS:

```text
SIGTERM received
  -> stop polling new messages
  -> finish in-flight messages if possible
  -> extend visibility if needed
  -> delete only successful messages
  -> release resources
  -> shutdown AWS clients/HTTP pools
```

### 31.3 Lambda Java Shutdown Reality

Untuk Lambda, jangan mengandalkan long shutdown logic. Desain handler agar:

```text
partial progress tercatat,
operation idempotent,
timeout margin cukup,
side effect punya recovery marker,
replay aman.
```

---

## 32. Common Production Anti-Patterns

### 32.1 “DLQ Exists, So We Are Safe”

Salah. DLQ tanpa triage, alarm, owner, dan redrive procedure hanya memindahkan masalah.

### 32.2 “Retry More”

Retry bukan solusi umum. Retry harus bounded, jittered, dan idempotent.

### 32.3 “S3 Is a Filesystem”

S3 adalah object store. Jangan bergantung pada filesystem semantics seperti rename atomic folder.

### 32.4 “EventBridge/SNS/SQS Guarantees Business Ordering”

Ordering harus didesain di domain model, bukan diasumsikan dari transport.

### 32.5 “Secret Rotation Is Just Turn On Rotation”

Rotasi melibatkan aplikasi, connection pool, cache, target system, IAM, KMS, dan rollback.

### 32.6 “CloudWatch Logs Enough for Audit”

Logs operasional tidak selalu cukup untuk audit. Audit butuh actor, action, entity, timestamp, transition, dan tamper-resistance/retention.

### 32.7 “Lambda Is Always Cheaper”

Lambda bisa mahal untuk workload long-running, high-throughput, atau retry-heavy. Cost harus dihitung berdasarkan pattern nyata.

---

## 33. Production Readiness Document Template

Gunakan template berikut untuk setiap workload.

```markdown
# Production Readiness: <Service/Flow Name>

## 1. Scope

## 2. Owner
- Application owner:
- Operational owner:
- Security owner:
- Data owner:

## 3. Architecture
- Diagram:
- AWS services:
- Upstream:
- Downstream:

## 4. Critical Invariants
1.
2.
3.

## 5. Failure Modes
| Failure | Behavior | Recovery |
|---|---|---|

## 6. IAM and Security
- Execution role:
- Resource policies:
- KMS keys:
- Secrets:

## 7. Timeout/Retry
- SDK timeout:
- Retry mode:
- Queue visibility:
- Lambda timeout:

## 8. Idempotency
- Idempotency key:
- Store:
- TTL:
- Replay behavior:

## 9. Observability
- Logs:
- Metrics:
- Traces:
- Dashboard:
- Alarms:

## 10. Auditability
- Business audit events:
- CloudTrail:
- Retention:

## 11. Deployment
- Artifact:
- Strategy:
- Rollback:

## 12. Cost/Quota
- Main cost drivers:
- Quotas:
- Alarms:

## 13. Runbooks
- DLQ triage:
- Replay:
- Rollback:
- Secret rotation:

## 14. Go/No-Go Decision
- Decision:
- Approver:
- Date:
```

---

## 34. Final Mental Model

Production readiness adalah seni membuat sistem:

```text
understandable before failure,
observable during failure,
recoverable after failure,
and defensible under audit.
```

Untuk Java AWS integration, readiness harus mencakup:

```text
code correctness
+ cloud identity
+ network/runtime behavior
+ AWS service semantics
+ retry/idempotency
+ event replay safety
+ human runbook
+ audit evidence
+ cost/quota guardrails
```

Jika salah satu hilang, sistem masih mungkin berjalan, tetapi belum benar-benar production-ready.

---

## 35. Latihan Praktis

### Latihan 1 — Review SQS Worker

Ambil satu worker SQS di sistem Anda, lalu jawab:

```text
Apa idempotency key-nya?
Apa visibility timeout-nya?
Apa max processing time p99?
Apa maxReceiveCount?
Apa DLQ runbook-nya?
Apa metric queue age threshold-nya?
Apa yang terjadi jika deleteMessage gagal?
Apa yang terjadi jika handler crash setelah DB commit?
```

### Latihan 2 — Review Lambda Deployment

Untuk satu Lambda production:

```text
Apakah pakai alias?
Apakah rollback pernah diuji?
Apakah old version masih bisa membaca event baru?
Apakah memory size berdasarkan benchmark?
Apakah timeout lebih kecil dari SQS visibility timeout?
Apakah reserved concurrency perlu?
```

### Latihan 3 — Review Secret Rotation

Untuk satu secret:

```text
Siapa owner secret?
Apakah rotation aktif?
Apa cache TTL aplikasi?
Apa yang terjadi pada HikariCP saat password berubah?
Apakah AWSPREVIOUS bisa dipakai rollback?
Apakah secret pernah muncul di log?
```

### Latihan 4 — Build One Runbook

Pilih satu incident paling mungkin:

```text
SQS DLQ penuh
Lambda timeout spike
S3 processing backlog
Secret rotation failure
KMS AccessDenied
Cost spike
```

Tulis runbook 1 halaman dengan template di atas.

---

## 36. Ringkasan

Di Part 34, kita menyusun kerangka production readiness untuk Java AWS integration:

1. production readiness bukan checklist kosmetik,
2. readiness punya tiga level: code, runtime, operational,
3. AWS integration harus dinilai dari IAM, SDK, timeout, retry, idempotency, observability, auditability, cost, quota, dan deployment,
4. DLQ, retry, dan logs bukan solusi otomatis,
5. setiap failure path harus punya runbook,
6. setiap replay/rollback/rotation harus diuji,
7. sistem production harus bisa dipahami, diamati, dipulihkan, dan diaudit.

Bagian ini menjadi jembatan menuju Part 35, yaitu capstone: mendesain platform internal reusable untuk Java AWS integration.

---

## 37. Referensi

[1] AWS Well-Architected Framework — https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html  
[2] AWS Well-Architected Operational Excellence Pillar — https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html  
[3] AWS Lambda weighted alias/canary deployment — https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html  
[4] Amazon SQS Dead-Letter Queues — https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html  
[5] AWS Secrets Manager Best Practices — https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html  
[6] Amazon SQS DLQ Redrive — https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html  
[7] AWS Secrets Manager Rotation — https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html

---

## 38. Status Seri

- Part ini: **Part 34 — Production Readiness Checklist and Operational Playbooks**
- Status: **belum selesai**
- Bagian berikutnya: **Part 35 — Capstone: Designing a Top-Tier Java AWS Integration Platform**
- Part 35 adalah **bagian terakhir** dari seri ini.
