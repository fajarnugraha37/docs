# Part 12 — Spring Boot Integration: Auto Configuration, Mapper Scan, Configuration Customizer

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `12-spring-boot-integration-autoconfiguration-mapperscan-customizer.md`  
> Target: Java 8 sampai Java 25, Spring Boot 2.7 sampai 4.x direction, MyBatis 3.5+, MyBatis-Spring, MyBatis Spring Boot Starter

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas transaction boundary, `SqlSession`, `SqlSessionTemplate`, dan bagaimana MyBatis berpartisipasi dalam transaction Spring. Bagian ini melanjutkan ke lapisan yang biasanya terlihat sederhana tetapi sering menjadi sumber masalah pada aplikasi enterprise besar: **integrasi Spring Boot**.

Spring Boot membuat MyBatis terasa mudah:

```java
@Mapper
public interface CaseMapper {
    CaseDetailRow findById(Long id);
}
```

Lalu aplikasi berjalan. Tetapi di balik itu ada banyak keputusan konfigurasi:

- `DataSource` mana yang dipakai?
- Siapa yang membuat `SqlSessionFactory`?
- Siapa yang membuat `SqlSessionTemplate`?
- Mapper interface ditemukan dari package mana?
- XML mapper ditemukan dari resource path mana?
- Apakah mapper XML namespace cocok dengan interface?
- Bagaimana kalau ada lebih dari satu datasource?
- Bagaimana kalau ada read/write split?
- Bagaimana kalau ada multiple schema?
- Bagaimana kalau ada beberapa module JAR yang masing-masing membawa mapper XML?
- Bagaimana mengatur `Configuration` tanpa membuat konfigurasi manual yang mematikan auto-configuration?
- Bagaimana mengetes konfigurasi agar kegagalan tidak baru muncul saat runtime?

Bagian ini bertujuan membuat kita tidak hanya bisa “pakai starter”, tetapi bisa menguasai **configuration topology** MyBatis dalam Spring Boot.

---

## 1. Mental Model: Apa yang Dilakukan Spring Boot Starter?

MyBatis Spring Boot Starter bukan framework persistence baru. Ia adalah integrasi otomatis antara:

```text
Spring Boot application context
  -> DataSource
  -> SqlSessionFactoryBean
  -> SqlSessionFactory
  -> SqlSessionTemplate
  -> MapperFactoryBean
  -> Mapper proxy bean
```

Dokumentasi MyBatis Spring Boot Starter menjelaskan bahwa auto-configuration melakukan beberapa hal utama:

1. mendeteksi `DataSource` yang sudah ada;
2. membuat `SqlSessionFactory` menggunakan `SqlSessionFactoryBean`;
3. membuat `SqlSessionTemplate` dari `SqlSessionFactory`;
4. melakukan auto-scan mapper, menghubungkannya ke `SqlSessionTemplate`, lalu mendaftarkannya sebagai Spring bean.

Referensi resmi:

- MyBatis Spring Boot autoconfigure introduction: <https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/>
- MyBatis-Spring introduction: <https://mybatis.org/spring/>
- Mapper injection/scanning: <https://mybatis.org/spring/mappers.html>

Dengan kata lain, starter menghilangkan boilerplate, bukan menghilangkan konsep.

### 1.1. Dari Sudut Pandang Spring

Spring melihat mapper sebagai bean.

```text
@Service
  injects
@Mapper proxy bean
  delegates to
SqlSessionTemplate
  delegates to
SqlSession bound to transaction
  delegates to
Executor/JDBC
```

Mapper interface tidak memiliki implementasi Java manual. Implementasinya adalah proxy yang dibuat MyBatis-Spring.

### 1.2. Dari Sudut Pandang MyBatis

MyBatis melihat mapper sebagai:

```text
namespace + statement id + parameter + result mapping
```

Contoh:

```java
package com.example.caseapp.casefile.persistence;

@Mapper
public interface CaseMapper {
    CaseDetailRow findDetailById(Long caseId);
}
```

```xml
<mapper namespace="com.example.caseapp.casefile.persistence.CaseMapper">
  <select id="findDetailById" resultMap="CaseDetailRowMap">
    SELECT ...
  </select>
</mapper>
```

Binding-nya terjadi karena:

```text
namespace = fully qualified mapper interface name
id        = mapper method name
```

Jika salah satu tidak cocok, mapper bisa gagal saat startup atau saat method dipanggil, tergantung konfigurasi dan path XML.

---

## 2. Version Compatibility: Jangan Campur Jalur Sembarangan

Karena seri ini mencakup Java 8 sampai Java 25, kita harus jelas membedakan **jalur legacy** dan **jalur modern**.

Berdasarkan repository resmi MyBatis Spring Boot Starter, requirement utamanya adalah:

| Jalur | MyBatis | MyBatis-Spring | Java | Spring Boot |
|---|---:|---:|---:|---:|
| `2.3.x` | 3.5 | 2.1 | Java 8+ | Spring Boot 2.7 |
| `3.0.x` | 3.5 | 3.0 | Java 17+ | Spring Boot 3.2–3.5 |
| `master` / Boot 4 direction | 3.5 | 4.0 | Java 17+ | Spring Boot 4.0 |

Referensi resmi: <https://github.com/mybatis/spring-boot-starter>

### 2.1. Konsekuensi Praktis

Untuk Java 8:

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>2.3.x</version>
</dependency>
```

Untuk Spring Boot 3.x:

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>3.0.x</version>
</dependency>
```

Untuk Spring Boot 4.x, ikuti jalur starter yang kompatibel dengan Boot 4 dan MyBatis-Spring 4.

### 2.2. Kesalahan Umum

Kesalahan yang sering terjadi:

```text
Spring Boot 2.7 + mybatis-spring-boot-starter 3.x
Spring Boot 3.x + mybatis-spring-boot-starter 2.x
Java 8 + Spring Boot 3.x
Java 11 + Spring Boot 3.x
Manual override mybatis-spring tanpa memahami transitive dependency
```

Spring Boot 3 membutuhkan Java 17+. Jadi walaupun MyBatis core masih bisa terasa “netral”, stack Spring Boot-nya tidak netral.

### 2.3. Prinsip Top 1%

Engineer biasa bertanya:

> Versi mana yang bisa jalan?

Engineer yang matang bertanya:

> Kombinasi versi mana yang menjadi supported lane, bisa dipatch, bisa dites, dan tidak membuat dependency graph ambigu?

Untuk enterprise system, dependency harus diperlakukan sebagai compatibility contract, bukan sekadar angka Maven.

---

## 3. Minimal Spring Boot Setup

### 3.1. Maven — Spring Boot 3.x / Java 17+

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>3.0.4</version>
</dependency>
```

Biasanya kita juga punya JDBC driver dan datasource/pool.

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <scope>runtime</scope>
</dependency>
```

Atau Oracle:

```xml
<dependency>
  <groupId>com.oracle.database.jdbc</groupId>
  <artifactId>ojdbc11</artifactId>
  <scope>runtime</scope>
</dependency>
```

Versi driver sebaiknya dikendalikan oleh BOM atau dependency management perusahaan.

### 3.2. Gradle — Spring Boot 3.x / Java 17+

```gradle
dependencies {
    implementation 'org.mybatis.spring.boot:mybatis-spring-boot-starter:3.0.4'
    runtimeOnly 'org.postgresql:postgresql'
}
```

### 3.3. Java 8 / Spring Boot 2.7

