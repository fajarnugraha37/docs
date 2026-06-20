# learn-kubernetes-mastery-for-java-engineers-part-019.md

# Part 019 — Pod Security, Security Context, and Workload Hardening

> Seri: Kubernetes Mastery for Java Engineers  
> Posisi: Part 019 dari 035  
> Fokus: Pod Security Standards, Pod Security Admission, securityContext, least privilege runtime, dan hardening workload Java di Kubernetes.  
> Prasyarat internal seri: Part 001–018, terutama Pod lifecycle, scheduling, resources, namespaces, RBAC, ServiceAccount, dan configuration/secrets.

---

## 0. Kenapa Part Ini Penting

Pada part sebelumnya kita membahas RBAC: siapa boleh melakukan apa terhadap Kubernetes API. RBAC melindungi **control plane access**.

Part ini membahas sisi lain: bagaimana membatasi apa yang boleh dilakukan **process di dalam Pod** ketika sudah berjalan di Node.

Ini perbedaan penting:

```text
RBAC menjawab:
  "Apakah user/service account boleh create Pod, read Secret, exec ke Pod, patch Deployment?"

Pod security menjawab:
  "Kalau Pod sudah dibuat, apakah container boleh berjalan sebagai root,
   memakai host network, mount hostPath, menambah Linux capability,
   disable seccomp, privilege escalation, atau menulis ke root filesystem?"
```

Banyak engineer merasa workload sudah aman karena:

```text
- image berasal dari registry internal
- namespace sudah dipisah
- ServiceAccount tidak punya cluster-admin
- hanya expose port aplikasi
- container bukan VM penuh
```

Itu benar sebagai lapisan awal, tetapi belum cukup.

Container adalah proses Linux dengan boundary runtime. Jika container berjalan terlalu privileged, boundary itu bisa melemah drastis. Kubernetes memberi banyak knob untuk menjalankan workload dengan privilege minimal, tetapi default yang terlalu longgar, image lama, atau manifest template yang asal copy sering membuat Pod production lebih powerful dari yang diperlukan.

Untuk Java engineer, ini sangat relevan karena aplikasi Java biasanya tidak butuh privilege tinggi. REST API Spring Boot, worker Kafka, batch processor, scheduler, dan internal service normalnya bisa berjalan dengan profil sangat terbatas:

```text
- non-root user
- no privilege escalation
- drop Linux capabilities
- read-only root filesystem
- seccomp RuntimeDefault
- no host namespaces
- no hostPath
- no privileged mode
- ServiceAccount token tidak otomatis jika tidak butuh Kubernetes API
```

Mental model utama part ini:

```text
Aman bukan berarti "container tidak punya bug".
Aman berarti ketika bug, RCE, dependency compromise, atau misconfiguration terjadi,
blast radius runtime tetap sempit.
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan perbedaan antara RBAC, Pod Security Admission, securityContext, NetworkPolicy, dan image supply-chain security.
2. Membaca Pod manifest dan menilai apakah workload terlalu privileged.
3. Mendesain baseline hardening untuk Java service production.
4. Memahami Pod Security Standards: `privileged`, `baseline`, dan `restricted`.
5. Menerapkan namespace-level Pod Security Admission dengan mode `enforce`, `audit`, dan `warn`.
6. Menggunakan `securityContext` di level Pod dan container.
7. Memahami field seperti `runAsNonRoot`, `runAsUser`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation`, `capabilities`, dan `seccompProfile`.
8. Membedakan kebutuhan keamanan aplikasi biasa vs infrastructure workload seperti CNI, CSI, logging agent, dan node agent.
9. Debugging Pod yang gagal karena policy/securityContext.
10. Membuat hardening checklist untuk workload Java tanpa mengorbankan operability.

---

## 2. Peta Besar Kubernetes Security Layers

Security Kubernetes bukan satu fitur. Ia adalah kombinasi beberapa lapisan.

```text
+-------------------------------------------------------------+
| Human / CI / automation identity                            |
| - SSO, kubeconfig, CI token                                  |
+-------------------------------------------------------------+
| Kubernetes API access                                        |
| - Authentication                                             |
| - Authorization / RBAC                                       |
| - Admission control                                          |
+-------------------------------------------------------------+
| Object policy                                                |
| - Pod Security Admission                                     |
| - ValidatingAdmissionPolicy                                  |
| - OPA Gatekeeper / Kyverno                                   |
+-------------------------------------------------------------+
| Workload identity and secret access                          |
| - ServiceAccount                                             |
| - projected token                                            |
| - cloud workload identity                                    |
+-------------------------------------------------------------+
| Runtime isolation                                            |
| - securityContext                                            |
| - seccomp                                                    |
| - AppArmor / SELinux where available                         |
| - capabilities                                               |
| - non-root user                                              |
+-------------------------------------------------------------+
| Network isolation                                            |
| - NetworkPolicy                                              |
| - service mesh / mTLS                                        |
| - egress control                                             |
+-------------------------------------------------------------+
| Supply chain                                                 |
| - image provenance                                           |
| - signing                                                    |
| - SBOM                                                       |
| - vulnerability scanning                                     |
+-------------------------------------------------------------+
| Node / cluster hardening                                     |
| - kubelet config                                             |
| - OS patching                                                |
| - container runtime config                                   |
| - managed node groups                                        |
+-------------------------------------------------------------+
```

Part ini fokus terutama pada:

```text
- Pod Security Standards
- Pod Security Admission
- Pod/container securityContext
- runtime privilege reduction
- workload hardening patterns untuk Java
```

---

## 3. Threat Model yang Realistis untuk Java Workload

Jangan mulai security dari daftar fitur. Mulai dari threat model.

Misal workload:

```text
Service: payment-api
Runtime: Java 21, Spring Boot
Dependency: PostgreSQL, Redis, Kafka
Ingress: public via Gateway
Secrets: DB credential, signing key, OAuth client secret
Namespace: payments-prod
```

Kemungkinan insiden:

```text
1. Remote code execution di dependency Java.
2. SSRF yang bisa mengakses internal service.
3. Credential leak dari log atau env var.
4. Deserialization bug menjalankan command di container.
5. Attacker mendapatkan shell via vulnerable admin endpoint.
6. CI pipeline push image yang salah atau malicious.
7. Developer memberi manifest terlalu privileged karena copy-paste.
8. Debug exception dibiarkan permanen di namespace production.
```

Pertanyaan security-nya bukan hanya:

```text
"Bisakah attacker masuk?"
```

Tetapi:

```text
"Jika attacker bisa menjalankan code di dalam process Java,
 apa saja yang masih bisa ia lakukan?"
```

Tanpa hardening, attacker mungkin bisa:

```text
- menulis file ke filesystem container
- membaca ServiceAccount token
- membaca env var secret
- membuka reverse shell
- menjalankan binary tambahan jika tersedia
- mengakses internal network bebas
- melakukan lateral movement ke service lain
- mencoba escape lewat kernel/container runtime vulnerability
- mengeksploitasi hostPath jika tersedia
- menggunakan capability berlebih
```

Dengan hardening yang baik, attacker tetap berbahaya, tetapi ruang geraknya lebih kecil:

```text
- tidak root
- tidak bisa privilege escalation
- tidak punya Linux capability tidak perlu
- root filesystem read-only
- ServiceAccount token tidak tersedia jika tidak diperlukan
- egress dibatasi NetworkPolicy
- secret exposure diminimalkan
- seccomp membatasi syscall surface
- admission policy mencegah manifest berbahaya
```

---

## 4. Pod Security Standards: Privileged, Baseline, Restricted

Kubernetes mendefinisikan **Pod Security Standards** sebagai profil keamanan Pod yang konsisten.

Ada tiga level utama:

```text
privileged
baseline
restricted
```

### 4.1 Privileged

`privileged` adalah level paling longgar.

Secara praktis:

```text
- hampir semua restriction dinonaktifkan
- cocok untuk trusted infrastructure workload tertentu
- tidak cocok untuk aplikasi bisnis normal
```

Contoh workload yang kadang membutuhkan hak tinggi:

```text
- CNI plugin
- CSI node plugin
- node monitoring agent tertentu
- security scanner node-level
- privileged debug daemon
```

Aplikasi Java normal hampir tidak pernah butuh `privileged`.

Jika service Java meminta `privileged: true`, anggap itu red flag besar kecuali ada justifikasi sangat kuat.

### 4.2 Baseline

`baseline` bertujuan mencegah privilege escalation yang umum, tetapi tetap mudah diadopsi untuk banyak workload.

Baseline biasanya cocok sebagai langkah awal untuk organisasi yang sedang migrasi dari cluster longgar ke cluster lebih aman.

Baseline mencegah banyak hal berbahaya seperti:

```text
- privileged container
- host namespaces tertentu
- hostPath tertentu
- capability berbahaya
- beberapa unsafe sysctls
```

Tetapi baseline belum seketat restricted.

### 4.3 Restricted

`restricted` adalah profil paling ketat untuk workload aplikasi umum.

Tujuannya:

```text
- menjalankan container dengan privilege minimal
- memaksa non-root atau konfigurasi equivalent
- membatasi capability
- memakai seccomp yang aman
- mengurangi write surface
```

Untuk Java microservice modern, target ideal biasanya:

```text
restricted-compatible by default
```

Namun, ada realitas:

```text
- image lama mungkin masih berjalan sebagai root
- app menulis ke direktori yang salah
- library native butuh permission tertentu
- init container melakukan chown
- sidecar vendor belum restricted-compatible
```

Jadi strategi matang bukan “langsung enforce restricted di semua namespace production besok”, tetapi:

```text
1. audit dulu
2. warn dulu
3. fix manifest dan image
4. enforce di namespace baru
5. gradually enforce di namespace lama
6. exception harus eksplisit, terukur, dan punya expiry
```

---

## 5. Pod Security Admission

**Pod Security Admission** adalah admission controller bawaan Kubernetes untuk menerapkan Pod Security Standards pada namespace.

Ia bekerja saat Pod dibuat atau diubah.

Konfigurasi umum dilakukan lewat label namespace:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

Ada tiga mode penting:

```text
enforce:
  Pod yang melanggar policy ditolak.

audit:
  Pelanggaran dicatat di audit log, tetapi request tidak ditolak.

warn:
  User menerima warning saat melakukan request, tetapi request tidak ditolak.
```

### 5.1 Strategi Rollout PSA

Untuk namespace existing:

```text
Phase 1 — Discover
  warn=restricted
  audit=restricted
  enforce=baseline atau kosong

Phase 2 — Stabilize
  fix manifest, image, sidecar, init container
  remove privileged setting yang tidak perlu
  add securityContext default

Phase 3 — Enforce baseline
  enforce=baseline
  warn=restricted
  audit=restricted

Phase 4 — Enforce restricted untuk app namespace
  enforce=restricted
  audit=restricted
  warn=restricted

Phase 5 — Exception governance
  namespace khusus untuk privileged infra workload
  exception documented
  expiry owner jelas
```

