# Part 3 — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `03-gradle-core-mental-model.md`  
> Scope: Java 8–25, Gradle sebagai programmable build graph, bukan sekadar command `gradle build`.

---

## 0. Tujuan Bagian Ini

Bagian ini membangun mental model Gradle dari bawah: bagaimana Gradle membaca build, membentuk model project, membuat task graph, menunda konfigurasi, mengeksekusi task, menentukan apakah task perlu dijalankan, dan bagaimana build script harus ditulis supaya scalable.

Setelah bagian ini, targetnya bukan hanya bisa menulis:

```kotlin
plugins {
    java
}
```

atau:

```bash
./gradlew build
```

Tetapi mampu menjawab pertanyaan yang lebih dalam:

- Mengapa Gradle punya tiga fase: initialization, configuration, execution?
- Kenapa `tasks.register` lebih sehat daripada `tasks.create`?
- Apa bedanya task configured, realized, selected, executed?
- Bagaimana Gradle tahu sebuah task `UP-TO-DATE`?
- Mengapa build script yang terlihat benar bisa merusak performance?
- Apa hubungan Provider API, lazy configuration, incremental build, build cache, dan configuration cache?
- Mengapa Gradle cocok untuk build yang kompleks, tetapi juga lebih mudah disalahgunakan dibanding Maven?
- Bagaimana membaca Gradle build sebagai graph, bukan script linear?

Ini adalah fondasi sebelum masuk ke Gradle dependency management, plugin authoring, performance engineering, CI, release, dan enterprise governance.

---

## 1. Gradle dalam Satu Kalimat

Gradle adalah **build automation engine berbasis graph** yang membangun model dari project, dependency, task, input, output, plugin, dan configuration, lalu mengeksekusi hanya pekerjaan yang diperlukan untuk menghasilkan target build.

Kalimat ini penting karena Gradle sering disalahpahami sebagai:

> “Alternatif Maven yang pakai Groovy/Kotlin.”

Itu terlalu dangkal.

Lebih tepat:

> Maven terutama adalah lifecycle-driven build system berbasis model POM. Gradle adalah programmable build graph engine yang bisa membentuk lifecycle sendiri melalui task graph, plugin, variant, dan lazy model.

Dampaknya besar:

| Aspek | Maven | Gradle |
|---|---|---|
| Model utama | POM + lifecycle phase | Project + task graph + plugin model |
| Cara berpikir | Jalankan phase | Bangun graph, lalu eksekusi selected tasks |
| Fleksibilitas | Lebih terkendali | Lebih tinggi |
| Risiko | Sulit keluar dari convention | Mudah membuat build script tidak scalable |
| Performance model | Reactor + parallel build | Task avoidance, incremental build, build cache, configuration cache |
| Extension | Maven plugin goal/mojo | Gradle plugin, task, extension, Provider API |

Gradle sangat kuat karena programmable. Tetapi justru karena programmable, engineer harus disiplin. Kalau tidak, build script berubah menjadi “mini application” yang lambat, stateful, non-deterministic, dan sulit di-debug.

---

## 2. Gradle Bukan Script Linear

Kesalahan pertama dalam memahami Gradle adalah menganggap file `build.gradle` atau `build.gradle.kts` dieksekusi seperti script biasa dari atas ke bawah untuk langsung melakukan build.

Memang file build dievaluasi, tetapi tujuan utamanya bukan langsung melakukan pekerjaan compile/test/package. Tujuan utamanya adalah **mendaftarkan dan mengonfigurasi model build**.

Contoh buruk mental model:

```kotlin
println("compile now")

val file = File("build/generated.txt")
file.writeText("generated")
```

Engineer yang berpikir script linear akan mengira ini bagian dari build step. Padahal kode tersebut berjalan saat **configuration phase**, bukan saat task execution. Efeknya:

- berjalan bahkan ketika user hanya menjalankan `./gradlew help`;
- berjalan walaupun task terkait tidak dipilih;
- sulit di-cache;
- sulit paralel;
- bisa membuat CI dan local berbeda;
- merusak configuration cache.

Gradle build yang sehat harus mengekspresikan pekerjaan sebagai **task dengan input dan output**, bukan side effect langsung di configuration phase.

Contoh lebih benar:

```kotlin
tasks.register("generateFile") {
    val outputFile = layout.buildDirectory.file("generated/generated.txt")

    outputs.file(outputFile)

    doLast {
        outputFile.get().asFile.writeText("generated")
    }
}
```

Di sini pekerjaan baru terjadi saat task `generateFile` dieksekusi, bukan saat build script dibaca.

---

## 3. Tiga Fase Gradle Build

Gradle build berjalan dalam tiga fase konseptual:

```text
Initialization  ->  Configuration  ->  Execution
```

### 3.1 Initialization Phase

Pada fase initialization, Gradle menentukan build mana yang sedang berjalan dan project apa saja yang terlibat.

Biasanya Gradle membaca:

```text
settings.gradle
settings.gradle.kts
```

Di sinilah root project, subproject, plugin repositories, dependency repositories management, dan included builds dideklarasikan.

Contoh:

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

rootProject.name = "payment-platform"

include("payment-api")
include("payment-domain")
include("payment-infrastructure")
include("payment-application")
```

Mental model:

```text
settings.gradle.kts menjawab:
- Build ini namanya apa?
- Project apa saja yang ikut?
- Plugin dari mana di-resolve?
- Dependency dari mana di-resolve?
- Ada included build/composite build atau tidak?
```

Pada fase ini, Gradle belum compile Java, belum menjalankan test, belum membuat JAR.

### 3.2 Configuration Phase

Pada fase configuration, Gradle mengevaluasi build script setiap project yang relevan dan membangun model:

- plugin yang diterapkan;
- extension yang tersedia;
- dependency configuration;
- task yang didaftarkan;
- relationship antar-task;
- source set;
- publication;
- toolchain;
- test task;
- jar task;
- custom task.

Contoh:

```kotlin
plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
}

tasks.test {
    useJUnitPlatform()
}
```

Ini bukan berarti test langsung berjalan. Ini hanya mengonfigurasi task `test` supaya saat nanti dieksekusi, ia memakai JUnit Platform.

Configuration phase harus ringan. Ia seharusnya tidak:

- membaca banyak file besar;
- melakukan network call;
- generate file;
- menjalankan command eksternal;
- melakukan query database;
- membaca environment secara tidak terkendali;
- membuat semua task secara eager;
- resolve dependency yang belum diperlukan.

Configuration phase adalah tempat mendeklarasikan graph, bukan menjalankan pekerjaan berat.

### 3.3 Execution Phase

Pada fase execution, Gradle menentukan task yang dipilih dan task dependency-nya, lalu menjalankan task graph.

Contoh command:

```bash
./gradlew test
```

Gradle akan membangun graph seperti:

```text
:compileJava
:processResources
:classes
:compileTestJava
:processTestResources
:testClasses
:test
```

Tergantung plugin dan konfigurasi, graph aktual bisa berbeda. Tetapi prinsipnya sama: Gradle menjalankan task yang dibutuhkan untuk mencapai target `test`.

Sebelum menjalankan task, Gradle juga memeriksa:

- apakah task punya input/output?
- apakah input berubah?
- apakah output masih ada?
- apakah task bisa dianggap `UP-TO-DATE`?
- apakah output tersedia dari build cache?
- apakah dependency task sudah selesai?

Jika tidak perlu dijalankan, task bisa dilewati.

---

## 4. Project, Settings, Build Script, dan Task

Gradle build terdiri dari beberapa konsep inti.

### 4.1 Settings

`settings.gradle(.kts)` adalah entry point struktur build.

Fungsinya:

- memberi nama root project;
- include subproject;
- include composite build;
- mengatur plugin management;
- mengatur repository policy;
- mengatur feature preview tertentu;
- menjadi boundary awal build.

Contoh:

```kotlin
rootProject.name = "case-management-platform"

