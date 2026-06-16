# Part 003 — Entity Identity: Object Identity, Database Identity, Business Identity

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-003.md`  
> Status: Part 003 dari 032  
> Target: Java 8 sampai Java 25, `javax.persistence` sampai `jakarta.persistence`, Hibernate 5 sampai Hibernate 7, Spring Data JPA, Jakarta Data

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan empat jenis identitas yang sering tercampur dalam aplikasi persistence:
   - Java object identity.
   - Persistence identity.
   - Database primary key.
   - Business/natural identity.
2. Mendesain identifier entity dengan sadar terhadap konsekuensi correctness, performance, migration, distributed system, dan operational debugging.
3. Memilih strategi id generation yang tepat:
   - `IDENTITY`.
   - `SEQUENCE`.
   - `TABLE`.
   - `AUTO`.
   - UUID/ULID/custom generator.
   - assigned id.
4. Memahami trade-off surrogate key vs natural key.
5. Mendesain composite key dengan `@EmbeddedId` atau `@IdClass` tanpa membuat model sulit dipakai.
6. Menghindari bug klasik `equals()` dan `hashCode()` pada entity JPA/Hibernate.
7. Menentukan kapan business uniqueness harus berada di database constraint, kapan cukup di application validation, dan kapan perlu keduanya.
8. Memahami hubungan identity dengan persistence context, lazy proxy, detached entity, caching, batch insert, dan optimistic locking.

Bagian ini terlihat “dasar”, tetapi sebenarnya sangat fundamental. Banyak sistem enterprise yang sulit di-maintain karena sejak awal salah membedakan **row identity**, **object identity**, dan **business identity**.

---

## 2. Mental Model Utama

### 2.1 Identity adalah jawaban terhadap pertanyaan “benda ini sama dengan benda yang mana?”

Dalam aplikasi biasa, kita sering bertanya:

```text
Apakah object A sama dengan object B?
```

Dalam aplikasi persistence, pertanyaannya lebih kompleks:

```text
Apakah Java object A sama instance-nya dengan Java object B?
Apakah object A dan B merepresentasikan row database yang sama?
Apakah row ini masih row yang sama setelah business key berubah?
Apakah dua request berbeda sedang mengubah business object yang sama?
Apakah event ini mengacu ke aggregate yang sama walaupun id internal berubah?
Apakah data import ini duplicate secara bisnis atau hanya row baru?
```

JPA/Hibernate tidak bisa menjawab semua pertanyaan ini secara otomatis. Mereka hanya membantu mengelola sebagian identitas, terutama **persistence identity**.

Kamu sebagai engineer harus menentukan:

- Apa yang menjadi primary key database.
- Apa yang menjadi identity entity.
- Apa yang menjadi business uniqueness.
- Apa yang boleh berubah.
- Apa yang tidak boleh berubah selamanya.
- Apa yang dipakai untuk integrasi antarsistem.
- Apa yang dipakai manusia untuk referensi.

---

### 2.2 Empat bentuk identity

| Jenis identity | Contoh | Dijaga oleh | Stabilitas | Fungsi utama |
|---|---:|---|---|---|
| Object identity | `a == b` | JVM | Selama object hidup di memory | Menentukan apakah dua reference menunjuk instance yang sama |
| Persistence identity | Entity type + primary key | JPA persistence context | Selama row/entity masih ada | Menentukan managed entity yang sama |
| Database identity | Primary key row | Database | Biasanya permanen | Menjamin row uniqueness dan foreign key reference |
| Business identity | Nomor aplikasi, NIK, email, case number | Domain + DB constraint | Bisa permanen atau bisa berubah tergantung domain | Menentukan duplicate/sameness secara bisnis |

Kesalahan umum adalah memakai satu jenis identity untuk semua kebutuhan.

Contoh buruk:

```java
@Entity
public class User {
    @Id
    private String email;
}
```

Kelihatannya sederhana karena email unik. Namun email bisa berubah, bisa dikoreksi, bisa diambil alih, bisa case-insensitive, bisa terkena normalization, bisa digunakan ulang, dan bisa berbeda untuk login vs contact. Jika email menjadi primary key, semua foreign key ikut bergantung pada nilai yang business-nya tidak stabil.

Contoh lebih defensible:

```java
@Entity
@Table(
    name = "app_user",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_app_user_email", columnNames = "email")
    }
)
public class AppUser {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "app_user_seq")
    @SequenceGenerator(name = "app_user_seq", sequenceName = "app_user_seq", allocationSize = 50)
    private Long id;

    @Column(nullable = false, length = 320)
    private String email;
}
```

Di sini:

- `id` adalah database/persistence identity.
- `email` adalah business uniqueness.
- Foreign key menggunakan `id`.
- Duplicate email tetap dicegah database.
- Email masih bisa dikoreksi tanpa mengganti identity row.

---

## 3. Identity di JPA/Jakarta Persistence

### 3.1 Entity wajib punya primary key

Dalam JPA/Jakarta Persistence, setiap entity memiliki primary key. Primary key dapat simple atau composite. Composite primary key direpresentasikan dengan `@EmbeddedId` atau `@IdClass`.

Contoh simple id:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "case_file")
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    private Long id;

    // fields...
}
```

Untuk Java EE lama / Spring Boot 2 / Hibernate 5 era lama, package-nya biasanya:

```java
import javax.persistence.Entity;
import javax.persistence.Id;
```

Untuk Jakarta EE 9+ / Spring Boot 3+ / Hibernate 6+, package-nya:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
```

Konsep identity-nya sama; namespace berubah dari `javax.*` ke `jakarta.*`.

---

### 3.2 Persistence context menjaga satu instance per persistence identity

Persistence context memiliki sifat identity map:

```text
Dalam satu persistence context,
untuk kombinasi entity type + primary key yang sama,
JPA mengelola satu managed entity instance.
```

Misalnya:

```java
CaseFile a = entityManager.find(CaseFile.class, 100L);
CaseFile b = entityManager.find(CaseFile.class, 100L);

System.out.println(a == b); // true dalam persistence context yang sama
```

Bukan karena Java secara global tahu bahwa row itu sama, tetapi karena `EntityManager` mengelola persistence context dan mengembalikan instance yang sama untuk persistence identity yang sama.

Namun pada persistence context berbeda:

```java
CaseFile a = entityManager1.find(CaseFile.class, 100L);
CaseFile b = entityManager2.find(CaseFile.class, 100L);

System.out.println(a == b); // false
System.out.println(a.getId().equals(b.getId())); // true
```

Jadi:

```text
Object identity berbeda, persistence/database identity sama.
```

Inilah akar dari banyak bug `equals()`/`hashCode()`.

---

## 4. Object Identity vs Persistence Identity

### 4.1 Java object identity

Java object identity adalah identitas berdasarkan lokasi object di heap.

```java
CaseFile a = new CaseFile();
CaseFile b = new CaseFile();

System.out.println(a == b); // false
```

Meskipun semua field sama, `a` dan `b` tetap object berbeda.

---

### 4.2 Persistence identity

Persistence identity adalah kombinasi:

```text
entity class + primary key value
```

Contoh:

```text
CaseFile#100
AppUser#200
Appeal#300
```

Dua Java object bisa berbeda instance tetapi merepresentasikan row yang sama:

```java
CaseFile detached = serviceA.load(100L);
CaseFile managed = serviceB.load(100L);
```

Jika mereka berasal dari transaction/persistence context berbeda, `detached == managed` hampir pasti false, tetapi secara persistence identity mereka sama.

---

### 4.3 Database identity

Database identity adalah primary key row.

```sql
create table case_file (
    id number(19) primary key,
    case_number varchar2(64) not null unique,
    status varchar2(40) not null
);
```

Database identity penting untuk:

- Primary key lookup.
- Foreign key reference.
- Index clustering/organization tertentu.
- Join efficiency.
- Referential integrity.
- Replication/CDC/event payload.
- Audit trail reference.

---

### 4.4 Business identity

Business identity adalah identitas menurut domain.

Contoh:

| Domain | Business identity |
|---|---|
| Case management | Case number |
| Application | Application reference number |
| User | Login id/email/external subject id |
| Product | SKU |
| Payment | Payment reference |
| Government profile | UEN/NRIC/passport/external registry id |
| Document | Document checksum + type + owner? |
| Appeal | Appeal reference number |

Business identity bisa:

- immutable;
- mutable;
- globally unique;
- unique per tenant;
- unique per agency;
- unique per year;
- unique hanya setelah status tertentu;
- case-sensitive atau case-insensitive;
- normalized atau raw;
- berasal dari external system;
- dibuat internal.

Karena itu business identity harus dianalisis, bukan langsung dijadikan primary key.

---

## 5. Surrogate Key vs Natural Key

### 5.1 Surrogate key

Surrogate key adalah id teknis yang tidak bermakna bisnis.

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
private Long id;
```

