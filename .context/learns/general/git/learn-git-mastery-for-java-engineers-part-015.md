# learn-git-mastery-for-java-engineers-part-015.md

# Part 015 — Release, Tagging, Versioning, dan Hotfix

## Status Seri

```text
Progress: 015 / 032
Status: belum selesai
Bagian terakhir: learn-git-mastery-for-java-engineers-part-032.md
```

## Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas workflow tim: trunk-based development, GitHub Flow, Git Flow, release branch, dan anti-pattern branch environment. Bagian ini masuk ke pertanyaan yang lebih operasional dan kritikal:

> Bagaimana Git digunakan untuk menandai, membuktikan, memperbaiki, dan menelusuri software yang benar-benar dirilis?

Di banyak tim, Git dipakai untuk development, tetapi release masih diperlakukan sebagai aktivitas manual: build dari branch yang “sepertinya benar”, deploy artifact yang “kayaknya versi terakhir”, lalu saat incident terjadi tim kesulitan menjawab:

- commit mana yang sedang running di production?
- source code mana yang menghasilkan artifact ini?
- perubahan apa saja yang masuk antara release sebelumnya dan sekarang?
- bug ini diperkenalkan di versi mana?
- bagaimana membuat hotfix tanpa membawa perubahan lain yang belum siap?
- bagaimana memastikan patch production bisa ditelusuri kembali?

Engineer yang matang tidak melihat release sebagai “klik deploy”. Ia melihat release sebagai **state transition yang harus dapat dibuktikan**.

Git membantu membangun bukti itu melalui:

- commit sebagai immutable source snapshot,
- tag sebagai release anchor,
- branch sebagai jalur kerja,
- cherry-pick/backport sebagai selective propagation,
- revert sebagai koreksi history publik,
- CI/CD sebagai mekanisme build dari state tertentu,
- artifact versioning sebagai identitas hasil build.

Target bagian ini adalah membuat Anda mampu merancang dan menjalankan release/hotfix Git workflow yang aman, traceable, dan cocok untuk Java engineering team.

---

# 1. Mental Model: Release adalah Snapshot yang Dipromosikan

Release bukan branch. Release bukan environment. Release bukan folder artifact. Release adalah **keputusan untuk mempromosikan snapshot tertentu menjadi candidate/production artifact**.

Dalam Git, snapshot itu biasanya direpresentasikan oleh commit.

```text
A---B---C---D---E  main
            ^
            release candidate source snapshot
```

Jika commit `D` dibangun oleh CI dan menghasilkan artifact `payment-service-1.8.0.jar`, maka release yang baik harus bisa menjawab:

```text
artifact payment-service-1.8.0.jar dibuat dari commit D
commit D berasal dari branch main/release tertentu
commit D ditandai oleh tag v1.8.0
pipeline build X menghasilkan artifact checksum Y
artifact Y dideploy ke environment Z pada waktu T
```

Git tidak menyimpan semua bukti deployment. Tetapi Git menyediakan anchor paling penting: **source identity**.

Tanpa anchor Git yang jelas, release menjadi sulit diaudit.

---

# 2. Commit, Tag, Branch, dan Artifact: Jangan Dicampur

Banyak kebingungan release muncul karena empat konsep ini dicampur.

## 2.1 Commit

Commit adalah snapshot immutable dari source code.

```text
commit = source state
```

Commit menjawab:

> Source code persisnya apa?

## 2.2 Branch

Branch adalah pointer bergerak.

```text
branch = moving pointer
```

Branch menjawab:

> Jalur kerja mana yang sedang berkembang?

Contoh:

```text
main
release/1.8
feature/refund-api
hotfix/payment-timeout
```

Branch bukan identitas release yang stabil karena branch bisa maju.

## 2.3 Tag

Tag adalah nama stabil untuk commit tertentu.

```text
tag = stable release anchor
```

Tag menjawab:

> Commit mana yang kita nyatakan sebagai versi tertentu?

Contoh:

```bash
git tag v1.8.0 <commit>
```

## 2.4 Artifact

Artifact adalah hasil build dari source code.

```text
artifact = binary/build output
```

Untuk Java:

```text
payment-service-1.8.0.jar
payment-service-1.8.0-sources.jar
payment-service-1.8.0.pom
Docker image payment-service:1.8.0
```

Artifact menjawab:

> Unit apa yang benar-benar dijalankan oleh runtime/deployment platform?

## 2.5 Hubungan Ideal

```text
Git commit  --->  CI build  --->  artifact  --->  deployment
     |              |              |              |
     v              v              v              v
   tag           build id       checksum       environment
```

Release yang defensible menghubungkan semuanya.

---

# 3. Kenapa Tag Lebih Cocok untuk Release daripada Branch

Branch bergerak. Tag seharusnya tidak bergerak.

Misalnya:

```text
A---B---C---D  main
        ^
        v1.7.0
```

Lalu development lanjut:

```text
A---B---C---D---E---F  main
        ^
        v1.7.0
```

Tag `v1.7.0` tetap menunjuk ke `C`. Branch `main` sudah maju ke `F`.

Karena itu release production lebih baik dijawab dengan tag/commit, bukan “dari main”.

Kalimat yang lemah:

```text
Production jalan dari main minggu lalu.
```

Kalimat yang kuat:

```text
Production menjalankan artifact payment-service:1.7.0 yang dibangun dari commit 8f31a2c, ditandai tag v1.7.0.
```

---

# 4. Lightweight Tag vs Annotated Tag

Git memiliki dua jenis tag umum:

1. lightweight tag,
2. annotated tag.

## 4.1 Lightweight Tag

Lightweight tag pada dasarnya adalah pointer nama ke commit.

```bash
git tag v1.8.0
```

Secara konseptual:

```text
refs/tags/v1.8.0 -> commit D
```

Kelebihan:

- sederhana,
- cepat,
- cukup untuk local marker atau temporary marker.

Kekurangan:

- tidak punya metadata tagger yang kaya,
- tidak punya message tag,
- tidak cocok sebagai release record serius.

## 4.2 Annotated Tag

Annotated tag adalah object tersendiri di Git yang menunjuk ke commit, memiliki metadata, message, dan dapat ditandatangani.

