# learn-java-deployment-runtime-release-delivery-engineering

## Part 25 — Deployment Security Hardening

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Scope: Java 8 sampai Java 25  
> Fokus: deployment/runtime hardening, bukan application security umum  
> Tujuan: mampu men-deploy Java application dengan posture production yang defensible, least-privilege, observable, dan tetap operable.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas:

- artifact dan runtime;
- container image;
- Kubernetes deployment;
- probes, graceful shutdown, dan traffic draining;
- resource sizing;
- release strategy;
- database-aware deployment;
- stateful deployment;
- secret/certificate rotation;
- observability-ready deployment;
- deployment verification;
- CI/CD pipeline;
- supply chain security.

Sekarang kita masuk ke satu pertanyaan yang berbeda:

> Setelah artifact valid, image benar, config benar, pipeline aman, dan deployment bisa diverifikasi, bagaimana memastikan runtime Java tidak berjalan dengan privilege, exposure, atau debug surface yang terlalu besar?

Itulah deployment security hardening.

Security hardening dalam konteks ini bukan membahas SQL injection, XSS, CSRF, cryptography, atau authorization logic. Itu application security. Di sini kita membahas **runtime posture**:

- siapa user yang menjalankan proses Java;
- filesystem mana yang boleh ditulis;
- Linux capability apa yang tersedia;
- apakah container bisa privilege escalation;
- apakah debug/JMX/Actuator terbuka;
- apakah JVM attach boleh dipakai;
- apakah secret bisa bocor lewat environment/log/endpoint;
- apakah pod bisa mengakses jaringan yang tidak perlu;
- apakah production debugging punya policy yang aman;
- apakah hardening tetap mempertahankan operability.

Top engineer tidak hanya bertanya:

> “Apakah aplikasi berjalan?”

Tapi juga:

> “Dengan privilege minimum apa aplikasi ini tetap bisa berjalan, diobservasi, di-recover, dan di-debug secara terkendali?”

---

## 1. Core Mental Model: Hardening Is Reducing Runtime Blast Radius

Deployment security hardening adalah proses mengurangi blast radius saat sesuatu salah.

Sesuatu bisa salah karena:

- dependency memiliki CVE;
- endpoint internal tidak sengaja terekspos;
- credential bocor;
- attacker mendapat remote code execution;
- developer salah konfigurasi debug mode;
- container image membawa shell/tooling berlebihan;
- service account terlalu powerful;
- pod bisa melakukan outbound ke mana saja;
- filesystem writable sehingga malware/dropper bisa bertahan;
- JVM attach/JMX bisa dipakai oleh proses lain;
- Actuator endpoint menampilkan environment/heap/thread/loggers terlalu luas;
- pod berjalan sebagai root;
- container memiliki Linux capabilities yang tidak dibutuhkan.

Hardening tidak membuat bug hilang. Hardening membuat bug lebih sulit berubah menjadi compromise besar.

Mental modelnya:

```text
Application bug or misconfiguration
        |
        v
Can attacker gain code execution?
        |
        v
If yes, what can that process do?
        |
        +--> Read secrets?
        +--> Write filesystem?
        +--> Spawn tools?
        +--> Attach JVM?
        +--> Open debug port?
        +--> Call internal services?
        +--> Reach database?
        +--> Modify host/kernel?
        +--> Exfiltrate data?
        +--> Persist after restart?
```

Hardening menjawab rantai ini dengan prinsip:

```text
Deny by default.
Permit only what the Java process needs.
Make exceptions explicit.
Make debug access temporary and audited.
```

---

## 2. Deployment Hardening vs Application Security vs Supply Chain Security

Ketiganya sering bercampur, tapi berbeda.

| Area | Pertanyaan Utama | Contoh |
|---|---|---|
| Application security | Apakah logic aplikasi aman? | authz, input validation, CSRF, SQL injection |
| Supply chain security | Apakah artifact yang dideploy trusted? | SBOM, signing, provenance, CVE scanning |
| Deployment hardening | Apakah runtime berjalan dengan privilege/exposure minimum? | non-root, read-only filesystem, NetworkPolicy, Actuator exposure |

Ketiganya saling melengkapi.

Supply chain security menjawab:

> “Apakah yang kita deploy berasal dari sumber yang benar?”

Application security menjawab:

> “Apakah aplikasi berperilaku aman terhadap input dan user?”

Deployment hardening menjawab:

> “Kalau aplikasi atau dependency gagal, seberapa jauh kerusakannya bisa menyebar?”

---

## 3. Golden Rule: Secure by Default, Operable by Exception

Hardening yang buruk biasanya ekstrem di salah satu sisi:

1. Terlalu longgar:
   - semua pod root;
   - semua endpoint internal exposed;
   - all egress allowed;
   - debug port tersedia;
   - secret di environment dan log;
   - filesystem writable penuh.

2. Terlalu ketat tapi tidak operable:
   - tidak bisa write `/tmp`;
   - tidak bisa dump saat incident;
   - readiness gagal karena actuator diblokir;
   - TLS truststore tidak bisa update;
   - GC log path read-only;
   - app crash tetapi tidak ada diagnostic evidence.

Prinsip yang sehat:

```text
Production default: hardened.
Operational exception: explicit, temporary, observable, reversible.
```

Contoh:

- default JVM attach disabled untuk service high-security;
- saat incident, gunakan ephemeral debug container atau redeploy debug profile dengan approval;
- default root filesystem read-only;
- writable volume hanya untuk `/tmp`, logs jika file-based, dan dump directory jika diperlukan;
- default Actuator hanya health/prometheus internal;
- endpoint sensitif membutuhkan auth, network isolation, dan audit.

---

## 4. Threat Model Khusus Deployment Java

Sebelum memilih control, pahami ancaman yang khas pada Java deployment.

### 4.1 Remote Code Execution Menjadi Runtime Escape

Java ecosystem kaya dengan reflection, serialization, expression language, template engine, logging framework, deserialization library, dan dependency chain. Saat ada RCE, attacker menjalankan kode di dalam proses Java.

Jika proses Java:

- berjalan sebagai root;
- filesystem writable;
- memiliki shell/curl/nc;
- bisa outbound bebas;
- punya service account/token luas;
- bisa membaca semua secret;
- punya debug/JMX/attach terbuka;

maka RCE dapat berubah dari “bug aplikasi” menjadi compromise environment.

### 4.2 Management Endpoint Exposure

Java enterprise apps sering punya endpoint operasional:

- Spring Boot Actuator;
- JMX;
- Jolokia;
- admin console app server;
- health/detail endpoint;
- metrics endpoint;
- log level endpoint;
- heap dump/thread dump endpoint;
- config/env endpoint.

Endpoint ini berguna untuk operasi, tetapi berbahaya jika salah expose.

### 4.3 Secret Leakage

Secret bisa bocor dari:

- environment variables;
- command line arguments;
- system properties;
- logs;
- `/actuator/env`;
- exception message;
- heap dump;
- thread dump;
- mounted secret files;
- debug session;
- crash dump;
- CI/CD logs;
- Kubernetes describe output;
- process table di VM.

### 4.4 Excessive Network Reachability

Aplikasi Java biasanya punya banyak dependency:

- database;
- Redis;
- RabbitMQ/Kafka;
- identity provider;
- external API;
- SMTP;
- object storage;
- internal microservices.

Tanpa network restriction, satu service yang compromised bisa melakukan lateral movement.

### 4.5 Production Debug Surface

Debug tools berguna, tapi bisa menjadi attack surface:

- JDWP remote debugging;
- JMX remote;
- Java Attach API;
- dynamic agent loading;
- heap dump endpoint;
- thread dump endpoint;
- actuator loggers endpoint;
- admin CLI exposed inside image;
- shell dalam production image.

Top engineer tidak melarang semua debugging. Ia mendesain debugging yang terkendali.

---

## 5. Hardening Layer Model

Deployment hardening sebaiknya dilihat sebagai lapisan.

```text
+-------------------------------------------------------------+
| Governance / Policy / Exception Management                  |
+-------------------------------------------------------------+
| CI/CD Policy Gates / Admission Control / Image Policy        |
+-------------------------------------------------------------+
| Kubernetes / Orchestrator Controls                          |
| SecurityContext, NetworkPolicy, ServiceAccount, RBAC        |
+-------------------------------------------------------------+
| Container Runtime Controls                                  |
| non-root, read-only FS, capabilities, seccomp, AppArmor     |
+-------------------------------------------------------------+
| OS / VM Controls                                            |
| users, permissions, systemd sandboxing, filesystem layout    |
+-------------------------------------------------------------+
| JVM Runtime Controls                                        |
| attach, JMX, debug, dumps, flags, keystore, logging         |
+-------------------------------------------------------------+
| Application Operational Surface                             |
| actuator, admin endpoints, management ports, health details |
+-------------------------------------------------------------+
```

Tidak semua environment memiliki semua layer. VM deployment tidak punya Kubernetes SecurityContext. Kubernetes deployment mungkin tidak punya systemd. Tapi konsepnya sama: **batasi privilege pada layer terdekat yang bisa enforce**.

---

## 6. Running Java as Non-Root

### 6.1 Kenapa Non-Root Penting

Root di container bukan selalu root penuh di host, tetapi tetap privilege besar di namespace container. Jika container breakout atau misconfiguration terjadi, root memperbesar risiko.

Untuk Java app, hampir tidak pernah ada alasan proses aplikasi utama berjalan sebagai root.

Aplikasi Java biasanya hanya perlu:

- membaca artifact;
- membaca config;
- membuka port non-privileged seperti 8080;
- menulis `/tmp` atau direktori dump/log tertentu;
- membuka koneksi outbound;
- membaca truststore/keystore;
- membaca mounted secret.

Semua itu bisa dilakukan non-root.

### 6.2 Dockerfile Pattern

```dockerfile
FROM eclipse-temurin:21-jre

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app

COPY --chown=app:app app.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Untuk image yang tidak punya `useradd`, gunakan numeric UID/GID:

```dockerfile
FROM gcr.io/distroless/java21-debian12:nonroot
WORKDIR /app
COPY app.jar /app/app.jar
USER nonroot:nonroot
ENTRYPOINT ["/app/app.jar"]
```

Catatan: detail entrypoint untuk distroless Java tergantung base image dan packaging. Prinsipnya: gunakan image nonroot bila tersedia, atau set `USER` eksplisit.

### 6.3 Kubernetes SecurityContext

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
      containers:
        - name: app
          image: registry.example.com/payment-service:1.4.7
          securityContext:
            allowPrivilegeEscalation: false
```

`runAsNonRoot: true` membuat intention eksplisit. `runAsUser` numeric membantu menghindari ambiguity jika image user name tidak tersedia di `/etc/passwd`.

### 6.4 Failure Mode Umum

| Gejala | Penyebab | Solusi |
|---|---|---|
| Permission denied saat startup | artifact/config tidak readable oleh UID app | `COPY --chown`, file mode benar |
| Tidak bisa tulis `/tmp` | image/rootfs read-only atau `/tmp` owned root | mount `emptyDir` ke `/tmp` |
| Tidak bisa bind port 80 | non-root tidak boleh bind port <1024 tanpa capability | gunakan port 8080 dan Service/Ingress mapping |
| Tidak bisa tulis log file | path log owned root | log ke stdout atau mount writable volume |
| Tidak bisa baca secret | fsGroup/permission tidak cocok | set `fsGroup` atau secret mode benar |

---

## 7. Read-Only Root Filesystem

### 7.1 Prinsip

Aplikasi production idealnya memperlakukan image sebagai immutable. Root filesystem seharusnya tidak perlu ditulis.

Java app sering diam-diam menulis ke:

- `/tmp`;
- current working directory;
- `logs/` relatif;
- heap dump path;
- GC log path;
- embedded server temp directory;
- font/cache directory;
- native library extraction directory;
- file upload temp;
- generated report temp;
- compiled JSP/temp workdir untuk servlet container;
- H2/local DB file pada development profile.

Read-only root filesystem memaksa semua write path menjadi eksplisit.

### 7.2 Kubernetes Pattern

```yaml
containers:
  - name: app
    image: registry.example.com/case-service:2.8.0
    securityContext:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      - name: dumps
        mountPath: /var/app/dumps
volumes:
  - name: tmp
    emptyDir: {}
  - name: dumps
    emptyDir: {}
```

Jika perlu membatasi memory untuk temp:

```yaml
volumes:
  - name: tmp
    emptyDir:
      medium: Memory
      sizeLimit: 256Mi
```

Hati-hati: `emptyDir.medium: Memory` masuk ke memory accounting pod. Untuk aplikasi yang banyak menggunakan temp file, ini bisa memicu OOMKilled.

### 7.3 Java-Specific Write Path Checklist

| Kebutuhan | Path Rekomendasi | Catatan |
|---|---|---|
| JVM temp | `/tmp` atau `/var/app/tmp` | set `-Djava.io.tmpdir=/tmp` |
| Heap dump | `/var/app/dumps` | harus cukup besar |
| Error file | `/var/app/dumps/hs_err_pid%p.log` | set `-XX:ErrorFile=...` |
| GC log file | stdout atau `/var/app/logs` | lebih baik stdout di container |
| File upload temp | dedicated temp volume | jangan rootfs |
| Native extraction | `/tmp` | pastikan executable policy cocok |
| Tomcat workdir | dedicated work volume | khusus WAR/container |

### 7.4 Example JVM Options

```text
-Djava.io.tmpdir=/tmp
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/app/dumps
-XX:ErrorFile=/var/app/dumps/hs_err_pid%p.log
```

### 7.5 Failure Mode

| Gejala | Kemungkinan Penyebab |
|---|---|
| App gagal start dengan `Read-only file system` | framework menulis cache/workdir ke rootfs |
| Report generation gagal | temp output path tidak writable |
| OOM tetapi tidak ada heap dump | dump path read-only atau volume tidak cukup |
| Tomcat gagal deploy WAR | work/temp directory tidak writable |
| Native library gagal load | library extraction ke path read-only |

---

## 8. Linux Capabilities: Drop What Java Does Not Need

### 8.1 Mental Model

Linux capabilities membagi privilege root menjadi unit-unit kecil seperti kemampuan bind port rendah, ubah network config, ubah ownership, dan lain-lain.

Java app biasa tidak perlu capability khusus.

Default production baseline:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

Kalau aplikasi benar-benar perlu capability tertentu, tambahkan secara eksplisit dan dokumentasikan alasannya.

### 8.2 Common Capabilities Java App Hampir Tidak Butuh

| Capability | Risiko | Java App Normal Butuh? |
|---|---|---|
| `NET_ADMIN` | ubah network config | tidak |
| `SYS_ADMIN` | sangat luas | hampir tidak pernah |
| `CHOWN` | ubah ownership file | tidak jika image benar |
| `DAC_OVERRIDE` | bypass permission | tidak |
| `NET_RAW` | raw sockets | tidak |
| `SYS_PTRACE` | inspect process lain | tidak, kecuali debug khusus |
| `NET_BIND_SERVICE` | bind port <1024 | hindari, pakai port 8080 |

