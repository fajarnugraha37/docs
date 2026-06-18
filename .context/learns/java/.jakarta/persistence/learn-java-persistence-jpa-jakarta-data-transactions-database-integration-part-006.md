# Part 006 — Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Bagian: `006 dari 032`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus API: JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-006.md`

---

## 1. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas mapping fundamental: entity, table, column, enum, temporal, LOB, embeddable, converter, default, dan mapping sebagai kontrak terhadap schema. Bagian ini melangkah ke topik yang biasanya menjadi sumber bug terbesar dalam JPA/Hibernate: **relationship mapping**.

Tujuan bagian ini bukan hanya membuat annotation `@ManyToOne`, `@OneToMany`, `@OneToOne`, atau `@ManyToMany` bekerja. Target yang lebih penting adalah memahami:

1. bagaimana hubungan object berbeda dari hubungan relational;
2. mengapa foreign key lebih penting daripada collection di entity;
3. apa arti owning side dan inverse side;
4. mengapa `mappedBy` bukan dekorasi, tetapi penentu siapa pemilik foreign key;
5. kapan relationship perlu bidirectional dan kapan cukup unidirectional;
6. kapan cascade benar dan kapan berbahaya;
7. kapan `orphanRemoval` tepat dan kapan menghasilkan data loss;
8. mengapa many-to-many langsung hampir selalu terlalu dangkal untuk sistem enterprise;
9. bagaimana relationship memengaruhi flush, SQL generation, constraint, delete ordering, fetch, memory, dan transaction;
10. bagaimana mendesain association untuk sistem besar seperti case management, workflow, approval, compliance, document, audit, dan correspondence.

Setelah menyelesaikan part ini, kamu seharusnya bisa melihat relationship mapping bukan sebagai “hubungan antar class”, tetapi sebagai **kontrak perubahan data lintas tabel di dalam transaction boundary**.

---

## 2. Mental Model Utama

### 2.1 Object Reference Tidak Sama Dengan Foreign Key

Di Java, hubungan antar object terlihat seperti ini:

```java
caseFile.getApplicant().getName();
```

Secara mental, seolah-olah `CaseFile` “memiliki” `Applicant` sebagai object reference.

Di database, hubungan itu biasanya hanya berupa nilai kolom:

```sql
CASE_FILE.APPLICANT_ID -> APPLICANT.ID
```

Database tidak menyimpan object graph. Database menyimpan row, column, foreign key, index, constraint, dan transaction log.

JPA/Hibernate menjembatani dua dunia ini:

```text
Java object reference         Relational model
----------------------        ----------------------------
CaseFile.applicant      <->    CASE_FILE.APPLICANT_ID
Applicant.caseFiles     <->    SELECT * FROM CASE_FILE WHERE APPLICANT_ID = ?
```

Masalah muncul ketika engineer memperlakukan dua dunia ini seolah identik.

Contoh asumsi keliru:

```java
applicant.getCaseFiles().add(caseFile);
```

Banyak developer mengira ini otomatis cukup untuk mengubah foreign key di database. Padahal, dalam relationship bidirectional, yang menentukan perubahan foreign key adalah **owning side**, bukan sisi collection inverse.

Jika owning side-nya ada di `CaseFile.applicant`, maka yang harus diubah adalah:

```java
caseFile.setApplicant(applicant);
```

Collection `applicant.getCaseFiles()` hanya menjaga konsistensi object graph di memory.

### 2.2 Relationship Mapping Adalah Mapping Foreign Key, Bukan Mapping Collection

Rule praktis yang sangat penting:

> Dalam relational database, relationship paling nyata adalah foreign key. Di JPA, annotation yang paling dekat dengan foreign key biasanya adalah `@ManyToOne` atau owning `@OneToOne`.

Karena itu, `@ManyToOne` adalah association paling fundamental.

Contoh:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "CASE_FILE_SEQ", allocationSize = 50)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "APPLICANT_ID", nullable = false)
    private Applicant applicant;
}
```

DDL konseptualnya:

```sql
CREATE TABLE CASE_FILE (
    ID           NUMBER PRIMARY KEY,
    APPLICANT_ID NUMBER NOT NULL,
    CONSTRAINT FK_CASE_FILE_APPLICANT
        FOREIGN KEY (APPLICANT_ID)
        REFERENCES APPLICANT(ID)
);
```

`@ManyToOne` di sini bukan sekadar “banyak case file punya satu applicant”. Lebih tepat:

> Row `CASE_FILE` menyimpan foreign key `APPLICANT_ID` yang menunjuk row `APPLICANT`.

### 2.3 Parent/Child Tidak Selalu Sama Dengan Owner/Inverse

Dalam domain language, kita sering berkata:

```text
Applicant memiliki banyak CaseFile.
```

Secara domain, `Applicant` terdengar seperti parent. Tetapi secara database, foreign key disimpan di table `CASE_FILE`. Maka secara JPA, owning side biasanya ada di `CaseFile.applicant`, bukan `Applicant.caseFiles`.

Ini penting:

```java
@Entity
public class Applicant {

    @OneToMany(mappedBy = "applicant")
    private List<CaseFile> caseFiles = new ArrayList<>();
}
```

Sisi `Applicant.caseFiles` adalah inverse side. Ia bukan pemilik foreign key. Ia berkata kepada JPA:

```text
Relasi ini sudah dimiliki oleh field `applicant` di entity CaseFile.
```

Jadi:

```text
Domain parent        : Applicant
Database FK holder   : CASE_FILE.APPLICANT_ID
JPA owning side      : CaseFile.applicant
JPA inverse side     : Applicant.caseFiles
```

### 2.4 Relationship Harus Didesain Berdasarkan Use Case, Bukan ERD Saja

Database ERD mungkin punya banyak relationship. Tetapi tidak semua relationship harus dimapping sebagai object reference dua arah.

Contoh schema:

```text
AGENCY 1 ---- * USER
USER   1 ---- * CASE_FILE
CASE_FILE 1 ---- * CASE_NOTE
CASE_FILE 1 ---- * AUDIT_TRAIL
CASE_FILE * ---- * TAG
```

Tidak berarti semua entity harus punya collection:

```java
Agency.users
User.caseFiles
CaseFile.notes
CaseFile.auditTrails
CaseFile.tags
Tag.caseFiles
```

Mapping seperti ini bisa membuat object graph meledak, query tidak terkendali, serialization loop, dan accidental loading.

Pertanyaan desain yang lebih baik:

1. Dari use case mana association ini perlu dinavigasi?
2. Apakah collection bisa besar?
3. Apakah child lifecycle bergantung pada parent?
4. Apakah association perlu cascade?
5. Apakah association perlu di-load bersama entity utama?
6. Apakah relationship ini domain invariant atau hanya query/reporting concern?
7. Apakah relationship ini akan diubah melalui aggregate root tertentu?
8. Apakah collection ini cocok dimapping sebagai object collection, atau lebih baik query repository/projection?

---

## 3. Relationship Cardinality di JPA/Jakarta Persistence

JPA/Jakarta Persistence menyediakan empat annotation relationship utama:

```java
@OneToOne
@OneToMany
@ManyToOne
@ManyToMany
```

Secara sederhana:

| Annotation | Java Shape | Relational Shape Umum | Catatan |
|---|---|---|---|
| `@ManyToOne` | single reference | FK di table current entity | Association paling umum dan paling stabil |
| `@OneToMany` | collection | FK di table child atau join table | Biasanya inverse dari `@ManyToOne` |
| `@OneToOne` | single reference | unique FK atau shared PK | Sering disalahgunakan |
| `@ManyToMany` | collection ke collection | join table | Sering lebih baik dijadikan association entity |

Secara desain, urutan prioritas mental model adalah:

```text
1. Tentukan foreign key di database.
2. Tentukan siapa owning side di JPA.
3. Tentukan apakah butuh navigasi balik.
4. Tentukan lifecycle/cascade.
5. Tentukan fetch strategy.
6. Tentukan helper method agar object graph konsisten.
7. Tentukan constraint dan index.
```

Bukan:

```text
1. Tambahkan collection di semua entity.
2. Tambahkan cascade ALL agar gampang save.
3. Tambahkan EAGER agar tidak LazyInitializationException.
4. Tambahkan JSON ignore kalau serialization loop.
```

Pendekatan kedua adalah jalan cepat menuju persistence layer yang rapuh.

---

## 4. Owning Side dan Inverse Side

### 4.1 Apa Itu Owning Side?

Owning side adalah sisi relationship yang menentukan perubahan foreign key atau join table.

Untuk relationship yang memakai foreign key di salah satu table:

```text
Owning side = entity yang punya @JoinColumn terhadap FK tersebut
```

Contoh:

```java
@Entity
public class CaseFile {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "APPLICANT_ID", nullable = false)
    private Applicant applicant;
}
```

`CaseFile.applicant` adalah owning side karena ia memetakan `CASE_FILE.APPLICANT_ID`.

Sisi inverse:

```java
@Entity
public class Applicant {

