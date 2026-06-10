# Strict General Standards: AWS

> Mandatory conventions for LLMs, code agents, and engineers when designing, generating, modifying, reviewing, or operating AWS infrastructure, AWS application integrations, IAM policies, networking, security controls, deployment pipelines, and cloud runtime configuration.

---

## 1. Purpose

This standard defines how AWS workloads must be designed, implemented, secured, deployed, observed, and governed.

AWS is not merely a hosting target. Every AWS resource creates operational, security, cost, compliance, data residency, blast-radius, and lifecycle consequences. An LLM/code agent must treat AWS configuration as production infrastructure code, not as disposable YAML/JSON/HCL/CDK boilerplate.

The goal is to prevent common cloud failures:

- Single-account sprawl.
- Over-permissive IAM.
- Public network exposure by accident.
- Unencrypted or weakly governed data.
- Missing audit logs.
- Manual production changes.
- Unbounded cost.
- Workloads that run but cannot be operated.
- Infrastructure that passes deployment but fails compliance, resilience, or incident response.

---

## 2. Scope

This standard applies to AWS-related work including:

- AWS Organizations and account structure.
- IAM, IAM Identity Center, STS, roles, policies, permission boundaries, SCPs.
- VPC, subnets, routing, security groups, NACLs, endpoints, gateways, load balancers.
- EC2, Auto Scaling, ECS, EKS, Lambda, Batch, and container/image runtime integrations.
- S3, EBS, EFS, RDS, Aurora, DynamoDB, ElastiCache, OpenSearch, Redshift, and backup controls.
- API Gateway, ALB/NLB, CloudFront, Route 53, WAF, Shield, ACM.
- SQS, SNS, EventBridge, Kinesis, MSK, Step Functions.
- CloudTrail, CloudWatch, AWS Config, Security Hub, GuardDuty, Inspector, Macie, Access Analyzer.
- KMS, Secrets Manager, Systems Manager Parameter Store.
- ECR, CodeBuild, CodePipeline, CodeDeploy, CodeArtifact, deployment automation.
- Terraform, CloudFormation, CDK, Pulumi, Helm/Kustomize for AWS-hosted workloads.
- Cost allocation, tagging, budgets, quota, lifecycle, retention, and cleanup.

This standard does not replace service-specific standards such as Kubernetes, Docker, PostgreSQL, Kafka, or OpenAPI. When AWS hosts those systems, both this AWS standard and the relevant domain-specific standard apply.

---

## 3. Core Baseline

### 3.1 AWS design must be Well-Architected

Every AWS design must explicitly consider the six AWS Well-Architected pillars:

- Operational excellence.
- Security.
- Reliability.
- Performance efficiency.
- Cost optimization.
- Sustainability.

**MUST:**

- State which pillar is affected by each major infrastructure decision.
- Explain trade-offs when a decision improves one pillar but weakens another.
- Prefer boring, supportable designs over clever, opaque designs.
- Design for day-2 operations: patching, rotation, incident response, scaling, failure, audit, and retirement.

**MUST NOT:**

- Generate AWS resources only to satisfy happy-path deployment.
- Ignore reliability, logging, backup, cost, and security because the task only asked for “working infra”.
- Treat AWS managed services as automatically secure, resilient, or cost-optimized without explicit configuration.

---

### 3.2 Shared responsibility must be explicit

An LLM/code agent must distinguish between what AWS secures and what the workload owner must configure.

**MUST document owner responsibility for:**

- IAM permissions.
- Data classification and encryption configuration.
- Network exposure.
- Secrets handling.
- Application authentication and authorization.
- Logging and monitoring.
- Backup and restore testing.
- Patch responsibility for unmanaged or self-managed components.
- Compliance evidence.

**MUST NOT:**

- Say “AWS handles security” as a blanket justification.
- Assume managed service means no customer-side configuration risk.

---

## 4. Account and Organization Standards

### 4.1 Multi-account is the default enterprise boundary

Production-grade AWS environments must use account boundaries to reduce blast radius.

**MUST use separate accounts or equivalent governed boundaries for:**

- Production workloads.
- Non-production workloads.
- Security tooling.
- Log archive.
- Shared networking.
- Shared services / platform tooling.
- Sandbox/experimentation where allowed.

