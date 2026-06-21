# Part 33 — Migration Engineering: Spring 5 → 6 → 7, Boot 2 → 3 → 4

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `33-migration-engineering-spring5-6-7-boot2-3-4.md`  
> Target: Java 8 hingga Java 25  
> Posisi seri: Part 33 dari 35  
> Status seri: belum selesai

---

## 0. Premis Utama

Migrasi Spring besar bukan sekadar:

```text
ubah versi dependency
fix compile error
run test
deploy
```

Migrasi Spring besar adalah **rekonstruksi kontrak runtime**.

Yang berubah bukan hanya API. Yang berubah bisa mencakup:

1. baseline Java,
2. baseline Jakarta EE,
3. package namespace,
4. servlet container,
5. Spring Security behavior,
6. path matching,
7. observability model,
8. auto-configuration loading,
9. test framework behavior,
10. dependency ecosystem,
11. plugin build,
12. runtime reflection/AOT constraint,
13. classpath assumptions,
14. transaction/security/proxy edge cases,
15. operational behavior di production.

Engineer biasa melihat migrasi sebagai pekerjaan dependency update. Engineer top-tier melihat migrasi sebagai **risk-controlled transformation of application runtime**.

---

## 1. Kenapa Part Ini Penting

Dalam sistem enterprise, khususnya sistem yang panjang umurnya, Spring upgrade besar sering menjadi salah satu pekerjaan paling berisiko karena menyentuh layer yang hampir semua module pakai.

Contoh impact:

```text
Controller      -> berubah karena jakarta servlet / MVC behavior
Security        -> berubah karena SecurityFilterChain / dispatcher types / matcher
Persistence     -> berubah karena Jakarta Persistence / Hibernate baseline
Validation      -> berubah karena jakarta.validation
Test            -> berubah karena context behavior / mocks / slices
Observability   -> berubah karena Micrometer/Tracing model
Build           -> berubah karena plugin, Java baseline, dependency management
Runtime         -> berubah karena Tomcat/Jetty/Undertow baseline
Library         -> berubah karena third-party masih javax atau belum support Spring 6/7
```

Migrasi yang buruk biasanya bukan gagal di compile. Migrasi yang buruk biasanya:

1. compile berhasil tetapi behavior berubah,
2. test hijau tetapi coverage tidak menyentuh edge case,
3. endpoint hidup tetapi authorization berubah,
4. aplikasi deploy tetapi actuator/probe berubah,
5. startup sukses tetapi runtime memory/latency berubah,
6. batch/job jalan tetapi restartability rusak,
7. event/listener hidup tetapi transactional timing berubah,
8. API contract berubah tanpa sadar.

Tujuan part ini adalah memberi Anda cara berpikir dan playbook untuk migrasi besar Spring dengan kontrol engineering yang kuat.

---

## 2. Version Landscape: Dari Java 8 ke Java 25

### 2.1 Spring 5 / Boot 2 Era

Secara praktis, banyak sistem enterprise lama berada di kombinasi:

```text
Java 8 / 11
Spring Framework 5.x
Spring Boot 2.x
Spring Security 5.x
javax.*
Servlet 4.x / Tomcat 9
Hibernate 5.x
JPA 2.2
Bean Validation 2.0
```

Karakter utama era ini:

1. masih `javax.*`;
2. banyak library lama compatible;
3. Java 8 masih umum;
4. `RestTemplate` masih banyak dipakai;
5. observability sering berbasis Sleuth lama;
6. XML config masih mungkin ditemukan;
7. Spring Security lama banyak memakai `WebSecurityConfigurerAdapter`;
8. classpath scanning dan reflection diasumsikan selalu bebas;
9. native image/AOT belum menjadi concern utama;
10. banyak aplikasi masih “fat monolith” atau early microservices.

### 2.2 Spring 6 / Boot 3 Era

Boot 3 membawa baseline besar:

```text
Java 17+
Spring Framework 6.x
Spring Boot 3.x
Spring Security 6.x
jakarta.*
Servlet 6.x / Tomcat 10.x
Hibernate 6.x
JPA 3.x
Bean Validation 3.x
Micrometer Observation / tracing model baru
AOT/native image support lebih serius
```

Perubahan paling terkenal:

```text
javax.servlet.*      -> jakarta.servlet.*
javax.persistence.*  -> jakarta.persistence.*
javax.validation.*   -> jakarta.validation.*
javax.annotation.*   -> jakarta.annotation.*
javax.transaction.*  -> jakarta.transaction.*
```

Namun migrasi Boot 2 → 3 bukan hanya rename import. Ada perubahan security, observability, dependency baseline, test behavior, servlet container, Hibernate, dan plugin ecosystem.

### 2.3 Spring 7 / Boot 4 Era

Boot 4 / Framework 7 adalah generasi modern berikutnya.

Karakter utama:

1. Java 17 tetap minimum, tetapi Java 25 menjadi LTS modern yang penting.
2. Boot 4 melakukan modularisasi codebase Boot.
3. Spring Framework 7 bergerak ke baseline Jakarta EE 11.
4. Servlet baseline menjadi 6.1.
5. GraalVM native-image perlu versi modern.
6. JSpecify/null-safety menjadi semakin penting.
7. API versioning dan HTTP service client mendapat dukungan lebih eksplisit.
8. Beberapa API lama/legacy semakin terdorong keluar.

Pola besar:

```text
Boot 2  -> legacy stable ecosystem
Boot 3  -> Jakarta transition + Java 17 baseline
Boot 4  -> modern modular Spring + Java 25 era readiness
```

---

## 3. Migration Is Not a Single Jump

Migrasi paling aman biasanya bukan:

```text
Boot 2.3 + Java 8 langsung ke Boot 4 + Java 25
```

Itu terlalu banyak variabel sekaligus.

Strategi yang lebih defensible:

```text
Step 1: Stabilkan di versi latest patch dari branch lama
Step 2: Naik Java runtime secara terkontrol
Step 3: Naik ke Boot 2.7 jika masih Boot 2 lama
Step 4: Bersihkan deprecated API
Step 5: Migrasi javax -> jakarta
Step 6: Naik Boot 3.x
Step 7: Stabilkan production di Boot 3.x
Step 8: Bersihkan deprecated API Boot 3.x
Step 9: Naik Boot 4.x / Spring 7.x
Step 10: Evaluasi Java 25, AOT/native, virtual threads, modular Boot
```