    @OneToMany(mappedBy = "applicant")
    private List<CaseFile> caseFiles = new ArrayList<>();
}
```

`Applicant.caseFiles` adalah inverse side karena memakai `mappedBy`.

### 4.2 Apa Itu `mappedBy`?

`mappedBy` berarti:

```text
Jangan buat foreign key/join table baru dari sisi ini.
Relasi ini sudah dimiliki oleh field yang disebut di mappedBy.
```

Contoh:

```java
@OneToMany(mappedBy = "applicant")
private List<CaseFile> caseFiles;
```

Artinya:

```text
Relasi Applicant -> CaseFile dimiliki oleh CaseFile.applicant.
```

Kesalahan umum:

```java
@OneToMany
private List<CaseFile> caseFiles;
```

Tanpa `mappedBy`, JPA bisa menganggap ini sebagai unidirectional one-to-many dan membuat join table atau strategi mapping lain, tergantung provider/configuration. Ini sering tidak sesuai dengan schema yang diinginkan.

### 4.3 Rule Praktis Owning Side

Gunakan rule berikut:

```text
Jika ada foreign key di table child, map foreign key itu dengan @ManyToOne pada child.
Jika butuh collection di parent, tambahkan @OneToMany(mappedBy = "...").
```

Contoh ideal untuk parent-child:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @OneToMany(
        mappedBy = "caseFile",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private List<CaseNote> notes = new ArrayList<>();

    public void addNote(CaseNote note) {
        notes.add(note);
        note.setCaseFile(this);
    }

    public void removeNote(CaseNote note) {
        notes.remove(note);
        note.setCaseFile(null);
    }
}

@Entity
@Table(name = "CASE_NOTE")
public class CaseNote {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "CASE_FILE_ID", nullable = false)
    private CaseFile caseFile;

    void setCaseFile(CaseFile caseFile) {
        this.caseFile = caseFile;
    }
}
```

Di sini:

```text
Domain aggregate root : CaseFile
DB FK holder          : CASE_NOTE.CASE_FILE_ID
JPA owning side       : CaseNote.caseFile
JPA inverse side      : CaseFile.notes
Lifecycle owner       : CaseFile, karena cascade + orphanRemoval
```

Owning side dan lifecycle owner bisa berbeda secara konseptual. Foreign key dimiliki child, tetapi lifecycle child bisa dikontrol parent.

---

## 5. `@ManyToOne`: Association Paling Penting

### 5.1 Kapan Menggunakan `@ManyToOne`

Gunakan `@ManyToOne` ketika banyak row entity saat ini menunjuk satu row entity lain.

Contoh:

```text
Many CaseFile -> One Applicant
Many CaseFile -> One Agency
Many CaseFile -> One AssignedOfficer
Many CaseAction -> One CaseFile
Many Document -> One CaseFile
Many Correspondence -> One CaseFile
Many AuditTrail -> One User
```

Mapping:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "AGENCY_ID", nullable = false)
    private Agency agency;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ASSIGNED_OFFICER_ID")
    private User assignedOfficer;
}
```

### 5.2 `optional = false` vs `nullable = false`

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "AGENCY_ID", nullable = false)
private Agency agency;
```

Keduanya tidak identik.

| Setting | Layer | Makna |
|---|---|---|
| `optional = false` | JPA model | Association secara object model wajib ada |
| `nullable = false` | schema generation / mapping metadata | Kolom FK tidak boleh null |
| `NOT NULL` constraint | database | Database benar-benar menolak null |

Untuk sistem production, jangan hanya percaya annotation. Pastikan constraint database benar-benar ada.

### 5.3 Default Fetch `@ManyToOne` dan Masalahnya

Dalam JPA, default fetch untuk `@ManyToOne` adalah `EAGER`. Namun dalam desain modern, hampir selalu lebih aman menulis eksplisit:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
private Agency agency;
```

Kenapa?

Karena `EAGER` membuat entity load menarik association tanpa use case yang jelas. Dalam sistem besar, ini menyebabkan:

1. query tambahan yang tidak terlihat;
2. join yang tidak diinginkan;
3. graph loading membesar;
4. serialization tidak terkendali;
5. performance sulit diprediksi;
6. sulit diubah karena fetch eager menjadi bagian dari mapping global.

Rule praktis:

```text
Default-kan mental model ke LAZY.
Tentukan fetch plan di query/use case, bukan di entity mapping global.
```

### 5.4 Referencing Entity by Id Tanpa Load

Sering kita hanya ingin menyimpan FK ke existing parent.

Naive:

```java
Agency agency = entityManager.find(Agency.class, agencyId);
caseFile.setAgency(agency);
```

Jika tidak perlu membaca data agency, bisa memakai reference/proxy:

```java
Agency agencyRef = entityManager.getReference(Agency.class, agencyId);
caseFile.setAgency(agencyRef);
```

Atau di Spring Data JPA:

```java
Agency agencyRef = agencyRepository.getReferenceById(agencyId);
caseFile.setAgency(agencyRef);
```

Manfaat:

- menghindari SELECT yang tidak perlu;
- tetap menjaga type-safe association;
- foreign key akan diset saat insert/update.

Risiko:

- jika id tidak ada, error mungkin baru muncul saat proxy diakses atau saat flush karena FK constraint;
- error handling harus tetap jelas.

### 5.5 Jangan Cascade dari Child ke Parent Secara Sembarangan

Contoh berbahaya:

```java
@ManyToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL)
@JoinColumn(name = "AGENCY_ID")
private Agency agency;
```

Ini biasanya salah. Jika menyimpan `CaseFile`, tidak seharusnya otomatis menyimpan/update/delete `Agency`.

Rule praktis:

```text
Jangan letakkan CascadeType.REMOVE atau CascadeType.ALL pada @ManyToOne ke reference/master data/shared parent.
```

Contoh yang biasanya tidak boleh cascade remove:

```text
CaseFile -> Agency
CaseFile -> User
CaseFile -> StatusLookup
CaseFile -> Country
Document -> UploadedBy
AuditTrail -> ActorUser
Payment -> Currency
```

Kenapa?

Karena parent/reference itu shared oleh banyak entity. Menghapus child tidak boleh menghapus parent.

### 5.6 FK Index Wajib Dipikirkan

Setiap foreign key yang sering dipakai join/filter harus punya index.

Contoh:

```sql
CREATE INDEX IDX_CASE_FILE_AGENCY_ID
ON CASE_FILE (AGENCY_ID);

CREATE INDEX IDX_CASE_FILE_ASSIGNED_OFFICER_ID
ON CASE_FILE (ASSIGNED_OFFICER_ID);
```

Tanpa index, query seperti ini bisa berat:

```sql
SELECT *
FROM CASE_FILE
WHERE AGENCY_ID = ?;
```

Selain query, FK index juga membantu delete/update parent karena database perlu mengecek child rows.

---

## 6. `@OneToMany`: Collection Association

### 6.1 Kapan Menggunakan `@OneToMany`

Gunakan `@OneToMany` ketika parent perlu menavigasi collection child sebagai bagian dari use case/domain operation.

Contoh tepat:

```text
CaseFile -> CaseNote
CaseFile -> CaseAttachment metadata
CaseFile -> CaseDecisionReason
Order -> OrderLine
Survey -> SurveyQuestion
Question -> QuestionOption
```

Contoh yang perlu hati-hati:

```text
Agency -> Users
User -> AuditTrails
CaseFile -> AuditTrails
Applicant -> AllCaseFiles
Role -> Users
```

Kenapa hati-hati? Karena collection bisa sangat besar.

Jika collection bisa tumbuh ribuan/jutaan row, jangan jadikan ia collection biasa di aggregate root. Lebih baik gunakan repository/query terpisah:

```java
List<AuditEntryView> findAuditEntriesByCaseFileId(Long caseFileId, PageRequest page);
```

### 6.2 Bidirectional `@OneToMany` + `@ManyToOne`

Mapping paling umum:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @OneToMany(
        mappedBy = "caseFile",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private List<CaseNote> notes = new ArrayList<>();

    public void addNote(String text, User author) {
        CaseNote note = new CaseNote(text, author);
        notes.add(note);
        note.setCaseFile(this);
    }

    public void removeNote(CaseNote note) {
        notes.remove(note);
        note.setCaseFile(null);
    }
}

@Entity
@Table(name = "CASE_NOTE")
public class CaseNote {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "CASE_FILE_ID", nullable = false)
    private CaseFile caseFile;

    protected CaseNote() {
    }

    public CaseNote(String text, User author) {
        this.text = text;
        this.author = author;
    }

    void setCaseFile(CaseFile caseFile) {
        this.caseFile = caseFile;
    }
}
```

Helper method penting agar object graph konsisten di memory.

Tanpa helper:

```java
caseFile.getNotes().add(note);
```

Tetapi `note.caseFile` masih null. Saat flush, foreign key bisa null dan melanggar constraint.

### 6.3 Unidirectional `@OneToMany`

Unidirectional one-to-many terlihat menarik:

```java
@Entity
public class CaseFile {

    @OneToMany(cascade = CascadeType.ALL)
    @JoinColumn(name = "CASE_FILE_ID")
    private List<CaseNote> notes = new ArrayList<>();
}
```

Ini berarti parent `CaseFile` punya collection `CaseNote`, tetapi `CaseNote` tidak punya reference balik ke `CaseFile`.

Bisa valid, tetapi ada trade-off:

- object model lebih sederhana dari sisi child;
- child tidak bisa langsung tahu parent;
- update FK bisa menghasilkan SQL tambahan tergantung provider/generation strategy;
- lebih tidak natural untuk query dari child ke parent;
- untuk model relational, bidirectional mapping sering lebih eksplisit.

Hibernate documentation modern bahkan menyarankan ketika ragu, map foreign key relationship dengan `@ManyToOne` dan `@OneToMany(mappedBy=...)` daripada association mapping yang lebih eksotis.

### 6.4 Collection Initialization

Selalu inisialisasi collection:

```java
private List<CaseNote> notes = new ArrayList<>();
```

Jangan:

```java
private List<CaseNote> notes;
```

Alasannya:

- menghindari `NullPointerException`;
- helper method lebih sederhana;
- entity invariant lebih jelas;
- collection berarti “tidak ada child” sebagai empty collection, bukan null.

Getter sebaiknya tidak memberi akses mutasi bebas jika invariant penting:

```java
public List<CaseNote> getNotes() {
    return Collections.unmodifiableList(notes);
}

public void addNote(CaseNote note) {
    notes.add(note);
    note.setCaseFile(this);
}
```

Namun, untuk JPA, field tetap perlu bisa dimutasi internal oleh provider. Gunakan field access dan constructor protected.

### 6.5 `List`, `Set`, `Bag`, dan Ordering

