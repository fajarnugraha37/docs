# Part 020 — Advanced Mapping: Inheritance, Polymorphism, JSON, LOB, Custom Types

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 hingga Java 25  
> Fokus: Jakarta/Javax Persistence, Hibernate ORM, advanced relational mapping, database integration, production correctness

---

## 1. Tujuan Pembelajaran

Bagian ini membahas mapping tingkat lanjut yang sering muncul ketika model domain tidak lagi sederhana: inheritance, polymorphism, JSON column, LOB, custom type, immutable/read-only mapping, formula, soft-delete-aware mapping, encrypted/masked fields, dan field yang memiliki bentuk Java berbeda dari bentuk database.

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan kapan inheritance mapping layak dipakai dan kapan harus diganti dengan komposisi atau explicit type field.
2. Memilih strategi inheritance: `SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS`, atau `@MappedSuperclass` berdasarkan konsekuensi schema, query, index, constraint, dan performance.
3. Mendesain polymorphic association tanpa membuat query sulit dioptimalkan.
4. Memahami mapping JSON sebagai kompromi antara flexibility dan relational correctness.
5. Memahami risiko LOB/CLOB/BLOB pada memory, lazy loading, audit, export, batch, dan backup.
6. Memilih antara `AttributeConverter`, Hibernate custom type, `@JdbcTypeCode`, user type, database-specific type, atau native SQL.
7. Mendesain encrypted/masked field tanpa menghancurkan searchability, indexability, auditability, dan key rotation.
8. Menghindari advanced mapping yang “terlihat elegan di Java” tetapi mahal, rapuh, atau sulit dioperasikan di database.

Bagian ini bukan tutorial annotation satu per satu. Targetnya adalah mental model: **advanced mapping adalah trade-off antara expressiveness Java dan kebenaran/operability relational database**.

---

## 2. Mental Model: Advanced Mapping Adalah Kompresi Kompleksitas

Mapping dasar biasanya sederhana:

```java
@Entity
@Table(name = "application")
public class ApplicationEntity {
    @Id
    private Long id;

    @Column(name = "reference_no", nullable = false, unique = true)
    private String referenceNo;
}
```

Tetapi aplikasi enterprise cepat bertemu kebutuhan seperti:

- satu konsep domain punya beberapa subtype,
- satu field berisi struktur dinamis,
- dokumen/file harus disimpan atau direferensikan,
- audit metadata besar berbentuk JSON/CLOB,
- field harus terenkripsi,
- field di Java berupa value object tetapi di DB berupa beberapa column,
- field di DB berupa vendor-specific type seperti `jsonb`, `xml`, `inet`, `ltree`, array, spatial, atau UDT,
- entity bukan table murni tetapi view, formula, derived column, atau materialized representation.

Di titik ini, ORM bisa menjadi alat yang sangat kuat atau sumber kompleksitas tersembunyi.

Mental model penting:

```text
Java model wants: expressive type, inheritance, object references, encapsulation.
Database wants: tables, columns, keys, constraints, indexes, statistics, predictable SQL.
ORM mapping is the contract that translates both worlds.
Advanced mapping increases expressive power, but also increases hidden coupling.
```

Prinsip senior:

> Semakin advanced mapping yang digunakan, semakin penting memahami SQL yang dihasilkan, schema yang terbentuk, index yang dibutuhkan, dan failure mode operasionalnya.

---

## 3. Peta Advanced Mapping

Advanced mapping dapat dikelompokkan menjadi beberapa keluarga:

| Keluarga | Masalah yang Diselesaikan | Risiko Utama |
|---|---|---|
| Inheritance mapping | Class hierarchy ke table schema | Query kompleks, nullable explosion, join overhead, constraint lemah |
| Polymorphic association | Reference ke beberapa subtype | Index sulit, FK sulit, query unpredictable |
| JSON mapping | Struktur fleksibel/semi-structured | Constraint/search/index terbatas, schema drift |
| LOB mapping | Data besar: text/binary | Memory spike, lazy loading gagal, backup/export berat |
| Custom type | Java type tidak cocok dengan SQL type | Portability rendah, provider coupling |
| Formula/derived field | Field hasil ekspresi SQL | Read-only, portability rendah, stale assumption |
| Immutable/read-only mapping | View/reference table/snapshot | Update semantics terbatas |
| Encrypted field | Confidentiality at rest/application layer | Search/index/key rotation sulit |
| Soft delete/filter mapping | Hide logically deleted records | Query correctness dan unique constraint sulit |

---

## 4. Inheritance Mapping: Kenapa Sulit?

Java inheritance adalah konsep type hierarchy. Relational database tidak punya inheritance object model yang sama. Database punya table, row, column, key, constraint, dan index. Karena itu, setiap inheritance strategy adalah kompromi.

Contoh domain:

```text
Correspondence
├── EmailCorrespondence
├── LetterCorrespondence
└── SmsCorrespondence
```

Di Java, kita ingin:

```java
public abstract class Correspondence {
    private Long id;
    private String subject;
}

public class EmailCorrespondence extends Correspondence {
    private String emailAddress;
}

public class LetterCorrespondence extends Correspondence {
    private String mailingAddress;
}
```

Pertanyaan database-nya:

1. Apakah semua subtype disimpan di satu table?
2. Apakah base field ada di table parent dan subtype field ada di table child?
3. Apakah tiap concrete subtype punya table sendiri?
4. Apakah inheritance hanya untuk code reuse dan tidak perlu polymorphic query?

JPA/Jakarta Persistence menyediakan inheritance mapping standard melalui `@Inheritance`, dengan strategi utama:

- `SINGLE_TABLE`
- `JOINED`
- `TABLE_PER_CLASS`

Selain itu ada `@MappedSuperclass`, yang sering lebih tepat untuk code reuse tanpa polymorphic persistence.

---

## 5. `@MappedSuperclass`: Code Reuse, Bukan Polymorphic Entity

`@MappedSuperclass` digunakan ketika superclass hanya menyediakan field mapping umum untuk subclass, tetapi superclass itu sendiri bukan entity table dan tidak bisa di-query sebagai entity polymorphic root.

Contoh:

```java
@MappedSuperclass
public abstract class AuditableEntity {

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false, length = 100)
    private String createdBy;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "updated_by", length = 100)
    private String updatedBy;
}

@Entity
@Table(name = "application")
public class ApplicationEntity extends AuditableEntity {
    @Id
    private Long id;

    @Column(name = "reference_no", nullable = false)
    private String referenceNo;
}
```

Schema-nya tetap hanya punya table `application`, tetapi column audit ikut muncul di table tersebut.

Gunakan `@MappedSuperclass` ketika:

- tujuannya code reuse field umum,
- tidak perlu query ke superclass,
- tidak perlu association ke superclass,
- tidak perlu table parent,
- tidak perlu polymorphic loading.

Jangan gunakan `@MappedSuperclass` jika kamu butuh:

```java
List<Correspondence> findAllCorrespondences();
```

karena `Correspondence` sebagai mapped superclass bukan entity query root.

### Kelebihan

- Sederhana.
- Tidak ada discriminator.
- Tidak ada join inheritance.
- Cocok untuk base audit, base id, base tenant column.

### Kekurangan

- Tidak polymorphic.
- Field duplikat di banyak table.
- Perubahan superclass berdampak ke banyak schema table.

Prinsip:

> Jika inheritance hanya untuk menghindari duplikasi field, mulai dari `@MappedSuperclass`, bukan `@Inheritance`.

---

