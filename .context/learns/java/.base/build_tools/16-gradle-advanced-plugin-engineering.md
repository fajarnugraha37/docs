# Part 16 — Gradle Advanced Plugin Engineering: Custom Task, Extension, Provider API, Build Services

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `16-gradle-advanced-plugin-engineering.md`  
> Fokus: Gradle plugin engineering tingkat lanjut untuk Java 8–25, build logic reuse, custom task, extension DSL, lazy configuration, Provider API, incremental/cacheable task, Worker API, BuildService, TestKit, dan configuration cache compatibility.

---

## 0. Kenapa Part Ini Penting

Pada level basic, Gradle sering dipakai seperti ini:

```kotlin
plugins {
    java
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Itu cukup untuk project kecil.

Tetapi pada sistem besar, build script yang tumbuh tanpa struktur akan berubah menjadi “mini application” yang tidak dites, tidak punya boundary, susah dipahami, lambat, dan penuh side effect.

Di titik itu, Gradle plugin engineering menjadi skill penting.

Plugin engineering bukan hanya membuat `Plugin<Project>` lalu menambahkan task. Plugin engineering berarti:

1. mendesain build logic sebagai produk internal;
2. memodelkan konfigurasi sebagai DSL yang stabil;
3. membuat task yang deklaratif, incremental, cacheable, dan testable;
4. menghindari eager configuration;
5. memisahkan configuration-time dan execution-time;
6. memastikan compatibility dengan configuration cache;
7. mengontrol dependency, policy, quality gate, code generation, packaging, dan publishing secara konsisten lintas project.

Untuk engineer senior/top-tier, Gradle bukan sekadar “tool untuk build Java”. Gradle adalah programmable build platform.

---

## 1. Mental Model Utama: Plugin Adalah Boundary, Bukan Tempat Menumpuk Script

Plugin adalah unit reusable build behavior.

Sebuah plugin sebaiknya menjawab pertanyaan:

> “Perilaku build apa yang ingin saya standardisasi, validasi, dan reuse lintas project?”

Contoh perilaku yang cocok menjadi plugin:

- semua service Java harus memakai Java toolchain tertentu;
- semua module harus memakai dependency policy tertentu;
- semua test harus memakai JUnit Platform dan konfigurasi report yang sama;
- semua library harus publish source jar dan javadoc jar;
- semua module harus menjalankan Checkstyle/SpotBugs/ArchUnit;
- semua generated OpenAPI client harus masuk source set tertentu;
- semua service harus membuat SBOM;
- semua artifact harus diberi manifest dan metadata release;
- semua module harus menolak dependency SNAPSHOT di release build;
- semua project harus punya task audit internal.

Yang tidak cocok menjadi plugin:

- logic sangat spesifik satu project;
- temporary workaround yang akan dihapus minggu depan;
- command procedural yang lebih cocok sebagai script CI;
- logic yang membutuhkan rahasia production di build time;
- behavior yang tidak bisa diuji atau tidak punya invariant jelas.

### 1.1 Build Script vs Convention Plugin vs Binary Plugin

Ada beberapa level abstraksi:

| Level | Bentuk | Cocok Untuk | Risiko |
|---|---|---|---|
| Build script | `build.gradle.kts` per project | konfigurasi lokal kecil | duplikasi, drift |
| `buildSrc` | source code build logic lokal | reuse dalam satu repository | bisa memperlambat build, coupling tinggi |
| Included build `build-logic` | composite build untuk convention plugin | build logic modular dalam repo | perlu disiplin versioning internal |
| Precompiled script plugin | `.gradle.kts` sebagai plugin | convention sederhana | kurang fleksibel untuk logic kompleks |
| Binary plugin | Kotlin/Java/Groovy class `Plugin<Project>` | logic kompleks, reusable, testable, publishable | butuh desain API |

Rule of thumb:

- Kalau logic hanya 3–5 baris dan tidak diulang, biarkan di build script.
- Kalau logic diulang di banyak module dalam satu repo, pindahkan ke convention plugin.
- Kalau logic butuh conditional, task custom, extension model, testing, atau dipakai lintas repo, buat binary plugin.

---

## 2. Arsitektur Plugin Gradle

Gradle plugin minimal berisi class yang mengimplementasikan `Plugin<T>`.

Biasanya `T` adalah `Project`.

```kotlin
import org.gradle.api.Plugin
import org.gradle.api.Project

class EnterpriseJavaPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        project.pluginManager.apply("java-library")

        project.repositories.mavenCentral()

        project.tasks.withType(org.gradle.api.tasks.testing.Test::class.java).configureEach {
            useJUnitPlatform()
        }
    }
}
```

Mental model-nya:

```text
Plugin applied
   ↓
Register extension / configure conventions / register tasks
   ↓
User build script may override values
   ↓
Gradle builds task graph for requested tasks
   ↓
Tasks execute using finalized inputs
```

Plugin yang sehat tidak langsung “melakukan kerja berat” saat `apply`.

Plugin yang sehat hanya mendeklarasikan:

- task apa yang tersedia;
- property apa yang bisa dikonfigurasi;
- default convention apa yang berlaku;
- dependency antara task;
- input/output task;
- policy validation apa yang perlu jalan.

---

## 3. Project Setup untuk Plugin Development

Struktur yang direkomendasikan untuk repository besar:

```text
root/
  settings.gradle.kts
  build.gradle.kts
  build-logic/
    settings.gradle.kts
    build.gradle.kts
    src/main/kotlin/
      com/company/build/EnterpriseJavaPlugin.kt
      com/company/build/EnterpriseServicePlugin.kt
      com/company/build/tasks/GenerateBuildManifestTask.kt
    src/test/kotlin/
      com/company/build/EnterpriseJavaPluginTest.kt
    src/functionalTest/kotlin/
      com/company/build/EnterpriseJavaPluginFunctionalTest.kt
  service-a/
    build.gradle.kts
  service-b/
    build.gradle.kts