#### `List`

`List` menjaga urutan di memory. Tetapi urutan database tidak otomatis stabil kecuali ada `@OrderBy` atau `@OrderColumn`.

```java
@OneToMany(mappedBy = "caseFile")
@OrderBy("createdAt ASC")
private List<CaseNote> notes = new ArrayList<>();
```

`@OrderBy` memakai ordering saat query, tidak menyimpan posisi eksplisit.

#### `@OrderColumn`

```java
@OneToMany(mappedBy = "caseFile")
@OrderColumn(name = "DISPLAY_ORDER")
private List<CaseStep> steps = new ArrayList<>();
```

Ini menyimpan posisi list di kolom database. Cocok untuk ordered list yang memang bisa di-reorder oleh user. Tetapi update posisi bisa mahal karena banyak row perlu di-update.

#### `Set`

`Set` menghindari duplicate di memory, tetapi sangat bergantung pada `equals()`/`hashCode()` entity. Jika identity belum stabil, `Set` bisa berperilaku aneh.

Hati-hati dengan entity transient yang belum punya id.

#### Bag

Dalam Hibernate, `List` tanpa order column sering diperlakukan sebagai bag. Multiple bag fetch join bisa bermasalah. Topik detail fetching akan dibahas di Part 007.

### 6.6 Collection Besar: Jangan Dijadikan Object Graph

Contoh buruk:

```java
@Entity
public class CaseFile {

    @OneToMany(mappedBy = "caseFile")
    private List<AuditTrail> auditTrails = new ArrayList<>();
}
```

Jika `AuditTrail` bisa mencapai ratusan ribu row per case, mapping collection ini berbahaya.

Lebih baik:

```java
public interface AuditTrailRepository {
    Page<AuditTrailListView> findByCaseFileId(Long caseFileId, Pageable pageable);
}
```

Mental model:

```text
Tidak semua relationship di database harus menjadi navigable object relationship.
```

---

## 7. `@OneToOne`: Unique Association

### 7.1 Kapan Menggunakan `@OneToOne`

Gunakan `@OneToOne` ketika satu row entity berhubungan dengan maksimal satu row entity lain.

Contoh:

```text
User -> UserProfile
CaseFile -> CaseDecisionSummary
Application -> ApplicationDraftDetail
Document -> DocumentContentMetadata
```

Tetapi `@OneToOne` sering disalahgunakan. Banyak kasus yang terlihat one-to-one hari ini bisa berubah menjadi one-to-many besok.

Contoh:

```text
CaseFile -> Decision
```

Awalnya satu case punya satu decision. Tetapi kemudian requirement berubah:

- draft decision;
- revised decision;
- appeal decision;
- final decision;
- historical decision;
- decision per stage.

Maka sebenarnya lebih aman:

```text
CaseFile 1 ---- * CaseDecision
```

Dengan satu decision aktif/final ditentukan oleh status/constraint.

### 7.2 One-to-One dengan Unique Foreign Key

Contoh:

```java
@Entity
@Table(name = "USER_ACCOUNT")
public class UserAccount {

    @OneToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL, orphanRemoval = true)
    @JoinColumn(name = "PROFILE_ID", unique = true)
    private UserProfile profile;
}
```

DDL konseptual:

```sql
CREATE TABLE USER_ACCOUNT (
    ID NUMBER PRIMARY KEY,
    PROFILE_ID NUMBER UNIQUE,
    CONSTRAINT FK_USER_PROFILE
        FOREIGN KEY (PROFILE_ID)
        REFERENCES USER_PROFILE(ID)
);
```

Ini berarti FK ada di `USER_ACCOUNT`.

Alternatif FK di profile:

```java
@Entity
@Table(name = "USER_PROFILE")
public class UserProfile {

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "USER_ACCOUNT_ID", nullable = false, unique = true)
    private UserAccount userAccount;
}
```

Mana yang lebih baik tergantung lifecycle dan optionality.

### 7.3 Shared Primary Key dengan `@MapsId`

Untuk relationship yang benar-benar lifecycle-nya sama, shared primary key bisa kuat.

```java
@Entity
@Table(name = "USER_ACCOUNT")
public class UserAccount {

    @Id
    private Long id;

    @OneToOne(mappedBy = "userAccount", cascade = CascadeType.ALL, orphanRemoval = true)
    private UserProfile profile;

    public void setProfile(UserProfile profile) {
        this.profile = profile;
        profile.setUserAccount(this);
    }
}

@Entity
@Table(name = "USER_PROFILE")
public class UserProfile {

    @Id
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId
    @JoinColumn(name = "ID")
    private UserAccount userAccount;

    void setUserAccount(UserAccount userAccount) {
        this.userAccount = userAccount;
    }
}
```

DDL konseptual:

```sql
CREATE TABLE USER_ACCOUNT (
    ID NUMBER PRIMARY KEY
);

CREATE TABLE USER_PROFILE (
    ID NUMBER PRIMARY KEY,
    CONSTRAINT FK_PROFILE_ACCOUNT
        FOREIGN KEY (ID)
        REFERENCES USER_ACCOUNT(ID)
);
```

Artinya `USER_PROFILE.ID` sekaligus primary key dan foreign key ke `USER_ACCOUNT.ID`.

Cocok ketika:

- profile tidak bisa ada tanpa user;
- lifecycle profile sepenuhnya mengikuti user;
- tidak butuh id terpisah.

### 7.4 Lazy One-to-One Caveat

`@OneToOne(fetch = FetchType.LAZY)` lebih tricky daripada `@ManyToOne` karena provider perlu tahu apakah row associated ada atau tidak. Beberapa scenario one-to-one lazy memerlukan bytecode enhancement atau struktur mapping tertentu agar benar-benar lazy.

Prinsip desain:

```text
Jangan mengandalkan @OneToOne sebagai optimisasi performa.
Ukur SQL aktual.
Jika data jarang dibutuhkan dan besar, pertimbangkan query/projection eksplisit.
```

### 7.5 One-to-One vs Embeddable

Kadang one-to-one tidak perlu table terpisah.

Jika data selalu dimiliki parent, tidak punya lifecycle sendiri, dan ukurannya kecil, `@Embeddable` bisa lebih sederhana:

```java
@Embeddable
public class ContactInfo {
    private String email;
    private String phone;
}

@Entity
public class Applicant {
    @Embedded
    private ContactInfo contactInfo;
}
```

Gunakan one-to-one table terpisah jika:

- data jarang diakses dan besar;
- security/access control berbeda;
- lifecycle berbeda;
- column terlalu banyak;
- ingin modularisasi schema;
- optional heavy data;
- perlu lock/update terpisah.

---

## 8. `@ManyToMany`: Praktis, Tetapi Sering Terlalu Dangkal

### 8.1 Direct Many-to-Many

Contoh sederhana:

```java
@Entity
@Table(name = "USER_ACCOUNT")
public class UserAccount {

    @ManyToMany
    @JoinTable(
        name = "USER_ROLE",
        joinColumns = @JoinColumn(name = "USER_ID"),
        inverseJoinColumns = @JoinColumn(name = "ROLE_ID")
    )
    private Set<Role> roles = new HashSet<>();
}

@Entity
@Table(name = "ROLE")
public class Role {

    @ManyToMany(mappedBy = "roles")
    private Set<UserAccount> users = new HashSet<>();
}
```

DDL konseptual:

```sql
CREATE TABLE USER_ROLE (
    USER_ID NUMBER NOT NULL,
    ROLE_ID NUMBER NOT NULL,
    PRIMARY KEY (USER_ID, ROLE_ID),
    CONSTRAINT FK_USER_ROLE_USER FOREIGN KEY (USER_ID) REFERENCES USER_ACCOUNT(ID),
    CONSTRAINT FK_USER_ROLE_ROLE FOREIGN KEY (ROLE_ID) REFERENCES ROLE(ID)
);
```

Ini cocok untuk relationship murni tanpa attribute tambahan.

### 8.2 Kenapa Direct Many-to-Many Sering Salah

Dalam sistem enterprise, join table sering butuh metadata:

```text
USER_ROLE
- USER_ID
- ROLE_ID
- ASSIGNED_BY
- ASSIGNED_AT
- REVOKED_BY
- REVOKED_AT
- STATUS
- EFFECTIVE_FROM
- EFFECTIVE_TO
- REASON
- SOURCE_SYSTEM
```

Begitu join table punya attribute, direct `@ManyToMany` tidak cukup. Harus dibuat association entity.

### 8.3 Association Entity Lebih Ekspresif

Daripada:

```java
@ManyToMany
private Set<Role> roles;
```

Gunakan:

```java
@Entity
@Table(
    name = "USER_ROLE_ASSIGNMENT",
    uniqueConstraints = @UniqueConstraint(
        name = "UK_USER_ROLE_ACTIVE",
        columnNames = {"USER_ID", "ROLE_ID", "REVOKED_AT"}
    )
)
public class UserRoleAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_role_assignment_seq")
    @SequenceGenerator(name = "user_role_assignment_seq", sequenceName = "USER_ROLE_ASSIGNMENT_SEQ", allocationSize = 50)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "USER_ID", nullable = false)
    private UserAccount user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ROLE_ID", nullable = false)
    private Role role;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ASSIGNED_BY", nullable = false)
    private UserAccount assignedBy;

    @Column(name = "ASSIGNED_AT", nullable = false)
    private Instant assignedAt;

    @Column(name = "REVOKED_AT")
    private Instant revokedAt;

    @Column(name = "REASON", length = 1000)
    private String reason;

    protected UserRoleAssignment() {
    }

    public UserRoleAssignment(UserAccount user, Role role, UserAccount assignedBy, Instant assignedAt, String reason) {
        this.user = Objects.requireNonNull(user);
        this.role = Objects.requireNonNull(role);
        this.assignedBy = Objects.requireNonNull(assignedBy);
        this.assignedAt = Objects.requireNonNull(assignedAt);
        this.reason = reason;
    }

    public void revoke(Instant revokedAt) {
        if (this.revokedAt != null) {
            throw new IllegalStateException("Role assignment already revoked");
        }
        this.revokedAt = Objects.requireNonNull(revokedAt);
    }
}
```

