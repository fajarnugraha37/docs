# Part 12 — Inheritance Mapping: Object Hierarchy vs Relational Shape

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: `12` dari `34`  
> Fokus: inheritance mapping sebagai keputusan bentuk data, query, constraint, dan evolusi schema — bukan sekadar memilih `@Inheritance`.

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami bahwa inheritance ORM adalah kompromi antara **object model** dan **relational model**.
2. Menentukan kapan menggunakan:
   - `@MappedSuperclass`,
   - `SINGLE_TABLE`,
   - `JOINED`,
   - `TABLE_PER_CLASS`,
   - atau tidak memakai inheritance ORM sama sekali.
3. Membaca konsekuensi SQL dari setiap strategi.
4. Mendesain hierarchy yang tetap maintainable ketika domain berkembang.
5. Menghindari performance trap dari polymorphic query.
6. Menghindari schema trap seperti nullable-column explosion, impossible constraint, dan expensive join hierarchy.
7. Memahami perbedaan behavior penting antara Hibernate dan EclipseLink.
8. Menerapkan inheritance secara aman pada sistem enterprise seperti case management, workflow, compliance, dan regulatory audit.

---

## 1. Why This Matters

Inheritance terlihat natural di Java:

```java
abstract class CaseAction {
    Long id;
    String performedBy;
    Instant performedAt;
}

class ApprovalAction extends CaseAction {
    String approvalLevel;
}

class RejectionAction extends CaseAction {
    String rejectionReason;
}

class EscalationAction extends CaseAction {
    String escalationQueue;
}
```

Secara object-oriented, ini tampak bersih:

- ada common behavior,
- ada subtype specialization,
- polymorphism terasa natural,
- business code bisa menerima `CaseAction` tanpa peduli concrete type.

Namun relational database tidak punya inheritance object seperti Java. Database punya:

- table,
- column,
- row,
- foreign key,
- constraint,
- index,
- join,
- query plan,
- transaction isolation,
- storage layout.

Ketika kamu memakai JPA inheritance, kamu sedang meminta provider untuk menjembatani dua dunia yang berbeda:

```text
Java hierarchy
    ↓
ORM metadata interpretation
    ↓
Relational shape
    ↓
Generated SQL
    ↓
Query plan and constraint behavior
```

Masalahnya: pilihan yang terlihat kecil di annotation bisa mengunci bentuk database jangka panjang.

```java
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
```

atau:

```java
@Inheritance(strategy = InheritanceType.JOINED)
```

atau:

```java
@Inheritance(strategy = InheritanceType.TABLE_PER_CLASS)
```

Perbedaan annotation ini bisa menentukan:

- jumlah table,
- jumlah join,
- nullability,
- indexing strategy,
- query speed,
- migration difficulty,
- constraint expressiveness,
- locking behavior,
- cache shape,
- reporting complexity,
- audit traceability.

Engineer biasa melihat inheritance sebagai fitur mapping. Engineer kuat melihatnya sebagai **schema architecture decision**.

---

## 2. Core Mental Model

### 2.1 Inheritance ORM adalah pertanyaan bentuk data

Pertanyaan utamanya bukan:

> “Bagaimana cara map class hierarchy ke database?”

Pertanyaan yang lebih benar:

> “Apakah domain polymorphism saya benar-benar harus menjadi polymorphism persistence?”

Ada tiga level yang harus dibedakan:

```text
1. Code reuse inheritance
   Common field / common method / common validation.

2. Domain polymorphism
   Business rule ingin memperlakukan beberapa subtype sebagai satu abstraction.

3. Persistence polymorphism
   Query, relationship, lifecycle, dan identity ingin memperlakukan subtype sebagai satu entity hierarchy.
```

Ketiganya tidak selalu harus sama.

Contoh:

```java
abstract class AuditableEntity {
    Instant createdAt;
    String createdBy;
    Instant updatedAt;
    String updatedBy;
}
```

Ini biasanya **code reuse**, bukan persistence polymorphism. `@MappedSuperclass` sering cukup.

Contoh lain:

```java
abstract class PaymentMethod {}
class CreditCardPaymentMethod extends PaymentMethod {}
class BankTransferPaymentMethod extends PaymentMethod {}
```

Ini mungkin domain polymorphism.

Tapi apakah harus menjadi JPA inheritance? Belum tentu. Bisa juga model relational biasa:

```text
payment_method
- id
- type
- card_token nullable
- bank_account_id nullable
```

atau:

```text
payment_method
payment_card_detail
payment_bank_detail
```

atau bahkan:

```text
payment
payment_event
payment_instruction_json
```

Mental model penting:

> Java inheritance adalah cara menyusun behavior. Relational shape adalah cara menyimpan fakta dan menjaga constraint. ORM inheritance hanya cocok ketika dua kebutuhan itu cukup sejalan.

---

## 3. Specification-Level Concept

Jakarta Persistence/JPA mendefinisikan beberapa cara persistence inheritance:

1. `@MappedSuperclass`
2. `@Inheritance(strategy = SINGLE_TABLE)`
3. `@Inheritance(strategy = JOINED)`
4. `@Inheritance(strategy = TABLE_PER_CLASS)`

Secara specification-level, strategi inheritance standar adalah:

```java
public enum InheritanceType {
    SINGLE_TABLE,
    JOINED,
    TABLE_PER_CLASS
}
```

JPA/Jakarta Persistence mendefinisikan bahwa inheritance strategy diletakkan pada root entity hierarchy:

```java
@Entity
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
public abstract class CaseAction {
    @Id
    private Long id;
}
```

Discriminator bisa digunakan untuk membedakan subtype:

```java
@Entity
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "ACTION_TYPE")
public abstract class CaseAction {
    @Id
    private Long id;
}

@Entity
@DiscriminatorValue("APPROVAL")
public class ApprovalAction extends CaseAction {
    private String approvalLevel;
}
```

Dalam `SINGLE_TABLE`, discriminator hampir selalu menjadi bagian inti karena semua subtype berada di satu table.

Dalam `JOINED`, discriminator dapat digunakan, tetapi bentuk relational juga bisa ditentukan melalui join ke subclass table. Provider memiliki detail behavior masing-masing.

Dalam `TABLE_PER_CLASS`, setiap concrete subclass punya table sendiri yang berisi inherited fields dan subclass fields.

---

## 4. The Four Inheritance-Like Choices

Jangan langsung berpikir hanya ada tiga strategy. Dalam praktik, ada empat pilihan besar:

```text
A. @MappedSuperclass
B. SINGLE_TABLE
C. JOINED
D. TABLE_PER_CLASS
E. No ORM inheritance: composition/type/state modeling
```

Ya, pilihan kelima sering paling penting.

---

# 5. `@MappedSuperclass`

## 5.1 Mental Model

`@MappedSuperclass` berarti:

> “Class ini menyumbang mapping metadata ke subclass, tetapi class ini sendiri bukan entity dan tidak punya table sendiri.”

Contoh:

```java
@MappedSuperclass
public abstract class AuditableEntity {

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "CREATED_BY", nullable = false, updatable = false)
    private String createdBy;

    @Column(name = "UPDATED_AT")
    private Instant updatedAt;

    @Column(name = "UPDATED_BY")
    private String updatedBy;
}

@Entity
@Table(name = "CASE_FILE")
public class CaseFile extends AuditableEntity {

    @Id
    private Long id;

    @Column(name = "CASE_NUMBER", nullable = false)
    private String caseNumber;
}

@Entity
@Table(name = "CASE_TASK")
public class CaseTask extends AuditableEntity {

    @Id
    private Long id;

    @Column(name = "TASK_NAME", nullable = false)
    private String taskName;
}
```

Relational result:

```text
CASE_FILE
- ID
- CASE_NUMBER
- CREATED_AT
- CREATED_BY
- UPDATED_AT
- UPDATED_BY

CASE_TASK
- ID
- TASK_NAME
- CREATED_AT
- CREATED_BY
- UPDATED_AT
- UPDATED_BY
```

