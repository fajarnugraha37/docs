# learn-kubernetes-mastery-for-java-engineers-part-024.md

# Part 024 — GitOps and Delivery Control Planes

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Bagian: `024 / 035`  
> Topik: GitOps, delivery control plane, drift detection, sync, prune, promotion, rollback, policy, dan failure-mode delivery  
> Target pembaca: Java software engineer / tech lead yang sudah memahami Kubernetes API object model, workload controller, service discovery, deployment strategy, probes, autoscaling, namespace, RBAC, security, observability, debugging, dan manifest composition.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 023, kita sudah membangun fondasi besar:

1. Kubernetes adalah **desired-state reconciliation machine**.
2. Object Kubernetes punya `spec`, `status`, `metadata`, ownership, finalizer, dan lifecycle.
3. Workload Java dijalankan melalui controller seperti `Deployment`, `StatefulSet`, `Job`, dan `CronJob`.
4. Deployment strategy menentukan bagaimana perubahan masuk ke cluster.
5. Manifest composition dengan YAML, Kustomize, dan Helm menentukan bagaimana desired state disusun.

Part ini membahas satu lapisan di atasnya:

> Bagaimana desired state dari repository berubah menjadi live state di cluster secara terkendali, teramati, dapat diaudit, dan dapat dipulihkan?

Itulah domain **GitOps** dan **delivery control plane**.

GitOps bukan sekadar:

```text
Simpan YAML di Git lalu jalankan kubectl apply dari CI.
```

GitOps yang matang adalah:

```text
Git menyimpan desired state.
Controller di cluster membaca desired state itu.
Controller membandingkan desired state dengan live state.
Controller melakukan reconcile.
Controller melaporkan drift, sync status, health, dan error.
```

Dengan kata lain, GitOps membawa mental model Kubernetes sendiri ke proses delivery.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami perbedaan **CI/CD biasa**, **push-based deploy**, dan **pull-based GitOps**.
2. Mendesain repository GitOps yang masuk akal untuk Java microservices.
3. Memahami konsep:
   - desired state,
   - live state,
   - target revision,
   - sync,
   - drift,
   - prune,
   - health,
   - promotion,
   - rollback.
4. Memahami peran tools seperti **Argo CD** dan **Flux** tanpa terjebak pada tool-specific memorization.
5. Mendesain deployment flow yang aman untuk:
   - stateless Java API,
   - worker/consumer,
   - scheduled job,
   - platform add-on,
   - multi-environment cluster.
6. Memahami failure mode GitOps:
   - Git desired state salah,
   - controller fight dengan human hotfix,
   - auto-prune menghapus object penting,
   - sync ordering salah,
   - rollback manifest tidak kompatibel dengan database migration,
   - secret/config drift,
   - policy/admission block.
7. Membedakan GitOps sebagai **delivery mechanism** dari release engineering, observability, security, dan platform governance.

---

## 2. Problem yang Diselesaikan GitOps

Tanpa GitOps, deployment Kubernetes sering berubah menjadi campuran beberapa mekanisme:

```text
Developer merge code
  -> CI build image
  -> CI push image
  -> CI kubectl apply
  -> manual hotfix pakai kubectl edit
  -> Helm upgrade dari laptop
  -> platform team patch config
  -> operator reconcile object tertentu
  -> tidak jelas state mana yang benar
```

Masalahnya bukan hanya teknis. Masalahnya adalah **source of truth**.

Pertanyaan yang sering muncul di production:

1. Manifest yang sekarang running berasal dari commit mana?
2. Apakah cluster sama dengan Git?
3. Siapa mengubah `replicas` dari 4 ke 8?
4. Apakah perubahan manual akan hilang?
5. Apakah rollback cukup revert commit?
6. Apakah object yang dihapus dari Git akan ikut dihapus dari cluster?
7. Apakah deployment dev/staging/prod benar-benar konsisten?
8. Mengapa aplikasi live berbeda dari manifest yang kita review?
9. Apakah CI punya credential cluster production?
10. Saat incident, bolehkah patch langsung cluster?

GitOps mencoba menjawab ini dengan prinsip:

```text
The repository is the desired state contract.
The cluster is reconciled toward that contract.
Manual changes are drift unless explicitly promoted back to Git.
```

---

## 3. Mental Model Utama: GitOps sebagai Controller di Atas Controller

Kubernetes controller melakukan reconcile object seperti ini:

```text
Deployment spec says replicas = 3
Actual Pods = 2
Deployment controller creates 1 more Pod
```

GitOps controller melakukan reconcile seperti ini:

```text
Git says Deployment image = app:v2
Cluster live Deployment image = app:v1
GitOps controller applies v2
```

Jadi GitOps adalah **higher-level reconciliation loop**.

```text
Git repository
  -> rendered manifests
  -> desired Kubernetes objects
  -> GitOps controller
  -> Kubernetes API server
  -> native Kubernetes controllers
  -> Pods/Services/Jobs/etc.
```

Lapisan reconcile-nya bertingkat:

```text
GitOps Controller
  reconciles Git desired state into Kubernetes API objects

Kubernetes Controllers
  reconcile Kubernetes API objects into cluster runtime reality

Kubelet / Runtime / CNI / CSI
  reconcile node-level runtime state

Application Runtime
  reconciles internal app state, cache, connection pool, threads, consumers, etc.
```

Ini penting karena ketika deployment gagal, failure bisa terjadi di beberapa layer:

```text
Git layer        : wrong manifest, wrong image tag, wrong values
GitOps layer     : sync failed, auth failed, render failed, prune failed
API layer        : admission denied, RBAC denied, validation failed
Controller layer : rollout stuck, PVC pending, HPA unstable
Runtime layer    : crash, OOM, probe failure
Application layer: DB migration incompatible, feature flag wrong
```

Engineer yang kuat tidak berhenti pada:

```text
Argo/Flux merah.
```

Ia bertanya:

```text
Merah di layer mana?
```

---

## 4. GitOps Bukan CI/CD Pengganti Sepenuhnya

GitOps sering dijual sebagai “modern CI/CD”. Lebih akurat:

```text
CI membangun dan memvalidasi artefak.
GitOps mengirim desired state ke cluster melalui reconciliation.
```

CI tetap penting untuk:

1. Compile Java code.
2. Unit test.
3. Integration test.
4. Static analysis.
5. Build container image.
6. Scan image.
7. Generate SBOM.
8. Sign image.
9. Publish image.
10. Update deployment manifest atau image tag reference.

GitOps penting untuk:

1. Membaca manifest dari Git.
2. Render Kustomize/Helm/plain YAML.
3. Compare dengan live state.
4. Apply perubahan.
5. Detect drift.
6. Report health.
7. Prune object yang sudah tidak didefinisikan.
8. Enforce deployment dari source of truth.

Flow umum:

```text
Developer push code
  -> CI test/build/scan/sign image
  -> CI push image to registry
  -> CI updates GitOps repo image tag/digest
  -> GitOps controller detects Git change
  -> GitOps controller syncs cluster
  -> Kubernetes rollout starts
  -> Observability verifies runtime health
```

Perhatikan satu hal penting:

> GitOps tidak otomatis menjamin release benar. GitOps hanya menjamin cluster bergerak menuju desired state yang ada di Git.

Kalau Git berisi desired state yang salah, GitOps akan merekonsiliasi cluster menuju kesalahan itu dengan sangat konsisten.

---

## 5. Push-Based Deploy vs Pull-Based GitOps

### 5.1 Push-Based Deploy

Pada model push-based, CI/CD system punya credential ke cluster dan menjalankan command:

```bash
kubectl apply -f manifests/
helm upgrade my-app ./chart
```

Flow:

```text
CI system
  -> authenticates to cluster
  -> pushes change to API server
```

Kelebihan:

1. Sederhana.
2. Mudah dimulai.
3. Cocok untuk eksperimen kecil.
4. Banyak engineer sudah familiar.

Kelemahan:

1. CI perlu credential cluster.
2. Sulit detect drift secara terus-menerus.
3. Status deployment tersebar di CI logs.
4. Manual change bisa bertahan diam-diam.
5. Multi-cluster credential management kompleks.
6. Rollback sering tergantung pipeline behavior.
7. Audit “state saat ini berasal dari mana” tidak selalu jelas.

### 5.2 Pull-Based GitOps

Pada model pull-based, cluster memiliki controller yang menarik desired state dari Git.

Flow:

```text
GitOps controller inside cluster
  -> authenticates to Git/OCI/Helm repo
  -> renders manifests
  -> applies to Kubernetes API server
```

Kelebihan:

1. CI tidak perlu direct production cluster credential.
2. Drift detection built-in.
3. Git menjadi audit trail.
4. Cluster dapat self-heal terhadap manual drift.
5. Multi-cluster lebih mudah: setiap cluster pull config-nya sendiri.
6. Deployment status bisa dilihat dari cluster control plane.
7. Reconciliation model konsisten dengan Kubernetes.

Kelemahan:

1. Butuh controller tambahan.
2. Butuh desain repo dan permission yang matang.
3. Kesalahan Git bisa cepat tersebar.
4. Auto-sync/prune bisa berbahaya kalau tidak dibatasi.
5. Hotfix manual harus punya prosedur jelas.
6. Rendering Helm/Kustomize bisa menjadi failure point.
7. Debugging melibatkan satu layer tambahan.

### 5.3 Tabel Perbandingan

| Aspek | Push-Based CI/CD | Pull-Based GitOps |
|---|---|---|
| Siapa apply ke cluster | CI/CD pipeline | Controller di cluster |
| Credential cluster | Ada di CI | Ada di cluster/controller |
| Source of truth | Bisa pipeline, Git, atau campuran | Git/repository desired state |
| Drift detection | Biasanya tidak continuous | Continuous atau interval reconciliation |
| Manual hotfix | Bisa bertahan diam-diam | Biasanya dianggap drift dan dikembalikan |
| Multi-cluster | Credential dan target perlu dikelola CI | Cluster pull config masing-masing |
| Audit | Commit + pipeline log | Commit + controller state + Kubernetes events |
| Risiko utama | Credential sprawl, undetected drift | Bad desired state reconciled consistently |

---

## 6. Core Vocabulary GitOps

### 6.1 Desired State

Desired state adalah state yang ingin dicapai.

Dalam GitOps, desired state biasanya berupa:

```text
YAML manifest
Kustomize overlay
Helm chart + values
OCI artifact
```

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api@sha256:...
```

### 6.2 Live State

Live state adalah object yang saat ini ada di Kubernetes API server.

```bash
kubectl get deployment payment-api -n payment-prod -o yaml
```

Live state bisa berbeda dari desired state karena:

1. Manual `kubectl edit`.
2. HPA mengubah `replicas`.
3. Admission controller menambahkan field.
4. Mutating webhook menambah sidecar.
5. Controller menulis status.
6. Operator mengubah object.
7. Defaulting Kubernetes menambahkan nilai default.

### 6.3 Target Revision

Target revision adalah referensi Git/Helm/OCI yang ingin disinkronkan.

Contoh:

```text
branch: main
commit: 8f3a...
tag: prod-2026-06-20
semver range: 1.7.x
```

Untuk production, commit SHA atau tag immutable lebih defensible daripada branch mutable.

### 6.4 Sync

Sync adalah tindakan membawa live state menuju desired state.

```text
desired != live
  -> sync
  -> apply changes
  -> live should converge
```

Sync bisa:

1. Manual.
2. Automated.
3. Partial.
4. Ordered.
5. Pruning-enabled.
6. Dry-runed.

### 6.5 Drift

Drift adalah perbedaan antara desired state dan live state.

Tidak semua perbedaan adalah problem.

Contoh perbedaan normal:

```text
status fields
resourceVersion
managedFields
defaulted fields
fields owned by HPA
fields injected by admission webhook
```

Contoh drift bermasalah:

```text
image changed manually
resource limit removed
securityContext disabled
replicas changed outside policy
NetworkPolicy deleted
Secret reference changed
```

### 6.6 OutOfSync

Status `OutOfSync` berarti live state tidak sama dengan desired state menurut GitOps controller.

OutOfSync bukan selalu outage.

Bisa berarti:

1. Ada perubahan Git belum diterapkan.
2. Ada manual change di cluster.
3. Ada generated field yang tidak di-ignore.
4. Ada controller lain yang mengubah field sama.
5. Ada object hilang.
6. Ada object extra.

### 6.7 Health

Health berbeda dari sync.

```text
Sync answers: Does live state match desired state?
Health answers: Is the live object operationally healthy?
```

Deployment bisa:

```text
Synced + Healthy
Synced + Degraded
OutOfSync + Healthy
OutOfSync + Degraded
```

Contoh:

```text
Synced + Degraded:
Manifest sudah sama dengan Git, tapi Deployment rollout gagal karena readiness probe gagal.

OutOfSync + Healthy:
Aplikasi berjalan baik, tapi ada commit baru belum disinkronkan.
```

### 6.8 Prune

Prune adalah penghapusan live object yang tidak lagi ada di desired state.

Contoh:

```text
Git menghapus ConfigMap old-config
Cluster masih punya ConfigMap old-config
GitOps prune menghapus ConfigMap old-config
```

Prune sangat berguna untuk mencegah orphan object.

Tapi prune juga berbahaya:

```text
Salah path repository
Salah selector ownership
Shared object tidak sengaja dihapus
Namespace terhapus
CRD terhapus sebelum CR-nya
```

### 6.9 Promotion

Promotion adalah proses menaikkan versi dari environment satu ke environment lain.

Contoh:

```text
dev -> staging -> preprod -> prod
```

Promotion bisa dilakukan dengan:

1. Update image tag/digest di overlay environment.
2. Merge commit antar branch.
3. Promote Git tag.
4. Promote Helm chart version.
5. Promote OCI artifact digest.

### 6.10 Rollback

Rollback dalam GitOps seharusnya berarti:

```text
Revert desired state in Git to previously known-good state.
GitOps reconciles cluster back.
```

Namun rollback tidak selalu aman jika ada perubahan irreversible:

1. Database migration destructive.
2. Message schema incompatible.
3. External API contract changed.
4. Stateful volume format upgraded.
5. Feature flag/data migration already changed behavior.

GitOps membuat rollback manifest mudah, tapi tidak membuat rollback sistem otomatis aman.

---

## 7. GitOps Tools: Argo CD dan Flux sebagai Contoh, Bukan Dogma

Ada banyak tools delivery. Dua tool paling umum untuk GitOps Kubernetes adalah Argo CD dan Flux.

Kita tidak akan menghafal semua command. Kita akan memahami pola arsitektur.

---

## 8. Argo CD Mental Model

Argo CD biasanya dipakai sebagai pull-based GitOps controller dengan UI kuat.

Konsep utama:

```text
Application
  -> points to source repo/path/chart
  -> points to destination cluster/namespace
  -> defines sync policy
  -> reports sync status and health