```

Root `settings.gradle.kts`:

```kotlin
pluginManagement {
    includeBuild("build-logic")
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

rootProject.name = "enterprise-platform"
include("service-a", "service-b")
```

`build-logic/build.gradle.kts`:

```kotlin
plugins {
    `kotlin-dsl`
    `java-gradle-plugin`
}

gradlePlugin {
    plugins {
        register("enterpriseJava") {
            id = "com.company.enterprise-java"
            implementationClass = "com.company.build.EnterpriseJavaPlugin"
        }
    }
}

repositories {
    gradlePluginPortal()
    mavenCentral()
}

dependencies {
    testImplementation(kotlin("test"))
}
```

Consumer module:

```kotlin
plugins {
    id("com.company.enterprise-java")
}
```

Ini membuat build logic reusable tanpa menyalin konfigurasi ke setiap module.

---

## 4. Extension DSL: Cara Membuat Kontrak Konfigurasi

Plugin yang baik biasanya menyediakan extension.

Extension adalah object konfigurasi yang bisa diisi user di build script.

Contoh target DSL:

```kotlin
enterpriseJava {
    javaRelease.set(21)
    failOnSnapshot.set(true)
    enableArchitectureChecks.set(true)
    generatedSourceDir.set(layout.buildDirectory.dir("generated/openapi/src/main/java"))
}
```

### 4.1 Extension Class dengan Property API

```kotlin
import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.Property
import org.gradle.api.file.DirectoryProperty
import javax.inject.Inject

abstract class EnterpriseJavaExtension @Inject constructor(objects: ObjectFactory) {
    val javaRelease: Property<Int> = objects.property(Int::class.java).convention(21)
    val failOnSnapshot: Property<Boolean> = objects.property(Boolean::class.java).convention(true)
    val enableArchitectureChecks: Property<Boolean> = objects.property(Boolean::class.java).convention(true)
    val generatedSourceDir: DirectoryProperty = objects.directoryProperty()
}
```

Catatan penting:

- gunakan `Property<T>`, bukan field mutable biasa;
- gunakan `convention(...)` untuk default;
- gunakan `set(...)` untuk override eksplisit;
- jangan panggil `.get()` terlalu cepat saat configuration phase kecuali memang perlu;
- gunakan Provider API untuk menghubungkan output task ke input task.

### 4.2 Mendaftarkan Extension

```kotlin
class EnterpriseJavaPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val extension = project.extensions.create(
            "enterpriseJava",
            EnterpriseJavaExtension::class.java
        )

        project.pluginManager.apply("java-library")

        project.extensions.configure(org.gradle.api.plugins.JavaPluginExtension::class.java) {
            toolchain.languageVersion.set(
                extension.javaRelease.map { JavaLanguageVersion.of(it) }
            )
        }
    }
}
```

Di sini `extension.javaRelease.map { ... }` membuat konfigurasi lazy. Nilainya bisa diubah user sebelum task berjalan.

---

## 5. Provider API: Fondasi Lazy Configuration

Provider API adalah salah satu konsep terpenting Gradle modern.

Masalah umum build script lama:

```kotlin
val output = file("$buildDir/generated")
tasks.create("generate") {
    doLast {
        output.mkdirs()
    }
}
```

Masalahnya:

- `buildDir` dihitung eager;
- task dibuat walaupun tidak dipakai;
- output tidak dideklarasikan dengan benar;
- task tidak incremental/cacheable;
- sulit compatible dengan configuration cache.

Versi modern:

```kotlin
tasks.register<GenerateManifestTask>("generateBuildManifest") {
    outputFile.set(layout.buildDirectory.file("generated/manifest/build-manifest.properties"))
    applicationName.set(project.name)
}
```

Provider API memisahkan “nilai yang akan tersedia nanti” dari “nilai sekarang”.

Contoh tipe penting:

| Tipe | Fungsi |
|---|---|
| `Provider<T>` | nilai lazy read-only |
| `Property<T>` | nilai lazy mutable/configurable |
| `ListProperty<T>` | list lazy |
| `SetProperty<T>` | set lazy |
| `MapProperty<K,V>` | map lazy |
| `RegularFileProperty` | file lazy |
| `DirectoryProperty` | directory lazy |
| `ConfigurableFileCollection` | kumpulan file configurable |
| `FileSystemLocationProperty<T>` | basis property lokasi file |

### 5.1 `map` dan `flatMap`

`map` dipakai untuk transformasi nilai.

```kotlin
val release: Provider<Int> = extension.javaRelease
val releaseName: Provider<String> = release.map { "java-$it" }
```

`flatMap` dipakai ketika hasil transformasi juga Provider.

```kotlin
val generatedDir = tasks.named<GenerateSourcesTask>("generateSources")
    .flatMap { it.outputDirectory }
```

### 5.2 Jangan Memanggil `.get()` Terlalu Cepat

Anti-pattern:

```kotlin
val release = extension.javaRelease.get()
println("Release = $release")
```

Jika dilakukan saat `apply`, nilai user mungkin belum selesai dikonfigurasi.

Lebih baik:

```kotlin
tasks.register<SomeTask>("someTask") {
    javaRelease.set(extension.javaRelease)
}
```

Nilai dibaca saat task execution atau saat Gradle perlu menghitung input.

---

## 6. Custom Task: Dari Procedural Command ke Declarative Unit of Work

Custom task adalah unit kerja dalam build graph.

Task yang bagus harus menjawab:

1. Apa input-nya?
2. Apa output-nya?
3. Apakah hasilnya deterministic?
4. Apakah bisa incremental?
5. Apakah bisa cacheable?
6. Apakah aman dijalankan paralel?
7. Apakah compatible dengan configuration cache?

### 6.1 Task Minimal yang Buruk

```kotlin
abstract class BadTask : DefaultTask() {
    @TaskAction
    fun run() {
        val input = project.file("src/main/resources/app.yml")
        val output = project.file("build/generated/out.txt")
        output.writeText(input.readText().uppercase())
    }
}
```

Masalah:

- memakai `project` saat execution;
- input/output tidak dideklarasikan;
- Gradle tidak bisa up-to-date check;
- tidak bisa build cache;
- berisiko gagal configuration cache;
- path hard-coded;
- tidak testable.

### 6.2 Task yang Lebih Benar

```kotlin
import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.api.tasks.CacheableTask

@CacheableTask
abstract class GenerateBuildManifestTask : DefaultTask() {

    @get:Input
    abstract val applicationName: Property<String>

    @get:Input
    abstract val javaRelease: Property<Int>

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val templateFile: RegularFileProperty

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        val template = templateFile.get().asFile.readText()
        val content = template
            .replace("{{applicationName}}", applicationName.get())
            .replace("{{javaRelease}}", javaRelease.get().toString())

