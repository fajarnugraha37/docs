# Part 29 — Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `29-advanced-gradle-variant-aware-dependency-management.md`  
> Fokus: memahami Gradle sebagai dependency resolution engine yang tidak hanya memilih `group:name:version`, tetapi memilih **variant** yang paling sesuai dengan kebutuhan consumer.

---

## 0. Kenapa Bagian Ini Penting?

Di Maven, dependency umumnya dipikirkan sebagai koordinat:

```text
groupId:artifactId:version[:classifier]
```

Lalu Maven memilih artifact berdasarkan scope, transitive dependency, dependency management, nearest-wins conflict mediation, dan classifier jika disebutkan secara eksplisit.

Gradle bisa melakukan itu juga. Tetapi Gradle modern memiliki model yang jauh lebih kaya:

```text
consumer need
  -> configuration
  -> requested attributes
  -> compatible producer variants
  -> disambiguation
  -> selected artifact(s)
```

Artinya, dependency bukan hanya “library X versi Y”. Dependency dapat berarti:

- butuh API classes;
- butuh runtime classes;
- butuh artifact untuk Java 8;
- butuh artifact untuk Java 17;
- butuh source/generated schema artifact;
- butuh shaded artifact;
- butuh instrumentation variant;
- butuh feature optional tertentu;
- butuh platform/BOM-like constraint;
- butuh capability tertentu, misalnya “SLF4J binding provider”.

Inilah salah satu area yang membedakan engineer Gradle biasa dengan engineer yang benar-benar memahami build graph. Banyak error Gradle advanced terlihat “misterius” karena sebenarnya bukan error dependency biasa, tetapi error **variant matching**.

---

## 1. Mental Model Utama

### 1.1 Maven Memilih Artifact, Gradle Memilih Variant

Maven melihat dependency sebagai artifact coordinate dan metadata POM.

Gradle melihat dependency sebagai **component** yang dapat memiliki beberapa **variant**.

Contoh konseptual:

```text
Component: com.company:payment-client:1.4.0

Variants:
  - apiElements
      usage            = java-api
      category         = library
      libraryElements  = jar
      jvmVersion       = 8
      artifact         = payment-client-1.4.0.jar

  - runtimeElements
      usage            = java-runtime
      category         = library
      libraryElements  = jar
      jvmVersion       = 8
      artifact         = payment-client-1.4.0.jar

  - sourcesElements
      category         = documentation
      docsType         = sources
      artifact         = payment-client-1.4.0-sources.jar

  - javadocElements
      category         = documentation
      docsType         = javadoc
      artifact         = payment-client-1.4.0-javadoc.jar
```

Consumer tidak hanya berkata “saya mau `payment-client`”. Consumer implicit/explicit berkata:

```text
Saya butuh Java runtime library, berbentuk jar, kompatibel dengan target JVM saya.
```

Gradle lalu memilih variant yang cocok.

---

## 2. Istilah Inti

### 2.1 Component

Component adalah unit dependency yang dipublikasikan atau diproduksi oleh project.

Contoh:

```text
org.example:core:1.0.0
```

Component dapat memiliki banyak variant.

---

### 2.2 Variant

Variant adalah “wajah” atau “bentuk” dari component untuk kebutuhan tertentu.

Contoh variant dalam Java library Gradle:

```text
apiElements
runtimeElements
sourcesElements
javadocElements
```

Dalam Android, variant bisa lebih kompleks:

```text
debug
release
freeDebug
paidRelease
```

Dalam library enterprise custom, variant bisa seperti:

```text
oracleRuntimeElements
postgresRuntimeElements
java8RuntimeElements
java17RuntimeElements
instrumentedRuntimeElements
```

---

### 2.3 Attribute

Attribute adalah metadata key-value yang menjelaskan variant.

Contoh umum:

```text
org.gradle.usage              = java-api | java-runtime
org.gradle.category           = library | platform | documentation
org.gradle.libraryelements    = jar | classes
org.gradle.dependency.bundling = external | embedded | shadowed
org.gradle.jvm.version        = 8 | 11 | 17 | 21
```

Attribute adalah bahasa negosiasi antara consumer dan producer.

---

### 2.4 Configuration

Configuration di Gradle adalah named bucket untuk dependency, artifact, dan resolution behavior.

Contoh consumer configurations:

```text
compileClasspath
runtimeClasspath
testCompileClasspath
testRuntimeClasspath
annotationProcessor
```

Contoh producer configurations:

```text
apiElements
runtimeElements
```

Konfigurasi consumer membawa attribute yang meminta jenis dependency tertentu. Konfigurasi producer membawa attribute yang mendeskripsikan apa yang ditawarkan.

---

### 2.5 Capability

Capability menyatakan bahwa component/variant menyediakan kemampuan tertentu.

Contoh:

```text
org.slf4j:slf4j-binding
```

Jika dua dependency sama-sama menyediakan capability yang sama, Gradle dapat mendeteksi conflict.

Ini sangat berguna untuk kasus:

- multiple logging binding;
- mutually exclusive implementations;
- library lama dan library baru yang menyediakan API sama;
- alternative runtime provider;
- migration `javax` ke `jakarta` dalam boundary tertentu;
- shaded vs non-shaded artifact.

---

### 2.6 Gradle Module Metadata

Maven POM tidak cukup kaya untuk menyimpan semua informasi variant Gradle. Karena itu Gradle memiliki **Gradle Module Metadata** (`.module`) yang dapat menyimpan variant, attributes, capabilities, dependency constraints, dan metadata kaya lainnya.

Jika library hanya dipublikasikan dengan POM, Gradle tetap bisa mengonsumsi, tetapi informasi variant yang tersedia lebih terbatas.

---

## 3. Cara Gradle Melakukan Variant Selection

Secara konseptual:

```text
1. Consumer configuration memiliki requested attributes.
2. Producer component memiliki satu atau lebih variants.
3. Gradle menyaring variants yang compatible.
4. Jika lebih dari satu cocok, Gradle melakukan disambiguation.
5. Jika tidak ada yang cocok, resolution gagal.
6. Jika ada conflict capability, resolution gagal atau butuh rule.
7. Artifact dari selected variant dipakai dalam classpath/task.
```

Contoh:

```text
Consumer: runtimeClasspath
Attributes:
  usage = java-runtime
  category = library
  libraryElements = jar
  jvmVersion = 17

Producer variants:
  apiElements:
    usage = java-api
    jvmVersion = 8

  runtimeElements:
    usage = java-runtime
    jvmVersion = 8

Selected:
  runtimeElements
```

Kenapa Java 8 variant bisa dipilih untuk consumer Java 17? Karena bytecode Java 8 compatible dijalankan di Java 17.

Sebaliknya, Java 17 variant tidak boleh dipilih untuk consumer yang menargetkan Java 8.

---

## 4. Kenapa Ini Ada?

Variant-aware dependency management memecahkan masalah yang sulit dimodelkan Maven secara natural.

### 4.1 API vs Runtime Separation

Gradle `java-library` memisahkan:

```kotlin
dependencies {
    api("org.example:public-api:1.0.0")
    implementation("org.example:internal-helper:1.0.0")
}
```

Maknanya:

- dependency `api` bocor ke compile classpath consumer;
- dependency `implementation` tidak bocor ke compile classpath consumer, tetapi tersedia saat runtime.

Ini bukan sekadar optimization. Ini adalah encapsulation boundary.

---

### 4.2 Multiple Runtime Targets

Satu component dapat menyediakan variant berbeda untuk runtime berbeda.

Contoh:

```text
payment-driver
  - runtimeElements for JVM 8
  - runtimeElements for JVM 17
  - runtimeElements for native image metadata
```

Consumer memilih yang cocok berdasarkan attributes.

---

### 4.3 Optional Feature yang Lebih Aman

Maven optional dependency sering ambigu. Gradle feature variants bisa membuat optional feature menjadi dependency yang eksplisit.

Contoh library:

```text
reporting-core
reporting-pdf feature
reporting-excel feature
```

Consumer dapat memilih:

```kotlin
dependencies {
    implementation("com.company:reporting:1.0.0")
    implementation("com.company:reporting:1.0.0") {
        capabilities {
            requireCapability("com.company:reporting-pdf")
        }
    }
}
```

Namun ini advanced. Jangan dipakai hanya untuk terlihat canggih.

---

### 4.4 Mutually Exclusive Implementations

Misalnya sistem hanya boleh memakai satu JSON binding:

```text
json-provider-jackson
json-provider-gson
json-provider-jsonb
```

Ketiganya bisa menyatakan capability:

```text
com.company:json-provider
```

Jika dua masuk bersamaan, Gradle bisa mendeteksi conflict.

---

## 5. Java Library Plugin: Fondasi Variant JVM

Gradle `java-library` plugin membuat separation antara API dan implementation.

```kotlin
plugins {
    `java-library`
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-annotations:2.17.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.0")
}
```

### 5.1 Efek `api`

Dependency masuk ke:

- compile classpath module saat ini;
- runtime classpath module saat ini;
- compile classpath consumer;
- runtime classpath consumer.

Gunakan untuk tipe yang muncul di public API.

Contoh:

```java
public interface UserSerializer {
    JsonNode serialize(User user);
}
```

Karena `JsonNode` dari Jackson muncul di public signature, dependency Jackson tersebut adalah API dependency.

---

### 5.2 Efek `implementation`

Dependency masuk ke:

- compile classpath module saat ini;
- runtime classpath module saat ini;
- runtime classpath consumer;
- tidak masuk compile classpath consumer.

Gunakan untuk detail internal.

Contoh:

```java
public interface UserSerializer {
    String serialize(User user);
}

final class JacksonUserSerializer implements UserSerializer {
    private final ObjectMapper mapper = new ObjectMapper();
}
```

`ObjectMapper` tidak muncul di public API. Maka Jackson databind bisa menjadi `implementation`.

---

## 6. Attribute Matching Lebih Detail

Attribute matching memiliki dua konsep besar:

```text
compatibility
  -> apakah producer variant boleh dipakai consumer?

disambiguation
  -> jika banyak variant compatible, mana yang dipilih?
```

### 6.1 Compatibility

Contoh Java version:

```text
Consumer target JVM: 17
Producer variant JVM: 8
Result: compatible

Consumer target JVM: 8
Producer variant JVM: 17
Result: not compatible
```

### 6.2 Disambiguation

Jika consumer Java 17 melihat producer punya Java 8 dan Java 11 variant, keduanya compatible. Gradle perlu memilih yang paling tepat.

Biasanya yang dipilih adalah variant compatible tertinggi yang tidak melampaui requirement consumer.

```text
Consumer JVM 17
Available producer variants:
  - JVM 8
  - JVM 11
Selected:
  - JVM 11
```

Namun behavior detail bergantung pada attribute schema dan disambiguation rule.

---

## 7. Melihat Attribute dan Variant di Project Gradle

Untuk project lokal, gunakan:

```bash
./gradlew outgoingVariants
```

Atau untuk configuration tertentu:

```bash
./gradlew outgoingVariants --variant runtimeElements
```

Untuk melihat dependency resolution:

```bash
./gradlew dependencies --configuration runtimeClasspath
```

Untuk melihat kenapa dependency tertentu terpilih:

```bash
./gradlew dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

Untuk Gradle advanced debugging:

```bash
./gradlew build --info
./gradlew build --debug
./gradlew build --scan
```

---

## 8. Capabilities Deep Dive

### 8.1 Problem: Multiple Providers

Misalnya project punya:

```kotlin
dependencies {
    runtimeOnly("ch.qos.logback:logback-classic:1.5.6")
    runtimeOnly("org.apache.logging.log4j:log4j-slf4j2-impl:2.23.1")
}
```

Keduanya menyediakan SLF4J binding/provider. Secara runtime, ini rawan conflict.

Capabilities bisa membuat build gagal lebih awal daripada runtime warning/error.

---

### 8.2 Declaring Capability on Outgoing Variant

Contoh library internal menyediakan implementation untuk storage:

```kotlin
plugins {
    `java-library`
}

group = "com.company.storage"
version = "1.0.0"

java {
    withSourcesJar()
}

configurations {
    named("runtimeElements") {
        outgoing.capability("com.company.storage:storage-provider:$version")
    }
}
```

Jika ada provider lain dengan capability sama, Gradle dapat mendeteksi conflict.

---

### 8.3 Resolving Capability Conflict

Contoh resolution rule:

```kotlin
configurations.all {
    resolutionStrategy.capabilitiesResolution.withCapability(
        "com.company.storage:storage-provider"
    ) {
        select("com.company.storage:storage-postgres:1.0.0")
        because("Postgres is the approved storage provider for this service")
    }
}
```

Gunakan dengan hati-hati. Capability conflict seharusnya membuat engineer sadar bahwa ada dua provider yang saling eksklusif.

---

## 9. Feature Variants

Feature variants memungkinkan satu library mempublikasikan feature tambahan sebagai variant.

Contoh: library `reporting` memiliki core, PDF feature, dan Excel feature.

```kotlin
plugins {
    `java-library`
}

java {
    registerFeature("pdf") {
        usingSourceSet(sourceSets.main.get())
    }
}

dependencies {
    "pdfImplementation"("org.apache.pdfbox:pdfbox:3.0.2")
}
```

Consumer dapat meminta capability feature tersebut.

```kotlin
dependencies {
    implementation("com.company:reporting:1.0.0")

    implementation("com.company:reporting:1.0.0") {
        capabilities {
            requireCapability("com.company:reporting-pdf")
        }
    }
}
```

### 9.1 Kapan Feature Variants Masuk Akal?

Masuk akal jika:

- library punya optional feature besar;
- feature membawa dependency berat;
- tidak semua consumer butuh feature tersebut;
- feature punya dependency runtime berbeda;
- feature harus dipublikasikan sebagai bagian dari satu component identity.

Tidak masuk akal jika:

- hanya ingin menyembunyikan kompleksitas yang lebih cocok jadi module terpisah;
- consumer kebanyakan Maven dan tidak paham Gradle Module Metadata;
- tim belum matang membaca dependency graph;
- fitur sebenarnya punya lifecycle rilis berbeda.

Kadang module eksplisit lebih sederhana:

```text
reporting-core
reporting-pdf
reporting-excel
```

Daripada satu component dengan banyak feature variants.

---

## 10. Custom Attributes

Custom attributes adalah pedang bermata dua. Mereka sangat powerful, tetapi dapat membuat build sulit dipahami jika tidak dikelola.

Contoh kebutuhan:

```text
Consumer ingin memilih database driver adapter berdasarkan database target:
  - oracle
  - postgres
  - mysql