Kelebihan:

- Stabil walaupun business field berubah.
- Foreign key kecil dan efisien jika memakai numeric id.
- Tidak tergantung aturan bisnis yang bisa berubah.
- Cocok untuk relasi kompleks.
- Cocok untuk audit dan historisasi internal.
- Memudahkan migration ketika business key perlu diperbaiki.

Kekurangan:

- Perlu unique constraint tambahan untuk business uniqueness.
- Tidak bermakna bagi manusia.
- Jika diekspos ke publik, bisa menimbulkan enumeration risk.
- Tidak otomatis mencegah duplicate bisnis.

---

### 5.2 Natural key

Natural key adalah id yang punya makna bisnis.

Contoh:

```java
@Id
@Column(length = 64)
private String caseNumber;
```

Kelebihan:

- Langsung bermakna.
- Tidak perlu lookup tambahan untuk reference manusia.
- Bisa cocok untuk lookup table yang benar-benar stabil.
- Bisa cocok untuk ISO code/currency code/country code jika domain menerima stabilitasnya.

Kekurangan:

- Jika berubah, semua foreign key terdampak.
- Jika format berubah, schema/model ikut terpengaruh.
- Jika uniqueness scope berubah, desain primary key bermasalah.
- Bisa besar sebagai foreign key.
- Normalization/case-insensitive equality bisa rumit.
- Data correction menjadi mahal.

---

### 5.3 Rekomendasi praktis

Untuk sebagian besar sistem enterprise/case management/regulatory:

```text
Gunakan surrogate key sebagai primary key internal.
Gunakan unique constraint untuk business key.
Expose business reference untuk user/API eksternal bila diperlukan.
```

Contoh:

```java
@Entity
@Table(
    name = "case_file",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_case_file_case_number", columnNames = "case_number")
    }
)
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "case_file_seq", allocationSize = 50)
    private Long id;

    @Column(name = "case_number", nullable = false, length = 64)
    private String caseNumber;
}
```

Untuk lookup yang benar-benar stabil, natural key bisa acceptable:

```java
@Entity
@Table(name = "country")
public class Country {

    @Id
    @Column(length = 2)
    private String isoCode;

    @Column(nullable = false)
    private String name;
}
```

Namun jangan memakai natural key hanya karena “kelihatannya unik sekarang”. Pertanyaannya:

```text
Apakah nilai ini tidak pernah berubah selama umur sistem?
Apakah uniqueness scope tidak akan berubah?
Apakah format tidak akan berubah?
Apakah foreign key ke nilai ini tetap masuk akal?
Apakah external authority bisa mengoreksi/mengganti nilai ini?
```

Jika ada keraguan, gunakan surrogate key + unique constraint.

---

## 6. Generated Identifier Strategy

### 6.1 `GenerationType.IDENTITY`

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Biasanya memakai auto-increment/identity column database.

Karakteristik:

- Id dihasilkan database saat insert.
- Application tidak tahu id sebelum row di-insert.
- Hibernate sering perlu execute insert lebih cepat untuk mendapatkan id.
- Bisa menghambat batching insert karena id baru diketahui setelah insert.
- Umum di MySQL dan SQL Server.

Cocok ketika:

- Database target memang identity-based.
- Insert batching bukan bottleneck utama.
- Model sederhana.

Kurang cocok ketika:

- Butuh high-volume batch insert.
- Butuh id sebelum insert untuk membangun graph kompleks.
- Menggunakan Oracle/PostgreSQL yang sequence-nya lebih natural.

Contoh problem:

```java
for (int i = 0; i < 10_000; i++) {
    entityManager.persist(new AuditLog(...));
}
```

Dengan identity generation, provider sering tidak bisa memanfaatkan batch insert sebaik sequence pooled generator karena setiap insert perlu mengembalikan generated key.

---

### 6.2 `GenerationType.SEQUENCE`

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
@SequenceGenerator(
    name = "case_file_seq",
    sequenceName = "case_file_seq",
    allocationSize = 50
)
private Long id;
```

Karakteristik:

- Id berasal dari database sequence.
- Application/provider bisa mengambil value sequence sebelum insert.
- Mendukung batching lebih baik.
- Dengan allocation/pooled optimizer, roundtrip ke sequence bisa dikurangi.
- Sangat cocok untuk Oracle dan PostgreSQL.

`allocationSize` penting.

Jika `allocationSize = 1`:

```text
Setiap entity baru bisa butuh call sequence.
```

Jika `allocationSize = 50`:

```text
Provider mengambil blok id dan menggunakannya di memory.
```

Trade-off:

- Lebih sedikit database roundtrip.
- Id bisa melompat jika aplikasi restart sebelum semua id terpakai.
- Gap pada id adalah normal dan tidak boleh dianggap masalah.

Prinsip penting:

```text
Primary key bukan nomor urut bisnis.
Jangan mengandalkan id teknis harus rapat tanpa gap.
```

Jika bisnis butuh nomor dokumen berurutan, desain business numbering secara terpisah.

---

### 6.3 `GenerationType.TABLE`

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.TABLE, generator = "id_table")
@TableGenerator(
    name = "id_table",
    table = "id_generator",
    pkColumnName = "entity_name",
    valueColumnName = "next_value",
    pkColumnValue = "case_file",
    allocationSize = 50
)
private Long id;
```

Karakteristik:

- Id disimpan di tabel khusus.
- Portable secara konsep.
- Biasanya lebih lambat dan lebih rentan contention dibanding sequence native.
- Jarang menjadi pilihan terbaik di database modern.

Gunakan hanya jika:

- Database tidak punya sequence/identity yang cocok.
- Portability lebih penting daripada performance.
- Volume rendah.

---

### 6.4 `GenerationType.AUTO`

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
```

Karakteristik:

- Provider memilih strategi berdasarkan dialect/database.
- Nyaman untuk contoh/demo.
- Di production, bisa membuat behavior berubah saat pindah database/provider/version.

Rekomendasi:

```text
Untuk production system, pilih strategi secara eksplisit.
```

Kenapa?

Karena identity strategy mempengaruhi:

- batching;
- insert ordering;
- sequence object;
- migration script;
- database portability;
- performance;
- operational debugging.

---

### 6.5 UUID sebagai primary key

Contoh modern:

```java
@Id
@GeneratedValue
private UUID id;
```

Atau explicit provider-specific generator pada Hibernate versi tertentu.

Kelebihan:

- Bisa dibuat di application side.
- Cocok untuk distributed id generation.
- Tidak mudah ditebak jika diekspos.
- Bisa dibuat sebelum persist.
- Tidak tergantung central database sequence.

Kekurangan:

- Lebih besar daripada `Long`.
- Random UUID dapat menyebabkan index fragmentation.
- Kurang nyaman untuk debugging manual.
- Join dan foreign key lebih berat.
- Jika disimpan sebagai string, storage overhead besar.

Lebih baik simpan UUID sebagai native UUID/binary jika database mendukung.

Pertimbangkan ordered UUID/ULID/time-sortable id jika:

- volume insert tinggi;
- primary key menjadi clustered index;
- write locality penting;
- log/event ordering membutuhkan approximate temporal order.

Namun hati-hati:

```text
Time-sortable id bukan pengganti timestamp bisnis.
Time-sortable id bukan jaminan global ordering mutlak.
```

---

### 6.6 Assigned id

Assigned id berarti aplikasi menetapkan id sendiri sebelum persist.

Contoh:

```java
@Entity
public class ExternalProfile {

