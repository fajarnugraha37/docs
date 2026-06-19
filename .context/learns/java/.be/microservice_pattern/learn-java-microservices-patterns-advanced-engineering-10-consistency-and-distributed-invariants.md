# learn-java-microservices-patterns-advanced-engineering-10-consistency-and-distributed-invariants

# Part 10 — Consistency Pattern and Distributed Invariants

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `10 / 35`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Principal Engineer / Architecture Review  
> Fokus: consistency, invariant, correctness, distributed data, eventual consistency, reconciliation, and defensible business correctness.

---

## 0. Tujuan Part Ini

Setelah mempelajari synchronous API, asynchronous messaging, event-driven architecture, saga, compensation, outbox, inbox, dan CDC, sekarang kita masuk ke inti correctness microservices:

> Bagaimana memastikan sistem tetap benar ketika data tersebar di banyak service, transaksi lokal, message bisa datang terlambat/duplikat/out-of-order, read model bisa stale, dan user tetap mengharapkan hasil yang masuk akal?

Part ini bukan sekadar membahas:

```text
strong consistency vs eventual consistency
```

Itu terlalu dangkal.

Part ini membahas:

1. Apa arti consistency di sistem bisnis.
2. Mengapa database consistency tidak otomatis sama dengan business correctness.
3. Cara memetakan invariant.
4. Cara menentukan invariant mana yang harus kuat, eventual, compensatable, atau hanya perlu detective control.
5. Cara memilih pattern: reservation, escrow, saga, outbox, reconciliation, materialized view, CQRS, confirmation, correction.
6. Cara mendesain consistency yang bisa dipertanggungjawabkan saat incident, audit, compliance review, atau production failure.

Microservices yang matang tidak mengejar “semua harus consistent sekarang juga”. Microservices yang matang tahu:

```text
mana yang harus benar sebelum commit,
mana yang boleh benar setelah beberapa detik,
mana yang boleh dikoreksi,
mana yang harus dicegah,
mana yang harus diaudit,
dan mana yang tidak boleh pernah terjadi.
```

---

## 1. Masalah Utama: Distributed Correctness

Di monolith dengan satu database, kita sering mengandalkan transaksi ACID:

```text
BEGIN
  update application
  insert approval_history
  update applicant_status
  insert audit_log
COMMIT
```

Jika semua tabel berada di satu database dan satu transaction boundary, correctness relatif mudah dipahami.

Namun di microservices, data mungkin tersebar:

```text
Application Service
  owns application state

Eligibility Service
  owns eligibility decision

Payment Service
  owns fee/payment state

Document Service
  owns uploaded document metadata

Notification Service
  owns delivery attempts

Case Service
  owns enforcement/case lifecycle

Audit Service
  owns immutable audit records
```

Sekarang flow bisnis bisa menjadi:

```text
1. Application submitted
2. Document validation requested
3. Eligibility checked
4. Fee payment required
5. Payment received
6. Application routed to officer
7. Officer approves
8. Licence generated
9. Notification sent
10. Audit trail completed
```

Pertanyaannya:

```text
Apakah semua langkah harus berada dalam satu transaksi global?
```

Biasanya tidak.

Pertanyaan yang lebih tepat:

```text
Invariant bisnis apa yang harus selalu dijaga?
Siapa owner invariant itu?
Kapan invariant itu harus benar?
Apa yang terjadi jika sementara belum benar?
Bagaimana sistem mendeteksi dan memperbaikinya?
Apa bukti auditnya?
```

---

## 2. Consistency Bukan Satu Hal

Kata “consistency” sering membingungkan karena dipakai untuk beberapa hal yang berbeda.

### 2.1 Database Consistency

Dalam ACID, consistency berarti transaksi membawa database dari satu valid state ke valid state lain sesuai constraint yang didefinisikan.

Contoh:

```sql
CHECK (amount >= 0)
UNIQUE (application_no)
FOREIGN KEY (applicant_id) REFERENCES applicant(id)
```

Ini bagus, tetapi terbatas pada constraint yang diketahui database.

Database tidak tahu aturan seperti:

```text
A licence must not be issued unless:
- application is approved,
- required fees are paid,
- mandatory documents are verified,
- applicant is not under active enforcement restriction,
- officer approval is not self-approved by the applicant,
- approval is within delegated authority.
```

Sebagian aturan itu adalah business invariant, bukan sekadar database constraint.

### 2.2 Replica Consistency

Ini tentang apakah beberapa replica data melihat state yang sama.

Contoh:

```text
Primary DB sudah menerima update.
Read replica belum catch up.
User refresh dashboard dan masih melihat old state.
```

### 2.3 API Consistency

Ini tentang apakah API response konsisten dengan operasi sebelumnya.

Contoh:

```text
POST /applications/123/submit returns 202 Accepted
GET /applications/123 still shows DRAFT for 3 seconds
```

Apakah ini bug?

Tergantung contract.

Jika API menjanjikan immediate consistency, itu bug. Jika API menjanjikan eventual processing, itu expected.

### 2.4 Read Model Consistency

CQRS/materialized view/search index sering stale.

Contoh:

```text
Application state in write DB: APPROVED
Search index: still PENDING_REVIEW
Dashboard projection: still ASSIGNED
```

Ini bukan otomatis bug. Ini harus punya freshness SLA.

### 2.5 Business Consistency

Ini yang paling penting.

Business consistency berarti state sistem masuk akal menurut aturan domain.

Contoh:

```text
Tidak boleh ada licence ACTIVE untuk application yang REJECTED.
Tidak boleh ada enforcement case CLOSED tanpa closure reason.
Tidak boleh ada refund lebih besar dari paid amount.
Tidak boleh ada two active licences for mutually exclusive category.
Tidak boleh ada officer approve case yang conflict-of-interest.
```

Top 1% engineer tidak mulai dari “pakai strong consistency atau eventual consistency?”

Mereka mulai dari:

```text
Apa invariant bisnisnya?
Apa konsekuensi jika invariant itu dilanggar?
Berapa lama pelanggaran sementara bisa diterima?
Bisakah dikoreksi?
Siapa yang harus diberi tahu?
Apa evidence-nya?
```

---

## 3. Mental Model: Consistency adalah Waktu + Scope + Invariant

Consistency perlu dilihat sebagai kombinasi tiga dimensi:

```text
Consistency = Scope + Time + Invariant
```

### 3.1 Scope

Scope menjawab:

```text
Data/service mana yang harus konsisten satu sama lain?
```

Contoh:

```text
Within one row
Within one aggregate
Within one database
Within one service
Across two services
Across many services
Across external systems
Across human decision process
```

Semakin luas scope, semakin mahal consistency.

### 3.2 Time

Time menjawab:

```text
Kapan harus konsisten?
```

Pilihan umum:

```text
Immediately before response
Immediately after local commit
Within seconds
Within minutes
Before next business step
Before legal effect
Before notification
Before reporting cutoff
Before end-of-day reconciliation
Before audit export
```

Tidak semua invariant harus benar di waktu yang sama.

### 3.3 Invariant

Invariant menjawab:

```text
Aturan apa yang tidak boleh dilanggar?
```

Contoh:

```text
A submitted application must have at least one applicant.
An approved application must have a valid approval decision.
A payment receipt must not be issued before payment confirmation.
A licence number must be globally unique.
A suspended licence must not be renewed automatically.
```

Tanpa invariant yang eksplisit, consistency discussion biasanya berubah menjadi debat abstrak.

---

## 4. Jenis Consistency dalam Distributed Systems

Kita tidak perlu menjadi researcher distributed systems untuk mendesain microservices, tetapi harus cukup paham istilah utama agar tidak membuat klaim keliru.

### 4.1 Strong Consistency

Secara praktis, strong consistency berarti setelah write berhasil, read berikutnya melihat write tersebut.

Dalam sistem bisnis, ini sering diterjemahkan sebagai:

```text
User melakukan operasi.
Jika operasi sukses, state yang relevan langsung terlihat benar.
```

Cocok untuk:

```text
- issuing unique number
- preventing duplicate approval
- balance update
- inventory reservation critical path
- legal state transition
- permission-critical state
```

Trade-off:

```text
- lebih mahal
- lebih lambat
- lebih sulit scale across regions
- lebih rentan availability trade-off
- perlu single authority yang jelas
```

### 4.2 Eventual Consistency

Eventual consistency berarti jika tidak ada update baru, sistem pada akhirnya akan converge ke state yang sama/benar.

Contoh:

```text
Write model: APPROVED
Projection/dashboard: PENDING_REVIEW
After event consumed: APPROVED
```

Eventual consistency bukan berarti:

```text
boleh salah selamanya
boleh tidak ada monitoring
boleh tidak ada reconciliation
boleh tidak ada SLA
```

Eventual consistency yang production-grade membutuhkan:

```text
- convergence condition
- freshness expectation
- retry mechanism
- idempotent consumer
- reconciliation
- observability
- user-facing state language
```

### 4.3 Causal Consistency

Causal consistency berarti operasi yang secara sebab-akibat terkait harus terlihat dalam urutan yang benar.

Contoh:

```text
Officer approves application.
System emits ApplicationApproved.
Licence service receives event and creates licence.
Notification says licence issued.
```

Notification tidak boleh muncul sebelum approval secara causal.

Dalam praktik microservices, causal consistency sering dijaga dengan:

```text
- causation id
- correlation id
- event sequence
- aggregate version
- per-aggregate ordering
- workflow state machine
```

### 4.4 Read-Your-Writes Consistency

User yang baru melakukan write ingin melihat hasilnya saat read.

Contoh:

```text
User submits application.
Immediately opens application detail.
It should not look like submission failed.
```

Jika read model async, kita bisa desain UX:

```text
Application submitted.
Processing validation...
Status will refresh automatically.
```

Atau gunakan:

```text
- read from write model for detail page
- session-level cache
- command response includes latest state
- polling status endpoint
- projection lag indicator
```

### 4.5 Monotonic Reads

Jika user sudah pernah melihat state lebih baru, jangan tampilkan state lebih lama.

Contoh buruk:

```text
Refresh 1: APPROVED
Refresh 2: PENDING_REVIEW
```

Ini merusak trust.

Solusi:

```text
- sticky read replica
- version-aware response
- client remembers minimum version
- server waits until projection >= requested version
```

### 4.6 Serializability

Serializability berarti hasil eksekusi concurrent transactions sama seperti jika transactions dijalankan satu per satu dalam suatu urutan.

Ini kuat, tetapi biasanya scope-nya database atau transactional store tertentu.

Di microservices, kita jarang mendapat serializability across services tanpa distributed transaction/consensus-backed database.

### 4.7 Linearizability

Linearizability lebih kuat: operasi terlihat terjadi secara instan pada satu titik waktu antara request dan response, sesuai real-time order.

Cocok untuk:

```text
- distributed lock
- leader election
- unique sequence allocation
- critical decision register
```

Namun mahal.

Jangan mengklaim sistem linearizable hanya karena memakai REST atau Kafka.

---

## 5. Invariant: Unit Utama Business Correctness

Invariant adalah aturan yang harus dijaga oleh sistem.

Contoh sederhana:

```text
Application cannot be APPROVED before it is SUBMITTED.
```

Contoh lebih kompleks:

```text
An enforcement case cannot be CLOSED unless:
- all mandatory actions are completed,
- outstanding penalties are resolved or waived,
- closure reason is recorded,
- approving officer has authority,
- audit record is immutable.
```

Invariant bisa dibagi berdasarkan scope dan konsekuensi.

---

## 6. Invariant Classification

### 6.1 Local Invariant

Invariant yang bisa dijaga dalam satu aggregate/service/database transaction.

Contoh:

```text
Application status transition DRAFT -> SUBMITTED requires at least one applicant.
```

Cara menjaga:

```text
- domain model validation
- database constraint
- transaction boundary
- optimistic lock
```

Ini harus strong.

### 6.2 Cross-Aggregate Same-Service Invariant

Invariant lintas aggregate tetapi masih dalam satu service.

Contoh:

```text
One applicant cannot have two active applications for the same licence type.
```

Jika semua data ada di Application Service, bisa dijaga dengan:

```text
- unique constraint
- transactional check
- locking
- reservation table
```

### 6.3 Cross-Service Invariant

Invariant yang membutuhkan data dari service lain.

Contoh:

```text
Application cannot be approved if applicant has active enforcement restriction.
```

Application Service butuh informasi dari Enforcement Service.

Pilihan desain:

```text
1. synchronous check at approval time
2. local replicated restriction view
3. reservation/hold from enforcement service
4. approval allowed but subject to post-approval reconciliation
5. move decision ownership to a policy/eligibility service
```

Tidak ada jawaban universal.

