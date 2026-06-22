# Part 3 — Mapper Design: Interface, XML, Annotation, and Naming Discipline

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `03-mapper-design-interface-xml-annotation-and-naming-discipline.md`  
**Scope:** Java 8 sampai Java 25  
**Level:** Advanced / production engineering  

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah melihat MyBatis dari sisi runtime: `SqlSession`, `Configuration`, `MappedStatement`, `BoundSql`, `Executor`, `StatementHandler`, `ParameterHandler`, dan `ResultSetHandler`.

Sekarang kita naik satu level ke hal yang menentukan apakah MyBatis codebase akan tetap sehat setelah bertahun-tahun: **desain mapper**.

Banyak tim memakai MyBatis hanya sebagai tempat menaruh SQL. Awalnya sederhana:

```java
User findById(Long id);
```

Lalu setelah beberapa bulan berubah menjadi:

```java
List<Map<String, Object>> search(Map<String, Object> params);
```

Lalu XML mapper berisi 1.500 baris dynamic SQL, `resultMap` campur aduk, `sql` fragment dipakai di mana-mana, dan tidak ada orang yang yakin apakah suatu query masih dipakai atau tidak.

Bagian ini bertujuan mencegah itu.

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Mendesain mapper interface sebagai **kontrak persistence**, bukan sekadar wrapper SQL.
2. Memutuskan kapan memakai XML, annotation, atau hybrid.
3. Menentukan naming convention yang scalable untuk codebase besar.
4. Menjaga boundary antara service, repository, mapper, DTO, projection, dan domain object.
5. Menghindari mapper yang berubah menjadi god object.
6. Mendesain struktur package dan resource yang mudah dicari, diuji, direview, dan di-refactor.
7. Membuat mapper yang tetap maintainable untuk sistem dengan puluhan modul dan ratusan query.

---

## 1. Premis Dasar: Mapper Adalah Contract, Bukan Folder SQL

Dalam MyBatis, mapper sering terlihat seperti ini:

```java
@Mapper
public interface UserMapper {
    User findById(Long id);
}
```

Dan XML-nya:

```xml
<mapper namespace="com.example.user.UserMapper">
  <select id="findById" parameterType="long" resultType="User">
    SELECT id, username, email
    FROM users
    WHERE id = #{id}
  </select>
</mapper>
```

Secara teknis, interface method dan XML statement dihubungkan oleh:

```text
namespace + statement id
```

Jika namespace adalah:

```text
com.example.user.UserMapper
```

Dan method adalah:

```text
findById
```

Maka mapped statement id adalah:

```text
com.example.user.UserMapper.findById
```

Tapi mental model yang lebih penting adalah ini:

```text
Service layer tidak memanggil SQL.
Service layer memanggil persistence contract.
Mapper interface adalah contract itu.
XML/annotation adalah implementasi statement-nya.
```

Artinya, pertanyaan desain mapper bukan hanya:

> SQL-nya ditaruh di mana?

Tetapi:

> Contract persistence apa yang ingin kita expose ke application layer?

Ini perbedaan besar.

---

## 2. Mengapa Desain Mapper Sangat Penting di MyBatis

Pada JPA/Hibernate, banyak keputusan persistence disembunyikan oleh ORM:

- entity lifecycle,
- dirty checking,
- flush,
- association loading,
- query generation,
- persistence context.

Pada MyBatis, keputusan itu lebih eksplisit. Kamu menulis query. Kamu memilih projection. Kamu menentukan mapping. Kamu menentukan apakah update berdasarkan ID saja atau berdasarkan ID + version. Kamu menentukan apakah query listing join 5 tabel atau memanggil 5 mapper terpisah.

Karena itu, MyBatis memberi kontrol tinggi, tetapi juga memperbesar risiko desain.

Jika mapper didesain buruk, masalahnya biasanya bukan langsung terlihat sebagai compile error. Masalahnya muncul sebagai:

- query duplikat,
- result mapping tidak konsisten,
- dynamic SQL sulit dipahami,
- service layer tahu terlalu banyak detail database,
- pagination tidak stabil,
- authorization filter terlupakan,
- tenant filter tidak konsisten,
- N+1 manual,
- query lambat tapi sulit dilacak pemiliknya,
- refactor schema menjadi sangat mahal.

Mapper design adalah tempat kita mengubah SQL yang fleksibel menjadi sistem yang tetap bisa dikendalikan.

---

## 3. Tiga Bentuk Mapper di MyBatis

Secara umum, ada tiga gaya utama:

1. XML mapper.
2. Annotation mapper.
3. Hybrid mapper.

Masing-masing punya tempat.

---

## 4. XML Mapper

XML mapper adalah gaya paling klasik dan paling powerful di MyBatis.

Contoh:

```java
package com.acme.user.persistence;

public interface UserMapper {
    UserRecord selectById(long id);
}
```

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
  PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "https://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.acme.user.persistence.UserMapper">

  <resultMap id="UserRecordMap" type="com.acme.user.persistence.UserRecord">
    <id property="id" column="id" />
    <result property="username" column="username" />
    <result property="email" column="email" />
    <result property="status" column="status" />
  </resultMap>

  <select id="selectById" parameterType="long" resultMap="UserRecordMap">
    SELECT
      id,
      username,
      email,
      status
    FROM app_user
    WHERE id = #{id}
  </select>

</mapper>
```

### 4.1 Kekuatan XML Mapper

XML mapper unggul untuk:

- SQL panjang,
- query dengan banyak join,
- dynamic SQL,
- result map kompleks,
- reusable SQL fragment,
- nested result mapping,
- stored procedure,
- vendor-specific SQL,
- audit/review SQL secara eksplisit,
- memisahkan Java contract dari SQL implementation.

Untuk enterprise system, XML sering lebih maintainable karena SQL dapat dibaca sebagai SQL, bukan string Java yang disisipkan annotation.

### 4.2 Kelemahan XML Mapper

XML mapper juga punya biaya:

- tidak full type-safe,
- mismatch method dan statement baru ketahuan saat runtime/test,
- refactor method name harus sinkron dengan XML id,
- file bisa membesar,
- dynamic SQL bisa menjadi sulit dibaca,
- IDE support bervariasi,
- konfigurasi mapper location bisa salah.

### 4.3 Kapan XML Mapper Sebaiknya Dipilih

Pilih XML jika:

- query lebih dari beberapa baris,
- query punya conditional filter,
- query join banyak tabel,
- result mapping eksplisit penting,
- SQL perlu direview oleh DBA,
- ada database vendor-specific syntax,
- query adalah bagian dari business-critical flow,
- kamu ingin menjaga annotation Java tetap bersih.

Rule praktis:

```text
Jika SQL perlu dibaca sebagai artifact serius, taruh di XML.
```

---

## 5. Annotation Mapper

Annotation mapper menaruh SQL langsung di interface:

```java
@Mapper
public interface UserMapper {

    @Select("""
        SELECT id, username, email, status
        FROM app_user
        WHERE id = #{id}
        """)
    UserRecord selectById(long id);
}
```

Untuk Java 8, belum ada text block, sehingga biasanya menjadi:

```java
@Select({
    "SELECT id, username, email, status",
    "FROM app_user",
    "WHERE id = #{id}"
})
UserRecord selectById(long id);
```

### 5.1 Kekuatan Annotation Mapper

Annotation mapper unggul untuk:

- query sangat pendek,
- mapper kecil,
- prototype,
- internal tool,
- simple lookup,
- `exists` query,
- `count` query sederhana,
- insert/update/delete sederhana,
- menghindari XML untuk kasus trivial.

Contoh yang masih masuk akal:

```java
@Select("SELECT COUNT(1) FROM app_user WHERE username = #{username}")
boolean existsByUsername(String username);
```

Atau:

```java
@Update("UPDATE app_user SET last_login_at = #{loginAt} WHERE id = #{userId}")
int updateLastLoginAt(@Param("userId") long userId,
                      @Param("loginAt") Instant loginAt);
