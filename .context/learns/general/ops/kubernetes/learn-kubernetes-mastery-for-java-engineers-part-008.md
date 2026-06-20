# learn-kubernetes-mastery-for-java-engineers-part-008.md

# Part 008 — Configuration: ConfigMap, Secret, Environment, Files, and Reloadability

## 1. Tujuan Part Ini

Part ini membahas cara Kubernetes mengelola konfigurasi aplikasi secara production-grade: `ConfigMap`, `Secret`, environment variable, mounted file, projected volume, Downward API, reloadability, rollout trigger, dan pola konfigurasi untuk aplikasi Java/Spring Boot.

Tujuan akhirnya bukan sekadar bisa menulis YAML `ConfigMap`, tetapi mampu menjawab pertanyaan operasional seperti:

- Konfigurasi mana yang aman dimasukkan ke image, mana yang harus externalized?
- Kapan memakai environment variable, kapan memakai file mount?
- Kenapa update `ConfigMap` kadang tidak mengubah perilaku aplikasi?
- Bagaimana memastikan perubahan config memicu rollout yang terkontrol?
- Kenapa `Secret` Kubernetes bukan berarti rahasia itu sudah aman sepenuhnya?
- Bagaimana mendesain config agar rollback, audit, reload, dan incident response lebih mudah?
- Bagaimana Java service membaca konfigurasi tanpa membuat deployment menjadi rapuh?

Bagian ini penting karena banyak kegagalan production bukan disebabkan oleh bug algoritma, melainkan oleh konfigurasi yang salah, stale, tidak tervalidasi, tidak ter-rollback dengan benar, atau bocor melalui log, manifest, dashboard, dan pipeline.

---

## 2. Mental Model Utama

Kubernetes memisahkan tiga hal yang sering tercampur di aplikasi tradisional:

```text
1. Artifact
   Image container yang immutable.

2. Runtime intent
   Deployment/Pod spec yang menyatakan bagaimana artifact dijalankan.

3. Runtime configuration
   Nilai lingkungan, endpoint, credential, feature flag, policy, file config, dan metadata runtime.
```

Image seharusnya menjawab:

```text
Apa program yang akan dijalankan?
```

Config menjawab:

```text
Bagaimana program itu harus berperilaku di environment tertentu?
```

Secret menjawab:

```text
Credential atau material sensitif apa yang dibutuhkan program untuk mengakses dependency?
```

Masalahnya: Kubernetes tidak otomatis membuat aplikasi memahami perubahan config. Kubernetes hanya menyediakan mekanisme inject. Aplikasi tetap harus didesain untuk:

- membaca config saat startup,
- memvalidasi config,
- reload config jika diperlukan,
- gagal dengan jelas saat config invalid,
- tidak membocorkan nilai sensitif,
- dan tetap bisa di-rollback.

Konsep penting:

```text
Kubernetes manages configuration delivery.
Your application manages configuration meaning.
```

---

## 3. Konfigurasi Bukan Sekadar Key-Value

Untuk engineer backend, konfigurasi sering tampak seperti sekumpulan string:

```properties
server.port=8080
db.pool.max-size=20
feature.audit.enabled=true
```

Tetapi secara operasional, konfigurasi memiliki beberapa dimensi:

| Dimensi | Pertanyaan |
|---|---|
| Sensitivitas | Apakah nilai ini rahasia? |
| Frekuensi perubahan | Apakah sering berubah? |
| Waktu baca | Dibaca saat startup atau runtime? |
| Validasi | Bisa divalidasi sebelum deploy? |
| Scope | Berlaku untuk app, namespace, tenant, cluster, region? |
| Rollback | Bisa dikembalikan dengan aman? |
| Audit | Siapa mengubah apa, kapan, dan kenapa? |
| Blast radius | Jika salah, layanan apa yang terdampak? |
| Coupling | Apakah perubahan config harus sinkron dengan perubahan kode? |
| Runtime behavior | Apakah perubahan config butuh restart? |

Kubernetes menyediakan primitive, tetapi keputusan desain tetap ada pada engineer.

---

## 4. ConfigMap

`ConfigMap` adalah object Kubernetes untuk menyimpan data konfigurasi non-rahasia.

Contoh sederhana:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-service-config
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-service
data:
  application.properties: |
    server.port=8080
    management.endpoints.web.exposure.include=health,info,prometheus
    orders.audit.enabled=true
    orders.retry.max-attempts=3
  LOG_LEVEL: INFO
