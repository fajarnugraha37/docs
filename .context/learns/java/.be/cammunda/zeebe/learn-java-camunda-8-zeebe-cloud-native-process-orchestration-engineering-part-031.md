# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-031.md

# Part 031 — Multi-Tenancy, Multi-Region, Environment Strategy, and Enterprise Isolation

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `031 / 035`  
> Level: Advanced / Staff+ Engineering  
> Fokus: tenant isolation, environment topology, region strategy, worker isolation, deployment governance, and enterprise runtime boundaries for Camunda 8 / Zeebe.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu menjawab pertanyaan berikut dengan kualitas arsitektur production-grade:

1. Apa bedanya **tenant**, **environment**, **cluster**, **region**, **namespace**, dan **business domain** dalam Camunda 8?
2. Kapan memakai **multi-tenancy dalam satu Camunda installation**, dan kapan harus memakai **cluster terpisah**?
3. Bagaimana mendesain Java worker agar **tenant-aware**, aman, observable, dan tidak menyebabkan cross-tenant leakage?
4. Bagaimana membedakan **multi-zone high availability**, **multi-region disaster recovery**, dan **active-active business topology**?
5. Bagaimana menata environment `local/dev/sit/uat/preprod/prod` agar process definition, worker version, secret, identity, dan data tidak saling mencemari?
6. Bagaimana membuat decision matrix untuk enterprise isolation: cost, compliance, performance, blast radius, operability, and release governance?

Bagian ini bukan membahas ulang Kubernetes, networking, OAuth, RBAC, atau Java multithreading. Semua itu sudah ada di seri sebelumnya. Fokus kita sekarang adalah **Camunda 8-specific isolation architecture**.

---

## 1. Core Mental Model

Camunda 8 / Zeebe adalah distributed process orchestration platform. Dalam enterprise, tantangan besar biasanya bukan hanya “bagaimana menjalankan workflow”, tetapi:

- siapa boleh melihat process apa;
- siapa boleh deploy process apa;
- worker mana boleh mengambil job tenant mana;
- data tenant mana boleh diekspor ke read model mana;
- region mana menjadi source of truth;
- environment mana boleh punya secret asli;
- bagaimana mencegah UAT worker mengerjakan production job;
- bagaimana mencegah process definition tenant A dipakai tenant B;
- bagaimana melakukan failover tanpa membuat duplicate business execution.

Jadi, untuk top-level engineering, jangan mulai dari pertanyaan:

> “Camunda support multi-tenancy atau tidak?”

Mulailah dari pertanyaan:

> “Boundary apa yang harus tidak boleh bocor?”

Boundary itu bisa berupa:

- data;
- access;
- runtime compute;
- deployment ownership;
- process model ownership;
- worker execution;
- secret;
- observability;
- audit;
- region;
- legal jurisdiction;
- business blast radius.

Camunda multi-tenancy adalah salah satu alat. Bukan satu-satunya alat.

---

## 2. Terminology yang Harus Dibedakan

### 2.1 Tenant

Tenant adalah logical isolation unit. Dalam Camunda 8, multi-tenancy memungkinkan satu installation melayani beberapa tenant dengan isolasi logis data, konfigurasi, dan permission.

Contoh tenant:

- agency A vs agency B;
- business unit licensing vs enforcement;
- customer A vs customer B;
- department internal vs external partner.

Tenant biasanya menjawab:

> “Data dan process milik siapa?”

Tenant **bukan otomatis** berarti database fisik berbeda, cluster berbeda, atau namespace berbeda.

---

### 2.2 Environment

Environment adalah lifecycle stage untuk software delivery.

Contoh:

- local;
- dev;
- sit;
- uat;
- preprod;
- prod;
- dr.

Environment menjawab:

> “Stage release/testing apa ini?”

Environment tidak boleh dicampur dengan tenant.

Salah:

```text
Tenant = UAT
Tenant = PROD
```

Benar:

```text
Environment = UAT
Tenant = agency-a
Tenant = agency-b
```

---

### 2.3 Cluster

Cluster adalah runtime installation Camunda 8.

Satu cluster bisa:

- single tenant;
- multi tenant;
- per environment;
- per region;
- per business domain;
- per criticality level.

Cluster menjawab:

> “Runtime engine dan platform component mana yang memproses workload?”

---

### 2.4 Region

Region adalah geographic/cloud region boundary.

Contoh:

- `ap-southeast-1`;
- `ap-southeast-3`;
- `eu-central-1`;
- on-prem DC1/DC2.

Region menjawab:

> “Workload dan data secara fisik/logis berada di lokasi mana?”

Region terkait:

- latency;
- legal residency;
- DR;
- failover;
- network routing;
- storage replication;
- operational ownership.

---

### 2.5 Availability Zone

Availability zone adalah failure domain dalam region. Multi-zone deployment meningkatkan availability terhadap failure satu zone, tetapi tetap dalam satu region.

Jangan menyamakan:

```text
Multi-zone = disaster recovery
```

Multi-zone membantu HA dalam region. Multi-region membantu region-level continuity, tetapi jauh lebih kompleks.

---

### 2.6 Namespace

Namespace, dalam konteks Kubernetes, adalah logical grouping resource Kubernetes. Namespace bisa membantu operational separation, tetapi bukan security boundary absolut jika cluster policy tidak benar.