Untuk Java 8, gunakan jalur starter `2.3.x`.

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>2.3.2</version>
</dependency>
```

Jangan memakai record, sealed class, atau fitur Java modern di DTO yang harus kompatibel dengan Java 8.

---

## 4. Basic Configuration di `application.yml`

Contoh konfigurasi minimal:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/case_db
    username: case_app
    password: secret
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 30000

mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  type-aliases-package: com.example.caseapp
  type-handlers-package: com.example.caseapp.common.persistence.typehandler
  configuration:
    map-underscore-to-camel-case: true
    default-fetch-size: 100
    default-statement-timeout: 30
    jdbc-type-for-null: NULL
    local-cache-scope: SESSION
```

### 4.1. Jangan Menganggap Property Ini Dekorasi

Setiap property punya konsekuensi runtime.

| Property | Fungsi | Risiko jika salah |
|---|---|---|
| `mapper-locations` | Lokasi XML mapper | XML tidak ditemukan, statement missing |
| `type-aliases-package` | Package alias class | Alias bentrok atau tidak ditemukan |
| `type-handlers-package` | Auto-register TypeHandler | Type conversion salah |
| `map-underscore-to-camel-case` | Auto mapping `case_id` -> `caseId` | Silent mapping issue jika column alias tidak disiplin |
| `default-fetch-size` | Hint fetch result | Memory/roundtrip issue |
| `default-statement-timeout` | Timeout query | Query stuck jika tidak ada timeout |
| `jdbc-type-for-null` | JDBC type saat binding null | Error saat nullable insert/update di beberapa DB |
| `local-cache-scope` | Scope local cache | Stale read atau memory issue |

### 4.2. `classpath:` vs `classpath*:`

Ini penting untuk aplikasi multi-module.

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
```

Gunakan `classpath*:` bila XML mapper bisa berada di beberapa JAR/module.

Contoh struktur:

```text
case-module.jar
  mappers/case/CaseMapper.xml

appeal-module.jar
  mappers/appeal/AppealMapper.xml

main-app.jar
  loads both
```

Jika memakai `classpath:` biasa, resource dari module tertentu bisa tidak ter-load sesuai classpath resolution.

---

## 5. Mapper Scanning

Ada beberapa cara mapper interface didaftarkan sebagai Spring bean.

### 5.1. `@Mapper` pada Interface

```java
package com.example.caseapp.casefile.persistence;

import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface CaseMapper {
    CaseDetailRow findDetailById(Long caseId);
}
```

Kelebihan:

- eksplisit;
- mudah dibaca;
- cocok untuk aplikasi kecil sampai menengah.

Kekurangan:

- semua mapper harus diberi annotation;
- mudah lupa pada mapper baru;
- untuk multi-datasource tidak cukup presisi jika semua mapper ikut auto-scanned.

### 5.2. `@MapperScan` pada Configuration Class

```java
@Configuration
@MapperScan("com.example.caseapp")
public class MyBatisConfig {
}
```

Lebih rapi untuk codebase besar.

Lebih presisi:

```java
@Configuration
@MapperScan(
    basePackages = "com.example.caseapp.casefile.persistence",
    sqlSessionTemplateRef = "caseSqlSessionTemplate"
)
public class CaseMyBatisConfig {
}
```

Dokumentasi MyBatis-Spring menjelaskan bahwa `@MapperScan` berfungsi mendaftarkan mapper interface melalui mekanisme yang mirip `MapperScannerConfigurer`, dan pada skenario multiple datasource kita perlu menentukan factory/template yang tepat.

Referensi:

- <https://mybatis.org/spring/mappers.html>
- <https://mybatis.org/spring/apidocs/org/mybatis/spring/annotation/MapperScan.html>

### 5.3. Auto-Scan Default oleh Starter

Starter dapat melakukan auto-scan mapper pada base package yang sama dengan Spring Boot application.

Contoh:

```java
@SpringBootApplication
public class CaseApplication {
    public static void main(String[] args) {
        SpringApplication.run(CaseApplication.class, args);
    }
}
```

Jika `CaseApplication` berada di:

```text
com.example.caseapp
```

Maka package di bawahnya bisa ikut ditemukan.

Tapi untuk aplikasi besar, jangan terlalu mengandalkan magic. Gunakan `@MapperScan` eksplisit agar boundary jelas.

---

## 6. Mapper XML Location Discipline

### 6.1. Struktur yang Disarankan

```text
src/main/java/
  com/example/caseapp/casefile/persistence/
    CaseMapper.java
    CaseAssignmentMapper.java

src/main/resources/
  mappers/casefile/
    CaseMapper.xml
    CaseAssignmentMapper.xml
```

`application.yml`:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
```

### 6.2. Namespace Harus Cocok

```xml
<mapper namespace="com.example.caseapp.casefile.persistence.CaseMapper">
```

Jika namespace salah:

```xml
<mapper namespace="com.example.caseapp.casefile.CaseMapper">
```

maka method di interface tidak akan menemukan mapped statement yang benar.

### 6.3. Statement ID Harus Cocok dengan Method Name

```java
public interface CaseMapper {
    CaseDetailRow findDetailById(Long caseId);
}
```

```xml
<select id="findDetailById" resultMap="CaseDetailRowMap">
  SELECT ...
</select>
```

Jika XML menggunakan:

```xml
<select id="findById" ...>
```

maka method `findDetailById` akan gagal karena statement id tidak ditemukan.

### 6.4. Build-Time Resource Trap

Pastikan XML masuk ke artifact.

Pada Maven, resource default adalah:

```text
src/main/resources/**
```

Jika XML disimpan di `src/main/java`, perlu konfigurasi resource tambahan. Sebaiknya hindari. Simpan XML di `src/main/resources`.

---

## 7. `mybatis.configuration` vs `config-location`

Ada dua pendekatan konfigurasi.

### 7.1. Konfigurasi via `application.yml`

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
    default-statement-timeout: 30
```

Cocok untuk konfigurasi sederhana dan Boot-native.

### 7.2. Konfigurasi via `mybatis-config.xml`

```yaml
mybatis:
  config-location: classpath:mybatis/mybatis-config.xml
```

Contoh:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE configuration
  PUBLIC "-//mybatis.org//DTD Config 3.0//EN"
  "https://mybatis.org/dtd/mybatis-3-config.dtd">
<configuration>
  <settings>
    <setting name="mapUnderscoreToCamelCase" value="true"/>
    <setting name="defaultStatementTimeout" value="30"/>
  </settings>
</configuration>
```

### 7.3. Jangan Campur Sembarangan

Jika menggunakan `config-location`, pahami bahwa konfigurasi XML menjadi sumber penting. Jangan membuat konfigurasi tersebar antara YAML, XML, dan Java customizer tanpa aturan.

Recommended pattern:

```text
Simple Boot app:
  use application.yml only

Enterprise shared config:
  application.yml + ConfigurationCustomizer

Legacy migration:
  mybatis-config.xml temporarily

Complex multi-datasource:
  explicit SqlSessionFactoryBean per datasource
```

---

## 8. ConfigurationCustomizer

`ConfigurationCustomizer` memungkinkan kita mengubah object `org.apache.ibatis.session.Configuration` yang dibuat auto-configuration.

Contoh:

```java
@Configuration
public class MyBatisTuningConfig {

    @Bean
    ConfigurationCustomizer myBatisConfigurationCustomizer() {
        return configuration -> {
            configuration.setMapUnderscoreToCamelCase(true);
            configuration.setDefaultStatementTimeout(30);
            configuration.setDefaultFetchSize(100);
        };
    }
}
```