```

Argo CD berjalan sebagai Kubernetes controller yang membandingkan live state dengan target state dari Git/repository. Jika live state berbeda, aplikasi dianggap `OutOfSync`, dan Argo CD dapat melakukan sync manual atau otomatis.

### 8.1 Argo CD Application Conceptual Example

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payment-api-prod
  namespace: argocd
spec:
  project: payment
  source:
    repoURL: https://git.example.com/platform/payment-gitops.git
    targetRevision: main
    path: apps/payment-api/overlays/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: payment-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

Maknanya:

```text
Ambil manifest dari repo/path tertentu.
Render manifest.
Apply ke cluster/namespace tertentu.
Jika ada drift, sync otomatis.
Jika object sudah tidak ada di Git, prune.
Jika ada manual drift, self-heal.
```

### 8.2 Argo CD AppProject

`AppProject` dipakai untuk boundary.

Ia dapat membatasi:

1. Repo mana yang boleh dipakai.
2. Cluster mana yang boleh ditarget.
3. Namespace mana yang boleh ditarget.
4. Resource kind apa yang boleh dibuat.
5. Role/project permission.

Ini penting untuk platform.

Tanpa boundary, satu `Application` salah bisa deploy object cluster-scoped ke tempat yang tidak seharusnya.

### 8.3 Sync Policy

Sync policy menjawab:

```text
Apakah perubahan Git otomatis diterapkan?
Apakah drift manual otomatis dikembalikan?
Apakah object yang hilang dari Git otomatis dihapus?
```

Kombinasi umum:

```text
Dev:
  automated sync: true
  selfHeal: true
  prune: true

Staging:
  automated sync: true or manual approval
  prune: true with care

Prod:
  automated sync with progressive controls, or manual sync approval
  prune carefully
  protected app/project
```

### 8.4 Sync Waves dan Ordering

Beberapa resource perlu urutan.

Contoh:

```text
Namespace before namespaced resources
CRD before Custom Resource
RBAC before controller
Secret before Deployment
Migration Job before application rollout
```

Argo CD punya konsep sync phases/waves untuk mengontrol urutan.

Namun hati-hati: terlalu banyak ordering bisa menandakan desain terlalu imperative.

Kubernetes idealnya declarative dan controller-driven. Ordering hanya dipakai saat benar-benar perlu.

### 8.5 Health Customization

Tidak semua resource punya health logic yang dimengerti GitOps controller.

Contoh CRD custom:

```text
KafkaTopic
ExternalSecret
Certificate
HelmRelease
Custom operator resource
```

GitOps tool mungkin perlu custom health check agar tahu object benar-benar healthy atau masih progressing.

---

## 9. Flux Mental Model

Flux menggunakan kumpulan controller modular.

Konsep utamanya:

```text
Source Controller
  -> fetch source artifacts: GitRepository, HelmRepository, OCIRepository

Kustomize Controller
  -> reconcile Kustomization resources

Helm Controller
  -> reconcile HelmRelease resources

Notification Controller
  -> events, alerts, receivers

Image Automation Controller
  -> optional image update automation
```

Flux menjaga cluster tetap sinkron dengan sumber konfigurasi seperti Git repository, dan dapat mengotomatisasi update konfigurasi saat ada kode baru untuk dideploy.

### 9.1 Flux GitRepository Example

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: payment-gitops
  namespace: flux-system
spec:
  interval: 1m
  url: ssh://git@git.example.com/platform/payment-gitops.git
  ref:
    branch: main
  secretRef:
    name: payment-git-credentials
```

Maknanya:

```text
Ambil source dari Git setiap interval tertentu.
Buat artifact internal yang bisa dipakai controller lain.
```

### 9.2 Flux Kustomization Example

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: payment-api-prod
  namespace: flux-system
spec:
  interval: 5m
  sourceRef:
    kind: GitRepository
    name: payment-gitops
  path: ./apps/payment-api/overlays/prod
  prune: true
  wait: true
  timeout: 5m
  targetNamespace: payment-prod
```

Maknanya:

```text
Render path tertentu menggunakan Kustomize/plain manifests.
Apply ke cluster.
Prune object yang tidak lagi didefinisikan.
Wait sampai resource healthy/ready sesuai kemampuan controller.
```

### 9.3 Flux HelmRelease Example

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  interval: 5m
  chart:
    spec:
      chart: payment-api
      version: 1.8.3
      sourceRef:
        kind: HelmRepository
        name: internal-charts
        namespace: flux-system
  values:
    replicaCount: 4
    image:
      repository: registry.example.com/payment-api
      digest: sha256:...
```

Maknanya:

```text
Helm chart juga menjadi desired state yang direconcile controller.
```

---

## 10. GitOps Repository Design

Repository design adalah salah satu keputusan paling penting.

Tidak ada satu struktur universal. Yang penting adalah boundary dan ownership jelas.

---

## 11. App Repo vs GitOps Repo

### 11.1 App Repo

App repo berisi:

```text
src/
build.gradle / pom.xml
Dockerfile
unit tests
integration tests
README
maybe base Kubernetes manifests
```

Contoh:

```text
payment-api/
  src/
  pom.xml
  Dockerfile
  charts/payment-api/
  k8s/base/
```

### 11.2 GitOps Repo

GitOps repo berisi desired runtime state:

```text
environments/
clusters/
apps/
platform/
policies/
```

Contoh:

```text
payment-gitops/
  clusters/
    prod-ap-southeast-1/
      apps/
      platform/
    staging-ap-southeast-1/
      apps/
      platform/
  apps/
    payment-api/
      base/
      overlays/
        dev/
        staging/
        prod/
```

### 11.3 Satu Repo atau Banyak Repo?

Pilihan desain:

#### Option A — Monorepo GitOps

```text
company-gitops/
  clusters/
  apps/
  platform/
  policies/
```

Kelebihan:

1. Mudah melihat seluruh desired state.
2. Cross-app dependency lebih terlihat.
3. Promotion linting bisa konsisten.
4. Cocok untuk platform terpusat.

Kelemahan:

1. Repo besar.
2. Permission granular lebih sulit.
3. Banyak tim bisa konflik.
4. Review noise tinggi.

#### Option B — Repo per Team / Domain

```text
payment-gitops/
identity-gitops/
order-gitops/
```

Kelebihan:

1. Ownership jelas.
2. Permission lebih mudah.
3. Tim lebih otonom.

Kelemahan:

1. Cross-cutting policy lebih sulit.
2. Dependency antar repo perlu governance.
3. Cluster bootstrap lebih kompleks.

#### Option C — Repo per Cluster

```text
cluster-prod-a-gitops/
cluster-staging-a-gitops/
```

Kelebihan:

1. Cluster desired state sangat jelas.
2. Disaster recovery cluster lebih mudah dibayangkan.
3. Cocok untuk regulated environment.

Kelemahan:

1. Duplication tinggi.
2. Promotion antar environment bisa sulit.
3. App team perlu berinteraksi dengan banyak repo.

### 11.4 Rekomendasi Praktis

Untuk organisasi Java microservices menengah:

```text
- pisahkan app source repo dan GitOps repo
- gunakan GitOps repo per domain/team atau per platform boundary
- gunakan struktur cluster/environment yang eksplisit
- jangan campur secret plaintext
- gunakan CODEOWNERS
- gunakan policy validation di PR
```

Contoh struktur kuat:

```text
company-gitops/
  README.md
  clusters/
    staging-jakarta-1/
      bootstrap/
      platform/
      apps/
        payment-api.yaml
        order-api.yaml
    prod-jakarta-1/
      bootstrap/
      platform/
      apps/
        payment-api.yaml
        order-api.yaml
  apps/
    payment-api/
      base/
        deployment.yaml
        service.yaml
        hpa.yaml
        kustomization.yaml
      overlays/
        staging/
          kustomization.yaml
          patch-resources.yaml
        prod/
          kustomization.yaml
          patch-resources.yaml
  platform/
    ingress-gateway/
    cert-manager/
    external-secrets/
    observability/
    policy/
  policies/
    kyverno/
    gatekeeper/
```

---

## 12. Environment Promotion Models

Promotion adalah cara perubahan bergerak dari dev ke prod.

---

## 13. Model 1 — Branch per Environment

```text
main       -> dev
staging    -> staging
production -> prod
```

Promotion:

```text
merge main -> staging
merge staging -> production
```

Kelebihan:

1. Simple secara mental.
2. Environment punya branch sendiri.
3. Git history terlihat.

Kelemahan:

1. Merge conflict antar environment.
2. Cherry-pick bisa membingungkan.
3. Config drift antar branch mudah terjadi.
4. Sulit melihat semua environment sekaligus.

### Cocok untuk

```text
Tim kecil, lifecycle sederhana, sedikit environment.
```

---

## 14. Model 2 — Directory per Environment

```text
apps/payment-api/overlays/dev
apps/payment-api/overlays/staging
apps/payment-api/overlays/prod
```

Promotion:

```text
Update image digest di dev overlay
Then update staging overlay
Then update prod overlay
```

Kelebihan:

1. Semua environment terlihat di satu branch.
2. PR bisa membandingkan env diff.
3. Cocok dengan Kustomize overlay.
4. Drift lebih mudah terlihat.

Kelemahan:

1. Perlu tool/process untuk promote digest.
2. Repo bisa ramai.
3. Permission per environment perlu CODEOWNERS/policy.

### Cocok untuk

```text
Mayoritas platform Kubernetes internal.
```

---

## 15. Model 3 — Tag/Release per Environment

```text
Git tag: payment-api-prod-2026-06-20.1
```

Promotion:

```text
Create immutable release tag
GitOps prod tracks tag or commit
```

Kelebihan:

1. Immutable release reference.
2. Audit bagus.
3. Cocok untuk regulated release.

Kelemahan:

1. Operational overhead lebih tinggi.
2. Butuh release tooling.
3. Rollback harus disiplin.

### Cocok untuk

```text
Regulated systems, strict audit, manual approval gates.
```

---

## 16. Model 4 — Image Digest Promotion

Daripada promote tag mutable:

```text
payment-api:1.8.3
```

Promote digest immutable:

```text
payment-api@sha256:abc123...
```

Kelebihan:

1. Artefak pasti sama antar environment.
2. Menghindari mutable tag surprise.
3. Supply chain lebih kuat.
4. Cocok dengan image signing.

Kelemahan:

1. Manifest kurang readable.
2. Butuh tooling untuk update digest.
3. Perlu mapping digest ke release notes.

Untuk production, digest lebih defensible.

---

## 17. Deployment Flow untuk Java Service

Contoh flow matang:

```text
1. Developer merge code to main.
2. CI runs tests.
3. CI builds image.
4. CI scans image.
5. CI signs image.
6. CI publishes image with immutable digest.
7. CI updates dev GitOps overlay digest.
8. GitOps syncs dev.
9. Smoke test validates dev.
10. Promotion PR updates staging digest.
11. GitOps syncs staging.
12. Integration test validates staging.
13. Promotion PR updates prod digest.
14. CODEOWNER approval required.
15. GitOps syncs prod.
16. Rollout metrics and SLO monitored.
17. If bad, revert GitOps PR or promote rollback digest.
```

Key principle:

```text
Build once, promote the same artifact.
```

Anti-pattern:

```text
Build different image for dev, staging, and prod from same source.
```

Kenapa buruk?

Karena kamu tidak pernah benar-benar mempromosikan artefak yang sama.

---

## 18. Image Update Automation

Beberapa GitOps setup dapat otomatis mengubah image reference ketika image baru tersedia.

Contoh:

```text
Registry sees payment-api:1.8.4
Automation updates GitOps manifest
GitOps syncs cluster
```

Ini berguna untuk dev/staging.

Untuk prod, hati-hati.

Pertanyaan yang harus dijawab:

1. Apakah image sudah lulus test?
2. Apakah image sudah discan?
3. Apakah image sudah ditandatangani?
4. Apakah ada approval?
5. Apakah release note jelas?
6. Apakah migration compatible?
7. Apakah rollback path tersedia?

Rekomendasi:

```text
Dev: boleh auto-update.
Staging: auto-update dengan test gate.
Prod: promotion via PR/approval, kecuali platform sangat matang.
```

---

## 19. GitOps dan Helm

Helm dalam GitOps bisa dipakai dengan dua pola:

### 19.1 Render Helm di CI, Commit Rendered YAML

```text
Helm chart + values
  -> CI helm template
  -> rendered YAML committed
  -> GitOps applies YAML
```

Kelebihan:

1. Desired state eksplisit.
2. Review lebih jelas.
3. GitOps controller tidak perlu Helm logic.

Kelemahan:

1. Rendered YAML besar.
2. Chart upgrade diff noisy.
3. Source of truth tersebar antara chart dan rendered output.

### 19.2 GitOps Controller Mengelola Helm Release

```text
Git has HelmRelease/Application chart reference + values
GitOps controller renders/applies Helm
```

Kelebihan:

1. Lebih ringkas.
2. Chart lifecycle dikelola controller.
3. Cocok untuk platform add-ons.

Kelemahan:

1. Render failure terjadi di controller.
2. Review manifest final kurang eksplisit.
3. Helm hook behavior perlu dipahami.
4. Values sprawl bisa tersembunyi.

### 19.3 Rekomendasi

Untuk app internal Java:

```text
Kustomize base/overlay atau simple Helm chart keduanya valid.
```

Untuk platform add-ons:

```text
HelmRelease/Application from upstream chart sering masuk akal.
```

Yang penting:

```text
- chart version pinned
- values reviewed
- CRD lifecycle dipahami
- upgrade path diuji
- rollback tidak diasumsikan aman
```

---

## 20. GitOps dan Kustomize

Kustomize cocok ketika kamu ingin:

1. Plain Kubernetes YAML.
2. Base/overlay jelas.
3. Patch environment-specific.
4. Tidak ingin template language.
5. Diff yang dekat dengan object Kubernetes.

Contoh:

```text
apps/payment-api/base
  deployment.yaml
  service.yaml
  hpa.yaml
  kustomization.yaml

apps/payment-api/overlays/prod
  kustomization.yaml
  patch-image.yaml
  patch-resources.yaml
  patch-replicas.yaml
```

Overlay prod:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namespace: payment-prod
images:
  - name: registry.example.com/payment-api
    digest: sha256:abc123...
patches:
  - path: patch-resources.yaml
  - path: patch-replicas.yaml