        val out = outputFile.get().asFile
        out.parentFile.mkdirs()
        out.writeText(content)
    }
}
```

Perbedaannya besar:

- input/output eksplisit;
- Gradle bisa menentukan task `UP-TO-DATE`;
- Gradle bisa menyimpan/mengambil output dari build cache;
- task lebih mudah dites;
- execution tidak bergantung pada `Project`;
- path sensitivity eksplisit.

---

## 7. Input/Output Annotation: Kontrak Antara Task dan Gradle

Annotation task adalah kontrak dengan Gradle.

| Annotation | Makna |
|---|---|
| `@Input` | nilai scalar memengaruhi output |
| `@InputFile` | satu file input |
| `@InputFiles` | banyak file input |
| `@InputDirectory` | directory input |
| `@OutputFile` | satu file output |
| `@OutputDirectory` | directory output |
| `@Classpath` | input classpath, ignore detail yang tidak relevan |
| `@CompileClasspath` | classpath compile, lebih longgar untuk incremental compile |
| `@Nested` | object input nested |
| `@Internal` | property tidak memengaruhi output |
| `@Optional` | input boleh tidak ada |
| `@PathSensitive` | cara path dihitung sebagai input |
| `@SkipWhenEmpty` | skip task jika input kosong |
| `@Incremental` | enable incremental input changes |

Kesalahan annotation adalah salah satu penyebab terbesar cache salah.

Contoh kesalahan berbahaya:

```kotlin
@get:Internal
abstract val templateFile: RegularFileProperty
```

Kalau template berubah, Gradle tidak tahu output harus digenerate ulang.

Akibatnya build bisa terlihat sukses tetapi artifact salah.

---

## 8. Cacheable Task: Syarat, Risiko, dan Design Rules

`@CacheableTask` bukan dekorasi performa. Itu janji determinisme.

Task cacheable berarti:

> Untuk input yang sama, task menghasilkan output yang sama, tanpa bergantung pada hidden state.

Hidden state yang merusak cache:

- waktu sekarang;
- random value;
- hostname;
- absolute path;
- environment variable yang tidak dideklarasikan sebagai input;
- network response;
- isi database;
- file di luar input declared;
- system property yang tidak dideklarasikan;
- urutan file tidak stabil;
- locale/timezone tidak stabil.

### 8.1 Contoh Task Tidak Cacheable

```kotlin
@TaskAction
fun generate() {
    outputFile.get().asFile.writeText("builtAt=${Instant.now()}")
}
```

Kalau ingin tetap mencatat waktu build, jadikan input eksplisit:

```kotlin
@get:Input
abstract val buildTimestamp: Property<String>
```

Tetapi untuk reproducible build, lebih baik gunakan timestamp release yang dikontrol, bukan waktu saat task berjalan.

### 8.2 Build Cache vs Up-to-Date Check

- Up-to-date check membandingkan input/output task di workspace yang sama.
- Build cache memungkinkan reuse output dari build lain, termasuk CI atau machine lain.

Task yang hanya benar secara lokal belum tentu aman untuk remote cache.

Remote cache butuh determinisme lebih ketat.

---

## 9. Incremental Task: Memproses Perubahan, Bukan Semua Input

Incremental task berguna ketika input banyak dan perubahan kecil.

Contoh:

- generate metadata untuk banyak file schema;
- transform resource;
- lint custom;
- validate module descriptor;
- scan source code;
- generate index.

Task incremental menerima informasi file yang berubah.

Contoh konseptual:

```kotlin
import org.gradle.work.InputChanges

@CacheableTask
abstract class ValidateSchemasTask : DefaultTask() {

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val schemaDir: DirectoryProperty

    @get:OutputDirectory
    abstract val reportDir: DirectoryProperty

    @TaskAction
    fun validate(inputChanges: InputChanges) {
        if (!inputChanges.isIncremental) {
            reportDir.get().asFile.deleteRecursively()
        }

        inputChanges.getFileChanges(schemaDir).forEach { change ->
            when (change.changeType.name) {
                "ADDED", "MODIFIED" -> validateOne(change.file)
                "REMOVED" -> removeReportFor(change.file)
            }
        }
    }

    private fun validateOne(file: File) {
        // validate schema and write report
    }

    private fun removeReportFor(file: File) {
        // remove stale output
    }
}
```

Incremental task lebih sulit daripada cacheable task biasa karena harus menangani:

- full rebuild;
- file added;
- file modified;
- file removed;
- output stale;
- path rename;
- empty input;
- non-incremental fallback.

Jangan buat incremental task kalau jumlah input kecil atau task murah.

---

## 10. Worker API: Parallelisme Terkontrol

Worker API dipakai ketika task perlu memproses banyak unit kerja secara paralel, tetapi tetap dalam kontrol Gradle.

Contoh use case:

- generate banyak client dari banyak OpenAPI spec;
- validate banyak schema;
- transform banyak resource;
- run analyzer custom per module/file;
- package banyak descriptor.

Kenapa tidak langsung `Executors.newFixedThreadPool`?

Karena Gradle sudah punya resource management dan parallelism model. Kalau setiap task membuat thread pool sendiri, CI bisa oversubscribe CPU/memory.

Contoh simplified:

```kotlin
abstract class GenerateClientsTask @Inject constructor(
    private val workerExecutor: WorkerExecutor
) : DefaultTask() {

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val specsDir: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val queue = workerExecutor.noIsolation()

        specsDir.get().asFileTree.matching { include("**/*.yaml") }.files.forEach { spec ->
            queue.submit(GenerateClientWorkAction::class.java) {
                specFile.set(spec)
                outputDirectory.set(outputDir)
            }
        }
    }
}
```

Worker isolation modes secara konseptual:

| Mode | Karakter |
|---|---|
| no isolation | ringan, cepat, shared classloader/process |
| classloader isolation | isolasi classpath, lebih aman untuk tool berbeda |
| process isolation | paling mahal, paling terisolasi |

Gunakan isolasi sesuai risiko tool yang dipanggil.

---

## 11. BuildService: Shared State yang Terkontrol

BuildService adalah cara Gradle untuk menyediakan shared service antar task secara aman.

Use case:

- membatasi akses ke resource eksternal;
- shared HTTP client;
- shared local server untuk integration task;
- shared license server limiter;
- shared report aggregator;
- shared in-memory cache yang lifecycle-nya build-scoped;
- concurrency throttle.

Contoh service untuk membatasi parallel access:

```kotlin
abstract class ExternalApiLimiterService : BuildService<ExternalApiLimiterService.Params>, AutoCloseable {
    interface Params : BuildServiceParameters {
        val maxParallelRequests: Property<Int>
    }