```bash
git tag -a v1.8.0 -m "Release 1.8.0"
```

Secara konseptual:

```text
refs/tags/v1.8.0 -> tag object -> commit D
```

Kelebihan:

- punya tagger identity,
- punya tanggal tag dibuat,
- punya message,
- bisa signed,
- lebih cocok untuk release official.

Rekomendasi:

```text
Untuk release production, gunakan annotated tag.
```

Contoh:

```bash
git tag -a v1.8.0 -m "Release payment-service 1.8.0"
git push origin v1.8.0
```

---

# 5. Signed Tag dan Signed Commit dalam Release

Untuk repository biasa, annotated tag mungkin cukup. Untuk environment yang membutuhkan audit/security lebih kuat, signed tag memberikan bukti bahwa tag dibuat oleh identitas yang memiliki key tertentu.

Contoh:

```bash
git tag -s v1.8.0 -m "Release payment-service 1.8.0"
```

Signed tag membantu menjawab:

- siapa yang mengotorisasi tag release?
- apakah tag dimodifikasi?
- apakah release anchor dibuat oleh identitas terpercaya?

Namun signed tag bukan silver bullet.

Ia tidak otomatis membuktikan:

- artifact tidak dimodifikasi setelah build,
- pipeline aman,
- dependency aman,
- deployment benar.

Signed tag adalah satu bagian dari chain of trust.

Mental model:

```text
Signed tag protects source release identity.
It does not protect the entire delivery pipeline by itself.
```

---

# 6. Versioning: Nama Versi adalah Kontrak Komunikasi

Versioning bukan hanya angka. Versioning adalah protokol komunikasi antara tim engineering, QA, SRE, product, dependency consumer, dan production operation.

Versi menjawab:

```text
Perubahan apa yang diasumsikan kompatibel?
Perubahan mana yang patch?
Apakah upgrade aman?
Apakah consumer perlu adaptasi?
```

Untuk Java ecosystem, versioning muncul di banyak tempat:

- Maven `pom.xml`,
- Gradle `version`,
- artifact repository,
- Docker image tag,
- Helm chart version,
- deployment manifest,
- Git tag,
- release notes.

Masalah umum muncul saat semua ini tidak sinkron.

Contoh buruk:

```text
Git tag: v1.8.0
pom.xml: 1.7.9
Docker image: latest
deployment dashboard: build-4321
```

Saat incident terjadi, tim harus menerjemahkan empat identitas berbeda.

Contoh lebih baik:

```text
Git tag: v1.8.0
pom.xml: 1.8.0
Docker image: payment-service:1.8.0
CI build metadata: commit=8f31a2c, tag=v1.8.0
```

---

# 7. Semantic Versioning secara Praktis

Semantic Versioning umum memakai format:

```text
MAJOR.MINOR.PATCH
```

Contoh:

```text
2.4.7
```

Makna umum:

```text
MAJOR = perubahan breaking / incompatible
MINOR = fitur baru yang backward-compatible
PATCH = bugfix backward-compatible
```

Namun dalam sistem internal enterprise/microservices, semantic versioning perlu dipakai dengan judgement.

## 7.1 Library Java

Untuk library yang dikonsumsi service lain, SemVer sangat penting.

Contoh:

```text
customer-client-sdk 3.1.0 -> 3.2.0
```

Artinya consumer bisa berharap API tetap kompatibel.

Jika method public dihapus:

```java
public CustomerResponse getCustomer(String id)
```

diganti menjadi:

```java
public CustomerResponse getCustomer(UUID id)
```

itu kemungkinan breaking change, sehingga major version layak naik.

## 7.2 Service Backend

Untuk service backend yang dideploy sebagai aplikasi, versi lebih sering merepresentasikan release deployment, bukan library compatibility.

Contoh:

```text
payment-service 1.8.0
```

Yang penting:

- source commit jelas,
- artifact jelas,
- DB migration jelas,
- API compatibility jelas,
- rollback/roll-forward path jelas.

## 7.3 API Contract

Jika service menyediakan REST/gRPC API, breaking change tidak selalu tercermin dari artifact version.

Contoh non-breaking:

```json
{
  "id": "P-123",
  "status": "PAID",
  "paidAt": "2026-06-17T10:00:00Z"
}
```

Menambahkan field biasanya backward-compatible bagi consumer JSON yang toleran:

```json
{
  "id": "P-123",
  "status": "PAID",
  "paidAt": "2026-06-17T10:00:00Z",
  "paymentMethod": "CARD"
}
```

Menghapus/rename field biasanya breaking:

```json
{
  "id": "P-123",
  "state": "PAID"
}
```

Git release workflow harus memperlakukan API contract sebagai bagian dari release risk.

---

# 8. Snapshot Version, Release Version, dan Build Metadata

Java project sering memakai versi seperti:

```text
1.8.0-SNAPSHOT
1.8.0
1.8.1
```

## 8.1 SNAPSHOT

`SNAPSHOT` berarti versi development yang bisa berubah.

Contoh Maven:

```xml
<version>1.8.0-SNAPSHOT</version>
```

Artifact `1.8.0-SNAPSHOT` bukan release immutable secara semantik. Ia bisa dibuild berkali-kali dengan isi berbeda.

Karena itu jangan deploy SNAPSHOT sebagai production release kecuali tim Anda sengaja punya sistem metadata tambahan yang kuat.

## 8.2 Release Version

Release version seharusnya immutable.

```xml
<version>1.8.0</version>
```

Jika `payment-service-1.8.0.jar` sudah dipublish, jangan publish ulang artifact berbeda dengan nama yang sama.

Jika ada bug, buat:

```text
1.8.1
```

bukan mengganti isi `1.8.0`.

## 8.3 Build Metadata

Dalam beberapa sistem, versi user-facing tetap `1.8.0`, tetapi build metadata menyimpan commit.

Contoh:

```text
version=1.8.0
commit=8f31a2c
buildNumber=4321
builtAt=2026-06-17T10:00:00Z
```

Untuk Spring Boot, metadata bisa muncul di endpoint actuator `/actuator/info`.

Contoh konseptual:

```json
{
  "build": {
    "artifact": "payment-service",
    "version": "1.8.0",
    "time": "2026-06-17T10:00:00Z"
  },
  "git": {
    "branch": "main",
    "commit": {
      "id": "8f31a2c"
    }
  }
}
```

Ini sangat berguna untuk incident response.

---

# 9. Release Branch: Kapan Dibutuhkan?

Release branch adalah branch yang dibuat untuk menstabilkan versi tertentu.

Contoh:

```text
A---B---C---D---E---F  main
            \
             R1---R2   release/1.8
```

`main` lanjut menerima development, sementara `release/1.8` hanya menerima fix yang diperlukan untuk release 1.8.

## 9.1 Cocok Ketika

Release branch berguna jika:

- ada fase hardening/stabilization sebelum production,
- QA/UAT butuh waktu,
- main tetap harus bergerak untuk development berikutnya,
- patch release untuk versi lama masih perlu dipelihara,
- deployment ke customer berbeda-beda waktunya,
- regulated environment membutuhkan release candidate freeze.

## 9.2 Tidak Selalu Dibutuhkan

Jika tim melakukan trunk-based delivery dengan feature flag, automated test kuat, dan deployment sering, release branch panjang mungkin tidak perlu.

Model sederhana:

```text
main -> CI -> tag -> deploy
```

## 9.3 Risiko Release Branch

Release branch bisa menciptakan divergence.

```text
main:        A---B---C---D---E---F
                 \
release/1.8:      R1---R2---R3
```

Pertanyaan penting:

- fix di release branch perlu dibawa balik ke main?
- bagaimana mencegah fix hilang?
- siapa owner release branch?
- kapan branch ditutup?

Release branch tanpa backport discipline akan menjadi sumber bug berulang.

---

# 10. Pola Release Umum

## 10.1 Release Langsung dari Main

```text
A---B---C---D  main
            ^
            v1.8.0
```

Alur:

```bash
git checkout main
git pull --ff-only
git tag -a v1.8.0 -m "Release 1.8.0"
git push origin v1.8.0
```

CI/CD:

```text
tag v1.8.0 pushed -> release pipeline -> build artifact -> publish -> deploy
```

Cocok untuk:

- trunk-based development,
- test automation kuat,
- release kecil dan sering,
- feature flag matang,
- rollback/roll-forward cepat.

Risiko:

- jika main tidak selalu releasable, release bisa berbahaya,
- butuh quality gate kuat sebelum main.

## 10.2 Release dari Release Branch

```text
A---B---C---D---E  main
        \
         R1---R2   release/1.8
              ^
              v1.8.0
```

Alur:

```bash
git checkout -b release/1.8 main
git push -u origin release/1.8
# stabilization fixes
# tag release from release branch tip
git tag -a v1.8.0 -m "Release 1.8.0"
git push origin v1.8.0
```

Cocok untuk:

- enterprise release train,
- QA/UAT manual,
- multiple environments,
- release freeze,
- customer-specific support windows.

Risiko:

- divergence dari main,
- backport/forward-port overhead,
- branch bisa menjadi long-lived maintenance branch.

## 10.3 Release Candidate Tag

Kadang tim ingin menandai candidate sebelum final release.

Contoh:

```text
v1.8.0-rc.1
v1.8.0-rc.2
v1.8.0
```

Alur:

```bash
git tag -a v1.8.0-rc.1 -m "Release candidate 1 for 1.8.0"
git push origin v1.8.0-rc.1
```

Jika ada fix:

```text
release/1.8: R1---R2---R3
              ^         ^
          rc.1       rc.2
```

Final:

```bash
git tag -a v1.8.0 -m "Release 1.8.0"
git push origin v1.8.0
```

Cocok untuk:

- UAT,
- regulated testing,
- production readiness sign-off,
- external customer validation.

---

# 11. Hotfix: Perbaikan Cepat untuk Production

Hotfix adalah perubahan kecil dan terkontrol untuk memperbaiki masalah production.

Tujuan hotfix:

```text
memperbaiki production dengan perubahan minimal, traceable, dan tidak membawa fitur belum siap
```

Bukan tujuan hotfix:

```text
membersihkan refactor lama
sekalian merge feature lain
upgrade dependency besar tanpa alasan langsung
mengubah arsitektur
```

## 11.1 Hotfix dari Production Tag

Jika production berjalan di `v1.8.0`, hotfix paling aman biasanya dimulai dari tag itu.

```text
A---B---C---D---E  main
        ^
        v1.8.0 production
```

Buat branch hotfix:

```bash
git fetch --tags
git checkout -b hotfix/v1.8.1 v1.8.0
```

Tambahkan fix:

```text
A---B---C---D---E  main
        \
         H          hotfix/v1.8.1
```

Tag patch release:

```bash
git tag -a v1.8.1 -m "Hotfix 1.8.1: fix payment timeout"
git push origin hotfix/v1.8.1
git push origin v1.8.1
```

Lalu pastikan fix masuk kembali ke main:

```bash
git checkout main
git pull --ff-only
git cherry-pick <H>
git push origin main
```

Atau merge hotfix branch ke main jika sesuai workflow:

```bash
git checkout main
git merge --no-ff hotfix/v1.8.1
```

## 11.2 Kenapa dari Tag, Bukan dari Main?

Jika main sudah maju:

```text
A---B---C---D---E---F---G  main
        ^
        v1.8.0 production
```

Commit `D/E/F/G` mungkin berisi fitur yang belum production-ready. Jika hotfix dibuat dari main, Anda bisa tanpa sengaja membawa perubahan lain.

Hotfix dari tag production menjaga scope:

```text
A---B---C---D---E---F---G  main
        \
         H                 hotfix/v1.8.1
```

Patch release hanya berisi `H` di atas versi production.

---

# 12. Backport dan Forward-Port

Istilah ini sering muncul dalam maintenance release.

## 12.1 Backport

Backport berarti membawa fix dari branch baru ke branch versi lama.

Contoh:

```text
main:        A---B---C---D---E---F
                     \
release/1.8:          R1---R2
```

Bug fix dibuat di main pada `F`, tetapi perlu diterapkan ke `release/1.8`.

```bash
git checkout release/1.8
git cherry-pick F
```

Hasil:

```text
main:        A---B---C---D---E---F
                     \
release/1.8:          R1---R2---F'
```

`F'` bukan commit yang sama secara hash, tetapi membawa patch serupa.

## 12.2 Forward-Port

Forward-port berarti membawa fix dari branch lama/hotfix ke branch utama.

Contoh:

```text
main:        A---B---C---D---E
                 \
hotfix/1.8.1:     H
```

Fix `H` perlu masuk ke main:

```bash
git checkout main
git cherry-pick H
```

atau merge:

```bash
git merge --no-ff hotfix/1.8.1
```

## 12.3 Rule Penting

Setiap hotfix production harus punya jawaban:

```text
Apakah fix ini sudah masuk ke main?
Jika belum, kapan dan lewat PR mana?
```

Jika tidak, bug yang sama bisa muncul lagi di release berikutnya.

---

# 13. Cherry-Pick dalam Release dan Hotfix

`git cherry-pick` mengambil perubahan dari commit tertentu dan menerapkannya ke posisi saat ini.

```bash
git cherry-pick <commit>
```

Mental model:

```text
Ambil patch dari commit X, lalu buat commit baru di branch sekarang.
```

Bukan memindahkan commit yang sama. Cherry-pick membuat commit baru dengan hash baru.

## 13.1 Kapan Cocok

Cherry-pick cocok untuk:

- backport fix kecil,
- hotfix selektif,
- mengambil satu patch dari branch yang belum siap seluruhnya,
- maintenance branch.

## 13.2 Kapan Berbahaya

Cherry-pick berbahaya jika:

- commit bergantung pada banyak commit lain,
- patch tampak kecil tapi semantic dependency besar,
- migration/database change tidak ikut,
- test tidak cukup,
- conflict diselesaikan tanpa memahami domain.

Contoh buruk:

```text
Commit F memperbaiki bug payment timeout,
tetapi bergantung pada refactor HTTP client di commit D dan E.
```

Cherry-pick hanya `F` bisa compile gagal atau lebih buruk: compile sukses tapi behavior salah.

## 13.3 Gunakan `-x` untuk Backport Publik

Untuk backport/hotfix, sering berguna memakai:

```bash
git cherry-pick -x <commit>
```

Ini menambahkan catatan pada commit message:

```text
(cherry picked from commit abc123...)
```

Manfaat:

- traceability,
- tahu asal patch,
- memudahkan audit,
- memudahkan investigasi duplikasi fix.

Rekomendasi:

```text
Untuk cherry-pick antar branch release/main yang public, gunakan -x kecuali ada alasan kuat tidak.
```

---

# 14. Revert dalam Release

`git revert` membuat commit baru yang membalik perubahan commit sebelumnya.

```bash
git revert <commit>
```

Mental model:

```text
Jangan menghapus history publik.
Tambahkan commit koreksi yang membalik patch.
```

## 14.1 Kapan Revert Dipakai

Revert cocok ketika:

- commit sudah masuk public branch,
- perubahan harus dibatalkan tanpa rewrite history,
- production release perlu cepat menghapus efek commit,
- auditability penting.

Contoh:

```text
A---B---C---D  main
        ^
        commit C menyebabkan bug
```

Revert:

```bash
git revert C
```

Hasil:

```text
A---B---C---D---R  main
```

`R` membalik perubahan `C`.

## 14.2 Revert Bukan Time Travel

Revert tidak mengembalikan repository ke masa lalu. Revert membuat perubahan baru.

Jika commit setelah `C` bergantung pada `C`, revert bisa conflict atau menghasilkan semantic problem.

Contoh:

```text
C: add PaymentStatus.EXPIRED
D: use PaymentStatus.EXPIRED in scheduler
R: revert C
```

Jika `D` masih memakai enum itu, build bisa gagal.

## 14.3 Revert Merge Commit

Merge commit punya lebih dari satu parent. Untuk revert merge, Git perlu tahu parent utama.

```bash
git revert -m 1 <merge-commit>
```

Ini advanced dan berisiko. Jangan revert merge commit besar tanpa memahami graph dan dampaknya.

---

# 15. Reset dalam Konteks Release

`git reset` memindahkan branch pointer. Untuk branch private, ini berguna. Untuk branch public/release, ini berbahaya.

```bash
git reset --hard <commit>
```

Jika dilakukan pada branch yang sudah dipush dan dipakai orang lain, history berubah.

Dalam release workflow:

```text
Jangan gunakan reset untuk memperbaiki public release branch kecuali ada prosedur eksplisit dan koordinasi penuh.
```

Untuk membatalkan perubahan public, gunakan revert.

---

# 16. Maven/Gradle Release Versioning

## 16.1 Maven

Contoh `pom.xml` development:

```xml
<project>
  <groupId>com.example.payment</groupId>
  <artifactId>payment-service</artifactId>
  <version>1.8.0-SNAPSHOT</version>
</project>
```

Saat release:

```xml
<version>1.8.0</version>
```

Setelah release:

```xml
<version>1.8.1-SNAPSHOT</version>
```

Ada beberapa strategi:

### Strategi A — Commit Version Bump

History:

```text
A---B---C---V---T---N  main
            |   |   |
            |   |   next snapshot 1.8.1-SNAPSHOT
            |   release version 1.8.0
            code changes
```

Contoh:

```bash
# set version to 1.8.0
mvn versions:set -DnewVersion=1.8.0
mvn versions:commit
git commit -am "chore(release): prepare 1.8.0"
git tag -a v1.8.0 -m "Release 1.8.0"

# set next snapshot
mvn versions:set -DnewVersion=1.8.1-SNAPSHOT
mvn versions:commit
git commit -am "chore(release): start 1.8.1-SNAPSHOT"
```

Kelebihan:

- versi eksplisit di source,
- mudah dibaca.

Kekurangan:

- commit release noise,
- merge conflict versi di banyak module,
- automation perlu hati-hati.

### Strategi B — Version Derived from Git Tag

Source bisa memakai placeholder atau snapshot, sedangkan pipeline menentukan version dari Git tag.

Contoh:

```text
git tag v1.8.0 -> CI builds artifact version 1.8.0
```

Kelebihan:

- mengurangi version bump commit,
- tag menjadi source of truth.

