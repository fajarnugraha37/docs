# learn-git-mastery-for-java-engineers-part-025.md

# Part 025 — Monorepo, Polyrepo, dan Repository Architecture

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 025 / 032  
> **Topik:** Mendesain repository sebagai boundary arsitektur: monorepo, polyrepo, build graph, ownership, CI, scaling, dan governance  
> **Target pembaca:** Java software engineer, tech lead, dan architect yang perlu mengambil keputusan repository layout untuk monolith, modular monolith, microservices, platform libraries, dan regulated systems  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Repository bukan sekadar tempat menyimpan kode.

Repository adalah boundary untuk:

- ownership;
- review;
- CI/CD;
- release;
- versioning;
- access control;
- dependency management;
- audit trail;
- build performance;
- refactoring;
- discoverability;
- operational responsibility;
- architecture enforcement.

Keputusan monorepo vs polyrepo tidak bisa dijawab dengan slogan:

```text
Monorepo selalu lebih baik.
Polyrepo selalu lebih scalable.
Microservice harus satu repo per service.
Shared code harus submodule.
Semua harus di satu repo supaya gampang refactor.
```

Semua itu terlalu dangkal.

Pertanyaan yang benar:

```text
Perubahan apa yang perlu atomic?
Boundary ownership apa yang nyata?
Bagaimana sistem dirilis?
Bagaimana dependency version dikendalikan?
Bagaimana CI tahu apa yang perlu diuji?
Bagaimana incident forensic dilakukan?
Bagaimana access control dan compliance diterapkan?
Bagaimana developer menemukan dan mengubah kode dengan aman?
```

Untuk Java engineer, repository architecture sering terlihat dalam bentuk:

```text
single Maven multi-module repo
Gradle multi-project repo
monorepo microservices
polyrepo services + shared libraries
platform repo + app repos
contract repo + generated clients
deployment repo terpisah
```

Part ini akan memberi mental model untuk memilih dan mengevaluasi desain tersebut.

---

## 1. Definisi Dasar

## 1.1 Monorepo

Monorepo adalah satu repository yang menyimpan banyak project/module/service/library.

Contoh:

```text
company-platform/
  services/
    case-service/
    audit-service/
    notification-service/
  libs/
    workflow-core/
    security-spring/
    observability/
  contracts/
    case-api/
    audit-events/
  build-logic/
  deploy/
```

Satu commit graph.

Satu repository.

Banyak deployable atau library.

## 1.2 Polyrepo

Polyrepo adalah banyak repository terpisah, biasanya satu repo per service/library/component.

Contoh:

```text
case-service.git
audit-service.git
notification-service.git
workflow-core.git
security-spring.git
case-api-contract.git
deployment-config.git
```

Masing-masing punya commit graph, CI, release, ownership sendiri.

## 1.3 Multi-Repo

Istilah umum untuk banyak repo. Polyrepo adalah bentuk multi-repo yang sengaja dirancang sebagai architecture/ownership model.

## 1.4 Modular Monolith Repo

Satu repo berisi satu deployable monolith, tetapi internalnya modular:

```text
case-platform/
  modules/
    case-domain/
    workflow-domain/
    audit/
    notification/
    web-api/
    persistence/
```

Ini bukan microservices monorepo, tetapi tetap repository architecture penting.

## 1.5 Platform Repository

Repo yang berisi shared build logic, libraries, conventions, templates, dan tooling.

Contoh:

```text
java-platform/
  bom/
  gradle-plugins/
  observability/
  security/
  testing/
```

---

## 2. Repository adalah Boundary Sosial dan Teknis

Repository boundary biasanya memengaruhi:

```text
Siapa yang bisa push?
Siapa yang review?
Apa yang bisa diubah dalam satu PR?
Apa yang diuji CI?
Apa yang dirilis?
Apa yang di-version?
Apa yang bisa diakses oleh tim lain?
Apa yang muncul dalam audit trail?
```

Karena itu, repository bukan hanya struktur folder.

Repository adalah kontrak organisasi.

Jika repo boundary tidak sesuai architecture boundary, muncul friction:

```text
Perubahan kecil perlu 5 PR di 5 repo.
Atau sebaliknya, satu PR menyentuh 20 service tanpa owner jelas.
```

Repo architecture yang baik membuat perubahan yang sering terjadi bersama menjadi mudah, dan perubahan yang harus independen tetap terisolasi.

---

## 3. Pertanyaan Fundamental

Sebelum memilih monorepo/polyrepo, jawab:

```text
1. Apa unit deployable?
2. Apa unit ownership?
3. Apa unit release?
4. Apa unit review?
5. Apa unit build/test?
6. Apa unit access control?
7. Apa dependency boundary?
8. Apa perubahan yang harus atomic?
9. Apa perubahan yang harus independen?
10. Seberapa sering cross-component refactor terjadi?
11. Apakah compatibility antar component stabil?
12. Apakah tim punya tooling untuk repo besar?
13. Apakah compliance membutuhkan separation tertentu?
14. Apakah build graph bisa dipahami dan dioptimalkan?
15. Apakah incident forensic lintas component mudah?
```

Jawaban ini lebih penting daripada preferensi tooling.

---

## 4. Monorepo: Keunggulan

## 4.1 Atomic Change Lintas Module

Jika perubahan API internal membutuhkan update library dan consumer, monorepo memungkinkan satu commit/PR:

```text
libs/workflow-core changes API
services/case-service updates usage
tests updated together
```

Ini kuat untuk refactor besar.

