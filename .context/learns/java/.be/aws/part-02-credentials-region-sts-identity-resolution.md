# Part 2 — Credentials, Region, STS, and Identity Resolution

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-02-credentials-region-sts-identity-resolution.md`  
Target Java: 8–25  
Primary SDK: AWS SDK for Java 2.x

---

## 1. Tujuan Bagian Ini

Bagian ini membahas salah satu fondasi paling penting dalam integrasi Java + AWS: **bagaimana aplikasi memperoleh identitas AWS, memilih region, melakukan role assumption, dan gagal dengan cara yang aman ketika credential atau permission salah**.

Di banyak sistem enterprise, kegagalan AWS integration jarang terjadi karena developer tidak tahu memanggil API `S3Client`, `SqsClient`, atau `SecretsManagerClient`. Kegagalan yang lebih sering terjadi adalah:

- aplikasi memakai credential yang salah;
- service berjalan di region yang salah;
- role Lambda/EKS/ECS/EC2 tidak punya permission;
- cross-account role assumption gagal;
- local development berbeda dari production;
- credential expired;
- STS token tidak refresh;
- IAM policy terlalu longgar;
- error `AccessDenied` dibaca sebagai bug service;
- environment variable lokal bocor ke runtime production;
- aplikasi membuat AWS client dengan credential statis hard-coded;
- konfigurasi region tersembunyi di profile lokal developer;
- role yang dipakai benar, tetapi resource policy menolak akses;
- permission ada di identity policy, tetapi KMS key policy tidak mengizinkan decrypt;
- aplikasi sukses di DEV tetapi gagal di UAT/PROD karena account boundary berbeda.

Karena itu, bagian ini tidak sekadar menjelaskan “cara set credential”. Fokus utamanya adalah membangun mental model identity resolution yang bisa dipakai untuk debugging, architecture review, security review, dan production incident response.

Rujukan utama bagian ini adalah dokumentasi resmi AWS SDK for Java 2.x tentang default credentials provider chain, region provider chain, credentials provider, dan STS AssumeRole. AWS SDK for Java 2.x memakai provider chain untuk mencari credential dan region secara otomatis, dan urutan pencarian tersebut memengaruhi perilaku aplikasi di local machine, CI/CD, container, EC2, EKS, ECS, dan Lambda. Referensi resmi AWS menyatakan bahwa `DefaultCredentialsProvider` mencari credential dari beberapa lokasi berurutan seperti Java system properties, environment variables, web identity token, shared config/credentials file, ECS container credentials, dan EC2 instance profile; sedangkan region resolution dapat berasal dari explicit builder setting, JVM system property, environment variable, shared config, atau EC2 metadata. [AWS credentials chain](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html), [AWS credentials providers](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials.html), [AWS region selection](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/region-selection.html), [DefaultAwsRegionProviderChain Javadoc](https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/regions/providers/DefaultAwsRegionProviderChain.html), [STS AssumeRole API](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)

---

## 2. Core Mental Model: AWS API Call = Signed Remote Operation by an Identity in a Region

Setiap AWS SDK call dari Java dapat dipahami sebagai operasi berikut:

```text
Java code
  -> SDK client
  -> resolve region
  -> resolve credentials
  -> sign HTTP request with SigV4/SigV4a where applicable
  -> send request to AWS service endpoint
  -> service authorizes principal against IAM/resource/KMS/org policies
  -> service executes or rejects operation
  -> SDK maps response/error to Java object/exception
```

Dari sudut pandang production engineering, setiap AWS call membawa minimal lima dimensi:

```text
WHO       = principal/identity apa yang melakukan call?
WHERE     = region/endpoint mana yang dituju?
WHAT      = action AWS apa yang diminta?
ON WHAT   = resource ARN mana yang disentuh?
UNDER     = policy/condition/context apa yang berlaku?
```

Contoh:

```text
WHO     = arn:aws:sts::111122223333:assumed-role/order-service-prod-role/pod-abc
WHERE   = ap-southeast-1
WHAT    = sqs:SendMessage
ON WHAT = arn:aws:sqs:ap-southeast-1:111122223333:order-events-prod
UNDER   = IAM role policy + SQS queue policy + SCP + VPC endpoint policy + KMS key policy
```

Kalau call gagal, jangan langsung berpikir “SDK error”. Pecah menjadi pertanyaan:

1. Apakah credential berhasil ditemukan?
2. Apakah credential belum expired?
3. Apakah principal yang ditemukan memang principal yang diharapkan?
4. Apakah region yang dipakai benar?
5. Apakah endpoint yang dituju benar?
6. Apakah identity policy mengizinkan action?
7. Apakah resource policy juga mengizinkan?
8. Apakah KMS key policy mengizinkan?
9. Apakah ada SCP/permission boundary/session policy yang membatasi?
10. Apakah service punya behavior khusus seperti S3 bucket policy, SQS queue policy, SNS topic policy, atau Lambda resource policy?

Inilah mental model utama bagian ini: **AWS SDK call bukan hanya method invocation; itu adalah remote authorized operation yang dipengaruhi identity, region, endpoint, policy, token lifecycle, dan runtime environment**.

---

## 3. Vocabulary: Istilah yang Harus Presisi

Sebelum masuk detail, kita perlu menyamakan istilah.

### 3.1 Credential

Credential adalah material yang dipakai SDK untuk menandatangani request AWS. Umumnya terdiri dari:

```text
access key id
secret access key
session token, jika temporary credential
expiration, jika temporary credential
```

Credential bukan permission. Credential hanya membuktikan “siapa” yang memanggil. Permission ditentukan oleh policy yang melekat pada identity/resource.

### 3.2 Principal

Principal adalah entity yang melakukan request AWS. Bisa berupa:

- IAM user;
- IAM role;
- federated user;
- assumed role session;
- AWS service principal;
- root account principal.

Dalam production application, principal yang sehat biasanya adalah **IAM role**, bukan IAM user.

### 3.3 IAM Role

IAM role adalah identity yang dapat diasumsikan oleh trusted principal. Role memiliki:

- trust policy: siapa yang boleh assume role;
- permission policy: apa yang boleh dilakukan setelah role diasumsikan;
- optional permission boundary;
- optional session policy saat assume role.

### 3.4 STS

AWS Security Token Service menghasilkan temporary credential. Operasi penting:

- `AssumeRole`;
- `AssumeRoleWithWebIdentity`;
- `GetCallerIdentity`;
- `GetSessionToken`;
- `GetFederationToken`.

Untuk Java application production, STS sering muncul dalam cross-account access, EKS IRSA, CI/CD deployment, local developer role assumption, dan multi-account architecture.

### 3.5 Region

Region adalah lokasi geografis/logical tempat service endpoint dan resource berada. Banyak resource AWS bersifat regional, misalnya SQS queue, SNS topic, Lambda function, Secrets Manager secret, SSM parameter, DynamoDB table. Ada juga service yang global atau punya special endpoint behavior, seperti IAM, STS, Route 53, dan CloudFront.

### 3.6 Endpoint

Endpoint adalah URL target API service. Normalnya SDK menentukan endpoint dari service + region. Tetapi endpoint bisa di-override untuk:

- LocalStack;
- VPC endpoint/private endpoint scenario;
- AWS partition tertentu;
- testing;
- custom endpoint service;
- preview endpoint.

### 3.7 Partition

AWS punya partition seperti:

```text
aws          = commercial regions
aws-cn       = China regions
aws-us-gov   = GovCloud regions
```

ARN, endpoint, dan signing behavior dapat berbeda antar partition.

### 3.8 Provider

Provider adalah komponen SDK yang menyediakan nilai tertentu ketika client dibuat atau request dieksekusi. Ada:

- credentials provider;
- region provider;
- endpoint provider;
- HTTP client provider;
- profile provider;
- STS credentials provider.

---

## 4. Why Identity Resolution Is an Engineering Boundary

Banyak engineer memperlakukan credential sebagai konfigurasi kecil:

```text
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

