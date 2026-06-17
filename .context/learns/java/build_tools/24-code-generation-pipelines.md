# Part 24 — Code Generation Pipelines: OpenAPI, JAXB, Protobuf, gRPC, jOOQ, QueryDSL

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `24-code-generation-pipelines.md`  
> Scope: Java 8–25, Maven, Gradle, enterprise build engineering  
> Fokus: bagaimana memperlakukan code generation sebagai bagian dari build graph yang deterministic, maintainable, testable, cacheable, dan aman.

---

## 1. Tujuan Bagian Ini

Di banyak sistem Java enterprise, source code yang dikompilasi bukan hanya code yang ditulis manual oleh developer. Sebagian code berasal dari:

- OpenAPI specification;
- XML Schema / WSDL;
- Protobuf `.proto` files;
- database schema;
- JPA entity model;
- annotation processing;
- DSL metadata;
- IDL atau contract antar service.

Code generation terlihat seperti hal teknis kecil, tetapi di sistem besar ia bisa menjadi sumber masalah serius:

- build tidak reproducible;
- generated code berubah tanpa perubahan source yang jelas;
- CI build gagal karena database/schema/service contract tidak tersedia;
- developer commit generated code yang stale;
- IDE tidak mengenali generated sources;
- dependency graph menjadi kacau;
- compiler error muncul di code yang tidak pernah ditulis manusia;
- version contract antar service tidak jelas;
- build menjadi lambat karena generator selalu jalan ulang;
- generated code memasukkan library runtime yang tidak kompatibel dengan Java baseline.

Target bagian ini adalah membangun mental model bahwa **code generation adalah transformasi build graph**, bukan sekadar command tambahan.

---

## 2. Mental Model Dasar: Code Generation sebagai Transformasi

Secara konseptual, code generation adalah fungsi:

```text
specification/input model + generator version + generator config + environment
    -> generated source/resource
    -> compiled class/artifact
```

Contoh:

```text
openapi.yaml + openapi-generator-cli 7.x + config.json
    -> ApiClient.java, PetApi.java, model/Pet.java
    -> compiled client library
```

```text
schema.sql/live database + jOOQ generator + forcedTypes config
    -> Tables.java, Records.java, DSL accessors
    -> compiled type-safe SQL DSL
```

```text
entity classes + QueryDSL annotation processor
    -> QCustomer.java, QOrder.java
    -> compiled query metamodel
```

```text
proto files + protoc + grpc-java plugin
    -> Message classes, Stub classes
    -> compiled RPC client/server contract
```

Artinya generated code tidak boleh diperlakukan sebagai magic. Ia punya:

- input;
- output;
- dependency;
- version;
- lifecycle;
- ownership;
- failure mode;
- caching strategy;
- reproducibility risk.

Top 1% engineer tidak hanya bertanya “bagaimana generate code”, tetapi:

> “Apa contract input-output-nya, kapan ia harus jalan, siapa yang memiliki spec-nya, bagaimana mendeteksi drift, bagaimana menjamin reproducibility, dan bagaimana build gagal dengan pesan yang jelas bila contract rusak?”

---

## 3. Dua Model Besar: Generate-on-Build vs Commit Generated Code

Sebelum memilih plugin, tentukan strategi ownership.

### 3.1 Generate-on-build

Generated source tidak disimpan di Git. Build selalu menghasilkan code dari spec.

Contoh cocok:

- QueryDSL Q-classes dari entity lokal;
- JPA metamodel;
- Protobuf dari `.proto` yang ada di repo;
- OpenAPI client dari spec yang juga ada di repo;
- JAXB dari XSD lokal;
- jOOQ dari migration-controlled schema snapshot.

Keuntungan:

- tidak ada generated code stale di Git;
- diff lebih bersih;
- source of truth jelas;
- generator version change langsung terlihat;
- mudah membersihkan output.

Risiko:

- build lebih lambat;
- generator harus tersedia di CI;
- IDE setup harus benar;
- output harus deterministic;
- jika input remote, build bisa tidak stabil.

### 3.2 Commit generated code

Generated source disimpan di Git.

Contoh yang kadang masuk akal:

- generated client dari external API yang spec-nya tidak stabil atau tidak bisa diakses saat build;
- generated code mahal dan jarang berubah;
- project consumer tidak ingin membawa generator dependency;
- legacy environment tidak punya tooling generator;
- build air-gapped dengan constraint berat.

Keuntungan:

- build lebih sederhana;
- tidak butuh generator di consumer project;
- perubahan generated code bisa direview langsung;
- tidak tergantung remote spec saat build.

Risiko:

- stale generated code;
- diff sangat besar;
- review noise;
- mudah lupa regenerate;
- konflik merge;
- generator config/version bisa hilang dari trace.

### 3.3 Rule praktis

Gunakan aturan ini:

```text
Jika spec/input berada di repo dan generator deterministic,
prefer generate-on-build.

Jika spec/input eksternal, tidak stabil, atau tidak tersedia di CI,
pertimbangkan commit generated code atau publish generated artifact.

Jika generated code dipakai oleh banyak service,
pertimbangkan publish sebagai library versioned, bukan generate ulang di semua consumer.
```

---

## 4. Lifecycle Code Generation dalam Maven

Maven cocok untuk code generation karena lifecycle-nya eksplisit.

Fase penting:

```text
generate-sources
process-sources
compile

generate-test-sources
process-test-sources
test-compile
```

Untuk source utama, generator biasanya bind ke:

```text
generate-sources
```

Untuk test source:

```text
generate-test-sources
```

Mental model:

```text
validate
  -> verify input spec exists

generate-sources
  -> generate Java source

compile
  -> compile manual + generated source

test
  -> validate generated behavior

package
  -> package compiled output, not generator output as source contract
```

