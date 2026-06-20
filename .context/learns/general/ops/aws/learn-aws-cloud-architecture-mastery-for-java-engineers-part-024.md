# learn-aws-cloud-architecture-mastery-for-java-engineers-part-024.md

# Part 024 — Configuration and Secrets: Parameter Store, Secrets Manager, AppConfig, Runtime Flags

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus bagian ini: configuration, secrets, runtime flags, safe rollout, dan operational control di AWS  
> Status seri: belum selesai

---

## 0. Tujuan Pembelajaran

Di bagian ini kita belajar membedakan **configuration**, **secret**, dan **runtime behavior control**. Banyak sistem produksi tidak gagal karena kode utamanya salah, tetapi karena konfigurasi berubah tanpa kontrol, secret bocor, flag menyala terlalu luas, credential tidak ter-rotate, service membaca config terlalu sering, atau perubahan config tidak punya rollback path.

Setelah bagian ini, Anda harus mampu:

1. membedakan build-time config, deploy-time config, runtime config, secret, dan feature flag;
2. memilih antara AWS Systems Manager Parameter Store, AWS Secrets Manager, AWS AppConfig, environment variable, dan IaC parameter;
3. mendesain hierarchy konfigurasi untuk multi-account, multi-environment, multi-tenant workload;
4. menerapkan secret lifecycle: creation, access, caching, rotation, revocation, audit;
5. memahami risiko membaca config secara live dari aplikasi Java;
6. membuat rollout konfigurasi yang aman dengan validator, deployment strategy, alarm, dan rollback;
7. membangun mental model untuk runtime flags tanpa menciptakan state machine tersembunyi;
8. menghindari failure mode seperti stale config, config drift, secret leakage, config stampede, dan inconsistent rollout.

Bagian ini tidak mengulang topik Java configuration framework secara umum seperti Spring profiles, `.properties`, YAML binding, atau dependency injection. Kita hanya membahas bagaimana konfigurasi dan secret menjadi bagian dari **AWS production architecture**.

---

## 1. Core Mental Model

Configuration adalah **input yang mengubah perilaku sistem tanpa mengubah kode**.

Secret adalah **configuration yang jika bocor dapat memberi akses tidak sah**.

Feature flag adalah **runtime decision point** yang mengubah jalur eksekusi sistem.

AppConfig adalah **controlled deployment system untuk configuration dan feature flags**.

Parameter Store adalah **hierarchical key-value store untuk configuration dan sebagian secret sederhana**.

Secrets Manager adalah **secret lifecycle system dengan rotation dan integrasi secret-aware**.

Kesalahan besar yang sering terjadi adalah memperlakukan semua hal sebagai environment variable atau semua hal sebagai secret. Padahal masing-masing punya lifecycle, audit requirement, access pattern, failure mode, dan cost profile yang berbeda.

---

## 2. Taxonomy: Jenis-Jenis Configuration

Sebelum memilih service, klasifikasikan dulu datanya.

### 2.1 Build-Time Configuration

Build-time configuration adalah nilai yang dipakai saat artifact dibuat.

Contoh:

- Java version;
- Maven profile untuk menghasilkan artifact tertentu;
- dependency version;
- code generation target;
- compiler flag;
- container base image;
- frontend asset build parameter.

Karakteristik:

- berubah membutuhkan rebuild;
- harus deterministic;
- cocok masuk repository atau pipeline definition;
- tidak cocok untuk secret runtime;
- biasanya tidak environment-specific kecuali artifact memang sengaja dibedakan.

Prinsip penting: **jangan bake secret ke artifact**.

Artifact Java yang sama sebaiknya bisa dipromosikan dari dev ke staging ke prod dengan konfigurasi deploy/runtime berbeda. Ini menjaga prinsip `build once, promote same artifact` dari Part 023.

### 2.2 Deploy-Time Configuration

Deploy-time configuration adalah nilai yang dipilih ketika workload di-deploy.

Contoh:

- nama S3 bucket;
- ARN queue;
- DynamoDB table name;
- endpoint internal service;
- CPU/memory task ECS;
- desired count;
- JVM heap size;
- environment name;
- log level awal;
- feature group default.

Karakteristik:

- sering dikelola IaC;
- berubah melalui pipeline;
- bisa berbeda antar environment;
- biasanya masuk task definition, Lambda environment variable, EC2 user data, atau config file yang di-render saat deploy.

Deploy-time config cocok untuk hal yang jarang berubah dan perubahan harus melalui review.

### 2.3 Runtime Configuration

Runtime configuration adalah nilai yang bisa berubah setelah service berjalan.

Contoh:

- threshold fraud score;
- limit batch size;
- cache TTL;
- routing percentage;
- enable/disable integration tertentu;
- business rule parameter;
- per-tenant feature entitlement;
- retry limit untuk operasi tertentu;
- UI copy/notice tertentu.

Karakteristik:

- dapat berubah tanpa redeploy;
- perlu validasi ketat;
- perlu audit trail;
- perlu rollout strategy;
- perlu rollback cepat;
- perlu konsistensi yang cukup jelas.

Runtime config adalah pedang bermata dua. Ia membuat sistem fleksibel, tetapi juga dapat menciptakan perilaku produksi yang tidak bisa direkonstruksi dari Git commit saja.

### 2.4 Secret

Secret adalah nilai yang memberi akses atau membuktikan identitas.

Contoh:

- database password;
- API token pihak ketiga;
- OAuth client secret;
- webhook signing secret;
- private key;
- credential SMTP;
- encryption material eksternal;
- license key yang sensitif.

Karakteristik:

- harus dienkripsi;
- harus dibatasi aksesnya;
- harus diaudit;
- idealnya bisa di-rotate;
- tidak boleh muncul di log;
- tidak boleh masuk Git;
- tidak boleh masuk container image;
- tidak boleh disebar ke terlalu banyak runtime.

### 2.5 Feature Flag

Feature flag adalah decision point yang menentukan apakah suatu behavior aktif.

Contoh:

- `new_case_assignment_enabled`;
- `use_new_risk_score_engine`;
- `enable_async_document_analysis`;
- `tenant_x_new_dashboard`;
- `route_10_percent_to_new_workflow`;
- `disable_external_registry_lookup`.

Feature flag bukan sekadar boolean. Ia bisa menjadi:

- kill switch;
- release flag;
- experiment flag;
- permission/entitlement flag;
- operational flag;
- migration flag;
- circuit breaker manual;
- tenant segmentation rule.

Risiko feature flag: semakin lama dibiarkan, semakin banyak jalur state yang harus diuji.

---

## 3. Decision Matrix: Di Mana Nilai Harus Disimpan?

