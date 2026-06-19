# Part 31 — Multi-Account, Multi-Environment, and Deployment Strategy

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target: Java 8–25 engineers building production-grade AWS-integrated systems  
Focus: account/environment separation, deployment promotion, cross-account identity, artifact immutability, naming, CI/CD, and safe rollout strategy

---

## 1. Why This Part Exists

After learning AWS SDK, IAM, S3, SQS, SNS, Lambda, Secrets Manager, SSM, KMS, DynamoDB, observability, security, and cost engineering, one major question remains:

> Where do all these resources live, who is allowed to deploy them, how do changes move from DEV to UAT to PROD, and how do we prevent one environment from damaging another?

A top-tier engineer does not treat AWS resources as isolated objects. They think in terms of **environment topology**.

A Java service is not only code. In AWS, the real production system consists of:

```text
Java artifact
+ runtime platform
+ AWS account boundary
+ IAM role boundary
+ network boundary
+ secret/config boundary
+ data boundary
+ deployment pipeline
+ rollback strategy
+ audit trail
+ human access model
+ operational runbook
```

If these boundaries are weak, the system may still pass functional tests, but it is not production-grade.

This part is about designing those boundaries.

---

## 2. The Core Mental Model

### 2.1 AWS Account Is a Blast-Radius Boundary

An AWS account is not merely a billing folder. It is one of the strongest practical boundaries you have in AWS.

AWS Well-Architected Security guidance recommends separating workloads using accounts, and especially isolating production workloads from development and test workloads. AWS accounts are treated as hard boundaries for isolation. AWS Organizations best practices also recommend managing a multi-account environment centrally.

That means the account is a control boundary for:

- IAM identities and roles.
- Resource ownership.
- CloudTrail history.
- Service quotas.
- Billing allocation.
- Guardrails through service control policies.
- Network segmentation.
- Incident blast radius.
- Compliance isolation.

A bad DEV deployment should not be able to delete PROD data. A compromised test credential should not be able to publish PROD events. A noisy load test should not consume PROD Lambda concurrency or KMS quota.

That is the reason multi-account strategy matters.

### 2.2 Environment Is Not Just a Config Value

A common weak design is:

```text
one AWS account
one VPC
many prefixes:
  dev-*
  uat-*
  prod-*
```

This looks convenient, but it creates hidden coupling:

- Same IAM policy surface.
- Same quota pool.
- Same account-level CloudTrail scope.
- Same network mistake blast radius.
- Same human access mistake blast radius.
- Same accidental deletion boundary.
- Same account compromise boundary.

A better model is:

```text
AWS Organization
├── shared-services account
├── security / audit account
├── network account, optional
├── dev workload account
├── uat workload account
└── prod workload account
```

For a smaller organization, you may start with fewer accounts, but the mental model should remain the same: **environment is a boundary, not just a string**.

### 2.3 Deployment Is a Controlled State Transition

A deployment should not be seen as “copy new JAR to server” or “update Lambda code”. It is a controlled transition:

```text
previous known-good state
    ↓
new immutable artifact selected
    ↓
infra/config compatibility checked
    ↓
traffic shifted gradually or atomically
    ↓
health verified
    ↓
rollback point preserved
    ↓
audit evidence recorded
```

For Java AWS systems, deployment has at least four planes:

| Plane | Example | Failure if ignored |
|---|---|---|
| Code plane | JAR, container image, Lambda ZIP | Wrong artifact, accidental rebuild, untraceable binary |
| Infrastructure plane | SQS queue, SNS topic, IAM role, Lambda alias, S3 bucket | Missing permission, broken event path, unsafe public access |
| Configuration plane | SSM parameter, secret ARN, region, feature flag | Correct code but wrong runtime behavior |
| Data plane | DynamoDB table, S3 object, queue messages, database schema | Incompatible schema, unreplayable messages, corrupt state |

Top-tier deployment strategy treats all four planes as versioned, controlled, and auditable.

---

## 3. Recommended Account Topologies

### 3.1 Minimal Serious Topology

For a small team that still needs reasonable production isolation:

```text
AWS Organization
├── security-audit
├── shared-services
├── workload-dev
├── workload-uat
└── workload-prod
```

Responsibilities:

| Account | Purpose |
|---|---|
| `security-audit` | Central CloudTrail, security findings, audit logs, guardrails |
| `shared-services` | CI/CD runners, artifact repository, shared observability, DNS tooling |
| `workload-dev` | Developer integration testing |
| `workload-uat` | User acceptance testing, pre-production validation |
| `workload-prod` | Production workloads only |

This topology is enough for many Java backend systems.

### 3.2 Larger Enterprise Topology

For larger environments:

```text
AWS Organization
├── management account
├── security OU
│   ├── log-archive
│   └── security-tooling
├── infrastructure OU
│   ├── network-shared
│   ├── dns-shared
│   └── cicd-shared
├── workload-nonprod OU
│   ├── aceas-dev
│   ├── aceas-sit
│   └── aceas-uat
└── workload-prod OU
    ├── aceas-prod
    └── aceas-dr
```

The exact naming can differ, but the principles remain:

1. Management account should not host application workloads.
2. Security/log archive should be protected from workload teams.
3. Production should be separated from non-production.
4. Shared services should not become an uncontrolled dumping ground.
5. Each workload account should have clear owner, budget, guardrail, and emergency access procedure.

