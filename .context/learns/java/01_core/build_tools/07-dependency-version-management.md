# Part 7 — Dependency Version Management: BOM, Platforms, Constraints, Catalogs, Locking

Seri: `learn-java-build-gradle-maven-engineering`  
File: `07-dependency-version-management.md`  
Target Java: 8 sampai 25  
Fokus: Maven, Gradle, dependency version governance, reproducibility, enterprise build policy

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas dependency graph: direct dependency, transitive dependency, scope, configuration, variant, conflict, classpath, dan runtime mismatch.

Bagian ini naik satu level: bukan lagi hanya "dependency apa yang masuk", tetapi:

> Bagaimana sebuah organisasi mengontrol **versi dependency** sehingga build tetap stabil, aman, reproducible, dan bisa berkembang tanpa chaos?

Dependency version management adalah salah satu area yang membedakan engineer biasa dengan engineer yang benar-benar matang. Banyak engineer bisa menambahkan dependency. Lebih sedikit yang bisa menjawab:

- siapa yang berhak menentukan versi dependency?
- versi mana yang boleh dipakai semua module?
- bagaimana mencegah module A memakai Jackson 2.15, module B memakai 2.17, module C menarik 2.13 secara transitive?
- kapan versi harus ditulis langsung di dependency declaration?
- kapan harus diletakkan di BOM/platform/catalog?
- bagaimana update versi dilakukan tanpa membuat runtime classpath rusak?
- bagaimana mencegah build hari ini diam-diam berubah karena transitive dependency atau dynamic version?
- bagaimana memastikan dependency graph sama antara laptop developer, CI, release job, dan production artifact?

Mental model utama bagian ini:

> Dependency version management bukan tentang "menaruh versi di satu tempat". Itu adalah proses membuat **policy layer** di atas dependency graph.

---

## 2. Masalah yang Sebenarnya Diselesaikan oleh Version Management

Misalkan sebuah sistem punya 50 module. Masing-masing module butuh library berbeda:

- REST client
- JSON library
- logging
- validation
- JPA provider
- metrics
- test framework
- mock framework
- security library
- database driver
- OpenAPI generated client
- gRPC/protobuf
- cloud SDK

Jika setiap module bebas menentukan versinya sendiri, sistem akan mengalami beberapa masalah.

### 2.1 Version Drift

Version drift terjadi ketika module yang berbeda memakai versi library yang berbeda tanpa alasan arsitektural yang jelas.

Contoh:

```text
application-service  -> com.fasterxml.jackson.core:jackson-databind:2.17.2
report-service       -> com.fasterxml.jackson.core:jackson-databind:2.15.4
audit-service        -> transitive jackson-databind:2.13.5
```

Di compile time mungkin aman. Di runtime bisa bermasalah jika semua module dikemas dalam satu aplikasi, satu fat JAR, satu WAR, satu app server, atau satu shared runtime.

Masalah umum:

- `NoSuchMethodError`
- `NoClassDefFoundError`
- behavior berubah diam-diam
- CVE tetap ada karena satu dependency lama masih masuk
- debugging sulit karena classpath final tidak sama dengan dependency yang terlihat di module tertentu

### 2.2 Transitive Surprise

Developer menambahkan dependency kecil:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>useful-lib</artifactId>
  <version>1.0.0</version>
</dependency>
```

Ternyata library itu membawa:

```text
useful-lib
 ├─ old-guava
 ├─ old-jackson
 ├─ commons-logging
 └─ vulnerable-netty
```

Dependency version management harus menjawab:

- apakah versi transitive boleh diterima?
- apakah harus di-override?
- apakah dependency harus diexclude?
- apakah library itu harus dilarang?
- apakah versi tertentu harus dipaksa secara global?

### 2.3 Inconsistent Upgrade

Upgrade dependency jarang berdiri sendiri. Banyak library adalah keluarga artifact:

```text
jackson-core
jackson-databind
jackson-annotations
jackson-datatype-jsr310
jackson-module-parameter-names
```

Atau:

```text
netty-buffer
netty-codec
netty-handler
netty-resolver
netty-transport
```

Atau:

```text
grpc-api
grpc-netty-shaded
grpc-protobuf
grpc-stub
protobuf-java
```

Jika hanya satu artifact dinaikkan versinya, library family bisa tidak sejajar.

Version management harus mampu melakukan **alignment**.

### 2.4 Reproducibility Risk

Jika dependency memakai dynamic version:

```groovy
implementation("com.example:lib:1.+")
```

atau range:

```xml
<version>[1.0,2.0)</version>
```

maka build hari ini dan build minggu depan bisa mengambil versi berbeda.

Untuk development cepat mungkin terasa nyaman. Untuk release enterprise, ini berbahaya.

### 2.5 Security Remediation Chaos

Saat ada CVE di dependency transitive, pertanyaan pertama bukan "upgrade apa?" tetapi:

> Di mana versi dependency itu dikontrol?

Jika versi tersebar di 80 file build, remediation akan lambat dan rentan tidak konsisten.

Version management yang matang membuat remediation menjadi:

```text
ubah satu policy layer -> semua module mengikuti -> CI membuktikan -> release artifact konsisten
```

---

## 3. Empat Layer Dependency Version Management

Sebuah build yang matang biasanya punya empat layer.

```text
┌────────────────────────────────────────────────────┐
│ Layer 4 — Locking / Verification / Reproducibility │
├────────────────────────────────────────────────────┤
│ Layer 3 — Policy / Constraint / Enforcement        │
├────────────────────────────────────────────────────┤
│ Layer 2 — Version Catalog / BOM / Platform         │
├────────────────────────────────────────────────────┤
│ Layer 1 — Dependency Declaration                   │
└────────────────────────────────────────────────────┘
```

### Layer 1 — Dependency Declaration

Module menyatakan dependency yang benar-benar dibutuhkan.

Contoh Maven:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

Contoh Gradle:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Pada build yang matang, declaration menjawab:

> Module ini butuh library apa?

Bukan selalu:

> Versinya berapa?

Versi idealnya dikontrol oleh layer yang lebih tinggi.

### Layer 2 — Catalog / BOM / Platform

Layer ini menyediakan daftar versi yang disetujui.

Di Maven:

- `dependencyManagement`
- imported BOM
- parent POM

Di Gradle:

- platform
- enforcedPlatform
- Java Platform Plugin
- version catalog

Layer ini menjawab:

> Versi default apa yang dipakai organisasi/project ini?

### Layer 3 — Constraints / Enforcement

Layer ini membuat aturan:

- minimal versi tertentu
- versi tertentu dilarang
- dependency tertentu harus diexclude
- Java baseline harus sesuai
- dependency duplicate tidak boleh
- snapshot tidak boleh di release
- banned dependency tidak boleh masuk

Di Maven:

- Maven Enforcer Plugin
- corporate parent POM
- dependency convergence rule
- banned dependencies rule
- require upper bound deps rule

Di Gradle:

- dependency constraints
- component metadata rules
- resolution strategy
- capabilities
- dependency verification
- custom convention plugin

Layer ini menjawab:

> Apa yang tidak boleh dilanggar?

### Layer 4 — Locking / Verification / Reproducibility

Layer ini memastikan build yang sudah resolve dependency tidak berubah diam-diam.

Di Gradle:

- dependency locking
- verification metadata
- checksum/signature verification

Di Maven:

- tidak ada dependency lockfile built-in yang setara dengan Gradle locking di Maven 3.x
- mitigasi dengan pinned versions, BOM, repository manager, checksum policy, plugin version pinning, reproducible build plugin/convention, dan CI artifact promotion

Layer ini menjawab:

> Apakah graph yang dipakai sekarang identik dengan graph yang diuji dan dirilis?

---

## 4. Maven Version Management Mental Model

Maven punya pendekatan model-driven. Versi dependency biasanya dikontrol lewat `dependencyManagement`.

### 4.1 `dependencies` vs `dependencyManagement`

Ini perbedaan fundamental.

#### `dependencies`

`dependencies` berarti dependency benar-benar dipakai oleh project.

```xml
<dependencies>
  <dependency>
    <groupId>org.slf4j</groupId>
    <artifactId>slf4j-api</artifactId>
    <version>2.0.13</version>
  </dependency>
