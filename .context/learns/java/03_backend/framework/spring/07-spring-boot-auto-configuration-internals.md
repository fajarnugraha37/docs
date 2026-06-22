# Part 7 — Spring Boot Auto-Configuration Internals

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `07-spring-boot-auto-configuration-internals.md`  
> Status seri: Part 7 dari 35 — belum selesai  
> Target pembaca: engineer Java/Spring yang ingin memahami Spring Boot bukan sebagai “magic”, tetapi sebagai runtime composition engine yang bisa dikendalikan, diuji, dan dijadikan fondasi platform internal.

---

## 0. Tujuan Part Ini

Setelah Part 1 sampai Part 6, kita sudah memiliki fondasi:

1. container Spring menyimpan *metadata* sebagai `BeanDefinition`, bukan langsung object;
2. dependency resolution memilih bean berdasarkan type, qualifier, primary/fallback, generic, optionality, dan ordering;
3. lifecycle bean memiliki banyak hook: registry post processor, factory post processor, bean post processor, init/destroy callback, lifecycle callback;
4. annotation bukan magic, tetapi metadata yang dibaca, digabung, dan diterjemahkan menjadi registrasi bean;
5. `@Configuration` dan `@Bean` punya mode full/lite, CGLIB enhancement, dan konsekuensi terhadap singleton semantics;
6. environment, property source, profile, dan config binding adalah runtime input yang menentukan bentuk aplikasi.

Part ini membahas layer berikutnya: **Spring Boot auto-configuration**.

Tujuan utamanya bukan sekadar tahu bahwa Spring Boot “mengatur otomatis”. Tujuan sebenarnya adalah mampu menjawab pertanyaan engineering berikut:

- Mengapa bean tertentu muncul walaupun tidak pernah kita buat?
- Mengapa bean tertentu tidak muncul padahal dependency sudah ada?
- Mengapa menambahkan satu dependency bisa mengubah behavior aplikasi?
- Mengapa user-defined bean bisa membuat auto-configuration “mundur”?
- Bagaimana Spring Boot tahu kapan harus mengaktifkan web, JDBC, JPA, Jackson, Kafka, Redis, Actuator, Security, dan sebagainya?
- Bagaimana membuat internal Spring Boot starter yang aman, override-friendly, dan tidak diam-diam merusak aplikasi consumer?
- Bagaimana membaca `ConditionEvaluationReport` untuk debugging production startup?
- Bagaimana menguji auto-configuration tanpa booting seluruh aplikasi?

Part ini adalah salah satu bagian paling penting dalam seri Spring advanced. Banyak engineer bisa memakai Spring Boot bertahun-tahun, tetapi tetap bingung saat aplikasi gagal start karena conditional bean, classpath, property, ordering, atau hidden auto-config activation.

---

## 1. Mental Model: Auto-Configuration Bukan Magic, Tetapi Conditional Bean Registration

Kalimat pendeknya:

> Spring Boot auto-configuration adalah mekanisme untuk mendaftarkan `BeanDefinition` secara conditional berdasarkan classpath, environment, property, web application type, resource, dan keberadaan bean lain.

Spring Boot sendiri menjelaskan bahwa auto-configuration mencoba mengonfigurasi aplikasi berdasarkan dependency JAR yang ada di classpath. Misalnya, jika HSQLDB ada di classpath dan user belum mendefinisikan `DataSource`, Boot dapat mengonfigurasi embedded database. Auto-configuration diaktifkan melalui `@EnableAutoConfiguration` atau, lebih umum, melalui `@SpringBootApplication`.

Mental model yang benar:

```text
classpath + properties + existing beans + web type + resources
        ↓
condition evaluation
        ↓
auto-configuration classes selected
        ↓
@Bean methods considered
        ↓
bean definitions registered
        ↓
normal Spring container lifecycle continues
```

Auto-configuration **tidak melewati aturan Spring Core**. Ia hanya menambahkan sumber bean definition lain ke container. Setelah bean definition terdaftar, bean tetap dibuat, di-inject, di-proxy, dan dihancurkan oleh container Spring biasa.

Jadi, jika Anda memahami Part 1–6, auto-configuration dapat dipahami sebagai:

```text
large-scale conditional configuration import mechanism
```

Bukan:

```text
framework ajaib yang tiba-tiba membuat object
```

---

## 2. Kenapa Auto-Configuration Ada?

Tanpa Boot, konfigurasi Spring enterprise sering berbentuk seperti ini:

```java
@Configuration
@EnableWebMvc
@ComponentScan(basePackages = "com.example")
public class WebConfig {

    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .findAndRegisterModules();
    }

    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/app");
        config.setUsername("app");
        config.setPassword("secret");
        return new HikariDataSource(config);
    }

    @Bean
    public PlatformTransactionManager transactionManager(DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }

    @Bean
    public LocalValidatorFactoryBean validator() {
        return new LocalValidatorFactoryBean();
    }
}
```

Masalahnya bukan hanya banyak kode. Masalah yang lebih besar:

1. banyak konfigurasi bersifat standar dan berulang;
2. setiap team bisa membuat konfigurasi sedikit berbeda;
3. dependency yang sama tidak selalu dikonfigurasi secara konsisten;
4. migrasi versi menjadi sulit karena konfigurasi tersebar;
5. library tidak bisa menawarkan “golden path” integrasi;
6. platform team sulit memberikan guardrail.

Spring Boot menyelesaikan ini dengan pola:

> Jika user menambahkan dependency tertentu dan belum memberikan konfigurasi sendiri, Boot memberikan default yang masuk akal. Jika user memberikan konfigurasi sendiri, Boot mundur.

Inilah yang disebut **non-invasive configuration**.

---

## 3. Prinsip Utama: Boot Should Back Off

Salah satu prinsip terpenting:

> Auto-configuration harus membantu ketika aplikasi belum punya keputusan eksplisit, tetapi harus mundur ketika aplikasi sudah punya keputusan eksplisit.

Contoh:

```java
@Bean
DataSource myDataSource() {
    return customDataSource();
}
```

Jika user sudah mendefinisikan `DataSource`, auto-configuration Boot untuk embedded database atau default `DataSource` seharusnya tidak lagi membuat `DataSource` lain.

Itulah fungsi umum `@ConditionalOnMissingBean`.

Pola ini disebut **back-off pattern**:

```text
if user has not provided a bean → provide sensible default
if user has provided a bean     → do not interfere
```

Back-off pattern adalah perbedaan besar antara auto-configuration yang baik dan auto-configuration yang berbahaya.

Auto-configuration buruk biasanya melakukan ini:

```java
@Bean
MyClient myClient() {
    return new MyClient();
}
```

Auto-configuration baik biasanya melakukan ini:

```java
@Bean
@ConditionalOnMissingBean
MyClient myClient(MyClientProperties properties) {
    return new MyClient(properties.endpoint(), properties.timeout());
}
```

---

## 4. `@SpringBootApplication`: Tiga Konsep dalam Satu Annotation

Aplikasi Boot biasanya dimulai dengan:

```java
@SpringBootApplication
public class BillingApplication {
    public static void main(String[] args) {
        SpringApplication.run(BillingApplication.class, args);
    }
}
```

Secara konseptual, `@SpringBootApplication` menggabungkan tiga hal besar:

```text
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
```

Maknanya:

1. **`@SpringBootConfiguration`**  
   Menandai class utama sebagai configuration class.

2. **`@EnableAutoConfiguration`**  
   Mengaktifkan proses import auto-configuration.

3. **`@ComponentScan`**  
   Melakukan scanning dari package class utama ke bawah.

Karena itu, lokasi class utama penting.

Misalnya:

```text
com.example.billing.BillingApplication
com.example.billing.invoice.InvoiceService
com.example.billing.payment.PaymentService
```

Aman.

Tetapi jika class utama ada di:

```text
com.example.billing.app.BillingApplication
com.example.billing.invoice.InvoiceService
```

Maka `InvoiceService` bisa tidak ter-scan jika package scanning tidak disesuaikan.

Namun auto-configuration bukan component scanning. Ini harus dibedakan:

| Mekanisme | Sumber class | Fungsi |
|---|---|---|
| Component scanning | package aplikasi | menemukan `@Component`, `@Service`, `@Controller` user |
| Auto-configuration import | `AutoConfiguration.imports` di JAR | mengimpor configuration class library/Boot |
| Explicit import | `@Import` | memasukkan konfigurasi tertentu secara eksplisit |

Kesalahan umum:

> Mengira auto-configuration bekerja karena component scanning.

Tidak. Auto-configuration ditemukan melalui mekanisme import candidate khusus, bukan karena package-nya di-scan.

---

## 5. Dari `spring.factories` ke `AutoConfiguration.imports`

Di era Spring Boot 1.x dan 2.x, auto-configuration didaftarkan melalui file:

```text
META-INF/spring.factories
```

Dengan format kurang lebih:

```properties
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.autoconfig.AcmeAutoConfiguration
```

Di Spring Boot 3.x dan 4.x, mekanisme modern untuk auto-configuration adalah:

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Isinya satu class per baris:

```text
com.example.acme.autoconfigure.AcmeAutoConfiguration
com.example.acme.autoconfigure.AcmeWebAutoConfiguration
```

Keuntungannya:

1. lebih eksplisit;
2. lebih terstruktur;
3. lebih efisien untuk discovery;
4. lebih cocok untuk AOT dan metadata processing;
5. mengurangi penyalahgunaan `spring.factories` sebagai dumping ground.

Catatan penting:

> Auto-configuration class harus ditemukan melalui `AutoConfiguration.imports`, bukan melalui component scanning.

Ini bukan sekadar style. Ini menjaga agar auto-configuration:

- tidak aktif secara tidak sengaja;
- tidak tergantung package aplikasi;
- punya lifecycle discovery yang predictable;
- bisa diproses oleh Boot sebagai auto-configuration, termasuk ordering dan condition evaluation.

---

## 6. Anatomy Auto-Configuration Class

Contoh sederhana:

```java
package com.example.acme.autoconfigure;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
@ConditionalOnClass(AcmeClient.class)
@EnableConfigurationProperties(AcmeProperties.class)
public class AcmeAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AcmeClient acmeClient(AcmeProperties properties) {
        return new AcmeClient(
                properties.endpoint(),
                properties.connectTimeout(),
                properties.readTimeout()
        );
    }
}
```

File import:

```text
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.acme.autoconfigure.AcmeAutoConfiguration
```

Properties:

```java
@ConfigurationProperties(prefix = "acme")
public record AcmeProperties(
        URI endpoint,
        Duration connectTimeout,
        Duration readTimeout
) {
    public AcmeProperties {
        if (connectTimeout == null) {
            connectTimeout = Duration.ofSeconds(3);
        }
        if (readTimeout == null) {
            readTimeout = Duration.ofSeconds(10);
        }
    }
}
```

