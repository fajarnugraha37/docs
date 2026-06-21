# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-009.md

# Part 009 — Data Modelling II: Patterns for Real Systems

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 009 dari 035  
> Fokus: data modelling patterns untuk sistem nyata  
> Target pembaca: Java software engineer yang sudah memahami SQL/relational modelling, Redis, Kafka/RabbitMQ, dan ingin menggunakan MongoDB secara matang, bukan sekadar menyimpan JSON.

---

## 0. Posisi Part Ini dalam Seri

Di Part 008 kita membangun decision framework paling dasar:

- kapan data sebaiknya **embedded**;
- kapan data sebaiknya **referenced**;
- kapan data perlu diduplikasi secara sadar;
- kapan array berbahaya;
- kapan transaksi multi-document adalah sinyal bahwa modelling perlu ditinjau ulang;
- kapan MongoDB dipakai sebagai document database, bukan relational database yang sintaksnya beda.

Part 009 memperluas itu menjadi **pattern catalogue**.

Tujuan utamanya bukan menghafal nama pattern, tetapi melatih cara berpikir:

> “Untuk access pattern, lifecycle, growth, consistency, dan operability seperti ini, bentuk document apa yang paling defensible?”

MongoDB modelling yang matang biasanya bukan hasil dari satu aturan universal. Ia adalah hasil kombinasi beberapa pattern kecil:

- sebagian data di-embed;
- sebagian data direferensikan;
- sebagian field diduplikasi sebagai snapshot;
- sebagian field dihitung dan disimpan;
- sebagian historical data dipindahkan ke collection lain;
- sebagian search shape dibuat sebagai projection khusus;
- sebagian schema diberi version marker untuk evolusi.

Part ini akan membahas pattern tersebut dalam gaya production-system, terutama untuk Java backend dan case/workflow-oriented system.

---

## 1. Prinsip Dasar: Pattern Bukan Dekorasi, Pattern Adalah Jawaban terhadap Tekanan Sistem

Pattern modelling MongoDB muncul karena ada tekanan nyata:

| Tekanan | Pertanyaan Desain |
|---|---|
| Query latency | Bagaimana membuat data yang dibutuhkan tersedia dengan sedikit lookup? |
| Write consistency | Apa yang harus berubah secara atomik? |
| Growth | Apakah bagian ini bisa tumbuh tanpa batas? |
| Ownership | Siapa pemilik lifecycle data ini? |
| History | Apakah perubahan harus disimpan sebagai audit trail? |
| Search | Apakah bentuk data utama cocok untuk search UI? |
| Reporting | Apakah operational document cocok untuk dashboard? |
| Migration | Bagaimana schema berubah tanpa downtime? |
| Multi-tenancy | Apakah tenant harus menjadi bagian dari setiap access path? |
| Compliance | Apakah data boleh dihapus, harus disimpan, atau harus dibekukan? |

Pattern yang baik selalu menjawab tekanan tertentu.

Pattern yang buruk biasanya muncul ketika engineer menyalin struktur class Java atau struktur table relational ke MongoDB tanpa bertanya:

- data ini dibaca bagaimana?
- data ini berubah bagaimana?
- data ini tumbuh sejauh apa?
- invariant apa yang wajib dijaga?
- failure mode apa yang harus bisa dijelaskan?

---

## 2. Mental Model: Tiga Bentuk Data dalam Sistem MongoDB

Dalam sistem MongoDB yang matang, biasanya ada tiga kategori data.

### 2.1 Source-of-Truth Document

Ini adalah document yang mewakili state utama domain.

Contoh:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "state": "UNDER_REVIEW",
  "subject": {
    "subjectId": "SUBJ-001",
    "name": "PT Example Finance",
    "riskClass": "HIGH"
  },
  "assignedUnit": "market-conduct",
  "openedAt": "2026-06-20T03:12:45Z",
  "version": 17
}
```

Ini adalah data yang menjadi pusat keputusan command.

Karakteristik:

- punya identity kuat;
- punya lifecycle;
- sering menjadi aggregate root;
- menjadi tempat invariant utama;
- update-nya harus dikendalikan;
- bisa memakai optimistic locking;
- biasanya tidak terlalu bebas bentuknya.

### 2.2 Read-Optimized Projection

Ini adalah data turunan yang sengaja dibentuk untuk query tertentu.

Contoh:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "subjectName": "PT Example Finance",
  "riskClass": "HIGH",
  "state": "UNDER_REVIEW",
  "assignedUnit": "market-conduct",
  "slaStatus": "BREACH_RISK",
  "lastActivityAt": "2026-06-20T10:11:01Z",
  "searchText": "2026/ENF/000127 PT Example Finance market conduct breach risk"
}
```

Karakteristik:

- query-friendly;
- boleh denormalized;
- boleh eventual consistent;
- index-nya mengikuti UI/API;
- bisa dibangun dari change stream, application write, outbox, atau batch job;
- bukan selalu tempat invariant utama.

### 2.3 Historical/Event/Audit Document

Ini adalah data append-only atau near-append-only yang menjelaskan apa yang pernah terjadi.

Contoh:

```json
{
  "_id": "EVT-000991",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "eventType": "CASE_ESCALATED",
  "occurredAt": "2026-06-20T10:11:01Z",
  "actor": {
    "userId": "USR-017",
    "displayName": "A. Reviewer",
    "role": "SUPERVISOR"
  },
  "payload": {
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "reasonCode": "HIGH_IMPACT"
  }
}
```

Karakteristik:

- tumbuh terus;
- jarang di-update;
- sering dipartisi secara waktu atau tenant;
- sering butuh retention policy;
- penting untuk auditability;
- tidak cocok di-embed tak terbatas ke source document.

Banyak pattern dalam part ini bisa dipahami sebagai cara mengatur hubungan antara tiga bentuk data tersebut.

---

## 3. Pattern 1 — Attribute Pattern

### 3.1 Masalah yang Diselesaikan

Attribute pattern berguna ketika entity memiliki banyak atribut opsional, dinamis, berbeda-beda antar subtype, atau sering berubah.

Contoh domain:

- product catalog dengan specification berbeda per kategori;
- regulatory subject dengan metadata berbeda per license type;
- evidence/document metadata yang berbeda per document type;
- risk indicator yang berubah mengikuti policy;
- form submission dengan field dinamis.

Tanpa pattern ini, engineer sering membuat document seperti ini:

```json
{
  "_id": "DOC-001",
  "documentType": "BANK_STATEMENT",
  "bankName": "Example Bank",
  "accountNumber": "123456",
  "periodStart": "2026-01-01",
  "periodEnd": "2026-01-31",
  "issuerCountry": null,
  "licenseNumber": null,
  "inspectionDate": null,
  "inspectionOfficer": null,
  "customField1": "...",
  "customField2": "..."
}
```

Masalah:

- field sparse terlalu banyak;
- null/missing semantics membingungkan;
- schema cepat membengkak;
- query dinamis sulit dikontrol;
- validasi menjadi lemah;
- index strategy menjadi kacau.

### 3.2 Bentuk Pattern

Daripada membuat semua field opsional di top-level, atribut dinamis disimpan sebagai array key-value atau object map terkontrol.

Contoh array attribute:

```json
{
  "_id": "DOC-001",
  "tenantId": "regulator-id",
  "documentType": "BANK_STATEMENT",
  "caseId": "CASE-2026-000127",
  "attributes": [
    {
      "name": "bankName",
      "type": "STRING",
      "value": "Example Bank"
    },
    {
      "name": "periodStart",
      "type": "DATE",
      "value": "2026-01-01"
    },
    {
      "name": "periodEnd",
      "type": "DATE",
      "value": "2026-01-31"
    }
  ]
}
```

Contoh object-map attribute:

```json
{
  "_id": "DOC-001",
  "tenantId": "regulator-id",
  "documentType": "BANK_STATEMENT",
  "caseId": "CASE-2026-000127",
  "attributes": {
    "bankName": "Example Bank",
    "periodStart": "2026-01-01",
    "periodEnd": "2026-01-31"
  }
}
```

### 3.3 Array vs Object Map

| Bentuk | Kelebihan | Kekurangan |
|---|---|---|
| Array `{name,type,value}` | bisa menyimpan metadata per attribute; cocok untuk validasi dinamis; bisa query dengan `$elemMatch` | lebih verbose; index multikey perlu hati-hati |
| Object map | lebih ringkas; mudah dibaca; natural untuk JSON | indexing dynamic key lebih sulit; tipe tidak eksplisit; governance lebih lemah |

### 3.4 Kapan Cocok

Gunakan attribute pattern ketika:

- jumlah field bervariasi antar subtype;
- field sering berubah karena kebijakan bisnis;
- UI form bersifat configurable;
- metadata lebih penting daripada class statis;
- sebagian kecil atribut perlu dicari;
- field tidak semuanya layak menjadi top-level field.

### 3.5 Kapan Tidak Cocok

Jangan pakai pattern ini untuk field utama yang:

- selalu ada;
- sangat sering dipakai filter/sort;
- punya invariant kuat;
- perlu unique constraint;
- perlu authorization logic eksplisit;
- menjadi bagian dari shard key atau compound index utama.

Contoh field yang sebaiknya tetap top-level:

```json
{
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "state": "UNDER_REVIEW",
  "assignedUnit": "market-conduct",
  "openedAt": "2026-06-20T03:12:45Z"
}
```

Field seperti `tenantId`, `state`, dan `openedAt` terlalu penting untuk disembunyikan dalam generic attributes.

### 3.6 Java Modelling

Untuk Java, attribute pattern bisa dimodelkan seperti ini:

```java
public record DynamicAttribute(
        String name,
        AttributeType type,
        Object value
) {}

public enum AttributeType {
    STRING,
    NUMBER,
    DECIMAL,
    BOOLEAN,
    DATE,
    ENUM,
    REFERENCE
}

public record EvidenceDocument(
        String id,
        String tenantId,
        String caseId,
        String documentType,
        List<DynamicAttribute> attributes
) {}
```