### 3.3 When One Account Is Still Acceptable

One account may be acceptable for:

- Personal learning.
- Throwaway prototype.
- Short-lived proof-of-concept.
- Local sandbox with no sensitive data.

But for production-grade Java systems, especially systems touching regulated data, one-account-all-environments is usually a weak default.

---

## 4. Environment Separation Patterns

### 4.1 Strong Separation: Account per Environment

```text
myapp-dev account
myapp-uat account
myapp-prod account
```

Benefits:

- Strong blast-radius isolation.
- Independent quota pools.
- Cleaner IAM boundary.
- Easier cost attribution.
- Cleaner audit trail.
- Safer experimentation in DEV.

Trade-offs:

- More setup.
- More cross-account deployment complexity.
- More governance required.
- Need central identity and logging.

For serious systems, this is usually the best target.

### 4.2 Medium Separation: Account per Stage Group

```text
nonprod account: dev, sit, uat
prod account: prod
```

This is a compromise. It protects PROD from non-PROD but does not isolate DEV from UAT.

It may be acceptable when:

- Team is small.
- Workload risk is moderate.
- Data sensitivity differs sharply only between production and non-production.
- You have strong naming, IAM, and resource tagging discipline.

### 4.3 Weak Separation: Prefix per Environment in One Account

```text
same account:
  dev-myapp-queue
  uat-myapp-queue
  prod-myapp-queue
```

This is simple but risky.

Common failure modes:

- Developer role accidentally gets PROD permission.
- CI pipeline points to wrong resource ARN.
- Lambda in DEV publishes to PROD SNS topic.
- Shared KMS key policy becomes too broad.
- Wrong SSM parameter path is loaded.
- Cleanup script deletes resources by prefix pattern.

This model should be treated as temporary or low-risk only.

---

## 5. Organizational Units and Guardrails

### 5.1 What an OU Is For

An Organizational Unit groups accounts so you can apply common controls.

Example:

```text
Root
├── Security OU
├── Infrastructure OU
├── WorkloadNonProd OU
└── WorkloadProd OU
```

You can attach service control policies to OUs to restrict what member accounts can do.

Important mental model:

```text
IAM policy says what a principal may do.
SCP says the maximum that an account is allowed to do.
```

Even if an IAM admin inside a member account grants themselves permission, an SCP can still deny certain actions.

### 5.2 Example Guardrails

Production OU guardrails may include:

- Deny disabling CloudTrail.
- Deny deleting log archive bucket.
- Deny public S3 bucket policies except approved exceptions.
- Deny creating IAM users with access keys.
- Deny disabling KMS keys used by production.
- Deny leaving organization.
- Deny changing account alternate contacts.
- Deny use of unapproved regions.

Non-production guardrails may include:

- Deny expensive instance families.
- Deny internet-exposed resources unless tagged/approved.
- Deny public S3 access.
- Enforce region restrictions.
- Enforce budget alarms.

### 5.3 Guardrails Are Not Application Logic

Do not encode application behavior in SCPs. Use SCPs to prevent catastrophic actions, not to implement domain rules.

Bad idea:

```text
Use SCP to decide which Java service can publish which business event.
```

Better:

```text
Use IAM/resource policies for service-level access.
Use application authorization/domain rules for business-level permission.
Use SCP only as outer blast-radius guardrail.
```

---

## 6. Cross-Account Access Mental Model

### 6.1 Two Sides of Cross-Account Access

Cross-account access requires two sides:

1. The target account role trusts the source principal.
2. The source principal is allowed to call `sts:AssumeRole` for that target role.

In plain terms:

```text
Source account principal:
  "I am allowed to assume that role."

Target account role trust policy:
  "I trust that principal to assume me."
```

Both must be true.

### 6.2 Deployment Role Pattern

A common deployment model:

```text
shared-services account
  CI/CD pipeline role
        |
        | sts:AssumeRole
        v
workload-dev account
  myapp-deploy-role

workload-uat account
  myapp-deploy-role

workload-prod account
  myapp-deploy-role
```

The CI/CD role does not deploy using a global admin credential. It assumes a narrow deployment role in each target environment.

### 6.3 Runtime Role Pattern

Runtime cross-account access should be more restrictive.

Example:

```text
prod account Java service role
        |
        | sts:AssumeRole
        v
shared data account read-only role
```

Use cases:

- Read from a central S3 archive.
- Publish to a centralized audit topic.
- Write security telemetry.
- Read centralized parameter values.

But be careful: runtime cross-account access can create hidden coupling.

Questions to ask:

- Does the service really need runtime cross-account access?
- Could the data be replicated instead?
- Is the access read-only or write-capable?
- What is the failure mode if AssumeRole fails?
- Is the target account availability now part of this service SLA?
- Is the trust policy restricted by source account, source role ARN, external ID, or organization condition?

---

## 7. Java SDK Cross-Account AssumeRole Pattern

### 7.1 Direct STS AssumeRole

With AWS SDK for Java 2.x, the common pattern is:

```java
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.auth.StsAssumeRoleCredentialsProvider;
import software.amazon.awssdk.services.sts.model.AssumeRoleRequest;

public final class CrossAccountClients {

    public static S3Client prodArchiveS3Client() {
        StsClient stsClient = StsClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build();

        AwsCredentialsProvider credentialsProvider = StsAssumeRoleCredentialsProvider.builder()
                .stsClient(stsClient)
                .refreshRequest(AssumeRoleRequest.builder()
                        .roleArn("arn:aws:iam::123456789012:role/prod-archive-read-role")
                        .roleSessionName("myapp-prod-archive-reader")
                        .build())
                .build();

        return S3Client.builder()
                .region(Region.AP_SOUTHEAST_1)
                .credentialsProvider(credentialsProvider)
                .build();
    }
}
```

The concept is simple:

```text
current runtime role
  -> calls STS AssumeRole
  -> receives temporary credentials
  -> uses those credentials for target service client
```

### 7.2 Production Rules for AssumeRole

Do not scatter AssumeRole code across business services.

Prefer a centralized factory:

```text
AwsClientFactory
├── defaultS3Client()
├── archiveAccountS3Client()
├── auditAccountSnsClient()
├── prodDynamoDbClient()
└── assumeRoleCredentialsProvider(roleArn, sessionName, policy?)
```

Rules:

1. Reuse clients.
2. Reuse credentials providers.
3. Name role sessions clearly.
4. Avoid arbitrary role ARN input from request/user data.
5. Set region explicitly for target clients.
6. Monitor STS failure rate and latency.
7. Avoid role chaining unless you understand session duration limits and audit implications.
8. Use external ID when a third party assumes a role in your account.
9. Treat cross-account access as an architecture decision, not a helper method.

---

## 8. Multi-Environment Naming Strategy

### 8.1 Why Naming Matters

Bad naming causes production incidents.

Example bad names:

```text
orders-queue
payment-topic
app-bucket
lambda-processor
```

In a multi-account world, names can sometimes be shorter because account gives context. But globally unique resources like S3 buckets still require careful naming.

A good naming scheme encodes enough context without becoming unreadable.

### 8.2 Suggested Naming Dimensions

Use a consistent naming tuple:

```text
<org>-<system>-<env>-<region>-<component>-<purpose>
```

Example:

```text
acme-aceas-prod-apse1-s3-document-landing
acme-aceas-prod-apse1-sqs-document-processing
acme-aceas-prod-apse1-sns-case-events
acme-aceas-prod-apse1-lambda-document-validator
acme-aceas-prod-apse1-kms-workload
```

Shorter variant:

```text
<system>-<env>-<component>-<purpose>
```

Example:

```text
aceas-prod-sqs-case-events
aceas-uat-s3-documents
aceas-dev-lambda-onemap-sync
```

### 8.3 Naming Is Not Security

Naming helps humans and automation. It does not enforce access.

Do not rely on this:

```text
Only prod resources have prod in the name, so scripts will avoid them.
```

Use actual boundaries:

- Account separation.
- IAM policy resource ARNs.
- SCP guardrails.
- Deletion protection where available.
- Approval gates.
- Explicit deployment target selection.

### 8.4 SSM Parameter Naming

Use hierarchy:

```text
/<org>/<system>/<env>/<component>/<name>
```

Example:

```text
/acme/aceas/prod/common/aws/region
/acme/aceas/prod/document/s3/landing-bucket
/acme/aceas/prod/document/sqs/processing-queue-url
/acme/aceas/prod/case/sns/event-topic-arn
/acme/aceas/prod/database/secret-arn
```

Avoid this:

```text
/db/password
/s3/bucket
/queue/url
```

because it is ambiguous and unsafe in multi-env systems.

---

## 9. Tagging Strategy

Tags are not decoration. They are operational metadata.

Recommended baseline tags:

| Tag | Example | Purpose |
|---|---|---|
| `System` | `aceas` | Workload grouping |
| `Environment` | `prod` | Env filtering |
| `Owner` | `platform-team` | Accountability |
| `CostCenter` | `gov-reg-001` | Cost allocation |
| `DataClassification` | `confidential` | Security/compliance |
| `ManagedBy` | `terraform` / `cdk` / `cloudformation` | Drift management |
| `Repository` | `aceas-document-service` | Code traceability |
| `Criticality` | `tier-1` | Incident priority |
| `BackupPolicy` | `daily-35d` | Backup automation |

For Java systems, tags should be aligned with logs and metrics.

Example log fields:

```json
{
  "system": "aceas",
  "environment": "prod",
  "service": "document-worker",
  "component": "sqs-consumer",
  "awsAccountId": "123456789012",
  "awsRegion": "ap-southeast-1"
}
```

This makes cost, runtime, and incident data correlate.

---

## 10. Artifact Immutability

### 10.1 The Rule

Never rebuild the artifact separately for each environment.

Bad promotion model:

```text
build from main -> deploy DEV
build from main -> deploy UAT
build from main -> deploy PROD
```

This creates hidden drift. The code may differ due to:

- Dependency resolution change.
- Build plugin change.
- Generated code timestamp.
- Base image update.
- Environment-specific build property.
- Local build machine difference.

Better model:

```text
build once
  -> artifact version 1.8.13+git.sha
  -> deploy same artifact to DEV
  -> promote same artifact to UAT
  -> promote same artifact to PROD
```

### 10.2 Artifact Types

For Java AWS systems:

| Runtime | Artifact |
|---|---|
| Lambda ZIP/JAR | Shaded JAR or ZIP with dependency libs |
| Lambda container | Immutable container image digest |
| ECS/EKS service | Immutable container image digest |
| Batch job | Immutable container or JAR artifact |
| Library | Versioned Maven artifact |
| Infrastructure | Versioned IaC module/template |