```

`ConfigMap` dapat digunakan sebagai:

1. environment variable,
2. command argument,
3. mounted file,
4. projected volume,
5. input untuk tool/template/controller lain.

### 4.1 Apa yang Cocok Masuk ConfigMap?

Cocok:

```text
- endpoint non-secret
- feature toggle non-sensitive
- log level
- timeout
- retry count
- thread pool size
- region name
- mode runtime
- config file application.yaml/properties
```

Tidak cocok:

```text
- password
- token
- private key
- certificate private material
- API key
- database credential
- signing secret
```

Jangan tertipu oleh kenyamanan. Jika nilainya memungkinkan akses ke sistem lain, itu bukan ConfigMap biasa.

---

## 5. Secret

`Secret` adalah object Kubernetes untuk data sensitif. Secara default, nilai disimpan dalam bentuk base64 encoded di manifest/API, bukan terenkripsi oleh base64 itu sendiri.

Contoh:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: order-service-db-secret
  namespace: commerce
type: Opaque
stringData:
  DB_USERNAME: order_app
  DB_PASSWORD: change-me-in-real-life
```

`stringData` memudahkan penulisan nilai plaintext di manifest input, lalu API server menyimpannya sebagai `data` base64. Untuk manifest production, jangan commit secret plaintext ke Git.

### 5.1 Secret Bukan Magic Security Boundary

`Secret` membantu memisahkan data sensitif dari config biasa, tetapi masih ada risiko:

```text
- siapa pun yang punya RBAC read secret bisa membaca isinya
- secret bisa terekspos lewat env var dump
- secret bisa terekspos lewat log aplikasi
- secret bisa masuk crash report
- secret bisa terbaca oleh container yang compromised
- secret bisa tersimpan di etcd
- secret bisa muncul di CI/CD logs jika templating salah
- secret bisa bocor lewat kubectl describe jika operator ceroboh dengan command tertentu
```

Security posture Secret bergantung pada:

- RBAC,
- encryption at rest,
- audit logging,
- namespace isolation,
- admission policy,
- secret rotation,
- external secret integration,
- workload identity,
- dan hygiene aplikasi.

### 5.2 Tipe Secret Umum

Beberapa tipe Secret umum:

```text
Opaque                         generic key-value secret
kubernetes.io/tls              TLS cert/key pair
kubernetes.io/dockerconfigjson image registry pull secret
kubernetes.io/service-account-token legacy service account token pattern
```

Untuk aplikasi Java biasa, yang paling sering ditemui:

- `Opaque` untuk credential aplikasi,
- `kubernetes.io/tls` untuk TLS material,
- `dockerconfigjson` untuk image pull.

---

## 6. Environment Variable vs Mounted File

Kubernetes dapat menyuntikkan ConfigMap/Secret ke container melalui environment variable atau file mount. Keduanya terlihat sederhana, tetapi perilakunya berbeda.

### 6.1 Environment Variable

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: app
          image: registry.example.com/order-service:1.0.0
          env:
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef:
                  name: order-service-config
                  key: LOG_LEVEL
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-service-db-secret
                  key: DB_PASSWORD
```

Karakteristik:

```text
- dibaca saat container start
- tidak berubah di process yang sudah berjalan
- cocok untuk config startup
- mudah dipakai oleh Spring Boot
- mudah bocor lewat process env inspection jika akses container tersedia
- tidak cocok untuk secret yang butuh rotasi tanpa restart
```

Environment variable adalah snapshot saat container dibuat. Jika ConfigMap/Secret berubah, environment variable dalam container lama tidak ikut berubah.

### 6.2 envFrom

`envFrom` memasukkan semua key dari ConfigMap/Secret sebagai environment variable.

```yaml
envFrom:
  - configMapRef:
      name: order-service-config
  - secretRef:
      name: order-service-db-secret
```

Ini nyaman, tetapi berisiko:

- sulit melihat dependency eksplisit,
- bisa terjadi collision antar key,
- perubahan key tak sengaja bisa mengubah perilaku app,
- secret dan config bisa tercampur mental modelnya,
- tidak ada dokumentasi lokal key mana yang benar-benar dipakai container.

Untuk workload penting, lebih baik eksplisit:

```yaml
env:
  - name: ORDERS_RETRY_MAX_ATTEMPTS
    valueFrom:
      configMapKeyRef:
        name: order-service-config
        key: ORDERS_RETRY_MAX_ATTEMPTS
```

Eksplisit lebih verbose, tetapi lebih defensible.

### 6.3 Mounted File

Contoh:

```yaml
volumes:
  - name: config
    configMap:
      name: order-service-config
containers:
  - name: app
    image: registry.example.com/order-service:1.0.0
    volumeMounts:
      - name: config
        mountPath: /config
        readOnly: true
