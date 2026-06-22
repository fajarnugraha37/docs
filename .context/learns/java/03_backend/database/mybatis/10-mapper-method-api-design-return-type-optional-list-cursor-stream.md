# Part 10 — Mapper Method API Design: Return Type, Optional, List, Cursor, Stream

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `10-mapper-method-api-design-return-type-optional-list-cursor-stream.md`  
> Target: Java 8 sampai Java 25  
> Fokus: mendesain method mapper MyBatis sebagai **API contract** yang jelas, aman, predictable, dan production-grade.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. posisi MyBatis sebagai SQL-first persistence framework;
2. runtime internal MyBatis;
3. strategi versi Java 8–25;
4. desain mapper interface/XML/annotation;
5. statement mapping `select`, `insert`, `update`, `delete`;
6. parameter binding dan SQL injection boundary;
7. result mapping dasar dan advanced;
8. XML dynamic SQL;
9. MyBatis Dynamic SQL library.

Part ini membahas lapisan yang sering dianggap sepele, padahal sangat menentukan kualitas sistem:

```text
Mapper method signature
  = kontrak semantik antara service layer dan database behavior.
```

Di MyBatis, method mapper bukan hanya “cara memanggil SQL”. Method mapper adalah tempat kita memutuskan:

- apakah data boleh tidak ditemukan;
- apakah duplicate row dianggap bug;
- apakah query boleh mengembalikan banyak data;
- apakah hasil harus dimaterialisasi ke memory;
- apakah hasil bisa di-stream;
- apakah DML harus memakai rows affected sebagai correctness signal;
- apakah return type cukup ekspresif untuk business invariant;
- apakah caller bisa salah paham terhadap efek database.

Top-tier engineer tidak hanya menulis:

```java
User getUser(Long id);
```

Mereka bertanya:

- Apakah user boleh tidak ada?
- Kalau tidak ada, return `null`, `Optional`, atau throw?
- Kalau query by ID menghasilkan 2 rows, apakah itu data corruption?
- Apakah service perlu membedakan “not found” vs “not visible due to tenant scope”?
- Apakah row sudah soft-deleted?
- Apakah method ini aman dipanggil untuk list besar?
- Apakah update ini wajib exactly one row?
- Apakah `0 rows affected` berarti “not found”, “already processed”, “wrong version”, atau “permission denied”?

Part ini akan membangun mental model untuk menjawab pertanyaan-pertanyaan tersebut secara sistematis.

---

## 1. Core Mental Model: Mapper Method Adalah Boundary Contract

Mapper method punya dua sisi:

```text
Java side
  method name
  parameters
  return type
  exception behavior
  nullability behavior
  collection behavior
  transaction expectation

SQL side
  statement id
  SQL text
  parameter mapping
  result mapping
  row cardinality
  lock behavior
  cache behavior
  database constraint behavior
```

Mapper method yang baik membuat dua sisi ini konsisten.

Contoh buruk:

```java
CaseDto getCase(Long id);
```

Masalah:

- `get` terdengar wajib ada, tapi return type nullable.
- Tidak jelas apakah soft-deleted case ikut terlihat.
- Tidak jelas apakah tenant/agency scope diterapkan.
- Tidak jelas apakah duplicate row akan dideteksi.
- Tidak jelas apakah method mengambil detail ringan atau graph besar.

Lebih baik:

```java
Optional<CaseSummaryRow> findVisibleSummaryById(CaseKey key);

CaseDetailRow getRequiredVisibleDetailById(CaseKey key);

int markCaseAssignedIfUnassigned(AssignCaseCommand command);
```

Nama, parameter, dan return type mulai membawa semantik.

---

## 2. Jangan Desain Mapper Dari SQL Dulu; Desain Dari Contract Dulu

Engineer biasa sering mulai dari:

```sql
SELECT * FROM CASE WHERE CASE_ID = #{caseId}
```

Lalu membuat mapper:

```java
Case selectCase(Long caseId);
```

Engineer yang lebih matang mulai dari pertanyaan:

```text
Caller butuh apa?
  detail penuh atau listing projection?

Cardinality-nya apa?
  0..1, exactly 1, 0..N, atau streaming N besar?

Not found artinya apa?
  normal, error, unauthorized, already deleted?

SQL invariant-nya apa?
  id unique, tenant scoped, active only, version checked?

Resource behavior-nya apa?
  small result, paged result, cursor, lock?
```

Baru kemudian menulis SQL.

Mapper method signature harus menjadi bentuk ringkas dari keputusan itu.

---

## 3. Cardinality: Konsep Paling Penting Dalam Return Type

Setiap query punya cardinality contract:

| Contract | Arti | Return Type Umum |
|---|---|---|
| `0..1` | boleh tidak ada, maksimal satu | `Optional<T>` atau nullable `T` |
| `1` | wajib ada tepat satu | `T`, biasanya wrapper di service untuk throw jika tidak ada |
| `0..N small` | banyak tapi bounded kecil | `List<T>` |
| `0..N paged` | banyak, harus dipaginasi | `List<T>` + page metadata/query count |
| `0..N huge` | sangat besar, tidak boleh full memory | `Cursor<T>`, `ResultHandler`, export streaming |
| key-value result | hasil harus diindeks berdasarkan key | `Map<K,V>` dengan `@MapKey` |
| existence | hanya butuh ada/tidak | `boolean` via count/exists mapping atau `int` count |
| mutation | butuh tahu efek DML | `int` rows affected |

Kesalahan umum adalah menyamakan semua query menjadi:

```java
List<T> selectSomething(...);
```

Padahal `List<T>` menyembunyikan banyak hal:

- apakah empty normal?
- apakah size besar?
- apakah duplicate valid?
- apakah caller harus cek size?
- apakah data sudah sorted?
- apakah pagination diterapkan?

---

## 4. `selectOne`: Berguna, Tapi Punya Risiko Semantik

MyBatis Java API menyediakan `selectOne` untuk mengambil satu row. Secara konseptual, `selectOne` cocok untuk query dengan cardinality `0..1`. Dokumentasi MyBatis menyarankan memakai `selectOne` ketika hanya satu object yang harus dikembalikan, dan memakai `selectList` ketika tidak tahu berapa banyak object yang akan kembali.

Contoh mapper:

```java
@Mapper
public interface OfficerMapper {
    OfficerRow selectOneByOfficerId(long officerId);
}
```

XML:

```xml
<select id="selectOneByOfficerId" resultMap="OfficerRowMap">
  SELECT
    o.OFFICER_ID,
    o.DISPLAY_NAME,
    o.EMAIL
  FROM OFFICER o
  WHERE o.OFFICER_ID = #{officerId}
</select>
```

Masalahnya bukan teknis, tapi semantik:

```java
OfficerRow row = officerMapper.selectOneByOfficerId(id);
```

Apa arti `null`?

- officer tidak ada?
- officer soft-deleted?
- officer tidak visible untuk tenant?
- SQL salah?
- mapper salah scope?

Dan kalau database mengembalikan lebih dari satu row, MyBatis akan menganggap itu error karena method/operasi single-result tidak konsisten dengan actual result.

### 4.1 Naming Rule Untuk Single Row

Gunakan nama berbeda untuk semantik berbeda:

```java
Optional<OfficerRow> findById(OfficerId id);

OfficerRow getRequiredById(OfficerId id);

Optional<OfficerRow> findActiveById(OfficerId id);

Optional<OfficerRow> findVisibleById(OfficerVisibilityKey key);
```

Hindari nama ambigu:

```java
OfficerRow getOfficer(Long id);       // ambigu
OfficerRow selectOfficer(Long id);    // teknis, bukan semantik
OfficerRow queryOfficer(Long id);     // terlalu umum
```

---

## 5. `Optional<T>`: Baik Untuk `0..1`, Bukan Untuk Semua Hal

