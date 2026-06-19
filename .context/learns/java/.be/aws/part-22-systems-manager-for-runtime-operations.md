# Part 22 — Systems Manager for Runtime Operations

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Previous: Part 21 — EventBridge and Scheduler for Java Engineers  
Next: Part 23 — DynamoDB for Java Engineers

---

## 1. Purpose of This Part

Pada part sebelumnya kita banyak membahas service yang berada di jalur aplikasi: S3, SQS, SNS, Lambda, EventBridge, Secrets Manager, Parameter Store, dan KMS. Part ini membahas **AWS Systems Manager**, tetapi dari perspektif yang berbeda: bukan sebagai sekadar tempat menyimpan parameter, melainkan sebagai **operational plane**.

AWS Systems Manager membantu kita melihat, mengelola, dan mengoperasikan node pada AWS, on-premises, dan multicloud environment secara terpusat. Dalam dokumentasi AWS, Systems Manager diposisikan sebagai service untuk operasi fleet, automation, visibility, dan management pada skala besar. Referensi resmi: <https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-systems-manager.html>

Untuk engineer Java, pertanyaan utamanya bukan “bagaimana memanggil API SSM?”, tetapi:

1. Kapan aplikasi Java boleh memanggil Systems Manager?
2. Kapan Systems Manager seharusnya dipakai oleh operator, pipeline, atau incident automation, bukan oleh aplikasi?
3. Bagaimana mendesain operational action yang aman, audit-able, idempotent, dan least-privilege?
4. Bagaimana membedakan runtime configuration, remote command, automation runbook, session access, inventory, patching, dan incident item?
5. Bagaimana menghindari anti-pattern seperti aplikasi production yang tiba-tiba menjalankan command ke server?

Part ini membangun mental model agar Systems Manager tidak dipakai secara sembarangan. Banyak fitur SSM sangat powerful, sehingga boundary-nya harus jelas.

---

## 2. Core Mental Model: SSM Is an Operational Control Plane

Bayangkan sistem production memiliki beberapa plane:

```text
+---------------------------------------------------------------+
| Business Plane                                                 |
| - case lifecycle                                               |
| - payment                                                      |
| - application submission                                       |
| - document verification                                        |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
| Application Runtime Plane                                      |
| - Java service                                                 |
| - Lambda function                                              |
| - worker                                                       |
| - HTTP API                                                     |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
| Data Plane                                                     |
| - S3 object                                                    |
| - SQS message                                                  |
| - database row                                                 |
| - DynamoDB item                                                |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
| Identity and Secret Plane                                      |
| - IAM role                                                     |
| - STS session                                                  |
| - KMS key                                                      |
| - Secrets Manager                                              |
| - Parameter Store                                              |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
| Operational Control Plane                                      |
| - Systems Manager Run Command                                  |
| - Systems Manager Session Manager                              |
| - Systems Manager Automation                                   |
| - Systems Manager OpsCenter                                    |
| - Systems Manager Inventory                                    |
| - Systems Manager Patch Manager                                |
+---------------------------------------------------------------+
```

Systems Manager mostly belongs to the **operational control plane**. That means its main job is not to process a business request, but to help humans and automation operate infrastructure and runtime components.

This distinction matters.

A Java API service should normally not say:

```text
When a user clicks submit, run shell command on instance X.
```

That couples business logic to infrastructure operations. It also creates frightening security and audit implications.

A better model is:

```text
Business request -> domain service -> event/command -> controlled automation boundary -> audited operational action
```

Even then, most operational actions should be executed by deployment pipeline, incident automation, scheduled maintenance, or operator approval workflow, not arbitrary application code.

---

## 3. Systems Manager Capability Map

Systems Manager is a large service family. For this series, we focus on capabilities most relevant to Java backend/cloud integration.

```text
AWS Systems Manager
|
+-- Parameter Store
|   +-- String
|   +-- StringList
|   +-- SecureString
|   +-- hierarchy: /app/env/component/key
|
+-- Run Command
|   +-- remote command execution on managed nodes
|   +-- one-time administrative task
|   +-- fleet-wide command
|
+-- Session Manager
|   +-- shell access without inbound SSH
|   +-- IAM-controlled session
|   +-- session logging
|
+-- Automation
|   +-- runbooks
|   +-- remediation workflow
|   +-- AWS API actions
|   +-- approval steps
|   +-- controlled operational process
|
+-- OpsCenter
|   +-- OpsItems
|   +-- operational issue tracking
|   +-- related resources
|   +-- runbook association
|
+-- Inventory
|   +-- collect metadata from managed nodes
|   +-- installed applications
|   +-- instance properties
|   +-- compliance context
|
+-- Patch Manager
|   +-- patch baselines
|   +-- patch groups
|   +-- maintenance windows
|   +-- compliance reporting
|
+-- State Manager
|   +-- desired state association
|   +-- recurring configuration enforcement
|
+-- Maintenance Windows
    +-- controlled time window for operational tasks
```

AWS describes Run Command as a way to remotely and securely manage configuration of managed nodes and perform common administrative tasks or one-time configuration changes at scale. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html>

AWS describes Automation as a capability that simplifies maintenance, deployment, and remediation tasks across AWS services. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-automation.html>

Session Manager is used to start interactive sessions with managed nodes without requiring traditional inbound SSH access, subject to IAM and session configuration. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html>

OpsCenter provides OpsItems and operational issue management, including links to resources and Automation runbooks. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/OpsCenter.html>

Patch Manager automates patching of managed nodes and compliance visibility. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html>

---

## 4. Java Engineer Decision Model

Before writing Java code against Systems Manager, ask this:

```text
Is this application runtime behavior, configuration retrieval, operational automation, or human incident operation?
```

### 4.1 Runtime Configuration

Examples:

- Read `/aceas/prod/onemap/base-url`.
- Read `/billing/uat/feature/max-retry`.
- Read `/case/prod/notification/template-version`.