### 6.4 Temporal Invariant

Invariant yang bergantung pada waktu.

Contoh:

```text
If applicant does not pay within 14 days, application expires.
```

Butuh:

```text
- timer
- scheduler
- workflow engine
- idempotent timeout handler
- clock handling
- audit event
```

### 6.5 Eventual Invariant

Invariant yang boleh sementara tidak benar, tetapi harus converge.

Contoh:

```text
Dashboard count must eventually match application records.
```

Boleh stale sementara.

Tetapi harus ada:

```text
- projection update
- lag metric
- reconciliation
- correction job
```

### 6.6 Compensatable Invariant

Invariant yang boleh dilanggar sementara karena bisa dikoreksi secara bisnis.

Contoh:

```text
Notification sent with outdated status.
```

Bisa dikompensasi dengan:

```text
- send correction notice
- mark previous notice superseded
- audit both notices
```

Namun tidak semua hal compensatable.

Contoh yang sulit dikompensasi:

```text
Licence legally issued to ineligible person.
Money paid to wrong bank account.
Confidential data sent to wrong recipient.
```

### 6.7 Non-Compensatable Invariant

Invariant yang harus dicegah sebelum side effect terjadi.

Contoh:

```text
Do not issue licence unless legal conditions are satisfied.
Do not disclose restricted document to unauthorized user.
Do not approve case by unauthorized officer.
```

Pattern:

```text
- strong consistency at authority boundary
- synchronous policy decision
- transactional state transition
- permission check inside service
- legal effect delayed until confirmation
```

### 6.8 Audit/Legal Invariant

Invariant yang harus bisa dibuktikan.

Contoh:

```text
Every approval must have approving officer, timestamp, decision reason, source IP/device/session, and immutable audit record.
```

Audit invariant tidak cukup dengan “sistem melakukan benar”. Sistem harus bisa menunjukkan evidence.

---

## 7. Invariant Mapping Table

Gunakan tabel seperti ini saat architecture review.

| Invariant | Scope | Owner | Required Consistency | Time Window | Violation Impact | Pattern |
|---|---:|---|---|---|---|---|
| Licence number unique | Global | Licence Service | Strong | Before issue | Legal/data corruption | sequence/unique constraint |
| Dashboard count accurate | Projection | Reporting Service | Eventual | < 5 min | Operational confusion | projection + reconciliation |
| Payment not double-captured | Payment | Payment Service | Strong/idempotent | Before capture | Financial loss | idempotency key + unique transaction |
| Application cannot approve before documents verified | Cross-service | Application/Document | Strong before legal effect | Before approval | Wrong decision | synchronous check or local verified view |
| Notification reflects final state | Cross-service | Notification | Eventual/compensatable | Before send or correction after | User confusion | event + correction notice |
| Audit record exists for approval | Cross-service | Audit/Application | Strong-ish or guaranteed eventual | Immediately or before finalization | Audit failure | outbox + reconciliation |

Top-tier architecture review selalu punya tabel seperti ini, walau formatnya bisa berbeda.

---

## 8. Consistency Decision Framework

Ketika menemukan invariant, tanyakan berurutan.

### 8.1 Pertanyaan 1: Apa konsekuensi jika salah?

Kategori:

```text
Cosmetic
Operational confusion
Customer/user confusion
Financial loss
Legal/regulatory breach
Security breach
Data corruption
Irreversible external side effect
```

Semakin tinggi konsekuensi, semakin kuat consistency/control yang dibutuhkan.

### 8.2 Pertanyaan 2: Bisakah dikoreksi?

```text
Can correct silently?
Can correct with notification?
Can correct with human approval?
Can compensate financially?
Cannot compensate?
```

Jika tidak bisa dikompensasi, cegah sebelum terjadi.

### 8.3 Pertanyaan 3: Siapa authority?

Invariant harus punya owner.

Contoh buruk:

```text
Application Service checks payment status sometimes.
Payment Service emits events sometimes.
Officer UI also checks payment directly.
Reporting DB also has payment copy.
```

Ini bukan architecture; ini accidental distributed policy.

Contoh lebih baik:

```text
Payment Service is authority for payment confirmation.
Application Service is authority for application lifecycle.
Approval transition requires payment confirmation snapshot produced by Payment Service.
```

### 8.4 Pertanyaan 4: Kapan harus benar?

```text
Before command accepted?
Before local commit?
Before event published?
Before legal effect?
Before notification?
Before reporting?
Before audit close?
```

Banyak sistem rusak karena semua orang memakai kata “before” tetapi maksudnya berbeda.

### 8.5 Pertanyaan 5: Apakah stale data bisa diterima?

Jika bisa, tentukan:

```text
Maximum staleness
Lag metric
User indication
Reconciliation mechanism
Escalation threshold
```

### 8.6 Pertanyaan 6: Apa yang terjadi saat dependency down?

Pilihan:

```text
Fail closed
Fail open
Queue command
Accept pending state
Use cached decision
Use last-known-good state
Require manual review
Disable feature temporarily
```

Untuk security/legal invariant, biasanya fail closed.

Untuk non-critical notification, bisa queue.

### 8.7 Pertanyaan 7: Bagaimana kita tahu sudah converge?

Eventual consistency tanpa convergence check adalah wishful thinking.

Butuh:

```text
- lag metrics
- missing event detector
- reconciliation job
- checksum comparison
- count comparison
- state mismatch report
- repair workflow
```

---

## 9. Pattern 1: Single Authority Pattern

Satu invariant harus dimiliki oleh satu authority.

Contoh:

```text
Licence Service owns licence issuance.
Payment Service owns payment capture.
Application Service owns application lifecycle.
Document Service owns document verification state.
```

Service lain boleh punya copy, tetapi copy bukan authority.

### 9.1 Rule

```text
Only the authority service may decide or mutate the authoritative state.
Other services may request, observe, or cache.
```

### 9.2 Anti-pattern

```text
Multiple services update status column in shared DB.
```

Atau:

```text
Application Service directly writes Payment table to mark PAID.
```

Ini menghancurkan ownership.

### 9.3 Java Implication

Jangan share repository/entity across services.

Buruk:

```java
// shared library used by Application Service and Payment Service
@Entity
public class PaymentEntity {
    @Id
    private Long id;
    private String status;
}
```

Lebih baik:

```java
// Application Service owns only its local view
public final class PaymentConfirmationView {
    private final String paymentId;
    private final String applicationId;
    private final PaymentConfirmationStatus status;
    private final long version;
}
```

