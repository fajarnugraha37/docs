# Part 17 — Caching: First-Level Cache, Second-Level Cache, Invalidation

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `17-caching-first-level-second-level-cache-invalidation.md`  
> Level: Advanced  
> Target: Java 8 sampai Java 25  
> Fokus: memahami cache MyBatis bukan hanya sebagai optimasi performa, tetapi sebagai mekanisme yang mengubah model konsistensi, lifetime object, invalidation, memory pressure, dan cara troubleshooting data stale.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan **first-level cache** dan **second-level cache** di MyBatis.
2. Menjelaskan mengapa cache MyBatis adalah bagian dari **consistency model**, bukan sekadar performa.
3. Mendesain kapan cache MyBatis boleh digunakan dan kapan harus dihindari.
4. Mengatur `localCacheScope`, `flushCache`, `useCache`, `<cache>`, dan `<cache-ref>` secara benar.
5. Memahami bagaimana cache berinteraksi dengan `SqlSession`, transaction, Spring, mapper namespace, DML, nested query, lazy loading, dan result object mutability.
6. Mencegah bug umum seperti stale data, mutable cached object, accidental cache hit, memory pressure, dan cache invalidation yang terlalu luas/terlalu sempit.
7. Membuat review checklist untuk production mapper yang memakai cache.

---

## 1. Core Mental Model

Caching di MyBatis harus dipahami dalam tiga lapis:

```text
Application Request / Service Method
    |
    | uses mapper proxy
    v
SqlSession
    |
    | first-level cache / local cache
    v
Executor
    |
    | optional second-level namespace cache
    v
JDBC / Database
```

Ada dua cache utama:

```text
First-level cache
  scope    : SqlSession
  default  : enabled
  purpose  : avoid repeated query in same session, support nested mapping circular reference handling
  risk     : stale within long session, mutable object reference reuse

Second-level cache
  scope    : mapper namespace
  default  : not active until mapper cache configured
  purpose  : share cached result across sessions
  risk     : stale across transaction/request, invalidation complexity, serialization/memory issues
```

Kesalahan umum engineer adalah menganggap cache sebagai:

```text
"Query kedua lebih cepat. Done."
```

Padahal di production, cache berarti:

```text
"Untuk periode tertentu, aplikasi boleh membaca salinan data yang mungkin bukan hasil query database terbaru."
```

Dengan kata lain, setiap cache selalu membawa pertanyaan:

```text
Data ini boleh stale berapa lama?
Siapa yang boleh mengubahnya?
Kapan invalidation terjadi?
Apakah cache key cukup spesifik?
Apakah hasil cache aman dimodifikasi?
Apakah cache mengikuti boundary tenant/security?
Apakah cache tetap benar saat transaction rollback?
```

Jika pertanyaan-pertanyaan ini tidak bisa dijawab, cache biasanya belum layak diaktifkan.

---

## 2. Caching Bukan Sekadar Performance Feature

Cache mengubah perilaku sistem pada beberapa dimensi:

| Dimensi | Tanpa Cache | Dengan Cache |
|---|---|---|
| Source of truth read | Database langsung | Bisa cache |
| Freshness | Tergantung isolation DB | Tergantung invalidation |
| Object identity | Object baru per query | Bisa object yang sama dalam local session |
| Memory | Terutama result lifecycle | Result bisa disimpan lebih lama |
| Debugging | Query terlihat jelas | Query bisa tidak dieksekusi |
| Security scope | Query predicate menentukan akses | Cache key/invalidation juga harus benar |
| Transaction visibility | DB + transaction isolation | Cache bisa membuat hasil terlihat konsisten secara lokal walau DB berubah |

Cache yang salah bisa lebih berbahaya daripada query lambat.

Query lambat biasanya terlihat dari metric. Data stale bisa diam-diam menyebabkan keputusan bisnis salah.

---

## 3. First-Level Cache / Local Cache

First-level cache adalah cache yang terkait dengan satu `SqlSession`.

Secara default, MyBatis menggunakan local cache dengan scope `SESSION`. Artinya, selama satu `SqlSession` hidup, query yang sama dapat memakai hasil dari local cache.

Dokumentasi MyBatis menjelaskan bahwa `localCacheScope` default-nya `SESSION`; jika diubah menjadi `STATEMENT`, local cache hanya dipakai selama eksekusi statement, sehingga data tidak dibagi antar panggilan dalam `SqlSession` yang sama.

```xml
<settings>
  <setting name="localCacheScope" value="SESSION"/>
</settings>
```

Alternatif:

```xml
<settings>
  <setting name="localCacheScope" value="STATEMENT"/>
</settings>
```

### 3.1 Apa yang Dicache?

Secara konseptual, MyBatis menyimpan hasil query berdasarkan kombinasi seperti:

```text
MappedStatement id
SQL final / BoundSql
parameter values
row bounds
environment context tertentu
```

Maka dua query yang tampak mirip belum tentu memakai cache yang sama jika parameter atau SQL final berbeda.

Contoh:

```java
CaseDto a = mapper.findById(100L);
CaseDto b = mapper.findById(100L);
```

Jika berjalan dalam `SqlSession` yang sama dan tidak ada invalidation, panggilan kedua dapat diambil dari local cache.

### 3.2 Local Cache dalam Spring

Di aplikasi Spring, kamu biasanya tidak membuat `SqlSession` manual. MyBatis-Spring memakai `SqlSessionTemplate` dan session dikelola mengikuti Spring transaction.

Mental model sederhananya:

```text
@Transactional service method
    -> satu transaction-bound SqlSession
    -> local cache hidup sepanjang transaction/session tersebut

non-transactional mapper call
    -> SqlSession bisa dibuat/digunakan per operation oleh template
    -> local cache lifetime sangat pendek
```

Implikasinya:

```java
@Transactional
public CaseDto loadTwice(Long id) {
    CaseDto first = caseMapper.findById(id);
    CaseDto second = caseMapper.findById(id);
    return second;
}
```

Dalam transaction yang sama, query kedua bisa terkena local cache.

Ini baik jika kamu ingin menghindari repeated query. Namun ini bisa membingungkan jika ada update eksternal di antara dua read tersebut.

---

## 4. Local Cache Object Identity Risk