This belongs to **Parameter Store** or config service.

A Java app can reasonably call `GetParameter` or `GetParametersByPath`, with caching and failure fallback.

### 4.2 Secret Retrieval

Examples:

- Database password.
- Third-party API client secret.
- OAuth private key reference.

Prefer **Secrets Manager** for secrets that rotate or need secret lifecycle. Parameter Store `SecureString` can be acceptable for lower-complexity secure config, but do not treat it as identical to Secrets Manager.

This was covered in Part 11.

### 4.3 Remote Command Execution

Examples:

- Restart agent on EC2.
- Clear temporary directory.
- Rotate local log file.
- Run diagnostic command.

This belongs to **Run Command**, but normally not from user-facing Java code.

Acceptable callers:

- operator tool
- incident automation
- CI/CD pipeline
- approved internal admin service
- scheduled maintenance automation

High-risk callers:

- public API endpoint
- business transaction service
- user-triggered web action without approval
- Lambda called by untrusted event

### 4.4 Interactive Access

Examples:

- Operator needs shell into managed node.
- Production support wants to inspect logs or filesystem.

This belongs to **Session Manager**, not application code.

A Java application almost never needs to initiate Session Manager sessions.

### 4.5 Operational Workflow

Examples:

- Stop instance, take snapshot, patch, restart, verify health.
- Rotate a certificate and validate service endpoint.
- Quarantine suspicious EC2 instance.
- Redrive DLQ after validation.

This belongs to **Automation runbook**.

A Java application might call `StartAutomationExecution` only if it is an internal operations system with strict authorization and audit.

### 4.6 Incident Tracking

Examples:

- Create operational issue when DLQ crosses threshold.
- Attach affected resource and alarm.
- Link runbook for remediation.

This belongs to **OpsCenter** or incident management system.

A Java system can create OpsItems for operational signals, but must avoid flooding.

---

## 5. Systems Manager and Application Boundary

A strong production design keeps boundaries explicit.

### 5.1 Allowed Application-Level SSM Usage

Common acceptable usage:

```text
Java service startup
  -> load non-secret config from Parameter Store
  -> cache values
  -> expose config source in diagnostics
```

```text
Java internal ops service
  -> receives authenticated operator action
  -> validates RBAC
  -> writes audit event
  -> starts Automation runbook
  -> tracks status
```

```text
Java monitoring/remediation service
  -> receives CloudWatch/EventBridge operational signal
  -> de-duplicates
  -> opens OpsItem or starts approved runbook
```

### 5.2 Suspicious or Dangerous Usage

Avoid designs like:

```text
Public REST endpoint
  -> request parameter contains command
  -> Java app calls SendCommand
  -> command executes on EC2
```

```text
Business transaction failure
  -> Java service automatically restarts infrastructure
```

```text
Every request
  -> GetParameter from SSM
```

```text
Lambda handler
  -> creates Session Manager session
```

These are not merely implementation smells; they indicate wrong plane coupling.

---

## 6. Managed Node Mental Model

Many Systems Manager capabilities operate on **managed nodes**.

A managed node is not just “an EC2 instance”. It is a compute node that has been configured for Systems Manager management. It may be EC2, on-premises server, edge device, or multicloud machine, depending on setup.

For EC2, typical requirements include:

```text
EC2 instance
  + SSM Agent installed/running
  + IAM instance profile with SSM permissions
  + network path to Systems Manager endpoints
  + correct region
  + node registered/visible in SSM
```

If any one is missing, Run Command/Session Manager/Inventory may fail even if the EC2 instance is healthy.

### 6.1 Production Debug Checklist

When command/session does not work, check:

1. Is SSM Agent installed?
2. Is SSM Agent running?
3. Does the instance profile include required permissions?
4. Is the instance in the same region you are querying?
5. Does the VPC have outbound internet or VPC endpoints for SSM-related services?
6. Is the OS supported?
7. Does the node appear in Fleet Manager/Managed Instances?
8. Is the target tag correct?
9. Is there an SCP/permission boundary blocking action?
10. Is KMS involved for session logging/output encryption?

---

## 7. SDK Model: `SsmClient` and `SsmAsyncClient`

AWS SDK for Java 2.x provides `SsmClient` for Systems Manager access. The API reference identifies `SsmClient` as the service client for Amazon SSM and notes it can be created using the static builder method. Reference: <https://sdk.amazonaws.com/java/api/latest/software/amazon/awssdk/services/ssm/SsmClient.html>

Basic dependency example:

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
    <artifactId>ssm</artifactId>
  </dependency>
</dependencies>
```

Basic client:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ssm.SsmClient;

public final class SsmClients {
    private SsmClients() {}

    public static SsmClient create(Region region) {
        return SsmClient.builder()
                .region(region)
                .build();
    }
}
```

In production, reuse the client. Do not create a new `SsmClient` per call.

```text
Good:
  one client per region per service lifetime

Bad:
  new SsmClient for every request
```

The AWS SDK for Java 2.x Systems Manager examples provide official code examples for operations like parameters and commands. Reference: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_ssm_code_examples.html>

---

## 8. Parameter Store Recap from an Operational Perspective

Part 11 already covered Secrets Manager and Parameter Store in detail. Here we revisit Parameter Store only as part of operational runtime.

### 8.1 Good Parameter Naming

Use hierarchy:

```text
/{system}/{environment}/{component}/{name}
```

Examples:

```text
/aceas/prod/case-service/sqs/queue-url
/aceas/prod/case-service/s3/bucket-name
/aceas/prod/common/onemap/base-url
/aceas/uat/notification/sns/topic-arn
```

Avoid:

```text
/db/password
/prod/url
/config1
/latestValue
```

### 8.2 Startup Loading vs Runtime Loading

Three common strategies:

```text
Startup loading
  - fail fast if config missing
  - predictable
  - good for required config

Lazy loading
  - load when first needed
  - can reduce startup cost
  - risk: production failure appears late

Periodic refresh
  - supports runtime tuning
  - needs version/validation/fallback
  - must avoid noisy SSM calls
```

### 8.3 Config Failure Policy

For each config, decide:

```text
required?      yes/no
safe default?  yes/no
cacheable?     yes/no
mutable?       yes/no
sensitive?     yes/no
```

Example table:

| Parameter | Required | Safe Default | Cache TTL | Failure Behavior |
|---|---:|---:|---:|---|
| SQS queue URL | yes | no | process lifetime | fail startup |
| feature flag | no | yes | 60 sec | use default |
| external endpoint | yes | no | 5 min | fail startup or circuit open |
| batch size | no | yes | 60 sec | use last known good |

### 8.4 Java Config Loader Pattern

```java
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.GetParameterRequest;
import software.amazon.awssdk.services.ssm.model.ParameterNotFoundException;
import software.amazon.awssdk.services.ssm.model.SsmException;

import java.util.Objects;

public final class ParameterStoreConfigSource {
    private final SsmClient ssm;
    private final String prefix;

    public ParameterStoreConfigSource(SsmClient ssm, String prefix) {
        this.ssm = Objects.requireNonNull(ssm, "ssm");
        this.prefix = normalizePrefix(prefix);
    }

    public String requiredString(String relativeName) {
        String name = prefix + normalizeRelative(relativeName);
        try {
            return ssm.getParameter(GetParameterRequest.builder()
                    .name(name)
                    .withDecryption(true)
                    .build()).parameter().value();
        } catch (ParameterNotFoundException e) {
            throw new IllegalStateException("Required SSM parameter not found: " + name, e);
        } catch (SsmException e) {
            throw new IllegalStateException("Failed to load SSM parameter: " + name
                    + ", status=" + e.statusCode()
                    + ", requestId=" + e.requestId(), e);
        }
    }

    private static String normalizePrefix(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("prefix must not be blank");
        }
        String p = value.startsWith("/") ? value : "/" + value;
        return p.endsWith("/") ? p.substring(0, p.length() - 1) : p;
    }

    private static String normalizeRelative(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("relative name must not be blank");
        }
        return value.startsWith("/") ? value : "/" + value;
    }
}
```

Important notes:

- `withDecryption(true)` is needed for `SecureString` values.
- Do not log parameter values.
- Log parameter names carefully; names may reveal architecture or tenant info.
- Cache retrieved values unless there is a strong reason not to.

---

## 9. Run Command Mental Model

Run Command executes commands on managed nodes.

Think of it as:

```text
operator/pipeline/automation
  -> Systems Manager control plane
  -> SSM Agent on managed node
  -> command/plugin execution
  -> output/status back to SSM/S3/CloudWatch
```

It is not a replacement for application APIs. It is not a business workflow engine. It is not a generic remote execution escape hatch.

### 9.1 Good Use Cases

Good Run Command use cases:

```text
- collect diagnostic information
- restart an agent
- run a safe maintenance script
- verify configuration
- trigger OS-level operation across fleet
- install/update operational component
- flush local cache with controlled script
```

### 9.2 Bad Use Cases

Bad Run Command use cases:

```text
- execute arbitrary command from web input
- patch business data
- bypass application authorization
- manually mutate database state from instance shell
- implement core business processing
- replace proper deployment pipeline
```

### 9.3 Targeting Model

Run Command can target instances directly or by tag.

Target by instance ID is precise:

```text
InstanceIds = [i-abc123]
```

Target by tag is fleet-oriented:

```text
tag:Environment = prod
tag:Component = case-worker
```

Tag targeting is powerful and dangerous. If tags are wrong, the wrong fleet is affected.

Production command design should include:

```text
- maximum concurrency
- maximum errors
- timeout
- output location
- command document allowlist
- operator identity
- approval boundary
- audit event
```

### 9.4 Java SendCommand Example

This example demonstrates the shape of the API. It is not a recommendation to expose this from a normal application endpoint.

```java
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.SendCommandRequest;
import software.amazon.awssdk.services.ssm.model.SendCommandResponse;

import java.util.List;
import java.util.Map;

public final class SafeDiagnosticCommandService {
    private final SsmClient ssm;

    public SafeDiagnosticCommandService(SsmClient ssm) {
        this.ssm = ssm;
    }

    public String collectDiskUsage(String instanceId) {
        SendCommandResponse response = ssm.sendCommand(SendCommandRequest.builder()
                .documentName("AWS-RunShellScript")
                .instanceIds(instanceId)
                .comment("Collect disk usage diagnostic")
                .timeoutSeconds(60)
                .maxConcurrency("1")
                .maxErrors("0")
                .parameters(Map.of(
                        "commands", List.of("df -h", "du -sh /var/log || true")
                ))
                .build());

        return response.command().commandId();
    }
}
```

Problems with this simple example:

- It uses `AWS-RunShellScript`, which is broad.
- It accepts instance ID directly.
- It does not enforce approval.
- It does not write an internal audit event.
- It does not verify target ownership.
- It does not fetch status/output.

A production admin service would wrap this with policy and workflow.

### 9.5 Safer Command Document Pattern

Instead of allowing arbitrary shell commands, create a custom SSM document:

```text
Document: Company-CollectJavaServiceDiagnostics
Parameters:
  ServiceName: allowed pattern [a-z0-9-]+
  IncludeThreadDump: true/false
  IncludeDiskUsage: true/false
```

Then Java calls that specific document only.

```text
Operator action
  -> choose approved diagnostic type
  -> internal authorization
  -> Start/Send command using fixed document
  -> output stored in controlled S3 bucket
  -> audit event emitted
```

Invariant:

```text
The operator chooses an approved operation, not arbitrary shell text.
```

---

## 10. Run Command Failure Model

Run Command can fail at many layers.