Lalu di `UserAccount`:

```java
@OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
private Set<UserRoleAssignment> roleAssignments = new HashSet<>();
```

Ini jauh lebih siap untuk:

- audit;
- effective dating;
- revoke;
- approval;
- reason;
- source system;
- regulatory explanation;
- uniqueness rule;
- event publishing;
- historical query.

### 8.4 Direct Many-to-Many Cocok Untuk Apa?

Direct `@ManyToMany` masih bisa cocok jika semua kondisi ini terpenuhi:

1. relationship benar-benar hanya pasangan dua id;
2. tidak ada metadata;
3. tidak perlu audit detail per assignment;
4. tidak perlu status/effective date;
5. tidak perlu approval/reason;
6. collection relatif kecil;
7. relationship bukan pusat domain;
8. tidak ada lifecycle kompleks.

Contoh yang mungkin acceptable:

```text
Article <-> Tag
Product <-> Category kecil
User preference <-> Simple label
```

Tetapi untuk permission, case assignment, officer assignment, document linkage, workflow participant, compliance category, hampir selalu lebih baik association entity.

---

## 9. Cascade: Propagasi Operation, Bukan “Auto Save Magic”

### 9.1 Apa Itu Cascade?

Cascade berarti operasi pada satu entity dipropagasikan ke associated entity.

Jenis cascade utama:

```java
CascadeType.PERSIST
CascadeType.MERGE
CascadeType.REMOVE
CascadeType.REFRESH
CascadeType.DETACH
CascadeType.ALL
```

Contoh:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseNote> notes = new ArrayList<>();
```

Jika `CaseFile` dipersist, note baru ikut dipersist. Jika note dihapus dari collection, note bisa dihapus dari database karena `orphanRemoval = true`.

### 9.2 Cascade Cocok Untuk Composition / Lifecycle Ownership

Cascade cocok ketika child lifecycle benar-benar dimiliki parent.

Contoh bagus:

```text
Order -> OrderLine
Survey -> Question
Question -> Option
CaseFile -> DraftAttachmentMetadata
CaseFile -> CaseDecisionReason
```

Jika parent dihapus, child memang tidak punya makna sendiri.

### 9.3 Cascade Berbahaya Untuk Shared Reference

Contoh buruk:

```java
@ManyToOne(cascade = CascadeType.ALL)
private User assignedOfficer;
```

Risikonya:

- menyimpan `CaseFile` bisa tanpa sengaja merge/update `User`;
- menghapus `CaseFile` bisa mencoba menghapus `User`;
- perubahan object graph detached bisa memengaruhi shared entity;
- bug bisa menjadi data corruption lintas aggregate.

Rule praktis:

```text
Cascade dari parent ke owned child: boleh jika lifecycle child dimiliki parent.
Cascade dari child ke parent/shared reference: hampir selalu jangan.
```

### 9.4 `CascadeType.REMOVE` vs Database `ON DELETE CASCADE`

`CascadeType.REMOVE` adalah cascade di level JPA. Provider akan menjalankan operasi remove terhadap child entity yang diketahui.

`ON DELETE CASCADE` adalah cascade di level database. Database menghapus child row ketika parent row dihapus.

Perbedaannya:

| Aspek | JPA Cascade Remove | DB ON DELETE CASCADE |
|---|---|---|
| Layer | ORM | Database |
| Entity lifecycle callback | Bisa terjadi untuk entity yang dikelola | Tidak lewat JPA callback |
| Persistence context awareness | Ya | Tidak langsung |
| Performance untuk delete besar | Bisa berat | Bisa lebih efisien |
| Audit application-level | Lebih mudah | Perlu DB audit/trigger/CDC |
| Portability | JPA-level | DB-specific DDL |

Jangan mencampur tanpa memahami konsekuensi. Jika database menghapus child tanpa JPA tahu, persistence context bisa stale.

### 9.5 `CascadeType.MERGE` dan Detached Graph Problem

`merge()` pada graph besar bisa berbahaya.

Contoh:

```java
entityManager.merge(caseFileFromRequest);
```

Jika object dari request membawa child collection, cascade merge bisa:

- mengupdate child yang tidak dimaksud;
- menghapus/menimpa association;
- menyebabkan stale update;
- membuka celah mass assignment;
- membuat audit sulit.

Untuk sistem besar, lebih aman:

```text
Load managed aggregate -> apply command explicitly -> flush.
```

Contoh:

```java
@Transactional
public void addCaseNote(Long caseFileId, AddNoteCommand command) {
    CaseFile caseFile = caseFileRepository.findByIdForUpdateOrThrow(caseFileId);
    User author = userRepository.getReferenceById(command.authorUserId());

    caseFile.addNote(command.text(), author);
}
```

Bukan menerima entity graph dari luar dan `merge()` begitu saja.

---

## 10. `orphanRemoval`: Menghapus Child yang Tidak Lagi Dimiliki Parent

### 10.1 Makna `orphanRemoval`

`orphanRemoval = true` berarti ketika child entity dilepas dari relationship parent, child dianggap orphan dan akan dihapus.

Contoh:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseDecisionReason> reasons = new ArrayList<>();
```

Jika:

```java
caseFile.removeReason(reason);
```

Maka `reason` akan dihapus dari database saat flush.

### 10.2 Kapan Tepat

Gunakan `orphanRemoval` ketika child tidak boleh hidup tanpa parent.

Contoh:

```text
OrderLine tanpa Order tidak bermakna.
QuestionOption tanpa Question tidak bermakna.
DecisionReason tanpa Decision tidak bermakna.
DraftAttachmentMetadata tanpa Draft tidak bermakna.
```

### 10.3 Kapan Berbahaya

Jangan gunakan `orphanRemoval` jika child adalah entity shared atau punya lifecycle sendiri.

Contoh buruk:

```text
CaseFile -> Document
```

Jika document bisa dipakai oleh beberapa case, atau punya audit/legal retention sendiri, menghapus dari collection tidak boleh menghapus row document.

Contoh lain:

```text
User -> Role
Agency -> User
CaseFile -> Applicant
CaseFile -> AuditTrail
```

### 10.4 `orphanRemoval` Bukan Disassociation Biasa

Tanpa `orphanRemoval`, menghapus child dari collection biasanya berarti memutus association, misalnya set FK null atau update join table.

Dengan `orphanRemoval`, menghapus child dari collection berarti menghapus row child.

Ini perbedaan besar:

```text
remove from collection != delete entity
```

Tetapi dengan `orphanRemoval = true`:

```text
remove from collection == schedule delete child
```

Jadi jangan expose collection mutable sembarangan.

---

## 11. Join Column vs Join Table

### 11.1 Join Column

Join column berarti FK disimpan di salah satu table.

Contoh:

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "CASE_FILE_ID")
private CaseFile caseFile;
```

DDL:

```sql
CASE_NOTE.CASE_FILE_ID -> CASE_FILE.ID
```

Ini adalah model paling umum untuk one-to-many/many-to-one.

### 11.2 Join Table

Join table berarti relationship disimpan di table penghubung.

Contoh many-to-many:

```java
@ManyToMany
@JoinTable(
    name = "CASE_TAG",
    joinColumns = @JoinColumn(name = "CASE_FILE_ID"),
    inverseJoinColumns = @JoinColumn(name = "TAG_ID")
)
private Set<Tag> tags = new HashSet<>();
```

DDL:

```sql
CREATE TABLE CASE_TAG (
    CASE_FILE_ID NUMBER NOT NULL,
    TAG_ID       NUMBER NOT NULL,
    PRIMARY KEY (CASE_FILE_ID, TAG_ID)
);
```

### 11.3 Join Table Untuk One-to-Many?

Bisa, tetapi perlu alasan kuat.

```java
@OneToMany
@JoinTable(
    name = "CASE_FILE_ATTACHMENT",
    joinColumns = @JoinColumn(name = "CASE_FILE_ID"),
    inverseJoinColumns = @JoinColumn(name = "ATTACHMENT_ID")
)
private List<Attachment> attachments;
```

Cocok jika:

- child tidak boleh punya FK langsung ke parent;
- association optional/independent;
- association perlu dikelola terpisah;
- legacy schema memang begitu.

Tetapi jika association punya metadata, gunakan association entity.

---

## 12. Bidirectional Relationship dan Helper Methods

### 12.1 Kenapa Helper Methods Wajib

Bidirectional relationship memiliki dua reference di memory:

```text
Parent.children
Child.parent
```

Database hanya punya satu FK:

```text
CHILD.PARENT_ID
```

Agar object graph konsisten, kedua sisi perlu disinkronkan.

Contoh helper:

```java
public void addItem(OrderItem item) {
    items.add(item);
    item.setOrder(this);
}

