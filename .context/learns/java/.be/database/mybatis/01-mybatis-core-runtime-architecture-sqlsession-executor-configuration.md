# 01 — MyBatis Core Runtime Architecture: `SqlSession`, `Executor`, `Configuration`

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> Bagian: `01`  
> File: `01-mybatis-core-runtime-architecture-sqlsession-executor-configuration.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: memahami mesin internal MyBatis dari mapper method sampai JDBC dan result object.

---

## 0. Tujuan Pembelajaran

Di Part 0, kita sudah membangun posisi mental MyBatis sebagai **SQL-first persistence framework**. MyBatis bukan ORM penuh yang mencoba menyembunyikan database, dan bukan juga JDBC mentah yang memaksa kita menulis boilerplate `Connection`, `PreparedStatement`, `ResultSet`, dan mapping manual berulang-ulang.

Part 1 masuk ke pertanyaan yang lebih dalam:

> Ketika kode Java memanggil `userMapper.findById(10L)`, apa yang sebenarnya terjadi di dalam MyBatis?

Setelah menyelesaikan bagian ini, kamu harus bisa menjelaskan:

1. bagaimana MyBatis membaca konfigurasi;
2. bagaimana XML/annotation mapper berubah menjadi `MappedStatement`;
3. bagaimana mapper interface menjadi proxy;
4. bagaimana method call diterjemahkan menjadi statement id;
5. bagaimana dynamic SQL diproses menjadi `BoundSql`;
6. bagaimana parameter Java diikat ke JDBC placeholder;
7. bagaimana `Executor` memilih cara eksekusi;
8. bagaimana `StatementHandler`, `ParameterHandler`, dan `ResultSetHandler` bekerja;
9. bagaimana result set berubah menjadi object Java;
10. di mana cache, transaction, plugin, dan error dapat muncul.

Targetnya bukan hafal nama class, tetapi memiliki **runtime mental model** yang cukup kuat untuk debugging, performance tuning, custom interceptor, dan troubleshooting production.

---

## 1. Gambaran Besar Runtime MyBatis

MyBatis bisa terlihat sederhana dari luar:

```java
User user = userMapper.findById(10L);
```

Tetapi di bawahnya, call tersebut melewati beberapa lapisan:

```text
Application Service
    |
    v
Mapper Interface Proxy
    |
    v
MapperMethod
    |
    v
SqlSession
    |
    v
Executor
    |
    v
MappedStatement + BoundSql
    |
    v
StatementHandler
    |
    +--> ParameterHandler
    |
    v
JDBC PreparedStatement / CallableStatement / Statement
    |
    v
Database
    |
    v
JDBC ResultSet / update count
    |
    v
ResultSetHandler
    |
    v
Java Object / List / Cursor / Map / affected rows
```

Satu mapper method bukan sekadar “memanggil SQL”. Ia adalah perjalanan dari **Java method invocation** menuju **database command execution**, lalu kembali menjadi **Java result contract**.

Mental model paling penting:

```text
Mapper method = public API
MappedStatement = compiled metadata of SQL operation
BoundSql = SQL final + parameter mapping for one invocation
Executor = execution strategy
StatementHandler = JDBC statement preparation
ParameterHandler = bind Java values into SQL placeholders
ResultSetHandler = map database rows into Java objects
```

Kalau kamu bisa memisahkan lima hal ini, debugging MyBatis menjadi jauh lebih sistematis.

---

## 2. Komponen Utama

### 2.1 `SqlSessionFactoryBuilder`

`SqlSessionFactoryBuilder` adalah builder yang membaca konfigurasi dan menghasilkan `SqlSessionFactory`.

Pada penggunaan MyBatis murni:

```java
try (Reader reader = Resources.getResourceAsReader("mybatis-config.xml")) {
    SqlSessionFactory sqlSessionFactory = new SqlSessionFactoryBuilder().build(reader);
}
```

Di aplikasi Spring Boot modern, kamu jarang membuat ini manual karena auto-configuration atau `SqlSessionFactoryBean` akan membangunnya.

Karakteristik penting:

| Komponen | Sifat |
|---|---|
| `SqlSessionFactoryBuilder` | builder sementara |
| Digunakan saat startup | ya |
| Disimpan sebagai singleton runtime | tidak perlu |
| Thread-safe untuk dipakai terus-menerus | bukan fokus penggunaannya |

Rule praktis:

> `SqlSessionFactoryBuilder` adalah objek bootstrap. Setelah `SqlSessionFactory` jadi, builder tidak penting lagi.

---

### 2.2 `SqlSessionFactory`

`SqlSessionFactory` adalah pabrik untuk membuat `SqlSession`.

Di MyBatis murni:

```java
try (SqlSession session = sqlSessionFactory.openSession()) {
    UserMapper mapper = session.getMapper(UserMapper.class);
    User user = mapper.findById(10L);
    session.commit();
}
```

Di Spring, kamu biasanya tidak memanggil `openSession()` manual. Spring mengelola session dan transaction melalui `SqlSessionTemplate`.

Karakteristik:

| Komponen | Sifat |
|---|---|
| `SqlSessionFactory` | long-lived, biasanya singleton |
| Membuat `SqlSession` | ya |
| Menyimpan `Configuration` | ya |
| Thread-safe sebagai factory | secara praktik dipakai sebagai singleton |

Mental model:

```text
SqlSessionFactory = compiled persistence runtime
```

Ia bukan koneksi database langsung. Ia tahu cara membuat session, tahu konfigurasi mapper, tahu environment, tahu transaction factory, dan tahu semua statement yang sudah terdaftar.

---

### 2.3 `SqlSession`

`SqlSession` adalah API utama MyBatis untuk:

- menjalankan mapped statement;
- mengambil mapper proxy;
- melakukan commit/rollback pada mode non-Spring;
- mengontrol transaction/session lifecycle;
- mengakses koneksi jika diperlukan.

Contoh direct API:

```java
User user = session.selectOne("com.example.UserMapper.findById", 10L);
```

Contoh mapper API:

```java
UserMapper mapper = session.getMapper(UserMapper.class);
User user = mapper.findById(10L);
```

Kedua style tersebut pada akhirnya menuju mapped statement yang sama.

Hal yang harus sangat jelas:

> `SqlSession` bukan object yang bebas disimpan sebagai field singleton lalu dipakai banyak thread.

Di MyBatis murni, session harus dibuka, dipakai, commit/rollback, lalu ditutup. Di Spring, session lifecycle dikelola oleh `SqlSessionTemplate` dan transaction synchronization.

---

### 2.4 `Configuration`

`Configuration` adalah pusat metadata runtime MyBatis.

Ia menyimpan:

- registered mapper;
- `MappedStatement`;
- `ResultMap`;
- `ParameterMap` lama;
- `TypeAlias`;
- `TypeHandler`;
- plugin/interceptor;
- object factory;
- object wrapper factory;
- reflector factory;
- environment;
- settings seperti `mapUnderscoreToCamelCase`, `localCacheScope`, `defaultExecutorType`, dan lain-lain.

Mental model:

```text
Configuration = in-memory registry of MyBatis runtime knowledge
```

Ketika MyBatis selesai bootstrap, file XML mapper tidak lagi dibaca setiap query. Ia sudah di-parse menjadi object metadata di dalam `Configuration`.

---

## 3. Apa Itu `MappedStatement`?

`MappedStatement` adalah representasi internal untuk satu statement MyBatis.

Contoh XML:

```xml
<select id="findById" parameterType="long" resultMap="UserResultMap">
  SELECT id, username, email, status
  FROM users
  WHERE id = #{id}