### 8.3 Secure Baseline

```yaml
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

Jika business requirement memaksa port 443 langsung dalam container, opsi lebih aman biasanya:

```text
Container listens on 8080.
Kubernetes Service/Ingress exposes 443.
```

Bukan memberi `NET_BIND_SERVICE` ke aplikasi.

---

## 9. Privilege Escalation, Privileged Container, and Host Mounts

### 9.1 Avoid Privileged Container

`privileged: true` hampir tidak pernah cocok untuk Java application pod. Itu memberi akses sangat luas ke host capabilities.

Java app yang butuh privileged container biasanya menandakan desain deployment salah, misalnya:

- app ingin manage network host;
- app ingin mount filesystem host;
- app ingin akses Docker socket;
- app ingin menjalankan daemon lain;
- app dicampur dengan operational tooling.

Pisahkan kebutuhan tersebut ke komponen yang memang dirancang untuk itu.

### 9.2 Disable Privilege Escalation

```yaml
securityContext:
  allowPrivilegeEscalation: false
```

Ini mencegah process memperoleh privilege lebih tinggi melalui mekanisme tertentu seperti setuid binaries.

### 9.3 Hindari HostPath

`hostPath` berbahaya karena memberi container akses ke filesystem node.

Untuk Java apps, gunakan:

- `emptyDir` untuk temp;
- PVC untuk state yang benar-benar dibutuhkan;
- ConfigMap/Secret untuk config;
- object storage untuk file durable;
- stdout untuk logs.

`hostPath` hanya layak untuk daemonset/infrastructure-level agent, bukan aplikasi bisnis biasa.

---

## 10. Seccomp and AppArmor

### 10.1 Seccomp

Seccomp membatasi syscall yang boleh dipakai process. Kubernetes mendukung `seccompProfile`, misalnya `RuntimeDefault`.

Baseline:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

Untuk Java app, `RuntimeDefault` biasanya cukup. Jika ada native library spesifik yang gagal karena syscall tertentu diblokir, lakukan analisis spesifik, bukan langsung `Unconfined`.

### 10.2 AppArmor

AppArmor membatasi akses process berdasarkan profile. Di Kubernetes modern, AppArmor dapat dikonfigurasi lewat field security context pada platform yang mendukungnya.

Dalam banyak organisasi, AppArmor/seccomp profile dikelola oleh platform/security team. Aplikasi Java perlu:

- kompatibel dengan restricted baseline;
- tidak menulis sembarang path;
- tidak butuh privileged syscall;
- tidak tergantung shell/tooling yang tidak perlu.

### 10.3 Debugging Failure Karena Seccomp/AppArmor

Gejala:

- native library gagal load;
- process mendapat `Operation not permitted`;
- file/socket operation gagal meskipun permission terlihat benar;
- aplikasi jalan di local Docker tetapi gagal di cluster.

Langkah analisis:

1. Cek event pod.
2. Cek container logs.
3. Cek node/security audit logs jika tersedia.
4. Reproduce dengan profile yang sama.
5. Identifikasi syscall/path yang diblokir.
6. Putuskan apakah aplikasi harus diubah atau profile diberi exception.

Jangan menjadikan `Unconfined` sebagai solusi permanen tanpa risk acceptance.

---

## 11. NetworkPolicy: Runtime Micro-Segmentation

### 11.1 Kenapa NetworkPolicy Penting

Banyak cluster secara default mengizinkan pod-to-pod communication yang luas. Jika satu Java service compromised, attacker bisa scan service lain, database, broker, internal admin API, atau metadata endpoint.

NetworkPolicy mengubah default dari “semua bisa bicara” menjadi “hanya dependency eksplisit”.

### 11.2 Dependency Graph-Based Policy

Mulai dari dependency graph:

```text
case-service
  -> oracle-db:1521
  -> redis:6379
  -> rabbitmq:5672
  -> keycloak:8443
  -> document-service:8080
  -> smtp-relay:25
  -> external-onemap-api:443
```

Kemudian buat egress policy sesuai kebutuhan.

### 11.3 Default Deny Pattern

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: aceas-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Lalu allow spesifik.

### 11.4 Allow Ingress From Ingress Controller Only

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-case-service
  namespace: aceas-prod
spec:
  podSelector:
    matchLabels:
      app: case-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-system
          podSelector:
            matchLabels:
              app: ingress-controller
      ports:
        - protocol: TCP
          port: 8080
```

### 11.5 Allow Egress to Database

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-case-service-egress
  namespace: aceas-prod
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
          podSelector:
            matchLabels:
              app: oracle-proxy
      ports:
        - protocol: TCP
          port: 1521
    - to:
        - namespaceSelector:
            matchLabels:
              name: identity
          podSelector:
            matchLabels:
              app: keycloak
      ports:
        - protocol: TCP
          port: 8443
```

### 11.6 Caution: DNS

Jika default deny egress aktif, aplikasi mungkin gagal resolve DNS. Allow DNS secara eksplisit.

```yaml
- to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
  ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
```

Label DNS berbeda antar cluster. Validasi di environment nyata.

### 11.7 Java Failure Mode Akibat NetworkPolicy

| Gejala | Kemungkinan Penyebab |
|---|---|
| `UnknownHostException` | DNS egress diblokir |
| `Connection timed out` | egress ke dependency diblokir |
| `Connection refused` | destination hidup tapi port/service salah |
| login OIDC gagal | egress ke IdP/JWKS/token endpoint diblokir |
| SMTP gagal | egress ke relay tidak dibuka |
| metrics scrape gagal | ingress Prometheus ke pod diblokir |
| liveness/readiness gagal | kubelet/probe path tidak reachable tergantung setup |

NetworkPolicy harus dites sebagai bagian deployment verification, bukan setelah production incident.

---

## 12. ServiceAccount and Kubernetes RBAC

### 12.1 Default ServiceAccount Is Usually Too Vague

Jangan biarkan aplikasi Java otomatis memakai `default` service account tanpa evaluasi.

Pattern:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: case-service
  namespace: aceas-prod
automountServiceAccountToken: false
```

Jika aplikasi tidak perlu memanggil Kubernetes API, matikan automount token.

Pada pod:

```yaml
spec:
  serviceAccountName: case-service
  automountServiceAccountToken: false
```

### 12.2 Jika Aplikasi Perlu Kubernetes API

Contoh use case valid:

- leader election berbasis Lease;
- operator/controller;
- config watcher;
- service discovery custom;
- batch orchestrator internal.