### 4.1 Maven generated source directory

Lokasi umum:

```text
target/generated-sources/<tool>
target/generated-test-sources/<tool>
```

Contoh:

```text
target/generated-sources/openapi
target/generated-sources/jooq
target/generated-sources/protobuf/java
target/generated-sources/annotations
```

Jangan generate ke:

```text
src/main/java
```

kecuali memang sengaja commit generated code. `src/main/java` adalah area source manual.

---

## 5. Lifecycle Code Generation dalam Gradle

Gradle memodelkan code generation sebagai task graph.

Mental model:

```text
GenerateTask
  inputs: spec, config, generator version
  outputs: build/generated/sources/<tool>/main/java

compileJava
  dependsOn GenerateTask
  source includes generated output
```

Lokasi umum:

```text
build/generated/sources/<tool>/main/java
build/generated/sources/<tool>/test/java
```

Contoh:

```text
build/generated/sources/openapi/main/java
build/generated/sources/proto/main/java
build/generated/sources/annotationProcessor/java/main
build/generated/sources/jooq/main/java
```

Kunci Gradle:

- task harus punya input/output jelas;
- task harus lazy-configured;
- generated source harus ditambahkan ke source set;
- compile task harus depend pada generator task;
- generated output jangan masuk `src/main/java`;
- generator task idealnya cacheable dan incremental.

---

## 6. Source of Truth: Spec, Schema, atau Code?

Code generation selalu memaksa keputusan arsitektural:

> Mana yang menjadi sumber kebenaran?

### 6.1 Contract-first

Spec ditulis dulu, code mengikuti.

Contoh:

- OpenAPI YAML sebagai contract API;
- `.proto` sebagai contract RPC;
- XSD/WSDL sebagai contract SOAP/XML;
- database migration sebagai contract schema.

Kelebihan:

- consumer dan provider bisa align lebih awal;
- contract bisa direview secara eksplisit;
- cocok untuk multi-team/multi-service;
- bisa generate client/server stub.

Risiko:

- spec bisa tidak cocok dengan implementasi;
- perlu contract testing;
- developer harus disiplin menjaga spec.

### 6.2 Code-first

Code ditulis dulu, spec/generated output mengikuti.

Contoh:

- Spring controller -> OpenAPI docs via runtime scanner;
- JPA entity -> QueryDSL Q-classes;
- annotation -> generated mapper/metadata.

Kelebihan:

- cepat untuk aplikasi internal;
- source manual adalah real implementation;
- mudah untuk developer.

Risiko:

- contract bisa berubah tanpa sadar;
- consumer terlambat tahu perubahan;
- sulit governance di banyak tim;
- dokumentasi bisa menjadi byproduct yang tidak dirancang.

### 6.3 Database-first

Database schema menjadi sumber kebenaran.

Contoh:

- jOOQ dari schema;
- legacy DB integration;
- reporting/query-heavy system.

Kelebihan:

- type-safe query mengikuti schema real;
- cocok untuk legacy enterprise DB;
- mengurangi runtime SQL typo;
- schema drift cepat kelihatan.

Risiko:

- build bisa tergantung database hidup;
- schema state harus deterministic;
- migration order penting;
- generated code bisa berubah karena metadata DB yang tidak stabil.

---

## 7. OpenAPI Generation

OpenAPI generation sering dipakai untuk:

- client SDK;
- server stub;
- DTO/model;
- API interface;
- documentation;
- validation metadata.

### 7.1 Kapan generate OpenAPI client?

Generate client ketika:

- service lain menyediakan stable OpenAPI spec;
- consumer ingin type-safe API call;
- contract versioning jelas;
- generated client bisa dipublish sebagai artifact;
- perubahan API perlu terdeteksi saat build.

Hindari generate client langsung dari URL remote setiap build:

```text
BAD:
CI build -> download https://service/api-docs -> generate client
```

Karena:

- remote bisa down;
- output berubah tanpa commit;
- build tidak reproducible;
- tidak jelas spec version mana yang dipakai.

Lebih baik:

```text
GOOD:
specs/payment-api-1.4.2.yaml committed/pinned
    -> generate client
```

atau:

```text
GOOD:
payment-client:1.4.2 published artifact
    -> consumer depends on library
```

### 7.2 Maven OpenAPI pattern

Konsep Maven:

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi.generator.version}</version>
  <executions>
    <execution>
      <id>generate-payment-client</id>
      <phase>generate-sources</phase>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/openapi/payment-api.yaml</inputSpec>
        <generatorName>java</generatorName>
        <output>${project.build.directory}/generated-sources/openapi/payment</output>
        <apiPackage>com.example.payment.client.api</apiPackage>
        <modelPackage>com.example.payment.client.model</modelPackage>
        <invokerPackage>com.example.payment.client</invokerPackage>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Catatan engineering:

- pin versi generator;
- pin spec file;
- generate ke `target/generated-sources`;
- jangan generate langsung ke `src/main/java`;
- gunakan package yang stabil;
- review generated dependencies;
- jangan biarkan generated client membawa HTTP stack yang tidak sesuai policy.

### 7.3 Gradle OpenAPI pattern

Konsep Gradle:

```kotlin
plugins {
    id("org.openapi.generator") version "<pinned-version>"
}

val generatePaymentClient by tasks.registering(org.openapitools.generator.gradle.plugin.tasks.GenerateTask::class) {
    generatorName.set("java")
    inputSpec.set(layout.projectDirectory.file("src/main/openapi/payment-api.yaml").asFile.path)
    outputDir.set(layout.buildDirectory.dir("generated/sources/openapi/payment").get().asFile.path)
    apiPackage.set("com.example.payment.client.api")
    modelPackage.set("com.example.payment.client.model")
    invokerPackage.set("com.example.payment.client")
}

sourceSets {
    main {
        java.srcDir(layout.buildDirectory.dir("generated/sources/openapi/payment/src/main/java"))
    }
}

tasks.compileJava {
    dependsOn(generatePaymentClient)
}
```

Hal yang harus dicek:

- apakah output path benar;
- apakah `compileJava` depends on generator;
- apakah generated source masuk IDE;
- apakah task input/output dikenali Gradle;
- apakah config cache aman;
- apakah generator task selalu rerun atau bisa incremental.

### 7.4 OpenAPI anti-pattern

Anti-pattern umum:

```text
1. Generate dari live endpoint di CI.
2. Tidak pin generator version.
3. Spec berubah tanpa versioning.
4. Generated code dicampur dengan manual code.
5. Generated model dipakai sebagai domain model internal.
6. Semua API digenerate ke satu module besar.
7. Tidak ada contract test antara provider dan generated client.
```

Prinsip penting:

> Generated DTO dari OpenAPI adalah boundary model, bukan domain model.

Jangan biarkan model eksternal merembes ke core domain.

---

## 8. Protobuf dan gRPC Generation

Protobuf/gRPC biasanya lebih strict daripada OpenAPI karena `.proto` adalah IDL yang menghasilkan:

- message classes;
- enum classes;
- builders;
- service descriptors;
- blocking/future/async stubs;
- server base classes.

### 8.1 Mental model Protobuf

```text
.proto file
  -> protoc
  -> Java message classes
  -> grpc plugin
  -> service stubs
  -> compileJava
```

Input penting:

- `.proto` files;
- `protoc` version;
- grpc-java plugin version;
- protobuf runtime version;
- package/java_package options;
- source set mapping.

### 8.2 Protobuf version alignment

Risiko besar:

```text
protoc version != protobuf-java runtime version != grpc plugin version
```

Akibat:

- compile error;
- runtime method missing;
- incompatible generated API;
- warning yang diabaikan;
- deserialization issue.

Policy:

```text
Pin protoc version.
Pin grpc plugin version.
Pin protobuf-java runtime version.
Align via BOM/platform bila tersedia.
```

### 8.3 Gradle Protobuf pattern

Dengan plugin Protobuf Gradle, source biasanya:

```text
src/main/proto
src/test/proto
```

Output umum:

```text
build/generated/source/proto/main/java
build/generated/source/proto/main/grpc
```

Konsep:

```kotlin
plugins {
    id("com.google.protobuf") version "<pinned-version>"
    java
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:<pinned-protoc-version>"
    }
    plugins {
        id("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:<pinned-grpc-version>"
        }
    }
    generateProtoTasks {
        all().forEach { task ->
            task.plugins {
                id("grpc")
            }
        }
    }
}
```

Generated output otomatis masuk source set bila plugin dikonfigurasi dengan benar.

### 8.4 Maven Protobuf pattern

Maven biasanya memakai plugin pihak ketiga atau organisasi-specific plugin. Prinsipnya sama:

```xml
<plugin>
  <groupId>...</groupId>
  <artifactId>protobuf-...-plugin</artifactId>
  <version>${protobuf.plugin.version}</version>
  <executions>
    <execution>
      <phase>generate-sources</phase>
      <goals>
        <goal>generate</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <protocArtifact>com.google.protobuf:protoc:${protobuf.version}:exe:${os.detected.classifier}</protocArtifact>
    <pluginArtifact>io.grpc:protoc-gen-grpc-java:${grpc.version}:exe:${os.detected.classifier}</pluginArtifact>
  </configuration>
</plugin>
```

Engineering concern:

- OS classifier untuk `protoc` executable;
- CI Linux vs developer Windows/Mac;
- reproducibility across OS;
- generated source path;
- runtime dependency alignment.

### 8.5 Protobuf schema evolution

Protobuf punya aturan compatibility sendiri.

Prinsip umum:

- jangan reuse field number;
- jangan delete tanpa reserve;
- gunakan `reserved` untuk field lama;
- hati-hati rename enum;
- hindari mengganti type field yang sudah dipakai;
- treat `.proto` sebagai public contract;
- versioning package bila breaking change.

Build pipeline harus bisa menjalankan:

```text
proto lint
breaking change check
generate
test serialization compatibility
```

---

## 9. JAXB dan XML Schema Generation

JAXB/XJC dipakai untuk generate Java classes dari XSD. Di enterprise Java, ini masih banyak muncul pada:

- SOAP integration;
- XML-based government/regulatory exchange;
- legacy enterprise systems;
- file interchange;
- schema-first contracts.

### 9.1 Java version problem

Penting untuk Java 8–25:

- Java 8 masih membawa banyak Java EE/JAXB API di JDK;
- Java 9+ mulai modularisasi;
- Java 11+ tidak lagi menyertakan JAXB di JDK seperti era Java 8;
- modern project perlu dependency JAXB/Jakarta XML Binding eksplisit.

Akibatnya build yang jalan di Java 8 bisa gagal di Java 17/21/25 bila dependency JAXB tidak eksplisit.

Policy:

```text
Jangan mengandalkan JAXB dari JDK.
Deklarasikan API/runtime/tooling secara eksplisit.
Pisahkan javax JAXB legacy dan jakarta JAXB modern.
```

### 9.2 XSD generation lifecycle

```text
src/main/xsd/*.xsd
  -> xjc
  -> generated Java classes
  -> compileJava
```

Generated package harus stabil:

```text
com.example.integration.partnerx.schema.v1
```

