# Part 25 — Security Hardening for Java AWS Applications

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> Target: Java 8–25, AWS SDK for Java 2.x, Lambda, S3, Secrets Manager, SSM, SNS, SQS, KMS, CloudWatch, CloudTrail, IAM, VPC endpoints  
> Fokus: hardening aplikasi Java yang berintegrasi dengan AWS agar aman, defensible, auditable, dan siap production

---

## 1. Tujuan Bagian Ini

Bagian sebelumnya sudah membahas IAM, SDK HTTP layer, failure model, observability, S3, Secrets Manager, SSM, KMS, SQS, SNS, Lambda, EventBridge, DynamoDB, CloudWatch, dan CloudTrail secara terpisah.

Bagian ini menyatukan semuanya sebagai **security hardening model** untuk aplikasi Java yang berjalan di atas AWS atau yang memanggil AWS API.

Kita tidak akan mengulang teori dasar security, cryptography, TLS, IAM syntax, atau OWASP secara umum. Fokusnya adalah pertanyaan yang jauh lebih praktis:

> “Jika saya punya Java service production yang memakai AWS SDK, Lambda, S3, SQS, SNS, Secrets Manager, SSM, KMS, DynamoDB, CloudWatch, dan CloudTrail, bagaimana saya membuatnya sulit disalahgunakan, mudah diaudit, dan tetap operasional saat incident?”

Security hardening di sini bukan checklist kosmetik. Hardening berarti:

1. Mengurangi blast radius.
2. Menghilangkan credential statis.
3. Membatasi data path dan control path.
4. Memastikan data sensitif tidak bocor di log, metric, trace, exception, heap dump, atau artifact.
5. Membuat akses bisa dijelaskan secara formal.
6. Membuat incident bisa direkonstruksi.
7. Membuat deployment pipeline tidak menjadi pintu belakang.
8. Membuat aplikasi gagal secara aman.

---

## 2. Mental Model: Security Bukan Layer Tambahan

Banyak engineer memperlakukan security seperti langkah akhir:

```text
build feature -> test -> deploy -> add IAM policy -> enable encryption -> done
```

Itu pendekatan yang rapuh.

Untuk aplikasi AWS yang serius, security harus menjadi bagian dari desain awal:

```text
domain action
  -> identity boundary
  -> data classification
  -> allowed AWS API action
  -> allowed resource
  -> network path
  -> encryption boundary
  -> observability evidence
  -> failure behavior
  -> operational recovery
```

Contoh sederhana:

```text
Requirement:
Officer uploads supporting document.

Naive implementation:
Java service calls s3.putObject(bucket, key, file).

Production security interpretation:
- Which principal is allowed to upload?
- Which tenant/case/module does this object belong to?
- Is object key guessable?
- Is bucket public blocked?
- Is object encrypted with correct KMS key?
- Does application role have only PutObject for allowed prefix?
- Can the same role delete or overwrite protected object?
- Does S3 bucket policy enforce TLS?
- Does KMS key policy allow decrypt only to intended processors?
- Is object metadata free from PII leakage?
- Is upload event traceable to user/case/request ID?
- Is CloudTrail data event enabled for sensitive bucket?
- What happens if upload succeeds but database update fails?
- Can incident team prove who uploaded what and when?
```

Top-tier engineer tidak hanya bertanya “bisa jalan atau tidak”, tetapi “apa invariant keamanan yang harus selalu benar”.

---

## 3. Security Planes dalam Aplikasi Java AWS

Untuk menghindari desain yang kabur, pisahkan security menjadi beberapa plane.

```text
+--------------------------------------------------------------+
| Application Security Plane                                   |
| - input validation                                           |
| - authorization at domain level                              |
| - data classification                                        |
| - secret handling                                            |
| - safe logging                                               |
+--------------------------------------------------------------+
| Identity and Permission Plane                                |
| - IAM role                                                   |
| - STS                                                        |
| - execution role                                             |
| - resource policy                                            |
| - KMS key policy                                             |
+--------------------------------------------------------------+
| Network Plane                                                |
| - VPC                                                        |
| - subnet                                                     |
| - security group                                             |
| - NACL                                                       |
| - VPC endpoint                                               |
| - PrivateLink                                                |
+--------------------------------------------------------------+
| Data Protection Plane                                        |
| - encryption at rest                                         |
| - encryption in transit                                      |
| - KMS                                                        |
| - retention                                                  |
| - object lock                                                |
| - backup                                                     |
+--------------------------------------------------------------+
| Operational and Audit Plane                                  |
| - logs                                                       |
| - metrics                                                    |
| - traces                                                     |
| - CloudTrail                                                 |
| - Config/Security Hub/GuardDuty                              |
| - runbooks                                                   |
+--------------------------------------------------------------+
| Supply Chain Plane                                           |
| - dependency scanning                                        |
| - artifact signing                                           |
| - CI/CD role assumption                                      |
| - least-privilege deployment role                            |
| - provenance                                                 |
+--------------------------------------------------------------+
```

Setiap plane punya kegagalan sendiri. Production incident sering terjadi bukan karena satu plane gagal total, tetapi karena beberapa plane lemah bersamaan.

Contoh kombinasi buruk:

```text
- Java app memakai IAM role terlalu luas.
- S3 bucket policy tidak membatasi prefix.
- Log menyimpan full object key berisi PII.
- CloudTrail data event tidak aktif.
- KMS key policy terlalu permissive.
- CI/CD bisa deploy role baru tanpa review.
```

Satu bug aplikasi bisa berubah menjadi data breach.

---

## 4. Prinsip Hardening Utama

### 4.1 Least Privilege Harus Berbasis Use Case

Least privilege bukan berarti policy pendek. Least privilege berarti policy hanya mengizinkan tindakan yang dibutuhkan oleh use case tertentu, terhadap resource tertentu, dalam kondisi tertentu.

Bad:

```json
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

Better:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject"
  ],
  "Resource": "arn:aws:s3:::aceas-case-doc-prod/case-documents/*"
}
```

