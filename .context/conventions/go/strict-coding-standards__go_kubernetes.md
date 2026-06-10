# Strict Coding Standards — Go Kubernetes

> Mandatory standards for LLM/code-agent generated Go applications running on Kubernetes.  
> This document is a merge gate, not a style suggestion.

## 0. Purpose

This standard governs Kubernetes-facing implementation and manifests for Go services, workers, jobs, controllers, and operators.

The goal is to make Go workloads behave correctly under Kubernetes realities:

- Pods are ephemeral.
- Containers receive SIGTERM and a finite graceful termination window.
- Readiness and liveness have different meanings.
- CPU/memory requests and limits affect scheduling, throttling, OOM behavior, and Go runtime behavior.
- ConfigMaps and Secrets are runtime inputs, not application architecture.
- Kubernetes retries, restarts, rolling updates, autoscaling, and network changes are normal events.

## 1. Source authority

When this file conflicts with casual framework examples, follow these sources first:

1. Kubernetes official docs for Pod lifecycle, probes, resources, ConfigMaps, Secrets, security context, workload controllers, Jobs, and Services.
2. Go official runtime behavior, especially container-aware `GOMAXPROCS` in Go 1.25+.
3. `client-go` and `controller-runtime` docs for Kubernetes API clients/controllers.
4. Project-specific platform standards for ingress, service mesh, IAM, secret management, logging, telemetry, and deployment strategy.

## 2. Non-negotiable LLM rules

The agent MUST NOT generate Kubernetes manifests or Go runtime code unless it can answer:

- What happens on SIGTERM?
- How long can graceful shutdown take?
- What is readiness vs liveness?
- Which dependencies affect readiness?
- What are CPU/memory requests and limits based on?
- How are secrets provided and rotated?
- How does the app behave during rolling deploy?
- How does the app avoid duplicate processing after restart?
- How are logs, metrics, and traces collected?
- Is the workload a Deployment, StatefulSet, Job, CronJob, or controller, and why?

If unknown, the agent MUST choose conservative defaults and flag assumptions.

## 3. Workload type selection

The agent MUST choose workload type by runtime semantics.

| Workload            | Use when                                                    | Forbidden misuse                           |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Deployment          | stateless HTTP/gRPC service or horizontally scalable worker | persistent identity/storage/order required |
| StatefulSet         | stable identity or ordered rollout/storage is required      | generic stateless apps                     |
| Job                 | finite task with completion/failure semantics               | long-running service                       |
| CronJob             | scheduled finite tasks                                      | external scheduler already owns trigger    |
| DaemonSet           | node-local agent                                            | ordinary service                           |
| Controller/Operator | reconciles Kubernetes resources                             | simple CRUD app                            |

Rules:

- Do not use Deployment for singleton semantics without leader election, lease, or external coordination.
- Do not use StatefulSet just to get stable network names unless the app actually needs stable identity.
- Do not use CronJob for non-idempotent tasks without concurrency policy and retry semantics.

## 4. Go process shutdown

Every Go Kubernetes service/worker MUST handle `SIGTERM` and `SIGINT`.

Required pattern:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()

// start server/workers
<-ctx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()

if err := srv.Shutdown(shutdownCtx); err != nil {
    logger.Error("server shutdown failed", "error", err)
}
```

Rules:

- Shutdown timeout MUST be less than `terminationGracePeriodSeconds`.
- Readiness MUST fail before or during shutdown so new traffic stops.
- Workers MUST stop fetching new work before draining in-flight work.
- Message consumers MUST ack/commit only after successful processing.
- Background goroutines MUST be joined or canceled.
- Shutdown must be tested.

## 5. Termination grace and preStop

`terminationGracePeriodSeconds` MUST be explicitly set for production workloads.

Example:

```yaml
terminationGracePeriodSeconds: 30
```

Rules:

- Do not rely on Kubernetes default blindly.
- `preStop` may be used only for platform-specific traffic-drain delay or external deregistration.
- `preStop` must fit inside termination grace period.
- Application shutdown must not depend solely on `preStop`; it must handle SIGTERM.

## 6. Probes

Every long-running service MUST define readiness and liveness probes. Startup probe SHOULD be used for slow-starting services.

### 6.1 Liveness

Liveness answers: "Should Kubernetes restart this container?"

Rules:

- Liveness MUST be shallow.
- Liveness MUST NOT fail because a downstream database/API is temporarily unavailable.
- Liveness SHOULD verify process event loop / internal fatal state only.

Example:

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: http
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

### 6.2 Readiness

Readiness answers: "Should this Pod receive traffic now?"

Rules:

- Readiness MUST fail during startup until app is ready.
- Readiness MUST fail during graceful shutdown.
- Readiness MAY check critical local dependencies such as config loaded, DB connection initialized, migration compatibility, or queue subscription ready.
- Readiness MUST NOT perform expensive queries or broad dependency health checks on every probe.

Example:

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: http
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
```