### 10.3 Version Identity

Every deployment should know:

```text
applicationVersion
commitSha
buildNumber
artifactDigest
buildTimestamp
sourceRepository
pipelineRunId
deployedBy
deployedAt
environment
awsAccountId
awsRegion
```

Expose some of this safely through:

- `/actuator/info` for Spring Boot.
- Lambda log on cold start.
- CloudWatch metric dimension.
- Deployment record table.
- Release note.
- Audit evidence.

### 10.4 Runtime Config Is Not Build Config

The artifact should be environment-neutral.

Bad:

```text
Build prod JAR with prod S3 bucket hardcoded.
Build uat JAR with uat S3 bucket hardcoded.
```

Better:

```text
Same JAR reads bucket name from environment-specific SSM parameter/config.
```

This allows the same binary to move through environments.

---

## 11. Promotion Model

### 11.1 Recommended Flow

```text
commit
  ↓
CI build
  ↓
unit tests
  ↓
static analysis
  ↓
package immutable artifact
  ↓
publish artifact
  ↓
deploy DEV
  ↓
integration tests
  ↓
promote artifact to UAT
  ↓
UAT validation
  ↓
approval gate
  ↓
promote same artifact to PROD
  ↓
canary/blue-green/rolling deployment
  ↓
post-deployment verification
```

### 11.2 Promotion Is Metadata, Not Rebuild

Promotion means:

```text
artifact X is now allowed to deploy to environment Y
```

It does not mean:

```text
rebuild source code for environment Y
```

### 11.3 What Must Be Checked Before Promotion

Before UAT/PROD promotion:

- Artifact digest matches previous stage.
- Database migration compatibility verified.
- IAM diff reviewed.
- SQS/SNS/EventBridge schema compatibility verified.
- Lambda memory/timeout/concurrency config diff reviewed.
- SSM/Secrets config exists.
- Required KMS grants/policies exist.
- CloudWatch alarms exist.
- DLQ exists and alarmed.
- Rollback target exists.
- Feature flags are in expected state.
- Known incident/runbook links exist.

---

## 12. CI/CD Role Design

### 12.1 Anti-Pattern: One Global Admin Credential

Bad:

```text
CI has AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for an admin user.
Pipeline deploys to all accounts using same long-lived secret.
```

Problems:

- Hard to rotate.
- Hard to audit.
- Easy to leak.
- Over-privileged.
- No environment boundary.
- Poor incident containment.

### 12.2 Better: OIDC or Federated Pipeline Role

Modern CI/CD should use federation where possible.

Generic model:

```text
CI identity provider
  -> assumes role in shared-services account
  -> assumes narrow deploy role in target workload account
```

For example:

```text
GitHub Actions / GitLab / Jenkins / AWS CodePipeline
        ↓
shared-services:cicd-base-role
        ↓ sts:AssumeRole
workload-prod:myapp-prod-deploy-role
```

### 12.3 Separate Deployment Permissions by Capability

Do not give one deploy role everything if the pipeline has different stages.

Possible role split:

| Role | Capability |
|---|---|
| `myapp-readonly-validate-role` | Read config, check resources, run diff |
| `myapp-infra-deploy-role` | Create/update IaC-managed resources |
| `myapp-code-deploy-role` | Update Lambda/container version |
| `myapp-config-deploy-role` | Update SSM parameters, feature flags |
| `myapp-breakglass-role` | Emergency only, audited heavily |

Smaller teams can combine some roles, but understand the trade-off.

### 12.4 Deployment Role Should Be Narrow

For a Lambda deployment role, it may need:

- `lambda:UpdateFunctionCode`
- `lambda:PublishVersion`
- `lambda:UpdateAlias`
- `lambda:GetFunction`
- `lambda:GetAlias`
- `cloudwatch:GetMetricData` for verification
- `iam:PassRole` only for approved execution roles

It should not need:

- `iam:*`
- `s3:*` on all buckets
- `kms:*` on all keys
- `lambda:*` on all functions
- `organizations:*`

---

## 13. Infrastructure as Code Positioning

This series is not an IaC-specific series, but deployment strategy cannot ignore IaC.

Common choices:

| Tool | Strength |
|---|---|
| CloudFormation | Native AWS, stable, integrated |
| AWS CDK | Code-based abstraction, good for Java/TypeScript/Python teams |
| Terraform/OpenTofu | Multi-cloud ecosystem, strong module usage |
| SAM | Serverless/Lambda-oriented |
| Serverless Framework | Developer-friendly serverless deployments |

The tool matters less than the discipline:

1. Resources are declared, not manually clicked.
2. Changes are reviewed.
3. State is protected.
4. Drift is detected.
5. Promotion is controlled.
6. Destructive changes are gated.
7. Outputs are consumed safely by apps.

### 13.1 IaC Ownership Boundary

Decide ownership clearly:

```text
Platform team owns:
  VPC, subnets, shared DNS, base IAM guardrails, central logging.

Application team owns:
  Lambda functions, SQS queues, SNS topics, application IAM roles, alarms, dashboards.

Security team owns/reviews:
  SCPs, security baseline, CloudTrail, central KMS policy, public exposure rules.
```

Ambiguous ownership causes drift and incident confusion.

---

## 14. Config Promotion and Parameter Strategy

