# learn-java-deployment-runtime-release-delivery-engineering

## Part 23 — CI/CD Pipeline for Java Deployment

> Target: Java 8 sampai Java 25  
> Fokus: CI/CD sebagai **release-control system**, bukan sekadar automation script.  
> Posisi dalam seri: setelah kita memahami artifact, runtime, container, Kubernetes, database-aware deployment, stateful workload, secret/cert rotation, observability, dan verification, sekarang kita menyusun semua itu menjadi pipeline delivery yang repeatable, traceable, auditable, dan aman.

---

## 0. Tujuan Bagian Ini

Banyak engineer mengira CI/CD adalah:

```text
commit -> build -> test -> docker build -> deploy
```

Itu terlalu dangkal.

Untuk sistem Java production-grade, terutama enterprise/regulatory/case-management system, CI/CD adalah mekanisme untuk menjawab pertanyaan yang jauh lebih penting:

1. Artifact apa yang benar-benar sedang berjalan di production?
2. Source commit mana yang menghasilkan artifact tersebut?
3. Dependency, base image, JDK, config, dan migration mana yang ikut dalam release?
4. Apakah artifact yang dites sama dengan artifact yang dipromosikan?
5. Siapa yang menyetujui deploy ke environment tertentu?
6. Apakah deployment dapat dihentikan, diverifikasi, diulang, atau di-rollback secara terkendali?
7. Apakah pipeline mencatat evidence yang cukup untuk audit, RCA, dan compliance?
8. Apakah pipeline mengurangi risiko manusia, atau justru menyembunyikan risiko di balik automation?

Mental model utama:

```text
CI/CD bukan hanya automation.
CI/CD adalah sistem kendali perubahan.
```

Pipeline yang buruk membuat deploy lebih cepat tetapi lebih berbahaya.

Pipeline yang matang membuat deploy lebih cepat **karena** risikonya dikendalikan.

---

## 1. CI/CD dalam Konteks Java Deployment

Dalam konteks Java deployment, pipeline harus menghubungkan beberapa dunia:

```text
Source code
  -> build tool
  -> test evidence
  -> artifact repository
  -> container registry
  -> deployment manifest
  -> environment config
  -> runtime platform
  -> health verification
  -> release evidence
  -> rollback path
```

CI/CD tidak boleh hanya berhenti pada “application deployed”. Untuk Java production system, pipeline harus memastikan:

- JDK version eksplisit;
- build reproducible;
- artifact immutable;
- dependency traceable;
- image tag tidak ambigu;
- deployment manifest versioned;
- config/secrets tidak bocor;
- migration kompatibel;
- runtime readiness diverifikasi;
- rollback path realistis;
- release evidence tersimpan.

---

## 2. Definisi Dasar: CI, CD, Deployment, Release

Sebelum masuk desain, istilah harus presisi.

### 2.1 Continuous Integration

Continuous Integration adalah praktik menggabungkan perubahan kode secara sering ke mainline, lalu memvalidasinya otomatis.

Untuk Java, CI biasanya mencakup:

- compile;
- unit test;
- static analysis;
- dependency check;
- packaging JAR/WAR/EAR;
- container build;
- SBOM generation;
- vulnerability scan;
- artifact publication.

Namun CI **bukan** deployment production.

CI menjawab:

```text
Apakah perubahan ini cukup valid untuk menjadi candidate artifact?
```

### 2.2 Continuous Delivery

Continuous Delivery berarti setiap perubahan yang lolos validasi dapat dipromosikan ke production melalui proses terkendali.

Tidak harus otomatis deploy ke production.

Ia menjawab:

```text
Apakah artifact ini selalu dalam kondisi siap rilis?
```

### 2.3 Continuous Deployment

Continuous Deployment berarti perubahan yang lolos pipeline otomatis masuk production tanpa approval manual besar.

Ini cocok jika:

- test maturity tinggi;
- observability kuat;
- rollback/roll-forward aman;
- blast radius kecil;
- feature flag matang;
- perubahan schema kompatibel;
- domain risk rendah atau terkendali.

Untuk banyak enterprise/regulatory systems, Continuous Delivery lebih realistis daripada Continuous Deployment penuh.

### 2.4 Deployment vs Release

Deployment dan release tidak sama.

```text
Deployment = memasang versi baru ke runtime environment.
Release    = membuat capability aktif/terpakai oleh user atau traffic.
```

Contoh:

- deploy kode baru dengan feature flag off → deployed, belum released;
- deploy canary 5% traffic → partially released;
- deploy blue environment tetapi belum switch traffic → deployed, belum released;
- enable feature flag untuk semua user → released.

Top 1% engineer selalu memisahkan keduanya.

Karena banyak strategi aman bergantung pada pemisahan ini.

---

## 3. Pipeline sebagai Release-Control System

Pipeline production-grade memiliki beberapa fungsi kendali:

| Fungsi | Pertanyaan yang dijawab |
|---|---|
| Build control | Artifact dibuat dari source mana? |
| Quality control | Bukti apa bahwa artifact cukup aman? |
| Security control | Apakah dependency/image/secrets aman? |
| Promotion control | Artifact yang sama dipindahkan ke environment mana? |
| Approval control | Siapa yang menyetujui deploy? |
| Config control | Config apa yang dipakai di environment tersebut? |
| Deployment control | Strategi rollout apa yang dipakai? |
| Verification control | Bagaimana tahu deployment berhasil? |
| Rollback control | Bagaimana kembali ke kondisi aman? |
| Audit control | Evidence apa yang tersimpan? |

Pipeline yang hanya menjalankan command deploy tanpa control ini hanyalah remote script executor.

---

## 4. Prinsip Utama CI/CD Java Production

### 4.1 Build Once, Promote Many

Prinsip paling penting:

```text
Artifact yang dites harus sama dengan artifact yang dipromosikan.
```

Anti-pattern:

```text
Build ulang artifact untuk DEV.
Build ulang artifact untuk UAT.
Build ulang artifact untuk PROD.
```

Masalah:

- dependency bisa berubah;
- plugin build bisa berubah;
- timestamp/resource generated berbeda;
- base image tag bisa berubah;
- Maven/Gradle cache bisa menghasilkan hasil berbeda;
- Java minor version bisa tidak sama;
- evidence test tidak lagi berlaku untuk artifact baru.

Pattern yang benar:

```text
Commit A
  -> build artifact A once
  -> test artifact A
  -> publish artifact A
  -> promote same artifact A to SIT
  -> promote same artifact A to UAT
  -> promote same artifact A to PROD
```

Untuk container:

```text
Build image digest sha256:abc...
  -> deploy digest sha256:abc... to DEV
  -> promote digest sha256:abc... to UAT
  -> promote digest sha256:abc... to PROD
```

Tag boleh digunakan untuk readability, tetapi deployment production sebaiknya mengacu ke immutable digest.

### 4.2 Artifact Immutability

Artifact production tidak boleh berubah setelah dipublish.

Jika ada perubahan, hasilnya harus artifact baru.

Buruk:

```text
my-service:latest
my-service:prod
my-service:release
my-service:1.0.0  # tetapi di-push ulang
```

Baik:

```text
my-service:1.12.3-build.481-git.a1b2c3d
my-service@sha256:9f2a...
```

Untuk JAR:

```text
com.company:case-service:1.12.3+build.481
SHA-256: 2ae8...
Git commit: a1b2c3d
Build timestamp: 2026-06-18T...
JDK: 21.0.x-temurin
```

Immutability membuat RCA mungkin.

Tanpa immutability, “versi yang sama” bisa berarti isi berbeda.

### 4.3 Explicit Runtime Version

Java deployment harus eksplisit terhadap runtime:

- Java major version;
- vendor/distribution;
- patch version;
- base image;
- OS layer;
- JVM options;
- container architecture.

Contoh metadata release:

```yaml
runtime:
  java_major: 21
  distribution: eclipse-temurin
  java_version: 21.0.7+6
  base_image: eclipse-temurin:21.0.7_6-jre-jammy
  base_image_digest: sha256:...
  architecture: linux/amd64
```

Java 8, 11, 17, 21, dan 25 dapat memiliki perbedaan runtime behavior. Pipeline harus mencegah perubahan runtime diam-diam.

### 4.4 Traceability End-to-End

Setiap deployment harus bisa ditelusuri:

```text
production pod/container/process
  -> image digest / artifact checksum
  -> artifact repository coordinate
  -> CI pipeline run
  -> Git commit
  -> pull request / change request
  -> test report
  -> SBOM
  -> approval
  -> deployment manifest commit
```

Jika chain ini putus, deployment tidak auditable.

### 4.5 Environment Parity with Controlled Difference

DEV, SIT, UAT, staging, PROD tidak harus identik, tetapi perbedaannya harus disengaja dan terdokumentasi.

Yang harus sama:

- artifact;
- runtime major version;
- deployment mechanism;
- manifest structure;
- config schema;
- observability baseline;
- migration mechanism;
- health checks.

Yang boleh berbeda:

- resource size;
- replica count;
- endpoint eksternal;
- credentials;
- rate limit;
- feature flag;
- test/mock integration;
- data volume.

Pipeline harus membedakan:

```text
environment-specific values
```

vs

```text
environment-specific behavior hidden in code
```

Yang kedua lebih berbahaya.

---

## 5. End-to-End CI/CD Flow untuk Java

Pipeline production-grade dapat dimodelkan seperti ini:

```text
[Developer Commit]
       |
       v
[Pull Request Validation]
       |
       v
[Mainline Build]
       |
       v
[Artifact + Image Publication]
       |
       v
[Security + Compliance Gates]
       |
       v
[Deploy to Lower Environment]
       |
       v
[Verification + Integration Evidence]
       |
       v
[Promotion Candidate]
       |
       v
[Approval / Change Window]
       |
       v
[Production Deployment]
       |
       v
[Post-Deployment Verification]
       |
       v
[Release Evidence + Monitoring]
```

Kita bahas setiap tahap.

---

## 6. Stage 1 — Pull Request Validation

PR validation bertujuan mencegah perubahan buruk masuk mainline.

Untuk Java, minimal:

```text
checkout
setup JDK
dependency cache restore
compile
unit tests
static analysis
format/lint
dependency vulnerability check
artifact dry build
```

Namun PR pipeline tidak harus melakukan semua hal berat.

Trade-off:

| Check | Cocok di PR? | Catatan |
|---|---:|---|
| Compile | Ya | Wajib |
| Unit test | Ya | Wajib |
| Fast static analysis | Ya | Wajib |
| Full integration test | Tergantung | Bisa berat |
| Container build | Ya, minimal dry build | Validasi Dockerfile |
| Full image scan | Bisa | Jika durasi masih masuk akal |
| Performance test | Tidak umum | Biasanya nightly/pre-release |
| Full E2E | Tergantung | Bisa flaky jika tidak mature |

Prinsip:

```text
PR validation harus cepat, deterministik, dan memberi feedback awal.
```

Jika PR pipeline 2 jam dan sering flaky, developer akan kehilangan trust.

### 6.1 PR Validation Anti-Pattern

Anti-pattern umum:

1. Test terlalu lambat sehingga developer bypass.
2. Test flaky tetapi dianggap normal.
3. Pipeline hanya compile tetapi tidak menjalankan test penting.
4. Secret production tersedia di PR pipeline.
5. Pull request dari fork bisa mengakses credential.
6. JDK version tidak dikunci.
7. Dependency cache membuat hasil tidak reproducible.
8. Semua branch bisa trigger deployment.

### 6.2 PR Validation untuk Multi-Java Version

Jika library atau platform mendukung Java 8–25, pipeline bisa memakai matrix:

```yaml
java: [8, 11, 17, 21, 25]
```

Tetapi untuk aplikasi production, biasanya satu runtime target cukup.

Bedakan:

```text
Library/framework: test compatibility matrix.
Application service: test target runtime production.
```

Jika service masih Java 8 tetapi sedang migrasi ke 21, pipeline bisa punya dua jalur:

```text
required: Java 8 production build
optional/non-blocking: Java 21 migration compatibility
```

---

## 7. Stage 2 — Mainline Build

Mainline build terjadi setelah merge ke branch utama.

Di tahap ini pipeline menghasilkan candidate artifact resmi.

Output minimal:

- compiled artifact;
- test reports;
- coverage report;
- SBOM;
- checksum;
- build metadata;
- container image jika applicable;
- provenance/attestation jika maturity tinggi.

### 7.1 Build Metadata

Setiap artifact Java harus membawa metadata.

Contoh `build-info.properties`:

```properties
build.artifact=case-service
build.version=1.12.3
build.number=481
build.git.commit=a1b2c3d4
build.git.branch=main
build.time=2026-06-18T01:20:00Z
build.java.version=21.0.7
build.java.vendor=Eclipse Adoptium
build.os=linux-amd64
```

Untuk Spring Boot, metadata bisa diekspos via Actuator `/actuator/info` jika diatur dengan aman.

Untuk plain Java/Jakarta app, metadata bisa dimasukkan sebagai:

- `META-INF/MANIFEST.MF`;
- `/version` internal endpoint;
- startup log;
- admin diagnostics endpoint;
- deployment evidence file.

### 7.2 Manifest Metadata

Contoh `MANIFEST.MF`:

```text
Implementation-Title: case-service
Implementation-Version: 1.12.3-build.481
Build-Commit: a1b2c3d4
Build-Jdk: 21.0.7-temurin
Build-Time: 2026-06-18T01:20:00Z
```

Saat incident, metadata ini sangat berguna.

Tanpa metadata, engineer harus menebak versi dari filename, tag, atau log lama.

---

## 8. Stage 3 — Test Strategy dalam Pipeline

Test di pipeline harus disusun berdasarkan biaya dan confidence.

```text
fast and local -> slow and integrated -> production-like verification
```

### 8.1 Test Pyramid untuk Deployment Pipeline

```text
Unit tests
  -> component tests
  -> contract tests
  -> integration tests
  -> migration tests
  -> container smoke tests
  -> environment smoke tests
  -> synthetic production checks
```

Masing-masing punya fungsi berbeda.

### 8.2 Unit Test

Menjawab:

```text
Apakah logic kecil benar?
```

Unit test harus jalan di PR.

### 8.3 Component Test

Menjawab:

```text
Apakah komponen aplikasi bekerja dengan dependency yang dimock/stub?
```

Contoh:

- service layer dengan fake repository;
- REST controller dengan mock service;
- validation pipeline;
- mapper rules;
- state transition rules.

### 8.4 Contract Test

Menjawab:

```text
Apakah API/event schema masih kompatibel dengan consumer/provider?
```

Penting untuk multi-service deployment.

Contract test mengurangi kebutuhan deploy berurutan yang rapuh.

### 8.5 Integration Test

Menjawab:

```text
Apakah aplikasi bekerja dengan dependency nyata?
```

Contoh:

- database container;
- RabbitMQ/Kafka;
- Redis;
- HTTP stub server;
- object storage emulator.

Untuk Java, Testcontainers sering dipakai, tetapi pipeline harus memperhatikan:

- Docker availability;
- network isolation;
- test duration;
- image pull rate limit;
- reproducibility;
- resource usage.

### 8.6 Migration Test

Untuk database-aware deployment, pipeline harus memvalidasi:

- migration dari schema lama ke baru;
- backward compatibility app lama dengan schema expanded;
- app baru dengan schema expanded;
- rollback/contract scenario jika ada;
- migration idempotency;
- lock duration.

Contoh pipeline migration test:

```text
start DB from baseline schema N
insert representative data
run migration N -> N+1
start old app against new schema if rolling release needed
start new app against new schema
run smoke queries
validate indexes/constraints
```

