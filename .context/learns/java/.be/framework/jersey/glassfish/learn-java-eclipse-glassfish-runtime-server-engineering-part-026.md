# learn-java-eclipse-glassfish-runtime-server-engineering-part-026  
# Part 26 — Containerization dan Kubernetes Deployment untuk GlassFish

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 26 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **menjalankan GlassFish secara container-native dan Kubernetes-aware**: image build, domain config, immutable deployment, probes, graceful shutdown, logs, secrets, resources, scaling, dan batas antara GlassFish clustering vs Kubernetes orchestration

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami perbedaan menjalankan GlassFish di VM tradisional vs container/Kubernetes;
2. mendesain Docker image GlassFish yang repeatable, immutable, dan aman;
3. memahami problem mutable domain directory pada GlassFish;
4. menentukan kapan app/deployment/config dibake ke image dan kapan diinject saat runtime;
5. mengelola JVM memory dalam container dengan benar;
6. mendesain Kubernetes probes:
   - startup probe;
   - liveness probe;
   - readiness probe;
7. melakukan graceful shutdown dan traffic draining;
8. mengelola logs GlassFish di container;
9. mengelola ConfigMap, Secret, password alias, dan external secret flow;
10. memahami persistent volume caveat;
11. memahami scaling dan aggregate resource budget;
12. menghindari anti-pattern “traditional mutable app server inside pod”;
13. menyusun Kubernetes Deployment baseline untuk GlassFish.

Part ini tidak mengulang Kubernetes dasar. Fokusnya adalah **bagaimana mental model GlassFish berubah saat masuk container orchestration**.

---

## 1. Mental Model: Dari Mutable Server ke Immutable Runtime Unit

Model tradisional:

```text
VM / bare metal
  |
  |-- install GlassFish
  |-- create domain
  |-- configure via admin console/asadmin
  |-- deploy app
  |-- patch config manually if needed
  |-- server lives long time
```

Model container-native:

```text
Build image
  |
  |-- GlassFish runtime
  |-- domain baseline
  |-- application artifact
  |-- startup script
  v
Immutable image
  |
  v
Kubernetes Deployment creates pods
  |
  v
Pod starts, becomes ready, receives traffic
  |
  v
Pod can be killed/replaced anytime
```

Kunci perubahan:

```text
Traditional GlassFish:
  server is a pet

Containerized GlassFish:
  pod is cattle
```

Tetapi GlassFish lahir dari era app server yang punya domain state, admin console, deployed apps, generated files, logs, dan config mutation. Maka containerisasi GlassFish membutuhkan disiplin ekstra.

---

## 2. GlassFish Domain: Mutable Runtime State

GlassFish domain berisi:

```text
domains/domain1/
  |
  |-- config/
  |     |-- domain.xml
  |     |-- keystore/cacerts/admin-keyfile/keyfile
  |
  |-- applications/
  |-- generated/
  |-- logs/
  |-- osgi-cache/
  |-- imq/
  |-- lib/
```

Dalam VM tradisional, domain directory memang mutable.

Dalam container, pertanyaannya:

```text
Apakah domain directory bagian dari image?
Apakah dibuat saat container start?
Apakah dipasang sebagai volume?
Apa yang terjadi saat pod restart?
Apa yang terjadi saat rolling deployment?
```

Principle:

> Treat GlassFish installation and domain baseline as immutable. Treat logs/temp/generated runtime artifacts as disposable unless intentionally persisted.

---

## 3. Golden Rule Containerizing GlassFish

```text
Do not operate Kubernetes pods like long-lived mutable application servers.
```

Artinya:

- jangan deploy WAR manual ke pod via admin console;
- jangan ubah config manual di pod lalu berharap survive;
- jangan simpan state penting hanya di local domain dir;
- jangan expose admin console sebagai primary operations path;
- jangan ssh/exec into pod sebagai normal release process;
- jangan rely pada hotfix manual.

Gunakan:

- image version;
- Git/IaC config;
- Kubernetes rollout;
- ConfigMap/Secret/external secret;
- logs shipped out;
- health/readiness;
- rolling deployment.

---

## 4. Official/Community Image Considerations

Ada beberapa sumber image GlassFish di ekosistem:

- repository Eclipse EE4J `glassfish.docker`;
- GitHub Container Registry package GlassFish;
- historical Docker Hub official image yang pernah ada tetapi deprecated;
- custom internal image yang dibangun organisasi.

