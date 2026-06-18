# Part 2 — Java 8 to 25 MyBatis Version Strategy and Compatibility

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `02-java-8-to-25-mybatis-version-strategy-and-compatibility.md`  
**Scope:** Java 8 sampai Java 25, MyBatis Core, MyBatis-Spring, MyBatis Spring Boot Starter, MyBatis Dynamic SQL, Spring Boot 2/3/4, dan strategi enterprise migration.

---

## 0. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan yang sering disepelekan tetapi sangat menentukan kualitas arsitektur MyBatis di dunia nyata:

> “Kalau MyBatis terlihat sederhana, apakah strategi versinya juga sederhana?”

Jawabannya: **tidak selalu**.

MyBatis Core relatif stabil dan konsep dasarnya tidak banyak berubah: `SqlSessionFactory`, `SqlSession`, mapper interface, XML mapper, annotation mapper, result mapping, dynamic SQL, type handler, plugin, dan executor. Tetapi di aplikasi production modern, MyBatis hampir selalu hidup bersama:

- Java runtime tertentu;
- Spring Framework atau Spring Boot tertentu;
- JDBC driver tertentu;
- connection pool tertentu;
- database vendor tertentu;
- test framework tertentu;
- deployment platform tertentu;
- observability stack tertentu;
- security baseline tertentu.

Jadi kompatibilitas MyBatis tidak boleh dilihat hanya dari satu dependency `org.mybatis:mybatis`. Yang harus dilihat adalah **compatibility matrix** antara beberapa lapisan.

Bagian ini akan membangun mental model berikut:

```text
Java version
  -> language features available
  -> bytecode target
  -> Spring Boot generation
  -> MyBatis-Spring generation
  -> MyBatis Spring Boot Starter generation
  -> MyBatis Dynamic SQL generation
  -> JDBC driver compatibility
  -> runtime behavior and operational constraints
```

Target setelah menyelesaikan bagian ini:

1. Mampu memilih versi MyBatis secara aman untuk Java 8, 11, 17, 21, dan 25.
2. Mampu membedakan **runtime compatibility** vs **source-code style compatibility**.
3. Mampu mendesain mapper yang tetap awet di codebase campuran legacy dan modern.
4. Mampu menghindari upgrade trap dari Spring Boot 2 ke 3/4.
5. Mampu memahami dampak Java modern features terhadap DTO, mapper API, transaction, performance, dan observability.
6. Mampu membuat migration roadmap dari MyBatis legacy menuju Java 17/21/25 tanpa big bang rewrite.

---

## 1. Prinsip Utama: Jangan Mencampur “MyBatis Core” dengan “Stack Version”

Saat engineer bilang:

> “Kita pakai MyBatis 3.5, berarti aman kan?”

Pertanyaan itu kurang lengkap.

Yang harus ditanyakan adalah:

```text
MyBatis Core version?
MyBatis-Spring version?
MyBatis Spring Boot Starter version?
Spring Boot version?
Spring Framework version?
Java runtime version?
Java source/target compatibility?
JDBC driver version?
Database version?
Build tool version?
Test infrastructure version?
```

MyBatis Core adalah SQL mapper framework. Tetapi ketika dipakai di Spring Boot, lifecycle `SqlSession`, mapper proxy registration, transaction binding, exception translation, dan resource management banyak ditangani oleh MyBatis-Spring dan Spring Boot auto-configuration.

Jadi strategi versi harus dipikirkan sebagai **stack**, bukan dependency tunggal.

### 1.1 Mental Model Layer

```text
Application Code
  - service layer
  - mapper interface
  - DTO/projection
  - domain objects
  - test code

MyBatis Integration Layer
  - mybatis-spring-boot-starter
  - mybatis-spring
  - SqlSessionTemplate
  - MapperFactoryBean
  - @MapperScan

MyBatis Core Layer
  - SqlSessionFactory
  - Configuration
  - Executor
  - MappedStatement
  - TypeHandler
  - ResultMap
  - Plugin/Interceptor

Spring / Runtime Layer
  - Spring Boot
  - Spring Framework
  - transaction manager
  - datasource
  - HikariCP
  - observability

Java Platform Layer
  - JDK version
  - bytecode level
  - language features
  - GC
  - virtual threads
  - records
  - modules

Database Layer
  - JDBC driver
  - SQL dialect
  - transaction isolation
  - lock behavior
  - LOB behavior
  - generated key behavior
```

Jika salah satu layer tidak kompatibel, error-nya sering muncul sebagai masalah yang tampak “MyBatis”, padahal akar masalahnya bisa dari Spring Boot version, Java bytecode, JDBC driver, atau transaction configuration.

---

## 2. Official Compatibility Snapshot

Berdasarkan dokumentasi resmi MyBatis Spring Boot Starter, requirement utamanya dapat diringkas seperti ini:

| Stack Line | MyBatis Core | MyBatis-Spring | Java | Spring Boot |
|---|---:|---:|---:|---:|
| `2.3.x` | 3.5 | 2.1 | Java 8+ | Spring Boot 2.7 |
| `3.0.x` | 3.5 | 3.0 | Java 17+ | Spring Boot 3.2–3.5 |
| `master / Boot 4 line` | 3.5 | 4.0 | Java 17+ | Spring Boot 4.0 |

Implikasinya:

- Jika aplikasi masih Java 8 dan Spring Boot 2.7, jalur aman adalah **MyBatis Spring Boot Starter 2.3.x**.
- Jika aplikasi sudah Spring Boot 3.x, maka Java minimum menjadi **Java 17**, dan jalur starter adalah **3.0.x**.
- Jika aplikasi menuju Spring Boot 4.x, gunakan jalur yang kompatibel dengan Spring Boot 4 dan MyBatis-Spring 4.
- Java 21 dan Java 25 bukan berarti otomatis butuh MyBatis versi berbeda; yang lebih menentukan adalah Spring Boot/Spring Framework line dan dependency ecosystem.

### 2.1 Jangan Mengandalkan “Latest Always Works”