    @Id
    @Column(length = 128)
    private String externalSubjectId;
}
```

Cocok jika:

- Entity benar-benar dikuasai external identity provider.
- Id external immutable.
- System of record berada di luar.
- Tidak ada kebutuhan mengganti id.

Risiko:

- External id bisa berubah.
- External id bisa reuse.
- External id bisa berbeda format antar provider.
- External id bisa sensitif/privacy-sensitive.
- Foreign key menjadi bergantung pada pihak luar.

Sering lebih aman:

```java
@Entity
@Table(
    name = "external_profile",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_external_profile_provider_subject",
            columnNames = {"provider", "subject_id"}
        )
    }
)
public class ExternalProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "external_profile_seq")
    private Long id;

    @Column(nullable = false, length = 64)
    private String provider;

    @Column(name = "subject_id", nullable = false, length = 128)
    private String subjectId;
}
```

---

## 7. Numeric Long vs UUID vs Business Reference

### 7.1 Internal primary key: `Long`

Kelebihan:

- Compact.
- Cepat untuk join.
- Mudah di-index.
- Mudah dibaca di database.
- Sequence pooled sangat efisien.

Kekurangan:

- Mudah ditebak jika diekspos.
- Butuh database coordination.
- Dalam distributed multi-writer, perlu strategi tambahan.

Cocok untuk:

- internal enterprise system;
- relational-heavy model;
- banyak foreign key;
- high join workload;
- Oracle/PostgreSQL sequence.

---

### 7.2 Internal/external primary key: UUID

Kelebihan:

- Sulit ditebak.
- Bisa dibuat offline/distributed.
- Bagus untuk public API id jika tidak ingin expose sequence.

Kekurangan:

- Lebih berat untuk database.
- Debugging manual kurang nyaman.
- Random UUID buruk untuk index locality.

Cocok untuk:

- public-facing resource id;
- multi-region/distributed creation;
- event-driven systems;
- data sync antar node.

---

### 7.3 Business reference number

Contoh:

```text
APP-2026-000123
CASE-ENF-2026-004321
APL-2026-000045
```

Kelebihan:

- Bisa dibaca user.
- Cocok untuk surat, dashboard, audit, dan komunikasi manusia.
- Bisa mengandung domain category/year/agency.

Kekurangan:

- Generation bisa punya contention.
- Format bisa berubah.
- Gap/no-gap requirement sering konflik dengan transaction rollback.
- Bisa bocor informasi volume proses.

Prinsip:

```text
Jangan menjadikan business reference sebagai primary key hanya karena user melihatnya.
```

Desain yang lebih kuat:

```java
@Entity
@Table(
    name = "application",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_application_reference_no",
        columnNames = "reference_no"
    )
)
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
    private Long id;

    @Column(name = "reference_no", nullable = false, length = 40)
    private String referenceNo;
}
```

---

## 8. Business Uniqueness Harus Dijaga Database

### 8.1 Application validation saja tidak cukup

Contoh buruk:

```java
public void createUser(String email) {
    if (userRepository.existsByEmail(email)) {
        throw new DuplicateEmailException(email);
    }

    userRepository.save(new AppUser(email));
}
```

Dalam concurrency:

```text
T1: cek email belum ada
T2: cek email belum ada
T1: insert email
T2: insert email
```

Jika tidak ada unique constraint di database, duplicate bisa terjadi.

Solusi:

```sql
alter table app_user
add constraint uk_app_user_email unique (email);
```

Dan di entity:

```java
@Table(
    name = "app_user",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_app_user_email",
        columnNames = "email"
    )
)
```

Lalu service tetap boleh melakukan pre-check untuk user experience, tetapi correctness tetap di database.

```text
Pre-check = friendly validation.
Unique constraint = correctness guarantee.
```

---

### 8.2 Scope uniqueness harus jelas

Email global unique:

```sql
unique (email)
```

Email unique per tenant:

```sql
unique (tenant_id, email)
```

Case number unique per agency + year:

```sql
unique (agency_id, case_year, case_sequence)
```

External subject unique per provider:

```sql
unique (provider, subject_id)
```

Jangan asal membuat satu kolom unique tanpa memahami scope domain.

---

### 8.3 Case-insensitive uniqueness

Masalah:

```text
Fajar@example.com
fajar@example.com
FAJAR@example.com
```

Secara bisnis mungkin sama, secara database default belum tentu sama.

Solusi tergantung database:

- Normalize di application: simpan `email_normalized`.
- Unique constraint pada normalized column.
- Function-based index, misalnya `lower(email)` di database tertentu.
- Case-insensitive collation/citext di database tertentu.

Model defensible:

```java
@Entity
@Table(
    name = "app_user",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_app_user_email_normalized",
        columnNames = "email_normalized"
    )
)
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "app_user_seq")
    private Long id;

    @Column(name = "email", nullable = false, length = 320)
    private String email;

    @Column(name = "email_normalized", nullable = false, length = 320)
    private String emailNormalized;

    public void changeEmail(String newEmail) {
        this.email = newEmail;
        this.emailNormalized = normalizeEmail(newEmail);
    }

    private static String normalizeEmail(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
```

Catatan: normalization email secara sempurna tidak sesederhana lowercase seluruh string untuk semua provider/domain. Tetapi dari sisi persistence, poinnya adalah equality business harus dibuat eksplisit.

---

## 9. Composite Key

### 9.1 Kapan composite key masuk akal?

Composite key masuk akal untuk:

- join table murni;
- associative entity yang identitasnya memang kombinasi dua parent;
- lookup/detail line yang tidak punya identity mandiri;
- legacy schema;
- database integration dengan schema yang sudah ada;
- value-like child entity.

Contoh:

```text
application_role_assignment:
- user_id
- role_id
```

Jika tidak ada attribute tambahan, composite key `(user_id, role_id)` masuk akal.

Namun jika association punya lifecycle dan attribute sendiri:

```text
- assigned_at
- assigned_by
- effective_from
- effective_to
- approval_status
```

Maka association entity mungkin lebih baik punya surrogate key sendiri, plus unique constraint pada `(user_id, role_id, effective_from)` atau sesuai domain.

---

### 9.2 `@EmbeddedId`

`@EmbeddedId` menyimpan primary key sebagai value object.

```java
@Embeddable
public class CaseAssignmentId implements Serializable {

    @Column(name = "case_id")
    private Long caseId;

    @Column(name = "officer_id")
    private Long officerId;

    protected CaseAssignmentId() {
    }

    public CaseAssignmentId(Long caseId, Long officerId) {
        this.caseId = Objects.requireNonNull(caseId);
        this.officerId = Objects.requireNonNull(officerId);
    }

    public Long getCaseId() {
        return caseId;
    }

    public Long getOfficerId() {
        return officerId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CaseAssignmentId that)) return false;
        return Objects.equals(caseId, that.caseId)
            && Objects.equals(officerId, that.officerId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(caseId, officerId);
    }
}
```

Entity:

```java
@Entity
@Table(name = "case_assignment")
public class CaseAssignment {

    @EmbeddedId
    private CaseAssignmentId id;

    @MapsId("caseId")
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false)
    private CaseFile caseFile;

    @MapsId("officerId")
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false)
    private Officer officer;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;
}
```

Kelebihan `@EmbeddedId`:

- Identity direpresentasikan sebagai value object.
- Cocok untuk domain yang memang punya composite identity.
- Lebih eksplisit.
- Bisa dipakai sebagai repository id type.

Kekurangan:

- Query method bisa lebih verbose: `id.caseId`.
- DTO/projection perlu akses nested id.
- Jika terlalu banyak composite id, model terasa berat.

---

### 9.3 `@IdClass`

`@IdClass` memisahkan id class tetapi field id tetap berada langsung di entity.

Id class:

```java
public class CaseAssignmentId implements Serializable {
    private Long caseFile;
    private Long officer;

    public CaseAssignmentId() {
    }

    public CaseAssignmentId(Long caseFile, Long officer) {
        this.caseFile = caseFile;
        this.officer = officer;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CaseAssignmentId that)) return false;
        return Objects.equals(caseFile, that.caseFile)
            && Objects.equals(officer, that.officer);
    }

    @Override
    public int hashCode() {
        return Objects.hash(caseFile, officer);
    }
}
```

Entity:

```java
@Entity
@Table(name = "case_assignment")
@IdClass(CaseAssignmentId.class)
public class CaseAssignment {

    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false)
    private CaseFile caseFile;

    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false)
    private Officer officer;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;
}
```

Kelebihan `@IdClass`:

- Field id langsung berada di entity.
- Query bisa lebih natural.
- Cocok untuk legacy schema tertentu.

Kekurangan:

- Nama field di id class harus sinkron dengan entity.
- Lebih mudah salah mapping.
- Jika id berisi association, aturan provider/spec perlu dipahami.

---

### 9.4 Pilih `@EmbeddedId` atau `@IdClass`?

Rule of thumb:

```text
Gunakan @EmbeddedId jika id adalah value object yang ingin diperlakukan sebagai satu konsep.
Gunakan @IdClass jika schema legacy atau query ergonomics lebih penting.
```

Namun untuk sistem baru, sering kali pilihan lebih penting adalah:

```text
Apakah entity ini benar-benar butuh composite primary key?
Atau lebih baik surrogate key + unique constraint?
```

Contoh association dengan lifecycle kompleks:

```java
@Entity
@Table(
    name = "case_assignment",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_case_assignment_active",
        columnNames = {"case_id", "officer_id", "effective_from"}
    )
)
public class CaseAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_assignment_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false)
    private CaseFile caseFile;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false)
    private Officer officer;

    @Column(name = "effective_from", nullable = false)
    private LocalDate effectiveFrom;
}
```

Ini sering lebih mudah di-maintain daripada composite PK jika entity akan berkembang.

---

## 10. Derived Identity dan `@MapsId`

Derived identity terjadi ketika id child bergantung pada id parent.

Contoh: `ApplicationDetail` punya primary key sama dengan `Application`.

```java
@Entity
@Table(name = "application_detail")
public class ApplicationDetail {