Salah satu detail penting: saat `localCacheScope=SESSION`, MyBatis dapat mengembalikan referensi object yang sama dari local cache.

Contoh buruk:

```java
@Transactional
public void unsafeMutation(Long id) {
    CaseDto first = caseMapper.findById(id);

    // Mutasi object hasil query untuk keperluan sementara.
    first.setStatus("TEMPORARY_DISPLAY_STATUS");

    CaseDto second = caseMapper.findById(id);

    // second bisa saja membawa perubahan temporary karena object berasal dari local cache.
    log.info("status = {}", second.getStatus());
}
```

Masalahnya bukan database berubah. Masalahnya object hasil query dimodifikasi di memory, lalu object yang sama dipakai ulang dari cache.

Rule production:

```text
Treat mapper result as read model object.
Do not mutate it unless it is deliberately detached and not reused.
Prefer immutable DTO/record for read projection.
```

Untuk Java 16+:

```java
public record CaseSummaryRow(
    Long caseId,
    String caseNo,
    String status,
    String assignedOfficerName
) {}
```

Untuk Java 8:

```java
public final class CaseSummaryRow {
    private final Long caseId;
    private final String caseNo;
    private final String status;
    private final String assignedOfficerName;

    public CaseSummaryRow(Long caseId, String caseNo, String status, String assignedOfficerName) {
        this.caseId = caseId;
        this.caseNo = caseNo;
        this.status = status;
        this.assignedOfficerName = assignedOfficerName;
    }

    public Long getCaseId() { return caseId; }
    public String getCaseNo() { return caseNo; }
    public String getStatus() { return status; }
    public String getAssignedOfficerName() { return assignedOfficerName; }
}
```

Immutable result object mengurangi risiko local cache pollution.

---

## 5. Kapan `localCacheScope=SESSION` Cocok?

`SESSION` cocok ketika:

1. `SqlSession` pendek.
2. Transaction boundary jelas.
3. Mapper result tidak dimutasi.
4. Banyak repeated nested query dalam satu operation.
5. Ada nested result/nested select yang membutuhkan circular reference protection.
6. Kamu ingin konsistensi lokal dalam satu unit of work.

Contoh cocok:

```text
Request: load case detail
  - find case header
  - find assigned officer
  - find case status dimension
  - find same status dimension lagi dari nested mapper
```

Local cache bisa mengurangi repeated lookup.

---

## 6. Kapan `localCacheScope=STATEMENT` Lebih Aman?

`STATEMENT` lebih aman ketika:

1. Session/transaction panjang.
2. Query harus selalu membaca database terbaru.
3. Result object sering dimutasi setelah query.
4. Ada banyak query besar dalam satu session sehingga local cache menahan memory.
5. Ada job batch panjang.
6. Ada streaming/export besar.
7. Ada risiko stale read dalam workflow yang sensitif.

Contoh konfigurasi:

```yaml
mybatis:
  configuration:
    local-cache-scope: STATEMENT
```

Trade-off:

```text
SESSION
  + lebih sedikit repeated query
  + membantu nested mapping
  - risiko stale/mutable reference/memory retention

STATEMENT
  + lebih predictable dan aman untuk long-running operation
  + mengurangi object retention antar statement
  - repeated query tidak otomatis di-cache antar mapper call
```

Untuk banyak sistem enterprise yang mengutamakan correctness, `STATEMENT` sering lebih mudah dijelaskan, terutama jika mapper digunakan dalam job batch besar.

Namun jangan ubah global setting tanpa memahami dampaknya pada nested query/lazy loading yang mungkin bergantung pada local cache.

---

## 7. Manual Clear Local Cache

MyBatis menyediakan `clearCache()` pada `SqlSession`.

Secara konseptual:

```java
sqlSession.clearCache();
```

Di aplikasi Spring yang memakai mapper proxy, kamu jarang memanggil `SqlSession` langsung. Jika sampai perlu manual clear cache di service layer, itu biasanya sinyal desain perlu ditinjau:

```text
Apakah transaction terlalu panjang?
Apakah result object dimutasi?
Apakah query harus selalu fresh?
Apakah localCacheScope seharusnya STATEMENT?
```

Manual clear cache adalah escape hatch, bukan default design.

---

## 8. DML dan Local Cache Invalidation

Secara default, statement write seperti `insert`, `update`, dan `delete` menyebabkan cache flush.

Contoh:

```xml
<update id="updateStatus">
  update case_tbl
  set status = #{newStatus}
  where case_id = #{caseId}
</update>
```

Setelah update, MyBatis biasanya membersihkan cache terkait supaya query berikutnya tidak memakai hasil lama.

Namun statement attribute dapat mengubah behavior:

```xml
<select id="findById"
        resultMap="CaseMap"
        useCache="true"
        flushCache="false">
  select ...
</select>
```

```xml
<update id="touchLastViewed"
        flushCache="false">
  update case_tbl
  set last_viewed_at = current_timestamp
  where case_id = #{caseId}
</update>
```

`flushCache="false"` pada DML harus dipakai sangat hati-hati.

Pertanyaan review:

```text
Apakah update ini benar-benar tidak mengubah data yang pernah dibaca oleh select cached?
Apakah kolom yang diubah tidak tampil di projection mana pun?
Apakah ada trigger yang mengubah kolom lain?
Apakah ada audit/version column yang bisa memengaruhi query?
```

Jika tidak yakin, biarkan DML flush cache.

---

## 9. Second-Level Cache

Second-level cache adalah cache yang scope-nya mapper namespace.

Untuk mengaktifkan cache pada mapper XML:

```xml
<mapper namespace="com.example.case.CaseMapper">

  <cache/>

  <select id="findStatusDimension" resultMap="StatusMap">
    select code, label
    from status_dimension
    where code = #{code}
  </select>

</mapper>
```

Dengan `<cache/>`, hasil select tertentu dalam namespace tersebut bisa disimpan di cache namespace dan digunakan oleh session lain.

Second-level cache lebih berisiko daripada first-level cache karena datanya bisa hidup melewati satu request/transaction.

Mental model:

```text
Session A queries mapper namespace X
  -> result can be stored in namespace cache after transaction/session rules

Session B queries same statement/parameter
  -> may receive cached result from namespace cache
```

### 9.1 Syarat Konseptual Data yang Cocok untuk Second-Level Cache

Cocok:

```text
reference data
lookup table
configuration yang jarang berubah
status dimension
country/province/city dimension jika jarang berubah
role metadata jika invalidation jelas
template metadata yang versioned
```

Tidak cocok:

```text
case/application mutable state
assignment list
approval queue
task inbox
payment status
stock/balance/quota
security-sensitive row visibility
personal data yang sering berubah
search result kompleks
query dengan tenant/permission dinamis
```

Rule sederhana:

```text
Second-level cache is for stable shared data, not live operational state.
```

---

## 10. Second-Level Cache Configuration

Contoh explicit cache configuration:

```xml
<cache
    eviction="LRU"
    flushInterval="600000"
    size="512"
    readOnly="true"/>
```

Makna konseptual:

| Attribute | Makna |
|---|---|
| `eviction` | strategi eviction, misalnya LRU/FIFO/SOFT/WEAK |
| `flushInterval` | interval periodic clear dalam millisecond |
| `size` | jumlah object/reference yang disimpan |
| `readOnly` | apakah cached object dianggap read-only |

### 10.1 `readOnly="true"`

Jika `readOnly=true`, MyBatis dapat mengembalikan instance object yang sama kepada caller.

Ini lebih cepat, tetapi caller tidak boleh memodifikasi object.

Cocok untuk immutable object:

```java
public record StatusDimension(String code, String label, boolean active) {}
```

Untuk Java 8:

```java
public final class StatusDimension {
    private final String code;
    private final String label;
    private final boolean active;

    public StatusDimension(String code, String label, boolean active) {
        this.code = code;
        this.label = label;
        this.active = active;
    }

    public String getCode() { return code; }
    public String getLabel() { return label; }
    public boolean isActive() { return active; }
}
```

### 10.2 `readOnly="false"`

Jika `readOnly=false`, object perlu aman untuk serialization/copy behavior sesuai cache implementation.

Banyak object result perlu `Serializable`.

Ini menambah overhead.

Rule:

```text
If you enable second-level cache, prefer immutable read model and readOnly=true only for truly immutable reference data.
For mutable result, avoid second-level cache unless you have a strong reason and strong tests.
```

---

## 11. `useCache` pada Select

Dalam mapper XML, select statement punya attribute `useCache`.

Contoh:

```xml
<select id="findByCode"
        resultMap="StatusMap"
        useCache="true">
  select code, label, active
  from status_dimension
  where code = #{code}
</select>
```

Jika second-level cache aktif di namespace, `useCache=true` berarti result select ini boleh masuk cache.

Untuk query yang tidak boleh masuk cache:

```xml
<select id="findCaseInbox"
        resultMap="CaseInboxRowMap"
        useCache="false">
  select ...
  from case_tbl c
  where c.assigned_to = #{officerId}
    and c.status in
    <foreach collection="statuses" item="status" open="(" separator="," close=")">
      #{status}
    </foreach>
  order by c.updated_at desc, c.case_id desc
</select>
```

Search/listing query biasanya `useCache=false`.

---

## 12. `flushCache` pada Select

Select default-nya biasanya tidak flush cache. Namun ada kasus select harus flush cache.

Contoh jarang:

```xml
<select id="refreshMaterializedViewAndRead"
        statementType="CALLABLE"
        flushCache="true"
        useCache="false">
  { call refresh_and_read_summary(#{agencyId}) }
</select>
```

Namun desain seperti ini perlu dicurigai. Select yang punya side effect bukan query murni.

Rule:

```text
A select should normally be side-effect free.
If a select needs flushCache=true, review whether it is actually a write/procedure operation.
```

---

## 13. `<cache-ref>`

`<cache-ref>` memungkinkan satu mapper namespace memakai cache namespace lain.

Contoh:

```xml
<mapper namespace="com.example.reference.StatusMapper">
  <cache/>
  ...
</mapper>
```

```xml
<mapper namespace="com.example.case.CaseReferenceMapper">
  <cache-ref namespace="com.example.reference.StatusMapper"/>
  ...
</mapper>
```

Ini berguna jika beberapa mapper membaca data referensi yang sama.

Namun hati-hati:

```text
cache-ref couples invalidation across namespaces.
```

Jika mapper A dan mapper B share cache, update di salah satu namespace dapat memengaruhi cache bersama.

Gunakan hanya jika ownership data jelas.

---

## 14. Cache Key dan Dynamic SQL

Dynamic SQL membuat cache lebih rumit karena SQL final bisa berubah berdasarkan parameter.

Contoh:

```xml
<select id="searchCases" resultMap="CaseRowMap" useCache="true">
  select case_id, case_no, status
  from case_tbl
  <where>
    <if test="status != null">
      status = #{status}
    </if>
    <if test="keyword != null and keyword != ''">
      and upper(case_no) like upper(#{keywordLike})
    </if>
  </where>
</select>
```

Masalah:

```text
Banyak kombinasi parameter = banyak cache entries.
Search result cepat berubah.
Invalidation sulit.
Cache memory bisa membesar.
```

Rule:

```text
Do not second-level-cache broad dynamic search queries.
Cache stable lookup by key, not operational search result.
```

Cache cocok:

```java
StatusDimension findStatusByCode(String code);
```

Cache tidak cocok:

```java
List<CaseInboxRow> searchInbox(CaseInboxSearchCriteria criteria);
```

---

## 15. Cache dan Tenant/Security Scope

Cache result yang bergantung pada tenant/agency/user permission sangat berbahaya jika cache key tidak mencerminkan scope tersebut.

Contoh query:

```xml
<select id="findVisibleCaseById" resultMap="CaseMap" useCache="true">
  select c.case_id, c.case_no, c.status
  from case_tbl c
  where c.case_id = #{caseId}
    and c.agency_id = #{agencyId}
</select>
```

Secara cache key, parameter `agencyId` ikut membedakan entry. Namun tetap ada risiko:

1. Authorization rule berubah.
2. User permission berubah.
3. Case pindah agency/ownership.
4. Query logic memakai context yang tidak eksplisit sebagai parameter.
5. Plugin/interceptor menambahkan tenant predicate secara hidden.

Rule:

```text
Avoid second-level cache for security-scoped operational data.
If data visibility can change per user/role/agency, prefer no MyBatis second-level cache.
```

Reference data yang sama untuk semua tenant boleh dipertimbangkan.