</dependencies>
```

Efek:

- dependency masuk graph project;
- dependency ikut compile/runtime/test classpath tergantung scope;
- transitive dependency ikut dihitung;
- artifact bisa masuk packaging tergantung tipe project/plugin.

#### `dependencyManagement`

`dependencyManagement` tidak menambahkan dependency secara otomatis. Ia hanya memberi versi/scope/exclusion default jika dependency itu dipakai.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.13</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu module bisa menulis:

```xml
<dependencies>
  <dependency>
    <groupId>org.slf4j</groupId>
    <artifactId>slf4j-api</artifactId>
  </dependency>
</dependencies>
```

Maven akan mengambil versi dari `dependencyManagement`.

Mental model:

```text
dependencies          = saya butuh artifact ini
dependencyManagement = kalau artifact ini dipakai, gunakan policy ini
```

### 4.2 Dependency Management Tidak Sama dengan Dependency Declaration

Kesalahan umum:

> "Saya sudah taruh dependency di dependencyManagement, kenapa tidak masuk classpath?"

Jawabannya: karena `dependencyManagement` bukan dependency declaration.

Itu hanya katalog kebijakan versi.

### 4.3 Parent POM sebagai Distribution Mechanism

Di Maven, parent POM sering dipakai untuk menyebarkan version policy.

```xml
<parent>
  <groupId>com.acme.platform</groupId>
  <artifactId>acme-parent</artifactId>
  <version>3.2.0</version>
