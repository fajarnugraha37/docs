# Part 12 — KMS for Application Engineers

Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target Java: 8 sampai 25  
Fokus utama: AWS KMS sebagai boundary kriptografi, authorization, auditability, dan operational risk untuk aplikasi Java production.

> Bagian ini bukan pengulangan crypto dasar. Kita tidak akan membahas lagi apa itu AES, RSA, hash, signature, TLS, entropy, atau key derivation secara fundamental. Fokusnya adalah bagaimana engineer Java memakai AWS KMS dengan benar sebagai managed cryptographic control plane di sistem nyata.

---

## 1. Kenapa KMS Penting untuk Application Engineer

Banyak engineer memperlakukan KMS sebagai detail konfigurasi:

```text
S3 pakai SSE-KMS.
Secrets Manager pakai KMS.
SQS encrypted.
Done.
```

Cara pikir itu terlalu dangkal.

Untuk engineer production, KMS adalah salah satu boundary paling penting dalam sistem cloud karena KMS menentukan:

1. siapa boleh membuka data,
2. service mana boleh melakukan encrypt/decrypt,
3. context apa yang harus melekat pada operasi kriptografi,
4. bagaimana penggunaan key diaudit,
5. bagaimana blast radius dibatasi,
6. bagaimana data tetap aman walaupun object store, queue, database, atau backup bocor,
7. bagaimana recovery dilakukan ketika permission, key policy, quota, atau rotation bermasalah.

Mental model utamanya:

```text
KMS is not merely encryption.
KMS is cryptographic authorization + audit boundary.
```

Encryption tanpa governance hanya membuat data tampak aman. KMS yang didesain benar membuat akses data bisa dipertanggungjawabkan.

---

## 2. KMS dalam Peta Arsitektur AWS

Di AWS, banyak service dapat memakai KMS untuk server-side encryption atau envelope encryption:

```text
Application / Lambda / Worker
        |
        | AWS SDK call
        v
+------------------+
| AWS Service      |
| S3 / SQS / SNS   |
| Secrets / RDS    |
| DynamoDB / EBS   |
+------------------+
        |
        | encrypt/decrypt data key or service-owned material
        v
+------------------+
| AWS KMS          |
| Key control      |
| policy boundary  |
| audit trail      |
+------------------+
```

Kadang aplikasi memanggil KMS langsung. Kadang aplikasi hanya memakai service lain yang memanggil KMS atas nama aplikasi.

Dua pola besar:

```text
Pattern A — Direct KMS usage
Java app -> KMS GenerateDataKey/Decrypt -> app encrypts/decrypts payload

Pattern B — Service-integrated KMS usage
Java app -> S3 PutObject with SSE-KMS -> S3 calls KMS internally
Java app -> SQS SendMessage to encrypted queue -> SQS uses KMS internally
Java app -> SecretsManager GetSecretValue -> Secrets Manager uses KMS internally
```

Keduanya punya implikasi IAM, latency, quota, audit, dan failure yang berbeda.

---

## 3. Terminologi yang Harus Tepat

### 3.1 KMS key

KMS key adalah logical key resource di AWS KMS. Ia memiliki metadata, key ID, ARN, policy, alias, state, rotation setting, usage, dan backing key material.

Istilah lama “CMK” sering masih muncul di artikel lama. Dalam dokumen modern AWS, istilah yang lebih tepat adalah **KMS key**. Jenis yang paling sering ditemui:

1. **AWS owned key**
2. **AWS managed key**
3. **Customer managed key**

### 3.2 AWS owned key

AWS owned key dimiliki dan dikelola oleh AWS untuk service tertentu. Biasanya tidak terlihat di akun kita dan tidak dapat kita kontrol policy/rotation-nya.

Cocok untuk default encryption sederhana ketika tidak butuh kontrol atau audit khusus di level key.

### 3.3 AWS managed key

AWS managed key dibuat, dikelola, dan dirotasi oleh AWS untuk service tertentu di akun kita. Biasanya alias seperti:

```text
alias/aws/s3
alias/aws/secretsmanager
alias/aws/sqs
```

Kita bisa melihatnya, tetapi kontrol policy dan lifecycle terbatas.

### 3.4 Customer managed key

Customer managed key dibuat dan dikontrol oleh akun kita. Ini memberi kontrol atas:

- key policy,
- alias,
- rotation,
- enable/disable,
- deletion schedule,
- tags,
- grants,
- cross-account usage,
- CloudTrail audit dengan key ARN spesifik.

Untuk sistem regulated, customer managed key biasanya dipilih karena butuh governance yang eksplisit.

### 3.5 Data key

Data key adalah symmetric key yang dipakai untuk mengenkripsi data aktual. Dalam envelope encryption, data key biasanya dibuat oleh KMS melalui `GenerateDataKey`.

KMS mengembalikan dua bentuk:

```text
Plaintext data key      -> dipakai sementara di memory untuk encrypt data
Encrypted data key      -> disimpan bersama ciphertext
```

Plaintext data key tidak boleh disimpan permanen.

### 3.6 Key encryption key / wrapping key

KMS key bertindak sebagai wrapping key: ia mengenkripsi data key, bukan selalu mengenkripsi payload besar secara langsung.

### 3.7 Encryption context

Encryption context adalah key-value metadata yang dilekatkan ke operasi cryptographic KMS. Ia bukan secret. Ia digunakan sebagai authenticated additional data dan bisa muncul dalam audit trail.

Contoh:

```text
caseId=CASE-2026-000123
module=appeal
tenant=cea
purpose=document-envelope-encryption
```

Context yang sama biasanya harus diberikan saat decrypt. Jika tidak cocok, decrypt gagal.

### 3.8 Grant

Grant adalah authorization instrument yang memberi principal tertentu izin memakai KMS key untuk operasi tertentu, sering digunakan oleh AWS service untuk penggunaan sementara atau delegated.

---

## 4. Mental Model: KMS sebagai Control Plane Kriptografi

KMS bukan library encryption lokal.

Saat Java app memanggil KMS, aplikasi melakukan remote API call ke service control plane. Artinya ada konsekuensi:

```text
KMS call = network call + IAM authorization + key policy evaluation + quota + latency + audit log
```

Jadi desain yang salah:

```java
for (Record record : records) {
    kms.encrypt(...); // one remote KMS call per row
}
```

Desain yang lebih tepat:

```text
1 batch/job obtains data key or uses AWS Encryption SDK with caching policy
2 app encrypts many payloads locally within a bounded security envelope
3 encrypted data key is stored with ciphertext
4 KMS usage is controlled, audited, and rate-limited
```

KMS harus diperlakukan sebagai scarce, sensitive, high-value dependency.

---

## 5. Envelope Encryption: Konsep yang Wajib Dikuasai

Envelope encryption adalah pola utama untuk mengenkripsi data besar dengan KMS.

Masalahnya:

- Mengenkripsi data besar langsung dengan remote service tidak efisien.
- Kita butuh key yang cepat untuk payload besar.
- Kita tetap ingin master control berada di KMS.