Namun `Object value` harus diperlakukan hati-hati. Untuk sistem serius, lebih aman memakai sealed hierarchy.

```java
public sealed interface AttributeValue
        permits StringValue, DecimalValue, DateValue, BooleanValue {
}

public record StringValue(String value) implements AttributeValue {}
public record DecimalValue(BigDecimal value) implements AttributeValue {}
public record DateValue(LocalDate value) implements AttributeValue {}
public record BooleanValue(boolean value) implements AttributeValue {}
```

### 3.7 Invariant

Attribute pattern wajib punya registry.

Contoh:

```json
{
  "documentType": "BANK_STATEMENT",
  "allowedAttributes": [
    {
      "name": "bankName",
      "type": "STRING",
      "required": true,
      "searchable": true
    },
    {
      "name": "periodStart",
      "type": "DATE",
      "required": true,
      "searchable": true
    },
    {
      "name": "periodEnd",
      "type": "DATE",
      "required": true,
      "searchable": true
    }
  ]
}
```

Tanpa registry, attribute pattern berubah menjadi schema-less dumping ground.

### 3.8 Pertanyaan Review

Sebelum memakai attribute pattern, tanyakan:

1. Field mana yang benar-benar dynamic?
2. Field mana yang harus tetap top-level?
3. Attribute mana yang boleh dicari?
4. Attribute mana yang butuh index?
5. Siapa yang mengontrol definisi attribute?
6. Bagaimana validasi dilakukan?
7. Bagaimana migration jika attribute berubah tipe?
8. Bagaimana Java code menghindari `Map<String, Object>` liar?

---

## 4. Pattern 2 — Bucket Pattern

### 4.1 Masalah yang Diselesaikan

Bucket pattern digunakan ketika ada data berulang dalam jumlah besar yang secara natural bisa dikelompokkan.

Contoh:

- sensor readings per device per hour;
- audit events per case per day;
- login attempts per user per day;
- financial ticks per instrument per minute;
- regulatory case activities per month;
- notification deliveries per recipient per day.

Masalah jika semua event disimpan sebagai array dalam satu document:

```json
{
  "_id": "CASE-2026-000127",
  "events": [
    { "type": "CREATED", "at": "..." },
    { "type": "ASSIGNED", "at": "..." },
    { "type": "COMMENTED", "at": "..." }
  ]
}
```

Awalnya tampak sederhana. Setelah ribuan event:

- document tumbuh terus;
- update array makin mahal;
- document bisa mendekati limit ukuran;
- contention meningkat;
- query partial history sulit;
- retention sulit;
- archival sulit.

### 4.2 Bentuk Pattern

Data dibagi ke bucket berdasarkan waktu, jumlah, tenant, entity, atau kombinasi.

Contoh bucket per case per bulan:

```json
{
  "_id": "CASE-2026-000127:2026-06",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "bucketType": "CASE_EVENTS_MONTHLY",
  "period": "2026-06",
  "eventCount": 3,
  "firstEventAt": "2026-06-01T09:00:00Z",
  "lastEventAt": "2026-06-20T10:11:01Z",
  "events": [
    {
      "eventId": "EVT-001",
      "type": "CASE_CREATED",
      "at": "2026-06-01T09:00:00Z",
      "actorId": "USR-001"
    },
    {
      "eventId": "EVT-002",
      "type": "CASE_ASSIGNED",
      "at": "2026-06-02T11:15:00Z",
      "actorId": "USR-009"
    },
    {
      "eventId": "EVT-003",
      "type": "CASE_ESCALATED",
      "at": "2026-06-20T10:11:01Z",
      "actorId": "USR-017"
    }
  ]
}
```

### 4.3 Bucket Key Design

Bucket key harus menjawab:

- bagaimana data ditulis?
- bagaimana data dibaca?
- apakah bucket bisa panas?
- apakah bucket bisa terlalu besar?
- apakah retention berbasis waktu?
- apakah tenant perlu masuk ke key?

Contoh bucket key:

```text
tenantId + caseId + yyyyMM
```

atau:

```text
deviceId + yyyyMMddHH
```

atau:

```text
tenantId + userId + yyyyMMdd
```

### 4.4 Kapan Cocok

Gunakan bucket pattern ketika:

- data append-heavy;
- data punya dimensi waktu;
- query sering berdasarkan range waktu;
- data per parent bisa sangat besar;
- retention/archival penting;
- event individu tidak selalu perlu menjadi document terpisah;
- batch read lebih penting daripada point lookup per event.

### 4.5 Kapan Tidak Cocok

Jangan pakai bucket pattern jika:

- setiap item perlu di-update independen dengan frekuensi tinggi;
- setiap item perlu unique constraint global kuat;
- setiap item sering dicari satu per satu;
- bucket menjadi hot document;
- bucket size sulit dikontrol;
- concurrency append sangat tinggi pada bucket yang sama.

### 4.6 Bucket Pattern vs Time Series Collection

MongoDB memiliki time series collection khusus. Namun bucket pattern tetap penting dipahami karena:

- tidak semua historical data adalah time series metric;
- audit event punya semantic payload, actor, reason, state transition;
- regulatory history sering butuh legal semantics;
- bucket pattern bisa disesuaikan dengan lifecycle domain;
- time series collection punya batasan dan karakteristik operasional sendiri.

Untuk audit/event domain, bucket pattern sering lebih eksplisit daripada time series collection murni.

### 4.7 Java Write Pattern

Secara konseptual:

```java
public void appendCaseEvent(CaseEvent event) {
    String bucketId = event.caseId() + ":" + YearMonth.from(event.occurredAt());

    collection.updateOne(
        Filters.eq("_id", bucketId),
        Updates.combine(
            Updates.setOnInsert("tenantId", event.tenantId()),
            Updates.setOnInsert("caseId", event.caseId()),
            Updates.setOnInsert("period", YearMonth.from(event.occurredAt()).toString()),
            Updates.push("events", toBson(event)),
            Updates.inc("eventCount", 1),
            Updates.min("firstEventAt", event.occurredAt()),
            Updates.max("lastEventAt", event.occurredAt())
        ),
        new UpdateOptions().upsert(true)
    );
}
```

Di production, perlu tambahan:

- max event per bucket;
- duplicate event guard;
- idempotency;
- retry handling;
- bucket rollover;
- monitoring bucket size.

### 4.8 Pertanyaan Review

1. Apa unit bucket?
2. Apa batas maksimal bucket?
3. Apa yang terjadi jika bucket penuh?
4. Apakah append ke bucket bisa menjadi hotspot?
5. Apakah event perlu dihapus individual?
6. Apakah event perlu query by eventId?
7. Bagaimana retention dilakukan?
8. Apakah bucket cocok untuk audit defensibility?

---

## 5. Pattern 3 — Subset Pattern

### 5.1 Masalah yang Diselesaikan

Subset pattern digunakan ketika parent memiliki child data besar, tetapi sebagian kecil child data sering dibaca bersama parent.

Contoh:

- product dengan ribuan reviews, tetapi page utama hanya butuh 3 review terbaru;
- case dengan ribuan notes, tetapi list view hanya butuh last note summary;
- customer dengan banyak addresses history, tetapi profile hanya butuh active address;
- investigation case dengan banyak evidence, tetapi overview hanya butuh top evidence summary.

Tanpa subset pattern, engineer punya dua opsi ekstrem:

1. embed semua child ke parent;
2. reference semua child dan selalu query tambahan.

Subset pattern menawarkan tengah:

- simpan child lengkap di collection terpisah;
- embed subset kecil yang sering dipakai di parent.

### 5.2 Bentuk Pattern

Collection utama:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "state": "UNDER_REVIEW",
  "latestNotes": [
    {
      "noteId": "NOTE-901",
      "authorName": "A. Reviewer",
      "createdAt": "2026-06-20T09:10:00Z",
      "summary": "Requested additional supporting documents."
    },
    {
      "noteId": "NOTE-877",
      "authorName": "B. Analyst",
      "createdAt": "2026-06-18T14:30:00Z",
      "summary": "Initial review completed."
    }
  ],
  "noteCount": 183
}
```

Collection detail:

```json
{
  "_id": "NOTE-901",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "authorId": "USR-017",
  "authorNameSnapshot": "A. Reviewer",
  "createdAt": "2026-06-20T09:10:00Z",
  "body": "Requested additional supporting documents for transaction period Q1 2026...",
  "visibility": "INTERNAL"
}
```

### 5.3 Kapan Cocok

Gunakan subset pattern ketika:

- parent overview sering dibuka;
- child lengkap besar/tumbuh;
- hanya subset child dibutuhkan pada query utama;
- subset bisa eventual consistent;
- subset bisa dihitung ulang jika rusak;
- duplicate summary dapat diterima.

### 5.4 Kapan Tidak Cocok

Jangan gunakan jika:

- subset harus selalu transactionally exact;
- child berubah sangat sering dan subset update menjadi bottleneck;
- semua child hampir selalu dibutuhkan;
- subset logic terlalu rumit;
- data duplication tidak bisa diterima secara compliance.

### 5.5 Failure Mode

Subset pattern membuat dua state:

- detail truth;
- embedded subset projection.

Failure yang harus dipikirkan:

- note berhasil dibuat tapi `latestNotes` gagal update;
- `latestNotes` berisi data lama;
- note dihapus tapi summary masih tampil;
- authorization berubah tapi subset masih expose summary;
- retry menambahkan duplicate subset item.

Mitigasi:

- gunakan idempotent update;
- batasi subset size dengan `$slice`;
- rebuild projection job;
- simpan subset hanya untuk data non-sensitive atau filtered;
- validasi visibility sebelum menampilkan.

### 5.6 Java Pattern

Command write bisa seperti:

```java
public void addNote(AddNoteCommand command) {
    Note note = Note.create(command);

    notes.insertOne(toDocument(note));

    cases.updateOne(
        Filters.and(
            Filters.eq("_id", command.caseId()),
            Filters.eq("tenantId", command.tenantId())
        ),
        Updates.combine(
            Updates.pushEach(
                "latestNotes",
                List.of(toLatestNoteSummary(note)),
                new PushOptions()
                    .sort(Sorts.descending("createdAt"))
                    .slice(5)
            ),
            Updates.inc("noteCount", 1),
            Updates.set("lastActivityAt", note.createdAt())
        )
    );
}
```

Jika exact consistency wajib, gunakan transaction. Jika tidak, gunakan outbox/projection repair.

### 5.7 Pertanyaan Review

1. Subset apa yang benar-benar sering dibaca?
2. Berapa ukuran maksimal subset?
3. Apakah subset boleh stale?
4. Bagaimana subset diperbaiki jika inconsistent?
5. Apakah subset memuat data sensitif?
6. Apakah authorization subset sama dengan detail?
7. Apakah subset update menambah write amplification yang signifikan?

---

## 6. Pattern 4 — Extended Reference Pattern

### 6.1 Masalah yang Diselesaikan

Extended reference pattern digunakan ketika document menyimpan reference ke entity lain sekaligus snapshot field penting dari referenced entity.

Contoh buruk jika hanya reference:

```json
{
  "_id": "CASE-2026-000127",
  "subjectId": "SUBJ-001"
}
```

Untuk list case, UI butuh:

- subject name;
- risk class;
- license type;
- jurisdiction.

Jika hanya ada `subjectId`, setiap list query butuh lookup tambahan.

Extended reference:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "subject": {
    "subjectId": "SUBJ-001",
    "nameSnapshot": "PT Example Finance",
    "riskClassSnapshot": "HIGH",
    "licenseTypeSnapshot": "LENDING",
    "jurisdictionSnapshot": "ID-JK"
  },
  "state": "UNDER_REVIEW"
}
```

