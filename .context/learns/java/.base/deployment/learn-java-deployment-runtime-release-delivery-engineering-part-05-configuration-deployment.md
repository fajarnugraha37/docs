# learn-java-deployment-runtime-release-delivery-engineering

## Part 5 — Configuration Deployment: Config Files, Env Vars, System Properties, Secrets, Profiles

> **Target pembelajaran:** setelah bagian ini, kamu bukan hanya tahu cara menaruh `application.yml`, environment variable, atau secret di Kubernetes. Kamu akan punya mental model untuk mendesain konfigurasi Java production yang aman, traceable, bisa diubah tanpa rebuild, bisa diaudit, bisa di-rollback, dan tidak berubah menjadi sumber incident tersembunyi.

---

## 1. Kenapa Configuration Deployment Layak Dibahas Terpisah?

Dalam deployment Java, configuration sering dianggap “detail kecil”. Padahal, banyak incident production tidak disebabkan oleh bug algoritma, tetapi oleh konfigurasi yang salah:

- URL database salah;
- profile production tidak aktif;
- credential expired;
- secret baru tidak ikut terbaca karena env var hanya dievaluasi saat process start;
- timeout terlalu kecil atau terlalu besar;
- feature flag aktif di environment yang salah;
- config default dari artifact diam-diam menang melawan config environment;
- logging debug menyala di production;
- truststore tidak memuat CA baru;
- Kubernetes ConfigMap berubah tetapi pod tidak restart;
- property name berubah saat upgrade framework;
- config antar service tidak kompatibel.

Dalam sistem enterprise, configuration adalah **deployment contract** antara aplikasi dan environment. Source code menjawab: “aplikasi bisa melakukan apa?” Configuration menjawab: “di environment ini, aplikasi harus berperilaku bagaimana?”

Mental model yang harus dipegang:

```text
Code defines possible behavior.
Configuration selects actual behavior.
Deployment binds selected behavior to a real environment.
Operations prove that the selected behavior is safe.
```

Configuration yang buruk membuat artifact yang benar menjadi salah. Configuration yang baik membuat artifact yang sama bisa dipromosikan dari DEV ke SIT/UAT/PROD tanpa rebuild.

---

## 2. Definisi: Apa Itu Configuration dalam Deployment?

Dalam konteks deployment, configuration adalah semua input eksternal yang memengaruhi perilaku aplikasi tanpa mengubah source code dan idealnya tanpa membuat artifact baru.

Contoh configuration:

```text
Database URL
Database pool size
Redis host
RabbitMQ queue name
OAuth issuer URL
JWKS endpoint
SMTP host
API timeout
Retry limit
Feature flag
Log level
Active profile
JVM heap size
Timezone
TLS truststore path
S3 bucket name
Kubernetes namespace
External service base URL
```

Namun tidak semua hal yang “bisa dikonfigurasi” seharusnya dijadikan runtime config. Senior engineer harus bisa membedakan:

| Kategori | Contoh | Harus runtime config? | Catatan |
|---|---:|---:|---|
| Environment binding | DB URL, Redis host, external API URL | Ya | Berbeda per environment |
| Secret | password, token, private key | Ya, tapi mekanisme khusus | Jangan masuk artifact/log |
| Operational tuning | timeout, pool size, queue concurrency | Ya | Perlu controlled override |
| Feature exposure | feature flag, module enablement | Ya, jika desainnya matang | Harus auditable |
| Business rule stable | formula pajak, status lifecycle core | Tergantung | Jika regulatory, perlu governance |
| Code-level invariant | transaction boundary, domain state transition | Biasanya tidak | Jangan ubah lewat config sembarangan |
| Build-time dependency | library version | Tidak | Harus lewat release artifact |
| Security baseline | auth required, password hashing algorithm | Sangat hati-hati | Jangan mudah dimatikan lewat config |

Kesalahan umum adalah menjadikan terlalu banyak hal sebagai config. Itu membuat aplikasi terlihat fleksibel, tetapi sebenarnya rapuh karena behavior production sulit diprediksi.

Prinsipnya:

```text
Config should vary deployment behavior, not replace application design.
```

---

## 3. Configuration sebagai Kontrak, Bukan Sekadar Key-Value

Configuration yang matang punya beberapa properti:

1. **Name** — nama property jelas dan konsisten.
2. **Type** — string, integer, boolean, duration, size, enum, list, map.
3. **Scope** — global, service-level, tenant-level, module-level, request-level.
4. **Default** — apakah ada default aman?
5. **Requiredness** — wajib atau optional?
6. **Sensitivity** — secret, confidential, public operational config.
7. **Reloadability** — butuh restart atau bisa hot reload?
8. **Owner** — developer, platform, security, ops, business owner.
9. **Validation** — range, format, dependency antar config.
10. **Auditability** — siapa mengubah, kapan, dari nilai apa ke nilai apa.
11. **Rollback model** — bagaimana kembali ke nilai sebelumnya.
12. **Blast radius** — service tunggal, namespace, cluster, semua tenant.

Config yang tidak memiliki metadata seperti ini akan sulit dioperasikan.

Contoh config yang buruk:

```properties
sync.enabled=true
sync.timeout=10000
sync.mode=A
```

Masalahnya:

- `timeout` satuannya apa? ms? detik?
- `mode=A` artinya apa?
- apakah aman diubah saat runtime?
- apakah default-nya aman?
- jika `enabled=false`, apakah job berhenti langsung atau setelah batch selesai?
- siapa yang boleh mengubah?
- apakah perubahan perlu approval?

Contoh lebih baik:

```yaml
external-case-sync:
  enabled: true
  mode: incremental # allowed: incremental, full-reconcile, disabled
  request-timeout: 10s
  max-retry-attempts: 3
  worker-concurrency: 8
  stop-policy: drain-in-flight # allowed: immediate, drain-in-flight
```

Lebih baik lagi jika diikat ke typed configuration class dan divalidasi.

---

## 4. Layer Configuration: Dari Build Sampai Runtime

Sebelum memilih mekanisme, kita harus tahu di level mana config hidup.

```text
┌───────────────────────────────────────────────────────────────┐
│ Source code defaults                                           │
│ Example: @ConfigurationProperties default value                │
└───────────────────────────────────────────────────────────────┘
              ↓ overridden by
┌───────────────────────────────────────────────────────────────┐
│ Artifact-bundled config                                        │
│ Example: application.yml inside JAR/WAR                        │
└───────────────────────────────────────────────────────────────┘
              ↓ overridden by
┌───────────────────────────────────────────────────────────────┐
│ Runtime file config                                            │
│ Example: /etc/myapp/application-prod.yml                       │
└───────────────────────────────────────────────────────────────┘
              ↓ overridden by
┌───────────────────────────────────────────────────────────────┐
│ Environment variables / system properties                      │
│ Example: DB_URL, -Dspring.profiles.active=prod                 │
└───────────────────────────────────────────────────────────────┘
              ↓ overridden by
┌───────────────────────────────────────────────────────────────┐
│ Orchestrator/platform config                                   │
│ Example: Kubernetes ConfigMap/Secret, systemd EnvironmentFile  │
└───────────────────────────────────────────────────────────────┘
              ↓ optionally overridden by
┌───────────────────────────────────────────────────────────────┐
│ Dynamic config / feature flag / control plane                  │
│ Example: config server, database-backed toggle, LaunchDarkly   │
└───────────────────────────────────────────────────────────────┘
```

Tidak semua aplikasi memakai semua layer. Yang penting adalah **precedence** harus eksplisit.

Jika tim tidak tahu layer mana yang menang, maka debugging config menjadi spekulasi.

---

## 5. Golden Rule: Build Once, Configure Many

Deployment yang matang biasanya mengikuti pola:

```text
Same artifact.
Different environment binding.
No rebuild for DEV/SIT/UAT/PROD.
```

Artinya artifact yang sudah di-build harus bisa dipromosikan:

```text
commit abc123
  ↓ build once
artifact my-service:1.8.14+abc123
  ↓ deploy to DEV with DEV config
  ↓ promote to SIT with SIT config
  ↓ promote to UAT with UAT config
  ↓ promote to PROD with PROD config
```

Anti-pattern:

```text
Build DEV artifact
Build SIT artifact
Build UAT artifact
Build PROD artifact
```

Masalah anti-pattern ini:

- artifact antar environment belum tentu identik;
- bug bisa hanya muncul di PROD artifact;
- provenance sulit dibuktikan;
- rollback ambigu;
- security scanning artifact di UAT tidak membuktikan artifact PROD sama;
- release governance lemah.

Namun ada pengecualian terbatas. Misalnya native image yang butuh build khusus target OS/architecture, atau artifact yang memang berbeda karena customer-specific white-labeling. Tapi default engineering stance tetap:

```text
Artifact identity must be independent from environment identity.
```

---

## 6. Configuration Source Umum di Java

Java application dapat membaca config dari banyak sumber.

### 6.1 Command-line arguments

Contoh:

```bash
java -jar app.jar --server.port=8081 --spring.profiles.active=prod
```

Kelebihan:

- eksplisit di process command;
- mudah untuk override cepat;
- cocok untuk container entrypoint sederhana.

Kekurangan:

- bisa bocor lewat process list;
- command panjang sulit dikelola;
- tidak cocok untuk secret;
- kadang tercatat di deployment manifest/log.

Gunakan untuk config non-sensitive yang memang bagian dari process launch.

---

### 6.2 JVM system properties

Contoh:

```bash
java \
  -Duser.timezone=UTC \
  -Dfile.encoding=UTF-8 \
  -Dspring.profiles.active=prod \
  -Djavax.net.ssl.trustStore=/etc/myapp/truststore.p12 \
  -jar app.jar
```

System properties cocok untuk:

- JVM-level behavior;
- framework-level bootstrap config;
- property yang harus tersedia sangat awal;
- compatibility flags;
- TLS/truststore setting;
- timezone/encoding.

Risiko:

- bisa terlihat di command line;
- mudah tercampur dengan application config;
- sulit dikelola jika terlalu banyak.

Prinsip:

```text
Use system properties for JVM/framework bootstrap, not as a dumping ground for all application config.
```

---

### 6.3 Environment variables

Contoh:

```bash
export DB_HOST=prod-db.internal
export DB_PORT=1521
export DB_SERVICE=ACEASPROD
export APP_LOG_LEVEL=INFO
java -jar app.jar
```

Kelebihan:

- natural di container/orchestrator;
- mudah disuntik oleh CI/CD, Kubernetes, ECS, systemd;
- mendukung build-once-configure-many;
- tidak perlu file tambahan.

Kekurangan:

- semua value dasarnya string;
- nested config menjadi awkward;
- raw secret env var bisa terbaca oleh process inspection tertentu, crash dump, debug endpoint, atau salah logging;
- perubahan env var butuh process restart;
- env var besar sulit dikelola.

The Twelve-Factor App populer dengan prinsip menyimpan config di environment, terutama agar config terpisah dari code dan bisa berbeda antar deploy. Tapi dalam enterprise modern, interpretasinya harus matang: environment variable adalah salah satu mekanisme injection, bukan satu-satunya sumber kebenaran untuk semua konfigurasi.

---

### 6.4 External config files

Contoh:

```text
/etc/myapp/application.yml
/etc/myapp/application-prod.yml
/config/my-service/application.yml
```

Kelebihan:

- cocok untuk struktur nested;
- bisa versioned di deployment repo;
- lebih mudah dibaca daripada env var besar;
- cocok untuk ConfigMap volume;
- bisa dipisahkan antara default dan override.

Kekurangan:

- path management;
- permission/ownership;
- reload behavior harus jelas;
- file bisa drift jika diedit manual di server;
- secret file perlu permission ketat.

File config ideal untuk operational config non-secret yang kompleks.

---

### 6.5 Classpath-bundled config

Contoh:

```text
src/main/resources/application.yml
src/main/resources/META-INF/microprofile-config.properties
```

Kelebihan:

- memberi default;
- membantu local development;
- menjelaskan config shape;
- membuat aplikasi bisa start dengan minimal config.

Kekurangan:

- jika memuat environment-specific config, artifact menjadi environment-bound;
- raw secret di resource adalah fatal;
- default production yang salah bisa menang jika precedence tidak jelas.

Gunakan classpath config sebagai **safe default**, bukan environment truth.

---

### 6.6 Remote configuration service

Contoh:

```text
Spring Cloud Config
Consul KV
etcd
AWS AppConfig
Azure App Configuration
Database-backed config
Feature flag platform
Internal control plane
```

Kelebihan:

- central management;
- audit lebih kuat;
- dynamic update mungkin;
- cocok untuk fleet besar;
- bisa menjadi control plane.

Kekurangan:

- bootstrap dependency baru;
- config service down bisa menghambat startup;
- caching dan consistency harus didesain;
- rollback config bisa lebih sulit dari rollback artifact;
- dapat menjadi single point of failure;
- security dan access control lebih kompleks.

Gunakan remote config jika kamu benar-benar butuh koordinasi runtime lintas banyak instance/service. Jangan memakainya hanya karena terlihat enterprise.

---

## 7. Configuration Precedence: Siapa Menang?

Configuration precedence adalah aturan ketika property yang sama muncul di beberapa tempat.

Contoh:

```yaml
# bundled application.yml
server:
  port: 8080
```

```bash
export SERVER_PORT=9090
java -jar app.jar --server.port=7070
```

Pertanyaannya: port yang dipakai 8080, 9090, atau 7070?

Jawaban tergantung framework. Spring Boot misalnya punya urutan `PropertySource` yang spesifik; dokumentasi resminya menyatakan property source yang datang belakangan dapat override property source sebelumnya. MicroProfile Config juga memakai model `ConfigSource` dengan prioritas/ordinal untuk menentukan value efektif. Kubernetes sendiri bisa menyuntik ConfigMap sebagai env var, command-line argument, atau mounted file, dan setiap mekanisme punya timing/update behavior berbeda.

Konsekuensi engineering:

```text
Never design production deployment without knowing effective configuration precedence.
```

Praktik baik:

1. Dokumentasikan precedence.
2. Saat startup, log ringkasan config non-sensitive yang efektif.
3. Jangan log secret value.
4. Buat endpoint internal untuk menampilkan config metadata yang sudah disanitasi.
5. Buat test yang memastikan override bekerja.
6. Hindari multiple source untuk property yang sama kecuali memang disengaja.

Contoh startup log yang baik:

```text
Effective runtime configuration:
- app.name=case-management-service
- app.version=1.8.14+abc123
- active.profiles=prod,oracle,redis
- server.port=8080
- db.url=jdbc:oracle:thin:@//prod-db.internal:1521/ACEASPROD
- db.username=***
- redis.host=redis-prod.internal
- feature.new-case-routing=false
- external.onemap.base-url=https://...
- secrets.source=kubernetes-secret:case-management-secret:v17
```

Contoh startup log yang buruk:

```text
DB_PASSWORD=SuperSecret123
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
```

---

## 8. Java Framework Configuration Models

### 8.1 Plain Java

Plain Java biasanya memakai kombinasi:

```java
System.getenv("DB_URL");
System.getProperty("db.url");
Properties props = new Properties();
props.load(Files.newInputStream(Path.of("/etc/myapp/config.properties")));
```

Masalah jika dilakukan secara manual:

- tidak ada precedence konsisten;
- type conversion manual;
- validation tersebar;
- default tidak terdokumentasi;
- error message buruk;
- sulit audit config efektif.

Jika memakai plain Java, buat abstraction sendiri:

```java
public interface AppConfig {
    URI databaseUrl();
    Duration requestTimeout();
    int workerConcurrency();
    boolean featureEnabled(String name);
}
```

Lalu buat loader:

```text
defaults → file → env → system properties → command line
```

Dan validasi pada startup.

---

### 8.2 Spring Boot

Spring Boot punya externalized configuration yang kuat. Property bisa datang dari banyak sumber, termasuk default properties, config data files, environment variables, system properties, command-line arguments, dan lain-lain. Spring Boot juga mendukung relaxed binding, sehingga property seperti `external.case-sync.request-timeout` dapat dipetakan ke field Java dengan style yang berbeda.

Contoh typed config:

```java
@ConfigurationProperties(prefix = "external.case-sync")
@Validated
public class CaseSyncProperties {

    private boolean enabled = false;

    @NotNull
    private URI baseUrl;

    @NotNull
    private Duration requestTimeout = Duration.ofSeconds(10);

    @Min(1)
    @Max(64)
    private int workerConcurrency = 8;

    @Min(0)
    @Max(10)
    private int maxRetryAttempts = 3;

    // getters/setters
}
```

Contoh YAML:

```yaml
external:
  case-sync:
    enabled: true
    base-url: https://case-sync.internal
    request-timeout: 10s
    worker-concurrency: 8
    max-retry-attempts: 3
```

Kenapa typed config penting?

- `Duration` jelas satuannya;
- invalid value gagal saat startup;
- IDE bisa bantu metadata;
- property lebih discoverable;
- config contract terdokumentasi di code;
- menghindari `@Value` string tersebar.

Anti-pattern Spring:

```java
@Value("${timeout}")
private int timeout;

@Value("${flag}")
private String flag;

@Value("${url}")
private String url;
```

Masalahnya:

- nama terlalu generik;
- tidak ada grouping domain;
- validation lemah;
- sulit refactor;
- satuan tidak jelas;
- sering tersebar di banyak class.

Prefer:

```text
@ConfigurationProperties + validation + explicit prefix + safe defaults.
```

---

### 8.3 MicroProfile Config / Jakarta-style Runtime

MicroProfile Config menyediakan model config source yang dapat menggabungkan beberapa sumber konfigurasi menjadi satu view. Default source umumnya mencakup system properties, environment variables, dan `META-INF/microprofile-config.properties`, dengan precedence berdasarkan ordinal.

Contoh:

```java
@Inject
@ConfigProperty(name = "external.payment.timeout", defaultValue = "PT10S")
Duration paymentTimeout;
```

Atau typed/grouped config pada implementasi tertentu.

Kekuatan MicroProfile Config:

- portable di runtime MicroProfile seperti Open Liberty, Quarkus, Payara, Helidon, WildFly dengan dukungan tertentu;
- cocok untuk deployment enterprise server-side;
- config source bisa diperluas;
- model ordinal eksplisit.

Hal yang harus dijaga:

- mapping env var ke property name harus dipahami;
- default value tidak boleh menyembunyikan missing critical config;
- secret tetap jangan disimpan di classpath resource;
- precedence antar app server/runtime bisa punya detail implementasi.

---

## 9. Config Files: Desain Struktur yang Operable

Config file yang baik bukan hanya valid YAML/properties. Ia harus bisa dibaca oleh manusia, direview di PR, dan ditelusuri saat incident.

### 9.1 Struktur berdasarkan bounded context

Buruk:

```yaml
timeout: 10s
url: https://api.internal
enabled: true
poolSize: 10
retry: 3
```

Baik:

```yaml
external-services:
  onemap:
    enabled: true
    base-url: https://www.onemap.gov.sg
    request-timeout: 10s
    connect-timeout: 2s
    max-retry-attempts: 3

persistence:
  oracle:
    pool:
      maximum-size: 30
      minimum-idle: 5
      connection-timeout: 5s

messaging:
  rabbitmq:
    consumer-concurrency: 8
    prefetch-count: 25
```

Kelebihan grouping:

- jelas owner-nya;
- mudah validasi;
- mudah review;
- mengurangi collision;
- config diff lebih bermakna.

---

### 9.2 Gunakan satuan eksplisit

Buruk:

```properties
api.timeout=10000
upload.max-size=20
```

Baik:

```yaml
api:
  timeout: 10s
upload:
  max-size: 20MB
```

Jika framework tidak mendukung duration/data-size type, definisikan naming convention:

```properties
api.timeout-ms=10000
upload.max-size-bytes=20971520
```

Jangan pernah membuat operator menebak satuan.

---

### 9.3 Hindari config name terlalu generik

Buruk:

```properties
enabled=true
url=https://...
timeout=10s
```

Baik:

```properties
external.onemap.enabled=true
external.onemap.base-url=https://...
external.onemap.request-timeout=10s
```

Nama config harus menjawab:

```text
Untuk subsystem apa?
Behavior apa?
Satuan apa?
```

---

### 9.4 Pisahkan config biasa dan secret

Jangan campur:

```yaml
external:
  payment:
    base-url: https://payment.internal
    client-id: aceas
    client-secret: secret123
```

Lebih baik:

```yaml
external:
  payment:
    base-url: https://payment.internal
    client-id: aceas
    client-secret-ref: payment-client-secret
```

Atau inject secret melalui mekanisme terpisah:

```text
ConfigMap:
  external.payment.base-url
  external.payment.client-id

Secret:
  external.payment.client-secret
```

Prinsip:

```text
Non-secret config can be reviewed widely.
Secret config must be distributed narrowly.
```

---

## 10. Environment Variables: Powerful but Dangerous if Unstructured

Environment variables cocok untuk container deployment, tetapi tidak boleh menjadi tempat pembuangan semua config.

### 10.1 Naming convention

Gunakan convention konsisten:

```text
APP_<DOMAIN>_<SETTING>
```

Contoh:

```bash
APP_EXTERNAL_ONEMAP_BASE_URL=https://www.onemap.gov.sg
APP_EXTERNAL_ONEMAP_REQUEST_TIMEOUT=10s
APP_DB_POOL_MAXIMUM_SIZE=30
APP_FEATURE_CASE_ROUTING_ENABLED=false
```

Atau framework-native relaxed binding:

```bash
EXTERNAL_SERVICES_ONEMAP_BASE_URL=https://www.onemap.gov.sg
EXTERNAL_SERVICES_ONEMAP_REQUEST_TIMEOUT=10s
```

Untuk Spring Boot, env var uppercase dengan underscore dapat dipetakan ke property style tertentu melalui relaxed binding. Namun jangan bergantung pada magic tanpa dokumentasi internal.

---

### 10.2 Env var tidak cocok untuk semua hal

Env var kurang cocok untuk:

- private key multi-line besar;
- config nested sangat kompleks;
- list/map panjang;
- dynamic config yang sering berubah;
- secret yang tidak boleh muncul di process environment;
- config yang perlu atomic update sebagai file bundle.

Untuk private key, truststore, certificate chain, atau config kompleks, mounted file sering lebih baik.

---

### 10.3 Env var berubah tidak berarti aplikasi ikut berubah

Environment variable adalah snapshot saat process dibuat.

Jika Kubernetes Secret diubah, env var pada pod yang sudah berjalan tidak otomatis berubah. Pod harus restart untuk mendapat env var baru. Mounted volume punya behavior berbeda, tetapi aplikasi tetap harus membaca ulang file jika ingin hot reload.

Kesalahan umum:

```text
Secret changed in Kubernetes.
Team assumes running Java process now uses new password.
Application still uses old env var until restart.
Database rotates password.
Application starts failing.
```