Even better, jika domain memungkinkan:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject"
  ],
  "Resource": "arn:aws:s3:::aceas-case-doc-prod/case-documents/${aws:PrincipalTag/environment}/*",
  "Condition": {
    "StringEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}
```

Namun jangan over-engineer condition jika tim tidak bisa mengoperasikannya. Least privilege yang tidak dipahami sering berubah menjadi policy bypass manual.

---

### 4.2 Tidak Ada Static AWS Credentials di Aplikasi

Aplikasi Java production tidak boleh membawa access key dan secret key sebagai konfigurasi permanen.

Yang benar:

- Lambda memakai execution role.
- EC2 memakai instance profile.
- ECS memakai task role.
- EKS memakai IRSA atau pod identity model yang sesuai.
- CI/CD memakai OIDC federation atau role assumption.
- Cross-account memakai STS AssumeRole.

Yang harus dihindari:

```properties
aws.accessKeyId=AKIA....
aws.secretAccessKey=....
```

Atau:

```java
StaticCredentialsProvider.create(
    AwsBasicCredentials.create(accessKey, secretKey)
)
```

Kecuali untuk local development terbatas atau test isolated, dan tetap tidak boleh masuk repository.

Production Java SDK sebaiknya default:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Biarkan SDK mengambil credential dari default provider chain.

---

### 4.3 Identity Harus Dipisah Berdasarkan Capability

Jangan satu IAM role dipakai semua module.

Bad:

```text
aceas-prod-application-role
  -> can read/write all S3 buckets
  -> can publish all SNS topics
  -> can consume all SQS queues
  -> can decrypt all KMS keys
  -> can read all secrets
```

Better:

```text
aceas-prod-case-document-writer-role
aceas-prod-case-document-reader-role
aceas-prod-notification-publisher-role
aceas-prod-screening-worker-role
aceas-prod-secret-reader-role
aceas-prod-report-generator-role
```

Dalam monolith, pemisahan role kadang sulit. Tetapi minimal pisahkan:

1. Runtime role.
2. Deployment role.
3. Migration role.
4. Break-glass/admin role.
5. Read-only diagnostic role.

Jangan biarkan aplikasi runtime memiliki permission deployment atau schema migration kecuali memang bagian dari desain yang sangat dikontrol.

---

### 4.4 Enkripsi Bukan Pengganti Authorization

SSE-KMS, TLS, dan encrypted secret tidak membuat akses otomatis aman.

Jika role aplikasi punya:

```text
s3:GetObject
kms:Decrypt
```

maka role itu bisa membaca object terenkripsi.

Enkripsi melindungi data dari class ancaman tertentu, tetapi access control tetap harus ketat.

Hardening yang benar:

```text
S3 policy limits object access
+ IAM limits caller actions
+ KMS key policy limits decrypt authority
+ CloudTrail records access
+ application checks domain authorization
+ log redaction prevents leakage
```

---

### 4.5 Fail Secure, Not Fail Open

Saat security dependency gagal, default behavior harus aman.

Contoh:

```text
Cannot fetch permission config from SSM
  -> do not allow broad access
  -> degrade or fail request

Cannot decrypt secret
  -> do not fallback to hardcoded password

Cannot validate event signature
  -> reject event

Cannot determine tenant/case ownership
  -> deny access
```

Fail-open sering muncul sebagai “temporary workaround” yang menjadi permanen.

Bad:

```java
if (authorizationService.isAllowed(user, action)) {
    proceed();
} else if (authorizationService.isUnavailable()) {
    proceed(); // dangerous
}
```

Better:

```java
AuthorizationDecision decision = authorizationService.evaluate(user, action, resource);

if (decision == AuthorizationDecision.ALLOW) {
    proceed();
    return;
}

throw new AccessDeniedException("Access denied");
```

---

## 5. Threat Model untuk Java AWS Application

Sebelum hardening, buat threat model sederhana.

### 5.1 Asset

```text
- User identity/session
- Access token
- AWS role credential
- Database credential
- S3 object
- SQS/SNS message payload
- KMS key
- Audit trail
- Case document
- PII
- Business decision state
- CI/CD artifact
- Infrastructure definition
```

### 5.2 Actor

```text
- external attacker
- compromised user account
- malicious insider
- over-privileged developer
- compromised CI/CD runner
- compromised dependency
- misconfigured service principal
- accidental operator error
- buggy application code
```

### 5.3 Entry Point

```text
- public API
- Lambda trigger
- SQS message
- SNS message
- S3 event
- EventBridge event
- admin endpoint
- CI/CD pipeline
- IAM role assumption
- exposed secret
- dependency vulnerability
- log aggregation system
```

### 5.4 Abuse Case

Untuk setiap service, tulis abuse case.

Contoh S3:

```text
Attacker obtains application role credential.
Can they list all bucket contents?
Can they read objects from other tenants?
Can they delete evidence objects?
Can they upload malicious file to trusted prefix?
Can they overwrite existing document?
Can they generate public URL?
Can they decrypt KMS-encrypted objects?
```

Contoh SQS:

```text
Attacker obtains send permission.
Can they inject fake domain events?
Can they create expensive replay storm?
Can they poison DLQ?
Can they read messages containing PII?
Can they delete messages before processing?
```

Contoh Secrets Manager:

```text
Attacker obtains application role.
Can they list secret names?
Can they read unrelated secrets?
Can they read previous versions?
Can they update secret value?
Can they disable rotation?
```

---

## 6. IAM Hardening for Java Runtime

### 6.1 Do Not Design IAM by Service Name Alone

Bad mental model:

```text
This app uses S3, SQS, and Secrets Manager.
Give it S3/SQS/Secrets permissions.
```

Correct mental model:

```text
This app performs these domain capabilities:
- upload case document
- read its own processing queue
- publish document verified event
- retrieve one database credential
- decrypt objects using one KMS key
```

Policy should follow capability, not service label.

---

### 6.2 Split Runtime and Deployment Permission

Runtime role:

```text
Used by application while serving requests or processing events.
Should be narrow.
Should not create infrastructure.
Should not attach policies.
Should not modify Lambda configuration.
Should not update KMS key policy.
```

Deployment role:

```text
Used by CI/CD to deploy infrastructure/artifacts.
Can create/update resources within bounded scope.
Should not read production business data.
Should not read application secrets unless required.
Should require approval for sensitive changes.
```

Migration role:

```text
Used for database migration/data migration/one-time operational tasks.
Time-bound.
Audited.
Prefer manual approval.
```

Break-glass role:

```text
Emergency access.
MFA required.
Short session.
Logged and alerted.
Normally unused.
```

---

### 6.3 Avoid List Permission Unless Needed

Many data leaks start with list permission.

Example:

```text
s3:ListBucket
secretsmanager:ListSecrets
sqs:ListQueues
sns:ListTopics
kms:ListKeys
```

List permission gives discovery capability. An attacker with discovery can map your system.

If the application already knows exact ARN/name, do not grant list.

Bad:

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:ListSecrets",
    "secretsmanager:GetSecretValue"
  ],
  "Resource": "*"
}
```

Better:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:/prod/aceas/case/db-*"
}
```

---

### 6.4 Resource Policy Must Match Identity Policy

For S3/SQS/SNS/Lambda/KMS, permissions can involve both identity policy and resource policy.

You need to reason about the effective permission:

```text
effective access = identity policy + resource policy + boundary + SCP + session policy + explicit denies
```

A common mistake:

```text
IAM role is narrow, but bucket policy allows broader principal.
```

Or:

```text
IAM role allows kms:Decrypt, but KMS key policy does not.
```

Hardening requires reviewing both sides.

---

### 6.5 Use Explicit Deny for High-Risk Invariants

Explicit deny is useful for invariants that must never be bypassed.

Examples:

- Deny S3 actions without TLS.
- Deny PutObject without required encryption.
- Deny access from outside organization/account/VPC endpoint where applicable.
- Deny deletion of protected audit objects.
- Deny secret modification by runtime role.

Example conceptual S3 deny:

```json
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::aceas-prod-documents",
    "arn:aws:s3:::aceas-prod-documents/*"
  ],
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