Namespace menjawab:

> “Resource Kubernetes ini dikelompokkan dan dibatasi bagaimana?”

Namespace tidak otomatis sama dengan tenant.

---

### 2.7 Business Domain

Business domain adalah bounded context bisnis.

Contoh:

- licensing;
- enforcement;
- appeal;
- inspection;
- billing;
- document management.

Domain menjawab:

> “Capability bisnis apa yang dikelola?”

Satu tenant bisa punya banyak domain. Satu domain bisa melayani banyak tenant.

---

## 3. Isolation Dimensions

Saat mendesain enterprise Camunda 8 topology, gunakan delapan dimensi isolasi berikut.

| Dimension | Pertanyaan | Risiko jika bocor |
|---|---|---|
| Data isolation | Apakah tenant A bisa melihat data tenant B? | confidentiality breach |
| Execution isolation | Apakah worker tenant A bisa mengambil job tenant B? | wrong business execution |
| Deployment isolation | Apakah team A bisa deploy process yang memengaruhi team B? | release blast radius |
| Access isolation | Apakah user role salah bisa access Operate/Tasklist tenant lain? | privilege escalation |
| Secret isolation | Apakah credential tenant/domain tercampur? | credential leakage |
| Observability isolation | Apakah log/trace/metrics expose PII tenant lain? | compliance violation |
| Failure isolation | Apakah incident tenant A membuat tenant B down? | noisy neighbor |
| Jurisdiction isolation | Apakah data diproses di region yang salah? | legal/regulatory breach |

Top 1% engineer tidak hanya bertanya “fiturnya ada?”, tetapi “failure mode-nya apa kalau boundary ini gagal?”

---

## 4. Camunda 8 Multi-Tenancy: Apa yang Harus Dipahami

Multi-tenancy dalam Camunda 8 memungkinkan satu installation melayani beberapa tenant dengan logical isolation. Dalam konsep Camunda 8, tenant adalah ruang isolasi logis dengan data, konfigurasi, dan permission sendiri. Dalam Self-Managed, multi-tenancy dapat dikonfigurasi melalui komponen platform dan Helm, sementara access control Camunda 8 memiliki authorization untuk Orchestration Cluster seperti Zeebe, Admin, Operate, Tasklist, dan Orchestration Cluster APIs.

Hal penting:

1. Multi-tenancy adalah **logical isolation**, bukan physical isolation.
2. Satu cluster tetap menjadi shared runtime.
3. Resource contention tetap mungkin terjadi.
4. Salah konfigurasi authorization tetap bisa menyebabkan exposure.
5. Worker harus tenant-aware.
6. Monitoring harus bisa dipilah per tenant.
7. Deployment governance harus mencegah process/worker mismatch lintas tenant.

---

## 5. Multi-Tenancy Bukan Pengganti Dedicated Cluster

Ada tiga pola besar.

### 5.1 Shared Cluster, Multi-Tenant

```text
One Camunda 8 Installation
├── Tenant A
├── Tenant B
└── Tenant C
```

Cocok jika:

- tenant memiliki compliance requirement mirip;
- workload tidak terlalu ekstrem berbeda;
- cost efficiency penting;
- team platform mature;
- observability dan access governance kuat;
- tenant masih dalam organisasi yang sama.

Risiko:

- noisy neighbor;
- shared upgrade risk;
- shared cluster outage;
- harder capacity attribution;
- stricter governance needed;
- more complex tenant-aware worker design.

---

### 5.2 Dedicated Cluster per Tenant

```text
Tenant A → Camunda Cluster A
Tenant B → Camunda Cluster B
Tenant C → Camunda Cluster C
```

Cocok jika:

- tenant adalah customer eksternal besar;
- strict data residency;
- different compliance boundary;
- high workload variance;
- independent release cadence;
- strong blast-radius isolation;
- contractual SLA berbeda.

Risiko:

- cost lebih tinggi;
- operational overhead lebih tinggi;
- upgrade orchestration lebih kompleks;
- duplicated platform components;
- more automation required.

---

### 5.3 Dedicated Cluster per Domain / Criticality

```text
Critical Enforcement → Cluster A
General Licensing    → Cluster B
Internal Workflow    → Cluster C
```

Cocok jika boundary utama bukan tenant, tetapi criticality/domain.

Contoh:

- enforcement workflow punya legal deadline dan audit tinggi;
- survey/internal workflow low criticality;
- payment/revenue workflow butuh stricter controls.

Ini sering lebih realistis daripada cluster per tenant.

---

## 6. Decision Matrix: Shared Tenant vs Dedicated Cluster

| Criterion | Shared Multi-Tenant Cluster | Dedicated Cluster |
|---|---|---|
| Cost | rendah | tinggi |
| Operational overhead | rendah-menengah | tinggi |
| Blast radius | tinggi | rendah |
| Data isolation strength | logical | physical/logical stronger |
| Performance isolation | lemah-menengah | kuat |
| Release independence | lemah | kuat |
| Tenant-specific customization | terbatas | fleksibel |
| Compliance strictness | cocok untuk moderate | cocok untuk strict |
| Platform automation need | moderate | high |
| DR complexity | moderate | high per cluster |

Heuristic:

> Jika tenant memiliki SLA, legal boundary, release cadence, atau data residency yang berbeda secara material, dedicated cluster lebih aman.

> Jika tenant hanya representasi department internal dengan compliance sama dan workload mirip, shared multi-tenancy bisa masuk akal.

---

## 7. Environment Strategy

### 7.1 Minimal Enterprise Environment

```text
local → dev → sit → uat → preprod → prod
```

Setiap environment harus punya boundary jelas.

| Environment | Tujuan | Data | External integration | Camunda topology |
|---|---|---|---|---|
| local | developer feedback | synthetic | mocked/local | lightweight/local runtime |
| dev | team integration | synthetic/sanitized | mostly sandbox | shared dev cluster |
| sit | system integration | sanitized | sandbox/stub/mocked | prod-like enough |
| uat | user validation | masked/sanitized | controlled sandbox | close to prod behavior |
| preprod | release rehearsal | masked/prod-like | prod-like external config | prod topology mirror |
| prod | live | real | real | hardened topology |
| dr | continuity | replicated/restore | controlled failover | DR topology |

---

### 7.2 Golden Rule: Never Share Runtime Between Environment Stages

Jangan pernah membuat satu Camunda cluster yang melayani `dev`, `uat`, dan `prod` hanya dibedakan tenant.

Salah:

```text
One Cluster
├── tenant-dev
├── tenant-uat
└── tenant-prod
```

Kenapa salah?

- worker salah environment bisa mengambil job prod;
- process deployment UAT bisa mencemari prod;
- authorization mistake berdampak fatal;
- test data bercampur dengan real data;
- upgrade/testing tidak bisa aman;
- backup/restore menjadi ambigu.

Benar:

```text
Dev Cluster
├── tenant-a
└── tenant-b

UAT Cluster
├── tenant-a
└── tenant-b

Prod Cluster
├── tenant-a
└── tenant-b
```

Environment adalah **hard boundary**. Tenant adalah **logical boundary inside an environment**.

---

## 8. Tenant-Aware Process Deployment

Dalam multi-tenant Camunda architecture, process deployment harus menjawab:

1. Process definition ini untuk tenant mana?
2. Siapa owner process model?
3. Apakah process id sama dipakai lintas tenant?
4. Apakah versioning tenant A boleh berbeda dari tenant B?
5. Apakah worker contract kompatibel dengan semua tenant?

### 8.1 Shared Process Model Across Tenants

```text
processId = application-review
tenant-a: version 12
tenant-b: version 12
tenant-c: version 12
```

Cocok jika tenant menggunakan proses standar.

Kelebihan:

- governance mudah;
- testing lebih efisien;
- worker contract seragam;
- analytics cross-tenant lebih mudah.

Kekurangan:

- customization terbatas;
- perubahan satu model perlu impact analysis semua tenant;
- exception tenant-specific bisa membuat BPMN penuh conditional branch.

---

### 8.2 Tenant-Specific Process Model

```text
processId = application-review-tenant-a
processId = application-review-tenant-b
```

Cocok jika variasi tenant signifikan.

Kelebihan:

- fleksibel;
- blast radius model change lebih kecil;
- tenant-specific rule jelas.

Kekurangan:

- model sprawl;
- duplicate logic;
- harder analytics;
- worker compatibility lebih kompleks.

---

### 8.3 Shared Process with Tenant-Specific Rules Service

```text
BPMN: application-review
  → service task: evaluate-policy
       Java worker calls tenant-aware policy service
```

Ini sering menjadi kompromi terbaik.

BPMN tetap stabil, sedangkan variasi tenant dimasukkan ke policy/rules service.

Gunakan pola ini jika variasi tenant berupa:

- threshold;
- routing rule;
- SLA duration;
- required document list;
- approval matrix;
- notification template;
- fee calculation;
- minor eligibility rule.

Jangan gunakan pola ini jika variasi tenant mengubah lifecycle besar.

---

## 9. Tenant-Aware Java Worker Design

Worker adalah area paling rawan leakage.

Worker yang buruk:

```java
@JobWorker(type = "check-eligibility")
public void handle(JobClient client, ActivatedJob job) {
    var applicantId = (String) job.getVariablesAsMap().get("applicantId");
    eligibilityService.check(applicantId); // tenant implicit, dangerous
    client.newCompleteCommand(job).send().join();
}
```

Masalah:

- tenant tidak eksplisit;
- credential mungkin global;
- data source mungkin default;
- audit tidak tahu tenant;
- external call bisa salah tenant;
- idempotency key tidak tenant-scoped.

Worker yang lebih benar:

```java
public final class TenantAwareJobContext {
    private final String tenantId;
    private final long processInstanceKey;
    private final long jobKey;
    private final String bpmnProcessId;
    private final String jobType;
    private final String businessKey;
    private final Map<String, Object> variables;

    // getters omitted
}
```

Handler:

```java
@JobWorker(type = "check-eligibility.v1", autoComplete = false)
public void handleCheckEligibility(ActivatedJob job, JobClient client) {
    TenantAwareJobContext ctx = contextFactory.from(job);

    tenantGuard.assertAllowed(ctx.tenantId(), ctx.jobType());

    IdempotencyKey key = IdempotencyKey.of(
        ctx.tenantId(),
        ctx.businessKey(),
        ctx.jobType(),
        "v1"
    );

    CheckEligibilityCommand command = mapper.toCommand(ctx);

    WorkerResult result = idempotencyService.executeOnce(key, () ->
        applicationService.checkEligibility(ctx.tenantId(), command)
    );

    client.newCompleteCommand(job.getKey())
        .variables(result.toVariables())
        .send()
        .join();
}
```

