# Part 18 — Lazy Loading, Nested Select, N+1, and Object Graph Control

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `18-lazy-loading-nested-select-n-plus-one-object-graph-control.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: mengendalikan object graph, lazy loading, nested select, nested result, N+1 query, dan strategi fetch production-grade di MyBatis.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- statement mapping;
- parameter binding;
- result mapping dasar dan advanced;
- dynamic SQL;
- mapper API design;
- transaction integration;
- Spring Boot integration;
- TypeHandler;
- database vendor awareness;
- pagination;
- batch operation;
- caching.

Bagian ini masuk ke problem yang sering terlihat sederhana tetapi sangat sering menjadi sumber incident performa: **bagaimana object graph dimuat dari database**.

Di MyBatis, query SQL eksplisit, tetapi object graph tetap bisa menjadi tidak eksplisit jika kita memakai fitur seperti:

- `association`;
- `collection`;
- nested select;
- lazy loading;
- first-level cache;
- second-level cache;
- nested result mapping;
- mapper method yang mengembalikan object domain terlalu besar.

Masalahnya bukan hanya “berapa query yang dieksekusi”. Masalah sebenarnya adalah:

```text
Apakah bentuk object yang dikembalikan mapper sesuai dengan use case,
atau mapper diam-diam membangun graph yang terlalu besar, terlalu lambat,
tidak stabil, dan sulit diobservasi?
```

---

## 1. Mental Model: Database Row Bukan Object Graph

Relational database menyimpan data sebagai:

- table;
- row;
- column;
- foreign key;
- index;
- join result;
- cursor/result set.

Aplikasi Java sering ingin melihat data sebagai:

- object;
- nested object;
- collection;
- aggregate;
- graph;
- DTO;
- projection;
- tree.

MyBatis berada di tengah:

```text
SQL ResultSet
   ↓
Column alias / resultMap
   ↓
Java object / DTO / graph
```

Semakin dekat hasil mapper ke object graph penuh, semakin besar risiko:

- query tambahan tersembunyi;
- row duplication akibat join;
- memory membesar;
- pagination salah;
- serialization memicu load tambahan;
- logging memicu load tambahan;
- cache menyimpan object graph terlalu besar;
- transaction/session lifetime menjadi tidak jelas.

Prinsip top-tier engineer:

```text
Mapper tidak boleh sekadar “mengembalikan object”.
Mapper harus mengembalikan bentuk data yang tepat untuk use case.
```

---

## 2. Tiga Cara Utama Mengambil Relasi di MyBatis

Untuk relasi seperti:

```text
Case
 ├── Applicant
 ├── AssignedOfficer
 └── Documents[]
```

MyBatis biasanya punya beberapa pilihan.

### 2.1 Flat Projection

SQL mengembalikan baris datar:

```sql
SELECT
  c.case_id,
  c.case_no,
  c.status,
  a.applicant_name,
  o.officer_name
FROM case_file c
JOIN applicant a ON a.applicant_id = c.applicant_id
LEFT JOIN officer o ON o.officer_id = c.assigned_officer_id
WHERE c.case_id = #{caseId}
```

Java DTO:

```java
public class CaseSummaryRow {
    private Long caseId;
    private String caseNo;
    private String status;
    private String applicantName;
    private String officerName;
}
```

Cocok untuk:

- listing;
- dashboard;
- search result;
- reporting ringan;
- read model;
- API response yang memang datar.

Kelebihan:

- paling jelas;
- biasanya paling cepat;
- mudah dipaginate;
- mudah diindex;
- tidak ada lazy trap;
- tidak ada object graph explosion.

Kekurangan:

- bukan domain graph;
- bisa ada duplikasi field jika banyak use case;
- tidak cocok bila butuh nested collection lengkap.

### 2.2 Nested Result

Satu SQL join besar, lalu MyBatis membentuk nested object memakai `association`/`collection`.

```text
1 SQL query
   ↓
JOIN menghasilkan row berulang
   ↓
MyBatis collapse row menjadi object graph
```

Cocok untuk:

- detail page dengan graph kecil;
- one-to-one relation;
- one-to-few relation;
- data yang wajib dimuat dalam satu transaction snapshot.

Risiko:

- result set membesar karena join multiplicative;
- pagination root entity bisa salah;
- `collection` butuh `<id>` mapping yang benar;
- memory lebih besar;
- SQL makin kompleks.

### 2.3 Nested Select

Query utama mengambil object utama. Untuk property tertentu, MyBatis memanggil mapped statement lain.

```text
SELECT case
   ↓
for each case → SELECT applicant
   ↓
for each case → SELECT documents
```

Cocok untuk:

- relation opsional yang jarang dibaca;
- detail by id dengan jumlah root kecil;
- lazy loading yang benar-benar terkendali;
- query graph yang terlalu sulit ditulis sebagai join.

Risiko:

- N+1 query;
- hidden database roundtrip;
- session lifetime issue;
- serialization/logging dapat memicu query;
- sulit diprediksi saat list result berisi banyak root.

---

## 3. `association` dan `collection`: Beda Makna, Beda Risiko

### 3.1 `association`

`association` biasanya dipakai untuk relasi single object:

```text
Case → Applicant
Case → AssignedOfficer
Document → UploadedBy
```

Contoh nested result:

```xml
<resultMap id="CaseDetailMap" type="com.acme.caseapp.CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>

  <association property="applicant" javaType="com.acme.caseapp.ApplicantSummary">
    <id property="applicantId" column="applicant_id"/>
    <result property="name" column="applicant_name"/>
  </association>
</resultMap>
```

Risk level relatif rendah jika:

- relasinya one-to-one atau many-to-one;
- column alias jelas;
- tidak banyak nullable nested object;
- `<id>` mapping benar.

### 3.2 `collection`

`collection` dipakai untuk relasi list:

```text
Case → Documents[]
Case → Notes[]
Case → Assignments[]
Case → AuditEvents[]
```

Contoh:

```xml
<resultMap id="CaseWithDocumentsMap" type="com.acme.caseapp.CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>

  <collection property="documents" ofType="com.acme.caseapp.DocumentRow">
    <id property="documentId" column="document_id"/>
    <result property="fileName" column="file_name"/>
    <result property="documentType" column="document_type"/>
  </collection>