Consumer app:

```yaml
acme:
  endpoint: https://api.acme.internal
  connect-timeout: 2s
  read-timeout: 5s
```

Efeknya:

```text
Jika AcmeClient class ada di classpath
DAN user belum mendefinisikan AcmeClient sendiri
MAKA AcmeAutoConfiguration membuat AcmeClient default
```

Itulah auto-configuration.

---

## 7. `@AutoConfiguration` vs `@Configuration`

`@AutoConfiguration` adalah annotation khusus Boot untuk class auto-configuration. Secara konseptual ia adalah configuration class, tetapi dengan semantic tambahan untuk auto-configuration ordering dan discovery.

Gunakan:

```java
@AutoConfiguration
public class AcmeAutoConfiguration {
}
```

Bukan:

```java
@Configuration
public class AcmeAutoConfiguration {
}
```

Meskipun secara teknis `@AutoConfiguration` adalah bentuk configuration, pemakaian `@AutoConfiguration` membuat maksudnya jelas:

```text
class ini bukan configuration aplikasi biasa;
class ini adalah candidate auto-configuration yang dipilih oleh Boot.
```

Biasanya auto-configuration juga sebaiknya tidak membutuhkan CGLIB proxy antar `@Bean` method, sehingga model yang diinginkan adalah configuration ringan.

Prinsipnya:

```text
auto-configuration should declare beans, not orchestrate complex object graphs through method self-calls
```

Jika ada dependency antar bean, lebih baik gunakan parameter injection:

```java
@Bean
AcmeTemplate acmeTemplate(AcmeClient client) {
    return new AcmeTemplate(client);
}
```

Bukan:

```java
@Bean
AcmeTemplate acmeTemplate() {
    return new AcmeTemplate(acmeClient());
}
```

---

## 8. Candidate Discovery Pipeline

Auto-configuration pipeline bisa dibayangkan seperti ini:

```text
@SpringBootApplication
        ↓
@EnableAutoConfiguration
        ↓
AutoConfigurationImportSelector
        ↓
load candidate class names from AutoConfiguration.imports
        ↓
apply exclusions
        ↓
apply auto-configuration metadata / filters
        ↓
sort according to before/after/order
        ↓
import selected configuration classes
        ↓
ConfigurationClassPostProcessor parses them
        ↓
conditions evaluated
        ↓
bean definitions registered
```

Poin penting:

1. Boot pertama-tama menemukan **nama class** auto-configuration.
2. Belum tentu semua class itu aktif.
3. Exclusion dapat membuang class tertentu.
4. Condition menentukan apakah class atau bean method berlaku.
5. Ordering menentukan urutan definisi bean, bukan urutan instansiasi final.
6. Setelah bean definition masuk ke container, lifecycle Spring Core biasa mengambil alih.

---

## 9. Auto-Configuration Exclusion

Ada beberapa cara menonaktifkan auto-configuration tertentu.

### 9.1 Exclude dari `@SpringBootApplication`

```java
@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)
public class MyApplication {
}
```

### 9.2 Exclude by name

Berguna jika class tidak ada di compile-time classpath:

```java
@SpringBootApplication(excludeName = "org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
public class MyApplication {
}
```

### 9.3 Exclude dari property

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration
```

Kapan exclude dipakai?

Pakai exclude jika:

1. auto-configuration benar-benar tidak relevan untuk aplikasi;
2. classpath dependency tidak bisa dihapus karena transitive dependency;
3. back-off tidak cukup karena auto-config masih mendaftarkan infrastructure lain;
4. Anda sedang melakukan migration dan butuh disable sementara.

Jangan pakai exclude sebagai solusi pertama untuk setiap konflik. Sering kali solusi lebih benar adalah:

- definisikan bean user sendiri;
- set property yang tepat;
- ubah dependency;
- pisahkan module;
- perbaiki conditional di custom starter.

---

## 10. Condition Evaluation: Jantung Auto-Configuration

Auto-configuration bergantung pada `@Conditional`.

Spring Framework menyediakan general mechanism:

```java
@Conditional(MyCondition.class)
```

Spring Boot menyediakan banyak condition siap pakai.

Kategori utama:

1. class conditions;
2. bean conditions;
3. property conditions;
4. resource conditions;
5. web application conditions;
6. expression conditions;
7. single candidate conditions;
8. cloud platform conditions.

---

## 11. Class Conditions

### 11.1 `@ConditionalOnClass`

Aktif jika class tertentu ada di classpath.

```java
@AutoConfiguration
@ConditionalOnClass(ObjectMapper.class)
public class JacksonBasedAutoConfiguration {
}
```

Makna:

```text
Jika Jackson ada di classpath, konfigurasi ini relevan.
```

### 11.2 `@ConditionalOnMissingClass`

Aktif jika class tertentu tidak ada.

```java
@AutoConfiguration
@ConditionalOnMissingClass("com.example.LegacyClient")
public class ModernClientAutoConfiguration {
}
```

### 11.3 Kenapa `name` kadang lebih aman?

Jika class optional tidak selalu ada di compile-time/runtime classpath, gunakan string name:

```java
@ConditionalOnClass(name = "com.example.OptionalClient")
```

Pada class-level, Boot dapat membaca annotation metadata dengan ASM tanpa harus load class target. Tetapi pada `@Bean` method, return type method bisa menyebabkan class loading sebelum condition dievaluasi.

Contoh rawan:

```java
@Bean
@ConditionalOnClass(OptionalClient.class)
OptionalClient optionalClient() {
    return new OptionalClient();
}
```

Jika `OptionalClient` tidak ada, method signature sendiri bisa bermasalah saat class dimuat.

Pola lebih aman:

```java
@AutoConfiguration
public class OptionalClientAutoConfiguration {

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = "com.example.OptionalClient")
    static class OptionalClientConfiguration {

        @Bean
        OptionalClient optionalClient() {
            return new OptionalClient();
        }
    }
}
```

Atau pisahkan ke class konfigurasi yang hanya dimuat saat condition terpenuhi.

Mental model:

```text
class condition protects configuration loading;
method return type may still trigger JVM class resolution if not isolated properly.
```

---

## 12. Bean Conditions

### 12.1 `@ConditionalOnBean`

Aktif jika bean tertentu sudah ada.

```java
@Bean
@ConditionalOnBean(DataSource.class)
JdbcAuditWriter jdbcAuditWriter(DataSource dataSource) {
    return new JdbcAuditWriter(dataSource);
}
```

Makna:

```text
Buat JdbcAuditWriter hanya jika aplikasi punya DataSource.
```

### 12.2 `@ConditionalOnMissingBean`

Aktif jika bean tertentu belum ada.

```java
@Bean
@ConditionalOnMissingBean
AuditClock auditClock() {
    return AuditClock.systemUtc();
}
```

Makna:

```text
Berikan default clock, tetapi user boleh override.
```

### 12.3 `@ConditionalOnSingleCandidate`

Aktif jika hanya ada satu candidate yang jelas.

```java
@Bean
@ConditionalOnSingleCandidate(DataSource.class)
DatabaseHealthIndicator databaseHealthIndicator(DataSource dataSource) {
    return new DatabaseHealthIndicator(dataSource);
}
```

Berguna saat aplikasi bisa punya banyak bean type sama.

### 12.4 Bahaya Order pada Bean Conditions

Bean conditions dievaluasi berdasarkan bean definitions yang sudah diproses sejauh itu. Karena itu ordering auto-configuration bisa mempengaruhi hasil.

Spring Boot merekomendasikan penggunaan `@ConditionalOnBean` dan `@ConditionalOnMissingBean` terutama pada auto-configuration class, karena user-defined bean definitions umumnya sudah ditambahkan sebelum auto-configuration diproses.

Prinsip aman:

```text
auto-config should react to user beans, not race with peer auto-config beans
```

Jika auto-config A membutuhkan bean dari auto-config B, gunakan ordering eksplisit:

```java
@AutoConfiguration(after = DataSourceAutoConfiguration.class)
public class AuditJdbcAutoConfiguration {
}
```

---

## 13. Property Conditions

### 13.1 `@ConditionalOnProperty`

Aktif berdasarkan property.

```java
@Bean
@ConditionalOnProperty(prefix = "audit", name = "enabled", havingValue = "true", matchIfMissing = true)
AuditService auditService() {
    return new AuditService();
}
```

Makna:

```text
audit.enabled=true  → aktif
audit.enabled=false → tidak aktif
missing             → aktif karena matchIfMissing=true
```

### 13.2 Default yang Aman

Pertanyaan penting:

> Fitur ini sebaiknya default aktif atau default mati?

Default aktif cocok untuk:

- basic metrics;
- default object mapper customization;
- simple health indicator;
- safe local behavior.

Default mati cocok untuk:

- outbound network call;
- scheduled job;
- destructive sync;
- feature yang mengirim data keluar;
- expensive background process;
- security-sensitive integration.

Contoh:

```java
@Bean
@ConditionalOnProperty(prefix = "acme.sync", name = "enabled", havingValue = "true")
AcmeSyncJob acmeSyncJob() {
    return new AcmeSyncJob();
}
```

Lebih aman daripada:

```java
@Bean
@ConditionalOnProperty(prefix = "acme.sync", name = "enabled", matchIfMissing = true)
AcmeSyncJob acmeSyncJob() {
    return new AcmeSyncJob();
}
```

Karena scheduled/outbound behavior yang aktif diam-diam bisa menjadi incident.

---

## 14. Resource Conditions

### 14.1 `@ConditionalOnResource`

Aktif jika resource tertentu ada.

```java
@AutoConfiguration
@ConditionalOnResource(resources = "classpath:/audit-rules.yml")
public class AuditRulesAutoConfiguration {
}
```

Kapan berguna?

- optional config file;
- embedded schema;
- template resource;
- license file;
- default rule pack.

Risiko:

- resource muncul karena transitive dependency;
- test resource beda dengan production;
- resource packaging salah di executable JAR/native image.

---

## 15. Web Application Conditions

### 15.1 `@ConditionalOnWebApplication`

Aktif jika aplikasi web.

```java
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AcmeServletAutoConfiguration {
}
```

### 15.2 `@ConditionalOnNotWebApplication`

Aktif jika bukan web app.

```java
@AutoConfiguration
@ConditionalOnNotWebApplication
public class AcmeCliAutoConfiguration {
}
```

### 15.3 Servlet vs Reactive

Boot dapat membedakan web application type:

```text
NONE
SERVLET
REACTIVE
```

Kesalahan umum:

- library mendaftarkan `Filter` padahal app reactive;
- library mendaftarkan `WebFilter` padahal app servlet;
- auto-config membuat MVC infrastructure di batch app;
- starter memaksa servlet dependency ke aplikasi non-web.

Pola lebih baik:

```java
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class AcmeMvcAutoConfiguration {
}