Production recommendation:

```text
Use a maintained source or build your own image from verified GlassFish distribution and JDK base.
Pin versions.
Scan image.
Do not use abandoned/deprecated images blindly.
```

Hal yang harus dipin:

```text
JDK version
GlassFish version
base OS image digest
application artifact version
startup script version
```

Jangan pakai:

```text
latest
```

untuk production.

---

## 5. Image Build Strategy

Ada tiga strategi umum.

### 5.1 Runtime Image + Deploy at Container Start

Image berisi GlassFish saja. WAR/EAR dideploy saat pod start.

```text
image:
  GlassFish runtime

startup:
  download/copy app artifact
  asadmin deploy
  start domain
```

Kelebihan:

- satu image bisa dipakai banyak app;
- artifact bisa dipilih runtime.

Kekurangan:

- startup lambat;
- failure deploy terjadi saat pod start;
- harder reproducibility;
- network dependency saat start;
- rollout kurang deterministic.

---

### 5.2 App Baked into Image

Image berisi GlassFish + app artifact + domain baseline.

```text
image:
  GlassFish runtime
  app.war/ear
  domain config baseline
```

Kelebihan:

- immutable;
- reproducible;
- startup lebih deterministic;
- artifact hash jelas;
- rollback mudah dengan image tag/digest;
- cocok untuk Kubernetes.

Kekurangan:

- image per app/version;
- build pipeline lebih kompleks;
- config separation harus rapi.

Ini biasanya lebih baik untuk production.

---

### 5.3 Domain Built at Image Build Time

Docker build menjalankan `asadmin create-domain`, configure resources, deploy app, lalu image menyimpan domain baseline.

Kelebihan:

- startup cepat;
- config validated at build;
- repeatable.

Kekurangan:

- build-time secret risk;
- environment-specific config bisa bocor ke image;
- jika config berbeda per env, perlu template/overlay.

Best practice:

```text
Build generic domain baseline.
Inject environment-specific non-secret config at runtime.
Inject secrets at runtime.
```

---

## 6. Dockerfile Pattern

Contoh konseptual:

```Dockerfile
FROM eclipse-temurin:21-jre

ARG GLASSFISH_VERSION=8.0.0
ARG APP_FILE=target/app.war

ENV GLASSFISH_HOME=/opt/glassfish \
    PATH=/opt/glassfish/bin:$PATH

RUN useradd --system --create-home --home-dir /opt/glassfish glassfish

# Copy GlassFish distribution from verified build context or download with checksum verification
COPY glassfish-${GLASSFISH_VERSION}.zip /tmp/glassfish.zip

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip ca-certificates curl \
    && unzip /tmp/glassfish.zip -d /opt \
    && mv /opt/glassfish* /opt/glassfish \
    && rm /tmp/glassfish.zip \
    && apt-get purge -y unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=glassfish:glassfish ${APP_FILE} /opt/app/app.war
COPY --chown=glassfish:glassfish docker/start.sh /opt/app/start.sh

RUN chmod +x /opt/app/start.sh \
    && chown -R glassfish:glassfish /opt/glassfish /opt/app

USER glassfish

EXPOSE 8080 4848

ENTRYPOINT ["/opt/app/start.sh"]
```

Catatan:

- sesuaikan path aktual distribusi GlassFish;
- jangan expose 4848 di production Service publik;
- hindari secrets di image;
- lakukan checksum verification jika download saat build;
- gunakan JRE/JDK sesuai kebutuhan runtime/tools.

---

## 7. Startup Script Pattern

Contoh konseptual:

```bash
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-domain1}"
GF_HOME="${GLASSFISH_HOME:-/opt/glassfish}"
APP_FILE="${APP_FILE:-/opt/app/app.war}"

# Optional: apply runtime config from env/config files
# Optional: import certs
# Optional: create password aliases from mounted secrets
# Optional: create/update resources idempotently

asadmin start-domain --verbose=false "$DOMAIN"

# Deploy only if not baked/deployed already
if ! asadmin list-applications | grep -q "app"; then
  asadmin deploy --force=true --contextroot /app "$APP_FILE"
fi

# Keep foreground
tail -F "$GF_HOME/glassfish/domains/$DOMAIN/logs/server.log"
```

Masalah:

- `asadmin start-domain` bisa daemonize;
- container perlu foreground process;
- tailing logs sebagai PID 1 punya signal handling caveat;
- shutdown harus diteruskan ke GlassFish.