</resultMap>
```

Risk level lebih tinggi karena:

- satu root row bisa muncul berkali-kali;
- banyak collection dalam satu query bisa menyebabkan cartesian explosion;
- pagination root menjadi tricky;
- sorting root vs sorting child bisa bertabrakan;
- memory meningkat cepat.

---

## 4. Nested Select

Menurut dokumentasi MyBatis, `association` bisa dimuat dengan dua cara: **nested select**, yaitu menjalankan mapped SQL lain yang mengembalikan complex type, atau **nested results**, yaitu memakai nested result mapping untuk menangani subset berulang dari joined result. Ini berarti pilihan fetch bukan detail kecil; ia mengubah jumlah roundtrip dan bentuk result processing. 

### 4.1 Contoh Nested Select untuk One-to-One

```xml
<resultMap id="CaseMap" type="com.acme.caseapp.CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <association
      property="applicant"
      column="applicant_id"
      select="com.acme.caseapp.ApplicantMapper.findSummaryById"/>
</resultMap>

<select id="findCaseById" resultMap="CaseMap">
  SELECT
    c.case_id,
    c.case_no,
    c.applicant_id
  FROM case_file c
  WHERE c.case_id = #{caseId}
</select>
```

Flow:

```text
findCaseById(100)
  → SELECT case_file WHERE case_id = 100
  → result has applicant_id = 55
  → SELECT applicant WHERE applicant_id = 55
  → set case.applicant
```

Untuk satu case detail, ini mungkin acceptable.

Untuk listing 100 cases, ini bisa menjadi:

```text
1 query list case
+ 100 query applicant
= 101 query
```

Inilah N+1.

### 4.2 Nested Select dengan Multiple Column Parameter

Kadang child query butuh lebih dari satu parameter:

```xml
<association
    property="latestAssignment"
    column="{caseId=case_id,agencyCode=agency_code}"
    select="com.acme.caseapp.AssignmentMapper.findLatestAssignment"/>
```

Child mapper:

```xml
<select id="findLatestAssignment" resultType="com.acme.caseapp.AssignmentRow">
  SELECT
    assignment_id,
    officer_id,
    assigned_at
  FROM case_assignment
  WHERE case_id = #{caseId}
    AND agency_code = #{agencyCode}
  ORDER BY assigned_at DESC
  FETCH FIRST 1 ROW ONLY
</select>
```

Ini powerful, tetapi hidden coupling meningkat:

- parent column alias harus cocok;
- child mapper parameter name harus cocok;
- test harus memvalidasi generated nested calls;
- query count harus diawasi.

### 4.3 Kapan Nested Select Masuk Akal

Nested select masuk akal bila:

1. Root result kecil, misalnya by id.
2. Relation jarang diakses.
3. Relation mahal dan hanya perlu dimuat saat benar-benar dibutuhkan.
4. Relasi tidak cocok di-join karena vendor-specific function/procedure.
5. Child query sendiri kompleks dan reusable.
6. Anda punya observability query count.
7. Anda tahu pasti transaction/session masih hidup saat load terjadi.

Nested select berbahaya bila:

1. Dipakai di listing.
2. Root result bisa ratusan/ribuan row.
3. Child query tidak punya index baik.
4. Lazy loading dapat dipicu serializer.
5. Mapper dipakai oleh banyak use case tanpa kontrak fetch jelas.
6. Engineer tidak sadar ada query tambahan.

---

## 5. N+1 Query Problem

### 5.1 Definisi

N+1 terjadi ketika:

```text
1 query mengambil N root row
lalu N query tambahan mengambil relation untuk tiap root row
```

Contoh:

```java
List<CaseDetail> cases = caseMapper.searchCases(criteria);
for (CaseDetail c : cases) {
    c.getDocuments().size(); // memicu query per case jika lazy/nested select
}
```

Jika `cases.size() == 200`:

```text
1 query search cases
+ 200 query documents
= 201 query
```

Jika documents masing-masing punya uploader lazy:

```text
1 + 200 + jumlahDocuments query
```

### 5.2 Mengapa N+1 Berbahaya

N+1 bukan sekadar “lebih banyak query”. Efeknya berlapis:

- network roundtrip membesar;
- connection pool pressure naik;
- database parse/execute overhead naik;
- latency p95/p99 naik;
- lock window bisa membesar;
- log SQL membengkak;
- trace sulit dibaca;
- cache menutupi masalah di DEV tapi tidak di PROD;
- data volume kecil di test membuat bug tidak terlihat.

### 5.3 N+1 Sering Tersembunyi

N+1 bisa muncul dari:

- getter dipanggil serializer JSON;
- `toString()` memanggil field lazy;
- logger mencetak object lengkap;
- debugger mengevaluasi property;
- mapper detail dipakai ulang untuk listing;
- UI butuh field tambahan dan developer menambah nested association;
- batch export memakai mapper API yang awalnya dibuat untuk detail page.

---

## 6. Lazy Loading di MyBatis

MyBatis punya setting global seperti `lazyLoadingEnabled`, `aggressiveLazyLoading`, dan `lazyLoadTriggerMethods`. Dokumentasi konfigurasi MyBatis juga menjelaskan bahwa lazy loading dapat dikendalikan global, sementara `fetchType` pada `association`/`collection` dapat mengoverride setting tersebut. 

### 6.1 Konfigurasi Dasar

```xml
<settings>
  <setting name="lazyLoadingEnabled" value="true"/>
  <setting name="aggressiveLazyLoading" value="false"/>
</settings>
```

Di Spring Boot:

```yaml
mybatis:
  configuration:
    lazy-loading-enabled: true
    aggressive-lazy-loading: false
```

Makna konseptual:

- `lazyLoadingEnabled=true`: MyBatis boleh membuat proxy untuk property yang dimuat secara lazy.
- `aggressiveLazyLoading=false`: akses satu lazy property tidak otomatis memuat semua lazy property.
- `fetchType="lazy"`: relation tertentu lazy.
- `fetchType="eager"`: relation tertentu eager.

### 6.2 Contoh Lazy Association

```xml
<resultMap id="CaseMap" type="com.acme.caseapp.CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>

  <association
      property="applicant"
      column="applicant_id"
      select="com.acme.caseapp.ApplicantMapper.findSummaryById"
      fetchType="lazy"/>