</parent>
```

Parent bisa membawa:

- `dependencyManagement`
- `pluginManagement`
- properties version
- repositories
- distribution management
- profiles
- enforcer rules
- compiler configuration

Kekuatan parent POM:

- mudah diwariskan;
- cocok untuk corporate standard;
- satu project hanya bisa punya satu parent;
- simple untuk Maven convention.

Kelemahannya:

- inheritance bisa terlalu gemuk;
- project bisa mewarisi hal yang tidak relevan;
- parent change bisa berdampak luas;
- satu parent membuat komposisi kebijakan kurang fleksibel.

### 4.4 BOM sebagai Composition Mechanism

BOM adalah POM khusus yang biasanya berisi `dependencyManagement` dan diimport dengan:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.platform</groupId>
      <artifactId>acme-bom</artifactId>
      <version>1.8.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Mental model BOM:

```text
BOM = daftar versi dependency yang disepakati untuk satu platform/library family
```

BOM tidak perlu menjadi parent. Karena itu BOM lebih composable daripada parent.

Contoh BOM umum:

- Spring Boot dependencies BOM
- Jakarta EE BOM
- Testcontainers BOM
- Jackson BOM
- Netty BOM
- internal company platform BOM

### 4.5 Parent POM vs BOM

| Aspek | Parent POM | BOM |
|---|---|---|
| Mekanisme | inheritance | import/composition |
| Batas jumlah | satu parent | bisa import banyak BOM |
| Isi umum | dependency, plugin, build, profile, property | dependency versions |
| Cocok untuk | corporate convention | version alignment |
| Risiko | inheritance terlalu besar | conflict antar BOM |
| Digunakan oleh | project child | project apa pun yang import |

Rule of thumb:

```text
Gunakan parent untuk build convention.
Gunakan BOM untuk dependency version alignment.
```

Jangan menjadikan parent sebagai dumping ground semua hal.

### 4.6 Import Order pada BOM Maven

Jika beberapa BOM mengatur dependency yang sama, order dan model resolution menjadi penting. Maven dependency management memiliki aturan precedence yang harus dipahami melalui effective POM.

Contoh:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>3.4.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>

    <dependency>
      <groupId>com.acme</groupId>
      <artifactId>acme-security-bom</artifactId>
      <version>2.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Pertanyaan yang harus dijawab:

- jika keduanya mendefinisikan `netty-handler`, siapa menang?
- apakah override eksplisit diperlukan?
- apakah effective POM menunjukkan versi final?

Praktik yang lebih jelas:

```xml
<dependencyManagement>
  <dependencies>
    <!-- import external platform first -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>${spring.boot.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>

    <!-- then explicit enterprise overrides -->
    <dependency>
      <groupId>io.netty</groupId>
      <artifactId>netty-handler</artifactId>
      <version>${netty.version}</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Dengan pola ini, override terlihat jelas.

---

## 5. Maven Version Properties: Baik, Tapi Jangan Berlebihan

Maven sering memakai properties untuk versi:

```xml
<properties>
  <jackson.version>2.17.2</jackson.version>
  <junit.jupiter.version>5.10.3</junit.jupiter.version>
</properties>
```

Lalu:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>${jackson.version}</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Ini berguna karena:

- mudah dicari;
- mudah diupdate;
- bisa dipakai banyak artifact satu family;
- bisa diexpose sebagai platform version variable.

Tapi ada risiko:

- terlalu banyak property membuat POM menjadi dictionary tidak terstruktur;
- property override dari child bisa membuat policy rusak;
- sulit tahu dependency family mana yang harus naik bersama;
- bisa menutupi fakta bahwa BOM sebenarnya lebih cocok.

Rule of thumb:

```text
Gunakan property untuk versi yang memang policy-level.
Gunakan BOM untuk library family yang sudah menyediakan alignment resmi.
Jangan membuat ratusan property jika version policy lebih cocok dimodelkan sebagai BOM.
```

---

## 6. Maven Dependency Mediation vs Dependency Management

Ini salah satu area yang sering membingungkan.

### 6.1 Dependency Mediation

Maven memilih versi transitive berdasarkan aturan dependency mediation, terutama "nearest definition".

Contoh:

```text
project
 ├─ A -> C:1.0
 └─ B -> D -> C:2.0
```

Jika `C:1.0` lebih dekat, Maven bisa memilih `C:1.0`.

### 6.2 Dependency Management Mengoverride Mediation

Jika root project punya:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>C</artifactId>
      <version>2.0</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Maka version policy root bisa menentukan `C:2.0`.

Mental model:

```text
Dependency mediation = Maven memilih dari graph yang tersedia.
Dependency management = project memberi policy versi sebelum pilihan final dipakai.
```

Top 1% engineer tidak hanya melihat dependency tree. Ia bertanya:

- apakah versi ini dipilih karena direct declaration?
- karena dependency management?
- karena nearest wins?
- karena BOM?
- karena parent?
- karena plugin membawa dependency sendiri?

---

## 7. Maven Enforcer sebagai Policy Gate

Maven Enforcer Plugin bisa dipakai untuk menolak build jika dependency policy dilanggar.

Contoh konsep rule:

- require Maven version;
- require Java version;
- dependency convergence;
- require upper bound dependencies;
- banned dependencies;
- no snapshots in release;
- enforce bytecode version.

Contoh sederhana:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-enforcer-plugin</artifactId>
      <version>3.5.0</version>
      <executions>
        <execution>
          <id>enforce-build-policy</id>
          <goals>
            <goal>enforce</goal>
          </goals>
          <configuration>
            <rules>
              <requireJavaVersion>
                <version>[17,)</version>
              </requireJavaVersion>
              <requireMavenVersion>
                <version>[3.9.0,)</version>
              </requireMavenVersion>
              <dependencyConvergence />
            </rules>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

Hati-hati: `dependencyConvergence` bisa sangat strict. Pada enterprise project besar, rule ini bisa menghasilkan banyak failure. Itu bukan berarti rule salah. Itu berarti dependency graph belum sehat.

Pendekatan realistis:

1. jalankan sebagai report dulu;
2. identifikasi family dependency paling berisiko;
3. align melalui BOM/dependencyManagement;
4. ban dependency yang benar-benar tidak boleh;
5. baru jadikan rule sebagai blocking gate.

---

## 8. Gradle Version Management Mental Model

Gradle lebih ekspresif daripada Maven karena dependency resolution-nya variant-aware dan bisa memakai constraints, platforms, version catalogs, metadata rules, locking, dan verification.

Di Gradle, ada beberapa konsep yang harus dipisahkan:

```text
version catalog   = alias dan koordinat dependency untuk build script
platform          = policy versi yang ikut dependency resolution
constraint        = aturan versi untuk dependency tertentu
lockfile          = hasil resolusi final yang dibekukan
verification      = checksum/signature trust metadata
```

Kesalahan umum:

> Mengira version catalog sama dengan Maven BOM.

Tidak sama.

Version catalog membantu deklarasi dependency lebih rapi, tetapi tidak otomatis menjadi alignment policy untuk transitive dependency seperti platform/constraints.

---

## 9. Gradle Version Catalog

Version catalog biasanya didefinisikan di:

```text
gradle/libs.versions.toml
```

Contoh:

```toml
[versions]
jackson = "2.17.2"
junit = "5.10.3"
slf4j = "2.0.13"

[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
jackson-jsr310 = { module = "com.fasterxml.jackson.datatype:jackson-datatype-jsr310", version.ref = "jackson" }
slf4j-api = { module = "org.slf4j:slf4j-api", version.ref = "slf4j" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }

[bundles]
jackson = ["jackson-databind", "jackson-jsr310"]

[plugins]
spotbugs = { id = "com.github.spotbugs", version = "6.0.18" }
```

Usage:

```kotlin
dependencies {
    implementation(libs.jackson.databind)
    implementation(libs.jackson.jsr310)
    testImplementation(libs.junit.jupiter)
}
```

Keuntungan:

- dependency coordinates tidak tersebar sebagai string;
- versi mudah dicari;
- IDE autocomplete;
- plugin versions bisa dikelola;
- bundle dependency umum bisa disederhanakan;
- cocok untuk multi-project build.

Keterbatasan:

- catalog bukan enforcement policy;
- catalog tidak otomatis align transitive dependency;
- catalog tidak menyelesaikan conflict sendiri;
- catalog tidak sama dengan lockfile;
- catalog tidak menjamin reproducible resolution jika dynamic version dipakai.

Mental model:

```text
Version catalog = address book.
Platform/constraints = version policy.
Lockfile = resolved graph snapshot.
```

---

## 10. Gradle Platform

Gradle platform adalah mekanisme dependency version alignment.

Ada dua bentuk umum:

1. menggunakan Maven BOM sebagai platform;
2. membuat internal platform dengan Java Platform Plugin.

### 10.1 Menggunakan Maven BOM di Gradle

```kotlin
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.4.1"))

    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("org.springframework:spring-web")
}
```

Dengan `platform`, versi dependency yang didefinisikan BOM ikut menjadi constraint dalam resolution.

### 10.2 `platform` vs `enforcedPlatform`

`platform` memberi constraint normal. Gradle masih melakukan conflict resolution berdasarkan aturan Gradle.

```kotlin
implementation(platform("com.acme:acme-platform:1.0.0"))
```

`enforcedPlatform` memaksa versi platform secara lebih keras dan juga bisa berdampak transitive kepada consumer jika library dipublish.

```kotlin
implementation(enforcedPlatform("com.acme:acme-platform:1.0.0"))
```

Gunakan `enforcedPlatform` dengan hati-hati.

Rule of thumb:

```text
Untuk aplikasi internal: enforcedPlatform kadang masuk akal jika ingin benar-benar mengunci stack.
Untuk library yang dipublish: hindari enforcedPlatform kecuali benar-benar paham dampaknya ke consumer.
```

### 10.3 Membuat Internal Java Platform

Project platform:

```kotlin
plugins {
    `java-platform`
}

javaPlatform {
    allowDependencies()
}

dependencies {
    api(platform("org.springframework.boot:spring-boot-dependencies:3.4.1"))

    constraints {
        api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
        api("org.slf4j:slf4j-api:2.0.13")
        api("org.junit.jupiter:junit-jupiter:5.10.3")
    }
}
```

Consumer:

```kotlin
dependencies {
    implementation(platform(project(":platform")))
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Mental model:

```text
Gradle platform = BOM-like policy component yang ikut resolution.
```

---

## 11. Gradle Dependency Constraints

Constraint menetapkan requirement versi tanpa menambahkan dependency.

```kotlin
dependencies {
    constraints {
        implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2") {
            because("Align Jackson version and avoid known vulnerable older versions")
        }
    }
}
```

Jika dependency itu muncul di graph, constraint ikut dipakai dalam conflict resolution.

Constraint cocok untuk:

- menetapkan minimal versi aman;
- align dependency family;
- memberi reason yang bisa dibaca saat dependency insight;
- menghindari direct dependency palsu hanya untuk memaksa versi;
- membuat platform internal.

### 11.1 Rich Version Constraints

Gradle mendukung rich version:

```kotlin
dependencies {
    constraints {
        implementation("com.example:lib") {
            version {
                strictly("1.5.2")
            }
        }
    }
}
```

Atau:

```kotlin
implementation("com.example:lib") {
    version {
        prefer("1.5.2")
        reject("1.5.0")
        reject("1.5.1")
    }
}
```

Maknanya berbeda:

| Bentuk | Makna |
|---|---|
| `prefer` | preferensi, masih bisa kalah oleh requirement lebih kuat |
| `strictly` | harus versi itu/range itu |
| `require` | minimal requirement yang harus dipenuhi |
| `reject` | versi tertentu tidak boleh dipilih |

Gunakan `strictly` secara selektif. Terlalu banyak strict version bisa membuat graph sulit resolve.

---

## 12. Gradle Dependency Locking

Dependency locking menyimpan versi final hasil resolusi dependency.

Contoh aktivasi:

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Generate/update lock:

```bash
./gradlew dependencies --write-locks
```

Lockfile membuat build berikutnya memakai versi yang sama.

Mental model:

```text
Platform/constraints menentukan policy.
Resolution memilih versi final.
Locking membekukan hasil final.
```

### 12.1 Kapan Locking Penting?

Sangat penting jika:

- memakai dynamic versions;
- dependency transitive berubah sering;
- ingin release reproducibility;
- CI harus memakai graph yang sama dengan local;
- supply-chain governance ketat;
- organisasi punya banyak module dan banyak developer.

### 12.2 Locking Bukan Pengganti Version Management

Locking tidak menjelaskan versi mana yang ideal. Ia hanya menyimpan hasil.

Jika graph buruk, lockfile akan membekukan graph buruk.

Urutan sehat:

```text
1. rapikan dependency declaration
2. align dengan platform/BOM/constraints
3. enforce policy
4. generate lockfile
5. review lockfile changes di PR
```

---

## 13. Maven Tidak Punya Locking Setara Gradle: Apa Konsekuensinya?

Maven secara tradisional lebih bergantung pada explicit versions dan dependency management. Karena Maven ecosystem mendorong versi statis, kebutuhan lockfile sering tidak terasa sebesar Gradle dynamic-resolution use case.

Namun pada enterprise system, Maven tetap bisa mengalami drift:

- SNAPSHOT dependency berubah;
- repository metadata berubah;
- transitive dependency berubah jika memakai version range;
- parent/BOM version berubah;
- plugin version tidak dipin;
- build extension berubah;
- local repository corrupt;
- mirror repository berbeda antara local dan CI.

Mitigasi Maven:

1. jangan gunakan dynamic/range version untuk release;
2. pin semua dependency version via dependencyManagement/BOM;
3. pin semua plugin version via pluginManagement;
4. gunakan Maven Wrapper;
5. gunakan repository manager internal;
6. disable/limit snapshot untuk release;
7. enforce no snapshots;
8. audit `mvn dependency:tree` di CI;
9. archive effective POM dan dependency tree sebagai release evidence;
10. gunakan artifact promotion, bukan rebuild untuk deploy environment berikutnya.

---

## 14. Dependency Alignment

Dependency alignment adalah memastikan artifact yang satu keluarga memakai versi yang kompatibel.

### 14.1 Library Family

Contoh Jackson:

```text
com.fasterxml.jackson.core:jackson-core
com.fasterxml.jackson.core:jackson-databind
com.fasterxml.jackson.core:jackson-annotations
com.fasterxml.jackson.datatype:jackson-datatype-jsr310
```

Sebaiknya tidak asal campur versi.

Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>2.17.2</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Gradle:

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.17.2"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
}
```