include("case-api")
include("case-domain")
include("case-application")
include("case-infrastructure")
include("case-web")
```

Kesalahan umum: meletakkan logic project detail di settings file. Settings file seharusnya menjawab struktur build, bukan mengatur compile/test detail setiap module.

### 4.2 Project

Setiap module Gradle adalah `Project`.

Dalam multi-project build:

```text
root project
├── case-api
├── case-domain
├── case-application
├── case-infrastructure
└── case-web
```

Setiap subproject punya:

- plugin;
- dependency;
- task;
- extension;
- source set;
- output;
- publication.

Command:

```bash
./gradlew projects
```

berguna untuk melihat struktur project.

### 4.3 Build Script

Build script adalah program deklaratif-imperatif yang mengonfigurasi project.

Gradle mendukung dua DSL utama:

```text
Groovy DSL: build.gradle
Kotlin DSL: build.gradle.kts
```

Untuk Java enterprise modern, Kotlin DSL sering lebih nyaman untuk maintainability karena:

- type-safe;
- IDE completion lebih kuat;
- refactoring lebih aman;
- lebih jelas saat membuat convention plugin.

Tetapi Groovy DSL masih luas dipakai, terutama di legacy project dan ekosistem Android lama.

Yang penting bukan DSL-nya, tetapi modelnya: build script harus mendaftarkan model build, bukan menjalankan side effect liar.

### 4.4 Task

Task adalah unit pekerjaan.

Contoh task bawaan plugin Java:

```text
compileJava
processResources
classes
jar
compileTestJava
test
check
build
clean
```

Task punya:

- identity: `:projectName:taskName`;
- action;
- dependencies;
- inputs;
- outputs;
- group;
- description;
- enabled flag;
- onlyIf predicate;
- finalizer;
- ordering constraint.

Contoh custom task sederhana:

```kotlin
tasks.register("printBuildInfo") {
    group = "verification"
    description = "Prints basic build information."

    doLast {
        println("Project: ${project.name}")
        println("Version: ${project.version}")
    }
}
```

Namun task seperti ini tidak punya output, sehingga tidak bisa mendapat manfaat incremental build secara penuh. Untuk task produksi, input/output harus dimodelkan.

---

## 5. Task Graph: Jantung Gradle

Gradle menjalankan task berdasarkan graph dependency.

Contoh:

```kotlin
tasks.register("generateSources") {
    doLast {
        println("Generating sources")
    }
}

tasks.named("compileJava") {
    dependsOn("generateSources")
}
```

Graph:

```text
generateSources -> compileJava
```

Saat menjalankan:

```bash
./gradlew compileJava
```

Gradle akan menjalankan `generateSources` lebih dulu.

### 5.1 dependsOn

`dependsOn` berarti task A membutuhkan task B selesai lebih dulu.

```kotlin
tasks.named("compileJava") {
    dependsOn("generateSources")
}
```

Makna:

```text
compileJava tidak boleh berjalan sebelum generateSources selesai.
```

Gunakan `dependsOn` untuk dependency produksi nyata.

### 5.2 finalizedBy

`finalizedBy` berarti task finalizer dijalankan setelah task utama, bahkan sering dipakai untuk cleanup/report.

```kotlin
tasks.named("test") {
    finalizedBy("jacocoTestReport")
}
```

Makna:

```text
Setelah test, jalankan jacocoTestReport.
```

Hati-hati: finalizer bukan dependency input-output. Jangan pakai `finalizedBy` untuk pekerjaan yang output-nya dibutuhkan oleh task utama.

### 5.3 mustRunAfter

`mustRunAfter` hanya ordering constraint, bukan dependency.

```kotlin
tasks.named("integrationTest") {
    mustRunAfter("test")
}
```

Makna:

```text
Jika test dan integrationTest sama-sama ada di graph, integrationTest harus setelah test.
Tetapi integrationTest tidak otomatis menyebabkan test dijalankan.
```

### 5.4 shouldRunAfter

`shouldRunAfter` lebih lemah dari `mustRunAfter`. Ia preferensi ordering, bukan aturan keras.

Gunakan untuk menghindari urutan buruk, tetapi jangan jadikan dasar correctness.

### 5.5 Task Graph Bukan Urutan File

Urutan deklarasi di build script tidak selalu sama dengan urutan eksekusi.

Yang menentukan eksekusi adalah:

- selected task;
- task dependencies;
- ordering constraints;
- plugin conventions;
- up-to-date/caching decision.

Karena itu, build Gradle harus dibaca sebagai graph.

---

## 6. Task State: Registered, Realized, Configured, Selected, Executed

Salah satu topik paling penting dalam Gradle modern adalah membedakan status task.

### 6.1 Registered

Task registered berarti Gradle tahu task itu ada, tetapi belum tentu object task dibuat dan dikonfigurasi penuh.

```kotlin
val generateMetadata = tasks.register("generateMetadata") {
    doLast {
        println("Generate metadata")
    }
}
```

Ini lazy.

### 6.2 Realized

Task realized berarti object task benar-benar dibuat. Realization bisa terjadi karena task dipilih, diakses, atau dibutuhkan task lain.

Contoh yang bisa memicu realization:

```kotlin
tasks.getByName("generateMetadata")
```

Lebih baik:

```kotlin
tasks.named("generateMetadata")
```

### 6.3 Configured

Task configured berarti action/configuration block-nya dievaluasi.

Eager configuration membuat semua task dikonfigurasi walaupun tidak dipakai.

### 6.4 Selected

Task selected berarti task masuk task graph karena user menjalankan command tertentu atau karena dependency task lain.

```bash
./gradlew test
```

Task `test` selected. Task `compileJava` mungkin ikut selected karena dependency graph.

### 6.5 Executed

Task executed berarti action task benar-benar berjalan.

Namun selected tidak selalu executed. Ia bisa:

- `UP-TO-DATE`;
- `FROM-CACHE`;
- `SKIPPED`;
- `NO-SOURCE`;
- disabled;
- failed sebelum action.

Mental model penting:

```text
registered != realized != selected != executed
```

Banyak build Gradle lambat karena semua task direalisasikan dan dikonfigurasi walaupun command hanya membutuhkan satu task kecil.

---

## 7. Configuration Avoidance: `register` vs `create`

Gradle modern mendorong task configuration avoidance.

### 7.1 Eager Task Creation

Contoh lama:

```kotlin
tasks.create("generateReport") {
    println("Configuring generateReport")
    doLast {
        println("Generating report")
    }
}
```

Masalah:

- task dibuat langsung saat configuration phase;
- configuration block berjalan meskipun task tidak dipakai;
- memperlambat build besar;
- buruk untuk multi-project;
- buruk untuk configuration cache discipline.

### 7.2 Lazy Task Registration

Contoh lebih baik:

```kotlin
tasks.register("generateReport") {
    println("Configuring generateReport")
    doLast {
        println("Generating report")
    }
}
```

Dengan `register`, Gradle bisa menunda pembuatan/configuration task sampai task diperlukan.

### 7.3 `named` untuk Task yang Sudah Ada

Jika task dibuat oleh plugin, gunakan:

```kotlin
tasks.named<Test>("test") {
    useJUnitPlatform()
}
```

Bukan:

```kotlin
tasks.getByName("test") {
    // eager access
}
```

### 7.4 `withType().configureEach`

Untuk mengonfigurasi semua task bertipe tertentu secara lazy:

```kotlin
tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    maxParallelForks = Runtime.getRuntime().availableProcessors().coerceAtMost(4)
}
```

Hindari:

```kotlin
tasks.withType<Test> {
    // bisa eager tergantung API/DSL usage
}
```

### 7.5 Prinsip

```text
Register, do not create.
Named, do not get.
ConfigureEach, do not all.
Provider, do not get early.
```

Ini adalah salah satu perbedaan antara Gradle beginner dan Gradle engineer yang matang.

---

## 8. Provider API: Fondasi Lazy Value

Gradle Provider API adalah cara Gradle memodelkan value yang belum tentu tersedia sekarang, tetapi akan tersedia nanti.

Konsep penting:

```text
Provider<T>      = value lazy/read-only
Property<T>      = configurable lazy value
ListProperty<T>  = lazy list
SetProperty<T>   = lazy set
MapProperty<K,V> = lazy map
RegularFileProperty = lazy file
DirectoryProperty   = lazy directory
```

### 8.1 Masalah Eager Value

Contoh buruk:

```kotlin
val outputDir = file("$buildDir/generated")
```

Masalah:

- memakai `buildDir` langsung;
- value dihitung saat configuration;
- kurang cocok untuk lazy configuration;
- bisa mengganggu relocatability/cacheability.

Lebih baik:

```kotlin
val outputDir = layout.buildDirectory.dir("generated")
```

`layout.buildDirectory.dir("generated")` menghasilkan provider directory yang lazy.

### 8.2 Property untuk Custom Task

Contoh custom task sehat:

```kotlin
abstract class GenerateBuildInfo : DefaultTask() {

