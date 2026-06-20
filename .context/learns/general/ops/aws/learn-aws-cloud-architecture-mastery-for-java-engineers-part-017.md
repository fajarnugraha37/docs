# learn-aws-cloud-architecture-mastery-for-java-engineers-part-017.md

# Part 017 — Security Architecture II: KMS, Policy Composition, Cross-Account Access, dan Data Protection

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS pada level desain produksi, security boundary, compliance defensibility, dan failure modelling.  
> Fokus part ini: advanced security architecture di AWS, terutama AWS KMS, policy composition, cross-account access, data protection, dan cara menghindari desain yang secara teori terenkripsi tetapi secara operasional rapuh.

---

## 0. Kenapa Part Ini Penting

Di banyak sistem AWS, security gagal bukan karena engineer tidak tahu bahwa data harus dienkripsi. Security sering gagal karena:

1. **key policy tidak sinkron dengan IAM policy**;
2. **resource policy membuka akses lebih luas dari yang dipahami**;
3. **cross-account access didesain tanpa model trust yang eksplisit**;
4. **data terenkripsi tetapi restore tidak pernah diuji**;
5. **KMS key di-disable, dihapus, atau tidak bisa dipakai oleh service yang membutuhkan**;
6. **log audit ada, tetapi tidak cukup menjawab “siapa mengakses data apa, kapan, dan lewat boundary apa”**;
7. **policy terlalu permisif karena debugging `AccessDenied` dilakukan dengan menambah wildcard**;
8. **tenant/data classification tidak tercermin di key, bucket, table, role, dan audit design**.

Part 016 sudah membangun lapisan security pertama: identity, network isolation, encryption, secrets, detective controls, dan threat modeling. Part 017 masuk lebih dalam ke area yang sering menjadi pembeda antara engineer biasa dan engineer senior/staff: **mengomposisikan kontrol keamanan AWS lintas service, account, policy, key, data, dan workload**.

Security AWS yang matang bukan hanya bertanya:

> “Apakah data terenkripsi?”

Tetapi bertanya:

> “Siapa yang bisa memicu decrypt? Lewat service apa? Dari account mana? Dengan role apa? Dalam konteks data apa? Apakah akses itu bisa diaudit? Apakah akses itu bisa dipulihkan saat incident? Apakah key bisa membuat restore gagal? Apakah policy boundary tetap benar saat workload dipindah account atau region?”

---

## 1. Mental Model: Security AWS adalah Komposisi Policy, Identity, Resource, dan Cryptographic Boundary

Dalam aplikasi tradisional, security sering dibayangkan sebagai lapisan aplikasi:

```text
User -> API -> Authorization -> Database
```

Di AWS, security harus dibaca sebagai komposisi beberapa sistem:

```text
Principal
  -> identity policy
  -> session policy
  -> permissions boundary
  -> SCP
  -> resource policy
  -> VPC endpoint policy
  -> KMS key policy
  -> KMS grant
  -> service-specific authorization
  -> data operation
```

Tidak semua request melewati semua lapisan. Tetapi untuk resource sensitif, beberapa lapisan ini sering aktif bersamaan.

Contoh sederhana: aplikasi Java di ECS ingin membaca object S3 terenkripsi SSE-KMS.

Yang harus benar:

1. ECS task role boleh `s3:GetObject` ke bucket/key tertentu.
2. Bucket policy tidak menolak request tersebut.
3. Jika bucket policy membatasi VPC endpoint, request harus datang via endpoint yang benar.
4. Object terenkripsi dengan KMS key yang bisa digunakan task role.
5. KMS key policy mengizinkan task role, atau mengizinkan account memakai IAM policy untuk key tersebut.
6. IAM policy task role mengizinkan `kms:Decrypt` untuk key tersebut.
7. Jika ada SCP, SCP tidak memblokir S3/KMS action.
8. Jika ada encryption context condition, context harus cocok.
9. Jika ada session policy, session tidak mempersempit akses sampai gagal.
10. Jika cross-account, kedua sisi account harus mengizinkan.

Satu `AccessDenied` bisa berasal dari banyak titik. Engineer top tidak menebak. Ia membangun model evaluasi.

---

## 2. AWS KMS: Bukan “Tempat Menyimpan Key”, tetapi Authorization Boundary untuk Cryptographic Use

AWS KMS sering disalahpahami sebagai storage key biasa. Mental model yang lebih tepat:

> AWS KMS adalah managed cryptographic control plane yang mengontrol siapa boleh menggunakan key untuk operasi kriptografis, bukan hanya siapa boleh melihat metadata key.

KMS key dipakai oleh banyak AWS service:

- S3 SSE-KMS;
- EBS encryption;
- RDS/Aurora encryption;
- DynamoDB encryption;
- CloudWatch Logs encryption;
- SQS/SNS encryption;
- Secrets Manager;
- Lambda environment variable encryption;
- application-level envelope encryption.

Tetapi model akses KMS unik karena ada beberapa jenis permission:

| Kategori | Contoh action | Makna |
|---|---|---|
| Key administration | `kms:CreateKey`, `kms:ScheduleKeyDeletion`, `kms:PutKeyPolicy`, `kms:EnableKeyRotation` | Mengelola lifecycle key |
| Key usage | `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`, `kms:ReEncrypt*` | Menggunakan key untuk operasi data |
| Grant management | `kms:CreateGrant`, `kms:RetireGrant`, `kms:RevokeGrant` | Memberi izin sementara/terbatas ke service/principal |
| Metadata/read | `kms:DescribeKey`, `kms:ListAliases` | Membaca informasi key |

Kesalahan umum: mencampur admin key dan user key.

Role yang bisa mengelola key tidak otomatis seharusnya bisa decrypt data. Sebaliknya, workload yang bisa decrypt data tidak seharusnya bisa mengubah key policy.

---

## 3. KMS Key Policy: Resource Policy yang Selalu Ada

Setiap KMS key memiliki **key policy**. Ini berbeda dari banyak resource AWS lain di mana resource policy opsional. Pada KMS, key policy adalah kontrol utama.

Ada dua pendekatan besar:

### 3.1 Key Policy yang Mendelegasikan ke IAM Account

Pola umum:

```json
{
  "Sid": "EnableIAMUserPermissions",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111122223333:root"
  },
  "Action": "kms:*",
  "Resource": "*"
}
```

Ini sering membingungkan. `arn:aws:iam::<account-id>:root` di sini bukan berarti hanya root user. Ini merepresentasikan account principal, yang memungkinkan IAM policies dalam account tersebut mengatur akses ke key.