</resultMap>
```

Saat `findCaseById` dipanggil:

```text
CaseDetail object dibuat.
Applicant belum dimuat.
Applicant property berisi proxy/lazy loader.
Saat getApplicant() dipanggil, query applicant dieksekusi.
```

### 6.3 Lazy Loading Bukan Obat Performa Universal

Lazy loading bisa mengurangi query bila relation tidak pernah dibaca.

Tetapi lazy loading bisa memperburuk performa bila relation akhirnya dibaca untuk banyak root object.

```text
Lazy loading baik jika “sering tidak dipakai”.
Lazy loading buruk jika “hampir selalu dipakai tetapi tersembunyi”.
```

### 6.4 Serialization Trap

Contoh controller:

```java
@GetMapping("/cases/{id}")
public CaseDetail getCase(@PathVariable long id) {
    return caseMapper.findCaseById(id);
}
```

Jika `CaseDetail` punya lazy `documents`, serializer JSON bisa memanggil getter:

```text
Jackson serialize CaseDetail
  → getDocuments()
  → lazy load documents
  → SELECT documents
```

Dampaknya:

- query terjadi di layer web;
- transaction/session mungkin sudah selesai;
- error bisa muncul saat serialization, bukan saat service logic;
- response shape menjadi tidak eksplisit;
- query count tidak terlihat di service method.

Production rule:

```text
Jangan expose object lazy-loaded langsung sebagai API response.
Gunakan DTO/projection eksplisit.
```

### 6.5 Logging dan Debugger Trap

`toString()` yang generated oleh Lombok bisa berbahaya:

```java
@Data
public class CaseDetail {
    private Long caseId;
    private Applicant applicant;
    private List<Document> documents;
}
```

`@Data` menghasilkan `toString()`, `equals()`, dan `hashCode()` yang bisa menyentuh field nested.

Jika field nested lazy:

```java
log.info("case={}", caseDetail);
```

Bisa memicu load tambahan.

Safe pattern:

```java
@Getter
@Setter
public class CaseDetail {
    private Long caseId;
    private String caseNo;

    @ToString.Exclude
    private List<DocumentRow> documents;
}
```

Atau lebih baik: jangan pakai object lazy untuk logging.

---

## 7. Session Lifetime dan Lazy Loading

Lazy loading membutuhkan akses ke `SqlSession`/executor context yang relevan. Dengan Spring, mapper biasanya berjalan lewat `SqlSessionTemplate` yang terikat pada transaksi/session Spring. Jika lazy property diakses setelah session tidak valid, hasilnya bisa error atau perilaku yang sulit diprediksi tergantung konfigurasi dan proxy.

### 7.1 Anti-Pattern: Return Lazy Object dari Service

```java
@Transactional(readOnly = true)
public CaseDetail getCase(long caseId) {
    return caseMapper.findCaseById(caseId);
}

// Di luar transaction:
CaseDetail detail = service.getCase(100L);
detail.getDocuments(); // lazy load setelah boundary service
```

Problem:

- transaction sudah selesai;
- snapshot consistency hilang;
- database access terjadi di tempat tidak terkontrol;
- observability sulit;
- error muncul terlambat.

### 7.2 Safe Pattern: Materialize Dalam Boundary

```java
@Transactional(readOnly = true)
public CaseResponse getCase(long caseId) {
    CaseDetail detail = caseMapper.findCaseById(caseId);
    List<DocumentRow> documents = documentMapper.findByCaseId(caseId);
    return CaseResponse.from(detail, documents);
}
```

Keuntungan:

- semua query eksplisit;
- transaction boundary jelas;
- response shape jelas;
- testing query count mudah;
- tidak ada lazy serialization trap.

---

## 8. Nested Result

Nested result memakai join dan resultMap untuk membangun graph dari satu result set.

### 8.1 One-to-One Nested Result

```xml
<resultMap id="CaseDetailMap" type="com.acme.caseapp.CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <result property="status" column="case_status"/>

  <association property="applicant" javaType="com.acme.caseapp.ApplicantSummary">
    <id property="applicantId" column="applicant_id"/>
    <result property="name" column="applicant_name"/>
  </association>
</resultMap>

<select id="findDetail" resultMap="CaseDetailMap">
  SELECT
    c.case_id,
    c.case_no,
    c.status AS case_status,
    a.applicant_id,
    a.name AS applicant_name
  FROM case_file c
  JOIN applicant a ON a.applicant_id = c.applicant_id
  WHERE c.case_id = #{caseId}
</select>
```

Untuk one-to-one, nested result umumnya aman jika alias jelas.

### 8.2 One-to-Many Nested Result

```xml
<resultMap id="CaseWithDocumentsMap" type="com.acme.caseapp.CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>

  <collection property="documents" ofType="com.acme.caseapp.DocumentRow">
    <id property="documentId" column="document_id"/>
    <result property="fileName" column="file_name"/>
  </collection>
</resultMap>

<select id="findCaseWithDocuments" resultMap="CaseWithDocumentsMap">
  SELECT
    c.case_id,
    c.case_no,
    d.document_id,
    d.file_name
  FROM case_file c
  LEFT JOIN document d ON d.case_id = c.case_id
  WHERE c.case_id = #{caseId}
  ORDER BY d.created_at ASC, d.document_id ASC