## 4.2 Single Source of Truth

Semua kode dalam satu graph:

```text
commit X = consistent snapshot of many modules
```

Ini membantu:

- global refactor;
- audit;
- dependency visibility;
- version alignment;
- consistency.

## 4.3 Shared Tooling

Satu build convention:

```text
Java version
formatter
static analysis
test conventions
dependency versions
CI workflow
```

Lebih mudah distandardisasi.

## 4.4 Easier Cross-Code Search

Developer bisa:

```bash
git grep 'CaseEscalatedEvent'
```

di seluruh ecosystem.

## 4.5 Simplified Local Discovery

Engineer baru tidak harus clone 20 repo untuk memahami flow.

## 4.6 Consistent Dependency Upgrade

Upgrade Spring Boot/Java version bisa dilakukan lintas modules dalam satu PR atau batch.

## 4.7 Better Refactorability

Rename package, move class, update contract bisa dilakukan secara atomik.

---

## 5. Monorepo: Risiko dan Biaya

## 5.1 Repository Size

Repo besar bisa lambat:

- clone lama;
- checkout berat;
- status lambat;
- IDE indexing besar;
- CI mahal;
- history besar;
- file count banyak.

Mitigasi:

- sparse checkout;
- partial clone;
- build graph;
- affected testing;
- repo maintenance;
- module boundaries.

## 5.2 CI Complexity

Tidak realistis menjalankan semua test untuk setiap perubahan jika repo besar.

Butuh:

```text
affected project detection
dependency graph
test selection
remote cache
build cache
parallelization
ownership-aware pipeline
```

Tanpa itu, monorepo jadi lambat.

## 5.3 Ownership Blur

Satu repo bisa membuat orang merasa semua boleh diubah sembarangan.

Butuh:

- CODEOWNERS;
- module ownership;
- review rules;
- architecture tests;
- directory boundaries;
- contribution guidelines.

## 5.4 Access Control Sulit

Git access biasanya per repo, bukan per directory.

Jika ada code sangat sensitif, monorepo bisa sulit.

## 5.5 Release Independence

Banyak service dalam satu repo tidak harus release bareng, tetapi pipeline harus mendukung independent deploy.

Jika tidak, monorepo berubah menjadi release train berat.

## 5.6 Build Coupling Tersembunyi

Monorepo bisa membuat dependency antar module tumbuh tanpa sadar.

Butuh dependency rules.

---

## 6. Polyrepo: Keunggulan

## 6.1 Ownership Jelas

Satu repo satu service/library/team.

Mudah menjawab:

```text
Siapa owner repo ini?
Siapa reviewer?
Siapa deploy?
```

## 6.2 Independent Release

Setiap service/library bisa punya lifecycle sendiri.

Cocok untuk microservices yang benar-benar independen.

## 6.3 Access Control Sederhana

Repo private/permission per component.

## 6.4 CI Sederhana per Repo

Pipeline kecil:

```text
build this service
test this service
publish this artifact
deploy this service
```

## 6.5 Smaller Clone/IDE Scope

Developer clone hanya repo relevan.

## 6.6 Strong Version Boundary

Library harus publish artifact.

Consumer depend pada version.

Ini memaksa contract lebih eksplisit.

---

## 7. Polyrepo: Risiko dan Biaya

## 7.1 Cross-Repo Changes Mahal

Perubahan satu konsep bisa butuh banyak PR:

```text
contract repo
client repo
service repo
consumer repo
deployment repo
```

Atomicity hilang.

## 7.2 Version Drift

Service memakai versi dependency berbeda.

Bisa sehat, bisa chaos.

## 7.3 Discoverability Turun

Sulit mencari semua penggunaan suatu event/class/config.

## 7.4 Duplicated Tooling

Setiap repo punya CI config, formatter, build convention.

Tanpa platform tooling, drift cepat terjadi.

## 7.5 Integration Testing Lebih Kompleks

Satu repo pass, sistem gagal saat digabung.

Butuh:

- contract tests;
- integration environment;
- consumer-driven contracts;
- release compatibility matrix.

## 7.6 Dependency Release Overhead

Setiap shared library change perlu publish, update, consume.

Jika ini terlalu sering, polyrepo friction tinggi.

---

## 8. Decision Matrix Monorepo vs Polyrepo

| Faktor | Condong Monorepo | Condong Polyrepo |
|---|---|---|
| Cross-component changes sering atomic | Ya | Tidak |
| Services release sangat independen | Bisa, tapi perlu tooling | Ya |
| Access control per component penting | Sulit | Ya |
| Shared platform kuat | Ya | Bisa |
| Tooling affected CI tersedia | Ya | Tidak wajib |
| Repo sangat besar tanpa tooling | Risiko | Lebih aman |
| Team ownership sangat terpisah | Butuh CODEOWNERS | Natural |
| Global refactor sering | Ya | Mahal |
| Strict version boundary diperlukan | Bisa | Natural |
| Contract stability tinggi | Bisa | Ya |
| Banyak shared internal libraries aktif | Ya | Bisa menyakitkan |
| Regulated separation per system | Tergantung | Sering lebih mudah |
| Developer perlu holistic search | Ya | Sulit |

Tidak ada jawaban universal.

---

## 9. Unit of Change vs Unit of Deployment

Kesalahan umum:

```text
Karena microservice deploy terpisah, maka harus repo terpisah.
```

Tidak selalu.

Pertanyaan:

```text
Apakah unit perubahan sama dengan unit deployment?
```

Bisa saja:

```text
Monorepo dengan banyak deployable independen.
```

Atau:

```text
Polyrepo dengan satu deployable per repo.
```

Unit deployment adalah runtime artifact.

Repository adalah source/change boundary.

Mereka bisa sama, tetapi tidak wajib.

Jika banyak perubahan melintasi service secara atomic, monorepo bisa masuk akal meskipun deployable banyak.

Jika services jarang berubah bersama dan punya owner/release berbeda, polyrepo bisa lebih baik.

---

## 10. Unit of Ownership

Repo sering menjadi proxy ownership.

Tetapi dalam monorepo, ownership harus dipetakan ke directory/module.

Contoh:

```text
/services/case-service/        @case-team
/services/audit-service/       @audit-team
/libs/workflow-core/           @platform-team
/build-logic/                  @developer-platform
/contracts/case-api/           @case-platform
```

Gunakan CODEOWNERS:

```text
/services/case-service/ @acme/case-team
/libs/workflow-core/ @acme/platform-team
/build-logic/ @acme/dev-platform
```

Polyrepo ownership biasanya lebih natural, tetapi tetap perlu CODEOWNERS jika repo besar.

---

## 11. Java Monorepo dengan Maven Multi-Module

Contoh:

```text
case-platform/
  pom.xml
  modules/
    case-domain/
      pom.xml
    workflow-core/
      pom.xml
    audit-core/
      pom.xml
    case-service/
      pom.xml
```

Parent `pom.xml`:

```xml
<modules>
  <module>modules/case-domain</module>
  <module>modules/workflow-core</module>
  <module>modules/audit-core</module>
  <module>modules/case-service</module>
</modules>
```

Build selected module with dependencies:

```bash
./mvnw -pl modules/case-service -am test
```

Meaning:

```text
-pl = project list
-am = also make required modules
```

Useful for monorepo.

Risks:

- parent POM grows huge;
- dependencyManagement too broad;
- module boundaries weak;
- build all can be slow;
- Maven reactor complexity.

---

## 12. Java Monorepo dengan Gradle Multi-Project

Example:

```text
settings.gradle.kts
build.gradle.kts
services/
  case-service/
  audit-service/
libs/
  workflow-core/
  security-spring/
```

`settings.gradle.kts`:

```kotlin
include(":services:case-service")
include(":services:audit-service")
include(":libs:workflow-core")
include(":libs:security-spring")
```

Build one module:

```bash
./gradlew :services:case-service:test
```

Build affected dependency automatically if project dependencies are declared.

Gradle strengths:

- build cache;
- configuration cache;
- composite builds;
- convention plugins;
- task graph;
- parallel execution.

Risks:

- misconfigured allprojects/subprojects;
- slow configuration if poorly designed;
- hidden coupling;
- build logic complexity.

---

## 13. Build Graph is Architecture Signal

In a healthy repo, dependency graph should make sense.

Bad:

```text
case-domain depends on case-service
workflow-core depends on web-api
audit-core depends on case-service implementation
```

Good direction:

```text
domain -> no infrastructure dependency
application -> domain
web/api -> application
persistence -> domain/application ports
service -> modules/libs
```

Use tools:

- Maven dependency tree;
- Gradle dependencies;
- ArchUnit;
- jdeps;
- build graph visualizer;
- custom dependency rules.

Git repo architecture and code architecture reinforce each other.

---

## 14. Affected Build/Test

Large monorepo needs affected logic.

Question:

```text
Given changed files, what modules need build/test?
```

Simple mapping:

```text
Change in services/case-service -> test case-service
Change in libs/workflow-core -> test workflow-core and consumers
Change in build-logic -> test many/all
Change in pom/build.gradle -> test affected/all
Change in docs -> docs checks only
```

Maven simple:

```bash
./mvnw -pl modules/case-service -am test
```

Gradle simple:

```bash
./gradlew :services:case-service:test
```

Advanced:

- build graph analysis;
- Nx/Bazel/Pants-like tooling;
- Gradle Enterprise/Test Distribution;
- custom CI path filters;
- dependency impact mapping.

Without affected testing, monorepo CI becomes bottleneck.

---

## 15. CI Path Filters: Useful but Dangerous

Example:

```yaml
if changed path services/case-service/**
then run case-service pipeline
```

Danger:

```text
Change in libs/workflow-core affects case-service but path filter misses it.
```

Better:

```text
Path filter + dependency graph.
```

Risky files should trigger broad build:

```text
pom.xml
settings.gradle
build.gradle
gradle/libs.versions.toml
build-logic/**
.gitattributes
Docker base image
shared CI workflow
```

Rule:

```text
Path filters are optimization.
Correctness must account for dependency graph.
```

---

## 16. Sparse Checkout

Sparse checkout lets developer check out only parts of a repository.

Useful in large monorepo.

Example:

```bash
git sparse-checkout init --cone
git sparse-checkout set services/case-service libs/workflow-core build-logic
```

This reduces working tree size.

But note:

```text
Sparse checkout does not change repository history by itself.
It changes what files appear in working tree.
```

Good for:

- large monorepo;
- developers focused on one service;
- CI jobs building one module.

Caveats:

- build may require files outside sparse set;
- tooling/IDE may expect root files;
- scripts must tolerate sparse checkout;
- path assumptions matter.

---

## 17. Partial Clone

Partial clone can avoid downloading all blobs initially.

Example:

```bash
git clone --filter=blob:none <repo>
```

Git downloads blobs on demand.

Useful for large repos.

Caveats:

- server support required;
- network access needed for missing blobs;
- some tooling may trigger many downloads;
- CI cache strategy matters.

Sparse checkout and partial clone can be combined.

---

## 18. Shallow Clone

Shallow clone:

```bash
git clone --depth=1 <repo>
```

Useful in CI for speed.

But breaks or limits:

- `git describe`;
- full history;
- bisect;
- changelog generation;
- merge-base computation in some workflows;
- versioning from tags;
- archaeology.

For release pipelines, be careful.

If you need tags/history:

```bash
git fetch --unshallow
git fetch --tags
```

CI optimization must not break build semantics.

---

## 19. Repository Size and Performance

Symptoms of oversized repo:

- `git status` slow;
- clone slow;
- IDE indexing hours;
- CI checkout expensive;
- binary files in history;
- generated files tracked unnecessarily;
- huge test fixtures;
- many branches/tags;
- packfiles huge.

Mitigation:

- remove large files from future commits;
- Git LFS for legitimate large files;
- history cleanup if necessary;
- sparse checkout;
- partial clone;
- repo maintenance;
- avoid committing build outputs;
- split repo only if boundary supports it.

Part 026 and 030 cover large files and maintenance deeper.

---

## 20. Access Control and Compliance

Polyrepo advantage:

```text
Access can be granted per repo.
```

Monorepo challenge:

```text
Git hosting usually grants repo-level access.
```

If code/data requires strict separation:

- security-sensitive module;
- licensed third-party source;
- client-specific implementation;
- regulated component with restricted access;

polyrepo may be necessary.

Some platforms support CODEOWNERS/review protection, but that is not the same as read access control.

Question:

```text
Is review control enough, or must read access be restricted?
```

If read access must be restricted, monorepo may not work.

---

## 21. Auditability

Monorepo audit:

```text
One commit can show cross-system change.
```

Good for:

- traceability;
- atomic history;
- consistent release evidence.

Polyrepo audit:

```text
Need correlate commits across repos.
```

Requires:

- ticket IDs;
- release manifests;
- artifact versions;
- deployment metadata;
- SBOM;
- changelog;
- traceability system.

Both can be auditable if process is strong.

Monorepo makes code-level correlation easier.

Polyrepo makes component boundary/release audit clearer.

---

## 22. Release Strategy in Monorepo

Monorepo does not imply single release.

Options:

## 22.1 Independent Service Release

Each service has its own pipeline:

```text
services/case-service changed -> build/deploy case-service
```

## 22.2 Release Train

All components release together periodically.

Useful for tightly coupled platform.

## 22.3 Library Versioning Inside Monorepo

Internal libraries may not need external version if only used within repo.

But if published externally, they need versions.

## 22.4 Tagging

Tag options:

```text
v2026.06.0
case-service-v1.8.0
workflow-core-v2.4.1
```

Multi-component tags require convention.

---

## 23. Release Strategy in Polyrepo

Each repo typically has:

- tags;
- changelog;
- version;
- CI pipeline;
- artifact publishing;
- deployment pipeline.

Benefits:

```text
Version boundary natural.
```

Costs:

```text
Cross-repo release coordination.
```

Need:

- dependency update automation;
- compatibility tests;
- release notes;
- artifact promotion;
- environment manifest.

---

## 24. Environment Repository Pattern

Some orgs keep deployment config separately:

```text
case-service.git
audit-service.git
env-prod.git
env-staging.git
```

Or:

```text
platform-deploy.git
  environments/
    dev/
    staging/
    prod/
```

Benefits:

- separation of application source and deployment state;
- GitOps compatibility;
- environment audit;
- controlled promotion.

Risks:

- app change and deploy config change split across repos;
- version correlation needed;
- PR coordination;
- config drift.

Need traceability:

```text
app commit -> image tag -> deployment config commit -> environment
```

---

## 25. Microservices: One Repo per Service?

Common rule:

```text
One microservice, one repo.
```

This works if services are truly autonomous.

But if services are tightly coupled, one repo per service creates coordination overhead.

Better question:

```text
Does this service have independent lifecycle, ownership, and contract?
```

If yes, separate repo may fit.

If no, maybe:

- modular monolith;
- monorepo;
- merge service boundaries;
- redefine bounded context;
- improve contract.

Do not use repository split to pretend architecture is decoupled.

---

## 26. Modular Monolith Repository

For Java teams, modular monolith can be strong.

One deployable:

```text
case-platform.jar
```

Modules:

```text
case-domain
workflow
audit
notification
web
persistence
```

Benefits:

- simple deployment;
- strong transactional consistency;
- modular code;
- less distributed complexity;
- one repo natural;
- internal refactor easy.

Risks:

- module boundaries can erode;
- build can grow;
- runtime coupling;
- team ownership needs module boundaries;
- deployment always whole app.

Use ArchUnit/module tests to enforce boundaries.

Repository layout should reflect module architecture.

---

## 27. Shared Libraries in Polyrepo

If polyrepo has shared libraries, treat them as products.

Requirements:

```text
[ ] Owner.
[ ] Versioning.
[ ] Changelog.
[ ] Compatibility policy.
[ ] Tests.
[ ] Release pipeline.
[ ] Deprecation process.
[ ] Security scanning.
[ ] Dependency management.
```

Without this, shared library becomes hidden monolith.

If every service must update simultaneously, library boundary is unstable.

---

## 28. Contract Repositories

API/event/schema contracts can live in separate repos:

```text
case-api-contract.git
audit-events-contract.git
```

Pros:

- contract ownership clear;
- consumers can depend without service source;
- generated clients possible;
- compatibility tests.

Cons:

- source and contract changes split;
- PR coordination;
- versioning needed;
- contract drift risk.

Alternative in monorepo:

```text
contracts/case-api/
services/case-service/
```

Still version/publish contract if external consumers need stable artifact.

---

## 29. Build Logic Repository

Common in polyrepo:

```text
java-build-conventions.git
```

Used as:

- Gradle plugin;
- Maven parent POM;
- shared GitHub Actions workflow;
- template repo.

Benefits:

- consistency across repos;
- central updates;
- less duplication.

Risks:

- breaking change affects many repos;
- versioning needed;
- bootstrap complexity.

In monorepo, build logic can be local:

```text
build-logic/
```

But still needs ownership.

---

## 30. Repository Templates vs Shared Build Logic

Template:

```text
New repo starts with copied config.
```

Shared build logic:

```text
Repos depend on versioned build convention.
```

Template drift happens quickly.

Better:

- template for initial skeleton;
- shared build plugin for ongoing conventions;
- automated update bot;
- CI reusable workflows.

For Java:

- Gradle convention plugins;
- Maven parent POM/BOM;
- corporate starter parent;
- reusable GitHub workflow.

---

## 31. Git Branching Strategy and Repo Architecture

Monorepo branch:

```text
One branch contains all modules.
```

Feature branch can touch many modules.

Polyrepo branch:

```text
Feature may need coordinated branches across repos.
```

Examples:

```text
case-service: feature/CASE-123
workflow-core: feature/CASE-123
contract: feature/CASE-123
```

Harder to coordinate.

Release branches:

Monorepo:

```text
release/2026.06 includes many components.
```

Polyrepo:

```text
release/1.8 per service/library.
```

Branching strategy must match repository architecture.

---

## 32. CODEOWNERS and Review Routing

Monorepo CODEOWNERS example:

```text
/services/case-service/ @acme/case-team
/services/audit-service/ @acme/audit-team
/libs/security-spring/ @acme/security-platform
/build-logic/ @acme/dev-platform
/contracts/ @acme/api-governance
```

Benefits:

- review routing;
- ownership clarity;
- governance;
- risk control.

Limitations:

- not access control;
- can be bypassed if branch rules weak;
- ownership file can become outdated.

CI can validate CODEOWNERS coverage.

---

## 33. Architecture Enforcement

Repository layout alone does not enforce architecture.

Use:

- ArchUnit tests;
- Maven enforcer;
- Gradle dependency rules;
- module visibility conventions;
- package boundary tests;
- CODEOWNERS;
- CI checks;
- static analysis;
- dependency graph checks.

Example ArchUnit invariant:

```text
Domain module must not depend on web or persistence implementation.
```

Example Gradle rule:

```text
services may depend on libs, but libs may not depend on services.
```

Without enforcement, monorepo can become big ball of mud.

---

## 34. Java Package Naming and Repo Layout

Bad:

```text
com.acme.common
com.acme.util
```

Too broad.

Better:

```text
com.acme.caseflow.domain
com.acme.caseflow.application
com.acme.caseflow.persistence
com.acme.platform.security
```

Repo layout and package structure should align enough to aid navigation.

Avoid:

- module path says one thing, package says another;
- circular dependencies;
- generic `common`;
- infrastructure leaking into domain.

---

## 35. Repository Layout Examples

## 35.1 Modular Monolith Maven

```text
case-platform/
  pom.xml
  modules/
    case-domain/
    case-application/
    case-persistence/
    case-web/
    audit/
    notification/
  src/
    assembly/
  docs/
  scripts/
```

## 35.2 Gradle Microservices Monorepo

```text
platform/
  settings.gradle.kts
  build-logic/
  services/
    case-service/
    audit-service/
    notification-service/
  libs/
    workflow-core/
    security-spring/
    observability/
  contracts/
    case-api/
    audit-events/
  deploy/
```

## 35.3 Polyrepo

```text
case-service.git
audit-service.git
notification-service.git
workflow-core.git
security-spring.git
case-api-contract.git
java-platform-bom.git
deployment-config.git
```

## 35.4 Hybrid

```text
business-platform-monorepo.git
  services and libs owned by one domain group

shared-platform-repos:
  security-spring.git
  observability.git
  java-platform-bom.git
```

Hybrid is common and often practical.

---

## 36. Hybrid Repository Architecture

Many real systems are hybrid:

```text
Domain monorepo per bounded context.
Platform libraries in separate repos.
Deployment config separate.
Contract artifacts published.
```

Example:

```text
enforcement-platform.git
  case-service
  workflow-service
  enforcement-domain-lib
  audit-adapter

platform-security.git
platform-observability.git
api-contracts.git
environment-config.git
```

This can balance:

- atomic domain changes;
- independent platform ownership;
- deployment governance;
- access control.

Do not force pure monorepo/polyrepo ideology.

---

## 37. Repository Boundary and Bounded Context

If using Domain-Driven Design, repo boundary may follow bounded context.

Example:

```text
case-management
enforcement-action
licensing
notification
identity
```

If two modules are in same bounded context and change together often, same repo may help.

If they are separate bounded contexts with stable contracts, separate repos may help.

But DDD boundary is not automatically repo boundary.

Consider:

- team ownership;
- deployment;
- data ownership;
- compliance;
- contract stability;
- change frequency.

---

## 38. Repo Boundary and Database Boundary

If two services share database tables, separate repos do not make them independent.

Repo split can hide coupling.