### 14.2 Platform Stack

Spring Boot BOM tidak hanya mengatur Spring. Ia juga mengatur banyak library ecosystem yang umum dipakai bersama Spring Boot.

Dengan platform stack, pertanyaannya:

- apakah kita mengikuti versi yang dipilih platform?
- apakah kita override sebagian karena CVE?
- apakah override itu kompatibel dengan platform?
- apakah upgrade platform lebih aman daripada override satu artifact?

### 14.3 Enterprise Alignment

Di enterprise, alignment bisa dibuat sebagai internal BOM/platform:

```text
acme-java-platform-bom:2026.06.0
 ├─ logging stack
 ├─ JSON stack
 ├─ test stack
 ├─ database stack
 ├─ observability stack
 ├─ security baseline
 └─ approved cloud SDK versions
```

Setiap service mengimport versi platform ini.

Keuntungan:

- security remediation centralized;
- dependency review lebih mudah;
- onboarding service baru lebih cepat;
- CI policy konsisten;
- rollback platform version lebih jelas.

Risiko:

- platform terlalu besar;
- semua service terpaksa ikut versi yang tidak selalu cocok;
- update platform menjadi event besar;
- owner platform menjadi bottleneck.

Praktik sehat:

```text
Platform harus punya release cadence, changelog, compatibility notes, dan exception process.
```

---

## 15. Version Catalog vs Platform vs Lockfile

Ini perbedaan penting di Gradle.

| Konsep | Fungsi | Mempengaruhi resolution? | Menambah dependency? | Cocok untuk |
|---|---|---:|---:|---|
| Version catalog | Alias dependency/version/plugin | Tidak secara policy-level | Tidak | ergonomi deklarasi |
| Platform | Version alignment policy | Ya | Tidak langsung | stack alignment |
| Constraint | Requirement versi | Ya | Tidak | policy granular |
| Lockfile | Freeze hasil resolved graph | Ya, sebagai locked result | Tidak | reproducibility |

Contoh kesalahan:

```toml
[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version = "2.17.2" }
```

Lalu developer berpikir semua transitive Jackson pasti 2.17.2. Tidak selalu.

Jika dependency lain menarik `jackson-core`, catalog tidak otomatis mengontrolnya kecuali dependency itu dideklarasikan melalui alias atau ada platform/constraint.