Jangan generate ke package random berdasarkan namespace tanpa review, karena package menjadi bagian dari public API.

### 9.3 Binding file

XJC binding file membantu mengontrol:

- package name;
- class name;
- enum mapping;
- date/time mapping;
- adapter;
- namespace handling.

Contoh struktur:

```text
src/main/xsd/order-v1.xsd
src/main/xjb/order-bindings.xjb
```

Build harus memperlakukan XSD dan XJB sebagai input.

### 9.4 JAXB anti-pattern

```text
1. Rely on JDK-bundled JAXB.
2. Generate ke src/main/java tanpa alasan.
3. Tidak pin XJC tool version.
4. Tidak punya binding file untuk package stability.
5. XML generated class dipakai langsung sebagai domain model.
6. Tidak ada XML round-trip test.
```

Boundary model dari XML sebaiknya dimap ke internal model.

---

## 10. jOOQ Code Generation

jOOQ adalah contoh penting karena input-nya sering database schema. Ia menghasilkan type-safe DSL berdasarkan metadata database.

### 10.1 Mental model jOOQ

```text
database schema / DDL / migration result
  -> jOOQ code generator
  -> generated tables, records, POJOs, DAOs(optional)
  -> compileJava
```

Kekuatan jOOQ:

- SQL menjadi type-safe;
- column/table rename terdeteksi saat compile;
- database-specific features bisa dimodelkan;
- query complex lebih eksplisit dibanding ORM magic.

Risiko build:

- generator perlu database connection;
- DB metadata bisa beda antar environment;
- schema search path bisa salah;
- generated code berubah karena DB state, bukan commit;
- CI butuh DB container/migration step.

### 10.2 Tiga strategi input jOOQ

#### Strategi A — Live database generation

```text
Start DB container
Run migrations
Run jOOQ generator against DB
Compile
```

Cocok bila:

- database dialect penting;
- migration source ada di repo;
- CI bisa menjalankan DB deterministik;
- schema tidak terlalu berat.

Risiko:

- build lebih lambat;
- DB startup flakiness;
- migration failure menghambat compile;
- butuh container tooling.

#### Strategi B — DDL-based generation

```text
schema.sql / migration scripts
  -> jOOQ DDLDatabase
  -> generated sources
```

Cocok bila ingin build lebih ringan dan tidak butuh live DB.

Risiko:

- DDL parser mungkin tidak support seluruh dialect feature;
- beda dengan real DB behavior;
- migration order tetap harus deterministic.

#### Strategi C — Generated code committed/published

```text
schema source -> generated jOOQ module -> publish artifact
consumer depends on artifact
```

Cocok untuk enterprise shared schema atau legacy DB yang tidak mudah disiapkan di CI.

Risiko:

- artifact harus versioned ketat;
- stale generated library;
- perlu release discipline.

### 10.3 Maven jOOQ pattern

Konsep:

```xml
<plugin>
  <groupId>org.jooq</groupId>
  <artifactId>jooq-codegen-maven</artifactId>
  <version>${jooq.version}</version>
  <executions>
    <execution>
      <id>generate-jooq</id>
      <phase>generate-sources</phase>
      <goals>
        <goal>generate</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <jdbc>
      <driver>org.postgresql.Driver</driver>
      <url>${jooq.codegen.jdbc.url}</url>
      <user>${jooq.codegen.jdbc.user}</user>
      <password>${jooq.codegen.jdbc.password}</password>
    </jdbc>
    <generator>
      <database>
        <inputSchema>public</inputSchema>
      </database>
      <target>
        <packageName>com.example.generated.jooq</packageName>
        <directory>${project.build.directory}/generated-sources/jooq</directory>
      </target>
    </generator>
  </configuration>
</plugin>
```

Security note:

- jangan hardcode password;
- gunakan CI secret;
- untuk local, gunakan env var atau settings profile;
- pastikan generated code tidak mencetak credential.

### 10.4 Gradle jOOQ pattern

Dengan plugin modern:

```kotlin
plugins {
    java
    id("org.jooq.jooq-codegen-gradle") version "<pinned-version>"
}

jooq {
    configuration {
        jdbc {
            driver = "org.postgresql.Driver"
            url = providers.environmentVariable("JOOQ_JDBC_URL").get()
            user = providers.environmentVariable("JOOQ_JDBC_USER").get()
            password = providers.environmentVariable("JOOQ_JDBC_PASSWORD").get()
        }
        generator {
            database {
                inputSchema = "public"
            }
            target {
                packageName = "com.example.generated.jooq"
                directory = layout.buildDirectory.dir("generated/sources/jooq/main/java").get().asFile.path
            }
        }
    }
}
```

### 10.5 jOOQ schema drift check

Pipeline yang sehat:

```text
1. Start deterministic DB.
2. Apply migrations.
3. Generate jOOQ code.
4. Compile.
5. Optionally compare generated output with committed expected snapshot.
6. Run integration tests.
```

Drift warning:

```text
If generated jOOQ code changes but no migration changed,
something is wrong with generator config, DB state, or environment.
```

---

## 11. QueryDSL Generation

QueryDSL menggunakan annotation processing untuk menghasilkan Q-classes dari model seperti JPA entities.

### 11.1 Mental model QueryDSL

```text
JPA entity source
  -> annotation processor
  -> QEntity classes
  -> compile/test compile
```

Berbeda dari OpenAPI/Protobuf/jOOQ, QueryDSL biasanya code-first:

```text
Manual entity adalah source of truth.
Generated Q-class adalah compile-time query helper.
```

### 11.2 Maven QueryDSL pattern

Modern setup sebaiknya memakai annotation processor path compiler plugin.