| Jenis Nilai | Contoh | Tempat Umum | Alasan |
|---|---|---|---|
| Static build setting | Java target version | Git / build file | bagian dari artifact |
| Infrastructure reference | SQS queue ARN | IaC output / env var | dibuat saat deploy |
| Non-secret app config | batch size default | Parameter Store / AppConfig | dapat dikelola terpusat |
| Secret sederhana tanpa rotation kompleks | internal token sementara | Parameter Store SecureString atau Secrets Manager | tergantung lifecycle |
| Secret dengan rotation/audit kuat | DB password, API key | Secrets Manager | lifecycle secret lebih lengkap |
| Runtime feature flag | enable new workflow | AppConfig | safe rollout + validation |
| Emergency kill switch | disable external call | AppConfig | perubahan cepat dan terkontrol |
| Per-tenant entitlement | tenant feature access | database/domain config, kadang AppConfig | bagian dari model bisnis |
| Large business ruleset | policy table/rules | domain DB/rules engine | harus queryable dan auditable domain-level |

Rule of thumb:

- gunakan **environment variable** untuk bootstrap config yang kecil dan stabil;
- gunakan **Parameter Store** untuk hierarchical config sederhana;
- gunakan **Secrets Manager** untuk secret yang butuh lifecycle, rotation, atau secret-specific integration;
- gunakan **AppConfig** untuk runtime config/feature flag yang butuh rollout aman;
- gunakan **database domain** untuk configuration yang sebenarnya adalah data bisnis.

---

## 4. Environment Variables: Berguna, Tapi Jangan Dijadikan Sistem Config Utama

Environment variable cocok untuk bootstrap.

Contoh:

```text
APP_ENV=prod
AWS_REGION=ap-southeast-1
CONFIG_PATH=/prod/case-service/
APP_CONFIG_APPLICATION=case-platform
APP_CONFIG_ENVIRONMENT=prod
APP_CONFIG_PROFILE=case-service-runtime
```

Kelebihan:

- sederhana;
- didukung EC2, ECS, Lambda, container runtime;
- mudah dibaca framework Java;
- tidak perlu network call saat startup jika nilainya lengkap.

Kelemahan:

- perubahan biasanya butuh restart/redeploy;
- secret di environment variable bisa terekspos di dump, console, task definition, atau log jika ceroboh;
- tidak punya rollout gradual;
- tidak punya validation native;
- tidak cocok untuk config besar atau sering berubah.

Gunakan environment variable untuk menunjuk **ke mana config utama diambil**, bukan untuk menyimpan semua config.

---

## 5. AWS Systems Manager Parameter Store

Parameter Store menyediakan penyimpanan hierarchical untuk configuration data dan secrets management sederhana. AWS mendokumentasikan Parameter Store sebagai tempat untuk menyimpan configuration data seperti connection string, environment variable, endpoint service, resource identifier, dan tuning parameter. Parameter Store juga mendukung versioning dan parameter hierarchy.

### 5.1 Mental Model Parameter Store

Parameter Store adalah hierarchical parameter registry.

Parameter punya:

- name;
- type;
- value;
- version;
- tier;
- optional policy;
- IAM access control;
- optional KMS encryption untuk `SecureString`;
- tags.

Contoh hierarchy:

```text
/org/acme/prod/case-service/server/port
/org/acme/prod/case-service/database/read-endpoint
/org/acme/prod/case-service/integration/registry/base-url
/org/acme/prod/case-service/batch/max-size
/org/acme/prod/case-service/cache/case-summary-ttl-seconds
/org/acme/prod/case-service/features/async-document-analysis-default
```

Hierarchy yang baik membuat IAM policy lebih natural.

Contoh policy intent:

```text
case-service-prod-task-role boleh membaca /org/acme/prod/case-service/*
case-service-prod-task-role tidak boleh membaca /org/acme/staging/*
worker-service-prod-task-role tidak boleh membaca config service lain kecuali shared config tertentu
```

### 5.2 Parameter Types

Parameter Store mendukung beberapa tipe utama:

1. `String`
2. `StringList`
3. `SecureString`

Gunakan `String` untuk konfigurasi non-secret.

Gunakan `StringList` secara hati-hati. Untuk konfigurasi kompleks, JSON sering lebih eksplisit daripada comma-separated string.

Gunakan `SecureString` untuk nilai sensitif sederhana yang dienkripsi dengan KMS.

Namun, jangan otomatis menggunakan `SecureString` untuk semua secret produksi. Untuk secret dengan rotation lifecycle, Secrets Manager biasanya lebih tepat.

### 5.3 Parameter Tier

Parameter Store memiliki tier. Secara praktis, tier memengaruhi limit, ukuran nilai, policy, throughput, dan biaya.

Gunakan standard tier untuk konfigurasi sederhana.

Gunakan advanced tier jika butuh:

- nilai lebih besar;
- parameter policy;
- limit lebih tinggi;
- lifecycle policy seperti expiration.

### 5.4 Versioning dan Labels

Setiap perubahan parameter menghasilkan version baru.

Ini penting untuk audit dan rollback.

Contoh:

```text
/org/acme/prod/case-service/batch/max-size
version 12 = 100
version 13 = 250
version 14 = 500
```

Masalah umum: aplikasi hanya membaca latest tanpa mencatat version yang digunakan.

Untuk sistem regulated, log startup harus mencatat:

```json
{
  "event": "CONFIG_LOADED",
  "parameter": "/org/acme/prod/case-service/batch/max-size",
  "version": 14,
  "source": "ssm-parameter-store"
}
```

Dengan begitu, ketika behavior berubah, tim bisa mengaitkan incident dengan versi config.

### 5.5 Access Pattern

Ada dua pola utama:

1. read at startup;
2. read periodically / on demand.

#### Read at Startup

Cocok untuk:

- endpoint dependency;
- resource name;
- static limit;
- config jarang berubah.

Kelebihan:

- sederhana;
- stabil;
- tidak membebani Parameter Store;
- behavior konsisten sampai restart.

Kekurangan:

- perubahan butuh restart/redeploy;
- emergency change lebih lambat.

#### Periodic Refresh

Cocok untuk:

- operational threshold;
- feature defaults;
- kill switch sederhana;
- low-frequency runtime tuning.

Risiko:

- stale config antar instance;
- config stampede;
- inconsistent behavior saat rollout;
- perlu cache, TTL, dan error policy.

Prinsip: **jangan membaca Parameter Store pada setiap request user**.

Jika setiap request Java API memanggil `GetParameter`, Anda menciptakan dependency latency dan availability baru di critical path.

### 5.6 Java Pattern: Parameter Store Config Loader

Pseudo-code:

```java
public final class ParameterStoreConfigLoader {
    private final SsmClient ssm;
    private final String path;

    public ParameterStoreConfigLoader(SsmClient ssm, String path) {
        this.ssm = ssm;
        this.path = path;
    }

    public Map<String, String> loadByPath() {
        Map<String, String> result = new HashMap<>();
        String nextToken = null;

        do {
            GetParametersByPathResponse response = ssm.getParametersByPath(r -> r
                .path(path)
                .recursive(true)
                .withDecryption(true)
                .nextToken(nextToken)
            );

            for (Parameter p : response.parameters()) {
                result.put(p.name(), p.value());
            }

            nextToken = response.nextToken();
        } while (nextToken != null);

        return result;
    }
}
```

Production notes:

- use pagination;
- set SDK timeout;
- retry with bounded backoff;
- cache result;
- log parameter names and versions, not secret values;
- fail fast if required config missing;
- allow degraded defaults only for explicitly safe config;
- avoid `withDecryption(true)` unless needed;
- do not grant broad KMS decrypt.

---

## 6. AWS Secrets Manager

Secrets Manager adalah layanan untuk menyimpan, mengambil, mengelola, dan merotasi secret. AWS mendokumentasikan bahwa Secrets Manager dapat mengonfigurasi automatic rotation schedule sehingga aplikasi tidak perlu redeploy setiap kali credential berubah.

### 6.1 Mental Model Secrets Manager

Secrets Manager bukan sekadar encrypted key-value store.

Ia adalah secret lifecycle system.

Secret punya:

- ARN;
- name;
- secret value;
- version;
- staging label;
- KMS key;
- resource policy;
- rotation configuration;
- CloudTrail audit;
- optional replica;
- tags.

Secret version biasanya punya staging label seperti:

- `AWSCURRENT`
- `AWSPREVIOUS`
- `AWSPENDING`

Rotation workflow menggunakan label tersebut untuk mengontrol transisi.

### 6.2 Secrets Manager vs Parameter Store SecureString

| Kriteria | Parameter Store SecureString | Secrets Manager |
|---|---|---|
| Config hierarchy | kuat | tidak se-hierarchical Parameter Store |
| Secret rotation | terbatas/manual | native rotation workflow |
| Secret lifecycle | sederhana | lebih lengkap |
| Cost | sering lebih murah untuk simple config | lebih mahal per secret/API call |
| DB credential integration | tidak sekuat Secrets Manager | kuat |
| Caching library | bisa manual | ada guidance/library caching |
| Audit secret retrieval | tersedia via CloudTrail | tersedia via CloudTrail |
| Cocok untuk | simple encrypted parameter | production secret dengan lifecycle |

Rule praktis:

- secret produksi yang memberi akses ke database atau third-party critical system: **Secrets Manager**;
- encrypted configuration kecil yang jarang berubah: **Parameter Store SecureString**;
- value bukan secret: jangan pakai secret store hanya karena “lebih aman”.

### 6.3 Secret Shape

Secret value dapat berupa string JSON.

Contoh:

```json
{
  "username": "case_app",
  "password": "REDACTED",
  "host": "db.example.internal",
  "port": 5432,
  "dbname": "case_management"
}
```

Namun, desain secret harus hati-hati.

Jangan campur terlalu banyak concern dalam satu secret.

Buruk:

```json
{
  "dbPassword": "...",
  "slackWebhook": "...",
  "stripeApiKey": "...",
  "jwtPrivateKey": "..."
}
```

Mengapa buruk?

- IAM access jadi terlalu luas;
- rotation lifecycle berbeda;
- blast radius membesar;
- audit retrieval tidak spesifik;
- satu consumer mendapat secret yang tidak dibutuhkan.

Lebih baik:

```text
/prod/case-service/db/app-user
/prod/case-service/external-registry/api-token
/prod/case-service/jwt/signing-key
/prod/notification-service/email-provider/api-key
```

### 6.4 Rotation

Rotation berarti memperbarui secret di Secrets Manager dan di target system yang menggunakan credential tersebut.

Untuk database credential, rotation bukan hanya mengganti value di Secrets Manager. Target database juga harus menerima credential baru.

Rotation failure mode:

- secret berubah, database belum berubah;
- database berubah, aplikasi masih memakai old connection;
- connection pool tidak refresh;
- rotation Lambda gagal setelah sebagian langkah;
- aplikasi cache secret terlalu lama;
- secret policy mengizinkan consumer lama tetap membaca secret;
- credential lama tidak dicabut.

### 6.5 Java Secret Retrieval Pattern

AWS merekomendasikan caching secret value, bukan mengambil secret pada setiap operasi. Untuk Java, gunakan caching atau implementasi cache sendiri dengan TTL dan refresh policy.

Pseudo-code:

```java
public final class CachedSecretProvider {
    private final SecretsManagerClient client;
    private final String secretId;
    private volatile CachedSecret cached;

    public SecretValue get() {
        CachedSecret current = cached;
        if (current != null && !current.isExpired()) {
            return current.value();
        }

        synchronized (this) {
            current = cached;
            if (current != null && !current.isExpired()) {
                return current.value();
            }

            GetSecretValueResponse response = client.getSecretValue(r -> r.secretId(secretId));
            SecretValue parsed = parse(response.secretString());
            cached = new CachedSecret(parsed, Instant.now().plus(Duration.ofMinutes(5)), response.versionId());
            return parsed;
        }
    }
}
```

Production notes:

- cache secrets;
- never log secret value;
- log secret ARN/name only if not sensitive;
- use least privilege IAM;
- use KMS key policy intentionally;
- monitor `GetSecretValue` failures;
- handle rotation with connection pool refresh;
- avoid secret retrieval inside hot request path.

### 6.6 Database Password Rotation and Java Connection Pools

Java service sering memakai HikariCP atau pool serupa.

Problem:

- secret rotated;
- existing DB connections masih authenticated dengan old password;
- new connections perlu password baru;
- pool mungkin terus mencoba old password sampai restart;
- aplikasi terlihat sehat sampai koneksi baru dibuat.

Mitigation:

1. gunakan rotation strategy yang mendukung overlapping credential jika tersedia;
2. pilih DB user rotation pattern yang aman;
3. set max connection lifetime lebih pendek dari rotation window;
4. refresh DataSource saat secret version berubah;
5. expose health check yang mendeteksi ability membuat koneksi baru;
6. lakukan rotation test di staging;
7. monitor auth failure DB setelah rotation.

Pseudo-pattern:

```text
Secret version changes
        ↓
Secret cache observes new version
        ↓
Connection pool is softly evicted
        ↓
New connections use new password
        ↓
Old connections drain
```

### 6.7 Secret Access Control

Policy harus menjawab:

- workload mana boleh membaca secret ini?
- admin mana boleh update secret?
- role mana boleh rotate secret?
- KMS key mana dipakai?
- account mana boleh akses?
- apakah akses harus lewat VPC endpoint?
- apakah akses cross-account diizinkan?