    @Id
    private Long id;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "id")
    private Application application;

    @Column(name = "detail_text")
    private String detailText;
}
```

Makna:

```text
application_detail.id juga foreign key ke application.id.
```

Cocok untuk:

- one-to-one extension table;
- vertical splitting table;
- optional large/detail columns;
- table dengan lifecycle sangat tergantung parent.

Risiko:

- Coupling lifecycle sangat kuat.
- Insert ordering harus benar.
- Jika parent berubah/tidak ada, child tidak punya identity sendiri.

---

## 11. `equals()` dan `hashCode()` pada Entity

Ini bagian yang sangat penting.

### 11.1 Kenapa sulit?

Entity punya lifecycle:

```text
transient -> managed -> detached -> removed
```

Sebelum persist, generated id biasanya `null`.

```java
CaseFile a = new CaseFile(); // id null
CaseFile b = new CaseFile(); // id null
```

Jika `equals()` hanya berdasarkan id:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof CaseFile that)) return false;
    return Objects.equals(id, that.id);
}
```

Maka dua entity baru dengan `id == null` bisa dianggap sama jika tidak hati-hati.

Lebih buruk lagi jika entity dimasukkan ke `HashSet` sebelum id assigned:

```java
Set<CaseFile> set = new HashSet<>();
CaseFile c = new CaseFile();
set.add(c);

entityManager.persist(c); // id berubah dari null ke 100

System.out.println(set.contains(c)); // bisa false jika hashCode berubah
```

Karena `hashCode()` berubah setelah id assigned.

---

### 11.2 Strategy A: identity object default

Tidak override `equals()`/`hashCode()`.

Kelebihan:

- Aman dari hash mutation.
- Sederhana.
- Cocok jika entity tidak dipakai sebagai value di Set lintas persistence context.

Kekurangan:

- Dua instance dari row sama di persistence context berbeda dianggap tidak equal.
- Collection operation lintas detached/managed bisa tidak sesuai ekspektasi.

Untuk banyak aplikasi, ini acceptable jika:

```text
Entity tidak dipakai sebagai key Map/Set di luar persistence context.
Perbandingan entity dilakukan eksplisit via id.
```

---

### 11.3 Strategy B: equals berdasarkan immutable business key

Jika entity punya natural key yang immutable dan assigned sejak awal, bisa digunakan.

```java
@Entity
@Table(
    name = "country",
    uniqueConstraints = @UniqueConstraint(name = "uk_country_iso", columnNames = "iso_code")
)
public class Country {

    @Id
    @Column(name = "iso_code", length = 2)
    private String isoCode;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Country that)) return false;
        return Objects.equals(isoCode, that.isoCode);
    }

    @Override
    public int hashCode() {
        return Objects.hash(isoCode);
    }
}
```

Cocok jika:

- business key benar-benar immutable;
- tidak null setelah object dibuat;
- uniqueness dijaga database;
- tidak berubah karena koreksi bisnis.

Tidak cocok untuk email/user/case number yang mungkin berubah atau assigned belakangan.

---

### 11.4 Strategy C: equals berdasarkan id non-null + class hashCode stabil

Pattern yang sering dipakai untuk generated id:

```java
@Entity
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    private Long id;

    public Long getId() {
        return id;
    }

    @Override
    public final boolean equals(Object o) {
        if (this == o) return true;
        if (o == null) return false;
        if (getClass() != effectiveClass(o)) return false;

        CaseFile other = (CaseFile) o;
        return id != null && Objects.equals(id, other.id);
    }

    @Override
    public final int hashCode() {
        return effectiveClass(this).hashCode();
    }

    private static Class<?> effectiveClass(Object object) {
        // In plain JPA, object.getClass() may be enough.
        // With Hibernate proxies, prefer Hibernate.getClass(object) if provider-specific dependency is acceptable.
        return object.getClass();
    }
}
```

Karakteristik:

- Entity transient dengan id null tidak equal dengan entity lain kecuali same reference.
- Setelah id assigned, equality berdasarkan id.
- `hashCode()` tidak berubah setelah persist karena berdasarkan class, bukan id.

Kekurangan:

- Semua entity class punya hashCode sama per class, sehingga HashSet performance bisa kurang ideal jika banyak entity dalam Set.
- Perlu hati-hati dengan proxy class.

Hibernate-specific variant:

```java
import org.hibernate.Hibernate;

@Override
public final boolean equals(Object o) {
    if (this == o) return true;
    if (o == null) return false;
    if (Hibernate.getClass(this) != Hibernate.getClass(o)) return false;

    CaseFile other = (CaseFile) o;
    return id != null && Objects.equals(id, other.id);
}

@Override
public final int hashCode() {
    return Hibernate.getClass(this).hashCode();
}
```

Ini menghindari masalah proxy subclass.

---

### 11.5 Jangan gunakan mutable fields untuk `equals()`/`hashCode()`

Contoh buruk:

```java
@Override
public int hashCode() {
    return Objects.hash(status, title, assignedOfficer);
}
```

Jika field berubah setelah object masuk `HashSet`, struktur hash rusak.

```text
Entity adalah mutable object.
Mutable field tidak boleh menjadi dasar hashCode.
```

---

### 11.6 Jangan gunakan association lazy dalam equals/hashCode

Contoh buruk:

```java
@Override
public boolean equals(Object o) {
    CaseAssignment that = (CaseAssignment) o;
    return Objects.equals(caseFile, that.caseFile)
        && Objects.equals(officer, that.officer);
}
```

Masalah:

- Bisa trigger lazy loading.
- Bisa menyebabkan N+1 saat collection operation.
- Bisa recursion karena bidirectional association.
- Bisa stack overflow.
- Bisa membandingkan proxy dengan entity.

Lebih aman gunakan id field sederhana atau immutable embedded id.

---

### 11.7 Lombok warning

Hindari:

```java
@Data
@Entity
public class CaseFile {
    ...
}
```

Karena `@Data` membuat `equals()`, `hashCode()`, dan `toString()` berdasarkan semua field, termasuk association lazy.

Risiko:

- Lazy loading tidak sengaja.
- Stack overflow pada bidirectional relationship.
- Hash berubah saat field berubah.
- Sensitive data bocor di log.
- Performance buruk.

Jika memakai Lombok, lebih aman:

```java
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class CaseFile {
    ...
}
```

Atau definisikan `equals()`/`hashCode()` manual.

---

## 12. Identity dan Lazy Proxy

Hibernate dapat menggunakan proxy untuk lazy association.

```java
CaseFile ref = entityManager.getReference(CaseFile.class, 100L);
```

`ref` mungkin proxy yang belum load semua field. Namun id biasanya sudah diketahui.

Implikasi:

- `getClass()` pada proxy bisa berbeda dari entity class asli.
- `equals()` berbasis `getClass()` bisa gagal jika tidak memperhitungkan proxy.
- Mengakses non-id field bisa trigger query.
- `toString()` yang mengakses association bisa trigger lazy loading.

Contoh masalah:

```java
CaseFile loaded = entityManager.find(CaseFile.class, 100L);
CaseFile proxy = entityManager.getReference(CaseFile.class, 100L);

loaded.equals(proxy); // bisa false jika equals tidak proxy-safe
```

Di aplikasi yang sangat peduli portability, hindari terlalu banyak logic equality lintas proxy. Di aplikasi Hibernate-specific, `Hibernate.getClass()` bisa membantu.

---

## 13. Identity dan Detached Entity

Detached entity adalah entity yang sebelumnya managed, tetapi persistence context-nya sudah selesai.

```java
CaseFile caseFile = service.loadCase(100L); // transaction selesai, entity detached
```

Kemudian request lain mengirim perubahan:

```java
caseFile.changeTitle("New title");
service.save(caseFile);
```

Jika memakai `merge()`:

```java
CaseFile managed = entityManager.merge(caseFile);
```

Penting:

```text
merge tidak membuat detached entity menjadi managed.
merge menyalin state detached entity ke managed instance baru/yang sudah ada.
```

Identity penting karena merge menggunakan primary key untuk menemukan managed/database entity yang sesuai.

Risiko:

- Detached entity dengan id salah bisa overwrite row lain.
- DTO yang membawa id dari client harus divalidasi ownership/authorization-nya.
- Blind merge bisa menyebabkan mass assignment.
- Association detached bisa menyebabkan cascade merge yang tidak diinginkan.

Pattern lebih aman:

```java
@Transactional
public void changeCaseTitle(Long caseId, ChangeCaseTitleCommand command) {
    CaseFile caseFile = entityManager.find(CaseFile.class, caseId);
    if (caseFile == null) {
        throw new NotFoundException("Case not found");
    }

    caseFile.changeTitle(command.title());
}
```

Jangan:

```java
@Transactional
public void update(CaseFile incomingEntityFromApi) {
    entityManager.merge(incomingEntityFromApi);
}
```

Terutama untuk API eksternal.

---

## 14. Identity dan Repository API

### 14.1 Repository id type harus jelas

Spring Data/Jakarta Data style biasanya:

```java
public interface CaseFileRepository extends Repository<CaseFile, Long> {
    Optional<CaseFile> findById(Long id);
}
```

Jika composite id:

```java
public interface CaseAssignmentRepository extends Repository<CaseAssignment, CaseAssignmentId> {
    Optional<CaseAssignment> findById(CaseAssignmentId id);
}
```

Jangan menyamarkan id type sebagai `String` universal:

```java
interface GenericRepository<T> {
    Optional<T> findById(String id);
}
```

Karena:

- menghilangkan type safety;
- memaksa parsing di banyak tempat;
- membuat composite id awkward;
- memudahkan salah entity id;
- buruk untuk API internal.

---

### 14.2 Public id vs internal id

Untuk API publik, bisa jadi internal id tidak diekspos.

Internal:

```java
@Id
private Long id;
```

Public API:

```json
{
  "caseNumber": "CASE-2026-000123"
}
```

Atau:

```json
{
  "publicId": "018f8f5e-4e4b-7c35-8c42-b70a5f1f4b01"
}
```

Model:

```java
@Entity
@Table(
    name = "case_file",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_case_file_public_id", columnNames = "public_id"),
        @UniqueConstraint(name = "uk_case_file_case_number", columnNames = "case_number")
    }
)
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    private Long id;

    @Column(name = "public_id", nullable = false, updatable = false)
    private UUID publicId;

    @Column(name = "case_number", nullable = false, length = 64)
    private String caseNumber;
}
```

Kelebihan:

- Internal join tetap efisien dengan `Long`.
- Public API tidak expose sequential id.
- Business reference tetap human-readable.

Kekurangan:

- Ada kolom tambahan.
- Perlu unique constraint tambahan.
- Perlu mapping lookup dari public id ke internal id.

Untuk sistem besar, ini sering trade-off yang layak.

---

## 15. Identity dan Aggregate Boundary

Dalam domain-driven design, aggregate root punya identity. Child entity bisa punya identity lokal di dalam aggregate atau identity global.

Contoh:

```text
Application
 ├── Applicant
 ├── SupportingDocument
 └── Declaration
```

Pertanyaan desain:

```text
Apakah SupportingDocument bisa hidup sendiri di luar Application?
Apakah dokumen direferensikan modul lain?
Apakah ada audit/action langsung terhadap dokumen?
Apakah document id muncul di API?
Apakah document punya workflow sendiri?
```

Jika child benar-benar bagian aggregate:

```java
@OneToMany(mappedBy = "application", cascade = CascadeType.ALL, orphanRemoval = true)
private List<SupportingDocument> documents = new ArrayList<>();
```

Child tetap biasanya punya id database untuk kemudahan persistence:

```java
@Entity
public class SupportingDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "supporting_document_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Application application;
}
```

Namun operasi domain tetap melalui aggregate root:

```java
application.addDocument(documentCommand);
application.removeDocument(documentId);
```

Jangan otomatis membuat repository untuk semua child entity jika child tidak punya lifecycle mandiri.

---

## 16. Identity dan State Machine

Untuk case management/regulatory workflow, identity harus stabil selama state transition.

Contoh:

```text
Application#123
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
```

Yang berubah adalah state, bukan identity.

Jangan membuat row baru untuk setiap state jika domain-nya entity yang sama, kecuali memang menerapkan temporal/event sourcing model.

Model umum:

```java
@Entity
@Table(name = "application")
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private ApplicationStatus status;

    @Version
    private long version;

    public void submit() {
        if (status != ApplicationStatus.DRAFT) {
            throw new InvalidStateTransitionException(status, ApplicationStatus.SUBMITTED);
        }
        status = ApplicationStatus.SUBMITTED;
    }
}
```

Business reference juga stabil:

```text
APP-2026-000123 tetap sama dari draft sampai approved.
```

Jika setiap transition butuh audit:

```text
Application identity: application.id
Transition event identity: application_status_history.id
```

Jangan mencampur keduanya.

---

## 17. Identity dan Audit Trail

Audit trail perlu mereferensikan entity target secara stabil.

Contoh audit row:

```sql
create table audit_trail (
    id number(19) primary key,
    entity_type varchar2(100) not null,
    entity_id varchar2(100) not null,
    business_reference varchar2(100),
    action varchar2(100) not null,
    actor_id varchar2(100) not null,
    created_at timestamp not null,
    before_json clob,
    after_json clob
);
```

Kenapa `entity_id` sering string?

- Bisa menampung `Long`, `UUID`, atau composite serialized id.
- Audit table bisa generic lintas entity.

Namun hati-hati:

- Generic audit kehilangan foreign key constraint.
- Query audit bisa mahal.
- Composite id serialization harus konsisten.

Untuk entity penting/regulatory, bisa lebih defensible punya audit table spesifik:

```sql
create table application_status_history (
    id number(19) primary key,
    application_id number(19) not null references application(id),
    from_status varchar2(40),
    to_status varchar2(40) not null,
    changed_by number(19) not null,
    changed_at timestamp not null,
    reason varchar2(1000)
);
```

Prinsip:

```text
Audit event punya identity sendiri.
Entity yang diaudit punya identity sendiri.
Business reference boleh disalin untuk readability/historical search.
```

---

## 18. Identity dan Integration Boundary

### 18.1 Jangan sembarang expose internal id

Jika public API expose:

```http
GET /cases/123
```

Risiko:

- Resource enumeration.
- Tenant data leakage jika authorization lemah.
- Mengungkap volume data.
- Coupling client dengan internal DB id.

Alternatif:

```http
GET /cases/CASE-2026-000123
```

Atau:

```http
GET /cases/018f8f5e-4e4b-7c35-8c42-b70a5f1f4b01
```

Namun business reference juga bisa bocor informasi. Jadi pilihan tergantung threat model.

---

### 18.2 External id mapping

Integrasi dengan sistem eksternal sering butuh mapping:

```text
internal_app_user.id = 100
singpass.subject_id = S123...
corppass.subject_id = C456...
legacy_user_id = ABC999
```

Jangan memaksa satu external id menjadi primary key internal jika user bisa login dari banyak provider.

Model:

```java
@Entity
@Table(name = "user_account")
public class UserAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_account_seq")
    private Long id;
}
```

```java
@Entity
@Table(
    name = "user_external_identity",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_user_external_identity_provider_subject",
        columnNames = {"provider", "subject_id"}
    )
)
public class UserExternalIdentity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_external_identity_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_account_id", nullable = false)
    private UserAccount userAccount;

    @Column(nullable = false, length = 64)
    private String provider;

    @Column(name = "subject_id", nullable = false, length = 256)
    private String subjectId;
}
```

Ini memberi ruang untuk:

- multiple identity providers;
- account linking;
- external id replacement;
- audit login history;
- migration;
- provider deprecation.

---

## 19. Identity dan Event-Driven Architecture

Event payload harus membawa identity yang tepat.

Contoh event internal:

```json
{
  "eventId": "018f8f60-...",
  "eventType": "ApplicationSubmitted",
  "applicationId": 123,
  "applicationReferenceNo": "APP-2026-000123",
  "occurredAt": "2026-06-16T04:00:00Z"
}
```

Untuk consumer internal dalam satu bounded context, `applicationId` mungkin cukup.

Untuk consumer eksternal, lebih baik public/business id:

```json
{
  "eventId": "018f8f60-...",
  "eventType": "ApplicationSubmitted",
  "applicationPublicId": "018f8f5e-...",
  "applicationReferenceNo": "APP-2026-000123"
}
```

Prinsip:

```text
Event id != aggregate id.
Aggregate id != business reference.
Business reference != idempotency key.
Correlation id != causation id.
```

Jangan mencampur semua id ini.

---

## 20. Identity dan Idempotency

Idempotency key adalah identity dari request/operation, bukan identity entity.

Contoh:

```http
POST /applications
Idempotency-Key: 8f7d1a...
```

Jika request retry karena timeout, server harus tahu ini operasi yang sama.

Tabel:

```sql
create table idempotency_record (
    idempotency_key varchar2(128) primary key,
    operation varchar2(100) not null,
    request_hash varchar2(128) not null,
    response_body clob,
    status varchar2(40) not null,
    created_at timestamp not null
);
```

Jangan memakai generated entity id sebagai idempotency key, karena id baru diketahui setelah create. Jangan memakai business reference jika business reference baru dibuat sebagai efek operasi.

---

## 21. Identity dan Database Migration

Desain identity mempengaruhi migration.

### 21.1 Mengubah primary key itu mahal

Jika tabel sudah punya banyak foreign key:

```text
application.id direferensikan oleh:
- case_file.application_id
- document.application_id
- audit_trail.entity_id
- payment.application_id
- correspondence.application_id
- approval_task.application_id
```

Mengubah type/value primary key bisa sangat mahal.

Karena itu pilih primary key yang stabil dari awal.

---

### 21.2 Menambahkan public id lebih mudah daripada mengganti primary key

Jika awalnya expose internal id lalu ingin berhenti:

```sql
alter table application add public_id uuid;
update application set public_id = gen_random_uuid();
alter table application alter column public_id set not null;
create unique index uk_application_public_id on application(public_id);
```

Lalu API berpindah dari:

```http
GET /applications/123
```

Ke:

```http
GET /applications/018f8f5e-...
```

Internal foreign key tetap aman.

---

### 21.3 Natural key correction

Jika natural key menjadi primary key:

```text
user.email sebagai PK
```

Saat email perlu dikoreksi:

```text
old@example.com -> new@example.com
```

Semua foreign key harus ikut update. Ini mungkin cascade update, tetapi tetap mahal dan berisiko.

Jika email hanya unique column:

```text
update app_user set email = ? where id = ?
```

Jauh lebih aman.

---

## 22. Identity dan Performance

### 22.1 Primary key size mempengaruhi index dan join

`Long`:

- 8 bytes.
- Compact index.
- Fast join.

UUID native:

- 16 bytes.
- Masih reasonable.

UUID string:

- 36 chars atau lebih.
- Index lebih besar.
- Join lebih mahal.

Composite key:

- Bisa jauh lebih besar.
- Foreign key child ikut membawa beberapa kolom.
- Join predicate lebih panjang.
- Index design lebih kompleks.

Tidak berarti composite/UUID selalu buruk. Tetapi trade-off harus disadari.

---

### 22.2 Identity strategy mempengaruhi insert throughput

Urutan umum untuk high-volume insert di Hibernate:

```text
SEQUENCE dengan pooled allocation biasanya lebih batch-friendly daripada IDENTITY.
```

Karena provider bisa mendapatkan id sebelum insert dan mengelompokkan insert.

Untuk Oracle/PostgreSQL, sequence pooled umumnya pilihan kuat.

Untuk MySQL yang historically mengandalkan auto-increment, identity umum dipakai, tetapi perlu sadar terhadap batching limit.

---

### 22.3 Random UUID dan index locality

Random UUID sebagai primary key dapat menyebabkan insert tersebar di seluruh index B-tree.

Efek:

- page split lebih banyak;
- cache locality lebih buruk;
- index bloat lebih mungkin;
- write amplification meningkat.

Time-ordered UUID/ULID bisa membantu, tetapi tetap perlu evaluasi database support dan ordering semantics.

---

## 23. Identity dan Security

### 23.1 Sequential id enumeration

Jika API:

```http
GET /cases/100
GET /cases/101
GET /cases/102
```

Penyerang bisa mencoba id lain.

Mitigasi utama tetap authorization:

```text
Jangan mengandalkan id tidak bisa ditebak sebagai security boundary.
```

Namun id tidak mudah ditebak dapat mengurangi enumeration risk.

Layer yang bisa dipakai:

- Authorization check wajib berdasarkan user/tenant/role.
- Public UUID id untuk external API.
- Rate limiting.
- Audit access.
- Object-level authorization.

---

### 23.2 Tenant id harus bagian dari lookup/security condition

Jangan:

```java
caseRepository.findById(caseId)
```

Lalu authorization belakangan jika raw entity sudah keburu dipakai.

Lebih defensible:

```java
Optional<CaseFile> findByIdAndTenantId(Long id, Long tenantId);
```

Atau query dengan scope:

```java
@Query("""
    select c
    from CaseFile c
    where c.id = :caseId
      and c.tenant.id = :tenantId
""")
Optional<CaseFile> findTenantCase(Long tenantId, Long caseId);
```

Business uniqueness juga sering harus tenant-scoped:

```sql
unique (tenant_id, case_number)
```

---

## 24. Identity dan Database-Specific Behavior

### 24.1 Oracle

Umum:

- Sequence sangat natural.
- Identity column tersedia pada versi modern, tetapi sequence tetap banyak dipakai.
- CLOB/audit-heavy table biasanya tetap memakai numeric surrogate key.
- Sequence gap normal.

Rekomendasi umum:

```java
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "entity_seq")
@SequenceGenerator(name = "entity_seq", sequenceName = "entity_seq", allocationSize = 50)
```

Pastikan allocation size sesuai dengan sequence increment/provider optimizer.

---

### 24.2 PostgreSQL

Umum:

- Sequence/identity tersedia.
- UUID native didukung.
- Partial unique index sangat berguna untuk soft delete / conditional uniqueness.
- `bigserial`/identity sering dipakai.

Contoh soft delete uniqueness:

```sql
create unique index uk_user_email_active
on app_user (lower(email))
where deleted_at is null;
```

Ini tidak portable JPA annotation murni, tetapi sangat berguna secara database design.

---

### 24.3 MySQL/InnoDB

Umum:

- Auto-increment identity umum.
- Primary key sering clustered, sehingga random UUID PK bisa berdampak besar.
- Gap/next-key locking perlu diperhatikan untuk uniqueness/range operation.

Jika UUID perlu dipakai, pertimbangkan:

- binary storage;
- ordered UUID;
- surrogate numeric PK + public UUID unique key.

---

### 24.4 SQL Server

Umum:

- Identity umum.
- Sequence juga tersedia.
- `uniqueidentifier` tersedia, tetapi random GUID sebagai clustered PK bisa bermasalah.
- Sequential GUID bisa dipertimbangkan.

---

## 25. Design Patterns untuk Identity

### 25.1 Internal Long id + external public UUID + business reference

Pattern kuat untuk sistem besar:

```java
@Entity
@Table(
    name = "case_file",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_case_file_public_id", columnNames = "public_id"),
        @UniqueConstraint(name = "uk_case_file_case_number", columnNames = "case_number")
    }
)
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "case_file_seq", allocationSize = 50)
    private Long id;

    @Column(name = "public_id", nullable = false, updatable = false)
    private UUID publicId;

    @Column(name = "case_number", nullable = false, length = 64)
    private String caseNumber;

    @PrePersist
    void prePersist() {
        if (publicId == null) {
            publicId = UUID.randomUUID();
        }
    }
}
```

Penggunaan:

- Internal foreign key: `id`.
- External API: `publicId` atau `caseNumber`.
- Human communication: `caseNumber`.
- Audit readability: copy `caseNumber`.
- Database correctness: unique constraints.

---

### 25.2 Business key as unique constraint, not PK

```java
@Entity
@Table(
    name = "officer",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_officer_staff_no",
        columnNames = "staff_no"
    )
)
public class Officer {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "officer_seq")
    private Long id;

    @Column(name = "staff_no", nullable = false, length = 32)
    private String staffNo;
}
```

Ini menjaga fleksibilitas jika staff number format berubah.

---

### 25.3 External identity mapping table

```java
@Entity
@Table(
    name = "party_external_identifier",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_party_external_identifier",
        columnNames = {"source_system", "external_id"}
    )
)
public class PartyExternalIdentifier {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "party_external_identifier_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "party_id", nullable = false)
    private Party party;

    @Column(name = "source_system", nullable = false, length = 64)
    private String sourceSystem;

    @Column(name = "external_id", nullable = false, length = 256)
    private String externalId;
}
```

Cocok untuk:

- multiple external systems;
- migration;
- identity reconciliation;
- external id correction;
- audit.

---

### 25.4 Reference number generator sebagai domain service

Jangan campur business reference generation dengan primary key generation.

```java
@Transactional
public Application createApplication(CreateApplicationCommand command) {
    Application application = new Application();
    application.assignReferenceNo(referenceNumberService.nextApplicationReference());
    application.fillFrom(command);
    entityManager.persist(application);
    return application;
}
```

Reference number generation bisa memakai:

- database sequence per prefix/year;
- table counter dengan pessimistic lock;
- separate numbering service;
- preallocated block;
- post-commit assignment jika business acceptable.

