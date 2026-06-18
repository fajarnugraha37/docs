# Part 4 — SQL Statement Mapping: SELECT, INSERT, UPDATE, DELETE Deep Dive

Series: `learn-java-mybatis-sql-mapper-persistence-engineering`  
File: `04-sql-statement-mapping-select-insert-update-delete-deep-dive.md`  
Scope: Java 8–25, MyBatis 3.x, MyBatis-Spring/Spring Boot integration where relevant

---

## 0. Posisi Part Ini dalam Seri

Pada Part 0 kita membangun mental model bahwa MyBatis adalah **SQL-first persistence framework**. Pada Part 1 kita membedah runtime internalnya: `SqlSession`, `Configuration`, `MappedStatement`, `BoundSql`, `Executor`, `StatementHandler`, `ParameterHandler`, dan `ResultSetHandler`. Pada Part 2 kita membahas strategi versi Java 8 sampai 25. Pada Part 3 kita membahas desain mapper interface, XML, annotation, dan naming discipline.

Part 4 adalah titik ketika desain mulai bersentuhan langsung dengan operasi database paling dasar tetapi paling menentukan:

```text
SELECT  -> membaca fakta dari database
INSERT  -> menciptakan fakta baru
UPDATE  -> mengubah fakta yang sudah ada
DELETE  -> menghapus atau menonaktifkan fakta
```

Di engineer level junior, statement ini sering dilihat sebagai CRUD sederhana. Di engineer level senior/top-tier, statement ini dilihat sebagai **contract of state transition**:

```text
Mapper method
  -> SQL statement
  -> parameter binding
  -> rows matched / rows affected
  -> generated key / returned value
  -> transaction effect
  -> cache invalidation
  -> concurrency consequence
  -> audit/security impact
```

Tujuan bagian ini bukan hanya bisa menulis `<select>`, `<insert>`, `<update>`, dan `<delete>`, tetapi mampu mendesain statement yang:

1. jelas maksudnya,
2. aman dari ambiguity,
3. memberikan sinyal correctness,
4. bisa diuji,
5. bisa di-debug saat incident,
6. tidak menyembunyikan race condition,
7. tidak membuat schema evolution menjadi rapuh.

---

## 1. Mental Model: Statement MyBatis Bukan Sekadar SQL String

Dalam MyBatis, setiap statement XML seperti berikut:

```xml
<select id="findById" parameterType="long" resultMap="UserRowMap">
  SELECT id, username, status, created_at
  FROM app_user
  WHERE id = #{id}
</select>
```

akan menjadi satu **MappedStatement** di runtime.

Mapped statement bukan hanya SQL. Ia membawa metadata:

```text
statement id
statement type
SQL source
parameter mapping
result mapping
cache behavior
timeout
fetch size
key generation strategy
statement/prepared/callable mode
result set type
flush behavior
```

Maka ketika kita mendesain statement, kita sedang mendesain sebuah **executable database contract**, bukan sekadar menaruh query di XML.

Kontrak minimal setiap statement seharusnya menjawab:

```text
Apa operasi ini lakukan?
Input apa yang valid?
Output apa yang dijanjikan?
Berapa row yang boleh kena?
Apa artinya kalau 0 row?
Apa artinya kalau >1 row?
Apakah statement ini mengubah state?
Apakah statement ini idempotent?
Apakah statement ini aman terhadap concurrent request?
Apakah statement ini tenant/user scoped?
Apakah statement ini perlu audit?
```

---

## 2. Empat Statement Utama dalam Mapper XML

MyBatis XML mendukung elemen statement utama:

```xml
<select id="..."> ... </select>
<insert id="..."> ... </insert>
<update id="..."> ... </update>
<delete id="..."> ... </delete>
```

Secara permukaan ini sederhana. Tetapi setiap elemen memiliki perilaku yang berbeda terhadap:

| Statement | Nature | Return Signal | Mapping Concern | Cache Concern |
|---|---:|---:|---:|---:|
| `select` | read | object/list/cursor/map | result mapping | can use cache |
| `insert` | write | affected row count; generated key via parameter object | key retrieval | flush cache |
| `update` | write | affected row count | state transition correctness | flush cache |
| `delete` | write | affected row count | hard/soft delete semantics | flush cache |

Default mental model:

```text
SELECT returns data.
INSERT/UPDATE/DELETE return effect.
```

Yang membedakan engineer matang: ia tidak hanya melihat “query berhasil dieksekusi”, tetapi membaca **effect signal** dari database.

---

## 3. Anatomy `<select>`

Contoh dasar:

```xml
<select id="findById" parameterType="long" resultMap="UserRowMap">
  SELECT
    id,
    username,
    email,
    status,
    created_at,
    updated_at
  FROM app_user
  WHERE id = #{id}
</select>
```

Mapper interface:

```java
public interface UserMapper {
    UserRow findById(long id);
}
```

### 3.1 `selectOne` Contract

Secara konseptual, method mapper yang return single object menggunakan `selectOne` behavior.

Kontraknya:

```text
0 row  -> null, unless wrapped/handled differently
1 row  -> object
>1 row -> error: too many results
```

Karena itu, single-result query harus memiliki predicate yang secara data model memang unik:

```sql
WHERE id = #{id}
```

atau:

```sql
WHERE tenant_id = #{tenantId}
  AND external_reference = #{externalReference}
```

Jika predicate tidak unik, jangan return single object.

Buruk:

```java
UserRow findByStatus(String status);
```

Karena `status` hampir pasti bukan unique.

Lebih baik:

```java
List<UserRow> findAllByStatus(String status);
```

atau jika memang business rule bilang hanya satu row aktif:

```java
ActiveUserRow findActiveUserByEmail(UserEmailKey key);
```

SQL-nya harus menegakkan invariant:

```sql
WHERE tenant_id = #{tenantId}
  AND email = #{email}
  AND status = 'ACTIVE'
```

Tetapi tetap lebih baik kalau invariant tersebut juga didukung oleh unique constraint/index di database.

### 3.2 `selectList` Contract

Untuk multi-row:

```xml
<select id="findActiveUsers" parameterType="UserSearchCriteria" resultMap="UserRowMap">
  SELECT id, username, email, status, created_at
  FROM app_user
  WHERE status = 'ACTIVE'
  ORDER BY created_at DESC, id DESC
</select>
```

Mapper:

```java
List<UserRow> findActiveUsers(UserSearchCriteria criteria);
```

Kontraknya:

```text
0 row -> empty list
N row -> list size N
```

Jangan return `null` untuk list. Empty list lebih aman karena caller bisa melakukan iterasi tanpa null check.

### 3.3 `selectMap` Contract

Kadang hasil query ingin langsung menjadi map:

```java
@MapKey("id")
Map<Long, UserRow> findUsersByIds(@Param("ids") List<Long> ids);
```

Perhatian:

```text
Map key collision = data loss silently if tidak hati-hati.
```

Jika key tidak unik, row terakhir bisa menimpa row sebelumnya tergantung behavior mapping. Jadi `selectMap` harus dipakai hanya jika key memang unik secara query result.

### 3.4 Cursor/Streaming Result

Untuk hasil besar, jangan selalu return `List<T>`.

```java
Cursor<AuditTrailRow> scanAuditTrail(AuditTrailScanCriteria criteria);
```

Mental model:

```text
List<T>    -> materialize all rows into memory
Cursor<T>  -> iterate rows with open database resource
```

Cursor bukan “free optimization”. Ia membawa konsekuensi:

1. koneksi harus tetap terbuka,
2. transaction/session harus hidup,
3. caller harus menutup cursor,
4. mapper method tidak boleh dipakai seolah hasilnya disconnected biasa.

Untuk export/report besar, cursor atau chunked pagination lebih masuk akal daripada list ratusan ribu row.

---

## 4. Anatomy `<insert>`

Contoh dasar:

```xml
<insert id="insertUser" parameterType="CreateUserCommand">
  INSERT INTO app_user (
    username,
    email,
    status,
    created_at,
    created_by
  ) VALUES (
    #{username},
    #{email},
    #{status},
    #{createdAt},
    #{createdBy}
  )
</insert>
```

Mapper:

```java
int insertUser(CreateUserCommand command);
```

Return `int` adalah jumlah row affected.

Untuk insert normal:

```text
expected rows affected = 1
```

Jika hasilnya 0, itu sangat tidak biasa untuk insert biasa. Jika >1, berarti statement bukan insert single-row biasa, misalnya `INSERT INTO ... SELECT ...`.

### 4.1 Generated Key dengan `useGeneratedKeys`

Untuk database yang mendukung JDBC generated keys:

```xml
<insert id="insertUser"
        parameterType="CreateUserCommand"
        useGeneratedKeys="true"
        keyProperty="id">
  INSERT INTO app_user (
    username,
    email,
    status,
    created_at
  ) VALUES (
    #{username},
    #{email},
    #{status},
    #{createdAt}
  )
</insert>
```

Command object:

```java
public class CreateUserCommand {
    private Long id;
    private String username;
    private String email;
    private String status;
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    // getters/setters lain
}
```

Mapper call:

```java
CreateUserCommand command = new CreateUserCommand();
command.setUsername("fajar");
command.setEmail("fajar@example.com");
command.setStatus("ACTIVE");
command.setCreatedAt(Instant.now());

int rows = userMapper.insertUser(command);
Long generatedId = command.getId();
```

Important mental model:

```text
Generated key biasanya tidak menjadi return value mapper.
Generated key diisi kembali ke parameter object melalui keyProperty.
Return int tetap rows affected.
```

### 4.2 Generated Key dengan `selectKey`

Untuk database berbasis sequence, seperti banyak desain Oracle legacy:

```xml
<insert id="insertUser" parameterType="CreateUserCommand">
  <selectKey keyProperty="id" resultType="long" order="BEFORE">
    SELECT app_user_seq.NEXTVAL FROM dual
  </selectKey>

  INSERT INTO app_user (
    id,
    username,
    email,
    status,
    created_at
  ) VALUES (
    #{id},
    #{username},
    #{email},
    #{status},
    #{createdAt}
  )
</insert>
```

Mental model:

```text
order="BEFORE"  -> ambil key dulu, lalu insert
order="AFTER"   -> insert dulu, lalu ambil key
```

Untuk sequence-driven ID, `BEFORE` sering lebih eksplisit.

### 4.3 Insert dengan Application-Generated ID

Di sistem modern, ID bisa dibuat oleh aplikasi:

```java
command.setId(UlidCreator.getUlid().toString());
```

SQL:

```xml
<insert id="insertCase" parameterType="CreateCaseCommand">
  INSERT INTO case_file (
    id,
    case_no,
    status,
    created_at
  ) VALUES (
    #{id},
    #{caseNo},
    #{status},
    #{createdAt}
  )
</insert>
```

Keuntungannya:

1. tidak bergantung generated key database,
2. ID tersedia sebelum insert,
3. memudahkan event/outbox correlation,
4. memudahkan distributed system flow.

Risikonya:

1. collision kalau generator buruk,
2. index locality bisa buruk untuk UUID random,
3. ordering semantik harus jelas.

### 4.4 Insert Idempotency

Dalam sistem enterprise, insert sering dipanggil dari retry mechanism. Jika retry terjadi setelah database commit tetapi sebelum response diterima caller, request bisa dikirim ulang.

Insert naive:

```sql
INSERT INTO payment_request (request_id, amount, status)
VALUES (#{requestId}, #{amount}, #{status})
```

Jika `requestId` unik, retry akan kena duplicate key.

Pertanyaan desain:

```text
Duplicate key itu error?
Atau tanda bahwa request sebelumnya sudah sukses?
```

Untuk idempotent create, kita bisa desain:

```text
ClientIdempotencyKey + unique constraint
```

Mapper:

```java
int insertPaymentRequest(CreatePaymentRequestCommand command);
PaymentRequestRow findByIdempotencyKey(IdempotencyKey key);
```

Service:

```java
try {
    int rows = mapper.insertPaymentRequest(command);
    requireOneRow(rows, "insert payment request");
    return mapper.findById(command.getId());
} catch (DuplicateKeyException duplicate) {
    return mapper.findByIdempotencyKey(command.idempotencyKey());
}
```

MyBatis statement sendiri tidak menyelesaikan idempotency. Ia hanya mengeksekusi SQL. Invariant idempotency harus didesain di service + database constraint + mapper contract.

---

## 5. Anatomy `<update>`

Contoh update biasa:

```xml
<update id="updateUserEmail" parameterType="UpdateUserEmailCommand">
  UPDATE app_user
  SET
    email = #{email},
    updated_at = #{updatedAt},
    updated_by = #{updatedBy}
  WHERE id = #{id}
</update>
```

Mapper:

```java
int updateUserEmail(UpdateUserEmailCommand command);
```

Return `int` adalah rows affected.

Untuk update by primary key:

```text
0 row -> not found, already deleted, tenant mismatch, or concurrency condition failed
1 row -> success
>1 row -> severe bug for single-entity update
```

### 5.1 Rows Affected sebagai Correctness Signal

Jangan abaikan return value update.

Buruk:

```java
userMapper.updateUserEmail(command);
return success();
```

Lebih baik:

```java
int rows = userMapper.updateUserEmail(command);
if (rows != 1) {
    throw new NotFoundException("User not found: " + command.getId());
}
```

Untuk update yang boleh 0 row, nama method harus jelas:

```java
int markExpiredSessions(Instant now);
```

Pada batch/status maintenance, 0 row mungkin normal.

Untuk single aggregate mutation, 0 row biasanya bukan normal.

### 5.2 Optimistic Locking Update

Update tanpa version:

```sql
UPDATE case_file
SET status = #{newStatus}
WHERE id = #{caseId}
```

Race condition:

```text
T1 reads status = DRAFT
T2 reads status = DRAFT
T1 updates to SUBMITTED
T2 updates to CANCELLED
T2 overwrites T1 silently
```

Optimistic update:

```xml
<update id="transitionCaseStatus" parameterType="TransitionCaseStatusCommand">
  UPDATE case_file
  SET
    status = #{newStatus},
    version = version + 1,
    updated_at = #{updatedAt},
    updated_by = #{updatedBy}
  WHERE id = #{caseId}
    AND version = #{expectedVersion}
    AND status = #{expectedCurrentStatus}
</update>
```

Mapper:

```java
int transitionCaseStatus(TransitionCaseStatusCommand command);
```

Service:

```java
int rows = caseMapper.transitionCaseStatus(command);
if (rows == 0) {
    throw new ConcurrentModificationException(
        "Case was modified or status is no longer " + command.getExpectedCurrentStatus()
    );
}
if (rows != 1) {
    throw new IllegalStateException("Unexpected transition row count: " + rows);
}
```

Mental model:

```text
WHERE clause is not only locator.
WHERE clause is invariant guard.
```

Top-tier MyBatis usage often puts business invariants into update predicate, not only into Java `if`.

### 5.3 State Transition Update

Untuk workflow/case management, hindari generic update status:

Buruk:

```java
int updateStatus(@Param("id") Long id, @Param("status") String status);
```

Karena method ini tidak menyatakan transisi yang legal.

Lebih baik:

```java
int submitDraftCase(SubmitCaseCommand command);
int approveSubmittedCase(ApproveCaseCommand command);
int rejectSubmittedCase(RejectCaseCommand command);
int closeApprovedCase(CloseCaseCommand command);
```

SQL:

```xml
<update id="submitDraftCase" parameterType="SubmitCaseCommand">
  UPDATE case_file
  SET
    status = 'SUBMITTED',
    submitted_at = #{submittedAt},
    submitted_by = #{submittedBy},
    version = version + 1
  WHERE id = #{caseId}
    AND status = 'DRAFT'
    AND version = #{expectedVersion}
</update>
```

Dengan desain ini, mapper menjadi bagian dari enforcement lifecycle model:

```text
Only DRAFT can become SUBMITTED.
Rows affected 0 means transition rejected by current database state.
```

### 5.4 Selective Update

Kadang hanya field non-null yang diupdate.

```xml
<update id="updateUserProfileSelective" parameterType="UpdateUserProfileCommand">
  UPDATE app_user_profile
  <set>
    <if test="displayName != null">
      display_name = #{displayName},
    </if>
    <if test="phoneNo != null">
      phone_no = #{phoneNo},
    </if>
    <if test="timezone != null">
      timezone = #{timezone},
    </if>
    updated_at = #{updatedAt},
    updated_by = #{updatedBy}
  </set>
  WHERE user_id = #{userId}
</update>
```

Selective update berguna, tetapi berbahaya jika command object tidak membedakan:

```text
field absent
field explicitly set to null
field set to value
```

Untuk API PATCH, tiga state itu berbeda. Java POJO biasa dengan nullable field tidak cukup untuk membedakan absent vs explicit null.

Strategi:

1. gunakan command object yang eksplisit,
2. gunakan wrapper seperti `OptionalField<T>` / custom tri-state,
3. pisahkan method untuk field penting,
4. hindari selective update untuk domain mutation yang punya invariant kuat.

---

## 6. Anatomy `<delete>`

Contoh hard delete:

```xml
<delete id="deleteUserById" parameterType="long">
  DELETE FROM app_user
  WHERE id = #{id}
</delete>
```

Mapper:

```java
int deleteUserById(long id);
```

Return `int` adalah rows affected.

Untuk delete by primary key:

```text
0 row -> not found / already deleted
1 row -> success
>1 row -> severe bug
```

### 6.1 Hard Delete vs Soft Delete

Dalam sistem enterprise/regulatory, hard delete sering tidak boleh dilakukan untuk business data penting.

Soft delete:

```xml
<update id="softDeleteUser" parameterType="SoftDeleteUserCommand">
  UPDATE app_user
  SET
    deleted = 1,
    deleted_at = #{deletedAt},
    deleted_by = #{deletedBy},
    version = version + 1
  WHERE id = #{id}
    AND deleted = 0
    AND version = #{expectedVersion}
</update>
```

