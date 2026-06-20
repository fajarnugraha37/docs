# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-010.md

# Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 010 dari 035  
> Fokus: bagaimana mendesain schema MongoDB yang sehat untuk aplikasi Java production-grade, tanpa jatuh ke jebakan “JPA mindset”, “DTO disimpan mentah”, atau “schema-less berarti bebas struktur”.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membahas:

- document database mental model;
- BSON dan struktur dokumen;
- arsitektur MongoDB;
- CRUD semantics;
- query model;
- indexing;
- embed vs reference;
- data modelling patterns.

Part ini menjawab pertanyaan yang biasanya muncul setelah semua itu:

> “Kalau model dokumennya sudah jelas, bagaimana bentuk Java class-nya?”

Atau lebih spesifik:

- apakah Java entity harus sama dengan MongoDB document?
- apakah API DTO boleh langsung disimpan ke collection?
- apakah Java record cocok untuk MongoDB?
- apakah immutable object worth it?
- bagaimana mapping `BigDecimal`, `Instant`, `UUID`, enum, nested value object?
- bagaimana schema bisa berevolusi tanpa migrasi besar setiap kali ada field baru?
- bagaimana menghindari object mapping yang terlihat rapi tapi sebenarnya merusak boundary domain?

Part ini penting karena banyak project MongoDB gagal bukan karena query syntax, tetapi karena **ketidaksejajaran antara domain model, API model, dan persistence model**.

---

## 1. Prinsip Utama: MongoDB Document Bukan Java Object yang “Kebetulan Disimpan”

Kesalahan awal yang sangat umum:

```java
public class Case {
    private String id;
    private Customer customer;
    private List<Task> tasks;
    private List<Document> documents;
    private List<AuditEvent> auditEvents;
    private List<Comment> comments;
    private List<User> assignedUsers;
}
```

Lalu semua field disimpan menjadi satu dokumen besar karena “MongoDB kan document database”.

Masalahnya:

- Java object model sering dibentuk dari kenyamanan coding.
- API response model sering dibentuk dari kebutuhan UI.
- Domain model dibentuk dari invariant bisnis.
- Persistence document seharusnya dibentuk dari access pattern, lifecycle, ownership, atomicity, growth, dan indexing.

Keempat model ini **boleh saling mirip**, tetapi tidak harus identik.

Model yang baik tidak bertanya:

> “Class Java saya seperti apa?”

Tetapi bertanya:

> “Invariant apa yang harus dijaga, data apa yang dibaca bersama, data apa yang berubah bersama, dan document shape apa yang paling aman untuk sistem ini?”

Baru setelah itu Java class dibuat untuk merepresentasikan shape tersebut.

---

## 2. Empat Model yang Harus Dipisahkan Secara Mental

Dalam aplikasi Java modern, minimal ada empat lapisan model.

### 2.1 Domain Model

Domain model mewakili konsep bisnis dan invariant.

Contoh:

```java
public final class EnforcementCase {
    private final CaseId id;
    private final CaseStatus status;
    private final CaseSubject subject;
    private final RiskLevel riskLevel;
    private final Version version;

    public EnforcementCase escalate(UserId actor, Reason reason) {
        if (!status.canEscalate()) {
            throw new IllegalStateException("Case cannot be escalated from " + status);
        }
        return new EnforcementCase(
            id,
            CaseStatus.ESCALATED,
            subject,
            riskLevel,
            version.next()
        );
    }
}
```

Karakter domain model:

- kaya perilaku;
- menjaga invariant;
- tidak tahu detail MongoDB;
- tidak harus memiliki semua field persistence;
- tidak harus memiliki setter;
- tidak harus mengikuti struktur API.

Domain model sebaiknya tidak penuh dengan annotation persistence kalau domain ingin tetap bersih.

### 2.2 Persistence Model / Document Model

Persistence model mewakili bentuk dokumen yang disimpan di MongoDB.

Contoh:

```java
public final class CaseDocument {
    private String id;
    private String tenantId;
    private String caseNumber;
    private String status;
    private SubjectSnapshotDocument subject;
    private RiskDocument risk;
    private AssignmentDocument assignment;
    private Instant createdAt;
    private Instant updatedAt;
    private long version;
    private int schemaVersion;
}
```

Karakter persistence model:

- stabil terhadap query/index;
- dekat dengan BSON structure;
- boleh memiliki field teknis seperti `schemaVersion`, `createdAt`, `updatedAt`, `version`;
- boleh berbeda dari domain object;
- memuat denormalized snapshot bila memang dibutuhkan access pattern.

### 2.3 API DTO / Request-Response Model

API DTO mewakili kontrak HTTP/API.

Contoh:

```java
public record CaseResponse(
    String caseId,
    String caseNumber,
    String status,
    String subjectName,
    String riskLevel,
    Instant lastUpdatedAt
) {}
```

Karakter API DTO:

- stabil untuk client;
- boleh menyembunyikan internal field;
- boleh flatten nested structure;
- boleh menggabungkan data dari beberapa sumber;
- tidak boleh otomatis menjadi persistence schema.

Menyimpan request DTO langsung ke MongoDB hampir selalu buruk untuk sistem serius.

Alasannya:

- request shape mengikuti UI/use case tertentu;
- persistence shape mengikuti lifecycle dan query;
- API contract punya backward compatibility sendiri;
- database schema punya backward compatibility sendiri;
- menyatukan keduanya membuat perubahan UI bisa merusak storage.

### 2.4 Query Projection / Read Model

Read model adalah bentuk data yang dipakai untuk query cepat atau screen tertentu.

Contoh:

```java
public record CaseSearchRow(
    String id,
    String caseNumber,
    String status,
    String subjectName,
    String assignedTeam,
    Instant updatedAt
) {}
```

Read model bisa berasal dari:

- projection query;
- aggregation;
- denormalized fields dalam document utama;
- collection khusus read model;
- search index;
- materialized view di aplikasi.

Read model tidak harus punya perilaku domain.

---

## 3. Rule Praktis: Jangan Paksa Satu Class Untuk Semua Lapisan

Satu class untuk domain + persistence + API terlihat hemat di awal:

```java
@Document("cases")
public class CaseDto {
    @Id
    private String id;
    private String status;
    private String subjectName;
    private List<TaskDto> tasks;
}
```

Awalnya cepat.

Lalu datang kebutuhan:

- API ingin field `displayStatus`;
- database butuh `schemaVersion`;
- domain butuh transition guard;
- query butuh denormalized `assignedTeamId`;
- security ingin menyembunyikan field internal;
- migration butuh membaca old schema;
- UI ingin response flatten;
- audit butuh append-only structure;
- index butuh field stabil.

Satu class tadi berubah menjadi monster:

```java
@Document("cases")
@JsonInclude(...)
@JsonIgnoreProperties(...)
public class Case {
    @Id
    private String id;

    @JsonProperty("case_id")
    private String caseId;

    @JsonIgnore
    private int schemaVersion;

    @JsonProperty("display_status")
    private String displayStatus;

    @Transient
    private boolean editable;

    // domain method? persistence method? API method?
}
```

Ini bukan desain sederhana. Ini hanya **coupling yang belum terasa sakit**.

Rekomendasi untuk sistem production-grade:

| Layer | Model | Boleh Sama? | Catatan |
|---|---|---:|---|
| Domain | Aggregate/value object | Kadang | Utamakan invariant |
| Persistence | Document class | Kadang | Utamakan storage shape |
| API | Request/response DTO | Sebaiknya terpisah | Utamakan contract |
| Query | Projection/read model | Sebaiknya terpisah | Utamakan speed dan screen shape |

Untuk aplikasi kecil, boleh pragmatic. Untuk sistem regulasi, case management, audit-heavy, atau multi-team, pisahkan model lebih awal.

---

## 4. Document Class: Apa yang Harus Ada?

Persistence document class biasanya punya beberapa kategori field.

### 4.1 Identity Fields

Contoh:

```java
private String id;
private String tenantId;
private String caseNumber;
```

`id` adalah primary identifier MongoDB/document.

`tenantId` sering wajib untuk multi-tenancy.

`caseNumber` bisa menjadi business identifier.

Jangan mencampur semuanya.

| Field | Fungsi |
|---|---|
| `_id` / `id` | identity teknis document |
| `tenantId` | isolation boundary |
| `caseNumber` | business readable identifier |
| `externalReference` | integrasi eksternal |

Satu hal penting:

> Business ID tidak selalu cocok menjadi `_id`.

Kadang cocok, kadang tidak.

Gunakan business ID sebagai `_id` bila:

- benar-benar globally unique;
- immutable;
- selalu tersedia saat insert;
- tidak mengandung informasi sensitif;
- tidak berubah karena aturan bisnis.

Gunakan generated ID bila:

- business ID bisa berubah;
- ID berasal dari sistem eksternal yang belum stabil;
- perlu internal/external ID separation;
- ingin menghindari leakage informasi.

### 4.2 Lifecycle Fields

```java
private Instant createdAt;
private Instant updatedAt;
private String createdBy;
private String updatedBy;
```