Pendekatan seperti ini mungkin cukup untuk eksperimen, tetapi buruk untuk production. Dalam sistem serius, identity resolution adalah boundary arsitektural karena menentukan:

- service mana yang boleh mengakses resource mana;
- apakah blast radius kecil atau besar;
- apakah incident bisa diaudit;
- apakah secret perlu disimpan atau tidak;
- apakah deployment bisa dipromosikan antar environment;
- apakah local development aman;
- apakah cross-account access terkendali;
- apakah sistem bisa rotate credential tanpa downtime;
- apakah compliance evidence bisa disediakan.

Identity resolution harus didesain, bukan dibiarkan terjadi secara implisit.

---

## 5. The Five-Layer Identity Model

Untuk memahami semua runtime Java di AWS, gunakan model lima layer berikut:

```text
+---------------------------------------------------------------+
| 5. Authorization Layer                                        |
|    IAM policy, resource policy, KMS policy, SCP, conditions    |
+---------------------------------------------------------------+
| 4. Session Layer                                              |
|    assumed role session, token expiry, source identity, tags   |
+---------------------------------------------------------------+
| 3. Credential Provider Layer                                  |
|    env, profile, web identity, ECS, EC2, custom provider       |
+---------------------------------------------------------------+
| 2. Runtime Identity Source                                    |
|    Lambda role, EC2 instance profile, ECS task role, IRSA      |
+---------------------------------------------------------------+
| 1. Application Client Layer                                   |
|    S3Client, SqsClient, SecretsManagerClient, StsClient        |
+---------------------------------------------------------------+
```

Layer ini penting karena masalah bisa terjadi di layer berbeda.

Contoh:

```text
Symptom:
  S3 getObject AccessDenied

Possible causes:
  Layer 1: S3Client dibuat dengan credential provider yang salah
  Layer 2: Pod EKS tidak memakai service account yang benar
  Layer 3: Environment variable lokal mengalahkan IRSA credential
  Layer 4: Assumed role session policy membatasi resource
  Layer 5: Bucket policy/KMS key policy/SCP menolak akses
```

Kalau debugging hanya melihat Java exception, kita akan kehilangan struktur masalah.

---

## 6. AWS SDK for Java 2.x Credential Resolution

### 6.1 DefaultCredentialsProvider

Dalam AWS SDK for Java 2.x, jika kita membuat client tanpa explicit credentials provider:

```java
S3Client s3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();
```

SDK akan memakai default credentials provider chain.

Secara konseptual:

```text
S3Client.builder().build()
  -> DefaultCredentialsProvider
  -> cari credential dari beberapa sumber berurutan
  -> credential pertama yang valid dipakai
```

Menurut dokumentasi AWS SDK for Java 2.x, default credentials provider chain mencari credential dari urutan seperti Java system properties, environment variables, web identity token, shared credentials/config profile, ECS container credentials, lalu EC2 instance profile. Urutan detail dapat berubah mengikuti versi SDK, jadi untuk keputusan produksi selalu cek dokumentasi versi SDK yang dipakai. [AWS credentials chain](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html)

### 6.2 Kenapa Default Chain Berguna

Default chain memungkinkan kode yang sama berjalan di banyak lingkungan:

```text
Local laptop    -> ~/.aws/credentials atau SSO/profile
CI/CD           -> OIDC/AssumeRole/environment credential sementara
Lambda          -> execution role
ECS             -> task role
EKS             -> web identity token/IRSA
EC2             -> instance profile
```

Kodenya tetap:

```java
SqsClient sqs = SqsClient.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();
```

Credential tidak perlu hard-coded.

### 6.3 Kenapa Default Chain Bisa Berbahaya

Default chain juga bisa menjadi sumber bug karena “yang pertama ditemukan” belum tentu “yang benar secara arsitektur”.

Contoh masalah:

```text
Developer menjalankan app lokal.
Environment variable AWS_ACCESS_KEY_ID masih berisi credential account lama.
Profile ~/.aws/config sudah benar.
Tetapi default chain menemukan environment variable lebih dulu.
App mengakses account salah.
```

Atau:

```text
Pod EKS seharusnya memakai IRSA.
Tetapi image/container membawa environment variable AWS_ACCESS_KEY_ID.
SDK memakai env credential, bukan web identity token.
Akibatnya pod memakai identity tidak sesuai desain.
```

Karena itu, production-grade Java app harus punya startup diagnostics yang bisa menjawab:

```text
Which AWS principal am I running as?
Which region am I using?
Which endpoint am I calling?
Which profile/provider was expected?
```

Jangan log secret. Tetapi boleh log identity hasil `GetCallerIdentity` di environment non-sensitive atau sebagai startup health evidence yang aman.

---

## 7. Credential Provider Chain: Mental Model Per Source

### 7.1 Java System Properties

Contoh:

```bash
java \
  -Daws.accessKeyId=AKIA... \
  -Daws.secretAccessKey=... \
  -Daws.sessionToken=... \
  -jar app.jar
```

Kelebihan:

- mudah untuk eksperimen;
- bisa diinject saat runtime JVM.

Kekurangan:

- raw credential bisa muncul di process arguments;
- raw credential bisa terekam di script/history;
- tidak ideal untuk production;
- mudah mengalahkan provider lain.

Rekomendasi:

```text
Use only for controlled local/testing scenario.
Avoid for production workload.
```

### 7.2 Environment Variables

Contoh:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
export AWS_REGION=ap-southeast-1
```

Kelebihan:

- portable;
- didukung banyak tooling;
- umum di CI/CD;
- cocok untuk temporary credential yang dibuat oleh pipeline.

Kekurangan:

- raw credential dapat bocor ke env dump;
- sering tertinggal di laptop developer;
- dapat mengalahkan profile/role provider;
- raw long-lived key berisiko tinggi.

Rekomendasi:

```text
CI/CD boleh memakai environment credential sementara.
Production runtime sebaiknya memakai role-native identity source, bukan static env key.
```

### 7.3 Shared Credentials and Config File

Biasanya:

```text
~/.aws/credentials
~/.aws/config
```

Contoh:

```ini
# ~/.aws/config
[profile dev]
region = ap-southeast-1

