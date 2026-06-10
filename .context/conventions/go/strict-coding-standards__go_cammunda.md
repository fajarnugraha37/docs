# Strict Coding Standards — Go Camunda / Zeebe

Status: Mandatory  
Scope: Go services interacting with Camunda 8, Zeebe, BPMN workflows, job workers, process instance commands, process variables, and workflow orchestration APIs.  
Audience: LLM code agents, developers, reviewers, workflow engineers, platform engineers, and maintainers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.  
Filename note: the requested filename uses `cammunda`; the correct product name in this document is **Camunda**.

---

## 1. Purpose

Camunda/Zeebe integration code is not ordinary RPC glue. It is workflow orchestration code. A small implementation error can duplicate work, complete the wrong job, leak variables, break auditability, retry unsafe side effects, or move a regulated process into an invalid state.

An LLM MUST treat Camunda code as a distributed workflow boundary with explicit process semantics, not as a generic background-job wrapper.

This standard governs:

- Camunda 8 / Zeebe client usage from Go.
- REST/gRPC command invocation.
- Process deployment, process instance creation, correlation, and variable mapping.
- Job worker lifecycle, completion, failure, retry, and incident behavior.
- BPMN process contract handling from Go code.
- Idempotency, timeout, cancellation, telemetry, and audit behavior.
- Migration posture for Camunda client changes.

---

## 2. Source authority

When this document conflicts with project-specific workflow architecture docs, the project docs win only if they are stricter.

Primary references:

- Camunda blog: Go client and `zbctl` deprecation from Camunda 8.6 onward.
- Camunda 8 Go client documentation for Zeebe client bootstrapping and job workers.
- Camunda 8 docs for Zeebe architecture, clients, gateways, brokers, partitions, and process lifecycles.
- Go standards in this repository for context, gRPC, HTTP, telemetry, error handling, validation, data mapping, authentication, authorization, and security.

Important external-state rule:

- For Camunda 8.6+, the historical Go client must be considered community-maintained unless the project has explicitly pinned and approved its version.
- LLMs MUST NOT assume the Go client has the same support level as Java/REST clients in newer Camunda versions.
- For new code, LLMs MUST first check the project architecture decision: supported REST API, gRPC/Zeebe API, Java-side orchestration bridge, or pinned Go client.

---

## 3. Non-negotiable rules

1. MUST NOT use Camunda as a generic queue when the workflow state, retry, escalation, or audit model is not defined.
2. MUST NOT start, complete, fail, or throw BPMN errors without a typed application command and explicit authorization boundary.
3. MUST NOT pass raw `map[string]any` variables across the application boundary without typed DTO/domain mapping.
4. MUST NOT log full process variables, job variables, headers, bearer tokens, client secrets, business identifiers classified as sensitive, or external payloads.
5. MUST NOT use `context.Background()` inside handlers except in bootstrap code; request/job operations must use a bounded context.
6. MUST NOT panic from a job handler for expected business, validation, dependency, or retryable failures.
7. MUST NOT complete a job before all side effects that must be atomic with the workflow transition are safely committed or made idempotent.
8. MUST NOT retry non-idempotent external calls unless an idempotency key, deduplication record, or compensating model exists.
9. MUST NOT use `LatestVersion()` in production process instance creation unless the release policy explicitly permits moving traffic to the latest deployed process definition.
10. MUST NOT hardcode gateway address, client ID, secret, auth URL, tenant, process ID, or job type outside configuration.
11. MUST NOT deploy BPMN resources from ordinary application runtime unless deployment is explicitly part of a controlled CI/CD or admin operation.
12. MUST NOT use the historical Go client in a multi-tenant Camunda setup unless the approved client/version explicitly supports the required tenancy model.
13. MUST preserve workflow auditability: actor, command, process definition, process instance key, business key/correlation key, state transition, reason, and outcome must be observable.

---

## 4. Client selection and support posture

### 4.1 Mandatory decision record

Before implementing Camunda code, the LLM MUST identify or create a project decision for:

- Camunda version.
- API surface: REST, Zeebe gRPC, historical Go client, custom generated client, or gateway service.
- Authentication method.
- Tenant model.
- Process deployment ownership.
- Worker ownership per job type.
- Retry and incident policy.
- Required telemetry and audit fields.

If no decision exists, the LLM MUST implement a narrow adapter interface and keep the client-specific code isolated.

### 4.2 Adapter boundary

Camunda client calls MUST be hidden behind an infrastructure adapter. Application code MUST depend on domain-oriented ports, not directly on Zeebe/Camunda SDK types.

Preferred:

```go
type WorkflowEngine interface {
    StartEnforcementCase(ctx context.Context, cmd StartEnforcementCaseCommand) (ProcessRef, error)
    PublishInspectionCompleted(ctx context.Context, cmd InspectionCompletedCommand) error
}
```

Forbidden in application/domain layer:

```go
func (s *Service) Start(ctx context.Context, client zbc.Client, vars map[string]any) error
```

Reason:

- Camunda SDK types are transport/infrastructure concerns.
- Process variable contracts must be controlled.
- Client support status may change.
- Tests should not require a live Camunda cluster for business behavior.

---

## 5. Configuration and secrets

All Camunda config MUST be explicit and validated at startup.

Required config fields, depending on API surface:

- Gateway/base URL.
- OAuth authorization server URL.
- Client ID.
- Client secret reference, not raw secret in config dump.
- TLS mode.
- Tenant/organization/cluster identity where applicable.
- Default command timeout.
- Worker max active jobs / concurrency.
- Worker poll timeout.
- Job timeout.
- Retry policy.
- Process ID allowlist.
- Job type allowlist.

Forbidden:

```go
GatewayAddress: os.Getenv("ZEEBE_ADDRESS") // without validation
```

Required:

```go
type CamundaConfig struct {
    GatewayAddress string
    OAuthURL       string
    ClientID       string
    ClientSecret   SecretRef
    CommandTimeout time.Duration
    JobTimeout     time.Duration
    MaxActiveJobs  int
}

func (c CamundaConfig) Validate() error {
    // validate required fields, URL syntax, sane timeouts, positive concurrency
    return nil
}
```

Secrets MUST be loaded through the approved secret provider. Environment variables may reference secret locations, but raw secrets MUST NOT be printed, logged, or exposed via health endpoints.

---

## 6. Context, timeout, and cancellation

Every command sent to Camunda MUST use context with a bounded deadline.

Required:

```go
ctx, cancel := context.WithTimeout(parent, cfg.CommandTimeout)
defer cancel()

res, err := adapter.client.NewTopologyCommand().Send(ctx)
```

Forbidden:

```go
res, err := client.NewTopologyCommand().Send(context.Background())
```

Inside job handlers:

- The worker-provided lifecycle must be respected.
- External calls must use sub-timeouts smaller than the job timeout.
- Cancellation must stop work before side effects where possible.
- Long-running work must checkpoint or delegate to an idempotent async operation.

The LLM MUST NOT create unbounded goroutines from a job handler.

---

## 7. Process ID, business key, and correlation

A process instance MUST be started using an explicit process contract.

Required fields:

- BPMN process ID.
- Versioning policy: exact version, version tag, migration policy, or controlled latest.
- Business key/correlation key, if used by the domain.
- Idempotency key for repeated start commands.
- Actor/system identity.
- Initial variables DTO version.

Forbidden:

```go
client.NewCreateInstanceCommand().BPMNProcessId("case-process").LatestVersion()
```

unless the project has explicitly approved latest-version routing.

Preferred:

```go
type StartCaseWorkflowCommand struct {
    CaseID         CaseID
    InitiatedBy    ActorID
    ProcessVersion int32
    IdempotencyKey string
    Variables      StartCaseVariables
}
```

Process IDs and message names MUST be constants in a workflow contract package, not scattered strings.

---

## 8. Variable mapping rules

Process variables are wire contracts. They MUST be mapped through typed structs and validated.