Lifecycle fields berguna untuk:

- audit ringan;
- sorting;
- troubleshooting;
- retention;
- reconciliation.

Tetapi jangan menganggap `updatedAt` sebagai audit trail. Audit trail harus append-only dan menjelaskan siapa melakukan apa, kapan, dari state apa ke state apa, dengan alasan apa.

### 4.3 Versioning Fields

```java
private long version;
private int schemaVersion;
```

`version` untuk optimistic concurrency.

`schemaVersion` untuk document shape evolution.

Jangan campur keduanya.

| Field | Tujuan |
|---|---|
| `version` | concurrency control |
| `schemaVersion` | migration/evolution |

Contoh penggunaan `version`:

```javascript
db.cases.updateOne(
  { _id: "case-123", version: 7, status: "UNDER_REVIEW" },
  {
    $set: { status: "ESCALATED", updatedAt: ISODate(...) },
    $inc: { version: 1 }
  }
)
```

Contoh penggunaan `schemaVersion`:

```json
{
  "_id": "case-123",
  "schemaVersion": 3,
  "status": "UNDER_REVIEW",
  "risk": {
    "level": "HIGH",
    "score": 87
  }
}
```

### 4.4 State Fields

```java
private String status;
private String phase;
private String subStatus;
```

State fields perlu disiplin.

Anti-pattern:

```json
{
  "status": "OPEN",
  "isClosed": true,
  "closedAt": null,
  "phase": "DECISION",
  "decisionStatus": "PENDING"
}
```

Ini membuat contradiction.

Lebih baik:

```json
{
  "status": "UNDER_REVIEW",
  "statusChangedAt": "2026-06-20T09:30:00Z"
}
```

Atau jika memang perlu state machine lebih kaya:

```json
{
  "workflow": {
    "state": "UNDER_REVIEW",
    "phase": "INVESTIGATION",
    "enteredAt": "2026-06-20T09:30:00Z",
    "assignedRole": "SENIOR_REVIEWER"
  }
}
```

Rule:

> Jangan simpan banyak representasi state kecuali ada invariant jelas yang menjaga konsistensinya.

### 4.5 Embedded Value Objects

```java
private SubjectSnapshotDocument subject;
private RiskDocument risk;
private AssignmentDocument assignment;
```

Embedded value object cocok untuk data yang:

- dimiliki oleh parent;
- dibaca bersama parent;
- berubah bersama parent;
- ukurannya bounded;
- tidak perlu lifecycle independen.

Contoh:

```json
{
  "_id": "case-123",
  "subject": {
    "subjectId": "subj-777",
    "name": "PT Contoh Abadi",
    "type": "LEGAL_ENTITY",
    "riskCategory": "HIGH"
  }
}
```

Perhatikan nama `SubjectSnapshotDocument`, bukan `SubjectDocument`.

Kenapa?

Karena data subject di dalam case mungkin adalah snapshot saat case dibuat, bukan canonical subject record.

Penamaan yang baik mencegah salah paham lifecycle.

---

## 5. Java POJO Mapping: Kenyamanan yang Bisa Menyesatkan

MongoDB Java Driver bisa memetakan document ke POJO. Spring Data MongoDB juga bisa memetakan object ke collection.

Tetapi mapping bukan desain.

Mapping menjawab:

> “Bagaimana object ini diubah menjadi BSON dan sebaliknya?”

Bukan:

> “Apakah object ini adalah model persistence yang benar?”

### 5.1 POJO Mutable Style

Contoh sederhana:

```java
public class CaseDocument {
    private String id;
    private String tenantId;
    private String status;
    private Instant createdAt;
    private Instant updatedAt;
    private long version;

    public CaseDocument() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getTenantId() {
        return tenantId;
    }

    public void setTenantId(String tenantId) {
        this.tenantId = tenantId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
```

Kelebihan:

- mudah dipakai mapper;
- familiar untuk framework;
- minim konfigurasi.

Kelemahan:

- mutable object bisa berubah sembarangan;
- invariant tidak terlihat;
- setter bisa dipakai dari mana saja;
- mudah tercampur domain logic.

Mutable POJO masih bisa diterima untuk persistence model jika class tersebut tidak diperlakukan sebagai domain aggregate.

### 5.2 Immutable Style

Contoh:

```java
public final class CaseDocument {
    private final String id;
    private final String tenantId;
    private final String status;
    private final Instant createdAt;
    private final Instant updatedAt;
    private final long version;
    private final int schemaVersion;

    public CaseDocument(
        String id,
        String tenantId,
        String status,
        Instant createdAt,
        Instant updatedAt,
        long version,
        int schemaVersion
    ) {
        this.id = Objects.requireNonNull(id);
        this.tenantId = Objects.requireNonNull(tenantId);
        this.status = Objects.requireNonNull(status);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.updatedAt = Objects.requireNonNull(updatedAt);
        this.version = version;
        this.schemaVersion = schemaVersion;
    }

    public String id() { return id; }
    public String tenantId() { return tenantId; }
    public String status() { return status; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public long version() { return version; }
    public int schemaVersion() { return schemaVersion; }
}
```

Kelebihan:

- object tidak berubah diam-diam;
- lebih aman untuk concurrency reasoning;
- lebih mudah diuji;
- lebih dekat ke value semantics.

Kekurangan:

- mapping bisa butuh konfigurasi;
- constructor compatibility harus dijaga;
- optional/default field harus dipikirkan.

Untuk domain model, immutable biasanya sangat kuat.

Untuk persistence model, immutable juga baik, tetapi pastikan mapper/framework mendukung pola constructor binding yang dipakai.

---

## 6. Java Records: Cocok, Tapi Jangan Dipakai Tanpa Strategi

Java record menarik untuk DTO dan simple immutable data carrier.

Contoh:

```java
public record CaseSearchRow(
    String id,
    String caseNumber,
    String status,
    String subjectName,
    Instant updatedAt
) {}
```

Record cocok untuk:

- API response;
- command/request DTO;
- projection result;
- small value object;
- immutable read model.

Record kurang ideal bila:

- butuh complex invariant dengan banyak factory;
- perlu backward-compatible deserialization dengan banyak optional field;
- field terus bertambah dan constructor menjadi tidak stabil;
- framework mapping belum nyaman;
- ingin hidden derived field.

### 6.1 Record untuk API DTO

Sangat cocok:

```java
public record CreateCaseRequest(
    String tenantId,
    String subjectId,
    String allegationType,
    String description
) {}
```

### 6.2 Record untuk Projection

Sangat cocok:

```java
public record CaseListItem(
    String id,
    String caseNumber,
    String status,
    String assignedTeam,
    Instant updatedAt
) {}
```

### 6.3 Record untuk Persistence Document

Bisa, tetapi hati-hati:

```java
public record CaseDocument(
    String id,
    String tenantId,
    String caseNumber,
    String status,
    SubjectSnapshotDocument subject,
    Instant createdAt,
    Instant updatedAt,
    long version,
    int schemaVersion
) {}
```

Masalah muncul ketika schema berubah:

- field baru ditambahkan;
- old document tidak punya field itu;
- default value diperlukan;
- constructor canonical record tidak otomatis tahu default business rule.

Solusi:

- gunakan compact constructor untuk default ringan;
- gunakan mapper manual dari raw `Document` untuk area sensitif;
- gunakan version-aware mapping;
- jangan pakai record untuk document yang evolusinya kompleks.

Contoh compact constructor:

```java
public record CaseDocument(
    String id,
    String tenantId,
    String status,
    int schemaVersion
) {
    public CaseDocument {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(tenantId, "tenantId");
        status = status == null ? "NEW" : status;
        schemaVersion = schemaVersion == 0 ? 1 : schemaVersion;
    }
}
```

Tetapi jangan terlalu banyak logic dalam record persistence.

Jika defaulting sudah rumit, buat mapper eksplisit.

---

## 7. Lombok: Mengurangi Boilerplate, Tapi Bisa Menyembunyikan Desain Buruk

Lombok sering dipakai:

```java
@Data
@Document("cases")
public class CaseDocument {
    @Id
    private String id;
    private String tenantId;
    private String status;
}
```

`@Data` menghasilkan:

- getter;
- setter;
- `equals`;
- `hashCode`;
- `toString`;
- required args constructor.

Masalah:

- setter untuk semua field;
- `equals/hashCode` bisa tidak cocok untuk entity identity;
- `toString` bisa membocorkan sensitive field;
- object terlihat sederhana padahal invariant hilang;
- perubahan field bisa mengubah equality semantics.

Lebih aman:

```java
@Getter
@Builder
@ToString(exclude = {"sensitiveNotes"})
public class CaseDocument {
    private final String id;
    private final String tenantId;
    private final String status;
    private final List<String> sensitiveNotes;
}
```

Atau untuk persistence mutable:

```java
@Getter
@Setter(AccessLevel.PACKAGE)
@NoArgsConstructor(access = AccessLevel.PACKAGE)
public class CaseDocument {
    private String id;
    private String tenantId;
    private String status;
}
```

Rule:

> Jangan memakai `@Data` secara default untuk document/entity penting.

Gunakan Lombok sebagai alat, bukan desain.

---

## 8. Annotation Strategy: Spring Data vs Driver-Native vs Mapper Manual

Ada tiga pendekatan umum.

### 8.1 Annotation di Persistence Model

Contoh Spring Data:

```java
@Document(collection = "cases")
public class CaseDocument {
    @Id
    private String id;

    @Field("tenantId")
    private String tenantId;

    @Field("caseNumber")
    private String caseNumber;

    @Field("status")
    private String status;
}
```

Kelebihan:

- mudah;
- jelas collection-nya;
- cocok dengan Spring Data repository/template;
- hemat mapping manual.

Kekurangan:

- persistence concern masuk ke class;
- jika class juga domain object, domain tercemar;
- perubahan framework bisa berdampak ke model.

Rekomendasi:

- annotation boleh di persistence model;
- hindari annotation persistence di pure domain model.

### 8.2 Driver-Native POJO Codec

Dengan MongoDB Java Driver, POJO codec bisa digunakan untuk mapping tanpa Spring Data.

Kelebihan:

- lebih dekat ke driver;
- bagus untuk aplikasi non-Spring;
- kontrol connection/session lebih eksplisit.

Kekurangan:

- konfigurasi codec perlu disiplin;
- tidak se-“batteries included” Spring Data;
- conversion custom tetap perlu dirancang.

### 8.3 Mapper Manual

Contoh:

```java
public final class CaseDocumentMapper {
    public Document toBson(CaseDocument doc) {
        return new Document("_id", doc.id())
            .append("tenantId", doc.tenantId())
            .append("caseNumber", doc.caseNumber())
            .append("status", doc.status())
            .append("version", doc.version())
            .append("schemaVersion", doc.schemaVersion())
            .append("createdAt", Date.from(doc.createdAt()))
            .append("updatedAt", Date.from(doc.updatedAt()));
    }

    public CaseDocument fromBson(Document bson) {
        int schemaVersion = bson.getInteger("schemaVersion", 1);
        return switch (schemaVersion) {
            case 1 -> fromV1(bson);
            case 2 -> fromV2(bson);
            default -> throw new IllegalArgumentException("Unsupported schema version: " + schemaVersion);
        };
    }
}
```

Kelebihan:

- kontrol penuh;
- schema evolution eksplisit;
- bagus untuk domain kritikal;
- bisa handle old documents dengan jelas.

Kekurangan:

- boilerplate;
- raw string field name risk;
- perlu test kuat;
- lebih lambat dikembangkan.

Rekomendasi praktis:

| Area | Pendekatan |
|---|---|
| CRUD sederhana | Spring Data / POJO codec |
| Projection sederhana | record/DTO mapping |
| Domain kritikal dengan schema evolution kompleks | mapper manual atau mapper eksplisit |
| Aggregation result | dedicated projection DTO |
| Security-sensitive transformation | mapper eksplisit |

---

## 9. Field Naming Strategy

Ada tiga strategi umum.

### 9.1 camelCase

```json
{
  "caseNumber": "CASE-2026-0001",
  "createdAt": "2026-06-20T10:00:00Z"
}
```

Kelebihan:

- natural untuk Java/JavaScript;
- umum di MongoDB;
- mudah dibaca.

Kekurangan:

- jika organisasi memakai snake_case di data platform, bisa berbeda.

### 9.2 snake_case

```json
{
  "case_number": "CASE-2026-0001",
  "created_at": "2026-06-20T10:00:00Z"
}
```

Kelebihan:

- konsisten dengan banyak data warehouse/SQL conventions;
- bisa cocok untuk cross-language teams.

Kekurangan:

- perlu mapping annotation/converter di Java;
- bisa tidak natural untuk MongoDB examples.

### 9.3 Compact Field Names

```json
{
  "cn": "CASE-2026-0001",
  "ca": "2026-06-20T10:00:00Z"
}
```

Biasanya tidak direkomendasikan kecuali ada alasan ekstrem.

Kelemahan:

- sulit dibaca;
- mahal untuk maintenance;
- raw query/debugging buruk;
- developer baru mudah salah.

Rekomendasi:

> Gunakan `camelCase` kecuali ada standar organisasi yang kuat.

Untuk field yang di-index dan sering dipakai query, nama harus stabil. Mengganti nama field indexed di production adalah migration problem, bukan refactor biasa.

---

## 10. Null, Missing, Optional, dan Default Value

Ini area yang sering menyebabkan bug halus.

MongoDB membedakan secara praktis antara:

```json
{ "riskLevel": null }
```

Dan:

```json
{ }
```

Di Java, ada juga:

```java
private String riskLevel; // null possible
private Optional<String> riskLevel; // controversial for fields
```

### 10.1 Jangan Pakai `Optional` Sebagai Field Persistence

Buruk:

```java
public class CaseDocument {
    private Optional<String> riskLevel;
}
```

`Optional` lebih cocok untuk return type method, bukan field serializable.

Lebih baik:

```java
public class CaseDocument {
    private String riskLevel; // nullable by schema contract

    public Optional<String> riskLevel() {
        return Optional.ofNullable(riskLevel);
    }
}
```

Atau lebih baik lagi, eksplisit dengan value object:

```java
public final class RiskAssessmentDocument {
    private String level;
    private Integer score;
    private Instant assessedAt;
}
```

### 10.2 Null vs Missing Policy

Buat policy.

Contoh:

| Situasi | Representasi Disarankan |
|---|---|
| Field belum pernah ada di schema lama | missing |
| Field opsional dan tidak diketahui | missing atau null, pilih satu |
| Field sengaja dikosongkan user | null bisa bermakna |
| Field punya default business value | simpan value eksplisit |
| Field derived | jangan simpan kecuali untuk query/performance |

Untuk sistem besar, “terserah mapper” bukan policy.

### 10.3 Default Value Harus Version-Aware

Misal schema v1 tidak punya `priority`.

Document lama:

```json
{
  "_id": "case-1",
  "status": "OPEN",
  "schemaVersion": 1
}
```

Schema baru:

```json
{
  "_id": "case-2",
  "status": "OPEN",
  "priority": "NORMAL",
  "schemaVersion": 2
}
```

Reader harus tahu:

```java
String priority = bson.getString("priority");
if (priority == null && schemaVersion == 1) {
    priority = "NORMAL";
}
```

Tapi hati-hati:

Default teknis bukan selalu default bisnis. Kadang `UNKNOWN` lebih jujur daripada `NORMAL`.

---

## 11. Enum Strategy

