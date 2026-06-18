# 00 — MyBatis Orientation: SQL-First Persistence Mental Model

Series: `learn-java-mybatis-sql-mapper-persistence-engineering`  
Part: `00`  
File: `00-mybatis-orientation-sql-first-persistence-mental-model.md`  
Scope: Java 8 sampai Java 25  
Status seri: **belum selesai** — ini adalah bagian 0 dari 34 bagian.

---

## Tujuan Bagian Ini

Bagian ini bukan tutorial “cara membuat mapper pertama”. Bagian ini adalah fondasi cara berpikir.

Setelah menyelesaikan bagian ini, targetnya Anda bisa menjawab pertanyaan-pertanyaan berikut dengan jelas:

1. Apa sebenarnya MyBatis?
2. Kenapa MyBatis bukan sekadar “alternatif Hibernate”?
3. Apa perbedaan mental model MyBatis, JDBC, JPA/Hibernate, Spring Data JDBC, jOOQ, dan query builder?
4. Kapan MyBatis adalah pilihan yang kuat?
5. Kapan MyBatis justru pilihan yang salah?
6. Apa risiko production yang khas di sistem MyBatis?
7. Bagaimana cara menilai desain persistence layer berbasis MyBatis?
8. Skill apa yang membedakan engineer biasa dengan engineer top-tier ketika memakai MyBatis?

Premis utama bagian ini:

> MyBatis bukan framework untuk menyembunyikan SQL. MyBatis adalah framework untuk membuat SQL eksplisit tetap bisa dikelola secara disiplin dalam aplikasi Java modern.

---

## 1. Posisi MyBatis dalam Dunia Persistence Java

Di aplikasi enterprise, persistence layer biasanya punya tanggung jawab berikut:

- mengirim perintah ke database;
- mengikat parameter Java ke SQL;
- membaca `ResultSet`;
- mengubah baris database menjadi object/projection Java;
- ikut dalam transaction boundary;
- menangani error database;
- menjaga query tetap maintainable;
- menjaga performa SQL tetap bisa diprediksi;
- menjaga perubahan schema tidak mematahkan aplikasi diam-diam.

Secara resmi, MyBatis dijelaskan sebagai persistence framework yang mendukung **custom SQL, stored procedure, dan advanced mappings**. MyBatis mengurangi banyak boilerplate JDBC, terutama manual parameter setting dan result retrieval. MyBatis dapat memakai XML atau annotation untuk konfigurasi dan mapping Java object ke database record.

Namun definisi pendek seperti itu belum cukup. Definisi operasional yang lebih berguna untuk engineer adalah:

> MyBatis adalah SQL mapper framework: Java method dipasangkan ke SQL statement, lalu MyBatis menangani parameter binding, statement execution, dan result mapping.

Jadi unit utama MyBatis bukan entity table seperti di ORM. Unit utama MyBatis adalah:

```text
Mapper method
  -> Mapped SQL statement
  -> Bound parameters
  -> JDBC execution
  -> Result mapping
  -> Java return value
```

Contoh mental model sederhana:

```java
public interface UserMapper {
    UserRow findById(long id);
}
```

```xml
<select id="findById" parameterType="long" resultMap="UserRowMap">
  SELECT
    u.id,
    u.username,
    u.email,
    u.status,
    u.created_at
  FROM users u
  WHERE u.id = #{id}
</select>
```

Yang penting bukan hanya “bisa query”. Yang penting adalah kontrak:

```text
findById(long id)
  input  : one user id
  output : zero or one user row
  SQL    : explicit select by primary key
  risk   : if duplicate row exists, contract broken
  owner  : UserMapper
```

Di MyBatis, SQL adalah bagian dari desain aplikasi, bukan detail tersembunyi.

---

## 2. Masalah yang Diselesaikan MyBatis

Untuk memahami MyBatis, mulai dari masalah JDBC langsung.

Dengan JDBC, query sederhana bisa menjadi verbose:

```java
String sql = """
    SELECT id, username, email, status
    FROM users
    WHERE id = ?
    """;

try (Connection connection = dataSource.getConnection();
     PreparedStatement statement = connection.prepareStatement(sql)) {

    statement.setLong(1, id);

    try (ResultSet rs = statement.executeQuery()) {
        if (!rs.next()) {
            return Optional.empty();
        }

        UserRow row = new UserRow(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("email"),
            rs.getString("status")
        );

        return Optional.of(row);
    }
}
```

Masalah JDBC langsung:

1. Terlalu banyak boilerplate.
2. Parameter index mudah salah.
3. Column name mapping mudah salah.
4. Exception handling berulang.
5. Resource handling berulang.
6. Transaction integration harus dijaga manual atau lewat framework lain.
7. Query logic bercampur dengan object mapping logic.
8. Sulit menjaga konsistensi jika ada ratusan query.

MyBatis mengurangi beban tersebut dengan memisahkan:

```text
Java interface       : kontrak operasi persistence
XML/annotation SQL   : statement SQL
MyBatis runtime      : binding + execution + mapping
Spring integration   : transaction + lifecycle + exception translation
```

Sehingga engineer bisa fokus pada bagian yang memang penting:

- SQL apa yang dieksekusi;
- parameter apa yang boleh masuk;
- result seperti apa yang valid;
- transaction boundary ada di mana;
- behavior apa yang harus terjadi ketika row tidak ditemukan, terlalu banyak row, atau update count tidak sesuai.

---

## 3. Yang Tidak Diselesaikan MyBatis Secara Otomatis

Ini bagian penting. MyBatis tidak otomatis membuat persistence layer Anda benar.

MyBatis tidak otomatis:

- mendesain schema yang baik;
- memilih index yang tepat;
- menghindari query lambat;
- mencegah N+1 jika Anda membuat nested select sembarangan;
- mencegah SQL injection jika Anda memakai string substitution secara salah;
- memastikan business invariant benar;
- memastikan pagination stabil;
- memastikan locking benar;
- memastikan optimistic concurrency dipakai;
- memastikan migration aman;
- memastikan mapper tidak menjadi dumping ground;
- memastikan XML tetap terbaca setelah 5 tahun;
- memastikan query masih benar setelah perubahan schema.

Dengan kata lain:

> MyBatis memberi Anda kendali. Tetapi kendali berarti Anda juga memikul tanggung jawab desain.

Framework yang lebih otomatis seperti Hibernate mencoba mengambil sebagian keputusan. MyBatis sengaja tidak mengambil banyak keputusan. Ini bisa menjadi keunggulan besar di tangan engineer yang kuat, tetapi bisa menjadi sumber chaos di tangan tim yang tidak disiplin.

---

## 4. Mental Model Utama: MyBatis adalah “SQL Control Layer”

Cara berpikir yang paling produktif:

```text
Database schema
  -> SQL contract
  -> Mapper contract
  -> Service transaction
  -> Business operation
```

Bukan:

```text
Java object
  -> magic persistence
  -> database somehow updated
```

MyBatis cocok saat Anda ingin database dan SQL tetap menjadi bagian eksplisit dari desain.

Misalnya untuk sistem regulatory, enforcement, case management, finance, reporting, audit, workflow, atau sistem administrasi negara, query biasanya tidak hanya CRUD sederhana. Query bisa melibatkan:

- status lifecycle;
- role-based visibility;
- agency/module isolation;
- audit trail;
- effective date;
- approval chain;
- escalation condition;
- filtering kompleks;
- report projection;
- historical data;
- partial update;
- vendor-specific SQL;
- stored procedure lama;
- table/view legacy;
- performance-sensitive listing.

Dalam konteks seperti itu, menyembunyikan SQL sering membuat sistem sulit diprediksi. MyBatis memberi ruang untuk mengatakan:

```sql
SELECT exactly_the_columns_we_need
FROM exactly_the_tables_we_need
WHERE exactly_the_predicates_we_need
ORDER BY exactly_the_order_we_need
```

Lalu Java layer menerima hasil yang memang didesain sebagai projection, bukan entity graph besar yang tidak sengaja terbentuk.

---

## 5. MyBatis vs JDBC

### 5.1 JDBC Mental Model

JDBC adalah API dasar:

```text
Connection
  -> PreparedStatement
  -> parameter binding
  -> execute
  -> ResultSet
  -> manual mapping
```

Kelebihan JDBC:

- paling eksplisit;
- tidak ada magic;
- cocok untuk kode sangat kecil;
- cocok untuk kasus sangat custom;
- mudah memahami persis apa yang terjadi;
- tidak menambah framework abstraction.

Kelemahan JDBC:

- boilerplate tinggi;
- raw mapping mudah salah;
- resource handling berulang;
- consistency antar query sulit;
- dynamic SQL manual cepat kacau;
- testing dan observability sering dibuat ad hoc;
- di codebase besar, raw JDBC cepat menjadi tidak terkendali.

