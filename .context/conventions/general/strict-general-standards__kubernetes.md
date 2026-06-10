# Strict General Standards: Kubernetes

> Mandatory conventions for LLMs, code agents, and engineers when creating or modifying Kubernetes manifests, Helm charts, Kustomize overlays, deployment pipelines, and workload runtime configuration.

---

## 1. Purpose

This standard defines how Kubernetes workloads must be designed, deployed, secured, scaled, observed, and operated.

Kubernetes is not a place to hide poor application design. A workload manifest is an executable operating model: it defines lifecycle, scheduling, health, security boundary, scaling behavior, network exposure, configuration, and failure handling.

An LLM/code agent must treat Kubernetes YAML as production infrastructure code, not as boilerplate.

---

## 2. Scope

This standard applies to:

- Pods
- Deployments
- StatefulSets
- DaemonSets
- Jobs and CronJobs
- Services
- Ingress / Gateway API references
- ConfigMaps and Secrets
- ServiceAccounts and RBAC
- NetworkPolicies
- PodDisruptionBudgets
- HorizontalPodAutoscalers
- PersistentVolumeClaims
- Helm charts
- Kustomize overlays
- CI/CD deployment templates

Cluster provisioning, CNI installation, CSI setup, and control-plane administration are outside the primary scope, but generated workload YAML must not assume insecure cluster defaults.

---

## 3. Core Principles

### 3.1 Kubernetes manifests describe desired operating behavior

A manifest must define how the workload behaves under normal operation, startup, failure, scaling, rollout, and shutdown.

**MUST:**

- Define workload type intentionally.
- Define probes where appropriate.
- Define resource requests and limits policy.
- Define security context.
- Define rollout behavior.
- Define configuration and secret boundaries.
- Define network exposure explicitly.
- Define service account and RBAC needs.

**MUST NOT:**

- Generate minimal YAML that only “runs a container” for production.
- Assume cluster defaults are safe.
- Use Kubernetes to compensate for missing application timeouts, graceful shutdown, idempotency, or retry control.

---

### 3.2 Default posture is least privilege

Every generated workload must minimize permissions, filesystem access, Linux capabilities, API access, and network reachability.

**MUST:**

- Use a dedicated `ServiceAccount` per workload unless no API access is needed.
- Set `automountServiceAccountToken: false` when Kubernetes API access is not required.
- Use `runAsNonRoot: true` where compatible.
- Drop Linux capabilities by default.
- Disallow privilege escalation by default.
- Prefer read-only root filesystem where compatible.
- Avoid host namespaces and hostPath mounts.

---

### 3.3 Workload availability must be explicit

Kubernetes can restart, reschedule, and roll out Pods, but it cannot infer business availability requirements.

**MUST:**

- Define readiness behavior before sending traffic.
- Define liveness behavior only for unrecoverable stuck states.
- Define startup probes for slow-starting workloads.
- Define termination grace period based on application shutdown time.
- Define PodDisruptionBudget for replicated critical workloads.
- Define rollout strategy for zero/low downtime.

---

### 3.4 Configuration is externalized but controlled

ConfigMaps and Secrets are not dumping grounds. They are explicit runtime contracts.

**MUST:**

- Separate non-sensitive config from secrets.
- Keep secrets out of Git unless sealed/encrypted through approved tooling.
- Version or checksum config to trigger safe rollout when config changes.
- Validate required config at application startup.
- Prefer immutable ConfigMaps/Secrets for stable release-bound config.

**MUST NOT:**

- Put secrets in ConfigMaps.
- Put environment-specific values into container images.
- Use a single giant ConfigMap for unrelated systems.

---

## 4. Workload Type Selection

### 4.1 Deployment

Use `Deployment` for stateless, horizontally scalable, long-running applications.

**MUST use Deployment when:**

- Pods are interchangeable.
- Identity is not stable per replica.
- Storage is external or ephemeral.
- Rolling updates are acceptable.

---

### 4.2 StatefulSet

Use `StatefulSet` only when stable network identity, stable storage, or ordered rollout is required.

**MUST use StatefulSet when:**

- Each replica has identity or persistent state.
- Ordered startup/shutdown matters.
- PersistentVolumeClaim per replica is required.

**MUST NOT:**

- Use StatefulSet merely because the application uses a database connection.

---

### 4.3 Job and CronJob

Use `Job` for finite tasks and `CronJob` for scheduled tasks.