Solusi:

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.17.2"))
    implementation(libs.jackson.databind)
}
```

Atau internal platform.

---

## 16. Dynamic Versions dan Version Ranges

Dynamic versions terlihat praktis, tetapi berbahaya untuk release.

### 16.1 Gradle Dynamic Version

```kotlin
implementation("com.example:lib:1.+")
implementation("com.example:lib:latest.release")
```

Masalah:

- build berubah tanpa code change;
- CI dan local bisa resolve berbeda;
- cache expiry mempengaruhi hasil;
- incident sulit direproduksi;
- supply-chain risk lebih tinggi.

Jika benar-benar perlu dynamic version, wajib gunakan locking.

### 16.2 Maven Version Range

```xml
<version>[1.0,2.0)</version>
```

Masalah mirip:

- release tidak deterministic;
- dependency resolution bisa berubah;
- audit sulit;
- compatibility belum tentu terjaga.

Rule of thumb:

```text
Untuk release artifact: hindari dynamic version dan version range.
Untuk experimentation: boleh, tapi jangan masuk mainline tanpa locking/pinning.
```

---

## 17. SNAPSHOT Dependency Policy

SNAPSHOT berarti artifact masih berubah untuk versi yang sama.

Contoh:

```xml
<version>1.2.0-SNAPSHOT</version>
```

Masalah SNAPSHOT:

- artifact dapat berubah tanpa version coordinate berubah;
- build tidak reproducible;
- CI bisa mengambil snapshot berbeda dari local;
- rollback sulit;
- release evidence lemah.

Policy sehat:

| Context | SNAPSHOT Boleh? |
|---|---:|
| Local dev antar module | boleh dengan hati-hati |
| Feature branch integration | kadang boleh |
| Main branch | sebaiknya dibatasi |
| Release candidate | tidak |
| Production release | tidak |
| Library published external | tidak |

Maven Enforcer bisa menolak snapshot saat release.

Gradle bisa membuat custom rule/convention plugin untuk menolak dependency snapshot pada release task.

---

## 18. Plugin Version Management

Dependency version management tidak cukup. Plugin juga bagian dari build supply chain.

### 18.1 Maven Plugin Version

Jangan biarkan plugin version implicit.

Buruk:

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
</plugin>
```

Lebih baik:

```xml
<pluginManagement>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>3.13.0</version>
    </plugin>
  </plugins>
</pluginManagement>
```

Kenapa?

- plugin adalah executable code;
- plugin bisa berubah behavior antar versi;
- plugin punya dependency sendiri;
- plugin mempengaruhi artifact output;
- release build harus bisa dijelaskan.

### 18.2 Gradle Plugin Version

Gradle plugin version bisa dikelola di `settings.gradle.kts` atau version catalog.

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
    plugins {
        id("com.github.spotbugs") version "6.0.18"
    }
}
```

Atau TOML:

```toml
[plugins]
spotbugs = { id = "com.github.spotbugs", version = "6.0.18" }
```

Usage:

```kotlin
plugins {
    alias(libs.plugins.spotbugs)
}
```

Plugin version harus diperlakukan setara dependency production karena plugin bisa:

- membaca source code;
- menghasilkan source code;
- memodifikasi artifact;
- publish artifact;
- membaca secret dari environment;
- menjalankan arbitrary code.

---

## 19. Java 8–25 Compatibility dan Dependency Version Management

Version management harus mempertimbangkan Java baseline.

Dependency versi baru bisa saja:

- membutuhkan Java 11;
- membutuhkan Java 17;
- menggunakan class file version lebih tinggi;
- menggunakan API JDK baru;
- berubah dari javax ke jakarta;
- berubah dari classpath-friendly ke module-aware;
- memakai multi-release JAR.

Contoh problem:

```text
Service masih runtime Java 8.
Developer upgrade library ke versi yang compile Java 11.
Build mungkin sukses jika memakai JDK 17 tanpa --release 8.
Runtime Java 8 gagal dengan UnsupportedClassVersionError.
```

Policy yang harus ada:

```text
Setiap platform/BOM internal harus mendefinisikan Java baseline.
```

Contoh:

```text
acme-java8-platform-bom
acme-java17-platform-bom
acme-java21-platform-bom
acme-java25-platform-bom
```

Atau:

```text
acme-platform:2026.06.0
metadata:
  min-runtime-java: 17
  tested-java: 17, 21, 25
```

Checklist saat upgrade dependency:

- minimum Java version library;
- class file version;
- release notes;
- transitive dependency baseline;
- framework compatibility;
- container/app server compatibility;
- javax/jakarta namespace;
- JPMS/module metadata;
- native image compatibility jika relevan.

---

## 20. Version Management untuk Application vs Library

Application dan library punya strategi berbeda.

### 20.1 Application

Application mengontrol runtime final.

Karena itu application boleh lebih tegas:

- memakai enforced platform;
- locking semua configurations;
- override transitive dependency;
- exclude dependency conflict;
- pin runtime graph;
- reject snapshot saat release.

Application bertanggung jawab terhadap final artifact.

### 20.2 Library

Library dikonsumsi pihak lain.

Library sebaiknya tidak terlalu memaksakan dependency consumer kecuali memang API-nya membutuhkan versi tertentu.

Prinsip library:

- minimalkan dependency surface;
- gunakan `api` hanya jika type dependency muncul di public API;
- gunakan `implementation` untuk internal dependency;
- jangan memakai enforced platform sembarangan;
- hindari shading kecuali benar-benar perlu;
- deklarasikan minimum compatible version;
- test dengan range versi yang realistis jika library public.

Di Gradle, `java-library` plugin membantu membedakan `api` dan `implementation`.

Di Maven, pemisahan ini tidak sejelas Gradle. Karena Maven POM consumer melihat dependency compile scope sebagai transitive compile dependency. Jadi library author harus lebih disiplin.

---

## 21. Dependency Update Strategy

Version management bukan hanya state. Ia juga proses.

### 21.1 Update Types

| Jenis Update | Risiko | Contoh |
|---|---:|---|
| patch | rendah-sedang | 2.17.1 -> 2.17.2 |
| minor | sedang | 2.16 -> 2.17 |
| major | tinggi | 1.x -> 2.x |
| security override | variatif | force Netty patch |
| platform upgrade | tinggi | Spring Boot 3.3 -> 3.4 |
| Java baseline upgrade | tinggi | Java 17 -> 21 |

### 21.2 Update Cadence

Strategi umum:

```text
Security updates      = segera, risk-based
Patch updates         = rutin, kecil, sering
Minor updates         = batch terkontrol
Major updates         = project/migration plan
Platform updates      = release train
Java baseline updates = compatibility program
```

### 21.3 Dependency Update PR

PR dependency update yang sehat harus berisi:

- dependency apa yang berubah;
- dari versi berapa ke berapa;
- alasan update;
- release notes link;
- CVE reference jika ada;
- affected modules;
- dependency tree diff;
- test evidence;
- rollback plan jika berisiko.

Untuk enterprise, jangan hanya merge automated PR tanpa memahami graph impact.

---

## 22. Dependency Graph Diff

Top 1% engineer tidak hanya melihat build hijau. Ia melihat graph berubah apa.

### 22.1 Maven

```bash
mvn dependency:tree -Dverbose
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn help:effective-pom
```

Simpan output sebelum/sesudah:

```bash
mvn dependency:tree -DoutputFile=dependency-tree.txt
```

### 22.2 Gradle

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew buildEnvironment
```

