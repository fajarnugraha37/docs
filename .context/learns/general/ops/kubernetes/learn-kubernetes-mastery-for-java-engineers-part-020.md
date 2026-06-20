# learn-kubernetes-mastery-for-java-engineers-part-020.md

# Part 020 — Secrets, Certificates, TLS, and Supply Chain Security

## 1. Tujuan Part Ini

Part ini membahas keamanan material sensitif dan rantai pasok aplikasi di Kubernetes. Setelah memahami RBAC dan Pod Security, kita masuk ke area yang sering menjadi sumber insiden production: credential bocor, certificate expired, image tidak terpercaya, secret rotation gagal, private registry credential tersebar, dan admission policy tidak menutup jalur risiko yang benar.

Target setelah menyelesaikan part ini:

1. Memahami `Secret` bukan sebagai fitur enkripsi otomatis, tetapi sebagai object Kubernetes untuk mendistribusikan sensitive material ke workload.
2. Memahami jalur kebocoran Secret dari Git, API server, etcd, RBAC, manifest, env var, mounted file, log, crash dump, debug endpoint, dan backup.
3. Membedakan TLS untuk ingress, mTLS antar-service, TLS ke dependency, dan certificate untuk Kubernetes control plane.
4. Mendesain pola secret consumption yang cocok untuk Java service.
5. Mendesain rotation strategy yang tidak sekadar mengganti object Secret, tetapi memastikan aplikasi benar-benar memakai credential baru.
6. Memahami supply chain security dari source code, build, image, registry, signature, SBOM, scanning, admission, sampai runtime.
7. Mampu membuat checklist production untuk secret, certificate, dan image trust.

Kita tidak akan mengulang kriptografi dasar, TLS dasar, Docker image layer dasar, atau CI/CD dasar. Fokus part ini adalah bagaimana semua itu berinteraksi dengan Kubernetes sebagai control plane.

---

## 2. Mental Model Utama

### 2.1 Secret Is a Distribution Mechanism, Not a Complete Security System

Kubernetes `Secret` adalah object untuk menyimpan dan mendistribusikan data sensitif seperti password, token, SSH key, certificate, registry credential, dan bootstrap credential. Namun `Secret` bukan otomatis berarti data aman di semua tempat.

Secret dapat bocor melalui:

- repository manifest,
- CI logs,
- `kubectl describe`,
- RBAC read permission,
- mounted files,
- environment variables,
- process dumps,
- Java exception logs,
- `/actuator/env` atau debug endpoint,
- etcd backup,
- node filesystem,
- image layer,
- Helm values,
- GitOps rendered manifests,
- support bundle,
- monitoring tags,
- crash reporting.

Jadi model yang benar:

```text
Secret object = Kubernetes-native delivery envelope
Security outcome = envelope + encryption + RBAC + admission + runtime handling + app behavior + rotation + audit
```

Kesalahan umum adalah menganggap:

```text
Secret = base64 = aman
```

Padahal base64 hanya encoding. Bukan encryption.

---

### 2.2 Sensitive Material Has a Lifecycle

Material sensitif bukan static config. Ia punya lifecycle:

```text
create -> store -> distribute -> consume -> rotate -> revoke -> audit -> delete
```

Di Kubernetes, lifecycle ini menyentuh beberapa layer:

```text
external secret source
  -> Kubernetes Secret / projected volume / CSI driver
  -> Pod
  -> Java process
  -> dependency connection
  -> logs/metrics/traces/errors
  -> rotation and revocation
```

Kegagalan sering terjadi karena hanya satu step yang dipikirkan. Contoh: team mengganti Secret di Kubernetes, tetapi Java app membaca credential dari env var saat startup, sehingga credential lama tetap dipakai sampai Pod restart.

---

### 2.3 Certificate Is Also Operational State

Certificate sering diperlakukan sebagai file statis. Di production, certificate adalah state operasional yang punya:

- issuer,
- subject,
- SAN,
- private key,
- trust chain,
- validity period,
- renewal window,
- rotation process,
- revocation strategy,
- consumer reload behavior.

Certificate failure sering bukan bug aplikasi, tetapi bug lifecycle:

```text
certificate issued -> mounted -> app loads once -> certificate renewed -> file changes -> app does not reload -> outage when old cert expires
```

---

### 2.4 Supply Chain Security Is About Controlling What Enters the Cluster

Kubernetes security bukan hanya “apa yang Pod boleh lakukan setelah jalan”, tetapi juga “apa yang boleh masuk ke cluster”.

Rantai pasok aplikasi biasanya:

```text
source code
  -> dependency resolution
  -> build
  -> test
  -> artifact
  -> container image
  -> registry
  -> manifest
  -> admission
  -> runtime
```

Setiap step bisa menjadi attack surface:

- dependency compromise,
- malicious build plugin,
- image tag overwritten,
- registry credential leak,
- unsigned image,
- vulnerable base image,
- manifest injection,
- overprivileged workload,
- debug image deployed to production.

Kubernetes admission control adalah tempat penting untuk enforce policy sebelum object masuk ke cluster.

---

## 3. Kubernetes Secret Fundamentals

### 3.1 Apa Itu Secret

