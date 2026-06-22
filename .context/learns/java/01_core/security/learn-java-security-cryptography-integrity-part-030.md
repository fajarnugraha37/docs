# learn-java-security-cryptography-integrity-part-030

# Part 30 — Runtime Hardening: JVM, Container, OS, Network

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `030` dari `034`  
> Status seri: **belum selesai**  
> Topik: Runtime hardening untuk Java services di production: JVM, container, OS, Kubernetes, network, observability, diagnostics, dan operational safety.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- security mental model,
- threat modeling,
- cryptography primitive,
- key management,
- TLS/PKI,
- secure serialization/file/XML/JWT/OAuth,
- authorization,
- input validation,
- secure coding,
- secrets management,
- audit integrity,
- distributed data integrity,
- supply chain,
- signed JAR/classloading,
- secure build dan release integrity.

Sekarang kita masuk ke lapisan runtime:

> Setelah artifact yang benar dibuild dan dideploy, bagaimana memastikan proses Java yang berjalan di production tidak terlalu mudah dibaca, dimodifikasi, dikendalikan, dieksfiltrasi, atau dipakai sebagai pivot attack?

Runtime hardening adalah lapisan terakhir sebelum sistem benar-benar terekspos kepada dunia nyata. Banyak sistem punya source code yang cukup baik, tetapi runtimenya lemah:

- container jalan sebagai `root`,
- filesystem writable seluruhnya,
- JMX terbuka,
- debug port aktif,
- actuator/diagnostic endpoint tidak dibatasi,
- pod punya service account permission terlalu luas,
- egress network bebas,
- metadata service dapat diakses dari aplikasi,
- heap dump berisi secret,
- log dan thread dump mengandung token,
- process bisa di-attach oleh tool lain,
- security flag terlalu longgar,
- container image terlalu besar,
- capability Linux tidak dibatasi,
- dependency native/agent bisa menginstrumentasi runtime,
- dan traffic internal dianggap trusted.

Tujuan part ini adalah membangun kemampuan untuk mendesain **runtime environment yang defensible** untuk Java service.

---

## 1. Mental Model Utama

### 1.1 Runtime adalah Trust Boundary Terakhir

Source code security menjawab:

> “Apakah logic aplikasi benar?”

Supply chain security menjawab:

> “Apakah artifact yang berjalan adalah artifact yang benar?”

Runtime hardening menjawab:

> “Apakah environment tempat artifact berjalan membatasi damage ketika sesuatu gagal?”

Contoh:

```text
User input validation gagal
→ attacker menemukan RCE di library
→ process Java berhasil dieksekusi attacker
→ runtime hardening menentukan apakah attacker:
   - hanya bisa merusak proses itu,
   - bisa membaca secret,
   - bisa menulis file,
   - bisa bergerak ke service lain,
   - bisa mengakses metadata cloud,
   - bisa mengambil token service account,
   - bisa dump memory,
   - bisa pivot ke node/cluster.
```

Runtime hardening tidak mengasumsikan aplikasi sempurna. Ia mengasumsikan:

> “Suatu hari aplikasi, dependency, konfigurasi, atau operator akan salah. Apa pagar pembatasnya?”

---

### 1.2 Security Layer Bukan Saling Menggantikan

Runtime hardening tidak menggantikan secure coding.

Container hardening tidak menggantikan authorization.

NetworkPolicy tidak menggantikan object-level authorization.

TLS tidak menggantikan payload validation.

Least privilege tidak menggantikan audit trail.

Model yang benar:

```text
Secure code
+ secure dependency
+ secure build
+ secure artifact
+ secure runtime
+ secure network
+ secure operation
= defense-in-depth
```

Kalau salah satu layer gagal, layer lain harus tetap mengurangi blast radius.

---

### 1.3 Runtime Hardening Berbasis Blast Radius

Pertanyaan utama bukan:

> “Apakah ini aman?”

Tetapi:

> “Kalau proses Java ini compromise, apa yang bisa dilakukan attacker?”

Evaluasi blast radius:

| Area | Pertanyaan |
|---|---|
| Process | Bisa menjalankan command? Bisa attach? Bisa debug? |
| Memory | Bisa dump heap? Bisa membaca secret/token? |
| File system | Bisa menulis config? Bisa mengganti binary? Bisa menulis webroot? |
| Network | Bisa connect ke database? Redis? metadata? internet? service internal lain? |
| Identity | Token/service account permission apa yang dimiliki? |
| Data | Data mana yang dapat dibaca/diubah? |
| Cluster | Bisa list pod/secret/configmap? Bisa exec ke pod lain? |
| Host | Bisa escape ke node? Bisa mount hostPath? |
| Observability | Log/metric/traces bocor secret? |
| Recovery | Bisa dideteksi? Bisa diisolasi? Bisa dirotasi? |

Runtime hardening adalah seni memperkecil jawaban “bisa”.

---

## 2. Threat Model Runtime Java Service

Bayangkan sebuah Java service berjalan di Kubernetes:

```text
Client
  |
Ingress / ALB / Gateway
  |
Pod: Java Service
  |
  +-- Database
  +-- Redis
  +-- RabbitMQ/Kafka
  +-- Object Storage
  +-- Secret Manager / KMS
  +-- Metadata Service
  +-- Internal APIs
  +-- Observability Backend
```

Threat utama:

1. Remote code execution dari dependency.
2. SSRF dari endpoint yang memanggil URL eksternal.
3. Deserialization exploit.
4. Template injection.
5. Command injection.
6. Credential/secret leakage dari memory/log/env.
7. Misconfigured JMX/debug endpoint.
8. Excessive Kubernetes RBAC.
9. Container escape melalui privileged container/capability/hostPath.
10. Lateral movement via network egress.
11. Data exfiltration via open outbound internet.
12. Tampering runtime via Java agent/attach/instrumentation.
13. Exfiltration diagnostic artifact seperti heap dump.
14. Abuse cloud metadata service.
15. Weak runtime TLS/cert validation.
16. Sensitive actuator/admin endpoint exposure.
17. Over-permissive service-to-service identity.

Tujuan hardening:

```text
Compromise satu process
!= compromise node
!= compromise cluster
!= compromise all secrets
!= compromise database fleet
!= free outbound exfiltration
!= silent long-term persistence
```

---

## 3. Runtime Hardening Taxonomy

Kita akan membagi runtime hardening menjadi beberapa lapisan:

```text
1. JVM hardening
2. Java diagnostic and management hardening
3. Application runtime configuration
4. Container image hardening
5. Container runtime hardening
6. Kubernetes pod hardening
7. Kubernetes RBAC and service account hardening
8. Network hardening
9. Cloud metadata and identity hardening
10. Observability and diagnostics hardening
11. Operational runtime controls
12. Runtime incident response readiness
```

---

# Section A — JVM Hardening

## 4. JVM sebagai Security-Relevant Runtime

JVM bukan hanya executor bytecode. Dalam production, JVM juga:

- mengelola memory,
- membuka management interface,
- memuat class,
- membaca system properties,
- menjalankan agent,
- expose metrics,
- menghasilkan heap/thread dump,
- memakai native library,
- melakukan TLS/crypto,
- mengakses truststore/keystore,
- memproses DNS/proxy,
- dan berjalan dengan OS permission tertentu.

JVM runtime harus diperlakukan sebagai security surface.

---

## 5. Security Manager: Jangan Mengandalkan Model Lama

Historisnya Java punya Security Manager untuk permission sandboxing. Namun dalam Java modern, Security Manager sudah deprecated for removal melalui JEP 411 dan tidak boleh dijadikan fondasi utama untuk runtime isolation aplikasi server modern.

Implikasi engineering:

```text
Jangan desain security runtime dengan asumsi:
"kalau library berbahaya, SecurityManager akan membatasi."
```

Gantinya:

```text
Gunakan OS/container/Kubernetes/cloud IAM boundary:
- non-root user,
- read-only filesystem,
- dropped capabilities,
- seccomp/AppArmor/SELinux,
- RBAC minimal,
- NetworkPolicy,
- IAM least privilege,
- secret manager,
- egress control,
- workload identity,
- runtime monitoring.
```