Be careful. Explicit deny can break operations if applied without full understanding.

---

## 7. Credential Hardening in Java

### 7.1 Use Default Credentials Provider Chain

Production code should rarely hardcode a credential provider.

Recommended:

```java
SqsClient sqs = SqsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

This allows the same artifact to run in:

```text
local dev -> profile/web identity
EC2       -> instance profile
ECS       -> task role
EKS       -> pod identity/IRSA
Lambda    -> execution role
CI/CD     -> assumed role/OIDC
```

The application should not care where credential comes from. The platform decides.

---

### 7.2 Do Not Log Credential Provider Details Excessively

It is useful to log identity at startup, but not secrets.

Safe-ish startup log:

```text
aws.region=ap-southeast-1
aws.account=123456789012
aws.callerArn=arn:aws:sts::123456789012:assumed-role/aceas-prod-case-worker/...
```

Unsafe:

```text
accessKeyId=AKIA...
secretAccessKey=...
sessionToken=...
```

Even access key ID alone may help attackers correlate leaked credentials.

---

### 7.3 Validate Caller Identity at Startup

For critical services, call STS `GetCallerIdentity` at startup and compare against expected account/environment.

Example pattern:

```java
public final class AwsIdentityGuard {
    private final StsClient sts;
    private final String expectedAccountId;

    public AwsIdentityGuard(StsClient sts, String expectedAccountId) {
        this.sts = sts;
        this.expectedAccountId = expectedAccountId;
    }

    public void verify() {
        GetCallerIdentityResponse identity = sts.getCallerIdentity();
        if (!expectedAccountId.equals(identity.account())) {
            throw new IllegalStateException(
                "Unexpected AWS account. expected=" + expectedAccountId +
                ", actual=" + identity.account()
            );
        }
    }
}
```

This prevents misconfigured deployment from running DEV artifact against PROD account or vice versa.

Do not call STS per request. Startup validation is enough for most cases.

---

### 7.4 Cross-Account Role Assumption

Cross-account access must be explicit.

Good pattern:

```text
Account A service role
  -> allowed sts:AssumeRole into Account B specific role

Account B target role trust policy
  -> trusts Account A service role
  -> optional external ID / condition
  -> narrow permissions to target resources
```

Java client pattern:

```java
StsClient sts = StsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

StsAssumeRoleCredentialsProvider provider = StsAssumeRoleCredentialsProvider.builder()
    .stsClient(sts)
    .refreshRequest(AssumeRoleRequest.builder()
        .roleArn("arn:aws:iam::222222222222:role/prod-target-reader")
        .roleSessionName("case-worker-prod")
        .build())
    .build();

S3Client crossAccountS3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .credentialsProvider(provider)
    .build();
```

Hardening rules:

- Use short session duration.
- Use specific role ARN.
- Avoid wildcard AssumeRole.
- Log assumed role ARN, not credentials.
- Alert unusual assume role activity.

---

## 8. Network Hardening

### 8.1 Public Internet Is Not Always Required

Many Java services only need to call AWS services. They may not need public internet egress.

For private subnets, use VPC endpoints where appropriate:

```text
S3          -> gateway endpoint or interface endpoint depending architecture
DynamoDB    -> gateway endpoint
SQS         -> interface endpoint
SNS         -> interface endpoint
Secrets     -> interface endpoint
SSM         -> interface endpoint
KMS         -> interface endpoint
CloudWatch  -> interface endpoint
STS         -> interface endpoint where supported/appropriate
ECR         -> interface endpoint for container pull paths
```

Benefits:

- Traffic stays on AWS network path.
- Endpoint policy can restrict accessible resources.
- Reduced dependency on NAT gateway/internet route.
- Stronger data perimeter.

Trade-offs:

- More infrastructure.
- Endpoint hourly/data processing cost for interface endpoints.
- Security group/NACL complexity.
- DNS/private hosted zone behavior must be understood.

---

### 8.2 VPC Endpoint Policy Is Not a Replacement for IAM

Endpoint policy restricts what can be accessed through that endpoint. IAM still controls what principal can do.

Think of it as another gate:

```text
application IAM role
  + resource policy
  + KMS policy
  + endpoint policy
  + SCP
  = effective permission
```

Example endpoint policy intent:

```text
This S3 endpoint can access only prod document bucket,
not any random bucket in the account.
```

If an attacker gets application role credential and tries to use it outside the VPC endpoint path, other controls must still prevent misuse.

---

### 8.3 Security Group Egress Should Be Intentional

Default allow-all egress is common. It is convenient but weak.

For high-security workloads, consider:

```text
- outbound HTTPS only to VPC endpoints / proxy
- no direct internet egress
- egress through inspected NAT/proxy
- explicit DNS resolver path
- security group referencing endpoint ENIs where manageable
```

But do not create unmaintainable egress rules. A broken security group model can cause production instability.

---

### 8.4 Lambda VPC Security

Lambda outside VPC can call public AWS APIs and public internet depending configuration.

Lambda inside VPC needs network path for:

```text
- database
- private service
- AWS service endpoints if no NAT
- Secrets Manager
- SQS/SNS/EventBridge/KMS/SSM as needed
```

Common failure:

```text
Lambda put into private subnet
-> no NAT / no VPC endpoint
-> cannot reach Secrets Manager/KMS/SQS
-> timeout during cold start
```

Security hardening must be balanced with availability.

---

## 9. Data Protection Hardening

### 9.1 Classify Data Before Choosing Controls

Do not apply same control to all payloads blindly.

Classification example:

| Data Type | Example | Control |
|---|---|---|
| Public config | feature flag description | SSM String, normal logging allowed |
| Internal config | queue URL, bucket name | SSM String, no public exposure |
| Secret | DB password, API token | Secrets Manager, cache, no logging |
| Sensitive business data | case document, identity data | S3 SSE-KMS, strict IAM, CloudTrail data event |
| Audit evidence | immutable audit record | retention, integrity protection, restricted delete |
| Operational telemetry | request ID, latency | log/metric, no secret/PII |

Hardening starts with knowing what kind of data you handle.

---

### 9.2 S3 Encryption and Access

Baseline:

```text
- Block Public Access enabled.
- Bucket ownership enforced where appropriate.
- ACLs disabled unless legacy need exists.
- Default encryption enabled.
- SSE-KMS for sensitive buckets.
- Bucket policy enforces TLS.
- Bucket policy denies unencrypted writes if required.
- Public bucket exceptions documented and reviewed.
```

For sensitive case/document systems:

```text
- no public read/write
- no arbitrary ListBucket
- no DeleteObject for runtime role unless required
- versioning enabled where overwrite risk matters
- Object Lock for immutable evidence where required
- lifecycle policy explicit
- CloudTrail data event enabled for sensitive bucket/prefix
```

Java upload should set expected security properties explicitly when needed:

```java
PutObjectRequest request = PutObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .serverSideEncryption(ServerSideEncryption.AWS_KMS)
    .ssekmsKeyId(kmsKeyId)
    .contentType(contentType)
    .metadata(Map.of(
        "correlation-id", correlationId,
        "case-id-hash", caseIdHash
    ))
    .build();