Implikasi:

- key policy membuka jalan bagi IAM policy di account itu;
- IAM role/user tetap butuh IAM permission sesuai action;
- tanpa statement seperti ini, IAM policy saja bisa tidak cukup.

### 3.2 Key Policy yang Langsung Menyebut Principal

Contoh:

```json
{
  "Sid": "AllowSpecificApplicationRoleToUseKey",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111122223333:role/prod-case-api-task-role"
  },
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey"
  ],
  "Resource": "*"
}
```

Keunggulan:

- sangat eksplisit;
- mudah diaudit;
- mengurangi ketergantungan pada IAM policy liar.

Kelemahan:

- sulit dikelola jika banyak role;
- bisa membesar dan sulit dipromosikan lintas environment;
- role replacement bisa membuat policy stale.

### 3.3 Pola yang Lebih Mapan

Untuk organisasi matang:

1. gunakan account-level delegation untuk role security/platform yang dipercaya;
2. gunakan key admin role terpisah dari key usage role;
3. gunakan IAM policy untuk workload role yang spesifik;
4. gunakan condition untuk membatasi service/context;
5. audit CloudTrail untuk KMS usage;
6. jangan biarkan application role punya `kms:PutKeyPolicy`, `kms:ScheduleKeyDeletion`, atau `kms:DisableKey`.

---

## 4. Key Admin vs Key User

Pisahkan dua peran:

```text
Key Administrator
  - boleh mengelola policy, rotation, alias, grant, deletion schedule
  - tidak otomatis boleh decrypt application data

Key User
  - boleh Encrypt/Decrypt/GenerateDataKey untuk workload tertentu
  - tidak boleh mengubah lifecycle/policy key
```

Contoh pembagian:

| Role | Permission |
|---|---|
| `security-kms-admin-role` | manage key policy, rotation, alias, deletion guardrail |
| `prod-case-api-task-role` | decrypt/generate data key untuk data case API |
| `prod-evidence-worker-role` | decrypt evidence object tertentu |
| `break-glass-security-role` | emergency decrypt dengan approval dan audit ketat |
| `ci-deploy-role` | biasanya tidak perlu decrypt production data |

Kesalahan fatal:

```json
{
  "Effect": "Allow",
  "Action": "kms:*",
  "Resource": "*"
}
```

pada application runtime role.

Ini membuat aplikasi yang terkompromi berpotensi mengubah/mematikan key, membuat grant, atau membuka akses lebih luas.

---

## 5. Envelope Encryption: Cara Berpikir yang Benar

Untuk data besar, AWS dan banyak aplikasi tidak mengenkripsi semua data langsung dengan KMS key. Biasanya digunakan **envelope encryption**.

Mental model:

```text
KMS key / wrapping key
        |
        | GenerateDataKey
        v
Data key plaintext  ---- encrypt actual data ----> ciphertext data
Data key encrypted  -----------------------------> stored with ciphertext
```

Saat decrypt:

```text
stored encrypted data key
        |
        | KMS Decrypt
        v
plaintext data key ---- decrypt ciphertext data ----> plaintext data
```

Kenapa ini penting?

1. KMS tidak perlu memproses payload besar.
2. Data key bisa unique per object/item/file.
3. Audit KMS tetap merekam operasi decrypt/generate data key.
4. Akses decrypt bisa dikontrol lewat KMS policy.
5. Data tetap tidak bisa dibuka jika encrypted data key tidak bisa didecrypt.

Banyak AWS service menggunakan pola ini di balik layar ketika memakai SSE-KMS.

---

## 6. Encryption Context: Context sebagai AAD dan Audit Signal

Encryption context adalah pasangan key-value non-secret yang ikut digunakan sebagai additional authenticated data dalam operasi KMS symmetric encryption.

Contoh context:

```text
tenantId=TNT-123
caseId=CASE-2026-00091
dataClass=CONFIDENTIAL
domain=ENFORCEMENT_CASE
```

Manfaat:

1. decrypt hanya berhasil jika context cocok dengan context saat encrypt;
2. context muncul di CloudTrail sehingga membantu audit;
3. policy condition dapat membatasi penggunaan key berdasarkan context;
4. membantu membedakan penggunaan key lintas domain/tenant.

Contoh condition konseptual:

```json
{
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "kms:EncryptionContext:domain": "ENFORCEMENT_CASE"
    }
  }
}
```

Jangan masukkan secret ke encryption context karena context tidak dirancang sebagai data rahasia.

---

## 7. KMS Grants: Permission Terbatas untuk Service atau Workflow

KMS grant adalah mekanisme untuk memberikan permission penggunaan key kepada principal, sering dipakai AWS service untuk operasi tertentu.

Grant berguna ketika:

- service perlu menggunakan key atas nama user/workload;
- permission perlu dibuat secara programatik;
- permission perlu dibatasi dengan constraint;
- permission lifecycle berbeda dari key policy utama.

Contoh kasus:

- encrypted EBS volume untuk EC2/Auto Scaling;
- RDS menggunakan customer managed KMS key;
- AWS service membuat grant agar bisa attach/encrypt/decrypt resource terkait.

Risiko:

- terlalu banyak grant yang tidak dipahami;
- grant tidak dicabut saat workload pensiun;
- role bisa `kms:CreateGrant` terlalu luas;
- grant memberi jalan akses yang tidak terlihat jika hanya membaca IAM policy.

Prinsip:

1. batasi `kms:CreateGrant`;
2. gunakan condition `kms:GrantIsForAWSResource` jika grant hanya untuk AWS service;
3. audit grant untuk key sensitif;
4. pahami bahwa grant bisa memberi akses meskipun policy tampak sempit.

---

## 8. Policy Composition: Membaca Access sebagai Intersection dan Union yang Tidak Selalu Intuitif

Untuk resource sensitif, hasil authorization bukan hanya satu policy.

### 8.1 Identity Policy

Menjawab:

> Principal ini boleh melakukan action apa terhadap resource apa?

