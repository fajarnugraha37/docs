# Part 15 — Pagination, Sorting, Search Query, and Count Strategy

File: `15-pagination-sorting-search-query-and-count-strategy.md`

Series: `learn-java-mybatis-sql-mapper-persistence-engineering`

---

## 0. Tujuan Bagian Ini

Di banyak aplikasi enterprise, pagination terlihat seperti fitur kecil:

> "Ambil page 1, size 20, sort by created date."

Namun di sistem besar, pagination adalah salah satu area yang paling sering menghasilkan bug produksi:

- halaman lambat saat data bertambah;
- row muncul dobel di dua page;
- row hilang saat user pindah page;
- sorting bisa dipakai untuk SQL injection;
- `count(*)` jauh lebih mahal daripada query datanya;
- query listing menjadi monster dynamic SQL;
- filter yang terlihat sederhana membuat index tidak terpakai;
- pagination joined table menghasilkan duplicate row;
- laporan/export memakai endpoint listing biasa lalu membuat memory spike;
- API contract tidak jelas antara page number, cursor, dan next token.

Bagian ini membangun mental model bahwa **pagination bukan sekadar `LIMIT/OFFSET` atau `OFFSET/FETCH`**. Pagination adalah kontrak antara:

```text
user intent
  -> filter semantics
  -> sort semantics
  -> database execution plan
  -> MyBatis mapper API
  -> API response contract
  -> consistency expectation under concurrent writes
```

Di MyBatis, pagination lebih eksplisit daripada ORM abstraction. Itu keuntungan besar, tetapi juga membuat engineer harus sadar terhadap SQL, index, vendor database, dan failure model.

---

## 1. Mental Model: Pagination Adalah Query Contract, Bukan UI Contract

Pagination biasanya dimulai dari UI:

```text
page = 3
size = 20
sort = createdAt,desc
filter = status:OPEN
```

Namun database tidak mengenal "page 3" sebagai konsep domain. Database mengenal:

```sql
SELECT ...
FROM ...
WHERE ...
ORDER BY ...
OFFSET ...
FETCH NEXT ...
```

atau:

```sql
SELECT ...
FROM ...
WHERE (created_at, id) < (:lastCreatedAt, :lastId)
ORDER BY created_at DESC, id DESC
FETCH NEXT :limit ROWS ONLY
```

Kontrak pagination minimal harus menjawab:

1. **Apa filter yang berlaku?**
2. **Urutan data apa yang stabil?**
3. **Berapa banyak data yang diminta?**
4. **Apakah user boleh loncat ke page tertentu?**
5. **Apakah data boleh berubah saat user berpindah page?**
6. **Apakah total count harus akurat?**
7. **Apakah query harus scalable untuk jutaan row?**
8. **Apakah sorting dinamis aman dari injection?**
9. **Apakah query bergantung pada vendor database?**
10. **Apakah result mapping mengembalikan root row unik atau joined row duplikatif?**

Pagination yang baik bukan yang "jalan di DEV", tetapi yang tetap benar saat:

- tabel sudah puluhan juta row;
- user filter dengan kombinasi aneh;
- ada concurrent insert/update/delete;
- sorting diubah;
- query join ke banyak tabel;
- count menjadi bottleneck;
- database berbeda antara environment;
- request disalahgunakan dengan `size=100000`.

---

## 2. Empat Bentuk Pagination Utama

Secara praktis, ada empat model pagination yang sering dipakai di aplikasi MyBatis.

### 2.1 Offset Pagination

Model paling umum:

```sql
SELECT
    case_id,
    case_no,
    status,
    created_at
FROM cases
WHERE status = #{status}
ORDER BY created_at DESC, case_id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

Atau di PostgreSQL/MySQL:

```sql
LIMIT #{limit} OFFSET #{offset}
```

API:

```http
GET /cases?page=5&size=20
```

Kelebihan:

- mudah dipahami;
- bisa loncat ke page tertentu;
- cocok untuk UI table biasa;
- mudah dikombinasikan dengan total count;
- cocok untuk dataset kecil sampai menengah.

Kekurangan:

- makin dalam page, makin mahal;
- database tetap harus melewati row yang di-skip;
- tidak stabil jika data berubah;
- page dalam seperti page 10000 biasanya buruk;
- offset besar bisa membuat query lambat walau ada index.

Mental model:

```text
offset pagination = "skip N rows, then take M rows"
```

Masalahnya, "skip N rows" bukan gratis.

Oracle Ask TOM menjelaskan prinsip penting: ketika memakai `OFFSET`, database membaca row offset ditambah row yang diminta; sedangkan seek/keyset method menggunakan nilai key terakhir dari page sebelumnya untuk melanjutkan. Ini adalah alasan fundamental mengapa offset memburuk saat page makin dalam. 

### 2.2 Keyset / Seek Pagination

Model ini tidak memakai page number. Ia memakai posisi terakhir.

```sql
SELECT
    case_id,
    case_no,
    status,
    created_at