### 6.2 Snapshot vs Live Reference

Extended reference bukan berarti data selalu live.

Ada dua semantic:

#### Snapshot Historical

Nilai saat case dibuat/disubmit harus tetap sama untuk audit.

Contoh:

```json
"subject": {
  "subjectId": "SUBJ-001",
  "nameAtCaseOpen": "PT Example Finance",
  "riskClassAtCaseOpen": "HIGH"
}
```

Jika subject berganti nama, case lama tetap menampilkan historical name.

#### Cached Live Summary

Nilai boleh mengikuti perubahan subject terbaru.

Contoh:

```json
"subjectSummary": {
  "subjectId": "SUBJ-001",
  "currentName": "PT Example Finance Tbk",
  "currentRiskClass": "MEDIUM"
}
```

Jika subject berubah, summary perlu di-update.

Kedua semantic ini harus dibedakan secara eksplisit dalam nama field.

### 6.3 Kapan Cocok

Gunakan extended reference ketika:

- parent perlu menampilkan data kecil dari referenced entity;
- join runtime mahal atau tidak perlu;
- data snapshot penting secara historical;
- UI list/detail membutuhkan field tersebut;
- referenced entity owned by different lifecycle;
- perubahan referenced entity tidak harus langsung tercermin, atau bisa dipropagasikan.

### 6.4 Kapan Tidak Cocok

Jangan gunakan jika:

- field referenced entity berubah sangat sering;
- semua perubahan harus segera konsisten di semua parent;
- snapshot dan current value sering tertukar;
- duplication menimbulkan compliance risk;
- jumlah parent terdampak update sangat besar.

### 6.5 Propagation Strategy

Jika extended reference adalah cached live summary, perubahan source perlu dipropagasikan.

Pilihan:

1. synchronous update ke semua affected documents;
2. asynchronous projection update;
3. change stream listener;
4. batch reconciliation;
5. rebuild on read;
6. tolerate stale with timestamp.

Contoh field dengan freshness marker:

```json
"subjectSummary": {
  "subjectId": "SUBJ-001",
  "name": "PT Example Finance Tbk",
  "riskClass": "MEDIUM",
  "sourceVersion": 42,
  "refreshedAt": "2026-06-20T10:00:00Z"
}
```

### 6.6 Java Naming Discipline

Gunakan nama eksplisit:

```java
public record SubjectSnapshot(
        String subjectId,
        String nameAtCaseOpen,
        RiskClass riskClassAtCaseOpen
) {}
```

Untuk cached live summary:

```java
public record SubjectCurrentSummary(
        String subjectId,
        String currentName,
        RiskClass currentRiskClass,
        long sourceVersion,
        Instant refreshedAt
) {}
```

Jangan membuat nama generik seperti:

```java
public record SubjectRef(String id, String name, RiskClass riskClass) {}
```

Nama seperti itu tidak menjelaskan apakah field historical snapshot atau current cache.

### 6.7 Pertanyaan Review

1. Apakah value ini historical snapshot atau live summary?
2. Jika source berubah, apakah parent harus berubah?
3. Seberapa stale boleh diterima?
4. Bagaimana propagation dilakukan?
5. Bagaimana mendeteksi stale summary?
6. Apakah field ini dipakai untuk keputusan hukum/regulasi?
7. Apakah nama field cukup eksplisit?

---

## 7. Pattern 5 — Computed Pattern

### 7.1 Masalah yang Diselesaikan

Computed pattern menyimpan hasil perhitungan yang mahal atau sering dibutuhkan.

Contoh:

- `caseAgeDays`;
- `slaStatus`;
- `riskScore`;
- `openTaskCount`;
- `unreadNotificationCount`;
- `totalExposureAmount`;
- `latestActivityAt`;
- `evidenceCompletenessPercentage`.

Tanpa computed pattern, query dashboard harus menghitung berulang dari detail.

Contoh dashboard case:

- total open cases by unit;
- cases breaching SLA;
- high-risk cases unassigned;
- cases with missing evidence;
- average review time.

Jika semua dihitung dari raw events setiap request, latency dan load akan buruk.

