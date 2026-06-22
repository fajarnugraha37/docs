# Part 29 — Secure Configuration and Secret Rotation Case Study

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target file: `part-29-secure-configuration-and-secret-rotation-case-study.md`  
Scope: Java 8–25, AWS SDK for Java 2.x, Spring Boot, HikariCP, Secrets Manager, SSM Parameter Store, KMS, RDS-like database credentials, production operations

---

## 1. Tujuan Bagian Ini

Bagian ini adalah studi kasus production-grade tentang bagaimana aplikasi Java mengelola konfigurasi dan secret secara aman, terutama ketika secret dirotasi tanpa downtime.

Kita tidak lagi membahas Secrets Manager dan SSM secara terpisah seperti Part 11. Di sini kita menyatukan semuanya ke dalam desain sistem nyata:

```text
Java/Spring Boot Service
        |
        | reads non-sensitive config
        v
SSM Parameter Store
        |
        | reads sensitive credential
        v
AWS Secrets Manager
        |
        | decrypts secret material
        v
AWS KMS
        |
        | applies credential
        v
HikariCP / JDBC / Database
        |
        | rotation happens
        v
Secrets Manager Rotation Lambda + Database User Update
```

Target pemahaman setelah bagian ini:

1. Bisa membedakan configuration, secret, credential, token, key, and operational parameter.
2. Bisa mendesain naming hierarchy untuk multi-environment.
3. Bisa membuat strategi load config yang aman saat startup dan runtime.
4. Bisa memahami rotasi secret dengan staging label seperti `AWSCURRENT`, `AWSPREVIOUS`, dan `AWSPENDING`.
5. Bisa mendesain aplikasi Java agar survive saat database password berubah.
6. Bisa menghindari secret leak di logs, metrics, exceptions, heap dump, and config endpoint.
7. Bisa membuat rollback dan incident playbook ketika rotasi gagal.
8. Bisa menentukan kapan perlu caching, kapan harus refresh, dan kapan harus fail-fast.

---

## 2. Problem Statement

Bayangkan sebuah service Java bernama `case-management-service`.

Service ini:

- Berjalan di EKS atau ECS.
- Menggunakan Spring Boot dan HikariCP.
- Mengakses database PostgreSQL/MySQL/Oracle/RDS-like database.
- Memerlukan beberapa konfigurasi non-sensitive seperti feature flag, URL service, queue name, bucket name, timeout, dan region.
- Memerlukan secret sensitive seperti database username/password, API key external provider, private signing key, atau webhook token.
- Harus memenuhi requirement security:
  - Tidak ada static credential di source code.
  - Tidak ada secret di image Docker.
  - Tidak ada secret di Git.
  - Tidak ada secret di log.
  - Secret bisa dirotasi.
  - Aplikasi tidak perlu redeploy setiap kali secret berubah.
  - Jika rotasi gagal, sistem bisa rollback dengan jelas.

Masalahnya: banyak implementasi terlihat aman di awal, tetapi gagal saat operasi nyata.

Contoh bug umum:

```text
1. App membaca DB password saat startup.
2. Secret dirotasi oleh Secrets Manager.
3. Existing DB connection masih hidup, tetapi new connection gagal karena password lama.
4. HikariCP mulai mengeluarkan error sporadis.
5. App dianggap unstable, padahal root cause adalah stale secret cache.
6. Engineer restart pod.
7. Restart pod masih mengambil cached/stale value atau mengambil value yang belum siap.
8. Incident memburuk.
```

Bagian ini membahas desain agar skenario seperti itu tidak menjadi chaos.

---

## 3. Mental Model: Configuration vs Secret vs Credential

Sebelum bicara AWS service, kita perlu klasifikasi data runtime.

### 3.1 Configuration

Configuration adalah data yang mengubah perilaku aplikasi, tetapi tidak memberikan akses langsung ke resource sensitive.

Contoh:

```text
/app/aceas/prod/case-management/aws/region = ap-southeast-1
/app/aceas/prod/case-management/sqs/inbound-queue-url = https://sqs...
/app/aceas/prod/case-management/s3/document-bucket = aceas-prod-documents
/app/aceas/prod/case-management/http/downstream-timeout-ms = 3000
/app/aceas/prod/case-management/feature/enable-risk-scoring = true
```

Biasanya cocok disimpan di SSM Parameter Store sebagai `String` atau `StringList`.

### 3.2 Secret

Secret adalah data yang jika bocor dapat memberi akses, memalsukan identitas, atau melemahkan kontrol keamanan.

Contoh:

```text
Database password
External API key
JWT signing private key
OAuth client secret
Webhook signing secret
SAML private key
SMTP credential
```

Biasanya cocok disimpan di AWS Secrets Manager, terutama jika perlu rotation lifecycle.

### 3.3 Credential

Credential adalah secret yang merepresentasikan identitas autentikasi terhadap sistem lain.

Contoh:

```text
username + password
client_id + client_secret
access key pair
certificate + private key
```

Semua credential adalah secret, tetapi tidak semua secret adalah credential.

### 3.4 Operational Parameter

Operational parameter adalah configuration yang mengontrol cara sistem berjalan secara operasional.

Contoh:

```text
batch size
poll interval
max concurrency
retry budget
circuit breaker threshold
cache TTL
DLQ replay dry-run mode
```

Parameter seperti ini sering lebih baik disimpan di SSM Parameter Store agar dapat diubah tanpa rebuild image. Namun, tidak semua harus runtime-refreshable. Parameter yang mengubah invariant besar tetap sebaiknya lewat deployment/change process.

---

## 4. Prinsip Desain Secure Configuration

### 4.1 Build artifact harus environment-agnostic

Docker image/JAR yang sama harus bisa berjalan di DEV, UAT, dan PROD. Yang membedakan environment adalah runtime identity dan runtime configuration.

```text
Bad:
case-management-service-prod.jar
case-management-service-uat.jar

Better:
case-management-service.jar
+ runtime environment variable APP_ENV=prod
+ IAM role prod
+ SSM/Secrets path prod
```

Alasannya:

- Artifact immutability lebih kuat.
- Promotion DEV → UAT → PROD lebih jelas.
- Risiko salah build lebih kecil.
- Audit release lebih mudah.

### 4.2 Secret tidak boleh menjadi bagian dari deployment artifact

Jangan taruh secret di:

```text
application-prod.yml
Dockerfile
Kubernetes ConfigMap
Kubernetes plain Secret yang dibuat manual dari laptop
CI/CD variable tanpa kontrol akses
GitHub Actions log
Jenkins console output
Helm values repository
```

