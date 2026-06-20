# learn-kubernetes-mastery-for-java-engineers-part-018.md

# Part 018 — RBAC, ServiceAccount, Authentication, and Authorization

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas **Namespace, multi-tenancy, quota, dan platform boundary**. Setelah memahami boundary manajemen, pertanyaan berikutnya adalah:

> Siapa boleh melakukan apa di dalam boundary tersebut?

Di Kubernetes, jawaban teknisnya terutama berada pada empat area:

1. **Authentication** — siapa subjeknya?
2. **Authorization** — apakah subjek tersebut boleh melakukan aksi tertentu?
3. **ServiceAccount** — identitas workload di dalam cluster.
4. **RBAC** — model policy standar Kubernetes untuk mengatur izin.

Part ini bertujuan membuat kamu mampu:

- memahami perbedaan `User`, `Group`, dan `ServiceAccount`;
- memahami bagaimana request ke Kubernetes API dievaluasi;
- membaca dan mendesain `Role`, `ClusterRole`, `RoleBinding`, dan `ClusterRoleBinding`;
- membuat RBAC minimal untuk developer, CI/CD, operator, dan aplikasi;
- mengenali privilege escalation path yang umum;
- mendebug error `Forbidden` secara sistematis;
- mendesain akses Kubernetes yang aman, operasional, dan scalable untuk organisasi engineering.

Kita tidak akan membahas detail identity provider enterprise seperti OIDC, LDAP, SAML, IAM, atau cloud-specific workload identity secara mendalam. Itu akan disentuh sebagai integrasi, bukan sebagai materi utama. Fokus part ini adalah **model akses Kubernetes itu sendiri**.

---

## 2. Mental Model Utama

Kubernetes API adalah pusat kendali cluster. Semua perubahan penting terjadi melalui API server:

- membuat Deployment;
- membaca Secret;
- mengubah ConfigMap;
- membuat Pod;
- membuat RoleBinding;
- menjalankan `kubectl exec`;
- membaca log;
- membuat CRD;
- menghapus namespace;
- mem-patch resource;
- menjalankan controller;
- melakukan rollout;
- melakukan scaling.

Karena itu, **akses ke Kubernetes API adalah akses ke kemampuan mengubah realitas cluster**.

Mental model sederhananya:

```text
actor  --->  request  --->  kube-apiserver  --->  authn  --->  authz  --->  admission  --->  etcd / controller reaction
```

Contoh request:

```text
User: alice@example.com
Verb: create
Resource: deployments
API Group: apps
Namespace: payments-prod
Name: fraud-api
```

Kubernetes harus menjawab:

```text
Apakah alice@example.com boleh create apps/deployments di namespace payments-prod?
```

RBAC adalah salah satu authorization mode yang menjawab pertanyaan itu berdasarkan policy object di cluster.

---

## 3. Access Control Pipeline Kubernetes

Ketika request masuk ke Kubernetes API server, request tersebut melewati beberapa tahap konseptual:

```text
1. Authentication
2. Authorization
3. Admission Control
4. Persistence / Execution
```

### 3.1 Authentication

Authentication menjawab:

```text
Siapa yang membuat request ini?
```

Subjek bisa berupa:

```text
- human user
- ServiceAccount
- kubelet
- controller
- external automation
- CI/CD pipeline
- operator
- cloud integration
```

Kubernetes sendiri tidak memiliki object `User` seperti object `Pod` atau `Deployment`. User biasanya berasal dari sistem eksternal:

```text
- client certificate
- OIDC provider
- cloud IAM integration
- bearer token
- webhook authenticator
- proxy authenticator
```

ServiceAccount berbeda. ServiceAccount adalah object Kubernetes yang hidup di namespace dan biasanya dipakai oleh workload di dalam cluster.

### 3.2 Authorization

Authorization menjawab:

```text
Subjek ini boleh melakukan aksi ini terhadap resource ini?
```

RBAC adalah authorization mode yang paling umum dipakai.

Request dievaluasi berdasarkan tuple:

```text
subject + verb + apiGroup + resource + namespace + name
```

Contoh:

```text
subject: system:serviceaccount:payments:fraud-api
verb: get
apiGroup: ""
resource: secrets
namespace: payments
name: fraud-api-db-credentials
```

Pertanyaannya:

```text
Apakah ServiceAccount fraud-api di namespace payments boleh get secret bernama fraud-api-db-credentials?
```

### 3.3 Admission Control

Admission control menjawab:

```text
Walaupun user boleh membuat request ini, apakah request ini memenuhi policy cluster?
```

Contoh:

- user boleh create Pod;
- tetapi Pod memakai privileged container;
- admission policy menolak Pod tersebut.

Jadi RBAC bukan satu-satunya kontrol. RBAC menentukan **izin aksi**, admission menentukan **validitas dan kebijakan isi object**.

### 3.4 Persistence / Execution

Setelah request lolos, object disimpan di `etcd` atau operasi dijalankan. Controller kemudian bereaksi terhadap desired state baru.

---

## 4. Authentication: User, Group, and ServiceAccount

### 4.1 User

User adalah identitas eksternal yang dikenali oleh API server setelah authentication.

Contoh user:

```text
alice@example.com
bob@example.com
system:admin
```

Kubernetes tidak menyediakan API seperti ini:

```bash
kubectl get users
```

Karena `User` bukan resource Kubernetes normal.

Implikasinya:

```text
User lifecycle biasanya dikelola di luar Kubernetes.
```

Misalnya:

- Google Workspace;
- Okta;
- Azure AD / Entra ID;
- AWS IAM;
- LDAP;
- internal identity provider.

### 4.2 Group

Group juga berasal dari authentication layer.

Contoh group:

```text
platform-engineers
payments-developers
sre-oncall
system:authenticated
system:unauthenticated
system:serviceaccounts
system:serviceaccounts:payments
```

RBAC sering lebih baik diberikan ke group daripada user individual.

Buruk:

```text
RoleBinding langsung ke alice@example.com
RoleBinding langsung ke bob@example.com
RoleBinding langsung ke charlie@example.com
```

Lebih baik:

```text
RoleBinding ke group payments-developers
```

Karena lifecycle membership dikelola di identity provider, bukan di manifest Kubernetes satu per satu.

### 4.3 ServiceAccount

ServiceAccount adalah identitas workload di Kubernetes.

Format username ServiceAccount:

```text
system:serviceaccount:<namespace>:<serviceaccount-name>
```

Contoh:

```text
system:serviceaccount:payments:fraud-api
```

ServiceAccount dipakai oleh:

- Pod aplikasi;
- controller;
- operator;
- CI runner in-cluster;
- batch job;
- monitoring agent;
- GitOps controller;
- ingress controller;
- autoscaler;
- CSI/CNI component.

ServiceAccount adalah konsep penting karena Pod tidak seharusnya memakai identitas manusia.

Salah:

```text
Aplikasi memakai token admin manusia untuk akses Kubernetes API.
```

Benar:

```text
Aplikasi memakai ServiceAccount khusus dengan izin minimal.
```

---

## 5. Authorization Tuple: Cara Kubernetes Mengevaluasi Izin

Ketika Kubernetes mengevaluasi authorization, ia tidak berpikir dalam kalimat natural seperti:

```text
Boleh deploy aplikasi payments?
```

Ia berpikir dalam tuple teknis:

```text
verb: create
apiGroup: apps
resource: deployments
namespace: payments
```

Atau:

```text
verb: get
apiGroup: ""
resource: secrets
namespace: payments
resourceName: db-password
```

### 5.1 Verb

Verb umum:

```text
get
list
watch
create
update
patch
delete
deletecollection
```

Verb khusus non-resource atau subresource:

```text
use
bind
escalate
impersonate
approve
sign
```

Verb operasional subresource:

```text
pods/log
pods/exec
pods/portforward
pods/attach
pods/eviction
```

Penting: `get`, `list`, dan `watch` terlihat read-only, tetapi tetap sensitif.

Contoh:

```text
list secrets di namespace prod = membaca daftar semua Secret.
get secret tertentu = membaca isi Secret.
watch secrets = menerima perubahan Secret dari waktu ke waktu.
```

### 5.2 API Group

Core API group ditulis sebagai string kosong:

```yaml
apiGroups: [""]
```

Resource core group:

```text
pods
services
configmaps
secrets
namespaces
persistentvolumeclaims
```

API group lain:

```text
apps
autoscaling
batch
networking.k8s.io
rbac.authorization.k8s.io
apiextensions.k8s.io
policy
admissionregistration.k8s.io
```

Contoh Deployment:

```yaml
apiGroups: ["apps"]
resources: ["deployments"]
verbs: ["get", "list", "watch"]
```

### 5.3 Resource

Resource adalah plural name di API.

Contoh:

```text
pods
deployments
replicasets
statefulsets
secrets
configmaps
services
ingresses
roles
rolebindings
```

Subresource ditulis dengan slash:

```text
pods/log
pods/exec
deployments/scale
pods/status
```

Ini penting karena memberi izin `get pods` tidak otomatis memberi izin `get pods/log`.

### 5.4 Namespace

RoleBinding di namespace hanya memberi izin di namespace tersebut.

Contoh:

```text
RoleBinding di namespace payments tidak berlaku untuk namespace orders.
```

ClusterRoleBinding berlaku cluster-wide.

### 5.5 Resource Name

RBAC bisa membatasi izin ke nama resource tertentu dengan `resourceNames`.

Contoh:

```yaml
resourceNames: ["fraud-api-config"]
```

Namun ada batas penting:

```text
resourceNames tidak cocok untuk list/watch semua resource, karena list/watch biasanya tidak diarahkan ke satu object name.
```

Jadi jangan mengandalkan `resourceNames` sebagai kontrol halus untuk semua skenario.

---

## 6. RBAC Object Model

RBAC terdiri dari empat object utama:

```text
Role
ClusterRole
RoleBinding
ClusterRoleBinding
```

Mental model:

```text
Role / ClusterRole        = daftar izin
RoleBinding / ClusterRoleBinding = siapa mendapat izin itu
```

Atau:

```text
permission set + assignment
```

### 6.1 Role

`Role` berisi permission dalam satu namespace.

Contoh:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployment-reader
  namespace: payments
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
```

Role ini hanya berlaku di namespace `payments`.

### 6.2 ClusterRole

`ClusterRole` adalah permission set cluster-scoped.

ClusterRole bisa dipakai untuk:

1. resource cluster-scoped;
2. resource namespaced, tetapi permission set-nya reusable;
3. non-resource URL;
4. aggregation.

Contoh ClusterRole untuk membaca Deployment:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: deployment-reader
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
```

ClusterRole ini belum memberikan akses ke siapa pun. Ia hanya mendefinisikan permission set.

### 6.3 RoleBinding

`RoleBinding` mengikat subject ke Role atau ClusterRole dalam namespace tertentu.

Contoh RoleBinding ke Role:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: alice-read-deployments
  namespace: payments
subjects:
  - kind: User
    name: alice@example.com
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: deployment-reader
  apiGroup: rbac.authorization.k8s.io
```

Contoh RoleBinding ke ClusterRole:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-developers-view
  namespace: payments
subjects:
  - kind: Group
    name: payments-developers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
```

Ini berarti:

```text
Group payments-developers mendapat permission ClusterRole view, tetapi hanya di namespace payments.
```

### 6.4 ClusterRoleBinding

`ClusterRoleBinding` mengikat subject ke ClusterRole di seluruh cluster.

