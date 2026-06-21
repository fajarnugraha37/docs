# 06 — Environment, PropertySource, Profiles, and Config Binding

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `06` dari `35`  
> Topik: Spring configuration runtime, property source ordering, profiles, externalized configuration, type-safe binding, validation, secret boundary, and production failure model  
> Target: Java 8 sampai Java 25, Spring Framework 5.x sampai 7.x, Spring Boot 2.x sampai 4.x  
> Status seri: **belum selesai**

---

## 0. Mengapa Part Ini Penting?

Banyak engineer menganggap konfigurasi Spring hanya sekadar:

```yaml
server:
  port: 8080
```

atau:

```java
@Value("${app.timeout}")
private Duration timeout;
```

Padahal dalam production system, konfigurasi adalah **runtime input** yang menentukan:

- aplikasi connect ke database mana;
- profile mana yang aktif;
- credential mana yang dipakai;
- feature mana yang menyala;
- timeout outbound service;
- jumlah thread pool;
- rate limit;
- policy security;
- endpoint mana yang diekspos;
- migration script mana yang berjalan;
- tenant mana yang diproses;
- observability mana yang aktif;
- dan kadang, apakah aplikasi aman untuk hidup di production atau tidak.

Spring memiliki configuration model yang sangat powerful, tetapi juga mudah menjadi sumber incident kalau tidak dipahami secara deterministik.

Part ini membahas Spring configuration bukan sebagai “cara menaruh property”, tetapi sebagai **configuration resolution engine**.

Mental model utama:

```text
Configuration bukan data statis.
Configuration adalah input runtime yang masuk ke container sebelum bean graph final dibentuk.
```

Artinya:

```text
Salah konfigurasi = salah object graph = salah behavior production.
```

---

## 1. Core Mental Model

Spring configuration runtime dapat dipahami sebagai beberapa lapisan:

```text
External input
    ↓
PropertySource
    ↓
Environment
    ↓
Property resolution
    ↓
Condition evaluation
    ↓
Bean definition activation
    ↓
Configuration binding
    ↓
Bean creation
    ↓
Runtime behavior
```

Jika divisualisasikan:

```text
+---------------------------------------------------------------+
|                    External Configuration                      |
|---------------------------------------------------------------|
| CLI args | Env vars | JVM props | YAML | properties | secrets  |
+----------------------------+----------------------------------+
                             |
                             v
+---------------------------------------------------------------+
|                       PropertySource                           |
|---------------------------------------------------------------|
| named source of key/value pairs                                |
+----------------------------+----------------------------------+
                             |
                             v
+---------------------------------------------------------------+
|                         Environment                            |
|---------------------------------------------------------------|
| resolves properties + tracks active/default profiles           |
+----------------------------+----------------------------------+
                             |
                             v
+---------------------------------------------------------------+
|         Conditions / Profiles / ConfigurationProperties         |
|---------------------------------------------------------------|
| decides which beans exist and how they are configured           |
+----------------------------+----------------------------------+
                             |
                             v
+---------------------------------------------------------------+
|                         ApplicationContext                     |
|---------------------------------------------------------------|
| final bean graph + runtime behavior                            |
+---------------------------------------------------------------+
```

Spring Framework mendefinisikan `Environment` sebagai abstraksi yang berhubungan dengan dua hal utama:

1. property resolution;
2. profile resolution.

`PropertySource` adalah abstraksi sumber key-value. `StandardEnvironment` secara default memiliki property source untuk JVM system properties dan OS environment variables. Referensi resmi Spring menjelaskan bahwa `PropertySource` adalah abstraksi atas sumber pasangan key-value, sementara `Environment` menyediakan service interface untuk menyelesaikan property dari berbagai sumber.

Spring Boot memperluas ini dengan externalized configuration agar code yang sama bisa berjalan di environment berbeda dengan konfigurasi berbeda.

---

## 2. Problem yang Sebenarnya Diselesaikan oleh Configuration Layer

Configuration layer menjawab pertanyaan berikut:

```text
Untuk runtime ini, di environment ini, dengan deployment input ini,
bean mana yang harus hidup, value apa yang harus dipakai,
dan behavior apa yang harus aktif?
```

Contoh sederhana:

```yaml
payment:
  enabled: true
  timeout: 3s
  provider: stripe
```

Dari sini Spring bisa menentukan:

- apakah `PaymentClient` dibuat;
- apakah timeout outbound payment 3 detik;
- provider mana yang dipilih;
- apakah bean fallback digunakan;
- apakah auto-configuration tertentu aktif;
- apakah health indicator payment hidup;
- apakah test profile mengganti provider dengan fake implementation.

Masalahnya: konfigurasi datang dari banyak tempat.

Contoh:

```text
application.yml
application-prod.yml
environment variable
command-line argument
Kubernetes ConfigMap
Kubernetes Secret
JVM system property
test property
dynamic property
```

Jika dua sumber mendefinisikan key yang sama:

```text
app.payment.timeout=3s
app.payment.timeout=10s
```

maka pertanyaan critical-nya bukan “mana yang benar?”, tetapi:

```text
Sumber mana yang menang menurut resolution order?
```

Top-tier Spring engineer harus bisa menjawab itu.

---

## 3. Vocabulary Penting

### 3.1 `Environment`

`Environment` adalah interface Spring untuk:

- membaca property;
- mengetahui active profiles;
- mengetahui default profiles;
- melakukan property resolution.

Contoh:

```java
@Component
public class RuntimeInfo {
    private final Environment environment;

    public RuntimeInfo(Environment environment) {
        this.environment = environment;
    }

    public String databaseUrl() {
        return environment.getRequiredProperty("app.datasource.url");
    }

    public boolean isProduction() {
        return Arrays.asList(environment.getActiveProfiles()).contains("prod");
    }
}
```

Tetapi untuk application code biasa, membaca `Environment` langsung sering bukan pilihan terbaik. Ia lebih cocok untuk:

- infrastructure code;
- auto-configuration;
- conditional registration;
- platform starter;
- diagnostics;
- migration tool;
- framework extension.

Untuk business/service code, lebih baik gunakan type-safe config:

```java
@ConfigurationProperties(prefix = "app.payment")
public record PaymentProperties(
        boolean enabled,
        Duration timeout,
        URI baseUrl
) {}
```

---

### 3.2 `PropertySource`

`PropertySource` adalah sumber bernama dari key-value.

Contoh konseptual:

```text
PropertySource("systemProperties")
  java.version=25
  user.timezone=Asia/Jakarta

PropertySource("systemEnvironment")
  APP_PAYMENT_TIMEOUT=5s
  SPRING_PROFILES_ACTIVE=prod

PropertySource("applicationConfig: classpath:/application.yml")
  app.payment.timeout=3s
```

Spring tidak peduli apakah sumbernya:

- file properties;
- YAML;
- Map;
- system properties;
- environment variable;
- servlet context;
- config server;
- Vault;
- Kubernetes;
- test annotation;
- dynamic property.