s3.putObject(request, RequestBody.fromFile(file));
```

Be careful with metadata. S3 object metadata can become an unintended leakage channel.

Avoid:

```text
x-amz-meta-user-nric=...
x-amz-meta-passport=...
x-amz-meta-email=...
x-amz-meta-case-description=...
```

Prefer opaque IDs or hashes.

---

### 9.3 SQS Message Security

Baseline:

```text
- queue not public
- least privilege sender/consumer roles
- server-side encryption enabled for sensitive messages
- TLS enforced by AWS endpoint usage
- DLQ configured and protected
- queue policy restricted for cross-account access
- message payload avoids unnecessary PII
```

Important distinction:

```text
SQS encryption at rest protects stored message body.
It does not stop authorized consumers from reading the message.
It does not protect data after the consumer logs it.
```

For sensitive workflows:

```text
- send reference, not full sensitive payload
- store sensitive document/data in S3/DynamoDB with stricter policy
- put only object key / case ID / event ID in message
- consumer fetches data after domain authorization
```

Example safer message:

```json
{
  "eventId": "evt-2026-0001",
  "eventType": "DocumentUploaded",
  "caseId": "CASE-12345",
  "documentRef": {
    "bucket": "aceas-prod-documents",
    "key": "case-documents/2026/06/CASE-12345/doc-abc.pdf"
  },
  "occurredAt": "2026-06-19T03:30:00Z"
}
```

Less safe:

```json
{
  "eventType": "DocumentUploaded",
  "fullName": "...",
  "nric": "...",
  "address": "...",
  "documentBase64": "..."
}
```

---

### 9.4 SNS Message Security

Baseline:

```text
- topic policy restricted
- publisher role least-privilege
- subscription endpoints reviewed
- SSE enabled for sensitive topics
- filter policy does not leak sensitive routing data
- DLQ configured for important subscriptions
```

SNS fan-out can multiply data exposure.

If you publish PII to one topic with ten subscribers, you effectively give ten consumers access to that PII.

Better pattern:

```text
Publish domain event with references.
Consumers fetch only data they are authorized to read.
```

For highly sensitive events, split topics:

```text
case-public-events-prod
case-internal-sensitive-events-prod
case-audit-events-prod
```

Do not use one universal topic for all event types if sensitivity differs.

---

### 9.5 Secrets Manager and SSM Hardening

Baseline for Secrets Manager:

```text
- one secret per security boundary where practical
- no secret values in env var if avoidable
- rotation enabled where supported
- KMS key chosen intentionally
- resource policy restricted
- cache used in Java app
- secret names do not reveal sensitive data
- no broad ListSecrets for runtime app
- CloudTrail monitored for GetSecretValue anomalies
```

SSM Parameter Store baseline:

```text
- hierarchy by env/app/module
- SecureString for sensitive-ish parameter if Secrets Manager not needed
- strict path-based IAM
- no passwords in plain String parameter
- no config dump endpoint exposing parameter values
```

Naming example:

```text
/prod/aceas/case-service/s3/document-bucket
/prod/aceas/case-service/sqs/input-queue-url
/prod/aceas/case-service/feature/document-scan-enabled
/prod/aceas/case-service/db/main
```

Do not name secrets with too much sensitive context:

```text
/prod/aceas/investigation/high-risk-person-watchlist-db-password
```

Names are metadata. Metadata can leak intent.

---

## 10. KMS Hardening

### 10.1 Key Per Boundary, Not Key Per Everything

Bad extremes:

```text
One KMS key for the entire account.
```

or:

```text
One KMS key per object/message/row.
```

Better:

```text
KMS key per data boundary / workload / regulatory domain.
```

Example:

```text
alias/prod/aceas/case-documents
alias/prod/aceas/audit-evidence
alias/prod/aceas/messaging-sensitive
alias/prod/aceas/secrets
```

---

### 10.2 Key Policy Must Be Reviewed Like Code

KMS key policy can accidentally bypass IAM design.

Review:

```text
- Who can administer the key?
- Who can use Encrypt/Decrypt?
- Which AWS services can use it on behalf of principals?
- Are grants controlled?
- Can runtime role schedule key deletion?
- Are cross-account principals allowed?
- Is CloudTrail monitoring KMS usage?
```

Runtime role normally needs:

```text
kms:Decrypt
kms:Encrypt
kms:GenerateDataKey
```

depending service/use case.

Runtime role should almost never need:

```text
kms:ScheduleKeyDeletion
kms:PutKeyPolicy
kms:DisableKey
kms:CreateGrant unrestricted
```

---

### 10.3 Encryption Context as Security Metadata

Encryption context helps bind cryptographic operation to context.

Example:

```java
EncryptRequest request = EncryptRequest.builder()
    .keyId(keyId)
    .plaintext(SdkBytes.fromByteArray(plaintext))
    .encryptionContext(Map.of(
        "app", "aceas",
        "module", "case",
        "environment", "prod"
    ))
    .build();
```

On decrypt, require same context.

Do not put secrets or PII into encryption context. It can appear in logs/audit records.

---

## 11. Logging, Metrics, and Trace Hardening

### 11.1 Sensitive Data Must Not Enter Logs

Dangerous values:

```text
- password
- access token
- refresh token
- session token
- authorization header
- cookie
- API key
- secret value
- private key
- OTP
- NRIC/passport/national ID
- full address
- raw document text
- signed URL with credential query string
- S3 presigned URL
- full exception response containing secret
```

Safe logging example:

```java
log.info("Uploaded document to S3 bucket={}, keyHash={}, size={}, correlationId={}",
    bucket,
    sha256Truncated(key),
    size,
    correlationId);
```

Unsafe:

```java
log.info("Uploaded document to S3 key={} request={}", key, request);
```

SDK request objects may contain headers/metadata. Avoid dumping entire request/response objects.

---

### 11.2 Redaction Should Be Defense-in-Depth, Not Primary Control

Log redaction library is useful, but developers should still avoid logging sensitive data.

Layered approach:

```text
1. Do not create log statement with sensitive value.
2. Use typed wrapper for secret values with safe toString().
3. Apply logging filter/redactor.
4. Restrict log access.
5. Set retention.
6. Monitor suspicious log queries/downloads.
```

Example secret wrapper:

```java
public final class SecretValue {
    private final String value;

    private SecretValue(String value) {
        this.value = value;
    }

    public static SecretValue of(String value) {
        return new SecretValue(value);
    }

    public String revealForUse() {
        return value;
    }