`Secret` adalah Kubernetes object yang menyimpan key-value data sensitif. Kubernetes mendukung beberapa tipe Secret, misalnya:

- `Opaque`, untuk generic key-value.
- `kubernetes.io/tls`, untuk TLS certificate dan private key.
- `kubernetes.io/dockerconfigjson`, untuk registry pull credential.
- `kubernetes.io/service-account-token`, legacy/service-account token use case tertentu.
- `bootstrap.kubernetes.io/token`, untuk bootstrap token.
- `kubernetes.io/basic-auth`, untuk username/password.
- `kubernetes.io/ssh-auth`, untuk SSH credential.

Contoh generic Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-db-credentials
  namespace: payment-prod
type: Opaque
stringData:
  username: payment_app
  password: replace-me
```

`stringData` lebih nyaman untuk authoring karena menerima plaintext string dan API server akan mengubahnya ke `data` base64. Namun ini tidak berarti aman untuk disimpan di Git.

Contoh TLS Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-api-tls
  namespace: payment-prod
type: kubernetes.io/tls
data:
  tls.crt: <base64-certificate>
  tls.key: <base64-private-key>
```

Untuk Ingress TLS, Secret type `kubernetes.io/tls` biasanya perlu key `tls.crt` dan `tls.key`.

---

### 3.2 Secret Data Size dan Design Implication

Secret bukan object untuk file besar. Ia harus dipakai untuk data kecil seperti credential, token, certificate, atau config sensitif. Jika team mulai menyimpan bundle besar, truststore besar, atau konfigurasi kompleks di Secret, biasanya itu tanda desain perlu dievaluasi.

Pola yang lebih baik:

- credential kecil di Secret,
- konfigurasi non-sensitif di ConfigMap,
- binary besar di artifact repository atau image,
- certificate bundle dikelola lewat cert-manager/CSI/external secret manager,
- truststore Java dibangun atau diproyeksikan dengan strategi yang jelas.

---

### 3.3 Secret Namespace Boundary

Secret adalah namespaced object. Pod hanya bisa mereferensikan Secret dalam namespace yang sama.

Ini penting untuk platform design:

```text
namespace = boundary distribusi secret
```

Jika banyak aplikasi berbagi satu namespace, blast radius secret meningkat. App A mungkin tidak semestinya punya akses ke Secret app B, tetapi jika RBAC dan ServiceAccount kacau, namespace bersama membuat kebocoran lebih mudah terjadi.

---

## 4. Cara Secret Dikonsumsi Pod

### 4.1 Environment Variable

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api:1.42.0
          env:
            - name: DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: payment-db-credentials
                  key: username
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: payment-db-credentials
                  key: password
```

Keuntungan:

- mudah untuk aplikasi Java/Spring Boot,
- cocok dengan banyak framework,
- tidak perlu membaca file.

Kelemahan:

- env var dibaca saat process start,
- update Secret tidak mengubah env var running process,
- env var bisa terekspos lewat debug endpoint, thread dump, crash tooling, process inspection, atau library logging,
- banyak framework bisa menampilkan env di diagnostic endpoint jika tidak dikunci.

Rule of thumb:

```text
Env var cocok untuk secret yang hanya berubah dengan restart/rollout terkontrol.
Mounted file lebih cocok untuk material yang butuh reload/rotation.
```

---

### 4.2 Mounted Secret Volume

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api:1.42.0
          volumeMounts:
            - name: db-credentials
              mountPath: /var/run/secrets/payment-db
              readOnly: true
      volumes:
        - name: db-credentials
          secret:
            secretName: payment-db-credentials
```

Di container, aplikasi melihat file:

```text
/var/run/secrets/payment-db/username
/var/run/secrets/payment-db/password
```

Keuntungan:

- lebih baik untuk certificate/key file,
- bisa didesain untuk reload,
- lebih eksplisit sebagai file permission boundary,
- tidak otomatis masuk environment dump.

Kelemahan:

- aplikasi harus membaca file,
- update propagation tidak instan,
- banyak aplikasi Java membaca config hanya saat startup,
- jika memakai `subPath`, update Secret tidak otomatis terpropagasi ke mounted file.

---

### 4.3 Projected Volume

Projected volume memungkinkan beberapa sumber dipetakan ke satu directory, seperti Secret, ConfigMap, Downward API, dan ServiceAccount token.

Contoh konseptual:

```yaml
volumes:
  - name: app-runtime-context
    projected:
      sources:
        - secret:
            name: payment-db-credentials
        - configMap:
            name: payment-runtime-config
        - downwardAPI:
            items:
              - path: pod-name
                fieldRef:
                  fieldPath: metadata.name
```

Ini berguna untuk membuat satu directory runtime context:

```text
/var/run/app-context/
  username
  password
  pod-name
  application.yaml
```

Namun jangan mencampur data sensitif dan non-sensitif tanpa desain permission dan ownership yang jelas.

---

### 4.4 Secret as ImagePullSecrets

Private registry credential biasanya diberikan lewat `imagePullSecrets`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: regcred
  namespace: payment-prod
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <base64-json>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  template:
    spec:
      imagePullSecrets:
        - name: regcred
      containers:
        - name: app
          image: private-registry.example.com/payment-api:1.42.0