@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
class AcmeWebFluxAutoConfiguration {
}
```

---

## 16. Expression Conditions: Powerful but Dangerous

`@ConditionalOnExpression` memakai SpEL.

```java
@Bean
@ConditionalOnExpression("'${audit.mode}' == 'advanced'")
AdvancedAuditService advancedAuditService() {
    return new AdvancedAuditService();
}
```

Masalah:

1. sulit dianalisis statis;
2. rawan typo;
3. lebih sulit untuk metadata/AOT;
4. expression bisa menjadi terlalu pintar;
5. behavior sulit dibaca dari config.

Gunakan property condition biasa jika cukup:

```java
@ConditionalOnProperty(prefix = "audit", name = "mode", havingValue = "advanced")
```

Rule:

```text
Prefer explicit condition over SpEL condition.
```

---

## 17. Conditional Class vs Conditional Bean Method

Ada dua level condition:

```java
@AutoConfiguration
@ConditionalOnClass(AcmeClient.class)
public class AcmeAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AcmeClient acmeClient() {
        return new AcmeClient();
    }
}
```

Class-level condition:

```text
Apakah configuration class ini relevan sama sekali?
```

Method-level condition:

```text
Apakah bean tertentu di dalam configuration class ini perlu didaftarkan?
```

Gunakan class-level untuk syarat besar:

- dependency library ada;
- tipe aplikasi sesuai;
- resource utama ada.

Gunakan method-level untuk syarat granular:

- bean belum ada;
- property fitur tertentu aktif;
- optional dependency tambahan ada;
- single candidate tersedia.

Pola yang baik:

```java
@AutoConfiguration
@ConditionalOnClass(AcmeClient.class)
@EnableConfigurationProperties(AcmeProperties.class)
public class AcmeAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AcmeClient acmeClient(AcmeProperties properties) {
        return new AcmeClient(properties.endpoint());
    }

    @Bean
    @ConditionalOnProperty(prefix = "acme.metrics", name = "enabled", havingValue = "true", matchIfMissing = true)
    AcmeMetricsBinder acmeMetricsBinder(AcmeClient client) {
        return new AcmeMetricsBinder(client);
    }
}
```

---

## 18. Auto-Configuration Ordering

Ordering menjawab:

> Auto-configuration class mana yang diproses lebih dulu?

Bukan:

> Bean mana yang dibuat lebih dulu?

Bean creation tetap ditentukan oleh dependency graph dan lifecycle container.

### 18.1 `after`

```java
@AutoConfiguration(after = DataSourceAutoConfiguration.class)
public class AuditJdbcAutoConfiguration {
}
```

Makna:

```text
Definisi AuditJdbcAutoConfiguration diproses setelah DataSourceAutoConfiguration.
```

### 18.2 `before`

```java
@AutoConfiguration(before = WebMvcAutoConfiguration.class)
public class CustomWebDefaultsAutoConfiguration {
}
```

### 18.3 `@AutoConfigureAfter`

```java
@AutoConfigureAfter(DataSourceAutoConfiguration.class)
public class AuditJdbcAutoConfiguration {
}
```

### 18.4 `@AutoConfigureBefore`

```java
@AutoConfigureBefore(WebMvcAutoConfiguration.class)
public class CustomWebDefaultsAutoConfiguration {
}
```

### 18.5 `@AutoConfigureOrder`

Dipakai jika tidak ada direct relationship tetapi ingin ordering relatif.

### 18.6 Ordering Anti-Pattern

Terlalu banyak ordering biasanya tanda desain salah.

Jika starter Anda punya banyak:

```java
@AutoConfigureAfter(...)
@AutoConfigureBefore(...)
```

mungkin ada masalah:

1. auto-config terlalu besar;
2. condition tidak cukup eksplisit;
3. hidden dependency antar module;
4. configuration tidak dipisah per capability;
5. library terlalu banyak menebak.

Rule:

```text
Use ordering to express real dependency, not to fix accidental condition races.
```

---

## 19. Auto-Configuration Packages

`@SpringBootApplication` tidak hanya mengaktifkan component scan. Ia juga menentukan **auto-configuration package**.

Auto-configuration package adalah package dasar yang digunakan beberapa fitur auto-configured untuk mencari entity, repository, dan komponen tertentu.

Contoh:

```java
package com.example.billing;

@SpringBootApplication
public class BillingApplication {
}
```

Default package:

```text
com.example.billing
```

Ini dapat mempengaruhi fitur seperti:

- JPA entity scanning;
- Spring Data repository scanning;
- configuration properties scanning;
- mapper/repository tertentu tergantung module.

Pitfall:

```java
package com.example.billing.boot;

@SpringBootApplication
public class BillingApplication {
}
```

Jika entity ada di:

```text
com.example.billing.domain.Invoice
```

Package `com.example.billing.domain` bukan child dari `com.example.billing.boot`, sehingga bisa tidak terdeteksi.

Solusi:

1. letakkan application class di root package;
2. gunakan explicit scan annotation jika perlu;
3. hindari default package;
4. hindari package layout yang membingungkan.

---

## 20. Condition Evaluation Report

Saat auto-configuration membingungkan, alat pertama adalah condition evaluation report.

Jalankan aplikasi dengan:

```bash
java -jar app.jar --debug
```

Atau:

```properties
debug=true
```

Boot akan menampilkan laporan condition:

```text
Positive matches:
-----------------
DataSourceAutoConfiguration matched:
   - @ConditionalOnClass found required classes 'javax.sql.DataSource', ...
   - @ConditionalOnMissingBean did not find any beans

Negative matches:
-----------------
MongoAutoConfiguration did not match:
   - @ConditionalOnClass did not find required class 'com.mongodb.client.MongoClient'
```

Cara membaca:

1. Cari auto-config yang Anda harapkan aktif/tidak aktif.
2. Lihat apakah ia masuk positive atau negative matches.
3. Baca condition yang gagal.
4. Tentukan kategori penyebab:
   - classpath tidak ada;
   - property salah;
   - bean sudah ada;
   - web type salah;
   - resource tidak ada;
   - ordering/condition race;
   - exclusion aktif.

Mental model report:

```text
Condition report is not a log dump.
It is a decision trace of the auto-configuration engine.
```

---

## 21. Actuator Conditions Endpoint

Jika Actuator tersedia dan endpoint diaktifkan, condition report juga bisa dilihat lewat endpoint tertentu.

Namun di production, endpoint seperti ini harus dikontrol ketat karena bisa membocorkan detail internal:

- dependency yang digunakan;
- classpath hints;
- configuration behavior;
- bean names;
- infrastructure decisions.

Rule:

```text
Expose diagnostic endpoints only with explicit security and operational intent.
```

Untuk production, lebih baik:

- aktifkan hanya di internal network;
- lindungi dengan authentication/authorization;
- batasi exposure endpoint;
- gunakan sementara saat troubleshooting jika policy mengizinkan.

---

## 22. Starter vs Auto-Configuration

Banyak engineer mencampuradukkan dua istilah ini.

| Istilah | Makna |
|---|---|
| Auto-configuration | Code yang mendaftarkan bean secara conditional |
| Starter | Dependency convenience yang menarik auto-config + library yang diperlukan |
| Properties | Contract konfigurasi user |
| BOM | Version governance |

Contoh struktur library yang baik:

```text
acme-spring-boot
  ├─ AcmeAutoConfiguration
  ├─ AcmeProperties
  ├─ AcmeClientBuilderCustomizer
  └─ META-INF/spring/...AutoConfiguration.imports

acme-spring-boot-starter
  └─ pom.xml / build.gradle pulling:
       - acme-spring-boot
       - acme-client-core
       - optional metrics/tracing dependencies if opinionated
```

Spring Boot documentation menjelaskan pola umum: module auto-configuration berisi kode auto-config dan API, sedangkan starter menyediakan dependency yang membuat integrasi mudah.

### 22.1 Kenapa Dipisah?

Pisahkan jika:

1. library punya optional features;
2. ada beberapa flavor dependency;
3. consumer ingin memilih dependency sendiri;
4. platform team ingin punya starter opinionated;
5. Anda perlu menjaga API auto-config stabil.

Gabungkan jika:

1. library sangat kecil;
2. tidak ada optional dependency;
3. tidak ada variasi starter;
4. consumer internal kecil dan terkendali.

---

## 23. Designing Properties Contract

Auto-configuration tanpa properties contract biasanya tidak cukup fleksibel.

Contoh:

```java
@ConfigurationProperties(prefix = "acme.client")
public record AcmeClientProperties(
        URI baseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        boolean metricsEnabled,
        Retry retry
) {
    public record Retry(
            boolean enabled,
            int maxAttempts,
            Duration initialBackoff,
            Duration maxBackoff
    ) {}
}
```

YAML:

```yaml
acme:
  client:
    base-url: https://api.acme.internal
    connect-timeout: 2s
    read-timeout: 5s
    metrics-enabled: true
    retry:
      enabled: true
      max-attempts: 3
      initial-backoff: 200ms
      max-backoff: 2s
```

Property design guideline:

1. Gunakan namespace unik: `acme.client`, bukan `client`.
2. Jangan gunakan nama terlalu generic: `enabled`, `timeout` di root global.
3. Default harus aman.
4. Durasi gunakan `Duration`, bukan `long` milliseconds.
5. Size gunakan `DataSize`, bukan `long` bytes.
6. Validate required config.
7. Pisahkan fitur besar menjadi nested properties.
8. Hindari property yang mengaktifkan banyak behavior sekaligus.
9. Dokumentasikan operational impact.
10. Jangan masukkan secret default di metadata.

---

## 24. Configuration Metadata

Spring Boot dapat menghasilkan configuration metadata agar IDE memberikan autocomplete untuk `application.yml` atau `application.properties`.

Untuk library/starter internal, ini sangat penting.

Tanpa metadata, consumer harus membaca source code atau wiki.

Dengan metadata, consumer bisa melihat:

- property name;
- type;
- default value;
- description;
- deprecation;
- replacement.

Tambahkan annotation processor:

Maven:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-configuration-processor</artifactId>
    <optional>true</optional>
</dependency>
```

Gradle:

```kotlin
dependencies {
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")
}
```

Manual metadata tambahan bisa dibuat jika property tidak langsung berasal dari `@ConfigurationProperties`.

Rule untuk platform starter:

```text
No production starter should ship without configuration metadata.
```

---