Key ideas:

- tenant id is explicit;
- tenant id participates in idempotency;
- tenant guard exists before side effect;
- job type is versioned;
- application service receives tenant;
- audit can reconstruct decision;
- side effect cannot accidentally use default tenant.

---

## 10. Tenant Context Propagation

Tenant context harus masuk ke semua layer.

```text
Zeebe Job
  → Worker Adapter
  → Tenant Guard
  → Application Service
  → Domain Policy
  → Repository/Data Source
  → External API Client
  → Audit Logger
  → Metrics/Tracing
```

Jika salah satu layer tidak tenant-aware, isolation bisa bocor.

### 10.1 Tenant Context Object

```java
public record TenantContext(
    String tenantId,
    String environment,
    String region,
    String actor,
    String correlationId
) {
    public TenantContext {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
        if (environment == null || environment.isBlank()) {
            throw new IllegalArgumentException("environment is required");
        }
    }
}
```

### 10.2 Do Not Hide Tenant in ThreadLocal Without Discipline

ThreadLocal can be useful but dangerous in worker applications because:

- async execution can lose context;
- virtual threads / thread pools require care;
- context leaks between jobs if not cleared;
- testing becomes implicit.

Safer default:

- pass `TenantContext` explicitly;
- use MDC only for logging;
- clear MDC in `finally` block;
- do not make business logic depend only on MDC/ThreadLocal.

---

## 11. Tenant-Scoped Idempotency

Never use idempotency key without tenant.

Bad:

```text
operation_key = applicationId + jobType
```

Better:

```text
operation_key = environment + tenantId + businessKey + jobType + semanticOperationVersion
```

Example:

```text
prod:agency-a:APP-2026-000123:check-eligibility:v1
```

Why environment too?

Because lower environments often reuse synthetic IDs. If shared support tables or integration mocks are accidentally used, environment prefix reduces collision risk.

---

## 12. Tenant-Scoped Secret Management

Worker often calls tenant-specific external systems.

Do not do this:

```text
EXTERNAL_API_CLIENT_ID=global-client
EXTERNAL_API_SECRET=global-secret
```

Prefer:

```text
/aceas/prod/agency-a/external-x/client-id
/aceas/prod/agency-a/external-x/client-secret
/aceas/prod/agency-b/external-x/client-id
/aceas/prod/agency-b/external-x/client-secret
```

Worker resolves credential by:

```text
environment + tenantId + externalSystem + credentialPurpose
```

Security invariant:

> A worker must never call an external system using credentials not authorized for the job tenant.

---

## 13. Tenant-Aware External API Clients

Pattern:

```java
public interface ExternalVerificationPort {
    VerificationResult verify(TenantContext tenant, VerificationCommand command);
}
```

Implementation:

```java
public final class TenantAwareExternalVerificationClient implements ExternalVerificationPort {
    private final CredentialResolver credentialResolver;
    private final HttpClientFactory httpClientFactory;

    @Override
    public VerificationResult verify(TenantContext tenant, VerificationCommand command) {
        ExternalCredential credential = credentialResolver.resolve(
            tenant.environment(),
            tenant.tenantId(),
            "external-verification"
        );

        ExternalEndpoint endpoint = endpointRegistry.resolve(
            tenant.environment(),
            tenant.tenantId(),
            "external-verification"
        );

        return httpClientFactory.forEndpoint(endpoint, credential)
            .verify(command);
    }
}
```

This avoids:

- default endpoint leakage;
- wrong credential usage;
- hidden environment switching;
- tenant-specific integration ambiguity.

---

## 14. Data Isolation Patterns

### 14.1 Shared Database, Tenant Column

```text
case_table
├── tenant_id
├── case_id
├── status
└── ...
```

Pros:

- cheaper;
- easier cross-tenant reporting;
- simpler migrations.

Cons:

- query filter bug can leak data;
- index design must include tenant;
- backup/restore per tenant hard;
- noisy neighbor possible.

Required invariant:

```sql
where tenant_id = :tenantId
```

must be enforced by repository layer, not trusted to developer memory.

---

### 14.2 Schema per Tenant

```text
agency_a.case_table
agency_b.case_table
```

Pros:

- stronger separation;
- easier tenant export/archive;
- less accidental query leakage.

Cons:

- migration complexity;
- connection pool complexity;
- many schemas operational burden.

---

### 14.3 Database per Tenant

```text
agency-a-db
agency-b-db
```

Pros:

- strongest operational isolation;
- restore tenant independently;
- better blast-radius control.

Cons:

- high cost;
- connection management;
- migration automation required;
- analytics cross-tenant harder.

---

### 14.4 Camunda Tenant ≠ Domain Database Tenant Automatically

Even if Camunda jobs have tenant ID, your application database must enforce tenant too.

Invariant:

> Camunda tenant context and business data tenant context must be validated at boundary crossing.

Example:

```java
CaseRecord caseRecord = repository.findByTenantAndCaseId(
    ctx.tenantId(),
    command.caseId()
).orElseThrow(...);
```