</select>
```

Secara konseptual akan menjadi:

```text
MappedStatement
  id: com.example.UserMapper.findById
  sqlSource: ...
  statementType: PREPARED
  sqlCommandType: SELECT
  parameterMap: ...
  resultMaps: [UserResultMap]
  timeout: ...
  fetchSize: ...
  flushCacheRequired: ...
  useCache: ...
  keyGenerator: ...
```

Statement id biasanya terdiri dari:

```text
namespace + "." + statement id
```

Misalnya:

```text
com.example.user.UserMapper.findById
```

Mapper interface:

```java
package com.example.user;

public interface UserMapper {
    User findById(Long id);
}
```

XML mapper:

```xml
<mapper namespace="com.example.user.UserMapper">
  <select id="findById" resultMap="UserResultMap">
    SELECT id, username, email
    FROM users
    WHERE id = #{id}
  </select>
</mapper>
```

Keduanya bertemu melalui full statement id:

```text
com.example.user.UserMapper.findById
```

Ini sangat penting untuk troubleshooting.

Jika muncul error:

```text
Invalid bound statement (not found): com.example.user.UserMapper.findById
```

Artinya MyBatis tidak menemukan `MappedStatement` dengan id tersebut di `Configuration`.

Penyebab umum:

1. XML mapper tidak ter-load.
2. Namespace XML tidak sama dengan fully qualified interface name.
3. Method name tidak sama dengan statement id.
4. Resource path salah.
5. Mapper belum di-scan.
6. Build tool tidak memasukkan XML ke classpath.

---

## 4. Apa Itu `BoundSql`?

`MappedStatement` adalah metadata statement. Tetapi satu statement bisa menghasilkan SQL final berbeda tergantung parameter.

Contoh dynamic SQL:

```xml
<select id="searchUsers" resultMap="UserResultMap">
  SELECT id, username, email, status
  FROM users
  <where>
    <if test="username != null and username != ''">
      username LIKE #{usernameLike}
    </if>
    <if test="status != null">
      AND status = #{status}
    </if>
  </where>
  ORDER BY id DESC
</select>
```

Jika parameter:

```java
new UserSearchCriteria(null, "ACTIVE")
```

Maka SQL final bisa menjadi:

```sql
SELECT id, username, email, status
FROM users
WHERE status = ?
ORDER BY id DESC
```

Jika parameter:

```java
new UserSearchCriteria("fajar%", "ACTIVE")
```

Maka SQL final bisa menjadi:

```sql
SELECT id, username, email, status
FROM users
WHERE username LIKE ?
  AND status = ?
ORDER BY id DESC
```

Inilah `BoundSql`:

```text
BoundSql
  sql: final SQL string with ? placeholders
  parameterMappings: ordered parameter binding metadata
  parameterObject: original Java parameter object
  additionalParameters: values from dynamic SQL context, foreach, bind, etc.
```

Mental model:

```text
MappedStatement + invocation parameter -> BoundSql
```

`BoundSql` hanya berlaku untuk satu invocation. Ia bukan global metadata seperti `MappedStatement`.

---

## 5. Mapper Interface Proxy

Ketika kamu menulis:

```java
@Mapper
public interface UserMapper {
    User findById(Long id);
}
```

MyBatis tidak membuat class implementasi manual seperti:

```java
public class UserMapperImpl implements UserMapper { ... }
```

Sebaliknya, MyBatis membuat proxy.

Secara konseptual:

```text
UserMapper proxy
  intercept method call findById(10L)
  resolve statement id com.example.UserMapper.findById
  determine command type SELECT
  call SqlSession.selectOne(statementId, parameter)
```

Pseudo-flow:

```java
Object invoke(Object proxy, Method method, Object[] args) {
    String statementId = mapperInterface.getName() + "." + method.getName();
    MappedStatement ms = configuration.getMappedStatement(statementId);
    Object parameter = convertArgsToParameterObject(method, args);

    if (ms.getSqlCommandType() == SELECT) {
        if (returnsList(method)) {
            return sqlSession.selectList(statementId, parameter);
        }
        return sqlSession.selectOne(statementId, parameter);
    }

    if (ms.getSqlCommandType() == INSERT) {
        return rowCountResult(sqlSession.insert(statementId, parameter));
    }

    if (ms.getSqlCommandType() == UPDATE) {
        return rowCountResult(sqlSession.update(statementId, parameter));
    }

    if (ms.getSqlCommandType() == DELETE) {
        return rowCountResult(sqlSession.delete(statementId, parameter));
    }
}
```

Tentu implementasi asli lebih kompleks, tetapi mental model ini cukup akurat untuk memahami runtime behavior.

---

## 6. Dari Method Argument Menjadi Parameter Object

Mapper method bisa memiliki satu parameter:

```java
User findById(Long id);
```

Bisa juga banyak parameter:

```java
List<User> findByStatusAndRole(String status, String role);
```

Tanpa `@Param`, multiple parameter akan dipetakan dengan nama internal seperti `param1`, `param2`, atau arg name tergantung compiler parameter metadata dan konfigurasi.

Praktik yang lebih eksplisit:

```java
List<User> findByStatusAndRole(
    @Param("status") String status,
    @Param("role") String role
);
```

XML:

```xml
<select id="findByStatusAndRole" resultMap="UserResultMap">
  SELECT id, username, status, role
  FROM users
  WHERE status = #{status}
    AND role = #{role}
</select>
```

Untuk query yang kompleks, lebih baik gunakan parameter object:

```java
public class UserSearchCriteria {
    private String username;
    private String status;
    private LocalDate createdFrom;
    private LocalDate createdTo;
    private Integer limit;
    private Integer offset;
}
```

Mapper:

```java
List<UserListItem> search(UserSearchCriteria criteria);
```

XML:

```xml
<select id="search" parameterType="UserSearchCriteria" resultMap="UserListItemResultMap">
  SELECT id, username, status, created_at
  FROM users
  <where>
    <if test="username != null and username != ''">
      username LIKE #{username}
    </if>
    <if test="status != null">
      AND status = #{status}
    </if>
    <if test="createdFrom != null">
      AND created_at &gt;= #{createdFrom}
    </if>
    <if test="createdTo != null">
      AND created_at &lt; #{createdTo}
    </if>
  </where>
  ORDER BY created_at DESC, id DESC
</select>
```

Rule top-tier:

> Mapper method dengan lebih dari 2–3 parameter biasanya lebih sehat jika diganti menjadi parameter object yang dinamai sesuai use case.

Karena parameter object menjadi contract yang bisa divalidasi, dites, dan dikembangkan tanpa membuat method signature tumbuh liar.

---

## 7. `Executor`: Strategy Eksekusi Statement

`Executor` adalah komponen yang menjalankan operasi database atas nama `SqlSession`.

Secara konseptual, `SqlSession` adalah API, sedangkan `Executor` adalah engine.

MyBatis memiliki beberapa executor type utama:

| Executor Type | Tujuan |
|---|---|
| `SIMPLE` | membuat statement setiap eksekusi |
| `REUSE` | mencoba reuse prepared statement |
| `BATCH` | melakukan batching update/insert/delete |

### 7.1 `SIMPLE`

`SIMPLE` adalah default yang aman untuk banyak kasus.

Mental model:

```text
for each query/update:
  prepare statement
  bind parameters
  execute
  close statement
