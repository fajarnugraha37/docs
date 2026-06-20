# learn-kubernetes-mastery-for-java-engineers-part-025.md

# Part 025 — Admission Control, Policy, and Governance

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Untuk: Java software engineer yang ingin menguasai Kubernetes pada level production, platform, reliability, dan governance  
> Fokus part ini: bagaimana Kubernetes menolak, mengubah, atau mengizinkan perubahan object sebelum disimpan; bagaimana policy dipakai sebagai guardrail; dan bagaimana governance bisa kuat tanpa membuat delivery lumpuh.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas GitOps sebagai delivery control plane. Git bisa menjadi sumber desired state, tetapi Git saja tidak cukup. Ada beberapa masalah nyata:

1. Manifest bisa salah sejak awal.
2. Developer bisa melakukan `kubectl apply` langsung ke cluster.
3. CI/CD bisa memakai token terlalu kuat.
4. Chart pihak ketiga bisa membawa manifest yang tidak sesuai standar platform.
5. Operator bisa membuat object turunan yang tidak terlihat di review Git awal.
6. Emergency hotfix bisa melewati pipeline normal.
7. Namespace tim bisa punya boundary, quota, dan RBAC, tetapi object di dalamnya tetap bisa berbahaya.

**Admission control** adalah titik kontrol di Kubernetes API server yang mengevaluasi request setelah authentication dan authorization, tetapi sebelum object disimpan ke storage cluster. Secara praktis, ini adalah tempat Kubernetes bertanya:

> “User ini memang boleh membuat Deployment, tetapi apakah Deployment yang dia buat aman, lengkap, sesuai policy, dan boleh masuk cluster?”

Part ini akan membangun pemahaman tentang:

- posisi admission control dalam request lifecycle Kubernetes;
- perbedaan authentication, authorization, admission, validation, dan reconciliation;
- built-in admission controllers;
- mutating vs validating admission;
- admission webhooks;
- `ValidatingAdmissionPolicy` berbasis CEL;
- konsep `MutatingAdmissionPolicy` modern;
- Pod Security Admission sebagai contoh built-in non-mutating policy;
- Kyverno dan OPA Gatekeeper sebagai policy engine;
- policy lifecycle dari audit, warn, enforce;
- governance yang operasional, bukan birokrasi;
- failure mode webhook dan policy yang bisa membuat cluster sulit dipakai;
- desain policy untuk Java workload.

Setelah part ini, kamu seharusnya bisa melihat Kubernetes API bukan hanya sebagai endpoint untuk menyimpan YAML, tetapi sebagai **policy enforcement boundary**.

---

## 2. Mental Model Utama

### 2.1 Kubernetes API request lifecycle

Sederhanakan request write Kubernetes seperti ini:

```text
client
  |
  v
kube-apiserver
  |
  |-- authentication: siapa kamu?
  |
  |-- authorization: kamu boleh melakukan verb ini ke resource ini?
  |
  |-- admission mutation: apakah object perlu/default boleh diubah sebelum disimpan?
  |
  |-- admission validation: apakah object akhir boleh disimpan?
  |
  |-- schema/defaulting/conversion/persistence details
  |
  v
etcd
```

Contoh request:

```bash
kubectl apply -f deployment.yaml
```

Yang terjadi bukan hanya “YAML masuk cluster”. Kubernetes akan mengevaluasi:

- siapa identity requester;
- apakah identity itu boleh `create` atau `update` `deployments.apps` di namespace target;
- apakah request kena quota;
- apakah Pod template melanggar Pod Security Admission;
- apakah ada mutating webhook yang menambahkan sidecar, label, annotation, atau default resource;
- apakah ada validating webhook yang menolak image tanpa digest;
- apakah ada `ValidatingAdmissionPolicy` yang mewajibkan label `app.kubernetes.io/name`;
- apakah object akhir valid menurut API schema;
- baru kemudian object disimpan.

**Admission control adalah gerbang sebelum state cluster berubah.**

---

### 2.2 RBAC menjawab “boleh melakukan aksi”, admission menjawab “aksi ini memenuhi aturan?”

RBAC biasanya menjawab pertanyaan bentuk ini:

```text
Can user X perform verb Y on resource Z in namespace N?
```

Contoh:

```text
Can serviceaccount ci/prod-deployer create deployments.apps in namespace payments-prod?
```

Admission menjawab pertanyaan yang lebih semantik:

```text
Even if user X may create Deployment, is this specific Deployment acceptable?
```

Contoh policy admission:

```text
- Deployment harus punya label ownership.
- Pod tidak boleh privileged.
- Container harus punya CPU/memory requests.
- Image harus dari registry internal.
- Image tag `latest` tidak boleh dipakai di production.
- Namespace production harus enforce Pod Security restricted.
- Service type LoadBalancer hanya boleh di namespace tertentu.
- HostPath dilarang kecuali untuk DaemonSet platform tertentu.
- Ingress/Gateway route harus memakai TLS.
```

RBAC terlalu kasar untuk semua itu. RBAC tahu resource dan verb. Admission bisa melihat isi object.

---

### 2.3 Admission bukan replacement untuk testing, review, atau runtime security

Admission policy kuat, tetapi bukan silver bullet.

Admission bisa menolak object yang jelas melanggar aturan statis. Admission tidak bisa membuktikan bahwa aplikasi benar secara bisnis. Admission juga tidak melihat semua behavior runtime.

Contoh yang bisa admission lakukan:

```text
- reject Pod yang tidak punya resource requests
- reject image dari registry publik
- reject container running as root
- reject Deployment tanpa readinessProbe
- reject Secret di namespace yang salah
```

Contoh yang tidak bisa admission jamin sepenuhnya:

```text
- aplikasi tidak punya memory leak
- endpoint readiness benar secara semantik
- retry policy aplikasi tidak menyebabkan traffic storm
- query SQL efisien
- Kafka consumer idempotent
- TLS truststore Java selalu reload dengan benar
```

Jadi policy admission harus dilihat sebagai **guardrail**, bukan sebagai bukti correctness.

---

### 2.4 Mutating admission mengubah object; validating admission memutuskan boleh atau tidak

Ada dua bentuk besar:

```text
Mutating admission:
  - menerima object request
  - boleh mengubah object
  - hasil perubahan lanjut ke tahap berikutnya

Validating admission:
  - menerima object akhir
  - boleh menerima atau menolak
  - tidak boleh mengubah object
```

Contoh mutating:

```text
- menambahkan label default
- menambahkan sidecar observability
- menambahkan default seccomp profile
- menambahkan toleration tertentu
- mengubah image tag ke digest, bila sistem mendukung
```

Contoh validating:

```text
- menolak container tanpa memory request
- menolak privileged container
- menolak image dari registry tidak dipercaya
- menolak Ingress tanpa TLS
- menolak hostPath
```

Rule of thumb:

> Gunakan mutation untuk default yang aman dan predictable. Gunakan validation untuk invariant yang harus dijaga.

Jangan membuat mutation yang terlalu pintar sampai manifest yang direview tidak lagi sama dengan manifest yang dijalankan.

---

### 2.5 Policy adalah kontrak platform

Policy yang baik bukan sekadar security rule. Policy adalah cara platform mengatakan:

```text
Agar workload bisa dioperasikan dengan aman di platform ini,
setiap aplikasi harus memenuhi kontrak minimum berikut.
```

Kontrak itu biasanya mencakup:

- ownership;
- observability;
- resource budgeting;
- security posture;
- deployment safety;
- network exposure;
- cost allocation;
- compliance;
- incident readiness.

