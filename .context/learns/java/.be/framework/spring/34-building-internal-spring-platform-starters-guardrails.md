# Part 34 — Building Internal Spring Platform: Starters, Conventions, Guardrails

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `34-building-internal-spring-platform-starters-guardrails.md`  
> Target: Java 8–25, Spring Framework 5–7, Spring Boot 2–4  
> Fokus: internal platform engineering dengan Spring Boot starters, auto-configuration, conventions, guardrails, governance, compatibility, dan production-readiness.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 33, kita sudah mempelajari Spring dari beberapa lapisan:

1. container dan bean lifecycle,
2. dependency resolution,
3. configuration dan auto-configuration,
4. AOP/proxy,
5. transaction,
6. web/runtime/API,
7. security,
8. messaging,
9. batch,
10. observability,
11. testing,
12. modularity,
13. multi-tenancy,
14. native/AOT,
15. performance,
16. distributed system integration,
17. migration engineering.

Part ini mengubah semua pemahaman itu menjadi kemampuan yang lebih tinggi: **membangun internal Spring platform**.

Internal platform di sini bukan berarti membuat framework baru dari nol. Yang dimaksud adalah membuat lapisan reusable yang membuat banyak aplikasi Spring dalam organisasi berjalan dengan:

- konfigurasi konsisten,
- observability konsisten,
- security baseline konsisten,
- error response konsisten,
- HTTP client behavior konsisten,
- transaction/outbox/messaging behavior konsisten,
- test support konsisten,
- migration path lebih mudah,
- guardrail yang mencegah kesalahan berulang.

Kalau engineer biasa memakai Spring Boot starter publik, engineer platform membuat **starter internal** yang aman, documented, overrideable, testable, dan backward-compatible.

---

## 1. Problem yang Diselesaikan Internal Spring Platform

Tanpa internal platform, tiap service biasanya membuat keputusan sendiri-sendiri:

```text
service-a:
  timeout HTTP client 30s
  retry semua POST
  error response pakai {message: ...}
  log correlation manual
  actuator terbuka terlalu luas
  cache key tidak tenant-aware

service-b:
  timeout HTTP client 3s
  tidak ada retry
  error response pakai RFC 7807
  log correlation via filter
  actuator ditutup
  cache key tenant-aware

service-c:
  tidak ada timeout
  retry 5x tanpa backoff
  exception bocor ke client
  metric tag pakai userId
```

Secara lokal semua service tampak “jalan”. Tetapi secara organisasi terjadi masalah:

1. behavior berbeda antar service,
2. incident pattern berulang,
3. audit sulit,
4. migration lambat,
5. production debugging mahal,
6. onboarding engineer baru berat,
7. dependency upgrade kacau,
8. security baseline tidak konsisten,
9. observability tidak bisa dibandingkan,
10. platform team hanya menjadi “ticket solver”, bukan leverage multiplier.

Internal Spring platform mencoba mengubah pola tersebut menjadi:

```text
Application team:
  fokus ke domain dan use case.

Platform starter:
  menyediakan default yang benar, aman, observable, dan mudah dioverride.

Governance:
  menjaga compatibility, versioning, documentation, test coverage, dan deprecation policy.
```

---

## 2. Definisi Internal Spring Platform

Internal Spring platform adalah kumpulan library, starter, BOM, convention, test utilities, documentation, dan guardrail yang membuat aplikasi Spring mengikuti “golden path” organisasi.

Komponen umumnya:

```text
internal-platform/
├── platform-bom
├── platform-dependencies
├── platform-web-starter
├── platform-security-starter
├── platform-observability-starter
├── platform-http-client-starter
├── platform-error-starter
├── platform-audit-starter
├── platform-tenant-starter
├── platform-messaging-starter
├── platform-batch-starter
├── platform-cache-starter
├── platform-test-starter
├── platform-archunit-rules
├── platform-autoconfigure
├── platform-docs
└── platform-samples
```

Mental modelnya:

```text
public Spring Boot starter:
  solves generic ecosystem need.

internal Spring starter:
  solves repeated organizational decision.
```

Starter internal tidak seharusnya menjadi tempat menaruh semua helper class. Ia harus menjadi alat untuk mengikat keputusan arsitektural yang sudah disetujui.

---

## 3. Starter, Auto-Configuration, Library: Jangan Dicampur

Sebelum membuat platform, pisahkan tiga konsep ini.

### 3.1 Plain Library

Plain library menyediakan class dan API, tetapi tidak otomatis mendaftarkan bean.

Contoh:

```text
platform-error-core
  ProblemCode
  ProblemCatalog
  ErrorDescriptor
  ErrorClassifier
```

Library ini aman dipakai di aplikasi non-Spring.

### 3.2 Auto-Configuration Module

Auto-configuration module berisi logic pendaftaran bean otomatis berdasarkan classpath, property, dan kondisi.

Contoh:

```text
platform-error-autoconfigure
  PlatformErrorAutoConfiguration
  PlatformErrorProperties
  PlatformErrorWebMvcConfiguration
  PlatformErrorWebFluxConfiguration
```

Modul ini spesifik Spring Boot.

### 3.3 Starter Module

Starter module biasanya tidak berisi banyak kode. Ia mengumpulkan dependency agar application team cukup menambahkan satu dependency.

Contoh:

```text
platform-error-spring-boot-starter
  depends on platform-error-core
  depends on platform-error-autoconfigure
  depends on spring-boot-starter-web
```

Pemisahan yang sehat:

```text
core library        -> reusable, no Spring Boot magic
autoconfigure      -> conditional bean registration
starter            -> dependency aggregation
sample             -> executable reference
```

Anti-pattern:

```text
starter module berisi semua business logic + bean + util + config + test helper.
```

Kenapa buruk?

Karena sulit dites, sulit dimigrasi, sulit dipakai ulang, dan sulit menentukan dependency boundary.

---

## 4. Prinsip Utama Internal Starter yang Baik

Starter internal yang baik harus memiliki karakter berikut.

### 4.1 Opinionated, tetapi Tidak Otoriter

Starter boleh memberikan default kuat:

```yaml
platform:
  http-client:
    connect-timeout: 2s
    read-timeout: 5s
    retry:
      enabled: false
```

Tetapi application harus punya escape hatch:

```yaml
platform:
  http-client:
    clients:
      payment:
        read-timeout: 10s
        retry:
          enabled: true
          max-attempts: 3
```

Default itu penting. Tetapi default yang tidak bisa dioverride akan berubah menjadi platform lock-in.

### 4.2 Back-Off by Default

Auto-configuration internal harus mundur kalau application sudah menyediakan bean sendiri.

Contoh:

```java
@Bean
@ConditionalOnMissingBean
PlatformProblemHandler platformProblemHandler(...) {
    return new DefaultPlatformProblemHandler(...);
}
```

Maknanya:

```text
Kalau aplikasi belum punya handler, platform menyediakan default.
Kalau aplikasi punya handler eksplisit, platform tidak memaksa.
```

### 4.3 Explicit Activation untuk Behavior Berisiko

Tidak semua fitur boleh aktif otomatis hanya karena dependency ada.

Aman otomatis:

- correlation ID filter,
- metrics common tags,
- error response normalizer,
- health indicator dasar.

Harus explicit activation:

- retry outbound,
- cache write-through,
- authorization enforcement,
- tenant datasource routing,
- message consumer auto-start,
- scheduled job auto-registration,
- destructive migration.