Mengapa pakai `<update>`, bukan `<delete>`?

Karena operasi database-nya memang update. Nama method bisa tetap domain-oriented:

```java
int softDeleteUser(SoftDeleteUserCommand command);
```

Mental model:

```text
Business delete != SQL DELETE.
```

### 6.2 Delete dengan Tenant Scope

Buruk:

```sql
DELETE FROM document WHERE id = #{id}
```

Lebih aman:

```sql
DELETE FROM document
WHERE tenant_id = #{tenantId}
  AND id = #{id}
```

Untuk multi-tenant system, tenant predicate bukan optional. Ia bagian dari safety invariant.

### 6.3 Delete Child Rows

Hindari delete child rows tanpa parent scope.

Buruk:

```sql
DELETE FROM case_attachment
WHERE attachment_id = #{attachmentId}
```

Lebih aman:

```sql
DELETE FROM case_attachment
WHERE case_id = #{caseId}
  AND attachment_id = #{attachmentId}
```

Ini mencegah caller menghapus attachment milik aggregate lain hanya karena tahu ID-nya.

---

## 7. Statement Attributes yang Sering Diremehkan

Statement XML memiliki banyak atribut. Tidak semua perlu dipakai setiap hari, tetapi top-tier engineer tahu kapan atribut ini memengaruhi correctness/performance.

### 7.1 `id`

```xml
<select id="findById"> ... </select>
```

`id` adalah identity statement dalam namespace mapper.

Fully qualified statement id:

```text
com.example.user.UserMapper.findById
```

Jika mapper interface method tidak cocok dengan statement id, runtime akan gagal.

### 7.2 `parameterType`

```xml
<select id="findById" parameterType="long" resultMap="UserRowMap">
```

Dalam banyak mapper modern, `parameterType` bisa di-infer, terutama dengan mapper interface. Namun eksplisit kadang membantu readability.

Risiko terlalu bergantung pada parameterType:

1. refactor class bisa meleset,
2. multiple parameter dengan `@Param` tidak cocok dengan satu POJO,
3. Map parameter membuat contract kabur.

### 7.3 `resultType` vs `resultMap`

`resultType`:

```xml
<select id="findUsername" resultType="string">
  SELECT username FROM app_user WHERE id = #{id}
</select>
```

Cocok untuk scalar/simple mapping.

`resultMap`:

```xml
<select id="findById" resultMap="UserRowMap">
  SELECT id, username, email, status FROM app_user WHERE id = #{id}
</select>
```

Cocok untuk mapping yang ingin eksplisit.

Rule of thumb:

```text
Scalar/simple query -> resultType okay.
Business row/projection -> prefer resultMap.
Join/nested mapping -> resultMap mandatory in practice.
```

### 7.4 `statementType`

```xml
<select id="findById" statementType="PREPARED">
```

Pilihan umum:

```text
STATEMENT   -> raw Statement
PREPARED    -> PreparedStatement
CALLABLE    -> CallableStatement for stored procedures
```

Default biasanya `PREPARED`.

Untuk sebagian besar aplikasi:

```text
Use PREPARED.
```

Karena prepared statement mendukung parameter binding yang aman.

### 7.5 `timeout`

```xml
<select id="searchUsers" timeout="10" resultMap="UserRowMap">
```

Timeout membantu mencegah query menggantung terlalu lama.

Tetapi timeout bukan pengganti:

1. index yang benar,
2. pagination,
3. predicate yang selektif,
4. query plan review,
5. database resource governance.

### 7.6 `fetchSize`

```xml
<select id="scanAuditTrail" fetchSize="500" resultMap="AuditTrailRowMap">
```

`fetchSize` memberi hint kepada JDBC driver tentang jumlah row yang diambil per roundtrip.

Efeknya driver/vendor-specific.

Berguna untuk:

1. export besar,
2. reporting,
3. cursor scan,
4. batch processing read side.

Risiko:

1. terlalu kecil: banyak roundtrip,
2. terlalu besar: memory pressure,
3. driver mengabaikan setting,
4. behavior berbeda antar DB.

### 7.7 `flushCache` dan `useCache`

Select biasanya bisa menggunakan cache jika dikonfigurasi.

Write statement biasanya melakukan flush cache.

Mental model:

```text
DML changes data.
Cache containing old data becomes suspicious.
```

Untuk sistem enterprise yang mengutamakan correctness, jangan aktifkan second-level cache secara sembrono. Cache invalidation sulit, terutama jika data bisa berubah dari mapper lain, aplikasi lain, stored procedure, job, atau manual DBA script.

---

## 8. Return Type: Jangan Asal `void`

Mapper write method bisa `int`, `long`, `boolean`, atau `void` tergantung binding/framework, tetapi desain yang paling informatif biasanya `int`.

Buruk:

```java
void updateUserStatus(UpdateUserStatusCommand command);
```

Masalah:

```text
Caller tidak tahu apakah row benar-benar berubah.
```

Lebih baik:

```java
int updateUserStatus(UpdateUserStatusCommand command);
```

Lalu service memaknai:

```java
int rows = mapper.updateUserStatus(command);
if (rows != 1) {
    throw new OptimisticLockException("Status update failed");
}
```

### 8.1 Kapan `void` Masuk Akal?

Jarang. Mungkin untuk:

1. logging best-effort yang tidak penting,
2. statement yang selalu divalidasi di layer lain,
3. legacy mapper yang tidak bisa diubah.

Tetapi untuk domain mutation penting, `void` melemahkan correctness.

### 8.2 Boolean Return

`boolean` bisa menggoda:

```java
boolean updateIfVersionMatches(Command command);
```

Tetapi mapper MyBatis pada dasarnya mengembalikan row count. Mapping ke boolean menghilangkan informasi `>1` yang seharusnya dianggap bug.

Lebih aman:

```java
int updateIfVersionMatches(Command command);
```

Service:

```java
if (rows == 0) return false;
if (rows == 1) return true;
throw new IllegalStateException("Expected 0 or 1 row, got " + rows);
```

---

## 9. Rows Affected Semantics