## 6. `SINGLE_TABLE`: Semua Subtype Dalam Satu Table

Strategi `SINGLE_TABLE` menyimpan seluruh hierarchy ke satu table. Tipe row dibedakan dengan discriminator column.

```java
@Entity
@Table(name = "correspondence")
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "correspondence_type", discriminatorType = DiscriminatorType.STRING)
public abstract class CorrespondenceEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "correspondence_seq")
    private Long id;

    @Column(name = "subject", nullable = false)
    private String subject;
}

@Entity
@DiscriminatorValue("EMAIL")
public class EmailCorrespondenceEntity extends CorrespondenceEntity {

    @Column(name = "email_address")
    private String emailAddress;
}

@Entity
@DiscriminatorValue("LETTER")
public class LetterCorrespondenceEntity extends CorrespondenceEntity {

    @Column(name = "mailing_address")
    private String mailingAddress;
}
```

Schema konseptual:

```sql
CREATE TABLE correspondence (
    id BIGINT PRIMARY KEY,
    correspondence_type VARCHAR(30) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    email_address VARCHAR(255),
    mailing_address VARCHAR(1000)
);
```

### Kelebihan `SINGLE_TABLE`

- Query polymorphic cepat karena satu table.
- Tidak perlu join untuk load subtype.
- Insert/update sederhana.
- Cocok jika subtype field tidak terlalu banyak.
- Cocok untuk read-heavy polymorphic listing.

Query:

```java
List<CorrespondenceEntity> list = entityManager
    .createQuery("select c from CorrespondenceEntity c", CorrespondenceEntity.class)
    .getResultList();
```

SQL biasanya cukup dari satu table.

### Kekurangan `SINGLE_TABLE`

Masalah utamanya adalah **nullable explosion**.

Jika subtype banyak, table akan punya banyak column yang hanya relevan untuk sebagian row:

```text
EMAIL row: letter_address null, sms_number null, document_path null
LETTER row: email_address null, sms_number null, bounce_reason null
SMS row: email_address null, mailing_address null, attachment_id null
```

Constraint juga sulit. Misalnya:

- `email_address` harus `NOT NULL` hanya untuk `EMAIL`.
- `mailing_address` harus `NOT NULL` hanya untuk `LETTER`.

Database `NOT NULL` biasa tidak cukup karena column tersebut null untuk subtype lain. Solusi perlu `CHECK` constraint conditional:

```sql
ALTER TABLE correspondence ADD CONSTRAINT chk_correspondence_email_required
CHECK (
    correspondence_type <> 'EMAIL'
    OR email_address IS NOT NULL
);
```

Jadi `SINGLE_TABLE` cepat, tetapi correctness perlu constraint conditional.

### Kapan cocok?

Cocok ketika:

- subtype sedikit,
- field subtype sedikit,
- subtype sering di-query bersama,
- lifecycle sama,
- permission/audit/retention sama,
- table tidak menjadi “graveyard” ratusan nullable columns.

Tidak cocok ketika:

- subtype sangat berbeda,
- field subtype banyak,
- constraint subtype kompleks,
- tiap subtype punya lifecycle dan authorization berbeda,
- subtype jarang di-query bersama.

---

## 7. `JOINED`: Table Parent + Table Child

Strategi `JOINED` menyimpan common field di parent table dan subtype-specific field di child table.

```java
@Entity
@Table(name = "correspondence")
@Inheritance(strategy = InheritanceType.JOINED)
@DiscriminatorColumn(name = "correspondence_type")
public abstract class CorrespondenceEntity {

    @Id
    private Long id;

    @Column(name = "subject", nullable = false)
    private String subject;
}

@Entity
@Table(name = "email_correspondence")
@DiscriminatorValue("EMAIL")
public class EmailCorrespondenceEntity extends CorrespondenceEntity {

    @Column(name = "email_address", nullable = false)
    private String emailAddress;
}

@Entity
@Table(name = "letter_correspondence")
@DiscriminatorValue("LETTER")
public class LetterCorrespondenceEntity extends CorrespondenceEntity {

    @Column(name = "mailing_address", nullable = false)
    private String mailingAddress;
}
```

Schema konseptual:

```sql
CREATE TABLE correspondence (
    id BIGINT PRIMARY KEY,
    correspondence_type VARCHAR(30) NOT NULL,
    subject VARCHAR(255) NOT NULL
);

CREATE TABLE email_correspondence (
    id BIGINT PRIMARY KEY,
    email_address VARCHAR(255) NOT NULL,
    CONSTRAINT fk_email_correspondence_parent
        FOREIGN KEY (id) REFERENCES correspondence(id)
);

CREATE TABLE letter_correspondence (
    id BIGINT PRIMARY KEY,
    mailing_address VARCHAR(1000) NOT NULL,
    CONSTRAINT fk_letter_correspondence_parent
        FOREIGN KEY (id) REFERENCES correspondence(id)
);
```

### Kelebihan `JOINED`

- Schema lebih normalized.
- Subtype-specific `NOT NULL` mudah.
- Child table bisa punya constraint dan index sendiri.
- Cocok ketika subtype field banyak.
- Cocok ketika subtype punya query khusus.

### Kekurangan `JOINED`

- Load subtype perlu join.
- Polymorphic query bisa menghasilkan outer join ke banyak child table.
- Insert membutuhkan parent + child insert.
- Delete/update lebih kompleks.
- Performance turun jika hierarchy besar.

Polymorphic listing:

```java
select c from CorrespondenceEntity c
```

bisa menjadi SQL yang join parent dengan semua child table untuk resolve subtype fields.

### Kapan cocok?

Cocok ketika:

- subtype punya banyak field berbeda,
- correctness subtype lebih penting daripada query simplicity,
- subtype-specific constraint penting,
- query per subtype lebih sering daripada query polymorphic semua subtype,
- data volume masih manageable untuk join.

Tidak cocok ketika:

- polymorphic listing sangat hot,
- hierarchy punya banyak subtype,
- query harus super cepat dan sederhana,
- database join cost menjadi bottleneck.

---

## 8. `TABLE_PER_CLASS`: Tiap Concrete Class Punya Table Sendiri

Strategi `TABLE_PER_CLASS` membuat tiap concrete subclass punya table lengkap, termasuk inherited fields.

```java
@Entity
@Inheritance(strategy = InheritanceType.TABLE_PER_CLASS)
public abstract class CorrespondenceEntity {

    @Id
    private Long id;

    @Column(name = "subject", nullable = false)
    private String subject;
}

@Entity
@Table(name = "email_correspondence")
public class EmailCorrespondenceEntity extends CorrespondenceEntity {
    private String emailAddress;
}

@Entity
@Table(name = "letter_correspondence")
public class LetterCorrespondenceEntity extends CorrespondenceEntity {
    private String mailingAddress;
}
```

Schema konseptual:

```sql
CREATE TABLE email_correspondence (
    id BIGINT PRIMARY KEY,
    subject VARCHAR(255) NOT NULL,
    email_address VARCHAR(255) NOT NULL
);

CREATE TABLE letter_correspondence (
    id BIGINT PRIMARY KEY,
    subject VARCHAR(255) NOT NULL,
    mailing_address VARCHAR(1000) NOT NULL
);
```

Polymorphic query terhadap superclass biasanya membutuhkan `UNION`.

### Kelebihan

- Table subtype mandiri.
- Tidak ada nullable explosion.
- Tidak perlu parent-child join untuk concrete subtype.
- Cocok jika subtype hampir independen.

### Kekurangan