Rule:

```text
Fitur observability boleh default-on.
Fitur yang mengubah side effect harus explicit-on.
```

### 4.4 Deterministic and Debuggable

Application team harus bisa menjawab:

1. auto-configuration mana yang aktif,
2. bean mana yang didaftarkan,
3. property mana yang dipakai,
4. default mana yang berasal dari platform,
5. cara menonaktifkan fitur,
6. cara override behavior.

Jika starter terasa “ajaib”, starter itu gagal sebagai platform engineering tool.

### 4.5 Minimal Surface Area

Semakin banyak API publik platform, semakin besar beban compatibility.

Bedakan:

```text
public API       -> dijanjikan stabil
internal API     -> tidak boleh dipakai aplikasi
experimental API -> boleh berubah, diberi label jelas
```

Gunakan package naming yang jelas:

```text
com.company.platform.error
com.company.platform.error.autoconfigure
com.company.platform.error.internal
com.company.platform.error.test
```

---

## 5. Version Matrix: Java 8–25 dan Spring 5–7

Karena seri ini mencakup Java 8 sampai 25, internal platform harus memahami generasi runtime.

### 5.1 Generasi Legacy

```text
Java             : 8 / 11
Spring Framework : 5.3.x
Spring Boot      : 2.7.x
Namespace        : javax.*
```

Ciri:

- masih banyak aplikasi enterprise lama,
- servlet/JPA/validation memakai `javax.*`,
- native/AOT bukan jalur utama,
- Spring Security lama mungkin masih berbasis konfigurasi adapter,
- observability belum seterstandar Boot 3/4.

### 5.2 Generasi Modern Spring 6 / Boot 3

```text
Java             : 17+
Spring Framework : 6.x
Spring Boot      : 3.x
Namespace        : jakarta.*
```

Ciri:

- Java 17 minimum,
- migrasi `javax.*` ke `jakarta.*`,
- Micrometer Observation lebih penting,
- native image/AOT menjadi first-class concern,
- virtual thread support mulai relevan.

### 5.3 Generasi Spring 7 / Boot 4

```text
Java             : 17 minimum, Java 25 modern LTS target
Spring Framework : 7.x
Spring Boot      : 4.x
Namespace        : Jakarta EE 11 baseline
```

Ciri:

- Spring Framework 7 tetap memiliki baseline JDK 17 dan merekomendasikan JDK 25 sebagai LTS terbaru,
- Spring Boot 4 menambahkan modularisasi codebase, JSpecify null-safety, support Java 25, API versioning, dan HTTP service clients,
- ekosistem Spring Cloud 2025.1/Oakwood diselaraskan dengan Spring Boot 4.

### 5.4 Implikasi untuk Platform Internal

Jangan memaksa satu starter mendukung semua era bila kompleksitasnya terlalu tinggi.

Lebih sehat:

```text
platform-spring-boot2-line
  Java 8/11, Boot 2.7, javax

platform-spring-boot3-line
  Java 17+, Boot 3.x, jakarta

platform-spring-boot4-line
  Java 17/21/25, Boot 4.x, Jakarta EE 11
```

Atau gunakan branch per major line:

```text
platform-1.x -> Boot 2.x
platform-2.x -> Boot 3.x
platform-3.x -> Boot 4.x
```

Rule yang penting:

```text
Jangan membuat compatibility matrix fiktif.
Kalau tidak dites di CI, jangan diklaim supported.
```

---

## 6. Struktur Repository Internal Platform

Ada dua pola umum.

### 6.1 Monorepo Platform

```text
company-spring-platform/
├── build.gradle.kts
├── platform-bom/
├── platform-dependencies/
├── platform-common/
├── platform-error-core/
├── platform-error-autoconfigure/
├── platform-error-spring-boot-starter/
├── platform-web-autoconfigure/
├── platform-web-spring-boot-starter/
├── platform-security-autoconfigure/
├── platform-security-spring-boot-starter/
├── platform-observability-autoconfigure/
├── platform-observability-spring-boot-starter/
├── platform-test-spring-boot-starter/
├── samples/
│   ├── servlet-app/
│   ├── webflux-app/
│   ├── messaging-app/
│   └── multitenant-app/
└── docs/
```

Kelebihan:

- dependency antar starter mudah dikelola,
- release atomic,
- BOM konsisten,
- integration test lintas module mudah.

Kekurangan:

- build bisa berat,
- ownership bisa kabur,
- release satu modul bisa memaksa release semua.

### 6.2 Multi-Repo Platform

```text
platform-error
platform-security
platform-observability
platform-http-client
platform-bom
platform-samples
```

Kelebihan:

- ownership jelas,
- release per domain,
- repository lebih kecil.

Kekurangan:

- dependency alignment lebih sulit,
- integration test lintas repo lebih kompleks,
- BOM menjadi sangat penting.

### 6.3 Rekomendasi Praktis

Untuk organisasi yang baru mulai, gunakan monorepo kecil:

```text
1 platform-bom
1 platform-common
3–5 starter prioritas
1 samples folder
1 docs folder
```

Jangan langsung membuat 20 starter. Mulai dari pain point paling berulang:

1. error response,
2. observability,
3. HTTP client,
4. security baseline,
5. test support.

---

## 7. BOM dan Dependency Governance

Internal platform hampir selalu membutuhkan BOM.

BOM menyelesaikan masalah:

```text
service-a pakai jackson versi X
service-b pakai jackson versi Y
service-c pakai micrometer versi Z
security patch tidak merata
starter internal konflik versi
```

### 7.1 Maven BOM Concept

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.company.platform</groupId>
      <artifactId>company-platform-bom</artifactId>
      <version>3.4.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Aplikasi kemudian bisa menulis dependency tanpa versi:

```xml
<dependency>
  <groupId>com.company.platform</groupId>
  <artifactId>company-platform-web-spring-boot-starter</artifactId>
</dependency>
```

### 7.2 Gradle Platform

```kotlin
dependencies {
    implementation(platform("com.company.platform:company-platform-bom:3.4.0"))
    implementation("com.company.platform:company-platform-web-spring-boot-starter")
}
```

### 7.3 Dependency Rules

Platform BOM harus menjawab:

1. versi Spring Boot yang didukung,
2. versi Spring Cloud yang kompatibel,
3. versi Jackson/Micrometer/Reactor/Kafka client,
4. versi test libraries,
5. versi plugin build,
6. CVE patch policy,
7. allowed override policy.

Jangan memasukkan semua dependency dunia ke BOM. BOM harus memuat dependency yang memang menjadi bagian dari golden path.

---

## 8. Anatomy of an Internal Starter

Contoh starter internal untuk error handling:

```text
platform-error-core/
  ProblemCode.java
  ProblemDescriptor.java
  ProblemCatalog.java
  ProblemClassifier.java

platform-error-autoconfigure/
  PlatformErrorAutoConfiguration.java
  PlatformErrorProperties.java
  PlatformProblemHandler.java
  PlatformErrorAttributes.java
  PlatformControllerAdvice.java
  META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports

platform-error-spring-boot-starter/
  pom.xml / build.gradle.kts
```

### 8.1 AutoConfiguration.imports

Di Spring Boot modern, auto-configuration didaftarkan melalui:

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Isi file:

```text
com.company.platform.error.autoconfigure.PlatformErrorAutoConfiguration
```

### 8.2 Auto-Configuration Class