Untuk graph besar, gunakan dependency report per configuration:

```bash
./gradlew :app:dependencies --configuration runtimeClasspath
```

Pertanyaan saat review diff:

- dependency baru apa yang masuk?
- dependency apa yang hilang?
- versi apa yang berubah?
- apakah ada downgrade?
- apakah ada duplicate family?
- apakah ada vulnerable transitive dependency?
- apakah ada dependency yang seharusnya test-only tapi masuk runtime?
- apakah ada dependency Java 17 masuk ke module Java 8?

---

## 23. Case Study 1 — Jackson Drift

### Situasi

Project Spring Boot memakai BOM. Satu module menambahkan versi eksplisit:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.13.5</version>
</dependency>
```

Sementara platform memakai 2.17.x.

### Dampak

- dependency management bisa dioverride oleh direct version;
- module itu compile dengan versi lama;
- runtime bisa mengambil versi berbeda tergantung packaging;
- jika fat JAR, mungkin versi yang akhirnya masuk tidak sesuai ekspektasi;
- security scanner bisa flag versi lama.

### Solusi

Maven:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

Versi dikontrol BOM.

Gradle:

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.17.2"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Tambah policy:

- ban explicit versions untuk dependency managed;
- dependency convergence check;
- dependency insight di PR;
- platform update cadence.

---

## 24. Case Study 2 — Netty Security Override

### Situasi

Framework membawa Netty versi lama secara transitive. Security scanner menemukan CVE.

Graph:

```text
app
 └─ framework-client
     └─ netty-handler:4.1.90
```

Butuh upgrade ke `4.1.110` tanpa menunggu framework release.

### Maven Solusi

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.netty</groupId>
      <artifactId>netty-bom</artifactId>
      <version>4.1.110.Final</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Atau explicit override semua artifact Netty yang relevan.

### Gradle Solusi

```kotlin
dependencies {
    implementation(platform("io.netty:netty-bom:4.1.110.Final"))
}
```

Atau constraint:

```kotlin
dependencies {
    constraints {
        implementation("io.netty:netty-handler:4.1.110.Final") {
            because("Security remediation for vulnerable transitive Netty version")
        }
    }
}
```

### Review Wajib

- Apakah semua Netty artifact align?
- Apakah framework compatible dengan Netty baru?
- Apakah native transport ikut berubah?
- Apakah integration test network path jalan?
- Apakah CVE scanner sudah bersih?

---

## 25. Case Study 3 — Jakarta vs Javax Split

### Situasi

Project migrasi dari Java EE/Jakarta EE lama.

Ada dependency:

```text
javax.servlet:javax.servlet-api
jakarta.servlet:jakarta.servlet-api
javax.validation:validation-api
jakarta.validation:jakarta.validation-api
```

Masuk bersamaan.

### Dampak

- compile bisa ambigu;
- runtime container bisa punya API sendiri;
- class cast problem;
- framework modern butuh `jakarta.*`, legacy library masih `javax.*`;
- transitive dependency bisa menarik namespace lama.

### Version Management Strategy

Maven:

- corporate BOM harus memilih satu namespace per platform;
- Maven Enforcer ban namespace yang tidak boleh;
- provided scope untuk API dari container;
- dependency tree check.

Gradle:

- platform constraints;
- component metadata rule untuk reject dependency tertentu;
- custom convention plugin untuk banned coordinates;
- dependency insight per namespace.

Policy contoh:

```text
Untuk platform Jakarta EE 10+:
- ban javax.servlet:javax.servlet-api
- ban javax.validation:validation-api
- allow jakarta.servlet:jakarta.servlet-api only as compileOnly/provided
```

---

## 26. Case Study 4 — Test Dependency Masuk Runtime

### Situasi

Developer menambahkan dependency test utility sebagai `implementation`.

Gradle:

```kotlin
implementation("org.mockito:mockito-core:5.12.0")
```

Maven:

```xml
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
</dependency>
```

Tanpa `<scope>test</scope>`.

### Dampak

- runtime artifact membengkak;
- ByteBuddy/Objenesis ikut masuk;
- security surface bertambah;
- classpath conflict mungkin terjadi;
- runtime container membawa library yang tidak diperlukan.

### Solusi

Gradle:

```kotlin
testImplementation("org.mockito:mockito-core")
```

Maven:

```xml
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
  <scope>test</scope>
</dependency>
```

Policy:

- dependency analysis plugin;
- runtimeClasspath review;
- no test framework in production classpath;
- packaging inspection.

---

## 27. Designing Enterprise Dependency Governance

Untuk sistem enterprise, desain ideal biasanya seperti ini:

```text
company-build-parent
 ├─ pluginManagement
 ├─ compiler policy
 ├─ enforcer rules
 ├─ repository policy
 └─ CI profile

company-platform-bom / company-java-platform
 ├─ dependency versions
 ├─ imported external BOMs
 ├─ security overrides
 ├─ test stack versions
 └─ observability stack versions

service/application
 ├─ declares needed dependencies without versions
 ├─ imports platform
 ├─ applies convention plugin/parent
 └─ locks/verifies final graph
```

### 27.1 Maven Enterprise Layout

```text
acme-parent-pom
acme-platform-bom
service-a
service-b
shared-library-c
```

Parent:

```xml
<parent>
  <groupId>com.acme</groupId>
  <artifactId>acme-parent</artifactId>
  <version>2026.06.0</version>
</parent>
```

BOM import:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme</groupId>
      <artifactId>acme-platform-bom</artifactId>
      <version>2026.06.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### 27.2 Gradle Enterprise Layout

```text
build-logic/
platform/
gradle/libs.versions.toml
service-a/
service-b/
```

Settings:

```kotlin
pluginManagement {
    includeBuild("build-logic")
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        maven("https://repo.acme.internal/releases")
    }
}
```

Consumer:

```kotlin
plugins {
    id("acme.java-application-conventions")
}

