# learn-kubernetes-mastery-for-java-engineers-part-035.md

# Part 035 — Capstone: Design a Production Kubernetes Platform for Java Distributed Systems

> Status seri: **bagian terakhir**.  
> Setelah part ini, seri `learn-kubernetes-mastery-for-java-engineers` mencapai **Part 035 dari 035** dan dianggap selesai sebagai kurikulum inti.

---

## 1. Tujuan Part Ini

Part ini adalah capstone. Tujuannya bukan memperkenalkan konsep baru secara terpisah, tetapi menggabungkan seluruh mental model dari Part 000–034 menjadi satu desain platform Kubernetes produksi yang realistis untuk workload Java distributed systems.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menerjemahkan requirement bisnis dan engineering menjadi desain Kubernetes yang operasional.
2. Menentukan boundary antara app team, platform team, SRE, security, dan data/infrastructure team.
3. Mendesain namespace, RBAC, network policy, deployment, autoscaling, observability, security, dan delivery flow sebagai satu sistem.
4. Membuat blueprint workload Java yang production-grade tanpa jatuh ke template YAML dangkal.
5. Menghasilkan failure-mode matrix untuk menilai readiness platform.
6. Menjelaskan mengapa desain tertentu dipilih, trade-off-nya, dan kapan desain itu perlu diubah.

Capstone ini sengaja dibuat seperti desain nyata: ada requirement, constraint, target reliability, pilihan arsitektur, object Kubernetes, manifest blueprint, runbook, checklist, dan review matrix.

---

## 2. Problem Statement

Bayangkan organisasi sedang membangun platform Kubernetes untuk menjalankan sistem regulasi digital. Sistem ini punya beberapa jenis workload:

1. REST API Java untuk case management.
2. REST API Java untuk enforcement lifecycle.
3. Worker Java untuk memproses event dari Kafka.
4. Worker Java untuk mengirim notifikasi via queue.
5. CronJob Java untuk reconciliation harian.
6. Job Java untuk database migration.
7. Admin API internal untuk operasi terbatas.
8. External dependencies:
   - PostgreSQL managed service.
   - Redis managed service.
   - Kafka managed service.
   - Object storage managed service.
   - Identity provider eksternal.

Kita tidak akan menjalankan PostgreSQL/Kafka/Redis sebagai cluster stateful internal di capstone ini. Alasannya: seri sebelumnya sudah membahas database/message broker secara terpisah, dan tujuan Kubernetes capstone ini adalah membangun platform workload application, bukan mengganti managed data platform.

Kubernetes akan menjadi:

- runtime workload Java,
- control plane deployment,
- policy enforcement layer,
- traffic routing layer,
- scaling layer,
- security boundary management layer,
- observability integration point,
- delivery reconciliation target.

Kubernetes tidak akan menjadi:

- pengganti database durability,
- pengganti desain idempotency,
- pengganti application-level correctness,
- pengganti DR strategy data,
- pengganti secure SDLC,
- pengganti ownership engineering.

---

## 3. Mental Model Utama

Platform Kubernetes produksi adalah kombinasi dari beberapa control loop:

```text
GitOps Controller
  watches Git desired state
  reconciles Kubernetes manifests

Kubernetes Controllers
  watch API objects
  reconcile Deployments, ReplicaSets, Jobs, Services, etc.

Scheduler
  watches unscheduled Pods
  binds them to Nodes

Kubelet
  watches assigned Pods
  starts/stops containers on Nodes

HPA / Autoscalers
  watch metrics
  adjust replicas/resources/capacity

Ingress/Gateway Controllers
  watch Gateway/Route/Ingress objects
  configure traffic data plane

Policy Controllers / Admission
  inspect or mutate API requests
  allow/deny/shape cluster changes

Observability Stack
  collects telemetry
  informs humans and automated controllers
```

Desain platform yang baik bukan hanya “punya semua komponen”. Desain yang baik memastikan setiap control loop punya:

- input yang jelas,
- owner yang jelas,
- failure signal yang jelas,
- rollback atau remediation path,
- guardrail agar tidak saling bertarung,
- observability agar bisa diaudit.

Prinsip terpenting:

```text
Kubernetes gives you convergence of infrastructure state.
It does not automatically give you correctness of business state.
```

Misalnya:

- Deployment berhasil rollout, tapi DB migration tidak backward-compatible.
- HPA berhasil scale worker, tapi consumer group rebalance menyebabkan throughput turun.
- Pod Ready, tapi application warmup belum selesai.
- NetworkPolicy valid, tapi DNS egress terblokir.
- GitOps sync sehat, tapi desired state di Git salah.

Jadi desain produksi harus selalu menggabungkan:

1. Kubernetes object correctness.
2. Application correctness.
3. Operational correctness.
4. Security correctness.
5. Failure recovery correctness.

---

## 4. Reference Architecture

### 4.1 Logical Architecture

```text
                 Internet / Partner Network
                           |
                    External Load Balancer
                           |
                    Gateway / Ingress Layer
                           |
                +----------+----------+
                |                     |
        public-api namespace     internal-api namespace
                |                     |
        case-api Deployment       admin-api Deployment
        enforcement-api Deployment
                |
        app-worker namespace
                |
        kafka-consumer Deployment
        notification-worker Deployment
        reconciliation CronJob
        migration Job

External dependencies:
- Managed PostgreSQL
- Managed Kafka
- Managed Redis
- Object Storage
- Identity Provider
- Secret Manager

Platform services:
- GitOps controller
- Metrics stack
- Logging pipeline
- Tracing collector
- Policy engine
- Certificate manager
- External secrets controller
- Gateway controller
```