Lebih baik gunakan script yang trap signal:

```bash
trap 'asadmin stop-domain "$DOMAIN"; exit 0' TERM INT
asadmin start-domain "$DOMAIN"
tail -F ".../server.log" &
wait $!
```

Production image perlu diuji apakah SIGTERM benar-benar menghentikan domain dengan graceful.

---

## 8. PID 1 dan Signal Handling

Container mengirim SIGTERM saat pod dihentikan.

Jika script PID 1 tidak meneruskan signal:

```text
Kubernetes sends SIGTERM
  |
  startup script ignores or tail keeps running
  |
  GlassFish not gracefully stopped
  |
  after grace period SIGKILL
```

Gunakan:

- proper trap;
- `exec` jika GlassFish foreground mendukung;
- tiny init seperti `tini` bila perlu;
- preStop hook/readiness drain.

Kubernetes default termination grace period adalah 30s kecuali diubah.

GlassFish app dengan request panjang mungkin butuh lebih lama, tetapi jangan terlalu panjang tanpa alasan.

---

## 9. Graceful Shutdown di Kubernetes

Flow ideal:

```text
1. Pod receives termination signal.
2. Readiness becomes DOWN.
3. Service stops routing new traffic.
4. preStop hook optional waits/drains.
5. GlassFish stops accepting new work.
6. In-flight requests complete or timeout.
7. Domain stops.
8. Container exits before grace period.
```

Kubernetes readiness/liveness/startup probe behavior resmi membedakan fungsi: readiness menentukan pod menerima traffic, liveness menentukan restart, startup memberi waktu aplikasi lama start sebelum liveness/readiness efektif.

---

## 10. Kubernetes Probes

### 10.1 Startup Probe

Digunakan untuk aplikasi yang butuh waktu startup lama.

GlassFish EAR besar bisa butuh:

- domain start;
- deployment scan;
- CDI init;
- JPA init;
- resource creation;
- warmup.

Startup probe mencegah liveness membunuh pod terlalu dini.

Example:

```yaml
startupProbe:
  httpGet:
    path: /app/internal/live
    port: 8080
  failureThreshold: 60
  periodSeconds: 5
```

Ini memberi hingga 300s startup window.

---

### 10.2 Liveness Probe

Menjawab:

```text
Apakah container harus direstart?
```

Jangan cek DB/external dependency.

Example:

```yaml
livenessProbe:
  httpGet:
    path: /app/internal/live
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

Jika liveness gagal, Kubernetes restart container.

---

### 10.3 Readiness Probe

Menjawab:

```text
Apakah pod siap menerima traffic?
```

Readiness boleh cek lebih banyak:

- app deployed;
- app initialized;
- critical DB resource available;
- config loaded;
- not draining.

Example:

```yaml
readinessProbe:
  httpGet:
    path: /app/internal/ready
    port: 8080
  periodSeconds: 5
  failureThreshold: 2
```

Jika readiness gagal, pod tidak menerima traffic tetapi tidak otomatis direstart.

---

## 11. Health Endpoint Design

Endpoints:

```text
/app/internal/live
/app/internal/ready
/app/internal/health/deep
```

Recommended:

```text
/live:
  process/app basic response

/ready:
  app initialized + critical local resources

/deep:
  DB/JMS/external dependencies for diagnostics
