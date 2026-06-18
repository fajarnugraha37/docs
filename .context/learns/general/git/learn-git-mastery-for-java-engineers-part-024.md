# learn-git-mastery-for-java-engineers-part-024.md

# Part 024 — Submodules, Subtree, dan Multi-Repository Dependency

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 024 / 032  
> **Topik:** Mengelola dependency source code lintas repository dengan Git submodule, subtree, vendor code, artifact dependency, monorepo, dan polyrepo  
> **Target pembaca:** Java software engineer yang bekerja dengan banyak repository, shared library, microservices, SDK, generated client, platform code, dan dependency governance  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Banyak sistem Java modern tidak hidup dalam satu repository sederhana.

Anda bisa punya:

```text
case-service
audit-service
notification-service
workflow-core
common-security
common-observability
api-contracts
generated-clients
deployment-config
```

Lalu muncul pertanyaan:

```text
Bagaimana repository A bergantung pada kode dari repository B?
```

Pilihan umum:

1. Maven/Gradle dependency via artifact repository.
2. Git submodule.
3. Git subtree.
4. Vendor code/copy source.
5. Monorepo.
6. Polyrepo dengan release discipline.
7. Generated code dari contract/schema.
8. Package registry/internal platform artifact.

Tidak ada jawaban universal.

Tetapi banyak tim memakai submodule atau subtree tanpa memahami konsekuensi, lalu repository menjadi sulit di-clone, sulit di-update, sulit di-review, dan rawan mismatch versi.

Mental model utama:

```text
Dependency antar repo adalah masalah versioning dan ownership,
bukan hanya masalah “bagaimana supaya folder repo lain muncul di sini”.
```

Untuk Java engineer, pilihan paling sehat sering kali:

```text
Jika dependency adalah library runtime/build-time,
rilis sebagai artifact Maven/Gradle dengan versioning jelas.
```

Submodule/subtree cocok untuk kasus tertentu, tetapi bukan default.

---

## 1. Masalah yang Ingin Diselesaikan

Misalkan `case-service` membutuhkan kode dari `workflow-core`.

Pertanyaan:

```text
Apakah case-service harus membawa source workflow-core?
Atau cukup memakai artifact workflow-core versi tertentu?
```

Jika memakai artifact:

```xml
<dependency>
    <groupId>com.acme.platform</groupId>
    <artifactId>workflow-core</artifactId>
    <version>2.4.1</version>
</dependency>
```

Jika memakai Gradle:

```kotlin
implementation("com.acme.platform:workflow-core:2.4.1")
```

Jika memakai submodule:

```text
case-service/
  libs/workflow-core/   -> Git submodule pointing to repo workflow-core at commit X
```

Jika memakai subtree:

```text
case-service/
  libs/workflow-core/   -> copied history/content from workflow-core inside case-service repo
```

Jika vendor:

```text
case-service/
  vendor/workflow-core/ -> copied code, maybe no history link
```

Masing-masing menjawab pertanyaan berbeda:

```text
Apakah saya butuh source code lokal?
Apakah saya butuh independent release?
Apakah saya butuh atomic change lintas module?
Apakah saya butuh fixed version?
Apakah saya butuh upstream sync?
Apakah ownership sama?
Apakah dependency binary cukup?
Apakah repository harus bisa build offline?
Apakah audit perlu melihat source dependency?
```

---

## 2. Prinsip Dasar: Dependency Harus Punya Boundary

Dependency yang sehat punya boundary:

```text
Provider owns code.
Consumer depends on versioned contract.
Changes flow through release/versioning.
```

Dependency yang tidak sehat:

```text
Consumer bebas mengubah source provider diam-diam.
Version tidak jelas.
Build tergantung branch floating.
Tidak ada compatibility policy.
Tidak ada release artifact.
Tidak ada owner jelas.
```

Untuk Java, boundary natural adalah artifact:

```text
groupId:artifactId:version
```

Plus contract:

- public API;
- semantic versioning;
- changelog;
- compatibility tests;
- published artifact;
- source/javadoc artifact;
- dependency metadata;
- SBOM if needed.

Jika Anda menarik source repo lain langsung ke repo consumer, Anda melemahkan boundary itu kecuali ada alasan kuat.

---

## 3. Decision Matrix Ringkas

| Strategy | Cocok Ketika | Hindari Ketika |
|---|---|---|
| Maven/Gradle artifact | Library punya release/version jelas | Butuh edit source dependency bersamaan setiap saat |
| Git submodule | Perlu pin repo lain pada commit tertentu dengan history terpisah | Tim tidak disiplin update/init submodule |
| Git subtree | Ingin vendor source dengan history dan tanpa nested repo | Upstream sync sering/kompleks |
| Vendor copy | Source kecil/stabil, jarang update | Kode aktif berkembang dan butuh upstream sync |
| Monorepo | Perlu atomic change lintas banyak module dan shared tooling | Ownership/release sangat independen dan repo sangat besar tanpa tooling |
| Polyrepo | Service/library independen, release terpisah | Perubahan lintas repo sering harus atomic |
| Generated code | Contract/schema adalah source of truth | Generated output diedit manual |
| Git LFS/artifact store | Large binary fixture/model | Source code dependency aktif |

---

## 4. Maven/Gradle Artifact Dependency: Default Sehat untuk Java

Untuk Java library, artifact dependency adalah pilihan paling idiomatis.

Provider repo:

```text
workflow-core/
  src/main/java
  build.gradle
  publishes com.acme:workflow-core:2.4.1
```