Contoh:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sre-cluster-admin
subjects:
  - kind: Group
    name: sre-admins
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
```

Ini sangat kuat.

ClusterRoleBinding harus jarang, jelas ownership-nya, dan diaudit.

---

## 7. Role vs ClusterRole: Kesalahpahaman Umum

Banyak engineer salah memahami `ClusterRole` sebagai:

```text
ClusterRole selalu memberi akses seluruh cluster.
```

Tidak selalu.

Yang menentukan scope pemberian akses adalah binding-nya.

```text
ClusterRole + RoleBinding        = izin di namespace binding
ClusterRole + ClusterRoleBinding = izin cluster-wide
Role + RoleBinding               = izin di namespace Role/Binding
```

Contoh:

```text
ClusterRole "view" + RoleBinding di namespace payments
```

Artinya:

```text
view hanya di namespace payments.
```

Sedangkan:

```text
ClusterRole "view" + ClusterRoleBinding
```

Artinya:

```text
view seluruh cluster.
```

Ini pattern penting untuk platform:

```text
Buat ClusterRole reusable untuk role standar.
Bind ke namespace tertentu dengan RoleBinding.
```

---

## 8. Default ClusterRoles

Kubernetes biasanya menyediakan beberapa default ClusterRole.

Yang sering ditemui:

```text
cluster-admin
admin
edit
view
```

### 8.1 cluster-admin

`cluster-admin` adalah permission sangat luas.

Secara praktis:

```text
Bisa melakukan hampir semua hal di cluster.
```

Gunakan hanya untuk:

- break-glass admin;
- platform admin terbatas;
- automation yang benar-benar perlu, dan sebaiknya jarang.

Anti-pattern:

```text
Memberikan cluster-admin ke semua developer supaya tidak ribet.
```

Ini menukar kenyamanan jangka pendek dengan risiko besar.

### 8.2 admin

`admin` biasanya memberi kontrol luas dalam namespace, termasuk membuat Role dan RoleBinding di namespace tersebut, tetapi bukan akses penuh cluster-wide.

Risikonya:

```text
Jika user bisa membuat RoleBinding ke Role yang lebih kuat di namespace, ia bisa memperluas akses di namespace itu.
```

### 8.3 edit

`edit` memberi kemampuan mengubah banyak resource aplikasi dalam namespace.

Namun perlu hati-hati: di beberapa konteks, izin membuat/mengubah Pod dapat menjadi jalan membaca Secret melalui mounting Secret ke Pod.

Mental model:

```text
Can create Pod + can choose ServiceAccount + namespace has powerful ServiceAccount = possible privilege escalation.
```

### 8.4 view

`view` memberi akses baca ke banyak resource, tetapi biasanya tidak memberi akses baca Secret.

Ini masuk akal karena Secret adalah data sensitif.

Namun tetap hati-hati:

```text
ConfigMap, Pod env, annotations, logs, dan events bisa saja mengandung informasi sensitif akibat praktik aplikasi yang buruk.
```

---

## 9. ServiceAccount Deep Dive

### 9.1 Default ServiceAccount

Setiap namespace biasanya memiliki ServiceAccount bernama `default`.

Jika Pod tidak menentukan ServiceAccount, Pod memakai `default`.

Contoh buruk:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fraud-api
spec:
  template:
    spec:
      containers:
        - name: app
          image: example/fraud-api:1.0.0
```

Pod ini memakai ServiceAccount `default`.

Lebih baik:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fraud-api
  namespace: payments
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fraud-api
  namespace: payments
spec:
  template:
    spec:
      serviceAccountName: fraud-api
      automountServiceAccountToken: false
      containers:
        - name: app
          image: example/fraud-api:1.0.0
```

Jika aplikasi tidak perlu memanggil Kubernetes API, matikan automount token.

### 9.2 automountServiceAccountToken

Secara historis, token ServiceAccount sering otomatis di-mount ke Pod.

Risikonya:

```text
Jika aplikasi terkena RCE/SSRF/local file read, token Kubernetes bisa dicuri.
```

Untuk workload biasa yang tidak perlu Kubernetes API:

```yaml
spec:
  automountServiceAccountToken: false
```

Atau di level ServiceAccount:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fraud-api
  namespace: payments
automountServiceAccountToken: false
```

Prinsip:

```text
Jangan mount kredensial yang tidak digunakan.
```

### 9.3 Token Projection

Kubernetes modern menggunakan bound ServiceAccount token yang lebih baik daripada legacy token statis.

Karakteristik yang diinginkan:

```text
- audience-bound
- time-bound
- pod-bound
- rotatable
```

Ini mengurangi risiko token long-lived yang bocor.

### 9.4 ServiceAccount per Workload

Anti-pattern:

```text
Semua app dalam namespace memakai ServiceAccount default.
```

Lebih baik:

```text
Satu ServiceAccount per workload atau per capability group.
```

Contoh:

```text
fraud-api-sa
fraud-worker-sa
fraud-migration-job-sa
fraud-readonly-diagnostics-sa
```

Karena kebutuhan izin masing-masing berbeda.

---

## 10. RBAC untuk Aplikasi Java

Sebagian besar aplikasi Java biasa tidak perlu Kubernetes API access.

REST API Spring Boot yang hanya melayani HTTP request biasanya butuh:

```text
- ConfigMap mounted/env
- Secret mounted/env
- Service discovery via DNS
- logs stdout
- metrics endpoint
```

Ia tidak perlu:

```text
- list pods
- get secrets via Kubernetes API
- patch deployments
- create jobs
- watch endpoints
```

Jadi baseline aman:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fraud-api
  namespace: payments
automountServiceAccountToken: false
```

Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fraud-api
  namespace: payments
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: fraud-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: fraud-api
    spec:
      serviceAccountName: fraud-api
      automountServiceAccountToken: false
      containers:
        - name: app
          image: registry.example.com/payments/fraud-api:1.0.0
          ports:
            - containerPort: 8080
```

Jika aplikasi memang perlu Kubernetes API, misalnya membuat Job dari request bisnis, berikan izin sempit.

Contoh aplikasi hanya boleh membuat Job di namespace sendiri:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: report-api
  namespace: reporting
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: report-job-creator
  namespace: reporting
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: report-api-create-jobs
  namespace: reporting
subjects:
  - kind: ServiceAccount
    name: report-api
    namespace: reporting
roleRef:
  kind: Role
  name: report-job-creator
  apiGroup: rbac.authorization.k8s.io
```

Namun pertanyaan arsitekturalnya:

```text
Apakah aplikasi bisnis benar-benar harus membuat Kubernetes Job langsung?
```

Kadang lebih baik:

```text
app -> domain queue -> worker/controller -> Kubernetes Job
```

Agar aplikasi domain tidak terlalu terikat ke Kubernetes API.

---

## 11. RBAC untuk Developer

Developer biasanya membutuhkan beberapa jenis akses:

```text
- melihat workload
- melihat rollout
- melihat Pod status
- melihat logs
- melakukan port-forward di dev/staging
- restart rollout di dev/staging
- deploy via CI/CD, bukan manual di prod
```

### 11.1 Read-Only Developer Role

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-readonly
  namespace: payments-dev
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps", "events", "persistentvolumeclaims"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets", "daemonsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses", "networkpolicies"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

Binding:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-developers-readonly
  namespace: payments-dev
subjects:
  - kind: Group
    name: payments-developers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: app-readonly
  apiGroup: rbac.authorization.k8s.io
```

