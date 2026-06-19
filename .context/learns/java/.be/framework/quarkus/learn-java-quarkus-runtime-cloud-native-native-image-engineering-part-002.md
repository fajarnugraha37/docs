# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-002

# Part 002 — Version Strategy: Java 8 sampai 25, Quarkus 2/3, Jakarta Migration, dan Compatibility Reality

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / top 1% engineering orientation  
> Fokus: strategi versi, migration path, compatibility boundary, risiko dependency, dan keputusan production untuk Quarkus modern.

---

## 0. Tujuan Part Ini

Part ini menjawab pertanyaan yang sering diremehkan, tetapi sangat menentukan keberhasilan adopsi Quarkus:

> “Versi Java dan Quarkus mana yang harus dipilih, bagaimana membaca compatibility reality-nya, dan bagaimana memigrasikan sistem enterprise tanpa membuat runtime, dependency, native image, atau Jakarta API menjadi bom waktu?”

Kita tidak akan mengulang dasar Java 8/11/17/21/25. Kamu sudah punya fondasi Java. Yang kita dalami adalah **cara berpikir versi sebagai constraint arsitektur**.

Di banyak proyek enterprise, kegagalan migrasi framework jarang terjadi karena developer tidak bisa menulis endpoint. Kegagalan lebih sering terjadi karena:

1. memilih target versi yang salah,
2. menganggap Java version hanya urusan compiler,
3. mengabaikan `javax.*` ke `jakarta.*`,
4. menganggap semua library otomatis compatible dengan native image,
5. tidak memisahkan build-time compatibility dan runtime compatibility,
6. tidak punya migration ring,
7. tidak punya regression gate,
8. tidak punya policy untuk dependency dan extension drift.

Quarkus memperbesar pentingnya versi karena Quarkus bukan framework runtime biasa. Quarkus melakukan banyak pekerjaan saat build: indexing, bytecode generation, bean removal, extension augmentation, static initialization planning, dan native-image metadata preparation. Karena itu, **version strategy di Quarkus adalah runtime design problem**.

---

## 1. Kenapa Part Ini Penting untuk Top 1% Engineer

Engineer biasa bertanya:

> “Quarkus versi berapa yang terbaru?”

Engineer yang lebih matang bertanya:

> “Versi mana yang stabil untuk production, compatible dengan dependency saya, punya support lifecycle yang jelas, cocok dengan target Java saya, bisa diuji di native mode, dan masih memberi ruang upgrade tanpa rewrite besar?”

Top-level engineer melihat versi sebagai kombinasi dari:

- language feature,
- JVM behavior,
- framework baseline,
- Jakarta namespace,
- dependency graph,
- build tooling,
- container base image,
- GraalVM/Mandrel compatibility,
- Kubernetes runtime,
- CI/CD reproducibility,
- team skill,
- incident recovery.

Dengan Quarkus, pertanyaan versi bukan sekadar:

```text
Java berapa?
Quarkus berapa?
```

Tetapi:

```text
Build pakai JDK berapa?
Run JVM pakai JDK berapa?
Native image build pakai Mandrel/GraalVM berapa?
Container base image apa?
Target bytecode level berapa?
Quarkus platform BOM apa?
Extension apa saja?
Library non-extension apa saja?
Masih ada javax.* atau sudah jakarta.*?
Apakah dependency butuh reflection?
Apakah dependency melakukan dynamic classloading?
Apakah library pakai Unsafe, proxy, serialization, JNI, ServiceLoader?
Apakah aplikasi akan JVM mode saja atau native-ready?
```

Part ini membangun cara berpikir tersebut.

---

## 2. Fakta Baseline Modern Quarkus

Beberapa fakta penting yang harus dipegang:

1. Quarkus 3.7 menetapkan Java 17 sebagai minimum untuk build dan run aplikasi Quarkus 3.7+.
2. Quarkus 3 awalnya masih punya fase transisi dari Java 11, tetapi arah modernnya jelas bergerak ke Java 17+.
3. Quarkus 3 menggunakan Jakarta EE 10 API, yang berarti banyak package berpindah dari `javax.*` ke `jakarta.*`.
4. Quarkus 3.31 menambahkan dukungan penuh Java 25, termasuk runtime image Java 25 dan native image build dengan Mandrel.
5. Native image memiliki compatibility matrix sendiri: tidak cukup hanya Java source compile; library juga harus cocok dengan closed-world assumption.
6. Quarkus platform menggunakan BOM dan extension ecosystem. Mengacak versi dependency secara bebas bisa menciptakan konflik halus.

Implikasinya:

> Untuk proyek baru modern, baseline sehat adalah Java 17+; Java 21 sering menjadi pilihan LTS yang sangat rasional; Java 25 mulai relevan untuk project baru/forward-looking ketika ecosystem internal sudah siap. Java 8 tidak realistis sebagai target runtime untuk Quarkus modern, tetapi tetap relevan sebagai sumber migrasi legacy.

---

## 3. Java 8 sampai 25: Bukan Semua Sama Relevan untuk Quarkus

Mari susun versi Java sebagai peta keputusan, bukan sebagai daftar fitur.

### 3.1 Java 8 — Legacy Source, Bukan Target Quarkus Modern

Java 8 sangat penting dalam sejarah enterprise Java:

- lambda,
- stream,
- default method,
- `Optional`,
- `CompletableFuture`,
- `java.time`,
- ecosystem lama yang sangat besar.

Namun untuk Quarkus modern, Java 8 sebaiknya dipandang sebagai:

```text
legacy input state
```

bukan:

```text
modern Quarkus target state
```

Masalah utama Java 8 untuk adopsi Quarkus modern:

- tidak cocok dengan baseline Quarkus 3.7+,
- ecosystem dependency sering sudah bergerak ke Java 11/17,
- tidak punya module system,
- tidak punya banyak improvement runtime modern,
- tooling security/compliance makin lemah,
- container images lama cenderung lebih berisiko,
- library modern bisa berhenti support.

Jadi kalau kamu punya aplikasi Java 8, strategi yang waras bukan:

```text
Java 8 app -> langsung Quarkus modern
```

Tetapi:

```text
Java 8 app
  -> dependency cleanup
  -> Java 11/17 compatibility pass
  -> javax/jakarta inventory
  -> framework boundary extraction
  -> Quarkus target service/module
```

Java 8 tetap perlu dipahami karena banyak sistem enterprise masih hidup di sana. Tetapi dalam seri Quarkus ini, Java 8 adalah **migration origin**, bukan **production target**.

### 3.2 Java 11 — Transisi yang Sudah Mulai Ditinggalkan

Java 11 adalah LTS penting dan banyak enterprise sempat menjadikannya baseline. Beberapa versi Quarkus lama masih relevan secara historis dengan Java 11, tetapi Quarkus modern sudah bergerak ke Java 17+.

Java 11 masih berguna sebagai:

- stepping stone migration dari Java 8,
- target sementara untuk aplikasi lama,
- compatibility scan phase,
- intermediate CI job untuk menemukan dependency yang terlalu tua.

Tetapi untuk Quarkus 3.7+, Java 11 bukan baseline.

Kesalahan umum:

```text
“Kami sudah upgrade dari Java 8 ke Java 11, berarti siap Quarkus modern.”
```