Security isolation harus berada di layer yang masih aktif dan didukung.

---

## 6. JVM Flags yang Security-Relevant

Tidak semua JVM flag adalah security flag, tetapi beberapa berdampak langsung pada exposure.

### 6.1 Disable/Control Attach Mechanism

Attach mechanism memungkinkan tool seperti `jcmd`, `jmap`, `jstack`, profiler, atau agent melakukan operasi terhadap JVM.

Risiko:

- dump heap,
- inspect thread,
- load agent,
- change diagnostics,
- expose secret di memory,
- runtime instrumentation.

Hardening:

```bash
-XX:+DisableAttachMechanism
```

Gunakan ketika:

- service production tidak membutuhkan dynamic attach,
- observability sudah melalui metrics/log/tracing standar,
- heap dump dilakukan hanya lewat mekanisme controlled crash/diagnostic side channel.

Trade-off:

| Benefit | Cost |
|---|---|
| Mengurangi runtime tampering/dump risk | Sulit melakukan live debugging/profiling |
| Mencegah dynamic agent attach | Incident debugging butuh prosedur lain |
| Membatasi tool lokal | Perlu readiness observability |

Pattern:

```text
Production default:
  Disable attach

Exception:
  Enable attach hanya di controlled diagnostic environment,
  dengan change approval,
  time-bound,
  network/host isolation,
  artifact retention policy.
```

---

### 6.2 Heap Dump on OOM

Flag umum:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Security risk:

Heap dump bisa berisi:

- password,
- token,
- private key,
- session cookie,
- JWT,
- request body,
- PII,
- database credential,
- OAuth refresh token,
- TLS material,
- cached secret,
- business confidential data.

Hardening decision:

| Environment | Recommendation |
|---|---|
| Local/dev | Boleh, dengan sample data |
| Test/UAT | Hati-hati, redaction dan retention |
| Production | Jangan otomatis kecuali dump path aman, encrypted, access-limited, retention pendek |

Better pattern:

```text
Heap dump production hanya:
- saat incident approved,
- disimpan encrypted,
- path bukan public volume,
- access strictly audited,
- automatic deletion,
- secret rotation setelah dump yang sensitif,
- tidak dikirim ke ticket/chat/log bebas.
```

Jika tetap perlu automatic OOM dump:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/secure-dumps
```

Dengan:

```yaml
volumeMounts:
  - name: secure-dumps
    mountPath: /secure-dumps
    readOnly: false
```

Pastikan volume tidak world-readable dan tidak ikut diserve oleh aplikasi.

---

### 6.3 Error File dan Crash Log

Flag:

```bash
-XX:ErrorFile=/var/log/java/hs_err_pid%p.log
```

Risk:

`hs_err_pid` file bisa mengandung:

- environment,
- command line,
- loaded libraries,
- memory maps,
- thread stack,
- native frames,
- system info.

Hardening:

```text
- Simpan ke path controlled.
- Jangan expose via web endpoint.
- Jangan publish mentah ke shared channel.
- Pastikan log collector punya redaction atau restricted routing.
```

---

### 6.4 Temporary Directory

Java memakai temp directory untuk:

- file upload,
- multipart,
- native extraction,
- library temp,
- generated artifacts,
- framework cache,
- report generation.

Default `java.io.tmpdir` sering mengarah ke `/tmp`.

Risk:

- symlink attack,
- temp file leakage,
- predictable file name,
- disk fill,
- cross-process read,
- leftover sensitive data.

Hardening:

```bash
-Djava.io.tmpdir=/app/tmp
```

Dengan container:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /app/tmp
securityContext:
  readOnlyRootFilesystem: true
```

`/app/tmp` harus:

- writable hanya oleh app user,
- tidak shared antar pod tanpa alasan,
- size-limited,
- cleaned on restart,
- tidak digunakan untuk secret persistent.

---

### 6.5 TLS and Crypto Security Properties

JVM runtime ikut menentukan algorithm policy:

```text
jdk.tls.disabledAlgorithms
jdk.certpath.disabledAlgorithms
jdk.jar.disabledAlgorithms
```

Security implication:

- TLS handshake bisa gagal setelah JDK upgrade karena algorithm/cert lama ditolak.
- JAR signing lama bisa dianggap tidak valid.
- Certificate path validation bisa menolak SHA-1/weak key.
- Runtime behavior berubah tanpa code change.

Hardening principle:

```text
Jangan override disabledAlgorithms menjadi lebih lemah demi "biar jalan",
kecuali ada risk acceptance yang explicit, temporary, dan punya sunset date.
```

Production checklist:

```text
[ ] TLS protocol minimum jelas.
[ ] Weak algorithm tidak dire-enable diam-diam.
[ ] Compatibility test dilakukan sebelum JDK upgrade.
[ ] Partner certificate/cipher inventory tersedia.
[ ] Failure mode TLS dimonitor.
```

---

### 6.6 Command Line Arguments Leakage

JVM arguments bisa terlihat via:

```bash
ps aux
/proc/<pid>/cmdline
container runtime metadata
Kubernetes pod spec
process exporter
incident dump
```

Jangan letakkan secret di:

```bash
-Ddb.password=...
-Dapi.key=...
-Xlog:... containing token
```

Lebih aman:

```text
- secret manager,
- mounted file with restrictive permission,
- workload identity,
- short-lived credential,
- env var hanya jika risk accepted dan tidak ada pilihan lebih baik.
```

Env var juga tidak ideal karena bisa bocor di:

- debug endpoint,
- process inspection,
- crash report,
- support bundle,
- actuator env endpoint,
- accidental logging.

---

## 7. JMX Hardening

JMX sering diremehkan karena “hanya monitoring”.

Padahal remote JMX bisa memungkinkan:

- membaca runtime state,
- invoke operation MBean,
- trigger diagnostic,
- expose heap/thread,
- mutate runtime config,
- leak sensitive system properties,
- membuka management plane.

Oracle sendiri menekankan remote monitoring and management membutuhkan security supaya unauthorized party tidak dapat mengontrol atau memonitor aplikasi.

---

### 7.1 Dangerous JMX Anti-Patterns

Anti-pattern:

```bash
-Dcom.sun.management.jmxremote
-Dcom.sun.management.jmxremote.port=9010
-Dcom.sun.management.jmxremote.authenticate=false
-Dcom.sun.management.jmxremote.ssl=false
```

Ini praktis membuka management plane tanpa authentication/transport protection.

Risiko:

```text
Attacker network-accessible to port 9010
→ attach JMX client
→ inspect MBeans
→ invoke dangerous operations
→ exfiltrate runtime details
→ possibly trigger state mutation/DoS
```

---

### 7.2 Safer JMX Pattern

Preferensi modern:

```text
Avoid remote JMX exposure by default.
Use:
- application metrics endpoint with auth/network restriction,
- OpenTelemetry,
- Prometheus exporter behind internal-only boundary,
- sidecar/agent configured safely,
- JFR controlled capture,
- platform observability.
```

Kalau remote JMX benar-benar wajib:

```text
[ ] Bind hanya ke private interface.
[ ] Network allowlist.
[ ] Authentication enabled.
[ ] SSL/TLS enabled.
[ ] Strong password file permission.
[ ] Role minimal: monitor vs control.
[ ] Tidak expose ke internet.
[ ] Tidak expose via shared cluster network.
[ ] Rotasi credential.
[ ] Audit access.
```

Contoh safer direction:

```bash
-Dcom.sun.management.jmxremote=true
-Dcom.sun.management.jmxremote.port=9010
-Dcom.sun.management.jmxremote.authenticate=true
-Dcom.sun.management.jmxremote.ssl=true
-Dcom.sun.management.jmxremote.password.file=/secure/jmxremote.password
-Dcom.sun.management.jmxremote.access.file=/secure/jmxremote.access
```

Pastikan file permission restrictive.

---

## 8. Debug Port Hardening

Java debug wire protocol/JDWP sangat berbahaya jika terbuka di production.

Anti-pattern:

```bash
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

Risiko:

- remote code execution style debugging,
- inspect variables,
- modify execution,
- set breakpoint,
- dump secret,
- alter runtime behavior.

Rule:

```text
JDWP tidak boleh aktif di production.
```

Exception:

```text
Hanya untuk emergency controlled session:
- temporary deployment,
- private isolated network,
- approval,
- time-boxed,
- no public exposure,
- audit,
- redeploy clean image setelah selesai.
```

Safer production diagnostic alternatives:

- structured logs,
- metrics,
- tracing,
- controlled JFR,
- feature flags with audit,
- synthetic reproduction,
- shadow environment,
- sanitized heap dump with approval.

---

## 9. Java Flight Recorder and Profiling

JFR sangat berguna untuk production performance diagnostics. Tetapi tetap punya security implications:

- method names,
- package names,
- thread names,
- exception messages,
- allocation patterns,
- environment hints,
- endpoint names,
- possibly sensitive labels/tags.

Guidance:

```text
[ ] JFR profile tidak mengandung request body/token.
[ ] Access ke JFR artifact dibatasi.
[ ] Retention pendek.
[ ] Upload ke external support harus disanitasi.
[ ] Recording policy jelas.
```

Jangan treat JFR file sebagai harmless.

---

# Section B — Application Runtime Configuration

## 10. Admin/Actuator Endpoint Hardening

Banyak Java service memakai Spring Boot Actuator atau endpoint admin custom.

Risk endpoint:

```text
/env
/configprops
/heapdump
/threaddump
/logfile
/loggers
/metrics
/prometheus
/beans
/mappings
/conditions
/shutdown
```

Failure mode:

```text
Actuator exposed
→ attacker reads env/config
→ obtains secret endpoint/db name/token hint
→ pivots to internal system
```

Hardening:

```text
[ ] Expose minimal endpoint.
[ ] Management port private only.
[ ] Auth required.
[ ] Network allowlist.
[ ] No heapdump/env/logfile publicly exposed.
[ ] Sensitive values sanitized.
[ ] Separate management interface if possible.
[ ] No write-capable endpoint without strong auth and audit.
```

Example Spring Boot direction:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  endpoint:
    env:
      show-values: never
    configprops:
      show-values: never
  server:
    port: 9090
```

But config alone is not enough. Network policy and auth still matter.

---

## 11. Logging Runtime Safety

Runtime logs can leak:

- authorization header,
- cookies,
- JWT,
- password,
- reset token,
- API key,
- session ID,
- private endpoint,
- PII,
- stack trace with payload,
- JDBC URL with credential,
- LDAP bind secret,
- third-party callback token.

Runtime hardening:

```text
[ ] Request/response body logging disabled by default.
[ ] Header allowlist, not blocklist.
[ ] Token redaction.
[ ] Structured logs.
[ ] No secret in MDC.
[ ] No unbounded exception logging with sensitive payload.
[ ] Log access control.
[ ] Log retention policy.
[ ] Correlation ID safe and non-sensitive.
```

Important invariant:

```text
Logs are production data.
Logs are not a safe dumping ground.
```

---

## 12. Error Disclosure

Runtime error page/JSON response must not reveal:

- stack trace,
- class/package names,
- SQL query,
- table/column,
- file path,
- internal host,
- dependency version,
- token parsing details,
- certificate chain details beyond generic error,
- partner endpoint credentials.

Pattern:

```text
External response:
  generic error code + correlation ID

Internal log:
  detailed error + correlation ID + sanitized context
```

Example:

```json
{
  "error": "REQUEST_REJECTED",
  "message": "The request cannot be processed.",
  "correlationId": "01J..."
}
```

Not:

```json
{
  "exception": "java.sql.SQLSyntaxErrorException",
  "sql": "select * from USERS where...",
  "stackTrace": [...]
}
```

---

# Section C — Container Image Hardening

## 13. Container Image Is Part of Runtime Trust

Image berisi:

- base OS,
- package manager,
- shell,
- libc,
- CA certificates,
- timezone data,
- Java runtime,
- app artifact,
- scripts,
- tools,
- native libraries,
- possibly secret if build salah.

Container image harus minimal dan deterministic.

---

## 14. Base Image Strategy

Common options:

| Option | Benefit | Risk/Cost |
|---|---|---|
| Full distro | Debug mudah | Attack surface besar |
| Slim distro | Balance | Masih punya package/shell |
| Distroless | Attack surface kecil | Debug lebih sulit |
| Alpine | Kecil | musl compatibility issue untuk beberapa native libs |
| JRE custom via `jlink` | Minimal modules | Build complexity |

Java service tidak selalu harus distroless, tetapi harus sadar trade-off.

Checklist:

```text
[ ] Base image pinned by digest.
[ ] Image routinely patched.
[ ] Unused package removed.
[ ] No build tools in runtime image.
[ ] No package manager if not needed.
[ ] No curl/wget/nc/bash unless justified.
[ ] CA certs managed.
[ ] Timezone/locale requirement explicit.
[ ] Native library requirement known.
```

Bad:

```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl vim netcat
COPY target/app.jar /app.jar
CMD ["java", "-jar", "/app.jar"]
```

Better direction:

```dockerfile
FROM eclipse-temurin:21-jre@sha256:<digest>

RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app
COPY --chown=app:app target/app.jar /app/app.jar

USER app

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Even better for some services: use a minimal runtime image and avoid shell/tools entirely.

---

## 15. Multi-Stage Build

Bad:

```dockerfile
FROM maven:3-eclipse-temurin-21
COPY . .
RUN mvn package
CMD ["java", "-jar", "target/app.jar"]
```

Problem:

- source code in runtime image,
- Maven cache in runtime,
- build secrets risk,
- tools remain,
- larger attack surface.

Better:

```dockerfile
FROM maven:3-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre@sha256:<digest>
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY --from=build --chown=app:app /src/target/app.jar /app/app.jar
USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Hardening additions:

```text
- run tests in build stage,
- verify dependency checksums,
- generate SBOM,
- sign artifact,
- scan image,
- pin base digest,
- no secret baked into layers.
```

---

## 16. No Secrets in Image Layers

Bad:

```dockerfile
ARG DB_PASSWORD
ENV DB_PASSWORD=$DB_PASSWORD
RUN echo "$PRIVATE_KEY" > /app/private.pem
```

Even if later deleted:

```dockerfile
RUN echo "$SECRET" > secret.txt && rm secret.txt
```

Secret may remain in image layer history.

Rule:

```text
No production secret in Dockerfile, build args, image layers, or image labels.
```

Use runtime injection via secret manager/workload identity.

---

# Section D — Container Runtime Hardening

## 17. Run as Non-Root

Container root is dangerous, even if “root in container is not host root” in many cases. Misconfiguration, volume mount, kernel bug, or excessive capability can turn this into a serious escalation path.

Kubernetes example:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
```

Dockerfile:

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
USER app
```

Checklist:

```text
[ ] App does not require privileged ports <1024.
[ ] Writable paths owned by app user.
[ ] No root-owned runtime write path.
[ ] Container fails if it tries to run as root.
```

---

## 18. Read-Only Root Filesystem

Most Java services do not need to mutate the root filesystem.

Kubernetes:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Then explicitly mount writable dirs:

```yaml
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 512Mi
  - name: logs
    emptyDir:
      sizeLimit: 1Gi

volumeMounts:
  - name: tmp
    mountPath: /app/tmp
  - name: logs
    mountPath: /app/logs
```

JVM config:

```bash
-Djava.io.tmpdir=/app/tmp
```

Benefit:

- attacker cannot persist binary easily,
- app cannot accidentally write config,
- reduces malware staging,
- makes write behavior explicit.

---

## 19. Drop Linux Capabilities

Containers often get default Linux capabilities. Many Java apps need none.

Kubernetes:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

Add only if justified.

Dangerous capabilities include:

| Capability | Risk |
|---|---|
| `SYS_ADMIN` | Almost “god mode”; avoid |
| `NET_ADMIN` | Network manipulation |
| `SYS_PTRACE` | Inspect/attach processes |
| `SYS_MODULE` | Load kernel modules |
| `DAC_READ_SEARCH` | Bypass file read restrictions |
| `CHOWN` | Modify ownership |
| `SETUID`/`SETGID` | Privilege transitions |

Most Java web services:

```text
required capabilities: none
```

---