[profile prod-readonly]
role_arn = arn:aws:iam::111122223333:role/prod-readonly
source_profile = base
region = ap-southeast-1
```

Kelebihan:

- baik untuk local development;
- mendukung profile;
- bisa dikombinasikan dengan SSO/role assumption;
- tidak perlu hard-code di aplikasi.

Kekurangan:

- tidak cocok sebagai satu-satunya mekanisme production;
- sulit dikontrol dalam container;
- profile name bisa berbeda antar developer;
- local state bisa menyebabkan “works on my machine”.

Rekomendasi:

```text
Gunakan untuk local development.
Jangan bergantung pada shared profile di runtime production container/Lambda.
```

### 7.4 Web Identity Token

Web identity token digunakan dalam pola seperti EKS IRSA atau CI/CD OIDC. Provider membaca token file dan role ARN, lalu menggunakan STS untuk `AssumeRoleWithWebIdentity`.

Konseptual:

```text
Pod/runner memiliki OIDC token
  -> SDK membaca token file
  -> SDK memanggil STS AssumeRoleWithWebIdentity
  -> STS mengembalikan temporary credential
  -> SDK memakai temporary credential untuk call service
```

Kelebihan:

- tidak perlu long-lived access key;
- cocok untuk Kubernetes service account;
- cocok untuk CI/CD federation;
- identity bisa scoped per workload.

Kekurangan:

- butuh trust policy yang benar;
- butuh STS dependency/provider support;
- error dapat muncul sebagai credential resolution failure;
- token file/role ARN env harus benar.

Rekomendasi:

```text
Untuk EKS, prefer IRSA atau mekanisme identity modern yang setara.
Untuk CI/CD, prefer OIDC federation daripada static access key.
```

### 7.5 ECS Container Credentials

Pada ECS, task role credential disediakan melalui container credentials endpoint. SDK mengambil temporary credential dari endpoint tersebut.

Konseptual:

```text
ECS task role
  -> container credentials endpoint
  -> SDK retrieves temporary credentials
  -> app signs AWS requests
```

Kelebihan:

- no static keys;
- role scoped per task;
- automatic refresh;
- cocok untuk service container.

Kekurangan:

- network/metadata endpoint dependency;
- task definition harus benar;
- role confusion jika execution role dan task role tertukar.

Catatan penting:

```text
ECS execution role dipakai ECS agent untuk pull image/logging/secrets injection tertentu.
ECS task role dipakai application code untuk call AWS API.
```

Banyak incident terjadi karena engineer memberi permission ke execution role, padahal Java app memakai task role.

### 7.6 EC2 Instance Profile

Pada EC2, credential berasal dari instance metadata service melalui instance profile.

Konseptual:

```text
EC2 instance profile
  -> IMDS
  -> SDK retrieves temporary credentials
  -> app signs AWS requests
```

Kelebihan:

- no static keys;
- automatic rotation;
- mudah untuk VM-based workload.

Kekurangan:

- semua process di instance berpotensi memakai role yang sama;
- blast radius lebih besar dibanding per-pod/per-task role;
- IMDS harus diamankan;
- role terlalu broad sering terjadi.

Rekomendasi:

```text
Gunakan IMDSv2.
Jangan taruh banyak aplikasi dengan permission berbeda di instance role yang sama.
```

### 7.7 Custom Credentials Provider

Kita bisa membuat provider sendiri:

```java
public final class MyCredentialsProvider implements AwsCredentialsProvider {
    @Override
    public AwsCredentials resolveCredentials() {
        // Ambil temporary credential dari source internal yang aman.
        return AwsSessionCredentials.create(accessKeyId, secretAccessKey, sessionToken);
    }
}
```

Gunakan custom provider hanya jika benar-benar perlu, misalnya:

- integrasi dengan internal identity broker;
- migration bridge;
- external process provider pattern;
- specialized secure enclave integration.

Hindari custom provider untuk sekadar membaca secret dari file biasa. Itu biasanya menurunkan security posture.

---

## 8. Region Resolution in AWS SDK for Java 2.x

### 8.1 Explicit Region

Cara paling jelas:

```java
S3Client s3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();
```

Kelebihan:

- deterministik;
- mudah dibaca;
- aman untuk service regional;
- menghindari kejutan dari environment lokal.

Kekurangan:

- kurang fleksibel untuk multi-region;
- kalau hard-coded di library, buruk;
- butuh external config untuk environment berbeda.

Rekomendasi:

```text
Application layer boleh explicit region dari config.
Reusable library jangan hard-code region.
```

### 8.2 Default Region Provider Chain

Jika region tidak explicit, SDK mencari region dari provider chain. Dokumentasi AWS menyatakan region bisa dicari dari explicit builder setting, JVM system property `aws.region`, environment variable `AWS_REGION`, shared config/credentials file, dan EC2 metadata tergantung runtime. [AWS region selection](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/region-selection.html), [DefaultAwsRegionProviderChain Javadoc](https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/regions/providers/DefaultAwsRegionProviderChain.html)

Contoh:

```bash
export AWS_REGION=ap-southeast-1
```

Lalu:

```java
SnsClient sns = SnsClient.builder().build();
```

SDK dapat memakai `AWS_REGION`.

### 8.3 Region Is Not Cosmetic

Region salah dapat menghasilkan beberapa jenis failure:

```text
ResourceNotFoundException
AccessDeniedException
InvalidSignatureException
SignatureDoesNotMatch
Could not connect to endpoint
KMS decrypt failed
Queue does not exist
Secret not found
```

Contoh:

```text
Secret ada di ap-southeast-1.
App berjalan dengan AWS_REGION=us-east-1.
SecretsManagerClient mencari secret di us-east-1.
Error: ResourceNotFoundException.
```

Ini bukan secret hilang. Ini region mismatch.

### 8.4 Regional vs Global Service

Tidak semua service sama:

```text
S3 bucket namespace global, tetapi banyak API tetap regional-aware.
SQS queue regional.
SNS topic regional.
Secrets Manager regional.
SSM Parameter Store regional.
Lambda regional.
DynamoDB table regional.
IAM global.
STS historically global endpoint, tetapi regional STS endpoint sering direkomendasikan untuk latency/resilience/compliance.
CloudFront global.
Route 53 global.
```

Mental model:

```text
Always ask: resource ini regional atau global?
If regional: region must be explicit and environment-controlled.
If global/special: understand SDK endpoint behavior.
```

### 8.5 Multi-Region Design

Jika aplikasi harus multi-region, jangan menyembunyikan region di global static client.

Buruk:

```java
public final class AwsClients {
    public static final S3Client S3 = S3Client.builder()
            .region(Region.AP_SOUTHEAST_1)
            .build();
}
```

Lebih baik:

```java
public interface AwsClientFactory {
    S3Client s3(Region region);
    SqsClient sqs(Region region);
    SecretsManagerClient secretsManager(Region region);
}
```

Atau:

```java
public record AwsTarget(Region region, String accountId, String environment) {}
```

Sehingga region/account/environment menjadi explicit part dari application decision.

---

## 9. STS: Temporary Identity and Role Assumption

### 9.1 Apa Masalah yang Diselesaikan STS?

STS menjawab kebutuhan:

```text
Saya tidak ingin menyimpan credential permanen.
Saya ingin workload A sementara menjadi role B.
Saya ingin user/pipeline/service dari account X mengakses resource account Y.
Saya ingin permission terbatas dalam durasi tertentu.
Saya ingin aktivitas role assumption tercatat.
```

STS menghasilkan temporary credential dengan expiration. AWS SDK standardized credentials biasanya dapat memperbarui credential otomatis jika provider mendukung refresh. [AWS standardized credential providers](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html)

### 9.2 AssumeRole Concept

Flow:

```text
Caller principal
  -> allowed by target role trust policy
  -> calls STS AssumeRole
  -> receives temporary credentials
  -> uses temporary credentials to call AWS services