public void removeItem(OrderItem item) {
    items.remove(item);
    item.setOrder(null);
}
```

Tanpa helper, bisa terjadi:

```java
order.getItems().add(item);
// item.order masih null
```

Atau:

```java
item.setOrder(order);
// order.items belum berisi item
```

Keduanya membuat state Java tidak konsisten.

### 12.2 Jangan Biarkan Semua Setter Public

Jika semua setter public, invariant mudah dilanggar:

```java
note.setCaseFile(otherCase);
```

Padahal mungkin hanya `CaseFile.moveNoteTo(...)` yang boleh melakukan itu.

Desain lebih baik:

```java
@Entity
public class CaseNote {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "CASE_FILE_ID", nullable = false)
    private CaseFile caseFile;

    void setCaseFile(CaseFile caseFile) {
        this.caseFile = caseFile;
    }
}
```

Package-private setter menjaga association hanya dimodifikasi melalui aggregate method.

### 12.3 Helper Method dengan Rule Domain

Contoh case management:

```java
public void addNote(String text, User author, Instant now) {
    if (isClosed()) {
        throw new IllegalStateException("Cannot add note to a closed case");
    }

    CaseNote note = new CaseNote(text, author, now);
    notes.add(note);
    note.setCaseFile(this);
}
```

Relationship operation bukan sekadar add/remove. Ia sering mengandung invariant.

---

## 13. Relationship dan Aggregate Boundary

### 13.1 JPA Relationship Bukan DDD Aggregate Otomatis

JPA memungkinkan entity A reference entity B. Tetapi itu tidak berarti A dan B berada dalam aggregate yang sama.

Contoh:

```java
@Entity
public class CaseFile {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Applicant applicant;
}
```

Apakah `Applicant` bagian dari aggregate `CaseFile`? Belum tentu.

Mungkin `Applicant` adalah aggregate sendiri, dan `CaseFile` hanya menyimpan reference.

Rule praktis:

```text
Jika entity lain punya lifecycle, invariant, permission, audit, atau transaction boundary sendiri, jangan treat sebagai owned child hanya karena ada relationship.
```

### 13.2 Owned Child vs Referenced Aggregate

| Relationship | Contoh | Cascade? | Orphan Removal? |
|---|---|---:|---:|
| Owned child | Order -> OrderLine | Ya, sering | Ya, sering |
| Referenced aggregate | CaseFile -> Applicant | Tidak | Tidak |
| Reference/master data | CaseFile -> Status | Tidak | Tidak |
| Association entity | User -> UserRoleAssignment | Dari owner bisa, tergantung lifecycle | Bisa, jika assignment owned |
| Audit/history | CaseFile -> AuditTrail | Biasanya tidak | Biasanya tidak |

### 13.3 ID Reference vs Entity Reference

Kadang lebih baik entity menyimpan ID saja daripada JPA association.

Contoh:

```java
@Column(name = "ACTOR_USER_ID", nullable = false)
private Long actorUserId;
```

Daripada:

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "ACTOR_USER_ID")
private User actor;
```

Kapan ID reference lebih baik?

- audit trail immutable;
- actor mungkin sudah dihapus/di-deactivate;
- tidak ingin accidental join;
- service boundary berbeda;
- reference ke external system;
- historical record harus menyimpan snapshot, bukan live reference.

Ini bukan anti-JPA. Ini desain persistence yang sadar boundary.

---

## 14. Relationship dan Deletion

### 14.1 Delete Parent dengan Child

Jika parent punya child dengan FK not null, menghapus parent tanpa menghapus child akan gagal:

```sql
ORA-02292: integrity constraint violated - child record found
```

Atau error sejenis di database lain.

Opsi:

1. delete child dulu secara eksplisit;
2. gunakan cascade remove JPA;
3. gunakan orphan removal;
4. gunakan DB `ON DELETE CASCADE`;
5. soft delete parent dan child;
6. larang delete jika child ada.

Pilihan tergantung domain.

### 14.2 Untuk Regulatory/Case Management, Delete Sering Tidak Boleh

Dalam sistem regulatory, case, audit, correspondence, document, enforcement lifecycle, delete fisik sering tidak boleh sembarangan.

Lebih umum:

```text
status = CANCELLED
status = WITHDRAWN
deleted_at = ...
voided_at = ...
superseded_by = ...
```

Relationship deletion harus memikirkan:

- audit retention;
- legal hold;
- evidence preservation;
- traceability;
- reporting consistency;
- historical references.

Jadi jangan asal `CascadeType.REMOVE`.

### 14.3 Delete Ordering

Saat flush, provider harus mengurutkan SQL agar constraint tidak dilanggar.

Contoh:

```text
DELETE CASE_NOTE first
DELETE CASE_FILE after
```

Jika relationship mapping tidak jelas, atau cascade tidak sesuai, delete ordering bisa menghasilkan constraint violation.

### 14.4 Soft Delete dan Relationship

Jika menggunakan soft delete:

```java
@Column(name = "DELETED_AT")
private Instant deletedAt;
```

Hati-hati:

- collection masih bisa memuat child soft-deleted;
- unique constraint harus mempertimbangkan deleted row;
- query harus konsisten filter deleted row;
- cascade remove tidak relevan jika delete adalah update status;
- database FK tetap menunjuk row yang ada.

Soft delete akan dibahas lebih dalam di Part 021.

---

## 15. Relationship dan Fetching

Fetching akan dibahas khusus di Part 007, tetapi relationship mapping tidak bisa dipisahkan total dari fetch behavior.

### 15.1 Default Fetch

JPA default:

```text
@ManyToOne  -> EAGER
@OneToOne   -> EAGER
@OneToMany  -> LAZY
@ManyToMany -> LAZY
```

Namun best practice modern biasanya:

```java
@ManyToOne(fetch = FetchType.LAZY)
@OneToOne(fetch = FetchType.LAZY)
@OneToMany(fetch = FetchType.LAZY)
@ManyToMany(fetch = FetchType.LAZY)
```

Lalu fetch sesuai use case:

- fetch join;
- entity graph;
- DTO projection;
- batch fetch;
- explicit repository query.

### 15.2 Relationship Mapping Bukan Fetch Plan

Mapping relationship menjawab:

```text
Bagaimana row berhubungan?
```

Fetch plan menjawab:

```text
Data apa yang dibutuhkan use case ini sekarang?
```

Jangan menyelesaikan LazyInitializationException dengan mengganti semua ke EAGER.

Itu seperti menyelesaikan masalah “saya lapar” dengan membuka semua pintu kulkas, gudang, dan supermarket sekaligus.

---

## 16. Relationship dan Serialization/API

### 16.1 Jangan Return Entity Graph Langsung ke JSON

Bidirectional relationship mudah menyebabkan recursive serialization:

```text
CaseFile -> Applicant -> CaseFiles -> Applicant -> ...
```

Solusi buruk:

```java
@JsonIgnore
```

di banyak tempat sampai entity menjadi campuran persistence + API serialization policy.

Solusi lebih baik:

```text
Entity -> Mapper -> DTO/ViewModel
```

Contoh:

```java
public record CaseFileDetailResponse(
    Long id,
    String caseNo,
    ApplicantSummary applicant,
    List<CaseNoteResponse> notes
) {}
```

Relationship entity tidak harus sama dengan bentuk response API.

### 16.2 DTO Melindungi Boundary

DTO membantu:

- menghindari lazy loading accidental;
- menghindari infinite recursion;
- mengontrol field yang keluar;
- menyembunyikan internal ids;
- menghindari mass assignment;
- menjaga compatibility API.

---

## 17. Relationship dan Query Design

### 17.1 Navigasi Object vs Query Explicit

Karena ada relationship, kamu bisa menulis:

```java
caseFile.getApplicant().getName();
```

Tetapi untuk listing 100 case, ini bisa memicu N+1.

Lebih baik query projection:

```java
select new com.example.CaseListView(
    c.id,
    c.caseNo,
    a.name,
    c.status,
    c.createdAt
)
from CaseFile c
join c.applicant a
where c.agency.id = :agencyId
order by c.createdAt desc
```

Relationship mapping memudahkan join JPQL, tetapi bukan berarti kita harus menavigasi graph di loop.

### 17.2 Query Berdasarkan ID Lebih Stabil Untuk Boundary

Daripada:

```java
List<CaseFile> findByApplicant(Applicant applicant);
```

Sering lebih boundary-friendly:

```java
List<CaseFile> findByApplicantId(Long applicantId);
```

Karena caller tidak perlu punya managed `Applicant` entity.

---

## 18. Relationship dan Constraint Database

### 18.1 Foreign Key Constraint

Relationship JPA tanpa FK database adalah kontrak lemah.