    private val semaphore by lazy {
        java.util.concurrent.Semaphore(parameters.maxParallelRequests.get())
    }

    fun <T> withPermit(action: () -> T): T {
        semaphore.acquire()
        return try {
            action()
        } finally {
            semaphore.release()
        }
    }

    override fun close() {
        // cleanup if needed
    }
}
```

Registration:

```kotlin
val apiLimiter = gradle.sharedServices.registerIfAbsent(
    "externalApiLimiter",
    ExternalApiLimiterService::class.java
) {
    parameters.maxParallelRequests.set(4)
}
```

Task menggunakan service:

```kotlin
abstract class CallExternalApiTask : DefaultTask() {
    @get:Internal
    abstract val limiter: Property<ExternalApiLimiterService>

    @TaskAction
    fun run() {
        limiter.get().withPermit {
            // call external API
        }
    }
}
```

Catatan: kalau task output bergantung pada response external API, response itu harus diperlakukan sebagai input yang dikontrol atau task tidak boleh cacheable.

---

## 12. Configuration Cache Compatibility

Configuration cache menyimpan hasil configuration phase agar build berikutnya tidak perlu mengonfigurasi ulang semua project.

Agar plugin compatible, prinsip utamanya:

1. jangan membaca mutable global state sembarangan saat configuration;
2. jangan menyimpan `Project` dalam task field;
3. jangan memakai `project` di `@TaskAction`;
4. jangan melakukan I/O saat configuration kecuali lewat Provider yang benar;
5. jangan membaca env/system property langsung tanpa mendeklarasikan sebagai Provider/input;
6. jangan membuat task eager;
7. jangan membuat cross-project mutation yang tidak terkontrol;
8. gunakan service injection dan Gradle APIs yang configuration-cache aware.

### 12.1 Anti-Pattern Configuration Cache

```kotlin
abstract class BadTask : DefaultTask() {
    @TaskAction
    fun run() {
        println(project.name)
    }
}
```

Task action memakai `project`. Ini buruk untuk configuration cache.

Lebih baik:

```kotlin
abstract class GoodTask : DefaultTask() {
    @get:Input
    abstract val projectName: Property<String>

    @TaskAction
    fun run() {
        println(projectName.get())
    }
}
```

Registration:

```kotlin
tasks.register<GoodTask>("printProjectName") {
    projectName.set(project.name)
}
```

### 12.2 Environment Variable

Anti-pattern:

```kotlin
val token = System.getenv("API_TOKEN")
```

Lebih baik:

```kotlin
val tokenProvider = providers.environmentVariable("API_TOKEN")
```

Kemudian hubungkan sebagai input task jika memengaruhi output.

---

## 13. Task Registration: `register` vs `create`

Gradle modern mendorong configuration avoidance.

Anti-pattern:

```kotlin
tasks.create("heavyTask") {
    println("configured even when not needed")
}
```

Lebih baik:

```kotlin
tasks.register("heavyTask") {
    println("configured only when task is required")
}
```

Untuk plugin:

```kotlin
val generateManifest = project.tasks.register(
    "generateBuildManifest",
    GenerateBuildManifestTask::class.java
) {
    applicationName.set(project.name)
    javaRelease.set(extension.javaRelease)
    templateFile.set(project.layout.projectDirectory.file("src/build/manifest.template"))
    outputFile.set(project.layout.buildDirectory.file("generated/manifest/build-manifest.properties"))
}
```

Jika task lain butuh output-nya:

```kotlin
project.tasks.named("processResources") {
    dependsOn(generateManifest)
}
```

Atau lebih baik hubungkan output task sebagai source:

```kotlin
project.extensions.configure(JavaPluginExtension::class.java) {
    sourceSets.named("main") {
        resources.srcDir(generateManifest.map { it.outputFile })
    }
}
```

Dependency task bisa terbentuk otomatis jika file output provider digunakan sebagai input.

---

## 14. Mengintegrasikan Plugin dengan Java Plugin

Plugin enterprise Java biasanya apply `java-library` atau minimal `java`.

```kotlin
class EnterpriseJavaPlugin : Plugin<Project> {
    override fun apply(project: Project) = with(project) {
        pluginManager.apply("java-library")

        val extension = extensions.create(
            "enterpriseJava",
            EnterpriseJavaExtension::class.java
        )

        extensions.configure(JavaPluginExtension::class.java) {
            toolchain.languageVersion.set(
                extension.javaRelease.map { JavaLanguageVersion.of(it) }
            )
            withSourcesJar()
            withJavadocJar()
        }

        tasks.withType(Test::class.java).configureEach {
            useJUnitPlatform()
            testLogging {
                events("failed", "skipped")
            }
        }
    }
}
```

Prinsip:

- apply plugin yang menjadi dependency behavior;
- configure extension plugin lain secara lazy;
- jangan override user configuration secara agresif;
- gunakan convention sebagai default, bukan pemaksaan kecuali policy plugin memang tugasnya enforce.

---

## 15. Convention Plugin vs Policy Plugin

Tidak semua plugin punya karakter sama.

### 15.1 Convention Plugin

Convention plugin memberi default yang bisa dioverride.

Contoh:

```kotlin
enterpriseJava {
    javaRelease.convention(21)
}
```

Karakter:

- membantu konsistensi;
- tidak terlalu memaksa;
- cocok untuk developer productivity;
- bagus untuk project heterogen.

### 15.2 Policy Plugin

Policy plugin menolak build jika aturan dilanggar.

Contoh:

```text
Release build must not contain SNAPSHOT dependencies.
All subprojects must use approved repositories.
Java release must be one of 17, 21, 25.
No project may depend on :web from :domain.
```

Karakter:

- menjaga compliance;
- cocok untuk enterprise/governance;
- harus punya error message jelas;
- harus menyediakan escape hatch yang diaudit;
- jangan diam-diam mengubah behavior tanpa memberi tahu.

---

## 16. Membuat Policy Task: Fail on SNAPSHOT Dependencies

Contoh custom task:

```kotlin
@CacheableTask
abstract class ValidateNoSnapshotDependenciesTask : DefaultTask() {