Tidak ada table `AUDITABLE_ENTITY`.

Tidak bisa query:

```java
select a from AuditableEntity a
```

Karena `AuditableEntity` bukan entity.

## 5.2 Kapan Cocok

Gunakan `@MappedSuperclass` untuk:

- common audit columns,
- common optimistic version field,
- common tenant field,
- common ID mapping,
- common lifecycle callbacks,
- common soft delete metadata,
- common technical fields.

Contoh:

```java
@MappedSuperclass
public abstract class VersionedEntity {

    @Version
    @Column(name = "VERSION", nullable = false)
    private long version;
}
```

## 5.3 Kapan Tidak Cocok

Tidak cocok jika kamu perlu:

- polymorphic query terhadap base type,
- relationship ke base type,
- lifecycle base entity,
- table untuk base abstraction,
- shared identity across subtype table.

Contoh yang tidak bisa:

```java
@ManyToOne
private AuditableEntity target;
```

Karena `AuditableEntity` bukan entity.

## 5.4 Design Rule

Gunakan `@MappedSuperclass` ketika inheritance-mu adalah **code reuse**, bukan **domain polymorphism persistence**.

---

# 6. `SINGLE_TABLE`

## 6.1 Mental Model

`SINGLE_TABLE` berarti:

> “Semua subclass dalam satu hierarchy disimpan dalam satu table besar. Satu discriminator column menentukan row ini milik subtype apa.”

Contoh:

```java
@Entity
@Table(name = "CASE_ACTION")
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "ACTION_TYPE", discriminatorType = DiscriminatorType.STRING)
public abstract class CaseAction {

    @Id
    @Column(name = "ID")
    private Long id;

    @Column(name = "CASE_ID", nullable = false)
    private Long caseId;

    @Column(name = "PERFORMED_BY", nullable = false)
    private String performedBy;

    @Column(name = "PERFORMED_AT", nullable = false)
    private Instant performedAt;
}

@Entity
@DiscriminatorValue("APPROVAL")
public class ApprovalAction extends CaseAction {

    @Column(name = "APPROVAL_LEVEL")
    private String approvalLevel;
}

@Entity
@DiscriminatorValue("REJECTION")
public class RejectionAction extends CaseAction {

    @Column(name = "REJECTION_REASON")
    private String rejectionReason;
}

@Entity
@DiscriminatorValue("ESCALATION")
public class EscalationAction extends CaseAction {

    @Column(name = "ESCALATION_QUEUE")
    private String escalationQueue;
}
```

Relational shape:

```text
CASE_ACTION
- ID
- ACTION_TYPE
- CASE_ID
- PERFORMED_BY
- PERFORMED_AT
- APPROVAL_LEVEL
- REJECTION_REASON
- ESCALATION_QUEUE
```

Rows:

```text
ID | ACTION_TYPE | CASE_ID | APPROVAL_LEVEL | REJECTION_REASON | ESCALATION_QUEUE
1  | APPROVAL    | 100     | L2             | NULL             | NULL
2  | REJECTION   | 100     | NULL           | Missing document | NULL
3  | ESCALATION  | 101     | NULL           | NULL             | LEGAL_REVIEW
```

## 6.2 SQL Behavior

Query base type:

```java
select a from CaseAction a where a.caseId = :caseId
```

Typical SQL:

```sql
select
    ca.id,
    ca.action_type,
    ca.case_id,
    ca.performed_by,
    ca.performed_at,
    ca.approval_level,
    ca.rejection_reason,
    ca.escalation_queue
from case_action ca
where ca.case_id = ?
```

Query subclass:

```java
select a from ApprovalAction a where a.caseId = :caseId
```

Typical SQL:

```sql
select
    ca.id,
    ca.action_type,
    ca.case_id,
    ca.performed_by,
    ca.performed_at,
    ca.approval_level
from case_action ca
where ca.action_type = 'APPROVAL'
  and ca.case_id = ?
```

## 6.3 Strengths

`SINGLE_TABLE` biasanya paling cepat untuk polymorphic read karena:

- tidak perlu join untuk load satu entity,
- base query sederhana,
- subclass query cukup filter discriminator,
- relationship ke base type mudah,
- ID space tunggal,
- insert satu row,
- update satu table.

Cocok untuk:

- subtype sedikit,
- subtype field tidak terlalu banyak,
- subtype relatif stabil,
- query sering polymorphic,
- performance read penting,
- lifecycle semua subtype mirip,
- null column masih acceptable.

## 6.4 Weaknesses

Masalah utama `SINGLE_TABLE`:

### 6.4.1 Sparse table

Semakin banyak subtype, table semakin melebar:

```text
CASE_ACTION
- common columns
- approval columns
- rejection columns
- escalation columns
- suspension columns
- reinstatement columns
- inspection columns
- legal columns
- payment columns
- document columns
...
```

Banyak column hanya relevan untuk subtype tertentu.

### 6.4.2 Subclass-specific NOT NULL sulit

Misal `ApprovalAction.approvalLevel` wajib.

Secara Java:

```java
@Column(name = "APPROVAL_LEVEL", nullable = false)
private String approvalLevel;
```

Tapi dalam single table, row `REJECTION` tidak punya `APPROVAL_LEVEL`. Jika database column dibuat `NOT NULL`, subtype lain tidak bisa insert.

Akibatnya provider/schema biasanya perlu membuat nullable, lalu validasi wajib dilakukan di:

- Bean Validation,
- application logic,
- database check constraint berbasis discriminator,
- trigger,
- generated constraint.

Contoh check constraint:

```sql
alter table case_action add constraint chk_approval_action
check (
    action_type <> 'APPROVAL'
    or approval_level is not null
);
```

Ini valid, tetapi tidak otomatis portable di semua database/migration tool.

### 6.4.3 Domain drift membuat table menjadi dumping ground

Jika setiap subtype baru menambah 5-10 column, table bisa berubah menjadi “god table”.

### 6.4.4 Security/reporting confusion

Analyst yang membaca table langsung harus memahami bahwa column tertentu hanya berlaku untuk type tertentu.

### 6.4.5 Partial index complexity

Untuk performance, kamu mungkin butuh index seperti:

```sql
create index idx_case_action_approval_case
on case_action(case_id, performed_at)
where action_type = 'APPROVAL';
```

Ini sangat database-specific. Oracle, PostgreSQL, SQL Server, MySQL punya kemampuan dan syntax berbeda.

## 6.5 Failure Modes

### Failure Mode 1 — Constraint tidak bisa diekspresikan dengan sederhana

Gejala:

- subclass field wajib tapi database menerima null.
- data corrupt masuk lewat batch/import/native SQL.

Root cause:

- single table membuat subclass-specific required field tidak bisa pakai plain `NOT NULL`.

Fix:

- check constraint by discriminator,
- application validation,
- import validation,
- dedicated detail table jika constraint makin kompleks.

### Failure Mode 2 — Query lambat karena table melebar

Gejala:

- query base sering scan table besar.
- banyak column ikut di-select.
- memory hydration besar.

Root cause:

- wide sparse table,
- over-select,
- entity query padahal projection cukup.

Fix:

- DTO projection,
- index sesuai access pattern,
- vertical split,
- `JOINED` atau composition untuk field berat,
- LOB/detail dipisah.

### Failure Mode 3 — Discriminator value berubah sembarangan

Gejala:

- row lama tidak bisa dimaterialize.
- provider gagal menentukan subtype.
- data terlihat “hilang” dari subclass query.

Root cause:

- discriminator value dianggap label biasa padahal bagian dari persistence contract.

Fix:

- treat discriminator as stable API,
- migration script eksplisit,
- jangan rename tanpa backfill.

## 6.6 Design Rule

Pilih `SINGLE_TABLE` jika:

```text
Polymorphic query sering
+ subtype relatif sedikit
+ field subtype tidak terlalu banyak
+ constraint subtype masih bisa dikendalikan
+ performance read lebih penting daripada schema purity
```