Java enum sederhana:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED
}
```

Penyimpanan umum:

```json
{ "status": "UNDER_REVIEW" }
```

Kelebihan string enum:

- readable;
- query-friendly;
- stable jika nama dijaga;
- mudah debug.

Kelemahan:

- rename enum berbahaya;
- typo di data lama mungkin terjadi;
- butuh converter/validator.

Jangan simpan ordinal:

```json
{ "status": 3 }
```

Ini berbahaya karena urutan enum bisa berubah.

### 11.1 Stable Code Lebih Baik dari Enum Name untuk Domain Serius

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    ESCALATED("ESCALATED"),
    CLOSED("CLOSED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Kalau suatu saat Java enum name ingin diubah, persisted code tetap bisa stabil.

### 11.2 Unknown Enum Handling

Dalam distributed systems, aplikasi versi lama bisa membaca value baru.

Misal database punya:

```json
{ "status": "PENDING_EXTERNAL_REVIEW" }
```

Aplikasi lama hanya tahu:

```java
DRAFT, SUBMITTED, UNDER_REVIEW, ESCALATED, CLOSED
```

Pilihan:

1. fail fast;
2. map ke `UNKNOWN`;
3. backward compatibility deployment order;
4. feature flag.

Untuk domain-critical command handling, fail fast sering lebih aman.

Untuk read-only display, `UNKNOWN` mungkin lebih baik.

---

## 12. Date and Time Mapping

Java date/time sering menjadi sumber bug.

MongoDB BSON Date menyimpan datetime sebagai UTC instant. Java punya banyak tipe:

- `Instant`
- `LocalDate`
- `LocalDateTime`
- `OffsetDateTime`
- `ZonedDateTime`
- legacy `Date`

### 12.1 Gunakan `Instant` Untuk Timestamp

Untuk event waktu absolut:

```java
private Instant createdAt;
private Instant updatedAt;
private Instant submittedAt;
```

Cocok untuk:

- created/updated timestamp;
- audit event time;
- state transition time;
- expiry time;
- deadline absolute.

### 12.2 Gunakan `LocalDate` Untuk Tanggal Kalender

Contoh:

```java
private LocalDate effectiveDate;
private LocalDate birthDate;
```

Tanggal kalender bukan timestamp.

`2026-06-20` tidak sama dengan `2026-06-20T00:00:00Z` untuk semua timezone.

Jika menyimpan `LocalDate`, putuskan representasi:

```json
{ "effectiveDate": "2026-06-20" }
```

atau document:

```json
{ "effectiveDate": { "year": 2026, "month": 6, "day": 20 } }
```

String ISO date sering cukup dan jelas.

### 12.3 Hindari `LocalDateTime` Untuk Waktu Absolut

`LocalDateTime` tidak punya timezone/offset.

Buruk untuk timestamp global:

```java
private LocalDateTime submittedAt;
```

Pertanyaan yang muncul:

- timezone mana?
- server timezone?
- user timezone?
- business jurisdiction timezone?

Gunakan `Instant` untuk waktu absolut, lalu format ke timezone user di boundary API/UI.

### 12.4 Deadline dan SLA Perlu Lebih Kaya

SLA mungkin butuh:

```json
{
  "deadline": {
    "dueAt": "2026-06-25T17:00:00Z",
    "timezone": "Asia/Jakarta",
    "businessCalendar": "ID_REGULATORY_WORKDAYS",
    "ruleCode": "CASE_REVIEW_5D"
  }
}
```

Kenapa?

Karena deadline bukan hanya timestamp; ia berasal dari aturan.

Untuk regulatory systems, menyimpan `dueAt` saja sering tidak cukup untuk auditability.

---

## 13. Money, Decimal, and Numeric Precision

Jangan pakai `double` untuk uang.

Buruk:

```java
private double penaltyAmount;
```

Lebih baik:

```java
private BigDecimal penaltyAmount;
private String currency;
```

Atau value object:

```java
public record MoneyDocument(
    BigDecimal amount,
    String currency
) {}
```

MongoDB BSON punya Decimal128. Java punya `BigDecimal`.

Representasi:

```json
{
  "penalty": {
    "amount": { "$numberDecimal": "12500000.50" },
    "currency": "IDR"
  }
}
```

Rule:

- uang pakai decimal;
- currency selalu eksplisit;
- rounding rule jangan tersembunyi;
- jangan campur unit minor/major tanpa field jelas;
- gunakan integer minor unit bila domain memilih itu secara konsisten.

Alternatif integer minor unit:

```json
{
  "penalty": {
    "amountMinor": 1250000050,
    "currency": "IDR",
    "scale": 2
  }
}
```

Pilih satu strategi organisasi.

---

## 14. UUID and Identifier Mapping

Java sering memakai `UUID`.

```java
private UUID id;
```

MongoDB bisa menyimpan UUID sebagai binary subtype atau string.

String:

```json
{ "_id": "018f3f52-..." }
```

Binary:

```json
{ "_id": { "$binary": "..." } }
```

String UUID:

- readable;
- mudah debug;
- lebih besar storage;
- mudah dipakai API.

Binary UUID:

- lebih compact;
- butuh konfigurasi representation;
- debugging lebih tidak nyaman.

Untuk banyak aplikasi bisnis, string UUID sering acceptable.

Untuk high-scale, storage-sensitive, atau strict internal systems, binary bisa dipertimbangkan.

Yang penting:

> Jangan berganti representasi ID di tengah jalan tanpa migration plan.

---

## 15. Embedded Value Object Design

Contoh buruk:

```java
public class CaseDocument {
    private Customer customer;
}
```

Nama `Customer` ambigu:

- apakah ini canonical customer?
- apakah snapshot?
- apakah embedded summary?
- apakah reference?

Lebih baik:

```java
public record SubjectSnapshotDocument(
    String subjectId,
    String name,
    String type,
    String riskCategory
) {}
```

Atau:

```java
public record SubjectReferenceDocument(
    String subjectId,
    String displayName
) {}
```

Atau:

```java
public record SubjectEmbeddedDocument(
    String subjectId,
    String legalName,
    List<AddressDocument> addresses,
    RegistrationDocument registration
) {}
```

Nama class harus menjelaskan lifecycle.

| Nama | Makna |
|---|---|
| `SubjectSnapshotDocument` | salinan point-in-time |
| `SubjectReferenceDocument` | referensi + display field |
| `SubjectEmbeddedDocument` | child owned oleh parent |
| `SubjectDocument` | canonical subject document |

Penamaan bukan kosmetik. Penamaan memengaruhi keputusan update.

Jika `SubjectSnapshotDocument.name` berubah, apakah semua case lama ikut berubah?

Jika jawabannya “tidak”, itu snapshot.

Jika jawabannya “ya”, mungkin sebaiknya reference atau projection update dengan aturan khusus.

---

## 16. Collection Document vs Subdocument Classes

Pisahkan class untuk root document dan subdocument.

Root document:

```java
public final class CaseDocument {
    private String id;
    private String tenantId;
    private String status;
    private SubjectSnapshotDocument subject;
    private AssignmentDocument assignment;
}
```

Subdocument:

```java
public record AssignmentDocument(
    String teamId,
    String userId,
    Instant assignedAt
) {}
```

Subdocument biasanya tidak punya `_id` kecuali perlu.

Untuk embedded array item, kadang perlu item ID:

```java
public record NoteDocument(
    String noteId,
    String text,
    String authorId,
    Instant createdAt
) {}
```

Item ID berguna untuk:

- update element tertentu;
- audit reference;
- UI operation;
- idempotency.

Tetapi jangan menambahkan ID ke semua subdocument tanpa alasan.

---

## 17. Arrays in Java Model: Mutability and Growth Discipline

MongoDB array terlihat natural dengan Java `List`.

```java
private List<NoteDocument> notes;
```

Masalah:

- list bisa null;
- list bisa mutable;
- list bisa tumbuh tanpa batas;
- setter bisa replace seluruh list;
- update element bisa susah;
- concurrent append bisa contention.

### 17.1 Jangan Biarkan List Null Bila Secara Domain Kosong

Buruk:

```java
private List<String> tags;
```

Lalu semua code perlu:

```java
if (tags != null) { ... }
```

Lebih baik default empty list saat read:

```java
this.tags = tags == null ? List.of() : List.copyOf(tags);
```

### 17.2 Defensive Copy

```java
public final class CaseDocument {
    private final List<String> tags;

    public CaseDocument(List<String> tags) {
        this.tags = tags == null ? List.of() : List.copyOf(tags);
    }

    public List<String> tags() {
        return tags;
    }
}
```

### 17.3 Jangan Simpan Unbounded History di Parent Document

Buruk:

```json
{
  "_id": "case-123",
  "auditEvents": [
    { "eventId": "e1", "type": "CREATED" },
    { "eventId": "e2", "type": "UPDATED" }
    // grows forever
  ]
}
```

Lebih baik:

```json
// cases
{
  "_id": "case-123",
  "status": "UNDER_REVIEW",
  "lastEventAt": "2026-06-20T10:00:00Z"
}
```

```json
// caseEvents
{
  "_id": "event-001",
  "caseId": "case-123",
  "type": "CREATED",
  "occurredAt": "2026-06-20T10:00:00Z"
}
```

Bounded arrays are fine. Unbounded arrays are usually a design smell.

---

## 18. Schema Versioning in Java

Schema evolves. Pretending otherwise creates production pain.

### 18.1 Add `schemaVersion`

```java
public final class CaseDocument {
    private final int schemaVersion;
}
```

Document:

```json
{
  "_id": "case-123",
  "schemaVersion": 2,
  "status": "UNDER_REVIEW"
}
```

### 18.2 Versioned Reader

```java
public CaseDocument read(Document raw) {
    int version = raw.getInteger("schemaVersion", 1);
    return switch (version) {
        case 1 -> readV1(raw);
        case 2 -> readV2(raw);
        default -> throw new UnsupportedOperationException("Unknown schema version " + version);
    };
}
```

### 18.3 Write Latest Version

```java
public Document write(CaseDocument doc) {
    return new Document("_id", doc.id())
        .append("schemaVersion", 2)
        .append("status", doc.status())
        .append("risk", new Document("level", doc.riskLevel()));
}
```

Rule:

> Readers may need to understand old versions. Writers should usually write the latest version.

### 18.4 Lazy Upgrade Pattern

Saat membaca old document:

1. read v1;
2. convert to current domain/persistence object;
3. when saving, write v2.

Cocok jika:

- old documents masih sering disentuh;
- migration besar tidak mendesak;
- old shape masih mudah dibaca.

Tidak cocok jika:

- query/index butuh field baru untuk semua documents;
- aggregation harus konsisten;
- old schema terlalu banyak variasi;
- compliance butuh explicit migration audit.

---

## 19. Backward-Compatible Readers and Forward-Compatible Writers

Dalam deployment rolling, versi aplikasi lama dan baru bisa hidup bersamaan.

Misal versi baru menambahkan field:

```json
{
  "priority": "HIGH"
}
```

Aplikasi lama harus:

- mengabaikan field unknown saat read;
- tidak menghapus field unknown saat update;
- tidak melakukan replace full document dari object lama.

### 19.1 Bahaya Replace Full Document

Aplikasi lama membaca:

```json
{
  "_id": "case-123",
  "status": "OPEN",
  "priority": "HIGH"
}
```

Tapi class lama tidak punya `priority`.

Saat save pakai replace:

```json
{
  "_id": "case-123",
  "status": "UNDER_REVIEW"
}
```

Field `priority` hilang.

Ini bug backward compatibility.

Lebih aman untuk update parsial:

```javascript
db.cases.updateOne(
  { _id: "case-123", version: 3 },
  {
    $set: {
      status: "UNDER_REVIEW",
      updatedAt: ISODate(...)
    },
    $inc: { version: 1 }
  }
)
```

Rule penting:

> Dalam sistem dengan rolling deployment, partial update lebih aman daripada full replace untuk dokumen yang bisa berevolusi.

### 19.2 Unknown Field Preservation

Jika memang harus replace, pertimbangkan:

- raw document merge;
- version gate;
- migration lockstep;
- forbidding old app writes after new schema rollout.

---

## 20. Validation: Java Validation vs MongoDB Schema Validation

Ada beberapa lapisan validasi.

### 20.1 API Validation

Contoh:

```java
public record CreateCaseRequest(
    @NotBlank String subjectId,
    @NotBlank String allegationType,
    @Size(max = 4000) String description
) {}
```

Tujuan:

- validasi input client;
- response error jelas;
- menjaga API contract.

### 20.2 Domain Validation

```java
public EnforcementCase submit(UserId actor) {
    if (status != CaseStatus.DRAFT) {
        throw new InvalidTransitionException(status, CaseStatus.SUBMITTED);
    }
    return withStatus(CaseStatus.SUBMITTED);
}
```

Tujuan:

- menjaga invariant bisnis;
- tidak bergantung pada API;
- tidak bergantung pada database.

### 20.3 Persistence Validation

MongoDB bisa memakai schema validation pada collection.

Tujuan:

- guardrail terhadap bad writes;
- melindungi database dari aplikasi salah;
- membantu enforcement tipe/required fields.

Contoh konseptual:

```javascript
db.createCollection("cases", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["tenantId", "status", "createdAt", "schemaVersion"],
      properties: {
        tenantId: { bsonType: "string" },
        status: { enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ESCALATED", "CLOSED"] },
        schemaVersion: { bsonType: "int" }
      }
    }
  }
})
```

Jangan mengandalkan hanya satu lapisan.

| Validasi | Menjawab |
|---|---|
| API validation | apakah request valid? |
| Domain validation | apakah operasi bisnis valid? |
| Persistence validation | apakah document shape aman disimpan? |

---

## 21. Mapping Domain to Document

Contoh domain:

```java
public final class EnforcementCase {
    private final CaseId id;
    private final TenantId tenantId;
    private final CaseNumber caseNumber;
    private final CaseStatus status;
    private final SubjectSnapshot subject;
    private final Version version;