- Polymorphic query mahal karena `UNION`.
- ID uniqueness lintas table harus dipikirkan.
- Common field terduplikasi di banyak table.
- Relationship ke superclass sulit secara FK murni.
- Schema evolution common field menyentuh banyak table.

### Kapan cocok?

Jarang menjadi default terbaik. Bisa cocok jika:

- concrete subtype benar-benar independen,
- polymorphic query jarang,
- tiap subtype punya lifecycle/table ownership terpisah,
- tidak butuh FK ke abstract root secara relational kuat.

---

## 9. Decision Matrix Inheritance Strategy

| Kebutuhan | Pilihan Umum | Alasan |
|---|---|---|
| Reuse field audit/id/tenant saja | `@MappedSuperclass` | Simple, tidak polymorphic |
| Subtype sedikit, query polymorphic sering | `SINGLE_TABLE` | Fast read, satu table |
| Subtype field banyak dan constraint kuat | `JOINED` | Normalized, constraint jelas |
| Subtype independen, polymorphic jarang | `TABLE_PER_CLASS` | Table mandiri |
| Behavior berbeda tapi data shape mirip | Explicit type field | Lebih sederhana dari inheritance |
| Type bisa berubah runtime | Composition/type column | Inheritance row type sulit berubah |
| Domain lifecycle berbeda jauh | Separate aggregate/table | Jangan paksa satu hierarchy |

Prinsip penting:

> Jangan memilih inheritance mapping karena Java class hierarchy terlihat rapi. Pilih berdasarkan query, constraint, lifecycle, ownership, dan operational behavior.

---

## 10. Alternatif: Explicit Type Field + Composition

Sering kali inheritance mapping bisa diganti dengan desain lebih stabil:

```java
@Entity
@Table(name = "correspondence")
public class CorrespondenceEntity {

    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 30)
    private CorrespondenceType type;

    @Column(name = "subject", nullable = false)
    private String subject;

    @Embedded
    private EmailDeliveryDetails emailDetails;

    @Embedded
    private LetterDeliveryDetails letterDetails;
}
```

Atau menggunakan child table eksplisit tanpa inheritance:

```java
@Entity
@Table(name = "correspondence")
public class CorrespondenceEntity {
    @Id
    private Long id;

    private String subject;

    @OneToOne(mappedBy = "correspondence", cascade = CascadeType.ALL, orphanRemoval = true)
    private EmailDeliveryEntity emailDelivery;

    @OneToOne(mappedBy = "correspondence", cascade = CascadeType.ALL, orphanRemoval = true)
    private LetterDeliveryEntity letterDelivery;
}
```

Dengan explicit type, kamu mengurangi magic polymorphism. Query dan schema lebih mudah dikontrol.

Gunakan explicit type ketika:

- subtype behavior mostly procedural/service-level,
- UI/report butuh satu table listing,
- subtype hanya memengaruhi validation/routing,
- polymorphic dispatch Java tidak terlalu penting,
- kamu ingin constraint eksplisit di DB.

---

## 11. Polymorphic Query dan `TYPE()`

JPA mendukung query polymorphic. Query ke root entity akan mengembalikan instance subclass.

```java
List<CorrespondenceEntity> all = entityManager
    .createQuery("select c from CorrespondenceEntity c", CorrespondenceEntity.class)
    .getResultList();
```

Untuk filter subtype:

```java
List<CorrespondenceEntity> emails = entityManager
    .createQuery("""
        select c
        from CorrespondenceEntity c
        where type(c) = EmailCorrespondenceEntity
        """, CorrespondenceEntity.class)
    .getResultList();
```

Atau query langsung subclass:

```java
List<EmailCorrespondenceEntity> emails = entityManager
    .createQuery("select e from EmailCorrespondenceEntity e", EmailCorrespondenceEntity.class)
    .getResultList();
```

Hal yang harus diperhatikan:

- Query root bisa lebih mahal daripada query subclass.
- Query root pada `JOINED` bisa outer join ke banyak table.
- Query root pada `TABLE_PER_CLASS` bisa union.
- Sorting/filter field subtype bisa membuat SQL kompleks.
- Pagination polymorphic query harus diuji dengan data besar.

---

## 12. Association ke Polymorphic Root

Misalnya:

```java
@Entity
@Table(name = "case_event")
public class CaseEventEntity {

    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "correspondence_id", nullable = false)
    private CorrespondenceEntity correspondence;
}
```

Jika `CorrespondenceEntity` memakai inheritance, maka event bisa menunjuk ke subtype mana pun.

Kelebihannya:

- Model Java ekspresif.
- Event tidak perlu tahu subtype.

Risikonya:

- Loading `correspondence` bisa memicu SQL polymorphic yang kompleks.
- Constraint subtype-specific tidak terlihat di association.
- Business logic bisa penuh `instanceof`.
- Authorization mungkin berbeda per subtype.

Prinsip:

> Association ke polymorphic root harus dipakai hanya jika caller memang memperlakukan semua subtype sebagai satu konsep domain yang benar-benar sama pada boundary tersebut.

Jika authorization, lifecycle, atau ownership berbeda, lebih baik association eksplisit ke entity spesifik atau gunakan reference model.

---

## 13. `@Embeddable` dan Value Object Lanjutan

`@Embeddable` cocok untuk value object yang tidak punya identity sendiri.

```java
@Embeddable
public class Address {

    @Column(name = "address_line_1", length = 200)
    private String line1;

    @Column(name = "address_line_2", length = 200)
    private String line2;

    @Column(name = "postal_code", length = 20)
    private String postalCode;
}

@Entity
@Table(name = "applicant")
public class ApplicantEntity {

    @Id
    private Long id;

    @Embedded
    private Address residentialAddress;
}
```

Jika ada dua address:

```java
@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "line1", column = @Column(name = "res_line_1")),
    @AttributeOverride(name = "line2", column = @Column(name = "res_line_2")),
    @AttributeOverride(name = "postalCode", column = @Column(name = "res_postal_code"))
})
private Address residentialAddress;

@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "line1", column = @Column(name = "mail_line_1")),
    @AttributeOverride(name = "line2", column = @Column(name = "mail_line_2")),
    @AttributeOverride(name = "postalCode", column = @Column(name = "mail_postal_code"))
})
private Address mailingAddress;
```

Gunakan embeddable ketika:

- value tidak punya identity,
- lifecycle mengikuti owner,
- tidak perlu query independent sebagai aggregate,
- tidak perlu FK dari entity lain ke value tersebut.

Jangan gunakan embeddable ketika value itu sebenarnya entity dengan lifecycle sendiri.

---

## 14. Java Record sebagai Embeddable

Pada Jakarta Persistence modern, embeddable dapat berupa Java record. Ini cocok untuk immutable value object.

Contoh konseptual:

```java
@Embeddable
public record MoneyAmount(
    BigDecimal amount,
    String currency
) {}
```

Pemakaian:

```java
@Entity
@Table(name = "invoice")
public class InvoiceEntity {

    @Id
    private Long id;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "amount", column = @Column(name = "total_amount", precision = 19, scale = 2)),
        @AttributeOverride(name = "currency", column = @Column(name = "currency", length = 3))
    })
    private MoneyAmount total;
}
```

Cocok untuk Java 16+ / 17+ codebase. Untuk Java 8, gunakan class biasa.

Perhatikan:

- Provider support harus sesuai versi.
- Record immutable; perubahan value dilakukan dengan mengganti object.
- Pastikan constructor validation tidak bertabrakan dengan hydration ORM.

---