```

Definisikan attribute:

```kotlin
val databaseAttribute = Attribute.of("com.company.database", String::class.java)
```

Producer:

```kotlin
configurations {
    create("oracleRuntimeElements") {
        isCanBeConsumed = true
        isCanBeResolved = false
        attributes {
            attribute(Usage.USAGE_ATTRIBUTE, objects.named(Usage.JAVA_RUNTIME))
            attribute(Category.CATEGORY_ATTRIBUTE, objects.named(Category.LIBRARY))
            attribute(LibraryElements.LIBRARY_ELEMENTS_ATTRIBUTE, objects.named(LibraryElements.JAR))
            attribute(databaseAttribute, "oracle")
        }
        outgoing.artifact(tasks.named("jar"))
    }
}
```

Consumer:

```kotlin
configurations.named("runtimeClasspath") {
    attributes {
        attribute(databaseAttribute, "oracle")
    }
}
```

### 10.1 Masalah Custom Attributes

Custom attribute harus punya:

- nama stabil;
- value yang terbatas;
- compatibility rule jika value tidak sama persis;
- disambiguation rule jika lebih dari satu compatible;
- dokumentasi;
- test fixture;
- governance.

Jika tidak, error akan muncul seperti:

```text
No matching variant of project :driver was found.
The consumer was configured to find a runtime of a library compatible with Java 17,
but no variant matched the requested attributes.
```

---

## 11. Attribute Compatibility and Disambiguation Rules

Jika attribute punya value custom, Gradle tidak selalu tahu mana yang compatible.

Contoh compatibility:

```text
Consumer database = oracle
Producer database = oracle
Compatible.

Consumer database = oracle
Producer database = generic-jdbc
Mungkin compatible jika rule mengizinkan fallback.
```

Compatibility rule konseptual:

```kotlin
abstract class DatabaseCompatibilityRule : AttributeCompatibilityRule<String> {
    override fun execute(details: CompatibilityCheckDetails<String>) {
        val consumer = details.consumerValue
        val producer = details.producerValue

        if (consumer == producer) {
            details.compatible()
        }

        if (consumer != null && producer == "generic-jdbc") {
            details.compatible()
        }
    }
}
```

Disambiguation rule konseptual:

```kotlin
abstract class DatabaseDisambiguationRule : AttributeDisambiguationRule<String> {
    override fun execute(details: MultipleCandidatesDetails<String>) {
        if (details.consumerValue != null && details.candidateValues.contains(details.consumerValue)) {
            details.closestMatch(details.consumerValue)
        } else if (details.candidateValues.contains("generic-jdbc")) {
            details.closestMatch("generic-jdbc")
        }
    }
}
```

Register schema:

```kotlin
dependencies {
    attributesSchema {
        attribute(databaseAttribute) {
            compatibilityRules.add(DatabaseCompatibilityRule::class.java)
            disambiguationRules.add(DatabaseDisambiguationRule::class.java)
        }
    }
}
```

Prinsipnya: jangan membuat custom attribute tanpa rules kecuali matching exact memang cukup.

---

## 12. Component Metadata Rules

Kadang metadata dependency eksternal salah atau kurang lengkap. Component metadata rules memungkinkan kita memperbaiki metadata sebelum dependency resolution.

Contoh kasus:

- dependency lama tidak mendeklarasikan capability;
- dependency metadata salah scope;
- dependency perlu diperlakukan sebagai provider capability tertentu;
- library lama tidak punya variant metadata;
- dependency membawa transitive yang salah.

Contoh menambahkan capability ke dependency eksternal:

```kotlin
dependencies {
    components {
        withModule("ch.qos.logback:logback-classic") {
            allVariants {
                withCapabilities {
                    addCapability("org.slf4j", "slf4j-binding", id.version)
                }
            }
        }

        withModule("org.apache.logging.log4j:log4j-slf4j2-impl") {
            allVariants {
                withCapabilities {
                    addCapability("org.slf4j", "slf4j-binding", id.version)
                }
            }
        }
    }
}
```

Jika keduanya masuk, Gradle dapat melihat capability conflict.

### 12.1 Rule Harus Dipusatkan

Jangan sebar metadata rule di banyak service.

Lebih baik:

```text
build-logic/
  src/main/kotlin/company-dependency-metadata.gradle.kts