Contoh kontrak minimum workload Java production:

```text
- semua workload punya label owner/team/service/environment
- semua container punya CPU dan memory requests
- semua web service punya readinessProbe
- semua container production memakai image digest atau immutable tag
- semua Pod berjalan non-root
- semua filesystem root read-only kecuali ada exception
- semua Service public harus lewat Gateway/Ingress terkontrol
- semua namespace production punya quota
- semua Secret berasal dari external secret workflow, bukan plaintext Git
```

Admission control adalah mekanisme enforcement kontrak tersebut.

---

## 3. Posisi Admission Control dalam Kubernetes

### 3.1 Authentication

Authentication menjawab:

```text
Siapa requester ini?
```

Requester bisa berupa:

- human user dari OIDC/SSO;
- ServiceAccount;
- node/kubelet identity;
- controller;
- CI/CD bot;
- GitOps controller;
- operator.

Output authentication adalah identity dan group.

---

### 3.2 Authorization

Authorization menjawab:

```text
Apakah identity ini boleh melakukan request ini?
```

Contoh request attributes:

```text
verb: create
apiGroup: apps
resource: deployments
namespace: payments-prod
name: payment-api
```

RBAC bisa mengizinkan atau menolak berdasarkan atribut itu. Tapi RBAC belum melihat detail semantik object, misalnya apakah container image aman atau apakah Pod privileged.

---

### 3.3 Admission

Admission terjadi setelah authorization mengizinkan request. Jadi policy admission hanya melihat request yang sudah lolos authorization.

Admission berlaku untuk request yang mengubah state atau melakukan operasi tertentu, seperti:

```text
- create
- update
- delete
- connect-like operations tertentu, misalnya exec/proxy tergantung konfigurasi dan controller
```

Admission tidak dipakai untuk read-only request seperti:

```text
- get
- list
- watch
```

Implikasinya penting:

- admission tidak bisa mencegah user membaca Secret kalau RBAC sudah mengizinkan;
- admission tidak bisa memperbaiki permission read yang terlalu luas;
- admission harus dipadukan dengan RBAC.

---

### 3.4 Validation API schema vs admission validation

Kubernetes punya API schema validation bawaan. Misalnya field harus bertipe benar, enum harus valid, required field harus ada, dan sebagainya.

Contoh schema-level invalid:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bad
spec:
  replicas: "three" # salah, harus integer
```

Admission validation berbeda. Object bisa valid secara schema tetapi tetap ditolak policy.

Contoh schema-valid tetapi policy-invalid:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bad-prod-api
  namespace: payments-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: bad-prod-api
  template:
    metadata:
      labels:
        app: bad-prod-api
    spec:
      containers:
        - name: app
          image: nginx:latest
```

Schema Kubernetes mungkin menerima object ini, tetapi policy production bisa menolak karena:

- image memakai `latest`;
- tidak ada resource requests;
- tidak ada readinessProbe;
- tidak ada ownership label;
- container tidak menetapkan security context;
- image bukan dari registry internal.

---

## 4. Built-in Admission Controllers

Kubernetes menyediakan banyak admission controller bawaan. Beberapa sangat fundamental untuk fitur umum.

Contoh built-in admission controller yang penting:

```text
NamespaceLifecycle
ServiceAccount
ResourceQuota
LimitRanger
DefaultStorageClass
DefaultTolerationSeconds
NodeRestriction
PodSecurity
MutatingAdmissionWebhook
ValidatingAdmissionWebhook
ValidatingAdmissionPolicy
```

Tidak semua cluster memakai konfigurasi sama. Managed Kubernetes biasanya sudah mengaktifkan set tertentu. Self-managed cluster perlu memperhatikan flag API server.

---

### 4.1 NamespaceLifecycle

Controller ini membantu mencegah object dibuat di namespace yang tidak valid, sedang terminating, atau tidak ada.

Failure yang sering terlihat:

```text
Error from server (Forbidden): unable to create new content in namespace X because it is being terminated
```

Mental model:

```text
Namespace bukan folder pasif.
Namespace punya lifecycle.
Admission dapat menolak request saat namespace sudah dalam proses deletion.
```

---

### 4.2 ServiceAccount admission

ServiceAccount admission melakukan hal-hal seperti:

- memastikan Pod mengacu ke ServiceAccount yang ada;
- default ke ServiceAccount `default` bila tidak diatur;
- menangani mount token sesuai konfigurasi;
- berinteraksi dengan image pull secret ServiceAccount.

Dampaknya untuk Java workload:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-api
  namespace: payments-prod
automountServiceAccountToken: false
```

Untuk aplikasi Java biasa yang tidak memanggil Kubernetes API, token ServiceAccount biasanya tidak perlu dimount. Ini mengurangi risiko credential exposure.

---

### 4.3 ResourceQuota

ResourceQuota admission menolak object yang membuat namespace melebihi quota.

Contoh:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: payments-prod
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 64Gi
    limits.cpu: "40"
    limits.memory: 128Gi
    pods: "80"
```

Jika Deployment baru akan membuat namespace melebihi `requests.cpu`, request bisa ditolak.

Poin penting:

- quota bekerja di admission time;
- quota bisa membuat rollout gagal;
- quota error bukan bug scheduler;
- quota harus disesuaikan dengan scaling model.

---

### 4.4 LimitRanger

LimitRange bisa menetapkan default, minimum, dan maksimum request/limit di namespace.

Contoh:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-container-limits
  namespace: payments-dev
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 256Mi
      default:
        cpu: 500m
        memory: 512Mi
```

LimitRange bisa membantu dev namespace, tetapi hati-hati di production. Default yang terlalu kecil bisa membuat aplikasi Java OOM atau throttled. Default yang terlalu besar bisa boros capacity.

Rule of thumb:

```text
Dev namespace boleh punya default kasar.
Production workload sebaiknya explicit.
```

---

### 4.5 PodSecurity admission

Pod Security Admission adalah built-in admission controller untuk menegakkan Pod Security Standards pada namespace. Ia non-mutating: tidak memperbaiki Pod, hanya mengevaluasi.

Namespace label bisa seperti:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

Pod Security Admission sangat berguna sebagai baseline, tetapi tidak menggantikan policy lain seperti:

- wajib resource requests;
- registry restriction;
- image digest;
- ownership labels;
- Service type restriction;
- Ingress/Gateway TLS;
- required probes.

---

### 4.6 MutatingAdmissionWebhook dan ValidatingAdmissionWebhook

Ini adalah extension point untuk memanggil service eksternal ketika request cocok dengan rule tertentu.

Webhook admission memungkinkan:

- custom validation;
- custom mutation;
- integrasi security scanner;
- policy engine;
- service mesh sidecar injection;
- external secret mutation;
- defaulting khusus organisasi.

Tapi webhook juga membawa risiko:

```text
API server write path bergantung pada availability webhook.
Jika webhook down dan failurePolicy=Fail, request bisa terblokir.
Jika webhook lambat, latency API server naik.
Jika webhook scope terlalu luas, hampir semua write request kena dampak.
Jika webhook bug, cluster bisa sulit dioperasikan.
```

Admission webhook adalah power tool. Pakai dengan disiplin.

---

### 4.7 ValidatingAdmissionPolicy

`ValidatingAdmissionPolicy` menyediakan alternatif declarative dan in-process untuk validating admission webhooks. Policy ditulis dengan Common Expression Language atau CEL.

Keuntungan utama:

- tidak perlu external HTTP service untuk banyak rule sederhana/menengah;
- lebih sedikit dependency runtime;
- latency lebih rendah dibanding webhook eksternal;
- cocok untuk policy statis yang mengevaluasi object request;
- lebih native ke API server.

Contoh use case:

```text
- require label tertentu
- disallow image tag latest
- require resource requests
- restrict Service type LoadBalancer
- restrict hostNetwork
- validate naming convention
```

Batasan:

- bukan tempat untuk logic kompleks yang butuh query external system;
- bukan replacement penuh untuk policy engine seperti Kyverno/Gatekeeper dalam semua kasus;
- rule CEL harus dijaga agar readable dan maintainable;
- perlu pemahaman object schema.

---

## 5. Admission Webhook Deep Dive

### 5.1 AdmissionReview

Webhook menerima request dalam bentuk AdmissionReview. Secara konseptual isinya:

```text
- uid request
- user info
- operation: CREATE/UPDATE/DELETE/CONNECT
- kind/resource
- namespace/name
- object baru
- oldObject untuk update/delete tertentu
- dryRun flag
- options
```

Webhook mengembalikan:

```text
allowed: true/false
status/message jika ditolak
patch jika mutating
warnings opsional
```

Kamu tidak perlu selalu menulis webhook sendiri, tetapi harus memahami bentuk kontraknya karena policy engine, service mesh injector, dan security tooling bekerja di layer ini.

---

### 5.2 MutatingWebhookConfiguration

Contoh sederhana:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: example-mutating-webhook
webhooks:
  - name: defaults.platform.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail
    timeoutSeconds: 2
    rules:
      - operations: ["CREATE", "UPDATE"]
        apiGroups: ["apps"]
        apiVersions: ["v1"]
        resources: ["deployments"]
    clientConfig:
      service:
        namespace: platform-system
        name: policy-webhook
        path: /mutate
      caBundle: <base64-ca-bundle>
```