**MUST NOT:**

- Put unrelated workloads, environments, and security logs into one unmanaged account.
- Give developers broad access to the management account.
- Use the management account for application workloads.

**Recommended account pattern:**

```text
organization-root
  security-ou
    security-tooling-account
    log-archive-account
  infrastructure-ou
    network-account
    shared-services-account
  workloads-ou
    dev-account
    staging-account
    production-account
  sandbox-ou
    sandbox-account-n
```

---

### 4.2 Landing zone must be governed

**MUST:**

- Prefer AWS Control Tower, AWS Organizations, or an equivalent governed landing zone.
- Enable centralized identity, logging, guardrails, and account vending.
- Define OUs by environment, risk, data classification, and operational ownership.
- Use SCPs for broad preventive guardrails.
- Keep emergency/break-glass access controlled, logged, and tested.

**MUST NOT:**

- Create accounts manually without standard baseline controls.
- Bypass landing-zone guardrails to “move faster”.
- Use SCPs as a replacement for workload-level least-privilege IAM.

---

### 4.3 Root user must be locked down

**MUST:**

- Enable MFA for root users.
- Store root credentials using approved break-glass process.
- Avoid root usage except for operations that require root.
- Monitor and alert on root login or root API usage.

**MUST NOT:**

- Use root credentials for deployment.
- Store root access keys.
- Generate automation that depends on root access.

---

## 5. Region, Availability Zone, and Data Residency Standards

### 5.1 Region choice must be explicit

**MUST define:**

- Primary AWS Region.
- Allowed secondary/DR Region if applicable.
- Data residency constraints.
- Latency-sensitive user geography.
- Service availability in selected Region.
- Cross-region replication and encryption requirements.

**MUST NOT:**

- Hardcode a default Region without explanation.
- Replicate regulated data cross-region without data classification approval.
- Assume every AWS service/feature is available in every Region.

---

### 5.2 Multi-AZ is the default for production stateful systems

**MUST:**

- Use at least two Availability Zones for production highly available workloads.
- Use Multi-AZ options for production databases where supported and justified.
- Spread load balancers, subnets, node groups, and critical services across AZs.
- Document single-AZ exceptions with RTO/RPO and business acceptance.

**MUST NOT:**

- Deploy production databases, NAT gateways, or critical workloads into a single AZ by accident.
- Claim high availability when all dependencies are single-AZ.

---

## 6. IAM and Identity Standards

### 6.1 Temporary credentials are mandatory by default

**MUST:**

- Use IAM roles and STS temporary credentials for workloads and human access.
- Use IAM Identity Center or federation for human workforce access where possible.
- Use workload identity mechanisms such as EC2 instance profiles, ECS task roles, EKS IRSA/EKS Pod Identity, and Lambda execution roles.
- Require MFA for privileged human access.

**MUST NOT:**

- Generate long-lived IAM access keys unless there is an explicit, documented exception.
- Put AWS access keys in source code, environment files, images, CI logs, Terraform variables, or application config.
- Use a single shared IAM user for teams, pipelines, or applications.

---

### 6.2 Least privilege is non-negotiable

**MUST:**

- Grant only required actions on required resources.
- Prefer resource-level permissions over `*` resources.
- Use condition keys such as `aws:SourceArn`, `aws:SourceAccount`, `aws:PrincipalArn`, `aws:PrincipalOrgID`, `aws:RequestedRegion`, and service-specific condition keys where appropriate.
- Separate administration permissions from data-plane use permissions.
- Use permission boundaries where teams can create roles/policies.
- Use Access Analyzer or equivalent review for external access and broad policies.

**MUST NOT:**

- Use `Action: "*"` or `Resource: "*"` without explicit break-glass or tightly controlled administrative justification.
- Attach AWS-managed administrator policies to application roles.
- Give CI/CD roles broad account admin access.
- Depend on deny-by-obscurity through naming conventions.

**Bad:**

```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```