```java
package com.company.platform.error.autoconfigure;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
@ConditionalOnClass(name = "org.springframework.web.servlet.DispatcherServlet")
@EnableConfigurationProperties(PlatformErrorProperties.class)
public class PlatformErrorAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    PlatformProblemHandler platformProblemHandler(
            PlatformErrorProperties properties,
            ProblemCatalog catalog
    ) {
        return new DefaultPlatformProblemHandler(properties, catalog);
    }

    @Bean
    @ConditionalOnMissingBean
    PlatformControllerAdvice platformControllerAdvice(
            PlatformProblemHandler handler
    ) {
        return new PlatformControllerAdvice(handler);
    }
}
```

### 8.3 Properties Contract

```java
@ConfigurationProperties(prefix = "company.platform.error")
public class PlatformErrorProperties {

    /**
     * Whether platform error handling is enabled.
     */
    private boolean enabled = true;

    /**
     * Whether stack trace information may be included in non-production responses.
     */
    private boolean includeStackTrace = false;

    /**
     * Whether internal exception class names may be included.
     */
    private boolean includeExceptionClass = false;

    // getters/setters or constructor binding depending on generation
}
```

Property naming harus stabil. Sekali dipakai banyak service, mengganti property menjadi migration event.

---

## 9. Conditional Auto-Configuration Design

Auto-configuration yang buruk biasanya terlalu agresif.

### 9.1 Class Condition

Gunakan saat fitur hanya relevan kalau class tertentu ada.

```java
@ConditionalOnClass(DispatcherServlet.class)
```

Untuk optional dependency, kadang lebih aman menggunakan `name` agar class tidak perlu diload:

```java
@ConditionalOnClass(name = "org.springframework.web.servlet.DispatcherServlet")
```

### 9.2 Bean Condition

Gunakan untuk back-off:

```java
@ConditionalOnMissingBean(PlatformProblemHandler.class)
```

Makna engineering:

```text
Platform menyediakan default hanya jika aplikasi tidak memberi keputusan eksplisit.
```

### 9.3 Property Condition

Gunakan untuk feature toggle:

```java
@ConditionalOnProperty(
    prefix = "company.platform.audit",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true
)
```

Hati-hati dengan `matchIfMissing = true`. Untuk fitur yang berdampak side effect, default-on bisa berbahaya.

### 9.4 Web Application Condition

Pisahkan servlet dan reactive:

```java
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
```

```java
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
```

Jangan menganggap MVC dan WebFlux sama.

### 9.5 Resource Condition

Bisa dipakai untuk optional behavior:

```java
@ConditionalOnResource(resources = "classpath:company-error-catalog.yml")
```

Tetapi jangan membuat behavior production bergantung pada resource yang sulit dilacak tanpa diagnostics.

---

## 10. Configuration Properties as Public API

Dalam internal platform, `@ConfigurationProperties` adalah API publik.

Contoh buruk:

```yaml
company:
  platform:
    feature:
      x: true
      y: 30
      z: abc
```

Tidak jelas:

- apa arti x,
- apa unit y,
- apakah z required,
- apakah bisa berubah runtime,
- apakah safe untuk production.

Contoh lebih baik:

```yaml
company:
  platform:
    http-client:
      default-connect-timeout: 2s
      default-response-timeout: 5s
      default-max-connections: 200
      clients:
        payment:
          base-url: https://payment.internal
          connect-timeout: 1s
          response-timeout: 3s
          retry:
            enabled: false
```

Rule:

```text
Property harus readable sebagai contract.
Jangan membuat property seperti internal variable name.
```

### 10.1 Metadata

Untuk starter yang matang, sediakan metadata agar IDE memberi autocomplete dan deskripsi.

Tambahkan dependency processor:

```kotlin
dependencies {
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")
}
```

Deskripsi property bukan kosmetik. Itu bagian dari platform UX.

---

## 11. Golden Path dan Escape Hatch

Internal platform harus punya golden path.

Golden path adalah:

```text
cara default yang direkomendasikan organisasi untuk membangun service.
```

Contoh golden path HTTP client:

```java
public interface PaymentClient {
    PaymentResponse getPayment(String paymentId);
}
```

Configuration:

```yaml
company:
  platform:
    http-client:
      clients:
        payment:
          base-url: https://payment.internal
          response-timeout: 3s
```

Application cukup inject:

```java
@Service
class PaymentApplicationService {
    private final PaymentClient paymentClient;

    PaymentApplicationService(PaymentClient paymentClient) {
        this.paymentClient = paymentClient;
    }
}
```

Namun harus ada escape hatch:

```java
@Bean
PaymentClient customPaymentClient(...) {
    return new CustomPaymentClient(...);
}
```

Atau property:

```yaml
company:
  platform:
    http-client:
      clients:
        payment:
          platform-managed: false
```

Tanpa escape hatch, platform menjadi hambatan delivery.

---

## 12. Guardrail vs Policy vs Convention

Ketiganya berbeda.

### 12.1 Convention

Convention adalah default yang disarankan.

Contoh:

```text
Semua API error memakai Problem Details.
```

### 12.2 Guardrail

Guardrail adalah pembatas yang mencegah kesalahan umum.

Contoh:

```text
Reject application startup jika HTTP client tidak punya timeout.
```

### 12.3 Policy

Policy adalah aturan organisasi yang wajib.

Contoh:

```text
Actuator env endpoint tidak boleh exposed di production.
```

Internal platform harus membedakan:

```text
Convention -> mudah dioverride.
Guardrail  -> bisa dioverride dengan explicit risk acceptance.
Policy     -> tidak boleh dioverride aplikasi biasa.
```

---

## 13. Startup Guardrail

Starter bisa melakukan validasi saat startup.

Contoh use case:

1. fail jika `management.endpoints.web.exposure.include=*` di production,
2. fail jika client punya base-url tetapi tidak punya timeout,
3. fail jika tenant mode enabled tetapi tenant resolver tidak ada,
4. fail jika audit enabled tetapi auditor provider tidak ada,
5. warn jika retry enabled untuk non-idempotent operation,
6. fail jika security disabled di non-local profile.

### 13.1 Implementasi via SmartInitializingSingleton

```java
final class PlatformStartupGuardrail implements SmartInitializingSingleton {

    private final PlatformEnvironment environment;
    private final HttpClientRegistry registry;

    PlatformStartupGuardrail(PlatformEnvironment environment,
                             HttpClientRegistry registry) {
        this.environment = environment;
        this.registry = registry;
    }

    @Override
    public void afterSingletonsInstantiated() {
        if (environment.isProduction()) {
            registry.clients().forEach(client -> {
                if (client.responseTimeout() == null) {
                    throw new PlatformMisconfigurationException(
                        "HTTP client '" + client.name() + "' has no response timeout"
                    );
                }
            });
        }
    }
}
```

### 13.2 Jangan Terlalu Banyak Fail-Fast

Fail-fast bagus untuk invariant yang objektif.

Buruk untuk preferensi subjektif.

Contoh buruk:

```text
Fail startup karena service tidak memakai package naming yang platform sukai.
```

Itu lebih cocok jadi lint/ArchUnit rule, bukan runtime failure.

---

## 14. Platform Error Starter

Ini salah satu starter pertama yang paling berguna.

### 14.1 Tujuan

Menstandarkan:

- exception taxonomy,
- HTTP status mapping,
- Problem Details shape,
- validation error format,
- correlation ID,
- safe message,
- error code,
- retryability marker,
- audit metadata.