Field penting:

```text
rules:
  request mana yang memanggil webhook

clientConfig:
  webhook service atau URL

failurePolicy:
  Fail atau Ignore

timeoutSeconds:
  batas waktu webhook

sideEffects:
  apakah webhook punya side effect eksternal

namespaceSelector/objectSelector:
  mempersempit scope

matchPolicy:
  Exact atau Equivalent
```

---

### 5.3 ValidatingWebhookConfiguration

Contoh:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: example-validating-webhook
webhooks:
  - name: validate-workload.platform.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail
    timeoutSeconds: 2
    rules:
      - operations: ["CREATE", "UPDATE"]
        apiGroups: ["apps"]
        apiVersions: ["v1"]
        resources: ["deployments"]
    clientConfig:
      service:
        namespace: platform-system
        name: policy-webhook
        path: /validate
      caBundle: <base64-ca-bundle>
```

Validating webhook sebaiknya:

- deterministic;
- cepat;
- memberikan error message jelas;
- punya scope sesempit mungkin;
- tidak bergantung pada service eksternal yang fragile;
- punya timeout pendek;
- punya observability kuat;
- dirilis bertahap.

---

### 5.4 Ordering

Secara konseptual:

```text
1. mutating admission dijalankan terlebih dahulu
2. object hasil mutation dievaluasi validasi
3. validating admission dijalankan setelah mutation
```

Implikasi:

- validating policy harus mengevaluasi object final;
- mutating webhook yang buruk bisa membuat object yang awalnya valid menjadi invalid;
- beberapa mutating webhook bisa berinteraksi dengan cara tidak intuitif;
- jangan mengandalkan ordering antar webhook kecuali benar-benar paham mekanismenya.

---

### 5.5 failurePolicy: Fail vs Ignore

`failurePolicy` menentukan apa yang terjadi jika webhook error atau timeout.

```text
Fail:
  request ditolak jika webhook tidak dapat dihubungi atau error.

Ignore:
  request tetap lanjut jika webhook gagal.
```

Trade-off:

```text
Fail:
  + enforcement kuat
  + cocok untuk security invariant kritis
  - webhook outage bisa memblokir deployment/incident fix

Ignore:
  + cluster lebih available saat webhook bermasalah
  + cocok untuk non-critical defaulting/observability enhancement
  - policy bisa ter-bypass saat webhook down
```

Guideline:

```text
Gunakan Fail untuk invariant security/compliance yang memang harus fail-closed.
Gunakan Ignore untuk mutation opsional atau enrichment yang tidak boleh menghentikan cluster.
```

Tetapi jangan memilih `Ignore` hanya karena webhook tidak reliable. Perbaiki reliability webhook.

---

### 5.6 timeoutSeconds

Webhook masuk ke jalur write API. Timeout terlalu tinggi bisa membuat API server terasa lambat.

Guideline praktis:

```text
- pakai timeout pendek, misalnya 1-3 detik untuk banyak use case
- hindari call network eksternal dari webhook
- cache data jika butuh referensi
- ukur p99 latency webhook
- alarm jika rejection/error/timeout naik
```

Policy tidak boleh menjadi distributed transaction panjang.

---

### 5.7 sideEffects dan dry-run

Webhook harus mendeklarasikan side effect. Untuk mendukung dry-run dengan aman, webhook idealnya tidak punya side effect eksternal.

Bad idea:

```text
Webhook CREATE Deployment lalu membuat ticket, mengirim email, atau mutate external database sebagai side effect.
```

Kenapa buruk:

- dry-run bisa menyebabkan efek nyata;
- retry bisa menggandakan side effect;
- admission path menjadi sulit dipahami;
- incident debugging jadi rumit.

Admission webhook sebaiknya murni mengevaluasi/memutasi request Kubernetes, bukan orchestration workflow eksternal.

---

## 6. ValidatingAdmissionPolicy dengan CEL

### 6.1 Kapan memakai ValidatingAdmissionPolicy

Gunakan ketika policy:

- hanya perlu melihat object request;
- bisa diekspresikan dengan CEL;
- tidak perlu call external service;
- butuh low operational overhead;
- cocok untuk enforcement native API server.

Contoh policy cocok:

```text
- Deployment production harus punya label owner
- container image tidak boleh memakai :latest
- Pod tidak boleh hostNetwork
- Service LoadBalancer hanya boleh di namespace berlabel tertentu
- Ingress harus punya TLS
```

Contoh policy kurang cocok:

```text
- check image signature ke registry eksternal
- query CMDB untuk validasi owner
- melakukan scan vulnerability realtime
- membutuhkan logic multi-resource kompleks
- membutuhkan mutation/generation kompleks
```

---

### 6.2 Contoh: require ownership labels

Contoh berikut menunjukkan bentuk konseptual policy. Detail ekspresi bisa berubah sesuai resource target dan kebutuhan platform.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-standard-labels
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "has(object.metadata.labels) && has(object.metadata.labels['app.kubernetes.io/name'])"
      message: "Deployment must include label app.kubernetes.io/name"
    - expression: "has(object.metadata.labels) && has(object.metadata.labels['platform.example.com/owner'])"
      message: "Deployment must include label platform.example.com/owner"
```

Policy ini belum aktif sampai di-bind.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-standard-labels-binding
spec:
  policyName: require-standard-labels
  validationActions: [Deny]