    public EnforcementCase escalate() {
        if (!status.canEscalate()) {
            throw new InvalidTransitionException(status, CaseStatus.ESCALATED);
        }
        return new EnforcementCase(id, tenantId, caseNumber, CaseStatus.ESCALATED, subject, version.next());
    }
}
```

Persistence:

```java
public record CaseDocument(
    String id,
    String tenantId,
    String caseNumber,
    String status,
    SubjectSnapshotDocument subject,
    long version,
    int schemaVersion,
    Instant createdAt,
    Instant updatedAt
) {}
```

Mapper:

```java
public final class CaseMapper {
    public CaseDocument toDocument(EnforcementCase domain, Instant now) {
        return new CaseDocument(
            domain.id().value(),
            domain.tenantId().value(),
            domain.caseNumber().value(),
            domain.status().code(),
            toDocument(domain.subject()),
            domain.version().value(),
            1,
            domain.createdAt(),
            now
        );
    }

    public EnforcementCase toDomain(CaseDocument doc) {
        return new EnforcementCase(
            new CaseId(doc.id()),
            new TenantId(doc.tenantId()),
            new CaseNumber(doc.caseNumber()),
            CaseStatus.fromCode(doc.status()),
            toDomain(doc.subject()),
            new Version(doc.version())
        );
    }
}
```

Pertanyaan penting:

- Apakah semua persistence field masuk domain?
- Apakah semua domain field disimpan?
- Apakah ada field derived?
- Apakah ada field audit yang tidak boleh dimodifikasi domain biasa?

Tidak semua mapping harus 1:1.

---

## 22. Mapping API to Command, Not API to Document

Buruk:

```java
@PostMapping("/cases")
public CaseDocument create(@RequestBody CaseDocument request) {
    return repository.save(request);
}
```

Masalah:

- client bisa mengirim `version`;
- client bisa mengirim `schemaVersion`;
- client bisa mengirim `createdAt` palsu;
- client bisa mengatur `status` ilegal;
- database shape bocor ke API.

Lebih baik:

```java
public record CreateCaseRequest(
    String subjectId,
    String allegationType,
    String description
) {}
```

Command:

```java
public record CreateCaseCommand(
    TenantId tenantId,
    UserId actorId,
    SubjectId subjectId,
    AllegationType allegationType,
    String description
) {}
```

Controller:

```java
@PostMapping("/cases")
public CaseResponse create(@RequestBody @Valid CreateCaseRequest request) {
    CreateCaseCommand command = new CreateCaseCommand(
        currentTenantId(),
        currentUserId(),
        new SubjectId(request.subjectId()),
        AllegationType.fromCode(request.allegationType()),
        request.description()
    );

    EnforcementCase created = service.create(command);
    return responseMapper.toResponse(created);
}
```

Rule:

> API request should become command. Command changes domain. Domain maps to document. Document persists. Response maps from domain/projection.

Ini lebih panjang, tapi boundary-nya jelas.

---

## 23. Repository Design: Jangan Bocorkan MongoDB Terlalu Dalam ke Domain

Buruk:

```java
public interface CaseRepository {
    MongoCollection<Document> collection();
}
```

Domain/application layer jadi tahu MongoDB.

Lebih baik:

```java
public interface CaseRepository {
    Optional<EnforcementCase> findById(TenantId tenantId, CaseId caseId);
    SaveResult save(EnforcementCase enforcementCase, Version expectedVersion);
}
```

Implementation:

```java
public final class MongoCaseRepository implements CaseRepository {
    private final MongoCollection<CaseDocument> collection;
    private final CaseMapper mapper;

    @Override
    public Optional<EnforcementCase> findById(TenantId tenantId, CaseId caseId) {
        CaseDocument doc = collection.find(
            and(eq("_id", caseId.value()), eq("tenantId", tenantId.value()))
        ).first();

        return Optional.ofNullable(doc).map(mapper::toDomain);
    }

    @Override
    public SaveResult save(EnforcementCase caseAggregate, Version expectedVersion) {
        CaseDocument doc = mapper.toDocument(caseAggregate, Instant.now());

        UpdateResult result = collection.updateOne(
            and(
                eq("_id", doc.id()),
                eq("tenantId", doc.tenantId()),
                eq("version", expectedVersion.value())
            ),
            combine(
                set("status", doc.status()),
                set("updatedAt", doc.updatedAt()),
                inc("version", 1)
            )
        );

        if (result.getMatchedCount() == 0) {
            return SaveResult.conflict();
        }
        return SaveResult.saved();
    }
}
```

Catatan:

- repository interface domain-friendly;
- implementation Mongo-specific;
- query filter selalu menyertakan `tenantId`;
- optimistic concurrency di repository;
- domain tidak tahu `$set`, `eq`, collection name.

---

## 24. Partial Update vs Save Whole Aggregate

Dalam JPA, pattern umum:

1. load entity;
2. mutate entity;
3. save;
4. ORM flush changes.

Di MongoDB, pattern ini perlu hati-hati.

### 24.1 Full Save / Replace

```java
repository.replace(caseDocument);
```

Kelebihan:

- sederhana;
- cocok jika dokumen kecil dan owned penuh;
- mudah reason untuk full aggregate replacement.

Kekurangan:

- bisa menghapus unknown fields;
- lebih besar payload;
- rentan concurrent overwrite;
- buruk untuk rolling schema evolution.

### 24.2 Partial Update

```javascript
{
  "$set": {
    "status": "ESCALATED",
    "workflow.enteredAt": ISODate(...),
    "updatedAt": ISODate(...)
  },
  "$inc": {
    "version": 1
  }
}
```

Kelebihan:

- preserving unknown fields;
- lebih hemat;
- cocok untuk state transition;
- cocok untuk high-concurrency fields.

Kekurangan:

- update logic tersebar jika tidak didesain;
- bisa melewati domain invariant jika dipakai sembarangan;
- mapping domain-to-update lebih kompleks.

### 24.3 Command-Specific Update

Untuk sistem serius, sering lebih baik membuat update per command.

Contoh:

```java
public SaveResult escalate(CaseId caseId, Version expectedVersion, Escalation escalation) {
    Update update = combine(
        set("status", "ESCALATED"),
        set("escalation.reason", escalation.reason()),
        set("escalation.escalatedBy", escalation.actorId()),
        set("escalation.escalatedAt", escalation.at()),
        set("updatedAt", escalation.at()),
        inc("version", 1)
    );

    UpdateResult result = collection.updateOne(
        and(
            eq("_id", caseId.value()),
            eq("status", "UNDER_REVIEW"),
            eq("version", expectedVersion.value())
        ),
        update
    );

    return result.getMatchedCount() == 1 ? SaveResult.saved() : SaveResult.conflict();
}
```

Ini mengikat:

- transition guard;
- expected version;
- atomic state update;
- audit metadata.

---

## 25. Avoiding Anemic Document Models

Anemic model adalah model yang hanya berisi data tanpa perilaku.

Untuk persistence document, itu tidak selalu salah.

Untuk domain model, itu sering masalah.

Buruk:

```java
public class CaseService {
    public void escalate(String caseId) {
        CaseDocument doc = repo.find(caseId);
        if (!doc.getStatus().equals("UNDER_REVIEW")) {
            throw new IllegalStateException();
        }
        doc.setStatus("ESCALATED");
        repo.save(doc);
    }
}
```

Lebih baik:

```java
public final class EnforcementCase {
    public EnforcementCase escalate(UserId actor, Reason reason, Instant now) {
        if (status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidTransitionException(status, CaseStatus.ESCALATED);
        }
        return withEscalation(actor, reason, now);
    }
}
```

Service:

```java
public void escalate(EscalateCaseCommand command) {
    EnforcementCase current = repo.findById(command.tenantId(), command.caseId())
        .orElseThrow(CaseNotFoundException::new);

    EnforcementCase escalated = current.escalate(command.actorId(), command.reason(), clock.instant());

    SaveResult result = repo.save(escalated, current.version());
    if (result.isConflict()) {
        throw new ConcurrentModificationException();
    }
}
```

Domain memegang rule.

Repository memegang persistence mechanics.

MongoDB query/update memegang atomic guard.

Ketiganya saling memperkuat.

---

## 26. Persistence Model Should Make Illegal States Harder

Contoh buruk:

```json
{
  "status": "CLOSED",
  "closedAt": null,
  "closedBy": null,
  "closureReason": null
}
```

Lebih baik:

```json
{
  "status": "CLOSED",
  "closure": {
    "closedAt": "2026-06-20T12:00:00Z",
    "closedBy": "user-123",
    "reason": "NO_VIOLATION_FOUND"
  }
}
```

Atau untuk open case:

```json
{
  "status": "UNDER_REVIEW"
}
```

Daripada menyimpan `closure` dengan null fields.

Java model:

```java
public sealed interface CaseLifecycleDocument
    permits OpenLifecycleDocument, ClosedLifecycleDocument {
}