## 20. No Privileged Container

Never:

```yaml
securityContext:
  privileged: true
```

Unless you are building a node-level system component with strict review.

For business apps:

```text
privileged container = severe design smell
```

---

## 21. No HostPath Unless Absolutely Required

`hostPath` can expose:

- host filesystem,
- container runtime socket,
- kubelet files,
- node credentials,
- logs,
- application data from other pods.

Avoid:

```yaml
volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
```

This is effectively host-level control in many environments.

Rule:

```text
Business Java app should not need hostPath.
```

---

## 22. Seccomp, AppArmor, SELinux

Container runtime hardening can restrict syscalls and OS actions.

Kubernetes seccomp:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

Principle:

```text
Use runtime default profile at minimum.
Use custom profile only after measuring required syscalls.
```

AppArmor/SELinux depend on platform.

Benefit:

- reduce kernel attack surface,
- limit unusual process behavior,
- restrict container escape primitives.

---

## 23. Resource Limits as Security Control

Resource limits are not only reliability controls. They also reduce DoS blast radius.

Kubernetes:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

Security relevance:

- prevent one pod consuming node memory,
- limit fork/CPU abuse,
- reduce attack amplification,
- support scheduling isolation.

Java-specific pitfall:

```text
Container memory limit must align with JVM heap/native memory.
```

If memory limit is 2Gi and heap is 2Gi, you forgot:

- metaspace,
- thread stack,
- direct buffer,
- JIT/code cache,
- GC overhead,
- native libraries,
- TLS buffers,
- off-heap cache.

Better:

```bash
-XX:MaxRAMPercentage=60
```

Then validate empirically.

---

## 24. PID, Process, and Shell Surface

Minimize process surface:

```text
[ ] No shell if not needed.
[ ] No package manager.
[ ] No SSH daemon.
[ ] No cron inside app container unless explicitly designed.
[ ] No debug tools in runtime image.
[ ] No writable binary directories.
```

If attacker gains RCE, absence of shell/tools does not make exploit impossible, but raises cost and reduces convenience.

---

# Section E — Kubernetes Runtime Hardening

## 25. Pod Security Context Baseline

A defensible Java service pod spec should look directionally like this:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/case-service@sha256:<digest>
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:+DisableAttachMechanism
                -Djava.io.tmpdir=/app/tmp
          volumeMounts:
            - name: tmp
              mountPath: /app/tmp
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "2Gi"
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 512Mi
```

Important: `automountServiceAccountToken: false` only works if app does not need Kubernetes API.

If app needs cloud identity, prefer workload identity mechanism rather than Kubernetes API token access unless necessary.

---

## 26. Service Account and RBAC

Default service account is often overused.

Bad:

```yaml
serviceAccountName: default
automountServiceAccountToken: true
```

Better:

```yaml
serviceAccountName: case-service
automountServiceAccountToken: false
```

If app must call Kubernetes API:

```text
[ ] Dedicated service account.
[ ] Minimal Role, not ClusterRole.
[ ] Namespace-scoped if possible.
[ ] No access to secrets unless unavoidable.
[ ] No wildcard verbs/resources.
[ ] No create pod/exec/attach unless absolutely required.
```

Dangerous RBAC:

```yaml
verbs: ["*"]
resources: ["*"]
```

or permissions to:

```text
secrets
pods/exec
pods/attach
pods/portforward
roles
rolebindings
clusterroles
clusterrolebindings
serviceaccounts/token
```

A compromised pod with excessive RBAC can become cluster compromise.

---

## 27. Namespace Isolation

Namespace is not a full security boundary by itself, but useful for policy grouping.

Use namespace to isolate:

- environment,
- team,
- sensitivity,
- internet/intranet zone,
- regulated data zone,
- admin plane.

Controls per namespace:

```text
- NetworkPolicy
- ResourceQuota
- LimitRange
- Pod Security Admission level
- RBAC
- Secret access
- image policy
- admission control
```

---

## 28. Pod Security Admission

Use Pod Security Standards:

- `privileged`
- `baseline`
- `restricted`

For regular Java business apps, target:

```text
restricted
```

Practical requirements:

```text
[ ] runAsNonRoot
[ ] no privileged
[ ] no host namespaces
[ ] drop capabilities
[ ] seccomp RuntimeDefault
[ ] no hostPath or tightly controlled
[ ] allowPrivilegeEscalation false
```

---

## 29. Admission Control

Runtime hardening is stronger when enforced automatically.

Examples:

```text
Reject deployment if:
- image tag is latest,
- image not pinned/signed,
- runAsNonRoot missing,
- privileged true,
- hostPath used,
- capabilities not dropped,
- readOnlyRootFilesystem false,
- service account token mounted unnecessarily,
- no resource limits,
- no NetworkPolicy label,
- forbidden registry,
- missing SBOM/provenance attestation.
```

Tools/concepts:

- OPA Gatekeeper,
- Kyverno,
- Kubernetes ValidatingAdmissionPolicy,
- image policy webhook,
- Sigstore policy,
- SLSA attestation validation.

---

# Section F — Network Hardening

## 30. Network Is Not Trusted Just Because It Is Internal

Common dangerous assumption:

```text
"Service ini internal, jadi aman."
```

Reality:

- SSRF can reach internal services.
- Compromised pod can scan cluster.
- Insider can access private network.
- Misconfigured ingress can expose service.
- Internal DNS names leak topology.
- Legacy service may have weak auth.
- mTLS may be absent or misconfigured.

Correct model:

```text
Internal network reduces exposure.
It does not remove authentication, authorization, validation, or audit requirements.
```

---

## 31. Ingress Hardening

Ingress/API gateway controls:

```text
[ ] TLS termination policy.
[ ] HSTS where relevant.
[ ] Request size limit.
[ ] Header normalization.
[ ] Timeout.
[ ] Rate limiting.
[ ] WAF if appropriate.
[ ] Path routing allowlist.
[ ] No accidental admin path exposure.
[ ] Upstream TLS/mTLS where needed.
[ ] Client IP trust chain validated.
```

Java app must not blindly trust:

```text
X-Forwarded-For
X-Forwarded-Host
X-Forwarded-Proto
X-Real-IP
```

unless gateway boundary is explicit and spoofing blocked.

---

## 32. Egress Hardening

Egress is often more important than ingress after compromise.

Without egress control:

```text
RCE
→ attacker connects to internet
→ downloads tools
→ exfiltrates data
→ connects to C2
→ scans internal services
```

Hardening:

```text
[ ] Default deny egress where feasible.
[ ] Allow only required destinations.
[ ] Separate DB/cache/broker policies.
[ ] Block metadata service unless needed.
[ ] Block direct internet unless justified.
[ ] Force outbound via proxy for inspection.
[ ] DNS egress controlled.
[ ] Monitor unusual destinations.
```

Kubernetes NetworkPolicy example:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: case-service-egress
spec:
  podSelector:
    matchLabels:
      app: case-service
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: database
      ports:
        - protocol: TCP
          port: 1521
    - to:
        - namespaceSelector:
            matchLabels:
              name: redis
      ports:
        - protocol: TCP
          port: 6379
```

Important: NetworkPolicy behavior depends on CNI support.

---

## 33. DNS Hardening

DNS is part of runtime trust.

Risks:

- DNS exfiltration,
- SSRF via DNS rebinding,
- internal host discovery,
- spoofing/misresolution,
- excessive DNS queries causing availability issue,
- metadata service reachable by hostname.

Hardening:

```text
[ ] Restrict egress to DNS resolver.
[ ] Monitor high-cardinality DNS queries.
[ ] Validate resolved IP for outbound allowlist when SSRF-sensitive.
[ ] Do not allow arbitrary user-controlled URL fetch.
[ ] Cache with care.
[ ] Understand JVM DNS cache TTL.
```

Java DNS caching:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

Security trade-off:

| TTL Too Long | TTL Too Short |
|---|---|
| stale IP after failover | DNS amplification/load |
| ignores emergency DNS change | more resolver dependency |
| stale malicious resolution if poisoned | performance cost |

Set intentionally, not accidentally.

---

## 34. Service-to-Service Security

Options:

| Pattern | Notes |
|---|---|
| Network-only trust | Weak; avoid as sole control |
| Static shared secret | Simple, rotation pain |
| mTLS | Strong workload identity if managed well |
| JWT between services | Requires strict validation and key rotation |
| Service mesh identity | Operationally powerful but complex |
| Signed request | Useful for callback/webhook/integrity |
| OAuth2 client credentials | Common enterprise pattern |

Hardening invariant:

```text
Every service call must have:
- caller identity,
- channel integrity,
- authorization decision,
- replay boundary when needed,
- audit correlation.
```

---

# Section G — Cloud Metadata and Workload Identity

## 35. Metadata Service Risk

Cloud metadata service often provides credentials or instance/task identity.

Risk:

```text
SSRF or RCE
→ request metadata endpoint
→ obtain temporary credential
→ access cloud resources
```

AWS example endpoint:

```text
169.254.169.254
```

Hardening:

```text
[ ] Use IMDSv2 where applicable.
[ ] Block metadata access from pods that do not need it.
[ ] Use workload identity / IRSA / pod identity instead of node-wide credentials.
[ ] Scope IAM permissions narrowly.
[ ] Monitor metadata access anomalies.
[ ] Apply hop limit controls where supported.
[ ] Prevent arbitrary URL fetch in app.
```

Important:

```text
Metadata protection is both network hardening and application SSRF prevention.
```

Do not rely on only one.

---

## 36. IAM Least Privilege for Runtime

A Java service identity should be scoped by actual operations.

Bad IAM:

```text
s3:*
kms:*
secretsmanager:*
rds:*
```

Better:

```text
s3:GetObject on specific bucket/prefix
kms:Decrypt on specific key with encryption context condition
secretsmanager:GetSecretValue on specific secret ARN
```

Design questions:

```text
[ ] What resources does this service actually need?
[ ] Read-only or write?
[ ] Which environment?
[ ] Which prefix?
[ ] Which KMS key?
[ ] Which secret?
[ ] Can condition keys narrow access?
[ ] Can credential be short-lived?
[ ] What happens if credential leaks?
```

---

# Section H — Data and Storage Runtime Hardening

## 37. Filesystem Data Safety

Runtime writes must be explicit.

Classify writes:

| Write Type | Example | Security Handling |
|---|---|---|
| Temporary | upload staging | size limit, cleanup |
| Cache | local cache | non-sensitive or encrypted |
| Logs | app logs | redaction, rotation |
| Dumps | heap/thread/crash | restricted, encrypted |
| Generated docs | reports | access control |
| Config | dynamic config | avoid writable runtime config |

Danger:

```text
Writable config path
→ attacker modifies config
→ persistence after restart
```

Readonly root FS helps prevent this.

---

## 38. Database Connection Runtime Hardening

Runtime DB config:

```text
[ ] DB credential least privilege.
[ ] Separate read/write roles if useful.
[ ] No schema-owner for app runtime unless required.
[ ] TLS to DB where supported.
[ ] Connection string not logged.
[ ] Pool metrics do not leak credentials.
[ ] Credential rotation supported.
[ ] SQL tracing sanitized.
```

If app compromise happens, DB permission determines damage.

Avoid:

```text
App user can DROP/ALTER all schemas.
App user can read all tenant data without constraint.
App user owns migration privileges in runtime.
```

Better:

```text
Migration identity != runtime identity.
Runtime identity has minimal DML.
Administrative operations separated.
```

---

## 39. Cache/Broker Runtime Hardening

Redis/RabbitMQ/Kafka are common lateral movement surfaces.

Checklist:

```text
[ ] Authentication enabled.
[ ] TLS if network untrusted.
[ ] ACL per service.
[ ] No shared admin credential.
[ ] No default password.
[ ] No broad topic/queue access.
[ ] Message payload sensitive data minimized/encrypted if needed.
[ ] Dead-letter queue access restricted.
[ ] Management UI not exposed.
```

Runtime compromise of one service should not allow reading all queues/topics.

---

# Section I — Observability and Diagnostics Hardening

## 40. Metrics Safety

Metrics can leak:

- tenant ID,
- user ID,
- email,
- token hash,
- document ID,
- case ID,
- internal endpoint,
- SQL table name,
- partner name,
- business volume.

High-cardinality sensitive labels are dangerous.

Bad:

```text
http_requests_total{user_email="alice@example.com", token="..."}
```

Better:

```text
http_requests_total{route="/applications/{id}", status="200"}
```

Guidance:

```text
[ ] No PII in labels.
[ ] No secrets in labels.
[ ] No unbounded IDs as labels.
[ ] Sensitive business metrics restricted.
[ ] Metrics endpoint private/authenticated.
```

---

## 41. Tracing Safety

Distributed tracing can leak:

- headers,
- JWT,
- request body,
- SQL query,
- path parameters,
- error messages,
- PII.

Hardening:

```text
[ ] Header capture allowlist.
[ ] Body capture disabled.
[ ] Sensitive attributes redacted.
[ ] Trace backend access restricted.
[ ] Retention aligned with data policy.
[ ] Correlation ID non-sensitive.
```

Do not put raw user identifiers into span attributes unless approved.

---

## 42. Thread Dump Safety

Thread dumps may show:

- stack traces,
- method parameters in some cases,
- thread names,
- SQL statements,
- URL with tokens,
- lock ownership,
- internal class names.

Thread dump should be treated as sensitive operational artifact.

Checklist:

```text
[ ] Access controlled.
[ ] Not exposed via unauthenticated actuator.
[ ] Sanitized before sharing externally.
[ ] Retention limited.
```

---

## 43. Heap Dump Safety

Heap dump is extremely sensitive.

Rules:

```text
[ ] Assume heap dump contains all secrets used by the process.
[ ] Encrypt at rest.
[ ] Restrict access.
[ ] Track who downloaded.
[ ] Delete after analysis.
[ ] Rotate exposed secrets if dump leaves controlled boundary.
[ ] Never attach raw heap dump to broad ticket/email/chat.
```

---

# Section J — OS and Node Hardening

## 44. Host and Node Are Part of the Security Boundary

Even in Kubernetes, node hardening matters.

Controls:

```text
[ ] OS patched.
[ ] Container runtime patched.
[ ] Kubelet secured.
[ ] Node IAM minimal.
[ ] No SSH broad access.
[ ] Audit logs enabled.
[ ] Runtime detection.
[ ] Workload isolation by node pool if needed.
[ ] Sensitive workloads tainted/dedicated.
[ ] No untrusted workload co-location if high sensitivity.
```

A pod escape becomes node compromise. A node compromise can become cluster compromise.

---

## 45. Node Pool Isolation

Use separate node pools for:

- internet-facing workloads,
- intranet workloads,
- admin tools,
- batch jobs,
- high-sensitivity data,
- untrusted file processing,
- observability stack,
- stateful components.

Benefits:

```text
- smaller blast radius,
- clearer network policy,
- targeted patching,
- resource isolation,
- easier incident isolation.
```

---

## 46. Untrusted File Processing Isolation

File parsing is risky:

- PDF,
- Office documents,
- ZIP,
- XML,
- image metadata,
- CSV with formulas,
- antivirus scanning,
- OCR,
- archive extraction.

Pattern:

```text
Untrusted file processor:
- separate deployment,
- separate node pool if high risk,
- no DB write privilege except result table,
- no broad network egress,
- read-only root FS,
- strict CPU/memory/time limit,
- temporary storage only,
- no access to core secrets,
- async queue boundary,
- output validated.
```

Do not run risky parser inside core case-management service if avoidable.

---

# Section K — Java Runtime Hardening Patterns

## 47. Pattern: Minimal Production JVM Surface

```text
Goal:
  Run Java service with only capabilities required to serve traffic.

Controls:
  - No JDWP.
  - Remote JMX disabled by default.
  - Attach disabled.
  - Heap dump controlled.
  - Read-only root FS.
  - Non-root user.
  - No unnecessary shell/tools.
  - No secret in command line.
  - Management endpoint private/authenticated.
  - Metrics sanitized.
  - Egress restricted.
```

---

## 48. Pattern: Diagnostic Mode as Separate Runtime

Instead of keeping dangerous diagnostics always enabled:

```text
Normal mode:
  hardened, no debug, no remote JMX, no attach.

Diagnostic mode:
  temporary, isolated, approved, audited, minimal traffic, time-bound.
```

Implementation options:

- replica with special config in isolated namespace,
- blue/green diagnostic deployment,
- ephemeral debug container with restricted policy,
- one-time JFR recording via approved operation,
- controlled heap dump job.

Invariant:

```text
Diagnostics should not permanently weaken production runtime.
```

---

## 49. Pattern: Runtime Write Allowlist

Make writable paths explicit:

```text
/app/tmp
/app/logs
/app/work
```

Everything else readonly.

This enables review:

```text
Why does app need write here?
What data is written?
Is it sensitive?
Who can read it?
What is retention?
What happens on restart?
Can attacker persist here?
```

---

## 50. Pattern: Egress Allowlist by Dependency Map

From architecture dependency matrix:

```text
case-service:
  - oracle-db:1521
  - redis:6379
  - rabbitmq:5672
  - document-service:443
  - secret-manager endpoint
  - telemetry collector
```

Generate NetworkPolicy from this map.

Invariant:

```text
Runtime network should match documented dependencies.
Unknown egress is suspicious.
```

---

## 51. Pattern: Runtime Identity Segmentation

Do not share one identity across many services.

Bad:

```text
all-services-role
```

Better:

```text
case-service-role
appeal-service-role
document-service-role
audit-service-role
```

Then scope each identity.

Benefits:

- easier blast radius analysis,
- easier key/secret rotation,
- better audit,
- stronger accountability.

---

# Section L — Anti-Patterns

## 52. Anti-Pattern: “Internal Endpoint Does Not Need Auth”

Internal endpoint can be reached by:

- SSRF,
- compromised pod,
- mistaken ingress,
- VPN user,
- malware,
- service mesh misconfig,
- old firewall rule.

Correct stance:

```text
Internal exposure lowers risk.
It does not remove auth requirement for sensitive operations.
```

---

## 53. Anti-Pattern: “Container Is Secure Because It Is Containerized”

Container is packaging and process isolation, not magical sandbox.

If you run:

```yaml
privileged: true
runAsUser: 0
hostPath: /
capabilities: ["SYS_ADMIN"]
```

you have destroyed much of the isolation.

---

## 54. Anti-Pattern: “Debug Port Temporarily Opened”

Temporary debug ports often become permanent.

If needed:

```text
[ ] separate diagnostic deployment,
[ ] private network,
[ ] time-box,
[ ] ticket/change ID,
[ ] automatic rollback,
[ ] no production customer traffic if possible.
```

---

## 55. Anti-Pattern: “We Need Root Because Permission Error”

Permission error is not a reason to run root. It is a signal to define writable paths and ownership correctly.

Fix:

```dockerfile
RUN mkdir -p /app/tmp && chown -R app:app /app
USER app
```

Not:

```dockerfile
USER root
```

---

## 56. Anti-Pattern: “Expose Actuator for Convenience”

Convenience endpoint becomes reconnaissance endpoint.

At minimum:

```text
Only health/info/prometheus if needed.
Everything else private, authenticated, or disabled.
```

---

## 57. Anti-Pattern: “NetworkPolicy After Incident”

NetworkPolicy should be derived from dependency model before incident.

Without egress policy, RCE becomes exfiltration.

---

## 58. Anti-Pattern: “Heap Dump Shared to Everyone”

Heap dump often equals full memory compromise.

Treat heap dump like sensitive data export.

---

# Section M — Runtime Hardening Checklist

## 59. JVM Checklist

```text
[ ] No JDWP in production.
[ ] Remote JMX disabled or strongly protected.
[ ] Attach mechanism disabled if not needed.
[ ] Heap dumps controlled and protected.
[ ] Crash logs protected.
[ ] java.io.tmpdir set to controlled writable path.
[ ] No secrets in JVM args.
[ ] TLS/security properties not weakened.
[ ] JDK version supported and patched.
[ ] Unnecessary Java agents removed.
[ ] Production flags reviewed.
```

---

## 60. Application Checklist

```text
[ ] Admin endpoints private/authenticated.
[ ] Actuator exposure minimal.
[ ] Error response sanitized.
[ ] Logs do not contain secrets/PII unnecessarily.
[ ] Metrics labels safe.
[ ] Traces do not capture sensitive headers/body.
[ ] Upload temp storage controlled.
[ ] Runtime config immutable where possible.
[ ] Secret loading does not log values.
```

---

## 61. Container Image Checklist

```text
[ ] Base image pinned by digest.
[ ] Runtime image minimal.
[ ] No build tools in runtime image.
[ ] No package manager unless justified.
[ ] No secrets in image layers.
[ ] App runs as non-root.
[ ] Image scanned.
[ ] SBOM available.
[ ] Artifact verified/signed where applicable.
[ ] CA certs managed.
```

---

## 62. Container Runtime Checklist

```text
[ ] runAsNonRoot true.
[ ] readOnlyRootFilesystem true.
[ ] allowPrivilegeEscalation false.
[ ] capabilities drop ALL.
[ ] seccomp RuntimeDefault.
[ ] privileged false.
[ ] no hostPath unless approved.
[ ] resource requests/limits set.
[ ] writable volumes explicit and size-limited.
```

---

## 63. Kubernetes Checklist

```text
[ ] Dedicated service account.
[ ] automountServiceAccountToken false unless needed.
[ ] Minimal RBAC.
[ ] Pod Security Admission restricted where possible.
[ ] Admission policies enforce hardening.
[ ] Namespace isolation used.
[ ] Secrets access scoped.
[ ] No wildcard RBAC.
[ ] No broad pod exec/attach permissions.
```

---

## 64. Network Checklist

```text
[ ] Ingress paths controlled.
[ ] TLS policy enforced.
[ ] Management port not public.
[ ] Egress default-deny or constrained.
[ ] Metadata endpoint blocked unless needed.
[ ] DNS controlled/monitored.
[ ] Service-to-service auth present.
[ ] Internal calls audited.
[ ] No arbitrary URL fetch without SSRF protection.
```

---

## 65. Cloud Identity Checklist

```text
[ ] Workload identity used where possible.
[ ] IAM policy least privilege.
[ ] No node-wide credential exposure to app.
[ ] KMS/secret permissions scoped.
[ ] Cloud metadata access monitored.
[ ] Credential rotation procedure exists.
```

---

## 66. Diagnostics Checklist

```text
[ ] Heap/thread/JFR artifacts classified sensitive.
[ ] Access restricted.
[ ] Retention defined.
[ ] Sharing procedure defined.
[ ] Secret rotation considered after exposure.
[ ] Diagnostic mode time-boxed.
[ ] Debug/profiling not permanently enabled.
```

---

# Section N — Case Study: Java Regulatory Case Service Runtime Hardening

## 67. Scenario

Service:

```text
case-management-service
```

Responsibilities:

- manage enforcement case lifecycle,
- read/write case records,
- attach evidence metadata,
- call document service,
- publish audit events,
- query profile service,
- expose REST API behind gateway.

Dependencies:

```text
Oracle DB
Redis
RabbitMQ
Document Service
Audit Service
Profile Service
Secret Manager
Telemetry Collector
```

Risk:

- case data is sensitive,
- audit trail must be defensible,
- evidence metadata integrity matters,
- service compromise can alter enforcement state.

---

## 68. Runtime Threat Model

Threats:

```text
1. RCE through dependency.
2. SSRF through callback/import URL.
3. Secret leakage through logs/heap dump.
4. Lateral movement to audit service.
5. Unauthorized DB write.
6. Metadata credential theft.
7. Actuator exposure.
8. Writable filesystem persistence.
9. Debug/JMX abuse.
10. Message broker abuse.
```

---