Shared DTO pun harus hati-hati. Shared domain model hampir selalu membuat coupling berbahaya.

---

## 10. Pattern 2: Local Strong Consistency, External Eventual Consistency

Pattern paling umum dalam microservices:

```text
Inside service: strong local transaction
Across services: eventual consistency via events/messages
```

Contoh:

```text
Application Service transaction:
- update application status to SUBMITTED
- insert application history
- insert outbox ApplicationSubmitted
COMMIT

Message relay publishes ApplicationSubmitted.
Other services react eventually.
```

Ini didukung oleh transactional outbox pattern.

### 10.1 Kelebihan

```text
- local correctness kuat
- tidak butuh distributed transaction
- reliable event publishing
- service tetap loosely coupled
```

### 10.2 Risiko

```text
- projection lag
- duplicate events
- out-of-order processing
- consumer failure
- temporary inconsistency
```

### 10.3 Syarat Production-Grade

```text
- outbox table
- idempotent consumers
- retry policy
- DLQ/parking lot
- reconciliation
- monitoring lag
- event schema versioning
```

---

## 11. Pattern 3: Reservation Pattern

Reservation digunakan ketika kita perlu “menahan hak” sebelum finalisasi.

Contoh:

```text
Seat reservation before payment.
Inventory reservation before checkout.
Application slot reservation before submission.
Licence number reservation before issuance.
```

### 11.1 Flow

```text
1. Client requests reservation.
2. Authority service creates RESERVED state with expiry.
3. Other workflow steps proceed.
4. Final confirmation consumes reservation.
5. Timeout releases reservation.
```

### 11.2 State

```text
AVAILABLE -> RESERVED -> CONFIRMED
             RESERVED -> EXPIRED
             RESERVED -> CANCELLED
```

### 11.3 Java Model

```java
public enum ReservationStatus {
    RESERVED,
    CONFIRMED,
    EXPIRED,
    CANCELLED
}

public final class Reservation {
    private final String reservationId;
    private final String resourceId;
    private final String ownerId;
    private final ReservationStatus status;
    private final Instant expiresAt;
    private final long version;

    public Reservation confirm(Instant now) {
        if (status != ReservationStatus.RESERVED) {
            throw new IllegalStateException("Only RESERVED reservation can be confirmed");
        }
        if (!now.isBefore(expiresAt)) {
            throw new IllegalStateException("Reservation already expired");
        }
        return new Reservation(
                reservationId,
                resourceId,
                ownerId,
                ReservationStatus.CONFIRMED,
                expiresAt,
                version + 1
        );
    }

    public Reservation expire(Instant now) {
        if (status != ReservationStatus.RESERVED) {
            return this;
        }
        if (now.isBefore(expiresAt)) {
            return this;
        }
        return new Reservation(
                reservationId,
                resourceId,
                ownerId,
                ReservationStatus.EXPIRED,
                expiresAt,
                version + 1
        );
    }
}
```

### 11.4 Failure Modes

```text
Reservation never confirmed
Reservation timeout job fails
Double reservation race
Expired reservation confirmed late
Reservation event duplicated
```

### 11.5 Required Controls

```text
- unique constraint on active reservation
- expiry timestamp
- idempotent confirm
- scheduled expiry job
- reconciliation for expired but still held resource
```

---

## 12. Pattern 4: Escrow Pattern

Escrow pattern membagi resource menjadi bagian-bagian yang bisa dialokasikan tanpa central coordination setiap saat.

Contoh:

```text
Total quota: 10,000
Region A receives escrow allocation: 3,000
Region B receives escrow allocation: 3,000
Region C receives escrow allocation: 4,000
```

Setiap region bisa mengurangi quota lokal selama tidak melebihi escrow allocation.

Cocok untuk:

```text
- quota allocation
- inventory bucket
- rate/usage credits
- distributed counter with bounded error
```

Tidak cocok untuk:

```text
- legal unique issuance
- small scarce resource
- strict one-at-a-time approval
```

### 12.1 Trade-off

```text
+ high availability
+ less coordination
+ scalable
- complexity
- rebalancing required
- allocation may be temporarily inefficient
```

---

## 13. Pattern 5: Confirmation Pattern

Confirmation pattern memisahkan provisional state dari final state.

Contoh:

```text
Application approval decision prepared.
Legal issuance not effective until final confirmation.
```

Flow:

```text
DRAFT -> SUBMITTED -> REVIEWED -> APPROVAL_PREPARED -> ISSUED
```

Kenapa berguna?

Karena beberapa check bisa dilakukan async sebelum final legal effect.

```text
APPROVAL_PREPARED:
- officer has approved
- documents look valid
- payment is confirmed locally
- restriction check pending final confirmation

ISSUED:
- all non-compensatable invariants verified
- licence number allocated
- audit record guaranteed
```

Ini sangat penting untuk domain yang punya legal/regulatory effect.

---

## 14. Pattern 6: Reconciliation Pattern

Reconciliation adalah proses membandingkan state antar sumber untuk mendeteksi dan memperbaiki mismatch.

Contoh:

```text
Application Service says APPROVED.
Licence Service has no licence.
Audit Service has no approval audit.
Notification Service sent rejection notice.
```

Tanpa reconciliation, eventual consistency bisa gagal diam-diam.

### 14.1 Jenis Reconciliation

```text
Count reconciliation
Checksum reconciliation
State-machine reconciliation
Event-gap reconciliation
Cross-service invariant reconciliation
External-system reconciliation
```

### 14.2 Reconciliation Table

| Type | Example | Frequency | Repair |
|---|---|---:|---|
| Count | approved applications vs issued licences | hourly | create missing investigation |
| Event gap | missing event sequence | near-real-time | replay from offset |
| State mismatch | application approved but licence absent | daily/hourly | repair workflow |
| External | payment gateway captured but local unpaid | hourly | update payment state |
| Audit | decision exists but audit absent | near-real-time | create audit correction record |

### 14.3 Reconciliation Result

Jangan hanya log mismatch.

Harus ada lifecycle:

```text
DETECTED -> CLASSIFIED -> REPAIR_REQUESTED -> REPAIRED -> VERIFIED
                         -> MANUAL_REVIEW
                         -> ACCEPTED_EXCEPTION
```

### 14.4 Java Skeleton