### 5.2 Namespace Classification

Contoh desain:

```text
kube-system:
  enforce=privileged atau dikelola provider
  hanya untuk system components

platform-observability:
  enforce=baseline
  beberapa DaemonSet mungkin butuh exception

payments-prod:
  enforce=restricted
  app Java normal

payments-dev:
  enforce=baseline dulu, warn=restricted
  agar developer bisa melihat warning sebelum production

sandbox:
  enforce=baseline
  quota ketat
  tidak boleh akses secret production
```

Jangan jadikan semua namespace privileged karena satu DaemonSet butuh privilege.

Lebih baik pisahkan:

```text
- app namespaces restricted
- infrastructure namespaces controlled separately
- privileged workload hanya dikelola platform team
```

---

## 6. securityContext: Pod-Level vs Container-Level

`securityContext` bisa muncul di dua level:

```text
Pod-level securityContext:
  default untuk seluruh container di Pod.

Container-level securityContext:
  override atau field yang spesifik container.
```

Contoh baseline Java service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments-prod
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
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
          image: registry.example.com/payments/payment-api:1.42.0
          ports:
            - name: http
              containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: app-cache
              mountPath: /app/cache
      volumes:
        - name: tmp
          emptyDir: {}
        - name: app-cache
          emptyDir: {}
```

Perhatikan beberapa hal:

```text
- root filesystem read-only, tetapi /tmp dan /app/cache diberi emptyDir.
- ServiceAccount token tidak di-mount jika app tidak butuh Kubernetes API.
- Container tidak boleh privilege escalation.
- Semua Linux capabilities di-drop.
- seccomp RuntimeDefault dipakai.
- App berjalan sebagai UID/GID non-root.
```

Ini pattern sangat cocok untuk banyak Java API.

---

## 7. Field securityContext yang Harus Dikuasai

### 7.1 runAsNonRoot

```yaml
securityContext:
  runAsNonRoot: true
```

Makna:

```text
Container harus berjalan sebagai user non-root.
Jika image default user adalah root dan tidak ada runAsUser non-root,
Pod bisa gagal start.
```

Ini bagus karena memaksa image discipline.

Namun hati-hati:

```text
runAsNonRoot: true
```

tidak otomatis memilih user. Ia hanya menyatakan policy.

Lebih eksplisit:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
```

### 7.2 runAsUser dan runAsGroup

```yaml
securityContext:
  runAsUser: 10001
  runAsGroup: 10001
```

Makna:

```text
Process utama container berjalan sebagai UID/GID tertentu.
```

Praktik baik:

```text
- gunakan UID numeric, bukan nama user
- hindari UID 0
- gunakan UID konsisten di image dan manifest
- pastikan direktori yang perlu ditulis punya permission sesuai
```

Kenapa numeric?

Karena Kubernetes/runtime bekerja pada UID/GID. Nama user di `/etc/passwd` image bisa tidak tersedia atau berbeda.

### 7.3 fsGroup

```yaml
securityContext:
  fsGroup: 10001
```

Makna:

```text
Volume tertentu dapat dimount dengan group ownership yang memungkinkan process menulis.
```

Ini sering relevan untuk:

```text
- mounted Secret/ConfigMap tertentu
- PVC
- emptyDir
- app yang butuh write directory bersama
```

Trade-off:

```text
- fsGroup bisa menyebabkan recursive permission change pada volume tertentu
- pada volume besar, ini bisa memperlambat startup
- storage driver behavior bisa berbeda
```

### 7.4 readOnlyRootFilesystem

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Makna:

```text
Filesystem root dari container image tidak bisa ditulis.
```

Ini sangat powerful karena banyak exploit mencoba drop file, binary, script, atau modify config runtime.

Tetapi Java app sering menulis ke:

```text
- /tmp
- working directory
- log directory jika tidak stdout
- cache directory
- generated files
- native library extraction path
```

Solusinya bukan mematikan read-only root filesystem, tetapi menyediakan writable mount eksplisit:

```yaml
volumes:
  - name: tmp
    emptyDir: {}

volumeMounts:
  - name: tmp
    mountPath: /tmp
```

Jika app butuh direktori cache:

```yaml
volumes:
  - name: cache
    emptyDir: {}

volumeMounts:
  - name: cache
    mountPath: /app/cache
```

Design invariant:

```text
Semua path writable harus disengaja dan terlihat di manifest.
```

### 7.5 allowPrivilegeEscalation

```yaml
securityContext:
  allowPrivilegeEscalation: false
```

Makna:

```text
Process tidak boleh memperoleh privilege lebih tinggi dari parent process.
```

Ini terkait Linux `no_new_privs`.

Untuk aplikasi Java biasa, harus false.

Jika ada workload butuh true, pertanyaannya:

```text
- kenapa aplikasi butuh privilege escalation?
- apakah ini sebenarnya infrastructure workload?
- apakah image menjalankan setuid binary?
- apakah desainnya bisa diubah?
```

### 7.6 capabilities

Linux capabilities memecah root privilege menjadi kemampuan granular.

Contoh capability:

```text
NET_ADMIN
SYS_ADMIN
CHOWN
DAC_OVERRIDE
NET_BIND_SERVICE
```