Berikan RBAC minimum:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: case-service-lease
  namespace: aceas-prod
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
```

Jangan beri `cluster-admin` untuk aplikasi bisnis.

### 12.3 Token Leakage

Service account token yang mounted bisa bocor lewat:

- RCE;
- file read vulnerability;
- heap dump;
- debug shell;
- log accidental;
- backup volume.

Karena itu, jika tidak perlu, jangan mount.

---

## 13. JVM Attach, Dynamic Agent Loading, and Production Diagnostics

### 13.1 Apa Itu Attach Surface

Java memiliki mekanisme diagnostic attach yang memungkinkan tools seperti `jcmd`, `jstack`, `jmap`, atau agent tertentu berinteraksi dengan running JVM. Ini berguna untuk troubleshooting, tetapi juga merupakan surface sensitif.

Pada environment high-security, pertanyaannya:

> Apakah proses lain di container/host boleh attach ke JVM ini?

Jika jawabannya tidak, disable.

### 13.2 Disable Attach Mechanism

Untuk HotSpot/OpenJDK lineage:

```text
-XX:+DisableAttachMechanism
```

Konsekuensi:

- tools attach seperti `jcmd`, `jstack`, `jmap` tidak bisa bekerja normal terhadap process itu;
- dynamic diagnostic pada incident menjadi lebih sulit;
- harus ada alternatif observability: JFR preconfigured, logs, metrics, heap dump on OOM, thread dump via signal/endpoint yang aman, atau debug redeploy profile.

### 13.3 Dynamic Agent Loading

Modern Java semakin memperketat dynamic agent loading. Jangan mengandalkan production attach agent secara ad-hoc tanpa policy.

Policy yang lebih baik:

- observability agent dipasang saat startup;
- agent version dipin dan discan;
- agent config berada di deployment manifest;
- dynamic attach hanya via break-glass procedure;
- semua debug session diaudit.

### 13.4 Attach Decision Matrix

| Environment | Default Attach Policy |
|---|---|
| Local dev | allowed |
| CI integration test | allowed atau controlled |
| DEV shared | controlled |
| SIT/UAT | disabled kecuali debug task |
| Production normal | disabled untuk high-security service |
| Production incident | temporary controlled exception |

Untuk service yang sangat membutuhkan live diagnostic, keputusan bisa berbeda. Yang penting: keputusan eksplisit, bukan default tak disadari.

---

## 14. JDWP Remote Debugging: Almost Never in Production

### 14.1 Risiko JDWP

JDWP remote debugging sangat powerful. Jika terbuka tanpa pengamanan kuat, ia bisa memberikan kemampuan eksekusi/inspeksi yang sangat berbahaya.

Contoh flag:

```text
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

Ini tidak boleh menjadi default production.

### 14.2 Safe Policy

Production baseline:

```text
No JDWP port in normal deployment.
No debug flag in production manifest.
No debug port in Service/Ingress.
No debug port in container image documentation as normal path.
```

Jika benar-benar perlu:

- gunakan temporary debug deployment;
- isolate via network policy;
- bind ke localhost/sidecar tunnel jika memungkinkan;
- aktifkan hanya untuk waktu terbatas;
- gunakan approval;
- capture evidence;
- redeploy normal setelah selesai.

### 14.3 Anti-Pattern

```yaml
ports:
  - containerPort: 5005
```

Jika ini ada di manifest production tanpa reason yang jelas, itu red flag.

---

## 15. JMX Remote Hardening

### 15.1 JMX Local vs Remote

JMX sangat berguna untuk monitoring dan management. Tetapi remote JMX sering salah dikonfigurasi.

Risiko:

- authentication disabled;
- SSL disabled;
- port terbuka ke network luas;
- RMI memakai port tambahan yang tidak dipahami;
- credentials lemah;
- JMX console exposure;
- MBean management terlalu powerful.

### 15.2 Baseline

Preferred modern approach:

```text
Use metrics endpoint / OpenTelemetry / Prometheus instead of remote JMX where possible.
```

Jika remote JMX diperlukan:

- bind ke internal interface;
- enable authentication;
- enable TLS;
- restrict network;
- use fixed RMI port;
- do not expose via public ingress;
- rotate credentials;
- log access if possible;
- document operational purpose.

### 15.3 Example Hardened Direction

```text
-Dcom.sun.management.jmxremote=true
-Dcom.sun.management.jmxremote.port=9010
-Dcom.sun.management.jmxremote.rmi.port=9010
-Dcom.sun.management.jmxremote.authenticate=true
-Dcom.sun.management.jmxremote.ssl=true
-Djava.rmi.server.hostname=<internal-hostname>
```

Ini hanya ilustrasi arah. Production harus disesuaikan dengan network, cert, dan access model environment.

### 15.4 Common Mistake

```text
-Dcom.sun.management.jmxremote.authenticate=false
-Dcom.sun.management.jmxremote.ssl=false
```

Ini hanya layak untuk local/dev sandbox, bukan production.

---

## 16. Spring Boot Actuator Hardening

### 16.1 Actuator Is Operational Power

Actuator menyediakan endpoint untuk monitoring dan interaksi dengan aplikasi. Itu sangat berguna, tapi beberapa endpoint dapat mengungkap informasi sensitif atau mengubah runtime behavior.

Endpoint yang relatif aman untuk exposure internal terbatas:

- `health`;
- `info` jika tidak berisi data sensitif;
- `prometheus` untuk scraping internal.

Endpoint sensitif:

- `env`;
- `configprops`;
- `beans`;
- `heapdump`;
- `threaddump`;
- `loggers`;
- `mappings`;
- `conditions`;
- `shutdown`;
- custom admin endpoints.

### 16.2 Safe Exposure Baseline

```properties
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.show-details=when_authorized
management.endpoints.web.base-path=/actuator
```

Atau untuk minimal:

```properties
management.endpoints.web.exposure.include=health
management.endpoint.health.probes.enabled=true
```

### 16.3 Separate Management Port

```properties
management.server.port=9000
management.server.address=0.0.0.0
```

Lalu restrict via NetworkPolicy/Service:

```text
App port 8080: reachable by ingress/application traffic.
Management port 9000: reachable only by kubelet/prometheus/internal ops.
```

### 16.4 Avoid Exposing Sensitive Actuator via Public Ingress

Bad pattern:

```text
https://public.example.com/actuator/env
https://public.example.com/actuator/heapdump
```

Better:

```text
No public route to management endpoints.
Internal-only service.
Authenticated if human access needed.
Prometheus allowed only to scrape /actuator/prometheus.
```

### 16.5 Health Detail Leakage

`health` can leak dependency names/status if details are exposed. For public-facing health, return simple UP/DOWN. For internal readiness, more detail may be acceptable.

Pattern:

```properties
management.endpoint.health.show-details=never
```

or:

```properties
management.endpoint.health.show-details=when_authorized
```

### 16.6 Actuator Hardening Checklist

- [ ] Only expose needed endpoints.
- [ ] Do not expose `env`, `heapdump`, `loggers`, `shutdown` publicly.
- [ ] Use management port/service if possible.
- [ ] Restrict by network policy.
- [ ] Protect human access with auth.
- [ ] Scrub sensitive values.
- [ ] Avoid putting secrets in config keys that appear in diagnostics.
- [ ] Validate Ingress paths do not route `/actuator/*` unintentionally.

---

## 17. Admin Consoles and Application Server Management

Application server deployments have extra surfaces:

- Tomcat Manager;
- WildFly management console;
- WebLogic console;
- WebSphere admin console;
- Payara admin console;
- Jolokia;
- Hawtio;
- JMX bridges;
- datasource/admin endpoints.

Production baseline:

```text
Application traffic interface != management interface.
Management interface is not public.
Management auth is enforced.
Management credentials are rotated.
Admin console is disabled if not needed.
Deployment automation does not require broad console exposure.
```

Anti-pattern:

```text
/app/* and /manager/* exposed through the same public load balancer.
```

Better:

```text
Public ALB/Ingress -> application only.
Private admin access -> bastion/VPN/internal ops network.
CI/CD deploys through controlled API/CLI with least privilege.
```

---

## 18. Secrets Leakage Prevention

### 18.1 Avoid Secrets in Command Line Arguments

Bad:

```bash
java -Ddb.password=SuperSecret -jar app.jar
```

Why bad:

- may appear in process list;
- may appear in startup logs;
- may appear in crash reports;
- may be captured by deployment metadata.

Better:

- secret file mounted with restricted permission;
- secret manager runtime retrieval;
- Kubernetes Secret volume;
- environment variables only with awareness of diagnostic exposure;
- avoid logging full config.

### 18.2 Environment Variables Are Convenient but Not Magic-Safe

Env vars can leak through:

- `/proc/<pid>/environ` depending permissions;
- actuator env endpoint;
- crash diagnostics;
- debug shell;
- logs that print environment;
- CI/CD logs;
- Kubernetes pod spec visibility for non-secret env.

For highly sensitive secrets, mounted files or secret manager integration can reduce accidental exposure.

### 18.3 Secret Volume Pattern

```yaml
volumes:
  - name: db-credentials
    secret:
      secretName: case-service-db
      defaultMode: 0440
containers:
  - name: app
    volumeMounts:
      - name: db-credentials
        mountPath: /var/run/secrets/case-service-db
        readOnly: true
```

Application reads:

```text
/var/run/secrets/case-service-db/username
/var/run/secrets/case-service-db/password
```

### 18.4 Redaction Policy

At minimum, redact keys containing:

```text
password
passwd
secret
token
apikey
api-key
credential
private-key
client-secret
authorization
cookie
session
```

But key-name redaction is not enough. Some sensitive values have innocent names. Apply structured logging and never log full config maps.

### 18.5 Heap Dump and Secret Risk

Heap dump can contain:

- passwords;
- tokens;
- request payloads;
- PII;
- session data;
- decrypted private keys;
- JDBC URLs;
- cached API responses.

Therefore:

- heap dump path must be protected;
- dump access must be audited;
- dump transfer must be encrypted;
- dump retention must be limited;
- dump must not be uploaded to random external tooling;
- production dump should follow data handling policy.

---

## 19. Logging Hardening

### 19.1 Logs Are Security Boundary

Logs often become the largest data exfiltration path.

Hardening principles:

- no raw tokens;
- no full Authorization header;
- no cookies;
- no passwords;
- no full PII unless required and approved;
- no private keys;
- no full request/response body by default;
- no stack trace containing secrets from exception messages;
- correlation ID yes, secret no.

### 19.2 Access Logs

Access logs should include:

- timestamp;
- method;
- route template, not raw sensitive URL if possible;
- status;
- duration;
- request ID/correlation ID;
- client identity or hashed user ID if needed;
- remote IP with privacy awareness;
- response size.

Avoid:

- query string with tokens;
- full body;
- Authorization header;
- session cookie.

### 19.3 Log Level Control

Runtime log level change is useful. But endpoint like Actuator `loggers` can be abused to expose more data.

Policy:

- log level change only internal/authenticated;
- change is temporary;
- audit who changed what;
- do not allow DEBUG globally in production for long periods;
- avoid debug log statements that print secrets.

---

## 20. TLS, Trust Boundaries, and Internal Plaintext

Deployment hardening should clarify where TLS terminates.

Common patterns:

1. TLS terminates at load balancer/ingress; pod receives HTTP.
2. TLS terminates at service mesh sidecar; app receives HTTP localhost.
3. App terminates TLS directly.
4. mTLS from client to app or sidecar.

Each has implications.

### 20.1 If TLS Terminates Before Java App

Ensure:

- internal network is trusted or mesh-encrypted;
- `X-Forwarded-*` handling is correct;
- app does not trust spoofed forwarded headers from public traffic;
- ingress strips/replaces forwarded headers;
- secure cookie and redirect scheme are correct;
- HSTS is set at edge if applicable.

### 20.2 If Java App Terminates TLS

Ensure:

- keystore protected;
- certificate rotation planned;
- TLS protocol/cipher baseline set by runtime/server;
- no obsolete protocol;
- truststore controlled;
- mTLS client cert validation understood;
- readiness reflects cert/config validity.

### 20.3 Forwarded Header Misconfiguration

A common deployment bug:

```text
External request: https://app.example.com
Internal app sees: http://pod-ip:8080
App generates redirect to http://app.example.com
Secure cookie not set correctly
OIDC callback mismatch
```

This is both reliability and security issue.

---

## 21. File Upload and Temporary File Hardening

Java apps often handle uploads, reports, generated PDFs, CSV exports, images, or scanned documents.

Deployment controls:

- temp upload directory separate from rootfs;
- size limit enforced at ingress and app;
- antivirus/malware scan if domain requires;
- file extension not trusted;
- content type not trusted;
- generated file path not user-controlled;
- cleanup job exists;
- no execution from upload directory;
- no upload directory served directly as static content;
- object storage permissions least privilege.

Kubernetes example:

```yaml
volumeMounts:
  - name: upload-tmp
    mountPath: /var/app/upload-tmp
volumes:
  - name: upload-tmp
    emptyDir:
      sizeLimit: 2Gi
```

Application config:

```properties
app.upload.tmp-dir=/var/app/upload-tmp
spring.servlet.multipart.max-file-size=25MB
spring.servlet.multipart.max-request-size=30MB
```

---

## 22. Image Hardening

Part 8 and Part 9 already discussed container image mechanics. Here we focus on security posture.

### 22.1 Prefer Minimal Runtime Image

Production image should not include unnecessary tools:

- compilers;
- package managers;
- curl/wget/nc unless justified;
- source code;
- test resources;
- build cache;
- private repo credentials;
- shell if not needed;
- SSH server;
- cloud CLI.

### 22.2 Debug Image Split

Use two image profiles:

```text
Production image:
  minimal, non-root, no shell, no package manager.

Debug image:
  same app/runtime version plus diagnostic tools.
  used only in controlled environment or temporary incident procedure.
```

This preserves operability without bloating normal attack surface.

### 22.3 CA Certificates

Minimal images often lack expected CA certs or timezone/font packages.

Hardening is not “remove everything blindly”. It is:

```text
Include only runtime dependencies needed for correct secure operation.
```

For Java apps, validate:

- CA certificates present;
- custom enterprise CA installed if needed;
- timezone behavior correct;
- fonts present if rendering PDFs/images;
- native libs present if framework needs them;
- user/group exists or numeric UID works;
- `/tmp` behavior correct.

---

## 23. Kubernetes Pod Security Standards Alignment

Many clusters enforce Pod Security Standards or equivalent admission controls.

For Java application pods, target restricted-like posture:

```yaml
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
containers:
  - securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
```

Additional:

```yaml
automountServiceAccountToken: false
```

if Kubernetes API not needed.

### 23.1 Example Hardened Deployment Skeleton

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
  namespace: aceas-prod
  labels:
    app: case-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-service
  template:
    metadata:
      labels:
        app: case-service
    spec:
      serviceAccountName: case-service
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
          image: registry.example.com/aceas/case-service:2.14.8
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
            - name: management
              containerPort: 9000
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -Djava.io.tmpdir=/tmp
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/var/app/dumps
                -XX:ErrorFile=/var/app/dumps/hs_err_pid%p.log
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: dumps
              mountPath: /var/app/dumps
            - name: app-config
              mountPath: /etc/app
              readOnly: true
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            initialDelaySeconds: 20
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            initialDelaySeconds: 60
            periodSeconds: 20
      volumes:
        - name: tmp
          emptyDir: {}
        - name: dumps
          emptyDir: {}
        - name: app-config
          configMap:
            name: case-service-config
```

Ini bukan template universal, tetapi baseline berpikir.

---

## 24. VM/systemd Hardening for Java Services

Tidak semua deployment ada di Kubernetes. Untuk VM/systemd, hardening tetap bisa dilakukan.

### 24.1 Dedicated User

```bash
sudo useradd --system --home /opt/case-service --shell /usr/sbin/nologin case-service
sudo chown -R case-service:case-service /opt/case-service /var/lib/case-service /var/log/case-service
```

### 24.2 systemd Unit Hardening Example

```ini
[Unit]
Description=Case Service
After=network-online.target
Wants=network-online.target