### 8.7 Container Smoke Test

Setelah image dibuat, jalankan container secara lokal/pipeline:

```bash
docker run --rm \
  -e SPRING_PROFILES_ACTIVE=smoke \
  -p 8080:8080 \
  my-service@sha256:...
```

Validasi:

- process start;
- health endpoint available;
- config load benar;
- required env vars divalidasi;
- JVM options tidak invalid;
- entrypoint benar;
- non-root user tidak merusak write path;
- CA cert/truststore tersedia.

Banyak error deployment bisa ditemukan di tahap ini sebelum masuk cluster.

---

## 9. Stage 4 — Artifact Repository and Container Registry

Artifact Java harus disimpan di tempat yang benar.

### 9.1 Maven Repository

Untuk JAR/WAR/EAR:

- Nexus;
- Artifactory;
- GitHub Packages;
- GitLab Package Registry;
- AWS CodeArtifact;
- Azure Artifacts.

Coordinate harus jelas:

```text
groupId: com.company.enforcement
artifactId: case-service
version: 1.12.3-build.481
packaging: jar
```

### 9.2 Container Registry

Untuk image:

- ECR;
- GCR/Artifact Registry;
- ACR;
- Docker Hub private;
- Harbor;
- Nexus/Artifactory registry.

Tag strategy:

```text
human-readable tag + immutable digest
```

Contoh:

```text
registry.company.com/aceas/case-service:1.12.3-build.481-git.a1b2c3d
registry.company.com/aceas/case-service@sha256:abc123...
```

Deployment manifest sebaiknya memakai digest:

```yaml
image: registry.company.com/aceas/case-service@sha256:abc123...
```

### 9.3 Artifact Promotion vs Rebuild

Ada dua pendekatan:

#### Rebuild per environment

```text
DEV build -> DEV deploy
UAT build -> UAT deploy
PROD build -> PROD deploy
```

Ini buruk untuk traceability.

#### Promote immutable artifact

```text
build once -> publish -> promote reference -> deploy same artifact
```

Ini lebih aman.

Promosi bisa berupa:

- menandai artifact sebagai approved;
- promote repository staging → release;
- copy image antar registry environment;
- update manifest environment untuk digest yang sama.

---

## 10. Stage 5 — Versioning Strategy

Versioning harus membantu manusia dan mesin.

### 10.1 Semantic Versioning

Untuk library, SemVer sangat berguna:

```text
MAJOR.MINOR.PATCH
```

Namun untuk aplikasi enterprise, SemVer saja sering kurang.

Karena release internal butuh build number dan commit.

Contoh lebih operasional:

```text
2.8.0-build.1047-git.9ad31fe
```

### 10.2 Calendar Versioning

Beberapa organisasi memakai:

```text
2026.06.18.1
```

Cocok untuk release train.

Kelemahan:

- tidak menunjukkan compatibility;
- bisa terlalu dekat dengan tanggal deployment, bukan artifact creation;
- sulit mengindikasikan patch semantic.

### 10.3 Recommended Application Version Pattern

Untuk Java service:

```text
<product-version>-build.<ci-build-number>-git.<short-sha>
```

Contoh:

```text
1.12.3-build.481-git.a1b2c3d
```

Container labels:

```dockerfile
LABEL org.opencontainers.image.revision="a1b2c3d4"
LABEL org.opencontainers.image.version="1.12.3-build.481"
LABEL org.opencontainers.image.source="https://git.company.com/team/case-service"
```

### 10.4 Version Drift yang Harus Dicegah

Pipeline harus mencegah:

- application version tidak sama dengan image tag;
- Git SHA di metadata berbeda dengan source image;
- manifest menunjuk tag mutable;
- deployment note menyebut versi berbeda;
- DB migration version tidak tercatat;
- frontend/backend compatibility tidak dicatat;
- rollback target tidak diketahui.

---

## 11. Stage 6 — Security Gates

Security gate bukan tahap kosmetik.

Untuk Java deployment, minimal:

```text
source scan
secret scan
dependency scan
license scan
SBOM generation
container image scan
base image scan
IaC/manifest scan
signature/provenance validation
```

### 11.1 Dependency Vulnerability Scan

Java dependency graph bisa dalam.

Scan harus mencakup:

- direct dependency;
- transitive dependency;
- Maven/Gradle plugin dependency jika relevan;
- test dependency jika dipaketkan tidak sengaja;
- app server shared library;
- container OS packages.

Gate harus punya policy:

| Severity | Default action |
|---|---|
| Critical exploitable | Block |
| Critical non-reachable/non-applicable | Require risk acceptance |
| High exploitable | Block or explicit waiver |
| Medium | Track SLA |
| Low | Track |

Top 1% engineer tidak sekadar “scan merah = gagal”. Mereka melihat exploitability, reachability, runtime exposure, compensating control, dan patch feasibility.

### 11.2 SBOM

SBOM membantu menjawab:

```text
Komponen apa saja yang ada dalam artifact/image ini?
```

SBOM harus disimpan bersama release evidence.

Format umum:

- CycloneDX;
- SPDX.

Untuk Java, SBOM harus mencakup:

- Maven/Gradle dependencies;
- container OS packages;
- base image;
- runtime JDK;
- possibly native libraries.

### 11.3 Secrets Scanning

Pipeline harus mencegah secret masuk:

- repository;
- build log;
- test report;
- Docker layer;
- artifact metadata;
- crash dump;
- generated config.

Jangan pernah pass secret dengan cara yang bisa terekam di command history/log:

```bash
java -Ddb.password=my-secret -jar app.jar
```

Lebih aman:

- secret manager;
- mounted file dengan permission ketat;
- environment variable dengan kontrol log;
- short-lived token;
- workload identity.

### 11.4 Image Signing and Verification

Maturity lebih tinggi:

```text
build image -> generate SBOM -> sign image -> deploy only signed digest
```

Admission controller dapat menolak image tidak signed.

Ini mengubah pipeline dari “trust by convention” menjadi “trust by policy”.

---

## 12. Stage 7 — Deployment Manifest Management

Dalam Kubernetes atau platform modern, artifact saja tidak cukup.

Kita juga butuh deployment manifest:

- Deployment;
- Service;
- Ingress/Route;
- ConfigMap;
- Secret reference;
- HPA;
- PodDisruptionBudget;
- ServiceMonitor;
- NetworkPolicy;
- Job/CronJob;
- migration Job;
- Argo Rollout jika progressive delivery.

### 12.1 Manifest Harus Versioned

Manifest harus ada di Git.

Anti-pattern:

```text
kubectl edit deployment production
```

Masalah:

- perubahan tidak traceable;
- Git tidak lagi source of truth;
- rollback sulit;
- audit lemah;
- environment drift.

Pattern:

```text
application repo       -> source code + build pipeline
manifest/config repo   -> deployment desired state
```

Atau mono-repo jika organisasi cocok.

### 12.2 Helm vs Kustomize vs Plain YAML

#### Plain YAML

Kelebihan:

- eksplisit;
- mudah dibaca;
- tidak ada templating magic.

Kekurangan:

- duplication tinggi;
- sulit multi-environment.

#### Kustomize

Kelebihan:

- overlay environment;
- native Kubernetes style;
- tidak terlalu banyak logic.

Kekurangan:

- patch bisa sulit dibaca jika kompleks;
- kurang cocok untuk highly parameterized chart.

#### Helm

Kelebihan:

- packaging chart;
- values per environment;
- ecosystem luas.

Kekurangan:

- templating bisa terlalu dinamis;
- logic di YAML sulit diaudit;
- values drift;
- rendered manifest harus diperiksa.

Prinsip:

```text
Pilih manifest tool yang membuat desired state mudah dipahami, bukan yang paling fleksibel.
```

### 12.3 Image Update Strategy

Jangan update production manual dengan:

```bash
kubectl set image deployment/app app=my-image:latest
```

Lebih baik:

```text
CI builds image digest
  -> opens PR to environment manifest repo
  -> review/approval
  -> merge
  -> GitOps sync deploys desired state
```

Ini menghasilkan evidence.

---

## 13. Stage 8 — Environment Promotion

Environment promotion adalah inti delivery.

```text
DEV -> SIT -> UAT -> Staging -> PROD
```

Namun yang dipromosikan bukan source code.

Yang dipromosikan adalah:

```text
artifact identity + manifest change + release evidence
```

### 13.1 Promotion Metadata

Setiap promosi harus punya metadata:

```yaml
release:
  application: case-service
  version: 1.12.3-build.481
  git_commit: a1b2c3d4
  image_digest: sha256:abc123
  source_pipeline_run: 98765
  target_environment: uat
  promoted_by: release-manager
  approved_by: product-owner
  change_request: CR-2026-0618-001
  migration_required: true
  rollback_target: 1.12.2-build.470
```

### 13.2 Environment Gate

Contoh gate:

| Environment | Gate |
|---|---|
| DEV | automatic after main merge |
| SIT | integration tests pass |
| UAT | QA sign-off + release note |
| Staging | production-like smoke + performance sanity |
| PROD | CR approval + deployment window + rollback plan |

Tidak semua organisasi butuh semua environment.

Yang penting: gate selaras dengan risiko domain.

---

## 14. Stage 9 — Approval Gates

Approval gate bukan sekadar birokrasi jika dirancang benar.

Approval harus menjawab:

- apa yang berubah;
- risiko apa;
- evidence apa;
- rollback bagaimana;
- siapa yang bertanggung jawab;
- kapan window deploy;
- siapa yang verifikasi.

### 14.1 Approval yang Buruk

```text
Approve? yes/no
```

Tanpa context.

Ini hanya ritual.

### 14.2 Approval yang Baik

Approval screen/release note harus berisi:

```text
Application: case-service
Version: 1.12.3-build.481
Commit range: a1b2c3d..e5f6a7b
Change summary:
  - Add appeal assignment rule
  - Fix compliance case timeout
  - Add DB column CASE_PRIORITY nullable
Risk:
  - DB migration expand only
  - No destructive schema change
Evidence:
  - Unit tests passed
  - Integration tests passed
  - Migration test passed
  - UAT sign-off attached
Rollback:
  - Application rollback to 1.12.2 safe
  - DB rollback not required because column additive
Deployment strategy:
  - Rolling update maxUnavailable=0 maxSurge=1
Verification:
  - Smoke endpoint
  - Synthetic create/read case flow
  - Error rate < 1%
```

### 14.3 GitHub Actions Environment Gate Example

GitHub Actions environments can require deployment protection rules, such as manual approval, wait timers, branch restrictions, and custom rules. This makes environments useful as controlled deployment targets rather than just variable groups.

Conceptual example:

```yaml
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: ./deploy.sh production
```

The environment protection rules live in repository settings.

### 14.4 Jenkins Input Gate Example

In Jenkins, a simple manual gate can be represented as:

```groovy
stage('Approve Production Deployment') {
  steps {
    input message: 'Deploy to production?', ok: 'Deploy'
  }
}
```

But in real production, approval should be tied to release metadata, not just a button.

---

## 15. Stage 10 — Deployment Execution Models

Ada beberapa model menjalankan deployment.

### 15.1 Push-Based Deployment

Pipeline langsung menjalankan deploy:

```text
CI runner -> kubectl/helm/app server CLI -> environment
```

Kelebihan:

- sederhana;
- mudah dipahami;
- cocok untuk organisasi kecil.

Kekurangan:

- CI runner butuh credential environment;
- audit bisa tersebar;
- drift lebih mudah;
- rollback tergantung pipeline state;
- production access meluas.

### 15.2 Pull-Based GitOps Deployment

Pipeline update desired state di Git.

Agent di cluster menarik perubahan:

```text
CI -> commit manifest change -> GitOps controller -> cluster sync
```

Kelebihan:

- Git sebagai source of truth;
- cluster credential tidak perlu di CI;
- drift detection;
- audit kuat;
- rollback via Git/revision;
- separation of build and deploy.

Kekurangan:

- learning curve;
- sync behavior harus dipahami;
- rollback DB tetap tidak otomatis;
- manifest repo governance diperlukan.

Argo CD adalah contoh populer. Argo CD follows the GitOps pattern by using Git repositories as the source of truth for desired application state, and it can sync manifests generated from Kustomize, Helm, Jsonnet, plain YAML, or custom tools.

### 15.3 Hybrid Model

Banyak enterprise memakai hybrid:

```text
CI builds artifact/image
CI opens PR to manifest repo
Human/system approves
GitOps deploys
Pipeline watches verification result
```

Ini sering menjadi titik seimbang antara control dan automation.

---

## 16. Stage 11 — Deployment Strategies in Pipeline

Pipeline harus bisa memilih strategi:

- rolling;
- blue-green;
- canary;
- shadow;
- ring;
- maintenance-window deployment;
- stop-the-world for incompatible changes.

### 16.1 Rolling Update Pipeline

```text
update image digest
apply manifest
wait for rollout
run smoke tests
monitor metrics
mark release success
```

Cocok untuk:

- stateless services;
- backward-compatible DB;
- compatible API;
- safe multiple-version coexistence.

Bahaya jika:

- schema breaking;
- message format incompatible;
- singleton job duplicate;
- session not externalized;
- old/new version tidak bisa coexist.

### 16.2 Blue-Green Pipeline

```text
deploy green
verify green internally
switch traffic from blue to green
monitor
keep blue for rollback window
```

Cocok untuk:

- release besar;
- fast rollback via traffic switch;
- static frontend/backend pair;
- low tolerance downtime.

Bahaya:

- DB shared state tetap bisa incompatible;
- double infrastructure cost;
- background jobs can double-run;
- cache/session split.

### 16.3 Canary Pipeline

```text
deploy new version
route 1% traffic
analyze error/latency/business metrics
increase to 5%, 25%, 50%, 100%
auto-abort if gate fails
```

Cocok untuk:

- high-traffic services;
- observable services;
- changes with uncertain runtime behavior.

Bahaya:

- low-traffic apps tidak cukup signal;
- stateful side effects sulit dibandingkan;
- canary user unfairness;
- metric gate salah desain.

### 16.4 Shadow Deployment Pipeline

```text
live traffic -> stable service
copy traffic -> shadow service
shadow response ignored
compare logs/metrics/behavior
```

Cocok untuk:

- read-only validation;
- performance comparison;
- parser/decision engine validation.

Bahaya:

- shadow must not write side effects;
- external calls must be blocked/stubbed;
- PII/logging risk;
- doubled load.

---

## 17. Stage 12 — Database Migration Integration

CI/CD Java tidak boleh memperlakukan migration sebagai detail kecil.

Deployment dan schema migration harus dirancang bersama.

### 17.1 Migration Execution Models

#### App-start migration

Aplikasi menjalankan Flyway/Liquibase saat startup.

Kelebihan:

- sederhana;
- migration selalu dekat dengan app version.

Kekurangan:

- multiple replicas race jika tidak dikontrol;
- startup delay;
- failed migration membuat app gagal start;
- privilege DB app terlalu besar;
- rollback sulit;
- tidak cocok untuk long migration.

#### Pipeline migration job

Pipeline menjalankan migration sebelum deploy app.

Kelebihan:

- kontrol lebih jelas;
- evidence tersimpan;
- bisa pakai DB credential khusus migration;
- long migration lebih bisa dikelola.

Kekurangan:

- coupling pipeline-DB lebih kuat;
- ordering harus tepat;
- perlu rollback/stop strategy.

#### Kubernetes migration Job

Manifest menyertakan Job migration.

Kelebihan:

- berjalan di environment yang sama;
- credential via secret environment;
- lifecycle terpisah dari app.

Kekurangan:

- idempotency penting;
- job cleanup/history;
- GitOps sync ordering;
- failure handling harus jelas.

### 17.2 Recommended Pattern

Untuk enterprise Java:

```text
Migration is a first-class deployment stage.
```

Bukan side effect tidak terlihat.

Pipeline harus mencatat:

- migration version sebelum;
- migration version sesudah;
- duration;
- lock wait;
- script checksum;
- operator/pipeline run;
- failure log;
- rollback/mitigation note.

### 17.3 Expand-Contract in Pipeline

Pipeline harus mendukung multi-release migration:

```text
Release 1: expand schema, app old still works
Release 2: deploy app using new schema
Release 3: backfill/verify
Release 4: contract/remove old schema after safe window
```

CI/CD yang hanya mengerti “deploy latest app” tidak cukup untuk zero-downtime database evolution.

---

## 18. Stage 13 — Config and Secret Handling in Pipeline

Pipeline tidak boleh menjadi tempat penyimpanan secret liar.

### 18.1 Config Categories

| Category | Example | Stored where |
|---|---|---|
| Build config | Maven profile, JDK version | repo/pipeline |
| Deploy config | replica count, resource limit | manifest repo |
| Runtime config | endpoint, feature flag | config store/manifest |
| Secret | DB password, client secret | secret manager |
| Generated release metadata | image digest, version | artifact/release evidence |

### 18.2 Secret Anti-Patterns

Buruk:

```yaml
env:
  DB_PASSWORD: hardcoded_password
```

Buruk:

```bash
echo $PROD_SECRET
```

Buruk:

```dockerfile
ARG DB_PASSWORD
RUN echo $DB_PASSWORD > /app/config.properties
```

Karena secret bisa masuk layer image.

### 18.3 Better Pattern

```text
Pipeline authenticates to secret manager using short-lived identity.
Runtime workload reads secret through platform mechanism.
Secret value is not baked into artifact or image.
```

Untuk Kubernetes:

```yaml
envFrom:
  - secretRef:
      name: case-service-runtime-secret
```

Atau mounted file:

```yaml
volumeMounts:
  - name: truststore
    mountPath: /etc/app/security
    readOnly: true
```

### 18.4 Secret Rotation and Deployment

Pipeline harus mendukung:

- deploy app compatible with old+new secret;
- rotate secret;
- restart/reload workload;
- verify new credential;
- revoke old credential;
- record evidence.

Secret rotation bukan operasi manual terpisah dari deployment governance.

---

## 19. Stage 14 — Observability Hooks in Pipeline

Deployment pipeline harus berbicara dengan observability.

Minimal setelah deploy:

- check rollout status;
- query health endpoint;
- check logs for startup error;
- check error rate;
- check latency;
- check JVM memory/GC anomalies;
- check dependency connectivity;
- check business synthetic transaction;
- attach dashboard link to release record.

### 19.1 Post-Deployment Verification Window

Contoh:

```text
T+0 min: rollout complete
T+1 min: readiness stable
T+3 min: smoke API pass
T+5 min: error rate below threshold
T+10 min: latency p95 normal
T+15 min: no restart/OOMKilled
T+30 min: business synthetic checks pass
```

Pipeline bisa otomatis menandai release “deployed”, tetapi release “verified” sebaiknya berdasarkan signal.

### 19.2 Metric Gates

Metric gate harus hati-hati.

Buruk:

```text
CPU < 80% => success
```

Lebih baik:

```text
For canary pods:
- HTTP 5xx rate not greater than baseline + threshold
- p95 latency not greater than baseline + threshold
- restart count = 0
- readiness remains true
- JVM heap after GC stable
- DB connection pool not exhausted
```

### 19.3 Log Gates

Pipeline dapat mencari pola fatal:

- `OutOfMemoryError`;
- `NoClassDefFoundError`;
- `ClassNotFoundException`;
- `NoSuchMethodError`;
- `BeanCreationException`;
- `Connection refused`;
- `ORA-` critical errors;
- TLS handshake failures;
- migration failure;
- config missing.

Namun log gate harus menghindari false positive berlebihan.

---

## 20. Stage 15 — Rollback and Roll-Forward Automation

Rollback bukan sekadar “deploy versi lama”.

Untuk Java systems, rollback safety bergantung pada:

- DB compatibility;
- message format;
- cache content;
- session format;
- external side effects;
- feature flags;
- config changes;
- secret rotation;
- migration state;
- old artifact availability.

### 20.1 Application-Only Rollback

Aman jika:

- schema backward-compatible;
- config lama masih valid;
- external API contract belum berubah;
- message consumer old version bisa membaca message baru;
- no irreversible side effect.

### 20.2 Rollback Target Harus Diketahui

Setiap deployment harus mencatat:

```yaml
rollback:
  previous_version: 1.12.2-build.470
  previous_image_digest: sha256:def456
  previous_manifest_revision: git:789abcd
  db_rollback_required: false
  feature_flag_reversal: true
```

### 20.3 Roll-Forward

Kadang rollback lebih berbahaya daripada roll-forward.

Contoh:

- migration sudah menulis data format baru;
- external notification sudah dikirim;
- queue sudah berisi event versi baru;
- data backfill sudah berjalan sebagian.

Dalam kasus itu, pipeline harus mendukung emergency patch fast lane:

```text
hotfix branch -> focused validation -> emergency approval -> deploy patch -> post-incident review
```

### 20.4 Rollback Automation Boundaries

Auto rollback cocok untuk:

- canary error rate tinggi;
- readiness failure;
- crash loop;
- startup failure;
- no DB migration destructive.

Auto rollback berbahaya untuk:

- partially applied data migration;
- external side effects;
- feature release dengan state changes;
- schema contract release;
- multi-service version dependency.

Top 1% engineer tahu kapan automation harus berhenti dan meminta human decision.

---

## 21. Pipeline Design for Different Java Deployment Targets

### 21.1 Executable JAR on VM/systemd

Pipeline flow:

```text
build JAR
publish JAR
copy to release directory
update current symlink
reload systemd daemon if unit changed
restart service
tail logs
health check
record release
```

Example layout:

```text
/opt/company/case-service/
  releases/
    1.12.3-build.481/
      app.jar
      application.yml
      jvm.options
  current -> releases/1.12.3-build.481
  logs/
  run/
```

Deployment command should be idempotent.

Rollback:

```text
current -> previous release
systemctl restart case-service
verify
```

### 21.2 WAR on Tomcat

Pipeline flow:

```text
build WAR
publish WAR
stop/drain node or use rolling pool
deploy WAR to webapps or manager API
wait for context start
run context health
rotate node back into traffic
```

Risks:

- old exploded directory remains;
- classloader leak;
- session loss;
- shared library mismatch;
- deployment manager credential exposure.

### 21.3 EAR on Application Server

Pipeline must handle:

- datasource/JNDI binding;
- JMS resource;
- server group/domain mode;
- deployment plan;
- cluster rollout;
- transaction recovery;
- server-specific CLI;
- shared module compatibility.

### 21.4 Spring Boot on Kubernetes

Pipeline flow:

```text
build JAR
build image
scan/sign image
publish image
update manifest image digest
GitOps sync/helm upgrade
wait rollout
run smoke/synthetic
watch metrics
record release
```

### 21.5 Batch/Job Deployment

Pipeline must treat jobs differently:

- do not kill active job blindly;
- check running executions;
- version job definition;
- ensure idempotency;
- handle retry;
- coordinate scheduler pause/resume;
- preserve execution history.

---

## 22. CI/CD Tooling Landscape

Tools are implementation details, but you must understand their operating model.

### 22.1 Jenkins

Strengths:

- flexible;
- plugin ecosystem;
- works with legacy enterprise;
- good for complex orchestration;
- on-prem friendly.

Risks:

- plugin sprawl;
- controller as snowflake;
- credential leakage if poorly managed;
- pipeline libraries become hidden platform;
- agents inconsistent;
- manual job mutation.

Good Jenkins architecture:

```text
Jenkins controller = orchestration only
Ephemeral agents = build execution
Shared library = governed reusable logic
Credentials = scoped and audited
Artifacts = external repository
Logs/reports = archived
```

Jenkins supports pipeline steps and artifact archiving; archive artifacts can preserve files generated during pipeline execution for later analysis.

### 22.2 GitHub Actions

Strengths:

- close to GitHub repo;
- simple YAML;
- marketplace;
- environment approval gates;
- good for open-source/cloud-native workflows.

Risks:

- workflow sprawl;
- third-party action supply-chain risk;
- permission misconfiguration;
- fork PR secret exposure;
- excessive copy-paste YAML;
- limited enterprise network access unless runners configured.

Good practice:

```yaml
permissions:
  contents: read
  packages: write
  id-token: write
```

Use least privilege.

### 22.3 GitLab CI

Strengths:

- integrated repo/CI/container registry;
- environments;
- manual jobs;
- protected branches/tags;
- good monorepo support.

Risks:

- complex YAML inheritance;
- runner isolation;
- secret scope;
- accidental deploy from wrong branch.

### 22.4 Azure DevOps Pipelines

Strengths:

- enterprise governance;
- approvals;
- environment resources;
- integration with Azure;
- release pipelines legacy and YAML pipelines.

Risks:

- split classic/YAML models;
- service connection scope;
- hidden approvals;
- variable group misuse.

### 22.5 Argo CD / Flux

Strengths:

- GitOps source of truth;
- drift detection;
- Kubernetes-native;
- separation of CI and CD;
- good audit via Git.

Risks:

- sync wave/order complexity;
- secrets management integration;
- DB migration ordering;
- manual cluster changes overwritten;
- teams misunderstanding desired vs live state.

---

## 23. Reference Pipeline Architecture

A strong Java CI/CD architecture:

```text
                 +----------------+
                 |  Git Repository |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | PR Validation  |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | Mainline Build |
                 +-------+--------+
                         |
        +----------------+----------------+
        |                                 |
        v                                 v
+---------------+                 +----------------+
| Maven/Nexus   |                 | Image Registry |
| JAR/WAR/EAR   |                 | Digest Image   |
+-------+-------+                 +-------+--------+
        |                                 |
        +----------------+----------------+
                         |
                         v
                 +----------------+
                 | Release Record |
                 | SBOM, tests,   |
                 | checksum       |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | Manifest PR    |
                 | image digest   |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | Approval Gate  |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | GitOps Sync /  |
                 | Deploy Runner  |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | Verification   |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | Release Evidence|
                 +----------------+
```

Key idea:

```text
CI produces immutable artifact.
CD promotes desired state.
Verification decides release confidence.
Evidence preserves accountability.
```

---

## 24. Example GitHub Actions Pipeline for Java Service

This is conceptual; adapt to your platform.

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write
  id-token: write
  security-events: write

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven

      - name: Compile and test
        run: ./mvnw -B clean verify

      - name: Archive test reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-reports
          path: '**/target/surefire-reports/**'

  build-image:
    if: github.ref == 'refs/heads/main'
    needs: validate
    runs-on: ubuntu-latest
    outputs:
      image_digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven

      - name: Build jar
        run: ./mvnw -B -DskipTests package

      - name: Build image
        id: build
        run: |
          IMAGE="registry.example.com/case-service:${GITHUB_SHA}"
          docker build -t "$IMAGE" .
          docker push "$IMAGE"
          DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE")
          echo "digest=$DIGEST" >> "$GITHUB_OUTPUT"

      - name: Generate release metadata
        run: |
          cat > release-metadata.json <<JSON
          {
            "application": "case-service",
            "git_commit": "${GITHUB_SHA}",
            "image": "${{ steps.build.outputs.digest }}",
            "pipeline_run": "${GITHUB_RUN_ID}"
          }
          JSON

      - uses: actions/upload-artifact@v4
        with:
          name: release-metadata
          path: release-metadata.json
```

Production deployment can be a separate workflow using environment approvals.

---

## 25. Example Jenkins Pipeline for Java Service

```groovy
pipeline {
  agent any

  tools {
    jdk 'temurin-21'
    maven 'maven-3.9'
  }

  environment {
    APP_NAME = 'case-service'
    REGISTRY = 'registry.example.com/aceas'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse HEAD > git-commit.txt'
      }
    }

    stage('Build and Test') {
      steps {
        sh './mvnw -B clean verify'
      }
      post {
        always {
          junit '**/target/surefire-reports/*.xml'
          archiveArtifacts artifacts: '**/target/*.jar, git-commit.txt', fingerprint: true
        }
      }
    }

    stage('Build Image') {
      when { branch 'main' }
      steps {
        script {
          def commit = readFile('git-commit.txt').trim()
          def image = "${REGISTRY}/${APP_NAME}:${commit}"
          sh "docker build -t ${image} ."
          sh "docker push ${image}"
        }
      }
    }

    stage('Approve UAT') {
      when { branch 'main' }
      steps {
        input message: 'Promote this build to UAT?', ok: 'Promote'
      }
    }

    stage('Deploy UAT') {
      when { branch 'main' }
      steps {
        sh './deploy.sh uat'
      }
    }
  }
}
```

Real pipelines should avoid building Docker on the controller, use ephemeral agents, use registry credentials securely, and record image digest.

---

## 26. Example GitOps Promotion Flow

### 26.1 Application CI Repository

CI builds and publishes:

```text
registry.example.com/aceas/case-service@sha256:abc123
```

Then opens PR to manifest repo:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    spec:
      containers:
        - name: case-service
          image: registry.example.com/aceas/case-service@sha256:abc123
```

### 26.2 Manifest Repo Structure

```text
deployments/
  case-service/
    base/
      deployment.yaml
      service.yaml
      kustomization.yaml
    overlays/
      dev/
        kustomization.yaml
        patch-resources.yaml
      uat/
        kustomization.yaml
        patch-resources.yaml
      prod/
        kustomization.yaml
        patch-resources.yaml
```

### 26.3 Promotion

```text
Merge PR to overlays/dev   -> deploy DEV
Merge PR to overlays/uat   -> deploy UAT
Merge PR to overlays/prod  -> deploy PROD
```

This makes promotion visible as Git history.

---

## 27. Handling Multi-Service Java Releases

Many enterprise releases deploy multiple services.

Problem:

```text
frontend A requires backend B
backend B requires database migration C
worker D consumes event from backend B
reporting E reads new data
```

Pipeline must model dependency.

### 27.1 Bad Model

```text
Deploy all services latest.
Hope order works.
```

### 27.2 Better Model

Release manifest:

```yaml
release: ACEAS-2026.06.R1
components:
  case-service:
    version: 1.12.3-build.481
    image: sha256:abc
  appeal-service:
    version: 2.4.1-build.201
    image: sha256:def
  frontend:
    version: 3.8.0-build.77
    image: sha256:ghi
  migration:
    version: 2026.06.18.001
order:
  - migration-expand
  - backend-compatible-services
  - workers
  - frontend
  - verification
compatibility:
  case-service:
    compatible_with_frontend: ['3.7.x', '3.8.x']
rollback:
  application_only_safe: true
  db_contract_deferred: true
```

### 27.3 Compatibility Matrix

For distributed Java systems:

| Producer | Consumer | Compatibility Rule |
|---|---|---|
| REST API | Frontend | additive fields safe |
| Event producer | Event consumer | old consumer ignores unknown fields |
| DB writer | DB reader | schema expand first |
| Batch job | Online service | lock/resource contention controlled |

Pipeline cannot solve incompatible design, but it can enforce compatibility checks.

---

## 28. Handling Monorepo vs Polyrepo