### 5.2 MyBatis sebagai JDBC Boilerplate Reducer

MyBatis tetap memakai JDBC di bawahnya, tetapi memindahkan boilerplate ke framework:

```text
You write:
  mapper method + SQL + result map

MyBatis handles:
  PreparedStatement creation
  parameter binding
  execution
  ResultSet traversal
  object mapping
  session lifecycle
```

Perbandingan ringkas:

| Aspek | JDBC | MyBatis |
|---|---|---|
| SQL control | penuh | penuh |
| Boilerplate | tinggi | rendah |
| Mapping | manual | framework-assisted |
| Dynamic SQL | manual string building | XML tags / Dynamic SQL library |
| Transaction | manual/framework | manual atau Spring-managed |
| Learning curve | API sederhana, praktik sulit | konsep lebih banyak, praktik lebih terstruktur |
| Cocok untuk | kecil, khusus, library-level | aplikasi besar SQL-first |

Kesimpulan:

> MyBatis bukan lawan JDBC. MyBatis adalah cara mengorganisasi penggunaan JDBC agar tetap eksplisit tetapi tidak penuh boilerplate.

---

## 6. MyBatis vs JPA/Hibernate

### 6.1 JPA/Hibernate Mental Model

JPA/Hibernate berangkat dari object-relational mapping:

```text
Entity class
  -> persistence context
  -> dirty checking
  -> generated SQL
  -> database synchronization
```

Unit utama JPA adalah entity dan persistence context. Query bisa eksplisit lewat JPQL/native SQL, tetapi banyak operasi sehari-hari didesain melalui entity lifecycle.

Kekuatan JPA/Hibernate:

- entity lifecycle;
- dirty checking;
- relationship mapping;
- cascade;
- persistence context identity map;
- domain object mutation;
- generated SQL untuk banyak CRUD sederhana;
- lazy loading;
- second-level cache ecosystem;
- powerful ORM behavior.

Risiko JPA/Hibernate:

- SQL yang dieksekusi bisa tidak terlihat jelas;
- N+1 mudah terjadi;
- entity graph bisa membesar tidak sengaja;
- cascade bisa berbahaya;
- dirty checking bisa update tanpa disadari;
- transaction/session boundary sangat penting;
- performance tuning butuh memahami Hibernate internals;
- native query dan projection sering akhirnya tetap dibutuhkan untuk query kompleks.

### 6.2 MyBatis Mental Model

MyBatis berangkat dari SQL statement:

```text
Mapper method
  -> explicit SQL
  -> explicit mapping
  -> returned object/projection
```

Tidak ada persistence context seperti Hibernate. Tidak ada dirty checking. Tidak ada automatic cascade. Tidak ada entity lifecycle yang kompleks.

Kekuatan MyBatis:

- SQL eksplisit;
- cocok untuk query kompleks;
- cocok untuk legacy schema;
- cocok untuk report/listing/projection;
- cocok untuk vendor-specific SQL;
- mapping lebih ringan;
- behavior lebih langsung;
- mudah membaca query aktual dari source code;
- tidak ada surprise dirty checking.

Risiko MyBatis:

- lebih banyak SQL harus ditulis manual;
- mapping harus dijaga manual;
- relationship loading harus dirancang sendiri;
- tidak ada automatic change tracking;
- consistency pattern harus dibuat eksplisit;
- mapper bisa jadi berantakan jika tidak ada governance.

### 6.3 Perbandingan Praktis

| Pertanyaan | Lebih condong JPA/Hibernate | Lebih condong MyBatis |
|---|---|---|
| CRUD entity sederhana? | Ya | Bisa, tapi mungkin terlalu manual |
| Domain model kaya dengan relationship? | Ya | Bisa, tapi manual |
| Query report kompleks? | Sering tidak ideal | Ya |
| Legacy database dengan schema sulit? | Bisa sulit | Ya |
| Butuh kontrol SQL penuh? | Native query, tapi tidak utama | Ya |
| Banyak projection/listing? | Bisa dengan DTO projection | Sangat cocok |
| Butuh automatic dirty checking? | Ya | Tidak |
| Butuh predictability SQL? | Perlu effort tinggi | Natural |
| Tim kuat SQL? | Opsional | Sangat membantu |
| Tim lemah SQL? | Bisa lebih aman untuk CRUD | MyBatis bisa berisiko |

### 6.4 Kesalahan Framing Umum

Framing yang lemah:

> “Mana yang lebih bagus, MyBatis atau Hibernate?”

Framing yang lebih kuat:

> “Apakah sistem ini lebih membutuhkan automatic object persistence atau explicit SQL control?”

Hibernate unggul ketika domain object lifecycle adalah pusat desain. MyBatis unggul ketika SQL shape, query predictability, database-specific behavior, dan projection control adalah pusat desain.

---

## 7. MyBatis vs Spring Data JDBC

Spring Data JDBC lebih sederhana daripada JPA. Ia tidak memiliki persistence context kompleks seperti Hibernate. Namun ia tetap berangkat dari aggregate/entity mapping.

MyBatis lebih SQL-centric.

Spring Data JDBC cocok jika:

- aggregate sederhana;
- CRUD repository cukup;
- ingin pendekatan Spring-native;
- tidak butuh query XML kompleks;
- schema relatif straightforward.

MyBatis cocok jika:

- query custom dominan;
- listing/report/search lebih penting daripada aggregate persistence;
- banyak SQL perlu dioptimalkan manual;
- dynamic filtering kompleks;
- stored procedure atau vendor SQL penting;
- tim ingin SQL sebagai artifact eksplisit.

Perbedaan mental model:

```text
Spring Data JDBC:
  Aggregate -> Repository -> SQL generated or annotated query

MyBatis:
  Mapper method -> Explicit mapped SQL -> Result mapping
```

---

## 8. MyBatis vs jOOQ

jOOQ adalah SQL DSL yang sangat kuat. Ia memberi type-safe SQL construction, introspection schema, dan ekspresi SQL yang dekat dengan SQL asli.

MyBatis adalah SQL mapper. Anda menulis SQL sebagai XML/annotation atau memakai MyBatis Dynamic SQL library.

jOOQ cocok jika:

- ingin type-safe SQL DSL;
- ingin compile-time help terhadap schema;
- query composition kompleks;
- SQL generation formal;
- tim nyaman dengan DSL;
- lisensi dan edition sesuai kebutuhan organisasi.

MyBatis cocok jika:

- ingin SQL teks yang mudah dibaca DBA/developer;
- organisasi sudah terbiasa XML mapper;
- butuh mapping sederhana dari SQL ke DTO;
- ingin framework ringan;
- ingin low ceremony di Java code;
- ingin tetap dekat dengan prepared SQL manual.

Perbedaan utamanya:

```text
jOOQ:
  Java DSL builds SQL

MyBatis:
  SQL statement mapped to Java method
```

Untuk engineer top-tier, pertanyaannya bukan “mana yang keren”, melainkan:

- apakah tim lebih mudah review SQL dalam XML/text atau Java DSL?
- apakah schema generation/type safety penting?
- apakah vendor-specific SQL akan banyak?
- apakah query reuse lebih mudah dalam DSL atau mapper statement?
- bagaimana testing dan observability-nya?
- bagaimana onboarding engineer baru?

---

## 9. MyBatis vs Query Builder Biasa

Query builder biasa sering menghasilkan kode seperti:

```java
Query query = Query.select("id", "name")
    .from("users")
    .where(eq("status", status))
    .orderBy("created_at desc");
```

Query builder memberi composability, tetapi sering kehilangan beberapa hal:

- SQL akhir sulit dibaca sebelum runtime;
- type safety bisa lemah jika string-based;
- vendor-specific syntax bisa awkward;
- query kompleks bisa menjadi Java code yang lebih sulit dibaca daripada SQL asli.

MyBatis XML dynamic SQL memberi dynamic behavior dengan SQL tetap tampak seperti SQL:

```xml
<select id="searchUsers" resultMap="UserListingMap">
  SELECT
    u.id,
    u.username,
    u.status,
    u.created_at
  FROM users u
  <where>
    <if test="status != null">
      AND u.status = #{status}
    </if>
    <if test="createdFrom != null">
      AND u.created_at &gt;= #{createdFrom}
    </if>
    <if test="createdTo != null">
      AND u.created_at &lt; #{createdTo}
    </if>
  </where>
  ORDER BY u.created_at DESC
</select>
```

Ini tetap punya risiko. Dynamic SQL XML bisa menjadi sulit dibaca jika terlalu banyak cabang. Karena itu, seri ini akan mengajarkan bukan hanya syntax, tetapi aturan desain dynamic SQL.

---

## 10. MyBatis sebagai Mapper, Bukan Repository Sembarangan

Di banyak codebase, nama `Repository`, `DAO`, dan `Mapper` sering dipakai campur. Untuk MyBatis, disiplin istilah penting.