Sejak Java 8, `Optional<T>` dapat dipakai untuk menyatakan “hasil bisa tidak ada”. MyBatis mendukung return type mapper berupa `Optional` pada versi modern MyBatis 3.x.

Contoh:

```java
@Mapper
public interface CaseMapper {
    Optional<CaseSummaryRow> findVisibleSummaryById(CaseKey key);
}
```

XML:

```xml
<select id="findVisibleSummaryById" resultMap="CaseSummaryRowMap">
  SELECT
    c.CASE_ID,
    c.CASE_NO,
    c.STATUS,
    c.CREATED_AT
  FROM CASES c
  WHERE c.CASE_ID = #{caseId}
    AND c.AGENCY_ID = #{agencyId}
    AND c.DELETED_FLAG = 'N'
</select>
```

Kelebihan:

- caller dipaksa memikirkan absence;
- lebih eksplisit daripada nullable return;
- cocok untuk lookup `0..1`;
- cocok untuk `find...` semantic.

Kekurangan:

- `Optional` tidak menjelaskan alasan absence;
- tidak cocok untuk field DTO;
- tidak cocok untuk collection element;
- tidak menggantikan authorization decision;
- tidak membedakan not found vs not visible.

### 5.1 Saat `Optional<T>` Tepat

Gunakan `Optional<T>` ketika:

```text
absence adalah hasil bisnis yang normal
  contoh: user belum punya draft
  contoh: token refresh record tidak ditemukan
  contoh: optional configuration override tidak ada
```

Contoh:

```java
Optional<TemplateOverrideRow> findOverrideByModuleAndAgency(TemplateOverrideKey key);
```

### 5.2 Saat `Optional<T>` Tidak Cukup

Misal service butuh membedakan:

```text
CASE_NOT_FOUND
CASE_DELETED
CASE_NOT_VISIBLE_FOR_AGENCY
CASE_LOCKED
```

Maka mapper bisa menyediakan query yang lebih eksplisit, misalnya:

```java
Optional<CaseAccessProbeRow> probeCaseAccess(CaseAccessProbeQuery query);
```

Dengan row:

```java
public record CaseAccessProbeRow(
    long caseId,
    String status,
    long agencyId,
    boolean deleted,
    boolean assignedToCurrentOfficer
) {}
```

Lalu service yang memutuskan error domain.

---

## 6. Nullable Return: Legacy-Compatible Tapi Harus Disiplin

Untuk Java 8 codebase lama atau style lama, mapper sering memakai nullable return:

```java
CaseRow findById(long caseId);
```

Ini boleh, tetapi harus didisiplinkan.

### 6.1 Naming Untuk Nullable Return

Kalau return bisa `null`, nama method harus memberi sinyal:

```java
CaseRow findNullableById(long caseId);
```

Atau setidaknya dokumentasikan:

```java
/**
 * @return matching case row, or null when not found or not visible.
 */
CaseRow findVisibleById(CaseKey key);
```

Namun dokumentasi sering kalah oleh kebiasaan. Untuk codebase modern, `Optional<T>` lebih baik untuk `0..1`.

### 6.2 Jangan Pakai Nullable Untuk Required Contract

Buruk:

```java
CaseRow getRequiredById(long caseId); // tetapi bisa null
```

Lebih baik service yang enforce:

```java
public CaseRow getRequiredCase(CaseKey key) {
    return caseMapper.findVisibleById(key)
        .orElseThrow(() -> new CaseNotFoundException(key.caseId()));
}
```

Mapper tetap SQL contract; service memegang domain exception.

---

## 7. `List<T>`: Aman Untuk Banyak Row, Tapi Harus Bounded

`List<T>` cocok untuk query yang hasilnya memang banyak dan masih masuk akal dimaterialisasi ke memory.

Contoh:

```java
List<CaseListingRow> searchCases(CaseSearchCriteria criteria);
```

XML:

```xml
<select id="searchCases" resultMap="CaseListingRowMap">
  SELECT
    c.CASE_ID,
    c.CASE_NO,
    c.STATUS,
    c.CREATED_AT,
    c.UPDATED_AT
  FROM CASES c
  <where>
    c.AGENCY_ID = #{agencyId}
    AND c.DELETED_FLAG = 'N'
    <if test="status != null">
      AND c.STATUS = #{status}
    </if>
    <if test="createdFrom != null">
      AND c.CREATED_AT &gt;= #{createdFrom}
    </if>
    <if test="createdToExclusive != null">
      AND c.CREATED_AT &lt; #{createdToExclusive}
    </if>
  </where>
  ORDER BY c.UPDATED_AT DESC, c.CASE_ID DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

### 7.1 `List<T>` Harus Punya Size Strategy

Setiap mapper yang return `List<T>` harus menjawab:

```text
Apakah result bounded?
Apakah limit diwajibkan?
Apakah default limit ada?
Apakah caller bisa minta 1 juta rows?
Apakah query dipakai untuk UI, export, batch, atau internal small lookup?
```

Buruk:

```java
List<AuditTrailRow> findByModule(String module);
```

Bisa mengembalikan jutaan rows.

Lebih baik:

```java
List<AuditTrailListingRow> searchAuditTrailPage(AuditTrailSearchPageQuery query);

Cursor<AuditTrailExportRow> streamAuditTrailForExport(AuditTrailExportQuery query);
```

### 7.2 Empty List Biasanya Lebih Baik Daripada Null

Untuk multi-row query, return empty list lebih baik daripada `null`.

```java
List<DocumentRow> findDocumentsByCaseId(long caseId);
```

Semantik:

```text
empty list = case tidak punya document yang match
```

Jangan membuat caller harus melakukan:

```java
if (rows != null && !rows.isEmpty()) {
    ...
}
```

MyBatis umumnya mengembalikan list kosong untuk `selectList` yang tidak menemukan row.

---

## 8. `Map<K,V>` Dan `@MapKey`: Berguna, Tapi Hati-Hati Duplicate Key

MyBatis mendukung hasil mapper sebagai `Map` dengan `@MapKey` pada mapper method. Ini berguna ketika hasil query harus diindeks berdasarkan property tertentu.

Contoh:

```java
@Mapper
public interface LookupMapper {
    @MapKey("code")
    Map<String, LookupRow> findStatusLookupByModule(String moduleCode);
}
```

Row:

```java
public record LookupRow(
    String code,
    String label,
    int displayOrder,
    boolean active
) {}
```

XML:

```xml
<select id="findStatusLookupByModule" resultMap="LookupRowMap">
  SELECT
    l.CODE,
    l.LABEL,
    l.DISPLAY_ORDER,
    l.ACTIVE_FLAG
  FROM LOOKUP_STATUS l
  WHERE l.MODULE_CODE = #{moduleCode}
  ORDER BY l.DISPLAY_ORDER ASC, l.CODE ASC
</select>
```

### 8.1 Risiko `Map<K,V>`

`Map` membuat lookup mudah, tetapi menyembunyikan risiko:

- duplicate key bisa overwrite tergantung behavior mapping;
- ordering bisa hilang kalau memakai `HashMap`;
- key property harus benar-benar unique;
- caller tidak melihat bahwa query sebenarnya menghasilkan list.

Untuk data yang key uniqueness-nya penting, pertimbangkan validasi eksplisit di service:

```java
List<LookupRow> rows = lookupMapper.findStatusLookupRowsByModule(module);
Map<String, LookupRow> byCode = new LinkedHashMap<>();

for (LookupRow row : rows) {
    LookupRow previous = byCode.put(row.code(), row);
    if (previous != null) {
        throw new IllegalStateException("Duplicate lookup code: " + row.code());
    }
}
```

Kadang `List<T>` + explicit grouping lebih aman daripada langsung `Map<K,V>`.

---

## 9. `boolean exists...`: Jangan Ambil Row Kalau Hanya Butuh Ada/Tidak

Buruk:

```java
Optional<UserRow> findByEmail(String email);