### 8.1. Kapan Dipakai?

Gunakan jika:

- setting perlu conditional;
- setting tidak nyaman ditulis di YAML;
- ingin register behavior programmatically;
- ingin centralize standard enterprise configuration.

### 8.2. Kapan Jangan Dipakai?

Jangan pakai untuk menyembunyikan konfigurasi penting yang harus terlihat di `application.yml`.

Buruk:

```java
@Bean
ConfigurationCustomizer hiddenConfig() {
    return configuration -> {
        configuration.setCacheEnabled(false);
        configuration.setLazyLoadingEnabled(true);
        configuration.setAggressiveLazyLoading(true);
        configuration.setLocalCacheScope(LocalCacheScope.STATEMENT);
    };
}
```

Masalahnya bukan kode di atas tidak bisa jalan. Masalahnya adalah konfigurasi runtime penting menjadi tersembunyi dan sulit dilacak.

### 8.3. Prinsip

```text
ConfigurationCustomizer should encode policy, not surprise.
```

---

## 9. SqlSessionFactoryBeanCustomizer

`SqlSessionFactoryBeanCustomizer` digunakan untuk mengubah `SqlSessionFactoryBean` sebelum membangun `SqlSessionFactory`.

Contoh:

```java
@Configuration
public class MyBatisFactoryConfig {

    @Bean
    SqlSessionFactoryBeanCustomizer sqlSessionFactoryBeanCustomizer() {
        return factoryBean -> {
            factoryBean.setFailFast(true);
        };
    }
}
```

### 9.1. Apa Bedanya dengan `ConfigurationCustomizer`?

```text
ConfigurationCustomizer
  modifies org.apache.ibatis.session.Configuration

SqlSessionFactoryBeanCustomizer
  modifies SqlSessionFactoryBean before factory is created
```

Gunakan `SqlSessionFactoryBeanCustomizer` untuk hal-hal yang levelnya factory bean, misalnya:

- fail-fast behavior;
- custom VFS;
- mapper locations jika perlu programmatic;
- plugin/interceptor registration;
- type aliases/type handlers dalam skenario khusus.

### 9.2. Jangan Terlalu Cepat Manual

Banyak developer langsung membuat bean `SqlSessionFactory` manual. Itu valid, tapi konsekuensinya auto-configuration bisa tidak lagi berlaku seperti yang diharapkan.

Sebelum manual full config, tanyakan:

```text
Apakah cukup dengan mybatis.* properties?
Apakah cukup dengan ConfigurationCustomizer?
Apakah cukup dengan SqlSessionFactoryBeanCustomizer?
Apakah benar-benar butuh explicit SqlSessionFactoryBean?
```

---

## 10. Type Alias Package

### 10.1. Apa Itu Type Alias?

Aliasing membuat XML tidak perlu menulis fully qualified class name.

Tanpa alias:

```xml
<select id="findDetailById"
        resultType="com.example.caseapp.casefile.persistence.row.CaseDetailRow">
  SELECT ...
</select>
```

Dengan alias:

```yaml
mybatis:
  type-aliases-package: com.example.caseapp.casefile.persistence.row
```

XML:

```xml
<select id="findDetailById" resultType="CaseDetailRow">
  SELECT ...
</select>
```

### 10.2. Risiko Alias

Alias membuat XML lebih pendek, tetapi bisa menimbulkan bentrok.

Contoh:

```text
com.example.caseapp.casefile.row.StatusRow
com.example.caseapp.appeal.row.StatusRow
```

Keduanya bisa punya alias `StatusRow`.

### 10.3. Praktik Aman

Untuk codebase besar, lebih baik:

```yaml
mybatis:
  type-aliases-package: com.example.caseapp.casefile.persistence.row,com.example.caseapp.appeal.persistence.row
```

Tetapi beri nama class yang unik:

```text
CaseStatusRow
AppealStatusRow
```

Atau gunakan fully qualified class name untuk mapper yang sensitif.

### 10.4. Prinsip

```text
Alias is readability optimization, not architecture boundary.
```

---

## 11. Type Handler Package

Custom `TypeHandler` biasanya dipakai untuk:

- enum code;
- value object;
- JSON;
- database-specific type;
- CLOB/BLOB special mapping;
- encrypted value wrapper.

Konfigurasi:

```yaml
mybatis:
  type-handlers-package: com.example.caseapp.common.persistence.typehandler
```

Contoh enum code handler:

```java
public enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus value : values()) {
            if (value.code.equals(code)) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown case status code: " + code);
    }
}
```

```java
@MappedTypes(CaseStatus.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {

    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            CaseStatus parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String code = rs.getString(columnName);
        return code == null ? null : CaseStatus.fromCode(code);
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String code = rs.getString(columnIndex);
        return code == null ? null : CaseStatus.fromCode(code);
    }

    @Override
    public CaseStatus getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String code = cs.getString(columnIndex);
        return code == null ? null : CaseStatus.fromCode(code);
    }
}
```

### 11.1. Testing TypeHandler Registration

Jangan hanya test class handler-nya. Test juga bahwa handler ter-register.

```java
@MybatisTest
class TypeHandlerRegistrationTest {

    @Autowired
    private SqlSessionFactory sqlSessionFactory;

    @Test
    void caseStatusTypeHandlerIsRegistered() {
        TypeHandlerRegistry registry = sqlSessionFactory.getConfiguration().getTypeHandlerRegistry();

        TypeHandler<CaseStatus> handler = registry.getTypeHandler(CaseStatus.class);

        assertThat(handler).isInstanceOf(CaseStatusTypeHandler.class);
    }
}
```

---

## 12. Mapper XML dan Java Interface dalam Multi-Module Project

Pada enterprise system, mapper jarang berada dalam satu module.

Contoh:

```text
case-core
  domain model

case-persistence-mybatis
  mapper interface
  mapper XML
  row DTO
  type handler

case-application
  service/use case

case-api
  controller

main-boot-app
  @SpringBootApplication
```

### 12.1. Problem Umum

`@SpringBootApplication` berada di:

```text
com.company.app
```

Mapper berada di:

```text
com.company.casefile.persistence.mapper
```

Jika package mapper bukan subpackage dari application class, auto-scan bisa tidak menemukan mapper.

Solusi:

```java
@SpringBootApplication(scanBasePackages = "com.company")
@MapperScan("com.company.casefile.persistence.mapper")
public class MainApplication {
}
```

Atau lebih modular:

```java
@Configuration
@MapperScan(
    basePackages = "com.company.casefile.persistence.mapper",
    sqlSessionTemplateRef = "sqlSessionTemplate"
)
public class CasePersistenceMyBatisConfiguration {
}
```

### 12.2. XML Resource di Dependency JAR

Jika XML berada di dependency JAR, gunakan:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
```

Bukan:

```yaml
mybatis:
  mapper-locations: classpath:mappers/**/*.xml
```

### 12.3. Governance Rule

Setiap module persistence harus mendefinisikan:

```text
1. package mapper interface
2. resource mapper XML path
3. type handler package jika ada
4. test slice untuk memastikan mapper loaded
```

---

## 13. Multi-Datasource Integration

Single datasource mudah. Multi-datasource adalah area yang sering membuat konfigurasi MyBatis kacau.

Contoh kasus:

```text
primary database:
  transactional OLTP

report database:
  read replica / reporting schema

audit database:
  append-only audit store