Belum tentu. Kamu masih harus mengecek:

- apakah source memakai `javax.*`,
- apakah dependency support Jakarta EE 10,
- apakah build tool cukup baru,
- apakah library punya Quarkus extension,
- apakah ada reflection/dynamic classloading,
- apakah bytecode dependency terlalu lama,
- apakah framework lama tightly coupled dengan servlet container atau app server.

### 3.3 Java 17 — Baseline Modern yang Stabil

Java 17 adalah titik aman untuk Quarkus modern karena:

- menjadi baseline minimum Quarkus 3.7+,
- LTS,
- sudah matang secara ecosystem,
- banyak vendor runtime/container image stabil,
- cocok untuk production enterprise,
- menjadi titik minimum untuk banyak library modern.

Java 17 memberi fitur bahasa/runtime penting:

- records,
- sealed classes,
- pattern matching awal,
- text blocks,
- switch expression,
- stronger encapsulation,
- banyak improvement GC/JVM,
- baseline keamanan/tooling yang lebih modern.

Untuk proyek Quarkus enterprise yang konservatif, Java 17 adalah pilihan aman.

Mental model:

```text
Java 17 = compatibility baseline
```

Bukan berarti paling cepat atau paling baru, tetapi paling sering menjadi titik tengah antara modernitas dan stabilitas.

### 3.4 Java 21 — LTS yang Sangat Menarik untuk Quarkus

Java 21 adalah LTS berikutnya yang sangat penting untuk Quarkus karena:

- virtual threads stabil,
- structured concurrency mulai muncul sebagai arah berpikir,
- pattern matching lebih matang,
- record patterns,
- sequenced collections,
- runtime performance improvement,
- container/JVM behavior makin matang.

Untuk Quarkus, Java 21 menarik karena membuka pilihan desain:

```text
Reactive pipeline
vs
Blocking style di atas virtual threads
```

Ini bukan berarti virtual threads menggantikan reactive programming. Keduanya punya tempat.

Java 21 cocok untuk:

- proyek baru dengan baseline modern,
- service yang banyak blocking IO tapi ingin model kode sederhana,
- aplikasi yang tidak harus mengejar native image sejak hari pertama,
- organisasi yang ingin LTS lebih panjang dari Java 17.

Namun tetap harus diuji:

- pinning issue,
- JDBC driver behavior,
- thread-local/MDC propagation,
- concurrency limit,
- memory per virtual thread workload,
- compatibility dengan framework extension.

Mental model:

```text
Java 21 = modern LTS operating baseline
```

### 3.5 Java 25 — Forward-Looking, Bukan Otomatis Default untuk Semua Enterprise

Java 25 mulai relevan karena Quarkus terbaru sudah menambahkan dukungan penuh. Tetapi dalam enterprise, “supported” tidak otomatis berarti “langsung dipakai semua sistem”.

Java 25 cocok dipertimbangkan bila:

- proyek baru,
- dependency graph bersih,
- CI/CD bisa mengunci image/toolchain,
- organisasi siap mengikuti patch cadence,
- native image build pipeline sudah diuji,
- team memahami perubahan ecosystem,
- platform internal mendukung JDK 25.

Java 25 bisa memberi keuntungan seperti:

- build performance improvement tertentu,
- runtime image modern,
- native image path yang makin matang,
- access ke perkembangan bahasa/runtime terbaru.

Tetapi risiko enterprise-nya:

- library belum semuanya diuji luas,
- vendor support policy harus dicek,
- base image perlu distandardisasi,
- security scanning tools kadang tertinggal,
- internal platform belum siap.

Mental model:

```text
Java 25 = advanced modern target untuk project yang siap secara platform
```

Bukan sekadar “karena terbaru”.

---

## 4. Matrix Keputusan Java Version untuk Quarkus

| Java Version | Peran dalam Strategi Quarkus | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|---|
| Java 8 | Legacy source/origin | Inventory, migration planning, old enterprise systems | Quarkus modern target |
| Java 11 | Transitional stepping stone | Upgrade antara Java 8 ke 17, compatibility cleanup | Quarkus 3.7+ target |
| Java 17 | Stable modern baseline | Enterprise production, Quarkus 3.7+, conservative modernization | Organisasi yang ingin fitur terbaru Java 21/25 |
| Java 21 | Strong modern LTS | New services, virtual threads, modern cloud workload | Dependency/platform belum siap |
| Java 25 | Forward-looking supported target | New projects, high-maturity platform, native image modern path | Enterprise konservatif tanpa validation matrix |

Keputusan praktis:

```text
Legacy app Java 8/11:
  target migration minimum = Java 17

New enterprise Quarkus app:
  default safe choice = Java 21 or Java 17

Experimental/forward-looking platform:
  consider Java 25 with strict compatibility gate
```

---

## 5. Quarkus 2 vs Quarkus 3: Batas Besar yang Tidak Boleh Disepelekan

Quarkus 2 dan Quarkus 3 bukan sekadar beda minor.

Perubahan besar Quarkus 3:

1. Jakarta EE 10 baseline.
2. `javax.*` ke `jakarta.*`.
3. Hibernate ORM 6.
4. REST stack evolution.
5. Java baseline bergerak ke Java 17+ pada Quarkus 3.7+.
6. Extension ecosystem ikut berubah.
7. Banyak behavior framework menjadi lebih modern tetapi juga lebih strict.

### 5.1 `javax.*` ke `jakarta.*`

Ini perubahan paling terlihat:

```java
// Lama
import javax.inject.Inject;
import javax.persistence.Entity;
import javax.validation.Valid;
import javax.ws.rs.GET;

// Baru
import jakarta.inject.Inject;
import jakarta.persistence.Entity;
import jakarta.validation.Valid;
import jakarta.ws.rs.GET;
```

Namun migrasi ini bukan hanya search-replace.

Yang harus dicek:

- source code,
- generated code,
- annotation processor,
- OpenAPI generator,
- MapStruct mapper,
- Lombok interaction,
- JPA metamodel,
- XML descriptor,
- persistence config,
- validation message,
- test code,
- transitive dependency,
- old library yang masih compile against `javax.*`,
- servlet filters/listeners,
- custom security integration,
- old JAX-RS providers,
- CDI extension lama.

Kesalahan fatal:

```text
Kode sudah jakarta.*, tapi dependency masih membawa javax API lama.
```

Ini bisa menyebabkan:

- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- ambiguous provider,
- annotation tidak terdeteksi,
- runtime behavior aneh,
- native image metadata mismatch.

### 5.2 Hibernate ORM 5 ke 6

Quarkus 3 bergerak ke Hibernate ORM 6. Ini punya implikasi besar:

- query parsing berubah,
- type system berubah,
- dialect behavior berubah,
- custom type mapping bisa rusak,
- deprecated API hilang,
- result transformer berubah,
- criteria behavior bisa beda,
- pagination/fetch join edge case perlu diuji,
- SQL generation bisa berubah.

Kalau sistem punya query kompleks, migrasi Hibernate 6 harus dianggap sebagai mini-project.

Checklist:

```text
[ ] Inventory JPQL/HQL custom query
[ ] Inventory native query
[ ] Inventory custom Hibernate type
[ ] Inventory dialect override
[ ] Inventory entity listener
[ ] Inventory converter
[ ] Inventory lazy loading assumption
[ ] Run SQL diff for critical flows
[ ] Run performance baseline before/after
[ ] Check pagination behavior
[ ] Check pessimistic/optimistic locking behavior
```

