# Part 3 — IAM for Java Engineers: Least Privilege That Actually Works

> Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> File: `part-03-iam-for-java-engineers-least-privilege-that-actually-works.md`  
> Scope: Java 8–25, AWS SDK for Java 2.x, production-grade AWS identity and authorization design  
> Prerequisites: Part 0, Part 1, Part 2

---

## 0. Why This Part Exists

Many Java engineers treat IAM as deployment configuration handled by DevOps or platform teams. That mindset is dangerous.

For AWS-integrated Java systems, IAM is not merely infrastructure. IAM is part of the application contract.

When your Java service calls S3, SQS, SNS, Secrets Manager, Systems Manager, KMS, STS, Lambda, DynamoDB, or EventBridge, your code is not just invoking an API. It is asserting:

1. which identity is allowed to act,
2. which resource is allowed to be affected,
3. under what conditions the action is valid,
4. which blast radius is acceptable if the application is compromised,
5. which evidence exists when something goes wrong.

A top-tier engineer does not only ask:

```text
Can the application call S3 PutObject?
```

A top-tier engineer asks:

```text
Can this exact workload, in this exact environment, using this exact role,
write only to this exact prefix, with this exact encryption key,
through this expected network path,
without being able to read unrelated data,
without being able to escalate privilege,
and with enough audit evidence to explain the action later?
```

That is the difference between "it works" and "it is defensible".

---

## 1. Core Mental Model

IAM is an authorization engine that answers one question:

```text
Should this request be allowed?
```

Every AWS API call can be modelled as:

```text
Principal + Action + Resource + Context -> Allow or Deny
```

Example:

```text
Principal: arn:aws:sts::111122223333:assumed-role/payment-worker-prod/i-abc123
Action:    sqs:ReceiveMessage
Resource:  arn:aws:sqs:ap-southeast-1:111122223333:payment-inbound-prod
Context:   region, source VPC endpoint, tags, MFA state, principal tags, source account, TLS, time
Decision:  Allow / Deny
```

IAM does not care that your caller is Java. IAM sees a signed AWS API request made by an AWS principal.

Your Java code matters because it chooses:

- which SDK client is used,
- which region is used,
- which credentials provider resolves identity,
- which resource ARN is targeted,
- which request parameters are sent,
- which encryption key, queue URL, bucket key, topic ARN, or secret name is used,
- how error responses are handled.

So IAM and Java are tightly coupled through runtime behavior.

---

## 2. IAM Vocabulary You Must Internalize

### 2.1 Principal

A principal is the actor making the request.

Common principals:

| Principal Type | Example | Typical Java Use |
|---|---|---|
| IAM role | `arn:aws:iam::111122223333:role/order-worker-prod` | EC2/ECS/EKS/Lambda workload identity |
| Assumed role session | `arn:aws:sts::111122223333:assumed-role/order-worker-prod/session` | Actual runtime identity seen by AWS |
| IAM user | `arn:aws:iam::111122223333:user/alice` | Human or legacy access key usage |
| AWS service principal | `lambda.amazonaws.com`, `s3.amazonaws.com` | Trust policy / service integration |
| Federated principal | OIDC/SAML identity | EKS IRSA, enterprise federation |

In modern production systems, application workloads should usually run as IAM roles, not IAM users.

A Java service should not carry long-lived AWS access keys unless there is a legacy constraint that has been explicitly accepted and mitigated.

---

### 2.2 Action

An action is an AWS operation permission.

Examples:

```text
s3:GetObject
s3:PutObject
sqs:ReceiveMessage
sqs:DeleteMessage
sns:Publish
secretsmanager:GetSecretValue
ssm:GetParameter
kms:Decrypt
sts:AssumeRole
```

SDK method names do not always map one-to-one mentally to IAM actions unless you inspect the service authorization reference.

Example:

```java
s3Client.putObject(request, requestBody);
```

usually needs:

```text
s3:PutObject
```

but may also need additional permissions depending on request features:

```text
kms:GenerateDataKey
kms:Decrypt
s3:PutObjectTagging
s3:PutObjectAcl
```

if encryption, tagging, or ACL behavior is involved.

---

### 2.3 Resource

A resource is what the principal acts on.

Examples:

```text
arn:aws:s3:::my-bucket
arn:aws:s3:::my-bucket/inbound/*
arn:aws:sqs:ap-southeast-1:111122223333:case-events-prod
arn:aws:sns:ap-southeast-1:111122223333:case-notifications-prod
arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:/prod/app/db-abc123
arn:aws:kms:ap-southeast-1:111122223333:key/1234abcd-...
```

Some actions support resource-level permissions. Some do not and require `Resource: "*"`.

A good engineer checks service-specific authorization reference instead of guessing.

---

### 2.4 Condition

A condition restricts when a statement applies.

Conditions are where least privilege becomes practical.

Examples:

```json
"Condition": {
  "StringEquals": {
    "aws:SourceVpce": "vpce-0123456789abcdef0"
  }
}
```

```json
"Condition": {
  "StringLike": {
    "s3:prefix": "inbound/agency-a/*"
  }
}
```

```json
"Condition": {
  "StringEquals": {
    "kms:EncryptionContext:service": "case-management"
  }
}
```

Conditions allow you to bind permissions to environment, network path, object prefix, encryption context, principal tag, source account, source ARN, TLS, and other request attributes.

---

### 2.5 Policy Statement

A policy statement is the atomic authorization rule.

```json
{
  "Sid": "AllowReadInboundObjectsOnly",
  "Effect": "Allow",
  "Action": [
    "s3:GetObject"
  ],
  "Resource": [
    "arn:aws:s3:::case-files-prod/inbound/*"
  ]
}
```

Core fields:

| Field | Meaning |
|---|---|
| `Sid` | Optional statement identifier, useful for review/debugging |
| `Effect` | `Allow` or `Deny` |
| `Action` | AWS API actions |
| `NotAction` | Inverse action matching; powerful but dangerous |
| `Resource` | Target resource ARN(s) |
| `NotResource` | Inverse resource matching; powerful but dangerous |
| `Condition` | Extra constraints |
| `Principal` | Used in resource-based/trust policies, not identity policies |

