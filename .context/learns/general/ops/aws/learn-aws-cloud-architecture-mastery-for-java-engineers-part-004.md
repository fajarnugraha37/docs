# learn-aws-cloud-architecture-mastery-for-java-engineers-part-004.md

# Part 004 — Credentials for Java Applications: SDK, Provider Chain, STS, AssumeRole, dan Runtime Identity

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS sampai level desain produksi  
> Fokus part ini: bagaimana aplikasi Java mendapatkan credential AWS secara aman, bagaimana AWS SDK for Java 2.x memakai credential tersebut, bagaimana temporary credential bekerja, dan bagaimana mendesain runtime identity tanpa secret statis.

---

## 0. Kenapa bagian ini penting?

Banyak engineer belajar AWS dari sisi service: S3, DynamoDB, ECS, Lambda, RDS, SQS, dan seterusnya. Tetapi aplikasi produksi tidak berinteraksi dengan AWS hanya karena kita “punya permission”. Aplikasi berinteraksi dengan AWS melalui kombinasi:

1. **identity** — siapa yang melakukan request;
2. **credential** — bukti kriptografis yang dipakai untuk menandatangani request;
3. **permission** — apa yang boleh dilakukan identity tersebut;
4. **runtime environment** — di mana aplikasi berjalan;
5. **SDK behavior** — bagaimana client menemukan credential, memilih region, retry, timeout, refresh, dan menangani error.

Part sebelumnya membahas IAM sebagai authorization engine. Part ini membahas sisi aplikasi Java: **bagaimana permission itu menjadi request nyata dari JVM ke AWS API**.

Mental model inti:

> Aplikasi Java tidak “login ke AWS”. Aplikasi Java menandatangani setiap request AWS dengan credential yang berasal dari identity tertentu. Credential itu sebaiknya temporary, scoped, auto-rotated, dan diberikan oleh runtime environment, bukan disimpan di source code.

Dalam sistem produksi, kesalahan credential sering menghasilkan insiden yang sulit dilacak:

- aplikasi lokal tidak sengaja memakai credential production;
- container memakai execution role, bukan task role;
- Lambda gagal karena role kurang permission;
- CI/CD role terlalu broad dan bisa deploy ke semua account;
- access key bocor di repository;
- STS session expired di tengah proses batch;
- retry SDK memperpanjang latency sampai request user timeout;
- region salah sehingga request masuk ke service/resource yang tidak ada;
- assume role chain terlalu panjang dan sulit diaudit;
- aplikasi memakai credential statis karena “lebih gampang”.

Top AWS engineer tidak hanya tahu cara membuat `S3Client`. Mereka tahu **dari mana credential berasal, kapan berubah, siapa identity efektifnya, policy apa yang mengevaluasi request, dan failure mode apa yang muncul saat credential gagal**.

---

## 1. Request AWS dari sudut pandang aplikasi Java

Saat aplikasi Java memanggil AWS API, misalnya:

```java
s3Client.putObject(request, requestBody);
```

secara konseptual terjadi beberapa tahap:

1. SDK membangun request HTTP ke endpoint service AWS.
2. SDK menentukan region.
3. SDK mencari credential melalui credentials provider.
4. SDK menandatangani request memakai AWS Signature Version 4.
5. Request dikirim lewat HTTP client.
6. AWS menerima request dan memverifikasi signature.
7. AWS mengekstrak principal dari credential.
8. AWS menjalankan authorization evaluation.
9. Service mengeksekusi action jika allowed.
10. SDK menerima response atau error.
11. SDK mungkin melakukan retry jika error dianggap retryable.

Diagram mental:

```text
Java code
  |
  v
AWS SDK client
  |
  |-- resolve region
  |-- resolve credential
  |-- sign request
  |-- apply timeout/retry
  v
AWS service endpoint
  |
  |-- authenticate signature
  |-- identify principal
  |-- evaluate IAM/resource/SCP/session policy
  |-- execute or deny
  v
response / error
```

Jadi credential bukan hanya “password”. Credential adalah input untuk membentuk identitas efektif request.

---

## 2. Empat konsep yang harus dipisahkan

### 2.1 Identity

Identity menjawab: **siapa subjeknya?**

Contoh:

- IAM user;
- IAM role;
- AWS account root user;
- federated identity dari IAM Identity Center;
- assumed role session;
- workload identity dari ECS task role;
- Lambda execution role;
- EC2 instance profile role;
- EKS service account via web identity.

Untuk workload modern, identity idealnya adalah **role**, bukan user.

---

### 2.2 Credential

Credential menjawab: **bukti apa yang dipakai untuk menandatangani request?**

Credential AWS biasanya berupa:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN  # untuk temporary credential
```

Access key ID bukan secret. Secret access key adalah secret. Session token adalah bagian dari temporary credential.

Credential dapat bersifat:

| Jenis | Contoh | Risiko |
|---|---|---|
| Long-term | IAM user access key | bocor, lupa rotate, sulit scope berdasarkan runtime |
| Temporary | STS AssumeRole credential | expired otomatis, lebih aman, perlu refresh |
| Runtime-provided | ECS task role, Lambda execution role, EC2 instance profile | recommended untuk workload produksi |

---

### 2.3 Permission

Permission menjawab: **apa yang boleh dilakukan identity tersebut?**

Permission berasal dari kombinasi:

- identity-based policy;
- resource-based policy;
- permissions boundary;
- session policy;
- Service Control Policy;
- VPC endpoint policy;
- KMS key policy;
- service-specific guardrail.

Credential valid tidak berarti request allowed.

---

### 2.4 Runtime identity

Runtime identity menjawab: **identity apa yang digunakan aplikasi saat berjalan di environment tertentu?**

Contoh:

| Runtime | Identity yang lazim |
|---|---|
| Local development | SSO profile / named profile |
| GitHub Actions / CI | OIDC federated role / deploy role |
| EC2 | Instance profile role |
| ECS | Task role |
| Lambda | Execution role |
| EKS | IAM Roles for Service Accounts / Pod Identity |
| Batch | Job role |

Pertanyaan desainnya bukan “credential apa yang saya pasang?”, tetapi:

> Runtime ini seharusnya menjadi principal apa, dengan permission apa, untuk workload apa, di account mana, dan selama berapa lama?

---

## 3. Prinsip utama: jangan hardcode credential

Rule praktis:

> Source code tidak boleh tahu access key. Source code hanya boleh tahu cara memakai provider chain atau provider eksplisit yang aman.

Contoh buruk:

```java
AwsBasicCredentials credentials = AwsBasicCredentials.create(
    "AKIA...",
    "secret..."
);

