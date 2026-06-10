# Strict Coding Standards — Java Kubernetes

> **Purpose**: This document defines strict, enforceable standards for deploying and operating Java applications on Kubernetes.
>
> It is not a Kubernetes tutorial. It is a guardrail for LLM code agents, platform reviewers, service owners, and CI/CD pipelines.

---

## 1. Scope

This standard applies to Java workloads deployed on Kubernetes, including:

- HTTP services.
- gRPC services.
- Event/message consumers.
- Batch jobs and CronJobs.
- Schedulers.
- Admin/internal services.
- Spring Boot, Quarkus, Micronaut, Jakarta EE, JAX-RS, and plain Java services.

This standard covers:

- Workload manifests.
- Resource requests and limits.
- JVM container behavior.
- Probes.
- Rollouts.
- Security context.
- Config and secrets.
- Service/network policy.
- Observability.
- Failure handling.
- Java-specific Kubernetes runtime concerns.

This standard does **not** replace:

- `strict-coding-standards__java_docker.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_network.md`
- `strict-coding-standards__java_concurrency.md`
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__java_grpc.md`

---

## 2. Core Principle

A Java Kubernetes deployment must be:

1. **Predictable** — resources, ports, probes, and rollout behavior are explicit.
2. **Recoverable** — failure modes are handled by Kubernetes and the application cooperatively.
3. **Least privilege** — container, pod, service account, and network access are minimized.
4. **Observable** — logs, metrics, traces, health, and events support diagnosis.
5. **Configurable** — image is environment-agnostic; config/secrets are injected safely.
6. **Graceful** — shutdown, readiness, and lifecycle hooks prevent traffic loss/corruption.
7. **Bounded** — CPU, memory, queues, pools, and downstream calls have limits.

---

## 3. LLM Agent Contract

When an LLM creates or modifies Kubernetes manifests for a Java application, it MUST:

1. Identify workload type: `Deployment`, `StatefulSet`, `Job`, `CronJob`, or other.
2. Identify service protocol: HTTP, gRPC, message consumer, batch, or mixed.
3. Identify Java baseline and JVM memory strategy.
4. Define resource requests and limits or document why platform injects them.
5. Define readiness, liveness, and startup probes where applicable.
6. Define security context.
7. Define service account policy.
8. Define config/secret injection strategy.
9. Define rollout strategy.
10. Define termination/graceful shutdown policy.
11. Avoid cluster-admin assumptions.
12. Avoid privileged/root containers.
13. Avoid unbounded autoscaling claims.
14. Document assumptions and required platform integrations.

The agent MUST NOT generate “happy path only” manifests.

---

## 4. Required Manifest Baseline

For a long-running Java service, the minimum deployment set SHOULD include:

```text
k8s/
  deployment.yaml
  service.yaml
  configmap.yaml              # if required
  secret-ref.yaml             # references only; do not commit secret values
  serviceaccount.yaml         # if non-default permissions are required
  networkpolicy.yaml          # if cluster supports/enforces it
  hpa.yaml                    # if autoscaling is used
  pdb.yaml                    # if availability during disruption matters
```

Manifest generation may be via Helm/Kustomize, but rendered output must satisfy this standard.

---

## 5. Workload Type Selection

### 5.1 Deployment

Use for stateless long-running services.

Required for:

- HTTP API.
- gRPC API.
- Stateless workers that can run multiple replicas.

### 5.2 StatefulSet

Restricted.

Use only when workload needs:

- Stable network identity.
- Stable persistent volume identity.
- Ordered rollout/termination.

Most Java applications should not need StatefulSet.

### 5.3 Job

Use for one-off finite work.

Rules:

- Exit code must represent success/failure.
- Retries must be idempotent or explicitly safe.
- `backoffLimit` must be set.
- Runtime must be bounded by active deadline where appropriate.

### 5.4 CronJob

Use for scheduled finite work.

Rules:

- `concurrencyPolicy` must be explicit.
- `startingDeadlineSeconds` should be considered.
- Failed/successful job history limits must be set.
- Job must handle duplicate execution safely.

---

## 6. Container Image Policy

Rules:

- Image tag must not be `latest`.
- Prefer immutable digest or CI-generated version tag.
- Image must be built according to `strict-coding-standards__java_docker.md`.
- Runtime container must be non-root.
- Image pull policy must match tag strategy.

Forbidden:

```yaml
image: my-service:latest
imagePullPolicy: Always
```

unless this is an explicitly disposable development environment.

Preferred:

```yaml
image: registry.example.com/my-service:1.4.2-20260610-shaabcdef
imagePullPolicy: IfNotPresent
```

or digest-pinned:

```yaml
image: registry.example.com/my-service@sha256:...
```

---

## 7. Resource Requests and Limits

### 7.1 Requests Required

Every Java container MUST have CPU and memory requests unless platform policy injects them.

Example:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "768Mi"
```