    @get:Input
    abstract val dependencyCoordinates: ListProperty<String>

    @TaskAction
    fun validate() {
        val snapshots = dependencyCoordinates.get().filter { it.endsWith("-SNAPSHOT") }
        if (snapshots.isNotEmpty()) {
            throw GradleException(
                "SNAPSHOT dependencies are not allowed in release builds:\n" +
                    snapshots.joinToString("\n") { " - $it" }
            )
        }
    }
}
```

Namun ada jebakan: dependency resolution bisa mahal dan memicu konfigurasi/resolution terlalu awal. Untuk plugin production, resolusi dependency harus dilakukan pada waktu yang tepat dan hanya untuk configuration yang relevan.

Contoh registration konseptual:

```kotlin
tasks.register<ValidateNoSnapshotDependenciesTask>("validateNoSnapshots") {
    dependencyCoordinates.set(
        providers.provider {
            configurations
                .matching { it.isCanBeResolved }
                .flatMap { configuration ->
                    configuration.resolvedConfiguration.resolvedArtifacts.map { artifact ->
                        "${artifact.moduleVersion.id.group}:${artifact.name}:${artifact.moduleVersion.id.version}"
                    }
                }
        }
    )
}
```

Untuk Gradle modern, dependency resolution API dan artifact views perlu dipilih hati-hati. Jangan resolve semua configuration saat configuration phase.

---

## 17. Membuat Task Code Generation yang Sehat

Target:

```kotlin
enterpriseOpenApi {
    specFile.set(layout.projectDirectory.file("src/main/openapi/api.yaml"))
    packageName.set("com.company.generated.client")
}
```

Task:

```kotlin
@CacheableTask
abstract class GenerateOpenApiClientTask : DefaultTask() {

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val specFile: RegularFileProperty

    @get:Input
    abstract val packageName: Property<String>

    @get:Input
    abstract val generatorVersion: Property<String>

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun generate() {
        val spec = specFile.get().asFile
        val out = outputDirectory.get().asFile
        out.deleteRecursively()
        out.mkdirs()

        // Call generator library or CLI in controlled way.
        // Ensure deterministic output.
    }
}
```

Plugin integration:

```kotlin
val generateClient = tasks.register<GenerateOpenApiClientTask>("generateOpenApiClient") {
    specFile.set(extension.specFile)
    packageName.set(extension.packageName)
    generatorVersion.set(extension.generatorVersion)
    outputDirectory.set(layout.buildDirectory.dir("generated/openapi/src/main/java"))
}

extensions.configure(JavaPluginExtension::class.java) {
    sourceSets.named("main") {
        java.srcDir(generateClient.flatMap { it.outputDirectory })
    }
}
```

Key invariant:

- generated source berada di `build/`, bukan `src/`, jika generate-on-build;
- generator version harus input;
- spec harus input;
- package name/config harus input;
- output harus bersih dari stale files;
- output harus deterministic.

---

## 18. Testing Gradle Plugin

Plugin tanpa test akan menjadi sumber regresi yang sulit didiagnosis.

Ada beberapa layer test.

| Layer | Tujuan |
|---|---|
| Unit test | test class/helper logic biasa |
| Task unit-ish test | test task action dengan temporary files |
| Functional test | menjalankan Gradle build nyata via TestKit |
| Compatibility test | test plugin terhadap beberapa versi Gradle/JDK |
| Fixture test | test berbagai project shape |

### 18.1 TestKit Functional Test

TestKit menjalankan build Gradle sungguhan di temporary project.

Contoh:

```kotlin
import org.gradle.testkit.runner.GradleRunner
import org.gradle.testkit.runner.TaskOutcome
import kotlin.test.Test
import kotlin.test.assertEquals
import java.io.File

class EnterpriseJavaPluginFunctionalTest {

    @Test
    fun `plugin configures test task`() {
        val projectDir = createTempDir()

        File(projectDir, "settings.gradle.kts").writeText("""
            pluginManagement {
                repositories { gradlePluginPortal(); mavenCentral() }
            }
            rootProject.name = "sample"
        """.trimIndent())

        File(projectDir, "build.gradle.kts").writeText("""
            plugins {
                id("com.company.enterprise-java")
            }

            repositories { mavenCentral() }
        """.trimIndent())

        val result = GradleRunner.create()
            .withProjectDir(projectDir)
            .withArguments("tasks", "--stacktrace")
            .withPluginClasspath()
            .build()

        assert(result.output.contains("test"))
    }
}
```

### 18.2 Testing Configuration Cache

Functional test bisa menjalankan build dua kali:

```kotlin
val first = GradleRunner.create()
    .withProjectDir(projectDir)
    .withArguments("build", "--configuration-cache")
    .withPluginClasspath()
    .build()

val second = GradleRunner.create()
    .withProjectDir(projectDir)
    .withArguments("build", "--configuration-cache")
    .withPluginClasspath()
    .build()