Kekurangan:

- butuh build tooling matang,
- local build bisa membingungkan jika metadata tidak jelas,
- harus konsisten di semua artifact.

## 16.2 Gradle

Contoh `build.gradle`:

```groovy
group = 'com.example.payment'
version = '1.8.0-SNAPSHOT'
```

Atau version dari property:

```groovy
version = findProperty('releaseVersion') ?: 'unspecified'
```

CI:

```bash
./gradlew build -PreleaseVersion=1.8.0
```

Untuk multi-module Gradle, pastikan semua module memakai sumber version yang konsisten.

---

# 17. Multi-Module Java Project dan Release

Java enterprise sering punya multi-module Maven/Gradle:

```text
payment-platform/
  pom.xml
  payment-api/
  payment-domain/
  payment-service/
  payment-client/
```

Pertanyaan release:

```text
Apakah semua module rilis bersama?
Atau tiap module punya versi sendiri?
```

## 17.1 Single Version untuk Semua Module

Contoh:

```text
payment-platform 1.8.0
payment-api      1.8.0
payment-domain   1.8.0
payment-service  1.8.0
payment-client   1.8.0
```

Kelebihan:

- sederhana,
- traceability mudah,
- cocok untuk tightly coupled modules.

Kekurangan:

- module yang tidak berubah tetap naik versi,
- release bisa lebih besar.

## 17.2 Independent Version per Module

Contoh:

```text
payment-api      2.3.0
payment-domain   1.12.4
payment-service  1.8.0
payment-client   3.1.1
```

Kelebihan:

- presisi,
- cocok untuk library yang dirilis independen.

Kekurangan:

- dependency management lebih kompleks,
- release orchestration lebih sulit,
- changelog lebih sulit.

Decision rule:

```text
Jika module deploy/release bersama dan strongly coupled, single version biasanya lebih hemat kompleksitas.
Jika module dikonsumsi independen oleh banyak consumer, independent version bisa masuk akal.
```

---

# 18. Docker Image Tag dan Git Tag

Untuk Java service modern, release sering berupa Docker image.

Contoh buruk:

```bash
docker build -t payment-service:latest .
docker push payment-service:latest
```

`latest` tidak cukup sebagai release identity. Ia mutable dan ambigu.

Contoh lebih baik:

```bash
docker build \
  --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
  -t registry.example.com/payment-service:1.8.0 \
  -t registry.example.com/payment-service:1.8.0-8f31a2c \
  .
```

Tag image yang umum:

```text
payment-service:1.8.0
payment-service:1.8.0-8f31a2c
payment-service:8f31a2c
```

Prinsip:

```text
Human-friendly version untuk komunikasi.
Commit-specific tag untuk traceability.
Digest/checksum untuk immutability.
```

Di Kubernetes/production, lebih kuat jika deployment record menyimpan image digest:

```text
registry.example.com/payment-service@sha256:...
```

Git tag tetap penting sebagai source anchor.

---

# 19. Release Notes dari Git History

Release notes bukan sekadar daftar commit. Release notes adalah komunikasi risiko dan perubahan.

Sumber release notes:

- commit history,
- PR title/description,
- issue/ticket,
- conventional commit,
- migration notes,
- breaking changes,
- operational notes.

## 19.1 Mengambil Delta Release

Jika release sebelumnya `v1.7.0`, release baru `v1.8.0`:

```bash
git log --oneline v1.7.0..v1.8.0
```

Dengan PR merge commit:

```bash
git log --first-parent --oneline v1.7.0..v1.8.0
```

Dengan file statistik:

```bash
git diff --stat v1.7.0..v1.8.0
```

Dengan daftar file berubah:

```bash
git diff --name-status v1.7.0..v1.8.0
```

## 19.2 Template Release Notes

```markdown
# Release 1.8.0

## Summary
- Short summary of the release intent.

## Features
- ...

## Fixes
- ...

## Breaking Changes
- ...

## Database Migrations
- ...

## Configuration Changes
- ...

## Operational Notes
- ...

## Security Notes
- ...

## Git Traceability
- Previous release: v1.7.0
- Current release: v1.8.0
- Commit: 8f31a2c
- Compare: v1.7.0..v1.8.0
```

Untuk regulated/enterprise system, bagian “Operational Notes” sering lebih penting daripada daftar fitur.

---

# 20. Database Migration dalam Release

Git release untuk Java backend hampir selalu terkait database migration.

Contoh tools:

- Flyway,
- Liquibase,
- custom migration runner.

Risiko utama:

```text
Code bisa rollback, database belum tentu bisa rollback dengan aman.
```

## 20.1 Migration Harus Dipikirkan sebagai Release Contract

Contoh:

```sql
ALTER TABLE payments ADD COLUMN external_reference VARCHAR(64);
```

Ini biasanya backward-compatible.

Contoh lebih berisiko:

```sql
ALTER TABLE payments DROP COLUMN legacy_reference;
```

Ini breaking jika versi code lama masih membaca column tersebut.

## 20.2 Expand-Contract Pattern

Untuk zero/low-downtime release:

1. expand schema,
2. deploy code yang menulis dua format atau membaca keduanya,
3. backfill data,
4. switch read path,
5. contract schema lama setelah aman.

Git release sebaiknya mencerminkan tahapan ini.

Contoh:

```text
v1.8.0: add new column, code writes both
v1.9.0: code reads new column
v2.0.0: remove old column
```

Jika semua dimasukkan dalam satu release besar, rollback menjadi sulit.

---

# 21. Feature Flag dan Release

Feature flag memisahkan deployment dari activation.

Tanpa feature flag:

```text
merge -> deploy -> feature live
```

Dengan feature flag:

```text
merge -> deploy dormant code -> enable flag gradually
```

Git implication:

- main bisa tetap releasable meskipun fitur belum aktif,
- release branch panjang bisa dikurangi,
- rollback bisa berupa flag disable,
- tetapi flag lifecycle harus dikelola.

Anti-pattern:

```text
Flag tidak pernah dihapus sehingga codebase penuh kombinasi state.
```

Release notes harus menyebut flag penting:

```text
Feature included but disabled by default: payment.retry.v2
Activation controlled by config service.
```