Consumer repo:

```text
case-service/
  build.gradle
  depends on com.acme:workflow-core:2.4.1
```

Kelebihan:

- version eksplisit;
- build cepat;
- boundary jelas;
- CI sederhana;
- dependency resolution familiar;
- compatible dengan Maven Central/Nexus/Artifactory/GitHub Packages;
- audit artifact lebih jelas;
- source jar bisa dipublish;
- transitive dependency dikelola build tool.

Kekurangan:

- perlu release/publish workflow;
- perubahan lintas repo tidak atomic;
- debugging source dependency perlu source attach atau checkout terpisah;
- SNAPSHOT/dynamic versions bisa membuat build tidak reproducible;
- dependency hell jika versioning buruk.

Rule:

```text
Untuk reusable Java library, publish artifact.
Jangan pakai submodule hanya agar tidak membuat release process.
```

---

## 5. Artifact Dependency dan Reproducibility

Bad:

```kotlin
implementation("com.acme:workflow-core:latest.release")
implementation("com.acme:workflow-core:2.+")
```

Risk:

- build hari ini berbeda dari build besok;
- CI dan local berbeda;
- bisect sulit;
- incident forensic buruk;
- release tidak reproducible.

Better:

```kotlin
implementation("com.acme:workflow-core:2.4.1")
```

Dengan Gradle lockfile:

```text
gradle.lockfile
```

Dengan Maven dependency management/BOM:

```xml
<dependencyManagement>
  ...
</dependencyManagement>
```

Untuk enterprise:

```text
Every deployable artifact should be traceable to exact dependency versions.
```

---

## 6. SNAPSHOT Dependency

Maven SNAPSHOT:

```xml
<version>2.4.2-SNAPSHOT</version>
```

Berguna untuk development cepat, tetapi berbahaya untuk release.

Masalah:

- mutable;
- artifact bisa berubah tanpa version berubah;
- build reproducibility turun;
- cache behavior bisa membingungkan;
- incident forensic sulit.

Policy:

```text
SNAPSHOT boleh untuk local/integration development.
Release/deployable artifact tidak boleh bergantung pada SNAPSHOT.
```

Jika butuh konsumsi perubahan dependency sebelum release:

- publish prerelease version;
- use commit-based version;
- use branch builds with unique version;
- use composite build for local dev;
- use monorepo if changes often atomic.

---

## 7. Gradle Composite Build sebagai Alternatif Local Development

Gradle mendukung composite builds:

```text
case-service/
workflow-core/
```

`settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

includeBuild("../workflow-core")
```

Dengan ini, local build `case-service` bisa memakai source `workflow-core` tanpa submodule.

Kelebihan:

- bagus untuk local development lintas repo;
- tidak mengubah dependency model release;
- artifact dependency tetap dipakai di CI/release;
- bisa debug source dependency.

Kekurangan:

- Gradle-specific;
- butuh layout lokal;
- tidak cocok sebagai reproducibility mechanism utama;
- perlu dokumentasi.

Mental model:

```text
Composite build adalah local developer convenience,
bukan pengganti release/versioning.
```

---

## 8. Maven Local Install untuk Development

Maven workflow:

```bash
cd workflow-core
./mvnw install

cd ../case-service
./mvnw test
```

Consumer memakai version:

```xml
<version>2.4.2-SNAPSHOT</version>
```

Kelebihan:

- sederhana;
- familiar;
- tidak perlu submodule;
- cocok untuk local test.

Kekurangan:

- local `.m2` state tersembunyi;
- engineer lain tidak reproduce kecuali install juga;
- CI harus punya artifact;
- SNAPSHOT mutable.

Gunakan untuk local development, bukan release traceability.

---

## 9. Git Submodule: Mental Model

Git submodule adalah repository Git di dalam repository Git lain.

Parent repo menyimpan:

```text
path -> commit SHA dari child repo
```

Bukan menyimpan isi child repo sebagai normal file.

Contoh:

```text
case-service/
  libs/workflow-core/  (submodule)
```

Parent commit menyimpan pointer:

```text
libs/workflow-core @ a13f9e2
```

File khusus:

```text
.gitmodules
```

Contoh:

```ini
[submodule "libs/workflow-core"]
    path = libs/workflow-core
    url = git@github.com:acme/workflow-core.git
```

Submodule bukan branch pointer.

Submodule pin ke commit tertentu.

Ini penting.

---

## 10. Menambahkan Submodule

```bash
git submodule add git@github.com:acme/workflow-core.git libs/workflow-core
git commit -m "Add workflow-core submodule"
```

Akan menambahkan:

```text
.gitmodules
libs/workflow-core  (gitlink entry)
```

Cek:

```bash
git status
git diff --cached
```

Clone repo dengan submodule:

```bash
git clone --recurse-submodules git@github.com:acme/case-service.git
```

Jika sudah clone tanpa submodule:

```bash
git submodule update --init --recursive
```

---

## 11. Update Submodule

Masuk submodule:

```bash
cd libs/workflow-core
git fetch
git checkout <new-commit-or-tag>
cd ../..
git status
```

Parent repo akan melihat:

```text
modified: libs/workflow-core (new commits)
```

Commit pointer update:

```bash
git add libs/workflow-core
git commit -m "Update workflow-core submodule"
```

Poin penting:

```text
Mengupdate submodule berarti mengubah commit pointer di parent repo.
```

Bukan otomatis mengambil latest.

