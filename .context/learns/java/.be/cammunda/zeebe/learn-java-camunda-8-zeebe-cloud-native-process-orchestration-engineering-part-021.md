# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-021.md

# Part 021 — Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `021`  
> Topik: Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries  
> Target: Java engineer / tech lead / architect yang perlu mendesain Camunda 8 secara aman, tenant-aware, least-privilege, dan defensible untuk sistem enterprise/regulatory.

---

## 0. Tujuan Pembelajaran

Bagian ini membahas security boundary Camunda 8 dari perspektif engineer yang akan membangun dan mengoperasikan workflow platform production-grade.

Setelah menyelesaikan part ini, kamu seharusnya bisa:

1. Membedakan **authentication**, **authorization**, **identity management**, **tenant isolation**, dan **application-level access control**.
2. Memahami posisi **Identity/Admin**, **Management Identity**, **Orchestration Cluster Identity**, **Zeebe**, **Operate**, **Tasklist**, **Optimize**, **Web Modeler**, dan **Console**.
3. Mendesain akses untuk:
   - user manusia,
   - Java worker,
   - deployment automation,
   - monitoring system,
   - support/operator,
   - process application.
4. Membedakan authorization Camunda dengan authorization domain bisnis.
5. Memahami risiko multi-tenancy: shared cluster tidak otomatis berarti strong tenant isolation.
6. Mendesain worker Java yang tenant-aware dan least-privilege.
7. Membuat security review checklist untuk Camunda 8 production deployment.
8. Menghindari anti-pattern seperti “worker superuser”, “semua user admin”, “variable berisi secret”, dan “tenant id hanya label UI”.

---

## 1. Mental Model Utama

Security Camunda 8 harus dipahami sebagai beberapa lapisan, bukan satu fitur tunggal.

```text
+--------------------------------------------------------------+
| Business / Domain Authorization                              |
| - Can this officer approve this case?                         |
| - Can this agency see this application?                       |
| - Can this supervisor override this decision?                 |
+--------------------------------------------------------------+
| Camunda Application Access                                    |
| - Can this user use Tasklist?                                 |
| - Can this user view Operate?                                 |
| - Can this user resolve incidents?                            |
| - Can this user deploy process definitions?                   |
+--------------------------------------------------------------+
| Orchestration Cluster Authorization                           |
| - Zeebe / Operate / Tasklist / Orchestration APIs             |
| - Resources, permissions, owners                              |
+--------------------------------------------------------------+
| Identity Provider / OAuth / OIDC                              |
| - Who is this subject?                                        |
| - Which groups/claims/roles does token carry?                 |
+--------------------------------------------------------------+
| Network and Runtime Boundary                                  |
| - Ingress, TLS, mTLS, private network, service account, K8s   |
+--------------------------------------------------------------+
| Secret and Credential Boundary                                |
| - OAuth client secret, worker token, DB password, API keys    |
+--------------------------------------------------------------+
```

A common mistake is to collapse all of these into one idea: “Camunda has Identity, so security is solved.” That is too shallow.

Camunda Identity can help manage platform-level access. It does not automatically encode all domain-level access rules. If a regulatory officer can claim a task in Tasklist, that does not necessarily mean they are allowed by business policy to approve every application in every agency, region, risk category, or escalation stage.

The top 1% engineering view is:

> Camunda access control protects orchestration resources. Domain authorization protects business decisions. Both must exist, and the boundary between them must be explicit.

---

## 2. Key Terms

### 2.1 Authentication

Authentication answers:

```text
Who are you?
```

Examples:

- human user logs in via OIDC/SAML-backed identity provider,
- Java worker obtains OAuth client credentials token,
- CI/CD deployer authenticates using machine-to-machine credentials,
- support tool calls Orchestration Cluster API with a token.

Authentication does not by itself mean the subject is allowed to do anything meaningful.

---

### 2.2 Authorization

Authorization answers:

```text
What are you allowed to do?
```

Examples:

- deploy process model,
- start process instance,
- activate jobs,
- complete user task,
- view process instance in Operate,
- resolve incident,
- access tenant-specific data,
- administer users/roles/groups.

---

### 2.3 Identity Management

Identity management concerns the lifecycle of users, groups, roles, applications, clients, mappings, and permissions.

In self-managed Camunda 8, this may involve:

- Camunda Identity/Admin,
- Management Identity,
- external IdP,
- Keycloak or another OIDC provider,
- claim mapping,
- group mapping,
- tenant mapping,
- application/client credentials.

---

### 2.4 Tenant

A tenant is a logical partitioning label used to separate resources/data by customer, agency, department, business unit, environment, or other logical boundary.

But tenant isolation has levels:

| Isolation Level | Meaning |
|---|---|
| UI filtering | Users only see tenant-specific data in UI. Weakest form. |
| API authorization | API calls are checked against tenant/resource permissions. |
| Data tagging | Records include tenant identifier. |
| Storage isolation | Tenant data stored in separate storage/index/schema. |
| Runtime isolation | Tenant has separate workers, cluster, network, secrets. |
| Operational isolation | Tenant has separate backup, support, audit, DR, SLO. |

Camunda 8 multi-tenancy commonly relies on tenant identifiers inside a shared installation. That is useful, but architects must understand that this is not the same as separate physical clusters.

---

## 3. Camunda 8 Security Surface

Camunda 8 is not a single monolith. Each component has a different access surface.