Hindari jika:

```text
Subtype banyak
+ field subtype sangat berbeda
+ constraint per subtype sangat ketat
+ table akan melebar ekstrem
+ domain sering berubah
```

---

# 7. `JOINED`

## 7.1 Mental Model

`JOINED` berarti:

> “Common fields disimpan di base table. Subclass-specific fields disimpan di subclass table. Satu entity subclass direkonstruksi dengan join antara base table dan subclass table.”

Contoh:

```java
@Entity
@Table(name = "CASE_ACTION")
@Inheritance(strategy = InheritanceType.JOINED)
@DiscriminatorColumn(name = "ACTION_TYPE")
public abstract class CaseAction {

    @Id
    @Column(name = "ID")
    private Long id;

    @Column(name = "CASE_ID", nullable = false)
    private Long caseId;

    @Column(name = "PERFORMED_BY", nullable = false)
    private String performedBy;

    @Column(name = "PERFORMED_AT", nullable = false)
    private Instant performedAt;
}

@Entity
@Table(name = "APPROVAL_ACTION")
@DiscriminatorValue("APPROVAL")
public class ApprovalAction extends CaseAction {

    @Column(name = "APPROVAL_LEVEL", nullable = false)
    private String approvalLevel;
}

@Entity
@Table(name = "REJECTION_ACTION")
@DiscriminatorValue("REJECTION")
public class RejectionAction extends CaseAction {

    @Column(name = "REJECTION_REASON", nullable = false)
    private String rejectionReason;
}
```

Relational shape:

```text
CASE_ACTION
- ID
- ACTION_TYPE
- CASE_ID
- PERFORMED_BY
- PERFORMED_AT

APPROVAL_ACTION
- ID
- APPROVAL_LEVEL

REJECTION_ACTION
- ID
- REJECTION_REASON
```

`APPROVAL_ACTION.ID` adalah primary key sekaligus foreign key ke `CASE_ACTION.ID`.

## 7.2 SQL Behavior

Insert `ApprovalAction` biasanya menjadi dua insert:

```sql
insert into case_action
    (id, action_type, case_id, performed_by, performed_at)
values
    (?, 'APPROVAL', ?, ?, ?);

insert into approval_action
    (id, approval_level)
values
    (?, ?);
```

Load subclass:

```java
find(ApprovalAction.class, id)
```

Typical SQL:

```sql
select
    ca.id,
    ca.case_id,
    ca.performed_by,
    ca.performed_at,
    aa.approval_level
from case_action ca
join approval_action aa on aa.id = ca.id
where ca.id = ?
```

Query base polymorphic:

```java
select a from CaseAction a where a.caseId = :caseId
```

Provider may generate joins to subclass tables, or use discriminator/type resolution strategy depending on provider and query shape:

```sql
select
    ca.id,
    ca.action_type,
    ca.case_id,
    ca.performed_by,
    ca.performed_at,
    aa.approval_level,
    ra.rejection_reason
from case_action ca
left join approval_action aa on aa.id = ca.id
left join rejection_action ra on ra.id = ca.id
where ca.case_id = ?
```

## 7.3 Strengths

`JOINED` memberikan schema yang lebih normalized:

- common fields di base table,
- subclass fields di table masing-masing,
- subclass-specific `NOT NULL` lebih mudah,
- table tidak sparse,
- subtype bisa berkembang tanpa menambah banyak nullable column di base table,
- lebih baik untuk domain yang subtype-nya punya banyak field berbeda.

Cocok untuk:

- subtype punya data berbeda signifikan,
- constraint per subtype penting,
- schema readability penting,
- subtype table sering diakses secara spesifik,
- common query terhadap base hanya butuh common fields.

## 7.4 Weaknesses

### 7.4.1 Join cost

Load subclass butuh join. Polymorphic base query bisa butuh left join ke banyak subclass table.

Jika hierarchy punya 10 subtype, base query bisa menghasilkan:

```sql
from base b
left join subtype_a a on a.id = b.id
left join subtype_b b2 on b2.id = b.id
left join subtype_c c on c.id = b.id
...
```

Ini bisa mahal.

### 7.4.2 Insert/delete lebih kompleks

Insert subclass minimal dua table. Delete juga harus memperhatikan order.

### 7.4.3 Locking lebih kompleks

Pessimistic lock terhadap subclass bisa mengunci base dan subclass table. SQL lock behavior tergantung database/provider.

### 7.4.4 Query planner sensitivity

Polymorphic query dengan banyak left join bisa sangat sensitif terhadap statistics, indexes, dan predicate placement.

## 7.5 Failure Modes

### Failure Mode 1 — Polymorphic query jadi join monster

Gejala:

- query base type lambat.
- execution plan penuh left join.
- DB CPU tinggi.
- endpoint listing lambat.

Root cause:

- hierarchy besar menggunakan `JOINED`, lalu query base entity sering mengambil polymorphic data.

Fix:

- query projection hanya common fields,
- split read model,
- entity graph hati-hati,
- redesign hierarchy,
- `SINGLE_TABLE` jika read polymorphic dominan,
- composition if subtype rarely needed.

### Failure Mode 2 — Constraint bagus, performance buruk

Gejala:

- schema rapi,
- constraint kuat,
- tetapi screen listing lambat.

Root cause:

- memilih `JOINED` demi normalization, tanpa menghitung read path.

Fix:

- bedakan write model dan read model,
- gunakan denormalized summary table/materialized view,
- projection query,
- cache read-only lookup jika aman.

### Failure Mode 3 — Subclass join gagal karena row tidak lengkap

Gejala:

- base row ada, subclass row hilang.
- provider gagal load subclass.
- data inconsistent.

Root cause:

- manual SQL/import membuat base row tanpa subclass row.
- transaction partially failed outside proper constraint.

Fix:

- FK/PK constraint kuat,
- import via validated pipeline,
- database constraint untuk discriminator/subclass consistency jika memungkinkan,
- repair script.

## 7.6 Design Rule

Pilih `JOINED` jika:

```text
Subtype fields berbeda jelas
+ constraint per subtype penting
+ jumlah subtype tidak terlalu besar
+ query subclass spesifik cukup sering
+ base query tidak selalu butuh semua subtype fields
```

Hindari jika:

```text
Base polymorphic query sangat sering
+ hierarchy punya banyak subtype
+ latency listing sangat penting
+ provider menghasilkan join besar
```

---

# 8. `TABLE_PER_CLASS`

## 8.1 Mental Model

`TABLE_PER_CLASS` berarti:

> “Setiap concrete subclass memiliki table sendiri, dan table itu berisi common fields plus subclass fields. Tidak ada shared base table untuk entity root.”

Contoh:

```java
@Entity
@Inheritance(strategy = InheritanceType.TABLE_PER_CLASS)
public abstract class CaseAction {

    @Id
    private Long id;

    private Long caseId;

    private String performedBy;

    private Instant performedAt;
}

@Entity
@Table(name = "APPROVAL_ACTION")
public class ApprovalAction extends CaseAction {
    private String approvalLevel;
}

@Entity
@Table(name = "REJECTION_ACTION")
public class RejectionAction extends CaseAction {
    private String rejectionReason;
}
```

Relational shape:

```text
APPROVAL_ACTION
- ID
- CASE_ID
- PERFORMED_BY
- PERFORMED_AT
- APPROVAL_LEVEL

REJECTION_ACTION
- ID
- CASE_ID
- PERFORMED_BY
- PERFORMED_AT
- REJECTION_REASON
```

Tidak ada `CASE_ACTION` table.

## 8.2 SQL Behavior

Query subclass sederhana:

```java
select a from ApprovalAction a where a.caseId = :caseId
```

Typical SQL:

```sql
select
    aa.id,
    aa.case_id,
    aa.performed_by,
    aa.performed_at,
    aa.approval_level
from approval_action aa
where aa.case_id = ?
```

Query base polymorphic:

```java
select a from CaseAction a where a.caseId = :caseId
```

Typical SQL menggunakan `UNION` atau `UNION ALL`:

```sql
select
    aa.id,
    aa.case_id,
    aa.performed_by,
    aa.performed_at,
    aa.approval_level,
    null as rejection_reason,
    'APPROVAL' as clazz
from approval_action aa
where aa.case_id = ?

union all

select
    ra.id,
    ra.case_id,
    ra.performed_by,
    ra.performed_at,
    null as approval_level,
    ra.rejection_reason,
    'REJECTION' as clazz
from rejection_action ra
where ra.case_id = ?
```

## 8.3 Strengths

`TABLE_PER_CLASS` cocok ketika:

- subclass benar-benar independen,
- polymorphic query jarang,
- tidak butuh shared base table,
- setiap subtype punya lifecycle/table sendiri,
- subclass table ingin sederhana dan lengkap.

## 8.4 Weaknesses

### 8.4.1 Polymorphic query mahal

Base query perlu `UNION` across subclass tables.

Jika ada 12 subclass, base query bisa menjadi union 12 query.

### 8.4.2 ID generation lebih sulit

Karena tidak ada shared base table, ID uniqueness across hierarchy harus dijaga.

Sequence global sering lebih aman:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_action_seq")
@SequenceGenerator(name = "case_action_seq", sequenceName = "CASE_ACTION_SEQ")
private Long id;
```

Identity column per table bisa bermasalah jika base polymorphic identity harus unik across hierarchy.

### 8.4.3 Common field duplication

Common fields muncul di setiap table. Perubahan common field harus migrate semua table.

### 8.4.4 Relationship ke base type bisa mahal

Jika entity lain punya relationship ke `CaseAction`, provider harus resolve concrete table.

## 8.5 Failure Modes

### Failure Mode 1 — Base query unexpectedly uses union

Gejala:

- query `from CaseAction` lambat.
- SQL sangat panjang.
- pagination sulit.

Root cause:

- `TABLE_PER_CLASS` dengan polymorphic read.

Fix:

- jangan query base type,
- buat explicit union read model,
- gunakan database view/materialized view,
- redesign ke `SINGLE_TABLE`/`JOINED` jika polymorphic read penting.

### Failure Mode 2 — ID collision across subclass

Gejala:

- persistence context identity confusing.
- relationship ke base type salah resolve.
- cache key collision risk jika provider/config buruk.

Root cause:

- ID generated independently per subclass table.

Fix:

- gunakan shared sequence/table generator,
- hindari identity per table untuk base polymorphism.

### Failure Mode 3 — Migration common field melelahkan

Gejala:

- tambah `tenant_id` harus alter 10 table.
- common index harus dibuat di semua table.

Root cause:

- duplicated inherited columns.

Fix:

- migration generator discipline,
- avoid table-per-class untuk hierarchy besar,
- move common query need to separate table/read model.

## 8.6 Design Rule

Pilih `TABLE_PER_CLASS` jika:

```text
Subtype hampir independen
+ polymorphic base query sangat jarang
+ table per subtype lebih natural
+ common field sedikit
```

Hindari jika:

```text
Sering query base type
+ banyak subtype
+ relationship ke base type penting
+ ID uniqueness sulit
+ migration common fields sering
```

---

# 9. `@MappedSuperclass` vs `@Inheritance`

| Pertanyaan | `@MappedSuperclass` | `@Inheritance` |
|---|---|---|
| Base class entity? | Tidak | Ya |
| Base table? | Tidak | Tergantung strategy |
| Bisa query base type? | Tidak | Ya |
| Bisa relationship ke base type? | Tidak | Ya |
| Tujuan utama | Code/mapping reuse | Persistence polymorphism |
| Cocok untuk audit base | Ya | Biasanya tidak perlu |
| Cocok untuk domain subtype | Kadang tidak | Ya, jika polymorphism perlu dipersist |
| Complexity | Rendah | Medium-tinggi |

Rule sederhana:

```text
Jika kamu hanya ingin reuse field: @MappedSuperclass.
Jika kamu ingin query/relationship/lifecycle polymorphic: @Inheritance.
Jika kamu hanya ingin variasi behavior: pertimbangkan composition sebelum inheritance ORM.
```

---

# 10. Discriminator Column

## 10.1 Mental Model

Discriminator column adalah column yang menyatakan concrete subtype dari sebuah row.

```java
@DiscriminatorColumn(
    name = "ACTION_TYPE",
    discriminatorType = DiscriminatorType.STRING,
    length = 50
)
```

```java
@DiscriminatorValue("APPROVAL")
```

## 10.2 Treat Discriminator as Persistence Contract

Discriminator value bukan sekadar string label. Ia bagian dari data contract.

Buruk:

```java
@DiscriminatorValue("ApprovalAction")
```

Kenapa buruk?

Karena class name bisa berubah.

Lebih baik:

```java
@DiscriminatorValue("APPROVAL")
```

atau:

```java
@DiscriminatorValue("CASE_APPROVAL")
```

## 10.3 Discriminator and Domain Type

Kadang kamu juga punya domain enum:

```java
public enum ActionType {
    APPROVAL,
    REJECTION,
    ESCALATION
}
```

Pertanyaan: apakah discriminator column sama dengan domain `actionType` column?

Secara umum, hati-hati.

Discriminator adalah provider metadata. Domain type adalah business data.

Bisa sama secara fisik jika desain matang, tetapi jangan membuat business logic terlalu bergantung pada provider internals.

## 10.4 Failure Modes

### Failure Mode — Rename Class, Data Breaks

Jika provider default discriminator memakai entity name/class name, rename class dapat membuat data lama bermasalah.

Fix:

- selalu set explicit `@DiscriminatorValue`,
- migration script jika value berubah,
- test load data lama.

---

# 11. Polymorphic Query

## 11.1 Mental Model

Query terhadap base entity biasanya polymorphic.

```java
select a from CaseAction a
```

Artinya:

> Ambil semua concrete subtype dari `CaseAction`.

Ini powerful, tetapi mahal tergantung strategy.

## 11.2 SQL by Strategy

### SINGLE_TABLE

```sql
select *
from case_action
```

Simple.

### JOINED

```sql
select *
from case_action ca
left join approval_action aa on aa.id = ca.id
left join rejection_action ra on ra.id = ca.id
left join escalation_action ea on ea.id = ca.id
```

Potentially expensive.

### TABLE_PER_CLASS

```sql
select ... from approval_action
union all
select ... from rejection_action
union all
select ... from escalation_action
```

Potentially expensive.

## 11.3 Type Filtering

JPQL supports type expressions:

```java
select a
from CaseAction a
where type(a) = ApprovalAction
```

Or:

```java
select a
from CaseAction a
where type(a) in (ApprovalAction, RejectionAction)
```

Provider translates based on inheritance strategy.

In `SINGLE_TABLE`, this is discriminator filter.

In `JOINED`, it may filter by discriminator or join existence.

In `TABLE_PER_CLASS`, it may reduce union branches.

## 11.4 Treat Base Query as Potentially Expensive

Rule:

> Every `select root from BaseEntity root` should trigger a performance question.

Ask:

- How many subtypes?
- Which strategy?
- Does screen need subclass fields?
- Is DTO projection enough?
- Is pagination correct?
- Is this listing or detail endpoint?
- Is this query used in batch job?

---

# 12. Inheritance and Associations

## 12.1 Relationship to Base Type

Example:

```java
@Entity
public class CaseTimelineEntry {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ACTION_ID", nullable = false)
    private CaseAction action;
}
```

This means a timeline entry can point to any subtype of `CaseAction`.

This is elegant, but it binds association resolution to inheritance strategy.

## 12.2 Lazy Loading Cost

If association points to base type, provider may need to determine concrete subtype.

Strategy impact:

| Strategy | Resolve subtype cost |
|---|---|
| SINGLE_TABLE | read discriminator from same table |
| JOINED | may need discriminator or subtype table inspection |
| TABLE_PER_CLASS | may need union/subclass lookup |

Hibernate documentation explicitly notes that determining concrete type for proxy may require accessing target table(s), depending on inheritance strategy and association shape.

## 12.3 Association Design Rule

Relationship to base type is acceptable when polymorphism is truly part of domain.

But avoid it when the relationship actually only accepts one subtype.

Bad:

```java
@ManyToOne
private CaseAction approvalAction; // actually must be ApprovalAction
```

Better:

```java
@ManyToOne
private ApprovalAction approvalAction;
```

Or even better, if only ID/reference is needed:

```java
@Column(name = "APPROVAL_ACTION_ID", nullable = false)
private Long approvalActionId;
```

depending on consistency needs.

---

# 13. Inheritance and Constraints

## 13.1 Constraint Expressiveness by Strategy

| Constraint Type | SINGLE_TABLE | JOINED | TABLE_PER_CLASS |
|---|---:|---:|---:|
| Common field NOT NULL | Easy | Easy | Easy but duplicated |
| Subclass field NOT NULL | Hard without conditional check | Easy | Easy |
| Unique common field across hierarchy | Easy | Easy | Harder |
| Unique subclass field per subtype | Possible with filtered index | Easy | Easy |
| FK to base type | Easy | Easy | Harder/provider-dependent |
| Type-specific FK | Conditional complexity | Easy | Easy |

## 13.2 Example: Subtype Required Field

Requirement:

> Approval action must have `approval_level`.

### SINGLE_TABLE

Plain `NOT NULL` impossible if other action types exist.

Need conditional check:

```sql
check (
    action_type <> 'APPROVAL'
    or approval_level is not null
)
```

### JOINED

```sql
approval_action.approval_level not null
```

### TABLE_PER_CLASS

```sql
approval_action.approval_level not null
```

## 13.3 Example: Unique Reference Across All Actions

Requirement:

> Every action has globally unique external reference.

### SINGLE_TABLE

Easy:

```sql
unique(external_reference)
```

### JOINED

Easy if common field in base table:

```sql
case_action.external_reference unique
```

### TABLE_PER_CLASS

Harder because field duplicated across tables. Need global registry table, shared sequence, application check, or database-specific mechanism.

---

# 14. Inheritance and Indexing

## 14.1 SINGLE_TABLE Indexing

Common query:

```sql
where case_id = ?
order by performed_at desc
```

Index:

```sql
create index idx_case_action_case_time
on case_action(case_id, performed_at desc);
```

Subclass query:

```sql
where action_type = 'APPROVAL'
  and case_id = ?