```

Masing-masing butuh:

```text
DataSource
TransactionManager
SqlSessionFactory
SqlSessionTemplate
MapperScan
```

### 13.1. Primary DataSource

```java
@Configuration
@MapperScan(
    basePackages = "com.example.caseapp.primary.mapper",
    sqlSessionTemplateRef = "primarySqlSessionTemplate"
)
public class PrimaryMyBatisConfig {

    @Bean
    @Primary
    @ConfigurationProperties("app.datasource.primary")
    public DataSourceProperties primaryDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Bean
    @Primary
    public DataSource primaryDataSource(
            @Qualifier("primaryDataSourceProperties") DataSourceProperties properties
    ) {
        return properties.initializeDataSourceBuilder().build();
    }

    @Bean
    @Primary
    public SqlSessionFactory primarySqlSessionFactory(
            @Qualifier("primaryDataSource") DataSource dataSource
    ) throws Exception {
        SqlSessionFactoryBean factoryBean = new SqlSessionFactoryBean();
        factoryBean.setDataSource(dataSource);
        factoryBean.setMapperLocations(
            new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mappers/primary/**/*.xml")
        );
        return factoryBean.getObject();
    }

    @Bean
    @Primary
    public SqlSessionTemplate primarySqlSessionTemplate(
            @Qualifier("primarySqlSessionFactory") SqlSessionFactory sqlSessionFactory
    ) {
        return new SqlSessionTemplate(sqlSessionFactory);
    }

    @Bean
    @Primary
    public PlatformTransactionManager primaryTransactionManager(
            @Qualifier("primaryDataSource") DataSource dataSource
    ) {
        return new DataSourceTransactionManager(dataSource);
    }
}
```

### 13.2. Report DataSource

```java
@Configuration
@MapperScan(
    basePackages = "com.example.caseapp.report.mapper",
    sqlSessionTemplateRef = "reportSqlSessionTemplate"
)
public class ReportMyBatisConfig {

    @Bean
    @ConfigurationProperties("app.datasource.report")
    public DataSourceProperties reportDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Bean
    public DataSource reportDataSource(
            @Qualifier("reportDataSourceProperties") DataSourceProperties properties
    ) {
        return properties.initializeDataSourceBuilder().build();
    }

    @Bean
    public SqlSessionFactory reportSqlSessionFactory(
            @Qualifier("reportDataSource") DataSource dataSource
    ) throws Exception {
        SqlSessionFactoryBean factoryBean = new SqlSessionFactoryBean();
        factoryBean.setDataSource(dataSource);
        factoryBean.setMapperLocations(
            new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mappers/report/**/*.xml")
        );
        return factoryBean.getObject();
    }

    @Bean
    public SqlSessionTemplate reportSqlSessionTemplate(
            @Qualifier("reportSqlSessionFactory") SqlSessionFactory sqlSessionFactory
    ) {
        return new SqlSessionTemplate(sqlSessionFactory);
    }

    @Bean
    public PlatformTransactionManager reportTransactionManager(
            @Qualifier("reportDataSource") DataSource dataSource
    ) {
        return new DataSourceTransactionManager(dataSource);
    }
}
```

### 13.3. Transaction Manager Selection

Pada service:

```java
@Service
public class ReportService {

    private final CaseReportMapper caseReportMapper;

    public ReportService(CaseReportMapper caseReportMapper) {
        this.caseReportMapper = caseReportMapper;
    }

    @Transactional(transactionManager = "reportTransactionManager", readOnly = true)
    public List<CaseReportRow> search(CaseReportCriteria criteria) {
        return caseReportMapper.search(criteria);
    }
}
```

Jika lupa menentukan transaction manager, Spring bisa memakai primary transaction manager. Untuk read replica/report DB, ini bisa menghasilkan behavior salah.

### 13.4. Anti-Pattern Multi-Datasource

Buruk:

```java
@MapperScan("com.example.caseapp")
```

Sementara ada banyak datasource.

Masalah:

- mapper report bisa terikat ke primary datasource;
- mapper audit bisa masuk transaction manager yang salah;
- XML path bercampur;
- debugging sangat sulit.

Lebih baik:

```text
com.example.caseapp.primary.mapper -> primarySqlSessionTemplate
com.example.caseapp.report.mapper  -> reportSqlSessionTemplate
com.example.caseapp.audit.mapper   -> auditSqlSessionTemplate
```

---

## 14. Read/Write Split

Read/write split adalah variasi multi-datasource.

```text
write datasource -> primary DB
read datasource  -> replica DB
```

### 14.1. Desain Mapper

Pisahkan mapper:

```text
CaseCommandMapper -> write datasource
CaseQueryMapper   -> read datasource
```

Jangan satu mapper dipakai untuk dua datasource jika statement-nya bercampur.

Buruk:

```java
public interface CaseMapper {
    CaseDetailRow findById(Long id);     // read
    int updateStatus(UpdateStatusCommand command); // write
}
```

Lebih baik:

```java
public interface CaseQueryMapper {
    CaseDetailRow findById(Long id);
}

public interface CaseCommandMapper {
    int updateStatus(UpdateStatusCommand command);
}
```

### 14.2. Read-After-Write Consistency

Masalah read replica:

```text
write primary
then immediately read replica
replica lag -> stale data
```

Service harus sadar consistency.

```java
@Transactional(transactionManager = "writeTxManager")
public CaseDetail approve(ApproveCaseCommand command) {
    int updated = caseCommandMapper.approve(command);
    if (updated != 1) {
        throw new OptimisticLockingFailureException("Case was modified");
    }

    // Read from primary, not replica, because this is read-after-write.
    return casePrimaryQueryMapper.findDetailById(command.caseId())
        .orElseThrow();
}
```

### 14.3. Top 1% Rule

Read/write split is not routing optimization only. It changes consistency semantics.

---

## 15. Mapper Scan Filter and Marker Interface

Untuk codebase besar, bisa gunakan marker interface.

```java
public interface PrimaryDatabaseMapper {
}

public interface ReportDatabaseMapper {
}
```

Mapper:

```java
public interface CaseCommandMapper extends PrimaryDatabaseMapper {
    int approve(ApproveCaseCommand command);
}
```

Scan:

```java
@MapperScan(
    basePackages = "com.example.caseapp",
    markerInterface = PrimaryDatabaseMapper.class,
    sqlSessionTemplateRef = "primarySqlSessionTemplate"
)
```

Kelebihan:

- mapper datasource binding lebih eksplisit;
- refactor package lebih aman;
- mengurangi risiko salah scan.

Kekurangan:

- menambah konsep;
- semua mapper harus disiplin extend marker.

Gunakan jika datasource banyak dan package boundary tidak cukup.

---

## 16. Annotation Mapper dalam Spring Boot

MyBatis mendukung annotation mapper:

```java
@Mapper
public interface CaseLookupMapper {

    @Select("""
        SELECT id, code, name
        FROM case_type
        WHERE active = 1
        ORDER BY display_order
        """)
    List<CaseTypeRow> findActiveCaseTypes();
}
```

### 16.1. Kapan Annotation Cocok?

Cocok untuk:

- query kecil;
- lookup table sederhana;
- test fixture;
- mapper internal kecil;
- statement yang jarang berubah.

### 16.2. Kapan XML Lebih Baik?

XML lebih baik untuk:

- dynamic SQL kompleks;
- banyak column;
- resultMap advanced;
- vendor-specific SQL;
- query panjang;
- report query;
- query yang perlu review DBA;
- query yang sering diubah BA/DBA/domain engineer.

### 16.3. Java 15+ Text Block

Text block membuat annotation mapper lebih readable:

```java
@Select("""
    SELECT
      c.id,
      c.case_no,
      c.status
    FROM cases c
    WHERE c.id = #{caseId}
    """)