```

Kelebihan:

- perilaku mudah dipahami;
- cocok untuk mayoritas CRUD/query biasa;
- risiko state lebih rendah.

Kekurangan:

- tidak mengoptimalkan reuse statement di sisi MyBatis;
- batch operation tidak optimal.

---

### 7.2 `REUSE`

`REUSE` mencoba menggunakan ulang prepared statement.

Mental model:

```text
same SQL within same session -> reuse prepared statement
```

Kelebihan:

- bisa mengurangi overhead prepare statement pada pola tertentu.

Kekurangan:

- manfaatnya tergantung driver/database/pooling;
- session lifecycle harus jelas;
- tidak selalu layak menjadi default global tanpa pengukuran.

---

### 7.3 `BATCH`

`BATCH` digunakan untuk batch DML.

Mental model:

```text
collect multiple update/insert/delete
flush to database later
```

Contoh konsep:

```java
try (SqlSession session = sqlSessionFactory.openSession(ExecutorType.BATCH)) {
    UserMapper mapper = session.getMapper(UserMapper.class);

    for (User user : users) {
        mapper.insert(user);
    }

    session.flushStatements();
    session.commit();
}
```

Kelebihan:

- performa lebih baik untuk banyak DML;
- mengurangi roundtrip.

Risiko:

- error bisa muncul saat flush, bukan saat method `insert()` dipanggil;
- partial failure harus dimodelkan;
- memory bisa naik jika batch terlalu besar;
- generated key behavior bisa vendor-specific;
- transaction size bisa terlalu besar.

Rule praktis:

> `BATCH` bukan sekadar “lebih cepat”. Ia mengubah timing error, memory behavior, dan failure semantics.

Batch akan dibahas detail di Part 16.

---

## 8. `StatementHandler`: Membuat dan Menjalankan JDBC Statement

Setelah executor menerima request, MyBatis perlu membuat JDBC statement.

Komponen yang bertanggung jawab adalah `StatementHandler`.

Tipe statement umum:

| Statement Type | JDBC Object | Kegunaan |
|---|---|---|
| `STATEMENT` | `Statement` | SQL tanpa parameter binding prepared statement |
| `PREPARED` | `PreparedStatement` | mayoritas query/DML dengan `?` placeholder |
| `CALLABLE` | `CallableStatement` | stored procedure/function |

Mayoritas mapper production menggunakan `PREPARED`.

Flow konseptual:

```text
Executor
  -> create StatementHandler
  -> ask StatementHandler.prepare(connection)
  -> StatementHandler.parameterize(statement)
  -> StatementHandler.query/update(statement)
```

`StatementHandler` juga menjadi titik umum bagi plugin/interceptor, misalnya:

- menambahkan pagination;
- mencatat SQL final;
- menambahkan tenant filter;
- mengukur durasi query;
- memodifikasi SQL sebelum eksekusi.

Tetapi plugin di titik ini berisiko tinggi karena menyentuh SQL final. Kita bahas lebih dalam di Part 29.

---

## 9. `ParameterHandler`: Binding Java Value ke JDBC Placeholder

Contoh SQL final:

```sql
SELECT id, username, email
FROM users
WHERE status = ?
  AND created_at >= ?
```

Parameter mapping:

```text
1 -> status
2 -> createdFrom
```

`ParameterHandler` mengambil value dari parameter object, lalu mengikatnya ke `PreparedStatement`.

Konseptual:

```java
preparedStatement.setString(1, criteria.getStatus());
preparedStatement.setObject(2, criteria.getCreatedFrom());
```

Tapi MyBatis tidak sekadar memanggil `setObject` sembarangan. Ia menggunakan `TypeHandler`.

Contoh:

| Java Type | JDBC Binding |
|---|---|
| `String` | `setString` |
| `Integer` | `setInt` / null-aware handling |
| `Long` | `setLong` / null-aware handling |
| `BigDecimal` | `setBigDecimal` |
| `LocalDate` | type handler sesuai driver/config |
| `Enum` | by name, ordinal, atau custom code |
| custom value object | custom `TypeHandler` |

Inilah kenapa `TypeHandler` adalah bagian penting dari runtime architecture.

Mental model:

```text
ParameterHandler = parameter extraction + TypeHandler-based JDBC binding
```

---

## 10. `ResultSetHandler`: Mapping Row ke Object

Setelah database mengembalikan `ResultSet`, MyBatis perlu membuat object Java.

Contoh result set:

| id | username | email | status |
|---:|---|---|---|
| 10 | fajar | fajar@example.com | ACTIVE |

Target object:

```java
public class User {
    private Long id;
    private String username;
    private String email;
    private UserStatus status;
}
```

Dengan `resultMap`:

```xml
<resultMap id="UserResultMap" type="User">
  <id property="id" column="id" />
  <result property="username" column="username" />
  <result property="email" column="email" />
  <result property="status" column="status" typeHandler="UserStatusTypeHandler" />
</resultMap>
```

`ResultSetHandler` bertugas:

1. membaca metadata result set;
2. membaca setiap row;
3. membuat object target;
4. mengisi property atau constructor arg;
5. memakai `TypeHandler` untuk membaca nilai JDBC;
6. menangani nested result mapping;
7. menangani association/collection;
8. mengembalikan object/list/cursor sesuai mapper contract.

Mental model:

```text
ResultSetHandler = JDBC row -> Java object graph
```

Bagian ini terlihat sederhana, tetapi banyak bug production berasal dari sini:

- column alias salah;
- property typo;
- auto mapping salah sasaran;
- joined query menghasilkan duplicate parent;
- primitive menerima null;
- enum value tidak dikenal;
- nested collection meledakkan memory;
- constructor mapping gagal karena arg name/type tidak match.

---

## 11. Lifecycle Lengkap Query SELECT

Misal mapper:

```java
public interface UserMapper {
    User findById(@Param("id") Long id);
}
```

XML:

```xml
<mapper namespace="com.example.user.UserMapper">
  <resultMap id="UserResultMap" type="com.example.user.User">
    <id property="id" column="id" />
    <result property="username" column="username" />
    <result property="email" column="email" />
  </resultMap>

  <select id="findById" resultMap="UserResultMap">
    SELECT id, username, email
    FROM users
    WHERE id = #{id}
  </select>
</mapper>
```

Invocation:

```java
User user = userMapper.findById(10L);
```

Runtime flow:

```text
1. Application calls UserMapper proxy method findById(10L)
2. Proxy resolves method to statement id:
     com.example.user.UserMapper.findById