Solusinya:

```text
Step 1: App meminta data key dari KMS.
Step 2: KMS membuat plaintext data key dan encrypted data key.
Step 3: App memakai plaintext data key untuk encrypt data lokal.
Step 4: App membuang plaintext data key dari memory secepat mungkin.
Step 5: App menyimpan ciphertext + encrypted data key + encryption metadata.
Step 6: Saat decrypt, app mengirim encrypted data key ke KMS.
Step 7: KMS mengembalikan plaintext data key jika authorized dan context cocok.
Step 8: App decrypt ciphertext lokal.
```

Diagram:

```text
Encrypt path

Java App
  |
  | GenerateDataKey(keyId, encryptionContext)
  v
AWS KMS
  |
  | plaintextDataKey + encryptedDataKey
  v
Java App
  |
  | encrypt payload locally using plaintextDataKey
  v
Store:
  - ciphertext
  - encryptedDataKey
  - algorithm metadata
  - encryptionContext metadata
  - keyId/keyArn or key reference
```

Decrypt path:

```text
Java App
  |
  | load ciphertext + encryptedDataKey + metadata
  |
  | Decrypt(encryptedDataKey, encryptionContext)
  v
AWS KMS
  |
  | plaintextDataKey if allowed
  v
Java App
  |
  | decrypt payload locally
  v
Plaintext data available only inside trusted processing boundary
```

Important invariant:

```text
Plaintext data key is runtime-only material.
Encrypted data key is storage-safe metadata.
```

---

## 6. Direct KMS Encrypt/Decrypt vs GenerateDataKey

AWS KMS punya API `Encrypt` dan `Decrypt`, tetapi itu tidak berarti semua data harus dikirim ke KMS.

### 6.1 Direct Encrypt/Decrypt

Cocok untuk:

- secret kecil,
- token kecil,
- configuration fragment kecil,
- bootstrap credential kecil,
- low-volume administrative operation.

Tidak cocok untuk:

- file besar,
- payload banyak,
- row-level encryption dalam loop besar,
- high-throughput service path.

### 6.2 GenerateDataKey

Cocok untuk:

- envelope encryption,
- file/object encryption,
- message-level encryption,
- field-level encryption dengan desain caching yang hati-hati,
- data yang perlu disimpan bersama encrypted data key.

### 6.3 GenerateDataKeyWithoutPlaintext

Cocok untuk flow tertentu di mana service butuh encrypted data key dulu, tetapi plaintext data key tidak boleh muncul pada caller.

### 6.4 Decrypt

Decrypt pada KMS biasanya dipakai untuk membuka encrypted data key, bukan selalu decrypt payload aplikasi.

---

## 7. Jangan Salah Memilih Level Encryption

Ada beberapa level encryption dalam sistem AWS:

```text
1. Transport encryption
   TLS between client and AWS service

2. Server-side encryption by service
   S3/SQS/SNS/Secrets/DynamoDB encrypt at rest

3. Client-side envelope encryption
   Application encrypts before sending data to storage/service

4. Application-level domain encryption
   Specific fields encrypted according to business/regulatory semantics
```

Masing-masing menjawab ancaman berbeda.

### 7.1 Server-side encryption

Contoh:

```text
S3 SSE-KMS
SQS SSE-KMS
SNS SSE-KMS
Secrets Manager KMS encryption
```

Service menerima plaintext dari aplikasi, lalu menyimpan secara encrypted at rest.

Cocok saat:

- trust boundary mencakup service tersebut,
- data boleh terlihat oleh service saat processing,
- tujuan utama adalah at-rest protection dan key-level audit.

### 7.2 Client-side encryption

Aplikasi mengenkripsi data sebelum data dikirim ke S3, database, queue, atau storage lain.

Cocok saat:

- storage tidak boleh melihat plaintext,
- data sensitif harus tetap encrypted di semua downstream,
- perlu cryptographic separation per tenant/case/module,
- perlu independent decrypt authorization.

Trade-off:

- query/search sulit,
- schema evolution lebih rumit,
- key rotation lebih mahal,
- debugging lebih sulit,
- cache/key lifecycle lebih berisiko,
- observability harus hati-hati agar plaintext tidak bocor.

---

## 8. KMS Key Policy vs IAM Policy

Ini salah satu area paling sering membingungkan.

Mental model:

```text
IAM policy answers:
"Does this principal claim permission to call kms:Decrypt?"

KMS key policy answers:
"Does this KMS key allow that principal or account to use this key?"
```

Untuk KMS, key policy sangat sentral. KMS key selalu punya key policy. IAM policy saja tidak cukup jika key policy tidak mengizinkan penggunaan lewat IAM atau principal terkait.

### 8.1 Identity-based policy

Attached ke IAM role/user/group.