```java
public interface ReconciliationRule {
    String name();
    List<ReconciliationMismatch> detect(ReconciliationWindow window);
    RepairPlan planRepair(ReconciliationMismatch mismatch);
}

public final class ReconciliationMismatch {
    private final String mismatchId;
    private final String ruleName;
    private final String subjectType;
    private final String subjectId;
    private final String expected;
    private final String actual;
    private final Instant detectedAt;
    private final Severity severity;
}
```

---

## 15. Pattern 7: Detective Control vs Preventive Control

Tidak semua invariant harus dicegah sebelum terjadi.

### 15.1 Preventive Control

Mencegah violation.

Contoh:

```text
Do not approve if officer lacks authority.
```

Pattern:

```text
- synchronous authorization check
- local permission snapshot with version
- database constraint
- state machine guard
```

### 15.2 Detective Control

Mendeteksi violation setelah terjadi.

Contoh:

```text
Dashboard count inconsistent with source records.
```

Pattern:

```text
- reconciliation job
- anomaly detection
- alert
- repair workflow
```

### 15.3 Corrective Control

Memperbaiki violation.

Contoh:

```text
Projection missing an event.
Replay event and rebuild projection.
```

### 15.4 Decision Rule

```text
If violation is irreversible, security-sensitive, legal-sensitive, or financially material:
    prefer preventive control.
Else if violation is temporary and repairable:
    detective + corrective may be acceptable.
```

---

## 16. Pattern 8: Compensating Correction

Correction berbeda dari rollback.

Rollback mencoba menghapus efek sebelumnya.

Correction membuat efek baru yang memperbaiki atau menetralkan efek sebelumnya.

Contoh:

```text
Wrong notification sent:
- Do not delete sent notification.
- Send correction notification.
- Mark old notice as superseded.
- Audit both.
```

Contoh:

```text
Application wrongly moved to APPROVED:
- Move to APPROVAL_REVOKED or REOPENED.
- Record reason.
- Notify affected users.
- Preserve original approval history.
```

Dalam sistem regulated, correction harus preserve history.

Anti-pattern:

```text
UPDATE status = 'PENDING' WHERE id = ?
DELETE FROM approval_history WHERE application_id = ?
```

Ini menghapus evidence.

---

## 17. Pattern 9: Consistency SLA

Eventual consistency harus punya SLA.

Contoh:

```text
Application search projection must reflect lifecycle state within 60 seconds for 99% of updates.
Dashboard aggregates must converge within 5 minutes.
Audit records for legally effective decisions must be persisted within 5 seconds or decision finalization must fail/hold.
```

### 17.1 Metrics

```text
projection_lag_seconds
outbox_oldest_unpublished_age_seconds
consumer_lag_records
reconciliation_mismatch_count
reconciliation_oldest_unresolved_age_seconds
stale_read_served_total
read_model_version_gap
```

### 17.2 Alert Examples

```text
outbox_oldest_unpublished_age_seconds > 60 for 5 minutes
projection_lag_seconds p99 > 300
reconciliation_mismatch_count critical > 0
unresolved_legal_invariant_mismatch_age > 0
```

---

## 18. Pattern 10: Version-Aware Reads

Read models can be stale. Version-aware reads make staleness explicit.

Command response:

```json
{
  "applicationId": "APP-123",
  "status": "SUBMITTED",
  "aggregateVersion": 42,
  "projectionHint": {
    "minimumVersion": 42
  }
}
```

Read request:

```http
GET /applications/APP-123?minVersion=42
```

Server options:

```text
1. If projection >= 42, return projection.
2. If projection < 42, wait briefly.
3. If still stale, return 202/409/425-style domain response.
4. Or read from authoritative write model.
```

Response:

```json
{
  "status": "PROCESSING",
  "message": "The application was submitted and the listing view is still updating.",
  "currentProjectionVersion": 40,
  "requiredVersion": 42
}
```

This prevents user confusion.

---

## 19. Designing User Experience for Eventual Consistency

A technically correct eventually consistent system can still feel broken.

Bad UX:

```text
User clicks Submit.
Success message appears.
List still shows Draft.
User clicks Submit again.
Duplicate command occurs.
```

Better UX:

```text
Application submitted.
Validation is being processed.
Status: Submission received.
Reference: SUB-2026-00123.
```

Design states explicitly:

```text
DRAFT
SUBMISSION_RECEIVED
VALIDATING
SUBMITTED
PENDING_REVIEW
APPROVED
REJECTED
```

Do not pretend async operation is instant.

---

## 20. State Design for Consistency

Many consistency problems come from poor status modeling.

Bad:

```text
status = PENDING
```

Pending what?

Better:

```text
PENDING_DOCUMENT_VALIDATION
PENDING_PAYMENT_CONFIRMATION
PENDING_OFFICER_REVIEW
PENDING_FINAL_ISSUANCE
PENDING_EXTERNAL_SYSTEM_SYNC
```

Explicit intermediate states make eventual consistency understandable and operable.

---

## 21. Strong vs Eventual: Decision Matrix

| Situation | Recommended Consistency | Reason |
|---|---|---|
| Unique licence number | Strong | Duplicate has legal impact |
| Search listing | Eventual | Stale data usually acceptable |
| Payment capture | Strong/idempotent | Financial side effect |
| Notification | Eventual/compensatable | Can retry/correct |
| Audit for final legal action | Strong or guaranteed-before-final | Evidence required |
| Dashboard analytics | Eventual | Operational/reporting purpose |
| Permission check | Strong or bounded-stale | Security impact |
| External sync | Eventual with reconciliation | External dependency unreliable |
| Workflow timeout | Eventual but deterministic | Must eventually fire exactly once business-effect |

---

## 22. Cross-Service Invariant Example: Approval Requires Paid Fee

Invariant:

```text
Application cannot be approved unless required fee is paid.
```

Possible designs:

### 22.1 Synchronous Check

```text
Officer clicks Approve.
Application Service calls Payment Service.
Payment Service returns PAID.
Application Service approves.
```

Pros:

```text
simple mental model
fresh check
```

Cons:

```text
temporal coupling
approval blocked if Payment Service down
latency added
retry ambiguity
```

Use when:

```text
approval must be fresh
payment service highly available
volume manageable
```

### 22.2 Local Payment Projection

```text
Payment Service emits PaymentConfirmed.
Application Service stores local payment confirmation view.
Approval checks local view.
```

Pros:

```text
approval does not depend on live payment call
faster
more resilient
```

Cons:

```text
projection can be stale
needs reconciliation
needs event reliability
```