---

## 12. Submodule Detached HEAD

Setelah `git submodule update`, submodule sering berada di detached HEAD.

Artinya:

```text
Submodule checkout commit spesifik yang parent repo pin.
```

Jika Anda ingin mengembangkan submodule:

```bash
cd libs/workflow-core
git checkout main
git pull
```

Tetapi hati-hati:

- parent repo belum otomatis pin ke commit baru;
- perubahan submodule harus di-commit di submodule repo;
- lalu parent repo harus update pointer.

Workflow benar:

```bash
cd libs/workflow-core
git checkout -b fix/CASE-123
# edit
git commit
git push

cd ../..
git add libs/workflow-core
git commit -m "Point workflow-core submodule to CASE-123 fix"
```

---

## 13. Submodule Clone Failure Mode

Masalah umum:

```text
Developer clone repo, folder submodule kosong.
```

Fix:

```bash
git submodule update --init --recursive
```

Atau clone:

```bash
git clone --recurse-submodules <url>
```

Masalah lain:

```text
CI gagal karena tidak checkout submodule.
```

Fix CI checkout config:

- GitHub Actions checkout `submodules: recursive`;
- GitLab `GIT_SUBMODULE_STRATEGY: recursive`;
- Jenkins checkout submodules option.

Submodule menambah complexity ke semua tooling.

---

## 14. Submodule Access Problem

Parent repo public/private, submodule private.

Developer/CI punya akses parent tetapi tidak submodule.

Clone gagal.

Pertanyaan governance:

```text
Apakah semua consumer repo punya hak akses dependency source?
Apakah CI deploy key punya akses submodule?
Apakah submodule URL SSH/HTTPS cocok?
Apakah fork contributor bisa build?
```

Artifact dependency sering lebih mudah karena permission artifact repository bisa dikelola terpisah.

---

## 15. Submodule Branch Tracking

Submodule bisa dikonfigurasi track branch:

```bash
git submodule add -b main <url> libs/workflow-core
```

Update remote branch:

```bash
git submodule update --remote
```

Tetapi parent tetap akan commit SHA baru.

Jangan salah paham:

```text
Submodule tidak otomatis ikut latest main saat normal checkout.
Parent repo menyimpan commit exact.
```

Branch tracking hanya membantu update command memilih branch mana.

---

## 16. Kapan Submodule Cocok?

Submodule bisa cocok jika:

```text
[ ] Anda perlu menyertakan repo lain sebagai source dependency.
[ ] Anda ingin history child tetap terpisah.
[ ] Anda perlu pin exact commit.
[ ] Update dependency jarang dan eksplisit.
[ ] Tim paham submodule workflow.
[ ] CI/tooling mendukung recursive checkout.
[ ] Permission access jelas.
[ ] Parent tidak perlu sering mengubah child.
```

Contoh valid:

- theme/documentation dependency;
- shared test corpus;
- external open-source code pinned;
- firmware/spec repo pinned;
- repository yang sengaja composed dari beberapa independent repos;
- platform repo yang agregasi subrepos tertentu.

Untuk Java library aktif yang sering berubah bersama service, submodule sering menyakitkan.

---

## 17. Kapan Submodule Buruk?

Submodule buruk jika:

```text
[ ] Developer sering lupa update/init.
[ ] Dependency berubah hampir setiap PR.
[ ] Perlu atomic commit lintas parent-child.
[ ] CI sering gagal karena checkout.
[ ] Permission submodule rumit.
[ ] Tim tidak paham detached HEAD.
[ ] Consumer ingin “latest” otomatis.
[ ] Build tool Java sudah bisa resolve artifact.
[ ] Submodule dipakai untuk menghindari release process.
```

Anti-pattern:

```text
"Kita belum punya artifact repository, jadi pakai submodule saja."
```

Itu biasanya technical debt.

---

## 18. Git Subtree: Mental Model

Git subtree memasukkan isi repository lain ke dalam directory parent, tetapi bukan nested Git repo.

Contoh:

```text
case-service/
  vendor/workflow-core/
```

Isi `workflow-core` menjadi file normal dalam parent repo.

Subtree bisa mempertahankan kemampuan sync dengan upstream melalui Git history.

Kelebihan dibanding submodule:

- clone biasa langsung dapat semua file;
- tidak perlu recursive checkout;
- tidak ada detached HEAD nested;
- CI lebih sederhana;
- consumer bisa melihat/edit file normal.

Kekurangan:

- parent repo menyimpan semua content/history yang diimport;
- sync upstream/downstream bisa rumit;
- history bisa membesar;
- ownership boundary kabur;
- update subtree butuh discipline.

---

## 19. Subtree Basic Commands

Add subtree:

```bash
git subtree add --prefix=vendor/workflow-core git@github.com:acme/workflow-core.git main --squash
```

Pull update:

```bash
git subtree pull --prefix=vendor/workflow-core git@github.com:acme/workflow-core.git main --squash
```

Push changes back upstream:

```bash
git subtree push --prefix=vendor/workflow-core git@github.com:acme/workflow-core.git main
```

`--squash` keeps parent history smaller but loses detailed upstream history in parent.

Without `--squash`, history is richer but repo can grow.

---

## 20. Kapan Subtree Cocok?

Subtree cocok jika:

```text
[ ] Anda ingin vendor source code ke repo.
[ ] Clone harus sederhana.
[ ] Dependency update eksplisit tapi tidak terlalu sering.
[ ] Tidak ingin nested Git complexity.
[ ] Anda mungkin perlu patch lokal.
[ ] Upstream sync masih perlu.
```