### 28.1 Monorepo

Kelebihan:

- atomic changes across modules;
- shared versioning;
- easier refactoring;
- centralized pipeline rules.

Kekurangan:

- pipeline complexity;
- build time;
- ownership boundaries;
- accidental broad impact.

Useful patterns:

- changed-path detection;
- module-level build;
- shared pipeline templates;
- release manifest generation.

### 28.2 Polyrepo

Kelebihan:

- independent service lifecycle;
- clear ownership;
- smaller pipeline;
- decoupled release cadence.

Kekurangan:

- cross-service compatibility harder;
- release coordination external;
- duplicated pipeline config;
- dependency version drift.

Useful patterns:

- contract tests;
- central pipeline library;
- service catalog;
- release orchestration repo.

---

## 29. Pipeline Reliability Engineering

A CI/CD pipeline is also software.

It has failure modes.

### 29.1 Common Pipeline Failure Modes

| Failure | Impact |
|---|---|
| Flaky tests | Teams ignore pipeline |
| Mutable tags | Wrong version deployed |
| Shared runner pollution | Non-reproducible builds |
| Credential leakage | Security incident |
| Cache corruption | Strange build failures |
| Plugin/action update | Sudden breakage |
| Missing timeout | Hung release |
| No retry boundaries | Unsafe repeated side effects |
| Manual hotfix outside pipeline | Drift |
| Weak logs | RCA impossible |

### 29.2 Pipeline Timeout Strategy

Every stage needs timeout.

Example:

| Stage | Timeout |
|---|---:|
| Compile | 10 min |
| Unit test | 15 min |
| Integration test | 30 min |
| Image build | 20 min |
| Security scan | 20 min |
| Deploy rollout | 15 min |
| Smoke test | 10 min |
| Canary analysis | 30–60 min |

Timeout should reflect expected behavior.

No timeout means failed deploy can hang forever.

### 29.3 Retry Strategy

Retry only safe operations.

Safe to retry:

- dependency download;
- image pull;
- read-only health check;
- idempotent apply;
- log query.

Dangerous to retry blindly:

- database migration;
- external notification;
- payment/financial transaction;
- data backfill;
- destructive cleanup;
- traffic switch.

### 29.4 Pipeline Observability

Pipeline itself should expose:

- stage duration;
- failure rate;
- flaky test count;
- deployment frequency;
- lead time;
- change failure rate;
- MTTR;
- approval wait time;
- rollback frequency.

These are engineering system metrics, not vanity metrics.

---

## 30. Handling Java Runtime Upgrade in CI/CD

Java 8 to 25 makes runtime upgrade a deployment concern.

Pipeline should separate:

```text
source compatibility
binary compatibility
runtime compatibility
deployment compatibility
```

### 30.1 Runtime Upgrade Pipeline

Example Java 11 -> 21:

```text
Stage 1: Build with old JDK, test with old JDK
Stage 2: Build with old JDK, test with new JDK
Stage 3: Build with new JDK --release old target if needed
Stage 4: Build and run with new JDK in non-prod
Stage 5: Container image uses new JRE
Stage 6: Canary with new runtime
Stage 7: Full promotion
```

### 30.2 Multi-JDK Matrix for Upgrade

```yaml
strategy:
  matrix:
    java: [11, 17, 21]
```

But do not blindly matrix every production app forever.

Use matrix with purpose:

- migration assessment;
- library compatibility;
- supported customer runtime;
- framework upgrade.

### 30.3 JDK Drift Detection

Pipeline should fail if runtime is not expected.

Example startup log:

```text
Java runtime: Eclipse Adoptium 21.0.7+6
Expected major: 21
```

Deployment verification can query `/actuator/info` or a version endpoint.

---

## 31. Handling Emergency Releases

Emergency release path must exist before emergency happens.

### 31.1 Emergency Release Requirements

- explicit trigger condition;
- reduced but not zero validation;
- emergency approver;
- rollback plan;
- post-deployment verification;
- retrospective;
- evidence preserved.

### 31.2 Emergency Anti-Pattern

```text
SSH into prod.
Copy jar manually.
Restart.
Tell everyone later.
```

This may be necessary in extreme outage, but should be treated as break-glass with follow-up reconciliation.

### 31.3 Break-Glass Pattern

```text
Emergency deploy via controlled pipeline path
  -> label as emergency
  -> require incident ID
  -> capture approver
  -> skip only non-critical gates
  -> run focused verification
  -> open follow-up task to restore normal governance
```

Emergency process must be faster, not invisible.

---

## 32. Compliance and Audit Evidence

For regulated systems, pipeline must produce evidence.

### 32.1 Evidence Checklist

For each production deployment:

```text
Application name
Version
Artifact checksum/image digest
Git commit
Commit range
Pull request links
Approver
Change request ID
Deployment time
Deployment actor/system
Environment
Runtime version
Config version
Database migration version
Test results
Security scan result
SBOM
Rollback target
Verification result
Incident/exception note if any
```

### 32.2 Evidence Storage

Evidence can be stored in:

- release management system;
- artifact repository metadata;
- Git tag/release;
- deployment record table;
- CI artifact archive;
- change request attachment;
- observability annotation;
- incident/change calendar.

### 32.3 Audit Trail Principle

```text
A release should be reconstructable after six months without relying on someone's memory.
```

If not, pipeline governance is weak.

---

## 33. Deployment Checklist for Java CI/CD

### 33.1 Build Checklist

- [ ] JDK version pinned.
- [ ] Build tool version pinned/wrapper used.
- [ ] Dependency repositories controlled.
- [ ] Artifact version generated consistently.
- [ ] Build metadata embedded.
- [ ] Tests executed and archived.
- [ ] Artifact checksum generated.
- [ ] SBOM generated.
- [ ] Artifact published immutably.

### 33.2 Image Checklist

- [ ] Base image pinned by digest or controlled tag.
- [ ] Non-root user.
- [ ] No secrets in image layers.
- [ ] JVM options explicit.
- [ ] Health endpoint available.
- [ ] CA cert/truststore handled.
- [ ] Image scanned.
- [ ] Image signed if policy requires.
- [ ] Digest recorded.

### 33.3 Deployment Checklist

- [ ] Manifest versioned in Git.
- [ ] Image digest used.
- [ ] Resource request/limit defined.
- [ ] Probes defined and realistic.
- [ ] Graceful shutdown configured.
- [ ] Config/secret references valid.
- [ ] DB migration plan clear.
- [ ] Rollout strategy selected.
- [ ] Rollback target known.

### 33.4 Verification Checklist

- [ ] Rollout complete.
- [ ] Readiness stable.
- [ ] Smoke test pass.
- [ ] Synthetic transaction pass.
- [ ] Error rate normal.
- [ ] Latency normal.
- [ ] No restart loop.
- [ ] Logs clean from fatal errors.
- [ ] DB migration version correct.
- [ ] Release evidence stored.

---

## 34. Anti-Pattern Catalog

### 34.1 `latest` in Production

```yaml
image: my-service:latest
```

Problem:

- not reproducible;
- rollback unclear;
- audit weak;
- node cache can run different image.

Use digest.

### 34.2 Build During Deployment

```text
ssh prod
mvn package
java -jar target/app.jar
```

Problem:

- prod becomes build environment;
- dependency drift;
- no evidence;
- no repeatability.

### 34.3 Different Artifact per Environment

Problem:

- UAT evidence not valid for PROD;
- config accidentally baked in;
- runtime behavior differs.

### 34.4 Manual Manifest Mutation

Problem:

- Git drift;
- audit gap;
- overwritten by GitOps;
- unknown production state.

### 34.5 Pipeline Has Production Superpowers

Problem:

- CI compromise becomes production compromise;
- broad credential scope;
- hard to audit.

Prefer scoped credentials, environment gates, OIDC/workload identity, GitOps pull model.

### 34.6 Deployment Without Verification