### 14.2 Contract

Contoh response:

```json
{
  "type": "https://errors.company.com/case/CASE_NOT_FOUND",
  "title": "Case not found",
  "status": 404,
  "detail": "The requested case could not be found.",
  "code": "CASE_NOT_FOUND",
  "correlationId": "01JABC...",
  "retryable": false
}
```

### 14.3 Components

```text
ProblemCatalog
ProblemClassifier
PlatformControllerAdvice
PlatformErrorAttributes
ValidationProblemMapper
PersistenceProblemMapper
SecurityProblemMapper
```

### 14.4 Guardrails

- no stack trace in production response,
- no raw exception message for infrastructure exception,
- validation error path normalized,
- unknown exception becomes internal error with correlation ID,
- error code must exist in catalog for domain/application exception.

### 14.5 Escape Hatch

Application boleh override:

```java
@Bean
ProblemClassifier customProblemClassifier() {
    return new DomainProblemClassifier();
}
```

Tetapi starter tetap menjaga safe exposure.

---

## 15. Platform Observability Starter

### 15.1 Tujuan

Menstandarkan:

- correlation ID,
- trace ID propagation,
- MDC/log correlation,
- common metric tags,
- custom business metric conventions,
- health group,
- actuator exposure,
- sampling defaults,
- tag cardinality rules.

### 15.2 Components

```text
CorrelationIdFilter
CorrelationIdWebFilter
MdcTaskDecorator
ObservationConventionCustomizer
MeterRegistryCustomizer
PlatformHealthIndicator
ActuatorExposureGuardrail
```

### 15.3 Common Tags

Contoh:

```text
application
service
environment
region
zone
team
runtime
```

Hindari:

```text
userId
email
caseId
requestId
raw URL with ID
```

Karena tag high-cardinality akan merusak metrics backend.

### 15.4 Actuator Governance

Local:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus,env,configprops
```

Production:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
```

Guardrail:

```text
Fail startup jika env/configprops/heapdump/threaddump exposed tanpa profile aman.
```

---

## 16. Platform HTTP Client Starter

### 16.1 Tujuan

Menstandarkan outbound integration:

- base URL,
- timeout,
- connection pool,
- retry policy,
- circuit breaker,
- idempotency,
- error mapping,
- correlation propagation,
- metrics/tracing,
- OAuth2 token propagation,
- mTLS configuration boundary.

### 16.2 Contract

```yaml
company:
  platform:
    http-client:
      defaults:
        connect-timeout: 2s
        response-timeout: 5s
        max-connections: 200
      clients:
        onemap:
          base-url: https://www.onemap.gov.sg
          response-timeout: 3s
          retry:
            enabled: true
            max-attempts: 3
            backoff: 250ms
            retry-on-status: [429, 503]
```

### 16.3 Named Client Registry

```java
public interface PlatformHttpClientRegistry {
    RestClient restClient(String name);
    WebClient webClient(String name);
}
```

### 16.4 Guardrails

- no timeout -> fail,
- retry enabled for unsafe method -> warn/fail depending policy,
- base URL missing -> fail,
- unbounded max connections -> fail,
- no error mapper -> default safe mapper,
- correlation propagation always enabled.

### 16.5 Avoid External DTO Leakage

Starter should not encourage application to expose external DTO directly to domain.

Pattern:

```text
Controller -> Application Service -> Port -> Adapter -> External DTO
```

HTTP starter supports adapter, not domain coupling.

---

## 17. Platform Security Starter

### 17.1 Tujuan

Menstandarkan baseline security:

- default deny,
- actuator security,
- resource server config,
- authority mapping,
- CORS/CSRF defaults,
- security headers,
- method security activation,
- authentication principal abstraction,
- authorization audit hooks.

### 17.2 Jangan Terlalu Banyak Magic

Security starter adalah area paling berbahaya untuk hidden behavior.

Bad idea:

```text
starter diam-diam membuat /admin/** permitAll untuk health check.
```

Good idea:

```text
starter menyediakan utility untuk health endpoint policy,
tetapi endpoint sensitif tetap explicit.
```

### 17.3 Default Deny

```java
@Bean
SecurityFilterChain platformSecurityFilterChain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth
        .requestMatchers("/actuator/health", "/actuator/info").permitAll()
        .anyRequest().authenticated()
    );
    return http.build();
}
```

Namun hati-hati: jika starter membuat `SecurityFilterChain`, aplikasi mungkin sulit override.

Lebih fleksibel:

```text
sediakan SecurityConfigurer / Customizer
bukan selalu mendaftarkan full SecurityFilterChain
```

### 17.4 Authority Mapping

Buat contract:

```text
external token claim -> internal authority -> authorization rule
```

Jangan sebarkan parsing claim di semua service.

---

## 18. Platform Authorization Starter

Authorization sering lebih kompleks dari authentication.

Starter bisa menyediakan:

```text
CurrentUserProvider
PermissionService
AuthorizationDecisionAuditor
PolicyContext
TenantAwareAuthorizationManager
MethodSecurityExpressionHandler customization
```

Tetapi domain-specific permission jangan dikunci di platform generic.

Pemisahan sehat:

```text
platform-authorization-core:
  abstraction dan enforcement hooks

case-domain-authorization:
  policy actual untuk case lifecycle
```

### 18.1 Decision Record

Untuk sistem regulatory/case-management, authorization tidak cukup boolean.

Butuh:

```text
decision: granted/denied
reasonCode: CASE_ASSIGNED_TO_OTHER_OFFICER
policy: CASE_VIEW_POLICY
subject: user id / role / group
resource: case id / module
context: tenant / stage / sensitivity
```

Jangan selalu expose detail ke user, tetapi simpan untuk audit.

---

## 19. Platform Tenant Starter

### 19.1 Tujuan

Menstandarkan:

- tenant resolution,
- tenant context,
- propagation ke async/Reactor,
- tenant-aware cache key,
- datasource routing,
- tenant-aware audit,
- tenant-aware metrics tag dengan cardinality control,
- tenant header validation.

### 19.2 Components

```text
TenantId
TenantContext
TenantResolver
TenantContextFilter
TenantTaskDecorator
TenantAwareCacheKeyGenerator
TenantRoutingDataSource
TenantAuditContributor
```

### 19.3 Guardrails

- fail jika tenant-required endpoint tidak punya tenant,
- reject unknown tenant,
- no fallback tenant in production,
- cache key must include tenant for tenant-scoped data,
- async task must propagate tenant explicitly.

### 19.4 Risk

Tenant starter yang salah bisa menyebabkan data bleed antar tenant. Karena itu default harus conservative.

---

## 20. Platform Audit Starter

### 20.1 Tujuan

Audit starter bukan sekadar logging.

Ia harus membantu menjawab:

1. siapa melakukan apa,
2. pada resource mana,
3. kapan,
4. dari channel mana,
5. sebelum/sesudah status apa,
6. request/correlation id apa,
7. authorization decision apa,
8. apakah action berhasil atau gagal,
9. apakah action committed.

### 20.2 Transaction Boundary

Audit untuk perubahan data harus memperhatikan commit.

Bad:

```text
audit ditulis sebelum transaksi utama commit,
transaksi utama rollback,
audit tetap berkata action berhasil.
```

Better:

```text
publish audit event
handle AFTER_COMMIT
atau gunakan outbox audit
```

### 20.3 Starter Components

```text
AuditEvent
AuditPublisher
AuditContextContributor
AuditAspect
AuditOutboxWriter
AuditProperties
```