```text
Caller layer
  - caller lacks IAM permission
  - wrong region
  - invalid document
  - invalid target

Control plane layer
  - throttling
  - command dispatch failure
  - document validation failure

Managed node layer
  - SSM Agent offline
  - instance stopped
  - no network path
  - command timeout
  - plugin failure
  - OS permission failure

Command layer
  - script returns non-zero
  - script hangs
  - output too large
  - partial fleet success
```

### 10.1 Status Is Not Binary

A fleet command can be:

```text
Pending
InProgress
Delayed
Success
Cancelled
TimedOut
Failed
Cancelling
```

But the practical interpretation depends on target count.

Example:

```text
10 targets
8 success
1 failed
1 timed out
```

This is not “success” for regulated maintenance unless your runbook explicitly allows partial success.

### 10.2 Production Rule

Never treat command ID creation as command success.

```text
SendCommand success means:
  command accepted by SSM control plane

It does not mean:
  target executed successfully
  output was correct
  operation achieved business/ops objective
```

---

## 11. Session Manager Mental Model

Session Manager provides controlled interactive access to managed nodes.

Traditional access:

```text
operator laptop -> SSH -> public/private instance port 22
```

Session Manager access:

```text
operator identity -> IAM -> SSM Session Manager -> SSM Agent -> managed node
```

Advantages:

```text
- no inbound SSH required
- IAM-based access control
- central session policy
- optional session logging
- better audit posture
- can work through private connectivity/VPC endpoints
```

### 11.1 Java Application Boundary

A business Java application should almost never start sessions.

Session Manager belongs to:

```text
- human operator access
- break-glass support
- controlled debugging
- incident response
```

Not:

```text
- normal request path
- domain workflow
- async worker flow
```

### 11.2 Session Governance

A mature setup considers:

```text
- who can start a session
- which nodes can be accessed
- whether shell commands are logged
- whether port forwarding is allowed
- whether file transfer is allowed
- whether MFA is required
- how long a session can last
- whether production requires approval
- where logs are stored
- whether KMS protects logs
```

### 11.3 Break-Glass Model

Break-glass access should be exceptional.

```text
Normal operation:
  dashboards + logs + metrics + runbooks

Escalated operation:
  approved Session Manager access

Emergency operation:
  break-glass role + strong audit + post-incident review
```

A system that requires frequent shell access is usually under-instrumented or under-automated.

---

## 12. Automation Runbooks

Automation is where SSM becomes a structured operational workflow system.

A runbook can represent a controlled sequence of steps:

```text
1. Validate input
2. Get resource state
3. Create snapshot
4. Stop service
5. Apply change
6. Start service
7. Verify health
8. Notify/record result
```

AWS Systems Manager Automation supports maintenance, deployment, and remediation tasks across AWS services. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-automation.html>

### 12.1 Why Automation Is Better Than Ad-Hoc Scripts

Ad-hoc script:

```text
tribal knowledge
manual execution
unclear input validation
unclear rollback
weak audit
hard to repeat
```

Automation runbook:

```text
versioned document
typed parameters
IAM-controlled execution
step status
approval support
structured output
CloudTrail visibility
repeatable process
```

### 12.2 Runbook Design Principles

A good runbook is:

```text
- narrow in purpose
- explicit in parameter names
- validated before mutation
- idempotent where possible
- safe on retry
- observable
- auditable
- permission-scoped
- rollback-aware
- output-producing
```

### 12.3 Example Runbook Use Cases

```text
- restart non-critical worker fleet safely
- collect Java thread dump from selected node
- rotate local certificate and restart process
- disable unhealthy target from load balancer
- redrive validated messages from DLQ
- snapshot RDS before maintenance
- quarantine compromised instance
- scale down temporary processing fleet
```

### 12.4 Java StartAutomationExecution Example

```java
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.StartAutomationExecutionRequest;
import software.amazon.awssdk.services.ssm.model.StartAutomationExecutionResponse;

import java.util.List;
import java.util.Map;

public final class AutomationGateway {
    private final SsmClient ssm;

    public AutomationGateway(SsmClient ssm) {
        this.ssm = ssm;
    }

    public String startDiagnosticRunbook(String instanceId, String reason) {
        StartAutomationExecutionResponse response = ssm.startAutomationExecution(
                StartAutomationExecutionRequest.builder()
                        .documentName("Company-CollectJavaDiagnostics")
                        .parameters(Map.of(
                                "InstanceId", List.of(instanceId),
                                "Reason", List.of(reason)
                        ))
                        .build()
        );

        return response.automationExecutionId();
    }
}
```

Again, this should sit behind strict authorization and audit.

### 12.5 Automation Invocation Boundary

```text
Allowed:
  internal ops portal -> RBAC -> audit -> StartAutomationExecution

Risky:
  business endpoint -> StartAutomationExecution

Forbidden in most systems:
  public input -> choose runbook name and parameters freely
```

---

## 13. OpsCenter

OpsCenter provides operational issue tracking through OpsItems.

An OpsItem can represent:

```text
- alarm requiring investigation
- failed automation
- recurring operational anomaly
- degraded service dependency
- stuck DLQ
- patch compliance issue
- security finding needing remediation
```

OpsCenter can associate OpsItems with resources and Automation runbooks. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/OpsCenter.html>

### 13.1 OpsItem vs Application Incident

Not every application error deserves an OpsItem.

Create OpsItems for operationally actionable conditions:

```text
Good:
  DLQ depth > threshold for 15 minutes
  Lambda throttling sustained
  SSM automation failed
  EC2 patch compliance critical
  certificate expires in 7 days

Bad:
  every HTTP 500
  every validation error
  every retryable AWS timeout
  every user input issue
```

### 13.2 De-Duplication

If a Java monitoring service creates OpsItems, it must de-duplicate.

Bad:

```text
Every minute alarm is active -> create new OpsItem
```

Good:

```text
Compute issue key:
  system + env + component + condition + resource

If open OpsItem exists:
  update it
Else:
  create one
```