Kesalahan umum:

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>LATEST</version>
</dependency>
```

Atau di Gradle:

```groovy
implementation 'org.mybatis.spring.boot:mybatis-spring-boot-starter:+'
```

Ini buruk untuk enterprise system karena:

1. Build tidak reproducible.
2. Minor upgrade bisa membawa transitive dependency berbeda.
3. Spring Boot compatibility bisa berubah.
4. Runtime error bisa muncul setelah clean build di CI.
5. Sulit melakukan rollback.

Gunakan versi eksplisit dan dependency management yang terkunci.

---

## 3. Java 8 Strategy: Legacy-Compatible, Stable, Conservative

Java 8 masih banyak ditemukan di enterprise legacy system. Banyak sistem MyBatis lama berjalan di kombinasi:

```text
Java 8
Spring Boot 2.7.x
Spring Framework 5.x
MyBatis 3.5.x
MyBatis-Spring 2.1.x
MyBatis Spring Boot Starter 2.3.x
```

### 3.1 Karakter Java 8 MyBatis Codebase

Biasanya memiliki ciri:

- XML mapper dominan.
- DTO mutable dengan getter/setter.
- Lombok sering dipakai untuk boilerplate.
- `java.util.Date`, `java.sql.Timestamp`, atau Joda-Time masih mungkin ada.
- `Optional` kadang dipakai, kadang tidak konsisten.
- Stream API tersedia tetapi belum selalu idiomatis.
- Tidak ada record.
- Tidak ada sealed class.
- Tidak ada pattern matching.
- Tidak ada virtual threads.
- Build masih Maven lama atau Gradle lama.
- Testcontainers mungkin ada, tetapi versi harus kompatibel dengan Java 8.

### 3.2 Style yang Aman di Java 8

Untuk Java 8, desain mapper sebaiknya konservatif:

```java
public interface UserMapper {
    UserDto findById(@Param("id") Long id);

    List<UserSummaryDto> search(UserSearchCriteria criteria);

    int insert(UserInsertCommand command);

    int updateStatus(UserStatusUpdateCommand command);
}
```

DTO:

```java
public class UserSummaryDto {
    private Long id;
    private String username;
    private String displayName;
    private String status;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    // other getters/setters
}
```

Kelebihan:

- Kompatibel luas.
- Mudah dimapping dengan setter-based result mapping.
- Mudah dipakai oleh XML result map.
- Tidak tergantung fitur Java modern.

Kekurangan:

- Object mutable.
- Contract DTO kurang kuat.
- Nullability tidak eksplisit.
- Banyak boilerplate.

### 3.3 Java 8 Recommendation

Untuk Java 8:

```text
Use:
  - explicit XML mapper for complex SQL
  - explicit resultMap for joined result
  - @Param for multi-parameter methods
  - DTO/command object for search and update
  - java.time if possible
  - version-locked dependencies

Avoid:
  - latest starter line meant for Boot 3/4
  - record DTO
  - Java 17 bytecode dependency
  - relying on virtual thread behavior
  - mixing Boot 3 dependencies into Boot 2 app
```

### 3.4 Hidden Trap: Library Bytecode Level

Satu dependency saja yang dikompilasi untuk Java 17 dapat membuat aplikasi Java 8 gagal start.

Contoh error:

```text
UnsupportedClassVersionError: class file has wrong version 61.0,
should be 52.0
```

Mapping bytecode penting:

| Java | Class File Version |
|---:|---:|
| 8 | 52 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

Jika aplikasi Java 8 menarik library dengan class file version 61, runtime akan gagal bahkan sebelum MyBatis mapper dipakai.

---

## 4. Java 11 Strategy: Transitional, Not Usually the Final Target

Java 11 adalah LTS yang pernah menjadi target enterprise upgrade dari Java 8. Tetapi untuk MyBatis/Spring Boot modern, Java 11 kini sering menjadi posisi transisi, bukan tujuan akhir.

### 4.1 Karakter Java 11

Java 11 memberi:

- `var` untuk local variable dari Java 10.
- HTTP Client standard.
- runtime improvement.
- GC improvement.
- better container awareness dibanding Java 8.

Tetapi dari sisi MyBatis mapper design, Java 11 tidak memberi fitur bahasa yang drastis seperti record atau sealed class.

### 4.2 Stack Umum

```text
Java 11
Spring Boot 2.7.x atau sebagian Boot 2.x line
MyBatis Spring Boot Starter 2.3.x
MyBatis 3.5.x
```

Boot 3 membutuhkan Java 17+, jadi Java 11 biasanya tetap di dunia Spring Boot 2.

### 4.3 Java 11 Recommendation

Untuk Java 11:

```text
Treat it as enhanced Java 8.
Do not design architecture assuming Java 17 features.
Improve runtime, build, testing, and dependency hygiene first.
Prepare code style for Java 17 migration.
```

Hal yang bisa dilakukan di Java 11:

- mulai konsisten memakai `java.time`;
- hilangkan Joda-Time;
- hilangkan raw `Map` parameter;
- rapikan mapper boundary;
- tambah integration tests;
- gunakan explicit result maps;
- upgrade JDBC driver;
- bersihkan deprecated APIs;
- siapkan source compatibility untuk Java 17.

---

## 5. Java 17 Strategy: Modern Baseline untuk Spring Boot 3

Java 17 adalah baseline penting karena Spring Boot 3 membutuhkan Java 17+. Ini juga titik masuk ke banyak fitur bahasa modern yang relevan untuk MyBatis.

### 5.1 Stack Umum

```text
Java 17+
Spring Boot 3.2–3.5
Spring Framework 6.x
MyBatis 3.5.x
MyBatis-Spring 3.0.x
MyBatis Spring Boot Starter 3.0.x
Jakarta EE namespace in wider ecosystem
```

Walaupun MyBatis sendiri bukan Jakarta persistence framework, aplikasi Spring Boot 3 biasanya sudah berada di ekosistem Jakarta namespace untuk web/validation/servlet APIs.

### 5.2 Fitur Java 17 yang Relevan untuk MyBatis

#### 5.2.1 Records untuk Projection DTO

Record cocok untuk read-only projection:

```java
public record UserSummary(
    Long id,
    String username,
    String displayName,
    String status
) {}
```

Kelebihan:

- immutable;
- constructor jelas;
- field contract ringkas;
- cocok untuk query projection;
- mengurangi accidental mutation.

Tetapi ada konsekuensi:

- mapping harus cocok dengan constructor;
- nama column/alias harus disiplin;
- tidak cocok untuk object yang perlu partial mutation;
- tidak semua legacy result map langsung cocok.

Contoh SQL:

```xml
<select id="findSummaryById" resultType="com.example.user.UserSummary">
  SELECT
    u.id AS id,
    u.username AS username,
    u.display_name AS displayName,
    u.status AS status
  FROM users u
  WHERE u.id = #{id}
</select>
```

Untuk production code, lebih baik tetap eksplisit jika query join kompleks:

```xml
<resultMap id="UserSummaryMap" type="com.example.user.UserSummary">
  <constructor>
    <arg column="id" javaType="java.lang.Long" />
    <arg column="username" javaType="java.lang.String" />
    <arg column="displayName" javaType="java.lang.String" />
    <arg column="status" javaType="java.lang.String" />
  </constructor>