### 14.1 Config Is Environment-Specific

Artifact should be the same; config differs.

Example:

| Config | DEV | UAT | PROD |
|---|---|---|---|
| S3 landing bucket | dev bucket | uat bucket | prod bucket |
| SQS queue URL | dev queue | uat queue | prod queue |
| Feature flag | experimental on | controlled | off/on by release |
| External endpoint | sandbox | staging | production |
| Secret ARN | dev secret | uat secret | prod secret |

### 14.2 Config Validation

At startup, Java apps should validate required config.

Example:

```java
public final class RequiredAwsConfig {
    private final String region;
    private final String queueUrl;
    private final String bucketName;
    private final String secretArn;

    public RequiredAwsConfig(String region, String queueUrl, String bucketName, String secretArn) {
        this.region = requireNonBlank(region, "region");
        this.queueUrl = requireNonBlank(queueUrl, "queueUrl");
        this.bucketName = requireNonBlank(bucketName, "bucketName");
        this.secretArn = requireNonBlank(secretArn, "secretArn");
    }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required AWS config: " + name);
        }
        return value;
    }
}
```

Failing fast at startup is often better than silently publishing to the wrong queue.

### 14.3 Config Drift

Config drift means environments are no longer comparable.

Examples:

- UAT queue has DLQ but PROD queue does not.
- DEV Lambda timeout is 60s, PROD is 5s.
- PROD S3 bucket has versioning disabled.
- UAT uses new event schema, PROD still uses old schema.
- PROD IAM role has an emergency manual policy attached.

Drift should be detected through:

- IaC diff.
- AWS Config, where used.
- Pipeline validation.
- Runtime startup checks.
- Periodic audit scripts.

---

## 15. Lambda Deployment Strategy

### 15.1 Version and Alias Model

A Lambda version is immutable. An alias is a movable pointer to a version.

Recommended model:

```text
function: document-validator
versions:
  41
  42
  43
aliases:
  dev  -> 43
  uat  -> 42
  prod -> 41
```

In account-per-env topology, you may use alias names like:

```text
live
canary
previous
```

Example:

```text
prod account:
  document-validator:live -> version 41
```

### 15.2 Canary Deployment

Lambda supports weighted aliases, allowing traffic split between two versions. This enables canary deployment and quick rollback by moving alias traffic back to the previous version.

Example rollout:

```text
0% new version
  ↓
5% new version for 10 minutes
  ↓
25% new version for 20 minutes
  ↓
100% new version
```

Monitor:

- Error rate.
- Throttle count.
- Duration p95/p99.
- Cold start/init duration.
- Downstream error rate.
- DLQ increase.
- SQS age of oldest message.
- Business metric anomalies.

### 15.3 Rollback

Rollback must be practiced.

For Lambda alias deployment, rollback can be:

```text
alias live -> previous version
```

But that is safe only if:

- Old code is compatible with current event schema.
- Old code is compatible with current database schema.
- Old code is compatible with current SSM/Secrets config.
- Old code can handle messages produced by new code.
- No irreversible data migration has already run.

This is why deployment is more than code.

---

## 16. Container-Based Java Service Deployment Strategy

For ECS/EKS Java services, the same principles apply, but rollout mechanics differ.

### 16.1 Immutable Image Digest

Prefer deployment by digest:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/aceas/document-service@sha256:abc123...
```

not only mutable tags:

```text
:latest
:prod
:stable
```

Tags are convenient labels. Digests are identity.

### 16.2 Rolling Deployment

A rolling deployment gradually replaces old tasks/pods.

Risk:

- New and old versions run together.
- Both must understand compatible schema/events.
- Shared consumer groups may process messages concurrently.
- Partial rollout may produce mixed behavior.

### 16.3 Blue/Green Deployment

Blue/green creates a separate new environment and switches traffic.

Useful when:

- You need cleaner rollback.
- Startup validation is heavy.
- Dependency warmup matters.
- You want to test new version before traffic.

Trade-off:

- More resource cost.
- More routing complexity.
- State and message consumers require careful design.

---

## 17. Database and Event Schema Deployment

Java AWS systems rarely deploy only code. They also evolve data and events.

### 17.1 Expand-Migrate-Contract

For database changes:

```text
1. Expand
   Add new nullable column/table/index.

2. Deploy code that writes both old and new or reads both.

3. Backfill/migrate data.

4. Switch readers to new structure.

5. Contract
   Remove old column/table only after old code cannot run anymore.
```

Never deploy a schema change that instantly breaks previous code unless you have a coordinated downtime window.

### 17.2 Event Schema Compatibility

For SNS/SQS/EventBridge:

Rules:

- Add optional fields, do not remove required fields abruptly.
- Consumers must ignore unknown fields.
- Producers should include `eventType`, `eventVersion`, `eventId`, `occurredAt`, `source`, and correlation IDs.
- Breaking change requires new event type/version and transition plan.
- DLQ replay may contain old messages; handlers must remain backward-compatible long enough.

### 17.3 Rollback and Messages

A common trap:

```text
New code publishes v2 message.
Deployment fails.
Rollback to old code.
Old code cannot consume v2 message.
Queue breaks.
```

Prevent this through:

- Consumer-first deployment.
- Backward-compatible message readers.
- Feature flag for new producer behavior.
- Event versioning.
- DLQ isolation.
- Replay plan.

---

## 18. Multi-Account Data Strategy

### 18.1 Avoid Cross-Environment Data Leakage

DEV and UAT should not casually use PROD data.

If production data must be copied:

- Mask sensitive fields.
- Tokenize identifiers.
- Remove attachments where possible.
- Redact logs.
- Restrict access.
- Track lineage.
- Apply retention.
- Document approval.

### 18.2 S3 Data Boundary

For S3:

```text
prod account:
  aceas-prod-document-archive