```

ASCII diagram:

```text
+----------------------+       sts:AssumeRole        +----------------------+
| Caller Role/User     | --------------------------> | Target IAM Role      |
| account A            |                             | account B            |
+----------------------+                             +----------+-----------+
                                                                  |
                                                                  | temporary creds
                                                                  v
                                                        +-------------------+
                                                        | AWS service calls |
                                                        +-------------------+
```

### 9.3 Trust Policy vs Permission Policy

AssumeRole requires two sides:

1. Caller must be allowed to call `sts:AssumeRole` on target role.
2. Target role trust policy must trust caller.

Caller policy example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::222233334444:role/report-reader-prod"
    }
  ]
}
```

Target role trust policy example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:role/report-service-prod"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Setelah role diasumsikan, permission yang berlaku adalah permission target role, dikombinasikan dengan boundary/session/SCP constraints.

### 9.4 Java SDK 2.x AssumeRole Example

Contoh eksplisit:

```java
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.AssumeRoleRequest;
import software.amazon.awssdk.services.sts.model.AssumeRoleResponse;

public final class AssumeRoleExample {

    public static void main(String[] args) {
        Region region = Region.AP_SOUTHEAST_1;

        try (StsClient sts = StsClient.builder()
                .region(region)
                .build()) {

            AssumeRoleResponse response = sts.assumeRole(AssumeRoleRequest.builder()
                    .roleArn("arn:aws:iam::222233334444:role/report-reader-prod")
                    .roleSessionName("report-service-local-test")
                    .build());

            AwsSessionCredentials sessionCredentials = AwsSessionCredentials.create(
                    response.credentials().accessKeyId(),
                    response.credentials().secretAccessKey(),
                    response.credentials().sessionToken()
            );

            try (S3Client s3 = S3Client.builder()
                    .region(region)
                    .credentialsProvider(StaticCredentialsProvider.create(sessionCredentials))
                    .build()) {

                // Use s3 with assumed role credentials.
            }
        }
    }
}
```

Kode ini baik untuk memahami konsep, tetapi untuk production long-running service, lebih baik memakai provider yang mengelola refresh otomatis daripada mengambil temporary credential sekali lalu menyimpannya statis.

### 9.5 StsAssumeRoleCredentialsProvider

Untuk long-running app:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.auth.StsAssumeRoleCredentialsProvider;
import software.amazon.awssdk.services.sts.model.AssumeRoleRequest;

public final class AssumedRoleClientFactory implements AutoCloseable {

    private final StsClient stsClient;
    private final StsAssumeRoleCredentialsProvider credentialsProvider;
    private final S3Client s3Client;

    public AssumedRoleClientFactory() {
        Region region = Region.AP_SOUTHEAST_1;

        this.stsClient = StsClient.builder()
                .region(region)
                .build();

        this.credentialsProvider = StsAssumeRoleCredentialsProvider.builder()
                .stsClient(stsClient)
                .refreshRequest(AssumeRoleRequest.builder()
                        .roleArn("arn:aws:iam::222233334444:role/report-reader-prod")
                        .roleSessionName("report-service-prod")
                        .build())
                .build();

        this.s3Client = S3Client.builder()
                .region(region)
                .credentialsProvider(credentialsProvider)
                .build();
    }

    public S3Client s3() {
        return s3Client;
    }

    @Override
    public void close() {
        s3Client.close();
        credentialsProvider.close();
        stsClient.close();
    }
}
```

Catatan:

- Jangan membuat STS client dan assume role setiap request bisnis.
- Reuse provider/client.
- Perhatikan lifecycle `close()`.
- Pastikan refresh berjalan sebelum expiration.
- Monitor failure saat refresh credential.

### 9.6 GetCallerIdentity

`GetCallerIdentity` adalah tool debugging utama.

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.GetCallerIdentityResponse;

public final class IdentityProbe {
    public static void main(String[] args) {
        try (StsClient sts = StsClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build()) {

            GetCallerIdentityResponse identity = sts.getCallerIdentity();

            System.out.println("account=" + identity.account());
            System.out.println("arn=" + identity.arn());
            System.out.println("userId=" + identity.userId());
        }
    }
}
```

Dalam production, jangan asal print ke stdout jika log policy ketat. Tetapi sebagai startup diagnostic atau operational endpoint internal, identity check sangat berguna.

Output contoh:

```text
account=111122223333
arn=arn:aws:sts::111122223333:assumed-role/order-service-prod/pod-abc
userId=AROAXXXXXXXX:pod-abc
```

Pertanyaan debugging:

```text
Apakah account benar?
Apakah role benar?
Apakah session name sesuai workload?
Apakah ini IAM user, bukan assumed role?
Apakah ini role DEV yang nyasar ke PROD?
```

---

## 10. Role Session Name, Source Identity, Tags, and Auditability

### 10.1 Role Session Name

Saat AssumeRole, kita memberi `roleSessionName`.

Buruk:

```text
session
app
java
local
```

Lebih baik:

```text
order-service-prod-pod-abc123
jenkins-deploy-prod-build-9182
fajar-local-readonly-20260619
case-sync-worker-uat-7f9c
```

Session name muncul dalam assumed-role ARN dan CloudTrail. Session name yang buruk membuat audit sulit.

### 10.2 Source Identity

AWS STS mendukung source identity untuk membantu audit siapa/apa yang mengasumsikan role. Dokumentasi AWS menyebut source identity dapat digunakan di CloudTrail dan dikontrol melalui condition key seperti `sts:SourceIdentity`. [STS AssumeRole API](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)

Use case:

```text
Human developer assumes production readonly role.
SourceIdentity = corporate username.
CloudTrail bisa menunjukkan siapa yang melakukan tindakan melalui assumed role.
```

### 10.3 Session Tags

Session tags dapat membawa metadata saat role assumption, misalnya:

```text
environment=prod
service=order-service
team=platform
purpose=read-only-diagnostics
```

Tags bisa digunakan dalam policy condition dan audit.

### 10.4 Audit Principle

Untuk regulated systems:

```text
Never design role assumption as anonymous technical tunnel.
Design it as auditable identity transition.
```

Artinya:

- session name bermakna;
- source identity jika applicable;
- CloudTrail aktif;
- role trust policy spesifik;
- external ID untuk third-party access;
- permission minimum;
- durasi session sesuai risiko;
- emergency access dibedakan dari normal runtime access.

---

## 11. Cross-Account Access Patterns

### 11.1 Common Pattern

```text
Application account A
  -> assume role in data account B
  -> access S3/SQS/Secrets/DynamoDB in account B
```

Diagram:

```text
+--------------------------+          +--------------------------+
| Account A                |          | Account B                |
| order-service-prod-role  |          | order-data-reader-role   |
|                          |          | S3 bucket/report data    |
+------------+-------------+          +-------------+------------+
             |                                      ^
             | sts:AssumeRole                       |
             +--------------------------------------+
```

### 11.2 Why Cross-Account Role Is Better Than Shared Keys

