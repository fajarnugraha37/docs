# learn-kubernetes-mastery-for-java-engineers-part-023.md

# Part 023 — Kubernetes Manifests: YAML, Kustomize, Helm, and Configuration Composition

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas object Kubernetes dari sisi runtime: Pod, workload controller, scheduling, resources, configuration, service discovery, networking, ingress/gateway, storage, stateful workload, deployment strategy, health, autoscaling, namespace, RBAC, security, secrets, observability, dan debugging.

Part ini membahas lapisan yang sering terlihat paling sederhana tetapi justru menjadi sumber banyak masalah production: **manifest**.

Banyak engineer memulai Kubernetes dari YAML, lalu mengira Kubernetes adalah kumpulan file YAML. Itu framing yang salah.

Manifest bukan inti Kubernetes. Manifest adalah **representasi serialisasi dari desired state** yang dikirim ke Kubernetes API.

Yang penting bukan apakah file-nya YAML, JSON, Helm template, Kustomize overlay, Jsonnet, CUE, CDK8s, Pulumi, Terraform, atau generator internal. Yang penting adalah:

1. object apa yang akhirnya dikirim ke API server,
2. field apa yang dimiliki oleh siapa,
3. bagaimana object itu berubah antar environment,
4. apakah perubahan itu bisa direview,
5. apakah hasil akhirnya valid,
6. apakah komposisinya stabil,
7. apakah rollback dan audit bisa dilakukan,
8. apakah abstraksi membantu atau justru menyembunyikan intent.

Target part ini:

- Memahami manifest sebagai kontrak terhadap Kubernetes API.
- Memahami perbedaan raw YAML, Kustomize, dan Helm.
- Memahami kapan memakai Kustomize, kapan memakai Helm, kapan menggabungkan keduanya, dan kapan sebaiknya tidak.
- Mampu mendesain struktur repository manifest untuk Java service.
- Mampu menghindari anti-pattern seperti values sprawl, overlay drift, templating berlebihan, secret leak, dan generated manifest yang tidak bisa diaudit.
- Mampu melakukan validasi, diff, render, apply, dan debugging manifest secara sistematis.
- Mampu berpikir tentang manifest sebagai artifact release, bukan sekadar file config.

Part ini tidak akan mengulang Dockerfile, Git basic, HTTP, database, atau CI/CD dasar. Kita hanya akan menggunakan konteks tersebut jika relevan dengan Kubernetes manifest.

---

## 2. Mental Model Utama

### 2.1 Manifest adalah pesan kepada API server

Manifest Kubernetes adalah pesan deklaratif yang menyatakan:

> “Saya ingin object dengan identitas ini, field ini, policy ini, dan relasi ini ada di cluster.”

Contoh sederhana:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments
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
      containers:
        - name: app
          image: registry.example.com/payment-api:1.8.3
          ports:
            - containerPort: 8080
```

File ini bukan “deployment” dalam arti runtime. File ini adalah deklarasi object `Deployment`. Setelah dikirim ke API server, controller `Deployment` membaca object tersebut lalu berusaha membuat `ReplicaSet`, lalu `ReplicaSet` membuat `Pod`, lalu scheduler menempatkan Pod, lalu kubelet menjalankan container.

Jadi manifest adalah **input ke reconciliation system**, bukan instruksi prosedural.

### 2.2 YAML bukan source of truth kalau cluster sudah diubah pihak lain

Dalam sistem ideal, Git atau source repository manifest menjadi source of truth. Tetapi secara faktual, Kubernetes cluster bisa berubah melalui banyak writer:

- `kubectl apply` dari laptop engineer,
- GitOps controller,
- Helm release,
- operator,
- admission webhook,
- mutating webhook,
- HPA,
- VPA,
- controller bawaan Kubernetes,
- cloud controller,
- manual hotfix,
- CI/CD pipeline,
- platform automation.

Karena itu, mental model yang benar:

```text
Repository manifest = intended desired state
Cluster object       = live desired state + status + mutations + controller-owned fields
Actual runtime       = node/pod/container/network/storage reality
```

Masalah sering terjadi ketika engineer mengira tiga layer itu selalu sama.

### 2.3 Manifest composition adalah masalah software architecture

Begitu jumlah service, environment, team, dan policy meningkat, manifest bukan lagi sekadar konfigurasi.

Manifest menjadi sistem komposisi:

```text
base workload definition
+ environment difference
+ team/platform conventions
+ secrets/config references
+ ingress/gateway rules
+ resource sizing
+ autoscaling policy
+ security baseline
+ observability defaults
+ rollout strategy
+ policy constraints
= final API objects applied to cluster
```

Kalau komposisi ini tidak disiplin, masalahnya mirip software architecture buruk:

- coupling tinggi,
- duplikasi liar,
- perubahan kecil berdampak luas,
- sulit review,
- sulit test,
- sulit rollback,
- sulit tahu siapa pemilik field tertentu,
- production drift dari staging,
- emergency patch menabrak automation.

### 2.4 Manifest harus dinilai dari hasil akhirnya

Tooling seperti Helm dan Kustomize hanyalah cara membangun object akhir.

Pertanyaan paling penting:

```text
Apa hasil render akhirnya?
Apakah hasil itu valid terhadap Kubernetes API?
Apakah hasil itu sesuai policy cluster?
Apakah hasil itu aman untuk rollout?
Apakah perubahannya bisa dipahami reviewer?
Apakah field ownership-nya jelas?
Apakah rollback bisa dilakukan?
```

Jangan menilai manifest hanya dari elegansi template.

---

## 3. Konsep Inti Kubernetes Manifest

### 3.1 Object identity

Setiap object Kubernetes minimal punya:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments
```

Identitas object umumnya dibaca sebagai:

```text
apiVersion + kind + namespace + name
```

Untuk resource cluster-scoped, `namespace` tidak ada.

Contoh cluster-scoped object:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: platform-readonly
```

Kesalahan umum:

- mengubah `metadata.name` dan mengira itu update object lama,
- lupa namespace,
- memakai namespace berbeda antara Deployment dan Service,
- menggunakan nama environment di semua object sampai sulit reuse,
- membuat object cluster-scoped dari chart app tanpa koordinasi platform.

### 3.2 Spec, status, dan metadata

Manifest yang kita tulis umumnya berisi:

```text
metadata = identitas dan metadata object
spec     = desired state
```

Sedangkan `status` biasanya diisi controller.

Jangan menulis `status` di manifest application biasa kecuali untuk resource khusus yang memang memerlukan status subresource operation.

Contoh salah:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  replicas: 3
status:
  availableReplicas: 3
```