### 20.4 Guardrails

- no audit without actor,
- no success audit before commit,
- no PII in generic audit details unless classified,
- no raw request body stored blindly.

---

## 21. Platform Messaging Starter

### 21.1 Tujuan

Menstandarkan consumer/producer behavior:

- message envelope,
- correlation ID,
- tenant ID,
- idempotency key,
- retry policy,
- DLQ/DLT naming,
- error handler,
- observation tags,
- schema version,
- poison message handling.

### 21.2 Envelope

```json
{
  "messageId": "01J...",
  "type": "case.status.changed",
  "version": 1,
  "occurredAt": "2026-06-21T10:15:30Z",
  "correlationId": "01J...",
  "tenantId": "cea",
  "idempotencyKey": "case-123-status-approved-v4",
  "payload": {}
}
```

### 21.3 Guardrails

- no listener without error handler,
- no infinite retry,
- DLT configured for non-transient failure,
- idempotency required for side-effecting consumer,
- schema version required.

---

## 22. Platform Cache Starter

### 22.1 Tujuan

Menstandarkan:

- cache manager config,
- TTL convention,
- key naming,
- tenant-aware key generator,
- cache metrics,
- safe serialization,
- local vs distributed cache choice,
- cache invalidation pattern.

### 22.2 Key Pattern

```text
{service}:{tenant}:{cache-name}:{stable-key}
```

### 22.3 Guardrails

- tenant-scoped cache must include tenant,
- no caching authorization decision unless explicitly configured,
- no cache with unlimited TTL for mutable data,
- no caching raw JPA entity unless approved,
- key generator must be deterministic.

---

## 23. Platform Test Starter

Test starter sering paling cepat memberi leverage.

### 23.1 Isi

```text
BaseIntegrationTest
PlatformMockMvcAssertions
ProblemDetailsAssertions
SecurityTestSupport
TenantTestSupport
WireMock/Testcontainers setup
ApplicationContextRunner utilities
ClockTestConfiguration
FakeCurrentUserProvider
```

### 23.2 Tujuan

- semua service test error response dengan shape sama,
- semua service test security dengan helper sama,
- semua service test tenant propagation dengan helper sama,
- semua starter punya auto-configuration test yang konsisten,
- semua service punya standard integration test bootstrapping.

### 23.3 Hati-Hati

Jangan membuat base test class terlalu berat.

Bad:

```text
BaseIntegrationTest selalu start DB, Kafka, Redis, WireMock, full app.
```

Better:

```text
BaseWebMvcTest
BaseDataIntegrationTest
BaseMessagingIntegrationTest
BaseFullStackIntegrationTest
```

---

## 24. Customizer Pattern

Customizer pattern adalah cara platform memberi default tetapi tetap memberi aplikasi ruang intervensi.

Contoh:

```java
public interface PlatformRestClientCustomizer {
    void customize(String clientName, RestClient.Builder builder);
}
```

Auto-configuration:

```java
@Bean
RestClient paymentRestClient(
        PlatformHttpClientProperties properties,
        List<PlatformRestClientCustomizer> customizers
) {
    RestClient.Builder builder = RestClient.builder()
        .baseUrl(properties.client("payment").baseUrl());

    customizers.forEach(customizer -> customizer.customize("payment", builder));

    return builder.build();
}
```

Aplikasi:

```java
@Bean
PlatformRestClientCustomizer addPaymentHeader() {
    return (name, builder) -> {
        if (name.equals("payment")) {
            builder.defaultHeader("X-Client", "case-service");
        }
    };
}
```

Ini lebih sehat daripada memaksa aplikasi mengganti seluruh bean.

---

## 25. SPI Design for Internal Platform

SPI adalah extension point untuk application/domain team.

Contoh SPI:

```java
public interface CurrentUserProvider {
    CurrentUser currentUser();
}
```

```java
public interface TenantResolver {
    Optional<TenantId> resolve(HttpServletRequest request);
}
```

```java
public interface AuditContextContributor {
    void contribute(AuditContextBuilder builder);
}
```

SPI yang baik:

1. kecil,
2. stabil,
3. domain-neutral,
4. mudah dites,
5. tidak membocorkan internal platform,
6. memiliki default behavior jelas,
7. dokumentasi kapan dipanggil,
8. thread-safety requirement jelas.

SPI yang buruk:

```java
public interface PlatformExtension {
    Object execute(Object input, Map<String, Object> context);
}
```

Terlalu generic, sulit dipahami, dan sulit dijaga compatibility.

---

## 26. Internal API dan Public API

Package layout membantu governance.

```text
com.company.platform.error
  public API

com.company.platform.error.autoconfigure
  Spring Boot auto-config API, not usually used by app

com.company.platform.error.spi
  extension points

com.company.platform.error.internal
  implementation detail, not stable
```

Tambahkan aturan ArchUnit:

```text
Application code must not import ..platform..internal..
```

Bila perlu, gunakan Java module exports pada library modern. Tetapi untuk banyak codebase Spring, ArchUnit + convention lebih praktis.

---

## 27. Documentation as Product Surface

Internal platform tanpa dokumentasi akan menjadi tribal knowledge.

Minimal tiap starter punya:

```text
README.md
- purpose
- when to use
- when not to use
- dependency coordinates
- quick start
- properties table
- default behavior
- override points
- extension points
- production notes
- migration notes
- troubleshooting
```

Contoh property table:

| Property | Default | Required | Production Guidance |
|---|---:|---:|---|
| `company.platform.http-client.defaults.connect-timeout` | `2s` | yes | Jangan lebih dari 5s tanpa alasan |
| `company.platform.http-client.defaults.response-timeout` | `5s` | yes | Sesuaikan SLA upstream |
| `company.platform.http-client.clients.*.retry.enabled` | `false` | no | Aktifkan hanya untuk idempotent operation |

Dokumentasi adalah bagian dari API compatibility. Mengubah behavior tanpa update docs adalah breaking change secara operasional.

---

## 28. Sample Applications

Setiap platform matang perlu sample app.

```text
samples/
├── servlet-api-sample
├── webflux-api-sample
├── messaging-consumer-sample
├── batch-job-sample
├── multitenant-sample
├── security-resource-server-sample
└── native-image-sample
```

Sample app harus bisa dijalankan di CI.

Tujuannya:

1. membuktikan starter bekerja,
2. menjadi dokumentasi executable,
3. menangkap breaking change,
4. membantu onboarding.

Sample yang tidak pernah dijalankan akan membusuk.

---

## 29. Testing Auto-Configuration

Starter internal wajib punya test khusus auto-configuration.

Gunakan `ApplicationContextRunner` untuk menguji kombinasi property/classpath/bean.

Contoh:

```java
class PlatformErrorAutoConfigurationTest {

    private final ApplicationContextRunner contextRunner =
        new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(PlatformErrorAutoConfiguration.class));

    @Test
    void createsDefaultProblemHandlerWhenMissing() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(PlatformProblemHandler.class);
        });
    }

    @Test
    void backsOffWhenApplicationProvidesProblemHandler() {
        contextRunner
            .withBean(PlatformProblemHandler.class, CustomProblemHandler::new)
            .run(context -> {
                assertThat(context).hasSingleBean(PlatformProblemHandler.class);
                assertThat(context.getBean(PlatformProblemHandler.class))
                    .isInstanceOf(CustomProblemHandler.class);
            });
    }

    @Test
    void disabledWhenPropertyIsFalse() {
        contextRunner
            .withPropertyValues("company.platform.error.enabled=false")
            .run(context -> {
                assertThat(context).doesNotHaveBean(PlatformControllerAdvice.class);
            });
    }
}
```