</select>
```

Jika case punya 10 documents, result set punya 10 rows. MyBatis collapse menjadi 1 `CaseDetail` dengan 10 documents.

### 8.3 Pentingnya `<id>` pada Nested Mapping

`<id>` bukan hanya dokumentasi. Ia membantu MyBatis mengidentifikasi object yang sama saat result set berulang.

Jika `<id>` child salah atau hilang:

- collection bisa duplicate;
- object identity salah;
- memory bertambah;
- merge nested graph salah;
- bug sulit dideteksi karena SQL terlihat benar.

Rule:

```text
Setiap root, association, dan collection nested result harus punya <id> yang benar.
```

---

## 9. Cartesian Explosion

### 9.1 Masalah

Misalnya:

```text
Case punya 5 documents
Case punya 4 notes
Case punya 3 assignments
```

Jika query join semuanya:

```sql
FROM case_file c
LEFT JOIN document d ON d.case_id = c.case_id
LEFT JOIN note n ON n.case_id = c.case_id
LEFT JOIN assignment a ON a.case_id = c.case_id
```

Result row count:

```text
5 × 4 × 3 = 60 rows untuk 1 case
```

Padahal data sebenarnya hanya:

```text
1 case + 5 documents + 4 notes + 3 assignments
```

Ini cartesian multiplication.

### 9.2 Dampak

- network payload membesar;
- database kerja lebih berat;
- MyBatis harus collapse lebih banyak row;
- duplicate child bisa muncul jika mapping id salah;
- pagination hampir pasti rusak;
- memory bertambah;
- latency naik.

### 9.3 Rule

```text
Jangan join banyak one-to-many collection sekaligus untuk membangun graph besar.
```

Gunakan salah satu:

- root query + batch child query;
- separate mapper calls dalam service;
- manual graph assembly;
- API endpoint terpisah per section;
- projection khusus;
- materialized/read model untuk reporting.

---

## 10. Manual Graph Assembly

Manual graph assembly sering lebih eksplisit dan lebih aman daripada nested select/lazy loading.

### 10.1 Pattern

```java
@Transactional(readOnly = true)
public List<CaseCardResponse> searchCases(CaseSearchCriteria criteria) {
    List<CaseCardRow> cases = caseMapper.searchCaseCards(criteria);

    if (cases.isEmpty()) {
        return List.of(); // Java 9+. Untuk Java 8: Collections.emptyList()
    }

    List<Long> caseIds = cases.stream()
        .map(CaseCardRow::getCaseId)
        .collect(Collectors.toList());

    List<DocumentCountRow> documentCounts = documentMapper.countByCaseIds(caseIds);
    Map<Long, Integer> docCountByCaseId = documentCounts.stream()
        .collect(Collectors.toMap(DocumentCountRow::getCaseId, DocumentCountRow::getCount));

    return cases.stream()
        .map(c -> CaseCardResponse.from(c, docCountByCaseId.getOrDefault(c.getCaseId(), 0)))
        .collect(Collectors.toList());
}
```

SQL child:

```xml
<select id="countByCaseIds" resultType="com.acme.caseapp.DocumentCountRow">
  SELECT
    case_id,
    COUNT(*) AS count
  FROM document
  WHERE case_id IN
  <foreach collection="caseIds" item="caseId" open="(" separator="," close=")">
    #{caseId}
  </foreach>
  GROUP BY case_id
</select>
```

### 10.2 Keuntungan

```text
1 query root
+ 1 query child aggregate
= 2 query stabil
```

Bukan:

```text
1 + N query
```

Kelebihan:

- query count predictable;
- result shape eksplisit;
- pagination root aman;
- child fetch bisa dioptimalkan;
- mudah test;
- mudah trace;
- cocok untuk listing.

### 10.3 Kekurangan

- kode service lebih banyak;
- perlu assembler;
- perlu mengelola ordering;
- perlu handle empty list;
- perlu chunking jika `caseIds` besar.

Untuk production system besar, kekurangan ini sering layak dibayar demi observability dan correctness.

---

## 11. Root-First Pagination + Child Batch Fetch

Ini pattern penting.

### 11.1 Problem: Pagination dengan Join Collection

Query seperti ini bermasalah:

```sql
SELECT
  c.case_id,
  c.case_no,
  d.document_id,
  d.file_name
FROM case_file c
LEFT JOIN document d ON d.case_id = c.case_id
ORDER BY c.created_at DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

Jika satu case punya banyak documents, pagination bekerja pada row hasil join, bukan root case.

Akibat:

- satu case bisa muncul di page berbeda;
- jumlah root case per page tidak stabil;
- document collection tidak lengkap;
- user melihat duplicate/missing item.

### 11.2 Safe Pattern

Step 1: paginate root only.

```sql
SELECT
  c.case_id,
  c.case_no,
  c.status,
  c.created_at
FROM case_file c
WHERE c.agency_code = #{agencyCode}
ORDER BY c.created_at DESC, c.case_id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

Step 2: fetch child by root IDs.

```sql
SELECT
  d.case_id,
  d.document_id,
  d.file_name,
  d.created_at
FROM document d
WHERE d.case_id IN (...)
ORDER BY d.case_id, d.created_at ASC, d.document_id ASC
```

Step 3: group in Java.

```java
Map<Long, List<DocumentRow>> docsByCaseId = documents.stream()
    .collect(Collectors.groupingBy(DocumentRow::getCaseId));
```

Step 4: assemble response preserving root order.

```java
List<CaseWithDocumentsResponse> result = cases.stream()
    .map(c -> CaseWithDocumentsResponse.of(
        c,
        docsByCaseId.getOrDefault(c.getCaseId(), Collections.emptyList())
    ))
    .collect(Collectors.toList());