FROM cases
WHERE status = #{status}
  AND (
        created_at < #{lastCreatedAt}
        OR (created_at = #{lastCreatedAt} AND case_id < #{lastCaseId})
      )
ORDER BY created_at DESC, case_id DESC
FETCH NEXT #{limit} ROWS ONLY
```

API:

```http
GET /cases?size=20&after=eyJsYXN0Q3JlYXRlZEF0Ijoi..."}
```

Kelebihan:

- scalable untuk data besar;
- tidak perlu skip jutaan row;
- lebih stabil terhadap concurrent insert;
- sangat cocok untuk infinite scroll, feed, export incremental, background processing.

Kekurangan:

- tidak mudah loncat ke page tertentu;
- butuh stable ordering;
- cursor/token harus dirancang;
- filter dan sort harus tetap sama antar request;
- lebih sulit untuk UI yang butuh "page 37".

Mental model:

```text
keyset pagination = "ambil row setelah posisi terakhir yang sudah dilihat"
```

Ini biasanya pilihan lebih baik untuk:

- audit trail;
- notification feed;
- case queue;
- job queue;
- export besar;
- event log;
- activity history;
- API list dengan data sangat besar.

### 2.3 Cursor Pagination

Cursor pagination mirip keyset, tetapi API tidak mengekspos nilai key langsung. Server memberi token.

Response:

```json
{
  "items": [...],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTE3VDA4OjAwOjAwWiIsImlkIjoxMjM0NX0="
}
```

Request berikutnya:

```http
GET /cases?size=20&cursor=eyJjcmVhdGVkQXQiOiIyMDI2...
```

Cursor bisa berisi:

```json
{
  "sort": "createdAt,desc",
  "lastCreatedAt": "2026-06-17T08:00:00Z",
  "lastCaseId": 12345,
  "filterHash": "..."
}
```

Kelebihan:

- internal ordering tidak bocor;
- filter consistency bisa divalidasi;
- bisa menambahkan signature/HMAC;
- cocok untuk public API.

Kekurangan:

- debugging lebih sulit;
- token harus versioned;
- cursor invalidation harus jelas;
- tidak cocok untuk random page access.

### 2.4 Window / Analytical Pagination

Kadang dipakai untuk report:

```sql
SELECT *
FROM (
    SELECT
        c.case_id,
        c.case_no,
        c.status,
        c.created_at,
        ROW_NUMBER() OVER (
            ORDER BY c.created_at DESC, c.case_id DESC
        ) AS rn
    FROM cases c
    WHERE c.status = #{status}
) x
WHERE x.rn BETWEEN #{startRow} AND #{endRow}
ORDER BY x.rn
```

Kelebihan:

- fleksibel;
- bisa dipakai di database lama;
- berguna untuk report tertentu.

Kekurangan:

- sering tetap harus menghitung banyak row;
- bisa mahal;
- tidak otomatis lebih cepat daripada offset;
- butuh execution plan review.

---

## 3. Rule Paling Penting: Pagination Wajib Punya Stable Ordering

Pagination tanpa `ORDER BY` adalah bug.

Contoh buruk:

```xml
<select id="findCases" resultMap="CaseRowMap">
  SELECT case_id, case_no, status, created_at
  FROM cases
  WHERE status = #{status}
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

Masalah:

- database bebas mengembalikan urutan apa pun;
- urutan bisa berubah setelah index berubah;
- urutan bisa berubah setelah statistik database berubah;
- row bisa muncul/hilang antar page.

Pagination harus selalu punya ordering eksplisit:

```sql
ORDER BY created_at DESC, case_id DESC
```

Kenapa harus dua kolom?

Karena `created_at` sering tidak unik. Jika banyak row punya timestamp sama, urutan antar row dengan timestamp sama tidak stabil.

Buruk:

```sql
ORDER BY created_at DESC
```

Lebih aman:

```sql
ORDER BY created_at DESC, case_id DESC
```

Prinsip:

```text
stable pagination requires deterministic ordering
```

Deterministic ordering biasanya membutuhkan:

1. sort column utama;
2. tie-breaker unik;
3. arah sorting konsisten;
4. index yang mendukung.

Contoh umum:

```text
created_at DESC, id DESC
updated_at DESC, id DESC
case_no ASC, id ASC
priority DESC, created_at ASC, id ASC
```

---

## 4. Offset Pagination di MyBatis XML

### 4.1 Parameter Object

Jangan kirim `page`, `size`, `sort`, `status`, `keyword` sebagai banyak scalar tanpa struktur.

Lebih baik:

```java
public final class CaseSearchCriteria {
    private final String status;
    private final String keyword;
    private final String assignedOfficerId;
    private final LocalDate submittedFrom;
    private final LocalDate submittedTo;
    private final CaseSort sort;
    private final int limit;
    private final int offset;

    // constructor/getter
}
```

Java 16+ bisa memakai record:

```java
public record CaseSearchCriteria(
    String status,
    String keyword,
    String assignedOfficerId,
    LocalDate submittedFrom,
    LocalDate submittedTo,
    CaseSort sort,
    int limit,
    int offset
) {}
```

Namun untuk Java 8 compatibility, POJO immutable lebih universal.

### 4.2 Mapper Interface

```java
public interface CaseSearchMapper {
    List<CaseListRow> searchCases(CaseSearchCriteria criteria);

    long countCases(CaseSearchCriteria criteria);
}
```

Pisahkan query data dan query count. Jangan menganggap count selalu wajib.

### 4.3 XML Query

```xml
<select id="searchCases"
        parameterType="com.example.caseapp.persistence.CaseSearchCriteria"
        resultMap="CaseListRowMap">
  SELECT
      c.case_id,
      c.case_no,
      c.status,
      c.priority,
      c.created_at,
      c.assigned_officer_id
  FROM cases c
  <where>
    c.deleted = 0

    <if test="status != null">
      AND c.status = #{status}
    </if>

    <if test="assignedOfficerId != null">
      AND c.assigned_officer_id = #{assignedOfficerId}
    </if>

    <if test="submittedFrom != null">
      AND c.submitted_at &gt;= #{submittedFrom}
    </if>

    <if test="submittedTo != null">
      AND c.submitted_at &lt; #{submittedTo}
    </if>

    <if test="keyword != null and keyword != ''">
      AND (
        UPPER(c.case_no) LIKE UPPER(#{keywordLike})
        OR UPPER(c.applicant_name) LIKE UPPER(#{keywordLike})
      )
    </if>
  </where>

  ORDER BY
  <choose>
    <when test="sort == @com.example.caseapp.persistence.CaseSort@CREATED_DESC">
      c.created_at DESC, c.case_id DESC
    </when>
    <when test="sort == @com.example.caseapp.persistence.CaseSort@CREATED_ASC">
      c.created_at ASC, c.case_id ASC
    </when>
    <when test="sort == @com.example.caseapp.persistence.CaseSort@PRIORITY_DESC">
      c.priority DESC, c.created_at ASC, c.case_id ASC
    </when>
    <otherwise>
      c.created_at DESC, c.case_id DESC
    </otherwise>
  </choose>

  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

Catatan penting:

- gunakan whitelist sorting;
- jangan pakai `${sortColumn}`;
- jangan pakai `${sortDirection}`;
- selalu tambahkan tie-breaker unik;
- validasi `limit` di service/API layer;
- jangan menerima `offset` negatif;
- jangan menerima `limit` besar tanpa batas.

---

## 5. Safe Dynamic Sorting

### 5.1 Anti-Pattern: Raw Sort Injection

Buruk:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Input user:

```text
sortColumn = created_at desc; delete from users; --
```

Walau driver/database mungkin membatasi multiple statement, pattern ini tetap membuka SQL injection boundary.

### 5.2 Safe Enum Sort

Gunakan enum:

```java
public enum CaseSort {
    CREATED_DESC,
    CREATED_ASC,
    PRIORITY_DESC,
    CASE_NO_ASC
}
```

Mapper:

```xml
ORDER BY
<choose>
  <when test="sort == @com.example.CaseSort@CREATED_DESC">
    c.created_at DESC, c.case_id DESC
  </when>
  <when test="sort == @com.example.CaseSort@CREATED_ASC">
    c.created_at ASC, c.case_id ASC
  </when>
  <when test="sort == @com.example.CaseSort@CASE_NO_ASC">
    c.case_no ASC, c.case_id ASC
  </when>
  <otherwise>
    c.created_at DESC, c.case_id DESC
  </otherwise>
</choose>
```

Keuntungan:

- tidak ada raw SQL dari user;
- sort option bisa direview;
- tie-breaker bisa dipastikan;
- index bisa dirancang per sort option;
- API documentation jelas.

### 5.3 Sort Mapping di Java

Alternatif: mapper menerima enum dan service menerjemahkan request string ke enum.

```java
public final class CaseSearchRequestParser {
    public CaseSort parseSort(String rawSort) {
        if (rawSort == null || rawSort.isBlank()) {
            return CaseSort.CREATED_DESC;
        }

        switch (rawSort) {
            case "createdAt,desc":
                return CaseSort.CREATED_DESC;
            case "createdAt,asc":
                return CaseSort.CREATED_ASC;
            case "priority,desc":
                return CaseSort.PRIORITY_DESC;
            case "caseNo,asc":
                return CaseSort.CASE_NO_ASC;
            default:
                throw new InvalidSortException(rawSort);
        }
    }
}
```

Rule:

```text
External sort string must never be SQL.
External sort string is an API token.
Mapper sort is an enum.
SQL sort clause is hardcoded whitelist.
```

---

## 6. Count Strategy: `count(*)` Tidak Selalu Murah

Banyak engineer membuat listing seperti ini:

```java
List<Row> rows = mapper.search(criteria);
long total = mapper.count(criteria);
return Page.of(rows, total);
```

Ini terlihat normal, tetapi di production:

- query count bisa lebih mahal daripada data query;
- count harus scan banyak row;
- count dengan join bisa berat;
- count dengan distinct bisa sangat berat;
- count dengan filter keyword bisa lambat;
- count akurat tidak selalu dibutuhkan.

### 6.1 Kapan Count Akurat Dibutuhkan?

Count akurat biasanya dibutuhkan untuk:

- UI table yang menampilkan total pages;
- report summary;
- export estimate;
- back-office search dengan user expectation total result;
- audit/reconciliation.

Tidak selalu dibutuhkan untuk:

- infinite scroll;
- feed;
- notification;
- queue claim;
- background batch;
- mobile list;
- "load more" UI.

### 6.2 Page vs Slice

`Page`:

```json
{
  "items": [...],
  "page": 3,
  "size": 20,
  "totalElements": 1542,
  "totalPages": 78
}
```

`Slice`:

```json
{
  "items": [...],
  "hasNext": true,
  "nextCursor": "..."
}
```

`Page` butuh count. `Slice` tidak selalu butuh count.

Untuk slice offset:

```sql
FETCH NEXT #{limitPlusOne} ROWS ONLY
```

Jika request size 20, ambil 21 row. Jika ada row ke-21, berarti `hasNext=true`, lalu kembalikan 20 row.

### 6.3 Count Query Harus Disederhanakan

Query data:

```sql
SELECT
    c.case_id,
    c.case_no,
    c.status,
    o.display_name AS officer_name,
    d.department_name
FROM cases c
LEFT JOIN officers o ON o.officer_id = c.assigned_officer_id
LEFT JOIN departments d ON d.department_id = o.department_id
WHERE ...
ORDER BY c.created_at DESC, c.case_id DESC
OFFSET ...
FETCH ...
```

Count buruk:

```sql
SELECT COUNT(*)
FROM cases c
LEFT JOIN officers o ON o.officer_id = c.assigned_officer_id
LEFT JOIN departments d ON d.department_id = o.department_id
WHERE ...
```

Jika filter tidak memakai `officers` atau `departments`, join tidak perlu.

Count lebih baik:

```sql
SELECT COUNT(*)
FROM cases c
WHERE ...
```

Rule:

```text
count query should count the root entity, not reproduce presentation joins unless required.
```

### 6.4 Count dengan One-to-Many Join

Misalnya case punya banyak document.

Buruk:

```sql
SELECT COUNT(*)
FROM cases c
LEFT JOIN case_documents d ON d.case_id = c.case_id
WHERE ...
```

Jika satu case punya 5 document, count bertambah 5.

Butuh:

```sql
SELECT COUNT(DISTINCT c.case_id)
FROM cases c
LEFT JOIN case_documents d ON d.case_id = c.case_id
WHERE ...
```

Tapi `COUNT(DISTINCT)` bisa mahal.

Alternatif:

```sql
SELECT COUNT(*)
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_documents d
    WHERE d.case_id = c.case_id
      AND d.document_type = #{documentType}
)
```

Biasanya `EXISTS` lebih sesuai untuk filter existence.

---

## 7. Designing Search Criteria

Search endpoint enterprise biasanya kompleks:

```text
status
priority
assigned officer
submitted date range
module
agency
keyword
has overdue task
has unread correspondence
last action type
applicant identifier
```

Jika tidak didesain, XML mapper menjadi tidak terkontrol.

### 7.1 Criteria Object

```java
public final class CaseSearchCriteria {
    private final String tenantId;
    private final String agencyCode;
    private final Set<String> statuses;
    private final Set<String> priorities;
    private final String assignedOfficerId;
    private final LocalDate submittedFrom;
    private final LocalDate submittedToExclusive;
    private final String normalizedKeyword;
    private final boolean includeDeleted;
    private final Boolean overdueOnly;
    private final CaseSort sort;
    private final PageLimit limit;