Mental model:

```text
Jangan upgrade framework dan behavior bisnis secara bersamaan.
Jangan upgrade Java, Spring, servlet container, ORM, security, observability, dan deployment topology dalam satu batch tanpa isolation.
```

---

## 4. Migration Risk Model

### 4.1 Compile Risk

Compile risk adalah risiko paling mudah terlihat.

Contoh:

```java
import javax.validation.Valid;
// error setelah pindah ke Boot 3
```

Fix:

```java
import jakarta.validation.Valid;
```

Compile error memberi sinyal jelas. Itu bukan bagian paling berbahaya.

### 4.2 Runtime Wiring Risk

Aplikasi compile tetapi context gagal start.

Contoh:

```text
NoSuchBeanDefinitionException
NoUniqueBeanDefinitionException
ClassNotFoundException
NoClassDefFoundError
BeanCreationException
Condition did not match unexpectedly
```

Penyebab:

1. auto-configuration berubah;
2. dependency hilang;
3. starter berubah module;
4. library belum support Jakarta;
5. bean conditional tidak match;
6. property berubah;
7. classpath berubah.

### 4.3 Behavioral Risk

Ini paling berbahaya.

Contoh:

```text
Endpoint masih 200 tetapi authorization lebih longgar.
Validation masih jalan tetapi message/field mapping berubah.
Path /users/123/ tidak lagi match /users/123.
Transaction rollback berbeda karena exception wrapping berubah.
Serialization JSON berubah karena Jackson/Hibernate module berbeda.
```

Behavioral risk harus dicegah dengan regression tests, contract tests, golden dataset, dan production shadow validation.

### 4.4 Operational Risk

Contoh:

```text
Health endpoint berubah.
Readiness probe salah.
Metrics name/tag berubah.
Tracing propagation berubah.
Startup time berubah.
Memory footprint berubah.
Log format berubah.
Container image berubah.
```

Operational risk sering baru terlihat setelah deploy.

### 4.5 Ecosystem Risk

Contoh:

```text
Springfox tidak support Jakarta.
Library internal masih javax.
Custom starter menggunakan API Boot lama.
Third-party auth lib belum support Spring Security 6/7.
Legacy app server belum support Servlet 6.x.
```

Ini harus di-inventory sebelum coding.

---

## 5. Migration Inventory

Sebelum upgrade, buat inventory. Jangan mulai dengan edit `pom.xml`.

### 5.1 Runtime Inventory

Catat:

```text
Java version
Spring Boot version
Spring Framework version
Spring Security version
Spring Data version
Hibernate version
Tomcat/Jetty/Undertow version
Servlet API version
JPA version
Validation version
Build tool version
Container base image
Deployment platform
```

Contoh table:

| Area | Current | Target | Risk |
|---|---:|---:|---|
| Java | 8 | 17/21/25 | high |
| Boot | 2.3 | 3.5 then 4.x | high |
| Framework | 5.2 | 6.2 then 7.x | high |
| Servlet | 4.0 | 6.0/6.1 | high |
| Hibernate | 5.x | 6.x | high |
| Security | 5.x | 6.x/7.x | high |
| Observability | Sleuth | Micrometer Tracing | medium/high |

### 5.2 Code Inventory

Cari:

```text
javax.
WebSecurityConfigurerAdapter
antMatchers
mvcMatchers
authorizeRequests
RestTemplate custom config
Sleuth classes
spring.factories auto-configuration
Deprecated Spring APIs
Custom BeanPostProcessor
Custom FactoryBean
Custom HandlerMethodArgumentResolver
Custom Filter
Custom OncePerRequestFilter
Custom TransactionManager
Custom Jackson module
Custom Actuator endpoint
XML config
```

Command sederhana:

```bash
grep -R "javax\." src/main/java src/test/java
grep -R "WebSecurityConfigurerAdapter" src/main/java
grep -R "antMatchers\|mvcMatchers\|authorizeRequests" src/main/java
grep -R "spring.factories" src/main/resources
grep -R "@EnableGlobalMethodSecurity" src/main/java
grep -R "Sleuth\|TraceContext\|Tracer" src/main/java
```

PowerShell:

```powershell
Get-ChildItem -Recurse -Include *.java,*.kt,*.xml,*.yml,*.properties |
  Select-String "javax\.|WebSecurityConfigurerAdapter|antMatchers|mvcMatchers|authorizeRequests|spring.factories|EnableGlobalMethodSecurity"
```

### 5.3 Dependency Inventory

Maven:

```bash
mvn dependency:tree > dependency-tree.txt
mvn versions:display-dependency-updates > dependency-updates.txt
mvn versions:display-plugin-updates > plugin-updates.txt
```

Gradle:

```bash
./gradlew dependencies > dependencies.txt
./gradlew dependencyInsight --dependency javax.servlet
./gradlew dependencyInsight --dependency jakarta.servlet
```

Yang dicari:

```text
javax.servlet-api
javax.persistence-api
javax.validation-api
javax.annotation-api
javax.transaction-api
springfox
old swagger libraries
old jjwt versions
old servlet filters
old app server integrations
old Hibernate user types
old Jackson Hibernate module
old security adapters
old Sleuth dependencies
```

### 5.4 Runtime Behavior Inventory

Catat kontrak yang harus tetap sama:

```text
API status code
API payload
error payload
validation response
login/logout behavior
token validation
role/authority mapping
CSRF behavior
CORS behavior
path matching
pagination response
batch restart behavior
scheduled job behavior
message retry/DLQ behavior
actuator endpoint exposure
health/readiness/liveness response
metrics/tracing names
```

Migration tanpa behavior inventory = gambling.

---

## 6. Java Baseline Migration

### 6.1 Java 8 → Java 11 → Java 17

Untuk aplikasi Spring lama, Java baseline sering menjadi blocker utama.

Perubahan penting:

1. Java module system sejak Java 9.
2. Hilangnya beberapa Java EE modules dari JDK modern.
3. Perubahan GC default dan behavior.
4. Illegal reflective access warning.
5. TLS/certificate behavior bisa berubah.
6. Charset, locale, timezone, dan crypto provider edge cases.
7. Build plugin lama bisa gagal di Java modern.

Strategi aman:

```text
Naik Java runtime dulu tanpa naik Spring jika memungkinkan.
Pastikan test dan production-like smoke test jalan.
Baru naik Spring.
```

Namun tidak semua kombinasi didukung. Jangan memaksa Spring lama di Java terlalu baru untuk production tanpa dukungan resmi.

### 6.2 Java 17 sebagai Gate Boot 3

Boot 3 membutuhkan Java 17+. Jadi target minimal migrasi Boot 3 adalah:

```text
compile target: Java 17
runtime: Java 17+
```

Pekerjaan umum:

1. update Maven/Gradle plugin;
2. update Surefire/Failsafe;
3. update bytecode instrumentation tools;
4. update Lombok/MapStruct;
5. update Jacoco;
6. update Docker base image;
7. update CI runner;
8. update IDE/build image.

### 6.3 Java 21/25 Setelah Stabil

Jangan campur:

```text
Boot 2 -> Boot 3
Java 8 -> Java 21/25
Hibernate 5 -> 6
Security 5 -> 6
```

dalam satu PR raksasa jika sistem besar.

Strategi:

```text
Migrate to Java 17 first.
Migrate to Boot 3.
Stabilize.
Then evaluate Java 21/25 runtime.
Then optionally enable virtual threads or new runtime behavior.
```

Java modern bukan hanya compiler version. Ia mempengaruhi:

1. GC,
2. memory,
3. threading,
4. TLS,
5. classloading,
6. startup,
7. container ergonomics.

---

## 7. `javax.*` to `jakarta.*`: More Than Import Rename

### 7.1 Apa yang Berubah

Contoh:

```java
// before
import javax.persistence.Entity;
import javax.validation.NotNull;
import javax.servlet.http.HttpServletRequest;
import javax.annotation.PostConstruct;
import javax.transaction.Transactional;
```

Menjadi:

```java
// after
import jakarta.persistence.Entity;
import jakarta.validation.NotNull;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.annotation.PostConstruct;
import jakarta.transaction.Transactional;
```

Namun tidak semua `javax.*` berubah.

Contoh yang tetap:

```java
javax.sql.DataSource
javax.crypto.Cipher
javax.net.ssl.SSLContext
javax.naming.*
javax.xml.*
```

Jangan gunakan replace-all buta.

### 7.2 Binary Compatibility Problem

`javax.servlet.Filter` dan `jakarta.servlet.Filter` adalah tipe berbeda.

Artinya:

```text
Library yang compile terhadap javax.servlet tidak compatible dengan runtime jakarta.servlet.
```

Meskipun nama class konsepnya sama, package berbeda membuat binary type berbeda.

Akibat:

1. filter lama tidak bisa didaftarkan;
2. custom servlet listener lama gagal;
3. old Swagger/Springfox bisa rusak;
4. old auth/filter library bisa gagal;
5. old JPA extension bisa gagal;
6. old validation extension bisa gagal.

### 7.3 Transitive Dependency Trap

Kode Anda sudah `jakarta.*`, tetapi dependency membawa `javax.*`.

Contoh:

```text
your-app -> old-lib -> javax.validation-api
your-app -> old-swagger -> javax.servlet-api
```

Gejala:

```text
ClassCastException
NoSuchMethodError
NoClassDefFoundError
ambiguous classes
startup failure
```

Checklist:

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

Gradle:

```bash
./gradlew dependencyInsight --dependency javax
./gradlew dependencyInsight --dependency jakarta
```

### 7.4 Migration Pattern

Langkah:

1. upgrade ke latest Boot 2.7 dulu;
2. bersihkan deprecated API;
3. update dependency yang punya versi Jakarta-compatible;
4. ganti `javax.*` ke `jakarta.*` untuk EE APIs;
5. update generated code;
6. update annotation processor;
7. update tests;
8. run dependency tree;
9. run full integration test;
10. deploy ke staging dengan production-like container.

---

## 8. Spring Boot 2 → 3 Migration

### 8.1 Target Ideal Sebelum Naik

Sebelum masuk Boot 3, idealnya aplikasi berada di:

```text
Java 17-ready
Spring Boot 2.7 latest patch
No deprecated Spring Security config
No old Sleuth dependency
No Springfox
No hard javax-only third-party
Test suite stable
Actuator endpoints known
Security behavior documented
```

Kenapa Boot 2.7? Karena Boot 2.7 adalah bridge paling masuk akal dari Boot 2 ke Boot 3.

### 8.2 Common Breaking Areas

#### A. Java 17 Minimum

Build harus support Java 17.

Maven:

```xml
<properties>
    <java.version>17</java.version>
</properties>
```