JPA mapping:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "CASE_FILE_ID", nullable = false)
private CaseFile caseFile;
```

Database harus punya:

```sql
ALTER TABLE CASE_NOTE
ADD CONSTRAINT FK_CASE_NOTE_CASE_FILE
FOREIGN KEY (CASE_FILE_ID)
REFERENCES CASE_FILE(ID);
```

Tanpa FK, data orphan bisa muncul dari:

- script manual;
- migration salah;
- batch job;
- integration job;
- bug aplikasi;
- data repair.

### 18.2 Unique Constraint Untuk One-to-One

One-to-one wajib didukung unique constraint:

```sql
ALTER TABLE USER_PROFILE
ADD CONSTRAINT UK_USER_PROFILE_USER_ACCOUNT
UNIQUE (USER_ACCOUNT_ID);
```

Tanpa unique constraint, database tetap mengizinkan banyak profile untuk satu user. JPA annotation saja tidak cukup melindungi data.

### 18.3 Join Table Constraint

Join table many-to-many minimal punya PK/unique composite:

```sql
ALTER TABLE CASE_TAG
ADD CONSTRAINT PK_CASE_TAG PRIMARY KEY (CASE_FILE_ID, TAG_ID);
```

Tanpa ini, duplicate relationship bisa muncul.

### 18.4 Constraint Name Penting

Gunakan nama constraint eksplisit:

```sql
FK_CASE_NOTE_CASE_FILE
UK_USER_ROLE_ACTIVE
PK_CASE_TAG
```

Manfaat:

- error lebih mudah diterjemahkan;
- migration lebih stabil;
- debugging production lebih cepat;
- observability lebih jelas.

---

## 19. Relationship dan Concurrency

### 19.1 Concurrent Modification Pada Collection

Contoh:

```text
User A menambahkan role X ke user.
User B menambahkan role X ke user bersamaan.
```

Jika hanya dicek di application:

```java
if (!user.hasRole(role)) {
    user.assignRole(role);
}
```

Dua transaction bisa sama-sama lolos.

Solusi wajib:

```sql
UNIQUE (USER_ID, ROLE_ID, ACTIVE_FLAG)
```

atau unique partial index jika DB mendukung.

### 19.2 Relationship State Transition

Contoh case assignment:

```text
CaseFile assigned to Officer A
CaseFile reassigned to Officer B
```

Jika assignment harus historis, jangan update FK langsung tanpa history.

Model lebih kuat:

```text
CASE_ASSIGNMENT
- CASE_FILE_ID
- OFFICER_ID
- ASSIGNED_AT
- UNASSIGNED_AT
- ASSIGNED_BY
- REASON
```

Current assignment bisa diturunkan dari active assignment.

### 19.3 Optimistic Locking Pada Parent

Jika perubahan child collection harus dianggap perubahan aggregate, parent perlu version increment.

Contoh:

```java
@Version
private long version;
```

Tetapi menambah child tidak selalu otomatis menaikkan version parent sesuai ekspektasi semua provider/scenario. Untuk invariant yang ketat, perlu desain eksplisit:

- update parent timestamp/version;
- optimistic force increment;
- conditional update;
- database constraint;
- lock parent saat modifikasi child.

Topik locking detail ada di Part 013 dan Part 014.

---

## 20. Relationship dan Performance

### 20.1 Biaya Relationship

Relationship mapping bisa menambah biaya:

- lazy proxy initialization;
- additional SELECT;
- join yang berat;
- dirty checking collection;
- delete ordering;
- cascade traversal;
- memory object graph;
- serialization accidental;
- flush collection diff.

### 20.2 Collection Dirty Checking

Hibernate perlu mengetahui apakah collection berubah.

Operasi seperti:

```java
caseFile.getNotes().clear();
caseFile.getNotes().addAll(newNotes);
```

bisa dianggap delete semua lalu insert ulang, tergantung mapping dan collection semantics.

Lebih baik operasi domain eksplisit:

```java
caseFile.addNote(...);
caseFile.removeNote(...);
caseFile.updateNote(...);
```

### 20.3 Many-to-Many Update Cost

Untuk direct many-to-many, provider bisa menghapus dan insert ulang rows join table tergantung collection type dan diff capability.

Gunakan `Set` dengan equality stabil, atau association entity untuk kontrol lebih baik.

### 20.4 Index Untuk Relationship

Minimum index yang sering dibutuhkan:

```sql
CREATE INDEX IDX_CASE_NOTE_CASE_FILE_ID ON CASE_NOTE(CASE_FILE_ID);
CREATE INDEX IDX_CASE_FILE_APPLICANT_ID ON CASE_FILE(APPLICANT_ID);
CREATE INDEX IDX_CASE_FILE_AGENCY_STATUS ON CASE_FILE(AGENCY_ID, STATUS);
CREATE INDEX IDX_USER_ROLE_USER_ID ON USER_ROLE(USER_ID);
CREATE INDEX IDX_USER_ROLE_ROLE_ID ON USER_ROLE(ROLE_ID);
```

Index bukan bagian dari JPA relationship semata. Index adalah bagian dari query design.

---

## 21. Pattern Relationship untuk Case Management / Regulatory System

### 21.1 CaseFile -> Applicant

Biasanya `ManyToOne` atau `OneToOne` tergantung domain.

Jika applicant bisa punya banyak case:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "APPLICANT_ID", nullable = false)
private Applicant applicant;
```

Jangan cascade remove dari case ke applicant.

### 21.2 CaseFile -> CaseNote

Owned child:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
@OrderBy("createdAt ASC")
private List<CaseNote> notes = new ArrayList<>();
```

Tetapi jika notes sangat banyak, pertimbangkan repository pagination.

### 21.3 CaseFile -> AuditTrail

Biasanya jangan collection navigable besar.

Lebih baik:

```java
public interface AuditTrailRepository {
    Page<AuditTrailView> findByModuleAndReferenceId(String module, Long referenceId, Pageable pageable);
}
```

Audit trail sering immutable dan append-only. Jangan `orphanRemoval`.

### 21.4 CaseFile -> Document

Ada beberapa model:

#### Document owned by case

```text
CASE_FILE 1 ---- * CASE_DOCUMENT
```

Jika document metadata hanya hidup untuk case itu, bisa owned child.

#### Document shared/reusable

```text
CASE_FILE * ---- * DOCUMENT via CASE_DOCUMENT_LINK
```

Gunakan association entity:

```java
@Entity
public class CaseDocumentLink {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private CaseFile caseFile;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Document document;

    private String purpose;
    private Instant linkedAt;
    private Long linkedByUserId;
}
```

### 21.5 CaseFile -> Officer Assignment

Jangan hanya:

```java
@ManyToOne
private User assignedOfficer;
```

Jika butuh history, use:

```text
CASE_ASSIGNMENT
- id
- case_file_id
- officer_id
- assigned_at
- unassigned_at
- assigned_by
- reason
```

Current assignment bisa berupa:

- denormalized FK di `CASE_FILE` untuk cepat;
- active row di `CASE_ASSIGNMENT`;
- projection/materialized read model.

### 21.6 Workflow Transition

Jangan model transition sebagai direct many-to-many status.

Lebih baik:

```text
CASE_STATUS_HISTORY
- case_file_id
- from_status
- to_status
- changed_by
- changed_at
- reason
- correlation_id
```

Entity relationship:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL)
@OrderBy("changedAt ASC")
private List<CaseStatusHistory> statusHistories;
```

Tetapi untuk case dengan history besar, query separately.

---

## 22. Java Version Considerations: 8 sampai 25

### 22.1 Java 8 Era

Umum:

- JPA 2.1/2.2;
- `javax.persistence`;
- Hibernate 5.x;
- `java.time` mulai tersedia di Java 8;
- banyak codebase masih memakai `Date`/`Calendar`;
- Spring Boot 2.x.

Mapping relationship annotation sama secara konsep, tetapi package:

```java
import javax.persistence.ManyToOne;
import javax.persistence.OneToMany;
```

### 22.2 Java 17+ / Jakarta Era

Umum:

- Jakarta Persistence 3.x;
- `jakarta.persistence`;
- Hibernate 6.x/7.x;
- Spring Boot 3.x;
- Jakarta EE 10/11;
- records untuk DTO/projection;
- sealed classes tidak langsung cocok untuk entity inheritance sembarangan;
- bytecode enhancement/lazy behavior tetap provider-specific.

Package:

```java
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
```

### 22.3 Entity Tetap Sebaiknya Bukan Record

Walaupun Java modern punya record, JPA entity tetap umumnya class biasa karena entity butuh:

- no-arg constructor;
- mutable state untuk provider;
- identity lifecycle;
- proxying/enhancement;
- lazy loading.

Gunakan record untuk DTO/projection:

```java
public record CaseListView(
    Long id,
    String caseNo,
    String applicantName,
    String status
) {}
```

---

## 23. API dan Annotation Cheat Sheet