```

### 11.3 Rule

```text
Paginate root entity first.
Fetch child collections second.
Assemble graph explicitly.
```

---

## 12. Fetch Strategy Decision Matrix

| Use Case | Recommended Strategy | Avoid |
|---|---|---|
| Listing/search page | Flat projection or root-first + batch aggregate | Lazy collection per row |
| Detail by id with small one-to-one relation | Nested result | Over-generic domain graph |
| Detail by id with one small collection | Nested result or explicit second query | Multiple collection joins |
| Detail page with many sections | Separate section queries | One monster join |
| Export large data | Cursor/streaming flat projection | Lazy graph |
| Dashboard counts | Aggregate projection | Loading full child collection |
| Authorization-sensitive listing | Scoped SQL projection | Post-filtering graph in Java |
| API response | DTO/projection | Returning lazy domain object |
| Report | SQL/read model/materialized view | Object graph traversal |
| Legacy graph API | Manual assembly with query count tests | Hidden lazy loading |

---

## 13. Object Graph Boundary

A top-tier MyBatis design defines explicit graph boundary.

Bad boundary:

```java
Case caseObj = caseMapper.findById(id);
caseObj.getApplicant().getAddress().getCountry().getName();
caseObj.getDocuments().get(0).getUploadedBy().getRoles();
```

This is uncontrolled graph traversal.

Good boundary:

```java
CaseDetailResponse response = caseQueryService.getCaseDetail(id);
```

The response explicitly decides:

- include applicant summary;
- include assigned officer summary;
- include up to 20 latest documents;
- include document count;
- exclude audit trail;
- exclude full applicant address;
- exclude internal role data.

Object graph boundary should be use-case-shaped, not database-shaped.

---

## 14. Domain Entity vs Query DTO

### 14.1 Domain Entity Graph

A domain entity graph is tempting:

```java
public class CaseFile {
    private CaseId id;
    private Applicant applicant;
    private List<Document> documents;
    private List<Assignment> assignments;
    private List<AuditEvent> auditEvents;
}
```

But with MyBatis, this can become dangerous if reused for all reads.

### 14.2 Query DTO

For read use cases, prefer query DTO:

```java
public class CaseListingRow {
    private Long caseId;
    private String caseNo;
    private String statusLabel;
    private String applicantName;
    private String assignedOfficerName;
    private int documentCount;
}
```

### 14.3 Rule

```text
Use domain entity for behavior/state transitions.
Use projection DTO for read/display/reporting.
```

For MyBatis, projection DTO is often more honest than pretending every query returns a rich aggregate.

---

## 15. First-Level Cache Interaction

MyBatis local cache helps prevent circular references and speeds repeated nested queries; by default `localCacheScope=SESSION`, while `STATEMENT` limits cache sharing to a single statement execution. Documentation also notes local cache is attached to a session and cleared on update, commit, rollback, and close. 

### 15.1 How Local Cache Can Hide N+1

Suppose 100 cases share 5 applicants.

Nested select might execute:

```text
SELECT case list
SELECT applicant 1
SELECT applicant 2
SELECT applicant 3
SELECT applicant 4
SELECT applicant 5
```

Because local cache prevents duplicate applicant query within same session.

This can hide the real issue:

- if session scope changes;
- if parameters differ slightly;
- if tenant/security parameters included;
- if query executed across transactions;
- if cache scope set to `STATEMENT`;
- if relation cardinality is high.

### 15.2 Local Cache Is Not a Fetch Strategy

Do not rely on local cache as your primary N+1 mitigation.

Better:

```text
Design query count explicitly.
```

---

## 16. Second-Level Cache Interaction

Second-level cache can make nested select appear fast in testing.

But for relational graph loading, it creates tricky questions:

- Which mapper namespace owns the cache?
- When child update invalidates parent graph?
- Is tenant included in cache key?
- Are authorization-scoped results cached safely?
- Is cached object mutable?
- Is stale relation acceptable?

Production rule:

```text
Do not use second-level cache to compensate for bad graph loading design.
```

Use Redis/application cache explicitly for stable reference data when needed.

---

## 17. Lazy Loading and `equals`, `hashCode`, `toString`

### 17.1 The Problem

Lazy proxy fields may be accessed accidentally by:

- `equals()`;
- `hashCode()`;
- `toString()`;
- serializer;
- debugger;
- validation library;
- template rendering.

### 17.2 Dangerous Lombok Example

```java
@Data
public class CaseDetail {
    private Long caseId;
    private Applicant applicant;
    private List<DocumentRow> documents;
}
```

`@Data` generates too much for persistence objects.

### 17.3 Safer Lombok Pattern

```java
@Getter
@Setter
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class CaseDetail {
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long caseId;

    @ToString.Include
    private String caseNo;

    private Applicant applicant;
    private List<DocumentRow> documents;
}
```

Better yet: avoid lazy-loaded object as response model.

---

## 18. Circular Reference Risk

Object graph can be circular:

```text
Case → Documents[] → Case
Applicant → Cases[] → Applicant
Department → Officers[] → Department
```

Risks:

- infinite serialization;
- huge JSON response;
- stack overflow in `toString()`;
- confusing lazy loading;
- accidental recursive mapper calls.

Design rule:

```text
Read DTO should be acyclic.
API response should be acyclic.
Mapper result should not expose unlimited bidirectional graph.
```

---

## 19. One-to-One: Join or Nested Select?

For many-to-one or one-to-one relation, join is often better if the relation is always needed.

Example listing:

```sql
SELECT
  c.case_id,
  c.case_no,
  a.name AS applicant_name,
  o.name AS officer_name
FROM case_file c
JOIN applicant a ON a.applicant_id = c.applicant_id
LEFT JOIN officer o ON o.officer_id = c.assigned_officer_id
WHERE c.agency_code = #{agencyCode}
ORDER BY c.created_at DESC, c.case_id DESC
```

This is better than:

```text
SELECT cases
+ N SELECT applicant
+ N SELECT officer
```

Rule:

```text
If relation is small, one-to-one/many-to-one, and always needed, join it explicitly.
```

---

## 20. One-to-Many: Join or Batch Fetch?

For one-to-many relation, join is acceptable when:

- root is one object by id;
- child count is small;
- only one collection is joined;
- no root pagination;
- resultMap `<id>` is correct.

Batch fetch is better when:

- root is paginated list;
- child count varies;
- multiple collections needed;
- child needs independent sorting/limit;
- response only needs summary/aggregate.

Example: documents for 20 cases.

Bad:

```text
1 query cases
+ 20 query documents
```

Good:

```text
1 query cases
+ 1 query documents WHERE case_id IN (...)
```

Even better for listing if only count needed:

```text
1 query cases with aggregated document_count
```

---

## 21. Collection Limit Problem

Sometimes detail page needs only latest 5 documents per case.

If you join documents directly, limiting per parent is vendor-specific.

Options:

1. Separate query:

```sql
SELECT ...
FROM document
WHERE case_id = #{caseId}
ORDER BY created_at DESC
FETCH FIRST 5 ROWS ONLY
```

2. Window function:

```sql
SELECT *
FROM (
  SELECT
    d.*,
    ROW_NUMBER() OVER (PARTITION BY d.case_id ORDER BY d.created_at DESC, d.document_id DESC) AS rn
  FROM document d
  WHERE d.case_id IN (...)
) x
WHERE x.rn <= 5
```

3. Endpoint-per-section:

```text
GET /cases/{id}
GET /cases/{id}/documents?limit=5
GET /cases/{id}/notes?limit=10
```

Rule:

```text
Do not load unlimited collections just because object has List<T> field.
```

---

## 22. Fetch Size Is Not Graph Control

`fetchSize` is a driver hint for rows fetched from database per roundtrip. It can help large flat result streaming.

It does not solve:

- N+1;
- cartesian explosion;
- wrong pagination;
- unbounded object graph;
- lazy serialization trap.

Use `fetchSize` for large result transport tuning, not as architecture fix.

---

## 23. Cursor/Streaming and Object Graph

Cursor is best with flat projection.

Bad idea:

```text
Cursor<CaseDetail> where each CaseDetail lazy-loads documents
```

This can create:

- open cursor long lifetime;
- additional query while cursor still open;
- connection pinned too long;
- transaction held too long;
- memory/resource leak if stream not closed.

Good idea:

```java
Cursor<CaseExportRow> exportCases(CaseExportCriteria criteria);
```

Where `CaseExportRow` is flat and complete enough.

Rule:

```text
Streaming export should prefer flat rows, not lazy graph traversal.
```

---

## 24. API Design: Detail Endpoint vs Section Endpoint

For large case-management systems, one detail page often has sections:

- overview;
- applicant;
- documents;
- correspondence;
- assignments;
- audit trail;
- history;
- enforcement action;
- payment/revenue;
- notes;
- related cases.

Trying to load all sections in one graph usually fails.

Better:

```text
GET /cases/{id}/overview
GET /cases/{id}/documents?page=1
GET /cases/{id}/audit-events?page=1
GET /cases/{id}/assignments
GET /cases/{id}/related-cases
```

Persistence layer then maps each endpoint to specific mapper queries.

Benefits:

- bounded response;
- bounded query;
- independent pagination;
- independent security scope;
- easier caching;
- easier SLA tuning.

---

## 25. Security and Authorization Boundary

Lazy loading can accidentally bypass authorization if relation mapper does not include the same security scope.

Bad:

```xml
<select id="findDocumentsByCaseId" resultType="DocumentRow">
  SELECT *
  FROM document
  WHERE case_id = #{caseId}