```

Security:

- internal only;
- not public internet;
- no secrets;
- minimal detail in response;
- protect with network policy/ingress rules if needed.

---

## 12. Logs in Container

Traditional GlassFish writes:

```text
domains/domain1/logs/server.log
```

Kubernetes expects:

```text
stdout/stderr
```

Options:

### Option A — Tail server.log to stdout

Simple but has caveats:

- PID/signal handling;
- log rotation interaction;
- multiline parsing.

### Option B — Configure logging to console/stdout

Cleaner if supported by configuration.

### Option C — Sidecar/agent reads log files

Useful for traditional file logs.

```text
GlassFish writes server.log
Fluent Bit sidecar tails file
Ships to central logging
```

### Option D — Node-level agent tails container logs

Works if logs go stdout/stderr.

Recommendation:

```text
For Kubernetes, prefer stdout/stderr or a well-managed log shipping pattern.
Do not rely on kubectl exec into pod to read logs.
```

---

## 13. Persistent Volume Caveat

Should you mount domain directory as PersistentVolume?

Usually avoid for stateless app pods.

Problems:

- pod replacement can reuse dirty state;
- config drift;
- generated artifacts mismatch;
- locking if multiple pods share volume;
- rollbacks complicated;
- mutable app server anti-pattern.

Use PV only for:

- deliberate persistent data not externalized elsewhere;
- maybe broker data if running broker in pod;
- diagnostics dumps with controlled process;
- special legacy requirement.

For apps, prefer:

```text
application state -> DB/object storage/broker
logs -> centralized logging
config -> ConfigMap/Secret/IaC
deployments -> image
```

---

## 14. Config Injection

Options:

```text
Environment variables
ConfigMap files
mounted config templates
startup script applies asadmin config
baked config in image
external config service
```

GlassFish config often lives in `domain.xml`.

Patterns:

### Pattern A — Baked Domain Config

```text
domain.xml configured at image build
```

Good for stable baseline.

### Pattern B — Template at Runtime

```text
domain.xml.template + envsubst -> domain.xml
```

Risky if not validated.

### Pattern C — `asadmin` Idempotent Startup Config

Startup script runs commands:

```bash
asadmin set ...
asadmin create-jdbc-resource ...
```

Needs idempotency.

### Pattern D — Init Container Generates Config

Init container prepares config/secret into shared emptyDir.

Good separation.

---

## 15. Idempotent Runtime Configuration

If startup script runs every pod start, commands must be idempotent.

Bad:

```bash
asadmin create-jdbc-resource jdbc/appDS
```

fails second time.

Better:

```bash
if ! asadmin list-jdbc-resources | grep -q '^jdbc/appDS$'; then
  asadmin create-jdbc-resource --connectionpoolid appPool jdbc/appDS
fi
```

Or:

```text
delete and recreate in controlled baseline
```

But be careful with runtime state.

---

## 16. Secrets

Never bake secrets into image.

Bad:

```Dockerfile
ENV DB_PASSWORD=prodPassword
COPY prod-domain.xml /opt/glassfish/.../domain.xml
```

Better:

- Kubernetes Secret;
- external secret operator;
- cloud secret manager;
- init container;
- runtime password alias creation;
- mounted files with restricted permissions.

Flow:

```text
External Secret Manager
  |
  v
Kubernetes Secret / mounted file
  |
  v
startup script creates GlassFish password alias
  |
  v
JDBC resource references ${ALIAS=...}
```

Caveat:

- Kubernetes Secrets are base64-encoded by default, not automatically secure without encryption/RBAC;
- use encryption at rest and RBAC;
- avoid printing secrets in logs.

---

## 17. Password Alias in Container

You can create password alias at startup from mounted secret.

Conceptual:

```bash
DB_PASSWORD="$(cat /var/run/secrets/db/password)"

printf "AS_ADMIN_ALIASPASSWORD=%s\n" "$DB_PASSWORD" > /tmp/pwfile
asadmin --passwordfile /tmp/pwfile create-password-alias dbPassword
rm -f /tmp/pwfile
```

Risks:

- password file exposure;
- command history/logging;
- alias store becomes part of domain state;
- pod restart recreates alias;
- domain directory should be writable.

Make sure:

- temp file permission 600;
- no `set -x`;
- no echo secrets;
- cleanup file;
- domain config uses alias.

---

## 18. Keystore and Truststore

Containerized GlassFish still needs certificates/trust.

Options:

- bake public CA/truststore into image;
- mount truststore via Secret/ConfigMap;
- import certs at startup;
- use JVM default truststore;
- terminate TLS at ingress and avoid GlassFish TLS for app port;
- use mTLS to backend if required.

For internal certs:

```bash
keytool -importcert -noprompt \
  -alias internal-ca \
  -file /certs/internal-ca.pem \
  -keystore /path/to/cacerts \
  -storepass changeit