Kubernetes Secret memang encoded base64, bukan encrypted-by-default secara application-level. Ia bisa menjadi delivery mechanism, tetapi bukan source of truth terbaik untuk secret jangka panjang.

### 4.3 Runtime identity harus menggantikan static access key

Aplikasi Java sebaiknya memakai AWS credentials provider chain yang mengambil credential dari runtime identity:

```text
EKS  -> IAM Roles for Service Accounts / pod identity pattern
ECS  -> task role
EC2  -> instance profile
Lambda -> execution role
```

Jangan desain aplikasi yang membutuhkan `AWS_ACCESS_KEY_ID` dan `AWS_SECRET_ACCESS_KEY` static di production.

### 4.4 Secret harus minimum scope

Secret database untuk service A tidak boleh bisa dipakai service B.

```text
Bad:
/prod/shared/db/master-password

Better:
/prod/case-management/db/app-user
/prod/document-service/db/app-user
/prod/reporting-service/db/read-only-user
```

Ini bukan hanya security. Ini juga mengurangi blast radius saat rotasi atau incident.

### 4.5 Secret retrieval adalah remote dependency

Mengambil secret dari Secrets Manager bukan membaca file lokal. Ia adalah AWS API call.

Artinya punya failure mode:

```text
network timeout
wrong IAM permission
wrong region
KMS deny
throttling
Secrets Manager unavailable
secret not found
version stage mismatch
malformed JSON
```

Karena itu, desain harus menjawab:

- Apakah aplikasi boleh start jika secret gagal diambil?
- Apakah aplikasi boleh terus berjalan memakai cached secret lama?
- Berapa lama cache boleh hidup?
- Apa yang terjadi saat secret berubah?
- Bagaimana membedakan error temporary vs misconfiguration?

---

## 5. Naming Hierarchy untuk Multi-Environment

Salah satu penanda engineering maturity adalah naming yang konsisten. Banyak incident terjadi bukan karena AWS sulit, tetapi karena path secret/config ambigu.

### 5.1 Struktur SSM Parameter Store

Contoh struktur:

```text
/apps/{appName}/{environment}/{component}/{category}/{name}
```

Contoh nyata:

```text
/apps/aceas/prod/case-management/aws/region
/apps/aceas/prod/case-management/s3/document-bucket-name
/apps/aceas/prod/case-management/sqs/document-upload-queue-url
/apps/aceas/prod/case-management/http/screening-timeout-ms
/apps/aceas/prod/case-management/feature/enable-risk-scoring
/apps/aceas/prod/case-management/secret/db-secret-id
```

Perhatikan bahwa SSM menyimpan `db-secret-id`, bukan password-nya.

```text
/apps/aceas/prod/case-management/secret/db-secret-id
= arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:/apps/aceas/prod/case-management/db/main-AbCdEf
```

Dengan pola ini:

- SSM menjadi directory of runtime config.
- Secrets Manager tetap menjadi source of truth untuk secret value.
- Aplikasi tidak hardcode ARN secret.

### 5.2 Struktur Secrets Manager

Contoh secret name:

```text
/apps/aceas/prod/case-management/db/main
/apps/aceas/prod/case-management/external/onemap/api-client
/apps/aceas/prod/case-management/signing/jwt-private-key
```

Contoh JSON secret untuk database:

```json
{
  "engine": "postgres",
  "host": "case-db.prod.internal",
  "port": 5432,
  "dbname": "case_management",
  "username": "case_mgmt_app",
  "password": "REDACTED"
}
```

Untuk Oracle-like database:

```json
{
  "engine": "oracle",
  "host": "oracle-prod.internal",
  "port": 1521,
  "serviceName": "PRODDB",
  "username": "CASE_MGMT_APP",
  "password": "REDACTED"
}
```

### 5.3 Jangan campur secret dan non-secret

Bad pattern:

```json
{
  "dbPassword": "...",
  "bucketName": "...",
  "queueUrl": "...",
  "featureFlag": true,
  "timeoutMs": 3000
}
```

Masalah:

- Semua consumer yang butuh `bucketName` jadi punya akses ke `dbPassword`.
- Rotation lifecycle jadi bercampur dengan config biasa.
- Audit access menjadi kabur.
- Least privilege sulit.

Better:

```text
SSM:
/apps/aceas/prod/case-management/s3/document-bucket-name
/apps/aceas/prod/case-management/sqs/upload-queue-url
/apps/aceas/prod/case-management/http/downstream-timeout-ms
/apps/aceas/prod/case-management/secret/db-secret-id

Secrets Manager:
/apps/aceas/prod/case-management/db/main
```

---

## 6. IAM Design untuk Config dan Secret

### 6.1 Runtime role aplikasi

Aplikasi `case-management-service` hanya boleh membaca config dan secret miliknya.