Questions:

```text
Can service A deploy without service B?
Can schema migration be coordinated safely?
Does one repo own migration?
Are migrations in app repo or db repo?
Can rollback be done independently?
```

If shared DB forces coordinated changes, monorepo or modular monolith may be more honest.

---

## 39. Repo Boundary and API Contract

If service consumers depend on API, contract must be versioned and tested.

Polyrepo needs strong contract discipline:

- OpenAPI;
- protobuf;
- AsyncAPI;
- consumer-driven contract tests;
- backward compatibility checks;
- generated clients;
- deprecation policy.

Monorepo can make breaking changes easier to catch if consumers are inside repo, but external consumers still need versioning.

---

## 40. Repo Boundary and Incident Response

During incident, you need answer:

```text
What changed?
Where?
Which service?
Which library?
Which deployment?
Which config?
Which dependency?
```

Monorepo:

```bash
git log good..bad -- services/case-service libs/workflow-core
```

Polyrepo:

```text
Need deployment manifest with repo+commit+artifact versions.
```

For polyrepo incident readiness, maintain:

- deployment metadata;
- image labels;
- build provenance;
- artifact version;
- commit SHA;
- dependency versions;
- release notes.

---

## 41. Repo Boundary and Rollback

Monorepo rollback can be tricky if one commit changed many components but only one service is bad.

Options:

- revert commit and redeploy affected service;
- patch service;
- feature flag;
- selective deploy.

Polyrepo rollback simpler per service artifact if boundaries clean.

But if bug in shared dependency version used by many services, rollback still coordinated.

Rollback strategy should influence repo architecture.

---

## 42. Repo Boundary and Compliance

Regulated systems may require:

- segregation of duties;
- review evidence;
- change ticket linkage;
- deployment approval;
- traceability;
- restricted access;
- audit logs;
- release baseline.

Repo choices affect evidence.

Monorepo can show one atomic change with broad impact.

Polyrepo can isolate approval per component.

If legal/regulatory access restriction applies, repo-level access may force polyrepo.

If audit wants cross-system traceability, monorepo or strong release manifest helps.

---

## 43. Naming Repositories

Good repo names:

```text
case-service
audit-service
workflow-core
case-api-contract
java-platform-bom
deployment-config
```

Bad:

```text
backend
common
utils
new-service
service2
misc
platform-old
```

Repo name should communicate:

- domain;
- role;
- deployable/library/contract;
- ownership if needed.

Avoid organizational names that become outdated.

---

## 44. Repository README as Contract

Each repo should answer:

```text
What is this?
Who owns it?
How to build?
How to test?
How to run locally?
How to release?
How to deploy?
What are dependencies?
What Java version?
What generated code policy?
What branching strategy?
What support/on-call path?
```

For monorepo root README, include:

- repo layout;
- module ownership;
- build commands;
- affected test strategy;
- contribution rules;
- CODEOWNERS;
- release model.

Docs are part of repository architecture.

---

## 45. Repository Creation Checklist

Before creating a new repo:

```text
[ ] Why not existing repo?
[ ] What is ownership?
[ ] What is deployable/artifact?
[ ] What is release strategy?
[ ] What are dependencies?
[ ] What contract does it expose?
[ ] What CI baseline?
[ ] What access control?
[ ] What secrets/config policy?
[ ] What naming convention?
[ ] What lifecycle expectation?
[ ] What archive/deprecation plan?
```

Repo proliferation without governance creates entropy.

---

## 46. Repository Split Checklist

Before splitting repo:

```text
[ ] What boundary is being separated?
[ ] Does dependency direction become clear?
[ ] How will history be preserved?
[ ] How will builds change?
[ ] How will releases change?
[ ] How will consumers depend on extracted code?
[ ] Is artifact publishing ready?
[ ] Are CI pipelines ready?
[ ] Are CODEOWNERS/access rules ready?
[ ] How will open PRs be handled?
[ ] How will tags/releases map?
[ ] What migration plan for developers?
```

Technical extraction:

- `git filter-repo`;
- subtree split;
- history rewrite;
- archive old paths;
- update references.

Part 028 covers history rewrite/migration.

---

## 47. Repository Merge Checklist

Before merging repos into monorepo:

```text
[ ] Why merge?
[ ] Are histories preserved?
[ ] Are tags namespaced?
[ ] Are build systems compatible?
[ ] Are module paths clear?
[ ] Are CI pipelines unified?
[ ] Are owners mapped?
[ ] Are access restrictions compatible?
[ ] Are dependencies converted to project dependencies?
[ ] Are release strategies preserved?
[ ] Are docs updated?
[ ] Are local dev workflows ready?
```

Merging repos is organizational change, not just Git command.

---

## 48. Tags in Monorepo

Tagging strategies:

## 48.1 Global Tags

```text
v2026.06.0
```

Good for release train.

## 48.2 Component Tags

```text
case-service-v1.8.0
workflow-core-v2.4.1
```

Good for independent release.

## 48.3 Hybrid

```text
platform-v2026.06.0
case-service-v1.8.0
```

Need clear convention.

Avoid ambiguous tags:

```text
v1.2.0
```

if multiple components release independently.

---

## 49. Versioning in Monorepo

Options:

1. One version for all modules.
2. Independent versions per component.
3. Calendar version release train.
4. Internal modules unversioned, deployables versioned.
5. Published libraries versioned, internal services image-tagged by commit.

Choose based on release model.

For Java libraries published outside repo, versioning still matters even in monorepo.

---

