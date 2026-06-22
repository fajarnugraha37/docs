# Part 7 — Advanced Result Mapping: Constructor, Record, Immutable DTO, Nested Object

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `07-advanced-result-mapping-constructor-record-immutable-dto-nested-object.md`  
**Scope:** Java 8–25, MyBatis 3.x, MyBatis-Spring/Spring Boot usage, SQL-first persistence engineering  
**Prerequisite:** Part 0–6, terutama `resultType`, `resultMap`, column alias discipline, mapper contract, dan parameter binding.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas **result mapping fundamental**: kapan memakai `resultType`, kapan memakai `resultMap`, kenapa `SELECT *` berbahaya, kenapa column alias harus menjadi contract, dan kenapa mapping yang terlalu otomatis bisa menghasilkan bug diam-diam.

Bagian ini naik satu level:

> Bagaimana memetakan hasil query yang tidak sekadar row datar ke object Java yang lebih serius: immutable DTO, constructor-based object, Java record, nested object, association, collection, dan object graph hasil join.

Target akhirnya bukan hanya bisa menulis:

```xml
<select id="findById" resultType="CaseDto">
  SELECT id, case_no, status
  FROM cases
  WHERE id = #{id}
</select>
```

Tetapi mampu mengambil keputusan desain seperti:

- Apakah result query ini harus menjadi flat projection atau nested object?
- Apakah object ini boleh mutable, atau harus immutable?
- Apakah Java record cocok untuk projection ini?
- Apakah memakai constructor mapping lebih aman daripada setter mapping?
- Apakah association harus nested select atau nested result?
- Bagaimana mencegah duplicate parent ketika join one-to-many?
- Bagaimana mencegah N+1 query?
- Bagaimana menjaga resultMap tetap bisa dibaca saat query menjadi kompleks?
- Bagaimana menghindari object graph explosion?
- Bagaimana desain mapping untuk sistem enterprise dengan 50+ module?

Dokumentasi MyBatis menyebut `resultMap` sebagai fitur paling kuat untuk memetakan `ResultSet` ke object Java, termasuk `constructor`, `id`, `result`, `association`, `collection`, dan `discriminator`.[^mybatis-mapper-xml] Konfigurasi MyBatis juga menyediakan opsi seperti `argNameBasedConstructorAutoMapping` untuk constructor auto-mapping berbasis nama argumen sejak 3.5.10.[^mybatis-config]

---

## 1. Mental Model: Result Mapping Adalah Boundary Antara Bentuk SQL dan Bentuk Object

Query database menghasilkan struktur seperti ini:

```text
ResultSet
  row 1: column_1, column_2, column_3, ...
  row 2: column_1, column_2, column_3, ...
  row 3: column_1, column_2, column_3, ...
```

Java application biasanya ingin struktur seperti ini:

```text
Object
  property A
  property B
  nested object C
  list of child D
```

Masalahnya: bentuk SQL adalah **tabular**, sedangkan object bisa **graph-shaped**.

```text
SQL world
  table-shaped
  row-oriented
  duplicate parent values can appear in joined rows
  null means no value or no joined child
  identity often represented by primary key columns

Java world
  object-shaped
  reference-oriented
  object identity matters
  null means absent association or unknown value
  collection can be empty, null, partially loaded, or lazily loaded
```

Advanced result mapping adalah teknik mengubah bentuk tabular menjadi object graph tanpa kehilangan correctness.

Prinsip penting:

> MyBatis tidak membaca pikiran domain model. Ia hanya mengikuti instruksi mapping yang kita berikan.

Jika column alias salah, `id` mapping hilang, constructor order salah, atau nested collection tidak punya key yang jelas, MyBatis tetap mungkin menghasilkan object, tetapi object itu bisa salah.

---

## 2. Dari Setter Mapping ke Constructor Mapping

### 2.1 Setter Mapping

Setter mapping adalah gaya yang paling umum:

```java
public class CaseSummaryDto {
    private Long id;
    private String caseNo;
    private String status;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getCaseNo() { return caseNo; }
    public void setCaseNo(String caseNo) { this.caseNo = caseNo; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
```

```xml
<resultMap id="CaseSummaryMap" type="com.acme.caseapp.CaseSummaryDto">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>
</resultMap>
```

Kelebihan:

- sederhana;
- cocok untuk Java 8;
- mudah dipakai dengan framework lama;
- mudah di-debug;
- cocok untuk DTO sederhana.

Kekurangan:

- object bisa berada dalam state setengah jadi selama proses mapping;
- field bisa diubah setelah object dibuat;
- invariant sulit ditegakkan di constructor;
- bug mapping bisa tersamarkan jika setter menerima null atau default value.

Setter mapping cocok untuk DTO teknis, tetapi kurang ideal untuk object yang memiliki invariant kuat.

---

### 2.2 Constructor Mapping

Constructor mapping membuat object lewat constructor:

```java
public final class CaseSummary {
    private final Long id;
    private final String caseNo;
    private final CaseStatus status;

    public CaseSummary(Long id, String caseNo, CaseStatus status) {
        if (id == null) {
            throw new IllegalArgumentException("id must not be null");
        }
        if (caseNo == null || caseNo.isBlank()) {
            throw new IllegalArgumentException("caseNo must not be blank");
        }
        if (status == null) {
            throw new IllegalArgumentException("status must not be null");
        }
        this.id = id;
        this.caseNo = caseNo;
        this.status = status;
    }

    public Long getId() { return id; }
    public String getCaseNo() { return caseNo; }
    public CaseStatus getStatus() { return status; }
}
```

```xml
<resultMap id="CaseSummaryMap" type="com.acme.caseapp.CaseSummary">
  <constructor>
    <idArg column="case_id" javaType="long"/>
    <arg column="case_no" javaType="string"/>
    <arg column="case_status" javaType="com.acme.caseapp.CaseStatus"/>
  </constructor>
</resultMap>
```

MyBatis mendukung elemen `constructor`, `idArg`, dan `arg`; `idArg` digunakan untuk menandai argumen identitas dan dapat membantu performa pada nested result mapping karena MyBatis tahu kolom mana yang mewakili identity.[^mybatis-mapper-xml]

Kelebihan constructor mapping:

- object bisa immutable;
- invariant bisa ditegakkan di constructor;
- field wajib bisa dibuat eksplisit;
- object tidak membutuhkan no-args constructor;
- cocok untuk projection yang harus valid sejak dibuat.

Kekurangan:

- mapping lebih sensitif terhadap urutan argumen jika tidak memakai name-based mapping;
- constructor overload bisa membingungkan;
- error mapping bisa terjadi saat runtime jika tipe atau jumlah argumen tidak cocok;
- perlu disiplin column alias dan `javaType`.

Mental model:

```text
Setter mapping:
  create object kosong
  set property satu per satu
  object valid setelah semua setter selesai, kalau setter benar

Constructor mapping:
  baca nilai column
  panggil constructor
  object valid atau gagal dibuat
```

Untuk sistem yang butuh correctness tinggi, constructor mapping sering lebih jujur.

---

## 3. Constructor Mapping Detail

### 3.1 `idArg` vs `arg`

Contoh:

```xml
<constructor>
  <idArg column="case_id" javaType="long"/>
  <arg column="case_no" javaType="string"/>
  <arg column="case_status" javaType="string"/>
</constructor>
```