## 15. JSON Mapping: Fleksibel Tapi Bukan Gratis

JSON column berguna saat data bersifat semi-structured:

- form dynamic fields,
- external API payload snapshot,
- metadata audit,
- configuration blob,
- search criteria snapshot,
- webhook payload,
- regulatory submitted form copy.

Tetapi JSON bukan solusi untuk menghindari desain relational.

Pertanyaan sebelum memakai JSON:

1. Apakah field di dalam JSON perlu difilter sering?
2. Apakah field perlu FK/constraint?
3. Apakah field perlu index?
4. Apakah field perlu audit before-after terstruktur?
5. Apakah schema JSON akan berubah?
6. Apakah value perlu partial update?
7. Apakah data perlu reporting SQL?
8. Apakah query harus portable lintas database?

Jika jawabannya banyak “ya”, JSON mungkin bukan pilihan utama.

---

## 16. JSON Mapping dengan Hibernate 6/7

Hibernate 6+ mendukung mapping JSON melalui `@JdbcTypeCode(SqlTypes.JSON)`.

```java
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "submission_snapshot")
public class SubmissionSnapshotEntity {

    @Id
    private Long id;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload_json", nullable = false)
    private SubmissionPayload payload;
}
```

Dengan Java type:

```java
public record SubmissionPayload(
    String applicantName,
    String licenceType,
    Map<String, Object> dynamicAnswers
) {}
```

Atau:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "metadata_json")
private Map<String, Object> metadata;
```

Keuntungan:

- Java type tetap structured.
- Serialization/deserialization ditangani provider/library JSON.
- Cocok untuk snapshot payload.

Risiko:

- Dirty checking JSON bisa mahal.
- Perubahan kecil bisa update seluruh JSON value.
- Query nested JSON provider/database-specific.
- Index JSON nested field database-specific.
- Schema validation JSON harus dibuat sendiri.
- Backward compatibility payload version harus dikelola.

---

## 17. JSON Sebagai Snapshot vs Source of Truth

Gunakan JSON sebagai **snapshot** ketika:

- kamu ingin menyimpan payload original saat submit,
- audit/regulatory membutuhkan “what user submitted at that time”,
- struktur form berubah dari waktu ke waktu,
- field tidak selalu perlu relational query.

Contoh:

```java
@Entity
@Table(name = "application_submission_snapshot")
public class ApplicationSubmissionSnapshotEntity {

    @Id
    private Long id;

    @Column(name = "application_id", nullable = false)
    private Long applicationId;

    @Column(name = "schema_version", nullable = false, length = 30)
    private String schemaVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "submitted_payload", nullable = false)
    private Map<String, Object> submittedPayload;

    @Column(name = "submitted_at", nullable = false)
    private Instant submittedAt;
}
```

Tetapi jangan simpan semua state utama hanya di JSON jika aplikasi perlu:

- filter application by status,
- search by applicant name,
- unique reference number,
- join ke case/officer/payment,
- enforce FK,
- reporting reguler.

Pola yang lebih kuat:

```text
Relational columns = canonical searchable/constrainted state
JSON snapshot       = submitted/original/dynamic payload
```

---

## 18. JSON Versioning

JSON payload harus punya schema version.

```json
{
  "schemaVersion": "application-form-v3",
  "answers": {
    "licenceType": "SALESPERSON",
    "hasPriorConviction": false
  }
}
```

Di entity:

```java
@Column(name = "payload_schema_version", nullable = false, length = 50)
private String payloadSchemaVersion;

@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "payload_json", nullable = false)
private Map<String, Object> payload;
```

Kenapa version penting?

- UI lama dan baru mungkin punya field berbeda.
- Export/report perlu interpretasi historis.
- Reprocessing perlu tahu struktur lama.
- Migration JSON massal mahal.
- Audit harus menjelaskan data sesuai versi saat itu.

Prinsip:

> JSON tanpa schema version adalah future incident.

---

## 19. JSON Constraint dan Index

Database modern memiliki JSON support berbeda:

- PostgreSQL: `jsonb`, expression index, GIN index.
- MySQL: `JSON`, generated column, functional index tergantung versi.
- Oracle: JSON support, check constraint `IS JSON`, search index tergantung versi/edition.
- SQL Server: JSON functions di atas text storage.

Untuk field yang sering dicari, pertimbangkan generated/extracted column:

```sql
-- konsep umum, syntax actual tergantung database
ALTER TABLE application_submission_snapshot
ADD applicant_identifier VARCHAR(50)
GENERATED ALWAYS AS (json_value(payload_json, '$.applicant.identifier'));

CREATE INDEX idx_submission_applicant_identifier
ON application_submission_snapshot(applicant_identifier);
```

Atau simpan field penting sebagai relational column:

```text
application.reference_no      relational, indexed, unique
application.status            relational, indexed
application.applicant_id      relational, FK/indexed
application.submitted_payload JSON snapshot
```

Prinsip:

> Field yang menjadi filter, join, authorization, uniqueness, atau workflow guard sebaiknya relational, bukan hanya JSON.

---

## 20. LOB Mapping: CLOB/BLOB dan Data Besar

JPA menyediakan `@Lob` untuk Large Object.

```java
@Entity
@Table(name = "audit_entry")
public class AuditEntryEntity {

    @Id
    private Long id;

    @Lob
    @Column(name = "metadata_clob")
    private String metadata;
}
```

Untuk binary:

```java
@Lob
@Column(name = "file_content")
private byte[] fileContent;
```

Namun LOB sangat berbahaya jika dianggap field biasa.

Masalah umum:

- load entity ikut load LOB besar,
- memory spike ketika list query,
- JSON serialization accidentally mengirim LOB,
- dirty checking membandingkan content besar,
- batch export lambat,
- backup/restore membesar,
- table bloat,
- index tidak relevan,
- database storage behavior khusus,
- network roundtrip besar.

### Jangan lakukan ini untuk listing

```java
List<AuditEntryEntity> entries = auditRepository.findByModule("CASE");
```

jika entity punya CLOB besar dan fetch behavior membuat CLOB ikut ter-load.

Lebih aman:

```java
public record AuditEntryListItem(
    Long id,
    String module,
    String action,
    Instant createdAt
) {}
```

Query listing:

```java
select new com.example.AuditEntryListItem(a.id, a.module, a.action, a.createdAt)
from AuditEntryEntity a
where a.module = :module
order by a.createdAt desc
```

Detail view baru load CLOB:

```java
AuditEntryEntity detail = entityManager.find(AuditEntryEntity.class, id);
String metadata = detail.getMetadata();
```

---

## 21. LOB: Inline DB vs External Object Storage

Pertanyaan utama:

> Apakah file/binary besar harus disimpan di database atau object storage?

### Simpan di database jika:

- ukuran relatif kecil,
- transactional consistency dengan row utama sangat penting,
- backup/restore bersama database diinginkan,
- akses jarang dan volume rendah,
- compliance menuntut storage terpusat DB,
- database licensing/storage cost acceptable.

### Simpan di object storage jika:

- file besar,
- volume tinggi,
- streaming/download sering,
- CDN/presigned URL diperlukan,
- lifecycle/retention berbeda,
- encryption/object lock/versioning dibutuhkan,
- database storage mahal.

Pattern umum:

```java
@Entity
@Table(name = "document")
public class DocumentEntity {

    @Id
    private Long id;

    @Column(name = "object_key", nullable = false, length = 500)
    private String objectKey;