Shared static keys:

- sulit rotate;
- sulit audit;
- bisa bocor;
- tidak punya session context;
- sering terlalu broad;
- lifecycle tidak jelas.

AssumeRole:

- temporary;
- auditable;
- trust explicit;
- permission scoped;
- bisa dibatasi condition;
- bisa dihentikan dengan mengubah trust policy;
- cocok untuk multi-account governance.

### 11.3 External ID

Untuk third-party/vendor access, external ID membantu mencegah confused deputy problem.

Trust policy dapat mensyaratkan:

```json
"Condition": {
  "StringEquals": {
    "sts:ExternalId": "vendor-specific-random-id"
  }
}
```

Prinsip:

```text
Jika pihak eksternal assume role ke account kita, gunakan external ID.
```

### 11.4 Role Chaining

Role chaining terjadi saat temporary credential hasil AssumeRole digunakan lagi untuk AssumeRole lain.

Masalah:

- durasi session dapat dibatasi;
- audit chain lebih kompleks;
- debugging lebih sulit;
- permission bisa menjadi tidak jelas;
- desain bisa menandakan account boundary kurang rapi.

Rekomendasi:

```text
Avoid role chaining unless there is a strong reason.
Prefer direct trust from intended caller to intended target role.
```

---

## 12. Runtime-Specific Identity Design

### 12.1 Lambda

Lambda function menggunakan execution role.

```text
Lambda function
  -> execution role
  -> SDK default credentials provider
  -> temporary credentials automatically available
```

Java code biasanya cukup:

```java
SecretsManagerClient secrets = SecretsManagerClient.builder()
        .region(Region.of(System.getenv("AWS_REGION")))
        .build();
```

Best practice:

- satu function/kelompok function punya role spesifik;
- jangan pakai access key di env var Lambda;
- permission minimum;
- KMS decrypt permission jika membaca encrypted secret/parameter;
- log caller identity saat deployment validation bila diperlukan;
- region explicit dari env/config;
- jangan assume role kecuali ada cross-account requirement.

Anti-pattern:

```text
Lambda execution role diberi AdministratorAccess karena “biar cepat”.
```

### 12.2 ECS

ECS punya dua role yang sering tertukar:

```text
Execution role = dipakai ECS agent untuk pull image, publish logs, inject secrets.
Task role      = dipakai application code untuk call AWS APIs.
```

Jika Java app `AccessDenied`, cek task role, bukan hanya execution role.

### 12.3 EKS

EKS modern biasanya memakai workload identity berbasis service account, seperti IRSA.

Konseptual:

```text
Kubernetes service account
  -> projected web identity token
  -> AWS SDK WebIdentityTokenFileCredentialsProvider
  -> STS AssumeRoleWithWebIdentity
  -> temporary AWS credentials
```

Pitfall:

- service account annotation salah;
- pod tidak memakai service account yang benar;
- STS dependency/provider issue;
- trust policy OIDC provider salah;
- env var static credential mengalahkan web identity;
- role terlalu broad untuk semua pod.

Production rule:

```text
Permission should be scoped per workload, not per cluster.
```

### 12.4 EC2

EC2 memakai instance profile.

Risiko:

- semua process di host mendapat role yang sama;
- credential bisa diakses oleh process yang tidak seharusnya jika host tidak isolatif;
- role sering menjadi “god role” karena banyak aplikasi berbagi instance.

Rekomendasi:

- IMDSv2;
- least privilege;
- satu workload class per instance role;
- jangan campur trust boundary berbeda dalam instance sama;
- pertimbangkan container/task/pod role jika butuh isolation lebih baik.

### 12.5 Local Developer Machine

Local development harus aman dan reproducible.

Prefer:

```text
aws sso login
AWS_PROFILE=dev-readonly
AWS_REGION=ap-southeast-1
```

Atau profile assume role.

Hindari:

```text
Long-lived IAM user access key dengan permission luas.
Credential copy-paste ke application.yml.
Credential commit ke Git.
Credential statis di test fixture.
```

### 12.6 CI/CD

Modern CI/CD sebaiknya memakai OIDC federation/AssumeRole, bukan static AWS keys.

Flow:

```text
CI provider identity token
  -> AWS role trust policy validates OIDC claims
  -> STS returns temporary deployment credentials
  -> pipeline deploys artifact/infrastructure
```

Keuntungan:

- no stored long-lived key;
- per-branch/per-repo/per-environment control;
- temporary credential;
- auditable session;
- easier revocation.

---

## 13. Permission Is Not Only IAM Identity Policy

Salah satu kesalahan umum: “role sudah punya permission, kenapa AccessDenied?”

AWS authorization bisa melibatkan banyak policy layer:

```text
Identity-based policy
Resource-based policy
KMS key policy
Permission boundary
Session policy
Service control policy / SCP
VPC endpoint policy
ACL / legacy service mechanism
Service-specific condition
```

### 13.1 Example: S3 + KMS

Role punya:

```text
s3:GetObject on bucket
```

Tetapi object dienkripsi SSE-KMS. Maka role juga perlu:

```text
kms:Decrypt on KMS key
```

Dan KMS key policy harus mengizinkan role tersebut.

Jika tidak:

```text
S3 GetObject -> AccessDenied
```

Padahal S3 policy terlihat benar.

### 13.2 Example: SQS Encrypted Queue

Role punya:

```text
sqs:ReceiveMessage
sqs:DeleteMessage
```

Tetapi queue encrypted dengan CMK. Consumer mungkin butuh KMS permission tergantung operasi dan service integration.

### 13.3 Example: Cross-Account S3

Account A role punya identity policy:

```text
s3:GetObject bucket account B
```

Tetapi bucket policy di account B tidak mengizinkan principal account A. Maka akses tetap gagal.

### 13.4 Debugging Principle

Untuk setiap `AccessDenied`:

```text
Do not ask only “does my role allow this?”
Ask “does every applicable policy layer allow this, and does no explicit deny apply?”
```

Explicit deny menang atas allow.

---

## 14. Java Application Design: Centralized AwsIdentityContext

Dalam aplikasi serius, jangan sebar region/credential logic di banyak class.

Buruk:

```java
public class ReportUploader {
    private final S3Client s3 = S3Client.builder()
            .region(Region.AP_SOUTHEAST_1)
            .credentialsProvider(ProfileCredentialsProvider.create("prod"))
            .build();
}
```

Masalah:

- region hard-coded;
- profile hard-coded;
- client dibuat di domain class;
- sulit test;
- sulit rotate;
- sulit multi-region;
- sulit observe;
- sulit close;
- production behavior tersembunyi.

Lebih baik:

```java
public record AwsIdentityConfig(
        Region region,
        Optional<String> assumeRoleArn,
        Optional<String> roleSessionName,
        Optional<String> endpointOverride
) {}
```

Client factory:

```java
import java.net.URI;
import java.util.Optional;

import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;

public final class AwsClientFactory implements AutoCloseable {

    private final Region region;
    private final AwsCredentialsProvider credentialsProvider;
    private final Optional<URI> endpointOverride;

    private final S3Client s3;
    private final SqsClient sqs;

    public AwsClientFactory(Region region, Optional<URI> endpointOverride) {
        this.region = region;
        this.credentialsProvider = DefaultCredentialsProvider.create();
        this.endpointOverride = endpointOverride;

        S3Client.Builder s3Builder = S3Client.builder()
                .region(region)
                .credentialsProvider(credentialsProvider);

        SqsClient.Builder sqsBuilder = SqsClient.builder()
                .region(region)
                .credentialsProvider(credentialsProvider);

        endpointOverride.ifPresent(uri -> {
            s3Builder.endpointOverride(uri);
            sqsBuilder.endpointOverride(uri);
        });

        this.s3 = s3Builder.build();
        this.sqs = sqsBuilder.build();
    }

    public S3Client s3() {
        return s3;
    }

    public SqsClient sqs() {
        return sqs;
    }

    @Override
    public void close() {
        s3.close();
        sqs.close();
    }
}
```

Namun, untuk production, biasanya kita perlu lebih advanced:

- cache client per region/account;
- optional assume role provider;
- explicit HTTP client;
- timeout/retry config;
- observability interceptor;
- startup identity probe;
- endpoint override hanya untuk local/test;
- no profile in production runtime.

---

## 15. Startup Identity Validation

Sistem production-grade sebaiknya melakukan validasi identitas saat startup atau readiness check.

### 15.1 Minimal Validation

```java
public record AwsRuntimeIdentity(
        String account,
        String arn,
        String userId,
        Region region
) {}
```

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.GetCallerIdentityResponse;

public final class AwsRuntimeIdentityProbe {

    private final StsClient sts;
    private final Region region;

    public AwsRuntimeIdentityProbe(StsClient sts, Region region) {
        this.sts = sts;
        this.region = region;
    }

    public AwsRuntimeIdentity probe() {
        GetCallerIdentityResponse response = sts.getCallerIdentity();
        return new AwsRuntimeIdentity(
                response.account(),
                response.arn(),
                response.userId(),
                region
        );
    }
}
```

### 15.2 Expected Identity Guard

Di regulated/high-risk system, kita bisa melakukan guard:

```java
public final class ExpectedAwsIdentityGuard {

    private final String expectedAccountId;
    private final String expectedRoleNameFragment;

    public ExpectedAwsIdentityGuard(String expectedAccountId, String expectedRoleNameFragment) {
        this.expectedAccountId = expectedAccountId;
        this.expectedRoleNameFragment = expectedRoleNameFragment;
    }

    public void validate(AwsRuntimeIdentity identity) {
        if (!identity.account().equals(expectedAccountId)) {
            throw new IllegalStateException("Unexpected AWS account: " + identity.account());
        }
        if (!identity.arn().contains(expectedRoleNameFragment)) {
            throw new IllegalStateException("Unexpected AWS principal: " + identity.arn());
        }
    }
}
```

Tujuan:

```text
Fail fast if app starts with wrong AWS identity.
```

Ini lebih baik daripada aplikasi berjalan beberapa jam lalu menulis data ke account salah.

### 15.3 Logging Safely

Boleh log:

```text
AWS account id
assumed role ARN
region
SDK version
service endpoint mode
```

Jangan log:

```text
access key id, kecuali masked dan memang perlu
secret access key
session token
raw web identity token
full environment dump
credential file content
```

---

## 16. Environment and Configuration Strategy

### 16.1 Recommended Configuration Shape

Untuk Java/Spring/service umum:

```yaml
aws:
  region: ap-southeast-1
  expectedAccountId: "111122223333"
  expectedRoleName: order-service-prod
  endpointOverride: "" # only local/test
  assumeRoleArn: ""    # optional, mostly cross-account
```

Environment variable mapping:

```text
APP_AWS_REGION=ap-southeast-1
APP_AWS_EXPECTED_ACCOUNT_ID=111122223333
APP_AWS_EXPECTED_ROLE_NAME=order-service-prod
APP_AWS_ENDPOINT_OVERRIDE=
APP_AWS_ASSUME_ROLE_ARN=
```

Kenapa tidak hanya `AWS_REGION`?

`AWS_REGION` boleh dipakai oleh SDK, tetapi application-level config lebih eksplisit dan bisa divalidasi sebagai bagian dari domain deployment.

### 16.2 Local Profile Strategy

Untuk local:

```bash
export AWS_PROFILE=dev-poweruser
export APP_AWS_REGION=ap-southeast-1
export APP_AWS_EXPECTED_ACCOUNT_ID=111122223333
```

Untuk production:

```bash
# No AWS_PROFILE dependency.
# Runtime identity comes from Lambda/ECS/EKS/EC2 role.
APP_AWS_REGION=ap-southeast-1
APP_AWS_EXPECTED_ACCOUNT_ID=555566667777
```

### 16.3 Do Not Put Secrets in Config Files

Buruk:

```yaml
aws:
  accessKeyId: AKIA...
  secretAccessKey: abc...