Konsep:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>${maven.compiler.plugin.version}</version>
  <configuration>
    <annotationProcessorPaths>
      <path>
        <groupId>com.querydsl</groupId>
        <artifactId>querydsl-apt</artifactId>
        <version>${querydsl.version}</version>
        <classifier>jakarta</classifier>
      </path>
    </annotationProcessorPaths>
    <compilerArgs>
      <arg>-processor</arg>
      <arg>com.querydsl.apt.jpa.JPAAnnotationProcessor</arg>
    </compilerArgs>
  </configuration>
</plugin>
```

Untuk Spring Boot 3+/Jakarta Persistence, biasanya perlu variant/classifier Jakarta bila library menyediakannya.

### 11.3 Gradle QueryDSL pattern

Konsep:

```kotlin
dependencies {
    implementation("com.querydsl:querydsl-jpa:<version>:jakarta")
    annotationProcessor("com.querydsl:querydsl-apt:<version>:jakarta")
    annotationProcessor("jakarta.persistence:jakarta.persistence-api:<version>")
}
```

Generated Q classes biasanya masuk:

```text
build/generated/sources/annotationProcessor/java/main
```

### 11.4 QueryDSL failure mode

Umum terjadi:

```text
QCustomer not found
```

Kemungkinan:

- annotation processor belum jalan;
- generated source belum masuk IDE;
- memakai javax classifier untuk project Jakarta;
- entity tidak dikompilasi karena module boundary salah;
- annotation processor dependency berada di implementation, bukan annotationProcessor;
- incremental compile cache stale;
- generated output dibersihkan tapi IDE belum sync.

Debug:

```bash
mvn -X compile
./gradlew clean compileJava --info
```

Cek:

```text
target/generated-sources/annotations
build/generated/sources/annotationProcessor/java/main
```

---

## 12. Annotation Processing sebagai Code Generation

Annotation processing bukan hanya QueryDSL. Banyak tool memakai mekanisme ini:

- Lombok;
- MapStruct;
- Dagger;
- Micronaut;
- Hibernate JPA metamodel;
- QueryDSL;
- Immutables;
- AutoValue;
- custom processor internal.

### 12.1 Compile classpath vs processor path

Prinsip modern:

```text
Library runtime/compile dependency != annotation processor dependency.
```

Maven:

```xml
<annotationProcessorPaths>...</annotationProcessorPaths>
```

Gradle:

```kotlin
annotationProcessor("...")
compileOnly("...")
```

Kenapa penting?

- processor tidak bocor ke runtime;
- compile lebih cepat;
- classpath lebih bersih;
- dependency graph lebih jelas;
- security surface lebih kecil.

### 12.2 Isolating vs aggregating processor

Dalam incremental build, processor bisa:

- isolating: output terkait langsung dengan satu input;
- aggregating: output tergantung banyak input.

Aggregating processor sering membuat incremental compile lebih mahal karena perubahan kecil memicu regenerasi luas.

Contoh mental:

```text
MapStruct mapper per interface -> cenderung lokal
JPA metamodel seluruh persistence unit -> bisa lebih luas
```

### 12.3 Lombok special case

Lombok bukan generator biasa. Ia memodifikasi AST saat compile.

Risiko:

- IDE/compiler behavior mismatch;
- Java version compatibility;
- annotation processor order;
- generated method tidak terlihat jelas;
- upgrade JDK bisa memecahkan build.

Policy:

```text
Pin Lombok version.
Test across target JDKs.
Do not use Lombok as hidden architecture mechanism.
Prefer explicit code for critical domain invariants.
```

---

## 13. Generated Code Placement

Recommended layout:

### Maven

```text
src/main/java                         # manual source
src/main/resources                    # manual resources
src/main/openapi                      # OpenAPI specs
src/main/proto                        # proto files
src/main/xsd                          # XSD files
src/main/jooq                         # optional jOOQ config/schema

target/generated-sources/openapi      # generated
target/generated-sources/protobuf     # generated
target/generated-sources/jooq         # generated
target/generated-sources/annotations  # generated
```

### Gradle

```text
src/main/java
src/main/resources
src/main/openapi
src/main/proto
src/main/xsd

build/generated/sources/openapi/main/java
build/generated/source/proto/main/java
build/generated/source/proto/main/grpc
build/generated/sources/jooq/main/java
build/generated/sources/annotationProcessor/java/main
```

Rules:

```text
Do not mix manual and generated code in the same source directory.
Do not edit generated code manually.
Do not depend on generated output without task dependency.
Do not commit generated output unless it is an explicit architecture decision.
```

---

## 14. Generated Code as Separate Module

Kadang generated code sebaiknya ditempatkan di module terpisah.

Contoh:

```text
payment-api-spec
payment-client-generated
payment-service
```

atau:

```text
schema-db-migrations
schema-jooq-generated
order-service
reporting-service
```

Kelebihan:

- boundary jelas;
- generated dependencies tidak bocor ke service utama;
- artifact bisa dipublish;
- compile cache lebih baik;
- ownership contract lebih jelas;
- consumer tidak perlu menjalankan generator.

Risiko:

- lebih banyak module;
- release coordination;
- versioning harus disiplin;
- perubahan spec perlu publishing pipeline.

Rule:

```text
Jika generated code digunakan oleh banyak module/service,
pertimbangkan jadikan artifact/module sendiri.