Contoh role Lambda:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234"
    }
  ]
}
```

### 8.2 Key policy

Attached ke KMS key.

Contoh minimal yang mengizinkan role tertentu menggunakan key:

```json
{
  "Sid": "AllowApplicationRoleUseOfKey",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111122223333:role/prod-case-worker-role"
  },
  "Action": [
    "kms:Encrypt",
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

Di key policy, resource biasanya `*` karena policy sudah melekat pada key tersebut.

### 8.3 Allow account to use IAM policies

Banyak key policy memiliki statement yang memungkinkan account root mendelegasikan authorization ke IAM policies:

```json
{
  "Sid": "EnableIamUserPermissions",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111122223333:root"
  },
  "Action": "kms:*",
  "Resource": "*"
}
```

Ini tidak berarti root user digunakan langsung. Ini berarti akun tersebut dapat mengatur akses melalui IAM.

### 8.4 Common failure

```text
App role has kms:Decrypt in IAM policy.
But KMS key policy does not allow the role/account.
Result: AccessDeniedException.
```

Atau sebaliknya:

```text
KMS key policy allows the account.
But app role does not have IAM permission.
Result: AccessDeniedException.
```

Debugging KMS selalu harus melihat dua sisi:

```text
principal side + key side
```

---

## 9. Grants: Delegated and Temporary Permission

Grant adalah mekanisme permission yang sering muncul saat AWS service menggunakan KMS key atas nama principal.

Contoh situasi:

- EBS volume encrypted dengan KMS.
- Lambda menggunakan encrypted environment variable.
- AWS service butuh menggunakan KMS key untuk resource lifecycle.
- Cross-account atau service-integrated workflow membutuhkan akses terbatas.

Grant bisa lebih dinamis daripada mengubah key policy.

Mental model:

```text
Key policy = baseline governance
IAM policy = identity permission
Grant      = delegated operational permission for specific usage
```

Jangan gunakan grants sebagai pengganti governance utama aplikasi kecuali memang ada kebutuhan delegated lifecycle.

---

## 10. Encryption Context sebagai Authorization Primitive

Encryption context sering dianggap metadata biasa. Itu salah.

Encryption context dapat menjadi authorization and integrity primitive.

Contoh saat encrypt:

```text
caseId=CASE-2026-000123
module=document
classification=restricted
```

Saat decrypt, context yang sama harus dipakai. Jika attacker mengambil encrypted data key dari case lain lalu mencoba decrypt dengan context berbeda, operasi gagal.

### 10.1 Binding ciphertext to domain context

Tanpa encryption context:

```text
EncryptedDataKey from Object A might be reused incorrectly with Object B if application metadata corrupt.
```

Dengan encryption context:

```text
EncryptedDataKey is cryptographically bound to caseId/module/purpose.
```

### 10.2 Context bukan secret

Jangan taruh password, token, NRIC, PII sensitif, atau credential di encryption context. Context dapat muncul di logs/audit.

Baik:

```text
module=case-management
purpose=document-encryption
tenant=cea
caseType=appeal
```

Hati-hati:

```text
caseId=CASE-2026-000123
```

Bisa diterima jika case ID bukan highly sensitive dan memang dibutuhkan untuk audit. Namun untuk sistem regulated, evaluasi apakah identifier tersebut termasuk sensitive metadata.

Buruk:

```text
nric=S1234567A
password=...
accessToken=...
```

### 10.3 IAM condition dengan encryption context

KMS mendukung condition key berbasis encryption context. Ini memungkinkan policy seperti:

```text
Role hanya boleh decrypt jika encryption context module=document-management.
```

Contoh konseptual:

```json
{
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234",
  "Condition": {
    "StringEquals": {
      "kms:EncryptionContext:module": "document-management"
    }
  }
}
```

Ini kuat karena authorization tidak hanya berdasarkan siapa caller-nya, tetapi juga konteks data yang sedang dibuka.

---

## 11. Key Design: Satu Key untuk Semua atau Banyak Key?

Tidak ada jawaban universal. Ini trade-off governance, cost, quota, complexity, dan blast radius.

### 11.1 Single application key

```text
alias/prod/aceas/application
```

Kelebihan:

- sederhana,
- sedikit policy,
- mudah dipahami,
- murah secara operasional.

Kekurangan:

- blast radius besar,
- audit kurang granular,
- sulit membedakan permission antar module,
- rotation/revocation berdampak luas.

### 11.2 Key per domain/module

```text
alias/prod/aceas/document
alias/prod/aceas/case
alias/prod/aceas/payment
alias/prod/aceas/report
```

Kelebihan:

- blast radius lebih kecil,
- audit lebih jelas,
- permission lebih spesifik,
- cocok untuk regulated module.

Kekurangan:

- policy lebih banyak,
- lifecycle lebih kompleks,
- deployment/config lebih rawan salah,
- perlu naming convention kuat.

### 11.3 Key per tenant

```text
alias/prod/platform/tenant-a
alias/prod/platform/tenant-b
```

Kelebihan:

- isolasi tenant kuat,
- revoke tenant lebih mudah,
- audit tenant jelas.

Kekurangan:

- key explosion,
- quota/resource management,
- operational overhead tinggi,
- sulit jika tenant sangat banyak.

### 11.4 Key per data classification

```text
alias/prod/app/internal
alias/prod/app/confidential
alias/prod/app/restricted
```

Kelebihan:

- align dengan data classification,
- policy bisa mengikuti sensitivity,
- governance mudah dijelaskan ke auditor.

Kekurangan:

- aplikasi harus tahu classification,
- salah classification berarti salah key,
- tidak selalu cocok untuk domain isolation.

### 11.5 Recommended decision model

Gunakan pertanyaan ini:

```text
1. Apakah data punya owner atau module berbeda?
2. Apakah permission decrypt berbeda?
3. Apakah audit harus dipisahkan?
4. Apakah compromise satu module boleh membuka data module lain?
5. Apakah rotation/revocation perlu granular?
6. Apakah tim sanggup mengoperasikan jumlah key tersebut?
```

Jika jawaban 2–5 banyak “ya”, pisahkan key.

Jika semua sama, satu key per app/env mungkin cukup.

---

## 12. Naming Convention untuk KMS Alias

Jangan refer langsung ke raw key ID di aplikasi kecuali perlu.

Gunakan alias yang stabil:

```text
alias/<env>/<system>/<domain>/<purpose>
```

Contoh:

```text
alias/dev/aceas/document/envelope
alias/uat/aceas/document/envelope
alias/prod/aceas/document/envelope

alias/prod/aceas/secrets/default
alias/prod/aceas/sqs/case-events
alias/prod/aceas/s3/document-archive
```

Prinsip:

1. env eksplisit,
2. system eksplisit,
3. domain/purpose eksplisit,
4. jangan pakai nama orang/tim,
5. jangan masukkan data sensitif,
6. jangan reuse alias antar environment,
7. jangan hardcode key UUID di banyak tempat.

Aplikasi Java biasanya menerima config:

```properties
aws.kms.document-key-alias=alias/prod/aceas/document/envelope
```

Tetapi untuk beberapa API AWS, key ARN lebih disarankan agar tidak ambigu lintas akun/region.

---

## 13. Key State dan Operational Impact

KMS key punya state. State memengaruhi aplikasi.

State penting:

```text
Enabled
Disabled
PendingDeletion
PendingImport
Unavailable
```

Jika key disabled:

```text
Encrypt/decrypt using that key fails.
```

Jika key pending deletion:

```text
Ada risiko data tidak bisa didecrypt selamanya jika key benar-benar dihapus.
```

Golden rule:

```text
Never delete a KMS key unless you have proven that no retained data depends on it.
```

Untuk production, deletion harus melalui controlled change:

```text
1. identify all encrypted data using the key
2. verify retention/legal hold
3. re-encrypt or expire data
4. disable key first
5. observe impact window
6. schedule deletion only after approval
```

---

## 14. Key Rotation

KMS mendukung rotation untuk customer managed key tertentu. Tetapi application engineer harus memahami dampaknya.

### 14.1 Rotation does not re-encrypt existing data automatically

Saat key rotated, KMS menyimpan key material lama agar data lama tetap bisa didecrypt. Data baru akan diencrypt dengan material baru.

Artinya:

```text
KMS rotation != data re-encryption migration
```

Jika compliance meminta re-encrypt data lama, itu job berbeda.

### 14.2 Alias rotation strategy

Kadang organisasi membuat key baru lalu memindahkan alias:

```text
alias/prod/app/document -> old key
alias/prod/app/document -> new key
```

Ini membuat encrypt baru memakai key baru, tetapi decrypt data lama tetap butuh metadata yang menunjuk key lama atau ciphertext blob KMS yang menyimpan key reference.

Risiko:

- data lama tidak bisa didecrypt jika aplikasi hanya tahu alias baru,
- policy key lama terhapus,
- key lama disabled terlalu cepat.

### 14.3 Re-encryption strategy

Untuk client-side envelope encryption:

```text
1. read ciphertext + encrypted data key
2. decrypt encrypted data key with old KMS key
3. either rewrap data key with new KMS key or decrypt/re-encrypt payload
4. update metadata atomically
5. keep audit trail
```

Untuk KMS rewrap, API `ReEncrypt` bisa dipakai untuk mengubah encrypted data key dari key lama ke key baru tanpa exposing plaintext ke aplikasi.

---

## 15. KMS and Java SDK 2.x: Client Construction

Dependency Maven umum:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>${aws.sdk.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>kms</artifactId>
  </dependency>
</dependencies>
```

Client:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kms.KmsClient;

public final class KmsClients {
    private KmsClients() {}

    public static KmsClient create() {
        return KmsClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build();
    }
}
```

Production client sebaiknya:

- singleton per region/config,
- menggunakan default credentials provider chain,
- timeout eksplisit,
- retry strategy eksplisit,
- metric/interceptor bila perlu,
- ditutup saat shutdown jika lifecycle managed manual.

Contoh dengan override config:

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.retry.RetryMode;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kms.KmsClient;

import java.time.Duration;

public final class ProductionKmsClientFactory {

    public KmsClient create(Region region) {
        ClientOverrideConfiguration override = ClientOverrideConfiguration.builder()
                .apiCallAttemptTimeout(Duration.ofSeconds(2))
                .apiCallTimeout(Duration.ofSeconds(5))
                .retryStrategy(RetryMode.STANDARD)
                .build();

        return KmsClient.builder()
                .region(region)
                .overrideConfiguration(override)
                .build();
    }
}
```

Catatan:

- timeout terlalu pendek bisa membuat false failure,
- timeout terlalu panjang bisa membuat thread pile-up,
- retry berlebihan bisa memperparah throttling,
- KMS bukan dependency yang harus dipanggil secara agresif di hot loop.

---

## 16. Direct Encrypt Example untuk Payload Kecil

Contoh ini untuk data kecil. Jangan gunakan untuk file besar.

```java
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.kms.model.EncryptRequest;
import software.amazon.awssdk.services.kms.model.EncryptResponse;

import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class SmallSecretEncryptor {
    private final KmsClient kms;
    private final String keyId;

    public SmallSecretEncryptor(KmsClient kms, String keyId) {
        this.kms = kms;
        this.keyId = keyId;
    }

    public byte[] encrypt(String value, String module, String purpose) {
        EncryptRequest request = EncryptRequest.builder()
                .keyId(keyId)
                .plaintext(SdkBytes.fromByteArray(value.getBytes(StandardCharsets.UTF_8)))
                .encryptionContext(Map.of(
                        "module", module,
                        "purpose", purpose
                ))
                .build();

        EncryptResponse response = kms.encrypt(request);
        return response.ciphertextBlob().asByteArray();
    }
}
```

Engineering notes:

- Jangan log plaintext.
- Jangan log ciphertext jika tidak perlu.
- Jangan taruh PII di encryption context tanpa alasan governance.
- Jangan gunakan direct encrypt untuk high-volume data.

---

## 17. Direct Decrypt Example

```java
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.kms.model.DecryptRequest;
import software.amazon.awssdk.services.kms.model.DecryptResponse;

import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class SmallSecretDecryptor {
    private final KmsClient kms;

    public SmallSecretDecryptor(KmsClient kms) {
        this.kms = kms;
    }

    public String decrypt(byte[] ciphertext, String module, String purpose) {
        DecryptRequest request = DecryptRequest.builder()
                .ciphertextBlob(SdkBytes.fromByteArray(ciphertext))
                .encryptionContext(Map.of(
                        "module", module,
                        "purpose", purpose
                ))
                .build();

        DecryptResponse response = kms.decrypt(request);
        byte[] plaintextBytes = response.plaintext().asByteArray();
        return new String(plaintextBytes, StandardCharsets.UTF_8);
    }
}
```

Problem:

```java
return new String(plaintextBytes, StandardCharsets.UTF_8);
```

Untuk secret sangat sensitif, `String` sulit dihapus dari memory karena immutable. Namun dalam banyak Java enterprise apps, Secrets Manager sendiri mengembalikan string secret. Jadi keputusan harus disesuaikan dengan threat model.

Lebih hati-hati:

```text
Use byte[] or char[] where feasible.
Minimize lifetime.
Do not log.
Do not put in exception message.
Do not expose through actuator/config endpoint.
```

---

## 18. GenerateDataKey Example

```java
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.kms.model.DataKeySpec;
import software.amazon.awssdk.services.kms.model.GenerateDataKeyRequest;
import software.amazon.awssdk.services.kms.model.GenerateDataKeyResponse;

import java.util.Map;

public final class DataKeyService {
    private final KmsClient kms;
    private final String keyId;

    public DataKeyService(KmsClient kms, String keyId) {
        this.kms = kms;
        this.keyId = keyId;
    }

    public GeneratedDataKey generateForDocument(String documentId, String classification) {
        GenerateDataKeyRequest request = GenerateDataKeyRequest.builder()
                .keyId(keyId)
                .keySpec(DataKeySpec.AES_256)
                .encryptionContext(Map.of(
                        "purpose", "document-envelope-encryption",
                        "classification", classification,
                        "documentId", documentId
                ))
                .build();

        GenerateDataKeyResponse response = kms.generateDataKey(request);

        return new GeneratedDataKey(
                response.plaintext().asByteArray(),
                response.ciphertextBlob().asByteArray(),
                response.keyId()
        );
    }

    public record GeneratedDataKey(
            byte[] plaintextDataKey,
            byte[] encryptedDataKey,
            String keyId
    ) {}
}
```

Critical invariant:

```text
plaintextDataKey must be cleared after local encryption.
```

Example cleanup:

```java
import java.util.Arrays;

byte[] key = generated.plaintextDataKey();
try {
    // encrypt locally
} finally {
    Arrays.fill(key, (byte) 0);
}
```

Caveat:

- JVM copies may exist depending on library usage.
- `SdkBytes` internal representation may also have lifecycle considerations.
- Perfect memory zeroization is hard in Java.
- Still, minimizing retention is better than ignoring key lifetime.

---

## 19. Should You Implement Envelope Encryption Yourself?

Usually, no.

For serious client-side encryption, prefer AWS Encryption SDK or a well-reviewed cryptographic library rather than assembling primitives casually.

Why?

Envelope encryption involves:

- algorithm selection,
- IV/nonce generation,
- authenticated encryption,
- message framing,
- key commitment,
- metadata format,
- encryption context binding,
- data key lifecycle,
- multi-key wrapping,
- backward compatibility,
- streaming encryption,
- safe decrypt behavior.

A custom implementation easily becomes fragile.

Acceptable reasons to implement a narrow wrapper yourself:

- you are only wrapping SDK calls for service-integrated KMS,
- payload encryption is delegated to AWS Encryption SDK,
- you need strict domain metadata validation around a known encryption library,
- you are building a small adapter, not cryptographic protocol.

Dangerous reasons:

```text
"AES/GCM seems easy."
"We only need basic encryption."
"Let's store IV next to ciphertext manually and move on."
```

Top-tier engineering means knowing when not to be clever.

---

## 20. AWS Encryption SDK Positioning

AWS Encryption SDK is designed for client-side encryption and envelope encryption. It handles message format, encrypted data keys, encryption context, and integration with KMS keyrings.

Use it when:

- app must encrypt data before storing/sending,
- multiple KMS keys or keyrings are needed,
- streaming/client-side encryption is needed,
- you want established envelope encryption behavior,
- you need data key caching under strict thresholds.

Be careful with:

- dependency size,
- startup/cold start impact,
- compatibility across versions,
- cache security thresholds,
- metadata format migration.

For Lambda cold-start-sensitive path, validate overhead.

---

## 21. Data Key Caching: Performance vs Security

KMS calls add latency and are quota-limited. Data key caching can reduce:

- KMS request rate,
- latency,
- cost,
- throttling probability.

But caching plaintext data keys increases exposure if process memory is compromised.

Decision questions:

```text
1. Is KMS latency/throttling actually a bottleneck?
2. What is the maximum acceptable data encrypted per cached key?
3. What is the maximum acceptable time a plaintext data key can live?
4. What is the maximum number of messages/objects per key?
5. What is the blast radius if one cached data key leaks?
6. Can we segment cache by tenant/module/classification?
7. Can we use AWS service-side encryption instead?
```

Safe caching requires thresholds:

```text
max age
max bytes encrypted
max messages encrypted
max cache entries
classification-aware separation
explicit eviction
metrics
```

Anti-pattern:

```text
Cache plaintext data key forever because KMS is slow.
```

Better:

```text
Cache bounded data keys with strict TTL and usage cap only after measuring KMS bottleneck.
```

---

## 22. KMS Throttling and Quota-Aware Design

KMS has account/region request quotas. Request quotas are evaluated per account and region. If exceeded, KMS can return `ThrottlingException`.

KMS throttling in production usually means one of these:

1. too many per-record encrypt/decrypt calls,
2. no caching where appropriate,
3. no batching at higher layer,
4. bursty Lambda concurrency,
5. S3/SQS/SNS SSE-KMS traffic spike,
6. multiple services sharing same regional quota,
7. retry amplification.

### 22.1 Retry amplification

Bad flow:

```text
1000 workers call KMS
KMS throttles
all workers retry immediately
traffic doubles/triples
KMS throttles harder
system collapses
```

Better:

```text
bounded concurrency
jittered retry
client-side rate limiting
queue buffering
data key caching where appropriate
service quota monitoring
```

### 22.2 Lambda concurrency and KMS

Lambda can scale quickly. If each invocation performs KMS decrypt several times at startup, cold-start burst can create KMS spike.

Mitigation:

- initialize once per execution environment,
- cache decrypted config carefully,
- use Secrets Manager cache where appropriate,
- reduce KMS calls inside handler loop,
- set reserved concurrency,
- use provisioned concurrency carefully,
- avoid decrypt-per-message if batch processing.

### 22.3 S3 SSE-KMS and hidden KMS usage

S3 SSE-KMS can call KMS behind the scenes. High-volume S3 workloads can become KMS-heavy. S3 Bucket Keys can reduce KMS request cost and traffic in many SSE-KMS scenarios.

---

## 23. Service-Integrated KMS: S3

S3 with SSE-KMS:

```java
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.ServerSideEncryption;

PutObjectRequest request = PutObjectRequest.builder()
        .bucket("prod-aceas-document-archive")
        .key("case/2026/000123/document/abc.pdf")
        .serverSideEncryption(ServerSideEncryption.AWS_KMS)
        .ssekmsKeyId("arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234")
        .bucketKeyEnabled(true)
        .metadata(Map.of(
                "classification", "restricted",
                "module", "document"
        ))
        .build();
```

Important:

- App role needs `s3:PutObject`.
- App/service path may require KMS permissions depending on operation.
- Bucket policy may enforce specific KMS key.
- Key policy must allow intended usage.
- Cross-account S3 + KMS requires both bucket and key policy alignment.

Policy guardrail example:

```json
{
  "Sid": "DenyUnencryptedObjectUploads",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::prod-aceas-document-archive/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}
```

Another guardrail:

```json
{
  "Sid": "DenyWrongKmsKey",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::prod-aceas-document-archive/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234"
    }
  }
}
```

---

## 24. Service-Integrated KMS: SQS

SQS server-side encryption protects message body at rest.

Important distinction:

```text
SQS SSE-KMS does not mean consumers cannot see plaintext.
Authorized consumers receive plaintext message body from SQS.
```

If consumers should not see plaintext, you need client-side encryption before `SendMessage`.

For SQS SSE-KMS:

- queue has KMS key configured,
- producers/consumers need SQS permissions,
- KMS permissions may be required depending on producer/consumer/service use,
- queue policy and KMS key policy must align for cross-account.

Use cases:

```text
SSE-KMS enough:
- protect queue storage at rest
- trusted producers/consumers