Never:

```java
repository.findByCaseId(command.caseId())
```

---

## 15. Worker Deployment Isolation

There are three common patterns.

### 15.1 Shared Worker for All Tenants

```text
Worker Deployment: application-workers
├── handles tenant-a
├── handles tenant-b
└── handles tenant-c
```

Good when:

- same code path;
- same release cadence;
- tenant-specific config resolved dynamically;
- low compliance separation requirement.

Risk:

- bug impacts all tenants;
- concurrency one tenant can starve others;
- secret resolution must be perfect;
- metrics must be tenant-tagged.

---

### 15.2 Worker Deployment per Tenant

```text
worker-agency-a
worker-agency-b
worker-agency-c
```

Good when:

- tenant-specific integration;
- different scaling;
- different release window;
- strict isolation;
- tenant-specific secret mount.

Risk:

- deployment sprawl;
- code duplication if not automated;
- more CI/CD complexity;
- more monitoring dashboards.

---

### 15.3 Worker Deployment per Domain, Tenant-Aware Internally

```text
licensing-workers
appeal-workers
 enforcement-workers
```

Good compromise:

- scale by domain workload;
- isolate critical capabilities;
- preserve shared code across tenants;
- reduce blast radius vs one giant worker.

---

## 16. Worker Starvation and Fairness

In shared worker deployments, tenant A can dominate capacity.

Example:

```text
Tenant A: 100,000 pending jobs
Tenant B: 200 pending jobs
Tenant C: 50 pending jobs
```

If worker simply activates jobs by type, tenant B/C might experience latency.

Mitigations:

1. separate job types per tenant/domain where necessary;
2. separate worker deployments per tenant/domain;
3. rate limit by tenant;
4. use tenant-aware queues in downstream application layer;
5. scale critical tenant worker separately;
6. monitor activation/completion latency per tenant;
7. define tenant-level SLO.

Heuristic:

> If fairness matters, do not rely only on shared worker concurrency. Make fairness explicit.

---

## 17. Multi-Region Strategy

Multi-region is not one thing. There are several levels.

### 17.1 Single Region, Multi-Zone

```text
Region A
├── AZ 1
├── AZ 2
└── AZ 3
```

Purpose:

- high availability within region;
- tolerate node/AZ failure;
- lower latency;
- simpler than multi-region.

This is usually the first production target.

---

### 17.2 Active-Passive DR

```text
Region A: active
Region B: passive / standby
```

Purpose:

- recover from region failure;
- preserve data using backup/replication;
- failover manually or semi-automatically.

Challenges:

- RPO/RTO definition;
- data replication lag;
- external endpoint switch;
- worker double-execution prevention;
- DNS/global traffic routing;
- identity/session behavior;
- downstream system failover.

---

### 17.3 Active-Active Data, Controlled Traffic

Some Camunda dual-region topologies combine replication with region-level traffic strategy. Recent Camunda documentation notes dual-region support with limitations and version-specific behavior, including active-active behavior for newer API paths in certain 8.9 scenarios.

Do not treat “active-active” as free scalability.

You must answer:

- which region owns command execution?
- can both regions accept process-start commands?
- how is duplicate submission prevented?
- where do workers run?
- can the same job be activated in two regions?
- how are external side effects fenced?
- what is the failback process?

---

## 18. Region Ownership Models

### 18.1 Region as DR Only

```text
All production traffic → Region A
DR standby           → Region B
```

Simpler.

Good for:

- strict consistency;
- simpler operations;
- normal enterprise DR.

---

### 18.2 Tenant-to-Region Affinity

```text
Tenant A → Region SG
Tenant B → Region EU
Tenant C → Region US
```

Good for:

- data residency;
- latency;
- jurisdiction.

Requires:

- tenant routing;
- separate cluster or region-aware cluster design;
- region-aware worker deployment;
- tenant-to-region registry;
- compliance evidence.

---

### 18.3 Domain-to-Region Affinity

```text
Public portal workflow → Region A
Back-office workflow   → Region B
```

Usually dangerous unless domain boundaries are strong and data flow is clear.

---

## 19. Tenant/Region Registry

For enterprise clarity, maintain a registry:

```yaml
tenants:
  agency-a:
    displayName: Agency A
    environment: prod
    primaryRegion: ap-southeast-1
    drRegion: ap-southeast-3
    camundaCluster: camunda-prod-main
    processDefinitions:
      application-review: enabled
      appeal-review: enabled
    workerMode: shared-domain-workers
    dataStore: shared-db-tenant-column
    externalSystems:
      registry-api:
        endpointRef: agency-a-registry-prod
        credentialRef: agency-a-registry-prod-client
    slaTier: critical
```

This registry should drive:

- deployment pipeline;
- worker configuration;
- secret resolution;
- monitoring labels;
- access review;
- DR runbook;
- audit reporting.

Avoid configuration living only in human memory.

---

## 20. Environment Naming and Resource Naming

Use deterministic names.

```text
<system>-<environment>-<region>-<component>-<tenant?>
```

Examples:

```text
aceas-prod-apse1-camunda
aceas-uat-apse1-camunda
aceas-prod-apse1-worker-licensing
aceas-prod-apse1-worker-enforcement
aceas-prod-apse1-secret-agency-a-registry
```