### 23.1 `@ManyToOne`

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "PARENT_ID", nullable = false)
private Parent parent;
```

Checklist:

- explicit `fetch = LAZY`;
- tentukan optionality;
- `@JoinColumn` eksplisit;
- FK constraint di database;
- index FK;
- hindari cascade ke parent/shared reference.

### 23.2 `@OneToMany`

```java
@OneToMany(mappedBy = "parent", cascade = CascadeType.ALL, orphanRemoval = true)
private List<Child> children = new ArrayList<>();
```

Checklist:

- gunakan `mappedBy` jika bidirectional;
- collection initialized;
- helper add/remove;
- cascade hanya jika owned child;
- orphan removal hanya jika child tidak boleh hidup sendiri;
- hati-hati collection besar.

### 23.3 `@OneToOne`

```java
@OneToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL, orphanRemoval = true)
@JoinColumn(name = "DETAIL_ID", unique = true)
private Detail detail;
```

Checklist:

- pastikan benar-benar one-to-one secara domain;
- unique constraint database;
- pilih FK side dengan sadar;
- pertimbangkan `@Embeddable` atau one-to-many historical;
- validasi lazy behavior aktual.

### 23.4 `@ManyToMany`

```java
@ManyToMany
@JoinTable(
    name = "PARENT_TAG",
    joinColumns = @JoinColumn(name = "PARENT_ID"),
    inverseJoinColumns = @JoinColumn(name = "TAG_ID")
)
private Set<Tag> tags = new HashSet<>();
```

Checklist:

- hanya jika join table tidak punya metadata;
- gunakan `Set` untuk menghindari duplicate;
- primary key/unique constraint join table;
- hindari cascade remove ke shared entity;
- pertimbangkan association entity.

---

## 24. Anti-Pattern Relationship Mapping

### 24.1 Cascade ALL Everywhere

```java
@ManyToOne(cascade = CascadeType.ALL)
private User user;
```

Bahaya:

- accidental update/delete shared parent;
- data corruption;
- sulit debug.

### 24.2 EAGER Everywhere

```java
@ManyToOne(fetch = FetchType.EAGER)
@OneToMany(fetch = FetchType.EAGER)
```

Bahaya:

- graph loading membesar;
- N+1 tersembunyi;
- query tidak predictable;
- pagination rusak;
- memory tinggi.

### 24.3 Bidirectional Semua Relationship

Tidak semua association perlu dua arah.

Bahaya:

- object graph terlalu kompleks;
- serialization loop;
- helper method banyak;
- consistency risk;
- mental model sulit.

### 24.4 Entity Sebagai API Response

```java
@GetMapping("/cases/{id}")
public CaseFile getCase(@PathVariable Long id) {
    return caseFileRepository.findById(id).orElseThrow();
}
```

Bahaya:

- lazy loading saat serialization;
- infinite recursion;
- data leak;
- API coupling dengan schema;
- over-fetching.

### 24.5 Direct Many-to-Many Untuk Relationship Kaya Makna

```java
@ManyToMany
private Set<User> assignedOfficers;
```

Padahal butuh:

- assignedAt;
- assignedBy;
- role;
- reason;
- active/inactive;
- history.

Gunakan association entity.

### 24.6 Collection Besar di Aggregate Root

```java
@OneToMany(mappedBy = "caseFile")
private List<AuditTrail> auditTrails;
```

Bahaya:

- memory besar;
- slow load;
- accidental traversal;
- flush dirty checking mahal.

### 24.7 Update Relationship dari DTO Entity Graph

```java
entityManager.merge(requestBodyEntity);
```

Bahaya:

- mass assignment;
- cascade merge tak terkendali;
- detached graph stale;
- relationship hilang karena collection tidak lengkap.

---

## 25. Production Failure Modes

### 25.1 Foreign Key Null Saat Flush

Penyebab:

- hanya menambah child ke parent collection;
- tidak set owning side child;
- helper method tidak dipakai;
- `optional=false` tidak sinkron dengan object construction.

Solusi:

- helper add/remove;
- constructor/factory menjaga invariant;
- test flush eksplisit.

### 25.2 Constraint Violation Karena Delete Parent

Penyebab:

- child masih ada;
- cascade remove tidak dikonfigurasi;
- domain sebenarnya melarang delete.

Solusi:

- delete child eksplisit;
- orphanRemoval jika owned child;
- soft delete;
- restrict delete;
- DB cascade jika tepat.

### 25.3 Duplicate Join Table Row

Penyebab:

- tidak ada unique constraint;
- collection `List` direct many-to-many;
- concurrent insert.

Solusi:

- PK/unique composite;
- `Set` dengan equality stabil;
- association entity;
- idempotent assignment.

### 25.4 Accidental Parent Delete

Penyebab:

- `CascadeType.REMOVE` pada `@ManyToOne`;
- `CascadeType.ALL` ke shared reference.

Solusi:

- remove cascade dari reference/shared parent;
- review cascade matrix.

### 25.5 N+1 Karena Relationship Traversal

Penyebab:

- loop memanggil lazy association;
- fetch plan tidak explicit;
- entity response serialization.

Solusi:

- fetch join;
- entity graph;
- projection;
- batch fetching;
- DTO mapping dalam transaction.

### 25.6 Data Loss Karena Orphan Removal

Penyebab:

- collection di-clear dari request;
- child sebenarnya shared;
- UI mengirim partial list dianggap final list.

Solusi:

- jangan expose collection mutable;
- gunakan command explicit: add/remove;
- orphanRemoval hanya untuk owned child;
- patch semantics jelas.

### 25.7 Stale Relationship Setelah Bulk Update

Penyebab:

```java
update CaseFile c set c.assignedOfficer = :user where c.status = :status
```

Bulk update bypass persistence context. Entity managed yang sudah diload bisa stale.

Solusi:

- clear persistence context setelah bulk update;
- gunakan separate transaction;
- reload data;
- hindari mixing bulk update dengan managed graph dalam transaction sama.

---

## 26. Step-by-Step Design Method

Saat mendesain relationship baru, gunakan urutan ini.

### Step 1 — Nyatakan Domain Sentence

Contoh:

```text
A case file can have many notes.
Each note belongs to exactly one case file.
A note cannot exist without a case file.
```

### Step 2 — Tentukan Cardinality Relational

```text
CASE_FILE 1 ---- * CASE_NOTE
```

### Step 3 — Tentukan FK Holder

```text
CASE_NOTE.CASE_FILE_ID NOT NULL
```

### Step 4 — Tentukan Ownership JPA

```text
Owning side: CaseNote.caseFile
Inverse side: CaseFile.notes
```

### Step 5 — Tentukan Lifecycle

```text
CaseNote owned by CaseFile.
Cascade persist/remove: yes.
Orphan removal: yes.
```

### Step 6 — Tentukan Collection Size

```text
Expected notes per case: low-medium.
Can be collection.
If high, use paged repository.
```

### Step 7 — Tentukan Fetch Strategy

```text
Mapping LAZY.
Detail use case fetch notes explicitly.
Listing use case use projection without notes.
```

### Step 8 — Tentukan Constraint/Index

```sql
CASE_NOTE.CASE_FILE_ID NOT NULL
FK_CASE_NOTE_CASE_FILE
IDX_CASE_NOTE_CASE_FILE_CREATED_AT
```

### Step 9 — Tentukan Helper Method

```java
caseFile.addNote(...)
caseFile.removeNote(...)
```

### Step 10 — Tentukan Test

- persist parent with child;
- remove child;
- delete parent;
- FK violation test;
- lazy loading test;
- N+1 test for listing;
- concurrent add if uniqueness needed.

---

## 27. Example Lengkap: CaseFile, CaseNote, Document Link, Officer Assignment

### 27.1 CaseFile Aggregate

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "CASE_FILE_SEQ", allocationSize = 50)
    private Long id;

    @Column(name = "CASE_NO", nullable = false, unique = true, length = 50)
    private String caseNo;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "APPLICANT_ID", nullable = false)
    private Applicant applicant;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "AGENCY_ID", nullable = false)
    private Agency agency;

    @OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("createdAt ASC")
    private List<CaseNote> notes = new ArrayList<>();

    @OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
    private Set<CaseDocumentLink> documentLinks = new HashSet<>();

    @OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CaseAssignment> assignments = new ArrayList<>();

    @Version
    @Column(name = "VERSION", nullable = false)
    private long version;

    protected CaseFile() {
    }

    public CaseFile(String caseNo, Applicant applicant, Agency agency) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.applicant = Objects.requireNonNull(applicant);
        this.agency = Objects.requireNonNull(agency);
    }

    public void addNote(String text, User author, Instant now) {
        CaseNote note = new CaseNote(text, author, now);
        notes.add(note);
        note.setCaseFile(this);
    }

    public void linkDocument(Document document, String purpose, User linkedBy, Instant now) {
        CaseDocumentLink link = new CaseDocumentLink(document, purpose, linkedBy, now);
        documentLinks.add(link);
        link.setCaseFile(this);
    }

    public void assignTo(User officer, User assignedBy, Instant now, String reason) {
        for (CaseAssignment assignment : assignments) {
            if (assignment.isActive()) {
                assignment.close(now);
            }
        }

        CaseAssignment newAssignment = new CaseAssignment(officer, assignedBy, now, reason);
        assignments.add(newAssignment);
        newAssignment.setCaseFile(this);
    }
}
```

### 27.2 CaseNote Owned Child

```java
@Entity
@Table(name = "CASE_NOTE")
public class CaseNote {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_note_seq")
    @SequenceGenerator(name = "case_note_seq", sequenceName = "CASE_NOTE_SEQ", allocationSize = 50)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "CASE_FILE_ID", nullable = false)
    private CaseFile caseFile;

    @Column(name = "TEXT", nullable = false, length = 4000)
    private String text;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "AUTHOR_USER_ID", nullable = false)
    private User author;

    @Column(name = "CREATED_AT", nullable = false)
    private Instant createdAt;

    protected CaseNote() {
    }

    CaseNote(String text, User author, Instant createdAt) {
        this.text = Objects.requireNonNull(text);
        this.author = Objects.requireNonNull(author);
        this.createdAt = Objects.requireNonNull(createdAt);
    }

    void setCaseFile(CaseFile caseFile) {
        this.caseFile = caseFile;
    }
}
```

### 27.3 Document Link Association Entity

```java
@Entity
@Table(
    name = "CASE_DOCUMENT_LINK",
    uniqueConstraints = @UniqueConstraint(
        name = "UK_CASE_DOCUMENT_LINK",
        columnNames = {"CASE_FILE_ID", "DOCUMENT_ID", "PURPOSE"}
    )
)
public class CaseDocumentLink {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_document_link_seq")
    @SequenceGenerator(name = "case_document_link_seq", sequenceName = "CASE_DOCUMENT_LINK_SEQ", allocationSize = 50)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "CASE_FILE_ID", nullable = false)
    private CaseFile caseFile;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "DOCUMENT_ID", nullable = false)
    private Document document;

    @Column(name = "PURPOSE", nullable = false, length = 100)
    private String purpose;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "LINKED_BY_USER_ID", nullable = false)
    private User linkedBy;

    @Column(name = "LINKED_AT", nullable = false)
    private Instant linkedAt;

    protected CaseDocumentLink() {
    }

    CaseDocumentLink(Document document, String purpose, User linkedBy, Instant linkedAt) {
        this.document = Objects.requireNonNull(document);
        this.purpose = Objects.requireNonNull(purpose);
        this.linkedBy = Objects.requireNonNull(linkedBy);
        this.linkedAt = Objects.requireNonNull(linkedAt);
    }

    void setCaseFile(CaseFile caseFile) {
        this.caseFile = caseFile;
    }
}
```

### 27.4 CaseAssignment Historical Relationship

```java
@Entity
@Table(name = "CASE_ASSIGNMENT")
public class CaseAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_assignment_seq")
    @SequenceGenerator(name = "case_assignment_seq", sequenceName = "CASE_ASSIGNMENT_SEQ", allocationSize = 50)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "CASE_FILE_ID", nullable = false)
    private CaseFile caseFile;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "OFFICER_USER_ID", nullable = false)
    private User officer;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ASSIGNED_BY_USER_ID", nullable = false)
    private User assignedBy;

    @Column(name = "ASSIGNED_AT", nullable = false)
    private Instant assignedAt;

    @Column(name = "UNASSIGNED_AT")
    private Instant unassignedAt;

    @Column(name = "REASON", length = 1000)
    private String reason;

    protected CaseAssignment() {
    }

    CaseAssignment(User officer, User assignedBy, Instant assignedAt, String reason) {
        this.officer = Objects.requireNonNull(officer);
        this.assignedBy = Objects.requireNonNull(assignedBy);
        this.assignedAt = Objects.requireNonNull(assignedAt);
        this.reason = reason;
    }

    void setCaseFile(CaseFile caseFile) {
        this.caseFile = caseFile;
    }

    boolean isActive() {
        return unassignedAt == null;
    }

    void close(Instant now) {
        if (unassignedAt != null) {
            throw new IllegalStateException("Assignment already closed");
        }
        unassignedAt = Objects.requireNonNull(now);
    }
}
```