**MUST:**

- Define retry/backoff behavior.
- Define idempotency expectations.
- Define deadline or timeout.
- Define concurrency policy for CronJob.
- Define history limits.

**MUST NOT:**

- Use Deployment for one-off batch jobs.
- Use CronJob without idempotency or duplicate execution handling.

---

### 4.4 DaemonSet

Use `DaemonSet` only for node-level agents.

**Allowed examples:**

- Log collectors
- Node monitoring agents
- CNI/storage agents
- Security agents

**MUST NOT:**

- Use DaemonSet to force high availability for normal application services.

---

## 5. Mandatory Metadata Standards

Every object must include consistent labels.

**MUST include:**

```yaml
metadata:
  labels:
    app.kubernetes.io/name: example-service
    app.kubernetes.io/instance: example-service
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: example-platform
    app.kubernetes.io/managed-by: helm
```

**SHOULD include:**

```yaml
app.kubernetes.io/version: "1.2.3"
```

**MUST:**

- Use selectors that are stable and not accidentally changed across releases.
- Avoid using mutable version labels in Deployment selectors.
- Add annotations for config checksums, release metadata, monitoring, and documentation links when used by the platform.

---

## 6. Container Image Standards

**MUST:**

- Use immutable image references in production, preferably digest or release tag plus digest.
- Avoid `:latest`.
- Set `imagePullPolicy` intentionally.
- Use images built from the Docker standard.

**MUST NOT:**

```yaml
image: my-service:latest
imagePullPolicy: Always
```

for production unless explicitly part of a controlled dev/test workflow.

**Recommended production pattern:**

```yaml
image: registry.example.com/platform/example-service:1.2.3@sha256:<digest>
imagePullPolicy: IfNotPresent
```

---

## 7. Resource Management Standards

### 7.1 Requests are mandatory

Every production container must define CPU and memory requests.

**MUST:**

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
```

Requests are used for scheduling and capacity planning.

---

### 7.2 Limits must be intentional

**MUST:**

- Define memory limits unless the platform policy intentionally manages memory differently.
- Treat CPU limits carefully because they can cause throttling.
- Size limits based on load tests, telemetry, and SLOs.

**MUST NOT:**

- Set arbitrary tiny memory limits copied from examples.
- Set CPU/memory values without considering startup, peak load, GC/runtime behavior, and sidecars.

**Example:**

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

---

### 7.3 Ephemeral storage

**SHOULD:**

- Define ephemeral-storage requests/limits for workloads that write temporary files.
- Prefer explicit volumes for temporary storage.

**MUST NOT:**

- Let logs, temp files, caches, or uploads grow unbounded inside the container filesystem.

---

## 8. Probes and Lifecycle Standards

### 8.1 Readiness probe

Readiness controls traffic routing.

**MUST:**

- Add readiness probe for services receiving traffic.
- Return ready only when the application can safely serve requests.
- Keep readiness cheap and deterministic.

**Example:**

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: http
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

**MUST NOT:**

- Mark ready before migrations, config loading, or critical initialization complete.
- Use readiness checks that mutate state.

---

### 8.2 Liveness probe

Liveness controls restart.

**MUST:**

- Use liveness only for states where restart is the correct recovery.
- Give the application enough time to start before liveness begins.
- Avoid making liveness depend on external services.

**MUST NOT:**

- Reuse a deep dependency readiness check as liveness.
- Cause restart loops because a downstream service is unavailable.

---

### 8.3 Startup probe

Startup probe is mandatory for slow-starting applications where liveness would otherwise kill the process before initialization completes.

**Example:**

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: http
  periodSeconds: 5
  failureThreshold: 60
```

---

### 8.4 Graceful shutdown

**MUST:**

- Set `terminationGracePeriodSeconds` based on real shutdown behavior.
- Ensure the application handles `SIGTERM`.
- Stop accepting new traffic before terminating in-flight requests.
- Use `preStop` only when application-level graceful shutdown is insufficient.

**Example:**

```yaml
terminationGracePeriodSeconds: 60
```

**MUST NOT:**

- Use `preStop: sleep` as a substitute for correct readiness and shutdown behavior unless documented as a platform-specific drain workaround.

---

## 9. Security Context Standards

### 9.1 Pod-level security context

**MUST:**

```yaml
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
```

**SHOULD:**

```yaml
securityContext:
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
```

when the image and volume permissions require it.

---

### 9.2 Container-level security context