### 11.2 Developer Debug Role

Untuk dev/staging, developer mungkin butuh `exec` dan `port-forward`.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-debug
  namespace: payments-dev
rules:
  - apiGroups: [""]
    resources: ["pods/exec", "pods/portforward"]
    verbs: ["create"]
```

Catatan penting:

```text
pods/exec adalah akses kuat.
```

Jika container punya secret mounted, user yang bisa exec dapat membaca file secret tersebut.

Jangan berikan `exec` ke production tanpa alasan kuat, audit, dan kontrol.

### 11.3 Production Read-Only

Di production, developer mungkin cukup:

```text
- get/list/watch workload
- get logs
- lihat events
```

Tapi tidak:

```text
- exec
- port-forward
- patch deployment
- read secrets
- create pods
```

Ini bukan soal tidak percaya developer. Ini soal mengurangi blast radius dan menjaga auditability.

---

## 12. RBAC untuk CI/CD

CI/CD adalah salah satu identitas paling sensitif karena biasanya dapat mengubah workload.

Pertanyaan desain:

```text
Apakah pipeline perlu cluster-wide access?
```

Seringnya tidak.

### 12.1 Namespace-Scoped Deployment Role

Contoh pipeline hanya boleh deploy aplikasi di namespace `payments-dev`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-deployer
  namespace: payments-dev
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-deployer
  namespace: payments-dev
rules:
  - apiGroups: [""]
    resources: ["configmaps", "services"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: ["apps"]
    resources: ["deployments/status"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch", "create", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-deployer
  namespace: payments-dev
subjects:
  - kind: ServiceAccount
    name: payments-deployer
    namespace: payments-dev
roleRef:
  kind: Role
  name: app-deployer
  apiGroup: rbac.authorization.k8s.io
```

### 12.2 CI/CD dan Secret

Sebaiknya pipeline tidak sembarang punya `get/list/watch secrets`.

Pertanyaan:

```text
Apakah pipeline benar-benar perlu membaca Secret dari cluster?
```

Biasanya pipeline hanya perlu:

- membuat reference ke Secret yang sudah ada;
- deploy manifest;
- bukan membaca isi Secret.

Jika pipeline dapat membaca Secret production, kompromi pipeline berarti kompromi credential production.

### 12.3 GitOps Controller

Dalam model GitOps, CI tidak langsung menulis ke cluster production. CI menulis artifact atau manifest ke Git, lalu GitOps controller melakukan sync.

Namun ini memindahkan risiko ke GitOps controller.

GitOps controller perlu izin besar untuk namespace atau cluster yang dikelolanya.

Prinsip:

```text
Scope GitOps controller sesuai scope tanggung jawabnya.
```

Pattern:

```text
- satu controller cluster-wide untuk platform-managed cluster
- atau controller per tenant/team/environment
- atau AppProject/policy layer untuk membatasi resource destination
```

---

## 13. RBAC untuk Operators dan Controllers

Operator/controller biasanya butuh izin `list`, `watch`, dan `update status`.

Contoh operator custom resource:

```text
Custom Resource: FraudRuleSet
Controller action:
- watch FraudRuleSet
- create/update ConfigMap
- create/update Deployment
- update FraudRuleSet/status
```

RBAC-nya harus mencerminkan action itu.