---

## 3. IAM Policy Types

A Java engineer does not need to memorize every IAM feature, but must understand how policy types combine.

### 3.1 Identity-Based Policy

Attached to an IAM user, group, or role.

For Java workloads, this is commonly attached to the execution role.

Example:

```text
Lambda execution role -> identity policy -> allow sqs:ReceiveMessage on queue X
```

Use it to say:

```text
This workload can do these actions on these resources.
```

---

### 3.2 Resource-Based Policy

Attached to the resource.

Examples:

- S3 bucket policy,
- SQS queue policy,
- SNS topic policy,
- KMS key policy,
- Lambda resource policy,
- Secrets Manager resource policy.

Use it to say:

```text
This resource accepts access from these principals under these conditions.
```

Resource-based policies are critical for cross-account access.

Example:

```text
Account A role wants to publish to Account B SNS topic.
```

You usually need:

1. identity policy in Account A allowing `sns:Publish`, and
2. topic policy in Account B allowing that principal.

---

### 3.3 Trust Policy

A trust policy is a special resource-based policy on an IAM role.

It controls who can assume the role.

Example: Lambda execution role trust policy.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

This does not grant the Lambda permission to access S3/SQS/etc. It only allows the Lambda service to assume the role.

The permissions of that role are defined separately by identity-based policies.

---

### 3.4 Permission Boundary

A permissions boundary defines the maximum permissions an IAM role or user can have.

It does not grant permission by itself.

The effective permission is roughly:

```text
Identity policy ∩ Permission boundary
```

If identity policy says `Allow s3:*`, but boundary allows only `s3:GetObject`, the principal can only perform `s3:GetObject`.

Use cases:

- delegate role creation to teams safely,
- prevent application teams from creating overly privileged roles,
- enforce maximum permission envelope per environment,
- ensure CI/CD-created roles cannot exceed platform guardrails.

---

### 3.5 Service Control Policy

An SCP belongs to AWS Organizations.

It controls the maximum available permissions in an account or organizational unit.

It does not grant permission by itself.

The effective permission is constrained by SCPs.

Use cases:

- deny disabling CloudTrail,
- deny public S3 bucket policy except approved accounts,
- deny leaving approved AWS regions,
- deny creation of long-lived IAM users,
- deny use of unapproved services.

For application engineers, SCP explains why something can be denied even if your role policy seems correct.

---

### 3.6 Session Policy

A session policy can further restrict permissions when assuming a role.

Effective permission is constrained by the assumed role policy and the session policy.

Use cases:

- temporary narrowed access,
- job-specific scoped session,
- tenant-specific access boundary,
- CI/CD operation that assumes the same role but restricts each run.

---

### 3.7 Access Control Lists and Legacy Controls

Some AWS services have older ACL-style mechanisms, especially S3 object ACLs.

Modern design usually avoids ACLs unless there is a specific reason.

For S3, prefer:

- bucket ownership controls,
- bucket policy,
- IAM identity policies,
- S3 Block Public Access,
- KMS policy,
- object ownership model.

---

## 4. IAM Evaluation Logic

The most important rule:

```text
Explicit Deny wins.
```

Then:

```text
Default is Deny.
```

Access is allowed only if at least one applicable policy allows the action and no applicable policy denies it.

A simplified mental model:

```text
1. Start with Deny.
2. Check explicit Deny across applicable policies.
   - If found, final decision is Deny.
3. Check whether applicable policies allow the action/resource/context.
4. Intersect with boundaries, SCPs, session policies, and other guardrails.
5. If still allowed, final decision is Allow.
6. Otherwise Deny.
```

For same-account access, identity-based and resource-based policies can both contribute allows. For cross-account access, both sides often matter: the caller side must allow, and the resource side must trust/allow.

### 4.1 Practical Debugging Question

When you see `AccessDeniedException`, ask:

```text
Was there no Allow, or was there an explicit Deny?
```

Those are different problems.

No Allow means:

```text
You forgot to grant something.
```

Explicit Deny means:

```text
A guardrail intentionally blocked you, perhaps SCP, resource policy, VPC endpoint policy, KMS key policy, permission boundary, or condition mismatch.
```

---

## 5. Why IAM Bugs Are Common in Java AWS Systems

IAM bugs usually come from hidden coupling.

### 5.1 The Code Uses a Different Resource Than the Policy Allows

Policy allows:

```text
arn:aws:s3:::case-files-prod/inbound/*
```

Code writes:

```text
s3://case-files-prod/inbound
```

or:

```text
s3://case-files-prod/inbound-agency-a/file.pdf
```

or:

```text
s3://case-files-prod/inbound/agency-a/file.pdf
```

Tiny key differences matter.

For S3, object resource ARN and bucket resource ARN are different:

```text
arn:aws:s3:::bucket-name          // bucket
arn:aws:s3:::bucket-name/key/*    // object
```

`ListBucket` applies to the bucket ARN. `GetObject` applies to object ARN.

---

### 5.2 The SDK Calls Extra APIs You Did Not Expect

Example:

- using multipart upload requires multipart-related actions,
- using SSE-KMS requires KMS permissions,
- listing before reading requires `s3:ListBucket`,
- using paginator may call repeated list APIs,
- using `GetQueueUrl` needs `sqs:GetQueueUrl`,
- using Secrets Manager cache may call describe/version operations depending on implementation.

Least privilege requires understanding the real API behavior, not just the happy-path method name.

---

### 5.3 KMS Is a Separate Authorization Plane

A common production failure:

```text
s3:GetObject is allowed, but object uses SSE-KMS and kms:Decrypt is denied.
```

Or:

```text
sqs:ReceiveMessage is allowed, but encrypted queue needs kms:Decrypt.
```

Or:

```text
secretsmanager:GetSecretValue is allowed, but secret uses custom KMS key and kms:Decrypt is denied.
```

When a managed service uses KMS, you must model both:

```text
Service permission + KMS permission
```

---

### 5.4 Region Mismatch

The policy may be correct, but the Java client points to the wrong region.

Example:

```java
SqsClient.builder()
    .region(Region.US_EAST_1)
    .build();
```

while the queue exists in:

```text
ap-southeast-1
```

Symptoms may look like missing resource, denied access, invalid endpoint, or signature mismatch depending on service and operation.

---

### 5.5 Resource Name vs ARN Confusion

Some SDK calls use:

- bucket name,
- object key,
- queue URL,
- topic ARN,
- secret name or ARN,
- key ID or key ARN,
- function name or function ARN.

IAM policies use ARNs, but SDK input fields may not.

A top-tier engineer makes this mapping explicit in configuration.

---

## 6. Least Privilege: The Practical Definition

Least privilege does not mean "make the smallest JSON possible".

It means:

```text
The principal can perform only the actions required for its intended responsibility,
against only the intended resources,
under only the intended conditions,
for only the intended duration,
with enough observability to detect misuse.
```

Least privilege has five dimensions:

| Dimension | Question |
|---|---|
| Action | What exact API operations are required? |
| Resource | Which exact resources are in scope? |
| Condition | Under what context is access valid? |
| Time | Is access permanent, temporary, or session-scoped? |
| Blast radius | What happens if this principal is compromised? |

---

## 7. Least Privilege Design Workflow

Use this workflow before writing policy JSON.

### Step 1 — Define the Workload Responsibility

Bad:

```text
order-service needs S3 access.
```

Better:

```text
order-document-ingestion-worker reads uploaded customer order documents from
s3://order-files-prod/inbound/, validates them, writes normalized documents to
s3://order-files-prod/processed/, and sends one event to order-document-processed-prod queue.
```

Good IAM starts with precise responsibility.

---

### Step 2 — Identify AWS API Calls

For each behavior, list APIs.

| Behavior | AWS APIs |
|---|---|
| Read inbound file | `s3:GetObject` |
| List pending files, if pull model | `s3:ListBucket` |
| Write processed file | `s3:PutObject` |
| Tag processed file | `s3:PutObjectTagging` |
| Send queue message | `sqs:SendMessage` |
| Use KMS-encrypted object | `kms:Decrypt`, `kms:GenerateDataKey` depending on operation |

Avoid vague grants like:

```text
s3:* on bucket
```

unless the workload truly needs administration, which application workloads rarely do.

---

### Step 3 — Identify Resource ARNs

Example:

```text
arn:aws:s3:::order-files-prod/inbound/*
arn:aws:s3:::order-files-prod/processed/*
arn:aws:sqs:ap-southeast-1:111122223333:order-document-processed-prod
arn:aws:kms:ap-southeast-1:111122223333:key/abcd-...
```

Do not use `*` because finding the exact ARN is inconvenient.

---

### Step 4 — Add Conditions

Examples:

- restrict S3 upload to server-side encryption,
- restrict KMS decrypt to specific encryption context,
- restrict SQS/SNS access to source account or source ARN,
- restrict access via VPC endpoint,
- restrict by principal tag/environment.

Condition is where policy becomes operationally strong.

---

### Step 5 — Decide Cross-Account Boundary

If cross-account:

- caller account identity policy,
- target account resource policy,
- KMS key policy if encrypted,
- SCPs in both accounts,
- trust policy if assuming role.

Cross-account access is not a single-policy problem.

---

### Step 6 — Validate and Test

Validate policy using:

- IAM Access Analyzer policy validation,
- IAM Policy Simulator where appropriate,
- integration test in sandbox account,
- CloudTrail inspection,
- intentional negative tests.

Test both:

```text
Allowed operation works.
```

and:

```text
Forbidden operation fails.
```

Negative IAM tests are not optional for high-assurance systems.

---

## 8. Java Configuration as IAM Contract

IAM is only useful when your Java configuration is precise.

Avoid this:

```yaml
aws:
  s3:
    bucket: case-files-prod
```

Prefer this:

```yaml
aws:
  region: ap-southeast-1
  s3:
    caseFiles:
      bucket: case-files-prod
      inboundPrefix: inbound/agency-a/
      processedPrefix: processed/agency-a/
      kmsKeyArn: arn:aws:kms:ap-southeast-1:111122223333:key/abcd-...
  sqs:
    processedQueueUrl: https://sqs.ap-southeast-1.amazonaws.com/111122223333/case-document-processed-prod
    processedQueueArn: arn:aws:sqs:ap-southeast-1:111122223333:case-document-processed-prod
```

Why keep both Queue URL and ARN?

- SDK calls often need queue URL.
- IAM policies use queue ARN.
- Observability/debugging benefits from both.

A strong Java system validates at startup:

- region is non-empty,
- bucket naming matches environment,
- queue URL region matches configured region,
- topic ARN account matches expected account,
- KMS key ARN region/account matches expected boundary,
- no production service points to non-production resource.

---

## 9. IAM and Java SDK Client Construction

The SDK client should reflect the intended identity and region.

Example:

```java
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;

public final class AwsClients {
    private final SqsClient sqsClient;

    public AwsClients(Region region) {
        this.sqsClient = SqsClient.builder()
                .region(region)
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    public SqsClient sqs() {
        return sqsClient;
    }
}
```

This is acceptable for many workloads because the environment supplies identity:

- Lambda execution role,
- ECS task role,
- EKS IRSA role,
- EC2 instance profile,
- local developer profile.

But in multi-account systems, you may intentionally assume a role.

```java
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StsAssumeRoleCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.AssumeRoleRequest;

public final class CrossAccountS3ClientFactory {
    public S3Client createForRole(Region region, String roleArn, String sessionName) {
        StsClient stsClient = StsClient.builder()
                .region(region)
                .build();

        AwsCredentialsProvider provider = StsAssumeRoleCredentialsProvider.builder()
                .stsClient(stsClient)
                .refreshRequest(AssumeRoleRequest.builder()
                        .roleArn(roleArn)
                        .roleSessionName(sessionName)
                        .build())
                .build();

        return S3Client.builder()
                .region(region)
                .credentialsProvider(provider)
                .build();
    }
}
```