3. MapperMethod decides command type = SELECT
4. MapperMethod calls SqlSession.selectOne(statementId, parameter)
5. SqlSession delegates to Executor.query(...)
6. Executor checks local cache if applicable
7. Executor obtains MappedStatement from Configuration
8. MappedStatement generates BoundSql using parameter object
9. Executor creates StatementHandler
10. StatementHandler prepares JDBC PreparedStatement
11. ParameterHandler binds id = 10L into placeholder
12. JDBC executes SQL
13. Database returns ResultSet
14. ResultSetHandler maps row into User object
15. Executor stores result in local cache if applicable
16. SqlSession returns result to mapper proxy
17. Mapper proxy returns User to application
```

This is the core mental model.

Jika error muncul, tanyakan:

| Error muncul di tahap | Kemungkinan penyebab |
|---|---|
| statement resolving | mapper XML tidak terdaftar, namespace/id salah |
| BoundSql generation | dynamic SQL/OGNL error, property tidak ada |
| parameter binding | type handler salah, null JDBC type, parameter name salah |
| JDBC execution | SQL syntax, permission, constraint, timeout, deadlock |
| result mapping | column/property mismatch, enum/type conversion, duplicate row |
| return contract | terlalu banyak row untuk `selectOne`, null primitive, wrong collection type |

---

## 12. Lifecycle INSERT/UPDATE/DELETE

Untuk DML, flow mirip SELECT tetapi hasil akhirnya berbeda.

Mapper:

```java
int updateEmail(@Param("id") Long id, @Param("email") String email);
```

XML:

```xml
<update id="updateEmail">
  UPDATE users
  SET email = #{email},
      updated_at = CURRENT_TIMESTAMP
  WHERE id = #{id}
</update>
```

Invocation:

```java
int rows = userMapper.updateEmail(10L, "new@example.com");
```

Runtime flow:

```text
1. Mapper proxy resolves statement id
2. SqlSession.update(...)
3. Executor.update(...)
4. Cache invalidation if required
5. MappedStatement -> BoundSql
6. StatementHandler prepares PreparedStatement
7. ParameterHandler binds values
8. JDBC executeUpdate()
9. Database returns affected row count
10. MyBatis adapts row count to mapper return type
```

Return type DML bisa berupa:

```java
int updateEmail(...);
long updateEmail(...);       // depending mapping/adapter behavior and usage
boolean updateEmail(...);    // true if affected rows > 0, but use carefully
void updateEmail(...);       // hides correctness signal
```

Untuk production-grade code, `int` sering paling jelas karena affected rows adalah correctness signal.

Contoh optimistic update:

```xml
<update id="approveIfVersionMatches">
  UPDATE case_file
  SET status = 'APPROVED',
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = #{id}
    AND status = 'PENDING_REVIEW'
    AND version = #{expectedVersion}
</update>
```

Mapper:

```java
int approveIfVersionMatches(
    @Param("id") Long id,
    @Param("expectedVersion") Long expectedVersion
);
```

Service:

```java
int rows = caseMapper.approveIfVersionMatches(id, expectedVersion);
if (rows == 0) {
    throw new ConcurrentModificationException("Case was already changed");
}
```

Di sini row count bukan detail teknis. Ia adalah bagian dari business correctness.

---

## 13. Local Cache: Cache Level Pertama

MyBatis memiliki local cache di level session.

Secara default, dalam satu session, hasil query tertentu dapat disimpan untuk:

- mencegah circular reference pada nested query;
- mempercepat repeated nested query;
- menghindari query identik berulang dalam session yang sama.

Mental model:

```text
SqlSession local cache = short-lived identity/result cache within session boundary
```

Contoh MyBatis murni:

```java
try (SqlSession session = sqlSessionFactory.openSession()) {
    UserMapper mapper = session.getMapper(UserMapper.class);

    User a = mapper.findById(10L);
    User b = mapper.findById(10L);

    // Depending configuration and query behavior,
    // second call may be served from local session cache.
}
```

Setting penting:

```xml
<settings>
  <setting name="localCacheScope" value="SESSION" />
</settings>
```

Alternatif:

```xml
<settings>
  <setting name="localCacheScope" value="STATEMENT" />
</settings>
```

Konsep:

| Scope | Arti |
|---|---|
| `SESSION` | cache berlaku selama session |
| `STATEMENT` | cache hanya dipakai selama statement execution |

Risiko salah paham:

> Local cache bukan Redis, bukan application cache global, dan bukan jaminan data fresh lintas transaction.

Dalam Spring, session sering terikat ke transaction. Maka local cache behavior harus dipahami bersama transaction boundary.

Part 17 akan membahas cache secara detail.

---

## 14. Second-Level Cache

Selain local cache, MyBatis juga menyediakan second-level cache per mapper namespace.

Di XML:

```xml
<mapper namespace="com.example.user.UserMapper">
  <cache />

  <select id="findById" resultMap="UserResultMap" useCache="true">
    SELECT id, username, email
    FROM users
    WHERE id = #{id}
  </select>
</mapper>
```

Mental model:

```text
Second-level cache = namespace-level cache beyond one SqlSession
```

Namun untuk enterprise system, second-level cache harus dipakai hati-hati karena:

- invalidation sulit;
- data stale bisa merusak correctness;
- object harus aman untuk disimpan/cache;
- transaksi dan cache visibility perlu dipahami;
- update dari aplikasi lain tidak otomatis diketahui;
- observability cache sering kurang jelas.

Rule praktis:

> Jangan aktifkan second-level cache hanya karena tersedia. Aktifkan hanya jika freshness model, invalidation model, dan ownership data jelas.

---

## 15. Transaction Boundary di Runtime

Di MyBatis murni:

```java
try (SqlSession session = sqlSessionFactory.openSession(false)) {
    UserMapper mapper = session.getMapper(UserMapper.class);

    mapper.insert(user);
    mapper.insertProfile(profile);

    session.commit();
} catch (Exception e) {
    session.rollback();
    throw e;
}
```

Di Spring:

```java
@Service
public class UserService {
    private final UserMapper userMapper;
    private final UserProfileMapper profileMapper;

    @Transactional
    public void createUser(CreateUserCommand command) {
        userMapper.insert(command.toUser());
        profileMapper.insert(command.toProfile());
    }
}
```

Dengan Spring, mapper tidak membuka/commit/rollback transaction sendiri. Spring transaction manager mengatur connection dan session binding.

Mental model:

```text
Service method transaction boundary
    -> Spring binds connection/session to current thread/transaction
    -> MyBatis mapper participates in same transaction
    -> commit/rollback happens at service boundary
```

Anti-pattern:

```java
public interface UserMapper {
    // Mapper should not encode transaction lifecycle conceptually.
    void createUserAndCommit(User user);
}
```

Mapper seharusnya mengeksekusi SQL operation. Transaction orchestration tetap di service/application layer.

---

## 16. Spring Integration Mental Model

Dalam aplikasi Spring, mapper injection tampak seperti ini:

```java
@Service
public class UserService {
    private final UserMapper userMapper;

    public UserService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }
}
```

Yang sebenarnya terjadi secara konseptual:

```text
Spring context
  -> scans mapper interfaces
  -> creates MapperFactoryBean / mapper proxy
  -> uses SqlSessionTemplate
  -> SqlSessionTemplate delegates to transaction-bound SqlSession
  -> MyBatis Executor executes statements