Rules:

- Memory request must reflect realistic steady-state usage.
- Memory limit must leave room for JVM heap + non-heap/native memory.
- CPU request must reflect baseline throughput/latency need.
- Do not copy resource values across services blindly.

### 7.2 Java Memory Sizing

Java memory limit is not equal to heap.

Memory budget must account for:

- Java heap.
- Metaspace.
- Code cache.
- Thread stacks.
- Direct buffers.
- GC/native memory.
- Agents/profilers.
- TLS/compression/native libraries.

Allowed JVM policy:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:MaxRAMPercentage=70
      -XX:InitialRAMPercentage=25
      -XX:+ExitOnOutOfMemoryError
```

Rules:

- `MaxRAMPercentage` should be lower when direct memory/thread count is high.
- Explicit `-Xmx` is allowed only when memory budget is calculated.
- Do not set heap to 100% of pod limit.
- OOMKilled must be treated as capacity/config failure, not random platform noise.

### 7.3 CPU Limits Policy

CPU limits are environment-dependent.

Rules:

- If CPU limits are used, test for throttling impact.
- Worker pools must respect container CPU.
- GC and JIT behavior may be affected by CPU constraints.
- Latency-sensitive services need measurement under throttling.

Forbidden assumption:

> “CPU limit is harmless because Java will adapt automatically.”

---

## 8. Probe Policy

Kubernetes supports liveness, readiness, and startup probes. They must not be interchangeable.

### 8.1 Readiness Probe

Readiness tells Kubernetes whether the pod should receive traffic.

Required for services receiving traffic.

Allowed:

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Readiness MAY check:

- Application initialized.
- Required local components ready.
- Critical dependency availability if failure should remove pod from traffic.

Readiness MUST NOT:

- Mutate state.
- Perform expensive deep health checks.
- Depend on optional downstream systems.
- Flap under transient downstream latency without reason.

### 8.2 Liveness Probe

Liveness tells Kubernetes whether the container should be restarted.

Allowed:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  initialDelaySeconds: 30
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

Liveness SHOULD check only:

- Process is alive.
- Event loop/main server is not deadlocked.
- Application can respond locally.

Liveness MUST NOT check:

- Database availability.
- External API availability.
- Message broker availability.
- Cache availability.

Reason: a downstream outage should not restart every pod.

### 8.3 Startup Probe

Startup probe should be used for slow-starting Java applications.

Allowed:

```yaml
startupProbe:
  httpGet:
    path: /health/live
    port: http
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 24
```

Rules:

- Prefer startup probe over huge liveness initial delay.
- Required for apps with long cold start, migrations, warmup, or large caches.
- Startup probe must give enough time for worst-case startup.

### 8.4 gRPC Probes

For gRPC services:

- Use native gRPC probe if cluster/version supports it.
- Or expose separate HTTP health endpoint intentionally.
- Do not pretend HTTP `/health` validates gRPC server unless wired to same lifecycle.

---

## 9. Port and Service Policy

### 9.1 Named Ports Required

Preferred:

```yaml
ports:
  - name: http
    containerPort: 8080
```

Rules:

- Use named ports for probes/services.
- Do not expose debug ports by default.
- Management/admin ports must be separated and access-controlled.

### 9.2 Service Type

Default service type should be `ClusterIP`.

Forbidden by default:

```yaml
spec:
  type: LoadBalancer
```

unless ingress/external exposure is explicitly intended.

### 9.3 Protocol Clarity

Rules:

- HTTP and gRPC ports must be named distinctly.
- Metrics port must be explicit.
- TLS termination location must be documented.

---

## 10. ConfigMap and Secret Policy

### 10.1 ConfigMap

ConfigMaps may contain non-sensitive configuration.

Rules:

- Config keys must be explicit.
- Application must validate required config at startup.
- Do not store secrets in ConfigMap.
- Avoid huge config blobs.
- Config reload behavior must be documented.

### 10.2 Secret

Kubernetes Secret values must not be committed in plain YAML.

Forbidden:

```yaml
kind: Secret
data:
  password: cHJvZC1wYXNzd29yZA==