S3Client s3 = S3Client.builder()
    .credentialsProvider(StaticCredentialsProvider.create(credentials))
    .build();
```

Masalah:

1. secret mudah masuk Git;
2. sulit rotate;
3. bisa terbawa ke log, dump, config, atau artifact;
4. credential biasanya terlalu broad;
5. tidak jelas environment mana yang dipakai;
6. audit CloudTrail akan menunjukkan IAM user/access key, bukan workload identity yang meaningful;
7. blast radius besar jika bocor.

Contoh lebih baik:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Dengan ini, SDK memakai default credentials provider chain. Di local development, chain bisa menemukan profile. Di ECS, chain bisa menemukan task role. Di Lambda, chain memakai environment/runtime credential. Di EC2, chain memakai instance profile.

---

## 4. AWS SDK for Java 2.x: client sebagai configured runtime adapter

AWS SDK client bukan sekadar wrapper API. Ia adalah komponen runtime yang menggabungkan:

- service endpoint;
- region;
- credentials provider;
- HTTP client;
- retry strategy;
- timeout;
- marshalling/unmarshalling;
- signer;
- metric/logging hook;
- async/sync behavior.

Contoh minimal:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Contoh produksi lebih eksplisit:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .credentialsProvider(DefaultCredentialsProvider.create())
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .apiCallTimeout(Duration.ofSeconds(10))
        .apiCallAttemptTimeout(Duration.ofSeconds(3))
        .build())
    .build();
```

Prinsip:

1. **Client sebaiknya dibuat sekali dan di-reuse.**
2. **Region harus eksplisit untuk workload produksi.**
3. **Credentials provider harus sesuai runtime.**
4. **Timeout harus diset, jangan mengandalkan default tanpa sadar.**
5. **Retry harus dipahami karena memengaruhi latency dan beban downstream.**

---

## 5. Default credentials provider chain

Default credentials provider chain adalah mekanisme SDK untuk mencari credential dari beberapa sumber secara berurutan.

Secara konseptual, chain akan mencari credential dari lokasi seperti:

1. Java system properties;
2. environment variables;
3. web identity token;
4. shared AWS config/credentials profile;
5. container credentials;
6. instance metadata service.

Urutan detail dapat berbeda berdasarkan versi dan konfigurasi, tetapi mental modelnya tetap:

> SDK mencari credential dari sumber paling eksplisit/dekat ke proses, lalu fallback ke sumber runtime environment.

Contoh:

```java
S3Client s3 = S3Client.builder()
    .credentialsProvider(DefaultCredentialsProvider.create())
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Atau bahkan:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Jika tidak ada provider credential yang valid, error biasanya muncul seperti:

```text
Unable to load credentials from any of the providers in the chain
```

Cara membaca error ini:

- bukan berarti IAM policy salah;
- bukan berarti service AWS down;
- ini berarti SDK tidak berhasil menemukan credential lokal/runtime;
- authorization belum sempat terjadi karena authentication gagal di sisi client.

---

## 6. Default chain adalah convenience, bukan alasan untuk desain kabur

Default chain berguna karena satu code path bisa berjalan di banyak environment.

Tetapi risiko default chain adalah ambiguity.

Contoh bahaya:

```text
Local laptop punya beberapa profile:
- dev-admin
- staging-readonly
- prod-poweruser

Aplikasi lokal dijalankan tanpa AWS_PROFILE.
SDK memilih credential dari environment variable lama.
Request tidak sengaja masuk ke production.
```

Karena itu, untuk local tooling dan test berisiko tinggi, pertimbangkan:

- wajibkan `AWS_PROFILE` eksplisit;
- tampilkan account ID saat startup;
- validasi region/account expected;
- fail fast jika account tidak sesuai;
- gunakan named profile yang jelas;
- jangan simpan credential production long-term di laptop;
- gunakan AWS IAM Identity Center / SSO profile untuk human.

Contoh validasi account saat startup:

```java
StsClient sts = StsClient.builder()
    .region(Region.AWS_GLOBAL)
    .build();

GetCallerIdentityResponse identity = sts.getCallerIdentity();

String accountId = identity.account();
if (!"123456789012".equals(accountId)) {
    throw new IllegalStateException("Unexpected AWS account: " + accountId);
}
```

Catatan: STS `GetCallerIdentity` sangat berguna untuk debugging karena menunjukkan identity efektif request.

---

## 7. Region provider chain

Credential menjawab “siapa”. Region menjawab “ke mana”.

Banyak error AWS sebenarnya adalah region mismatch.

Contoh:

- DynamoDB table dibuat di `ap-southeast-1`, aplikasi memakai `us-east-1`;
- SQS queue URL dari region berbeda;
- Secrets Manager secret ada di region A tetapi Lambda berjalan dengan config region B;
- STS regional endpoint berbeda dari asumsi;
- S3 bucket global namespace tetapi operation tertentu tetap region-sensitive.

Rule produksi:

> Untuk aplikasi server-side, region sebaiknya eksplisit dari deployment configuration, bukan implicit dari laptop/runtime default.

Contoh:

```java
Region region = Region.of(System.getenv("AWS_REGION"));

DynamoDbClient dynamo = DynamoDbClient.builder()
    .region(region)
    .build();
```

Tetapi jangan asal percaya environment variable. Validasi saat startup jika workload harus berjalan di region tertentu.

---

## 8. Runtime identity per environment

### 8.1 Local development

Local development idealnya memakai:

- AWS IAM Identity Center / SSO;
- named profile;
- role assumption ke dev account;
- permission minimal;
- short-lived session.

Contoh menjalankan aplikasi lokal:

```bash
aws sso login --profile dev-engineer
AWS_PROFILE=dev-engineer java -jar app.jar
```

Atau dengan Spring Boot:

```bash
AWS_PROFILE=dev-engineer \
AWS_REGION=ap-southeast-1 \
java -jar service.jar
```

Hindari:

- access key production di `~/.aws/credentials`;
- memakai default profile untuk semua hal;
- memakai admin credential untuk menjalankan integration test;
- membuat IAM user per developer tanpa lifecycle governance.

---

### 8.2 CI/CD

CI/CD sebaiknya memakai role khusus, bukan access key statis.

Pattern modern:

```text
CI provider identity
  -> OIDC federation
  -> Assume deployment role di AWS account target
  -> deploy artifact / update infrastructure