Rows affected tidak selalu sama antar database/driver untuk beberapa kasus, terutama update yang menetapkan nilai yang sama.

Contoh:

```sql
UPDATE app_user
SET status = 'ACTIVE'
WHERE id = 100
  AND status = 'ACTIVE'
```

Sebagian database/driver bisa menghitung row matched, sebagian row changed, tergantung konfigurasi/vendor.

Karena itu, desain invariant sebaiknya jelas.

Jika ingin menandai transisi dari PENDING ke ACTIVE:

```sql
UPDATE app_user
SET status = 'ACTIVE'
WHERE id = #{id}
  AND status = 'PENDING'
```

Maka:

```text
0 row -> user tidak ada atau status bukan PENDING
1 row -> transisi terjadi
```

Ini lebih kuat daripada:

```sql
UPDATE app_user
SET status = 'ACTIVE'
WHERE id = #{id}
```

karena update kedua bisa “sukses” walaupun status sebelumnya sudah ACTIVE.

---

## 10. Pattern: Required Row vs Optional Row

### 10.1 Optional Select

Mapper:

```java
UserRow findById(long id);
```

Service:

```java
UserRow row = mapper.findById(id);
if (row == null) {
    return Optional.empty();
}
return Optional.of(row);
```

Atau mapper modern:

```java
Optional<UserRow> findOptionalById(long id);
```

Catatan: pastikan versi MyBatis dan konfigurasi mendukung pola yang dipakai di project.

### 10.2 Required Select

Jangan biarkan caller lupa check null.

```java
public UserRow getRequiredUser(long id) {
    UserRow row = mapper.findById(id);
    if (row == null) {
        throw new NotFoundException("User not found: " + id);
    }
    return row;
}
```

Nama method mapper bisa tetap `findById`, sedangkan service menyediakan `getRequiredUser`.

Atau mapper naming bisa eksplisit, tetapi mapper tidak bisa throw not found otomatis kecuali kita membungkusnya.

### 10.3 Required Update

Utility:

```java
static void requireExactlyOneRow(int rows, String operation) {
    if (rows != 1) {
        throw new IllegalStateException(operation + " expected 1 row, got " + rows);
    }
}
```

Untuk not found:

```java
static void requireOneRowOrNotFound(int rows, String resourceName, Object id) {
    if (rows == 0) {
        throw new NotFoundException(resourceName + " not found: " + id);
    }
    if (rows != 1) {
        throw new IllegalStateException("Expected 1 row for " + resourceName + ", got " + rows);
    }
}
```

---

## 11. Pattern: Insert and Return Object

Banyak developer ingin mapper insert langsung return object dengan ID.

Namun MyBatis insert umumnya return row count dan generated key ditulis ke parameter object.

Pattern yang jelas:

```java
@Transactional
public UserRow createUser(CreateUserCommand command) {
    command.setCreatedAt(clock.instant());

    int rows = userMapper.insertUser(command);
    requireExactlyOneRow(rows, "insert user");

    return userMapper.findById(command.getId());
}
```

Mengapa fetch lagi?

1. database default column mungkin terisi,
2. trigger mungkin mengisi field,
3. generated/computed column mungkin berubah,
4. canonical representation berasal dari DB.

Risiko fetch lagi:

1. tambahan roundtrip,
2. harus dalam transaction yang tepat,
3. jika trigger async, belum tentu terlihat.

Alternatif pada DB yang mendukung `RETURNING`:

```sql
INSERT ... RETURNING ...
```

Tetapi syntax ini vendor-specific dan perlu desain mapper khusus.

---

## 12. Pattern: Upsert/Merge

Upsert bukan operasi universal. Tiap database punya syntax berbeda:

```text
PostgreSQL -> INSERT ... ON CONFLICT ...
MySQL      -> INSERT ... ON DUPLICATE KEY UPDATE
Oracle     -> MERGE
SQL Server -> MERGE, tetapi punya caveat historis; banyak tim memilih pattern lain
```

Mapper MyBatis bisa mengeksekusi semuanya, tetapi portability tidak otomatis.

Prinsip:

```text
Jangan sembunyikan vendor-specific upsert seolah CRUD biasa.
```

Nama method harus mengungkap semantics:

```java
int insertOrUpdateUserPreference(UserPreferenceCommand command);
int mergeDailyStatistic(DailyStatisticMergeCommand command);
int insertIfAbsentIdempotencyKey(IdempotencyKeyCommand command);
```

Dan dokumentasikan expected row count.

Masalah upsert:

1. apakah created_at berubah saat update?
2. apakah updated_at berubah saat insert?
3. apakah version increment saat conflict?
4. apakah audit tahu ini insert atau update?
5. apakah caller perlu tahu operation actually inserted or updated?

Jika caller perlu tahu, plain `int` mungkin tidak cukup. Bisa perlu query lanjutan, `RETURNING`, atau database-specific output clause.

---

## 13. Pattern: Bulk Insert

Naive loop:

```java
for (CreateUserCommand command : commands) {
    userMapper.insertUser(command);
}
```

Masalah:

1. banyak roundtrip,
2. lambat,
3. transaction panjang,
4. error di tengah sulit dipulihkan.

Multi-row insert:

```xml
<insert id="insertUsers" parameterType="list">
  INSERT INTO app_user (id, username, email, status, created_at)
  VALUES
  <foreach collection="list" item="user" separator=",">
    (#{user.id}, #{user.username}, #{user.email}, #{user.status}, #{user.createdAt})
  </foreach>
</insert>
```

Mapper:

```java
int insertUsers(List<CreateUserCommand> users);
```

Risiko:

1. SQL terlalu panjang,
2. parameter limit database/driver,
3. generated key behavior kompleks,
4. satu row invalid menggagalkan seluruh statement,
5. memory pressure saat list besar.

Strategi:

```text
chunk size 100–1000, tergantung DB/driver/table/index
```

Untuk data besar, Part 16 akan membahas batch executor secara khusus.

---

## 14. Pattern: Bulk Update

Update banyak row dengan status sama:

```xml
<update id="expireSessions" parameterType="ExpireSessionCommand">
  UPDATE user_session
  SET
    status = 'EXPIRED',
    expired_at = #{now}
  WHERE status = 'ACTIVE'
    AND last_seen_at &lt; #{cutoff}
</update>
```

Return value bisa 0 sampai N.

Untuk bulk operation, service tidak boleh expect 1 row.

```java
int expired = sessionMapper.expireSessions(command);
log.info("Expired {} sessions", expired);
```

Bulk update dengan per-row value berbeda:

```sql
UPDATE app_user
SET status = CASE id
  WHEN ? THEN ?
  WHEN ? THEN ?
END
WHERE id IN (?, ?)
```

Ini mungkin efisien tetapi kompleks dan vendor/parameter-limit sensitive.

Jangan memaksakan satu statement jika readability, testing, dan error handling menjadi buruk.

---

## 15. Pattern: Soft Delete Visibility

Jika menggunakan soft delete, semua select aktif harus punya predicate:

```sql
WHERE deleted = 0
```

Tetapi mengulang manual di semua mapper rawan lupa.

Strategi:

1. naming jelas:
   - `findActiveById`
   - `findIncludingDeletedById`
2. SQL fragment:

```xml
<sql id="ActivePredicate">
  deleted = 0
</sql>
```

Usage:

```xml
<select id="findActiveById" resultMap="UserRowMap">
  SELECT id, username, email, status
  FROM app_user
  WHERE id = #{id}
    AND <include refid="ActivePredicate" />
</select>
```

Namun fragment juga bisa membuat query sulit dibaca jika terlalu banyak abstraction.

Prinsip:

```text
Reuse predicate yang benar-benar invariant.
Jangan abstraksikan SQL sampai kehilangan readability.
```

---

## 16. Pattern: Tenant-Aware Statement

Multi-tenant query harus scoped.

Buruk:

```xml
<select id="findCaseById" resultMap="CaseRowMap">
  SELECT id, case_no, status
  FROM case_file
  WHERE id = #{caseId}
</select>
```

Baik:

```xml
<select id="findCaseById" parameterType="CaseKey" resultMap="CaseRowMap">
  SELECT id, tenant_id, case_no, status
  FROM case_file
  WHERE tenant_id = #{tenantId}
    AND id = #{caseId}
</select>
```

Key object:

```java
public final class CaseKey {
    private final String tenantId;
    private final Long caseId;

    public CaseKey(String tenantId, Long caseId) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.caseId = Objects.requireNonNull(caseId);
    }

    public String getTenantId() { return tenantId; }
    public Long getCaseId() { return caseId; }
}
```

Top-tier rule:

```text
If row-level access depends on tenant/agency/module, the mapper input should make that scope explicit.
```

Jangan hanya mengandalkan service layer “pasti sudah check”. Persistence statement harus ikut membatasi blast radius.

---

## 17. XML vs Annotation untuk Statement Mapping

Annotation cocok untuk SQL kecil:

```java
@Select("SELECT id, username FROM app_user WHERE id = #{id}")
UserRow findById(long id);
```

Namun untuk SQL panjang:

```java
@Select({
    "SELECT ...",
    "FROM ...",
    "WHERE ..."
})
```

akan cepat sulit dibaca.

Rule of thumb:

| Case | Prefer |
|---|---|
| scalar query sangat kecil | annotation acceptable |
| CRUD sederhana internal tool | annotation acceptable |
| dynamic query | XML or Dynamic SQL library |
| complex join | XML |
| enterprise module mapper | XML |
| query perlu DBA review | XML |
| vendor-specific SQL panjang | XML |

XML bukan karena “lebih modern”, tetapi karena SQL butuh ruang untuk dibaca, direview, dan dikelola sebagai artifact.

---

## 18. Common Failure Model per Statement Type

### 18.1 SELECT Failure

| Failure | Cause | Prevention |
|---|---|---|
| too many results | method single result tapi SQL tidak unique | unique predicate + DB constraint |
| null unexpected | row not found | required wrapper in service |
| invalid column | schema changed | migration + mapper test |
| wrong data mapped | alias mismatch | explicit resultMap |
| slow query | missing index / bad predicate | execution plan review |
| memory spike | huge result list | pagination/cursor |
| tenant leak | missing scope predicate | tenant-aware key object |

### 18.2 INSERT Failure

| Failure | Cause | Prevention |
|---|---|---|
| duplicate key | id/idempotency conflict | unique handling strategy |
| generated key null | driver/config mismatch | test generated key per DB |
| not-null violation | command incomplete | validation before mapper |
| foreign key violation | parent missing | service invariant check |
| silent ignored key | wrong `keyProperty` | integration test |
| unexpected rows | insert-select/bulk ambiguity | document row count contract |

### 18.3 UPDATE Failure

| Failure | Cause | Prevention |
|---|---|---|
| 0 rows | not found / version mismatch / wrong status | interpret rows affected |
| >1 rows | missing unique predicate | key predicate + constraint |
| lost update | no version guard | optimistic locking |
| illegal transition | generic update status | state transition SQL |
| accidental null overwrite | full update with partial object | command discipline |
| slow update | no index on WHERE | index review |
| deadlock | inconsistent update order | ordering + retry policy |

### 18.4 DELETE Failure

| Failure | Cause | Prevention |
|---|---|---|
| accidental mass delete | missing WHERE | review + tests + safety guard |
| tenant data deleted | missing tenant predicate | tenant-aware delete |
| child orphan | FK not enforced | FK + cascade policy |
| audit violation | hard delete business data | soft delete/archive |
| 0 rows ambiguous | already deleted vs not found | method semantics |
| lock contention | deleting many rows | chunking/archive strategy |

---

## 19. Safety Rules for Statement Mapping

### Rule 1: Never Design Mutation Mapper Without Row Count Semantics

Every write mapper should define:

```text
Expected rows affected?
What does 0 mean?
What does >1 mean?
Should caller retry, ignore, or fail?
```

### Rule 2: WHERE Clause Carries Invariants

For update/delete, WHERE is not only locator:

```text
WHERE id = ?
```

is weaker than:

```text
WHERE tenant_id = ?
  AND id = ?
  AND status = ?
  AND version = ?
```