### 7.2 Bentuk Pattern

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "state": "UNDER_REVIEW",
  "openedAt": "2026-06-01T09:00:00Z",
  "assignedAt": "2026-06-02T11:15:00Z",
  "computed": {
    "openTaskCount": 7,
    "overdueTaskCount": 2,
    "evidenceCount": 14,
    "missingMandatoryEvidenceCount": 1,
    "slaStatus": "BREACH_RISK",
    "riskScore": 82,
    "lastActivityAt": "2026-06-20T10:11:01Z",
    "refreshedAt": "2026-06-20T10:12:00Z"
  }
}
```

### 7.3 Kapan Cocok

Gunakan computed pattern ketika:

- perhitungan mahal;
- hasil sering dibaca;
- hasil dipakai sort/filter;
- hasil bisa stale sebentar;
- data sumber banyak;
- dashboard butuh respons cepat;
- recomputation bisa dilakukan.

### 7.4 Kapan Tidak Cocok

Jangan gunakan jika:

- hasil harus selalu real-time exact;
- formula sering berubah dan semua data harus konsisten historis;
- computed value dipakai untuk keputusan kritikal tanpa freshness check;
- source perubahan sangat tinggi dan recomputation menjadi bottleneck.

### 7.5 Computed Value Semantics

Computed value harus jelas:

| Tipe | Contoh | Semantics |
|---|---|---|
| Derived current | `openTaskCount` | mengikuti state terbaru |
| Historical computed | `riskScoreAtDecision` | nilai saat keputusan dibuat |
| Cached expensive | `evidenceCompletenessPercentage` | boleh stale sementara |
| Materialized classification | `slaStatus` | dipakai filter/sort |

Nama field harus menjelaskan apakah value current, cached, atau historical.

### 7.6 Refresh Strategy

Pilihan refresh:

1. synchronous update saat command;
2. asynchronous event consumer;
3. scheduled recomputation;
4. lazy recompute on read;
5. hybrid: approximate real-time + periodic correction.

Contoh:

```json
"computed": {
  "openTaskCount": 7,
  "refreshedAt": "2026-06-20T10:12:00Z",
  "sourceEventVersion": 1902
}
```

### 7.7 Risk: Stale Computed State

Computed pattern memperkenalkan risiko stale.

Contoh:

- task sudah selesai, `openTaskCount` belum turun;
- SLA sudah breach, `slaStatus` belum berubah;
- evidence sudah lengkap, dashboard masih menunjukkan incomplete;
- risk score formula berubah, score lama tidak sesuai.

Mitigasi:

- simpan `refreshedAt`;
- simpan `formulaVersion`;
- simpan `sourceVersion`;
- buat reconciliation job;
- bedakan display-only computed vs decision-critical computed;
- untuk decision-critical, recompute sebelum final decision.

### 7.8 Java Pattern

```java
public record CaseComputedSummary(
        int openTaskCount,
        int overdueTaskCount,
        int evidenceCount,
        int missingMandatoryEvidenceCount,
        SlaStatus slaStatus,
        int riskScore,
        Instant lastActivityAt,
        Instant refreshedAt,
        long sourceVersion,
        int formulaVersion
) {}
```

Untuk command yang memerlukan decision-critical check:

```java
public DecisionResult decideCase(DecideCaseCommand command) {
    CaseAggregate aggregate = caseRepository.get(command.caseId());

    EvidenceCompleteness completeness = evidenceService.recomputeCompleteness(command.caseId());

    if (!completeness.isComplete()) {
        throw new BusinessRuleViolation("Mandatory evidence is incomplete");
    }

    return aggregate.decide(command, completeness);
}
```

Jangan mengandalkan cached value saja untuk invariant final.

### 7.9 Pertanyaan Review

1. Apakah value ini display-only atau decision-critical?
2. Berapa stale window yang diterima?
3. Bagaimana refresh dilakukan?
4. Bagaimana mendeteksi computed value stale?
5. Apa formula version-nya?
6. Apa recovery jika computation job gagal?
7. Apakah value perlu diindex?
8. Apakah recompute dilakukan sebelum keputusan kritikal?

---

## 8. Pattern 6 — Approximation Pattern

### 8.1 Masalah yang Diselesaikan

Approximation pattern digunakan ketika nilai exact terlalu mahal tetapi approximate cukup untuk use case.

Contoh:

- approximate view count;
- approximate number of related documents;
- approximate unread count;
- approximate dashboard count;
- approximate risk heatmap;
- approximate ingestion progress.

### 8.2 Kenapa Approximation Penting

Dalam distributed system, exact count sering mahal:

- membutuhkan scan besar;
- membutuhkan aggregation berat;
- rentan lock/contention jika counter tunggal;
- tidak selalu perlu exact untuk UI.

Misalnya list case menampilkan:

```text
About 12,400 matching cases
```

Tidak selalu perlu menghitung exact pada setiap request.

### 8.3 Bentuk Pattern

```json
{
  "_id": "regulator-id:market-conduct:2026-06",
  "tenantId": "regulator-id",
  "unit": "market-conduct",
  "period": "2026-06",
  "approximateOpenCaseCount": 12400,
  "lastEstimatedAt": "2026-06-20T10:00:00Z",
  "precision": "APPROXIMATE"
}
```

### 8.4 Kapan Cocok

Gunakan approximation ketika:

- UI tidak butuh exact;
- dashboard trend lebih penting daripada angka absolut;
- exact count mahal;
- nilai cepat berubah;
- error kecil bisa diterima;
- ada label yang jelas bahwa nilai approximate.

### 8.5 Kapan Tidak Cocok

Jangan gunakan untuk:

- billing;
- legal decision;
- regulatory enforcement amount;
- compliance threshold yang harus exact;
- financial ledger;
- SLA penalty exact;
- audit record.

### 8.6 Java/API Contract

API harus jujur.

Buruk:

```json
{
  "total": 12400
}
```

Lebih baik:

```json
{
  "totalEstimate": 12400,
  "totalPrecision": "APPROXIMATE",
  "estimatedAt": "2026-06-20T10:00:00Z"
}
```

### 8.7 Pertanyaan Review

1. Siapa yang mengonsumsi angka ini?
2. Apakah angka ini mempengaruhi keputusan formal?
3. Berapa error tolerance?
4. Apakah UI/API menyatakan approximate?
5. Apakah ada cara mendapatkan exact jika diperlukan?
6. Bagaimana value diperbarui?

---

## 9. Pattern 7 — Outlier Pattern

### 9.1 Masalah yang Diselesaikan

Outlier pattern digunakan ketika mayoritas document cocok dengan model embed normal, tetapi sebagian kecil entity memiliki jumlah child ekstrem.

Contoh:

- sebagian besar case punya < 20 evidence, tetapi ada mega-case dengan 100.000 evidence;
- sebagian besar customer punya 1-3 addresses, tetapi corporate group punya ribuan branches;
- sebagian besar notifications sedikit, tetapi satu system actor punya jutaan delivery records;
- sebagian besar products punya sedikit variants, tetapi satu product punya ribuan variants.

Jika model didesain untuk outlier, mayoritas use case jadi terlalu kompleks. Jika model didesain untuk mayoritas, outlier merusak sistem.

Outlier pattern memisahkan jalur normal dan jalur outlier.

### 9.2 Bentuk Pattern

Normal case:

```json
{
  "_id": "CASE-001",
  "tenantId": "regulator-id",
  "evidenceSummary": {
    "mode": "EMBEDDED_SMALL_SET",
    "count": 3,
    "items": [
      { "evidenceId": "E1", "title": "Bank statement" },
      { "evidenceId": "E2", "title": "License document" },
      { "evidenceId": "E3", "title": "Customer complaint" }
    ]
  }
}
```

Outlier case:

```json
{
  "_id": "CASE-MEGA-001",
  "tenantId": "regulator-id",
  "evidenceSummary": {
    "mode": "EXTERNALIZED_LARGE_SET",
    "count": 128934,
    "sampleItems": [
      { "evidenceId": "E1", "title": "Initial filing" },
      { "evidenceId": "E2", "title": "Transaction batch index" }
    ],
    "externalCollection": "case_evidence"
  }
}
```

Detail evidence disimpan di collection terpisah:

```json
{
  "_id": "EVID-991",
  "tenantId": "regulator-id",
  "caseId": "CASE-MEGA-001",
  "title": "Transaction record 991",
  "type": "TRANSACTION_EXPORT",
  "receivedAt": "2026-06-20T10:00:00Z"
}
```

### 9.3 Kapan Cocok

Gunakan outlier pattern ketika:

- distribusi data sangat skewed;
- mayoritas document kecil;
- minoritas document ekstrem;
- ingin menjaga simple path untuk mayoritas;
- outlier butuh handling khusus;
- outlier dapat dideteksi dengan threshold.

### 9.4 Kapan Tidak Cocok

Jangan gunakan jika:

- hampir semua entity berukuran besar;
- threshold tidak jelas;
- dua mode membuat domain terlalu rumit;
- aplikasi tidak siap handling dua storage shape;
- query perlu uniform access tanpa conditional branch.

### 9.5 Threshold Design

Threshold bisa berbasis:

- jumlah item;
- ukuran document;
- frekuensi update;
- latency query;
- business classification.

Contoh:

```text
If evidenceCount <= 20: keep summaries embedded.
If evidenceCount > 20: keep summaries only, store details externally.
If evidenceCount > 10,000: enable specialized search/index pipeline.
```

### 9.6 Java Domain Model

Gunakan explicit mode:

```java
public sealed interface EvidenceStorageMode
        permits EmbeddedSmallEvidenceSet, ExternalizedLargeEvidenceSet {
}

public record EmbeddedSmallEvidenceSet(
        int count,
        List<EvidenceSummary> items
) implements EvidenceStorageMode {}

public record ExternalizedLargeEvidenceSet(
        int count,
        List<EvidenceSummary> sampleItems,
        String externalCollection
) implements EvidenceStorageMode {}
```

Jangan sembunyikan dua bentuk storage di balik nullable fields.

### 9.7 Pertanyaan Review

1. Apakah outlier benar-benar minoritas?
2. Apa threshold-nya?
3. Bagaimana entity berpindah dari normal ke outlier?
4. Apakah bisa kembali dari outlier ke normal?
5. Apakah API client tahu perbedaannya?
6. Apakah query path tetap efisien untuk dua mode?
7. Bagaimana monitoring outlier dilakukan?

---

## 10. Pattern 8 — Preallocation Pattern

### 10.1 Masalah yang Diselesaikan

Preallocation pattern digunakan ketika struktur document sudah diketahui akan memiliki slot atau posisi tertentu, dan kita ingin menghindari pertumbuhan document yang tidak terkendali atau update shape yang terlalu berubah-ubah.

Contoh:

- monthly compliance checklist dengan 12 section tetap;
- inspection form dengan fixed control items;
- workflow stage slots;
- schedule slots;
- approval matrix dengan posisi fixed;
- risk scoring components.

### 10.2 Bentuk Pattern

```json
{
  "_id": "CHECKLIST-2026-001",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "templateId": "KYC-CHECKLIST-V3",
  "sections": [
    {
      "sectionCode": "IDENTITY",
      "status": "PENDING",
      "completedAt": null,
      "items": [
        {
          "itemCode": "ID_DOC_PRESENT",
          "status": "PENDING",
          "answer": null
        },
        {
          "itemCode": "ID_DOC_VALID",
          "status": "PENDING",
          "answer": null
        }
      ]
    },
    {
      "sectionCode": "RISK_PROFILE",
      "status": "PENDING",
      "completedAt": null,
      "items": [
        {
          "itemCode": "RISK_CLASS_ASSIGNED",
          "status": "PENDING",
          "answer": null
        }
      ]
    }
  ]
}
```

### 10.3 Kapan Cocok

Gunakan preallocation ketika:

- template sudah diketahui;
- jumlah child relatif terbatas;
- posisi/urutan penting;
- update mengisi slot yang ada;
- missing slot lebih berbahaya daripada null answer;
- progress tracking penting.

### 10.4 Kapan Tidak Cocok

Jangan gunakan jika:

- jumlah item tidak diketahui;
- item tumbuh dinamis tanpa batas;
- banyak field akan tetap kosong selamanya;
- template sangat sering berubah;
- preallocation membuat document besar sebelum dibutuhkan.

### 10.5 Template Versioning

Preallocation biasanya terkait template.

Simpan `templateId` dan `templateVersion`.

```json
{
  "templateId": "KYC-CHECKLIST",
  "templateVersion": 3,
  "schemaVersion": 1
}
```

Jangan hanya menyimpan current template reference. Checklist yang dibuat dengan template v3 harus tetap bisa dibaca walau template v4 sudah aktif.

### 10.6 Pertanyaan Review

1. Apakah struktur benar-benar fixed?
2. Apakah prefilled null punya makna?
3. Apakah template berubah?
4. Bagaimana historical template dijaga?
5. Apakah document menjadi terlalu besar?
6. Apakah update slot butuh array filters?

---

## 11. Pattern 9 — Polymorphic Pattern

### 11.1 Masalah yang Diselesaikan

Polymorphic pattern digunakan ketika collection menyimpan beberapa subtype document yang mirip tetapi tidak identik.

Contoh:

- different evidence types;
- different notification types;
- different case types;
- different workflow tasks;
- different party roles;
- different document metadata structures.

Dalam relational database, kita mungkin memakai inheritance mapping:

- single table inheritance;
- joined table inheritance;
- table per class.

Di MongoDB, polymorphism lebih natural, tetapi tetap perlu governance.

### 11.2 Bentuk Pattern

```json
{
  "_id": "EVID-001",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "evidenceType": "BANK_STATEMENT",
  "title": "January 2026 Statement",
  "receivedAt": "2026-06-20T10:00:00Z",
  "bankStatement": {
    "bankName": "Example Bank",
    "periodStart": "2026-01-01",
    "periodEnd": "2026-01-31",
    "accountNumberMasked": "****1234"
  }
}
```

Subtype lain:

```json
{
  "_id": "EVID-002",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "evidenceType": "INTERVIEW_TRANSCRIPT",
  "title": "Interview with Compliance Officer",
  "receivedAt": "2026-06-21T09:00:00Z",
  "interviewTranscript": {
    "interviewedPerson": "Compliance Officer",
    "interviewDate": "2026-06-19",
    "transcriptLanguage": "id-ID"
  }
}
```

### 11.3 Discriminator Field

Selalu gunakan discriminator eksplisit:

```json
"evidenceType": "BANK_STATEMENT"
```

Jangan menebak subtype dari keberadaan field.

Buruk:

```text
if bankStatement exists => BANK_STATEMENT
```

Masalah:

- migration sulit;
- invalid document sulit dideteksi;
- query subtype lebih rapuh;
- validation lebih sulit.

### 11.4 Java Sealed Type

Polymorphic pattern cocok dengan sealed interface/class.

```java
public sealed interface EvidenceMetadata
        permits BankStatementMetadata, InterviewTranscriptMetadata, LicenseDocumentMetadata {
}