Important production notes:

1. Reuse clients.
2. Do not create STS assume-role providers per request.
3. Use stable, meaningful session names.
4. Log role ARN and session name at startup, not credentials.
5. Avoid dynamic arbitrary role ARN from user input.

---

## 10. Service-Specific IAM Patterns

### 10.1 S3 Read-Only Prefix Access

Use case:

```text
A Java worker reads inbound files only from one S3 prefix.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowListInboundPrefixOnly",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::case-files-prod",
      "Condition": {
        "StringLike": {
          "s3:prefix": "inbound/agency-a/*"
        }
      }
    },
    {
      "Sid": "AllowReadInboundObjectsOnly",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::case-files-prod/inbound/agency-a/*"
    }
  ]
}
```

Key points:

- `ListBucket` uses bucket ARN.
- `GetObject` uses object ARN.
- Prefix condition applies to list behavior.
- This does not allow writes.

---

### 10.2 S3 Write with Required KMS Encryption

Use case:

```text
A Java service writes processed objects, but only if encrypted with a specific KMS key.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPutProcessedObjectsWithKmsOnly",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::case-files-prod/processed/agency-a/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms",
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh"
        }
      }
    },
    {
      "Sid": "AllowKmsForS3ObjectWrite",
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh"
    }
  ]
}
```

Java request must match policy:

```java
PutObjectRequest request = PutObjectRequest.builder()
        .bucket("case-files-prod")
        .key("processed/agency-a/result-123.json")
        .serverSideEncryption(ServerSideEncryption.AWS_KMS)
        .ssekmsKeyId("arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh")
        .build();
```

If code omits encryption headers, access should fail.

That is good.

Least privilege should fail unsafe writes.

---

### 10.3 Secrets Manager Read Access

Use case:

```text
A Java service reads only one production database secret.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadApplicationDbSecret",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:/prod/case-service/db-*"
    },
    {
      "Sid": "AllowDecryptSecretKmsKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh"
    }
  ]
}
```

Notes:

- Secrets Manager secret ARN often has a random suffix.
- If using a customer-managed KMS key, KMS permission matters.
- Avoid granting wildcard read over all secrets.

Bad:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "*"
}
```

This allows one compromised service to read unrelated secrets.

---

### 10.4 SSM Parameter Store Read Access

Use case:

```text
A Java service reads only its configuration subtree.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadServiceParameterPath",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:ap-southeast-1:111122223333:parameter/prod/case-service/*"
    },
    {
      "Sid": "AllowDecryptSecureStringKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh"
    }
  ]
}
```

Caution:

`GetParametersByPath` recursively reads many parameters if recursive is enabled. Your path structure is part of your security design.

Good hierarchy:

```text
/prod/case-service/db/url
/prod/case-service/db/username
/prod/case-service/features/new-workflow-enabled
```

Risky hierarchy:

```text
/prod/shared/all-secrets/...
```

---

### 10.5 SQS Consumer

Use case:

```text
A Java worker consumes from exactly one queue.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowConsumeCaseQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:111122223333:case-events-prod"
    }
  ]
}
```

Why include `ChangeMessageVisibility`?

Because robust consumers often extend visibility timeout while processing long-running messages.

Why include `GetQueueAttributes`?

Because consumers often need attributes for health checks, startup diagnostics, or metrics.

Do not grant `sqs:PurgeQueue` to application workers.

That is an operational/admin action with high blast radius.

---

### 10.6 SQS Producer

Use case:

```text
A Java service sends messages to one queue.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSendCaseCommand",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueUrl"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:111122223333:case-command-prod"
    }
  ]
}
```

For FIFO queues, this permission does not enforce message group strategy. Your Java code must ensure stable `MessageGroupId` and deduplication behavior.

IAM can restrict access, but it cannot fix bad event design.

---

### 10.7 SNS Publisher

Use case:

```text
A Java service publishes domain events to one SNS topic.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublishCaseEvents",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:111122223333:case-events-prod"
    }
  ]
}
```

Do not grant:

```text
sns:* on *
```

Application services should not generally create topics, delete topics, subscribe arbitrary endpoints, or modify topic attributes.

---

### 10.8 Lambda Invoker

Use case:

```text
A Java service invokes one internal Lambda function.
```

Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowInvokeRiskScoringFunction",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:ap-southeast-1:111122223333:function:risk-scoring-prod",
        "arn:aws:lambda:ap-southeast-1:111122223333:function:risk-scoring-prod:live"
      ]
    }
  ]
}
```

If you use aliases, include alias ARNs intentionally.

Do not accidentally allow all versions/aliases if release control matters.

---

## 11. Resource-Based Policies in Common Java Integrations

### 11.1 S3 Bucket Policy

Bucket policies are powerful because they protect the bucket regardless of caller identity policy.

Example: deny non-TLS access.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::case-files-prod",
        "arn:aws:s3:::case-files-prod/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

This is an explicit deny. Even an identity policy allow cannot override it.

---

### 11.2 SNS Topic Policy for S3 Event Publishing

When S3 publishes events to SNS, the topic policy must allow S3 as a service principal, usually constrained by source ARN and source account.

Pattern:

```json
{
  "Sid": "AllowS3PublishFromCaseFilesBucket",
  "Effect": "Allow",
  "Principal": {
    "Service": "s3.amazonaws.com"
  },
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:ap-southeast-1:111122223333:case-file-events-prod",
  "Condition": {
    "StringEquals": {
      "aws:SourceAccount": "111122223333"
    },
    "ArnLike": {
      "aws:SourceArn": "arn:aws:s3:::case-files-prod"
    }
  }
}
```

`aws:SourceArn` and `aws:SourceAccount` help prevent confused deputy problems.