CaseRow findById(Long caseId);
```

Tetapi Java 8 tidak mendukung text block. Untuk Java 8, annotation SQL panjang menjadi jelek.

### 16.4. Rule

```text
Annotation mapper is for small stable SQL.
XML mapper is for serious SQL.
```

---

## 17. Configuration Properties: Recommended Baseline

Baseline untuk aplikasi enterprise:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  type-aliases-package: com.example.caseapp
  type-handlers-package: com.example.caseapp.common.persistence.typehandler
  configuration:
    map-underscore-to-camel-case: true
    default-statement-timeout: 30
    default-fetch-size: 100
    jdbc-type-for-null: NULL
    local-cache-scope: SESSION
    cache-enabled: true
    lazy-loading-enabled: false
    aggressive-lazy-loading: false
```

### 17.1. `map-underscore-to-camel-case`

Berguna, tetapi jangan jadikan alasan untuk tidak memakai alias kolom.

Baik:

```sql
SELECT
  c.case_id AS case_id,
  c.case_no AS case_no,
  c.created_at AS created_at
FROM cases c
```

Lebih eksplisit untuk join:

```sql
SELECT
  c.id AS case_id,
  officer.id AS officer_id
FROM cases c
LEFT JOIN officers officer ON officer.id = c.officer_id
```

### 17.2. `default-statement-timeout`

Query tanpa timeout adalah risiko produksi.

```yaml
mybatis:
  configuration:
    default-statement-timeout: 30
```

Statement tertentu bisa override:

```xml
<select id="exportLargeReport" timeout="300" resultMap="ReportRowMap">
  SELECT ...
</select>
```

### 17.3. `default-fetch-size`

Untuk query list besar, fetch size mengontrol batch fetching dari driver.

Tapi behavior spesifik driver/database bisa berbeda.

Jangan menganggap `fetchSize=100` selalu optimal. Test dengan database nyata.

### 17.4. `lazy-loading-enabled`

Default enterprise recommendation:

```yaml
lazy-loading-enabled: false
```

Karena lazy loading bisa memicu:

- N+1 tersembunyi;
- query saat serialization;
- query di luar transaction;
- debugging sulit.

Aktifkan hanya jika benar-benar punya use case dan test coverage.

---

## 18. Fail-Fast Strategy

Kita ingin aplikasi gagal saat startup jika mapper invalid, bukan saat user menekan tombol tertentu.

### 18.1. Kenapa Fail-Fast Penting?

Tanpa fail-fast:

```text
App starts successfully
Rare mapper method called after 3 days
Mapped statement not found
Production incident
```

Lebih baik:

```text
App starts
Mapper XML invalid detected
Deployment fails early
```

### 18.2. Apa yang Bisa Dideteksi Saat Startup?

- XML parse error;
- invalid resultMap reference;
- duplicate statement id;
- invalid include reference;
- beberapa namespace/statement mismatch;
- type alias missing;
- type handler missing.

Tidak semua logic SQL bisa divalidasi tanpa eksekusi database. Karena itu tetap perlu mapper integration test.

### 18.3. Factory Customizer

```java
@Bean
SqlSessionFactoryBeanCustomizer failFastCustomizer() {
    return factoryBean -> factoryBean.setFailFast(true);
}
```

Catatan: property/method availability bisa berbeda antar versi, jadi pastikan sesuai versi MyBatis-Spring Boot Starter yang dipakai.

---

## 19. Testing Spring Boot MyBatis Configuration

### 19.1. `@MybatisTest`

MyBatis Spring Boot Test menyediakan `@MybatisTest` untuk test komponen MyBatis.

Menurut dokumentasi, `@MybatisTest` mengonfigurasi komponen MyBatis seperti `SqlSessionFactory`, `SqlSessionTemplate`, mapper interface, dan secara default memakai embedded database serta rollback transaction setelah test.

Referensi: <https://mybatis.org/spring-boot-starter/mybatis-spring-boot-test-autoconfigure/>

Contoh:

```java
@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class CaseMapperTest {

    @Autowired
    private CaseMapper caseMapper;

    @Test
    void findDetailById_returnsExpectedRow() {
        CaseDetailRow row = caseMapper.findDetailById(1001L);

        assertThat(row).isNotNull();
        assertThat(row.caseId()).isEqualTo(1001L);
    }
}
```

### 19.2. Test Mapper Loaded

```java
@MybatisTest
class MapperRegistrationTest {

    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void caseMapperIsRegistered() {
        assertThat(applicationContext.getBean(CaseMapper.class)).isNotNull();
    }
}
```

### 19.3. Test Statement Exists

```java
@MybatisTest
class MappedStatementRegistrationTest {

    @Autowired
    private SqlSessionFactory sqlSessionFactory;

    @Test
    void mappedStatementExists() {
        Configuration configuration = sqlSessionFactory.getConfiguration();

        assertThat(configuration.hasStatement(
            "com.example.caseapp.casefile.persistence.CaseMapper.findDetailById"
        )).isTrue();
    }
}
```

### 19.4. Test XML Resource Loaded

```java
@Test
void mapperXmlIsLoaded() {
    Collection<String> statementNames = sqlSessionFactory
        .getConfiguration()
        .getMappedStatementNames();

    assertThat(statementNames)
        .contains("com.example.caseapp.casefile.persistence.CaseMapper.findDetailById");
}
```

### 19.5. H2 Trap

H2 sering membuat test terlihat hijau tetapi production gagal karena:

- syntax SQL berbeda;
- pagination berbeda;
- sequence berbeda;
- date/time function berbeda;
- locking berbeda;
- boolean behavior berbeda;
- CLOB/BLOB behavior berbeda.

Untuk query serius, gunakan Testcontainers dengan database vendor nyata.

---

## 20. Production Profile vs Test Profile

### 20.1. Production

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 50
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000

mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  configuration:
    default-statement-timeout: 30
    default-fetch-size: 100
```

### 20.2. Test

```yaml
spring:
  datasource:
    url: jdbc:tc:postgresql:16:///testdb

mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  configuration:
    default-statement-timeout: 10
```

### 20.3. Jangan Bedakan Konfigurasi Mapper Secara Berlebihan

Test profile sebaiknya tidak mengubah hal fundamental:

- mapper locations;
- type aliases package;
- type handlers package;
- map underscore setting;
- lazy loading setting.

Jika test menggunakan konfigurasi berbeda, test tidak lagi mewakili production.

---

## 21. Observability Configuration

Spring Boot integration juga harus mempertimbangkan logging dan observability.

### 21.1. SQL Logging

```yaml
logging:
  level:
    com.example.caseapp.casefile.persistence: DEBUG
    org.mybatis: INFO
```

Atau untuk mapper tertentu:

```yaml
logging:
  level:
    com.example.caseapp.casefile.persistence.CaseMapper: DEBUG
```

### 21.2. Jangan Log Semua Parameter di Production Tanpa Masking

SQL parameter bisa mengandung:

- NRIC/NIK/passport;
- email;
- phone;
- address;
- token;
- free text complaint;
- document metadata;
- agency-sensitive information.

Gunakan logging policy.

### 21.3. Slow Query Logging

MyBatis sendiri bukan APM. Untuk production, kombinasikan:

```text
application metrics
  + datasource pool metrics
  + database slow query log
  + APM tracing
  + correlation ID