### Rule 3: Do Not Use `SELECT *`

Bad:

```sql
SELECT * FROM app_user
```

Why bad:

1. schema changes unexpectedly affect mapping,
2. hidden large columns may be loaded,
3. column order ambiguity,
4. join ambiguity,
5. harder review.

Good:

```sql
SELECT id, username, email, status, created_at
FROM app_user
```

### Rule 4: Do Not Hide Dangerous Dynamic SQL

A statement like:

```sql
ORDER BY ${sortColumn}
```

is dangerous unless `sortColumn` is whitelist-controlled.

This will be expanded in Part 5 and Part 8.

### Rule 5: Mapper Method Name Must Reveal Intent

Bad:

```java
int update(CaseRow row);
```

Good:

```java
int assignCaseOfficer(AssignCaseOfficerCommand command);
int submitCase(SubmitCaseCommand command);
int markCaseAsDormant(MarkCaseDormantCommand command);
```

### Rule 6: Separate Read Projection from Mutation Command

Do not reuse same object for everything.

Bad:

```java
CaseDto dto = mapper.findById(id);
mapper.updateCase(dto);
```

Better:

```java
CaseDetailRow row = mapper.findDetailById(key);
UpdateCaseDecisionCommand command = new UpdateCaseDecisionCommand(...);
mapper.updateCaseDecision(command);
```

### Rule 7: Use Database Constraint as Final Guard

Mapper SQL can express intent, but database constraint enforces truth.

Examples:

1. unique constraint for natural key,
2. foreign key for parent-child,
3. check constraint for status values,
4. not-null constraint for required fields,
5. version column for optimistic update convention.

---

## 20. Mini Case Study: Case Assignment Mapper

Scenario:

```text
A regulatory case can be assigned to an officer only if:
- case belongs to tenant/agency
- case exists
- case is not closed
- case is currently unassigned
- caller has expected version
```

Command:

```java
public class AssignCaseOfficerCommand {
    private String tenantId;
    private Long caseId;
    private String officerUserId;
    private Long expectedVersion;
    private Instant assignedAt;
    private String assignedBy;

    // getters/setters
}
```

Mapper:

```java
public interface CaseAssignmentMapper {
    int assignOfficer(AssignCaseOfficerCommand command);
    CaseAssignmentRow findAssignmentByCaseId(CaseKey key);
}
```

XML:

```xml
<update id="assignOfficer" parameterType="AssignCaseOfficerCommand">
  UPDATE case_file
  SET
    assigned_officer_id = #{officerUserId},
    assigned_at = #{assignedAt},
    assigned_by = #{assignedBy},
    version = version + 1,
    updated_at = #{assignedAt},
    updated_by = #{assignedBy}
  WHERE tenant_id = #{tenantId}
    AND id = #{caseId}
    AND status NOT IN ('CLOSED', 'CANCELLED')
    AND assigned_officer_id IS NULL
    AND version = #{expectedVersion}
</update>
```

Service interpretation:

```java
int rows = mapper.assignOfficer(command);

if (rows == 1) {
    return mapper.findAssignmentByCaseId(new CaseKey(command.getTenantId(), command.getCaseId()));
}

if (rows == 0) {
    throw new AssignmentRejectedException(
        "Case is not assignable: not found, closed, already assigned, or modified concurrently"
    );
}

throw new IllegalStateException("assignOfficer affected unexpected rows: " + rows);
```

Notice the statement does not merely update a column. It encodes concurrency and workflow constraints.

This is a good MyBatis design because:

1. SQL remains explicit,
2. business invariant appears in WHERE clause,
3. caller gets deterministic signal,
4. tenant scope is enforced,
5. optimistic locking is enforced,
6. service can produce meaningful domain error.

---

## 21. Mini Case Study: Idempotent External Event Insert

Scenario:

```text
System receives event from external agency.
Same event may be delivered multiple times.
We must process it once.
```

Table invariant:

```sql
UNIQUE(source_system, external_event_id)
```

Command:

```java
public class InsertExternalEventCommand {
    private String sourceSystem;
    private String externalEventId;
    private String payloadHash;
    private String status;
    private Instant receivedAt;
}
```

Mapper:

```java
int insertExternalEvent(InsertExternalEventCommand command);
ExternalEventRow findByNaturalKey(ExternalEventKey key);
```

XML:

```xml
<insert id="insertExternalEvent" parameterType="InsertExternalEventCommand">
  INSERT INTO external_event (
    source_system,
    external_event_id,
    payload_hash,
    status,
    received_at
  ) VALUES (
    #{sourceSystem},
    #{externalEventId},
    #{payloadHash},
    #{status},
    #{receivedAt}
  )
</insert>
```

Service:

```java
try {
    int rows = mapper.insertExternalEvent(command);
    requireExactlyOneRow(rows, "insert external event");
    return EventInsertResult.inserted();
} catch (DuplicateKeyException duplicate) {
    ExternalEventRow existing = mapper.findByNaturalKey(command.toKey());
    if (!existing.getPayloadHash().equals(command.getPayloadHash())) {
        throw new IdempotencyConflictException("Same event id with different payload");
    }
    return EventInsertResult.alreadyProcessed();
}
```

Key lesson:

```text
INSERT correctness often depends on unique constraints and duplicate handling strategy, not only SQL syntax.
```

---

## 22. MyBatis Statement Design Checklist

Before merging a mapper statement, ask:

### For All Statements

```text
[ ] Is the mapper method name intention-revealing?
[ ] Is the parameter object explicit?
[ ] Are column names explicit, not SELECT *?
[ ] Are tenant/security predicates included where needed?
[ ] Is SQL readable without mentally executing too much dynamic logic?
[ ] Is there a mapper/integration test?
[ ] Is the expected result/row count documented?
[ ] Are null semantics clear?
[ ] Are database-specific assumptions visible?
```

### For SELECT

```text
[ ] If return single object, is predicate unique?
[ ] If return list, is order deterministic where needed?
[ ] Is pagination required?
[ ] Are large columns intentionally selected?
[ ] Is resultMap explicit enough?
[ ] Can this query leak tenant/agency data?
[ ] Can this query create N+1 behavior?
```