boolean exists = userMapper.findByEmail(email).isPresent();
```

Kalau hanya butuh existence, query existence:

```java
boolean existsActiveUserByEmail(String email);
```

XML, vendor-neutral style:

```xml
<select id="existsActiveUserByEmail" resultType="boolean">
  SELECT CASE WHEN COUNT(1) &gt; 0 THEN 1 ELSE 0 END
  FROM USERS u
  WHERE u.EMAIL = #{email}
    AND u.ACTIVE_FLAG = 'Y'
</select>
```

Namun `COUNT(1)` bisa mahal untuk predicate tertentu karena database mungkin menghitung lebih banyak row daripada perlu. Vendor-specific existence bisa lebih efisien.

Contoh Oracle:

```xml
<select id="existsActiveUserByEmail" resultType="boolean">
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM USERS u
    WHERE u.EMAIL = #{email}
      AND u.ACTIVE_FLAG = 'Y'
  ) THEN 1 ELSE 0 END
  FROM DUAL
</select>
```

Contoh PostgreSQL:

```xml
<select id="existsActiveUserByEmail" resultType="boolean">
  SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.email = #{email}
      AND u.active_flag = 'Y'
  )
</select>
```

### 9.1 Existence Tidak Sama Dengan Authorization

```java
boolean existsById(long caseId);
```

berbeda dengan:

```java
boolean existsVisibleById(CaseVisibilityKey key);
```

Untuk sistem multi-tenant/regulatory, selalu bedakan:

```text
exists physically
exists and active
exists and visible to current agency
exists and user can act on it
```

---

## 10. Count Query: Berguna, Tapi Jangan Otomatis Dipakai Untuk Semua Pagination

Mapper count:

```java
long countCases(CaseSearchCriteria criteria);
```

Digunakan untuk:

- UI total result;
- page metadata;
- validation threshold;
- report summary;
- monitoring.

Namun count bisa mahal, terutama pada query dengan:

- banyak join;
- dynamic filter kompleks;
- low-selectivity predicate;
- permission scope;
- large historical table;
- LOB table join;
- view berat.

### 10.1 Count Contract Harus Jelas

Buruk:

```java
long count(CaseSearchCriteria criteria);
```

Lebih baik:

```java
long countVisibleCasesForSearch(CaseSearchCriteria criteria);

long countPendingAssignmentCases(AssignmentQueueCriteria criteria);

long countAuditTrailForExport(AuditTrailExportCriteria criteria);
```

Count harus memakai filter visibility yang sama dengan listing.

### 10.2 Count dan List Harus Konsisten

Kalau UI memanggil:

```java
long total = caseMapper.countSearchCases(criteria);
List<CaseListingRow> rows = caseMapper.searchCasePage(criteria);
```

Maka dua SQL tersebut harus konsisten dalam:

- tenant filter;
- soft delete filter;
- status filter;
- date range interpretation;
- join semantics;
- permission scope.

Anti-pattern:

```text
search query memakai AGENCY_ID + DELETED_FLAG
count query lupa DELETED_FLAG
```

Hasil UI menjadi misleading.

---

## 11. Insert/Update/Delete Return Type: `int` Rows Affected Adalah Signal Penting

MyBatis `insert`, `update`, dan `delete` umumnya mengembalikan jumlah rows affected.

Ini bukan detail teknis. Ini correctness signal.

Contoh:

```java
int assignCaseIfUnassigned(AssignCaseCommand command);
```

XML:

```xml
<update id="assignCaseIfUnassigned">
  UPDATE CASES
  SET
    ASSIGNED_OFFICER_ID = #{officerId},
    STATUS = 'ASSIGNED',
    UPDATED_BY = #{actorUserId},
    UPDATED_AT = #{now}
  WHERE CASE_ID = #{caseId}
    AND AGENCY_ID = #{agencyId}
    AND ASSIGNED_OFFICER_ID IS NULL
    AND STATUS = 'NEW'
    AND DELETED_FLAG = 'N'
</update>
```

Service:

```java
int updated = caseMapper.assignCaseIfUnassigned(command);

if (updated == 1) {
    return AssignmentResult.assigned();
}

if (updated == 0) {
    return AssignmentResult.notAssignableAnymore();
}

throw new IllegalStateException("Invariant violation: updated " + updated + " rows");
```

### 11.1 Rows Affected Interpretation

Untuk DML single aggregate:

| Rows affected | Arti Kemungkinan |
|---:|---|
| 1 | sukses sesuai invariant |
| 0 | not found, wrong version, wrong status, not visible, already changed |
| >1 | bug serius: predicate tidak cukup spesifik atau data corruption |

Jangan abaikan rows affected:

```java
caseMapper.assignCaseIfUnassigned(command); // buruk kalau hasil tidak dicek
```

Khusus update/delete multi-row, `>1` bisa valid, tapi nama method harus menunjukkan itu:

```java
int bulkExpireDraftsBefore(ExpireDraftsCommand command);
```

---

## 12. `void` Return Untuk DML: Biasanya Anti-Pattern

Buruk:

```java
void updateStatus(UpdateCaseStatusCommand command);
```

Masalah:

- caller tidak tahu apakah row benar-benar berubah;
- optimistic locking tidak bisa dipastikan;
- not found hilang;
- duplicate update tidak terlihat;
- idempotency sulit dibedakan.

Lebih baik:

```java
int updateStatusIfVersionMatches(UpdateCaseStatusCommand command);
```

Lalu service memutuskan:

```java
int updated = mapper.updateStatusIfVersionMatches(command);
if (updated == 0) {
    throw new OptimisticLockingFailureException("Case was modified by another transaction");
}
if (updated != 1) {
    throw new IllegalStateException("Expected exactly one row, got " + updated);
}
```

### 12.1 Kapan `void` Masih Bisa Diterima?

Jarang, misalnya:

- mapper method memanggil stored procedure yang tidak memberi row count berguna;
- best-effort audit non-critical yang failure-nya ditangani di layer lain;
- fire-and-forget maintenance operation, tetap lebih baik explicit result.

Untuk sistem business-critical, gunakan `int` atau domain-specific result.

---

## 13. Domain-Specific Result Di Service, Bukan Mapper

Mapper tidak harus mengembalikan domain decision langsung.

Buruk:

```java
AssignmentResult assignCase(AssignCaseCommand command);
```

Mapper hanya tahu rows affected, bukan alasan domain lengkap.

Lebih baik:

```java
int assignCaseIfUnassigned(AssignCaseCommand command);

Optional<CaseAssignmentProbeRow> findAssignmentState(CaseKey key);
```

Service:

```java
public AssignmentResult assign(AssignCaseCommand command) {
    int updated = caseMapper.assignCaseIfUnassigned(command);
    if (updated == 1) {
        return AssignmentResult.assigned();
    }

    CaseAssignmentProbeRow state = caseMapper.findAssignmentState(command.caseKey())
        .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    if (state.deleted()) {
        return AssignmentResult.caseDeleted();
    }
    if (!state.assignable()) {
        return AssignmentResult.notAssignable(state.status());
    }
    return AssignmentResult.conflict();
}
```

Mapper tetap SQL-focused. Service mengubah SQL signal menjadi business result.

---

## 14. `Cursor<T>`: Untuk Large Result Yang Tidak Boleh Dimaterialisasi

Untuk query besar, `List<T>` bisa menyebabkan:

- heap spike;
- GC pressure;
- long transaction;
- connection held too long;
- timeout;
- out-of-memory;
- slow API response;
- database cursor leak kalau tidak ditutup.

MyBatis menyediakan `Cursor<T>` untuk lazy fetching via iterator. Dokumentasi API MyBatis menyebut `Cursor` cocok untuk query jutaan item yang tidak muat di memory, dan memberi catatan bahwa jika memakai collection dalam resultMap, query cursor harus ordered dengan `resultOrdered="true"` menggunakan id columns.

Contoh mapper:

```java
Cursor<AuditTrailExportRow> streamAuditTrailForExport(AuditTrailExportQuery query);
```

XML:

```xml
<select id="streamAuditTrailForExport"
        resultMap="AuditTrailExportRowMap"
        fetchSize="500"
        resultOrdered="true">
  SELECT
    a.AUDIT_ID,
    a.MODULE_CODE,
    a.ACTIVITY_TYPE,
    a.CREATED_AT,
    a.CREATED_BY,
    a.DESCRIPTION
  FROM AUDIT_TRAIL a
  WHERE a.CREATED_AT &gt;= #{from}
    AND a.CREATED_AT &lt; #{toExclusive}
    AND a.AGENCY_ID = #{agencyId}
  ORDER BY a.AUDIT_ID ASC