```

`SqlSessionTemplate` penting karena ia adalah thread-safe facade untuk MyBatis session usage di Spring.

Tanpa Spring:

```text
You manage SqlSession lifecycle manually
```

Dengan Spring:

```text
Spring manages SqlSession lifecycle based on transaction context
```

Ini menjelaskan kenapa dalam Spring kamu tidak menulis:

```java
sqlSession.commit();
sqlSession.close();
```

pada service biasa.

---

## 17. Configuration Settings yang Sangat Berpengaruh

MyBatis punya banyak setting. Untuk Part 1, fokus pada yang berdampak besar ke runtime behavior.

### 17.1 `mapUnderscoreToCamelCase`

```xml
<setting name="mapUnderscoreToCamelCase" value="true" />
```

Mengizinkan mapping:

```text
created_at -> createdAt
updated_by -> updatedBy
```

Kelebihan:

- mengurangi mapping boilerplate.

Risiko:

- auto mapping bisa menyembunyikan mismatch;
- joined query dengan nama kolom ambigu tetap butuh alias eksplisit.

Rule:

> Untuk query sederhana boleh membantu, tetapi untuk query join/projection penting tetap gunakan alias dan `resultMap` eksplisit.

---

### 17.2 `autoMappingBehavior`

Mengontrol seberapa agresif MyBatis melakukan auto mapping.

Nilai umum:

| Nilai | Makna |
|---|---|
| `NONE` | tidak auto-map |
| `PARTIAL` | auto-map result sederhana |
| `FULL` | auto-map lebih agresif termasuk nested mapping |

Rule:

> Semakin kompleks query, semakin explicit mapping lebih aman daripada full auto mapping.

---

### 17.3 `autoMappingUnknownColumnBehavior`

Mengontrol behavior ketika ada kolom yang tidak bisa dimapping.

Nilai umum:

| Nilai | Makna |
|---|---|
| `NONE` | diam saja |
| `WARNING` | log warning |
| `FAILING` | throw error |

Untuk sistem yang menuntut correctness tinggi, `WARNING` atau `FAILING` perlu dipertimbangkan di test environment.

Kenapa?

Karena silent mapping error bisa menyebabkan bug halus:

```sql
SELECT user_id, user_name
FROM users
```

Target:

```java
class User {
    private Long id;
    private String username;
}
```

Tanpa alias/resultMap yang benar, object bisa terisi null tanpa error keras.

---

### 17.4 `defaultExecutorType`

```xml
<setting name="defaultExecutorType" value="SIMPLE" />
```

Nilai:

- `SIMPLE`
- `REUSE`
- `BATCH`

Rule:

> Jangan menjadikan `BATCH` sebagai default global tanpa alasan kuat. Batch adalah use-case khusus.

---

### 17.5 `localCacheScope`

```xml
<setting name="localCacheScope" value="SESSION" />
```

Atau:

```xml
<setting name="localCacheScope" value="STATEMENT" />
```

Rule:

> Pahami efek local cache sebelum mendiagnosis “query tidak jalan dua kali” atau “data tampak stale dalam transaction yang sama”.

---

### 17.6 `lazyLoadingEnabled`

Mengaktifkan lazy loading nested association.

Risiko:

- N+1 query;
- query terjadi saat object diserialisasi;
- session sudah tertutup;
- behavior sulit diprediksi.

Rule:

> Untuk service/API modern, explicit fetch/projection sering lebih aman daripada lazy loading object graph.

---

## 18. XML Parsing dan Build-Time/Startup Failure

MyBatis membaca mapper XML saat startup atau saat `SqlSessionFactory` dibangun.

Kesalahan XML bisa muncul sebagai startup failure:

```xml
<select id="findById" resultMap="UserResultMap">
  SELECT id, username
  FROM users
  WHERE id = #{id
</select>
```

Kurang `}` dapat menyebabkan parsing/binding error.

Kesalahan lain:

```xml
<resultMap id="UserResultMap" type="User">
  <result property="usernmae" column="username" />
</resultMap>
```

Typo `usernmae` mungkin baru terlihat saat mapping, tergantung konfigurasi dan akses property.

Ada dua kelas error:

| Kelas Error | Kapan muncul |
|---|---|
| mapper XML malformed | startup/building factory |
| statement/property/runtime binding | saat statement dipanggil |

Top-tier practice:

> Buat test yang memastikan semua mapper XML loaded dan statement penting bisa dieksekusi minimal terhadap database test.

---

## 19. Plugin/Interceptor di Runtime Chain

MyBatis menyediakan plugin mechanism untuk mengintercept beberapa titik runtime.

Titik umum:

- `Executor`;
- `StatementHandler`;
- `ParameterHandler`;
- `ResultSetHandler`.

Contoh use case:

| Intercept Target | Use Case |
|---|---|
| `Executor` | metrics, query counting, cache behavior observation |
| `StatementHandler` | pagination SQL rewrite, SQL logging, tenant SQL injection |
| `ParameterHandler` | parameter masking/logging |
| `ResultSetHandler` | result inspection, mapping metrics |

Namun plugin adalah pisau tajam.

Risiko:

- hidden behavior;
- sulit di-debug;
- SQL berubah tanpa terlihat di mapper XML;
- performance overhead;
- compatibility issue saat upgrade;
- bug hanya muncul pada SQL tertentu.

Rule:

> Pakai interceptor untuk concern lintas-mapper yang benar-benar stabil, bukan untuk menutupi desain mapper yang buruk.

---

## 20. Object Creation: ObjectFactory, Reflection, Constructor

MyBatis perlu membuat object hasil mapping.

Untuk JavaBean mutable:

```java
public class User {
    private Long id;
    private String username;

    public User() {}

    public void setId(Long id) { this.id = id; }
    public void setUsername(String username) { this.username = username; }
}
```

MyBatis bisa:

1. membuat object dengan no-args constructor;
2. mengisi property via setter/reflection.

Untuk immutable object:

```java
public class UserView {
    private final Long id;
    private final String username;

    public UserView(Long id, String username) {
        this.id = id;
        this.username = username;
    }
}
```

Perlu constructor mapping:

```xml
<resultMap id="UserViewResultMap" type="UserView">
  <constructor>
    <idArg column="id" javaType="long" />
    <arg column="username" javaType="string" />
  </constructor>
</resultMap>
```

Untuk Java record modern:

```java
public record UserView(Long id, String username) {}
```

Mapping bisa memanfaatkan constructor/arg-name behavior tergantung versi, compiler flag, dan konfigurasi. Ini akan dibahas detail di Part 7.

Mental model:

```text
ResultSetHandler does not magically know your intent.
It needs a reliable object creation and property/constructor mapping path.
```

---

## 21. Error Model Berdasarkan Komponen Runtime

Salah satu manfaat memahami arsitektur internal adalah bisa mendiagnosis error secara cepat.

### 21.1 Error: Mapper Statement Tidak Ditemukan

Pesan umum:

```text
Invalid bound statement (not found): com.example.UserMapper.findById
```

Lapisan bermasalah:

```text
Mapper proxy -> Configuration/MappedStatement registry
```

Kemungkinan:

- namespace salah;
- id XML salah;
- XML tidak masuk classpath;
- `mapper-locations` salah;
- mapper scanning salah;
- interface method belum punya statement;
- annotation/XML conflict.

Diagnosis:

1. cek fully qualified interface name;
2. cek namespace XML;
3. cek statement id;
4. cek resource build output;
5. cek Spring Boot `mybatis.mapper-locations`;
6. cek test startup mapper.

---

### 21.2 Error: Parameter Tidak Ditemukan

Pesan umum:

```text
Parameter 'status' not found. Available parameters are [arg1, arg0, param1, param2]
```

Lapisan bermasalah:

```text
Mapper method args -> parameter object -> BoundSql/ParameterHandler
```

Penyebab:

```java
List<User> find(String status, String role);
```

XML:

```xml
WHERE status = #{status}
  AND role = #{role}