```text
                 +-----------------------------+
                 | Human Browser / Admin Users |
                 +-------------+---------------+
                               |
                               v
+----------------+     +----------------+     +----------------+
| Web Modeler    |     | Operate        |     | Tasklist       |
+----------------+     +----------------+     +----------------+
        |                       |                      |
        v                       v                      v
+----------------+     +----------------+     +----------------+
| Identity/Admin |<--->| Orchestration  |<--->| Zeebe Gateway  |
+----------------+     | Cluster APIs   |     +----------------+
                       +----------------+             |
                                                        v
                                                +----------------+
                                                | Zeebe Brokers  |
                                                +----------------+
                                                        |
                                                        v
                                                +----------------+
                                                | Exporters /    |
                                                | Secondary Store|
                                                +----------------+

+----------------+         +----------------+
| Java Workers   |-------> | Zeebe Gateway  |
+----------------+         +----------------+

+----------------+         +----------------+
| CI/CD Deployer |-------> | Deploy APIs    |
+----------------+         +----------------+
```

Security design must answer:

1. Who can access web components?
2. Who can call APIs?
3. Which application credentials exist?
4. Which permissions does each credential have?
5. Which tenants can each subject access?
6. Which process definitions can they deploy/start/view/control?
7. Which user tasks can they claim/complete?
8. Which incidents can they resolve?
9. Which logs/variables can they inspect?
10. Which secrets are available at runtime?

---

## 4. Important Camunda 8.8+ Identity Shift

Camunda 8.8 introduced an important change in how identity and authorization are structured for the Orchestration Cluster.

The practical model is:

```text
Camunda 8 Self-Managed 8.8+

+-------------------------------------------------------+
| Orchestration Cluster Identity / Authorization         |
| Applies to:                                           |
| - Zeebe                                               |
| - Admin                                               |
| - Operate                                             |
| - Tasklist                                            |
| - Orchestration Cluster APIs                          |
+-------------------------------------------------------+

+-------------------------------------------------------+
| Management Identity                                    |
| Applies to components outside Orchestration Cluster,   |
| such as Web Modeler, Console, and Optimize depending   |
| on deployment model/version.                           |
+-------------------------------------------------------+
```

This matters because engineers often expect “Identity” to mean one universal permission model across all components. In modern Camunda 8, you need to understand which component checks which authorization model.

### Practical Consequence

When designing a deployment, document access per component:

| Component | Access Model Question |
|---|---|
| Zeebe Gateway/API | Which clients can deploy/start/operate processes? |
| Operate | Who can view process instances and resolve incidents? |
| Tasklist | Who can view/claim/complete user tasks? |
| Admin | Who can manage cluster users/groups/authorizations? |
| Web Modeler | Who can model/deploy? |
| Optimize | Who can view analytics and tenant data? |
| Console | Who can manage cluster/platform resources? |

Do not assume that granting access in one component grants consistent access everywhere else.

---

## 5. Human User Access Model

Human users usually interact with Camunda through:

- Tasklist,
- Operate,
- Optimize,
- Web Modeler,
- Admin/Identity,
- Console.

Each persona needs different permissions.

### 5.1 Common Personas

| Persona | Typical Need | Dangerous Permission If Over-Granted |
|---|---|---|
| End user / task assignee | Work assigned tasks | View all tasks/process data |
| Supervisor | Reassign, escalate, review team tasks | Admin or incident resolution everywhere |
| Process operator | View process state, retry incidents | Deploy arbitrary BPMN or modify sensitive variables |
| Developer | Deploy to lower env, debug incidents | Production admin access |
| Release engineer | Deploy approved BPMN | Runtime task manipulation |
| Business analyst | Model/review process | Production deployment without approval |
| Auditor | Read-only evidence | Ability to mutate process state |
| Platform admin | Manage cluster/security | Business task approval |

Top-level principle:

> Separate “can operate the platform” from “can make a business decision”.

A platform admin should not automatically be able to approve a regulatory case. A business approver should not automatically be able to alter process instance state in Operate.

---

## 6. Machine-to-Machine Access Model

Java workers, deployment pipelines, monitoring agents, and integration services are machine actors.

They should not use human credentials.

```text
Bad:
worker uses admin username/password

Better:
worker uses dedicated OAuth client credentials

Best:
worker uses dedicated service identity scoped by:
- environment
- tenant
- process domain
- job type group
- action set
```

### 6.1 Machine Actor Types

| Machine Actor | Permission Shape |
|---|---|
| Java job worker | Activate/complete/fail/throw error for specific job types/processes where possible |
| Process starter service | Start specific process definitions / publish specific messages |
| Deployment pipeline | Deploy process/resource to controlled environment |
| Monitoring service | Read metrics/status, not mutate process state |
| Support automation | Retry/resolve/cancel only under approved workflow |
| Integration gateway | Publish messages with constrained tenant/process scope |

### 6.2 Why Worker Credentials Are Dangerous

A worker can often influence process state by completing jobs and writing variables.

If compromised, a worker may:

- complete tasks fraudulently,
- inject variables,
- trigger downstream process paths,
- leak process variables,
- create incidents intentionally,
- call external systems using stored secrets,
- publish fake business outcomes.

Therefore, worker identity deserves the same seriousness as a database writer credential.

---

## 7. Authorization Resource Thinking

Camunda authorization usually maps owners to permissions on resources.

Think in the following shape:

```text
Authorization = Owner + Resource + Permission

Owner:
- user
- group
- role
- mapping rule
- application/service identity

Resource:
- process definition
- process instance
- decision definition
- tenant
- system/application resource
- component-specific resource

Permission:
- read
- create
- update
- delete
- deploy
- start
- operate
- assign
- complete
- admin
```

Exact resource/permission names vary by component/version, but this mental model is stable.

### 7.1 Design Principle

Do not assign permissions based on convenience. Assign them based on use case.

Bad:

```text
All developers: Admin
All workers: Admin
All support users: Admin
```

Better:

```text
Developers:
- deploy/read in DEV/SIT
- read-only in UAT
- no direct PROD mutation

Release pipeline:
- deploy approved resources in PROD

Operators:
- read process instances
- retry incidents for approved process domains

Auditors:
- read-only across approved tenants

Workers:
- runtime execution permissions only
```