dependencies {
    implementation(platform(project(":platform")))
    implementation(libs.jackson.databind)
}
```

---

## 28. Version Policy Document

Setiap organisasi serius sebaiknya punya dokumen policy dependency.

Isi minimal:

```text
1. Java baseline supported
2. Approved repositories
3. Approved BOM/platform
4. Rule for explicit dependency versions
5. Rule for SNAPSHOT dependencies
6. Rule for dynamic versions/ranges
7. Security remediation process
8. Dependency update cadence
9. Plugin version policy
10. License policy
11. Exception process
12. Ownership of platform/BOM
13. CI enforcement rules
14. Release evidence required
```

Contoh policy ringkas:

```text
- Application modules must not declare explicit versions for dependencies managed by the platform.
- Release builds must not contain SNAPSHOT dependencies.
- Dynamic versions and Maven version ranges are not allowed on main branch.
- All Gradle projects must use dependency locking for runtimeClasspath and testRuntimeClasspath.
- All Maven projects must pin plugin versions through corporate parent pluginManagement.
- New external dependencies require owner, purpose, license, and security review.
- Platform upgrades must include dependency tree diff and smoke test evidence.
```

---

## 29. Anti-Patterns

### 29.1 Version Everywhere

Setiap module menulis versi sendiri.

Dampak:

- drift;
- upgrade sulit;
- security fix lambat;
- graph sulit diaudit.

### 29.2 Parent POM sebagai Tempat Sampah

Parent berisi dependency, plugin, profile, repository, property, distribution, dan behavior yang tidak semua child butuh.

Dampak:

- inheritance tidak terkendali;
- perubahan parent terlalu berisiko;
- child sulit override dengan aman.

### 29.3 BOM Tanpa Ownership

Ada internal BOM, tapi tidak ada owner, cadence, changelog, atau compatibility testing.

Dampak:

- BOM menjadi fossil;
- service override sendiri-sendiri;
- platform tidak dipercaya.

### 29.4 Version Catalog Dianggap Enforcement

Gradle version catalog dianggap cukup untuk governance.

Dampak:

- transitive dependency tidak terkontrol;
- conflict tetap terjadi;
- dependency drift tetap masuk.

### 29.5 Lockfile Tanpa Review

Lockfile berubah besar, tapi PR reviewer tidak melihat isinya.

Dampak:

- transitive dependency baru masuk diam-diam;
- vulnerable dependency ikut terkunci;
- supply-chain risk meningkat.

### 29.6 Explicit Override Tanpa Alasan

Developer override versi platform tanpa dokumentasi.

Dampak:

- platform alignment rusak;
- update berikutnya membingungkan;
- incident sulit ditelusuri.

Solusi:

```kotlin
constraints {
    implementation("io.netty:netty-handler:4.1.110.Final") {
        because("CVE remediation approved by security review SEC-1234")
    }
}
```

Atau komentar XML yang jelas di Maven.

---

## 30. Practical Maven Template

Contoh ringkas project Maven matang:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.acme.build</groupId>
    <artifactId>acme-parent</artifactId>
    <version>2026.06.0</version>
  </parent>

  <groupId>com.acme.order</groupId>
  <artifactId>order-service</artifactId>
  <version>1.12.0-SNAPSHOT</version>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.acme.build</groupId>
        <artifactId>acme-platform-bom</artifactId>
        <version>2026.06.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
    </dependency>

    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </dependency>

    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
```

Ciri baik:

- dependency tidak menulis versi jika managed;
- parent mengatur build convention;
- BOM mengatur dependency versions;
- test dependency memakai test scope;
- plugin versions di parent/pluginManagement;
- release policy bisa enforce no snapshots.

---

## 31. Practical Gradle Template

`settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "order-platform"
include("platform", "order-service")
```

`platform/build.gradle.kts`:

```kotlin
plugins {
    `java-platform`
}

javaPlatform {
    allowDependencies()
}

dependencies {
    api(platform("org.springframework.boot:spring-boot-dependencies:3.4.1"))

    constraints {
        api("org.slf4j:slf4j-api:2.0.13")
        api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
        api("org.junit.jupiter:junit-jupiter:5.10.3")
    }
}
```

`order-service/build.gradle.kts`:

```kotlin
plugins {
    `java-library`
}

dependencyLocking {
    lockAllConfigurations()
}

dependencies {
    implementation(platform(project(":platform")))

    implementation("org.slf4j:slf4j-api")
    implementation("com.fasterxml.jackson.core:jackson-databind")

    testImplementation("org.junit.jupiter:junit-jupiter")
}

tasks.test {
    useJUnitPlatform()
}
```

`gradle/libs.versions.toml` bisa tetap dipakai untuk alias:

```toml
[libraries]
slf4j-api = { module = "org.slf4j:slf4j-api" }
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter" }
```

Lalu:

```kotlin
dependencies {
    implementation(platform(project(":platform")))
    implementation(libs.slf4j.api)
    implementation(libs.jackson.databind)
    testImplementation(libs.junit.jupiter)
}
```

Ciri baik:

- catalog untuk ergonomi;
- platform untuk policy;
- lockfile untuk reproducibility;
- repositories dikunci di settings;
- project tidak bebas menambah repository sendiri.

---

## 32. Review Checklist Dependency Version Management

Gunakan checklist ini saat review build file.

### 32.1 Declaration

- Apakah dependency benar-benar digunakan?
- Apakah dependency masuk configuration/scope yang benar?
- Apakah test dependency tidak masuk runtime?
- Apakah dependency public API dipisahkan dari implementation detail?

### 32.2 Version Policy

- Apakah versi ditulis langsung di module?
- Jika iya, apakah ada alasan?
- Apakah dependency sudah managed oleh BOM/platform?
- Apakah library family align?
- Apakah ada explicit override terhadap platform?

### 32.3 Transitive Risk

- Dependency transitive baru apa yang masuk?
- Apakah ada vulnerable transitive dependency?
- Apakah ada duplicate logging binding?
- Apakah ada javax/jakarta split?
- Apakah ada dependency dengan Java baseline lebih tinggi?

### 32.4 Reproducibility

- Apakah ada dynamic version?
- Apakah ada Maven version range?
- Apakah ada SNAPSHOT di release path?
- Apakah Gradle lockfile berubah?
- Apakah plugin versions dipin?
- Apakah repository source konsisten?

### 32.5 Security/Governance

- Apakah dependency berasal dari repository approved?
- Apakah lisensi diterima?
- Apakah ada checksum/signature verification?
- Apakah dependency baru punya owner?
- Apakah update security punya evidence?

---