```

Tanpa `@Param`, nama `status` dan `role` mungkin tidak tersedia.

Fix:

```java
List<User> find(
    @Param("status") String status,
    @Param("role") String role
);
```

Atau gunakan parameter object.

---

### 21.3 Error: Too Many Results

Mapper:

```java
User findByEmail(String email);
```

SQL:

```sql
SELECT id, email
FROM users
WHERE email = ?
```

Jika database mengembalikan dua row, `selectOne` akan gagal.

Lapisan bermasalah:

```text
Result cardinality -> mapper return contract
```

Fix yang benar bukan asal mengganti return menjadi `List<User>`.

Pertanyaan desain:

- Apakah email harus unique?
- Apakah data corrupt?
- Apakah query kurang filter tenant/soft delete?
- Apakah mapper method name misleading?

Top-tier approach:

> Treat cardinality error as contract violation, not just exception handling problem.

---

### 21.4 Error: Invalid Column / Property Mapping

Lapisan bermasalah:

```text
ResultSetHandler -> resultMap/auto mapping
```

Penyebab:

- column alias tidak sesuai;
- property typo;
- join menghasilkan nama kolom duplikat;
- resultMap salah type;
- `mapUnderscoreToCamelCase` diasumsikan tetapi mati.

Fix:

- gunakan alias eksplisit;
- gunakan `resultMap` eksplisit;
- aktifkan warning/failing untuk unknown column di test;
- buat mapper integration test.

---

### 21.5 Error: Data Tampak Stale

Lapisan potensial:

```text
Local cache / second-level cache / transaction isolation / database snapshot
```

Jangan langsung menyalahkan database.

Checklist:

1. Apakah query terjadi dalam `SqlSession` yang sama?
2. Apakah `localCacheScope=SESSION`?
3. Apakah second-level cache aktif?
4. Apakah transaction isolation membuat snapshot?
5. Apakah update dilakukan di transaction lain yang belum commit?
6. Apakah read replica lag?
7. Apakah aplikasi memakai cache lain di atas MyBatis?

---

## 22. Runtime Architecture dalam Spring Boot

Contoh dependency umum:

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>${mybatis.spring.boot.version}</version>
</dependency>
```

Contoh konfigurasi:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  type-aliases-package: com.example.domain
  configuration:
    map-underscore-to-camel-case: true
    default-executor-type: simple
    local-cache-scope: session
```

Contoh scanning:

```java
@SpringBootApplication
@MapperScan("com.example.persistence.mapper")
public class Application {
}
```

Runtime Spring Boot concept:

```text
DataSource bean
  -> SqlSessionFactory bean
  -> SqlSessionTemplate bean
  -> Mapper proxies
  -> Services inject mapper interfaces
```

Jika ada multiple datasource:

```text
DataSource A -> SqlSessionFactory A -> SqlSessionTemplate A -> Mapper package A
DataSource B -> SqlSessionFactory B -> SqlSessionTemplate B -> Mapper package B
```

Kesalahan umum multiple datasource:

- mapper package salah factory;
- XML mapper location overlap;
- transaction manager salah;
- mapper A memakai database B;
- statement id bentrok secara konseptual;
- type alias package terlalu luas.

---

## 23. Java 8 sampai Java 25: Dampak ke Runtime Architecture

Core mental model MyBatis relatif stabil lintas Java 8–25:

```text
Mapper proxy -> SqlSession -> Executor -> StatementHandler -> JDBC -> ResultSetHandler
```

Yang berubah adalah gaya object dan ekosistem:

| Area | Java 8 Style | Java 17/21/25 Style |
|---|---|---|
| DTO | mutable class | record/immutable DTO |
| null handling | nullable + Optional terbatas | Optional lebih umum pada API read tertentu |
| date/time | `java.time` sudah tersedia | sama, lebih matang ekosistemnya |
| switch/domain modeling | enum/classic | sealed class/pattern matching untuk layer atas |
| concurrency | platform thread | virtual thread dapat memengaruhi service concurrency, bukan mapper semantics langsung |
| Spring stack | Boot 2.x untuk Java 8 | Boot 3/4 untuk Java 17+ |
| Jakarta | belum dominan | lebih relevan di stack modern |

MyBatis tetap berbasis JDBC. Virtual thread, record, sealed class, dan modern Java tidak mengubah fakta bahwa:

- SQL tetap harus benar;
- transaction tetap harus jelas;
- mapping tetap harus eksplisit untuk kasus kompleks;
- database tetap bottleneck utama untuk query buruk.

Rule:

> Modern Java membantu membuat API lebih bersih, tetapi tidak menghapus kebutuhan memahami MyBatis runtime.

---

## 24. Membaca Stack Trace MyBatis dengan Mental Model

Contoh stack trace konseptual:

```text
org.apache.ibatis.exceptions.PersistenceException
### Error querying database. Cause: java.sql.SQLSyntaxErrorException
### The error may exist in mappers/UserMapper.xml
### The error may involve com.example.UserMapper.search-Inline
### The error occurred while setting parameters
### SQL: SELECT id, username FROM users WHERE status = ?
### Cause: java.sql.SQLSyntaxErrorException: ...
```

Cara membaca:

| Baris | Makna |
|---|---|
| `Error querying database` | command type SELECT |
| `error may exist in ...xml` | mapper resource yang terlibat |
| `may involve ...search` | statement id |
| `occurred while setting parameters` | mungkin binding/type handler/parameter |
| `SQL: ...` | SQL final atau near-final |
| `Cause` | root cause JDBC/database |

Jangan berhenti di exception wrapper MyBatis. Cari root cause paling bawah:

```text
PersistenceException
  -> MyBatisSystemException / DataAccessException in Spring
    -> SQLException
      -> vendor-specific error code/message
```

---

## 25. Minimal Internal Debugging Checklist

Ketika mapper tidak bekerja, gunakan urutan ini:

### 25.1 Statement Discovery

- Apakah mapper interface ter-scan?
- Apakah XML ada di classpath?
- Apakah namespace cocok dengan interface FQCN?
- Apakah statement id cocok dengan method name?
- Apakah overloaded method dipakai? Hindari overload mapper method.

### 25.2 SQL Generation

- Apakah dynamic SQL menghasilkan SQL valid?
- Apakah `<where>`/`<trim>` menghapus `AND` pertama dengan benar?
- Apakah list kosong pada `<foreach>` menghasilkan SQL invalid?
- Apakah `${}` digunakan untuk identifier saja dengan whitelist?

### 25.3 Parameter Binding

- Apakah parameter name cocok?
- Apakah `@Param` diperlukan?
- Apakah null butuh `jdbcType`?
- Apakah type handler tersedia?
- Apakah enum mapping sesuai database value?

### 25.4 Execution

- Apakah query valid di database langsung?
- Apakah user database punya permission?
- Apakah index mendukung predicate?
- Apakah timeout berasal dari lock atau full scan?
- Apakah transaction menahan lock terlalu lama?

### 25.5 Result Mapping

- Apakah column alias cocok?
- Apakah resultMap benar?
- Apakah joined column ambigu?
- Apakah object punya constructor/setter yang sesuai?
- Apakah return type sesuai cardinality?

---

## 26. Design Implication: Mapper Adalah Contract, Bukan Detail Kecil

Setelah memahami runtime, kita bisa menyimpulkan hal penting:

> Mapper method adalah contract antara application layer dan database behavior.

Contoh mapper yang lemah:

```java
List<Map<String, Object>> query(Map<String, Object> params);
```

Masalah:

- tidak ada result contract;
- tidak ada parameter contract;
- sulit divalidasi;
- sulit dites;
- raw map membuat bug runtime;
- SQL bisa menjadi generic monster.

Mapper yang lebih kuat:

```java
List<CaseListItem> searchCases(CaseSearchCriteria criteria);