Client-side encryption needed:
- queue is shared transport boundary
- consumer groups have different clearance
- message broker must not expose plaintext to some parties
```

---

## 25. Service-Integrated KMS: SNS

SNS SSE-KMS encrypts messages at rest in SNS.

But after delivery:

```text
SNS -> SQS: message is delivered to SQS, then SQS encryption applies at rest.
SNS -> Lambda: Lambda receives plaintext event payload.
SNS -> HTTPS: endpoint receives plaintext over TLS.
```

If payload confidentiality must persist across fan-out, encrypt payload at application level before publish.

Design question:

```text
Is SNS just a trusted fan-out control plane, or is SNS crossing confidentiality boundaries?
```

If crossing boundaries, prefer:

```text
message envelope:
- encryptedPayload
- encryptedDataKey
- keyId
- encryptionContext
- schemaVersion
- contentType
```

---

## 26. Service-Integrated KMS: Secrets Manager

Secrets Manager encrypts secret value with KMS.

Common designs:

```text
alias/prod/app/secrets/default
alias/prod/app/secrets/db
alias/prod/app/secrets/external-api
```

Application usually does not call KMS directly for secret retrieval. It calls Secrets Manager; Secrets Manager uses KMS.

But access still involves:

```text
secretsmanager:GetSecretValue
kms:Decrypt on the key used by the secret
key policy allowing the role/account
```

Operational issue:

```text
Secret exists.
IAM allows GetSecretValue.
But KMS decrypt denied.
Application fails at startup.
```

So secret access tests must validate both Secrets Manager and KMS.

---

## 27. Service-Integrated KMS: Lambda

Lambda uses KMS in several places:

- environment variable encryption,
- SnapStart snapshots in some configurations,
- encrypted deployment/config integration,
- customer managed key for function environment encryption.

Important Lambda behavior:

```text
Decrypted env vars are available to function runtime.
Do not put large or highly dynamic secrets in env vars.
Prefer Secrets Manager/SSM for runtime secret/config with proper caching.
```

If using customer managed key:

- Lambda service needs to use the key,
- execution role/user deploying may need permission,
- key policy must allow relevant service/principal,
- disabling key may break function configuration/deployment/invocation depending on usage.

---

## 28. Multi-Account and Cross-Account KMS

Cross-account KMS is common in enterprise setups:

```text
App account        -> runs Java service
Shared security    -> owns KMS keys
Data account       -> owns S3 bucket
```

To make cross-account usage work, align:

```text
1. caller IAM policy
2. key policy in KMS-owning account
3. resource policy of target service if any
4. service principal conditions when service-integrated
5. region consistency
```

Example mental model:

```text
Role A in Account 1111 wants kms:Decrypt on Key B in Account 2222.