Tenant-specific reference data hanya boleh dicache jika:

```text
tenantId explicit in parameter,
cache invalidation clear,
data rarely changes,
no per-user permission filtering,
cache size bounded.
```

---

## 16. Cache dan Transaction Consistency

Caching harus dipahami bersama transaction.

Scenario:

```text
Transaction T1:
  read status dimension -> cache candidate
  update status dimension
  rollback

Transaction T2:
  read status dimension
```

Pertanyaan:

```text
Apakah cache menerima data sebelum commit?
Apakah rollback membersihkan entry?
Apakah update meng-flush namespace cache?
```

MyBatis menggunakan mekanisme cache transactional untuk second-level cache sehingga entry seharusnya tidak langsung terlihat secara sembarangan sebelum session/transaction selesai. Namun sebagai engineer, kamu tetap tidak boleh mendesain cache untuk data yang sering berubah dalam transaction kompleks.

Rule:

```text
Do not rely on second-level cache for transactional operational correctness.
Use database constraints, transaction isolation, and explicit read/write logic.
```

---

## 17. Cache dan DML Invalidation Scope

DML biasanya flush cache namespace.

Contoh:

```xml
<mapper namespace="com.example.reference.StatusMapper">
  <cache/>

  <select id="findByCode" resultMap="StatusMap" useCache="true">
    select code, label, active
    from status_dimension
    where code = #{code}
  </select>

  <update id="updateLabel">
    update status_dimension
    set label = #{label}
    where code = #{code}
  </update>
</mapper>
```

Saat `updateLabel` dieksekusi, cache namespace `StatusMapper` di-flush.

Masalah muncul jika data yang sama diubah oleh mapper namespace lain:

```xml
<mapper namespace="com.example.admin.AdminStatusMapper">
  <update id="bulkDeactivateStatus">
    update status_dimension
    set active = 0
    where module_code = #{moduleCode}
  </update>
</mapper>
```

Jika `AdminStatusMapper` tidak share cache atau tidak meng-flush cache `StatusMapper`, cache bisa stale.

Rule:

```text
If a table is cached in one namespace, writes to that table must be governed.
Either keep reads and writes in same namespace, use cache-ref deliberately, or avoid second-level cache.
```

Ini governance problem, bukan sekadar XML problem.

---

## 18. Namespace Ownership Pattern

Untuk data yang di-cache, gunakan ownership pattern:

```text
One table / reference aggregate
  -> one owning mapper namespace
  -> all write operations through owning mapper
  -> cache declared in owning namespace
  -> other mapper read through owning mapper or cache-ref
```

Contoh struktur:

```text
reference/
  StatusReferenceMapper.java
  StatusReferenceMapper.xml    <-- owns cache and writes

case/
  CaseMapper.java              <-- does not cache status table directly
```

Lebih aman:

```java
StatusDimension status = statusReferenceMapper.findByCode(code);
```

Daripada banyak mapper membuat query lookup sendiri:

```java
caseMapper.findStatusLabel(code);
appealMapper.findStatusLabel(code);
reportMapper.findStatusLabel(code);
```

Karena invalidation menjadi tersebar.

---

## 19. Cache dan Lazy Loading / Nested Select

Nested select dapat memicu banyak query. Local cache membantu mengurangi repeated nested query.

Contoh:

```xml
<resultMap id="CaseMap" type="CaseDetail">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>
  <association property="status"
               column="status_code"
               select="com.example.reference.StatusMapper.findByCode"/>
</resultMap>
```

Jika banyak case punya status yang sama, local cache dalam session dapat menghindari repeated `findByCode`.

Namun jika second-level cache aktif untuk `StatusMapper`, query status dapat diambil dari namespace cache lintas session.

Ini cocok untuk reference data stabil.

Tetapi nested select pada operational data bisa menjadi N+1 dan stale-cache trap.

Rule:

```text
Nested select + cache is acceptable for stable reference lookup.
Nested select + cache is dangerous for mutable operational relationship.
```

---

## 20. Cache dan Large Result

Jangan cache result besar.

Contoh buruk:

```xml
<select id="findAllAuditTrail"
        resultMap="AuditTrailMap"
        useCache="true">
  select audit_id, activity, metadata_clob, created_at
  from audit_trail
  order by created_at desc
</select>
```

Masalah:

1. Memory pressure.
2. Cached object besar.
3. CLOB/BLOB serialization issue.
4. Stale data.
5. Cache eviction menjadi noisy.
6. Query tidak bounded.

Rule:

```text
Never cache unbounded list, large export, CLOB/BLOB-heavy result, or report result without explicit size/freshness design.
```

Untuk audit trail, biasanya lebih baik:

```text
No MyBatis second-level cache.
Use pagination/keyset.
Use index correctly.
Use external analytical store/cache only if deliberately designed.
```

---

## 21. Cache dan `SELECT *`

`SELECT *` buruk untuk cache karena:

1. Cached payload lebih besar dari perlu.
2. Schema change dapat mengubah object mapping.
3. Kolom sensitif bisa ikut terbaca.
4. Memory footprint sulit diprediksi.
5. ResultMap menjadi tidak eksplisit.

Contoh buruk:

```xml
<select id="findUser" resultType="User" useCache="true">
  select *
  from user_tbl
  where user_id = #{userId}
</select>
```

Lebih baik:

```xml
<select id="findUserProfileLookup" resultMap="UserProfileLookupMap" useCache="true">
  select user_id,
         display_name,
         active
  from user_tbl
  where user_id = #{userId}
</select>
```

Cache harus menyimpan projection sekecil dan sestabil mungkin.

---

## 22. Cache dan Mutable Domain Object

Jika mapper mengembalikan domain object mutable yang kemudian dipakai business logic, jangan second-level-cache object tersebut.

Contoh berbahaya:

```java
Case caseObj = caseMapper.findById(caseId);
caseObj.assignTo(officerId);
```

Jika object ini berasal dari shared cache dan mutable, kamu membuka risiko state pollution.

Pattern lebih aman:

```text
Read projection cached?        boleh untuk immutable reference DTO
Domain aggregate mutation?     load fresh / no second-level cache
Write command?                 no cache dependency
```

Untuk sistem yang mengutamakan auditability dan correctness, biasakan:

```text
Cache DTO/projection, not mutable domain aggregate.
```

---

## 23. MyBatis Cache vs Application Cache vs Redis

Jangan otomatis memakai MyBatis second-level cache hanya karena ingin cache.

Bandingkan:

| Cache | Scope | Cocok Untuk | Kelemahan |
|---|---|---|---|
| MyBatis first-level | `SqlSession` | repeated query dalam satu unit of work | tidak lintas session, object identity risk |
| MyBatis second-level | mapper namespace | stable lookup/reference data | invalidation namespace, limited observability |
| Spring Cache | method/service | business-level cache | perlu key/invalidation design |
| Redis | distributed cache | data lintas instance, TTL, shared cache | serialization, network, invalidation complexity |
| Database materialized view | DB-level derived data | reporting/aggregation | refresh strategy |
| CDN/API cache | response-level | public/stable response | authorization complexity |

Rule:

```text
Use MyBatis cache when the cached unit is naturally a mapper result and invalidation follows mapper namespace.
Use application/Redis cache when the cached unit is business-level and needs explicit TTL, distributed visibility, metrics, and invalidation control.
```

Contoh MyBatis cache cocok:

```text
Status code -> label
Country code -> country name
Static reference table by key
```

Contoh Redis/Spring Cache lebih cocok:

```text
OneMap postal lookup result
external API token metadata
expensive cross-service derived summary
feature flag config distributed across pods
```

---

## 24. Cache Key Design in Application Cache vs MyBatis Cache

MyBatis cache key dibangun dari statement dan parameter. Kamu tidak selalu mengontrol bentuknya secara eksplisit.

Application cache key bisa didesain eksplisit:

```java
@Cacheable(cacheNames = "statusByCode", key = "#code")
public StatusDimension getStatus(String code) {
    return statusMapper.findByCode(code);
}
```

Namun ini juga membawa risiko double cache jika MyBatis second-level cache aktif.

Rule:

```text
Avoid stacking caches without clear reason.
If using Spring/Redis cache for a read, usually disable MyBatis second-level cache for same data path.
```

Double cache membuat invalidation lebih sulit:

```text
DB updated
  -> MyBatis namespace cache flushed?
  -> Spring cache evicted?
  -> Redis cache evicted?
  -> all app instances consistent?
```

Semakin banyak layer cache, semakin sulit correctness.

---

## 25. Configuration Example: Conservative Default

Untuk sistem enterprise mutable, default konservatif:

```yaml
mybatis:
  configuration:
    cache-enabled: true
    local-cache-scope: SESSION
    map-underscore-to-camel-case: true
```

Tetapi jangan deklarasikan `<cache/>` di mapper operational.

Artinya:

```text
First-level cache tetap default.
Second-level cache tidak aktif kecuali mapper tertentu mendeklarasikan <cache/>.
```

Untuk batch/long-running system, pertimbangkan:

```yaml
mybatis:
  configuration:
    local-cache-scope: STATEMENT
```

Tetapi review dulu nested mapping/lazy loading.

---

## 26. Configuration Example: Reference Mapper Cache

Contoh mapper reference data:

```xml
<mapper namespace="com.example.reference.StatusReferenceMapper">

  <cache
      eviction="LRU"
      flushInterval="300000"
      size="256"
      readOnly="true"/>

  <resultMap id="StatusDimensionMap" type="com.example.reference.StatusDimension">
    <constructor>
      <idArg column="code" javaType="string"/>
      <arg column="label" javaType="string"/>
      <arg column="active" javaType="boolean"/>
    </constructor>
  </resultMap>

  <select id="findByCode"
          parameterType="string"
          resultMap="StatusDimensionMap"
          useCache="true">
    select code,
           label,
           active
    from status_dimension
    where code = #{code}
  </select>

  <select id="findAllActive"
          resultMap="StatusDimensionMap"
          useCache="true">
    select code,
           label,
           active
    from status_dimension
    where active = 1
    order by sort_order, code
  </select>

  <update id="updateLabel">
    update status_dimension
    set label = #{label},
        updated_at = current_timestamp
    where code = #{code}
  </update>

</mapper>
```

Review:

```text
Is result immutable? yes.
Is data stable? mostly.
Are writes in same namespace? yes.
Is cache bounded? yes.
Is flush interval present? yes.
Is projection small? yes.
```

Ini reasonable.

---

## 27. Bad Example: Operational Cache

```xml
<mapper namespace="com.example.case.CaseMapper">

  <cache/>

  <select id="findById" resultMap="CaseMap" useCache="true">
    select case_id,
           case_no,
           status,
           assigned_to,
           updated_at,
           version
    from case_tbl
    where case_id = #{caseId}
  </select>

  <select id="findInbox" resultMap="CaseInboxRowMap" useCache="true">
    select case_id,
           case_no,
           status,
           assigned_to,
           updated_at
    from case_tbl
    where assigned_to = #{officerId}
    order by updated_at desc
  </select>

</mapper>
```

Masalah:

1. `case_tbl` sering berubah.
2. `findInbox` sangat user-specific dan mutable.
3. Assignment/status update bisa terjadi dari mapper lain.
4. Result staleness berdampak langsung ke workflow.
5. Query list bisa besar.
6. Security/visibility bisa berubah.

Lebih baik:

```xml
<select id="findById" resultMap="CaseMap" useCache="false">
  ...
</select>

<select id="findInbox" resultMap="CaseInboxRowMap" useCache="false">
  ...
</select>
```

Atau jangan deklarasikan `<cache/>` sama sekali.

---

## 28. Cache and Soft Delete

Soft delete membuat cache lebih sensitif.

Contoh:

```xml
<select id="findActiveById" resultMap="DocumentMap" useCache="true">
  select document_id, file_name, deleted
  from document_tbl
  where document_id = #{documentId}
    and deleted = 0
</select>
```

Jika document di-soft-delete oleh mapper lain, cached active document bisa tetap terlihat jika cache tidak terflush.

Rule:

```text
Avoid second-level cache for soft-deletable operational rows.
```

Untuk reference data soft delete, pastikan semua writes lewat owning mapper dan invalidation jelas.

---

## 29. Cache and Version Columns

Version column sering dipakai untuk optimistic locking.

Jika result cached tidak fresh, user bisa melihat versi lama.

Example:

```text
User reads case version 3 from cache.
Another user updates case to version 4.
User submits update with version 3.
Optimistic update fails.
```

Ini mungkin acceptable jika UI bisa handle conflict. Namun jika cache membuat conflict rate meningkat atau user melihat stale state terlalu sering, itu buruk.

Rule:

```text
Do not second-level-cache rows participating in active optimistic locking workflows.
```

---

## 30. Cache and Audit / Compliance

Dalam sistem regulasi, auditability lebih penting daripada micro-optimization.

Jangan cache query yang digunakan untuk:

```text
enforcement decision
approval decision
legal action visibility
payment/penalty calculation
case escalation
user authorization
current assignment
SLA deadline calculation
```

Boleh cache:

```text
stable code table
static template metadata
read-only UI dropdown dimension
```

Tetapi tetap simpan audit trail dari keputusan berdasarkan data aktual yang benar.

Rule:

```text
If stale data can affect a regulatory decision, do not use MyBatis second-level cache.
```

---

## 31. Cache and Clustered Applications

MyBatis default second-level cache bersifat local terhadap application instance, kecuali memakai cache adapter/distributed provider.

Dalam Kubernetes/EKS/multi-pod deployment:

```text
Pod A cache != Pod B cache
```

Jika Pod A melakukan update dan flush local cache, Pod B belum tentu ikut flush.

Ini sangat penting.

Contoh:

```text
Pod A: admin updates status label
  -> Pod A namespace cache flushed

Pod B: user reads status label
  -> Pod B may still have old cached entry
```

Maka untuk multi-instance system:

```text
MyBatis local second-level cache is risky for data changed at runtime.
```

Pilihan:

1. Jangan gunakan second-level cache untuk runtime mutable data.
2. Gunakan flush interval pendek untuk reference data yang toleran stale.
3. Gunakan distributed cache dengan explicit invalidation jika benar-benar perlu.
4. Gunakan application restart/config reload process untuk static data.

Untuk sistem enterprise multi-pod, MyBatis second-level cache paling aman untuk data yang:

```text
rarely changes,
small,
not security-sensitive,
stale tolerance jelas,
invalidated by deployment/admin process,
not critical to transaction correctness.
```

---

## 32. Cache and Deployment / Release

Schema atau data reference bisa berubah saat release.

Jika cache menyimpan result lama, release bisa mengalami mismatch.

Contoh:

```text
Release adds column active_reason.
Mapper result changes.
Old pod still has old cache.
New pod expects new projection.
```

Biasanya cache object tidak survive process restart, tetapi rolling deployment bisa membuat beberapa pod masih punya cache lama selama periode tertentu.

Rule:

```text
During rolling deployment, do not assume all in-memory caches are cleared at the same time.
```

Jika data reference berubah dengan release:

```text
seed data migration
restart pods
flush distributed cache if any
avoid runtime critical reliance on local second-level cache
```

---

## 33. Cache and Query Plan Performance

Cache bisa menyembunyikan query lambat.

Scenario:

```text
First request after restart: slow
Subsequent request: fast due to cache
Incident only appears after deployment/restart/cache eviction
```

Jika cache dipakai untuk menutupi query buruk, kamu akan punya cold-start latency problem.

Rule:

```text
Cache is not a substitute for index and query design.
Measure cold-cache and warm-cache performance separately.
```

Performance test harus mencakup:

```text
cold cache
warm cache
after DML flush
after deployment restart
under concurrent access
large parameter cardinality
```

---

## 34. Cache and Observability

Saat cache aktif, query tidak selalu muncul di SQL log.

Maka debugging harus menjawab:

```text
Was this result loaded from DB or cache?
Which cache layer?
Was cache invalidated?
Was second-level cache active for this namespace?
Was useCache true?
Was flushCache triggered?
```

Minimal observability:

1. SQL logging untuk cold path.
2. Metric query count per request.
3. Metric cache hit/miss jika cache provider mendukung.
4. Log admin update yang mengubah reference data.
5. Ability to disable cache in test/profile.

Untuk development, kamu bisa membuat test yang menghitung jumlah query untuk membuktikan cache behavior, tetapi jangan membuat test terlalu bergantung pada implementasi internal.

---

## 35. Testing First-Level Cache

Contoh conceptual test:

```java
@Test
void sameSqlSessionMayReuseLocalCache() {
    try (SqlSession session = sqlSessionFactory.openSession()) {
        CaseMapper mapper = session.getMapper(CaseMapper.class);

        CaseDto first = mapper.findById(1L);
        CaseDto second = mapper.findById(1L);

        // Depending on localCacheScope and mapping, object may be same reference.
        // More important: verify behavior and avoid mutation assumptions.
        assertThat(first.getCaseId()).isEqualTo(second.getCaseId());
    }
}
```

Test yang lebih berguna:

```java
@Test
void mapperResultMustNotBeMutatedInsideService() {
    CaseSummaryRow row = caseMapper.findSummaryById(1L);

    // If immutable, mutation is impossible.
    // This is design test through type design.
}
```

Best test untuk local cache bukan selalu assert cache hit, tetapi memastikan service tidak bergantung pada mutable cached object.

---

## 36. Testing Second-Level Cache

Contoh test idea:

```text
1. Open session A.
2. Query reference data by code.
3. Commit/close session A.
4. Open session B.
5. Query same reference data by code.
6. Verify result correct.
7. Update reference data through owning mapper.
8. Query again.
9. Verify updated result visible after invalidation.
```

Pseudo-code:

```java
@Test
void statusCacheInvalidatedAfterUpdate() {
    StatusDimension before = statusMapper.findByCode("OPEN");

    statusMapper.updateLabel(new UpdateStatusLabelCommand("OPEN", "Open Case"));

    StatusDimension after = statusMapper.findByCode("OPEN");

    assertThat(after.label()).isEqualTo("Open Case");
}
```

Untuk multi-pod/distributed correctness, unit/integration test lokal tidak cukup. Perlu architecture decision:

```text
Do we accept per-pod stale cache?
Do we need distributed invalidation?
Do we avoid second-level cache entirely?
```

---

## 37. Common Failure Modes

### 37.1 Stale Reference Data

Gejala:

```text
Admin sudah update label/status, user masih lihat label lama.
```

Kemungkinan:

```text
second-level cache per pod
write lewat mapper namespace lain
distributed cache belum evict
flush interval terlalu lama
```

Fix:

```text
centralize writes
use cache-ref or remove cache
use shorter TTL/flush interval
use distributed invalidation if needed
```

### 37.2 Mutated Cached Object

Gejala:

```text
Object hasil query punya field aneh yang tidak ada di DB.
```

Kemungkinan:

```text
result object mutable
local cache returns same reference
readOnly second-level cache reused instance
service mutates projection
```

Fix:

```text
immutable DTO/record
avoid mutation
copy before modification
localCacheScope=STATEMENT for risky flow
```

### 37.3 Memory Spike

Gejala:

```text
Heap meningkat setelah search/export.
GC pressure tinggi.
```

Kemungkinan:

```text
large result cached
SESSION local cache in long-running batch
second-level cache size too large
CLOB/BLOB cached
```

Fix:

```text
useCache=false
localCacheScope=STATEMENT
cursor/streaming
bounded pagination
cache size limit
avoid caching LOB
```

### 37.4 Cache Hides SQL Bug

Gejala:

```text
Test pass setelah query pertama, gagal saat cache disabled/restart.
```

Kemungkinan:

```text
cache masks inconsistent query
cold path untested
```

Fix:

```text
test cold cache
clear cache between tests
verify SQL/result directly
```

### 37.5 Tenant Data Leak Suspicion

Gejala:

```text
User melihat data/label yang tidak sesuai tenant.
```

Kemungkinan:

```text
tenant scope hidden interceptor not part of cache key assumption
second-level cache on scoped query
parameter missing tenantId
shared cache-ref across tenant-specific mapper
```

Fix:

```text
disable second-level cache for scoped data
make tenant explicit
review cache key and SQL
add tenant isolation tests
```

---

## 38. Decision Framework: Should This Mapper Use Second-Level Cache?

Gunakan pertanyaan ini:

```text
1. Is the data small?
2. Is the data stable?
3. Is stale data acceptable?
4. Is result immutable?
5. Is query by deterministic key?
6. Is data not user/permission scoped?
7. Are all writes centralized through same namespace or cache-ref?
8. Is cache bounded?
9. Is invalidation clear in multi-pod environment?
10. Is cold query already reasonably fast?
```

Jika ada jawaban “tidak” untuk pertanyaan 2, 3, 4, 6, atau 7, hindari second-level cache.

---

## 39. Recommended Policy for Large Enterprise MyBatis Codebase

Untuk codebase besar, jangan biarkan setiap developer bebas menambahkan `<cache/>`.

Policy yang disarankan:

```text
Default:
  - No second-level cache in operational mapper.
  - First-level cache default accepted unless batch/long-session issue.

Allowed:
  - Reference/lookup mapper only.
  - Immutable result object.
  - Bounded cache size.
  - Explicit flush interval.
  - Owning namespace controls writes.
  - Review required.

Forbidden:
  - Case/application/task/payment/approval mutable state.
  - Search/listing/inbox/report query.
  - CLOB/BLOB-heavy query.
  - Security-scoped query.
  - Mapper returning mutable aggregate.
```

Example governance annotation/comment:

```xml
<!--
  CACHE POLICY:
  - Allowed because this mapper owns stable status reference data.
  - Result type is immutable.
  - All writes to status_dimension must go through this namespace.
  - Stale tolerance: up to 5 minutes.
  - Do not add operational case query to this mapper.
-->
<cache eviction="LRU" flushInterval="300000" size="256" readOnly="true"/>
```

---

## 40. Cache Review Checklist

Sebelum approve mapper cache:

```text
Data Classification
  [ ] Is this reference data, not operational state?
  [ ] Is stale data acceptable?
  [ ] Is stale tolerance documented?

Result Object
  [ ] Is result immutable?
  [ ] Does result avoid CLOB/BLOB/large payload?
  [ ] Does projection include only necessary columns?

Query Shape
  [ ] Is query deterministic and bounded?
  [ ] Is it not broad dynamic search?
  [ ] Is it not user-permission scoped?
  [ ] Is tenant scope explicit if relevant?

Invalidation
  [ ] Are writes centralized through same namespace?
  [ ] If multiple mappers write same data, is cache-ref/governance clear?
  [ ] Is multi-pod stale behavior acceptable?
  [ ] Is flushInterval/eviction/size explicit?

Transaction
  [ ] Does cache not affect transaction correctness?
  [ ] Are rollback/commit expectations tested?

Operations
  [ ] Can cache be disabled for troubleshooting?
  [ ] Are cold-cache timings acceptable?
  [ ] Are hit/miss or query count observable enough?
```

---

## 41. Practical Defaults by Use Case

| Use Case | First-Level Cache | Second-Level Cache | Notes |
|---|---:|---:|---|
| Lookup by status code | OK | OK with governance | immutable, stable |
| UI dropdown reference | OK | OK | bounded list |
| Case detail | OK | Avoid | mutable operational state |
| Case inbox | OK | No | user-specific, frequently changing |
| Audit trail listing | Prefer STATEMENT for large flow | No | large, append-heavy |
| Batch import | Often STATEMENT | No | memory/control |
| Report export | STATEMENT/cursor | No | large result |
| Permission lookup | Depends | Usually no | security-sensitive |
| External API token | Not MyBatis concern | Use app/Redis cache | business-level TTL |
| Postal code lookup from DB | OK | Maybe | if stable and small |

---

## 42. Java 8 sampai Java 25 Considerations

### Java 8

Gunakan immutable class manual:

```java
public final class StatusDimension {
    private final String code;
    private final String label;

    public StatusDimension(String code, String label) {
        this.code = code;
        this.label = label;
    }

    public String getCode() { return code; }
    public String getLabel() { return label; }
}
```

Pastikan constructor mapping jelas di XML.

### Java 11

Tidak banyak perubahan khusus cache. Fokus pada compatibility dan memory observability yang lebih baik.

### Java 17+

Records cocok untuk cached reference projection:

```java
public record StatusDimension(String code, String label, boolean active) {}
```

Namun pastikan mapping constructor/record sudah diuji.

### Java 21+

Virtual threads tidak membuat cache lebih aman. Bahkan concurrency yang lebih tinggi bisa membuat cache staleness atau memory pressure lebih cepat terlihat.