</select>
```

If case access was checked in parent query but child query has no agency/tenant/security scope, a bug in parent-child relation may leak data.

Better:

```xml
<select id="findDocumentsByCaseScope" resultType="DocumentRow">
  SELECT
    d.document_id,
    d.case_id,
    d.file_name
  FROM document d
  JOIN case_file c ON c.case_id = d.case_id
  WHERE d.case_id = #{caseId}
    AND c.agency_code = #{agencyCode}
    AND c.deleted = 'N'
</select>
```

Rule:

```text
Every child fetch must preserve the same visibility/security boundary as the parent fetch.
```

This is especially important for:

- multi-tenant systems;
- agency-scoped systems;
- case-management systems;
- enforcement/regulatory data;
- confidential documents;
- audit trail;
- personally identifiable data.

---

## 26. Soft Delete Visibility

Parent query may filter soft deleted rows:

```sql
WHERE c.deleted = 'N'
```

But child lazy query may forget:

```sql
SELECT * FROM document WHERE case_id = #{caseId}
```

Should be:

```sql
SELECT *
FROM document
WHERE case_id = #{caseId}
  AND deleted = 'N'
```

Or if parent visibility also matters:

```sql
SELECT d.*
FROM document d
JOIN case_file c ON c.case_id = d.case_id
WHERE d.case_id = #{caseId}
  AND d.deleted = 'N'
  AND c.deleted = 'N'
```

Rule:

```text
Nested relation query is still a full security and visibility contract.
```

---

## 27. Multi-Tenant Graph Loading

Tenant context must be included in child queries.

Bad:

```xml
<collection property="documents"
            column="case_id"
            select="DocumentMapper.findByCaseId"/>
```

If `case_id` is not globally unique across tenants, this leaks or corrupts graph.

Better:

```xml
<collection property="documents"
            column="{caseId=case_id,tenantId=tenant_id}"
            select="DocumentMapper.findByCaseScope"/>
```

Child:

```sql
WHERE case_id = #{caseId}
  AND tenant_id = #{tenantId}
```

Top-tier rule:

```text
Relationship key must include all partitioning dimensions, not just local ID.
```

---

## 28. Testing Query Count

You cannot rely only on result correctness. N+1 often returns correct data but with terrible performance.

Test dimensions:

1. Correct object shape.
2. Correct child count.
3. Correct null handling.
4. Correct duplicate collapse.
5. Correct query count.
6. Correct behavior under 0, 1, many children.
7. Correct behavior under pagination.
8. Correct tenant/security scope.

### 28.1 Query Count Test Idea

Use a datasource proxy or SQL logging test utility to count queries.

Expected:

```text
search 20 case cards with document count
  → should execute 1 or 2 queries, not 21