Runbook rotasi harus menjelaskan:

```text
Update secret → restart/rollout pods → verify new connection → revoke old secret.
```

---

## 11. System Properties: Bootstrap-Level Contract

System properties sering diremehkan, padahal banyak behavior penting Java bergantung pada `-D`.

Contoh system properties yang sering relevan di deployment:

```bash
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Djava.security.egd=file:/dev/urandom
-Djavax.net.ssl.trustStore=/etc/myapp/truststore.p12
-Djavax.net.ssl.trustStorePassword=...
-Djavax.net.ssl.trustStoreType=PKCS12
-Dspring.profiles.active=prod
-Dlogging.config=/etc/myapp/logback.xml
```

### 11.1 Jangan campur semua aplikasi config ke `-D`

Buruk:

```bash
java \
  -Ddb.url=... \
  -Ddb.password=... \
  -Dredis.password=... \
  -Dapi.key=... \
  -Dfeature.x=true \
  -Dfeature.y=false \
  -Dfeature.z=true \
  -jar app.jar
```

Masalah:

- command line panjang;
- secret bisa terlihat;
- audit susah;
- typo sulit dilihat;
- systemd/Kubernetes manifest jadi unreadable.

Gunakan system properties untuk hal yang memang perlu diketahui JVM/framework pada fase awal, bukan untuk seluruh konfigurasi bisnis.

---

## 12. Profiles: Berguna, Tapi Sering Disalahgunakan

Profile adalah mekanisme memilih kumpulan config berdasarkan environment atau mode aplikasi.

Contoh Spring:

```yaml
spring:
  profiles:
    active: prod
```

Atau file:

```text
application.yml
application-dev.yml
application-uat.yml
application-prod.yml
```

### 12.1 Profile yang sehat

Profile cocok untuk:

- memilih adapter environment;
- memilih logging level default;
- memilih datasource config group;
- memisahkan local/dev/prod behavior yang jelas;
- mengaktifkan mock external service di local test.

Contoh:

```yaml
# application-local.yml
external-services:
  payment:
    base-url: http://localhost:18080/mock-payment

# application-prod.yml
external-services:
  payment:
    base-url: https://payment.internal.prod
```

---

### 12.2 Profile yang berbahaya

Profile menjadi berbahaya jika dipakai untuk menyembunyikan behavior code besar.

Contoh buruk:

```java
@Profile("prod")
@Service
class RealPaymentService implements PaymentService { }

@Profile("uat")
@Service
class FakePaymentService implements PaymentService { }
```

Ini tidak selalu salah, tapi berbahaya jika UAT memakai fake behavior yang tidak merepresentasikan PROD. Akibatnya deployment lulus UAT tetapi gagal production.

Lebih berbahaya:

```java
@Profile("prod")
@EnableSecurity
class SecurityConfig { }
```

Security seharusnya bukan optional per profile kecuali untuk local-only dengan guard sangat jelas.

---

### 12.3 Profile explosion

Anti-pattern:

```text
local
local-oracle
local-postgres
dev
dev2
sit
sit-debug
uat
uat2
preprod
prod
prod-dr
prod-hotfix
```

Masalah:

- kombinasi tidak terkendali;
- behavior sulit diprediksi;
- config drift;
- environment menjadi hardcoded dalam aplikasi.

Lebih baik gunakan profile kecil dan orthogonal:

```text
runtime profile: prod
region profile: ap-southeast-1
storage profile: oracle
messaging profile: rabbitmq
```

Namun jangan terlalu banyak juga. Tujuannya bukan membuat semua hal menjadi profile, tapi menjaga axis variasi tetap eksplisit.

---

## 13. Secrets: Bukan Sekadar Config yang Disembunyikan

Secret adalah data yang jika bocor dapat memberi akses, privilege, atau kemampuan impersonasi.

Contoh:

```text
Database password
API token
OAuth client secret
JWT signing key
TLS private key
SAML signing certificate private key
SMTP password
Cloud access key
Redis password
RabbitMQ password
Encryption key
```

Secret memiliki lifecycle berbeda dari config biasa:

```text
create → distribute → consume → rotate → revoke → audit → destroy
```

Config biasa bisa direview di PR oleh banyak orang. Secret tidak.

---

## 14. Secret Injection Patterns

### 14.1 Environment variable secret

Contoh Kubernetes:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: case-management-secret
        key: db-password
```

Kelebihan:

- sederhana;
- banyak framework mudah membaca;
- cocok untuk password kecil.

Kekurangan:

- process harus restart untuk update;
- bisa terekspos jika environment dump dilog;
- bisa terlihat oleh tooling tertentu dengan permission process/container;
- tidak cocok untuk large/multiline secret.

Gunakan jika sederhana dan risiko diterima.

---

### 14.2 Mounted secret file

Contoh:

```yaml
volumeMounts:
  - name: app-secrets
    mountPath: /etc/myapp/secrets
    readOnly: true

volumes:
  - name: app-secrets
    secret:
      secretName: case-management-secret
```

Aplikasi membaca:

```text
/etc/myapp/secrets/db-password
/etc/myapp/secrets/oauth-client-secret
/etc/myapp/secrets/truststore.p12
```

Kelebihan:

- cocok untuk certificate/private key/truststore;
- permission file bisa dikontrol;
- update volume bisa terjadi tanpa recreate pod pada mekanisme tertentu;
- tidak muncul sebagai env var.

Kekurangan:

- aplikasi harus tahu path;
- hot reload tetap butuh implementasi;
- file watcher bisa tricky;
- permission dan ownership harus benar.

---

### 14.3 Secret manager runtime fetch

Contoh:

```text
AWS Secrets Manager
AWS SSM Parameter Store
HashiCorp Vault
Azure Key Vault
Google Secret Manager
CyberArk
```

Pola:

```text
App starts → authenticate using workload identity → fetch secret → cache → use → refresh/rotate
```

Kelebihan:

- central audit;
- dynamic secret possible;
- rotation lebih matang;
- tidak perlu menyimpan semua secret di Kubernetes Secret;
- bisa enforce IAM.

Kekurangan:

- bootstrap dependency;
- aplikasi perlu permission cloud/Vault;
- latency/failure saat startup;
- caching wajib didesain;
- rate limit;
- secret fetch code menjadi bagian critical path.

Rule of thumb:

```text
If secret lifecycle is complex, use a secret manager.
If deployment environment needs simple injection, Kubernetes Secret or mounted file may be enough.
```

---

### 14.4 Init container / sidecar secret sync

Pola:

```text
Init container fetches secrets → writes files to shared volume → main Java app reads files.
```

Atau:

```text
Sidecar renews token/cert → Java app reloads from mounted path.
```

Kelebihan:

- aplikasi tidak perlu SDK secret manager;
- separation of concern;
- cocok untuk cert renewal.

Kekurangan:

- lifecycle lebih kompleks;
- readiness harus menunggu secret tersedia;
- sidecar failure harus dimodelkan;
- reload tetap harus jelas.

---

## 15. Secret Rotation: Desain Sejak Awal

Secret rotation sering gagal karena sistem hanya didesain untuk “read once at startup”.

### 15.1 Rotation tanpa downtime biasanya butuh dual validity

Contoh password database:

```text
T0: app uses password A
T1: create password B / enable user B
T2: update app secret to B
T3: rollout app instances gradually
T4: verify all instances use B
T5: revoke A
```

Jika langsung revoke A sebelum semua pod restart, sebagian instance gagal.

Untuk OAuth client secret:

```text
IdP supports multiple active client secrets.
App deploys new secret.
Old secret remains valid during rollout.
After verification, old secret revoked.
```

Untuk certificate:

```text
Trust both old CA and new CA during transition.
Rotate server cert.
Verify clients trust new chain.
Remove old CA after window.
```

### 15.2 Rotation runbook harus eksplisit

Minimal:

```text
1. Identify secret owner.
2. Confirm dual-validity support.
3. Create new secret version.
4. Update deployment secret reference.
5. Restart/rollout consumers.
6. Verify using metrics/logs.
7. Revoke old secret.
8. Record evidence.
```

Tanpa dual validity, rotation biasanya membutuhkan maintenance window atau koordinasi ketat.

---

## 16. Configuration Validation: Fail Fast, But Fail Usefully

Aplikasi production harus gagal startup jika config critical invalid. Lebih baik gagal sebelum menerima traffic daripada berjalan dengan behavior salah.

### 16.1 Validasi type

Buruk:

```java
int timeout = Integer.parseInt(System.getenv("TIMEOUT"));
```

Jika env var kosong, error-nya bisa buruk.

Baik:

```text
external.onemap.request-timeout must be a duration, e.g. 10s, got: abc
```

### 16.2 Validasi range

Contoh:

```text
worker-concurrency must be between 1 and 64.
request-timeout must be between 100ms and 60s.
pool.maximum-size must be >= pool.minimum-idle.
```

### 16.3 Validasi dependency antar config

Contoh:

```text
if external.onemap.enabled=true:
  base-url is required
  client-id is required
  client-secret is required
  token-url is required