    @Column(name = "content_type", nullable = false, length = 100)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "sha256", nullable = false, length = 64)
    private String sha256;

    @Column(name = "storage_status", nullable = false, length = 30)
    private String storageStatus;
}
```

Database menyimpan metadata, object storage menyimpan bytes.

Failure mode yang harus didesain:

```text
DB row committed, object upload failed
Object upload succeeded, DB commit failed
Object deleted, DB row still references it
DB rollback, object orphan remains
```

Solusi:

- staged upload,
- pending/confirmed status,
- idempotency key,
- background reconciler,
- content hash,
- object lifecycle cleanup,
- transactional outbox untuk post-commit processing.

---

## 22. Lazy LOB Tidak Selalu Sesuai Harapan

Banyak developer mencoba:

```java
@Lob
@Basic(fetch = FetchType.LAZY)
@Column(name = "metadata_clob")
private String metadata;
```

Secara konsep bagus, tetapi behavior tergantung provider, bytecode enhancement, database driver, dan mapping. Jangan mengandalkan lazy LOB tanpa verifikasi SQL dan test.

Strategi yang lebih eksplisit:

1. Pisahkan table detail/large payload.
2. Gunakan projection untuk listing.
3. Load LOB hanya di endpoint detail/export.
4. Jangan expose entity langsung ke serializer.

Contoh pemisahan:

```java
@Entity
@Table(name = "audit_entry")
public class AuditEntryEntity {
    @Id
    private Long id;

    private String module;
    private String action;
    private Instant createdAt;

    @OneToOne(mappedBy = "auditEntry", fetch = FetchType.LAZY, cascade = CascadeType.ALL)
    private AuditEntryPayloadEntity payload;
}

@Entity
@Table(name = "audit_entry_payload")
public class AuditEntryPayloadEntity {
    @Id
    private Long auditEntryId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "audit_entry_id")
    private AuditEntryEntity auditEntry;

    @Lob
    @Column(name = "metadata_clob", nullable = false)
    private String metadata;
}
```

---

## 23. Custom Type: Kapan Perlu?

Custom type diperlukan ketika Java type tidak bisa dimapping cukup dengan annotation standard.

Contoh:

- `Money` ke `amount + currency` columns,
- encrypted string ke binary/text column,
- PostgreSQL `inet`, `jsonb`, `ltree`, array,
- Oracle object type/UDT,
- domain-specific identifier wrapper,
- compressed JSON,
- masked PII,
- custom enum code.

Pilihan mapping berurutan dari paling portable ke paling provider-specific:

1. `@Embeddable`
2. `AttributeConverter<X, Y>`
3. Hibernate `@JdbcTypeCode`
4. Hibernate custom type / user type
5. Native SQL / database-specific repository

Prinsip:

> Mulai dari mapping paling sederhana yang menjaga correctness. Jangan langsung custom type jika `@Embeddable` atau `AttributeConverter` cukup.

---

## 24. `AttributeConverter`: Java Value ke Satu Column

`AttributeConverter<X, Y>` mengubah Java type `X` menjadi database column type `Y`.

Contoh stable enum code:

```java
public enum ApplicationStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    ApplicationStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static ApplicationStatus fromCode(String code) {
        for (ApplicationStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown ApplicationStatus code: " + code);
    }
}

@Converter(autoApply = false)
public class ApplicationStatusConverter
        implements AttributeConverter<ApplicationStatus, String> {

    @Override
    public String convertToDatabaseColumn(ApplicationStatus attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public ApplicationStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : ApplicationStatus.fromCode(dbData);
    }
}
```

Pemakaian:

```java
@Convert(converter = ApplicationStatusConverter.class)
@Column(name = "status", nullable = false, length = 1)
private ApplicationStatus status;
```

### Cocok untuk

- enum code stable,
- value wrapper ke string/number,
- simple encryption/decryption single-column,
- JSON sebagai string jika tidak butuh JSON type provider,
- normalization sederhana.

### Tidak cocok untuk

- value object multi-column,
- query complex pada internal field,
- vendor-specific type yang perlu JDBC binding khusus,
- relationship/entity mapping,
- conversion yang butuh dependency kompleks tanpa desain jelas.

---

## 25. Domain-Specific Identifier Wrapper

Daripada menyebar `String`/`Long` mentah:

```java
public record ApplicationReferenceNo(String value) {
    public ApplicationReferenceNo {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("reference number is required");
        }
    }
}
```

Converter:

```java
@Converter(autoApply = false)
public class ApplicationReferenceNoConverter
        implements AttributeConverter<ApplicationReferenceNo, String> {

    @Override
    public String convertToDatabaseColumn(ApplicationReferenceNo attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public ApplicationReferenceNo convertToEntityAttribute(String dbData) {
        return dbData == null ? null : new ApplicationReferenceNo(dbData);
    }
}
```

Entity:

```java
@Convert(converter = ApplicationReferenceNoConverter.class)
@Column(name = "reference_no", nullable = false, unique = true, length = 50)
private ApplicationReferenceNo referenceNo;
```

Trade-off:

- Type safety meningkat.
- Query parameter binding harus memakai wrapper atau converter behavior harus diuji.
- DTO/API mapping perlu explicit conversion.
- Bisa terasa verbose di codebase kecil.

---

## 26. Money Mapping: Embeddable Lebih Baik dari Converter Tunggal

Money biasanya terdiri dari amount + currency. Jangan simpan sebagai satu string seperti `"100.00 SGD"` jika perlu query/sort/sum.

Gunakan embeddable:

```java
@Embeddable
public class MoneyAmount {

    @Column(name = "amount", precision = 19, scale = 2, nullable = false)
    private BigDecimal amount;

    @Column(name = "currency", length = 3, nullable = false)
    private String currency;

    protected MoneyAmount() {}

    public MoneyAmount(BigDecimal amount, String currency) {
        if (amount == null) throw new IllegalArgumentException("amount is required");
        if (currency == null || currency.length() != 3) throw new IllegalArgumentException("currency must be ISO-4217 code");
        this.amount = amount;
        this.currency = currency;
    }
}
```

Entity:

```java
@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "amount", column = @Column(name = "fee_amount", precision = 19, scale = 2)),
    @AttributeOverride(name = "currency", column = @Column(name = "fee_currency", length = 3))
})
private MoneyAmount fee;
```

Kenapa bukan converter ke string?

- Amount bisa di-sort.
- Amount bisa di-sum.
- Currency bisa difilter.
- Precision/scale jelas.
- Constraint lebih mudah.

---

## 27. Hibernate `@JdbcTypeCode` dan Vendor-Specific SQL Type

Hibernate modern menyediakan `@JdbcTypeCode` untuk memberi tahu JDBC/SQL type yang diinginkan.

JSON:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "payload_json")
private Map<String, Object> payload;
```

Array/vendor-specific type dapat memakai mapping Hibernate tertentu tergantung database/dialect.

Konsekuensi:

- Code menjadi Hibernate-specific.
- Portability JPA murni berkurang.
- Migration provider lebih sulit.
- Tetapi integration dengan database modern menjadi jauh lebih kuat.

Prinsip praktis:

> Provider-specific mapping acceptable untuk production system jika keputusan tersebut eksplisit, terdokumentasi, diuji, dan ada alasan database capability yang nyata.

---

## 28. Formula dan Derived Field

Hibernate mendukung mapping field dari SQL formula, misalnya:

```java
@Formula("first_name || ' ' || last_name")
private String fullName;
```

Atau count derived:

```java
@Formula("(select count(*) from case_note n where n.case_id = id)")
private long noteCount;
```

Kelebihan:

- Nyaman untuk read-only derived value.
- Mengurangi boilerplate query tertentu.

Risiko:

- Provider-specific.
- SQL fragment database-specific.
- Bisa menghasilkan subquery per row.
- Bisa merusak performance listing.
- Tidak cocok untuk value yang sering berubah dan butuh consistency kompleks.

Alternatif:

- DTO projection query.
- Database view/materialized view.
- Denormalized read model.
- Explicit aggregate column dengan event/update logic.

Prinsip:

> `@Formula` cocok untuk derived field kecil dan stabil, bukan pengganti reporting query.

---

## 29. Immutable dan Read-Only Entity

Ada entity yang sebaiknya tidak diupdate aplikasi:

- reference/master data,
- database view,
- historical snapshot,
- audit entry,
- imported registry row,
- materialized read model.

Hibernate menyediakan `@Immutable`:

```java
@Entity
@Table(name = "licence_type_ref")
@Immutable
public class LicenceTypeRefEntity {

    @Id
    @Column(name = "code", length = 30)
    private String code;

    @Column(name = "description", nullable = false)
    private String description;
}
```

Read-only entity mengurangi risiko accidental update.

Tetapi:

- JPA standard tidak sepenuhnya sama dengan Hibernate `@Immutable`.
- Jangan jadikan read-only entity sebagai tempat domain mutation.
- Update reference data harus punya jalur migration/admin yang jelas.

Untuk view:

```java
@Entity
@Table(name = "case_listing_view")
@Immutable
public class CaseListingViewEntity {

    @Id
    private Long caseId;

    private String referenceNo;
    private String status;
    private String assignedOfficer;
    private Instant lastUpdatedAt;
}
```

Cocok untuk listing/report read model.

---

## 30. Soft Delete Mapping

Soft delete berarti row tidak dihapus fisik, tetapi diberi marker:

```text
deleted = true
or deleted_at is not null
```

Hibernate modern punya support soft delete, tetapi konsep umumnya:

```java
@Entity
@Table(name = "document")
public class DocumentEntity {

    @Id
    private Long id;

    @Column(name = "deleted_at")
    private Instant deletedAt;
}
```

Risiko soft delete:

- Semua query harus exclude deleted row.
- Unique constraint menjadi sulit.
- Relationship ke deleted row ambigu.
- Reporting perlu include/exclude tergantung konteks.
- Cascade delete berubah makna.
- Data retention/legal hold bisa bercampur.

Unique constraint problem:

```text
reference_no unique
```

Jika row lama soft-deleted, apakah reference boleh dipakai lagi?

Solusi tergantung DB:

- partial unique index: unique where `deleted_at is null`,
- composite unique `(reference_no, deleted_marker)` dengan hati-hati,
- jangan reuse business reference,
- archive table.

Prinsip:

> Soft delete bukan fitur UI. Ia mengubah invariant data, query semantics, uniqueness, audit, retention, dan security.

---

## 31. Encrypted Field Mapping

Ada field yang perlu dienkripsi di application layer:

- national ID,
- passport number,
- phone/email tertentu,
- confidential notes,
- payment-related token,
- sensitive payload.

Converter sederhana:

```java
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    @Override
    public String convertToDatabaseColumn(String attribute) {
        if (attribute == null) return null;
        return encrypt(attribute);
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        if (dbData == null) return null;
        return decrypt(dbData);
    }

    private String encrypt(String plain) {
        // placeholder: use proper AEAD encryption, key management, IV/nonce, versioning
        throw new UnsupportedOperationException("example only");
    }

    private String decrypt(String cipher) {
        throw new UnsupportedOperationException("example only");
    }
}
```

Entity:

```java
@Convert(converter = EncryptedStringConverter.class)
@Column(name = "national_id_encrypted", length = 500)
private String nationalId;
```

Tetapi encryption mapping punya trade-off besar.

### Problem Search

Jika encryption memakai random IV/nonce yang benar, ciphertext berbeda untuk plaintext sama. Maka:

```sql
where national_id_encrypted = ?
```

tidak bisa dipakai untuk search plaintext.

Solusi umum:

- simpan encrypted value untuk confidentiality,
- simpan keyed hash/blind index untuk exact lookup.

```text
national_id_ciphertext
national_id_hash
```

Hash harus pakai keyed HMAC, bukan plain hash, agar tidak mudah dictionary attack.

### Problem Key Rotation

Encrypted column harus menyimpan metadata:

```text
ciphertext
key_version
algorithm_version
```

Agar bisa:

- decrypt data lama,
- rotate key bertahap,
- re-encrypt batch,
- audit key usage.

### Problem Dirty Checking

Jika converter menghasilkan ciphertext berbeda setiap convert walaupun plaintext sama, ORM bisa menganggap field berubah. Desain converter harus hati-hati.

Prinsip:

> Encryption field bukan sekadar converter. Ia adalah desain security, search, key management, migration, audit, dan operational recovery.

---

## 32. Masking Field: Jangan Campur Storage dan Presentation

Masking seperti:

```text
S1234567A -> S****567A
```

adalah concern presentation/authorization, bukan selalu persistence mapping.

Jangan menyimpan hanya masked value jika butuh exact legal value.

Pattern:

```text
national_id_ciphertext  = encrypted original
national_id_hash        = exact lookup blind index
national_id_last4       = display helper if allowed
```

API response melakukan masking berdasarkan permission:

```java
public String displayNationalId(User user) {
    if (user.canViewFullNationalId()) {
        return nationalId;
    }
    return mask(nationalId);
}
```

Lebih baik masking di service/DTO mapper daripada entity getter, karena entity tidak tahu caller permission.

---

## 33. Custom Enum Mapping: Jangan Gunakan Ordinal

Sudah dibahas di mapping fundamental, tetapi di advanced mapping perlu ditegaskan untuk long-lived enterprise system.

Buruk:

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Karena perubahan urutan enum merusak data historis.