```

Index:

```sql
create index idx_case_action_type_case
on case_action(action_type, case_id);
```

If DB supports filtered/partial index:

```sql
create index idx_case_action_approval_case
on case_action(case_id)
where action_type = 'APPROVAL';
```

## 14.2 JOINED Indexing

Need indexes on:

```text
CASE_ACTION(ID)
CASE_ACTION(CASE_ID, PERFORMED_AT)
APPROVAL_ACTION(ID)
REJECTION_ACTION(ID)
```

Subclass-specific query:

```sql
select ...
from case_action ca
join approval_action aa on aa.id = ca.id
where ca.case_id = ?
  and aa.approval_level = ?
```

Indexes:

```sql
create index idx_case_action_case on case_action(case_id);
create index idx_approval_action_level on approval_action(approval_level);
```

Query planner must choose join order.

## 14.3 TABLE_PER_CLASS Indexing

Every subclass table needs its own common indexes:

```sql
create index idx_approval_action_case_time
on approval_action(case_id, performed_at desc);

create index idx_rejection_action_case_time
on rejection_action(case_id, performed_at desc);
```

Common query pattern duplicated across tables.

## 14.4 Indexing Rule

Inheritance strategy determines where indexes live.

Do not design inheritance without listing top queries.

Minimum checklist:

```text
For each hierarchy:
1. Top 5 read queries.
2. Top 5 write operations.
3. Top 5 listing screens.
4. Top 5 reports/batch jobs.
5. Required uniqueness constraints.
6. Required FK constraints.
7. Expected subtype growth.
```

---

# 15. Provider Behavior: Hibernate

## 15.1 Hibernate Supports Standard Strategies

Hibernate supports standard inheritance strategies:

- single table,
- joined,
- table per class.

It also has provider-specific features and optimizations around discriminator, proxy resolution, SQL generation, fetch plans, and polymorphic queries.

## 15.2 Hibernate and SINGLE_TABLE

Hibernate generally performs well with `SINGLE_TABLE` for polymorphic query.

Common behavior:

- discriminator used to instantiate correct subtype,
- subclass query adds discriminator predicate,
- one physical table,
- simple inserts/updates.

Important risk:

- wide table hydration,
- nullable subclass columns,
- accidental selection of many columns,
- default discriminator value based on entity name if not explicitly configured.

## 15.3 Hibernate and JOINED

Hibernate `JOINED` may produce joins for polymorphic loading. Modern Hibernate SQL generation can be sophisticated, but the relational cost still exists.

Risks:

- left join explosion for base polymorphic query,
- proxy subtype resolution may need extra access,
- pessimistic locking SQL can become complex,
- pagination with joined polymorphic fetch must be tested.

## 15.4 Hibernate and TABLE_PER_CLASS

Hibernate implements table-per-class polymorphism using union-style SQL.

Risks:

- long SQL,
- pagination complexity,
- shared ID generation requirement,
- query plan instability.

## 15.5 Hibernate-Specific Design Warning

Do not assume changing inheritance strategy is a local refactor.

Changing from:

```java
SINGLE_TABLE
```

to:

```java
JOINED
```

is a database migration project.

It changes:

- table shape,
- SQL,
- indexes,
- constraints,
- cache regions,
- query plans,
- data migration scripts,
- potentially API behavior if lazy/proxy resolution changes.

---

# 16. Provider Behavior: EclipseLink

## 16.1 EclipseLink Supports Standard JPA Inheritance

EclipseLink supports:

- `SINGLE_TABLE`,
- `JOINED`,
- `TABLE_PER_CLASS`,
- `@MappedSuperclass`.

EclipseLink internally uses descriptors and sessions to map class metadata to table mappings.

## 16.2 EclipseLink and Weaving

EclipseLink often relies on weaving for advanced lazy loading/change tracking behavior.

Inheritance combined with weaving can affect:

- lazy relationships,
- change tracking,
- descriptor initialization,
- classloader behavior,
- static vs dynamic weaving in enterprise container.

## 16.3 EclipseLink Shared Cache Consideration

Inheritance and shared cache must be considered carefully:

- cache identity,
- descriptor type,
- invalidation,
- query cache interaction,
- subtype lookup.

## 16.4 EclipseLink Design Warning

If portability between Hibernate and EclipseLink matters, inheritance is one area where tests must verify actual generated SQL and runtime behavior.

The annotation may be portable. The performance behavior is not necessarily portable.

---

# 17. Java 8–25 Compatibility Notes

## 17.1 Java 8 Era

Typical stack:

```text
Java 8
JPA 2.1 / 2.2
javax.persistence.*
Hibernate 5.x
EclipseLink 2.x
Spring Framework 4/5 or Java EE/Jakarta transition era
```

Characteristics:

- `javax.persistence` namespace,
- Hibernate 5 query/type behavior,
- older dialect classes,
- less modern bytecode/module concerns,
- Java Time support depends on provider/JPA version.

## 17.2 Java 11/17 Era

Typical stack:

```text
Java 11/17
Jakarta Persistence 3.x or JPA 2.2 depending framework
Hibernate 5.6/6.x
EclipseLink 3.x/4.x
Spring Boot 2.x/3.x transition
```

Main concern:

- `javax` to `jakarta` migration,
- provider major version changes,
- dialect/type/query behavior changes.

## 17.3 Java 21/25 Era

Typical modern stack:

```text
Java 21/25
jakarta.persistence.*
Jakarta Persistence 3.1/3.2
Hibernate 6/7
EclipseLink 4.x+
Spring Boot 3.x+
Jakarta EE 10/11 aligned platforms
```

Main concern:

- modern provider behavior,
- bytecode enhancement/weaving compatibility,
- module path/classpath,
- records are not normal mutable JPA entities,
- virtual threads do not remove ORM transaction/connection constraints,
- GC improvements do not fix huge persistence context design.

## 17.4 Important Rule

Java version rarely changes the conceptual inheritance strategy, but it can change:

- provider version,
- namespace,
- bytecode behavior,
- framework integration,
- dialect behavior,
- query generation,
- enhancement/weaving pipeline.

So migration must test generated SQL.

---

# 18. Inheritance vs Composition

## 18.1 The Dangerous Assumption

Many engineers assume:

> “Because the domain says approval/rejection/escalation are types of action, I should model them as subclasses.”

Not always.

Sometimes better:

```java
@Entity
@Table(name = "CASE_ACTION")
public class CaseAction {

    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(name = "ACTION_TYPE", nullable = false)
    private ActionType type;