public record OpenLifecycleDocument(
    String status,
    Instant enteredAt
) implements CaseLifecycleDocument {}

public record ClosedLifecycleDocument(
    Instant closedAt,
    String closedBy,
    String reason
) implements CaseLifecycleDocument {}
```

MongoDB polymorphic mapping perlu konfigurasi, tetapi konsepnya penting:

> Shape dokumen sebaiknya membantu mencegah kombinasi field yang tidak valid.

---

## 27. Sensitive Fields and `toString()` Danger

Dalam sistem regulasi, data sensitif bisa muncul di:

- notes;
- allegations;
- evidence metadata;
- identity documents;
- investigation comments;
- internal recommendation;
- financial information.

Jangan biarkan Lombok `@ToString` mencetak semuanya.

Buruk:

```java
@Data
public class CaseDocument {
    private String id;
    private String internalNote;
    private String identityNumber;
}
```

Log bisa berisi:

```text
CaseDocument(id=case-1, internalNote=..., identityNumber=...)
```

Lebih aman:

```java
@ToString(exclude = {"internalNote", "identityNumber"})
public class CaseDocument {
    private String id;
    private String internalNote;
    private String identityNumber;
}
```

Atau manual:

```java
@Override
public String toString() {
    return "CaseDocument{id='" + id + "', status='" + status + "'}";
}
```

Rule:

> Treat persistence objects as potentially sensitive. Do not auto-log full documents.

---

## 28. Index-Aware Field Design

Field design harus mempertimbangkan index.

Contoh:

```json
{
  "tenantId": "tenant-1",
  "status": "UNDER_REVIEW",
  "assignment": {
    "teamId": "team-risk",
    "userId": "user-123"
  },
  "updatedAt": "2026-06-20T10:00:00Z"
}
```

Query:

```javascript
db.cases.find({
  tenantId: "tenant-1",
  status: "UNDER_REVIEW",
  "assignment.teamId": "team-risk"
}).sort({ updatedAt: -1 })
```

Index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  "assignment.teamId": 1,
  updatedAt: -1
})
```

Field naming dan nesting memengaruhi index.

Jika field query sering dipakai, jangan menyembunyikannya dalam struktur dinamis seperti:

```json
{
  "attributes": [
    { "key": "status", "value": "UNDER_REVIEW" },
    { "key": "teamId", "value": "team-risk" }
  ]
}
```

Attribute pattern ada tempatnya, tetapi bukan untuk core query fields yang stabil dan high-volume.

Rule:

> Stable high-selectivity query fields deserve explicit fields.

---

## 29. Dynamic Attributes: Powerful but Dangerous

MongoDB fleksibel, jadi mudah membuat:

```json
{
  "attributes": {
    "riskScore": 87,
    "sourceSystem": "EXT_A",
    "flagA": true,
    "customField77": "abc"
  }
}
```

Cocok untuk:

- extensible metadata;
- tenant-specific optional fields;
- low-criticality attributes;
- rare filters;
- display-only fields.

Berbahaya untuk:

- core workflow state;
- authorization;
- high-volume query;
- required business invariant;
- indexed operational search;
- compliance-critical fields.

Jika dynamic attributes perlu query, desain index dan governance sejak awal.

Jangan memberi semua tenant kebebasan membuat filter arbitrer lalu berharap index menyelesaikan semuanya.

---

## 30. Schema Contract Documentation

Setiap collection penting harus punya schema contract.

Minimal dokumentasikan:

```markdown
# cases collection

## Purpose
Stores current operational case state for enforcement lifecycle.

## Ownership
Owned by Case Management service.

## Root identity
- _id: internal case id
- tenantId: tenant isolation key
- caseNumber: human-readable business identifier

## Lifecycle
Created when case is submitted. Updated through command handlers only.

## Important fields
- status: workflow state
- assignment.teamId: current owning team
- subject: point-in-time subject snapshot
- version: optimistic concurrency
- schemaVersion: document schema evolution

## Bounded arrays
- tags: bounded, max 30

## Unbounded data stored elsewhere
- audit events: caseEvents collection
- documents: caseDocuments collection
- comments: caseComments collection

## Indexes
- { tenantId: 1, caseNumber: 1 } unique
- { tenantId: 1, status: 1, updatedAt: -1 }
- { tenantId: 1, "assignment.teamId": 1, status: 1, updatedAt: -1 }

## Compatibility
Readers support schemaVersion 1 and 2. Writers write version 2.
```

Ini bukan birokrasi. Ini alat koordinasi antar developer.

---

## 31. Example: Full Case Document Design

Contoh document:

```json
{
  "_id": "case-018f3f52",
  "tenantId": "tenant-id",
  "caseNumber": "CASE-2026-000123",
  "schemaVersion": 2,
  "version": 8,
  "status": "UNDER_REVIEW",
  "workflow": {
    "state": "UNDER_REVIEW",
    "phase": "INVESTIGATION",
    "enteredAt": "2026-06-20T09:15:00Z"
  },
  "subject": {
    "subjectId": "subj-7788",
    "type": "LEGAL_ENTITY",
    "displayName": "PT Contoh Abadi",
    "riskCategory": "HIGH"
  },
  "assignment": {
    "teamId": "team-investigation",
    "userId": "user-123",
    "assignedAt": "2026-06-20T09:20:00Z"
  },
  "risk": {
    "level": "HIGH",
    "score": 87,
    "assessedAt": "2026-06-20T09:10:00Z"
  },
  "tags": ["priority", "external-referral"],
  "createdAt": "2026-06-20T09:00:00Z",
  "createdBy": "user-001",
  "updatedAt": "2026-06-20T09:20:00Z",
  "updatedBy": "user-123"
}
```

Java persistence model:

```java
public record CaseDocument(
    String id,
    String tenantId,
    String caseNumber,
    int schemaVersion,
    long version,
    String status,
    WorkflowDocument workflow,
    SubjectSnapshotDocument subject,
    AssignmentDocument assignment,
    RiskDocument risk,
    List<String> tags,
    Instant createdAt,
    String createdBy,
    Instant updatedAt,
    String updatedBy
) {
    public CaseDocument {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(caseNumber, "caseNumber");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(updatedAt, "updatedAt");
        tags = tags == null ? List.of() : List.copyOf(tags);
    }
}
```

Subdocuments:

```java
public record WorkflowDocument(
    String state,
    String phase,
    Instant enteredAt
) {}

public record SubjectSnapshotDocument(
    String subjectId,
    String type,
    String displayName,
    String riskCategory
) {}

public record AssignmentDocument(
    String teamId,
    String userId,
    Instant assignedAt
) {}

public record RiskDocument(
    String level,
    Integer score,
    Instant assessedAt
) {}
```