</resultMap>
```

#### 5.2.2 Sealed Class untuk Result Model Terbatas

Sealed class bisa membantu jika query command menghasilkan outcome terbatas:

```java
public sealed interface UpdateUserStatusResult
    permits UpdateUserStatusResult.Updated,
            UpdateUserStatusResult.NotFound,
            UpdateUserStatusResult.VersionConflict {

    record Updated(Long id) implements UpdateUserStatusResult {}
    record NotFound(Long id) implements UpdateUserStatusResult {}
    record VersionConflict(Long id, long expectedVersion) implements UpdateUserStatusResult {}
}
```

Mapper tetap mengembalikan primitive signal:

```java
int updateStatusIfVersionMatches(UpdateUserStatusCommand command);
```

Service menerjemahkan:

```java
int rows = userMapper.updateStatusIfVersionMatches(command);
if (rows == 1) {
    return new UpdateUserStatusResult.Updated(command.id());
}
if (!userMapper.existsById(command.id())) {
    return new UpdateUserStatusResult.NotFound(command.id());
}
return new UpdateUserStatusResult.VersionConflict(command.id(), command.expectedVersion());
```

MyBatis tidak perlu tahu sealed class ini. Yang berubah adalah **application contract** menjadi lebih kuat.

#### 5.2.3 Text Blocks untuk Annotation SQL

Java text blocks membuat annotation mapper lebih readable:

```java
@Select("""
    SELECT
      u.id,
      u.username,
      u.display_name AS displayName
    FROM users u
    WHERE u.id = #{id}
    """)
UserSummary findById(Long id);
```

Tetapi jangan salah paham: text blocks membuat SQL inline lebih enak dibaca, tetapi tidak otomatis membuat annotation mapper cocok untuk query kompleks.

Rule:

```text
Annotation mapper is acceptable for small, stable SQL.
XML mapper remains better for complex, dynamic, multi-branch SQL.
```

### 5.3 Java 17 Recommendation

Untuk Java 17:

```text
Use:
  - MyBatis Spring Boot Starter 3.x with Spring Boot 3.x
  - records for read projection DTO
  - explicit result maps for complex mapping
  - sealed result models at service/application layer
  - java.time everywhere
  - constructor mapping for immutable models

Avoid:
  - using record for all domain objects blindly
  - annotation SQL for complex queries
  - mixing javax-era libraries with jakarta-era app stack
  - assuming Boot 2 and Boot 3 behavior are identical
```

---

## 6. Java 21 Strategy: Modern LTS, Better Runtime, Virtual Thread Awareness

Java 21 adalah LTS penting karena membawa virtual threads sebagai fitur final. Untuk MyBatis, ini memunculkan pertanyaan besar:

> “Kalau pakai virtual threads, apakah query JDBC blocking menjadi murah?”

Jawabannya:

> “Thread blocking lebih murah, tetapi database connection tetap resource terbatas.”

### 6.1 Virtual Threads and MyBatis

MyBatis memakai JDBC. JDBC tradisional bersifat blocking. Virtual threads dapat membantu mengurangi biaya blocking thread di JVM, tetapi tidak menghilangkan batasan:

- jumlah connection pool;
- database CPU;
- lock contention;
- transaction duration;
- network latency;
- result set size;
- database session memory;
- connection acquisition timeout.

Jika memiliki 10.000 virtual thread yang semuanya melakukan query, aplikasi tetap hanya bisa mengeksekusi sebanyak connection yang tersedia di pool.

```text
Virtual threads reduce JVM thread cost.
They do not increase database capacity by magic.
```

### 6.2 Wrong Mental Model

Salah:

```text
Virtual thread = bebas blocking = bebas query paralel sebanyak mungkin.
```

Benar:

```text
Virtual thread = cheaper waiting at JVM level.
Database concurrency must still be governed by pool size, rate limit, timeout, and backpressure.
```

### 6.3 MyBatis with Virtual Thread: Design Rule

Jika aplikasi Java 21 memakai virtual threads:

```text
Do:
  - keep Hikari max pool realistic
  - set connection timeout
  - set query timeout
  - bound request concurrency
  - avoid long transaction
  - avoid loading huge result sets
  - monitor pool wait time
  - monitor DB active sessions

Do not:
  - increase pool size blindly
  - run unbounded parallel mapper calls
  - assume virtual threads solve slow SQL
  - ignore lock wait and deadlock
```

### 6.4 Example: Bounded Parallel Lookup

Buruk:

```java
var results = ids.parallelStream()
    .map(userMapper::findById)
    .toList();
```

Masalah:

- parallelism tidak jelas;
- bisa menekan connection pool;
- ordering/error behavior tidak eksplisit;
- sulit memberi backpressure.

Lebih baik:

```java
public List<UserSummary> loadUsers(List<Long> ids) {
    if (ids.isEmpty()) {
        return List.of();
    }
    return userMapper.findByIds(ids);
}
```

SQL:

```xml
<select id="findByIds" resultMap="UserSummaryMap">
  SELECT
    u.id,
    u.username,
    u.display_name
  FROM users u
  WHERE u.id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
</select>
```

Lebih baik satu query set-based daripada banyak query paralel.

### 6.5 Java 21 Recommendation

Untuk Java 21:

```text
Use Java 21 for runtime strength, not as excuse for unbounded database concurrency.
Prefer set-based SQL.
Keep transaction short.
Control query fan-out.
Measure connection pool wait time.
Treat virtual threads as concurrency tool, not database scaling solution.
```

---

## 7. Java 25 Strategy: Forward-Looking, Spring Boot 4 Era, Stronger Platform Discipline

Java 25 berada di era modern setelah Java 21. Dalam konteks MyBatis, Java 25 bukan berarti mapper XML berubah drastis. Yang berubah adalah platform di sekitarnya:

- Spring Boot 4 line;
- Spring Framework 7 line;
- Java 17+ baseline in many libraries;
- stronger null-safety ecosystem;
- more modular dependency split;
- more mature virtual-thread patterns;
- modern build tool baseline;
- stronger observability expectations.

### 7.1 Java 25 Does Not Remove SQL Engineering

Walaupun runtime modern, MyBatis tetap SQL-first. Problem berikut tetap sama:

- salah result mapping;
- slow query;
- bad index;
- N+1 manual;
- transaction terlalu panjang;
- dynamic SQL terlalu kompleks;
- unsafe `${}`;
- unstable pagination;
- batch partial failure;
- cache stale;
- tenant leak;
- schema migration break.

Java 25 membantu platform, tetapi tidak menggantikan SQL discipline.

### 7.2 Spring Boot 4 Considerations

Spring Boot 4 membutuhkan perhatian khusus karena:

- dependency ecosystem bergerak;
- modularization lebih kuat;
- beberapa auto-configuration package bisa berubah;
- baseline Java modern;
- integrasi observability/security bisa berubah;
- library third-party harus kompatibel Boot 4.

Untuk MyBatis:

```text
Check:
  - mybatis-spring-boot-starter Boot 4 compatible line
  - mybatis-spring 4.x compatibility
  - Spring Framework 7 compatibility
  - JDBC driver compatibility
  - test framework compatibility
  - plugin/interceptor compatibility