Test matrix starter:

```text
default behavior
property disabled
override bean
missing optional class
servlet app
reactive app
non-web app
invalid config
native/AOT compatibility
```

---

## 30. Compatibility and Semantic Versioning

Internal starter harus punya versioning policy.

Contoh:

```text
MAJOR: breaking change, supported Boot major changes, property rename/removal
MINOR: new feature, backward-compatible property/bean addition
PATCH: bug fix, security fix, docs fix, default tweak yang tidak breaking
```

Namun hati-hati: di platform, perubahan default bisa breaking walau API Java tidak berubah.

Contoh:

```text
retry default false -> true
```

Secara Java compatible, tetapi secara production sangat breaking.

### 30.1 Breaking Change Types

1. Java API removed,
2. property renamed,
3. bean name changed,
4. default behavior changed,
5. actuator exposure changed,
6. error response shape changed,
7. security rule changed,
8. metric name/tag changed,
9. retry/timeout changed,
10. dependency major upgraded.

Semua harus masuk migration guide.

---

## 31. Deprecation Policy

Jangan menghapus tiba-tiba.

Policy sehat:

```text
Version N:
  introduce new property/API
  old property still works, warning logged

Version N+1:
  old property deprecated, migration warning stronger

Version N+2 major:
  old property removed
```

Untuk property, bisa bind dua property dan prioritaskan yang baru.

Contoh:

```yaml
company.platform.http.timeout: 5s          # deprecated
company.platform.http-client.response-timeout: 5s
```

Startup warning:

```text
Property 'company.platform.http.timeout' is deprecated and will be removed in platform 4.0. Use 'company.platform.http-client.response-timeout'.
```

---

## 32. Release Train

Internal platform sebaiknya punya release train yang selaras dengan Spring Boot.

Contoh:

```text
Company Platform 1.x -> Spring Boot 2.7.x
Company Platform 2.x -> Spring Boot 3.2/3.3
Company Platform 3.x -> Spring Boot 3.4/3.5
Company Platform 4.x -> Spring Boot 4.x
```

Jangan membuat aplikasi bertanya:

```text
Platform 2.8 ini cocok untuk Boot 3.2 atau 3.5?
```

Jawab dengan compatibility matrix eksplisit.

| Platform | Boot | Framework | Java | Namespace | Status |
|---|---|---|---|---|---|
| 1.x | 2.7.x | 5.3.x | 8/11/17 | `javax.*` | maintenance |
| 2.x | 3.2–3.5 | 6.x | 17/21 | `jakarta.*` | active |
| 3.x | 4.x | 7.x | 17/21/25 | Jakarta EE 11 | active/new |

---

## 33. Platform Governance Board, But Lightweight

Governance tidak harus birokratis.

Minimal ada:

1. owner tiap starter,
2. reviewer lintas aplikasi,
3. changelog,
4. compatibility matrix,
5. release cadence,
6. security patch process,
7. migration guide,
8. issue triage,
9. deprecation policy,
10. sample app CI.

Decision harus dicatat dalam ADR.

Contoh ADR:

```text
ADR-014: HTTP client retry default is disabled

Context:
  Several services retry POST calls and caused duplicate side effects.

Decision:
  Platform HTTP client starter disables retry by default.
  Retry must be enabled per named client and requires operation idempotency classification.

Consequences:
  Application teams must explicitly opt in.
  Some transient errors may surface faster.
  Platform provides Resilience4j customizer for approved clients.
```

---

## 34. Security and Compliance for Platform Starters

Starter internal bisa meningkatkan compliance, tetapi juga bisa menyebarkan vulnerability ke semua service.

### 34.1 Security Responsibilities

- dependency scanning,
- CVE response,
- secure defaults,
- secret redaction,
- actuator protection,
- TLS/mTLS support,
- safe logging,
- safe error exposure,
- security header baseline,
- authorization audit hooks.

### 34.2 Secret Handling

Jangan membuat starter membaca secret lalu log config penuh.

Bad:

```text
Loaded payment client config: username=abc password=secret
```

Better:

```text
Loaded payment client config: username=abc password=******
```

### 34.3 Production Guardrail

```text
If production profile is active:
  disable stacktrace in error response
  restrict actuator exposure
  require resource server/security chain
  require timeout on outbound client
  require secure cookie settings if session used
```

---

## 35. Observability Contract for Starters

Every starter should expose its own observability.

### 35.1 Metrics

HTTP starter:

```text
platform.http.client.requests
platform.http.client.retries
platform.http.client.failures
platform.http.client.timeout
```

Audit starter:

```text
platform.audit.events.published
platform.audit.events.failed
platform.audit.outbox.pending
```

Tenant starter:

```text
platform.tenant.resolution.success
platform.tenant.resolution.failure
```

### 35.2 Logs

Starter log harus:

- tidak noisy,
- memiliki event name,
- memasukkan correlation id jika ada,
- tidak membocorkan secret/PII,
- membedakan config warning vs runtime error.

### 35.3 Health Indicator

Starter yang bergantung pada external system boleh menyediakan health indicator.

Tetapi jangan semua dependency external otomatis masuk liveness. Banyak dependency harus masuk readiness atau custom health group, bukan membuat pod restart karena upstream down.

---

## 36. Native/AOT Compatibility for Internal Starters

Spring Boot 3/4 membuat AOT/native image relevan.

Starter internal harus sadar:

1. reflection perlu hints,
2. dynamic proxy perlu proxy hints,
3. resources perlu resource hints,
4. serialization perlu hints,
5. classpath scanning/dynamic classloading bisa bermasalah,
6. runtime-generated behavior harus dikurangi.

### 36.1 RuntimeHintsRegistrar

```java
class PlatformErrorRuntimeHints implements RuntimeHintsRegistrar {
    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.reflection().registerType(ProblemDescriptor.class,
            MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
            MemberCategory.INVOKE_PUBLIC_METHODS
        );
        hints.resources().registerPattern("company-errors/*.yml");
    }
}
```

Register:

```java
@ImportRuntimeHints(PlatformErrorRuntimeHints.class)
class PlatformErrorAutoConfiguration {
}
```

### 36.2 Test Native Compatibility

Minimal:

```text
JVM tests
AOT processing tests
native smoke sample app
```

Jangan klaim native-ready hanya karena code compile.

---

## 37. ArchUnit and Static Guardrails

Tidak semua guardrail harus runtime.

Gunakan static rule untuk:

- package boundary,
- no import internal package,
- no controller directly accessing repository,
- no service using `RestTemplate` directly if platform client required,
- no `@Transactional` on private method,
- no field injection,
- no domain module cycle,
- no `@Scheduled` without platform lock annotation.

Contoh rule konseptual:

```java
noClasses()
    .that().resideOutsideOfPackage("..platform..")
    .should().accessClassesThat().resideInAPackage("..platform..internal..");
```

Static guardrail lebih murah daripada menemukan masalah di production.

---

## 38. Build Plugin vs Starter

Kadang guardrail tidak cocok di runtime starter, tetapi cocok di build plugin.

Starter cocok untuk:

- bean default,
- runtime instrumentation,
- config binding,
- HTTP client factory,
- error handler,
- health indicator.