### 5.3 RESTEasy Classic vs Quarkus REST

Quarkus punya sejarah REST stack:

- RESTEasy Classic,
- RESTEasy Reactive,
- sekarang branding/documentation mengarah ke Quarkus REST.

Perubahan ini penting karena execution model dapat berbeda:

- blocking vs non-blocking,
- event loop vs worker thread,
- provider compatibility,
- filters/interceptors behavior,
- multipart behavior,
- exception mapping,
- request context propagation.

Jika kamu migrasi endpoint dari JAX-RS klasik, jangan hanya cek response 200. Cek juga:

- thread yang menjalankan endpoint,
- apakah endpoint melakukan blocking IO,
- apakah annotation memaksa blocking/non-blocking,
- apakah filter membaca body,
- apakah provider custom masih kompatibel,
- apakah exception mapper precedence tetap benar,
- apakah streaming response masih aman.

---

## 6. Compatibility Reality: Ada Banyak “Versi” dalam Satu Aplikasi

Saat orang berkata:

> “Aplikasi ini pakai Java 21 dan Quarkus 3.”

Itu belum cukup.

Aplikasi Quarkus punya beberapa lapisan versi:

```text
┌─────────────────────────────────────────────┐
│ Source language level                        │
│ e.g. Java 17, 21, 25                         │
├─────────────────────────────────────────────┤
│ Build JDK                                    │
│ JDK yang menjalankan Maven/Gradle/Quarkus     │
├─────────────────────────────────────────────┤
│ Target bytecode                              │
│ --release / maven.compiler.release            │
├─────────────────────────────────────────────┤
│ Quarkus platform BOM                         │
│ version alignment untuk extension             │
├─────────────────────────────────────────────┤
│ Extension versions                           │
│ ideally aligned by platform                   │
├─────────────────────────────────────────────┤
│ Non-extension third-party libraries           │
│ risk area terbesar                            │
├─────────────────────────────────────────────┤
│ Runtime JDK image                             │
│ JVM mode container runtime                    │
├─────────────────────────────────────────────┤
│ Native image builder                          │
│ GraalVM/Mandrel version                       │
├─────────────────────────────────────────────┤
│ Native runtime base image                     │
│ libc, SSL, CA certs, timezone, etc.            │
└─────────────────────────────────────────────┘
```

Top-level engineer tidak membiarkan lapisan-lapisan ini implicit.

Mereka membuat **version manifest**.

Contoh:

```yaml
runtime-strategy:
  application: payment-case-service
  java-source-level: 21
  java-target-release: 21
  build-jdk: eclipse-temurin-21.0.x
  runtime-jdk-image: registry/company/ubi-jdk21-runtime:x.y.z
  quarkus-platform: 3.xx.x
  quarkus-bom: io.quarkus.platform:quarkus-bom:3.xx.x
  native-builder: quay.io/quarkus/ubi9-quarkus-mandrel-builder-image:jdk-21
  native-enabled: false
  jakarta-baseline: jakarta-ee-10
  hibernate-major: 6
  rest-stack: quarkus-rest
  dependency-policy: platform-aligned-first
```

---

## 7. Build JDK vs Runtime JDK vs Target Release

Ini area yang sering membuat bug aneh.

### 7.1 Build JDK

Build JDK adalah JDK yang menjalankan Maven/Gradle dan Quarkus augmentation.

Dalam Quarkus, build JDK penting karena:

- annotation processing,
- bytecode generation,
- Jandex indexing,
- extension augmentation,
- native image metadata generation,
- tests,
- generated classes.

Jika build JDK berbeda dari runtime JDK, kamu harus tahu konsekuensinya.

### 7.2 Runtime JDK

Runtime JDK adalah JDK di container image JVM mode.

Masalah umum:

```text
Build JDK 21, runtime image JDK 17, target release tidak dikunci.
```

Akibat:

- bytecode terlalu baru,
- class file version mismatch,
- runtime crash,
- behavior mismatch.

### 7.3 Target Release

Untuk Maven:

```xml
<properties>
    <maven.compiler.release>21</maven.compiler.release>
</properties>
```

Atau Java 17:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Jangan hanya mengandalkan `source` dan `target` lama jika ingin API compatibility yang benar. `--release` membantu memastikan API JDK yang digunakan sesuai target.

### 7.4 Rule Praktis

```text
Untuk simplicity production:
  build JDK = runtime JDK = target release
```

Contoh:

```text
Java 21 project:
  build JDK 21
  maven.compiler.release=21
  runtime image JDK 21
  native builder jdk-21 jika native
```

Kamu bisa membuat kombinasi lebih rumit, tetapi harus punya alasan kuat dan test matrix.

---

## 8. Quarkus Platform BOM: Jangan Mengelola Extension Seperti Dependency Biasa

Quarkus menggunakan platform BOM untuk menjaga alignment extension.