    @Embedded
    private ApprovalDetail approvalDetail;

    @Embedded
    private RejectionDetail rejectionDetail;

    @Embedded
    private EscalationDetail escalationDetail;
}
```

Or:

```java
@Entity
@Table(name = "CASE_ACTION")
public class CaseAction {
    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    private ActionType type;

    @OneToOne(mappedBy = "action", cascade = CascadeType.ALL, orphanRemoval = true)
    private ApprovalActionDetail approvalDetail;
}
```

Or:

```text
CASE_ACTION
- ID
- CASE_ID
- ACTION_TYPE
- PERFORMED_BY
- PERFORMED_AT

CASE_ACTION_DETAIL
- ACTION_ID
- DETAIL_TYPE
- JSON_PAYLOAD
```

Each has trade-offs.

## 18.2 Composition Benefits

Composition can be better when:

- type affects data but not Java behavior significantly,
- subtype count grows often,
- reporting needs stable flat model,
- workflow state is more important than class hierarchy,
- validation can be expressed by state/type rules,
- UI/API wants explicit command model.

## 18.3 Composition Cost

Composition may lose:

- compile-time subtype-specific methods,
- polymorphic dispatch,
- provider-level subtype query,
- clean Java hierarchy.

But enterprise persistence often values:

- stable schema,
- explicit constraints,
- predictable SQL,
- migration safety,
- reporting clarity.

## 18.4 Decision Rule

Use inheritance for **stable structural polymorphism**.

Use composition/type/state modeling for **workflow variability**.

---

# 19. Inheritance and Workflow/State Machines

This is important for regulatory/case-management systems.

A common mistake:

```java
abstract class CaseState {}
class DraftCaseState extends CaseState {}
class SubmittedCaseState extends CaseState {}
class UnderReviewCaseState extends CaseState {}
class ApprovedCaseState extends CaseState {}
class RejectedCaseState extends CaseState {}
```

Then map state as inheritance.

Usually this is wrong.

State machine state is not necessarily entity subtype.

Better:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @Id
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(name = "STATUS", nullable = false)
    private CaseStatus status;

    public void submit(UserId actor) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        status = CaseStatus.SUBMITTED;
    }
}
```

And persist history separately:

```java
@Entity
@Table(name = "CASE_STATUS_HISTORY")
public class CaseStatusHistory {

    @Id
    private Long id;

    @Column(name = "CASE_ID", nullable = false)
    private Long caseId;

    @Enumerated(EnumType.STRING)
    @Column(name = "FROM_STATUS")
    private CaseStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "TO_STATUS", nullable = false)
    private CaseStatus toStatus;

    @Column(name = "CHANGED_BY", nullable = false)
    private String changedBy;

    @Column(name = "CHANGED_AT", nullable = false)
    private Instant changedAt;
}
```

Use inheritance only if each state genuinely has different persistent structure and lifecycle.

---

# 20. Inheritance and Auditability

Inheritance can make audit harder or easier depending on shape.

## 20.1 SINGLE_TABLE Audit

Pros:

- one table to audit,
- one set of triggers/history table possible,
- easy chronological timeline.

Cons:

- many irrelevant null columns,
- subtype-specific changes harder to interpret,
- conditional validation needed.

## 20.2 JOINED Audit

Pros:

- common audit at base,
- subtype audit detail separated,
- constraints cleaner.

Cons:

- reconstructing full audit snapshot requires joining base history and subtype history,
- delete/update across tables must be captured consistently.

## 20.3 TABLE_PER_CLASS Audit

Pros:

- per-subtype audit straightforward.

Cons:

- global timeline requires union,
- common audit queries duplicated,
- cross-type reporting harder.

## 20.4 Regulatory Design Rule

For regulatory systems, ask:

```text
Will investigators/auditors ask for one chronological timeline across all action types?
```

If yes, avoid a design that makes global timeline require complex union unless there is a dedicated read/audit model.

---

# 21. Inheritance and Soft Delete

Soft delete often interacts badly with inheritance.

Example:

```java
@Column(name = "DELETED", nullable = false)
private boolean deleted;
```

## 21.1 SINGLE_TABLE

Soft delete field in one table. Simple.

```sql
where deleted = false
```

## 21.2 JOINED

Soft delete usually belongs to base table.

But subclass query joins base table and must include filter.

## 21.3 TABLE_PER_CLASS

Soft delete field duplicated in every subclass table.

## 21.4 Failure Mode

If using provider-specific filter:

```java
@Where(clause = "DELETED = false")
```

or equivalent filter, remember:

- native query may bypass it,
- bulk update/delete may bypass lifecycle rules,
- reporting may need deleted rows,
- admin screens may need explicit inclusion.

Inheritance increases the chance that one subtype path forgets the filter.

---

# 22. Inheritance and Caching

## 22.1 First-Level Cache

Persistence context identity is based on entity identity.

Inheritance adds subtype resolution:

```java
CaseAction action = em.find(CaseAction.class, id);
```

Provider must return correct concrete type:

```java
action instanceof ApprovalAction
```

## 22.2 Second-Level Cache

Second-level cache configuration may differ by provider and hierarchy.

Questions:

- Is cache configured on base class?
- Are subclasses cached separately?
- Are polymorphic queries cached?
- Does discriminator/type affect cache key?
- Can tenant/soft delete filters leak cached entities?

## 22.3 Cache Design Rule

Do not enable cache on inheritance hierarchy until you know:

```text
1. Which entities are mutable?
2. Which subtype changes frequently?
3. Are reads mostly by ID or polymorphic query?
4. Are filters involved?
5. Is data tenant-scoped?
6. How does provider cache subclass metadata?
```

---

# 23. Inheritance and DTO Projection

Sometimes the best way to query hierarchy is not entity loading.

Example listing screen:

```text
Case Timeline
- performedAt
- performedBy
- actionType
- summary
```

Do not load full subtype entities if screen only needs summary.

Use DTO projection:

```java
public record CaseActionSummary(
    Long id,
    String actionType,
    Instant performedAt,
    String performedBy,
    String summary
) {}
```

Query for `SINGLE_TABLE`:

```java
select new com.example.CaseActionSummary(
    a.id,
    type(a),
    a.performedAt,
    a.performedBy,
    case
        when type(a) = ApprovalAction then 'Approval'
        when type(a) = RejectionAction then 'Rejection'
        else 'Action'
    end
)
from CaseAction a
where a.caseId = :caseId
order by a.performedAt desc
```

But JPQL support for complex `case type()` expressions may vary; native SQL/projection query may be simpler for high-value listing screens.

Design rule:

> Entity inheritance is for write/lifecycle consistency. Listing/reporting often deserves separate projection/read model.

---

# 24. Anti-Patterns

## 24.1 Using inheritance because Java makes it look clean

Bad reason:

> “These classes share fields, so they should extend a base entity.”