Contoh:

- vendored third-party code kecil;
- shared config templates;
- internal library kecil yang belum layak artifact;
- generated SDK source snapshot;
- docs/theme.

Tidak ideal untuk dependency aktif yang sering berubah dua arah.

---

## 21. Submodule vs Subtree

| Aspek | Submodule | Subtree |
|---|---|---|
| Clone default | Butuh recursive/init | Langsung ada |
| Parent menyimpan isi child | Tidak, hanya pointer | Ya |
| History child | Terpisah | Bisa digabung/squash |
| Update | Update pointer | Pull subtree |
| Developer friction | Tinggi | Medium |
| CI setup | Perlu submodule config | Biasa |
| Boundary | Jelas terpisah | Lebih kabur |
| Patch lokal | Di child repo | Di parent path |
| Repo size parent | Kecil | Lebih besar |
| Cocok untuk | Pin exact external repo | Vendor source |

Rule sederhana:

```text
Submodule = pointer ke repo lain.
Subtree = copy/sync repo lain ke dalam repo ini.
```

---

## 22. Vendor Code / Copy-Paste Source

Vendor code berarti source dependency disalin ke repo tanpa mekanisme Git khusus.

Contoh:

```text
vendor/some-lib/
```

Kelebihan:

- sederhana;
- tidak perlu submodule/subtree;
- build offline;
- bisa patch lokal cepat;
- tidak bergantung remote repo saat clone.

Kekurangan:

- upstream tracking manual;
- license risk;
- security updates mudah terlewat;
- diff update sulit;
- ownership kabur;
- duplicate code;
- no version boundary.

Cocok hanya jika:

```text
[ ] Code kecil.
[ ] Update sangat jarang.
[ ] Source upstream stabil.
[ ] License jelas.
[ ] Ada README menjelaskan origin/version.
```

Tambahkan:

```text
vendor/some-lib/README.md
```

Isi:

```text
Origin:
Version/commit:
License:
Local changes:
Update process:
```

---

## 23. Monorepo sebagai Alternatif

Monorepo menyimpan banyak module/service/library dalam satu repository.

Kelebihan:

- atomic changes lintas module;
- refactor besar lebih mudah;
- single commit graph;
- shared tooling;
- dependency source langsung tersedia;
- review lintas boundary;
- consistent CI conventions.

Kekurangan:

- repo bisa besar;
- CI butuh affected-build intelligence;
- ownership perlu jelas;
- release independent bisa kompleks;
- access control per module sulit;
- tool/performance challenge;
- noisy changes jika governance buruk.

Monorepo cocok jika:

```text
[ ] Banyak perubahan lintas module harus atomic.
[ ] Shared platform kuat.
[ ] Tooling CI/build bisa handle scale.
[ ] Organisasi siap dengan ownership dan conventions.
```

Part 025 akan membahas monorepo/polyrepo lebih dalam.

---

## 24. Polyrepo sebagai Alternatif

Polyrepo berarti setiap service/library punya repo sendiri.

Kelebihan:

- ownership jelas;
- release independent;
- repo kecil;
- access control mudah;
- CI sederhana per repo;
- service autonomy.

Kekurangan:

- perubahan lintas repo tidak atomic;
- dependency versioning penting;
- integration testing lebih sulit;
- duplicated tooling;
- discoverability turun;
- cross-repo refactor mahal.

Polyrepo cocok jika:

```text
[ ] Services independent.
[ ] Release cadence berbeda.
[ ] Library punya artifact version.
[ ] Contract testing matang.
[ ] Platform tooling mengurangi duplikasi.
```

Dalam polyrepo Java, artifact dependency biasanya lebih sehat daripada submodule.

---

## 25. Generated Code sebagai Dependency Strategy

Kadang repo tidak bergantung pada source code repo lain, tetapi pada contract.

Contoh:

```text
api-contracts repo contains openapi.yaml
case-client generated from openapi.yaml
```

Pilihan:

1. Publish OpenAPI spec as artifact.
2. Generate client in consumer repo.
3. Publish generated client as Maven artifact.
4. Use submodule for contract repo.
5. Copy spec manually.

Best practice sering:

```text
Contract is source of truth.
Generated client is build artifact or published artifact.
```

Untuk Java:

```text
com.acme.contracts:case-api-spec:1.4.0
com.acme.clients:case-client:1.4.0
```

Ini lebih traceable daripada submodule jika release discipline ada.

---

## 26. Multi-Repo Dependency dan Version Drift

Masalah umum:

```text
case-service memakai workflow-core 2.4.1
audit-service memakai workflow-core 2.2.0
notification-service memakai workflow-core 2.5.0
```

Apakah ini masalah?

Tergantung.

Jika library menjaga backward compatibility, tidak masalah.

Jika shared protocol/schema berubah, drift bisa berbahaya.

Mitigasi:

- BOM/platform dependency;
- version catalog;
- Renovate/Dependabot;
- compatibility tests;
- release notes;
- deprecation policy;
- contract tests;
- dependency dashboard.

Git bukan satu-satunya alat.

Dependency governance membutuhkan build tooling dan process.

---

## 27. Maven BOM untuk Version Alignment

BOM:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.platform</groupId>
      <artifactId>acme-platform-bom</artifactId>
      <version>2026.06.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Consumer:

```xml
<dependency>
  <groupId>com.acme.platform</groupId>
  <artifactId>workflow-core</artifactId>
</dependency>
```

Version controlled by BOM.

Kelebihan:

- aligned dependency set;
- easier upgrade;
- platform release;
- less version drift.

Kekurangan:

- platform release overhead;
- consumers less flexible;
- BOM compatibility must be managed.

---

## 28. Gradle Version Catalog / Platform

Version catalog:

```toml
[versions]
workflow = "2.4.1"

[libraries]
workflow-core = { module = "com.acme.platform:workflow-core", version.ref = "workflow" }
```

Gradle platform:

```kotlin
dependencies {
    implementation(platform("com.acme.platform:acme-platform-bom:2026.06.0"))
    implementation("com.acme.platform:workflow-core")
}
```

Track:

```text
gradle/libs.versions.toml
```

This is often better than submodule for Java dependency alignment.

---

## 29. Composite Change Across Repos

Problem:

```text
Need to change workflow-core API and case-service consumer together.
```

Options:

## 29.1 Backward-Compatible Change

Best:

1. Add new API in workflow-core, keep old API.
2. Release workflow-core 2.5.0.
3. Update case-service.
4. Later remove old API in major version.

## 29.2 Branch Pairing

Use branches in both repos:

```text
workflow-core: feature/CASE-123-new-policy
case-service: feature/CASE-123-use-new-policy
```

Publish snapshot/prerelease artifact.

## 29.3 Local Composite Build

Use Gradle composite or Maven local install for development.

## 29.4 Monorepo

If this happens constantly, maybe boundary is wrong.

## 29.5 Submodule

Possible but often not ideal. You still need commit/push child then update parent pointer.

---

## 30. Atomicity Problem

Submodule does not truly solve atomicity across repos.

Sequence:

```text
1. Commit change in workflow-core.
2. Push workflow-core.
3. Update submodule pointer in case-service.
4. Commit case-service.
```

There is no single commit across both repositories.

Parent commit points to child commit, but child repo evolves independently.

If you need truly atomic cross-module changes, monorepo is stronger.

---

## 31. CI with Submodule

GitHub Actions:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

GitLab:

```yaml
variables:
  GIT_SUBMODULE_STRATEGY: recursive
```

Jenkins:

```text
Enable recursive submodule update in checkout config.
```

Also consider credentials:

- SSH key access to submodule;
- deploy token;
- HTTPS token;
- private submodule access.

CI failure modes:

```text
Submodule commit not found.
Permission denied.
Submodule URL uses SSH but CI only has HTTPS token.
Nested submodule missing.
Shallow clone missing needed commit.
```

---

## 32. CI with Artifact Dependency

CI simpler:

```bash
./mvnw test
```

or:

```bash
./gradlew test
```

But requires artifact repository access.

CI failure modes:

```text
Artifact not published.
Repository credentials missing.
SNAPSHOT changed.
Dependency resolution cache stale.
Private registry unavailable.
```

Mitigation:

- publish immutable versions;
- use internal mirror/cache;
- lock dependencies;
- fail fast on SNAPSHOT in release builds;
- record dependency versions in build metadata.

---

## 33. Security and Supply Chain Considerations

Source dependencies and artifact dependencies have different risks.

Submodule/subtree:

- source visible;
- can audit commit;
- but may bypass artifact signing/scanning;
- nested repo access risk;
- pinned commit not necessarily release tag.

Artifact dependency:

- can use signed artifacts;
- vulnerability scanning integrated;
- SBOM easier;
- repository manager policy;
- but source may be separate;
- transitive dependencies matter.

Vendor copy:

- security updates manual;
- license tracking manual;
- provenance can be unclear.

For regulated/high-assurance systems, prefer traceable artifacts:

```text
source commit -> build -> signed artifact -> dependency version -> deployment
```

---

## 34. License Considerations

Copying source via subtree/vendor can bring license obligations.

Questions:

```text
What is upstream license?
Can we redistribute?
Do we need notice file?
Do we modify source?
Do we publish derivative work?
Is license compatible with product?
```

Artifact dependency also has license concerns, but tools can scan dependencies.

Vendor source makes responsibility more direct.

Always document origin/license for vendored code.

---

## 35. Submodule and Release Tags

If using submodule, pin to release tag commit when possible.

Bad:

```text
submodule points to random commit on main
```

Better:

```text
submodule points to commit tagged v2.4.1
```

Parent commit message:

```text
Update workflow-core submodule to v2.4.1
```

This improves traceability.

Check submodule status:

```bash
git submodule status
```

Output:

```text
 a13f9e2 libs/workflow-core (v2.4.1)
```

If no tag, output may be less meaningful.

---

## 36. Submodule Commands Cheat Sheet

Initialize/update:

```bash
git submodule update --init --recursive
```

Clone with submodule:

```bash
git clone --recurse-submodules <repo>
```

Show status:

```bash
git submodule status
```

Update all to configured remote branch:

```bash
git submodule update --remote --recursive
```

Sync URLs:

```bash
git submodule sync --recursive
```

Remove submodule high-level steps:

```bash
git submodule deinit -f path/to/submodule
git rm -f path/to/submodule
rm -rf .git/modules/path/to/submodule
git commit -m "Remove submodule"
```

Be careful removing submodules; stale `.git/modules` state can confuse.

---

## 37. Submodule Status Symbols

`git submodule status` may show:

```text
 a13f9e2 libs/workflow-core
-a13f9e2 libs/workflow-core
+a13f9e2 libs/workflow-core
Ua13f9e2 libs/workflow-core
```