---

## 8. Authorization vs BPMN Assignment

This distinction is critical.

BPMN user task assignment defines who is intended to work on a task.

Camunda authorization defines whether the user/API subject can access or manipulate resources.

Domain authorization defines whether the business action is valid.

```text
User Task Candidate Group:
"senior-reviewers"

Camunda Authorization:
User can access Tasklist and read/complete relevant user tasks.

Domain Authorization:
User is allowed to approve this exact case because:
- same agency/tenant,
- sufficient approval limit,
- not maker of original submission,
- not conflicted,
- not expired delegation,
- correct role for case risk level.
```

Never rely only on candidate group for business-critical authorization.

### 8.1 Example: Maker-Checker

Bad model:

```text
Maker submits case
Checker task assigned to group: checker
Any checker can approve
```

Problem:

- Same person may belong to checker group.
- Same unit conflict may exist.
- Approval limit may be insufficient.
- Case may need senior checker based on risk score.

Better model:

```text
BPMN:
- user task candidate group: checker

Task completion API:
- validates user identity
- checks domain policy:
  - user != maker
  - user has tenant access
  - user has approval limit
  - user has active delegation
  - case state permits approval

Worker/process:
- records decision metadata
- continues process only after validated completion
```

---

## 9. Multi-Tenancy Mental Model

Camunda 8 multi-tenancy allows data/resources to be associated with tenant identifiers in a shared installation.

But there is a spectrum:

```text
Single shared cluster, tenant-tagged data
       |
       | stronger isolation
       v
Separate cluster per tenant
```

### 9.1 Shared Cluster Multi-Tenancy

Pros:

- lower infrastructure cost,
- simpler platform operation,
- easier shared monitoring,
- common process platform,
- easier centralized governance.

Cons:

- weaker blast-radius isolation,
- noisy-neighbor risk,
- shared broker/storage dependencies,
- more complex authorization correctness,
- backup/restore may be cluster-wide,
- accidental cross-tenant access can be severe.

### 9.2 Dedicated Cluster Per Tenant

Pros:

- strong runtime isolation,
- separate scaling,
- separate DR/backup,
- simpler tenant-specific compliance,
- smaller cross-tenant breach risk.

Cons:

- higher operational cost,
- more deployments,
- duplicated monitoring,
- more upgrade complexity,
- harder centralized analytics.

### 9.3 Decision Table

| Requirement | Better Fit |
|---|---|
| Many small internal departments | Shared multi-tenant cluster |
| Strict legal separation | Dedicated cluster or strong separate environment |
| Different SLO per tenant | Dedicated cluster or isolated workload pools |
| Different encryption boundary | Dedicated storage/cluster |
| Shared business process platform | Shared cluster |
| High noisy-neighbor risk | Dedicated cluster or partitioned runtime design |
| Tenant-specific release cycles | Dedicated cluster or carefully versioned shared deployment |

---

## 10. Tenant-Aware Process Design

Tenant awareness must exist at multiple points.

```text
Process Deployment
  -> process definition belongs to tenant/context

Process Instance Creation
  -> tenant id selected/validated

Message Correlation
  -> tenant id + correlation key considered

Worker Activation
  -> worker processes jobs for allowed tenant(s)

User Task Visibility
  -> user sees only authorized tenant tasks

Read Model / Analytics
  -> Optimize/custom reports filter by tenant

Audit Trail
  -> tenant id included in every event/decision record
```

### 10.1 Tenant ID Is Not a Cosmetic Field

Bad:

```json
{
  "tenantId": "agency-a",
  "caseId": "CASE-123"
}
```

and the worker simply trusts it.

Better:

```text
- Tenant id comes from authenticated context or trusted routing boundary.
- Request tenant is checked against subject permissions.
- Business entity tenant is loaded from database.
- Process tenant and business entity tenant must match.
- Worker refuses cross-tenant mismatch.
```

### 10.2 Tenant Validation Invariant

A strong invariant:

```text
For every process instance affecting a business entity:
processTenant == businessEntityTenant == subjectAuthorizedTenant
```

If this invariant fails, stop the process path and raise an incident/business error depending on severity.

---

## 11. Java Worker Tenant-Aware Design

A Java worker must not blindly execute jobs just because Zeebe delivered them.

Worker should validate tenant/business context before external side effects.

### 11.1 Worker Input Contract

Example variable contract:

```json
{
  "caseRef": "CASE-2026-000123",
  "tenantCode": "CEA",
  "commandId": "cmd-9d9c...",
  "requestedBy": "user-123",
  "decisionContext": {
    "riskLevel": "HIGH",
    "stage": "SCREENING"
  }
}
```

### 11.2 Worker Guard Flow

```text
Job activated
  |
  v
Validate variable schema
  |
  v
Load business entity by caseRef
  |
  v
Check entity.tenant == process tenant / variable tenant
  |
  v
Check worker is configured to serve this tenant
  |
  v
Check command idempotency
  |
  v
Execute side effect
  |
  v
Persist result/audit
  |
  v
Complete job
```

### 11.3 Java Example: Tenant Guard

```java
public final class TenantGuard {

    private final Set<String> allowedTenants;

    public TenantGuard(Set<String> allowedTenants) {
        this.allowedTenants = Set.copyOf(allowedTenants);
    }

    public void assertAllowed(String tenantCode, String caseTenantCode, String caseRef) {
        if (tenantCode == null || tenantCode.isBlank()) {
            throw new SecurityException("Missing tenantCode for caseRef=" + caseRef);
        }

        if (!allowedTenants.contains(tenantCode)) {
            throw new SecurityException("Worker is not allowed to process tenant=" + tenantCode);
        }

        if (!tenantCode.equals(caseTenantCode)) {
            throw new SecurityException(
                "Tenant mismatch for caseRef=" + caseRef
                    + ", processTenant=" + tenantCode
                    + ", caseTenant=" + caseTenantCode
            );
        }
    }
}
```