## 69. Hardened Deployment Sketch

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-management-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-management-service
  template:
    metadata:
      labels:
        app: case-management-service
    spec:
      serviceAccountName: case-management-service
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/case-management-service@sha256:<digest>
          ports:
            - name: http
              containerPort: 8080
            - name: management
              containerPort: 9090
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:+DisableAttachMechanism
                -XX:MaxRAMPercentage=60
                -Djava.io.tmpdir=/app/tmp
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /app/tmp
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "2Gi"
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 512Mi
```

---

## 70. NetworkPolicy Sketch

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: case-management-service-egress
spec:
  podSelector:
    matchLabels:
      app: case-management-service
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              zone: data
          podSelector:
            matchLabels:
              app: oracle-proxy
      ports:
        - protocol: TCP
          port: 1521

    - to:
        - namespaceSelector:
            matchLabels:
              zone: cache
          podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379

    - to:
        - namespaceSelector:
            matchLabels:
              zone: messaging
          podSelector:
            matchLabels:
              app: rabbitmq
      ports:
        - protocol: TCP
          port: 5672

    - to:
        - namespaceSelector:
            matchLabels:
              zone: internal-services
          podSelector:
            matchLabels:
              app: document-service
      ports:
        - protocol: TCP
          port: 443

    - to:
        - namespaceSelector:
            matchLabels:
              zone: observability
          podSelector:
            matchLabels:
              app: otel-collector
      ports:
        - protocol: TCP
          port: 4317
```

Add DNS egress depending on cluster policy.

---

## 71. Runtime Identity

IAM permissions:

```text
case-management-service:
  - read only specific secret: /prod/case-management/db
  - decrypt using KMS key: prod-case-management-key
  - publish to audit topic only
  - read/write specific object prefix only if required
```

Not allowed:

```text
- list all secrets
- decrypt all KMS keys
- read all buckets
- admin broker access
- Kubernetes secret listing
```

---

## 72. Management Endpoint

Spring Boot:

```yaml
management:
  server:
    port: 9090
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  endpoint:
    health:
      probes:
        enabled: true
    env:
      show-values: never
    configprops:
      show-values: never
```

Network:

```text
- port 8080 exposed via service/gateway
- port 9090 only scrapeable by monitoring namespace
- no external route to management port
```

---

## 73. Diagnostics Policy

```text
Normal production:
  - no debug port,
  - no remote JMX,
  - attach disabled,
  - no automatic public heap dump.

Incident:
  - create diagnostic replica,
  - isolate from customer traffic,
  - allow approved JFR/heap dump,
  - store encrypted,
  - rotate secrets if dump leaves boundary,
  - delete after retention.
```

---

## 74. Runtime Invariants

For regulatory case management:

```text
Invariant 1:
  A compromised case-management pod must not be able to read all Kubernetes secrets.

Invariant 2:
  A compromised pod must not be able to call arbitrary internet endpoints.

Invariant 3:
  A compromised pod must not be able to modify its runtime binary/config persistently.

Invariant 4:
  Management endpoints must not be reachable from user-facing network.

Invariant 5:
  Runtime identity must not have schema-owner or migration privileges.

Invariant 6:
  Heap dump/thread dump/JFR artifacts are classified as sensitive.

Invariant 7:
  Audit event publishing permission must not imply audit log modification permission.

Invariant 8:
  File upload temp area must be bounded, isolated, and non-persistent.

Invariant 9:
  Metadata service access must be blocked unless explicitly required.

Invariant 10:
  Production diagnostic weakening must be temporary and auditable.
```

---

# Section O — Review Questions

## 75. Architecture Review Questions

1. If this Java process gets RCE, what can attacker read?
2. What can attacker write?
3. What services can it connect to?
4. What cloud permissions does it have?
5. Can it access metadata credentials?
6. Can it read Kubernetes secrets?
7. Can it exec into other pods?
8. Can it write to root filesystem?
9. Can it persist across restart?
10. Can it dump memory?
11. Can it expose JMX/debug?
12. Can it call arbitrary internet?
13. Can it reach admin/management ports?
14. Can it alter audit trail?
15. Can it use DB migration privileges?
16. Can it access object storage outside required prefix?
17. What diagnostic artifacts contain sensitive data?
18. What happens if logs leak?
19. What runtime controls are enforced automatically?
20. What is the emergency debug procedure?

---

## 76. Pull Request Review Questions

When reviewing deployment manifests:

```text
[ ] Is image pinned?
[ ] Is service account dedicated?
[ ] Is service account token needed?
[ ] Does pod run as non-root?
[ ] Is root filesystem read-only?
[ ] Are capabilities dropped?
[ ] Is privileged false?
[ ] Is hostPath absent?
[ ] Are resource limits set?
[ ] Are management endpoints restricted?
[ ] Is egress constrained?
[ ] Are secrets passed safely?
[ ] Are debug/JMX disabled?
[ ] Is attach mechanism disabled?
[ ] Are heap dumps controlled?
```

---

## 77. Production Readiness Questions

Before go-live:

```text
[ ] Can we prove runtime dependencies?
[ ] Can we prove least privilege?
[ ] Can we detect unusual egress?
[ ] Can we revoke/rotate runtime credentials?
[ ] Can we isolate compromised deployment?
[ ] Can we collect diagnostics safely?
[ ] Can we patch base image quickly?
[ ] Can we reproduce image provenance?
[ ] Can we audit management endpoint access?
[ ] Can we enforce hardening via admission policy?
```

---

# Section P — Practical Hardening Baseline

## 78. Minimum Baseline for Java Business Services

For most Java backend services:

```text
JVM:
  - no JDWP,
  - no unauthenticated remote JMX,
  - disable attach if possible,
  - controlled temp dir,
  - no secrets in args.

Container:
  - non-root,
  - read-only root FS,
  - drop all capabilities,
  - no privileged,
  - no hostPath,
  - resource limits.

Kubernetes:
  - dedicated service account,
  - no automount token unless needed,
  - minimal RBAC,
  - restricted pod security,
  - image pinned.

Network:
  - private management endpoints,
  - constrained egress,
  - metadata blocked unless needed,
  - service-to-service auth.

Diagnostics:
  - heap/thread/JFR protected,
  - no permanent debug mode,
  - incident diagnostic process.
```

---

## 79. Strong Baseline for Sensitive/Regulated Services

Additional controls:

```text
[ ] Distroless/minimal image.
[ ] Signed image verification.
[ ] SBOM and provenance attestation required.
[ ] Runtime detection/EDR.
[ ] Network default deny.
[ ] Dedicated node pool.
[ ] Workload identity with narrow IAM.
[ ] Secret manager with short-lived credentials.
[ ] mTLS/service mesh for internal calls.
[ ] Admission policy enforcement.
[ ] Diagnostic artifact encryption.
[ ] Audit trail for exec/port-forward/debug.
[ ] No broad operator access.
```

---

# Section Q — Common Trade-Offs

## 80. Hardening vs Debuggability

Hardening often makes debugging harder.

Bad response:

```text
Disable hardening permanently.
```

Better response:

```text
Create controlled diagnostic pathway.
```

Example:

| Need | Safer Approach |
|---|---|
| Need heap dump | approved dump to encrypted volume |
| Need profiling | time-boxed JFR |
| Need debug | isolated diagnostic replica |
| Need shell | ephemeral debug container with RBAC/audit |
| Need config inspect | sanitized config endpoint or deployment manifest review |

---

## 81. Minimal Image vs Operational Convenience

Minimal image reduces attack surface but makes emergency debugging harder.

Solution:

```text
- Use minimal runtime image.
- Keep separate debug image/toolbox.
- Debug through controlled ephemeral container.
- Do not ship debugging tools in app image by default.
```

---

## 82. Egress Restriction vs Integration Complexity

Default-deny egress can initially break systems because hidden dependencies surface.

That is good.

It reveals undocumented dependencies such as:

- external API,
- DNS,
- time sync,
- license server,
- telemetry,
- package download,
- OCSP/CRL endpoint,
- partner callback.

Fix by documenting dependency map, not by opening all egress.

---

## 83. Read-Only FS vs Framework Expectations

Some frameworks expect writable dirs.

Fix:

```text
- set java.io.tmpdir,
- configure upload temp dir,
- configure logs to stdout,
- mount explicit emptyDir,
- avoid writing generated config at runtime.
```

---

# Section R — Failure Modes

## 84. Failure Mode: Exposed Debug Port