Better:

- use `@MappedSuperclass`,
- use embeddable,
- use composition,
- use interface not mapped by JPA.

## 24.2 Deep entity hierarchy

Bad:

```text
RegulatoryObject
  └── CaseObject
      └── ReviewableObject
          └── AssignableObject
              └── ApprovalObject
                  └── SeniorApprovalObject
```

Deep hierarchy causes:

- metadata complexity,
- confusing query behavior,
- migration pain,
- unclear aggregate boundary,
- fragile business logic.

## 24.3 Inheritance for workflow statuses

Avoid mapping every status as subclass unless persistent structure truly differs.

Use state machine/status enum/history table instead.

## 24.4 `TABLE_PER_CLASS` with frequent base query

This creates union-heavy SQL.

## 24.5 `JOINED` with many subtype listing queries

This creates join-heavy SQL.

## 24.6 `SINGLE_TABLE` with too many unrelated subtype fields

This creates sparse god table.

## 24.7 No explicit discriminator value

Class/entity rename can become data migration bug.

## 24.8 Subclass-specific constraint only in Java validation

If data can enter via native SQL/import/batch, database must protect invariants too.

---

# 25. Decision Framework

Use this decision tree.

## Step 1 — Is base class just technical reuse?

Examples:

- ID,
- audit fields,
- version,
- tenant ID,
- created/updated metadata.

Use:

```text
@MappedSuperclass
```

## Step 2 — Do you need to query by base type?

Example:

```java
select a from CaseAction a
```

If no, avoid ORM inheritance or use `@MappedSuperclass`.

## Step 3 — Do relationships point to base type?

Example:

```java
@ManyToOne
private CaseAction action;
```

If yes, inheritance may be justified.

## Step 4 — Are subtype fields few and stable?

If yes:

```text
SINGLE_TABLE likely good
```

## Step 5 — Are subtype fields many and constraints important?

If yes:

```text
JOINED likely better
```

## Step 6 — Are subtypes independent and base query rare?

If yes:

```text
TABLE_PER_CLASS possible, but still test union behavior
```

## Step 7 — Is this actually workflow/state variability?

If yes:

```text
Use status/state machine + history, not ORM inheritance
```

---

# 26. Strategy Comparison Matrix

| Dimension | `@MappedSuperclass` | `SINGLE_TABLE` | `JOINED` | `TABLE_PER_CLASS` |
|---|---:|---:|---:|---:|
| Base query | No | Excellent | Medium/expensive | Often expensive |
| Subclass query | Normal | Fast with discriminator | Join required | Fast per table |
| Insert subclass | One table | One table | Multiple tables | One table |
| Schema normalization | N/A | Low | High | Medium |
| Sparse columns | No | Yes | No | No |
| Common fields duplicated | Yes | No | No | Yes |
| Subclass NOT NULL | Easy | Hard | Easy | Easy |
| Relationship to base | No | Easy | Easy | Harder |
| Polymorphic performance | N/A | Best | Depends | Often worst |
| Migration complexity | Low | Medium | High | High |
| Good for audit timeline | N/A | Good | Medium | Needs union/read model |
| Good for many subtypes | N/A | Poor if fields differ | Poor if queried polymorphically | Poor if base query needed |

---

# 27. Concrete Example: Case Management Action Model

Suppose domain:

- `ApprovalAction`,
- `RejectionAction`,
- `EscalationAction`,
- `DocumentRequestAction`,
- `ComplianceFlagAction`,
- `ManualNoteAction`.

Common fields:

```text
id
case_id
performed_by
performed_at
source_channel
comment
```

Subtype fields:

```text
ApprovalAction:
- approval_level
- approver_role

RejectionAction:
- rejection_reason_code
- free_text_reason

EscalationAction:
- from_queue
- to_queue
- escalation_sla

DocumentRequestAction:
- document_type
- due_date

ComplianceFlagAction:
- rule_code
- risk_score

ManualNoteAction:
- note_text
```

## Option A — SINGLE_TABLE

Good if:

- timeline screen reads all action types often,
- subtype fields are limited,
- table width acceptable,
- conditional constraints manageable.

Table:

```text
CASE_ACTION
- ID
- ACTION_TYPE
- CASE_ID
- PERFORMED_BY
- PERFORMED_AT
- SOURCE_CHANNEL
- COMMENT
- APPROVAL_LEVEL
- APPROVER_ROLE
- REJECTION_REASON_CODE
- FREE_TEXT_REASON
- FROM_QUEUE
- TO_QUEUE
- ESCALATION_SLA
- DOCUMENT_TYPE
- DUE_DATE
- RULE_CODE
- RISK_SCORE
- NOTE_TEXT
```

## Option B — JOINED

Good if:

- subtype constraints are important,
- fields grow per subtype,
- write correctness matters,
- timeline query can use projection/base fields.

Tables:

```text
CASE_ACTION
APPROVAL_ACTION
REJECTION_ACTION
ESCALATION_ACTION
DOCUMENT_REQUEST_ACTION
COMPLIANCE_FLAG_ACTION
MANUAL_NOTE_ACTION
```

Potential problem:

- full polymorphic entity load for timeline can be expensive.

Solution:

- timeline uses `CASE_ACTION` base fields plus summary column,
- detail screen loads specific subtype.

## Option C — Composition + Type

Maybe best:

```text
CASE_ACTION
- ID
- ACTION_TYPE
- CASE_ID
- PERFORMED_BY
- PERFORMED_AT
- SUMMARY

CASE_ACTION_DETAIL
- ACTION_ID
- DETAIL_TYPE
- DETAIL_JSON
```

or typed detail tables without JPA inheritance.

Good if:

- timeline/reporting matters more than polymorphic Java behavior,
- action types evolve frequently,
- external integrations add fields often,
- audit/read model is primary.

Top 1% reasoning:

> The best model is not the one that makes Java hierarchy pretty. The best model is the one whose invariants, queries, migrations, and audit needs remain understandable after 5 years of domain change.

---

# 28. Production Diagnostic Checklist

When you see inheritance hierarchy in a codebase, inspect:

## 28.1 Mapping

```text
[ ] Which strategy is used?
[ ] Is there explicit @DiscriminatorValue?
[ ] Is the root abstract or concrete?
[ ] Are subclasses entities or mapped superclasses?
[ ] Are there deep inheritance levels?
```

## 28.2 SQL

```text
[ ] What SQL is generated for find by ID?
[ ] What SQL is generated for base query?
[ ] What SQL is generated for subclass query?
[ ] Does base query use joins or union?
[ ] Does pagination behave correctly?
```

## 28.3 Constraints

```text
[ ] Are subclass required fields enforced in DB?
[ ] Are discriminator values constrained?
[ ] Are unique constraints correct across hierarchy?
[ ] Are FK constraints complete?
```

## 28.4 Indexes

```text
[ ] Are indexes aligned with discriminator/type filters?
[ ] Are subclass tables indexed on FK/PK?
[ ] Are common query indexes duplicated where needed?
[ ] Are statistics updated?
```

## 28.5 Performance

```text
[ ] How many subtypes exist?
[ ] How often are base queries executed?
[ ] How many rows does each table have?
[ ] Are listing screens loading full entity graph?
[ ] Are DTO projections used where appropriate?
```

## 28.6 Evolution

```text
[ ] How often are new subtypes added?
[ ] Do migrations become harder over time?
[ ] Is table becoming sparse/god table?
[ ] Are common fields duplicated across many tables?
```

---

# 29. Migration Considerations

Changing inheritance strategy is high risk.

## 29.1 SINGLE_TABLE to JOINED

Need:

1. Create subclass tables.
2. Backfill subclass rows by discriminator.
3. Add FK/PK constraints.
4. Move subtype columns.
5. Update indexes.
6. Deploy code reading new structure.
7. Remove old columns later.

Risk:

- downtime,
- dual-write complexity,
- data mismatch,
- rollback complexity.