```

Risiko:

- credential registry sering terlalu luas,
- satu pull secret dipakai banyak namespace,
- credential tidak dirotasi,
- registry secret bisa dibaca oleh user yang punya RBAC Secret read,
- image tag mutable bisa membuat audit sulit.

Untuk production, prefer:

- workload identity / node identity / registry integration jika cloud mendukung,
- pull secret per environment atau per namespace,
- minimal registry scope,
- immutable image digest,
- admission policy untuk registry allowlist dan digest requirement.

---

## 5. Secret Storage and Protection Inside Kubernetes

### 5.1 Secret di etcd

Secara konseptual, Kubernetes API server menyimpan object termasuk Secret ke etcd. Jika etcd tidak dienkripsi at rest atau backup etcd tidak dilindungi, Secret bisa bocor dari storage layer.

Checklist:

- aktifkan encryption at rest untuk Secret,
- lindungi key encryption provider,
- lindungi backup etcd,
- batasi akses langsung ke etcd,
- audit siapa bisa `get/list/watch secrets`,
- jangan memberikan akses broad `list secrets` ke developer umum.

### 5.2 RBAC Risiko Besar: `list` dan `watch secrets`

Permission `get` Secret tertentu sudah sensitif. Permission `list` atau `watch` seluruh Secret di namespace jauh lebih sensitif.

Contoh Role yang berbahaya:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: namespace-debugger
  namespace: payment-prod
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec", "secrets"]
    verbs: ["get", "list", "watch"]
```

Masalah:

- semua Secret di namespace bisa dibaca,
- `pods/exec` memungkinkan membaca mounted secrets dari running Pod,
- `pods/log` bisa membaca secret jika aplikasi pernah melogging credential.

RBAC production harus memisahkan:

```text
read workload status != read secret value
read logs != exec into pod
deploy app != read runtime credentials
operate namespace != cluster-admin
```

---

## 6. Secret Handling untuk Java/Spring Boot

### 6.1 Environment Variable Pattern

Spring Boot mudah membaca env var:

```yaml
env:
  - name: SPRING_DATASOURCE_USERNAME
    valueFrom:
      secretKeyRef:
        name: payment-db-credentials
        key: username
  - name: SPRING_DATASOURCE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: payment-db-credentials
        key: password
```

Cocok untuk:

- credential yang berubah dengan restart rollout,
- service stateless,
- dependency connection pool yang tidak butuh hot-reload.

Perhatian:

- pastikan Actuator `/env` tidak exposed,
- sanitize config logging,
- jangan log property source,
- pastikan error message tidak mencetak JDBC URL dengan password,
- restart/rollout diperlukan saat Secret berubah.

---

### 6.2 File-Based Pattern

Untuk certificate, key, truststore, atau credential yang bisa direload:

```yaml
volumeMounts:
  - name: tls-material
    mountPath: /var/run/secrets/payment-tls
    readOnly: true
volumes:
  - name: tls-material
    secret:
      secretName: payment-client-tls
```

Aplikasi Java dapat membaca:

```text
/var/run/secrets/payment-tls/tls.crt
/var/run/secrets/payment-tls/tls.key
/var/run/secrets/payment-tls/ca.crt
```

Namun Java TLS sering membutuhkan `keystore`/`truststore` format tertentu. Ada beberapa pilihan:

1. Build truststore ke dalam image.
2. Mount certificate PEM lalu aplikasi/framework membaca PEM langsung.
3. Init container mengubah PEM menjadi JKS/PKCS12 di `emptyDir`.
4. Sidecar/agent mengelola certificate dan reload signal.
5. Service mesh menangani mTLS di proxy, bukan di aplikasi.

Contoh init container pattern:

```yaml
volumes:
  - name: tls-source
    secret:
      secretName: payment-client-tls
  - name: tls-runtime
    emptyDir: {}
initContainers:
  - name: build-truststore
    image: eclipse-temurin:21-jre
    command:
      - sh
      - -c
      - |
        keytool -importcert \
          -noprompt \
          -alias payment-ca \
          -file /source/ca.crt \
          -keystore /runtime/truststore.p12 \
          -storetype PKCS12 \
          -storepass changeit
    volumeMounts:
      - name: tls-source
        mountPath: /source
        readOnly: true
      - name: tls-runtime
        mountPath: /runtime
containers:
  - name: app
    image: registry.example.com/payment-api:1.42.0
    env:
      - name: JAVA_TOOL_OPTIONS
        value: >-
          -Djavax.net.ssl.trustStore=/runtime/truststore.p12
          -Djavax.net.ssl.trustStorePassword=changeit
          -Djavax.net.ssl.trustStoreType=PKCS12
    volumeMounts:
      - name: tls-runtime
        mountPath: /runtime
        readOnly: true
```

Catatan: password truststore di contoh hanya ilustrasi. Jangan gunakan nilai hardcoded sederhana untuk material sensitif production.

---

### 6.3 Reloadability Reality

Kubernetes dapat memperbarui mounted Secret volume, tetapi aplikasi belum tentu membaca ulang.

Untuk Java, banyak resource hanya dibaca saat startup:

- datasource password,
- TLS truststore,
- keystore,
- OAuth client secret,
- messaging credential,
- cache password.

Strategi umum:

```text
Strategy A: rotate secret -> rollout restart pods
Strategy B: app supports reload -> file watch/reload
Strategy C: sidecar reloads proxy/client credential
Strategy D: use short-lived identity token instead of static secret
Strategy E: externalize identity to platform/workload identity
```

Pilih strategi berdasarkan criticality dan complexity. Jangan mengklaim “rotation supported” jika aplikasi masih perlu restart manual tanpa runbook.

---

## 7. Secret Rotation Patterns

### 7.1 Rollout Restart Pattern

Pola paling sederhana:

```text
1. Update Secret.
2. Trigger Deployment rollout.
3. New Pods read new Secret at startup.
4. Verify connection.
5. Remove/revoke old credential.
```

Manifest checksum annotation sering dipakai agar perubahan Secret/Config memicu rollout:

```yaml
spec:
  template:
    metadata:
      annotations:
        checksum/secret-payment-db: "<rendered-secret-checksum>"
```

Helm/Kustomize/GitOps dapat menghitung checksum dari Secret source. Ketika checksum berubah, `spec.template.metadata.annotations` berubah, sehingga Deployment membuat ReplicaSet baru.

Kelemahan:

- butuh rollout,
- tidak cocok untuk emergency credential revocation jika app tidak bisa connect ulang cepat,
- harus hati-hati dengan DB connection pool dan migration.

---

### 7.2 Dual Credential Rotation

Untuk database/API key yang mendukung lebih dari satu credential aktif:

```text
1. Create new credential while old credential still valid.
2. Update Kubernetes Secret to include new credential.
3. Rollout app.
4. Verify all Pods use new credential.
5. Revoke old credential.
6. Confirm no error spike.
```

Ini lebih aman daripada langsung mengganti password lama.

Failure mode:

- revoke old credential terlalu cepat,
- sebagian Pod belum restart,
- connection pool masih memakai old credential,
- rollback image membutuhkan credential lama tetapi sudah dicabut.

---

### 7.3 Short-Lived Token Pattern

Alih-alih menyimpan static secret jangka panjang, workload mengambil token pendek dari identity provider.

Model:

```text
Pod identity -> token request -> short-lived token -> dependency access
```

Keuntungan:

- credential bocor punya lifetime pendek,
- revocation lebih mudah,
- audit lebih jelas,
- tidak perlu menyimpan long-lived password di Secret.

Trade-off:

- butuh identity integration,
- aplikasi harus menangani token refresh,
- dependency harus mendukung token-based auth,
- outage identity provider bisa memengaruhi workload.

---

### 7.4 External Secret Manager Pattern

Production modern sering memakai external secret manager:

- cloud secret manager,
- vault,
- enterprise KMS/HSM,
- external-secrets operator,
- secrets-store CSI driver,
- cert-manager untuk certificate.

Model umum:

```text
external secret source
  -> controller/CSI sync
  -> Kubernetes Secret or mounted file
  -> Pod
```

Ada dua pendekatan utama:

1. Sync ke Kubernetes Secret.
2. Mount langsung ke Pod melalui CSI tanpa membuat Secret permanen di API.

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Sync to Kubernetes Secret | kompatibel dengan native Kubernetes, mudah dipakai Deployment | Secret tetap ada di etcd dan RBAC Secret read tetap sensitif |
| CSI mount direct | mengurangi Secret object di etcd | dependency runtime ke provider/CSI, app harus pakai file, debugging lebih kompleks |

---

## 8. TLS in Kubernetes

### 8.1 TLS Use Cases

TLS di Kubernetes muncul dalam beberapa konteks:

1. External client ke Ingress/Gateway.
2. Service ke service.
3. App ke database/broker/cache.
4. Kubelet ke API server.
5. API server ke etcd.
6. Webhook admission ke API server.
7. Controller/operator ke API server.
8. Metrics/observability pipeline.

Jangan mencampur semua ini menjadi satu “TLS cluster”. Setiap hubungan punya trust domain dan rotation requirement berbeda.

---

### 8.2 Ingress/Gateway TLS

Untuk north-south traffic, certificate biasanya dipakai oleh Ingress Controller atau Gateway implementation.

Contoh Ingress TLS:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  tls:
    - hosts:
        - payment.example.com
      secretName: payment-api-tls
  rules:
    - host: payment.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: payment-api
                port:
                  number: 8080
```

Key points:

- TLS Secret harus ada di namespace yang sama dengan Ingress.
- Secret harus berisi certificate chain yang benar.
- SAN harus cocok dengan hostname.
- Renewal harus dilakukan sebelum expiry.
- Ingress/Gateway controller harus reload certificate.

Failure mode:

- certificate expired,
- wrong SAN,
- incomplete chain,
- secretName salah,
- controller tidak punya permission membaca Secret,
- wildcard certificate disalahgunakan terlalu luas,
- TLS termination terjadi di layer yang tidak dipahami app.

---

### 8.3 App-to-Dependency TLS

Java app ke PostgreSQL, Kafka, Redis, Elasticsearch, external API, atau internal service sering membutuhkan truststore/client certificate.

Model umum:

```text
Java app
  -> truststore / CA bundle
  -> TLS handshake
  -> dependency certificate validation