</select>
```

Usage:

```java
@Transactional(readOnly = true)
public void exportAuditTrail(AuditTrailExportQuery query, Writer writer) {
    try (Cursor<AuditTrailExportRow> cursor = auditMapper.streamAuditTrailForExport(query)) {
        for (AuditTrailExportRow row : cursor) {
            writeCsvLine(writer, row);
        }
    } catch (IOException e) {
        throw new UncheckedIOException(e);
    }
}
```

### 14.1 Cursor Requires Resource Discipline

`Cursor<T>` bukan magic. Ia memegang resource:

```text
open database connection
  + statement
  + result set
  + transaction/session scope
```

Rule:

- pakai `try-with-resources`;
- jangan return cursor keluar dari transaction boundary yang sudah selesai;
- jangan jadikan cursor sebagai response object;
- jangan simpan cursor di field;
- jangan konsumsi cursor paralel sembarangan;
- pastikan query punya stable ordering;
- ukur fetch size sesuai driver/database.

### 14.2 Cursor Di Spring

Dengan MyBatis-Spring, mapper biasanya memakai `SqlSessionTemplate`. Dokumentasi MyBatis-Spring menjelaskan `SqlSessionTemplate` thread-safe dan bekerja dengan Spring transaction management, tetapi cursor tetap harus dikonsumsi dalam scope session/transaction yang valid.

Buruk:

```java
public Cursor<Row> getCursor(Query query) {
    return mapper.streamRows(query);
}
// Caller mengonsumsi cursor setelah transaction/session sudah tidak aktif.
```

Lebih baik:

```java
@Transactional(readOnly = true)
public void processRows(Query query, Consumer<Row> consumer) {
    try (Cursor<Row> cursor = mapper.streamRows(query)) {
        cursor.forEach(consumer);
    }
}
```

---

## 15. `ResultHandler`: Streaming Push-Style

Selain `Cursor`, MyBatis juga punya `ResultHandler` untuk memproses result satu per satu.

Contoh konseptual:

```java
void selectLargeAuditTrail(
    AuditTrailExportQuery query,
    ResultHandler<AuditTrailExportRow> handler
);
```

Namun pada mapper interface, penggunaan `ResultHandler` perlu lebih hati-hati dan sering lebih verbose dibanding `Cursor`.

### 15.1 Kapan `ResultHandler` Berguna?

- export besar;
- ETL internal;
- batch processing;
- tidak perlu return collection;
- ingin push setiap row ke writer/processor;
- ingin mengurangi memory.

### 15.2 Risiko `ResultHandler`

- flow control lebih sulit;
- error handling harus jelas;
- transaction/session tetap harus hidup;
- caller bisa menyembunyikan efek samping besar;
- testing lebih sulit dibanding `List<T>`.

Untuk kebanyakan use case modern, `Cursor<T>` lebih mudah dipahami.

---

## 16. Java `Stream<T>`: Menarik, Tapi Harus Sangat Hati-Hati

Java 8 memperkenalkan `Stream<T>`, sehingga banyak engineer ingin mapper mengembalikan:

```java
Stream<Row> streamRows(Query query);
```

Secara API, ini terlihat elegan. Tetapi resource lifecycle menjadi rawan.

Problem:

```java
Stream<Row> stream = mapper.streamRows(query);
return stream.map(...); // transaction/session mungkin sudah close saat stream dikonsumsi
```

Stream bersifat lazy. Kalau resource database sudah tertutup sebelum stream dikonsumsi, error akan muncul terlambat.

### 16.1 Prefer Cursor Untuk MyBatis

Untuk MyBatis, prefer:

```java
Cursor<Row> streamRows(Query query);
```

Lalu konsumsi dalam boundary eksplisit:

```java
try (Cursor<Row> cursor = mapper.streamRows(query)) {
    for (Row row : cursor) {
        ...
    }
}
```

Kalau tetap ingin `Stream<T>`, bungkus di service dengan close handler yang benar.

Contoh advanced:

```java
@Transactional(readOnly = true)
public void processRows(Query query, Consumer<Row> consumer) {
    try (Cursor<Row> cursor = mapper.streamRows(query)) {
        StreamSupport.stream(cursor.spliterator(), false)
            .forEach(consumer);
    }
}
```

Jangan expose stream database ke controller.

---

## 17. Pagination Return: Mapper Tidak Harus Mengembalikan `Page<T>`

Banyak framework punya `Page<T>`. Di MyBatis, mapper lebih baik tetap sederhana:

```java
List<CaseListingRow> searchCasePage(CaseSearchPageQuery query);
long countSearchCases(CaseSearchCriteria criteria);
```

Service membentuk page response:

```java
public PageResult<CaseListingDto> search(CaseSearchRequest request) {
    CaseSearchPageQuery query = CaseSearchPageQuery.from(request);

    List<CaseListingRow> rows = caseMapper.searchCasePage(query);
    long total = caseMapper.countSearchCases(query.criteriaOnly());

    return PageResult.of(
        rows.stream().map(this::toDto).toList(),
        query.page(),
        query.limit(),
        total
    );
}
```

### 17.1 Kenapa Mapper Tidak Perlu Return `Page<T>`?

Karena `Page<T>` adalah API/application concern, bukan database statement concern.

Mapper sebaiknya tahu:

```text
SQL untuk ambil page
SQL untuk count
```

Service tahu:

```text
response shape
page metadata
whether count is required
permission/business behavior
```

### 17.2 Untuk Java 8

Java 8 tidak punya `Stream.toList()`, jadi gunakan:

```java
List<CaseListingDto> dtos = rows.stream()
    .map(this::toDto)
    .collect(Collectors.toList());
```

Untuk Java 16+ bisa:

```java
List<CaseListingDto> dtos = rows.stream()
    .map(this::toDto)
    .toList();