```text
kubectl apply succeeded = release successful
```

Wrong.

Apply only means desired state was submitted.

It does not mean app is healthy.

### 34.7 Rollback Assumed but Untested

If rollback is not tested, rollback is a hope.

### 34.8 Pipeline Logic Hidden in One Giant Script

```bash
./deploy-everything.sh
```

Problem:

- no stage visibility;
- poor evidence;
- hard to retry safely;
- hidden side effects.

### 34.9 Secrets in Build Args

Docker build args can leak into image history/layers.

Avoid secrets in build unless using secure build secret mechanism and verified no persistence.

### 34.10 Approval Without Context

Approver cannot make informed decision without release summary, risk, evidence, and rollback plan.

---

## 35. Advanced Mental Models

### 35.1 Pipeline as State Machine

A deployment pipeline is a state machine:

```text
CandidateCreated
  -> Validated
  -> Published
  -> PromotedToEnvironment
  -> Deployed
  -> Verified
  -> Released
  -> Observed
  -> Closed
```

Failure states:

```text
ValidationFailed
PublishFailed
ApprovalRejected
DeploymentFailed
VerificationFailed
RollbackStarted
RollbackFailed
ManualInterventionRequired
```

Top-level invariant:

```text
No production state transition without evidence and recovery path.
```

### 35.2 Artifact Identity vs Environment State

Artifact identity:

```text
What is this deployable thing?
```

Environment state:

```text
Where is it running, with what config, at what traffic percentage?
```

Do not mix them.

Same artifact can run in multiple environments with different config.

Different artifact should not pretend to be same release.

### 35.3 Promotion vs Reproduction

Promotion moves known artifact forward.

Reproduction rebuilds something similar.

For production-grade systems, prefer promotion.

### 35.4 Deployment Is a Distributed Transaction Without ACID

Deploying a distributed Java system touches:

- code;
- config;
- database;
- cache;
- queues;
- traffic routing;
- scheduler;
- secrets;
- observability;
- humans.

There is no global transaction.

Therefore you need:

- compatibility;
- idempotency;
- staged rollout;
- verification;
- compensating action;
- rollback/roll-forward design.

---

## 36. Example Production Release Record

```yaml
release_id: ACEAS-2026-06-18-001
application: case-service
environment: production
version: 1.12.3-build.481-git.a1b2c3d
artifact:
  type: container-image
  image: registry.company.com/aceas/case-service@sha256:abc123
  sbom: sbom-case-service-1.12.3.cdx.json
source:
  repository: git.company.com/aceas/case-service
  commit: a1b2c3d4
  pull_requests:
    - PR-1821
    - PR-1822
runtime:
  java: 21.0.7-temurin
  base_image: eclipse-temurin:21-jre
  platform: kubernetes
change:
  change_request: CR-2026-0618-001
  approved_by:
    - product-owner
    - tech-lead
    - release-manager
database:
  migration_required: true
  migration_tool: flyway
  before_version: 2026.06.10.001
  after_version: 2026.06.18.001
  destructive_change: false
deployment:
  strategy: rolling
  max_unavailable: 0
  max_surge: 1
  started_at: 2026-06-18T13:00:00+07:00
  completed_at: 2026-06-18T13:08:00+07:00
verification:
  rollout_status: success
  smoke_test: success
  synthetic_case_flow: success
  error_rate_gate: pass
  latency_gate: pass
rollback:
  previous_version: 1.12.2-build.470-git.e5f6a7b
  previous_image: registry.company.com/aceas/case-service@sha256:def456
  app_rollback_safe: true
  db_rollback_required: false
status: verified
```

This record is boring.

Boring is good.

Boring release evidence means production change is controlled.

---

## 37. Practical Design Exercise

Design a CI/CD pipeline for this scenario:

```text
Java 21 Spring Boot service
Oracle database
RabbitMQ consumer
Redis cache
Kubernetes deployment
Flyway migration
UAT approval required
Production CR required
Rolling update allowed only if DB change is backward-compatible
```

A strong answer:

```text
1. PR validation:
   - compile
   - unit test
   - contract test
   - static analysis

2. Main build:
   - build JAR
   - integration tests with Oracle-compatible test DB or approved substitute
   - RabbitMQ/Redis integration test
   - build image
   - scan image
   - generate SBOM
   - publish image digest

3. Migration validation:
   - restore baseline schema
   - run Flyway migration
   - verify old app compatibility if rolling update needed
   - verify new app compatibility

4. DEV deploy:
   - automatic GitOps manifest update
   - smoke test

5. UAT promotion:
   - PR to UAT manifest
   - QA approval
   - deploy
   - synthetic user journey

6. PROD promotion:
   - CR with release record
   - approval gate
   - pre-deploy dependency check
   - run expand migration if needed
   - deploy rolling maxUnavailable=0
   - drain/verify consumers
   - post-deploy smoke/synthetic/metrics
   - attach evidence

7. Rollback:
   - app rollback to previous digest if migration expand-only
   - disable feature flag if needed
   - queue consumer compatibility verified
```

Weak answer:

```text
Use Jenkins to build Docker and kubectl apply.
```

The difference is not tool knowledge.

The difference is system thinking.

---

## 38. Top 1% Engineer Heuristics

A strong deployment engineer asks:

1. Is the artifact immutable?
2. Is the deployed artifact exactly the tested artifact?
3. Can I identify source commit from a running process?
4. Can I identify runtime version from release evidence?
5. Can old and new versions coexist?
6. Is schema migration backward-compatible?
7. Are jobs/consumers safe during rollout?
8. Are secrets/config separate from image?
9. Is the production manifest versioned?
10. Is approval tied to evidence?
11. Can rollback actually work, or only theoretically?
12. What signal proves deployment health?
13. What happens if deployment stops halfway?
14. What happens if pipeline retries this step?
15. What happens if the CI system is compromised?
16. What evidence will an auditor/RCA need later?
17. What part of this process depends on one person’s memory?
18. What is the blast radius of a bad release?
19. Does the pipeline encode safety, or just speed?
20. Can a new team member run this release safely using the system?

---

## 39. Summary

CI/CD for Java deployment is not just a build script.

It is a release-control system that connects:

- source;
- artifact;
- runtime;
- config;
- security;
- database;
- environment;
- traffic;
- verification;
- rollback;
- governance;
- evidence.

The strongest principle:

```text
Build once. Promote immutably. Deploy declaratively. Verify objectively. Roll back deliberately. Record evidence.
```

For Java 8–25, CI/CD must also control runtime drift, artifact style, classpath/module behavior, JVM options, container image, database migration, and operational verification.

A pipeline that deploys quickly but cannot answer “what exactly changed, why is it safe, and how do we recover?” is not mature.

A mature pipeline makes change boring.

And boring production change is one of the clearest signs of elite engineering.

---

## 40. References

- GitHub Docs — Managing environments for deployment: https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment
- GitHub Docs — Deployments and environments: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- Jenkins Documentation — Pipeline: https://www.jenkins.io/doc/book/pipeline/
- Jenkins Documentation — Recording tests and artifacts: https://www.jenkins.io/doc/pipeline/tour/tests-and-artifacts/
- Argo CD Documentation — Declarative GitOps CD for Kubernetes: https://argo-cd.readthedocs.io/
- Argo CD Documentation — GitOps source of truth and application sync: https://argo-cd.readthedocs.io/en/stable/
- Kubernetes Documentation — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Documentation — Performing a rolling update: https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/
- Docker Documentation — Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Open Container Initiative — Image specification annotations: https://github.com/opencontainers/image-spec/blob/main/annotations.md
- CycloneDX — SBOM standard: https://cyclonedx.org/
- SPDX — Software Bill of Materials standard: https://spdx.dev/

---

## Status Series

Selesai: Part 23 dari 35.

Belum selesai. Lanjut ke:

**Part 24 — Supply Chain Security for Java Deployment**