Jika bisnis meminta no-gap numbering, hati-hati. No-gap numbering sangat mahal dalam concurrent transactional system karena rollback menciptakan gap. Banyak kebutuhan “no-gap” sebenarnya adalah kebutuhan audit/explainability, bukan primary id.

---

## 26. Anti-Pattern

### 26.1 Menjadikan email sebagai primary key

Masalah:

- Email bisa berubah.
- Case-insensitive equality rumit.
- Foreign key besar.
- Privacy leak.
- Account merge sulit.

Lebih baik:

```text
id sebagai PK, email sebagai unique normalized business attribute.
```

---

### 26.2 `@GeneratedValue(strategy = AUTO)` tanpa sadar konsekuensi

Masalah:

- Behavior tergantung provider/database.
- Migration antar DB bisa berubah.
- Performance insert bisa berubah.

Lebih baik explicit.

---

### 26.3 Semua entity memakai UUID string sebagai PK tanpa alasan

Masalah:

- Index besar.
- Join mahal.
- Storage boros.
- Debugging tidak nyaman.

Lebih baik:

```text
Gunakan Long internal id + UUID public id jika kebutuhan utamanya external non-enumerability.
```

---

### 26.4 Composite key untuk entity yang akan berkembang

Masalah:

- Mapping lebih kompleks.
- Query lebih verbose.
- Foreign key lebih berat.
- Migration lebih mahal.

Lebih baik surrogate key + unique constraint jika entity punya lifecycle sendiri.

---

### 26.5 `equals()`/`hashCode()` pakai semua field

Masalah:

- Lazy loading.
- Stack overflow.
- Hash mutation.
- Performance buruk.

Hindari Lombok `@Data` pada entity.

---

### 26.6 Business uniqueness hanya dicek di service

Masalah:

- Race condition.
- Duplicate data.
- Correctness illusion.

Wajib database unique constraint.

---

### 26.7 Menganggap id harus tanpa gap

Masalah:

- Sequence gap normal.
- Rollback menciptakan gap.
- Pooled optimizer menciptakan gap saat restart.
- No-gap requirement menciptakan contention.

Pisahkan:

```text
technical id != business sequence number
```

---

### 26.8 Blind merge entity dari API

Masalah:

- Overwrite field yang tidak seharusnya.
- Security issue.
- Association hijacking.
- Detached graph cascade chaos.

Lebih baik load managed entity by id, lalu apply command.

---

## 27. Decision Framework

### 27.1 Memilih primary key

Gunakan pertanyaan ini:

```text
Apakah entity direferensikan banyak tabel?
Apakah business key bisa berubah?
Apakah id perlu diekspos keluar?
Apakah creation distributed/offline?
Apakah insert volume tinggi?
Database utama apa?
Apakah perlu cross-system reconciliation?
Apakah ada tenant scope?
Apakah entity punya lifecycle panjang?
```

Rekomendasi default:

| Kondisi | Rekomendasi |
|---|---|
| Enterprise relational system, banyak join | `Long` surrogate key dengan sequence/identity sesuai DB |
| Oracle/PostgreSQL high insert | `SEQUENCE` + allocation/pooled |
| MySQL simple app | `IDENTITY` acceptable |
| Public API but internal relational heavy | `Long` internal PK + UUID public id |
| Distributed creation tanpa DB coordination | UUID/ULID/custom id |
| Immutable lookup code | Natural key possible |
| Association murni dua parent | Composite key possible |
| Association punya lifecycle/attribute | Surrogate key + unique constraint |

---

### 27.2 Memilih business uniqueness

Pertanyaan:

```text
Unik secara global atau per tenant?
Unik selamanya atau hanya aktif?
Unik setelah status tertentu?
Case-sensitive atau case-insensitive?
Bisa berubah atau immutable?
Perlu soft delete?
Perlu historical duplicate?
```

Contoh:

| Rule | Constraint |
|---|---|
| Email unik global | `unique(email_normalized)` |
| Email unik per tenant | `unique(tenant_id, email_normalized)` |
| Case number unik per agency | `unique(agency_id, case_number)` |
| Active assignment unik | partial unique index atau `(case_id, officer_id, active_flag)` dengan caveat |
| External id unik per provider | `unique(provider, subject_id)` |

---

### 27.3 Memilih equals/hashCode

| Entity type | Strategy |
|---|---|
| Generated surrogate id mutable entity | id non-null equality + stable class hash, atau tidak override |
| Immutable natural key entity | business key equality |
| Composite id value object | all id fields equality |
| Entity dengan lazy associations | Jangan include association |
| Entity dipakai di `HashSet` sebelum persist | Hindari hash berbasis generated id |

---

## 28. Worked Example: Case Management Identity Model

### 28.1 Requirements

Sistem punya:

- Application.
- CaseFile.
- Appeal.
- Officer.
- Assignment.
- Document.
- AuditTrail.
- External profile dari identity provider.

Kebutuhan:

- User melihat reference number.
- API eksternal tidak expose internal sequential id.
- Internal join harus efisien.
- Case number unik per agency.
- Officer staff number bisa berubah karena HR migration.
- External identity bisa lebih dari satu provider.
- Assignment punya effective period dan audit.

---

### 28.2 Application

```java
@Entity
@Table(
    name = "application",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_application_public_id", columnNames = "public_id"),
        @UniqueConstraint(name = "uk_application_reference_no", columnNames = "reference_no")
    }
)
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
    @SequenceGenerator(name = "application_seq", sequenceName = "application_seq", allocationSize = 50)
    private Long id;

    @Column(name = "public_id", nullable = false, updatable = false)
    private UUID publicId;

    @Column(name = "reference_no", nullable = false, length = 40)
    private String referenceNo;

    @Version
    private long version;

    @PrePersist
    void prePersist() {
        if (publicId == null) {
            publicId = UUID.randomUUID();
        }
    }
}
```

Reasoning:

- `id`: internal FK.
- `publicId`: external API.
- `referenceNo`: human/business reference.
- `version`: concurrency control, bukan identity.

---

### 28.3 CaseFile

```java
@Entity
@Table(
    name = "case_file",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_case_file_public_id", columnNames = "public_id"),
        @UniqueConstraint(name = "uk_case_file_agency_case_no", columnNames = {"agency_id", "case_number"})
    }
)
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "case_file_seq", allocationSize = 50)
    private Long id;

    @Column(name = "public_id", nullable = false, updatable = false)
    private UUID publicId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "agency_id", nullable = false)
    private Agency agency;

    @Column(name = "case_number", nullable = false, length = 64)
    private String caseNumber;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private CaseStatus status;

    @Version
    private long version;
}
```

Reasoning:

- Case number unik per agency, bukan global.
- Internal FK tetap `id`.
- Public API bisa pakai `publicId`.
- Workflow concurrency pakai `version`.

---

### 28.4 Assignment

Karena assignment punya effective period, audit, dan mungkin status, jangan composite PK murni.

```java
@Entity
@Table(
    name = "case_assignment",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_case_assignment_period",
        columnNames = {"case_file_id", "officer_id", "effective_from"}
    )
)
public class CaseAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_assignment_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_file_id", nullable = false)
    private CaseFile caseFile;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false)
    private Officer officer;

    @Column(name = "effective_from", nullable = false)
    private LocalDate effectiveFrom;

    @Column(name = "effective_to")
    private LocalDate effectiveTo;
}
```

Reasoning:

- Assignment punya identity sendiri.
- Historical assignment bisa disimpan.
- Unique constraint menjaga duplicate period.
- Lebih mudah ditambah status/approval.

---

### 28.5 External Identity

```java
@Entity
@Table(
    name = "party_external_identity",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_party_ext_identity_provider_subject",
        columnNames = {"provider", "subject_id"}
    )
)
public class PartyExternalIdentity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "party_external_identity_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "party_id", nullable = false)
    private Party party;

    @Column(name = "provider", nullable = false, length = 64)
    private String provider;

    @Column(name = "subject_id", nullable = false, length = 256)
    private String subjectId;
}
```

Reasoning:

- External identity bukan primary identity internal.
- Multiple provider possible.
- Correction/migration possible.

---

## 29. Failure Modes

### 29.1 Duplicate business row karena tidak ada unique constraint

Symptom:

```text
Dua application dengan reference number sama.
```

Cause:

```text
Service melakukan exists check tetapi database tidak punya unique constraint.
```

Fix:

- Tambah unique constraint.
- Bersihkan duplicate data.
- Tangani constraint violation.
- Pre-check tetap boleh untuk UX.

---

### 29.2 HashSet kehilangan entity setelah persist

Symptom:

```text
set.contains(entity) false setelah entity dipersist.
```

Cause:

```text
hashCode berbasis generated id yang berubah dari null ke value.
```

Fix:

- Jangan gunakan generated id mutable sebagai hashCode.
- Gunakan stable hash.
- Jangan simpan transient entity di hash collection.

---

### 29.3 Lazy loading saat logging

Symptom:

```text
Logging entity menyebabkan query tambahan atau LazyInitializationException.
```

Cause:

```text
toString/equals/hashCode mengakses lazy association.
```

Fix:

- Jangan generate `toString` semua field.
- Jangan include association.
- Log id/reference saja.

---

### 29.4 Natural key berubah dan cascade update kacau

Symptom:

```text
Update email/staff number gagal karena foreign key constraint.
```

Cause:

```text
Mutable business key dijadikan primary key.
```

Fix:

- Migration ke surrogate key jika perlu.
- Jadikan business key unique column.

---

### 29.5 Insert batch lambat

Symptom:

```text
Batch insert 100k row lambat, query insert satu-satu.
```

Cause:

```text
IDENTITY generation menghambat JDBC batching.
```

Fix:

- Jika database mendukung, gunakan sequence pooled.
- Tune batch size.
- Flush/clear per chunk.
- Pertimbangkan native bulk load untuk ETL besar.

---

### 29.6 Tenant data leakage

Symptom:

```text
User tenant A bisa akses resource tenant B jika menebak id.
```

Cause:

```text
Lookup hanya by id tanpa tenant scope.
```

Fix:

- Query by `id + tenant_id`.
- Object-level authorization.
- Unique business key tenant-scoped.
- Jangan hanya bergantung pada UUID sulit ditebak.

---

## 30. Checklist Desain Identity

Gunakan checklist ini saat mendesain entity baru.

### 30.1 Primary key checklist

- [ ] Apakah primary key immutable?
- [ ] Apakah primary key tidak punya makna bisnis yang bisa berubah?
- [ ] Apakah type primary key efisien untuk join/index?
- [ ] Apakah id generation cocok dengan database target?
- [ ] Apakah strategy explicit, bukan `AUTO` tanpa alasan?
- [ ] Apakah insert batching dipertimbangkan?
- [ ] Apakah id akan diekspos ke public API?
- [ ] Jika diekspos, apakah enumeration risk diterima?
- [ ] Apakah perlu public id terpisah?
- [ ] Apakah sequence allocation size masuk akal?

### 30.2 Business identity checklist

- [ ] Apa business key entity ini?
- [ ] Apakah business key immutable atau mutable?
- [ ] Apakah uniqueness global atau scoped?
- [ ] Apakah case-sensitive?
- [ ] Apakah perlu normalized column?
- [ ] Apakah soft delete mempengaruhi uniqueness?
- [ ] Apakah unique constraint sudah ada di DB?
- [ ] Apakah error duplicate ditangani di application layer?

### 30.3 Composite key checklist

- [ ] Apakah composite key benar-benar natural untuk entity ini?
- [ ] Apakah entity akan punya lifecycle/attribute tambahan?
- [ ] Apakah child direferensikan banyak tabel?
- [ ] Apakah `@EmbeddedId` lebih cocok daripada `@IdClass`?
- [ ] Apakah id class `Serializable`?
- [ ] Apakah id class punya `equals()`/`hashCode()` benar?
- [ ] Apakah association dalam id tidak memicu lazy loading aneh?

### 30.4 equals/hashCode checklist

- [ ] Apakah entity perlu override equality?
- [ ] Apakah menggunakan mutable field? Jika iya, salah.
- [ ] Apakah menggunakan lazy association? Jika iya, salah.
- [ ] Apakah generated id null case ditangani?
- [ ] Apakah hashCode stabil sebelum/sesudah persist?
- [ ] Apakah proxy dipertimbangkan?
- [ ] Apakah Lombok `@Data` dihindari?

### 30.5 Integration checklist

- [ ] Apakah external system id disimpan terpisah?
- [ ] Apakah public API memakai id yang tepat?
- [ ] Apakah event payload membawa aggregate id/event id/correlation id yang benar?
- [ ] Apakah idempotency key terpisah dari entity id?
- [ ] Apakah audit trail menyimpan reference yang stabil?

---

## 31. Latihan / Scenario

### Scenario 1 — Email sebagai primary key

Kamu menemukan entity:

```java
@Entity
public class User {
    @Id
    private String email;
}
```

Pertanyaan:

1. Apa risiko desain ini?
2. Bagaimana migration path ke surrogate key?
3. Bagaimana menjaga email tetap unique?
4. Bagaimana menangani case-insensitive duplicate?

Jawaban yang diharapkan:

- Tambah `id` surrogate key.
- Tambah `email_normalized`.
- Unique constraint pada `email_normalized` atau `(tenant_id, email_normalized)`.
- Update foreign key bertahap jika ada.
- API tidak lagi menjadikan email sebagai resource id utama kecuali memang business requirement.

---

### Scenario 2 — Case number harus no-gap

Business meminta:

```text
Case number harus CASE-2026-000001, 000002, 000003 tanpa gap.
```

Pertanyaan:

1. Apakah ini cocok memakai primary key sequence?
2. Apa yang terjadi jika transaction rollback setelah nomor diambil?
3. Apakah no-gap benar-benar requirement legal, atau hanya readability?
4. Apa alternatif desain?

Jawaban yang diharapkan:

- Jangan samakan primary key dengan case number.
- Sequence technical id boleh gap.
- Jika no-gap benar-benar wajib, perlu serialized numbering process dan audit void/cancelled number.
- Lebih baik explainable gap daripada mengorbankan concurrency tanpa alasan jelas.

---

### Scenario 3 — Assignment composite key

Tabel:

```text
case_assignment(case_id, officer_id, assigned_at, assigned_by, status)
```

Pertanyaan:

1. Apakah `(case_id, officer_id)` cukup sebagai PK?
2. Bagaimana jika officer yang sama bisa assigned ulang di masa depan?
3. Bagaimana jika assignment punya approval workflow?
4. Apakah surrogate key lebih tepat?

Jawaban yang diharapkan:

- Jika assignment punya history/lifecycle, surrogate key lebih fleksibel.
- Unique constraint harus mencerminkan rule bisnis, misalnya active assignment per case/officer atau effective period.

---

### Scenario 4 — Public API expose `/cases/{id}`

API saat ini:

```http
GET /cases/123
```

Pertanyaan:

1. Apa risikonya?
2. Apakah UUID menyelesaikan security problem?
3. Apa query repository yang lebih aman untuk multi-tenant?

Jawaban yang diharapkan:

- Risiko enumeration.
- UUID membantu mengurangi tebakan tapi bukan authorization.
- Query harus scoped by tenant/user permission.

---

## 32. Ringkasan

Identity adalah fondasi persistence design. Dalam JPA/Hibernate, kesalahan identity akan menyebar ke mapping, repository, transaction, caching, audit, event, API, dan migration.

Prinsip utama:

```text
Object identity bukan persistence identity.
Persistence identity bukan selalu business identity.
Business identity bukan selalu database primary key.
Event identity bukan aggregate identity.
Idempotency key bukan entity id.
Correlation id bukan business id.
```

Rekomendasi default untuk sistem enterprise besar:

```text
Gunakan surrogate key internal yang stabil dan efisien.
Gunakan business key sebagai unique constraint.
Gunakan public id terpisah jika API eksternal tidak boleh expose internal id.
Gunakan sequence pooled untuk database yang mendukung jika insert throughput penting.
Jangan menggunakan mutable business field untuk primary key.
Jangan mengandalkan application-only uniqueness check.
Jangan generate equals/hashCode entity secara sembarangan.
```

Desain identity yang baik membuat sistem lebih mudah:

- di-query;
- di-maintain;
- di-migrate;
- di-audit;
- di-scale;
- di-debug saat incident;
- dijaga correctness-nya dalam concurrency.

---

## 33. Referensi Resmi dan Lanjutan

Referensi yang relevan untuk bagian ini:

1. Jakarta Persistence 3.2 Specification — bagian primary key, composite primary key, `@Id`, `@EmbeddedId`, `@IdClass`, entity identity, dan persistence context.
2. Jakarta Persistence API Documentation — `EntityManager`, `IdClass`, `EmbeddedId`, `GeneratedValue`, `SequenceGenerator`, `TableGenerator`.
3. Hibernate ORM User Guide — identifiers, generated values, composite identifiers, natural ids, UUID generation, sequence optimizers.
4. Hibernate ORM 7 Introduction/User Guide — modern identifier generation dan generated values.
5. Spring Data JPA documentation — repository id type, `findById`, composite id ergonomics, query derivation impact.

---

## 34. Status Seri

Seri belum selesai.

Part saat ini: **Part 003 dari 032**.

Part berikutnya:

```text
Part 004 — Entity Lifecycle and Persistence Context Internals
```