```text
Cause:
  JDWP enabled for troubleshooting and not removed.

Impact:
  Remote attacker can inspect/modify runtime.

Prevention:
  Policy rejects JDWP flags in production deployment.

Detection:
  Port scan, config scan, admission controller, runtime inventory.

Recovery:
  Remove flag, redeploy, rotate secrets, inspect logs.
```

---

## 85. Failure Mode: Heap Dump Leakage

```text
Cause:
  OOM generated heap dump uploaded to shared ticket.

Impact:
  Secret/session/PII exposure.

Prevention:
  Dump classification, encrypted storage, access control.

Detection:
  DLP scan, ticket attachment monitoring.

Recovery:
  Delete artifact, rotate secrets, assess data exposure.
```

---

## 86. Failure Mode: Metadata Credential Theft

```text
Cause:
  SSRF allows request to metadata endpoint.

Impact:
  Cloud credential compromise.

Prevention:
  SSRF validation, metadata blocking, least privilege IAM, IMDSv2.

Detection:
  CloudTrail unusual API calls, metadata access telemetry.

Recovery:
  Revoke session, rotate role, patch SSRF, restrict network.
```

---

## 87. Failure Mode: Lateral Movement via Open Egress

```text
Cause:
  No NetworkPolicy/default allow.

Impact:
  Compromised service scans and attacks internal network.

Prevention:
  Egress allowlist.

Detection:
  flow logs, DNS anomalies, service mesh telemetry.

Recovery:
  isolate namespace, apply policy, investigate target services.
```

---

## 88. Failure Mode: Container Runs as Root with Writable FS

```text
Cause:
  Dockerfile default root user and no read-only FS.

Impact:
  Easier persistence/tampering.

Prevention:
  non-root user, read-only root, explicit writable volumes.

Detection:
  admission policy, image scan, runtime policy.

Recovery:
  rebuild image, redeploy, inspect writable artifacts.
```

---

## 89. Failure Mode: Excessive Kubernetes RBAC

```text
Cause:
  App service account bound to broad role.

Impact:
  Compromised app can read secrets or control pods.

Prevention:
  minimal RBAC, automount off, namespace-scoped role.

Detection:
  RBAC audit, access logs.

Recovery:
  revoke role, rotate secrets, inspect cluster activity.
```

---

# Section S — Mini Exercises

## 90. Exercise 1 — RCE Blast Radius

Given:

```text
Java app has:
- root container,
- writable root filesystem,
- no egress restriction,
- service account token mounted,
- role can list secrets,
- heapdump actuator exposed internally,
- DB user has schema owner privilege.
```

Question:

```text
If attacker gets RCE, list the top 10 possible actions.
```

Expected reasoning:

```text
1. Read mounted service account token.
2. List Kubernetes secrets.
3. Exfiltrate secrets through internet egress.
4. Dump heap via actuator.
5. Read app secrets from memory.
6. Modify local files.
7. Download tools.
8. Access DB with schema owner.
9. Alter/drop tables.
10. Move laterally to internal services.
```

---

## 91. Exercise 2 — Harden Deployment Manifest

Given a deployment with:

```yaml
securityContext: {}
serviceAccountName: default
containers:
  - image: app:latest
```

Harden it by adding:

```text
- pinned image digest,
- non-root,
- no privilege escalation,
- read-only root,
- drop capabilities,
- seccomp RuntimeDefault,
- resource limits,
- dedicated service account,
- no automount token,
- explicit tmp volume.
```

---

## 92. Exercise 3 — Decide Diagnostic Policy

Given production memory leak:

```text
Need heap dump to diagnose.
```

Design safe process:

```text
1. Create incident/change ticket.
2. Route traffic away or use replica.
3. Capture heap dump to encrypted restricted volume.
4. Limit access to named engineers.
5. Analyze in secure environment.
6. Delete after retention.
7. Rotate secrets if dump exposure risk exists.
8. Record outcome.
```

---

# Section T — Summary

## 93. Key Takeaways

Runtime hardening is not decoration. It is the layer that determines blast radius when application security fails.

The most important mental models:

```text
1. Assume one process can be compromised.
2. Make writable paths explicit.
3. Do not run as root.
4. Drop capabilities.
5. Disable debug/JMX/attach unless needed.
6. Treat diagnostics as sensitive data.
7. Restrict egress.
8. Block metadata access unless required.
9. Use least-privilege runtime identity.
10. Enforce hardening automatically through policy.
```

A hardened Java service should be boring:

```text
It can serve traffic.
It can call only required dependencies.
It can write only to explicit temp paths.
It cannot debug itself publicly.
It cannot read all secrets.
It cannot control the cluster.
It cannot freely exfiltrate data.
It cannot persist by modifying its filesystem.
It can be diagnosed safely through controlled process.
```

---

# References

1. Oracle, *Monitoring and Management Using JMX Technology*.  
   https://docs.oracle.com/en/java/javase/11/management/monitoring-and-management-using-jmx-technology.html

2. Oracle, *Secure Coding Guidelines for Java SE*.  
   https://www.oracle.com/java/technologies/javase/seccodeguide.html

3. Oracle, *Java Security Properties File*.  
   https://docs.oracle.com/en/java/javase/21/security/security-properties-file.html

4. OWASP, *Kubernetes Security Cheat Sheet*.  
   https://cheatsheetseries.owasp.org/cheatsheets/Kubernetes_Security_Cheat_Sheet.html

5. OWASP, *Docker Security Cheat Sheet*.  
   https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html

6. OWASP, *Logging Cheat Sheet*.  
   https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

7. OWASP, *Secrets Management Cheat Sheet*.  
   https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

8. NIST SP 800-190, *Application Container Security Guide*.  
   https://csrc.nist.gov/pubs/sp/800/190/final

9. OpenJDK JEP 411, *Deprecate the Security Manager for Removal*.  
   https://openjdk.org/jeps/411

10. Kubernetes Documentation, *Pod Security Standards*.  
    https://kubernetes.io/docs/concepts/security/pod-security-standards/

11. Kubernetes Documentation, *Security Context*.  
    https://kubernetes.io/docs/tasks/configure-pod-container/security-context/

12. Kubernetes Documentation, *Network Policies*.  
    https://kubernetes.io/docs/concepts/services-networking/network-policies/

13. AWS Documentation, *Use IMDSv2*.  
    https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html

14. AWS EKS Documentation, *IAM roles for service accounts*.  
    https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html

---

# Status Seri

Seri belum selesai.

Progress:

```text
Completed:
- Part 0  — Security Mental Model for Senior Java Engineers
- Part 1  — Java Security Architecture
- Part 2  — Threat Modeling for Java Systems
- Part 3  — Cryptography Mental Model
- Part 4  — Randomness, Entropy, Nonce, Salt, IV, Token
- Part 5  — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
- Part 6  — Password Storage, Password Verification, and Secret-Derived Keys
- Part 7  — Symmetric Encryption in Java
- Part 8  — Message Authentication Code
- Part 9  — Digital Signature
- Part 10 — Asymmetric Encryption and Key Agreement
- Part 11 — Key Management
- Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
- Part 13 — X.509, PKI, Certificate Path Validation, Revocation
- Part 14 — TLS/JSSE Deep Dive
- Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties
- Part 16 — Secure Serialization, Deserialization, and Object Integrity
- Part 17 — Secure File, Archive, and Data Transfer Integrity
- Part 18 — XML Security, XXE, XML Signature, XML Encryption
- Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity
- Part 20 — OAuth2/OIDC Security for Java Systems
- Part 21 — Authorization Integrity
- Part 22 — Input Validation, Canonicalization, Injection Resistance
- Part 23 — Secure Coding in Java
- Part 24 — Secrets Management in Java Applications
- Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
- Part 26 — Data Integrity in Distributed Java Systems
- Part 27 — Supply Chain Security for Java
- Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust
- Part 29 — Secure Build, CI/CD, and Release Integrity for Java
- Part 30 — Runtime Hardening: JVM, Container, OS, Network

Remaining:
- Part 31 — Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST
- Part 32 — Incident Response for Java Security Failures
- Part 33 — Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
- Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-029.md">⬅️ Part 29 — Secure Build, CI/CD, and Release Integrity for Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-031.md">Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST ➡️</a>
</div>