```

Mapper name sangat berguna sebagai dimension:

```text
CaseMapper.searchCases
CaseCommandMapper.approve
AuditTrailMapper.insert
```

---

## 22. Spring Boot Actuator and Datasource Health

Walaupun bukan spesifik MyBatis, actuator penting untuk melihat database readiness.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  endpoint:
    health:
      show-details: when_authorized
```

Datasource health tidak membuktikan mapper benar, tetapi membantu membedakan:

```text
DB unreachable
vs
mapper statement error
vs
SQL syntax error
vs
transaction timeout
```

---

## 23. Common Failure Model

### 23.1. Mapper Bean Not Found

Gejala:

```text
No qualifying bean of type 'CaseMapper' available
```

Kemungkinan:

- mapper tidak diberi `@Mapper`;
- `@MapperScan` package salah;
- mapper di luar component scan;
- conditional config tidak aktif;
- multi-module package tidak masuk scan.

Checklist:

```text
1. Mapper interface package benar?
2. @Mapper atau @MapperScan ada?
3. @SpringBootApplication scan base cukup luas?
4. Multi-datasource @MapperScan punya sqlSessionTemplateRef benar?
```

### 23.2. Invalid Bound Statement

Gejala:

```text
Invalid bound statement (not found): com.example.CaseMapper.findById
```

Kemungkinan:

- XML mapper tidak masuk classpath;
- `mapper-locations` salah;
- namespace tidak cocok;
- statement id tidak cocok;
- method overload membingungkan;
- XML file tidak dikemas ke JAR.

Checklist:

```text
1. Cek mapper-locations.
2. Cek classpath* untuk multi-module.
3. Cek namespace = FQCN mapper interface.
4. Cek select/update id = method name.
5. Cek XML masuk target/classes atau final JAR.
```

### 23.3. Type Alias Not Found

Gejala:

```text
Could not resolve type alias 'CaseDetailRow'
```

Kemungkinan:

- `type-aliases-package` salah;
- class tidak public;
- module dependency tidak masuk;
- alias bentrok;
- typo resultType.

Solusi:

- gunakan FQCN untuk validasi cepat;
- perbaiki package scanning;
- hindari nama alias generik.

### 23.4. TypeHandler Not Applied

Gejala:

```text
No typehandler found for property status
```

atau data status terbaca sebagai string bukan enum.

Kemungkinan:

- `type-handlers-package` salah;
- `@MappedTypes` tidak sesuai;
- `@MappedJdbcTypes` terlalu sempit;
- handler tidak public;
- handler tidak punya constructor yang sesuai;
- resultMap tidak menunjuk handler saat dibutuhkan.

### 23.5. Wrong Datasource

Gejala:

```text
Table not found
Invalid schema
Unexpected stale read
Cannot write in read-only transaction
```

Kemungkinan:

- mapper scan terikat ke template salah;
- transaction manager salah;
- primary bean salah;
- read/write mapper bercampur.

Solusi:

- pisahkan package mapper per datasource;
- gunakan `sqlSessionTemplateRef`;
- gunakan explicit `transactionManager` pada service;
- test mapper datasource binding.

### 23.6. XML Parse Error

Gejala:

```text
Error parsing Mapper XML
```

Kemungkinan:

- invalid XML escaping;
- `<` tidak di-escape;
- `&` tidak di-escape;
- include refid salah;
- resultMap reference salah.

Gunakan `<![CDATA[ ... ]]>` secara hemat bila SQL operator mengganggu XML.

```xml
WHERE created_at <![CDATA[ >= ]]> #{fromDate}
```

---

## 24. Production-Grade Configuration Pattern

Untuk aplikasi single datasource yang serius:

```java
@Configuration
@MapperScan(
    basePackages = {
        "com.example.caseapp.casefile.persistence.mapper",
        "com.example.caseapp.appeal.persistence.mapper",
        "com.example.caseapp.audit.persistence.mapper"
    }
)
public class MyBatisConfiguration {

    @Bean
    ConfigurationCustomizer standardMyBatisConfiguration() {
        return configuration -> {
            configuration.setMapUnderscoreToCamelCase(true);
            configuration.setDefaultStatementTimeout(30);
            configuration.setDefaultFetchSize(100);
            configuration.setLazyLoadingEnabled(false);
            configuration.setAggressiveLazyLoading(false);
        };
    }
}
```

`application.yml`:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  type-aliases-package: com.example.caseapp
  type-handlers-package: com.example.caseapp.common.persistence.typehandler
  configuration:
    jdbc-type-for-null: NULL
    local-cache-scope: SESSION
```

### 24.1. Kenapa Sebagian di YAML dan Sebagian di Java?

YAML bagus untuk environment/configurable property.

Java customizer bagus untuk policy yang ingin dikontrol oleh code review.

Tetapi jangan buat dua tempat saling override tanpa jelas.

### 24.2. Alternative: Semua di YAML

Untuk tim yang lebih suka declarative config:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  type-aliases-package: com.example.caseapp
  type-handlers-package: com.example.caseapp.common.persistence.typehandler
  configuration:
    map-underscore-to-camel-case: true
    default-statement-timeout: 30
    default-fetch-size: 100
    lazy-loading-enabled: false
    aggressive-lazy-loading: false
    jdbc-type-for-null: NULL
    local-cache-scope: SESSION
```

Ini lebih mudah diaudit dari luar code.

---

## 25. Spring Boot Configuration and Java 8–25 Considerations

### 25.1. Java 8

Gunakan:

- Spring Boot 2.7;
- MyBatis Spring Boot Starter 2.3.x;
- POJO DTO;
- explicit constructor jika perlu;
- hindari records/text blocks.

Annotation SQL panjang kurang nyaman karena belum ada text block.

### 25.2. Java 11

Masih transitional. Banyak enterprise app ada di Java 11, tetapi Spring Boot 3 membutuhkan Java 17.

Jika masih Boot 2.7 + Java 11:

- tetap gunakan starter 2.3.x;
- siapkan migration ke Java 17;
- jangan adopsi API Java 17 di mapper DTO.

### 25.3. Java 17

Baseline modern untuk Spring Boot 3.

Bisa memakai:

- records untuk projection DTO;
- text blocks untuk annotation SQL kecil;
- sealed interfaces untuk command/criteria hierarchy jika masuk akal;
- stronger type modeling.

### 25.4. Java 21

Virtual threads bisa membantu concurrency model di web/service layer, tetapi MyBatis tetap blocking JDBC.

Jangan berasumsi virtual thread menghilangkan batasan:

- connection pool;
- DB CPU;
- lock contention;
- transaction lifetime;
- slow query.

Virtual thread dapat membuat lebih banyak request menunggu, tetapi database tetap bottleneck.

### 25.5. Java 25

Java 25 berada di jalur modern runtime. Strategy-nya:

- tetap ikuti compatibility Spring Boot dan MyBatis starter;
- jangan hanya upgrade JDK tanpa load test;
- validasi driver JDBC;
- validasi monitoring/agent compatibility;
- validasi GraalVM/native-image jika digunakan.

---

## 26. Mapper Configuration Governance for Large Systems

Untuk sistem 50+ module, buat aturan eksplisit.

### 26.1. Naming Rule