### 4.2 Kubernetes Cluster Boundary

Cluster menjalankan compute plane untuk aplikasi. State kritikal disimpan di managed services di luar cluster, kecuali state ephemeral seperti temp file, cache lokal, atau job workspace.

Boundary ini mengurangi risiko:

- data loss karena cluster rebuild,
- storage topology complexity,
- quorum misconfiguration,
- operator stateful complexity,
- DR coupling antara workload dan data.

Namun desain ini tetap membutuhkan:

- secure network path ke managed services,
- secret rotation,
- connection pool control,
- failover behavior,
- latency budget,
- dependency observability.

---

## 5. Environment Model

Minimal production-grade environment:

```text
dev
  untuk eksperimen developer, tidak production-like penuh

test
  untuk integration test otomatis dan ephemeral validation

staging
  production-like, dipakai untuk release candidate, load test terbatas, migration rehearsal

prod
  workload customer/user-facing aktual
```

Ada dua model umum:

### 5.1 Cluster per Environment

```text
dev cluster
staging cluster
prod cluster
```

Kelebihan:

- blast radius lebih kecil,
- policy bisa berbeda,
- upgrade bisa diuji bertahap,
- credentials/environment lebih terisolasi.

Kekurangan:

- biaya lebih tinggi,
- manajemen cluster lebih banyak,
- potensi drift antar cluster,
- observability perlu federasi.

### 5.2 Shared Cluster dengan Namespace per Environment

```text
shared cluster
  dev namespace
  test namespace
  staging namespace
```

Prod sebaiknya tetap cluster terpisah jika workload critical.

Kelebihan:

- biaya lebih efisien,
- setup lebih sederhana,
- cocok untuk non-prod.

Kekurangan:

- risiko noisy neighbor,
- risiko policy leak,
- namespace bukan hard isolation,
- cluster-level failure memukul semua environment.

### 5.3 Rekomendasi Capstone

```text
Non-production:
  shared non-prod cluster
  namespace per app per environment

Production:
  dedicated production cluster
  namespace per bounded context / app group
```

Contoh:

```text
nonprod cluster:
  case-api-dev
  case-api-test
  enforcement-api-dev
  enforcement-api-test
  workers-dev
  workers-test

prod cluster:
  case-prod
  enforcement-prod
  workers-prod
  platform-prod
  observability-prod
  ingress-prod
```

---

## 6. Namespace Model

Namespace bukan folder. Namespace adalah boundary untuk:

- RBAC,
- quota,
- limit range,
- NetworkPolicy,
- Pod Security Admission,
- ownership,
- cost allocation,
- operational blast radius,
- GitOps application boundary.

### 6.1 Production Namespace Blueprint

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: case-prod
  labels:
    platform.company.io/environment: prod
    platform.company.io/domain: case-management
    platform.company.io/owner: case-team
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### 6.2 Namespace Naming Convention

```text
<domain>-<environment>
```

Examples:

```text
case-prod
enforcement-prod
workers-prod
platform-prod
observability-prod
ingress-prod
```

Avoid:

```text
default
apps
backend
microservices
production
team-a
```

Nama generik menyembunyikan ownership dan blast radius.

### 6.3 ResourceQuota Example

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: case-prod
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 80Gi
    limits.cpu: "40"
    limits.memory: 120Gi
    pods: "80"
```

Quota bukan hanya cost control. Quota juga safety guard agar runaway deployment tidak menghabiskan cluster.

### 6.4 LimitRange Example

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-container-limits
  namespace: case-prod
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 250m
        memory: 512Mi
      default:
        cpu: "1"
        memory: 1Gi
```

LimitRange berguna untuk default, tetapi jangan jadikan pengganti sizing eksplisit. Workload production sebaiknya tetap mendefinisikan request/limit secara sadar.

---

## 7. Workload Classification

Sebelum menulis manifest, klasifikasikan workload.

| Workload | Type | Scaling Signal | Shutdown Requirement | State Model |
|---|---|---:|---|---|
| case-api | HTTP API | RPS, latency, CPU | drain request | stateless |
| enforcement-api | HTTP API | RPS, latency, CPU | drain request | stateless |
| admin-api | internal HTTP API | low fixed replica | strict access | stateless |
| kafka-consumer | worker | lag/backlog | commit/finish message | external state |
| notification-worker | queue worker | queue depth | ack/nack safely | external state |
| reconciliation | CronJob | schedule | idempotent execution | external state |
| db-migration | Job | release event | run once safely | external state |

Kubernetes object mapping:

| Workload Type | Kubernetes Object |
|---|---|
| stateless HTTP API | Deployment + Service + HTTPRoute/Ingress + HPA + PDB |
| internal API | Deployment + Service + internal Route + NetworkPolicy |
| long-running worker | Deployment + HPA/KEDA-style autoscaling + PDB |
| scheduled task | CronJob |
| release migration | Job, ideally orchestrated by delivery flow |
| daemon agent | DaemonSet |
| stateful identity | StatefulSet, only when identity/storage semantics needed |

---

## 8. Golden Path Workload Contract

A Java service can be admitted to production only if it provides:

1. Container image built from approved pipeline.
2. Immutable image reference, preferably digest.
3. `/actuator/health/liveness` endpoint.
4. `/actuator/health/readiness` endpoint.
5. JVM resource envelope.
6. Explicit CPU/memory requests and limits.
7. Structured logs to stdout/stderr.
8. Metrics endpoint or OpenTelemetry metrics.
9. Trace propagation.
10. Graceful shutdown support.
11. Config separation from image.
12. Secret access via approved mechanism.
13. NetworkPolicy requirements.
14. Rollback compatibility statement.
15. Database migration strategy if schema changes are involved.
16. SLO and alerting rules.
17. Ownership labels.
18. Runbook link.

Golden path bukan berarti semua aplikasi identik. Golden path berarti semua workload memenuhi kontrak operasional minimum.

---

## 9. Label and Annotation Contract

Labels digunakan untuk selection, ownership, cost, policy, dan observability.

### 9.1 Recommended Labels

```yaml
metadata:
  labels:
    app.kubernetes.io/name: case-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: regulatory-platform
    app.kubernetes.io/managed-by: argocd
    app.kubernetes.io/version: "1.42.0"
    platform.company.io/environment: prod
    platform.company.io/team: case-team
    platform.company.io/tier: critical
```

### 9.2 Annotations

Annotations untuk metadata non-selector:

```yaml
metadata:
  annotations:
    platform.company.io/runbook: https://internal.example/runbooks/case-api
    platform.company.io/slo: https://internal.example/slo/case-api
    platform.company.io/data-classification: confidential
    platform.company.io/change-ticket: CHG-12345
```

Jangan gunakan annotation sebagai runtime configuration besar. Untuk config, gunakan ConfigMap/Secret/external config system.

---

## 10. ServiceAccount and RBAC Blueprint

Default principle:

```text
Every workload gets its own ServiceAccount.
No workload uses default ServiceAccount.
No app gets cluster-wide permission unless there is a clear controller/operator use case.
```

### 10.1 ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: case-api
  namespace: case-prod
automountServiceAccountToken: false
```

Untuk aplikasi biasa yang tidak perlu memanggil Kubernetes API, disable token mount.

Jika aplikasi butuh akses cloud identity, gunakan workload identity mechanism dari provider, bukan static cloud credential di Secret jika memungkinkan.

### 10.2 RBAC for Read-Only Debugging

Developer production access sebaiknya dibatasi.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-reader
  namespace: case-prod
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "endpoints", "events", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

Avoid giving broad access to:

- `secrets`,
- `pods/exec`,
- `pods/portforward`,
- `deployments/scale`,
- `roles`,
- `rolebindings`,
- `clusterroles`,
- `clusterrolebindings`.

Those are escalation surfaces.

---

## 11. Network Boundary Blueprint

Production namespace should start from default deny.

### 11.1 Default Deny Ingress and Egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: case-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

### 11.2 Allow DNS Egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: case-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

DNS is easy to forget. Many “app cannot connect” incidents start from blocking DNS.

### 11.3 Allow Gateway to API

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-case-api
  namespace: case-prod
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: case-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-prod
      ports:
        - protocol: TCP
          port: 8080
```

### 11.4 Allow App to Managed PostgreSQL

Depending on CNI support, egress to external managed services may use IPBlock, FQDN policy, egress gateway, or provider firewall/security group. Kubernetes native NetworkPolicy does not define FQDN-based policy.

Example with IPBlock:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-postgres-egress
  namespace: case-prod
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: case-api
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 10.20.30.40/32
      ports:
        - protocol: TCP
          port: 5432
```

Do not assume namespace separation equals network isolation.

---

## 12. Java API Deployment Blueprint

This is a baseline, not a universal template.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-api
  namespace: case-prod
  labels:
    app.kubernetes.io/name: case-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: regulatory-platform
    platform.company.io/environment: prod
    platform.company.io/team: case-team
spec:
  replicas: 4
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: case-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: case-api
        app.kubernetes.io/component: api
        platform.company.io/environment: prod
      annotations:
        platform.company.io/runbook: https://internal.example/runbooks/case-api
    spec:
      serviceAccountName: case-api
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 45
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/regulatory/case-api@sha256:REPLACE_WITH_DIGEST
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:InitialRAMPercentage=30
                -XX:+ExitOnOutOfMemoryError
                -Djava.security.egd=file:/dev/urandom
            - name: SPRING_PROFILES_ACTIVE
              value: prod
            - name: SERVER_SHUTDOWN
              value: graceful
          envFrom:
            - configMapRef:
                name: case-api-config
          volumeMounts:
            - name: app-secrets
              mountPath: /var/run/secrets/app
              readOnly: true
            - name: tmp
              mountPath: /tmp
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: "2"
              memory: 2Gi
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
      volumes:
        - name: app-secrets
          projected:
            sources:
              - secret:
                  name: case-api-secret
        - name: tmp
          emptyDir: {}
```

### 12.1 Why These Choices Matter

`maxUnavailable: 0` protects capacity during rollout.

`maxSurge: 1` allows one extra replica to warm up before old pods are removed.

`startupProbe` prevents slow startup from being killed by liveness.

`readinessProbe` controls traffic eligibility.

`livenessProbe` should only catch unrecoverable stuck process conditions.

`terminationGracePeriodSeconds` must cover:

- load balancer drain,
- preStop delay,
- in-flight request completion,
- Spring graceful shutdown,
- telemetry flush.

`readOnlyRootFilesystem` forces explicit writable paths.