```

Atau binary convention plugin:

```text
com.company.dependency-metadata-policy
```

---

## 13. Artifact Transforms

Artifact transform mengubah artifact dari satu bentuk ke bentuk lain saat dependency resolution.

Contoh:

```text
jar -> exploded classes directory
proto schema zip -> generated Java sources
openapi yaml -> generated client source zip
instrumented jar -> coverage-ready jar
```

Artifact transforms berguna saat output transform dapat dicache dan digunakan sebagai bagian resolution graph.

### 13.1 Kapan Artifact Transform Layak?

Layak jika:

- transform pure/deterministic;
- input jelas;
- output jelas;
- transform mahal dan perlu dicache;
- transform terjadi lintas banyak project;
- transform adalah properti artifact, bukan task application-specific.

Tidak layak jika:

- hanya satu task lokal sederhana;
- transform membutuhkan network;
- output tergantung environment yang tidak dideklarasikan;
- tim belum paham attribute model.

---

## 14. Dependency Substitution

Dependency substitution mengganti dependency saat resolution.

Contoh memakai local project sebagai pengganti module eksternal:

```kotlin
configurations.all {
    resolutionStrategy.dependencySubstitution {
        substitute(module("com.company:payment-client"))
            .using(project(":payment-client"))
            .because("Use local project during monorepo development")
    }
}
```

Use case:

- local fork;
- composite build;
- migration dari binary dependency ke project dependency;
- testing patch sebelum release;
- monorepo/polyrepo hybrid.

Risiko:

- CI tidak sama dengan local;
- substitution tersembunyi;
- artifact published berbeda dari yang dites;
- developer lupa mematikan local substitution.

Lebih baik gunakan composite build untuk local development jika memungkinkan.

---

## 15. Rich Versions and Strict Constraints

Advanced dependency resolution sering digabung dengan strict constraints.

```kotlin
dependencies {
    constraints {
        implementation("com.fasterxml.jackson.core:jackson-databind") {
            version {
                strictly("2.17.2")
            }
            because("Align all Jackson modules and avoid known incompatible versions")
        }
    }
}
```

Rich version constraint bisa berupa:

```kotlin
version {
    strictly("1.5.6")
    prefer("1.5.6")
    reject("1.5.3")
}
```

Gunakan `strictly` untuk invariants penting, bukan untuk semua dependency secara membabi-buta.

---

## 16. Publishing Variant-Aware Libraries

Jika library dipakai oleh Gradle consumer, publish Gradle Module Metadata.

```kotlin
plugins {
    `java-library`
    `maven-publish`
}

java {
    withSourcesJar()
    withJavadocJar()
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
        }
    }
}
```

Gradle akan mempublikasikan:

```text
.pom
.module
.jar
-sources.jar
-javadoc.jar
```

POM tetap penting untuk Maven consumers. `.module` penting untuk Gradle consumers yang butuh variant-aware metadata.

### 16.1 Maven Consumer Compatibility

Jangan lupa: Maven tidak memahami Gradle variants secara penuh.

Jika target consumer mayoritas Maven:

- hindari model variant terlalu kompleks;
- publish module terpisah untuk optional features;
- pastikan POM dependencies benar;
- test konsumsi via Maven;
- jangan mengandalkan `.module` untuk informasi kritikal yang Maven wajib pahami.

---

## 17. Java 8–25 dan Variant-Aware Resolution

Java version menjadi attribute penting.

Gradle dapat membawa attribute:

```text
org.gradle.jvm.version
```

Ini membantu memilih artifact yang kompatibel dengan target JVM.

### 17.1 Masalah Umum

Project target Java 8, tetapi dependency variant Java 17 terpilih.

Gejala:

```text
Unsupported class file major version 61
```

Atau saat runtime Java 8:

```text
java.lang.UnsupportedClassVersionError
```

Solusi:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(8))
    }
}
```

Pastikan dependency metadata benar. Jika dependency publish metadata salah, bisa perlu constraint atau downgrade.

---

### 17.2 Multi-Release JAR vs Multi-Variant Artifact

Dua strategi berbeda:

```text
Multi-Release JAR:
  satu artifact jar
  berisi class khusus versi Java di META-INF/versions

Multi-Variant Artifact:
  beberapa variant/artifact
  dipilih saat dependency resolution
```

MR-JAR cocok jika:

- API sama;
- artifact identity tetap satu;
- runtime JVM memilih class yang sesuai.

Multi-variant cocok jika:

- dependency graph berbeda per target;
- artifact berbeda signifikan;
- perlu attribute matching saat build;
- ingin Gradle memilih sebelum runtime.

---

## 18. Case Study 1 — API Leakage karena Salah `implementation`

### Situasi

Module `:user-api`:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Public class:

```java
public class UserResponse {
    public com.fasterxml.jackson.databind.JsonNode metadata;
}
```

Consumer compile gagal:

```text
cannot access JsonNode
class file for com.fasterxml.jackson.databind.JsonNode not found
```

### Root Cause

Jackson muncul di public API, tetapi dideklarasikan sebagai `implementation`, sehingga tidak masuk compile classpath consumer.

### Fix

```kotlin
dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

### Better Design

Jangan bocorkan Jackson jika tidak perlu:

```java
public class UserResponse {
    public Map<String, Object> metadata;
}
```

Lalu Jackson tetap `implementation`.

---

## 19. Case Study 2 — Logging Provider Conflict

### Situasi

```kotlin
dependencies {
    runtimeOnly("ch.qos.logback:logback-classic:1.5.6")
    runtimeOnly("org.apache.logging.log4j:log4j-slf4j2-impl:2.23.1")
}
```

### Gejala

Runtime warning atau behavior logging aneh.

### Build-Level Policy

Tambahkan metadata rules agar provider logging punya capability sama.

```kotlin
dependencies {
    components {
        listOf(
            "ch.qos.logback:logback-classic",
            "org.apache.logging.log4j:log4j-slf4j2-impl"
        ).forEach { moduleName ->
            withModule(moduleName) {
                allVariants {
                    withCapabilities {
                        addCapability("com.company.logging", "slf4j-provider", id.version)
                    }
                }
            }
        }
    }
}
```

Lalu pilih satu secara eksplisit atau biarkan conflict menggagalkan build.

---

## 20. Case Study 3 — Optional Feature Lebih Baik Jadi Module Terpisah

### Situasi

Library `reporting` punya optional PDF, Excel, dan Email.

Pilihan A: feature variants.

```text
com.company:reporting
  capability reporting-pdf
  capability reporting-excel
  capability reporting-email
```

Pilihan B: module terpisah.

```text
com.company:reporting-core
com.company:reporting-pdf
com.company:reporting-excel
com.company:reporting-email
```

### Evaluasi

Feature variants cocok jika semua feature benar-benar satu component dengan lifecycle sama.

Module terpisah lebih baik jika:

- feature punya owner berbeda;
- release cadence berbeda;
- consumer Maven banyak;
- dependency graph perlu jelas;
- tim butuh debugging lebih sederhana.

### Keputusan Praktis

Untuk enterprise Java kebanyakan, module terpisah lebih mudah digovern. Feature variants dipakai untuk build platform/library internal yang memang Gradle-first.

---

## 21. Case Study 4 — Generated Schema Artifact sebagai Variant

Sebuah module `:contract` menghasilkan:

```text
contract.jar          -> Java classes
contract-schemas.zip  -> OpenAPI/JSON schema/proto files
```

Consumer tertentu butuh schema zip untuk codegen.

Pendekatan sederhana:

```text
publish separate artifact classifier: schemas
```

Pendekatan Gradle advanced:

```text
publish documentation/data variant dengan attribute:
  category = documentation atau custom
  artifactType = zip
  contractType = openapi
```

Gunakan variant jika:

- consumer Gradle-first;
- artifact dipilih otomatis berdasarkan attributes;
- transform/cache diperlukan;
- metadata ingin kuat.

Gunakan classifier/module biasa jika:

- Maven compatibility penting;
- consumer sederhana;
- variasi tidak banyak.

---

## 22. Common Error: No Matching Variant

Contoh error:

```text
No matching variant of project :library was found.
The consumer was configured to find a runtime of a library compatible with Java 17,
packaged as a jar, and its dependencies declared externally,
but:
  - Variant 'apiElements' capability com.company:library:1.0 declares an API of a library
  - Variant 'runtimeElements' declares a runtime of a library compatible with Java 21
```

Cara membaca:

```text
Consumer wants:
  runtime
  library
  jar
  Java 17 compatible

Producer offers:
  apiElements -> usage mismatch
  runtimeElements -> Java 21 not compatible with Java 17
```

Fix bisa berupa:

- turunkan target producer ke Java 17;
- naikkan consumer ke Java 21;
- publish Java 17-compatible variant;
- cek toolchain salah;
- cek plugin salah memberi attributes.

---

## 23. Common Error: Ambiguous Variants

Contoh:

```text
Cannot choose between the following variants of project :library:
  - oracleRuntimeElements
  - genericJdbcRuntimeElements