```

Contoh:

```text
if oauth.mode=private-key-jwt:
  private-key-path is required
  key-id is required
```

### 16.4 Validasi environment safety

Contoh:

```text
if profile=prod:
  debug endpoint must be disabled
  mock provider must not be used
  logging level must not be TRACE globally
  database URL must not point to DEV
  allow-destructive-operation must be false
```

Ini penting untuk mencegah salah deploy.

---

## 17. Effective Configuration Reporting

Saat aplikasi start, ia harus memberi bukti config efektif.

Namun harus disanitasi.

Contoh:

```text
[CONFIG] app.name=case-service
[CONFIG] app.version=1.8.14+abc123
[CONFIG] active.profiles=prod,oracle
[CONFIG] java.version=21.0.8
[CONFIG] config.sources=classpath:/application.yml,file:/etc/case/application-prod.yml,kubernetes:case-config-v42,kubernetes-secret:case-secret-v17
[CONFIG] server.port=8080
[CONFIG] datasource.url=jdbc:oracle:thin:@//prod-db.internal:1521/ACEASPROD
[CONFIG] datasource.username=ACEAS_APP
[CONFIG] datasource.password=***
[CONFIG] redis.host=redis-prod.internal
[CONFIG] onemap.enabled=true
[CONFIG] onemap.base-url=https://www.onemap.gov.sg
[CONFIG] onemap.client-secret=***
```

Jangan hanya log:

```text
Application started.
```

Karena saat incident, tim perlu menjawab:

```text
Artifact apa yang running?
Profile apa?
Config source mana?
Secret version mana?
Endpoint mana?
```

---

## 18. Config Drift: Musuh Diam-Diam Deployment

Config drift terjadi ketika environment yang seharusnya sama secara struktur ternyata berbeda tanpa disengaja.

Contoh:

```text
UAT timeout = 60s
PROD timeout = 5s

UAT feature flag = false
PROD feature flag = true

UAT uses mock endpoint
PROD uses real endpoint

UAT DB pool = 5
PROD DB pool = 80
```

Tidak semua perbedaan buruk. Yang buruk adalah perbedaan yang tidak diketahui.

### 18.1 Environment parity bukan berarti value identik

DEV dan PROD tentu beda URL, credential, size. Tapi shape harus sama.

```text
Same keys.
Same meaning.
Same validation.
Different values only where expected.
```

### 18.2 Config diff sebagai release artifact

Untuk deployment serius, simpan config di repo atau config management system yang bisa diff:

```text
deploy/config/dev/application.yml
deploy/config/uat/application.yml
deploy/config/prod/application.yml
```

Lalu review:

```bash
diff uat/application.yml prod/application.yml
```

Atau gunakan schema validation untuk memastikan key wajib ada di semua environment.

---

## 19. Immutable vs Mutable Configuration

Tidak semua config punya karakter sama.

### 19.1 Immutable-at-start config

Contoh:

```text
server.port
database URL
connection pool max size
JVM heap size
active profile
truststore path
```

Umumnya butuh restart.

### 19.2 Reloadable config

Contoh:

```text
log level
feature flag
rate limit threshold
external service timeout
circuit breaker threshold
```

Bisa reload jika aplikasi/framework mendukung.

### 19.3 Dangerous-to-reload config

Contoh:

```text
transaction isolation
schema name
message queue name
identity provider issuer
JWT audience
payment provider mode
```

Bisa diubah runtime, tapi risikonya tinggi. Perubahan semacam ini sering lebih aman lewat rollout terkontrol.

Prinsip:

```text
A config being technically reloadable does not mean it is operationally safe to reload.
```

---

## 20. Hot Reload vs Restart: Jangan Tertipu

Banyak platform bisa mengubah file config tanpa restart. Tapi Java app hanya berubah jika:

1. file berubah;
2. aplikasi mendeteksi perubahan;
3. aplikasi membaca ulang;
4. komponen yang memakai config bisa menerima nilai baru;
5. state lama ditransisikan dengan aman.

Contoh timeout HTTP client:

```text
Config file changes from 10s to 2s.
But HTTP client bean was created at startup.
If bean is not recreated, timeout remains 10s.
```

Contoh database pool:

```text
maxPoolSize changes from 30 to 50.
Hikari pool may support runtime change for some properties, but not all properties are safely mutable.
```

Contoh queue consumer concurrency:

```text
Concurrency changes from 4 to 16.
If listener container supports dynamic scaling, okay.
If not, restart needed.
```

Maka setiap config perlu metadata:

```text
reloadability: restart-required | runtime-reload-safe | runtime-reload-dangerous
```

---

## 21. Kubernetes ConfigMap and Secret Deployment Model

Kubernetes ConfigMap menyimpan non-confidential key-value data. Pod bisa mengonsumsinya sebagai env var, command-line argument, atau file volume. Kubernetes Secret menyimpan data sensitif kecil seperti password, token, atau key, dan mencegah secret ditaruh langsung di Pod spec atau container image.

### 21.1 ConfigMap sebagai env var

```yaml
envFrom:
  - configMapRef:
      name: case-service-config
```

Kelebihan:

- sederhana;
- cocok untuk banyak key kecil.

Kekurangan:

- perubahan ConfigMap tidak mengubah env var pada pod berjalan;
- key yang tidak valid sebagai env var bisa bermasalah;
- semua key masuk process environment jika `envFrom` dipakai.

### 21.2 ConfigMap sebagai file volume

```yaml
volumeMounts:
  - name: app-config
    mountPath: /etc/case-service
    readOnly: true

volumes:
  - name: app-config
    configMap:
      name: case-service-config
```

Kelebihan:

- cocok untuk YAML/properties kompleks;
- bisa berubah sebagai mounted file;
- tidak memenuhi env var.

Kekurangan:

- aplikasi harus reload sendiri;
- update propagation tidak instan;
- penggunaan `subPath` punya caveat update;
- permission/path harus dikelola.

### 21.3 Secret sebagai env var atau file

Sama seperti ConfigMap, tapi data sensitif.

Praktik umum:

```text
small password/token → env var or file
certificate/private key/truststore → mounted file
secret with rotation requirement → secret manager or mounted file + reload/restart strategy
```

---

## 22. ConfigMap/Secret Versioning Pattern

Jika ConfigMap diubah tetapi Deployment tidak berubah, Kubernetes belum tentu restart pod. Maka banyak tim memakai checksum annotation.

Contoh Helm-like pattern:

```yaml
spec:
  template:
    metadata:
      annotations:
        checksum/config: "{{ sha256sum config }}"
        checksum/secret: "{{ sha256sum secret }}"