```

Avoid modifying shared base JDK truststore at runtime if possible; use application-specific truststore.

---

## 19. Admin Console in Kubernetes

Production recommendation:

```text
Do not expose Admin Console publicly.
```

Options:

- disable/not expose admin port;
- expose only via port-forward/bastion;
- internal-only Service;
- NetworkPolicy;
- secure admin;
- strong credentials;
- audit.

In Kubernetes, you often do not need admin console for day-to-day deployment if image/Deployment is source of truth.

Admin console mutation creates drift.

---

## 20. Deployment Model in Kubernetes

Preferred:

```text
Build image with app.
Deploy Kubernetes Deployment.
Kubernetes rollout replaces pods.
```

Avoid:

```text
kubectl exec into pod
asadmin deploy app.war
```

because:

- not repeatable;
- pod deletion loses deployment;
- no image version trace;
- rolling deployment broken;
- audit weak.

If emergency hotfix requires manual deploy, treat it as break-glass and follow up with proper image release.

---

## 21. Example Kubernetes Deployment

Conceptual baseline:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-glassfish
spec:
  replicas: 4
  selector:
    matchLabels:
      app: case-glassfish
  template:
    metadata:
      labels:
        app: case-glassfish
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: glassfish
          image: registry.example.com/case-glassfish:1.4.7
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_OPTS
              value: "-Xms2g -Xmx2g -XX:+UseG1GC"
          resources:
            requests:
              cpu: "1"
              memory: "3Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          startupProbe:
            httpGet:
              path: /app/internal/live
              port: http
            failureThreshold: 60
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /app/internal/live
              port: http
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /app/internal/ready
              port: http
            periodSeconds: 5
            failureThreshold: 2
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "/opt/app/drain-and-stop.sh"]
```

Adjust for actual app context and startup behavior.

---

## 22. Service and Ingress

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-glassfish
spec:
  selector:
    app: case-glassfish
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Ingress/ALB/Nginx handles:

- TLS termination;
- host/path routing;
- timeout;
- header forwarding;
- optional sticky session;
- WAF/rate limiting.

Ensure app sees correct:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-For
```

and only trusts them from proxy.

---

## 23. Resource Requests and Limits

Java in containers must account for native memory.

If pod memory limit:

```text
4Gi
```

Do not set:

```text
-Xmx4g
```

Budget:

```text
heap 2g
metaspace 256-512m
direct memory
thread stacks
code cache
GC/native
APM/logging
safety margin
```

Example:

```yaml
resources:
  requests:
    memory: "3Gi"
  limits:
    memory: "4Gi"
```

JVM:

```text
-Xms2g -Xmx2g
-XX:MaxMetaspaceSize=512m
```

Monitor RSS vs heap.

---

## 24. CPU Requests and Limits

CPU limit can cause throttling.

If GlassFish sees latency spikes while CPU not fully used, check:

```text
container_cpu_cfs_throttled_seconds_total
```

For latency-sensitive Java services:

- set realistic CPU request;
- be cautious with strict low CPU limits;
- monitor throttling;
- tune GC for available CPU;
- avoid over-threading.

---

## 25. JVM Container Awareness

Modern JDKs are container-aware. But explicit sizing is often clearer.

Options:

```text
-Xms / -Xmx
-XX:MaxRAMPercentage
-XX:InitialRAMPercentage
```

For stable production:

```text
fixed Xms/Xmx can reduce surprises
```

For variable pod size:

```text
MaxRAMPercentage can help
```

But always leave native headroom.

---

## 26. Horizontal Scaling

Scaling replicas:

```bash
kubectl scale deployment case-glassfish --replicas=6
```

But scaling app replicas multiplies:

```text
DB pool max
JMS consumers
external API calls
scheduled jobs
cache memory
license usage
```

Example:

```text
4 pods × JDBC max 40 = 160 DB connections
6 pods × JDBC max 40 = 240 DB connections
```

Before scaling:

- DB capacity?
- external API rate limit?
- broker capacity?
- singleton jobs?
- session strategy?
- license constraints?

---

## 27. HPA Caveat

Horizontal Pod Autoscaler often uses CPU/memory.

But GlassFish bottlenecks often are:

- JDBC pool wait;
- external API latency;
- JMS backlog;
- DB locks;
- thread pool saturation.

CPU-based HPA may not scale when CPU is low but threads are blocked.

Advanced autoscaling can use custom metrics:

- request rate;
- p95 latency;
- queue depth;
- JMS backlog;
- worker queue;
- CPU plus saturation.

Do not autoscale blindly if downstream dependency is bottleneck.

---

## 28. Rolling Update Strategy

Kubernetes Deployment:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

This keeps capacity during rollout.

But startup time and readiness matter.

If GlassFish takes 3 minutes to start, rollout takes longer. That is fine if safe.

Need:

- startupProbe enough time;
- readiness accurate;
- app version visible;
- rollback tested;
- DB migration compatible.

---

## 29. PodDisruptionBudget

PDB protects availability during voluntary disruptions.

Example:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: case-glassfish-pdb
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: case-glassfish
```

If replicas 4, at least 3 available during node drain.