Selama bisa direpresentasikan sebagai key-value, ia bisa masuk ke `Environment`.

---

### 3.3 `MutablePropertySources`

`ConfigurableEnvironment` memiliki `MutablePropertySources`.

Artinya property sources bisa:

- ditambah;
- dihapus;
- dipindah urutannya;
- dimasukkan sebelum source lain;
- dimasukkan setelah source lain.

Contoh infrastructure-level:

```java
public class CustomEnvironmentInitializer
        implements ApplicationContextInitializer<ConfigurableApplicationContext> {

    @Override
    public void initialize(ConfigurableApplicationContext context) {
        ConfigurableEnvironment env = context.getEnvironment();

        Map<String, Object> values = Map.of(
                "app.platform.region", "ap-southeast-1",
                "app.platform.runtime", "kubernetes"
        );

        env.getPropertySources().addFirst(
                new MapPropertySource("platformDefaults", values)
        );
    }
}
```

`addFirst` berarti property ini punya prioritas tinggi.

Ini powerful, tetapi berbahaya kalau tidak terdokumentasi karena bisa membuat konfigurasi “menang diam-diam”.

---

### 3.4 Placeholder

Placeholder adalah ekspresi seperti:

```text
${app.name}
${app.timeout:5s}
```

Contoh:

```yaml
app:
  name: aceas
  display-name: "${app.name}-service"
  timeout: "${APP_TIMEOUT:5s}"
```

Format:

```text
${key}
${key:defaultValue}
```

Risiko:

```yaml
app:
  dangerous-default-url: "${PAYMENT_URL:http://localhost:8080}"
```

Di dev mungkin nyaman. Di prod, default seperti ini bisa berbahaya jika environment variable lupa diset.

---

### 3.5 Profile

Profile adalah label environment condition untuk mengaktifkan subset konfigurasi/bean.

Contoh:

```java
@Configuration
@Profile("prod")
class ProductionPaymentConfig {
}
```

Atau:

```yaml
spring:
  config:
    activate:
      on-profile: prod
```

Spring Boot menyatakan bahwa `spring.profiles.active` mengikuti ordering rule property biasa: property source dengan prioritas tertinggi menang.

---

### 3.6 Config Binding

Config binding adalah proses mengubah property string menjadi object Java.

Dari:

```yaml
app:
  client:
    base-url: https://api.example.com
    timeout: 3s
    max-connections: 50
```

Menjadi:

```java
@ConfigurationProperties(prefix = "app.client")
public record ClientProperties(
        URI baseUrl,
        Duration timeout,
        int maxConnections
) {}
```

Inilah perbedaan besar antara `@Value` dan `@ConfigurationProperties`.

`@Value` mengambil satu value.

`@ConfigurationProperties` memodelkan satu configuration contract.

---

## 4. Spring Framework vs Spring Boot dalam Configuration

Spring Framework menyediakan core abstraction:

- `Environment`;
- `PropertySource`;
- `@PropertySource`;
- profiles;
- placeholder resolution;
- `@Value`;
- type conversion infrastructure.

Spring Boot menambahkan:

- externalized configuration conventions;
- `application.properties`;
- `application.yml`;
- config data API;
- relaxed binding;
- `@ConfigurationProperties`;
- metadata generation;
- validation;
- profile-specific config files;
- test property utilities;
- integration dengan Actuator configprops/env endpoint;
- auto-configuration condition model yang sangat bergantung pada property.

Dengan kata lain:

```text
Spring Framework memberi mesin dasarnya.
Spring Boot memberi operational convention-nya.
```

---

## 5. Property Resolution Order: Mengapa “Yang Terakhir Saya Tulis” Belum Tentu Menang

Spring Boot memiliki urutan property source yang menentukan value final. Detail urutan bisa berubah antar versi, tetapi mental modelnya tetap:

```text
Higher priority PropertySource wins.
```

Sumber umum yang biasanya terlibat:

```text
1. Default properties
2. @PropertySource
3. Config data: application.properties / application.yml
4. Profile-specific config data
5. Environment variables
6. JVM system properties
7. Command-line arguments
8. Test-specific property sources
```

Jangan hafalkan secara buta. Untuk production, biasakan membuktikan dengan:

- condition evaluation report;
- `/actuator/env`;
- `/actuator/configprops`;
- startup logs;
- explicit diagnostic bean;
- test using `ApplicationContextRunner`.

Spring Boot official docs menyatakan externalized configuration dapat berasal dari berbagai sumber seperti properties file, YAML, environment variables, dan command-line arguments.

### 5.1 Contoh Shadowing

`application.yml`:

```yaml
app:
  timeout: 3s
```

Environment variable:

```bash
APP_TIMEOUT=10s
```

Command-line:

```bash
java -jar app.jar --app.timeout=1s
```

Value final bisa menjadi:

```text
1s
```

karena command-line argument biasanya memiliki prioritas tinggi.

### 5.2 Risiko Shadowing

Shadowing terjadi ketika key yang sama muncul di beberapa source.

Contoh incident:

```text
application-prod.yml:
  app.payment.enabled: true

Kubernetes ConfigMap:
  APP_PAYMENT_ENABLED=false
```

Aplikasi hidup, tetapi payment tidak aktif.

Problem bukan di code. Problem ada di **configuration precedence**.

### 5.3 Rule Praktis

Untuk konfigurasi critical:

```text
Jangan hanya tahu value final.
Ketahui juga sumber value final.
```

Itulah alasan `/actuator/env` sangat berguna, tetapi harus diamankan karena bisa mengekspos informasi sensitif.

---

## 6. `@Value`: Kapan Boleh, Kapan Jangan

`@Value` digunakan untuk inject property tunggal.

Contoh:

```java
@Component
public class BuildInfoPrinter {
    private final String applicationName;

    public BuildInfoPrinter(@Value("${spring.application.name}") String applicationName) {
        this.applicationName = applicationName;
    }
}
```

Spring Framework mendokumentasikan `@Value` sebagai mekanisme umum untuk inject externalized property.

### 6.1 Masalah `@Value`

Untuk config serius, `@Value` punya banyak kelemahan:

```java
@Service
public class PaymentClient {
    public PaymentClient(
            @Value("${payment.base-url}") String baseUrl,
            @Value("${payment.timeout}") Duration timeout,
            @Value("${payment.retry}") int retry,
            @Value("${payment.enabled}") boolean enabled
    ) {
    }
}
```

Masalah:

- config tersebar;
- tidak ada object contract;
- sulit divalidasi sebagai group;
- sulit didokumentasi;
- sulit dites;
- sulit dicari;
- raw string key tersebar;
- refactor raw key berisiko;
- default value bisa tersembunyi;
- tidak ada metadata IDE yang baik.

### 6.2 Kapan `@Value` Masih Masuk Akal?

Gunakan `@Value` untuk:

- simple infrastructure injection;
- property tunggal yang tidak membentuk domain config;
- legacy code;
- contoh kecil;
- quick diagnostic;
- migration transitional state.

Jangan gunakan `@Value` untuk:

- client config;
- database-like config;
- security policy;
- tenant config;
- feature flag serius;
- external integration;
- thread pool sizing;
- retry/timeout config;
- cache config;
- anything business-critical.

---

## 7. `@ConfigurationProperties`: Configuration sebagai Contract

`@ConfigurationProperties` adalah model preferred untuk konfigurasi kompleks.

Contoh:

```yaml
app:
  payment:
    enabled: true
    base-url: https://payment.example.com
    timeout: 3s
    retry:
      max-attempts: 3
      backoff: 250ms
```

Java record:

```java
@ConfigurationProperties(prefix = "app.payment")
public record PaymentProperties(
        boolean enabled,
        URI baseUrl,
        Duration timeout,
        Retry retry
) {
    public record Retry(
            int maxAttempts,
            Duration backoff
    ) {}
}
```

Registration:

```java
@ConfigurationPropertiesScan
@SpringBootApplication
public class PaymentApplication {
}
```

atau explicit:

```java
@EnableConfigurationProperties(PaymentProperties.class)
@Configuration
class PaymentConfiguration {
}
```

### 7.1 Kenapa Ini Lebih Baik?

Karena config menjadi object dengan invariant.

```text
Raw properties:
  app.payment.timeout=3s
  app.payment.retry.max-attempts=3

Bound object:
  PaymentProperties(timeout=3s, retry=maxAttempts=3)
```

Object ini bisa:

- divalidasi;
- dites;
- didokumentasi;
- diberi metadata;
- diberi default secara eksplisit;
- dipakai sebagai dependency biasa.

### 7.2 Binding Bukan Sekadar Mapping

Binding melibatkan:

- property name normalization;
- type conversion;
- nested object creation;
- collection binding;
- map binding;
- validation;
- error reporting.

Contoh relaxed binding:

```text
app.payment.base-url
app.payment.baseUrl
APP_PAYMENT_BASE_URL
app.payment.base_url
```

Spring Boot dapat mengikat variasi nama tersebut ke field `baseUrl`.

---

## 8. Immutable Configuration

Di Java modern, konfigurasi sebaiknya immutable.

### 8.1 Record-Based Config

```java
@ConfigurationProperties(prefix = "app.storage")
public record StorageProperties(
        URI endpoint,
        String bucket,
        Duration connectionTimeout,
        Duration readTimeout
) {}
```

Keuntungan:

- field final secara natural;
- constructor jelas;
- representasi compact;
- cocok untuk Java 16+;
- sangat cocok Java 17–25.

### 8.2 Class-Based Immutable Config untuk Java 8/11

Untuk Java 8, tidak ada record. Gunakan constructor final fields.

```java
@ConfigurationProperties(prefix = "app.storage")
public class StorageProperties {
    private final URI endpoint;
    private final String bucket;
    private final Duration connectionTimeout;
    private final Duration readTimeout;

    public StorageProperties(
            URI endpoint,
            String bucket,
            Duration connectionTimeout,
            Duration readTimeout
    ) {
        this.endpoint = endpoint;
        this.bucket = bucket;
        this.connectionTimeout = connectionTimeout;
        this.readTimeout = readTimeout;
    }

    public URI getEndpoint() {
        return endpoint;
    }

    public String getBucket() {
        return bucket;
    }

    public Duration getConnectionTimeout() {
        return connectionTimeout;
    }

    public Duration getReadTimeout() {
        return readTimeout;
    }
}
```

Untuk Spring Boot lama, constructor binding kadang membutuhkan annotation eksplisit tergantung versi.

### 8.3 Mutable Config: Kapan Masih Ada?

Mutable config class:

```java
@ConfigurationProperties(prefix = "app.mail")
public class MailProperties {
    private String host;
    private int port;

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }
}
```

Masih umum di:

- legacy Boot 1/2;
- config yang butuh JavaBean convention;
- library lama;
- framework integration.

Tetapi untuk modern code, prefer immutable.

---

## 9. Validation: Fail Fast Before Wrong Runtime

Config tanpa validasi berarti aplikasi bisa hidup dengan state rusak.

Contoh:

```java
@Validated
@ConfigurationProperties(prefix = "app.client")
public record ClientProperties(
        @NotNull URI baseUrl,
        @NotNull Duration timeout,
        @Min(1) int maxConnections
) {}
```

Jika `baseUrl` hilang atau `maxConnections=0`, startup gagal.

Itu bagus.

Lebih baik gagal saat startup daripada gagal saat request production pertama.

### 9.1 Validasi Nested Config

```java
@Validated
@ConfigurationProperties(prefix = "app.payment")
public record PaymentProperties(
        boolean enabled,
        @Valid Retry retry
) {
    public record Retry(
            @Min(1) int maxAttempts,
            @NotNull Duration backoff
    ) {}
}
```

### 9.2 Conditional Validation

Kadang config hanya wajib jika feature aktif.

Contoh:

```java
@Validated
@ConfigurationProperties(prefix = "app.payment")
public record PaymentProperties(
        boolean enabled,
        URI baseUrl,
        Duration timeout
) {
    @AssertTrue(message = "baseUrl and timeout are required when payment is enabled")
    public boolean isValidWhenEnabled() {
        if (!enabled) {
            return true;
        }
        return baseUrl != null && timeout != null;
    }
}
```

### 9.3 Invariant Lebih Kuat dari Annotation

Untuk invariant kompleks, gunakan constructor.

```java
@ConfigurationProperties(prefix = "app.worker")
public record WorkerProperties(
        int coreThreads,
        int maxThreads,
        int queueCapacity
) {
    public WorkerProperties {
        if (coreThreads <= 0) {
            throw new IllegalArgumentException("coreThreads must be positive");
        }
        if (maxThreads < coreThreads) {
            throw new IllegalArgumentException("maxThreads must be >= coreThreads");
        }
        if (queueCapacity < 0) {
            throw new IllegalArgumentException("queueCapacity must not be negative");
        }
    }
}
```

Ini bukan sekadar validation. Ini domain invariant untuk runtime config.

---

## 10. Profiles: Powerful, Tetapi Sering Disalahgunakan

Profile adalah cara mengaktifkan konfigurasi tertentu.

Contoh:

```java
@Configuration
@Profile("dev")
class DevDatabaseConfig {
}
```

```java
@Configuration
@Profile("prod")
class ProdDatabaseConfig {
}
```

Masalahnya: banyak codebase memakai profile sebagai “environment programming language”.

Contoh buruk:

```text
dev
sit
uat
preprod
prod
prod-sg
prod-id
prod-client-a
prod-client-b
uat-client-a
uat-client-b
uat-with-mock-payment
uat-with-real-payment
```

Akhirnya profile menjadi combinatorial explosion.

### 10.1 Profile yang Baik

Profile cocok untuk perbedaan besar environment:

```text
local
test
dev
prod
```

Atau activation khusus:

```text
mock-external
real-external
migration
load-test
```

Tetapi jangan pakai profile untuk semua variasi kecil.

Untuk variasi kecil, gunakan property.

Buruk:

```java
@Profile("payment-stripe")
@Bean
PaymentClient stripeClient() { ... }

@Profile("payment-adyen")
@Bean
PaymentClient adyenClient() { ... }
```

Lebih baik:

```yaml
app:
  payment:
    provider: stripe
```

Lalu conditional:

```java
@Bean
@ConditionalOnProperty(name = "app.payment.provider", havingValue = "stripe")
PaymentClient stripeClient() {
    return new StripePaymentClient();
}
```

### 10.2 Profile Expression

Spring mendukung expression seperti:

```java
@Profile("prod & !test")
```

Gunakan hati-hati. Semakin kompleks expression, semakin sulit reasoning.

### 10.3 Default Profile

Jika tidak ada active profile, Spring memakai default profile.

Default profile bisa berguna, tetapi berbahaya jika default-nya terlalu “real”.

Contoh buruk:

```yaml
spring:
  profiles:
    default: prod
```

Lebih aman:

```yaml
spring:
  profiles:
    default: local
```

Atau lebih strict:

```text
Production deployment harus explicit set SPRING_PROFILES_ACTIVE=prod.
```

---

## 11. Config Data API

Spring Boot modern memakai Config Data API untuk memproses config file dan import external config.

Contoh:

```yaml
spring:
  config:
    import:
      - optional:file:/etc/myapp/application.yml
      - optional:configtree:/etc/secrets/
```

Config Data API membuat external config loading lebih formal daripada pendekatan lama seperti `spring.config.location` saja.

Mental model:

```text
Config data diproses sangat awal,
sebelum ApplicationContext final dibuat,
karena config menentukan bean mana yang akan dibuat.
```

### 11.1 `spring.config.import`

Contoh use case:

```yaml
spring:
  config:
    import: optional:file:/opt/company/platform-defaults.yml
```

Dengan ini, aplikasi dapat import config tambahan.

### 11.2 `optional:`

Tanpa `optional:`, missing config bisa membuat startup gagal.

```yaml
spring:
  config:
    import: file:/etc/myapp/required.yml
```

Jika file hilang, fail fast.

Dengan optional:

```yaml
spring:
  config:
    import: optional:file:/etc/myapp/local-overrides.yml
```

File boleh tidak ada.

### 11.3 Config Tree

Kubernetes secret sering dipasang sebagai file per key.

Struktur:

```text
/etc/secrets/
  username
  password
```

Config tree dapat membaca directory sebagai property source.

Konseptual:

```yaml
spring:
  config:
    import: configtree:/etc/secrets/
```

Maka file dapat menjadi property.

Ini berguna untuk secrets, tetapi tetap perlu governance agar tidak bocor ke actuator/log.

---

## 12. Environment Variables and Relaxed Binding

Environment variable sering digunakan di containerized deployment.

Contoh YAML key:

```yaml
app:
  payment:
    base-url: https://payment.example.com
```

Equivalent env var:

```bash
APP_PAYMENT_BASE_URL=https://payment.example.com
```

Spring Boot relaxed binding membantu mapping:

```text
app.payment.base-url
APP_PAYMENT_BASE_URL
app.payment.baseUrl
```

Tetapi relaxed binding juga punya risiko:

```text
Dua nama yang terlihat berbeda bisa resolve ke property yang sama.
```

Rule:

```text
Gunakan satu naming convention resmi untuk deployment.
```

Rekomendasi:

```text
Untuk Kubernetes env var:
  APP_PAYMENT_BASE_URL
  APP_PAYMENT_TIMEOUT
  APP_PAYMENT_RETRY_MAX_ATTEMPTS
```

Untuk YAML:

```yaml
app:
  payment:
    base-url: ...
    timeout: ...
    retry:
      max-attempts: ...
```

---

## 13. YAML vs Properties

### 13.1 YAML

Kelebihan:

- lebih readable untuk nested config;
- cocok untuk object tree;
- less repetition;
- umum di Spring Boot.

Contoh:

```yaml
app:
  client:
    base-url: https://api.example.com
    timeout: 3s
    retry:
      max-attempts: 3
      backoff: 250ms
```

### 13.2 Properties

Kelebihan:

- flat;
- explicit;
- mudah override per key;
- cocok untuk environment yang tidak suka nested structure.

Contoh:

```properties
app.client.base-url=https://api.example.com
app.client.timeout=3s
app.client.retry.max-attempts=3
app.client.retry.backoff=250ms
```

### 13.3 Rule

Untuk app config utama, YAML nyaman.

Untuk generated/override/configmap kecil, properties kadang lebih aman.

Untuk secret, jangan simpan plaintext di repo.

---

## 14. Secret Boundary

Secret bukan config biasa.

Secret meliputi:

- password database;
- API key;
- OAuth client secret;
- private key;
- signing key;
- encryption key;
- token;
- webhook secret;
- SFTP credential.

### 14.1 Prinsip

```text
Secret boleh masuk ke runtime.
Secret tidak boleh masuk ke source code, logs, metrics, error response, actuator publik, atau test fixture sembarangan.
```

### 14.2 Jangan

Jangan:

```yaml
app:
  external:
    api-key: abc123
```

di repository.

Jangan log:

```java
log.info("Loaded config: {}", properties);
```

Jika `properties` punya secret, bocor.

Jangan expose `/actuator/env` ke publik.

Jangan include secret di exception message.

### 14.3 Sanitization

Spring Boot Actuator memiliki sanitization untuk endpoint tertentu, tetapi jangan menganggap itu cukup untuk semua use case.

Rule praktis:

```text
Property class yang berisi secret tidak boleh punya toString() yang membocorkan value.
```

Record secara default punya `toString()` yang menampilkan semua field.

Ini berbahaya:

```java
@ConfigurationProperties(prefix = "app.oauth")
public record OAuthProperties(
        String clientId,
        String clientSecret
) {}
```

`OAuthProperties.toString()` akan menampilkan `clientSecret`.

Alternatif:

```java
@ConfigurationProperties(prefix = "app.oauth")
public final class OAuthProperties {
    private final String clientId;
    private final String clientSecret;

    public OAuthProperties(String clientId, String clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    public String clientId() {
        return clientId;
    }

    public String clientSecret() {
        return clientSecret;
    }

    @Override
    public String toString() {
        return "OAuthProperties{clientId='%s', clientSecret='***'}".formatted(clientId);
    }
}
```

Atau pisahkan secret ke object yang tidak pernah dicetak.

---

## 15. Dynamic Refresh: Kapan Berguna, Kapan Berbahaya

Beberapa sistem memakai dynamic config refresh.

Contoh:

- Spring Cloud Config refresh;
- Kubernetes mounted config update;
- feature flag service;
- custom dynamic property store.