    @Override
    public String toString() {
        return "[REDACTED]";
    }
}
```

This does not solve memory exposure, but prevents accidental string interpolation leakage.

---

### 11.3 Trace Attribute Hygiene

OpenTelemetry/X-Ray attributes must not contain secrets/PII.

Good:

```text
aws.service=S3
aws.operation=PutObject
aws.region=ap-southeast-1
aws.request_id=...
case.id_hash=...
message.id=...
queue.name=case-input-prod
```

Bad:

```text
authorization=Bearer ...
db.password=...
user.nric=...
s3.presigned_url=...
```

---

## 12. Lambda Hardening

### 12.1 Execution Role Least Privilege

Each Lambda function should have a role aligned with its function.

Bad:

```text
one shared lambda-execution-role for all functions
```

Better:

```text
case-document-upload-handler-role
case-screening-worker-role
case-notification-publisher-role
audit-export-job-role
```

Lambda execution role should not have permissions just because other functions need them.

---

### 12.2 Environment Variables Are Configuration, Not Secret Store

Lambda environment variables are encrypted at rest, but they are still exposed to function runtime and often visible to operators with configuration read permission.

Use environment variables for:

```text
- region
- bucket name
- queue URL
- feature flag
- secret ARN
- parameter path
```

Avoid storing:

```text
- database password
- API token
- private key
- long-lived credential
```

Preferred:

```text
ENV: DB_SECRET_ARN=arn:aws:secretsmanager:...
Runtime: fetch secret through Secrets Manager cache
```

---

### 12.3 Code Signing and Artifact Integrity

For critical Lambda functions, consider code signing and artifact verification.

Security goal:

```text
Only trusted, reviewed, signed artifacts can be deployed.
```

This addresses:

```text
- compromised developer workstation
- accidental wrong artifact
- unauthorized deployment path
- tampered CI artifact
```

Also ensure:

```text
- deployment role cannot bypass signing policy
- artifact bucket is protected
- artifact hash is recorded
- rollback artifact remains immutable
```

---

### 12.4 `/tmp` Hygiene

Lambda `/tmp` can persist across warm invocations within same execution environment.

Rules:

```text
- do not leave sensitive temporary files unprotected
- delete files after use
- use unique names per invocation
- avoid predictable file names for concurrent logic
- never assume /tmp is empty
```

Example:

```java
Path temp = Files.createTempFile("case-doc-", ".bin");
try {
    // process
} finally {
    try {
        Files.deleteIfExists(temp);
    } catch (IOException ignored) {
        // log only path hash if needed
    }
}
```

---

### 12.5 Lambda Resource Policy

If Lambda is invoked by API Gateway, SNS, S3, EventBridge, or cross-account service, review its resource policy.

Questions:

```text
- Who can invoke this function?
- Is invocation restricted by source ARN?
- Is cross-account invocation intentional?
- Can old/deprecated event source still invoke it?
- Does alias/prod have stricter permission than $LATEST?
```

---

## 13. API Gateway and Public Endpoint Hardening

Even though this series focuses on AWS SDK/Lambda/common services, public API is often the entry point.

Baseline:

```text
- authentication required
- authorization enforced at application/domain layer
- request size limit
- schema validation
- rate limiting/throttling
- WAF for public endpoints where needed
- no verbose error disclosure
- correlation ID generated/propagated
- access logs redacted
- stage variables not used for secrets
```

For Java Lambda/API service:

```text
API Gateway authorization is not enough.
Application must still enforce domain authorization.
```

Example:

```text
User authenticated as officer.
But can officer access this specific case?
That is domain authorization, not just gateway auth.
```

---

## 14. Presigned URL Hardening

Presigned URLs are powerful because they delegate temporary access.

Risks:

```text
- URL leaked in logs/browser history/chat/email
- expiration too long
- overly broad object key
- GET URL generated before authorization check
- PUT URL allows arbitrary content type/size
- object key controlled by user
```

Hardening:

```text
- short expiration
- generate only after domain authorization
- use unpredictable object key
- enforce content length where possible
- enforce content type where possible
- never log full URL
- bind uploaded object to pending upload record
- verify object after upload
- scan/quarantine before trusted processing
```

Log:

```text
presignedUrlHash=...
keyHash=...
expiresInSeconds=300
```

Never log:

```text
https://bucket.s3...X-Amz-Signature=...
```

---

## 15. Dependency and Supply Chain Hardening

Java AWS applications depend on many libraries:

```text
- AWS SDK modules
- HTTP client
- Jackson
- logging framework
- Spring Boot
- Netty
- Apache HTTP client
- testcontainers/localstack
- JSON/XML libs
```

Baseline:

```text
- dependency lock or version catalog
- use AWS SDK BOM
- remove unused dependencies
- scan dependencies in CI
- scan container image
- pin base image
- avoid unreviewed transitive dependency expansion
- generate SBOM where required
- review CVE severity in context
- do not blindly suppress vulnerability alerts
```

Gradle example:

```kotlin
dependencies {
    implementation(platform("software.amazon.awssdk:bom:2.x.x"))
    implementation("software.amazon.awssdk:s3")
    implementation("software.amazon.awssdk:sqs")
    implementation("software.amazon.awssdk:secretsmanager")
}
```

Maven example:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>2.x.x</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Use actual latest approved version from your organization, not arbitrary examples.

---

## 16. CI/CD Credential Hardening

### 16.1 Avoid Long-Lived Deployment Keys

CI/CD should not store long-lived AWS access keys if federation is possible.

Preferred pattern:

```text
CI provider identity
  -> OIDC federation
  -> sts:AssumeRoleWithWebIdentity
  -> short-lived deployment credential
```

Hardening controls:

```text
- role trust policy restricts repository/org/branch/environment
- production deployment requires approval
- deployment role scoped to stack/application
- separate deploy role per environment
- no production secret read unless necessary
- CloudTrail monitors AssumeRole events
```

---

### 16.2 Deployment Pipeline Must Not Be God Mode

Common anti-pattern:

```text
CI/CD role = AdministratorAccess
```

It works until pipeline is compromised.

Better:

```text
bootstrap/admin role -> rarely used
application deploy role -> can deploy only app resources
runtime role -> used by app only
security/audit role -> read evidence only
```

For IaC, restrict by:

```text
- stack name prefix
- permission boundary
- allowed services
- protected resources
- approval workflow for IAM/KMS changes
```

---

### 16.3 Artifact Integrity

For Java services:

```text
source commit
  -> build artifact
  -> test
  -> scan
  -> sign/hash
  -> store immutable artifact
  -> deploy by digest/hash