```

Jika ConfigMap berisi key `application.yaml`, maka file akan tersedia di:

```text
/config/application.yaml
```

Karakteristik:

```text
- cocok untuk file config besar
- cocok untuk certificate/key file
- update ConfigMap/Secret dapat tercermin ke mounted volume setelah delay tertentu
- aplikasi tetap harus membaca ulang file jika ingin reload runtime
- tidak otomatis mengubah env var
```

Mounted file memberi peluang reload tanpa restart, tetapi hanya jika aplikasi memang memiliki mekanisme reload.

---

## 7. Immutable ConfigMap dan Secret

Kubernetes mendukung `immutable: true` untuk ConfigMap dan Secret tertentu.

Contoh:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-service-config-v2026-06-20
immutable: true
data:
  LOG_LEVEL: INFO
  ORDERS_RETRY_MAX_ATTEMPTS: "3"
```

Manfaat:

```text
- mencegah perubahan diam-diam pada config yang sedang dipakai
- lebih mudah diaudit
- cocok untuk GitOps
- mengurangi risiko controller/app melihat config berubah tidak sinkron
- membuat rollback lebih eksplisit
```

Trade-off:

```text
- setiap perubahan membutuhkan object baru
- perlu mekanisme naming/versioning
- Deployment harus diarahkan ke ConfigMap/Secret baru
```

Untuk production, immutable config sering lebih sehat dibanding mengedit object config yang sama berkali-kali.

---

## 8. Masalah Klasik: ConfigMap Berubah, Aplikasi Tidak Berubah

Salah satu jebakan paling umum:

```text
Saya sudah update ConfigMap, kenapa aplikasi masih pakai config lama?
```

Jawabannya tergantung cara injeksi.

### 8.1 Jika ConfigMap Dipakai Sebagai Environment Variable

Container lama tidak berubah. Perlu restart/rollout.

```bash
kubectl rollout restart deployment/order-service -n commerce
```

Atau ubah Pod template agar Deployment membuat ReplicaSet baru.

### 8.2 Jika ConfigMap Dipakai Sebagai Mounted Volume

File di volume dapat diperbarui oleh kubelet setelah delay, tetapi:

- tidak instant,
- tidak berlaku jika menggunakan `subPath` dengan cara tertentu,
- aplikasi harus membaca ulang file,
- beberapa framework membaca config hanya saat startup.

### 8.3 Jika Aplikasi Membaca Saat Startup

Perubahan file tidak berarti apa-apa sampai process restart.

Jadi invariant penting:

```text
Config delivery changed does not mean application behavior changed.
```

---

## 9. Rollout Trigger dengan Checksum Annotation

Karena perubahan ConfigMap/Secret tidak otomatis membuat Deployment rollout, pola umum adalah menaruh checksum config pada Pod template annotation.

Contoh konseptual:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    metadata:
      annotations:
        checksum/config: "sha256-of-rendered-config"
        checksum/secret: "sha256-of-rendered-secret"
```

Jika checksum berubah, `spec.template` berubah. Deployment akan membuat ReplicaSet baru.

Ini populer di Helm/Kustomize/GitOps karena:

- perubahan config menjadi bagian dari rollout,
- rollout history lebih jelas,
- rollback bisa mengembalikan config sebelumnya,
- tidak perlu manual `rollout restart`.

Namun hati-hati:

```text
- jangan menaruh nilai secret mentah di annotation
- annotation masuk metadata dan mudah terbaca
- gunakan hash, bukan secret value
- pastikan hash dihitung dari semua bagian config yang relevan
```

---

## 10. Downward API

Downward API memungkinkan Pod/container membaca metadata tentang dirinya sendiri.

Contoh env var:

```yaml
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

Use case:

```text
- logging context
- tracing resource attributes
- metrics labels
- service instance identity
- debugging startup
- regional/zone-aware telemetry when combined with node labels
```

Untuk Java service, ini berguna untuk memperkaya log:

```text
pod=order-service-7f9cc9f8f8-x92ll
namespace=commerce
node=worker-a-12
```

Namun jangan jadikan Pod name sebagai business identity. Pod ephemeral. Nama Pod berubah saat rollout/reschedule.

---

## 11. Projected Volume

Projected volume menggabungkan beberapa source ke satu volume:

- ConfigMap,
- Secret,
- Downward API,
- ServiceAccountToken,
- ClusterTrustBundle di skenario tertentu.

Contoh:

```yaml
volumes:
  - name: app-runtime
    projected:
      sources:
        - configMap:
            name: order-service-config
        - secret:
            name: order-service-db-secret
        - downwardAPI:
            items:
              - path: pod-name
                fieldRef:
                  fieldPath: metadata.name
containers:
  - name: app
    volumeMounts:
      - name: app-runtime
        mountPath: /var/run/app
        readOnly: true
```