Manifest aman:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

Untuk Java service normal:

```text
drop ALL biasanya bisa.
```

Kasus umum yang kadang muncul:

```text
Aplikasi ingin bind ke port 80 atau 443.
```

Solusi terbaik di Kubernetes:

```text
Jangan bind container ke port rendah.
Gunakan containerPort 8080/8443,
Service/Gateway expose port 80/443 di luar.
```

Jangan menambah `NET_BIND_SERVICE` kecuali benar-benar perlu.

### 7.7 privileged

```yaml
securityContext:
  privileged: true
```

Ini hampir selalu tidak boleh untuk aplikasi bisnis.

Efeknya sangat besar: container mendapatkan privilege tinggi terhadap host.

Untuk Java app:

```text
privileged: true = hampir pasti desain salah.
```

### 7.8 seccompProfile

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

Seccomp membatasi syscall yang boleh dipakai process.

Pilihan umum:

```text
RuntimeDefault:
  gunakan profil default runtime container.

Unconfined:
  tanpa pembatasan seccomp.
  hindari untuk workload biasa.

Localhost:
  profil custom di node.
  advanced use case.
```

Untuk Java workload:

```text
RuntimeDefault adalah default target yang sehat.
```

### 7.9 procMount

`procMount` mengontrol bagaimana `/proc` dimount.

Untuk workload biasa, jangan pakai konfigurasi yang membuka terlalu banyak informasi host.

### 7.10 seLinuxOptions / appArmorProfile

Di environment tertentu, SELinux atau AppArmor bisa menjadi lapisan tambahan.

Untuk Java engineer, pahami prinsipnya:

```text
securityContext dapat mengikat container ke mandatory access control profile,
yang membatasi file/process/network behavior lebih jauh.
```

Namun detail implementasinya bergantung distro/node/runtime/provider.

---

## 8. Baseline Manifest Hardening untuk Java API

Berikut contoh baseline untuk service Java yang tidak perlu Kubernetes API.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: orders-prod
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/part-of: order-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-api
        app.kubernetes.io/part-of: order-platform
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
          image: registry.example.com/orders/order-api:2026.06.20-1
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:+ExitOnOutOfMemoryError
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1024Mi"
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 5
            failureThreshold: 24
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: app-cache
              mountPath: /app/cache
      volumes:
        - name: tmp
          emptyDir: {}
        - name: app-cache
          emptyDir: {}
```

Security decisions:

```text
automountServiceAccountToken: false
  App tidak memakai Kubernetes API, jadi token tidak perlu tersedia.

runAsNonRoot + runAsUser
  RCE tidak langsung menjadi root dalam container.

readOnlyRootFilesystem
  Write path harus eksplisit.

capabilities.drop ALL
  Tidak ada Linux capability tambahan.

seccomp RuntimeDefault
  Syscall surface dibatasi runtime default.

No hostNetwork, hostPID, hostIPC, hostPath
  App tidak menyentuh namespace/resource host.
```

---

## 9. Pattern untuk Worker Java / Kafka Consumer / RabbitMQ Consumer

Worker Java biasanya mirip API service dari sisi security, tetapi punya lifecycle berbeda.

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: invoice-worker
  namespace: billing-prod
spec:
  replicas: 4
  selector:
    matchLabels:
      app.kubernetes.io/name: invoice-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: invoice-worker
    spec:
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: worker
          image: registry.example.com/billing/invoice-worker:1.18.3
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

Security-specific notes:

```text
- Worker tidak perlu expose port publik.
- Worker sering tetap butuh health endpoint internal, tapi tidak perlu external route.
- Worker tidak otomatis butuh Kubernetes API token.
- Worker harus punya egress hanya ke broker/dependency yang diperlukan.
- Secret broker credential harus dibatasi scope-nya.
```

Hardening tambahan dengan NetworkPolicy akan dibahas lebih detail di part terkait policy/security lebih lanjut, tetapi prinsipnya:

```text
Worker invoice tidak perlu bebas connect ke semua namespace.
Ia butuh connect ke broker, database tertentu, observability endpoint, dan mungkin config/secret provider.
```

---

## 10. Pattern untuk Job dan CronJob

Job/CronJob sering diabaikan secara security karena dianggap sementara.

Padahal Job sering punya privilege bisnis tinggi:

```text
- migration DB
- batch settlement
- reconciliation
- report generation
- data repair
- index rebuild
- cleanup
```

Security risk:

```text
Job pendek umur, tetapi token/secret yang dipakai bisa sangat powerful.
```

Baseline Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: order-reconciliation-20260620
  namespace: orders-prod
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: job
          image: registry.example.com/orders/reconciliation-job:2026.06.20
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

Jika Job butuh Kubernetes API, misalnya membuat object atau membaca ConfigMap:

```text
- gunakan ServiceAccount khusus Job
- Role sangat sempit
- jangan pakai default ServiceAccount
- jangan beri cluster-wide access jika hanya namespace-scoped
- token lifetime pendek jika memakai projected token
```

---

## 11. ServiceAccount Token: Runtime Secret yang Sering Terlupakan

Secara historis, banyak Pod otomatis mendapatkan ServiceAccount token di filesystem.

Jika aplikasi tidak menggunakan Kubernetes API, token ini tidak perlu ada.

```yaml
spec:
  automountServiceAccountToken: false