[Service]
User=case-service
Group=case-service
WorkingDirectory=/opt/case-service/current
ExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/case-service/current/app.jar
EnvironmentFile=/etc/case-service/case-service.env
Restart=on-failure
RestartSec=10
SuccessExitStatus=143

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/case-service /var/log/case-service /tmp
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Notes:

- `ProtectSystem=strict` makes most filesystem read-only.
- `ReadWritePaths` grants explicit writable paths.
- `NoNewPrivileges` prevents privilege escalation.
- `CapabilityBoundingSet=` empty removes capabilities.
- Validate compatibility; do not copy blindly.

### 24.3 VM Checklist

- [ ] Dedicated OS user.
- [ ] Artifact directory read-only to app if possible.
- [ ] Config readable but not writable by app.
- [ ] Secrets protected by filesystem permissions.
- [ ] Logs/dumps path explicit.
- [ ] No shell login for service user.
- [ ] systemd restart behavior defined.
- [ ] systemd sandboxing tested.
- [ ] Firewall restricts app and management ports.
- [ ] JMX/debug not publicly reachable.

---

## 25. Management Plane Separation

A mature deployment separates planes:

```text
Data plane:
  user/API/business traffic.

Management plane:
  health, metrics, admin, debug, deployment control.

Control plane:
  CI/CD, Kubernetes API, app server admin API, secret manager.
```

Hardening rule:

```text
Do not expose management/control plane through the same route and access policy as public data plane.
```

Examples:

| Surface | Should Be Public? | Recommended Access |
|---|---:|---|
| `/api/cases` | maybe | public/private app ingress |
| `/actuator/health` | maybe limited | simple public health or internal only |
| `/actuator/prometheus` | no | Prometheus namespace only |
| `/actuator/env` | no | disabled or admin only |
| JMX | no | internal ops only, preferably avoided |
| JDWP | no | temporary debug only |
| App server admin console | no | VPN/bastion/private network |
| Kubernetes API | no | platform/admin only |
| DB port | no | app namespace/subnet only |

---

## 26. Ingress and Header Hardening

### 26.1 Avoid Path Leakage

Ingress may accidentally expose internal paths.

Bad:

```yaml
path: /
pathType: Prefix
```

If the backend includes `/actuator`, `/admin`, `/manager`, or `/internal`, public ingress may expose them.

Mitigations:

- separate management port/service;
- block sensitive paths at ingress;
- do not register management service in public ingress;
- use explicit path routing;
- test exposure with scanner/smoke test.

### 26.2 Forwarded Headers

If app trusts `X-Forwarded-For`, `X-Forwarded-Proto`, or `Forwarded`, ensure ingress overwrites them rather than blindly passing user-supplied values.

Risks:

- wrong redirect scheme;
- secure cookie bypass;
- IP-based allowlist bypass;
- audit log spoofing;
- callback URL mismatch.

### 26.3 Security Headers

Often better set at edge:

- HSTS;
- X-Content-Type-Options;
- Content-Security-Policy;
- Referrer-Policy;
- frame options/frame ancestors;
- cache control for sensitive pages.

Deployment engineer must know whether app or edge owns them.

---

## 27. Production Debug Policy

### 27.1 Why Policy Matters

During incidents, teams are tempted to weaken production:

- enable DEBUG globally;
- expose JDWP;
- exec into pod and install tools;
- dump heap to shared path;
- copy production data locally;
- disable NetworkPolicy;
- temporarily expose admin endpoint.

Without policy, temporary exceptions become permanent vulnerabilities.

### 27.2 Debug Access Levels

| Level | Method | Risk | Use |
|---|---|---:|---|
| L0 | Logs/metrics/traces/dashboard | low | normal ops |
| L1 | JFR already enabled/recording | low-medium | performance incident |
| L2 | Thread dump/heap dump through controlled mechanism | medium | severe incident |
| L3 | Ephemeral debug container | medium-high | environment inspection |
| L4 | Debug image redeploy | high | hard production issue |
| L5 | JDWP remote | very high | exceptional only |

### 27.3 Break-Glass Requirements

A break-glass production debug should include:

- incident ID;
- approver;
- service/environment;
- exact access requested;
- duration;
- data handling requirement;
- rollback/restore step;
- evidence collected;
- post-incident review.

### 27.4 Safer Defaults

Prefer:

```text
- structured logs
- correlation ID
- OpenTelemetry traces
- JFR configured at startup
- heap dump on OOM to protected path
- internal-only thread dump endpoint if justified
- ephemeral container for network/file inspection
```

Avoid:

```text
- permanent JDWP
- public JMX
- exposed heapdump endpoint
- unrestricted pod exec for everyone
- debug tools in all production images
```

---

## 28. Policy-as-Code and Admission Controls

Hardening should not depend on humans remembering checklists.

Use policy gates:

- Kubernetes admission controller;
- OPA Gatekeeper;
- Kyverno;
- Pod Security Admission;
- CI manifest scanning;
- image scanning;
- Helm/Kustomize policy tests.

Example policies:

- reject pod running as root;
- reject privileged container;
- require `readOnlyRootFilesystem` for stateless apps;
- require `allowPrivilegeEscalation=false`;
- require `capabilities.drop=ALL`;
- reject `hostPath` except approved namespaces;
- reject public ingress paths to `/actuator/*`;
- reject image `latest` tag;
- require resource requests/limits;
- require service account not default;
- require NetworkPolicy for production namespace.

### 28.1 Example Kyverno-Style Intent

```yaml
# Pseudocode-ish: validate production pods do not run as root
match:
  namespaces:
    - prod
validate:
  message: "Production containers must run as non-root"
  pattern:
    spec:
      securityContext:
        runAsNonRoot: true
```

Exact syntax depends on policy engine and version. The important part is the control objective.

---

## 29. Hardening by Service Type

Not every Java service has identical needs.

### 29.1 Stateless REST API

Baseline:

- non-root;
- read-only rootfs;
- `/tmp` emptyDir;
- drop all capabilities;
- no service account token;
- management port internal;
- no JMX/JDWP;
- NetworkPolicy to only required dependencies;
- Actuator health/prometheus only.

### 29.2 Batch Job

Additional considerations:

- job may need larger temp/dump volume;
- no inbound app port;
- egress restricted to DB/object storage/broker;
- service account token off unless needed;
- logs are primary output;
- secret lifetime limited;
- cleanup failed job pods carefully.

### 29.3 Message Consumer

Additional considerations:

- no public ingress;
- egress to broker and downstream only;
- graceful shutdown drains consumer;
- dead-letter handling observable;
- attach/debug disabled;
- idempotency protects duplicate delivery.

### 29.4 App Server / WAR Deployment

Additional considerations:

- admin console isolated;
- deployment manager credential protected;
- server work/temp dirs writable;
- shared libs read-only;
- app server user non-root;
- JMX/admin interfaces internal only;
- hot deploy disabled or controlled in prod.

### 29.5 Legacy Java 8 Service

Additional considerations:

- old TLS defaults may need explicit config;
- old base images may have many CVEs;
- old app server may require compensating network controls;
- Security Manager historical configs are not future strategy;
- old logging may leak more;
- migration plan should separate runtime uplift from feature release.

---

## 30. Hardening Without Breaking Operability

A common failure: security team mandates hardening, app breaks, team disables everything.

Better approach:

```text
Step 1: Inventory current runtime behavior.
Step 2: Enable one control at a time.
Step 3: Run startup + smoke + synthetic + rollback tests.
Step 4: Capture required exceptions.
Step 5: Convert exceptions into explicit manifests.
Step 6: Add policy gate after compatibility proven.
```

### 30.1 Hardening Rollout Order