Dynamic refresh menggoda karena bisa mengubah behavior tanpa redeploy.

Tetapi untuk banyak config, refresh runtime berbahaya.

### 15.1 Config yang Relatif Aman untuk Dynamic Change

Lebih aman:

- feature flag non-critical;
- logging level;
- UI text;
- rate limit threshold tertentu;
- maintenance banner;
- rollout percentage;
- non-transactional behavior.

### 15.2 Config yang Sebaiknya Immutable Selama Process Hidup

Sebaiknya tidak di-refresh sembarangan:

- datasource URL;
- database credential;
- transaction isolation;
- cache provider;
- security issuer;
- signing key;
- thread pool core sizing;
- server port;
- tenant isolation mode;
- schema strategy;
- encryption key;
- object graph condition.

Alasannya:

```text
Banyak config menentukan bean graph.
Jika diubah setelah bean graph hidup, runtime bisa berada di state setengah lama setengah baru.
```

### 15.3 Rule

```text
Jika perubahan config membutuhkan perubahan bean graph,
lebih aman restart process daripada dynamic refresh.
```

---

## 16. Feature Flag vs Spring Profile vs Property

Jangan campur tiga konsep ini.

### 16.1 Spring Profile

Untuk environment-level activation.

Contoh:

```text
local
test
prod
```

### 16.2 Property

Untuk runtime setting.

Contoh:

```yaml
app:
  payment:
    timeout: 3s
```

### 16.3 Feature Flag

Untuk controlled rollout behavior.

Contoh:

```yaml
features:
  new-case-routing: true
```

Atau via flag service:

```text
new-case-routing enabled for 10% users
```

### 16.4 Decision Matrix

| Kebutuhan | Gunakan |
|---|---|
| Aktifkan config khusus production | Profile |
| Set timeout outbound service | Property |
| Pilih provider payment | Property atau conditional property |
| Rollout fitur ke sebagian user | Feature flag |
| Matikan fitur cepat saat incident | Feature flag atau operational property |
| Ganti datasource | Immutable property + restart |
| Ganti bean implementation saat startup | Conditional property/profile |
| Ganti behavior runtime per request | Feature flag |

---

## 17. Conditional Configuration dengan Property

Dalam Spring Boot, property sering menentukan bean mana yang aktif.

Contoh:

```java
@Configuration
@EnableConfigurationProperties(PaymentProperties.class)
class PaymentAutoConfiguration {

    @Bean
    @ConditionalOnProperty(
            name = "app.payment.enabled",
            havingValue = "true",
            matchIfMissing = false
    )
    PaymentClient paymentClient(PaymentProperties properties) {
        return new HttpPaymentClient(properties.baseUrl(), properties.timeout());
    }
}
```

Mental model:

```text
Property tidak hanya mengisi value.
Property bisa menentukan keberadaan bean.
```

Ini membuat property menjadi bagian dari object graph construction.

### 17.1 Risiko `matchIfMissing = true`

Contoh:

```java
@ConditionalOnProperty(
        name = "app.external.enabled",
        havingValue = "true",
        matchIfMissing = true
)
```

Artinya jika property tidak diset, external integration aktif.

Ini sering berbahaya.

Rule:

```text
Untuk integration berisiko, default harus off kecuali eksplisit on.
```

---

## 18. ConfigurationProperties Metadata

Spring Boot dapat menghasilkan metadata untuk IDE auto-completion.

Biasanya dengan dependency annotation processor.

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

Manfaat:

- autocomplete property;
- deskripsi property;
- deprecation warning;
- tipe property;
- default value documentation.

Untuk internal platform starter, metadata sangat penting.

Tanpa metadata, user starter akan menebak-nebak property.

---

## 19. Designing Configuration Properties for Large Codebases

### 19.1 Good Config Object

Contoh:

```java
@Validated
@ConfigurationProperties(prefix = "platform.audit")
public record AuditProperties(
        boolean enabled,
        Mode mode,
        Retention retention,
        Publisher publisher
) {
    public enum Mode {
        SYNC,
        ASYNC,
        OUTBOX
    }

    public record Retention(
            @Min(1) int days
    ) {}

    public record Publisher(
            @NotNull Duration timeout,
            @Min(1) int maxAttempts
    ) {}
}
```

Karakteristik baik:

- prefix jelas;
- nested sesuai domain;
- tipe kuat;
- enum untuk pilihan terbatas;
- duration bukan long milliseconds;
- validation ada;
- default eksplisit;
- tidak leak secret;
- tidak terlalu flat;
- tidak terlalu deep.

### 19.2 Bad Config Object

```java
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String a;
    private String b;
    private String c;
    private String mode;
    private String timeout;
    private String flag1;
    private String flag2;
}
```

Masalah:

- prefix terlalu umum;
- nama tidak domain-specific;
- semua string;
- tidak ada validation;
- tidak ada semantic grouping;
- sulit maintain.

### 19.3 Prefix Strategy

Gunakan prefix domain:

```text
app.payment
app.audit
app.case-routing
platform.security
platform.tenant
integration.onemap
integration.singpass
```

Hindari:

```text
config
settings
common
misc
global
```

Prefix buruk menjadi tempat sampah.

---

## 20. Default Values: Convenience vs Hidden Risk

Default value bisa diberikan di beberapa tempat.

### 20.1 Default di YAML

```yaml
app:
  client:
    timeout: 3s
```

### 20.2 Default di Constructor

```java
@ConfigurationProperties(prefix = "app.client")
public record ClientProperties(
        Duration timeout
) {
    public ClientProperties {
        if (timeout == null) {
            timeout = Duration.ofSeconds(3);
        }
    }
}
```

### 20.3 Default di `@Value`

```java
@Value("${app.client.timeout:3s}")
Duration timeout;
```

### 20.4 Rule

Default yang aman:

- local-only convenience;
- non-sensitive;
- non-production-critical;
- documented.

Default yang berbahaya:

- production URL;
- credential;
- security flag;
- destructive job enabled;
- migration enabled;
- external integration enabled;
- “allow all” authorization;
- long timeout causing thread exhaustion.

Example bad default:

```java
@Value("${app.security.enabled:false}")
boolean securityEnabled;
```

Jika property hilang, security mati.

Untuk security, lebih baik fail fast.

---

## 21. Config as Public Contract

Dalam large organization, config adalah public API internal.

Jika Anda membuat internal starter:

```yaml
platform:
  audit:
    enabled: true
    mode: outbox
```

Maka property tersebut menjadi contract.

Mengubah nama property adalah breaking change.

### 21.1 Deprecating Property

Gunakan metadata deprecation.

Conceptual metadata:

```json
{
  "properties": [
    {
      "name": "platform.audit.mode",
      "type": "java.lang.String",
      "description": "Audit publication mode.",
      "deprecation": {
        "reason": "Use platform.audit.publisher.mode instead.",
        "replacement": "platform.audit.publisher.mode"
      }
    }
  ]
}
```