Build plugin cocok untuk:

- dependency ban,
- source compatibility,
- generated docs,
- OpenAPI validation,
- architecture lint,
- forbidden import,
- license check,
- build metadata.

Jangan memaksa starter melakukan semua hal.

---

## 39. Internal Platform Anti-Patterns

### 39.1 Hidden Behavior

```text
Menambahkan starter tiba-tiba membuat scheduled job berjalan.
```

Bahaya:

- side effect tidak disadari,
- production incident,
- aplikasi sulit memprediksi behavior.

### 39.2 Impossible Override

```java
@Bean
PlatformHandler handler() { ... }
```

Tanpa `@ConditionalOnMissingBean`.

Akibat:

- aplikasi tidak bisa mengganti behavior,
- harus exclude auto-config penuh,
- platform menjadi penghambat.

### 39.3 Business Logic in Platform

Platform generic tidak boleh tahu detail business domain.

Bad:

```text
platform-core contains CaseApprovalPolicy
```

Better:

```text
platform-core contains PolicyEvaluation abstractions
case-module contains CaseApprovalPolicy
```

### 39.4 Common Module Dumping Ground

```text
platform-common contains DateUtil, StringUtil, JsonUtil, CaseUtil, EmailUtil, SecurityUtil, DbUtil
```

Ini bukan platform, ini tempat sampah shared dependency.

### 39.5 Too Many Annotations

Membuat annotation internal untuk semuanya:

```java
@CompanyService
@CompanyTransactional
@CompanyAudited
@CompanyValidated
@CompanyLogged
@CompanySecured
```

Annotation bisa membantu, tetapi terlalu banyak annotation membuat behavior sulit dilacak.

### 39.6 Framework Inside Framework

Platform internal kadang berubah menjadi framework baru yang menyembunyikan Spring.

Bad:

```java
@CompanyApplication
class App {}
```

Semua Spring behavior disembunyikan.

Better:

```text
Gunakan Spring idiom.
Tambahkan convention seperlunya.
Jangan membuat engineer kehilangan kemampuan membaca aplikasi Spring standar.
```

---

## 40. Example: Building `company-platform-web-starter`

### 40.1 Goals

Starter ini menyediakan:

- correlation ID filter,
- standard error handler,
- request logging safe minimal,
- API version header support,
- common Jackson customization,
- actuator web guardrail.

### 40.2 Modules

```text
platform-web-core
platform-web-autoconfigure
platform-web-spring-boot-starter
```

### 40.3 Properties

```java
@ConfigurationProperties(prefix = "company.platform.web")
public class PlatformWebProperties {
    private Correlation correlation = new Correlation();
    private Error error = new Error();
    private ApiVersioning apiVersioning = new ApiVersioning();

    public static class Correlation {
        private boolean enabled = true;
        private String headerName = "X-Correlation-ID";
    }

    public static class Error {
        private boolean problemDetailsEnabled = true;
        private boolean includeStackTrace = false;
    }

    public static class ApiVersioning {
        private boolean enabled = false;
        private String headerName = "X-API-Version";
    }
}
```

### 40.4 Auto-Configuration

```java
@AutoConfiguration
@EnableConfigurationProperties(PlatformWebProperties.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class PlatformWebMvcAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    CorrelationIdFilter correlationIdFilter(PlatformWebProperties properties) {
        return new CorrelationIdFilter(properties.getCorrelation().getHeaderName());
    }

    @Bean
    @ConditionalOnMissingBean
    PlatformProblemDetailsAdvice platformProblemDetailsAdvice(
            PlatformWebProperties properties,
            ProblemClassifier classifier
    ) {
        return new PlatformProblemDetailsAdvice(properties, classifier);
    }
}
```

### 40.5 Imports

```text
com.company.platform.web.autoconfigure.PlatformWebMvcAutoConfiguration
```

### 40.6 Tests

```text
creates correlation filter by default
backs off with custom correlation filter
disables problem details when property false
fails production if stacktrace exposure enabled
works in servlet context only
not loaded in non-web context
```

---

## 41. Example: Building `company-platform-http-client-starter`

### 41.1 Properties

```yaml
company:
  platform:
    http-client:
      defaults:
        connect-timeout: 2s
        response-timeout: 5s
        max-connections: 200
      clients:
        address-service:
          base-url: https://address.internal
          response-timeout: 3s
```

### 41.2 Interface

```java
public interface PlatformHttpClients {
    RestClient restClient(String name);
    WebClient webClient(String name);
}
```

### 41.3 Guardrail

```java
final class HttpClientConfigurationValidator {
    void validate(PlatformHttpClientProperties properties) {
        properties.getClients().forEach((name, client) -> {
            if (client.getBaseUrl() == null) {
                throw new PlatformMisconfigurationException(
                    "HTTP client '" + name + "' must define base-url"
                );
            }
            if (client.effectiveResponseTimeout(properties) == null) {
                throw new PlatformMisconfigurationException(
                    "HTTP client '" + name + "' must define response-timeout"
                );
            }
        });
    }
}
```

### 41.4 Design Warning

Jangan membuat semua client otomatis dari interface scanning tanpa aturan jelas. Itu bisa menjadi magic yang sulit dilacak.

Lebih baik mulai dari registry + explicit named clients. Setelah mature, baru tambah HTTP interface support.

---

## 42. Example: Building `company-platform-test-starter`

### 42.1 Problem Details Assertion

```java
public final class ProblemAssertions {

    public static void assertProblemCode(String responseBody, String expectedCode) {
        // parse JSON and assert $.code
    }
}
```

### 42.2 Security Test Support

```java
public final class PlatformSecurityTestUsers {

    public static RequestPostProcessor officer(String userId) {
        return jwt().jwt(jwt -> jwt
            .subject(userId)
            .claim("roles", List.of("OFFICER"))
        );
    }
}
```

### 42.3 Tenant Test Support

```java
public final class TenantTestSupport {
    public static RequestPostProcessor tenant(String tenantId) {
        return request -> {
            request.addHeader("X-Tenant-ID", tenantId);
            return request;
        };
    }
}
```

### 42.4 Benefit

Application tests menjadi seragam:

```java
mockMvc.perform(get("/cases/123")
        .with(officer("u123"))
        .with(tenant("cea")))
    .andExpect(status().isOk());
```

---

## 43. Platform Adoption Strategy

Jangan paksa semua aplikasi migrasi sekaligus.

### 43.1 Adoption Levels

```text
Level 0: no platform
Level 1: BOM only
Level 2: observability + error starter
Level 3: HTTP client + security starter
Level 4: messaging/cache/audit/tenant starter
Level 5: full golden path + architecture rules
```

### 43.2 Migration Plan

1. inventory service,
2. pilih 2–3 pilot service,
3. apply BOM,
4. apply observability starter,
5. apply error starter,
6. ukur behavior berubah atau tidak,
7. dokumentasikan migration issue,
8. rilis starter patch,
9. scale adoption.

### 43.3 Jangan Menjadikan Platform Sebagai Big Bang

Platform harus membuktikan value secara incremental.

Kalau adoption membutuhkan rewrite besar, platform akan ditolak secara natural.

---

## 44. Operational Support Model

Platform team harus menyediakan:

1. issue template,
2. compatibility matrix,
3. troubleshooting guide,
4. sample app,
5. release notes,
6. migration guide,
7. Slack/Teams support channel,
8. office hour,
9. changelog with risk level,
10. known issues.