### 13.3 OpsItem as a Bridge

OpsItem can bridge:

```text
CloudWatch Alarm
  -> EventBridge rule
  -> Lambda/Java ops service
  -> OpsItem
  -> Automation runbook
  -> remediation result
```

The business system should not be polluted with operational issue state unless there is a domain reason.

---

## 14. Inventory

Inventory collects metadata from managed nodes.

Typical inventory data includes:

```text
- OS information
- installed applications
- network configuration
- file metadata
- AWS components
- custom inventory
```

### 14.1 Why Java Engineers Should Care

Java engineers often ignore fleet inventory until an incident happens.

Questions Inventory can help answer:

```text
- Which nodes still run old Java version?
- Which instances have outdated agent version?
- Which AMI versions are running in prod?
- Which hosts have a vulnerable library installed?
- Which nodes are missing required package?
- Which environment has drifted from baseline?
```

### 14.2 Inventory vs Application Metadata

Application metadata belongs in the app/platform inventory:

```text
service name
version
git commit
build time
Spring profile
Java runtime version
feature flags
```

System metadata belongs in SSM Inventory:

```text
OS
packages
agent version
instance metadata
```

A mature platform correlates both.

---

## 15. Patch Manager

Patch Manager automates patching of managed nodes and compliance reporting. Reference: <https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html>

### 15.1 Why This Matters to Java Systems

Java service reliability depends on more than Java code.

Patching affects:

```text
- kernel security
- OpenSSL
- glibc
- CA certificates
- container host runtime
- SSM Agent
- CloudWatch Agent
- JVM package if installed from OS repository
```

Even if your app is packaged as a container, the underlying node and base image still need patch strategy.

### 15.2 Patch Risk Model

Patching can fix risk and create risk.

Potential failures:

```text
- reboot during traffic
- agent upgrade failure
- dependency incompatibility
- changed CA trust
- kernel/network behavior change
- disk fills during patch
- service fails to restart
```

Therefore patching should include:

```text
- maintenance windows
- environment progression DEV -> UAT -> PROD
- health check
- rollback/replace strategy
- compliance report
- exception process
```

---

## 16. State Manager and Maintenance Windows

### 16.1 State Manager

State Manager associates desired state with managed nodes.

Example desired states:

```text
- CloudWatch Agent installed and configured
- SSM Agent configured
- security baseline applied
- required directory exists
- package version enforced
```

This is not a replacement for immutable infrastructure, but it can be useful for hybrid fleets or legacy EC2 fleets.

### 16.2 Maintenance Windows

Maintenance Windows define when operational tasks can run.

Useful for:

```text
- patching
- scheduled commands
- fleet maintenance
- compliance scans
- controlled automation
```

For regulated systems, this matters because “when” is part of operational control.

---

## 17. Systems Manager in EKS and Containerized Java Workloads

Many Java systems run on EKS, ECS, or Lambda rather than EC2 directly.

### 17.1 EKS Reality

For EKS workloads:

```text
Java pod
  -> usually should not call Run Command against node

Node operations
  -> platform team / SSM / EKS node management

App config
  -> SSM Parameter Store / Secrets Manager / Kubernetes Secret / external secret pattern
```

Do not confuse application pod operation with worker node operation.

### 17.2 Good EKS Usage

```text
- SSM Session Manager for node break-glass access
- Run Command for node diagnostics if allowed
- Parameter Store for app configuration source
- Automation for node maintenance workflow
- Inventory/Patch Manager for EC2-backed node fleets
```

### 17.3 Bad EKS Usage

```text
- business pod uses SSM to mutate host node
- app container assumes permission to run commands on EC2 nodes
- user request triggers host-level command
```

This violates container boundary and least privilege.

---

## 18. Systems Manager in Lambda Workloads

Lambda functions are managed runtime environments. They are not SSM managed nodes in the same way EC2 instances are.

For Lambda, common SSM usage is:

```text
- read Parameter Store config
- maybe start Automation from internal ops function
- maybe create/update OpsItem
```

Lambda should not be treated like a server where you run Session Manager or patch OS via Patch Manager.

### 18.1 Lambda Config Loading

Bad:

```text
Every invocation -> GetParameter for 20 keys
```

Better:

```text
Init phase:
  load required config
  cache static config

Invoke phase:
  use cached config

Optional:
  background/TTL refresh for mutable config
```

### 18.2 Lambda + Automation

A Lambda function can be a thin controller for Automation:

```text
CloudWatch alarm
  -> EventBridge
  -> Lambda remediation controller
  -> de-duplicate
  -> StartAutomationExecution
  -> write audit event
```

But avoid direct mutation without controls.

---

## 19. IAM Design for Systems Manager

Systems Manager permissions can be extremely sensitive.

### 19.1 Parameter Store Read Role

A normal Java app role might have:

```json
{
  "Effect": "Allow",
  "Action": [
    "ssm:GetParameter",
    "ssm:GetParameters",
    "ssm:GetParametersByPath"
  ],
  "Resource": "arn:aws:ssm:ap-southeast-1:123456789012:parameter/aceas/prod/case-service/*"
}
```

If SecureString uses a customer managed KMS key, also grant decrypt:

```json
{
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:ap-southeast-1:123456789012:key/abcd-...",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "ssm.ap-southeast-1.amazonaws.com"
    }
  }
}
```

### 19.2 Run Command Role

A role allowed to send commands should be tightly scoped.

Control dimensions:

```text
- allowed documents
- allowed target resources/tags
- allowed environment
- allowed output bucket
- required request tags if available
- explicit deny for dangerous documents
```

Avoid broad permission like:

```json
{
  "Effect": "Allow",
  "Action": "ssm:*",
  "Resource": "*"
}
```

### 19.3 Separate Roles

Use separate roles:

```text
app-runtime-role
  - GetParameter only for its namespace

ops-readonly-role
  - Describe/List/Get operational info

ops-command-role
  - SendCommand for approved documents/targets

ops-automation-role
  - StartAutomationExecution for approved runbooks

break-glass-role
  - emergency access, MFA, logged, time-bound
```

Do not give app runtime the same power as operator runtime.

---

## 20. Audit and Traceability

For regulated systems, every operational mutation should answer:

```text
who did it?
what did they do?
when?
why?
which resource?
under which approval/change?
what was the result?
where is the evidence?
```

### 20.1 Evidence Sources

Possible evidence sources:

```text
- CloudTrail event
- SSM command invocation status
- command output in S3/CloudWatch Logs
- Automation execution history
- OpsItem history
- internal audit table
- ticket/change ID
- IAM principal/session tag
```

### 20.2 Internal Audit Event

When Java internal ops service starts an action, emit an audit event:

```json
{
  "eventType": "OPS_AUTOMATION_STARTED",
  "actor": "user:alice@example.com",
  "actorRole": "PROD_SUPPORT_L2",
  "system": "aceas",
  "environment": "prod",
  "automationDocument": "Company-CollectJavaDiagnostics",
  "automationExecutionId": "exec-123",
  "targetResource": "i-abc123",
  "reason": "Investigate high memory alarm",
  "changeTicket": "CHG-2026-00123",
  "requestedAt": "2026-06-19T10:15:30Z",
  "correlationId": "corr-..."
}
```

Do not rely on CloudTrail alone for business/operator intent. CloudTrail tells you API activity; your system should record reason and approval context.

---

## 21. Operational Safety Invariants

These invariants should hold in a mature system.

### 21.1 Parameter Store Invariants

```text
- App can only read its own namespace.
- Config values are validated before use.
- Missing required config fails startup.
- Runtime refresh uses last known good value on transient failure.
- Sensitive values are never logged.
```

### 21.2 Run Command Invariants

```text
- No arbitrary shell from user input.
- Only approved documents are callable.
- Targets are constrained by environment/component.
- Commands have timeout, max concurrency, and max error limit.
- Outputs go to controlled location.
- Every mutation has audit context.
```

### 21.3 Session Manager Invariants

```text
- Production sessions require strong identity.
- Session logs are retained.
- Access is limited by tag/environment.
- Break-glass usage triggers review.
- Session access is not the normal debugging path.
```

### 21.4 Automation Invariants

```text
- Runbooks are versioned.
- Inputs are validated.
- Mutating steps are deliberate.
- Retry behavior is safe.
- Rollback or compensation is defined.
- Results are observable.
```

### 21.5 OpsCenter Invariants

```text
- OpsItems are actionable.
- Duplicate OpsItems are de-duplicated.
- OpsItems link to affected resources.
- Remediation runbook is attached where possible.
- Closure reason is recorded.
```

---

## 22. Production Java Architecture: Internal Ops Gateway

For enterprise systems, do not let every service call SSM freely. Create an internal operations gateway.

```text
+--------------------+
| Operator / Alert    |
+---------+----------+
          |
          v
+--------------------+
| Ops Gateway         |
| - authN/authZ       |
| - approval check    |
| - input validation  |
| - audit event       |
| - deduplication     |
+---------+----------+
          |
          v
+--------------------+
| AWS Systems Manager |
| - Automation        |
| - Run Command       |
| - OpsCenter         |
+---------+----------+
          |
          v
+--------------------+
| Managed Resources   |
+--------------------+
```

### 22.1 Why Gateway Helps

Without gateway:

```text
many services -> many SSM permissions -> inconsistent controls
```

With gateway:

```text
one boundary -> centralized policy -> consistent audit -> safer operation
```

### 22.2 Gateway Responsibilities

```text
- expose approved operations only
- map user intent to runbook/document
- enforce environment restrictions
- validate target resource ownership
- attach change ticket/reason
- start automation/command
- track status
- publish audit event
- expose history
```

### 22.3 Gateway Anti-Pattern

Do not build a gateway that simply exposes:

```http
POST /run-command
{
  "document": "AWS-RunShellScript",
  "target": "i-...",
  "commands": ["..."]
}
```

That is just remote code execution with extra steps.

---

## 23. Example: Safe Diagnostic Collection Flow

### 23.1 Requirement

Support wants to collect diagnostics from a Java worker instance during incident.

Diagnostics may include:

```text
- disk usage
- process list
- Java version
- thread dump
- recent app logs
```

### 23.2 Unsafe Design

```text
Support user enters shell command
  -> web app calls SendCommand
  -> command runs on prod instance
```

Problems:

```text
- arbitrary command
- no operation catalog
- weak audit
- injection risk
- accidental destructive action
- hard to approve/review
```

### 23.3 Safer Design

```text
Support portal
  -> user selects "Collect Java diagnostics"
  -> target chosen from allowed component list
  -> reason and incident ID required
  -> RBAC verifies support role
  -> Ops Gateway starts runbook
  -> runbook runs approved document
  -> output stored in S3 with SSE-KMS
  -> audit event records result
```

### 23.4 Design Invariants

```text
- operator cannot choose arbitrary shell
- target must belong to same environment/component
- runbook has timeout
- output is retained
- PII/log sensitivity is considered
- access to output is controlled
- command execution is traceable
```

---

## 24. Example: Parameter-Driven Feature Flag with Last Known Good

### 24.1 Requirement

A Java service reads operational tuning values from Parameter Store:

```text
/aceas/prod/case-worker/polling/max-batch-size
/aceas/prod/case-worker/polling/enabled
```

### 24.2 Design

```text
Startup:
  load required config
  validate types/ranges
  keep in memory

Runtime every 60 sec:
  fetch mutable config
  validate
  if valid, replace atomically
  if invalid, keep previous and alert
  if SSM unavailable, keep previous
```

### 24.3 Example Config Object