assert(second.output.contains("Reusing configuration cache"))
```

Jangan hanya test happy path. Test juga:

- missing required property;
- invalid config;
- no source files;
- multi-module project;
- changed input triggers rerun;
- unchanged input results `UP-TO-DATE` atau `FROM-CACHE`;
- configuration cache reuse;
- different Java toolchain;
- CI-like environment.

---

## 19. Plugin Publishing dan Versioning

Plugin bisa dipakai lewat:

1. included build;
2. internal Maven repository;
3. Gradle Plugin Portal;
4. composite build;
5. version catalog alias.

Untuk enterprise, internal repository sering lebih aman.

Plugin marker artifact memungkinkan syntax:

```kotlin
plugins {
    id("com.company.enterprise-java") version "1.4.0"
}
```

Versioning plugin harus dianggap serius.

Breaking changes termasuk:

- rename extension property;
- mengubah default Java version;
- mengubah task name yang dipakai CI;
- mengubah output path;
- mengubah dependency configurations;
- menghapus task;
- mengubah policy dari warning menjadi fail;
- mengubah plugin dependency version secara agresif.

Rule:

- patch: bug fix tanpa behavior breaking;
- minor: fitur baru kompatibel;
- major: perubahan behavior/API yang perlu migration.

---

## 20. Gradle Plugin API Stability dan Java 8–25

Ketika menulis plugin, bedakan:

1. JDK untuk menjalankan Gradle;
2. JDK untuk compile plugin;
3. JDK target bytecode plugin;
4. JDK yang dipakai consumer project;
5. JDK yang dipakai toolchain Java compile/test consumer.

Plugin binary harus kompatibel dengan Gradle runtime yang ditargetkan.

Jika plugin dikompilasi dengan Java terlalu baru, consumer yang menjalankan Gradle dengan JDK lebih lama bisa gagal dengan:

```text
Unsupported class file major version
```

Untuk plugin internal enterprise, tetapkan policy:

```text
Plugin runtime baseline: JDK 17
Supported Gradle: 8.x/9.x sesuai corporate baseline
Consumer Java toolchains: 8, 11, 17, 21, 25 sesuai project
```

Jangan mencampur baseline plugin dengan baseline application.

Application bisa compile Java 8 memakai toolchain, sementara Gradle/plugin berjalan di JDK 17/21.

---

## 21. Error Message Engineering

Plugin yang baik bukan hanya benar; ia membantu user memperbaiki masalah.

Error buruk:

```text
Execution failed for task ':validate'.
> invalid dependency
```

Error baik:

```text
SNAPSHOT dependencies are not allowed for release builds.

Found:
 - com.company:shared-auth:1.8.0-SNAPSHOT via runtimeClasspath
 - com.company:case-core:2.1.0-SNAPSHOT via compileClasspath

Why this matters:
 Release artifacts must be reproducible and must not depend on mutable SNAPSHOT versions.

How to fix:
 1. Replace SNAPSHOT with a released version.
 2. If this is an emergency exception, set:
      enterprisePolicy.allowSnapshotReason.set("JIRA-123 approved until 2026-07-01")
```

Top-tier build engineering memperlakukan error message sebagai bagian dari developer experience.

---

## 22. Observability untuk Plugin

Plugin harus bisa didiagnosis.

Gunakan logging Gradle:

```kotlin
logger.lifecycle("Generating build manifest for {}", applicationName.get())
logger.info("Template file: {}", templateFile.get().asFile)
logger.debug("Output file: {}", outputFile.get().asFile)
```

Prinsip:

- `lifecycle`: informasi penting yang pantas tampil normal;
- `info`: detail tambahan;
- `debug`: diagnosis mendalam;
- jangan log secret;
- jangan log terlalu banyak per file kecuali debug;
- sertakan task path saat error;
- gunakan report file untuk hasil panjang.

Task policy sebaiknya menghasilkan report:

```text
build/reports/enterprise-policy/dependency-policy.html
build/reports/enterprise-policy/dependency-policy.json
```

CI bisa mengarsipkan report tersebut.

---

## 23. Case Study: Enterprise Java Convention Plugin

Misal organisasi punya 60 module Java, sebagian library, sebagian service.

Masalah sebelum plugin:

- Java version berbeda-beda;
- JUnit configuration tidak konsisten;
- beberapa module lupa source jar;
- dependency repository tersebar;
- annotation processor salah scope;
- beberapa module pakai SNAPSHOT saat release;
- CI lambat karena task eager;
- developer bingung kenapa local build beda dengan CI.

Target plugin:

```kotlin
plugins {
    id("com.company.enterprise-java-library")
}

enterpriseJava {
    javaRelease.set(21)
    strictDependencies.set(true)
    enableCoverage.set(true)
}
```

Behavior:

- apply `java-library`;
- configure Java toolchain;
- configure JUnit Platform;
- configure sources/javadoc jar;
- enforce repository policy;
- configure dependency constraints/platform;
- register dependency validation task;
- register reproducibility checks;
- integrate JaCoCo;
- expose standard report locations;
- support configuration cache.

Plugin skeleton:

```kotlin
class EnterpriseJavaLibraryPlugin : Plugin<Project> {
    override fun apply(project: Project): Unit = with(project) {
        pluginManager.apply("java-library")
        pluginManager.apply("jacoco")

        val ext = extensions.create(
            "enterpriseJava",
            EnterpriseJavaExtension::class.java
        )

        configureJava(ext)
        configureTesting()
        configureArtifacts()
        configurePolicyTasks(ext)
    }

    private fun Project.configureJava(ext: EnterpriseJavaExtension) {
        extensions.configure(JavaPluginExtension::class.java) {
            toolchain.languageVersion.set(ext.javaRelease.map { JavaLanguageVersion.of(it) })
            withSourcesJar()
            withJavadocJar()
        }
    }

    private fun Project.configureTesting() {
        tasks.withType(Test::class.java).configureEach {
            useJUnitPlatform()
            reports.junitXml.required.set(true)
            reports.html.required.set(true)
        }
    }

    private fun Project.configureArtifacts() {
        tasks.withType(Jar::class.java).configureEach {
            isPreserveFileTimestamps = false
            isReproducibleFileOrder = true
        }
    }