## 50. Dependency Between Modules in Monorepo

Prefer project dependencies for internal modules.

Gradle:

```kotlin
dependencies {
    implementation(project(":libs:workflow-core"))
}
```

Maven reactor:

```xml
<dependency>
    <groupId>com.acme</groupId>
    <artifactId>workflow-core</artifactId>
    <version>${project.version}</version>
</dependency>
```

For published artifacts, monorepo build can publish after tests.

Avoid depending on previously published artifact of same repo if project dependency is intended.

But for release simulation, artifact-level integration tests may still matter.

---

## 51. Dependency Between Repos in Polyrepo

Use artifact dependencies.

Avoid:

- branch dependencies;
- source clone during build;
- SNAPSHOT in release;
- manual jar check-in;
- submodule without reason.

Use:

- fixed versions;
- BOM/version catalog;
- lockfile;
- Renovate/Dependabot;
- compatibility tests;
- artifact repository.

---

## 52. Tooling for Large Java Repos

Potential tools/patterns:

- Gradle build cache;
- Gradle configuration cache;
- Maven incremental build via reactor selection;
- Bazel/Pants/Buck for large polyglot monorepo;
- Nx for affected graph in polyglot repos;
- remote cache;
- test splitting;
- sparse checkout;
- partial clone;
- CODEOWNERS;
- ArchUnit;
- dependency graph checks.

Do not adopt heavy tooling without need.

But large monorepo without build intelligence is painful.

---

## 53. Repository Governance Model

A mature repository governance model defines:

```text
[ ] Repo creation policy.
[ ] Ownership model.
[ ] CODEOWNERS.
[ ] Branch protection.
[ ] Merge strategy.
[ ] Release tagging.
[ ] Dependency update policy.
[ ] Secret policy.
[ ] Generated code policy.
[ ] Archive/deprecation policy.
[ ] Access control.
[ ] CI baseline.
[ ] Documentation baseline.
```

This is especially important in enterprise/regulatory environments.

---

## 54. Common Anti-Patterns

## 54.1 Repo per Class/Library

Too granular.

Overhead dominates.

## 54.2 One Giant Repo Without Boundaries

Monorepo without ownership/build rules becomes big ball of mud.

## 54.3 Polyrepo Without Version Discipline

Every service depends on random SNAPSHOT.

## 54.4 Shared Common Dumping Ground

`common-utils` grows uncontrollably.

## 54.5 Deployment Config Untraceable

No link from source commit to deployed manifest.

## 54.6 CI Path Filters That Miss Shared Changes

False green.

## 54.7 Access Control Ignored

Sensitive code placed in repo readable by too many people.

## 54.8 Repository Split to Avoid Modular Design

Splitting repo does not create decoupling if code/data/contracts remain coupled.

## 54.9 Monorepo Chosen for Fashion

Without tooling and ownership, it fails.

## 54.10 Polyrepo Chosen Because “Microservices”

Repo boundary should follow actual autonomy, not architecture marketing.

---

## 55. Case Study 1 — Java Modular Monolith

Context:

```text
A regulatory case management platform has one deployable backend.
It has modules: case, workflow, audit, notification, reporting.
```

Recommended:

```text
Single repo, Maven/Gradle multi-module.
Strong module boundaries.
ArchUnit tests.
One CI pipeline.
One deployment artifact.
```

Why:

- one deployable;
- changes often cross modules;
- transaction consistency important;
- easier audit;
- simpler release.

Avoid premature service/polyrepo split unless runtime autonomy is real.

---

## 56. Case Study 2 — Microservices with Shared Workflow Core

Context:

```text
10 services depend on workflow-core.
workflow-core changes monthly.
Backward compatibility mostly stable.
```

Recommended:

```text
workflow-core as artifact dependency.
Version with SemVer or calendar version.
Use BOM/version catalog.
Use dependency update automation.
Use compatibility tests.
```

Avoid:

```text
Submodule in every service.
```

Why:

- artifact boundary clearer;
- services release independently;
- submodule updates in 10 repos painful;
- Java ecosystem supports artifact dependencies.

---

## 57. Case Study 3 — Highly Coupled Services

Context:

```text
Every feature changes case-service, workflow-service, audit-service, and shared contracts together.
Separate repos cause constant synchronized PRs.
```

Possibilities:

1. Services are not truly independent; consider modular monolith.
2. Use monorepo for domain platform.
3. Improve API compatibility to reduce coupling.
4. Use contract-first backward-compatible rollout.
5. Use feature flags.

If coupling is real and justified, monorepo can reduce coordination pain.

If coupling is accidental, fix architecture, not just repo layout.

---

## 58. Case Study 4 — Sensitive Component

Context:

```text
Fraud detection rules are sensitive and only small team may read them.
Other services integrate via API.
```

Recommended:

```text
Separate repo with restricted access.
Published API/client artifact if needed.
Strong contract tests.
```

Monorepo may violate access constraints.

---

## 59. Case Study 5 — Platform Templates Across Many Repos

Context:

```text
50 Java services have duplicated Gradle config.
Updates are painful.
```

Recommended:

- shared Gradle convention plugin;
- version catalog/BOM;
- reusable CI workflow;
- template for new services;
- automated dependency/tooling updates.

Do not merge all repos only to share build config unless other forces justify monorepo.

---

## 60. Practical Decision Framework

Use this sequence:

```text
1. Identify deployables and libraries.
2. Map ownership.
3. Map change frequency between components.
4. Map release independence.
5. Map access control requirements.
6. Map dependency graph.
7. Identify cross-component atomic changes.
8. Identify tooling maturity.
9. Choose repo boundaries.
10. Define governance.
```