Meaning roughly:

- space: initialized and at expected commit;
- `-`: not initialized;
- `+`: checked out commit differs from parent expected;
- `U`: conflict.

If you see `+`, parent pointer and submodule working tree differ.

Commit update in parent if intentional.

---

## 38. Submodule Merge Conflict

Two branches update submodule pointer differently.

Conflict:

```text
libs/workflow-core
```

You must choose which commit pointer should win, or move to a third commit that includes both.

Steps:

```bash
cd libs/workflow-core
git fetch
git log --oneline --graph --decorate --all
```

Find appropriate commit.

Then:

```bash
git checkout <chosen-commit>
cd ../..
git add libs/workflow-core
git commit
```

Semantic question:

```text
Which dependency version is compatible with parent code?
```

This is not just Git conflict; it is dependency integration decision.

---

## 39. Subtree Commands Cheat Sheet

Add:

```bash
git subtree add --prefix=vendor/lib <repo-url> main --squash
```

Pull update:

```bash
git subtree pull --prefix=vendor/lib <repo-url> main --squash
```

Push local changes upstream:

```bash
git subtree push --prefix=vendor/lib <repo-url> main
```

Split subtree history:

```bash
git subtree split --prefix=vendor/lib -b lib-split
```

Subtree is less common than submodule, so team training matters.

---

## 40. Migration Away from Submodule to Artifact

Common path:

1. Ensure submodule repo can publish Maven/Gradle artifact.
2. Add CI release pipeline.
3. Publish version.
4. Replace source reference with dependency declaration.
5. Remove submodule.
6. Update imports/package if needed.
7. Add source/javadoc artifact for debugging.
8. Add dependency update automation.

Parent repo changes:

```bash
git submodule deinit -f libs/workflow-core
git rm -f libs/workflow-core
rm -rf .git/modules/libs/workflow-core
```

Build file:

```kotlin
implementation("com.acme.platform:workflow-core:2.4.1")
```

Commit:

```text
Replace workflow-core submodule with versioned artifact dependency
```

---

## 41. Migration Away from Vendor Code

Steps:

1. Identify origin/version.
2. Compare local modifications.
3. Decide whether to upstream patches.
4. Publish/use artifact dependency if Java library.
5. Remove vendor code.
6. Add dependency.
7. Add tests.
8. Preserve license notices if required.

If local modifications exist, do not blindly replace.

Use diff:

```bash
diff -ru vendor/lib upstream/lib
```

Or if history exists:

```bash
git log -- vendor/lib
```

---

## 42. Multi-Repository Debugging

Bug in service may originate from dependency.

Workflow:

1. Bisect service repo.
2. If result is dependency bump, note old/new versions.
3. Checkout dependency repo.
4. Bisect dependency between old/new tags.
5. Write regression test at correct layer.
6. Release fixed dependency.
7. Update consumer.

Example:

```text
case-service bumps workflow-core 2.4.1 -> 2.5.0.
Bug appears.
Bisect workflow-core v2.4.1..v2.5.0.
```

This requires traceable tags/releases.

Submodule pinned commits can help identify exact dependency commit, but artifact versions with source mapping can do the same more cleanly.

---

## 43. Repository Boundary Smells

Signs boundary may be wrong:

```text
[ ] Every feature requires PRs in 5 repos.
[ ] Breaking changes happen constantly.
[ ] Teams use SNAPSHOT in production-like builds.
[ ] Submodule pointer changes in almost every PR.
[ ] Shared library has no compatibility policy.
[ ] Consumer frequently patches vendored code.
[ ] Integration tests fail due to version mismatch.
[ ] Developers need complex local setup across repos.
[ ] Release train blocked by dependency coordination.
```

Possible fixes:

- improve backward compatibility;
- introduce platform BOM;
- move to monorepo;
- split library differently;
- publish generated client;
- define contract tests;
- reduce shared code;
- use service API rather than shared internal library.

---

## 44. Shared Library Anti-Pattern

Many Java orgs create `common-utils`.

It grows:

```text
common-utils:
  date utils
  security helpers
  DTOs
  exceptions
  JSON config
  workflow state
  database helpers
  HTTP clients
  logging
```

Problems:

- high coupling;
- version conflicts;
- accidental breaking changes;
- dependency bloat;
- unclear ownership;
- every service depends on everything;
- release coordination pain.

Better:

```text
Small focused libraries with clear ownership and compatibility policy.
```

Examples:

```text
acme-observability
acme-security-spring
case-api-client
workflow-domain
audit-events-contract
```

Git strategy cannot fix bad module boundaries.

---

## 45. Source Dependency vs Binary Dependency

Source dependency gives:

- easier debugging;
- possible local patch;
- visibility;
- no publish step.

Binary artifact gives:

- version boundary;
- reproducible release;
- faster build;
- standard Java ecosystem;
- artifact signing/scanning;
- transitive metadata.

Question:

```text
Do you need to modify dependency source as part of normal work,
or only consume stable behavior?
```

If consume stable behavior, artifact wins.

If modify together constantly, reconsider repository architecture.

---

## 46. Practical Recommendation for Java Teams

Default hierarchy:

```text
1. Use Maven/Gradle artifact dependency for libraries.
2. Use BOM/version catalog/lockfile for version governance.
3. Use Gradle composite build or Maven local install for local cross-repo development.
4. Use contract/schema artifacts for generated clients.
5. Use submodule only when source pinning is truly needed.
6. Use subtree/vendor for small/stable vendored code with documented origin.
7. Consider monorepo if cross-module atomic changes dominate.
```