```

Kustomize anti-pattern:

```text
- overlay terlalu dalam
- patch terlalu banyak sampai intent hilang
- base terlalu generic
- environment logic tersebar
- configMapGenerator tanpa rollout strategy yang jelas
```

---

## 21. Sync Ordering dan Dependency Management

Kubernetes idealnya tidak butuh strict ordering karena controller akan reconcile sampai converge.

Namun beberapa hal memang punya dependency:

```text
CRD before CR
Namespace before namespaced resource
RBAC before controller that needs permission
Secret before Pod using it
StorageClass before PVC
GatewayClass before Gateway
Certificate issuer before Certificate
```

GitOps tools menyediakan ordering mechanism.

Tapi jangan mengubah GitOps menjadi workflow engine imperatif.

Pertanyaan desain:

```text
Apakah dependency ini benar-benar butuh ordering?
Atau object bisa dibuat declaratively dan menunggu dependency converge?
```

Contoh:

```text
Deployment referencing a Secret that does not exist yet
```

Kubernetes akan membuat Pod gagal start sampai Secret ada. Ini bisa acceptable pada bootstrap tertentu, tapi buruk untuk production rollout app.

Untuk production:

```text
Secret dependency harus sudah tersedia sebelum Deployment sync.
```

---

## 22. Prune Strategy

Prune menghapus object yang tidak lagi ada di Git.

### 22.1 Kenapa Prune Penting

Tanpa prune:

```text
- object lama tetap hidup
- Service lama masih expose endpoint
- ConfigMap lama masih dipakai
- NetworkPolicy lama masih memblokir traffic
- CronJob lama masih berjalan
- RBAC lama masih memberi permission
```

### 22.2 Kenapa Prune Berbahaya

Dengan prune yang salah:

```text
- shared Secret dihapus
- Namespace terhapus
- CRD terhapus
- PVC terhapus
- ServiceAccount hilang
- policy object hilang
```

### 22.3 Prune Guardrail

Praktik yang lebih aman:

```text
- pisahkan ownership object per Application/Kustomization
- jangan satu app mengelola object shared platform
- gunakan namespace boundary yang jelas
- proteksi resource cluster-scoped
- gunakan manual approval untuk prune besar
- preview diff sebelum sync/prune production
- jangan prune PVC sembarangan
- dokumentasikan object lifecycle
```

### 22.4 PVC dan Data Object

PVC perlu perhatian khusus.

Jika Deployment dihapus, PVC bisa tetap ada atau ikut hilang tergantung owner/policy/tooling.

Untuk stateful/data-bearing resource:

```text
Prune should be explicit, reviewed, and backed by backup/restore plan.
```

---

## 23. Drift Management

Drift terjadi ketika live state berbeda dari Git.

Ada drift yang disengaja:

```text
HPA changes replicas
admission injects sidecar
cert-manager updates Secret
operator updates status/spec-owned fields
```

Ada drift yang tidak disengaja:

```text
manual kubectl edit image
manual remove resource limit
manual patch securityContext
manual delete NetworkPolicy
```

### 23.1 Self-Heal

Self-heal berarti GitOps controller mengembalikan live state ke Git.

Contoh:

```text
Someone changes replicas from 4 to 10 manually.
Git says replicas = 4.
GitOps controller changes it back to 4.
```

Ini bagus untuk governance.

Tapi saat incident bisa mengejutkan.

### 23.2 Incident Hotfix Problem

Misalnya saat incident:

```bash
kubectl scale deployment payment-api --replicas=20 -n payment-prod
```

Jika GitOps self-heal aktif dan Git masih `replicas: 4`, maka controller bisa mengembalikannya ke 4.

Solusi yang lebih baik:

```text
- emergency change tetap dilakukan melalui GitOps repo jika memungkinkan
- break-glass manual patch harus disertai pause/suspend sync atau immediate Git follow-up
- runbook harus jelas
```

### 23.3 Ignore Differences

Beberapa field memang sebaiknya di-ignore oleh diff engine.

Contoh:

```text
/status
/metadata/resourceVersion
/metadata/managedFields
/spec/replicas jika HPA mengontrol replicas
fields injected by sidecar webhook
```

Namun ignore terlalu luas berbahaya.

Anti-pattern:

```text
Ignore entire spec because diff noisy.
```

Itu menghilangkan makna drift detection.

---

## 24. GitOps dan HPA Interaction

HPA mengubah `spec.replicas` pada target workload.

Jika GitOps juga terus menegakkan `spec.replicas`, bisa terjadi konflik.

Praktik umum:

```text
- manifest Deployment boleh punya initial replicas
- HPA mengontrol replicas setelah berjalan
- GitOps diff bisa ignore replicas untuk workload dengan HPA
```

Tetapi tetap perlu hati-hati.

Kalau replicas di-ignore sepenuhnya, perubahan manual ke replicas juga tidak terdeteksi.

Alternatif:

```text
- gunakan policy bahwa replicas manual tidak dianggap critical karena HPA owner
- monitor HPA desired/current replicas
- audit manual scaling via Kubernetes audit log
```

---

## 25. GitOps dan Secrets

Jangan commit secret plaintext.

Pilihan umum:

1. External Secrets Operator.
2. Sealed Secrets.
3. SOPS-encrypted manifests.
4. Cloud secret manager + workload identity.
5. Vault integration.

### 25.1 External Secret Pattern

Git menyimpan reference:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: payment-api-secret
  namespace: payment-prod
spec:
  secretStoreRef:
    name: prod-secret-store
    kind: ClusterSecretStore
  target:
    name: payment-api-secret
  data:
    - secretKey: db-password
      remoteRef:
        key: prod/payment-api/db-password
```

GitOps mengelola `ExternalSecret`, bukan nilai rahasianya.

External secret controller mengambil secret dari secret manager dan membuat Kubernetes `Secret`.

### 25.2 Secret Rotation

GitOps bukan pengganti secret rotation.

Pertanyaan penting:

1. Apakah app membaca secret dari env var atau mounted file?
2. Apakah app bisa reload secret tanpa restart?
3. Apakah secret update memicu rollout?
4. Apakah old credential masih valid selama overlap?
5. Apakah GitOps diff akan mendeteksi perubahan Secret generated oleh controller?

### 25.3 Secret Ownership

Jangan campur ownership:

```text
GitOps manages ExternalSecret.
ExternalSecrets controller manages Secret.
Application consumes Secret.
```

Kalau GitOps juga manage generated Secret yang sama, controller bisa fight.

---

## 26. GitOps dan Database Migration

Ini salah satu area paling rawan.

GitOps bisa deploy app manifest, tapi database migration punya lifecycle sendiri.

Strategi umum:

### 26.1 Migration sebagai Job

```text
GitOps syncs migration Job
Job runs migration
Deployment rollout follows
```

Risiko:

1. Job retry bisa menjalankan migration berulang.
2. Migration harus idempotent atau memiliki locking.
3. Ordering harus jelas.
4. Rollback app belum tentu rollback schema.
5. Job success tidak berarti semantic compatibility.

### 26.2 Migration di App Startup

```text
Every app replica runs migration at startup
```

Biasanya buruk untuk production jika tidak dikontrol.

Risiko:

1. Race antar replica.
2. Startup lambat.
3. Readiness gagal.
4. Rollout stuck.
5. Rollback kacau.

### 26.3 Expand-Contract Pattern

Untuk production Java services:

```text
Release N:
  expand schema backward-compatible

Release N+1:
  app writes/reads new schema safely

Release N+2:
  contract old schema after no longer used
```

GitOps hanya salah satu delivery mechanism. Schema compatibility tetap harus didesain.

---

## 27. GitOps dan Policy

GitOps harus bekerja bersama admission policy.

Pipeline ideal:

```text
PR validation:
  - schema validation
  - kubeconform/kubeval equivalent
  - policy check
  - security check
  - image digest check
  - resource request check

Cluster admission:
  - enforce same or stronger policies
```

Kenapa policy perlu ada di dua tempat?

```text
PR validation gives fast feedback.
Admission enforcement gives runtime protection.
```

Jika hanya PR validation:

```text
manual apply bisa bypass
controller bug bisa apply invalid resource
another repo can bypass policy
```

Jika hanya admission:

```text
feedback terlambat
GitOps sync gagal di cluster
developer bingung setelah merge
```