---

# 22. Rollback vs Roll-Forward

Dalam incident production, pertanyaan umum:

```text
Harus rollback atau roll-forward?
```

## 22.1 Rollback

Rollback berarti kembali ke artifact sebelumnya.

Cocok jika:

- artifact lama masih kompatibel dengan database/config,
- bug jelas berasal dari release baru,
- rollback cepat dan aman,
- tidak ada irreversible migration.

Git membantu dengan tag release sebelumnya:

```text
current: v1.8.0
rollback target: v1.7.3
```

## 22.2 Roll-Forward

Roll-forward berarti membuat patch baru.

Cocok jika:

- rollback tidak aman karena migration/data changes,
- fix kecil dan jelas,
- release baru sudah sebagian menghasilkan state data baru,
- sistem harus tetap maju.

Hotfix version:

```text
v1.8.1
```

## 22.3 Decision Matrix

| Kondisi | Lebih condong |
|---|---|
| Bug murni code dan artifact lama kompatibel | Rollback |
| Migration sudah mengubah data irreversible | Roll-forward |
| Config salah | Config rollback/disable flag |
| Security vulnerability aktif | Roll-forward cepat |
| Release membawa banyak perubahan tak terkait | Rollback lalu hotfix selektif |
| Sistem regulated butuh audit patch | Roll-forward dengan tag baru |

---

# 23. Branch Protection dan Release Control

Release yang aman bukan hanya command Git. Perlu guardrail.

Contoh guardrail:

- main tidak bisa direct push,
- release branch protected,
- tag release hanya bisa dibuat oleh release manager/bot,
- required CI checks,
- required approval,
- signed commits/tags untuk release,
- deployment hanya dari tag pattern tertentu,
- artifact immutable di repository.

Contoh tag pattern:

```text
v*.*.*
```

Contoh pipeline rule:

```text
Jika push tag vX.Y.Z:
  run test
  build artifact
  publish artifact
  create release record
```

Dalam regulated systems, ini membantu separation of duties:

```text
Developer proposes change.
Reviewer approves.
CI builds.
Release authority tags/promotes.
Deployment system deploys traceable artifact.
```

---

# 24. Naming Convention untuk Branch dan Tag

## 24.1 Tag

Rekomendasi umum:

```text
v1.8.0
v1.8.1
v2.0.0
v1.9.0-rc.1
```

Untuk monorepo multi-service, bisa memakai prefix:

```text
payment-service/v1.8.0
case-service/v2.3.0
shared-lib/v4.1.2
```

Atau:

```text
payment-service-1.8.0
case-service-2.3.0
```

Pilih satu konvensi dan konsisten.

## 24.2 Release Branch

```text
release/1.8
release/payment-service/1.8
```

## 24.3 Hotfix Branch

```text
hotfix/1.8.1-payment-timeout
hotfix/payment-service/1.8.1
```

Branch name harus membantu manusia memahami:

- target version,
- service/module,
- intent.

---

# 25. Jangan Retag Release Sembarangan

Retagging berarti memindahkan tag dari commit lama ke commit baru.

Contoh:

```bash
git tag -d v1.8.0
git tag -a v1.8.0 <new-commit> -m "Release 1.8.0"
git push --force origin v1.8.0
```

Ini sangat berbahaya untuk release yang sudah dipakai.

Masalah:

- artifact lama dan baru bisa punya nama versi sama,
- audit trail rusak,
- deployment bisa ambigu,
- consumer tidak tahu isi versi berubah,
- incident analysis menjadi sulit.

Rule:

```text
Jika tag release sudah dipublish dan artifact sudah dipakai, jangan pindahkan tag.
Buat versi patch baru.
```

Contoh:

```text
v1.8.0 salah -> buat v1.8.1
```

Exception hanya untuk kasus sangat awal sebelum artifact dikonsumsi, dan tetap harus dikomunikasikan jelas.

---

# 26. Release Checklist

Sebelum membuat tag release:

```text
[ ] Branch/snapshot sumber jelas.
[ ] Working tree bersih.
[ ] CI green.
[ ] Test relevan sudah berjalan.
[ ] Version number benar.
[ ] Database migration ditinjau.
[ ] Config change ditinjau.
[ ] API compatibility ditinjau.
[ ] Dependency/security scan acceptable.
[ ] Release notes siap.
[ ] Rollback/roll-forward plan jelas.
[ ] Owner release jelas.
```

Command sanity:

```bash
git status
git branch --show-current
git rev-parse HEAD
git log --oneline -n 5
git diff --stat <previous-tag>..HEAD
```

Tag:

```bash
git tag -a v1.8.0 -m "Release 1.8.0"
git push origin v1.8.0
```

Setelah release:

```text
[ ] Artifact published.
[ ] Artifact version cocok dengan tag.
[ ] Build metadata menyimpan commit.
[ ] Deployment record menyimpan artifact digest/version.
[ ] Monitoring checked.
[ ] Release notes published.
[ ] Jika release branch dipakai, fix sudah forward-ported ke main.
```

---

# 27. Hotfix Checklist

Saat incident production membutuhkan hotfix:

```text
[ ] Identifikasi versi production aktif.
[ ] Identifikasi Git tag/commit production.
[ ] Buat hotfix branch dari tag production, bukan main sembarangan.
[ ] Scope fix seminimal mungkin.
[ ] Tambahkan/regresi test jika feasible.
[ ] Jalankan test relevan.
[ ] Review cepat tapi tetap ada second pair of eyes.
[ ] Tag patch version baru.
[ ] Build artifact dari tag patch.
[ ] Deploy patch.
[ ] Verifikasi production.
[ ] Forward-port fix ke main.
[ ] Update incident record/release notes.
```

Command skeleton:

```bash
git fetch origin --tags
git checkout -b hotfix/1.8.1-payment-timeout v1.8.0

# edit code
# run tests

git add .
git commit -m "fix(payment): handle upstream timeout safely"

git tag -a v1.8.1 -m "Hotfix 1.8.1: handle upstream payment timeout"
git push origin hotfix/1.8.1-payment-timeout
git push origin v1.8.1

# forward-port
git checkout main
git pull --ff-only
git cherry-pick -x hotfix/1.8.1-payment-timeout
```