uat account:
  aceas-uat-document-archive

shared analytics account:
  curated masked dataset only
```

Do not let UAT processors read PROD buckets unless there is a well-justified, audited, read-only pattern.

### 18.3 Queue and Event Boundary

Never share production queues with non-production consumers.

Bad:

```text
UAT Lambda subscribes to PROD SNS topic for testing.
```

Better:

```text
Replay sanitized production-like events into UAT event bus/queue.
```

---

## 19. Centralized Logging and Audit

### 19.1 Log Archive Account

A common pattern:

```text
workload accounts
  -> CloudTrail / CloudWatch subscription / S3 logs
  -> log-archive account
```

The log archive account should be harder to modify than workload accounts.

Rules:

- Workload teams should not be able to delete central audit logs.
- Retention should match compliance needs.
- CloudTrail should cover management events and selected data events where required.
- S3 log buckets should have versioning/object lock if required.
- Access should be audited.

### 19.2 Deployment Evidence

Every production deployment should produce evidence:

```text
release id
artifact digest
commit sha
approver
pipeline run id
change ticket
target account
target region
changed resources
pre-check result
post-check result
rollback target
```

This matters for regulated systems because you may need to reconstruct not only what happened, but who approved it and what version was active at a given time.

---

## 20. Multi-Region and DR Positioning

Multi-account and multi-region are different dimensions.

```text
Account separation answers:
  who owns resources and what blast radius exists?

Region separation answers:
  where does workload run and how does it survive regional failure?
```

Example:

```text
prod account
├── ap-southeast-1 primary
└── ap-southeast-2 disaster recovery
```

Questions:

- Is DR active-active, active-passive, pilot light, or backup/restore?
- Are S3 buckets replicated?
- Are DynamoDB global tables used?
- Are KMS keys multi-region or separately managed?
- Are secrets replicated?
- Are queues drained or recreated?
- Are event schemas consistent?
- Is DNS failover automated?
- Has failover been tested?

For Java apps, DR is not just infrastructure. Client region selection, retry behavior, idempotency, and data consistency all matter.

---

## 21. Human Access Model

### 21.1 No Daily Admin in Production

Production access should be:

- Federated.
- Role-based.
- Time-bound where possible.
- Audited.
- Least privilege.
- Approved for sensitive actions.

Avoid:

- Shared admin users.
- Long-lived access keys.
- Permanent human production admin.
- Manual console changes without change record.

### 21.2 Break-Glass Access

Break-glass role is for emergency only.

It should have:

- Strong MFA.
- Separate approval procedure.
- Alert on use.
- Session recording/logging where applicable.
- Post-incident review requirement.
- Limited duration.

### 21.3 Developer Access to Non-Prod

Developer access in DEV may be broader, but still controlled.

Good pattern:

```text
Developers can inspect DEV resources.
Developers can deploy to DEV.
Developers cannot directly mutate PROD.
Production deploy goes through pipeline and approval.
```

---

## 22. Java Application Startup Identity Check

A production Java app should know where it is running.

At startup, log safe identity context:

```java
import software.amazon.awssdk.services.sts.StsClient;
import software.amazon.awssdk.services.sts.model.GetCallerIdentityResponse;