Catatan desain:

- `subject` adalah snapshot, bukan canonical subject;
- audit trail tidak disimpan dalam array unbounded;
- `tags` bounded;
- `version` untuk concurrency;
- `schemaVersion` untuk evolution;
- `workflow` menyimpan state detail;
- `status` bisa denormalized dari `workflow.state` untuk query sederhana, tetapi harus dijaga konsistensinya.

Jika ingin menghindari duplikasi `status` dan `workflow.state`, pilih salah satu. Jika menyimpan keduanya, update harus atomic dan validated.

---

## 32. Example: API DTOs for the Same Case

Request:

```java
public record CreateCaseRequest(
    String subjectId,
    String allegationType,
    String description
) {}
```

Response detail:

```java
public record CaseDetailResponse(
    String id,
    String caseNumber,
    String status,
    String phase,
    SubjectResponse subject,
    AssignmentResponse assignment,
    RiskResponse risk,
    Instant createdAt,
    Instant updatedAt
) {}
```

List response:

```java
public record CaseListResponse(
    List<CaseListItemResponse> items,
    String nextCursor
) {}

public record CaseListItemResponse(
    String id,
    String caseNumber,
    String status,
    String subjectName,
    String assignedTeamId,
    Instant updatedAt
) {}
```

Notice:

- request tidak punya `status`;
- response tidak expose `schemaVersion`;
- list response tidak membawa full subject;
- persistence field tidak bocor ke API;
- API field bisa berbeda dari storage field.

---

## 33. Example: Projection DTO From Query

MongoDB projection:

```javascript
db.cases.find(
  {
    tenantId: "tenant-id",
    status: "UNDER_REVIEW"
  },
  {
    caseNumber: 1,
    status: 1,
    "subject.displayName": 1,
    "assignment.teamId": 1,
    updatedAt: 1
  }
).sort({ updatedAt: -1 }).limit(50)
```

Java projection:

```java
public record CaseSearchProjection(
    String id,
    String caseNumber,
    String status,
    String subjectDisplayName,
    String assignedTeamId,
    Instant updatedAt
) {}
```

Jangan memuat full `CaseDocument` jika screen hanya butuh list row.

Keuntungan:

- payload lebih kecil;
- memory lebih kecil;
- mapping lebih cepat;
- query bisa covered sebagian;
- API response lebih jelas.

---

## 34. Handling Large Documents in Java

Jika document besar, hindari pattern:

```java
CaseDocument doc = repository.findById(id);
return mapper.toListItem(doc);
```

Untuk list page, ini boros.

Lebih baik:

```java
List<CaseSearchProjection> rows = repository.searchCases(criteria);
return rows.stream().map(apiMapper::toResponse).toList();
```

Rule:

> Query method should return the smallest model that satisfies the use case.

Repository boleh punya beberapa method:

```java
Optional<EnforcementCase> findAggregateById(...);
Optional<CaseDetailProjection> findDetailById(...);
List<CaseSearchProjection> search(...);
boolean existsByCaseNumber(...);
```

Satu method `findById` untuk semua kebutuhan sering membuat sistem lambat.

---

## 35. Equality and Identity in Java Models

Entity identity berbeda dari value equality.

### 35.1 Value Object

```java
public record CaseId(String value) {}
public record TenantId(String value) {}
```

Record equality cocok karena value object sama jika value sama.

### 35.2 Entity / Aggregate

Untuk aggregate, equality bisa tricky.

Jika memakai Lombok `@Data`, semua field masuk equality.

Masalah:

- setelah status berubah, equality berubah;
- jika object masuk set/map, perilaku kacau;
- large embedded fields ikut comparison.

Untuk entity, identity-based equality sering lebih tepat.

```java
public final class EnforcementCase {
    private final CaseId id;

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof EnforcementCase that)) return false;
        return Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Tetapi untuk immutable aggregate snapshot, kadang full structural equality berguna untuk tests.

Pilih dengan sadar.

---

## 36. Error Mapping: Database Errors Are Not Domain Errors

MongoDB duplicate key error tidak boleh bocor mentah ke API.

Contoh:

```java
try {
    collection.insertOne(doc);
} catch (MongoWriteException e) {
    if (isDuplicateKey(e)) {
        throw new CaseNumberAlreadyExistsException(doc.caseNumber());
    }
    throw e;
}
```

Mapping error umum:

| MongoDB/Persistence Error | Application Error |
|---|---|
| duplicate key | business identifier conflict |
| matched count 0 with expected version | concurrent modification / stale version |
| timeout | dependency timeout |
| transient transaction error | retryable operation failed |
| validation error | persistence contract violation |
| unauthorized | infrastructure/security configuration error |

Domain layer tidak perlu tahu error code MongoDB.

---

## 37. Serialization Boundary: Jackson != BSON Mapper

Jackson biasanya untuk JSON API.

MongoDB mapper untuk BSON persistence.

Jangan menganggap annotation Jackson cukup untuk MongoDB atau sebaliknya.

Buruk:

```java
@JsonProperty("case_id")
@Field("caseId")
private String caseId;
```

Ini bisa valid, tetapi perlu alasan. Kalau class yang sama dipakai API dan persistence, annotation bisa bertabrakan.

Rekomendasi:

- API DTO pakai Jackson annotation jika perlu;
- persistence document pakai Mongo/Spring annotation jika perlu;
- domain model minim annotation;
- mapping antar layer eksplisit.

---

## 38. Package Structure Recommended

Contoh struktur:

```text
com.example.caseapp
  casecontext
    domain
      CaseId.java
      EnforcementCase.java
      CaseStatus.java
      SubjectSnapshot.java
      Version.java
    application
      CreateCaseCommand.java
      EscalateCaseCommand.java
      CaseService.java
      CaseRepository.java
    infrastructure
      mongo
        CaseDocument.java
        SubjectSnapshotDocument.java
        MongoCaseRepository.java
        CaseDocumentMapper.java
        CaseIndexes.java
    api
      CaseController.java
      CreateCaseRequest.java
      CaseDetailResponse.java
      CaseApiMapper.java
```

Atau hexagonal:

```text
casecontext
  domain
  application
  adapters
    in
      web
    out
      mongo