### 27.1 Policy Examples

```text
- require image digest, not mutable latest tag
- require resource requests/limits
- disallow privileged container
- require runAsNonRoot
- require probes for public API
- restrict hostPath
- restrict LoadBalancer Service
- require owner/team labels
- require namespace allowlist
```

---

## 28. GitOps dan Multi-Cluster

GitOps sangat cocok untuk multi-cluster karena setiap cluster bisa pull desired state-nya sendiri.

Model:

```text
clusters/
  staging-ap-southeast-1/
  prod-ap-southeast-1/
  prod-ap-southeast-2/
```

Setiap cluster menjalankan controller:

```text
Cluster A pulls path clusters/prod-a
Cluster B pulls path clusters/prod-b
```

Keuntungan:

1. CI tidak perlu credential semua cluster.
2. Cluster bisa bootstrap dirinya sendiri.
3. Desired state per cluster eksplisit.
4. DR lebih mudah dirancang.

Risiko:

1. Config drift antar cluster.
2. Secret manager dependency regional.
3. Add-on version mismatch.
4. Promotion across cluster perlu tooling.
5. Global traffic failover di luar GitOps.

---

## 29. Bootstrap Problem

Pertanyaan klasik:

```text
Jika GitOps controller mengelola cluster, siapa yang menginstall GitOps controller pertama kali?
```

Ini disebut bootstrap problem.

Pilihan:

1. Manual bootstrap awal.
2. Terraform installs GitOps controller.
3. Cluster API/bootstrap script.
4. Managed platform add-on.
5. Golden cluster image.

Setelah controller hidup, ia bisa mengelola:

```text
- dirinya sendiri
- platform add-ons
- apps
- policies
- namespaces
```

Namun self-management perlu hati-hati.

Jika GitOps controller salah menghapus dirinya sendiri, cluster kehilangan delivery control plane.

Guardrail:

```text
- separate bootstrap layer
- protect GitOps namespace
- backup controller config
- avoid auto-prune dangerous bootstrap resources
- test disaster recovery
```

---

## 30. App-of-Apps dan Root Kustomization Pattern

### 30.1 App-of-Apps

Di Argo CD, pola app-of-apps berarti satu root `Application` mengelola banyak `Application` lain.

```text
root-app
  -> payment-api-app
  -> order-api-app
  -> identity-api-app
  -> platform-app
```

Kelebihan:

1. Bootstrap banyak app lebih mudah.
2. Cluster desired state bisa direpresentasikan sebagai tree.
3. Environment onboarding lebih terstruktur.

Kelemahan:

1. Dependency graph bisa rumit.
2. Root app salah bisa berdampak besar.
3. Prune root harus hati-hati.

### 30.2 Root Kustomization

Di Flux, pola serupa bisa berupa root `Kustomization` yang menunjuk path cluster.

```text
clusters/prod-jakarta-1/kustomization.yaml
  -> platform
  -> namespaces
  -> apps
  -> policies
```

Kelebihan dan risikonya mirip.

---

## 31. Delivery Control Plane sebagai Sistem Kritis

GitOps controller adalah bagian dari production control plane.

Jika GitOps controller down:

```text
Existing apps tetap jalan.
New deployments tidak reconcile.
Drift tidak diperbaiki.
Prune tidak berjalan.
Status delivery tidak update.
```

Jika GitOps controller salah konfigurasi:

```text
Ia bisa menghapus/mengubah banyak resource.
```

Jadi GitOps sendiri perlu:

1. RBAC least privilege.
2. Namespace isolation.
3. Backup config.
4. Observability.
5. Alerting.
6. Upgrade process.
7. Disaster recovery.
8. Break-glass procedure.
9. Audit.
10. Policy boundaries.

---

## 32. RBAC untuk GitOps Controller

Jangan langsung beri cluster-admin tanpa berpikir.

Namun GitOps controller sering butuh permission luas.

Desain yang lebih defensible:

```text
- app-level GitOps controller hanya boleh manage namespace app tertentu
- platform-level GitOps controller boleh manage cluster-scoped resources tertentu
- separate project/instance untuk prod vs non-prod
- restrict source repositories
- restrict destination namespaces
- restrict resource kinds
```

Contoh boundary:

```text
payment team GitOps:
  can manage Deployments, Services, ConfigMaps, HPAs in payment-* namespaces
  cannot manage ClusterRole, CRD, Node, StorageClass

platform GitOps:
  can manage GatewayClass, CRD, policy, observability, cert-manager
  controlled by platform team CODEOWNERS
```

---

## 33. GitOps for Java Microservices: Reference Design

Misal kita punya Java service `payment-api`.

### 33.1 App Runtime Objects

```text
Namespace: payment-prod
Deployment: payment-api
Service: payment-api
HPA: payment-api
ConfigMap: payment-api-config
ExternalSecret: payment-api-secret
ServiceAccount: payment-api
Role/RoleBinding: if needed
NetworkPolicy: payment-api
PodDisruptionBudget: payment-api
HTTPRoute: payment-api
```

### 33.2 GitOps Desired State

```text
apps/payment-api/base/
  deployment.yaml
  service.yaml
  hpa.yaml
  pdb.yaml
  serviceaccount.yaml
  networkpolicy.yaml
  kustomization.yaml

apps/payment-api/overlays/prod/
  kustomization.yaml
  patch-image-digest.yaml
  patch-resources.yaml
  patch-hpa.yaml
  patch-config.yaml
```

### 33.3 Promotion PR

A production promotion PR should show:

```text
- image digest changed
- release notes linked
- migration plan if any
- rollback plan
- observability dashboard link
- approval from code owner
- approval from service owner if critical
```

### 33.4 Runtime Checklist

Before prod sync:

```text
- image digest immutable
- image scanned
- image signed if policy requires
- resources set
- probes set
- HPA sane
- PDB sane
- DB migration compatible
- config diff reviewed
- secret reference exists
- route/gateway diff reviewed
- rollback digest known
```

---

## 34. GitOps for Platform Add-ons

Platform add-ons include:

```text
- ingress/gateway controller
- cert-manager
- external-secrets
- observability stack
- policy engine
- CSI driver
- CNI config
- metrics-server
- autoscaler
```

These have higher blast radius than app workloads.

Recommendations:

```text
- separate platform GitOps area
- separate approval policy
- pin chart versions
- read release notes
- upgrade staging first
- test CRD upgrade path
- avoid blind auto-sync for critical add-ons
- monitor controller health
- backup CRDs/custom resources where needed
```

CRDs are especially sensitive.

If you upgrade a CRD incorrectly, all custom resources and controllers depending on it can break.

---

## 35. GitOps and Observability

GitOps needs observability at multiple levels:

### 35.1 Controller Health

Metrics:

```text
- reconciliation duration
- reconciliation errors
- source fetch errors
- render errors
- apply errors
- queue depth
- API server throttling
```

### 35.2 Application Sync State

Track:

```text
- Synced/OutOfSync
- Healthy/Progressing/Degraded
- last sync time
- target revision
- live revision
- sync error
- prune action
```

### 35.3 Deployment Outcome

Track:

```text
- rollout duration
- unavailable replicas
- readiness failures
- restart count
- p95/p99 latency
- error rate
- JVM GC metrics
- CPU throttling
- memory usage
```

### 35.4 Alerting

Useful alerts:

```text
- production app Degraded for > N minutes
- GitOps controller cannot fetch repo
- sync failed repeatedly
- app OutOfSync unexpectedly
- prune operation failed
- image automation failed
- source artifact stale
```

Avoid noisy alerts:

```text
- transient OutOfSync during expected rollout
- every reconciliation warning without impact
- dev app degraded outside work hours unless critical
```

---

## 36. GitOps Failure-Mode Catalogue

### 36.1 Desired State Salah

Symptom:

```text
GitOps sync successful, app fails.
```

Cause:

```text
Manifest valid but semantically wrong.
```

Examples:

```text
wrong DB URL
wrong image digest
wrong feature flag
wrong resource limit
wrong network policy
wrong route host
```

Remediation:

```text
Revert Git commit or apply corrected commit.
```

Prevention:

```text
PR validation, staging promotion, smoke tests, config diff review.
```

---

### 36.2 Render Failure

Symptom:

```text
GitOps app cannot generate manifests.
```

Cause:

```text
Helm values invalid
Kustomize patch target missing
missing file
bad YAML
unsupported API version
```

Remediation:

```text
Run render locally or in CI.
Fix template/patch.
```

Prevention:

```text
CI must run helm template/kustomize build before merge.
```

---

### 36.3 Admission Denied

Symptom:

```text
Sync failed: admission webhook denied request.
```

Cause:

```text
Policy blocks privileged pod, missing requests, unsigned image, disallowed registry.
```

Remediation:

```text
Fix manifest or request explicit exception.
```

Prevention:

```text
Run same policy checks in PR.
```

---

### 36.4 RBAC Denied

Symptom:

```text
GitOps controller cannot create/update resource.
```

Cause:

```text
Controller lacks permission for namespace/kind/subresource.
```

Remediation:

```text
Adjust RBAC according to least privilege.
```

Prevention:

```text
Define resource ownership and permissions per project/team.
```

---

### 36.5 Prune Deletes Shared Resource

Symptom:

```text
Another app/platform component breaks after sync.
```

Cause:

```text
Shared object accidentally owned by app GitOps resource.
```

Remediation:

```text
Restore object from Git/backup.
Separate ownership.
Disable dangerous prune until fixed.
```

Prevention:

```text
Do not mix app-owned and shared resources in same GitOps application.
```

---

### 36.6 Controller Fight

Symptom:

```text
Field flips back and forth.
```

Cause:

```text
GitOps, HPA, operator, mutating webhook, or human owns same field.
```

Examples:

```text
replicas field with HPA
Secret generated by ExternalSecrets but also committed in Git
sidecar injection fields managed by webhook
operator-managed custom resource fields
```

Remediation:

```text
Clarify field ownership.
Ignore appropriate generated fields.
Stop managing generated object directly.
```

Prevention:

```text
Document ownership per object and field category.
```

---

### 36.7 Manual Hotfix Reverted

Symptom:

```text
Emergency kubectl patch disappears.
```

Cause:

```text
GitOps self-heal restores Git desired state.
```

Remediation:

```text
Patch GitOps repo or pause/suspend sync according to runbook.
```

Prevention:

```text
Break-glass procedure with follow-up Git reconciliation.
```

---

### 36.8 Rollback Incomplete

Symptom:

```text
Reverted Git commit but app still broken.
```

Cause:

```text
External state changed: DB schema, messages, cache, third-party state, volume data.
```

Remediation:

```text
Run system-level recovery plan, not just manifest rollback.
```

Prevention:

```text
Backward-compatible migration and release design.
```

---

### 36.9 Repo Unavailable

Symptom:

```text
GitOps controller cannot fetch desired state.
```

Existing apps likely continue running, but delivery freezes.

Cause:

```text
Git outage
network issue
credential expired
SSH key rotated
rate limit
```

Remediation:

```text
Restore Git access/credentials.
Use cached state if tool supports it.
```

Prevention:

```text
Monitor source fetch, rotate credentials safely, document emergency deploy path.
```

---

### 36.10 GitOps Controller Down

Symptom:

```text
No reconciliation, stale app status.
```

Cause:

```text
controller crash, resource pressure, bad upgrade, RBAC issue, dependency down.
```

Remediation:

```text
Restore controller deployment and dependencies.
```

Prevention:

```text
Treat GitOps as production control plane with SLO and runbook.
```

---

## 37. GitOps Runbook: Production Sync Failure

When production sync fails:

### Step 1 — Identify Scope

Ask:

```text
Is one app affected or many?
Is one namespace affected or whole cluster?
Is this sync failure, health failure, or both?
```

### Step 2 — Inspect GitOps Status

Check:

```text
- target revision
- last successful sync
- last attempted sync
- sync error
- health status
- diff
```

### Step 3 — Classify Layer

```text
Source fetch failure?
Render failure?
Apply failure?
Admission failure?
RBAC failure?
Kubernetes rollout failure?
Runtime app failure?
```

### Step 4 — Inspect Kubernetes Objects

```bash
kubectl get deploy,rs,pod,svc,endpointslice,hpa,pdb -n payment-prod
kubectl describe deployment payment-api -n payment-prod
kubectl get events -n payment-prod --sort-by=.lastTimestamp
```

### Step 5 — Inspect Application Runtime

```bash
kubectl logs deploy/payment-api -n payment-prod --since=30m
kubectl top pod -n payment-prod
```

### Step 6 — Decide Recovery

Options:

```text
- fix-forward Git commit
- revert Git commit
- pause/suspend sync temporarily
- manual break-glass patch then immediately backport to Git
- rollback image digest
- disable prune temporarily
```

### Step 7 — Preserve Audit

Record:

```text
- bad commit/revision
- symptom
- action taken
- final desired state
- follow-up prevention
```

---

## 38. GitOps Design Checklist

Use this checklist before adopting GitOps in production.

### 38.1 Source of Truth

```text
[ ] Desired state lives in Git/repository.
[ ] App source and runtime desired state boundaries are clear.
[ ] Production tracks immutable revision/digest where appropriate.
[ ] Manual cluster changes are considered drift unless documented.
```

### 38.2 Repository

```text
[ ] Repo structure matches ownership model.
[ ] CODEOWNERS configured.
[ ] Environment promotion path is explicit.
[ ] Secrets are not stored plaintext.
[ ] Rendered output or render process is validated in CI.
```

### 38.3 Controller

```text
[ ] GitOps controller has least practical privilege.
[ ] Controller namespace protected.
[ ] Controller metrics and logs monitored.
[ ] Controller upgrade process exists.
[ ] Disaster recovery process exists.
```

### 38.4 Sync Policy

```text
[ ] Auto-sync decision is environment-specific.
[ ] Prune is enabled only where ownership is clear.
[ ] Self-heal behavior is understood.
[ ] Ignore differences are narrow and documented.
[ ] Sync ordering is minimal and justified.
```

### 38.5 Security

```text
[ ] Git credential rotation process exists.
[ ] Cluster credential not stored in CI unnecessarily.
[ ] Image references are immutable in prod.
[ ] Admission policies enforce baseline requirements.
[ ] Secret management is external/encrypted.
```

### 38.6 Operations

```text
[ ] Runbook for sync failure exists.
[ ] Runbook for bad deploy exists.
[ ] Break-glass process exists.
[ ] Observability links are attached to promotion PR.
[ ] Rollback compatibility is analyzed.
```

---

## 39. Anti-Patterns

### 39.1 GitOps as Blind Auto-Deploy

```text
Every merge to main instantly deploys prod with no validation.
```

This is not maturity. This is acceleration without control.

### 39.2 CI and GitOps Both Apply Same Object

```text
CI runs kubectl apply.
GitOps also reconciles same manifests.
```

This creates unclear ownership.

### 39.3 Manual Hotfix Without Git Follow-Up

```text
kubectl edit in prod, forget to commit.
```