```

Pseudo-test:

```java
@Test
void searchCaseCards_shouldNotTriggerNPlusOne() {
    sqlCounter.reset();

    List<CaseCardResponse> result = service.searchCases(criteriaFor20Rows());

    assertThat(result).hasSize(20);
    assertThat(sqlCounter.count()).isLessThanOrEqualTo(2);
}
```

### 28.2 Data Shape Test

Use data that reveals duplication:

```text
Case A: 2 documents, 3 notes
Case B: 0 documents, 1 note
Case C: 1 document, 0 notes
```

This catches:

- null child mapping issue;
- duplicate child issue;
- cartesian explosion;
- missing child rows;
- wrong outer join behavior.

---

## 29. Observability for Graph Loading

Production visibility should answer:

- How many SQL statements per request?
- Which mapper statement caused repeated calls?
- Was relation loaded lazily?
- How many rows returned per statement?
- How long did child query take?
- Was query triggered during serialization?
- Was session/transaction already closed?

Recommended metrics/logging:

```text
request_id=abc
handler=GET /cases/search
sql.count=2
sql.total_ms=37
mapper.top=CaseMapper.searchCaseCards:25ms, DocumentMapper.countByCaseIds:12ms
rows.total=40
```

For debugging N+1:

```text
mapper=DocumentMapper.findByCaseId called 100 times in one request
```

Add safeguards in performance tests for critical listing APIs.

---

## 30. Production Failure Modes

### 30.1 Slow Listing Page

Symptoms:

- search page slow only with many rows;
- DB shows many repeated small queries;
- app logs show same statement repeated;
- connection pool active count high.

Likely cause:

```text
Nested select/lazy collection on list result.
```

Fix:

- replace with projection;
- aggregate child query;
- root-first batch fetch;
- query count test.

### 30.2 Wrong Page Size

Symptoms:

- requested 20 cases, got 7;
- duplicate cases across pages;
- child collection incomplete.

Likely cause:

```text
Paginating joined one-to-many result.
```

Fix:

- root-first pagination;
- child fetch second.

### 30.3 Huge Memory Spike

Symptoms:

- heap spike on detail endpoint;
- GC pressure;
- response too large;
- query returns many repeated rows.

Likely cause:

```text
Multiple collection join / cartesian explosion.
```

Fix:

- split queries;
- paginate child sections;
- limit collections;
- avoid monster graph.

### 30.4 Unexpected SQL During JSON Serialization

Symptoms:

- SQL logs appear after controller returned;
- stack trace includes Jackson;
- Lazy loading error outside transaction.

Likely cause:

```text
Returning lazy-loaded object directly.
```

Fix:

- map to DTO in service;
- disable lazy loading for API models;
- avoid exposing persistence graph.

### 30.5 Data Leak in Child Collection

Symptoms:

- child data from wrong agency/tenant;
- parent access is scoped correctly;
- child mapper only filters by parent ID.

Likely cause:

```text
Nested child query missing tenant/security predicate.
```

Fix:

- pass composite scope;
- join parent in child query;
- add authorization tests.

---

## 31. Java 8 sampai Java 25 Considerations

### 31.1 Java 8

- Use POJO DTO.
- Use `Collections.emptyList()`.
- Use explicit mapper/service assembly.
- Avoid relying on records.
- Be careful with Lombok-generated methods.

### 31.2 Java 11

- Similar to Java 8 from MyBatis design perspective.
- Better runtime performance and library ecosystem.
- Still prefer explicit DTO.

### 31.3 Java 17

- Records become attractive for immutable projection DTO.
- Spring Boot 3 baseline requires Java 17.
- Use records carefully with constructor/result mapping.

Example:

```java
public record CaseCardRow(
    Long caseId,
    String caseNo,
    String status,
    String applicantName,
    int documentCount
) {}
```

### 31.4 Java 21

Virtual threads can reduce thread blocking cost, but they do not fix bad query shape.

```text
Virtual threads can make blocking cheaper.
They do not make N+1 query correct.
```

Even with virtual threads:

- database still receives N+1 queries;
- connection pool still limits concurrency;
- DB CPU/IO still matters;
- locks still matter;
- latency still accumulates.

### 31.5 Java 25

The architectural rules remain:

- explicit query shape;
- explicit graph boundary;
- bounded result;
- no hidden lazy response;
- query count observability;
- security-scoped child fetch.

Java language evolution helps DTO design, but does not remove persistence design responsibility.

---

## 32. Recommended Configuration Stance

For production enterprise systems, conservative stance:

```yaml
mybatis:
  configuration:
    lazy-loading-enabled: false
    aggressive-lazy-loading: false
    local-cache-scope: SESSION
```

Then opt into nested loading explicitly only where justified.

Alternative if using lazy loading:

```yaml
mybatis:
  configuration:
    lazy-loading-enabled: true
    aggressive-lazy-loading: false
```

But enforce:

- no lazy object returned from service/controller;
- DTO mapping inside transaction;
- query count tests;
- no Lombok `@Data` on graph object;
- child query scope includes tenant/security;
- logging avoids graph expansion.

---

## 33. Design Patterns

### 33.1 Projection Mapper Pattern

```java
public interface CaseListingMapper {
    List<CaseCardRow> searchCaseCards(CaseSearchCriteria criteria);
}
```

Use for:

- listing;
- dashboard;
- search;
- API response.

### 33.2 Detail Section Mapper Pattern

```java
public interface CaseDetailMapper {
    CaseOverviewRow findOverview(CaseScope scope);
    List<DocumentRow> findDocuments(CaseDocumentCriteria criteria);
    List<AssignmentRow> findAssignments(CaseScope scope);
    List<AuditEventRow> findAuditEvents(AuditSearchCriteria criteria);
}
```

Use for:

- bounded detail page;
- independent section loading;
- permission-sensitive sections.

### 33.3 Root-Child Batch Fetch Pattern

```text
find root page
find children by root IDs
assemble by root ID
```

Use for:

- list with child summary;
- list with small child collection;
- avoiding N+1.

### 33.4 Aggregate Instead of Collection Pattern

Instead of loading documents:

```java
List<DocumentRow> documents;
```

Return:

```java
int documentCount;
Instant latestDocumentUploadedAt;
```

Use for listing.

### 33.5 Explicit Graph Factory Pattern

```java
public CaseDetailResponse getCaseDetail(CaseScope scope) {
    CaseOverviewRow overview = caseMapper.findOverview(scope);
    ApplicantRow applicant = applicantMapper.findByCaseScope(scope);
    List<DocumentRow> documents = documentMapper.findLatestByCaseScope(scope, 20);

    return CaseDetailResponse.of(overview, applicant, documents);
}
```

Use for:

- precise API contract;
- auditability;
- performance control.

---

## 34. Anti-Patterns

### 34.1 Universal `findById` Returning Huge Graph

```java
CaseFile findById(Long id);
```

Where `CaseFile` contains everything.

Problem:

- use case unclear;
- hard to optimize;
- hidden lazy loading;
- likely overfetching.

Better:

```java
CaseOverviewRow findOverview(CaseScope scope);
CaseDetailRow findDetailHeader(CaseScope scope);
List<DocumentRow> findDocuments(CaseDocumentCriteria criteria);
```

### 34.2 Mapper for Listing Uses Detail ResultMap

```xml
<select id="searchCases" resultMap="CaseDetailMap">
```

Problem:

- detail graph loaded for listing;
- N+1 risk;
- huge memory.

Better:

```xml
<select id="searchCaseCards" resultMap="CaseCardMap">
```

### 34.3 Multiple Collections in One Join

```text
Case + Documents + Notes + Assignments + AuditEvents
```

Problem:

- cartesian explosion;
- duplicated child;
- huge row count.

Better:

- separate section queries;
- root-first batch fetch;
- aggregate counts.

### 34.4 Lazy Loading as Default Architecture

Problem:

- data access becomes implicit;
- API response unpredictable;
- transaction boundary blurred.

Better:

- explicit DTO query;
- service-level assembly.

### 34.5 Child Query Missing Scope

Problem:

- tenant leak;
- agency leak;
- soft-deleted child appears;
- authorization bypass.

Better:

- scoped child fetch;
- composite key parameters;
- security tests.

---

## 35. Production Checklist

Before approving mapper with nested relation/lazy loading, ask:

1. Is this listing, detail, export, report, or internal command use case?
2. How many root rows can this query return?
3. How many child rows per root?
4. Is any child collection unbounded?
5. Is pagination applied before or after join?
6. Does relation loading create N+1?
7. Is query count tested?
8. Are child queries tenant/agency/security scoped?
9. Are soft-delete filters consistent?
10. Does resultMap use correct `<id>` for root and child?
11. Could serializer trigger lazy loading?
12. Could `toString`, `equals`, or `hashCode` trigger lazy loading?
13. Does API response expose persistence graph?
14. Is transaction/session lifetime clear?
15. Is local/second-level cache hiding a design issue?
16. Are collection sizes bounded?
17. Are child sections independently pageable if large?
18. Is there observability for repeated mapper statements?
19. Does production data shape match test data shape?
20. Is this graph really needed by the caller?

---

## 36. Mini Case Study: Case Search with Document Count and Latest Assignment

### 36.1 Requirement

Search case listing page shows:

- case number;
- status;
- applicant name;
- assigned officer name;
- document count;
- latest assignment date.

It does not show full documents or assignment history.

### 36.2 Bad Design

```java
List<CaseDetail> searchCases(CaseSearchCriteria criteria);
```

`CaseDetail` has:

```java
private Applicant applicant;
private List<Document> documents;
private List<Assignment> assignments;
```

Listing code:

```java
for (CaseDetail c : cases) {
    int docCount = c.getDocuments().size();
    Assignment latest = c.getAssignments().get(0);
}
```

Problem:

- N+1 for documents;
- N+1 for assignments;
- loads full collection just to count/latest;
- slow listing;
- memory waste.

### 36.3 Better Design

Mapper returns projection:

```java
public class CaseCardRow {
    private Long caseId;
    private String caseNo;
    private String status;
    private String applicantName;
    private String assignedOfficerName;
    private int documentCount;
    private Instant latestAssignmentAt;
}
```

SQL:

```sql
SELECT
  c.case_id,
  c.case_no,
  c.status,
  a.name AS applicant_name,
  o.name AS assigned_officer_name,
  COALESCE(dc.document_count, 0) AS document_count,
  la.latest_assignment_at