`JAVA_TOOL_OPTIONS` makes JVM aware of memory envelope.

Image digest prevents mutable tag surprise.

---

## 13. Service and Routing Blueprint

### 13.1 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-api
  namespace: case-prod
  labels:
    app.kubernetes.io/name: case-api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: case-api
    app.kubernetes.io/component: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

Service selector must match Pod template labels exactly. A Service with no endpoints is not a Service problem; it is often a selector/readiness problem.

### 13.2 Gateway API HTTPRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: case-api
  namespace: case-prod
spec:
  parentRefs:
    - name: public-gateway
      namespace: ingress-prod
  hostnames:
    - api.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /cases
      backendRefs:
        - name: case-api
          port: 80
```

Gateway API better expresses infrastructure/app ownership separation than classic Ingress.

Gateway owner controls:

- GatewayClass,
- Gateway,
- listener,
- TLS policy,
- external exposure.

App team controls:

- HTTPRoute,
- backend Service,
- route-specific behavior allowed by platform.

---

## 14. PodDisruptionBudget Blueprint

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: case-api
  namespace: case-prod
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: case-api
      app.kubernetes.io/component: api
```

PDB protects against voluntary disruption, not all disruption.

It helps during:

- node drain,
- cluster upgrade,
- maintenance,
- autoscaler scale-down.

It does not protect against:

- node crash,
- OOMKilled,
- liveness restart,
- application bug,
- zone outage.

Bad PDB can block operations. Good PDB reflects actual availability math.

---

## 15. HPA Blueprint

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: case-api
  namespace: case-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: case-api
  minReplicas: 4
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
```

For Java HTTP APIs, CPU-only HPA is often insufficient. It should be complemented with:

- latency SLO,
- request rate,
- saturation metrics,
- thread pool metrics,
- downstream error rate,
- connection pool utilization.

HPA should not scale against a metric that the app cannot improve by adding replicas.

Bad metric examples:

- downstream database latency,
- global Kafka lag without partition capacity,
- error rate caused by config bug,
- memory leak.

---

## 16. Worker Deployment Blueprint

Kafka consumer example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: enforcement-consumer
  namespace: workers-prod
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: enforcement-consumer
  template:
    metadata:
      labels:
        app.kubernetes.io/name: enforcement-consumer
        app.kubernetes.io/component: worker
    spec:
      terminationGracePeriodSeconds: 90
      containers:
        - name: app
          image: registry.example.com/regulatory/enforcement-consumer@sha256:REPLACE_WITH_DIGEST
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:+ExitOnOutOfMemoryError
            - name: CONSUMER_GRACEFUL_SHUTDOWN_SECONDS
              value: "75"
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: "2"
              memory: 2Gi
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 15"]
```

Worker readiness should mean:

```text
this worker can safely accept new work
```

During shutdown, worker should:

1. Stop accepting new records/messages.
2. Finish current processing if possible.
3. Commit offset or ack only after durable side effect.
4. Flush telemetry.
5. Exit before termination grace expires.

Failure to do this causes duplicates or lost work. Kubernetes can restart the process; it cannot know message-level correctness.

---

## 17. CronJob Blueprint

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-case-reconciliation
  namespace: workers-prod
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Jakarta"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 3600
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: app
              image: registry.example.com/regulatory/reconciliation@sha256:REPLACE_WITH_DIGEST
              env:
                - name: JOB_NAME
                  value: daily-case-reconciliation
              resources:
                requests:
                  cpu: "1"
                  memory: 2Gi
                limits:
                  cpu: "2"
                  memory: 4Gi
```

CronJob correctness requires application-level idempotency.

Important questions:

- What happens if the job starts twice?
- What happens if it fails halfway?
- What happens if it starts late?
- What happens if previous run is still active?
- What happens if timezone/DST changes matter?
- What is the maximum safe runtime?

---

## 18. Database Migration Strategy

Do not run schema migration inside every application replica startup.

Safer production migration model:

```text
1. Pre-deploy migration job
2. Deploy backward-compatible application
3. Observe
4. Remove old code paths later
5. Apply cleanup migration in separate release
```

Recommended migration pattern:

```text
expand -> deploy -> migrate/backfill -> verify -> contract
```

Example Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: case-api-migration-20260620-001
  namespace: case-prod
spec:
  backoffLimit: 1
  activeDeadlineSeconds: 1800
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/regulatory/case-api-migration@sha256:REPLACE_WITH_DIGEST
          envFrom:
            - secretRef:
                name: case-api-db-secret
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
```

Migration must be:

- idempotent or safely detectable,
- locked if required,
- backward-compatible,
- observable,
- separately rollback-analyzed,
- tested on staging with production-like data volume.

Rollback of app version does not automatically rollback schema. This is one of the most important production invariants.

---

## 19. Config and Secret Strategy

### 19.1 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: case-api-config
  namespace: case-prod
data:
  LOG_LEVEL: INFO
  SERVER_PORT: "8080"
  MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: health,prometheus,info
  SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE: 30s
```

ConfigMap is not a dynamic config system by default. If config changes must be consumed immediately, the app needs reload support or the platform must trigger rollout.

### 19.2 Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: case-api-secret
  namespace: case-prod
type: Opaque
stringData:
  DATABASE_USERNAME: placeholder
  DATABASE_PASSWORD: placeholder
```

In real production, prefer external secret integration. Do not store raw secret values in Git.

Secret consumption pattern:

| Method | Pros | Cons |
|---|---|---|
| env var | simple | not updated until restart, exposed in env dumps |
| mounted file | rotation friendlier | app must reload/read file correctly |
| external secret SDK | dynamic | couples app to provider |
| workload identity | avoids static secrets | provider-specific setup |

---

## 20. Observability Blueprint

### 20.1 Telemetry Required Per Workload

Every production workload should emit:

- structured logs,
- request metrics,
- error metrics,
- latency histogram,
- JVM memory metrics,
- GC metrics,
- thread metrics,
- connection pool metrics,
- dependency metrics,
- trace spans,
- build/version labels,
- readiness/liveness signals.

### 20.2 Kubernetes Signals

Platform must collect:

- Pod phase,
- container restart count,
- OOMKilled count,
- node pressure,
- HPA desired/current replicas,
- Deployment rollout status,
- PDB allowed disruptions,
- Gateway/Ingress error rates,
- NetworkPolicy deny signals if CNI supports it,
- events,
- admission rejection counts,
- API server latency/error rate,
- scheduler pending queue,
- kubelet errors,
- DNS errors.

### 20.3 Golden Dashboard Sections

For each service dashboard:

```text
1. Traffic
   - RPS
   - success/error rate
   - p50/p95/p99 latency

2. Saturation
   - CPU usage vs request/limit
   - memory usage vs limit
   - CPU throttling
   - JVM heap/non-heap
   - thread pool saturation
   - connection pool saturation

3. Kubernetes health
   - replicas desired/available/ready
   - restarts
   - rollout status
   - pod age
   - node distribution

4. Dependencies
   - DB latency/error
   - Redis latency/error
   - Kafka lag/rebalance
   - external API latency/error

5. Release
   - version
   - deployment time
   - canary/stable split
   - error by version
```

### 20.4 Alerting Principles

Alert on user-impacting symptoms first:

- burn rate against SLO,
- high error rate,
- high latency,
- zero ready replicas,
- sustained backlog growth,
- failed scheduled job,
- rollout stuck.

Avoid noisy alerts on isolated low-level signals unless they are actionable.

Bad alert:

```text
CPU > 80% for 5 minutes
```

Better alert:

```text
p99 latency violates SLO and CPU throttling is high
```

---

## 21. Security Baseline

### 21.1 Workload Security Checklist

Each workload should:

- run as non-root,
- drop Linux capabilities,
- disable privilege escalation,
- use RuntimeDefault seccomp,
- avoid hostPath,
- avoid hostNetwork/hostPID/hostIPC,
- use read-only root filesystem where possible,
- use explicit writable volumes,
- avoid default ServiceAccount token,
- avoid broad RBAC,
- use immutable image digest,
- pass image scanning/signing policy,
- avoid secrets in logs/env dumps,
- expose only necessary ports.

### 21.2 Namespace Security

Namespace should enforce Pod Security Standards:

```yaml
metadata:
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

For workloads that cannot meet restricted policy, require:

- documented exception,
- expiration date,
- owner,
- risk acceptance,
- compensating controls.

### 21.3 Supply Chain Security

Minimum requirements:

- CI builds image.
- Image tagged with version and digest.
- Deployment uses digest.
- SBOM generated.
- Vulnerability scan performed.
- Critical vulnerabilities block release unless exception approved.
- Signature/provenance validated by admission if platform supports it.

Mutable tags like `latest` should be banned from production.

---

## 22. GitOps Repository Design

A practical structure:

```text
platform-gitops/
  clusters/
    nonprod/
      apps/
      platform/
    prod/
      apps/
      platform/
  apps/
    case-api/
      base/
        deployment.yaml
        service.yaml
        pdb.yaml
        hpa.yaml
        kustomization.yaml
      overlays/
        dev/
        test/
        staging/
        prod/
    enforcement-api/
    enforcement-consumer/
  platform/
    namespaces/
    policies/
    gateway/
    observability/
```

Promotion options:

| Model | Description | Trade-off |
|---|---|---|
| branch promotion | dev/staging/prod branches | branch drift risk |
| folder promotion | overlays per env | explicit but repetitive |
| image updater | auto PR for image digest | requires guardrails |
| release manifest | generated artifact | strong reproducibility |

For regulated systems, prefer PR-based promotion with evidence:

- image digest,
- test result,
- vulnerability scan,
- migration plan,
- rollback plan,
- approval record,
- observed staging result.

---

## 23. Production Release Flow

Recommended flow:

```text
1. Developer merges application code.
2. CI builds image.
3. CI runs unit/integration/security tests.
4. CI publishes immutable image digest.
5. CI opens GitOps PR changing image digest in dev/test.
6. GitOps reconciles non-prod.
7. Automated tests validate environment.
8. Promotion PR updates staging digest.
9. Migration rehearsal runs in staging if needed.
10. Release approval records risk and rollback plan.
11. Production PR updates prod digest.
12. GitOps reconciles production.
13. Rollout monitored through SLO dashboard.
14. Automated or manual rollback decision if error budget burn spikes.
15. Post-release verification recorded.
```

Important invariant:

```text
The artifact promoted to production should be the same artifact validated in staging.
```

Do not rebuild for production unless there is a strong, auditable reason.

---

## 24. SLO and Reliability Model

Example SLO for `case-api`:

```text
Availability:
  99.9% monthly successful request ratio for non-5xx eligible requests

Latency:
  95% of successful requests under 300ms
  99% under 1000ms