`status.availableReplicas` bukan janji dari user. Itu observasi controller.

### 3.3 Labels vs annotations

Labels dipakai untuk identifikasi, seleksi, grouping, ownership, cost attribution, observability, dan policy.

Annotations dipakai untuk metadata non-identifying, instruksi controller, checksum, traceability, atau informasi yang tidak cocok untuk selector.

Contoh labels yang baik:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/instance: payment-api-prod
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: payment-platform
    app.kubernetes.io/managed-by: helm
    environment: production
    team: payments
```

Contoh annotations:

```yaml
metadata:
  annotations:
    checksum/config: "3fd4e4b7..."
    git.example.com/commit: "a91c4e8"
    runbook.example.com/url: "https://internal.example.com/runbooks/payment-api"
```

Rule praktis:

```text
Kalau dipakai untuk selector/query/grouping: label.
Kalau hanya informasi tambahan atau instruksi controller: annotation.
```

Jangan memasukkan data besar, secret, atau informasi sensitif ke annotations.

### 3.4 Selectors adalah kontrak yang harus stabil

Deployment selector:

```yaml
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
```

Service selector:

```yaml
spec:
  selector:
    app.kubernetes.io/name: payment-api
```

Masalah besar terjadi jika selector berubah tidak sengaja.

Deployment `.spec.selector` bersifat immutable pada `apps/v1`. Jika salah desain, Anda sering perlu membuat Deployment baru.

Service selector bisa berubah, tetapi perubahan selector bisa memindahkan traffic ke Pod yang salah atau membuat Service tanpa endpoint.

Invariant:

```text
Selector harus cukup spesifik untuk memilih Pod yang benar,
tetapi cukup stabil agar tidak berubah setiap release.
```

Jangan pakai label versi image sebagai selector Service.

Buruk:

```yaml
selector:
  app: payment-api
  version: 1.8.3
```

Akibatnya setiap release bisa memutus endpoint jika label/template tidak konsisten.

Lebih baik:

```yaml
selector:
  app.kubernetes.io/name: payment-api
  app.kubernetes.io/component: api
```

Version/canary routing sebaiknya ditangani oleh Deployment terpisah, Gateway/mesh, atau progressive delivery controller, bukan selector yang berubah sembarangan.

---

## 4. Raw YAML: Kapan Cukup dan Kapan Berbahaya

### 4.1 Raw YAML baik untuk belajar dan object kecil

Raw YAML bagus untuk:

- belajar API object,
- debugging,
- prototype kecil,
- manifest yang benar-benar statis,
- object platform yang jarang berubah,
- contoh dokumentasi,
- manifest hasil render yang disimpan sebagai artifact.

Contoh raw YAML yang masih masuk akal:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    pod-security.kubernetes.io/enforce: restricted
    environment: production
    team: payments
```

### 4.2 Raw YAML mulai bermasalah saat variasi meningkat

Misalnya satu Java service punya environment:

```text
dev
staging
production
production-dr
```

Perbedaannya:

```text
replicas
resources
image tag
HPA min/max
Ingress hostname
secret name
ConfigMap value
namespace
node affinity
PDB
NetworkPolicy
observability annotations
```

Jika semua dibuat copy-paste raw YAML, maka muncul masalah:

- staging lupa update securityContext,
- production Service selector beda,
- resource request dev terbawa ke production,
- annotation rollout checksum hanya ada di satu environment,
- namespace salah,
- label cost allocation tidak konsisten,
- perubahan platform perlu diedit di 40 file.

Raw YAML tidak salah. Yang salah adalah copy-paste tanpa model komposisi.

### 4.3 Jangan menyembunyikan intent di komentar YAML

Komentar tidak dikirim ke API server.

Contoh:

```yaml
# Do not change this, used by Service selector
app: payment-api
```

Komentar itu tidak bisa divalidasi oleh cluster, admission policy, atau controller.

Jika sesuatu adalah invariant penting, encode sebagai:

- schema,
- policy,
- test,
- lint rule,
- convention generator,
- README singkat,
- admission validation,
- CI check.

---

## 5. Declarative Object Management

### 5.1 Imperative vs declarative

Imperative:

```bash
kubectl create deployment payment-api --image=registry.example.com/payment-api:1.8.3
kubectl scale deployment payment-api --replicas=3
```

Declarative:

```bash
kubectl apply -f deployment.yaml
```

Imperative cocok untuk eksplorasi cepat. Declarative cocok untuk production karena state bisa disimpan, direview, diuji, dan diaudit.

### 5.2 `kubectl apply` bukan sekadar update

`kubectl apply` mencoba membuat live object sesuai konfigurasi deklaratif.

Namun realitas field ownership penting:

- siapa terakhir menulis field,
- apakah field dikelola client-side apply lama,
- apakah server-side apply aktif,
- apakah field dimutasi admission webhook,
- apakah field juga dikelola controller lain.

### 5.3 Client-side apply vs server-side apply

Client-side apply tradisional menyimpan last-applied configuration di annotation:

```yaml
metadata:
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: ...
```

Server-side apply memindahkan tracking field ownership ke API server melalui `managedFields`.

Konsep penting:

```text
Field manager = aktor yang mengelola field tertentu.
Conflict      = ada dua manager mencoba mengelola field yang sama dengan nilai berbeda.
```

SSA penting saat banyak actor mengelola object yang sama:

- GitOps controller,
- HPA,
- admission webhook,
- operator,
- platform controller,
- manual kubectl.

Contoh:

```bash
kubectl apply --server-side --field-manager=platform-gitops -f manifests/
```

Manfaat:

- konflik field lebih eksplisit,
- ownership lebih jelas,
- lebih baik untuk automation,
- mengurangi blind overwrite.

Tetapi SSA bukan obat semua masalah. Anda tetap harus mendesain boundary field ownership.

### 5.4 Field ownership sebagai desain organisasi

Contoh pembagian ownership:

```text
App team owns:
- image tag
- app config reference
- probe endpoint
- app-specific env

Platform team owns:
- securityContext baseline
- resource minimum policy
- observability sidecar/agent config
- ingress/gateway class
- namespace policy

Autoscaler owns:
- replicas, jika HPA aktif

Admission webhook owns/mutates:
- default labels
- sidecar injection
- security defaults
```

Jika tidak ada boundary, konflik akan muncul.

Contoh buruk:

```yaml
spec:
  replicas: 3
```

Lalu HPA juga mengontrol replicas. Jika GitOps terus memaksa replicas ke 3, HPA bisa terlihat “tidak bekerja” atau GitOps selalu mendeteksi drift.