### 27.5 Kenapa Desain Ini Lebih Kuat?

Karena setiap relationship punya makna yang jelas:

| Relationship | Mapping | Lifecycle | Reason |
|---|---|---|---|
| CaseFile -> Applicant | `@ManyToOne` | referenced aggregate | applicant tidak dihapus bersama case |
| CaseFile -> Agency | `@ManyToOne` | reference/master | agency shared |
| CaseFile -> Notes | `@OneToMany` + owned child | owned | note tidak hidup tanpa case |
| CaseFile -> Document | association entity | link punya metadata | purpose, linkedBy, linkedAt |
| CaseFile -> Assignment | association entity/history | owned history | assignment punya lifecycle/status |

---

## 28. Testing Relationship Mapping

### 28.1 Test Persist Parent with Child

```java
@Test
void persistCaseFileWithNote() {
    CaseFile caseFile = new CaseFile("CASE-001", applicantRef, agencyRef);
    caseFile.addNote("Initial review", officerRef, Instant.now());

    entityManager.persist(caseFile);
    entityManager.flush();
    entityManager.clear();

    CaseFile loaded = entityManager.find(CaseFile.class, caseFile.getId());
    assertThat(loaded).isNotNull();
}
```

Test ini menangkap FK null jika helper salah.

### 28.2 Test Orphan Removal

```java
@Test
void removingNoteDeletesOwnedChild() {
    CaseFile caseFile = persistCaseWithOneNote();

    CaseNote note = caseFile.getNotes().get(0);
    caseFile.removeNote(note);

    entityManager.flush();
    entityManager.clear();

    CaseNote deleted = entityManager.find(CaseNote.class, note.getId());
    assertThat(deleted).isNull();
}
```

### 28.3 Test No Cascade Delete Shared Parent

```java
@Test
void deletingCaseFileDoesNotDeleteApplicant() {
    CaseFile caseFile = persistCaseFile();
    Long applicantId = caseFile.getApplicant().getId();

    entityManager.remove(caseFile);
    entityManager.flush();
    entityManager.clear();

    Applicant applicant = entityManager.find(Applicant.class, applicantId);
    assertThat(applicant).isNotNull();
}
```

### 28.4 Test Unique Relationship

```java
@Test
void cannotAssignSameActiveRoleTwice() {
    user.assignRole(role, admin, now, "initial");
    user.assignRole(role, admin, now, "duplicate");

    assertThatThrownBy(() -> entityManager.flush())
        .isInstanceOf(PersistenceException.class);
}
```

Application logic boleh mencegah lebih awal, tetapi database constraint tetap penjaga terakhir.

---

## 29. Review Checklist Relationship Mapping

Gunakan checklist ini saat code review.

### 29.1 Cardinality

- Apakah cardinality benar hari ini dan cukup tahan terhadap requirement masa depan?
- Apakah one-to-one sebenarnya akan menjadi one-to-many historical?
- Apakah many-to-many sebenarnya butuh association entity?

### 29.2 Ownership

- Apakah FK holder jelas?
- Apakah owning side benar?
- Apakah `mappedBy` benar?
- Apakah helper method menjaga kedua sisi relationship?

### 29.3 Lifecycle

- Apakah child owned atau shared?
- Apakah cascade hanya dipakai untuk owned child?
- Apakah `orphanRemoval` aman?
- Apakah delete fisik diperbolehkan domain/regulasi?

### 29.4 Fetch

- Apakah relationship default ditulis explicit `LAZY`?
- Apakah use case punya fetch plan sendiri?
- Apakah collection besar tidak dimapping sebagai always-navigable graph?

### 29.5 Constraint

- Apakah FK database ada?
- Apakah FK indexed?
- Apakah one-to-one punya unique constraint?
- Apakah join table punya PK/unique composite?
- Apakah constraint name eksplisit?

### 29.6 API Boundary

- Apakah entity tidak langsung keluar sebagai JSON?
- Apakah DTO/projection digunakan untuk response?
- Apakah request tidak di-merge langsung sebagai entity graph?

### 29.7 Concurrency

- Apakah duplicate relationship dicegah database?
- Apakah relationship update high-contention butuh lock/version?
- Apakah assignment/history didesain append-only jika perlu audit?

### 29.8 Operation

- Apakah SQL generated sudah dicek?
- Apakah delete ordering aman?
- Apakah cascade traversal tidak terlalu besar?
- Apakah N+1 test tersedia untuk listing/detail penting?

---

## 30. Latihan / Scenario

### Scenario 1 — Role Assignment

Requirement:

```text
User bisa punya banyak role.
Role bisa dimiliki banyak user.
Setiap assignment harus menyimpan assignedBy, assignedAt, reason, dan bisa direvoke.
```

Pertanyaan:

1. Apakah direct `@ManyToMany` tepat?
2. Table apa yang kamu desain?
3. Constraint apa yang dibutuhkan agar role aktif tidak duplicate?
4. Apakah user deletion boleh cascade ke assignment?
5. Apakah role deletion boleh cascade ke assignment?

Jawaban arah:

- gunakan association entity `UserRoleAssignment`;
- role adalah shared reference, jangan cascade remove;
- user mungkin soft delete;
- unique active assignment perlu constraint/index;
- revoke adalah update state, bukan delete row.

### Scenario 2 — Case Notes

Requirement:

```text
Case punya notes. Note tidak boleh ada tanpa case. Notes bisa dihapus selama case masih draft, tetapi setelah submitted notes menjadi immutable.
```

Pertanyaan:

1. Mapping apa yang cocok?
2. Apakah `orphanRemoval` aman?
3. Di mana rule “tidak boleh hapus setelah submitted” diletakkan?
4. Apakah notes perlu collection atau repository pagination?

Jawaban arah:

- `CaseFile` -> `CaseNote` sebagai owned child;
- `orphanRemoval` bisa aman jika note benar-benar owned;
- rule deletion di aggregate method;
- jika notes bisa besar, gunakan repository pagination untuk read, tetapi write tetap bisa lewat aggregate method.

### Scenario 3 — Applicant and Case

Requirement:

```text
Applicant bisa memiliki banyak case. Menghapus case tidak boleh menghapus applicant. Applicant bisa update profile secara independen.
```

Pertanyaan:

1. Mapping apa?
2. Cascade apa?
3. Apakah Applicant.caseFiles perlu collection?

Jawaban arah:

- `CaseFile` punya `@ManyToOne(fetch = LAZY)` ke `Applicant`;
- jangan cascade remove/ALL;
- `Applicant.caseFiles` hanya jika use case butuh navigasi dan collection terkendali; jika tidak, query repository.

### Scenario 4 — Document Linking

Requirement:

```text
Satu document bisa dilink ke beberapa case. Link punya purpose, linkedBy, linkedAt.
```

Pertanyaan:

1. Apakah `@ManyToMany` tepat?
2. Apa entity yang perlu dibuat?
3. Constraint apa yang perlu?

Jawaban arah:

- direct many-to-many tidak tepat;
- buat `CaseDocumentLink`;
- unique `(CASE_FILE_ID, DOCUMENT_ID, PURPOSE)` jika business rule melarang duplicate;
- `Document` shared, jangan orphanRemoval.

---

## 31. Ringkasan

Relationship mapping adalah salah satu bagian JPA/Hibernate yang paling deceptively simple. Annotation-nya sedikit, tetapi konsekuensinya sangat besar.

Poin utama:

1. Relationship di Java adalah object reference; relationship di database adalah foreign key/join table.
2. `@ManyToOne` adalah mapping paling fundamental karena paling dekat dengan FK.
3. `@OneToMany(mappedBy = ...)` biasanya adalah inverse collection, bukan pemilik FK.
4. `mappedBy` menentukan bahwa relationship dimiliki field lain.
5. Parent secara domain belum tentu owning side secara JPA.
6. Cascade hanya aman untuk owned child, bukan shared parent/reference.
7. `orphanRemoval` berarti remove dari collection akan menghapus row child; gunakan hanya untuk child yang benar-benar owned.
8. Direct `@ManyToMany` hanya cocok untuk relationship yang benar-benar tidak punya metadata.
9. Association entity lebih kuat untuk assignment, link, membership, tagging dengan metadata, approval, audit, dan history.
10. Collection besar sebaiknya tidak dijadikan object graph navigable; gunakan repository/projection/pagination.
11. Relationship mapping harus didukung database constraint dan index.
12. Entity graph tidak boleh langsung dijadikan API response.
13. Relationship design harus mempertimbangkan lifecycle, transaction, concurrency, audit, performance, dan production failure.

Mental model paling penting:

```text
Relationship mapping bukan tentang membuat object saling menunjuk.
Relationship mapping adalah desain ownership, lifecycle, constraint, dan perubahan data lintas tabel di dalam transaction boundary.
```

---

## 32. Referensi Utama

- Jakarta Persistence 3.2 Specification — relationship mapping, entity, association, persistence context.
- Jakarta Persistence 3.2 API Documentation — `@OneToMany`, `@ManyToOne`, `@OneToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable`, cascade, orphan removal.
- Hibernate ORM User Guide — association mapping, bidirectional relationship, cascade, collection mapping, fetching behavior.
- Hibernate ORM 7 Introduction — practical guidance on association mapping and preference for FK relationship using `@ManyToOne` with `@OneToMany(mappedBy=...)` when in doubt.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-005.md">⬅️ Part 005 — Mapping Fundamentals Done Correctly</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-007.md">Part 007 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join ➡️</a>
</div>