Contoh intent IAM:

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "secretsmanager:DescribeSecret"
  ],
  "Resource": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:prod/case-service/db/app-user-*"
}
```

Jika secret menggunakan customer managed KMS key, role juga perlu izin `kms:Decrypt` pada key tersebut.

---

## 7. AWS AppConfig

AWS AppConfig membantu deployment feature flags dan dynamic configuration agar aplikasi bisa menyesuaikan behavior produksi secara cepat dan aman. AWS mendokumentasikan AppConfig untuk feature flags dan dynamic configuration, termasuk deployment strategy bertahap dan validator.

### 7.1 Mental Model AppConfig

AppConfig adalah deployment system untuk configuration.

Bukan hanya store.

Konsep utama:

- Application;
- Environment;
- Configuration Profile;
- Hosted Configuration Version atau source eksternal;
- Deployment Strategy;
- Validators;
- Deployment;
- AppConfig Agent / Data API.

Perbedaan penting:

- Parameter Store: tempat menyimpan config;
- Secrets Manager: secret lifecycle;
- AppConfig: cara me-rollout runtime config dengan kontrol keselamatan.

### 7.2 Apa yang Cocok di AppConfig?

Cocok:

- feature flags;
- operational kill switch;
- threshold runtime;
- allowlist/blocklist kecil;
- routing percentage;
- circuit breaker manual;
- business rule parameter kecil;
- integration enablement;
- per-environment runtime behavior.

Tidak cocok:

- secret;
- data bisnis besar;
- transactional state;
- high-frequency mutable state;
- per-request decision data besar;
- configuration yang harus strong consistent antar semua instance pada milidetik yang sama.

### 7.3 Feature Flag Types

#### Release Flag

Dipakai untuk melepas fitur bertahap.

```json
{
  "newCaseAssignmentUi": {
    "enabled": true
  }
}
```

Harus dihapus setelah fitur stabil.

#### Operational Flag

Dipakai untuk mengubah behavior operasional.

```json
{
  "externalRegistryLookup": {
    "enabled": false,
    "reason": "provider incident"
  }
}
```

Harus punya runbook.

#### Kill Switch

Dipakai untuk menghentikan jalur berbahaya dengan cepat.

```json
{
  "documentAutoEscalation": {
    "enabled": false
  }
}
```

Kill switch harus diuji.

#### Migration Flag

Dipakai untuk transisi sistem lama ke baru.

```json
{
  "caseSearchReadModel": {
    "mode": "dual_read_compare"
  }
}
```

Harus punya lifecycle jelas.

#### Entitlement Flag

Dipakai untuk hak akses tenant/customer.

Hati-hati: jika ini adalah data bisnis permanen, lebih cocok di database domain daripada feature flag platform.

### 7.4 Deployment Strategy

Deployment strategy menjawab:

- berapa cepat config menyebar?
- apakah rollout linear atau exponential?
- berapa bake time?
- alarm apa yang bisa menghentikan rollout?
- bagaimana rollback?

Contoh strategi:

```text
10% every 10 minutes, bake 30 minutes, rollback on 5xx alarm
```

Untuk config berisiko tinggi:

```text
1% → 5% → 10% → 25% → 50% → 100%
```

Untuk emergency kill switch:

```text
all-at-once
```

Tetapi all-at-once hanya aman jika value dan behavior-nya sudah diuji.

### 7.5 Validators

Validator adalah kontrol sebelum config diterapkan.

Jenis validator:

- JSON schema validator;
- Lambda validator.

JSON schema cocok untuk struktur.

Lambda validator cocok untuk aturan yang lebih kompleks:

- threshold tidak boleh melebihi batas;
- endpoint harus valid;
- feature A dan B tidak boleh aktif bersamaan;
- mode tertentu hanya boleh di staging;
- tenant list harus ada di registry.

Contoh JSON schema konseptual:

```json
{
  "type": "object",
  "properties": {
    "externalRegistryLookup": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "timeoutMillis": {
          "type": "integer",
          "minimum": 100,
          "maximum": 3000
        }
      },
      "required": ["enabled", "timeoutMillis"]
    }
  },
  "required": ["externalRegistryLookup"]
}
```

### 7.6 Java Runtime AppConfig Pattern

Java service dapat membaca AppConfig melalui:

- AppConfig Data API;
- AppConfig Agent;
- sidecar/local agent pattern;
- cached client abstraction.

Pattern yang baik:

```text
Application startup
        ↓
Load baseline config
        ↓
Start background refresh loop
        ↓
Validate/parse into typed config object
        ↓
Atomic swap immutable config reference
        ↓
Request path reads local in-memory config
```

Jangan:

```text
Every HTTP request → call AppConfig API → decide behavior
```

Itu menambah latency, cost, dan failure dependency.

Pseudo-code:

```java
public final class RuntimeConfigHolder {
    private final AtomicReference<RuntimeConfig> current = new AtomicReference<>();

    public RuntimeConfig get() {
        return current.get();
    }