int transitionStatus(
    @Param("caseId") Long caseId,
    @Param("fromStatus") CaseStatus fromStatus,
    @Param("toStatus") CaseStatus toStatus,
    @Param("expectedVersion") Long expectedVersion
);

Optional<CaseDetail> findDetailById(@Param("caseId") Long caseId);
```

Di sini contract lebih jelas:

- input punya nama dan makna;
- output punya bentuk jelas;
- cardinality terlihat;
- concurrency rule terlihat;
- business invariant bisa dibaca dari SQL.

---

## 27. Analogi Control Plane dan Data Plane

Untuk memahami MyBatis secara arsitektural, pisahkan control plane dan data plane.

### 27.1 Control Plane

Control plane adalah metadata dan konfigurasi:

```text
Configuration
MappedStatement
ResultMap
TypeHandler registry
Mapper registry
Plugin registry
Environment
```

Ia dibangun saat startup.

### 27.2 Data Plane

Data plane adalah eksekusi per request:

```text
Mapper method call
Parameter object
BoundSql
Executor
JDBC statement
ResultSet
Mapped result object
```

Ia terjadi saat runtime invocation.

Kenapa pemisahan ini penting?

Karena error bisa berbeda:

| Plane | Error |
|---|---|
| Control plane | XML tidak load, namespace salah, resultMap missing, type alias missing |
| Data plane | parameter salah, SQL invalid untuk input tertentu, deadlock, timeout, mapping row gagal |

Top-tier debugging selalu bertanya:

```text
Apakah ini kegagalan metadata startup atau kegagalan invocation runtime?
```

---

## 28. Mini Case Study: Search Screen yang Lambat dan Kadang Error

Bayangkan ada mapper:

```java
List<ApplicationListItem> search(Map<String, Object> params);
```

XML:

```xml
<select id="search" resultType="map">
  SELECT *
  FROM application a
  LEFT JOIN applicant p ON p.application_id = a.id
  WHERE 1 = 1
  <if test="keyword != null">
    AND (a.ref_no LIKE '%${keyword}%' OR p.name LIKE '%${keyword}%')
  </if>
  <if test="status != null">
    AND a.status = #{status}
  </if>
  ORDER BY ${sortColumn} ${sortDirection}
</select>
```

Dari runtime architecture, kita bisa melihat banyak masalah:

### 28.1 Parameter Binding Problem

`keyword` memakai `${}`:

```sql
LIKE '%${keyword}%'
```

Ini string substitution, bukan prepared binding. Risiko SQL injection.

### 28.2 Dynamic Identifier Problem

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Ini bisa aman hanya jika `sortColumn` dan `sortDirection` berasal dari whitelist, bukan input mentah user.

### 28.3 Result Mapping Problem

```xml
resultType="map"
SELECT *
```

Risiko:

- kolom duplikat;
- contract tidak jelas;
- consumer bergantung pada string key;
- perubahan schema bisa mematahkan runtime diam-diam.

### 28.4 Performance Problem

```sql
LIKE '%keyword%'
```

Leading wildcard sering tidak index-friendly.

### 28.5 Better Design

Mapper:

```java
List<ApplicationListItem> searchApplications(ApplicationSearchCriteria criteria);
```

Criteria:

```java
public class ApplicationSearchCriteria {
    private String keywordLike;
    private ApplicationStatus status;
    private ApplicationSort sort;
    private int limit;
    private int offset;
}
```

Sort enum:

```java
public enum ApplicationSort {
    CREATED_AT_DESC("a.created_at DESC, a.id DESC"),
    REF_NO_ASC("a.ref_no ASC, a.id ASC");

    private final String orderBySql;

    ApplicationSort(String orderBySql) {
        this.orderBySql = orderBySql;
    }

    public String orderBySql() {
        return orderBySql;
    }
}
```

XML:

```xml
<select id="searchApplications" resultMap="ApplicationListItemResultMap">
  SELECT
    a.id           AS application_id,
    a.ref_no       AS application_ref_no,
    a.status       AS application_status,
    a.created_at   AS application_created_at,
    p.name         AS applicant_name
  FROM application a
  LEFT JOIN applicant p ON p.application_id = a.id
  <where>
    <if test="keywordLike != null and keywordLike != ''">
      AND (
        a.ref_no LIKE #{keywordLike}
        OR p.name LIKE #{keywordLike}
      )
    </if>
    <if test="status != null">
      AND a.status = #{status}
    </if>
  </where>
  ORDER BY ${sort.orderBySql}
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

Catatan: `${sort.orderBySql}` tetap substitution, tetapi sumbernya enum internal yang di-whitelist, bukan raw input.

ResultMap:

```xml
<resultMap id="ApplicationListItemResultMap" type="ApplicationListItem">
  <id property="applicationId" column="application_id" />
  <result property="refNo" column="application_ref_no" />
  <result property="status" column="application_status" />
  <result property="createdAt" column="application_created_at" />
  <result property="applicantName" column="applicant_name" />
</resultMap>
```

Perbaikan runtime:

| Area | Sebelum | Sesudah |
|---|---|---|
| parameter | raw map | typed criteria |
| SQL injection | `${keyword}` | `#{keywordLike}` |
| sorting | raw string | enum whitelist |
| result | `Map` + `SELECT *` | explicit projection DTO |
| mapping | implicit | explicit resultMap |
| pagination | tidak jelas | limit/offset eksplisit |
| contract | lemah | kuat |

---

## 29. Production Runtime Checklist

Gunakan checklist ini untuk menilai apakah MyBatis runtime layer cukup sehat.

### 29.1 Bootstrap

- Semua mapper XML ter-load saat startup.
- Namespace cocok dengan interface.
- Tidak ada statement id ambigu.
- Mapper scanning eksplisit.
- Type alias tidak terlalu luas.
- Type handler terdaftar jelas.

### 29.2 Mapper Contract

- Mapper method tidak overload.
- Parameter object digunakan untuk query kompleks.
- `@Param` digunakan untuk multiple scalar parameter.
- Return type mencerminkan cardinality.
- DML mengembalikan affected rows jika correctness penting.

### 29.3 SQL Generation

- Dynamic SQL branch dites.
- `${}` hanya untuk whitelisted identifier/fragments.
- `foreach` list kosong ditangani.
- Query final bisa direkonstruksi saat debugging.

### 29.4 Execution

- Executor type default masuk akal.
- Batch hanya untuk use-case batch.
- Timeout/fetch size dipertimbangkan untuk query besar.
- Transaction boundary ada di service.

### 29.5 Mapping

- Query join memakai alias eksplisit.
- Complex result memakai `resultMap`.
- Enum/status memakai mapping yang stabil.
- Primitive dihindari untuk nullable column.
- Unknown column behavior dipertimbangkan di test.