```

Lebih baik:

```text
Use AWS runtime role.
Use local AWS profile/SSO for developer.
Use OIDC temporary credential for CI/CD.
```

---

## 17. Java 8–25 Considerations

### 17.1 Java 8

AWS SDK 2.x mendukung Java 8, tetapi Java 8 punya keterbatasan modern runtime:

- TLS/cert/provider behavior bisa lebih tua tergantung update;
- container ergonomics tidak sebaik Java modern;
- observability dan runtime diagnostics terbatas dibanding Java 17+;
- dependency modern kadang mulai meninggalkan Java 8;
- Lambda runtime support/lifecycle harus dicek jika deploy ke Lambda.

Untuk Java 8 workload yang masih hidup:

```text
Use SDK 2.x version compatible with Java 8.
Pin dependency versions carefully.
Avoid new language syntax in shared libraries.
Test TLS and credential provider behavior in target runtime.
```

### 17.2 Java 11/17

Java 11/17 umum di enterprise.

Keuntungan:

- TLS/runtime lebih modern;
- container awareness lebih baik;
- dependency ecosystem kuat;
- Java 17 sering menjadi baseline LTS modern.

### 17.3 Java 21/25

Java 21 dan 25 membuka ruang desain lebih modern:

- virtual threads untuk blocking integration layer tertentu;
- improved GC/runtime behavior;
- better observability tooling;
- record/sealed/pattern matching untuk config/error modelling;
- stronger baseline untuk new service architecture.

Namun AWS SDK async client tetap punya model Netty/event-loop sendiri. Jangan otomatis mencampur virtual threads dan async SDK tanpa desain jelas.

### 17.4 Code Compatibility Strategy

Jika library harus support Java 8–25:

```text
Main source uses Java 8 syntax.
Optional module/adaptor can target Java 17/21+.
Avoid records/sealed classes in core Java 8 artifact.
Use tests across supported runtimes.
Do not assume Lambda runtime supports every Java version immediately.
```

Jika aplikasi internal modern:

```text
Prefer Java 17/21+ baseline.
Use SDK 2.x.
Use runtime-native role provider.
Use explicit config and startup validation.
```

---

## 18. Common Failure Modes and Diagnosis

### 18.1 Unable to Load Credentials

Symptom:

```text
SdkClientException: Unable to load credentials from any of the providers in the chain
```

Possible causes:

- no env credential;
- no profile;
- wrong `AWS_PROFILE`;
- missing web identity token file;
- container credential endpoint unavailable;
- EC2 metadata disabled/unreachable;
- STS module/provider issue;
- local test not setting credential.

Diagnosis:

```text
1. Where is app running?
2. Which provider is expected?
3. Is AWS_PROFILE set?
4. Are AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY set accidentally?
5. In EKS, is service account annotation correct?
6. In ECS, is task role attached?
7. In EC2, is instance profile attached and IMDS available?
```

### 18.2 AccessDenied

Symptom:

```text
AccessDeniedException
User is not authorized to perform: sqs:SendMessage
```

Diagnosis:

```text
1. Call GetCallerIdentity.
2. Confirm account and role.
3. Confirm action.
4. Confirm resource ARN.
5. Check identity policy.
6. Check resource policy.
7. Check KMS key policy if encrypted.
8. Check SCP/permission boundary/session policy.
9. Check condition keys.
10. Check VPC endpoint policy if using private endpoints.
```

### 18.3 Invalid Signature

Possible causes:

- wrong region;
- wrong endpoint;
- system clock skew;
- credential corrupted;
- signing mismatch;
- using global/regional endpoint incorrectly;
- proxy mutating request.

Diagnosis:

```text
Check region, endpoint override, system time, proxy behavior, and SDK version.
```

### 18.4 Expired Token

Possible causes:

- temporary credential captured once and reused statically;
- custom provider does not refresh;
- long-running process uses old token;
- role chaining session duration too short;
- background refresh failed.

Fix:

```text
Use refresh-capable provider.
Reuse SDK clients/providers properly.
Do not convert temporary credential into static provider for long-running service.
```

### 18.5 Wrong Account

Symptom:

```text
ResourceNotFound, AccessDenied, data appears in wrong environment, queue not found.
```

Diagnosis:

```text
Call GetCallerIdentity.
Compare account id with expected environment.
Check AWS_PROFILE, env variables, role ARN, CI/CD role, pod service account.
```

### 18.6 Wrong Region

Symptom:

```text
Queue does not exist.
Secret not found.
Function not found.
Topic not found.
```

Diagnosis:

```text
Log resolved region.
Check app config vs AWS_REGION vs profile.
Check resource ARN region.
```

---

## 19. Identity Design Patterns

### 19.1 Runtime Role Pattern

Use for:

- Lambda;
- ECS;
- EKS;
- EC2;
- production workloads.

Pattern:

```text
Application code uses DefaultCredentialsProvider.
Runtime platform supplies temporary role credentials.
No static access key exists in application config.
```

Pros:

- secure;
- simple code;
- automatic rotation;
- auditable;
- operationally standard.

### 19.2 Cross-Account AssumeRole Pattern

Use for:

- shared data account;
- centralized audit account;
- deployment account;
- vendor/third-party access;
- multi-tenant isolated accounts.

Pattern:

```text
Base runtime role -> STS AssumeRole -> target account role -> access target resource
```

Requirement:

- caller identity policy allows `sts:AssumeRole`;
- target trust policy trusts caller;
- target role permission allows resource action;
- resource policy/KMS policy allows target role if needed.

### 19.3 Local Profile Pattern

Use for developer machine.

Pattern:

```text
AWS_PROFILE=dev
AWS SSO/profile/role assumption
Application uses default provider chain
Startup identity guard prevents wrong account
```

### 19.4 CI/CD OIDC Pattern

Use for deployment pipeline.

Pattern:

```text
CI OIDC token -> STS AssumeRoleWithWebIdentity -> temporary deploy role -> deploy
```

Avoid:

```text
Long-lived AWS_ACCESS_KEY_ID stored in CI secrets.
```

### 19.5 Identity Probe Pattern

Use for all production-grade services.

Pattern:

```text
At startup/readiness:
  call sts:GetCallerIdentity
  check account/role/region
  fail fast if mismatch
```

Be careful:

- STS call adds startup dependency;
- allow opt-out for local offline tests;
- do not overcall STS on every request;
- cache result.

### 19.6 Explicit Client Factory Pattern

Use for clean Java architecture.

Pattern:

```text
Domain code depends on ports/gateways.
Infrastructure layer owns AWS client creation.
AWS config centralized.
Client lifecycle controlled.
Credential/region resolution observable.
```

---

## 20. Anti-Patterns

### 20.1 Hard-Coded Access Keys

```java
AwsBasicCredentials credentials = AwsBasicCredentials.create(
        "AKIA...",
        "secret"
);
```

Why bad:

- secret leakage;
- no rotation;
- audit poor;
- high blast radius;
- likely compliance violation.

### 20.2 Static Temporary Credential for Long-Running App

```java
AwsSessionCredentials creds = assumeRoleOnce();
S3Client s3 = S3Client.builder()
        .credentialsProvider(StaticCredentialsProvider.create(creds))
        .build();
```

Works until token expires.

### 20.3 Hard-Coded Profile in Production Code

```java
ProfileCredentialsProvider.create("prod")
```

Bad because:

- assumes local file;
- not portable;
- can accidentally point to production;
- breaks containers/Lambda.

### 20.4 Region Hidden in Utility Class

```java
private static final Region REGION = Region.US_EAST_1;
```

Bad because:

- environment drift;
- testing pain;
- multi-region impossible;
- resource mismatch.

### 20.5 One Role for Everything

```text
app-prod-role has S3, SQS, SNS, Secrets, DynamoDB, KMS, Lambda, IAM, CloudWatch full access
```

Bad because:

- large blast radius;
- weak audit;
- privilege creep;
- difficult incident containment.

### 20.6 Ignoring Resource Policy

Thinking:

```text
My role allows it, so it must work.
```

Reality:

```text
Resource policy, KMS policy, SCP, permission boundary, session policy, and explicit deny can still block it.
```

### 20.7 Logging Credentials

Never log:

```text
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
web identity token
full credential provider output
```

### 20.8 AssumeRole Per Request

Bad:

```text
For every business request:
  call STS AssumeRole
  build AWS client
  call S3/SQS
  close client