Lebih baik:

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", length = 30)
private CaseStatus status;
```

Atau stable code converter jika DB perlu compact code:

```java
@Convert(converter = CaseStatusCodeConverter.class)
@Column(name = "status_code", length = 2)
private CaseStatus status;
```

Untuk regulatory/case-management system, stable status code sering lebih baik daripada enum name karena:

- code bisa menjadi contract lintas sistem,
- label bisa berubah tanpa mengubah code,
- migration controlled,
- reporting stabil.

---

## 34. Database-Specific Type: Kapan Boleh Tidak Portable?

Portability itu bagus, tetapi tidak selalu tujuan tertinggi.

Gunakan database-specific type jika:

- fitur database memberi correctness/performance besar,
- aplikasi memang committed ke vendor tersebut,
- fallback abstraction justru lebih buruk,
- query/reporting sangat bergantung ke fitur tersebut,
- migration vendor bukan requirement realistis.

Contoh:

- PostgreSQL `jsonb` + GIN index untuk metadata search.
- Oracle CLOB dengan storage policy tertentu untuk audit besar.
- SQL Server snapshot isolation/read committed snapshot behavior.
- PostgreSQL partial index untuk soft delete uniqueness.
- Oracle function-based index untuk normalized search.

Yang penting:

- dokumentasikan vendor coupling,
- test dengan database nyata,
- jangan pura-pura portable,
- isolasi ke repository/query tertentu,
- jangan bocorkan vendor detail ke domain layer.

---

## 35. Anti-Pattern Advanced Mapping

### 35.1 Inheritance Dipakai untuk Semua Variasi

Buruk:

```text
Application
├── DraftApplication
├── SubmittedApplication
├── ApprovedApplication
├── RejectedApplication
```

Status workflow bukan selalu subtype. Biasanya lebih tepat:

```java
@Enumerated(EnumType.STRING)
private ApplicationStatus status;
```

State transition diatur service/domain logic, bukan class inheritance.

### 35.2 JSON untuk Menghindari Schema Design

Buruk:

```text
application(id, payload_json)
```

Semua status, applicant, officer, payment, date, dan reference disimpan di JSON.

Akibat:

- search susah,
- constraint lemah,
- reporting mahal,
- authorization rawan,
- migration payload kacau.

### 35.3 LOB di Entity Hot Path

Buruk:

```java
@Entity
class CaseEntity {
    @Lob
    private String fullAuditHistory;
}
```

Kemudian `findAllCases()` untuk listing me-load CLOB besar.

### 35.4 Converter Berisi Business Service

Buruk:

```java
@Converter
class SomeConverter implements AttributeConverter<X, Y> {
    @Autowired ExternalApi api;
}
```

Converter harus deterministic, local, cepat, dan aman dipanggil saat hydration/flush.

### 35.5 Getter Entity Melakukan Masking Berdasarkan Global Context

Buruk:

```java
public String getNationalId() {
    return SecurityContext.currentUser().isAdmin() ? decrypt(...) : mask(...);
}
```

Entity menjadi tergantung security context dan sulit dites.

### 35.6 Formula Berat di Listing

Buruk:

```java
@Formula("(select count(*) from huge_table h where h.case_id = id)")
private long count;
```

Lalu query listing 1000 row menghasilkan 1000 subquery mahal.

---

## 36. Production Failure Modes

### 36.1 Query Polymorphic Tiba-Tiba Lambat

Gejala:

- endpoint listing lambat setelah subtype bertambah,
- SQL banyak join/union,
- DB CPU naik,
- pagination lambat.

Kemungkinan:

- `JOINED` hierarchy terlalu besar,
- query root entity padahal hanya perlu satu subtype,
- fetch association polymorphic ikut join,
- missing index discriminator/type/status.

Mitigasi:

- query subtype langsung,
- projection read model,
- denormalized listing view,
- explicit type field,
- evaluasi ulang inheritance strategy.

### 36.2 JSON Schema Drift

Gejala:

- deserialization gagal untuk payload lama,
- report salah membaca field lama,
- null pointer pada field yang dulu belum ada,
- export beda interpretasi.

Mitigasi:

- simpan `schema_version`,
- buat parser per version,
- migration/backfill eksplisit,
- compatibility test dataset lama.

### 36.3 LOB Membuat Memory Spike

Gejala:

- OOM saat listing/export,
- GC pressure tinggi,
- response time naik drastis,
- network egress DB besar.

Mitigasi:

- projection tanpa LOB,
- split table payload,
- streaming export,
- load detail only,
- object storage untuk binary besar.

### 36.4 Converter Membuat Query Tidak Memakai Index

Gejala:

- query by converted field lambat,
- function wrapping column,
- implicit conversion database,
- index tidak terpakai.

Mitigasi:

- pastikan DB column type sesuai parameter type,
- gunakan stable normalized column,
- cek execution plan,
- hindari converter yang mengubah format unpredictable.

### 36.5 Encryption Merusak Search

Gejala:

- tidak bisa cari by national ID/email,
- exact match gagal karena ciphertext random,
- tim menambahkan decrypt-all-rows di aplikasi.

Mitigasi:

- blind index/HMAC column,
- search token terpisah,
- jangan decrypt massal untuk search,
- desain query dari awal.

---

## 37. Performance Consideration

### 37.1 Inheritance

| Strategy | Read Root | Read Subtype | Insert | Constraint | Schema |
|---|---:|---:|---:|---:|---|
| `SINGLE_TABLE` | Cepat | Cepat | Sederhana | Conditional sulit | Wide nullable table |
| `JOINED` | Bisa mahal | Join parent-child | Lebih banyak insert | Kuat | Normalized |
| `TABLE_PER_CLASS` | Union mahal | Cepat per subtype | Sederhana | Per table | Duplikasi column |
| `@MappedSuperclass` | Tidak polymorphic | Cepat | Sederhana | Per table | Duplikasi field |

### 37.2 JSON

Perhatikan:

- serialization/deserialization cost,
- update seluruh document,
- index nested field,
- query portability,
- storage size,
- compression,
- generated columns.

### 37.3 LOB

Perhatikan:

- jangan load dalam list,
- jangan serialize entity langsung,
- pisahkan metadata dan content,
- gunakan streaming untuk binary besar,
- hindari dirty checking content besar.

### 37.4 Custom Type

Perhatikan:

- conversion cost saat hydration,
- conversion cost saat flush,
- query parameter binding,
- index usage,
- batch insert/update behavior,
- cache serialization.

---

## 38. Design Heuristics untuk Staff-Level Review

Gunakan pertanyaan berikut saat review advanced mapping.

### Untuk Inheritance

1. Apakah subtype benar-benar domain subtype, atau hanya status/type?
2. Apakah query polymorphic sering?
3. Apakah subtype punya constraint berbeda?
4. Apakah subtype punya lifecycle berbeda?
5. Apakah authorization berbeda per subtype?
6. Apakah jumlah subtype akan bertambah?
7. Apa SQL untuk query listing utama?
8. Apa index yang dibutuhkan?
9. Bagaimana migration jika subtype baru ditambah?

### Untuk JSON

1. Field mana yang canonical relational?
2. Field mana yang hanya snapshot?
3. Apakah ada schema version?
4. Apakah payload lama masih bisa dibaca?
5. Apakah field JSON perlu index?
6. Apakah JSON perlu validation?
7. Bagaimana partial update?
8. Bagaimana audit diff?

### Untuk LOB

1. Berapa ukuran rata-rata dan p95/p99?
2. Apakah list query load LOB?
3. Apakah perlu streaming?
4. Apakah backup/restore terpengaruh?
5. Apakah object storage lebih cocok?
6. Bagaimana orphan cleanup?
7. Bagaimana retention/legal hold?

### Untuk Custom Type/Encryption

1. Apakah `AttributeConverter` cukup?
2. Apakah perlu multi-column embeddable?
3. Apakah provider-specific acceptable?
4. Apakah query by field masih bisa memakai index?
5. Apakah conversion deterministic?
6. Apakah key rotation didesain?
7. Apakah masking di layer yang benar?

---

## 39. Example: Case Management Advanced Mapping

Misalnya sistem punya:

- `CaseEntity`,
- beberapa jenis correspondence,
- dynamic form submission snapshot,
- document metadata,
- audit payload besar,
- confidential applicant identifier.

Desain yang lebih aman:

```text
case
- id
- reference_no
- status
- case_type
- assigned_officer_id
- applicant_id_hash
- applicant_id_ciphertext
- created_at
- updated_at

case_submission_snapshot
- id
- case_id
- schema_version
- payload_json
- submitted_at

correspondence
- id
- case_id
- correspondence_type
- subject
- status
- created_at

email_correspondence_detail
- correspondence_id
- recipient_email_ciphertext
- recipient_email_hash
- provider_message_id

document
- id
- case_id
- object_key
- filename
- content_type
- size_bytes
- sha256
- storage_status

audit_entry
- id
- case_id
- action
- actor_id
- created_at