    @get:Input
    abstract val applicationName: Property<String>

    @get:Input
    abstract val applicationVersion: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        val text = """
            name=${applicationName.get()}
            version=${applicationVersion.get()}
        """.trimIndent()

        outputFile.get().asFile.writeText(text)
    }
}
```

Register task:

```kotlin
tasks.register<GenerateBuildInfo>("generateBuildInfo") {
    applicationName.set(project.name)
    applicationVersion.set(provider { project.version.toString() })
    outputFile.set(layout.buildDirectory.file("generated/build-info.properties"))
}
```

Di sini value dievaluasi saat dibutuhkan, bukan semuanya dipaksa di awal.

### 8.3 `map` dan `flatMap`

Provider bisa ditransformasi tanpa memaksa value sekarang.

```kotlin
val generatedDir = layout.buildDirectory.dir("generated")

val generatedFile = generatedDir.map { dir ->
    dir.file("metadata.txt")
}
```

`map` menjaga laziness.

Jika transformasi menghasilkan provider lain, gunakan `flatMap`.

### 8.4 Jebakan `.get()`

`.get()` memaksa provider menghasilkan value sekarang.

Contoh buruk di configuration phase:

```kotlin
val fileNow = layout.buildDirectory.file("x.txt").get().asFile
```

Kadang `.get()` memang perlu, tetapi prinsipnya:

```text
Jangan panggil get() saat configuration kalau value bisa diteruskan sebagai Provider.
```

Gunakan provider chaining.

---

## 9. Extension: Cara Plugin Memberi DSL

Plugin Gradle sering menyediakan extension agar user bisa mengonfigurasi behavior plugin.

Contoh Java plugin:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

`java {}` adalah extension.

Contoh custom extension secara konseptual:

```kotlin
abstract class PlatformExtension {
    abstract val javaVersion: Property<Int>
    abstract val enableStrictChecks: Property<Boolean>
}
```

Plugin bisa membuat extension:

```kotlin
class PlatformPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val extension = project.extensions.create(
            "platform",
            PlatformExtension::class.java
        )

        extension.javaVersion.convention(21)
        extension.enableStrictChecks.convention(true)
    }
}
```

User build script:

```kotlin
platform {
    javaVersion.set(21)
    enableStrictChecks.set(true)
}
```

Mental model:

```text
Plugin menyediakan model.
Extension menyediakan DSL untuk mengisi model.
Task memakai model untuk bekerja.
```

Build script yang matang tidak menyebarkan konfigurasi liar ke banyak task. Ia membuat model konfigurasi yang jelas.

---

## 10. Plugin: Cara Gradle Menambahkan Capability

Plugin adalah unit reuse build logic.

Contoh plugin core:

```kotlin
plugins {
    java
    `java-library`
    `maven-publish`
    jacoco
}
```

Plugin bisa:

- menambahkan task;
- menambahkan extension;
- menambahkan configurations;
- mengatur source set;
- mengatur dependency convention;
- menghubungkan task;
- menambahkan publication;
- menambahkan validation.

### 10.1 Java Plugin

`java` plugin menambahkan lifecycle task seperti:

```text
compileJava
processResources
classes
jar
assemble
compileTestJava
processTestResources
testClasses
test
check
build
```

### 10.2 Java Library Plugin

`java-library` menambahkan pemisahan penting:

```text
api
implementation
compileOnly
runtimeOnly
testImplementation
```

Perbedaan `api` dan `implementation` sangat penting untuk library modular.

Jika dependency adalah bagian dari API publik library, gunakan `api`.
Jika dependency hanya internal implementation detail, gunakan `implementation`.

Contoh:

```kotlin
dependencies {
    api("com.fasterxml.jackson.core:jackson-annotations:2.17.2")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Jika class dari dependency muncul di public method signature, dependency itu cenderung `api`.

### 10.3 Maven Publish Plugin

`maven-publish` menambahkan kemampuan publish artifact:

```kotlin
publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
        }
    }
}
```

Bagian publishing akan dibahas lebih dalam di Part Release/Repository.

---

## 11. Source Set: Model Input Java

Dalam Gradle Java, source set adalah kumpulan source, resources, compile classpath, dan runtime classpath.

Default source set:

```text
main
src/main/java
src/main/resources

test
src/test/java
src/test/resources
```

Task terkait:

```text
compileJava          -> main Java
processResources     -> main resources
classes              -> compileJava + processResources
compileTestJava      -> test Java
processTestResources -> test resources
testClasses          -> compileTestJava + processTestResources
test                 -> run tests
```

### 11.1 Custom Source Set untuk Integration Test

Contoh:

```kotlin
sourceSets {
    create("integrationTest") {
        java.srcDir("src/integrationTest/java")
        resources.srcDir("src/integrationTest/resources")
        compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()
        runtimeClasspath += output + compileClasspath
    }
}

val integrationTestImplementation by configurations.getting {
    extendsFrom(configurations.testImplementation.get())
}

val integrationTestRuntimeOnly by configurations.getting {
    extendsFrom(configurations.testRuntimeOnly.get())
}

tasks.register<Test>("integrationTest") {
    description = "Runs integration tests."
    group = "verification"

    testClassesDirs = sourceSets["integrationTest"].output.classesDirs
    classpath = sourceSets["integrationTest"].runtimeClasspath
    shouldRunAfter(tasks.test)
    useJUnitPlatform()
}

tasks.check {
    dependsOn("integrationTest")
}
```

Catatan: dalam Gradle modern, JVM Test Suite plugin bisa menjadi pendekatan lebih baik untuk test suite kompleks. Namun memahami source set tetap fundamental.

---

## 12. Configuration: Bukan Sekadar “Dependency Bucket”

Dalam Gradle, configuration adalah named set of dependencies dan/atau resolvable/consumable variant.

Contoh configurations Java:

```text
implementation
api
compileOnly
runtimeOnly
testImplementation
testRuntimeOnly
compileClasspath
runtimeClasspath
testCompileClasspath
testRuntimeClasspath
```

Ada dua jenis besar:

```text
Declarable configuration  -> tempat user mendeklarasikan dependency
Resolvable configuration  -> classpath yang di-resolve untuk dipakai task
Consumable configuration  -> variant yang dipublish/dikonsumsi project lain
```

Contoh:

```kotlin
dependencies {
    implementation("org.apache.commons:commons-lang3:3.14.0")
}
```

`implementation` bukan classpath langsung. Ia deklarasi dependency. Gradle kemudian membentuk `compileClasspath` dan `runtimeClasspath` berdasarkan konfigurasi, plugin, variant, dan attributes.

Mental model:

```text
implementation adalah input deklaratif.
compileClasspath/runtimeClasspath adalah hasil resolusi.
```

Jangan resolve dependency terlalu awal di configuration phase.

Contoh buruk:

```kotlin
configurations.runtimeClasspath.get().files.forEach {
    println(it)
}
```

Ini memaksa dependency resolution saat configuration.

Lebih baik buat task:

```kotlin
tasks.register("printRuntimeClasspath") {
    val runtimeClasspath = configurations.runtimeClasspath

    doLast {
        runtimeClasspath.get().forEach { println(it) }
    }
}
```

---

## 13. Incremental Build: Menghindari Kerja yang Tidak Perlu

Incremental build berarti Gradle tidak menjalankan task jika input dan output task tidak berubah.

Agar ini bisa bekerja, task harus mendeklarasikan:

- input file;
- input directory;
- input property;
- classpath;
- output file;
- output directory;
- output property.

Jika task tidak punya output, Gradle sulit menyatakan task up-to-date.

### 13.1 Contoh Task Non-Incremental

```kotlin
tasks.register("generateVersionFile") {
    doLast {
        file("build/version.txt").writeText(project.version.toString())
    }
}
```

Masalah:

- Gradle tidak tahu input-nya apa;
- Gradle tidak tahu output-nya apa;
- task cenderung selalu dianggap perlu jalan;
- tidak cacheable.

### 13.2 Contoh Task Incremental Basic

```kotlin
tasks.register("generateVersionFile") {
    val versionValue = providers.provider { project.version.toString() }
    val outputFile = layout.buildDirectory.file("generated/version.txt")

    inputs.property("version", versionValue)
    outputs.file(outputFile)

    doLast {
        outputFile.get().asFile.writeText(versionValue.get())
    }
}
```

Sekarang Gradle tahu:

```text
Input  = project version
Output = build/generated/version.txt
```

Jika version tidak berubah dan output masih ada, task bisa `UP-TO-DATE`.

### 13.3 Custom Task dengan Annotation

Lebih kuat:

```kotlin
abstract class GenerateVersionFile : DefaultTask() {

    @get:Input
    abstract val versionText: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        outputFile.get().asFile.writeText(versionText.get())
    }
}

tasks.register<GenerateVersionFile>("generateVersionFile") {
    versionText.set(provider { project.version.toString() })
    outputFile.set(layout.buildDirectory.file("generated/version.txt"))
}
```

Ini lebih maintainable untuk plugin/task reusable.

---

## 14. Up-to-Date Check vs Build Cache

Keduanya sering tertukar.

### 14.1 Up-to-Date Check

Up-to-date check menjawab:

```text
Apakah output task lokal saat ini masih valid untuk input saat ini?
```

Jika ya:

```text
:compileJava UP-TO-DATE
```

Ini berbasis state lokal build directory.

### 14.2 Build Cache

Build cache menjawab:

```text
Apakah output untuk input fingerprint ini pernah diproduksi sebelumnya, mungkin di mesin lain, dan bisa digunakan ulang?
```

Jika ya:

```text
:compileJava FROM-CACHE
```

Build cache bisa lokal atau remote.

### 14.3 Perbedaan

| Aspek | Up-to-date check | Build cache |
|---|---|---|
| Scope | Local workspace | Local/remote cache |
| Butuh output ada di build dir | Ya | Tidak selalu |
| Bisa reuse dari CI/mesin lain | Tidak | Ya, jika remote cache |
| Fokus | Skip task karena output masih valid | Restore output dari cache |
| Risiko | Missing input/output membuat false up-to-date | Non-deterministic task mencemari cache |

### 14.4 Syarat Task Cacheable

Task cacheable harus:

- punya input/output lengkap;
- deterministic;
- tidak bergantung pada absolute path tanpa deklarasi normalization;
- tidak membaca environment tersembunyi;
- tidak menulis output di luar deklarasi;
- tidak menggunakan waktu sekarang/random tanpa input eksplisit;
- tidak melakukan network call yang hasilnya berubah tanpa input.

Task yang tidak deterministic lebih berbahaya jika cacheable daripada jika selalu jalan.

---

## 15. Configuration Cache: Cache Model Konfigurasi

Configuration cache berbeda dari build cache.

Build cache menyimpan output task.

Configuration cache menyimpan hasil configuration phase sehingga build berikutnya tidak perlu mengevaluasi ulang seluruh build script jika input konfigurasi tidak berubah.

Mental model:

```text
Build cache          -> cache hasil task execution
Configuration cache  -> cache hasil build configuration/model
```

### 15.1 Mengapa Penting?

Pada multi-project besar, configuration phase bisa mahal. Bahkan menjalankan task kecil bisa lambat karena Gradle harus mengonfigurasi banyak project/task.

Configuration cache membantu dengan menyimpan configured task graph/model.

### 15.2 Implikasi untuk Build Script

Build script dan plugin harus lebih disiplin:

- tidak menyimpan object Gradle internal sembarangan di task;
- tidak membaca project state saat execution;
- tidak melakukan side effect configuration;
- menggunakan Provider API;
- menggunakan declared inputs;
- memakai BuildService untuk shared services;
- menghindari global mutable state.

Contoh buruk dalam task action:

```kotlin
tasks.register("badTask") {
    doLast {
        println(project.version) // akses Project saat execution bisa bermasalah untuk configuration cache
    }
}
```

Lebih baik capture sebagai provider/input:

```kotlin
tasks.register("goodTask") {
    val versionText = providers.provider { project.version.toString() }
    inputs.property("version", versionText)

    doLast {
        println(versionText.get())
    }
}
```

Untuk custom task, jauh lebih baik membuat property input.

---

## 16. Gradle Daemon

Gradle Daemon adalah long-lived background process yang menjalankan build lebih cepat dengan reuse JVM, classloader, caches, dan state internal tertentu.

Dampaknya:

- local build lebih cepat;
- warm build lebih cepat dari cold build;
- memory setting Gradle penting;
- plugin yang bocor state bisa berdampak lebih lama;
- daemon bisa restart jika JVM args berubah.

Command berguna:

```bash
./gradlew --status
./gradlew --stop
```

Di CI, penggunaan daemon tergantung environment. Banyak CI modern tetap memakai daemon per job/container, tetapi job ephemeral membuat benefit lebih terbatas dibanding local development.

---

## 17. Gradle Wrapper: Build Tool sebagai Bagian dari Source Control

Gradle Wrapper memastikan semua engineer dan CI memakai versi Gradle yang sama.

File penting:

```text
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.jar
gradle/wrapper/gradle-wrapper.properties
```

Contoh wrapper properties:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.3-bin.zip
```

Prinsip:

```text
Jangan mengandalkan Gradle global di mesin developer/CI.
Gunakan ./gradlew.
```

Wrapper adalah bagian dari reproducibility.

Command upgrade:

```bash
./gradlew wrapper --gradle-version 8.14.3
```

Lalu jalankan sekali lagi jika perlu agar wrapper files diperbarui sesuai versi baru.

---

## 18. Kotlin DSL vs Groovy DSL

Gradle mendukung Groovy DSL dan Kotlin DSL.

### 18.1 Groovy DSL

File:

```text
build.gradle
settings.gradle
```

Contoh:

```groovy
plugins {
    id 'java-library'
}

dependencies {
    implementation 'org.apache.commons:commons-lang3:3.14.0'
}
```

Kelebihan:

- lebih ringkas;
- banyak contoh lama;
- dynamic DSL natural.

Kekurangan:

- type safety lebih lemah;
- refactoring lebih riskan;
- typo kadang baru terlihat saat build;
- IDE completion tidak sekuat Kotlin DSL.

### 18.2 Kotlin DSL

File:

```text
build.gradle.kts
settings.gradle.kts
```

Contoh:

```kotlin
plugins {
    `java-library`
}

dependencies {
    implementation("org.apache.commons:commons-lang3:3.14.0")
}
```

Kelebihan:

- type-safe;
- IDE support kuat;
- refactoring lebih aman;
- cocok untuk convention plugin.

Kekurangan:

- syntax bisa lebih verbose;
- beberapa contoh internet memakai Groovy;
- perlu memahami Kotlin basics.

Untuk enterprise Java modern, Kotlin DSL sering menjadi pilihan lebih maintainable.

---

## 19. Build Script Sehat vs Tidak Sehat

### 19.1 Build Script Tidak Sehat

Ciri-ciri:

```kotlin
println("Configuring ${project.name}")

val generated = file("src/main/generated")
generated.mkdirs()

tasks.create("generate") {
    doLast {
        generated.resolve("X.java").writeText("...")
    }
}

configurations.runtimeClasspath.get().files.forEach {
    println(it)
}
```

Masalah:

- side effect saat configuration;
- output generated source masuk `src/main`, bukan `build/`;
- eager task creation;
- dependency resolution saat configuration;
- sulit incremental/cacheable;
- sulit dibersihkan oleh `clean`;
- berisiko menghasilkan dirty working tree.

### 19.2 Build Script Lebih Sehat

```kotlin
val generatedSourcesDir = layout.buildDirectory.dir("generated/sources/buildInfo/java")

abstract class GenerateBuildInfoSource : DefaultTask() {
    @get:Input
    abstract val packageName: Property<String>

    @get:Input
    abstract val versionText: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val dir = outputDir.get().asFile.resolve(packageName.get().replace('.', '/'))
        dir.mkdirs()
        dir.resolve("BuildInfo.java").writeText(
            """
            package ${packageName.get()};

            public final class BuildInfo {
                private BuildInfo() {}
                public static final String VERSION = "${versionText.get()}";
            }
            """.trimIndent()
        )
    }
}