Contoh:

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::prod-case-documents/*"
}
```

### 8.2 Resource Policy

Menjawab:

> Resource ini mengizinkan principal mana melakukan action apa?

Contoh S3 bucket policy, SQS queue policy, SNS topic policy, KMS key policy, Secrets Manager resource policy.

### 8.3 SCP

Menjawab:

> Dalam account/OU ini, action apa yang secara organisasi boleh terjadi?

SCP tidak memberikan allow langsung. SCP membatasi maksimum permission yang bisa diberikan IAM/resource policy.

### 8.4 Permissions Boundary

Menjawab:

> Role/user ini maksimum boleh punya permission apa, meskipun identity policy-nya lebih luas?

Sering dipakai untuk delegated administration.

### 8.5 Session Policy

Menjawab:

> Temporary session ini dipersempit menjadi apa?

Sering dipakai saat `AssumeRole`.

### 8.6 VPC Endpoint Policy

Menjawab:

> Request ke AWS service melalui endpoint ini boleh melakukan apa?

Endpoint policy tidak menggantikan IAM/resource policy. Ia menjadi filter tambahan pada jalur network private endpoint.

### 8.7 KMS Key Policy

Menjawab:

> Key ini boleh dipakai oleh siapa untuk operasi kriptografis apa?

Untuk data terenkripsi KMS, resource access saja belum cukup. Decrypt/generate data key juga harus allowed.

---

## 9. Cara Debug AccessDenied secara Sistematis

Jangan mulai dengan menambah `*`.

Gunakan urutan investigasi:

### 9.1 Identifikasi Principal Aktual

Di aplikasi Java, panggil `sts:GetCallerIdentity` saat debugging environment non-prod.

Pertanyaan:

- role apa yang benar-benar dipakai?
- apakah role dari ECS task role atau execution role?
- apakah Lambda execution role yang benar?
- apakah local developer credential salah profile?
- apakah CI/CD assume role ke account yang salah?

### 9.2 Identifikasi Action dan Resource Aktual

AccessDenied sering terjadi karena action berbeda dari yang dipikirkan.

Contoh:

- S3 upload SSE-KMS butuh `kms:GenerateDataKey`, bukan hanya `s3:PutObject`.
- S3 download SSE-KMS butuh `kms:Decrypt`, bukan hanya `s3:GetObject`.
- DynamoDB query GSI butuh resource ARN index.
- Lambda publish version berbeda dari update function code.
- ECS service deployment butuh `iam:PassRole` untuk role tertentu.

### 9.3 Cek Identity Policy

Apakah role punya allow?

### 9.4 Cek Explicit Deny

Explicit deny bisa datang dari:

- SCP;
- identity policy;
- resource policy;
- permission boundary;
- session policy;
- endpoint policy;
- service-specific policy.

### 9.5 Cek Resource Policy

Untuk S3/SQS/SNS/KMS/Secrets Manager, cek apakah resource policy mengizinkan atau menolak.

### 9.6 Cek KMS

Jika resource terenkripsi SSE-KMS, cek:

- key ARN benar?
- region key sama?
- key enabled?
- key policy mengizinkan?
- IAM policy mengizinkan?
- grant dibutuhkan?
- encryption context condition cocok?

### 9.7 Cek Network/Endpoint Policy

Jika memakai VPC endpoint:

- request benar-benar lewat endpoint?
- private DNS aktif?
- endpoint policy mengizinkan?
- bucket policy mensyaratkan endpoint tertentu?

### 9.8 Cek CloudTrail

CloudTrail dapat menunjukkan:

- principal ARN;
- source IP/VPC endpoint;
- event name;
- error code;
- KMS key id;
- encryption context;
- request parameters tertentu.

---

## 10. Cross-Account Access: Dua Account Harus Mengizinkan

Untuk cross-account access, pikirkan dua sisi:

```text
Requesting account / trusted account
  - principal punya identity permission
  - session policy tidak memblokir
  - SCP tidak memblokir

Resource account / trusting account
  - resource policy/key policy/trust policy mengizinkan principal
  - SCP resource account tidak memblokir service action terkait
```

AWS IAM cross-account evaluation pada dasarnya membutuhkan izin dari kedua account: account tempat principal berasal dan account tempat resource berada.

### 10.1 AssumeRole Cross-Account

Pattern umum:

```text
Developer/CI role in Account A
        |
        | sts:AssumeRole
        v
DeploymentRole in Account B
        |
        | operate resources in Account B
        v
ECS/Lambda/RDS/S3/etc
```

Dibutuhkan:

1. identity policy di Account A memperbolehkan `sts:AssumeRole` ke role Account B;
2. trust policy role Account B mempercayai principal Account A;
3. permission policy role Account B memperbolehkan action yang dibutuhkan;
4. SCP di kedua account tidak memblokir.

### 10.2 Resource-Based Cross-Account

Beberapa service mendukung resource policy, misalnya:

- S3 bucket policy;
- SQS queue policy;
- SNS topic policy;
- EventBridge bus policy;
- Secrets Manager resource policy;
- KMS key policy.

Pattern:

```text
Role in Account A -> directly access Resource in Account B
```

Ini berguna, tetapi harus sangat hati-hati.

Risiko:

- sulit memahami semua principal yang punya akses;
- principal deletion/recreation dapat membuat referensi stale;
- wildcard account/principal terlalu luas;
- tidak ada session boundary role target seperti AssumeRole;
- akses data bisa melewati path aplikasi yang diharapkan.

### 10.3 KMS Cross-Account

Untuk KMS cross-account, umumnya butuh:

1. key policy di account pemilik key mengizinkan external account/principal;
2. IAM policy di external account mengizinkan action ke key ARN;
3. action termasuk daftar KMS operation yang mendukung cross-account;
4. service integration yang digunakan memang mendukung skenario tersebut.

Contoh kasus: Account A memiliki bucket S3 terenkripsi dengan KMS key di Account A, Account B role ingin membaca object.

Yang dibutuhkan:

- bucket policy mengizinkan Account B role `s3:GetObject`;
- KMS key policy mengizinkan Account B role/account untuk `kms:Decrypt`;
- IAM policy Account B role mengizinkan `s3:GetObject` dan `kms:Decrypt`;
- jika ada VPC endpoint restriction, jalur request cocok;
- jika ada encryption context condition, cocok.

---

## 11. S3 + SSE-KMS: Contoh Policy Composition yang Sering Membingungkan

S3 + KMS adalah kombinasi yang sangat umum dan sangat sering menyebabkan AccessDenied.

### 11.1 Upload Object dengan SSE-KMS

Untuk `PutObject` dengan SSE-KMS, principal biasanya membutuhkan:

- `s3:PutObject` ke object ARN;
- `kms:GenerateDataKey` ke KMS key;
- mungkin `kms:Encrypt` tergantung operasi/service path;
- bucket policy tidak menolak;
- key policy mengizinkan use key.

### 11.2 Download Object dengan SSE-KMS

Untuk `GetObject`, principal membutuhkan:

- `s3:GetObject`;
- `kms:Decrypt`;
- bucket/key policy cocok.

### 11.3 Bucket Policy yang Memaksa SSE-KMS

Contoh konseptual:

```json
{
  "Sid": "DenyPutObjectWithoutSpecificKmsKey",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::prod-case-documents/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234"
    }
  }
}
```

Kenapa explicit deny?

Karena kita ingin mencegah object baru ditulis tanpa key yang benar, bahkan jika role punya `s3:PutObject`.

### 11.4 Bucket Policy yang Membatasi VPC Endpoint

Contoh konseptual:

```json
{
  "Sid": "DenyAccessUnlessFromSpecificVpce",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::prod-case-documents",
    "arn:aws:s3:::prod-case-documents/*"
  ],
  "Condition": {
    "StringNotEquals": {
      "aws:SourceVpce": "vpce-1234567890abcdef0"
    }
  }
}
```

Risiko:

- console access bisa ikut terblokir;
- break-glass role bisa tidak bisa membaca saat incident;
- replication/service integration bisa gagal jika tidak dikecualikan;
- access dari CloudFront/origin access path bisa gagal jika condition tidak sesuai.

Engineer senior selalu menambahkan escape hatch yang diaudit, bukan membuka semua akses.

---

## 12. VPC Endpoint Policy: Network Path sebagai Security Filter

VPC endpoint policy mengontrol action yang boleh dilakukan melalui endpoint tertentu.

Contoh use case:

- private subnet hanya boleh mengakses bucket tertentu;
- workload di VPC tidak boleh memanggil S3 bucket random;
- endpoint untuk Secrets Manager hanya boleh membaca secret path tertentu;
- endpoint untuk STS hanya boleh assume role tertentu.

Tetapi endpoint policy bukan pengganti IAM.

Model:

```text
IAM allows action
AND resource policy allows action
AND endpoint policy allows action
AND no explicit deny
```

Failure mode:

1. IAM sudah benar, tetapi endpoint policy deny.
2. Endpoint policy `*`, tetapi bucket policy terlalu terbuka.
3. Bucket policy mensyaratkan endpoint, tetapi aplikasi resolve DNS ke public endpoint.
4. Endpoint dibuat di subnet/security group yang salah.
5. Cross-account access gagal karena endpoint policy hanya allow resource account lokal.

---

## 13. Data Classification sebagai Driver Key dan Policy Design

Security design tidak boleh dimulai dari service. Mulai dari data.

Contoh klasifikasi:

| Data class | Contoh | Protection |
|---|---|---|
| Public | public docs, marketing assets | integrity, availability |
| Internal | internal config non-secret | access restricted, encryption default |
| Confidential | case metadata, user details | strict IAM, SSE-KMS, audit |
| Restricted | evidence, legal docs, PII sensitive | dedicated key, object lock, least privilege, break-glass audit |
| Secret | credential, token, private key | Secrets Manager/KMS, rotation, no logging |

Dari klasifikasi, turunkan:

- bucket/table/database placement;
- KMS key per domain/class;
- retention/lifecycle;
- access role;
- audit event requirement;
- backup/restore protection;
- data deletion process;
- cross-region replication rule;
- tenant isolation model.

Anti-pattern:

> Semua data pakai satu `default-app-key` karena lebih mudah.

Masalahnya:

- sulit revoke per domain;
- blast radius decrypt terlalu besar;
- audit tidak granular;
- compliance evidence lemah;
- tenant/domain separation tidak nyata.

---

## 14. Key Granularity: Satu Key untuk Semua atau Banyak Key?

Tidak ada satu jawaban universal. Gunakan trade-off.

### 14.1 Satu Key per Account/Environment

Kelebihan:

- sederhana;
- mudah dikelola;
- lebih sedikit policy;
- cocok untuk non-prod atau data sensitivitas rendah.

Kekurangan:

- blast radius besar;
- audit kurang granular;
- sulit memisahkan domain/tenant;
- sulit revoke subset data.

### 14.2 Key per Data Domain

Contoh:

- `prod-case-metadata-key`;
- `prod-evidence-document-key`;
- `prod-audit-log-key`;
- `prod-secret-config-key`.

Kelebihan:

- cocok dengan data classification;
- audit lebih jelas;
- policy lebih spesifik;
- blast radius lebih kecil.

Kekurangan:

- lebih banyak IaC dan governance;
- service integration lebih kompleks;
- cross-account sharing perlu desain rapi.

### 14.3 Key per Tenant

Kelebihan:

- tenant isolation kuat;
- revoke per tenant mungkin;
- compliance/evidence kuat untuk tenant enterprise.

Kekurangan:

- operational overhead tinggi;
- quota/cost consideration;
- policy sprawl;
- onboarding/offboarding lebih kompleks;
- aplikasi harus tenant-aware untuk key selection.

Gunakan key per tenant hanya jika requirement isolation, compliance, atau contract benar-benar membutuhkannya.

---

## 15. Data Protection Lifecycle

Data protection bukan hanya encrypt saat write.

Siklus lengkap:

```text
Classify
  -> Collect
  -> Validate
  -> Encrypt
  -> Store
  -> Index
  -> Access
  -> Share
  -> Replicate
  -> Backup
  -> Restore
  -> Archive
  -> Delete
  -> Audit
```

Setiap tahap punya pertanyaan security.

### 15.1 Collect

- Apakah data perlu dikumpulkan?
- Apakah PII/minimization sudah dipikirkan?
- Apakah upload langsung ke S3 lebih aman daripada lewat app server?
- Apakah presigned URL dibatasi content type, size, key prefix, expiry?

### 15.2 Store

- KMS key apa yang dipakai?
- Apakah bucket policy enforce encryption?
- Apakah versioning aktif?
- Apakah Object Lock dibutuhkan?
- Apakah public access block aktif?

### 15.3 Access

- Role mana boleh access?
- Apakah access berbasis tenant/domain/case status?
- Apakah aplikasi melakukan authorization tambahan sebelum generate presigned URL?
- Apakah download dicatat sebagai business audit event?

### 15.4 Share

- Apakah sharing cross-account perlu?
- Apakah external partner diberi role assumption atau resource policy?
- Apakah data disalin ke bucket exchange?
- Apakah expiry/retention jelas?

### 15.5 Backup/Restore

- Apakah backup encrypted dengan key yang bisa direstore?
- Apakah key ikut tersedia di target region/account?
- Apakah restore role punya decrypt?
- Apakah restore diuji?

### 15.6 Delete

- Apakah deletion logical atau physical?
- Apakah Object Lock/legal hold mencegah delete?
- Apakah backup retention tetap menyimpan data?
- Apakah cryptographic erasure via key destruction acceptable/legal?

---

## 16. Backup, Restore, dan KMS: Jangan Sampai Backup Tidak Bisa Dipakai

Backup yang terenkripsi dengan KMS key bergantung pada key tersebut.

Failure scenario:

1. RDS snapshot encrypted dengan customer managed KMS key.
2. Key di-disable atau dijadwalkan deletion.
3. Beberapa bulan kemudian incident terjadi.
4. Tim mencoba restore snapshot.
5. Restore gagal karena key tidak tersedia/permission hilang.

Prinsip:

- key untuk backup harus punya lifecycle lebih panjang dari data retention;
- schedule key deletion harus sangat dikontrol;
- key policy harus mencakup restore role/break-glass role;
- cross-account backup membutuhkan sharing KMS key yang benar;
- cross-region restore membutuhkan key strategy di region tujuan;
- restore drill harus termasuk validasi decrypt.

Checklist restore:

```text
[ ] Snapshot/object backup ditemukan
[ ] KMS key masih enabled
[ ] Restore role punya permission decrypt
[ ] Target account/region punya permission yang benar
[ ] Network target tersedia
[ ] Application secret/config tersedia
[ ] Data integrity diverifikasi
[ ] Audit event tercatat
```

---

## 17. Immutable Logs dan Evidence Protection

Untuk regulated systems, log bukan hanya troubleshooting. Log bisa menjadi evidence.

Jenis log:

| Log | Tujuan |
|---|---|
| CloudTrail management event | siapa mengubah resource/control plane |
| CloudTrail data event | siapa membaca/menulis data tertentu |
| Application audit log | business action dan authorization decision |
| Access log | request-level traffic evidence |
| Security finding | threat/detection evidence |
| Workflow history | state transition evidence |

Protection pattern:

1. log dikirim ke dedicated log archive account;
2. write-only dari workload account;
3. read terbatas ke security/audit role;
4. S3 versioning aktif;
5. Object Lock jika butuh immutability;
6. SSE-KMS dengan key khusus audit log;
7. lifecycle ke archive tier;
8. CloudTrail organization trail;
9. Config rule untuk mendeteksi perubahan;
10. alarm untuk disable logging, delete trail, put bucket policy, schedule key deletion.

Jangan letakkan audit log penting di account aplikasi yang sama dengan admin aplikasi penuh. Itu membuat bukti terlalu mudah dimanipulasi oleh pihak yang sama yang diaudit.

---

## 18. Break-Glass Access: Emergency Access yang Aman dan Teraudit

Break-glass bukan wildcard permanen. Break-glass adalah mekanisme emergency yang:

1. jarang dipakai;
2. butuh approval;
3. MFA kuat;
4. time-bound;
5. scope-bound;
6. otomatis diaudit;
7. menghasilkan alert;
8. direview setelah digunakan.

Contoh role:

```text
prod-security-break-glass-role
```

Permission mungkin mencakup:

- read-only ke resource produksi tertentu;
- decrypt key tertentu;
- restore backup;
- inspect logs;
- disable compromised access path;
- bukan permission deploy aplikasi normal.

Controls:

- trust hanya dari IAM Identity Center group tertentu;
- session duration pendek;
- require MFA/context;
- CloudTrail alarm on AssumeRole;
- ticket/incident id sebagai session tag;
- post-incident review.

Anti-pattern:

- root user dipakai sebagai break-glass rutin;
- admin role permanen tanpa alert;
- shared password vault tanpa attribution;
- emergency access tidak pernah diuji.

---

## 19. Session Tags dan ABAC untuk Context-Aware Access

Attribute-Based Access Control (ABAC) menggunakan tag/attribute untuk membuat authorization lebih dinamis.

Contoh:

- principal punya tag `department=investigation`;
- session punya tag `tenant=TNT-123`;
- resource punya tag `tenant=TNT-123`;
- policy memperbolehkan akses hanya jika tag cocok.

Policy konseptual:

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::tenant-documents/*",
  "Condition": {
    "StringEquals": {
      "aws:PrincipalTag/tenant": "${s3:ExistingObjectTag/tenant}"
    }
  }
}
```

Manfaat:

- mengurangi policy per tenant;
- cocok untuk delegated access;
- session context bisa membawa ticket/tenant/project.

Risiko:

- tag governance harus kuat;
- siapa boleh set tag menjadi kritis;
- resource tagging harus konsisten;
- debugging lebih kompleks;
- tidak semua service/action mendukung condition key yang sama.

Untuk regulated system, ABAC harus dipakai dengan hati-hati dan diuji secara eksplisit.

---

## 20. Service-Linked Role dan Service Principal

Banyak AWS service beroperasi menggunakan service-linked role atau service principal.

Contoh:

```text
elasticloadbalancing.amazonaws.com
rds.amazonaws.com
ecs-tasks.amazonaws.com
lambda.amazonaws.com
autoscaling.amazonaws.com
```

Security implication:

- kadang resource policy harus mengizinkan service principal;
- confused deputy risk perlu dikontrol dengan `aws:SourceArn` dan `aws:SourceAccount`;
- KMS key policy perlu mengizinkan service menggunakan key;
- `iam:PassRole` harus dibatasi agar user tidak bisa memberikan role powerful ke service.

Contoh confused deputy mitigation konseptual:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudtrail.amazonaws.com"
  },
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::org-cloudtrail-logs/AWSLogs/111122223333/*",
  "Condition": {
    "StringEquals": {
      "aws:SourceAccount": "111122223333"
    },
    "ArnLike": {
      "aws:SourceArn": "arn:aws:cloudtrail:*:111122223333:trail/*"
    }
  }
}
```

---

## 21. `iam:PassRole`: Salah Satu Permission Paling Berbahaya

`iam:PassRole` memungkinkan principal memberikan role ke AWS service.

Contoh:

- developer membuat Lambda dengan execution role tertentu;
- CI/CD membuat ECS service dengan task role tertentu;
- user menjalankan EC2 dengan instance profile tertentu;
- Batch job memakai job role tertentu.

Bahaya:

Jika user tidak punya permission langsung ke S3 secret bucket, tetapi punya `iam:PassRole` ke role yang punya akses bucket, ia bisa membuat Lambda/EC2/ECS task yang memakai role tersebut dan membaca data.

Batasi:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": [
    "arn:aws:iam::111122223333:role/prod-ecs-task-role-*"
  ],
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "ecs-tasks.amazonaws.com"
    }
  }
}
```

Prinsip:

1. jangan allow `iam:PassRole` ke `*`;
2. batasi role prefix/path;
3. batasi service target;
4. audit role yang bisa di-pass;
5. jangan campur deploy role dengan admin IAM penuh.

---

## 22. Data Sharing Patterns

### 22.1 Copy-Based Sharing

```text
Source bucket -> curated/export bucket -> partner/account reads export
```

Kelebihan:

- clear boundary;
- bisa sanitize/minimize data;
- lifecycle terpisah;
- audit lebih mudah.

Kekurangan:

- duplikasi data;
- consistency delay;
- storage cost.

### 22.2 Direct Resource Policy Sharing

```text
Partner role -> source bucket/table/queue
```

Kelebihan:

- tidak perlu copy;
- real-time;
- sederhana untuk volume kecil.

Kekurangan:

- blast radius lebih besar;
- source policy kompleks;
- sulit revoke subset;
- audit harus matang.

### 22.3 AssumeRole Access

```text
Partner principal -> assume role in owner account -> access curated resources
```

Kelebihan:

- owner account mengontrol session role;
- bisa gunakan session duration/tag/external id;
- audit principal dan role assumption jelas;
- lebih cocok untuk controlled partner integration.

Kekurangan:

- lebih banyak setup;
- partner harus support STS.

### 22.4 Presigned URL

Cocok untuk temporary object access.

Risiko:

- URL bearer-token style;
- siapa pun yang punya URL bisa memakai sampai expiry;
- revocation tidak selalu sederhana;
- harus pendek expiry dan terikat ke authorization aplikasi.

---

## 23. Secrets dan KMS: Jangan Salah Memisahkan Secret dan Encrypted Data

Secrets Manager menyimpan secret dan menggunakan KMS untuk encryption at rest. Tetapi secret access control tetap butuh:

- Secrets Manager resource policy/IAM policy;
- KMS decrypt permission jika customer managed key;
- rotation policy;
- application-level caching;
- audit.

Perbedaan:

| Item | Secret | Encrypted application data |
|---|---|---|
| Contoh | DB password, API token | document, evidence, case note |
| Rotasi | sering wajib | tidak selalu |
| Akses | runtime app/service | app/user/business flow |
| Audit | secret read critical | data read critical |
| Storage | Secrets Manager/Parameter Store | S3/RDS/DynamoDB/etc |

Anti-pattern:

- menyimpan dokumen terenkripsi sebagai secret;
- menyimpan token di environment variable plaintext;
- memberi semua service akses ke semua secret;
- tidak membedakan secret non-prod dan prod;
- tidak mengaudit secret read spikes.

---

## 24. Java Application Design: KMS dan Data Protection di Level Aplikasi

Sebagian besar aplikasi Java cukup menggunakan encryption yang disediakan service AWS: S3 SSE-KMS, RDS encryption, DynamoDB encryption, Secrets Manager, dan sebagainya.

Tetapi ada kasus di mana application-level encryption diperlukan:

- field-level encryption untuk data sangat sensitif;
- multi-tenant encryption context;
- data harus tetap terenkripsi bahkan terhadap database admin;
- selective decrypt berdasarkan business authorization;
- data dikirim keluar AWS boundary.

### 24.1 Pattern: Service-Managed Encryption

```text
Java App -> S3 PutObject with SSE-KMS -> S3/KMS handle envelope encryption
```

Kelebihan:

- sederhana;
- integrasi native;
- audit KMS;
- performa baik.

Kekurangan:

- aplikasi mempercayai service layer;
- granularitas context tergantung service;
- field-level control terbatas.

### 24.2 Pattern: Application-Level Envelope Encryption

```text
Java App -> GenerateDataKey(KMS, context)
         -> encrypt field/file locally
         -> store ciphertext + encrypted data key + context metadata
```

Kelebihan:

- kontrol granular;
- bisa field-level;
- context domain/tenant eksplisit;
- database hanya melihat ciphertext.

Kekurangan:

- kompleks;
- risiko implementasi kriptografi salah;
- key rotation lebih rumit;
- testing dan migration lebih berat.

Gunakan AWS Encryption SDK jika membutuhkan application-level envelope encryption. Jangan merancang crypto format sendiri kecuali benar-benar memiliki expertise dan review kriptografi.

### 24.3 Java Pseudocode: GetCallerIdentity Guard

```java
StsClient sts = StsClient.create();
GetCallerIdentityResponse identity = sts.getCallerIdentity();
log.info("AWS runtime identity account={}, arn={}", identity.account(), identity.arn());
```

Jangan log ini terus-menerus di production high volume. Pakai saat startup/debugging dengan kontrol.

### 24.4 Java Pseudocode: S3 PutObject SSE-KMS

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

PutObjectRequest request = PutObjectRequest.builder()
    .bucket("prod-case-documents")
    .key("tenant/TNT-123/case/CASE-2026-00091/evidence/document.pdf")
    .serverSideEncryption(ServerSideEncryption.AWS_KMS)
    .ssekmsKeyId("arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234")
    .metadata(Map.of(
        "tenant-id", "TNT-123",
        "case-id", "CASE-2026-00091",
        "data-class", "RESTRICTED"
    ))
    .build();

s3.putObject(request, RequestBody.fromFile(Path.of("document.pdf")));
```

Catatan:

- metadata bukan authorization boundary;
- bucket policy harus enforce key;
- aplikasi tetap harus authorize user sebelum upload;
- object key jangan mengandung secret.

---

## 25. Key Rotation: Apa yang Sering Disalahpahami

KMS automatic key rotation untuk customer managed symmetric key merotasi key material, bukan mengganti key ID/ARN. Data lama tetap bisa didecrypt oleh key yang sama karena KMS menyimpan material lama yang dibutuhkan.

Tetapi ada beberapa jenis rotasi:

| Jenis | Makna |
|---|---|
| Automatic KMS rotation | key material baru, same key ID |
| Manual re-encryption | decrypt data lama lalu encrypt dengan key baru |
| Alias switch | alias menunjuk key baru untuk write baru |
| Secret rotation | credential diganti, bukan hanya dienkripsi ulang |

Jangan menganggap enable key rotation menyelesaikan semua masalah data lifecycle.

Pertanyaan desain:

- apakah compliance butuh re-encrypt data lama?
- apakah key compromise diasumsikan?
- apakah alias digunakan untuk write baru?
- apakah decrypt data lama masih harus mungkin?
- apakah key deletion schedule sinkron dengan retention?

---

## 26. Key Deletion dan Disable: Operasi Berisiko Tinggi

KMS key deletion punya waiting period. Tetapi disable key bisa langsung membuat data tidak bisa diakses.

Guardrail:

1. hanya security admin role yang boleh disable/schedule deletion;
2. CloudTrail alarm untuk `DisableKey`, `ScheduleKeyDeletion`, `PutKeyPolicy`, `CreateGrant`;
3. SCP deny deletion untuk production kecuali break-glass role;
4. Config rule / detective control;
5. backup restore drill;
6. runbook untuk accidental disable.

Production KMS key harus diperlakukan seperti critical infrastructure.

---

## 27. Multi-Region dan KMS

AWS KMS key bersifat regional, meskipun AWS juga memiliki multi-Region keys untuk skenario tertentu.

Pertanyaan desain multi-region:

- apakah data direplikasi cross-region?
- apakah key tersedia di region target?
- apakah alias naming konsisten?
- apakah application config memilih key berdasarkan region?
- apakah restore role di region target punya permission?
- apakah CloudTrail/audit di region target aktif?

Untuk DR, jangan hanya replikasi data. Replikasi juga:

- IAM roles/policies;
- KMS keys/aliases/policies;
- secrets/config;
- VPC endpoints;
- log/archive access;
- deployment pipeline;
- runbooks.

---

## 28. Regulated Case Management Platform: Security Design Example

Bayangkan sistem enforcement/case management dengan domain:

- case metadata;
- evidence documents;
- investigation notes;
- decisions;
- audit trail;
- external party submissions;
- internal review workflow.

### 28.1 Data Classification

| Domain | Classification | Storage | Key |
|---|---|---|---|
| Case metadata | Confidential | Aurora/RDS | `prod-case-db-key` |
| Evidence documents | Restricted | S3 | `prod-evidence-doc-key` |
| Audit log | Restricted/Immutable | S3 log archive | `prod-audit-log-key` |
| Secrets | Secret | Secrets Manager | `prod-secrets-key` |
| Public decisions | Public/Internal | S3/CloudFront | separate public bucket/key or SSE-S3 |
| Workflow state | Confidential | Step Functions/DynamoDB | service-managed/customer key depending requirement |

### 28.2 Account Boundary

```text
management account
security tooling account
log archive account
shared network account
prod workload account
staging workload account
dev workload account
external exchange account optional
```

### 28.3 KMS Boundary

- audit log key owned by log archive/security account;
- evidence key owned by prod workload/security-managed policy;
- backup key separate from runtime key if required;
- break-glass decrypt role monitored;
- CI/CD role cannot decrypt evidence.

### 28.4 Access Flow: Investigator Downloads Evidence

```text
Investigator -> UI -> Java API
Java API checks business authorization
Java API generates short-lived presigned URL or streams object
S3 validates GetObject
KMS validates Decrypt
CloudTrail records S3 data event and KMS event
Application audit log records business reason/context
```

Important distinction:

- AWS IAM/KMS says service role can decrypt.
- Application authorization says this investigator can access this case evidence.

Keduanya diperlukan.

### 28.5 Access Flow: External Party Uploads Document

```text
External user -> authenticated portal
Java API validates submission window
Java API issues presigned upload URL to quarantine prefix
S3 bucket enforces SSE-KMS and size/content controls where possible
Event triggers malware/content validation pipeline
Valid document moves to evidence prefix
Audit event recorded
```

### 28.6 Failure Modes

| Failure | Consequence | Mitigation |
|---|---|---|
| Evidence key disabled | evidence unavailable | alarm, deny disable, restore drill |
| Bucket policy too broad | data leakage | explicit deny public, Access Analyzer |
| App role too broad | lateral data access | prefix/domain scoped policy |
| Presigned URL too long | leaked URL usable | short expiry, business audit, scoped key |
| Audit log mutable | weak evidence | log archive account + Object Lock |
| CI/CD role can decrypt prod | supply-chain blast radius | separate deploy vs runtime/data roles |
| Restore role lacks decrypt | backup unusable | restore drill and key policy review |

---

## 29. Policy Design Invariants

Gunakan invariants agar desain tidak berubah liar.

Contoh invariants:

1. No production application runtime role may administer KMS keys.
2. No CI/CD role may decrypt restricted production evidence data.
3. All restricted S3 writes must use the approved customer managed KMS key.
4. All production S3 access from private workloads must go through approved VPC endpoints unless explicitly exempted.
5. All cross-account access must use AssumeRole unless a documented resource-policy exception exists.
6. All KMS key deletion/disable operations must generate high-severity alerts.
7. All audit logs must be written to log archive account and protected from workload account admins.
8. All break-glass sessions must be ticket-bound, MFA-backed, time-limited, and alerted.
9. Backup restore must be tested with KMS permissions, not just backup existence.
10. Tenant isolation must be enforced by application authorization and infrastructure boundary where required.

---

## 30. Anti-Patterns

### 30.1 “Encrypt Everything with One Key”

Mudah di awal, mahal saat audit dan incident.

### 30.2 “Fix AccessDenied with `kms:*`”

Menyelesaikan error, merusak security boundary.

### 30.3 “Bucket Private Berarti Aman”

Private bucket tetap bisa bocor lewat role/resource policy/presigned URL/cross-account access.

### 30.4 “KMS Admin juga Boleh Decrypt Semua Data”

Melanggar separation of duties.

### 30.5 “Backup Ada, Jadi Aman”

Backup tidak berguna jika key tidak tersedia atau restore role tidak punya decrypt.

### 30.6 “Resource Policy Lebih Praktis daripada AssumeRole”

Kadang benar, tetapi sering mengaburkan ownership dan audit path.

### 30.7 “Presigned URL Sama dengan Authorization”

Presigned URL hanya temporary credential-like access artifact. Authorization bisnis harus terjadi sebelum URL dibuat.

### 30.8 “CloudTrail Management Event Cukup”

Untuk data sensitif, sering perlu S3 data events, KMS events, application audit log, dan workflow history.

---

## 31. Review Checklist

### 31.1 KMS

```text
[ ] Key admin dan key user dipisahkan
[ ] Application role tidak punya kms admin actions
[ ] Key policy terdokumentasi
[ ] IAM policy dan key policy konsisten
[ ] Rotation strategy jelas
[ ] Deletion/disable guardrail ada
[ ] CloudTrail alarm untuk critical KMS event ada
[ ] Grant usage dipahami dan diaudit
[ ] Encryption context dipakai jika bermanfaat
[ ] Cross-account KMS access diuji
```

### 31.2 S3/Data Protection

```text
[ ] Bucket public access block aktif
[ ] Bucket policy enforce TLS
[ ] Bucket policy enforce SSE-KMS untuk data sensitif
[ ] Bucket policy membatasi VPC endpoint jika required
[ ] Versioning/lifecycle/Object Lock sesuai requirement
[ ] S3 data events aktif untuk bucket sensitif
[ ] Presigned URL expiry pendek
[ ] Object key tidak mengandung secret
[ ] Restore dari backup diuji
```

### 31.3 Cross-Account

```text
[ ] Trusting dan trusted account jelas
[ ] AssumeRole diprioritaskan untuk operational access
[ ] External ID digunakan untuk third-party jika relevan
[ ] Resource-based policy exception terdokumentasi
[ ] SCP tidak mematahkan flow legal
[ ] CloudTrail bisa menjawab principal asal
[ ] Session duration sesuai risiko
[ ] Session tag/ticket tag dipakai jika perlu
```

### 31.4 Data Lifecycle

```text
[ ] Data classification terdokumentasi
[ ] Key granularity sesuai classification
[ ] Retention policy jelas
[ ] Deletion/legal hold jelas
[ ] Backup encryption dan restore key jelas
[ ] Cross-region/account DR mencakup key dan policy
[ ] Audit log immutable jika required
[ ] Break-glass tested and alerted
```

---

## 32. ADR Template

```markdown
# ADR: Data Protection and KMS Strategy for <Workload>

## Status
Proposed / Accepted / Superseded

## Context
- Workload:
- Data classes:
- Regulatory requirements:
- Accounts involved:
- Regions involved:
- Services involved:

## Decision
We will use:
- KMS key granularity:
- Key ownership:
- Key admin roles:
- Key usage roles:
- Cross-account model:
- Resource policy model:
- Backup/restore key model:
- Audit logging model:

## Key Invariants
- Application roles cannot administer KMS keys.
- CI/CD roles cannot decrypt restricted data.
- Restricted S3 writes must use approved SSE-KMS keys.
- Break-glass access is MFA, time-bound, and alerted.

## Alternatives Considered
1. Single key per environment
2. Key per data domain
3. Key per tenant
4. Service-managed keys
5. Application-level encryption

## Consequences
Positive:
- ...

Negative:
- ...

Operational Requirements:
- Restore drill frequency:
- Key policy review frequency:
- CloudTrail alarm coverage:
- Access review process:

## Failure Modes
- Key disabled:
- Key policy regression:
- Cross-account access failure:
- Backup restore failure:
- Audit log write failure:

## Validation Plan
- IAM policy simulation:
- Non-prod integration test:
- Restore test:
- Break-glass test:
- CloudTrail evidence review:
```

---

## 33. Latihan Praktis

### Latihan 1 — Debug AccessDenied S3 + KMS

Scenario:

Aplikasi ECS Fargate role `prod-case-api-task-role` gagal membaca object S3 dengan error AccessDenied.

Tulis investigasi:

1. principal aktual;
2. action aktual;
3. S3 policy;
4. KMS key policy;
5. IAM policy;
6. VPC endpoint policy;
7. SCP;
8. CloudTrail events yang harus dicari.

### Latihan 2 — Design Key Strategy

Untuk platform case management:

- case metadata;
- evidence documents;
- audit logs;
- public decision documents;
- secrets.

Tentukan:

- key per domain atau shared;
- owner account;
- admin role;
- usage role;
- backup/restore model;
- audit requirement.

### Latihan 3 — Break-Glass Design

Desain break-glass access untuk decrypt evidence saat incident.

Harus mencakup:

- siapa bisa assume role;
- MFA/session duration;
- permission;
- alarm;
- approval;
- post-incident review.

### Latihan 4 — Cross-Account Partner Access

Partner eksternal perlu membaca export data terbatas setiap hari.

Bandingkan:

1. direct bucket resource policy;
2. AssumeRole;
3. copy to exchange bucket;
4. presigned URL.

Pilih satu dan jelaskan trade-off.

---

## 34. Ringkasan Mental Model

Security AWS advanced adalah tentang **komposisi**.

KMS bukan hanya encryption. KMS adalah authorization boundary untuk cryptographic use.

Policy bukan satu dokumen. Effective permission adalah hasil komposisi identity policy, resource policy, SCP, boundary, session policy, endpoint policy, key policy, grant, dan service-specific controls.

Cross-account access bukan “beri ARN account lain”. Dua sisi harus mengizinkan, dan audit harus bisa menjelaskan siapa melakukan apa.

Data protection bukan hanya data at rest. Ia mencakup classification, collection, encryption, storage, access, sharing, replication, backup, restore, deletion, dan audit.

Untuk sistem regulasi, tujuan akhirnya bukan hanya “aman”, tetapi **defensible**:

- bisa dijelaskan;
- bisa diaudit;
- bisa diuji;
- bisa dipulihkan;
- bisa dibatasi;
- bisa dibuktikan.

---

## 35. Referensi Resmi

- AWS KMS key policies: https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html
- AWS KMS grants: https://docs.aws.amazon.com/kms/latest/developerguide/grants.html
- AWS KMS encryption context: https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html
- AWS KMS condition keys: https://docs.aws.amazon.com/kms/latest/developerguide/policy-conditions.html
- AWS KMS permissions reference: https://docs.aws.amazon.com/kms/latest/developerguide/kms-api-permissions-reference.html
- AWS KMS cross-account access: https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-modifying-external-accounts.html
- IAM cross-account policy evaluation: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html
- IAM identity-based vs resource-based policies: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html
- S3 SSE-KMS: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html
- S3 bucket policies for VPC endpoints: https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies-vpc-endpoint.html
- S3 bucket policy examples: https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html
- AWS Prescriptive Guidance: KMS encryption best practices: https://docs.aws.amazon.com/prescriptive-guidance/latest/aws-kms-best-practices/data-protection-encryption.html
- AWS Prescriptive Guidance: General encryption best practices: https://docs.aws.amazon.com/prescriptive-guidance/latest/encryption-best-practices/general-encryption-best-practices.html

---

## 36. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-018.md
```

Judul:

```text
Observability on AWS: CloudWatch, X-Ray, Logs, Metrics, Traces, Alarms
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Security Architecture I: Network, Identity, Encryption, Secret, dan Isolation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-018.md">Part 018 — Observability on AWS: CloudWatch, X-Ray, Logs, Metrics, Traces, Alarms ➡️</a>
</div>