### 21.2 Backward Compatibility

Untuk platform starter, sediakan migration period:

```text
v1:
  platform.audit.mode

v2:
  platform.audit.publisher.mode
  platform.audit.mode deprecated but still read

v3:
  platform.audit.mode removed
```

### 21.3 Binding Old and New Property

Anda bisa support alias secara manual:

```java
@ConfigurationProperties(prefix = "platform.audit")
public record AuditProperties(
        String mode,
        Publisher publisher
) {
    public String effectiveMode() {
        if (publisher != null && publisher.mode() != null) {
            return publisher.mode();
        }
        return mode;
    }

    public record Publisher(String mode) {}
}
```

Tapi dokumentasikan dengan jelas.

---

## 22. Testing Configuration

Configuration harus dites seperti code.

### 22.1 Test Binding

```java
class ClientPropertiesBindingTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(TestConfig.class)
            .withPropertyValues(
                    "app.client.base-url=https://api.example.com",
                    "app.client.timeout=3s",
                    "app.client.max-connections=20"
            );

    @Test
    void bindsClientProperties() {
        runner.run(context -> {
            ClientProperties properties = context.getBean(ClientProperties.class);

            assertThat(properties.baseUrl()).isEqualTo(URI.create("https://api.example.com"));
            assertThat(properties.timeout()).isEqualTo(Duration.ofSeconds(3));
            assertThat(properties.maxConnections()).isEqualTo(20);
        });
    }

    @Configuration
    @EnableConfigurationProperties(ClientProperties.class)
    static class TestConfig {
    }
}
```

### 22.2 Test Missing Required Property

```java
@Test
void failsWhenBaseUrlMissing() {
    new ApplicationContextRunner()
            .withUserConfiguration(TestConfig.class)
            .withPropertyValues(
                    "app.client.timeout=3s",
                    "app.client.max-connections=20"
            )
            .run(context -> {
                assertThat(context).hasFailed();
            });
}
```

### 22.3 Test Conditional Bean

```java
@Test
void createsPaymentClientWhenEnabled() {
    new ApplicationContextRunner()
            .withUserConfiguration(PaymentAutoConfiguration.class)
            .withPropertyValues(
                    "app.payment.enabled=true",
                    "app.payment.base-url=https://payment.example.com",
                    "app.payment.timeout=3s"
            )
            .run(context -> {
                assertThat(context).hasSingleBean(PaymentClient.class);
            });
}

@Test
void doesNotCreatePaymentClientWhenDisabled() {
    new ApplicationContextRunner()
            .withUserConfiguration(PaymentAutoConfiguration.class)
            .withPropertyValues("app.payment.enabled=false")
            .run(context -> {
                assertThat(context).doesNotHaveBean(PaymentClient.class);
            });
}
```

Configuration tests are cheap and prevent production surprises.

---

## 23. Operational Diagnostics

### 23.1 `/actuator/env`

Shows environment properties and sources.

Useful for answering:

```text
What is the effective value?
Where did it come from?
```

But dangerous if exposed.

### 23.2 `/actuator/configprops`

Shows bound `@ConfigurationProperties`.

Useful for answering:

```text
What did Spring bind into my config object?
```

### 23.3 Condition Evaluation Report

Useful for answering:

```text
Why did this auto-configuration activate?
Why did this bean not exist?
```

Run with debug:

```bash
java -jar app.jar --debug
```

Or configure logging.

### 23.4 Startup Diagnostic Bean

For internal platform, sometimes create safe diagnostic output:

```java
@Component
class SafeConfigDiagnostics implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(SafeConfigDiagnostics.class);

    private final PaymentProperties payment;

    SafeConfigDiagnostics(PaymentProperties payment) {
        this.payment = payment;
    }

    @Override
    public void run(ApplicationArguments args) {
        log.info("Payment integration enabled={}, timeout={}",
                payment.enabled(),
                payment.timeout());
    }
}
```

Never log secret.

---

## 24. Config Failure Model

### 24.1 Missing Required Property

Symptom:

```text
Failed to bind properties under 'app.client'
```

Cause:

```text
Required value absent.
```

Resolution:

- add property;
- add safe default;
- change validation;
- disable feature if optional.

### 24.2 Wrong Type

Example:

```yaml
app:
  timeout: abc
```

Expected:

```java
Duration timeout
```

Failure:

```text
Cannot convert value 'abc' to Duration
```

Resolution:

```yaml
app:
  timeout: 3s
```

### 24.3 Wrong Unit

Bad:

```yaml
app:
  timeout: 3000
```

Depending on target type/default unit, this may mean milliseconds or may be invalid.

Better:

```yaml
app:
  timeout: 3s
```

Use explicit units.

### 24.4 Wrong Profile

Symptom:

```text
App points to dev database in UAT.
```

Cause:

```text
SPRING_PROFILES_ACTIVE not set or overridden.
```

Resolution:

- make profile explicit;
- fail fast if prod-like env has no profile;
- log active profile safely;
- deployment validation.

### 24.5 Property Shadowing

Symptom:

```text
YAML says enabled=true but runtime disabled.
```

Cause:

```text
Higher-priority source overrides it.
```

Resolution:

- inspect property sources;
- `/actuator/env`;
- remove duplicate;
- establish ownership.

### 24.6 Secret Leakage

Symptom:

```text
API key appears in logs.
```

Cause:

- config object `toString()`;
- actuator exposed;
- exception includes secret;
- debug log prints environment.

Resolution:

- sanitize;
- never log secret object;
- secure actuator;
- custom `toString()`;
- separate secret properties.

### 24.7 Conditional Bean Surprise

Symptom:

```text
Bean missing only in production.
```

Cause:

- `@ConditionalOnProperty`;
- profile mismatch;
- classpath condition;
- missing config;
- property typo.

Resolution:

- condition report;
- explicit test for prod-like config;
- metadata;
- fail fast.

### 24.8 Config Drift

Symptom:

```text
DEV/UAT/PROD behavior differs unexpectedly.
```

Cause:

- manual config changes;
- undocumented env var;
- configmap drift;
- stale secret;
- profile-specific override mismatch.

Resolution:

- config inventory;
- GitOps;
- generated config diff;
- environment contract tests.

---

## 25. Environment-Specific Configuration Strategy

A clean enterprise strategy:

```text
application.yml
  common defaults safe for all environments

application-local.yml
  local developer config

application-test.yml
  test config

application-dev.yml
  dev environment config

application-uat.yml
  UAT config

application-prod.yml
  production-safe config, but no secret
```

Secrets come from:

```text
Kubernetes Secret
AWS SSM Parameter Store
AWS Secrets Manager
Vault
mounted secret file
environment variable injected by platform
```

### 25.1 Common Rule

`application.yml` should contain:

- safe defaults;
- shared non-secret config;
- documentation-like structure;
- disabled-by-default risky integration.

It should not contain:

- production password;
- production token;
- production private endpoint if sensitive;
- destructive job enabled by default;
- real payment provider enabled by default.