In a real worker, do not leak sensitive details to external client responses. But log enough structured evidence for internal audit and incident triage.

---

## 12. Worker Credentials and Least Privilege

A production worker should have a dedicated identity.

### 12.1 Per-Environment Credentials

Do not reuse the same client credential across environments.

```text
Bad:
camunda-worker-client shared across dev/uat/prod

Better:
camunda-worker-payment-dev
camunda-worker-payment-uat
camunda-worker-payment-prod
```

### 12.2 Per-Domain Credentials

Avoid one mega worker credential.

```text
Bad:
camunda-worker-all-prod

Better:
camunda-worker-case-screening-prod
camunda-worker-licensing-prod
camunda-worker-notification-prod
camunda-worker-payment-prod
```

### 12.3 Per-Tenant Credentials

For stronger isolation:

```text
camunda-worker-case-screening-agency-a-prod
camunda-worker-case-screening-agency-b-prod
```

This is more operationally expensive, but sometimes justified for regulatory or multi-agency systems.

---

## 13. Secret Management

Workers and deployment pipelines need secrets.

Examples:

- Camunda OAuth client secret,
- external API credentials,
- database password,
- signing keys,
- mTLS private keys,
- webhook verification secret.

### 13.1 Rules

1. Never store secrets in BPMN variables.
2. Never pass secrets through process variables.
3. Never expose secrets in Operate/Tasklist/Optimize.
4. Never log secrets in worker logs.
5. Never commit secrets in BPMN XML, connector template, application.yml, or Helm values.
6. Use secret manager/Kubernetes Secret/SSM/Vault/Secrets Manager depending on platform.
7. Rotate credentials.
8. Separate deployer credentials from worker runtime credentials.

### 13.2 Why Variables Are Dangerous for Secrets

Process variables are often visible through:

- Operate,
- Tasklist form data,
- exported records,
- secondary storage,
- logs,
- analytics,
- custom exporters,
- support snapshots.

Therefore, process variables should contain references, not secrets.

Bad:

```json
{
  "externalApiToken": "eyJhbGciOi..."
}
```

Better:

```json
{
  "externalSystem": "onemap",
  "credentialAlias": "onemap-prod-agency-a"
}
```

The worker resolves `credentialAlias` from a trusted secret store after checking tenant/environment policy.

---

## 14. Network Security Boundary

Authorization is not enough if network exposure is wrong.

### 14.1 Recommended Boundary Questions

1. Is Zeebe Gateway publicly reachable?
2. Is Operate publicly reachable?
3. Is Tasklist publicly reachable?
4. Are APIs behind ingress protected with TLS?
5. Are admin endpoints private?
6. Are workers running inside private network?
7. Can any pod call the gateway, or only authorized namespaces?
8. Are egress rules restricted?
9. Is mTLS used between services where required?
10. Are load balancers internal or external?

### 14.2 Typical Enterprise Topology

```text
Internet / Corporate Network
        |
        v
+--------------------+
| WAF / Ingress / IdP|
+--------------------+
        |
        v
+------------------------------+
| Camunda Web Components       |
| Operate / Tasklist / Modeler |
+------------------------------+
        |
        v
+------------------------------+
| Internal Orchestration APIs  |
| Gateway / Cluster API        |
+------------------------------+
        |
        v
+------------------------------+
| Private Workers              |
+------------------------------+
        |
        v
+------------------------------+
| Domain Systems / Databases   |
+------------------------------+
```

For sensitive environments, avoid exposing low-level orchestration APIs directly to broad corporate networks.

---

## 15. Deployment Pipeline Access

Deployment pipeline can be more dangerous than runtime worker.

A deployer can introduce:

- malicious BPMN,
- broken process model,
- wrong connector configuration,
- wrong form,
- incompatible job type,
- process that bypasses approval,
- process that emits incorrect messages.

### 15.1 Deployment Access Design

```text
Developer:
- deploy to local/dev

CI pipeline:
- deploy to SIT/UAT after merge

Release pipeline:
- deploy approved version to PROD

Manual production deploy:
- prohibited or break-glass only
```

### 15.2 BPMN Release Governance

Every production process deployment should record:

- BPMN file hash,
- form file hash,
- connector template version,
- worker version compatibility,
- approval ticket,
- release window,
- rollback strategy,
- impacted process definitions,
- tenant scope,
- migration plan for running instances.

---

## 16. Operate Access and Support Governance

Operate can expose sensitive runtime data and enable mutation of process state.

Potential capabilities include:

- view process instance,
- inspect variables,
- see incidents,
- retry incidents,
- resolve incidents,
- cancel process instances,
- modify process instance state,
- inspect flow node state.

### 16.1 Operate Role Separation

| Role | Recommended Access |
|---|---|
| Support L1 | Read-only, limited tenant/process scope |
| Support L2 | Retry incidents under runbook |
| Support L3 / Process Engineer | Resolve/modify under approval |
| Auditor | Read-only with audit logging |
| Developer | Lower env full access, prod restricted/read-only |
| Platform admin | Admin capability but not business decision authority |

### 16.2 Break-Glass Access

For production mutation:

```text
- temporary elevation
- ticket approval
- reason required
- session logging
- action audit
- post-action review
```

This matters for regulatory systems because manual process modification can become a legal/compliance evidence issue.

---

## 17. Tasklist Access and Business Authorization

Tasklist is where humans make decisions. That makes it high-risk.

### 17.1 Task Access Is Not Enough

A user seeing a task does not mean the user is allowed to complete it with any outcome.

Task completion should validate:

- authenticated user,
- tenant,
- role,
- group,
- assignment/claim,
- case state,
- maker-checker rule,
- approval limit,
- delegation,
- conflict of interest,
- deadline status,
- required evidence,
- decision reason,
- form schema version.

### 17.2 Completion API Pattern

For high-assurance systems, use a custom task completion backend instead of letting browser logic directly decide business validity.

```text
User submits decision
  |
  v
Custom application backend
  |
  +--> authenticate user
  +--> load task/process context
  +--> validate domain authorization
  +--> validate form data
  +--> persist decision audit
  +--> complete task via Camunda API
```

This design lets you apply domain rules consistently even if Tasklist or a custom UI changes.

---

## 18. Optimize and Analytics Access

Optimize/read-side analytics can expose aggregate and individual process data.

Risks:

- exposing PII through reports,
- cross-tenant analytics leakage,
- revealing sensitive process outcomes,
- showing investigation bottlenecks to unauthorized groups,
- exporting report data outside controlled systems.

### 18.1 Analytics Authorization Questions

1. Can user see all tenants or only own tenant?
2. Can user drill down from aggregate to instance-level data?
3. Are PII fields masked or excluded?
4. Are low-count aggregates suppressed to prevent re-identification?
5. Can reports be exported?
6. Are report definitions governed?
7. Are dashboards environment-specific?

### 18.2 Variable Design for Analytics

Do not put raw sensitive detail in variables just because analytics needs classification.

Bad:

```json
{
  "applicantName": "...",
  "identityNumber": "...",
  "medicalCondition": "..."
}
```

Better:

```json
{
  "caseType": "RENEWAL",
  "riskBand": "HIGH",
  "slaCategory": "STATUTORY_14D",
  "regionCode": "CENTRAL",
  "applicantRef": "APP-REF-..."
}
```

---

## 19. Process Variables and Data Security

Process variables are part of orchestration state. Treat them as semi-sensitive by default.

### 19.1 Variable Classification

| Class | Example | Handling |
|---|---|---|
| Public operational | process stage, case type | OK in variables |
| Internal operational | risk band, assignment queue | Usually OK with authorization |
| Sensitive business | decision reason, enforcement note | Minimize/mask/control |
| PII | name, ID number, contact | Avoid unless necessary |
| Secret | token/password/key | Never in variables |
| Large document | PDF/content | Store externally, reference only |

### 19.2 Safer Variable Design

Use reference-over-payload:

```json
{
  "caseRef": "CASE-2026-000123",
  "documentRefs": [
    "doc-001",
    "doc-002"
  ],
  "riskBand": "HIGH",
  "slaClass": "STATUTORY_14D"
}
```

The worker retrieves sensitive documents from a domain service with proper authorization, not from process variables.

---

## 20. Mapping Rules and External IdP Claims

In enterprise systems, user identity usually comes from an external IdP.

Tokens may contain claims such as:

```json
{
  "sub": "user-123",
  "email": "officer@example.gov",
  "groups": ["case-reviewer", "supervisor"],
  "agency": "CEA",
  "roles": ["reviewer"],
  "department": "licensing"
}
```

Mapping rules connect IdP claims to Camunda-side access constructs.

### 20.1 Claim Mapping Risks

1. Claim name changes.
2. Group naming differs between environments.
3. Token missing expected claim.
4. User has stale group membership.
5. IdP group too broad for Camunda permission.
6. Tenant claim not verified against domain system.
7. Different IdPs use different claim semantics.

### 20.2 Defensive Design

Do not map raw enterprise groups blindly to powerful permissions.

Bad:

```text
AD group: all-it-users -> Camunda admin
```

Better:

```text
AD group: camunda-prod-operate-readonly-case-domain -> read-only Operate permission
AD group: camunda-prod-task-licensing-reviewer -> Tasklist access for licensing tenant/domain
AD group: camunda-prod-platform-admin -> admin, small controlled group
```

---

## 21. Domain Authorization Pattern for Camunda Tasks

For systems with complex case management, put domain authorization in the domain application, not only in Camunda.

### 21.1 Policy Function

```java
public interface CaseDecisionPolicy {
    DecisionAuthorization authorize(
        UserContext user,
        CaseSnapshot caseSnapshot,
        DecisionCommand command
    );
}
```

### 21.2 Example Result

```java
public sealed interface DecisionAuthorization {
    record Allowed() implements DecisionAuthorization {}
    record Denied(String reasonCode) implements DecisionAuthorization {}
}
```

For Java 8–17 compatibility, use regular classes/enums instead of sealed interfaces.

### 21.3 Completion Flow

```java
public void completeReviewTask(UserContext user, CompleteReviewCommand command) {
    CaseSnapshot caseSnapshot = caseRepository.get(command.caseRef());

    DecisionAuthorization auth = decisionPolicy.authorize(user, caseSnapshot, command);
    if (auth instanceof DecisionAuthorization.Denied denied) {
        throw new ForbiddenDecisionException(denied.reasonCode());
    }

    auditRepository.recordDecisionAttempt(user, command, caseSnapshot);

    camundaTaskClient.complete(command.taskId(), Map.of(
        "decision", command.decision(),
        "decisionBy", user.userId(),
        "decisionAt", clock.instant().toString(),
        "decisionReasonCode", command.reasonCode()
    ));
}
```

Again, do not let the front-end be the sole enforcement point.

---

## 22. Environment Isolation

Security design should differ by environment.

### 22.1 Environment Matrix

| Environment | Access Style |
|---|---|
| Local | Developer convenience, no real secrets |
| DEV | Broad developer experimentation, synthetic data |
| SIT | Controlled integration, test credentials |
| UAT | Business user access, masked data preferred |
| PREPROD | Production-like access, strict control |
| PROD | Least privilege, audited mutation, break-glass |