Bad names:

```text
camunda-new
camunda-prod2
worker-final
worker-temp
uat-prod-test
```

Names are operational controls. Bad names create incident risk.

---

## 21. Release Governance Across Environments

A Camunda 8 release is not just a container image.

A full release unit may include:

- BPMN files;
- DMN files;
- forms;
- worker application image;
- process variable schema;
- connector templates;
- Identity/authorization changes;
- tenant assignment changes;
- external endpoint config;
- secret references;
- dashboard/alert changes;
- migration scripts;
- runbook updates.

Release promotion should be:

```text
same artifact → promoted config → higher environment
```

Not:

```text
rebuild different artifact per environment
```

Why?

- reproducibility;
- auditability;
- rollback clarity;
- security review;
- deterministic production behavior.

---

## 22. Process Deployment Promotion Pattern

Recommended:

```text
Git commit
  → CI validates BPMN/forms/contracts
  → Build worker image
  → Package process bundle
  → Deploy to DEV
  → Promote same bundle to SIT
  → Promote same bundle to UAT
  → Promote same bundle to PREPROD
  → Promote same bundle to PROD
```

Each environment injects:

- cluster endpoint;
- credentials;
- tenant enablement;
- external endpoint references;
- feature flags;
- rate limits.

The BPMN should not contain environment-specific URLs or credentials.

---

## 23. Cross-Environment Contamination Failure Modes

### 23.1 UAT Worker Connects to PROD Cluster

Cause:

- wrong endpoint;
- copied secret;
- missing environment validation.

Mitigation:

- environment claim in credential;
- cluster allowlist;
- startup guard;
- network policy;
- separate cloud account/project;
- alert on unknown worker identity.

Startup guard example:

```java
if (!expectedEnvironment.equals(config.environment())) {
    throw new IllegalStateException("Worker environment mismatch");
}

if (!clusterMetadata.environment().equals(config.environment())) {
    throw new IllegalStateException("Camunda cluster environment mismatch");
}
```

---

### 23.2 PROD Process Calls UAT External API

Cause:

- endpoint registry wrong;
- default fallback endpoint;
- copied config map;
- missing tenant/environment key.

Mitigation:

- no fallback for production endpoint;
- endpoint must be explicitly resolved;
- config validation at startup;
- synthetic smoke test;
- egress firewall policy.

---

### 23.3 UAT Data in PROD Analytics

Cause:

- shared secondary storage;
- shared exporter target;
- wrong index alias;
- shared dashboard query.

Mitigation:

- environment-specific secondary storage;
- strict index naming;
- dashboard environment filter;
- ingestion guard.

---

## 24. Access Control by Environment and Tenant

Access should be layered.

```text
Identity Provider Group
  → Camunda Role/Authorization
  → Tenant Assignment
  → Component Access
  → API Scope
  → Worker Credential Permission
```

Example access matrix:

| Actor | DEV | UAT | PROD |
|---|---:|---:|---:|
| Developer | deploy/test | read limited | no direct write |
| QA | test/read | test/read | no direct write |
| BA | read process/task | validate task | no prod unless business role |
| Operator | operate/admin | operate/admin | operate with approval |
| Platform Admin | full | full | break-glass controlled |
| Worker Service Account | activate selected job types | selected | selected production job types |

Do not give worker service account broad admin permission.

---

## 25. Tenant-Aware Observability

Every log/metric/trace for worker execution should include:

- environment;
- region;
- tenant id;
- bpmn process id;
- process definition version/version tag;
- process instance key;
- job key;
- job type;
- worker name;
- business key/case id;
- correlation id.

Example structured log:

```json
{
  "event": "worker.job.completed",
  "environment": "prod",
  "region": "ap-southeast-1",
  "tenantId": "agency-a",
  "bpmnProcessId": "application-review",
  "processInstanceKey": 2251799813685251,
  "jobKey": 2251799813689301,
  "jobType": "check-eligibility.v1",
  "businessKey": "APP-2026-000123",
  "durationMs": 421,
  "outcome": "eligible"
}
```

Metric labels must be controlled. Tenant label can create high cardinality if tenant count is huge, but in enterprise workflow systems tenant count is often manageable. If tenant count is large, aggregate by tenant tier or domain and keep tenant-specific detail in logs/traces/audit store.

---

## 26. Tenant-Level SLO

Define SLO per tenant/domain.

Examples:

```text
Tenant agency-a:
- 99% service task completion latency < 5s for check-eligibility
- 99% user task visibility delay < 10s
- incident count for critical process < 5 per day
- exporter lag < 60s
```

Why tenant-level?

Because average platform metrics can hide tenant pain.

Bad:

```text
Average job latency = 1s
```

Better:

```text
Tenant A p99 job latency = 1s
Tenant B p99 job latency = 45s
Tenant C p99 job latency = 2s
```

---

## 27. Multi-Tenant Incident Triage

When incident occurs, classify:

1. single process instance;
2. single tenant;
3. single job type;
4. single worker deployment;
5. single partition;
6. single cluster;
7. single region;
8. cross-region/global.

This classification determines escalation.

Example:

```text
Incident: 4,000 failed jobs in check-eligibility.v1
Scope: tenant agency-a only
Likely cause: tenant-specific external API credential expired
Action: rotate agency-a credential, retry affected incidents
Blast radius: contained
```