FROM case_file c
JOIN applicant a ON a.applicant_id = c.applicant_id
LEFT JOIN officer o ON o.officer_id = c.assigned_officer_id
LEFT JOIN (
  SELECT case_id, COUNT(*) AS document_count
  FROM document
  WHERE deleted = 'N'
  GROUP BY case_id
) dc ON dc.case_id = c.case_id
LEFT JOIN (
  SELECT case_id, MAX(assigned_at) AS latest_assignment_at
  FROM case_assignment
  GROUP BY case_id
) la ON la.case_id = c.case_id
WHERE c.agency_code = #{agencyCode}
  AND c.deleted = 'N'
ORDER BY c.created_at DESC, c.case_id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

This returns exactly what listing needs.

### 36.4 Top-Tier Reasoning

The listing does not need documents.

It needs document count.

Therefore loading `List<Document>` is wrong even if it works.

```text
Correct shape beats convenient object graph.
```

---

## 37. Mini Case Study: Case Detail with Documents and Audit Trail

### 37.1 Requirement

Case detail page has:

- overview;
- applicant summary;
- latest 20 documents;
- audit trail paginated separately.

### 37.2 Bad Design

One mapper:

```java
CaseDetail findFullCaseDetail(long caseId);
```

Containing:

- all documents;
- all audit events;
- all notes;
- all assignments.

Problem:

- unbounded collections;
- huge response;
- cartesian explosion;
- slow page load;
- audit trail may contain sensitive fields;
- pagination impossible.

### 37.3 Better Design

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCaseDetail(CaseScope scope) {
    CaseOverviewRow overview = caseMapper.findOverview(scope);
    ApplicantSummaryRow applicant = applicantMapper.findSummaryByCaseScope(scope);
    List<DocumentRow> latestDocuments = documentMapper.findLatestByCaseScope(scope, 20);

    return CaseDetailResponse.of(overview, applicant, latestDocuments);
}

public Page<AuditEventRow> getAuditTrail(AuditTrailCriteria criteria) {
    return auditMapper.searchAuditEvents(criteria);
}
```

Benefits:

- audit trail independently paginated;
- response bounded;
- security boundary explicit;
- no lazy loading;
- easier SLA tuning.

---

## 38. Practical Rules of Thumb

1. For listing, prefer projection.
2. For detail header, join one-to-one fields.
3. For one-to-many in listing, prefer aggregate or batch fetch.
4. For one-to-many in detail, allow nested result only if bounded and single collection.
5. Never paginate joined one-to-many result as root page.
6. Do not return lazy-loaded object from controller.
7. Do not use lazy loading to avoid designing response DTO.
8. Do not join multiple unbounded collections.
9. Every nested child query must include tenant/security/soft-delete scope.
10. Query count should be part of tests for critical endpoints.
11. `fetchSize` helps transport, not graph design.
12. Virtual threads do not fix N+1.
13. Local cache is not a fetch strategy.
14. ResultMap `<id>` matters for nested result correctness.
15. API shape should drive mapper shape, not entity graph convenience.

---

## 39. Summary

MyBatis gives explicit SQL control, but relation loading can still become implicit through nested select and lazy loading.

The main engineering challenge is not “how to map child object”. It is:

```text
How do we keep query count, result size, transaction boundary,
security scope, and API shape explicit?
```

The most reliable production patterns are:

- projection-first listing;
- root-first pagination;
- batch child fetch;
- service-level graph assembly;
- bounded detail sections;
- explicit DTO response;
- query count observability;
- security-scoped child queries.

Lazy loading and nested select are tools, not defaults. They are acceptable when root cardinality is small, relation access is truly optional, and query count is controlled.

Nested result is useful for small, bounded graph loading, especially one-to-one and one small one-to-many detail query. It becomes dangerous with multiple collections and pagination.

Top-tier MyBatis engineering treats object graph loading as a deliberate design decision, not as automatic convenience.

---

## 40. What Comes Next

Bagian berikutnya:

```text
19-stored-procedure-function-cursor-out-parameter.md
```

Kita akan membahas stored procedure, database function, cursor, OUT/INOUT parameter, vendor behavior, transaction ownership, error propagation, dan kapan procedure integration sehat atau justru menjadi hidden business logic coupling.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Caching: First-Level Cache, Second-Level Cache, Invalidation](./17-caching-first-level-second-level-cache-invalidation.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 19 — Stored Procedure, Function, Cursor, and OUT Parameter](./19-stored-procedure-function-cursor-out-parameter.md)