**MUST:**

```yaml
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

If the application needs a writable filesystem, define explicit writable mounts:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

**MUST NOT:**

- Use privileged mode.
- Add broad capabilities.
- Run as root without exception.
- Use host namespaces for normal applications.
- Mount Docker socket or broad host paths.

---

### 9.3 Pod Security Standards

**MUST:**

- Target Restricted policy where feasible.
- At minimum comply with Baseline policy for normal application namespaces.
- Document every exception that requires privileged behavior.

---

## 10. ServiceAccount and RBAC Standards

### 10.1 ServiceAccount

**MUST:**

- Use a dedicated ServiceAccount for each workload that needs Kubernetes API access.
- Set `automountServiceAccountToken: false` when API access is not required.

**Example:**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: example-service
  labels:
    app.kubernetes.io/name: example-service
automountServiceAccountToken: false
```

---

### 10.2 RBAC

**MUST:**

- Grant least privilege.
- Use namespace-scoped `Role` instead of `ClusterRole` unless cluster-wide access is required.
- Bind permissions only to the workload ServiceAccount.
- Avoid wildcard verbs/resources.

**MUST NOT:**

```yaml
verbs: ["*"]
resources: ["*"]
```

unless building a tightly controlled cluster operator with formal review.

---

## 11. Configuration Standards

### 11.1 ConfigMaps

**MUST:**

- Store non-sensitive configuration only.
- Use clear key names.
- Avoid unrelated config in the same ConfigMap.
- Trigger rollout when mounted config changes if the application does not hot-reload.

**SHOULD:**

- Use immutable ConfigMaps for release-bound config.

---

### 11.2 Secrets

**MUST:**

- Store sensitive data in Secrets or approved external secret mechanism.
- Encrypt or seal secrets before committing to Git.
- Mount secrets as files when possible to reduce accidental exposure in process lists/logs.
- Scope secrets to the namespace/workload that needs them.

**MUST NOT:**

- Put secrets in ConfigMaps.
- Put secrets in annotations, labels, image tags, command args, or logs.
- Share one broad secret across many services.

---

### 11.3 Environment variables

**MUST:**

- Keep environment variables explicit.
- Avoid injecting entire ConfigMap/Secret unless the set is small and stable.
- Validate required env vars at application startup.

**MUST NOT:**

- Use environment variables as an uncontrolled dumping ground for runtime state.

---

## 12. Service and Network Standards

### 12.1 Service

**MUST:**

- Use `ClusterIP` for internal service-to-service communication by default.
- Use named ports.
- Keep selectors stable.
- Avoid exposing services externally unless required.

**Example:**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: example-service
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: example-service
  ports:
    - name: http
      port: 80
      targetPort: http
```

**MUST NOT:**

- Use `NodePort` or `LoadBalancer` by default for internal services.

---

### 12.2 Ingress / Gateway

**MUST:**

- Route external traffic through approved ingress/gateway layer.
- Use TLS for external traffic.
- Define hostnames explicitly.
- Keep path routing deterministic.
- Avoid putting business authorization only at ingress/gateway.

---

### 12.3 NetworkPolicy

**MUST:**

- Define NetworkPolicy for production namespaces where the CNI supports it.
- Prefer default-deny ingress and explicit allow rules.
- Add egress restrictions for sensitive workloads.

**Example ingress allow pattern:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: example-service-ingress
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: example-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: api-gateway
      ports:
        - protocol: TCP
          port: 8080
```

**MUST NOT:**

- Assume namespace isolation automatically blocks network traffic.

---

## 13. Availability and Rollout Standards

### 13.1 Deployment strategy

**MUST:**

- Use rolling update strategy intentionally.
- Set `maxUnavailable` and `maxSurge` based on capacity and availability requirements.
- Ensure readiness probe protects rollout.

**Example:**

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

**MUST NOT:**

- Use default rollout settings blindly for critical workloads.

---

### 13.2 Replicas

**MUST:**

- Use at least 2 replicas for highly available stateless production services unless there is a documented reason.
- Use anti-affinity/topology spread constraints for critical replicated workloads when the platform supports it.

---

### 13.3 PodDisruptionBudget

**MUST:**

- Define PDB for critical replicated workloads.
- Ensure PDB does not block node maintenance due to impossible constraints.