## 33. Debugging Workflow Saat Versi Dependency Salah

Saat ada error seperti:

```text
NoSuchMethodError
ClassNotFoundException
NoClassDefFoundError
UnsupportedClassVersionError
LinkageError
ClassCastException
```

Jangan langsung menebak.

Ikuti alur:

```text
1. Identifikasi class/method yang gagal
2. Cari artifact yang seharusnya menyediakan class itu
3. Lihat runtimeClasspath final
4. Lihat versi yang dipilih
5. Lihat siapa yang membawa versi itu
6. Lihat apakah versi dikontrol BOM/platform/constraint/direct declaration
7. Lihat apakah ada duplicate artifact/family mismatch
8. Perbaiki di policy layer, bukan patch lokal sembarangan
9. Tambahkan test/enforcer/check agar tidak kambuh
```

Maven commands:

```bash
mvn dependency:tree -Dverbose
mvn dependency:tree -Dincludes=groupId:artifactId
mvn help:effective-pom
```

Gradle commands:

```bash
./gradlew :module:dependencyInsight --dependency artifact-name --configuration runtimeClasspath
./gradlew :module:dependencies --configuration runtimeClasspath
./gradlew buildEnvironment
```

---

## 34. Mental Model Akhir

Dependency version management punya beberapa prinsip inti.

### 34.1 Dependency Declaration Harus Menjawab Kebutuhan Module

Module berkata:

```text
Saya butuh jackson-databind.
```

Bukan selalu:

```text
Saya mau jackson-databind versi 2.17.2.
```

Versi adalah policy, bukan detail lokal, kecuali ada alasan khusus.

### 34.2 BOM/Platform adalah Contract

BOM/platform bukan file administrasi. Ia adalah kontrak runtime dependency.

Ia menjawab:

```text
Stack dependency apa yang sudah disetujui dan diuji bersama?
```

### 34.3 Lockfile adalah Evidence

Lockfile bukan policy. Ia adalah evidence hasil resolusi.

Ia menjawab:

```text
Graph final apa yang benar-benar dipakai build ini?
```

### 34.4 Enforcement Mengubah Best Practice Menjadi Sistem

Tanpa enforcement, best practice hanya harapan.

Dengan enforcement:

- dependency lama ditolak;
- snapshot release gagal;
- Java version mismatch gagal;
- banned dependency gagal;
- plugin version missing gagal.

### 34.5 Version Management adalah Socio-Technical System

Masalah dependency bukan hanya teknis.

Ia melibatkan:

- ownership;
- review process;
- release cadence;
- security policy;
- team skill;
- exception handling;
- incident response;
- platform governance.

Top 1% engineer memahami bahwa dependency graph adalah bagian dari arsitektur organisasi.

---

## 35. Ringkasan

Di bagian ini kita mempelajari:

- perbedaan dependency declaration dan version policy;
- Maven `dependencies` vs `dependencyManagement`;
- parent POM vs BOM;
- dependency mediation vs dependency management;
- Gradle version catalog, platform, constraints, locking;
- kenapa catalog bukan BOM;
- kenapa lockfile bukan policy;
- dynamic version dan SNAPSHOT risk;
- plugin version sebagai supply-chain concern;
- Java 8–25 compatibility dalam version policy;
- application vs library dependency strategy;
- update cadence;
- graph diff;
- case study Jackson, Netty, Jakarta/Javax, test dependency leakage;
- enterprise governance model;
- checklist review dan debugging workflow.

Kalimat kunci:

> Dependency version management adalah seni membuat dependency graph tetap bisa berkembang tanpa kehilangan kontrol.

---

## 36. Latihan Praktis

### Latihan 1 — Maven BOM Refactor

Ambil project Maven yang punya banyak dependency dengan versi eksplisit.

Tugas:

1. identifikasi dependency family;
2. pindahkan versi ke `dependencyManagement`;
3. import BOM resmi jika tersedia;
4. hapus versi dari dependency declaration;
5. jalankan `mvn dependency:tree`;
6. dokumentasikan versi yang berubah.

### Latihan 2 — Gradle Catalog + Platform Separation

Ambil project Gradle.

Tugas:

1. pindahkan coordinates ke `libs.versions.toml`;
2. buat platform internal;
3. pindahkan versi policy ke platform;
4. gunakan catalog alias tanpa version jika versi dikontrol platform;
5. aktifkan dependency locking;
6. review lockfile.

### Latihan 3 — Security Override

Simulasikan CVE pada transitive dependency.

Tugas:

1. temukan dependency melalui tree/insight;
2. override melalui BOM/platform/constraint;
3. tambahkan alasan override;
4. pastikan semua artifact family align;
5. tulis rollback plan.

### Latihan 4 — Java Baseline Audit

Untuk project Java 8, 17, 21, atau 25:

1. list dependency runtime;
2. cari minimum Java version tiap dependency utama;
3. cari potensi class file mismatch;
4. buat rekomendasi platform baseline.

---

## 37. Referensi Resmi

- Apache Maven — Introduction to the Dependency Mechanism: https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Apache Maven — POM Reference: https://maven.apache.org/pom.html
- Apache Maven Enforcer Plugin: https://maven.apache.org/enforcer/maven-enforcer-plugin/
- Gradle — Dependency Constraints: https://docs.gradle.org/current/userguide/dependency_constraints.html
- Gradle — Platforms: https://docs.gradle.org/current/userguide/platforms.html
- Gradle — Version Catalogs: https://docs.gradle.org/current/userguide/version_catalogs.html
- Gradle — Dependency Locking: https://docs.gradle.org/current/userguide/dependency_locking.html
- Gradle — Declaring Versions and Ranges: https://docs.gradle.org/current/userguide/dependency_versions.html
- Gradle — Centralizing Catalogs and Platforms: https://docs.gradle.org/current/userguide/centralizing_catalog_platform.html

---

## 38. Status Seri

Selesai:

- Part 0 — Build Engineering Mental Model
- Part 1 — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
- Part 2 — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor
- Part 3 — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API
- Part 4 — Maven vs Gradle: Decision Framework
- Part 5 — Project Layout Engineering
- Part 6 — Dependency Graph Fundamentals
- Part 7 — Dependency Version Management

Berikutnya:

- Part 8 — Repository Engineering: Maven Central, Nexus, Artifactory, Proxy, Mirror, Credential, Offline Build

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-dependency-graph-fundamentals.md">⬅️ Part 6 — Dependency Graph Fundamentals: Direct, Transitive, Scope, Configuration, Variant</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./08-repository-engineering.md">Part 8 — Repository Engineering: Maven Central, Nexus, Artifactory, Proxy, Mirror, Credential, Offline Build ➡️</a>
</div>