```java
public record WorkerTuning(
        boolean enabled,
        int maxBatchSize
) {
    public WorkerTuning {
        if (maxBatchSize < 1 || maxBatchSize > 10) {
            throw new IllegalArgumentException("maxBatchSize must be between 1 and 10");
        }
    }
}
```

### 24.4 Atomic Holder

```java
import java.util.concurrent.atomic.AtomicReference;

public final class RuntimeTuningHolder {
    private final AtomicReference<WorkerTuning> current;

    public RuntimeTuningHolder(WorkerTuning initial) {
        this.current = new AtomicReference<>(initial);
    }

    public WorkerTuning get() {
        return current.get();
    }

    public void replaceWithValidated(WorkerTuning next) {
        current.set(next);
    }
}
```

### 24.5 Failure Policy

```text
SSM unavailable:
  keep last known good
  increment metric
  warn log with request id

Parameter invalid:
  reject new value
  keep last known good
  create alert/OpsItem if persistent

Parameter missing:
  if required -> fail startup
  if runtime mutable -> keep last known good and alert
```

---

## 25. SSM and Cost/Quota Awareness

Systems Manager API calls are not free from operational constraints. Even when direct per-call cost is not the biggest issue, quota/throttling and downstream effects matter.

### 25.1 Bad Pattern

```text
1,000 pods
  each pod every 1 second calls GetParameter for 20 keys
```

This creates:

```text
- unnecessary API load
- throttling risk
- startup storm risk
- dependency on SSM availability for every request
- higher latency
```

### 25.2 Better Pattern

```text
- load config once at startup
- batch parameters
- cache values
- stagger refresh
- use jitter
- centralize config refresh where appropriate
- fail safely with last known good
```

### 25.3 Refresh Jitter

```java
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;

public final class RefreshJitter {
    public static Duration jitter(Duration base, double ratio) {
        long millis = base.toMillis();
        long delta = (long) (millis * ratio);
        long offset = ThreadLocalRandom.current().nextLong(-delta, delta + 1);
        return Duration.ofMillis(Math.max(1, millis + offset));
    }
}
```

---

## 26. Security Threat Model

### 26.1 Main Threats

```text
- leaked app role can read too many parameters
- app role can run commands on prod nodes
- arbitrary command injection through ops endpoint
- operator can access wrong environment
- session logs disabled
- command output leaks secrets/PII
- SecureString KMS policy too broad
- cross-account role allows unintended SSM operations
- runbook allows unvalidated destructive action
```

### 26.2 Defensive Controls

```text
- separate app and ops roles
- namespace-scoped Parameter Store access
- approved SSM documents only
- target constraints by tag/resource
- no arbitrary command payload
- command output redaction/retention policy
- CloudTrail enabled
- session logging enabled
- KMS key separation
- approval for production mutation
- break-glass review
```

---

## 27. Common Anti-Patterns

### 27.1 Parameter Store as Database

Bad:

```text
store per-user preference in Parameter Store
store high-churn domain state in Parameter Store
store transactional workflow state in Parameter Store
```

Parameter Store is config storage, not OLTP database.

### 27.2 Parameter Store Per Request

Bad:

```text
HTTP request -> GetParameter -> process request
```

This adds latency and availability coupling.

### 27.3 Run Command as Business Logic

Bad:

```text
case approved -> run command on server
```

Business action should be domain logic/event processing, not shell automation.

### 27.4 Broad Ops Role in App

Bad:

```text
Java app role: ssm:*
```

Separate runtime config read from operational mutation.

### 27.5 Session Manager as Observability Replacement

Bad:

```text
Need to inspect production logs by shelling in every time.
```

Fix logging, tracing, metrics, dashboards, and runbooks.

### 27.6 Unversioned Runbooks

Bad:

```text
runbook edited in-place without review
```

Production runbooks should be versioned, reviewed, and promoted.

---

## 28. Java/Spring Boot Integration Pattern

### 28.1 Bean Setup

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ssm.SsmClient;

@Configuration
public class AwsSsmConfiguration {
    @Bean
    SsmClient ssmClient(ApplicationAwsProperties properties) {
        return SsmClient.builder()
                .region(Region.of(properties.region()))
                .build();
    }