```

Mental model:

```text
Policy mendefinisikan rule.
Binding menentukan scope dan action.
```

---

### 6.3 Audit, Warn, Deny

ValidatingAdmissionPolicy binding dapat memakai action seperti:

```text
Deny
Warn
Audit
```

Rollout policy yang sehat biasanya:

```text
1. Audit dulu: lihat siapa yang melanggar.
2. Warn: beri feedback tanpa block.
3. Deny di namespace baru atau non-prod.
4. Deny di production setelah exception/migration siap.
```

Jangan langsung enforce policy besar ke seluruh cluster tanpa mengukur blast radius.

---

### 6.4 Contoh: larang image latest

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: disallow-latest-image-tag
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          !c.image.endsWith(':latest') && c.image.contains(':')
        )
      message: "Container images must not use :latest and must specify an explicit tag or digest."
```

Catatan:

- Policy ini hanya contoh awal.
- Image digest validation lebih baik untuk production supply chain.
- Pod template di Deployment/StatefulSet/Job juga perlu dipertimbangkan. Karena controller membuat Pod, banyak platform memilih memvalidasi workload object dan/atau Pod.

---

### 6.5 Contoh: wajib resource requests

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-container-requests
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          has(c.resources) &&
          has(c.resources.requests) &&
          has(c.resources.requests.cpu) &&
          has(c.resources.requests.memory)
        )
      message: "Every container must define CPU and memory requests."
```

Untuk Java service production, ini sangat penting karena tanpa requests:

- scheduler tidak punya sinyal capacity yang benar;
- HPA CPU utilization bisa sulit bermakna;
- QoS class bisa buruk;
- noisy neighbor meningkat;
- capacity planning kacau.

---

### 6.6 Contoh: restrict Service type LoadBalancer

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: restrict-loadbalancer-service
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["services"]
  validations:
    - expression: >-
        object.spec.type != 'LoadBalancer' ||
        (has(namespaceObject.metadata.labels) &&
         namespaceObject.metadata.labels['platform.example.com/allow-loadbalancer'] == 'true')
      message: "Service type LoadBalancer is only allowed in approved namespaces."
```

Konsepnya: tidak semua app team boleh membuat load balancer publik. Exposure sebaiknya lewat Gateway/Ingress standard.

---

## 7. Mutating Policy dan Mutation Strategy

### 7.1 Mutation sebagai defaulting

Mutation berguna untuk default yang aman:

```text
- inject standard labels
- set default seccompProfile
- add default topology spread constraints
- add default toleration untuk platform node tertentu
- inject sidecar observability/mesh
```

Tetapi mutation bisa berbahaya jika:

- mengubah behavior aplikasi tanpa developer sadar;
- membuat Git manifest berbeda jauh dari live object;
- menyembunyikan quality issue;
- membuat debugging sulit;
- bergantung pada ordering antar webhook.

Guideline:

```text
Prefer explicit manifests untuk production-critical behavior.
Use mutation for small, predictable, documented defaults.
```

---

### 7.2 Mutation vs validation

Misalnya container tidak punya resource requests. Ada dua opsi:

```text
A. Mutate: tambahkan default request.
B. Validate: reject dan minta developer mengisi explicit request.
```

Trade-off:

```text
Mutate:
  + lebih ramah untuk onboarding
  + mengurangi friction di dev
  - default bisa salah untuk Java services
  - developer tidak belajar sizing
  - production capacity bisa misleading

Validate:
  + explicit ownership
  + sizing lebih sadar
  + production lebih defensible
  - butuh developer memahami resource model
  - awalnya lebih banyak rejection
```

Rekomendasi:

```text
Dev/sandbox:
  mutation default boleh dipakai.

Staging/production:
  validation explicit lebih baik untuk resource, security, dan routing invariant.
```

---

### 7.3 Sidecar injection

Service mesh dan observability tool sering memakai mutating webhook untuk inject sidecar.

Contoh object sebelum mutation:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payment-api
  labels:
    app: payment-api
spec:
  containers:
    - name: app
      image: registry.example.com/payment-api@sha256:abc...
```

Setelah mutation, Pod bisa punya container tambahan:

```text
- app
- sidecar-proxy
- telemetry-agent
```

Risiko:

- resource request total berubah;
- startup order berubah;
- termination behavior berubah;
- network path berubah;
- probe behavior berubah;
- CPU/memory pressure bertambah;
- debugging jadi melibatkan proxy.

Policy harus memastikan sidecar injection tidak terjadi secara diam-diam di namespace yang belum siap.

---

## 8. Policy Engine: Kyverno dan OPA Gatekeeper

Kubernetes native admission cukup kuat, tetapi banyak organisasi memakai policy engine karena butuh:

- policy authoring yang lebih ekspresif;
- library policy;
- audit reporting;
- background scan;
- mutation/generation;
- image verification;
- centralized governance;
- exception workflow;
- integration dengan GitOps.

Dua nama umum:

```text
Kyverno
OPA Gatekeeper
```

---

### 8.1 Kyverno mental model

Kyverno adalah policy engine cloud-native/Kubernetes-native yang memungkinkan policy sebagai Kubernetes resource. Ia bisa melakukan validasi, mutation, generation, cleanup, dan image verification tergantung konfigurasi dan fitur yang dipakai.

Cocok jika tim ingin:

- policy ditulis dengan YAML/CEL-like style;
- Kubernetes-native UX;
- tidak ingin belajar Rego terlebih dahulu;
- mutation/generation built-in;
- background scanning;
- policy yang dekat dengan manifest Kubernetes.

Contoh konseptual Kyverno policy:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-requests-limits
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-requests
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "CPU and memory requests are required."
        pattern:
          spec:
            containers:
              - resources:
                  requests:
                    cpu: "?*"
                    memory: "?*"
```

Keunggulan:

- mudah dibaca platform/app engineer;
- dekat dengan YAML Kubernetes;
- bagus untuk guardrail umum;
- bisa di-review di Git.

Risiko:

- tetap admission webhook, jadi reliability Kyverno penting;
- policy kompleks tetap bisa sulit dipelihara;
- perlu governance untuk exception;
- perlu observability policy engine.

---

### 8.2 OPA Gatekeeper mental model

OPA Gatekeeper memakai Open Policy Agent dan Rego untuk policy. Gatekeeper menyediakan CRD seperti `ConstraintTemplate` dan `Constraint`.

Cocok jika organisasi:

- sudah memakai OPA/Rego lintas sistem;
- butuh policy language general-purpose;
- ingin policy decision model yang konsisten untuk Kubernetes dan domain lain;
- punya tim platform/security yang nyaman dengan Rego.

Contoh konseptual:

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels

        violation[{"msg": msg}] {
          required := input.parameters.labels[_]
          not input.review.object.metadata.labels[required]
          msg := sprintf("missing required label: %v", [required])
        }
```

Constraint:

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: deployment-must-have-owner
spec:
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: ["Deployment"]
  parameters:
    labels:
      - platform.example.com/owner
      - app.kubernetes.io/name
```

Keunggulan:

- expressive;
- cocok untuk policy lintas domain;
- OPA matang sebagai policy engine;
- reusable template/constraint model.

Risiko:

- Rego learning curve;
- policy bisa terlalu abstrak untuk app team;
- webhook reliability tetap penting;
- debugging policy butuh skill khusus.

---

### 8.3 Native ValidatingAdmissionPolicy vs Kyverno vs Gatekeeper

Ringkasnya:

```text
ValidatingAdmissionPolicy:
  + native, in-process, tidak butuh external service
  + bagus untuk validasi sederhana/menengah
  - tidak cocok untuk semua policy kompleks
  - tidak punya semua fitur policy engine

Kyverno:
  + Kubernetes-native, YAML-friendly
  + validate/mutate/generate/scan/image verification capabilities
  + bagus untuk platform engineering guardrails
  - webhook dependency
  - policy kompleks tetap perlu disiplin

OPA Gatekeeper:
  + Rego expressive dan general-purpose
  + cocok untuk organisasi yang sudah memakai OPA
  + constraint template powerful
  - learning curve lebih tinggi
  - webhook dependency
```