### For INSERT

```text
[ ] Is ID strategy clear: DB-generated, sequence, or application-generated?
[ ] If generated key is needed, is keyProperty tested?
[ ] Is duplicate key behavior understood?
[ ] Is idempotency required?
[ ] Are audit columns populated?
[ ] Are not-null fields validated before mapper call?
```

### For UPDATE

```text
[ ] Is row count checked?
[ ] Does WHERE include version/status guard if needed?
[ ] Can this cause lost update?
[ ] Can this update more rows than intended?
[ ] Does method name reflect business transition?
[ ] Are updated_at/updated_by handled consistently?
[ ] Does selective update distinguish absent vs explicit null?
```

### For DELETE

```text
[ ] Is hard delete legally/business-wise acceptable?
[ ] Should this be soft delete instead?
[ ] Is tenant/parent scope included?
[ ] Is row count checked?
[ ] Are child rows/FK/cascade implications understood?
[ ] Is audit/archive requirement satisfied?
```

---

## 23. Anti-Patterns

### Anti-Pattern 1: Generic CRUD Mapper Everywhere

```java
int insert(Map<String, Object> values);
int update(Map<String, Object> values);
int delete(Long id);
Map<String, Object> select(Long id);
```

This destroys type safety and intent.

### Anti-Pattern 2: Ignoring Rows Affected

```java
mapper.update(command);
return true;
```

This hides not found, concurrency failure, and illegal transition.

### Anti-Pattern 3: One Giant `save` Method

```java
int save(UserDto dto);
```

Does it insert? update? upsert? replace? partial update? It is unclear.

### Anti-Pattern 4: `SELECT *`

Causes mapping fragility and accidental heavy reads.

### Anti-Pattern 5: Business Mutation by Generic Column Update

```java
int updateStatus(Long id, String status);
```

This bypasses transition rules.

### Anti-Pattern 6: Dynamic Table/Column from User Input

```sql
ORDER BY ${sort}
```

Unsafe unless whitelisted.

### Anti-Pattern 7: Soft Delete Without Read Discipline

Soft delete only works if all active reads consistently exclude deleted rows.

### Anti-Pattern 8: Mapper Returning Domain Entity for Every Query

Different use cases need different projections. Do not load full object when listing only needs 5 columns.

---

## 24. Java 8–25 Considerations

The SQL mapping concepts are stable across Java versions, but object design changes.

### Java 8 Compatible

Use POJO command/result classes:

```java
public class UserRow {
    private Long id;
    private String username;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
}
```

Works well for:

1. generated key mutation via setter,
2. classic MyBatis mapping,
3. Spring Boot 2.x legacy.

### Java 16+ Records

Records are good for immutable read projections:

```java
public record UserSummaryRow(
    Long id,
    String username,
    String status
) {}
```

But command objects that need generated key filled after insert may still be easier as mutable POJO.

### Java 21/25 Modern Style

You can use:

1. records for query result,
2. sealed types for domain command variants,
3. pattern matching in service interpretation,
4. virtual threads for request concurrency, with caution that DB connection pool remains limiting resource.

But mapper statement semantics remain the same:

```text
SQL + parameter + result mapping + row count + transaction.
```

Do not mistake modern Java syntax for stronger persistence correctness. Correctness still comes from database constraints, SQL predicates, transaction design, and row count interpretation.

---

## 25. Summary Mental Model

The deepest lesson of Part 4:

```text
A MyBatis statement is a state/data contract.
```

For `SELECT`:

```text
What facts are we allowed to read?
How many rows are valid?
How are columns mapped?
Is the result bounded and scoped?
```

For `INSERT`:

```text
What fact are we creating?
Who owns the ID?
What prevents duplicates?
How do we handle retry?
What does generated key mean?
```

For `UPDATE`:

```text
What state transition is legal?
What invariant is guarded in WHERE?
What does 0 rows mean?
What prevents lost update?
```

For `DELETE`:

```text
Are we physically deleting or business-deleting?
What scope prevents accidental deletion?
What audit/legal consequence exists?
```

Top 1% engineering with MyBatis is not about writing clever XML. It is about making every SQL statement carry explicit, testable, observable, and safe semantics.

---

## 26. Practical Exercise

Design mapper statements for a `case_file` table:

```text
case_file(
  id,
  tenant_id,
  case_no,
  status,
  assigned_officer_id,
  version,
  created_at,
  created_by,
  updated_at,
  updated_by,
  deleted
)
```

Create:

1. `findActiveCaseById(CaseKey key)`
2. `insertCase(CreateCaseCommand command)`
3. `submitDraftCase(SubmitCaseCommand command)`
4. `assignOfficer(AssignCaseOfficerCommand command)`
5. `softDeleteDraftCase(SoftDeleteCaseCommand command)`

For each statement define:

```text
expected row count
meaning of 0 row
meaning of >1 row
tenant predicate
version/status guard
audit fields
required database constraints/indexes
```

If you can answer those clearly, you are no longer thinking of MyBatis as CRUD. You are thinking of it as a persistence correctness layer.

---

## 27. References

- MyBatis 3 Official Documentation — Introduction: https://mybatis.org/mybatis-3/
- MyBatis 3 Official Documentation — Mapper XML Files: https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis 3 Official Documentation — Java API: https://mybatis.org/mybatis-3/java-api.html
- MyBatis 3 Official Documentation — Dynamic SQL XML: https://mybatis.org/mybatis-3/dynamic-sql.html
- MyBatis-Spring Official Documentation: https://mybatis.org/spring/
- MyBatis Dynamic SQL Documentation — Insert Statements: https://mybatis.org/mybatis-dynamic-sql/docs/insert.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 3 — Mapper Design: Interface, XML, Annotation, and Naming Discipline](./03-mapper-design-interface-xml-annotation-and-naming-discipline.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 5 — Parameter Binding: `#{}`, `${}`, TypeHandler, and SQL Injection Boundary](./05-parameter-binding-placeholder-typehandler-and-sql-injection-boundary.md)

</div>