```

Kenapa penting?

Jika attacker mendapat RCE di aplikasi Java dan token tersedia, ia bisa mencoba:

```text
- membaca Kubernetes API sesuai RBAC ServiceAccount
- list Pod/Service/ConfigMap jika diizinkan
- membaca Secret jika RBAC salah
- melakukan lateral movement lewat informasi cluster
```

Hardening rule:

```text
Default untuk aplikasi bisnis: automountServiceAccountToken: false.
Enable hanya jika benar-benar butuh Kubernetes API.
```

Jika butuh token:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: order-controller-sa
  namespace: orders-prod
```

Lalu Role minimal:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: order-controller-read-config
  namespace: orders-prod
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
```

Dan binding:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: order-controller-read-config
  namespace: orders-prod
subjects:
  - kind: ServiceAccount
    name: order-controller-sa
    namespace: orders-prod
roleRef:
  kind: Role
  name: order-controller-read-config
  apiGroup: rbac.authorization.k8s.io
```

---

## 12. Host Namespace dan Host Filesystem: Red Flags Besar

Beberapa field yang harus sangat dicurigai pada aplikasi biasa:

```yaml
spec:
  hostNetwork: true
  hostPID: true
  hostIPC: true
```

Dan:

```yaml
volumes:
  - name: host
    hostPath:
      path: /var/run/docker.sock
```

Atau:

```yaml
volumes:
  - name: host-root
    hostPath:
      path: /
```

Risikonya:

```text
hostNetwork:
  Pod masuk ke network namespace host.
  Port conflict dan visibility meningkat.

hostPID:
  Pod bisa melihat process host.

hostIPC:
  Pod berbagi IPC namespace host.

hostPath:
  Pod bisa membaca/menulis path host jika permission memungkinkan.
  Sangat berbahaya jika path sensitif.

/var/run/docker.sock atau container runtime socket:
  Sering setara dengan kontrol host/container runtime.
```

Untuk Java service normal:

```text
hostNetwork/hostPID/hostIPC/hostPath hampir selalu tidak diperlukan.
```

Infrastructure workload mungkin butuh, tetapi harus di namespace khusus dan dikelola platform/security team.

---

## 13. Writable Filesystem Strategy untuk Java

Banyak aplikasi Java historically menganggap filesystem writable.

Contoh write path:

```text
/tmp
logs/
uploads/
cache/
work/
compiled templates
native library extraction
```

Di Kubernetes hardened workload, root filesystem sebaiknya read-only.

Jadi desain path harus eksplisit:

```text
Path ephemeral:
  emptyDir

Path persistent:
  PVC

Path config:
  ConfigMap/Secret mounted read-only

Path log:
  stdout/stderr preferred
```

Contoh:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: work
    mountPath: /app/work
  - name: config
    mountPath: /app/config
    readOnly: true

volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 512Mi
  - name: work
    emptyDir:
      sizeLimit: 1Gi
  - name: config
    configMap:
      name: order-api-config
```

Untuk Spring Boot:

```text
- arahkan temp dir jika perlu: -Djava.io.tmpdir=/tmp
- jangan menulis log ke file lokal kecuali ada alasan kuat
- gunakan stdout/stderr untuk log pipeline Kubernetes
- pastikan upload besar tidak menumpuk di emptyDir tanpa sizeLimit
```

---

## 14. Image Design yang Mendukung Pod Security

Walaupun part ini bukan mengulang Docker, ada beberapa konsekuensi image yang penting.

Image yang security-friendly:

```text
- punya user non-root
- file ownership benar
- tidak butuh write ke root filesystem
- tidak membawa shell/debug tool berlebihan jika production image
- tidak menjalankan process sebagai root
- expose port non-privileged seperti 8080
- dependency minimal
```

Contoh Dockerfile pattern konseptual:

```dockerfile
FROM eclipse-temurin:21-jre

RUN groupadd -g 10001 app && useradd -u 10001 -g app app
WORKDIR /app
COPY --chown=10001:10001 app.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Catatan:

```text
- Detail Dockerfile sudah dibahas di seri Docker, jadi tidak didalami di sini.
- Yang penting: manifest Kubernetes dan image harus saling cocok.
```

Jika manifest menyatakan:

```yaml
runAsNonRoot: true
runAsUser: 10001
readOnlyRootFilesystem: true
```

tetapi image:

```text
- hanya bisa jalan sebagai root
- menulis ke /app
- butuh chmod/chown saat startup
```

maka Pod akan gagal atau app error.

Security bukan hanya manifest. Security adalah kontrak antara:

```text
image + manifest + runtime + policy + app behavior
```

---

## 15. Sidecar dan Init Container: Jangan Lupa Mereka Juga Bagian dari Pod

Pod Security berlaku pada seluruh Pod.

Jika app container sudah hardened tetapi sidecar masih privileged, Pod tetap lemah.

Contoh sidecar risk:

```text
- log shipper sidecar berjalan root
- service mesh proxy butuh config khusus
- init container melakukan chown sebagai root
- migration init container punya DB superuser credential
- secret agent sidecar menulis secret ke shared volume
```

Checklist sidecar/init:

```text
- Apakah sidecar butuh ServiceAccount token?
- Apakah sidecar butuh write access ke shared volume?
- Apakah sidecar berjalan non-root?
- Apakah sidecar drop capabilities?
- Apakah init container privileged hanya untuk chmod/chown?
- Apakah permission bisa diselesaikan di image build time?
- Apakah secret yang diambil sidecar bisa dibaca app container lain?
```

Anti-pattern:

```text
Aplikasi hardened, tetapi init container root mengubah permission volume secara luas,
dan sidecar punya token/RBAC lebih besar.
```

Pod adalah unit security bersama. Jangan hanya audit container utama.

---

## 16. Debugging Pod yang Ditolak Pod Security Admission

Gejala:

```bash
kubectl apply -f deployment.yaml
```

Output mungkin berisi warning atau error seperti:

```text
violates PodSecurity "restricted:latest":
allowPrivilegeEscalation != false,
unrestricted capabilities,
runAsNonRoot != true,
seccompProfile
```

Langkah debugging:

```bash
kubectl get namespace payments-prod --show-labels
```

Cari label:

```text
pod-security.kubernetes.io/enforce
pod-security.kubernetes.io/audit
pod-security.kubernetes.io/warn
```

Lihat manifest Pod template:

```bash
kubectl get deploy payment-api -n payments-prod -o yaml
```

Jika Deployment sudah ada tetapi ReplicaSet gagal create Pod:

```bash
kubectl describe rs -n payments-prod
kubectl get events -n payments-prod --sort-by=.lastTimestamp
```

Jika policy warn saja:

```text
request tetap diterima tetapi warning muncul.
Jangan abaikan warning; itu sinyal future enforce akan gagal.
```

---

## 17. Debugging Container Gagal karena runAsNonRoot

Gejala:

```text
Error: container has runAsNonRoot and image will run as root
```

Penyebab:

```text
- image default USER root
- manifest tidak menentukan runAsUser non-root
- image metadata tidak menyatakan user non-root
```

Solusi:

```text
1. Perbaiki image agar USER non-root.
2. Atau set runAsUser numeric non-root di manifest.
3. Pastikan file/directory permission cocok.
```

Contoh manifest:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
```

Jika app kemudian gagal permission:

```bash
kubectl logs <pod> -n <namespace>
```

Cari error:

```text
Permission denied
Read-only file system
Cannot create temp file
Unable to write logs
```

Lalu jangan langsung revert ke root. Temukan path yang perlu writable dan mount eksplisit.

---

## 18. Debugging readOnlyRootFilesystem

Gejala log Java:

```text
java.io.IOException: Read-only file system
java.nio.file.AccessDeniedException
Unable to create temp file
```

Langkah:

```text
1. Identifikasi path yang ditulis.
2. Tanyakan apakah path itu harus ephemeral, persistent, atau sebenarnya tidak perlu.
3. Tambahkan emptyDir/PVC ke path spesifik.
4. Jangan mematikan readOnlyRootFilesystem kecuali ada alasan kuat.
```

Contoh fix:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 256Mi
```

Untuk Java:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: "-Djava.io.tmpdir=/tmp"
```

---

## 19. Debugging Capability Issue

Jika semua capabilities di-drop, beberapa aplikasi native mungkin gagal.

Gejala:

```text
operation not permitted
permission denied
cannot bind to port 80
```

Langkah:

```text
1. Pastikan container tidak bind port <1024.
2. Ubah app port ke 8080.
3. Expose port 80/443 di Service/Gateway, bukan container process.
4. Jika benar-benar perlu capability, tambahkan satu capability spesifik, bukan privileged.
```

Contoh menambah capability spesifik, jika benar-benar diperlukan:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
    add:
      - NET_BIND_SERVICE
```

Tetapi untuk Java API di Kubernetes, lebih baik:

```text
containerPort: 8080
Service port: 80 -> targetPort: 8080
Gateway/Ingress TLS/HTTP exposure di edge
```

---

## 20. Debugging seccomp Issue

Jika `seccompProfile: RuntimeDefault` menyebabkan failure, biasanya ada native operation atau dependency yang memakai syscall yang diblokir.

Gejala:

```text
operation not permitted
seccomp violation di node/runtime logs
process exits unexpectedly
```

Langkah:

```text
1. Reproduce di staging.
2. Identifikasi syscall/native library.
3. Upgrade dependency/runtime jika bug lama.
4. Hindari langsung Unconfined untuk production app.
5. Jika butuh custom profile, kelola sebagai exception platform-level.
```

Untuk Java murni, RuntimeDefault biasanya aman.

---

## 21. Relationship dengan NetworkPolicy

Pod Security tidak mengontrol kemana Pod boleh connect.

Contoh:

```text
Pod restricted masih bisa melakukan egress ke seluruh cluster/internet
jika NetworkPolicy/CNI tidak membatasi.
```

Jadi untuk workload hardening lengkap:

```text
Pod Security:
  batasi privilege runtime.

RBAC:
  batasi akses Kubernetes API.

NetworkPolicy:
  batasi komunikasi network.

Secret management:
  batasi credential.

Admission policy:
  batasi object yang boleh dibuat.
```

Contoh threat:

```text
RCE terjadi pada order-api.
Pod sudah non-root dan read-only.
Tetapi egress terbuka.
Attacker masih bisa scan internal service dan exfiltrate data.
```

Jadi restricted Pod bukan akhir security.

---

## 22. Relationship dengan Secrets

Pod Security mengurangi runtime privilege, tetapi tidak otomatis mencegah secret leak.

Jika Secret dimount sebagai env var:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: order-db
        key: password