Rekomendasi praktis:

```text
Mulai dari built-in controls dan ValidatingAdmissionPolicy untuk invariant sederhana.
Gunakan Kyverno/Gatekeeper saat butuh audit, exception, library, mutation/generation, atau policy complexity yang lebih besar.
Jangan menambah policy engine hanya karena trend; tambahkan karena kebutuhan governance jelas.
```

---

## 9. Policy Design untuk Java Workloads

### 9.1 Minimum production contract

Untuk Java microservice production, platform bisa menetapkan kontrak minimum seperti:

```text
Metadata:
  - app.kubernetes.io/name
  - app.kubernetes.io/part-of
  - app.kubernetes.io/version
  - platform.example.com/team
  - platform.example.com/owner
  - platform.example.com/environment

Resource:
  - CPU request required
  - memory request required
  - memory limit required atau policy khusus
  - no BestEffort pods

Runtime:
  - runAsNonRoot
  - allowPrivilegeEscalation=false
  - readOnlyRootFilesystem=true jika memungkinkan
  - seccompProfile RuntimeDefault

Lifecycle:
  - readinessProbe required untuk HTTP service
  - startupProbe recommended untuk slow-start Java services
  - terminationGracePeriodSeconds minimum untuk graceful shutdown

Supply chain:
  - image registry restricted
  - no latest tag
  - prefer digest
  - imagePullPolicy aligned with tag strategy

Exposure:
  - no direct LoadBalancer except approved namespace
  - public traffic through Gateway/Ingress standard
  - TLS required for public route

Operations:
  - PDB required for replicated critical service
  - topology spread for critical service
  - HPA only with valid requests and metric
```

---

### 9.2 Policy: no BestEffort Java pods

BestEffort Pod berarti tidak punya CPU/memory request/limit. Untuk Java production, ini hampir selalu buruk.

Policy intent:

```text
Deny Pods where any app container lacks CPU/memory requests.
```

Reasoning:

- JVM butuh memory envelope jelas;
- scheduler butuh signal;
- HPA CPU utilization butuh request;
- node pressure eviction lebih berisiko untuk BestEffort;
- capacity planning butuh ownership.

---

### 9.3 Policy: readiness required for services receiving traffic

Tidak semua container butuh readinessProbe. Job batch misalnya tidak selalu butuh. Tetapi Deployment yang di-expose via Service biasanya harus punya readinessProbe.

Policy perlu hati-hati:

```text
Bad policy:
  Semua Pod harus punya readinessProbe.

Better policy:
  Workload dengan label platform.example.com/exposes-traffic=true harus punya readinessProbe.
```

Kenapa?

- CronJob tidak selalu punya readiness concept;
- one-off migration Job tidak menerima traffic;
- DaemonSet agent mungkin punya model health berbeda;
- policy terlalu universal sering menghasilkan exception berlebihan.

---

### 9.4 Policy: block `latest` and mutable tags

Production image harus reproducible. `latest` membuat rollback/debugging sulit.

Policy intent:

```text
Deny image ending with :latest.
Prefer image digest for production.
```

Stronger policy:

```text
Production namespaces require image reference containing @sha256:
```

Trade-off:

- digest bagus untuk reproducibility;
- developer experience perlu tooling agar digest promotion otomatis;
- Helm values harus mendukung digest;
- GitOps diff harus jelas.

---

### 9.5 Policy: restrict `pods/exec` indirectly via RBAC, not admission

Admission bukan tempat utama untuk melarang `kubectl exec`. Karena exec adalah subresource/connect-like operation dan terutama dikontrol RBAC. Untuk kontrol exec:

```text
- batasi RBAC verb create pada pods/exec
- audit exec usage
- gunakan break-glass role
- buat namespace production read-only untuk developer biasa
```

Lesson:

```text
Tidak semua governance harus admission.
Pilih enforcement layer yang tepat.
```

---

## 10. Governance Lifecycle

### 10.1 Policy lifecycle stages

Policy yang sehat punya lifecycle:

```text
1. Discovery
2. Draft
3. Audit
4. Warn
5. Enforce for new workloads
6. Enforce for all workloads
7. Exception management
8. Periodic review
9. Deprecation/removal
```

Jangan mulai dari enforce tanpa discovery.

---

### 10.2 Discovery

Cari kondisi cluster saat ini:

```bash
kubectl get deploy -A -o json | jq '...'
kubectl get pods -A -o json | jq '...'
kubectl get svc -A
kubectl get ingress -A
kubectl get gateway -A
```

Pertanyaan:

```text
Berapa workload tanpa requests?
Berapa image latest?
Berapa Pod privileged?
Berapa Service LoadBalancer?
Berapa namespace tanpa owner?
Berapa workload tanpa readinessProbe?
```

Output discovery harus menjadi baseline migration.

---

### 10.3 Draft policy

Policy harus punya:

```text
- tujuan jelas
- resource target jelas
- scope jelas
- severity jelas
- exception path jelas
- owner policy jelas
- message error jelas
- rollout plan jelas
```

Bad policy message:

```text
denied by policy
```

Good policy message:

```text
Deployment denied: production workloads must define CPU and memory requests for every container. Add spec.template.spec.containers[].resources.requests.cpu and memory. See platform policy K8S-RES-001.
```

Error message adalah bagian dari developer experience.

---

### 10.4 Audit mode

Audit mode menjawab:

```text
Kalau policy ini enforce hari ini, siapa yang akan gagal?
```

Gunakan untuk:

- mengukur blast radius;
- mengidentifikasi exception valid;
- memperbaiki platform templates;
- mengurutkan migration;
- menghindari outage governance.

---

### 10.5 Warn mode

Warn mode memberi feedback saat apply tanpa menolak request. Ini bagus untuk developer education.

Contoh warning:

```text
Warning: Deployment payment-api should use image digest in production. This will become enforced on 2026-08-01.
```

Warn yang bagus punya tanggal enforcement. Kalau tidak, warning menjadi noise permanen.

---

### 10.6 Enforce mode

Enforce ketika:

- template sudah diperbaiki;
- pipeline sudah validasi pre-merge;
- exception path tersedia;
- dashboard violation tersedia;
- platform support siap;
- policy sudah diuji di non-prod;
- incident bypass jelas.

Jangan enforce policy yang platform sendiri belum patuhi.

---

### 10.7 Exception management

Exception pasti ada. Pertanyaannya bukan “boleh exception atau tidak”, tetapi “exception dikelola atau tidak”.

Exception yang sehat punya:

```text
- owner
- alasan
- scope sempit
- expiry date
- approval
- compensating control
- review cadence
```

Contoh annotation exception:

```yaml
metadata:
  annotations:
    platform.example.com/policy-exception.K8S-SEC-003: "approved"
    platform.example.com/policy-exception.K8S-SEC-003-expiry: "2026-09-30"
    platform.example.com/policy-exception.K8S-SEC-003-ticket: "SEC-12345"
```

Policy bisa memvalidasi bahwa exception punya expiry dan ticket.

Anti-pattern:

```text
platform.example.com/ignore-policy: "true"
```

Itu bypass global yang akan menjadi lubang permanen.

---

## 11. Policy-as-Code dengan GitOps

Policy juga harus dikelola sebagai code.

Struktur repo contoh:

```text
platform-policies/
  clusters/
    prod-eu/
      kustomization.yaml
    prod-us/
      kustomization.yaml
  policies/
    baseline/
      require-labels.yaml
      require-requests.yaml
      disallow-latest.yaml
    security/
      disallow-privileged.yaml
      restrict-hostpath.yaml
      require-seccomp.yaml
    networking/
      restrict-loadbalancer.yaml
      require-ingress-tls.yaml
    exceptions/
      payments-hostpath-exception.yaml
  tests/
    require-labels/
      pass.yaml
      fail.yaml
```

Policy PR harus menjawab:

```text
- Apa invariant yang dijaga?
- Resource apa yang terkena?
- Namespace mana yang terkena?
- Mode: audit/warn/enforce?
- Apa migration impact?
- Bagaimana exception?
- Bagaimana rollback?
```

---

### 11.1 Shift-left validation

Admission menolak saat apply. Lebih baik developer tahu sebelum merge.

Pipeline bisa menjalankan:

```text
- kubeconform/kubeval schema validation
- helm template + validation
- kustomize build + validation
- conftest/OPA
- kyverno CLI
- policy unit tests
- server-side dry-run terhadap cluster non-prod
```

Goal:

```text
Policy failure muncul di PR, bukan saat production deploy.
```

---

### 11.2 Server-side dry-run

`kubectl apply --server-side --dry-run=server` bisa membantu mengevaluasi defaulting dan admission tanpa menyimpan object, selama webhook mendukung dry-run.

Contoh:

```bash
kubectl apply --server-side --dry-run=server -f rendered.yaml
```

Ini berguna untuk:

- CI preflight;
- melihat admission rejection;
- menguji policy baru;
- memvalidasi manifest terhadap API server nyata.

Namun jangan bergantung hanya pada dry-run. Beberapa behavior runtime tetap baru terlihat setelah object berjalan.

---

## 12. Admission Policy untuk Platform Engineering

### 12.1 Policy sebagai golden path enforcement

Golden path tanpa enforcement sering menjadi dokumentasi opsional. Admission policy mengubah golden path menjadi kontrak aktif.

Contoh platform contract:

```text
Untuk deploy service production:
1. gunakan template workload standard
2. isi owner/team/service label
3. isi resource request berdasarkan load test
4. expose traffic via GatewayRoute standard
5. gunakan image digest
6. aktifkan readiness/startup probe
7. aktifkan OpenTelemetry env
8. patuhi Pod Security restricted
```

Policy memastikan workload yang tidak memenuhi minimum tidak masuk cluster.

---

### 12.2 Jangan policy-kan semua hal

Tidak semua preferensi harus jadi admission rule.

Cocok jadi admission policy:

```text
- invariant security
- invariant operability
- invariant cost/capacity
- invariant compliance
- invariant exposure publik
```

Lebih cocok jadi lint/recommendation:

```text
- naming style minor
- urutan field YAML
- preferensi annotation non-kritis
- optimasi yang tidak selalu benar
```

Policy terlalu banyak bisa membuat developer melawan platform.

---

### 12.3 Policy severity model

Gunakan severity:

```text
Critical:
  harus Deny. Contoh: privileged pod di prod, public LB tanpa approval.

High:
  Deny di prod, Warn di non-prod. Contoh: image latest, no requests.

Medium:
  Warn dulu, enforce untuk new workloads. Contoh: missing recommended labels.

Low:
  lint/documentation. Jangan block deploy.
```

Policy severity membantu diskusi rasional.

---

## 13. Failure Mode Admission dan Policy

### 13.1 Webhook outage blocks cluster writes

Symptom:

```text
Error from server (InternalError): failed calling webhook ... context deadline exceeded
```

Kemungkinan:

- webhook Deployment down;
- Service selector salah;
- TLS caBundle salah;
- NetworkPolicy memblokir API server ke webhook;
- webhook overload;
- timeout terlalu pendek untuk logic sekarang;
- DNS/service discovery cluster bermasalah.

Debug:

```bash
kubectl get validatingwebhookconfigurations
kubectl get mutatingwebhookconfigurations
kubectl get pods -n platform-system
kubectl get svc -n platform-system
kubectl logs -n platform-system deploy/policy-webhook
kubectl describe validatingwebhookconfiguration <name>
```

Remediation:

```text
- scale webhook
- rollback webhook release
- fix caBundle
- narrow scope
- adjust failurePolicy sementara jika aman
- disable specific webhook hanya sebagai break-glass
```

Prevention:

```text
- HA replicas
- PDB
- resource requests
- monitoring latency/error
- narrow match rules
- short timeout
- canary webhook release
```

---

### 13.2 Policy too broad blocks system components

Symptom:

```text
CNI/CSI/monitoring/service mesh components gagal upgrade karena policy app workload.
```

Root cause:

```text
Policy match semua Pod di semua namespace, termasuk kube-system dan platform-system.
```

Prevention:

```text
- exclude kube-system jika policy tidak relevan
- gunakan namespaceSelector
- gunakan objectSelector
- gunakan policy tier: platform vs tenant workload
- test terhadap add-on manifests
```

Rule:

```text
Policy untuk app team jangan otomatis diterapkan ke control-plane/add-on namespace.
```

---

### 13.3 Mutation creates invisible behavior

Symptom:

```text
Manifest di Git tidak punya sidecar, tetapi Pod live punya sidecar dan resource usage naik.
```

Root cause:

```text
Mutating webhook inject sidecar berdasarkan namespace label.
```

Impact:

- CPU/memory request total berubah;
- Pod scheduling berubah;
- startup lambat;
- network behavior berubah;
- security context berubah.

Prevention:

```text
- dokumentasikan mutation
- expose mutation in rendered preview
- label namespace eksplisit
- warn before enforce/inject
- include sidecar resource in capacity model
```

---

### 13.4 Policy exception never expires

Symptom:

```text
Banyak workload punya annotation bypass lama.
```

Root cause:

```text
Exception tanpa expiry dan review.
```

Prevention:

```text
- require expiry date
- require ticket
- dashboard exceptions
- alert before expiry
- periodic cleanup
```

---

### 13.5 Policy blocks incident response

Symptom:

```text
Saat incident, tim perlu patch cepat tetapi policy menolak perubahan.
```

Root cause:

- policy terlalu rigid;
- tidak ada break-glass;
- exception approval terlalu lambat;
- platform tidak punya emergency path;
- failurePolicy terlalu fail-closed untuk non-critical webhook.

Solusi:

```text
- define break-glass role
- require audit annotation
- time-bound emergency exception
- post-incident review
- do not normalize bypass
```

Governance yang baik harus mendukung incident response, bukan menghambat keselamatan sistem.

---

### 13.6 Policy engine itself lacks governance

Symptom:

```text
Semua orang bisa mengubah ClusterPolicy atau WebhookConfiguration.
```

Root cause:

- RBAC policy resource terlalu longgar;
- GitOps tidak menjadi source of truth;
- tidak ada review untuk policy changes.

Prevention:

```text
- restrict access to admissionregistration resources
- restrict Kyverno/Gatekeeper policy CRDs
- manage policy via GitOps
- audit changes
- require approval from platform/security owners
```

Policy engine adalah control plane. Ia harus dijaga seperti control plane.

---

## 14. Debugging Admission Rejection

### 14.1 Baca error message dengan struktur

Contoh error:

```text
Error from server (Forbidden): admission webhook "validate.platform.example.com" denied the request: Deployment must define memory requests
```

Pecah menjadi:

```text
Forbidden:
  request ditolak setelah authorization/admission

admission webhook:
  sumber penolakan dari webhook

validate.platform.example.com:
  nama webhook

message:
  rule yang dilanggar
```