Different from:

```text
Incident: all tenants cannot complete jobs
Scope: all job types, all tenants
Likely cause: Camunda gateway/broker issue or network policy
Action: platform incident
Blast radius: global
```

---

## 28. Multi-Region Failover and Worker Fencing

In DR/failover, worker fencing is critical.

Bad:

```text
Region A workers still running
Region B workers started
Both can call external systems
```

Potential result:

- duplicate payment;
- duplicate notification;
- duplicate enforcement action;
- inconsistent external records.

Use fencing:

1. region lease in control table;
2. worker startup checks active region;
3. external API idempotency keys include region/operation identity;
4. old region workers are stopped or blocked by network policy;
5. failover event is audited;
6. reconciliation runs after failover.

Example active region lease:

```sql
create table orchestration_region_lease (
    system_name varchar(100) primary key,
    active_region varchar(100) not null,
    lease_version bigint not null,
    updated_at timestamp not null,
    updated_by varchar(100) not null
);
```

Worker guard:

```java
RegionLease lease = leaseRepository.get("aceas-camunda");
if (!lease.activeRegion().equals(localRegion)) {
    throw new IllegalStateException("Worker is not allowed in passive region");
}
```

---

## 29. Tenant-Aware Backup and Restore

Backup strategy depends on isolation model.

Shared cluster + shared secondary storage:

- restore is usually cluster-wide;
- per-tenant restore is difficult;
- accidental deletion for one tenant may require custom recovery;
- audit export per tenant becomes important.

Dedicated cluster per tenant:

- restore tenant independently;
- higher cost;
- cleaner DR story.

Question to ask during design:

> “If tenant A asks us to restore their workflow state to yesterday, can we do it without affecting tenant B?”

If answer must be yes, shared multi-tenancy may not be enough.

---

## 30. Regulatory / Government Workflow Implications

For regulatory systems, multi-tenancy and region strategy must support defensibility.

You need to prove:

1. which tenant owned the case;
2. which process version was active;
3. which worker executed which decision;
4. which region processed the operation;
5. which user completed the task;
6. which data was visible to that user;
7. which external system credential was used;
8. which incident occurred and who resolved it;
9. whether SLA clock was paused/extended;
10. whether failover occurred during the case lifecycle.

This is why tenant/environment/region must be first-class in logs, audit records, data models, and support tools.

---

## 31. Anti-Patterns

### 31.1 Tenant as Environment

Using tenant IDs like `dev`, `uat`, `prod` inside one cluster.

Fatal in production governance.

---

### 31.2 One Giant Shared Worker

One worker deployment handles every domain, tenant, and criticality.

Symptoms:

- hard to scale;
- hard to release;
- high blast radius;
- noisy neighbor;
- poor ownership.

---

### 31.3 Tenant Hidden in Variables Only

Relying on a variable called `tenantId` without platform/authorization enforcement.

Risk:

- malicious/wrong message can set wrong tenant;
- worker trusts payload too much;
- cross-tenant data access.

---

### 31.4 Default Tenant Fallback

```java
String tenant = jobTenant != null ? jobTenant : "default";
```

In production, missing tenant should usually fail fast unless `<default>` is explicitly part of design.

---

### 31.5 Shared Secret Across Tenants

One credential for all tenants.

This kills auditability and separation of duties.

---

### 31.6 Active-Active Without Idempotency

Running workers in multiple regions without external side-effect fencing.

This is not high availability. This is duplicate execution risk.

---

### 31.7 Cross-Tenant Analytics Without Governance

Optimize/custom dashboards that expose tenant comparison to unauthorized users.

Analytics is also data access.

---

## 32. Design Review Checklist

Use this checklist before approving enterprise Camunda 8 topology.

### Tenant

- [ ] Is tenant boundary clearly defined?
- [ ] Is tenant ID present in process deployment, job execution, audit, and data access?
- [ ] Are tenant-specific credentials separated?
- [ ] Are tenant-specific external endpoints explicit?
- [ ] Is cross-tenant reporting governed?

### Environment

- [ ] Are dev/sit/uat/prod clusters physically/logically separate?
- [ ] Can lower environment worker ever connect to prod?
- [ ] Are secrets environment-scoped?
- [ ] Are external endpoints environment-scoped?
- [ ] Is deployment promotion reproducible?

### Worker

- [ ] Is worker tenant-aware?
- [ ] Is idempotency tenant-scoped?
- [ ] Is tenant guard enforced before side effects?
- [ ] Are logs/metrics/traces tagged with tenant/environment/region?
- [ ] Is worker deployment isolation aligned with criticality?

### Region

- [ ] Is region strategy active-passive, active-active, or tenant-affinity?
- [ ] Is failover process documented?
- [ ] Are workers fenced by active region?
- [ ] Are external side effects idempotent across failover?
- [ ] Is RPO/RTO tested?

### Operations

- [ ] Can incidents be scoped by tenant?
- [ ] Can capacity be attributed by tenant/domain?
- [ ] Are dashboards tenant-aware?
- [ ] Are alerts tenant/domain/criticality-aware?
- [ ] Is backup/restore implication understood?

---

## 33. Practical Reference Topology

For many enterprise systems, a good starting point:

```text
PROD Account / Project
├── Region A
│   ├── Camunda Prod Cluster
│   │   ├── tenant agency-a
│   │   ├── tenant agency-b
│   │   └── tenant agency-c
│   ├── worker-licensing
│   ├── worker-enforcement
│   ├── worker-appeal
│   ├── domain databases
│   ├── secret manager
│   └── observability stack
│
└── Region B
    ├── Camunda DR Cluster / dual-region setup depending on design
    ├── passive or controlled workers
    ├── replicated/restored data
    └── DR observability
```

Non-prod:

```text
DEV Cluster
SIT Cluster
UAT Cluster
PREPROD Cluster
```

With same tenant naming, but isolated runtime:

```text
agency-a exists in DEV, SIT, UAT, PROD
but DEV agency-a is not PROD agency-a
```

---

## 34. Heuristics for Staff+ Engineers

1. **Environment is a hard boundary; tenant is a logical boundary.**
2. **Do not use multi-tenancy to save cost if compliance requires physical isolation.**
3. **Worker isolation matters as much as engine isolation.**
4. **Tenant ID must participate in idempotency, audit, metrics, traces, and data access.**
5. **Multi-region without fencing creates duplicate side effects.**
6. **Projection/read model isolation is still data isolation.**
7. **No default tenant in production unless explicitly designed.**
8. **Release bundle must include BPMN, worker, schema, authorization, and config changes.**
9. **Fairness is not automatic in shared worker capacity.**
10. **The right isolation model is the cheapest one that still satisfies blast-radius, compliance, and operability requirements.**

---

## 35. Mini Case Study: Regulatory Platform Serving Multiple Agencies

Scenario:

- one platform serves multiple agencies;
- each agency has similar licensing process;
- enforcement process differs by agency;
- all agencies are within same legal jurisdiction;
- production SLA is high;
- agency data must not be visible to other agencies;
- shared platform team operates Camunda.

Recommended approach:

1. Separate clusters per environment.
2. In prod, use multi-tenancy for agencies if compliance accepts logical isolation.
3. Use shared BPMN for common licensing lifecycle.
4. Use tenant-aware rules service for agency-specific thresholds.
5. Use dedicated enforcement worker deployment because enforcement is high-risk.
6. Use tenant-scoped idempotency and audit ledger.
7. Use tenant-scoped secrets for external systems.
8. Use dashboards by tenant/domain.
9. Use active-passive DR or formally supported dual-region design only after worker fencing and reconciliation are tested.
10. Consider dedicated cluster for any agency with strict isolation or special SLA.

Bad approach:

- one cluster for all environments;
- agency encoded only in variable;
- global worker credential;
- shared worker for all criticality;
- no tenant-level metrics;
- manual failover without worker fencing.

---

## 36. What You Should Be Able to Explain Now

You should be able to explain:

1. Why tenant, environment, cluster, namespace, and region are different concepts.
2. Why multi-tenancy is logical isolation, not magic physical isolation.
3. Why a lower environment must not be modelled as a tenant inside production runtime.
4. Why Java workers must be tenant-aware at the boundary, not only inside domain logic.
5. Why idempotency keys must include tenant/environment.
6. Why multi-region failover requires worker fencing.
7. Why shared worker deployments can create fairness and noisy-neighbor problems.
8. Why backup/restore requirements can force dedicated clusters.
9. Why analytics and observability are also part of isolation design.
10. How to decide between shared multi-tenant cluster, dedicated tenant cluster, and domain/criticality-based cluster.

---

## 37. References

- Camunda 8 documentation — Multi-tenancy concepts.
- Camunda 8 documentation — Configure multi-tenancy with Helm.
- Camunda 8 documentation — Orchestration Cluster authorization.
- Camunda 8 documentation — Self-Managed reference architecture.
- Camunda 8 documentation — Kubernetes reference architecture.
- Camunda 8 documentation — Dual-region concepts and operational procedure.
- Camunda 8 documentation — Self-Managed resource planning.
- Camunda 8 documentation — SaaS clusters and cluster sizing concepts.

---

## 38. Ringkasan

Bagian ini memperluas Camunda 8 dari sekadar workflow engine menjadi enterprise runtime platform. Dalam enterprise, kesalahan terbesar biasanya bukan syntax BPMN, tetapi boundary yang tidak jelas:

- tenant dicampur dengan environment;
- worker tidak tenant-aware;
- secret global;
- failover tanpa fencing;
- shared cluster dipakai untuk compliance boundary yang seharusnya dedicated;
- observability tidak bisa memilah tenant/domain;
- deployment pipeline tidak mengikat BPMN, worker, schema, dan authorization sebagai satu release unit.

Camunda 8 bisa mendukung banyak model isolation, tetapi engineering judgement tetap menentukan apakah desain itu aman. Top-level engineer harus mampu menimbang cost, blast radius, compliance, operability, and release independence, lalu memilih topology yang sesuai.

---

## 39. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-032.md
```

Judul:

```text
Part 032 — Security, Compliance, Audit Trail, PII, and Regulated Workflow Defensibility
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-030.md">⬅️ Part 030 — Case Management and Regulatory Lifecycle Modelling with Camunda 8</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-032.md">Part 032 — Security, Compliance, Audit Trail, PII, and Regulated Workflow Defensibility ➡️</a>
</div>