    private fun Project.configurePolicyTasks(ext: EnterpriseJavaExtension) {
        val validate = tasks.register("validateEnterprisePolicy") {
            group = "verification"
            description = "Validates enterprise Java build policy."
        }

        tasks.named("check") {
            dependsOn(validate)
        }
    }
}
```

Catatan: contoh ini skeleton. Untuk production, policy validation sebaiknya custom typed task dengan input/output jelas.

---

## 24. Anti-Pattern Gradle Plugin Engineering

### 24.1 Plugin Melakukan Work Saat `apply`

Buruk:

```kotlin
override fun apply(project: Project) {
    File("build/report.txt").writeText("hello")
}
```

Plugin harus mendaftarkan task, bukan menjalankan pekerjaan.

### 24.2 Eager Task Creation

Buruk:

```kotlin
project.tasks.create("generate")
```

Gunakan:

```kotlin
project.tasks.register("generate")
```

### 24.3 Membaca File Saat Configuration

Buruk:

```kotlin
val schema = project.file("schema.yaml").readText()
```

Baca file di task action, dan deklarasikan file sebagai input.

### 24.4 Global Mutable State

Buruk:

```kotlin
object GlobalBuildState {
    val modules = mutableListOf<String>()
}
```

Ini rentan parallel build dan configuration cache.

### 24.5 Silent Override

Buruk:

```kotlin
configurations.all {
    resolutionStrategy.force("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Force global tanpa penjelasan membuat dependency graph sulit dipahami.

Lebih baik gunakan platform/constraints/policy report.

### 24.6 Task Output Tidak Bersih

Jika task generate output directory tetapi tidak menghapus stale file, artifact bisa mengandung file lama.

### 24.7 Secret Dalam Plugin Configuration

Jangan membuat DSL seperti:

```kotlin
enterprisePublish {
    password.set("plain-secret")
}
```

Gunakan provider env/credentials management dan jangan masukkan secret ke cacheable input jika output bisa tersebar ke remote cache.

---

## 25. Troubleshooting Plugin Gradle

### 25.1 Plugin Tidak Teraplikasi

Cek:

```bash
./gradlew plugins
./gradlew tasks --all
```

Possible causes:

- plugin id salah;
- plugin marker artifact tidak tersedia;
- pluginManagement repository salah;
- included build tidak terdaftar;
- versi plugin tidak compatible;
- class file version plugin terlalu baru.

### 25.2 Task Tidak Jalan

Cek:

```bash
./gradlew someTask --dry-run
./gradlew someTask --info
```

Possible causes:

- task tidak masuk dependency graph;
- `onlyIf` false;
- task up-to-date;
- output dianggap masih valid;
- task name/path salah;
- plugin hanya apply pada subproject tertentu.

### 25.3 Task Selalu Jalan

Possible causes:

- output tidak dideklarasikan;
- input berubah setiap run;
- timestamp/random sebagai input;
- file order tidak stabil;
- environment variable berubah;
- task menulis output di luar declared output;
- task menghapus output task lain.

Gunakan:

```bash
./gradlew taskName --info
```

Gradle biasanya memberi alasan kenapa task tidak up-to-date.

### 25.4 Configuration Cache Gagal

Gunakan:

```bash
./gradlew build --configuration-cache
```

Baca report configuration cache. Cari:

- unsupported reference ke `Project`;
- task action memakai Gradle model saat execution;
- non-serializable field;
- access ke file/env tidak terdeklarasi;
- listener/callback lama yang tidak compatible.

### 25.5 Build Cache Salah

Gejala:

- output dari cache tidak sesuai input;
- CI lulus tapi local gagal;
- generated source stale;
- artifact mengandung metadata environment lain.

Tindakan:

```bash
./gradlew clean build --no-build-cache
./gradlew build --rerun-tasks
./gradlew build --info
```

Audit semua input/output annotation.

---

## 26. Design Checklist untuk Custom Task

Sebelum custom task dianggap production-ready, jawab:

```text
Task Identity
[ ] Task name stabil dan jelas.
[ ] Group dan description jelas.
[ ] Task punya satu tanggung jawab utama.

Inputs
[ ] Semua file input diberi annotation.
[ ] Semua scalar input diberi annotation.
[ ] Environment/system property yang memengaruhi output dideklarasikan.
[ ] Path sensitivity tepat.
[ ] Classpath memakai @Classpath/@CompileClasspath jika relevan.

Outputs
[ ] Semua output dideklarasikan.
[ ] Output path berada di build directory kecuali alasan kuat.
[ ] Task membersihkan stale output jika perlu.
[ ] Task tidak menulis ke output task lain.

Determinism
[ ] Tidak bergantung pada waktu sekarang kecuali input eksplisit.
[ ] Tidak bergantung pada random/hostname/user home tanpa input eksplisit.
[ ] File ordering stabil.
[ ] Locale/timezone dipertimbangkan.

Performance
[ ] Task lazy registered.
[ ] Task incremental jika workload besar dan cocok.
[ ] Task cacheable jika deterministic.
[ ] Worker API dipakai jika parallel workload berat.

Configuration Cache
[ ] Tidak memakai Project di task action.
[ ] Tidak menyimpan model Gradle mutable dalam task field.
[ ] Menggunakan Provider API.
[ ] Functional test menjalankan --configuration-cache dua kali.

Security
[ ] Secret tidak dilog.
[ ] Secret tidak masuk remote cache output.
[ ] Network access dikontrol.
[ ] Dependency/tool version eksplisit.

Developer Experience
[ ] Error message actionable.
[ ] Report tersedia jika validasi kompleks.
[ ] Documentation DSL tersedia.
```

---

## 27. Design Checklist untuk Plugin

```text
Plugin Boundary
[ ] Plugin punya tujuan jelas: convention, policy, codegen, packaging, publishing, atau observability.
[ ] Plugin tidak menjadi tempat semua hal acak.
[ ] Public DSL stabil.
[ ] Default memakai convention, bukan hard override, kecuali policy.

Lazy Configuration
[ ] Task memakai register/named/configureEach.
[ ] Tidak ada eager resolution dependency.
[ ] Tidak ada I/O berat saat apply.
[ ] Provider API dipakai untuk property.

Integration
[ ] Plugin apply plugin dependency yang dibutuhkan.
[ ] Plugin tidak bergantung pada urutan apply yang rapuh.
[ ] Plugin memakai pluginManager.withPlugin jika perlu menunggu plugin lain.

Testing
[ ] Unit test helper logic.
[ ] Functional test TestKit.
[ ] Test multi-module fixture.
[ ] Test invalid configuration.
[ ] Test Gradle/JDK compatibility.
[ ] Test configuration cache.

Publishing
[ ] Plugin id stabil.
[ ] Versioning jelas.
[ ] Changelog tersedia.
[ ] Migration note untuk breaking change.
[ ] Internal repository/plugin portal strategy jelas.

Governance
[ ] Error policy punya escape hatch yang diaudit.
[ ] Report machine-readable jika dipakai CI.
[ ] Tidak ada hidden mutation yang menyulitkan user.
```

---

## 28. Kapan Tidak Membuat Gradle Plugin

Jangan membuat plugin jika:

- problem hanya terjadi di satu module;
- logic belum stabil;
- organisasi belum sepakat standard-nya;
- rule masih sering berubah harian;
- behavior lebih cocok di CI pipeline;
- build logic membutuhkan akses runtime production;
- task tidak bisa dijelaskan input/output-nya;
- kamu belum bisa menulis test untuk plugin tersebut.

Plugin yang buruk lebih berbahaya daripada duplikasi kecil karena plugin buruk menyebarkan kesalahan ke banyak project.

---

## 29. Maven vs Gradle Plugin Engineering: Perbedaan Cara Berpikir

| Aspek | Maven Plugin | Gradle Plugin |
|---|---|---|
| Model utama | lifecycle phase/goal | task graph/configuration model |
| Unit kerja | Mojo | Task/WorkAction |
| Konfigurasi | XML POM parameters | DSL extension/property API |
| Eksekusi | bound to lifecycle phase | selected task graph |
| Laziness | lebih terbatas | sangat penting |
| Incremental/cache | bukan default model utama | first-class concern |
| Multi-module | reactor | multi-project/composite graph |
| Policy | enforcer/custom plugin | convention/policy plugin/task |
| Risiko | lifecycle binding salah | configuration cache/lazy config salah |

Maven plugin cenderung menempel pada lifecycle standar. Gradle plugin cenderung mendesain model konfigurasi dan task graph.

---

## 30. Mini Blueprint: Build Logic untuk Top-Tier Enterprise Java

Struktur plugin internal ideal:

```text
com.company.java-base
  - Java toolchain
  - repositories policy
  - compiler warnings
  - source/javadoc jar

com.company.java-library
  - applies java-library
  - API/implementation conventions
  - publishing metadata

com.company.java-service
  - application/service packaging
  - integration test suite
  - container image conventions

com.company.quality
  - Checkstyle/SpotBugs/ErrorProne/ArchUnit
  - JaCoCo
  - reports

com.company.security
  - dependency vulnerability scanning
  - SBOM
  - no SNAPSHOT on release
  - allowed repositories

com.company.codegen.openapi
  - OpenAPI generation
  - generated source sets
  - deterministic output

com.company.release
  - version metadata
  - reproducible archive
  - publishing/signing
```

Consumer project menjadi sederhana:

```kotlin
plugins {
    id("com.company.java-service")
    id("com.company.quality")
    id("com.company.security")
}

enterpriseJava {
    javaRelease.set(21)
}
```

Semakin senior build engineering-nya, semakin sedikit build script consumer yang perlu tahu detail mekanisme internal.

---

## 31. Ringkasan Mental Model

Gradle advanced plugin engineering bisa diringkas seperti ini:

```text
Build script duplication
   ↓ extract repeated conventions
Convention plugin
   ↓ add explicit DSL
Extension model
   ↓ add work unit
Custom task
   ↓ declare inputs/outputs
Incremental/cacheable task
   ↓ isolate heavy parallel work
Worker API / BuildService
   ↓ prove correctness
TestKit + configuration cache tests
   ↓ publish and govern
Internal build platform
```

Kunci utamanya bukan “bisa membuat plugin”.

Kunci utamanya adalah bisa membuat build behavior yang:

- reusable;
- lazy;
- deterministic;
- observable;
- testable;
- cacheable jika layak;
- configuration-cache compatible;
- aman untuk CI dan enterprise governance;
- mudah dipahami oleh developer lain.

---

## 32. Latihan Praktis

### Latihan 1 — Convention Plugin Java

Buat plugin `com.example.java-conventions` yang:

- apply `java-library`;
- set Java toolchain ke 21;
- enable JUnit Platform;
- enable sources/javadoc jar;
- configure reproducible JAR.

Kriteria sukses:

```bash
./gradlew test
./gradlew jar
./gradlew tasks
```

### Latihan 2 — Custom Task Cacheable

Buat task `GenerateBuildInfoTask` yang menghasilkan:

```properties
application.name=...
application.version=...
java.release=...
```

Syarat:

- semua input dideklarasikan;
- output file dideklarasikan;
- task `UP-TO-DATE` saat input tidak berubah;
- task rerun saat version berubah.

### Latihan 3 — Functional Test dengan TestKit

Buat functional test yang:

- membuat project temporary;
- apply plugin;
- menjalankan `build`;
- assert task outcome;
- menjalankan build kedua dengan `--configuration-cache`;
- assert configuration cache reused.

### Latihan 4 — Policy Plugin

Buat task `validateNoSnapshotDependencies`.

Syarat:

- jalan hanya saat release build;
- memberi error message actionable;
- menghasilkan report JSON;
- tidak resolve dependency saat configuration phase.

### Latihan 5 — Codegen Plugin

Buat plugin sederhana yang:

- membaca `src/main/schema/*.json`;
- generate Java source ke `build/generated/schema/src/main/java`;
- menambahkan output ke source set `main`;
- incremental terhadap perubahan schema;
- menghapus stale output.

---

## 33. Referensi Resmi yang Relevan

- Gradle User Manual — Writing Plugins
- Gradle User Manual — Custom Tasks
- Gradle User Manual — Lazy Configuration / Provider API
- Gradle User Manual — Task Configuration Avoidance
- Gradle User Manual — Incremental Build
- Gradle User Manual — Build Cache
- Gradle User Manual — Configuration Cache
- Gradle User Manual — Worker API
- Gradle User Manual — Shared Build Services
- Gradle User Manual — TestKit / Testing Gradle Plugins
- Gradle Kotlin DSL Reference

---

## 34. Penutup Part 16

Pada Part 16 ini, kita naik dari “menggunakan Gradle” menjadi “mendesain Gradle sebagai build platform”.

Yang harus dibawa ke part berikutnya:

1. plugin adalah boundary build behavior;
2. extension adalah public DSL/contract;
3. task adalah unit kerja deklaratif;
4. input/output annotation adalah dasar correctness;
5. Provider API adalah dasar laziness;
6. cacheable task adalah janji determinisme;
7. Worker API dan BuildService adalah alat untuk workload besar;
8. TestKit adalah cara membuktikan plugin bekerja di real build;
9. configuration cache compatibility harus dianggap requirement modern, bukan bonus.

Part berikutnya akan masuk ke **Performance Engineering**: build time, configuration cache, daemon, parallelism, incrementality, build cache, profiling, dan cara berpikir seperti engineer yang mampu memangkas build enterprise dari puluhan menit menjadi beberapa menit tanpa mengorbankan correctness.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 15 — Maven Advanced Plugin Engineering: Custom Mojo, Parameter Injection, Lifecycle Binding](./15-maven-advanced-plugin-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 17 — Performance Engineering: Build Time, Configuration Cache, Daemon, Parallelism, Incrementality](./17-performance-engineering.md)