Jangan langsung debug scheduler. Object belum masuk cluster.

---

### 14.2 Bedakan RBAC Forbidden vs admission Forbidden

RBAC error biasanya seperti:

```text
Error from server (Forbidden): deployments.apps is forbidden: User "..." cannot create resource "deployments" in API group "apps" in the namespace "payments-prod"
```

Admission error biasanya menyebut:

```text
admission webhook ... denied the request
```

atau:

```text
violates PodSecurity "restricted:latest" ...
```

atau:

```text
denied by ValidatingAdmissionPolicy ...
```

Ini menentukan arah debugging.

---

### 14.3 Gunakan dry-run

```bash
kubectl apply --dry-run=server -f manifest.yaml
```

Jika dry-run gagal, berarti object gagal admission/schema sebelum persist.

---

### 14.4 Inspect webhook configuration

```bash
kubectl get validatingwebhookconfigurations
kubectl get mutatingwebhookconfigurations
kubectl describe validatingwebhookconfiguration <name>
```

Perhatikan:

```text
- rules
- namespaceSelector
- objectSelector
- failurePolicy
- timeoutSeconds
- clientConfig service
- caBundle
```

---

### 14.5 Inspect policy resources

Untuk ValidatingAdmissionPolicy:

```bash
kubectl get validatingadmissionpolicies
kubectl get validatingadmissionpolicybindings
kubectl describe validatingadmissionpolicy <name>
```

Untuk Kyverno:

```bash
kubectl get clusterpolicies
kubectl get policies -A
kubectl describe clusterpolicy <name>
```

Untuk Gatekeeper:

```bash
kubectl get constrainttemplates
kubectl get constraints
```

---

## 15. Designing a Policy Set: Practical Blueprint

### 15.1 Baseline policy set

Baseline untuk semua tenant namespaces:

```text
K8S-META-001: require app/team/owner labels
K8S-RES-001: require CPU and memory requests
K8S-IMG-001: disallow latest tag
K8S-SEC-001: disallow privileged containers
K8S-SEC-002: require runAsNonRoot where possible
K8S-NET-001: restrict LoadBalancer services
K8S-OPS-001: require readinessProbe for traffic-exposed services
```

---

### 15.2 Production stricter policy set

Production namespaces:

```text
K8S-IMG-002: require image digest
K8S-SEC-003: require seccomp RuntimeDefault
K8S-SEC-004: disallow hostPath except approved DaemonSets
K8S-NET-002: require TLS on public route
K8S-OPS-002: require PDB for critical replicated services
K8S-OPS-003: require topology spread for critical services
K8S-COST-001: require cost-center/team labels
```

---

### 15.3 Platform namespace policy set

Platform namespaces may need different rules:

```text
- CNI may need hostNetwork/hostPath/capabilities
- CSI may need privileged behavior
- monitoring agents may need node access
- service mesh may inject sidecars
```

Do not judge platform DaemonSets by the same policy as application Deployments. Instead:

```text
- stricter RBAC for who can deploy there
- separate namespace selectors
- explicit exceptions
- platform-specific policies
```

---

## 16. Java Workload Examples

### 16.1 Bad production Deployment

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
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      containers:
        - name: app
          image: payment-api:latest
          ports:
            - containerPort: 8080
```

Problems:

```text
- no standard labels
- image not from trusted registry
- latest tag
- no resource requests
- no readiness/startup probe
- no security context
- no explicit ServiceAccount
- no graceful shutdown considerations
```

---

### 16.2 Better production Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments-prod
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/part-of: payment-platform
    app.kubernetes.io/version: "1.42.0"
    platform.example.com/team: payments
    platform.example.com/owner: payments-platform-team
    platform.example.com/environment: prod
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
        app.kubernetes.io/part-of: payment-platform
        platform.example.com/exposes-traffic: "true"
    spec:
      serviceAccountName: payment-api
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 45
      securityContext:
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/payments/payment-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: 500m
              memory: 768Mi
            limits:
              memory: 1536Mi
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          startupProbe:
            httpGet:
              path: /actuator/health/startup
              port: http
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:InitialRAMPercentage=40
                -XX:+ExitOnOutOfMemoryError
```

Policy can enforce many properties here, but not all correctness. For example, policy can require readinessProbe exists, but cannot know whether `/actuator/health/readiness` truly reflects downstream readiness correctly.

---

## 17. Policy Testing

### 17.1 Test cases per policy

Each policy should have examples:

```text
pass-minimal.yaml
pass-with-exception.yaml
fail-missing-label.yaml
fail-latest-image.yaml
fail-no-requests.yaml
fail-wrong-namespace.yaml
```

Policy without tests becomes fragile.

---

### 17.2 Test matrix

For each policy:

```text
Resource kinds:
  Deployment, StatefulSet, DaemonSet, Job, CronJob, Pod if relevant

Operations:
  CREATE, UPDATE

Scopes:
  dev namespace, prod namespace, platform namespace

Modes:
  audit, warn, deny

Exceptions:
  no exception, valid exception, expired exception, malformed exception
```

---

### 17.3 Avoid policy regressions

A policy change can break deployments. Treat policy like production code:

```text
- code review
- automated tests
- staged rollout
- observability
- rollback plan
- changelog
```

---

## 18. Performance and Reliability of Admission

### 18.1 Admission is hot path

Every matching write request pays admission cost. If you add many webhooks with broad scope, API write latency grows.

Bad design:

```text
- 12 validating webhooks matching all resources in all namespaces
- each webhook calls external service
- timeout 10-30 seconds
- failurePolicy Fail everywhere
```

Better design:

```text
- prefer native policies for simple validation
- consolidate related checks where appropriate
- narrow selectors
- cache external data
- short timeouts
- high availability webhook deployment
- metrics and SLO for admission latency
```

---

### 18.2 Webhook deployment requirements

Webhook server should have:

```text
- at least 2 replicas
- PodDisruptionBudget
- resource requests/limits
- readiness/liveness/startup probes
- TLS certificate rotation
- anti-affinity/topology spread if critical
- metrics endpoint
- structured logs
- alerting on latency/error/timeout/rejection spike
```

Irony to avoid:

```text
Policy webhook enforces resource requests but its own Deployment has no requests.
```

---

### 18.3 Avoid external dependencies in admission path

Bad:

```text
Admission webhook calls Jira/CMDB/registry/scanner synchronously on every Deployment create.
```

Better:

```text
- sync external data into local cache/CRD periodically
- admission checks local data
- scanner result attached as metadata ahead of deploy
- supply chain verification done before admission or with cached trust data
```

Admission should be fast and deterministic.

---

## 19. Security Model

### 19.1 Who can change admission policy?

Resources to protect:

```text
- ValidatingWebhookConfiguration
- MutatingWebhookConfiguration
- ValidatingAdmissionPolicy
- ValidatingAdmissionPolicyBinding
- policy engine CRDs
- namespaces labels used by Pod Security Admission
- Kyverno/Gatekeeper policy resources
```

If app teams can modify those freely, they can bypass governance.

RBAC should restrict them to platform/security admins or GitOps controller identity.

---

### 19.2 Webhook TLS trust

Admission webhooks require API server to trust webhook TLS endpoint. Misconfigured CA bundle causes failures.

Operational concerns:

```text
- certificate rotation
- caBundle injection
- service DNS name matching cert SAN
- rollout timing
- monitoring expiry
```

Certificate expiry in admission webhook can block deployments.

---

### 19.3 Policy tampering