```

Tujuan:

- domain tidak bergantung MongoDB;
- API tidak bergantung document class;
- MongoDB implementation isolated;
- testing lebih jelas.

---

## 39. Practical Design Workflow

Saat membuat collection baru, jangan mulai dari Java class.

Ikuti workflow ini.

### Step 1 — Tulis use case

Contoh:

- create case;
- assign case;
- escalate case;
- search open cases by team;
- show case detail;
- close case;
- audit case history.

### Step 2 — Tulis access patterns

Contoh:

```text
AP-01: find case by tenantId + caseNumber
AP-02: list under-review cases by tenantId + teamId sorted by updatedAt desc
AP-03: load case aggregate by tenantId + caseId for command handling
AP-04: append audit event by caseId
AP-05: show case detail by tenantId + caseId
```

### Step 3 — Tentukan aggregate boundary

Contoh:

- `cases` stores current operational state;
- `caseEvents` stores append-only history;
- `caseDocuments` stores evidence metadata;
- `subjects` stores canonical subject profile.

### Step 4 — Rancang document shape

Berdasarkan lifecycle, ownership, query, growth.

### Step 5 — Rancang indexes

Berdasarkan access patterns.

### Step 6 — Rancang Java persistence model

Baru buat `CaseDocument`, subdocuments, mapper.

### Step 7 — Rancang domain model

Pastikan invariant ada di domain.

### Step 8 — Rancang API DTO/projection

Jangan expose persistence mentah.

### Step 9 — Rancang migration/evolution

Tambahkan `schemaVersion`, compatibility rules.

### Step 10 — Rancang tests

Test mapping, query, index, migration, concurrency.

---

## 40. Checklist: Java MongoDB Schema Design Review

Gunakan checklist ini sebelum collection baru masuk production.

### 40.1 Boundary Checklist

- [ ] Apakah document root jelas?
- [ ] Apakah embedded data benar-benar owned oleh parent?
- [ ] Apakah array bounded?
- [ ] Apakah data unbounded dipisah?
- [ ] Apakah snapshot vs reference jelas dari nama field/class?

### 40.2 Java Model Checklist

- [ ] Domain model tidak dipaksa sama dengan persistence model?
- [ ] API DTO tidak langsung disimpan?
- [ ] Query projection tidak memuat full document bila tidak perlu?
- [ ] Mutable setters tidak terbuka sembarangan?
- [ ] Lombok tidak menghasilkan equality/toString berbahaya?
- [ ] Sensitive fields tidak otomatis ter-log?

### 40.3 Type Checklist

- [ ] Timestamp memakai `Instant`?
- [ ] Calendar date tidak dipaksa jadi timestamp?
- [ ] Money tidak memakai `double`?
- [ ] Enum tidak disimpan sebagai ordinal?
- [ ] UUID representation konsisten?
- [ ] Null/missing/default policy jelas?

### 40.4 Evolution Checklist

- [ ] Ada `schemaVersion` untuk collection penting?
- [ ] Reader bisa membaca old schema?
- [ ] Writer menulis latest schema?
- [ ] Replace full document tidak menghapus unknown fields?
- [ ] Migration/backfill path tersedia?

### 40.5 Index and Query Checklist

- [ ] Field query stabil dibuat eksplisit?
- [ ] Dynamic attributes tidak dipakai untuk core operational filters?
- [ ] Projection DTO tersedia untuk list/search?
- [ ] Sort field sesuai index?
- [ ] Tenant filter selalu ada untuk multi-tenant collection?

### 40.6 Invariant Checklist

- [ ] Illegal state sulit direpresentasikan?
- [ ] State transition dijaga domain dan atomic update?
- [ ] Optimistic concurrency memakai `version`?
- [ ] Duplicate command/idempotency dipikirkan?
- [ ] Persistence validation menjadi guardrail tambahan?

---

## 41. Common Anti-Patterns

### Anti-Pattern 1 — API DTO Persisted Directly

Gejala:

```java
repository.save(requestDto);
```

Dampak:

- client bisa memengaruhi internal field;
- schema storage berubah mengikuti API;
- backward compatibility kacau.

Solusi:

- request -> command -> domain -> document.

### Anti-Pattern 2 — JPA Entity Mindset

Gejala:

```java
@Document
public class Case {
    private Customer customer;
    private List<Task> tasks;
    private List<Comment> comments;
    private List<AuditEvent> auditEvents;
}
```

Dampak:

- document membesar;
- lifecycle campur;
- query/index sulit;
- update contention.

Solusi:

- model berdasarkan aggregate boundary dan growth.

### Anti-Pattern 3 — `@Data` Everywhere

Gejala:

```java
@Data
public class EverythingDocument { ... }
```

Dampak:

- setter terbuka;
- equality berubah;
- sensitive toString;
- invariant lemah.

Solusi:

- gunakan annotation spesifik;
- prefer immutable/read-only untuk model penting.

### Anti-Pattern 4 — No Schema Version

Gejala:

- semua field dianggap current;
- old document gagal dibaca;
- migration ad-hoc.

Solusi:

- tambahkan `schemaVersion`;
- version-aware reader;
- migration strategy.

### Anti-Pattern 5 — Full Replace During Rolling Deploy

Gejala:

- app lama membaca document baru;
- app lama save ulang;
- field baru hilang.

Solusi:

- partial updates;
- unknown field preservation;
- deployment sequencing.

### Anti-Pattern 6 — Dynamic Attributes for Everything

Gejala:

```json
{
  "attributes": {
    "status": "OPEN",
    "team": "A",
    "priority": "HIGH"
  }
}
```

Dampak:

- index governance buruk;
- query tidak stabil;
- invariant tidak jelas.

Solusi:

- explicit fields for core query/invariant;
- dynamic only for true metadata.

---

## 42. Mini Case Study: Designing Case Assignment Schema

Requirement:

- case bisa assigned ke team;
- optional assigned user;
- assignment history harus tersimpan;
- list case by team harus cepat;
- current assignment sering ditampilkan di case list;
- history bisa panjang.

### 42.1 Bad Design

```json
{
  "_id": "case-1",
  "assignments": [
    { "teamId": "A", "userId": "u1", "assignedAt": "..." },
    { "teamId": "B", "userId": "u2", "assignedAt": "..." }
  ]
}
```

Masalah:

- array grows;
- current assignment harus dicari dari last item;
- query by current team sulit/mahal;
- indexing array bisa misleading.

### 42.2 Better Design

`cases`:

```json
{
  "_id": "case-1",
  "tenantId": "tenant-1",
  "status": "UNDER_REVIEW",
  "assignment": {
    "teamId": "B",
    "userId": "u2",
    "assignedAt": "2026-06-20T10:00:00Z"
  },
  "version": 4
}
```

`caseAssignmentEvents`:

```json
{
  "_id": "assign-event-99",
  "tenantId": "tenant-1",
  "caseId": "case-1",
  "fromTeamId": "A",
  "toTeamId": "B",
  "assignedBy": "supervisor-1",
  "assignedAt": "2026-06-20T10:00:00Z",
  "reason": "ESCALATION"
}
```

Index:

```javascript
db.cases.createIndex({
  tenantId: 1,
  "assignment.teamId": 1,
  status: 1,
  updatedAt: -1
})
```

Java:

```java
public record AssignmentDocument(
    String teamId,
    String userId,
    Instant assignedAt
) {}
```

Event document:

```java
public record CaseAssignmentEventDocument(
    String id,
    String tenantId,
    String caseId,
    String fromTeamId,
    String toTeamId,
    String assignedBy,
    Instant assignedAt,
    String reason
) {}
```

Insight:

- current state optimized for operational query;
- history stored append-only elsewhere;
- Java models reveal lifecycle distinction.

---

## 43. How This Part Connects to Later Parts

Part ini akan dipakai lagi saat membahas:

- aggregation pipeline;
- transactions;
- concurrency/state machine;
- Java driver;
- Spring Data MongoDB;
- performance;
- sharding;
- multi-tenancy;
- schema migration;
- testing;
- capstone regulatory case management platform.

Terutama, ide berikut akan terus muncul:

1. document shape is an architectural decision;
2. Java model is not automatically document shape;
3. API DTO must not become persistence contract;
4. schema evolution must be designed from day one;
5. partial update is often safer than full replace;
6. model names should reveal lifecycle and ownership;
7. invariants should exist in domain and be reinforced by atomic persistence operations.

---

## 44. Latihan Praktis

### Latihan 1 — Pisahkan Model

Ambil class berikut:

```java
public class CustomerCase {
    public String id;
    public String status;
    public String customerName;
    public String customerAddress;
    public List<String> notes;
    public List<String> auditLogs;
    public String createdBy;
    public String createdAt;
}
```

Pisahkan menjadi:

1. domain model;
2. persistence document;
3. create request DTO;
4. detail response DTO;
5. list projection DTO.

### Latihan 2 — Null/Missing Policy

Untuk field berikut, tentukan apakah harus required, nullable, missing, atau defaulted:

- `riskScore`
- `assignedUserId`
- `closedAt`
- `externalReference`
- `priority`
- `schemaVersion`
- `version`

Jelaskan alasannya.

### Latihan 3 — Schema Evolution

Schema v1:

```json
{
  "_id": "case-1",
  "status": "OPEN",
  "customerName": "Alice"
}
```

Schema v2:

```json
{
  "_id": "case-1",
  "status": "OPEN",
  "subject": {
    "displayName": "Alice",
    "type": "PERSON"
  },
  "schemaVersion": 2
}
```

Buat strategi reader yang bisa membaca v1 dan v2.

### Latihan 4 — Replace vs Partial Update

Jelaskan risiko full replace untuk document yang mengalami rolling deployment.

Buat contoh update partial untuk perubahan status.

### Latihan 5 — Sensitive Logging

Desain `toString()` aman untuk document yang punya:

- identity number;
- internal note;
- allegation description;
- status;
- case number.

---

## 45. Ringkasan

Part ini membangun jembatan antara MongoDB schema design dan Java application design.

Kesimpulan utama:

1. MongoDB document bukan otomatis Java object.
2. Domain model, persistence model, API DTO, dan query projection punya alasan berbeda untuk eksis.
3. Untuk sistem serius, pisahkan model agar boundary, invariant, security, dan evolution tetap sehat.
4. Java record cocok untuk DTO/projection dan kadang persistence, tetapi perlu strategi schema evolution.
5. Lombok berguna, tetapi `@Data` untuk entity/document penting sering berbahaya.
6. Null, missing, default value, enum, money, UUID, date/time harus punya policy eksplisit.
7. `schemaVersion` dan `version` berbeda: satu untuk evolution, satu untuk concurrency.
8. Partial update sering lebih aman daripada full replace, terutama saat rolling deployment.
9. Nama class/field harus menjelaskan lifecycle: snapshot, reference, embedded, canonical.
10. Document schema yang baik membuat illegal state lebih sulit, bukan lebih mudah.

Jika Part 008 dan 009 menjawab “bagaimana membentuk dokumen”, Part 010 menjawab “bagaimana membawanya ke Java dengan boundary yang sehat”.

---

## 46. Status Seri

Selesai:

- Part 000 — Orientation
- Part 001 — Document Database Mental Model
- Part 002 — BSON, JSON, Document Structure, and Type Semantics
- Part 003 — MongoDB Core Architecture
- Part 004 — CRUD Semantics
- Part 005 — Query Model
- Part 006 — Indexing Deep Dive I
- Part 007 — Indexing Deep Dive II
- Part 008 — Data Modelling I
- Part 009 — Data Modelling II
- Part 010 — Schema Design for Java Applications

Belum selesai. Berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-011.md
```

Judul berikutnya:

```text
Part 011 — Aggregation Pipeline I: Mental Model and Core Stages
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Data Modelling II: Patterns for Real Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-011.md">Part 011 — Aggregation Pipeline I: Mental Model and Core Stages ➡️</a>
</div>