```

Role CI/CD harus dipisah berdasarkan tujuan:

- build role;
- test role;
- deploy-dev role;
- deploy-staging role;
- deploy-prod role;
- read-only audit role.

Anti-pattern:

```text
Satu access key ADMIN disimpan sebagai CI secret dan dipakai deploy semua account.
```

Masalah:

- secret bocor = semua account compromised;
- sulit audit workload mana melakukan apa;
- sulit enforce approval gate;
- sulit revoke sebagian;
- tidak ada session context yang kaya.

---

### 8.3 EC2

EC2 memakai **instance profile** yang menghubungkan IAM role ke instance.

Mental model:

```text
EC2 instance
  -> instance profile
  -> IAM role
  -> temporary credentials exposed via IMDS
  -> SDK mengambil credential otomatis
```

Aplikasi Java di EC2 cukup:

```java
SqsClient sqs = SqsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

SDK akan mencari credential dari instance metadata jika provider sebelumnya tidak ada.

Praktik penting:

- gunakan IMDSv2;
- jangan taruh access key di instance;
- jangan pakai role terlalu broad;
- pisahkan role per workload;
- jangan share satu role untuk semua instance;
- audit CloudTrail berdasarkan assumed-role session.

Failure mode:

| Gejala | Kemungkinan penyebab |
|---|---|
| credential tidak ditemukan | instance tanpa role / IMDS blocked |
| AccessDenied | role ada tetapi policy kurang |
| wrong account | AMI/user data membawa environment variable credential |
| timeout ke metadata | firewall/proxy/network config mengganggu IMDS |

---

### 8.4 ECS

ECS memiliki dua role yang sering tertukar:

| Role | Dipakai untuk | Dipakai oleh |
|---|---|---|
| Task execution role | pull image, publish logs, fetch secret untuk agent | ECS agent/platform |
| Task role | permission aplikasi ke AWS services | container aplikasi |

Jika aplikasi Java perlu akses S3/DynamoDB/SQS, permission harus ada di **task role**, bukan hanya execution role.

Mental model:

```text
ECS task
  |-- execution role: platform operations
  |-- task role: application AWS API calls
```

Failure umum:

```text
Aplikasi AccessDenied ke DynamoDB,
padahal execution role sudah diberi permission DynamoDB.
```

Root cause:

```text
Permission diberikan ke role yang salah.
Aplikasi memakai task role, bukan execution role.
```

Pattern produksi:

- satu task role per service;
- permission minimal per service;
- jangan gunakan task role shared untuk semua service;
- validasi caller identity di startup untuk environment kritis;
- log role ARN saat startup tanpa membocorkan credential.

---

### 8.5 Lambda

Lambda memakai execution role.

Mental model:

```text
Lambda function
  -> execution role
  -> temporary credential injected ke runtime
  -> SDK memakai credential otomatis
```

Kode Java:

```java
public class Handler implements RequestHandler<Request, Response> {
    private final DynamoDbClient dynamo = DynamoDbClient.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();

    @Override
    public Response handleRequest(Request request, Context context) {
        // use dynamo
        return new Response();
    }
}
```

Client dibuat sebagai field agar reuse antar invocation dalam execution environment yang sama.

Perhatikan:

- Lambda environment bisa reused;
- credential temporary direfresh oleh runtime/provider;
- jangan buat client baru tiap invocation jika tidak perlu;
- jangan menyimpan secret di static field jika secret perlu rotation awareness;
- timeout Lambda harus konsisten dengan SDK timeout.

Failure mode:

| Gejala | Penyebab umum |
|---|---|
| AccessDenied | execution role kurang permission |
| timeout | SDK timeout lebih lama dari Lambda timeout |
| throttling | concurrency terlalu tinggi ke downstream |
| cold start lambat | client init, DNS, class loading, dependency besar |

---

### 8.6 EKS

Karena seri Kubernetes sudah terpisah, kita tidak akan membahas Pod, Deployment, Service, Ingress, dan scheduler.

Yang AWS-specific:

- pod perlu AWS identity;
- jangan memberikan node role terlalu broad;
- gunakan identity per service account/pod;
- AWS menyediakan pola seperti IAM Roles for Service Accounts atau mekanisme pod identity;
- SDK mengambil credential dari web identity/container provider sesuai runtime.

Anti-pattern:

```text
Semua pod memakai node instance role yang punya permission ke semua AWS services.
```

Masalah:

- satu pod compromised bisa memakai permission semua workload di node;
- audit tidak granular;
- tenant/service isolation buruk;
- least privilege tidak realistis.

---

## 9. STS: temporary credential sebagai fondasi AWS modern

AWS Security Token Service memungkinkan identity mendapatkan temporary security credentials.

Operasi paling penting untuk engineer aplikasi:

```text
AssumeRole
GetCallerIdentity
AssumeRoleWithWebIdentity
```

Mental model `AssumeRole`:

```text
Caller principal
  -> allowed to call sts:AssumeRole?
  -> target role trust policy accepts caller?
  -> STS issues temporary credentials
  -> application uses temporary credentials as assumed role session
```

Dua policy harus cocok:

1. caller harus punya permission `sts:AssumeRole` ke target role;
2. target role trust policy harus mempercayai caller.

Jika salah satu tidak cocok, assume role gagal.

---

## 10. AssumeRole dengan Java SDK

Contoh eksplisit:

```java
StsClient sts = StsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

AssumeRoleRequest assumeRoleRequest = AssumeRoleRequest.builder()
    .roleArn("arn:aws:iam::222222222222:role/orders-read-role")
    .roleSessionName("orders-service-local-debug")
    .build();

AssumeRoleResponse response = sts.assumeRole(assumeRoleRequest);

Credentials c = response.credentials();

AwsSessionCredentials sessionCredentials = AwsSessionCredentials.create(
    c.accessKeyId(),
    c.secretAccessKey(),
    c.sessionToken()
);

DynamoDbClient dynamo = DynamoDbClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .credentialsProvider(StaticCredentialsProvider.create(sessionCredentials))
    .build();
```

Ini berguna untuk memahami mekanisme, tetapi untuk aplikasi produksi biasanya lebih baik memakai provider bawaan yang bisa refresh credential otomatis.