public record BankStatementMetadata(
        String bankName,
        LocalDate periodStart,
        LocalDate periodEnd,
        String accountNumberMasked
) implements EvidenceMetadata {}

public record InterviewTranscriptMetadata(
        String interviewedPerson,
        LocalDate interviewDate,
        Locale transcriptLanguage
) implements EvidenceMetadata {}
```

Entity:

```java
public record EvidenceDocument(
        String id,
        String tenantId,
        String caseId,
        EvidenceType evidenceType,
        String title,
        Instant receivedAt,
        EvidenceMetadata metadata
) {}
```

Mapping BSON perlu dirancang eksplisit agar discriminator dan metadata tidak ambigu.

### 11.5 Kapan Cocok

Gunakan polymorphic pattern ketika:

- subtype punya banyak common fields;
- subtype perlu query bersama;
- collection-level access pattern sama;
- subtype-specific field tidak terlalu banyak;
- schema validation bisa mengontrol tiap subtype.

### 11.6 Kapan Tidak Cocok

Pisahkan collection jika:

- subtype punya lifecycle sangat berbeda;
- access pattern sangat berbeda;
- index berbeda total;
- security berbeda;
- retention berbeda;
- volume berbeda ekstrem;
- subtype-specific fields mendominasi.

### 11.7 Pertanyaan Review

1. Apakah subtype benar-benar satu family?
2. Apakah query sering lintas subtype?
3. Apakah lifecycle sama?
4. Apakah retention sama?
5. Apakah security sama?
6. Apakah index masih masuk akal dalam satu collection?
7. Apakah Java mapping eksplisit?

---

## 12. Pattern 10 — Schema Version Pattern

### 12.1 Masalah yang Diselesaikan

MongoDB flexible schema memudahkan evolusi, tetapi juga bisa membuat document lama dan baru hidup berdampingan tanpa kontrol.

Schema version pattern memberi tanda eksplisit:

```json
{
  "_id": "CASE-2026-000127",
  "schemaVersion": 3,
  "state": "UNDER_REVIEW"
}
```

### 12.2 Kapan Dibutuhkan

Gunakan schema version ketika:

- document akan hidup lama;
- schema berubah signifikan;
- historical compatibility penting;
- migration dilakukan bertahap;
- Java reader perlu menangani beberapa bentuk document;
- auditability penting.

### 12.3 Bentuk Pattern

Version 1:

```json
{
  "_id": "CASE-001",
  "schemaVersion": 1,
  "status": "OPEN",
  "customerName": "PT Example Finance"
}
```

Version 2:

```json
{
  "_id": "CASE-001",
  "schemaVersion": 2,
  "state": "UNDER_REVIEW",
  "subject": {
    "subjectId": "SUBJ-001",
    "nameSnapshot": "PT Example Finance"
  }
}
```

### 12.4 Reader Strategy

Pilihan reader:

1. multi-version reader;
2. migrate-on-read;
3. pre-migrate batch;
4. reject old version;
5. compatibility adapter.

Contoh Java:

```java
public CaseAggregate readCase(Document doc) {
    int version = doc.getInteger("schemaVersion", 1);

    return switch (version) {
        case 1 -> caseMapperV1.fromDocument(doc);
        case 2 -> caseMapperV2.fromDocument(doc);
        case 3 -> caseMapperV3.fromDocument(doc);
        default -> throw new UnsupportedSchemaVersionException(version);
    };
}
```

### 12.5 Writer Strategy

Biasanya writer hanya menulis versi terbaru.

```java
public Document toDocument(CaseAggregate aggregate) {
    return new Document()
        .append("_id", aggregate.id())
        .append("schemaVersion", CaseSchemaVersions.CURRENT)
        .append("state", aggregate.state().name());
}
```

### 12.6 Migration Strategy

Schema version pattern mendukung:

- lazy migration;
- online backfill;
- expand-contract migration;
- compatibility window;
- rollback.

### 12.7 Pertanyaan Review

1. Apakah document hidup cukup lama untuk butuh versioning?
2. Apakah reader bisa menangani versi lama?
3. Apakah writer hanya menulis versi terbaru?
4. Apa migration path?
5. Apa rollback path?
6. Apakah schema version field diindex? Biasanya tidak, kecuali untuk migration scan.
7. Bagaimana mengetahui sisa document lama?

---

## 13. Pattern 11 — Tree Pattern

### 13.1 Masalah yang Diselesaikan

Tree pattern digunakan untuk data hierarchical.

Contoh:

- organization unit hierarchy;
- regulatory taxonomy;
- case category tree;
- document folder tree;
- permission group hierarchy;
- product category tree.

MongoDB tidak punya recursive join seperti relational CTE secara native di query biasa, tetapi aggregation punya `$graphLookup`. Meski begitu, modelling tree tetap harus hati-hati.

### 13.2 Parent Reference

Setiap node menyimpan parent.

```json
{
  "_id": "UNIT-MARKET-CONDUCT",
  "tenantId": "regulator-id",
  "name": "Market Conduct",
  "parentId": "UNIT-SUPERVISION"
}
```

Kelebihan:

- mudah move node;
- document kecil;
- mudah cari children langsung dengan index `parentId`.

Kekurangan:

- query ancestor/descendant butuh traversal;
- breadcrumb butuh multiple reads atau aggregation.

### 13.3 Child References

Parent menyimpan children.

```json
{
  "_id": "UNIT-SUPERVISION",
  "tenantId": "regulator-id",
  "name": "Supervision",
  "childIds": [
    "UNIT-MARKET-CONDUCT",
    "UNIT-PRUDENTIAL"
  ]
}
```

Kelebihan:

- mudah render children.

Kekurangan:

- array bisa tumbuh;
- move node butuh update parent lama dan baru;
- concurrency lebih rumit.

### 13.4 Ancestors Array / Materialized Path

Node menyimpan ancestors.

```json
{
  "_id": "UNIT-MARKET-CONDUCT-REVIEW",
  "tenantId": "regulator-id",
  "name": "Market Conduct Review",
  "parentId": "UNIT-MARKET-CONDUCT",
  "ancestors": [
    "UNIT-SUPERVISION",
    "UNIT-MARKET-CONDUCT"
  ],
  "path": "/UNIT-SUPERVISION/UNIT-MARKET-CONDUCT/UNIT-MARKET-CONDUCT-REVIEW"
}
```

Kelebihan:

- mudah query descendants;
- mudah breadcrumb;
- cocok untuk mostly-read hierarchy.

Kekurangan:

- move subtree mahal;
- path harus di-update untuk descendants;
- consistency lebih rumit.

### 13.5 Kapan Memilih Apa

| Pattern | Cocok Jika |
|---|---|
| Parent reference | tree sering berubah, traversal tidak terlalu sering |
| Child references | parent-child render sederhana, children terbatas |
| Ancestors array | query descendants/ancestors sering, tree jarang berubah |
| Materialized path | prefix-like path query dan breadcrumb penting |
| Separate closure collection | hierarchy kompleks dan query relation sangat sering |

### 13.6 Tree untuk Authorization

Hati-hati jika tree dipakai authorization.

Contoh:

- user di unit parent boleh melihat case di child unit;
- permission diwariskan dari group parent;
- jurisdiction tree menentukan access.

Jika authorization bergantung pada tree, stale tree path bisa menjadi security bug.

Mitigasi:

- version tree;
- cache permission dengan TTL pendek;
- recompute permission at decision point;
- simpan `permissionSourceVersion`;
- audit perubahan tree.

### 13.7 Pertanyaan Review

1. Tree sering berubah atau mostly static?
2. Query paling umum: parent, children, ancestors, descendants, breadcrumb?
3. Apakah tree dipakai authorization?
4. Apakah move subtree sering?
5. Apakah path stale berbahaya?
6. Apakah hierarchy cross-tenant?
7. Apakah perlu audit perubahan tree?

---

## 14. Pattern 12 — Event-Snapshot Hybrid

### 14.1 Masalah yang Diselesaikan

Event-snapshot hybrid digunakan ketika sistem butuh:

- current state cepat dibaca;
- history lengkap tetap tersedia;
- audit trail defensible;
- state transition bisa dianalisis;
- tidak ingin melakukan full event sourcing untuk semua hal.

Ini sangat cocok untuk case management, enforcement workflow, approval, escalation, dan lifecycle-heavy domain.

### 14.2 Bentuk Pattern

Current state document:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "state": "ESCALATED",
  "assignedUnit": "market-conduct",
  "priority": "HIGH",
  "currentReviewerId": "USR-017",
  "lastTransition": {
    "transitionId": "TR-991",
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "occurredAt": "2026-06-20T10:11:01Z",
    "actorId": "USR-017",
    "reasonCode": "HIGH_IMPACT"
  },
  "version": 18
}
```

Event history collection:

```json
{
  "_id": "TR-991",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "eventType": "CASE_ESCALATED",
  "fromState": "UNDER_REVIEW",
  "toState": "ESCALATED",
  "occurredAt": "2026-06-20T10:11:01Z",
  "actorId": "USR-017",
  "reasonCode": "HIGH_IMPACT",
  "commandId": "CMD-ABC-123"
}
```