### 6.3 Startup

Startup probe SHOULD be used when initialization can exceed normal liveness thresholds.

```yaml
startupProbe:
  httpGet:
    path: /startupz
    port: http
  periodSeconds: 5
  failureThreshold: 24
```

Forbidden:

- using liveness as readiness;
- liveness that checks database availability;
- probes with no timeout;
- probe endpoint that logs at error level on normal not-ready state;
- probe endpoint that allocates heavily.

## 7. Resource requests and limits for Go

Every production container MUST declare CPU and memory requests. Limits MUST follow platform policy and workload behavior.

Example:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

Rules:

- Requests are scheduling signals; limits are enforcement signals.
- Memory limit must include Go heap, stacks, native memory, mmap, TLS buffers, file buffers, sidecar overhead if same Pod, and telemetry overhead.
- CPU limits can cause throttling and tail latency impact.
- For Go 1.25+, `GOMAXPROCS` uses CPU limit by default when present; it does not use CPU request.
- Do not set `GOMAXPROCS` manually unless measured and documented.
- Use realistic load tests under the same request/limit shape as production.

If no CPU limit is used, the agent MUST consider whether high `GOMAXPROCS` can harm latency under node contention.

## 8. Go memory and Kubernetes OOM behavior

Rules:

- Go memory limit environment (`GOMEMLIMIT`) MAY be used for services with strict memory budgets, but must leave headroom below container memory limit.
- Do not set `GOMEMLIMIT` equal to Kubernetes memory limit.
- The app MUST avoid unbounded `io.ReadAll`, unbounded JSON decode, unbounded queues, unbounded caches, and unbounded goroutine creation.
- Memory leaks must be investigated using pprof/heap profiles.
- OOMKilled restarts must be treated as correctness incidents, not normal autoscaling behavior.

Example:

```yaml
env:
  - name: GOMEMLIMIT
    value: "200MiB"
```

only if container memory limit is higher and the value is tested.

## 9. Security context

Production Pods/containers MUST use restrictive security context unless exception is documented.

Baseline:

```yaml
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
```

Rules:

- Container image must support non-root execution.
- Root filesystem should be read-only; writable directories must use `emptyDir` or mounted volume.
- Privileged containers are forbidden for normal Go services.
- Host networking, host PID, host IPC, and hostPath volumes require security review.
- Linux capabilities must be dropped by default.

## 10. ConfigMap and Secret rules

### 10.1 ConfigMap

ConfigMaps are for non-sensitive environment-specific config.

Rules:

- Config must be validated at startup.
- Missing required config must fail fast.
- Config schema/version must be documented.
- Large config blobs should not be hidden in ConfigMaps without ownership and reload semantics.

### 10.2 Secret

Kubernetes Secrets are sensitive runtime inputs, but not a complete secret-management strategy.

Rules:

- Secrets MUST NOT be logged.
- Secrets SHOULD be mounted as files where rotation is required.
- Env var secrets are acceptable only when rotation and process lifetime make that safe.
- The app MUST handle secret reload only if designed and tested.
- ServiceAccount tokens MUST use least privilege.

Forbidden:

```yaml
env:
  - name: DATABASE_URL
    value: "postgres://user:password@host/db"
```

## 11. Environment variable contract

Every env var used by Go code MUST have:

- name;
- type;
- required/optional status;
- default if any;
- validation rule;
- secret/non-secret classification;
- reload behavior.

The agent MUST NOT add magic env vars that are undocumented.

## 12. Service and networking

Rules:

- Go HTTP/gRPC servers must bind to `0.0.0.0` or configurable address inside the Pod.
- Container ports must use names (`http`, `grpc`, `metrics`) where probes/services reference them.
- Services must expose only required ports.
- Admin/debug ports must not be publicly exposed.
- Ingress timeouts must align with Go server timeouts and context deadlines.
- Client code must handle DNS changes, connection resets, and retries safely.

Example:

```yaml
ports:
  - name: http
    containerPort: 8080
  - name: metrics
    containerPort: 9090
```

## 13. HTTP/gRPC server timeout rules

Go servers in Kubernetes MUST configure timeouts explicitly.