```text
Java interface:
  com.company.<module>.persistence.mapper.<UseCase>Mapper

XML:
  src/main/resources/mappers/<module>/<UseCase>Mapper.xml

Namespace:
  same as Java interface FQCN
```

Contoh:

```text
com.company.casefile.persistence.mapper.CaseQueryMapper
mappers/casefile/CaseQueryMapper.xml
```

XML:

```xml
<mapper namespace="com.company.casefile.persistence.mapper.CaseQueryMapper">
```

### 26.2. Mapper Scan Rule

Single datasource:

```java
@MapperScan("com.company")
```

Boleh, tapi lebih baik eksplisit:

```java
@MapperScan({
    "com.company.casefile.persistence.mapper",
    "com.company.appeal.persistence.mapper",
    "com.company.audit.persistence.mapper"
})
```

Multi datasource:

```text
Never scan all mapper packages into one SqlSessionTemplate.
```

### 26.3. XML Location Rule

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
```

Jangan pakai path yang terlalu spesifik jika module bertambah dan lupa update.

Tetapi untuk multi-datasource, spesifik itu perlu:

```text
primary -> classpath*:mappers/primary/**/*.xml
report  -> classpath*:mappers/report/**/*.xml
```

### 26.4. Review Rule

Setiap mapper baru harus dicek:

```text
[ ] package sesuai module
[ ] XML masuk resource path standar
[ ] namespace cocok interface
[ ] statement id cocok method
[ ] resultMap explicit untuk join
[ ] parameter object bukan Map generik
[ ] query timeout sesuai
[ ] tenant/security scope jelas
[ ] test minimal ada
```

---

## 27. Mini Case Study: Case Management Application

Bayangkan sistem case management regulatory.

Kebutuhan:

```text
- Case query untuk listing/search
- Case command untuk state transition
- Audit insert append-only
- Report query ke read replica
- Lookup query kecil
```

### 27.1. Package Layout

```text
com.example.regsys.casefile
  application
    CaseApprovalService.java
    CaseSearchService.java
  persistence
    command
      CaseCommandMapper.java
      CaseCommandMapper.xml
    query
      CaseQueryMapper.java
      CaseQueryMapper.xml
    row
      CaseDetailRow.java
      CaseListingRow.java
    commandmodel
      ApproveCaseCommand.java
      SearchCaseCriteria.java

com.example.regsys.audit
  persistence
    AuditTrailMapper.java
    AuditTrailMapper.xml

com.example.regsys.report
  persistence
    CaseReportMapper.java
    CaseReportMapper.xml
```

### 27.2. Configuration

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  type-aliases-package: com.example.regsys
  type-handlers-package: com.example.regsys.common.persistence.typehandler
  configuration:
    map-underscore-to-camel-case: true
    default-statement-timeout: 30
    default-fetch-size: 100
    lazy-loading-enabled: false
```

```java
@Configuration
@MapperScan({
    "com.example.regsys.casefile.persistence.command",
    "com.example.regsys.casefile.persistence.query",
    "com.example.regsys.audit.persistence"
})
public class PrimaryMyBatisConfiguration {
}
```

For report datasource:

```java
@Configuration
@MapperScan(
    basePackages = "com.example.regsys.report.persistence",
    sqlSessionTemplateRef = "reportSqlSessionTemplate"
)
public class ReportMyBatisConfiguration {
}
```

### 27.3. Why This Design Works

Karena boundary jelas:

```text
case command mapper -> primary DB, write transaction
case query mapper   -> primary/read depending consistency needs
report mapper       -> report DB/read replica
lookup mapper       -> small SQL, possibly annotation
```

Tidak semua query dipaksakan masuk satu `CaseMapper`.

---

## 28. Checklist Konfigurasi Spring Boot MyBatis

### 28.1. Dependency Checklist

```text
[ ] Spring Boot version cocok dengan starter version
[ ] Java version cocok dengan Spring Boot version
[ ] MyBatis starter tidak di-override sembarangan
[ ] JDBC driver cocok dengan Java runtime
[ ] dependency management/BOM jelas
```

### 28.2. Datasource Checklist

```text
[ ] DataSource tersedia
[ ] pool size realistis
[ ] transaction manager benar
[ ] multiple datasource punya bean name eksplisit
[ ] read/write datasource tidak bercampur
```

### 28.3. Mapper Scan Checklist

```text
[ ] @Mapper atau @MapperScan jelas
[ ] package scan tidak terlalu sempit
[ ] package scan tidak terlalu luas untuk multi-datasource
[ ] sqlSessionTemplateRef digunakan saat multiple datasource
[ ] marker interface/filter digunakan bila perlu
```

### 28.4. XML Mapper Checklist

```text
[ ] mapper-locations benar
[ ] pakai classpath* untuk multi-module
[ ] XML masuk final artifact
[ ] namespace cocok dengan interface FQCN
[ ] statement id cocok dengan method name
[ ] resultMap reference valid
[ ] sql include refid valid
```

### 28.5. Configuration Checklist

```text
[ ] mapUnderscoreToCamelCase disepakati
[ ] default timeout ada
[ ] fetch size disesuaikan
[ ] lazy loading decision eksplisit
[ ] jdbcTypeForNull diset bila perlu
[ ] TypeHandler package benar
[ ] TypeAlias package tidak bentrok
```

### 28.6. Testing Checklist

```text
[ ] mapper registration test
[ ] mapped statement existence test
[ ] XML parse/load test
[ ] real DB integration test untuk SQL penting
[ ] TypeHandler registration test
[ ] multi-datasource binding test
[ ] transaction manager test
```

---

## 29. Anti-Patterns

### 29.1. Relying on Magic Package Scan

```java
@SpringBootApplication
public class App {}
```

Lalu berharap semua mapper dari semua module ditemukan.

Ini rapuh. Gunakan `@MapperScan` eksplisit.

### 29.2. One Mapper Package for Multiple Datasources

```java
@MapperScan("com.example")
```

Dengan tiga datasource.

Ini hampir pasti akan menjadi masalah.

### 29.3. Manual Full Configuration Without Reason

Membuat `SqlSessionFactory`, `SqlSessionTemplate`, mapper scanner, transaction manager manual untuk single datasource sederhana bisa membuat Boot auto-configuration tidak efektif.

Gunakan manual config bila memang perlu.

### 29.4. XML in `src/main/java`

Bisa jalan jika build dikonfigurasi, tetapi sering gagal saat packaging.

Simpan XML di `src/main/resources`.

### 29.5. Generic `type-aliases-package` Terlalu Luas

```yaml
mybatis:
  type-aliases-package: com.example
```

Bisa scan terlalu banyak class dan membuka risiko alias conflict.

Lebih baik arahkan ke package DTO/persistence model.

### 29.6. No Mapper Test

Aplikasi bisa compile, tetapi mapper XML salah baru ketahuan saat endpoint dipanggil.

Mapper wajib punya minimal load test.

---

## 30. Decision Framework

### 30.1. Apakah Cukup Auto-Configuration?

Cukup jika:

```text
single datasource
mapper package sederhana
XML mapper path standar
konfigurasi tidak kompleks
```

Gunakan:

```yaml
mybatis.*
```

plus:

```java
@MapperScan(...)
```

### 30.2. Apakah Perlu Customizer?

Perlu jika:

```text
ingin enforce standard Configuration
ingin set policy runtime
ingin plugin/interceptor registration ringan
```

Gunakan:

```java
ConfigurationCustomizer
SqlSessionFactoryBeanCustomizer
```