Jika generated code hanya internal satu module,
generate di module tersebut cukup.
```

---

## 15. Determinism dan Reproducibility

Generated code harus deterministic.

Output tidak boleh berubah karena:

- current timestamp;
- machine hostname;
- absolute path;
- file ordering OS-dependent;
- remote endpoint content;
- DB metadata order tidak stabil;
- generator default berubah karena versi tidak dipin;
- locale/timezone;
- random UUID;
- line ending OS.

### 15.1 Checklist deterministic generation

```text
[ ] Generator version pinned.
[ ] Input spec/schema committed or versioned.
[ ] Config committed.
[ ] Output path under build/target.
[ ] Timestamp hidden/disabled if possible.
[ ] Locale/timezone controlled if relevant.
[ ] Remote input avoided during normal build.
[ ] Generated output not mixed with manual code.
[ ] Dependency versions pinned/locked.
[ ] CI can regenerate from clean checkout.
```

### 15.2 Detecting nondeterminism

Cara sederhana:

```bash
git clean -xfd
./mvnw clean verify
cp -R target/generated-sources /tmp/gen1

./mvnw clean verify
cp -R target/generated-sources /tmp/gen2

diff -ru /tmp/gen1 /tmp/gen2
```

Gradle:

```bash
git clean -xfd
./gradlew clean build
cp -R build/generated /tmp/gen1

./gradlew clean build
cp -R build/generated /tmp/gen2

diff -ru /tmp/gen1 /tmp/gen2
```

If diff exists without input changes, investigate.

---

## 16. Cacheability dan Incrementality

Generated tasks bisa mahal. Untuk performance, build harus tahu kapan generator perlu jalan.

### 16.1 Input yang harus dimodelkan

- spec files;
- schema files;
- binding files;
- generator config;
- generator version;
- runtime/plugin version;
- database migration scripts;
- environment variables yang mempengaruhi output;
- JVM args bila mempengaruhi generator.

### 16.2 Output yang harus dimodelkan

- generated Java source directory;
- generated resources;
- marker files;
- metadata files.

### 16.3 Gradle-specific

Gradle paling kuat jika task mendeklarasikan:

- `@InputFile`;
- `@InputDirectory`;
- `@Input`;
- `@OutputDirectory`;
- `@Classpath`;
- `@Nested`;
- path sensitivity.

Jika plugin tidak mendeklarasikan input/output dengan benar, build cache dan incremental behavior bisa buruk.

### 16.4 Maven-specific

Maven tidak punya incremental model sekuat Gradle secara core. Banyak plugin memilih sendiri apakah skip/regenerate. Karena itu Maven build sering lebih aman bila generator:

- generate ke clean target directory;
- dijalankan dalam clean release build;
- punya explicit skip flag untuk local speed;
- dikombinasikan dengan CI verification.

---

## 17. IDE Integration

Generated code sering gagal bukan di CI, tapi di IDE.

Masalah umum:

- IntelliJ belum mark generated sources;
- Eclipse/M2E tidak menjalankan plugin lifecycle;
- Gradle import tidak mengenali custom source dir;
- annotation processor disabled;
- Q-classes missing;
- generated gRPC stubs tidak muncul;
- IDE memakai JDK berbeda dari CLI.

Policy:

```text
CLI build is source of truth.
IDE setup must follow build, not replace build.
```

Minimal checklist:

```text
[ ] `./mvnw clean verify` works.
[ ] `./gradlew clean build` works.
[ ] IDE imports generated source directories.
[ ] Annotation processing enabled if needed.
[ ] Toolchain JDK matches build policy.
[ ] Generated output excluded from Git if generate-on-build.
```

---

## 18. Schema Drift dan Contract Drift

Code generation adalah alat drift detection bila dipakai benar.

### 18.1 OpenAPI drift

Provider implementation berubah, spec tidak berubah:

```text
consumer generated client compiles,
but runtime call fails.
```

Mitigation:

- contract test;
- OpenAPI validation in provider CI;
- snapshot spec diff;
- semantic versioning API;
- generated client smoke test.

### 18.2 Database drift

DB schema berubah manual di environment:

```text
jOOQ generated code from migration != production schema
```

Mitigation:

- migration-only schema changes;
- no manual DDL in prod;
- schema diff job;
- jOOQ generation from migrations;
- production drift monitoring.

### 18.3 Protobuf drift

`.proto` breaking change:

```text
old consumer cannot decode/use new message correctly
```

Mitigation:

- breaking change checker;
- reserved field numbers;
- compatibility test;
- package versioning;
- artifact publishing discipline.

---

## 19. Generated Code and Domain Boundaries

Generated code sering membawa model eksternal. Ini berbahaya bila langsung dipakai sebagai domain model.

Contoh buruk:

```text
OpenAPI DTO -> used everywhere in domain/service/database layer
```

Akibat:

- external contract mengunci internal domain;
- breaking API change menjadi breaking domain change;
- validation rules bercampur;
- persistence model ikut berubah;
- test menjadi fragile.

Lebih sehat:

```text
Generated API DTO
  -> adapter/mapper
  -> internal command/query/domain model
```

Untuk jOOQ:

```text
Generated table/record
  -> repository/query adapter
  -> domain model/read model
```

Untuk JAXB:

```text
Generated XML binding model
  -> integration mapper
  -> internal model