Projected volume berguna ketika aplikasi ingin satu direktori runtime yang berisi config, secret, dan metadata.

Trade-off:

```text
- memudahkan struktur file
- tetapi dapat mencampur sensitivitas data dalam satu mount
- perlu permission dan path hygiene yang jelas
```

---

## 12. Spring Boot dan Kubernetes Configuration

Spring Boot punya banyak source konfigurasi:

- command line args,
- environment variable,
- system properties,
- `application.properties`,
- `application.yaml`,
- profile-specific file,
- external config location,
- config tree,
- Spring Cloud Kubernetes jika digunakan.

Di Kubernetes, pola umum:

```text
1. image membawa default aman
2. ConfigMap menyediakan environment-specific override
3. Secret menyediakan credential
4. env var dipakai untuk nilai sederhana
5. file mount dipakai untuk config kompleks/cert
6. readiness/startup probe memastikan config valid sebelum traffic masuk
```

### 12.1 Env Var untuk Spring Boot

Contoh mapping:

```text
SPRING_PROFILES_ACTIVE=prod
SERVER_PORT=8080
MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE=health,info,prometheus
ORDERS_RETRY_MAX_ATTEMPTS=3
```

Spring relaxed binding memungkinkan environment variable uppercase underscore menjadi property.

Contoh:

```text
ORDERS_RETRY_MAX_ATTEMPTS
```

bisa dipetakan ke:

```text
orders.retry.max-attempts
```

### 12.2 Mounted application.yaml

Contoh ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-service-spring-config
data:
  application.yaml: |
    server:
      port: 8080
    management:
      endpoints:
        web:
          exposure:
            include: health,info,prometheus
    orders:
      retry:
        max-attempts: 3
      audit:
        enabled: true
```

Deployment:

```yaml
containers:
  - name: app
    image: registry.example.com/order-service:1.0.0
    env:
      - name: SPRING_CONFIG_ADDITIONAL_LOCATION
        value: file:/config/
    volumeMounts:
      - name: spring-config
        mountPath: /config
        readOnly: true
volumes:
  - name: spring-config
    configMap:
      name: order-service-spring-config