Recommended order:

1. Dedicated non-root user.
2. Drop unnecessary capabilities.
3. Disable privilege escalation.
4. Explicit writable paths.
5. Read-only root filesystem.
6. Service account token minimization.
7. Management endpoint exposure reduction.
8. NetworkPolicy default deny + allowlist.
9. Disable debug/JDWP/JMX remote exposure.
10. Attach/dynamic agent policy.
11. Admission controls.

NetworkPolicy and read-only rootfs often reveal hidden assumptions, so roll them out with testing.

---

## 31. Deployment Hardening Verification

Hardening must be verified.

### 31.1 Runtime Checks Inside Pod

```bash
id
whoami
pwd
mount | head
cat /proc/1/status | grep -E 'Uid|Gid|Cap'
touch /should-not-write
```

Expected:

- non-root UID;
- rootfs write fails;
- capabilities minimal;
- writable only on explicit paths.

### 31.2 Network Checks

From debug pod in same namespace:

```bash
curl http://case-service:8080/actuator/health
curl http://case-service:9000/actuator/prometheus
nc -vz oracle-proxy.database.svc 1521
nc -vz random-service.other-ns.svc 8080
```

Expected:

- allowed dependencies reachable;
- unauthorized destinations blocked;
- management endpoint not reachable from public path.

### 31.3 External Exposure Checks

```bash
curl -i https://app.example.com/actuator/env
curl -i https://app.example.com/actuator/heapdump
curl -i https://app.example.com/manager/html
curl -i https://app.example.com/admin
```

Expected:

- 404/403/not routed;
- no sensitive output;
- no stack trace leakage.

### 31.4 JVM Surface Checks

Check startup flags:

```bash
ps -ef | grep java
```

Verify:

- no JDWP in production;
- no secret in command line;
- no unsafe JMX remote config;
- expected diagnostics path;
- attach policy as intended.

---

## 32. Common Anti-Patterns

### 32.1 “It Runs as Root Because It Was Easier”

This hides file ownership problems in image build. Fix image ownership instead.

### 32.2 “Expose Actuator Then Protect Later”

Exposure tends to become permanent. Default expose minimal endpoints.

### 32.3 “Debug Port Is Internal, So It Is Fine”

Internal networks are not automatically safe. Lateral movement is real.

### 32.4 “NetworkPolicy Broke Something, Disable It”

NetworkPolicy revealed undocumented dependency. Document and allow explicitly.

### 32.5 “Heap Dump Uploaded to Random Tool”

Heap dumps may contain secrets and PII. Treat as sensitive data.

### 32.6 “Production Image Has curl, bash, package manager, cloud CLI”

Convenient for debugging, but expands attacker tooling. Use debug image/ephemeral container.

### 32.7 “Secret in JAVA_TOOL_OPTIONS”

JVM options often visible in process metadata/logs. Do not put secrets there.

### 32.8 “Service Account Token Mounted Everywhere”

If service does not call Kubernetes API, disable token automount.

### 32.9 “JMX Auth Disabled Because Network Is Private”

Private network is a control, not a complete security model.

### 32.10 “Read-Only Rootfs Without Writable Temp”

Java apps commonly need temp. Make write paths explicit.

---

## 33. Hardening Checklist for Java Deployment

### 33.1 Container/Pod

- [ ] Runs as non-root.
- [ ] Numeric UID/GID defined.
- [ ] `allowPrivilegeEscalation=false`.
- [ ] `capabilities.drop=ALL`.
- [ ] `readOnlyRootFilesystem=true` where feasible.
- [ ] Writable paths explicit.
- [ ] `/tmp` configured intentionally.
- [ ] `seccompProfile=RuntimeDefault`.
- [ ] No privileged container.
- [ ] No hostPath except approved exception.
- [ ] No unnecessary sidecars.

### 33.2 JVM

- [ ] No JDWP in normal production.
- [ ] JMX remote disabled or hardened.
- [ ] Attach mechanism policy explicit.
- [ ] No secrets in JVM args.
- [ ] Heap dump path protected.
- [ ] Error file path protected.
- [ ] Observability agent pinned and approved.
- [ ] Java version patched.
- [ ] JVM flags compatible with target Java version.

### 33.3 Application Management Surface

- [ ] Actuator exposure minimal.
- [ ] Sensitive endpoints disabled or internal/authenticated.
- [ ] Management port separated where possible.
- [ ] Admin console not public.
- [ ] Health details not leaked publicly.
- [ ] Loggers endpoint protected if enabled.
- [ ] Heapdump endpoint disabled in prod unless strong controls exist.

### 33.4 Network

- [ ] Default deny considered for prod namespace.
- [ ] Ingress allowed only from expected sources.
- [ ] Egress allowed only to dependencies.
- [ ] DNS egress explicitly handled.
- [ ] DB/broker/cache access restricted.
- [ ] Management endpoints not reachable from public ingress.
- [ ] External API egress controlled.

### 33.5 Secrets/Data

- [ ] Secrets not in command line.
- [ ] Secrets not logged.
- [ ] Secret files read-only.
- [ ] Service account token disabled if unused.
- [ ] Heap/thread dumps treated sensitive.
- [ ] CI/CD logs scrubbed.
- [ ] Actuator env/configprops not exposed.
- [ ] Secret rotation compatible with deployment model.

### 33.6 Governance

- [ ] Hardening requirements encoded in policy-as-code.
- [ ] Exceptions documented with expiry.
- [ ] Break-glass debug process exists.
- [ ] Evidence captured after deployment.
- [ ] Security posture included in release readiness.
- [ ] Runbook includes hardened environment caveats.

---

## 34. Practical Decision Framework

When deciding a hardening control, ask:

### 34.1 Does the Java Process Need This Privilege?

If no, remove it.

Examples:

- Does it need root? No.
- Does it need write rootfs? Usually no.
- Does it need Kubernetes API token? Usually no.
- Does it need JMX remote? Usually no.
- Does it need outbound to internet? Maybe, explicitly.

### 34.2 What Breaks If We Remove It?

Identify hidden dependencies:

- temp file path;
- report generation;
- PDF font cache;
- native library extraction;
- app server workdir;
- service discovery;
- metrics scraping;
- health checks;
- certificate reload.

### 34.3 Can We Replace Broad Privilege With Narrow Permission?

Examples:

| Broad | Narrow |
|---|---|
| root user | non-root with file ownership fixed |
| writable rootfs | writable `/tmp` only |
| all egress | dependency allowlist |
| public actuator | internal health/prometheus only |
| JMX remote | OpenTelemetry/Prometheus metrics |
| permanent JDWP | temporary debug deployment |
| mounted SA token | no token or minimal Role |

### 34.4 How Do We Operate During Incident?

Hardening without incident path causes teams to bypass security.

Define:

- how to get thread dump;
- how to get heap dump;
- how to enable debug logs temporarily;
- how to inspect network from namespace;
- how to verify cert/truststore;
- how to capture JFR;
- how to perform emergency rollback.

---

## 35. Example: Hardening a Spring Boot Service

### Before

```yaml
containers:
  - name: app
    image: registry.example.com/payment-service:latest
    ports:
      - containerPort: 8080
      - containerPort: 5005
    env:
      - name: JAVA_TOOL_OPTIONS
        value: "-Ddb.password=secret -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"
```

Problems:

- `latest` tag;
- debug port exposed;
- secret in JVM args;
- no non-root control;
- no read-only rootfs;
- no capability restrictions;
- no management separation;
- no service account policy;
- likely broad network access.