```

### 7.3 Java 25 Recommendation

Untuk Java 25:

```text
Use it as modern platform target.
Do not migrate MyBatis architecture only because Java version changed.
First stabilize mapper contracts, tests, transaction boundaries, and SQL observability.
Then modernize DTOs, records, build tooling, and runtime concurrency.
```

---

## 8. MyBatis Dynamic SQL Version Strategy

MyBatis Dynamic SQL adalah library berbeda dari XML dynamic SQL bawaan MyBatis Core. Ia menyediakan DSL type-safe untuk membangun SQL di Java/Kotlin.

Secara garis besar:

- MyBatis Dynamic SQL 1.x mendukung Java 8.
- MyBatis Dynamic SQL 2.x membutuhkan Java 17.
- Library ini mendukung MyBatis3 dan Spring JDBC Templates.

### 8.1 Kapan Pakai MyBatis Dynamic SQL?

Gunakan jika:

- query banyak disusun dari filter opsional;
- ingin compile-time safety untuk column reference;
- ingin mengurangi stringly typed dynamic SQL;
- ingin reuse predicate builder;
- query tidak terlalu vendor-specific;
- team nyaman membaca DSL Java.

Contoh conceptual style:

```java
SelectStatementProvider selectStatement = select(user.id, user.username, user.status)
    .from(user)
    .where(user.status, isEqualToWhenPresent(criteria.status()))
    .and(user.createdAt, isGreaterThanOrEqualToWhenPresent(criteria.createdFrom()))
    .orderBy(user.createdAt.descending())
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Mapper:

```java
@SelectProvider(type = SqlProviderAdapter.class, method = "select")
@Results(id = "UserSummaryMap", value = {
    @Result(column = "id", property = "id"),
    @Result(column = "username", property = "username"),
    @Result(column = "status", property = "status")
})
List<UserSummary> search(SelectStatementProvider selectStatement);
```

### 8.2 Kapan Tetap Pakai XML Dynamic SQL?

Tetap gunakan XML jika:

- SQL sangat kompleks;
- SQL sangat vendor-specific;
- SQL perlu di-review oleh DBA;
- query memakai hints, CTE kompleks, analytic/window functions, recursive query;
- team lebih kuat di SQL daripada Java DSL;
- ingin SQL terlihat hampir sama dengan SQL native.

### 8.3 Dynamic SQL Compatibility Decision

```text
Java 8 codebase:
  - MyBatis Dynamic SQL 1.x if needed
  - XML dynamic SQL remains valid

Java 17+ codebase:
  - MyBatis Dynamic SQL 2.x becomes possible
  - records/constructor projections become more attractive

Mixed legacy-modern codebase:
  - avoid forcing Dynamic SQL everywhere
  - use it selectively for high-value dynamic query builders
```

---

## 9. Compatibility Is Not Just “Can It Start?”

Sebuah kombinasi dependency bisa start, tetapi tetap tidak sehat.

Ada beberapa level compatibility:

```text
Level 1: Build compatibility
  Can Maven/Gradle resolve dependencies?

Level 2: Bytecode compatibility
  Can JVM load all classes?

Level 3: Startup compatibility
  Can Spring Boot create beans and mapper proxies?

Level 4: Runtime compatibility
  Can mapper execute statements correctly?

Level 5: Semantic compatibility
  Are transactions, mappings, nulls, generated keys, and exceptions behaving as expected?

Level 6: Operational compatibility
  Can this stack be observed, tuned, upgraded, patched, and supported in production?
```

Top-tier engineer tidak berhenti di Level 3.

Aplikasi yang “bisa start” belum tentu aman untuk production.

---

## 10. Version Selection Framework

Gunakan decision tree berikut.

### 10.1 Jika Masih Java 8

```text
Question:
  Are you on Spring Boot 2.7?

If yes:
  Use mybatis-spring-boot-starter 2.3.x.

If no:
  Check exact Spring Boot version.
  Avoid starter 3.x because Boot 3 requires Java 17+.

Architecture style:
  Use mutable DTO or constructor DTO carefully.
  Avoid record.
  Keep XML mapper for complex SQL.
  Add tests before migration.
```

### 10.2 Jika Java 11

```text
Question:
  Are you planning Boot 3?

If yes:
  Upgrade to Java 17 first.

If no:
  Stay with Boot 2.7-compatible line.

Architecture style:
  Treat Java 11 as transition.
  Modernize APIs and tests, not language features.
```

### 10.3 Jika Java 17

```text
Question:
  Are you using Spring Boot 3.x?

If yes:
  Use mybatis-spring-boot-starter 3.0.x.

Architecture style:
  Records allowed for projections.
  Constructor mapping becomes attractive.
  Explicit result maps remain recommended.
```

### 10.4 Jika Java 21

```text
Question:
  Are you using virtual threads?

If yes:
  Re-evaluate pool size, query timeout, transaction duration, and fan-out.

Architecture style:
  Use Java 21 as runtime improvement.
  Keep SQL set-based.
  Do not increase DB concurrency blindly.
```

### 10.5 Jika Java 25

```text
Question:
  Are you on Spring Boot 4?

If yes:
  Use Boot 4-compatible MyBatis starter line.
  Validate MyBatis-Spring 4 compatibility.

Architecture style:
  Modern baseline.
  Strong tests and observability required.
  Upgrade governance is more important than syntax modernization.
```

---

## 11. Maven and Gradle Strategy

### 11.1 Maven for Spring Boot 2.7 / Java 8

```xml
<properties>
    <java.version>1.8</java.version>
</properties>

<dependency>
    <groupId>org.mybatis.spring.boot</groupId>
    <artifactId>mybatis-spring-boot-starter</artifactId>
    <version>2.3.2</version>
</dependency>
```

Use exact version suitable for your organization’s baseline.

### 11.2 Maven for Spring Boot 3.x / Java 17+

```xml
<properties>
    <java.version>17</java.version>
</properties>

<dependency>
    <groupId>org.mybatis.spring.boot</groupId>
    <artifactId>mybatis-spring-boot-starter</artifactId>
    <version>3.0.4</version>
</dependency>
```

The exact version should be selected from official compatibility and tested with the chosen Spring Boot minor.

### 11.3 Gradle Toolchain

For enterprise builds, prefer toolchain declaration.

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}
```

For Java 21:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}
```