```

Keuntungan:

- struktur config lebih natural,
- cocok untuk config hierarkis,
- lebih mudah dibaca daripada banyak env var.

Risiko:

- perubahan file belum tentu reload,
- perlu restart jika Spring hanya membaca saat startup,
- validasi config harus kuat.

---

## 13. Config Validation

Config invalid harus gagal cepat, bukan menyebabkan perilaku aneh saat traffic sudah masuk.

Untuk Java/Spring Boot, gunakan pendekatan seperti:

- typed configuration properties,
- Bean Validation,
- startup validation,
- required property checks,
- integration sanity check untuk dependency penting,
- fail-fast saat config tidak masuk akal.

Contoh konseptual:

```java
@ConfigurationProperties(prefix = "orders.retry")
@Validated
public record OrderRetryProperties(
    @Min(0) int maxAttempts,
    @DurationMin(seconds = 1) Duration timeout
) {}
```

Invariant:

```text
Invalid config should fail before readiness becomes true.
```

Jangan membiarkan service menerima traffic lalu baru gagal saat request tertentu memicu path yang salah config.

---

## 14. Config Reloadability

Tidak semua config harus reloadable.

Klasifikasi:

| Jenis Config | Reload Runtime? | Alasan |
|---|---:|---|
| log level | sering ya | debugging incident |
| feature flag | bisa ya | controlled rollout |
| timeout/retry | hati-hati | dapat mengubah traffic behavior |
| DB pool size | biasanya restart | resource lifecycle kompleks |
| port binding | restart | socket binding |
| datasource URL | restart/rolling | connection pool lifecycle |
| secret credential | tergantung client | perlu rotasi aman |
| TLS cert | idealnya ya | cert rotation |

Reloadability menambah kompleksitas:

- konsistensi antar replica,
- race condition saat config berubah,
- observability config version,
- rollback runtime,
- audit perubahan,
- validasi sebelum apply,
- partial reload failure.

Prinsip praktis:

```text
Make static config explicit and restart-driven.
Make runtime config reloadable only when operational value exceeds complexity.
```

Untuk banyak Java service, rolling restart berbasis immutable config lebih aman daripada hot reload semua hal.

---

## 15. Feature Flags vs Kubernetes Config

Feature flag sering dimasukkan ke ConfigMap, tetapi ini tidak selalu benar.

ConfigMap cocok untuk:

```text
- flag coarse-grained per environment
- perubahan jarang
- perubahan yang boleh lewat deployment pipeline
```

Feature flag platform lebih cocok untuk:

```text
- flag per tenant/user/segment
- gradual rollout
- runtime toggle cepat
- audit bisnis
- kill switch real-time
- eksperimen
```

Jangan menjadikan ConfigMap sebagai feature flag platform jika kebutuhan sebenarnya adalah dynamic targeting.

---

## 16. Secret Rotation

Secret rotation adalah area yang sering diremehkan.

Pertanyaan desain:

```text
- Apakah aplikasi membaca secret dari env var atau file?
- Jika secret berubah, apakah aplikasi perlu restart?
- Apakah dependency mendukung dua credential aktif bersamaan?
- Apakah rollout semua replica aman?
- Apa yang terjadi pada connection pool lama?
- Apakah ada audit bahwa secret lama tidak lagi digunakan?
```

Pola rotasi yang lebih aman:

```text
1. Buat credential baru di dependency.
2. Simpan secret baru di Kubernetes/external secret manager.
3. Rollout aplikasi dengan secret baru.
4. Verifikasi koneksi baru berhasil.
5. Tunggu connection lama habis.
6. Cabut credential lama.
7. Audit dan monitor error auth.
```

Anti-pattern:

```text
- mengganti password DB langsung lalu berharap semua pod otomatis ikut
- memakai env var secret tanpa rollout
- tidak punya dual credential window
- tidak memonitor auth failure setelah rotasi
```

---

## 17. External Secret Manager

Di production, sering kali Kubernetes Secret bukan source of truth. Source of truth bisa berupa:

- cloud secret manager,
- vault,
- HSM-backed system,
- internal credential broker,
- external secrets operator.

Kubernetes Secret menjadi projection/cache lokal ke cluster.

Mental model:

```text
External Secret Store = source of truth
Kubernetes Secret     = delivery object
Pod                   = consumer
Application           = semantic user
```

Keuntungan:

- centralized secret lifecycle,
- audit lebih baik,
- rotation support,
- policy terpusat,
- integration dengan IAM/workload identity.

Risiko:

- controller/operator tambahan,
- sync delay,
- failure mode baru,
- dependency pada external service,
- secret drift antara source dan cluster.

---

## 18. Config dan GitOps

Dalam GitOps, manifest di Git menjadi desired state. Ini memengaruhi config strategy.

Untuk ConfigMap non-secret:

```text
- boleh berada di Git jika tidak sensitif
- gunakan review process
- gunakan environment overlay
- gunakan immutable/versioned config untuk perubahan penting
```

Untuk Secret:

```text
- jangan commit plaintext
- gunakan sealed/encrypted secret atau external secret reference
- pastikan key management jelas
- audit akses repo dan decrypt permission
```

Prinsip GitOps:

```text
Git should contain intent, not necessarily raw secret material.
```

---

## 19. Label, Annotation, dan Config Traceability

Agar config mudah dilacak, gunakan label/annotation konsisten.

Contoh:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: commerce-platform
    app.kubernetes.io/managed-by: argocd
  annotations:
    config.example.com/version: "2026-06-20.1"
    config.example.com/source-revision: "git-sha-placeholder"
```

Manfaat:

- audit perubahan,
- korelasi rollout dengan config,
- debugging incident,
- cost/ownership tracking,
- GitOps traceability.

Jangan letakkan secret value di annotation. Metadata sering lebih mudah terlihat daripada isi Secret.

---

## 20. SubPath Trap

Mounting ConfigMap/Secret menggunakan `subPath` sering menimbulkan kejutan.

Contoh:

```yaml
volumeMounts:
  - name: config
    mountPath: /app/config/application.yaml
    subPath: application.yaml
```

Ini nyaman karena mount satu file ke path tertentu, tetapi update ConfigMap biasanya tidak tercermin seperti mounted directory biasa. Banyak engineer mengira file akan ikut berubah, padahal tidak seperti yang diharapkan.

Prinsip:

```text
If you need dynamic projected updates, avoid subPath for ConfigMap/Secret files.
```

Jika config memang static-startup, `subPath` bisa diterima, tetapi jangan mengandalkan hot update.

---

## 21. Optional Config dan Failure Semantics

Kubernetes memungkinkan referensi ConfigMap/Secret optional.

Contoh:

```yaml
env:
  - name: OPTIONAL_FEATURE_CONFIG
    valueFrom:
      configMapKeyRef:
        name: optional-feature-config
        key: value
        optional: true
```

Gunakan dengan hati-hati.

Cocok:

```text
- fitur benar-benar optional
- app punya default aman
- absennya config bukan error
```

Tidak cocok:

```text
- DB password
- endpoint wajib
- security policy
- tenant isolation config
```

Untuk dependency wajib, lebih baik gagal cepat daripada menjalankan aplikasi dalam mode setengah benar.

---

## 22. Image Configuration vs Runtime Configuration

Beberapa nilai sebaiknya tidak externalized.

Masuk image/build-time:

```text
- dependency library
- static assets
- default non-sensitive config
- app binary
- schema migration code
- supported feature set
```

Masuk runtime config:

```text
- endpoint dependency
- timeout
- retry
- credential
- profile/environment
- traffic behavior
- resource-related app config
```

Jangan membuat image terlalu generic sampai semua perilaku kritis ditentukan oleh runtime string tanpa validasi. Itu membuat sistem sulit dipahami dan sulit diaudit.

---

## 23. Naming Convention

Naming ConfigMap/Secret yang baik membantu debugging.

Contoh buruk:

```text
config
app-config
secret
prod-secret
```

Contoh lebih baik:

```text
order-service-config
order-service-db-secret
order-service-oauth-secret
order-service-tls
order-service-config-v2026-06-20
```

Gunakan pola:

```text
<app>-<purpose>-config
<app>-<dependency>-secret
<app>-tls
<app>-config-<version>
```

Untuk secret shared, pertanyakan dulu apakah sharing memang benar. Secret shared sering memperbesar blast radius.

---

## 24. Production Manifest Baseline

Contoh baseline yang lebih eksplisit:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-service-config-v1
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: api
immutable: true
data:
  SPRING_PROFILES_ACTIVE: prod
  SERVER_PORT: "8080"
  MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: health,info,prometheus
  ORDERS_RETRY_MAX_ATTEMPTS: "3"
  ORDERS_TIMEOUT: 2s
---
apiVersion: v1
kind: Secret
metadata:
  name: order-service-db-secret-v1
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: api
immutable: true
type: Opaque
stringData:
  DB_USERNAME: order_app
  DB_PASSWORD: replace-with-external-secret-in-production
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: commerce
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-service
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-service
        app.kubernetes.io/component: api
      annotations:
        checksum/config: "replace-with-rendered-config-hash"
        checksum/secret: "replace-with-rendered-secret-hash"
    spec:
      containers:
        - name: app
          image: registry.example.com/order-service:1.0.0
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              valueFrom:
                configMapKeyRef:
                  name: order-service-config-v1
                  key: SPRING_PROFILES_ACTIVE
            - name: SERVER_PORT
              valueFrom:
                configMapKeyRef:
                  name: order-service-config-v1
                  key: SERVER_PORT
            - name: ORDERS_RETRY_MAX_ATTEMPTS
              valueFrom:
                configMapKeyRef:
                  name: order-service-config-v1
                  key: ORDERS_RETRY_MAX_ATTEMPTS
            - name: ORDERS_TIMEOUT
              valueFrom:
                configMapKeyRef:
                  name: order-service-config-v1
                  key: ORDERS_TIMEOUT
            - name: DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: order-service-db-secret-v1
                  key: DB_USERNAME
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-service-db-secret-v1
                  key: DB_PASSWORD