```

Ketika config berubah, pod template berubah, sehingga Deployment rollout baru.

Untuk manual manifest, bisa gunakan versioned name:

```text
case-service-config-v42
case-service-secret-v17
```

Lalu Deployment refer ke versi itu:

```yaml
envFrom:
  - configMapRef:
      name: case-service-config-v42
```

Kelebihan versioned name:

- rollback eksplisit;
- tahu pod pakai config versi apa;
- audit lebih mudah.

Kekurangan:

- perlu cleanup versi lama;
- pipeline lebih kompleks.

---

## 23. systemd Environment and Config Files

Untuk deployment VM/bare-metal, systemd sering dipakai.

Contoh:

```ini
[Unit]
Description=Case Service
After=network.target

[Service]
User=case-service
Group=case-service
WorkingDirectory=/opt/case-service/current
EnvironmentFile=/etc/case-service/case-service.env
ExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/case-service/current/app.jar
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Contoh env file:

```bash
JAVA_OPTS="-Xms512m -Xmx1024m -Duser.timezone=UTC -Dfile.encoding=UTF-8"
SPRING_PROFILES_ACTIVE=prod
APP_CONFIG_LOCATION=/etc/case-service/application-prod.yml
```

Praktik baik:

- config file di `/etc/<app>`;
- artifact immutable di `/opt/<app>/releases/<version>`;
- symlink `/opt/<app>/current`;
- secrets permission `0400` atau `0440`;
- service user non-root;
- jangan edit artifact untuk mengubah config.

---

## 24. Config in Application Servers

Untuk WAR/EAR di application server, config sering datang dari:

```text
JNDI datasource
server.xml / standalone.xml
system properties
environment variables
deployment descriptors
shared library config
admin console
external properties file
```

Risiko app server:

- config diubah manual via console;
- server-level config memengaruhi banyak aplikasi;
- datasource binding berbeda antar node cluster;
- shared library version drift;
- JNDI name salah;
- admin console change tidak masuk Git;
- rollback artifact tidak rollback server config.

Praktik baik:

```text
Treat application server configuration as deployable infrastructure configuration.
```

Artinya:

- export/version config;
- automate datasource/JMS/JNDI setup;
- hindari manual console untuk production kecuali emergency;
- catat perubahan server config sebagai release evidence;
- samakan cluster node config.

---

## 25. Feature Flags vs Configuration

Feature flag adalah configuration, tetapi bukan semua configuration adalah feature flag.

### 25.1 Feature flag yang sehat

Feature flag cocok untuk:

- dark launch;
- canary enablement;
- gradual rollout;
- kill switch;
- tenant/module-specific exposure;
- operational mitigation.

Contoh:

```yaml
features:
  new-case-routing:
    enabled: false
    rollout-percentage: 0
    allowed-agencies: []
```

### 25.2 Feature flag debt

Feature flag menjadi debt jika:

- tidak punya owner;
- tidak punya expiry date;
- tidak dibersihkan setelah rollout;
- mengubah invariant domain;
- kombinasi flag tidak dites;
- flag name tidak jelas;
- production behavior sulit direkonstruksi.

Setiap flag penting harus punya metadata:

```text
name
purpose
owner
created date
expiry/removal date
default
allowed values
blast radius
rollback behavior
```

### 25.3 Kill switch berbeda dari feature toggle

Kill switch harus:

- cepat diaktifkan;
- aman secara default;
- jelas efeknya;
- tidak membuat data corrupt;
- terdokumentasi di runbook.

Contoh:

```yaml
integrations:
  external-case-sync:
    kill-switch: false
    kill-switch-behavior: stop-new-dispatch-drain-inflight
```

Jangan buat kill switch yang diam-diam membuang data.

---

## 26. Configuration and Deployment Pipeline

Configuration harus menjadi bagian dari pipeline, bukan manual step setelah deploy.

Pipeline ideal:

```text
1. Build artifact
2. Scan artifact
3. Publish artifact
4. Select environment config
5. Validate config schema
6. Validate secret references exist
7. Render deployment manifest
8. Diff against current deployment
9. Apply deployment
10. Verify effective config
11. Smoke test
12. Record evidence
```

### 26.1 Config schema validation

Bisa memakai:

```text
JSON Schema
OpenAPI-like config schema
Spring @ConfigurationProperties metadata + tests
OPA/Conftest
Kubernetes admission policy
Custom validation script
```

Validasi sebelum deploy:

```text
Required key exists.
No unknown critical key.
Value type valid.
Range valid.
Secret reference exists.
Production safety rule passed.
```

### 26.2 Deployment diff

Sebelum apply:

```text
What changed?
- artifact image tag changed from 1.8.13 to 1.8.14
- ConfigMap changed: onemap.request-timeout 5s → 10s
- Secret reference unchanged
- resources unchanged
- replicas 4 → 6
```

Tanpa diff, deployment adalah blind mutation.

---

## 27. Config Rollback: Lebih Sulit dari Artifact Rollback

Artifact rollback:

```text
my-service:1.8.14 → my-service:1.8.13
```

Config rollback:

```text
Which config version?
Which secret version?
Which feature flag state?
Was database migration already applied?
Did dynamic config change during incident?
```

Deployment yang matang memperlakukan release sebagai tuple:

```text
Release = Artifact Version + Config Version + Secret Version + Infrastructure Version + Database Version
```

Contoh release record:

```yaml
release-id: case-service-prod-2026-06-18-001
artifact:
  image: registry.internal/case-service:1.8.14-abc123
config:
  configmap: case-service-config-v42
secret:
  secret: case-service-secret-v17
infra:
  helm-chart: case-service-chart-0.9.3
schema:
  flyway-version: V20260618_01
```

Rollback harus jelas:

```text
Rollback artifact only?
Rollback config too?
Rollback secret reference too?
Database migration reversible?
Feature flag reset needed?
```

---

## 28. Environment-Specific Config Without Environment-Specific Code

Buruk:

```java
if (env.equals("prod")) {
    endpoint = "https://prod-api";
} else if (env.equals("uat")) {
    endpoint = "https://uat-api";
}
```

Baik:

```java
URI endpoint = config.externalApiBaseUrl();
```

Dan environment menentukan value:

```yaml
# uat
external:
  api:
    base-url: https://uat-api.internal

# prod
external:
  api:
    base-url: https://prod-api.internal
```

Aplikasi tidak perlu tahu nama environment kecuali untuk:

- safety guard;
- logging context;
- metrics label;
- explicit environment policy.

Jangan encode environment matrix di code.

---

## 29. Config Naming for Enterprise Systems

Untuk sistem besar, gunakan taxonomy yang konsisten.

Contoh prefix:

```text
app.*                 identity aplikasi
runtime.*             runtime behavior umum
server.*              HTTP/server binding
persistence.*         database/persistence
messaging.*           queue/event/broker
cache.*               Redis/local cache
external-services.*   integrasi keluar
security.*            authn/authz/TLS/token
features.*            feature flag
jobs.*                scheduler/batch job
observability.*       log/metrics/tracing/JFR
limits.*              rate/concurrency/size limit
```

Contoh:

```yaml
app:
  name: case-management-service
  instance-role: api

runtime:
  timezone: UTC
  shutdown-timeout: 30s

external-services:
  onemap:
    base-url: https://www.onemap.gov.sg
    connect-timeout: 2s
    request-timeout: 10s
    max-retry-attempts: 3

jobs:
  case-reconciliation:
    enabled: true
    cron: "0 */15 * * * *"
    lock-at-most-for: 10m
```

Naming yang baik mengurangi cognitive load saat incident.