public final class AwsIdentityLogger {
    public static void logAwsIdentity() {
        try (StsClient sts = StsClient.create()) {
            GetCallerIdentityResponse identity = sts.getCallerIdentity();
            System.out.println("AWS account=" + identity.account()
                    + ", arn=" + identity.arn());
        }
    }
}
```

In real applications, use structured logging and avoid printing sensitive data.

This helps catch errors like:

```text
UAT service accidentally running with DEV role.
PROD deployment using wrong account.
Local app using personal credentials.
```

For stronger validation:

```java
public final class EnvironmentGuard {
    public static void assertExpectedAccount(String expectedAccountId, String actualAccountId) {
        if (!expectedAccountId.equals(actualAccountId)) {
            throw new IllegalStateException(
                    "AWS account mismatch. expected=" + expectedAccountId + ", actual=" + actualAccountId);
        }
    }
}
```

This is especially useful in batch jobs, migration tools, and administrative utilities.

---

## 23. Deployment Safety Checks

### 23.1 Pre-Deployment Checklist

Before deployment:

```text
[ ] Target AWS account verified.
[ ] Target region verified.
[ ] Artifact digest verified.
[ ] Artifact already deployed successfully to previous stage.
[ ] IAM diff reviewed.
[ ] Infrastructure diff reviewed.
[ ] Destructive changes identified.
[ ] Database migration is backward-compatible.
[ ] Event schema compatibility verified.
[ ] Required SSM parameters exist.
[ ] Required secrets exist and are accessible.
[ ] KMS permissions verified.
[ ] SQS DLQ exists and is alarmed.
[ ] Lambda reserved/provisioned concurrency reviewed.
[ ] CloudWatch alarms exist.
[ ] Rollback version exists.
[ ] Change ticket/release note linked.
```

### 23.2 Post-Deployment Checklist

After deployment:

```text
[ ] Health endpoint passes.
[ ] Lambda invocation success rate normal.
[ ] Error rate not elevated.
[ ] p95/p99 latency acceptable.
[ ] SQS queue age not increasing unexpectedly.
[ ] DLQ depth unchanged.
[ ] CloudWatch logs show expected version.
[ ] No AccessDenied spike.
[ ] No throttling spike.
[ ] Business smoke test passes.
[ ] Deployment evidence recorded.
```

### 23.3 Automated Smoke Test Example

A Java smoke test can check basic AWS wiring:

```java
public interface DeploymentSmokeTest {
    void verifyIdentity();
    void verifyS3Access();
    void verifySqsAccess();
    void verifySnsAccess();
    void verifySecretAccess();
    void verifyKmsAccess();
}
```

Do not run destructive tests in production. Production smoke tests should be safe, read-only, or operate on dedicated test resources.

---

## 24. Failure Modes in Multi-Environment Deployment

### 24.1 Wrong Account Deployment

Symptom:

```text
Pipeline says deployment succeeded, but UAT still runs old code.
```

Possible cause:

```text
Pipeline deployed to DEV account using UAT parameters.
```

Prevention:

- Verify account ID before deployment.
- Use target-specific role ARN.
- Record deployment evidence.
- Disallow ambiguous profile names.
- Use explicit account/environment mapping.

### 24.2 Wrong Region Deployment

Symptom:

```text
Resources exist but application cannot find them.
```

Cause:

```text
Lambda deployed to ap-southeast-1, but queue exists in ap-southeast-2.
```

Prevention:

- Explicit region in pipeline.
- Resource ARN validation.
- Startup region assertion.
- Region-specific naming.

### 24.3 Config Points to Wrong Environment

Symptom:

```text
DEV service publishes message to PROD topic.
```

Prevention:

- Account-separated resources.
- IAM denies cross-env publish.
- Runtime validation of topic/account ARN.
- SSM parameter path includes environment.
- No shared config files between envs.

### 24.4 Rollback Fails Due to Schema Change

Symptom:

```text
Rollback deployed, but consumers fail on new messages.
```

Prevention:

- Backward-compatible schema.
- Consumer-first rollout.
- Feature flag producer changes.
- Event versioning.
- Replay tests.

### 24.5 Pipeline Role Too Powerful

Symptom:

```text
Deployment bug deletes unrelated resources.
```

Prevention:

- Least privilege deploy role.
- Resource-scoped permissions.
- IaC change review.
- Permission boundary.
- SCP guardrails.

---

## 25. Practical Reference Architecture

### 25.1 Account Layout

```text
AWS Organization
├── security-log-archive
├── shared-cicd
├── aceas-dev
├── aceas-uat
└── aceas-prod
```

### 25.2 CI/CD Flow

```text
Developer push
  ↓
CI build in shared-cicd
  ↓
Publish artifact to shared artifact registry
  ↓
Assume aceas-dev deploy role
  ↓
Deploy DEV
  ↓
Integration tests
  ↓
Approval/promote
  ↓
Assume aceas-uat deploy role
  ↓
Deploy UAT
  ↓
UAT validation
  ↓
Change approval
  ↓
Assume aceas-prod deploy role
  ↓
Deploy PROD canary
  ↓
Monitor
  ↓