    // getter
}
```

Perhatikan:

- tenant/security scope dimasukkan eksplisit;
- date range memakai exclusive upper bound;
- keyword sudah dinormalisasi;
- pagination dibungkus value object;
- sort enum;
- collection filter pakai `Set`, bukan comma string;
- `includeDeleted` tidak boleh bebas untuk user biasa.

### 7.2 Jangan Biarkan Mapper Melakukan Business Parsing

Buruk:

```xml
<if test="keyword != null">
  AND UPPER(c.case_no) LIKE UPPER('%' || #{keyword} || '%')
</if>
```

Lebih baik service menyiapkan:

```java
criteria.normalizedKeywordLike()
```

Atau gunakan `<bind>` dengan hati-hati:

```xml
<bind name="keywordLike" value="'%' + normalizedKeyword + '%'" />
```

Namun tetap pastikan keyword sudah dibersihkan/di-normalize di layer sebelum mapper.

### 7.3 Search Criteria Harus Punya Invariant

Contoh invariant:

```text
limit must be 1..100
offset must be >= 0
sort must not be null
tenantId must not be null
submittedToExclusive must be after submittedFrom
keyword length must be <= 100
statuses must contain allowed status codes only
```

Letakkan invariant di constructor/value object, bukan tersebar di XML.

---

## 8. Keyword Search: LIKE, Case-Insensitive Search, dan Index

Keyword search sering menghancurkan performance.

### 8.1 Pattern Yang Tidak Index-Friendly

```sql
WHERE UPPER(applicant_name) LIKE UPPER('%' || #{keyword} || '%')
```

Masalah:

- leading wildcard `%abc` biasanya tidak memakai normal B-tree index;
- fungsi `UPPER(column)` bisa menghambat index kecuali ada function-based index;
- keyword terlalu pendek menghasilkan banyak match;
- OR di banyak kolom memperburuk selectivity.

### 8.2 Pattern Yang Lebih Terkontrol

Untuk exact-ish search:

```sql
WHERE case_no = #{caseNo}
```

Untuk prefix search:

```sql
WHERE normalized_applicant_name LIKE #{keywordPrefix}
```

Dengan value:

```text
"Fajar%"
```

Untuk contains search besar, pertimbangkan:

- PostgreSQL trigram index;
- Oracle Text;
- MySQL full-text index;
- SQL Server full-text search;
- search engine terpisah seperti OpenSearch/Elasticsearch.

MyBatis tetap bisa mengeksekusi SQL-nya, tetapi decision-nya adalah database/search architecture, bukan XML trick.

### 8.3 Keyword Semantics Harus Jelas

`keyword` bisa berarti:

- search case number;
- search applicant name;
- search email;
- search document number;
- search all fields;
- search exact;
- search contains;
- search prefix.

Jangan gabungkan semuanya tanpa batas.

Lebih baik:

```text
caseNo
applicantName
applicantIdentifier
freeText
```

Daripada satu keyword magical yang mencari semuanya.

---

## 9. Date Range Filter

Date range adalah sumber bug yang sangat sering.

### 9.1 Anti-Pattern: Inclusive End Date dengan Time

Buruk:

```sql
WHERE created_at BETWEEN #{from} AND #{to}
```

Jika `to = 2026-06-17`, apakah artinya:

```text
2026-06-17 00:00:00
```

atau seluruh hari?

### 9.2 Preferred Pattern: Inclusive Start, Exclusive End

```sql
WHERE created_at >= #{fromInclusive}
  AND created_at < #{toExclusive}
```

Untuk filter tanggal "17 Juni 2026", service mengubah:

```text
fromInclusive = 2026-06-17T00:00:00
toExclusive   = 2026-06-18T00:00:00
```

Keuntungan:

- tidak bergantung presisi timestamp;
- aman untuk microsecond/nanosecond;
- mudah di-index;
- konsisten antar database.

### 9.3 Timezone Boundary

Untuk aplikasi multi timezone:

```text
user date range -> user timezone -> instant range -> database timestamp convention
```

Jangan biarkan mapper menebak timezone.

---

## 10. Offset Pagination Implementation Pattern

### 10.1 API Request

```java
public final class PageRequest {
    private final int page;
    private final int size;

    public PageRequest(int page, int size) {
        if (page < 0) {
            throw new IllegalArgumentException("page must be >= 0");
        }
        if (size < 1 || size > 100) {
            throw new IllegalArgumentException("size must be between 1 and 100");
        }
        this.page = page;
        this.size = size;
    }

    public int offset() {
        return Math.multiplyExact(page, size);
    }

    public int limit() {
        return size;
    }
}
```

Catatan:

- gunakan `Math.multiplyExact` agar overflow terlihat;
- batasi size;
- page 0-based atau 1-based harus jelas;
- API boleh 1-based, internal boleh 0-based, tetapi konversi harus eksplisit.

### 10.2 Service

```java
public Page<CaseListRow> searchCases(CaseSearchRequest request, UserContext user) {
    PageRequest page = new PageRequest(request.page(), request.size());

    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .tenantId(user.tenantId())
        .agencyCode(user.agencyCode())
        .statuses(validateStatuses(request.statuses()))
        .submittedFrom(parseFrom(request.submittedFrom()))
        .submittedToExclusive(parseToExclusive(request.submittedTo()))
        .sort(parseSort(request.sort()))
        .limit(page.limit())
        .offset(page.offset())
        .build();

    List<CaseListRow> rows = mapper.searchCases(criteria);
    long total = mapper.countCases(criteria);

    return new Page<>(rows, page.page(), page.size(), total);
}
```

### 10.3 Mapper XML

```xml
<select id="searchCases" resultMap="CaseListRowMap">
  SELECT
      c.case_id,
      c.case_no,
      c.status,
      c.priority,
      c.created_at
  FROM cases c
  <include refid="CaseSearchWhereClause" />
  <include refid="CaseSearchOrderByClause" />
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>

<select id="countCases" resultType="long">
  SELECT COUNT(*)
  FROM cases c
  <include refid="CaseSearchWhereClause" />
</select>
```

Shared `WHERE` fragment harus hati-hati. Tidak semua join/filter data query cocok untuk count query.

---

## 11. Keyset Pagination Implementation Pattern

### 11.1 Cursor Request

```java
public final class CaseCursor {
    private final Instant lastCreatedAt;
    private final long lastCaseId;

    // constructor/getter
}
```

Criteria:

```java
public final class CaseCursorSearchCriteria {
    private final String tenantId;
    private final String status;
    private final Instant lastCreatedAt;
    private final Long lastCaseId;
    private final int limitPlusOne;
}
```

### 11.2 SQL Descending

```xml
<select id="searchNextCases" resultMap="CaseListRowMap">
  SELECT
      c.case_id,
      c.case_no,
      c.status,
      c.created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.deleted = 0

    <if test="status != null">
      AND c.status = #{status}
    </if>

    <if test="lastCreatedAt != null and lastCaseId != null">
      AND (
        c.created_at &lt; #{lastCreatedAt}
        OR (
          c.created_at = #{lastCreatedAt}
          AND c.case_id &lt; #{lastCaseId}
        )
      )
    </if>

  ORDER BY c.created_at DESC, c.case_id DESC
  FETCH NEXT #{limitPlusOne} ROWS ONLY
</select>
```

Jika memakai PostgreSQL:

```sql
LIMIT #{limitPlusOne}
```

### 11.3 Response Construction

```java
public CursorSlice<CaseListRow> searchNext(CaseCursorRequest request, UserContext user) {
    int size = validateSize(request.size());
    CaseCursor cursor = decodeCursor(request.cursor());

    CaseCursorSearchCriteria criteria = new CaseCursorSearchCriteria(
        user.tenantId(),
        request.status(),
        cursor == null ? null : cursor.lastCreatedAt(),
        cursor == null ? null : cursor.lastCaseId(),
        size + 1
    );

    List<CaseListRow> rows = mapper.searchNextCases(criteria);

    boolean hasNext = rows.size() > size;
    List<CaseListRow> visibleRows = hasNext ? rows.subList(0, size) : rows;

    String nextCursor = null;
    if (hasNext) {
        CaseListRow last = visibleRows.get(visibleRows.size() - 1);
        nextCursor = encodeCursor(last.createdAt(), last.caseId());
    }

    return new CursorSlice<>(visibleRows, hasNext, nextCursor);
}
```

### 11.4 Keyset with Ascending Sort

Untuk ascending:

```sql
AND (
  c.created_at > #{lastCreatedAt}
  OR (
    c.created_at = #{lastCreatedAt}
    AND c.case_id > #{lastCaseId}
  )
)
ORDER BY c.created_at ASC, c.case_id ASC
```

Operator harus mengikuti arah sort.

---

## 12. Composite Sort dan Keyset Predicate

Jika sort:

```sql
ORDER BY priority DESC, created_at ASC, case_id ASC
```

Maka keyset predicate bukan sekadar `case_id > lastCaseId`.

Predicate-nya:

```sql
AND (
  c.priority < #{lastPriority}
  OR (
    c.priority = #{lastPriority}
    AND c.created_at > #{lastCreatedAt}
  )
  OR (
    c.priority = #{lastPriority}
    AND c.created_at = #{lastCreatedAt}
    AND c.case_id > #{lastCaseId}
  )
)
```

Kenapa `priority <` untuk `DESC`?

Karena jika priority descending:

```text
10, 9, 8, 7
```

Setelah priority 8, row berikutnya punya priority lebih kecil.

General rule:

```text
For each ORDER BY column:
- ASC  -> next condition uses >
- DESC -> next condition uses <
- all previous sort columns must be equal
- final tie-breaker must be unique
```

Composite keyset rentan salah. Test wajib dibuat untuk:

- equal first column;
- equal second column;
- duplicate timestamp;
- first page;
- last page;
- mixed direction sorting.

---

## 13. Cursor Token Design

Cursor yang baik bukan sekadar Base64 ID.

### 13.1 Minimal Cursor

```json
{
  "v": 1,
  "lastCreatedAt": "2026-06-17T08:00:00Z",
  "lastCaseId": 12345
}
```

### 13.2 Cursor dengan Filter Hash

```json
{
  "v": 1,
  "sort": "CREATED_DESC",
  "lastCreatedAt": "2026-06-17T08:00:00Z",
  "lastCaseId": 12345,
  "filterHash": "sha256:..."
}
```

Jika request berikutnya mengubah filter, cursor harus ditolak.

### 13.3 Signed Cursor

Untuk public API:

```json
{
  "payload": "...base64...",
  "signature": "hmac-sha256..."
}
```

Tujuan:

- user tidak bisa memanipulasi cursor;
- user tidak bisa menaikkan limit diam-diam;
- user tidak bisa mengganti tenant/agency scope.

Cursor harus dianggap input tidak terpercaya.

---

## 14. Pagination dan Concurrent Writes

Misalnya page size 3, sorting:

```text
created_at DESC, id DESC
```

Initial data:

```text
A 10:00
B 09:00
C 08:00
D 07:00
E 06:00
F 05:00
```

Page 1 offset:

```text
A, B, C
```

Lalu ada insert baru:

```text
X 10:30
```

Page 2 offset `OFFSET 3`:

```text
C, D, E
```

C muncul lagi.

Dengan keyset setelah C:

```sql
WHERE created_at < '08:00'
```

Page 2:

```text
D, E, F
```

Lebih stabil.

### 14.1 Offset Pagination Consistency

Offset pagination tidak cocok jika user mengharapkan snapshot stabil di dataset yang sering berubah.

Solusi:

1. terima eventual inconsistency;
2. gunakan keyset;
3. gunakan snapshot token;
4. materialize search result;
5. gunakan report table;
6. gunakan transaction isolation tinggi untuk operasi pendek, tetapi tidak untuk browsing UI panjang.

### 14.2 Snapshot Token

Snapshot token bisa berupa:

```text
search started at timestamp T
```

Query:

```sql
WHERE created_at <= #{snapshotTime}
ORDER BY created_at DESC, case_id DESC
OFFSET ...
```

Ini menghindari insert baru masuk ke page berikutnya. Namun update/delete tetap perlu dipikirkan.

---

## 15. Pagination dengan Join One-to-Many

Ini salah satu bug paling umum.

### 15.1 Problem

Query:

```sql
SELECT
    c.case_id,
    c.case_no,
    d.document_id,
    d.file_name
FROM cases c
LEFT JOIN case_documents d ON d.case_id = c.case_id
ORDER BY c.created_at DESC
OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY
```

Jika satu case punya 10 documents, 20 row SQL bukan 20 cases. Bisa hanya menghasilkan 3 cases.

### 15.2 Correct Pattern: Page Root First, Join Later

Step 1: ambil root IDs.

```sql
SELECT c.case_id
FROM cases c
WHERE ...
ORDER BY c.created_at DESC, c.case_id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

Step 2: ambil detail untuk root IDs.

```sql
SELECT
    c.case_id,
    c.case_no,
    d.document_id,
    d.file_name
FROM cases c
LEFT JOIN case_documents d ON d.case_id = c.case_id
WHERE c.case_id IN (...)
ORDER BY c.created_at DESC, c.case_id DESC, d.document_id ASC
```

Step 3: assemble graph di Java.

Kelebihan:

- pagination benar berdasarkan root entity;
- tidak terjadi row explosion di page boundary;
- result mapping lebih terkendali;
- query count lebih sederhana.

### 15.3 Alternative: Window Root First

```sql
WITH page_cases AS (
    SELECT
        c.case_id,
        c.created_at
    FROM cases c
    WHERE ...
    ORDER BY c.created_at DESC, c.case_id DESC
    OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
)
SELECT
    c.case_id,
    c.case_no,
    d.document_id,
    d.file_name
FROM page_cases pc
JOIN cases c ON c.case_id = pc.case_id
LEFT JOIN case_documents d ON d.case_id = c.case_id
ORDER BY pc.created_at DESC, pc.case_id DESC, d.document_id ASC
```

Vendor syntax bisa berbeda, tetapi mental model-nya sama:

```text
page root rows first
then enrich
```

---

## 16. MyBatis Result Mapping untuk Paginated Join

Jika tetap memakai nested result:

```xml
<resultMap id="CaseWithDocumentsMap" type="CaseWithDocuments">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>

  <collection property="documents" ofType="DocumentRow">
    <id property="documentId" column="document_id"/>
    <result property="fileName" column="file_name"/>
  </collection>
</resultMap>
```

Pastikan:

- `<id>` root benar;
- `<id>` collection benar;
- SQL order deterministic;
- pagination diterapkan sebelum join one-to-many atau memakai root-first pattern.

Jangan paginasi row join lalu berharap MyBatis menyulapnya menjadi page root yang benar.

---

## 17. Fetch Size, Cursor, dan Large Result

Pagination UI bukan cara yang sama dengan export.

Untuk export besar:

- jangan pakai `page=0..N` offset dalam loop besar;
- pertimbangkan keyset;
- pertimbangkan cursor/streaming result;
- set `fetchSize` sesuai driver database;
- proses row per chunk;
- jangan materialize semua data ke `List`.

MyBatis statement punya attribute `fetchSize` sebagai hint ke driver. Dokumentasi Mapper XML menjelaskan `fetchSize` sebagai hint agar driver mengembalikan jumlah row tertentu per batch; support-nya bergantung driver.

Contoh:

```xml
<select id="streamCasesForExport"
        resultMap="CaseExportRowMap"
        fetchSize="500">
  SELECT
      c.case_id,
      c.case_no,
      c.status,
      c.created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.created_at &gt;= #{from}
    AND c.created_at &lt; #{to}
  ORDER BY c.case_id ASC
</select>
```

Namun `fetchSize` saja bukan jaminan streaming. Perilaku tergantung:

- database;
- JDBC driver;
- autocommit;
- result set type;
- transaction;
- MyBatis cursor usage.

Untuk large export, gunakan desain khusus, bukan endpoint search UI.

---

## 18. MyBatis Dynamic SQL Library untuk Pagination dan Sorting

Jika memakai MyBatis Dynamic SQL, select bisa dibangun dengan DSL.

Contoh konseptual:

```java
SelectStatementProvider select = select(caseId, caseNo, status, createdAt)
    .from(caseTable)
    .where(status, isEqualToWhenPresent(criteria.status()))
    .orderBy(createdAt.descending(), caseId.descending())
    .limit(criteria.limit())
    .offset(criteria.offset())
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Dokumentasi MyBatis Dynamic SQL menyediakan dukungan select, order by, limit, offset, dan rendering strategy untuk MyBatis3.

Namun sorting dinamis tetap harus whitelist.

Buruk:

```java
.orderBy(sortColumnFromRequest)
```

Lebih baik:

```java
private List<SortSpecification> toSortSpecs(CaseSort sort) {
    switch (sort) {
        case CREATED_DESC:
            return List.of(createdAt.descending(), caseId.descending());
        case CREATED_ASC:
            return List.of(createdAt, caseId);
        case CASE_NO_ASC:
            return List.of(caseNo, caseId);
        default:
            return List.of(createdAt.descending(), caseId.descending());
    }
}
```

Untuk Java 8, `List.of` diganti `Arrays.asList`.

---

## 19. Vendor-Specific Syntax

### 19.1 Oracle 12c+

```sql
ORDER BY c.created_at DESC, c.case_id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

### 19.2 PostgreSQL

```sql
ORDER BY c.created_at DESC, c.case_id DESC
LIMIT #{limit} OFFSET #{offset}
```

### 19.3 MySQL

```sql
ORDER BY c.created_at DESC, c.case_id DESC
LIMIT #{limit} OFFSET #{offset}
```

atau:

```sql
LIMIT #{offset}, #{limit}
```

Lebih baik pilih satu style yang jelas.

### 19.4 SQL Server

```sql
ORDER BY c.created_at DESC, c.case_id DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

SQL Server membutuhkan `ORDER BY` untuk `OFFSET/FETCH`.

### 19.5 DatabaseIdProvider Pattern

```xml
<select id="searchCases" databaseId="oracle" resultMap="CaseListRowMap">
  ...
  ORDER BY c.created_at DESC, c.case_id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>

<select id="searchCases" databaseId="postgresql" resultMap="CaseListRowMap">
  ...
  ORDER BY c.created_at DESC, c.case_id DESC
  LIMIT #{limit} OFFSET #{offset}
</select>
```

Atau isolasi fragment pagination:

```xml
<sql id="PaginationClause" databaseId="oracle">
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</sql>
```

Tetapi fragment vendor-specific bisa sulit dikelola jika terlalu banyak.

---

## 20. Index Design untuk Pagination

Pagination SQL harus didukung index sesuai filter dan order.

Contoh query:

```sql
SELECT
    c.case_id,
    c.case_no,
    c.status,
    c.created_at
FROM cases c
WHERE c.tenant_id = #{tenantId}
  AND c.status = #{status}
  AND c.deleted = 0
ORDER BY c.created_at DESC, c.case_id DESC
FETCH NEXT #{limit} ROWS ONLY
```

Index kandidat:

```sql
(tenant_id, status, deleted, created_at DESC, case_id DESC)
```

Tapi index design harus mempertimbangkan:

- cardinality tenant;
- cardinality status;
- deleted biasanya low-cardinality;
- sort direction support vendor;
- included/covering column;
- write overhead;
- query lain yang memakai index sama.

### 20.1 Equality Before Range Before Order

Rule umum:

```text
equality predicates -> range predicates -> order by columns
```

Contoh:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND created_at >= ?
  AND created_at < ?
ORDER BY created_at DESC, case_id DESC
```

Index:

```text
tenant_id, status, created_at DESC, case_id DESC
```

Jika filter `created_at` adalah range, kolom setelah range mungkin tidak selalu efektif untuk filtering, tetapi masih bisa membantu ordering tergantung vendor/plan.

### 20.2 Avoid Function on Indexed Column

Buruk:

```sql
WHERE TRUNC(created_at) = #{date}
```

Lebih baik:

```sql
WHERE created_at >= #{start}
  AND created_at < #{end}
```

Buruk:

```sql
WHERE UPPER(case_no) = UPPER(#{caseNo})
```

Lebih baik:

- simpan normalized column;
- gunakan function-based index;
- gunakan case-insensitive collation jika sesuai.

---

## 21. API Contract: Page, Slice, Cursor

### 21.1 Page Contract

```java
public final class Page<T> {
    private final List<T> items;
    private final int page;
    private final int size;
    private final long totalElements;
    private final int totalPages;
}
```

Gunakan jika:

- user butuh total;
- dataset relatif manageable;
- random page access dibutuhkan.

### 21.2 Slice Contract

```java
public final class Slice<T> {
    private final List<T> items;
    private final boolean hasNext;
}
```

Gunakan jika:

- tidak butuh total;
- ingin menghindari count;
- UI hanya butuh "next".

### 21.3 Cursor Slice Contract

```java
public final class CursorSlice<T> {
    private final List<T> items;
    private final String nextCursor;
    private final boolean hasNext;
}
```

Gunakan jika:

- data besar;
- high-write table;
- public API;
- event/audit/feed style.

---

## 22. MyBatis Mapper API Contract

### 22.1 Offset Page

```java
public interface CaseListingMapper {
    List<CaseListRow> findPage(CasePageCriteria criteria);

    long count(CasePageCriteria criteria);
}
```

### 22.2 Slice

```java
public interface CaseListingMapper {
    List<CaseListRow> findSlice(CaseSliceCriteria criteria);
}
```

Criteria `limitPlusOne`.

### 22.3 Cursor

```java
public interface CaseListingMapper {
    List<CaseListRow> findAfterCursor(CaseCursorCriteria criteria);
}
```

### 22.4 Export

```java
public interface CaseExportMapper {
    Cursor<CaseExportRow> streamForExport(CaseExportCriteria criteria);
}
```

Jangan campur semua ke satu method `search`.

---

## 23. Request Validation

Pagination harus divalidasi sebelum mapper.

### 23.1 Size Limit

```text
default size = 20
max size = 100 for UI
max size = 1000 for internal trusted batch
```

Jangan izinkan:

```http
?size=1000000
```

### 23.2 Offset Limit

Untuk offset pagination, pertimbangkan max offset:

```text
page * size <= 10000
```

Jika user butuh lebih dalam:

- gunakan filter lebih spesifik;
- gunakan export;
- gunakan cursor/keyset;
- gunakan search index.

### 23.3 Sort Validation

Unknown sort:

- reject dengan 400; atau
- fallback default.

Untuk enterprise/back-office, lebih baik reject agar client bug terlihat.

### 23.4 Filter Complexity Limit

Contoh limit:

- max statuses 20;
- max keyword length 100;
- min keyword length 3 for contains search;
- max date range 1 year;
- max `IN` list 1000;
- no unbounded export without approval.

---

## 24. Empty Filter Semantics

Search tanpa filter bisa berarti:

1. tampilkan semua;
2. tampilkan recent only;
3. tolak request;
4. tampilkan assigned-to-me;
5. tampilkan default work queue.

Jangan biarkan mapper menentukan ini diam-diam.

Buruk:

```xml
<where>
  <if test="status != null">
    status = #{status}
  </if>
</where>
```

Jika `status` null, query menjadi semua row.

Lebih baik service menentukan default:

```java
if (criteria.isUnbounded()) {
    criteria = criteria.withDefaultRecentWindow(Duration.ofDays(30));
}
```

Atau reject:

```java
if (criteria.isUnbounded()) {
    throw new SearchTooBroadException();
}
```

---

## 25. Security Scope dalam Search Query

Pagination query sering menjadi data leakage point.

Jangan:

```sql
SELECT ...
FROM cases
WHERE status = #{status}
```

Harus ada scope:

```sql
WHERE c.tenant_id = #{tenantId}
  AND c.agency_code = #{agencyCode}
  AND c.deleted = 0
```

Jika user role memengaruhi visibility:

```xml
<choose>
  <when test="visibilityScope == @VisibilityScope@OWNED_ONLY">
    AND c.assigned_officer_id = #{userId}
  </when>
  <when test="visibilityScope == @VisibilityScope@TEAM">
    AND c.team_id IN
    <foreach collection="teamIds" item="teamId" open="(" separator="," close=")">
      #{teamId}
    </foreach>
  </when>
  <when test="visibilityScope == @VisibilityScope@AGENCY">
    AND c.agency_code = #{agencyCode}
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

Security scope harus **default deny**, bukan default allow.

---

## 26. Soft Delete dan Visibility

Jika sistem memakai soft delete:

```sql
deleted = 0
```

Pastikan semua listing query menyertakan filter itu.

Pattern:

```xml
<sql id="VisibleCasePredicate">
  c.deleted = 0
</sql>
```

Namun jangan membuat fragment terlalu magic. Reviewer harus mudah melihat visibility rule.

Untuk admin/audit:

```xml
<choose>
  <when test="includeDeleted">
    1 = 1
  </when>
  <otherwise>
    c.deleted = 0
  </otherwise>
</choose>
```

Tapi `includeDeleted` harus hanya bisa dibuat oleh service setelah authorization check.

---

## 27. `IN` Clause dan Large Filter

### 27.1 Basic `foreach`

```xml
<if test="statuses != null and statuses.size() > 0">
  AND c.status IN
  <foreach collection="statuses" item="status" open="(" separator="," close=")">
    #{status}
  </foreach>
</if>
```

### 27.2 Empty List Semantics

Jika user memberi empty list:

```json
{"statuses": []}
```

Artinya apa?

- tidak filter?
- match nothing?
- invalid request?

Untuk filter eksplisit, empty list biasanya harus match nothing:

```xml
<choose>
  <when test="statuses != null and statuses.size() > 0">
    AND c.status IN
    <foreach collection="statuses" item="status" open="(" separator="," close=")">
      #{status}
    </foreach>
  </when>
  <when test="statuses != null and statuses.size() == 0">
    AND 1 = 0
  </when>
</choose>
```

### 27.3 Large IN List

Masalah:

- SQL terlalu panjang;
- bind parameter terlalu banyak;
- plan buruk;
- Oracle punya batas literal ekspresi tertentu;
- query parsing mahal.

Alternatif:

- temporary table;
- table-valued parameter;
- array parameter vendor-specific;
- join ke staging table;
- split chunk;
- redesign API.

---

## 28. Query Plan Review Checklist

Untuk setiap listing query penting, cek:

```text
1. Apakah WHERE memakai tenant/security scope?
2. Apakah ORDER BY deterministic?
3. Apakah ORDER BY sesuai index?
4. Apakah pagination dilakukan setelah join one-to-many?
5. Apakah count query lebih berat dari data query?
6. Apakah filter date range sargable?
7. Apakah LIKE memakai leading wildcard?
8. Apakah function diterapkan ke indexed column?
9. Apakah OR condition membuat index tidak efektif?
10. Apakah cardinality estimate masuk akal?
11. Apakah offset besar masih diterima?
12. Apakah row returned sesuai page size root entity?
13. Apakah query memakai full scan karena filter broad?
14. Apakah bind variable dipakai, bukan literal substitution?
15. Apakah sort option punya index support?
```

---

## 29. MyBatis XML Organization untuk Search

Search XML cepat menjadi besar. Struktur yang rapi:

```xml
<mapper namespace="com.example.caseapp.persistence.CaseListingMapper">

  <resultMap id="CaseListRowMap" type="CaseListRow">
    ...
  </resultMap>

  <sql id="CaseListingBaseColumns">
    c.case_id,
    c.case_no,
    c.status,
    c.priority,
    c.created_at,
    c.assigned_officer_id
  </sql>

  <sql id="CaseListingFromClause">
    FROM cases c
  </sql>

  <sql id="CaseListingWhereClause">
    <where>
      c.tenant_id = #{tenantId}
      AND c.deleted = 0
      ...
    </where>
  </sql>

  <sql id="CaseListingOrderByClause">
    ORDER BY
    <choose>
      ...
    </choose>
  </sql>

  <select id="findPage" resultMap="CaseListRowMap">
    SELECT
      <include refid="CaseListingBaseColumns" />
    <include refid="CaseListingFromClause" />
    <include refid="CaseListingWhereClause" />
    <include refid="CaseListingOrderByClause" />
    OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
  </select>

  <select id="count" resultType="long">
    SELECT COUNT(*)
    <include refid="CaseListingFromClause" />
    <include refid="CaseListingWhereClause" />
  </select>

</mapper>
```

Namun jangan berlebihan memecah fragment sampai reviewer tidak bisa membaca SQL utuh. Untuk query mission-critical, readability lebih penting daripada DRY ekstrem.

---

## 30. Pagination dan Cache

Listing query biasanya tidak cocok untuk second-level cache:

- parameter kombinasi sangat banyak;
- data sering berubah;
- result besar;
- invalidation sulit;
- user-specific security scope;
- stale data berbahaya.

Untuk MyBatis statement:

```xml
<select id="searchCases"
        resultMap="CaseListRowMap"
        useCache="false">
```

Cache aplikasi bisa dipakai untuk lookup kecil, bukan search listing besar.

---

## 31. Testing Pagination

### 31.1 Deterministic Ordering Test

Dataset:

```text
id=1, created_at=10:00
id=2, created_at=10:00
id=3, created_at=09:00
```

Pastikan:

```text
ORDER BY created_at DESC, id DESC
=> id 2, id 1, id 3
```

### 31.2 Offset Page Test

- page 0 size 2;
- page 1 size 2;
- last page;
- empty result;
- invalid page/size.

### 31.3 Keyset Test

- first page without cursor;
- next page with cursor;
- duplicate timestamp;
- no next page;
- cursor with changed filter rejected;
- sort direction correct.

### 31.4 Count Test

- count equals root entity count;
- count not inflated by one-to-many join;
- count respects tenant scope;
- count respects soft delete;
- count respects date range.

### 31.5 Security Test

- user A cannot see tenant B rows;
- agency scope applied;
- default deny for unsupported visibility scope;
- `includeDeleted` ignored/rejected for normal user.

### 31.6 SQL Injection Test for Sorting

Input:

```text
sort=createdAt desc; drop table cases;--
```

Expected:

```text
400 Bad Request
```

or fallback safe default, depending API policy.

But mapper must never render this as SQL.

---

## 32. Common Failure Modes

### 32.1 Duplicate Rows Between Pages

Cause:

- offset pagination with concurrent insert;
- non-deterministic order;
- missing tie-breaker.

Fix:

- add unique tie-breaker;
- use keyset;
- add snapshot boundary.

### 32.2 Missing Rows Between Pages

Cause:

- concurrent delete/update;
- offset pagination;
- unstable order.

Fix:

- keyset;
- snapshot;
- accept eventual list semantics.

### 32.3 Slow Page 10000

Cause:

- offset large;
- no supporting index;
- count expensive.

Fix:

- max offset limit;
- keyset;
- export flow;
- index redesign.

### 32.4 Count Query Timeout

Cause:

- join-heavy count;
- distinct count;
- broad filter;
- full scan.

Fix:

- simplify count;
- approximate count;
- slice response;
- async report;
- better index.

### 32.5 SQL Injection via Sort

Cause:

```xml
ORDER BY ${sort}
```

Fix:

- enum whitelist;
- hardcoded order fragments.

### 32.6 Page Size Abuse

Cause:

```http
?size=100000
```

Fix:

- API validation;
- max size;
- separate export endpoint.

### 32.7 Wrong Pagination with One-to-Many Join

Cause:

- paginating joined rows.

Fix:

- page root first;
- then join/enrich;
- manual assembly.

### 32.8 Empty IN Clause SQL Error

Cause:

```sql
status IN ()
```

Fix:

- define empty-list semantics;
- render `AND 1 = 0`;
- reject request.

---

## 33. Design Decision Matrix

| Situation | Recommended Strategy |
|---|---|
| Small admin table | Offset pagination |
| UI table needs total pages | Offset + count |
| Infinite scroll | Cursor/keyset |
| Large audit trail | Keyset |
| Event log | Keyset |
| Export millions of rows | Keyset or cursor streaming |
| User must jump to page N | Offset |
| Data changes very often | Keyset or snapshot |
| One-to-many detail list | Page root first |
| Search with many dynamic filters | Criteria object + XML dynamic SQL |
| Public API | Signed cursor |
| Count is expensive and not essential | Slice |
| Sorting comes from user | Enum whitelist |
| Vendor-specific pagination needed | `databaseIdProvider` or separate mapper |

---

## 34. Production-Grade Case Listing Example

### 34.1 Request

```java
public final class CaseListingRequest {
    private final List<String> statuses;
    private final String keyword;
    private final LocalDate submittedFrom;
    private final LocalDate submittedTo;
    private final String sort;
    private final int page;
    private final int size;
}
```

### 34.2 Internal Criteria

```java
public final class CaseListingCriteria {
    private final String tenantId;
    private final String agencyCode;
    private final Set<String> statuses;
    private final String keywordLike;
    private final LocalDateTime submittedFromInclusive;
    private final LocalDateTime submittedToExclusive;
    private final CaseSort sort;
    private final int offset;
    private final int limit;

    // constructor/getter
}
```

### 34.3 Mapper

```java
public interface CaseListingMapper {
    List<CaseListingRow> findPage(CaseListingCriteria criteria);

    long count(CaseListingCriteria criteria);
}
```

### 34.4 XML

```xml
<mapper namespace="com.example.caseapp.persistence.CaseListingMapper">

  <resultMap id="CaseListingRowMap" type="com.example.caseapp.persistence.CaseListingRow">
    <id property="caseId" column="case_id"/>
    <result property="caseNo" column="case_no"/>
    <result property="status" column="status"/>
    <result property="priority" column="priority"/>
    <result property="submittedAt" column="submitted_at"/>
    <result property="createdAt" column="created_at"/>
  </resultMap>

  <sql id="BaseColumns">
    c.case_id,
    c.case_no,
    c.status,
    c.priority,
    c.submitted_at,
    c.created_at
  </sql>

  <sql id="WhereClause">
    <where>
      c.tenant_id = #{tenantId}
      AND c.agency_code = #{agencyCode}
      AND c.deleted = 0

      <choose>
        <when test="statuses != null and statuses.size() > 0">
          AND c.status IN
          <foreach collection="statuses" item="status" open="(" separator="," close=")">
            #{status}
          </foreach>
        </when>
        <when test="statuses != null and statuses.size() == 0">
          AND 1 = 0
        </when>
      </choose>

      <if test="submittedFromInclusive != null">
        AND c.submitted_at &gt;= #{submittedFromInclusive}
      </if>

      <if test="submittedToExclusive != null">
        AND c.submitted_at &lt; #{submittedToExclusive}
      </if>

      <if test="keywordLike != null">
        AND (
          UPPER(c.case_no) LIKE UPPER(#{keywordLike})
          OR UPPER(c.applicant_name) LIKE UPPER(#{keywordLike})
        )
      </if>
    </where>
  </sql>

  <sql id="OrderByClause">
    ORDER BY
    <choose>
      <when test="sort == @com.example.caseapp.persistence.CaseSort@CREATED_DESC">
        c.created_at DESC, c.case_id DESC
      </when>
      <when test="sort == @com.example.caseapp.persistence.CaseSort@CREATED_ASC">
        c.created_at ASC, c.case_id ASC
      </when>
      <when test="sort == @com.example.caseapp.persistence.CaseSort@SUBMITTED_DESC">
        c.submitted_at DESC, c.case_id DESC
      </when>
      <when test="sort == @com.example.caseapp.persistence.CaseSort@PRIORITY_DESC">
        c.priority DESC, c.created_at ASC, c.case_id ASC
      </when>
      <otherwise>
        c.created_at DESC, c.case_id DESC
      </otherwise>
    </choose>
  </sql>

  <select id="findPage" resultMap="CaseListingRowMap" useCache="false">
    SELECT
      <include refid="BaseColumns"/>
    FROM cases c
    <include refid="WhereClause"/>
    <include refid="OrderByClause"/>
    OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
  </select>

  <select id="count" resultType="long" useCache="false">
    SELECT COUNT(*)
    FROM cases c
    <include refid="WhereClause"/>
  </select>

</mapper>
```

### 34.5 Review Notes

This example is good because:

- tenant/agency scope explicit;
- soft delete explicit;
- status empty list handled;
- date range uses exclusive end;
- keyword parameterized;
- sort whitelisted;
- tie-breaker included;
- count query not joining presentation tables;
- cache disabled;
- `SELECT *` avoided;
- mapper method contract clear.

But it still needs performance review for:

- `UPPER(...) LIKE UPPER(...)`;
- count cost;
- index support for each sort;
- max offset policy;
- large dataset strategy.

---

## 35. Efficient Learning Summary

In MyBatis, pagination excellence means you understand **SQL shape**, not just Java method shape.

Core rules:

```text
1. Never paginate without deterministic ORDER BY.
2. Always include a unique tie-breaker.
3. Never trust raw sort column/direction from user.
4. Use enum whitelist for sorting.
5. Offset pagination is fine for shallow pages.
6. Keyset pagination is better for large/deep/high-write data.
7. Count query is a separate performance problem.
8. Count root entities, not joined rows.
9. Page root rows before joining one-to-many details.
10. Validate page size, offset, keyword, date range, and filter complexity.
11. Keep tenant/security scope explicit in every listing query.
12. Use exclusive upper bound for date ranges.
13. Avoid `SELECT *`.
14. Avoid leading wildcard search unless backed by suitable index/search engine.
15. Test generated SQL and pagination edge cases.
```

A top-tier engineer does not ask only:

```text
Does this endpoint return page 1 correctly?
```

They ask:

```text
Will this listing still be correct and debuggable when:
- data reaches 50 million rows,
- users sort by different fields,
- concurrent updates happen,
- count becomes slow,
- tenant isolation matters,
- one-to-many joins are added,
- product asks for export,
- and incident response needs query-level evidence?
```

That is the difference between pagination as a UI feature and pagination as production-grade persistence engineering.

---

## 36. What Comes Next

Next part:

```text
16-batch-operations-batch-executor-jdbc-batch-bulk-insert-update.md
```

The next part moves from read-side listing/query mechanics into write-side throughput:

- JDBC batch;
- MyBatis batch executor;
- chunking;
- generated keys;
- partial failure;
- idempotent retry;
- memory pressure;
- transaction sizing;
- batch insert/update/upsert patterns.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 14 — Database Vendor Awareness: Oracle, PostgreSQL, MySQL, SQL Server](./14-database-vendor-awareness-oracle-postgresql-mysql-sqlserver.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 16 — Batch Operations: Batch Executor, JDBC Batch, Bulk Insert, Bulk Update](./16-batch-operations-batch-executor-jdbc-batch-bulk-insert-update.md)

</div>