Threat:

```text
Attacker gains permission to update webhook config and changes failurePolicy to Ignore or removes rules.
```

Mitigation:

```text
- strong RBAC
- GitOps reconciliation
- audit logs
- admission protecting admission resources, carefully designed
- break-glass with logging
```

Be careful with circular dependencies: admission policy that protects admission policy can lock you out if misconfigured.

---

## 20. Governance without Killing Delivery

### 20.1 Good governance is predictable

Developers should know:

```text
- what policy exists
- why it exists
- how to comply
- how to test locally/in CI
- how to request exception
- when warning becomes enforcement
```

Policy surprises create resentment.

---

### 20.2 Put policy into templates

Do not only reject bad manifests. Provide good defaults:

```text
- Helm chart starter
- Kustomize base
- Spring Boot deployment template
- CI validation action
- documentation with examples
```

Platform team should make the compliant path the easiest path.

---

### 20.3 Measure policy outcomes

Metrics:

```text
- number of admission rejections by policy
- top violating teams/namespaces
- warning count trend
- exception count and age
- webhook latency p50/p95/p99
- webhook timeout count
- policy engine availability
- compliance percentage by namespace/environment
```

Policy without measurement becomes ideology.

---

## 21. Anti-Patterns

### 21.1 “Deny everything until people comply”

This creates delivery outages and shadow IT. Use staged rollout.

---

### 21.2 “Mutation fixes everything”

Mutation can hide problems and make live state surprising. Use mutation for narrow, documented defaults.

---

### 21.3 “One global policy for all namespaces”

Platform/system namespaces and app namespaces differ. Scope policy carefully.

---

### 21.4 “Webhook calls external systems synchronously”

Admission path must be reliable and fast. Avoid external runtime dependency.

---

### 21.5 “No exception process”

If no formal exception exists, people create informal bypasses.

---

### 21.6 “Policy messages are cryptic”

A rejection message should teach the fix.

---

### 21.7 “Policy engine managed manually”

Policy must be GitOps-managed, reviewed, and audited.

---

### 21.8 “Security team owns policy alone”

Policy spans security, reliability, cost, developer experience, and platform operations. Ownership should be cross-functional.

---

## 22. Practical Exercises

### Exercise 1 — Trace a request lifecycle

Take a Deployment manifest and write down:

```text
- identity used to apply it
- RBAC permission needed
- namespace quota involved
- Pod Security level involved
- webhooks/policies likely triggered
- expected mutation
- expected validation
- final persisted object
```

Goal: stop thinking of `kubectl apply` as a single operation.

---

### Exercise 2 — Design baseline policy set

For a fictional Java platform, define policy IDs:

```text
- metadata policy
- resource policy
- image policy
- security context policy
- network exposure policy
- readiness policy
```

For each:

```text
- reason
- target resource
- scope
- action: audit/warn/deny
- exception process
- message
```

---

### Exercise 3 — Build a staged rollout plan

Pick one policy: “production images must not use latest”.

Design:

```text
Week 1: audit
Week 2: warn
Week 3: deny for new apps
Week 4: deny all production except approved exceptions
```

Define dashboards and success metrics.

---

### Exercise 4 — Debug webhook outage

Simulate or reason through:

```text
kubectl apply fails with failed calling webhook context deadline exceeded
```

Write runbook:

```text
- identify webhook
- inspect service/endpoints
- inspect pods/logs
- inspect TLS
- decide fail-open/fail-closed action
- rollback if needed
- post-incident prevention
```

---

### Exercise 5 — Policy exception design

Design exception annotation format with:

```text
- policy ID
- ticket
- owner
- expiry
- reason
```

Then write a validation rule conceptually requiring expiry for any exception.

---

## 23. Production Checklist

### Admission architecture

```text
[ ] Built-in admission controllers understood and documented.
[ ] Pod Security Admission enabled and namespace labels managed.
[ ] ValidatingAdmissionPolicy used for native simple validations where appropriate.
[ ] External webhook count minimized and scoped.
[ ] Webhook timeoutSeconds short and intentional.
[ ] failurePolicy selected per risk class.
[ ] Webhooks highly available.
[ ] Webhook TLS rotation monitored.
[ ] API server admission latency monitored.
```

### Policy lifecycle

```text
[ ] Policies stored in Git.
[ ] Policy changes reviewed.
[ ] Policy tests exist.
[ ] Audit/warn/enforce rollout process exists.
[ ] Exceptions are time-bound.
[ ] Exception dashboard exists.
[ ] Break-glass process exists.
[ ] Policy ownership clear.
```

### Java workload guardrails

```text
[ ] Production Java workloads require CPU/memory requests.
[ ] Image latest blocked in production.
[ ] Trusted registry or digest policy defined.
[ ] Readiness required for traffic-serving workloads.
[ ] Security context baseline enforced.
[ ] LoadBalancer Services restricted.
[ ] Public routes require TLS.
[ ] ServiceAccount token mount disabled where unnecessary.
```

### Developer experience

```text
[ ] Rejection messages are actionable.
[ ] Templates produce compliant manifests.
[ ] CI catches policy failures before deploy.
[ ] Documentation explains policy intent.
[ ] Teams know exception process.
```

---

## 24. Key Takeaways

Admission control is one of the most important production Kubernetes concepts because it controls what state is allowed to enter the cluster.

The core mental model:

```text
Authentication identifies requester.
Authorization decides whether requester can attempt an action.
Admission decides whether the specific object/change is acceptable.
Reconciliation later tries to make accepted desired state real.
```

For Java engineers, admission policy is the bridge between application ownership and platform safety. It can enforce the minimum contract needed for reliable operations:

- resource requests;
- image discipline;
- security context;
- readiness/lifecycle hooks;
- ownership metadata;
- controlled exposure;
- namespace and environment boundaries.

But admission is also dangerous when poorly designed. Webhooks are in the API write path. Bad policy can block incident response. Over-broad mutation can hide behavior. Exceptions without expiry become permanent risk.

The best platform policy is not merely strict. It is:

```text
clear,
scoped,
tested,
observable,
staged,
actionable,
exception-aware,
and aligned with how teams actually deliver software.
```

---

## 25. Referensi Utama

- Kubernetes Documentation — Admission Control: https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/
- Kubernetes Documentation — Dynamic Admission Control: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/
- Kubernetes Documentation — Validating Admission Policy: https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/
- Kubernetes Documentation — Mutating Admission Policy: https://kubernetes.io/docs/reference/access-authn-authz/mutating-admission-policy/
- Kubernetes Documentation — Admission Webhook Good Practices: https://kubernetes.io/docs/concepts/cluster-administration/admission-webhooks-good-practices/
- Kubernetes Documentation — Pod Security Admission: https://kubernetes.io/docs/concepts/security/pod-security-admission/
- Kubernetes Documentation — Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/
- Kubernetes Documentation — Resource Quotas: https://kubernetes.io/docs/concepts/policy/resource-quotas/
- Kubernetes Documentation — Limit Ranges: https://kubernetes.io/docs/concepts/policy/limit-range/
- Kyverno Documentation: https://kyverno.io/docs/
- OPA Gatekeeper Documentation: https://open-policy-agent.github.io/gatekeeper/website/docs/

---

## 26. Status Seri

```text
Seri belum selesai.
Part saat ini: 025 dari 035.
Part berikutnya: 026 — Operators, CRDs, and Extending Kubernetes.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — GitOps and Delivery Control Planes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-026.md">Part 026 — Operators, CRDs, and Extending Kubernetes ➡️</a>
</div>