val generateBuildInfoSource = tasks.register<GenerateBuildInfoSource>("generateBuildInfoSource") {
    packageName.set("com.example.generated")
    versionText.set(provider { project.version.toString() })
    outputDir.set(generatedSourcesDir)
}

sourceSets.main {
    java.srcDir(generateBuildInfoSource.map { it.outputDir })
}
```

Catatan: contoh di atas menunjukkan model. Dalam implementasi nyata, syntax sourceSets dengan task provider bisa disesuaikan agar idiomatis untuk versi Gradle yang dipakai.

Prinsipnya:

- generated output masuk `build/`;
- task punya input/output;
- source set tergantung output task;
- tidak ada side effect configuration;
- build bisa incremental.

---

## 20. Membaca Output Gradle

Contoh output:

```text
> Task :compileJava UP-TO-DATE
> Task :processResources NO-SOURCE
> Task :classes UP-TO-DATE
> Task :compileTestJava
> Task :processTestResources NO-SOURCE
> Task :testClasses
> Task :test

BUILD SUCCESSFUL in 5s
3 actionable tasks: 2 executed, 1 up-to-date
```

Status umum:

| Status | Makna |
|---|---|
| `EXECUTED` | Task action berjalan |
| `UP-TO-DATE` | Input/output tidak berubah |
| `FROM-CACHE` | Output diambil dari build cache |
| `NO-SOURCE` | Tidak ada source/input source yang relevan |
| `SKIPPED` | Task dilewati karena kondisi tertentu |
| `FAILED` | Task gagal |

Output Gradle harus dibaca sebagai observability kecil terhadap task graph.

Jika task selalu executed padahal seharusnya tidak, kemungkinan:

- input tidak stabil;
- output tidak dideklarasikan;
- task membaca waktu/env random;
- output berubah sendiri;
- annotation processor tidak incremental;
- task type tidak mendukung incremental;
- build script memodifikasi output saat configuration.

---

## 21. Command-Line Mental Model

### 21.1 Melihat Task

```bash
./gradlew tasks
./gradlew tasks --all
```

### 21.2 Menjalankan Task

```bash
./gradlew build
./gradlew test
./gradlew :case-domain:test
```

### 21.3 Dry Run

```bash
./gradlew build --dry-run
```

Menampilkan task yang akan dijalankan tanpa menjalankannya.

### 21.4 Melihat Dependency

```bash
./gradlew dependencies
./gradlew :case-app:dependencies --configuration runtimeClasspath
```

### 21.5 Dependency Insight

```bash
./gradlew :case-app:dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