```

Catatan:

- secret plaintext di atas hanya contoh pembelajaran,
- production sebaiknya memakai external secret/encrypted secret,
- checksum harus dihasilkan oleh templating/tooling,
- immutable object membuat perubahan lebih eksplisit.

---

## 25. Debugging Config Issue

### 25.1 Lihat Object Config

```bash
kubectl get configmap -n commerce
kubectl get secret -n commerce
```

Detail ConfigMap:

```bash
kubectl describe configmap order-service-config-v1 -n commerce
kubectl get configmap order-service-config-v1 -n commerce -o yaml
```

Untuk Secret, hati-hati menampilkan isi:

```bash
kubectl describe secret order-service-db-secret-v1 -n commerce
```

Jangan sembarang:

```bash
kubectl get secret order-service-db-secret-v1 -n commerce -o yaml
```

karena bisa menampilkan data encoded yang mudah didecode.

### 25.2 Lihat Env di Pod

```bash
kubectl exec -n commerce deploy/order-service -- printenv | sort
```

Hati-hati: ini bisa membocorkan secret ke terminal history/log.

Lebih aman untuk mengecek key non-secret saja:

```bash
kubectl exec -n commerce deploy/order-service -- printenv SPRING_PROFILES_ACTIVE
```

### 25.3 Lihat Mounted File

```bash
kubectl exec -n commerce deploy/order-service -- ls -lah /config
kubectl exec -n commerce deploy/order-service -- cat /config/application.yaml
```

Jangan `cat` file secret sembarangan.

### 25.4 Cek Apakah Pod Template Berubah

```bash
kubectl get deploy order-service -n commerce -o yaml
```

Periksa:

- env reference,
- volume reference,
- annotation checksum,
- ReplicaSet revision,
- pod template generation.

### 25.5 Cek Rollout

```bash
kubectl rollout status deployment/order-service -n commerce
kubectl rollout history deployment/order-service -n commerce
```

Jika config berubah tapi Pod tidak restart, kemungkinan Pod template tidak berubah.

---

## 26. Failure Mode Umum

### 26.1 ConfigMap Tidak Ada

Symptom:

```text
CreateContainerConfigError
```

Penyebab:

- ConfigMap belum dibuat,
- namespace salah,
- name typo,
- key typo,
- manifest apply order salah.

Debug:

```bash
kubectl describe pod <pod> -n <namespace>
```

Cari event seperti missing ConfigMap/key.

### 26.2 Secret Tidak Ada

Symptom mirip:

```text
CreateContainerConfigError
```

Penyebab:

- Secret belum tersinkron dari external secret operator,
- RBAC controller gagal,
- namespace salah,
- key tidak ada.

### 26.3 Config Berubah, App Tidak Ikut

Penyebab:

- env var snapshot,
- app membaca saat startup,
- tidak ada rollout trigger,
- mounted file tidak direload,
- `subPath` trap.

Remediasi:

- rollout restart,
- checksum annotation,
- immutable versioned config,
- implement reload jika benar-benar dibutuhkan.

### 26.4 Secret Bocor ke Log

Penyebab:

- log semua env saat startup,
- exception menampilkan connection string,
- debug endpoint expose config,
- actuator misconfigured,
- CI/CD print rendered manifest.

Remediasi:

- sanitize logging,
- mask sensitive property,
- batasi actuator env/configprops,
- RBAC ketat,
- secret scanning.

### 26.5 Rollback Code Tapi Config Tidak Rollback

Penyebab:

- config object mutable dengan nama sama,
- rollback Deployment hanya mengubah image/revision,
- ConfigMap terbaru tetap dipakai.

Remediasi:

- versioned immutable config,
- config checksum di Pod template,
- GitOps promotion/rollback yang atomic.

### 26.6 Config Valid Secara YAML Tapi Salah Secara Semantik

Contoh:

```text
ORDERS_TIMEOUT=2000
```

Apakah itu milliseconds, seconds, atau string duration?

Remediasi:

- typed config,
- validation,
- unit jelas,
- startup fail-fast,
- config contract test.

---

## 27. Anti-Pattern

### 27.1 Commit Secret Plaintext ke Git

Ini hampir selalu salah untuk production.

Bahkan repo private bukan tempat aman untuk secret plaintext karena:

- akses developer luas,
- clone lokal banyak,
- CI logs,
- backup repo,
- branch lama,
- fork internal,
- sulit rotasi.

### 27.2 Satu ConfigMap Raksasa untuk Semua Service

Masalah:

- ownership kabur,
- perubahan satu service memicu risiko service lain,
- sulit audit,
- blast radius besar,
- key collision.

Lebih baik config per app/purpose.

### 27.3 envFrom untuk Semua Hal

`envFrom` nyaman untuk demo, tetapi kurang eksplisit untuk production critical service.

### 27.4 Mengandalkan Hot Reload Tanpa Observability

Jika config reload runtime, service harus bisa menjawab:

```text
config version apa yang sedang aktif?
kapan reload terakhir?
apakah reload sukses?
apakah ada replica yang gagal reload?
```

Tanpa itu, hot reload menjadi sumber drift.

### 27.5 Menggunakan ConfigMap sebagai Database

ConfigMap bukan high-throughput dynamic state store. Jangan gunakan sebagai tempat menyimpan state aplikasi yang sering berubah.

### 27.6 Secret Shared Antar Banyak Service

Secret shared memperbesar blast radius. Jika satu service compromised, semua dependency shared ikut berisiko.

---

## 28. Design Checklist

Sebelum membuat config untuk service, jawab:

```text
[ ] Apakah ini config non-secret atau secret?
[ ] Apakah config dibaca saat startup atau runtime?
[ ] Apakah perubahan config harus memicu rollout?
[ ] Apakah rollback code juga rollback config?
[ ] Apakah config tervalidasi saat startup?
[ ] Apakah ada default yang aman?
[ ] Apakah unit nilai jelas?
[ ] Apakah config punya owner?
[ ] Apakah perubahan config diaudit?
[ ] Apakah secret tidak muncul di log/env dump/dashboard?
[ ] Apakah secret bisa dirotasi?
[ ] Apakah config punya blast radius terbatas?
[ ] Apakah manifest environment-specific tetap mudah dibandingkan?
```

---

## 29. Decision Matrix

| Kebutuhan | Mekanisme yang Cocok |
|---|---|
| Nilai sederhana non-secret | ConfigMap env var eksplisit |
| File config hierarkis | ConfigMap mounted file |
| Credential | Secret atau external secret |
| TLS cert/key | TLS Secret / cert manager projection |
| Metadata Pod | Downward API |
| Banyak source dalam satu directory | Projected volume |
| Config harus immutable dan auditable | immutable ConfigMap/Secret + versioned name |
| Perubahan config harus rollout | checksum annotation / change Pod template |
| Dynamic per-user feature flag | feature flag platform, bukan sekadar ConfigMap |
| Secret rotation advanced | external secret manager + dual credential strategy |

---

## 30. Latihan Praktis

### Latihan 1 — ConfigMap Env Var

Buat ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo-config
data:
  APP_MODE: production
  LOG_LEVEL: INFO
```