Use when:

```text
payment status can be treated as event-confirmed fact
projection lag acceptable
```

### 22.3 Confirmation State

```text
Officer action creates APPROVAL_PREPARED.
System finalizes to APPROVED only after payment confirmation and other checks.
```

Pros:

```text
safe legal finalization
better UX for pending checks
explicit workflow state
```

Cons:

```text
more states
more workflow complexity
```

Use when:

```text
legal effect must be delayed until all checks complete
```

### 22.4 Fail-Closed

If payment status cannot be verified:

```text
approval cannot complete
show pending/payment verification unavailable
```

Use when:

```text
wrong approval is worse than delayed approval
```

### 22.5 Fail-Open with Detective Control

Allow approval if payment service unavailable, then reconcile later.

Usually bad for financial/legal invariants.

Only acceptable if:

```text
risk is low
can reverse safely
business explicitly accepts risk
monitoring and correction exist
```

---

## 23. Cross-Service Invariant Example: Enforcement Restriction

Invariant:

```text
Applicant under active enforcement restriction cannot receive new licence.
```

This is more sensitive.

Options:

```text
1. Licence Service calls Enforcement Service synchronously before issue.
2. Licence Service maintains local restriction projection.
3. Enforcement Service owns eligibility decision.
4. A central Eligibility/Policy Service owns decision composition.
5. Licence issuance enters PENDING_FINAL_CLEARANCE until restriction check confirmed.
```

Top-tier analysis considers:

```text
- How fast restrictions change
- How severe wrong issuance is
- Whether restriction data is security-sensitive
- Whether cached restriction is allowed
- Whether final issue can wait
- Whether manual override exists
- Whether override needs audit
```

Likely design:

```text
- Restriction changes emit events.
- Licence Service keeps local projection.
- Final issuance performs version-aware clearance.
- If projection freshness exceeds allowed window, issuance is held.
- Manual override requires reason and higher authority.
- Reconciliation checks issued licences against restriction history.
```

---

## 24. Data Duplication is Not Inconsistency by Default

Microservices often duplicate data intentionally.

Example:

```text
Application Service stores applicantNameSnapshot.
Profile Service owns current applicant name.
```

Is this inconsistent?

Not necessarily.

It may be a historical snapshot.

We must classify copied data:

| Copy Type | Meaning | Update Needed? |
|---|---|---|
| Snapshot | value at time of action | no |
| Cache | performance copy | yes, eventually |
| Projection | query/read model | yes, eventually |
| Decision input | evidence used for decision | no mutation; new decision if changed |
| Reference view | local copy of external authority | yes, with freshness SLA |

Do not blindly synchronize all duplicated data.

Some data must remain historically frozen.

---

## 25. The Dangerous Phrase: “Single Source of Truth”

“Single source of truth” is useful but often misused.

Better phrasing:

```text
Single authority for a specific fact at a specific time.
```

Example:

```text
Profile Service is authority for current applicant profile.
Application Service is authority for applicant profile snapshot used in submitted application.
Audit Service is authority for immutable record of what was used at decision time.
```

These can all be true without contradiction.

---

## 26. Consistency and Time

Time is part of correctness.

Distinguish:

```text
occurredAt      when business event happened
recordedAt      when system recorded it
publishedAt     when event was published
receivedAt      when consumer received it
effectiveAt     when business/legal effect starts
expiresAt       when validity ends
processedAt     when handler processed it
```

Example:

```json
{
  "eventType": "LicenceSuspended",
  "occurredAt": "2026-06-19T10:00:00+07:00",
  "recordedAt": "2026-06-19T10:00:03+07:00",
  "publishedAt": "2026-06-19T10:00:05+07:00",
  "effectiveAt": "2026-06-20T00:00:00+07:00"
}
```

If you collapse all timestamps into `createdAt`, you lose important semantics.

---

## 27. Ordering and Consistency

Many engineers assume message order is global. Usually it is not.

Better assumption:

```text
Ordering can be guaranteed only within a defined scope.
```

Common scope:

```text
per aggregate id
per partition key
per workflow instance
per tenant
per account
```

Design event processing with:

```text
aggregateId
aggregateVersion
sequenceNumber
causationId
```

Example:

```json
{
  "eventType": "ApplicationApproved",
  "aggregateId": "APP-123",
  "aggregateVersion": 17,
  "sequenceNumber": 17
}
```

Consumer logic:

```text
If event.version == currentVersion + 1:
    apply
If event.version <= currentVersion:
    duplicate/old, ignore idempotently
If event.version > currentVersion + 1:
    gap detected, pause/retry/replay
```

---

## 28. Idempotency and Consistency

At-least-once delivery means duplicate messages happen.

If duplicate event changes business state twice, consistency is broken.

Example bad:

```java
public void onPaymentConfirmed(PaymentConfirmed event) {
    application.markPaid();
    feeBalance = feeBalance.subtract(event.amount());
}
```

If event delivered twice, balance wrong.

Better:

```java
public void onPaymentConfirmed(PaymentConfirmed event) {
    if (inboxRepository.alreadyProcessed(event.messageId())) {
        return;
    }

    transactionTemplate.executeWithoutResult(tx -> {
        if (inboxRepository.alreadyProcessedForUpdate(event.messageId())) {
            return;
        }

        Application application = applicationRepository.getById(event.applicationId());
        application.recordPaymentConfirmation(
                event.paymentId(),
                event.amount(),
                event.occurredAt()
        );

        applicationRepository.save(application);
        inboxRepository.markProcessed(event.messageId());
    });
}
```

But even better: model state transition idempotently.

```java
public Application recordPaymentConfirmation(String paymentId, Money amount, Instant paidAt) {
    if (this.paymentConfirmation != null
            && this.paymentConfirmation.paymentId().equals(paymentId)) {
        return this;
    }

    if (this.paymentConfirmation != null) {
        throw new IllegalStateException("Application already has different payment confirmation");
    }

    return withPaymentConfirmation(new PaymentConfirmation(paymentId, amount, paidAt));
}
```

---

## 29. Optimistic Locking and Versioned State

For local aggregate consistency, use optimistic locking.

Example:

```sql
UPDATE application
SET status = ?, version = version + 1
WHERE id = ? AND version = ?
```

If update count is 0:

```text
someone else modified aggregate
reload and retry or fail command
```

Optimistic locking helps prevent:

```text
lost update
double approval
stale command overwrite
concurrent transition corruption
```