Catatan: command terakhir perlu commit id. Dalam praktik:

```bash
git log --oneline hotfix/1.8.1-payment-timeout
```

lalu:

```bash
git cherry-pick -x <hotfix-commit>
```

---

# 28. Studi Kasus: Payment Service Hotfix

## 28.1 Kondisi Awal

Production menjalankan:

```text
payment-service v1.8.0
Git tag: v1.8.0
Commit: C
```

Main sudah maju:

```text
A---B---C---D---E---F  main
        ^
        v1.8.0 production
```

Commit `D/E/F` berisi fitur refund baru yang belum aktif production.

Incident:

```text
Payment timeout dari upstream gateway menyebabkan thread pool exhaustion.
```

## 28.2 Salah Cara

```bash
git checkout main
# fix timeout
git commit -m "fix timeout"
git tag v1.8.1
```

Masalah:

```text
v1.8.1 sekarang membawa D/E/F + fix baru.
```

Hotfix tidak lagi minimal.

## 28.3 Cara Lebih Aman

```bash
git checkout -b hotfix/1.8.1-timeout v1.8.0
```

Graph:

```text
A---B---C---D---E---F  main
        \
         H             hotfix/1.8.1-timeout
```

Commit `H` hanya berisi fix timeout.

Tag:

```bash
git tag -a v1.8.1 -m "Hotfix 1.8.1: prevent gateway timeout pool exhaustion"
```

Deploy `v1.8.1`.

Forward-port:

```bash
git checkout main
git cherry-pick -x H
```

Graph:

```text
A---B---C---D---E---F---H'  main
        \
         H                  hotfix/1.8.1-timeout
```

Sekarang release berikutnya tidak kehilangan fix.

---

# 29. Studi Kasus: Release Branch dengan UAT

## 29.1 Kondisi

Tim membuat release `1.9.0` untuk UAT selama 1 minggu.

```text
A---B---C---D---E  main
        \
         R1        release/1.9
```

Selama UAT, main lanjut:

```text
A---B---C---D---E---F---G  main
        \
         R1---R2---R3       release/1.9
```

`R2/R3` adalah bugfix UAT.

## 29.2 Final Release

```bash
git checkout release/1.9
git tag -a v1.9.0 -m "Release 1.9.0"
git push origin v1.9.0
```

## 29.3 Setelah Release

Fix `R2/R3` harus masuk ke main.

Opsi 1: merge release branch ke main:

```bash
git checkout main
git merge --no-ff release/1.9
```

Opsi 2: cherry-pick fix tertentu:

```bash
git checkout main
git cherry-pick -x R2 R3
```

Decision:

- merge cocok jika semua perubahan release branch harus masuk main,
- cherry-pick cocok jika hanya sebagian fix relevan dan branch sudah diverge banyak.

---

# 30. Anti-Pattern Release Git

## 30.1 Deploy dari Laptop Developer

```text
Developer build local jar lalu upload manual.
```

Masalah:

- environment tidak reproducible,
- dependency/cache bisa berbeda,
- commit sumber tidak jelas,
- audit lemah.

## 30.2 Menggunakan `latest` sebagai Identitas Release

```text
payment-service:latest
```

Masalah:

- mutable,
- tidak jelas isinya,
- rollback ambigu.

## 30.3 Retag Versi yang Sudah Dipakai

```text
v1.8.0 hari Senin != v1.8.0 hari Selasa
```

Masalah:

- audit rusak,
- artifact identity rusak.

## 30.4 Hotfix dari Main yang Sudah Berisi Fitur Belum Siap

Masalah:

- patch membawa perubahan tak terkait,
- risiko production meningkat.

## 30.5 Release Branch Tidak Pernah Ditutup

Masalah:

- branch divergence,
- fix hilang,
- maintenance cost.

## 30.6 Version Bump Conflict Berulang

Multi-module project sering conflict di `pom.xml` karena versi diubah manual di banyak branch.

Solusi:

- automation,
- tag-derived version,
- release branch discipline,
- minimize long-lived release branches.

---

# 31. Decision Matrix: Tag, Branch, Cherry-Pick, Revert

| Kebutuhan | Operasi Umum | Catatan |
|---|---|---|
| Menandai source release official | annotated tag | Jangan pindahkan setelah publish |
| Menstabilkan release sementara main lanjut | release branch | Butuh backport/forward-port discipline |
| Memperbaiki production versi lama | hotfix branch dari production tag | Scope minimal |
| Membawa fix dari main ke versi lama | cherry-pick -x | Validasi dependency patch |
| Membawa hotfix ke main | cherry-pick -x atau merge | Jangan sampai fix hilang |
| Membatalkan commit public | revert | Preserve history |
| Membersihkan commit private sebelum PR | rebase/reset | Jangan rewrite public release history |
| Menghapus release yang salah sebelum publish | delete local tag/branch | Aman jika belum dipush/dikonsumsi |
| Mengoreksi release yang sudah publish | versi patch baru | Jangan retag |

---

# 32. Praktik Command End-to-End

## 32.1 Membuat Release dari Main

```bash
git checkout main
git fetch origin --tags
git pull --ff-only

git status
git log --oneline -n 10

git diff --stat v1.7.0..HEAD

git tag -a v1.8.0 -m "Release 1.8.0"
git push origin v1.8.0
```

## 32.2 Melihat Isi Release

```bash
git show v1.8.0
git log --oneline v1.7.0..v1.8.0
git diff --name-status v1.7.0..v1.8.0
```

## 32.3 Membuat Hotfix dari Tag

```bash
git fetch origin --tags
git checkout -b hotfix/1.8.1 v1.8.0

# edit code

git status
git add src/test/java src/main/java
git commit -m "fix(payment): prevent timeout pool exhaustion"

git tag -a v1.8.1 -m "Hotfix 1.8.1: prevent timeout pool exhaustion"
git push origin hotfix/1.8.1
git push origin v1.8.1
```

## 32.4 Forward-Port Hotfix ke Main

```bash
git checkout main
git pull --ff-only

git cherry-pick -x <hotfix-commit>

git push origin main
```

## 32.5 Melihat Tag yang Ada