Gunakan `idArg` untuk value yang merepresentasikan identity object.

Pada nested result mapping, MyBatis perlu menentukan apakah row baru masih parent yang sama atau parent baru. Informasi identity ini membantu MyBatis melakukan deduplication parent object.

Jika semua column dianggap ordinary result, MyBatis bisa lebih sulit menentukan object identity, terutama dalam mapping graph.

Rule praktis:

```text
Kalau object punya primary identifier dari database:
  map sebagai <idArg> atau <id>

Kalau value hanya atribut biasa:
  map sebagai <arg> atau <result>
```

---

### 3.2 Constructor Argument Order

Constructor mapping tradisional sensitif terhadap urutan:

```java
public CaseSummary(Long id, String caseNo, String status) { ... }
```

Mapping:

```xml
<constructor>
  <idArg column="case_id" javaType="long"/>
  <arg column="case_no" javaType="string"/>
  <arg column="case_status" javaType="string"/>
</constructor>
```

Jika urutan mapping berubah:

```xml
<constructor>
  <idArg column="case_id" javaType="long"/>
  <arg column="case_status" javaType="string"/>
  <arg column="case_no" javaType="string"/>
</constructor>
```

Maka object bisa dibuat dengan nilai tertukar jika tipe sama-sama `String`.

Ini jenis bug yang berbahaya karena:

- compile tetap sukses;
- query tetap sukses;
- object tetap terbentuk;
- data secara semantik salah.

Mitigasi:

- gunakan `name` pada argumen jika tersedia;
- aktifkan arg name-based constructor mapping bila sesuai;
- gunakan column alias eksplisit;
- tulis test mapping;
- hindari constructor panjang dengan banyak argumen bertipe sama.

---

### 3.3 Constructor Argument Name

MyBatis menyediakan dukungan agar constructor auto-mapping dapat memakai nama argumen, bukan hanya urutan, melalui konfigurasi `argNameBasedConstructorAutoMapping` sejak 3.5.10.[^mybatis-config]

Konfigurasi contoh:

```xml
<settings>
  <setting name="useActualParamName" value="true"/>
  <setting name="argNameBasedConstructorAutoMapping" value="true"/>
</settings>
```

Namun perlu dipahami:

- nama parameter constructor di bytecode hanya tersedia jika dikompilasi dengan `-parameters`, atau bila mekanisme metadata lain tersedia;
- Java record secara natural membawa nama component;
- untuk Java 8 class biasa, build configuration harus diperiksa;
- jangan mengandalkan fitur ini tanpa test.

Maven example:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

Gradle example:

```gradle
tasks.withType(JavaCompile).configureEach {
    options.compilerArgs += ['-parameters']
}
```

Mental model:

```text
Tanpa name-based mapping:
  constructor arg 1 <- column A
  constructor arg 2 <- column B

Dengan name-based mapping:
  constructor arg "caseNo" <- column/alias "case_no" atau mapped name
```

Tetap jangan menjadikan auto-mapping sebagai pengganti contract. Untuk query penting, explicit `resultMap` masih lebih aman.

---

## 4. Immutable DTO di Java 8–25

### 4.1 Java 8 Style Immutable DTO

Java 8 belum punya record. Immutable DTO biasanya dibuat dengan `final` field dan constructor.

```java
public final class OfficerAssignmentView {
    private final Long caseId;
    private final String caseNo;
    private final Long officerId;
    private final String officerName;

    public OfficerAssignmentView(
            Long caseId,
            String caseNo,
            Long officerId,
            String officerName
    ) {
        this.caseId = requireNonNull(caseId, "caseId");
        this.caseNo = requireNonNull(caseNo, "caseNo");
        this.officerId = officerId;
        this.officerName = officerName;
    }

    public Long getCaseId() { return caseId; }
    public String getCaseNo() { return caseNo; }
    public Long getOfficerId() { return officerId; }
    public String getOfficerName() { return officerName; }
}
```

Mapping:

```xml
<resultMap id="OfficerAssignmentViewMap" type="com.acme.caseapp.OfficerAssignmentView">
  <constructor>
    <idArg column="case_id" javaType="long"/>
    <arg column="case_no" javaType="string"/>
    <arg column="officer_id" javaType="long"/>
    <arg column="officer_name" javaType="string"/>
  </constructor>
</resultMap>
```

Cocok untuk:

- read model;
- API response projection;
- reporting row;
- security-filtered view;
- search listing result.

Kurang cocok untuk:

- object dengan terlalu banyak optional fields;
- object yang dibangun bertahap;
- complex graph dengan banyak collection;
- object yang harus dipatch/diubah setelah query.

---

### 4.2 Lombok Immutable DTO

Dengan Lombok:

```java
@Value
public class CaseSummaryView {
    Long id;
    String caseNo;
    String status;
}
```

Lombok akan membuat field final, constructor, getter, `equals`, `hashCode`, `toString`.

Risiko:

- constructor yang dihasilkan bisa berubah jika field order berubah;
- mapping constructor berbasis urutan menjadi rapuh;
- refactor field order bisa mematahkan mapping secara runtime;
- generated code tidak selalu terlihat jelas oleh reviewer.

Rekomendasi:

```text
Untuk Lombok immutable DTO:
  - gunakan explicit resultMap
  - hindari constructor terlalu panjang
  - tulis mapper integration test
  - jangan mengganti urutan field tanpa melihat resultMap
```

---

### 4.3 Java Record

Java record cocok untuk projection immutable.

```java
public record CaseSummaryView(
    Long id,
    String caseNo,
    String status
) {}
```

Mapping explicit:

```xml
<resultMap id="CaseSummaryViewMap" type="com.acme.caseapp.CaseSummaryView">
  <constructor>
    <idArg name="id" column="case_id" javaType="long"/>
    <arg name="caseNo" column="case_no" javaType="string"/>
    <arg name="status" column="case_status" javaType="string"/>
  </constructor>
</resultMap>
```

Record memberi beberapa keuntungan:

- immutable by default;
- canonical constructor jelas;
- component name menjadi contract;
- cocok untuk DTO/projection;
- mengurangi boilerplate;
- bagus untuk Java 16+; secara production biasanya Java 17+.

Namun record bukan silver bullet:

- record tidak cocok untuk entity yang lifecycle-nya kompleks;
- record tidak cocok untuk graph mutable;
- record constructor panjang tetap sulit dibaca;
- nested collection di record bisa immutable secara referensi, tetapi isi list bisa tetap mutable jika tidak disalin;
- validasi invariant tetap harus ditulis di compact constructor jika diperlukan.

Contoh compact constructor:

```java
public record CaseSummaryView(
    Long id,
    String caseNo,
    String status
) {
    public CaseSummaryView {
        if (id == null) throw new IllegalArgumentException("id must not be null");
        if (caseNo == null || caseNo.isBlank()) throw new IllegalArgumentException("caseNo must not be blank");
        if (status == null || status.isBlank()) throw new IllegalArgumentException("status must not be blank");
    }
}
```

Mapping test menjadi sangat penting karena constructor validation bisa membuat query gagal jika data lama tidak memenuhi invariant.

---

## 5. Projection vs Domain Object

Advanced result mapping sering menggoda kita untuk langsung memetakan SQL ke domain object kompleks.

Contoh domain object:

```java
public final class CaseFile {
    private final CaseId id;
    private final CaseNumber number;
    private CaseStatus status;
    private Officer assignedOfficer;
    private List<CaseDocument> documents;
    private List<CaseNote> notes;

    public void assignTo(Officer officer) { ... }
    public void escalate(EscalationReason reason) { ... }
    public void close(ClosureReason reason) { ... }
}
```

Pertanyaan penting:

> Apakah query listing case perlu membentuk `CaseFile` lengkap?

Biasanya tidak.

Untuk listing, cukup:

```java
public record CaseListingRow(
    Long caseId,
    String caseNo,
    String status,
    String assignedOfficerName,
    Instant lastUpdatedAt
) {}
```

Untuk detail screen, mungkin:

```java
public record CaseDetailView(
    Long caseId,
    String caseNo,
    String status,
    OfficerView assignedOfficer,
    List<DocumentView> documents
) {}
```

Untuk command/update, domain object mungkin dibutuhkan, tetapi sering kali update MyBatis lebih tepat memakai command object:

```java
public record AssignOfficerCommand(
    Long caseId,
    Long officerId,
    Long actorUserId,
    Long expectedVersion
) {}
```

Rule:

```text
Read screen/query:
  projection DTO lebih sering tepat

Write/state transition:
  command parameter + affected rows lebih sering tepat

Domain behavior kompleks:
  domain object boleh dipakai, tapi jangan dipaksa untuk semua query
```

MyBatis sangat kuat untuk projection-first design. Jangan membuat object graph besar hanya karena bisa.

---

## 6. Nested Object Mapping: `association`

### 6.1 Flat Row Menjadi Nested Object

Misal query:

```sql
SELECT
    c.id          AS case_id,
    c.case_no     AS case_no,
    c.status      AS case_status,
    o.id          AS officer_id,
    o.full_name   AS officer_name,
    o.email       AS officer_email
FROM cases c
LEFT JOIN officer o ON o.id = c.assigned_officer_id
WHERE c.id = ?
```

Kita ingin object:

```java
public class CaseDetailView {
    private Long id;
    private String caseNo;
    private String status;
    private OfficerView assignedOfficer;

    // getters/setters
}

public class OfficerView {
    private Long id;
    private String name;
    private String email;

    // getters/setters
}
```

Mapping:

```xml
<resultMap id="CaseDetailViewMap" type="com.acme.caseapp.CaseDetailView">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>

  <association property="assignedOfficer" javaType="com.acme.caseapp.OfficerView">
    <id property="id" column="officer_id"/>
    <result property="name" column="officer_name"/>
    <result property="email" column="officer_email"/>
  </association>
</resultMap>
```

`association` digunakan untuk nested object tunggal. Dokumentasi MyBatis menjelaskan `association` sebagai mapping untuk complex type association.[^mybatis-mapper-xml]

---

### 6.2 Null Association

Karena `LEFT JOIN`, officer bisa tidak ada.

Row:

```text
case_id | case_no | case_status | officer_id | officer_name | officer_email
101     | C-001   | OPEN        | null       | null         | null
```

Harapan:

```java
caseDetail.getAssignedOfficer() == null
```

Tetapi hati-hati: jika ada satu column association yang tidak null karena salah alias/default/function, MyBatis bisa membuat object officer kosong/sebagian.

Contoh berbahaya:

```sql
COALESCE(o.full_name, '-') AS officer_name
```

Jika `officer_id` null tapi `officer_name` bernilai `-`, mapping bisa ambigu.

Rule:

```text
Untuk association optional:
  - map <id> association dengan primary key child
  - jangan membuat child column non-null artifisial jika child tidak ada
  - handle display fallback di service/API layer, bukan SQL mapping layer
```

---

### 6.3 External Association ResultMap

Agar reusable:

```xml
<resultMap id="OfficerViewMap" type="com.acme.caseapp.OfficerView">
  <id property="id" column="officer_id"/>
  <result property="name" column="officer_name"/>
  <result property="email" column="officer_email"/>
</resultMap>

<resultMap id="CaseDetailViewMap" type="com.acme.caseapp.CaseDetailView">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>
  <association property="assignedOfficer" resultMap="OfficerViewMap"/>
</resultMap>
```

Masalah reuse:

- column alias `officer_id`, `officer_name`, `officer_email` harus konsisten di semua query yang memakai `OfficerViewMap`;
- jika query lain memakai alias `assigned_officer_id`, resultMap tidak cocok;
- resultMap reuse harus diimbangi alias discipline.

Alternatif:

```xml
<resultMap id="AssignedOfficerViewMap" type="com.acme.caseapp.OfficerView">
  <id property="id" column="assigned_officer_id"/>
  <result property="name" column="assigned_officer_name"/>
  <result property="email" column="assigned_officer_email"/>
</resultMap>
```

Untuk codebase besar, resultMap reuse yang terlalu ambisius sering membuat SQL alias sulit distandardkan. Reuse boleh, tetapi jangan mengorbankan kejelasan query.

---

## 7. Nested Collection Mapping: `collection`

### 7.1 One-to-Many Join Problem

Misal satu case punya banyak document.

Query:

```sql
SELECT
    c.id              AS case_id,
    c.case_no         AS case_no,
    c.status          AS case_status,
    d.id              AS document_id,
    d.file_name       AS document_file_name,
    d.document_type   AS document_type
FROM cases c
LEFT JOIN case_document d ON d.case_id = c.id
WHERE c.id = ?
ORDER BY d.created_at ASC
```

Rows:

```text
case_id | case_no | case_status | document_id | document_file_name
101     | C-001   | OPEN        | 5001        | a.pdf
101     | C-001   | OPEN        | 5002        | b.pdf
101     | C-001   | OPEN        | 5003        | c.pdf
```

Object yang diinginkan:

```text
CaseDetailView id=101
  documents:
    - DocumentView id=5001
    - DocumentView id=5002
    - DocumentView id=5003
```

Bukan:

```text
CaseDetailView id=101 document=5001
CaseDetailView id=101 document=5002
CaseDetailView id=101 document=5003
```

Mapping:

```xml
<resultMap id="CaseDetailWithDocumentsMap" type="com.acme.caseapp.CaseDetailView">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>

  <collection property="documents" ofType="com.acme.caseapp.DocumentView">
    <id property="id" column="document_id"/>
    <result property="fileName" column="document_file_name"/>
    <result property="documentType" column="document_type"/>
  </collection>
</resultMap>
```

`collection` digunakan untuk mapping nested collection. MyBatis mendukung collection melalui nested select atau nested result dari join.[^mybatis-mapper-xml]

---

### 7.2 Kenapa `<id>` di Parent dan Child Sangat Penting

Dalam nested collection, MyBatis harus melakukan deduplication.

Pseudo-process:

```text
for each row in ResultSet:
  identify parent by parent <id> columns
  if parent belum ada:
    create parent object
  identify child by child <id> columns
  if child exists:
    add child to parent collection
```

Jika parent `<id>` tidak didefinisikan:

- MyBatis bisa gagal mengenali parent yang sama;
- object parent bisa duplicate;
- nested collection bisa salah;
- performa bisa lebih buruk.

Jika child `<id>` tidak didefinisikan:

- child deduplication lemah;
- row duplicate bisa menghasilkan duplicate child;
- nested association di child bisa kacau.

Rule:

```text
Nested result mapping wajib punya identity jelas:
  parent -> <id>
  child  -> <id>
```

Untuk composite key:

```xml
<id property="caseId" column="case_id"/>
<id property="lineNo" column="line_no"/>
```

---

### 7.3 Empty Collection vs Null Collection

Jika tidak ada child document:

```text
case_id | case_no | document_id | document_file_name
101     | C-001   | null        | null
```

Harapan biasanya:

```java
documents = []
```

Bukan:

```java
documents = null
```

Namun behavior aktual bergantung pada object type, initialization, mapping, dan MyBatis internals.

Untuk DTO mutable:

```java
public class CaseDetailView {
    private List<DocumentView> documents = new ArrayList<>();
}
```

Ini membantu memastikan collection tidak null.

Untuk record:

```java
public record CaseDetailView(
    Long id,
    String caseNo,
    List<DocumentView> documents
) {
    public CaseDetailView {
        documents = documents == null ? List.of() : List.copyOf(documents);
    }
}
```

Tetapi record + nested collection constructor mapping bisa lebih rumit. Untuk complex one-to-many graph, setter-based DTO atau manual assembler kadang lebih jelas.

---

## 8. Nested Result vs Nested Select

MyBatis memiliki dua pola utama untuk nested object/collection:

```text
Nested Result:
  satu query join besar
  resultMap membentuk graph dari row join

Nested Select:
  query parent dulu
  query child per parent atau saat property dibaca
```

### 8.1 Nested Result

Contoh:

```xml
<select id="findCaseDetail" resultMap="CaseDetailWithDocumentsMap">
  SELECT
      c.id AS case_id,
      c.case_no AS case_no,
      d.id AS document_id,
      d.file_name AS document_file_name
  FROM cases c
  LEFT JOIN case_document d ON d.case_id = c.id
  WHERE c.id = #{caseId}
</select>
```

Kelebihan:

- satu roundtrip database;
- tidak menimbulkan N+1;
- bagus untuk detail page dengan bounded child count;
- query eksplisit dan mudah dianalisis execution plan-nya.

Kekurangan:

- row multiplication;
- mapping lebih kompleks;
- jika banyak collection, result set bisa meledak secara kartesian;
- SQL panjang;
- pagination parent menjadi sulit jika join child langsung.

Cocok untuk:

```text
find detail by id dengan jumlah child terbatas
query read model yang memang butuh child
report bounded
```

---

### 8.2 Nested Select

Contoh:

```xml
<resultMap id="CaseDetailNestedSelectMap" type="com.acme.caseapp.CaseDetailView">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <collection property="documents"
              column="case_id"
              select="selectDocumentsByCaseId"/>
</resultMap>

<select id="findCaseDetail" resultMap="CaseDetailNestedSelectMap">
  SELECT
      c.id AS case_id,
      c.case_no AS case_no
  FROM cases c
  WHERE c.id = #{caseId}
</select>

<select id="selectDocumentsByCaseId" resultType="com.acme.caseapp.DocumentView">
  SELECT
      d.id AS id,
      d.file_name AS fileName,
      d.document_type AS documentType
  FROM case_document d
  WHERE d.case_id = #{caseId}
  ORDER BY d.created_at ASC
</select>
```

Kelebihan:

- SQL parent sederhana;
- SQL child reusable;
- tidak ada row multiplication di parent query;
- bagus jika child optional dan jarang dibutuhkan.

Kekurangan:

- bisa menjadi N+1;
- query count tersembunyi;
- lazy loading bisa memicu query saat serialization/logging;
- butuh session lifecycle benar;
- performa sulit diprediksi.

Cocok untuk:

```text
single parent detail
child kecil dan bounded
property jarang dibaca tetapi masih dalam session valid
```

Berbahaya untuk:

```text
listing 100 parent dengan nested select child
API serialization yang otomatis menyentuh semua property
batch export
reporting
```

---

### 8.3 N+1 Example

Query parent:

```sql
SELECT id, case_no
FROM cases
WHERE status = 'OPEN'
FETCH FIRST 100 ROWS ONLY
```

Nested select document:

```sql
SELECT id, file_name
FROM case_document
WHERE case_id = ?
```

Jika ada 100 parent:

```text
1 query parent
100 query child
= 101 queries
```

Kalau setiap case punya assigned officer nested select juga:

```text
1 query parent
100 query document
100 query officer
= 201 queries
```

Ini bisa terlihat baik di DEV dengan 5 data, lalu menjadi incident di PROD.

Rule:

```text
Nested select tidak boleh dipakai untuk unbounded listing tanpa query count test.
```

---

## 9. Row Multiplication dan Cartesian Explosion

Nested result join juga punya risiko.

Misal:

```text
Case 101 punya:
  5 documents
  10 notes
  3 assignees
```

Jika semua dijoin dalam satu query:

```sql
cases
LEFT JOIN documents
LEFT JOIN notes
LEFT JOIN assignees
```

Jumlah row untuk satu case bisa menjadi:

```text
5 × 10 × 3 = 150 rows
```

Untuk 100 cases:

```text
100 × 150 = 15,000 rows
```

Padahal data logis hanya:

```text
100 parent
500 documents
1000 notes
300 assignees
= 1,900 logical items
```

Join banyak collection dalam satu resultMap bisa menyebabkan:

- result set besar;
- network transfer besar;
- memory spike;
- duplicate child handling kompleks;
- CPU meningkat untuk deduplication;
- query plan buruk;
- pagination salah.

Rule:

```text
Satu nested collection dalam satu joined result sering masih masuk akal.
Dua nested collection perlu hati-hati.
Tiga atau lebih nested collection biasanya harus dipertanyakan.
```

Alternatif:

```text
1. Query parent page
2. Batch query documents WHERE case_id IN (...)
3. Batch query notes WHERE case_id IN (...)
4. Assemble in Java by caseId
```

Ini sering lebih predictable daripada join graph besar.

---

## 10. Manual Graph Assembly Pattern

Untuk graph kompleks, manual assembly sering lebih baik daripada memaksa `resultMap` sangat rumit.

### 10.1 Parent Query

```java
public record CaseHeaderRow(
    Long caseId,
    String caseNo,
    String status
) {}
```

```xml
<select id="selectCaseHeaders" resultType="com.acme.caseapp.CaseHeaderRow">
  SELECT
      c.id AS caseId,
      c.case_no AS caseNo,
      c.status AS status
  FROM cases c
  WHERE c.status = #{status}
  ORDER BY c.updated_at DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

### 10.2 Child Query

```java
public record DocumentRow(
    Long caseId,
    Long documentId,
    String fileName
) {}
```

```xml
<select id="selectDocumentsByCaseIds" resultType="com.acme.caseapp.DocumentRow">
  SELECT
      d.case_id AS caseId,
      d.id AS documentId,
      d.file_name AS fileName
  FROM case_document d
  WHERE d.case_id IN
  <foreach collection="caseIds" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
  ORDER BY d.case_id, d.created_at