### 10.1 Mapper

Mapper adalah interface yang method-nya dipasangkan ke SQL statement.

```java
public interface CaseMapper {
    CaseHeaderRow findHeaderById(long caseId);
    List<CaseListingRow> search(CaseSearchCriteria criteria);
    int updateStatus(CaseStatusUpdateCommand command);
}
```

Mapper sebaiknya:

- tipis;
- deklaratif;
- tidak berisi business logic;
- tidak menentukan transaction boundary;
- tidak menggabungkan banyak use case unrelated;
- punya method name yang mencerminkan SQL contract.

### 10.2 Repository

Repository bisa menjadi abstraction lebih tinggi di atas mapper, terutama jika Anda ingin menyembunyikan detail persistence dari domain/service.

```java
public class CaseRepository {
    private final CaseMapper caseMapper;

    public Optional<CaseHeader> findHeader(CaseId caseId) {
        return Optional.ofNullable(caseMapper.findHeaderById(caseId.value()))
            .map(this::toDomain);
    }
}
```

Namun di banyak aplikasi Spring + MyBatis, mapper langsung diinjek ke service. Itu tidak selalu salah. Yang penting:

```text
Service owns transaction and business operation.
Mapper owns SQL statement contract.
```

### 10.3 DAO

DAO adalah istilah lama yang sering berarti object yang mengakses data source. MyBatis mapper bisa dianggap DAO, tetapi istilah `Mapper` lebih presisi karena ia memang memetakan method ke SQL.

---

## 11. SQL sebagai Kontrak, Bukan String

Engineer biasa melihat SQL di mapper sebagai string panjang.

Engineer kuat melihat SQL sebagai kontrak.

Contoh:

```xml
<select id="findActiveAssignmentByOfficerId" resultMap="AssignmentMap">
  SELECT
    a.id,
    a.case_id,
    a.officer_id,
    a.assigned_at,
    a.status
  FROM officer_assignment a
  WHERE a.officer_id = #{officerId}
    AND a.status = 'ACTIVE'
</select>
```

Kontrak yang harus jelas:

```text
Nama method:
  findActiveAssignmentByOfficerId

Input:
  officerId

Output cardinality:
  zero or one? many?

Business assumption:
  satu officer hanya punya satu active assignment?

Database guarantee:
  apakah ada unique constraint untuk officer_id + status active?

Failure mode:
  jika ternyata ada dua row active, apa yang terjadi?
```

Jika method return single object tetapi database tidak menjamin single row, desainnya rapuh.

Bad:

```java
AssignmentRow findActiveAssignmentByOfficerId(long officerId);
```

Jika tidak ada unique constraint, lebih jujur:

```java
List<AssignmentRow> findActiveAssignmentsByOfficerId(long officerId);
```

Atau jika invariant bisnis memang harus single active assignment, maka enforce di database atau transactional update logic.

Top-tier MyBatis engineering bukan hanya menulis mapper. Ia menghubungkan:

```text
method name
  + SQL predicate
  + return cardinality
  + database constraint
  + business invariant
```

---

## 12. Unit Utama Desain: Statement Contract

Setiap mapped statement perlu diperlakukan seperti API internal.

Template berpikir:

```text
Statement ID:
  CaseMapper.searchCases

Purpose:
  Mengambil listing case untuk screen pencarian internal.

Input:
  CaseSearchCriteria

Output:
  List<CaseListingRow>

Cardinality:
  0..pageSize rows

Ordering:
  stable by created_at desc, id desc

Security scope:
  agency_id wajib diterapkan

Tenant/module scope:
  module_code optional sesuai user role

Consistency:
  read committed acceptable

Performance expectation:
  p95 < 300ms for common filters

Indexes expected:
  agency_id, status, created_at, id composite strategy

Failure cases:
  unsafe sort rejected before mapper
  empty result valid
  too broad query limited by pagination
```

Jika Anda tidak bisa menulis kontrak seperti ini, kemungkinan query tersebut belum dipahami cukup baik.

---

## 13. MyBatis dan Java 8 sampai Java 25

Seri ini membahas Java 8 hingga Java 25. Namun tidak semua stack MyBatis modern mendukung semua versi Java secara sama.

Secara garis besar:

```text
Java 8 legacy path:
  MyBatis core 3.5.x
  MyBatis-Spring 2.x
  Spring Boot 2.7.x
  mybatis-spring-boot-starter 2.3.x

Java 17+ modern path:
  MyBatis core 3.5.x
  MyBatis-Spring 3.x atau lebih baru
  Spring Boot 3.x/4.x
  mybatis-spring-boot-starter 3.x/4.x line
```

Implikasi praktis:

- Jika codebase masih Java 8, jangan asal mengikuti contoh Spring Boot 3 karena Boot 3 membutuhkan Java 17 baseline.
- Jika codebase Java 17/21/25, Anda bisa memakai record, modern date/time API, sealed types, pattern matching, dan fitur language baru, tetapi mapping MyBatis tetap perlu diuji.
- Jika memakai Jakarta stack modern, ingat bahwa MyBatis sendiri bukan JPA/Jakarta Persistence, tetapi integrasi Spring Boot/Spring Framework akan mengikuti baseline ekosistem Spring.
- Untuk enterprise migration, pisahkan pembahasan:
  - MyBatis core compatibility;
  - MyBatis-Spring compatibility;
  - Spring Boot compatibility;
  - JDBC driver compatibility;
  - database vendor compatibility;
  - Java runtime compatibility.

Prinsip seri ini:

> Materi core MyBatis akan ditulis agar konsepnya berlaku lintas Java 8–25. Namun contoh modern akan diberi catatan jika membutuhkan Java 17+ atau fitur lebih baru.

---

## 14. Cara MyBatis Bekerja pada Level Tinggi

Secara high-level, flow-nya seperti ini:

```text
Application service
  -> calls mapper interface method
  -> MyBatis proxy intercepts method call
  -> resolves mapped statement by namespace + method name
  -> builds final SQL with dynamic conditions
  -> binds parameters to PreparedStatement
  -> executes through JDBC executor
  -> receives ResultSet / update count
  -> maps rows to Java object
  -> returns result to service
```

Contoh:

```java
@Service
public class CaseQueryService {
    private final CaseMapper caseMapper;

    public PageResult<CaseListingRow> search(CaseSearchRequest request) {
        CaseSearchCriteria criteria = CaseSearchCriteria.from(request);
        List<CaseListingRow> rows = caseMapper.searchCases(criteria);
        long total = caseMapper.countCases(criteria);
        return PageResult.of(rows, total);
    }
}
```

Mapper:

```java
public interface CaseMapper {
    List<CaseListingRow> searchCases(CaseSearchCriteria criteria);
    long countCases(CaseSearchCriteria criteria);
}
```

XML:

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListingRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at,
    c.updated_at
  FROM cases c
  <where>
    c.agency_id = #{agencyId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
    <if test="createdFrom != null">
      AND c.created_at &gt;= #{createdFrom}
    </if>
    <if test="createdTo != null">
      AND c.created_at &lt; #{createdTo}
    </if>
  </where>
  ORDER BY c.created_at DESC, c.id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

Yang terjadi bukan magic. Ini adalah pipeline:

```text
criteria object
  -> OGNL expression evaluation in dynamic SQL
  -> final SQL string
  -> prepared statement parameters
  -> JDBC call
  -> result set
  -> result map
  -> list of CaseListingRow
```

Part 1 akan membedah pipeline ini lebih dalam sampai ke `SqlSession`, `MappedStatement`, `BoundSql`, `Executor`, `StatementHandler`, `ParameterHandler`, dan `ResultSetHandler`.

---

## 15. XML Mapper vs Annotation Mapper

MyBatis mendukung XML dan annotation. Keduanya valid, tetapi punya karakter berbeda.

### 15.1 XML Mapper

XML cocok untuk:

- SQL panjang;
- result map kompleks;
- dynamic SQL kompleks;
- query yang perlu direview sebagai SQL artifact;
- tim yang ingin memisahkan Java interface dan SQL;
- enterprise codebase besar;
- query vendor-specific yang perlu dikelola rapi.

Contoh:

```xml
<select id="findById" resultMap="UserRowMap">
  SELECT
    id,
    username,
    email,
    status
  FROM users
  WHERE id = #{id}
</select>
```

### 15.2 Annotation Mapper

Annotation cocok untuk:

- query sangat pendek;
- prototype;
- mapper sederhana;
- statement yang tidak butuh dynamic XML;
- codebase yang sangat kecil.

Contoh:

```java
@Select("""
    SELECT id, username, email, status
    FROM users
    WHERE id = #{id}
    """)
UserRow findById(long id);
```

Untuk Java 8, text block belum tersedia, sehingga annotation SQL panjang menjadi buruk:

```java
@Select("SELECT id, username, email, status " +
        "FROM users " +
        "WHERE id = #{id}")
UserRow findById(long id);
```

Untuk Java 15+ text block membantu, tetapi bukan berarti annotation selalu ideal.

### 15.3 Rule of Thumb

Gunakan XML sebagai default untuk seri ini, karena:

- lebih cocok untuk advanced material;
- lebih scalable untuk SQL kompleks;
- result map lebih jelas;
- dynamic SQL lebih natural;
- SQL bisa diperlakukan sebagai artifact desain.

Gunakan annotation hanya jika query benar-benar kecil dan tidak akan tumbuh.

---

## 16. `#{}` vs `${}`: Boundary Penting Sejak Awal

Walaupun detailnya ada di Part 5, sejak awal harus memahami boundary ini.

`#{}` berarti parameter binding:

```xml
WHERE username = #{username}
```

MyBatis akan memakai prepared statement parameter. Ini aman untuk value.

`${}` berarti string substitution:

```xml
ORDER BY ${sortColumn}
```

Ini menyisipkan teks langsung ke SQL. Jika input berasal dari user dan tidak di-whitelist, ini bisa menjadi SQL injection.

Aturan awal:

```text
Gunakan #{} untuk value.
Jangan gunakan ${} untuk user input mentah.
Gunakan ${} hanya untuk identifier SQL yang sudah divalidasi whitelist, seperti column name atau direction.
```

Bad:

```xml
ORDER BY ${request.sort}
```

Better:

```java
public enum CaseSortColumn {
    CREATED_AT("c.created_at"),
    CASE_NO("c.case_no"),
    STATUS("c.status");

    private final String sqlExpression;
}
```

Mapper menerima hasil yang sudah aman:

```xml
ORDER BY ${sortColumnSql} ${sortDirectionSql}
```

Dengan invariant:

```text
sortColumnSql tidak pernah berasal langsung dari request string.
sortDirectionSql hanya ASC atau DESC dari enum.
```

---

## 17. Result Mapping sebagai Contract Boundary

SQL tidak selesai ketika database mengembalikan row. Row harus dimaknai sebagai object Java.

Contoh result map:

```xml
<resultMap id="UserRowMap" type="com.example.user.UserRow">
  <id property="id" column="id" />
  <result property="username" column="username" />
  <result property="email" column="email" />
  <result property="status" column="status" />
</resultMap>
```

Result mapping menjawab:

- column mana menjadi property mana;
- column mana identitas row;
- tipe Java apa yang dipakai;
- bagaimana null ditangani;
- apakah mapping nested diperlukan;
- apakah row mewakili entity, DTO, projection, atau report row.

Kesalahan umum:

```sql
SELECT * FROM users
```

Lalu mengandalkan auto mapping.

Risikonya:

- column baru bisa tidak sengaja ikut;
- join column ambigu;
- duplicate column name;
- property tidak terisi karena alias salah;
- perubahan schema tidak terlihat jelas;
- object berisi data lebih banyak dari kebutuhan.

Lebih baik:

```sql
SELECT
  u.id          AS user_id,
  u.username    AS user_username,
  u.email       AS user_email,
  u.status      AS user_status
FROM users u
WHERE u.id = #{id}
```

Lalu mapping eksplisit:

```xml
<resultMap id="UserRowMap" type="UserRow">
  <id property="id" column="user_id" />
  <result property="username" column="user_username" />
  <result property="email" column="user_email" />
  <result property="status" column="user_status" />
</resultMap>
```

Prinsip:

> Di sistem besar, explicit column list dan explicit result mapping sering lebih aman daripada convenience.

---

## 18. Dynamic SQL: Kekuatan dan Bahaya

Dynamic SQL adalah salah satu fitur paling penting MyBatis. Dokumentasi resmi MyBatis menyediakan dynamic SQL language untuk mapped SQL statement, seperti `if`, `choose`, `where`, `set`, `trim`, dan `foreach`.

Dynamic SQL diperlukan untuk:

- search screen;
- optional filter;
- selective update;
- bulk query dengan IN clause;
- conditional join;
- multi-tenant filter;
- vendor-specific fragment;
- feature flag query;
- report query.

Contoh berguna:

```xml
<select id="search" parameterType="CaseSearchCriteria" resultMap="CaseListingRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at
  FROM cases c
  <where>
    c.agency_id = #{agencyId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
    <if test="keyword != null and keyword != ''">
      AND (
        LOWER(c.case_no) LIKE LOWER(#{keywordLike})
        OR LOWER(c.subject) LIKE LOWER(#{keywordLike})
      )
    </if>
  </where>
  ORDER BY c.created_at DESC, c.id DESC
</select>
```

Namun dynamic SQL juga bisa menjadi neraka:

```xml
<if test="a != null">
  ...
  <if test="b != null">
    ...
    <choose>
      ...
    </choose>
  </if>
</if>
```

Jika dynamic SQL memiliki terlalu banyak cabang, Anda sebenarnya sedang menulis program kompleks di XML.

Rule awal:

```text
Dynamic SQL boleh kompleks karena kebutuhan bisnis kompleks.
Tetapi setiap cabang harus punya alasan, test, dan ownership.
```

Jika satu query punya terlalu banyak mode, mungkin query harus dipecah menjadi beberapa statement yang lebih eksplisit.

---

## 19. MyBatis dan Transaction Boundary

MyBatis sendiri punya `SqlSession` yang bisa commit/rollback. Tetapi dalam aplikasi Spring, transaction biasanya dikendalikan Spring.

Dengan MyBatis-Spring, mapper bisa diinjek seperti bean biasa. Integrasi Spring menangani `SqlSession`, commit/rollback mengikuti Spring transaction, dan exception diterjemahkan ke `DataAccessException`.

Prinsip desain:

```text
Controller tidak mengatur transaction.
Mapper tidak mengatur transaction.
Service/use-case layer mengatur transaction.
```

Contoh:

```java
@Service
public class CaseAssignmentService {
    private final CaseMapper caseMapper;
    private final AssignmentMapper assignmentMapper;

    @Transactional
    public void assignOfficer(AssignOfficerCommand command) {
        CaseRow caseRow = caseMapper.findForUpdate(command.caseId());

        if (!caseRow.canBeAssigned()) {
            throw new InvalidCaseStateException(command.caseId());
        }

        assignmentMapper.insertAssignment(command.toAssignmentInsert());
        caseMapper.updateStatus(command.caseId(), "ASSIGNED");
    }
}
```

Mapper hanya mengeksekusi statement:

```java
CaseRow findForUpdate(long caseId);
int insertAssignment(AssignmentInsert insert);
int updateStatus(long caseId, String status);
```

Jika mapper mulai melakukan business flow, desain mulai bocor.

---

## 20. MyBatis dan Domain Model

Salah satu kesalahan desain adalah memaksa MyBatis meniru Hibernate.

Bad mindset:

```text
Saya harus punya entity User yang sama untuk semua operasi:
  create
  update
  listing
  detail
  report
  export
  audit
```

Lebih sehat:

```text
Setiap use case boleh punya projection/DTO/command sendiri.
```

Contoh:

```java
public record UserListingRow(
    long id,
    String username,
    String status,
    Instant createdAt
) {}

public record UserDetailRow(
    long id,
    String username,
    String email,
    String status,
    Instant createdAt,
    Instant updatedAt
) {}

public record UserInsertCommand(
    String username,
    String email,
    String status
) {}

public record UserStatusUpdateCommand(
    long id,
    String expectedStatus,
    String newStatus,
    long expectedVersion
) {}
```

MyBatis sangat cocok untuk projection-first design.

Prinsip:

> Jangan memaksa satu class mewakili semua bentuk data. SQL result shape boleh punya Java shape sendiri.

Ini sangat penting untuk query listing/report. Listing screen sering hanya butuh 8 column, bukan seluruh entity dengan relationship.

---

## 21. CRUD Bukan Pusat Dunia MyBatis

Banyak tutorial MyBatis berhenti di CRUD:

- insert user;
- select user;
- update user;
- delete user.

Itu terlalu dangkal.

Di sistem enterprise, operasi persistence lebih sering berupa:

- search dengan 15 filter optional;
- listing dengan role visibility;
- update status jika state sekarang masih valid;
- insert audit trail dengan serialized metadata;
- lock row untuk assignment;
- batch update expired tasks;
- report aggregate per module;
- export ratusan ribu row;
- sync data dari external system;
- upsert lookup table;
- soft delete dengan audit columns;
- query latest version per entity;
- query effective record by date;
- resolve hierarchy;
- query cross-module dashboard.

MyBatis bersinar jika kita mendesain statement sebagai use-case-level SQL, bukan generic CRUD saja.

Bad:

```java
int update(CaseEntity entity);
```

Better:

```java
int markCaseAsAssigned(MarkCaseAssignedCommand command);
int closeCaseIfCurrentlyOpen(CloseCaseCommand command);
int updateEscalationLevel(UpdateEscalationCommand command);
```

SQL-nya bisa menjaga invariant:

```sql
UPDATE cases
SET
  status = 'ASSIGNED',
  assigned_officer_id = #{officerId},
  assigned_at = #{assignedAt},
  version = version + 1
WHERE id = #{caseId}
  AND status = 'OPEN'
  AND version = #{expectedVersion}
```

Return count menjadi correctness signal:

```text
1 row updated  -> success
0 row updated  -> stale version, invalid state, or missing case
>1 row updated -> severe data integrity issue
```

---

## 22. Return Count sebagai Sinyal Kebenaran

Untuk `UPDATE`, `INSERT`, dan `DELETE`, return value sering diabaikan. Ini kesalahan besar.

Contoh:

```java
int updated = caseMapper.closeCase(command);
```

Jangan hanya:

```java
caseMapper.closeCase(command);
```

Gunakan return count:

```java
if (updated != 1) {
    throw new ConcurrentModificationException(
        "Case was not closed because it was modified or not in closable state"
    );
}
```

Dalam MyBatis, rows affected adalah bagian dari contract.

Untuk update state machine:

```sql
UPDATE cases
SET status = #{newStatus}
WHERE id = #{caseId}
  AND status = #{expectedCurrentStatus}
```

Ini bukan sekadar SQL. Ini adalah atomic state transition.

Mental model:

```text
Business invariant:
  Case can move from OPEN to ASSIGNED only if it is still OPEN.

SQL encoding:
  WHERE id = ? AND status = 'OPEN'

Correctness signal:
  updated row count must be 1.
```

Ini pola penting untuk sistem workflow, enforcement lifecycle, approval, assignment, dan case management.

---

## 23. MyBatis dan Concurrency

MyBatis tidak otomatis menyelesaikan concurrency. Namun karena SQL eksplisit, Anda bisa menyusun concurrency control dengan jelas.

### 23.1 Optimistic Locking

Pattern:

```sql
UPDATE cases
SET
  status = #{newStatus},
  version = version + 1,
  updated_at = #{updatedAt}
WHERE id = #{id}
  AND version = #{expectedVersion}
```

Jika return count 0:

```text
Data sudah berubah, user/action harus retry atau diberi conflict response.
```

### 23.2 Pessimistic Locking

Pattern:

```sql
SELECT
  id,
  status,
  version
FROM cases
WHERE id = #{id}
FOR UPDATE
```

Digunakan dalam transaction saat perlu mencegah perubahan concurrent sampai operasi selesai.

### 23.3 Atomic Claim

Untuk queue/assignment:

```sql
UPDATE tasks
SET
  claimed_by = #{workerId},
  claimed_at = #{now},
  status = 'CLAIMED'
WHERE id = #{taskId}
  AND status = 'READY'
```

Return count menentukan apakah worker berhasil claim.

Prinsip:

> MyBatis memberi Anda kemampuan menulis concurrency pattern langsung di SQL. Tetapi Anda harus sadar pattern-nya.

---

## 24. MyBatis dan Performance Predictability

MyBatis tidak membuat query lambat menjadi cepat. Namun MyBatis membuat query lebih mudah dilihat dan dikendalikan.

Performance MyBatis biasanya ditentukan oleh:

- SQL shape;
- index;
- predicate selectivity;
- join strategy;
- pagination strategy;
- fetch size;
- result mapping cost;
- N+1 query;
- dynamic SQL branch;
- database statistics;
- bind variable behavior;
- network roundtrip;
- transaction duration.

Engineer top-tier tidak bertanya:

> “Kenapa MyBatis lambat?”

Ia bertanya:

```text
Statement mana yang lambat?
SQL aktualnya apa?
Parameternya apa?
Execution plan-nya apa?
Index yang dipakai apa?
Berapa row yang dibaca?
Berapa row yang dikembalikan?
Apakah query dipanggil N kali dalam satu request?
Apakah dynamic predicate membuat plan buruk?
Apakah mapper mengembalikan object graph terlalu besar?
```

MyBatis cocok untuk performance-sensitive work karena SQL-nya dekat dan eksplisit.

Namun jika tim tidak punya disiplin SQL, MyBatis bisa menghasilkan banyak query buruk.

---

## 25. MyBatis dan Observability

Persistence layer production-grade harus bisa menjawab saat incident:

- query apa yang jalan?
- mapper method mana yang memanggil?
- request/correlation id apa?
- parameter aman apa yang bisa dilog?
- berapa durasi query?
- berapa row returned?
- apakah terjadi N+1?
- apakah connection pool exhausted?
- apakah lock wait?
- apakah database CPU tinggi?
- apakah query plan berubah?

MyBatis menyediakan logging integration, tetapi observability production tidak cukup hanya menyalakan SQL log.

Anda perlu desain:

```text
Mapper method naming
  + structured log
  + correlation id
  + slow query threshold
  + safe parameter masking
  + metrics per statement
  + DB-side monitoring
```

Contoh problem nyata:

```text
Request /cases/search lambat.
```

Tanpa observability:

```text
Mungkin database lambat.
```

Dengan observability:

```text
CaseMapper.searchCases took 4.2s.
Criteria: agency_id present, status null, keyword present.
Returned 50 rows.
Database read 1.8M rows.
Execution plan used full scan because LOWER(subject) LIKE '%abc%'.
```

Itu bedanya “menebak” dan “debugging engineering”.

---

## 26. MyBatis dan Security

Security di MyBatis terutama terkait:

- SQL injection;
- tenant isolation;
- row-level access;
- unsafe dynamic table/column names;
- leaking sensitive columns;
- over-fetching data;
- audit completeness;
- database user privilege;
- logging parameter sensitif.

### 26.1 SQL Injection

Gunakan `#{}` untuk value:

```xml
WHERE email = #{email}
```

Jangan:

```xml
WHERE email = '${email}'
```

### 26.2 Tenant Isolation

Bad:

```xml
<select id="findCaseById" resultMap="CaseMap">
  SELECT * FROM cases WHERE id = #{id}
</select>
```

Better:

```xml
<select id="findCaseByIdForAgency" resultMap="CaseMap">
  SELECT
    id,
    case_no,
    agency_id,
    status
  FROM cases
  WHERE id = #{id}
    AND agency_id = #{agencyId}
</select>
```

Method contract harus membawa scope:

```java
CaseRow findCaseByIdForAgency(
    @Param("id") long id,
    @Param("agencyId") long agencyId
);
```

Top-tier rule:

> Jangan membuat mapper method security-sensitive yang tidak membawa authorization/data-scope context.

### 26.3 Over-Fetching

Jangan ambil sensitive columns jika screen tidak perlu:

```sql
SELECT * FROM users
```

Lebih aman:

```sql
SELECT
  id,
  username,
  display_name,
  status
FROM users
```

Security bukan hanya access denied. Security juga tentang minimisasi data.

---

## 27. MyBatis dan Schema Evolution

Mapper sangat bergantung pada schema. Karena SQL eksplisit, perubahan schema harus diperlakukan sebagai perubahan kontrak.

Contoh perubahan column:

```text
users.email -> users.primary_email
```

Dampak:

- semua SQL yang select `email` patah;
- result map bisa gagal;
- dynamic SQL filter bisa salah;
- report export bisa kehilangan column;
- insert/update bisa error;
- test yang tidak mencakup mapper bisa lolos di compile tetapi gagal runtime.

Karena itu MyBatis butuh:

- migration tool seperti Flyway/Liquibase;
- integration test mapper;
- explicit column list;
- backward-compatible migration pattern;
- deprecation strategy;
- query search tooling;
- schema ownership.

Prinsip:

```text
Database schema is an API.
Mapper SQL is a client of that API.
```

Jika schema berubah tanpa memperlakukan mapper sebagai client, production risk naik.

---

## 28. MyBatis dan Large Codebase Governance

Di codebase kecil, 10 mapper mudah dikelola. Di enterprise codebase, bisa ada:

- 50+ module;
- ratusan mapper;
- ribuan statement;
- dynamic SQL kompleks;
- shared fragments;
- legacy SQL;
- mixed style annotation/XML;
- multiple database vendor;
- multiple datasource;
- batch job;
- report query;
- stored procedure;
- tenant-specific behavior.

Tanpa governance, MyBatis menjadi:

```text
XML jungle
  + duplicated SQL
  + inconsistent parameter names
  + unsafe dynamic SQL
  + unknown ownership
  + no tests
  + no performance baseline
```

Governance yang dibutuhkan:

- naming standard;
- mapper ownership per module;
- statement contract convention;
- result map convention;
- no `SELECT *` policy;
- safe `${}` policy;
- pagination standard;
- update count handling standard;
- SQL review checklist;
- mapper test baseline;
- slow query review;
- deprecation policy;
- documentation pattern.