### 21.6 Info/Debug

```bash
./gradlew build --info
./gradlew build --debug
./gradlew build --stacktrace
./gradlew build --scan
```

Gunakan `--debug` dengan hati-hati karena output sangat besar dan bisa mengekspos data sensitif di log.

### 21.7 Refresh Dependency

```bash
./gradlew build --refresh-dependencies
```

Jangan jadikan default di CI kecuali ada alasan kuat. Ini bisa membuat build lebih lambat dan mengurangi manfaat cache.

---

## 22. Multi-Project Build Mental Model

Gradle sangat kuat untuk multi-project build.

Contoh struktur:

```text
case-platform/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle/libs.versions.toml
├── case-api/
│   └── build.gradle.kts
├── case-domain/
│   └── build.gradle.kts
├── case-application/
│   └── build.gradle.kts
└── case-infrastructure/
    └── build.gradle.kts
```

settings:

```kotlin
rootProject.name = "case-platform"

include("case-api")
include("case-domain")
include("case-application")
include("case-infrastructure")
```

Dependency antar-project:

```kotlin
dependencies {
    implementation(project(":case-domain"))
    implementation(project(":case-api"))
}
```

### 22.1 Root Build Script

Root build script sering dipakai untuk konfigurasi umum, tetapi hati-hati dengan `subprojects {}` dan `allprojects {}`.