## 25. Customizer Pattern

Auto-configuration sering butuh default tetapi tetap membuka extension point.

Pola yang baik:

```java
public interface AcmeClientCustomizer {
    void customize(AcmeClient.Builder builder);
}
```

Auto-config:

```java
@Bean
@ConditionalOnMissingBean
AcmeClient acmeClient(
        AcmeClientProperties properties,
        ObjectProvider<AcmeClientCustomizer> customizers
) {
    AcmeClient.Builder builder = AcmeClient.builder()
            .baseUrl(properties.baseUrl())
            .connectTimeout(properties.connectTimeout())
            .readTimeout(properties.readTimeout());

    customizers.orderedStream().forEach(customizer -> customizer.customize(builder));

    return builder.build();
}
```

Consumer:

```java
@Bean
AcmeClientCustomizer addCorrelationHeader(CorrelationIdProvider provider) {
    return builder -> builder.defaultHeader("X-Correlation-Id", provider.current());
}
```

Keuntungan:

1. user tidak perlu replace seluruh bean;
2. starter tetap menyediakan default;
3. extension terkontrol;
4. multiple customization bisa ordered;
5. backward compatibility lebih mudah.

Pola ini banyak dipakai di ekosistem Boot: builder customizer, codec customizer, web client customizer, rest client customizer, servlet container customizer, dan sebagainya.

---

## 26. Builder Pattern untuk Auto-Configured Bean

Bean yang auto-configured sebaiknya dibuat melalui builder/configurer jika kompleks.

Buruk:

```java
@Bean
AcmeClient acmeClient(AcmeProperties p) {
    AcmeClient client = new AcmeClient();
    client.setA(p.a());
    client.setB(p.b());
    client.setC(p.c());
    client.setD(p.d());
    return client;
}
```

Lebih baik:

```java
@Bean
AcmeClient acmeClient(
        AcmeProperties properties,
        ObjectProvider<AcmeClientBuilderCustomizer> customizers
) {
    AcmeClient.Builder builder = AcmeClient.builder()
            .endpoint(properties.endpoint())
            .timeouts(properties.timeouts());

    customizers.orderedStream().forEach(c -> c.customize(builder));

    return builder.build();
}
```

Kenapa?

- konstruksi object lebih readable;
- validation bisa di builder;
- extension point jelas;
- test lebih mudah;
- perubahan property tidak membuat constructor membengkak;
- customizer bisa ditambahkan tanpa breaking API.

---

## 27. Avoid Component Scanning in Starters

Salah satu anti-pattern terbesar:

```java
@Configuration
@ComponentScan("com.example.acme")
public class AcmeAutoConfiguration {
}
```

Ini buruk karena:

1. terlalu banyak class bisa masuk ke application context;
2. sulit tahu bean mana yang didaftarkan;
3. conditional control hilang;
4. internal component bisa menjadi public accidental bean;
5. bean name conflict meningkat;
6. startup lebih berat;
7. AOT/native lebih sulit;
8. consumer sulit override.

Lebih baik explicit:

```java
@AutoConfiguration
@Import({
        AcmeCoreConfiguration.class,
        AcmeMetricsConfiguration.class
})
public class AcmeAutoConfiguration {
}
```

Atau deklarasikan bean langsung:

```java
@Bean
@ConditionalOnMissingBean
AcmeService acmeService(AcmeClient client) {
    return new AcmeService(client);
}
```

Rule:

```text
Application code may use component scanning.
Auto-configuration should use explicit registration.
```

---

## 28. Designing Auto-Configuration by Capability

Jangan membuat satu class raksasa:

```java
@AutoConfiguration
public class AcmeAutoConfiguration {
    // client
    // metrics
    // tracing
    // scheduler
    // web
    // security
    // kafka
    // actuator
    // cache
}
```

Lebih baik pisahkan:

```text
AcmeCoreAutoConfiguration
AcmeWebMvcAutoConfiguration
AcmeWebFluxAutoConfiguration
AcmeMetricsAutoConfiguration
AcmeTracingAutoConfiguration
AcmeSchedulingAutoConfiguration
AcmeKafkaAutoConfiguration
AcmeSecurityAutoConfiguration
```

Keuntungan:

1. condition lebih jelas;
2. dependency optional lebih aman;
3. failure lebih terlokalisasi;
4. condition report lebih mudah dibaca;
5. consumer bisa exclude sebagian;
6. test lebih kecil;
7. native/AOT lebih predictable.

---

## 29. Layered Auto-Configuration Pattern

Untuk starter enterprise, desain auto-config bisa dibuat berlapis:

```text
Core capability
  ↓
Transport-specific capability
  ↓
Observability capability
  ↓
Operational capability
  ↓
Application-facing convenience bean
```

Contoh Acme client:

```text
AcmeProperties
AcmeClientAutoConfiguration
AcmeHttpClientAutoConfiguration
AcmeMetricsAutoConfiguration
AcmeHealthAutoConfiguration
AcmeTemplateAutoConfiguration
```

Dependency:

```text
AcmeTemplate depends on AcmeClient
AcmeMetrics depends on MeterRegistry + AcmeClient
AcmeHealth depends on HealthContributor + AcmeClient
AcmeHttpClient depends on RestClient/WebClient infrastructure
```

Jangan sebaliknya:

```text
AcmeClient depends on Actuator
AcmeClient depends on Web MVC
AcmeClient depends on Metrics
```

Core harus kecil.

---

## 30. Example: Production-Grade Internal Audit Starter

Bayangkan organisasi ingin semua service punya audit event writer.

Requirement:

1. default audit service tersedia;
2. bisa write ke log, JDBC, Kafka, atau no-op;
3. default tidak boleh kirim event keluar tanpa config eksplisit;
4. semua event punya correlation ID;
5. metrics optional;
6. user bisa override serializer;
7. user bisa override sink;
8. condition report harus jelas;
9. test auto-config ringan.

### 30.1 Properties

```java
@ConfigurationProperties(prefix = "platform.audit")
public record AuditProperties(
        boolean enabled,
        Sink sink,
        Log log,
        Jdbc jdbc,
        Kafka kafka
) {
    public enum Sink {
        LOG,
        JDBC,
        KAFKA,
        NOOP
    }

    public record Log(boolean pretty) {}

    public record Jdbc(String tableName) {}

    public record Kafka(String topic) {}
}
```

### 30.2 Core Auto-Configuration

```java
@AutoConfiguration
@EnableConfigurationProperties(AuditProperties.class)
@ConditionalOnProperty(prefix = "platform.audit", name = "enabled", havingValue = "true")
public class AuditAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AuditSerializer auditSerializer(ObjectMapper objectMapper) {
        return new JacksonAuditSerializer(objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean
    AuditService auditService(AuditSink sink, CorrelationIdProvider correlationIdProvider) {
        return new DefaultAuditService(sink, correlationIdProvider);
    }
}
```

### 30.3 Log Sink

```java
@AutoConfiguration(after = AuditAutoConfiguration.class)
@ConditionalOnClass(Logger.class)
@ConditionalOnProperty(prefix = "platform.audit", name = "sink", havingValue = "LOG")
public class AuditLogSinkAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(AuditSink.class)
    AuditSink auditLogSink(AuditSerializer serializer) {
        return new LoggingAuditSink(serializer);
    }
}
```

### 30.4 JDBC Sink

```java
@AutoConfiguration(after = DataSourceAutoConfiguration.class)
@ConditionalOnClass({DataSource.class, JdbcTemplate.class})
@ConditionalOnBean(DataSource.class)
@ConditionalOnProperty(prefix = "platform.audit", name = "sink", havingValue = "JDBC")
public class AuditJdbcSinkAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(AuditSink.class)
    AuditSink auditJdbcSink(JdbcTemplate jdbcTemplate, AuditProperties properties) {
        return new JdbcAuditSink(jdbcTemplate, properties.jdbc().tableName());
    }
}
```

### 30.5 Kafka Sink

```java
@AutoConfiguration
@ConditionalOnClass(KafkaTemplate.class)
@ConditionalOnBean(KafkaTemplate.class)
@ConditionalOnProperty(prefix = "platform.audit", name = "sink", havingValue = "KAFKA")
public class AuditKafkaSinkAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(AuditSink.class)
    AuditSink auditKafkaSink(KafkaTemplate<String, byte[]> kafkaTemplate, AuditProperties properties) {
        return new KafkaAuditSink(kafkaTemplate, properties.kafka().topic());
    }
}
```

### 30.6 Imports

```text
com.mycorp.platform.audit.autoconfigure.AuditAutoConfiguration
com.mycorp.platform.audit.autoconfigure.AuditLogSinkAutoConfiguration
com.mycorp.platform.audit.autoconfigure.AuditJdbcSinkAutoConfiguration
com.mycorp.platform.audit.autoconfigure.AuditKafkaSinkAutoConfiguration
com.mycorp.platform.audit.autoconfigure.AuditMetricsAutoConfiguration
```

### 30.7 Why This Design Is Good

1. Core audit tidak memaksa JDBC/Kafka.
2. Sink dipilih eksplisit lewat property.
3. User bisa override `AuditSink`.
4. User bisa override `AuditSerializer`.
5. Kafka tidak aktif hanya karena Kafka ada di classpath, kecuali property memilih Kafka.
6. JDBC sink aktif hanya jika `DataSource` ada.
7. Condition report menjelaskan kenapa sink aktif/tidak aktif.
8. Setiap capability bisa diuji terpisah.

---

## 31. ApplicationContextRunner: Testing Auto-Configuration

Auto-configuration tidak perlu diuji dengan full `@SpringBootTest`.

Gunakan `ApplicationContextRunner`.

Contoh:

```java
class AcmeAutoConfigurationTests {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AcmeAutoConfiguration.class));

    @Test
    void createsClientWhenClassIsPresentAndNoUserBeanExists() {
        contextRunner
                .withPropertyValues("acme.endpoint=https://api.acme.test")
                .run(context -> {
                    assertThat(context).hasSingleBean(AcmeClient.class);
                    assertThat(context.getBean(AcmeClient.class).endpoint())
                            .isEqualTo(URI.create("https://api.acme.test"));
                });
    }

    @Test
    void backsOffWhenUserProvidesClient() {
        contextRunner
                .withBean(AcmeClient.class, () -> new AcmeClient(URI.create("https://custom")))
                .run(context -> {
                    assertThat(context).hasSingleBean(AcmeClient.class);
                    assertThat(context.getBean(AcmeClient.class).endpoint())
                            .isEqualTo(URI.create("https://custom"));
                });
    }
}
```

Keuntungan:

1. test cepat;
2. context minimal;
3. property mudah diubah;
4. user bean mudah disimulasikan;
5. condition bisa diuji eksplisit;
6. tidak perlu menjalankan server;
7. failure lebih mudah dibaca.

---

## 32. Testing Web-Specific Auto-Configuration

Untuk servlet:

```java
private final WebApplicationContextRunner contextRunner = new WebApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(AcmeMvcAutoConfiguration.class));
```

Untuk reactive:

```java
private final ReactiveWebApplicationContextRunner contextRunner = new ReactiveWebApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(AcmeWebFluxAutoConfiguration.class));
```

Test:

```java
@Test
void mvcInterceptorCreatedInServletApplication() {
    contextRunner.run(context -> {
        assertThat(context).hasSingleBean(AcmeHandlerInterceptor.class);
    });
}
```

Jangan menguji MVC auto-config dengan plain `ApplicationContextRunner` jika behavior-nya membutuhkan web application context.

---

## 33. Testing Missing Class Conditions

Boot menyediakan `FilteredClassLoader` untuk mensimulasikan class tidak ada.

```java
@Test
void backsOffWhenAcmeClientClassIsMissing() {
    contextRunner
            .withClassLoader(new FilteredClassLoader(AcmeClient.class))
            .run(context -> {
                assertThat(context).doesNotHaveBean("acmeClient");
            });
}
```

Ini penting untuk optional dependency.

Tanpa test seperti ini, starter bisa gagal di aplikasi consumer yang tidak membawa optional library tertentu.

---

## 34. Testing Property Conditions

```java
@Test
void doesNotCreateSyncJobWhenDisabled() {
    contextRunner
            .withPropertyValues("acme.sync.enabled=false")
            .run(context -> assertThat(context).doesNotHaveBean(AcmeSyncJob.class));
}

@Test
void createsSyncJobWhenEnabled() {
    contextRunner
            .withPropertyValues("acme.sync.enabled=true")
            .run(context -> assertThat(context).hasSingleBean(AcmeSyncJob.class));
}
```

Test property condition harus mencakup:

1. property missing;
2. property true;
3. property false;
4. invalid property value;
5. case-insensitive atau relaxed binding behavior jika relevan;
6. default safety behavior.

---

## 35. Testing Back-Off Semantics

Back-off adalah contract. Test harus eksplisit.

```java
@Test
void userDefinedSerializerWins() {
    AuditSerializer custom = event -> "custom".getBytes(StandardCharsets.UTF_8);

    contextRunner
            .withBean(AuditSerializer.class, () -> custom)
            .run(context -> {
                assertThat(context).hasSingleBean(AuditSerializer.class);
                assertThat(context.getBean(AuditSerializer.class)).isSameAs(custom);
            });
}
```

Jika starter internal tidak punya test back-off, cepat atau lambat ia akan merusak aplikasi consumer.

---

## 36. Diagnosing Common Auto-Configuration Failures

### 36.1 Bean Expected but Missing

Gejala:

```text
NoSuchBeanDefinitionException: No qualifying bean of type 'AcmeClient'
```

Checklist:

1. Apakah auto-configuration JAR ada di classpath?
2. Apakah `AutoConfiguration.imports` dikemas di JAR?
3. Apakah class auto-config ada di imports file?
4. Apakah `@EnableAutoConfiguration` aktif?
5. Apakah auto-config di-exclude?
6. Apakah `@ConditionalOnClass` gagal?
7. Apakah `@ConditionalOnProperty` tidak match?
8. Apakah web application type salah?
9. Apakah bean method condition gagal?
10. Apakah bean dibuat dengan nama/type lain?

### 36.2 Bean Unexpectedly Created

Gejala:

```text
A bean exists even though no application code declares it.
```

Checklist:

1. Cek condition report positive matches.
2. Cari auto-config yang mendaftarkan bean.
3. Cek dependency baru yang membawa starter.
4. Cek transitive dependency.
5. Cek property `matchIfMissing=true`.
6. Cek default activation behavior.
7. Cek component scanning dari starter buruk.
8. Cek test slice import.

### 36.3 User Bean Not Overriding Auto-Configured Bean

Kemungkinan:

1. type bean user tidak sama;
2. qualifier/name berbeda;
3. auto-config memakai `@ConditionalOnMissingBean(name = ...)`, bukan type;
4. user bean dibuat terlalu lambat;
5. bean berada di parent/child context berbeda;
6. condition mencari parameterized type tertentu;
7. auto-config tidak memakai back-off.

### 36.4 Auto-Config Works in App but Fails in Test

Kemungkinan:

1. test slice tidak membawa auto-config tertentu;
2. property test berbeda;
3. classpath test berbeda;
4. mock bean mengubah condition;
5. web context type berbeda;
6. `@SpringBootTest` dan `@WebMvcTest` punya scope berbeda;
7. test profile menonaktifkan fitur.

---

## 37. Auto-Configuration and Test Slices

Spring Boot test slices seperti `@WebMvcTest`, `@DataJpaTest`, `@JsonTest`, dan lainnya hanya memuat sebagian context.

Konsekuensi:

```text
Auto-configuration yang aktif di aplikasi penuh belum tentu aktif di test slice.
```

Ini bukan bug. Ini fitur agar test lebih kecil.

Namun untuk starter internal, Anda perlu tahu apakah auto-config harus berlaku dalam test slice.

Misalnya:

- JSON customization harus muncul di `@JsonTest`;
- MVC advice harus muncul di `@WebMvcTest`;
- repository infra harus muncul di `@DataJpaTest`;
- custom HTTP client mungkin muncul di `@RestClientTest`.

Jika tidak, developer akan mengalami:

```text
works in production context, fails in slice test
```

atau sebaliknya:

```text
works in slice test, fails in production context
```

Rule:

```text
For internal starters, document which test slices are supported.
```

---

## 38. Boot 2 vs Boot 3 vs Boot 4: Auto-Configuration Perspective

### 38.1 Boot 2 Era

Ciri utama:

- Java 8/11 banyak digunakan;
- `javax.*` masih dominan;
- auto-config discovery banyak melalui `spring.factories`;
- Spring Framework 5.x;
- servlet stack umum;
- Actuator/Micrometer modern mulai matang;
- native/AOT belum menjadi mainstream.

### 38.2 Boot 3 Era

Ciri utama:

- Java 17 minimum;
- `jakarta.*` menggantikan `javax.*`;
- `AutoConfiguration.imports` menjadi mekanisme utama;
- Spring Framework 6.x;
- observability dengan Observation API lebih terintegrasi;
- AOT/native image menjadi first-class concern;
- banyak package auto-config berubah mengikuti modularisasi dan Jakarta migration.

### 38.3 Boot 4 Era

Ciri utama:

- tetap Java 17 minimum;
- dukungan Java modern termasuk Java 25;
- Spring Framework 7.x;
- modularisasi codebase Boot lebih kuat;
- paket auto-configuration lebih modular;
- API versioning dan HTTP service client support makin menonjol;
- JSpecify/null-safety direction makin penting;
- Jakarta EE 11 alignment.

Implikasi untuk engineer:

1. Jangan hardcode asumsi package auto-config lintas major version.
2. Jangan rely pada internal class Boot.
3. Treat auto-configuration class name sebagai public hanya untuk exclusion, bukan untuk direct usage.
4. Gunakan dokumentasi sesuai versi yang dipakai.
5. Untuk library internal, tentukan support matrix jelas:
   - Boot 2.x?
   - Boot 3.x?
   - Boot 4.x?
   - Java 8?
   - Java 17?
   - Java 21/25?

---

## 39. Public API Boundary Auto-Configuration

Spring Boot documentation menekankan bahwa walaupun auto-configuration class bersifat public, isi internalnya tidak dimaksudkan sebagai public API untuk digunakan langsung. Yang public biasanya hanya nama class untuk keperluan exclusion.

Artinya, jangan lakukan ini di aplikasi:

```java
@Import(SomeBootInternalAutoConfiguration.NestedConfiguration.class)
```

Atau:

```java
@Bean
SomeInternalBootBean internalBean(SomeBootAutoConfiguration config) {
    return config.someInternalBean();
}
```

Kenapa?

1. nested config bisa berubah;
2. bean method bisa berubah;
3. condition bisa berubah;
4. package bisa berubah;
5. upgrade major/minor menjadi rapuh.

Untuk internal starter Anda sendiri, tetapkan boundary yang sama:

```text
Public:
- properties namespace
- documented customizer interfaces
- stable user-facing beans
- auto-configuration class names for exclusion

Internal:
- nested configuration classes
- bean method names
- implementation classes
- condition arrangement
```

---

## 40. Auto-Configuration in Multi-Module Enterprise Systems

Dalam enterprise, auto-configuration sering dipakai untuk platform standardization.

Contoh platform starter:

```text
company-spring-boot-starter-web
company-spring-boot-starter-security
company-spring-boot-starter-observability
company-spring-boot-starter-database
company-spring-boot-starter-messaging
company-spring-boot-starter-audit
company-spring-boot-starter-tenant
```

Manfaat:

1. service baru punya baseline cepat;
2. logging/correlation ID konsisten;
3. error response konsisten;
4. security defaults konsisten;
5. metrics/tracing konsisten;
6. dependency version dikontrol;
7. migration bisa digerakkan dari platform layer.

Risiko:

1. hidden behavior;
2. startup conflict;
3. over-opinionated default;
4. sulit override;
5. transitive dependency terlalu besar;
6. semua service membawa fitur yang tidak dipakai;
7. platform team menjadi bottleneck.

Solusi desain:

```text
small capability starters + clear properties + customizers + back-off + documentation + tests
```

---

## 41. Enterprise Starter Design Rubric

Sebelum membuat starter internal, jawab pertanyaan ini.

### 41.1 Activation

- Apa syarat fitur aktif?
- Classpath saja cukup atau harus property eksplisit?
- Apakah default aktif aman?
- Apakah fitur melakukan network call?
- Apakah fitur menulis data?
- Apakah fitur menjalankan background thread?

### 41.2 Override

- Bean mana yang boleh dioverride?
- Apakah semua default memakai `@ConditionalOnMissingBean`?
- Apakah user bisa customize tanpa replace total?
- Apakah ada customizer interface?
- Apakah ada property untuk behavior umum?

### 41.3 Isolation

- Apakah servlet dan reactive dipisah?
- Apakah Kafka/JDBC/Redis optional dipisah?
- Apakah metrics optional dipisah?
- Apakah actuator optional dipisah?
- Apakah dependency heavy hanya masuk jika dibutuhkan?

### 41.4 Observability

- Apakah bean penting punya metrics?
- Apakah health indicator aman?
- Apakah tag cardinality terkendali?
- Apakah correlation ID dipropagasikan?
- Apakah error startup jelas?