Correctness:
  no confirmed data-loss incident
  no duplicate enforcement action generated by API retry semantics
```

Kubernetes contributes to SLO through:

- replica management,
- rollout control,
- health probes,
- scheduling,
- disruption management,
- autoscaling,
- traffic routing,
- isolation,
- observability.

But SLO also depends on:

- application correctness,
- database performance,
- external dependency reliability,
- message idempotency,
- migration safety,
- operational response.

---

## 25. Capacity Planning

### 25.1 Inputs

Collect:

- baseline RPS,
- peak RPS,
- request CPU cost,
- request memory cost,
- p95/p99 latency,
- JVM heap usage,
- GC behavior,
- startup time,
- dependency latency,
- queue backlog behavior,
- batch schedule windows.

### 25.2 Initial Sizing Example

If one `case-api` pod can handle 100 RPS at acceptable latency with:

```text
CPU request: 500m
Memory request: 1Gi
CPU limit: 2
Memory limit: 2Gi
```

And production peak target is 500 RPS with 40% headroom:

```text
required capacity = 500 * 1.4 = 700 RPS
pods needed = ceil(700 / 100) = 7 pods
```

Set:

```text
minReplicas: 4 or 5 depending on HA requirement
maxReplicas: 20 depending on dependency capacity
```

Do not let HPA scale beyond downstream capacity. Scaling APIs beyond DB connection capacity converts latency into outage.

### 25.3 Node Pool Design

Separate node pools may be used for:

- latency-sensitive APIs,
- worker/batch workloads,
- platform system components,
- spot/preemptible workloads,
- high-memory workloads.

Do not mix critical low-latency services with noisy batch jobs unless resource isolation is strong and measured.

---

## 26. Disaster Recovery Design

### 26.1 RTO/RPO Example

```text
case-api compute plane:
  RTO: 30 minutes
  RPO: N/A, stateless

PostgreSQL data:
  RTO: 60 minutes
  RPO: 5 minutes

Kafka event stream:
  RTO: 60 minutes
  RPO: depends on managed provider replication

Object storage:
  RTO: provider-dependent
  RPO: cross-region replication policy
```

### 26.2 Cluster Rebuild Strategy

Production cluster should be rebuildable from:

- infrastructure as code,
- GitOps repository,
- external secret manager,
- image registry,
- managed service configuration,
- DNS records,
- certificate automation,
- backup/restore procedures.

If a cluster cannot be rebuilt from declared sources, it contains hidden state.

Hidden state examples:

- manual kubectl patch,
- untracked Secret,
- manually created namespace,
- imperative Gateway config,
- one-off RBAC binding,
- hand-installed Helm release.

### 26.3 DR Drill

At least periodically validate:

1. Build new cluster.
2. Bootstrap GitOps.
3. Restore secrets/config references.
4. Deploy platform components.
5. Deploy app workloads.
6. Connect to managed services or restored data service.
7. Switch test traffic.
8. Validate SLO-critical flows.
9. Document gaps.

Backups are not recovery. Recovery is a tested procedure.

---

## 27. Incident Runbook Template

Every critical workload should have a runbook with this structure:

```text
Service: case-api
Owner: case-team
On-call: case-team-primary
Slack/Chat: #case-prod
Dashboard: <link>
Logs: <link>
Traces: <link>
SLO: <link>
GitOps App: <link>
Runbook Version: YYYY-MM-DD

Symptoms:
  - high 5xx
  - high latency
  - zero ready replicas
  - rollout stuck
  - DB connection saturation

First Checks:
  - Deployment available replicas
  - Pod restarts/OOMKilled
  - recent rollout
  - HPA state
  - Gateway/backend status
  - DB dependency health
  - events

Immediate Mitigations:
  - rollback image digest
  - scale replicas within safe limit
  - disable feature flag
  - pause rollout
  - route traffic to previous version
  - reduce worker concurrency

Do Not:
  - delete PVCs
  - delete namespace
  - run migration rollback without data owner approval
  - scale consumers beyond partition/downstream capacity
  - exec into prod pod without incident record

Escalation:
  - platform team for cluster/node/network/admission issues
  - data team for DB/Kafka issues
  - security for secret/cert/access issues

Post-Incident:
  - timeline
  - root cause
  - contributing factors
  - prevention action
  - runbook update