GitOps will revert it or the next sync will overwrite it.

### 39.4 Overusing Ignore Differences

```text
Ignore most of spec because tool is noisy.
```

Then GitOps no longer detects meaningful drift.

### 39.5 Auto-Prune Without Ownership Boundary

```text
One Application owns too many shared resources.
```

Can delete platform/shared dependencies.

### 39.6 Mutable Image Tags in Production

```text
image: payment-api:latest
```

This destroys auditability and reproducibility.

### 39.7 Treating GitOps as Rollback Magic

```text
Revert commit = system recovered.
```

False if external state changed.

### 39.8 Putting Secrets Plaintext in Git

```text
db-password: supersecret
```

Git history is not a secret manager.

### 39.9 One Giant Root App with Full Cluster Admin

```text
One misconfigured sync affects everything.
```

Blast radius too high.

### 39.10 No PR Validation

```text
Broken YAML merged, controller fails in production.
```

Render and policy validation should happen before merge.

---

## 40. Practical Exercise 1 — Convert Push Deploy to GitOps

Given current flow:

```text
CI builds image
CI runs kubectl set image deployment/payment-api
```

Redesign it:

```text
1. CI builds image.
2. CI pushes image digest.
3. CI opens PR to GitOps repo updating digest.
4. PR validation renders manifest.
5. PR policy checks pass.
6. Merge triggers GitOps reconciliation.
7. GitOps syncs cluster.
8. Rollout observed.
```

Questions:

1. Where is cluster credential stored now?
2. Who approves prod promotion?
3. What happens if sync fails?
4. How do you rollback?
5. How do you prevent mutable image deployment?

---

## 41. Practical Exercise 2 — Identify Field Ownership

For this app:

```text
Deployment payment-api
HPA payment-api
ExternalSecret payment-api-secret
Mutating webhook injects sidecar
GitOps controller self-heal enabled
```

Decide owner for each field/object:

| Field/Object | Owner |
|---|---|
| Deployment image | GitOps |
| Deployment replicas | HPA after startup |
| Deployment resource requests | GitOps |
| Pod sidecar injected fields | Admission webhook |
| Secret generated from ExternalSecret | ExternalSecrets controller |
| ExternalSecret spec | GitOps |
| Deployment status | Kubernetes Deployment controller |
| Pod status | kubelet / API status pipeline |

Now define which fields GitOps should ignore.

---

## 42. Practical Exercise 3 — Promotion Design

Design promotion for `order-api`:

```text
Environment: dev, staging, prod
Artifact: image digest
Manifest composition: Kustomize
Approval: prod requires team lead + SRE
Migration: optional Flyway migration Job
```

Produce:

1. Repo layout.
2. Promotion PR format.
3. Rollback procedure.
4. Migration compatibility rule.
5. GitOps sync policy for each environment.

---

## 43. Practical Exercise 4 — Failure Investigation

Scenario:

```text
Argo CD shows payment-api Synced but Degraded.
Git commit was merged 15 minutes ago.
Deployment rollout is stuck.
Pods are running but readiness is false.
Logs show DB migration error.
```

Questions:

1. Is this GitOps sync failure or app/runtime failure?
2. Should you rollback Git commit?
3. What if migration already partially applied?
4. What evidence do you collect?
5. What prevention should be added?

Expected reasoning:

```text
Synced means desired state applied.
Degraded means live runtime did not become healthy.
Root cause likely app/migration compatibility, not GitOps itself.
Rollback only safe if migration compatibility is understood.
```

---

## 44. Production Blueprint: GitOps for Java Platform

A mature Java platform could look like:

```text
CI:
  - build Java artifact
  - run tests
  - build image
  - scan image
  - sign image
  - push image digest
  - update GitOps PR

GitOps Repo:
  - app overlays
  - environment configs
  - platform add-ons
  - policy definitions
  - CODEOWNERS

GitOps Controller:
  - reconciles desired state
  - reports sync/health/drift
  - prunes only owned resources
  - self-heals drift according to policy

Kubernetes:
  - admission enforces guardrails
  - controllers rollout workloads
  - probes determine readiness
  - HPA scales workload

Observability:
  - deployment dashboard
  - app SLO
  - JVM metrics
  - GitOps sync metrics
  - alerting

Operations:
  - incident runbooks
  - break-glass process
  - rollback playbooks
  - audit trail
```

---

## 45. Key Design Invariants

Keep these invariants in mind:

### Invariant 1 — Git Is Desired State, Not Runtime Truth

Git says what should be true.
Kubernetes live state says what is currently true.
Application metrics say whether the system is useful and healthy.

Do not confuse them.

### Invariant 2 — Synced Does Not Mean Healthy

A synced broken manifest is still broken.

### Invariant 3 — GitOps Reconciles Kubernetes Objects, Not Business Correctness

It cannot guarantee:

```text
- API compatibility
- DB migration safety
- message schema compatibility
- downstream capacity
- user journey correctness
```

### Invariant 4 — Prune Requires Ownership Clarity

Never prune what you do not clearly own.

### Invariant 5 — Rollback Requires State Compatibility

Manifest rollback is easy.
System rollback is hard.

### Invariant 6 — Automation Needs Guardrails

The more automated your delivery, the more explicit your policy, validation, and observability must be.

---

## 46. Summary

GitOps applies the Kubernetes reconciliation mindset to delivery itself.

Instead of treating deployment as a one-time command, GitOps treats deployment as continuous convergence:

```text
repository desired state -> live cluster state
```

The main value is not “YAML in Git”.

The real value is:

```text
- clear source of truth
- auditability
- drift detection
- pull-based reconciliation
- separation of CI and production cluster credentials
- multi-cluster manageability
- reproducible promotion
- platform governance
```

But GitOps also introduces risk:

```text
- bad Git state becomes bad runtime state
- prune can delete resources
- controller fight can happen
- manual hotfix can be reverted
- rollback can be semantically unsafe
- delivery controller becomes critical infrastructure
```

For Java engineers, GitOps must be connected to runtime realities:

```text
- JVM warmup
- readiness
- HPA behavior
- connection pools
- database migrations
- message consumers
- secret rotation
- SLO monitoring
```

The mental model to carry forward:

```text
GitOps does not replace engineering judgment.
It makes desired state explicit and continuously reconciled.
That makes good systems more reliable and bad desired states more consistently dangerous.
```

---

## 47. References

- Kubernetes Documentation — Declarative Management of Kubernetes Objects  
  https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/

- Kubernetes Documentation — Server-Side Apply  
  https://kubernetes.io/docs/reference/using-api/server-side-apply/

- Argo CD Documentation — Declarative GitOps CD for Kubernetes  
  https://argo-cd.readthedocs.io/en/stable/

- Argo CD Documentation — Declarative Setup  
  https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/

- Argo CD Documentation — Sync Options  
  https://argo-cd.readthedocs.io/en/latest/user-guide/sync-options/

- Argo CD Documentation — Sync Phases and Waves  
  https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/

- Flux Documentation  
  https://fluxcd.io/flux/

- Flux Documentation — Kustomization API  
  https://fluxcd.io/flux/components/kustomize/kustomizations/

- Flux Documentation — FAQ  
  https://fluxcd.io/flux/faq/

---

## 48. Status Seri

```text
Seri belum selesai.
Part saat ini: 024 dari 035.
Part berikutnya: 025 — Admission Control, Policy, and Governance.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Kubernetes Manifests: YAML, Kustomize, Helm, and Configuration Composition</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-025.md">Part 025 — Admission Control, Policy, and Governance ➡️</a>
</div>