```

### 5.2 Kelemahan Annotation Mapper

Annotation mapper cepat rusak untuk query kompleks.

Masalah umum:

- SQL panjang tidak nyaman dibaca,
- dynamic SQL lebih canggung,
- result mapping kompleks sulit dirawat,
- SQL bercampur dengan Java contract,
- annotation array/string concatenation mudah berantakan,
- review SQL menjadi kurang natural,
- Java 8 tanpa text block membuat query panjang sangat noisy.

### 5.3 Kapan Annotation Mapper Sebaiknya Dipilih

Pilih annotation jika:

- SQL sangat pendek,
- tidak ada dynamic SQL kompleks,
- tidak ada result mapping kompleks,
- query tidak business-critical atau mudah dites,
- interface tetap mudah dibaca.

Rule praktis:

```text
Jika annotation SQL membuat interface sulit dibaca, pindahkan ke XML.
```

---

## 6. Hybrid Mapper

Hybrid berarti satu mapper interface memakai kombinasi annotation dan XML.

Contoh:

```java
public interface UserMapper {

    @Select("SELECT COUNT(1) FROM app_user WHERE username = #{username}")
    boolean existsByUsername(String username);

    UserSearchRow searchUsers(UserSearchCriteria criteria);
}
```

XML:

```xml
<mapper namespace="com.acme.user.persistence.UserMapper">

  <select id="searchUsers" parameterType="com.acme.user.persistence.UserSearchCriteria"
          resultType="com.acme.user.persistence.UserSearchRow">
    SELECT
      u.id,
      u.username,
      u.email,
      u.status,
      r.role_name
    FROM app_user u
    LEFT JOIN app_user_role ur ON ur.user_id = u.id
    LEFT JOIN role r ON r.id = ur.role_id
    <where>
      <if test="username != null and username != ''">
        u.username LIKE CONCAT('%', #{username}, '%')
      </if>
      <if test="status != null">
        AND u.status = #{status}
      </if>
    </where>
  </select>

</mapper>
```

Hybrid bisa praktis, tetapi harus punya aturan jelas.

Tanpa aturan, tim akan bingung:

- query ini ada di Java atau XML?
- kenapa sebagian annotation, sebagian XML?
- apakah boleh menaruh dynamic query di annotation?
- apakah semua query baru harus XML?

### 6.1 Aturan Hybrid yang Sehat

Contoh policy:

```text
1. Query <= 3 baris dan tanpa dynamic SQL boleh annotation.
2. Query dengan join wajib XML.
3. Query dengan resultMap wajib XML.
4. Query dengan conditional filter wajib XML.
5. Query untuk business-critical write wajib XML atau wajib explicit review.
6. Tidak boleh mencampur annotation dan XML untuk statement id yang sama.
```

Aturan seperti ini penting bukan karena XML selalu lebih baik, tetapi karena codebase butuh konsistensi.

---

## 7. Mapper Interface sebagai Persistence Port

Mapper interface sebaiknya diperlakukan sebagai port persistence paling bawah.

Contoh layering:

```text
Controller / Handler
        |
Application Service
        |
Domain Service / Use Case
        |
Repository / Persistence Adapter
        |
MyBatis Mapper
        |
SQL / Database
```

Ada dua gaya umum.

### 7.1 Service Langsung Memakai Mapper

```java
@Service
public class UserService {
    private final UserMapper userMapper;

    public UserService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    public UserDetail getUser(long id) {
        UserRecord record = userMapper.selectById(id);
        if (record == null) {
            throw new UserNotFoundException(id);
        }
        return UserDetail.from(record);
    }
}
```

Ini sederhana dan sering cukup untuk aplikasi CRUD internal.

Risiko:

- service tahu detail mapper,
- mapper return type bisa bocor ke domain/API,
- sulit mengganti persistence implementation,
- logic not found/retry/locking bisa tersebar.

### 7.2 Service Memakai Repository, Repository Memakai Mapper

```java
public interface UserRepository {
    Optional<User> findById(UserId id);
    void save(User user);
}
```

```java
@Repository
public class MyBatisUserRepository implements UserRepository {
    private final UserMapper userMapper;

    public MyBatisUserRepository(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    @Override
    public Optional<User> findById(UserId id) {
        UserRecord record = userMapper.selectById(id.value());
        return Optional.ofNullable(record).map(UserRecord::toDomain);
    }

    @Override
    public void save(User user) {
        int updated = userMapper.update(user.toRecord());
        if (updated != 1) {
            throw new ConcurrentModificationException("User update failed");
        }
    }
}
```

Ini lebih cocok untuk domain yang kompleks.

Kelebihan:

- service tidak tergantung MyBatis,
- mapper DTO tidak bocor,
- repository bisa enforce invariant,
- easier test boundary,
- mapping domain/persistence lebih terkendali.

Biaya:

- lebih banyak class,
- butuh disiplin,
- untuk CRUD sederhana mungkin terasa berlebihan.

### 7.3 Rule Praktis

```text
Untuk modul sederhana:
  Service -> Mapper masih bisa diterima.

Untuk modul critical/complex:
  Service -> Repository -> Mapper lebih aman.
```

Complexity indicators:

- ada state machine,
- ada authorization row-level,
- ada optimistic locking,
- ada audit requirement,
- ada workflow escalation,
- ada multi-tenant filtering,
- ada external integration,
- ada reporting projection kompleks.

Jika ada indikator tersebut, jangan biarkan service langsung berinteraksi terlalu bebas dengan mapper.

---

## 8. Mapper Bukan Domain Service

Mapper tidak boleh berisi business decision.

Buruk:

```java
int approveCaseIfUserIsSupervisorAndNotExpired(
    @Param("caseId") long caseId,
    @Param("userId") long userId,
    @Param("now") Instant now
);
```

Sekilas ini terlihat efisien. Namun method ini mencampur:

- authorization,
- role semantics,
- expiry rule,
- state transition,
- database update.

SQL mungkin seperti:

```sql
UPDATE case_table c
SET c.status = 'APPROVED'
WHERE c.id = #{caseId}
  AND c.expiry_at > #{now}
  AND EXISTS (
    SELECT 1
    FROM user_role ur
    WHERE ur.user_id = #{userId}
      AND ur.role = 'SUPERVISOR'
  )
```

Masalahnya: nama mapper menyembunyikan rule bisnis. Ketika rule berubah, mapper ikut menjadi tempat business logic.

Lebih baik pisahkan:

```java
CaseRecord selectForApproval(long caseId);
boolean userHasApprovalAuthority(long userId, long caseId);
int updateStatusIfVersionMatches(CaseStatusUpdateCommand command);
```

Atau untuk atomic state transition:

```java
int transitionStatus(CaseStatusTransitionRecord transition);
```

Dengan SQL yang tetap menjaga correctness, tetapi business decision tetap dikendalikan service/domain layer.

### 8.1 Mapper Boleh Menjaga Data Correctness

Mapper boleh, bahkan harus, menjaga correctness level database:

- update by version,
- update only if current status matches,
- enforce tenant id,
- enforce soft delete filter,
- enforce unique lookup,
- lock row for update,
- insert audit atomically.

Contoh bagus:

```java
int updateStatusIfCurrentStatusMatches(CaseStatusTransitionRow row);
```

SQL:

```sql
UPDATE case_table
SET status = #{newStatus},
    version = version + 1,
    updated_at = #{updatedAt},
    updated_by = #{updatedBy}
WHERE id = #{caseId}
  AND status = #{expectedCurrentStatus}
  AND version = #{expectedVersion}
```

Ini bukan business logic penuh. Ini adalah **database-side guard** untuk mencegah race condition.

---

## 9. Naming Discipline: Mengapa Nama Lebih Penting dari Kelihatannya

Pada codebase kecil, nama buruk masih bisa ditoleransi. Pada codebase besar, nama buruk menjadi hidden tax.

Nama mapper harus menjawab:

1. Entitas/tabel/projection apa yang disentuh?
2. Operasi apa yang dilakukan?
3. Apakah method mengembalikan single row, list, count, atau affected rows?
4. Apakah method nullable?
5. Apakah method mengunci row?
6. Apakah method melakukan update bersyarat?
7. Apakah method hanya membaca projection?
8. Apakah method untuk command/write atau query/read?

---

## 10. Naming Mapper Class

Beberapa pola umum:

### 10.1 Entity/Table-Oriented Mapper

```text
UserMapper
CaseMapper
ApplicationMapper
PaymentMapper
AuditTrailMapper
```

Cocok untuk modul sederhana atau mapper yang dekat dengan satu aggregate/table utama.

### 10.2 Use-Case-Oriented Mapper

```text
CaseSearchMapper
CaseAssignmentMapper
CaseEscalationMapper
ApplicationListingMapper
AuditTrailReportMapper
```

Cocok untuk query kompleks, reporting, listing, dashboard, atau bounded use-case.

### 10.3 Read/Write Split Mapper

```text
CaseCommandMapper
CaseQueryMapper
UserCommandMapper
UserQueryMapper
```

Cocok untuk sistem kompleks dengan banyak projection.

### 10.4 Vendor/Integration-Specific Mapper

```text
OracleAuditTrailMapper
PostgresReportMapper
LegacyCustomerSyncMapper
```

Cocok jika SQL sangat vendor-specific atau terkait integrasi legacy.

### 10.5 Rule Praktis

```text
Jika mapper mulai punya terlalu banyak method yang tidak satu alasan berubah,
pisahkan berdasarkan use-case atau read/write responsibility.
```

Buruk:

```text
CaseMapper
  - selectCaseById
  - searchCaseListing
  - countCaseListing
  - insertCase
  - updateCaseStatus
  - selectDashboardAging
  - selectOfficerWorkload
  - selectCaseAuditExport
  - selectEscalationCandidates
  - lockForAssignment
  - updateAssignment
  - selectMonthlyReport
```

Lebih baik:

```text
CaseCommandMapper
CaseDetailQueryMapper
CaseSearchMapper
CaseDashboardMapper
CaseAssignmentMapper
CaseEscalationMapper
CaseReportMapper
```

---

## 11. Naming XML Namespace

Namespace XML harus sama dengan fully qualified mapper interface.

```xml
<mapper namespace="com.acme.casework.persistence.CaseSearchMapper">
```

Jangan pakai namespace bebas seperti:

```xml
<mapper namespace="caseSearch">
```

Atau:

```xml
<mapper namespace="CaseMapperXml">
```

Kenapa?

Karena mapper interface binding bergantung pada namespace dan statement id.

Dengan namespace yang sama dengan interface:

```text
com.acme.casework.persistence.CaseSearchMapper.search
```

Hubungan method dan SQL menjadi eksplisit.

---

## 12. Naming Statement ID

Statement id biasanya sama dengan nama method.

Interface:

```java
List<CaseSearchRow> search(CaseSearchCriteria criteria);
```

XML:

```xml
<select id="search" parameterType="CaseSearchCriteria" resultMap="CaseSearchRowMap">
```

Ini benar.

Tapi nama method harus punya semantic contract.

---

## 13. Verb Naming Standard

Gunakan verb yang konsisten.

### 13.1 Query Method

| Verb | Makna |
|---|---|
| `select` | mengambil data dari database, netral dan SQL-ish |
| `find` | mengambil optional result, boleh tidak ada |
| `get` | mengambil required result, tidak ada dianggap error di layer atas |
| `list` | mengambil list tanpa search kompleks |
| `search` | mengambil list berdasarkan criteria/filter |
| `count` | menghitung jumlah row |
| `exists` | mengecek keberadaan |
| `lock` | mengambil row dengan locking |

Contoh:

```java
UserRecord selectById(long id);
Optional<UserRecord> findByUsername(String username); // lebih sering di repository, bukan mapper mentah
List<UserRow> listActiveUsers();
List<UserSearchRow> search(UserSearchCriteria criteria);
long count(UserSearchCriteria criteria);
boolean existsByUsername(String username);
CaseRecord lockById(long id);
```

Catatan: MyBatis mapper mentah sering tidak ideal mengembalikan `Optional<T>` di semua versi/proyek, tergantung setup dan style. Untuk kompatibilitas lintas Java 8–25, `T` nullable di mapper lalu dibungkus `Optional` di repository sering lebih eksplisit.

### 13.2 Command Method

| Verb | Makna |
|---|---|
| `insert` | menambah row |
| `update` | mengubah row |
| `delete` | hard delete |
| `softDelete` | logical delete |
| `restore` | membatalkan soft delete |
| `upsert` | insert-or-update, vendor-specific |
| `merge` | biasanya Oracle/SQL Server style merge |
| `mark` | update status sederhana |
| `transition` | state transition |
| `archive` | logical archival |

Contoh:

```java
int insert(UserInsertRow row);
int update(UserUpdateRow row);
int updateIfVersionMatches(UserUpdateRow row);
int softDeleteById(DeleteCommand command);
int transitionStatus(CaseTransitionRow row);
int archiveOlderThan(Instant cutoff);
```

### 13.3 Hindari Nama Terlalu Umum

Buruk:

```java
List<UserRecord> getData(Map<String, Object> params);
int updateData(Map<String, Object> params);
List<Map<String, Object>> query(Map<String, Object> params);
```

Masalah:

- tidak tahu data apa,
- tidak tahu filter apa,
- tidak tahu result shape,
- tidak tahu invariant,
- sulit dicari,
- sulit dites.

Lebih baik:

```java
List<UserSearchRow> searchUsers(UserSearchCriteria criteria);
int updateUserStatus(UserStatusUpdateCommand command);
```

---

## 14. Naming ResultMap

Result map adalah contract mapping. Jangan beri nama generik.

Buruk:

```xml
<resultMap id="BaseResultMap" type="UserRecord">
```

`BaseResultMap` umum di generator, tetapi pada codebase besar bisa membingungkan jika semua mapper punya `BaseResultMap`.

Lebih baik:

```xml
<resultMap id="UserRecordMap" type="com.acme.user.persistence.UserRecord">
```

Untuk projection:

```xml
<resultMap id="UserSearchRowMap" type="com.acme.user.persistence.UserSearchRow">
```

Untuk nested detail:

```xml
<resultMap id="UserDetailGraphMap" type="com.acme.user.persistence.UserDetailGraph">
```

Rule:

```text
resultMap id harus mencerminkan target shape, bukan sekadar posisi di file.
```

---

## 15. Naming SQL Fragment

SQL fragment sering dipakai seperti ini:

```xml
<sql id="BaseColumnList">
  id, username, email, status
</sql>
```

Masalah muncul ketika fragment terlalu generic.

Lebih baik:

```xml
<sql id="UserRecordColumns">
  u.id,
  u.username,
  u.email,
  u.status
</sql>
```

Atau:

```xml
<sql id="UserSearchColumns">
  u.id AS user_id,
  u.username AS username,
  u.email AS email,
  u.status AS status,
  r.name AS primary_role_name
</sql>
```

Jangan membuat fragment yang mencampur terlalu banyak konteks:

```xml
<sql id="CommonJoin">
  LEFT JOIN role r ON ...
  LEFT JOIN department d ON ...
  LEFT JOIN organization o ON ...
</sql>
```

Karena nanti satu fragment dipakai di 10 query dengan asumsi berbeda.

Rule:

```text
SQL fragment boleh dipakai ulang hanya jika semantic context-nya sama,
bukan hanya karena teks SQL-nya kebetulan sama.
```

---

## 16. Parameter Object Naming

Untuk satu parameter sederhana:

```java
UserRecord selectById(long id);
```

Untuk lebih dari satu parameter, ada dua opsi:

```java
UserRecord selectByTenantAndId(@Param("tenantId") long tenantId,
                               @Param("id") long id);
```

Atau command/criteria object:

```java
UserRecord selectByTenantAndId(UserKey key);
```

Untuk operasi yang punya makna business/persistence, lebih baik object.

### 16.1 Criteria Object

Untuk query/search:

```java
public class CaseSearchCriteria {
    private Long tenantId;
    private String keyword;
    private String status;
    private Instant submittedFrom;
    private Instant submittedTo;
    private Integer limit;
    private Integer offset;
    private String sortBy;
    private String sortDirection;
}
```

Nama suffix:

```text
Criteria
Filter
Query
Request   // hati-hati, bisa bercampur dengan API request
```

Rekomendasi:

```text
Gunakan Criteria untuk mapper search filter.
```

Contoh:

```java
List<CaseSearchRow> search(CaseSearchCriteria criteria);
long count(CaseSearchCriteria criteria);
```

### 16.2 Command Object

Untuk write operation:

```java
public class CaseStatusUpdateCommand {
    private long caseId;
    private String expectedStatus;
    private String newStatus;
    private long expectedVersion;
    private String updatedBy;
    private Instant updatedAt;
}
```

Nama suffix:

```text
Command
Row
Mutation
Update
Insert
```

Rekomendasi:

```text
Gunakan Command untuk operasi write yang punya intent.
Gunakan Row untuk object yang merepresentasikan persistence row.
```

Contoh:

```java
int transitionStatus(CaseStatusTransitionCommand command);
```

### 16.3 Key Object

Untuk composite key:

```java
public class TenantUserKey {
    private long tenantId;
    private long userId;
}
```

Mapper:

```java
UserRecord selectByKey(TenantUserKey key);
```

Ini lebih baik daripada banyak `@Param` jika key sering dipakai ulang.

---

## 17. DTO, Record, Domain Object, Projection: Jangan Dicampur Sembarangan

Salah satu masalah terbesar di persistence layer adalah object shape yang tidak jelas.

Ada beberapa jenis object:

### 17.1 Domain Object

```java
public class Case {
    private CaseId id;
    private CaseStatus status;
    private OfficerId assignedOfficer;

    public void assignTo(OfficerId officerId) {
        if (!status.canBeAssigned()) {
            throw new InvalidCaseStateException(status);
        }
        this.assignedOfficer = officerId;
        this.status = CaseStatus.ASSIGNED;
    }
}
```

Domain object mengandung behavior dan invariant.

### 17.2 Persistence Record / Row

```java
public class CaseRecord {
    private Long id;
    private String status;
    private Long assignedOfficerId;
    private Long version;
    private Instant createdAt;
    private Instant updatedAt;
}
```

Persistence record merepresentasikan struktur database atau subset tabel.

### 17.3 Projection Row

```java
public class CaseSearchRow {
    private Long id;
    private String caseNo;
    private String applicantName;
    private String statusLabel;
    private Instant submittedAt;
    private String assignedOfficerName;
}
```

Projection row merepresentasikan hasil query untuk use-case tertentu.

### 17.4 API DTO

```java
public class CaseSearchResponse {
    private String caseNo;
    private String applicantName;
    private String status;
    private String submittedAt;
}
```

API DTO merepresentasikan contract ke client.

### 17.5 Rule Praktis

```text
Mapper sebaiknya return persistence record atau projection row.
Service/repository mengubahnya menjadi domain/API DTO.
```

Jangan biasakan mapper langsung return API response jika API contract tidak identik dengan persistence concern.

Buruk:

```java
List<CaseSearchResponse> searchCases(CaseSearchRequest request);
```

Kenapa buruk?

- mapper tahu API request,
- persistence layer tergantung web layer,
- perubahan API bisa memaksa query berubah,
- sulit reuse query untuk batch/report.

Lebih baik:

```java
List<CaseSearchRow> search(CaseSearchCriteria criteria);
```

Lalu service/application layer convert:

```java
List<CaseSearchResponse> responses = rows.stream()
    .map(CaseSearchResponse::from)
    .toList();
```

Untuk Java 8:

```java
List<CaseSearchResponse> responses = rows.stream()
    .map(CaseSearchResponse::from)
    .collect(Collectors.toList());
```

---

## 18. Java 8 sampai 25: DTO Style Strategy

Karena seri ini mencakup Java 8 hingga 25, gaya DTO perlu dibedakan.

### 18.1 Java 8 Compatible POJO

```java
public class UserSearchRow {
    private Long id;
    private String username;
    private String email;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

Kelebihan:

- paling kompatibel,
- mudah dimapping MyBatis,
- cocok untuk legacy.

Kelemahan:

- mutable,
- boilerplate,
- invariant lemah.

### 18.2 Java 16+ Record

```java
public record UserSearchRow(
    Long id,
    String username,
    String email
) {}
```

Kelebihan:

- ringkas,
- immutable,
- jelas sebagai data carrier.

Kelemahan:

- bukan Java 8 compatible,
- mapping butuh constructor mapping/dukungan yang benar,
- kurang fleksibel untuk beberapa legacy tool.

### 18.3 Strategy Enterprise

Untuk codebase Java 8–11:

```text
Gunakan POJO biasa.
```

Untuk Java 17+ baru:

```text
Record cocok untuk projection/read model immutable.
POJO masih aman untuk command/criteria yang dipopulate framework.
```

Untuk library/shared module lintas Java:

```text
Jangan gunakan record jika masih harus kompatibel dengan Java 8.
```

---

## 19. Struktur Package yang Sehat

Ada beberapa pola.

### 19.1 Package by Layer

```text
com.acme
  controller
  service
  mapper
  dto
  domain
```

Kelebihan:

- mudah untuk aplikasi kecil,
- familiar.

Kelemahan:

- modul bisnis tersebar,
- mapper semua bercampur,
- sulit scale untuk puluhan modul.

### 19.2 Package by Feature/Module

```text
com.acme.casework
  api
  application
  domain
  persistence
    mapper
    row
    criteria
```

Kelebihan:

- ownership jelas,
- module boundary lebih kuat,
- cocok untuk enterprise.

Rekomendasi untuk sistem besar:

```text
package by feature/module, bukan by technical layer global.
```

Contoh:

```text
com.acme.aceas.casework
  application
    CaseAssignmentService.java
    CaseSearchService.java
  domain
    Case.java
    CaseStatus.java
    CaseTransitionPolicy.java
  persistence
    CaseCommandMapper.java
    CaseSearchMapper.java
    CaseAssignmentMapper.java
    row
      CaseRecord.java
      CaseSearchRow.java
      CaseAssignmentRow.java
    criteria
      CaseSearchCriteria.java
    command
      CaseStatusTransitionCommand.java
```

---

## 20. Struktur Resource XML Mapper

XML mapper harus mudah ditemukan dari interface.

### 20.1 Mirror Package Structure

Java:

```text
src/main/java/com/acme/casework/persistence/CaseSearchMapper.java
```

XML:

```text
src/main/resources/com/acme/casework/persistence/CaseSearchMapper.xml
```

Kelebihan:

- mudah dicari,
- nama konsisten,
- classpath scanning jelas.

### 20.2 Central Mapper Folder

```text
src/main/resources/mapper/casework/CaseSearchMapper.xml
src/main/resources/mapper/user/UserMapper.xml
```

Kelebihan:

- semua SQL terkumpul,
- DBA/reviewer mudah mencari.

Kelemahan:

- jarak dari Java interface lebih jauh,
- package mismatch lebih mudah terjadi.

### 20.3 Rekomendasi

Untuk enterprise modular:

```text
Mirror package structure lebih aman.
```

Namun jika organisasi punya SQL review process terpusat, central mapper folder bisa diterima asal naming dan namespace ketat.

---

## 21. Mapper Scanning dan Registration Discipline

Di Spring Boot, mapper biasanya discan dengan:

```java
@MapperScan("com.acme")
@SpringBootApplication
public class Application {
}
```

Atau per module:

```java
@Configuration
@MapperScan(
    basePackages = "com.acme.casework.persistence",
    sqlSessionFactoryRef = "caseSqlSessionFactory"
)
public class CaseworkMyBatisConfig {
}
```

### 21.1 Jangan Scan Terlalu Luas Tanpa Alasan

Buruk:

```java
@MapperScan("com")
```

Masalah:

- bisa mengambil interface yang bukan mapper,
- startup scanning lebih luas,
- multi datasource bisa salah factory,
- konflik bean lebih sulit dipahami.

Lebih baik:

```java
@MapperScan("com.acme.aceas.casework.persistence")
```

Atau untuk banyak modul:

```java
@MapperScan({
    "com.acme.aceas.casework.persistence",
    "com.acme.aceas.application.persistence",
    "com.acme.aceas.audit.persistence"
})
```

### 21.2 Multi Datasource

Jika aplikasi punya lebih dari satu datasource, mapper scan harus eksplisit.

```java
@Configuration
@MapperScan(
    basePackages = "com.acme.audit.persistence",
    sqlSessionFactoryRef = "auditSqlSessionFactory",
    sqlSessionTemplateRef = "auditSqlSessionTemplate"
)
public class AuditMyBatisConfig {
}
```

Kalau tidak eksplisit, mapper bisa memakai datasource yang salah.

Ini bukan bug kecil. Dalam sistem production, ini bisa berarti:

- query membaca database salah,
- transaksi tidak konsisten,
- data tenant bocor,
- write masuk schema yang salah.

---

## 22. Boundary antara Mapper dan Repository

Mapper sebaiknya tidak memutuskan semantic application-level error.

Buruk:

```java
public interface UserMapper {
    User mustFindActiveUserById(long id);
}
```

Mapper tidak bisa melempar `UserNotFoundException` kecuali pakai custom wrapper. Lebih baik:

```java
UserRecord selectActiveById(long id);
```

Repository/service:

```java
public User getActiveUser(long id) {
    UserRecord record = userMapper.selectActiveById(id);
    if (record == null) {
        throw new UserNotFoundException(id);
    }
    return toDomain(record);
}
```

Mapper contract:

```text
Saya menjalankan query dan mengembalikan row jika ada.
```

Repository/service contract:

```text
Saya menafsirkan absence sebagai business/application condition.
```

---

## 23. Mapper Method Return Type Discipline

Return type harus mencerminkan contract.

### 23.1 Single Row Nullable

```java
UserRecord selectById(long id);
```

Makna:

```text
0 row => null
1 row => object
>1 row => error/too many results
```

Cocok untuk primary key/unique lookup.

### 23.2 List

```java
List<UserSearchRow> search(UserSearchCriteria criteria);
```

Makna:

```text
0 row => empty list
n row => list
```

Jangan return `null` untuk list.

### 23.3 Count

```java
long count(UserSearchCriteria criteria);
```

Gunakan `long`, bukan `int`, untuk count besar.

### 23.4 Exists

```java
boolean existsByUsername(String username);
```

SQL-nya bisa vendor-specific:

```sql
SELECT CASE WHEN COUNT(1) > 0 THEN 1 ELSE 0 END
```

Atau lebih efisien dengan `EXISTS`, tergantung database.

### 23.5 Affected Rows untuk Write

```java
int updateStatus(UserStatusUpdateCommand command);
```

Return `int` penting sebagai correctness signal.

Contoh:

```java
int updated = userMapper.updateStatus(command);
if (updated != 1) {
    throw new ConcurrentModificationException("User status update failed");
}
```

Jangan abaikan return count untuk update critical.

---

## 24. Mapper Method Parameter Discipline

### 24.1 Satu Parameter Sederhana

```java
UserRecord selectById(long id);
```

Aman.

### 24.2 Banyak Parameter dengan `@Param`

```java
UserRecord selectByTenantAndUsername(@Param("tenantId") long tenantId,
                                     @Param("username") String username);
```

XML:

```xml
WHERE tenant_id = #{tenantId}
  AND username = #{username}
```

### 24.3 Hindari Parameter Posisi Implisit

Jangan mengandalkan `param1`, `param2` kecuali sangat terpaksa.

Buruk:

```xml
WHERE tenant_id = #{param1}
  AND username = #{param2}
```

Masalah:

- refactor parameter order bisa merusak query,
- SQL sulit dipahami,
- reviewer tidak tahu arti `param1`.

### 24.4 Hindari `Map<String, Object>` sebagai Default

Buruk:

```java
List<UserSearchRow> search(Map<String, Object> params);
```

Masalah:

- tidak type-safe,
- typo baru ketahuan runtime,
- tidak ada schema parameter,
- sulit refactor,
- IDE tidak membantu,
- test harus menebak key.

Lebih baik:

```java
List<UserSearchRow> search(UserSearchCriteria criteria);
```

Map masih boleh untuk:

- generic utility internal,
- legacy integration,
- dynamic metadata query,
- migration sementara.

Tapi jangan jadikan gaya utama.

---

## 25. Column Naming Discipline

Result mapping yang sehat bergantung pada column naming.

Buruk:

```sql
SELECT *
FROM app_user u
JOIN role r ON r.id = u.role_id
```

Masalah:

- kolom `id` ambigu,
- kolom `created_at` ambigu,
- result mapping bisa salah,
- perubahan tabel menambah kolom bisa mempengaruhi result,
- payload lebih besar.

Lebih baik:

```sql
SELECT
  u.id AS user_id,
  u.username AS username,
  u.email AS email,
  r.id AS role_id,
  r.name AS role_name
FROM app_user u
LEFT JOIN role r ON r.id = u.role_id
```

DTO:

```java
public class UserWithRoleRow {
    private Long userId;
    private String username;
    private String email;
    private Long roleId;
    private String roleName;
}
```

Rule:

```text
Jangan gunakan SELECT * di mapper production, kecuali untuk eksplorasi sementara.
```

---

## 26. XML Formatting Discipline

SQL formatting bukan kosmetik. Formatting menentukan readability, diff quality, dan review quality.

### 26.1 Recommended Formatting

```xml
<select id="search" parameterType="CaseSearchCriteria" resultMap="CaseSearchRowMap">
  SELECT
    c.id AS case_id,
    c.case_no AS case_no,
    c.status AS status,
    c.submitted_at AS submitted_at,
    a.name AS applicant_name,
    o.display_name AS officer_name
  FROM case_table c
  JOIN applicant a ON a.id = c.applicant_id
  LEFT JOIN officer o ON o.id = c.assigned_officer_id
  <where>
    c.tenant_id = #{tenantId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
    <if test="submittedFrom != null">
      AND c.submitted_at &gt;= #{submittedFrom}
    </if>
    <if test="submittedTo != null">
      AND c.submitted_at &lt; #{submittedTo}
    </if>
  </where>
  ORDER BY c.submitted_at DESC, c.id DESC
</select>
```

### 26.2 Formatting Rules

```text
1. Satu kolom SELECT per baris untuk query non-trivial.
2. Selalu pakai alias untuk join query.
3. Alias kolom harus cocok dengan target property atau resultMap.
4. WHERE base invariant ditulis paling atas.
5. Dynamic filter ditulis setelah invariant wajib.
6. ORDER BY eksplisit.
7. Hindari SELECT *.
8. Hindari dynamic ORDER BY tanpa whitelist.
```

---

## 27. Mapper Granularity: Berapa Banyak Method per Mapper?

Tidak ada angka absolut. Tapi ada indikator.

Mapper mulai terlalu besar jika:

- lebih dari 20–30 method dengan alasan berubah berbeda,
- file XML lebih dari 700–1000 baris,
- ada query unrelated dalam satu namespace,
- banyak `sql` fragment dipakai silang tanpa jelas,
- konflik resultMap naming,
- sulit mencari method yang benar,
- perubahan satu use-case berisiko mempengaruhi query lain.

### 27.1 Split by Responsibility

Sebelum:

```text
ApplicationMapper
```

Sesudah:

```text
ApplicationCommandMapper
ApplicationDetailMapper
ApplicationSearchMapper
ApplicationRenewalMapper
ApplicationReportMapper
ApplicationAuditMapper
```

### 27.2 Jangan Over-Split

Terlalu banyak mapper juga buruk.

Buruk:

```text
FindApplicationByIdMapper
UpdateApplicationStatusMapper
CountApplicationMapper
```

Kecuali kamu punya generated code architecture yang memang begitu, ini terlalu granular.

Rule:

```text
Satu mapper harus punya satu cohesive reason to change.
```

---

## 28. Read Mapper vs Write Mapper

Pada sistem kompleks, pisahkan read dan write.

```java
public interface CaseCommandMapper {
    int insert(CaseInsertRow row);
    int updateStatus(CaseStatusUpdateCommand command);
    int updateAssignment(CaseAssignmentUpdateCommand command);
}
```

```java
public interface CaseQueryMapper {
    CaseRecord selectById(long id);
    CaseRecord lockById(long id);
    List<CaseSearchRow> search(CaseSearchCriteria criteria);
    long count(CaseSearchCriteria criteria);
}
```

Lebih spesifik lagi:

```java
CaseSearchMapper
CaseDetailMapper
CaseAssignmentMapper
CaseCommandMapper
```

### 28.1 Kapan Read/Write Split Berguna

- Query listing sangat kompleks.
- Write butuh optimistic locking.
- Read model berbeda dari write model.
- Reporting query banyak.
- Ada CQRS ringan.
- Ada access control berbeda antara read dan write.

### 28.2 Kapan Tidak Perlu

- CRUD sederhana.
- Modul kecil.
- Tim kecil.
- Query sedikit.

---

## 29. Mapper untuk Search Screen

Search screen adalah sumber dynamic SQL paling umum.

Jangan desain seperti ini:

```java
List<Map<String, Object>> search(Map<String, Object> params);
```

Desain lebih sehat:

```java
public interface CaseSearchMapper {
    List<CaseSearchRow> search(CaseSearchCriteria criteria);
    long count(CaseSearchCriteria criteria);
}
```

Criteria:

```java
public class CaseSearchCriteria {
    private Long tenantId;
    private String keyword;
    private String status;
    private Instant submittedFrom;
    private Instant submittedTo;
    private Long assignedOfficerId;
    private int limit;
    private int offset;
    private CaseSearchSort sort;
}
```

Sort enum:

```java
public enum CaseSearchSort {
    SUBMITTED_AT_DESC("c.submitted_at DESC, c.id DESC"),
    SUBMITTED_AT_ASC("c.submitted_at ASC, c.id ASC"),
    CASE_NO_ASC("c.case_no ASC, c.id ASC");

    private final String orderBySql;

    CaseSearchSort(String orderBySql) {
        this.orderBySql = orderBySql;
    }

    public String orderBySql() {
        return orderBySql;
    }
}
```

XML dynamic ORDER BY harus hati-hati. Jangan langsung:

```xml
ORDER BY ${sortBy} ${sortDirection}
```

Itu injection boundary.

Lebih aman whitelist di Java lalu hanya inject known-safe fragment, atau gunakan `<choose>`:

```xml
<choose>
  <when test="sort == 'CASE_NO_ASC'">
    ORDER BY c.case_no ASC, c.id ASC
  </when>
  <when test="sort == 'SUBMITTED_AT_ASC'">
    ORDER BY c.submitted_at ASC, c.id ASC
  </when>
  <otherwise>
    ORDER BY c.submitted_at DESC, c.id DESC
  </otherwise>
</choose>
```

---

## 30. Mapper untuk State Transition

Untuk sistem workflow/case management, update status tidak boleh sekadar:

```java
int updateStatus(@Param("id") long id,
                 @Param("status") String status);
```

Itu terlalu lemah.

Lebih baik:

```java
int transitionStatus(CaseStatusTransitionCommand command);
```

Command:

```java
public class CaseStatusTransitionCommand {
    private long caseId;
    private String expectedStatus;
    private String newStatus;
    private long expectedVersion;
    private String transitionedBy;
    private Instant transitionedAt;
}
```

SQL:

```xml
<update id="transitionStatus" parameterType="CaseStatusTransitionCommand">
  UPDATE case_table
  SET status = #{newStatus},
      version = version + 1,
      updated_by = #{transitionedBy},
      updated_at = #{transitionedAt}
  WHERE id = #{caseId}
    AND status = #{expectedStatus}
    AND version = #{expectedVersion}
</update>
```

Service:

```java
int updated = caseCommandMapper.transitionStatus(command);
if (updated != 1) {
    throw new CaseTransitionConflictException(command.getCaseId());
}
```

Mental model:

```text
Domain/service menentukan apakah transition valid.
Mapper menjaga atomicity terhadap concurrent update.
```

---

## 31. Mapper untuk Multi-Tenant / Agency Isolation

Jika sistem punya tenant/agency/module isolation, jangan jadikan tenant filter opsional.

Buruk:

```java
CaseRecord selectById(long caseId);
```

Lebih aman:

```java
CaseRecord selectByTenantAndId(@Param("tenantId") long tenantId,
                               @Param("caseId") long caseId);
```

Atau:

```java
CaseRecord selectByKey(TenantCaseKey key);
```

SQL:

```sql
WHERE tenant_id = #{tenantId}
  AND id = #{caseId}
```

Untuk sistem yang sangat sensitif, jadikan tenant key bagian dari semua mapper method yang menyentuh tenant data.

Rule:

```text
Jika data scoped by tenant, tenantId bukan filter tambahan.
TenantId adalah bagian dari identity boundary.
```

---

## 32. Mapper untuk Soft Delete

Soft delete harus konsisten.

Buruk:

```java
UserRecord selectById(long id);
```

Dengan SQL sebagian query:

```sql
WHERE id = #{id}
```

Sebagian lain:

```sql
WHERE id = #{id}
  AND deleted_at IS NULL
```

Ini rawan bug.

Lebih jelas:

```java
UserRecord selectActiveById(long id);
UserRecord selectIncludingDeletedById(long id);
```

Nama method harus menunjukkan visibility.

Search normal:

```xml
WHERE deleted_at IS NULL
```

Admin/audit query:

```java
UserRecord selectIncludingDeletedById(long id);
```

Rule:

```text
Default mapper query harus mengikuti visibility normal.
Query yang bypass soft delete harus eksplisit dari nama method.
```

---

## 33. Mapper untuk Audit dan History

Audit mapper sering berbeda dari operational mapper.

Jangan campur semua audit query ke mapper utama jika audit punya struktur dan volume besar.

```text
CaseMapper
CaseAuditMapper
CaseHistoryMapper
```

Audit query biasanya punya karakteristik:

- append-only,
- time-range query,
- actor filter,
- module filter,
- CLOB/JSON payload,
- pagination berat,
- export besar,
- retention/archive.

Karena karakteristiknya beda, mapper-nya juga sebaiknya beda.

Contoh:

```java
public interface AuditTrailSearchMapper {
    List<AuditTrailSearchRow> search(AuditTrailSearchCriteria criteria);
    long count(AuditTrailSearchCriteria criteria);
}
```

```java
public interface AuditTrailCommandMapper {
    int insert(AuditTrailInsertRow row);
}
```

---

## 34. Anti-Pattern: Generic CRUD Mapper untuk Semua Hal

Banyak tim tergoda membuat generic mapper:

```java
public interface CrudMapper<T, ID> {
    T selectById(ID id);
    int insert(T entity);
    int update(T entity);
    int deleteById(ID id);
}
```

Lalu semua mapper extend ini.

Masalah:

- SQL tetap harus ditulis per entity,
- method terlalu generic,
- tidak mengekspresikan invariant,
- update full object rawan overwrite,
- tidak cocok untuk optimistic locking khusus,
- tidak cocok untuk tenant filter,
- tidak cocok untuk soft delete visibility,
- tidak cocok untuk projection.

Generic CRUD bisa berguna untuk generated code atau internal admin tool, tetapi berbahaya untuk domain critical.

Untuk production domain, lebih baik explicit mapper method.

Buruk:

```java
int update(CaseRecord record);
```

Lebih jelas:

```java
int updateCaseDetails(CaseDetailsUpdateCommand command);
int transitionStatus(CaseStatusTransitionCommand command);
int assignOfficer(CaseAssignmentCommand command);
```

---

## 35. Anti-Pattern: Mapper Return `Map<String, Object>`

Contoh buruk:

```java
List<Map<String, Object>> searchCases(Map<String, Object> params);
```

Kenapa buruk:

- tidak ada compile-time contract,
- typo column baru ketahuan runtime,
- caller harus tahu string key,
- refactor kolom sulit,
- API mapping fragile,
- test tidak jelas,
- documentation tersembunyi.

Kapan masih boleh?

- query metadata,
- admin SQL explorer,
- dynamic report builder,
- migration tool,
- temporary legacy bridge.

Untuk business query, gunakan projection class.

---

## 36. Anti-Pattern: Mapper Method Terlalu Business-Specific tapi SQL Tidak Menjamin Invariant

Contoh:

```java
int approveApplication(long applicationId);
```

SQL:

```sql
UPDATE application
SET status = 'APPROVED'
WHERE id = #{applicationId}
```

Nama method terdengar business-safe, tetapi SQL tidak mengecek:

- status sebelumnya,
- version,
- approver,
- tenant,
- deleted flag,
- lock/concurrency.

Lebih jujur:

```java
int updateStatusById(ApplicationStatusUpdateCommand command);
```

Atau lebih kuat:

```java
int transitionStatus(ApplicationStatusTransitionCommand command);
```

SQL:

```sql
WHERE id = #{applicationId}
  AND tenant_id = #{tenantId}
  AND status = #{expectedStatus}
  AND version = #{expectedVersion}
  AND deleted_at IS NULL
```

Nama method harus sesuai dengan kekuatan invariant SQL.

---

## 37. Anti-Pattern: One Mapper per Table Secara Buta

Mapper per table tampak natural:

```text
UserTableMapper
RoleTableMapper
UserRoleTableMapper
DepartmentTableMapper
```

Tapi use-case sering butuh projection lintas tabel.

Kalau semua query harus melewati mapper per table, service bisa menjadi assembler manual:

```java
User user = userMapper.selectById(id);
List<UserRole> roles = userRoleMapper.selectByUserId(id);
Department department = departmentMapper.selectById(user.getDepartmentId());
```

Ini bisa menjadi N+1 manual.

Untuk read use-case, lebih baik punya projection mapper:

```java
UserDetailRow selectUserDetail(long userId);
```

Dengan SQL join yang eksplisit.

Rule:

```text
Write mapper sering dekat dengan table/aggregate.
Read mapper sering dekat dengan use-case/projection.
```

---

## 38. Anti-Pattern: SQL Fragment Terlalu Pintar

Contoh:

```xml
<sql id="DynamicWhere">
  <where>
    <if test="id != null">AND id = #{id}</if>
    <if test="name != null">AND name LIKE #{name}</if>
    <if test="status != null">AND status = #{status}</if>
    <if test="createdFrom != null">AND created_at &gt;= #{createdFrom}</if>
    <if test="createdTo != null">AND created_at &lt; #{createdTo}</if>
    <if test="tenantId != null">AND tenant_id = #{tenantId}</if>
  </where>
</sql>
```

Dipakai di banyak query.

Masalah:

- fragment punya terlalu banyak asumsi,
- query yang harus wajib tenantId menjadi opsional,
- kolom mungkin tidak ada di semua table alias,
- sulit audit filter keamanan,
- perubahan satu filter mempengaruhi banyak query.

Lebih baik fragment kecil dan context-specific.

```xml
<sql id="CaseTenantInvariant">
  c.tenant_id = #{tenantId}
</sql>
```

```xml
<sql id="CaseSearchOptionalFilters">
  <if test="status != null">
    AND c.status = #{status}
  </if>
  <if test="submittedFrom != null">
    AND c.submitted_at &gt;= #{submittedFrom}
  </if>
</sql>
```

---

## 39. Mapper Review Checklist

Sebelum merge mapper baru, review hal berikut.

### 39.1 Contract

- Apakah nama method jelas?
- Apakah return type sesuai contract?
- Apakah nullable behavior jelas?
- Apakah affected row count digunakan untuk write critical?
- Apakah method terlalu generic?

### 39.2 SQL

- Apakah `SELECT *` dihindari?
- Apakah alias kolom jelas?
- Apakah join condition benar?
- Apakah filter wajib selalu ada?
- Apakah ORDER BY stabil?
- Apakah pagination aman?
- Apakah count query sesuai search query?

### 39.3 Security

- Apakah `#{}` digunakan untuk value binding?
- Apakah `${}` hanya untuk whitelist-safe identifier?
- Apakah tenant/agency filter wajib ada?
- Apakah soft delete visibility benar?
- Apakah row-level authorization tidak terlewat?

### 39.4 Mapping

- Apakah resultMap explicit untuk query kompleks?
- Apakah column alias cocok dengan property?
- Apakah primitive field tidak menerima nullable column?
- Apakah enum/type handler jelas?

### 39.5 Performance

- Apakah query memakai index-friendly predicate?
- Apakah dynamic filter tidak menghancurkan index?
- Apakah IN list punya batas?
- Apakah large result dipaginate/stream?
- Apakah N+1 dihindari?

### 39.6 Maintainability

- Apakah mapper terlalu besar?
- Apakah SQL fragment masuk akal?
- Apakah XML dan interface mudah ditemukan?
- Apakah test mencakup branch dynamic SQL?
- Apakah naming konsisten dengan modul lain?

---

## 40. Template Struktur Mapper yang Direkomendasikan

### 40.1 Interface

```java
package com.acme.casework.persistence;

import java.util.List;

public interface CaseSearchMapper {

    List<CaseSearchRow> search(CaseSearchCriteria criteria);

    long count(CaseSearchCriteria criteria);
}
```

### 40.2 Criteria

```java
package com.acme.casework.persistence;

import java.time.Instant;

public class CaseSearchCriteria {
    private Long tenantId;
    private String keyword;
    private String status;
    private Instant submittedFrom;
    private Instant submittedTo;
    private Integer limit;
    private Integer offset;
    private String sort;

    public Long getTenantId() {
        return tenantId;
    }

    public void setTenantId(Long tenantId) {
        this.tenantId = tenantId;
    }

    public String getKeyword() {
        return keyword;
    }

    public void setKeyword(String keyword) {
        this.keyword = keyword;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getSubmittedFrom() {
        return submittedFrom;
    }

    public void setSubmittedFrom(Instant submittedFrom) {
        this.submittedFrom = submittedFrom;
    }

    public Instant getSubmittedTo() {
        return submittedTo;
    }

    public void setSubmittedTo(Instant submittedTo) {
        this.submittedTo = submittedTo;
    }

    public Integer getLimit() {
        return limit;
    }

    public void setLimit(Integer limit) {
        this.limit = limit;
    }

    public Integer getOffset() {
        return offset;
    }

    public void setOffset(Integer offset) {
        this.offset = offset;
    }

    public String getSort() {
        return sort;
    }

    public void setSort(String sort) {
        this.sort = sort;
    }
}
```

### 40.3 Row Projection

```java
package com.acme.casework.persistence;

import java.time.Instant;

public class CaseSearchRow {
    private Long caseId;
    private String caseNo;
    private String applicantName;
    private String status;
    private Instant submittedAt;
    private String assignedOfficerName;

    public Long getCaseId() {
        return caseId;
    }

    public void setCaseId(Long caseId) {
        this.caseId = caseId;
    }

    public String getCaseNo() {
        return caseNo;
    }

    public void setCaseNo(String caseNo) {
        this.caseNo = caseNo;
    }

    public String getApplicantName() {
        return applicantName;
    }

    public void setApplicantName(String applicantName) {
        this.applicantName = applicantName;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public void setSubmittedAt(Instant submittedAt) {
        this.submittedAt = submittedAt;
    }

    public String getAssignedOfficerName() {
        return assignedOfficerName;
    }

    public void setAssignedOfficerName(String assignedOfficerName) {
        this.assignedOfficerName = assignedOfficerName;
    }
}
```

### 40.4 XML Mapper

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
  PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "https://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.acme.casework.persistence.CaseSearchMapper">

  <resultMap id="CaseSearchRowMap" type="com.acme.casework.persistence.CaseSearchRow">
    <id property="caseId" column="case_id" />
    <result property="caseNo" column="case_no" />
    <result property="applicantName" column="applicant_name" />
    <result property="status" column="status" />
    <result property="submittedAt" column="submitted_at" />
    <result property="assignedOfficerName" column="assigned_officer_name" />
  </resultMap>

  <sql id="CaseSearchColumns">
    c.id AS case_id,
    c.case_no AS case_no,
    a.name AS applicant_name,
    c.status AS status,
    c.submitted_at AS submitted_at,
    o.display_name AS assigned_officer_name
  </sql>

  <sql id="CaseSearchFrom">
    FROM case_table c
    JOIN applicant a ON a.id = c.applicant_id
    LEFT JOIN officer o ON o.id = c.assigned_officer_id
  </sql>

  <sql id="CaseSearchWhere">
    <where>
      c.tenant_id = #{tenantId}
      AND c.deleted_at IS NULL

      <if test="keyword != null and keyword != ''">
        AND (
          LOWER(c.case_no) LIKE LOWER(CONCAT('%', #{keyword}, '%'))
          OR LOWER(a.name) LIKE LOWER(CONCAT('%', #{keyword}, '%'))
        )
      </if>

      <if test="status != null and status != ''">
        AND c.status = #{status}
      </if>

      <if test="submittedFrom != null">
        AND c.submitted_at &gt;= #{submittedFrom}
      </if>

      <if test="submittedTo != null">
        AND c.submitted_at &lt; #{submittedTo}
      </if>
    </where>
  </sql>

  <select id="search" parameterType="com.acme.casework.persistence.CaseSearchCriteria"
          resultMap="CaseSearchRowMap">
    SELECT
      <include refid="CaseSearchColumns" />
    <include refid="CaseSearchFrom" />
    <include refid="CaseSearchWhere" />

    <choose>
      <when test="sort == 'CASE_NO_ASC'">
        ORDER BY c.case_no ASC, c.id ASC
      </when>
      <when test="sort == 'SUBMITTED_AT_ASC'">
        ORDER BY c.submitted_at ASC, c.id ASC
      </when>
      <otherwise>
        ORDER BY c.submitted_at DESC, c.id DESC
      </otherwise>
    </choose>

    LIMIT #{limit}
    OFFSET #{offset}
  </select>

  <select id="count" parameterType="com.acme.casework.persistence.CaseSearchCriteria"
          resultType="long">
    SELECT COUNT(1)
    <include refid="CaseSearchFrom" />
    <include refid="CaseSearchWhere" />
  </select>

</mapper>
```

Catatan: `LIMIT/OFFSET` adalah contoh gaya PostgreSQL/MySQL. Untuk Oracle/SQL Server, pagination akan berbeda dan akan dibahas khusus pada bagian pagination dan vendor-awareness.

---

## 41. Desain Mapper untuk Codebase 50+ Modul

Untuk codebase besar, disiplin mapper bukan opsional. Ia harus menjadi governance.

### 41.1 Standard Folder

```text
module-name
  src/main/java
    com/acme/module/application
    com/acme/module/domain
    com/acme/module/persistence
      XxxCommandMapper.java
      XxxSearchMapper.java
      XxxDetailMapper.java
      row/
      criteria/
      command/
  src/main/resources
    com/acme/module/persistence
      XxxCommandMapper.xml
      XxxSearchMapper.xml
      XxxDetailMapper.xml
```

### 41.2 Standard Naming

```text
Mapper:
  XxxCommandMapper
  XxxQueryMapper
  XxxSearchMapper
  XxxDetailMapper
  XxxReportMapper

Criteria:
  XxxSearchCriteria
  XxxReportCriteria

Command:
  XxxInsertCommand
  XxxUpdateCommand
  XxxStatusTransitionCommand

Row:
  XxxRecord
  XxxSearchRow
  XxxDetailRow
  XxxReportRow

ResultMap:
  XxxRecordMap
  XxxSearchRowMap
  XxxDetailRowMap
```

### 41.3 Standard Review Rules

```text
1. Semua query harus punya owner module.
2. Semua query kompleks harus punya explicit resultMap.
3. Semua search query harus punya count strategy.
4. Semua write critical harus check affected rows.
5. Semua tenant data query harus menyertakan tenant boundary.
6. Semua dynamic ORDER BY harus whitelist.
7. Semua mapper baru harus punya test minimal untuk load XML dan satu happy path.
8. Tidak ada SELECT *.
9. Tidak ada Map return untuk business query.
10. Tidak ada generic update tanpa invariant untuk workflow/stateful data.
```

---

## 42. Decision Framework: XML vs Annotation vs Dynamic SQL Library

Walaupun bagian ini fokus XML/annotation, penting juga menempatkan MyBatis Dynamic SQL library.

Gunakan decision table berikut.

| Kebutuhan | XML | Annotation | Dynamic SQL Library |
|---|---:|---:|---:|
| Query pendek | Bisa | Sangat cocok | Bisa, tapi mungkin overkill |
| Query panjang | Sangat cocok | Kurang cocok | Bisa |
| Dynamic filter banyak | Cocok | Kurang cocok | Sangat cocok jika butuh type-safe builder |
| SQL harus mudah direview DBA | Sangat cocok | Sedang | Sedang |
| Refactor column type-safe | Lemah | Lemah | Lebih kuat |
| Vendor-specific SQL | Sangat cocok | Bisa | Bisa tapi kadang canggung |
| ResultMap kompleks | Sangat cocok | Kurang cocok | Tetap butuh mapping |
| Java 8 compatibility | Cocok | Cocok | Tergantung versi library |
| Readability untuk non-Java SQL reviewer | Sangat cocok | Kurang | Kurang/sedang |

Rule praktis:

```text
XML untuk SQL sebagai artifact.
Annotation untuk trivial SQL.
Dynamic SQL library untuk programmatic query generation yang butuh type-safety.
```

---

## 43. Failure Model Mapper Design

Desain mapper yang buruk menghasilkan failure pattern tertentu.

### 43.1 Invalid Bound Statement

Gejala:

```text
org.apache.ibatis.binding.BindingException: Invalid bound statement (not found)
```

Penyebab umum:

- XML tidak ter-load,
- namespace salah,
- statement id tidak cocok dengan method,
- mapper location salah,
- resource tidak masuk build output,
- package scan salah.

Pencegahan:

- mirror namespace dengan interface,
- test context startup,
- test semua mapper statement,
- standard folder.

### 43.2 Too Many Results

Gejala:

```text
Expected one result (or null) to be returned by selectOne(), but found: n
```

Penyebab:

- method single row tapi SQL tidak unique,
- missing tenant filter,
- missing status filter,
- data duplicate,
- wrong join multiplicity.

Pencegahan:

- nama method jelas,
- unique constraint,
- limit tidak menyelesaikan root cause,
- test duplicate scenario.

### 43.3 Silent Wrong Mapping

Gejala:

- field null padahal database ada,
- field tertukar,
- nested object salah,
- enum salah.

Penyebab:

- alias salah,
- auto mapping ambiguous,
- `SELECT *`,
- duplicate column names,
- primitive field menerima null.

Pencegahan:

- explicit resultMap,
- column alias,
- no `SELECT *`,
- mapping test.

### 43.4 Security Filter Missing

Gejala:

- user melihat data tenant lain,
- deleted data muncul,
- role-level data bocor.

Penyebab:

- tenant filter opsional,
- method terlalu generic,
- fragment dynamic where terlalu pintar,
- no review checklist.

Pencegahan:

- tenant key object,
- naming explicit,
- mandatory where invariant,
- mapper review security checklist.

---

## 44. Mental Model Akhir

Mapper design yang baik bukan tentang membuat SQL lebih pendek. Mapper design yang baik adalah membuat persistence layer punya:

```text
Clear contract
  Method name, parameter, return type jelas.

Clear ownership
  Mapper punya module/use-case owner.

Clear mapping
  Result shape explicit.

Clear boundary
  Mapper tidak menjadi domain service.

Clear invariants
  Tenant, soft delete, version, status guard tidak accidental.

Clear operational behavior
  Query bisa dilog, dites, ditrace, dan direview.
```

MyBatis memberi kebebasan besar. Tanpa disiplin, kebebasan itu berubah menjadi SQL sprawl. Dengan disiplin, MyBatis menjadi persistence layer yang sangat eksplisit, kuat, dan cocok untuk sistem enterprise yang perlu kontrol penuh atas SQL.

---

## 45. Ringkasan Praktis

Gunakan aturan berikut sebagai baseline:

```text
1. Treat mapper interface as persistence contract.
2. Use XML for serious SQL.
3. Use annotation only for trivial SQL.
4. Keep namespace equal to fully qualified mapper interface.
5. Keep statement id equal to method name.
6. Avoid SELECT *.
7. Avoid Map parameter/return for business query.
8. Use Criteria for search.
9. Use Command for write intent.
10. Use Row/Record/Projection for mapper return.
11. Keep domain object out of raw mapper unless intentionally designed.
12. Split mapper by cohesive reason to change.
13. Make tenant/soft-delete/security filters explicit and mandatory.
14. Check affected rows for critical writes.
15. Prefer explicit resultMap for complex query.
16. Whitelist dynamic ORDER BY.
17. Keep XML and interface easy to find together.
18. Test mapper loading and dynamic SQL branches.
```

---

## 46. Latihan

### Latihan 1 — Refactor Mapper Buruk

Diberikan mapper:

```java
public interface DataMapper {
    List<Map<String, Object>> getData(Map<String, Object> params);
    int updateData(Map<String, Object> params);
}
```

Tugas:

1. Tentukan minimal 5 masalah desain.
2. Pecah menjadi mapper yang lebih cohesive.
3. Buat criteria object.
4. Buat projection row.
5. Tentukan naming method yang lebih jelas.

### Latihan 2 — Search Mapper

Desain mapper untuk screen pencarian application dengan filter:

- tenantId,
- applicationNo,
- applicantName,
- status,
- submittedFrom,
- submittedTo,
- assignedOfficerId,
- pagination,
- sorting by submitted date/application no.

Tentukan:

- mapper interface,
- criteria class,
- row projection,
- XML skeleton,
- count strategy,
- sort whitelist strategy.

### Latihan 3 — State Transition Mapper

Desain mapper untuk transition:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Tentukan:

- command object,
- mapper method,
- SQL update dengan expected status dan version,
- service-side affected row handling.

---

## 47. Penutup

Bagian ini menutup fondasi desain mapper. Setelah ini, kita bisa masuk lebih konkret ke statement mapping: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, generated keys, rows affected, idempotency, dan write correctness.

Bagian berikutnya:

```text
04-sql-statement-mapping-select-insert-update-delete-deep-dive.md
```

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./02-java-8-to-25-mybatis-version-strategy-and-compatibility.md">⬅️ Part 2 — Java 8 to 25 MyBatis Version Strategy and Compatibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./04-sql-statement-mapping-select-insert-update-delete-deep-dive.md">Part 4 — SQL Statement Mapping: SELECT, INSERT, UPDATE, DELETE Deep Dive ➡️</a>
</div>