```

---

## 28. Failure-Mode Matrix

| Failure | Symptom | Likely Layer | Detection | Immediate Response | Prevention |
|---|---|---|---|---|---|
| Deployment stuck | unavailable replicas | rollout/probe | Deployment status, events | pause/rollback | staging test, better probes |
| OOMKilled | restarts, exit 137 | resource/JVM | pod status, metrics | raise memory or rollback | JVM sizing, memory alerts |
| CPU throttling | high p99 latency | resource/JVM | throttling metric | adjust limit/request | load test, right sizing |
| Service no endpoints | 503/timeout | readiness/selector | EndpointSlice | fix selector/probe | validation policy |
| DNS blocked | connection failure | network policy | DNS errors | allow DNS egress | default DNS policy template |
| Gateway route wrong | 404/502 | routing | Gateway/Route status | fix route/rollback | route tests |
| Secret rotation failed | auth errors | secret/app reload | app logs, secret age | restart/reload | rotation rehearsal |
| Migration incompatible | app errors after release | data/app | DB errors, rollback fails | feature flag/forward fix | expand-contract |
| HPA oscillation | replica flapping | autoscaling | HPA events | tune behavior | metric design |
| Consumer rebalance storm | lag grows | worker/messaging | Kafka metrics | slow rollout, reduce replicas | rollout strategy |
| PDB blocks drain | upgrade stuck | ops/policy | drain output | adjust PDB temporarily | PDB review |
| Admission webhook down | deploy blocked | policy/control plane | API errors | fail-open/fix webhook | HA webhook, timeout |
| Node pressure eviction | pod evicted | capacity | node condition | reschedule/add nodes | capacity planning |
| Mutable image tag | unexpected version | supply chain | image digest mismatch | pin digest | admission policy |
| RBAC too broad | secret exposure | security | audit logs | revoke/rotate | least privilege |

---

## 29. Platform Readiness Checklist

### 29.1 Cluster Readiness

- [ ] Production cluster is highly available.
- [ ] Node pools are separated by workload class where needed.
- [ ] Cluster upgrade procedure exists.
- [ ] Version skew policy is understood.
- [ ] CNI, CSI, DNS, Gateway, policy, and GitOps add-ons have owners.
- [ ] Cluster backup/restore or rebuild strategy exists.
- [ ] Node drain tested.
- [ ] PDBs validated.
- [ ] Deprecated API scanning exists.

### 29.2 Workload Readiness

- [ ] Each workload has explicit owner.
- [ ] Each workload has ServiceAccount.
- [ ] No workload uses default ServiceAccount unless justified.
- [ ] CPU/memory requests are set.
- [ ] JVM memory behavior is configured.
- [ ] Probes are separated correctly.
- [ ] Graceful shutdown is tested.
- [ ] PDB exists for critical Deployments.
- [ ] HPA exists where needed.
- [ ] Workload has dashboard and alerts.
- [ ] Runbook exists.

### 29.3 Security Readiness

- [ ] Pod Security Admission enforced.
- [ ] Default deny NetworkPolicy applied.
- [ ] Secrets are not stored raw in Git.
- [ ] Image digest pinning enforced.
- [ ] Vulnerability scanning exists.
- [ ] RBAC reviewed.
- [ ] Production exec/port-forward policy exists.
- [ ] Certificate expiry monitored.
- [ ] Break-glass access is audited.

### 29.4 Delivery Readiness

- [ ] GitOps reconciles desired state.
- [ ] Production changes go through PR.
- [ ] Image digest promotion is traceable.
- [ ] Rollback path is documented.
- [ ] Migration strategy exists.
- [ ] Release dashboard exists.
- [ ] Drift detection is enabled.
- [ ] Manual hotfix process is defined.

### 29.5 Observability Readiness

- [ ] Logs are centralized.
- [ ] Metrics are collected.
- [ ] Traces are available for critical flows.
- [ ] Kubernetes events are accessible.
- [ ] SLO burn alerts exist.
- [ ] Dashboards show app + Kubernetes + dependency signals.
- [ ] High-cardinality metrics are controlled.

---

## 30. Design Review Questions

Use these questions before approving a production Kubernetes platform design.

### 30.1 Architecture

- What is inside the cluster?
- What is intentionally outside the cluster?
- Which components are managed by provider?
- Which components are owned by platform team?
- Which components are owned by app team?
- What is the blast radius of a namespace failure?
- What is the blast radius of a node pool failure?
- What is the blast radius of a cluster failure?

### 30.2 Reliability

- What happens during node drain?
- What happens during zone failure?
- What happens when HPA scales up slowly?
- What happens when readiness is false for all pods?
- What happens when a release is semantically bad but Kubernetes rollout succeeds?
- What happens when downstream DB is saturated?
- What happens when Kafka lag grows faster than consumers can process?

### 30.3 Security

- Who can read Secrets?
- Who can exec into Pods?
- Which workloads have Kubernetes API access?
- Are production images immutable?
- Are privileged Pods allowed?
- How are exceptions managed?
- Are audit logs reviewed?

### 30.4 Operations

- Can the cluster be rebuilt?
- Can the app be rolled back?
- Can the DB migration be handled safely?
- Can secrets be rotated without outage?
- Can certificates be renewed automatically?
- Can deprecated APIs be detected before upgrade?
- Can PDBs block maintenance?

### 30.5 Developer Experience

- Can a team onboard a service without becoming Kubernetes expert?
- Does the golden path support APIs, workers, jobs, and CronJobs?
- Are escape hatches documented?
- Are guardrails clear and actionable?
- Is local/staging/prod behavior consistent enough?

---

## 31. Capstone Exercise

Design a Kubernetes platform for this system:

```text
Services:
  case-api
  enforcement-api
  document-api
  audit-api

Workers:
  case-event-consumer
  enforcement-command-consumer
  notification-worker

Batch:
  daily-reconciliation
  monthly-report-generation

Dependencies:
  PostgreSQL
  Kafka
  Redis
  Object storage
  Identity provider

Requirements:
  public API endpoint for selected APIs
  internal-only admin endpoints
  SLO for case-api: 99.9% availability
  zero data-loss tolerance for enforcement commands
  controlled production release
  audit trail for deployment changes
  secret rotation every 90 days
  production cluster upgrade every quarter