But it does not solve cross-service consistency by itself.

---

## 30. Constraint Placement

Where should invariant live?

| Invariant Type | Best Placement |
|---|---|
| non-null required field | DB + domain validation |
| enum transition | domain model/state machine |
| uniqueness local to service | DB unique constraint |
| aggregate concurrency | optimistic lock |
| cross-service eligibility | authority service / projection + freshness control |
| audit evidence | append-only audit/outbox + reconciliation |
| UI-only display rule | frontend/backend view model |
| legal state transition | authoritative service domain + DB transaction |

A common mistake:

```text
Putting critical invariant only in frontend.
```

Frontend validation improves UX. It is not authoritative correctness.

---

## 31. Java 8–25 Considerations

### 31.1 Java 8

Java 8 systems often use:

```text
- Spring Boot 1/2 older style
- CompletableFuture limited ergonomics
- older HTTP clients
- older libraries
- less expressive records/sealed types
```

Recommended discipline:

```text
- explicit immutable classes
- final fields
- enum-based state machine
- database constraints
- transactional service boundaries
- careful thread pool management
```

### 31.2 Java 11

Java 11 adds standard `HttpClient`, better runtime baseline, and stronger ecosystem support.

Useful for:

```text
- version-aware sync calls
- timeout-controlled HTTP clients
- long-term enterprise migration baseline
```

### 31.3 Java 17

Java 17 enables better modeling:

```text
- records
- sealed classes
- pattern matching foundation
```

Example:

```java
public sealed interface ConsistencyDecision
        permits StrongDecision, EventualDecision, CompensatableDecision {
}

public record StrongDecision(String reason) implements ConsistencyDecision {
}

public record EventualDecision(Duration maxLag, String reconciliationRule)
        implements ConsistencyDecision {
}

public record CompensatableDecision(String compensationAction)
        implements ConsistencyDecision {
}
```

### 31.4 Java 21

Java 21 virtual threads can make synchronous waiting cheaper in terms of threads, but not cheaper in terms of distributed correctness.

Important:

```text
Virtual threads do not remove latency.
Virtual threads do not fix dependency failure.
Virtual threads do not solve consistency.
Virtual threads can increase concurrency pressure if not bounded.
```

Use with:

```text
- timeout
- rate limit
- bulkhead
- bounded concurrency
- connection pool discipline
```

### 31.5 Java 25

Java 25 is useful as modern runtime horizon, but microservices consistency design remains architectural.

Expect benefits from:

```text
- mature language/runtime improvements
- modern GC/runtime behavior
- better observability ecosystem
- better container/JVM ergonomics than Java 8 era
```

But no Java version turns distributed data into local data.

---

## 32. Modeling Consistency Policy in Java

A useful approach is to make consistency decision explicit.

```java
public enum ConsistencyLevel {
    LOCAL_STRONG,
    CROSS_SERVICE_STRONG,
    EVENTUAL,
    COMPENSATABLE,
    DETECTIVE_ONLY
}

public enum ViolationImpact {
    COSMETIC,
    OPERATIONAL,
    USER_CONFUSION,
    FINANCIAL,
    LEGAL,
    SECURITY,
    DATA_CORRUPTION
}

public final class InvariantDefinition {
    private final String name;
    private final String ownerService;
    private final ConsistencyLevel consistencyLevel;
    private final ViolationImpact violationImpact;
    private final Duration maximumInconsistencyWindow;
    private final boolean compensatable;
    private final String detectionRule;
    private final String repairRule;
}
```

This may not be production code directly, but it is a powerful architecture documentation model.

---

## 33. Example: Approval Consistency Policy

```java
public final class ApprovalInvariants {

    public static final InvariantDefinition LICENCE_NUMBER_UNIQUE =
            new InvariantDefinition(
                    "Licence number must be globally unique",
                    "licence-service",
                    ConsistencyLevel.LOCAL_STRONG,
                    ViolationImpact.LEGAL,
                    Duration.ZERO,
                    false,
                    "unique constraint and sequence allocation monitor",
                    "manual legal correction only"
            );

    public static final InvariantDefinition DASHBOARD_COUNT_CONVERGES =
            new InvariantDefinition(
                    "Dashboard count must converge with source records",
                    "reporting-service",
                    ConsistencyLevel.EVENTUAL,
                    ViolationImpact.OPERATIONAL,
                    Duration.ofMinutes(5),
                    true,
                    "hourly count reconciliation",
                    "projection rebuild"
            );
}
```

The important point: consistency policy becomes explicit, reviewable, and testable.

---

## 34. Testing Consistency

Consistency cannot be tested only with happy-path unit tests.

Test categories:

### 34.1 Local Invariant Test

```text
invalid state transition should fail
required field missing should fail
duplicate unique key should fail
concurrent update should fail one transaction
```

### 34.2 Idempotency Test

```text
same command sent twice
same event delivered twice
same compensation executed twice
```

### 34.3 Ordering Test

```text
event version 3 arrives before version 2
old event arrives after new state
missing event gap
```

### 34.4 Lag Test

```text
projection delayed by 10 seconds
UI/read API handles stale projection correctly
```

### 34.5 Reconciliation Test

```text
manually create mismatch
reconciliation detects it
repair plan generated
repair idempotent
```

### 34.6 Dependency Failure Test

```text
payment service down during approval
restriction service times out during issuance
message broker unavailable after local commit
outbox relay stuck
consumer DLQ grows
```

### 34.7 Property-Based Test

For state machines:

```text
Generate random commands/events.
Assert invariant always holds.
```

---

## 35. Observability for Consistency

You need observability not only for latency and errors, but correctness.

### 35.1 Metrics

```text
business_invariant_violation_total
business_invariant_violation_open
reconciliation_run_total
reconciliation_mismatch_total
reconciliation_repair_success_total
projection_lag_seconds
outbox_lag_seconds
consumer_lag_records
stale_read_total
idempotency_duplicate_detected_total
state_transition_conflict_total
```

### 35.2 Logs

Critical consistency logs should include:

```text
correlationId
causationId
aggregateId
aggregateVersion
commandId
eventId
actorId
tenantId
invariantName
expectedState
actualState
decision
```

### 35.3 Traces

Trace should show:

```text
command accepted
local transaction committed
outbox record created
event published
consumer processed
projection updated
reconciliation verified
```

### 35.4 Audit

Audit should answer:

```text
Who decided?
What data was used?
What version of data was used?
What policy/rule version was used?
When did it become effective?
Was any correction made?
Why was correction made?
```