Role A IAM policy must allow kms:Decrypt on Key B ARN.
Key B policy must allow Role A or Account 1111.
If S3 involved, bucket policy must also allow the S3 operation.
```

Common failure:

```text
S3 object encrypted with KMS key from bucket owner account.
Consumer in another account has s3:GetObject.
But lacks kms:Decrypt on KMS key.
Result: S3 access fails with KMS-related AccessDenied.
```

---

## 29. Multi-Region KMS Keys

Multi-region KMS keys allow related keys in different regions with same key ID and shared key material properties for certain use cases.

Use when:

- application has active-active multi-region architecture,
- encrypted data must be decrypted in another region,
- disaster recovery requires region-independent decrypt capability.

Do not use just because “multi-region sounds better”.

Questions:

```text
1. Is data replicated cross-region?
2. Must ciphertext be decryptable in target region without calling source region?
3. Are IAM/key policies aligned in both regions?
4. Does app metadata store key ARN or multi-region key reference correctly?
5. What happens during regional isolation?
```

If the rest of the system is single-region, multi-region key can add complexity without benefit.

---

## 30. KMS in Regulated Case Management Systems

For regulatory/case-management platforms, KMS design must support audit and defensibility.

Example data classes:

```text
case metadata
submitted documents
appeal evidence
correspondence
payment records
audit trail
investigation notes
screening results
```

Possible key partition:

```text
alias/prod/aceas/case/default
alias/prod/aceas/document/restricted
alias/prod/aceas/correspondence/default
alias/prod/aceas/audit/log-integrity
alias/prod/aceas/secrets/default
```

Authorization principle:

```text
The ability to read an S3 object or DB row should not automatically imply the ability to decrypt the most sensitive data.
```

Audit principle:

```text
Decrypt operations for sensitive domains should be traceable to role, service, purpose, and context.
```

Operational principle:

```text
Disabling or rotating a key must have a documented impact map.
```

---

## 31. Domain-Level Encryption Context Design

A good encryption context is stable, non-secret, and authorization-relevant.

Example for document encryption:

```text
system=aceas
module=document-management
purpose=document-envelope-encryption
classification=restricted
environment=prod
```

Maybe include:

```text
caseType=appeal
agency=cea
```

Be careful with:

```text
caseId
applicantId
personId
email
nric
```

A useful pattern:

```text
Use non-sensitive context for KMS policy conditions.
Use sensitive identifiers in application metadata/audit with separate protection.
```

Do not make encryption context too dynamic if IAM policy depends on it. Policy explosion is real.

---

## 32. Auditability with CloudTrail

KMS cryptographic operations are auditable through CloudTrail, depending on event type and configuration.

For application engineer, logs should allow correlation:

```text
applicationRequestId
correlationId
awsRequestId
kmsKeyId or alias
operation type
business operation
resource id hash/reference
result
latency
retry count
```

Never log:

```text
plaintext
plaintext data key
secret value
token
raw decrypted payload
```

Recommended app log event:

```json
{
  "event": "kms.decrypt.completed",
  "correlationId": "9f0d...",
  "module": "document-management",
  "purpose": "document-envelope-decryption",
  "kmsKeyRef": "alias/prod/aceas/document/envelope",
  "latencyMs": 42,
  "attempt": 1,
  "result": "success"
}
```

For regulated systems, app audit and CloudTrail serve different purposes:

```text
CloudTrail: proves AWS API activity.
Application audit: proves business operation intent and domain actor.
```

You often need both.

---

## 33. Error Taxonomy for KMS

Common KMS errors and interpretation:

### 33.1 AccessDeniedException

Meaning:

```text
Principal is not authorized by IAM/key policy/grant/condition.
```

Action:

- do not blind retry,
- log sanitized context,
- check key policy and IAM policy,
- check encryption context condition,
- check cross-account resource policy.

### 33.2 NotFoundException

Meaning:

```text
Key not found, wrong region, wrong account, wrong alias, deleted key, or inaccessible key reference.
```

Action:

- validate region,
- validate key ARN/alias,
- check deployment config,
- fail-fast for startup config.

### 33.3 DisabledException

Meaning:

```text
Key exists but disabled.
```

Action:

- operational incident,
- do not bypass,
- escalate to key owner/security.

### 33.4 KMSInvalidStateException

Meaning:

```text
Key is not in state valid for requested operation.
```

Action:

- inspect key state,
- check pending deletion/import/unavailable.

### 33.5 InvalidCiphertextException

Meaning:

```text
Ciphertext blob invalid, wrong encryption context, corrupted metadata, or wrong key relationship.
```

Action:

- do not retry blindly,
- check metadata integrity,
- check encryption context mismatch,
- investigate possible data corruption or wrong object mapping.

### 33.6 ThrottlingException

Meaning:

```text
KMS request rate exceeded quota.
```

Action:

- retry with jitter,
- reduce concurrency,
- cache data keys if safe,
- reduce per-record KMS calls,
- request quota increase if justified.

---

## 34. KMS Failure Modelling

A robust Java system should define what happens when KMS fails.

### 34.1 Startup failure

If app cannot decrypt required startup config:

```text
Fail startup.
Do not run in partially configured state.
```

### 34.2 Runtime decrypt failure for optional data

If decrypt is needed only for optional feature:

```text
degrade feature
return controlled error
emit metric
preserve core availability if safe
```

### 34.3 Runtime decrypt failure for core transaction

If decrypt is required for transaction correctness:

```text
fail transaction
avoid partial side effects
allow retry at workflow level if transient
```

### 34.4 KMS throttling

If throttling occurs:

```text
slow down
queue
retry with jitter
avoid retry storm
surface health signal
```

### 34.5 Key disabled

If key disabled:

```text
security/ops incident
stop affected processing
preserve evidence
avoid fallback to weaker key without approved procedure
```

Never silently fallback to a different key for decrypt. That can corrupt security semantics.

---

## 35. Java Application Design Pattern: KmsGateway

Do not scatter raw `KmsClient` calls across business code.

Create a domain-aware gateway:

```text
Business Service
      |
      v