audit_entry_payload
- audit_entry_id
- before_json
- after_json
- reason
```

Catatan desain:

- Case status relational karena workflow/search/report butuh.
- Submission payload JSON karena snapshot dynamic form.
- Document content tidak di DB; DB hanya metadata.
- Audit payload dipisah dari audit listing.
- Applicant ID encrypted + blind index.
- Correspondence type bisa single table atau explicit details table, tergantung subtype complexity.

---

## 40. Testing Advanced Mapping

Test minimal:

1. Schema generated/migration sesuai expectation.
2. Insert/load tiap subtype inheritance.
3. Query root dan query subtype menghasilkan SQL yang masuk akal.
4. Constraint subtype-specific bekerja.
5. JSON payload lama dan baru bisa dibaca.
6. JSON schema version diuji.
7. LOB tidak ikut load di listing projection.
8. Converter round-trip benar.
9. Encrypted field tidak bocor plaintext di DB.
10. Blind index search bekerja.
11. Soft delete tidak menampilkan row deleted pada query normal.
12. Unique constraint soft-delete sesuai rule.
13. Formula tidak menyebabkan query explosion.
14. Read-only entity tidak accidental update.

Contoh test JSON round-trip:

```java
@Test
void shouldPersistAndLoadSubmissionPayload() {
    SubmissionPayload payload = new SubmissionPayload(
        "Alice",
        "SALESPERSON",
        Map.of("hasPriorConviction", false)
    );

    SubmissionSnapshotEntity entity = new SubmissionSnapshotEntity();
    entity.setPayloadSchemaVersion("application-form-v3");
    entity.setPayload(payload);

    entityManager.persist(entity);
    entityManager.flush();
    entityManager.clear();

    SubmissionSnapshotEntity loaded = entityManager.find(SubmissionSnapshotEntity.class, entity.getId());

    assertEquals("Alice", loaded.getPayload().applicantName());
    assertEquals("application-form-v3", loaded.getPayloadSchemaVersion());
}
```

Contoh test encryption:

```java
@Test
void shouldNotStorePlainNationalId() {
    ApplicantEntity applicant = new ApplicantEntity();
    applicant.setNationalId("S1234567A");

    entityManager.persist(applicant);
    entityManager.flush();

    String raw = jdbcTemplate.queryForObject(
        "select national_id_encrypted from applicant where id = ?",
        String.class,
        applicant.getId()
    );

    assertNotEquals("S1234567A", raw);
}
```

---

## 41. Checklist Praktis

Sebelum memakai advanced mapping, jawab:

- [ ] Apakah advanced mapping ini menyelesaikan masalah nyata, bukan hanya mempercantik Java model?
- [ ] Apakah SQL yang dihasilkan sudah diketahui?
- [ ] Apakah index dan constraint sudah dirancang?
- [ ] Apakah migration production aman?
- [ ] Apakah query hot path memakai projection/read model jika perlu?
- [ ] Apakah subtype baru bisa ditambahkan tanpa merusak data lama?
- [ ] Apakah JSON punya schema version?
- [ ] Apakah field penting untuk workflow/search/report tetap relational?
- [ ] Apakah LOB tidak ikut listing query?
- [ ] Apakah binary besar sebaiknya external object storage?
- [ ] Apakah custom converter deterministic dan cepat?
- [ ] Apakah encryption punya search/key rotation strategy?
- [ ] Apakah soft delete punya unique constraint strategy?
- [ ] Apakah tests menggunakan database nyata, bukan hanya H2?
- [ ] Apakah observability cukup untuk mendeteksi query explosion?

---

## 42. Latihan / Scenario

### Scenario 1 — Correspondence Hierarchy

Kamu punya `Email`, `Letter`, `SMS`, `PortalNotification`. Semua punya `subject`, `caseId`, `status`, `createdAt`. Email punya provider message id, letter punya print batch id, SMS punya phone number.

Pertanyaan:

1. Apakah kamu memilih `SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS`, atau explicit type + detail table?
2. Query apa yang paling sering?
3. Constraint subtype apa yang wajib?
4. Bagaimana indexing-nya?
5. Bagaimana subtype baru ditambahkan?

### Scenario 2 — Dynamic Application Form

Form application berubah setiap tahun. Namun report harus tetap filter by `status`, `licenceType`, `submittedAt`, dan `applicantId`.

Pertanyaan:

1. Field mana relational?
2. Field mana JSON snapshot?
3. Bagaimana schema version disimpan?
4. Bagaimana migration payload lama?
5. Bagaimana indexing field JSON jika diperlukan?

### Scenario 3 — Audit Trail CLOB

Table audit punya jutaan row dan column CLOB before/after JSON. Listing audit sering timeout.

Pertanyaan:

1. Apakah listing query load CLOB?
2. Apakah perlu split table payload?
3. Apakah perlu projection?
4. Bagaimana index untuk filter module/action/date?
5. Bagaimana archival?

### Scenario 4 — Confidential Identifier

Sistem harus menyimpan national ID terenkripsi tetapi tetap bisa exact lookup.

Pertanyaan:

1. Apakah cukup encryption converter?
2. Apakah perlu blind index?
3. Bagaimana key version?
4. Bagaimana rotation?
5. Bagaimana masking response?

---

## 43. Ringkasan

Advanced mapping memberi kekuatan besar, tetapi setiap kekuatan membawa biaya.

Prinsip utama:

1. `@MappedSuperclass` untuk code reuse, bukan polymorphic persistence.
2. `SINGLE_TABLE` cepat tetapi rawan nullable explosion dan conditional constraint.
3. `JOINED` normalized tetapi query polymorphic bisa mahal.
4. `TABLE_PER_CLASS` jarang menjadi default; polymorphic query biasanya mahal.
5. Banyak inheritance bisa diganti explicit type + composition dengan schema lebih jelas.
6. JSON cocok untuk snapshot/semi-structured data, bukan pengganti semua relational design.
7. Field workflow/search/report/constraint sebaiknya relational.
8. LOB harus diperlakukan sebagai data besar, bukan field biasa.
9. Custom type harus dipilih dari yang paling portable: embeddable, converter, provider-specific type, native SQL.
10. Encryption field membutuhkan desain search, key versioning, rotation, masking, dan audit.
11. Soft delete mengubah semantics data, bukan sekadar filter UI.
12. Advanced mapping harus selalu direview bersama SQL, schema, index, migration, dan failure mode.

Jika bagian sebelumnya membahas mapping dasar, maka bagian ini membahas batas ketika mapping mulai menjadi keputusan arsitektural. Engineer top-tier tidak hanya bertanya “annotation apa yang bisa dipakai?”, tetapi “apakah mapping ini tetap benar, cepat, bisa dimigrasi, bisa diaudit, dan bisa dioperasikan setelah data mencapai jutaan row?”.

---

## 44. Referensi Resmi dan Lanjutan

- Jakarta Persistence Specification 3.2 — standard object/relational mapping dan persistence untuk Jakarta EE/Java SE.
- Jakarta Persistence API — annotation seperti `@Inheritance`, `@DiscriminatorColumn`, `@Lob`, `@Embeddable`, `@AttributeOverride`, `@Convert`.
- Hibernate ORM User Guide 7.x — inheritance, basic type mapping, JSON, LOB, custom type, formula, immutable entity, soft delete, database-specific mapping.
- Hibernate ORM 6.x/7.x documentation — `@JdbcTypeCode(SqlTypes.JSON)`, modern type system, provider-specific mapping.
- Database documentation sesuai vendor: Oracle, PostgreSQL, MySQL/InnoDB, SQL Server untuk JSON, LOB, generated column, function-based/partial index, encryption, dan storage behavior.