---

### 11.3 SQS Queue Policy for SNS Fan-Out

If SNS topic sends to SQS, queue policy must allow SNS to send messages.

```json
{
  "Sid": "AllowCaseEventsTopicToSendMessages",
  "Effect": "Allow",
  "Principal": {
    "Service": "sns.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:ap-southeast-1:111122223333:case-events-worker-prod",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:sns:ap-southeast-1:111122223333:case-events-prod"
    }
  }
}
```

Without this, your Java publisher may successfully publish to SNS, but messages do not arrive in SQS.

The problem is not Java. The problem is resource policy.

---

### 11.4 Lambda Resource Policy

If API Gateway, SNS, S3, EventBridge, or another account invokes Lambda, Lambda resource policy controls invoke permission.

Example concept:

```text
Allow events.amazonaws.com to invoke function X from rule Y.
```

Application engineers should understand this because event source integration failures often appear as infrastructure bugs, but the real issue is missing resource permission.

---

## 12. KMS Authorization Is Special

KMS deserves special attention because it often surprises developers.

To use a customer-managed KMS key, permission may need to exist in:

1. IAM identity policy,
2. KMS key policy,
3. grants,
4. service-specific integration condition.

For many AWS services, the service performs encryption/decryption on behalf of your principal. The policy must allow the correct service usage path.

### 12.1 KMS with Encryption Context

Encryption context lets you bind decrypt permission to expected usage.

Example:

```json
{
  "Sid": "AllowDecryptOnlyForCaseServiceContext",
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh",
  "Condition": {
    "StringEquals": {
      "kms:EncryptionContext:service": "case-service"
    }
  }
}
```

This is useful when your application directly uses KMS encryption APIs.

For service-managed encryption like S3/SQS/Secrets Manager, the encryption context may be service-defined. You must verify the actual context keys for the integration.

---

## 13. Environment Isolation

A common anti-pattern:

```text
One role can access DEV, UAT, and PROD resources.
```

This creates accidental production impact from non-production runtime.

Better:

```text
dev-case-service-role  -> dev resources only
uat-case-service-role  -> uat resources only
prod-case-service-role -> prod resources only
```

Use naming conventions:

```text
/prod/case-service/...
/uat/case-service/...
/dev/case-service/...

case-files-prod
case-files-uat
case-files-dev

case-events-prod
case-events-uat
case-events-dev
```

Then enforce through policy resources and conditions.

### 13.1 Startup Guardrail in Java

Example:

```java
public final class AwsEnvironmentGuard {
    public static void validate(String appEnv, String bucket, String queueArn, String region) {
        requireContains(bucket, appEnv, "S3 bucket");
        requireContains(queueArn, appEnv, "SQS queue ARN");
        if (!"ap-southeast-1".equals(region)) {
            throw new IllegalStateException("Unexpected AWS region: " + region);
        }
    }

    private static void requireContains(String value, String expected, String name) {
        if (value == null || !value.contains(expected)) {
            throw new IllegalStateException(name + " does not match environment " + expected + ": " + value);
        }
    }
}
```

This is not a replacement for IAM, but it catches configuration mistakes earlier.

Defense in depth means IAM and application validation both exist.

---

## 14. Multi-Tenant and Tenant-Bound Access

If one Java service serves multiple tenants/agencies, IAM alone may not isolate tenants unless each tenant has separate AWS resources or roles.

Patterns:

### Pattern A — Resource Per Tenant

```text
s3://case-files-prod/tenant-a/*
s3://case-files-prod/tenant-b/*
```

or separate buckets/queues.

Pros:

- IAM can enforce stronger separation.
- Easier blast-radius reasoning.

Cons:

- More resources.
- More operational complexity.

### Pattern B — Shared Resource, App-Level Tenant Check

```text
s3://case-files-prod/all-tenants/...
```

Pros:

- Fewer AWS resources.

Cons:

- IAM cannot fully protect tenant boundary.
- App bug can cause cross-tenant access.

For high-assurance systems, prefer stronger resource boundaries for sensitive data.

---

## 15. Policy Anti-Patterns

### 15.1 `Action: "*"`

Usually unacceptable for application workload roles.

It allows unknown future behavior and privilege expansion.

---

### 15.2 `Resource: "*"` Without Justification

Sometimes required because certain AWS actions do not support resource-level permissions.

But it should be documented.

Bad:

```json
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

More acceptable when action requires wildcard:

```json
{
  "Sid": "AllowListQueuesForStartupDiagnostics",
  "Effect": "Allow",
  "Action": "sqs:ListQueues",
  "Resource": "*"
}
```

Even then ask: does app really need it?

---

### 15.3 Shared Application Role

Bad:

```text
all-prod-services-role
```

This makes it impossible to reason about which service needs what permission.

If one service is compromised, all permissions are compromised.

Prefer one role per workload capability.

---

### 15.4 Using IAM User Access Keys in Server Workloads

Bad:

```text
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

stored in config file, CI variable, container secret, or database.

Prefer:

- Lambda execution role,
- ECS task role,
- EKS IRSA,
- EC2 instance profile,
- STS assume role,
- short-lived credentials.

---

### 15.5 Granting Admin to Fix Delivery Pressure

This happens under deadline:

```text
Give it AdministratorAccess first, tighten later.
```

The tightening often never happens.

Better:

- identify exact denied action,
- add minimal permission,
- validate,
- document reason,
- add negative test.

---

### 15.6 Missing Explicit Deny for Critical Guardrails

Identity policies alone are not enough for organization-wide safety.

Use explicit deny in bucket policies, SCPs, or permission boundaries for critical invariants.

Examples:

- deny non-TLS S3 access,
- deny unencrypted S3 upload,
- deny public bucket policy,
- deny secret read outside approved role,
- deny KMS key use outside expected service.

---

## 16. IAM Debugging Playbook

When Java SDK throws access denied, do not randomly add permissions.

### 16.1 Capture the Error Correctly