DomainEncryptionService
      |
      v
KmsGateway / EncryptionSdkGateway
      |
      v
AWS KMS
```

Responsibilities:

- build encryption context,
- validate context fields,
- call KMS/Encryption SDK,
- normalize errors,
- emit metrics,
- enforce timeout/retry config,
- redact logs,
- centralize key alias/ARN usage,
- support test doubles.

Example interface:

```java
public interface KmsEnvelopeGateway {
    GeneratedDataKey generateDataKey(EncryptionPurpose purpose, EncryptionScope scope);

    byte[] decryptDataKey(
            byte[] encryptedDataKey,
            EncryptionPurpose purpose,
            EncryptionScope scope
    );
}
```

Domain types:

```java
public enum EncryptionPurpose {
    DOCUMENT_ENVELOPE_ENCRYPTION,
    CASE_NOTE_ENCRYPTION,
    OUTBOUND_EVENT_ENCRYPTION
}

public record EncryptionScope(
        String system,
        String module,
        String classification,
        String environment
) {}
```

Avoid:

```java
Map<String, String> context = new HashMap<>();
context.put("whatever", userInput);
kms.decrypt(...);
```

Better:

```text
Context construction is typed, validated, and centralized.
```

---

## 36. Spring Boot Integration Pattern

Bean config:

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kms.KmsClient;

@Configuration
public class AwsKmsConfiguration {

    @Bean
    KmsClient kmsClient(AwsKmsProperties properties) {
        return KmsClient.builder()
                .region(Region.of(properties.region()))
                .build();
    }

    @Bean
    KmsEnvelopeGateway kmsEnvelopeGateway(
            KmsClient kmsClient,
            AwsKmsProperties properties
    ) {
        return new DefaultKmsEnvelopeGateway(kmsClient, properties.documentKeyId());
    }
}
```