HTTP baseline:

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           handler,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       15 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
}
```

Rules:

- No default `http.ListenAndServe` in production code.
- Deadline propagation must use `context.Context`.
- Request body size limits must be enforced.
- Long-running requests must have explicit policy.

## 14. Deployment rolling update rules

Deployment strategy MUST avoid traffic loss and duplicate unsafe work.

Example:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Rules:

- Readiness must become true only when the instance is ready.
- Readiness must become false on shutdown.
- Database migrations must be backward/forward compatible with old and new versions during rollout.
- Event consumers must be idempotent because restarts and duplicate delivery are normal.
- The agent MUST NOT introduce breaking wire contract changes without deployment plan.

## 15. Horizontal Pod Autoscaler compatibility

If HPA is used:

- Resource requests MUST be meaningful.
- App metrics MUST have stable cardinality.
- Scale-out must not violate ordering, singleton, lease, or rate-limit invariants.
- Workers must coordinate partition ownership or queue concurrency safely.
- Downstream dependencies must tolerate scaled concurrency.

The agent MUST not assume that adding replicas is safe for every Go workload.

## 16. PodDisruptionBudget and availability

For critical services with multiple replicas, define PodDisruptionBudget according to SLO.

Example:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: app
```

Rules:

- PDB does not protect against all failures; it controls voluntary disruptions.
- Single-replica services must document why downtime is acceptable or how failover is handled.

## 17. Jobs and CronJobs

Go Jobs MUST be idempotent or have external deduplication.

Rules:

- Set `backoffLimit` intentionally.
- Set `activeDeadlineSeconds` for bounded execution where appropriate.
- Set `concurrencyPolicy` for CronJobs.
- Use explicit exit codes.
- Checkpoint long-running work where possible.
- Do not rely on in-memory state across restarts.

Example:

```yaml
concurrencyPolicy: Forbid
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 3
```

## 18. Workers and message consumers

Rules:

- Readiness should indicate whether the worker can consume work, where relevant.
- On SIGTERM, stop polling first, drain in-flight work second, then exit.
- Ack/commit only after durable success.
- Use idempotency keys for side effects.
- Use bounded concurrency; do not spawn unbounded goroutines per message.
- DLQ and retry semantics must be explicit.

## 19. Kubernetes API clients in Go

For applications using Kubernetes API:

- Use `client-go` or `controller-runtime` intentionally.
- Use in-cluster config in cluster and kubeconfig only for local/dev tools.
- Use context deadlines for API calls.
- Do not log full objects if they may contain secrets.
- Use informers/caches/controllers instead of polling when watching resources.
- Use leader election for active-active controllers with singleton side effects.
- Leader election must not be treated as a fencing guarantee unless backed by stronger coordination.

## 20. Controller/operator rules

Go controllers MUST be reconciliation-based.

Rules:

- Reconcile must be idempotent.
- Desired state must be derived from Kubernetes object state and external state.
- Status updates must be separated from spec changes.
- Finalizers must be used only when cleanup is required and must be robust to retries.
- Requeue/backoff must be bounded.
- RBAC must be least privilege.
- Tests must cover create/update/delete/finalizer/error paths.

Forbidden:

- controller logic depending on single event delivery;
- long blocking work inside reconcile without context/deadline;
- storing authoritative state only in controller memory.

## 21. RBAC and service accounts

Every workload that calls Kubernetes API MUST use a dedicated ServiceAccount.

Rules:

- Default ServiceAccount is forbidden for production workloads unless explicitly approved.
- RBAC must be least privilege.
- ClusterRole requires stronger justification than Role.
- `list/watch` permissions should be limited to required resources/namespaces.
- Secret access requires explicit security review.

## 22. Volumes and filesystem

Rules:

- Use `emptyDir` for ephemeral writable space.
- Use PVC only when durable state is required and recovery semantics are documented.
- `hostPath` is forbidden unless platform/security exception exists.
- App must handle read-only root filesystem.
- File writes must be atomic where config/output correctness matters.
- Temporary files must be bounded and cleaned up.

Example:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

## 23. Observability

Every Go Kubernetes workload MUST expose sufficient telemetry:

- structured logs to stdout/stderr;
- request/worker metrics;
- runtime metrics;
- health/readiness endpoints;
- trace propagation where distributed tracing is enabled;
- build/version info;
- graceful shutdown logs;
- dependency failure metrics.

Rules:

- Metrics labels must have bounded cardinality.
- Logs must include correlation/request IDs where available.
- Secrets and tokens must be redacted.
- `/metrics` must not be exposed externally unless intentionally protected.

## 24. pprof/debug endpoints

Rules:

- `net/http/pprof` MUST NOT be exposed on public ingress.
- Debug endpoints must be bound to internal/admin port or protected by network policy/auth.
- Production enablement of pprof must follow project policy.
- pprof sampling/collection must not leak sensitive data.

## 25. Network policy

If cluster uses NetworkPolicy, manifests SHOULD define explicit ingress/egress policy.

Rules:

- Default allow assumptions are not portable.
- Egress to databases, queues, cloud APIs, and DNS must be explicit.
- Metrics scraping ingress must be explicit.
- Admin/debug ports should be denied by default.