```bash
git tag

git tag --list 'v1.8.*'
```

## 32.6 Push Semua Tag? Hati-Hati

```bash
git push --tags
```

Command ini mendorong semua tag local yang belum ada di remote. Bisa berbahaya jika local Anda punya tag eksperimen.

Lebih aman untuk release:

```bash
git push origin v1.8.0
```

---

# 33. Latihan Praktis

## Latihan 1 — Release dari Main

Buat repository simulasi:

```bash
mkdir git-release-lab
cd git-release-lab
git init

echo "version=1.0.0-SNAPSHOT" > app.properties
git add app.properties
git commit -m "chore: initialize project"

echo "feature A" > feature-a.txt
git add feature-a.txt
git commit -m "feat: add feature A"

git tag -a v1.0.0 -m "Release 1.0.0"
```

Lihat tag:

```bash
git show v1.0.0
git log --oneline --decorate --graph
```

Pertanyaan:

```text
Commit mana yang ditunjuk oleh v1.0.0?
Apa bedanya tag dengan branch main?
```

## Latihan 2 — Main Maju Setelah Release

```bash
echo "feature B" > feature-b.txt
git add feature-b.txt
git commit -m "feat: add feature B"

git log --oneline --decorate --graph
```

Pertanyaan:

```text
Apakah v1.0.0 ikut maju?
Mengapa tidak?
```

## Latihan 3 — Hotfix dari Tag

```bash
git checkout -b hotfix/1.0.1 v1.0.0

echo "hotfix" > hotfix.txt
git add hotfix.txt
git commit -m "fix: patch production issue"

git tag -a v1.0.1 -m "Hotfix 1.0.1"

git log --oneline --decorate --graph --all
```

Pertanyaan:

```text
Apakah v1.0.1 membawa feature B?
Mengapa ini penting?
```

## Latihan 4 — Forward-Port ke Main

```bash
git checkout main
git cherry-pick -x hotfix/1.0.1

git log --oneline --decorate --graph --all
```

Pertanyaan:

```text
Mengapa commit hotfix di main punya hash berbeda?
Apa manfaat catatan cherry picked from?
```

---

# 34. Pertanyaan Reflektif

Jawab tanpa melihat command dulu:

1. Mengapa release production lebih baik di-anchor dengan tag daripada branch?
2. Apa risiko memakai lightweight tag untuk release official?
3. Mengapa retagging versi yang sudah dipublish berbahaya?
4. Dalam kondisi apa hotfix harus dibuat dari production tag, bukan main?
5. Apa bedanya rollback dan roll-forward?
6. Mengapa cherry-pick bisa compile sukses tetapi tetap salah secara semantic?
7. Apa yang harus dilakukan setelah hotfix dibuat di branch lama?
8. Bagaimana cara membuktikan artifact Java berasal dari commit tertentu?
9. Apa hubungan Maven/Gradle version dengan Git tag?
10. Apa strategi release terbaik untuk tim yang main-nya selalu releasable?
11. Apa strategi release yang lebih aman untuk tim dengan UAT panjang?
12. Kenapa database migration memengaruhi keputusan rollback?

---

# 35. Ringkasan Mental Model

Release dalam Git bukan sekadar tag. Release adalah sistem traceability.

```text
commit -> tag -> CI build -> artifact -> deployment -> monitoring/audit
```

Branch adalah jalur kerja yang bergerak. Tag adalah anchor stabil. Artifact adalah hasil build. Deployment adalah promosi artifact ke environment.

Untuk release production:

```text
Gunakan annotated tag.
Jangan pindahkan tag yang sudah dipublish.
Bangun artifact dari source state yang jelas.
Simpan commit/tag/build metadata dalam artifact/deployment.
```

Untuk hotfix:

```text
Mulai dari production tag.
Buat patch minimal.
Tag versi patch baru.
Deploy artifact baru.
Forward-port fix ke main.
```

Untuk tim Java:

```text
Sinkronkan Git tag, Maven/Gradle version, Docker image tag, artifact repository, dan deployment record.
```

Engineer biasa bertanya:

```text
Versi mana yang harus saya deploy?
```

Engineer kuat bertanya:

```text
Commit mana yang menjadi source of truth?
Tag mana yang mengikat release ini?
Artifact mana yang dibangun dari commit itu?
Apakah artifact immutable?
Apa delta dari release sebelumnya?
Apa rollback/roll-forward plan?
Apakah hotfix ini sudah masuk kembali ke main?
```

---

# 36. Checklist Kompetensi Part Ini

Anda dianggap menguasai bagian ini jika bisa:

```text
[ ] Menjelaskan perbedaan commit, branch, tag, dan artifact.
[ ] Menjelaskan kenapa tag cocok sebagai release anchor.
[ ] Membuat annotated tag untuk release.
[ ] Menjelaskan lightweight vs annotated tag.
[ ] Menjelaskan risiko retag release.
[ ] Mendesain alur release dari main.
[ ] Mendesain alur release dari release branch.
[ ] Membuat hotfix branch dari production tag.
[ ] Melakukan cherry-pick hotfix ke main.
[ ] Menjelaskan backport dan forward-port.
[ ] Memilih revert vs cherry-pick vs reset dalam konteks release.
[ ] Menghubungkan Git tag dengan Maven/Gradle version.
[ ] Menjelaskan risiko SNAPSHOT di production.
[ ] Membuat release notes berbasis Git history.
[ ] Menilai dampak database migration terhadap rollback.
[ ] Menyusun release checklist dan hotfix checklist.
```

---

# 37. Koneksi ke Bagian Berikutnya

Bagian ini banyak menyebut `cherry-pick`, `revert`, dan `reset` sebagai alat koreksi release/hotfix. Namun ketiganya memiliki konsekuensi graph yang berbeda.

Bagian berikutnya akan membedah secara khusus:

```text
learn-git-mastery-for-java-engineers-part-016.md
Cherry-Pick, Revert, Reset: Memilih Operasi Koreksi yang Tepat
```

Di sana kita akan membangun decision model yang lebih tajam untuk menjawab:

```text
Saya ingin membatalkan perubahan.
Harus revert, reset, restore, checkout, atau cherry-pick?
```