Contoh memakai STS assume role provider:

```java
StsClient sts = StsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

StsAssumeRoleCredentialsProvider provider = StsAssumeRoleCredentialsProvider.builder()
    .stsClient(sts)
    .refreshRequest(AssumeRoleRequest.builder()
        .roleArn("arn:aws:iam::222222222222:role/orders-read-role")
        .roleSessionName("orders-service")
        .build())
    .build();

DynamoDbClient dynamo = DynamoDbClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .credentialsProvider(provider)
    .build();
```

Catatan desain:

- `roleSessionName` harus meaningful;
- jangan memakai session name generik seperti `test` atau `app`;
- untuk audit, masukkan service/environment/build identifier;
- jangan masukkan PII atau secret ke session name;
- session duration harus sesuai workload;
- long-running batch harus memastikan provider bisa refresh.

---

## 11. Cross-account access dari aplikasi

Cross-account access adalah hal umum pada AWS multi-account architecture.

Contoh:

```text
Application account: 111111111111
Data account       : 222222222222

orders-service di account 111 perlu read object dari S3 bucket di account 222.
```

Ada beberapa pendekatan:

### Pendekatan A — Resource policy langsung

Bucket policy di account 222 mengizinkan role dari account 111.

```text
orders-service-role -> s3:GetObject -> bucket policy allows principal
```

Cocok jika akses spesifik resource dan tidak perlu role switching kompleks.

### Pendekatan B — Assume role ke account target

Role di account 222 mempercayai role di account 111. Aplikasi assume role lalu mengakses resource.

```text
orders-service-role
  -> sts:AssumeRole
  -> data-read-role in account 222
  -> s3:GetObject
```

Cocok jika:

- ingin audit sebagai role di account target;
- ingin centralize permission di account target;
- ingin session policy;
- ingin access boundary lebih eksplisit.

Trade-off:

| Aspek | Resource policy | Assume role |
|---|---|---|
| Simplicity | lebih sederhana | lebih kompleks |
| Audit di target | principal eksternal terlihat | assumed role session terlihat |
| Permission ownership | resource owner | role owner di target |
| Runtime complexity | rendah | perlu STS/provider |
| Scaling multi-resource | bisa rumit | lebih rapi |

---

## 12. Session policy dan scoped-down credential

Saat assume role, kita bisa menambahkan session policy untuk membatasi permission session.

Mental model:

```text
Effective permission = role permission ∩ session policy ∩ boundary ∩ SCP ∩ other controls
```

Session policy tidak bisa menambah permission di luar role. Ia hanya bisa membatasi.

Use case:

- temporary access untuk tenant tertentu;
- scoped access untuk batch job tertentu;
- membatasi deployment session hanya untuk stack tertentu;
- membatasi support session hanya read-only.

Contoh konseptual:

```java
AssumeRoleRequest request = AssumeRoleRequest.builder()
    .roleArn("arn:aws:iam::222222222222:role/tenant-data-access")
    .roleSessionName("tenant-abc-job-20260620")
    .policy("""
        {
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": "s3:GetObject",
              "Resource": "arn:aws:s3:::tenant-data-bucket/tenant-abc/*"
            }
          ]
        }
        """)
    .build();
```

Risiko:

- policy string besar dan sulit maintain;
- debugging effective permission lebih kompleks;
- session policy tidak selalu diperlukan jika role/resource policy sudah cukup baik.

---

## 13. Credential refresh

Temporary credential punya expiration.

Jika aplikasi mengambil temporary credential manual lalu menyimpannya tanpa refresh, aplikasi akan gagal setelah credential expired.

Anti-pattern:

```java
AssumeRoleResponse response = sts.assumeRole(request);
AwsSessionCredentials creds = AwsSessionCredentials.create(...);

// disimpan sebagai static final dan dipakai berjam-jam
```

Gejala:

```text
ExpiredTokenException
The security token included in the request is expired
```

Pattern yang lebih baik:

- gunakan provider yang auto-refresh;
- reuse SDK client;
- jangan membuat provider custom kecuali perlu;
- observasi error expired token;
- pastikan waktu system tidak drift parah.

---

## 14. Sync client vs async client

AWS SDK for Java 2.x menyediakan client synchronous dan asynchronous untuk banyak service.

### 14.1 Sync client

Contoh:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Karakter:

- call blocking;
- cocok untuk aplikasi sederhana;
- mudah dipahami;
- integrasi langsung dengan thread-per-request model;
- perlu hati-hati pada thread pool servlet/container.

### 14.2 Async client

Contoh:

```java
S3AsyncClient s3 = S3AsyncClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

CompletableFuture<PutObjectResponse> future = s3.putObject(request, asyncRequestBody);
```

Karakter:

- non-blocking API dengan `CompletableFuture`;
- cocok untuk high concurrency;
- lebih kompleks untuk error handling;
- perlu mengerti event loop / async HTTP client;
- perlu backpressure di level aplikasi;
- jangan mencampur async client dengan blocking call sembarangan.

Decision matrix:

| Kondisi | Pilihan awal |
|---|---|
| Spring MVC blocking app | sync client cukup |
| Batch job sederhana | sync client |
| High-concurrency gateway | async client dipertimbangkan |
| Reactive stack | async client lebih natural |
| Lambda sederhana | sync client biasanya cukup |
| Upload/download besar | lihat S3 transfer manager / async streaming |

---

## 15. Client reuse dan lifecycle

SDK client biasanya thread-safe dan mahal jika dibuat berulang.

Anti-pattern:

```java
public void handle(Request req) {
    S3Client s3 = S3Client.builder().build();
    s3.putObject(...);
    s3.close();
}
```

Masalah:

- connection pool tidak reused;
- TLS handshake berulang;
- latency naik;
- resource leak jika tidak ditutup;
- Lambda cold/warm behavior memburuk;
- thread/socket exhaustion.

Pattern:

```java
public final class AwsClients implements AutoCloseable {
    private final S3Client s3;
    private final DynamoDbClient dynamo;

    public AwsClients(Region region) {
        this.s3 = S3Client.builder()
            .region(region)
            .build();

        this.dynamo = DynamoDbClient.builder()
            .region(region)
            .build();
    }

    public S3Client s3() {
        return s3;
    }

    public DynamoDbClient dynamo() {
        return dynamo;
    }

    @Override
    public void close() {
        s3.close();
        dynamo.close();
    }
}
```