```

in source repo unless encrypted/sealed by approved tooling.

Allowed patterns:

- External Secrets Operator.
- Sealed Secrets.
- SOPS-encrypted manifests.
- CSI secret store.
- Platform-managed secret references.

Rules:

- Mount only secrets required by this pod.
- Prefer env var for simple secret values, volume mount for files/certs.
- Do not log secret env vars.
- Rotate secrets without rebuilding image.

---

## 11. Environment Variable Policy

Rules:

- Environment variables must be explicitly named and documented.
- Do not use one giant JSON config env var unless unavoidable.
- Do not inject entire ConfigMap/Secret blindly with `envFrom` for sensitive workloads.
- Required variables must be validated at startup.

Restricted:

```yaml
envFrom:
  - secretRef:
      name: all-prod-secrets
```

Allowed only when secret scope is tightly controlled.

---

## 12. Security Context

Every workload SHOULD define pod/container security context.

Preferred baseline:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  seccompProfile:
    type: RuntimeDefault
containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
          - ALL
```

Rules:

- `runAsNonRoot: true` required unless documented exception.
- `allowPrivilegeEscalation: false` required.
- Drop Linux capabilities by default.
- Use runtime default seccomp profile.
- Root filesystem should be read-only if app supports it.
- Writable volumes must be explicit.

Forbidden by default:

```yaml
privileged: true
runAsUser: 0
hostNetwork: true
hostPID: true
hostIPC: true
allowPrivilegeEscalation: true
```

---

## 13. Writable Volume Policy

If root filesystem is read-only, define writable mounts explicitly.

Example:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 256Mi
```

Rules:

- `emptyDir` must have size limit where supported.
- Do not use persistent volume for logs by default.
- Uploaded files must have quota and lifecycle.
- Temporary files must not contain long-lived secrets.

---

## 14. Service Account and RBAC

Rules:

- Do not use default service account for workloads needing Kubernetes API access.
- If Kubernetes API access is not needed, disable automount token.

Preferred:

```yaml
automountServiceAccountToken: false
```

If access is needed:

- Create dedicated ServiceAccount.
- Grant least privilege Role/RoleBinding.
- Avoid ClusterRole unless necessary.
- Avoid wildcard verbs/resources.

Forbidden by default:

```yaml
apiGroups: ["*"]
resources: ["*"]
verbs: ["*"]
```

---

## 15. Network Policy

NetworkPolicy should be used where CNI supports it.

Rules:

- Default deny should be considered per namespace.
- Ingress must allow only required sources/ports.
- Egress must allow only required destinations where feasible.
- DNS egress must be handled explicitly if egress deny is enabled.
- NetworkPolicy is allow-list based once pod is selected.

Example skeleton:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-service
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: my-service
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: gateway
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
```

---

## 16. Rollout Strategy

For Deployment:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Rules:

- `maxUnavailable` must protect availability for user-facing services.
- Readiness must be correct before rolling update is trusted.
- Rollback path must exist.
- Database migration compatibility must be considered.
- Do not deploy breaking schema and code change in one unsafe rollout.

---

## 17. Graceful Shutdown

Required for long-running Java services:

```yaml
terminationGracePeriodSeconds: 60
```

Rules:

- Application shutdown timeout must be shorter than pod termination grace period.
- Readiness should fail before shutdown completes.
- Stop accepting new work before closing resources.
- Finish or safely cancel in-flight requests/jobs.
- Close DB pools, HTTP clients, executors, message consumers, and telemetry.
- Do not ignore `InterruptedException`.

Optional lifecycle hook:

```yaml
lifecycle:
  preStop:
    httpGet:
      path: /shutdown/prepare
      port: management
```

Restricted: preStop hooks must be reliable, fast, and not required for correctness.

---

## 18. Pod Disruption Budget

User-facing or critical replicated services SHOULD define PDB.