```

Avoid deploying:

```text
latest.jar
latest.zip
latest container tag
```

Prefer immutable references:

```text
app-1.42.0+commit.a1b2c3.jar
container image digest sha256:...
lambda artifact hash recorded in release metadata
```

---

## 17. Service-Specific Hardening Matrix

### 17.1 S3

| Control | Why It Matters |
|---|---|
| Block Public Access | Prevent accidental public exposure |
| Default encryption | Protect at rest baseline |
| SSE-KMS for sensitive data | Key governance and audit |
| Bucket policy TLS deny | Prevent non-TLS access |
| Least privilege prefix | Reduce blast radius |
| Versioning/Object Lock | Protect against overwrite/delete |
| Lifecycle policy | Avoid uncontrolled retention/cost |
| CloudTrail data events | Forensic evidence |
| No PII in metadata/key if avoidable | Metadata leakage control |

### 17.2 SQS

| Control | Why It Matters |
|---|---|
| Least privilege send/receive/delete | Prevent injection/deletion |
| Queue policy restricted | Cross-account safety |
| SSE enabled | At-rest protection |
| DLQ protected | Poison data not exposed |
| Long polling controlled | Cost/performance |
| Message payload minimized | Reduce leakage |
| Idempotent consumer | Duplicate-safe processing |
| Monitoring queue age/depth | Incident detection |

### 17.3 SNS

| Control | Why It Matters |
|---|---|
| Topic policy restricted | Prevent unauthorized publish/subscribe |
| SSE enabled for sensitive topics | At-rest protection |
| Subscription review | Avoid accidental fan-out |
| Filter policy governance | Prevent routing leak/wrong delivery |
| DLQ for important subscriptions | Delivery failure evidence |
| Message schema versioning | Safe evolution |
| No sensitive universal topic | Limit exposure radius |

### 17.4 Secrets Manager

| Control | Why It Matters |
|---|---|
| No broad ListSecrets | Prevent discovery |
| Get only named secret/path | Least privilege |
| Rotation where possible | Reduce credential lifetime |
| Java cache | Availability/latency/cost |
| KMS key chosen intentionally | Key governance |
| No secret logging | Prevent leakage |
| CloudTrail monitoring | Detect unusual reads |

### 17.5 Lambda

| Control | Why It Matters |
|---|---|
| Per-function execution role | Reduce blast radius |
| No secrets in env var | Reduce config leakage |
| Code signing for critical functions | Artifact integrity |
| Reserved concurrency | Damage containment |
| Resource policy reviewed | Invocation control |
| `/tmp` cleanup | Prevent warm-state leakage |
| DLQ/destination configured | Failure recovery |
| Alias/canary deployment | Safer release |

### 17.6 KMS

| Control | Why It Matters |
|---|---|
| Key per boundary | Access isolation |
| Key policy review | Prevent governance bypass |
| No runtime admin actions | Reduce catastrophic risk |
| Encryption context | Context binding |
| CloudTrail monitoring | Audit decrypt/encrypt activity |
| Rotation/alias strategy | Operational continuity |

---

## 18. Java Coding Patterns for Security Hardening

### 18.1 Typed Configuration

Avoid passing raw strings everywhere.

Bad:

```java
String bucket = System.getenv("BUCKET");
String secret = System.getenv("SECRET");
String queue = System.getenv("QUEUE");
```

Better:

```java
public record AwsResourceConfig(
    Region region,
    String documentBucket,
    URI inputQueueUrl,
    String dbSecretArn,
    String kmsKeyId
) {
    public AwsResourceConfig {
        Objects.requireNonNull(region);
        requireNonBlank(documentBucket, "documentBucket");
        Objects.requireNonNull(inputQueueUrl);
        requireNonBlank(dbSecretArn, "dbSecretArn");
        requireNonBlank(kmsKeyId, "kmsKeyId");
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
    }
}
```

For Java 8, use final class instead of record.

---

### 18.2 Security-Safe AWS Client Factory

Centralize client configuration.

```java
public final class AwsClients implements AutoCloseable {
    private final S3Client s3;
    private final SqsClient sqs;
    private final SnsClient sns;
    private final SecretsManagerClient secrets;
    private final KmsClient kms;

    public AwsClients(Region region) {
        this.s3 = S3Client.builder()
            .region(region)
            .overrideConfiguration(c -> c
                .apiCallTimeout(Duration.ofSeconds(10))
                .apiCallAttemptTimeout(Duration.ofSeconds(3)))
            .build();

        this.sqs = SqsClient.builder()
            .region(region)
            .overrideConfiguration(c -> c
                .apiCallTimeout(Duration.ofSeconds(10))
                .apiCallAttemptTimeout(Duration.ofSeconds(3)))
            .build();

        this.sns = SnsClient.builder()
            .region(region)
            .overrideConfiguration(c -> c
                .apiCallTimeout(Duration.ofSeconds(5))
                .apiCallAttemptTimeout(Duration.ofSeconds(2)))
            .build();

        this.secrets = SecretsManagerClient.builder()
            .region(region)
            .overrideConfiguration(c -> c
                .apiCallTimeout(Duration.ofSeconds(5))
                .apiCallAttemptTimeout(Duration.ofSeconds(2)))
            .build();

        this.kms = KmsClient.builder()
            .region(region)
            .overrideConfiguration(c -> c
                .apiCallTimeout(Duration.ofSeconds(5))
                .apiCallAttemptTimeout(Duration.ofSeconds(2)))
            .build();
    }

    public S3Client s3() { return s3; }
    public SqsClient sqs() { return sqs; }
    public SnsClient sns() { return sns; }
    public SecretsManagerClient secrets() { return secrets; }
    public KmsClient kms() { return kms; }

    @Override
    public void close() {
        s3.close();
        sqs.close();
        sns.close();
        secrets.close();
        kms.close();
    }
}
```

This is simplified. In real production, you may also configure HTTP client, retry strategy, interceptors, metrics, and endpoint override for local tests.

---

### 18.3 Safe Exception Mapping

Do not expose raw AWS exception details to external users.

Bad:

```java
catch (AwsServiceException e) {
    return Response.status(500).entity(e.awsErrorDetails().errorMessage()).build();
}
```

Better:

```java
catch (S3Exception e) {
    log.warn("S3 operation failed code={} status={} requestId={} correlationId={}",
        e.awsErrorDetails().errorCode(),
        e.statusCode(),
        e.requestId(),
        correlationId);

    throw new InternalServiceException("Document storage operation failed");
}
```

External message should be safe. Internal logs should include enough correlation for diagnosis.

---

### 18.4 Domain Authorization Before AWS Access

Do not use S3/SQS/SNS access as domain authorization.

Bad:

```java
// user provides caseId and documentKey
s3.getObject(GetObjectRequest.builder()
    .bucket(bucket)
    .key(documentKey)
    .build());
```

Better:

```java
CaseAccess access = caseAuthorization.evaluate(user, caseId);
if (!access.canReadDocuments()) {
    throw new AccessDeniedException("Access denied");
}

DocumentRef ref = documentRepository.findByCaseIdAndDocumentId(caseId, documentId)
    .orElseThrow(NotFoundException::new);

s3.getObject(GetObjectRequest.builder()
    .bucket(ref.bucket())
    .key(ref.key())
    .build());