### After

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      serviceAccountName: payment-service
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
          image: registry.example.com/payment-service:1.8.12@sha256:exampledigest
          ports:
            - name: http
              containerPort: 8080
            - name: management
              containerPort: 9000
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -Djava.io.tmpdir=/tmp
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/var/app/dumps
                -XX:ErrorFile=/var/app/dumps/hs_err_pid%p.log
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: dumps
              mountPath: /var/app/dumps
            - name: db-secret
              mountPath: /var/run/secrets/payment-db
              readOnly: true
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
      volumes:
        - name: tmp
          emptyDir: {}
        - name: dumps
          emptyDir: {}
        - name: db-secret
          secret:
            secretName: payment-service-db
            defaultMode: 0440
```

Application properties:

```properties
server.port=8080
management.server.port=9000
management.endpoints.web.exposure.include=health,prometheus
management.endpoint.health.probes.enabled=true
management.endpoint.health.show-details=never
```

Add NetworkPolicy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-service-egress
spec:
  podSelector:
    matchLabels:
      app: payment-service
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: database
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
```

Again, labels and ports must match actual cluster.

---

## 36. Example: Hardening a Legacy Java 8 WAR on Tomcat

Legacy deployment often cannot become perfect immediately. Use compensating controls.

### 36.1 Risks

- old Java 8 runtime;
- old Tomcat;
- WAR deployed to shared app server;
- manager app accidentally enabled;
- JMX remote enabled;
- logs to local file;
- secrets in setenv.sh;
- app writes to webapps/work/temp;
- TLS default old;
- manual deployment.

### 36.2 Improvements

- run Tomcat as dedicated non-root user;
- disable public Manager/Host Manager;
- restrict admin connector to localhost/internal network;
- remove default apps;
- ensure `CATALINA_BASE` separate from `CATALINA_HOME`;
- make webapps readonly except deployment process;
- set explicit temp/work/log directories;
- rotate logs;
- patch Java 8 distribution;
- patch Tomcat;
- remove sample apps;
- restrict network egress;
- move secrets from command line to protected file;
- automate WAR deployment;
- add smoke check;
- plan Java/app server uplift.

### 36.3 systemd Sketch

```ini
[Service]
User=tomcat
Group=tomcat
Environment="CATALINA_BASE=/var/lib/tomcat-case"
Environment="CATALINA_HOME=/opt/tomcat"
EnvironmentFile=/etc/tomcat-case/env
ExecStart=/opt/tomcat/bin/catalina.sh run
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/tomcat-case /var/log/tomcat-case /tmp
```

Legacy hardening is often incremental. Do the most valuable controls first.

---

## 37. Regulatory/Enterprise Lens

For regulated case-management/enforcement systems, hardening is not just technical hygiene. It supports auditability and defensibility.

You need to answer:

- Who can access production management endpoints?
- Can application pods call only approved systems?
- Are secrets excluded from logs and diagnostic dumps?
- Are debug exceptions approved and time-bounded?
- Can we prove production image does not run as root?
- Can we prove deployment follows hardened baseline?
- Are exceptions documented?
- Are emergency actions traceable?
- Can release evidence show no sensitive endpoints exposed?

A top engineer treats deployment hardening as part of governance evidence, not only YAML quality.

---

## 38. Review Questions

Use these to test understanding.

1. Why is running Java as non-root still important inside a container?
2. What Java-specific directories commonly break when `readOnlyRootFilesystem=true`?
3. Why is `JAVA_TOOL_OPTIONS` a bad place for secrets?
4. What is the difference between disabling Actuator endpoint and not exposing it over HTTP?
5. Why is JDWP dangerous in production?
6. What is the operational cost of `-XX:+DisableAttachMechanism`?
7. How does NetworkPolicy reduce blast radius after RCE?
8. Why should service account token automount be disabled if unused?
9. Why are heap dumps sensitive data?
10. How do you design a secure but still operable production debug path?
11. Why is read-only root filesystem not enough without explicit writable volumes?
12. Why should app server admin console be separated from user traffic?
13. What can go wrong if forwarded headers are trusted incorrectly?
14. Why should hardening controls be rolled out gradually?
15. What evidence would you collect to prove a Java service is hardened?

---

## 39. Practical Exercises

### Exercise 1 — Harden a Spring Boot Deployment

Given a Deployment manifest that:

- runs as root;
- exposes 8080 and 5005;
- includes `bash`, `curl`, and package manager;
- exposes `/actuator/*` publicly;
- mounts service account token;
- has no NetworkPolicy;

rewrite it with:

- non-root user;
- no debug port;
- internal management port;
- minimal actuator exposure;
- read-only rootfs;
- explicit `/tmp`;
- no service account token;
- NetworkPolicy allowlist.

### Exercise 2 — Debug Read-Only Root Filesystem Failure

A Java service fails with:

```text
java.io.IOException: Read-only file system
```

Build a diagnostic checklist:

- where is it trying to write?
- is it `java.io.tmpdir`?
- is it log file?
- is it embedded server workdir?
- is it heap dump path?
- is it report generation path?
- what volume should be mounted?

### Exercise 3 — Actuator Exposure Audit

For a running Spring Boot service, list:

- enabled endpoints;
- exposed endpoints;
- public ingress paths;
- management service selectors;
- network policy allowing prometheus;
- auth rules for human access.

Then decide which endpoints should stay.

### Exercise 4 — Production Debug Runbook

Write a break-glass runbook for collecting:

- thread dump;
- heap dump;
- JFR recording;
- temporary DEBUG logs;
- network connectivity check.

Include approval, duration, data handling, and cleanup.

---

## 40. Summary

Deployment security hardening is about runtime blast-radius reduction.

For Java applications, the most important controls are:

- run as non-root;
- make root filesystem read-only where possible;
- define writable paths explicitly;
- drop Linux capabilities;
- disable privilege escalation;
- use seccomp/AppArmor baseline;
- minimize service account token/RBAC;
- restrict ingress/egress with NetworkPolicy;
- avoid public management/admin endpoints;
- harden Actuator/JMX/JDWP;
- avoid secrets in args/logs/env exposure;
- treat heap dumps and diagnostics as sensitive;
- keep production image minimal;
- define controlled debug/break-glass process;
- enforce controls with policy-as-code.

The mature mindset is not:

```text
Make production impossible to debug.
```

Nor:

```text
Leave everything open for convenience.
```

It is:

```text
Production is hardened by default, observable by design, and debuggable only through explicit, temporary, auditable mechanisms.
```

That is the deployment posture expected from a top-tier Java engineer.

---

## 41. References

- Kubernetes Documentation — Configure a Security Context for a Pod or Container: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
- Kubernetes Documentation — Network Policies: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- Kubernetes API Reference — NetworkPolicy: https://kubernetes.io/docs/reference/kubernetes-api/networking/network-policy-v1/
- Spring Boot Documentation — Actuator Endpoints: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
- Oracle Java Tools Documentation — `java` command and `-XX:+DisableAttachMechanism`: https://docs.oracle.com/en/java/javase/11/tools/java.html
- IBM Java Documentation — Java Attach API security notes: https://www.ibm.com/docs/en/sdk-java-technology/8?topic=documentation-java-attach-api
- OpenJDK issue JDK-8177154 — Dynamic agent loading direction: https://bugs.openjdk.org/browse/JDK-8177154

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-deployment-runtime-release-delivery-engineering-part-24-supply-chain-security-for-java-deployment.md">⬅️ Part 24 — Supply Chain Security for Java Deployment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-deployment-runtime-release-delivery-engineering-part-26-multi-environment-deployment.md">Part 26 — Multi-Environment Deployment: DEV, SIT, UAT, Staging, Production, DR ➡️</a>
</div>