MyBatis bisa sangat scalable secara organisasi jika diperlakukan sebagai SQL artifact system, bukan sekumpulan file XML acak.

---

## 29. Decision Framework: Kapan Memilih MyBatis

Gunakan MyBatis jika sebagian besar kondisi ini benar:

1. SQL shape penting dan harus eksplisit.
2. Query lebih kompleks daripada CRUD standar.
3. Listing/search/report banyak.
4. Database schema sudah ada atau legacy.
5. Ada stored procedure/view/vendor-specific SQL.
6. Performa query harus bisa diprediksi.
7. Tim nyaman membaca dan mereview SQL.
8. Anda ingin menghindari ORM magic.
9. Projection DTO lebih dominan daripada rich entity graph.
10. Anda butuh kontrol concurrency lewat SQL.
11. Anda punya disiplin testing mapper.
12. Anda punya standar security untuk dynamic SQL.

Contoh domain cocok:

- regulatory case management;
- enforcement lifecycle;
- workflow approval;
- admin portal dengan search/listing kompleks;
- audit/reporting-heavy system;
- legacy modernization;
- finance reconciliation;
- batch processing;
- data migration tooling;
- integration hub dengan database-centric contract.

---

## 30. Decision Framework: Kapan Jangan Memilih MyBatis

Jangan memilih MyBatis hanya karena “Hibernate susah”. Pilih berdasarkan kebutuhan.

MyBatis mungkin kurang tepat jika:

1. Tim lemah SQL dan tidak mau memperkuat SQL skill.
2. Domain object lifecycle lebih penting daripada SQL shape.
3. CRUD entity sederhana mendominasi dan butuh cepat.
4. Relationship/cascade/lazy-loading entity graph sangat dominan.
5. Tim ingin automatic dirty checking.
6. Tidak ada kapasitas menulis integration test mapper.
7. Tidak ada SQL review discipline.
8. Query akan banyak dibuat oleh developer junior tanpa guardrail.
9. Aplikasi kecil dan plain JDBC sudah cukup.
10. Anda butuh compile-time schema type safety yang lebih kuat seperti jOOQ.

Anti-reason:

```text
“Kita pakai MyBatis supaya tidak perlu belajar Hibernate.”
```

Reason yang lebih sehat:

```text
“Kita pakai MyBatis karena query shape, vendor SQL, report projection, dan performance predictability lebih penting daripada ORM lifecycle automation.”
```

---

## 31. MyBatis Skill Ladder

### Level 1 — Basic User

Bisa:

- membuat mapper interface;
- menulis select/insert/update/delete;
- memakai `#{}`;
- membuat XML mapper;
- menjalankan dengan Spring Boot.

Risiko:

- belum paham result mapping detail;
- belum paham transaction;
- belum paham performance;
- belum paham SQL injection boundary.

### Level 2 — Productive Developer

Bisa:

- membuat dynamic SQL;
- memakai resultMap eksplisit;
- membuat DTO/projection;
- memakai `@Transactional` dengan benar;
- handle update count;
- membuat mapper test dasar.

Risiko:

- query kompleks mulai sulit dirawat;
- concurrency belum matang;
- performance tuning masih reaktif.

### Level 3 — Senior Engineer

Bisa:

- mendesain mapper API sebagai contract;
- membedakan command/projection/entity;
- membuat pagination stabil;
- menghindari N+1;
- mendesain optimistic/pessimistic locking;
- mengatur batch operation;
- membuat observability slow query;
- memahami execution plan;
- mengelola schema evolution.

### Level 4 — Staff/Principal Style Engineer

Bisa:

- membuat governance untuk ratusan mapper;
- mendesain persistence architecture lintas module;
- membuat SQL review framework;
- membuat migration safety strategy;
- membuat performance baseline;
- membuat security guardrail;
- membuat incident troubleshooting decision tree;
- memutuskan kapan memakai MyBatis, JPA, jOOQ, JDBC, atau kombinasi;
- melatih tim agar SQL-first tidak berubah menjadi chaos.

Target seri ini adalah membawa Anda ke Level 3–4 untuk MyBatis engineering.

---

## 32. Anti-Pattern Penting Sejak Awal

### 32.1 Generic CRUD Mapper untuk Semua Hal

Bad:

```java
interface GenericMapper<T> {
    T findById(long id);
    int insert(T entity);
    int update(T entity);
    int delete(long id);
}
```

Masalah:

- mengaburkan business intent;
- tidak cocok untuk state transition;
- tidak jelas security scope;
- tidak jelas update count meaning;
- raw update bisa bypass invariant.

Better:

```java
interface CaseMapper {
    CaseDetailRow findDetailForAgency(long caseId, long agencyId);
    int submitCase(SubmitCaseCommand command);
    int assignOfficer(AssignOfficerCommand command);
    int closeCase(CloseCaseCommand command);
}
```

### 32.2 `SELECT *`

Bad:

```sql
SELECT * FROM cases WHERE id = #{id}
```

Masalah:

- over-fetching;
- schema coupling tersembunyi;
- ambiguous join;
- result mapping tidak eksplisit;
- sensitive data risk.

### 32.3 Mapper Menjadi Business Logic

Bad:

```java
caseMapper.approveAndNotifyAndCreateAuditAndUpdateDashboard(...)
```

Mapper bukan orchestration layer. Service/use-case layer yang mengatur flow.

### 32.4 Dynamic SQL Tanpa Test

Bad:

```xml
<if test="role == 'ADMIN' or department != null or statusList.size > 0 ...">
```

Jika dynamic branch tidak dites, Anda punya runtime-only language di XML tanpa safety.

### 32.5 Unsafe `${}`

Bad:

```xml
WHERE ${column} = #{value}
```

Kecuali `column` berasal dari whitelist internal, ini berbahaya.

### 32.6 Return Count Diabaikan

Bad:

```java
caseMapper.updateStatus(command);
```

Better:

```java
int updated = caseMapper.updateStatus(command);
if (updated != 1) {
    throw new StateConflictException();
}
```

---

## 33. MyBatis dalam Arsitektur Layered

Struktur umum:

```text
Controller / API Adapter
  -> Application Service / Use Case
      -> Mapper / Repository
          -> MyBatis SQL
              -> Database
```

Tanggung jawab:

### Controller

- HTTP/request parsing;
- authentication principal extraction;
- request validation ringan;
- response mapping.

### Application Service

- transaction boundary;
- business flow;
- authorization decision;
- state transition;
- call multiple mapper;
- handle update count;
- publish event after commit jika perlu.

### Mapper

- SQL execution contract;
- parameter binding contract;
- result mapping contract;
- no business orchestration.

### Database

- constraints;
- indexes;
- referential integrity;
- transaction isolation;
- execution plan;
- locking.

Contoh:

```java
@Transactional
public void submitCase(SubmitCaseRequest request, UserContext user) {
    CaseDraftRow draft = caseMapper.findDraftForOwner(request.caseId(), user.userId());

    if (draft == null) {
        throw new NotFoundException();
    }

    if (!draft.isSubmittable()) {
        throw new InvalidStateException();
    }

    int updated = caseMapper.submitDraft(new SubmitDraftCommand(
        request.caseId(),
        user.userId(),
        draft.version(),
        clock.instant()
    ));

    if (updated != 1) {
        throw new ConcurrentModificationException();
    }

    auditMapper.insertAudit(AuditCommand.caseSubmitted(...));
}
```

Mapper SQL:

```sql
UPDATE cases
SET
  status = 'SUBMITTED',
  submitted_at = #{submittedAt},
  version = version + 1
WHERE id = #{caseId}
  AND owner_user_id = #{userId}
  AND status = 'DRAFT'
  AND version = #{expectedVersion}
```

Ini adalah contoh SQL sebagai enforcement mechanism untuk invariant.

---

## 34. MyBatis dan Clean Architecture / Hexagonal Architecture

MyBatis bisa dipakai dalam clean/hexagonal architecture, tetapi perlu boundary jelas.

Salah satu pendekatan:

```text
Domain layer:
  Case, CaseStatus, CaseId, AssignmentPolicy

Application layer:
  SubmitCaseUseCase, AssignOfficerUseCase

Port:
  CasePersistencePort

Adapter:
  MyBatisCasePersistenceAdapter

Mapper:
  CaseMapper
```

Contoh:

```java
public interface CasePersistencePort {
    Optional<CaseDraft> findDraftForSubmission(CaseId caseId, UserId ownerId);
    boolean submitDraft(SubmitDraftMutation mutation);
}
```

Adapter:

```java
@Repository
public class MyBatisCasePersistenceAdapter implements CasePersistencePort {
    private final CaseMapper caseMapper;

    @Override
    public Optional<CaseDraft> findDraftForSubmission(CaseId caseId, UserId ownerId) {
        return Optional.ofNullable(
            caseMapper.findDraftForSubmission(caseId.value(), ownerId.value())
        ).map(this::toDomain);
    }

    @Override
    public boolean submitDraft(SubmitDraftMutation mutation) {
        return caseMapper.submitDraft(SubmitDraftCommand.from(mutation)) == 1;
    }
}
```

Mapper tetap infrastructure detail.

Ini berguna jika domain layer tidak ingin bergantung pada MyBatis. Namun untuk aplikasi CRUD/admin biasa, membuat port-adapter terlalu banyak bisa menjadi overengineering. Pilih sesuai kompleksitas domain.

---

## 35. Projection-First Thinking

MyBatis sangat kuat jika Anda berpikir projection-first.

Daripada:

```text
Saya punya table users, maka saya buat UserEntity.
Semua query return UserEntity.
```

Lebih baik:

```text
Screen listing butuh UserListingRow.
Screen detail butuh UserDetailRow.
Export butuh UserExportRow.
Audit butuh UserAuditRow.
Update butuh UserUpdateCommand.
Insert butuh UserInsertCommand.
```

Contoh:

```java
public record UserListingRow(
    long id,
    String username,
    String displayName,
    String status
) {}
```

SQL:

```sql
SELECT
  u.id,
  u.username,
  u.display_name,
  u.status
FROM users u
WHERE u.agency_id = #{agencyId}
ORDER BY u.username ASC
```

Manfaat:

- data minimal;
- mapping jelas;
- query lebih mudah dioptimalkan;
- tidak ada accidental lazy loading;
- tidak ada entity graph berat;
- API response lebih dekat dengan kebutuhan screen;
- report/export bisa punya shape sendiri.

Trade-off:

- lebih banyak class kecil;
- naming harus disiplin;
- mapping antar layer perlu dikelola.

Untuk sistem besar, trade-off ini biasanya layak.

---

## 36. MyBatis dan DDD: Hati-Hati dengan Entity

Jika memakai DDD, jangan otomatis menganggap MyBatis row object sama dengan domain entity.

Database row:

```java
public record CaseRow(
    long id,
    String status,
    long version,
    Instant createdAt
) {}
```

Domain entity:

```java
public class Case {
    private final CaseId id;
    private CaseStatus status;
    private Version version;

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidCaseStateException();
        }
        this.status = CaseStatus.SUBMITTED;
    }
}
```

Mutation command:

```java
public record SubmitCaseCommand(
    long caseId,
    String expectedStatus,
    long expectedVersion,
    Instant submittedAt
) {}
```

MyBatis bisa membantu load row dan persist mutation, tetapi domain invariant tetap di domain/service.

Di sistem yang tidak full DDD, tetap gunakan ide ini:

```text
Row object is not automatically business object.
```

---

## 37. Combining MyBatis with Other Persistence Tools

Tidak semua sistem harus memilih satu tool saja.

Kombinasi yang sering masuk akal:

### 37.1 JPA untuk Write Model, MyBatis untuk Read Model

```text
JPA:
  aggregate persistence, entity lifecycle

MyBatis:
  complex listing, report, dashboard, export
```

Risiko:

- transaction harus konsisten;
- mapping model ganda;
- developer harus tahu kapan pakai apa;
- cache/persistence context JPA bisa tidak sinkron jika native update dilakukan lewat MyBatis.

### 37.2 MyBatis untuk Core, JDBC untuk Edge Case

Jika ada operasi sangat khusus, plain JDBC bisa tetap dipakai.

### 37.3 MyBatis dan jOOQ

Mungkin MyBatis untuk statement sederhana yang sudah ada, jOOQ untuk query composition kompleks. Tapi kompleksitas stack naik.

Prinsip:

> Multi-tool architecture boleh, tetapi harus punya boundary eksplisit. Jangan menjadi “semua orang pakai tool favorit masing-masing”.

---

## 38. Review Checklist Awal untuk Mapper

Gunakan checklist ini setiap kali melihat mapper statement:

### 38.1 Contract

- Apakah nama method jelas?
- Apakah input object jelas?
- Apakah return cardinality jelas?
- Apakah null behavior jelas?
- Apakah rows affected diperiksa untuk DML penting?

### 38.2 SQL

- Apakah column list eksplisit?
- Apakah tidak memakai `SELECT *`?
- Apakah predicate sesuai business rule?
- Apakah ordering stabil?
- Apakah pagination aman?
- Apakah query bisa memakai index?

### 38.3 Security

- Apakah semua user value memakai `#{}`?
- Apakah `${}` hanya dari whitelist?
- Apakah tenant/agency/user scope diterapkan?
- Apakah sensitive columns tidak diambil tanpa perlu?

### 38.4 Mapping

- Apakah resultMap eksplisit untuk query penting?
- Apakah alias column jelas?
- Apakah nullable column masuk ke wrapper type?
- Apakah enum/status mapping aman?

### 38.5 Transaction/Consistency

- Apakah mapper dipanggil dari service transaction yang benar?
- Apakah update state memakai expected state/version?
- Apakah lock diperlukan?
- Apakah isolation level cukup?

### 38.6 Performance

- Apakah query bisa lambat untuk data besar?
- Apakah ada N+1?
- Apakah count query mahal?
- Apakah result terlalu besar?
- Apakah fetch size/cursor diperlukan?

### 38.7 Operability

- Apakah statement mudah ditemukan di log?
- Apakah ada test?
- Apakah slow query bisa diobservasi?
- Apakah migration schema akan terdeteksi?

---

## 39. Contoh Desain Mini: Search Case Listing

### 39.1 Problem

Kita butuh search case listing dengan filter:

- agency id wajib;
- status optional;
- keyword optional;
- created date range optional;
- pagination;
- sorting terbatas.

### 39.2 Request Object

```java
public record CaseSearchRequest(
    String status,
    String keyword,
    Instant createdFrom,
    Instant createdTo,
    String sortBy,
    String sortDirection,
    int page,
    int size
) {}
```

Request ini belum aman untuk mapper karena `sortBy` dan `sortDirection` masih raw string.

### 39.3 Criteria Aman

```java
public record CaseSearchCriteria(
    long agencyId,
    String status,
    String keywordLike,
    Instant createdFrom,
    Instant createdTo,
    String sortColumnSql,
    String sortDirectionSql,
    int offset,
    int limit
) {}
```

`sortColumnSql` berasal dari enum whitelist:

```java
public enum CaseSortColumn {
    CREATED_AT("c.created_at"),
    CASE_NO("c.case_no"),
    STATUS("c.status");

    private final String sql;

    CaseSortColumn(String sql) {
        this.sql = sql;
    }

    public String sql() {
        return sql;
    }
}
```

### 39.4 Mapper Method

```java
public interface CaseQueryMapper {
    List<CaseListingRow> searchCases(CaseSearchCriteria criteria);
    long countCases(CaseSearchCriteria criteria);
}
```