Inject ke Pod sebagai env var eksplisit. Lalu update ConfigMap dan buktikan env var di container lama tidak berubah.

### Latihan 2 — Mounted Config File

Buat ConfigMap dengan `application.yaml`, mount ke `/config`, lalu cek file di dalam container.

Update ConfigMap dan amati apakah file berubah setelah delay. Bedakan dengan perilaku env var.

### Latihan 3 — Missing Key

Referensikan key yang tidak ada tanpa `optional: true`. Amati Pod event dan status.

Target pemahaman:

```text
Kubernetes fails before container starts because runtime config cannot be constructed.
```

### Latihan 4 — Checksum Rollout

Simulasikan perubahan annotation pada Pod template:

```bash
kubectl patch deployment demo \
  -p '{"spec":{"template":{"metadata":{"annotations":{"checksum/config":"v2"}}}}}'
```

Amati ReplicaSet baru.

### Latihan 5 — Secret Hygiene

Buat Secret dummy, inject sebagai env var, lalu pikirkan jalur kebocoran:

- `printenv`,
- app startup logs,
- debug endpoint,
- crash dump,
- CI rendered manifest,
- RBAC read secret.

Tujuan bukan membocorkan, tetapi memahami attack surface.

---

## 31. Ringkasan

ConfigMap dan Secret bukan sekadar object tambahan di YAML. Keduanya adalah bagian dari kontrak runtime aplikasi.

Poin penting:

```text
- ConfigMap untuk konfigurasi non-secret.
- Secret untuk data sensitif, tetapi base64 bukan encryption.
- Env var adalah snapshot saat container start.
- Mounted file dapat berubah, tetapi aplikasi harus reload sendiri.
- Perubahan ConfigMap/Secret tidak otomatis memicu Deployment rollout.
- Checksum annotation adalah pola umum untuk rollout berbasis config change.
- Immutable/versioned config membuat rollback dan audit lebih sehat.
- Secret rotation harus didesain, bukan diasumsikan.
- Spring Boot cocok dengan env var dan mounted config file, tetapi tetap perlu validasi kuat.
- Config delivery berbeda dari behavior change.
```

Invariant utama:

```text
A running application is only as correct as the configuration it has actually consumed, not the configuration currently stored in Kubernetes.
```

---

## 32. Apa yang Harus Dikuasai Sebelum Lanjut

Sebelum masuk Part 009, pastikan sudah bisa menjelaskan:

```text
[ ] Perbedaan ConfigMap dan Secret.
[ ] Perbedaan env var dan mounted file.
[ ] Kenapa update ConfigMap tidak otomatis mengubah aplikasi.
[ ] Kenapa Secret bukan berarti aman total.
[ ] Apa fungsi checksum annotation.
[ ] Apa risiko envFrom.
[ ] Apa risiko subPath untuk config update.
[ ] Bagaimana mendesain config Java service agar fail-fast.
[ ] Bagaimana melakukan secret rotation secara aman.
[ ] Bagaimana menghubungkan config strategy dengan GitOps dan rollback.
```

Jika bagian ini sudah solid, kita bisa lanjut ke Service Discovery, yaitu bagaimana Pod yang ephemeral diberi alamat stabil melalui Service, DNS, EndpointSlice, dan load balancing internal Kubernetes.

---

## 33. Status Seri

```text
Seri belum selesai.
Part saat ini: 008 dari 035.
Part berikutnya: 009 — Service Discovery and Service Abstractions.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Resources, QoS, JVM Memory, and CPU Reality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-009.md">Part 009 — Service Discovery and Service Abstractions ➡️</a>
</div>