Saat HPA aktif, biasanya field `spec.replicas` perlu diperlakukan hati-hati. Banyak tim menghapusnya setelah HPA dibuat, atau menyet initial replicas hanya saat bootstrap.

---

## 6. Kustomize

### 6.1 Mental model Kustomize

Kustomize adalah tool untuk menghasilkan Kubernetes resource dari base dan overlay tanpa template imperative.

Mental model:

```text
base = manifest umum
overlay = transformasi environment/spesifik konteks
output = Kubernetes API resources valid
```

Struktur umum:

```text
payment-api/
  base/
    deployment.yaml
    service.yaml
    kustomization.yaml
  overlays/
    dev/
      kustomization.yaml
      patch-resources.yaml
    staging/
      kustomization.yaml
      patch-resources.yaml
    prod/
      kustomization.yaml
      patch-resources.yaml
      hpa.yaml
      pdb.yaml
```

### 6.2 Base

`base/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: payment-platform
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
        app.kubernetes.io/component: api
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api:latest
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            failureThreshold: 30
            periodSeconds: 2
```

`base/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
spec:
  ports:
    - name: http
      port: 80
      targetPort: http
  selector:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
```

`base/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
```

### 6.3 Overlay

`overlays/prod/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: payments-prod
resources:
  - ../../base
  - hpa.yaml
  - pdb.yaml
commonLabels:
  environment: production
images:
  - name: registry.example.com/payment-api
    newTag: 1.8.3
patches:
  - path: patch-resources.yaml
    target:
      kind: Deployment
      name: payment-api
```

`patch-resources.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  template:
    spec:
      containers:
        - name: app
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1Gi"
```

Render:

```bash
kubectl kustomize overlays/prod
```

Apply:

```bash
kubectl apply -k overlays/prod
```

### 6.4 Kustomize strength

Kustomize bagus ketika:

- Kubernetes object relatif eksplisit,
- variasi environment berupa patch/overlay,
- team ingin menghindari template logic,
- reviewer ingin melihat manifest yang dekat dengan API asli,
- base dipakai banyak environment,
- perubahan environment harus mudah dibandingkan,
- GitOps workflow memakai directory per environment.

Kustomize sangat cocok untuk app internal yang polanya terkendali.

### 6.5 Kustomize weakness

Kustomize mulai tidak nyaman ketika:

- variasi sangat kompleks,
- perlu conditional generation yang rumit,
- banyak object optional,
- banyak looping/list dynamic,
- ingin packaging reusable lintas organisasi,
- chart dependency management diperlukan,
- user non-platform perlu konfigurasi high-level.

Kustomize bukan bahasa pemrograman. Jika Anda memaksanya jadi template engine kompleks, hasilnya bisa lebih buruk daripada Helm.

### 6.6 Overlay drift

Overlay drift terjadi saat environment overlay berbeda terlalu jauh.

Contoh:

```text
base punya Deployment + Service
staging patch probes
prod patch probes berbeda
prod patch env berbeda
staging punya NetworkPolicy berbeda
prod punya label selector berbeda
```

Awalnya hanya beda resource. Lama-lama semua environment menjadi sistem berbeda.

Tanda overlay drift:

- bug hanya muncul di production karena manifest production unik,
- staging tidak lagi valid sebagai rehearsal,
- patch sulit dibaca,
- base hampir kosong,
- overlay berisi sebagian besar manifest,
- reviewer tidak bisa tahu hasil akhir tanpa render.

Mitigasi:

- base harus menyimpan invariant workload,
- overlay hanya menyimpan difference yang benar-benar environment-specific,
- render output di CI,
- diff output antar environment,
- gunakan policy untuk invariant penting,
- jangan patch selector kecuali sangat perlu,
- buat convention untuk label, probe, security, resource.

---

## 7. Helm

### 7.1 Mental model Helm

Helm adalah package manager dan templating system untuk Kubernetes.

Mental model:

```text
Chart templates + values = rendered Kubernetes manifests = release installed/upgraded in cluster
```

Chart adalah paket yang berisi template Kubernetes resources.

Struktur umum:

```text
payment-api-chart/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
    hpa.yaml
    pdb.yaml
    configmap.yaml
    _helpers.tpl
```

### 7.2 Chart.yaml

```yaml
apiVersion: v2
name: payment-api
version: 0.1.0
appVersion: "1.8.3"
type: application
```

Perbedaan penting:

```text
version    = versi chart/package
appVersion = versi aplikasi yang chart deploy
```

Jangan mencampur keduanya.

Chart bisa berubah tanpa aplikasi berubah, misalnya menambah PDB. Aplikasi bisa berubah tanpa chart berubah, misalnya image tag baru.

### 7.3 values.yaml

```yaml
replicaCount: 3

image:
  repository: registry.example.com/payment-api
  tag: "1.8.3"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80

resources:
  requests:
    cpu: 500m
    memory: 768Mi
  limits:
    memory: 1Gi

probes:
  readinessPath: /actuator/health/readiness
  livenessPath: /actuator/health/liveness

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 12
  targetCPUUtilizationPercentage: 70
```