---

## 36. Consistency Failure Modes

| Failure | Cause | Detection | Mitigation |
|---|---|---|---|
| Lost event | relay bug/broker issue | outbox lag/reconciliation | republish/replay |
| Duplicate effect | non-idempotent consumer | anomaly, double state change | inbox/idempotency |
| Stale approval input | old projection | freshness check | hold finalization |
| Double issuance | race condition | unique constraint violation | single authority/lock |
| Missing audit | audit consumer failed | audit reconciliation | outbox + repair |
| Wrong notification | stale event/read model | user complaint/reconciliation | correction notice |
| Projection drift | missed event/bug | checksum/count comparison | rebuild projection |
| Out-of-order transition | event ordering issue | version gap | pause/retry/replay |
| External mismatch | external system update missed | external reconciliation | sync repair |

---

## 37. Anti-Patterns

### 37.1 “Everything Eventual”

Not all invariants can be eventual.

Security, legal, and financial side effects often require preventive control.

### 37.2 “Everything Strong”

Trying to make everything strong creates tight coupling, low availability, slow performance, and distributed monolith behavior.

### 37.3 Hidden Shared Database Consistency

Services sharing DB tables may look consistent, but ownership is unclear and deployability suffers.

### 37.4 Cache as Source of Truth

A cache/projection must not silently become authority unless explicitly designed as authority.

### 37.5 No Reconciliation

Eventual consistency without reconciliation is hope.

### 37.6 No Explicit Intermediate State

Async process hidden behind `PENDING` causes confusion and bugs.

### 37.7 Frontend-Only Invariant

Critical invariant enforced only in UI is not invariant.

### 37.8 Overusing Distributed Locks

Distributed locks can serialize some operations, but they add failure modes and do not replace domain modeling.

### 37.9 Treating Compensation as Undo

Compensation is business correction, not time travel.

### 37.10 No Owner for Invariant

If everyone owns an invariant, no one owns it.

---

## 38. Architecture Review Checklist

For each critical workflow, ask:

```text
1. What are the business invariants?
2. Which invariants are local?
3. Which invariants are cross-service?
4. Which invariants are non-compensatable?
5. Which service owns each invariant?
6. What consistency level is required?
7. What is the allowed inconsistency window?
8. What happens if dependency is down?
9. Is stale data visible to users?
10. Is stale data dangerous?
11. How do we detect mismatch?
12. How do we repair mismatch?
13. Is repair idempotent?
14. Is every critical side effect auditable?
15. Can we prove what happened after incident?
16. Can we replay safely?
17. Can we rebuild read models?
18. Are constraints enforced in backend/domain/database, not only UI?
19. Are duplicate messages safe?
20. Are out-of-order messages safe?
```

---

## 39. Production Readiness Checklist

A microservice consistency design is production-ready if:

```text
[ ] Critical invariants are listed.
[ ] Each invariant has one owner.
[ ] Each invariant has consistency classification.
[ ] Non-compensatable invariants are prevented before side effect.
[ ] Eventual invariants have convergence SLA.
[ ] Outbox/inbox exists where reliable messaging is needed.
[ ] Consumers are idempotent.
[ ] Events include aggregate version or ordering metadata where needed.
[ ] Read models expose or handle staleness.
[ ] Reconciliation exists for critical duplicated state.
[ ] Repair workflow is idempotent and auditable.
[ ] Intermediate workflow states are explicit.
[ ] Dependency failure policy is defined: fail open/closed/pending.
[ ] Audit evidence exists for legal/security/financial decisions.
[ ] Metrics exist for lag, drift, mismatch, stale reads, duplicate handling.
[ ] Tests cover duplicate, missing, delayed, out-of-order events.
[ ] Operational runbook exists for consistency incidents.
```

---

## 40. Practical Exercise

Take this workflow:

```text
Applicant submits application.
System validates documents.
System checks payment.
System checks enforcement restriction.
Officer approves.
System issues licence.
System sends notification.
System records audit.
```

Create:

1. Invariant table.
2. Consistency classification.
3. Owner service for each invariant.
4. Preventive vs detective control.
5. Reconciliation plan.
6. Failure matrix.
7. UX for pending/stale state.
8. Metrics and alerts.

Example starting point:

| Invariant | Owner | Consistency | Control |
|---|---|---|---|
| Application cannot be submitted without applicant | Application | Local strong | preventive |
| Licence number unique | Licence | Strong | preventive |
| Payment must be confirmed before legal issuance | Payment/Licence | Strong before final issue | preventive |
| Search listing reflects latest status | Reporting | Eventual < 60s | detective/corrective |
| Notification must not claim licence issued before issue | Notification/Licence | Causal/eventual | preventive or correction |
| Approval audit must exist | Application/Audit | Guaranteed eventual or before final | preventive + reconciliation |

---

## 41. Mental Model Summary

The advanced way to think about consistency:

```text
Do not ask first:
“Should this be strong or eventual?”

Ask:
“What invariant are we protecting?”
```

Then ask:

```text
Who owns it?
When must it be true?
Can it be temporarily false?
Can it be corrected?
What is the impact?
How do we detect violation?
How do we repair it?
How do we prove what happened?
```

Microservices correctness is not achieved by one magic tool.

It is achieved by combining:

```text
clear ownership
local transactions
state machines
outbox/inbox
idempotency
ordering metadata
explicit pending states
freshness SLA
reconciliation
audit evidence
operational discipline
```

A top-tier engineer does not blindly maximize consistency. They allocate consistency where it protects the business, and they deliberately allow eventual consistency where it improves scalability, availability, and autonomy without violating important invariants.

---

## 42. References

- Microservices.io — Database per Service, Saga, Transactional Outbox, Idempotent Consumer, Event Sourcing patterns.
- Microsoft Azure Architecture Center — CQRS, Materialized View, Event Sourcing, Compensating Transaction, cloud design patterns.
- Google SRE Book — Data Integrity: what users read and what systems must preserve.
- Martin Kleppmann, Designing Data-Intensive Applications — consistency, serializability, linearizability, distributed systems trade-offs.
- OpenJDK — JDK 25 project and Java runtime evolution context.

---

# Status Seri

Selesai: Part 10 dari 35.

Seri belum selesai.

Part berikutnya:

```text
Part 11 — Data Ownership and Database-per-Service Pattern
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-11-data-ownership-database-per-service.md
```