Contoh yang sering muncul:

```kotlin
subprojects {
    apply(plugin = "java-library")

    repositories {
        mavenCentral()
    }
}
```

Ini bekerja, tetapi untuk build besar lebih baik menggunakan convention plugin agar logic lebih terstruktur, testable, dan tidak menjadi root script raksasa.

### 22.2 Convention Plugin

Alih-alih root script besar:

```text
build-logic/
└── convention plugins
```

Contoh pemakaian di subproject:

```kotlin
plugins {
    id("com.company.java-library-conventions")
}
```

Convention plugin akan dibahas lebih detail pada bagian plugin dan enterprise governance. Untuk sekarang, pahami prinsipnya:

```text
Build logic yang dipakai banyak module sebaiknya menjadi plugin, bukan copy-paste script.
```

---

## 23. `buildSrc` vs Included Build untuk Build Logic

Gradle historis sering memakai `buildSrc`.

Struktur:

```text
buildSrc/
└── src/main/kotlin/...
```

`buildSrc` otomatis dikompilasi dan tersedia untuk build script.

Kelebihan:

- mudah;
- otomatis;
- cocok untuk build logic kecil.

Kekurangan:

- perubahan kecil di `buildSrc` bisa memicu recompilation dan invalidasi besar;
- kurang eksplisit;
- pada build besar, included build `build-logic` sering lebih scalable.

Alternatif modern:

```text
build-logic/
├── settings.gradle.kts
└── convention/
    └── build.gradle.kts
```

Di root settings:

```kotlin
pluginManagement {
    includeBuild("build-logic")
}
```

Lalu subproject bisa apply plugin convention.

Mental model:

```text
buildSrc cocok untuk sederhana.
included build cocok untuk build logic serius/enterprise.
```

---

## 24. Gradle dan Java 8–25

Bagian Java version strategy sudah dibahas di Part 1, tetapi khusus Gradle mental model perlu diingat:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Gradle toolchain memisahkan:

- JDK yang menjalankan Gradle;
- JDK yang dipakai compile/test/run.

Ini penting untuk enterprise yang perlu:

- build library target Java 8;
- menjalankan Gradle dengan JDK modern;
- test di Java 17/21/25;
- migrasi bertahap.

Contoh compile target Java 8 dengan toolchain Java 21:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

Namun pastikan dependency juga kompatibel dengan Java 8. `options.release = 8` tidak membuat dependency bytecode Java 17 tiba-tiba menjadi compatible.

---

## 25. Lifecycle Task Java: `assemble`, `check`, `build`

Gradle Java plugin punya lifecycle task yang tidak selalu punya action sendiri.

### 25.1 `assemble`

Biasanya bergantung pada task packaging seperti `jar`.

```text
assemble -> jar
```

### 25.2 `check`

Biasanya bergantung pada verification tasks seperti `test`.

```text
check -> test
```

Jika menambahkan integration test:

```kotlin
tasks.check {
    dependsOn("integrationTest")
}
```

### 25.3 `build`

Biasanya menggabungkan:

```text
build -> assemble + check
```

Mental model:

```text
assemble = produce artifacts
check    = verify correctness
build    = assemble + check
```

Ini mirip lifecycle aggregation, tetapi tetap berbasis task graph.

---

## 26. Gradle Build sebagai Contract

Build Gradle yang baik adalah contract antara developer, CI, release pipeline, dan runtime.

Contract itu menjawab:

- source mana yang dikompilasi;
- dependency mana yang dipakai;
- Java version mana yang dipakai;
- test mana yang wajib;
- artifact apa yang dihasilkan;
- output mana yang valid;
- task mana yang cacheable;
- repository mana yang boleh dipakai;
- plugin mana yang dipercaya;
- environment variable mana yang merupakan input sah;
- build gagal pada kondisi apa.

Jika contract tidak eksplisit, build akan bergantung pada kebiasaan lokal.

Contoh contract eksplisit:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    failFast = false
}
```

Contoh contract tidak eksplisit:

```text
Developer harus ingat pakai JDK 17.
Developer harus ingat run integration test manual.
Developer harus ingat jangan pakai dependency tertentu.
```

Top 1% engineer mengubah “harus ingat” menjadi “build enforcement”.

---

## 27. Failure Taxonomy di Gradle

Saat Gradle build gagal, jangan langsung patch acak. Kategorikan dulu.

### 27.1 Initialization Failure

Gejala:

- settings error;
- plugin repository tidak bisa diakses;
- included build tidak ditemukan;
- Gradle version incompatible.

Contoh:

```text
Plugin [id: 'com.company.convention'] was not found
```

Pertanyaan diagnosis:

- Plugin dicari dari repository mana?
- Apakah `pluginManagement` benar?
- Apakah included build terdaftar?
- Apakah plugin marker artifact tersedia?

### 27.2 Configuration Failure

Gejala:

- error saat evaluate build script;
- property tidak ada;
- task access salah;
- dependency resolution terlalu awal;
- Kotlin DSL compilation error.

Contoh:

```text
Cannot get property 'runtimeClasspath' on null object
```

Pertanyaan diagnosis:

- Plugin yang membuat extension/configuration sudah applied?
- Kode berjalan terlalu awal?
- Apakah menggunakan eager access?
- Apakah subproject belum punya plugin Java?

### 27.3 Dependency Resolution Failure

Gejala:

- artifact tidak ditemukan;
- repository auth gagal;
- conflict tidak bisa diselesaikan;
- variant mismatch;
- capability conflict.

Contoh:

```text
Could not resolve all files for configuration ':runtimeClasspath'
```

Pertanyaan diagnosis:

- Configuration mana yang resolve?
- Dependency direct atau transitive?
- Repository mana yang dicari?
- Ada version catalog/platform/constraint?
- Ada metadata Gradle module variant?

### 27.4 Task Execution Failure

Gejala:

- compile error;
- test fail;
- file generation error;
- permission error;
- command external gagal.

Pertanyaan diagnosis:

- Task mana yang gagal?
- Input task apa?
- Output task apa?
- Apakah bisa reproduce dengan task spesifik?
- Apakah failure hanya di CI?

### 27.5 Cache/Incremental Failure

Gejala:

- task selalu jalan;
- task salah `UP-TO-DATE`;
- output stale;
- build cache menghasilkan artifact salah.

Pertanyaan diagnosis:

- Input/output lengkap?
- Task deterministic?
- Ada output di luar deklarasi?
- Ada env var/waktu/random yang tidak dideklarasikan?
- Path sensitivity benar?

---

## 28. Debugging Workflow Gradle

### Step 1 — Reproduce Task Terkecil

Jangan langsung:

```bash
./gradlew build
```

Jika yang gagal compile:

```bash
./gradlew :module:compileJava --stacktrace
```

Jika yang gagal test:

```bash
./gradlew :module:test --tests "com.example.MyTest" --stacktrace
```

### Step 2 — Lihat Task Graph

```bash
./gradlew :module:test --dry-run
```

Tanya:

- Task apa saja yang masuk graph?
- Ada task tidak relevan ikut jalan?
- Ada dependency task yang hilang?

### Step 3 — Naikkan Verbosity Secukupnya

```bash
./gradlew :module:test --info
./gradlew :module:test --stacktrace
```

Gunakan `--debug` hanya jika perlu.

### Step 4 — Cek Dependency

```bash
./gradlew :module:dependencies --configuration testRuntimeClasspath
./gradlew :module:dependencyInsight --dependency junit --configuration testRuntimeClasspath
```

### Step 5 — Cek Environment

```bash
./gradlew --version
java -version
```

Cek:

- Gradle version;
- JVM running Gradle;
- toolchain JDK;
- OS;
- CI container image;
- env var;
- repository credentials.

### Step 6 — Bersihkan dengan Terukur

Jangan langsung hapus semua cache global jika belum perlu.

Urutan:

```bash
./gradlew clean
./gradlew :module:clean :module:test
./gradlew :module:test --rerun-tasks
./gradlew :module:test --refresh-dependencies
```

`--rerun-tasks` melewati up-to-date check, tetapi bukan solusi permanen.

---

## 29. Common Anti-Patterns

### 29.1 Side Effect di Configuration Phase

```kotlin
file("build/generated.txt").writeText("hello")
```

Seharusnya task action.

### 29.2 Eager Task Creation

```kotlin
tasks.create("x")
```

Gunakan:

```kotlin
tasks.register("x")
```

### 29.3 Eager Task Access

```kotlin
tasks.getByName("test")
```

Gunakan:

```kotlin
tasks.named<Test>("test")
```

### 29.4 Dependency Resolution Saat Configuration

```kotlin
configurations.runtimeClasspath.get().files
```

Pindahkan ke task action atau gunakan provider.

### 29.5 Output ke `src/`

Generated source sebaiknya ke:

```text
build/generated/...
```

Bukan:

```text
src/main/generated
```

Kecuali memang source tersebut dimiliki manusia dan dicommit.

### 29.6 Root Build Script Raksasa

`subprojects {}` berisi ratusan baris logic adalah smell.

Gunakan convention plugin.

### 29.7 Dynamic Version Tanpa Kontrol

```kotlin
implementation("com.example:lib:1.+")
```

Membuat build tidak reproducible.

Gunakan pinned version, platform, catalog, dan locking.

### 29.8 Membaca Environment Tanpa Menjadikannya Input

```kotlin
val mode = System.getenv("MODE")
```

Jika mode mempengaruhi output task, jadikan input eksplisit.

---

## 30. Gradle untuk Enterprise Java: Prinsip Desain

Untuk Java enterprise besar, Gradle build sebaiknya mengikuti prinsip:

### 30.1 Build Logic Terpusat, Project Build Ringan

Subproject build file idealnya pendek:

```kotlin
plugins {
    id("com.company.java-library-conventions")
}