---

## 30. Config Compatibility Across Versions

Saat aplikasi upgrade, config contract bisa berubah.

Contoh:

```text
v1 uses: external.onemap.timeout-ms
v2 uses: external.onemap.request-timeout
```

Jika config environment belum diubah, v2 gagal atau memakai default salah.

Strategi compatibility:

### 30.1 Backward-compatible alias

```text
Accept old key and new key for one release.
Warn if old key used.
Remove old key in later release.
```

Startup log:

```text
[CONFIG][DEPRECATED] external.onemap.timeout-ms is deprecated. Use external.onemap.request-timeout.
```

### 30.2 Config migration note

Release note harus menyebut:

```text
Required config changes:
- Rename external.onemap.timeout-ms to external.onemap.request-timeout.
- Value format changes from integer milliseconds to duration string.
```

### 30.3 Pipeline validation by app version

Config schema harus versi-aware:

```text
app version 1.8.x requires config schema 4.x
app version 1.9.x requires config schema 5.x
```

---

## 31. Config Observability: Metrik dan Audit

Configuration bukan hanya dibaca saat startup. Ia harus observable.

### 31.1 Metrics

Contoh metric:

```text
app_config_version_info{service="case-service",config_version="v42",secret_version="v17"} 1
app_feature_enabled{feature="new_case_routing"} 0
app_runtime_profile_info{profile="prod"} 1
```

### 31.2 Logs

Saat config berubah runtime:

```text
[CONFIG_CHANGE] feature=new-case-routing old=false new=true source=feature-flag-service actor=release-manager timestamp=...
```

### 31.3 Audit

Untuk config kritikal:

```text
who changed
what changed
old value hash / redacted value
new value hash / redacted value
when
why / ticket number
approval reference
rollout reference
```

Tanpa audit, dynamic config bisa menjadi backdoor operasional.

---

## 32. Failure Modes Configuration Deployment

### 32.1 Missing config

Gejala:

```text
Application fails to start.
NullPointerException.
Default accidentally used.
```

Mitigasi:

- required validation;
- fail fast;
- no dangerous default.

---

### 32.2 Wrong config source wins

Gejala:

```text
application-prod.yml says timeout 10s
but env var TIMEOUT=1s overrides it
```

Mitigasi:

- precedence documentation;
- effective config log;
- avoid duplicate keys.

---

### 32.3 Secret version mismatch

Gejala:

```text
Some pods use old password.
Some pods use new password.
DB authentication intermittent.
```

Mitigasi:

- versioned secret;
- rolling restart;
- dual validity;
- metric secret version.

---

### 32.4 Config changed but app not restarted

Gejala:

```text
ConfigMap updated.
Application behavior unchanged.
```

Mitigasi:

- checksum annotation;
- rollout trigger;
- reload strategy.

---

### 32.5 Wrong profile active

Gejala:

```text
UAT endpoint used in PROD.
Mock provider active in PROD.
```

Mitigasi:

- startup safety guard;
- environment label validation;
- smoke test dependency endpoints.

---

### 32.6 Unit mismatch

Gejala:

```text
timeout=30 interpreted as 30ms, not 30s.
```

Mitigasi:

- explicit duration type;
- naming suffix;
- validation range.

---

### 32.7 Boolean flag ambiguity

Gejala:

```text
feature disabled unexpectedly.
```

Common causes:

```text
FEATURE_ENABLED=false
FEATURE_ENABLED="false"
FEATURE_ENABLED=0
FEATURE_ENABLED=no
FEATURE_ENABLED missing
```

Mitigasi:

- strict parser;
- explicit allowed values;
- log effective values.

---

### 32.8 Config drift across replicas

Gejala:

```text
Pod A behaves differently from Pod B.
```

Mitigasi:

- immutable config version per rollout;
- no manual pod editing;
- config version metric;
- restart all replicas.

---

### 32.9 Dynamic config race

Gejala:

```text
Half of requests use old feature behavior.
Half use new behavior.
Data inconsistent.
```

Mitigasi:

- request-scoped config snapshot;
- rollout flag gradually;
- avoid dynamic change for domain invariants.

---

## 33. Configuration Testing Strategy

### 33.1 Unit test config binding

```java
class CaseSyncPropertiesTest {
    @Test
    void rejectsInvalidConcurrency() {
        // bind worker-concurrency=0 and assert validation fails
    }
}
```

### 33.2 Environment config test

Validate real `application-uat.yml` and `application-prod.yml` against schema.

```text
All required keys present.
No unknown keys.
No DEV endpoint in PROD.
No mock provider in PROD.
Timeout within allowed range.
Secret references exist.
```

### 33.3 Deployment smoke test

After deployment:

```text
GET /actuator/health/readiness
GET /internal/config-summary sanitized
Check DB connection actual target
Check external API DNS target
Check feature flag values
Check metrics labels
```

### 33.4 Chaos-like config test

Test failure scenarios:

```text
missing secret
bad DB password
invalid URL
expired certificate
wrong profile
ConfigMap update without restart
```

Tujuannya bukan membuat production gagal, tetapi memastikan failure mode dikenal sebelum production.

---

## 34. Production Checklist: Configuration Deployment

Sebelum deploy:

```text
[ ] Artifact tidak mengandung secret.
[ ] Artifact sama untuk semua environment.
[ ] Config source dan precedence terdokumentasi.
[ ] Required config tervalidasi.
[ ] Secret reference valid.
[ ] Config diff sudah direview.
[ ] Tidak ada DEV/UAT endpoint di PROD config.
[ ] Profile aktif benar.
[ ] JVM/system properties eksplisit.
[ ] Timezone dan encoding eksplisit.
[ ] ConfigMap/Secret change memicu rollout atau reload strategy jelas.
[ ] Startup log menampilkan effective config yang disanitasi.
[ ] Rollback config version diketahui.
[ ] Secret rotation plan diketahui jika ada perubahan secret.
[ ] Smoke test memverifikasi behavior, bukan hanya pod running.
```

---

## 35. Design Pattern: Configuration Contract Document

Untuk service production, buat dokumen config contract.

Contoh:

```markdown
# Case Service Configuration Contract

## app.name
- Type: string
- Required: yes
- Default: none
- Source: artifact default or env override
- Sensitive: no
- Reloadable: no
- Example: case-service

## external.onemap.base-url
- Type: URI
- Required: yes if external.onemap.enabled=true
- Default: none
- Source: ConfigMap
- Sensitive: no
- Reloadable: restart-required
- Validation: must be HTTPS in PROD

## external.onemap.client-secret
- Type: secret string
- Required: yes if external.onemap.enabled=true
- Source: Secret Manager / Kubernetes Secret
- Sensitive: yes
- Reloadable: restart-required unless client supports refresh
- Rotation: dual-secret window required

## external.onemap.request-timeout
- Type: duration
- Required: no
- Default: 10s
- Source: ConfigMap
- Sensitive: no
- Reloadable: runtime-safe if HTTP client supports refresh, otherwise restart-required
- Validation: 100ms..60s
```

Dokumen ini membuat konfigurasi bisa dikelola oleh tim, bukan hanya diingat oleh satu developer.

---

## 36. Practical Blueprint: Java Config Architecture

Untuk Java service modern, blueprint yang kuat:

```text
1. Artifact contains safe defaults only.
2. Environment config stored outside artifact.
3. Secrets stored outside normal config.
4. Typed configuration binding.
5. Startup validation.
6. Sanitized effective config log.
7. Config version included in metrics/logs.
8. Config changes go through pipeline.
9. ConfigMap/Secret changes trigger rollout unless explicitly hot reloadable.
10. Secret rotation uses dual-validity window.
11. Feature flags have owner and expiry.
12. Rollback treats artifact+config+secret as one release tuple.
```