Properties:

```java
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.aws.kms")
public record AwsKmsProperties(
        String region,
        String documentKeyId,
        String secretsKeyId
) {}
```

Config:

```yaml
app:
  aws:
    kms:
      region: ap-southeast-1
      document-key-id: arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234
      secrets-key-id: alias/prod/aceas/secrets/default
```

Add startup validation carefully:

```text
Validate key exists and is enabled using DescribeKey.
But do not perform decrypt of real secret just for health check.
```

Health check should not become KMS load generator.

---

## 37. Observability Metrics for KMS

Minimum metrics:

```text
kms.calls.total{operation,key,purpose,result}
kms.latency.ms{operation,key,purpose}
kms.errors.total{operation,key,errorCode}
kms.throttles.total{operation,key}
kms.retries.total{operation,key}
kms.cache.hit.total{purpose}       // if caching exists
kms.cache.miss.total{purpose}
kms.data_key.generated.total{purpose}
kms.decrypt_data_key.total{purpose}
```

Cardinality warning:

Do not put `caseId`, `documentId`, `userId`, or raw key ARN with many variants as high-cardinality metric label.

Use low-cardinality labels:

```text
module=document
purpose=envelope-decrypt
classification=restricted
env=prod
```

Log high-cardinality identifiers only in controlled structured logs if allowed.

---

## 38. Testing Strategy

### 38.1 Unit test

Mock gateway, not necessarily KMS client.

```java
class DocumentServiceTest {
    // mock KmsEnvelopeGateway
    // verify domain behavior without AWS dependency
}
```

### 38.2 Gateway unit test

Test:

- context construction,
- error mapping,
- key selection,
- no secret leakage in messages,
- invalid scope rejection.

### 38.3 Integration test

Use sandbox AWS or emulator with caution. KMS emulation may not fully match AWS authorization, key policy, and encryption semantics.

For real confidence, test in AWS sandbox:

```text
1. role can encrypt/decrypt with allowed context
2. role cannot decrypt with wrong context
3. role cannot use wrong key
4. missing IAM permission fails
5. disabled test key fails predictably
6. cross-account role behaves as expected
```

### 38.4 Policy test

Policy should be tested as artifact:

```text
Does app role have only required KMS actions?
Does key policy allow only intended principals?
Are kms:ViaService or encryption context conditions used where appropriate?
Are wildcard actions/resources justified?
```

---

## 39. Common Anti-Patterns

### 39.1 One god key for everything

```text
alias/prod/all-purpose-key
```

Problem:

- huge blast radius,
- audit meaningless,
- hard to revoke,
- over-permissioned roles.

### 39.2 KMS call per database row

Problem:

- high latency,
- high cost,
- quota exhaustion,
- retry storm.

### 39.3 Putting secrets in encryption context

Problem:

- context is not secret,
- can appear in logs/audit,
- leaks metadata.

### 39.4 Confusing SSE-KMS with end-to-end encryption

Problem:

- service still sees plaintext during processing,
- authorized consumers receive plaintext,
- not enough for some confidentiality boundaries.

### 39.5 Disabling/deleting key without data dependency map

Problem:

- irreversible data loss risk,
- production outage,
- failed audit.

### 39.6 Catching all KMS exceptions and returning null

Problem:

- data corruption,
- hidden security failures,
- impossible debugging.

### 39.7 Retrying AccessDenied

Problem:

- wastes capacity,
- hides policy bug,
- creates noisy logs.

### 39.8 Logging decrypted values for debugging

Problem:

- catastrophic leakage,
- compliance incident,
- logs become sensitive data store.

---

## 40. Design Example: Document Encryption for Case Management

Scenario:

```text
A regulatory case management system stores uploaded supporting documents in S3.
Documents are restricted.
Only document processing service may decrypt raw content.
Metadata service may list documents but not decrypt content.
Audit service records access.
```

### 40.1 Basic architecture

```text
Browser
  |
  | upload via app/backend or presigned URL
  v
Document Service
  |
  | envelope encrypt or S3 SSE-KMS
  v
S3 bucket: prod-case-documents
  |
  | event notification
  v
SQS: document-processing-events
  |
  v
Document Worker
  |
  | decrypt/process
  v
Audit Event Publisher
```

### 40.2 Option A: S3 SSE-KMS only

Flow:

```text
Document Service uploads plaintext to S3 over TLS with SSE-KMS header.
S3 encrypts at rest using KMS.
Document Worker gets object from S3 and receives plaintext.
```

Good when:

- S3 is trusted storage boundary,
- app services that can read object may see plaintext,
- simpler implementation needed.

Weakness:

- any principal with S3 get + KMS decrypt can retrieve plaintext,
- confidentiality is mostly IAM/S3/KMS policy controlled,
- object metadata and event payload may still reveal info.

### 40.3 Option B: Client-side envelope encryption

Flow:

```text
Document Service calls GenerateDataKey.
Document Service encrypts file stream locally.
Document Service uploads encrypted bytes to S3.
S3 may also use SSE-KMS as defense-in-depth.
Worker downloads encrypted object.
Worker calls KMS Decrypt for encrypted data key.
Worker decrypts locally.
```

Good when:

- storage should never hold plaintext,
- downstream access is segmented,
- audit of decrypt is critical,
- documents have high sensitivity.

Weakness:

- more complex,
- streaming encryption must be robust,
- key metadata must be preserved,
- rotation and reprocessing more complex.

### 40.4 Recommended invariant