Why this matters:

- CI and local build become consistent.
- Bytecode target is explicit.
- Accidental JDK mismatch is reduced.
- Upgrade path is traceable.

### 11.4 Avoid Dependency Drift

Bad:

```groovy
implementation 'org.mybatis.spring.boot:mybatis-spring-boot-starter:latest.release'
```

Better:

```groovy
implementation 'org.mybatis.spring.boot:mybatis-spring-boot-starter:3.0.4'
```

Even better in multi-module project:

```toml
[versions]
mybatisSpringBoot = "3.0.4"

[libraries]
mybatis-spring-boot-starter = {
  module = "org.mybatis.spring.boot:mybatis-spring-boot-starter",
  version.ref = "mybatisSpringBoot"
}
```

---

## 12. Source Compatibility vs Runtime Compatibility

Ini salah satu perbedaan paling penting.

### 12.1 Runtime Compatibility

Runtime compatibility berarti library bisa dijalankan di JDK tertentu.

Contoh:

```text
A library compiled for Java 8 can usually run on Java 17 or Java 21.
```

### 12.2 Source Compatibility

Source compatibility berarti code yang kamu tulis memakai fitur yang bisa dikompilasi oleh target Java tersebut.

Contoh:

```java
public record UserSummary(Long id, String username) {}
```

Ini tidak bisa dikompilasi dengan Java 8.

### 12.3 Trap in Multi-Module Systems

Misalnya:

```text
module-a: Java 8 target
module-b: Java 17 target
module-c: shared DTO
```

Jika `module-c` mulai memakai record, maka `module-a` tidak bisa lagi memakai module tersebut jika masih Java 8.

Rule:

```text
Shared DTO module must target the oldest consumer unless architecture explicitly splits compatibility lines.
```

---

## 13. Mapper DTO Strategy Across Java Versions

### 13.1 Java 8-Compatible DTO

```java
public class CaseListingRow {
    private Long caseId;
    private String caseNo;
    private String status;
    private LocalDateTime submittedAt;

    public Long getCaseId() {
        return caseId;
    }

    public void setCaseId(Long caseId) {
        this.caseId = caseId;
    }

    // other getters/setters
}
```

Pros:

- widely compatible;
- setter mapping easy;
- framework-friendly.

Cons:

- mutable;
- weak invariants;
- accidental modification possible.

### 13.2 Java 17+ Record Projection

```java
public record CaseListingRow(
    Long caseId,
    String caseNo,
    String status,
    LocalDateTime submittedAt
) {}
```

Pros:

- concise;
- immutable;
- good projection contract;
- easy to reason about.

Cons:

- constructor mapping must be right;
- unsuitable for gradual field population;
- not compatible with Java 8.

### 13.3 Recommendation Matrix

| Use Case | Java 8 | Java 17+ |
|---|---|---|
| Simple read projection | POJO DTO | record preferred |
| Complex nested mapping | POJO + explicit resultMap | POJO or record with constructor mapping |
| Command input | POJO command | record command or class command |
| Mutable workflow object | class | class |
| Domain aggregate | class | class/sealed model depending design |
| Cross-version shared library | Java 8 POJO | avoid record unless all consumers Java 17+ |

---

## 14. `Optional` Strategy

MyBatis mapper can return nullable object. In Java 8+, `Optional<T>` exists, but whether to use it at mapper layer is design choice.

### 14.1 Nullable Mapper Return

```java
UserDto findById(Long id);
```

Service:

```java
UserDto user = userMapper.findById(id);
if (user == null) {
    throw new UserNotFoundException(id);
}
```

Pros:

- simple;
- common in legacy MyBatis;
- minimal framework surprise.

Cons:

- null contract implicit;
- easy to forget null handling.

### 14.2 Optional Mapper Return

```java
Optional<UserDto> findById(Long id);
```

Pros:

- not-found is explicit;
- better API readability.

Cons:

- must verify framework behavior and team convention;
- not always used consistently in legacy code;
- `Optional` should not be field type.

### 14.3 Recommended Contract Style

For clarity:

```java
Optional<UserDto> findById(Long id);

UserDto getRequiredById(Long id);

boolean existsById(Long id);
```

But avoid mapper method that hides exception behavior:

```java
// Bad if it silently returns null despite name saying required
UserDto getById(Long id);
```

Better:

```java
public UserDto getRequiredUser(Long id) {
    return userMapper.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id));
}
```

---

## 15. Date and Time Strategy Across Versions

### 15.1 Avoid Legacy Date Types Where Possible

Avoid new code using:

```java
java.util.Date
java.sql.Date
java.sql.Timestamp
Calendar
```

Prefer:

```java
LocalDate
LocalTime
LocalDateTime
OffsetDateTime
Instant
```

### 15.2 Choose Semantic Type

| Meaning | Java Type |
|---|---|
| Date only, no time | `LocalDate` |
| Time only, no date | `LocalTime` |
| Local business timestamp | `LocalDateTime` |
| Absolute machine timestamp | `Instant` |
| Timestamp with offset | `OffsetDateTime` |

### 15.3 MyBatis Mapping Concern

Date/time behavior depends on:

- JDBC driver;
- database column type;
- timezone settings;
- server timezone;
- JVM timezone;
- serialization layer;
- business semantics.

Never treat date/time as “just a column”.

Example issue:

```text
submitted_at TIMESTAMP WITHOUT TIME ZONE
mapped to Instant
```

This may be semantically wrong unless timezone conversion is clearly defined.

---

## 16. Jakarta Transition Impact

MyBatis itself is not JPA and not Jakarta Persistence. But applications using Spring Boot 3+ live in Jakarta ecosystem for many APIs:

```text
javax.servlet -> jakarta.servlet
javax.validation -> jakarta.validation
javax.annotation -> jakarta.annotation
```

### 16.1 Why MyBatis Engineer Should Care

Even if mapper code itself does not import Jakarta APIs, surrounding code may:

- controller validation;
- DTO validation;
- transaction annotations;
- servlet filters;
- test utilities;
- security filters;
- bean validation;
- generated code.

### 16.2 Migration Trap

A MyBatis application can fail migration to Spring Boot 3 not because of mapper XML, but because:

- old `javax.validation` annotations remain;
- old servlet filter imports remain;
- old security config remains;
- old test slices use outdated classes;
- third-party libraries are not Jakarta-compatible.

Therefore MyBatis upgrade planning must include the whole Spring Boot migration surface.

---

## 17. Multiple DataSource Compatibility

Many enterprise MyBatis systems have multiple datasources:

```text
primary app database
reporting database
audit database
legacy database
read replica
batch database
```

Each datasource may need:

- separate `SqlSessionFactory`;
- separate `SqlSessionTemplate`;
- separate mapper package;
- separate transaction manager;
- separate XML mapper location;
- separate vendor-specific configuration.

### 17.1 Version Risk

During upgrade, errors often happen because one datasource is migrated and another silently uses default configuration.

Example risk:

```text
UserMapper -> primarySqlSessionFactory
ReportMapper -> accidentally bound to primarySqlSessionFactory instead of reportSqlSessionFactory
```

This can cause:

- SQL table not found;
- wrong schema access;
- transaction not applied;
- query hits production replica accidentally;
- test passes with one datasource but fails in deployment.

### 17.2 Rule

```text
In multi-datasource MyBatis, never rely on implicit defaults.
Name every factory, template, transaction manager, and mapper scan explicitly.
```

---

## 18. Dependency Governance in Enterprise MyBatis

For serious systems, create a version governance document.

Example:

```text
Persistence Stack Baseline

Java: 17.0.x LTS
Spring Boot: 3.5.x
MyBatis Spring Boot Starter: 3.0.x
MyBatis Core: managed by starter, verified as 3.5.x
MyBatis-Spring: managed by starter, verified as 3.0.x
JDBC Driver: ojdbc11 x.y.z / postgresql x.y.z
Connection Pool: HikariCP managed by Boot
Testcontainers: x.y.z
Database: Oracle 19c / PostgreSQL 16
```

### 18.1 Why This Matters

Without governance:

- teams upgrade inconsistently;
- modules drift;
- production bug becomes hard to reproduce;
- CI differs from local;
- security patching becomes chaotic;
- migration planning becomes guesswork.

### 18.2 Recommended Controls

```text
Use:
  - Maven dependencyManagement or Gradle version catalog
  - dependency locking
  - CI dependency tree check
  - OWASP/dependency vulnerability scan
  - integration test with real DB engine
  - release note review before upgrade
  - smoke test for all mapper XML
```

---

## 19. Upgrade Path: Java 8 / Boot 2 / MyBatis 2.3.x to Java 17 / Boot 3 / Starter 3.x

A safe upgrade should not be:

```text
change Java + Spring Boot + MyBatis + JDBC driver + database driver + DTO style + mapper style all at once
```

That is a big bang migration.

### 19.1 Safer Migration Sequence

```text
Phase 1: Stabilize current Java 8 system
  - lock dependencies
  - add mapper integration tests
  - validate XML mapper loading
  - remove unsafe dynamic SQL where possible
  - improve transaction tests
  - add slow query logging

Phase 2: Upgrade build and test infrastructure
  - modernize Maven/Gradle
  - add toolchain config
  - add CI matrix if needed
  - ensure tests reproducible

Phase 3: Move runtime to Java 17 while staying on Boot 2 if possible
  - catch illegal reflective access
  - catch old dependency issues
  - validate JDBC driver
  - validate timezone behavior

Phase 4: Migrate Spring Boot 2 -> 3
  - Jakarta namespace migration
  - Spring Security migration if relevant
  - validation/web/test migration
  - MyBatis starter 3.x

Phase 5: Modernize code style selectively
  - introduce records for new projections
  - constructor mapping where useful
  - improve mapper contracts
  - refactor legacy XML gradually
```

### 19.2 Why This Sequence Works

It separates risk:

```text
Dependency risk
  separated from runtime risk
  separated from framework migration risk
  separated from code style refactoring risk
  separated from SQL behavior risk
```

This is how top-tier engineers avoid making migration impossible to debug.

---

## 20. Upgrade Path: Java 17/21 to Java 25 / Boot 4

For systems already on Java 17+ and Boot 3.x, Java 25/Boot 4 migration is still non-trivial.

### 20.1 Validate First

Check:

```text
- Spring Boot 4 compatibility
- Spring Framework 7 compatibility
- MyBatis Spring Boot Starter Boot 4 line
- MyBatis-Spring 4 line
- JDBC driver support for Java 25
- observability libraries
- security libraries
- test containers
- build plugins
- annotation processors
- Lombok version
- MapStruct version
```

### 20.2 Do Not Combine With Mapper Rewrite

Do not simultaneously:

- migrate Boot 4;
- change all DTOs to records;
- replace XML dynamic SQL with Dynamic SQL DSL;
- change database driver;
- change transaction manager;
- change datasource routing;
- change pagination behavior.

The system may still compile, but semantic regression risk is high.

---

## 21. Annotation Mapper vs XML Mapper Across Java Versions

### 21.1 Java 8

Annotation SQL often becomes ugly:

```java
@Select("SELECT id, username, display_name FROM users WHERE id = #{id}")
UserSummary findById(Long id);
```

Still okay for small SQL.

### 21.2 Java 17+

Text blocks improve readability:

```java
@Select("""
    SELECT
      id,
      username,
      display_name AS displayName
    FROM users
    WHERE id = #{id}
    """)
UserSummary findById(Long id);
```

But complex dynamic SQL still better in XML or Dynamic SQL library.

### 21.3 Decision Rule

```text
Use annotation mapper when SQL is:
  - short
  - stable
  - non-dynamic or minimally dynamic
  - easy to test

Use XML mapper when SQL is:
  - long
  - dynamic
  - vendor-specific
  - shared with DBA review
  - uses resultMap deeply
  - has nested mapping

Use Dynamic SQL DSL when SQL is:
  - generated from composable filter objects
  - type-safe column references are valuable
  - team accepts Java DSL readability
```

---

## 22. Plugin/Interceptor Compatibility

MyBatis plugin can intercept internal components such as executor or statement handler. This is powerful but risky during upgrades.

### 22.1 Why Plugins Are Compatibility-Sensitive

Plugins often depend on:

- internal method signatures;
- expected object type;
- SQL string assumptions;
- parameter object structure;
- mapped statement id naming;
- executor behavior;
- transaction behavior;
- thread-local context.

During version upgrade, plugin may still compile but behave differently.

### 22.2 Plugin Upgrade Checklist

```text
For every MyBatis interceptor:
  - identify intercepted target
  - identify method signature
  - test with representative mapper methods
  - test select/insert/update/delete
  - test batch executor if used
  - test transaction rollback
  - test multi-datasource behavior
  - test thread-local cleanup
  - test virtual-thread compatibility if Java 21+
```

### 22.3 Virtual Thread Warning

If interceptor uses `ThreadLocal`, virtual-thread-heavy applications need discipline.

ThreadLocal still works with virtual threads, but careless usage can increase memory pressure or leak context if lifecycle is not controlled.

Prefer explicit context passing where possible, or ensure strict cleanup:

```java
try {
    TenantContext.set(tenantId);
    return invocation.proceed();
} finally {
    TenantContext.clear();
}
```

---