For Spring Boot:

```text
@ConfigurationProperties
@Validated
external application.yml
Kubernetes ConfigMap for non-secret
Kubernetes Secret or secret manager for secret
checksum annotation to trigger rollout
actuator health + sanitized config summary
```

For Jakarta/MicroProfile:

```text
MicroProfile Config
ConfigSource ordinal policy
server-level config automated
JNDI/datasource binding versioned
secret mounted or provided by platform
startup validation bean
```

For legacy Java 8/service VM:

```text
/etc/myapp/*.properties
systemd EnvironmentFile
separate secret file with strict permissions
startup config validation
release symlink pattern
manual rollback runbook
```

---

## 37. Anti-Pattern Catalog

### Anti-pattern 1 — Secret in Git

```text
application-prod.yml contains password.
```

Consequence:

```text
Credential leak, audit failure, rotation pain.
```

---

### Anti-pattern 2 — Rebuild per environment

```text
mvn package -Pprod
```

Consequence:

```text
Artifact identity differs per environment.
Promotion evidence weak.
```

---

### Anti-pattern 3 — Dangerous defaults

```yaml
security:
  enabled: false
```

Consequence:

```text
Missing config disables security.
```

Safe default should be secure or fail startup.

---

### Anti-pattern 4 — Profile controls too much behavior

```text
prod profile uses real implementation.
uat profile uses fake implementation.
```

Consequence:

```text
UAT no longer proves production behavior.
```

---

### Anti-pattern 5 — Manual console config

```text
Admin changes datasource in app server console.
No Git record.
```

Consequence:

```text
Config drift, rollback impossible, audit weak.
```

---

### Anti-pattern 6 — Config update without rollout semantics

```text
ConfigMap changed.
No pod restarted.
Team assumes change applied.
```

Consequence:

```text
Incident debugging confusion.
```

---

### Anti-pattern 7 — Logging all environment variables

```java
System.getenv().forEach(log::info);
```

Consequence:

```text
Secret leak.
```

---

### Anti-pattern 8 — No config version identity

```text
Cannot answer which config a running pod uses.
```

Consequence:

```text
RCA weak, rollback guesswork.
```

---

## 38. Senior Engineer Heuristics

Saat melihat konfigurasi deployment, tanyakan:

```text
Can I rebuild the same artifact and deploy it to all environments?
Can I explain which source wins if the same key appears twice?
Can the application fail fast on missing critical config?
Can I rotate every secret without emergency downtime?
Can I prove which config version is running now?
Can I rollback config separately or together with artifact?
Can I detect if a pod uses stale config?
Can I prevent DEV endpoint from being used in PROD?
Can I audit who changed runtime behavior?
Can I tell which config requires restart and which can reload?
```

Jika jawabannya banyak “tidak tahu”, deployment belum mature.

---

## 39. Mini Case Study: External API Token Migration

Bayangkan service Java sebelumnya memanggil external API tanpa token. Provider mengubah requirement: mulai tanggal tertentu, semua request harus memakai token.

Config yang dibutuhkan:

```yaml
external-services:
  provider-x:
    enabled: true
    base-url: https://provider-x.internal
    token-url: https://provider-x.internal/oauth/token
    client-id: aceas-case-service
    connect-timeout: 2s
    request-timeout: 10s
    token-cache-ttl-skew: 60s
    retry:
      max-attempts: 3
      backoff: 250ms
```

Secret:

```text
provider-x.client-secret
```

Deployment design:

```text
1. Add code supporting token auth but keep feature disabled.
2. Add config schema and validation.
3. Add secret to secret manager/Kubernetes Secret.
4. Deploy to DEV with token feature enabled.
5. Verify token fetch, cache, refresh, 401 retry.
6. Deploy to UAT.
7. Enable provider token auth via config/flag.
8. Deploy to PROD before cutover date.
9. Monitor token fetch failure, API 401/403/429, latency.
10. Keep rollback path: disable token feature only if provider still accepts old mode.
```

Key insight:

```text
The deployment is not only code. It is code + config + secret + provider readiness + monitoring + rollback semantics.
```

---

## 40. Mini Case Study: Wrong Config Causes Production Incident

Scenario:

```text
A Java service is deployed successfully.
Pods are Running.
Readiness is green.
But users report timeout.
```

Investigation:

```text
UAT config:
external.document-service.request-timeout=60s

PROD config:
external.document-service.request-timeout=5s
```

A new document generation flow takes 8–12 seconds in PROD due to larger data volume.

Root causes:

```text
1. Config drift between UAT and PROD not reviewed.
2. Smoke test only checked health endpoint.
3. Timeout config had no documented rationale.
4. No synthetic transaction for large document generation.
5. Effective config was not logged in a searchable way.
```

Corrective actions:

```text
1. Add config diff review to pipeline.
2. Add timeout range and owner documentation.
3. Add synthetic document generation check.
4. Add effective config summary log.
5. Add release note requiring PROD timeout verification.
```

This is deployment engineering, not merely application debugging.

---

## 41. Mental Model Summary

Configuration deployment is the practice of binding one immutable artifact to a specific operational environment safely.

The core model:

```text
Artifact = what can run.
Configuration = how it should run here.
Secret = sensitive authority needed to run.
Profile = coarse selection of behavior/config group.
Deployment = binding artifact + config + secret + infrastructure.
Release = auditable promotion of that binding.
Operation = proving the binding behaves safely.
```

Configuration is not just key-value data. It is a contract with lifecycle, ownership, precedence, validation, sensitivity, reloadability, auditability, and rollback semantics.

Top-tier engineers do not ask only:

```text
Where do I put this property?
```

They ask:

```text
Who owns it?
What is its safe default?
What validates it?
Can it change at runtime?
How is it rotated?
How is it audited?
How do I prove which value is active?
What is the rollback path?
What is the blast radius if it is wrong?
```

---

## 42. References

- Spring Boot Reference Documentation — Externalized Configuration: https://docs.spring.io/spring-boot/reference/features/external-config.html
- Spring Boot Reference Documentation — Properties and Configuration: https://docs.spring.io/spring-boot/how-to/properties-and-configuration.html
- MicroProfile Config 3.1 Specification: https://microprofile.io/specifications/config/3-1/
- MicroProfile Config overview/specification pages: https://microprofile.io/specifications/microprofile-config-2/
- Kubernetes Documentation — ConfigMaps: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes Documentation — Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- Kubernetes Documentation — Define Environment Variables for a Container: https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/
- Kubernetes Documentation — Configure a Pod to Use a ConfigMap: https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/
- The Twelve-Factor App — Config: https://12factor.net/config

---

## 43. Apa yang Harus Kamu Kuasai Setelah Part Ini

Kamu harus bisa:

1. Membedakan config biasa, secret, profile, feature flag, dan JVM option.
2. Mendesain precedence config yang eksplisit.
3. Menjelaskan kenapa artifact harus environment-neutral.
4. Menentukan kapan memakai env var, file config, system property, ConfigMap, Secret, atau secret manager.
5. Mendesain config yang typed, validated, dan auditable.
6. Menentukan config mana yang butuh restart dan mana yang bisa reload.
7. Membuat config rollback model.
8. Mendeteksi config drift.
9. Menulis checklist deployment config production-grade.
10. Melihat configuration sebagai bagian dari release tuple, bukan detail kecil.

---

## 44. Jembatan ke Part Berikutnya

Part berikutnya adalah:

```text
Part 6 — JVM Options as Deployment Contract
```

Di sana kita akan memperlakukan JVM options bukan sebagai tuning random, tetapi sebagai kontrak deployment yang menentukan memory boundary, CPU behavior, diagnostics, crash evidence, TLS behavior, timezone, encoding, module access, dan compatibility Java 8–25.