### 14.3 Kenapa Bukan Full Event Sourcing?

Full event sourcing berarti source of truth adalah event log, dan current state dibangun dari replay event.

Event-snapshot hybrid lebih sederhana:

- current document tetap source of truth operasional;
- event log menjadi audit/history;
- replay tidak selalu diperlukan untuk semua operasi;
- migration lebih mudah;
- mental model tim lebih sederhana.

Ini sering lebih realistis untuk enterprise/regulatory systems.

### 14.4 Atomicity Problem

Command perlu update current state dan append event.

Pilihan:

1. transaksi multi-document;
2. embed last events kecil dalam current document dan write event async;
3. outbox pattern;
4. two-phase write with reconciliation;
5. event as source then projection update.

Untuk regulatory audit, jika event history wajib tidak hilang, gunakan transaksi atau outbox yang kuat.

### 14.5 Java Command Pattern

```java
public void escalateCase(EscalateCaseCommand command) {
    ClientSession session = mongoClient.startSession();

    session.withTransaction(() -> {
        CaseAggregate current = caseRepository.getForUpdate(session, command.caseId());

        CaseTransition transition = current.escalate(command);

        caseRepository.save(session, current);
        caseEventRepository.append(session, transition.toEvent());
        outboxRepository.append(session, transition.toIntegrationEvent());

        return null;
    });
}
```

Akan dibahas lebih detail di Part 013 dan Part 014.

### 14.6 Kapan Cocok

Gunakan event-snapshot hybrid ketika:

- current state sering dibaca;
- history wajib tersedia;
- workflow/state transition penting;
- auditability penting;
- full event sourcing terlalu berat;
- command invariant ada di current aggregate.

### 14.7 Kapan Tidak Cocok

Jangan gunakan jika:

- history tidak penting;
- write volume event sangat tinggi dan tidak butuh current state kaya;
- semua state harus strictly derived dari event log;
- tim belum siap mengelola dual-write semantics.

### 14.8 Pertanyaan Review

1. Mana source of truth: current document, event log, atau keduanya dengan semantic berbeda?
2. Apakah event append harus atomic dengan state update?
3. Apakah event bisa direkonstruksi dari state? Biasanya tidak.
4. Apakah event payload cukup untuk audit?
5. Apakah event mengandung snapshot actor/role/reason?
6. Apakah command idempotent?
7. Bagaimana reconciliation jika event/state mismatch?

---

## 15. Pattern 13 — Case Folder Pattern

### 15.1 Masalah yang Diselesaikan

Case folder pattern adalah pattern domain-specific untuk case management, investigation, enforcement, support, complaint, claim, atau workflow folder.

Masalahnya: sebuah case biasanya bukan satu entity sederhana. Ia adalah container lifecycle untuk banyak artefact:

- subject/party;
- allegation/issue;
- assigned team;
- state;
- tasks;
- notes;
- evidence;
- documents;
- decisions;
- audit;
- permissions;
- SLA;
- risk;
- communications.

Jika semua dimasukkan ke satu document, document menjadi monster. Jika semua dipisah seperti relational tables, MongoDB kehilangan locality.

Case folder pattern memisahkan:

- case header/core;
- embedded summaries;
- external detail collections;
- audit/event collection;
- search projection.

### 15.2 Bentuk Pattern

Case core:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "caseType": "ENFORCEMENT",
  "state": "UNDER_REVIEW",
  "priority": "HIGH",
  "subject": {
    "subjectId": "SUBJ-001",
    "nameAtOpen": "PT Example Finance",
    "riskClassAtOpen": "HIGH"
  },
  "ownership": {
    "assignedUnit": "market-conduct",
    "assignedReviewerId": "USR-017"
  },
  "summary": {
    "allegationCount": 3,
    "evidenceCount": 14,
    "openTaskCount": 7,
    "latestNote": {
      "noteId": "NOTE-901",
      "createdAt": "2026-06-20T09:10:00Z",
      "summary": "Requested additional supporting documents."
    }
  },
  "sla": {
    "dueAt": "2026-07-01T00:00:00Z",
    "status": "BREACH_RISK"
  },
  "version": 18,
  "schemaVersion": 3
}
```

External tasks:

```json
{
  "_id": "TASK-001",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "type": "REVIEW_DOCUMENT",
  "state": "OPEN",
  "assigneeId": "USR-017",
  "dueAt": "2026-06-25T00:00:00Z"
}
```

External evidence:

```json
{
  "_id": "EVID-001",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "type": "BANK_STATEMENT",
  "title": "January 2026 Statement",
  "receivedAt": "2026-06-20T10:00:00Z"
}
```

Audit events:

```json
{
  "_id": "EVT-001",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "eventType": "CASE_CREATED",
  "occurredAt": "2026-06-01T09:00:00Z",
  "actorId": "USR-001"
}
```

Search projection:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "subjectName": "PT Example Finance",
  "state": "UNDER_REVIEW",
  "priority": "HIGH",
  "assignedUnit": "market-conduct",
  "assignedReviewerId": "USR-017",
  "slaStatus": "BREACH_RISK",
  "lastActivityAt": "2026-06-20T10:11:01Z"
}
```

### 15.3 Kapan Cocok

Gunakan case folder pattern ketika:

- domain berbentuk lifecycle case;
- case punya banyak artefact;
- overview sering dibaca;
- detail dibuka terpisah;
- audit penting;
- workflow state penting;
- search/list sangat sering.

### 15.4 Core Design Rule

Case core harus menjawab:

> “Apa yang harus saya tahu untuk menampilkan case overview dan menjalankan command state-level dengan benar?”

Bukan:

> “Semua hal yang pernah berkaitan dengan case.”

### 15.5 Pertanyaan Review

1. Apa aggregate root case?
2. Apa yang wajib atomik dengan state case?
3. Apa yang hanya summary?
4. Apa yang external detail?
5. Apa yang append-only audit?
6. Apa yang search projection?
7. Apa retention masing-masing artefact?
8. Apa authorization boundary?

---

## 16. Pattern 14 — Form Submission Pattern

### 16.1 Masalah yang Diselesaikan

Form submission pattern digunakan untuk sistem yang menyimpan jawaban form dinamis.

Contoh:

- regulatory filing;
- KYC questionnaire;
- inspection checklist;
- complaint intake form;
- licensing application;
- evidence metadata capture.

Masalah utama:

- template berubah;
- jawaban harus tetap sesuai template saat submission;
- field bisa dynamic;
- validasi kompleks;
- sebagian field searchable;
- sebagian field sensitive;
- auditability penting.

### 16.2 Bentuk Pattern

```json
{
  "_id": "SUBMISSION-001",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "formCode": "KYC_REVIEW",
  "formVersion": 5,
  "submittedAt": "2026-06-20T10:00:00Z",
  "submittedBy": "USR-017",
  "answers": [
    {
      "fieldCode": "BENEFICIAL_OWNER_IDENTIFIED",
      "type": "BOOLEAN",
      "value": true
    },
    {
      "fieldCode": "RISK_RATIONALE",
      "type": "TEXT",
      "value": "Ownership structure indicates elevated complexity."
    },
    {
      "fieldCode": "RISK_SCORE",
      "type": "NUMBER",
      "value": 82
    }
  ],
  "searchableExtract": {
    "riskScore": 82,
    "beneficialOwnerIdentified": true
  }
}
```

### 16.3 Key Design Ideas

- store `formCode`;
- store `formVersion`;
- answer by stable `fieldCode`, not display label;
- snapshot required metadata if needed;
- extract searchable fields to controlled top-level/object fields;
- do not index arbitrary answer values blindly.

### 16.4 Kapan Cocok

Gunakan pattern ini ketika:

- form template changes over time;
- submission harus historical;
- field dynamic;
- typed answers penting;
- validasi mengikuti template version.

### 16.5 Pitfall

Buruk:

```json
{
  "answers": {
    "What is the risk score?": 82,
    "Has beneficial owner been identified?": true
  }
}
```

Masalah:

- label bisa berubah;
- localization merusak data;
- query sulit;
- validation sulit;
- migration buruk.

Lebih baik:

```json
{
  "answers": [
    { "fieldCode": "RISK_SCORE", "type": "NUMBER", "value": 82 },
    { "fieldCode": "BENEFICIAL_OWNER_IDENTIFIED", "type": "BOOLEAN", "value": true }
  ]
}
```

### 16.6 Pertanyaan Review

1. Apakah form version disimpan?
2. Apakah field code stabil?
3. Apakah label disimpan sebagai snapshot?
4. Field mana searchable?
5. Field mana sensitive?
6. Bagaimana validasi jawaban dilakukan?
7. Apakah answer value typed?
8. Bagaimana form lama dibaca setelah template berubah?

---

## 17. Pattern 15 — Workflow State Pattern

### 17.1 Masalah yang Diselesaikan

Workflow state pattern digunakan untuk lifecycle entity dengan state transition formal.

Contoh:

- case state;
- approval state;
- task state;
- document review state;
- complaint handling state;
- enforcement action state.

### 17.2 Bentuk Pattern

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "state": "UNDER_REVIEW",
  "stateEnteredAt": "2026-06-02T11:15:00Z",
  "allowedActions": [
    "REQUEST_INFORMATION",
    "ESCALATE",
    "CLOSE_WITHOUT_ACTION"
  ],
  "stateContext": {
    "reviewerId": "USR-017",
    "reviewDueAt": "2026-07-01T00:00:00Z"
  },
  "version": 18
}
```

### 17.3 Important Rule

`allowedActions` boleh disimpan sebagai computed/cache untuk UI, tetapi final authorization dan transition validation harus tetap dilakukan di server command handler.

Jangan percaya field `allowedActions` dari document sebagai satu-satunya rule source jika bisa stale.

### 17.4 Conditional Update

State transition harus guarded.

Konsep:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-2026-000127",
    tenantId: "regulator-id",
    state: "UNDER_REVIEW",
    version: 18
  },
  {
    $set: {
      state: "ESCALATED",
      stateEnteredAt: ISODate("2026-06-20T10:11:01Z")
    },
    $inc: { version: 1 }
  }
)
```