dependencies {
    api(project(":case-api"))
    implementation(libs.jackson.databind)
}
```

Bukan ratusan baris konfigurasi berulang.

### 30.2 Repository Policy di Settings

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://nexus.company.local/repository/maven-public")
    }
}
```

Ini mencegah subproject sembarang menambahkan repository.

### 30.3 Version Policy dengan Catalog/Platform

```text
gradle/libs.versions.toml
```

atau Java platform project.

### 30.4 Java Toolchain Eksplisit

Jangan bergantung pada JDK lokal.

### 30.5 Quality Gate sebagai Task

Checkstyle, SpotBugs, test, coverage, dependency scan, license check harus masuk `check` atau pipeline stage yang jelas.

### 30.6 Generated Code Terkelola

OpenAPI, Protobuf, jOOQ, QueryDSL, JAXB generation harus punya task input/output jelas.

### 30.7 CI Memanggil Contract yang Sama

Local dan CI harus menjalankan command contract yang sama, misalnya:

```bash
./gradlew clean build
```

atau lebih optimal:

```bash
./gradlew build --scan
```

Jika CI menjalankan step manual yang tidak ada di Gradle, build contract tersebar.

---

## 31. Mental Model “Gradle Is a Model Builder”

Cara paling produktif membaca Gradle:

```text
1. Settings menentukan universe build.
2. Plugin menambahkan capability.
3. Extension menyimpan konfigurasi user.
4. Configuration menyimpan dependency declaration/resolution model.
5. SourceSet menyimpan source/resource model.
6. Task menyimpan unit kerja.
7. Provider menunda value sampai diperlukan.
8. Task graph menentukan urutan kerja.
9. Input/output menentukan incremental/cache behavior.
10. Execution menjalankan task yang benar-benar diperlukan.
```

Jika terjadi masalah, tanyakan:

```text
Masalah ini terjadi di model mana?
- settings?
- plugin resolution?
- project configuration?
- dependency resolution?
- task graph?
- task execution?
- cache/incremental?
```

Ini jauh lebih efektif daripada membaca build script sebagai teks linear.

---

## 32. Worked Example: Build Gradle Java Library yang Sehat

Struktur:

```text
order-domain/
├── settings.gradle.kts
├── build.gradle.kts
└── src/
    ├── main/java/com/example/order/Order.java
    └── test/java/com/example/order/OrderTest.java
```

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

rootProject.name = "order-domain"
```

`build.gradle.kts`:

```kotlin
plugins {
    `java-library`
    jacoco
}

group = "com.example"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestReport)
}
```

Yang baik dari contoh ini:

- plugin eksplisit;
- repository policy di settings;
- Java toolchain eksplisit;
- release target eksplisit;
- dependency jelas;
- test platform jelas;
- quality report terhubung ke `check`;
- tidak ada side effect configuration;
- memakai lazy task configuration.

---

## 33. Worked Example: Multi-Project Minimal

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

rootProject.name = "regulatory-platform"

include("case-api")
include("case-domain")
include("case-application")
include("case-infrastructure")
```

Root `build.gradle.kts` minimal:

```kotlin
plugins {
    // no root plugin unless needed
}
```

`case-domain/build.gradle.kts`:

```kotlin
plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}
```

`case-application/build.gradle.kts`:

```kotlin
plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    implementation(project(":case-domain"))
    implementation(project(":case-api"))
}
```

Masalah: konfigurasi Java berulang.

Solusi lanjutan: convention plugin.

Namun sebagai mental model, ini menunjukkan:

```text
settings.gradle.kts membentuk project graph.
project dependencies membentuk compile/runtime graph.
task dependencies membentuk execution graph.
```

---

## 34. Kapan Gradle Terasa Sulit?

Gradle terasa sulit ketika engineer mencampur beberapa layer:

```text
configuration logic
execution logic
dependency resolution logic
code generation logic
publication logic
CI logic
environment logic
```

Semua ditaruh di satu `build.gradle.kts`.

Build yang scalable memisahkan layer:

| Layer | Tempat Ideal |
|---|---|
| Project inclusion | `settings.gradle.kts` |
| Repository policy | `settings.gradle.kts` / init script enterprise |
| Common build convention | convention plugin |
| Module-specific dependency | subproject build file |
| Generated code | dedicated task/plugin |
| Quality gate | plugin/task wired to `check` |
| Release/publish | publishing plugin/config |
| CI orchestration | CI YAML memanggil Gradle contract |

Prinsipnya:

```text
Gradle build file bukan tempat dumping semua automation.
Gradle build harus menjadi model eksplisit dari build contract.
```

---

## 35. Checklist Review Gradle Core

Gunakan checklist ini saat review Gradle project.

### 35.1 Structure

- [ ] Ada Gradle Wrapper?
- [ ] `settings.gradle(.kts)` jelas dan minimal?
- [ ] Repository policy didefinisikan terpusat?
- [ ] Subproject inclusion eksplisit?
- [ ] Tidak ada repository liar di subproject?

### 35.2 Plugin

- [ ] Plugin version dipin?
- [ ] Plugin dipakai sesuai scope?
- [ ] Common logic tidak copy-paste?
- [ ] Convention plugin dipakai untuk konfigurasi berulang?

### 35.3 Task

- [ ] Custom task memakai `tasks.register`?
- [ ] Task bawaan dikonfigurasi dengan `tasks.named` atau `configureEach`?
- [ ] Tidak ada `tasks.create` tanpa alasan?
- [ ] Tidak ada task dependency palsu?
- [ ] `dependsOn`, `mustRunAfter`, `finalizedBy` dipakai sesuai makna?

### 35.4 Lazy Configuration

- [ ] Provider API digunakan?
- [ ] Tidak ada `.get()` terlalu awal?
- [ ] Tidak ada dependency resolution di configuration phase?
- [ ] Tidak ada file generation di configuration phase?

### 35.5 Incremental/Cache

- [ ] Custom task punya input/output?
- [ ] Generated output masuk `build/`?
- [ ] Task deterministic?
- [ ] Environment input dideklarasikan?
- [ ] Tidak ada output task di luar deklarasi?

### 35.6 Java

- [ ] Toolchain eksplisit?
- [ ] `options.release` dipakai jika target bytecode penting?
- [ ] Test memakai platform yang jelas?
- [ ] Source set tambahan dirancang benar?

### 35.7 Debuggability

- [ ] Task bisa dijalankan secara spesifik per module?
- [ ] Dependency insight bekerja?
- [ ] Build failure bisa dikategorikan?
- [ ] CI command sama dengan local contract?

---

## 36. Ringkasan Mental Model

Gradle bukan sekadar build script. Gradle adalah engine yang:

1. membaca settings untuk menentukan universe build;
2. mengevaluasi project build script untuk membentuk model;
3. plugin menambahkan capability;
4. extension menyimpan konfigurasi;
5. configuration menyimpan dependency model;
6. source set menyimpan source/resource model;
7. task menyimpan unit kerja;
8. Provider API menjaga value tetap lazy;
9. task graph menentukan pekerjaan yang perlu;
10. input/output menentukan incremental dan cache behavior;
11. execution phase menjalankan task yang benar-benar diperlukan.

Perbedaan engineer biasa dan engineer matang dalam Gradle bukan sekadar tahu syntax, tetapi tahu **kapan sebuah baris build script dievaluasi, apa efeknya terhadap graph, apakah ia lazy, apakah ia cacheable, dan apakah ia membuat build lebih deterministik atau lebih rapuh**.

Jika Maven mengajarkan disiplin melalui convention, Gradle menuntut engineer menciptakan disiplin melalui model.

---

## 37. Referensi Resmi dan Bacaan Lanjutan

- Gradle User Manual — Build Lifecycle: initialization, configuration, execution.
- Gradle User Manual — Task Configuration Avoidance.
- Gradle User Manual — Lazy Configuration dan Provider API.
- Gradle User Manual — Incremental Build.
- Gradle User Manual — Build Cache.
- Gradle User Manual — Java Plugin dan Java Library Plugin.
- Gradle User Manual — Multi-Project Builds.
- Gradle User Manual — Build Environment dan Gradle Wrapper.

---

## 38. Status Seri

```text
[x] Part 0 — Build Engineering Mental Model
[x] Part 1 — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
[x] Part 2 — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor
[x] Part 3 — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API
[ ] Part 4 — Maven vs Gradle: Bukan Mana yang Lebih Bagus, Tapi Mana yang Cocok untuk Constraint Tertentu
[ ] Part 5 — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform
[ ] Part 6 — Dependency Graph Fundamentals: Direct, Transitive, Scope, Configuration, Variant
[ ] Part 7 — Dependency Version Management: BOM, Platforms, Constraints, Catalogs, Locking
[ ] Part 8 — Repository Engineering: Maven Central, Nexus, Artifactory, Proxy, Mirror, Credential, Offline Build
[ ] Part 9 — Build Reproducibility: Deterministic Artifact, Timestamp, Lockfile, Checksum, Build Environment
[ ] Part 10 — Compiler Engineering: javac, Annotation Processing, Incremental Compilation, Generated Sources
[ ] Part 11 — Testing Build Pipeline: Unit, Integration, Functional, Contract, Mutation, Benchmark
[ ] Part 12 — Packaging Engineering: JAR, Fat JAR, Thin JAR, WAR, EAR, Modular JAR, Native Image
[ ] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[ ] Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy
[ ] Part 15 — Maven Advanced Plugin Engineering: Custom Mojo, Parameter Injection, Lifecycle Binding
[ ] Part 16 — Gradle Advanced Plugin Engineering: Custom Task, Extension, Provider API, Build Services
[ ] Part 17 — Performance Engineering: Build Time, Configuration Cache, Daemon, Parallelism, Incrementality
[ ] Part 18 — CI/CD Build Architecture: Pipeline Design, Cache Strategy, Matrix Build, Release Promotion
[ ] Part 19 — Release Engineering: Semantic Versioning, Snapshot, Release, Tagging, Changelog, Publishing
[ ] Part 20 — Security Engineering: Dependency Vulnerability, Plugin Trust, SBOM, Signing, SLSA, Supply Chain
[ ] Part 21 — Enterprise Governance: Corporate Parent POM, Convention Plugin, Policy-as-Build
[ ] Part 22 — Multi-Module Architecture for Large Java Systems
[ ] Part 23 — Jakarta/Spring/Enterprise Java Build Integration
[ ] Part 24 — Code Generation Pipelines: OpenAPI, JAXB, Protobuf, gRPC, jOOQ, QueryDSL
[ ] Part 25 — Static Analysis and Quality Gates: Checkstyle, PMD, SpotBugs, Error Prone, ArchUnit
[ ] Part 26 — Dependency Conflict Case Studies: Logging, Jackson, Netty, Guava, Jakarta/Javax Split
[ ] Part 27 — Migration Engineering: Maven to Gradle, Gradle to Maven, Legacy Ant, Java 8 to 25
[ ] Part 28 — Troubleshooting Build Failures: Systematic Debugging Framework
[ ] Part 29 — Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes
[ ] Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions
[ ] Part 31 — Build Observability: Logs, Reports, Build Scan, Metrics, Flakiness, Trend Analysis
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform
[ ] Part 34 — Top 1% Build Engineer Playbook: Heuristics, Anti-Patterns, Decision Matrix
```

Seri belum selesai. Bagian berikutnya adalah **Part 4 — Maven vs Gradle: Bukan Mana yang Lebih Bagus, Tapi Mana yang Cocok untuk Constraint Tertentu**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor](./02-maven-core-mental-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — Maven vs Gradle: Bukan Mana yang Lebih Bagus, Tapi Mana yang Cocok untuk Constraint Tertentu](./04-maven-vs-gradle-decision-framework.md)