### 29.6 Observability

- SQL logging tersedia di environment non-prod.
- Slow query bisa diidentifikasi.
- Correlation id masuk log.
- Parameter sensitif tidak bocor.
- Query count per request bisa dideteksi untuk N+1.

---

## 30. Kesalahan Mental Model yang Harus Dihindari

### 30.1 “MyBatis cuma XML SQL”

Salah.

MyBatis adalah runtime mapping engine dengan:

- configuration registry;
- mapper proxy;
- SQL source processing;
- executor strategy;
- statement handling;
- parameter binding;
- result mapping;
- cache;
- plugin;
- transaction integration.

XML hanya salah satu input metadata.

---

### 30.2 “Kalau SQL benar di database client, pasti benar di MyBatis”

Belum tentu.

SQL bisa benar, tetapi:

- parameter name salah;
- type handler salah;
- dynamic SQL branch menghasilkan syntax berbeda;
- resultMap salah;
- mapper return type salah;
- transaction/session/cache behavior berbeda.

---

### 30.3 “Mapper return `Map` lebih fleksibel”

Fleksibel jangka pendek, rapuh jangka panjang.

`Map<String, Object>` menghilangkan contract. Untuk sistem besar, ini memperbesar runtime bug.

---

### 30.4 “Second-level cache membuat query lebih cepat, jadi aktifkan saja”

Cache tanpa invalidation model adalah correctness risk.

Database query lambat harus pertama-tama dipahami dari:

- SQL plan;
- index;
- cardinality;
- join;
- pagination;
- transaction/lock;
- network roundtrip;
- result size.

Cache adalah optimasi setelah correctness dan ownership jelas.

---

### 30.5 “Batch hanya loop yang lebih cepat”

Batch mengubah failure timing.

Error bisa muncul saat flush/commit, bukan saat mapper method dipanggil. Ini penting untuk retry, audit, dan partial failure handling.

---

## 31. Diagram Ringkas

```text
Startup / Bootstrap
===================

mybatis-config.xml / Spring properties / Mapper XML / annotations
        |
        v
SqlSessionFactoryBuilder or SqlSessionFactoryBean
        |
        v
Configuration
        |-- MapperRegistry
        |-- MappedStatements
        |-- ResultMaps
        |-- TypeHandlerRegistry
        |-- Interceptors
        |-- Environment
        |
        v
SqlSessionFactory


Runtime Invocation
==================

Service
  |
  v
Mapper Proxy
  |
  v
Statement ID resolution
  |
  v
SqlSession
  |
  v
Executor
  |
  +--> local cache check
  |
  v
MappedStatement
  |
  v
BoundSql
  |
  v
StatementHandler
  |
  +--> ParameterHandler + TypeHandler
  |
  v
JDBC PreparedStatement
  |
  v
Database
  |
  v
JDBC ResultSet / update count
  |
  v
ResultSetHandler + TypeHandler
  |
  v
Java result
```

---

## 32. Ringkasan

MyBatis runtime bisa dipahami sebagai pipeline:

```text
Mapper method
  -> statement id
  -> MappedStatement
  -> BoundSql
  -> Executor
  -> StatementHandler
  -> ParameterHandler
  -> JDBC
  -> ResultSetHandler
  -> Java result
```

Fondasi yang harus melekat:

1. `Configuration` adalah registry metadata runtime.
2. `MappedStatement` adalah definisi internal satu SQL operation.
3. `BoundSql` adalah SQL final untuk satu invocation.
4. `SqlSession` adalah API utama eksekusi mapped statement.
5. `Executor` menentukan strategi eksekusi.
6. `StatementHandler` menyiapkan JDBC statement.
7. `ParameterHandler` mengikat parameter dengan bantuan `TypeHandler`.
8. `ResultSetHandler` membuat object Java dari result set.
9. Mapper proxy menghubungkan interface method ke statement id.
10. Spring mengelola session/transaction lifecycle melalui integration layer.

Jika Part 0 menjawab **“kenapa MyBatis dan kapan dipakai”**, Part 1 menjawab **“bagaimana mesin MyBatis bekerja dari dalam”**.

---

## 33. Latihan Pemahaman

### Latihan 1 — Statement ID

Diberikan mapper:

```java
package com.acme.casefile.persistence;

public interface CaseMapper {
    CaseDetail findDetailById(Long id);
}
```

Tulis namespace XML dan statement id yang benar.

Jawaban yang diharapkan:

```xml
<mapper namespace="com.acme.casefile.persistence.CaseMapper">
  <select id="findDetailById" resultMap="CaseDetailResultMap">
    ...
  </select>
</mapper>
```

Full statement id:

```text
com.acme.casefile.persistence.CaseMapper.findDetailById
```

---

### Latihan 2 — Diagnosis Error Parameter

Mapper:

```java
List<User> find(String status, String role);
```

XML:

```xml
WHERE status = #{status}
  AND role = #{role}
```

Error:

```text
Parameter 'status' not found. Available parameters are [arg0, arg1, param1, param2]
```

Perbaiki.

Jawaban:

```java
List<User> find(
    @Param("status") String status,
    @Param("role") String role
);
```

Atau:

```java
List<User> find(UserSearchCriteria criteria);
```

---

### Latihan 3 — Identify Runtime Layer

Tentukan lapisan bermasalah:

| Problem | Lapisan |
|---|---|
| XML tidak ditemukan | Configuration/bootstrap |
| `Invalid bound statement` | Mapper registry/MappedStatement |
| `Parameter 'x' not found` | Parameter object/BoundSql/ParameterHandler |
| SQL syntax error | BoundSql/JDBC/database |
| Enum value gagal dibaca | ResultSetHandler/TypeHandler |
| `selectOne` mendapat 2 row | Mapper return contract/cardinality |
| Data stale dalam transaction | local cache/transaction isolation/cache |

---

## 34. Koneksi ke Part Berikutnya

Part 1 memberi mental model runtime.

Part 2 berikutnya akan membahas:

```text
02-java-8-to-25-mybatis-version-strategy-and-compatibility.md
```

Fokusnya:

- strategi MyBatis untuk Java 8 sampai Java 25;
- Spring Boot 2.x, 3.x, dan 4.x implication;
- MyBatis core vs MyBatis-Spring vs Starter;
- penggunaan record/immutable DTO;
- compatibility dengan Jakarta era;
- migration path untuk enterprise legacy-modern hybrid codebase.

---

## 35. Referensi Utama

- MyBatis 3 Official Documentation — Getting Started, Configuration, Mapper XML, Dynamic SQL, Java API.
- MyBatis 3 API Documentation — `SqlSession`, `Configuration`, executor/resultset/statement-related APIs.
- MyBatis-Spring Official Documentation — `SqlSessionFactoryBean`, `SqlSessionTemplate`, mapper injection, transaction/session integration.
- MyBatis Spring Boot Starter Documentation — auto-configuration, properties, mapper scanning, version compatibility.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./00-mybatis-orientation-sql-first-persistence-mental-model.md">⬅️ MyBatis Orientation: SQL-First Persistence Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./02-java-8-to-25-mybatis-version-strategy-and-compatibility.md">Part 2 — Java 8 to 25 MyBatis Version Strategy and Compatibility ➡️</a>
</div>