```

Prinsip:

> Generated code adalah adapter boundary, bukan pusat domain.

---

## 20. Security Risks in Code Generation

Generator menjalankan code/tools saat build. Itu berarti generator adalah supply-chain risk.

Risiko:

- malicious plugin;
- compromised generator dependency;
- remote spec poisoning;
- generated source menyisipkan unsafe code;
- credential tercetak di generated file/log;
- generated client memakai insecure HTTP defaults;
- generator download binary executable tanpa verification;
- build script menjalankan arbitrary command.

Policy:

```text
Pin generator version.
Use trusted repository.
Verify checksums/signatures where possible.
Avoid remote spec at build time.
Scan generated artifacts.
Review generator config changes.
Separate secrets from generator output.
```

Generated code juga harus ikut static analysis secukupnya. Namun hati-hati: rule yang terlalu strict pada generated code bisa membuat noise besar. Solusi:

```text
Apply security scanning to final artifact.
Apply style lint mostly to manual source.
Apply compile/test/compatibility to generated source.
```

---

## 21. Testing Generated Code

Jangan test generated code line-by-line. Test contract dan integration behavior.

### 21.1 OpenAPI generated client

Test:

- generated client can deserialize sample response;
- generated request matches expected wire contract;
- provider contract test;
- mock server test;
- compatibility against API examples.

### 21.2 Protobuf/gRPC

Test:

- serialization round-trip;
- old/new compatibility;
- server/client stub smoke test;
- deadline/interceptor behavior;
- unknown field behavior if relevant.

### 21.3 JAXB

Test:

- XML marshal/unmarshal round-trip;
- sample XML from partner;
- namespace correctness;
- date/time adapter correctness;
- schema validation.

### 21.4 jOOQ

Test:

- migration applies;
- generated DSL compiles;
- critical query integration tests;
- SQL dialect correctness;
- schema drift detection.

### 21.5 QueryDSL

Test:

- Q classes generated;
- representative query compiles and executes;
- entity rename breaks compile as expected.

---

## 22. Maven Blueprint: Multi-Generator Module

Example module layout:

```text
payment-client/
  pom.xml
  src/main/openapi/payment-api.yaml
  src/test/resources/contracts/payment-response.json
```

Maven lifecycle:

```text
generate-sources: openapi generate
compile: compile generated client
test: deserialize sample contract
package: publish client JAR
```

For jOOQ:

```text
order-jooq/
  pom.xml
  src/main/resources/db/migration
  src/test/java/... migration/generation tests
```

Pipeline:

```text
pre-integration-test: start DB/apply migration
generate-sources: jOOQ generate
compile: compile generated DSL
integration-test: query smoke test
verify: schema drift check
```

Be careful: Maven phase ordering with DB container may require plugin choreography. If it becomes too complex, split generation into a separate explicit CI job or module.

---

## 23. Gradle Blueprint: Multi-Generator Build

Gradle can model generation tasks explicitly:

```kotlin
val generateContractClient by tasks.registering(...) {
    // inputs: spec/config
    // outputs: generated dir
}

sourceSets.main {
    java.srcDir(generateContractClient.map { it.outputs.files.singleFile })
}

tasks.compileJava {
    dependsOn(generateContractClient)
}
```

Better pattern:

```text
Convention plugin defines:
- standard generated source paths
- standard generator versions
- standard package policy
- standard cache behavior
- standard drift checks
```

Example enterprise plugins:

```text
com.company.openapi-client-conventions
com.company.grpc-conventions
com.company.jooq-conventions
com.company.querydsl-conventions
```

This avoids copy-paste build scripts across 50 services.

---

## 24. Code Generation in Multi-Module Architecture

Bad structure:

```text
app
 ├── generates OpenAPI client
 ├── generates jOOQ
 ├── generates QueryDSL
 ├── contains domain
 ├── contains adapters
 └── publishes everything
```

Better structure:

```text
:contracts:payment-openapi
:clients:payment-client
:database:order-schema
:database:order-jooq
:domain:order-domain
:app:order-service
```

Dependency direction:

```text
order-service -> order-domain
order-service -> payment-client
order-service -> order-jooq
order-domain  -> no generated external DTO
```

Generated modules should usually sit at adapter/infrastructure boundaries, not domain core.

---

## 25. Java 8–25 Considerations

### 25.1 Generated source language level

Generator may output code using:

- `var`;
- records;
- sealed classes;
- switch expressions;
- pattern matching;
- Jakarta imports;
- Java 11 HTTP client;
- newer collection APIs.

If target baseline is Java 8, generated code must be Java 8-compatible.

Check generator config:

```text
library option
source compatibility option
date library option
useJakartaEe flag
serialization library option
HTTP client library option
```

### 25.2 javax vs jakarta

For Java/Jakarta ecosystem:

```text
Spring Boot 2 / Java EE legacy -> often javax.*
Spring Boot 3 / Jakarta EE 10+ -> jakarta.*
```

Generated code must match project dependency world.

Common failure:

```text
package javax.persistence does not exist
```

or:

```text
package jakarta.persistence does not exist
```

Cause:

```text
Generator config and dependencies disagree.
```

### 25.3 Toolchain separation

You may run generator with JDK 17/21 but emit Java 8-compatible source. Be explicit.

Policy:

```text
Build JDK can be modern.
Generated source target must match project baseline.
Runtime dependency must match deployment JVM.
```

---

## 26. Troubleshooting Framework

When generated code fails, classify first.

### 26.1 Failure taxonomy

```text
Input failure
  - missing spec/schema/proto
  - invalid YAML/XML/proto
  - schema unavailable

Generator failure
  - plugin version incompatible
  - Java version unsupported
  - missing executable
  - wrong OS classifier

Output failure
  - generated to wrong directory
  - stale output
  - manual edit overwritten

Compile failure
  - missing runtime dependency
  - javax/jakarta mismatch
  - generated source too new for target Java
  - package collision

Runtime failure
  - serialization mismatch
  - generated client incompatible with provider
  - DB schema drift
  - gRPC/protobuf runtime mismatch

IDE failure
  - annotation processing disabled
  - generated source not marked
  - imported with wrong JDK