    @Bean
    ParameterStoreConfigSource parameterStoreConfigSource(
            SsmClient ssmClient,
            ApplicationAwsProperties properties
    ) {
        return new ParameterStoreConfigSource(ssmClient, properties.parameterPrefix());
    }
}
```

### 28.2 Startup Validation

```java
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StartupConfigValidation {
    @Bean
    ApplicationRunner validateRequiredParameters(ParameterStoreConfigSource source) {
        return args -> {
            source.requiredString("sqs/queue-url");
            source.requiredString("s3/bucket-name");
            source.requiredString("sns/topic-arn");
        };
    }
}
```

This ensures missing required config fails early.

### 28.3 Health Indicator Caution

Do not make health check call SSM every time.

Bad:

```text
/readiness -> GetParameter
```

Better:

```text
/readiness -> verifies last successful config load timestamp and required config presence
```

---

## 29. Operational Playbook Templates

### 29.1 Parameter Failure Playbook

Symptoms:

```text
- startup failure
- config refresh warning
- SSM throttling
- access denied
```

Checks:

```text
1. Confirm parameter name and region.
2. Confirm app role permission.
3. Confirm KMS decrypt if SecureString.
4. Check recent parameter changes.
5. Check deployment environment prefix.
6. Check CloudTrail for denied action.
7. Roll back parameter value if invalid.
```

### 29.2 Run Command Failure Playbook

Symptoms:

```text
- command does not start
- target not found
- command timed out
- partial fleet failure
```

Checks:

```text
1. Confirm target node is managed.
2. Confirm SSM Agent status.
3. Confirm instance profile.
4. Confirm VPC endpoints/network path.
5. Confirm document name/version.
6. Confirm command timeout.
7. Review invocation output.
8. Review CloudTrail and SSM command status.
```

### 29.3 Session Access Failure Playbook

Checks:

```text
1. Confirm IAM permission to start session.
2. Confirm target node is managed.
3. Confirm SSM Agent is online.
4. Confirm Session Manager preferences.
5. Confirm KMS/logging permissions if configured.
6. Confirm local CLI/plugin if using CLI.
7. Check SCP/permission boundary.
```

### 29.4 Automation Failure Playbook

Checks:

```text
1. Identify failed step.
2. Inspect step input/output.
3. Confirm automation assume role permissions.
4. Confirm target resource state.
5. Determine retry safety.
6. Run rollback/compensation if needed.
7. Update OpsItem/ticket.
8. Capture evidence.
```

---

## 30. Design Review Checklist

Use this checklist when reviewing a Java system that uses Systems Manager.

### 30.1 Runtime Config

```text
[ ] Parameter names follow hierarchy.
[ ] App role is namespace-scoped.
[ ] Required config fails startup.
[ ] Mutable config validates values.
[ ] Config is cached.
[ ] Refresh uses jitter.
[ ] Last known good is defined.
[ ] Sensitive values are not logged.
```

### 30.2 Run Command

```text
[ ] App runtime does not have broad SendCommand permission.
[ ] Commands use approved documents.
[ ] No arbitrary shell from user input.
[ ] Targets are constrained.
[ ] Timeout is set.
[ ] Max concurrency/max errors are set.
[ ] Output destination is controlled.
[ ] Audit event includes actor/reason/ticket.
```

### 30.3 Session Manager

```text
[ ] Session access is IAM-controlled.
[ ] Production access requires strong identity.
[ ] Session logging is configured where required.
[ ] Break-glass process exists.
[ ] Session is not normal debugging dependency.
```

### 30.4 Automation

```text
[ ] Runbooks are versioned.
[ ] Inputs are validated.
[ ] Execution role is least-privilege.
[ ] Steps are idempotent or retry-safe.
[ ] Rollback/compensation exists.
[ ] Execution status is monitored.
[ ] Failed automation creates actionable signal.
```

### 30.5 OpsCenter

```text
[ ] OpsItems are de-duplicated.
[ ] OpsItems are actionable.
[ ] Affected resources are attached.
[ ] Runbooks are linked where useful.
[ ] Closure reason is recorded.
```

---

## 31. How This Fits the Whole Series

Systems Manager connects many previous parts:

```text
Part 2 Credentials/STS
  -> SSM API caller identity and cross-account ops

Part 3 IAM
  -> least privilege for Parameter Store, Run Command, Automation

Part 4 HTTP/Timeout/Retry
  -> SDK timeout/caching for SSM calls

Part 6 Observability
  -> operational logs, metrics, request IDs, audit

Part 11 Secrets/SSM Parameter Store
  -> runtime configuration and secure config

Part 12 KMS
  -> SecureString, session logs, output encryption

Part 20 Lambda Production
  -> Lambda as remediation controller

Part 21 EventBridge
  -> alarms/events triggering Automation/OpsItems
```

Systems Manager is not isolated. It is the bridge between application engineering and operational engineering.

---

## 32. Top 1% Engineering Perspective

A basic engineer asks:

```text
How do I call SSM from Java?
```

A strong engineer asks:

```text
Should this code call SSM at all?
```

A top-tier engineer asks:

```text
Which plane owns this action?
What is the blast radius?
What identity performs it?
What invariant protects it?
What evidence proves it happened correctly?
What is the failure mode?
What is the rollback or compensation?
Can this be repeated safely?
Can it be operated at 3 AM without heroics?
```

Systems Manager rewards disciplined boundaries. Used well, it removes SSH sprawl, standardizes operations, creates repeatable runbooks, and improves incident response. Used carelessly, it becomes a remote-execution backdoor hidden behind application code.

The goal is not to maximize SSM usage. The goal is to put operational actions behind the right control plane.

---

## 33. Practical Summary

Systems Manager should be understood as:

```text
Parameter Store
  -> runtime configuration source

Run Command
  -> controlled fleet command execution

Session Manager
  -> audited human/operator access

Automation
  -> repeatable operational runbooks

OpsCenter
  -> operational issue tracking

Inventory
  -> fleet metadata visibility

Patch Manager
  -> patch and compliance automation

State Manager / Maintenance Windows
  -> desired state and scheduled operations
```

For Java engineers:

```text
- Use SSM Parameter Store carefully for config.
- Cache and validate values.
- Do not call SSM per request.
- Do not give app runtime broad SSM permissions.
- Keep Run Command/Automation behind operational authorization.
- Prefer approved documents/runbooks over arbitrary shell.
- Treat all operational mutation as auditable workflow.
- Design for failure, partial success, and rollback.
```

---

## 34. References

- AWS Systems Manager overview: <https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-systems-manager.html>
- AWS Systems Manager Run Command: <https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html>
- AWS Systems Manager Session Manager: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html>
- AWS Systems Manager Automation: <https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-automation.html>
- `aws:runCommand` automation action: <https://docs.aws.amazon.com/systems-manager/latest/userguide/automation-action-runcommand.html>
- AWS Systems Manager OpsCenter: <https://docs.aws.amazon.com/systems-manager/latest/userguide/OpsCenter.html>
- AWS Systems Manager Patch Manager: <https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html>
- AWS SDK for Java 2.x Systems Manager examples: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_ssm_code_examples.html>
- AWS SDK for Java 2.x `SsmClient` API reference: <https://sdk.amazonaws.com/java/api/latest/software/amazon/awssdk/services/ssm/SsmClient.html>

---

## 35. Completion Status

Part 22 is complete.

This series is not complete yet.

Next part:

```text
Part 23 — DynamoDB for Java Engineers
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-21-eventbridge-and-scheduler-for-java-engineers.md">⬅️ Part 21 — EventBridge and Scheduler for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-23-dynamodb-for-java-engineers.md">Part 23 — DynamoDB for Java Engineers ➡️</a>
</div>