Contoh policy konseptual:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOwnParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:ap-southeast-1:123456789012:parameter/apps/aceas/prod/case-management/*"
    },
    {
      "Sid": "ReadOwnSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:/apps/aceas/prod/case-management/*"
    },
    {
      "Sid": "DecryptOnlyRequiredKeys",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:ap-southeast-1:123456789012:key/KEY_ID",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.ap-southeast-1.amazonaws.com"
        }
      }
    }
  ]
}
```

Catatan desain:

- Aplikasi tidak perlu `secretsmanager:PutSecretValue`.
- Aplikasi tidak perlu `secretsmanager:UpdateSecretVersionStage`.
- Aplikasi tidak perlu `kms:Encrypt` untuk membaca secret.
- Rotation Lambda punya role berbeda dari runtime app.

### 6.2 Rotation role

Rotation Lambda perlu permission lebih luas, karena harus:

- Membaca secret metadata.
- Membuat versi pending.
- Menguji credential baru.
- Mengubah password di database.
- Menggeser staging label.

Namun role rotation tetap tidak boleh menjadi superuser global.

Boundary yang baik:

```text
Runtime app role:
- read AWSCURRENT secret
- decrypt via Secrets Manager

Rotation Lambda role:
- read/write specific secret version
- connect to database as rotation-capable principal
- update staging label for specific secret only
```

### 6.3 DBA/admin role

Admin manusia atau pipeline infra bisa membuat secret, mengaktifkan rotation, dan mengubah schedule. Ini harus dipisah dari runtime app.

```text
Runtime app != Rotation Lambda != Infra admin != DBA break-glass
```

Ini adalah prinsip separation of duties.

---

## 7. Startup Strategy: Fail-Fast vs Lazy Load

Tidak semua config/secret harus diperlakukan sama.

### 7.1 Critical startup dependency

Database credential biasanya critical. Jika tidak bisa dibaca, service tidak bisa menjalankan fungsi utama.

Untuk ini, strategi yang baik:

```text
At startup:
1. Resolve region.
2. Resolve SSM path prefix.
3. Read required parameters.
4. Read required secret metadata/value.
5. Validate shape, required fields, and connection viability.
6. Build datasource.
7. Expose readiness only after initialization succeeds.
```

Jika gagal:

```text
Fail startup, do not accept traffic.
```

Lebih baik pod tidak ready daripada menerima request lalu gagal random.

### 7.2 Optional dependency

Contoh optional:

```text
external notification API key
optional integration toggle
non-critical analytics token
```

Bisa lazy load atau degrade:

```text
If secret unavailable:
- disable optional feature
- report degraded health
- emit metric
- do not crash entire service
```

### 7.3 Runtime-refreshable parameter

Tidak semua parameter aman di-refresh runtime.

Parameter yang relatif aman:

```text
feature flag
batch size within bounded range
timeout within bounded range
polling interval
```

Parameter yang berbahaya jika berubah runtime:

```text
database host
schema name
queue URL used by exactly-once workflow
bucket name for compliance archive
KMS key ID
identity provider issuer
```

Rule praktis:

```text
If changing parameter changes system topology, identity, storage boundary, or compliance boundary, prefer deployment/change process.
```

---

## 8. Secret Caching Strategy

AWS merekomendasikan client-side caching untuk Secrets Manager karena lebih cepat dan mengurangi biaya/request load. Tetapi cache harus diperlakukan sebagai security and correctness component, bukan sekadar optimization.

### 8.1 Kenapa cache diperlukan

Tanpa cache:

```text
Every request -> GetSecretValue -> Secrets Manager -> KMS -> latency + cost + throttle risk
```

Ini buruk untuk hot path.

Dengan cache:

```text
Startup/load -> cache secret -> use local value -> periodic refresh
```

### 8.2 Risiko cache

Cache menimbulkan risiko:

```text
stale secret after rotation
memory exposure
long-lived sensitive object in heap
no immediate revocation
refresh storm across replicas
```

### 8.3 TTL bukan angka asal

TTL harus dipilih berdasarkan:

- Rotation frequency.
- Acceptable stale duration.
- Number of replicas.
- Secrets Manager quota/cost.
- Operational rollback strategy.
- Whether downstream credential supports overlap.

Contoh prinsip:

```text
If secret rotates every 30 days, cache TTL 1 hour may be acceptable.
If emergency revocation requires fast cutover, 1 hour may be too long.
If service has 500 pods, 30-second TTL may cause API storm.
```

### 8.4 Cache jitter

Jika semua pod refresh secret di menit yang sama, Secrets Manager bisa mendapat burst.

Better:

```text
baseTtl = 15 minutes
jitter = random 0..3 minutes
actualRefreshAt = lastFetch + baseTtl + jitter
```

### 8.5 Secret cache and HikariCP

Untuk database credential, cache saja tidak cukup. HikariCP juga menyimpan connection yang sudah dibuat.

Ada dua lapis state:

```text
Secret cache value
        |
        v
Datasource/HikariConfig username/password
        |
        v
Existing physical DB connections
```

Saat secret berubah, Anda harus memikirkan:

1. Bagaimana mendeteksi secret berubah?
2. Bagaimana membuat connection baru memakai password baru?
3. Bagaimana membuang connection lama secara aman?
4. Bagaimana menghindari request gagal saat transisi?

---

## 9. Rotation Lifecycle: AWSCURRENT, AWSPREVIOUS, AWSPENDING

Secrets Manager memakai staging label untuk menandai versi secret selama rotation.

Mental model:

```text
Before rotation:
Version A -> AWSCURRENT

During rotation:
Version A -> AWSCURRENT
Version B -> AWSPENDING

After successful rotation:
Version B -> AWSCURRENT
Version A -> AWSPREVIOUS
```

Label penting:

- `AWSCURRENT`: versi yang seharusnya dipakai aplikasi normal.
- `AWSPREVIOUS`: versi sebelumnya, berguna untuk rollback dan transisi.
- `AWSPENDING`: calon versi baru yang sedang dibuat/dites saat rotation.

Runtime application biasanya hanya membaca `AWSCURRENT`.

Rotation Lambda melakukan empat tahap umum:

```text
1. createSecret
   Membuat versi baru dengan label AWSPENDING.

2. setSecret
   Mengubah credential di target system/database agar sesuai secret pending.

3. testSecret
   Menguji apakah credential pending benar-benar bisa dipakai.

4. finishSecret
   Memindahkan AWSCURRENT ke versi baru.
```

Inilah invariant penting:

```text
A secret version must not become AWSCURRENT before credential target actually accepts it.
```

Jika invariant ini dilanggar, aplikasi akan mengambil secret baru yang belum valid.

---

## 10. Database Rotation Strategy

Untuk database, rotation bukan hanya mengganti value di Secrets Manager. Password di database juga harus berubah.

Ada beberapa strategi.

### 10.1 Single-user rotation

Satu user database dipakai aplikasi. Password user itu diubah saat rotation.

```text
Before:
app_user password = P1
Secret AWSCURRENT = P1

Rotate:
app_user password = P2
Secret AWSCURRENT = P2
```

Kelebihan:

- Simpler.
- Tidak perlu dua app user.
- Cocok untuk sistem kecil.

Kekurangan:

- Transisi bisa menyebabkan connection baru gagal jika app masih memakai P1.
- Existing connection dengan P1 mungkin tetap hidup sampai diputus.
- Rollback lebih sensitif.

### 10.2 Alternating-users rotation

Ada dua user aplikasi, misalnya:

```text
case_mgmt_app_a
case_mgmt_app_b
```

Rotation bergantian antara user A dan B.

```text
Before:
AWSCURRENT -> user A / password A1
User B inactive or standby

Rotate:
Update user B password B2
Test user B
AWSCURRENT -> user B / password B2
AWSPREVIOUS -> user A / password A1
```

Kelebihan:

- Lebih aman untuk zero-downtime.
- Credential lama bisa tetap valid selama transisi.
- Rollback lebih mudah.

Kekurangan:

- Perlu dua user dengan permission identik.
- Governance permission harus lebih ketat.
- Lebih kompleks.

Untuk sistem regulated atau high-availability, alternating-users sering lebih baik.

### 10.3 Master/admin rotation anti-pattern

Jangan biarkan aplikasi runtime memakai master database credential.

Bad:

```text
app reads /prod/db/master
app connects as db_admin
```

Better:

```text
app reads /prod/case-management/db/app-user
app connects as least-privilege user
rotation function uses separate rotation/admin capability
```

---

## 11. HikariCP and Rotation: The Real Problem

Database connection pool membuat secret rotation tidak sesederhana `GetSecretValue` lagi.

### 11.1 Apa yang terjadi saat password berubah?

Misalnya:

```text
T0: HikariCP creates 20 connections using password P1.
T1: Secret rotates to P2.
T2: Existing connections may still work.
T3: One connection dies or pool needs new connection.
T4: HikariCP tries creating new connection using password P1 stored in pool config.
T5: New connection fails.
```

Problemnya bukan Secrets Manager saja. Problemnya adalah datasource config sudah stale.

### 11.2 Naive solution: restart app

Restart sering “menyelesaikan” karena app reload secret. Tetapi ini bukan desain yang baik.

Masalah:

- Restart massal bisa menyebabkan thundering herd.
- Kalau rotation sedang inconsistent, semua pod gagal start.
- Downtime atau degraded service.
- Tidak memberi mekanisme rollback yang halus.

### 11.3 Better solution: refreshable datasource boundary

Desain lebih baik adalah membuat abstraction yang bisa mengganti datasource ketika credential berubah.

```text
Application Repository
        |
        v
RoutingDataSource / DataSourceProvider
        |
        +--> current HikariDataSource(P1)
        |
        +--> upon secret change: new HikariDataSource(P2)
```

Langkah transisi:

```text
1. Periodically refresh secret metadata/value.
2. Detect version id changed.
3. Build new HikariDataSource with new credential.
4. Test new datasource with validation query.
5. Atomically swap datasource reference.
6. Stop sending new borrow requests to old pool.
7. Gracefully close old pool after drain timeout.
8. Emit metric/event.
```

### 11.4 Atomic swap pattern

Konsep Java:

```java
public final class RefreshableDataSource implements DataSource, AutoCloseable {
    private final AtomicReference<HikariDataSource> current = new AtomicReference<>();

    public Connection getConnection() throws SQLException {
        return current.get().getConnection();
    }

    public void swap(HikariDataSource next) {
        HikariDataSource previous = current.getAndSet(next);
        closeLater(previous);
    }
}
```

Catatan:

- Ini contoh konsep, bukan full implementation.
- Semua method `DataSource` lain harus didelegasikan dengan benar.
- Perlu lifecycle management, metrics, and drain behavior.

### 11.5 Kapan swap dilakukan?

Jangan swap hanya karena secret cache refresh sukses. Swap harus dilakukan jika:

```text
1. Secret version id berubah, atau username/password berubah.
2. New datasource berhasil dibuat.
3. Validation query berhasil.
4. Optional: migration compatibility check berhasil.
```

Jika new datasource gagal validation:

```text
Do not replace current datasource.
Keep serving with old datasource if still healthy.
Emit alert: secret rotation candidate invalid.
```

### 11.6 Apa risiko keep old datasource?

Jika password lama sudah dicabut, old datasource akhirnya gagal. Tetapi menjaga old datasource selama masih hidup memberi waktu untuk recovery dan menghindari instant outage.

Maturity-nya ada pada playbook:

```text
If new credential invalid but old pool still works:
- mark degraded
- alert security/platform team
- stop rotation finalization if possible
- investigate pending version

If old and new both fail:
- service unavailable
- fail readiness
- trigger incident
```

---

## 12. Implementation Architecture

### 12.1 Component map

```text
RuntimeConfigLoader
  - reads SSM parameters
  - resolves secret IDs/ARNs
  - validates required config

SecretProvider
  - wraps Secrets Manager client/cache
  - returns typed secret model
  - hides raw AWS SDK response from business code

DatabaseSecretParser
  - parses JSON secret
  - validates engine/host/port/dbname/username/password

DataSourceFactory
  - creates HikariDataSource from typed database secret
  - applies pool config
  - runs validation query

RefreshableDataSource
  - delegates getConnection()
  - supports atomic datasource swap

SecretRotationWatcher
  - periodically checks secret version/value
  - triggers datasource refresh
  - records metrics and audit events

HealthIndicator
  - readiness depends on active datasource
  - liveness does not depend on transient downstream failure
```

### 12.2 Dependency direction

Business code must not call AWS Secrets Manager directly.

Bad:

```text
CaseRepository -> SecretsManagerClient -> GetSecretValue
```

Better:

```text
CaseRepository -> DataSource
Startup/Infra Layer -> SecretProvider -> DataSourceFactory
```

Reason:

- Repository should not know cloud secret semantics.
- Easier testing.
- Secret retrieval not repeated in hot path.
- Failure handling centralized.

---

## 13. Java SDK Client Setup

### 13.1 SecretsManagerClient as singleton bean

AWS SDK clients should be reused.

```java
@Configuration
public class AwsClientConfiguration {

    @Bean
    public SecretsManagerClient secretsManagerClient(AppAwsProperties props) {
        return SecretsManagerClient.builder()
                .region(Region.of(props.region()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .overrideConfiguration(c -> c
                        .apiCallTimeout(Duration.ofSeconds(5))
                        .apiCallAttemptTimeout(Duration.ofSeconds(2)))
                .build();
    }

    @Bean
    public SsmClient ssmClient(AppAwsProperties props) {
        return SsmClient.builder()
                .region(Region.of(props.region()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .overrideConfiguration(c -> c
                        .apiCallTimeout(Duration.ofSeconds(5))
                        .apiCallAttemptTimeout(Duration.ofSeconds(2)))
                .build();
    }
}
```

Notes:

- Timeouts must be explicit.
- Region must be deterministic.
- Credentials should come from runtime role.
- Do not instantiate client per request.

### 13.2 Java 8 to 25 considerations

For Java 8:

- Avoid APIs only available in newer JDKs.
- Be careful with TLS defaults and dependency versions.
- SDK v2 supports Java 8, but your framework version may not.

For Java 17/21/25:

- Prefer modern Spring Boot versions where possible.
- Use records for typed config models if your baseline allows.
- Use virtual threads carefully only outside SDK async event-loop contexts.
- Keep secret material lifetime short even with modern GC.

A Java 21-style secret model:

```java
public record DatabaseSecret(
        String engine,
        String host,
        int port,
        String databaseName,
        String username,
        String password,
        String versionId
) {}
```

Java 8-compatible model:

```java
public final class DatabaseSecret {
    private final String engine;
    private final String host;
    private final int port;
    private final String databaseName;
    private final String username;
    private final String password;
    private final String versionId;

    public DatabaseSecret(
            String engine,
            String host,
            int port,
            String databaseName,
            String username,
            String password,
            String versionId) {
        this.engine = requireNonBlank(engine, "engine");
        this.host = requireNonBlank(host, "host");
        this.port = port;
        this.databaseName = requireNonBlank(databaseName, "databaseName");
        this.username = requireNonBlank(username, "username");
        this.password = requireNonBlank(password, "password");
        this.versionId = requireNonBlank(versionId, "versionId");
    }

    // getters omitted
}
```

---

## 14. Reading Secret Safely

### 14.1 Raw SDK call

```java
public final class AwsSecretsProvider {
    private final SecretsManagerClient client;
    private final ObjectMapper objectMapper;

    public AwsSecretsProvider(SecretsManagerClient client, ObjectMapper objectMapper) {
        this.client = client;
        this.objectMapper = objectMapper;
    }

    public DatabaseSecret getCurrentDatabaseSecret(String secretId) {
        GetSecretValueResponse response = client.getSecretValue(GetSecretValueRequest.builder()
                .secretId(secretId)
                .versionStage("AWSCURRENT")
                .build());

        String secretJson = response.secretString();
        if (secretJson == null || secretJson.isBlank()) {
            throw new IllegalStateException("Database secret has no SecretString");
        }

        DatabaseSecretPayload payload = parse(secretJson);

        return new DatabaseSecret(
                payload.engine(),
                payload.host(),
                payload.port(),
                payload.dbname(),
                payload.username(),
                payload.password(),
                response.versionId());
    }

    private DatabaseSecretPayload parse(String json) {
        try {
            return objectMapper.readValue(json, DatabaseSecretPayload.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Database secret JSON is invalid", e);
        }
    }
}
```

Important:

- Never log `secretJson`.
- Never include password in exception message.
- Validate required fields.
- Include `versionId` for change detection.

### 14.2 Redacted representation

```java
public final class SecretLogView {
    public static String databaseSecret(DatabaseSecret s) {
        return "DatabaseSecret{" +
                "engine='" + s.engine() + '\'' +
                ", host='" + s.host() + '\'' +
                ", port=" + s.port() +
                ", databaseName='" + s.databaseName() + '\'' +
                ", username='" + s.username() + '\'' +
                ", password='<redacted>'" +
                ", versionId='" + s.versionId() + '\'' +
                '}';
    }
}
```

Do not rely on default `toString()` for objects containing secret material.

---

## 15. Building HikariDataSource from Secret

```java
public final class HikariDataSourceFactory {

    public HikariDataSource create(DatabaseSecret secret, DbPoolProperties pool) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(toJdbcUrl(secret));
        config.setUsername(secret.username());
        config.setPassword(secret.password());

        config.setMaximumPoolSize(pool.maxPoolSize());
        config.setMinimumIdle(pool.minimumIdle());
        config.setConnectionTimeout(pool.connectionTimeoutMs());
        config.setValidationTimeout(pool.validationTimeoutMs());
        config.setIdleTimeout(pool.idleTimeoutMs());
        config.setMaxLifetime(pool.maxLifetimeMs());
        config.setPoolName("case-management-db-" + shortVersion(secret.versionId()));

        config.setConnectionTestQuery(validationQuery(secret.engine()));

        HikariDataSource ds = new HikariDataSource(config);
        validate(ds);
        return ds;
    }

    private void validate(HikariDataSource ds) {
        try (Connection c = ds.getConnection();
             PreparedStatement ps = c.prepareStatement("SELECT 1")) {
            ps.execute();
        } catch (SQLException e) {
            closeQuietly(ds);
            throw new IllegalStateException("New datasource validation failed", e);
        }
    }
}
```

Design notes:

- Validation must happen before swap.
- Pool name should help identify version without exposing password.
- `maxLifetime` should be below database/network idle termination behavior.
- `minimumIdle` should not create too many connections during swap.

---

## 16. Refresh Workflow

### 16.1 Polling-based refresh

A simple approach:

```text
Every N minutes:
1. Fetch AWSCURRENT secret.
2. Compare version id with active version.
3. If same, do nothing.
4. If different:
   a. Build new datasource.
   b. Validate.
   c. Swap.
   d. Close old datasource after drain.
   e. Emit metric and audit event.
```

Pseudo-code:

```java
public final class DatabaseSecretRefreshJob implements Runnable {
    private final AwsSecretsProvider secretsProvider;
    private final HikariDataSourceFactory factory;
    private final RefreshableDataSource refreshableDataSource;
    private final String secretId;
    private final AtomicReference<String> activeVersionId = new AtomicReference<>();

    @Override
    public void run() {
        DatabaseSecret latest = secretsProvider.getCurrentDatabaseSecret(secretId);
        String active = activeVersionId.get();

        if (latest.versionId().equals(active)) {
            return;
        }

        HikariDataSource next = factory.create(latest, poolProperties);
        refreshableDataSource.swap(next);
        activeVersionId.set(latest.versionId());

        log.info("Database datasource rotated successfully. versionId={}", latest.versionId());
    }
}
```

### 16.2 Avoid overlapping refresh jobs

Do not allow two refresh jobs to run concurrently.

```java
private final ReentrantLock refreshLock = new ReentrantLock();

public void refreshIfNeeded() {
    if (!refreshLock.tryLock()) {
        return;
    }
    try {
        doRefresh();
    } finally {
        refreshLock.unlock();
    }
}
```

### 16.3 Backoff after failure

If refresh fails, do not retry in a tight loop.

```text
Failure 1 -> retry after 30s
Failure 2 -> retry after 1m
Failure 3 -> retry after 2m
Failure N -> capped at 5m
```

Emit metrics:

```text
secret.refresh.success.count
secret.refresh.failure.count
secret.refresh.duration.ms
secret.version.active
secret.version.detected_change.count
datasource.swap.success.count
datasource.swap.failure.count
```

Never emit secret value as metric label.

---

## 17. Health Check Semantics

Health checks must distinguish liveness and readiness.

### 17.1 Liveness

Liveness answers:

```text
Should the platform kill/restart this process?
```

Do not fail liveness just because Secrets Manager timed out once.

Bad:

```text
/liveness calls Secrets Manager
if timeout -> process restarted
```

This creates restart storms.

### 17.2 Readiness

Readiness answers:

```text
Can this instance safely receive traffic?
```

Readiness can fail if:

- No valid datasource is active.
- Required secret never loaded.
- Database is unreachable beyond threshold.
- Configuration invalid.

### 17.3 Degraded state

Sometimes service can run partially.

Example:

```text
Main database OK
Optional external notification secret unavailable
```

Health model:

```text
liveness: UP
readiness: UP
component notification: DEGRADED
metric/alert: emitted
```

---

## 18. Secret Rotation Timeline

A safe timeline looks like this:

```text
T-7 days:
- Confirm rotation schedule.
- Confirm app supports refresh.
- Confirm dashboards and alerts.
- Confirm AWSPREVIOUS rollback procedure.

T0:
- Secrets Manager starts rotation.
- AWSPENDING created.

T0 + small delta:
- Rotation Lambda updates target DB/user.
- Rotation Lambda tests pending credential.

T0 + test success:
- AWSCURRENT moved to new version.
- Old version becomes AWSPREVIOUS.

T0 + refresh interval:
- Java service detects new version.
- New Hikari pool is built and validated.
- DataSource swaps.
- Old pool drains.

T0 + observation window:
- Monitor connection errors.
- Monitor DB auth failures.
- Monitor service latency.
- Monitor secret refresh success.
```

Unsafe timeline:

```text
T0: Password in DB changed.
T1: App still uses old password.
T2: Connections churn.
T3: New connections fail.
T4: Pods restart.
T5: Incident expands.
```

---

## 19. Rollback Strategy

Rollback must be defined before rotation is enabled.

### 19.1 Rollback with AWSPREVIOUS

If new secret breaks application, possible recovery:

```text
1. Identify current version and previous version.
2. Confirm AWSPREVIOUS credential still valid in database.
3. Move AWSCURRENT label back to previous version if safe.
4. Trigger app secret refresh or wait for refresh interval.
5. Validate datasource swap back.
6. Monitor DB auth failures.
```

Do not blindly move labels without verifying target database state.

### 19.2 Rollback failure case

Rollback may fail if:

- Previous database password is no longer valid.
- Rotation Lambda already changed both users incorrectly.
- Secret labels are inconsistent.
- Application cache TTL is too long.
- App cannot refresh datasource without restart.

Therefore, mature design includes:

```text
- manual credential validation script
- break-glass DBA path
- app refresh endpoint or controlled restart path
- CloudTrail evidence of UpdateSecretVersionStage
- dashboard for auth failure spike
```

### 19.3 Emergency revocation

If secret is compromised, rotation is not only availability operation. It is security incident response.

Emergency path:

```text
1. Disable compromised credential at target system.
2. Create new credential.
3. Update secret.
4. Force app refresh/redeploy if necessary.
5. Search logs for leakage.
6. Revoke sessions/tokens if applicable.
7. Produce incident evidence.
```

Cache TTL must be evaluated against emergency revocation requirements.

---

## 20. Logging and Leak Prevention

### 20.1 Never log these

```text
password
client secret
access token
refresh token
private key
authorization header
cookie
signed URL query string
full JDBC URL if it embeds password
full secret JSON
```

### 20.2 Risky places

Secret leakage often happens in non-obvious places:

```text
Exception message
DEBUG log of config object
Actuator /env endpoint
Thread dump with system properties
Heap dump
CI/CD console log
Failed validation error
HTTP client wire log
Metric tag
Tracing span attribute
Audit event payload
```

### 20.3 Redaction policy

Implement centralized redaction:

```text
Keys containing:
password
passwd
pwd
secret
token
authorization
cookie
privateKey
apiKey
clientSecret
```

But do not rely only on key names. Some secret values appear under generic fields like `value`.

### 20.4 Safe log example

```text
INFO Secret refresh completed app=case-management env=prod secret=/apps/.../db/main versionId=abc123 durationMs=284
```

Unsafe:

```text
INFO Secret refresh completed secret={"username":"case_mgmt_app","password":"PlainTextPassword"}
```

---

## 21. Metrics and Alerts

### 21.1 Required metrics

```text
secret_fetch_success_total
secret_fetch_failure_total
secret_fetch_latency_ms
secret_cache_hit_total
secret_cache_miss_total
secret_refresh_success_total
secret_refresh_failure_total
secret_active_version_changed_total
datasource_swap_success_total
datasource_swap_failure_total
db_connection_auth_failure_total
db_connection_acquire_latency_ms
hikari_active_connections
hikari_idle_connections
hikari_pending_threads
```

### 21.2 Alert rules

Useful alerts:

```text
Secret refresh failures > threshold for 10 minutes
Datasource swap failure after detected version change
DB authentication failures spike
Hikari pending threads high
No successful secret refresh within expected interval
Rotation Lambda failure event
CloudTrail UpdateSecretVersionStage outside approved principal
```

Avoid alerting on every single transient GetSecretValue timeout. Alert on sustained failure or user-impacting signal.

### 21.3 Dashboard panels

A good dashboard includes:

```text
1. Current active secret version id/hash
2. Last successful refresh time
3. Secret fetch latency p50/p95/p99
4. Secret refresh failure count
5. Datasource swap count/failure
6. DB auth failures
7. Hikari pool utilization
8. Application error rate
9. Rotation Lambda errors
10. CloudTrail secret update events
```

Do not display secret value.

---

## 22. CI/CD and Environment Promotion

### 22.1 What belongs in CI/CD

CI/CD may deploy:

```text
application artifact
container image
IAM role/policy
SSM parameter names/defaults
Secrets Manager secret resource placeholder
rotation schedule
Lambda rotation function
KMS key alias/policy
```

CI/CD should not print secret values.

### 22.2 Secret creation vs secret value injection

For production, often better:

```text
Infra pipeline creates secret container/resource.
Secure operator or automated bootstrap writes initial value.
Rotation then owns subsequent values.
```

Avoid letting general build pipeline hold production database password.

### 22.3 Promotion model

```text
DEV:
- permissive rotation testing
- test database
- local/emulated fallback acceptable for dev only

UAT:
- production-like IAM
- rotation dry run
- dashboard/alert validation

PROD:
- least privilege
- approved rotation window or automatic schedule
- rollback tested
- audit evidence retained
```

---

## 23. Testing Strategy

### 23.1 Unit tests

Test:

```text
secret JSON parser
missing field validation
redaction behavior
datasource factory failure path
version change detection
no swap when same version
no swap when validation fails
```

### 23.2 Integration tests

Use real or sandbox AWS where possible for IAM/KMS semantics. Local emulators are useful but cannot prove IAM/KMS/CloudTrail behavior fully.

Test cases:

```text
Get SSM parameter by path
Get secret current version
Deny access to another service secret
KMS decrypt denied with wrong role
Malformed secret JSON fails startup
AWSCURRENT version change triggers refresh
```

### 23.3 Rotation simulation

In non-production:

```text
1. Start app with secret version A.
2. Create secret version B.
3. Move AWSCURRENT to B.
4. Validate app detects change.
5. Validate new datasource created.
6. Validate old pool drained.
7. Move AWSCURRENT back to A.
8. Validate rollback path.
```

### 23.4 Chaos tests

Inject:

```text
Secrets Manager timeout
KMS AccessDenied
SSM parameter missing
secret malformed
DB password invalid
rotation function partial failure
network DNS failure
database slow connect
```

Expected behavior must be explicit.

---

## 24. Failure Mode Table

| Failure | Detection | Expected Behavior | Operator Action |
|---|---|---|---|
| SSM parameter missing at startup | startup validation | fail startup/readiness down | fix config path or IAM |
| Secret missing | GetSecretValue error | fail startup if critical | restore secret or parameter reference |
| KMS decrypt denied | AWS exception | fail startup/refresh | fix KMS key policy/IAM |
| Secret JSON malformed | parser error | do not build datasource | fix secret version; do not promote |
| New DB password invalid | datasource validation failure | keep old datasource if valid | inspect rotation Lambda/DB state |
| AWSCURRENT moved too early | DB auth failure spike | degraded/outage depending old pool | rollback label or fix DB credential |
| Secrets Manager transient timeout | refresh failure metric | continue with cached active datasource | monitor; retry with backoff |
| Cache too stale after emergency revoke | security risk | force refresh/restart | shorten TTL; emergency playbook |
| Secret logged accidentally | log scan/SIEM | incident response | rotate secret; purge/limit logs if possible |
| Rotation Lambda fails | rotation event/error | AWSCURRENT should remain old | debug rotation function |

---

## 25. Design Decision Matrix

### 25.1 Store in SSM or Secrets Manager?

| Data | SSM Parameter Store | Secrets Manager |
|---|---:|---:|
| feature flag | yes | no |
| bucket name | yes | no |
| queue URL | yes | no |
| timeout value | yes | no |
| database password | possible as SecureString, but not ideal for rotation-heavy use | yes |
| OAuth client secret | possible | yes |
| private key | possible | yes |
| value requiring automatic rotation | not primary choice | yes |

### 25.2 Startup or lazy load?

| Dependency | Strategy |
|---|---|
| main DB credential | startup fail-fast + refreshable datasource |
| optional external API token | lazy/degraded possible |
| audit signing key | startup fail-fast if audit mandatory |
| feature flag | startup + periodic refresh optional |
| queue URL | startup fail-fast |

### 25.3 Cache TTL style

| Use Case | Cache Style |
|---|---|
| DB credential with scheduled monthly rotation | 5–60 min TTL with jitter, refresh watcher |
| emergency revocation-sensitive token | short TTL + explicit force refresh path |
| rarely used optional API key | lazy cache with bounded TTL |
| high-QPS hot path signing key | cache, but protect memory/logging strongly |

---

## 26. Production Reference Flow

```text
Startup:
1. App starts with APP_ENV=prod, APP_NAME=case-management.
2. Runtime role resolves via AWS default credential provider.
3. App reads SSM prefix /apps/aceas/prod/case-management/.
4. App reads db-secret-id from SSM.
5. App fetches Secrets Manager AWSCURRENT version.
6. App parses and validates secret JSON.
7. App creates and validates HikariDataSource.
8. App marks readiness UP.

Runtime:
1. Secret watcher checks AWSCURRENT every N minutes with jitter.
2. Same version -> no action.
3. New version -> build next datasource.
4. Validation success -> atomic swap.
5. Validation failure -> keep current datasource, alert.
6. Old datasource drains and closes.

Rotation:
1. Secrets Manager invokes rotation Lambda.
2. Lambda creates pending credential.
3. Lambda updates database.
4. Lambda tests pending credential.
5. Lambda marks pending version as current.
6. Apps refresh gradually.

Rollback:
1. Operator validates AWSPREVIOUS credential.
2. Operator moves AWSCURRENT back if safe.
3. Apps refresh gradually or force refresh.
4. Incident timeline recorded.
```

---

## 27. Production Checklist

### 27.1 Configuration checklist

- [ ] Environment name is explicit.
- [ ] SSM path hierarchy is standardized.
- [ ] Secret IDs are referenced from config, not hardcoded in code.
- [ ] Required parameters are validated at startup.
- [ ] Optional parameters have documented defaults.
- [ ] No secret value exists in application YAML, Docker image, or Git.

### 27.2 IAM checklist

- [ ] Runtime role can read only required SSM path.
- [ ] Runtime role can read only required secret ARN/name.
- [ ] Runtime role has `kms:Decrypt` only where needed.
- [ ] Runtime role cannot update secret value/stage.
- [ ] Rotation Lambda role is separate.
- [ ] Human/admin/break-glass access is audited.

### 27.3 Rotation checklist

- [ ] Rotation strategy selected: single-user or alternating-users.
- [ ] Rotation Lambda tested in DEV/UAT.
- [ ] App supports refresh without full restart.
- [ ] Hikari datasource swap tested.
- [ ] Rollback using AWSPREVIOUS tested.
- [ ] Dashboard and alerts exist.
- [ ] Cache TTL aligns with emergency revocation policy.

### 27.4 Logging checklist

- [ ] Secret objects do not expose default `toString()`.
- [ ] Redaction filter active.
- [ ] Actuator/env endpoints secured or disabled.
- [ ] HTTP wire logs disabled for sensitive requests.
- [ ] Metrics labels do not include secret material.
- [ ] Heap dump access restricted.

### 27.5 Operational checklist

- [ ] Runbook exists for failed rotation.
- [ ] Runbook exists for compromised secret.
- [ ] CloudTrail records secret update/stage events.
- [ ] Rotation Lambda logs are monitored.
- [ ] DB auth failures are monitored.
- [ ] Service readiness behavior is tested.

---

## 28. Common Anti-Patterns

### Anti-pattern 1: Read secret on every request

```text
HTTP request -> GetSecretValue -> DB connect/use
```

Bad because:

- Adds latency.
- Increases cost.
- Creates throttling risk.
- Makes Secrets Manager a hot-path dependency.

### Anti-pattern 2: Read secret once forever

```text
Startup -> read secret -> never refresh
```

Bad because:

- Rotation breaks app eventually.
- Emergency revocation ineffective.

### Anti-pattern 3: Store all config in one mega secret

Bad because:

- Overbroad access.
- Poor auditability.
- Rotation becomes risky.

### Anti-pattern 4: App uses admin DB account

Bad because:

- Violates least privilege.
- Credential compromise becomes catastrophic.

### Anti-pattern 5: Restart-only rotation strategy

Bad because:

- Causes operational fragility.
- Can amplify outage.
- Does not prove refresh semantics.

### Anti-pattern 6: Expose secrets through actuator

Spring Boot actuator endpoints can expose environment/config if misconfigured. Secure them aggressively.

### Anti-pattern 7: Log full exception payload blindly

Some exception objects or config dumps may include sensitive values. Redact before logging.

---

## 29. Top 1% Engineering Perspective

A normal implementation asks:

```text
How do I read password from Secrets Manager?
```

A senior/top-tier implementation asks:

```text
What is the lifecycle of this credential?
Who can read it?
Who can rotate it?
Who can roll it back?
How does the app detect new versions?
What happens if new credential is invalid?
Can the old pool continue safely?
How do we prevent secret leak in logs and heap dumps?
How do we prove who changed what?
How do we recover at 2 AM without guessing?
What metric tells us rotation is failing before users complain?
```

The difference is not API knowledge. The difference is lifecycle modelling.

Secure configuration is a state machine:

```text
UNINITIALIZED
  -> CONFIG_LOADED
  -> SECRET_LOADED
  -> DATASOURCE_VALIDATED
  -> READY
  -> ROTATION_DETECTED
  -> NEXT_SECRET_VALIDATED
  -> DATASOURCE_SWAPPED
  -> OLD_POOL_DRAINED
  -> READY
```

Failure states matter:

```text
CONFIG_MISSING
SECRET_ACCESS_DENIED
SECRET_MALFORMED
NEXT_SECRET_INVALID
SWAP_FAILED
OLD_AND_NEW_CREDENTIAL_FAILED
SECRET_COMPROMISED
ROLLBACK_REQUIRED
```

Design each transition deliberately.

---

## 30. Minimal Reference Architecture

```text
                         +-----------------------+
                         | CloudTrail / Audit    |
                         +-----------^-----------+
                                     |
+----------------+       +----------+-----------+
| SSM Parameter  |       | Secrets Manager       |
| Store          |       | AWSCURRENT/PREVIOUS   |
+-------^--------+       +----------^-----------+
        |                           |
        |                           | decrypt via
        |                           v
        |                  +--------+--------+
        |                  | AWS KMS         |
        |                  +-----------------+
        |
        v
+--------------------------+
| Java/Spring Boot Service |
|                          |
| RuntimeConfigLoader      |
| SecretProvider           |
| RefreshableDataSource    |
| HikariCP                 |
| RotationWatcher          |
+------------+-------------+
             |
             v
+--------------------------+
| Database                 |
| app user A/B             |
+--------------------------+
             ^
             |
+------------+-------------+
| Rotation Lambda          |
| create/set/test/finish   |
+--------------------------+
```

---

## 31. Exercises

### Exercise 1 — Classify runtime data

For your current system, classify these as SSM config or Secrets Manager secret:

```text
RDS endpoint
RDS username/password
S3 document bucket
SQS queue URL
JWT private key
feature toggle
external API base URL
external API token
batch size
KMS key ID
```

Then explain the access policy for each.

### Exercise 2 — Design secret path hierarchy

Design paths for:

```text
DEV/UAT/PROD
case-management-service
document-service
reporting-service
```

Ensure one service cannot read another service's secret.

### Exercise 3 — Model rotation as state machine

Draw states for:

```text
current credential valid
pending credential created
pending credential applied to DB
pending credential tested
current label moved
app refreshed
old credential retired
```

Add failure transitions.

### Exercise 4 — Hikari rotation strategy

Decide whether your system should use:

```text
single-user rotation
alternating-users rotation
restart-only rotation
refreshable datasource
```

Explain trade-offs.

### Exercise 5 — Incident playbook

Write a runbook for:

```text
Secret rotated, but DB authentication failures spike.
```

Include detection, immediate containment, rollback, evidence, and prevention.

---

## 32. Key Takeaways

1. Secrets Manager is not just a key-value store; it owns version lifecycle and rotation semantics.
2. SSM Parameter Store is usually better for non-sensitive runtime configuration.
3. Runtime app role, rotation role, and admin role must be separated.
4. Secret retrieval is a remote dependency and must have timeout, caching, and failure strategy.
5. Database secret rotation requires coordinating Secrets Manager, database user state, HikariCP, and application readiness.
6. Reading secret once forever breaks rotation; reading secret every request creates cost and reliability problems.
7. A refreshable datasource boundary is often the cleanest design for zero-downtime DB credential rotation.
8. `AWSCURRENT`, `AWSPREVIOUS`, and `AWSPENDING` are not labels to memorize; they are lifecycle states.
9. Rollback must be tested before production rotation is enabled.
10. Secret safety includes logs, metrics, traces, heap dumps, CI/CD output, and operational tooling.

---

## 33. References

- AWS Secrets Manager: retrieving secrets with Java and client-side caching
- AWS Secrets Manager: Java `SecretCache`
- AWS Secrets Manager: rotation by Lambda function
- AWS Secrets Manager: rotation function stages and staging labels
- AWS Secrets Manager: SDK for Java 2.x examples
- AWS Systems Manager Parameter Store documentation
- AWS KMS documentation
- AWS SDK for Java 2.x timeout, retry, and credential provider documentation
- HikariCP configuration and lifecycle behavior

---

## 34. Where This Fits in the Series

This part connects:

- Part 2: Credentials, Region, STS, and Identity Resolution
- Part 3: IAM least privilege
- Part 4: SDK timeout/retry/backpressure
- Part 11: Secrets Manager and SSM Parameter Store
- Part 12: KMS for Application Engineers
- Part 24: CloudWatch, CloudTrail, and Auditability
- Part 25: Security Hardening
- Part 26: Cost and Quota Engineering
- Part 27: Spring Boot Integration

Next part moves from secure configuration into event-driven regulatory workflow design using SNS, SQS, and EventBridge.

---

# Status

Part 29 selesai. Seri belum selesai.

Next: `part-30-event-driven-case-management-workflow-with-sns-sqs-eventbridge.md`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-28-resilient-file-processing-pipeline-with-s3-sqs-lambda-worker.md">⬅️ Part 28 — Resilient File Processing Pipeline with S3 + SQS + Lambda/Worker</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-30-event-driven-case-management-workflow-with-sns-sqs-eventbridge.md">Part 30 — Event-Driven Case Management Workflow with SNS/SQS/EventBridge ➡️</a>
</div>