    public void update(RuntimeConfig next) {
        validate(next);
        current.set(next);
    }
}
```

Critical invariant:

- config object immutable;
- update atomic;
- parser strict;
- invalid config rejected;
- old good config tetap dipakai jika refresh gagal.

---

## 8. Configuration Loading Strategy untuk Java Service

### 8.1 Bootstrap Sequence

Urutan ideal:

```text
1. Runtime starts
2. Read bootstrap env vars
3. Initialize AWS SDK client with runtime identity
4. Load required static config from Parameter Store / env
5. Load required secrets from Secrets Manager
6. Validate config graph
7. Initialize dependencies
8. Start health endpoint
9. Start serving traffic
10. Background refresh for runtime config if applicable
```

Jangan menerima traffic sebelum required config dan secrets valid.

### 8.2 Required vs Optional Config

Klasifikasikan config:

```text
required-critical    → service must not start if missing
required-degraded    → service starts but capability disabled
optional             → default allowed
runtime-dynamic      → may change after startup
secret               → must be resolved securely
```

Contoh:

| Config | Classification | Missing Behavior |
|---|---|---|
| DB secret ARN | required-critical | fail startup |
| SQS queue URL | required-critical untuk worker | fail startup |
| external registry endpoint | required-degraded | start with integration disabled |
| cache TTL | optional | use safe default |
| document auto escalation flag | runtime-dynamic | use last known good/default |

### 8.3 Typed Configuration

Jangan biarkan config berupa `Map<String, String>` tersebar ke seluruh kode.

Buruk:

```java
if (config.get("enableNewFlow").equals("true")) {
    // ...
}
```

Lebih baik:

```java
public record CaseServiceConfig(
    Duration externalRegistryTimeout,
    int maxBatchSize,
    boolean asyncDocumentAnalysisEnabled,
    URI registryBaseUrl
) {}
```

Keuntungan:

- validasi terpusat;
- tipe jelas;
- default eksplisit;
- test lebih mudah;
- mengurangi typo;
- bisa log config metadata tanpa value sensitif.

### 8.4 Config Validation

Validasi harus mencakup:

- required fields;
- range;
- enum values;
- URI format;
- duration bounds;
- cross-field invariants;
- environment restrictions;
- tenant restrictions;
- security restrictions.

Contoh invariant:

```text
if externalRegistry.enabled = true, registryBaseUrl must be set
if mode = prod, debugLogging must be false
if autoEscalation.enabled = true, escalationQueueUrl must exist
if maxBatchSize > 500, workerConcurrency must be >= 10
```

### 8.5 Last Known Good Config

Untuk runtime config, jangan mengganti config valid dengan config invalid.

Pattern:

```text
refresh succeeds + parse valid + semantic valid → swap
refresh fails → keep old config
refresh returns invalid → reject, alarm, keep old config
```

Ini disebut last known good behavior.

Namun, hati-hati: last known good harus terlihat di observability. Jangan diam-diam memakai config lama selama berhari-hari.

Log/metric:

```text
runtime_config_version{source="appconfig"} 42
runtime_config_refresh_failure_count 3
runtime_config_last_success_age_seconds 180
runtime_config_invalid_update_count 1
```

---

## 9. Naming and Hierarchy Strategy

Naming config menentukan maintainability.

### 9.1 Parameter Store Naming

Format yang disarankan:

```text
/{org}/{environment}/{service}/{category}/{name}
```

Contoh:

```text
/acme/prod/case-service/integration/registry/base-url
/acme/prod/case-service/integration/registry/timeout-millis
/acme/prod/case-service/batch/max-size
/acme/prod/case-service/cache/case-summary-ttl-seconds
/acme/prod/case-service/observability/log-level
```

Untuk shared config:

```text
/acme/prod/shared/network/private-api-domain
/acme/prod/shared/security/audit-bucket-name
/acme/prod/shared/platform/default-region
```

### 9.2 Secrets Manager Naming

Format:

```text
{environment}/{service}/{dependency}/{purpose}
```

Contoh:

```text
prod/case-service/db/app-user
prod/case-service/external-registry/api-token
prod/case-service/webhook/signing-secret
prod/document-service/ocr-provider/api-key
```

Jangan menaruh secret value di name.

Buruk:

```text
prod/case-service/password-for-admin-db
```

### 9.3 AppConfig Naming

Gunakan struktur yang mencerminkan ownership.

```text
Application: case-platform
Environment: prod
Configuration profile: case-service-runtime
Configuration profile: workflow-flags
Configuration profile: integration-kill-switches
```

Jangan membuat satu config profile raksasa untuk seluruh perusahaan.

Boundary yang baik:

- satu service;
- satu bounded context;
- satu operational concern;
- satu lifecycle owner.

---

## 10. IAM Design untuk Config dan Secret

### 10.1 Principle of Least Retrieval

Workload hanya boleh membaca config/secret yang dibutuhkan.

Buruk:

```text
case-service-prod-role can read all /prod/* parameters and all prod secrets
```

Lebih baik:

```text
case-service-prod-role can read /acme/prod/case-service/*
case-service-prod-role can read /acme/prod/shared/platform/*
case-service-prod-role can read secret prod/case-service/db/app-user
case-service-prod-role cannot read notification-service secrets
```

### 10.2 Separate Admin and Runtime Access

Runtime role:

- read config;
- read secret;
- decrypt with KMS;
- no update/delete.

Deployment role:

- update non-secret config as part of release;
- maybe start AppConfig deployment;
- no read secret value unless necessary.

Secret rotation role:

- rotate secret;
- update target system;
- access pending/current secret stages.

Human admin role:

- update config through controlled path;
- approval may be needed for prod.

### 10.3 KMS Permissions

Jika Parameter Store SecureString atau Secrets Manager memakai customer managed KMS key, akses butuh dua lapis:

1. permission ke Parameter Store/Secrets Manager;
2. permission `kms:Decrypt` pada KMS key.

Kegagalan umum:

```text
secretsmanager:GetSecretValue allowed
kms:Decrypt denied
```

Dari aplikasi Java, error sering terlihat sebagai `AccessDeniedException`, tetapi root cause ada di KMS policy atau grant.

### 10.4 VPC Endpoint Policy

Jika service memakai VPC endpoint untuk SSM/Secrets Manager/AppConfig, endpoint policy dapat menjadi boundary tambahan.

Ini bagus untuk membatasi akses private path, tetapi menambah satu layer debug.

Authorization efektif bisa dipengaruhi oleh:

- IAM identity policy;
- resource policy;
- KMS key policy;
- SCP;
- permissions boundary;
- session policy;
- VPC endpoint policy.

Debug harus sistematis, bukan tebak-tebakan.

---

## 11. Runtime Flags and Hidden State Machines

Feature flag sering terlihat sederhana:

```java
if (flags.newWorkflowEnabled()) {
    runNewWorkflow();
} else {
    runOldWorkflow();
}
```

Tetapi secara arsitektur, flag itu menciptakan dua jalur sistem.

Jika ada 10 boolean flag, secara teoritis ada 2^10 kombinasi behavior.

Masalah makin besar ketika flag memengaruhi:

- database schema;
- event format;
- external side effect;
- workflow state;
- authorization;
- audit behavior;
- idempotency key;
- compensation logic.

### 11.1 Flag Lifecycle

Setiap flag harus punya lifecycle:

```text
proposed → implemented → dark launched → partial rollout → full rollout → cleanup scheduled → removed
```

Tambahkan metadata:

```json
{
  "newCaseAssignmentWorkflow": {
    "enabled": true,
    "owner": "case-platform-team",
    "type": "release",
    "createdAt": "2026-06-01",
    "removeBy": "2026-08-01",
    "runbook": "https://internal/runbooks/new-case-assignment"
  }
}
```

### 11.2 Operational Flags vs Business Rules

Operational flag:

```text
Disable external registry lookup during provider incident
```

Business rule:

```text
Case must escalate if risk score > threshold and jurisdiction = X
```

Jangan memindahkan seluruh business policy ke feature flag platform jika seharusnya menjadi bagian domain model yang audited, versioned, reviewable, dan testable.

Untuk regulated system, business rules biasanya butuh:

- effective date;
- approval;
- jurisdiction;
- legal basis;
- audit trail;
- explanation;
- rollback semantics;
- historical reconstruction.

Feature flag platform tidak selalu cukup.

---

## 12. Configuration and Deployment Relationship

Config change adalah deployment juga.

Perbedaannya hanya artifact yang diubah bukan binary code.

Karena itu config change butuh:

- review;
- validation;
- deployment strategy;
- observability;
- rollback;
- ownership;
- audit;
- blast-radius control.

### 12.1 Config Change Risk Classes

| Risk Class | Example | Control |
|---|---|---|
| Low | UI copy, cache TTL minor | review ringan |
| Medium | timeout/retry threshold | validation + rollout |
| High | enable new workflow | staged rollout + alarms |
| Critical | disable fraud check / auth behavior | approval + audit + runbook |
| Secret | rotate DB password | rotation workflow + app readiness |

### 12.2 Change Approval

Untuk prod regulated workload:

- low-risk config bisa self-service;
- high-risk config perlu approval;
- emergency kill switch harus cepat tapi tetap audited;
- post-change review wajib untuk emergency.

### 12.3 Rollback

Rollback config harus jelas.

Untuk Parameter Store:

```text
restore previous version or label
```

Untuk Secrets Manager:

```text
staging label moves back carefully, target credential compatibility considered
```

Untuk AppConfig:

```text
stop deployment / rollback to previous hosted configuration version
```

Untuk domain config:

```text
create new effective version, do not mutate history
```

---

## 13. Multi-Account and Multi-Environment Config

### 13.1 Environment Isolation

Jangan share secret prod ke non-prod.

Jangan pakai satu AppConfig environment untuk semua environment.

Jangan pakai satu KMS key untuk semua environment jika blast radius harus dipisah.

Recommended:

```text
Dev account:
  /acme/dev/case-service/*
  dev/case-service/db/app-user

Staging account:
  /acme/staging/case-service/*
  staging/case-service/db/app-user

Prod account:
  /acme/prod/case-service/*
  prod/case-service/db/app-user
```

### 13.2 Promotion Model

Config bisa dipromosikan seperti code.

```text
config template in Git
        ↓
validated in dev
        ↓
approved for staging
        ↓
approved for prod
        ↓
AppConfig deployment strategy
```

Tetapi tidak semua config harus sama antar environment.

Bedakan:

- config structure sama;
- value bisa beda;
- secret selalu beda;
- endpoint bisa beda;
- feature default bisa beda untuk testing.

### 13.3 Cross-Account Shared Config

Kadang organisasi ingin shared config pusat.

Hati-hati. Centralized config dapat menciptakan dependency antar account.

Pertanyaan:

- apakah prod workload harus tetap berjalan jika shared config account bermasalah?
- apakah config di-cache lokal?
- apakah cross-account role terlalu luas?
- apakah audit trail jelas?
- apakah blast radius meningkat?

Untuk critical workload, prefer local copy yang dipromosikan, bukan runtime dependency cross-account untuk setiap service.

---

## 14. Observability untuk Config dan Secret

Config system harus observable.

Metrics:

```text
config_load_success_total
config_load_failure_total
config_refresh_duration_ms
config_current_version
config_last_success_age_seconds
secret_retrieval_success_total
secret_retrieval_failure_total
secret_cache_hit_total
secret_cache_miss_total
runtime_flag_evaluation_total
appconfig_deployment_version
invalid_config_rejected_total
```

Logs:

```json
{
  "event": "RUNTIME_CONFIG_UPDATED",
  "source": "appconfig",
  "profile": "case-service-runtime",
  "oldVersion": "41",
  "newVersion": "42",
  "status": "accepted"
}
```

Jangan log:

- secret value;
- bearer token;
- full Authorization header;
- API key;
- private key;
- signed URL lengkap jika sensitif;
- decrypted SecureString value.

Alarms:

- config refresh gagal terlalu lama;
- AppConfig deployment rollback;
- secret retrieval failure spike;
- KMS decrypt denied;
- DB auth failure setelah rotation;
- invalid config rejected;
- sudden feature flag activation rate.

---

## 15. Failure Mode Catalog

### 15.1 Missing Required Config

Gejala:

- service gagal startup;
- null pointer saat request;
- default tidak aman dipakai.

Mitigation:

- validate at startup;
- fail fast;
- classify required config;
- test deployment with missing config;
- IaC creates required parameters.

### 15.2 Invalid Runtime Config

Gejala:

- service tetap hidup tapi behavior salah;
- batch size terlalu besar;
- timeout terlalu kecil;
- feature kombinasi tidak valid.

Mitigation:

- JSON schema;
- semantic validator;
- last known good;
- canary rollout;
- alarm-based rollback.

### 15.3 Stale Config

Gejala:

- sebagian task memakai config lama;
- behavior inconsistent;
- incident sulit direkonstruksi.

Mitigation:

- expose current config version;
- metric per instance;
- bounded refresh interval;
- controlled rollout expectations;
- avoid strong consistency assumption.

### 15.4 Config Stampede

Gejala:

- semua instance refresh bersamaan;
- Parameter Store/AppConfig API throttling;
- startup storm saat deployment.

Mitigation:

- jitter refresh;
- local cache;
- sidecar/agent;
- exponential backoff;
- staggered deployment;
- avoid per-request fetch.

### 15.5 Secret Leakage

Gejala:

- secret masuk log;
- secret masuk Git;
- secret ada di task definition terlalu luas;
- secret terbaca role yang salah.

Mitigation:

- secret scanning;
- redaction;
- IAM least privilege;
- no plain env var for high-value secrets if avoidable;
- CloudTrail review;
- rotate immediately after leakage.

### 15.6 Rotation Breaks Application

Gejala:

- DB auth failure;
- connection pool error;
- service restart loop;
- partial outage setelah rotation.

Mitigation:

- staging rotation test;
- short connection max lifetime;
- secret cache TTL compatible with rotation;
- dual credential/alternating user strategy;
- health check for new connection;
- runbook.

### 15.7 Overpowered Runtime Flag

Gejala:

- satu boolean mengubah terlalu banyak behavior;
- audit sulit;
- test matrix meledak;
- old path tidak pernah dihapus.

Mitigation:

- flag lifecycle;
- owner and expiry;
- narrow scope;
- cleanup stories;
- domain rules separate from release flags.

### 15.8 Config Drift Between IaC and Runtime

Gejala:

- IaC mengatakan value A;
- Parameter Store di-prod value B karena manual edit;
- pipeline berikutnya overwrite unexpected.

Mitigation:

- define source of truth;
- restrict manual edit;
- drift detection;
- change audit;
- config-as-code for high-risk config.

---

## 16. Case Study: Regulated Java Case Management Platform

### 16.1 Context

Platform menangani lifecycle enforcement case:

- case intake;
- evidence upload;
- risk scoring;
- assignment;
- escalation;
- human review;
- external registry lookup;
- notification;
- audit trail.

Workload berjalan di ECS Fargate dengan Java services.

### 16.2 Configuration Classes

#### Static Deploy Config

```text
CASE_TABLE_NAME
EVIDENCE_BUCKET_NAME
AUDIT_EVENT_BUS_NAME
REGION
APP_ENV
```

Sumber:

- IaC output;
- ECS task definition environment variable.

#### Secrets

```text
prod/case-service/db/app-user
prod/case-service/external-registry/api-token
prod/notification-service/email-provider/api-key
```

Sumber:

- Secrets Manager;
- KMS CMK per environment;
- least privilege task role.

#### Runtime Config

```json
{
  "externalRegistryLookup": {
    "enabled": true,
    "timeoutMillis": 1500,
    "maxRetries": 1
  },
  "riskScoring": {
    "highRiskThreshold": 85,
    "mediumRiskThreshold": 60
  },
  "caseAssignment": {
    "newWorkflowEnabled": false,
    "rolloutTenants": ["tenant-a", "tenant-b"]
  },
  "documentAnalysis": {
    "asyncModeEnabled": true,
    "maxPages": 300
  }
}
```

Sumber:

- AppConfig;
- JSON schema validator;
- Lambda semantic validator;
- staged deployment.

#### Domain Rules

```text
jurisdiction-specific escalation policy
statutory deadline computation
case severity classification basis
```

Sumber:

- domain database/rules table;
- versioned with effective dates;
- approval workflow;
- audit trail.

Bukan AppConfig biasa.

### 16.3 Startup Flow

```text
ECS task starts
  ↓
reads bootstrap env vars
  ↓
assumes task role automatically
  ↓
loads required Parameter Store config
  ↓
retrieves DB secret from Secrets Manager
  ↓
initializes DB pool
  ↓
loads AppConfig runtime profile
  ↓
validates typed RuntimeConfig
  ↓
starts HTTP server
  ↓
registers healthy in ALB target group
  ↓
background refresh runtime config every N seconds with jitter
```

### 16.4 Kill Switch Example

External registry provider incident.

Operator changes AppConfig:

```json
{
  "externalRegistryLookup": {
    "enabled": false,
    "fallbackMode": "manual_review",
    "reason": "provider outage INC-2026-118"
  }
}
```

Expected behavior:

- new cases skip automatic registry lookup;
- cases route to manual review queue;
- audit event records fallback reason;
- dashboard shows provider lookup disabled;
- no data is lost;
- operator can re-enable gradually.

This is a good operational flag because it changes integration behavior while preserving domain auditability.

### 16.5 Bad Flag Example

```json
{
  "ignoreStatutoryDeadline": true
}
```

This is dangerous.

It changes legal/business behavior with insufficient governance.

Better:

- domain rule version;
- approval workflow;
- explicit emergency legal basis;
- audit event;
- effective time range;
- role-based authorization.

---

## 17. Java Implementation Blueprint

### 17.1 Config Aggregator

```java
public final class ApplicationConfig {
    private final StaticConfig staticConfig;
    private final SecretRefs secretRefs;
    private final AtomicReference<RuntimeConfig> runtimeConfig;

    public ApplicationConfig(
        StaticConfig staticConfig,
        SecretRefs secretRefs,
        RuntimeConfig initialRuntimeConfig
    ) {
        this.staticConfig = staticConfig;
        this.secretRefs = secretRefs;
        this.runtimeConfig = new AtomicReference<>(initialRuntimeConfig);
    }

    public StaticConfig staticConfig() {
        return staticConfig;
    }

    public RuntimeConfig runtimeConfig() {
        return runtimeConfig.get();
    }

    public void updateRuntimeConfig(RuntimeConfig next) {
        RuntimeConfigValidator.validate(next);
        runtimeConfig.set(next);
    }
}
```

### 17.2 Strict Parser

```java
public final class RuntimeConfigParser {
    private final ObjectMapper mapper;

    public RuntimeConfig parse(String json) {
        try {
            RuntimeConfig config = mapper.readValue(json, RuntimeConfig.class);
            RuntimeConfigValidator.validate(config);
            return config;
        } catch (Exception e) {
            throw new InvalidRuntimeConfigException("Invalid runtime config", e);
        }
    }
}
```

### 17.3 Safe Refresh Loop

```java
public final class RuntimeConfigRefresher implements Runnable {
    private final RuntimeConfigSource source;
    private final ApplicationConfig appConfig;
    private final Logger log = LoggerFactory.getLogger(getClass());

    @Override
    public void run() {
        try {
            RuntimeConfigSnapshot snapshot = source.fetchIfChanged();
            if (snapshot.changed()) {
                appConfig.updateRuntimeConfig(snapshot.config());
                log.info("Runtime config updated version={}", snapshot.version());
            }
        } catch (Exception e) {
            log.warn("Runtime config refresh failed; keeping last known good config", e);
        }
    }
}
```

### 17.4 Request Path Usage

```java
public CaseDecision evaluate(CaseInput input) {
    RuntimeConfig config = applicationConfig.runtimeConfig();

    if (!config.externalRegistryLookup().enabled()) {
        return manualReview("External registry lookup disabled by runtime config");
    }

    return registryBackedEvaluation(input, config.externalRegistryLookup().timeout());
}
```

Request path reads local immutable config. It does not call AppConfig/Parameter Store/Secrets Manager.

---

## 18. Testing Strategy

### 18.1 Unit Tests

Test:

- parser;
- defaults;
- validation;
- invalid values;
- cross-field invariants;
- feature flag branching;
- redaction.

### 18.2 Integration Tests

Test with AWS/local emulation where appropriate:

- Parameter Store path loading;
- Secrets Manager retrieval;
- KMS permission failure;
- AppConfig invalid config;
- refresh failure;
- stale config behavior.

### 18.3 Deployment Tests

Before prod:

- deploy config to staging;
- run smoke test;
- verify AppConfig validator;
- simulate rollback;
- rotate staging secret;
- verify Java pool refresh;
- verify metrics/log redaction.

### 18.4 Chaos Tests

Inject:

- Parameter Store throttling;
- Secrets Manager timeout;
- AppConfig invalid payload;
- KMS AccessDenied;
- rotated secret mid-traffic;
- stale config for one instance;
- config rollout stopped at 10%.

Expected result:

- critical service either fails fast at startup or keeps last known good;
- no secret leakage;
- no request path dependency explosion;
- alarms fire;
- runbook works.

---

## 19. Anti-Patterns

### 19.1 Everything in Environment Variables

Symptoms:

- task definition huge;
- secret visible too broadly;
- change requires redeploy;
- no audit/validation for runtime config.

### 19.2 Everything in Secrets Manager

Symptoms:

- non-secret config treated like secret;
- unnecessary cost;
- poor hierarchy;
- teams avoid visibility because everything is “secret”.

### 19.3 Fetch Config on Every Request

Symptoms:

- latency increase;
- dependency outage affects all requests;
- API throttling;
- cost spike.

### 19.4 No Typed Config

Symptoms:

- stringly typed code;
- inconsistent defaults;
- typo bugs;
- no central validation.

### 19.5 Long-Lived Feature Flags

Symptoms:

- dead code;
- impossible test matrix;
- unclear ownership;
- surprising behavior.

### 19.6 Secret Rotation Without Application Readiness

Symptoms:

- successful rotation breaks app;
- old connection pool fails later;
- no staging test;
- no rollback plan.

### 19.7 Runtime Config as Hidden Business Policy

Symptoms:

- regulatory behavior changed without domain audit;
- no effective date;
- no legal basis;
- cannot reconstruct historical decision.

---

## 20. Architecture Decision Record Template

```md
# ADR: Configuration and Secrets Strategy for <Service>

## Context

<Service> needs configuration for <runtime/deploy/integration/business> behavior.

## Classification

| Name | Type | Sensitivity | Change Frequency | Source | Runtime Refresh |
|---|---|---|---|---|---|
| DB credential | secret | high | rotated | Secrets Manager | cached |
| SQS queue URL | deploy config | low | rare | IaC/env | no |
| External timeout | runtime config | low | occasional | AppConfig | yes |
| Feature rollout | feature flag | medium | temporary | AppConfig | yes |
| Legal threshold | domain rule | high | governed | domain DB | governed |

## Decision

We will use:

- Parameter Store for ...
- Secrets Manager for ...
- AppConfig for ...
- environment variables for bootstrap only ...
- domain database for ...

## Invariants

- No secret value is logged.
- Required config is validated before serving traffic.
- Runtime config update is atomic.
- Invalid runtime config is rejected.
- Last known good config is retained after refresh failure.
- Secret access is least privilege.
- Feature flags have owner and removal date.

## Rollout Strategy

<Describe validation, deployment strategy, alarm, rollback.>

## Failure Handling

<Describe missing config, invalid config, secret failure, rotation failure.>

## Observability

<Metrics, logs, dashboards, alarms.>

## Consequences

<Trade-offs, cost, operational burden.>
```

---

## 21. Production Checklist

### Classification

- [ ] Every config value is classified.
- [ ] Every secret is separated from non-secret config.
- [ ] Runtime flags are not used as hidden business policy.
- [ ] Feature flags have owner and expiry.

### Storage

- [ ] Static deploy config is managed by IaC/pipeline.
- [ ] Parameter Store hierarchy is consistent.
- [ ] Secrets Manager is used for secrets requiring lifecycle/rotation.
- [ ] AppConfig is used for runtime config requiring safe rollout.

### Security

- [ ] Runtime role has read-only config access.
- [ ] Secret access is least privilege.
- [ ] KMS permissions are explicit.
- [ ] No secret is stored in Git or baked into image.
- [ ] Logs redact sensitive values.

### Runtime

- [ ] Required config is validated before serving traffic.
- [ ] Runtime config is immutable and atomically swapped.
- [ ] Request path does not fetch remote config.
- [ ] Refresh loop has jitter and backoff.
- [ ] Last known good config is retained.

### Rotation

- [ ] Secret rotation is tested in staging.
- [ ] Java connection pool handles credential change.
- [ ] Secret cache TTL is compatible with rotation.
- [ ] Rotation failure has runbook.

### Observability

- [ ] Config version is visible.
- [ ] Secret retrieval failure is alarmed.
- [ ] Runtime config refresh failure is alarmed.
- [ ] AppConfig rollback is alarmed.
- [ ] KMS AccessDenied is monitored.

### Governance

- [ ] High-risk config changes require approval.
- [ ] Emergency changes are audited.
- [ ] Manual console edits are restricted or detected.
- [ ] Config source of truth is clear.

---

## 22. Exercises

### Exercise 1 — Classify Config

Ambil satu Java service Anda. Buat tabel:

```text
name | current storage | desired storage | type | sensitivity | change frequency | failure behavior
```

Identifikasi minimal 5 config yang salah tempat.

### Exercise 2 — Design Parameter Hierarchy

Desain hierarchy Parameter Store untuk:

- dev;
- staging;
- prod;
- case-service;
- document-service;
- notification-service;
- shared platform config.

Tambahkan IAM intent untuk setiap service.

### Exercise 3 — Secret Rotation Readiness

Pilih satu database credential. Jawab:

1. siapa boleh membaca secret?
2. siapa boleh rotate secret?
3. bagaimana aplikasi refresh credential?
4. apa yang terjadi pada existing connection?
5. alarm apa yang dipasang?
6. bagaimana rollback?

### Exercise 4 — AppConfig Runtime Flag

Desain AppConfig profile untuk kill switch external provider.

Harus ada:

- schema;
- validator rule;
- deployment strategy;
- alarm;
- rollback path;
- Java runtime behavior;
- audit event.

### Exercise 5 — Remove Old Flags

Cari 3 feature flags yang sudah tidak diperlukan. Buat cleanup plan:

- owner;
- current rollout state;
- safe deletion steps;
- test impact;
- release plan.

---

## 23. Key Takeaways

1. Configuration adalah input perilaku sistem, bukan detail kecil.
2. Secret adalah configuration dengan blast radius keamanan.
3. Feature flag menciptakan cabang state dan harus punya lifecycle.
4. Parameter Store cocok untuk hierarchical config sederhana.
5. Secrets Manager cocok untuk secret lifecycle dan rotation.
6. AppConfig cocok untuk runtime config dan feature flags dengan safe rollout.
7. Java service harus membaca remote config secara cached, typed, validated, dan observable.
8. Request path tidak boleh bergantung langsung pada remote config store.
9. Config change adalah deployment dan butuh validation, rollout, rollback, serta audit.
10. Untuk regulated systems, business rules tidak boleh disamarkan sebagai feature flags tanpa governance domain.

---

## 24. Referensi Resmi AWS

- AWS Systems Manager Parameter Store User Guide
- Working with Parameter Store
- AWS Secrets Manager User Guide
- Rotate AWS Secrets Manager secrets
- Retrieve AWS Secrets Manager secrets using Java
- AWS AppConfig User Guide
- AWS AppConfig feature flags
- AWS AppConfig deployment strategies
- AWS SDK for Java 2.x code examples
- AWS KMS Developer Guide
- AWS IAM User Guide

---

## 25. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-025.md
```

Judul berikutnya:

```text
API Architecture on AWS: API Gateway, ALB, Lambda, ECS, Auth, Throttling, dan Contracts
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Deployment Architecture: CodePipeline, CodeBuild, CodeDeploy, Artifact, Promotion, Rollback</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-025.md">Part 025 — API Architecture on AWS: API Gateway, ALB, Lambda, ECS, Auth, Throttling, dan Contracts ➡️</a>
</div>