## 23. Testing Compatibility Matrix

A high-quality MyBatis codebase should have tests that catch compatibility issues early.

### 23.1 Minimum Test Layers

```text
Mapper XML Load Test
  Ensures all XML mappers parse and statements register.

Mapper Integration Test
  Executes representative queries against real database engine.

Transaction Test
  Validates commit/rollback behavior.

Dynamic SQL Branch Test
  Exercises optional filters and foreach branches.

Result Mapping Test
  Validates DTO/projection mapping.

Concurrency Test
  Validates optimistic/pessimistic lock behavior.

Migration Test
  Applies schema migration then runs mapper tests.
```

### 23.2 Java Version CI Matrix

For libraries shared across Java versions:

```text
Build on Java 8 if target is Java 8.
Build on Java 17 if target is Java 17.
Build on Java 21/25 for runtime smoke if supported.
```

For app services:

```text
Run CI on the exact production JDK.
Do not rely on developer laptop JDK.
```

---

## 24. Common Compatibility Failure Cases

### 24.1 Unsupported Class Version

Symptom:

```text
UnsupportedClassVersionError
```

Likely cause:

```text
Library compiled for newer Java than runtime.
```

Fix:

```text
Use compatible dependency line or upgrade runtime JDK.
```

### 24.2 Mapper Bean Not Found After Upgrade

Symptom:

```text
No qualifying bean of type 'XMapper'
```

Likely causes:

- `@MapperScan` package changed;
- auto-configuration changed;
- module scanning changed;
- mapper interface not annotated;
- multiple datasource config incomplete.

### 24.3 XML Mapper Not Found

Symptom:

```text
Invalid bound statement (not found)
```

Likely causes:

- XML not included in build resources;
- mapper location property wrong;
- namespace mismatch;
- statement id mismatch;
- multi-module resource packaging issue.

### 24.4 Transaction Not Rolling Back

Symptom:

```text
Data committed even when service throws exception.
```

Likely causes:

- method not called through Spring proxy;
- wrong transaction manager;
- mapper bound to non-managed session;
- checked exception rollback rule missing;
- manual `SqlSession` misuse;
- multi-datasource misconfiguration.

### 24.5 Record Mapping Fails

Symptom:

```text
constructor argument mismatch
property not found
null handling issue
```

Likely causes:

- column alias does not match record component;
- constructor mapping missing;
- primitive component receives null;
- parameter name metadata not available as expected;
- result map still assumes setters.

### 24.6 Virtual Thread Load Causes DB Saturation

Symptom:

```text
Connection timeout
DB active session spike
Lock wait increase
Query latency spike
```

Likely cause:

```text
Application concurrency increased without database concurrency control.
```

Fix:

```text
Bound concurrency, tune pool, optimize SQL, add backpressure, reduce fan-out.
```

---

## 25. Enterprise Design Patterns by Java Version

### 25.1 Java 8 Enterprise Pattern

```text
Mapper Interface
  + XML Mapper
  + POJO DTO
  + explicit resultMap
  + service-layer transaction
  + integration tests
```

Recommended for:

- stable enterprise systems;
- legacy DB;
- Oracle-heavy systems;
- regulated workloads;
- large XML SQL codebase.

### 25.2 Java 17 Enterprise Pattern

```text
Mapper Interface
  + XML Mapper for complex SQL
  + annotation mapper for small SQL
  + record projections
  + constructor result mapping
  + service-layer sealed outcomes
  + strong test slices
```

Recommended for:

- Spring Boot 3 systems;
- modernized service layer;
- improved DTO contracts;
- new feature modules.

### 25.3 Java 21 Enterprise Pattern

```text
Java 17 pattern
  + virtual-thread-aware boundaries
  + bounded DB concurrency
  + set-based query design
  + stronger observability
```

Recommended for:

- high-concurrency web services;
- IO-heavy applications;
- modern runtime platforms;
- services with controlled DB pool.

### 25.4 Java 25 Enterprise Pattern

```text
Java 21 pattern
  + Boot 4 compatible dependency line
  + modern null-safety ecosystem awareness
  + platform-wide dependency governance
  + stricter production readiness gates
```

Recommended for:

- new platform baseline;
- long-lived enterprise modernization;
- systems with strong CI/CD and test coverage.

---

## 26. What Not to Modernize Too Early

Modernization is good, but sequence matters.

Do not prioritize:

```text
1. converting every DTO to record
2. replacing every XML mapper with annotation SQL
3. replacing XML dynamic SQL with Dynamic SQL DSL everywhere
4. adding interceptors for everything
5. using virtual threads to hide slow queries
6. upgrading all dependencies at once
```

Prioritize:

```text
1. mapper correctness
2. result mapping correctness
3. transaction correctness
4. SQL performance
5. security boundaries
6. test coverage
7. observability
8. dependency compatibility
9. selective modernization
```

Top 1% engineer tidak mengejar modern syntax dulu. Mereka mengejar **system invariants** dulu.

---

## 27. Compatibility Checklist

Gunakan checklist ini sebelum memilih atau meng-upgrade MyBatis stack.

### 27.1 Platform

```text
[ ] Java runtime version known
[ ] Java source/target version known
[ ] Build tool supports target Java
[ ] CI uses same Java version as production
[ ] Container base image version known
```

### 27.2 Framework

```text
[ ] Spring Boot version known
[ ] Spring Framework version known
[ ] MyBatis Spring Boot Starter line compatible
[ ] MyBatis-Spring version compatible
[ ] MyBatis Core version known
[ ] Jakarta/javax migration impact reviewed
```

### 27.3 Database

```text
[ ] JDBC driver supports Java version
[ ] JDBC driver supports database version
[ ] Generated key behavior tested
[ ] Date/time behavior tested
[ ] LOB behavior tested if relevant
[ ] Batch behavior tested if relevant
```

### 27.4 Mapper

```text
[ ] XML mapper resources packaged
[ ] Namespace matches mapper interface
[ ] Statement IDs match methods
[ ] Result maps tested
[ ] Dynamic SQL branches tested
[ ] Unsafe ${} reviewed
[ ] Multi-datasource binding explicit
```

### 27.5 Runtime

```text
[ ] Transaction manager correct
[ ] SqlSession managed by Spring
[ ] Mapper scan explicit
[ ] Pool size configured
[ ] Query timeout configured where needed
[ ] Slow SQL observable
[ ] Connection wait observable
```

### 27.6 Upgrade

```text
[ ] Dependency diff reviewed
[ ] Release notes reviewed
[ ] Integration tests pass
[ ] Migration scripts tested
[ ] Rollback plan exists
[ ] Production smoke test defined
```

---

## 28. Practical Decision Examples

### Example 1: Existing Java 8 + Spring Boot 2.7 System

