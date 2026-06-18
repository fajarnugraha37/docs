# learn-git-mastery-for-java-engineers-part-021.md

# Part 021 — Git untuk Java Projects: Maven, Gradle, IDE, dan Generated Files

> **Seri:** Git Mastery for Java Engineers  
> **Bagian:** 021 / 032  
> **Topik:** Repository hygiene untuk Java project: Maven, Gradle, IDE, generated code, binary artifact, dan source of truth  
> **Target pembaca:** Java software engineer yang ingin menjaga repository tetap bersih, reproducible, reviewable, dan aman untuk tim besar  
> **Status seri:** Belum selesai. Bagian terakhir adalah `learn-git-mastery-for-java-engineers-part-032.md`.

---

## 0. Ringkasan Eksekutif

Git tidak hanya menyimpan source code.

Dalam project Java nyata, repository bisa berisi:

- source code;
- test code;
- build descriptor;
- wrapper build tool;
- generated source;
- migration SQL;
- OpenAPI spec;
- protobuf schema;
- Dockerfile;
- CI config;
- IDE metadata;
- dependency lockfile;
- fixture test;
- script operational;
- documentation;
- binary kecil;
- kadang binary besar yang seharusnya tidak ada.

Masalahnya:

```text
Tidak semua file yang muncul di working tree layak menjadi bagian dari repository.
```

Skill penting Java engineer adalah membedakan:

```text
source of truth
derived artifact
local machine state
team-shared configuration
secret
build output
tool cache
generated-but-important contract
```

Jika salah memilih, repository akan menjadi:

- noisy;
- sulit direview;
- tidak reproducible;
- penuh conflict;
- lambat;
- rawan secret leakage;
- sulit di-build di CI;
- menyimpan artifact yang seharusnya berada di artifact repository;
- membingungkan engineer baru.

Part ini membangun mental model untuk menjawab:

```text
File ini harus di-commit atau di-ignore?
```

Bukan berdasarkan hafalan `.gitignore`, tetapi berdasarkan peran file dalam sistem.

---

## 1. Prinsip Utama: Repository Harus Menyimpan Source of Truth

Pertanyaan paling penting:

```text
Apakah file ini source of truth?
```

Jika ya, biasanya harus di-track.

Jika tidak, biasanya harus di-ignore.

Tetapi ada edge case.

Definisi praktis:

```text
Source of truth = input utama yang diperlukan untuk membangun, menguji,
menjalankan, memahami, atau mereproduksi sistem secara konsisten.
```

Contoh source of truth di Java project:

```text
src/main/java/**
src/test/java/**
pom.xml
build.gradle
settings.gradle
gradle.properties
mvnw
mvnw.cmd
.mvn/wrapper/maven-wrapper.properties
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.properties
gradle/wrapper/gradle-wrapper.jar
src/main/resources/**
src/test/resources/**
db/migration/**
openapi.yaml
proto/**
Dockerfile
docker-compose.test.yml
.github/workflows/**
.gitlab-ci.yml
.editorconfig
.gitattributes
.gitignore
README.md
```

Contoh bukan source of truth:

```text
target/**
build/**
out/**
.class
*.log
.idea/workspace.xml
*.iml dalam sebagian policy
.DS_Store
Thumbs.db
.env
local.properties
*.hprof
*.pid
*.tmp
```

Rule sederhana:

```text
Commit input yang dibutuhkan untuk menghasilkan output.
Jangan commit output yang bisa dihasilkan ulang dengan deterministik.
```

Namun rule ini perlu nuance.

Generated code kadang output, kadang contract artifact yang sengaja di-track.

Kita akan bahas detailnya.

---

## 2. Kategori File dalam Java Repository

Agar tidak menilai file satu per satu secara ad hoc, gunakan klasifikasi.

## 2.1 Human-Written Source

Contoh:

```text
src/main/java
src/test/java
src/main/kotlin
src/test/kotlin
```

Biasanya track.

Risiko jika tidak track:

- build gagal;
- fitur hilang;
- test hilang;
- code review tidak lengkap.

## 2.2 Build Definition

Contoh Maven:

```text
pom.xml
.mvn/**
mvnw
mvnw.cmd
```

Contoh Gradle:

```text
build.gradle
build.gradle.kts
settings.gradle
settings.gradle.kts
gradle.properties
gradle/**
gradlew
gradlew.bat
```

Biasanya track.

Build definition adalah kontrak reproducibility.

## 2.3 Build Output

Contoh:

```text
target/**
build/**
out/**
*.class
*.jar
*.war
*.ear
```

Biasanya ignore.

Output harus dibuat oleh build tool, bukan disimpan di Git.

## 2.4 Generated Source

Contoh:

```text
target/generated-sources/**
build/generated/**
src/generated/**
generated/**
```

Policy tergantung konteks.

Pertanyaan penting:

```text
Apakah generated code bisa dibuat ulang secara deterministik dari source of truth yang juga di-track?
```

Jika ya, biasanya ignore.

Jika tidak, mungkin track atau perbaiki proses generation.

## 2.5 Tool/IDE Metadata

Contoh:

```text
.idea/**
*.iml
.project
.classpath
.settings/**
.vscode/**
```

Policy tergantung tim.

Ada metadata yang personal/local, ada yang team-shared.

## 2.6 Runtime/Local State

Contoh:

```text
*.log
*.pid
tmp/**
.env
application-local.yml
docker-volume/**
```

Biasanya ignore.

## 2.7 Contract/Schema

Contoh:

```text
openapi.yaml
*.proto
avro/*.avsc
graphql/*.graphqls
db/migration/*.sql
```

Biasanya track.

Ini sering lebih penting daripada generated code-nya.

## 2.8 Dependency Lock/Version Pin

Contoh:

```text
gradle.lockfile
gradle/dependency-locks/**
pom.xml
.mvn/maven.config
```

Policy tergantung dependency strategy, tetapi untuk reproducibility sering track.

## 2.9 Artifact/Binary

Contoh:

```text
*.jar
*.war
*.zip
*.tar.gz
*.png
*.pdf
*.xlsx
```

Policy tergantung fungsi.

- Dependency jar: biasanya jangan track.
- Small test fixture: mungkin track.
- Large binary: pertimbangkan Git LFS atau external storage.
- Release artifact: jangan track, simpan di artifact registry.

---

## 3. Maven Project: Apa yang Perlu Di-track?

Typical Maven project:

```text
my-service/
  pom.xml
  mvnw
  mvnw.cmd
  .mvn/
    wrapper/
      maven-wrapper.properties
      maven-wrapper.jar
  src/
    main/
      java/
      resources/
    test/
      java/
      resources/
  target/
```

Track:

```text
pom.xml
mvnw
mvnw.cmd
.mvn/wrapper/maven-wrapper.properties
.mvn/wrapper/maven-wrapper.jar
src/**
README.md
```