### 30.3. Apakah Perlu Manual SqlSessionFactoryBean?

Perlu jika:

```text
multiple datasource
custom mapper locations per datasource
custom transaction manager per datasource
read/write split
complex factory setup
```

### 30.4. Apakah Perlu Marker Interface?

Perlu jika:

```text
mapper package boundary tidak cukup
multi-datasource besar
module sering berpindah package
ingin compile-time-ish grouping
```

---

## 31. Ringkasan Mental Model

Spring Boot integration MyBatis bukan hanya dependency starter.

Ia adalah graph:

```text
DataSource
  -> TransactionManager
  -> SqlSessionFactoryBean
  -> SqlSessionFactory
  -> SqlSessionTemplate
  -> Mapper proxy beans
  -> XML mapped statements
```

Ketika terjadi error, cari di graph ini.

```text
Mapper bean not found
  -> scan problem

Invalid bound statement
  -> XML location / namespace / id problem

Wrong database/table
  -> datasource/template binding problem

Rollback not working
  -> transaction manager/boundary problem

Type conversion wrong
  -> type handler registration problem

Column mapping wrong
  -> resultMap/alias/config problem
```

Top-tier engineer tidak hanya tahu property. Ia tahu **failure topology** dari konfigurasi.

---

## 32. Latihan

### Latihan 1 — Single Datasource Setup

Buat Spring Boot app kecil dengan:

```text
CaseMapper.java
mappers/case/CaseMapper.xml
application.yml
@MapperScan
@MybatisTest
```

Validasi:

```text
[ ] mapper bean ada
[ ] statement ada
[ ] query bisa jalan
```

### Latihan 2 — Namespace Failure

Sengaja ubah namespace XML menjadi salah. Amati error.

Catat:

```text
Apakah error muncul saat startup atau saat method dipanggil?
Apa stack trace utamanya?
Bagaimana mempercepat fail-fast?
```

### Latihan 3 — Multi-Datasource Binding

Buat dua datasource:

```text
primary
report
```

Buat dua mapper package:

```text
primary.mapper
report.mapper
```

Pastikan mapper report tidak bisa mengakses table primary jika salah binding.

### Latihan 4 — TypeHandler Registration

Buat enum code handler dan test bahwa handler ter-register.

### Latihan 5 — XML in Dependency JAR

Simulasikan mapper XML berada di module dependency. Bandingkan:

```text
classpath:mappers/**/*.xml
classpath*:mappers/**/*.xml
```

---

## 33. Kesalahan Berpikir yang Harus Dihindari

### 33.1. “Starter Berarti Tidak Perlu Mengerti Konfigurasi”

Salah. Starter hanya membuat default wiring.

Begitu aplikasi punya multiple datasource, report DB, audit DB, custom type handler, atau multi-module packaging, pemahaman internal tetap wajib.

### 33.2. “Kalau Compile Berarti Mapper Benar”

Salah. XML mapper adalah resource runtime. Banyak error tidak ditangkap compiler Java.

### 33.3. “Mapper Scan Luas Lebih Aman”

Tidak selalu. Scan terlalu luas bisa mengikat mapper ke datasource yang salah.

### 33.4. “H2 Test Cukup”

Untuk SQL serius, tidak cukup. H2 bisa berguna untuk wiring test, tetapi bukan validasi vendor SQL.

### 33.5. “ReadOnly Transaction Otomatis Pakai Replica”

Tidak. `readOnly=true` adalah hint/transaction attribute, bukan automatic datasource router kecuali kita membangun routing datasource sendiri.

---

## 34. Apa yang Harus Dikuasai Setelah Part Ini

Setelah bagian ini, kamu harus bisa:

1. menjelaskan apa yang dibuat MyBatis Spring Boot auto-configuration;
2. membedakan `SqlSessionFactory`, `SqlSessionTemplate`, mapper proxy, dan XML mapped statement;
3. mengatur `mapper-locations`, `type-aliases-package`, dan `type-handlers-package` dengan benar;
4. memakai `@Mapper` dan `@MapperScan` secara sadar;
5. mendesain konfigurasi single datasource dan multi-datasource;
6. memilih kapan cukup auto-config, kapan butuh customizer, kapan butuh manual factory;
7. mendeteksi error mapper bean not found, invalid bound statement, wrong datasource, alias/type handler issue;
8. membuat test untuk memastikan mapper XML dan statement ter-load;
9. memahami compatibility lane Java 8 sampai Java 25;
10. membangun configuration governance untuk codebase besar.

---

## 35. Referensi

- MyBatis Spring Boot Starter — Auto Configure Introduction: <https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/>
- MyBatis Spring Boot Starter GitHub Repository and Requirements: <https://github.com/mybatis/spring-boot-starter>
- MyBatis-Spring Introduction: <https://mybatis.org/spring/>
- MyBatis-Spring Injecting Mappers: <https://mybatis.org/spring/mappers.html>
- MyBatis-Spring `SqlSessionFactoryBean`: <https://mybatis.org/spring/factorybean.html>
- MyBatis-Spring `@MapperScan` API: <https://mybatis.org/spring/apidocs/org/mybatis/spring/annotation/MapperScan.html>
- MyBatis Spring Boot Test Auto Configure: <https://mybatis.org/spring-boot-starter/mybatis-spring-boot-test-autoconfigure/>
- MyBatis Mapper XML Files: <https://mybatis.org/mybatis-3/sqlmap-xml.html>
- MyBatis Configuration: <https://mybatis.org/mybatis-3/configuration.html>

---

## 36. Status Seri

Progress seri:

```text
[x] Part 0  - MyBatis Orientation: SQL-First Persistence Mental Model
[x] Part 1  - MyBatis Core Runtime Architecture: SqlSession, Executor, Configuration
[x] Part 2  - Java 8 to 25 MyBatis Version Strategy and Compatibility
[x] Part 3  - Mapper Design: Interface, XML, Annotation, Naming Discipline
[x] Part 4  - SQL Statement Mapping: SELECT, INSERT, UPDATE, DELETE Deep Dive
[x] Part 5  - Parameter Binding: #{}, ${}, TypeHandler, SQL Injection Boundary
[x] Part 6  - Result Mapping: Auto Mapping, Explicit Mapping, Column Discipline
[x] Part 7  - Advanced Result Mapping: Constructor, Record, Immutable DTO, Nested Object
[x] Part 8  - Dynamic SQL XML: if, choose, where, set, trim, foreach
[x] Part 9  - MyBatis Dynamic SQL Library: Type-Safe Query Generation
[x] Part 10 - Mapper Method API Design: Return Type, Optional, List, Cursor, Stream
[x] Part 11 - Transaction Integration: Spring, SqlSession, Propagation, Rollback
[x] Part 12 - Spring Boot Integration: Auto Configuration, Mapper Scan, Configuration Customizer
[ ] Part 13 - TypeHandler Engineering: Domain Types, Enum, JSON, Array, Vendor Types
...
[ ] Part 33 - Capstone: Designing a Production-Grade MyBatis Persistence Layer
```

Seri **belum selesai**. Bagian berikutnya adalah:

```text
13-typehandler-engineering-domain-types-enum-json-array-vendor-types.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — Transaction Integration: Spring, SqlSession, Propagation, Rollback](./11-transaction-integration-spring-sqlsession-propagation-rollback.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 13 — TypeHandler Engineering: Domain Types, Enum, JSON, Array, Vendor Types](./13-typehandler-engineering-domain-types-enum-json-array-vendor-types.md)