Avoid:

```text
Using submodule because artifact release process is missing.
Using vendor copy because dependency governance is weak.
Using shared common library as dumping ground.
Using SNAPSHOT for release builds.
```

---

## 47. Review Checklist: Adding a Dependency

When PR adds dependency:

```text
[ ] Why is dependency needed?
[ ] Is it source dependency or artifact dependency?
[ ] Is version pinned?
[ ] Is license acceptable?
[ ] Is transitive dependency impact understood?
[ ] Is security/vulnerability scan clean?
[ ] Is artifact from trusted repository?
[ ] Is dependency scope correct?
[ ] Is it runtime, compile, test, annotationProcessor?
[ ] Is compatibility policy clear?
[ ] Is source/javadoc available?
[ ] Does it duplicate existing dependency?
[ ] Is dependency too broad?
```

For submodule:

```text
[ ] Why not Maven/Gradle artifact?
[ ] Is submodule pinned to tag/release commit?
[ ] Does CI checkout recursively?
[ ] Do all developers have access?
[ ] Is update process documented?
[ ] Is `.gitmodules` correct?
```

---

## 48. Review Checklist: Updating Submodule

```text
[ ] What changed in submodule between old and new commit?
[ ] Is new commit tagged/released?
[ ] Does parent code require this update?
[ ] Are tests covering integration?
[ ] Is submodule working tree clean?
[ ] Does CI checkout submodule?
[ ] Is this update mixed with unrelated parent changes?
[ ] Is commit message clear?
```

Commands:

```bash
git diff --submodule=log
git submodule status
```

Configure nicer diff:

```bash
git config diff.submodule log
```

Then submodule diffs show commit log instead of only SHA change.

---

## 49. Review Checklist: Vendored Code

```text
[ ] Origin documented.
[ ] Version/commit documented.
[ ] License included.
[ ] Local modifications documented.
[ ] Update process documented.
[ ] Size acceptable.
[ ] Security ownership clear.
[ ] No generated/binary bloat without reason.
```

---

## 50. Practical `.gitmodules` Example

```ini
[submodule "libs/workflow-core"]
    path = libs/workflow-core
    url = git@github.com:acme/workflow-core.git
    branch = main
```

If using HTTPS for easier CI:

```ini
[submodule "libs/workflow-core"]
    path = libs/workflow-core
    url = https://github.com/acme/workflow-core.git
    branch = main
```

Be consistent with org access model.

If developers use SSH but CI uses HTTPS, document or use URL rewrite.

---

## 51. Submodule Diff Configuration

By default, submodule diff may show only commit SHA.

Set:

```bash
git config --global diff.submodule log
```

Or repo config:

```bash
git config diff.submodule log
```

Then:

```bash
git diff
```

shows commits between old/new submodule pointer.

Also:

```bash
git diff --submodule=log
```

This improves review quality.

---

## 52. Submodule Recursion Config

Useful configs:

```bash
git config submodule.recurse true
git config fetch.recurseSubmodules on-demand
git config push.recurseSubmodules check
```

`push.recurseSubmodules check` helps prevent pushing parent pointer to child commit that has not been pushed.

Failure it prevents:

```text
Parent points to submodule commit only on your local machine.
Other developers cannot fetch it.
```

---

## 53. Build Tool Should Not Depend on Floating Git Branch

Bad pattern:

```text
Build script clones dependency repo main branch during build.
```

Example bad:

```bash
git clone https://github.com/acme/workflow-core
cd workflow-core
git checkout main
```

Why bad:

- not reproducible;
- network required;
- branch mutable;
- build can change without commit;
- bisect broken;
- supply chain risk.

If build must fetch source, pin commit/tag and verify checksum.

But for Java, artifact dependency is usually better.

---

## 54. Case Study: Submodule Causing CI Failure

Symptoms:

```text
CI: path libs/workflow-core does not exist or is empty.
```

Cause:

```text
Checkout did not initialize submodule.
```

Fix:

GitHub Actions:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

But next failure:

```text
Permission denied for submodule repo.
```

Fix access token/deploy key.

Question:

```text
Is submodule worth this complexity compared to artifact dependency?
```

---

## 55. Case Study: Parent Points to Unpushed Submodule Commit

Developer:

```text
1. Commits in submodule locally.
2. Updates parent pointer.
3. Pushes parent.
4. Forgets to push submodule.
```

Others:

```text
fatal: remote error: upload-pack: not our ref <sha>
```

Mitigation:

```bash
git config push.recurseSubmodules check
```

Or:

```bash
git push --recurse-submodules=check
```

Better workflow discipline:

```text
Push submodule commits first, then parent pointer.
```

---

## 56. Case Study: Shared Library via Submodule Changes Every PR

Symptoms:

```text
Every feature branch updates libs/common.
Frequent conflicts on submodule pointer.
Developers confused by detached HEAD.
CI slow.
```

Diagnosis:

```text
The library and service likely have too-tight change coupling.
```

Better options:

- move to monorepo;
- publish artifact with backward-compatible changes;
- split library into stable contracts;
- reduce shared code;
- use composite build for local dev;
- define release cadence.

Submodule is exposing architecture coupling.

---

## 57. Case Study: Vendor Code Fork Drift

Repo has:

```text
vendor/json-helper/
```

No README.