Log:

- service name,
- operation name,
- AWS request ID if available,
- status code,
- error code,
- region,
- target resource logical name,
- caller identity at startup,
- role ARN/session ARN,
- sanitized request metadata.

Do not log:

- credentials,
- secret values,
- full sensitive payload,
- presigned URLs with secrets,
- decrypted configuration.

Example Java exception handling:

```java
try {
    sqsClient.sendMessage(request);
} catch (SqsException e) {
    throw new AwsOperationException(
            "Failed to send SQS message. " +
            "queueUrl=" + safeQueueName(request.queueUrl()) + ", " +
            "statusCode=" + e.statusCode() + ", " +
            "awsErrorCode=" + e.awsErrorDetails().errorCode() + ", " +
            "requestId=" + e.requestId(),
            e
    );
}
```

---

### 16.2 Confirm Runtime Identity

Use STS `GetCallerIdentity` at startup in non-latency-sensitive apps or diagnostic mode.

```java
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.GetCallerIdentityResponse;

public final class AwsIdentityLogger {
    public static void logCallerIdentity(StsClient sts) {
        GetCallerIdentityResponse identity = sts.getCallerIdentity();
        System.out.println("AWS account=" + identity.account());
        System.out.println("AWS arn=" + identity.arn());
        System.out.println("AWS userId=" + identity.userId());
    }
}
```

Do not call this per request.

Use it for startup diagnostics, support bundles, or health/debug endpoint with strict access control.

---

### 16.3 Identify Required Action

Map SDK operation to IAM action.

Do not guess.

Check AWS Service Authorization Reference.

---

### 16.4 Identify Resource ARN

Translate SDK inputs to ARN.

Examples:

| SDK Input | IAM Resource |
|---|---|
| S3 bucket + key | `arn:aws:s3:::bucket/key` |
| SQS queue URL | `arn:aws:sqs:region:account:queue-name` |
| SNS topic ARN | same ARN from SDK input |
| Secret name | secret ARN, often with suffix |
| KMS key ID | key ARN |

---

### 16.5 Check All Policy Layers

Checklist:

- identity policy,
- resource policy,
- trust policy,
- permission boundary,
- SCP,
- session policy,
- VPC endpoint policy,
- KMS key policy,
- service-specific condition,
- tags/principal tags,
- region/account mismatch.

---

### 16.6 Decode Authorization Message When Available

Some AWS authorization failures include an encoded message. Use STS `DecodeAuthorizationMessage` if you have permission.

This can show which policy type or condition contributed to the denial.

Operationally, grant decode permission only to support/admin role, not necessarily application runtime.

---

### 16.7 Use CloudTrail

CloudTrail helps answer:

- who made the call,
- when,
- from where,
- with which API,
- against which resource,
- what error code occurred.

For data events like S3 object-level access, explicit CloudTrail data event configuration may be required.

---

## 17. IAM and Observability Design

A Java service should expose enough data to debug authorization without leaking sensitive data.

### 17.1 Startup Log

Example:

```json
{
  "event": "aws.identity.resolved",
  "service": "case-worker",
  "environment": "prod",
  "region": "ap-southeast-1",
  "account": "111122223333",
  "principalArn": "arn:aws:sts::111122223333:assumed-role/case-worker-prod/..."
}
```

### 17.2 AWS Operation Log

Example:

```json
{
  "event": "aws.operation.failed",
  "service": "case-worker",
  "operation": "sqs.SendMessage",
  "resource": "case-command-prod",
  "statusCode": 403,
  "awsErrorCode": "AccessDenied",
  "awsRequestId": "...",
  "retryable": false
}
```

Use logical resource names instead of full sensitive object keys when necessary.

---

## 18. Policy Review Heuristics

When reviewing an IAM policy, ask these questions:

1. What workload owns this role?
2. Is the role shared by multiple workloads?
3. Are actions minimal?
4. Are resources scoped?
5. Is every `*` justified?
6. Are write/admin actions separated from read actions?
7. Are destructive actions excluded unless truly needed?
8. Is KMS permission scoped?
9. Are cross-account permissions constrained with source account/source ARN?
10. Are environment boundaries enforced?
11. Is access path constrained with VPC endpoint if required?
12. Is there an explicit deny for critical invariants?
13. Can we test allowed and denied behavior?
14. Can CloudTrail explain the access later?
15. What is the blast radius if this role is compromised?

If you cannot answer these, the policy is not production-ready.

---

## 19. IAM Design for CI/CD

CI/CD roles are often more dangerous than runtime roles.

Runtime role:

```text
case-service-prod can read one secret and consume one queue.
```

Deployment role:

```text
pipeline can update Lambda, change IAM, deploy CloudFormation, update ECS service, change S3 bucket policy.
```

The deployment role may have much larger blast radius.

Best practices:

- separate build role from deploy role,
- separate non-prod deploy role from prod deploy role,
- use approval gate for prod role assumption,
- use permission boundaries for created roles,
- prevent pipeline from escalating itself,
- restrict which CloudFormation stacks/CDK apps can be updated,
- log all role assumptions,
- avoid static credentials in CI.

---

## 20. IAM and Lambda

Lambda has two different permission concepts:

### 20.1 Execution Role

What the function code can do.

Example:

```text
Lambda code can read SQS, write S3, decrypt secret.
```

### 20.2 Resource-Based Invoke Permission

Who can invoke the Lambda.

Example:

```text
API Gateway can invoke this Lambda.
SNS can invoke this Lambda.
EventBridge can invoke this Lambda.
```

Do not confuse these.

If Lambda cannot read S3, fix execution role.

If SNS cannot invoke Lambda, fix Lambda resource policy/integration permission.

---

## 21. IAM and SQS/SNS Event-Driven Systems

In event-driven Java systems, permissions should reflect message flow.

Example architecture:

```text
case-api -> SNS topic -> SQS queue -> case-worker
```

Required permissions:

1. `case-api` role can `sns:Publish` to topic.
2. SNS topic policy may allow publisher if cross-account or constrained.
3. SQS queue policy allows SNS topic to `sqs:SendMessage`.
4. `case-worker` role can `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`.
5. KMS permissions exist if SNS/SQS encrypted with customer-managed keys.

If messages do not arrive, do not only inspect Java publisher.

Inspect the whole authorization chain.

---

## 22. IAM and S3 Event Pipelines

Example:

```text
External uploader -> S3 inbound bucket -> SQS event -> Java worker -> S3 processed bucket
```

Permissions:

- uploader can only put to inbound prefix,
- bucket policy denies unencrypted upload,
- S3 can send event to SQS,
- SQS policy allows S3 source bucket,
- worker can consume queue,
- worker can read inbound object,
- worker can write processed object,
- worker can tag or move/quarantine object if needed,
- worker can use KMS keys.

IAM must match the lifecycle, not just individual service calls.

---

## 23. IAM Invariants for Regulated Systems

For regulatory/case-management systems, define invariants explicitly.

Examples:

```text
Only ingestion role can write inbound documents.
Only processing role can write normalized documents.
No role except audit-exporter can read audit archive.
No non-prod role can read prod secrets.
All object writes must use approved KMS key.
All sensitive queues must be encrypted.
All cross-account publishes must specify source account/source ARN.
No application role can purge queues.
No application role can delete KMS keys.
No application role can disable CloudTrail.
```

These invariants should be represented in:

- IAM policies,
- resource policies,
- SCPs,
- permission boundaries,
- CI/CD checks,
- tests,
- architecture decision records.

Top-tier engineering means turning assumptions into enforceable constraints.

---

## 24. Example: End-to-End Least Privilege Design

### 24.1 Scenario

A Java service named `case-document-worker-prod` must:

1. consume messages from SQS queue `case-document-inbound-prod`,
2. read documents from S3 prefix `inbound/` in bucket `case-documents-prod`,
3. write processed documents to prefix `processed/`,
4. write failed documents to prefix `quarantine/`,
5. publish result event to SNS topic `case-document-events-prod`,
6. read one secret `/prod/case-document-worker/db`,
7. use KMS key `case-data-prod-key`.

It must not:

- delete source objects,
- purge queue,
- read unrelated secrets,
- write outside processed/quarantine prefixes,
- publish to unrelated topics,
- access non-prod resources.