**Better:**

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::example-prod-documents/*",
  "Condition": {
    "StringEquals": {
      "aws:PrincipalOrgID": "o-example"
    }
  }
}
```

---

### 6.3 IAM policy generation rules for LLMs

When generating IAM, an LLM/code agent **MUST output**:

- Principal.
- Allowed actions.
- Denied actions if required.
- Resource ARNs.
- Conditions.
- Trust policy.
- Permission boundary if applicable.
- Intended caller/runtime.
- Why each permission is required.

**MUST NOT:**

- Generate broad policy first and promise to refine later.
- Use wildcard because exact ARN is unknown without marking it as a placeholder.
- Mix human admin permissions and workload runtime permissions in one role.

---

## 7. Network Standards

### 7.1 VPC design must describe traffic paths

A VPC is a network boundary. Every generated network design must explain ingress, egress, east-west traffic, and private service access.

**MUST define:**

- VPC CIDR and IP growth assumptions.
- Public subnet purpose.
- Private application subnet purpose.
- Private data subnet purpose.
- Route table behavior.
- Internet Gateway usage.
- NAT Gateway or egress alternative.
- VPC endpoints.
- Transit Gateway / peering / VPN / Direct Connect if used.
- DNS behavior.
- Flow logging.

**MUST NOT:**

- Put private application or database resources in public subnets by default.
- Expose resources directly to the internet when an ALB/API Gateway/CloudFront pattern is appropriate.
- Use one flat subnet design for all workloads.

---

### 7.2 Public exposure must be intentional

**MUST:**

- Default workloads to private subnets.
- Put only internet-facing load balancers, NAT gateways, bastion alternatives, or explicitly public services in public subnets.
- Require TLS for public endpoints.
- Restrict security groups to required ports and sources.
- Use WAF/CloudFront/API Gateway/ALB controls where appropriate.

**MUST NOT:**

- Open `0.0.0.0/0` or `::/0` to SSH, RDP, database ports, admin ports, metrics ports, or broker ports.
- Give EC2 instances public IPs unless explicitly justified.
- Treat a public IP as an acceptable admin access strategy.

---

### 7.3 Security groups and NACLs must not be confused

**MUST:**

- Use security groups as primary workload-level stateful firewall controls.
- Use NACLs only when subnet-level stateless controls are justified.
- Prefer security group references for service-to-service traffic where possible.
- Keep rules minimal and documented.

**MUST NOT:**

- Use NACLs to compensate for poor security group design.
- Generate broad inbound rules to “make it work”.
- Ignore IPv6 exposure when IPv6 is enabled.

---

### 7.4 Egress must be governed

**MUST:**

- Define expected outbound destinations.
- Use VPC endpoints for AWS service access when appropriate.
- Control outbound internet access via NAT, proxy, firewall, or service endpoint pattern.
- Log and monitor outbound traffic.
- Consider SSRF risk for workloads that can call arbitrary URLs.

**MUST NOT:**

- Allow unrestricted egress for sensitive workloads without justification.
- Assume private subnet means no outbound data exfiltration risk.

---

## 8. Encryption and Key Management Standards

### 8.1 Encryption must be explicit

**MUST:**

- Encrypt data at rest for storage, database, logs, snapshots, queues, and backups.
- Use TLS for data in transit.
- Define when AWS-managed keys are sufficient and when customer-managed KMS keys are required.
- Define key ownership, rotation policy, deletion protection, and recovery process.

**MUST NOT:**

- Leave encryption to service defaults without documenting them.
- Disable TLS verification to bypass certificate or proxy issues.
- Store sensitive data in unencrypted logs, parameters, AMIs, EBS snapshots, or S3 buckets.

---

### 8.2 KMS key policy must follow least privilege

**MUST:**

- Separate key administrators from key users.
- Avoid `kms:*` except tightly governed key administration policies.
- Use `kms:ViaService`, encryption context, `aws:SourceArn`, and `aws:SourceAccount` where applicable.
- Scope key usage to required services/resources.
- Monitor key usage and failed decrypt attempts.

**MUST NOT:**

- Give application roles permission to administer or delete keys.
- Reuse one global customer-managed key for unrelated data domains.
- Delete keys without documented recovery and retention review.

---

## 9. Secrets and Configuration Standards

### 9.1 Secrets must be managed by approved secret stores

**MUST:**

- Use AWS Secrets Manager, SSM Parameter Store with encryption, or an approved external vault.
- Rotate secrets where supported and required.
- Restrict secret read permissions to exact workloads.
- Log access patterns without logging secret values.
- Separate secrets from non-sensitive configuration.

**MUST NOT:**

- Commit secrets to Git.
- Put secrets in Docker images, AMIs, user-data scripts, Terraform state without encryption controls, or plaintext CI variables.
- Print secrets in deployment logs or application logs.

---

### 9.2 Configuration must be environment-aware but not image-baked

**MUST:**

- Externalize environment-specific config.
- Validate required config at startup.
- Version config changes through IaC or approved configuration management.
- Avoid changing production config manually from console.

**MUST NOT:**

- Build separate application images only to change environment variables.
- Use one shared config blob for unrelated workloads.

---

## 10. Logging, Audit, and Compliance Standards

### 10.1 CloudTrail must be centralized

**MUST:**

- Enable CloudTrail for all accounts and all Regions through an organization trail where possible.
- Store CloudTrail logs in a dedicated log archive account or equivalent protected account.
- Encrypt CloudTrail logs.
- Enable log file validation where required.
- Restrict write/delete access to log buckets.
- Monitor high-risk API activity such as root login, IAM policy change, security group opening, key deletion, trail stop/delete, and public S3 policy changes.

**MUST NOT:**

- Disable CloudTrail in production.
- Store audit logs in the same account where compromised workloads can freely delete them.
- Treat application logs as a replacement for AWS audit logs.

---

### 10.2 AWS Config and resource compliance must be enabled for governed environments

**MUST:**

- Record configuration changes for relevant resource types.
- Evaluate compliance rules for security-critical resources.
- Track drift from approved configuration.
- Retain compliance history according to policy.

**MUST NOT:**

- Rely only on IaC state to know what exists.
- Ignore console/manual drift.

---

### 10.3 Security services must be part of baseline controls

**SHOULD enable where applicable:**

- GuardDuty for threat detection.
- Security Hub for centralized findings and security posture.
- Inspector for vulnerability scanning.
- Macie for sensitive data discovery in S3.
- IAM Access Analyzer for external access and policy analysis.
- AWS Config managed/custom rules.

**MUST:**

- Define finding ownership and response workflow.
- Avoid enabling tools without triage ownership.

---

## 11. Compute Standards

### 11.1 EC2 must be treated as managed infrastructure, not pets

**MUST:**

- Use Auto Scaling Groups for horizontally scalable services.
- Use immutable AMIs or automated bootstrap with idempotent configuration.
- Require IMDSv2.
- Use instance profiles instead of access keys.
- Use SSM Session Manager instead of SSH where possible.
- Patch OS/runtime through approved automation.
- Encrypt EBS volumes.
- Avoid public IPs unless justified.

**MUST NOT:**

- Manually configure production EC2 instances without IaC/automation.
- Store credentials on instances.
- Use SSH bastions as default admin strategy when SSM/private access is available.

---

### 11.2 Containers on AWS must obey both AWS and container standards

For ECS, EKS, or self-managed container workloads:

**MUST:**

- Use workload-specific IAM roles.
- Pull images from governed registries such as ECR or approved private registries.
- Scan images for vulnerabilities.
- Pin image versions.
- Define resource requests/limits or ECS CPU/memory reservations.
- Send logs to central logging.
- Handle graceful shutdown and signal propagation.

**MUST NOT:**

- Run containers with over-privileged roles.
- Reuse node/instance roles as application roles.
- Deploy `latest` images to production.

---

### 11.3 Lambda must be designed as an event-driven runtime

**MUST:**

- Define timeout, memory, concurrency, retry, and DLQ/destination behavior.
- Use least-privilege execution roles.
- Keep secrets out of code packages.
- Avoid excessive cold-start dependencies.
- Make handlers idempotent when triggered by retryable sources.
- Use structured logs with correlation IDs.

**MUST NOT:**

- Use Lambda for long-running tasks beyond service limits.
- Ignore partial failure behavior for batch event sources.
- Put business-critical state only in memory or `/tmp`.

---

## 12. Data and Storage Standards

### 12.1 S3 must be private by default

**MUST:**

- Enable Block Public Access unless the bucket is intentionally public and approved.
- Use bucket policies with explicit least privilege.
- Encrypt objects at rest.
- Enable versioning for critical buckets.
- Use lifecycle policies for retention and cost control.
- Use Object Lock where immutable retention is required.
- Avoid object key designs that expose sensitive identifiers.
- Log data access where required.

**MUST NOT:**

- Use public-read ACLs as a shortcut.
- Store secrets, tokens, or unredacted regulated data without classification and controls.
- Allow broad cross-account access without `aws:PrincipalOrgID`, explicit principals, or equivalent controls.

---

### 12.2 RDS/Aurora must be production-hardened

**MUST:**

- Use private subnets.
- Disable public accessibility unless explicitly approved.
- Enable encryption at rest.
- Use Multi-AZ for production where availability requires it.
- Enable automated backups and define retention.
- Test restore procedures.
- Use parameter groups intentionally.
- Use Secrets Manager or equivalent for credentials.
- Restrict security groups to application sources.
- Enable database logging/audit features where required.

**MUST NOT:**

- Expose database ports publicly.
- Share one database user with broad permissions across applications.
- Treat snapshots as non-sensitive.

---

### 12.3 DynamoDB must be designed around access patterns

**MUST:**

- Define partition key and sort key from query/access patterns.
- Document hot partition risk.
- Define capacity mode intentionally.
- Use conditional writes for concurrency and idempotency where appropriate.
- Define TTL, streams, backup, and point-in-time recovery requirements.
- Avoid scans on production paths unless bounded and justified.

**MUST NOT:**

- Model DynamoDB as a generic relational database.
- Add GSIs without ownership, cost, and query justification.

---

### 12.4 Backups must be restorable

**MUST:**

- Define RPO and RTO.
- Enable backup for stateful production resources.
- Encrypt backups.
- Protect backups from accidental or malicious deletion.
- Test restore regularly.
- Document restore runbook.

**MUST NOT:**

- Claim data is protected only because snapshots exist.
- Store backups in the same blast radius without deletion protection where policy requires isolation.

---

## 13. Edge, API, and Traffic Standards

### 13.1 Public traffic must pass through managed ingress controls

**MUST:**

- Use CloudFront, ALB/NLB, API Gateway, or approved ingress pattern.
- Terminate TLS with ACM-managed certificates where possible.
- Redirect HTTP to HTTPS where applicable.
- Use WAF for public endpoints with meaningful risk exposure.
- Define rate limiting, request size limits, and timeout behavior.
- Propagate request IDs and trace context.

**MUST NOT:**

- Expose application instances directly to internet traffic.
- Depend solely on security group rules for API abuse protection.
- Put domain authorization decisions only at the edge when object-level authorization belongs in the application/service.

---

### 13.2 DNS and certificate ownership must be clear

**MUST:**

- Manage Route 53 zones with ownership and change control.
- Use ACM for TLS certificates where supported.
- Define certificate renewal expectations.
- Avoid wildcard certificates unless justified.
- Monitor certificate expiration for non-ACM or imported certificates.

**MUST NOT:**

- Create ad-hoc DNS records without environment, ownership, and deletion policy.

---

## 14. Messaging and Eventing Standards

### 14.1 SQS/SNS/EventBridge must be designed with failure semantics

**MUST:**

- Define message ownership and schema.
- Use DLQs for retryable asynchronous flows.
- Define visibility timeout, retention, max receive count, and redrive policy.
- Make consumers idempotent.
- Define ordering requirements before choosing FIFO.
- Define event bus permissions and cross-account routing explicitly.

**MUST NOT:**

- Assume at-most-once delivery.
- Use queues to hide synchronous business coupling without retry and compensation design.
- Ignore poison message handling.

---

### 14.2 Step Functions must model workflow state, not arbitrary code sprawl

**MUST:**

- Use Step Functions for visible, retryable, auditable workflows.
- Define retry/catch policies.
- Define timeout and compensation behavior.
- Keep business invariants in domain services where appropriate.

**MUST NOT:**

- Turn Step Functions into an unreviewable spaghetti orchestration layer.
- Put secrets or sensitive payloads into state history without retention/classification review.

---

## 15. Infrastructure as Code Standards

### 15.1 Production AWS resources must be IaC-managed

**MUST:**

- Use Terraform, CloudFormation, CDK, Pulumi, or approved IaC.
- Keep IaC versioned, reviewed, tested, and environment-aware.
- Validate plans before apply.
- Use remote state with encryption and locking where applicable.
- Detect and reconcile drift.
- Use policy-as-code for mandatory controls.

**MUST NOT:**

- Create production resources manually unless emergency process requires it.
- Store plaintext secrets in IaC state.
- Use generated random names that break operations unless mapped with tags/outputs.

---

### 15.2 LLM-generated IaC must be reviewable

When generating IaC, an LLM/code agent **MUST include**:

- Resource purpose.
- Ownership tags.
- Environment boundary.
- IAM role/policy explanation.
- Network exposure explanation.
- Encryption decisions.
- Logging decisions.
- Backup/retention decisions.
- Cost-impacting resources.
- Destroy/retention behavior.

**MUST NOT:**

- Generate incomplete “example-only” IaC without marking it as non-production.
- Hide dangerous defaults behind modules.
- Use public modules without version pinning and review.

---

## 16. Tagging and Cost Governance Standards

### 16.1 Tags are mandatory operational metadata

**MUST tag resources with:**

```text
Environment = dev | test | staging | prod
Application = <application-name>
Service = <service-name>
Owner = <team-or-email>
CostCenter = <cost-center>
DataClassification = public | internal | confidential | restricted
ManagedBy = terraform | cloudformation | cdk | pulumi | manual-exception
Criticality = low | medium | high | mission-critical
```

**SHOULD tag with:**

```text
Repository = <repo-url-or-name>
ChangeTicket = <ticket-id>
ExpiryDate = <date-for-temporary-resources>
BackupPolicy = <policy-name>
ComplianceScope = <scope-name>
```

**MUST NOT:**

- Create unowned resources.
- Create temporary resources without expiration/cleanup policy.
- Use inconsistent tag keys across accounts/environments.

---

### 16.2 Cost visibility must be designed upfront

**MUST:**

- Activate cost allocation tags where applicable.
- Use budgets/alerts for accounts and workloads.
- Identify high-cost services in generated designs.
- Define lifecycle/retention policies for logs, snapshots, S3 objects, metrics, and backups.
- Prefer autoscaling and right-sizing over static overprovisioning.
- Document NAT Gateway, data transfer, CloudWatch, KMS, cross-AZ, and log ingestion cost implications where material.

**MUST NOT:**

- Create always-on expensive resources for dev/test without schedule or justification.
- Ignore data transfer and observability cost.
- Treat cost optimization as a later cleanup task.

---

## 17. Observability Standards

### 17.1 Every workload must be diagnosable

**MUST:**

- Emit structured application logs.
- Send infrastructure logs to centralized logging.
- Define metrics and alarms for availability, latency, errors, saturation, queue lag, database health, and cost anomalies.
- Propagate correlation IDs and trace context.
- Use CloudWatch, OpenTelemetry, X-Ray, Prometheus/Grafana, or approved observability tooling.
- Define runbooks for high-severity alarms.

**MUST NOT:**

- Deploy workloads with no alarms.
- Alert on every low-level metric without user/business impact mapping.
- Log secrets, tokens, PII, or regulated data.

---

## 18. Resilience and Disaster Recovery Standards

### 18.1 Failure modes must be explicit

**MUST document:**

- Single-AZ failure behavior.
- Region impairment behavior.
- Database failover behavior.
- Queue backlog behavior.
- Downstream dependency timeout behavior.
- Retry and circuit breaker policy.
- Backup restore behavior.
- RTO and RPO.

**MUST NOT:**

- Claim resilience only because a service is “managed”.
- Retry indefinitely without backoff and idempotency.
- Put all critical dependencies behind one untested path.

---

### 18.2 Production changes must be reversible

**MUST:**

- Use rolling, blue/green, canary, or controlled deployment strategies where appropriate.
- Define rollback for application and infrastructure changes.
- Protect stateful changes with migration plans and backups.
- Use feature flags where release risk warrants it.

**MUST NOT:**

- Apply destructive schema/data/storage/network changes without rollback or recovery plan.

---

## 19. Service-Specific Minimum Baselines

### 19.1 ECR

**MUST:**

- Enable image scanning or approved registry scanning.
- Use lifecycle policies.
- Restrict push/pull access by role.
- Avoid mutable production tags or enforce digest-based deployment.

---

### 19.2 ALB/NLB

**MUST:**

- Use TLS listeners for public traffic.
- Restrict security groups.
- Configure health checks meaningfully.
- Enable access logs where required.
- Set idle timeouts intentionally.

---

### 19.3 API Gateway

**MUST:**

- Define authn/authz boundary.
- Define throttling and quotas.
- Use stage-level logging/metrics.
- Validate request size and schema where appropriate.
- Avoid embedding domain authorization only in gateway mappings.

---

### 19.4 CloudFront

**MUST:**

- Use TLS.
- Define cache behavior and origin policy.
- Use OAC/OAI or equivalent private origin controls for S3 origins.
- Attach WAF when public risk warrants it.
- Avoid caching sensitive/private responses incorrectly.

---

### 19.5 WAF

**MUST:**

- Define scope, rule groups, logging, alerting, and false-positive process.
- Use rate-based rules for public endpoints where appropriate.
- Avoid treating WAF as a replacement for application security.

---

## 20. LLM AWS Design Decision Algorithm

Before generating AWS implementation, an LLM/code agent **MUST** run this decision sequence:

1. **Classify workload**: app, data store, queue, API, analytics, batch, ML, integration, security, platform.
2. **Classify environment**: dev/test/staging/prod/sandbox.
3. **Classify data**: public/internal/confidential/restricted.
4. **Define account boundary**: account, OU, region, owner.
5. **Define identity**: human access, workload role, CI/CD role, trust policy.
6. **Define network path**: ingress, egress, private AWS service access, DNS.
7. **Define encryption**: at rest, in transit, KMS key owner.
8. **Define logs/audit**: CloudTrail, service logs, app logs, retention.
9. **Define resilience**: AZ, backup, restore, RTO/RPO.
10. **Define cost controls**: tags, budgets, lifecycle, scaling.
11. **Define deployment model**: IaC, pipeline, rollback, drift detection.
12. **Define compliance evidence**: config rules, security findings, audit trail.

If any item is unknown, the LLM/code agent must either ask for clarification or generate conservative safe defaults and clearly mark assumptions.

---

## 21. Anti-Patterns

### 21.1 Single-account everything

**Problem:** All environments, logs, workloads, and admin access live in one account.

**Why it is dangerous:** Blast radius, audit integrity, cost allocation, and permission boundaries collapse.

**Required correction:** Use multi-account structure with centralized security/logging.

---

### 21.2 IAM admin as shortcut

**Problem:** Roles/policies use `AdministratorAccess`, `Action: *`, or `Resource: *` to avoid permission design.

**Why it is dangerous:** Any workload compromise becomes account compromise.

**Required correction:** Generate least-privilege policies and explain every permission.

---

### 21.3 Public subnet database

**Problem:** RDS, broker, cache, admin panel, or internal service is deployed in a public subnet or has public accessibility.

**Why it is dangerous:** Misconfiguration can expose data-plane access to the internet.

**Required correction:** Use private subnets, restricted security groups, and controlled ingress paths.

---

### 21.4 Logs in same blast radius

**Problem:** Audit logs are stored where compromised workload administrators can delete them.

**Why it is dangerous:** Attackers can erase evidence.

**Required correction:** Central log archive account, restricted write-only delivery, encryption, integrity validation where required.

---

### 21.5 Secrets in IaC or runtime config

**Problem:** Secrets appear in Terraform variables, CloudFormation parameters, Lambda env vars, ECS task definitions, Kubernetes manifests, or code.

**Why it is dangerous:** Secrets leak through state, logs, console, artifacts, backups, or image layers.

**Required correction:** Use Secrets Manager/SSM/Vault and workload identity.

---

### 21.6 Default VPC production deployment

**Problem:** Production is deployed into a default VPC with unmanaged subnets/security groups.

**Why it is dangerous:** No explicit network architecture, routing, logging, or segmentation.

**Required correction:** Create governed VPC with explicit subnet tiers, routing, endpoints, flow logs, and exposure model.

---

### 21.7 No RTO/RPO but “highly available” claim

**Problem:** System claims HA/DR without tested recovery targets.

**Why it is dangerous:** Architecture is unverifiable.

**Required correction:** Define RTO/RPO, test restore/failover, and align resource choices accordingly.

---

### 21.8 Cost-blind architecture

**Problem:** Resources are oversized, logs retained forever, NAT/data transfer ignored, dev resources always on.

**Why it is dangerous:** Cloud spend grows without ownership.

**Required correction:** Tag, budget, lifecycle, autoscale, right-size, and review cost drivers.

---

## 22. Review Checklist

Before approving AWS implementation, verify:

### Account and governance

- [ ] Correct account and OU are used.
- [ ] Management account is not used for workloads.
- [ ] Environment separation is explicit.
- [ ] SCP/guardrail impact is understood.

### IAM

- [ ] No unnecessary long-lived access keys.
- [ ] Workloads use roles/temporary credentials.
- [ ] Policies are least privilege.
- [ ] Trust policies are scoped.
- [ ] Privileged access requires MFA/federation.

### Network

- [ ] Public/private/data subnet model is explicit.
- [ ] Databases/caches/internal services are private.
- [ ] Security groups are minimal.
- [ ] Egress is controlled.
- [ ] VPC Flow Logs are enabled where required.

### Security

- [ ] Encryption at rest is defined.
- [ ] TLS/in-transit encryption is defined.
- [ ] KMS key policies are least privilege.
- [ ] Secrets are not embedded in code/IaC/images.
- [ ] CloudTrail and security monitoring are enabled.

### Reliability

- [ ] Multi-AZ behavior is defined.
- [ ] Backup and restore are configured.
- [ ] RTO/RPO are documented.
- [ ] Retry/timeout/idempotency behavior is defined.
- [ ] Deployment rollback is possible.

### Observability

- [ ] Logs, metrics, traces, and audit events are covered.
- [ ] Alarms have ownership and runbooks.
- [ ] Retention policy is defined.
- [ ] Sensitive data is redacted.

### Cost

- [ ] Required tags exist.
- [ ] Budgets/alerts are considered.
- [ ] Lifecycle policies exist for storage/logs/backups.
- [ ] Expensive resources are justified.
- [ ] Dev/test cost controls exist.

### IaC

- [ ] Resources are generated through approved IaC.
- [ ] State is encrypted and locked.
- [ ] Modules/providers are version-pinned.
- [ ] Plan/apply workflow is reviewed.
- [ ] Drift detection is considered.

---

## 23. Acceptance Criteria

AWS implementation is acceptable only when:

1. Account/environment boundary is explicit.
2. IAM uses least privilege and temporary credentials.
3. Public exposure is intentional and minimized.
4. Sensitive data is encrypted and secrets are managed securely.
5. Audit logs and security monitoring are enabled or explicitly justified.
6. Stateful resources have backup/restore strategy.
7. Workloads have observability and incident response hooks.
8. Cost allocation tags and cost controls are present.
9. Infrastructure is managed by IaC.
10. Dangerous defaults are replaced with production-safe defaults.

---

## 24. Enforcement Snippet for LLM/Code Agent

Use this instruction in agent prompts:

```text
When generating or modifying AWS infrastructure, you MUST follow strict-general-standards__aws.md.

Before writing resources, classify account, environment, data sensitivity, network exposure, IAM principal, encryption, logging, resilience, and cost impact.

Never generate production AWS resources with broad IAM, public database/cache/broker exposure, plaintext secrets, missing CloudTrail/logging assumptions, unmanaged manual changes, or untagged resources.

For every AWS resource, include ownership, environment, IAM boundary, network boundary, encryption/logging behavior, lifecycle/retention, and operational failure assumptions.

If a safe production value is unknown, use conservative secure defaults and mark assumptions clearly.
```

---

## 25. References

- AWS Well-Architected Framework: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- AWS Well-Architected pillars: https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html
- AWS IAM best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- AWS IAM temporary security credentials: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html
- AWS IAM access key best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
- AWS VPC security best practices: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-best-practices.html
- AWS Control Tower landing zone guidance: https://docs.aws.amazon.com/controltower/latest/userguide/aws-multi-account-landing-zone.html
- AWS CloudTrail security best practices: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/best-practices-security.html
- AWS Config overview: https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html
- AWS KMS encryption best practices: https://docs.aws.amazon.com/prescriptive-guidance/latest/encryption-best-practices/kms.html
- AWS cost allocation tagging: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html