```text
Every stored encrypted document must have:
- ciphertext object
- encrypted data key
- key id/key arn
- encryption algorithm/version
- encryption context version
- content checksum
- object version id if S3 versioning enabled
- creation audit event
```

### 40.5 Failure handling

```text
If GenerateDataKey fails:
  upload must not happen.

If local encryption fails:
  abort upload / delete partial object / mark failed.

If S3 upload succeeds but metadata save fails:
  object becomes orphan candidate; cleanup job required.

If metadata save succeeds but event publish fails:
  outbox or retry required.

If decrypt fails with InvalidCiphertext:
  quarantine and alert; do not retry forever.
```

---

## 41. Java Version Considerations: 8 to 25

### Java 8

- AWS SDK 2.x supports Java 8+.
- No records, no var, no modern switch.
- More verbose DTOs.
- Be careful with old TLS/provider settings.
- Lambda Java 8 may be legacy depending on runtime lifecycle; validate before new build.

### Java 11

- Better baseline than 8 for many enterprise systems.
- Still lacks records unless using later versions.
- Good migration stepping stone.

### Java 17

- Strong current enterprise LTS baseline.
- Records and sealed classes useful for domain modelling.
- Good Lambda runtime support historically.

### Java 21

- Strong modern baseline.
- Virtual threads may help app concurrency, but KMS is remote dependency; do not use virtual threads to generate unbounded KMS pressure.
- Better language ergonomics.

### Java 25

- Newer LTS generation.
- Use modern language features carefully if deployment/runtime supports them.
- Validate Lambda/runtime/container base image compatibility.

Important principle:

```text
Newer Java can make code cleaner and runtime stronger,
but it does not remove AWS quota, IAM, KMS latency, or cryptographic lifecycle constraints.
```

---

## 42. Production Readiness Checklist

### Key governance

- [ ] Key ownership defined.
- [ ] Alias naming convention defined.
- [ ] Key purpose documented.
- [ ] Rotation policy defined.
- [ ] Deletion policy requires approval.
- [ ] Key dependency map maintained.

### IAM and key policy

- [ ] App role has least privilege.
- [ ] Key policy allows only intended principals/accounts.
- [ ] Cross-account access tested.
- [ ] Conditions used where useful.
- [ ] Wildcards justified.
- [ ] Grants understood.

### Application design

- [ ] KMS calls centralized behind gateway.
- [ ] Encryption context standardized.
- [ ] No secrets in encryption context.
- [ ] Direct encrypt only for small payloads.
- [ ] Envelope encryption used for large/high-volume payloads.
- [ ] Plaintext data key lifetime minimized.

### Resilience

- [ ] KMS timeouts configured.
- [ ] Retry strategy has jitter/backoff.
- [ ] AccessDenied is not retried blindly.
- [ ] Throttling has concurrency/rate mitigation.
- [ ] Startup dependency behavior explicit.
- [ ] Key disabled behavior documented.

### Observability

- [ ] KMS latency metric.
- [ ] KMS error metric.
- [ ] Throttling alarm.
- [ ] Audit correlation ID.
- [ ] AWS request ID captured when possible.
- [ ] No plaintext in logs.

### Cost and quota

- [ ] KMS request volume estimated.
- [ ] Burst scenario modelled.
- [ ] Lambda concurrency impact modelled.
- [ ] S3 SSE-KMS impact modelled.
- [ ] Data key caching considered only with security thresholds.
- [ ] Quota increase process known.

### Testing

- [ ] Unit tests for domain gateway.
- [ ] Policy tests/reviews.
- [ ] Sandbox AWS integration tests.
- [ ] Wrong context decrypt test.
- [ ] Wrong principal test.
- [ ] Disabled key test if feasible.

---

## 43. Decision Framework

When deciding how to use KMS, walk through this sequence:

```text
1. What data needs protection?
2. What is the confidentiality boundary?
3. Is server-side encryption enough?
4. Is client-side encryption required?
5. Who may encrypt?
6. Who may decrypt?
7. What context must be bound to cryptographic operation?
8. What key partition gives acceptable blast radius?
9. What is expected request volume?
10. What happens when KMS is unavailable/throttled/denied?
11. How will usage be audited?
12. How will key rotation/revocation/deletion be handled?
```

If a design cannot answer these, it is not production-ready.

---

## 44. Top 1% Mental Model Summary

A strong engineer does not say:

```text
We encrypted it with KMS, so it's secure.
```

A strong engineer says:

```text
We use KMS as the cryptographic authorization boundary.
This key protects this data class.
This role can encrypt.
This narrower role can decrypt.
The encryption context binds the operation to module and purpose.
The app does not call KMS per row.
KMS usage is observable.
Throttling is modeled.
Key rotation and deletion have runbooks.
Cross-account access is explicitly tested.
CloudTrail and app audit can reconstruct usage.
Plaintext key material has bounded lifetime.
```

That is the difference between “using KMS” and engineering a defensible secure system.

---

## 45. Practical Exercises

### Exercise 1 — Key boundary design

Design KMS aliases for:

```text
- document archive
- application secrets
- SQS case event queue
- audit export bucket
- confidential appeal attachments
```

Define whether each should use one shared key or separate keys.

### Exercise 2 — Encryption context

Create encryption context schema for document encryption.

Reject fields that are sensitive or too high-cardinality.

### Exercise 3 — IAM and key policy

Write policy requirements for:

```text
Document uploader role:
- can generate data key
- cannot decrypt existing document data keys

Document processor role:
- can decrypt document data keys
- can generate data key only if it creates derived encrypted output

Metadata service role:
- cannot decrypt document content
```

### Exercise 4 — Failure modelling

Define behavior for:

```text
- KMS AccessDenied
- KMS InvalidCiphertext
- KMS Throttling
- KMS key disabled
- wrong region config
- missing key alias
```

### Exercise 5 — Observability

Define metrics and log fields for KMS operations without leaking sensitive data.

---

## 46. References

- AWS KMS Developer Guide: KMS concepts, keys, policies, encryption context, grants, quotas, and throttling.
- AWS SDK for Java 2.x KMS examples.
- AWS Encryption SDK Developer Guide: envelope encryption, Java usage, data key caching.
- Amazon S3 SSE-KMS documentation.
- AWS KMS API Reference: `GenerateDataKey`, `Decrypt`, `Encrypt`, `ReEncrypt`.

---

## 47. Closing

KMS is one of the most important services for secure Java systems on AWS. But the point is not merely to turn on encryption. The real engineering challenge is to decide where encryption boundary lives, who can cross it, what metadata is cryptographically bound to it, how it behaves under failure, and how usage is proven later.

In the next part, we move from cryptographic boundary to messaging reliability boundary: **SQS Fundamentals — Queue as Reliability Boundary**.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-11-secrets-manager-and-ssm-parameter-store.md">⬅️ Part 11 — Secrets Manager and SSM Parameter Store</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-13-sqs-fundamentals-queue-as-reliability-boundary.md">Part 13 — SQS Fundamentals: Queue as Reliability Boundary ➡️</a>
</div>