## 29.2 JOINED to SINGLE_TABLE

Need:

1. Add subtype columns to base table.
2. Backfill from subclass tables.
3. Add discriminator/validate values.
4. Adjust constraints with conditional checks.
5. Update queries/indexes.
6. Drop subclass tables later.

Risk:

- wide table,
- constraint regression,
- old code/new code incompatibility.

## 29.3 TABLE_PER_CLASS to Shared Hierarchy

Usually hardest.

Need:

- global ID reconciliation,
- union data migration,
- reference repair,
- common base table creation,
- duplicate common field handling.

## 29.4 Migration Rule

Do not migrate inheritance strategy and business behavior in one release.

Separate:

```text
Release A: prepare schema/read compatibility
Release B: dual-read or dual-write if needed
Release C: switch ORM mapping
Release D: cleanup old schema
```

---

# 30. Testing Inheritance Mapping

Minimum tests:

## 30.1 Persist and Load Each Subtype

```java
@Test
void persistAndLoadApprovalAction() {
    ApprovalAction action = new ApprovalAction(...);
    em.persist(action);
    em.flush();
    em.clear();

    CaseAction loaded = em.find(CaseAction.class, action.getId());

    assertThat(loaded).isInstanceOf(ApprovalAction.class);
}
```

## 30.2 Query Base Type

```java
@Test
void queryBaseTypeReturnsAllSubtypes() {
    List<CaseAction> actions = em.createQuery(
        "select a from CaseAction a order by a.performedAt",
        CaseAction.class
    ).getResultList();

    assertThat(actions)
        .extracting(a -> a.getClass().getSimpleName())
        .contains("ApprovalAction", "RejectionAction");
}
```

## 30.3 Query Subclass Type

```java
@Test
void querySubclassTypeFiltersCorrectly() {
    List<ApprovalAction> approvals = em.createQuery(
        "select a from ApprovalAction a",
        ApprovalAction.class
    ).getResultList();

    assertThat(approvals).allMatch(a -> a instanceof ApprovalAction);
}
```

## 30.4 Constraint Test

Test that invalid subtype data is rejected by database, not only Java.

```java
@Test
void approvalActionRequiresApprovalLevel() {
    ApprovalAction action = new ApprovalAction();
    action.setApprovalLevel(null);

    em.persist(action);

    assertThatThrownBy(() -> em.flush())
        .isInstanceOf(PersistenceException.class);
}
```

## 30.5 SQL Shape Test

For critical hierarchy, assert SQL count or inspect generated SQL in integration tests.

Questions:

```text
[ ] Does base query generate one select, joins, or union?
[ ] Does pagination happen in DB?
[ ] Does loading association trigger extra subtype resolution queries?
```

---

# 31. Top 1% Design Heuristics

## 31.1 Prefer boring schema over clever hierarchy

If the database model becomes hard to explain, the Java elegance is probably not worth it.

## 31.2 Use inheritance only for stable polymorphism

Stable polymorphism means:

- subtype list changes rarely,
- subtype meaning is fundamental,
- lifecycle truly shared,
- base queries/relationships are real requirements.

## 31.3 Avoid inheritance for volatile workflow state

Workflow state changes often. Subclass hierarchy changes slowly. Do not confuse them.

## 31.4 Always inspect generated SQL

You have not chosen an inheritance strategy until you have seen:

- insert SQL,
- find by ID SQL,
- subclass query SQL,
- base query SQL,
- paginated query SQL,
- relationship lazy load SQL.

## 31.5 Model read paths explicitly

If UI/reporting needs timeline/listing, design projection/read model. Do not force entity hierarchy to serve every read use case.

## 31.6 Constraints are first-class

A model that cannot enforce core invariants in database is risky for enterprise systems.

## 31.7 Migration cost matters

Choose strategy based on the future shape of the domain, not just current class diagram.

---

# 32. Summary

Inheritance mapping is one of the most deceptive ORM features.

It looks like a clean object-oriented tool, but in persistence engineering it is a major relational design decision.

Key takeaways:

1. `@MappedSuperclass` is for mapping/code reuse, not persistence polymorphism.
2. `SINGLE_TABLE` is usually fastest for polymorphic reads but creates sparse tables and constraint challenges.
3. `JOINED` gives cleaner normalized schema and subtype constraints but can create join-heavy polymorphic queries.
4. `TABLE_PER_CLASS` keeps subtype tables independent but makes base polymorphic queries union-heavy and ID strategy harder.
5. Discriminator values are part of persistence contract and must be explicit/stable.
6. Workflow states should usually be modeled as state/status/history, not subclass hierarchy.
7. Regulatory/case-management systems often need audit timeline and read model clarity more than Java inheritance elegance.
8. Provider behavior matters: Hibernate and EclipseLink support the same annotations, but generated SQL, proxy resolution, cache, and performance behavior must be tested.
9. Changing inheritance strategy later is a real migration project.
10. The strongest engineers choose inheritance only after understanding query shape, constraints, indexes, lifecycle, and evolution pressure.

---

# 33. Practice Scenarios

## Scenario 1 — Audit Base Class

You have 80 entities with `createdAt`, `createdBy`, `updatedAt`, `updatedBy`.

Question:

- Should this be `@MappedSuperclass` or `@Inheritance`?

Likely answer:

- `@MappedSuperclass`, because this is technical field reuse, not domain polymorphism.

## Scenario 2 — Payment Method

You have `CreditCardPayment`, `BankTransferPayment`, `CashPayment`. Business frequently queries all payments in one transaction timeline.

Question:

- Which strategy?

Likely answer:

- `SINGLE_TABLE` if fields are moderate and timeline is dominant.
- `JOINED` if subtype fields are many and constraints are strict.
- Consider read model for timeline if using `JOINED`.

## Scenario 3 — Case Workflow Status

You have statuses: Draft, Submitted, Under Review, Approved, Rejected.

Question:

- Should each status be subclass?

Likely answer:

- Usually no. Use enum/status + transition rules + history table.

## Scenario 4 — Many Independent Report Types

You have 20 report document types. They share title/createdAt but are generated independently. Base query is rare.

Question:

- Is `TABLE_PER_CLASS` acceptable?

Likely answer:

- Possible, but question whether `@MappedSuperclass` plus independent entities is enough. Avoid base polymorphic query if using table-per-class.

## Scenario 5 — Existing `SINGLE_TABLE` God Table

A table has 120 columns, 15 action types, many nulls, and inconsistent subtype constraints.

Question:

- What is a safe path?

Possible answer:

1. Inventory subtype usage.
2. Add conditional check constraints where possible.
3. Add read projections for critical screens.
4. Split heavy/rare subtype fields to detail tables.
5. Consider gradual migration to `JOINED` or composition, not big-bang rewrite.

---

# 34. References

- Jakarta Persistence 3.2 Specification — inheritance, mapped superclass, discriminator, entity hierarchy semantics.
- Jakarta Persistence API documentation — `InheritanceType`, `DiscriminatorColumn`, `MappedSuperclass`, and inheritance-related annotations.
- Hibernate ORM User Guide — inheritance mapping, discriminator behavior, polymorphic queries, proxy/subtype resolution, and SQL behavior.
- EclipseLink documentation — JPA inheritance mappings, descriptors, sessions, weaving, and provider behavior around inheritance.

---

# 35. What Comes Next

Next part:

```text
13-embeddables-value-objects-converters-type-systems.md
```

The next topic moves from entity inheritance to value modeling:

- entity vs value object,
- embeddables,
- nested embeddables,
- converters,
- provider custom types,
- immutable value modeling,
- null handling,
- query binding,
- serialization consistency,
- domain invariants inside values.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — Cascades, Orphan Removal, Lifecycle Propagation, and Aggregate Boundaries](./11-cascades-orphan-removal-lifecycle-aggregate-boundaries.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 13 — Embeddables, Value Objects, Attribute Converters, and Type Systems](./13-embeddables-value-objects-converters-type-systems.md)