Required:

```go
type StartCaseVariables struct {
    CaseID      string    `json:"caseId"`
    CaseType    string    `json:"caseType"`
    SubmittedAt time.Time `json:"submittedAt"`
    ActorID     string    `json:"actorId"`
    SchemaVer   int       `json:"schemaVersion"`
}
```

Forbidden:

```go
vars := map[string]any{
    "caseId": case.ID,
    "x": payload,
}
```

except inside the infrastructure adapter after typed validation and serialization.

Rules:

- Variables MUST have a schema/version field for long-lived processes.
- Variable names MUST be stable and documented.
- Optional fields MUST distinguish absent, null, and zero where the workflow depends on that distinction.
- Time values MUST use explicit UTC or approved timezone policy.
- Decimal/money values MUST NOT use `float64` unless the workflow explicitly accepts approximate numeric values.
- Large documents MUST NOT be embedded in variables; store externally and pass references.
- PII/secrets MUST NOT be stored as variables unless approved and protected.

---

## 9. Job worker implementation

A job worker MUST be a controlled runtime component with explicit lifecycle.

Required worker design:

- Worker has a typed handler per job type.
- Handler validates custom headers and variables.
- Handler uses idempotency before external side effects.
- Handler maps known business failures to BPMN error or job failure according to process contract.
- Handler maps retryable dependency failures to job failure with retry decrement.
- Handler maps permanent technical faults to incident or DLQ-equivalent operational path.
- Worker exposes telemetry and health state.
- Worker supports graceful shutdown.

Forbidden:

```go
func handleJob(client worker.JobClient, job entities.Job) {
    vars, _ := job.GetVariablesAsMap()
    callExternalSystem(vars)
    client.NewCompleteJobCommand().JobKey(job.GetKey()).Send(context.Background())
}
```

Required shape:

```go
func (h *PaymentWorker) Handle(ctx context.Context, job PaymentJob) error {
    if err := job.Validate(); err != nil {
        return NewNonRetryableJobError("invalid_job", err)
    }

    result, err := h.service.ProcessPayment(ctx, PaymentCommand{
        CaseID:         job.CaseID,
        AmountMinor:    job.AmountMinor,
        IdempotencyKey: job.JobKey,
    })
    if err != nil {
        return classifyPaymentError(err)
    }

    return h.workflow.CompletePayment(ctx, job.Ref, result)
}
```

---

## 10. Complete, fail, BPMN error, and incident policy

The LLM MUST choose the outcome intentionally.

Use **complete job** only when:

- Business work is done.
- Required side effects are committed or safely idempotent.
- Result variables are validated.
- Audit event is persisted/emitted if required.

Use **fail job** when:

- Technical or dependency failure may succeed later.
- Retrying the same job is safe.
- Retry count and backoff align with process SLA.

Use **BPMN error** when:

- The process model expects a named business error.
- The error is not a technical outage.
- The error should move the BPMN flow along an alternative path.

Create or allow **incident** when:

- Manual intervention is required.
- Data is invalid in a way the process cannot handle.
- Retry would be unsafe or meaningless.

Forbidden:

- Completing job after partial failure.
- Failing job forever without incident visibility.
- Mapping every Go error to BPMN error.
- Mapping every business rejection to technical failure.

---

## 11. Idempotency and side effects

Every job handler that performs side effects MUST be idempotent.

Required idempotency keys may include:

- Job key.
- Process instance key.
- Business key.
- Activity ID.
- External command ID.
- Domain operation ID.

For external API calls:

- Pass idempotency key if supported.
- Persist outbound request state if necessary.
- Record response before job completion if workflow correctness depends on it.
- Never rely only on Camunda retry count for exactly-once behavior.

For database writes:

- Use unique constraint or idempotency table.
- Use transaction boundary around domain update and outbox/audit record.
- Complete the job only after durable commit.

---

## 12. Deployment and process versioning

BPMN deployment MUST be controlled.

Allowed:

- CI/CD deployment step with checksum and version record.
- Admin tool with authorization and audit.
- Test bootstrap for integration tests.

Forbidden:

- Application start-up blindly deploying BPMN every time.
- Worker service deploying process models it does not own.
- Runtime deployment from user-provided BPMN/XML.

Versioning rules:

- Process changes MUST describe migration impact for running instances.
- Variables added/removed MUST be backward compatible or migration-backed.
- Job type changes MUST be coordinated with worker release.
- Message names and correlation keys MUST be stable.

---

## 13. Authentication, authorization, and tenancy

Camunda credentials MUST follow the project authentication standard.

Rules:

- OAuth credentials MUST be loaded from secret management.
- Tokens MUST NOT be logged.
- Plaintext connection is forbidden outside local tests.
- TLS verification MUST NOT be disabled in shared environments.
- Multi-tenancy assumptions MUST be explicit.
- Application authorization MUST happen before starting process instances, publishing messages, cancelling instances, or completing user-driven workflow tasks.

If using a client or API surface that does not support required tenancy, the LLM MUST refuse the implementation path and propose an approved alternative.

---

## 14. Observability and audit

Every Camunda adapter and worker MUST emit structured telemetry.

Required log fields:

- `workflow.engine`: `camunda` or `zeebe`.
- `workflow.operation`: `start_instance`, `complete_job`, `fail_job`, `throw_bpmn_error`, `publish_message`, `deploy_resource`.
- `bpmn.process_id`.
- `bpmn.process_version` where available.
- `camunda.process_instance_key` where available.
- `camunda.job_key` where available.
- `camunda.job_type` where available.
- `business.key` or approved redacted form.
- `actor.id` or system actor.
- `outcome`.
- `error.kind` and `retryable` on failure.

Metrics:

- Commands sent by operation/outcome.
- Job activation count.
- Job completion/failure/BPMN error count.
- Handler duration.
- Retry exhaustion count.
- Incident creation or incident-like failure count.
- In-flight jobs.
- Worker shutdown duration.

Trace spans:

- Start around adapter calls and job handling.
- Propagate correlation IDs through variables/headers only if approved and non-sensitive.

---

## 15. Testing requirements

Required tests:

- Variable mapping unit tests.
- Invalid variable/header tests.
- Business failure to BPMN error mapping tests.
- Retryable dependency failure to job failure tests.
- Idempotency duplicate job tests.
- Context timeout/cancellation tests.
- Worker graceful shutdown test.
- No secret/PII logging test where feasible.
- Integration test against approved local/test Camunda stack or mocked adapter contract.

Golden tests are recommended for variable JSON contracts and BPMN deployment manifests.

The LLM MUST NOT claim workflow correctness from unit tests that only mock successful client calls.

---

## 16. Anti-patterns

Forbidden patterns:

- `map[string]any` variables across layers.
- One generic worker handling all job types with switch logic and no typed contract.
- Panic in worker handler.
- `context.Background()` in command execution.
- `LatestVersion()` without rollout decision.
- Business data embedded in job type names.
- Worker completion before durable side effect commit.
- Non-idempotent retries.
- Secrets in variables.
- BPMN deployment on app boot.
- Direct SDK use in domain/application service.
- Using Camunda incidents as normal validation flow.

---

## 17. Review checklist

Before merge, the LLM MUST verify:

- [ ] Camunda version/API/client support posture is documented.
- [ ] No unsupported Go client assumptions exist.
- [ ] Client code is isolated behind an adapter.
- [ ] Context deadlines are bounded.
- [ ] Process IDs, job types, and message names are constants/contracts.
- [ ] Variables are typed, versioned, validated, and mapped.
- [ ] Job handlers are idempotent.
- [ ] Completion/failure/BPMN error/incident behavior is intentional.
- [ ] Runtime deployment is not performed unless explicitly approved.
- [ ] Secrets and variables are not logged.
- [ ] Telemetry includes workflow identifiers and outcome.
- [ ] Tests cover duplicate jobs, failure mapping, cancellation, and invalid variables.