```

AWS resource permission protects infrastructure. Domain authorization protects business rules.

You need both.

---

## 19. Secure Event Handling Pattern

Event-driven systems need event authenticity and semantic validation.

### 19.1 Validate Event Source

For SQS/SNS/EventBridge/Lambda:

```text
- Is the queue/topic/bus expected?
- Is the event type known?
- Is schema version supported?
- Is tenant/case/module valid?
- Is idempotency key present?
- Is event timestamp acceptable?
- Is payload size reasonable?
```

Do not trust internal events blindly. Internal compromised publisher can be worse than external attacker.

---

### 19.2 Treat Events as Untrusted Input

```java
public void handle(DocumentUploadedEvent event) {
    validateSchema(event);
    validateEventType(event.eventType());
    validateSupportedVersion(event.schemaVersion());
    validateDomainReference(event.caseId(), event.documentId());
    idempotencyGuard.executeOnce(event.eventId(), () -> process(event));
}
```

Security and reliability meet here.

If event is invalid:

```text
- do not retry forever if permanent schema violation
- send to DLQ/quarantine with redacted reason
- alert if volume abnormal
```

---

## 20. Data Perimeter Thinking

A data perimeter is a set of controls that prevents data from moving outside intended boundaries.

For Java AWS application, think in terms of:

```text
Who can access data?
From where?
Using which network path?
Using which AWS principal?
For which resource?
Under what condition?
Is access logged?
Can abnormal access be detected?
```

Example target invariant:

```text
Production case documents can be read only by production case-service roles,
through approved VPC endpoints or approved AWS service integrations,
decrypted only with prod case-documents KMS key,
and access is recorded in CloudTrail data events.
```

This is much stronger than:

```text
Bucket is private.
```

---

## 21. Incident Readiness

Security hardening is incomplete if incident response is impossible.

For every sensitive integration, prepare answers:

```text
- Which role accessed this object/secret/queue/topic/key?
- When did it happen?
- From which source IP/VPC endpoint/service?
- Which request ID?
- Which application correlation ID?
- Which user/domain action caused it?
- Was data read, written, deleted, decrypted, published, or consumed?
- Can we revoke access quickly?
- Can we rotate secret/key safely?
- Can we replay or quarantine events?
- Can we prove no public exposure occurred?
```

Minimum evidence sources:

```text
- application structured logs
- CloudTrail management events
- CloudTrail data events for sensitive S3/Lambda/DynamoDB where needed
- CloudWatch metrics and alarms
- IAM Access Analyzer findings
- AWS Config/Security Hub findings where enabled
- CI/CD deployment logs
- artifact provenance
```

---

## 22. Security Testing Strategy

### 22.1 Test IAM Negative Cases

Most teams test only successful access.

You should also test denied access.

Examples:

```text
- role cannot read unrelated secret
- role cannot delete protected S3 object
- role cannot list bucket if not needed
- role cannot publish to unrelated topic
- role cannot receive from unrelated queue
- role cannot decrypt with wrong KMS key
```

Use sandbox AWS account or controlled integration environment. Local emulator cannot fully validate IAM/KMS/resource policy behavior.

---

### 22.2 Test Secret Leakage

Add tests/checks for:

```text
- no secret-like value in logs
- no Authorization header in exception output
- no presigned URL in logs
- no config endpoint exposing secrets
- no test fixture with real credential
- no generated artifact containing .aws/credentials
```

CI scanning should include:

```text
- source code
- test resources
- Docker image layers
- generated files
- deployment package
- markdown/docs if they include examples
```

---

### 22.3 Test Event Abuse Cases

Examples:

```text
- duplicate event
- event for unauthorized tenant/case
- event with unknown type
- event with future timestamp
- event with old schema version
- event missing idempotency key
- event referencing S3 object outside allowed prefix
- oversized message
- poison payload
```

Security test overlaps with reliability test.

---

## 23. Common Anti-Patterns

### 23.1 “Private Bucket Means Secure”

Private bucket is only one control.

Still check:

```text
- IAM role scope
- bucket policy
- KMS key policy
- metadata leakage
- presigned URL handling
- CloudTrail data event
- lifecycle/delete controls
```

---

### 23.2 “Internal Queue Means Trusted Message”

Internal queue messages can be malformed, duplicated, stale, poisoned, or malicious if publisher is compromised.

Always validate.

---

### 23.3 “Encrypted Env Var Means Safe Secret”

Lambda environment variables are encrypted at rest, but available to runtime and to principals allowed to read function configuration.

Use env var to point to secret ARN, not to store secret value.

---

### 23.4 “AdminAccess Is Faster”

It is faster at first. It becomes expensive during audit, incident, and breach.

Use narrowly-scoped roles and improve policy generation workflow.

---

### 23.5 “We Can Redact Later”

Once secret/PII enters logs, it may replicate into:

```text
- log aggregator
- SIEM
- alert notifications
- support tickets
- screenshots
- exported CSV
- backups
```

Prevent at source.

---

### 23.6 “SDK Retry Solves Security Failure”

Retrying `AccessDenied` normally does not help. It can amplify noise and hide misconfiguration.

Classify failure:

```text
AccessDenied      -> configuration/security issue
Throttling        -> retry/backoff/capacity issue
InternalError     -> retryable service issue
ValidationError   -> application bug/input issue
ExpiredToken      -> credential refresh/clock issue
```

---

## 24. Production Hardening Checklist

### 24.1 Identity and IAM

```text
[ ] No static AWS credential in code/config/artifact.
[ ] Runtime role separated from deployment role.
[ ] Runtime role has no admin/deployment permissions.
[ ] IAM policy scoped by action/resource/condition.
[ ] List permissions removed unless justified.
[ ] Cross-account AssumeRole is explicit and narrow.
[ ] Resource policies reviewed for S3/SQS/SNS/Lambda/KMS.
[ ] Permission boundary/SCP considered for high-risk environments.
[ ] STS caller identity validated at startup for critical services.
```

### 24.2 Network

```text
[ ] Service runs in intended subnet/security group.
[ ] Public internet egress is justified or removed.
[ ] VPC endpoints used where required.
[ ] Endpoint policies restrict sensitive access where practical.
[ ] Security group egress reviewed.
[ ] DNS/private endpoint behavior tested.
[ ] Lambda-in-VPC has path to required AWS services.
```

### 24.3 Data Protection

```text
[ ] Data classified by sensitivity.
[ ] S3 Block Public Access enabled.
[ ] Sensitive S3 buckets use SSE-KMS.
[ ] SQS/SNS encryption enabled for sensitive payloads.
[ ] KMS key policy reviewed.
[ ] No PII/secrets in S3 metadata/message attributes/log attributes.
[ ] Presigned URL expiration short and not logged.
[ ] Object deletion/overwrite protections considered.
```

### 24.4 Secrets and Config

```text
[ ] Secrets stored in Secrets Manager or approved secret store.
[ ] SSM String not used for password/API token.
[ ] Java secret cache configured.
[ ] Rotation plan exists.
[ ] Secret ARN/path scoped in IAM.
[ ] No broad ListSecrets for runtime.
[ ] Secret values never logged.
[ ] Secret failure behavior is fail-secure.
```

### 24.5 Logging and Audit

```text
[ ] Structured logs include correlation ID.
[ ] AWS request ID captured where useful.
[ ] Logs do not contain secrets/PII/presigned URLs.
[ ] CloudTrail enabled.
[ ] CloudTrail data events enabled for sensitive resources where required.
[ ] Log retention defined.
[ ] Access to logs restricted.
[ ] Incident reconstruction path tested.
```

### 24.6 Lambda

```text
[ ] Per-function execution role.
[ ] Env vars contain references, not secret values.
[ ] Resource policy restricts invokers/source ARN.
[ ] Reserved/provisioned concurrency reviewed.
[ ] `/tmp` cleanup implemented for sensitive temp files.
[ ] Deployment alias/canary/rollback defined.
[ ] Code signing considered for critical functions.
```

### 24.7 CI/CD and Supply Chain

```text
[ ] CI/CD uses short-lived credentials/OIDC where possible.
[ ] Production deploy requires approval.
[ ] Deployment role is scoped.
[ ] Dependency scanning enabled.
[ ] Container/image scanning enabled where applicable.
[ ] Artifact is immutable and traceable to commit.
[ ] No secret in build logs/artifacts.
[ ] SBOM/provenance generated where required.
```

---

## 25. Example Hardening Walkthrough

### Scenario

A Java Spring Boot worker consumes SQS messages, reads a document from S3, calls an internal screening engine, writes result to DynamoDB, and publishes an SNS event.

### 25.1 Minimal AWS Actions

```text
SQS:
- ReceiveMessage
- DeleteMessage
- ChangeMessageVisibility
- GetQueueAttributes