Shift 100% or rollback
```

### 25.3 Runtime Resources per Environment

```text
aceas-prod account
├── Lambda / ECS / EKS Java services
├── S3 buckets
├── SQS queues + DLQs
├── SNS topics
├── EventBridge bus/rules
├── DynamoDB tables
├── Secrets Manager secrets
├── SSM parameters
├── KMS keys
├── CloudWatch alarms/dashboards
└── IAM execution roles
```

No non-production service should directly use these unless explicitly designed and approved.

---

## 26. Design Review Questions

Use these questions before approving a Java AWS system design.

### 26.1 Account and Environment

1. Are DEV, UAT, and PROD separated by account?
2. If not, what compensating controls exist?
3. Who owns each account?
4. Are production workloads isolated from non-production workloads?
5. Are account IDs explicitly mapped in the pipeline?
6. Are allowed regions defined?

### 26.2 Identity and Access

1. Does CI/CD use temporary credentials?
2. Are deployment roles environment-specific?
3. Is `iam:PassRole` restricted?
4. Are runtime roles separate from deployment roles?
5. Are cross-account role trusts narrow?
6. Is external ID used for third-party access?
7. Are human production permissions time-bound/audited?

### 26.3 Artifact and Release

1. Is the artifact built once and promoted?
2. Is artifact digest recorded?
3. Can we prove what version was running yesterday at 10:00?
4. Is rollback version known?
5. Is config separate from artifact?
6. Are schema changes backward-compatible?

### 26.4 Runtime Safety

1. Does the app assert expected account/region at startup?
2. Are environment-specific resources validated?
3. Are DLQs configured and alarmed?
4. Are CloudWatch alarms deployed with the service?
5. Are secrets and KMS permissions validated?
6. Are quota/concurrency settings reviewed?

### 26.5 Audit and Compliance

1. Is CloudTrail centralized?
2. Are deployment events recorded?
3. Are manual changes detectable?
4. Can we reconstruct who deployed what and when?
5. Are log retention and data classification aligned?
6. Is break-glass access monitored?

---

## 27. Common Anti-Patterns

### Anti-Pattern 1 — Environment as String Only

```text
ENV=prod
```

but same account, same roles, same resources.

This is weak isolation.

### Anti-Pattern 2 — Build Per Environment

```text
mvn package -Pprod
```

This creates artifact drift.

### Anti-Pattern 3 — Pipeline Admin Role

```text
CI role has AdministratorAccess in all accounts.
```

Convenient but dangerous.

### Anti-Pattern 4 — Runtime Cross-Account Sprawl

```text
Every service can assume roles everywhere.
```

This destroys account boundary value.

### Anti-Pattern 5 — Manual Console Hotfix Without Backport

Manual changes may solve an incident but create drift.

Emergency changes must be:

- Recorded.
- Reviewed.
- Backported to IaC/config.
- Audited.
- Removed if temporary.

### Anti-Pattern 6 — Rollback Without Compatibility Design

Rollback is not guaranteed by redeploying old code. It requires schema and event compatibility.

### Anti-Pattern 7 — Shared PROD-Like Secret Across Environments

Never use production credentials in UAT for convenience.

---

## 28. Java 8 to Java 25 Considerations

This part is mostly architecture, but Java version still matters.

### 28.1 Java 8

Constraints:

- Older language features.
- More verbose SDK integration.
- Often older build systems.
- More likely to coexist with legacy AWS SDK v1.

Recommendations:

- Use AWS SDK v2 where possible; it supports Java 8.
- Be explicit with dependency versions.
- Avoid relying on runtime features not available in Java 8.
- Centralize client factories and config validation.

### 28.2 Java 11/17

Better baseline for modern enterprise systems:

- Stronger runtime performance.
- Better TLS defaults.
- Better GC options.
- Better container awareness.
- More modern language features.

### 28.3 Java 21/25

For latest Java runtimes:

- Better language ergonomics.
- Virtual threads may help some blocking integration workloads, but do not remove AWS throttling, connection pool, or downstream quota limits.
- Lambda/runtime support must be verified per AWS runtime lifecycle before choosing version.
- Keep dependencies compatible with target runtime.

Important: Java version does not fix weak deployment topology. A Java 25 service deployed with global admin credentials and shared PROD/UAT account is still poorly governed.

---

## 29. Exercises

### Exercise 1 — Account Topology Design

Design account topology for a system with:

- DEV, SIT, UAT, PROD.
- S3 document storage.
- SQS workers.
- SNS case events.
- Lambda validators.
- Central audit logging.
- External agency integration.

Answer:

1. How many AWS accounts?
2. Which OU structure?
3. Which account owns CI/CD?
4. Which account owns CloudTrail archive?
5. Which resources are per environment?
6. Which resources are shared?
7. What cross-account access is allowed?

### Exercise 2 — Deployment Role Design

Create roles for:

- DEV deployment.
- UAT deployment.
- PROD deployment.
- PROD runtime.
- PROD emergency break-glass.

For each role, define:

- Trusted principal.
- Allowed actions.
- Resource scope.
- Conditions.
- Audit requirement.

### Exercise 3 — Rollback Compatibility

Given:

```text
v1 consumes CaseCreated v1.
v2 publishes CaseCreated v2 with changed field names.
Rollback from v2 to v1 is required.
```

Design a safe event evolution plan.

### Exercise 4 — Startup Guard

Implement a Java startup guard that validates:

- Expected AWS account ID.
- Expected region.
- Required SSM parameters exist.
- Required SQS queue URL belongs to expected account/region.
- Required S3 bucket exists.

### Exercise 5 — Production Deployment Checklist

Build a checklist for deploying a Java SQS worker to PROD:

- Code artifact.
- IAM diff.
- Queue/DLQ readiness.
- Lambda/container concurrency.
- Config/secret readiness.
- Observability.
- Rollback.
- Audit evidence.

---

## 30. Summary

Multi-account and multi-environment strategy is not administrative overhead. It is core software architecture.

The main lessons:

1. AWS accounts are blast-radius boundaries.
2. Environment is not merely a config string.
3. Production should be isolated from non-production.
4. Cross-account access must be explicit, narrow, and auditable.
5. CI/CD should use temporary credentials and environment-specific deployment roles.
6. Artifacts should be built once and promoted, not rebuilt per environment.
7. Runtime config should be environment-specific and validated.
8. Lambda aliases, container image digests, and versioned artifacts enable safer deployment.
9. Rollback requires schema and event compatibility.
10. Deployment evidence is part of production readiness, especially for regulated systems.

A top-tier engineer does not only ask:

> Does this Java service work?

They ask:

> Can this service be safely deployed, audited, rolled back, isolated, and operated across environments without accidental cross-environment damage?

That is the level of thinking required for serious AWS-integrated Java systems.

---

## 31. References

- AWS Prescriptive Guidance — Multi-account strategy.
- AWS Organizations User Guide — Best practices for a multi-account environment.
- AWS Well-Architected Security Pillar — AWS account management and separation.
- AWS IAM User Guide — IAM roles and cross-account access.
- AWS IAM User Guide — Delegate access across AWS accounts using IAM roles.
- AWS Lambda Developer Guide — Lambda aliases and weighted alias routing for canary deployments.
- AWS Management and Governance Guide — Manage and govern with a multi-account point of view.