Situation:

```text
Java 8
Spring Boot 2.7
Oracle 19c
Large XML mapper codebase
No strong mapper tests
```

Bad decision:

```text
Upgrade directly to Java 21 + Boot 3 + convert DTOs to records.
```

Better decision:

```text
Stay on starter 2.3.x.
Lock dependencies.
Add mapper integration tests.
Fix unsafe dynamic SQL.
Upgrade JDBC driver carefully.
Then plan Java 17 migration.
```

### Example 2: New Spring Boot 3 Service

Situation:

```text
Java 17
Spring Boot 3.5
PostgreSQL
New service
Read-heavy search screens
```

Good decision:

```text
Use starter 3.0.x.
Use record projections for read DTO.
Use XML for complex reporting queries.
Use Dynamic SQL selectively for composable search filters.
Use Testcontainers for mapper tests.
```

### Example 3: Java 21 High-Concurrency API

Situation:

```text
Java 21
Spring Boot 3.x
Virtual threads enabled
MyBatis mapper calls database
```

Bad decision:

```text
Raise API concurrency without changing pool/backpressure.
```

Good decision:

```text
Keep DB pool bounded.
Track pool wait.
Avoid mapper fan-out.
Prefer set-based SQL.
Set query timeout.
Model lock contention.
```

### Example 4: Moving to Java 25 / Boot 4

Situation:

```text
Java 21
Spring Boot 3.5
Good test coverage
Planning Java 25 and Boot 4
```

Good decision:

```text
Validate Boot 4-compatible MyBatis starter.
Run compatibility branch.
Avoid mapper rewrite during framework migration.
Upgrade build plugins and annotation processors.
Run full integration tests.
Only then modernize DTO or DSL style.
```

---

## 29. Mental Model: Version Strategy as Risk Isolation

Version strategy is not about being “latest”. It is about risk isolation.

```text
A bad upgrade changes many variables at once.
A good upgrade changes one category of risk at a time.
```

Categories:

```text
Java runtime risk
Framework risk
MyBatis integration risk
JDBC driver risk
Database behavior risk
Mapper SQL risk
Result mapping risk
Transaction risk
Concurrency risk
Observability risk
```

If a regression happens after changing all categories together, debugging becomes expensive.

Top-tier engineering is not just knowing new features. It is knowing **which variable changed** and **which invariant must still hold**.

---

## 30. Core Invariants Across Java 8 to 25

Regardless of Java version, MyBatis codebase must preserve these invariants:

### 30.1 Mapper Contract Invariant

```text
Every mapper method must have a clear input, output, cardinality, and failure contract.
```

Example:

```java
Optional<UserSummary> findById(Long id);
List<UserSummary> search(UserSearchCriteria criteria);
int updateIfVersionMatches(UserUpdateCommand command);
boolean existsByUsername(String username);
```

### 30.2 SQL Visibility Invariant

```text
Critical SQL must be visible, reviewable, testable, and explainable.
```

### 30.3 Parameter Safety Invariant

```text
External input must never become raw SQL text unless passed through strict whitelist rules.
```

### 30.4 Result Mapping Invariant

```text
Every selected column must map intentionally to the target object.
```

### 30.5 Transaction Boundary Invariant

```text
Transactions belong at service/use-case boundary, not randomly inside mapper usage.
```

### 30.6 Performance Invariant

```text
Mapper performance is SQL performance plus mapping cost plus transaction/resource cost.
```

### 30.7 Upgrade Invariant

```text
Version upgrade must not change business semantics silently.
```

---

## 31. How This Part Connects to the Rest of the Series

This part gives the version and platform map.

Next parts will go deeper:

```text
Part 3
  Mapper design fundamentals.

Part 4
  SELECT/INSERT/UPDATE/DELETE statement mapping.

Part 5
  Parameter binding and SQL injection boundary.

Part 6-7
  Result mapping, immutable DTO, records, nested object.

Part 8-9
  XML dynamic SQL and MyBatis Dynamic SQL library.

Part 11-12
  Spring transaction and Spring Boot integration.

Part 20-22
  Concurrency, performance, and observability.
```

The version strategy here will influence all those design choices.

---

## 32. Summary

MyBatis can work across a wide range of Java generations, but production-grade design requires more than “dependency compiles”.

Key conclusions:

1. MyBatis compatibility is stack-level, not just core-library-level.
2. Java 8 systems should stay on the Boot 2.7-compatible starter line unless migrating runtime/framework.
3. Spring Boot 3 means Java 17+ and MyBatis starter 3.x line.
4. Java 21 virtual threads reduce JVM thread cost but do not remove database concurrency limits.
5. Java 25/Boot 4 migration should be treated as platform migration, not mapper rewrite opportunity.
6. Records are excellent for Java 17+ read projections, but not a universal replacement for all DTOs.
7. XML mapper remains valuable for complex SQL even in modern Java.
8. MyBatis Dynamic SQL is useful, but should be applied selectively.
9. Upgrade safety depends on test coverage, mapper contract clarity, transaction correctness, and observability.
10. Top-tier MyBatis engineering is about preserving invariants across runtime, framework, SQL, transaction, and schema evolution.

---

## 33. References

- MyBatis Spring Boot Starter official repository and compatibility matrix: https://github.com/mybatis/spring-boot-starter
- MyBatis Java API documentation: https://mybatis.org/mybatis-3/java-api.html
- MyBatis Configuration documentation: https://mybatis.org/mybatis-3/configuration.html
- MyBatis Dynamic SQL introduction: https://mybatis.org/mybatis-dynamic-sql/docs/introduction.html
- MyBatis Dynamic SQL repository requirements: https://github.com/mybatis/mybatis-dynamic-sql
- MyBatis-Spring SqlSession documentation: https://mybatis.org/spring/sqlsession.html
- MyBatis-Spring transaction documentation: https://mybatis.org/spring/transactions.html
- MyBatis Spring Boot autoconfigure documentation: https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/
- Spring Boot system requirements: https://docs.spring.io/spring-boot/system-requirements.html
- Spring Boot 4 announcement: https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now

---

## 34. Status Seri

```text
Part 0: selesai
Part 1: selesai
Part 2: selesai
Part 3: berikutnya
```

Seri **belum selesai**. Bagian berikutnya adalah:

```text
03-mapper-design-interface-xml-annotation-and-naming-discipline.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: 01 — MyBatis Core Runtime Architecture: `SqlSession`, `Executor`, `Configuration`](./01-mybatis-core-runtime-architecture-sqlsession-executor-configuration.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 3 — Mapper Design: Interface, XML, Annotation, and Naming Discipline](./03-mapper-design-interface-xml-annotation-and-naming-discipline.md)

</div>