### 41.5 Security

- Apakah starter membuka endpoint?
- Apakah endpoint terlindungi?
- Apakah secret bisa bocor ke logs/actuator?
- Apakah default aman untuk production?

### 41.6 Testing

- Apakah ada `ApplicationContextRunner` tests?
- Apakah missing class condition diuji?
- Apakah property condition diuji?
- Apakah back-off diuji?
- Apakah web servlet/reactive diuji terpisah?
- Apakah test slice behavior didokumentasikan?

---

## 42. Failure Model: Auto-Configuration sebagai Source of Production Incident

Auto-configuration bisa menjadi sumber incident jika tidak dipahami.

### 42.1 Transitive Dependency Activates Behavior

Skenario:

```text
Team menambahkan dependency library X.
Library X membawa starter Y.
Starter Y mengaktifkan auto-config Z.
Auto-config Z membuat scheduled job.
Scheduled job mulai melakukan outbound call.
Production traffic berubah.
```

Mitigasi:

- jangan aktifkan destructive/background behavior hanya karena classpath;
- butuh property eksplisit;
- log activation secara jelas;
- expose condition report saat debugging;
- dokumentasikan transitive starter.

### 42.2 Default Bean Competes with User Bean

Skenario:

```text
User mendefinisikan CustomObjectMapper.
Starter tetap membuat ObjectMapper lain.
Controller memakai satu, message converter memakai yang lain.
Serialization inconsistent.
```

Mitigasi:

- `@ConditionalOnMissingBean` tepat;
- jangan membuat bean type umum sembarangan;
- gunakan builder customizer jika targetnya customize;
- hindari duplicate infrastructure bean.

### 42.3 Property Typo Silently Falls Back to Default

Skenario:

```yaml
acme:
  conenct-timeout: 1s  # typo
```

`connect-timeout` tidak terbaca, default 30s dipakai.

Mitigasi:

- metadata;
- validation;
- config linter;
- fail fast untuk required property;
- monitoring effective config jika aman.

### 42.4 Auto-Config Active in Test but Not Production

Skenario:

```text
Test punya H2 dependency.
Production tidak.
DataSource behavior berbeda.
```

Mitigasi:

- test dengan classpath realistis;
- jangan rely pada embedded default untuk production path;
- explicit datasource config;
- test condition with FilteredClassLoader.

### 42.5 Multiple Auto-Configs Create Circular Dependency

Skenario:

```text
Metrics auto-config needs client.
Client auto-config needs metrics binder.
Both depend on each other.
```

Mitigasi:

- customizer pattern;
- provider/lazy injection untuk optional integration;
- split core from observability;
- avoid bidirectional configuration dependency.

---

## 43. Case Study: Debugging Unexpected DataSource

Gejala:

```text
Application unexpectedly starts with embedded H2 database.
```

Context:

```groovy
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    runtimeOnly("com.h2database:h2")
}
```

Tidak ada `spring.datasource.url`.

Kemungkinan:

```text
H2 ada di classpath.
Tidak ada DataSource user-defined.
Boot menganggap embedded database bisa dikonfigurasi.
```

Debug:

```bash
java -jar app.jar --debug
```

Cari:

```text
DataSourceAutoConfiguration matched
```

Fix options:

1. Hapus H2 dari runtime production dependency.
2. Buat datasource config eksplisit.
3. Pisahkan dependency test/runtime.
4. Exclude `DataSourceAutoConfiguration` jika aplikasi memang bukan DB app.
5. Fail fast dengan required production profile config.

Lesson:

```text
Classpath is configuration input.
```

---

## 44. Case Study: Custom Starter Accidentally Scans Application

Starter:

```java
@Configuration
@ComponentScan("com.company.platform")
public class PlatformAutoConfiguration {
}
```

Masalah:

```text
com.company.platform contains internal services, test helpers, deprecated beans, old interceptors.
All become candidates.
```

Gejala:

- duplicate bean;
- unexpected interceptor;
- startup lambat;
- old security filter aktif;
- test context membawa terlalu banyak bean.

Fix:

1. Hapus `@ComponentScan` dari auto-configuration.
2. Buat bean explicit.
3. Pisahkan package `autoconfigure` dari implementation internal.
4. Gunakan `@Import` untuk configuration yang jelas.
5. Tambahkan tests untuk expected bean set.

Lesson:

```text
Auto-configuration is explicit conditional registration, not package scanning.
```

---

## 45. Case Study: `@ConditionalOnMissingBean` Terlalu Luas

Starter:

```java
@Bean
@ConditionalOnMissingBean
ObjectMapper objectMapper() {
    return new ObjectMapper();
}
```

Masalah:

`ObjectMapper` adalah infrastructure bean global. Membuatnya di starter domain-specific bisa mengganggu seluruh aplikasi.

Lebih baik:

```java
@Bean
@ConditionalOnMissingBean(AcmeJsonMapper.class)
AcmeJsonMapper acmeJsonMapper(ObjectMapper objectMapper) {
    return new AcmeJsonMapper(objectMapper.copy());
}
```

Atau gunakan customizer:

```java
@Bean
Jackson2ObjectMapperBuilderCustomizer acmeJacksonCustomizer() {
    return builder -> builder.modules(new AcmeModule());
}
```

Lesson:

```text
Do not own global infrastructure unless your starter is the platform-level owner.
```

---

## 46. Case Study: `matchIfMissing = true` Creates Production Job

Starter:

```java
@Bean
@ConditionalOnProperty(prefix = "reconcile", name = "enabled", matchIfMissing = true)
ReconciliationJob reconciliationJob() {
    return new ReconciliationJob();
}
```

Production tidak punya config:

```yaml
# reconcile.enabled missing
```

Job aktif.

Jika job melakukan write atau outbound sync, ini berbahaya.

Lebih aman:

```java
@Bean
@ConditionalOnProperty(prefix = "reconcile", name = "enabled", havingValue = "true")
ReconciliationJob reconciliationJob() {
    return new ReconciliationJob();
}
```

Lesson:

```text
matchIfMissing=true should be reserved for safe defaults.
```

---

## 47. Relationship with AOT and Native Image

Auto-configuration modern harus memikirkan AOT/native image.

Kenapa?

1. native image butuh closed-world analysis;
2. reflection harus diberi hint;
3. dynamic class loading terbatas;
4. resource harus didaftarkan;
5. proxy harus diketahui;
6. condition harus bisa dievaluasi secara predictable.

Auto-configuration yang buruk untuk AOT:

- banyak reflection manual;
- class loading dinamis berdasarkan string random;
- component scanning luas;
- bean registration terlalu runtime-dynamic;
- resource tidak jelas;
- proxy dibuat tanpa hint.

Auto-configuration yang lebih AOT-friendly:

- explicit bean registration;
- clear conditional annotations;
- minimal reflection;
- runtime hints jika diperlukan;
- no broad scanning;
- properties typed;
- classpath conditions explicit.

AOT akan dibahas lebih dalam di Part 29, tetapi sejak Part 7 kita sudah perlu menanamkan disiplin desainnya.

---

## 48. Auto-Configuration and Observability

Starter internal sebaiknya menyediakan observability secara optional.

Contoh:

```java
@AutoConfiguration
@ConditionalOnClass(MeterRegistry.class)
@ConditionalOnBean({MeterRegistry.class, AcmeClient.class})
@ConditionalOnProperty(prefix = "acme.metrics", name = "enabled", havingValue = "true", matchIfMissing = true)
public class AcmeMetricsAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AcmeMetricsBinder acmeMetricsBinder(AcmeClient client) {
        return new AcmeMetricsBinder(client);
    }
}
```

Pertanyaan desain:

1. Apakah metrics aktif default?
2. Apakah tag cardinality aman?
3. Apakah metrics membutuhkan network call?
4. Apakah health indicator mahal?
5. Apakah readiness/liveness semantics jelas?
6. Apakah failure health check bisa menurunkan pod dari service?

Jangan membuat health indicator yang melakukan call berat setiap scrape.

---

## 49. Auto-Configuration and Security

Auto-configuration security sangat sensitif.

Buruk:

```java
@Bean
SecurityFilterChain permitAllEverything(HttpSecurity http) {
    return http.authorizeHttpRequests(a -> a.anyRequest().permitAll()).build();
}
```

Sangat buruk untuk starter internal kecuali benar-benar aplikasi sample.

Lebih baik:

1. sediakan customizer;
2. sediakan documented config;
3. jangan override user security chain tanpa izin;
4. condition sangat ketat;
5. gunakan ordering jelas;
6. jangan buka endpoint tanpa protection;
7. pastikan actuator exposure aman.

Contoh lebih aman:

```java
@Bean
@ConditionalOnMissingBean
PlatformSecurityCustomizer platformSecurityCustomizer() {
    return registry -> registry.requireAuthenticationForInternalEndpoints();
}
```

Atau starter hanya menyediakan support bean, bukan final policy.

Rule:

```text
Security auto-configuration must be conservative, explicit, and easy to audit.
```

---

## 50. Auto-Configuration and Transaction Boundary

Starter yang mendaftarkan service transactional harus hati-hati.

Contoh:

```java
@Bean
AuditService auditService(AuditRepository repository) {
    return new TransactionalAuditService(repository);
}
```

Pertanyaan:

1. Transaction manager mana yang dipakai?
2. Jika ada multiple transaction manager, apa yang terjadi?
3. Apakah service dipanggil dalam transaction caller?
4. Apakah audit harus `REQUIRES_NEW`?
5. Apakah audit harus terjadi after commit?
6. Apakah external sink dipanggil dalam DB transaction?
7. Apakah failure audit rollback business transaction?

Auto-configuration tidak boleh menyembunyikan semantics seperti ini.

Lebih baik expose property/policy:

```yaml
platform:
  audit:
    transaction:
      mode: AFTER_COMMIT
```

Atau sediakan separate implementation:

```text
ImmediateAuditService
TransactionalAuditService
AfterCommitAuditService
OutboxAuditService
```

---

## 51. Auto-Configuration and Multiple Bean Candidates

Misalnya aplikasi punya dua `DataSource`:

```java
@Bean
@Primary
DataSource mainDataSource() { ... }

@Bean
DataSource reportingDataSource() { ... }
```

Auto-config:

```java
@Bean
@ConditionalOnBean(DataSource.class)
AuditRepository auditRepository(DataSource dataSource) {
    return new AuditRepository(dataSource);
}
```

Jika ada `@Primary`, injection mungkin memilih primary. Tetapi apakah itu benar?

Untuk starter enterprise, sering lebih baik menyediakan property:

```yaml
platform:
  audit:
    datasource-bean-name: auditDataSource
```

Atau qualifier-aware config:

```java
@Bean
AuditRepository auditRepository(
        BeanFactory beanFactory,
        AuditProperties properties
) {
    DataSource dataSource = beanFactory.getBean(properties.datasourceBeanName(), DataSource.class);
    return new AuditRepository(dataSource);
}
```

Tetapi jangan over-engineer jika tidak perlu.

Decision rule:

```text
If multiple infrastructure beans are common in target applications, make selection explicit.
```

---

## 52. Auto-Configuration and Bean Names

`@ConditionalOnMissingBean` by type biasanya cukup.

Tetapi kadang bean name penting.

Contoh:

```java
@Bean(name = "auditObjectMapper")
@ConditionalOnMissingBean(name = "auditObjectMapper")
ObjectMapper auditObjectMapper(ObjectMapper base) {
    return base.copy();
}
```

Keuntungan:

- tidak mengganggu global `ObjectMapper`;
- user bisa override bean spesifik;
- type global tidak bentrok.

Risiko:

- name contract harus didokumentasikan;
- typo sulit dideteksi;
- refactoring nama bean bisa breaking.

Guideline:

```text
Use type-based back-off for unique domain-specific types.
Use name-based back-off for specialized infrastructure variants.
```

---

## 53. Auto-Configuration and Generic Types

Kadang type terlalu generic:

```java
@Bean
MessageConverter<OrderEvent> orderEventConverter() { ... }

@Bean
MessageConverter<AuditEvent> auditEventConverter() { ... }
```

Condition by raw type:

```java
@ConditionalOnMissingBean(MessageConverter.class)
```

bisa terlalu luas.

Lebih aman menggunakan domain-specific type:

```java
interface AuditEventConverter extends MessageConverter<AuditEvent> {
}
```

Atau condition dengan parameterized container jika didukung dan sesuai.

Guideline:

```text
Avoid exposing starter extension points only through overly generic types.
```

---

## 54. Auto-Configuration and ObjectProvider

`ObjectProvider` berguna untuk optional dependencies dan ordered extension.

Contoh:

```java
@Bean
AcmeClient acmeClient(
        AcmeProperties properties,
        ObjectProvider<AcmeClientCustomizer> customizers,
        ObjectProvider<MeterRegistry> meterRegistry
) {
    AcmeClient.Builder builder = AcmeClient.builder()
            .endpoint(properties.endpoint());

    meterRegistry.ifAvailable(builder::meterRegistry);
    customizers.orderedStream().forEach(c -> c.customize(builder));

    return builder.build();
}
```

Manfaat:

1. optional dependency tidak memaksa bean ada;
2. menghindari hard dependency pada metrics/tracing;
3. extension bisa ordered;
4. lazy lookup bisa menghindari premature bean creation.

Tetapi jangan memakai `ObjectProvider` sebagai service locator liar.

Buruk:

```java
class MyService {
    private final ObjectProvider<ApplicationContext> context;

    void execute(String type) {
        Object bean = context.getObject().getBean(type);
    }
}
```

Rule:

```text
Use ObjectProvider for optional infrastructure and extension points, not for hiding dependency design.
```

---

## 55. Auto-Configuration and Lazy Initialization

Lazy init bisa membuat startup lebih cepat, tetapi menunda failure.

Auto-configuration harus mempertimbangkan:

- apakah bean harus fail-fast saat startup?
- apakah external config harus divalidasi saat startup?
- apakah connection harus dibuat saat first request?
- apakah first request boleh menanggung initialization cost?

Untuk critical infrastructure, fail-fast biasanya lebih baik:

```text
bad database config should fail deployment, not first user request
```

Untuk optional/expensive client, lazy bisa masuk akal jika:

- jarang dipakai;
- fallback tersedia;
- startup speed penting;
- failure bisa diisolasi.

Jangan membuat semua auto-config bean lazy tanpa policy.

---

## 56. Auto-Configuration Replacement and Deprecation

Jika internal starter berkembang, class auto-config bisa perlu dipindah atau diganti.

Masalah:

- consumer mungkin exclude class lama;
- auto-config lain mungkin `before/after` class lama;
- migration bisa rusak.

Boot menyediakan mekanisme replacement file:

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.replacements
```

Format:

```text
com.mycorp.old.OldAuditAutoConfiguration=com.mycorp.new.AuditAutoConfiguration
```

Guideline internal:

1. Jangan sering rename auto-configuration class.
2. Jika harus rename, sediakan replacement mapping.
3. Dokumentasikan migration.
4. Pertahankan exclusion compatibility jika memungkinkan.
5. Jangan reuse nama lama untuk behavior berbeda secara radikal.

---

## 57. Packaging Auto-Configuration Correctly

Struktur JAR:

```text
src/main/java/
  com/mycorp/acme/autoconfigure/AcmeAutoConfiguration.java
  com/mycorp/acme/autoconfigure/AcmeProperties.java

src/main/resources/
  META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Isi imports:

```text
com.mycorp.acme.autoconfigure.AcmeAutoConfiguration
```

Common mistakes:

1. salah path file;
2. salah nama class;
3. class tidak public;
4. auto-config class tidak masuk artifact;
5. resource tidak ter-package;
6. shading/relocation merusak nama class;
7. multi-module dependency tidak membawa auto-config module;
8. starter hanya membawa core library, bukan auto-config library;
9. test memakai source classpath, production JAR tidak punya metadata.

Validasi JAR:

```bash
jar tf acme-spring-boot.jar | grep AutoConfiguration.imports
jar tf acme-spring-boot.jar | grep AcmeAutoConfiguration
```

---

## 58. Dependency Management for Starters

Starter biasanya tidak berisi banyak code. Ia berisi dependency declaration.

Maven starter example:

```xml
<project>
    <dependencies>
        <dependency>
            <groupId>com.mycorp</groupId>
            <artifactId>acme-spring-boot</artifactId>
        </dependency>
        <dependency>
            <groupId>com.mycorp</groupId>
            <artifactId>acme-client-core</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-core</artifactId>
            <optional>true</optional>
        </dependency>
    </dependencies>
</project>
```

But careful:

- optional dependency di Maven tidak selalu behave sama dengan Gradle;
- transitive dependency bisa mengaktifkan Boot auto-config lain;
- dependency version harus mengikuti BOM;
- starter tidak boleh membawa terlalu banyak driver secara default;
- jangan bawa database driver production secara tidak sengaja;
- jangan bawa embedded DB ke production starter.

Rule:

```text
A starter is an opinion. Keep the opinion narrow, documented, and override-friendly.
```

---

## 59. Naming Conventions

Spring Boot official starter:

```text
spring-boot-starter-*
```

Custom starter sebaiknya tidak memakai prefix official.

Gunakan:

```text
acme-spring-boot-starter
acme-observability-spring-boot-starter
company-platform-web-spring-boot-starter
```

Auto-config package:

```text
com.mycorp.acme.autoconfigure
```

Jangan:

```text
org.springframework.boot.autoconfigure.mycorp
```

Jangan juga mencampur application package:

```text
com.mycorp.myapp.autoconfigure
```

Jika library reusable, package harus milik library/platform, bukan aplikasi consumer.

---

## 60. Version Compatibility Matrix

Untuk seri ini, kita peduli Java 8 sampai Java 25.

Auto-configuration design harus sadar era:

| Target | Java | Spring Boot | Namespace | Auto-config discovery |
|---|---:|---|---|---|
| Legacy | 8/11 | Boot 2.x | `javax.*` | `spring.factories` dominan |
| Transitional | 17/21 | Boot 3.x | `jakarta.*` | `AutoConfiguration.imports` |
| Modern | 17/21/25 | Boot 4.x | Jakarta EE 11 aligned | `AutoConfiguration.imports`, modularized Boot |

Jika Anda membuat library internal untuk semua era, Anda mungkin butuh:

```text
acme-spring-boot2-autoconfigure
acme-spring-boot3-autoconfigure
acme-spring-boot4-autoconfigure
```

Atau minimal branch/build profile berbeda.

Jangan mencoba satu artifact mendukung Boot 2 dan Boot 4 jika isinya menyentuh:

- `javax.servlet` vs `jakarta.servlet`;
- Spring Security API lama vs baru;
- Boot package relocation;
- Actuator endpoint changes;
- Micrometer/Observation differences;
- AOT/runtime hints.

Rule:

```text
Cross-major Boot compatibility is an explicit product decision, not an accidental hope.
```

---

## 61. Java 8 to Java 25 Implications

### 61.1 Java 8/11

- Boot 2.x dominant;
- no records;
- limited modern language features;
- `javax.*`;
- older dependency ecosystem;
- virtual threads unavailable;
- native/AOT not mainstream.

Properties class usually:

```java
@ConfigurationProperties(prefix = "acme")
public class AcmeProperties {
    private String endpoint;

    public String getEndpoint() {
        return endpoint;
    }

    public void setEndpoint(String endpoint) {
        this.endpoint = endpoint;
    }
}
```

### 61.2 Java 17+

- Boot 3+;
- records available;
- sealed classes possible;
- `jakarta.*`;
- AOT/native more relevant.

Properties can be:

```java
@ConfigurationProperties(prefix = "acme")
public record AcmeProperties(URI endpoint, Duration timeout) {
}
```

### 61.3 Java 21/25

- virtual threads relevant;
- modern GC/runtime improvements;
- pattern matching/sealed/records mature;
- Boot 4 supports Java 25 era;
- concurrency model decisions more nuanced.

Auto-config may expose executor choices:

```yaml
acme:
  execution:
    mode: platform-threads # platform-threads | virtual-threads
```

But never assume virtual thread solves external resource constraints.

---

## 62. Auto-Configuration Design Checklist

Before shipping auto-config:

```text
[ ] Auto-configuration class listed in AutoConfiguration.imports
[ ] No broad component scanning
[ ] Class-level conditions for optional dependencies
[ ] Method-level conditions for granular beans
[ ] Back-off with @ConditionalOnMissingBean where user override is expected
[ ] Properties have dedicated namespace
[ ] Properties have metadata
[ ] Required properties validated
[ ] Dangerous behavior disabled by default
[ ] Optional heavy dependencies isolated
[ ] Servlet/reactive separated
[ ] Metrics/tracing optional and cardinality-safe
[ ] Health indicators cheap or clearly documented
[ ] Customizer extension points provided
[ ] Multiple candidate infrastructure handled explicitly if common
[ ] Auto-config ordering only where semantically required
[ ] ApplicationContextRunner tests exist
[ ] Missing class tests exist
[ ] Back-off tests exist
[ ] Property condition tests exist
[ ] Exclusion behavior documented
[ ] Public/internal API boundary documented
[ ] Upgrade/deprecation path documented
```

---