```

Maka process Java bisa membaca env var. Jika RCE terjadi, attacker juga bisa membaca env var.

Hardening principle:

```text
- mount secret hanya ke workload yang perlu
- jangan mount semua secret namespace
- jangan beri RBAC read Secret ke app biasa
- rotate secret
- kurangi lifetime credential
- pertimbangkan workload identity/external secret manager
- jangan log env/config penuh
```

Pod Security membantu mengurangi damage, tetapi secret exposure tetap harus didesain.

---

## 23. Relationship dengan Admission Policy Lain

Pod Security Admission hanya menerapkan Pod Security Standards.

Organisasi biasanya butuh policy tambahan seperti:

```text
- semua container harus punya resource requests/limits
- image harus dari registry internal
- image tag tidak boleh latest
- label wajib ada
- ServiceAccount token default harus false untuk app namespace
- hostPath dilarang kecuali namespace khusus
- privileged dilarang kecuali allowlist
- runAsNonRoot wajib
- NetworkPolicy wajib ada
```

Ini bisa dilakukan dengan:

```text
- ValidatingAdmissionPolicy
- Kyverno
- OPA Gatekeeper
- custom admission webhook
```

Part policy lebih dalam akan dibahas di Part 025.

---

## 24. Workload Hardening Matrix

| Control | Java API | Java Worker | Batch Job | Platform Agent |
|---|---:|---:|---:|---:|
| runAsNonRoot | wajib | wajib | wajib | tergantung |
| readOnlyRootFilesystem | sangat disarankan | sangat disarankan | sangat disarankan | tergantung |
| allowPrivilegeEscalation=false | wajib | wajib | wajib | tergantung |
| drop capabilities ALL | wajib | wajib | wajib | tergantung |
| seccomp RuntimeDefault | wajib | wajib | wajib | tergantung |
| automountServiceAccountToken=false | default | default | default | tergantung |
| hostNetwork=false | wajib | wajib | wajib | mungkin true untuk agent tertentu |
| hostPID=false | wajib | wajib | wajib | mungkin true untuk agent tertentu |
| hostPath forbidden | wajib | wajib | wajib | mungkin perlu untuk agent tertentu |
| privileged=false | wajib | wajib | wajib | mungkin perlu untuk CNI/CSI/security agent |
| NetworkPolicy egress restricted | disarankan kuat | disarankan kuat | disarankan kuat | tergantung |

Intinya:

```text
Aplikasi bisnis harus restricted by default.
Infrastructure workload harus exception by design, bukan by accident.
```

---

## 25. Common Anti-Patterns

### Anti-Pattern 1 — Semua Namespace `privileged`

```text
Karena satu agent butuh privilege, semua namespace diberi enforce=privileged.
```

Dampak:

```text
- aplikasi bisnis bisa membuat Pod berbahaya
- policy boundary hilang
- audit sulit
```

Solusi:

```text
- pisahkan namespace infrastructure
- app namespace baseline/restricted
- exception explicit
```

### Anti-Pattern 2 — `privileged: true` untuk Memperbaiki Permission

Masalah sebenarnya:

```text
Permission denied saat app menulis file.
```

Fix buruk:

```yaml
securityContext:
  privileged: true
```

Fix benar:

```text
- jalankan sebagai UID non-root
- set ownership image benar
- mount writable path eksplisit
- gunakan fsGroup jika perlu
```

### Anti-Pattern 3 — Root Filesystem Writable Tanpa Alasan

```text
"Biar gampang debug."
```

Dampak:

```text
- exploit bisa menulis file
- runtime drift
- forensic lebih sulit
```

Solusi:

```text
readOnlyRootFilesystem: true
emptyDir hanya untuk path spesifik
```

### Anti-Pattern 4 — Default ServiceAccount Dipakai Semua Aplikasi

```text
Semua Pod memakai default ServiceAccount.
```

Dampak:

```text
- privilege sulit diaudit
- satu perubahan RBAC berdampak banyak app
- token tersedia walaupun app tidak butuh
```

Solusi:

```text
- automountServiceAccountToken: false untuk app biasa
- ServiceAccount khusus jika perlu
- Role minimal
```

### Anti-Pattern 5 — Security Exception Permanen

```text
Namespace diberi enforce=baseline sementara, lalu dilupakan 2 tahun.
```

Solusi:

```text
- exception punya owner
- alasan jelas
- expiry date
- tracking ticket
- periodic review
```

### Anti-Pattern 6 — Hanya Container Utama yang Diaudit

```text
App container aman, sidecar privileged.
```

Solusi:

```text
Audit seluruh Pod template:
- initContainers
- containers
- ephemeralContainers
- volumes
- ServiceAccount
- securityContext
```

---

## 26. Production Checklist untuk Java Workload

### 26.1 Namespace Policy

```text
[ ] Namespace app punya Pod Security Admission label.
[ ] Production app namespace minimal enforce=baseline.
[ ] Target app namespace enforce=restricted.
[ ] warn/audit restricted aktif selama transisi.
[ ] Namespace infrastructure dipisahkan dari namespace app.
[ ] Exception namespace terdokumentasi.
```

### 26.2 Pod-Level Security

```text
[ ] automountServiceAccountToken=false jika app tidak butuh Kubernetes API.
[ ] runAsNonRoot=true.
[ ] runAsUser numeric non-root.
[ ] runAsGroup numeric non-root.
[ ] seccompProfile=RuntimeDefault.
[ ] hostNetwork=false.
[ ] hostPID=false.
[ ] hostIPC=false.
[ ] Tidak memakai hostPath.
```

### 26.3 Container-Level Security

```text
[ ] allowPrivilegeEscalation=false.
[ ] readOnlyRootFilesystem=true.
[ ] capabilities.drop=[ALL].
[ ] privileged=false.
[ ] Container bind ke port non-privileged seperti 8080.
[ ] Writable path eksplisit via emptyDir/PVC.
```

### 26.4 Image Compatibility

```text
[ ] Image bisa berjalan sebagai non-root.
[ ] File ownership cocok dengan UID runtime.
[ ] Tidak butuh write ke /app atau root filesystem.
[ ] Tidak butuh shell/debug tools di production image.
[ ] Tidak memakai tag latest.
```

### 26.5 Runtime Behavior

```text
[ ] /tmp tersedia jika Java/native lib butuh temp file.
[ ] Log ke stdout/stderr.
[ ] Upload/cache path dibatasi sizeLimit jika ephemeral.
[ ] App tidak bergantung pada chmod/chown saat startup.
[ ] Graceful shutdown tetap berfungsi tanpa privilege tambahan.
```

### 26.6 Governance

```text
[ ] Policy violation terlihat di CI atau admission warning.
[ ] Security exception punya owner dan expiry.
[ ] Manifest di-review sebelum production.
[ ] Privileged workload hanya dikelola platform team.
[ ] Audit dilakukan untuk initContainer dan sidecar juga.
```

---

## 27. Latihan Praktis

### Latihan 1 — Audit Manifest

Ambil Deployment Java yang sudah kamu punya. Jawab:

```text
- Apakah Pod memakai default ServiceAccount?
- Apakah token otomatis dimount?
- Apakah container berjalan sebagai root?
- Apakah root filesystem writable?
- Apakah capabilities di-drop?
- Apakah seccomp RuntimeDefault?
- Apakah ada hostPath?
- Apakah ada initContainer/sidecar yang lebih privileged?
```

### Latihan 2 — Buat Namespace Restricted

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: security-lab
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
```