Ignore:

```text
target/
*.class
```

## 3.1 Kenapa Maven Wrapper Perlu Di-track?

Maven wrapper membuat developer/CI memakai Maven version yang konsisten.

File penting:

```text
mvnw
mvnw.cmd
.mvn/wrapper/maven-wrapper.properties
.mvn/wrapper/maven-wrapper.jar
```

Jika wrapper tidak di-track:

- engineer perlu install Maven manual;
- versi Maven bisa berbeda;
- CI setup lebih kompleks;
- build reproducibility turun.

Untuk beberapa organisasi, wrapper jar boleh tidak di-track dan didownload. Tetapi secara praktik umum, wrapper files biasanya di-track agar onboarding dan CI lebih stabil.

Pastikan executable bit:

```bash
chmod +x mvnw
git update-index --chmod=+x mvnw
```

Cek:

```bash
git ls-files -s mvnw
```

## 3.2 Jangan Commit `target/`

`target/` adalah output Maven.

Isi bisa meliputi:

- compiled `.class`;
- jar/war;
- generated sources;
- surefire reports;
- coverage reports;
- temporary files;
- copied resources.

Jika `target/` di-commit:

- repository bloat;
- merge conflict;
- stale artifact;
- review noise;
- build behavior membingungkan;
- CI bisa memakai output lama secara tidak sengaja.

`.gitignore`:

```gitignore
target/
```

## 3.3 Maven Local Repository Jangan Pernah Di-track

Local Maven cache:

```text
~/.m2/repository
```

Jangan masuk repo.

Jika project punya `.m2/` local folder karena script, ignore:

```gitignore
.m2/
```

Dependency harus diselesaikan via Maven repository:

- Maven Central;
- internal Nexus/Artifactory;
- GitHub Packages;
- private artifact registry.

Bukan dengan commit jar ke Git.

---

## 4. Gradle Project: Apa yang Perlu Di-track?

Typical Gradle project:

```text
my-service/
  build.gradle
  settings.gradle
  gradle.properties
  gradlew
  gradlew.bat
  gradle/
    wrapper/
      gradle-wrapper.properties
      gradle-wrapper.jar
  src/
    main/
      java/
      resources/
    test/
      java/
      resources/
  build/
```

Track:

```text
build.gradle / build.gradle.kts
settings.gradle / settings.gradle.kts
gradle.properties
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.properties
gradle/wrapper/gradle-wrapper.jar
src/**
```

Ignore:

```text
build/
.gradle/
```

## 4.1 Kenapa Gradle Wrapper Perlu Di-track?

Gradle wrapper memastikan Gradle version konsisten.

File penting:

```text
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.properties
gradle/wrapper/gradle-wrapper.jar
```

Track semuanya.

Jika `gradle-wrapper.jar` tidak di-track, bootstrap bisa gagal di environment tanpa Gradle.

Pastikan executable:

```bash
chmod +x gradlew
git update-index --chmod=+x gradlew
```

## 4.2 Jangan Commit `build/`

`build/` adalah output Gradle.

Ignore:

```gitignore
build/
```

## 4.3 `.gradle/` Biasanya Local Cache

`.gradle/` menyimpan cache, task history, local state.

Ignore:

```gitignore
.gradle/
```

Jangan commit `.gradle/`.

## 4.4 Gradle Build Logic

Jika memakai convention plugins:

```text
buildSrc/**
build-logic/**
gradle/libs.versions.toml
```

Biasanya track.

Ini source of truth untuk build behavior.

---

## 5. `.gitignore` untuk Java Project

Contoh baseline `.gitignore`:

```gitignore
# Maven
target/

# Gradle
.gradle/
build/

# Compiled Java
*.class

# Package artifacts
*.jar
*.war
*.ear

# Logs
*.log
logs/

# Runtime temp
*.pid
*.tmp
tmp/
temp/

# OS files
.DS_Store
Thumbs.db

# IDE - IntelliJ local state
.idea/workspace.xml
.idea/tasks.xml
.idea/usage.statistics.xml
.idea/shelf/
*.iws

# Eclipse
.project
.classpath
.settings/

# VS Code local settings
.vscode/settings.json

# Environment/local config
.env
.env.*
application-local.yml
application-local.yaml

# Test/coverage reports
coverage/
jacoco.exec

# Heap dumps
*.hprof

# Node if project has frontend assets
node_modules/
```

Tetapi `.gitignore` bukan copy-paste buta.

Harus disesuaikan dengan policy repository.

Contoh:

- `*.jar` biasanya ignore, tetapi Gradle wrapper jar harus tetap tracked.
- `.vscode/settings.json` mungkin personal, tetapi `.vscode/extensions.json` bisa berguna untuk tim.
- `.idea` sebagian bisa track jika tim sepakat, sebagian harus ignore.
- `application-local.yml` biasanya ignore, tetapi `application-example.yml` track.

Gunakan exception:

```gitignore
*.jar
!gradle/wrapper/gradle-wrapper.jar
!.mvn/wrapper/maven-wrapper.jar
```

Jika Anda ignore semua jar, pastikan wrapper jar tidak ikut hilang.

---

## 6. `.gitignore` Bukan Security Boundary

Jika secret sudah pernah di-commit, menambah `.gitignore` tidak menghapus secret dari history.

Contoh buruk:

```text
1. Commit .env berisi password.
2. Tambah .env ke .gitignore.
3. Anggap aman.
```

Itu salah.

`.gitignore` hanya mencegah file untracked baru otomatis muncul dalam status.

Ia tidak:

- menghapus file yang sudah tracked;
- menghapus history;
- rotate secret;
- mencegah copy secret ke file lain;
- melindungi repository remote.

Jika secret bocor:

```text
1. Rotate secret.
2. Hapus dari working tree/index.
3. Pertimbangkan rewrite history jika perlu.
4. Audit access.
5. Tambahkan secret scanning/pre-commit.
```

Command untuk berhenti track file yang sudah tracked:

```bash
git rm --cached .env
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Stop tracking local environment file"
```

Tetapi history lama masih berisi secret.

Part security akan membahas lebih dalam di Part 027.

---

## 7. `.gitignore` Tidak Berlaku untuk File yang Sudah Tracked

Jika file sudah tracked, Git tetap memantau perubahan walau masuk `.gitignore`.

Contoh:

```bash
echo "target/" >> .gitignore
```

Jika `target/app.jar` sudah tracked, Git tetap melihat perubahan.

Cek tracked file:

```bash
git ls-files target/
```

Hapus dari index tapi biarkan lokal:

```bash
git rm -r --cached target/
git commit -m "Stop tracking build outputs"
```

Rule:

```text
.gitignore mencegah untracked file masuk radar.
.gitignore tidak menghapus tracking file yang sudah tracked.
```

---

## 8. Gunakan `.git/info/exclude` untuk Ignore Personal

Jika ignore hanya untuk diri sendiri:

```text
.git/info/exclude
```

Contoh:

```gitignore
# local scratch
scratch/
notes-local.md
```

Jangan masukkan preferensi personal ke `.gitignore` tim kecuali relevan untuk semua.

Alternatif global ignore:

```bash
git config --global core.excludesfile ~/.gitignore_global
```

Contoh global:

```gitignore
.DS_Store
.idea/workspace.xml
*.swp
```

Policy:

```text
.gitignore repo = aturan bersama.
.git/info/exclude = aturan lokal repo.
global ignore = aturan pribadi lintas repo.
```

---

## 9. IntelliJ IDEA: Track atau Ignore?

IntelliJ menghasilkan `.idea/` dan kadang `*.iml`.

Tidak ada satu jawaban universal.

## 9.1 Yang Biasanya Jangan Di-track

```text
.idea/workspace.xml
.idea/tasks.xml
.idea/usage.statistics.xml
.idea/shelf/
.idea/httpRequests/
*.iws
```

Ini local/user-specific.

## 9.2 Yang Kadang Di-track

```text
.idea/codeStyles/
.idea/inspectionProfiles/
.idea/runConfigurations/
.idea/vcs.xml
```

Jika tim sepakat, ini bisa membantu konsistensi.

Namun banyak tim memilih:

- track `.editorconfig`;
- track formatter config;
- track checkstyle/spotless config;
- biarkan IDE config personal.

## 9.3 Risiko Track `.idea` Berlebihan

- conflict sering;
- absolute path masuk;
- personal workspace tercampur;
- plugin-specific noise;
- developer non-IntelliJ terganggu;
- review penuh metadata.

## 9.4 Rekomendasi Praktis

Untuk tim Java modern:

```text
Track build-tool config and formatting rules.
Avoid tracking personal IDE state.
Use .editorconfig + formatter/linter in build/CI.
Optionally track shared run configurations if valuable.
```

Contoh ignore IntelliJ:

```gitignore
.idea/workspace.xml
.idea/tasks.xml
.idea/usage.statistics.xml
.idea/shelf/
*.iws
```

Jika memilih ignore semua `.idea/`:

```gitignore
.idea/
*.iml
```

Pastikan style dan inspection penting tetap tersedia via build tool.

---

## 10. Eclipse dan VS Code

Eclipse:

```text
.project
.classpath
.settings/
```

Sebagian tim track, sebagian ignore.

Risiko:

- path/environment local;
- versi plugin beda;
- conflict;
- tidak semua engineer pakai Eclipse.

VS Code:

```text
.vscode/settings.json
.vscode/launch.json
.vscode/tasks.json
.vscode/extensions.json
```

Policy umum:

- `extensions.json` bisa track untuk rekomendasi extension.
- `launch.json` dan `tasks.json` bisa track jika general.
- `settings.json` hati-hati karena bisa personal.

Contoh:

```gitignore
.vscode/settings.json
!.vscode/extensions.json
!.vscode/launch.json
!.vscode/tasks.json
```

Tetapi jangan memaksakan satu policy. Yang penting:

```text
Team-shared behavior boleh track.
Personal preference jangan track.
```

---

## 11. `.editorconfig`

`.editorconfig` sebaiknya di-track.

Contoh:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.java]
indent_style = space
indent_size = 4

[*.{yml,yaml}]
indent_style = space
indent_size = 2