No one knows origin.

Security team asks if CVE applies.

No answer.

Fix:

- identify origin;
- document version/license;
- compare with upstream;
- replace with artifact if possible;
- add owner;
- add update process.

Vendor code without provenance is supply chain debt.

---

## 58. Case Study: OpenAPI Contract Repo as Submodule

`case-service` includes:

```text
contracts/case-api/  (submodule)
```

Build generates DTOs from it.

Pros:

- exact contract commit pinned;
- source contract visible.

Cons:

- clone complexity;
- CI submodule access;
- generated code tied to Git repo;
- contract release not versioned as artifact.

Alternative:

```text
Publish OpenAPI spec artifact:
com.acme.contracts:case-api-openapi:1.4.0
```

Consumer depends on version.

Better for release traceability.

Submodule may still be okay if contract repo is internal and update workflow explicit.

---

## 59. Latihan Praktis

## Latihan 1 — Inspect Submodule

In a repo with submodule:

```bash
cat .gitmodules
git submodule status
git diff --submodule=log
```

Answer:

```text
What commit is pinned?
Is it tagged?
Who owns it?
How is it updated?
```

## Latihan 2 — Simulate Submodule Update

```bash
cd libs/workflow-core
git fetch
git checkout <new-tag>
cd ../..
git diff --submodule=log
git add libs/workflow-core
git commit -m "Update workflow-core to <tag>"
```

Observe parent pointer change.

## Latihan 3 — Compare Artifact vs Submodule

Take one internal Java dependency.

Answer:

```text
Could it be a Maven/Gradle artifact?
What would be required?
What benefit does source inclusion provide?
```

## Latihan 4 — Vendor Code Audit

Find `vendor/`, `lib/`, or committed `.jar`.

For each:

```text
Origin?
Version?
License?
Update process?
Can it become artifact dependency?
```

## Latihan 5 — Multi-Repo Regression

Pick a dependency bump commit.

Trace:

```text
Consumer old version -> new version
Dependency repo tag old -> tag new
Relevant commits between versions
```

Practice forensic flow.

---

## 60. Pertanyaan Reflektif

1. Apakah dependency antar repo Anda punya version boundary yang jelas?
2. Apakah ada submodule yang sebenarnya lebih cocok menjadi artifact?
3. Apakah ada artifact dependency yang terlalu sering butuh atomic source change?
4. Apakah SNAPSHOT dipakai di release-like environment?
5. Apakah CI bisa reproduce dependency graph tanpa local state?
6. Apakah shared library punya compatibility policy?
7. Apakah dependency upgrade mudah direview?
8. Apakah vendored code punya origin/license/update process?
9. Apakah submodule pointer updates sering conflict?
10. Apakah generated client berasal dari versioned contract?
11. Apakah dependency versions traceable ke deployment artifact?
12. Apakah multi-repo incident bisa dibisect lintas repo?
13. Apakah access control submodule menyulitkan onboarding/CI?
14. Apakah monorepo mungkin lebih cocok untuk highly coupled modules?
15. Apakah repo boundary mencerminkan architecture boundary?

---

## 61. Mental Model Akhir

Submodule, subtree, vendor code, artifact dependency, monorepo, dan polyrepo bukan sekadar pilihan Git command.

Mereka adalah pilihan architecture dan ownership.

Pertanyaan kuat:

```text
Apa boundary dependency ini?
Siapa owner-nya?
Bagaimana versioning-nya?
Bagaimana compatibility dijaga?
Bagaimana release dilakukan?
Bagaimana consumer update?
Bagaimana forensic dilakukan saat incident?
```

Untuk Java, default sehat:

```text
Library aktif -> Maven/Gradle artifact with version.
Local cross-repo dev -> composite build / local install.
Contract -> versioned spec/client artifact.
Source pinning khusus -> submodule/subtree with explicit process.
High coupling -> pertimbangkan monorepo atau redesign boundary.
```

Git submodule bukan “folder import”.

Submodule adalah pointer ke commit repo lain.

Subtree bukan “magic dependency manager”.

Subtree adalah vendor/sync strategy.

Gunakan keduanya dengan sengaja, bukan karena release dependency terasa merepotkan.

---

## 62. Koneksi ke Part Berikutnya

Part ini membahas dependency source code lintas repository.

Part berikutnya masuk ke desain repository sebagai boundary arsitektur:

```text
learn-git-mastery-for-java-engineers-part-025.md
```

Topik:

```text
Monorepo, Polyrepo, dan Repository Architecture
```

Kita akan membahas:

- trade-off monorepo vs polyrepo;
- ownership;
- build performance;
- CI affected testing;
- microservices;
- Java multi-module Maven/Gradle;
- sparse checkout;
- partial clone;
- repo sebagai architecture boundary;
- governance repo besar.

---

## 63. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `git submodule`
- Git official documentation: `git subtree`
- Git official documentation: `.gitmodules`
- Git official documentation: submodule recursion and config
- Maven dependency management and repository conventions
- Gradle dependency management, composite builds, version catalogs, dependency locking
- Praktik umum artifact repository, monorepo/polyrepo design, source dependency governance, vendor code management, and supply chain traceability

---

## 64. Status Seri

```text
Progress: 024 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-025.md
```

Topik:

```text
Monorepo, Polyrepo, dan Repository Architecture
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-023.md](./learn-git-mastery-for-java-engineers-part-023.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-025.md](./learn-git-mastery-for-java-engineers-part-025.md)

</div>