Apply Pod yang sengaja melanggar:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: bad-pod
  namespace: security-lab
spec:
  containers:
    - name: app
      image: nginx
      securityContext:
        privileged: true
```

Amati error/warning.

### Latihan 3 — Harden Deployment

Mulai dari Deployment sederhana:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: demo-api
  template:
    metadata:
      labels:
        app: demo-api
    spec:
      containers:
        - name: app
          image: demo-api:local
          ports:
            - containerPort: 8080
```

Tambahkan:

```text
- automountServiceAccountToken=false
- runAsNonRoot
- runAsUser/runAsGroup
- seccomp RuntimeDefault
- allowPrivilegeEscalation=false
- readOnlyRootFilesystem=true
- capabilities.drop ALL
- emptyDir /tmp
```

### Latihan 4 — Debug readOnlyRootFilesystem

Buat app yang menulis ke `/app/output.txt`. Jalankan dengan `readOnlyRootFilesystem=true`.

Tugas:

```text
- amati error
- pindahkan output ke /tmp/output.txt
- mount emptyDir ke /tmp
- jalankan ulang
```

Tujuannya memahami bahwa securityContext bukan teori; ia mengubah behavior runtime.

---

## 28. Mental Model Akhir

Ada tiga lapisan penting:

```text
1. Admission-time policy
   Apakah Pod seperti ini boleh dibuat?

2. Runtime security context
   Dengan privilege apa process berjalan?

3. Blast-radius design
   Jika process compromised, seberapa jauh damage bisa menyebar?
```

Untuk Java service modern:

```text
Default ideal:
  non-root
  no privilege escalation
  drop all capabilities
  read-only root filesystem
  explicit writable volumes
  seccomp RuntimeDefault
  no host namespace
  no hostPath
  no ServiceAccount token unless needed
  restricted namespace policy
```

Kalimat penting:

```text
Kubernetes tidak otomatis membuat workload aman.
Kubernetes menyediakan mekanisme agar platform bisa menolak workload berisiko
sebelum workload itu menjadi insiden.
```

---

## 29. Ringkasan

Di part ini kita membahas:

```text
- perbedaan RBAC dan Pod runtime security
- threat model realistis untuk Java workload
- Pod Security Standards: privileged, baseline, restricted
- Pod Security Admission dan namespace labels
- securityContext level Pod dan container
- runAsNonRoot, runAsUser, fsGroup
- readOnlyRootFilesystem dan writable path eksplisit
- allowPrivilegeEscalation
- Linux capabilities
- seccomp RuntimeDefault
- ServiceAccount token hardening
- host namespace dan hostPath sebagai red flag
- sidecar/init container sebagai bagian dari Pod attack surface
- debugging policy violation dan permission issue
- production checklist untuk Java workload
```

Kubernetes security yang matang bukan hanya “jangan pakai root”. Ia adalah disiplin desain agar setiap workload punya privilege sekecil mungkin, exception terkontrol, dan runtime behavior tetap bisa dioperasikan.

---

## 30. Status Seri

```text
Seri belum selesai.
Part saat ini: 019 dari 035.
Part berikutnya: 020 — Secrets, Certificates, TLS, and Supply Chain Security.
```

Part berikutnya akan membahas lapisan keamanan yang berhubungan dengan Secret, certificate, TLS, registry trust, image provenance, SBOM, signing, secret rotation, dan supply-chain risk untuk workload Kubernetes.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — RBAC, ServiceAccount, Authentication, and Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-020.md">Part 020 — Secrets, Certificates, TLS, and Supply Chain Security ➡️</a>
</div>