All of them match the consumer attributes.
```

Artinya compatibility terlalu longgar atau consumer kurang spesifik.

Fix:

```kotlin
configurations.named("runtimeClasspath") {
    attributes {
        attribute(databaseAttribute, "oracle")
    }
}
```

Atau buat disambiguation rule.

---

## 24. Advanced Gradle Tidak Selalu Berarti Lebih Baik

Variant-aware resolution powerful, tetapi ada cost:

- lebih sulit dipahami engineer baru;
- error message panjang;
- metadata publishing harus benar;
- Maven compatibility bisa turun;
- debugging butuh skill lebih tinggi;
- custom attributes bisa menjadi coupling tersembunyi;
- CI failure bisa muncul setelah upgrade Gradle.

Gunakan prinsip:

```text
Start explicit.
Introduce variants only when explicit modules/classifiers become insufficient.
Centralize rules.
Document attributes.
Test consumer behavior.
```

---

## 25. Decision Matrix

| Problem | Simple Solution | Advanced Gradle Solution | Recommendation |
|---|---|---|---|
| API vs implementation leakage | `java-library` | Built-in variants | Use `java-library` by default |
| Optional feature | Separate module | Feature variants/capabilities | Prefer separate module unless Gradle-first library |
| Multiple providers | Manual exclusion | Capabilities | Use capabilities for enterprise policy |
| Wrong third-party metadata | Exclusion/constraint | Component metadata rules | Use centralized metadata rules |
| Different Java targets | Separate artifact | JVM attribute variants | Use toolchains + metadata carefully |
| Generated artifact consumption | Classifier/module | Custom variant + artifact transform | Use classifier unless graph automation needed |
| Local fork | Change version | Dependency substitution/composite build | Prefer composite build |
| Artifact transformation | Custom task | Artifact transform | Use transform only if cacheable/reused |

---

## 26. Enterprise Governance Pattern

Buat convention plugin:

```text
build-logic/
  src/main/kotlin/
    com.company.java-library-conventions.gradle.kts
    com.company.dependency-metadata-rules.gradle.kts
    com.company.capability-policy.gradle.kts
    com.company.variant-debugging.gradle.kts
```

Isi policy:

- apply `java-library` untuk library module;
- enforce `api`/`implementation` hygiene;
- define approved capabilities;
- add component metadata rules untuk known problematic libraries;
- define Java toolchain attributes;
- expose diagnostic tasks;
- forbid direct custom attributes outside build logic;
- document all custom attributes.

---

## 27. Review Checklist untuk Variant-Aware Gradle Build

Gunakan checklist ini saat review build advanced:

```text
[ ] Apakah project memakai java-library jika menghasilkan library?
[ ] Apakah dependency public API dideklarasikan sebagai api?
[ ] Apakah dependency internal dideklarasikan sebagai implementation?
[ ] Apakah ada custom configuration yang canBeResolved/canBeConsumed-nya benar?
[ ] Apakah outgoing variants bisa dijelaskan?
[ ] Apakah custom attributes benar-benar diperlukan?
[ ] Apakah custom attributes punya compatibility/disambiguation rules?
[ ] Apakah capabilities digunakan untuk provider yang mutually exclusive?
[ ] Apakah component metadata rules dipusatkan?
[ ] Apakah Gradle Module Metadata dipublish jika variants penting?
[ ] Apakah Maven consumer tetap bisa memakai artifact dengan benar?
[ ] Apakah Java target variant kompatibel dengan baseline consumer?
[ ] Apakah dependency substitution hanya aktif di konteks yang tepat?
[ ] Apakah artifact transforms deterministic dan cacheable?
[ ] Apakah error no matching variant bisa didiagnosis dari command documented?
[ ] Apakah ada integration test yang mengonsumsi published artifact?
```

---

## 28. Diagnostic Commands Cheat Sheet

```bash
# Lihat dependency graph
./gradlew dependencies --configuration runtimeClasspath

# Lihat alasan dependency terpilih
./gradlew dependencyInsight --dependency <name> --configuration runtimeClasspath

# Lihat outgoing variants project
./gradlew outgoingVariants

# Lihat resolvable configurations
./gradlew resolvableConfigurations

# Build dengan info detail
./gradlew build --info

# Build dengan debug detail
./gradlew build --debug