[Makefile]
indent_style = tab
```

Manfaat:

- konsistensi lintas IDE;
- mengurangi diff noise;
- membantu cross-platform;
- simple dan language-agnostic.

`.editorconfig` bukan pengganti formatter, tetapi baseline yang baik.

---

## 12. Formatter dan Linter Config

Jika memakai:

- Spotless;
- Checkstyle;
- PMD;
- Error Prone;
- SpotBugs;
- google-java-format;
- Checkstyle XML;
- EditorConfig;
- ktlint untuk Kotlin;
- Palantir Java Format;
- ArchUnit tests.

Config harus di-track.

Contoh:

```text
config/checkstyle/checkstyle.xml
config/pmd/ruleset.xml
spotbugs-exclude.xml
```

Build file yang mengaktifkan plugin juga di-track.

Kenapa?

```text
Style dan static analysis adalah bagian dari build contract.
```

Jangan hanya mengandalkan setting IDE lokal.

---

## 13. Maven/Gradle Wrapper dan Executable Bit

Di Unix-like system, `mvnw` dan `gradlew` harus executable.

Cek:

```bash
ls -l mvnw gradlew
```

Git menyimpan executable bit.

Set:

```bash
git update-index --chmod=+x mvnw
git update-index --chmod=+x gradlew
```

Commit:

```bash
git commit -m "Make build wrappers executable"
```

Masalah umum:

```text
CI Linux gagal: Permission denied: ./gradlew
```

Penyebab:

- executable bit tidak committed;
- file dibuat dari Windows tanpa mode;
- zip extraction mengubah permission;
- Git config filemode bermasalah.

Cek Git mode:

```bash
git ls-files -s gradlew
```

Mode executable biasanya:

```text
100755
```

Non-executable:

```text
100644
```

---

## 14. Generated Code: Masalah Utama

Generated code adalah area paling sering menimbulkan debat.

Contoh generated code:

- OpenAPI generated server/client;
- protobuf/gRPC classes;
- Avro classes;
- jOOQ classes;
- QueryDSL Q-types;
- MapStruct implementations;
- Lombok-generated bytecode;
- annotation processor outputs;
- JAXB generated classes;
- Thrift generated classes.

Pertanyaan utama:

```text
Apa source of truth-nya?
```

Contoh:

```text
OpenAPI spec -> generated DTO/controller interface
.proto file   -> generated gRPC classes
DB schema     -> jOOQ generated classes
Java mapper   -> MapStruct generated implementation
```

Jika source of truth dan generator version di-track, generated output biasanya tidak perlu di-track.

Tetapi ada pengecualian.

---

## 15. Decision Matrix Generated Code

| Situasi | Track generated code? | Alasan |
|---|---:|---|
| Generated saat build secara deterministic | Tidak | Output bisa dibuat ulang |
| Generated code sangat besar | Tidak | Repo bloat |
| Generator/version/source spec di-track | Biasanya tidak | Reproducible |
| Generated code dipakai oleh consumer tanpa generator | Mungkin | Convenience/distribution |
| Generator tidak deterministic | Hindari / fix | Track bukan solusi ideal |
| Generated code perlu direview sebagai API artifact | Mungkin | Review output bisa bernilai |
| Generated code dari external schema yang tidak di-track | Mungkin, tapi buruk | Source of truth hilang |
| Generated code committed untuk library publik | Mungkin | Mempermudah consumer/source jar |
| Annotation processor output | Tidak | Build output |
| jOOQ generated from live DB | Tergantung | Lebih baik schema/migration jadi source of truth |
| OpenAPI generated client | Tergantung | Jika spec + generator pinned, tidak perlu |

Rule yang lebih matang:

```text
Track source specification dan generator configuration.
Track generated code hanya jika ada alasan distribusi/review/reproducibility yang kuat.
```

---

## 16. OpenAPI Generated Code

Typical inputs:

```text
openapi.yaml
openapi-generator config
pom.xml/build.gradle generator plugin config
templates jika custom
```

Output:

```text
target/generated-sources/openapi/**
build/generated/openapi/**
src/generated/java/**
```

Policy ideal:

```text
Track openapi.yaml dan generator config.
Generate code saat build.
Jangan track output generated jika build bisa menghasilkan ulang.
```

Namun banyak tim track generated OpenAPI code karena:

- ingin review generated API surface;
- generator lambat/berat;
- consumer tidak menjalankan generator;
- generated code dimodifikasi manual;
- build pipeline lama tidak support generation.

Jika generated code di-track:

```text
Jangan edit manual.
Pisahkan commit spec change dan generated output jika memungkinkan.
Pastikan generator version pinned.
Tambahkan check di CI agar generated output up-to-date.
```

Anti-pattern:

```text
Edit generated file langsung untuk quick fix.
```

Itu akan hilang saat regenerate.

---

## 17. Protobuf/gRPC Generated Code

Source of truth:

```text
proto/**/*.proto
```

Track:

```text
proto/**/*.proto
build plugin config
```

Usually ignore generated Java:

```text
build/generated/source/proto/**
target/generated-sources/protobuf/**
```

Jika generated code di-track untuk distribution, pastikan:

- generator version jelas;
- output deterministic;
- tidak diedit manual;
- perubahan `.proto` dan generated output konsisten;
- breaking change direview.

Protobuf compatibility forensic penting:

- field number tidak boleh reuse sembarangan;
- rename field name tidak sama dengan mengubah field number;
- removing field perlu reserved;
- default value semantics;
- oneof changes;
- package/java_package changes.

Git history `.proto` sering lebih penting daripada generated Java.

---

## 18. jOOQ / QueryDSL / Database-Driven Generated Code

jOOQ classes bisa generated dari:

- live database;
- migration scripts;
- schema dump;
- XML schema.

Source of truth ideal:

```text
db/migration/**
jooq generation config
```

Jika generation butuh live DB, CI harus bisa menyiapkan DB deterministic.

Policy:

- jangan track generated jOOQ jika build bisa generate;
- track migration/config;
- jika generated jOOQ di-track, pastikan regeneration check.

Masalah umum:

```text
Developer A regenerate dengan DB lokal yang punya schema ekstra.
Developer B mendapat generated code yang tidak sesuai migration.
```

Solusi:

- generate dari clean DB + migrations;
- containerized generation;
- CI verification;
- no manual DB drift.

QueryDSL Q-classes biasanya generated oleh annotation processing.

Biasanya ignore.

---

## 19. MapStruct dan Lombok

MapStruct generated implementation:

```text
target/generated-sources/annotations/**
build/generated/sources/annotationProcessor/**
```

Jangan track.

Lombok tidak menghasilkan source Java yang biasanya di-track.

Yang perlu di-track:

- dependency version;
- annotation usage;
- compiler plugin config;
- IDE setup docs if needed;
- delombok output hanya jika memang dipakai sebagai artifact khusus.

Masalah forensic:

- generated mapper behavior berubah karena MapStruct upgrade;
- Lombok behavior berubah karena version/JDK;
- annotation processor disabled di IDE;
- CI dan IDE berbeda.

Source of truth tetap Java source + build config.

---

## 20. Annotation Processing Output

Common paths:

```text
target/generated-sources/annotations/
build/generated/sources/annotationProcessor/java/main/
```

Ignore:

```gitignore
target/generated-sources/
build/generated/
```

Tetapi hati-hati.

Jika project menaruh generated source di `src/main/generated`, tentukan policy:

```text
Apakah ini generated tetapi intentionally tracked?
Atau salah konfigurasi?
```

Lebih baik output generated masuk ke `target/` atau `build/`, bukan `src/main`.

---

## 21. Dependency Lockfiles

Gradle dependency locking:

```text
gradle.lockfile
gradle/dependency-locks/**
```

Version catalogs:

```text
gradle/libs.versions.toml
```

Track jika digunakan.

Manfaat:

- reproducible dependency resolution;
- diff dependency jelas;
- supply chain review;
- rollback dependency mudah;
- CI konsisten.

Maven tidak punya lockfile built-in umum seperti Gradle, tetapi version pin di `pom.xml` atau BOM tetap source of truth.

Jika menggunakan tools khusus lock Maven dependency, track lockfile jika itu bagian build contract.

Policy:

```text
Jika lockfile memengaruhi dependency resolution, track.
Jika file hanya local cache, ignore.
```

---

## 22. Maven `pom.xml`: Parent, BOM, dan Dependency Management

`pom.xml` adalah source of truth.

Review perubahan `pom.xml` dengan serius.

Perubahan kecil bisa berdampak besar:

- parent version;
- Spring Boot version;
- BOM version;
- plugin version;
- compiler release;
- surefire/failsafe config;
- annotation processor;
- dependency scope;
- dependency exclusion;
- repository definition;
- profile activation.

Git hygiene:

```text
Jangan campur dependency upgrade besar dengan unrelated refactor.
Commit dependency upgrade terpisah.
Tambahkan test/verification.
Catat migration guide jika major upgrade.
```

Forensic:

```bash
git log -p -- pom.xml
git log -G'<artifactId>|<version>|<scope>|<exclusion>' -p -- pom.xml
```

---

## 23. Gradle Build Files

Track:

```text
settings.gradle(.kts)
build.gradle(.kts)
gradle.properties
gradle/libs.versions.toml
buildSrc/**
build-logic/**
```

Ignore:

```text
.gradle/
build/
```

Review perubahan Gradle:

- plugin version;
- dependency scope `api` vs `implementation`;
- task configuration;
- test filtering;
- Java toolchain;
- annotation processor;
- publishing config;
- repository config;
- build cache config;
- dependency locking.

Gradle build logic adalah code.

Treat it like production code.

---

## 24. Java Version Files

Beberapa repo memakai:

```text
.java-version
sdkmanrc
.tool-versions
```

Contoh:

```text
.java-version
.sdkmanrc
.tool-versions
```

Track jika tim menggunakannya untuk konsistensi.

Manfaat:

- onboarding mudah;
- CI/local parity;
- bisect/reproduction lebih stabil;
- JDK upgrade traceable.

Jika Java version hanya ada di README tapi build file berbeda, confusion muncul.

Lebih baik punya satu atau beberapa source yang konsisten:

- Maven compiler release;
- Gradle toolchain;
- `.java-version`;
- CI config.

---

## 25. Resource Files

Track:

```text
src/main/resources/**
src/test/resources/**
```

Tetapi hati-hati dengan:

- local config;
- secret;
- environment-specific override;
- large fixtures;
- generated resources;
- binary fixtures.

Example:

```text
application.yml              track
application-test.yml         track
application-local.yml        ignore
application-prod.yml         depends, often config repo/deployment-owned
application-example.yml      track
```

Rule:

```text
Track safe defaults and test config.
Do not track local secrets or machine-specific config.
```

Use placeholders:

```yaml
database:
  password: ${DATABASE_PASSWORD}
```

Never commit real passwords.

---

## 26. Database Migration Files

Track migration files.

Examples:

```text
src/main/resources/db/migration/V202606170900__add_case_status.sql
db/migration/**
liquibase/changelog/**
```

Migration is source of truth for schema evolution.

Rules:

```text
[ ] Migration file should be immutable after release.
[ ] Do not edit old migration casually.
[ ] Add new migration for schema change.
[ ] Include rollback strategy if tool/process requires.
[ ] Keep migration and code compatibility in mind.
[ ] Review data backfill carefully.
```

Git implications:

- migration conflict can happen when two branches create same version number;
- timestamp naming reduces conflict;
- sequential numbering can conflict;
- modifying released migration breaks reproducibility.

Ignore generated DB dumps unless intentionally small/test fixture.

Do not commit production dumps.

---

## 27. Test Fixtures

Test fixtures can be source of truth.

Examples:

```text
src/test/resources/contracts/case-response.json
src/test/resources/fixtures/case-escalation.json
src/test/resources/certs/test-cert.pem
src/test/resources/wiremock/**
```

Track if:

- small;
- non-secret;
- necessary for tests;
- stable;
- documented;
- not generated from hidden source.

Avoid:

- huge production-like dumps;
- real PII;
- real credentials;
- random binary blobs without explanation;
- flaky time-dependent snapshots.

If fixture generated, track generator or generation instructions.

For snapshot tests, review diffs carefully.

---

## 28. Certificates and Keys in Tests

Test certificates may be tracked if they are clearly non-production and safe.

But private keys are sensitive by default.

Rules:

```text
[ ] Never commit production private keys.
[ ] Test keys must be clearly labeled test-only.
[ ] Use low-risk generated keys for local tests.
[ ] Document that they are not trusted credentials.
[ ] Secret scanner allowlist only with care.
```

Example naming:

```text
src/test/resources/certs/test-only-private-key.pem
src/test/resources/certs/README.md
```

README:

```text
These keys are generated for tests only and are not used in any environment.
```

If unsure, don't commit.

---

## 29. Binary Artifacts

Common bad practice:

```text
lib/some-dependency.jar
```

Better:

```text
Declare dependency in Maven/Gradle.
Store artifact in Nexus/Artifactory/GitHub Packages.
```

Track binary only if:

- small;
- no better source exists;
- license allows;
- required as test fixture;
- version/source documented.

Never track release artifacts:

```text
target/my-service-1.2.3.jar
build/libs/my-service-1.2.3.jar
```

Those belong in artifact repository.

If binary is large and necessary, consider Git LFS.

Part 026 will cover large files and Git LFS in depth.

---

## 30. Logs, Reports, Coverage, and Runtime Outputs

Ignore:

```gitignore
*.log
logs/
target/surefire-reports/
target/failsafe-reports/
build/reports/
build/test-results/
coverage/
jacoco.exec
```

Usually reports are generated outputs.

Exceptions:

- curated benchmark report in docs;
- architecture decision evidence;
- manually written report;
- release note.

Do not commit raw local logs unless intentionally anonymized and documented.

Logs may contain secrets/PII.

---

## 31. Docker, Compose, and Local Environment Files

Track:

```text
Dockerfile
docker-compose.yml
docker-compose.test.yml
.dockerignore
```

Maybe track:

```text
docker-compose.local.yml.example
```

Ignore:

```text
.env
.env.local
docker-data/
postgres-data/
```

Be careful:

```text
docker-compose.yml may reference .env,
but .env should usually be local and ignored.
```

Provide example:

```text
.env.example
```

Track `.env.example` with fake values:

```dotenv
DATABASE_URL=jdbc:postgresql://localhost:5432/app
DATABASE_USERNAME=app
DATABASE_PASSWORD=change-me
```

Never commit real `.env`.

---

## 32. Kubernetes/Helm/Deployment Config

If repository owns deployment config, track:

```text
k8s/**
helm/**
charts/**
skaffold.yaml
tiltfile
```

But separate:

- template/source manifests;
- generated rendered manifests;
- environment secrets;
- local kubeconfig.

Ignore:

```text
kubeconfig
*.key
secrets.yaml
```

If using sealed secrets or encrypted secrets, policy depends on tooling.

But plain Kubernetes Secret YAML with base64 password is not safe.

Base64 is encoding, not encryption.

---

## 33. CI/CD Config

Track:

```text
.github/workflows/**
.gitlab-ci.yml
Jenkinsfile
.circleci/config.yml
azure-pipelines.yml
```

CI config is source of truth for delivery behavior.

Review changes carefully:

- test steps removed;
- security scan disabled;
- branch filter changed;
- deploy condition changed;
- artifact publishing changed;
- Java version changed;
- cache key changed;
- secret usage changed.

CI config changes can be as risky as source code changes.

---

## 34. Scripts

Track useful scripts:

```text
scripts/build.sh
scripts/test.sh
scripts/run-local.sh
scripts/generate-openapi.sh
scripts/bisect-regression.sh
```

Rules:

```text
[ ] Scripts should be executable if shell scripts.
[ ] Scripts should fail fast.
[ ] Scripts should not assume personal paths.
[ ] Scripts should not embed secrets.
[ ] Scripts should be documented.
[ ] Scripts should work from repo root or detect path.
```

Use:

```bash
git update-index --chmod=+x scripts/*.sh
```

Ignore script outputs.

---

## 35. README and Documentation

Track:

```text
README.md
docs/**
adr/**
CHANGELOG.md
CONTRIBUTING.md
```

Docs are source of truth for human process.

For Java project, include:

- build command;
- test command;
- required JDK;
- local setup;
- DB setup;
- code generation;
- dependency update process;
- release process;
- repository policy;
- generated code policy;
- secret handling;
- branch/PR rules.

Good docs reduce accidental Git misuse.

---

## 36. Architecture Decision Records

Track ADRs:

```text
docs/adr/0001-use-gradle-toolchains.md
docs/adr/0002-track-openapi-generated-code.md
```

Generated code policy and repo hygiene decisions should be explicit.

Example ADR topics:

```text
- Track Gradle wrapper jar.
- Do not track generated OpenAPI server code.
- Track OpenAPI spec as source of truth.
- Use Gradle dependency locking.
- Ignore IDE workspace files.
- Store binary test fixtures under Git LFS.
```

ADR helps future forensic:

```text
Why is generated code tracked here?
```

---

## 37. `.gitattributes` untuk Java Repository

`.gitattributes` controls normalization and attributes.

Baseline:

```gitattributes
* text=auto

*.java text eol=lf
*.xml text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.properties text eol=lf
*.sh text eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf

*.jar binary
*.war binary
*.ear binary
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
```

Benefits:

- reduce CRLF/LF noise;
- mark binary files;
- keep shell scripts LF;
- keep Windows scripts CRLF if needed;
- make cross-platform collaboration safer.

Part 022 will go deeper on line endings, whitespace, encoding, and cross-platform issues.

---

## 38. Repository Hygiene Checklist

For Java repository:

```text
[ ] Build outputs ignored.
[ ] Wrapper files tracked.
[ ] Wrapper shell scripts executable.
[ ] Build definitions tracked.
[ ] Source/test/resource files tracked.
[ ] `.gitignore` has wrapper jar exceptions if ignoring `*.jar`.
[ ] `.editorconfig` tracked.
[ ] `.gitattributes` tracked.
[ ] IDE personal state ignored.
[ ] Team-shared IDE/tool config policy explicit.
[ ] Generated code policy documented.
[ ] Dependency lock/version files tracked if used.
[ ] Migration files tracked and immutable after release.
[ ] Secrets ignored and scanned.
[ ] `.env.example` tracked, `.env` ignored.
[ ] CI config tracked.
[ ] Scripts tracked and executable.
[ ] Binary artifact policy clear.
[ ] Large files avoided or handled with LFS/external storage.
```

---

## 39. Example `.gitignore` for Maven Service

```gitignore
# Maven
target/

# Java
*.class

# Packages
*.jar
*.war
*.ear
!.mvn/wrapper/maven-wrapper.jar

# Logs/runtime
*.log
logs/
*.pid
tmp/
temp/

# OS
.DS_Store
Thumbs.db

# IDE - IntelliJ
.idea/workspace.xml
.idea/tasks.xml
.idea/usage.statistics.xml
.idea/shelf/
*.iws

# Eclipse
.project
.classpath
.settings/

# VS Code local
.vscode/settings.json

# Local env
.env
.env.*
application-local.yml
application-local.yaml

# Coverage/reports
coverage/
jacoco.exec

# Dumps
*.hprof
```

If you choose to ignore all IntelliJ project config:

```gitignore
.idea/
*.iml
```

But then use `.editorconfig` and build-enforced formatting.

---

## 40. Example `.gitignore` for Gradle Service

```gitignore
# Gradle
.gradle/
build/

# Java
*.class

# Packages
*.jar
*.war
*.ear
!gradle/wrapper/gradle-wrapper.jar

# Logs/runtime
*.log
logs/
*.pid
tmp/
temp/

# OS
.DS_Store
Thumbs.db

# IDE
.idea/workspace.xml
.idea/tasks.xml
.idea/usage.statistics.xml
.idea/shelf/
*.iws
.project
.classpath
.settings/
.vscode/settings.json

# Local env
.env
.env.*
application-local.yml
application-local.yaml

# Coverage/reports
coverage/
jacoco.exec

# Dumps
*.hprof
```

---

## 41. Example Repository Layout: Maven Microservice

```text
case-service/
  .editorconfig
  .gitattributes
  .gitignore
  README.md
  pom.xml
  mvnw
  mvnw.cmd
  .mvn/
    wrapper/
      maven-wrapper.properties
      maven-wrapper.jar
  src/
    main/
      java/
        com/acme/caseservice/
      resources/
        application.yml
        db/migration/
    test/
      java/
      resources/
  docs/
    adr/
  scripts/
    run-local.sh
    test.sh
  Dockerfile
  docker-compose.test.yml
  .github/
    workflows/
      ci.yml
```

Good properties:

- build reproducible;
- wrapper tracked;
- generated output absent;
- migration tracked;
- docs tracked;
- scripts tracked;
- local env ignored;
- CI config tracked.

---

## 42. Example Repository Layout: Gradle Multi-Module

```text
case-platform/
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  gradlew
  gradlew.bat
  gradle/
    wrapper/
      gradle-wrapper.properties
      gradle-wrapper.jar
    libs.versions.toml
  build-logic/
  services/
    case-service/
      build.gradle.kts
      src/
    notification-service/
      build.gradle.kts
      src/
  libs/
    workflow-core/
      build.gradle.kts
      src/
    audit-core/
      build.gradle.kts
      src/
  docs/
  scripts/
  .github/workflows/
```

Good properties:

- shared build logic tracked;
- version catalog tracked;
- modules explicit;
- build output ignored globally;
- source of truth visible.

---

## 43. Detecting Bad Repository Hygiene

Run:

```bash
git status --short
```

If every build/test creates many untracked files, `.gitignore` is incomplete.

Run:

```bash
git ls-files | grep -E 'target/|build/|\.class$|\.log$'
```

If output appears, build artifacts may be tracked.

Run:

```bash
git ls-files | grep -E '\.jar$|\.war$|\.ear$'
```

Check whether these are legitimate wrapper/test fixtures or bad artifacts.

Run:

```bash
git ls-files | grep -E '\.env|secret|password|private-key'
```

Investigate immediately.

Run:

```bash
git check-ignore -v path/to/file
```

Understand why a file is ignored.

Run:

```bash
git ls-files --others --ignored --exclude-standard
```

See ignored files.

Run:

```bash
git clean -ndX
```

Preview ignored files that would be removed.

Do not run destructive clean blindly.

---

## 44. Removing Accidentally Tracked Build Artifacts

If `target/` or `build/` is tracked:

```bash
git rm -r --cached target/
git rm -r --cached build/
```

Add ignore:

```bash
echo "target/" >> .gitignore
echo "build/" >> .gitignore
```

Commit:

```bash
git add .gitignore
git commit -m "Stop tracking build outputs"
```

If artifacts are large and history is bloated, removing from current tree is not enough. History still contains them.

That needs history cleanup, covered in Part 028.

---

## 45. Removing Accidentally Tracked IDE Files

If personal IntelliJ files tracked:

```bash
git rm --cached .idea/workspace.xml
echo ".idea/workspace.xml" >> .gitignore
git add .gitignore
git commit -m "Stop tracking IntelliJ workspace state"
```

If many:

```bash
git rm -r --cached .idea/
```

But be careful if some `.idea` files are intentionally shared.

Better:

```text
Decide team policy first.
Then remove only personal/local files.
```

---

## 46. Preventing Noise in Pull Requests

Repository hygiene affects PR quality.

Noise sources:

- generated files committed accidentally;
- formatting mixed with logic;
- IDE metadata;
- line ending changes;
- dependency lockfile changed unintentionally;
- build output;
- test report;
- local config.

Before PR:

```bash
git status --short
git diff --stat
git diff --check
git diff --name-only
```

Check unexpected files:

```bash
git diff --name-only | sort
```

If PR includes 200 files due to formatting, split mechanical commit.

If dependency lockfile changed, explain why.

If generated code changed, ensure source spec changed too.

---

## 47. Git Hooks for Repository Hygiene

Client-side pre-commit can block obvious mistakes.

Example checks:

- no `target/` or `build/`;
- no `.env`;
- no large file;
- no secret pattern;
- generated code up-to-date;
- formatting applied.

But hooks are not enough.

CI/server-side checks are stronger.

Part 023 will go deeper on hooks.

Simple pre-commit idea:

```bash
#!/usr/bin/env bash
set -euo pipefail

if git diff --cached --name-only | grep -E '(^target/|^build/|\.class$|\.log$|^\.env$)'; then
  echo "Refusing to commit generated/local files"
  exit 1
fi
```

---

## 48. CI Checks for Repository Hygiene

CI can verify:

```bash
./mvnw clean verify
git diff --exit-code
```

The second command catches generated output drift after build.

For Gradle:

```bash
./gradlew clean build
git diff --exit-code
```

If build modifies tracked files, something is wrong or generation policy needs explicit handling.

For generated code policy:

```text
If generated code is tracked:
  CI should regenerate and assert no diff.

If generated code is not tracked:
  CI should ensure build generates it successfully.
```

---

## 49. Source of Truth Decision Questions

When unsure whether to track a file, ask:

```text
1. Is it written by humans?
2. Is it required to build/test/run the project?
3. Can it be generated deterministically from tracked inputs?
4. Is the generator version/config tracked?
5. Is it machine/user-specific?
6. Does it contain secrets or local paths?
7. Is it large/binary?
8. Would reviewing changes to it be meaningful?
9. Would deleting it and rebuilding recreate it exactly?
10. Would a fresh clone work without it?
11. Does CI need it?
12. Does production/release traceability need it?
```

Decision:

```text
Track if it is source of truth or shared contract.
Ignore if it is derived/local/cache/secret.
Use artifact registry/LFS if it is large binary with legitimate need.
```

---

## 50. Java-Specific Anti-Patterns

## 50.1 Commit `target/` or `build/`

Almost always wrong.

## 50.2 Commit Local `.env`

Security risk.

## 50.3 Commit Generated Code and Edit It Manually

Future regeneration overwrites changes.

## 50.4 Ignore Wrapper Jar Accidentally

Build bootstrap fails for fresh clone.

## 50.5 Track Personal IDE State

PR noise and conflicts.

## 50.6 Mix Dependency Upgrade with Large Refactor

Review and forensic nightmare.

## 50.7 Commit Production Data Dump

Security/privacy/compliance risk.

## 50.8 Modify Released Migration

Breaks reproducibility and environment consistency.

## 50.9 Store Internal Jar in `lib/`

Use artifact repository unless exceptional.

## 50.10 Let Build Produce Dirty Working Tree

If `mvn clean verify` or `gradle build` modifies tracked files, policy is unclear or generation check missing.

---

## 51. Case Study: Generated OpenAPI Code in PR

PR includes:

```text
openapi.yaml
src/main/java/com/acme/generated/api/CasesApi.java
src/main/java/com/acme/generated/model/CaseDto.java
```

Questions:

```text
Is generated code intentionally tracked?
Was generator version changed?
Can reviewer see meaningful API diff from spec alone?
Was generated output edited manually?
Does CI verify generated output?
```

Good PR structure:

```text
Commit 1: Update OpenAPI spec for statusReason.
Commit 2: Regenerate OpenAPI server stubs.
Commit 3: Implement mapping and tests.
```

Bad PR:

```text
Huge generated diff mixed with business logic and formatting.
```

---

## 52. Case Study: Maven Wrapper Missing

New engineer clones repo:

```bash
./mvnw clean test
```

Fails:

```text
No such file or directory: ./mvnw
```

Or:

```text
Could not find .mvn/wrapper/maven-wrapper.jar
```

Root cause:

- wrapper not committed;
- `.gitignore` excluded jar;
- build docs assume global Maven.

Fix:

```bash
mvn -N wrapper:wrapper
git add mvnw mvnw.cmd .mvn/wrapper/
git update-index --chmod=+x mvnw
git commit -m "Add Maven wrapper for reproducible builds"
```

---

## 53. Case Study: Gradle Build Dirty After Test

After running:

```bash
./gradlew test
```

`git status` shows:

```text
modified: src/main/generated/com/acme/Foo.java
```

Interpretation:

```text
Build modifies tracked generated code.
```

Options:

1. Stop tracking generated code.
2. Make generation deterministic and require explicit regenerate.
3. CI checks generated output.
4. Move generated output under `build/`.
5. Document workflow.

Do not ignore the symptom. Dirty build output creates PR noise and hidden drift.

---

## 54. Case Study: Dependency Lockfile Changed Unexpectedly

PR changes only Java code, but also:

```text
gradle.lockfile
```

Questions:

```text
Did developer run dependency update?
Did Gradle resolve dynamic version?
Is there a plugin causing lock update?
Are versions pinned?
Is lockfile supposed to change?
```

If unexpected, revert lockfile or investigate dependency resolution.

Dynamic versions like:

```text
1.+
latest.release
```

are poor for reproducibility.

Prefer fixed versions or controlled dependency update process.

---

## 55. Case Study: Migration Conflict

Two branches add migration:

```text
V42__add_case_priority.sql
V42__add_escalation_reason.sql
```

Merge conflict or migration ordering issue.

Strategies:

- timestamp-based migration names;
- branch discipline;
- migration conflict review;
- migration validation in CI;
- avoid editing released migrations.

Git hygiene:

```text
Migration files are source of truth for schema state.
Treat them as high-risk files.
```

---

## 56. Case Study: IDE File Conflict

Two developers keep conflicting on:

```text
.idea/workspace.xml
```

Root cause:

```text
Personal IDE state tracked.
```

Fix:

```bash
git rm --cached .idea/workspace.xml
echo ".idea/workspace.xml" >> .gitignore
git commit -m "Stop tracking IntelliJ workspace state"
```

Consider adding `.editorconfig` and build-level formatter so team consistency doesn't depend on workspace file.

---

## 57. Practical Review Checklist for Java PRs

When reviewing PR:

```text
[ ] Are there unexpected generated/build files?
[ ] Are dependency/build files changed intentionally?
[ ] Are Maven/Gradle wrapper changes intentional?
[ ] Are migration files correct and ordered?
[ ] Are resource/config changes safe?
[ ] Are secrets accidentally included?
[ ] Are IDE/local files included?
[ ] Are binary files justified?
[ ] Are generated files consistent with source spec?
[ ] Are tests/fixtures meaningful and safe?
[ ] Does build produce clean working tree?
[ ] Are line ending changes accidental?
```

Command:

```bash
git diff --name-status main...HEAD
git diff --stat main...HEAD
```

---

## 58. Practical Maintainer Checklist

As repository maintainer:

```text
[ ] Maintain `.gitignore`.
[ ] Maintain `.gitattributes`.
[ ] Maintain `.editorconfig`.
[ ] Document generated code policy.
[ ] Document dependency update policy.
[ ] Add CI guard for generated drift if needed.
[ ] Add secret scanning.
[ ] Add large-file guard.
[ ] Keep wrapper updated intentionally.
[ ] Remove tracked build outputs.
[ ] Add `.git-blame-ignore-revs` for formatting commits.
[ ] Keep README onboarding accurate.
[ ] Audit repository periodically.
```

Periodic audit commands:

```bash
git ls-files | grep -E 'target/|build/|\.class$|\.log$|\.hprof$'
git ls-files | grep -E '\.jar$|\.war$|\.ear$'
git status --ignored --short
```

---

## 59. Latihan Praktis

## Latihan 1 — Audit Java Repository

Di repo Java Anda:

```bash
git ls-files | grep -E 'target/|build/|\.class$|\.log$|\.hprof$'
```

Jika ada output, klasifikasikan:

```text
Legitimate or bad hygiene?
```

## Latihan 2 — Audit Binary

```bash
git ls-files | grep -E '\.(jar|war|ear|zip|tar.gz|png|pdf)$'
```

Untuk setiap binary:

```text
Apakah source-nya jelas?
Apakah ukuran masuk akal?
Apakah harus di Git?
Apakah lebih cocok di artifact repository/LFS?
```

## Latihan 3 — Build Cleanliness

Run:

```bash
git status --short
./mvnw clean test
git status --short
```

Atau:

```bash
git status --short
./gradlew clean test
git status --short
```

Jika build mengubah tracked files, investigasi.

## Latihan 4 — Generated Code Policy

Pilih satu generated code mechanism:

- OpenAPI;
- protobuf;
- jOOQ;
- MapStruct;
- QueryDSL.

Jawab:

```text
Apa source of truth?
Apakah output di-track?
Apakah generator version pinned?
Apakah CI memverifikasi drift?
Apakah developer boleh edit generated output?
```

## Latihan 5 — Wrapper Check

```bash
git ls-files -s mvnw gradlew 2>/dev/null || true
git ls-files | grep -E 'maven-wrapper|gradle-wrapper'
```

Pastikan wrapper lengkap dan executable.

## Latihan 6 — Ignore Behavior

Pilih file ignored:

```bash
git check-ignore -v path/to/file
```

Cari aturan ignore yang memengaruhinya.

---

## 60. Pertanyaan Reflektif

1. Apakah fresh clone repo Anda bisa build tanpa setup manual berlebihan?
2. Apakah build menghasilkan working tree bersih?
3. Apakah generated code policy tertulis?
4. Apakah wrapper build tool di-track lengkap?
5. Apakah dependency version reproducible?
6. Apakah artifact binary disimpan di tempat tepat?
7. Apakah `.gitignore` terlalu agresif dan mengabaikan file penting?
8. Apakah `.gitignore` terlalu lemah dan membiarkan noise?
9. Apakah IDE metadata yang di-track benar-benar team-shared?
10. Apakah migration history bisa dipercaya?
11. Apakah secret/local config aman?
12. Apakah PR sering penuh file tidak relevan?
13. Apakah line ending/formatting sering menciptakan diff noise?
14. Apakah repository layout mencerminkan boundary arsitektur?
15. Apakah aturan repository bisa dijelaskan kepada engineer baru?

---

## 61. Mental Model Akhir

Untuk Java project, Git hygiene bukan urusan kosmetik.

Ia memengaruhi:

- onboarding;
- CI stability;
- review quality;
- release reproducibility;
- incident forensic;
- security;
- team velocity;
- architecture clarity.

Pertanyaan utama setiap file:

```text
Apakah ini source of truth, derived output, local state, secret, atau artifact?
```

Keputusan:

```text
Source of truth -> track.
Derived deterministic output -> ignore.
Local state -> ignore.
Secret -> never commit.
Large artifact -> artifact registry or LFS.
Generated code -> define explicit policy.
```

Repository yang sehat membuat engineer bisa percaya bahwa:

```text
Fresh clone + documented command = reproducible system.
```

Itu standar minimal untuk tim Java yang serius.

---

## 62. Koneksi ke Part Berikutnya

Part ini membahas repository hygiene khusus Java.

Part berikutnya akan mendalami salah satu sumber noise dan bug lintas platform paling umum:

```text
learn-git-mastery-for-java-engineers-part-022.md
```

Topik:

```text
Line Endings, Whitespace, Encoding, dan Cross-Platform Issues
```

Kita akan membahas:

- LF vs CRLF;
- `core.autocrlf`;
- `.gitattributes`;
- executable bit;
- file mode;
- encoding;
- case sensitivity;
- whitespace;
- Windows/macOS/Linux differences;
- dampaknya ke Java, shell script, Docker, CI, dan build reproducibility.

---

## 63. Referensi

Rujukan utama untuk materi ini:

- Git official documentation: `.gitignore`, attributes, clean, check-ignore, ls-files
- Git official documentation: file mode and index behavior
- Maven Wrapper and Maven project conventions
- Gradle Wrapper, Gradle project layout, dependency locking, version catalogs
- Java build conventions for Maven/Gradle
- Praktik umum repository hygiene, generated code policy, CI reproducibility, and artifact management

---

## 64. Status Seri

```text
Progress: 021 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

Bagian berikutnya:

```text
learn-git-mastery-for-java-engineers-part-022.md
```

Topik:

```text
Line Endings, Whitespace, Encoding, dan Cross-Platform Issues
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 020 — Blame, Pickaxe, dan Forensic Code Archaeology](./learn-git-mastery-for-java-engineers-part-020.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Part 022 — Line Endings, Whitespace, Encoding, dan Cross-Platform Issues](./learn-git-mastery-for-java-engineers-part-022.md)