</select>
```

### 10.3 Assembly in Service

```java
public List<CaseCardView> findCaseCards(CaseSearchCriteria criteria) {
    List<CaseHeaderRow> headers = caseMapper.selectCaseHeaders(criteria);
    if (headers.isEmpty()) {
        return List.of();
    }

    List<Long> caseIds = headers.stream()
            .map(CaseHeaderRow::caseId)
            .toList();

    Map<Long, List<DocumentRow>> documentsByCaseId = caseMapper
            .selectDocumentsByCaseIds(caseIds)
            .stream()
            .collect(Collectors.groupingBy(DocumentRow::caseId, LinkedHashMap::new, Collectors.toList()));

    return headers.stream()
            .map(h -> new CaseCardView(
                    h.caseId(),
                    h.caseNo(),
                    h.status(),
                    documentsByCaseId.getOrDefault(h.caseId(), List.of())
            ))
            .toList();
}
```

Untuk Java 8, ganti `.toList()` dengan `collect(Collectors.toList())`.

Keuntungan manual assembly:

- query count terkendali;
- tidak ada N+1;
- tidak ada cartesian explosion;
- pagination parent benar;
- child query bisa diindex dengan baik;
- assembly logic eksplisit;
- mudah di-test.

Kekurangan:

- kode service lebih banyak;
- perlu grouping manual;
- transaction/session boundary harus jelas;
- perlu memastikan ordering child.

Mental model top-tier:

> Jangan otomatis memilih nested result atau nested select. Pilih bentuk yang paling predictable untuk data cardinality yang nyata.

---

## 11. Mapping Immutable Object dengan Nested Object

### 11.1 Immutable Parent + Immutable Child

```java
public record OfficerView(
    Long id,
    String name,
    String email
) {}

public record CaseDetailView(
    Long id,
    String caseNo,
    String status,
    OfficerView assignedOfficer
) {}
```

Mapping constructor nested object bisa lebih sulit jika semua immutable. Salah satu pendekatan praktis:

```xml
<resultMap id="OfficerViewMap" type="com.acme.caseapp.OfficerView">
  <constructor>
    <idArg name="id" column="officer_id" javaType="long"/>
    <arg name="name" column="officer_name" javaType="string"/>
    <arg name="email" column="officer_email" javaType="string"/>
  </constructor>
</resultMap>

<resultMap id="CaseDetailViewMap" type="com.acme.caseapp.CaseDetailView">
  <constructor>
    <idArg name="id" column="case_id" javaType="long"/>
    <arg name="caseNo" column="case_no" javaType="string"/>
    <arg name="status" column="case_status" javaType="string"/>
    <arg name="assignedOfficer" resultMap="OfficerViewMap"/>
  </constructor>
</resultMap>
```

Namun dalam praktik, nested constructor mapping bisa menjadi lebih sensitif dan perlu diuji pada versi MyBatis yang digunakan. Jika mapping menjadi sulit dipahami, gunakan pendekatan lebih eksplisit:

- flat row record;
- assemble nested object di Java.

```java
public record CaseDetailFlatRow(
    Long caseId,
    String caseNo,
    String status,
    Long officerId,
    String officerName,
    String officerEmail
) {
    public CaseDetailView toView() {
        OfficerView officer = officerId == null
                ? null
                : new OfficerView(officerId, officerName, officerEmail);
        return new CaseDetailView(caseId, caseNo, status, officer);
    }
}
```

Ini sering lebih mudah dibaca daripada resultMap yang terlalu pintar.

---

### 11.2 Jangan Takut Flat Row

Flat row bukan desain buruk. Dalam SQL-first persistence, flat row sering justru lebih jujur.

```java
public record CaseDetailFlatRow(
    Long caseId,
    String caseNo,
    String caseStatus,
    Long officerId,
    String officerName,
    String officerEmail
) {}
```

Kelebihan:

- mapping sederhana;
- query output langsung terlihat;
- test mudah;
- cocok untuk report/listing;
- tidak ada nested mapping magic.

Kekurangan:

- service perlu membentuk nested object jika API butuh bentuk nested;
- field bisa banyak;
- naming harus disiplin.

Rule:

```text
Jika nested resultMap membuat reviewer sulit memahami output query,
flat row + assembler sering lebih baik.
```

---

## 12. Discriminator: Mapping Berdasarkan Tipe Row

MyBatis mendukung `discriminator` untuk memilih mapping berdasarkan nilai column.[^mybatis-mapper-xml]

Contoh situasi:

```text
notification table:
  id
  type: EMAIL / SMS / SYSTEM
  title
  email_address
  phone_number
  system_code
```

Class:

```java
public abstract class NotificationView { ... }
public class EmailNotificationView extends NotificationView { ... }
public class SmsNotificationView extends NotificationView { ... }
```

Mapping konseptual:

```xml
<resultMap id="NotificationViewMap" type="com.acme.NotificationView">
  <id property="id" column="notification_id"/>
  <result property="title" column="title"/>

  <discriminator javaType="string" column="notification_type">
    <case value="EMAIL" resultMap="EmailNotificationViewMap"/>
    <case value="SMS" resultMap="SmsNotificationViewMap"/>
  </discriminator>
</resultMap>
```

Kapan berguna:

- row polymorphism nyata;
- legacy table dengan type column;
- projection yang berbeda signifikan antar type.

Kapan sebaiknya dihindari:

- sekadar status enum biasa;
- logic bisnis kompleks;
- hasil API lebih mudah dibuat dengan flat DTO;
- mapping menjadi sulit dilacak.

Untuk enterprise systems, discriminator harus dipakai hemat. Ia bisa membuat resultMap terlalu pintar dan memindahkan decision logic ke XML.

---

## 13. Column Prefix untuk Reusable Nested ResultMap

Saat satu query join table yang sama dua kali, alias konflik mudah terjadi.

Contoh:

```sql
SELECT
    c.id AS case_id,
    creator.id AS creator_user_id,
    creator.full_name AS creator_user_name,
    updater.id AS updater_user_id,
    updater.full_name AS updater_user_name
FROM cases c
JOIN app_user creator ON creator.id = c.created_by
LEFT JOIN app_user updater ON updater.id = c.updated_by
```

Kita ingin reuse `UserViewMap`.

```xml
<resultMap id="UserViewMap" type="com.acme.UserView">
  <id property="id" column="user_id"/>
  <result property="name" column="user_name"/>
</resultMap>
```

Dengan `columnPrefix`, mapping dapat memakai prefix:

```xml
<resultMap id="CaseAuditViewMap" type="com.acme.CaseAuditView">
  <id property="caseId" column="case_id"/>
  <association property="createdBy" resultMap="UserViewMap" columnPrefix="creator_"/>
  <association property="updatedBy" resultMap="UserViewMap" columnPrefix="updater_"/>
</resultMap>
```

Maka `UserViewMap` yang mencari `user_id` akan membaca:

```text
creator_ + user_id = creator_user_id
creator_ + user_name = creator_user_name
```

Dan untuk updater:

```text
updater_user_id
updater_user_name
```

Ini pattern yang bagus untuk join role berbeda ke table sama.

Rule:

```text
Gunakan columnPrefix jika:
  - nested object type sama dipakai beberapa kali dalam satu row
  - alias bisa distandardkan dengan prefix
  - resultMap nested memang stabil dan reusable