Gradle:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}
```

#### B. Jakarta Namespace

Sudah dibahas sebelumnya.

#### C. Spring Security 6

Pola lama:

```java
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .antMatchers("/public/**").permitAll()
            .anyRequest().authenticated();
    }
}
```

Pola baru:

```java
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .build();
    }
}
```

Perhatikan bahwa migrasi security tidak boleh hanya compile-driven. Anda harus test:

1. endpoint anonymous,
2. endpoint authenticated,
3. role-based endpoint,
4. method security,
5. CSRF behavior,
6. CORS preflight,
7. actuator exposure,
8. error response 401/403.

#### D. Path Matching

Spring MVC modern menggunakan path matching yang berbeda dari era lama. Aplikasi yang bergantung pada trailing slash atau pattern ambigu harus diuji.

Contoh risiko:

```text
/users/123
/users/123/
/users/**
/users/{id}
```

Test semua route penting.

#### E. Observability

Spring Cloud Sleuth lama digantikan oleh Micrometer Tracing ecosystem.

Migration concern:

```text
Trace ID field name
MDC behavior
B3 vs W3C propagation
Zipkin/OTel exporter config
Custom span creation
Log correlation
```

#### F. Hibernate 6

Walau seri ini tidak mengulang Hibernate detail, dari sisi Spring migration Anda harus tahu bahwa Boot 3 membawa Hibernate 6 untuk stack JPA modern.

Risiko:

1. query behavior,
2. dialect,
3. type mapping,
4. custom user type,
5. sequence/naming,
6. pagination SQL,
7. generated SQL,
8. lazy loading edge case.

Regression test persistence penting.

#### G. Configuration Properties

Beberapa property berubah, deprecated, atau binding behavior berbeda.

Gunakan:

```text
spring-boot-properties-migrator
```

sebagai alat sementara, bukan solusi permanen.

### 8.3 Boot 2 → 3 Checklist

```text
[ ] Upgrade to latest Boot 2.7 patch
[ ] Upgrade Java build to 17
[ ] Remove deprecated Security config
[ ] Replace Springfox
[ ] Replace Sleuth with Micrometer Tracing
[ ] Replace javax EE imports with jakarta
[ ] Update JPA/Hibernate related dependencies
[ ] Update validation dependencies
[ ] Update servlet filters/listeners
[ ] Update OpenAPI tooling
[ ] Update test annotations/config
[ ] Validate actuator endpoint exposure
[ ] Validate health/readiness/liveness
[ ] Validate security matrix
[ ] Validate path matching
[ ] Validate JSON payload contract
[ ] Validate batch/scheduled/message consumers
[ ] Validate production container image
```

---

## 9. Spring Boot 3 → 4 Migration

### 9.1 Why This Migration Is Different

Boot 3 migration was dominated by:

```text
Java 17 + Jakarta namespace
```

Boot 4 migration is more about:

```text
Spring Framework 7
Jakarta EE 11
Boot modularization
new baseline ecosystem
stronger null-safety direction
new API support
dependency reshaping
AOT/native modernization
```

It may be less noisy than `javax -> jakarta`, but it can still break platform assumptions.

### 9.2 Preparation Strategy

Do not jump from early Boot 3 directly to Boot 4.

Better:

```text
Boot 3.0/3.1/3.2 -> latest Boot 3.5.x -> remove deprecated APIs -> Boot 4.x
```

Why?

Because latest Boot 3.x often contains deprecation warnings, compatibility bridges, and migration hints.

### 9.3 Areas to Inspect

#### A. Dependency Coordinates and Modularization

Boot 4 modularizes parts of Boot. If your application uses only official starters, impact may be low. If you build internal starters or depend on Boot internals, impact can be high.

Look for imports like:

```java
import org.springframework.boot.autoconfigure.*;
import org.springframework.boot.actuate.autoconfigure.*;
import org.springframework.boot.web.servlet.*;
import org.springframework.boot.context.properties.*;
```

Not all are wrong. But internal assumptions should be reviewed.

#### B. Jakarta EE 11

Spring Framework 7 moves to Jakarta EE 11 baseline.

Potential impact:

1. servlet API 6.1,
2. JPA 3.2,
3. Bean Validation 3.1,
4. library compatibility,
5. embedded container compatibility,
6. app server compatibility.

#### C. Spring Security 7

Security major upgrades often affect DSL, matcher, defaults, and method security details.

Migration check:

```text
[ ] multiple SecurityFilterChain ordering
[ ] requestMatchers behavior
[ ] method security annotations
[ ] custom AuthenticationProvider
[ ] custom AuthenticationFilter
[ ] JWT decoder config
[ ] OAuth2 client/resource server config
[ ] tests for 401/403
```

#### D. API Versioning Support

Boot 4 adds stronger support around API versioning. If your organization already has custom versioning conventions, do not blindly mix two models.

Decision:

```text
Use Boot/Spring native API versioning if it simplifies governance.
Keep existing versioning if migration risk is larger than benefit.
```

#### E. HTTP Service Clients

If you already use:

```text
OpenFeign
WebClient wrappers
RestClient wrappers
custom client factories
```

evaluate whether Spring HTTP service clients reduce boilerplate or just add another abstraction.

#### F. JSpecify / Null Safety

Null-safety improvements are valuable, but they may expose latent assumptions in Java/Kotlin interop, annotations, IDE analysis, and generated code.

#### G. Native Image Tooling

Boot 4 requires modern GraalVM native-image for native builds. If your system uses native image, treat Boot 4 as a native build migration too.

### 9.4 Boot 3 → 4 Checklist

```text
[ ] Upgrade to latest Boot 3.5.x first
[ ] Remove Boot 3 deprecations
[ ] Remove dependency on Boot internals
[ ] Verify Java 17+ baseline and CI toolchain
[ ] Evaluate Java 25 runtime separately
[ ] Update Spring Cloud release train
[ ] Update Spring Security
[ ] Validate Jakarta EE 11 compatible dependencies
[ ] Validate servlet container
[ ] Validate actuator endpoints
[ ] Validate API versioning behavior
[ ] Validate HTTP clients
[ ] Validate native image if used
[ ] Validate OpenAPI generation
[ ] Validate test slices and context loading
[ ] Validate custom auto-configurations
```

---

## 10. Spring Framework 5 → 6 → 7 Migration

### 10.1 Spring Framework 5 to 6

Key themes:

```text
Java 17 baseline
Jakarta EE 9+ namespace
AOT support
observability integration
modernized infrastructure
```

Impact areas:

1. core container mostly conceptually stable;
2. web stack changes due to Jakarta Servlet;
3. validation/persistence/transaction annotations move;
4. deprecated APIs removed;
5. third-party library compatibility becomes major risk.

### 10.2 Spring Framework 6 to 7

Key themes:

```text
Jakarta EE 11 baseline
modern JDK readiness
stronger API cleanup
null-safety direction
updated web/runtime integration
```

The exact impact depends heavily on whether your code uses:

1. Spring public APIs only,
2. deprecated APIs,
3. internal framework classes,
4. custom extension points,
5. custom starters,
6. custom AOT hints,
7. native image.

### 10.3 Extension Point Migration

Review custom classes implementing:

```text
BeanPostProcessor
BeanFactoryPostProcessor
BeanDefinitionRegistryPostProcessor
ImportBeanDefinitionRegistrar
DeferredImportSelector
FactoryBean
SmartLifecycle
HandlerMethodArgumentResolver
HandlerInterceptor
OncePerRequestFilter
Converter
GenericConverter
Formatter
Validator
HandlerExceptionResolver
ResponseBodyAdvice
RequestBodyAdvice
HealthIndicator
RuntimeHintsRegistrar
```

These are power tools. They are also upgrade-sensitive.

For each extension point, ask:

```text
Is it using public API?
Is it relying on ordering side effects?
Is it using reflection against Spring internals?
Is it safe under AOT/native?
Is it covered by integration tests?
```

---

## 11. Build Migration

### 11.1 Maven

Review:

```text
maven-compiler-plugin
maven-surefire-plugin
maven-failsafe-plugin
spring-boot-maven-plugin
jacoco-maven-plugin
maven-enforcer-plugin
annotation processors
```

Recommended controls:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-enforcer-plugin</artifactId>
    <executions>
        <execution>
            <goals>
                <goal>enforce</goal>
            </goals>
            <configuration>
                <rules>
                    <requireJavaVersion>
                        <version>[17,)</version>
                    </requireJavaVersion>
                    <dependencyConvergence/>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

### 11.2 Gradle

Review:

```text
Gradle version
Spring Boot Gradle plugin
Java toolchain
dependency locking
test task
Jacoco
annotation processors
```

Example:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

tasks.withType(Test).configureEach {
    useJUnitPlatform()
}
```

### 11.3 Dependency Management

Use official BOM/starter dependency management whenever possible.

Anti-pattern:

```text
Spring Boot manages Hibernate 6.5
Application forces Hibernate 5.x
```

That may compile but fail behaviorally.

Rules:

1. avoid overriding managed versions unless you know why;
2. document every override;
3. remove stale overrides after migration;
4. use dependency lockfile for repeatability;
5. use CI dependency tree diff.

---

## 12. Security Migration

Security migration deserves separate attention because compile success does not prove authorization correctness.

### 12.1 From Adapter to Beans

Old style:

```java
class SecurityConfig extends WebSecurityConfigurerAdapter {
}
```

Modern style:

```java
@Bean
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .anyRequest().authenticated()
        )
        .build();
}
```

### 12.2 Matcher Semantics

Review:

```text
antMatchers
mvcMatchers
requestMatchers
securityMatcher
PathPatternParser
servletPath
contextPath
trailing slash behavior
```

### 12.3 Method Security

Old:

```java
@EnableGlobalMethodSecurity(prePostEnabled = true)
```

Modern:

```java
@EnableMethodSecurity
```

Then test:

```text
@PreAuthorize
@PostAuthorize
@PreFilter
@PostFilter
custom permission evaluator
role prefix
proxy/self invocation
```

### 12.4 Security Test Matrix

At minimum:

| Scenario | Expected |
|---|---|
| anonymous public endpoint | 200 |
| anonymous protected endpoint | 401 |
| authenticated insufficient role | 403 |
| authenticated correct role | 200 |
| invalid token | 401 |
| expired token | 401 |
| disabled user | 403/401 according policy |
| CORS preflight | expected allowed/denied |
| CSRF missing on browser write | 403 if enabled |
| actuator health | expected exposure |
| actuator sensitive endpoint | restricted |

---

## 13. Web MVC Migration

### 13.1 Path Matching

Review routes:

```java
@GetMapping("/cases/{id}")
@GetMapping("/cases/**")
@GetMapping("/files/{filename:.+}")
```

Test:

```text
/cases/123
/cases/123/
/cases/a/b
/files/a.b.pdf
/files/a/b.pdf
```

### 13.2 Error Handling

If you use custom `@ControllerAdvice`, verify:

1. validation error payload;
2. JSON parse error;
3. missing parameter;
4. unsupported media type;
5. not found;
6. method not allowed;
7. security exception integration.

Modern Spring supports Problem Details, but adopting it is an API contract decision. Do not change error payload unintentionally.

### 13.3 Message Converters

Verify:

1. Jackson config,
2. Java time serialization,
3. enum serialization,
4. null handling,
5. unknown properties,
6. large payload streaming,
7. multipart.

---

## 14. Persistence Migration

Even if Spring migration is the focus, persistence changes often dominate risk.

### 14.1 What to Validate

1. generated SQL,
2. transaction boundaries,
3. lazy loading,
4. pagination,
5. sorting,
6. projections,
7. native queries,
8. stored procedures,
9. custom Hibernate types,
10. ID generation,
11. optimistic locking,
12. entity graphs,
13. batch inserts,
14. schema validation,
15. Flyway/Liquibase compatibility.

### 14.2 Repository Layer Tests

Test real DB behavior. Mocking repository is not enough.

Use:

```text
Testcontainers
production-like DB version
migration scripts
golden dataset
query behavior assertions
```

### 14.3 Transaction Boundary

Verify:

```text
rollback on runtime exception
rollback rules for checked exception
REQUIRES_NEW behavior
NESTED behavior if used
readOnly behavior
transactional events
outbox writes
```

---

## 15. Observability Migration

### 15.1 Sleuth to Micrometer Tracing

Common migration concern:

```text
Trace ID and span ID still present in logs?
Header propagation same?
Downstream trace continuity preserved?
Custom spans migrated?
Sampling behavior same?
Metrics cardinality controlled?
```

### 15.2 Actuator Endpoint Changes

Inventory:

```text
/actuator/health
/actuator/health/liveness
/actuator/health/readiness
/actuator/metrics
/actuator/prometheus
/actuator/info
```

Validate:

1. exposure config,
2. security config,
3. probe configuration,
4. custom health indicator,
5. metric names/tags,
6. dashboard queries,
7. alerts.

### 15.3 Log Contract

If operations depend on logs, validate:

```text
timestamp format
level
traceId/spanId
correlationId
requestId
tenantId
userId masking
exception format
```

---

## 16. Test Migration

### 16.1 Test Context Risk

Migration may cause test context to behave differently due to:

1. changed auto-configuration,
2. changed property names,
3. changed mock bean support,
4. changed security defaults,
5. changed web stack,
6. changed test slice boundary.

### 16.2 Keep Test Types Separate

Use:

```text
Unit test             -> no Spring context
Slice test            -> focused Spring context
Integration test      -> real DB/messaging/web
Contract test         -> API compatibility
Smoke test            -> packaged app startup
Migration test        -> old vs new behavior comparison
```

### 16.3 Golden Master for API

For migration, golden master tests are valuable.

Example:

```text
Given same request
Old version returns response A
New version must return compatible response A'
```

Not necessarily byte-identical, but contract-compatible.

### 16.4 Startup Test

Create a test that boots the packaged app profile:

```bash
java -jar app.jar --spring.profiles.active=test-smoke
```

Then validate:

```text
context starts
web port binds
health UP
DB connects
migrations complete
critical endpoints reachable
```

---

## 17. Custom Starter and Auto-Configuration Migration

If your organization has internal starters, migration risk increases.

### 17.1 Boot 2 Auto-Configuration Registration

Boot 2 commonly used:

```text
META-INF/spring.factories
```

Example:

```properties
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.platform.audit.AuditAutoConfiguration
```

### 17.2 Boot 3/4 Style

Modern Boot uses:

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Example:

```text
com.example.platform.audit.AuditAutoConfiguration
com.example.platform.security.SecurityPolicyAutoConfiguration
```

### 17.3 Internal Starter Checklist

```text
[ ] No dependency on removed Boot internals
[ ] AutoConfiguration.imports present
[ ] Conditions are precise
[ ] Back-off with @ConditionalOnMissingBean
[ ] ConfigurationProperties metadata generated
[ ] RuntimeHints provided if native support needed
[ ] ApplicationContextRunner tests exist
[ ] Boot 3 and Boot 4 compatibility strategy documented
[ ] Versioned BOM exists
[ ] Escape hatch properties exist
```

### 17.4 Test with ApplicationContextRunner

Example:

```java
class AuditAutoConfigurationTest {

    private final ApplicationContextRunner runner =
        new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AuditAutoConfiguration.class));

    @Test
    void backsOffWhenUserProvidesBean() {
        runner
            .withBean(AuditPublisher.class, () -> new CustomAuditPublisher())
            .run(context -> {
                assertThat(context).hasSingleBean(AuditPublisher.class);
                assertThat(context.getBean(AuditPublisher.class))
                    .isInstanceOf(CustomAuditPublisher.class);
            });
    }
}
```

---

## 18. OpenRewrite and Automated Refactoring

For large codebases, manual migration is expensive.

OpenRewrite can help with:

1. Java version migration,
2. Spring Boot migration recipes,
3. `javax` to `jakarta`,
4. dependency upgrade,
5. deprecated API refactoring,
6. framework-specific changes.

But automated migration is not enough.

Correct model:

```text
OpenRewrite handles mechanical changes.
Engineers handle semantic validation.
Tests prove behavior.
Production telemetry confirms runtime.
```

Suggested workflow:

```text
1. Run recipe on small branch
2. Inspect diff
3. Commit mechanical changes separately
4. Run compile/test
5. Fix semantic failures manually
6. Repeat module by module
```

Anti-pattern:

```text
Run huge automated rewrite and mix it with business refactor.
```

---

## 19. Incremental Migration Strategy

### 19.1 Branch Strategy

Options:

#### Option A — Big Bang Branch

```text
main -> migration-boot3 -> merge after complete
```

Pros:

1. isolated work;
2. simple to reason.

Cons:

1. long-lived branch drift;
2. difficult conflict management;
3. delayed feedback.

#### Option B — Incremental Compatibility PRs

```text
main receives preparatory PRs:
- remove deprecated APIs
- update security style
- replace Springfox
- add tests
- clean javax usage where possible
- update build plugins
```

Pros:

1. less branch drift;
2. easier review;
3. production hardening before major upgrade.

Cons:

1. requires discipline;
2. more coordination.

Best practice for enterprise:

```text
Do many compatibility PRs first.
Then one focused framework version PR.
Then stabilization PRs.
```

### 19.2 Dual Runtime Strategy

Sometimes impossible to stay compatible with both Boot 2 and Boot 3 due to `javax`/`jakarta`.

But you can still prepare by:

1. reducing deprecated API usage,
2. isolating framework-specific code,
3. abstracting security config,
4. replacing unsupported dependencies,
5. creating adapter modules,
6. increasing test coverage.

### 19.3 Module-by-Module Strategy

For multi-module monolith:

```text
core-domain              -> should have minimal Spring dependency
application-service      -> moderate Spring dependency
web-api                  -> high migration impact
persistence              -> high migration impact
security                 -> high migration impact
batch/messaging          -> medium/high impact
platform-starters        -> high impact
```

Prioritize:

```text
1. build parent/BOM
2. low-level libraries
3. platform starters
4. persistence module
5. security module
6. web module
7. batch/messaging
8. integration tests
```

---

## 20. Compatibility Matrix

Create a matrix like this before changing versions.

| Component | Current | Target Boot 3 | Target Boot 4 | Risk |
|---|---:|---:|---:|---|
| Java | 8/11 | 17+ | 17+/25 | high |
| Servlet | 4.0 | 6.0 | 6.1 | high |
| Spring Security | 5.x | 6.x | 7.x | high |
| Hibernate | 5.x | 6.x | 6/7 depending BOM | high |
| Validation | javax 2.0 | jakarta 3.x | jakarta 3.1+ | medium |
| OpenAPI | Springfox | springdoc modern | Boot 4 compatible | high |
| Tracing | Sleuth | Micrometer Tracing | Micrometer modern | medium |
| Cloud | Hoxton/202x | compatible train | 2025.1+ | high |
| Build | old Maven/Gradle | modern | modern | medium |
| Container | Tomcat 9 | Tomcat 10.1 | Tomcat 11/compatible | high |

The exact versions must follow official release train and BOM.

Do not manually compose random Spring versions.

---

## 21. Release and Rollout Strategy

### 21.1 Deployment Stages

Recommended:

```text
Local compile
Unit tests
Slice tests
Integration tests
Contract tests
Packaged startup test
Docker image test
Staging deployment
Shadow traffic or replay
Canary
Progressive rollout
Full rollout
Post-deploy watch
```

### 21.2 Canary Metrics

Watch:

```text
startup time
memory usage
CPU usage
GC behavior
HTTP 4xx/5xx rate
latency p95/p99
DB connection pool usage
thread count
executor queue
message retry/DLQ
batch failure rate
security denial rate
login failure rate
actuator health
```

### 21.3 Rollback Plan

A migration without rollback plan is not production-ready.

Define:

```text
Can old version still run against migrated DB?
Are DB migrations backward compatible?
Are message formats backward compatible?
Are cache keys compatible?
Are session/token formats compatible?
Can both versions run during canary?
Can we roll back container image only?
Do we need data rollback?
```

If rollback requires database rollback, risk is high.

Prefer:

```text
expand-contract DB migration
backward-compatible payload
versioned message schema
versioned cache key
feature flag for new behavior
```

---

## 22. Database Migration Interaction

Framework migration and DB migration should be separated unless unavoidable.

Dangerous combination:

```text
Boot 2 -> Boot 3
Hibernate 5 -> 6
Major schema changes
Business logic changes
New indexes
New batch behavior
```

Better:

```text
PR 1: schema backward-compatible
PR 2: code still old framework but supports new schema
PR 3: framework migration
PR 4: cleanup old schema
```

### 22.1 Expand-Contract Pattern

Example:

```text
1. Add nullable column
2. Write both old and new column
3. Backfill
4. Read new column
5. Stop writing old column
6. Drop old column later
```

This matters because rollback needs old code to survive.

---

## 23. Messaging Migration Interaction

If message consumers/producers are Spring-based, validate:

1. serialization format,
2. header names,
3. type headers,
4. retry behavior,
5. DLQ behavior,
6. ack mode,
7. transaction boundaries,
8. concurrency settings,
9. listener startup order,
10. graceful shutdown.

Version message schema:

```json
{
  "eventType": "CaseSubmitted",
  "schemaVersion": 2,
  "eventId": "evt-123",
  "occurredAt": "2026-06-21T10:15:30Z",
  "payload": {}
}
```

Do not rely on Java class name serialization across major framework migrations.

---

## 24. API Compatibility Strategy

### 24.1 Contract Categories

Define:

```text
Stable public API
Internal frontend API
Partner API
Admin API
Actuator API
Async callback API
Webhook API
```

Each has different compatibility requirement.

### 24.2 Compatibility Test

For critical API:

```text
request method
path
query params
headers
auth behavior
status code
response content type
response body
error body
pagination fields
sorting behavior
validation error format
```

### 24.3 Error Contract

Major migration often changes default errors.

If public API has existing error envelope, lock it with tests.

Example:

```json
{
  "code": "CASE_NOT_FOUND",
  "message": "Case not found.",
  "correlationId": "abc",
  "details": []
}
```

If you adopt Problem Details, do it intentionally as API version change.

---

## 25. CI Pipeline for Migration

A strong migration CI pipeline includes:

```text
compile
unit tests
static analysis
dependency vulnerability scan
dependency convergence check
forbidden javax check
testcontainers integration tests
contract tests
packaged app smoke test
docker image scan
startup probe test
native image test if applicable
performance smoke test
```

### 25.1 Forbidden Dependency Rule

Add a CI gate:

```text
No javax.servlet-api
No javax.persistence-api
No javax.validation-api
No Springfox
No old Sleuth
No WebSecurityConfigurerAdapter
No spring.factories auto-config if target Boot 3/4 internal starter
```

But remember:

```text
javax.sql is allowed.
javax.crypto is allowed.
```

So rules must be precise.

### 25.2 Dependency Tree Diff

Store dependency tree artifacts before/after migration.

Compare:

```text
new transitive dependencies
removed dependencies
version jumps
duplicate APIs
old javax artifacts
logging binding changes
native libraries
```

---

## 26. Runtime Diagnostics During Migration

Use diagnostics intentionally.

### 26.1 Condition Evaluation Report

Boot can show auto-configuration decisions.

Useful for:

```text
Why did datasource auto-config activate?
Why did security config change?
Why is my custom bean ignored?
Why is cache manager different?
```

### 26.2 Actuator

Expose safely in non-prod:

```text
/actuator/health
/actuator/conditions
/actuator/configprops
/actuator/beans
/actuator/env
/actuator/metrics
/actuator/startup
```

Do not expose sensitive actuator endpoints publicly in production.

### 26.3 Startup Logs

Enable temporarily:

```properties
debug=true
```

or targeted logging:

```properties
logging.level.org.springframework.boot.autoconfigure=DEBUG
logging.level.org.springframework.security=DEBUG
```

Use security DEBUG carefully; avoid leaking secrets.

---

## 27. Migration Playbook

### Phase 1 — Discovery

Deliverables:

```text
dependency inventory
runtime version matrix
deprecated API inventory
javax/jakarta inventory
security behavior inventory
API contract inventory
test coverage map
unsupported library list
risk register
```

### Phase 2 — Preparation

Actions:

```text
upgrade to latest patch of current major
upgrade build plugins
remove deprecated APIs
replace unsupported libraries
add missing tests
add contract tests
add startup smoke tests
document security matrix
```

### Phase 3 — Mechanical Migration

Actions:

```text
Java baseline update
Spring Boot version update
Spring dependency update
javax -> jakarta
Security DSL update
Observability update
Auto-config registration update
Build config update
```

### Phase 4 — Semantic Fixes

Actions:

```text
fix behavior changes
fix security matrix
fix persistence behavior
fix MVC path matching
fix error contract
fix actuator/probe behavior
fix tests
```

### Phase 5 — Operational Validation

Actions:

```text
staging deploy
production-like data
load smoke
metrics validation
tracing validation
batch/job validation
messaging validation
rollback simulation
```

### Phase 6 — Rollout

Actions:

```text
canary
monitor
progressive rollout
rollback readiness
post-deploy review
cleanup temporary migrator/deprecated flags
```

---

## 28. Migration Risk Register Template

Use a table like this.

| Risk | Area | Probability | Impact | Detection | Mitigation | Owner |
|---|---|---:|---:|---|---|---|
| Authorization route mismatch | Security | high | critical | security tests | route matrix | security owner |
| javax transitive dependency | Dependency | medium | high | dependency scan | upgrade/replace lib | platform |
| Hibernate query behavior change | Persistence | medium | high | integration tests | query diff | backend |
| Error payload changed | API | high | medium | contract tests | custom advice | API owner |
| Actuator exposure changed | Ops | medium | high | staging scan | explicit config | DevOps |
| Trace propagation changed | Observability | medium | medium | trace test | Micrometer config | platform |
| Rollback blocked by DB migration | Release | low | critical | rollback drill | expand-contract | lead |

---

## 29. Common Anti-Patterns

### 29.1 “Compile Green Means Done”

Wrong.

Compile green only means:

```text
source code is syntactically compatible enough
```

It does not prove behavior.

### 29.2 “Replace All javax with jakarta”

Wrong.

Some `javax.*` packages are JDK packages and should remain.

### 29.3 “Upgrade Everything in One PR”

Wrong for large systems.

It hides root cause and makes rollback harder.

### 29.4 “Rely on Manual QA Only”

Wrong.

Migration regression space is too large. You need automated contract/security/integration tests.

### 29.5 “Ignore Internal Starters”

Wrong.

Internal starters are often the highest risk because they rely on framework internals.

### 29.6 “Use Property Migrator Forever”

Wrong.

Migrators are temporary tools. They should not remain as permanent runtime crutch.

### 29.7 “Change API Error Format Accidentally”

Wrong.

For clients, error contract is part of API.

### 29.8 “Adopt New Feature During Migration”

Risky.

Do not mix:

```text
Boot 3 migration + new architecture + new feature + DB redesign
```

unless there is no alternative.

---

## 30. Example Migration Plan: Boot 2.6 Java 11 to Boot 3.5 Java 17

### Step 1 — Upgrade Within Old Major

```text
Boot 2.6 -> Boot 2.7 latest
Java 11 remains initially
Fix deprecations
```

### Step 2 — Java 17

```text
Set toolchain Java 17
Update build plugins
Update Docker base image
Run all tests
Deploy to staging
```

### Step 3 — Security Preparation

```text
Remove WebSecurityConfigurerAdapter
Adopt SecurityFilterChain bean style
Replace antMatchers gradually
Add security matrix tests
```

### Step 4 — Dependency Cleanup

```text
Replace Springfox
Update OpenAPI
Remove old Sleuth
Update Lombok/MapStruct/Jacoco
Find javax transitive dependencies
```

### Step 5 — Boot 3 Upgrade

```text
Change parent/plugin/BOM
Apply javax->jakarta carefully
Update Hibernate/JPA integration
Update validation
Update test config
```

### Step 6 — Semantic Validation

```text
API contract tests
DB integration tests
Security tests
Actuator tests
Messaging tests
Batch tests
Performance smoke
```

### Step 7 — Rollout

```text
staging
canary
monitor
progressive rollout
cleanup
```

---

## 31. Example Migration Plan: Boot 3.3 to Boot 4

### Step 1 — Latest Boot 3.x

```text
Upgrade to latest Boot 3.5.x
Remove deprecations
Update Spring Cloud compatible train
```

### Step 2 — Internal Starter Review

```text
Check AutoConfiguration.imports
Check Boot internal imports
Check RuntimeHints
Check ApplicationContextRunner tests
```

### Step 3 — Boot 4 Upgrade

```text
Update Boot plugin/BOM
Update Spring Cloud train
Update Jakarta EE 11-compatible libs
Update native image toolchain if used
```

### Step 4 — Validate New Runtime

```text
Security
MVC/API
Actuator
Observability
HTTP clients
API versioning
Tests
Native image if relevant
```

### Step 5 — Optional Modernization

Only after stable:

```text
Java 25 runtime
Virtual threads
HTTP service clients
native image
API versioning features
JSpecify/null-safety adoption
```

---

## 32. Decision Framework: When Not to Upgrade Yet

Upgrade is usually necessary for security/support, but timing matters.

Delay temporarily if:

1. critical third-party dependency has no compatible version;
2. no test coverage for security/API;
3. team cannot support rollout/rollback;
4. current release window is high-risk;
5. database migration is already ongoing;
6. production incident load is high;
7. cloud/platform baseline not ready.

But delay must produce a plan, not avoidance.

Good delay:

```text
We delay Boot 4 by 2 months to replace incompatible auth library, add security contract tests, and upgrade Spring Cloud.
```

Bad delay:

```text
We delay because migration is scary.
```

---

## 33. Engineering Review Checklist

Before approving migration PR:

```text
[ ] Version matrix documented
[ ] Official compatibility checked
[ ] Java baseline correct
[ ] Dependency tree reviewed
[ ] javax/jakarta boundary reviewed
[ ] Unsupported libraries replaced
[ ] Deprecated APIs removed
[ ] Security matrix tested
[ ] API contract tested
[ ] Error contract tested
[ ] Persistence integration tested
[ ] Batch/message/scheduled jobs tested
[ ] Actuator/probe behavior tested
[ ] Observability/tracing/log correlation tested
[ ] Internal starters tested
[ ] Rollback plan documented
[ ] DB/message/cache compatibility reviewed
[ ] Performance smoke completed
[ ] Temporary migration dependencies removed or ticketed
```

---

## 34. Mental Model Summary

Spring migration is a graph problem.

You are not migrating one version number. You are migrating a graph:

```text
Java runtime
  -> Spring Framework
      -> Boot
          -> Auto-config
          -> Web server
          -> Security
          -> Data
          -> Validation
          -> Observability
          -> Test
          -> Native/AOT
  -> Third-party dependencies
  -> Internal platform libraries
  -> Deployment runtime
  -> Operational contracts
  -> Client contracts
```

The safe migration rule:

```text
Separate mechanical compatibility from semantic correctness.
```

Mechanical compatibility:

```text
compile
dependency resolution
imports
build plugin
startup
```

Semantic correctness:

```text
same authorization
same transaction behavior
same API contract
same data behavior
same operational behavior
same rollback ability
```

Top-tier migration engineering means you can answer:

```text
What changed?
Why is it safe?
How do we know?
How do we roll back?
What do we monitor?
What remains risky?
```

---

## 35. Sources and Further Reading

Official references to check during real migration:

1. Spring Boot 3.0 Migration Guide.
2. Spring Boot 4.0 Migration Guide.
3. Spring Framework Versions wiki.
4. Spring Security migration guides.
5. Spring Boot Actuator and Observability reference.
6. Spring Framework Web MVC reference.
7. Spring Data release notes.
8. Hibernate migration guide.
9. Spring Cloud compatibility/release train docs.
10. OpenRewrite Spring recipes.

---

## 36. Status Seri

```text
Part saat ini : 33 dari 35
Status        : belum selesai
Berikutnya    : 34-building-internal-spring-platform-starters-guardrails.md
Sisa          : Part 34 dan Part 35
```

Part ini adalah bagian migrasi. Setelah ini, seri masuk ke:

```text
Part 34 — Building Internal Spring Platform: Starters, Conventions, Guardrails
Part 35 — Capstone: Designing a Production-Grade Spring System End-to-End
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./32-spring-security-advanced-authorization-policy.md">⬅️ Spring Security Advanced: Authorization Architecture and Policy Enforcement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./34-building-internal-spring-platform-starters-guardrails.md">Part 34 — Building Internal Spring Platform: Starters, Conventions, Guardrails ➡️</a>
</div>