Contoh konseptual:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fraud-ruleset-operator
rules:
  - apiGroups: ["risk.example.com"]
    resources: ["fraudrulesets"]
    verbs: ["get", "list", "watch", "update", "patch"]
  - apiGroups: ["risk.example.com"]
    resources: ["fraudrulesets/status"]
    verbs: ["get", "update", "patch"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

Risiko operator:

```text
Operator sering diberi permission terlalu luas karena sulit memprediksi semua aksi.
```

Tapi operator dengan permission luas adalah automation yang dapat memperbesar kerusakan.

Controller design harus:

```text
- idempotent
- least privilege
- namespace-aware
- punya status yang jujur
- punya finalizer yang aman
- tidak mengambil ownership object di luar scope
```

Part CRD/operator akan dibahas lebih dalam di Part 026.

---

## 14. Sensitive Verbs and Subresources

Tidak semua izin terlihat berbahaya dari namanya.

### 14.1 pods/exec

```yaml
resources: ["pods/exec"]
verbs: ["create"]
```

Ini memungkinkan menjalankan command di container.

Risiko:

```text
- membaca env var
- membaca mounted secret
- menjalankan shell
- mengubah file sementara
- melakukan network call dari dalam pod
```

### 14.2 pods/log

```yaml
resources: ["pods/log"]
verbs: ["get"]
```

Logs bisa mengandung:

```text
- token
- password
- PII
- request payload
- stack trace sensitif
```

Jadi log access juga harus dipikirkan.

### 14.3 pods/portforward

```yaml
resources: ["pods/portforward"]
verbs: ["create"]
```

Risiko:

```text
- bypass ingress/gateway policy
- access internal admin port
- access database proxy sidecar
- debug endpoint exposure
```

### 14.4 secrets

```yaml
resources: ["secrets"]
verbs: ["get", "list", "watch"]
```

Secret access adalah high-risk.

`list` Secret bisa mengembalikan banyak object termasuk data.

### 14.5 serviceaccounts/token

Subresource untuk membuat token ServiceAccount.

Risiko:

```text
Jika user bisa create token untuk ServiceAccount powerful, user bisa bertindak sebagai ServiceAccount itu.
```

### 14.6 rolebindings and clusterrolebindings

Jika user bisa membuat RoleBinding ke role kuat, user bisa menaikkan privilege.

Kubernetes memiliki guardrail seperti verb `escalate` dan `bind`, tetapi jangan bergantung buta. Pahami privilege escalation path.

### 14.7 impersonate

Verb `impersonate` memungkinkan user bertindak sebagai user/group/serviceaccount lain.

Ini sangat sensitif.

---

## 15. Privilege Escalation Patterns

Privilege escalation di Kubernetes sering tidak terlihat sebagai `cluster-admin` langsung. Ia muncul sebagai kombinasi izin.

### 15.1 Can Create Pod + Powerful ServiceAccount

Jika user bisa create Pod di namespace yang memiliki ServiceAccount powerful, user bisa membuat Pod yang memakai ServiceAccount tersebut.

Contoh:

```yaml
spec:
  serviceAccountName: powerful-sa
```

Lalu Pod membaca token dan memakai Kubernetes API.

Mitigasi:

```text
- jangan punya ServiceAccount powerful di namespace aplikasi
- batasi siapa boleh create Pod
- gunakan admission policy untuk membatasi serviceAccountName
- automount token false bila tidak perlu
```

### 15.2 Can Read Secret

Jika user bisa read Secret, user mungkin bisa membaca:

```text
- database password
- cloud credential
- image pull secret
- service account token legacy
- TLS private key
```

Mitigasi:

```text
- jangan beri read Secret secara luas
- gunakan external secret manager
- audit Secret access
- pisahkan namespace dan ServiceAccount
```

### 15.3 Can Patch Deployment

Jika user bisa patch Deployment, user bisa:

```text
- mengganti image menjadi image malicious
- menambahkan env var
- mount Secret
- mengganti command
- mengganti ServiceAccount
```

Jadi `patch deployments` adalah write access serius.

### 15.4 Can Create RoleBinding

Jika user bisa create RoleBinding ke ClusterRole kuat, user bisa memberi diri sendiri akses.

Mitigasi:

```text
- hati-hati memberi admin role
- gunakan admission policy
- audit RoleBinding/ClusterRoleBinding changes
- minimalkan siapa boleh bind role
```

### 15.5 Can Update Webhook Configuration

Jika user bisa mengubah mutating/validating webhook, ia bisa mempengaruhi admission cluster.

Dampaknya bisa cluster-wide.

### 15.6 Can Update CRD

Jika user bisa mengubah CRD, ia dapat mempengaruhi API schema, conversion, dan behavior operator.

Ini bukan sekadar “resource definition”, tapi bagian dari API surface cluster.

### 15.7 Can Access Node / Host

Izin terhadap node, privileged Pod, hostPath, hostNetwork, atau daemonset dapat membuka jalan ke host-level compromise.

Ini akan dibahas lebih dalam di Part 019.

---

## 16. Designing RBAC by Capability, Not Job Title

RBAC yang buruk sering dibuat berdasarkan jabatan:

```text
developer = edit
sre = cluster-admin
qa = view
pipeline = cluster-admin
```

Lebih baik desain berdasarkan capability:

```text
read application runtime state
read logs
perform debug in non-prod
deploy application manifests
restart rollout
scale deployment
manage namespace quota
manage network policy
read production secrets
administer cluster-level resources
```

Lalu mapping ke subject:

```text
payments-developers -> app-readonly in prod
payments-developers -> app-debug in dev
payments-ci -> app-deployer in staging/prod
sre-oncall -> incident-debug elevated role
platform-admins -> cluster-admin break-glass
```

Mental model:

```text
Subject bukan pusat desain. Capability adalah pusat desain.
```

---

## 17. Environment-Aware RBAC

Akses di dev, staging, dan production sebaiknya berbeda.

### 17.1 Dev

Developer boleh lebih banyak:

```text
- create/update deployment
- exec
- port-forward
- delete pods
- inspect config
```

Tujuannya mempercepat feedback.

### 17.2 Staging

Developer masih bisa debug, tetapi lebih terbatas:

```text
- read workload
- read logs
- limited exec if approved
- deploy via CI/CD
```

### 17.3 Production

Production harus paling ketat:

```text
- read-only by default
- no exec unless controlled
- no direct deploy except automation
- no secret read unless exceptional
- privileged access via break-glass
```

Ini bukan karena production “sakral”, tetapi karena:

```text
production adalah tempat data nyata, user nyata, SLA nyata, dan audit nyata.
```

---

## 18. Break-Glass Access

Realita incident:

```text
Kadang ada situasi di mana akses normal tidak cukup.
```

Maka perlu break-glass access.

Tapi break-glass harus punya aturan:

```text
- diberikan ke group kecil
- MFA/identity provider enforced
- durasi terbatas jika memungkinkan
- semua penggunaan diaudit
- alasan incident dicatat
- review setelah incident
```

Anti-pattern:

```text
Semua orang punya cluster-admin karena siapa tahu butuh saat incident.
```

Lebih baik:

```text
Normal role minimal + break-glass controlled.
```

---

## 19. Auditing RBAC

RBAC bukan sesuatu yang dibuat sekali lalu dilupakan.

Audit berkala harus menjawab:

```text
- siapa punya cluster-admin?
- siapa bisa read secrets di prod?
- siapa bisa create pods di prod?
- siapa bisa create rolebindings?
- ServiceAccount mana yang punya akses cluster-wide?
- token mana yang masih aktif?
- RoleBinding mana yang menunjuk user individual lama?
- namespace mana yang memakai default ServiceAccount?
```

Command yang berguna:

```bash
kubectl get clusterrolebindings
kubectl get rolebindings -A
kubectl get clusterroles
kubectl get roles -A
kubectl get serviceaccounts -A
```

Melihat binding cluster-admin:

```bash
kubectl get clusterrolebindings -o json \
  | jq '.items[] | select(.roleRef.name=="cluster-admin") | {name: .metadata.name, subjects: .subjects}'
```

Melihat RoleBinding yang memberi akses ke Secret:

```bash
kubectl get roles -A -o json \
  | jq '.items[] | select(.rules[]? | (.resources // []) | index("secrets")) | {namespace: .metadata.namespace, name: .metadata.name, rules: .rules}'
```

Audit harus mempertimbangkan bahwa akses efektif bisa berasal dari banyak binding.

---

## 20. Debugging Forbidden Errors

Error umum:

```text
Error from server (Forbidden): deployments.apps is forbidden: User "alice@example.com" cannot create resource "deployments" in API group "apps" in the namespace "payments"
```

Jangan langsung menambah `cluster-admin`.

Baca tuple-nya:

```text
subject: alice@example.com
verb: create
resource: deployments
apiGroup: apps
namespace: payments
```

Lalu cari apakah subject punya permission tersebut.

### 20.1 kubectl auth can-i

Cek untuk diri sendiri:

```bash
kubectl auth can-i create deployments -n payments
```

Cek resource spesifik:

```bash
kubectl auth can-i get pods/log -n payments
```

Cek sebagai subject lain jika punya izin impersonate:

```bash
kubectl auth can-i create deployments \
  -n payments \
  --as=alice@example.com
```

Cek ServiceAccount:

```bash
kubectl auth can-i get secrets \
  -n payments \
  --as=system:serviceaccount:payments:fraud-api
```

### 20.2 Debugging Step-by-Step

Langkah sistematis:

```text
1. Ambil exact error.
2. Identifikasi subject.
3. Identifikasi verb.
4. Identifikasi apiGroup.
5. Identifikasi resource/subresource.
6. Identifikasi namespace.
7. Cek RoleBinding di namespace.
8. Cek ClusterRoleBinding jika perlu.
9. Cek roleRef.
10. Cek rules di Role/ClusterRole.
11. Tambahkan izin minimal, bukan role besar.
```

### 20.3 Forbidden Karena Subresource

Contoh:

```bash
kubectl logs fraud-api-abc123 -n payments
```

Error:

```text
cannot get resource "pods/log"
```

Solusi bukan memberi `get pods` saja. Perlu:

```yaml
resources: ["pods/log"]
verbs: ["get"]
```

### 20.4 Forbidden Karena Namespace Salah

RoleBinding di namespace `payments-dev` tidak memberi akses ke `payments-prod`.

Cek:

```bash
kubectl get rolebindings -n payments-prod
```

---

## 21. Impersonation for Testing RBAC

Impersonation berguna untuk menguji akses subject lain.

Contoh:

```bash
kubectl auth can-i list pods \
  -n payments \
  --as=alice@example.com
```

Group:

```bash
kubectl auth can-i list pods \
  -n payments \
  --as=alice@example.com \
  --as-group=payments-developers
```

ServiceAccount:

```bash
kubectl auth can-i list pods \
  -n payments \
  --as=system:serviceaccount:payments:fraud-api
```

Namun untuk memakai `--as`, user yang menjalankan perlu izin `impersonate`.

`impersonate` sendiri adalah izin sensitif.

---

## 22. Non-Resource URLs

RBAC juga bisa mengatur non-resource URL.

Contoh:

```text
/healthz
/version
/metrics
```

Manifest:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: api-server-health-reader
rules:
  - nonResourceURLs: ["/healthz", "/version"]
    verbs: ["get"]
```

Ini lebih sering relevan untuk monitoring dan system integration daripada aplikasi biasa.

---

## 23. Aggregated ClusterRoles

Kubernetes mendukung aggregated ClusterRoles melalui label.

Contoh konsep:

```yaml
metadata:
  labels:
    rbac.authorization.k8s.io/aggregate-to-view: "true"
```

Ini memungkinkan custom resource permission ditambahkan ke role default seperti `view`, `edit`, atau `admin`.

Berguna untuk CRD:

```text
Jika platform membuat CRD FraudRuleSet, role view bisa otomatis mendapat akses baca FraudRuleSet.
```

Tetapi hati-hati:

```text
Aggregation bisa memperluas permission secara tidak terlihat jika tidak diaudit.
```

---

## 24. RBAC and Secrets: A Deeper Warning

Secret adalah resource paling sering diremehkan.

Banyak orang berpikir:

```text
Developer tidak punya get secrets, jadi aman.
```

Tapi akses Secret bisa bocor melalui jalur lain:

```text
- exec ke Pod yang mount Secret
- patch Deployment untuk mount Secret
- create Pod yang mount Secret
- read logs yang mencetak Secret
- read ConfigMap yang salah dipakai menyimpan password
- access CI variable
- access external secret controller logs
```

Jadi kontrol Secret bukan hanya RBAC `secrets`.

Perlu kombinasi:

```text
- RBAC minimal
- admission policy
- Pod Security
- no exec in prod by default
- external secret manager
- log hygiene
- config review
- image hardening
```

---

## 25. RBAC and Admission Policy Interaction

RBAC menjawab:

```text
Boleh create Pod?
```

Admission menjawab:

```text
Pod seperti ini boleh dibuat?
```

Contoh:

RBAC mengizinkan developer create Pod di dev.

Admission policy melarang:

```text
- privileged: true
- hostPath
- hostNetwork
- runAsRoot
- serviceAccountName tidak di allowlist
- image dari registry tidak dikenal
```

Kombinasi ini jauh lebih kuat daripada RBAC saja.

RBAC tanpa admission:

```text
Boleh create Pod = bisa mencoba banyak bentuk Pod berbahaya.
```

Admission tanpa RBAC:

```text
Policy bagus, tapi terlalu banyak orang tetap bisa membuat object.
```

Keduanya harus dipakai bersama.

---

## 26. RBAC Design Patterns

### 26.1 Namespace Developer Read-Only

Untuk production:

```text
Group app-developers -> Role app-readonly -> namespace app-prod
```

Izin:

```text
get/list/watch workload
get pods/log
get events
no secrets
no exec
no patch
```

### 26.2 Non-Prod Developer Debug

Untuk dev/staging:

```text
Group app-developers -> Role app-debug -> namespace app-dev/app-staging
```

Izin:

```text
logs
exec
port-forward
rollout restart if allowed
```

### 26.3 CI Deployer

```text
ServiceAccount app-deployer -> Role app-deployer -> namespace target
```

Izin:

```text
create/update/patch deployment/service/configmap/ingress/job
get/list/watch rollout resources
no clusterrolebinding
no secret read by default
```

### 26.4 App Runtime No API Access

```text
ServiceAccount app-sa, automountServiceAccountToken false
```

Izin:

```text
none
```

### 26.5 Controller Runtime Access

```text
ServiceAccount controller-sa -> Role/ClusterRole sesuai watched resources
```

Izin:

```text
get/list/watch target resource
create/update/patch owned resource
update status
finalizer update if needed
```

### 26.6 Break-Glass Admin

```text
Group sre-breakglass -> cluster-admin
```

Dengan kontrol luar Kubernetes:

```text
MFA, approval, time-bound, audit.
```

---

## 27. Example: RBAC Blueprint for Java Team Namespace

Misal ada team `payments` dengan namespace:

```text
payments-dev
payments-staging
payments-prod
```

Subject:

```text
Group: payments-developers
Group: payments-oncall
ServiceAccount: payments-deployer
ServiceAccount: fraud-api
ServiceAccount: settlement-worker
```

### 27.1 Runtime ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fraud-api
  namespace: payments-prod
automountServiceAccountToken: false
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: settlement-worker
  namespace: payments-prod
automountServiceAccountToken: false
```

### 27.2 Prod Read-Only Role

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-readonly
  namespace: payments-prod
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps", "events", "persistentvolumeclaims"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses", "networkpolicies"]
    verbs: ["get", "list", "watch"]