### 22.2 Never Share Credentials Across Environments

Common incident:

```text
UAT worker accidentally points to PROD Camunda cluster
```

Prevention:

- separate OAuth clients,
- separate secrets,
- environment-specific issuer/audience,
- network segmentation,
- explicit environment banner,
- startup guard checks,
- allowlist cluster URL,
- deployment policy.

### 22.3 Startup Guard Example

```java
public final class EnvironmentGuard {

    public void validate(EnvironmentConfig config) {
        if (config.environment().equals("prod")
            && !config.camundaEndpoint().contains("prod")) {
            throw new IllegalStateException("PROD worker must connect to PROD Camunda endpoint");
        }

        if (!config.allowedTenantCodes().containsAll(config.configuredWorkerTenants())) {
            throw new IllegalStateException("Worker tenant config is invalid");
        }
    }
}
```

This is not a replacement for proper infrastructure controls, but it catches dangerous misconfiguration early.

---

## 23. API Gateway and Backend-for-Frontend Boundary

For enterprise workflow applications, avoid exposing raw orchestration APIs directly to browsers when domain rules are required.

### 23.1 Bad Pattern

```text
Browser -> Camunda API directly -> complete task
```

This may be acceptable for simple internal tools, but it is weak for high-assurance workflows.

### 23.2 Better Pattern

```text
Browser
  -> Domain Backend / BFF
      -> validates user/domain policy
      -> records audit
      -> calls Camunda API
```

Benefits:

- centralized business authorization,
- consistent validation,
- better audit,
- easier masking,
- easier anti-replay/CSRF handling,
- better user context propagation,
- less exposure of Camunda API surface.

---

## 24. Auditing Security-Relevant Actions

Security and process audit must include more than business outcomes.

### 24.1 Audit These Actions

| Action | Why It Matters |
|---|---|
| login/access to web component | access evidence |
| task claim/unclaim/reassign | workload accountability |
| task completion | business decision evidence |
| process deployment | change control |
| incident retry/resolve | manual intervention evidence |
| variable modification | state tampering risk |
| process cancellation/modification | legal/process impact |
| authorization changes | privilege escalation detection |
| tenant assignment changes | cross-tenant leakage risk |
| credential rotation | security operations evidence |

### 24.2 Audit Record Shape

```json
{
  "eventType": "TASK_COMPLETED",
  "actorType": "USER",
  "actorId": "user-123",
  "tenantCode": "CEA",
  "caseRef": "CASE-2026-000123",
  "processInstanceKey": 2251799813685251,
  "taskId": "...",
  "decision": "APPROVED",
  "reasonCode": "MEETS_REQUIREMENTS",
  "timestamp": "2026-06-21T10:15:30Z",
  "sourceIp": "...",
  "correlationId": "...",
  "authorizationPolicyVersion": "case-decision-policy-v7"
}
```

For regulatory systems, include the policy version used when making authorization/decision checks.

---

## 25. Threat Model

A practical threat model for Camunda 8 includes:

### 25.1 Human Threats

- unauthorized user claims/completes task,
- user sees cross-tenant data,
- support operator changes variable incorrectly,
- admin grants broad permission accidentally,
- developer deploys unapproved BPMN,
- auditor sees PII beyond mandate.

### 25.2 Machine Threats

- worker credential leaked,
- CI/CD credential leaked,
- connector secret exposed,
- webhook spoofing,
- message correlation spoofing,
- service starts unauthorized process instances,
- compromised worker completes jobs fraudulently.

### 25.3 Platform Threats

- public gateway exposure,
- weak TLS/ingress config,
- shared secret across env,
- logs leaking variables,
- Elasticsearch/OpenSearch exposed,
- backup contains unencrypted sensitive data,
- tenant filter missing in read model.

### 25.4 Process Model Threats

- BPMN path bypasses approval,
- error boundary swallows serious failure,
- timer escalation sends data to wrong group,
- message correlation allows external actor to advance wrong instance,
- connector uses untrusted input for URL.

---

## 26. Message and Webhook Security

If external systems start processes or publish messages, protect that boundary.

### 26.1 Required Controls

1. Authenticate caller.
2. Authorize caller for message/process/tenant.
3. Validate payload schema.
4. Validate correlation key ownership.
5. Deduplicate message ID.
6. Rate-limit callers.
7. Record audit.
8. Avoid direct exposure of Camunda API if possible.

### 26.2 Secure Message Gateway Pattern

```text
External System
  -> API Gateway
  -> Integration Service
      -> authenticate/authorize caller
      -> validate tenant/correlation key
      -> persist inbound message
      -> publish message to Camunda
      -> record outcome
```

Do not let arbitrary external systems call Camunda message APIs directly unless the API boundary is very tightly controlled.

---

## 27. Connectors Security

Connectors are convenient, but they widen configuration and secret surfaces.

### 27.1 Connector Risks

- secret accidentally embedded in template/config,
- dynamic URL injection,
- weak TLS validation,
- connector has broader network egress than needed,
- connector retry causes duplicate side effects,
- connector logs sensitive payload,
- connector used for complex business transaction without idempotency.

### 27.2 Connector Governance

For each connector template, define:

- allowed environments,
- allowed endpoints,
- secret alias policy,
- retry policy,
- timeout policy,
- logging policy,
- tenant restrictions,
- owner team,
- approval process,
- versioning policy.

---

## 28. Authorization Failure Handling

What should happen if authorization fails?

It depends on where failure occurs.

| Location | Failure Type | Recommended Handling |
|---|---|---|
| UI/BFF | user not allowed | Return 403, audit denied attempt |
| Worker guard | tenant mismatch/security invariant | Fail job with incident or throw controlled BPMN error depending severity |
| External callback gateway | caller unauthorized | Reject request, do not publish message |
| Deployment pipeline | unauthorized deployment | Fail pipeline, alert release owner |
| Operate mutation | unauthorized support action | Deny action, audit attempt |