### 24.2 Identity Policy Sketch

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeInboundDocumentQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": "arn:aws:sqs:ap-southeast-1:111122223333:case-document-inbound-prod"
    },
    {
      "Sid": "ReadInboundDocuments",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::case-documents-prod/inbound/*"
    },
    {
      "Sid": "WriteProcessedAndQuarantineDocuments",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::case-documents-prod/processed/*",
        "arn:aws:s3:::case-documents-prod/quarantine/*"
      ],
      "Condition": {
        "StringEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms",
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh"
        }
      }
    },
    {
      "Sid": "PublishDocumentEvents",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-1:111122223333:case-document-events-prod"
    },
    {
      "Sid": "ReadWorkerDbSecret",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:/prod/case-document-worker/db-*"
    },
    {
      "Sid": "UseCaseDataKmsKey",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-efgh"
    }
  ]
}
```

### 24.3 What Is Intentionally Missing

No:

```text
s3:DeleteObject
s3:ListAllMyBuckets
sqs:PurgeQueue
sns:CreateTopic
secretsmanager:ListSecrets
kms:ScheduleKeyDeletion
iam:PassRole
```

The absence is part of the design.

---

## 25. IAM and `iam:PassRole`

`iam:PassRole` is one of the most sensitive permissions.

It allows a principal to pass an IAM role to an AWS service.

Example use cases:

- create Lambda with execution role,
- start ECS task with task role,
- create Glue job role,
- create Step Functions state machine role.

If a CI/CD role can pass an admin role to Lambda, it may indirectly escalate privilege.

Policy should restrict both:

1. which role can be passed,
2. which service it can be passed to.

Example:

```json
{
  "Sid": "AllowPassOnlyCaseLambdaRoleToLambda",
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::111122223333:role/case-lambda-execution-prod",
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "lambda.amazonaws.com"
    }
  }
}
```

Runtime application roles almost never need `iam:PassRole`.

---

## 26. IAM and VPC Endpoint Policies

If your Java application accesses AWS services through VPC endpoints, endpoint policies can further restrict access.

This adds another layer:

```text
IAM identity policy says allow.
Resource policy says allow.
VPC endpoint policy may still deny.
```

Use endpoint policies to enforce network path constraints.

Example intent:

```text
Only allow access to approved S3 buckets through this endpoint.
```

Endpoint policies are useful but can confuse debugging. Always include them in access-denied analysis.

---

## 27. Java-Side Authorization Boundaries vs IAM Boundaries

IAM protects AWS resources.

It does not replace application authorization.

Example:

```text
A case officer can view only assigned cases.
```

IAM probably cannot enforce that if cases are rows in your database.

You still need application-level authorization.

But if documents are partitioned by S3 prefix per agency, IAM may help enforce coarse resource boundaries.

Think in layers:

| Layer | Protects |
|---|---|
| IAM | AWS API/resource access |
| Application authZ | Domain object access |
| Database policy | Row/schema/table access |
| KMS | Cryptographic key access |
| Network policy | Path/connectivity |
| Audit | Evidence and accountability |

Top-tier engineers do not overuse IAM for domain logic, and do not ignore IAM for cloud resources.

---

## 28. Policy as Code

IAM policy should be treated as code.

Minimum expectations:

- stored in Git,
- reviewed in pull requests,
- named statements with `Sid`,
- generated from typed constructs where possible,
- validated by Access Analyzer,
- tested by deployment/integration tests,
- versioned with application change,
- documented with rationale for wildcards.

Avoid manual console edits for production roles unless part of emergency procedure.

---

## 29. Negative Testing Examples

For a worker that should only read `inbound/`, test:

```text
GetObject inbound/file.pdf -> allowed
GetObject other/file.pdf -> denied
PutObject inbound/file.pdf -> denied
DeleteObject inbound/file.pdf -> denied
Read unrelated secret -> denied
Publish unrelated topic -> denied
Purge queue -> denied
```

This is how you verify boundaries.

A system that only tests happy path may silently accumulate excess privilege.

---

## 30. Top 1% Mental Models

### 30.1 IAM Is a Capability System

A role is a bundle of capabilities.

If code has the role, code has those capabilities.

Therefore, reduce capabilities to what the workload truly needs.

---

### 30.2 Authorization Is a Graph

Access is not just policy JSON.

It is a graph:

```text
Principal -> Policy -> Action -> Resource -> Condition -> Service -> KMS -> Network -> Organization Guardrail
```

Debug the graph, not only the policy.

---

### 30.3 Deny Is a Safety Invariant

Allow policies express normal behavior.

Explicit denies express non-negotiable safety constraints.

Use both intentionally.

---

### 30.4 Least Privilege Is Iterative

You rarely get it perfect at first.

Start narrow, observe denied actions, add only justified permissions, validate, and lock down.

Do not start broad and hope to clean up later.

---

### 30.5 IAM Must Match Runtime Reality

A policy that looks correct on paper may fail if:

- SDK uses different region,
- application uses different resource name,
- KMS key is different,
- role session is different,
- environment variable overrides credentials,
- resource policy denies,
- SCP denies,
- VPC endpoint policy denies.

Runtime identity and runtime resource resolution must be observable.

---

## 31. Practical Checklist

Before approving a Java AWS integration, verify:

```text
[ ] Each workload has its own IAM role.
[ ] Runtime role uses temporary credentials.
[ ] No static access keys are embedded.
[ ] Region is explicit and validated.
[ ] Resource ARNs are environment-specific.
[ ] Actions are minimal.
[ ] Destructive/admin actions are absent unless justified.
[ ] KMS permissions are scoped.
[ ] Resource policies are configured for cross-account/service integration.
[ ] SourceArn/SourceAccount is used where relevant.
[ ] Permission boundaries/SCPs are understood.
[ ] VPC endpoint policy is considered if endpoint is used.
[ ] Access Analyzer validation is clean or findings are justified.
[ ] CloudTrail can reconstruct access.
[ ] Java logs include AWS request ID on failure.
[ ] Negative authorization tests exist.
[ ] Wildcards are documented.
```

---

## 32. Common Interview/Architecture Questions

### Q1. Why does my Java app get AccessDenied even though the role has `s3:GetObject`?

Possible causes:

- object uses SSE-KMS and role lacks `kms:Decrypt`,
- bucket policy explicit deny,
- wrong object ARN/prefix,
- role session is not the role you think,
- SCP denies,
- VPC endpoint policy denies,
- object belongs to another account/ownership issue,
- condition mismatch such as source VPC endpoint or encryption context.

---

### Q2. Should application code call `AssumeRole`?

Sometimes.

Appropriate:

- cross-account access,
- tenant/account isolation,
- temporary narrowed access,
- centralized security account pattern.

Avoid:

- using AssumeRole to hide bad role design,
- assuming arbitrary role from user input,
- assuming role per request without caching,
- using it when workload execution role is sufficient.

---

### Q3. Should one microservice have multiple IAM roles?

Sometimes.

If one deployment unit performs distinct capabilities with very different blast radius, splitting roles may help.

Examples:

- public API role cannot perform destructive batch operations,
- background repair job has temporary elevated access,
- read path role separate from write path role.

But do not overcomplicate. Role design should follow operational responsibility boundaries.

---

### Q4. Is `Resource: "*"` always bad?

No.

Some AWS actions require it. But every wildcard should be justified.

Ask:

```text
Does this action support resource-level permissions?
Can condition keys restrict it?
Can we remove this action entirely?
```

---

### Q5. Should Java services have permission to list all secrets or queues?

Usually no.

Listing permissions increase discovery blast radius.

Prefer explicit resource names/ARNs from configuration.

---

## 33. References

Official AWS references worth reading directly:

- IAM policy evaluation logic: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
- IAM policies and permissions: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html
- Permissions boundaries: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html
- AWS Organizations SCPs: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html
- IAM Access Analyzer policy validation: https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-validation.html
- Service authorization reference: https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html
- IAM condition element: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html
- Global condition keys: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html
- STS DecodeAuthorizationMessage CLI: https://docs.aws.amazon.com/cli/latest/reference/sts/decode-authorization-message.html
- AWS Well-Architected least privilege: https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_permissions_least_privileges.html

---

## 34. Summary

IAM for Java engineers is not about memorizing JSON syntax.

It is about designing cloud permissions as part of the system architecture.

A production-grade Java AWS application must make these explicit:

- who the workload is,
- what it can do,
- what it cannot do,
- which resources it can touch,
- which conditions must be true,
- what happens when permission is denied,
- how access can be audited,
- how blast radius is limited.

The strongest mental model is:

```text
IAM is not a deployment afterthought.
IAM is the capability boundary of your Java system in AWS.
```

If the Java code, runtime identity, IAM policy, resource policy, KMS policy, and observability story do not align, the system is not production-ready.

---

## 35. What Comes Next

Next part:

```text
Part 4 — SDK HTTP Layer, Connection Pooling, Timeout, Retry, and Backpressure
```

Part 4 moves from authorization boundary to runtime communication boundary. We will study how AWS SDK for Java talks to AWS services through HTTP, how connection pools and timeouts work, how retries should be designed, and how to avoid turning AWS calls into hidden latency, thread, and cost disasters.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-02-credentials-region-sts-identity-resolution.md">⬅️ Part 2 — Credentials, Region, STS, and Identity Resolution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-04-sdk-http-layer-connection-pooling-timeout-retry-backpressure.md">Part 4 — SDK HTTP Layer, Connection Pooling, Timeout, Retry, and Backpressure ➡️</a>
</div>