## 26. Init containers and migrations

Init containers MAY be used for dependency checks or setup, but must not become hidden application logic.

Rules:

- Database migrations should be controlled by release/migration process, not casually embedded in every Pod startup.
- If migrations are run in Kubernetes, use a Job with locking and rollback plan.
- Init containers must have bounded timeout.
- App must still fail fast if required schema/config is incompatible.

## 27. Sidecars

Rules:

- Sidecar presence must be documented in resource budgets and shutdown behavior.
- App should not assume sidecar starts first unless startup/readiness handles it.
- Service mesh timeouts/retries must align with app retry/deadline policy.
- Duplicate retries across app, mesh, and client must be avoided.

## 28. Image pull and registry

Rules:

- Production manifests MUST use immutable tags or digests.
- `imagePullPolicy: Always` with mutable tags is not a release strategy.
- Private registry credentials must use Kubernetes image pull secrets or platform identity.
- Rollback image must be known.

Preferred:

```yaml
image: registry.example.com/team/app:1.4.2-abcdef0
```

or digest pinning:

```yaml
image: registry.example.com/team/app@sha256:<digest>
```

## 29. Labels and annotations

All manifests MUST use consistent labels.

Required baseline:

```yaml
labels:
  app.kubernetes.io/name: app
  app.kubernetes.io/instance: app-prod
  app.kubernetes.io/version: "1.4.2"
  app.kubernetes.io/component: api
  app.kubernetes.io/part-of: platform
  app.kubernetes.io/managed-by: gitops
```

Rules:

- Selectors must be stable and not include changing version labels.
- Annotations for scraping, rollout, config checksum, or sidecar behavior must be documented.

## 30. Manifest generation and GitOps

Rules:

- Raw YAML, Helm, Kustomize, Jsonnet, or operator manifests must follow the same runtime rules.
- Generated manifests must be reviewable.
- Environment overlays must not drift in critical security/runtime defaults.
- Config changes must produce rollout only when intended.
- Secret material must not be committed to Git.

## 31. Testing Kubernetes behavior

Required test coverage:

- unit tests for config parsing and validation;
- signal/shutdown test;
- readiness/liveness handler test;
- resource-bound load test for critical services;
- manifest validation via `kubectl --dry-run=server`, kubeconform, conftest, or platform policy tool;
- integration test for message consumers/jobs where restart can duplicate work;
- controller envtest/integration tests for operators.

## 32. Forbidden anti-patterns

The agent MUST NOT introduce:

```yaml
resources: {}
```

for production workloads.

```yaml
securityContext:
  privileged: true
```

without security exception.

```yaml
livenessProbe:
  httpGet:
    path: /readyz
```

because readiness and liveness are different contracts.

Other forbidden patterns:

- no SIGTERM handling;
- app depends on local disk persistence in Deployment;
- root container with writable root filesystem;
- broad ClusterRole for normal app;
- secret values committed in manifest;
- unbounded worker concurrency tied to replicas;
- relying on Pod IP stability;
- using memory cache as authoritative state;
- liveness probe checking database;
- rolling deployment with schema-breaking migration;
- exposing pprof publicly;
- assuming exactly-once execution for Jobs or consumers.

## 33. Required review checklist

A Go Kubernetes change is mergeable only if:

- [ ] Workload kind matches runtime semantics.
- [ ] Container image is immutable-tagged or digest-pinned for production.
- [ ] App handles SIGTERM/SIGINT and drains safely.
- [ ] `terminationGracePeriodSeconds` is explicit and aligned with shutdown timeout.
- [ ] Readiness, liveness, and startup probes are semantically correct.
- [ ] CPU/memory requests are set; limits policy is explicit.
- [ ] Go `GOMAXPROCS`/`GOMEMLIMIT` behavior is understood under resource constraints.
- [ ] Security context uses non-root, no privilege escalation, dropped capabilities, and read-only root filesystem where possible.
- [ ] ConfigMaps and Secrets have clear schema and validation.
- [ ] Secrets are not logged or committed.
- [ ] ServiceAccount/RBAC is least privilege.
- [ ] Admin/debug endpoints are not externally exposed.
- [ ] Logs/metrics/traces are available and low-cardinality.
- [ ] Rolling update is safe for database/schema/event compatibility.
- [ ] Workers/jobs are idempotent and restart-safe.
- [ ] Manifest validation/policy checks are part of CI.

## 34. LLM final response requirement

When the agent creates or modifies Kubernetes support for a Go project, it MUST summarize:

- workload kind and why;
- image reference strategy;
- port/probe design;
- resource requests/limits;
- security context;
- config/secret source;
- shutdown behavior;
- deployment/rollback risk;
- commands/tests that should be run.