PDB does not protect against all failures, but helps planned maintenance.

---

## 30. Anti-Affinity and Topology Spread

Avoid all pods on one node.

Use:

- pod anti-affinity;
- topology spread constraints;
- zone spread.

Example concept:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: case-glassfish
```

This improves availability if node/zone fails.

---

## 31. Session Strategy in Kubernetes

Preferred:

```text
stateless app
externalized state
```

If sessionful:

Options:

1. ingress sticky session;
2. session replication;
3. external session store;
4. accept re-login on pod loss.

Kubernetes pods are ephemeral. Local session-only without stickiness means user experience breaks.

Sticky ingress:

- Nginx ingress cookie affinity;
- ALB target group stickiness;
- service mesh/lb policy.

But sticky session complicates scaling and rolling deployment.

---

## 32. Scheduled Jobs in Kubernetes

Do not let every pod run same scheduled job unless intended.

Options:

- Kubernetes CronJob calls an endpoint or runs job container;
- separate worker deployment with one replica;
- leader election;
- DB lock;
- queue-based job distribution.

GlassFish app-level timers can run per pod. Review behavior.

---

## 33. JMS / Worker Deployment Pattern

Separate web and worker deployments:

```text
case-web:
  replicas: 4
  handles HTTP

case-worker:
  replicas: 2
  consumes JMS/batch
```

Benefits:

- independent scaling;
- different resource limits;
- worker failure does not consume web threads;
- easier backpressure.

If same EAR contains both web and MDB, you may need config/feature flag to disable MDB on web pods or split artifact.

---

## 34. Database Migration in Kubernetes Rollout

Do not tie irreversible DB migration blindly to pod start.

Risks:

- multiple pods run migration concurrently;
- migration runs during rollback;
- partial migration;
- old and new app incompatible.

Patterns:

- run migrations as separate Job;
- use Flyway/Liquibase with locking;
- backward-compatible schema migration;
- expand/contract pattern;
- deployment gates.

---

## 35. ConfigMap Rollout

Changing ConfigMap does not always restart pods automatically.

Strategies:

- checksum annotation on pod template;
- rollout restart;
- versioned ConfigMap;
- external reloader controller.

Be clear:

```text
Config change requires pod restart?
Can app reload dynamically?
Is config safe to reload?
```

For GlassFish domain config changes, restart/rebuild is often safer.

---

## 36. Secret Rotation

Secret rotation flow:

```text
1. Update external secret.
2. Kubernetes Secret updated.
3. Pods restarted or app reloads secret.
4. GlassFish password alias/resource refreshed.
5. DB/external old credential revoked after overlap.
```

If secret mounted as file, update may appear in pod, but GlassFish resource may not automatically use it until alias/pool refreshed/restarted.

Plan overlap.

---

## 37. Image Security

Checklist:

```text
pin base image
pin GlassFish version
verify checksum
scan vulnerabilities
remove build tools
run as non-root
minimal packages
no secrets
SBOM
sign image if possible
read-only root filesystem if feasible
drop Linux capabilities
```

GlassFish may need writable directories for domain logs/generated/cache. If root FS read-only, mount writable `emptyDir` for needed paths.

---

## 38. Running as Non-Root

Dockerfile:

```Dockerfile
RUN useradd --system --create-home --home-dir /opt/glassfish glassfish
USER glassfish
```

Kubernetes:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
```

Ensure:

- domain directory writable by user;
- ports >1024 unless capability granted;
- mounted volumes permissions correct.

---

## 39. Read-Only Root Filesystem

If enabling:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

GlassFish needs writable dirs:

- logs;
- generated;
- osgi-cache;
- temp;
- maybe domain config if runtime modifies.

Mount:

```yaml
volumeMounts:
  - name: gf-tmp
    mountPath: /tmp
  - name: gf-logs
    mountPath: /opt/glassfish/glassfish/domains/domain1/logs
  - name: gf-generated
    mountPath: /opt/glassfish/glassfish/domains/domain1/generated
```

Test carefully.

---

## 40. File Upload / Temp Files

Container filesystem is ephemeral.

For uploads:

- stream to object storage;
- use temp file with size limit;
- mount emptyDir with sizeLimit;
- clean temp files;
- avoid storing durable files in pod.

Example:

```yaml
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 2Gi
```

If upload temp fills disk, pod can fail.

---

## 41. Diagnostics in Kubernetes

When incident occurs:

```bash
kubectl logs pod
kubectl describe pod
kubectl top pod
kubectl exec pod -- jcmd 1 Thread.print
kubectl cp pod:/secure/heap.hprof ./heap.hprof
kubectl get events
```

But:

- PID may not be 1 depending startup script;
- container may not include JDK tools if using JRE;
- heap dump may be huge;
- pod may restart before evidence collected.

Consider including diagnostic tools in internal production image or using ephemeral debug containers if policy allows.

---

## 42. JRE vs JDK Image

JRE image smaller, but lacks tools:

- `jcmd`;
- `jstack`;
- `jmap`;
- `jfr`;
- `jcmd` diagnostics.

For production support, JDK runtime image can be acceptable despite larger size.

Alternative:

- JRE app image + ephemeral debug container with tools;
- custom minimal JDK image;
- include only needed tools.

Top-level trade-off:

```text
Smaller image vs diagnosability.
```

For enterprise production, diagnosability often wins.

---

## 43. Observability in Kubernetes

Collect:

```text
container CPU/memory/restart/OOMKilled
JVM heap/GC/thread
GlassFish HTTP/thread/JDBC/JMS metrics
access logs
server logs
application logs
readiness/liveness status
pod events
deployment version
node/zone
```

Labels:

```text
app
version
pod
namespace
cluster
environment
instance
```

Avoid labels:

```text
userId
caseId
requestId
sessionId
```

---

## 44. Admin Port Exposure

Do not create Service for admin port unless needed.

If needed:

```yaml
kind: Service
metadata:
  name: glassfish-admin-internal
spec:
  type: ClusterIP
```

Then restrict with:

- NetworkPolicy;
- namespace isolation;
- RBAC;
- port-forward;
- bastion;
- secure admin.

Never expose admin console via public Ingress without strong controls.

---

## 45. Network Policy

Restrict traffic:

```text
Ingress:
  only from ingress controller / internal callers

Egress:
  DB
  JMS broker
  LDAP/IAM
  required external APIs
  DNS
```

NetworkPolicy example concept:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: case-glassfish-policy
spec:
  podSelector:
    matchLabels:
      app: case-glassfish
  policyTypes:
    - Ingress
    - Egress
```

Exact rules depend cluster CNI.

---

## 46. GlassFish Cluster vs Kubernetes Replicas

Traditional:

```text
GlassFish cluster:
  DAS knows instances
  cluster-targeted deploy/resources
```

Kubernetes:

```text
Deployment replicas:
  each pod is independent instance
  Kubernetes routes/restarts/scales
```

In Kubernetes, you often run:

```text
one standalone GlassFish domain/server per pod
```

and let Kubernetes handle:

- replica count;
- rollout;
- restart;
- service discovery;
- load balancing;
- scheduling.

Avoid mixing two control planes unless intentionally designed.

---

## 47. Stateful GlassFish Features in Kubernetes

Features that need special care:

- local HTTP session;
- stateful EJB;
- persistent EJB timers;
- embedded JMS broker;
- local file storage;
- DAS-managed cluster state;
- admin console changes;
- local generated artifacts.

For Kubernetes:

```text
externalize durable state
make pods replaceable
make startup repeatable
make shutdown graceful
```

---

## 48. Embedded Broker Caveat

If using embedded OpenMQ/broker inside GlassFish pod:

- pod restart loses local broker state unless persisted;
- scaling creates multiple brokers;
- routing/HA complex;
- message durability risk.

For production Kubernetes, prefer external broker deployment/service with its own HA/storage model unless you fully understand embedded broker behavior.

---

## 49. Example Production Topology

```text
Ingress / ALB / Nginx
  |
  v
Kubernetes Service case-web
  |
  |-- Pod case-web-1: GlassFish + app
  |-- Pod case-web-2: GlassFish + app
  |-- Pod case-web-3: GlassFish + app
  |-- Pod case-web-4: GlassFish + app
  |
  +--> Oracle RDS / DB Service
  +--> OpenMQ/Rabbit/Kafka/etc.
  +--> Redis/cache if needed
  +--> external APIs via egress
  +--> centralized logging/metrics