Dalam Spring Boot:

```java
@Configuration
public class AwsClientConfig {

    @Bean
    S3Client s3Client(@Value("${app.aws.region}") String region) {
        return S3Client.builder()
            .region(Region.of(region))
            .build();
    }
}
```

Biarkan Spring mengelola lifecycle bean.

---

## 16. Timeout: jangan biarkan request menggantung

Ada beberapa level timeout:

1. **connection timeout** — waktu maksimal membuka koneksi;
2. **socket/read timeout** — waktu menunggu data;
3. **API call attempt timeout** — batas untuk satu attempt;
4. **API call timeout** — batas total semua attempts termasuk retry.

Mental model:

```text
apiCallTimeout
  includes:
    attempt 1 timeout
    retry delay
    attempt 2 timeout
    retry delay
    attempt 3 timeout
```

Contoh:

```java
DynamoDbClient dynamo = DynamoDbClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .apiCallAttemptTimeout(Duration.ofSeconds(1))
        .apiCallTimeout(Duration.ofSeconds(3))
        .build())
    .build();
```

Rule desain:

> SDK timeout harus lebih kecil dari timeout caller/user journey.

Contoh buruk:

```text
HTTP request timeout di ALB/client: 5 detik
Service handler timeout budget: 4 detik
DynamoDB apiCallTimeout: 10 detik
```

Akibat:

- user request sudah gagal;
- thread masih menunggu AWS call;
- retry tetap berjalan;
- resource server habis;
- latency tail memburuk.

Lebih baik:

```text
HTTP request budget: 4 detik
Business logic budget: 3 detik
DynamoDB call budget: 500 ms - 1 detik
Fallback/response budget: sisa waktu
```

---

## 17. Retry, backoff, dan retry amplification

AWS SDK punya retry mechanism untuk error tertentu seperti transient error dan throttling.

Tetapi retry bukan magic.

Retry memperbaiki probabilitas sukses saat error sementara, tetapi juga:

- menambah latency;
- menambah traffic ke service yang mungkin sedang bermasalah;
- memperbesar load saat banyak instance retry bersamaan;
- bisa membuat duplicate side effect jika operasi tidak idempotent;
- bisa membuat request user timeout walaupun operasi akhirnya sukses.

Mental model:

```text
Retry is a load multiplier.
```

Jika 1.000 request gagal dan masing-masing retry 3 kali, downstream bisa menerima 4.000 attempts.

Pattern aman:

1. set timeout;
2. gunakan exponential backoff + jitter;
3. gunakan idempotency token untuk write;
4. batasi concurrency;
5. pisahkan retry untuk read vs write;
6. observasi retry count;
7. jangan retry error non-retryable;
8. jangan layer retry berlebihan: HTTP client retry + SDK retry + app retry + queue retry.

Contoh konfigurasi sederhana:

```java
SqsClient sqs = SqsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .apiCallAttemptTimeout(Duration.ofSeconds(2))
        .apiCallTimeout(Duration.ofSeconds(6))
        .build())
    .build();
```

Sebelum custom retry, pahami default SDK behavior. Jangan membuat retry strategy sendiri kecuali ada alasan kuat.

---

## 18. Idempotency untuk write API

Credential dan SDK bukan hanya soal akses. Mereka menentukan bagaimana aplikasi berperilaku saat network error.

Contoh:

```text
Aplikasi mengirim CreateOrderCommand ke service internal.
Service menulis item ke DynamoDB.
Response timeout sebelum diterima aplikasi.
Aplikasi retry.
```

Pertanyaan:

> Apakah order dibuat dua kali?

AWS service tertentu menyediakan idempotency token/client token. Untuk service yang tidak otomatis idempotent, desain aplikasi harus menyediakan idempotency key sendiri.

Pattern:

```text
idempotency_key = business_operation_id
```

Contoh:

- `caseId + transitionId`;
- `paymentIntentId`;
- `documentUploadId`;
- `workflowExecutionId`;
- `externalRequestId`.

Untuk DynamoDB:

- gunakan conditional write;
- gunakan optimistic locking;
- gunakan idempotency record;
- jangan retry blind write tanpa condition.

Contoh conditional write:

```java
PutItemRequest request = PutItemRequest.builder()
    .tableName("case-events")
    .item(item)
    .conditionExpression("attribute_not_exists(event_id)")
    .build();
```

Jika retry terjadi, duplicate write ditolak secara deterministik.

---

## 19. Error taxonomy untuk aplikasi Java

Saat AWS call gagal, jangan hanya log `Exception`.

Pisahkan error:

| Kategori | Contoh | Strategi |
|---|---|---|
| Credential resolution error | provider chain gagal | fail fast, fix runtime config |
| Authentication error | signature invalid, expired token | cek clock, credential, token refresh |
| Authorization error | AccessDenied | cek IAM/resource/SCP/session policy |
| Not found | resource tidak ada / region salah | validate config/deployment |
| Throttling | rate exceeded | backoff, reduce concurrency, quota review |
| Timeout | network/service slow | tune timeout, fallback, observability |
| 5xx/transient | internal service error | retry with backoff |
| Validation error | bad request | bug/config, jangan retry |
| Conflict | conditional check failed | business/idempotency handling |

Contoh handling konseptual:

```java
try {
    dynamo.putItem(request);
} catch (ConditionalCheckFailedException e) {
    // duplicate/idempotency conflict, handle as known business outcome
} catch (ProvisionedThroughputExceededException e) {
    // throttling, maybe retry was exhausted; surface controlled degradation
} catch (AccessDeniedException e) {
    // deployment/security misconfiguration; alert, do not hide
} catch (SdkClientException e) {
    // client-side problem: credential, network, marshalling, timeout
} catch (DynamoDbException e) {
    // service-side modeled exception
}
```

Prinsip:

> Tidak semua AWS exception adalah infrastructure failure. Beberapa adalah business conflict, beberapa security misconfiguration, beberapa client bug.

---

## 20. Observability untuk credential dan SDK behavior

Aplikasi produksi harus bisa menjawab:

1. AWS account apa yang sedang dipakai?
2. role/session apa yang menjadi caller identity?
3. region apa yang dipakai?
4. service apa yang dipanggil?
5. berapa latency AWS call?
6. berapa retry count?
7. error apa yang terjadi?
8. apakah error credential, authz, throttling, timeout, atau validation?
9. apakah failure terjadi di satu AZ/region/runtime tertentu?
10. apakah deployment baru mengubah identity/permission?