```

### 27.3 Prod Read-Only Binding

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-developers-readonly
  namespace: payments-prod
subjects:
  - kind: Group
    name: payments-developers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: app-readonly
  apiGroup: rbac.authorization.k8s.io
```

### 27.4 CI/CD Deployer

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-deployer
  namespace: payments-prod
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-deployer
  namespace: payments-prod
rules:
  - apiGroups: [""]
    resources: ["services", "configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: ["apps"]
    resources: ["deployments/status"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch", "create", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-deployer
  namespace: payments-prod
subjects:
  - kind: ServiceAccount
    name: payments-deployer
    namespace: payments-prod
roleRef:
  kind: Role
  name: app-deployer
  apiGroup: rbac.authorization.k8s.io
```

Catatan:

```text
Ini blueprint awal, bukan template universal.
```

Setiap organisasi perlu menyesuaikan:

- deployment mechanism;
- secret management;
- GitOps model;
- admission policy;
- compliance;
- incident model;
- cluster topology.

---

## 28. Common Anti-Patterns

### 28.1 cluster-admin untuk CI/CD

```text
Pipeline deploy aplikasi tidak seharusnya punya cluster-admin.
```

Risiko:

```text
Compromise CI = compromise cluster.
```

### 28.2 Semua Pod memakai default ServiceAccount

```text
Sulit audit, sulit least privilege, mudah privilege leakage.
```

### 28.3 automount token aktif di semua Pod

```text
Token Kubernetes tersedia walaupun aplikasi tidak butuh.
```

### 28.4 Memberi edit di production

`edit` bisa lebih kuat dari yang terlihat, terutama jika user bisa memodifikasi Pod spec.

### 28.5 Memberi read Secret ke developer luas

Bahkan read-only Secret adalah akses credential.

### 28.6 RoleBinding ke user individual

Sulit dikelola saat user pindah tim atau keluar organisasi.

Lebih baik gunakan group.

### 28.7 Tidak mengaudit ClusterRoleBinding

ClusterRoleBinding adalah salah satu sumber akses cluster-wide paling berisiko.

### 28.8 Mengandalkan namespace sebagai security boundary tunggal

Namespace membantu scope RBAC, tetapi bukan isolasi keras tanpa policy lain.

### 28.9 Memberi exec di production tanpa kontrol

Exec bisa menjadi akses langsung ke runtime, secret, filesystem, dan internal network.

### 28.10 Tidak memahami subresource

`pods/log`, `pods/exec`, `deployments/scale`, dan `serviceaccounts/token` punya implikasi berbeda dari parent resource.

---

## 29. Production Checklist

Gunakan checklist ini saat mendesain RBAC cluster atau namespace.

### 29.1 Identity

```text
[ ] Human user berasal dari identity provider resmi.
[ ] Akses diberikan ke group, bukan user individual jika memungkinkan.
[ ] ServiceAccount dibuat per workload/capability.
[ ] Default ServiceAccount tidak dipakai untuk workload penting.
[ ] ServiceAccount token tidak di-mount jika tidak diperlukan.
```

### 29.2 Least Privilege

```text
[ ] Tidak ada cluster-admin untuk aplikasi biasa.
[ ] CI/CD tidak memakai cluster-admin kecuali benar-benar terjustifikasi.
[ ] Production developer access read-only by default.
[ ] Secret read access dibatasi ketat.
[ ] pods/exec dan pods/portforward dibatasi.
[ ] RoleBinding/ClusterRoleBinding creation dibatasi.
```

### 29.3 Scope

```text
[ ] RoleBinding namespace-scoped dipakai untuk akses team/app.
[ ] ClusterRoleBinding hanya untuk akses yang memang cluster-wide.
[ ] Namespace prod/staging/dev punya policy berbeda.
[ ] ServiceAccount tidak diberi akses lintas namespace kecuali perlu.
```

### 29.4 Audit

```text
[ ] ClusterRoleBinding diaudit berkala.
[ ] RoleBinding semua namespace diaudit berkala.
[ ] Akses Secret diaudit.
[ ] Break-glass access diaudit.
[ ] Perubahan RBAC masuk GitOps/review process.
```

### 29.5 Defense in Depth

```text
[ ] RBAC dikombinasikan dengan admission policy.
[ ] Pod Security baseline/restricted diterapkan sesuai namespace.
[ ] NetworkPolicy mendukung boundary runtime.
[ ] Secret management tidak hanya mengandalkan Kubernetes Secret biasa.
[ ] Observability dan audit logs tersedia untuk investigasi.
```

---

## 30. Failure Mode Catalogue

### 30.1 Forbidden saat Deploy

Gejala:

```text
cannot patch deployments.apps
```

Kemungkinan:

```text
- CI ServiceAccount tidak punya patch deployments
- RoleBinding di namespace salah
- apiGroup salah
- memakai Role bukan ClusterRole yang diharapkan
```

Perbaikan:

```text
Tambahkan verb/resource minimal di namespace target.
```

### 30.2 Developer Tidak Bisa Lihat Logs

Gejala:

```text
cannot get resource pods/log
```

Penyebab:

```text
Diberi get pods, tapi tidak diberi get pods/log.
```

Perbaikan:

```yaml
resources: ["pods/log"]
verbs: ["get"]
```

### 30.3 App Mendapat 403 dari Kubernetes API

Gejala:

```text
Java Kubernetes client return Forbidden
```

Kemungkinan:

```text
- ServiceAccount tidak punya izin
- Pod memakai ServiceAccount wrong/default
- token tidak mounted karena automount false
- request ke namespace berbeda
```

Debug:

```bash
kubectl auth can-i <verb> <resource> \
  -n <namespace> \
  --as=system:serviceaccount:<namespace>:<sa-name>
```

### 30.4 Secret Bocor Walau RBAC Melarang get secrets

Kemungkinan:

```text
- user bisa exec ke Pod yang mount Secret
- logs mencetak Secret
- user bisa patch Deployment untuk mount Secret
- user bisa create Pod dengan Secret volume
```

Perbaikan:

```text
- batasi exec
- batasi create/patch Pod/Deployment
- admission policy serviceAccount/volume
- log redaction
```

### 30.5 Namespace Admin Menjadi Terlalu Kuat

Penyebab:

```text
Role admin memungkinkan mengelola RoleBinding di namespace.
```

Risiko:

```text
User dapat memberi akses tambahan di namespace.
```

Perbaikan:

```text
Pisahkan app admin dari RBAC admin.
```

### 30.6 Operator Gagal Update Status

Gejala:

```text
cannot update resource fraudrulesets/status
```

Penyebab:

```text
RBAC memberi update fraudrulesets tapi bukan fraudrulesets/status.
```

Perbaikan:

```yaml
resources: ["fraudrulesets/status"]
verbs: ["update", "patch"]
```

### 30.7 HPA Tidak Bisa Scale Deployment

Gejala:

```text
cannot update deployments/scale
```

Penyebab:

```text
Controller butuh akses subresource scale.
```

Perbaikan:

```yaml
resources: ["deployments/scale"]
verbs: ["get", "update", "patch"]
```

---

## 31. Practical Lab

### 31.1 Buat Namespace

```bash
kubectl create namespace rbac-lab
```

### 31.2 Buat ServiceAccount

```bash
kubectl create serviceaccount demo-app -n rbac-lab
```

### 31.3 Cek Izin Awal

```bash
kubectl auth can-i list pods \
  -n rbac-lab \
  --as=system:serviceaccount:rbac-lab:demo-app
```

Ekspektasi:

```text
no
```

### 31.4 Buat Role Read Pods

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: rbac-lab
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
```

Apply:

```bash
kubectl apply -f pod-reader.yaml
```

### 31.5 Bind ke ServiceAccount

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: demo-app-pod-reader
  namespace: rbac-lab
subjects:
  - kind: ServiceAccount
    name: demo-app
    namespace: rbac-lab
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

Apply:

```bash
kubectl apply -f demo-app-pod-reader.yaml
```

### 31.6 Cek Lagi

```bash
kubectl auth can-i list pods \
  -n rbac-lab \
  --as=system:serviceaccount:rbac-lab:demo-app
```

Ekspektasi:

```text
yes
```

### 31.7 Cek Logs

```bash
kubectl auth can-i get pods/log \
  -n rbac-lab \
  --as=system:serviceaccount:rbac-lab:demo-app
```

Ekspektasi:

```text
no
```

Karena `pods/log` adalah subresource berbeda.

### 31.8 Tambahkan Pods Log

Patch Role:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: rbac-lab
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

Apply dan cek lagi.

### 31.9 Cleanup

```bash
kubectl delete namespace rbac-lab
```

---

## 32. Exercises

### Exercise 1 — Design Read-Only Prod Access

Desain Role untuk developer agar bisa:

```text
- melihat Deployment, ReplicaSet, Pod, Service, Ingress
- membaca logs
- membaca Events
```

Tetapi tidak bisa:

```text
- membaca Secret
- exec ke Pod
- port-forward
- patch Deployment
```

### Exercise 2 — CI/CD Least Privilege

Desain ServiceAccount dan Role untuk pipeline yang hanya boleh:

```text
- create/update/patch Deployment
- create/update/patch Service
- create/update/patch ConfigMap
- get/list/watch rollout status
```

Tidak boleh:

```text
- read Secret
- create RoleBinding
- create Namespace
- create CRD
```

### Exercise 3 — Debug Forbidden

Diberikan error:

```text
User "system:serviceaccount:payments:report-api" cannot create resource "jobs" in API group "batch" in the namespace "payments"
```

Jawab:

```text
- subject-nya siapa?
- verb-nya apa?
- apiGroup-nya apa?
- resource-nya apa?
- namespace-nya apa?
- Role rule minimalnya seperti apa?
```

### Exercise 4 — Identify Privilege Escalation

Sebuah developer group punya izin:

```text
create pods
get secrets
create rolebindings
```

Jelaskan risiko masing-masing dan mitigasinya.

### Exercise 5 — Runtime ServiceAccount

Untuk aplikasi Spring Boot REST API yang tidak perlu Kubernetes API, buat manifest ServiceAccount dan Deployment yang mematikan automount token.

---

## 33. Ringkasan

RBAC adalah fondasi kontrol akses Kubernetes, tetapi harus dipahami sebagai bagian dari pipeline lebih besar:

```text
authentication -> authorization -> admission -> persistence/controller reaction
```

Konsep utama:

```text
Role / ClusterRole = permission set
RoleBinding / ClusterRoleBinding = assignment ke subject
```

Perbedaan scope penting:

```text
ClusterRole + RoleBinding        = namespace-scoped access
ClusterRole + ClusterRoleBinding = cluster-wide access
Role + RoleBinding               = namespace-scoped access
```

Prinsip production:

```text
- akses diberikan berdasarkan capability, bukan jabatan
- ServiceAccount per workload
- default ServiceAccount jangan dipakai sembarangan
- automount token dimatikan jika tidak perlu
- Secret access sangat sensitif
- exec/port-forward juga sensitif
- CI/CD tidak seharusnya cluster-admin
- ClusterRoleBinding harus jarang dan diaudit
- RBAC harus dikombinasikan dengan admission policy dan Pod Security
```

Untuk Java engineer, takeaway terpenting:

```text
Sebagian besar aplikasi Java tidak perlu Kubernetes API access sama sekali.
Jika aplikasi tidak perlu API access, jangan mount ServiceAccount token.
Jika aplikasi perlu API access, beri izin minimal terhadap resource, verb, namespace, dan subresource yang benar-benar dibutuhkan.
```

---

## 34. Referensi

- Kubernetes Documentation — Using RBAC Authorization
- Kubernetes Documentation — Service Accounts
- Kubernetes Documentation — Authenticating
- Kubernetes Documentation — Authorization Overview
- Kubernetes Documentation — Controlling Access to the Kubernetes API
- Kubernetes Documentation — Admission Controllers
- Kubernetes Documentation — Pod Security Standards
- Kubernetes Documentation — API Access Control
- Kubernetes Documentation — `kubectl auth can-i`

---

## 35. Status Seri

```text
Seri belum selesai.
Part saat ini: 018 dari 035.
Part berikutnya: 019 — Pod Security, Security Context, and Workload Hardening.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Namespaces, Multi-Tenancy, Quotas, and Platform Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-019.md">Part 019 — Pod Security, Security Context, and Workload Hardening ➡️</a>
</div>