Example:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-service
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: my-service
```

Rules:

- Do not set PDB that blocks all voluntary disruptions accidentally.
- PDB must match replica count and availability target.
- Single-replica service with strict PDB can block node maintenance.

---

## 19. Autoscaling Policy

HPA is allowed only with correct metrics and tested scaling behavior.

Rules:

- CPU-only HPA is often insufficient for Java services.
- Memory-based HPA may not reflect load due to JVM heap behavior.
- Queue length, request rate, latency, or custom metrics may be better.
- Scaling must respect downstream capacity.
- Startup time and readiness delay affect scale-out behavior.
- Set min/max replicas intentionally.

Forbidden assumption:

> “Adding HPA fixes performance.”

Autoscaling shifts pressure unless bottlenecks are understood.

---

## 20. Java Thread/Pool Sizing in Kubernetes

Rules:

- HTTP worker pools must respect CPU and memory limits.
- DB connection pool size must be bounded and coordinated across replicas.
- Message consumer concurrency must account for total replicas.
- Scheduler jobs must not duplicate unsafe work across replicas.
- Virtual threads do not remove downstream capacity limits.

Example DB pool thinking:

```text
max_connections_per_pod * max_replicas <= safe_database_connection_budget
```

LLM MUST NOT set arbitrary pool sizes like 100 without explaining budget.

---

## 21. Database Migration Policy

Restricted patterns:

- Running schema migration in every app pod at startup.
- App pods with permission to perform destructive DDL.
- Non-backward-compatible migration in same rollout as code.

Preferred:

- Dedicated migration Job.
- Backward-compatible expand/migrate/contract strategy.
- Locking and idempotency.
- Rollback plan.

---

## 22. Logging and Observability

Required:

- Logs to stdout/stderr.
- Correlation/request ID propagation.
- Structured logs if platform expects it.
- Metrics endpoint if service is monitored.
- Tracing propagation if distributed tracing is used.
- Kubernetes labels for service/version/component.

Recommended labels:

```yaml
labels:
  app.kubernetes.io/name: my-service
  app.kubernetes.io/instance: my-service-prod
  app.kubernetes.io/version: "1.4.2"
  app.kubernetes.io/component: api
  app.kubernetes.io/part-of: my-platform
  app.kubernetes.io/managed-by: helm
```

Rules:

- Do not log secrets.
- Do not write only to file inside pod.
- Metrics endpoint must not expose sensitive data.
- Admin/actuator endpoints must be access-controlled.

---

## 23. Init Containers

Init containers are allowed for setup tasks that must complete before app startup.

Allowed:

- Waiting for platform dependency only when no better readiness model exists.
- Preparing local emptyDir content.
- Certificate/config transformation.

Forbidden by default:

- Database schema migration in ad hoc init container without migration control.
- Pulling code/scripts dynamically from internet.
- Sleeping blindly to “wait for DB”.

---

## 24. Sidecar Policy

Sidecars are restricted.

Allowed only when:

- Responsibility is clear.
- Lifecycle coupling is intended.
- Resource requests/limits are defined.
- Failure behavior is understood.
- Observability covers both containers.

Examples:

- Service mesh proxy.
- Log/telemetry collector.
- Secret/certificate agent.

Forbidden:

- Sidecar that silently owns critical business logic.
- Sidecar with no resource limits.
- Sidecar that prevents pod termination.

---

## 25. Job and CronJob Java Rules

For Java Jobs:

```yaml
restartPolicy: Never
backoffLimit: 3
activeDeadlineSeconds: 1800
```

Rules:

- Job must be idempotent or detect duplicate execution.
- Use explicit memory budget.
- Logs must identify job instance.
- Partial failure handling must be documented.
- Use `ttlSecondsAfterFinished` if cluster policy allows cleanup.

For CronJob:

```yaml
concurrencyPolicy: Forbid
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 3
```

Choose concurrency policy intentionally:

- `Forbid` for non-reentrant jobs.
- `Replace` only when safe to cancel previous run.
- `Allow` only for reentrant/partitioned jobs.

---

## 26. Storage Policy

Rules:

- Stateless services should not require persistent volume.
- Persistent volume usage must define backup, retention, access mode, and failure semantics.
- Do not store critical state only in pod filesystem.
- Do not use `hostPath` by default.

Forbidden by default:

```yaml
volumes:
  - name: host
    hostPath:
      path: /var/run/docker.sock
```

---

## 27. Namespace and Multi-Tenancy Policy

Rules:

- Namespace must match environment/team/application boundary.
- Do not assume cross-namespace access.
- RBAC, NetworkPolicy, ResourceQuota, and LimitRange should align.
- Tenant ID isolation must be implemented in application and data layers, not only namespace.

---

## 28. Scheduling Policy

Allowed when justified:

- `nodeSelector`
- `affinity`
- `topologySpreadConstraints`
- `tolerations`

Rules:

- Do not pin workloads to nodes without operational reason.
- Use topology spread for HA services across zones/nodes.
- Anti-affinity must not make scheduling impossible.

Recommended for replicated critical services:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: my-service
```

---

## 29. Ingress/Gateway Policy

Rules:

- External exposure must be explicit.
- TLS termination must be defined.
- Host/path routing must be least privilege.
- Request body size and timeout limits should be set.
- Authentication must not be assumed from Ingress alone unless architecture says so.
- Internal services must not accidentally become public.

---

## 30. Java-Specific Failure Modes

LLM/reviewer must consider:

### 30.1 OOMKilled