```

---

## 18. Keyset Pagination Method Contract

Offset pagination:

```java
List<CaseListingRow> searchCasePage(CaseSearchOffsetPageQuery query);
```

Keyset pagination:

```java
List<CaseListingRow> searchCaseNextSlice(CaseSearchKeysetQuery query);
```

Keyset query harus punya cursor fields:

```java
public record CaseSearchKeysetQuery(
    long agencyId,
    String status,
    Instant lastUpdatedAt,
    Long lastCaseId,
    int limit
) {}
```

SQL:

```xml
<select id="searchCaseNextSlice" resultMap="CaseListingRowMap">
  SELECT
    c.CASE_ID,
    c.CASE_NO,
    c.STATUS,
    c.UPDATED_AT
  FROM CASES c
  WHERE c.AGENCY_ID = #{agencyId}
    AND c.DELETED_FLAG = 'N'
    <if test="status != null">
      AND c.STATUS = #{status}
    </if>
    <if test="lastUpdatedAt != null and lastCaseId != null">
      AND (
        c.UPDATED_AT &lt; #{lastUpdatedAt}
        OR (c.UPDATED_AT = #{lastUpdatedAt} AND c.CASE_ID &lt; #{lastCaseId})
      )
    </if>
  ORDER BY c.UPDATED_AT DESC, c.CASE_ID DESC
  FETCH NEXT #{limit} ROWS ONLY
</select>
```

Method name harus membedakan offset vs keyset karena semantik caller berbeda.

---

## 19. Locking Method Contract

Query yang mengambil lock harus terlihat dari nama method.

Buruk:

```java
Optional<CaseRow> findById(CaseKey key);
```

Padahal SQL:

```sql
SELECT ... FOR UPDATE
```

Lebih baik:

```java
Optional<CaseRow> lockByIdForUpdate(CaseKey key);

Optional<CaseRow> lockPendingCaseNowait(CaseKey key);

List<CaseQueueRow> lockNextPendingCasesSkipLocked(CaseQueueLockQuery query);
```

Kenapa penting?

- caller harus tahu method ini memblokir;
- butuh transaction aktif;
- bisa deadlock/timeout;
- tidak boleh dipakai sembarangan di read-only API;
- observability harus jelas.

### 19.1 Locking Return Type

Untuk single row lock:

```java
Optional<CaseRow> lockByIdForUpdate(CaseKey key);
```

Untuk queue claim:

```java
List<CaseQueueRow> lockNextPendingCasesSkipLocked(CaseQueueLockQuery query);
```

Untuk transition atomic, sering lebih baik update langsung:

```java
int claimCaseIfPending(ClaimCaseCommand command);
```

Daripada:

```text
select for update
then update
```

Kecuali business flow memang perlu membaca state detail sebelum update.

---

## 20. Method Parameter Design: Jangan Biarkan Parameter Meledak

Buruk:

```java
List<CaseListingRow> searchCases(
    Long agencyId,
    String status,
    String caseNo,
    Instant createdFrom,
    Instant createdTo,
    Long assignedOfficerId,
    Integer offset,
    Integer limit,
    String sortBy,
    String sortDirection
);
```

Masalah:

- mudah salah urutan;
- sulit ditambah field;
- sulit validate;
- sulit test;
- sulit reuse;
- `@Param` terlalu banyak;
- method signature tidak stabil.

Lebih baik:

```java
List<CaseListingRow> searchCases(CaseSearchPageQuery query);
```

Object:

```java
public class CaseSearchPageQuery {
    private final long agencyId;
    private final String status;
    private final String caseNo;
    private final Instant createdFromInclusive;
    private final Instant createdToExclusive;
    private final Long assignedOfficerId;
    private final int offset;
    private final int limit;
    private final CaseSort sort;

    // constructor + getters
}
```

### 20.1 Parameter Object Membawa Invariant

Parameter object bisa enforce:

```java
public CaseSearchPageQuery(...) {
    if (limit < 1 || limit > 200) {
        throw new IllegalArgumentException("limit must be between 1 and 200");
    }
    if (createdFromInclusive != null && createdToExclusive != null
            && !createdFromInclusive.isBefore(createdToExclusive)) {
        throw new IllegalArgumentException("createdFrom must be before createdTo");
    }
    this.limit = limit;
}
```

Mapper tidak perlu menerima input liar.

---

## 21. `@Param`: Gunakan Untuk Parameter Kecil, Jangan Untuk Query Besar

Cocok:

```java
Optional<UserRow> findByEmailAndStatus(
    @Param("email") String email,
    @Param("status") String status
);
```

Tidak cocok:

```java
List<CaseListingRow> searchCases(
    @Param("agencyId") Long agencyId,
    @Param("status") String status,
    @Param("caseNo") String caseNo,
    @Param("createdFrom") Instant createdFrom,
    @Param("createdTo") Instant createdTo,
    @Param("offset") int offset,
    @Param("limit") int limit,
    @Param("sortBy") String sortBy,
    @Param("sortDirection") String sortDirection
);
```

Rule praktis:

```text
1 parameter object untuk complex query/command
@Param untuk 2–3 scalar sederhana
```

---

## 22. Jangan Return `Map<String, Object>` Untuk Business Query

Buruk:

```java
List<Map<String, Object>> searchCases(CaseSearchCriteria criteria);
```

Masalah:

- tidak type-safe;
- column rename baru ketahuan runtime;
- typo key tidak terdeteksi;
- conversion numeric/date rawan;
- caller tersebar memakai string key;
- refactoring sulit;
- test kurang bermakna;
- security field leakage mudah terjadi.

Lebih baik:

```java
List<CaseListingRow> searchCases(CaseSearchCriteria criteria);
```

`Map<String,Object>` masih bisa dipakai untuk:

- generic admin SQL tool internal;
- metadata query;
- dynamic report builder yang memang schema-driven;
- debugging utility terbatas.

Untuk business mapper, hindari.

---

## 23. Jangan Return Entity Besar Kalau Caller Butuh Projection Kecil

Buruk:

```java
List<CaseEntity> searchCases(CaseSearchCriteria criteria);
```

Padahal UI listing hanya butuh:

- case id;
- case number;
- status;
- assigned officer name;
- updated date.

Lebih baik:

```java
List<CaseListingRow> searchCaseListingPage(CaseSearchPageQuery query);
```

Projection row:

```java
public record CaseListingRow(
    long caseId,
    String caseNo,
    String status,
    String assignedOfficerName,
    Instant updatedAt
) {}
```

Keuntungan:

- query lebih ringan;
- mapping lebih jelas;
- tidak expose internal field;
- menghindari accidental graph loading;
- API contract lebih dekat ke use case.

---

## 24. Method Naming Convention Yang Disarankan

Gunakan prefix berdasarkan semantik, bukan sekadar SQL verb.

### 24.1 Query Single

```java
Optional<T> findById(...);              // 0..1 normal
T getRequiredById(...);                 // exactly one, biasanya service wrapper
Optional<T> findVisibleById(...);       // scoped visibility
Optional<T> findActiveById(...);        // active only
Optional<T> lockByIdForUpdate(...);     // locking
```

### 24.2 Query Multi

```java
List<T> findByCaseId(...);              // child rows
List<T> searchPage(...);                // paginated search
List<T> listActiveByModule(...);        // bounded lookup
Cursor<T> streamForExport(...);         // large result streaming
```

### 24.3 Existence/Count

```java
boolean existsById(...);
boolean existsVisibleById(...);
long countSearchResults(...);
long countPendingItems(...);
```

### 24.4 Mutation

```java
int insert...(...);
int update...(...);
int delete...(...);
int softDelete...(...);
int mark...(...);
int claim...If...(...);
int transition...From...To...(...);
int update...IfVersionMatches(...);
int bulk...(...);
```

### 24.5 Avoid

```java
getData(...)
process(...)
doUpdate(...)
query(...)
selectSomething(...)
save(...)
handle(...)
execute(...)
```

Nama seperti ini terlalu kabur.

---

## 25. `save` Adalah Kata Berbahaya Di Mapper

Di ORM, `save` sering berarti insert/update tergantung entity state. Di MyBatis, SQL explicit. Maka `save` biasanya ambiguous.

Buruk:

```java
void saveUser(User user);
```

Apakah:

- insert?
- update?
- upsert?
- merge?
- update full?
- update selective?
- ignore duplicate?
- return generated key?

Lebih baik:

```java
int insertUser(CreateUserCommand command);

int updateUserProfile(UpdateUserProfileCommand command);

int updateUserProfileIfVersionMatches(UpdateUserProfileCommand command);

int upsertUserExternalIdentity(UpsertExternalIdentityCommand command);
```

MyBatis mapper harus eksplisit.

---

## 26. Upsert Method Contract

Upsert punya semantik kompleks.

Buruk:

```java
void saveExternalEvent(ExternalEvent event);
```

Lebih baik:

```java
int insertExternalEventIgnoreDuplicate(ExternalEventInsertCommand command);

int upsertExternalEventProcessingState(ExternalEventUpsertCommand command);
```

Bedakan:

```text
insert-or-ignore
insert-or-update
merge with last-write-wins
merge only if newer
merge only if status allows
```

Return type `int` bisa ambigu untuk upsert vendor-specific. Dokumentasikan:

```java
/**
 * @return vendor-specific affected row count.
 *         Caller must not infer inserted-vs-updated from this value.
 */
int upsertExternalIdentity(UpsertExternalIdentityCommand command);
```

Kalau caller perlu tahu inserted vs updated, gunakan cara eksplisit:

- pre-check dengan unique key;
- database returning clause kalau tersedia;
- separate insert and update flow;
- audit table;
- procedure/function yang return status.

---

## 27. Insert Generated Key Contract

Contoh:

```java
int insertCase(CreateCaseCommand command);
```

Kalau memakai generated key yang diisi balik ke object:

```xml
<insert id="insertCase"
        useGeneratedKeys="true"
        keyProperty="caseId">
  INSERT INTO CASES (
    CASE_NO,
    STATUS,
    AGENCY_ID,
    CREATED_BY,
    CREATED_AT
  ) VALUES (
    #{caseNo},
    #{status},
    #{agencyId},
    #{createdBy},
    #{createdAt}
  )
</insert>
```

Command mutable:

```java
public class CreateCaseCommand {
    private Long caseId;
    private String caseNo;
    private String status;
    private long agencyId;
    private String createdBy;
    private Instant createdAt;

    // getters/setters
}
```

Service:

```java
int inserted = caseMapper.insertCase(command);
if (inserted != 1) {
    throw new IllegalStateException("Expected one case inserted, got " + inserted);
}
Long caseId = command.getCaseId();
```

### 27.1 Mutable Command Trade-off

Generated key backfill butuh object mutable atau holder.

Alternatif:

```java
int insertCaseWithProvidedId(CreateCaseCommand command);
```

Dengan ID dibuat aplikasi:

- UUID;
- ULID;
- Snowflake-like id;
- sequence prefetch;
- database sequence via `selectKey`.

Untuk immutable style Java 16+ record, generated key backfill tidak natural. Pertimbangkan generate ID sebelum insert.

---

## 28. Java 8 Sampai 25: Return Type Strategy

### 28.1 Java 8 Baseline

Aman dipakai:

```java
Optional<T>
List<T>
Map<K,V>
int
long
Cursor<T>
```

DTO:

```java
public class CaseListingRow {
    private final long caseId;
    private final String caseNo;
    private final String status;

    public CaseListingRow(long caseId, String caseNo, String status) {
        this.caseId = caseId;
        this.caseNo = caseNo;
        this.status = status;
    }

    public long getCaseId() { return caseId; }
    public String getCaseNo() { return caseNo; }
    public String getStatus() { return status; }
}
```

### 28.2 Java 16+

Records cocok untuk immutable projection:

```java
public record CaseListingRow(
    long caseId,
    String caseNo,
    String status,
    Instant updatedAt
) {}
```

### 28.3 Java 21+

Virtual threads bisa membantu thread-per-request/blocking IO scalability, tetapi tidak mengubah contract mapper:

- connection tetap resource terbatas;
- transaction tetap harus bounded;
- cursor tetap harus ditutup;
- SQL tetap harus performant;
- rows affected tetap harus dicek;
- backpressure tetap diperlukan.

Jangan berpikir virtual thread membuat `List<1_000_000 rows>` menjadi aman.

### 28.4 Java 25

Untuk Java 25, prinsip sama:

- gunakan language feature modern untuk DTO/readability;
- jangan mengubah mapper menjadi abstraksi opaque;
- tetap explicit SQL and explicit resource boundary.

---

## 29. Exception Behavior: Jangan Biarkan Mapper Exception Menjadi Domain API Mentah

MyBatis/Spring bisa melempar exception untuk:

- SQL syntax error;
- duplicate key;
- constraint violation;
- too many results;
- invalid column;
- type conversion;
- timeout;
- deadlock;
- connection failure.

Mapper method signature tidak menampilkan semua exception ini.

Service harus menerjemahkan exception yang relevan menjadi domain/application exception.

Contoh:

```java
try {
    int inserted = userMapper.insertUser(command);
    if (inserted != 1) {
        throw new IllegalStateException("Expected one row inserted");
    }
} catch (DuplicateKeyException e) {
    throw new EmailAlreadyRegisteredException(command.email(), e);
}
```

Jangan expose database exception mentah sampai controller/API boundary.

---

## 30. Mapper Method Untuk State Machine

Sistem regulatory/case management sering punya state transition.

Buruk:

```java
int updateStatus(long caseId, String status);
```

Ini memungkinkan transition illegal.

Lebih baik:

```java
int transitionCaseFromDraftToSubmitted(SubmitCaseCommand command);

int transitionCaseFromSubmittedToAssigned(AssignCaseCommand command);

int transitionCaseFromAssignedToClosed(CloseCaseCommand command);
```

XML:

```xml
<update id="transitionCaseFromSubmittedToAssigned">
  UPDATE CASES
  SET
    STATUS = 'ASSIGNED',
    ASSIGNED_OFFICER_ID = #{officerId},
    UPDATED_BY = #{actorUserId},
    UPDATED_AT = #{now},
    VERSION = VERSION + 1
  WHERE CASE_ID = #{caseId}
    AND AGENCY_ID = #{agencyId}
    AND STATUS = 'SUBMITTED'
    AND VERSION = #{expectedVersion}
    AND DELETED_FLAG = 'N'
</update>
```

Return `0` berarti salah satu invariant gagal:

- not found;
- wrong agency;
- wrong status;
- stale version;
- deleted;
- already processed.

Service bisa probe untuk alasan detail bila perlu.

---

## 31. Mapper Method Untuk Idempotency

External event, callback, payment notification, atau integration message butuh idempotency.

Contoh:

```java
int insertProcessedEventIfAbsent(ProcessedEventInsertCommand command);
```

SQL bisa memakai unique key `(source_system, event_id)`.

Service:

```java
int inserted = eventMapper.insertProcessedEventIfAbsent(command);
if (inserted == 1) {
    return EventAcceptResult.firstTimeAccepted();
}
if (inserted == 0) {
    return EventAcceptResult.duplicateIgnored();
}
throw new IllegalStateException("Unexpected insert count: " + inserted);
```

Method name harus menyatakan idempotency:

```text
insert...IfAbsent
insert...IgnoreDuplicate
mark...IfNotProcessed
claim...IfPending
```

---

## 32. Mapper Method Untuk Audit

Audit mapper harus eksplisit karena audit data sering besar dan compliance-sensitive.

Contoh:

```java
int insertAuditTrail(AuditTrailInsertCommand command);

List<AuditTrailListingRow> searchAuditTrailPage(AuditTrailSearchPageQuery query);

Cursor<AuditTrailExportRow> streamAuditTrailForExport(AuditTrailExportQuery query);

long countAuditTrailForSearch(AuditTrailSearchCriteria criteria);
```

Jangan punya method:

```java
List<AuditTrailRow> findAllAuditTrail();
```

Untuk audit trail, default harus:

- paginated;
- scoped;
- date-bounded;
- projection-specific;
- export via cursor;
- no accidental CLOB loading for listing.

---

## 33. Mapper Method Untuk Authorization/Visibility Scope

Buruk:

```java
Optional<DocumentRow> findDocumentById(long documentId);
```

Lebih baik:

```java
Optional<DocumentRow> findVisibleDocumentById(DocumentVisibilityKey key);
```

Key:

```java
public record DocumentVisibilityKey(
    long documentId,
    long agencyId,
    String actorUserId
) {}
```

SQL:

```xml
<select id="findVisibleDocumentById" resultMap="DocumentRowMap">
  SELECT
    d.DOCUMENT_ID,
    d.CASE_ID,
    d.FILE_NAME,
    d.CONTENT_TYPE,
    d.CREATED_AT
  FROM DOCUMENT d
  JOIN CASES c ON c.CASE_ID = d.CASE_ID
  WHERE d.DOCUMENT_ID = #{documentId}
    AND c.AGENCY_ID = #{agencyId}
    AND d.DELETED_FLAG = 'N'
    AND c.DELETED_FLAG = 'N'
</select>
```

Method name `findVisible...` memberi sinyal bahwa SQL mengandung access scope.

---

## 34. Anti-Pattern: Generic Base Mapper Untuk Semua Tabel

Contoh:

```java
public interface BaseMapper<T, ID> {
    T findById(ID id);
    List<T> findAll();
    void save(T entity);
    void delete(ID id);
}
```

Ini terlihat DRY, tapi sering merusak MyBatis design.

Masalah:

- mengaburkan SQL spesifik;
- mendorong `findAll` berbahaya;
- menyembunyikan tenant/soft-delete rules;
- tidak cocok untuk state transition;
- tidak cocok untuk projection-first query;
- membuat mapper seperti ORM palsu;
- sulit review security;
- sulit optimize query.

Untuk MyBatis, prefer use-case specific mapper method.

Boleh punya helper kecil untuk common fragment/config, tapi jangan memaksa semua persistence menjadi generic CRUD.

---

## 35. Anti-Pattern: Mapper Method Terlalu Mirip Stored Procedure Tanpa Contract

Buruk:

```java
void processCase(Map<String, Object> params);
```

Masalah:

- parameter tidak jelas;
- return tidak jelas;
- error tidak jelas;
- caller harus tahu magic key;
- testing sulit;
- refactoring berbahaya.

Lebih baik:

```java
int transitionCaseFromAssignedToClosed(CloseCaseCommand command);

int insertCaseClosureAudit(CaseClosureAuditCommand command);

Optional<CaseClosureProbeRow> findClosureReadiness(CaseKey key);
```

Kalau memang memanggil stored procedure:

```java
CloseCaseProcedureResult closeCaseUsingProcedure(CloseCaseProcedureCommand command);
```

Buat command/result explicit.

---

## 36. Mapper API Untuk Read/Write Split

Read-heavy system sering memisahkan:

```java
CaseQueryMapper
CaseCommandMapper
```

Contoh:

```java
@Mapper
public interface CaseQueryMapper {
    Optional<CaseDetailRow> findVisibleDetailById(CaseKey key);
    List<CaseListingRow> searchCasePage(CaseSearchPageQuery query);
    long countSearchCases(CaseSearchCriteria criteria);
    Cursor<CaseExportRow> streamCasesForExport(CaseExportQuery query);
}
```

```java
@Mapper
public interface CaseCommandMapper {
    int insertCase(CreateCaseCommand command);
    int transitionCaseFromDraftToSubmitted(SubmitCaseCommand command);
    int assignCaseIfSubmitted(AssignCaseCommand command);
    int softDeleteCaseIfDraft(DeleteDraftCaseCommand command);
}
```

Keuntungan:

- read API tidak tercampur mutation;
- review security lebih mudah;
- transaction expectation lebih jelas;
- mapper file lebih kecil;
- ownership lebih jelas.

---

## 37. Mapper API Dan Transaction Boundary

Mapper method tidak boleh menyiratkan transaction lifecycle secara tersembunyi.

Buruk:

```java
void approveCaseAndInsertAuditAndSendNotification(...);
```

Mapper tidak boleh mengirim notification. Itu service/application concern.

Lebih baik:

```java
int approveCaseIfReviewCompleted(ApproveCaseCommand command);
int insertCaseApprovalAudit(CaseApprovalAuditCommand command);
```

Service:

```java
@Transactional
public void approveCase(ApproveCaseRequest request) {
    int updated = caseCommandMapper.approveCaseIfReviewCompleted(command);
    if (updated != 1) {
        throw new CaseApprovalConflictException(...);
    }

    auditMapper.insertCaseApprovalAudit(auditCommand);
    outboxMapper.insertNotificationOutbox(outboxCommand);
}
```

Mapper menjalankan SQL; service mengatur unit of work.

---

## 38. Mapper API Dan Cache Semantics

Kalau statement memakai second-level cache atau local cache-sensitive behavior, method name/dokumentasi harus hati-hati.

Contoh query volatile:

```java
Instant selectDatabaseCurrentTimestamp();
```

Jika cache aktif, ini bahaya. Di XML bisa set:

```xml
<select id="selectDatabaseCurrentTimestamp"
        resultType="java.time.Instant"
        useCache="false"
        flushCache="true">
  SELECT CURRENT_TIMESTAMP
</select>
```

Nama method harus menjelaskan volatile nature.

Untuk query lookup yang cacheable:

```java
List<LookupRow> listActiveStatusLookupByModule(String moduleCode);
```

Cache behavior akan dibahas lebih dalam di Part 17, tapi API method harus sudah menghindari ambiguity.

---

## 39. Mapper API Review Checklist

Untuk setiap mapper method, tanyakan:

### 39.1 Naming

- Apakah nama method menjelaskan use case?
- Apakah nama method menjelaskan visibility scope?
- Apakah nama method menjelaskan lock behavior?
- Apakah nama method menjelaskan idempotency?
- Apakah nama method menjelaskan state transition?

### 39.2 Parameter

- Apakah parameter object dipakai untuk query kompleks?
- Apakah input sudah bounded?
- Apakah `limit` punya max?
- Apakah date range memakai exclusive upper bound?
- Apakah tenant/agency scope wajib?
- Apakah dynamic sort memakai whitelist?

### 39.3 Return Type

- Apakah cardinality jelas?
- Apakah `Optional` dipakai untuk `0..1`?
- Apakah `List` bounded/paginated?
- Apakah large result memakai `Cursor`/handler?
- Apakah DML return `int` rows affected?
- Apakah count/existence query tidak mengambil row besar?

### 39.4 Failure Behavior

- Apa arti no row?
- Apa arti duplicate row?
- Apa arti `0 rows affected`?
- Apa arti `>1 rows affected`?
- Apa exception yang mungkin diterjemahkan service?

### 39.5 Performance

- Apakah query mengambil kolom minimal?
- Apakah projection sesuai use case?
- Apakah pagination stabil?
- Apakah sort indexed?
- Apakah query bisa menghasilkan result besar?

### 39.6 Security

- Apakah scope tenant/agency/user diterapkan?
- Apakah soft delete filter diterapkan?
- Apakah sensitive column tidak ikut projection?
- Apakah dynamic SQL aman?
- Apakah method generic tidak membypass access rule?

---

## 40. Mini Case Study: Case Management Mapper API

### 40.1 Buruk

```java
@Mapper
public interface CaseMapper {
    Case getCase(Long id);
    List<Case> search(Map<String, Object> params);
    void save(Case caze);
    void updateStatus(Long id, String status);
    List<AuditTrail> getAudit(Long caseId);
    List<Document> getDocuments(Long caseId);
}
```

Masalah:

- `getCase` nullable tidak jelas;
- `search` pakai map;
- `save` ambigu;
- `updateStatus` melanggar state machine;
- audit tidak paginated;
- document tidak scoped visibility;
- return entity besar;
- tidak ada rows affected;
- tidak ada version check;
- tidak ada tenant/agency scope.

### 40.2 Lebih Baik

```java
@Mapper
public interface CaseQueryMapper {
    Optional<CaseDetailRow> findVisibleDetailById(CaseVisibilityKey key);

    Optional<CaseSummaryRow> findVisibleSummaryById(CaseVisibilityKey key);

    List<CaseListingRow> searchVisibleCasePage(CaseSearchPageQuery query);

    long countVisibleCasesForSearch(CaseSearchCriteria criteria);

    Cursor<CaseExportRow> streamVisibleCasesForExport(CaseExportQuery query);
}
```

```java
@Mapper
public interface CaseCommandMapper {
    int insertDraftCase(CreateDraftCaseCommand command);

    int transitionCaseFromDraftToSubmitted(SubmitCaseCommand command);

    int assignSubmittedCaseIfVersionMatches(AssignCaseCommand command);

    int closeAssignedCaseIfVersionMatches(CloseCaseCommand command);

    int softDeleteDraftCase(DeleteDraftCaseCommand command);
}
```

```java
@Mapper
public interface CaseAuditMapper {
    int insertCaseAuditTrail(CaseAuditInsertCommand command);

    List<CaseAuditListingRow> searchCaseAuditPage(CaseAuditSearchPageQuery query);

    Cursor<CaseAuditExportRow> streamCaseAuditForExport(CaseAuditExportQuery query);
}
```

```java
@Mapper
public interface CaseDocumentMapper {
    Optional<DocumentMetadataRow> findVisibleDocumentMetadataById(DocumentVisibilityKey key);

    List<DocumentListingRow> listVisibleDocumentsByCaseId(CaseVisibilityKey key);

    int insertCaseDocument(DocumentInsertCommand command);

    int softDeleteCaseDocumentIfOwner(DocumentDeleteCommand command);
}
```

API sekarang membawa semantic shape.

---

## 41. Testing Mapper Method Contract

Test tidak hanya memastikan SQL jalan. Test harus memastikan contract.

### 41.1 Single Row Test

```java
@Test
void findVisibleSummaryById_returnsEmpty_whenCaseDoesNotExist() {
    Optional<CaseSummaryRow> result = mapper.findVisibleSummaryById(keyOfMissingCase());
    assertThat(result).isEmpty();
}
```

```java
@Test
void findVisibleSummaryById_returnsEmpty_whenCaseBelongsToOtherAgency() {
    Optional<CaseSummaryRow> result = mapper.findVisibleSummaryById(keyWithWrongAgency());
    assertThat(result).isEmpty();
}
```

### 41.2 DML Rows Affected Test

```java
@Test
void assignSubmittedCaseIfVersionMatches_returnsOne_whenVersionMatches() {
    int updated = mapper.assignSubmittedCaseIfVersionMatches(validCommand());
    assertThat(updated).isEqualTo(1);
}
```

```java
@Test
void assignSubmittedCaseIfVersionMatches_returnsZero_whenVersionStale() {
    int updated = mapper.assignSubmittedCaseIfVersionMatches(staleVersionCommand());
    assertThat(updated).isZero();
}
```

### 41.3 Pagination Bound Test

```java
@Test
void searchVisibleCasePage_neverReturnsMoreThanLimit() {
    CaseSearchPageQuery query = queryWithLimit(50);
    List<CaseListingRow> rows = mapper.searchVisibleCasePage(query);
    assertThat(rows).hasSizeLessThanOrEqualTo(50);
}
```

### 41.4 Cursor Resource Test

```java
@Test
void streamAuditTrailForExport_canBeConsumedAndClosed() throws Exception {
    try (Cursor<AuditTrailExportRow> cursor = mapper.streamAuditTrailForExport(query())) {
        int count = 0;
        for (AuditTrailExportRow ignored : cursor) {
            count++;
        }
        assertThat(count).isGreaterThanOrEqualTo(0);
    }
}
```

---

## 42. Failure Model: Mapper API Mistakes

| Mistake | Symptom | Root Cause | Fix |
|---|---|---|---|
| `getById` returns nullable | NPE in service | absence not explicit | use `Optional` or service wrapper |
| `List<T>` for huge export | OOM/GC spike | full materialization | use `Cursor`/streaming |
| DML returns `void` | silent failed update | rows affected ignored | return `int` |
| `save` method | wrong insert/update semantics | ambiguous command | split insert/update/upsert |
| generic `findAll` | production slow query | unbounded result | remove or restrict |
| `Map<String,Object>` | runtime typo/data conversion bugs | no typed contract | use DTO/record |
| `existsById` without tenant | data leakage | wrong visibility semantics | `existsVisibleById` |
| lock hidden in `findById` | unexpected blocking/deadlock | method name hides lock | `lock...ForUpdate` |
| `search` with many scalars | parameter mix-up | unstable signature | criteria object |
| `count` mismatch with search | wrong UI total | filter drift | shared criteria/test pairs |

---

## 43. Practical Design Rules

1. Mapper method name must encode business-relevant database behavior.
2. Use `Optional<T>` for `0..1` where absence is normal.
3. Use required getter at service layer, not by pretending mapper cannot return null.
4. Use `List<T>` only for bounded/paginated result.
5. Use `Cursor<T>` or `ResultHandler` for large result.
6. Use `int` rows affected for mutation.
7. Never ignore rows affected for single-row business mutation.
8. Avoid `void` DML.
9. Avoid generic `save`.
10. Avoid generic `findAll` in production business mapper.
11. Avoid `Map<String,Object>` for business result.
12. Use parameter object for complex query/command.
13. Use `@Param` only for small scalar cases.
14. Separate query mapper and command mapper when module grows.
15. Make visibility/tenant/soft-delete scope explicit in method name.
16. Make locking explicit in method name.
17. Make idempotency explicit in method name.
18. Keep mapper SQL-focused; put domain decision in service.

---

## 44. Summary Mental Model

Mapper method API design is not cosmetic.

It defines:

```text
what the caller may assume
what the database must guarantee
what absence means
what duplicate means
what mutation success means
what resource behavior is expected
what security scope is applied
what failure must be handled
```

A production-grade MyBatis mapper should read like a set of executable contracts:

```java
Optional<CaseDetailRow> findVisibleDetailById(CaseVisibilityKey key);

List<CaseListingRow> searchVisibleCasePage(CaseSearchPageQuery query);

long countVisibleCasesForSearch(CaseSearchCriteria criteria);

Cursor<CaseExportRow> streamVisibleCasesForExport(CaseExportQuery query);

int transitionCaseFromDraftToSubmitted(SubmitCaseCommand command);

int assignSubmittedCaseIfVersionMatches(AssignCaseCommand command);

int insertExternalEventIfAbsent(ExternalEventInsertCommand command);
```

These signatures tell a story:

- which operation is read vs write;
- whether absence is normal;
- whether result is paged or streamed;
- whether security scope is enforced;
- whether state transition is guarded;
- whether concurrency is handled;
- whether idempotency exists.

That is the difference between “mapper that works” and “mapper that can survive years of production evolution”.

---

## 45. What Comes Next

Part 10 closes the mapper API design layer.

Next part:

```text
11-transaction-integration-spring-sqlsession-propagation-rollback.md
```

Part 11 will go deeper into:

- MyBatis without Spring;
- MyBatis with Spring;
- `SqlSessionTemplate`;
- transaction-bound session;
- `@Transactional`;
- propagation;
- isolation;
- rollback rules;
- exception translation;
- mixing MyBatis and JPA;
- transaction failure patterns.

---

## References

- MyBatis 3 Java API documentation: `SqlSession`, mapper annotations, `@MapKey`, select APIs, cursor APIs.
- MyBatis 3 Mapper XML documentation: `select`, `insert`, `update`, `delete`, result mapping, statement attributes such as `useCache`, `flushCache`, `fetchSize`, `resultOrdered`.
- MyBatis Cursor API documentation: lazy fetching and large result handling.
- MyBatis-Spring documentation: `SqlSessionTemplate`, transaction-aware session handling, thread-safety, mapper integration.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./09-mybatis-dynamic-sql-library-type-safe-query-generation.md">⬅️ MyBatis Dynamic SQL Library: Type-Safe Query Generation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./11-transaction-integration-spring-sqlsession-propagation-rollback.md">Part 11 — Transaction Integration: Spring, SqlSession, Propagation, Rollback ➡️</a>
</div>