```

---

## 14. Java Type Design untuk Advanced Mapping

### 14.1 DTO Mutable

```java
public class CaseDetailDto {
    private Long id;
    private String caseNo;
    private OfficerDto officer;
    private List<DocumentDto> documents = new ArrayList<>();
}
```

Cocok untuk:

- nested collection mapping;
- MyBatis resultMap kompleks;
- Java 8 compatibility;
- object yang hanya dipakai sebagai view model internal.

Risiko:

- mutable setelah mapping;
- invariant lemah;
- bisa dipakai di tempat yang salah sebagai domain object.

---

### 14.2 Immutable Class

```java
public final class CaseSummaryView {
    private final Long id;
    private final String caseNo;
    private final String status;

    public CaseSummaryView(Long id, String caseNo, String status) { ... }
}
```

Cocok untuk:

- projection sederhana;
- command result;
- value object;
- security-sensitive output.

Risiko:

- constructor mapping harus disiplin;
- nested collection sulit;
- constructor panjang buruk.

---

### 14.3 Record

```java
public record CaseSummaryView(Long id, String caseNo, String status) {}
```

Cocok untuk:

- Java 17+ codebase;
- projection row;
- immutable API response model;
- result query datar.

Risiko:

- tidak tersedia di Java 8;
- nested graph kompleks bisa sulit;
- list component perlu defensive copy jika ingin benar-benar immutable.

---

### 14.4 Domain Object

```java
public class CaseFile {
    private CaseId id;
    private CaseStatus status;

    public void approve() { ... }
    public void reject() { ... }
}
```

Cocok untuk:

- business behavior;
- state transition;
- invariant domain;
- command use case.

Risiko bila dipakai langsung untuk semua query:

- read model menjadi terlalu berat;
- query listing memuat terlalu banyak data;
- domain object tercemar kebutuhan UI/report;
- mapping graph menjadi sulit.

Rule:

```text
MyBatis tidak memaksa domain object mapping.
Gunakan DTO/projection secara sadar.
```

---

## 15. Equality, Identity, dan Deduplication

Nested result mapping sangat bergantung pada identity column, bukan `equals()` Java object semata.

Namun Java equality tetap penting setelah object keluar dari mapper.

### 15.1 DTO Equality

Record otomatis punya `equals` berdasarkan semua component.

```java
public record DocumentView(Long id, String fileName) {}
```

Jika fileName berubah, equality berubah.

Untuk DTO view, ini biasanya oke. Untuk domain entity, equality berdasarkan semua field bisa berbahaya.

### 15.2 Entity Equality

Untuk domain entity:

```java
public final class CaseFile {
    private final CaseId id;