Possible causes:

- Heap too large.
- Direct memory too large.
- Too many threads.
- Native leak.
- Unbounded request body.
- Large cache.
- Too aggressive concurrency.

Do not fix blindly by increasing memory.

### 30.2 CrashLoopBackOff

Possible causes:

- Bad config.
- Missing secret.
- Port mismatch.
- DB migration failure.
- Probe too aggressive.
- JVM exits on OOM.

Do not fix by disabling probes first.

### 30.3 Readiness Flapping

Possible causes:

- Readiness checks downstream too deeply.
- GC pauses.
- CPU throttling.
- Connection pool starvation.
- Slow startup.

### 30.4 Rolling Outage

Possible causes:

- Bad readiness.
- `maxUnavailable` too high.
- Migration incompatibility.
- Long shutdown with too short grace period.
- HPA scale-down during deployment.

---

## 31. Forbidden Kubernetes Anti-Patterns

LLM MUST NOT generate:

```yaml
securityContext:
  privileged: true
```

```yaml
runAsUser: 0
```

```yaml
resources: {}
```

for production workload.

```yaml
livenessProbe:
  httpGet:
    path: /health/db
```

if it restarts pods during DB outage.

```yaml
image: app:latest
```

```yaml
env:
  - name: PASSWORD
    value: prod-password
```

```yaml
hostNetwork: true
```

without platform justification.

```yaml
serviceAccountName: default
```

when Kubernetes API access is needed.

```yaml
automountServiceAccountToken: true
```

when API access is not needed.

---

## 32. Required Review Checklist

### Workload

- [ ] Correct workload type selected.
- [ ] Image tag is not `latest`.
- [ ] Ports are named and correct.
- [ ] Service type is appropriate.
- [ ] Rollout strategy is explicit.
- [ ] Termination grace period is appropriate.

### Resources

- [ ] CPU/memory requests are set.
- [ ] Memory limit accounts for heap and non-heap.
- [ ] JVM memory flags are appropriate.
- [ ] Pool/thread/concurrency sizes fit replica count.
- [ ] HPA, if present, uses meaningful metrics.

### Health

- [ ] Readiness probe exists for traffic-serving service.
- [ ] Liveness probe is shallow/local.
- [ ] Startup probe exists for slow Java startup.
- [ ] Probe timeouts/thresholds are realistic.
- [ ] Probe paths/ports match application.

### Security

- [ ] Runs as non-root.
- [ ] Privilege escalation disabled.
- [ ] Capabilities dropped.
- [ ] Service account token disabled unless needed.
- [ ] RBAC is least privilege.
- [ ] Secrets are referenced securely, not committed.
- [ ] NetworkPolicy considered/applied.
- [ ] Root filesystem read-only or exception documented.

### Operations

- [ ] Logs go to stdout/stderr.
- [ ] Metrics/tracing strategy is clear.
- [ ] Config validation exists.
- [ ] Graceful shutdown is implemented.
- [ ] PDB is defined for critical replicated services.
- [ ] Migration strategy is safe.

---

## 33. LLM Prompt Contract

Use this prompt fragment for Kubernetes-related code generation:

```text
You are modifying Kubernetes deployment files for a Java application.
Follow strict-coding-standards__java_kubernetes.md.
Before changing manifests, identify:
1. Workload type and why.
2. Java baseline and JVM memory strategy.
3. Runtime protocol and ports.
4. Probe design: startup/readiness/liveness.
5. Resource requests/limits.
6. Security context.
7. Service account/RBAC needs.
8. ConfigMap/Secret injection strategy.
9. Rollout and shutdown behavior.
10. Network exposure and NetworkPolicy expectations.

Do not use latest image tags, root/privileged containers, missing resources, embedded secrets, unsafe probes, or default broad Kubernetes API access.
If a rule must be violated, document the reason, risk, and safer alternative.
```

---

## 34. References

- Kubernetes Docs — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Kubernetes Docs — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes Docs — Configure Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes Docs — Security Context: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
- Kubernetes Docs — Pod Security Admission / Standards: https://kubernetes.io/docs/concepts/security/pod-security-admission/
- Kubernetes Docs — Network Policies: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- Kubernetes Docs — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Docs — ConfigMaps: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes Docs — Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- OpenJDK/JDK container behavior must be verified for the exact Java distribution and version used.

---

## 35. Final Rule

Kubernetes manifests are production code.

A manifest is not acceptable merely because `kubectl apply` succeeds. It must encode resource boundaries, security boundaries, lifecycle behavior, observability, and failure handling clearly enough that both humans and LLM agents can safely maintain it.