S3:
- GetObject on specific document prefix

KMS:
- Decrypt for S3/SQS/SNS/DynamoDB key as required by service integration

DynamoDB:
- PutItem / UpdateItem / GetItem on specific table
- condition expression required for idempotency

SNS:
- Publish to specific result topic

Secrets Manager:
- GetSecretValue for internal screening credential if needed
```

No need for:

```text
s3:ListAllMyBuckets
s3:DeleteObject
sqs:DeleteQueue
sns:CreateTopic
dynamodb:DeleteTable
kms:ScheduleKeyDeletion
secretsmanager:ListSecrets
```

### 25.2 Security Invariants

```text
- Worker can process only its input queue.
- Worker cannot purge queue.
- Worker can read only document objects under approved prefix.
- Worker cannot delete or overwrite documents.
- Worker can publish only screening result topic.
- Worker cannot read unrelated secrets.
- Worker cannot decrypt unrelated KMS keys.
- Worker logs only case ID hash/document ID hash, not full sensitive content.
- Duplicate message does not duplicate final state.
- Invalid message goes to DLQ/quarantine, not infinite retry.
```

### 25.3 Runtime Guards

At startup:

```text
- verify AWS account ID
- verify region
- verify queue URL format
- verify required config present
- initialize AWS clients once
- initialize secret cache
```

Per message:

```text
- parse safely
- validate schema version
- validate event type
- validate domain reference
- check idempotency
- fetch S3 object
- process
- update DynamoDB conditionally
- publish SNS result
- delete SQS message only after successful commit/publish decision
```

### 25.4 Incident Evidence

Each processing attempt should produce:

```text
correlationId
messageId
eventId
caseIdHash
documentKeyHash
s3RequestId
dynamoRequestId
snsMessageId
workerVersion
awsAccountId
awsRegion
```

This lets operators reconstruct what happened without exposing sensitive data.

---

## 26. Java 8–25 Considerations

### Java 8

```text
- no records; use final classes/builders
- older TLS/JCE behavior may need runtime updates
- dependency support window may be narrower
- be careful with old HTTP client and certificate store
```

### Java 11

```text
- better baseline than Java 8 for modern TLS/runtime
- still common in enterprise
- supported by many frameworks and AWS SDK 2.x
```

### Java 17

```text
- strong production baseline
- better GC/runtime behavior
- common Spring Boot 3 baseline
```

### Java 21

```text
- modern LTS
- virtual threads available, but do not assume SDK async model needs them
- good target for new Java services
```

### Java 25

```text
- modern runtime target where supported by platform
- validate Lambda/container/runtime support before standardizing
- dependency ecosystem must be checked
```

Security advice across all versions:

```text
- keep runtime patched
- keep CA certificates current
- avoid unsupported JVM versions
- avoid old logging dependencies
- use modern TLS defaults
- test startup and credential behavior per runtime
```

---

## 27. What Top 1% Engineers Do Differently

They do not stop at:

```text
It works.
```

They ask:

```text
What is the blast radius if this role is compromised?
What data can this event expose through fan-out?
Can this function be invoked by an old source?
Can this queue be poisoned?
Can this object be deleted by runtime?
Can this secret leak through logs?
Can this pipeline deploy a backdoored artifact?
Can we reconstruct access during audit?
Can we rotate/revoke safely?
Can a duplicate event cause unauthorized state transition?
Can a fallback accidentally fail open?
```

This is the shift from implementation engineer to systems/security-minded engineer.

---

## 28. Practical Review Template

Use this before approving a Java AWS integration PR.

```text
1. Capability
   - What domain action is this code enabling?
   - Which AWS services are touched?

2. Identity
   - Which IAM role runs this code?
   - Are permissions scoped to action/resource/condition?
   - Any list/admin/delete permission?

3. Data
   - What sensitive data flows through request/message/object/log?
   - Is data minimized?
   - Is encryption appropriate?

4. Network
   - Does traffic require public internet?
   - Are VPC endpoints needed?

5. Failure
   - What happens on AccessDenied, throttling, timeout, invalid message?
   - Does it fail secure?

6. Observability
   - Are correlation ID and AWS request ID captured?
   - Are logs redacted?
   - Is audit evidence sufficient?

7. Operation
   - Can secret be rotated?
   - Can deployment rollback?
   - Can DLQ be triaged?
   - Can access be revoked quickly?

8. Supply Chain
   - Are dependencies controlled?
   - Is artifact immutable?
   - Does CI/CD use short-lived credentials?
```

---

## 29. Summary

Security hardening for Java AWS applications is not one setting. It is the composition of:

```text
IAM least privilege
+ temporary credentials
+ safe AWS SDK configuration
+ service-specific resource policy
+ KMS governance
+ network perimeter
+ secret management
+ safe logging
+ event validation
+ CI/CD integrity
+ CloudTrail/auditability
+ fail-secure behavior
```

The strongest pattern is not “trust AWS service security defaults blindly”, but:

```text
Define security invariants.
Encode them in IAM/resource/KMS/network/application controls.
Observe them at runtime.
Test negative cases.
Prepare operational recovery.
```

If a Java engineer can reason this way, they are no longer merely integrating AWS services. They are designing a defensible cloud application system.

---

## 30. References

- AWS Well-Architected Framework — Security Pillar
- AWS IAM Best Practices
- AWS SDK for Java 2.x Developer Guide — Credentials and Default Credentials Provider Chain
- AWS Lambda Security and Execution Role Documentation
- AWS Lambda Environment Variables Documentation
- Amazon S3 Security Best Practices
- Amazon S3 Block Public Access Documentation
- AWS Secrets Manager Best Practices
- AWS Secrets Manager Java Caching Client Documentation
- Amazon SQS Security Best Practices
- Amazon SQS Server-Side Encryption Documentation
- Amazon SNS Security Best Practices
- Amazon SNS Server-Side Encryption Documentation
- AWS PrivateLink and Interface VPC Endpoint Documentation
- AWS KMS Developer Guide
- AWS CloudTrail Documentation

---

## 31. Status Seri

Seri belum selesai.

Bagian saat ini: **Part 25 — Security Hardening for Java AWS Applications**  
Bagian berikutnya: **Part 26 — Cost and Quota Engineering**