```

Untuk mTLS:

```text
Java app
  -> client certificate + private key
  -> server verifies client identity
  -> client verifies server identity
```

Risiko Java-specific:

- truststore tidak memuat CA baru,
- certificate diperbarui tetapi JVM tidak reload truststore,
- hostname verification dimatikan untuk “sementara”, lalu permanen,
- client certificate private key permission terlalu longgar,
- cert rotation menyebabkan connection pool error storm,
- library Kafka/JDBC/HTTP client punya konfigurasi TLS berbeda-beda.

---

### 8.4 cert-manager Pattern

`cert-manager` sering dipakai untuk menerbitkan dan memperbarui certificate. Konsep utamanya:

- `Issuer` atau `ClusterIssuer`,
- `Certificate`,
- Secret output,
- ACME/CA/Vault/self-signed issuer,
- renewal before expiry.

Contoh konseptual:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: payment-api-tls
  namespace: payment-prod
spec:
  secretName: payment-api-tls
  dnsNames:
    - payment.example.com
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

Production concern:

- siapa boleh membuat `Certificate`,
- apakah wildcard certificate dibatasi,
- apakah `ClusterIssuer` terlalu luas,
- apakah private key tersimpan aman,
- apakah renewal alert ada,
- apakah controller failure dimonitor.

---

## 9. ServiceAccount Tokens and Workload Identity

### 9.1 ServiceAccount Token Is a Credential

ServiceAccount token adalah credential untuk Kubernetes API atau audience tertentu. Jangan menganggapnya harmless.

Jika Pod memiliki token mounted dan token punya permission tinggi, attacker yang berhasil masuk ke container bisa memakai token tersebut untuk memanggil API server.

Hardening:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-api
  namespace: payment-prod
automountServiceAccountToken: false
```

Atau di Pod spec:

```yaml
spec:
  automountServiceAccountToken: false
```

Jika aplikasi tidak perlu bicara ke Kubernetes API, matikan automount token.

---

### 9.2 Bound Tokens and TokenRequest

Kubernetes modern menggunakan bound ServiceAccount tokens yang bisa terikat ke audience dan lifetime tertentu. Ini lebih baik daripada legacy long-lived token.

Mental model:

```text
ServiceAccount identity != unlimited bearer credential
```

Desain yang baik:

- beri ServiceAccount per app/workload,
- audience spesifik,
- lifetime pendek bila memungkinkan,
- minimal RBAC,
- token tidak otomatis dipasang jika tidak diperlukan.

---

### 9.3 Cloud Workload Identity

Di managed Kubernetes, workload identity memungkinkan Pod mendapatkan identitas cloud tanpa menyimpan static cloud access key di Secret.

Contoh konsep:

```text
Kubernetes ServiceAccount
  -> bound to cloud IAM role/service account
  -> Pod gets short-lived cloud credential
  -> access cloud secret manager/storage/database
```

Keuntungan:

- tidak menyimpan cloud key jangka panjang,
- audit cloud lebih baik,
- rotation dikelola platform,
- blast radius bisa dibatasi per workload.

Risiko:

- mapping ServiceAccount ke cloud role terlalu broad,
- namespace takeover menjadi cloud privilege escalation,
- admission policy tidak mengontrol annotation identity,
- developer bisa membuat Pod dengan ServiceAccount berprivilege.

---

## 10. Supply Chain Security

### 10.1 Threat Model

Supply chain security menjawab pertanyaan:

```text
Apakah artifact yang berjalan di cluster benar-benar artifact yang kita maksud, dibangun dari source yang kita percaya, dengan dependency yang bisa diaudit, dan memenuhi policy organisasi?
```

Attack path umum:

```text
malicious dependency -> build artifact -> container image -> registry -> deployment manifest -> cluster
```

Atau:

```text
attacker pushes image with same mutable tag -> cluster pulls compromised image
```

Atau:

```text
CI credential leaked -> attacker deploys privileged workload
```

---

### 10.2 Image Tags vs Digests

Tag bersifat mutable. Digest bersifat content-addressed.

Kurang ideal:

```yaml
image: registry.example.com/payment-api:latest
```

Lebih baik:

```yaml
image: registry.example.com/payment-api:1.42.0@sha256:abc123...
```

Atau minimal:

```yaml
image: registry.example.com/payment-api:1.42.0
```

dengan policy registry yang melarang overwrite tag.

Production best practice:

- jangan pakai `latest`,
- gunakan immutable tag,
- prefer digest pinning untuk environment kritikal,
- catat source commit/build metadata,
- enforce registry allowlist,
- enforce signed images.

---

### 10.3 ImagePullPolicy

`imagePullPolicy` menentukan kapan kubelet menarik image.

Common values:

- `Always`,
- `IfNotPresent`,
- `Never`.

Risiko:

- `IfNotPresent` + mutable tag dapat menjalankan image lama di node tertentu,
- `Always` + mutable tag dapat menarik image baru yang tidak diaudit,
- `latest` default behavior bisa membingungkan,
- private image credential behavior harus dipahami dengan benar.

Rule:

```text
Reliability comes from immutable references, not from hoping imagePullPolicy behaves as deployment control.
```

---

### 10.4 Image Scanning

Scanning mencari vulnerability di:

- base image,
- OS packages,
- language dependencies,
- known CVEs,
- misconfiguration.

Namun scanning bukan bukti aman total.

Limitasi:

- false positive,
- false negative,
- exploitability context tidak selalu diketahui,
- vulnerability DB bisa terlambat,
- app logic vulnerability tidak ditemukan,
- secrets baked into image perlu secret scanning terpisah.

Gunakan scanning sebagai gate dengan risk policy:

```text
critical exploitable vulnerability -> block production
high vulnerability with mitigation -> exception with expiry
unfixable base issue -> track and upgrade base image
```

---

### 10.5 SBOM

SBOM atau Software Bill of Materials adalah daftar komponen software dalam artifact.

Manfaat:

- tahu dependency apa yang ikut dalam image,
- audit saat CVE baru muncul,
- compliance,
- incident response lebih cepat.

Kubernetes tidak otomatis memahami SBOM. Platform perlu menghubungkan:

```text
build pipeline -> SBOM generation -> artifact registry -> deployment metadata -> runtime inventory
```

Label/annotation bisa membantu traceability:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/version: "1.42.0"
  annotations:
    build.example.com/git-sha: "8f4a..."
    build.example.com/sbom-ref: "registry.example.com/sbom/payment-api:1.42.0"
```

Jangan memasukkan data besar SBOM langsung ke annotation.

---

### 10.6 Signing and Verification

Image signing membuktikan image ditandatangani oleh identity yang dipercaya. Verification memastikan cluster hanya menerima image yang memenuhi trust policy.

Model:

```text
build pipeline signs image
  -> registry stores image + signature/attestation
  -> admission policy verifies signature
  -> Pod admitted only if policy passes
```

Policy yang umum:

- hanya registry tertentu,
- image harus signed,
- signer harus trusted,
- image harus punya attestation build,
- image harus bukan `latest`,
- image harus digest-pinned,
- base image harus dari allowlist,
- vulnerability threshold tidak boleh dilanggar.

Tools bisa berbeda per organisasi, tetapi konsepnya sama: cluster jangan menjadi tempat pertama kali kita “percaya” artifact.

---

## 11. Admission Policy for Secret and Supply Chain

Admission control dapat mencegah manifest berisiko masuk cluster.

Contoh policy intent:

```text
Reject Pod if:
- image uses latest tag
- image registry not in allowlist
- image not signed
- runAsNonRoot missing
- automountServiceAccountToken true without exception
- env var name contains PASSWORD from literal value
- privileged container
- hostPath volume
- missing resource requests
```

Untuk Secret:

```text
Reject Secret if:
- created manually in production namespace without owner label
- type is Opaque but missing rotation metadata
- annotation indicates expired rotation window
- secret name violates naming convention
```

Untuk certificate:

```text
Reject/alert if:
- TLS certificate expires soon
- wildcard certificate in non-approved namespace
- Certificate references production ClusterIssuer from dev namespace
```

Admission bukan pengganti review, tetapi guardrail untuk mencegah kesalahan berulang.

---

## 12. Common Manifest Patterns

### 12.1 Hardened Java Deployment with Secret and No API Token

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-api
  namespace: payment-prod
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payment-prod
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/part-of: payment
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
      annotations:
        checksum/secret-payment-db: "RENDERED_BY_PIPELINE"
    spec:
      serviceAccountName: payment-api
      automountServiceAccountToken: false
      containers:
        - name: app
          image: registry.example.com/payment-api:1.42.0@sha256:REPLACE_ME
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_DATASOURCE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: payment-db-credentials
                  key: username
            - name: SPRING_DATASOURCE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: payment-db-credentials
                  key: password
          volumeMounts:
            - name: dependency-ca
              mountPath: /var/run/secrets/dependency-ca
              readOnly: true
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
            seccompProfile:
              type: RuntimeDefault
      volumes:
        - name: dependency-ca
          secret:
            secretName: dependency-ca-bundle
```

Key properties:

- ServiceAccount token disabled,
- image digest pinned,
- Secret via env for DB credential,
- CA bundle via file,
- checksum annotation for rollout,
- hardened security context.

---

### 12.2 Secret Naming and Metadata

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-db-credentials
  namespace: payment-prod
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/part-of: payment
    security.example.com/classification: restricted
  annotations:
    security.example.com/owner: payment-platform
    security.example.com/rotation-policy: 90d
    security.example.com/last-rotated: "2026-06-01"
type: Opaque
stringData:
  username: payment_app
  password: replace-me