Jika `matchedCount = 0`, berarti:

- case tidak ada;
- tenant salah;
- state sudah berubah;
- version stale;
- actor menggunakan stale view.

### 17.5 Kapan Cocok

Gunakan workflow state pattern ketika:

- state transition formal;
- concurrency penting;
- audit transition penting;
- command harus idempotent;
- UI butuh allowed actions;
- SLA tergantung state.

### 17.6 Pertanyaan Review

1. Apa state machine formalnya?
2. Apa legal transitions?
3. Apa guard condition?
4. Apa side effect tiap transition?
5. Apakah transition harus menghasilkan audit event?
6. Apakah command idempotent?
7. Apakah stale actor terdeteksi?
8. Apakah state update atomic?

Part 014 nanti akan membahas ini lebih dalam.

---

## 18. Pattern 16 — Permission Snapshot Pattern

### 18.1 Masalah yang Diselesaikan

Permission snapshot pattern digunakan ketika access control untuk document perlu cepat dievaluasi dan/atau harus mempertahankan historical access context.

Contoh:

- case hanya bisa dilihat assigned unit;
- document punya classification;
- evidence hanya visible untuk role tertentu;
- external reviewer hanya boleh melihat subset;
- decision records punya restricted access.

### 18.2 Bentuk Pattern

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "state": "UNDER_REVIEW",
  "access": {
    "classification": "RESTRICTED",
    "owningUnit": "market-conduct",
    "allowedUnitIds": [
      "market-conduct",
      "legal-review"
    ],
    "allowedRoleCodes": [
      "CASE_REVIEWER",
      "SUPERVISOR"
    ],
    "permissionVersion": 12,
    "computedAt": "2026-06-20T10:00:00Z"
  }
}
```

### 18.3 Kapan Cocok

Gunakan permission snapshot ketika:

- access filter harus masuk query;
- authorization depends on document attributes;
- permission computation mahal;
- permission mostly stable;
- audit perlu tahu basis akses saat itu.

### 18.4 Bahaya

Permission snapshot bisa menjadi security bug jika stale.

Contoh:

- user dipindahkan unit, tetapi snapshot masih memberi akses;
- case reclassified restricted, tetapi projection search belum update;
- role dicabut, cache masih berlaku;
- tenant filter lupa.

### 18.5 Mitigasi

- tenantId selalu wajib di filter;
- permission snapshot hanya satu layer, bukan satu-satunya authorization;
- gunakan permission version;
- expire/recompute snapshot;
- enforce final check pada detail read/action;
- audit permission changes;
- test negative access case.

### 18.6 Query Example

```javascript
db.cases.find({
  tenantId: "regulator-id",
  "access.allowedUnitIds": "market-conduct",
  state: "UNDER_REVIEW"
})
```

Index harus mendukung shape ini.

### 18.7 Pertanyaan Review

1. Apakah snapshot dipakai untuk filtering atau final decision?
2. Seberapa stale boleh?
3. Apa permission version source?
4. Apakah tenant filter mandatory?
5. Apakah restricted data ada di projection?
6. Bagaimana revocation cepat dilakukan?
7. Apakah ada audit untuk access changes?

---

## 19. Pattern 17 — Search Projection Pattern

### 19.1 Masalah yang Diselesaikan

Search projection pattern digunakan ketika source document tidak cocok untuk search/list/query UI.

Source document sering:

- nested;
- kaya detail;
- punya embedded subdocuments;
- punya field sensitif;
- tidak optimal untuk sort/filter;
- tidak cocok untuk index kombinasi UI.

Search projection membuat document khusus untuk pencarian.

### 19.2 Bentuk Pattern

Source case:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "subject": {
    "subjectId": "SUBJ-001",
    "nameAtOpen": "PT Example Finance",
    "riskClassAtOpen": "HIGH"
  },
  "ownership": {
    "assignedUnit": "market-conduct",
    "assignedReviewerId": "USR-017"
  },
  "state": "UNDER_REVIEW",
  "sla": {
    "status": "BREACH_RISK",
    "dueAt": "2026-07-01T00:00:00Z"
  }
}
```

Search projection:

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "subjectId": "SUBJ-001",
  "subjectName": "PT Example Finance",
  "riskClass": "HIGH",
  "state": "UNDER_REVIEW",
  "assignedUnit": "market-conduct",
  "assignedReviewerId": "USR-017",
  "slaStatus": "BREACH_RISK",
  "dueAt": "2026-07-01T00:00:00Z",
  "lastActivityAt": "2026-06-20T10:11:01Z",
  "accessUnitIds": [
    "market-conduct",
    "legal-review"
  ],
  "searchText": "2026/ENF/000127 PT Example Finance HIGH UNDER_REVIEW"
}
```

### 19.3 Kapan Cocok

Gunakan search projection ketika:

- list/search adalah workload utama;
- source document terlalu nested;
- perlu filter/sort stabil;
- authorization filter perlu cepat;
- projection boleh eventual consistent;
- UI tidak butuh semua field.

### 19.4 Kapan Tidak Cocok

Jangan gunakan jika:

- data terlalu kecil dan source query sudah cukup;
- consistency search harus strict real-time;
- tim tidak siap mengelola projection rebuild;
- projection mengandung sensitive field tanpa security model.

### 19.5 Projection Update Strategy

Pilihan:

1. same transaction saat source update;
2. application-level synchronous update;
3. outbox consumer;
4. change stream consumer;
5. periodic rebuild;
6. on-demand refresh.

Untuk systems kritikal, projection harus rebuildable dari source.

### 19.6 Index Strategy

Projection biasanya punya index khusus:

```javascript
db.case_search.createIndex({
  tenantId: 1,
  state: 1,
  assignedUnit: 1,
  lastActivityAt: -1
})
```

```javascript
db.case_search.createIndex({
  tenantId: 1,
  subjectName: 1,
  caseNumber: 1
})
```

```javascript
db.case_search.createIndex({
  tenantId: 1,
  accessUnitIds: 1,
  slaStatus: 1,
  dueAt: 1
})
```

Projection index mengikuti UI/API search contract.

### 19.7 Pertanyaan Review

1. Apa search/list screens utama?
2. Field mana untuk filter?
3. Field mana untuk sort?
4. Field mana untuk display?
5. Field mana untuk authorization?
6. Seberapa stale projection boleh?
7. Bagaimana projection di-rebuild?
8. Apakah source dan projection punya version link?

---

## 20. Pattern Combination: Contoh Desain Satu Domain Realistis

Sekarang kita gabungkan pattern dalam satu domain: regulatory enforcement case.

### 20.1 Requirements

Sistem harus mendukung:

- create case;
- assign reviewer;
- add allegations;
- upload evidence;
- add notes;
- transition state;
- audit all actions;
- search cases;
- dashboard by SLA/risk;
- restrict access;
- support dynamic forms;
- keep history defensible.

### 20.2 Collection Design

Kemungkinan collection:

```text
cases
case_search
case_events
case_notes
case_evidence
case_tasks
case_form_submissions
subjects
```

### 20.3 Pattern Mapping

| Requirement | Pattern |
|---|---|
| Case overview cepat | Case folder pattern |
| Evidence banyak | Subset + outlier pattern |
| Audit history | Event-snapshot hybrid / bucket pattern |
| Dynamic intake form | Form submission + attribute pattern |
| Case search | Search projection pattern |
| SLA/risk count | Computed pattern |
| Subject name in case | Extended reference pattern |
| Workflow state | Workflow state pattern |
| Access filtering | Permission snapshot pattern |
| Schema evolution | Schema version pattern |

### 20.4 Example: `cases`

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "schemaVersion": 3,
  "caseNumber": "2026/ENF/000127",
  "caseType": "ENFORCEMENT",
  "state": "UNDER_REVIEW",
  "stateEnteredAt": "2026-06-02T11:15:00Z",
  "priority": "HIGH",
  "subject": {
    "subjectId": "SUBJ-001",
    "nameAtOpen": "PT Example Finance",
    "riskClassAtOpen": "HIGH"
  },
  "ownership": {
    "assignedUnit": "market-conduct",
    "assignedReviewerId": "USR-017"
  },
  "summary": {
    "allegationCount": 3,
    "evidenceCount": 14,
    "latestNote": {
      "noteId": "NOTE-901",
      "createdAt": "2026-06-20T09:10:00Z",
      "summary": "Requested additional supporting documents."
    }
  },
  "computed": {
    "openTaskCount": 7,
    "overdueTaskCount": 2,
    "slaStatus": "BREACH_RISK",
    "lastActivityAt": "2026-06-20T10:11:01Z",
    "refreshedAt": "2026-06-20T10:12:00Z"
  },
  "access": {
    "classification": "RESTRICTED",
    "allowedUnitIds": [
      "market-conduct",
      "legal-review"
    ],
    "permissionVersion": 12
  },
  "version": 18
}
```

### 20.5 Example: `case_search`

```json
{
  "_id": "CASE-2026-000127",
  "tenantId": "regulator-id",
  "caseNumber": "2026/ENF/000127",
  "caseType": "ENFORCEMENT",
  "state": "UNDER_REVIEW",
  "priority": "HIGH",
  "subjectId": "SUBJ-001",
  "subjectName": "PT Example Finance",
  "riskClass": "HIGH",
  "assignedUnit": "market-conduct",
  "assignedReviewerId": "USR-017",
  "slaStatus": "BREACH_RISK",
  "lastActivityAt": "2026-06-20T10:11:01Z",
  "accessUnitIds": [
    "market-conduct",
    "legal-review"
  ],
  "sourceVersion": 18,
  "projectedAt": "2026-06-20T10:12:05Z"
}
```

### 20.6 Example: `case_events`

```json
{
  "_id": "EVT-991",
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000127",
  "eventType": "CASE_ESCALATED",
  "occurredAt": "2026-06-20T10:11:01Z",
  "actor": {
    "userId": "USR-017",
    "displayNameSnapshot": "A. Reviewer",
    "roleSnapshot": "SUPERVISOR"
  },
  "payload": {
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "reasonCode": "HIGH_IMPACT"
  },
  "commandId": "CMD-ABC-123"
}
```