    @Override
    public boolean equals(Object o) {
        return o instanceof CaseFile other && Objects.equals(id, other.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Namun jika ID null sebelum insert, equality menjadi tricky.

MyBatis result mapping sendiri tetap harus diberi `<id>` agar deduplication row benar.

Rule:

```text
Java equals/hashCode bukan pengganti <id> di resultMap.
<id> adalah contract untuk MyBatis result assembly.
```

---

## 16. ResultMap Design for Joined Query

### 16.1 Prefix Semua Column

Untuk joined query, jangan memakai alias generik:

```sql
SELECT
    c.id,
    c.name,
    o.id,
    o.name
```

Buruk karena column label duplicate/ambigu.

Gunakan:

```sql
SELECT
    c.id AS case_id,
    c.case_no AS case_no,
    o.id AS officer_id,
    o.full_name AS officer_name
```

Mapping:

```xml
<resultMap id="CaseWithOfficerMap" type="CaseWithOfficerView">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <association property="officer" javaType="OfficerView">
    <id property="id" column="officer_id"/>
    <result property="name" column="officer_name"/>
  </association>
</resultMap>
```

Rule:

```text
Setiap table alias SQL harus tercermin dalam column alias result.
```

---

### 16.2 Jangan Campur Naming Strategy

Buruk:

```sql
c.id AS case_id,
c.case_no AS caseNo,
o.full_name AS officerName
```

Pilih satu style:

```text
SQL alias snake_case + explicit resultMap
atau
camelCase alias + resultType/record auto mapping
```

Untuk complex join, rekomendasi:

```text
snake_case dengan prefix table/context + explicit resultMap
```

---

## 17. Advanced Mapping dan Pagination

Jangan melakukan pagination parent langsung pada query join one-to-many tanpa memahami efeknya.

Buruk:

```sql
SELECT
    c.id AS case_id,
    c.case_no AS case_no,
    d.id AS document_id,
    d.file_name AS document_file_name
FROM cases c
LEFT JOIN case_document d ON d.case_id = c.id
ORDER BY c.updated_at DESC
OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY
```

Masalah:

- limit diterapkan ke row join, bukan parent case;
- satu case dengan 10 document memakan 10 row;
- hasil mungkin hanya 3 case, bukan 20 case;
- collection bisa terpotong.

Benar:

```sql
WITH page AS (
    SELECT c.id
    FROM cases c
    WHERE c.status = #{status}
    ORDER BY c.updated_at DESC, c.id DESC
    OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
)
SELECT
    c.id AS case_id,
    c.case_no AS case_no,
    d.id AS document_id,
    d.file_name AS document_file_name
FROM page p
JOIN cases c ON c.id = p.id
LEFT JOIN case_document d ON d.case_id = c.id
ORDER BY c.updated_at DESC, c.id DESC, d.created_at ASC
```

Atau:

```text
1. Query parent page IDs
2. Query parent details by IDs
3. Query child by parent IDs
4. Assemble
```

Rule:

```text
Pagination harus diterapkan pada parent identity set, bukan pada multiplied join rows.
```

---

## 18. Lazy Loading and Serialization Trap

MyBatis mendukung lazy loading untuk association/collection jika dikonfigurasi, tetapi ini harus dipakai hati-hati.

Risiko umum:

```java
CaseDetailView view = mapper.findCaseDetail(id);
return view; // Jackson serializes object
```

Saat JSON serializer membaca property lazy:

```text
getDocuments() dipanggil
  -> lazy query dijalankan
  -> query terjadi di layer serialization
  -> bisa di luar transaction/session
  -> bisa N+1
```

Atau logging:

```java
log.info("case detail={}", view);
```

Jika `toString()` membaca collection lazy, query bisa terjadi hanya karena log.

Rule:

```text
Untuk API response dan service boundary:
  jangan bergantung pada lazy loading tersembunyi.
  load data secara eksplisit.
```

Lazy loading lebih cocok untuk aplikasi internal tertentu dengan session lifecycle jelas, bukan default untuk REST API modern.

---

## 19. Mapping to `Map` dan Kenapa Jarang Tepat

MyBatis bisa mengembalikan map:

```java
Map<String, Object> selectSomething(Long id);
```

Untuk advanced result, ini menggoda karena cepat.

Masalah:

- tidak ada type safety;
- typo key baru ketahuan runtime;
- numeric type bisa berbeda antar vendor;
- date/time type bisa membingungkan;
- refactor column alias merusak caller;
- tidak ada invariant;
- sulit dites secara semantik.

Gunakan `Map` hanya untuk:

- metadata generic;
- ad-hoc internal diagnostic;
- dynamic report builder yang benar-benar dynamic;
- temporary migration tool.

Untuk production application mapper, prefer DTO/record.

---

## 20. TypeHandler in Advanced Result Mapping

Advanced result mapping sering bertemu domain-specific type:

```java
public record CaseId(Long value) {}
public enum CaseStatus { OPEN, ASSIGNED, CLOSED }
public record Money(BigDecimal amount, Currency currency) {}
```

Mapping simple field:

```xml
<result property="status" column="case_status" typeHandler="com.acme.CaseStatusTypeHandler"/>
```

Constructor arg:

```xml
<arg name="status"
     column="case_status"
     javaType="com.acme.CaseStatus"
     typeHandler="com.acme.CaseStatusTypeHandler"/>
```

Nested mapping dengan TypeHandler tetap harus eksplisit jika domain type tidak trivial.

Rule:

```text
Jika database code value punya semantic business meaning,
pertimbangkan TypeHandler agar mapping tidak tersebar di service.
```

Tetapi jangan membuat TypeHandler terlalu pintar. TypeHandler seharusnya mengonversi tipe, bukan menjalankan business rule kompleks.

---

## 21. Common Failure Modes

### 21.1 Constructor Argument Mismatch

Gejala:

```text
Could not find matching constructor
argument type mismatch
```

Penyebab:

- `javaType` salah;
- column null untuk primitive;
- constructor overload ambigu;
- order argumen salah;
- record component tidak cocok;
- build tidak memakai `-parameters` ketika mengandalkan name-based mapping.

Mitigasi:

- pakai wrapper type untuk nullable column;
- explicit `javaType`;
- test mapper;
- hindari overload constructor untuk DTO mapper;
- pakai `name` bila memungkinkan.

---

### 21.2 Duplicate Parent Object

Gejala:

```text
List berisi Case 101 beberapa kali
```

Penyebab:

- parent `<id>` tidak ada;
- parent id column alias salah;
- resultMap tidak dipakai;
- query alias duplicate.

Mitigasi:

- selalu map parent identity;
- column alias prefixed;
- test one-to-many dengan >1 child.

---

### 21.3 Duplicate Child in Collection

Gejala:

```text
documents berisi document yang sama berkali-kali
```

Penyebab:

- child `<id>` tidak ada;
- join ke table lain memperbanyak child rows;
- child id alias salah;
- collection mapping tidak punya identity jelas.

Mitigasi:

- map child `<id>`;
- hindari join multi-collection;
- deduplicate child di SQL atau Java jika memang perlu;
- pertimbangkan manual assembly.

---

### 21.4 Null Nested Object yang Harusnya Ada

Penyebab:

- `LEFT JOIN` tidak menemukan row;
- join condition salah;
- alias child id salah;
- association id column null;
- tenant/security filter memfilter child.

Mitigasi:

- debug SQL raw;
- cek alias;
- cek join type;
- cek security filter;
- tambahkan mapper test untuk required association.

---

### 21.5 Nested Object Kosong yang Harusnya Null

Penyebab:

- ada child column non-null artifisial seperti `COALESCE`;
- child id tidak dimap;
- association membuat object karena result lain non-null.

Mitigasi:

- map child `<id>`;
- jangan `COALESCE` child fields di mapping query;
- display fallback di layer atas.

---

### 21.6 Slow Query Karena Nested Select

Penyebab:

- N+1 query;
- lazy loading tersentuh serializer;
- logging memicu property.

Mitigasi:

- query count test;
- disable lazy loading untuk API response;
- nested result atau batch child query;
- observability query count per request.

---

### 21.7 Memory Spike Karena Joined Graph

Penyebab:

- cartesian explosion;
- multiple nested collections;
- large result set fully materialized;
- duplicate row deduplication mahal.

Mitigasi:

- parent page first;
- split query;
- cursor/stream untuk export;
- limit child;
- manual assembly.

---

## 22. Testing Advanced Result Mapping

Advanced result mapping wajib dites dengan data yang memancing edge case.

### 22.1 Test Data Minimum

Untuk one-to-many mapping:

```text
Case A: 0 documents
Case B: 1 document
Case C: 3 documents
```

Untuk association:

```text
Case D: assigned officer exists
Case E: assigned officer null
```

Untuk duplicate risk:

```text
Case F: 2 documents and 2 tags
```

Untuk constructor:

```text
row with all required values
row with nullable optional values
row with null required value if legacy data possible
```

---

### 22.2 Assert Shape, Not Just Count

Buruk:

```java
assertEquals(3, result.size());
```

Lebih baik:

```java
CaseDetailView view = mapper.findCaseDetail(101L);

assertEquals(101L, view.getId());
assertEquals("C-001", view.getCaseNo());
assertNotNull(view.getAssignedOfficer());
assertEquals(3, view.getDocuments().size());
assertEquals(List.of(5001L, 5002L, 5003L),
        view.getDocuments().stream().map(DocumentView::getId).collect(toList()));
```

Untuk null association:

```java
CaseDetailView view = mapper.findCaseDetail(102L);
assertNull(view.getAssignedOfficer());
assertNotNull(view.getDocuments());
assertTrue(view.getDocuments().isEmpty());
```

---

### 22.3 Test Query Count

Untuk nested select, test query count sangat berguna. Bisa memakai datasource proxy, P6Spy, datasource-proxy, atau instrumentation custom.

Expectation:

```text
find 20 case cards with documents:
  acceptable query count: 2 or 3
  unacceptable: 21 or 41
```

Testing query count mencegah N+1 masuk production.

---

## 23. Design Decision Matrix

| Situation | Recommended Mapping | Avoid |
|---|---|---|
| Simple listing row | record/immutable DTO with `resultType` or explicit constructor `resultMap` | nested graph |
| Joined one-to-one detail | `association` with explicit `<id>` | ambiguous alias |
| One parent + bounded children | nested result `collection` | nested select if query count matters |
| Parent page + children | parent page + batch child query + manual assembly | pagination directly over joined rows |
| Multiple child collections | split query + manual assembly | one massive join graph |
| Java 8 shared library | immutable class or mutable DTO | record |
| Java 17+ projection | record | huge mutable DTO |
| Domain state transition | command object + affected rows | loading huge graph unnecessarily |
| Security-sensitive result | explicit resultMap/projection | `Map<String,Object>` |
| Vendor-specific complex report | flat projection row | forced domain object graph |

---

## 24. Review Checklist

Untuk setiap advanced resultMap, cek:

```text
Identity
  [ ] Parent punya <id> atau <idArg>
  [ ] Child collection punya <id>
  [ ] Composite key dimap lengkap jika perlu

Column Alias
  [ ] Tidak ada SELECT *
  [ ] Semua joined column punya prefix jelas
  [ ] Tidak ada duplicate column label
  [ ] columnPrefix digunakan dengan disiplin jika reuse nested resultMap

Constructor
  [ ] Constructor arg order/name jelas
  [ ] Nullable column tidak masuk primitive
  [ ] Constructor overload tidak ambigu
  [ ] Java record mapping diuji
  [ ] Build memakai -parameters jika mengandalkan arg name

Nested Object
  [ ] Optional association benar-benar null ketika child tidak ada
  [ ] Tidak ada COALESCE yang membuat fake child
  [ ] Required association punya test

Collection
  [ ] Empty collection behavior dipahami
  [ ] Duplicate child diuji
  [ ] Multi-collection join tidak menyebabkan cartesian explosion

Performance
  [ ] Tidak ada N+1 tersembunyi
  [ ] Pagination tidak diterapkan pada multiplied join rows
  [ ] Query count untuk listing diuji
  [ ] Cardinality child realistis dipertimbangkan

Maintainability
  [ ] ResultMap masih bisa dibaca reviewer
  [ ] Flat row + assembler dipertimbangkan jika mapping terlalu kompleks
  [ ] DTO tidak tercampur dengan domain object secara tidak sengaja
```

---

## 25. Mini Case Study: Case Detail with Officer and Documents

### 25.1 Requirement

API detail case harus menampilkan:

```text
case id
case number
status
assigned officer, optional
documents, zero to many
```

Cardinality:

```text
one case -> zero/one officer
one case -> zero to 20 documents normally
```

Karena query by ID dan documents bounded, nested result masih masuk akal.

---

### 25.2 DTO

```java
public class CaseDetailView {
    private Long id;
    private String caseNo;
    private String status;
    private OfficerView assignedOfficer;
    private List<DocumentView> documents = new ArrayList<>();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getCaseNo() { return caseNo; }
    public void setCaseNo(String caseNo) { this.caseNo = caseNo; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public OfficerView getAssignedOfficer() { return assignedOfficer; }
    public void setAssignedOfficer(OfficerView assignedOfficer) { this.assignedOfficer = assignedOfficer; }

    public List<DocumentView> getDocuments() { return documents; }
    public void setDocuments(List<DocumentView> documents) { this.documents = documents; }
}
```

```java
public class OfficerView {
    private Long id;
    private String name;
    private String email;
    // getters/setters
}
```

```java
public class DocumentView {
    private Long id;
    private String fileName;
    private String documentType;
    // getters/setters
}
```

---

### 25.3 SQL and ResultMap

```xml
<resultMap id="CaseDetailViewMap" type="com.acme.caseapp.CaseDetailView">
  <id property="id" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>

  <association property="assignedOfficer" javaType="com.acme.caseapp.OfficerView">
    <id property="id" column="officer_id"/>
    <result property="name" column="officer_name"/>
    <result property="email" column="officer_email"/>
  </association>

  <collection property="documents" ofType="com.acme.caseapp.DocumentView">
    <id property="id" column="document_id"/>
    <result property="fileName" column="document_file_name"/>
    <result property="documentType" column="document_type"/>
  </collection>
</resultMap>

<select id="findCaseDetail" resultMap="CaseDetailViewMap">
  SELECT
      c.id              AS case_id,
      c.case_no         AS case_no,
      c.status          AS case_status,

      o.id              AS officer_id,
      o.full_name       AS officer_name,
      o.email           AS officer_email,

      d.id              AS document_id,
      d.file_name       AS document_file_name,
      d.document_type   AS document_type
  FROM cases c
  LEFT JOIN officer o
         ON o.id = c.assigned_officer_id
  LEFT JOIN case_document d
         ON d.case_id = c.id
        AND d.deleted_flag = 'N'
  WHERE c.id = #{caseId}
    AND c.deleted_flag = 'N'
  ORDER BY d.created_at ASC, d.id ASC
</select>
```

### 25.4 Why This Is Acceptable

- Query by one parent ID.
- One optional one-to-one association.
- One bounded one-to-many collection.
- Parent `<id>` exists.
- Officer `<id>` exists.
- Document `<id>` exists.
- Alias explicit.
- No pagination issue.
- No multi-collection cartesian explosion.

### 25.5 When This Design Would Break

Jika requirement berubah menjadi:

```text
listing 100 cases with officer, documents, notes, comments, tags
```

Maka nested result join besar tidak lagi tepat. Gunakan parent page + batch child queries + manual assembly.

---

## 26. Mental Model Akhir

Advanced result mapping bukan tentang membuat XML paling canggih.

Advanced result mapping adalah kemampuan memilih bentuk paling aman antara:

```text
flat SQL row
  -> flat DTO
  -> nested DTO
  -> immutable projection
  -> domain object
  -> manually assembled graph
```

Setiap pilihan punya biaya:

```text
constructor mapping
  + immutable, invariant kuat
  - sensitif terhadap constructor contract

record mapping
  + ringkas, immutable projection
  - Java modern only, graph kompleks sulit

association
  + one-to-one nested object jelas
  - alias/null semantics harus disiplin

collection
  + one-to-many graph bisa langsung terbentuk
  - duplicate, row multiplication, memory risk

nested select
  + modular query
  - N+1, lazy loading trap

nested result
  + one query, no N+1
  - cartesian explosion jika banyak collection

manual assembly
  + predictable, scalable
  - kode lebih eksplisit
```

Top-tier engineer tidak bertanya:

> “Bisa nggak MyBatis mapping object ini?”

Tetapi bertanya:

> “Mapping shape mana yang paling benar, aman, bisa dites, bisa dipahami, dan predictable di production untuk cardinality data ini?”

---

## 27. Ringkasan

Di bagian ini kita membahas:

- constructor mapping;
- `idArg` dan `arg`;
- immutable DTO;
- Java record mapping;
- nested object dengan `association`;
- nested collection dengan `collection`;
- nested result vs nested select;
- N+1 query;
- cartesian explosion;
- manual graph assembly;
- column prefix;
- discriminator;
- domain object vs projection;
- pagination dengan joined collection;
- lazy loading trap;
- TypeHandler dalam result mapping advanced;
- failure modes;
- testing strategy;
- design decision matrix;
- review checklist;
- mini case study.

Fondasi berikutnya adalah dynamic SQL XML. Setelah kita paham bagaimana result dibentuk, kita perlu memahami bagaimana SQL itu sendiri dibentuk secara dinamis tanpa berubah menjadi string logic yang sulit dites.

---

## 28. Status Seri

```text
Progress:
  [x] Part 0  - MyBatis Orientation: SQL-First Persistence Mental Model
  [x] Part 1  - MyBatis Core Runtime Architecture
  [x] Part 2  - Java 8 to 25 Version Strategy and Compatibility
  [x] Part 3  - Mapper Design: Interface, XML, Annotation, Naming
  [x] Part 4  - SQL Statement Mapping: SELECT, INSERT, UPDATE, DELETE
  [x] Part 5  - Parameter Binding: #{}, ${}, TypeHandler, SQL Injection Boundary
  [x] Part 6  - Result Mapping: Auto Mapping, Explicit Mapping, Column Discipline
  [x] Part 7  - Advanced Result Mapping: Constructor, Record, Immutable DTO, Nested Object

Next:
  [ ] Part 8  - Dynamic SQL XML: if, choose, where, set, trim, foreach
```

Seri belum selesai. Bagian berikutnya adalah:

```text
08-dynamic-sql-xml-if-choose-where-set-trim-foreach.md
```

---

## References

[^mybatis-mapper-xml]: MyBatis official documentation, “Mapper XML Files”, especially `resultMap`, `constructor`, `association`, `collection`, and mapped statement documentation. https://mybatis.org/mybatis-3/sqlmap-xml.html

[^mybatis-config]: MyBatis official documentation, “Configuration”, including `autoMappingBehavior`, `useActualParamName`, and `argNameBasedConstructorAutoMapping`. https://mybatis.org/mybatis-3/configuration.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-result-mapping-auto-explicit-mapping-column-discipline.md">⬅️ Part 6 — Result Mapping: Auto Mapping, Explicit Mapping, and Column Discipline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./08-dynamic-sql-xml-if-choose-where-set-trim-foreach.md">Part 8 — Dynamic SQL XML: `if`, `choose`, `where`, `set`, `trim`, `foreach` ➡️</a>
</div>