Contoh Maven konseptual:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.quarkus.platform</groupId>
      <artifactId>quarkus-bom</artifactId>
      <version>${quarkus.platform.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Extension Quarkus sebaiknya tidak diberi versi manual:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-rest</artifactId>
</dependency>
```

Bukan:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-rest</artifactId>
  <version>acak</version>
</dependency>
```

Kenapa?

Karena extension Quarkus bukan library biasa. Extension punya:

- runtime module,
- deployment module,
- build steps,
- generated metadata,
- native image config,
- integration dengan Quarkus core.

Mencampur versi extension bisa menyebabkan:

- build augmentation error,
- missing build item,
- generated bytecode mismatch,
- runtime behavior mismatch,
- native image failure,
- dev mode error,
- test behavior berbeda.

Mental model:

```text
Quarkus platform BOM = compatibility contract
```

---

## 9. Dependency Governance: Extension First, Library Second

Saat butuh integrasi, urutan berpikir yang sehat:

```text
1. Apakah ada official Quarkus extension?
2. Apakah ada Quarkiverse extension yang matang?
3. Apakah library biasa native-compatible?
4. Apakah perlu wrapper internal?
5. Apakah perlu custom Quarkus extension?
```

Jangan mulai dari:

```text
Tambahkan library Maven seperti biasa.
```

Karena library biasa mungkin:

- melakukan classpath scanning runtime,
- bergantung pada reflection,
- membuat thread sendiri,
- membaca resource secara dinamis,
- pakai dynamic proxy,
- pakai `ServiceLoader`,
- pakai JNI,
- tidak punya native metadata,
- bentrok dengan Jakarta version,
- mengandung transitive dependency lama.

### 9.1 Dependency Risk Classification

| Risk | Ciri | Contoh Risiko |
|---|---|---|
| Low | Quarkus official extension | Version aligned, native metadata tersedia |
| Medium | Quarkiverse mature extension | Perlu cek maintenance dan compatibility |
| Medium-High | Library plain Java sederhana | Bisa jalan JVM mode, native perlu cek |
| High | Reflection-heavy framework | Native image berisiko |
| High | Runtime classpath scanning | Bertentangan dengan build-time model |
| Very High | Old javax-based library | Bisa bentrok Jakarta |
| Very High | Agent/instrumentation/JNI | Native/container issue |

### 9.2 Policy Praktis

Untuk enterprise Quarkus project, buat rule:

```text
Tidak boleh menambahkan dependency baru tanpa:
- alasan penggunaan,
- cek Quarkus extension availability,
- cek Java baseline,
- cek Jakarta namespace,
- cek native compatibility jika target native-ready,
- cek transitive dependency,
- cek license/security,
- minimal test integration.
```

---

## 10. Jakarta Migration: Lebih Dalam dari Rename Package

Migrasi `javax.*` ke `jakarta.*` bisa tampak sederhana, tetapi konsekuensinya luas.

### 10.1 Source Code

Cek semua import:

```text
javax.inject
javax.enterprise
javax.persistence
javax.validation
javax.ws.rs
javax.servlet
javax.annotation
javax.transaction
javax.xml.bind
```

Menjadi:

```text
jakarta.inject
jakarta.enterprise
jakarta.persistence
jakarta.validation
jakarta.ws.rs
jakarta.servlet
jakarta.annotation
jakarta.transaction
jakarta.xml.bind
```

### 10.2 Dependency

Masalah terbesar sering bukan source code sendiri, tetapi dependency.

Contoh:

```text
Aplikasi sudah pakai jakarta.persistence.Entity
Library internal masih expose javax.persistence.EntityManager
```

Ini menciptakan boundary rusak.

### 10.3 Generated Code

Cek generator:

- OpenAPI generator,
- JAXB/xjc,
- MapStruct,
- JPA metamodel,
- GraphQL generator,
- client SDK generator,
- old codegen plugin.

Generated source bisa diam-diam menghasilkan `javax.*`.

### 10.4 XML dan Descriptor

Cek:

- `persistence.xml`,
- `beans.xml`,
- validation XML,
- servlet descriptor,
- JAX-RS config,
- old app-server descriptors.

### 10.5 Test Code

Test juga harus dimigrasi:

- test utility,
- mock provider,
- Arquillian legacy,
- JAX-RS client test,
- validation assertions.

### 10.6 Boundary Anti-Pattern

Buruk:

```java
public interface LegacyRepository {
    javax.persistence.EntityManager entityManager();
}
```

Lebih baik:

```java
public interface CaseRepository {
    Optional<CaseAggregate> findById(CaseId id);
    void save(CaseAggregate aggregate);
}
```

Kenapa?

Karena public interface tidak membocorkan framework namespace.

Top-level engineer selalu mengurangi framework leakage di boundary.

---

## 11. Migration Rings: Cara Aman Memindahkan Sistem Besar

Jangan migrasi seluruh sistem sekaligus tanpa ring.

Gunakan migration rings:

```text
Ring 0 — Inventory & Compatibility Scan
Ring 1 — Build Tool & Dependency Cleanup
Ring 2 — Java Baseline Upgrade
Ring 3 — Jakarta Namespace Migration
Ring 4 — Framework Boundary Extraction
Ring 5 — Quarkus Pilot Module
Ring 6 — Production Candidate Service
Ring 7 — Native-Ready Hardening
Ring 8 — Platform Standardization
```

### Ring 0 — Inventory & Compatibility Scan

Tujuan:

- tahu apa yang dimiliki.

Checklist:

```text
[ ] Java version sekarang
[ ] Build tool version
[ ] Framework utama
[ ] App server/container dependency
[ ] javax package usage
[ ] jakarta package usage
[ ] JPA provider
[ ] REST provider
[ ] security framework
[ ] messaging framework
[ ] scheduler
[ ] HTTP client
[ ] XML/SOAP/JAXB usage
[ ] reflection usage
[ ] dynamic classloading
[ ] custom annotation processors
[ ] internal libraries
[ ] native library/JNI
[ ] agents/instrumentation
```

### Ring 1 — Build Tool & Dependency Cleanup

Tujuan:

- membuat build reproducible.

Checklist:

```text
[ ] Pin Maven/Gradle wrapper
[ ] Pin plugin versions
[ ] Remove unused dependencies
[ ] Analyze dependency tree
[ ] Ban duplicate APIs javax/jakarta
[ ] Introduce dependency convergence check
[ ] Introduce vulnerability scan
[ ] Introduce license check
```

### Ring 2 — Java Baseline Upgrade

Tujuan:

- naik ke Java 17/21 tanpa mengubah framework terlalu banyak.

Strategi:

```text
First make old app run on modern Java.
Then migrate framework.
```

Kenapa?

Kalau kamu upgrade Java, framework, Jakarta namespace, database driver, dan deployment model sekaligus, root cause bug akan kabur.

### Ring 3 — Jakarta Namespace Migration

Tujuan:

- memindahkan API surface dari `javax.*` ke `jakarta.*`.

Gunakan tool otomatis jika memungkinkan, tetapi tetap review manual.

Cek terutama:

- internal shared library,
- generated code,
- custom framework glue,
- API exposed to other modules.

### Ring 4 — Framework Boundary Extraction

Tujuan:

- mengurangi coupling ke framework lama.

Misal aplikasi lama punya service seperti:

```java
public class CaseService {
    @Autowired
    private LegacyDao dao;

    @Transactional
    public void approve(Long id) { ... }
}
```

Sebelum pindah ke Quarkus, buat boundary lebih jelas:

```java
public interface CaseCommandHandler {
    ApprovalResult approve(ApproveCaseCommand command);
}
```

Lalu persistence, security, event publishing, audit logging dijadikan port/adapters.

### Ring 5 — Quarkus Pilot Module

Tujuan:

- bukan rewrite penuh, tetapi memilih satu bounded module.

Kriteria pilot yang baik:

- domain cukup nyata,
- dependency tidak terlalu liar,
- punya database interaction,
- punya REST endpoint,
- punya security,
- punya testable business flow,
- punya observability requirement.

Jangan pilih hello-world. Itu tidak membuktikan apa-apa.

### Ring 6 — Production Candidate Service

Tujuan:

- service siap deploy dengan SLO sederhana.

Checklist:

```text
[ ] REST contract stable
[ ] DB migration controlled
[ ] AuthN/AuthZ tested
[ ] Metrics/log/traces available
[ ] Health checks correct
[ ] Graceful shutdown tested
[ ] Load test baseline
[ ] Failure test
[ ] Rollback plan
```

### Ring 7 — Native-Ready Hardening

Tujuan:

- walaupun belum deploy native, aplikasi tidak menumpuk dependency yang mustahil native.

Checklist:

```text
[ ] Native build attempted in CI optional lane
[ ] Reflection usage documented
[ ] Resource inclusion documented
[ ] Serialization tested
[ ] TLS/crypto tested
[ ] Third-party unsupported libs isolated
[ ] Startup time measured
[ ] RSS memory measured
```

### Ring 8 — Platform Standardization

Tujuan:

- membuat Quarkus bukan one-off project.

Buat:

- parent POM/BOM internal,
- starter template,
- logging standard,
- error response standard,
- security extension/wrapper,
- observability baseline,
- testing archetype,
- CI pipeline template,
- Kubernetes deployment template,
- runbook template.

---

## 12. Migration Decision Tree

Gunakan decision tree berikut.

```text
Apakah aplikasi masih Java 8?
  ├─ Ya:
  │   ├─ Upgrade dulu ke Java 17/21 compatibility path
  │   ├─ Clean dependency
  │   ├─ Inventory javax.*
  │   └─ Jangan langsung native image
  │
  └─ Tidak:
      Apakah aplikasi masih javax.*?
        ├─ Ya:
        │   ├─ Migrasi Jakarta dulu
        │   ├─ Validasi dependency transitive
        │   └─ Cek generated code
        │
        └─ Tidak:
            Apakah domain tightly coupled ke framework lama?
              ├─ Ya:
              │   ├─ Extract ports/adapters
              │   ├─ Stabilkan contract
              │   └─ Migrasi bounded module
              │
              └─ Tidak:
                  Apakah dependency native-friendly?
                    ├─ Ya:
                    │   └─ Quarkus JVM + optional native lane
                    │
                    └─ Tidak:
                        ├─ JVM mode dulu
                        ├─ Isolate incompatible dependency
                        └─ Evaluate replacement/extension
```

---

## 13. JVM Mode vs Native Mode sebagai Version Strategy

Banyak tim mengira adopsi Quarkus berarti harus native image.

Tidak benar.

Quarkus bagus di JVM mode maupun native mode. Native image adalah opsi kuat, bukan kewajiban.

### 13.1 JVM Mode Cocok Jika

- aplikasi long-running,
- throughput penting,
- warm latency lebih penting dari cold start,
- dependency banyak dan kompleks,
- reflection-heavy library sulit dihindari,
- team belum siap native debugging,
- deployment resource masih cukup,
- startup time bukan bottleneck utama.

### 13.2 Native Mode Cocok Jika

- cold start penting,
- memory footprint sangat penting,
- serverless/scale-to-zero,
- high-density container deployment,
- CLI/tooling service,
- short-lived job,
- dependency graph bersih,
- native compatibility sudah diuji,
- observability native sudah siap.

### 13.3 Version Impact

Native mode menambahkan versi baru:

```text
native builder image / Mandrel / GraalVM version
```

Jadi matrix bertambah:

| Layer | JVM Mode | Native Mode |
|---|---|---|
| Build JDK | Wajib | Wajib |
| Runtime JDK | Wajib | Tidak, binary native |
| Native builder | Tidak | Wajib |
| Reflection metadata | Kadang | Sangat penting |
| Startup | Cepat | Sangat cepat |
| Peak throughput | JVM sering unggul setelah warm-up | Tergantung workload |
| Debugging | Lebih familiar | Lebih khusus |
| Compatibility | Lebih luas | Lebih strict |

Rule:

```text
Jangan jadikan native image target utama sebelum dependency graph terbukti sehat.
```

Tetapi:

```text
Jangan juga mengabaikan native compatibility sampai akhir kalau native adalah strategic goal.
```

---

## 14. Build-Time vs Runtime Configuration Compatibility

Quarkus punya config yang dievaluasi saat build dan saat runtime.

Ini memengaruhi version strategy.

Contoh masalah:

```text
Image dibuild dengan extension/config tertentu.
Runtime environment mencoba mengubah config yang sebenarnya fixed at build time.
```

Akibat:

- perubahan tidak berlaku,
- warning saat startup,
- perilaku berbeda dari ekspektasi,
- deployment salah tapi tampak “normal”.

Mental model:

```text
Build-time config menentukan bentuk aplikasi.
Runtime config menentukan perilaku operasional yang memang dirancang mutable.
```

Dalam migration, dokumentasikan:

```yaml
build_time_config:
  - selected extensions
  - datasource kind tertentu
  - package type
  - native options
  - some security/build flags

runtime_config:
  - database URL
  - credential
  - log level tertentu
  - endpoint URL eksternal
  - pool size tertentu
  - feature flag tertentu
```

Jangan menyamakan Quarkus dengan framework yang semua config bisa diubah saat startup.

---

## 15. Build Tool Strategy: Maven vs Gradle

Keduanya didukung, tetapi untuk enterprise Quarkus, Maven sering lebih predictable karena dokumentasi dan plugin ecosystem Quarkus sangat matang di Maven. Gradle tetap valid, terutama jika organisasi sudah standard Gradle.

### 15.1 Maven Strategy

Gunakan:

- Maven wrapper,
- Quarkus platform BOM,
- pinned plugin versions,
- enforcer plugin,
- dependency convergence,
- reproducible build,
- CI cache strategy.

Contoh konsep POM:

```xml
<properties>
    <java.version>21</java.version>
    <maven.compiler.release>${java.version}</maven.compiler.release>
    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>
    <quarkus.platform.artifact-id>quarkus-bom</quarkus.platform.artifact-id>
    <quarkus.platform.version>3.xx.x</quarkus.platform.version>
</properties>
```

### 15.2 Gradle Strategy

Gunakan:

- Gradle wrapper,
- version catalog,
- Quarkus plugin aligned,
- Java toolchains,
- dependency locking,
- reproducible build.

### 15.3 Toolchain Rule

```text
Tidak boleh bergantung pada JDK lokal developer secara implicit.
```

Gunakan:

- Maven/Gradle wrapper,
- toolchain config,
- CI image pinned,
- containerized native build.

---

## 16. Quarkus Upgrade Strategy

Upgrade Quarkus tidak boleh ad hoc.

Gunakan pipeline:

```text
1. Read release notes
2. Read migration guide
3. Update Quarkus platform version in branch
4. Run compile
5. Run unit/component tests
6. Run integration tests
7. Run native build lane if relevant
8. Run smoke test
9. Run dependency tree diff
10. Run performance baseline
11. Review generated warnings
12. Deploy to non-prod
13. Observe startup/log/metrics
14. Approve rollout
```

### 16.1 Upgrade Cadence

Untuk enterprise:

- patch/minor maintenance: rutin,
- LTS: prefer untuk production baseline besar,
- latest fast-moving: cocok untuk platform team/pilot,
- major change: migration project.

### 16.2 Jangan Melompat Tanpa Intermediate Knowledge

Misal:

```text
Quarkus 2.x -> latest 3.x
```

Jangan hanya update version. Baca:

- Quarkus 3 migration,
- Jakarta EE 10 migration,
- Hibernate 6 migration,
- REST migration,
- Java baseline change,
- extension-specific migration notes.

---

## 17. LTS vs Latest: Cara Memilih

### 17.1 LTS Cocok Jika

- organisasi konservatif,
- compliance ketat,
- banyak service,
- upgrade window terbatas,
- perlu patch stability,
- regression cost tinggi.

### 17.2 Latest Cocok Jika

- project baru,
- butuh fitur terbaru,
- team siap upgrade cepat,
- service kecil,
- testing kuat,
- native image improvement penting.

### 17.3 Practical Rule

```text
Platform internal boleh track latest lebih agresif.
Production business-critical service sebaiknya track LTS/stable lane.
```

Dengan kata lain:

```text
explore latest in platform lab
standardize stable in production
```

---

## 18. Enterprise Version Policy Template

Contoh policy:

```markdown
# Quarkus Version Policy

## Java Baseline
- New services should use Java 21 unless exception is approved.
- Java 17 is allowed for conservative compatibility.
- Java 25 is allowed for pilot/new services after platform validation.
- Java 8/11 services must be treated as migration sources, not target state.

## Quarkus Baseline
- Services must use approved Quarkus platform BOM.
- Extension versions must not be overridden unless approved.
- Quarkiverse extensions require owner review.

## Jakarta Baseline
- New Quarkus services must use jakarta.* APIs only.
- javax.* dependencies are blocked unless explicitly isolated.

## Native Image
- Native image is optional unless service class requires it.
- All new dependencies must be classified for native compatibility.
- Native build lane should exist for native-target services.

## Upgrade
- Patch updates monthly where possible.
- Minor updates after migration note review.
- Major version updates require compatibility project.
```

---

## 19. Compatibility Checklist untuk Dependency Baru

Sebelum menambahkan dependency:

```text
[ ] Apakah ada Quarkus official extension?
[ ] Apakah ada Quarkiverse extension?
[ ] Apakah dependency support Java baseline project?
[ ] Apakah dependency masih menggunakan javax.*?
[ ] Apakah dependency membawa transitive javax API?
[ ] Apakah dependency reflection-heavy?
[ ] Apakah dependency melakukan runtime scanning?
[ ] Apakah dependency membuat thread pool sendiri?
[ ] Apakah dependency memerlukan resource file khusus?
[ ] Apakah dependency memakai ServiceLoader?
[ ] Apakah dependency memakai dynamic proxy?
[ ] Apakah dependency memakai serialization?
[ ] Apakah dependency memakai JNI/native library?
[ ] Apakah dependency native-image tested?
[ ] Apakah dependency punya CVE aktif?
[ ] Apakah license acceptable?
[ ] Apakah dependency punya maintainer aktif?
[ ] Apakah ada test integration minimal?
```

Jika banyak jawaban tidak jelas, dependency harus dianggap risiko.

---

## 20. Compatibility Checklist untuk Migrasi Java 8/11 ke Quarkus 3

```text
[ ] Semua module bisa build dengan JDK 17/21
[ ] Build tool modern dan reproducible
[ ] Dependency tree bersih dari duplicate API
[ ] javax.* usage sudah diinventarisasi
[ ] jakarta.* target sudah jelas
[ ] Hibernate/JPA behavior diuji
[ ] REST provider/filter/interceptor diuji
[ ] Validation behavior diuji
[ ] Security integration diuji
[ ] Scheduler/job behavior diuji
[ ] Messaging behavior diuji
[ ] Serialization contract diuji
[ ] Database migration diuji
[ ] SQL generated diff dicek
[ ] Performance baseline sebelum/sesudah ada
[ ] Observability baseline ada
[ ] Native compatibility dievaluasi bila perlu
```

---

## 21. Version Smells: Tanda Strategi Versi Mulai Berbahaya

Waspadai tanda-tanda ini:

### 21.1 Banyak Override Version Manual

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-hibernate-orm</artifactId>
  <version>...</version>
</dependency>
```

Smell:

```text
Extension tidak mengikuti platform BOM.
```

### 21.2 Ada `javax.*` dan `jakarta.*` Bersamaan

Smell:

```text
Namespace split-brain.
```

### 21.3 Build Pakai Java 21, Runtime Java 17 Tanpa `--release`

Smell:

```text
Class file/API mismatch risk.
```

### 21.4 Native Build Baru Dicoba di Akhir Project

Smell:

```text
Native incompatibility ditemukan terlalu terlambat.
```

### 21.5 Dependency Tree Tidak Pernah Direview

Smell:

```text
Transitive dependency menjadi supply-chain blind spot.
```

### 21.6 Menggunakan Library Lama Karena “Dulu Jalan di Spring/Jakarta EE”

Smell:

```text
Runtime model tidak dievaluasi ulang.
```

### 21.7 CI Developer dan Production Berbeda Jauh

Smell:

```text
Environment parity rendah.
```

---

## 22. Case Study: Migrasi Service Java 8 ke Quarkus Modern

Bayangkan service lama:

```text
case-management-service
- Java 8
- Spring Boot 2.x
- javax.validation
- javax.persistence
- Hibernate 5
- REST controllers
- custom audit interceptor
- Oracle JDBC
- scheduled jobs
- internal SOAP client
- custom security filter
```

### 22.1 Cara Salah

```text
1. Buat Quarkus project baru.
2. Copy semua code.
3. Replace javax -> jakarta.
4. Fix compile error.
5. Deploy.
```

Risiko:

- transaction behavior berubah,
- query behavior berubah,
- security filter tidak cocok,
- audit interceptor tidak jalan,
- SOAP client dependency tidak native-friendly,
- scheduler double-run di cluster,
- SQL generated berubah,
- startup error karena config build-time,
- test coverage tidak cukup.

### 22.2 Cara Benar

```text
Phase A — Inventory
- dependency tree
- javax usage
- database interaction
- security flow
- audit flow
- scheduled jobs
- external integrations

Phase B — Modernize Java
- build with Java 17/21
- upgrade compiler plugins
- remove deprecated dependencies
- improve tests

Phase C — Boundary Extraction
- isolate domain service
- isolate repository interface
- isolate audit port
- isolate security identity port
- isolate external client port

Phase D — Quarkus Pilot
- implement one bounded flow
- use Quarkus REST
- use Hibernate ORM Quarkus
- use CDI Arc
- use config mapping
- use OpenTelemetry/logging baseline

Phase E — Production Candidate
- load test
- failure test
- migration test
- rollback plan
- observability dashboard
```

---

## 23. Case Study: Memilih Java 17 vs 21 vs 25 untuk Service Baru

Service baru:

```text
regulatory-event-ingestion-service
- consumes Kafka
- writes PostgreSQL
- exposes REST admin API
- high throughput
- must run on Kubernetes
- possibly native image later
```

### Option A — Java 17

Kelebihan:

- konservatif,
- stable,
- banyak library tested,
- cocok untuk enterprise baseline.

Kekurangan:

- tidak mendapat virtual threads stabil,
- lebih cepat terasa “older baseline”.

### Option B — Java 21

Kelebihan:

- LTS modern,
- virtual threads,
- ecosystem matang,
- cocok untuk service baru,
- good compromise.

Kekurangan:

- perlu validasi platform/container/tooling.

### Option C — Java 25

Kelebihan:

- latest support,
- future-facing,
- bisa mendapat build/runtime improvement.

Kekurangan:

- enterprise validation lebih berat,
- dependency/tooling internal mungkin belum siap.

### Rekomendasi

Untuk kebanyakan enterprise service baru:

```text
Java 21 + Quarkus stable/LTS lane
```

Untuk platform lab/pilot:

```text
Java 25 + latest Quarkus validation lane
```

Untuk sistem konservatif/kritis:

```text
Java 17 + Quarkus LTS/stable lane
```

---

## 24. Version Strategy untuk Multi-Service Organization

Jika organisasi punya banyak microservice, jangan biarkan tiap service memilih bebas.

Buat model:

```text
Approved Runtime Lanes

Lane A — Conservative
- Java 17
- Quarkus LTS
- JVM mode
- critical systems

Lane B — Modern Standard
- Java 21
- Quarkus stable/LTS
- JVM mode, native optional
- default new services

Lane C — Advanced/Pilot
- Java 25
- latest compatible Quarkus
- native experimentation
- platform-managed services only
```

Keuntungan:

- upgrade lebih terkontrol,
- base image lebih sedikit,
- scanning lebih mudah,
- CI template reusable,
- operational knowledge terpusat,
- incident response lebih cepat.

---

## 25. Version Strategy untuk Monorepo dan Multi-Module

Dalam monorepo, jangan mencampur baseline sembarangan.

Masalah:

```text
module-a target Java 17
module-b target Java 21
shared-core pakai API Java 21
service-a runtime Java 17
```

Akibat:

- compile mungkin lewat di satu environment,
- runtime gagal di environment lain,
- CI matrix membengkak,
- developer bingung.

Rule:

```text
Shared module harus mengikuti lowest supported lane.
Service module boleh lebih tinggi hanya jika boundary jelas.
```

Contoh:

```text
shared-domain-core: Java 17
shared-testkit: Java 17
service-modern-x: Java 21
service-pilot-y: Java 25
```

Tetapi jika `service-modern-x` memakai `shared-domain-core`, jangan sampai `shared-domain-core` diam-diam memakai API Java 21.

---

## 26. Handling Internal Libraries

Internal library sering menjadi penghambat migrasi.

Contoh:

```text
company-security-core.jar
company-audit-client.jar
company-soap-connector.jar
company-common-model.jar
```

Pertanyaan:

```text
Apakah library ini masih javax?
Apakah expose framework type?
Apakah kompatibel Java 17/21?
Apakah melakukan reflection?
Apakah butuh Spring context?
Apakah punya Quarkus extension?
Apakah native-friendly?
```

### 26.1 Framework Leakage Problem

Buruk:

```java
public interface AuditService {
    void audit(javax.servlet.http.HttpServletRequest request, Object payload);
}
```

Lebih baik:

```java
public interface AuditPort {
    void record(AuditEvent event);
}
```

Dengan model:

```java
public record AuditEvent(
    String actorId,
    String action,
    String resourceType,
    String resourceId,
    Instant occurredAt,
    Map<String, String> attributes
) {}
```

Framework-specific request bisa diterjemahkan di adapter Quarkus, bukan di library inti.

---

## 27. Native Compatibility Starts at Version Strategy

Bahkan jika belum memakai native image, dependency harus diklasifikasi.

Kenapa?

Karena keputusan hari ini bisa mengunci opsi besok.

Contoh:

```text
Tim menambahkan library report lama yang memakai dynamic classloading dan reflection berat.
Aplikasi jalan di JVM.
Setahun kemudian ingin native image untuk scale-to-zero.
Native build gagal besar.
```

Pelajaran:

```text
Native readiness adalah architectural option value.
```

Jika native bukan target, tidak masalah. Tapi keputusan harus eksplisit.

Buat label:

```text
native-status:
  - compatible
  - compatible-with-config
  - unknown
  - incompatible
  - isolated
```

---

## 28. Practical Commands untuk Inventory

### 28.1 Cek Java Version

```bash
java -version
javac -version
```

### 28.2 Cek Maven Dependency Tree

```bash
./mvnw dependency:tree
```

Cari `javax`:

```bash
./mvnw dependency:tree | grep javax
```

Di Windows PowerShell:

```powershell
./mvnw dependency:tree | Select-String "javax"
```

### 28.3 Cek Source Import

Linux/macOS:

```bash
grep -R "import javax\." src
```

PowerShell:

```powershell
Get-ChildItem -Recurse -Include *.java src |
  Select-String "import javax\."
```

### 28.4 Cek Class File Version Dependency

Jika ada jar mencurigakan:

```bash
javap -verbose SomeClass.class | grep "major version"
```

Mapping penting:

```text
Java 8  = major 52
Java 11 = major 55
Java 17 = major 61
Java 21 = major 65
Java 25 = major 69
```

### 28.5 Cek Duplicate Classes

Gunakan Maven Enforcer atau dependency analyzer. Untuk enterprise, tambahkan rule CI agar duplicate API tidak lolos.

---

## 29. CI/CD Version Gates

Version strategy harus dipaksa oleh pipeline.

Contoh gate:

```text
Gate 1 — Build JDK check
Gate 2 — Maven/Gradle wrapper check
Gate 3 — Dependency convergence
Gate 4 — Ban javax for Quarkus 3 service
Gate 5 — Quarkus platform version check
Gate 6 — Unit/component tests
Gate 7 — Integration tests
Gate 8 — Container image build
Gate 9 — Native build optional/required
Gate 10 — SBOM + vulnerability scan
Gate 11 — Startup smoke test
Gate 12 — Health endpoint check
```

### 29.1 Ban `javax.*` Example Concept

CI script bisa gagal jika menemukan import:

```powershell
$matches = Get-ChildItem -Recurse -Include *.java src | Select-String "import javax\."
if ($matches) {
  Write-Error "javax imports are not allowed in Quarkus 3 modules"
  exit 1
}
```

Tapi jangan terlalu naif: beberapa `javax.*` mungkin masih sah untuk API tertentu di JDK lama. Untuk Quarkus 3 service, default policy harus ketat, exception eksplisit.

---

## 30. Common Failure Modes During Migration

### 30.1 Compile Sukses, Runtime Gagal

Penyebab:

- transitive dependency mismatch,
- classpath conflict,
- runtime JDK beda,
- missing resource,
- provider tidak terdaftar.

Mitigasi:

- integration test,
- startup smoke test,
- dependency convergence,
- runtime image pinned.

### 30.2 JVM Mode Jalan, Native Mode Gagal

Penyebab:

- reflection,
- dynamic proxy,
- resource tidak di-include,
- class initialization issue,
- unsupported library,
- SSL/crypto config.

Mitigasi:

- native build lane awal,
- isolate risky dependency,
- gunakan Quarkus extension,
- register reflection/resource secara eksplisit.

### 30.3 Test Hijau, Production Gagal

Penyebab:

- Dev Services berbeda dari real infra,
- database dialect berbeda,
- config profile berbeda,
- secret missing,
- Kubernetes probe salah,
- startup lebih lambat dari threshold,
- connection pool berbeda.

Mitigasi:

- production-like integration environment,
- config manifest,
- smoke test setelah deploy,
- health/readiness design.

### 30.4 Performance Turun Setelah Upgrade

Penyebab:

- SQL generation berubah,
- connection pool default berubah,
- endpoint pindah execution model,
- serialization behavior berubah,
- logging terlalu verbose,
- virtual threads/reactive misuse.

Mitigasi:

- baseline sebelum upgrade,
- query plan check,
- load test,
- metrics diff.

---

## 31. Anti-Pattern Besar

### Anti-Pattern 1 — “Latest Everything”

```text
Java latest, Quarkus latest, library latest, database driver latest, native builder latest.
```

Tanpa matrix, ini chaos.

### Anti-Pattern 2 — “Old Everything Because Stable”

```text
Java 8, library lama, javax, framework lama, no patch.
```

Ini bukan stable; ini frozen risk.

### Anti-Pattern 3 — “Search Replace Migration”

```text
javax -> jakarta, selesai.
```

Migrasi namespace bukan sekadar text replacement.

### Anti-Pattern 4 — “Native at the End”

Native image baru dicoba setelah semua feature selesai. Ini sering membuka masalah besar terlalu terlambat.

### Anti-Pattern 5 — “No BOM Discipline”

Mengacak versi extension Quarkus seperti dependency biasa.

### Anti-Pattern 6 — “Framework Types Everywhere”

Domain dan shared library expose `EntityManager`, `HttpServletRequest`, framework annotation, atau security principal langsung.

### Anti-Pattern 7 — “CI Tidak Mengunci Toolchain”

Build tergantung JDK lokal developer atau image random.

---

## 32. Mental Model Akhir Part Ini

Pegang model berikut:

```text
Version strategy is architecture.
```

Di Quarkus, versi menentukan:

- API namespace,
- extension behavior,
- build augmentation,
- generated bytecode,
- native image compatibility,
- runtime memory/startup behavior,
- Kubernetes image strategy,
- dependency governance,
- migration cost,
- operational risk.

Jadi jangan bertanya:

```text
Versi terbaru apa?
```

Tanya:

```text
Versi mana yang membentuk compatibility envelope terbaik untuk sistem ini?
```

Compatibility envelope berarti:

```text
Java baseline
+ Quarkus platform
+ Jakarta API
+ dependency graph
+ build tool
+ runtime image
+ native builder
+ operational environment
+ team capability
```

---

## 33. Invariants yang Harus Diingat

1. Quarkus modern adalah Java 17+ world.
2. Java 8 relevan sebagai migration origin, bukan target Quarkus modern.
3. Java 11 adalah transitional baseline, bukan future target untuk Quarkus 3.7+.
4. Java 17 adalah baseline aman.
5. Java 21 adalah modern LTS yang sangat rasional untuk service baru.
6. Java 25 adalah forward-looking target yang perlu platform validation.
7. Quarkus 3 berarti Jakarta EE 10 dan `jakarta.*`.
8. Migrasi `javax.*` ke `jakarta.*` bukan hanya source import.
9. Hibernate 6 migration harus diuji, terutama query dan type system.
10. Quarkus extension harus mengikuti platform BOM.
11. Dependency biasa harus diklasifikasi native/Jakarta/Java compatibility-nya.
12. Build JDK, runtime JDK, target release, dan native builder adalah layer berbeda.
13. Native image adalah opsi arsitektur, bukan kewajiban, tetapi readiness harus dipikirkan sejak awal jika strategis.
14. LTS/stable lane lebih cocok untuk business-critical production; latest lane cocok untuk platform lab/pilot.
15. CI/CD harus memaksa version policy, bukan hanya mendokumentasikannya.

---

## 34. Latihan Top 1% Engineer

### Latihan 1 — Buat Version Manifest

Ambil satu service yang kamu kenal. Tulis:

```yaml
service:
  name:
  current-java:
  target-java:
  build-jdk:
  runtime-jdk:
  target-release:
  quarkus-version:
  quarkus-platform-bom:
  jakarta-status:
  hibernate-version:
  rest-stack:
  native-target:
  native-builder:
  dependency-risk-summary:
```

### Latihan 2 — Dependency Risk Classification

Pilih 10 dependency utama dan klasifikasikan:

```text
official extension / quarkiverse / plain library / risky / incompatible
```

Tambahkan alasan.

### Latihan 3 — Migration Ring Plan

Untuk aplikasi Java 8/11, buat ring migration:

```text
Ring 0 inventory
Ring 1 build cleanup
Ring 2 Java upgrade
Ring 3 Jakarta migration
Ring 4 boundary extraction
Ring 5 Quarkus pilot
```

Isi deliverable tiap ring.

### Latihan 4 — Java 17 vs 21 vs 25 Decision

Untuk service baru, tulis ADR singkat:

```text
Context
Options
Decision
Consequences
Validation Plan
Rollback Plan
```

### Latihan 5 — CI Gate Design

Buat pipeline gate yang mencegah:

- `javax.*` masuk lagi,
- dependency tidak aligned,
- runtime JDK mismatch,
- native target rusak,
- Quarkus version drift.

---

## 35. Production Checklist

Sebelum memilih/meng-upgrade Quarkus version:

```text
[ ] Java baseline disetujui
[ ] Build JDK dikunci
[ ] Runtime JDK dikunci
[ ] Target release dikunci
[ ] Quarkus platform BOM dikunci
[ ] Extension version tidak di-override sembarangan
[ ] Jakarta namespace bersih
[ ] Dependency tree direview
[ ] Native compatibility diklasifikasi
[ ] Build tool wrapper tersedia
[ ] CI image dikunci
[ ] Security scanning tersedia
[ ] SBOM tersedia
[ ] Test suite cukup
[ ] Integration environment mirip production
[ ] Performance baseline ada
[ ] Upgrade rollback plan ada
```

---

## 36. Kapan Part Ini Dianggap Berhasil

Kamu sudah menguasai Part 002 jika bisa menjawab tanpa ragu:

1. Kenapa Java 8 tidak cocok sebagai target Quarkus modern?
2. Kenapa Java 17 menjadi baseline penting?
3. Kapan Java 21 lebih baik dari Java 17?
4. Kapan Java 25 layak dipilih?
5. Apa perbedaan Quarkus 2 dan Quarkus 3 yang paling berisiko?
6. Kenapa `javax.*` ke `jakarta.*` bukan hanya search-replace?
7. Apa beda build JDK, runtime JDK, dan target release?
8. Kenapa extension Quarkus harus mengikuti platform BOM?
9. Kenapa native compatibility harus dipikirkan sejak dependency selection?
10. Bagaimana mendesain migration ring untuk sistem enterprise?

---

## 37. Ringkasan Singkat

Quarkus version strategy bukan urusan kosmetik. Ia menentukan batas kemungkinan aplikasi.

Untuk proyek baru enterprise saat ini, pilihan umum yang kuat adalah:

```text
Java 21 + Quarkus stable/LTS + Jakarta EE 10 + JVM mode first + native-ready discipline
```

Untuk organisasi konservatif:

```text
Java 17 + Quarkus LTS/stable + strict dependency governance
```

Untuk platform/pilot modern:

```text
Java 25 + latest validated Quarkus + native image validation lane
```

Untuk legacy Java 8/11:

```text
Treat as migration source, not target state.
```

Top 1% engineer tidak hanya bisa memakai versi terbaru. Mereka bisa membangun **compatibility envelope** yang aman, evolvable, dan operable.

---

## 38. Referensi Resmi yang Direkomendasikan

- Quarkus announcement: Java 17 minimum for Quarkus 3.7+
- Quarkus 3.7 release notes
- Quarkus 3.0 migration / Jakarta EE 10 migration
- Quarkus 3 page: Java 17/21 positioning and Jakarta APIs
- Quarkus 3.31 release: Java 25 support
- Quarkus update guide
- Quarkus native image guide
- Quarkus Maven tooling guide
- Quarkus REST migration guide

---

## 39. Status Seri

Part 002 selesai.

Seri belum selesai dan belum mencapai bagian terakhir.

Part berikutnya:

> **Part 003 — Quarkus Internal Architecture: Build Steps, Augmentation, Jandex, Arc, dan Extension Model**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-001.md">⬅️ Part 001 — Quarkus Mental Model: Bukan Sekadar “Spring Boot Alternatif”</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-003.md">Part 003 — Quarkus Internal Architecture: Build Steps, Augmentation, Jandex, Arc, dan Extension Model ➡️</a>
</div>