```

### 26.2 Debug commands

Maven:

```bash
./mvnw clean generate-sources
./mvnw clean compile -X
./mvnw dependency:tree
./mvnw help:effective-pom
```

Gradle:

```bash
./gradlew clean generateSources --info
./gradlew clean compileJava --info
./gradlew dependencies
./gradlew dependencyInsight --dependency protobuf
./gradlew tasks --all
```

File inspection:

```bash
find target/generated-sources -type f | head
find build/generated -type f | head
```

### 26.3 Debug question sequence

Ask:

```text
1. What is the source of truth?
2. Is the input available and versioned?
3. Which generator version ran?
4. Where did it write output?
5. Did compileJava depend on generation?
6. Are generated dependencies declared?
7. Is Java baseline compatible?
8. Is javax/jakarta aligned?
9. Does output change across clean builds?
10. Is CI using the same toolchain as local?
```

---

## 27. Anti-Pattern Catalog

### 27.1 Generated code in manual source directory

```text
src/main/java/com/example/generated/...
```

without explicit commit strategy.

Why bad:

- accidental edits;
- noisy Git diff;
- stale code;
- confusing ownership.

### 27.2 Remote generation during normal build

```text
Download latest spec from service at build time.
```

Why bad:

- unreproducible;
- breaks offline build;
- hidden dependency;
- CI flakiness.

### 27.3 Generated DTO as domain model

Why bad:

- external contract contaminates domain;
- changes ripple everywhere;
- persistence/API coupling.

### 27.4 Unpinned generator version

Why bad:

- generated output changes unexpectedly;
- CI/local mismatch;
- hard-to-debug diffs.

### 27.5 No drift detection

Why bad:

- schema/spec changes silently;
- generated code no longer matches runtime;
- errors appear only in production.

### 27.6 One giant generated module

Why bad:

- every change recompiles everything;
- dependency graph bloats;
- ownership unclear;
- consumers get unnecessary classes/dependencies.

### 27.7 Mixing javax and jakarta

Why bad:

- compile failure;
- runtime class mismatch;
- transitive dependency conflict;
- painful migration.

---

## 28. Enterprise Policy Template

A mature organization should define:

```text
1. Approved generators and versions.
2. Approved generated source directories.
3. Rule for commit vs generate-on-build.
4. Spec versioning policy.
5. Contract review policy.
6. Runtime dependency alignment policy.
7. Java baseline compatibility policy.
8. javax/jakarta policy.
9. CI drift detection policy.
10. Security scanning policy.
11. Ownership of generated artifacts.
12. Publishing policy for shared generated clients.
```

Example policy:

```text
OpenAPI:
- spec must be committed or versioned artifact;
- generated clients for shared APIs must be published as libraries;
- generated DTO must not be used as domain model.

Protobuf:
- proto breaking-change check required;
- field numbers must not be reused;
- protoc/grpc versions centrally managed.

jOOQ:
- generation must run from migration-controlled schema;
- production DB must not be source for normal CI generation;
- generated DSL belongs in infrastructure module.

Annotation processing:
- processors must use annotationProcessor path;
- processor versions centrally managed;
- generated sources excluded from manual style lint unless approved.
```

---

## 29. Practical Review Checklist

Use this when reviewing a PR that adds code generation.

```text
[ ] What is the source of truth?
[ ] Is the input committed/versioned?
[ ] Is the generator version pinned?
[ ] Is generated output outside manual source directories?
[ ] Is generated output excluded from Git if generate-on-build?
[ ] Does compile depend on generation?
[ ] Are generated runtime dependencies declared explicitly?
[ ] Is Java baseline compatible?
[ ] Is javax/jakarta aligned?
[ ] Are package names stable and intentional?
[ ] Are secrets absent from config/output/logs?
[ ] Does clean build work locally and in CI?
[ ] Does generated output remain stable across repeated clean builds?
[ ] Is there contract/drift detection?
[ ] Is generated model isolated from domain core?
[ ] Is ownership clear?
[ ] Is publishing/versioning needed?
[ ] Is IDE import documented or automatic?
[ ] Are generated files excluded or included intentionally?
[ ] Are performance/cache implications acceptable?
```

---

## 30. Key Takeaways

Code generation is powerful because it converts external or higher-level contracts into compile-time guarantees.

But it is dangerous when treated as hidden magic.

The top-level mental model:

```text
Generated code is not the source of truth.
The input contract is the source of truth.
The generator is a compiler-like tool.
The generated output is an intermediate build artifact.
```

Unless deliberately published or committed, generated source should be treated like `target/` or `build/` output.

A mature build treats code generation with the same rigor as compilation:

- pinned tools;
- declared inputs;
- declared outputs;
- deterministic output;
- clear lifecycle;
- contract tests;
- drift detection;
- boundary isolation;
- security review;
- CI reproducibility.

If a build cannot explain where generated code came from, it cannot be trusted.

---

## 31. References

- OpenAPI Generator — Plugins documentation: https://openapi-generator.tech/docs/plugins/
- Protocol Buffers — Java Generated Code Guide: https://protobuf.dev/reference/java/java-generated/
- Google Protobuf Gradle Plugin: https://github.com/google/protobuf-gradle-plugin
- jOOQ Code Generation with Maven: https://www.jooq.org/doc/latest/manual/code-generation/codegen-execution/codegen-maven/
- jOOQ Code Generation with Gradle: https://www.jooq.org/doc/latest/manual/code-generation/codegen-execution/codegen-gradle/
- QueryDSL Code Generation reference: https://querydsl.com/static/querydsl/latest/reference/html/ch03s03.html
- Maven Build Lifecycle: https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html
- Gradle Java Plugin: https://docs.gradle.org/current/userguide/java_plugin.html
- Gradle Incremental Build: https://docs.gradle.org/current/userguide/incremental_build.html