---

## 26. Config Ownership Model

In large systems, each property should have an owner.

Example table:

| Prefix | Owner | Purpose | Change Risk |
|---|---|---|---|
| `app.case-routing` | Case module team | routing behavior | high |
| `platform.audit` | Platform team | audit publication | high |
| `integration.onemap` | Integration team | OneMap API client | medium |
| `management.endpoint` | Ops/platform | actuator exposure | high |
| `spring.datasource` | Infra/app team | database connection | critical |

Without ownership, config becomes shared mutable global state.

---

## 27. Configuration Review Checklist

Before approving config design, ask:

```text
1. Is this config actually needed?
2. Is it startup-time or runtime-changeable?
3. Is the prefix domain-specific?
4. Is the type strong enough?
5. Are units explicit?
6. Are defaults safe?
7. Are required values validated?
8. Are secrets separated?
9. Can this config be logged safely?
10. Is the property documented?
11. Is metadata generated?
12. Is there a test for binding?
13. Is there a test for conditional behavior?
14. Is profile usage minimal?
15. Can production accidentally use local defaults?
16. Can a higher-priority source shadow this unexpectedly?
17. Who owns this config?
18. What happens if this config changes while app is running?
19. Does changing this require restart?
20. How will ops diagnose the effective value?
```

---

## 28. Java 8 to Java 25 Considerations

### 28.1 Java 8

Typical stack:

```text
Spring Framework 5.x
Spring Boot 2.x
javax.*
mutable @ConfigurationProperties common
no records
constructor binding depends on Boot version
```

Recommended style:

- use class with final fields if supported;
- otherwise JavaBean properties;
- validate aggressively;
- avoid spreading `@Value`.

### 28.2 Java 11

Still often on Boot 2.x or transitional Boot 2.7.

Focus:

- prepare `javax.*` to `jakarta.*`;
- remove deprecated config;
- introduce `@ConfigurationProperties` discipline;
- reduce profile explosion.

### 28.3 Java 17

Modern baseline for Spring Framework 6/7 and Boot 3/4.

Recommended:

- records for immutable config;
- constructor binding;
- explicit duration/data size units;
- validation;
- config metadata;
- AOT-compatible config.

### 28.4 Java 21

Add virtual thread-related config considerations:

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

But remember:

```text
Virtual threads do not remove need for pool sizing around JDBC, HTTP connection pools, rate limits, and external capacity.
```

### 28.5 Java 25

Spring Boot 4 supports Java 25 as modern runtime direction. For config design, this mostly means:

- records are standard practice;
- stronger null-safety direction in framework ecosystem;
- AOT/native compatibility matters more;
- configuration should be explicit and type-safe;
- avoid reflection-heavy custom binding tricks.

---

## 29. Practical Design Example: External Client Config

### 29.1 Requirement

We need a client to external Case Registry API.

Config needs:

- enabled flag;
- base URL;
- timeout;
- retry;
- OAuth client credential;
- rate limit;
- safe logging.

### 29.2 YAML

```yaml
integration:
  case-registry:
    enabled: false
    base-url: https://case-registry.example.com
    timeout: 3s
    retry:
      max-attempts: 3
      backoff: 250ms
    rate-limit:
      requests-per-minute: 300
    oauth:
      token-url: https://auth.example.com/oauth/token
      client-id: ${CASE_REGISTRY_CLIENT_ID}
      client-secret: ${CASE_REGISTRY_CLIENT_SECRET}
```

### 29.3 Properties Class

```java
@Validated
@ConfigurationProperties(prefix = "integration.case-registry")
public final class CaseRegistryProperties {

    private final boolean enabled;

    @NotNull
    private final URI baseUrl;

    @NotNull
    private final Duration timeout;

    @Valid
    @NotNull
    private final Retry retry;

    @Valid
    @NotNull
    private final RateLimit rateLimit;

    @Valid
    @NotNull
    private final OAuth oauth;

    public CaseRegistryProperties(
            boolean enabled,
            URI baseUrl,
            Duration timeout,
            Retry retry,
            RateLimit rateLimit,
            OAuth oauth
    ) {
        this.enabled = enabled;
        this.baseUrl = baseUrl;
        this.timeout = timeout;
        this.retry = retry;
        this.rateLimit = rateLimit;
        this.oauth = oauth;
    }

    public boolean enabled() {
        return enabled;
    }

    public URI baseUrl() {
        return baseUrl;
    }

    public Duration timeout() {
        return timeout;
    }

    public Retry retry() {
        return retry;
    }

    public RateLimit rateLimit() {
        return rateLimit;
    }

    public OAuth oauth() {
        return oauth;
    }

    @AssertTrue(message = "baseUrl, timeout, and oauth are required when enabled")
    public boolean isValidWhenEnabled() {
        if (!enabled) {
            return true;
        }
        return baseUrl != null
                && timeout != null
                && oauth != null
                && oauth.clientId() != null
                && oauth.clientSecret() != null;
    }

    @Override
    public String toString() {
        return "CaseRegistryProperties{" +
                "enabled=" + enabled +
                ", baseUrl=" + baseUrl +
                ", timeout=" + timeout +
                ", retry=" + retry +
                ", rateLimit=" + rateLimit +
                ", oauth=" + oauth.safeToString() +
                '}';
    }

    public record Retry(
            @Min(1) int maxAttempts,
            @NotNull Duration backoff
    ) {}

    public record RateLimit(
            @Min(1) int requestsPerMinute
    ) {}

    public record OAuth(
            @NotNull URI tokenUrl,
            @NotBlank String clientId,
            @NotBlank String clientSecret
    ) {
        String safeToString() {
            return "OAuth{tokenUrl=%s, clientId='%s', clientSecret='***'}"
                    .formatted(tokenUrl, clientId);
        }
    }
}
```

### 29.4 Auto-Configuration

```java
@Configuration
@EnableConfigurationProperties(CaseRegistryProperties.class)
class CaseRegistryClientConfiguration {

    @Bean
    @ConditionalOnProperty(
            name = "integration.case-registry.enabled",
            havingValue = "true",
            matchIfMissing = false
    )
    CaseRegistryClient caseRegistryClient(CaseRegistryProperties properties) {
        return new HttpCaseRegistryClient(
                properties.baseUrl(),
                properties.timeout(),
                properties.retry().maxAttempts(),
                properties.retry().backoff()
        );
    }
}
```

### 29.5 Test