Heuristic:

```text
Change together often + same ownership + no strict access separation -> same repo/module may help.
Change independently + stable contract + separate ownership/release -> separate repo may help.
```

---

## 61. Review Checklist for Repository Architecture Proposal

```text
[ ] What problem does this repo structure solve?
[ ] What alternatives were considered?
[ ] What changes become easier?
[ ] What changes become harder?
[ ] How does CI scale?
[ ] How does release work?
[ ] How does ownership work?
[ ] How does access control work?
[ ] How do dependencies version?
[ ] How is incident forensic done?
[ ] How are tags named?
[ ] How are generated code/contracts handled?
[ ] How are shared libraries governed?
[ ] How are repo splits/merges handled later?
[ ] What is migration plan?
```

---

## 62. Latihan Praktis

## Latihan 1 — Map Current Repo Landscape

Buat tabel:

```text
Repo
Type: service/library/contract/deploy/config
Owner
Deployable?
Published artifact?
Main dependencies
Release cadence
Consumers
```

Cari repo yang tidak jelas perannya.

## Latihan 2 — Change Coupling Analysis

Ambil 10 feature terakhir.

Catat:

```text
Berapa repo tersentuh per feature?
Repo mana sering berubah bersama?
Apakah perubahan lintas repo bisa dibuat backward-compatible?
```

## Latihan 3 — Dependency Graph

Untuk Java project:

Maven:

```bash
./mvnw dependency:tree
```

Gradle:

```bash
./gradlew dependencies
```

Untuk monorepo, gambar module dependency.

Cari cycle/arah dependency aneh.

## Latihan 4 — CI Impact Analysis

Pilih perubahan di shared library.

Jawab:

```text
Test apa yang harus jalan?
Apakah CI saat ini menjalankannya?
Apakah path filter cukup?
```

## Latihan 5 — Incident Traceability

Ambil satu production deploy.

Jawab:

```text
Source commit?
Artifact version?
Dependency versions?
Deployment config commit?
Release tag?
PR/ticket?
```

Jika sulit, repo/release governance perlu diperbaiki.

---

## 63. Pertanyaan Reflektif

1. Apakah repo boundary Anda mencerminkan ownership nyata?
2. Apakah repo boundary mencerminkan deploy/release boundary?
3. Apakah cross-repo changes terlalu sering?
4. Apakah monorepo CI akan scale jika repo digabung?
5. Apakah polyrepo dependency versioning sehat?
6. Apakah shared libraries punya owner dan compatibility policy?
7. Apakah access control membutuhkan repo separation?
8. Apakah generated contracts versioned dengan baik?
9. Apakah incident forensic lintas repo mudah?
10. Apakah rollback path jelas?
11. Apakah CODEOWNERS akurat?
12. Apakah CI path filter memahami dependency graph?
13. Apakah repo creation dikendalikan?
14. Apakah ada repo zombie/unused?
15. Apakah repository architecture membantu atau melawan architecture sistem?

---

## 64. Mental Model Akhir

Repository architecture adalah desain sistem.

Monorepo memberi kekuatan:

```text
atomic change, global consistency, refactorability, discoverability.
```

Dengan biaya:

```text
scale, ownership, CI complexity, access control.
```

Polyrepo memberi kekuatan:

```text
autonomy, access separation, independent release, natural version boundary.
```

Dengan biaya:

```text
cross-repo coordination, version drift, duplicated tooling, integration complexity.
```

Keputusan yang matang bukan memilih label.

Keputusan yang matang adalah mencocokkan:

```text
change topology
ownership topology
deployment topology
dependency topology
compliance topology
tooling capability
```

Repository yang baik membuat perubahan benar menjadi mudah, perubahan berisiko menjadi terlihat, dan perubahan lintas boundary memiliki proses yang jelas.

---

## 65. Koneksi ke Part Berikutnya

Part ini membahas repository architecture dan scaling secara struktural.

Part berikutnya akan mendalami salah satu masalah teknis terbesar pada repository besar:

```text
learn-git-mastery-for-java-engineers-part-026.md
```

Topik:

```text
Large Files, Binary Assets, Git LFS, dan Repository Bloat
```

Kita akan membahas:

- kenapa Git buruk untuk binary besar;
- repository bloat;
- Git LFS;
- binary jar checked-in;
- test fixtures besar;
- artifact repository vs Git;
- cleaning large files;
- policy binary di Java repo;
- Nexus/Artifactory/GitHub Packages;
- dampak ke clone, CI, dan developer workflow.

---

## 66. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: sparse checkout, partial clone, submodules, tags, branch management
- Maven multi-module/reactor build conventions
- Gradle multi-project builds, build cache, version catalogs, composite builds
- Praktik umum monorepo/polyrepo architecture, CI affected testing, CODEOWNERS, artifact versioning, dependency governance, and release traceability
- Praktik engineering untuk Java modular monolith, microservices, platform libraries, contract repositories, and regulated delivery governance

---

## 67. Status Seri

```text
Progress: 025 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-026.md
```

Topik:

```text
Large Files, Binary Assets, Git LFS, dan Repository Bloat
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 024 — Submodules, Subtree, dan Multi-Repository Dependency](./learn-git-mastery-for-java-engineers-part-024.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 026 — Large Files, Binary Assets, Git LFS, dan Repository Bloat](./learn-git-mastery-for-java-engineers-part-026.md)