Saat startup, boleh log metadata aman:

```text
aws.region=ap-southeast-1
aws.account=123456789012
aws.callerArn=arn:aws:sts::123456789012:assumed-role/orders-service-role/...
```

Jangan log:

- access key;
- secret access key;
- session token;
- full signed URL jika sensitif;
- authorization header;
- secret value dari Secrets Manager;
- presigned URL ke data sensitif.

Contoh startup identity check:

```java
public final class AwsIdentityVerifier {
    private final StsClient sts;
    private final String expectedAccount;

    public AwsIdentityVerifier(StsClient sts, String expectedAccount) {
        this.sts = sts;
        this.expectedAccount = expectedAccount;
    }

    public void verify() {
        GetCallerIdentityResponse identity = sts.getCallerIdentity();
        if (!expectedAccount.equals(identity.account())) {
            throw new IllegalStateException(
                "Unexpected AWS account. expected=" + expectedAccount +
                ", actual=" + identity.account() +
                ", arn=" + identity.arn()
            );
        }
    }
}
```

Gunakan dengan hati-hati: jangan membuat dependency startup terlalu rapuh jika STS outage kecil akan menjatuhkan semua service. Untuk workload kritis, desain mode fail-fast vs degraded harus eksplisit.

---

## 21. Local development strategy untuk tim Java

Strategi yang rapi:

```text
Developer laptop
  -> AWS SSO login
  -> dev-readwrite role
  -> local app profile
  -> dev AWS account only
```

Contoh `.envrc` / shell:

```bash
export AWS_PROFILE=company-dev-engineer
export AWS_REGION=ap-southeast-1
export APP_EXPECTED_AWS_ACCOUNT=111111111111
```

Startup app:

1. baca `AWS_REGION`;
2. buat STS client;
3. panggil `GetCallerIdentity`;
4. validasi account;
5. log ARN;
6. fail fast jika bukan account yang diizinkan.

Untuk integration test:

- gunakan dev account;
- gunakan resource prefix unik;
- gunakan TTL/cleanup;
- jangan memakai production resource;
- jangan memberi admin permission ke test;
- jangan parallel test tanpa isolation.

---

## 22. Production runtime strategy

Untuk produksi, desain per runtime:

### ECS service

```text
orders-service-prod-task-role
  allowed:
    dynamodb:GetItem/PutItem/UpdateItem on orders table
    sqs:SendMessage on orders-events queue
    secretsmanager:GetSecretValue on exact secret ARN
  denied:
    wildcard account-wide admin action
```

### Lambda function

```text
case-transition-handler-prod-role
  allowed:
    dynamodb:UpdateItem on cases table with condition
    events:PutEvents to case-domain event bus
    kms:Decrypt for specific key
```

### Batch job

```text
monthly-reconciliation-prod-job-role
  allowed:
    s3:GetObject from input prefix
    s3:PutObject to output prefix
    dynamodb:BatchWriteItem on reconciliation table
```

Prinsip:

- role name mencerminkan workload dan environment;
- permission scoped ke resource spesifik;
- gunakan condition jika masuk akal;
- jangan satu role untuk banyak service;
- gunakan separate deploy role dan runtime role;
- runtime role tidak boleh bisa mengubah infrastructure kecuali memang workload provisioning system.

---

## 23. Deployment role vs runtime role

Ini pemisahan penting.

### Runtime role

Dipakai aplikasi saat berjalan.

Contoh permission:

- read/write DynamoDB table;
- send SQS message;
- get secret;
- put object ke S3 prefix.

### Deployment role

Dipakai pipeline untuk deploy/update resource.

Contoh permission:

- update ECS service;
- create CloudFormation change set;
- publish Lambda version;
- update API Gateway deployment;
- pass specific runtime role.

Anti-pattern:

```text
Runtime role aplikasi diberi permission cloudformation:* karena aplikasi butuh deploy dirinya sendiri.
```

Masalah:

- jika aplikasi compromised, attacker bisa mengubah infrastructure;
- permission runtime terlalu luas;
- audit kabur;
- blast radius besar.

`iam:PassRole` harus sangat hati-hati.

Deployment role mungkin perlu `iam:PassRole`, tetapi hanya untuk role tertentu:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::123456789012:role/orders-service-prod-task-role",
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "ecs-tasks.amazonaws.com"
    }
  }
}
```

---

## 24. Secrets Manager bukan tempat menyimpan AWS access key aplikasi

Kesalahan umum:

```text
Aplikasi ECS mengambil AWS_ACCESS_KEY_ID dari Secrets Manager,
lalu memakai access key itu untuk akses S3.
```

Ini biasanya desain yang salah.

Jika aplikasi berjalan di ECS, gunakan task role.
Jika di Lambda, gunakan execution role.
Jika di EC2, gunakan instance profile.
Jika di CI/CD, gunakan federation/assume role.

Secrets Manager cocok untuk:

- database password;
- external API token;
- signing key aplikasi;
- credential pihak ketiga;
- secret yang tidak bisa diganti dengan IAM role.

Bukan untuk:

- menyimpan AWS access key long-term agar aplikasi bisa akses AWS.

---

## 25. Credential boundary untuk regulated workload

Untuk workload regulated, desain credential harus bisa dipertanggungjawabkan.

Pertanyaan audit:

1. Workload mana yang bisa membaca data sensitif?
2. Identity apa yang dipakai workload itu?
3. Siapa yang bisa mengubah role tersebut?
4. Siapa yang bisa pass role tersebut?
5. Apakah credential temporary?
6. Berapa session duration?
7. Apakah access tercatat di CloudTrail?
8. Apakah ada break-glass role?
9. Apakah production access butuh approval?
10. Apakah developer laptop bisa langsung mengakses production data?

Desain defensible:

```text
Human engineer
  -> IAM Identity Center
  -> read-only/support role with approval
  -> no long-term key

CI/CD
  -> OIDC
  -> deploy-prod role after approval
  -> can pass only known runtime roles

Runtime workload
  -> task/execution/lambda role
  -> least privilege resource access
  -> logs to centralized account

Security account
  -> audit roles
  -> CloudTrail organization trail
  -> Config/Security Hub