```

Problems:

- high latency;
- STS throttling;
- poor connection reuse;
- higher cost/risk;
- unstable under load.

Use reusable provider/client.

---

## 21. Reference Architecture: Identity-Aware Java AWS Integration

```text
+-------------------------------------------------------------+
| Application Layer                                           |
|  Use cases: upload report, publish event, load secret        |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Domain Ports                                                |
|  ObjectStore, EventPublisher, SecretProvider                 |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| AWS Infrastructure Adapter                                  |
|  S3ObjectStore, SnsEventPublisher, SecretsManagerProvider    |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| AwsClientFactory                                            |
|  region config                                               |
|  credentials provider                                        |
|  optional assume role provider                               |
|  HTTP client config                                          |
|  timeout/retry config                                        |
|  identity probe                                              |
|  observability interceptor                                   |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Runtime Identity Source                                     |
|  Lambda role / ECS task role / EKS IRSA / EC2 profile / CI   |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| AWS Authorization Plane                                     |
|  IAM, resource policy, KMS policy, SCP, condition keys       |
+-------------------------------------------------------------+
```

Design invariant:

```text
Business code never decides AWS credential source.
Infrastructure composition decides identity resolution.
Deployment config decides expected account/region/role.
Runtime platform supplies short-lived credentials.
Startup validation confirms actual identity matches expected identity.
```

---

## 22. Production Checklist

### 22.1 Credential Checklist

- [ ] No hard-coded AWS access key in source code.
- [ ] No long-lived IAM user key in production runtime.
- [ ] Runtime uses IAM role or federated temporary credential.
- [ ] Credential provider is explicit enough to be understood.
- [ ] Default provider chain behavior is documented for each environment.
- [ ] Local development uses SSO/profile/assume role.
- [ ] CI/CD uses temporary credential, preferably OIDC/AssumeRole.
- [ ] Temporary credential refresh is handled by provider, not custom ad-hoc code.
- [ ] Credential material is never logged.

### 22.2 Region Checklist

- [ ] Region is explicit in application config.
- [ ] Region is validated at startup.
- [ ] Resource ARNs match configured region.
- [ ] Multi-region clients are not hidden behind a single static global region.
- [ ] Endpoint override is disabled in production unless intentionally required.

### 22.3 STS Checklist

- [ ] AssumeRole is not called per business request.
- [ ] Role session name is meaningful.
- [ ] Source identity/session tags are used where audit requires.
- [ ] Trust policy is scoped to exact caller principal.
- [ ] External ID is used for third-party role assumption.
- [ ] Role chaining is avoided unless necessary.
- [ ] Session duration matches risk and workload.

### 22.4 IAM/Authorization Checklist

- [ ] Identity policy grants minimum required actions.
- [ ] Resource policy is checked for cross-account resources.
- [ ] KMS key policy allows required decrypt/encrypt/generate data key.
- [ ] SCP/permission boundary/session policy is considered.
- [ ] Explicit deny is checked.
- [ ] CloudTrail can reconstruct who did what.

### 22.5 Runtime Checklist

- [ ] Lambda uses execution role, not env access key.
- [ ] ECS app permission is attached to task role, not only execution role.
- [ ] EKS workload identity is per service account/workload.
- [ ] EC2 uses IMDSv2 and least privilege instance profile.
- [ ] Startup identity probe verifies account/role/region.

---

## 23. Debugging Decision Tree

```text
AWS call failed
|
+-- Is it credential resolution failure?
|   |
|   +-- Check runtime source: env/profile/web identity/ECS/EC2
|   +-- Check accidental env var override
|   +-- Check profile/token/session expiration
|
+-- Is it wrong identity?
|   |
|   +-- Call sts:GetCallerIdentity
|   +-- Compare account/role/session with expected
|
+-- Is it wrong region?
|   |
|   +-- Log resolved region
|   +-- Compare resource ARN region
|   +-- Check AWS_REGION/app config/profile
|
+-- Is it authorization failure?
|   |
|   +-- Check action/resource
|   +-- Check identity policy
|   +-- Check resource policy
|   +-- Check KMS key policy
|   +-- Check SCP/boundary/session policy
|   +-- Check condition keys
|
+-- Is it token expiration?
|   |
|   +-- Check provider refresh
|   +-- Avoid static session credentials
|   +-- Check long-running process lifecycle
|
+-- Is it endpoint/signing failure?
    |
    +-- Check endpoint override
    +-- Check region/signing region
    +-- Check system clock
    +-- Check proxy/TLS behavior
```

---

## 24. Exercises

### Exercise 1 — Identify the Principal

Write a small Java command-line tool that prints:

```text
account id
ARN
user id
region
```

Run it in:

1. local machine with `AWS_PROFILE`;
2. local machine with env credential;
3. Lambda;
4. ECS/EKS/EC2 if available.

Observe how identity changes without changing application code.

### Exercise 2 — Wrong Region Simulation

Create/read a secret in `ap-southeast-1`, then configure app region to `us-east-1`. Observe error type. Then fix region.

Goal:

```text
Train yourself to suspect region mismatch before blaming service/data.
```

### Exercise 3 — AssumeRole Boundary

Create two accounts or simulate with two roles:

```text
caller-role
target-role
```

Make caller policy allow `sts:AssumeRole`, but remove trust from target role. Observe failure. Then add trust but remove permission from target role. Observe different failure.

Goal:

```text
Understand that AssumeRole requires both caller permission and target trust.
```

### Exercise 4 — Startup Guard

Implement expected account/role validation. Misconfigure local profile intentionally. Confirm app fails fast.

### Exercise 5 — AccessDenied Investigation

Create encrypted S3 object with SSE-KMS. Give role `s3:GetObject` but not `kms:Decrypt`. Observe failure. Then add KMS permission/key policy. Observe success.

Goal:

```text
Understand multi-layer authorization.
```

---

## 25. Key Takeaways

1. AWS SDK call is not a normal local method call. It is a signed remote operation by a specific identity in a specific region against a specific resource.
2. Credential is not permission. Credential proves identity; policy grants or denies action.
3. Default credential provider chain is powerful, but it can silently pick an unintended source.
4. Production Java apps should not use static access keys. Prefer runtime roles and temporary credentials.
5. Region must be explicit and validated. Wrong region often looks like missing resource or authorization failure.
6. STS AssumeRole requires both caller permission and target trust policy.
7. Cross-account access should use AssumeRole, not shared long-lived keys.
8. `GetCallerIdentity` is one of the most useful AWS debugging calls.
9. Authorization may involve IAM policy, resource policy, KMS key policy, SCP, permission boundary, session policy, and explicit deny.
10. Startup identity validation prevents catastrophic wrong-account/wrong-role/wrong-region mistakes.
11. Java architecture should centralize AWS client/identity configuration in infrastructure layer, not scatter it through business code.
12. Auditability starts at session name, source identity, role design, and CloudTrail visibility.

---

## 26. How This Part Connects to the Next Parts

Part 2 gives the identity/region foundation required for every AWS service.

Next parts will build on this:

```text
Part 3  -> IAM least privilege and authorization modelling
Part 4  -> HTTP layer, timeout, retry, backpressure
Part 5  -> AWS error taxonomy and failure modelling
Part 8+ -> S3 design with identity/region/KMS implications
Part 11 -> Secrets Manager and SSM with credential/runtime config
Part 13 -> SQS with queue policy and worker role
Part 17 -> Lambda execution role and runtime lifecycle
```

If Part 2 is weak, all later service-specific knowledge becomes fragile. If Part 2 is strong, you can debug many “mysterious AWS problems” systematically.

---

## 27. References

- AWS SDK for Java 2.x — Default credentials provider chain: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html>
- AWS SDK for Java 2.x — Using credentials providers: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials.html>
- AWS SDK for Java 2.x — Specify a credentials provider: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-providers.html>
- AWS SDK for Java 2.x — Region selection: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/region-selection.html>
- AWS SDK for Java 2.x — DefaultAwsRegionProviderChain Javadoc: <https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/regions/providers/DefaultAwsRegionProviderChain.html>
- AWS STS — AssumeRole API Reference: <https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html>
- AWS SDKs and Tools — Standardized credential providers: <https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html>


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-01-aws-sdk-java-2x-architecture-deep-dive.md">⬅️ Part 1 — AWS SDK for Java 2.x Architecture Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-03-iam-for-java-engineers-least-privilege-that-actually-works.md">Part 3 — IAM for Java Engineers: Least Privilege That Actually Works ➡️</a>
</div>