Rule:

```text
Virtual threads improve concurrency model, not cache correctness.
```

### Java 25

Prinsip tetap sama:

```text
Prefer immutable cached result.
Keep cache boundary explicit.
Do not cache mutable operational state.
```

---

## 43. Mini Case Study: Status Dimension Cache

### Problem

Banyak screen membutuhkan status label:

```text
OPEN -> Open
ASSIGNED -> Assigned
CLOSED -> Closed
```

Status jarang berubah. Query lookup sering dipakai.

### Design

```text
Mapper: StatusReferenceMapper
Data: status_dimension
Cache: second-level cache with LRU, size 256, flush interval 5 minutes
Result: immutable StatusDimension
Writes: only through StatusReferenceMapper
```

### Mapper

```xml
<mapper namespace="com.example.reference.StatusReferenceMapper">

  <cache eviction="LRU"
         flushInterval="300000"
         size="256"
         readOnly="true"/>

  <resultMap id="StatusDimensionMap" type="com.example.reference.StatusDimension">
    <constructor>
      <idArg column="code" javaType="string"/>
      <arg column="label" javaType="string"/>
      <arg column="active" javaType="boolean"/>
    </constructor>
  </resultMap>

  <select id="findByCode" resultMap="StatusDimensionMap" useCache="true">
    select code,
           label,
           active
    from status_dimension
    where code = #{code}
  </select>

  <update id="updateLabel">
    update status_dimension
    set label = #{label},
        updated_at = current_timestamp
    where code = #{code}
  </update>

</mapper>
```

### Service Rule

```java
@Transactional(readOnly = true)
public StatusDimension getStatus(String code) {
    return statusReferenceMapper.findByCode(code);
}
```

### Governance Rule

```text
No other mapper may update status_dimension.
If admin bulk update is needed, it must use StatusReferenceMapper or explicitly flush same cache namespace.
```

### Stale Tolerance

```text
Admin update may take up to 5 minutes to appear on all pods if using local second-level cache.
If this is unacceptable, do not use local MyBatis second-level cache; use distributed invalidation or no cache.
```

---

## 44. Mini Case Study: Why Not Cache Case Inbox?

### Query

```xml
<select id="findOfficerInbox" resultMap="CaseInboxRowMap" useCache="true">
  select case_id,
         case_no,
         status,
         priority,
         assigned_to,
         updated_at
  from case_tbl
  where assigned_to = #{officerId}
    and status in ('OPEN', 'ASSIGNED')
  order by priority desc, updated_at asc, case_id asc
</select>
```

### Why Bad

```text
Data changes frequently.
Assignment changes frequently.
Status changes frequently.
Order changes when priority/updated_at changes.
Result is user-specific.
Wrong inbox can cause missed work.
DML may occur through many mappers.
Multi-pod cache stale is unacceptable.
```

### Better

```xml
<select id="findOfficerInbox" resultMap="CaseInboxRowMap" useCache="false">
  select case_id,
         case_no,
         status,
         priority,
         assigned_to,
         updated_at
  from case_tbl
  where assigned_to = #{officerId}
    and status in ('OPEN', 'ASSIGNED')
  order by priority desc, updated_at asc, case_id asc
  fetch first #{limit} rows only
</select>
```

Optimize with:

```text
composite index
keyset pagination
bounded page size
query metrics
not MyBatis second-level cache
```

---

## 45. Final Mental Model

MyBatis cache harus dipahami seperti ini:

```text
First-level cache:
  A session-local identity/performance mechanism.
  Useful, but beware mutation, long session, memory, stale local reads.

Second-level cache:
  A namespace-level consistency trade-off.
  Use only for stable, small, immutable, non-security-sensitive data with clear invalidation.
```

Jangan mulai dari pertanyaan:

```text
Can we cache this query?
```

Mulai dari pertanyaan:

```text
What correctness guarantee does this data require?
How stale may it be?
Who owns invalidation?
What happens in multi-pod deployment?
```

Top-tier engineer tidak hanya tahu cara menulis:

```xml
<cache/>
```

Top-tier engineer tahu kapan **tidak** menulisnya.

---

## 46. Ringkasan

Di bagian ini, kita sudah membahas:

1. First-level cache / local cache.
2. `localCacheScope=SESSION` vs `STATEMENT`.
3. Object identity dan mutability risk.
4. Manual `clearCache()` sebagai escape hatch.
5. Second-level cache berbasis mapper namespace.
6. `<cache>`, `useCache`, `flushCache`, dan `<cache-ref>`.
7. Cache key dan dynamic SQL.
8. Tenant/security scope risk.
9. Transaction consistency.
10. DML invalidation scope.
11. Namespace ownership pattern.
12. Lazy loading/nested select interaction.
13. Large result dan LOB anti-pattern.
14. MyBatis cache vs Spring Cache vs Redis.
15. Multi-pod deployment risk.
16. Testing dan observability.
17. Production review checklist.
18. Java 8 sampai Java 25 considerations.

Caching adalah area di mana optimasi kecil bisa membuka risiko correctness besar. Untuk MyBatis, default terbaik di sistem besar biasanya konservatif:

```text
First-level cache: understand and control.
Second-level cache: opt-in only for stable reference data.
Operational data: optimize SQL/index/pagination, not namespace cache.
```

---

## 47. Koneksi ke Part Berikutnya

Bagian berikutnya adalah:

```text
18-lazy-loading-nested-select-n-plus-one-object-graph-control.md
```

Kita akan masuk lebih dalam ke hubungan antara:

```text
nested select
lazy loading
association
collection
N+1 query
object graph explosion
local cache
transaction/session lifetime
serialization trap
```

Part 17 memberi fondasi cache. Part 18 akan menunjukkan bagaimana cache sering muncul sebagai “obat sementara” untuk N+1, padahal solusi yang benar sering kali adalah desain fetch strategy dan object graph boundary yang lebih eksplisit.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./16-batch-operations-batch-executor-jdbc-batch-bulk-insert-update.md">⬅️ Part 16 — Batch Operations: Batch Executor, JDBC Batch, Bulk Insert, Bulk Update</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./18-lazy-loading-nested-select-n-plus-one-object-graph-control.md">Part 18 — Lazy Loading, Nested Select, N+1, and Object Graph Control ➡️</a>
</div>