### 20.7 Design Consequence

Desain ini tidak “normalized” seperti relational model. Ia juga tidak “semua embed”.

Ia sengaja membagi data berdasarkan:

- command consistency;
- read access;
- search access;
- audit history;
- growth control;
- authorization;
- migration;
- operational observability.

Itulah inti MongoDB modelling yang matang.

---

## 21. Common Anti-Patterns dalam Pattern Usage

### 21.1 Pattern Shopping

Engineer membaca pattern catalogue lalu mencoba memakai semua pattern.

Masalah:

- desain menjadi terlalu kompleks;
- setiap write punya banyak side effect;
- debugging sulit;
- consistency sulit dijelaskan.

Prinsip:

> Pakai pattern hanya ketika ada pressure nyata yang diselesaikan.

### 21.2 Generic Attributes untuk Semua Field

Buruk:

```json
{
  "attributes": [
    { "name": "tenantId", "value": "regulator-id" },
    { "name": "state", "value": "OPEN" },
    { "name": "createdAt", "value": "2026-06-20" }
  ]
}
```

Field utama harus tetap field utama.

### 21.3 Projection tanpa Rebuild Strategy

Jika membuat `case_search`, harus bisa menjawab:

- dari mana projection dibangun?
- bagaimana jika tertinggal?
- bagaimana rebuild seluruh projection?
- bagaimana mendeteksi mismatch?

Projection tanpa rebuild strategy adalah technical debt.

### 21.4 Snapshot tanpa Semantic Name

Buruk:

```json
"subjectName": "PT Example Finance"
```

Tidak jelas apakah historical atau current.

Lebih baik:

```json
"subjectNameAtOpen": "PT Example Finance"
```

atau:

```json
"currentSubjectNameSnapshot": "PT Example Finance Tbk"
```

### 21.5 Computed Field Dipakai untuk Keputusan Final

Cached computed field boleh untuk UI/dashboard. Untuk keputusan kritikal, recompute atau validate freshness.

### 21.6 Permission Snapshot sebagai Satu-Satunya Security

Permission snapshot membantu filtering. Final authorization tetap harus ada di service layer, terutama untuk detail read dan command.

### 21.7 Bucket tanpa Batas

Bucket pattern gagal jika bucket tidak punya batas size/time/count.

### 21.8 Polymorphic Collection tanpa Discriminator

Subtype harus eksplisit. Jangan mengandalkan keberadaan field.

### 21.9 Outlier Pattern tanpa Monitoring

Jika outlier makin banyak, berarti outlier bukan outlier. Model perlu ditinjau ulang.

---

## 22. Pattern Selection Matrix

| Kondisi | Pattern Kandidat |
|---|---|
| Field banyak dan bervariasi | Attribute pattern |
| Event/time data besar | Bucket pattern |
| Parent butuh sedikit child summary | Subset pattern |
| Reference butuh display field | Extended reference pattern |
| Perhitungan sering dibaca | Computed pattern |
| Exact terlalu mahal | Approximation pattern |
| Sebagian kecil entity sangat besar | Outlier pattern |
| Struktur slot fixed | Preallocation pattern |
| Banyak subtype satu family | Polymorphic pattern |
| Schema berubah sepanjang waktu | Schema version pattern |
| Hierarchy/tree | Tree pattern |
| Current state + audit history | Event-snapshot hybrid |
| Case/workflow container | Case folder pattern |
| Dynamic regulatory form | Form submission pattern |
| Lifecycle formal | Workflow state pattern |
| Fast access control filtering | Permission snapshot pattern |
| Search/list optimized shape | Search projection pattern |

---

## 23. Senior-Level Design Heuristics

### 23.1 Start from Access Patterns, Not Entity Classes

Jangan mulai dari:

```text
I have Java classes Case, Subject, Evidence, Note, Task.
Therefore I need collections cases, subjects, evidences, notes, tasks.
```

Mulai dari:

```text
What does the system need to read quickly?
What must be updated atomically?
What grows without bound?
What must be audited?
What can be eventually consistent?
What needs independent lifecycle?
```

### 23.2 Make Staleness Explicit

Jika ada duplicate/projection/computed/snapshot, selalu tentukan:

- exact or approximate;
- current or historical;
- refreshedAt;
- sourceVersion;
- formulaVersion;
- acceptable stale window.

### 23.3 Keep Command Model and Query Model Separate When Needed

Tidak semua query harus dipenuhi source aggregate.

Jika list/search/dashboard menekan model utama terlalu keras, buat projection.

### 23.4 Design Rebuildability

Setiap derived data harus bisa dibangun ulang.

Ini mencakup:

- search projection;
- computed summary;
- permission snapshot;
- latest note summary;
- dashboard counters.

### 23.5 Avoid Invisible Semantics

Buruk:

```json
"name": "PT Example Finance"
```

Lebih baik:

```json
"nameAtCaseOpen": "PT Example Finance"
```

Buruk:

```json
"count": 12400
```

Lebih baik:

```json
"totalEstimate": 12400,
"precision": "APPROXIMATE"
```

Buruk:

```json
"summary": { ... }
```

Lebih baik:

```json
"latestNotesProjection": { ... }
```

Nama field adalah bagian dari desain sistem.

---

## 24. Practical Design Workflow

Saat mendesain collection MongoDB, gunakan workflow berikut.

### Step 1 — Tulis Access Pattern

Contoh:

```text
AP-001: Search cases by tenant, state, assignedUnit, lastActivityAt desc.
AP-002: Open case overview by caseId.
AP-003: List evidence by caseId, type, receivedAt desc.
AP-004: Add note to case.
AP-005: Escalate case if current state is UNDER_REVIEW.
AP-006: Show SLA dashboard by unit.
AP-007: Export audit history by caseId and time range.
```

### Step 2 — Tulis Consistency Requirement

```text
Escalate case must atomically change case state and create audit event.
Latest note summary may be eventually consistent.
Search projection may lag by up to 10 seconds.
SLA dashboard may lag by 5 minutes.
Permission revocation must take effect immediately for detail read.
```

### Step 3 — Tulis Growth Estimate

```text
Case: 1 document per case.
Notes: up to 10,000 per case in extreme cases.
Evidence: up to 100,000 per mega-case.
Audit events: append-only, millions per tenant per year.
Search projection: 1 per active case.
```

### Step 4 — Pilih Pattern

```text
Case overview: case folder + computed + extended reference.
Notes: external collection + subset latest notes.
Evidence: external collection + outlier handling.
Audit: event-snapshot hybrid + bucket if needed.
Search: search projection.
Dynamic forms: form submission + schema version.
```

### Step 5 — Tulis Failure Modes

```text
Projection stale.
Duplicate command retry.
Concurrent state transition.
Permission snapshot stale.
Bucket too large.
Outlier threshold exceeded.
Schema version unsupported.
```

### Step 6 — Tambahkan Operational Plan

```text
Projection rebuild job.
Schema migration scanner.
Index review.
Slow query alert.
Outlier count metric.
Permission version audit.
Event/state reconciliation job.
```

---

## 25. Mini Exercise

Desain MongoDB model untuk “regulatory document intake”.

Requirement:

1. Submission punya dynamic fields tergantung document type.
2. Sebagian field harus searchable.
3. Submission harus mempertahankan template version.
4. Document file metadata harus bisa tumbuh banyak.
5. Case overview hanya butuh 5 document terbaru.
6. Audit setiap perubahan wajib ada.
7. Search by tenant, caseId, documentType, submittedAt.

Jawaban pattern yang mungkin:

| Requirement | Pattern |
|---|---|
| dynamic fields | Attribute / form submission pattern |
| searchable fields | searchable extract / search projection |
| template version | schema/form version pattern |
| banyak file metadata | external collection / bucket jika time-heavy |
| 5 document terbaru | subset pattern |
| audit perubahan | event-snapshot hybrid |
| search | compound index / search projection |

Kemungkinan collection:

```text
case_document_submissions
case_document_files
case_document_search
case_events
cases
```

---

## 26. Checklist Akhir Part 009

Setelah memahami part ini, Anda seharusnya bisa menjelaskan:

- kenapa pattern MongoDB lahir dari pressure sistem;
- kapan memakai attribute pattern;
- kapan memakai bucket pattern;
- kapan memakai subset pattern;
- kapan memakai extended reference;
- perbedaan historical snapshot dan cached live summary;
- kapan computed value aman;
- kapan approximation tidak boleh dipakai;
- bagaimana outlier pattern melindungi mayoritas use case;
- kapan preallocation masuk akal;
- bagaimana polymorphic collection dikontrol;
- kenapa schema version penting;
- cara modelling tree;
- kapan event-snapshot hybrid lebih realistis daripada full event sourcing;
- cara membangun case folder pattern;
- cara menyimpan dynamic form defensibly;
- cara menyimpan workflow state;
- risiko permission snapshot;
- kapan membuat search projection;
- bagaimana menggabungkan pattern tanpa membuat sistem terlalu kompleks.

---

## 27. Hubungan ke Part Berikutnya

Part 009 membahas pattern modelling sistem nyata.

Part berikutnya akan masuk ke sisi Java object modelling:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-010.md
```

Judul:

```text
Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability
```

Kita akan membahas:

- Java object model vs persisted document model;
- entity vs DTO vs persistence shape;
- POJO mapping;
- Java records;
- immutability;
- enum strategy;
- value object;
- decimal/date/time mapping;
- schema versioning di Java;
- backward-compatible readers;
- anti-pattern `Map<String,Object>` dan document model yang terlalu anemic.

---

## 28. Status Seri

Status setelah part ini:

```text
Selesai: Part 000 sampai Part 009
Belum selesai: Part 010 sampai Part 035
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Data Modelling I: Embed vs Reference Decision Framework</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-010.md">Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability ➡️</a>
</div>