```

Metadata membantu audit dan automation. Namun jangan menyimpan secret value di label/annotation.

---

## 13. Failure Mode Catalogue

### 13.1 Secret Updated but App Still Uses Old Value

Symptom:

- Secret sudah berubah,
- Pod masih gagal auth,
- deployment tidak berubah,
- Java app masih memakai credential lama.

Likely cause:

- Secret dipakai via env var,
- Pod belum restart,
- app membaca config saat startup saja,
- checksum annotation tidak berubah.

Debug:

```bash
kubectl get secret payment-db-credentials -n payment-prod -o yaml
kubectl get deploy payment-api -n payment-prod -o yaml
kubectl rollout history deploy/payment-api -n payment-prod
kubectl get pods -n payment-prod -l app.kubernetes.io/name=payment-api
```

Fix:

- trigger rollout restart,
- tambahkan checksum annotation,
- desain dual credential rotation,
- buat runbook rotation.

---

### 13.2 Secret Leaked via Actuator or Logs

Symptom:

- credential muncul di logs,
- `/actuator/env` menampilkan property sensitif,
- support bundle mengandung password.

Likely cause:

- endpoint management exposed,
- sanitization kurang,
- debug logging property source,
- exception mencetak connection string.

Fix:

- restrict Actuator endpoint,
- sanitize keys,
- jangan expose `/env`, `/configprops`, `/heapdump` ke publik,
- review logging policy,
- rotate leaked credential.

---

### 13.3 Certificate Expired Despite cert-manager

Symptom:

- external client mendapat TLS error,
- cert-manager Certificate status tidak Ready,
- Secret tidak diperbarui,
- Gateway/Ingress masih memakai cert lama.

Likely cause:

- ACME challenge gagal,
- issuer misconfigured,
- DNS validation gagal,
- controller tidak punya permission,
- rate limit CA,
- Ingress/Gateway controller tidak reload.

Debug:

```bash
kubectl get certificate -A
kubectl describe certificate payment-api-tls -n payment-prod
kubectl get secret payment-api-tls -n payment-prod -o yaml
kubectl logs -n cert-manager deploy/cert-manager
```

Fix:

- perbaiki issuer/challenge,
- alert sebelum expiry,
- test renewal path,
- validasi chain dan SAN.

---

### 13.4 Image Tag Overwritten

Symptom:

- Pod dengan tag sama menjalankan behavior berbeda,
- node A dan node B menjalankan digest berbeda,
- rollback tidak deterministik.

Likely cause:

- mutable tag,
- imagePullPolicy berbeda,
- registry memperbolehkan tag overwrite,
- manifest tidak pin digest.

Fix:

- enforce immutable tags,
- pin digest,
- admission reject `latest`,
- record digest in deployment metadata,
- audit registry events.

---

### 13.5 RBAC Allows Secret Exfiltration

Symptom:

- user/app bisa membaca banyak Secret,
- incident menemukan token di luar cluster,
- namespace secret list bisa diakses role umum.

Likely cause:

- Role terlalu broad,
- `cluster-admin` dipakai untuk CI/app,
- `pods/exec` diberikan terlalu mudah,
- shared namespace.

Fix:

- audit `get/list/watch secrets`,
- pisahkan ServiceAccount per app,
- matikan automount token,
- batasi `pods/exec`,
- gunakan namespace boundary yang lebih kecil,
- rotate exposed credentials.

---

### 13.6 Registry Credential Leak

Symptom:

- image private ditarik dari lokasi tidak sah,
- credential registry dipakai di luar cluster,
- pull secret tersebar di banyak namespace.

Likely cause:

- shared imagePullSecret,
- broad registry token,
- Secret bisa dibaca banyak pihak,
- CI log mencetak docker config.

Fix:

- rotate registry credential,
- gunakan scoped token,
- gunakan workload/node identity bila bisa,
- batasi RBAC Secret read,
- audit namespace yang memakai pull secret.

---

## 14. Production Checklist

### 14.1 Secret Checklist

- Tidak ada plaintext Secret di Git.
- Tidak ada credential di ConfigMap.
- Tidak ada secret value di label/annotation.
- Secret encryption at rest aktif.
- etcd backup terenkripsi dan aksesnya dibatasi.
- RBAC `get/list/watch secrets` dibatasi ketat.
- `pods/exec` tidak diberikan sembarangan.
- ServiceAccount token tidak otomatis mounted jika tidak perlu.
- Secret punya owner dan rotation policy.
- Rotation sudah diuji end-to-end.
- App tidak mengekspos env/config sensitif.
- Log sanitization aktif.
- Secret tidak dibaked ke image layer.

### 14.2 Certificate Checklist

- Certificate punya issuer jelas.
- SAN sesuai hostname.
- Chain lengkap.
- Private key permission dibatasi.
- Renewal otomatis dimonitor.
- Alert sebelum expiry.
- App/controller bisa reload certificate atau rollout path jelas.
- Truststore update path jelas.
- mTLS identity mapping terdokumentasi.
- Wildcard certificate dibatasi.

### 14.3 Supply Chain Checklist

- Image tidak memakai `latest` di production.
- Tag immutable atau digest pinned.
- Registry allowlist enforced.
- Image scanning dilakukan.
- Critical vulnerability policy jelas.
- SBOM dibuat dan dapat ditelusuri.
- Image signing/verification diterapkan untuk production.
- CI/CD credential least privilege.
- Build provenance/audit tersedia.
- Admission policy mencegah manifest berisiko.
- Runtime inventory dapat menjawab “versi apa berjalan di mana”.

---

## 15. Anti-Pattern

### Anti-Pattern 1: Menyimpan Secret Plaintext di Git

Masalah:

- Git history sulit dibersihkan,
- fork/cache/backup bisa menyimpan secret,
- GitOps membuat leakage lebih luas.

Solusi:

- gunakan external secret manager,
- sealed/encrypted secret dengan key governance yang benar,
- rotate credential yang pernah masuk Git.

---

### Anti-Pattern 2: Satu Pull Secret untuk Semua Namespace

Masalah:

- blast radius besar,
- sulit audit,
- rotation disruptif,
- semua workload punya akses registry yang sama.

Solusi:

- scoped credential,
- namespace/app-specific pull secret,
- workload identity integration,
- registry policy.

---

### Anti-Pattern 3: App Membaca Secret dari Env tetapi Mengklaim Hot Rotation

Masalah:

- env var tidak berubah di running process,
- credential lama tetap dipakai,
- revocation bisa menyebabkan outage.

Solusi:

- rollout restart pattern,
- file-based reload,
- dual credential rotation,
- short-lived token.

---

### Anti-Pattern 4: Mematikan Hostname Verification

Masalah:

- TLS kehilangan perlindungan identitas server,
- MITM risk meningkat,
- temporary workaround menjadi permanent.

Solusi:

- perbaiki SAN/certificate,
- kelola truststore,
- gunakan issuer yang benar,
- enforce config review.

---

### Anti-Pattern 5: CI/CD Menggunakan cluster-admin

Masalah:

- pipeline compromise menjadi cluster compromise,
- deployment job bisa membaca semua Secret,
- tidak ada least privilege.

Solusi:

- RBAC per environment/app,
- deployment-specific ServiceAccount,
- admission guardrail,
- audit dan break-glass terpisah.

---

## 16. Latihan

### Latihan 1 — Secret Consumption Review

Ambil satu Deployment Java yang sudah ada. Jawab:

1. Secret apa saja yang dipakai?
2. Secret dikonsumsi via env atau file?
3. Apakah perubahan Secret otomatis dipakai aplikasi?
4. Apakah rollout diperlukan?
5. Apakah ada checksum annotation?
6. Apakah Secret pernah muncul di log?
7. Apakah Actuator endpoint aman?
8. Siapa yang bisa `get/list/watch secrets` di namespace tersebut?

Output yang diharapkan:

```text
secret-name | consumed-as | reloadable | rotation-method | risk | fix
```

---

### Latihan 2 — Certificate Expiry Runbook

Buat runbook untuk certificate Ingress/Gateway:

1. Cara melihat expiry.
2. Cara melihat Secret TLS.
3. Cara melihat issuer/cert-manager status.
4. Cara mengecek SAN.
5. Cara mengecek chain.
6. Cara memverifikasi controller sudah reload.
7. Cara rollback/renew manual jika otomatis gagal.

---

### Latihan 3 — Supply Chain Gate

Definisikan admission policy untuk production namespace:

- reject `latest`,
- require registry allowlist,
- require digest,
- require `runAsNonRoot`,
- reject privileged,
- require resource requests,
- disable automount token by default,
- require app labels,
- require owner annotation.

Jelaskan trade-off tiap policy dan exception process.

---

## 17. Ringkasan

Secret, certificate, TLS, dan supply chain security bukan fitur terpisah. Mereka membentuk jalur kepercayaan dari source code sampai runtime.

Mental model utama:

```text
Secret is a delivery envelope, not a complete security system.
Certificate is operational state with expiry and rotation.
Image is executable supply chain output, not just a deployment string.
Admission is where platform policy becomes enforceable.
Java apps need explicit handling for reload, truststore, logging, and diagnostics.
```

Kubernetes menyediakan primitive:

- `Secret`,
- `ServiceAccount`,
- projected volume,
- TLS Secret,
- imagePullSecrets,
- RBAC,
- admission,
- namespace boundary,
- security context.

Namun security outcome tergantung desain end-to-end:

```text
source -> build -> image -> registry -> manifest -> admission -> Pod -> app -> dependency -> rotation -> audit
```

Jika salah satu step lemah, credential bisa bocor atau workload tidak terpercaya bisa masuk ke cluster.

---

## 18. Referensi Resmi

- Kubernetes Documentation — Secrets: https://kubernetes.io/docs/concepts/configuration/secret/
- Kubernetes Documentation — Good practices for Kubernetes Secrets: https://kubernetes.io/docs/concepts/security/secrets-good-practices/
- Kubernetes Documentation — Service Accounts: https://kubernetes.io/docs/concepts/security/service-accounts/
- Kubernetes Documentation — Configure Service Accounts for Pods: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/
- Kubernetes Documentation — Manage TLS Certificates in a Cluster: https://kubernetes.io/docs/tasks/tls/managing-tls-in-a-cluster/
- Kubernetes Documentation — Images: https://kubernetes.io/docs/concepts/containers/images/
- Kubernetes Documentation — Ingress TLS: https://kubernetes.io/docs/concepts/services-networking/ingress/
- Kubernetes Documentation — Projected Volumes: https://kubernetes.io/docs/concepts/storage/projected-volumes/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Pod Security, Security Context, and Workload Hardening</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-021.md">Part 021 — Observability: Logs, Metrics, Traces, Events, and Debuggability ➡️</a>
</div>