```

Produce:

1. Namespace model.
2. ServiceAccount/RBAC model.
3. NetworkPolicy model.
4. Gateway/route model.
5. Deployment manifest skeleton for `case-api`.
6. Worker manifest skeleton for `enforcement-command-consumer`.
7. CronJob manifest skeleton for `daily-reconciliation`.
8. HPA policy for API.
9. Scaling policy for worker.
10. PDBs.
11. Config/secret strategy.
12. GitOps repo layout.
13. Release flow.
14. Migration strategy.
15. Observability dashboard outline.
16. Alert list.
17. DR plan.
18. Failure-mode matrix.
19. Runbook template.
20. Production readiness checklist.

Evaluation criteria:

- Is the design coherent?
- Are ownership boundaries clear?
- Are failure modes acknowledged?
- Are trade-offs explicit?
- Does the design avoid overengineering?
- Does the design avoid under-specifying security/reliability?
- Can the platform be operated by humans under stress?

---

## 32. Common Capstone Mistakes

### Mistake 1: Treating Kubernetes as the architecture

Kubernetes is platform substrate. The architecture is still your service boundary, data flow, failure model, and ownership model.

### Mistake 2: Designing only happy-path YAML

Production design is mostly about bad days:

- failed rollout,
- bad config,
- expired cert,
- node drain,
- dependency outage,
- HPA misbehavior,
- secret leak,
- migration failure.

### Mistake 3: Ignoring Java runtime behavior

Java adds specific concerns:

- heap vs container memory,
- non-heap memory,
- direct buffer,
- thread stack,
- GC pause,
- warmup,
- connection pool,
- graceful shutdown,
- DNS caching.

### Mistake 4: Overusing liveness probes

Liveness is not a general health signal. A bad liveness probe can create restart storms.

### Mistake 5: No migration strategy

Most severe release failures in business systems come from state transition mismatch, not Pod scheduling.

### Mistake 6: Giving CI/CD cluster-admin

Delivery automation is a major security boundary. GitOps plus least privilege is usually safer than broad CI push access.

### Mistake 7: No tested restore

A backup that has never been restored is an assumption, not a recovery capability.

### Mistake 8: HPA without dependency budget

Scaling frontend replicas can overload backend dependencies.

### Mistake 9: Namespace as security boundary

Namespace is useful, but not sufficient for hard isolation.

### Mistake 10: Platform hides too much

A good platform abstracts routine complexity but keeps enough transparency for debugging.

---

## 33. Final Mental Model

A production Kubernetes platform should be understood as:

```text
A declared, policy-governed, observable, continuously reconciled operating environment
for distributed workloads,
where application correctness, runtime behavior, delivery safety, security posture,
and human operations are designed together.
```

The top-level architecture is not:

```text
Developer writes YAML -> Kubernetes runs app
```

It is:

```text
Business requirement
  -> workload classification
  -> runtime contract
  -> deployment strategy
  -> security boundary
  -> network boundary
  -> scaling model
  -> observability model
  -> failure model
  -> GitOps desired state
  -> Kubernetes reconciliation
  -> production operation
  -> feedback into design
```

This is the level where Kubernetes becomes not just a deployment tool, but an operating model.

---

## 34. What “Top 1% Kubernetes Skill” Looks Like

A strong Kubernetes engineer does not merely know object names. They can reason through systems.

They can say:

- This Pod is Pending because scheduling constraints conflict with available topology.
- This Deployment is healthy in Kubernetes but unhealthy semantically because readiness does not check dependency saturation.
- This HPA is amplifying load because the metric is downstream latency, not local saturation.
- This NetworkPolicy blocks DNS because egress deny was applied without CoreDNS exception.
- This rollback is unsafe because schema migration is not backward-compatible.
- This PDB is blocking node upgrade because minAvailable equals replicas.
- This Secret rotation failed because env var-based consumption requires restart.
- This service mesh retry policy multiplies application retries and causes storm.
- This worker rollout causes Kafka rebalance instability because maxUnavailable and termination grace are wrong.
- This platform is not production-ready because it cannot be rebuilt from declared state.

That is the target maturity of this series.

---

## 35. Summary

In this capstone, we designed a production Kubernetes platform for Java distributed systems by combining:

- cluster architecture,
- namespace boundary,
- workload classification,
- ServiceAccount/RBAC,
- Pod security,
- NetworkPolicy,
- Gateway routing,
- Java Deployment blueprint,
- worker and CronJob blueprint,
- HPA and capacity model,
- config/secret strategy,
- GitOps delivery,
- migration safety,
- observability,
- incident runbooks,
- DR planning,
- production readiness checklist,
- failure-mode matrix.

The most important lesson:

```text
Kubernetes can reconcile declared infrastructure state.
Production engineering must also reconcile risk, ownership, correctness, reliability, security, and human operations.
```

---

## 36. Series Completion

This is the final part of the core series.

```text
Series: learn-kubernetes-mastery-for-java-engineers
Completed: yes
Final part: 035 of 035
```

Recommended next learning paths after this series:

1. Kubernetes Operator Development with Java/Go.
2. Advanced Kubernetes Security and Supply Chain Policy.
3. Service Mesh Deep Dive.
4. GitOps at Scale with Argo CD/Flux.
5. Kubernetes Platform Engineering and Internal Developer Platform Design.
6. SRE for Kubernetes-based Distributed Systems.
7. Cloud Provider Kubernetes Deep Dive: EKS/GKE/AKS.
8. eBPF-based Kubernetes Networking and Observability.
9. Production Incident Simulation and Game Day Practice.
10. Multi-Cluster Traffic, DR, and Global Reliability Engineering.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-034.md">⬅️ Part 034 — Advanced Failure Modeling and Production Case Studies</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