**Example:**

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: example-service
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: example-service
```

---

### 13.4 Autoscaling

**MUST:**

- Use HPA only when metrics correlate with load.
- Ensure resource requests exist before HPA uses CPU/memory metrics.
- Define min/max replicas.
- Validate scale-up and scale-down behavior under load tests.

**MUST NOT:**

- Add HPA to mask memory leaks, slow queries, or missing backpressure.

---

## 14. Storage Standards

### 14.1 Stateless first

**MUST:**

- Keep application pods stateless unless stateful behavior is required.
- Store durable business data in managed databases/storage systems, not container filesystems.

---

### 14.2 PersistentVolumeClaims

**MUST:**

- Define storage class intentionally.
- Define access mode based on real workload needs.
- Define backup/restore expectation.
- Define retention policy.
- Avoid sharing writable volumes across unrelated workloads.

---

### 14.3 `emptyDir`

`emptyDir` is acceptable for temporary data only.

**MUST:**

- Use size limits where supported and relevant.
- Avoid storing business-critical data in `emptyDir`.

---

### 14.4 hostPath

**MUST NOT:**

- Use `hostPath` for normal application workloads.

Allowed only for node agents, platform components, and explicitly reviewed cases.

---

## 15. Observability Standards

### 15.1 Logs

**MUST:**

- Write application logs to stdout/stderr.
- Use structured logs where possible.
- Include correlation/request IDs.
- Avoid logging secrets, tokens, credentials, PII, or full payloads by default.

---

### 15.2 Metrics

**SHOULD expose:**

- Request rate
- Error rate
- Latency percentiles
- Saturation
- Queue depth
- Dependency failures
- JVM/runtime memory where relevant
- Business process counters where relevant

---

### 15.3 Tracing

**SHOULD:**

- Propagate trace context across HTTP, messaging, and async boundaries.
- Add spans for outbound dependency calls.
- Avoid high-cardinality labels.

---

### 15.4 Events and rollout visibility

**MUST:**

- Ensure deployments can be traced to image digest, commit SHA, and release version.
- Use rollout status checks in CI/CD.
- Preserve deployment evidence.

---

## 16. Helm and Kustomize Standards

### 16.1 Helm

**MUST:**

- Keep templates readable.
- Provide safe default values.
- Validate required values.
- Avoid complex business logic in templates.
- Use chart version and app version consistently.
- Support environment overrides without duplicating templates.

**MUST NOT:**

- Hide security-critical defaults in deeply nested values.
- Generate invalid YAML when optional values are omitted.
- Store secrets in plain `values.yaml` for production.

---

### 16.2 Kustomize

**MUST:**

- Keep base manifests environment-neutral.
- Put environment-specific patches in overlays.
- Avoid duplicating full manifests when a patch is enough.
- Keep patches reviewable.

---

## 17. CI/CD Deployment Standards

**MUST:**

- Validate YAML schema.
- Lint Helm/Kustomize output.
- Run policy checks for security context, resources, image tags, RBAC, and NetworkPolicy.
- Scan container image before deployment.
- Deploy by immutable image digest or release artifact reference.
- Run rollout status checks.
- Support rollback.

**SHOULD:**

- Use server-side dry-run.
- Use progressive delivery for critical services.
- Store rendered manifests as deployment evidence.

---

## 18. Minimal Production Deployment Template

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-service
  labels:
    app.kubernetes.io/name: example-service
    app.kubernetes.io/instance: example-service
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: example-platform
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: example-service
      app.kubernetes.io/instance: example-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app.kubernetes.io/name: example-service
        app.kubernetes.io/instance: example-service
        app.kubernetes.io/component: api
    spec:
      serviceAccountName: example-service
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/platform/example-service:1.2.3@sha256:<digest>
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_ENV
              value: production
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              memory: "2Gi"
          startupProbe:
            httpGet:
              path: /health/startup
              port: http
            periodSeconds: 5
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

This template is not a universal solution. The LLM/code agent must adapt it to the actual workload.

---

## 19. Anti-Patterns

The LLM/code agent must reject or flag these patterns:

1. Production Deployment with only image and port.
2. `image: latest` in production.
3. No resource requests.
4. Arbitrary resource limits copied from examples.
5. Liveness probe depends on database or external service.
6. Readiness always returns success even when app cannot serve traffic.
7. No graceful shutdown consideration.
8. Running container as root.
9. Privileged container for normal application.
10. `hostPath` for application data.
11. `automountServiceAccountToken: true` when API access is not needed.
12. Broad RBAC wildcard permissions.
13. Secrets in ConfigMaps.
14. Secrets committed in plain YAML.
15. No NetworkPolicy in sensitive namespaces.
16. External exposure through NodePort by default.
17. PDB that blocks all voluntary disruptions.
18. HPA without requests or meaningful metrics.
19. StatefulSet used for normal stateless service.
20. CronJob without concurrency and retry policy.
21. Helm chart with insecure defaults.
22. Kustomize overlays duplicating whole manifests.
23. CI/CD applies manifests without validation/policy checks.
24. Business authorization enforced only at ingress.
25. Application writes important state to ephemeral container filesystem.

---

## 20. Review Checklist

A Kubernetes change is acceptable only if all relevant items are true:

- [ ] Workload type is correct: Deployment, StatefulSet, Job, CronJob, or DaemonSet.
- [ ] Labels/selectors are stable and follow Kubernetes recommended labels.
- [ ] Image reference is immutable or governed by release policy.
- [ ] No production `latest` tag.
- [ ] CPU and memory requests are defined.
- [ ] Memory limits and CPU policy are intentional.
- [ ] Readiness probe exists for traffic-serving services.
- [ ] Liveness probe is safe and not dependency-deep.
- [ ] Startup probe exists for slow-starting workloads.
- [ ] Graceful shutdown is configured.
- [ ] Security context follows least privilege.
- [ ] Workload runs as non-root or exception is documented.
- [ ] Root filesystem is read-only where compatible.
- [ ] ServiceAccount is dedicated or disabled.
- [ ] RBAC is least privilege.
- [ ] Secrets and ConfigMaps are separated.
- [ ] Secrets are not committed in plaintext.
- [ ] Service exposure is internal by default.
- [ ] NetworkPolicy is defined where required.
- [ ] PDB exists for critical replicated services.
- [ ] Rollout strategy is suitable for availability requirements.
- [ ] HPA, if present, uses meaningful metrics and bounds.
- [ ] Logs go to stdout/stderr.
- [ ] CI/CD validates, scans, and checks policies.

---

## 21. Acceptance Criteria for LLM Output

When an LLM generates Kubernetes-related code, it must include:

1. Correct workload kind and explanation of why.
2. Stable labels and selectors.
3. Explicit image tag/digest policy.
4. Resource requests and intentional limits.
5. Probes appropriate to workload behavior.
6. Security context with least privilege.
7. ServiceAccount and RBAC decision.
8. ConfigMap/Secret separation.
9. Service/network exposure decision.
10. Rollout and availability controls.
11. Observability expectations.
12. Notes for any assumptions or exceptions.

---

## 22. Enforcement Snippet for LLM/Code Agent

Use this before producing Kubernetes manifests:

```text
Before generating Kubernetes YAML, identify workload type, image reference, ports, config, secrets, storage, API permissions, traffic exposure, scaling needs, probes, resources, shutdown behavior, and security constraints.
Generate production manifests with requests, probes, securityContext, stable labels, explicit ServiceAccount decision, safe rollout strategy, and no latest image tags.
Never assume cluster defaults are safe. Never put secrets in ConfigMaps or plaintext manifests. Never grant broad RBAC or privileged mode without documented exception.
```

---

## 23. References

- Kubernetes Docs — Workloads: https://kubernetes.io/docs/concepts/workloads/
- Kubernetes Docs — Pods: https://kubernetes.io/docs/concepts/workloads/pods/
- Kubernetes Docs — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Docs — StatefulSets: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
- Kubernetes Docs — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Kubernetes Docs — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes Docs — Configure probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes Docs — Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/
- Kubernetes Docs — Pod Security Admission: https://kubernetes.io/docs/concepts/security/pod-security-admission/
- Kubernetes Docs — Security Checklist: https://kubernetes.io/docs/concepts/security/security-checklist/
- Kubernetes Docs — RBAC Good Practices: https://kubernetes.io/docs/concepts/security/rbac-good-practices/
- Kubernetes Docs — Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- Kubernetes Docs — Good practices for Secrets: https://kubernetes.io/docs/concepts/security/secrets-good-practices/
- Kubernetes Docs — ConfigMaps: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes Docs — Network Policies: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- Kubernetes Docs — PodDisruptionBudget: https://kubernetes.io/docs/tasks/run-application/configure-pdb/
- Kubernetes Docs — Horizontal Pod Autoscaling: https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/