# Build scan jika tersedia
./gradlew build --scan
```

Untuk multi-module:

```bash
./gradlew :module-a:outgoingVariants
./gradlew :module-b:dependencyInsight --dependency module-a --configuration compileClasspath
```

---

## 29. Anti-Patterns

### 29.1 Semua Custom Attribute Ditaruh di Root Build Script

Root build script menjadi pusat magic behavior.

Lebih baik gunakan convention plugin.

---

### 29.2 Menggunakan Feature Variants untuk Menghindari Modularisasi

Jika feature punya domain/lifecycle berbeda, buat module terpisah.

---

### 29.3 Mengandalkan Gradle Metadata untuk Consumer Maven

Maven tidak membaca `.module`. Pastikan POM tetap benar.

---

### 29.4 Capability Conflict Diselesaikan Diam-Diam

Jika dua provider masuk, jangan selalu auto-select tanpa observability. Kadang build harus gagal agar dependency graph diperbaiki.

---

### 29.5 Dependency Substitution Aktif di CI Release

Release harus membangun artifact yang benar-benar dipublikasikan dan akan digunakan.

---

### 29.6 Artifact Transform Tidak Deterministic

Transform yang membaca network, waktu sistem, random UUID, atau absolute path akan merusak cache/reproducibility.

---

## 30. Cara Berpikir Top 1% untuk Gradle Advanced Dependency

Engineer biasa bertanya:

```text
Kenapa dependency ini tidak masuk?
```

Engineer advanced bertanya:

```text
Configuration mana yang resolve?
Attributes apa yang diminta consumer?
Variants apa yang ditawarkan producer?
Capability conflict apa yang terjadi?
Metadata mana yang dipakai: POM atau Gradle Module Metadata?
Apakah Java target compatibility membuat variant ditolak?
Apakah metadata third-party salah?
Apakah solusi terbaik exclusion, constraint, capability, metadata rule, atau module split?
```

Mental modelnya:

```text
Dependency resolution bukan list lookup.
Dependency resolution adalah negotiation antara consumer need dan producer variants.
```

---

## 31. Ringkasan Inti

Gradle advanced dependency management dibangun di atas konsep:

```text
component
variant
attribute
configuration
capability
metadata
resolution rule
artifact transform
```

Yang harus dikuasai:

- `api` vs `implementation` adalah variant-aware API boundary paling umum;
- attributes menentukan variant matching;
- capabilities mendeteksi mutually exclusive provider;
- component metadata rules memperbaiki metadata dependency eksternal;
- feature variants dapat mengganti optional dependency, tetapi tidak selalu lebih baik dari module terpisah;
- Gradle Module Metadata penting untuk publikasi variant-aware;
- custom attributes harus dipusatkan, didokumentasikan, dan diuji;
- jangan memakai advanced Gradle jika struktur module sederhana sudah cukup.

---

## 32. Referensi Resmi

- Gradle User Manual — Variant-Aware Resolution: <https://docs.gradle.org/current/userguide/variant_aware_resolution.html>
- Gradle User Manual — Variants and Attributes: <https://docs.gradle.org/current/userguide/variant_attributes.html>
- Gradle User Manual — Capabilities: <https://docs.gradle.org/current/userguide/component_capabilities.html>
- Gradle User Manual — Component Metadata Rules: <https://docs.gradle.org/current/userguide/component_metadata_rules.html>
- Gradle User Manual — Java Library Plugin: <https://docs.gradle.org/current/userguide/java_library_plugin.html>
- Gradle User Manual — Feature Variants: <https://docs.gradle.org/current/userguide/how_to_create_feature_variants_of_a_library.html>
- Gradle User Manual — Gradle Module Metadata: <https://docs.gradle.org/current/userguide/publishing_gradle_module_metadata.html>
- Gradle User Manual — Resolution Rules: <https://docs.gradle.org/current/userguide/resolution_rules.html>

---

## 33. Status Seri

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25
[x] Part 2  — Maven Core Mental Model
[x] Part 3  — Gradle Core Mental Model
[x] Part 4  — Maven vs Gradle Decision Framework
[x] Part 5  — Project Layout Engineering
[x] Part 6  — Dependency Graph Fundamentals
[x] Part 7  — Dependency Version Management
[x] Part 8  — Repository Engineering
[x] Part 9  — Build Reproducibility
[x] Part 10 — Compiler Engineering
[x] Part 11 — Testing Build Pipeline
[x] Part 12 — Packaging Engineering
[x] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[x] Part 14 — Plugin System Deep Dive
[x] Part 15 — Maven Advanced Plugin Engineering
[x] Part 16 — Gradle Advanced Plugin Engineering
[x] Part 17 — Performance Engineering
[x] Part 18 — CI/CD Build Architecture
[x] Part 19 — Release Engineering
[x] Part 20 — Security Engineering
[x] Part 21 — Enterprise Governance
[x] Part 22 — Multi-Module Architecture for Large Java Systems
[x] Part 23 — Jakarta/Spring/Enterprise Java Build Integration
[x] Part 24 — Code Generation Pipelines
[x] Part 25 — Static Analysis and Quality Gates
[x] Part 26 — Dependency Conflict Case Studies
[x] Part 27 — Migration Engineering
[x] Part 28 — Troubleshooting Build Failures
[x] Part 29 — Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes
[ ] Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions
[ ] Part 31 — Build Observability
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri belum selesai. Bagian berikutnya adalah:

```text
Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./28-troubleshooting-build-failures.md">⬅️ Part 28 — Troubleshooting Build Failures: Systematic Debugging Framework</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./30-advanced-maven-reactor-effective-model-resolver-enforcer-extensions.md">Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions ➡️</a>
</div>