```java
class CaseRegistryClientConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(CaseRegistryClientConfiguration.class);

    @Test
    void doesNotCreateClientByDefault() {
        runner.run(context -> {
            assertThat(context).doesNotHaveBean(CaseRegistryClient.class);
        });
    }

    @Test
    void createsClientWhenEnabledAndValid() {
        runner
                .withPropertyValues(
                        "integration.case-registry.enabled=true",
                        "integration.case-registry.base-url=https://case.example.com",
                        "integration.case-registry.timeout=3s",
                        "integration.case-registry.retry.max-attempts=3",
                        "integration.case-registry.retry.backoff=250ms",
                        "integration.case-registry.rate-limit.requests-per-minute=300",
                        "integration.case-registry.oauth.token-url=https://auth.example.com/token",
                        "integration.case-registry.oauth.client-id=test-client",
                        "integration.case-registry.oauth.client-secret=test-secret"
                )
                .run(context -> {
                    assertThat(context).hasSingleBean(CaseRegistryClient.class);
                });
    }

    @Test
    void failsWhenEnabledButSecretMissing() {
        runner
                .withPropertyValues(
                        "integration.case-registry.enabled=true",
                        "integration.case-registry.base-url=https://case.example.com",
                        "integration.case-registry.timeout=3s",
                        "integration.case-registry.retry.max-attempts=3",
                        "integration.case-registry.retry.backoff=250ms",
                        "integration.case-registry.rate-limit.requests-per-minute=300",
                        "integration.case-registry.oauth.token-url=https://auth.example.com/token",
                        "integration.case-registry.oauth.client-id=test-client"
                )
                .run(context -> {
                    assertThat(context).hasFailed();
                });
    }
}
```

---

## 30. Common Anti-Patterns

### 30.1 Everything in `application.yml`

Bad:

```yaml
app:
  everything:
    database-password: secret
    payment-key: secret
    feature-x: true
    tenant-mode: schema
    thread-count: 50
    random: abc
```

Problem:

- no ownership;
- no structure;
- secret leakage;
- hard to audit;
- hard to validate.

### 30.2 Profile Explosion

Bad:

```text
prod-client-a-new-routing-real-payment-with-cache
```

Use properties and feature flags instead.

### 30.3 `@Value` Everywhere

Bad:

```java
@Value("${x}")
String x;

@Value("${y}")
String y;

@Value("${z}")
String z;
```

Use config properties.

### 30.4 Unsafe Defaults

Bad:

```yaml
security:
  enabled: false
```

Production should fail fast if required security config missing.

### 30.5 Logging Config Objects with Secrets

Bad:

```java
log.info("Loaded {}", oauthProperties);
```

Record `toString()` can leak secrets.

### 30.6 Config That Changes Bean Graph Dynamically

Bad mental model:

```text
Change property at runtime and expect Spring to reconstruct all dependent beans safely.
```

Prefer restart unless designed for runtime refresh.

### 30.7 Hidden Property Mutation

Bad:

```java
env.getPropertySources().addFirst(new MapPropertySource("override", values));
```

inside random application code.

Only infrastructure/bootstrap layer should mutate environment.

---

## 31. Production Readiness Checklist

For every Spring service:

```text
[ ] Active profile is explicit in all non-local environments.
[ ] Risky integrations are disabled by default.
[ ] Required production properties fail fast if missing.
[ ] Secrets are not stored in repo.
[ ] Secrets are not logged by config object toString().
[ ] @ConfigurationProperties is used for domain config.
[ ] @Value is limited to simple/infrastructure cases.
[ ] Config classes are validated.
[ ] Duration/data size units are explicit.
[ ] Property metadata is generated for internal starters.
[ ] Actuator env/configprops endpoints are secured.
[ ] There are tests for binding and conditional beans.
[ ] Property prefixes have owners.
[ ] Profile count is controlled.
[ ] Config drift detection exists for critical envs.
[ ] Dynamic refresh is only used for safe runtime-changeable config.
[ ] There is a documented config precedence strategy.
[ ] Production deployment logs active profiles safely.
[ ] No local default can silently become production behavior.
```

---

## 32. Mental Model Summary

Spring configuration is not a file-reading feature.

It is a runtime decision layer.

```text
Environment answers:
  What values exist?
  Which profiles are active?

PropertySource answers:
  Where did values come from?
  Which source has priority?

Profiles answer:
  Which environment-specific components/config should exist?

@ConfigurationProperties answers:
  What is the typed configuration contract?

Conditions answer:
  Should this bean/configuration exist?

Validation answers:
  Is this runtime safe to start?
```

The top-tier mental model:

```text
Configuration is part of architecture.
It defines runtime behavior, object graph shape, operational safety,
and failure characteristics.
```

If you cannot explain why a property has its effective value, you do not yet control your Spring runtime.

---

## 33. What You Should Be Able to Do After This Part

After this part, you should be able to:

1. Explain `Environment` and `PropertySource`.
2. Diagnose property shadowing.
3. Decide between `@Value` and `@ConfigurationProperties`.
4. Design immutable config classes.
5. Validate config at startup.
6. Use profiles without profile explosion.
7. Understand config data import.
8. Separate secrets from normal config.
9. Avoid unsafe defaults.
10. Test config binding.
11. Test conditional bean activation.
12. Secure config diagnostics.
13. Design config as internal API.
14. Reason about runtime refresh risk.
15. Build production-safe Spring configuration strategy.

---

## 34. Connection to Previous and Next Parts

Previous parts built the container model:

```text
Part 1: BeanDefinition, BeanFactory, ApplicationContext
Part 2: Dependency resolution
Part 3: Bean lifecycle
Part 4: Annotation metadata and scanning
Part 5: Configuration class model
```

This part adds runtime input:

```text
PropertySource + Environment + Profiles + Binding
```

Next part:

```text
Part 7 — Spring Boot Auto-Configuration Internals
```

Why next?

Because Spring Boot auto-configuration is essentially:

```text
classpath + properties + conditions + bean graph back-off
```

You cannot understand Boot auto-configuration deeply without understanding:

```text
Environment
PropertySource
Profiles
@ConfigurationProperties
@ConditionalOnProperty
```

---

## 35. References

Official references used for this part:

1. Spring Framework Reference — Environment Abstraction  
   https://docs.spring.io/spring-framework/reference/core/beans/environment.html

2. Spring Framework API — `Environment`  
   https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/env/Environment.html

3. Spring Framework API — `@PropertySource`  
   https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/PropertySource.html

4. Spring Framework Reference — Using `@Value`  
   https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/value-annotations.html

5. Spring Boot Reference — Externalized Configuration  
   https://docs.spring.io/spring-boot/reference/features/external-config.html

6. Spring Boot Reference — Profiles  
   https://docs.spring.io/spring-boot/reference/features/profiles.html

7. Spring Boot Reference — Common Application Properties  
   https://docs.spring.io/spring-boot/appendix/application-properties/index.html

---

# End of Part 6

Status seri:

```text
Part saat ini : 6 dari 35
Status        : belum selesai
Berikutnya    : 07-spring-boot-auto-configuration-internals.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-configuration-model-bean-full-lite-mode.md">⬅️ Part 5 — Configuration Model: `@Configuration`, `@Bean`, Lite Mode, Full Mode</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./07-spring-boot-auto-configuration-internals.md">Part 7 — Spring Boot Auto-Configuration Internals ➡️</a>
</div>