### 28.1 Worker Security Failure

If a worker detects tenant mismatch, usually this should not be retried endlessly.

Bad:

```text
fail job with retries-- forever
```

Better:

```text
- create incident with retries exhausted, or
- throw BPMN error if model has explicit security/business rejection path, or
- escalate to security support queue.
```

A tenant mismatch may indicate a data corruption, process modelling bug, malicious input, or routing misconfiguration.

---

## 29. Java Worker Security Checklist

For every worker type:

```text
[ ] Does the worker use dedicated machine credentials?
[ ] Are credentials environment-specific?
[ ] Are credentials tenant/domain-specific where needed?
[ ] Are secrets loaded from secret manager, not variables/config repo?
[ ] Does worker validate variable schema?
[ ] Does worker validate tenant/business entity consistency?
[ ] Does worker enforce idempotency before side effects?
[ ] Does worker avoid logging PII/secrets?
[ ] Does worker propagate correlation id?
[ ] Does worker record audit for security-relevant side effects?
[ ] Does worker fail safely on authorization mismatch?
[ ] Does worker have bounded retries?
[ ] Does worker have least outbound network access?
[ ] Does worker expose only necessary actuator/health endpoints?
[ ] Does worker shut down gracefully without leaking active job state?
```

---

## 30. Camunda Platform Security Checklist

For the platform:

```text
[ ] Is the Zeebe Gateway exposure restricted?
[ ] Are all web components protected by IdP/OIDC?
[ ] Are admin users minimal?
[ ] Are authorizations resource-scoped?
[ ] Are tenant permissions configured and tested?
[ ] Are machine clients separated by env/domain/tenant?
[ ] Are secrets rotated and stored securely?
[ ] Are process variables classified?
[ ] Are Operate mutation permissions restricted?
[ ] Are Tasklist users domain-authorized before completion?
[ ] Are Optimize dashboards tenant-safe?
[ ] Are deployment permissions separated from runtime support permissions?
[ ] Are audit logs immutable or protected?
[ ] Are backups encrypted?
[ ] Is Elasticsearch/OpenSearch privately reachable only?
[ ] Are break-glass procedures defined?
[ ] Are authorization changes audited?
[ ] Is there a periodic access review?
```

---

## 31. Common Anti-Patterns

### 31.1 Everyone Is Admin

Fast for setup. Terrible for production.

Symptoms:

- developers can mutate production process instances,
- support users can deploy BPMN,
- business users can see all tenants,
- audit cannot prove separation of duties.

---

### 31.2 Worker Uses Human Login

Bad because:

- no clear machine accountability,
- password rotation breaks runtime,
- impossible to apply service-level least privilege,
- violates separation between human and machine activity.

---

### 31.3 Tenant ID Only in UI

Bad because backend and worker may still process cross-tenant data.

Tenant must be enforced at API, worker, data, and audit boundaries.

---

### 31.4 Secrets in Variables

Bad because variables spread into Operate, exporters, logs, secondary storage, analytics, and backups.

---

### 31.5 Task Candidate Group as Business Authorization

Bad because candidate group is an assignment hint/constraint, not full business policy.

---

### 31.6 Direct Browser-to-Camunda API for Complex Decisions

Bad if domain authorization, audit, validation, or masking is required.

---

### 31.7 Shared PROD Credential for All Integrations

Bad because compromise of one worker compromises the entire process platform.

---

## 32. Reference Architecture: Secure Regulatory Workflow

Scenario:

- agency users review applications,
- supervisors approve high-risk cases,
- external verification service checks identity/company status,
- enforcement branch handles non-compliance,
- auditors inspect history.

### 32.1 Architecture

```text
                  +----------------------+
                  | External IdP / IAM   |
                  +----------+-----------+
                             |
                             v
+-----------+       +----------------------+       +----------------+
| Browser   |-----> | Case Management BFF  |-----> | Camunda APIs   |
+-----------+       +----------------------+       +----------------+
                           |       |                       |
                           |       v                       v
                           |  +---------+          +----------------+
                           |  | Domain  |          | Zeebe Cluster  |
                           |  | DB/Auth |          +----------------+
                           |  +---------+                  |
                           |                               v
                           |                       +----------------+
                           |                       | Exporters /    |
                           |                       | Operate/Tasklist|
                           |                       +----------------+
                           |
                           v
                  +----------------------+
                  | Audit Store          |
                  +----------------------+

+----------------------+        +----------------------+
| Java Worker: Verify  |------> | External Verification|
+----------------------+        +----------------------+

+----------------------+        +----------------------+
| Java Worker: Notify  |------> | Email/SMS Gateway    |
+----------------------+        +----------------------+
```

### 32.2 Access Rules

| Actor | Rule |
|---|---|
| Applicant | Cannot access Camunda directly |
| Officer | Uses case UI/BFF, task completion domain-authorized |
| Supervisor | Can approve high-risk cases only within tenant/unit |
| Auditor | Read-only audit/report access |
| Worker verify | Can activate verification jobs only; calls verification API |
| Worker notify | Can activate notification jobs only; no case mutation permission |
| Release pipeline | Can deploy approved BPMN/forms to PROD |
| Support L2 | Can retry incidents within assigned process domain |
| Platform admin | Can manage platform, not approve business cases |

### 32.3 Security Invariants

```text
Invariant 1:
No browser sends raw business decision directly to Camunda without BFF validation.

Invariant 2:
No worker executes side effect before tenant/business entity consistency check.

Invariant 3:
No secret is stored in process variables.

Invariant 4:
Every manual production mutation has ticket, actor, reason, and audit record.

Invariant 5:
Every process instance affecting a case has a caseRef and tenantCode.

Invariant 6:
Every human decision records actor, timestamp, policy version, and reason code.
```

