# Part 8 — Dynamic SQL XML: `if`, `choose`, `where`, `set`, `trim`, `foreach`

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `08-dynamic-sql-xml-if-choose-where-set-trim-foreach.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: Dynamic SQL berbasis XML MyBatis untuk query/update yang berubah mengikuti input, tetapi tetap aman, readable, testable, dan production-grade.

---

## 0. Posisi Bagian Ini dalam Seri

Sebelumnya kita sudah membahas:

- Part 0: mental model MyBatis sebagai SQL-first persistence framework.
- Part 1: runtime architecture, `SqlSession`, `Executor`, `MappedStatement`, `BoundSql`.
- Part 2: strategi Java 8 sampai 25 dan kompatibilitas versi.
- Part 3: desain mapper interface/XML/naming.
- Part 4: statement mapping `select`, `insert`, `update`, `delete`.
- Part 5: parameter binding, `#{}` vs `${}`, SQL injection boundary, `TypeHandler`.
- Part 6: result mapping dasar.
- Part 7: advanced result mapping.

Bagian ini fokus pada **dynamic SQL XML**, yaitu kemampuan MyBatis untuk menyusun SQL berdasarkan kondisi runtime menggunakan tag XML seperti:

- `<if>`
- `<choose>`, `<when>`, `<otherwise>`
- `<where>`
- `<set>`
- `<trim>`
- `<foreach>`
- `<bind>`
- `<sql>` dan `<include>` sebagai reusable fragment pendukung

Materi ini tidak akan mengulang pembahasan parameter binding secara umum dari Part 5. Di sini kita fokus pada **bagaimana SQL berubah bentuk**, bagaimana menjaganya tetap aman, dan bagaimana membuatnya bisa diuji.

---

## 1. Mental Model Dynamic SQL

Dynamic SQL adalah SQL yang **struktur teksnya berubah** berdasarkan input.

Contoh sederhana:

```sql
SELECT id, name, status
FROM users
WHERE status = ?
```

Namun di aplikasi nyata, search screen biasanya punya filter opsional:

- status mungkin ada atau tidak.
- keyword mungkin ada atau tidak.
- tanggal mulai mungkin ada atau tidak.
- tenant/agency wajib ada.
- sorting mungkin berubah.
- pagination wajib stabil.

Tanpa dynamic SQL, developer sering jatuh ke string concatenation seperti ini:

```java
String sql = "SELECT * FROM users WHERE 1=1";

if (status != null) {
    sql += " AND status = '" + status + "'";
}

if (keyword != null) {
    sql += " AND name LIKE '%" + keyword + "%'";
}
```

Masalahnya:

1. Rawan SQL injection.
2. Rawan lupa spasi.
3. Rawan lupa `AND`/`,`.
4. Rawan query plan tidak stabil.
5. Sulit dites.
6. SQL tersebar di Java string.
7. Sulit direview oleh DBA atau reviewer.

MyBatis Dynamic SQL XML mencoba memberi struktur:

```xml
<select id="searchUsers" parameterType="UserSearchCriteria" resultMap="UserRowMap">
  SELECT
    id,
    username,
    status,
    created_at
  FROM app_user
  <where>
    tenant_id = #{tenantId}

    <if test="status != null">
      AND status = #{status}
    </if>

    <if test="keyword != null and keyword != ''">
      AND UPPER(username) LIKE UPPER(#{keywordLike})
    </if>
  </where>
</select>
```

Mental model-nya:

```text
Mapper method input
        |
        v
OGNL expression evaluates condition
        |
        v
XML dynamic tags include/exclude SQL text
        |
        v
Final SQL text + parameter mappings become BoundSql
        |
        v
PreparedStatement executes with bound parameters
```

Dynamic SQL bukan berarti parameter binding hilang. Dynamic SQL hanya menentukan **bagian SQL mana yang ikut masuk**. Nilai data tetap harus memakai `#{}` agar menjadi prepared statement parameter.

---

## 2. Prinsip Utama: Dynamic SQL Mengubah Struktur, `#{}` Mengikat Data

Ada dua jenis variasi dalam query:

| Jenis variasi | Contoh | Teknik aman |
|---|---|---|
| Nilai data berubah | `status = ?`, `created_at >= ?` | `#{}` |
| Struktur SQL berubah | filter opsional, optional join, dynamic set clause | dynamic tag XML |
| Identifier berubah | sort column, table partition, schema | whitelist manual, bukan input bebas |
| Operator berubah | `=`, `>=`, `LIKE`, `IN` | controlled enum/branch |
| Jumlah parameter berubah | `IN (...)` | `<foreach>` |

Contoh aman:

```xml
<if test="status != null">
  AND status = #{status}
</if>
```

Contoh berbahaya:

```xml
<if test="status != null">
  AND status = '${status}'
</if>
```

Contoh paling berbahaya:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Yang benar untuk dynamic identifier adalah whitelist:

```xml
<choose>
  <when test="sortBy == 'CREATED_AT'">
    ORDER BY created_at
  </when>
  <when test="sortBy == 'USERNAME'">
    ORDER BY username
  </when>
  <otherwise>
    ORDER BY id
  </otherwise>
</choose>

<choose>
  <when test="sortDirection == 'ASC'">
    ASC
  </when>
  <otherwise>
    DESC
  </otherwise>
</choose>
```

Atau lebih baik, mapping dilakukan di Java sebelum masuk mapper:

```java
public enum UserSortField {
    CREATED_AT("created_at"),
    USERNAME("username"),
    ID("id");

    private final String sqlColumn;

    UserSortField(String sqlColumn) {
        this.sqlColumn = sqlColumn;
    }

    public String sqlColumn() {
        return sqlColumn;
    }
}
```

Tetapi meskipun enum menyediakan SQL fragment, tetap jangan langsung memasukkan input user mentah ke `${}`. Pastikan nilai enum hanya berasal dari parsing/whitelist yang controlled.

---

## 3. OGNL dalam MyBatis Dynamic SQL

MyBatis memakai OGNL expression pada atribut `test`.

Contoh:

```xml
<if test="status != null">
  AND status = #{status}
</if>
```

```xml
<if test="keyword != null and keyword != ''">
  AND username LIKE #{keywordLike}
</if>
```

```xml
<if test="ids != null and ids.size() > 0">
  AND id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
</if>
```

OGNL bisa membaca:

- property object: `status`, `criteria.status`.
- method sederhana: `ids.size()`.
- nested property: `dateRange.start`.
- boolean property: `includeInactive`.
- logical operator: `and`, `or`, `!`.

Namun dynamic SQL XML akan cepat sulit dibaca jika expression terlalu pintar.

Buruk:

```xml
<if test="keyword != null and keyword.trim() != '' and (status == null or status.name() != 'DELETED') and currentUser != null and currentUser.roles.contains('ADMIN')">
  ...
</if>
```

Lebih baik:

```java
public final class UserSearchCriteria {
    private final String keywordLike;
    private final boolean includeKeywordFilter;
    private final boolean adminScope;

    public boolean hasKeywordFilter() {
        return includeKeywordFilter;
    }

    public boolean isAdminScope() {
        return adminScope;
    }
}
```

```xml
<if test="hasKeywordFilter()">
  AND UPPER(username) LIKE UPPER(#{keywordLike})
</if>

<if test="adminScope">
  AND visibility IN ('PUBLIC', 'INTERNAL')
</if>
```

Prinsipnya:

```text
Complex business decision belongs in Java.
Simple SQL inclusion decision can live in XML.
```

---

## 4. `<if>`: Conditional SQL Fragment

`<if>` adalah tag paling dasar.

### 4.1 Basic Optional Filter

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at
  FROM case_file c
  <where>
    c.tenant_id = #{tenantId}

    <if test="status != null">
      AND c.status = #{status}
    </if>

    <if test="createdFrom != null">
      AND c.created_at &gt;= #{createdFrom}
    </if>

    <if test="createdToExclusive != null">
      AND c.created_at &lt; #{createdToExclusive}
    </if>
  </where>
</select>
```

Catatan XML:

- Gunakan `&gt;` untuk `>`.
- Gunakan `&lt;` untuk `<`.
- Untuk readability, bisa pakai CDATA jika query kompleks, tetapi jangan berlebihan.

### 4.2 Optional Keyword Search

Buruk:

```xml
<if test="keyword != null and keyword != ''">
  AND c.case_no LIKE '%' || #{keyword} || '%'
</if>
```

Masalah:

- Vendor-specific concatenation.
- Wildcard logic tersebar di SQL.
- Bisa salah escaping `%` dan `_`.

Lebih baik parameter object menyiapkan value:

```java
public final class CaseSearchCriteria {
    private final String keyword;
    private final String keywordLike;

    public CaseSearchCriteria(String keyword) {
        this.keyword = normalize(keyword);
        this.keywordLike = this.keyword == null ? null : "%" + escapeLike(this.keyword) + "%";
    }

    public boolean hasKeyword() {
        return keywordLike != null;
    }