## 63. Decision Table: When to Use Which Condition

| Need | Preferred condition |
|---|---|
| Activate only if library exists | `@ConditionalOnClass` |
| Back off if user provides bean | `@ConditionalOnMissingBean` |
| Activate only if another bean exists | `@ConditionalOnBean` |
| Activate only if exactly one candidate is clear | `@ConditionalOnSingleCandidate` |
| Toggle feature from config | `@ConditionalOnProperty` |
| Activate in servlet app | `@ConditionalOnWebApplication(type = SERVLET)` |
| Activate in reactive app | `@ConditionalOnWebApplication(type = REACTIVE)` |
| Activate in non-web app | `@ConditionalOnNotWebApplication` |
| Activate if config/resource file exists | `@ConditionalOnResource` |
| Complex expression | Avoid if possible; otherwise `@ConditionalOnExpression` |

---

## 64. Decision Table: Classpath vs Property Activation

| Feature type | Classpath activation only? | Better policy |
|---|---:|---|
| JSON module registration | Usually OK | classpath + missing bean/customizer |
| Metrics binder | Usually OK | classpath + MeterRegistry + property default true |
| Health indicator | Sometimes | classpath + cheap check + property |
| Outbound sync job | No | explicit property true |
| Kafka producer | No | property selects sink/topic |
| Security policy | No | explicit config/customizer |
| MVC argument resolver | Usually OK | servlet web app + missing bean/customizer |
| Database migration runner | Dangerous | explicit property/profile and ordering |
| Cache manager | Depends | missing bean + provider-specific classpath |
| HTTP client | Usually OK | classpath + required endpoint property |

---

## 65. Design Heuristics for Top-Tier Spring Engineers

### 65.1 Treat Classpath as Runtime Input

Adding dependency is not passive. It can activate auto-config.

Always ask:

```text
What auto-configuration does this dependency bring?
```

### 65.2 Treat Properties as Policy

Properties are not just values. They are runtime policy.

Example:

```yaml
audit.enabled=true
audit.sink=KAFKA
```

This is an operational decision, not just config.

### 65.3 Treat Auto-Configuration as Public Product

If other teams consume your starter, you own:

- compatibility;
- override behavior;
- docs;
- diagnostics;
- migration;
- safe defaults.

### 65.4 Prefer Explicit Extension Points

Instead of telling user to replace your bean, provide:

- customizer;
- strategy interface;
- properties;
- ordered list of plugins;
- narrow override bean.

### 65.5 Design for Failure Analysis

A good starter makes failures obvious.

Bad failure:

```text
NoSuchBeanDefinitionException: AuditSink
```

Better failure:

```text
platform.audit.enabled=true but no AuditSink is configured.
Set platform.audit.sink=LOG|JDBC|KAFKA|NOOP or provide an AuditSink bean.
```

This can be improved with validation or custom failure analyzer.

### 65.6 Avoid Surprising Production Behavior

Never activate these silently:

- scheduled jobs;
- outbound calls;
- data deletion;
- data migration;
- external publishing;
- security relaxation;
- expensive health check;
- global object mapper override.

---

## 66. Practice: Analyze an Auto-Configuration

When reading any Boot auto-configuration class, use this template.

```text
1. What capability does it provide?
2. What classpath condition activates it?
3. What property condition controls it?
4. What web application type does it target?
5. What beans does it create?
6. Which beans does it require?
7. Which user beans make it back off?
8. What ordering does it declare?
9. What optional integrations does it have?
10. What happens if multiple candidates exist?
11. What happens in test slices?
12. What failure message appears if config is invalid?
13. What is public API vs internal implementation?
14. What changes across Boot major versions?
```

This method turns “magic” into inspectable engineering.

---

## 67. Practice: Design Your Own Auto-Configuration

Design an internal starter:

```text
company-case-audit-spring-boot-starter
```

Requirement:

1. expose `CaseAuditService`;
2. support sink: log, database, kafka;
3. require explicit sink selection;
4. support correlation ID;
5. support tenant ID;
6. expose metrics if Micrometer exists;
7. expose health if Actuator exists;
8. support custom serializer;
9. support custom redaction policy;
10. never scan package;
11. test back-off;
12. test missing Kafka class;
13. test missing DataSource;
14. test property disabled;
15. test user-defined sink.

Expected design:

```text
CaseAuditCoreAutoConfiguration
CaseAuditLogSinkAutoConfiguration
CaseAuditJdbcSinkAutoConfiguration
CaseAuditKafkaSinkAutoConfiguration
CaseAuditMetricsAutoConfiguration
CaseAuditHealthAutoConfiguration
```

Expected extension points:

```text
CaseAuditSerializer
CaseAuditRedactionPolicy
CaseAuditSink
CaseAuditEventCustomizer
CaseAuditClientCustomizer
```

Expected properties:

```yaml
company:
  case-audit:
    enabled: true
    sink: JDBC
    tenant:
      required: true
    jdbc:
      table-name: CASE_AUDIT_TRAIL
    kafka:
      topic: case-audit-events
    metrics:
      enabled: true
```

---

## 68. Common Anti-Patterns

### 68.1 Auto-Configuration That Always Wins

```java
@Bean
MyService myService() {
    return new MyService();
}
```

No back-off. Bad for libraries.

### 68.2 Global Bean Hijacking

```java
@Bean
ObjectMapper objectMapper() {
    return new ObjectMapper();
}
```

Unless your starter owns global JSON policy, avoid.

### 68.3 Component Scan in Starter

```java
@ComponentScan("com.mycorp.platform")
```

Too broad.

### 68.4 Classpath-Only Dangerous Feature

```java
@ConditionalOnClass(KafkaTemplate.class)
@Bean
Publisher publisher(...) { ... }
```

Kafka presence alone should not imply business publishing.

### 68.5 No Tests for Missing Optional Dependency

Works on developer machine because all dependencies present. Fails in consumer app.

### 68.6 Overusing `@ConditionalOnExpression`

Hard to read, hard to test, hard to migrate.

### 68.7 Hidden Network Call During Bean Creation

```java
@Bean
AcmeClient acmeClient() {
    AcmeClient client = new AcmeClient();
    client.login();
    return client;
}
```

Dangerous unless explicitly intended. Prefer fail-fast validation only where appropriate and make behavior documented.

### 68.8 Starter Imports Production Driver Accidentally

A web starter should not accidentally bring DB driver or embedded DB.

### 68.9 Property Namespace Collision

```yaml
timeout: 5s
```

Bad. Use:

```yaml
company:
  acme:
    timeout: 5s
```

### 68.10 No Escape Hatch

A starter with no property disable, no bean override, and no customizer becomes a liability.

---

## 69. How to Debug Auto-Configuration Step by Step

When something weird happens:

```text
Step 1: Identify bean involved.
Step 2: Search which auto-config declares it.
Step 3: Enable condition report.
Step 4: Check positive/negative match.
Step 5: Inspect classpath dependency that triggered it.
Step 6: Inspect properties and profiles.
Step 7: Inspect user-defined beans that should make it back off.
Step 8: Check auto-config exclusions.
Step 9: Check ordering if bean condition depends on peer auto-config.
Step 10: Reproduce with ApplicationContextRunner.
```

Useful commands:

```bash
java -jar app.jar --debug
```

Maven dependency tree:

```bash
mvn dependency:tree
```

Gradle dependency insight:

```bash
./gradlew dependencyInsight --dependency spring-boot-starter-data-jpa
```

Inspect JAR:

```bash
jar tf some-starter.jar | grep AutoConfiguration.imports
```

---

## 70. What Top 1% Understanding Looks Like

A beginner says:

```text
Spring Boot magically configures things.
```

A competent engineer says:

```text
Spring Boot auto-configures based on classpath and properties.
```

A strong engineer says:

```text
Spring Boot imports auto-configuration classes from AutoConfiguration.imports, evaluates conditions, registers bean definitions, and backs off when user beans exist.
```

A top-tier engineer says:

```text
Auto-configuration is a conditional composition layer over the Spring container. It must be designed as a public compatibility contract: explicit activation, safe defaults, user override, extension points, property metadata, condition diagnostics, optional dependency isolation, AOT awareness, and focused tests with ApplicationContextRunner. Every dependency added to classpath is a potential runtime policy change.
```

That is the level we want.

---

## 71. Summary

Auto-configuration is not magic.

It is:

```text
conditional configuration import + bean definition registration + back-off semantics
```

The most important concepts:

1. `@SpringBootApplication` enables auto-configuration.
2. Auto-config classes are discovered from `AutoConfiguration.imports`.
3. Conditions decide whether class/bean definitions apply.
4. Classpath is an input to runtime behavior.
5. Properties are runtime policy.
6. User-defined beans should override auto-config defaults.
7. `@ConditionalOnMissingBean` is the core of non-invasive configuration.
8. Dangerous behavior should require explicit property activation.
9. Starters and auto-configurations are different things.
10. Auto-configuration should not use broad component scanning.
11. Capability-based auto-config is better than giant configuration classes.
12. Test auto-config with `ApplicationContextRunner`, not always full `@SpringBootTest`.
13. Condition report is the primary debugging artifact.
14. Internal starters must be treated as public platform products.
15. Boot 2/3/4 and Java 8/17/21/25 differences must be handled deliberately.

---

## 72. References

- Spring Boot Reference — Auto-configuration: `https://docs.spring.io/spring-boot/reference/using/auto-configuration.html`
- Spring Boot Reference — Creating Your Own Auto-configuration: `https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html`
- Spring Boot API — `@AutoConfiguration`: `https://docs.spring.io/spring-boot/api/java/org/springframework/boot/autoconfigure/AutoConfiguration.html`
- Spring Boot API — `@ConditionalOnClass`: `https://docs.spring.io/spring-boot/api/java/org/springframework/boot/autoconfigure/condition/ConditionalOnClass.html`
- Spring Boot API — `@ConditionalOnMissingBean`: `https://docs.spring.io/spring-boot/api/java/org/springframework/boot/autoconfigure/condition/ConditionalOnMissingBean.html`
- Spring Boot API — `ApplicationContextRunner`: `https://docs.spring.io/spring-boot/api/java/org/springframework/boot/test/context/runner/ApplicationContextRunner.html`

---

## 73. Status Seri

```text
Part saat ini : 7 dari 35
Status        : belum selesai
Berikutnya    : 08-application-startup-bootstrap-failure-diagnostics.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-environment-propertysource-profiles-config-binding.md">⬅️ Environment, PropertySource, Profiles, and Config Binding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./08-application-startup-bootstrap-failure-diagnostics.md">Part 8 — Application Startup, Bootstrap, Failure Analysis, and Diagnostics ➡️</a>
</div>