Contoh release note:

```text
company-platform 3.5.2

Type: PATCH
Compatible Boot: 3.5.x
Risk: LOW

Changes:
- Fix correlation ID propagation for @Async executor.
- Add metric platform.http.client.timeout.count.
- Deprecate company.platform.web.error.include-exception.

Migration:
- No application change required.

Known issues:
- WebFlux correlation propagation requires Reactor context bridge enabled.
```

---

## 45. Platform Review Checklist

Sebelum membuat starter baru, jawab:

```text
1. Problem ini terjadi berulang di minimal beberapa service?
2. Apakah problem ini benar-benar platform concern, bukan domain concern?
3. Apakah starter memberi default aman?
4. Apakah aplikasi bisa override?
5. Apakah property contract jelas?
6. Apakah auto-config back off jika bean disediakan aplikasi?
7. Apakah fitur side-effect explicit opt-in?
8. Apakah test mencakup default, override, disabled, invalid config?
9. Apakah ada sample app?
10. Apakah ada documentation dan migration guide?
11. Apakah metrics/logging/health tersedia?
12. Apakah aman untuk production?
13. Apakah native/AOT impact dipahami?
14. Apakah dependency version controlled via BOM?
15. Apakah ada owner?
```

Jika banyak jawaban “belum”, jangan rilis starter sebagai stable.

---

## 46. Decision Framework: Kapan Membuat Starter?

Gunakan matrix:

| Kondisi | Buat Starter? | Alasan |
|---|---:|---|
| Dipakai 1 service saja | Tidak dulu | mungkin domain-specific |
| Dipakai 3+ service dengan pola sama | Ya kandidat | repeated platform concern |
| Butuh default config + dependency | Ya | starter cocok |
| Hanya helper function kecil | Tidak | plain library cukup |
| Butuh build-time validation | Mungkin tidak | build plugin/ArchUnit lebih cocok |
| Mengubah side effect production | Hati-hati | explicit activation wajib |
| Security baseline organisasi | Ya | platform leverage tinggi |
| Business approval policy | Tidak generic | taruh di domain module |

---

## 47. Mental Model: Platform as Constraint Compiler

Internal platform yang baik seperti compiler untuk keputusan organisasi.

Input:

```text
architecture decision
security policy
observability convention
failure model
operational runbook
```

Dikompilasi menjadi:

```text
starter
BOM
auto-configuration
properties
guardrails
tests
sample app
documentation
```

Tujuannya bukan membuat engineer tidak berpikir. Tujuannya adalah membuat engineer tidak perlu memikirkan ulang hal yang sudah menjadi keputusan bersama.

---

## 48. Failure Model Internal Platform

Platform sendiri bisa menjadi sumber incident.

### 48.1 Platform Bug Amplification

Bug di satu starter bisa menyebar ke 50 service.

Mitigasi:

- canary service,
- sample app CI,
- staged rollout,
- feature flags,
- backward compatibility,
- clear rollback.

### 48.2 Hidden Coupling

Service bergantung pada behavior internal yang tidak terdokumentasi.

Mitigasi:

- package internal,
- ArchUnit forbidden imports,
- public API documentation,
- deprecation warning.

### 48.3 Over-Standardization

Platform memaksa semua aplikasi sama, padahal kebutuhan berbeda.

Mitigasi:

- extension points,
- escape hatch,
- documented override,
- domain-specific starter terpisah.

### 48.4 Dependency Lock

Platform menahan upgrade karena dependency terlalu banyak.

Mitigasi:

- BOM minimal,
- optional dependencies,
- separate starters,
- version matrix.

### 48.5 Silent Behavior Change

Patch release mengubah default.

Mitigasi:

- semantic versioning serius,
- risk label release note,
- compatibility tests,
- migration guide.

---

## 49. Practical Roadmap untuk Membangun Platform Internal

### Phase 1 — Foundation

```text
platform-bom
platform-common minimal
platform-error-starter
platform-observability-starter
platform-test-starter
sample servlet app
```

### Phase 2 — Integration Consistency

```text
platform-http-client-starter
platform-security-starter
platform-cache-starter
sample resource server app
sample external API client app
```

### Phase 3 — Enterprise Runtime

```text
platform-audit-starter
platform-tenant-starter
platform-messaging-starter
platform-batch-starter
```

### Phase 4 — Governance

```text
ArchUnit rules
build plugin checks
OpenAPI validation
dependency policy
migration dashboard
```

### Phase 5 — Advanced Runtime

```text
AOT/native compatibility
virtual-thread profiles
Spring Boot 4 platform line
Spring Cloud alignment
multi-region conventions
```

---

## 50. Top 1% Engineering Lens

Menguasai Spring bukan hanya tahu annotation. Pada level platform, Anda harus bisa menjawab:

```text
Apa default yang aman?
Apa yang harus explicit?
Apa yang boleh dioverride?
Apa yang tidak boleh dioverride?
Bagaimana application team tahu behavior aktif?
Bagaimana starter back off?
Bagaimana config divalidasi?
Bagaimana behavior dites?
Bagaimana starter dimigrasi?
Bagaimana failure starter tidak menyebar massal?
Bagaimana security dan observability menjadi default organisasi?
Bagaimana platform memberi leverage tanpa menjadi bottleneck?
```

Engineer yang kuat membuat satu service bekerja.

Engineer yang lebih kuat membuat banyak service bekerja dengan standar yang konsisten.

Engineer platform yang sangat kuat membuat **jalan yang benar menjadi jalan paling mudah**, tanpa menghilangkan kebebasan engineering saat memang dibutuhkan.

---

## 51. Ringkasan

Part ini membahas bagaimana membangun internal Spring platform yang matang:

1. pisahkan core library, auto-configuration, dan starter,
2. gunakan BOM untuk dependency governance,
3. desain auto-configuration dengan condition dan back-off,
4. jadikan configuration properties sebagai API publik,
5. sediakan golden path dan escape hatch,
6. bedakan convention, guardrail, dan policy,
7. mulai dari starter bernilai tinggi: error, observability, HTTP client, security, test,
8. sediakan SPI kecil dan stabil,
9. dokumentasikan property, default, override, dan migration,
10. test auto-configuration dengan `ApplicationContextRunner`,
11. jaga semantic versioning dan deprecation policy,
12. sediakan sample app dan CI,
13. pertimbangkan native/AOT,
14. gunakan ArchUnit/build plugin untuk static guardrail,
15. hindari hidden behavior, impossible override, business logic di platform, dan common module dumping ground.

Internal platform bukan tentang membuat Spring terlihat lebih keren. Internal platform adalah cara mengubah pengalaman production, incident, audit, security, dan migration menjadi reusable engineering leverage.

---

## 52. Status Seri

```text
Part saat ini : 34 dari 35
Status        : belum selesai
Berikutnya    : 35-capstone-production-grade-spring-system-end-to-end.md
Sisa          : 1 part terakhir
```

Part berikutnya adalah capstone. Di sana semua konsep dari Part 0 sampai Part 34 akan digabungkan menjadi desain sistem Spring production-grade end-to-end.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./33-migration-engineering-spring5-6-7-boot2-3-4.md">⬅️ Part 33 — Migration Engineering: Spring 5 → 6 → 7, Boot 2 → 3 → 4</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./35-capstone-production-grade-spring-system-end-to-end.md">Part 35 — Capstone: Designing a Production-Grade Spring System End-to-End ➡️</a>
</div>