    public String getKeywordLike() {
        return keywordLike;
    }
}
```

```xml
<if test="hasKeyword()">
  AND (
    UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\'
    OR UPPER(c.subject) LIKE UPPER(#{keywordLike}) ESCAPE '\'
  )
</if>
```

### 4.3 Optional Join

Kadang join hanya dibutuhkan jika filter tertentu aktif.

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at
  FROM case_file c

  <if test="officerId != null">
    JOIN case_assignment ca
      ON ca.case_id = c.id
     AND ca.active = 1
  </if>

  <where>
    c.tenant_id = #{tenantId}

    <if test="officerId != null">
      AND ca.officer_id = #{officerId}
    </if>
  </where>
</select>
```

Ini valid, tetapi harus hati-hati:

- Jika join conditional mempengaruhi cardinality, pagination bisa berubah.
- Jika optional join menambah duplicate row, wajib `DISTINCT` atau query design lain.
- Jika join hanya untuk existence, pertimbangkan `EXISTS`.

Alternatif yang sering lebih stabil:

```xml
<if test="officerId != null">
  AND EXISTS (
    SELECT 1
    FROM case_assignment ca
    WHERE ca.case_id = c.id
      AND ca.active = 1
      AND ca.officer_id = #{officerId}
  )
</if>
```

---

## 5. `<where>`: Safe WHERE Builder

Masalah umum dynamic `WHERE`:

```xml
WHERE
<if test="status != null">
  AND status = #{status}
</if>
```

Jika `status == null`, hasilnya bisa menjadi:

```sql
WHERE
```

Atau jika kondisi pertama aktif:

```sql
WHERE AND status = ?
```

`<where>` membantu dengan dua hal:

1. Menambahkan `WHERE` hanya jika ada isi.
2. Menghapus leading `AND`/`OR` yang tidak valid.

Contoh:

```xml
<where>
  <if test="status != null">
    AND status = #{status}
  </if>

  <if test="createdFrom != null">
    AND created_at &gt;= #{createdFrom}
  </if>
</where>
```

Jika hanya `status` aktif:

```sql
WHERE status = ?
```

Jika tidak ada filter aktif:

```sql
-- no WHERE generated
```

### 5.1 Jangan Mengandalkan `<where>` untuk Mandatory Scope

Untuk enterprise system, biasanya ada mandatory filter seperti:

- tenant id.
- agency id.
- soft delete flag.
- authorization scope.

Jangan jadikan semuanya optional.

Buruk:

```xml
<where>
  <if test="tenantId != null">
    AND tenant_id = #{tenantId}
  </if>
  <if test="status != null">
    AND status = #{status}
  </if>
</where>
```

Jika `tenantId` null, query bisa bocor lintas tenant.

Lebih baik:

```xml
<where>
  tenant_id = #{tenantId}
  AND deleted = 0

  <if test="status != null">
    AND status = #{status}
  </if>
</where>
```

Lalu validasi `tenantId` di Java sebelum mapper dipanggil.

### 5.2 `WHERE 1=1` vs `<where>`

Pattern lama:

```xml
WHERE 1 = 1
<if test="status != null">
  AND status = #{status}
</if>
```

Ini bekerja, tetapi kurang bersih. Dengan MyBatis, prefer:

```xml
<where>
  tenant_id = #{tenantId}
  <if test="status != null">
    AND status = #{status}
  </if>
</where>
```

Namun untuk query generator lintas framework, `WHERE 1=1` masih bisa ditemui. Dalam MyBatis XML, `<where>` biasanya lebih idiomatis.

---

## 6. `<choose>`, `<when>`, `<otherwise>`: Controlled Branching

`<choose>` mirip `if/else if/else`. Gunakan ketika hanya boleh satu branch aktif.

### 6.1 Search Mode

Misalnya pencarian case bisa berdasarkan:

- exact case number.
- applicant id.
- keyword general.

Jika semua memakai `<if>`, query bisa terlalu luas/aneh.

```xml
<choose>
  <when test="caseNo != null and caseNo != ''">
    AND c.case_no = #{caseNo}
  </when>
  <when test="applicantId != null">
    AND c.applicant_id = #{applicantId}
  </when>
  <when test="keywordLike != null">
    AND (
      UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\'
      OR UPPER(c.subject) LIKE UPPER(#{keywordLike}) ESCAPE '\'
    )
  </when>
  <otherwise>
    AND c.created_at &gt;= #{defaultCreatedFrom}
  </otherwise>
</choose>
```

Ini membuat contract jelas:

```text
Only one primary search mode is active.
```

### 6.2 Authorization Branch

```xml
<choose>
  <when test="scope == 'OWNED'">
    AND c.owner_user_id = #{currentUserId}
  </when>
  <when test="scope == 'TEAM'">
    AND c.team_id IN
    <foreach collection="teamIds" item="teamId" open="(" separator="," close=")">
      #{teamId}
    </foreach>
  </when>
  <when test="scope == 'AGENCY'">
    AND c.agency_id = #{agencyId}
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

`otherwise AND 1 = 0` adalah defensive fallback agar unknown scope tidak menghasilkan query terlalu luas.

Namun jangan hanya mengandalkan XML. Scope juga harus divalidasi di service layer.

### 6.3 Dynamic Vendor Behavior

Kadang syntax pagination/locking berbeda per database.

```xml
<choose>
  <when test="databaseVendor == 'ORACLE'">
    FETCH FIRST #{limit} ROWS ONLY
  </when>
  <when test="databaseVendor == 'POSTGRESQL'">
    LIMIT #{limit}
  </when>
  <otherwise>
    LIMIT #{limit}
  </otherwise>
</choose>
```

Untuk kasus vendor, MyBatis juga punya `databaseIdProvider`, tetapi jika perbedaan kecil, branch bisa dipertimbangkan. Untuk perbedaan besar, lebih baik statement terpisah atau mapper terpisah.

---

## 7. `<set>`: Safe Dynamic UPDATE Clause

Masalah dynamic update:

```xml
UPDATE user
SET
<if test="email != null">
  email = #{email},
</if>
<if test="displayName != null">
  display_name = #{displayName},
</if>
WHERE id = #{id}
```

Jika trailing comma tidak dihapus, SQL invalid.

`<set>` membantu:

1. Menambahkan `SET`.
2. Menghapus trailing comma.

```xml
<update id="updateUserProfile" parameterType="UpdateUserProfileCommand">
  UPDATE app_user
  <set>
    <if test="email != null">
      email = #{email},
    </if>
    <if test="displayName != null">
      display_name = #{displayName},
    </if>
    updated_at = #{updatedAt},
    updated_by = #{updatedBy}
  </set>
  WHERE id = #{id}
    AND tenant_id = #{tenantId}
</update>
```

### 7.1 The Empty SET Problem

Jika semua field optional null dan tidak ada mandatory audit field, hasil bisa invalid.

Buruk:

```xml
<update id="patchUser" parameterType="PatchUserCommand">
  UPDATE app_user
  <set>
    <if test="email != null">
      email = #{email},
    </if>
    <if test="displayName != null">
      display_name = #{displayName},
    </if>
  </set>
  WHERE id = #{id}
</update>
```

Jika tidak ada field aktif, query jadi:

```sql
UPDATE app_user WHERE id = ?
```

Solusi:

1. Validasi di Java: minimal satu field harus berubah.
2. Tambahkan mandatory audit update jika memang benar.
3. Buat method spesifik, bukan generic patch.

Contoh Java guard:

```java
public final class PatchUserCommand {
    private final Long id;
    private final OptionalField<String> email;
    private final OptionalField<String> displayName;

    public boolean hasAnyPatchField() {
        return email.isPresent() || displayName.isPresent();
    }
}
```

Service:

```java
if (!command.hasAnyPatchField()) {
    throw new IllegalArgumentException("At least one patch field is required");
}

int updated = userMapper.patchUser(command);
```

### 7.2 Null Semantics: Absent vs Explicit Null

Dynamic update sering salah karena `null` punya dua arti:

```text
null because field is absent
null because user wants to clear field
```

Jika XML hanya memakai:

```xml
<if test="email != null">
  email = #{email},
</if>
```

Maka tidak ada cara untuk set `email = NULL`.

Solusi desain:

#### Option A — Command spesifik

```xml
<update id="clearUserEmail">
  UPDATE app_user
  SET email = NULL,
      updated_at = #{updatedAt},
      updated_by = #{updatedBy}
  WHERE id = #{id}
    AND tenant_id = #{tenantId}
</update>
```

#### Option B — OptionalField wrapper

```java
public final class OptionalField<T> {
    private final boolean present;
    private final T value;

    public boolean isPresent() {
        return present;
    }

    public T getValue() {
        return value;
    }
}
```

XML:

```xml
<if test="email.present">
  email = #{email.value,jdbcType=VARCHAR},
</if>
```

Dengan begitu:

- absent: tidak update column.
- present + value: update ke value.
- present + null: update ke NULL.

---

## 8. `<trim>`: General-Purpose Prefix/Suffix Cleaner

`<where>` dan `<set>` sebenarnya adalah special case dari `<trim>`.

`<trim>` berguna ketika kita butuh kontrol lebih spesifik.

### 8.1 Reimplement `<where>` dengan `<trim>`

```xml
<trim prefix="WHERE" prefixOverrides="AND |OR ">
  <if test="status != null">
    AND status = #{status}
  </if>
</trim>
```

### 8.2 Reimplement `<set>` dengan `<trim>`

```xml
<trim prefix="SET" suffixOverrides=",">
  <if test="email != null">
    email = #{email},
  </if>
</trim>
```

### 8.3 Dynamic Parenthesized Predicate

```xml
<trim prefix="AND (" suffix=")" prefixOverrides="OR ">
  <if test="searchCaseNo">
    OR UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\'
  </if>
  <if test="searchSubject">
    OR UPPER(c.subject) LIKE UPPER(#{keywordLike}) ESCAPE '\'
  </if>
  <if test="searchApplicantName">
    OR UPPER(a.name) LIKE UPPER(#{keywordLike}) ESCAPE '\'
  </if>
</trim>
```

Hasil jika `searchCaseNo` dan `searchSubject` aktif:

```sql
AND (
  UPPER(c.case_no) LIKE UPPER(?) ESCAPE '\'
  OR UPPER(c.subject) LIKE UPPER(?) ESCAPE '\'
)
```

### 8.4 Dynamic Insert Columns and Values

Selective insert kadang memakai `<trim>`:

```xml
<insert id="insertUserSelective" parameterType="CreateUserCommand">
  INSERT INTO app_user
  <trim prefix="(" suffix=")" suffixOverrides=",">
    id,
    username,
    <if test="email != null">email,</if>
    status,
    created_at,
    created_by,
  </trim>
  VALUES
  <trim prefix="(" suffix=")" suffixOverrides=",">
    #{id},
    #{username},
    <if test="email != null">#{email},</if>
    #{status},
    #{createdAt},
    #{createdBy},
  </trim>
</insert>
```

Risiko: kolom dan value harus selalu sinkron. Untuk insert command besar, lebih aman explicit insert dengan default value di Java atau DB.

---

## 9. `<foreach>`: Collection Expansion

`<foreach>` digunakan untuk membuat SQL fragment dari collection.

Paling umum: `IN` clause.

```xml
<if test="ids != null and ids.size() > 0">
  AND id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
</if>
```

### 9.1 Collection Name Rules

Jika mapper method menerima satu parameter object:

```java
List<UserRow> findByIds(FindUsersByIdsQuery query);
```

XML:

```xml
<foreach collection="ids" item="id" open="(" separator="," close=")">
  #{id}
</foreach>
```

Jika mapper method menerima parameter langsung:

```java
List<UserRow> findByIds(@Param("ids") List<Long> ids);
```

XML:

```xml
<foreach collection="ids" item="id" open="(" separator="," close=")">
  #{id}
</foreach>
```

Tanpa `@Param`, nama bisa menjadi `list`, `collection`, atau compiler-dependent. Dalam codebase besar, gunakan `@Param` atau parameter object agar eksplisit.

### 9.2 Empty List Semantics

Ini sangat penting.

Jika `ids` kosong, apa hasil yang benar?

Ada beberapa kemungkinan:

| Meaning | Behavior |
|---|---|
| Empty list means no filter | jangan tambahkan predicate |
| Empty list means no rows should match | tambahkan `AND 1 = 0` |
| Empty list invalid input | reject di service |

Contoh no rows:

```xml
<choose>
  <when test="ids != null and ids.size() > 0">
    AND id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
      #{id}
    </foreach>
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

Untuk access control, empty list hampir selalu harus berarti `AND 1 = 0`, bukan no filter.

Contoh team scope:

```xml
<choose>
  <when test="teamIds != null and teamIds.size() > 0">
    AND c.team_id IN
    <foreach collection="teamIds" item="teamId" open="(" separator="," close=")">
      #{teamId}
    </foreach>
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

Jika tidak, user tanpa team bisa melihat semua data.

### 9.3 Large IN Clause Problem

`IN` dengan ribuan nilai bisa bermasalah:

- SQL terlalu panjang.
- query parse cost tinggi.
- database punya batas jumlah expression.
- plan bisa buruk.
- network payload besar.

Strategi:

1. Limit jumlah input.
2. Chunk query di service.
3. Temporary table.
4. Bulk insert ids ke staging table.
5. Join ke derived table/vendor-specific array binding.
6. Gunakan keyset/batch fetch pattern.

Contoh service chunking:

```java
public List<UserRow> findUsersByIds(List<Long> ids) {
    if (ids.isEmpty()) {
        return List.of();
    }

    List<UserRow> result = new ArrayList<>();
    for (List<Long> chunk : chunks(ids, 500)) {
        result.addAll(userMapper.findByIds(new FindUsersByIdsQuery(chunk)));
    }
    return result;
}
```

### 9.4 Batch Insert with `<foreach>`

```xml
<insert id="insertUsers" parameterType="map">
  INSERT INTO app_user (
    id,
    username,
    status,
    created_at,
    created_by
  )
  VALUES
  <foreach collection="users" item="user" separator=",">
    (
      #{user.id},
      #{user.username},
      #{user.status},
      #{user.createdAt},
      #{user.createdBy}
    )
  </foreach>
</insert>
```

Untuk jumlah besar, pertimbangkan:

- JDBC batch executor.
- chunk size.
- generated key behavior.
- transaction size.
- partial failure handling.

`foreach` multi-row insert bukan selalu lebih baik daripada JDBC batch. Tergantung database dan driver.

### 9.5 Bulk Update with CASE

```xml
<update id="bulkUpdateStatus" parameterType="map">
  UPDATE case_file
  SET status = CASE id
    <foreach collection="items" item="item">
      WHEN #{item.caseId} THEN #{item.newStatus}
    </foreach>
  END,
  updated_at = #{updatedAt},
  updated_by = #{updatedBy}
  WHERE id IN
  <foreach collection="items" item="item" open="(" separator="," close=")">
    #{item.caseId}
  </foreach>
    AND tenant_id = #{tenantId}
</update>
```

Gunakan dengan hati-hati:

- CASE besar bisa mahal.
- Tidak cocok untuk ribuan row tanpa testing.
- Harus ada tenant boundary.
- Rows affected harus dicek.

---

## 10. `<bind>`: Precompute Expression Value

`<bind>` membuat variable baru dari OGNL expression.

Contoh dari input keyword ke pattern LIKE:

```xml
<select id="searchUsers" parameterType="UserSearchCriteria" resultMap="UserRowMap">
  <bind name="keywordPattern" value="'%' + keyword + '%'" />

  SELECT id, username
  FROM app_user
  <where>
    tenant_id = #{tenantId}
    <if test="keyword != null and keyword != ''">
      AND username LIKE #{keywordPattern}
    </if>
  </where>
</select>
```

Namun untuk production-grade design, biasanya lebih baik pattern sudah disiapkan di Java:

```java
criteria.getKeywordLike()
```

Kenapa?

- escaping `%` dan `_` lebih mudah di Java.
- bisa ditest unit.
- mengurangi logic di XML.
- menghindari OGNL terlalu pintar.

Gunakan `<bind>` untuk kasus kecil dan jelas, bukan business normalization kompleks.

---

## 11. `<sql>` dan `<include>`: Reusable SQL Fragment

Dynamic SQL sering butuh fragment reusable:

- base columns.
- base joins.
- tenant predicate.
- soft delete predicate.
- common filters.

Contoh:

```xml
<sql id="CaseListColumns">
  c.id,
  c.case_no,
  c.status,
  c.created_at,
  c.updated_at
</sql>

<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListRowMap">
  SELECT
    <include refid="CaseListColumns" />
  FROM case_file c
  <where>
    c.tenant_id = #{tenantId}
    AND c.deleted = 0
  </where>
</select>
```

### 11.1 Good Reuse vs Bad Reuse

Good reuse:

```text
stable column list
stable base predicate
stable join fragment for one bounded context
```

Bad reuse:

```text
generic WHERE builder reused by many unrelated screens
fragment with hidden authorization logic
fragment with optional joins that change row cardinality
fragment that takes raw SQL text
```

Contoh fragment yang berisiko:

```xml
<sql id="DynamicOrderBy">
  ORDER BY ${sortColumn} ${sortDirection}
</sql>
```

Lebih baik buat branch eksplisit atau Java whitelist.

### 11.2 Fragment Scope

Jangan terlalu cepat membuat shared fragment global. Dalam codebase besar, global fragment sering berubah menjadi coupling lintas module.

Prinsip:

```text
Reuse stable SQL shape, not unstable business intent.
```

Jika fragment punya banyak parameter dan condition, mungkin seharusnya query itu tidak direuse.

---

## 12. Designing Search Criteria Object

Dynamic SQL yang baik dimulai dari parameter object yang baik.

Buruk:

```java
Map<String, Object> params = new HashMap<>();
params.put("status", status);
params.put("keyword", keyword);
params.put("from", from);
params.put("to", to);
params.put("sort", sort);
```

Masalah:

- tidak type-safe.
- tidak ada invariant.
- tidak jelas required/optional.
- typo baru ketahuan runtime.
- sulit validasi.

Lebih baik:

```java
public final class CaseSearchCriteria {
    private final Long tenantId;
    private final String status;
    private final String keywordLike;
    private final LocalDateTime createdFrom;
    private final LocalDateTime createdToExclusive;
    private final CaseSortField sortField;
    private final SortDirection sortDirection;
    private final int limit;
    private final int offset;

    public CaseSearchCriteria(
            Long tenantId,
            String status,
            String keyword,
            LocalDate createdFromDate,
            LocalDate createdToDate,
            CaseSortField sortField,
            SortDirection sortDirection,
            int limit,
            int offset
    ) {
        if (tenantId == null) {
            throw new IllegalArgumentException("tenantId is required");
        }
        if (limit < 1 || limit > 200) {
            throw new IllegalArgumentException("limit must be between 1 and 200");
        }
        if (offset < 0) {
            throw new IllegalArgumentException("offset must be >= 0");
        }

        this.tenantId = tenantId;
        this.status = normalizeStatus(status);
        this.keywordLike = toEscapedLike(keyword);
        this.createdFrom = createdFromDate == null ? null : createdFromDate.atStartOfDay();
        this.createdToExclusive = createdToDate == null ? null : createdToDate.plusDays(1).atStartOfDay();
        this.sortField = sortField == null ? CaseSortField.CREATED_AT : sortField;
        this.sortDirection = sortDirection == null ? SortDirection.DESC : sortDirection;
        this.limit = limit;
        this.offset = offset;
    }

    public boolean hasStatus() {
        return status != null;
    }

    public boolean hasKeyword() {
        return keywordLike != null;
    }

    // getters
}
```

Dengan parameter object seperti ini, XML menjadi lebih sederhana:

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at
  FROM case_file c
  <where>
    c.tenant_id = #{tenantId}
    AND c.deleted = 0

    <if test="hasStatus()">
      AND c.status = #{status}
    </if>

    <if test="hasKeyword()">
      AND (
        UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\'
        OR UPPER(c.subject) LIKE UPPER(#{keywordLike}) ESCAPE '\'
      )
    </if>

    <if test="createdFrom != null">
      AND c.created_at &gt;= #{createdFrom}
    </if>

    <if test="createdToExclusive != null">
      AND c.created_at &lt; #{createdToExclusive}
    </if>
  </where>

  <include refid="CaseSearchOrderBy" />

  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

---

## 13. Safe Dynamic ORDER BY

`ORDER BY` adalah sumber SQL injection umum karena column name tidak bisa di-bind dengan `#{}`.

Ini tidak bekerja sesuai harapan:

```xml
ORDER BY #{sortColumn}
```

Karena akan menjadi:

```sql
ORDER BY ?
```

Database memperlakukan `?` sebagai value, bukan identifier column.

Yang berbahaya:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Jika input user:

```text
created_at; DROP TABLE app_user; --
```

maka SQL bisa rusak/berbahaya tergantung driver dan DB.

### 13.1 XML Branch Whitelist

```xml
<sql id="CaseSearchOrderBy">
  ORDER BY
  <choose>
    <when test="sortField == 'CASE_NO'">
      c.case_no
    </when>
    <when test="sortField == 'STATUS'">
      c.status
    </when>
    <when test="sortField == 'CREATED_AT'">
      c.created_at
    </when>
    <otherwise>
      c.id
    </otherwise>
  </choose>

  <choose>
    <when test="sortDirection == 'ASC'">
      ASC
    </when>
    <otherwise>
      DESC
    </otherwise>
  </choose>,
  c.id DESC
</sql>
```

Tambahkan tie-breaker stabil seperti `c.id DESC` agar pagination stabil.

### 13.2 Java Whitelist + Controlled `${}`

Kadang XML branch terlalu panjang. Bisa pakai controlled fragment:

```java
public enum CaseSortField {
    CASE_NO("c.case_no"),
    STATUS("c.status"),
    CREATED_AT("c.created_at");

    private final String sql;

    CaseSortField(String sql) {
        this.sql = sql;
    }

    public String sql() {
        return sql;
    }
}
```

Criteria:

```java
public String getSortColumnSql() {
    return sortField.sql();
}

public String getSortDirectionSql() {
    return sortDirection == SortDirection.ASC ? "ASC" : "DESC";
}
```

XML:

```xml
ORDER BY ${sortColumnSql} ${sortDirectionSql}, c.id DESC
```

Ini boleh dipertimbangkan hanya jika:

1. `sortColumnSql` tidak pernah berasal dari raw request.
2. Nilainya hanya dari enum whitelist.
3. Object immutable.
4. Ada unit test untuk mapping request sort ke enum.
5. Code review memahami bahwa `${}` di sini controlled.

Jika tim belum disiplin, prefer XML branch whitelist.

---

## 14. Dynamic SQL for Authorization and Tenant Scope

Dynamic SQL sering dipakai untuk authorization scope. Ini berbahaya jika salah default.

Contoh scope:

- user hanya melihat case miliknya.
- officer melihat team case.
- agency admin melihat agency case.
- system admin melihat semua tenant tertentu.

XML:

```xml
<where>
  c.tenant_id = #{tenantId}
  AND c.deleted = 0

  <choose>
    <when test="accessScope == 'OWNER'">
      AND c.owner_user_id = #{currentUserId}
    </when>
    <when test="accessScope == 'TEAM'">
      <choose>
        <when test="teamIds != null and teamIds.size() > 0">
          AND c.team_id IN
          <foreach collection="teamIds" item="teamId" open="(" separator="," close=")">
            #{teamId}
          </foreach>
        </when>
        <otherwise>
          AND 1 = 0
        </otherwise>
      </choose>
    </when>
    <when test="accessScope == 'AGENCY'">
      AND c.agency_id = #{agencyId}
    </when>
    <otherwise>
      AND 1 = 0
    </otherwise>
  </choose>
</where>
```

Rules:

1. Mandatory tenant filter tidak boleh optional.
2. Unknown scope harus fail closed.
3. Empty permission list harus no rows, bukan no filter.
4. Authorization branch harus dites.
5. Jangan copy-paste scope logic ke 20 mapper tanpa central review.

Lebih advanced: authorization predicate bisa disusun di Java sebagai explicit enum/scope object, lalu mapper hanya memilih branch kecil.

---

## 15. Dynamic SQL for State Machine Transition

Dalam sistem case management/enforcement, update state harus menjaga invariant.

Contoh buruk:

```xml
<update id="updateStatus">
  UPDATE case_file
  SET status = #{newStatus}
  WHERE id = #{caseId}
</update>
```

Ini tidak mencegah illegal transition.

Lebih baik:

```xml
<update id="transitionStatus" parameterType="CaseTransitionCommand">
  UPDATE case_file
  SET status = #{newStatus},
      version = version + 1,
      updated_at = #{updatedAt},
      updated_by = #{updatedBy}
  WHERE id = #{caseId}
    AND tenant_id = #{tenantId}
    AND status IN
    <foreach collection="allowedPreviousStatuses" item="status" open="(" separator="," close=")">
      #{status}
    </foreach>
    AND version = #{expectedVersion}
</update>
```

Jika rows affected = 0, bisa berarti:

- case tidak ditemukan.
- tenant mismatch.
- status sudah berubah.
- illegal transition.
- optimistic lock conflict.

Service harus menerjemahkan hasil:

```java
int updated = caseMapper.transitionStatus(command);
if (updated != 1) {
    throw new ConcurrentStateTransitionException(command.caseId());
}
```

Dynamic part-nya adalah `allowedPreviousStatuses`. Tetapi invariant tetap jelas di SQL.

---

## 16. Dynamic SQL for Soft Delete Visibility

Soft delete sering menjadi sumber bug.

Ada beberapa visibility mode:

- active only.
- deleted only.
- include deleted.

Gunakan explicit enum, bukan boolean ambigu.

```java
public enum DeletionVisibility {
    ACTIVE_ONLY,
    DELETED_ONLY,
    INCLUDE_DELETED
}
```

XML:

```xml
<choose>
  <when test="deletionVisibility == 'ACTIVE_ONLY'">
    AND c.deleted = 0
  </when>
  <when test="deletionVisibility == 'DELETED_ONLY'">
    AND c.deleted = 1
  </when>
  <when test="deletionVisibility == 'INCLUDE_DELETED'">
    <!-- no predicate -->
  </when>
  <otherwise>
    AND c.deleted = 0
  </otherwise>
</choose>
```

Untuk public/user-facing query, default harus `ACTIVE_ONLY`.

---

## 17. Dynamic SQL for Date Ranges

Date range sering salah karena inclusive end date.

Buruk:

```xml
AND created_at BETWEEN #{fromDate} AND #{toDate}
```

Jika `toDate` adalah tanggal tanpa jam, data pada hari itu setelah 00:00 bisa tidak masuk.

Lebih baik:

```text
[fromInclusive, toExclusive)
```

XML:

```xml
<if test="createdFrom != null">
  AND c.created_at &gt;= #{createdFrom}
</if>

<if test="createdToExclusive != null">
  AND c.created_at &lt; #{createdToExclusive}
</if>
```

Java:

```java
LocalDateTime from = fromDate == null ? null : fromDate.atStartOfDay();
LocalDateTime toExclusive = toDate == null ? null : toDate.plusDays(1).atStartOfDay();
```

Ini lebih robust untuk index range scan.

---

## 18. Dynamic SQL and Query Plan Stability

Dynamic SQL menghasilkan banyak bentuk SQL.

Contoh search screen dengan 6 optional filters bisa menghasilkan puluhan kombinasi SQL.

Risiko:

- plan cache lebih banyak.
- statistik DB mempengaruhi plan berbeda.
- query tertentu jarang dites.
- kombinasi filter tertentu lambat.

Rules:

1. Jangan terlalu banyak optional predicate dalam satu mapper jika query menjadi tidak terkontrol.
2. Pisahkan search mode yang berbeda secara semantik.
3. Gunakan mandatory selective predicate jika ada.
4. Hindari `OR` besar tanpa indexing strategy.
5. Pertimbangkan query terpisah untuk exact search vs fuzzy search.
6. Test kombinasi filter paling mahal.
7. Log slow query dengan parameter context yang aman.

Contoh pemisahan:

```java
List<CaseRow> searchCases(CaseSearchCriteria criteria);
List<CaseRow> findCasesByExactCaseNo(ExactCaseNoQuery query);
List<CaseRow> findCasesByApplicant(ApplicantCaseQuery query);
```

Daripada satu method:

```java
List<CaseRow> searchEverything(Map<String, Object> params);
```

---

## 19. Dynamic SQL Testing Strategy

Dynamic SQL harus dites berdasarkan **shape** dan **behavior**.

### 19.1 Test Input Combination

Untuk search criteria:

- no optional filter.
- status only.
- date range only.
- keyword only.
- status + keyword.
- empty list.
- large list.
- invalid sort.
- scope owner.
- scope team with teams.
- scope team empty.
- scope unknown.

### 19.2 Test Generated SQL Shape

MyBatis memungkinkan mengambil `BoundSql` dari `MappedStatement`.

Contoh test konseptual:

```java
Configuration configuration = sqlSessionFactory.getConfiguration();
MappedStatement ms = configuration.getMappedStatement("com.example.CaseMapper.searchCases");
BoundSql boundSql = ms.getBoundSql(criteria);
String sql = boundSql.getSql();

assertThat(sql).contains("WHERE");
assertThat(sql).contains("tenant_id");
assertThat(sql).doesNotContain("WHERE AND");
assertThat(sql).doesNotContain("IN ()");
```

Jangan terlalu brittle terhadap whitespace. Normalize whitespace:

```java
private static String normalizeSql(String sql) {
    return sql.replaceAll("\\s+", " ").trim();
}
```

### 19.3 Test Behavior Against Real DB

Generated SQL shape test tidak cukup. Harus ada integration test:

- seed data.
- run mapper.
- assert rows returned.
- assert tenant isolation.
- assert soft delete.
- assert sorting stable.
- assert pagination.

Untuk vendor-specific SQL, gunakan Testcontainers atau database test environment sesuai vendor. H2 sering menyembunyikan perbedaan behavior.

### 19.4 Test Security Cases

Test input seperti:

```text
keyword = "%' OR '1'='1"
sort = "created_at; drop table x"
```

Expected:

- keyword tetap bound parameter.
- sort ditolak atau fallback ke whitelist.
- query tidak bocor lintas tenant.

---

## 20. Dynamic SQL Review Checklist

Gunakan checklist ini saat review PR mapper XML.

### 20.1 Correctness

- Apakah query tetap valid jika semua optional filter null?
- Apakah query tetap valid jika hanya satu filter aktif?
- Apakah query tetap valid jika list kosong?
- Apakah `WHERE AND` atau trailing comma mungkin terjadi?
- Apakah `IN ()` mungkin terjadi?
- Apakah date range memakai inclusive/exclusive boundary yang benar?
- Apakah pagination stabil?
- Apakah result mapping sesuai selected columns?

### 20.2 Security

- Apakah semua value data memakai `#{}`?
- Apakah `${}` hanya dipakai untuk whitelist-controlled identifier?
- Apakah tenant/agency scope mandatory?
- Apakah empty permission list menghasilkan no rows?
- Apakah unknown access scope fail closed?
- Apakah soft delete visibility explicit?

### 20.3 Performance

- Apakah optional filter mendukung index?
- Apakah `OR` besar bisa membuat index tidak efektif?
- Apakah `LIKE '%keyword%'` memang acceptable?
- Apakah IN list dibatasi?
- Apakah dynamic join menyebabkan duplicate rows?
- Apakah count query terlalu mahal?
- Apakah sorting memakai indexed/stable column?

### 20.4 Maintainability

- Apakah XML masih readable?
- Apakah OGNL expression terlalu kompleks?
- Apakah business logic seharusnya dipindah ke Java?
- Apakah fragment reuse jelas?
- Apakah nama parameter eksplisit?
- Apakah method mapper punya contract jelas?
- Apakah test mencakup branch penting?

---

## 21. Anti-Patterns

### 21.1 Generic Search Map

```java
List<Row> search(Map<String, Object> params);
```

Masalah:

- Tidak ada contract.
- Runtime typo.
- Tidak ada validation.
- Security filter bisa lupa.

Gunakan criteria object.

### 21.2 Raw `${}` from Request

```xml
ORDER BY ${sort}
```

Ini SQL injection boundary violation.

### 21.3 Optional Tenant Filter

```xml
<if test="tenantId != null">
  AND tenant_id = #{tenantId}
</if>
```

Tenant filter harus mandatory untuk tenant-scoped query.

### 21.4 XML Business Logic Explosion

```xml
<if test="user.role == 'ADMIN' or (user.role == 'SUPERVISOR' and case.status != 'DRAFT' and featureFlags['x'] == true)">
```

Pindahkan decision ke Java.

### 21.5 One Mapper Method for All Search Modes

```java
searchCasesWithEveryPossibleFilter(...)
```

Jika query sudah memiliki banyak mode semantik, pecah menjadi beberapa method.

### 21.6 Empty List Means All Rows

```xml
<if test="ids != null and ids.size() > 0">
  AND id IN (...)
</if>
```

Jika method contract adalah `findByIds`, empty ids seharusnya return empty result, bukan all rows.

### 21.7 Dynamic Update Without Guard

```xml
<set>
  <if test="fieldA != null">field_a = #{fieldA},</if>
  <if test="fieldB != null">field_b = #{fieldB},</if>
</set>
```

Tanpa minimal-one-field validation, bisa menghasilkan SQL invalid.

---

## 22. Full Example: Production-Grade Case Search Mapper

### 22.1 Java Criteria

```java
public final class CaseSearchCriteria {
    private final Long tenantId;
    private final Long currentUserId;
    private final AccessScope accessScope;
    private final List<Long> teamIds;
    private final String status;
    private final String keywordLike;
    private final LocalDateTime createdFrom;
    private final LocalDateTime createdToExclusive;
    private final CaseSortField sortField;
    private final SortDirection sortDirection;
    private final int offset;
    private final int limit;

    public CaseSearchCriteria(
            Long tenantId,
            Long currentUserId,
            AccessScope accessScope,
            List<Long> teamIds,
            String status,
            String keyword,
            LocalDate createdFromDate,
            LocalDate createdToDate,
            CaseSortField sortField,
            SortDirection sortDirection,
            int offset,
            int limit
    ) {
        if (tenantId == null) {
            throw new IllegalArgumentException("tenantId is required");
        }
        if (currentUserId == null) {
            throw new IllegalArgumentException("currentUserId is required");
        }
        if (accessScope == null) {
            throw new IllegalArgumentException("accessScope is required");
        }
        if (offset < 0) {
            throw new IllegalArgumentException("offset must be >= 0");
        }
        if (limit < 1 || limit > 200) {
            throw new IllegalArgumentException("limit must be between 1 and 200");
        }

        this.tenantId = tenantId;
        this.currentUserId = currentUserId;
        this.accessScope = accessScope;
        this.teamIds = teamIds == null ? List.of() : List.copyOf(teamIds);
        this.status = normalizeBlankToNull(status);
        this.keywordLike = toEscapedLike(keyword);
        this.createdFrom = createdFromDate == null ? null : createdFromDate.atStartOfDay();
        this.createdToExclusive = createdToDate == null ? null : createdToDate.plusDays(1).atStartOfDay();
        this.sortField = sortField == null ? CaseSortField.CREATED_AT : sortField;
        this.sortDirection = sortDirection == null ? SortDirection.DESC : sortDirection;
        this.offset = offset;
        this.limit = limit;
    }

    public boolean hasStatus() {
        return status != null;
    }

    public boolean hasKeyword() {
        return keywordLike != null;
    }

    // getters omitted
}
```

### 22.2 Mapper Interface

```java
public interface CaseSearchMapper {
    List<CaseListRow> searchCases(CaseSearchCriteria criteria);
    long countCases(CaseSearchCriteria criteria);
}
```

### 22.3 XML Mapper

```xml
<mapper namespace="com.example.casefile.persistence.CaseSearchMapper">

  <resultMap id="CaseListRowMap" type="com.example.casefile.persistence.CaseListRow">
    <id property="id" column="case_id" />
    <result property="caseNo" column="case_no" />
    <result property="status" column="case_status" />
    <result property="createdAt" column="created_at" />
    <result property="updatedAt" column="updated_at" />
  </resultMap>

  <sql id="CaseSearchColumns">
    c.id AS case_id,
    c.case_no AS case_no,
    c.status AS case_status,
    c.created_at AS created_at,
    c.updated_at AS updated_at
  </sql>

  <sql id="CaseSearchFrom">
    FROM case_file c
  </sql>

  <sql id="CaseSearchWhere">
    <where>
      c.tenant_id = #{tenantId}
      AND c.deleted = 0

      <choose>
        <when test="accessScope == 'OWNER'">
          AND c.owner_user_id = #{currentUserId}
        </when>
        <when test="accessScope == 'TEAM'">
          <choose>
            <when test="teamIds != null and teamIds.size() > 0">
              AND c.team_id IN
              <foreach collection="teamIds" item="teamId" open="(" separator="," close=")">
                #{teamId}
              </foreach>
            </when>
            <otherwise>
              AND 1 = 0
            </otherwise>
          </choose>
        </when>
        <when test="accessScope == 'AGENCY'">
          AND c.agency_id = #{agencyId}
        </when>
        <otherwise>
          AND 1 = 0
        </otherwise>
      </choose>

      <if test="hasStatus()">
        AND c.status = #{status}
      </if>

      <if test="hasKeyword()">
        AND (
          UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\'
          OR UPPER(c.subject) LIKE UPPER(#{keywordLike}) ESCAPE '\'
        )
      </if>

      <if test="createdFrom != null">
        AND c.created_at &gt;= #{createdFrom}
      </if>

      <if test="createdToExclusive != null">
        AND c.created_at &lt; #{createdToExclusive}
      </if>
    </where>
  </sql>

  <sql id="CaseSearchOrderBy">
    ORDER BY
    <choose>
      <when test="sortField == 'CASE_NO'">
        c.case_no
      </when>
      <when test="sortField == 'STATUS'">
        c.status
      </when>
      <when test="sortField == 'UPDATED_AT'">
        c.updated_at
      </when>
      <otherwise>
        c.created_at
      </otherwise>
    </choose>
    <choose>
      <when test="sortDirection == 'ASC'">
        ASC
      </when>
      <otherwise>
        DESC
      </otherwise>
    </choose>,
    c.id DESC
  </sql>

  <select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseListRowMap">
    SELECT
      <include refid="CaseSearchColumns" />
    <include refid="CaseSearchFrom" />
    <include refid="CaseSearchWhere" />
    <include refid="CaseSearchOrderBy" />
    OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
  </select>

  <select id="countCases" parameterType="CaseSearchCriteria" resultType="long">
    SELECT COUNT(1)
    <include refid="CaseSearchFrom" />
    <include refid="CaseSearchWhere" />
  </select>

</mapper>
```

### 22.4 Commentary

Hal yang benar dari desain ini:

- tenant filter mandatory.
- soft delete mandatory.
- authorization scope fail closed.
- team scope empty menghasilkan no rows.
- keyword memakai bound parameter.
- sort memakai whitelist branch.
- pagination punya tie-breaker.
- count query reuse `FROM` dan `WHERE`, bukan `ORDER BY`.
- selected columns eksplisit.
- resultMap eksplisit.

Hal yang masih perlu diperhatikan:

- `agencyId` harus ada jika scope `AGENCY`.
- index harus mendukung filter utama.
- `LIKE '%keyword%'` bisa mahal.
- count query bisa mahal untuk dataset besar.
- offset pagination tidak ideal untuk halaman jauh.
- Oracle/PostgreSQL/MySQL pagination syntax berbeda.

---

## 23. Java 8 sampai Java 25 Considerations

Dynamic SQL XML sendiri tidak bergantung banyak pada versi Java. Yang berubah adalah desain parameter object dan support library.

### 23.1 Java 8

Gunakan:

- final class.
- constructor validation.
- getter explicit.
- enum untuk whitelist.
- `Collections.unmodifiableList`.

Hindari:

- record.
- sealed class.
- pattern matching.

### 23.2 Java 11

Mirip Java 8, tetapi lebih nyaman dengan:

- `List.copyOf`.
- var di local variable jika tim setuju.
- modern HTTP/client unrelated.

### 23.3 Java 17+

Bisa gunakan:

- record untuk immutable criteria/projection.
- sealed interface untuk search mode.
- switch expression untuk sort mapping.

Contoh:

```java
public record CaseSearchCriteria(
        Long tenantId,
        AccessScope accessScope,
        String status,
        String keywordLike,
        int offset,
        int limit
) {
    public CaseSearchCriteria {
        if (tenantId == null) throw new IllegalArgumentException("tenantId is required");
        if (limit < 1 || limit > 200) throw new IllegalArgumentException("invalid limit");
    }

    public boolean hasStatus() {
        return status != null;
    }

    public boolean hasKeyword() {
        return keywordLike != null;
    }
}
```

### 23.4 Java 21/25

Virtual threads tidak mengubah SQL XML, tetapi mempengaruhi concurrency behavior aplikasi. Jangan mengira virtual threads memperbaiki slow SQL. Dynamic SQL tetap harus:

- indexed.
- bounded.
- observable.
- timeout-aware.
- connection-pool-aware.

Virtual threads bisa membuat jumlah concurrent blocking call naik. Jika mapper query lambat, database dan connection pool bisa lebih cepat jenuh.

---

## 24. Design Heuristics: Kapan Dynamic SQL XML Cocok?

Dynamic SQL XML cocok jika:

- SQL tetap ingin terlihat eksplisit.
- query punya filter opsional moderate.
- tim ingin DBA/reviewer mudah membaca SQL.
- mapping result kompleks.
- vendor-specific SQL perlu dikontrol.
- query merupakan bagian penting dari domain/application workflow.

Dynamic SQL XML kurang cocok jika:

- query sangat composable dengan puluhan branch.
- query dibangun dari UI arbitrary query builder.
- butuh type-safe query generation kuat.
- struktur query sangat conditional dan sulit dibaca dalam XML.
- ingin compile-time safety untuk column/table.

Alternatif:

- MyBatis Dynamic SQL library.
- jOOQ.
- QueryDSL.
- Criteria API.
- Spring JDBC with custom builder.
- dedicated search engine untuk full-text/filter kompleks.

Kuncinya bukan fanatik XML. Kuncinya adalah memilih tool yang membuat SQL contract paling jelas dan aman.

---

## 25. Summary

Dynamic SQL XML adalah salah satu fitur paling kuat MyBatis, tetapi juga salah satu sumber risiko terbesar.

Mental model utama:

```text
Dynamic tag controls SQL structure.
#{ } controls data binding.
${ } is raw substitution and must be treated as dangerous unless whitelist-controlled.
```

Rules paling penting:

1. Gunakan `<where>` untuk optional predicates.
2. Gunakan `<set>` untuk dynamic update clause.
3. Gunakan `<trim>` saat butuh prefix/suffix control khusus.
4. Gunakan `<choose>` saat hanya satu branch boleh aktif.
5. Gunakan `<foreach>` untuk collection expansion, tetapi definisikan empty-list semantics.
6. Jangan membuat tenant/security predicate optional.
7. Jangan membiarkan unknown scope menghasilkan broad query.
8. Jangan memakai `${}` dari raw input.
9. Pindahkan business decision kompleks ke Java.
10. Test setiap branch penting dynamic SQL.

Dynamic SQL yang bagus bukan SQL yang paling pendek. Dynamic SQL yang bagus adalah SQL yang:

- aman,
- predictable,
- readable,
- testable,
- explainable saat incident,
- dan menjaga invariant domain.

---

## 26. Latihan

### Latihan 1 — Safe Search Criteria

Buat `ApplicationSearchCriteria` untuk search application dengan filter:

- tenant id wajib.
- agency id optional.
- status optional.
- submitted date range optional.
- applicant keyword optional.
- sort field whitelist.
- limit max 100.

Lalu buat XML `searchApplications` dengan `<where>`, `<if>`, dan safe order by.

### Latihan 2 — Empty Permission List

Buat query `searchCasesVisibleToUser` dengan scope:

- `OWNER`
- `TEAM`
- `AGENCY`

Pastikan `TEAM` dengan `teamIds` kosong menghasilkan no rows.

### Latihan 3 — Patch Update

Buat `PatchApplicationCommand` yang bisa:

- update remark jika present.
- clear remark jika explicit null.
- update priority jika present.
- selalu update audit columns.

Desain Java command dan XML `<set>`.

### Latihan 4 — Generated SQL Test

Ambil `BoundSql` untuk mapper search, lalu assert:

- tidak ada `WHERE AND`.
- tidak ada `IN ()`.
- tenant predicate selalu ada.
- unknown scope menghasilkan `1 = 0`.

### Latihan 5 — Dynamic Query Refactoring

Refactor mapper yang memakai:

```xml
ORDER BY ${sort}
```

menjadi safe whitelist pattern.

---

## 27. Apa yang Dipelajari di Part Berikutnya

Part berikutnya adalah:

```text
09-mybatis-dynamic-sql-library-type-safe-query-generation.md
```

Di sana kita akan membahas **MyBatis Dynamic SQL library**, yaitu pendekatan programmatic/type-safe untuk membangun SQL dibanding XML dynamic SQL. Fokusnya:

- table/column metadata.
- select/insert/update/delete builder.
- rendering strategy.
- mapper integration.
- Java 8 compatibility.
- kapan lebih baik dari XML.
- kapan XML tetap lebih tepat.
- trade-off readability vs type-safety.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 7 — Advanced Result Mapping: Constructor, Record, Immutable DTO, Nested Object](./07-advanced-result-mapping-constructor-record-immutable-dto-nested-object.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: 09 — MyBatis Dynamic SQL Library: Type-Safe Query Generation](./09-mybatis-dynamic-sql-library-type-safe-query-generation.md)