---

## 33. Practical Design Review Questions

Ask these during architecture review:

1. Which users can access Operate in PROD?
2. Can any support user view all tenant variables?
3. Can a developer deploy BPMN directly to PROD?
4. Does worker credential allow too many process domains?
5. Are process variables free of secrets and unnecessary PII?
6. Where is domain authorization enforced for user task completion?
7. Can candidate group alone allow invalid approval?
8. How is tenant mismatch detected?
9. Are message publishers authenticated and authorized?
10. Can external systems spoof correlation keys?
11. What happens if a worker credential leaks?
12. How do we rotate worker credentials?
13. Are authorization changes audited?
14. Can Optimize dashboards leak cross-tenant data?
15. Are backups encrypted and access-controlled?
16. Does break-glass access expire automatically?
17. Are admin permissions reviewed periodically?
18. Is production support action replayable/explainable in audit?
19. Can a process model bypass maker-checker by mistake?
20. Is the deployment pipeline itself least-privilege?

---

## 34. Production-Grade Access Matrix Template

Use this template before going live.

| Subject | Type | Env | Tenant Scope | Component | Permission | Approval Owner | Review Frequency |
|---|---|---|---|---|---|---|---|
| camunda-worker-case-review-prod | machine | PROD | CEA | Zeebe/API | activate/complete selected jobs | Platform + Domain Lead | quarterly |
| camunda-deployer-prod | machine | PROD | all approved | Zeebe/API | deploy approved resources | Release Manager | monthly |
| support-l1 | group | PROD | assigned tenant | Operate | read-only | Support Manager | quarterly |
| support-l2 | group | PROD | assigned tenant | Operate | retry incidents | Support Manager | quarterly |
| auditors | group | PROD | assigned tenant | reports/audit | read-only | Compliance | quarterly |
| platform-admin | group | PROD | platform | Admin/Identity | admin | Platform Owner | monthly |
| licensing-reviewer | group | PROD | licensing tenant | Tasklist/BFF | claim/complete through BFF | Business Owner | quarterly |

---

## 35. Summary Mental Model

Camunda 8 security is not one checkbox.

It is a layered design:

```text
Identity proves who the subject is.
Authorization limits platform/resource access.
Tenancy limits logical data/process scope.
Network controls reduce reachable attack surface.
Secrets management protects machine credentials.
Domain authorization protects business decisions.
Audit proves what happened and why.
```

For production Camunda 8, the mature engineering stance is:

> Treat every process action as a state-changing command. Treat every command as requiring identity, authorization, tenant validation, input validation, idempotency, and auditability.

That mindset prevents the common mistake of designing Camunda security as just “login page + roles”.

---

## 36. References

- Camunda 8 Docs — Orchestration Cluster authorization: https://docs.camunda.io/docs/components/concepts/access-control/authorizations/
- Camunda 8 Docs — Authorizations: https://docs.camunda.io/docs/components/identity/authorization/
- Camunda 8 Docs — Mapping rules: https://docs.camunda.io/docs/components/concepts/access-control/mapping-rules/
- Camunda 8 Docs — Management Identity overview: https://docs.camunda.io/docs/self-managed/components/management-identity/overview/
- Camunda 8 Docs — Multi-tenancy concepts: https://docs.camunda.io/docs/components/concepts/multi-tenancy/
- Camunda 8 Docs — Self-managed multi-tenancy: https://docs.camunda.io/docs/8.7/self-managed/concepts/multi-tenancy/
- Camunda 8 Docs — User tasks: https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/
- Camunda 8 Docs — Java Client: https://docs.camunda.io/docs/apis-tools/java-client/getting-started/
- Camunda 8 Docs — What's new in 8.8: https://docs.camunda.io/docs/reference/announcements-release-notes/880/whats-new-in-88/
- Camunda 8 Docs — 8.9 announcements: https://docs.camunda.io/docs/reference/announcements-release-notes/890/890-announcements/

---

## 37. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 000 — Orientation, Scope, Mental Model, and What Changes from Camunda 7
- Part 001 — Camunda 8 Platform Architecture
- Part 002 — Zeebe Engine Internals
- Part 003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees
- Part 004 — BPMN Execution Semantics in Zeebe
- Part 005 — Java Client Evolution
- Part 006 — Building Production-Grade Java Job Workers
- Part 007 — Worker Correctness
- Part 008 — Variables, Serialization, Payload Discipline, and Data Contracts
- Part 009 — BPMN Modelling for Distributed Execution
- Part 010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design
- Part 011 — Error Handling Semantics
- Part 012 — Timers, Deadlines, SLA, Escalation, and Time Semantics
- Part 013 — User Tasks, Tasklist, Forms, Assignment, Candidate Groups, and Human Workflow Architecture
- Part 014 — Spring Boot Integration
- Part 015 — Worker Application Architecture
- Part 016 — Connectors, Integration Patterns, and When Java Workers Are Still Better
- Part 017 — Exporters, Elasticsearch/OpenSearch, Operate, Tasklist, and Read-Side Architecture
- Part 018 — Operate Deep Dive
- Part 019 — Tasklist and Human Work Management at Scale
- Part 020 — Optimize, Process Analytics, Bottleneck Detection, and Feedback Loop Engineering
- Part 021 — Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-022.md
```

Judul:

```text
Part 022 — Deployment Models: SaaS, Self-Managed, Kubernetes, Helm, and Enterprise Runtime Topology
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-020.md">⬅️ Part 020 — Optimize, Process Analytics, Bottleneck Detection, and Feedback Loop Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-022.md">Part 022 — Deployment Models: SaaS, Self-Managed, Kubernetes, Helm, and Enterprise Runtime Topology ➡️</a>
</div>