### 7.4 Template Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "payment-api.fullname" . }}
  labels:
    {{- include "payment-api.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "payment-api.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "payment-api.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: {{ .Values.probes.readinessPath }}
              port: http
          livenessProbe:
            httpGet:
              path: {{ .Values.probes.livenessPath }}
              port: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

### 7.5 Helm strength

Helm bagus ketika:

- ingin packaging reusable,
- ingin install/upgrade/uninstall release,
- chart dipakai oleh banyak team/cluster,
- perlu dependency chart,
- object optional banyak,
- distribusi ke pihak lain,
- user ingin konfigurasi via `values.yaml`,
- vendor/operator menyediakan chart resmi.

Contoh use case:

- install ingress controller,
- install Prometheus stack,
- install cert-manager,
- install external-dns,
- install observability tooling,
- package standard Java service chart internal.

### 7.6 Helm weakness

Helm bisa berbahaya ketika:

- template terlalu pintar,
- values tidak punya schema jelas,
- `values.yaml` menjadi dumping ground,
- conditional logic menyembunyikan object penting,
- rendered manifest jarang direview,
- chart menghasilkan object cluster-scoped tanpa kontrol,
- rollback Helm dianggap sama dengan rollback aplikasi/data,
- chart lifecycle bertabrakan dengan GitOps controller.

Masalah utama Helm bukan templating-nya. Masalahnya adalah **abstraksi yang terlalu longgar**.

### 7.7 Values sprawl

Values sprawl terjadi saat `values.yaml` menjadi API internal yang tidak didesain.

Contoh buruk:

```yaml
extraEnv: []
extraEnvFrom: []
extraVolumes: []
extraVolumeMounts: []
extraContainers: []
extraInitContainers: []
extraAnnotations: {}
extraLabels: {}
extraPodSpec: {}
extraDeploymentSpec: {}
```

Semua menjadi “extra”. Akibatnya chart tidak lagi memberi guardrail.

Lebih baik bedakan:

```text
Supported stable values:
- image
- resources
- probes
- autoscaling
- config
- service
- ingress/gateway

Escape hatch limited:
- podAnnotations
- podLabels
- extraEnv only if necessary
```

Jika semua field Kubernetes diekspos sebagai values, chart Anda hanya YAML generator yang sulit divalidasi.

### 7.8 Helm values schema

Gunakan `values.schema.json` untuk validasi values.

Contoh sederhana:

```json
{
  "$schema": "https://json-schema.org/schema#",
  "type": "object",
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "required": ["repository", "tag"],
      "properties": {
        "repository": { "type": "string" },
        "tag": { "type": "string" }
      }
    }
  }
}
```

Ini membuat chart lebih seperti API yang punya kontrak, bukan sekadar template bebas.

### 7.9 Helm render dan diff

Render lokal:

```bash
helm template payment-api ./chart -f values-prod.yaml
```

Install dry-run:

```bash
helm install payment-api ./chart -f values-prod.yaml --dry-run --debug
```

Upgrade:

```bash
helm upgrade --install payment-api ./chart -f values-prod.yaml
```

Untuk production, jangan hanya percaya `helm upgrade`. Simpan/render manifest dan lakukan diff.

Contoh workflow review:

```bash
helm template payment-api ./chart -f values-prod.yaml > rendered.yaml
kubectl diff -f rendered.yaml
```

Atau gunakan GitOps controller yang mendukung Helm rendering dan diff.

---

## 8. Kustomize vs Helm

### 8.1 Perbandingan mental model

```text
Kustomize:
- patch/transform manifest Kubernetes asli
- template-free
- bagus untuk variasi environment
- eksplisit dekat dengan API

Helm:
- package + template + release management
- bagus untuk distribusi reusable
- powerful tetapi mudah over-abstract
```

### 8.2 Tabel keputusan

| Situasi | Lebih cocok |
|---|---|
| App internal dengan 3 environment | Kustomize |
| Install software pihak ketiga | Helm |
| Platform ingin standard chart untuk semua Java services | Helm, dengan schema ketat |
| Per-environment patch kecil | Kustomize |
| Banyak object optional dan dependency | Helm |
| Team ingin manifest sangat eksplisit | Kustomize |
| Vendor menyediakan chart official | Helm |
| Butuh packaging versioned | Helm |
| Butuh overlay policy per cluster | Kustomize |
| GitOps repo environment-specific | Kustomize atau Helm rendered by GitOps |

### 8.3 Menggabungkan Helm dan Kustomize

Ada beberapa pola.

#### Pola A: Helm untuk render, Kustomize untuk patch

```text
Helm chart vendor
→ render manifest
→ patch via Kustomize
→ apply via GitOps
```

Cocok jika chart vendor hampir benar tetapi perlu policy internal.

Risiko:

- patch bisa rapuh terhadap perubahan chart,
- upgrade chart bisa mengubah object path,
- hasil akhir harus selalu dirender dan diuji.

#### Pola B: Helm chart internal, values per environment

```text
chart/
values-dev.yaml
values-staging.yaml
values-prod.yaml
```

Cocok jika platform team ingin menyediakan golden chart.

Risiko:

- values sprawl,
- chart terlalu generic,
- app team sulit escape saat kebutuhan unik.

#### Pola C: Kustomize base app, Helm hanya untuk platform components

```text
apps/payment-api/base + overlays
platform/ingress-nginx via Helm
platform/prometheus via Helm
platform/cert-manager via Helm
```

Ini sering paling sehat untuk organisasi yang app-nya internal.

---

## 9. Repository Structure untuk Kubernetes Manifests

Tidak ada satu struktur yang benar untuk semua organisasi. Yang penting adalah ownership, review boundary, environment boundary, dan automation boundary jelas.

### 9.1 App repository contains manifests

```text
payment-api/
  src/
  Dockerfile
  k8s/
    base/
    overlays/
      dev/
      staging/
      prod/
```

Kelebihan:

- app code dan deploy config dekat,
- developer mudah update image/probe/config,
- review feature dan deployment dalam satu repo.

Kekurangan:

- platform policy tersebar,
- perubahan cross-app sulit,
- environment production mungkin terlalu dekat dengan app team,
- GitOps multi-app bisa lebih kompleks.

Cocok untuk:

- team kecil-menengah,
- app ownership kuat,
- platform belum terlalu matang.

### 9.2 Separate environment repository

```text
gitops-env/
  clusters/
    prod-cluster-1/
      apps/
        payment-api/
        order-api/
      platform/
        ingress/
        cert-manager/
        monitoring/
    staging-cluster-1/
      apps/
        payment-api/
        order-api/
```

Kelebihan:

- environment state jelas,
- GitOps friendly,
- production changes bisa punya approval berbeda,
- cluster-level policy terlihat.

Kekurangan:

- app change dan deploy change terpisah,
- perlu promotion process,
- raw duplication bisa meningkat.

Cocok untuk:

- organisasi lebih besar,
- production governance ketat,
- platform team/SRE kuat,
- multi-cluster.

### 9.3 Platform chart + app values repository

```text
platform-charts/
  java-service/
    Chart.yaml
    templates/
    values.schema.json

service-configs/
  payment-api/
    values-dev.yaml
    values-staging.yaml
    values-prod.yaml
```

Kelebihan:

- standardisasi tinggi,
- golden path kuat,
- app team tidak perlu menulis banyak YAML,
- policy bisa baked-in.

Kekurangan:

- chart menjadi platform API,
- kebutuhan unik bisa sulit,
- chart harus dikelola seperti produk,
- versioning chart penting.

Cocok untuk:

- banyak Java service dengan pola serupa,
- platform engineering matang,
- developer experience menjadi prioritas.

### 9.4 Struktur yang saya rekomendasikan untuk seri ini

Untuk pembelajaran dan implementasi realistis:

```text
kubernetes-platform-learning/
  apps/
    payment-api/
      base/
        deployment.yaml
        service.yaml
        configmap.yaml
        kustomization.yaml
      overlays/
        dev/
          kustomization.yaml
          patch-resources.yaml
        staging/
          kustomization.yaml
          patch-resources.yaml
          hpa.yaml
        prod/
          kustomization.yaml
          patch-resources.yaml
          hpa.yaml
          pdb.yaml
          networkpolicy.yaml
  platform/
    namespaces/
    rbac/
    policies/
    ingress-gateway/
  clusters/
    local-kind/
    staging/
    prod/
```

Alasan:

- dekat dengan Kubernetes API asli,
- mudah memahami object graph,
- cocok untuk Java service internal,
- GitOps-compatible,
- tidak terlalu abstrak di fase belajar.

---

## 10. Naming, Labels, and Annotation Convention

### 10.1 Naming object

Nama object harus stabil dan predictable.

Baik:

```text
payment-api
payment-worker
payment-migration
payment-api-config
payment-api-hpa
```

Buruk:

```text
payment-api-prod-v1-final-new
payment-api-20260101
pa
app1
service
```

Rule:

```text
metadata.name harus menggambarkan logical component, bukan release ephemeral.
```

Release/version sebaiknya label atau annotation, bukan name utama, kecuali memang object berbeda.

### 10.2 Label convention minimum

Gunakan recommended labels Kubernetes:

```yaml
app.kubernetes.io/name: payment-api
app.kubernetes.io/instance: payment-api-prod
app.kubernetes.io/version: "1.8.3"
app.kubernetes.io/component: api
app.kubernetes.io/part-of: payment-platform
app.kubernetes.io/managed-by: kustomize
```

Tambahkan label organisasi:

```yaml
team: payments
environment: production
cost-center: fintech-platform
tier: backend
criticality: high
```

Tetapi hati-hati: label yang dipakai selector harus stabil.

`app.kubernetes.io/version` bagus untuk observability, tetapi jangan jadikan selector Service default.

### 10.3 Annotation convention

Contoh annotation production:

```yaml
metadata:
  annotations:
    git.example.com/repo: "payment-api"
    git.example.com/commit: "a91c4e8"
    runbook.example.com/url: "https://internal.example.com/runbooks/payment-api"
    pager.example.com/service: "payment-api"
```

Annotation berguna untuk traceability. Tetapi jangan memasukkan:

- password,
- token,
- private key,
- large JSON besar tanpa alasan,
- data yang harus bisa diseleksi/query sebagai label.

---

## 11. Environment-Specific Configuration

### 11.1 Apa yang boleh berbeda antar environment?

Perbedaan yang wajar:

```text
replica count / HPA min max
resource request/limit
hostname
namespace
external dependency endpoint
secret reference
feature flag tertentu
node pool / affinity
PDB strictness
NetworkPolicy egress destination
log verbosity terbatas
```

Perbedaan yang berbahaya:

```text
probe path berbeda total
Service selector berbeda
securityContext production lebih longgar
deployment strategy berbeda tanpa alasan
container port berbeda
startup behavior berbeda
DB migration mode berbeda
major dependency topology berbeda
```

Semakin besar perbedaan staging dan production, semakin kecil nilai staging sebagai rehearsal.

### 11.2 Config value vs manifest topology

Jangan mencampur dua hal:

```text
Application config value:
- timeout
- feature flag
- external endpoint
- pool size

Kubernetes topology:
- Deployment
- Service
- HPA
- PDB
- NetworkPolicy
- Gateway route
```

ConfigMap cocok untuk app config. Manifest overlay cocok untuk topology.

Contoh buruk:

```yaml
data:
  replicas: "5"
  cpuRequest: "500m"
```

Aplikasi tidak seharusnya membaca jumlah replica dari ConfigMap untuk mengontrol Kubernetes.

Contoh baik:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 3
  maxReplicas: 12
```

### 11.3 Image tag management

Ada beberapa strategi:

#### Mutable tag

```yaml
image: payment-api:latest
```

Tidak direkomendasikan untuk production. Sulit audit dan rollback.

#### Semantic/application version tag

```yaml
image: payment-api:1.8.3
```

Lebih baik, mudah dibaca.

#### Git SHA tag

```yaml
image: payment-api:a91c4e8
```

Bagus untuk traceability.

#### Digest pinning

```yaml
image: registry.example.com/payment-api@sha256:abc123...
```

Paling kuat untuk supply chain immutability.

Rekomendasi production:

```text
Use immutable image reference.
Prefer tag + digest where supported by tooling.
At minimum, avoid latest/mutable tags for production.
```

---

## 12. Secret Handling in Manifests

### 12.1 Jangan commit raw Secret value

Buruk:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-api-secret
type: Opaque
data:
  password: cGFzc3dvcmQ=
```

Base64 bukan encryption. Ini hanya encoding.

### 12.2 Pilihan pengelolaan secret

Beberapa pola:

```text
External Secrets Operator / secret sync controller
Sealed Secrets
SOPS encrypted manifest
Cloud secret manager + CSI driver
Manual secret pre-provisioned by platform
```

Pilihan tergantung governance organisasi.

Untuk manifest app, lebih aman refer ke secret yang sudah ada:

```yaml
envFrom:
  - secretRef:
      name: payment-api-secret
```

Atau lebih eksplisit:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: payment-api-secret
        key: db-password
```

### 12.3 Secret name stability

Jika secret rotation menghasilkan nama baru setiap kali, pastikan rollout trigger jelas.

Misalnya:

```yaml
metadata:
  annotations:
    checksum/secret: "..."
```

Atau gunakan controller yang mengatur restart/reload.

Jangan mengandalkan aplikasi otomatis membaca secret baru jika secret dikonsumsi sebagai env var. Env var tidak berubah pada process yang sudah berjalan.

---

## 13. Manifest Validation

### 13.1 Validasi sintaks bukan validasi semantik

YAML valid belum tentu Kubernetes object valid.

Kubernetes object valid belum tentu aman secara production.

Production-safe membutuhkan beberapa layer validasi:

```text
YAML parse validation
Kubernetes schema validation
API server dry-run
Admission policy validation
Security policy validation
Custom organization policy
Rendered diff review
Runtime smoke test
```

### 13.2 Tools dan teknik validasi

#### Render check

Kustomize:

```bash
kubectl kustomize overlays/prod > rendered.yaml
```

Helm:

```bash
helm template payment-api ./chart -f values-prod.yaml > rendered.yaml
```

#### Client-side dry-run

```bash
kubectl apply --dry-run=client -f rendered.yaml
```

#### Server-side dry-run

```bash
kubectl apply --dry-run=server -f rendered.yaml
```

Server-side dry-run lebih realistis karena menggunakan API server dan admission chain tertentu.

#### Diff

```bash
kubectl diff -f rendered.yaml
```

#### Explain

```bash
kubectl explain deployment.spec.strategy
kubectl explain pod.spec.securityContext
```

#### API schema awareness

Gunakan editor/CI yang punya Kubernetes schema validation agar typo field terlihat.

Contoh typo berbahaya:

```yaml
resource:
  requests:
    cpu: 500m
```

Harusnya:

```yaml
resources:
  requests:
    cpu: 500m
```

Jika tool tidak validasi schema, typo ini bisa diabaikan atau ditolak tergantung field dan mode validasi.

### 13.3 Policy validation

Contoh policy organisasi:

```text
All containers must have resource requests.
Privileged containers are forbidden.
Image must come from approved registry.
latest tag is forbidden.
runAsNonRoot must be true.
readOnlyRootFilesystem should be true unless exception.
All Deployments need app.kubernetes.io/name label.
Production workloads need PDB.
Production workloads need readinessProbe.
```

Policy bisa ditegakkan melalui:

- admission controller,
- Kyverno,
- OPA Gatekeeper,
- ValidatingAdmissionPolicy,
- CI checks,
- GitOps pre-sync hooks,
- custom linter.

Policy di CI memberi feedback lebih cepat. Policy di admission memberi enforcement terakhir.

Keduanya saling melengkapi.

---

## 14. Diff, Drift, and Review

### 14.1 Review manifest source tidak cukup

Jika memakai Helm atau Kustomize, reviewer harus bisa melihat output akhir.

Review ini:

```yaml
resources:
  requests:
    cpu: {{ .Values.resources.requests.cpu }}
```

Tidak cukup tanpa values.

Review yang lebih baik:

```yaml
resources:
  requests:
    cpu: 500m
    memory: 768Mi
```

Dalam CI, hasil render bisa dipublish sebagai artifact atau komentar PR.

### 14.2 Drift

Drift adalah perbedaan antara intended state di repo dan live state di cluster.

Sumber drift:

- manual hotfix,
- HPA mengubah replicas,
- mutating webhook,
- operator update,
- defaulting API server,
- controller status,
- cloud provider annotation,
- Helm release state,
- GitOps controller berbeda config.

Tidak semua drift buruk. Status field memang harus berbeda. Defaulted fields wajar. Yang penting adalah membedakan drift yang legitimate dan drift yang berbahaya.

### 14.3 Ignore rules harus hati-hati

GitOps tools sering punya ignore differences.

Contoh legitimate:

```text
Ignore /spec/replicas if HPA owns it.
Ignore fields injected by sidecar webhook.
Ignore cert-manager generated fields.
```

Berbahaya:

```text
Ignore all annotations.
Ignore all resources.
Ignore all securityContext.
```

Ignore terlalu luas menghilangkan kemampuan drift detection.

---

## 15. Java Service Manifest Blueprint

Berikut baseline manifest untuk Java REST API internal. Ini bukan final untuk semua organisasi, tetapi memberi bentuk production-conscious.

### 15.1 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: payment-platform
spec:
  revisionHistoryLimit: 5
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
      app.kubernetes.io/component: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
        app.kubernetes.io/component: api
      annotations:
        checksum/config: "REPLACED_BY_KUSTOMIZE_OR_HELM"
    spec:
      serviceAccountName: payment-api
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 45
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/payment-api:1.8.3
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:InitialRAMPercentage=40
                -XX:+ExitOnOutOfMemoryError
            - name: SPRING_PROFILES_ACTIVE
              value: kubernetes
          envFrom:
            - configMapRef:
                name: payment-api-config
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
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 2
            failureThreshold: 60
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1Gi"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
```

Catatan:

- `automountServiceAccountToken: false` jika aplikasi tidak memanggil Kubernetes API.
- CPU limit tidak dipasang di contoh ini untuk menghindari throttling agresif; keputusan ini harus sesuai policy organisasi.
- `readOnlyRootFilesystem` memerlukan app menulis temporary file ke volume eksplisit jika perlu.
- `preStop sleep` bukan solusi ideal untuk semua kasus, tetapi sering membantu endpoint propagation/draining. Untuk sistem serius, kombinasikan dengan graceful shutdown aplikasi.

### 15.2 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

### 15.3 HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-api
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### 15.4 PDB

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-api
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
      app.kubernetes.io/component: api
```

### 15.5 ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-api
automountServiceAccountToken: false
```

### 15.6 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payment-api-config
data:
  SERVER_SHUTDOWN: graceful
  SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE: 30s
  MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED: "true"
```

---

## 16. Composition Anti-Patterns

### 16.1 “One manifest to rule them all”

Satu file raksasa:

```text
all.yaml
```

Berisi Namespace, Deployment, Service, HPA, PDB, RBAC, Ingress, NetworkPolicy, Secret, ConfigMap untuk semua environment.

Masalah:

- sulit review,
- sulit diff,
- ownership kabur,
- environment bercampur,
- blast radius besar,
- merge conflict tinggi.

Lebih baik pecah berdasarkan resource dan boundary.

### 16.2 Copy-paste environment

```text
dev/deployment.yaml
staging/deployment.yaml
prod/deployment.yaml
```

Semua hampir sama, tetapi tidak ada base.

Masalah:

- drift cepat,
- bug fix tidak merata,
- sulit tahu perbedaan intentional atau accidental.

Gunakan base/overlay atau chart values.

### 16.3 Templating semua hal

Jika chart punya conditional untuk hampir setiap field:

```yaml
{{- if .Values.magic.enabled }}
{{- if .Values.magic.modeA }}
{{- if .Values.magic.modeB }}
```

Chart menjadi program tanpa test.

Rule:

```text
Jika template logic membutuhkan reasoning kompleks, desain abstraksinya salah atau butuh controller/operator/platform API.
```

### 16.4 Selector berubah karena template helper

Helm helper buruk bisa membuat selector menyertakan chart version:

```yaml
selectorLabels:
  app.kubernetes.io/name: payment-api
  helm.sh/chart: payment-api-0.1.0
```

Saat chart version berubah, selector berubah. Untuk Deployment, ini bisa gagal karena selector immutable. Untuk Service, ini bisa memutus endpoint.

Selector labels harus stabil.

### 16.5 ConfigMap generator name hash tanpa rollout understanding

Kustomize bisa membuat ConfigMap dengan hash nama. Ini berguna untuk rollout, tetapi harus dipahami.

Contoh:

```yaml
configMapGenerator:
  - name: payment-api-config
    literals:
      - FEATURE_X=true
```

Output bisa menjadi:

```text
payment-api-config-abc123
```

Jika Deployment reference otomatis diperbarui oleh Kustomize, bagus. Jika ada object lain yang hardcode nama lama, rusak.

### 16.6 Secret di values file

Buruk:

```yaml
database:
  password: supersecret
```

Lalu Helm template membuat Secret.

Masalah:

- values file masuk Git,
- values muncul di CI log,
- Helm release secret/configmap bisa menyimpan rendered secret,
- akses ke Helm release state bisa mengekspos secret.

Gunakan external secret flow atau encrypted secret management.

### 16.7 `kubectl edit` sebagai workflow normal

`kubectl edit` berguna untuk emergency/debugging. Tetapi jika menjadi workflow normal:

- Git tidak tahu perubahan,
- review hilang,
- rollback kacau,
- GitOps akan revert,
- audit intent sulit.

Emergency hotfix harus segera direkonsiliasi ke source of truth.

---

## 17. Practical Workflow: From Source to Cluster

### 17.1 Kustomize workflow

```bash
# 1. Render
kubectl kustomize apps/payment-api/overlays/prod > /tmp/payment-api-prod.yaml

# 2. Validate against API server
kubectl apply --dry-run=server -f /tmp/payment-api-prod.yaml

# 3. See diff
kubectl diff -f /tmp/payment-api-prod.yaml

# 4. Apply
kubectl apply -f /tmp/payment-api-prod.yaml

# atau langsung
kubectl apply -k apps/payment-api/overlays/prod
```

### 17.2 Helm workflow

```bash
# 1. Lint chart
helm lint ./charts/payment-api

# 2. Render
helm template payment-api ./charts/payment-api -f values-prod.yaml > /tmp/payment-api-prod.yaml

# 3. Validate
kubectl apply --dry-run=server -f /tmp/payment-api-prod.yaml

# 4. Diff
kubectl diff -f /tmp/payment-api-prod.yaml

# 5. Upgrade
helm upgrade --install payment-api ./charts/payment-api -f values-prod.yaml --namespace payments-prod
```

### 17.3 GitOps workflow

```text
Developer changes manifest/value/image tag
→ Pull request
→ CI renders final manifest
→ CI validates schema/policy
→ Human reviews source + rendered diff
→ Merge
→ GitOps controller syncs
→ Controller reports health/drift
→ Observability confirms rollout
```

Kunci GitOps bukan hanya “apply dari Git”. Kuncinya adalah:

```text
Git contains desired state.
Cluster converges to Git.
Drift is visible.
Change is auditable.
Rollback is a Git operation.
```

---

## 18. Debugging Manifest Problems

### 18.1 Symptom: `kubectl apply` gagal schema validation

Contoh error:

```text
error: error validating "deployment.yaml": error validating data: ValidationError(Deployment.spec.template.spec.containers[0]): unknown field "resource"
```

Kemungkinan:

- typo field,
- apiVersion salah,
- field tidak tersedia di versi Kubernetes tersebut,
- indentation YAML salah,
- object kind salah.

Langkah:

```bash
kubectl explain deployment.spec.template.spec.containers.resources
kubectl apply --dry-run=server -f deployment.yaml
```

### 18.2 Symptom: apply sukses tetapi tidak ada perubahan runtime

Kemungkinan:

- field yang diubah tidak memicu rollout,
- ConfigMap berubah tetapi Pod env var tidak berubah,
- selector tidak match,
- controller lain overwrite field,
- GitOps revert,
- patch target salah,
- Kustomize overlay tidak memasukkan file,
- Helm values tidak dipakai.

Langkah:

```bash
kubectl get deploy payment-api -o yaml
kubectl rollout history deploy/payment-api
kubectl describe deploy payment-api
kubectl get rs -l app.kubernetes.io/name=payment-api
kubectl get pods -l app.kubernetes.io/name=payment-api --show-labels
```

### 18.3 Symptom: Helm upgrade sukses tetapi app rusak

Kemungkinan:

- rendered manifest berubah lebih besar dari yang disadari,
- values default berubah,
- chart version upgrade mengubah label/selector,
- hook menjalankan job/migration bermasalah,
- Secret/ConfigMap berubah tanpa readiness protection,
- rollback chart tidak rollback data.

Langkah:

```bash
helm history payment-api
helm get manifest payment-api
helm get values payment-api
helm template payment-api ./chart -f values-prod.yaml
```

### 18.4 Symptom: Kustomize patch tidak bekerja

Kemungkinan:

- target `kind/name/namespace` salah,
- patch path salah,
- resource belum dimasukkan di kustomization,
- namespace transform mengubah target,
- patch format salah,
- field list merge tidak sesuai ekspektasi.

Langkah:

```bash
kubectl kustomize overlays/prod | less
kubectl kustomize overlays/prod | grep -n "payment-api" -A 50
```

Debug Kustomize selalu mulai dari output render.

### 18.5 Symptom: GitOps controller terus OutOfSync

Kemungkinan:

- HPA mengubah replicas,
- webhook inject annotation/sidecar,
- cert-manager mengubah Secret,
- controller defaulting field,
- manual edit,
- Helm random function menghasilkan output berbeda,
- generated timestamp/checksum tidak stabil.

Langkah:

- lihat diff GitOps,
- identifikasi field yang drift,
- tentukan pemilik field,
- buat ignore rule sempit jika drift legitimate,
- ubah manifest jika drift tidak legitimate.

---

## 19. Design Trade-Off

### 19.1 Explicitness vs abstraction

Manifest eksplisit:

```text
+ mudah dibaca
+ dekat dengan API Kubernetes
+ mudah debug
- banyak duplikasi
- sulit standardisasi besar-besaran
```

Abstraction/template:

```text
+ mengurangi duplikasi
+ bisa enforce golden path
+ mudah package reusable
- bisa menyembunyikan intent
- debugging perlu render
- API internal chart bisa membengkak
```

Rekomendasi:

```text
Mulai eksplisit.
Abstraksikan setelah pola stabil.
Jangan abstraksikan sebelum memahami invariant.
```

### 19.2 DRY vs safe repetition

DRY berlebihan bisa berbahaya.

Contoh: semua service memakai satu global values block untuk probes, resources, security, HPA.

Masalah:

- service dengan startup lambat rusak,
- batch worker dapat probe REST API yang tidak relevan,
- perubahan global memengaruhi semua service,
- exception sulit.

Safe repetition lebih baik daripada abstraction yang salah.

### 19.3 Platform control vs app autonomy

Platform terlalu longgar:

- tiap team membuat pola sendiri,
- security tidak konsisten,
- observability tidak standar,
- operational burden tinggi.

Platform terlalu ketat:

- app unik sulit deploy,
- team bypass platform,
- chart menjadi bottleneck,
- exception menumpuk.

Model sehat:

```text
Golden path for common case.
Escape hatch with review.
Policy for non-negotiable constraints.
Clear ownership for field groups.
```

---

## 20. Production Checklist

Sebelum manifest Java service dianggap production-ready, cek:

### Identity and labels

- [ ] `metadata.name` stabil.
- [ ] Namespace benar.
- [ ] Recommended labels ada.
- [ ] Selector stabil dan tidak mengandung version/release volatile.
- [ ] Label team/environment/cost/criticality tersedia jika organisasi membutuhkan.

### Workload correctness

- [ ] Deployment selector match Pod template labels.
- [ ] Service selector match Pod labels.
- [ ] Container port dinamai.
- [ ] Service `targetPort` menggunakan named port jika memungkinkan.
- [ ] Image immutable atau minimal bukan `latest`.
- [ ] Rollout strategy sesuai availability target.

### Java runtime

- [ ] Resource requests diset.
- [ ] Memory limit selaras dengan JVM heap/non-heap.
- [ ] `JAVA_TOOL_OPTIONS` sesuai cgroup/container runtime.
- [ ] Probes terpisah readiness/liveness/startup.
- [ ] Graceful shutdown dikonfigurasi.
- [ ] `terminationGracePeriodSeconds` cukup.

### Security

- [ ] `runAsNonRoot`.
- [ ] `allowPrivilegeEscalation: false`.
- [ ] Capabilities drop ALL jika memungkinkan.
- [ ] `seccompProfile: RuntimeDefault`.
- [ ] ServiceAccount token tidak dimount jika tidak perlu.
- [ ] Secret tidak di-commit plain/base64.
- [ ] Image registry trusted.

### Reliability

- [ ] PDB untuk production replicas > 1.
- [ ] HPA jika traffic/load dinamis.
- [ ] NetworkPolicy jika cluster menerapkan segmentation.
- [ ] Config rollout trigger jelas.
- [ ] Rollback path dipahami.
- [ ] DB migration compatibility dipikirkan.

### Composition

- [ ] Render output bisa dibuat lokal/CI.
- [ ] Dry-run server-side berjalan.
- [ ] Diff bisa direview.
- [ ] Overlay/values tidak drift berlebihan.
- [ ] Chart values punya schema jika Helm.
- [ ] Patch Kustomize target jelas.
- [ ] Tidak ada random/timestamp output yang membuat drift palsu.

### Observability

- [ ] Logs ke stdout/stderr.
- [ ] Metrics endpoint tersedia.
- [ ] Trace/correlation ID strategy tersedia.
- [ ] Runbook annotation/link tersedia jika digunakan.
- [ ] Alert terkait rollout/probe/resource ada.

---

## 21. Latihan

### Latihan 1 — Raw YAML review

Ambil manifest Deployment Java service berikut dan review:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: app
      version: latest
  template:
    metadata:
      labels:
        app: app
        version: latest
    spec:
      containers:
        - name: app
          image: payment-api:latest
          ports:
            - containerPort: 8080
```

Cari minimal 12 masalah production-readiness.

Hint:

- naming,
- labels,
- selector,
- image,
- resources,
- probes,
- security,
- namespace,
- rollout,
- service account,
- observability,
- availability.

### Latihan 2 — Buat Kustomize base/overlay

Buat struktur:

```text
payment-api/
  base/
  overlays/dev/
  overlays/prod/
```

Requirement:

- base punya Deployment dan Service,
- dev replicas 1,
- prod HPA min 3 max 12,
- prod memory request 768Mi limit 1Gi,
- prod punya PDB minAvailable 2,
- image tag berbeda antara dev dan prod,
- namespace berbeda.

Render output dan cek apakah Service selector match Pod labels.

### Latihan 3 — Helm values design

Desain `values.yaml` untuk standard Java service chart.

Buat dua versi:

1. versi buruk yang terlalu generic,
2. versi baik yang punya stable API.

Bandingkan trade-off.

### Latihan 4 — Detect drift

Simulasikan:

```bash
kubectl scale deploy/payment-api --replicas=10
```

Jika manifest menyatakan replicas 3 dan HPA tidak aktif, apa yang terjadi saat GitOps sync?

Jika HPA aktif, bagaimana sebaiknya `replicas` diperlakukan?

### Latihan 5 — Render-first review

Ambil Helm chart atau Kustomize overlay yang Anda punya.

Lakukan:

```bash
helm template ... > rendered.yaml
# atau
kubectl kustomize ... > rendered.yaml
```

Review hanya `rendered.yaml`. Catat hal yang tidak terlihat jelas dari source template/overlay.

---

## 22. Ringkasan

Manifest Kubernetes bukan sekadar YAML. Manifest adalah cara menyatakan desired state kepada API server.

Hal yang harus melekat:

```text
YAML is serialization.
Kubernetes API object is the contract.
Controller reconciliation is the execution model.
Composition tooling is only a means to produce valid desired state.
```

Raw YAML bagus untuk belajar dan object sederhana, tetapi cepat bermasalah saat environment dan workload bertambah.

Kustomize cocok untuk komposisi berbasis base/overlay yang tetap dekat dengan Kubernetes API asli.

Helm cocok untuk packaging, reuse, dependency, dan chart distribusi, tetapi harus dikelola seperti API produk agar tidak berubah menjadi template spaghetti.

Production manifest harus memenuhi beberapa kualitas:

- identitas object stabil,
- selector aman,
- label/annotation konsisten,
- resource/probe/security jelas,
- environment difference terkendali,
- rendered output bisa direview,
- dry-run dan diff tersedia,
- field ownership dipahami,
- secret tidak bocor,
- drift bisa dideteksi,
- rollback path masuk akal.

Untuk Java engineer, manifest yang baik bukan hanya membuat aplikasi “jalan”. Manifest yang baik membuat aplikasi:

```text
schedulable,
observable,
secure,
scalable,
upgradable,
debuggable,
and operationally defensible.
```

---

## 23. Referensi Resmi

- Kubernetes Documentation — Declarative Management of Kubernetes Objects Using Kustomize
- Kubernetes Documentation — Declarative Management of Kubernetes Objects Using Configuration Files
- Kubernetes Documentation — Kubernetes Object Management
- Kubernetes Documentation — Server-Side Apply
- Kubernetes Documentation — Labels and Selectors
- Kubernetes Documentation — Recommended Labels
- Kubernetes Documentation — Annotations
- Helm Documentation — Charts
- Helm Documentation — Chart Template Guide
- Helm Documentation — Values Files
- Helm Documentation — Chart Development Tips and Tricks
- Helm Documentation — Values Best Practices


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Debugging Kubernetes: A Systematic Failure Investigation Method</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-024.md">Part 024 — GitOps and Delivery Control Planes ➡️</a>
</div>