```

---

## 26. Failure mode catalog

### 26.1 Credential tidak ditemukan

Gejala:

```text
Unable to load credentials from any of the providers in the chain
```

Kemungkinan:

- local profile belum login;
- `AWS_PROFILE` salah;
- ECS task role tidak dikonfigurasi;
- EC2 instance profile tidak ada;
- IMDS disabled;
- environment variable credential tidak lengkap;
- container tidak punya akses ke credential endpoint.

Tindakan:

- cek runtime identity config;
- jalankan `aws sts get-caller-identity` dengan profile sama;
- log provider/environment non-secret;
- validasi deployment task role/execution role;
- cek metadata service.

---

### 26.2 AccessDenied

Gejala:

```text
AccessDeniedException
User/role is not authorized to perform action X on resource Y
```

Kemungkinan:

- identity benar, permission kurang;
- resource policy belum allow;
- SCP deny;
- permissions boundary membatasi;
- KMS key policy tidak allow;
- VPC endpoint policy deny;
- condition key tidak cocok;
- role yang dipakai bukan role yang dikira.

Tindakan:

1. panggil `GetCallerIdentity`;
2. cek exact action dan resource ARN;
3. cek identity policy;
4. cek resource policy;
5. cek SCP/boundary/session policy;
6. cek KMS key policy jika ada encryption;
7. cek CloudTrail event.

---

### 26.3 ExpiredToken

Kemungkinan:

- temporary credential disimpan manual;
- provider tidak auto-refresh;
- long-running process memakai session pendek;
- clock skew;
- STS assume role gagal refresh karena permission/network.

Tindakan:

- gunakan credentials provider bawaan;
- jangan cache raw credential manual;
- cek system time;
- observasi refresh failure;
- sesuaikan session duration.

---

### 26.4 Wrong account

Gejala:

- resource not found padahal ada;
- data masuk ke account salah;
- deployment menimpa environment salah;
- CloudTrail menunjukkan principal tak terduga.

Penyebab:

- `AWS_PROFILE` salah;
- env var override profile;
- default profile mengarah ke account lain;
- assume role target ARN salah;
- CI secret lama;
- runtime role shared lintas environment.

Mitigasi:

- expected account validation;
- explicit profile untuk tooling;
- account ID di config;
- deployment guardrail;
- SCP untuk mencegah aksi berbahaya di account tertentu.

---

### 26.5 Region mismatch

Gejala:

- resource not found;
- queue URL invalid;
- secret not found;
- KMS key not found;
- latency tidak wajar.

Mitigasi:

- region explicit;
- resource ARN/URL validated;
- config per environment;
- startup check;
- avoid hidden default region.

---

### 26.6 Retry storm

Gejala:

- downstream throttling makin buruk;
- CPU/thread naik;
- latency tail meningkat;
- queue backlog naik;
- CloudWatch menunjukkan spike API calls.

Mitigasi:

- set timeout;
- use jitter;
- limit concurrency;
- reduce max attempts jika perlu;
- add queue buffering;
- use circuit breaker/bulkhead;
- observe retry metrics.

---

## 27. Design pattern: Java service accessing S3, DynamoDB, and SQS

Misal service:

```text
case-document-service
```

Kebutuhan:

- upload document ke S3;
- simpan metadata ke DynamoDB;
- kirim event ke SQS;
- ambil secret external OCR API;
- berjalan di ECS Fargate;
- environment dev/staging/prod terpisah.

### 27.1 Runtime identity

```text
case-document-service-prod-task-role
```

Permission:

```text
s3:PutObject
s3:GetObject
  on arn:aws:s3:::prod-case-documents/cases/*

dynamodb:PutItem
 dynamodb:GetItem
 dynamodb:UpdateItem
  on arn:aws:dynamodb:ap-southeast-1:123456789012:table/prod-case-document-metadata

sqs:SendMessage
  on arn:aws:sqs:ap-southeast-1:123456789012:prod-case-document-events

secretsmanager:GetSecretValue
  on arn:aws:secretsmanager:ap-southeast-1:123456789012:secret/prod/ocr/api-key-*

kms:Decrypt
  on relevant KMS key, if secret/object encryption requires it
```

### 27.2 Java client config

```java
@Configuration
public class AwsClientsConfig {

    @Bean
    Region awsRegion(@Value("${app.aws.region}") String region) {
        return Region.of(region);
    }

    @Bean
    S3Client s3Client(Region region) {
        return S3Client.builder()
            .region(region)
            .overrideConfiguration(defaultOverrideConfiguration())
            .build();
    }

    @Bean
    DynamoDbClient dynamoDbClient(Region region) {
        return DynamoDbClient.builder()
            .region(region)
            .overrideConfiguration(defaultOverrideConfiguration())
            .build();
    }

    @Bean
    SqsClient sqsClient(Region region) {
        return SqsClient.builder()
            .region(region)
            .overrideConfiguration(defaultOverrideConfiguration())
            .build();
    }

    private ClientOverrideConfiguration defaultOverrideConfiguration() {
        return ClientOverrideConfiguration.builder()
            .apiCallAttemptTimeout(Duration.ofSeconds(2))
            .apiCallTimeout(Duration.ofSeconds(6))
            .build();
    }
}
```

### 27.3 Startup verification

```java
@Component
public class AwsStartupVerifier implements ApplicationRunner {
    private final StsClient sts;
    private final String expectedAccount;

    public AwsStartupVerifier(
            Region region,
            @Value("${app.aws.expected-account-id}") String expectedAccount) {
        this.sts = StsClient.builder()
            .region(region)
            .build();
        this.expectedAccount = expectedAccount;
    }

    @Override
    public void run(ApplicationArguments args) {
        GetCallerIdentityResponse identity = sts.getCallerIdentity();
        if (!expectedAccount.equals(identity.account())) {
            throw new IllegalStateException("Unexpected AWS account: " + identity.account());
        }
        // log account and ARN, never credentials
    }
}
```

### 27.4 Idempotency

Untuk upload document:

```text
documentId = deterministic UUID / external upload ID
S3 key = cases/{caseId}/documents/{documentId}/original
DynamoDB item key = documentId
ConditionExpression = attribute_not_exists(documentId)
```

Jika request retry, tidak membuat metadata duplicate.

---

## 28. Checklist desain credential aplikasi Java

Gunakan checklist ini saat review desain.

### Identity

- [ ] Workload memakai role, bukan IAM user.
- [ ] Role terpisah per service/environment.
- [ ] Runtime role dan deployment role dipisah.
- [ ] Role name meaningful.
- [ ] Trust policy minimal.
- [ ] `iam:PassRole` dibatasi.

### Credential

- [ ] Tidak ada access key di source code.
- [ ] Tidak ada access key di image/container artifact.
- [ ] Tidak ada access key AWS di Secrets Manager untuk runtime AWS-native.
- [ ] Temporary credential dipakai jika cross-account/session.
- [ ] Provider bisa refresh credential.
- [ ] Local development memakai SSO/named profile.

### SDK client

- [ ] Client di-reuse.
- [ ] Region eksplisit.
- [ ] Timeout dikonfigurasi.
- [ ] Retry behavior dipahami.
- [ ] Async/sync choice sesuai runtime.
- [ ] Error handling membedakan AccessDenied, throttling, timeout, validation, conflict.

### Observability

- [ ] Startup bisa menampilkan account/ARN aman.
- [ ] AWS call latency terukur.
- [ ] Retry/error count terukur.
- [ ] AccessDenied menjadi alert konfigurasi/security.
- [ ] Credential secret tidak pernah dilog.

### Governance

- [ ] Production access tidak bergantung pada laptop credential.
- [ ] CI/CD memakai federation/assume role.
- [ ] CloudTrail bisa mengaitkan aksi ke workload/session.
- [ ] Cross-account access terdokumentasi.
- [ ] Break-glass role terkontrol.

---

## 29. Mental model akhir

Setelah bagian ini, cara berpikir yang harus terbentuk:

```text
Java application
  does not own secret AWS keys.

Java application
  runs inside a runtime.

Runtime
  has identity.

Identity
  receives temporary credentials.

SDK
  discovers credentials through provider chain.

SDK
  signs every AWS request.

AWS
  authenticates the signature.

AWS
  evaluates policies.

Service
  executes or denies the action.
```

Dan untuk debugging:

```text
1. Who am I?              -> sts:GetCallerIdentity
2. Where am I?            -> region/account/environment
3. What am I doing?       -> action/resource
4. Why denied?            -> identity/resource/SCP/boundary/session/KMS/endpoint policy
5. Why slow?              -> timeout/retry/network/downstream throttling
6. Why duplicate?         -> retry without idempotency
7. Why wrong environment? -> profile/region/account mismatch
```

---

## 30. Kesalahan yang sering membedakan engineer biasa dan engineer kuat

Engineer biasa sering berpikir:

```text
Aplikasi butuh akses S3, jadi kasih access key.
```

Engineer kuat berpikir:

```text
Workload ini berjalan di runtime apa?
Identity runtime apa yang paling kecil blast radius-nya?
Permission resource mana yang benar-benar dibutuhkan?
Apakah access ini cross-account?
Apakah credential temporary dan auto-refresh?
Bagaimana CloudTrail akan menunjukkan aksi ini?
Bagaimana aplikasi fail jika credential hilang, expired, denied, atau throttled?
Apakah timeout dan retry sesuai user journey?
```

Itulah perbedaan antara “bisa connect ke AWS” dan “bisa mendesain workload AWS yang aman, operasional, dan defensible”.

---

## 31. Latihan

### Latihan 1 — Debug credential chain

Jalankan aplikasi Java lokal dengan tiga skenario:

1. tanpa `AWS_PROFILE`;
2. dengan profile dev;
3. dengan environment variable access key yang sengaja salah.

Amati error dan catat provider mana yang dipakai.

Tujuan: memahami bahwa credential resolution terjadi sebelum authorization.

---

### Latihan 2 — Validasi caller identity

Buat class kecil yang:

1. membuat `StsClient`;
2. memanggil `GetCallerIdentity`;
3. mencetak account dan ARN;
4. fail jika account bukan expected account.

Tujuan: mencegah wrong-account accident.

---

### Latihan 3 — Role confusion di ECS

Desain task definition dengan:

- execution role;
- task role.

Jelaskan permission mana yang masuk execution role dan mana yang masuk task role.

Tujuan: menghindari bug paling umum di ECS credential design.

---

### Latihan 4 — Timeout budget

Ambil satu API endpoint aplikasi Anda. Tentukan:

- total user request budget;
- timeout ke database;
- timeout ke S3/SQS/DynamoDB;
- retry max attempt;
- fallback behavior.

Tujuan: memastikan SDK retry tidak menghancurkan latency SLO.

---

### Latihan 5 — Cross-account decision

Untuk skenario service account A membaca bucket account B, bandingkan:

1. bucket policy langsung;
2. assume role ke account B.

Tentukan mana yang lebih tepat untuk:

- audit;
- simplicity;
- multi-tenant isolation;
- operational burden.

---

## 32. Ringkasan

Part ini membahas bagaimana aplikasi Java berinteraksi dengan AWS dari sisi credential dan runtime identity.

Poin terpenting:

1. Jangan hardcode access key.
2. Gunakan role dan temporary credentials.
3. Pahami default credentials provider chain.
4. Validasi account dan region untuk workload kritis.
5. Pisahkan runtime role dan deployment role.
6. Di ECS, bedakan task role dan execution role.
7. Di Lambda, gunakan execution role dan reuse client.
8. Untuk cross-account, pilih antara resource policy dan assume role dengan sadar.
9. Credential refresh harus dikelola provider, bukan cache manual.
10. Timeout dan retry adalah bagian dari desain reliability.
11. Error AWS harus diklasifikasikan, bukan ditangkap generik.
12. Observability harus bisa menjawab identity, region, latency, retry, dan error class.

---

## 33. Referensi resmi untuk pendalaman

- AWS SDK for Java 2.x Developer Guide — credentials provider chain.
- AWS SDK for Java 2.x Developer Guide — credentials providers.
- AWS SDK for Java 2.x Developer Guide — best practices.
- AWS SDK for Java 2.x Developer Guide — timeout configuration.
- AWS SDK for Java 2.x Developer Guide — retry behavior.
- AWS STS examples for SDK Java 2.x.
- AWS IAM User Guide — IAM roles, temporary credentials, and policy evaluation.

---

## 34. Status seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-005.md
```

Judul:

```text
Networking in AWS: VPC as Programmable Network Boundary
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — IAM Deep Model: Identity, Trust, Permission, Session, dan Authorization Evaluation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-005.md">Part 005 — Networking in AWS: VPC as Programmable Network Boundary ➡️</a>
</div>