```

GlassFish admin port not exposed publicly.

App state:

```text
DB/object storage/broker/cache
```

not local pod.

---

## 50. Anti-Patterns

### Anti-pattern 1 — Mutable Pod Admin Deploy

```text
kubectl exec -> asadmin deploy
```

Lost on restart, not reproducible.

### Anti-pattern 2 — Secrets in Image

```text
COPY prod-domain.xml with DB password
```

Critical leak.

### Anti-pattern 3 — Liveness Checks DB

DB outage triggers restart storm.

### Anti-pattern 4 — `latest` Image

Rollout not reproducible.

### Anti-pattern 5 — Xmx Equals Container Limit

Causes OOMKilled due to native overhead.

### Anti-pattern 6 — Persistent Domain Volume for Everything

Creates drift and dirty state.

### Anti-pattern 7 — Admin Console Public

Severe security risk.

### Anti-pattern 8 — Scaling Pods Without DB/API Budget

Multiplies connections/calls and breaks dependencies.

### Anti-pattern 9 — All Pods on One Node

Node failure takes out service.

### Anti-pattern 10 — No Graceful Shutdown

Rolling deploy causes user-facing 502/503.

---

## 51. Production Checklist

```text
[Image]
- pinned JDK
- pinned GlassFish
- pinned app version
- no secrets
- vulnerability scanned
- runs non-root
- diagnostic strategy decided

[Config]
- domain baseline immutable
- environment config via ConfigMap/Secret
- idempotent startup if needed
- no manual admin drift

[Secrets]
- external secret source
- Kubernetes Secret secured
- no logging secrets
- rotation process tested

[Runtime]
- proper Xmx/native budget
- CPU/memory requests/limits
- GC logs/metrics
- writable dirs known

[Probes]
- startup probe for slow start
- liveness simple
- readiness meaningful
- deep health separate

[Shutdown]
- SIGTERM handled
- readiness drops before stop
- preStop/drain if needed
- terminationGracePeriod sufficient

[Networking]
- service/ingress configured
- admin port internal only or disabled
- forwarded headers handled
- network policy if available

[Scaling]
- replica count with HA headroom
- DB pool aggregate checked
- JMS/external API aggregate checked
- scheduled jobs coordinated

[Observability]
- logs shipped
- metrics scraped
- pod events monitored
- app version visible
- runbooks exist
```

---

## 52. Mini Exercise

Design Kubernetes deployment for this GlassFish app:

```text
GlassFish 8
Java 21
App: regulatory-case.war
Replicas: 4
Container memory limit: 6Gi
Oracle DB
External API rate limit: 300/min
JMS worker inside same app currently
HTTP session used for small UI state
Startup time: 120s
```

Answer:

1. What image strategy do you choose?
2. What Xmx do you start with?
3. What startup/liveness/readiness probes?
4. How do you expose admin console?
5. How do you handle logs?
6. How do you inject DB secret?
7. How do you avoid multiplying external API calls beyond 300/min?
8. How do you handle JMS worker scaling?
9. Sticky session or stateless migration?
10. What rolling update strategy?

---

## 53. Top 1% Takeaways

1. **Containerized GlassFish should be immutable and replaceable.**
2. **Do not operate pods like mutable app servers.**
3. **Domain config is the main tension between GlassFish and containers.**
4. **Bake app/runtime into image; inject environment config/secrets safely.**
5. **Probes must separate startup, liveness, readiness, and deep health.**
6. **Graceful shutdown requires readiness drain and SIGTERM handling.**
7. **Xmx must leave native/container headroom.**
8. **Scaling replicas multiplies DB connections, JMS consumers, and API calls.**
9. **Admin console should not be public or normal deployment path.**
10. **Kubernetes often replaces GlassFish cluster control plane for scaling/rollout.**

---

## 54. Referensi

Referensi utama:

- Eclipse GlassFish Deployment Planning Guide, Release 8  
  https://glassfish.org/docs/latest/deployment-planning-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse EE4J GlassFish Docker repository  
  https://github.com/eclipse-ee4j/glassfish.docker

- Eclipse EE4J GlassFish repository  
  https://github.com/eclipse-ee4j/glassfish

- Kubernetes — Configure Liveness, Readiness and Startup Probes  
  https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

- Kubernetes — Liveness, Readiness, and Startup Probes Concepts  
  https://kubernetes.io/docs/concepts/workloads/pods/probes/

---

## 55. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 27 — CI/CD, Release Engineering, dan Safe Deployment Pipeline
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-025.md">⬅️ Part 25 — Clustering, Load Balancing, Session Replication, dan High Availability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-027.md">Part 27 — CI/CD, Release Engineering, dan Safe Deployment Pipeline ➡️</a>
</div>