### 39.5 XML Statement

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListingRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at,
    c.updated_at
  FROM cases c
  <where>
    c.agency_id = #{agencyId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
    <if test="keywordLike != null">
      AND (
        LOWER(c.case_no) LIKE LOWER(#{keywordLike})
        OR LOWER(c.subject) LIKE LOWER(#{keywordLike})
      )
    </if>
    <if test="createdFrom != null">
      AND c.created_at &gt;= #{createdFrom}
    </if>
    <if test="createdTo != null">
      AND c.created_at &lt; #{createdTo}
    </if>
  </where>
  ORDER BY ${sortColumnSql} ${sortDirectionSql}, c.id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

### 39.6 Design Notes

- `agency_id` wajib untuk data isolation.
- Sorting memakai `${}` tetapi hanya setelah whitelist.
- `c.id DESC` sebagai tie-breaker agar pagination stabil.
- Column list eksplisit.
- Listing memakai projection, bukan full entity.
- Count query perlu dievaluasi cost-nya.
- Keyword search dengan `LOWER LIKE` bisa mahal; perlu index/function-based index/full-text strategy tergantung database.

Ini contoh sederhana, tetapi mental model-nya production-oriented.

---

## 40. Contoh Desain Mini: State Transition Update

### 40.1 Problem

Case hanya boleh ditutup jika status sekarang `RESOLVED` dan version masih sesuai.

### 40.2 Command

```java
public record CloseCaseCommand(
    long caseId,
    long closedBy,
    long expectedVersion,
    Instant closedAt
) {}
```

### 40.3 Mapper

```java
public interface CaseCommandMapper {
    int closeResolvedCase(CloseCaseCommand command);
}
```

### 40.4 SQL

```xml
<update id="closeResolvedCase" parameterType="CloseCaseCommand">
  UPDATE cases
  SET
    status = 'CLOSED',
    closed_by = #{closedBy},
    closed_at = #{closedAt},
    version = version + 1,
    updated_at = #{closedAt}
  WHERE id = #{caseId}
    AND status = 'RESOLVED'
    AND version = #{expectedVersion}
</update>
```

### 40.5 Service Handling

```java
@Transactional
public void closeCase(CloseCaseCommand command) {
    int updated = caseCommandMapper.closeResolvedCase(command);

    if (updated != 1) {
        throw new CaseStateConflictException(command.caseId());
    }

    auditMapper.insert(AuditCommand.caseClosed(command));
}
```

### 40.6 Why This Matters

Ini lebih kuat daripada:

```java
Case case = mapper.findById(id);
if (case.status().equals("RESOLVED")) {
    mapper.updateStatus(id, "CLOSED");
}
```

Karena versi buruk rentan race condition:

```text
Thread A reads RESOLVED.
Thread B changes RESOLVED -> REOPENED.
Thread A updates REOPENED -> CLOSED without knowing.
```

Atomic update dengan `WHERE status = 'RESOLVED' AND version = ?` mencegah itu.

---

## 41. Contoh Desain Mini: Insert Audit Trail

Audit trail biasanya append-only. MyBatis cocok untuk insert eksplisit.

### 41.1 Command

```java
public record AuditInsertCommand(
    String entityType,
    long entityId,
    String action,
    long actorUserId,
    Instant createdAt,
    String metadataJson
) {}
```

### 41.2 Mapper

```java
public interface AuditMapper {
    int insertAudit(AuditInsertCommand command);
}
```

### 41.3 SQL

```xml
<insert id="insertAudit" parameterType="AuditInsertCommand">
  INSERT INTO audit_trail (
    entity_type,
    entity_id,
    action,
    actor_user_id,
    created_at,
    metadata_json
  ) VALUES (
    #{entityType},
    #{entityId},
    #{action},
    #{actorUserId},
    #{createdAt},
    #{metadataJson}
  )
</insert>
```

### 41.4 Design Considerations

- Audit insert harus ikut transaction atau after-commit tergantung requirement.
- Metadata JSON bisa besar; pertimbangkan CLOB/JSONB/vendor type.
- Sensitive data harus dimasking sebelum masuk metadata.
- Audit table harus punya indexing strategy untuk retrieval.
- Insert failure harus diputuskan: fail main transaction atau fallback?

MyBatis tidak menjawab policy ini. Engineer harus mendesainnya.

---

## 42. Apa yang Harus Dikuasai Sebelum Masuk Part 1

Sebelum masuk runtime architecture, pastikan konsep ini sudah kuat:

1. MyBatis adalah SQL mapper, bukan full ORM.
2. SQL statement adalah unit desain utama.
3. Mapper method adalah kontrak, bukan sekadar function call.
4. Result mapping adalah boundary penting.
5. Dynamic SQL kuat tetapi harus dibatasi.
6. Transaction boundary sebaiknya di service/use-case layer.
7. Update count adalah correctness signal.
8. `#{}` dan `${}` punya security boundary berbeda.
9. Projection-first design sering lebih cocok daripada entity-everywhere.
10. MyBatis unggul ketika SQL control lebih penting daripada ORM automation.
11. MyBatis berbahaya jika tim tidak punya SQL discipline.
12. Production-grade MyBatis membutuhkan testing, observability, security, performance, dan governance.

---

## 43. Ringkasan Mental Model

Ringkasan paling pendek:

```text
MyBatis = explicit SQL + Java mapper contract + framework-assisted binding/mapping.
```

Ringkasan engineering:

```text
Good MyBatis design:
  statement has clear purpose
  input is explicit
  output shape is explicit
  cardinality is explicit
  SQL is reviewable
  result mapping is safe
  dynamic parts are controlled
  transaction boundary is outside mapper
  update count is checked
  security scope is embedded
  performance is observable
```

Ringkasan decision:

```text
Choose MyBatis when SQL control, query predictability, projection design,
legacy schema handling, and database-specific behavior matter more than
automatic ORM lifecycle management.
```

Ringkasan risiko:

```text
MyBatis gives control.
Control without discipline becomes duplicated SQL, unsafe dynamic queries,
unclear mapper contracts, slow reports, and production-only mapping bugs.
```

---

## 44. Latihan Pemahaman

Jawab pertanyaan ini sebelum lanjut:

1. Apa beda “mapper method sebagai function” dan “mapper method sebagai contract”?
2. Kenapa `SELECT *` berbahaya di sistem besar?
3. Kenapa update count harus dicek pada state transition?
4. Kapan `${}` boleh digunakan?
5. Kenapa MyBatis cocok untuk report/listing kompleks?
6. Kenapa MyBatis tidak otomatis lebih baik daripada JPA?
7. Apa risiko jika mapper method tidak membawa `agencyId`/tenant scope?
8. Kenapa dynamic SQL perlu test?
9. Apa bedanya row object, projection DTO, dan domain entity?
10. Apa indikator bahwa sebuah query harus dipecah menjadi beberapa mapper statement?

---

## 45. Preview Part 1

Bagian berikutnya:

```text
01-mybatis-core-runtime-architecture-sqlsession-executor-configuration.md
```

Fokus Part 1:

- `SqlSessionFactory`;
- `SqlSession`;
- `Configuration`;
- `MappedStatement`;
- `BoundSql`;
- `Executor`;
- `StatementHandler`;
- `ParameterHandler`;
- `ResultSetHandler`;
- bagaimana mapper interface method berubah menjadi JDBC execution;
- apa yang terjadi ketika XML mapper dibaca;
- di mana dynamic SQL dievaluasi;
- bagaimana parameter di-bind;
- bagaimana result map dipakai;
- failure points di setiap lapisan runtime.

---

## 46. Referensi

Referensi utama yang relevan untuk bagian orientasi ini:

1. MyBatis 3 — Introduction: https://mybatis.org/mybatis-3/
2. MyBatis 3 — Mapper XML Files: https://mybatis.org/mybatis-3/sqlmap-xml.html
3. MyBatis 3 — Dynamic SQL: https://mybatis.org/mybatis-3/dynamic-sql.html
4. MyBatis 3 — Configuration: https://mybatis.org/mybatis-3/configuration.html
5. MyBatis-Spring — Introduction: https://mybatis.org/spring/
6. MyBatis-Spring — Using an SqlSession: https://mybatis.org/spring/sqlsession.html
7. MyBatis-Spring — Transactions: https://mybatis.org/spring/transactions.html
8. MyBatis Spring Boot Starter — GitHub requirements and compatibility: https://github.com/mybatis/spring-boot-starter
9. MyBatis Dynamic SQL — Introduction: https://mybatis.org/mybatis-dynamic-sql/docs/introduction.html

---

## Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[x] Part 0  - MyBatis Orientation: SQL-First Persistence Mental Model
[ ] Part 1  - MyBatis Core Runtime Architecture
[ ] Part 2  - Java 8 to 25 Version Strategy
[ ] Part 3  - Mapper Design Fundamentals
[ ] Part 4  - SQL Statement Mapping
[ ] Part 5  - Parameter Binding
[ ] Part 6  - Result Mapping Fundamentals
[ ] Part 7  - Advanced Result Mapping
[ ] Part 8  - Dynamic SQL XML
[ ] Part 9  - MyBatis Dynamic SQL Library
[ ] Part 10 - Mapper Method API Design
[ ] Part 11 - Transaction Integration
[ ] Part 12 - Spring Boot Integration
[ ] Part 13 - TypeHandler Engineering
[ ] Part 14 - Database Vendor Awareness
[ ] Part 15 - Pagination, Sorting, Search Query, Count Strategy
[ ] Part 16 - Batch Operations
[ ] Part 17 - Caching
[ ] Part 18 - Lazy Loading, Nested Select, N+1
[ ] Part 19 - Stored Procedure, Function, Cursor, OUT Parameter
[ ] Part 20 - Concurrency and Consistency
[ ] Part 21 - SQL Performance Engineering
[ ] Part 22 - Observability
[ ] Part 23 - Testing MyBatis
[ ] Part 24 - Migration and Schema Evolution
[ ] Part 25 - Security Engineering
[ ] Part 26 - Multi-Tenancy and Data Partitioning
[ ] Part 27 - Large Object and Large Result Handling
[ ] Part 28 - Modularization and Codebase Governance
[ ] Part 29 - Plugin and Interceptor Engineering
[ ] Part 30 - Advanced Patterns
[ ] Part 31 - Failure Modeling and Production Troubleshooting
[ ] Part 32 - Refactoring Legacy MyBatis Systems
[ ] Part 33 - Capstone Production-Grade MyBatis Persistence Layer
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Capstone: Designing a Production-Grade Migration Platform](../migration/33-capstone-production-grade-migration-platform.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: MyBatis Core Runtime Architecture: `SqlSession`, `Executor`, `Configuration`](./01-mybatis-core-runtime-architecture-sqlsession-executor-configuration.md)
