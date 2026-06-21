# learn-java-eclipse-glassfish-runtime-server-engineering-part-001

# Part 1 — Version Matrix, Compatibility, dan Migration Map dari Java 8 sampai Java 25

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: `001`  
> Fokus: version strategy, compatibility reasoning, dan migration planning untuk Eclipse GlassFish dari era Java 8 sampai Java 25  
> Target pembaca: engineer senior/principal yang perlu mengambil keputusan runtime enterprise secara defensible, bukan sekadar menjalankan server

---

## 0. Posisi Part Ini dalam Series

Part 0 membangun orientasi bahwa GlassFish bukan hanya “tempat deploy WAR/EAR”, tetapi sebuah **enterprise runtime** yang mengatur:

- classloading,
- resource lifecycle,
- transaction coordination,
- connection pooling,
- security realm,
- HTTP transport,
- deployment metadata,
- admin configuration,
- monitoring,
- clustering,
- dan runtime failure semantics.

Part 1 masuk ke fondasi berikutnya: **memilih dan memigrasikan versi**.

Ini penting karena banyak kegagalan migrasi enterprise Java bukan karena engineer tidak paham Servlet, JPA, CDI, atau JAX-RS. Kegagalannya sering terjadi karena mereka menyamakan beberapa perubahan yang sebenarnya berbeda:

1. upgrade versi Java,
2. upgrade versi GlassFish,
3. upgrade versi Java EE / Jakarta EE,
4. migrasi namespace `javax.*` ke `jakarta.*`,
5. upgrade dependency pihak ketiga,
6. upgrade build tool,
7. upgrade container image,
8. upgrade JDBC driver,
9. upgrade observability/security integration,
10. upgrade deployment topology.

Top 1% engineer tidak melihat “upgrade GlassFish” sebagai satu aktivitas tunggal. Mereka memecahnya menjadi beberapa **axis perubahan**, lalu mengontrol risiko per axis.

---

## 1. Core Mental Model: Compatibility Bukan Satu Dimensi

Ketika seseorang bertanya:

> “Aplikasi Java 8 saya bisa jalan di GlassFish versi berapa?”

Pertanyaan itu belum cukup presisi.

Pertanyaan yang lebih benar:

> “Aplikasi saya menggunakan Java language level berapa, bytecode target berapa, Java EE/Jakarta EE API versi berapa, namespace apa, dependency apa, server descriptor apa, dan akan dijalankan pada JVM versi berapa?”

Compatibility minimal punya 7 dimensi.

---

## 2. Tujuh Dimensi Compatibility

### 2.1 Java Source Level

Source level adalah fitur bahasa yang digunakan source code.

Contoh:

```java
// Java 8
list.stream().map(String::trim).toList(); // ini sebenarnya toList() bukan Java 8 Stream API
```

```java
// Java 10+
var name = "glassfish";
```

```java
// Java 16+
record UserId(String value) {}
```

```java
// Java 21+
sealed interface Command permits CreateCase, CloseCase {}
```

Jika source menggunakan `record`, maka source tidak bisa dikompilasi dengan Java 8/11.

Tetapi ini hanya satu dimensi.

---

### 2.2 Java Bytecode Target

Bytecode target adalah versi class file hasil compile.

Contoh Maven:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Jika artifact dikompilasi dengan target Java 17, class file tidak bisa dijalankan di Java 8 atau Java 11.

Typical error:

```text
UnsupportedClassVersionError: class file version 61.0, this version only recognizes up to 52.0
```

Mapping penting:

| Java | Class File Major Version |
|---:|---:|
| 8 | 52 |
| 9 | 53 |
| 10 | 54 |
| 11 | 55 |
| 12 | 56 |
| 13 | 57 |
| 14 | 58 |
| 15 | 59 |
| 16 | 60 |
| 17 | 61 |
| 18 | 62 |
| 19 | 63 |
| 20 | 64 |
| 21 | 65 |
| 22 | 66 |
| 23 | 67 |
| 24 | 68 |
| 25 | 69 |

Compatibility rule:

> JVM yang lebih baru bisa menjalankan bytecode lama, tetapi JVM lama tidak bisa menjalankan bytecode baru.

Contoh:

- Java 21 runtime bisa menjalankan bytecode Java 8.
- Java 8 runtime tidak bisa menjalankan bytecode Java 21.

Tetapi “bisa menjalankan bytecode” tidak otomatis berarti “aplikasi enterprise akan compatible”, karena API server, namespace, library, reflection, dan module behavior bisa berubah.

---

### 2.3 Java Runtime Version

Runtime version adalah JVM yang menjalankan GlassFish.

Ini berbeda dari source/target aplikasi.

Skenario:

- aplikasi dikompilasi target Java 8,
- deploy ke GlassFish 7,
- GlassFish 7 dijalankan dengan JDK 17 atau JDK 21.

Secara bytecode bisa saja aman, tetapi ada risiko:

- penggunaan internal JDK API,
- JAXB/JAX-WS legacy expectation,
- illegal reflective access,
- behavior security manager,
- changed default TLS/cipher,
- removed/deprecated Java EE modules dari JDK modern,
- library lama tidak compatible dengan JDK baru.

Jadi pertanyaan sebenarnya:

> Apakah aplikasi saya hanya Java 8 bytecode, atau juga bergantung pada perilaku runtime JDK 8?

Banyak aplikasi legacy bukan sekadar “Java 8 source”; mereka adalah “Java 8 ecosystem app”.

---

### 2.4 Enterprise Platform Version

Aplikasi enterprise tidak hanya bergantung pada Java SE. Ia bergantung pada Java EE / Jakarta EE platform.

Contoh:

| Platform | Namespace Dominan | Era |
|---|---|---|
| Java EE 8 | `javax.*` | legacy stable baseline |
| Jakarta EE 8 | `javax.*` | transition branding, mostly same API namespace |
| Jakarta EE 9 / 9.1 | `jakarta.*` | namespace migration |
| Jakarta EE 10 | `jakarta.*` | modernization baseline Java SE 11+ |
| Jakarta EE 11 | `jakarta.*` | modern baseline Java SE 17+ |

Ini penting karena GlassFish 5, 6, 7, 8 berada di garis platform yang berbeda.

---

### 2.5 Namespace Compatibility: `javax.*` vs `jakarta.*`

Ini adalah perubahan paling besar dari sisi source dan binary compatibility.

Contoh Java EE 8 / Jakarta EE 8:

```java
import javax.servlet.http.HttpServlet;
import javax.persistence.Entity;
import javax.ws.rs.GET;
```

Contoh Jakarta EE 9+:

```java
import jakarta.servlet.http.HttpServlet;
import jakarta.persistence.Entity;
import jakarta.ws.rs.GET;
```

Perubahan ini bukan cosmetic rename biasa. Ia mengubah:

- source imports,
- binary references dalam bytecode,
- annotation class names,
- deployment descriptor schemas,
- generated code,
- reflection lookups,
- service provider references,
- dependency compatibility,
- transitive library compatibility.

Rule penting:

> Aplikasi `javax.*` tidak otomatis bisa deploy ke runtime `jakarta.*`, meskipun business logic-nya sama.

Jakarta EE 9 specification secara eksplisit menyatakan bahwa karena migrasi dari `javax` ke `jakarta`, Jakarta EE 9 tidak source-code compatible dan tidak binary compatible dengan rilis sebelumnya, walaupun behavior API yang ekuivalen tetap dipertahankan sejauh method signature dan behavior-nya sama.

---

### 2.6 Server Implementation Version

GlassFish version bukan hanya label.

Ia menentukan:

- platform API yang disediakan,
- implementation modules,
- admin command behavior,
- deployment descriptor support,
- bundled components,
- default configuration,
- supported JDK,
- security fixes,
- monitoring behavior,
- classloading behavior,
- MicroProfile support,
- compatibility with newer Java runtime.

Contoh kasar:

| GlassFish | Platform Utama | Namespace |
|---|---|---|
| GlassFish 5.x | Java EE 8 / Jakarta EE 8 era | `javax.*` |
| GlassFish 6.x | Jakarta EE 9 / 9.1 | `jakarta.*` |
| GlassFish 7.x | Jakarta EE 10 | `jakarta.*` |
| GlassFish 8.x | Jakarta EE 11 | `jakarta.*` |

---

### 2.7 Library and Ecosystem Compatibility

Aplikasi enterprise jarang hanya berisi kode sendiri.

Biasanya ada:

- Hibernate / EclipseLink,
- Jackson,
- JAXB,
- Jersey client,
- Apache CXF,
- Spring libraries,
- old javax validation libraries,
- old servlet filters,
- old security libraries,
- old XML/SOAP libraries,
- JDBC driver,
- logging bridge,
- metrics agent,
- APM agent,
- proprietary vendor SDK.

Migrasi ke Jakarta bisa gagal karena dependency pihak ketiga masih membawa `javax.*`.

Contoh masalah:

```text
java.lang.NoClassDefFoundError: javax/servlet/Filter
```

atau:

```text
ClassCastException: javax.ws.rs.core.Response cannot be cast to jakarta.ws.rs.core.Response
```

Ini bukan bug GlassFish. Ini tanda dependency graph tidak konsisten.

---

## 3. Version Matrix Utama: Java, Jakarta EE, dan GlassFish

Matrix berikut adalah model praktis untuk perencanaan. Detail minor release perlu selalu dicek ke release note resmi ketika hendak produksi.

| Era | Java Runtime Umum | Platform | Namespace | GlassFish Line | Catatan Engineering |
|---|---:|---|---|---|---|
| Legacy Java EE 8 | Java 8 | Java EE 8 | `javax.*` | GlassFish 5.x | Cocok untuk aplikasi lama; modern JDK support terbatas/berisiko |
| Transition Jakarta EE 8 | Java 8 | Jakarta EE 8 | `javax.*` | GlassFish 5.1 era | Nama Jakarta, namespace masih `javax` |
| Jakarta Namespace Break | Java 11+ untuk 9.1 | Jakarta EE 9/9.1 | `jakarta.*` | GlassFish 6.x | Fokus utama: namespace migration |
| Modern Jakarta EE 10 | Java 11+ | Jakarta EE 10 | `jakarta.*` | GlassFish 7.x | Baseline modern; GlassFish 7.x supports newer JDKs depending minor release |
| Modern Jakarta EE 11 | Java 17+ platform baseline; GlassFish 8 requires Java 21+ | Jakarta EE 11 | `jakarta.*` | GlassFish 8.x | Modern line; GlassFish 8 requires minimum Java 21 |
| Future Direction | Java 25+ | Jakarta EE 12 future | `jakarta.*` | GlassFish 9 future direction | Target masa depan, bukan baseline untuk app existing tanpa validasi |

Beberapa fakta anchor penting dari dokumentasi resmi:

- GlassFish 5.1 adalah runtime untuk Java EE 8 applications.
- GlassFish 6.x berada di branch Jakarta EE 9.1 dan menambahkan/meningkatkan dukungan JDK 11/17.
- Jakarta EE 10 menetapkan minimum Java SE 11 atau lebih tinggi.
- GlassFish 7.x adalah line Jakarta EE 10.
- Jakarta EE 11 menetapkan minimum Java SE 17 atau lebih tinggi.
- GlassFish 8 Release Notes menyatakan GlassFish 8 membutuhkan Java 21 minimum dan berjalan pada JDK 21 sampai JDK 25, dengan experimental support untuk versi lebih tinggi.

---

## 4. Jangan Campur: Java Upgrade vs Jakarta Upgrade vs GlassFish Upgrade

Ini bagian paling penting.

Bayangkan aplikasi lama:

```text
Current:
- Java 8
- Maven source/target 1.8
- Java EE 8 API
- javax.servlet, javax.persistence, javax.ws.rs
- GlassFish 5.1
- Oracle JDBC lama
- WAR/EAR legacy
```

Ada beberapa jenis upgrade yang mungkin.

---

### 4.1 Upgrade Java Runtime Saja

Contoh target:

```text
- Source tetap Java 8
- Bytecode tetap Java 8
- API tetap javax
- Server mungkin tetap GlassFish 5.x atau runtime lain yang compatible
- JVM dinaikkan ke Java 11/17 jika supported dan tervalidasi
```

Manfaat:

- security update JVM,
- GC lebih baik,
- TLS/cipher modern,
- observability JVM modern,
- container awareness lebih baik.

Risiko:

- server lama belum mendukung JDK baru,
- library legacy memakai internal JDK API,
- removed modules dari JDK modern,
- reflective access issue,
- old bytecode instrumentation agent gagal,
- TLS default berubah.

Ini bukan migrasi Jakarta. Ini hanya runtime modernization.

---

### 4.2 Upgrade Source/Language Level

Contoh target:

```text
- Source Java 17 atau 21
- Bytecode target Java 17 atau 21
- API enterprise bisa tetap javax jika runtime mendukung
```

Manfaat:

- records,
- pattern matching,
- switch expression,
- sealed types,
- better NPE,
- modern collections convenience,
- virtual thread usage di area tertentu.

Risiko:

- artifact tidak bisa jalan di JVM lama,
- build tool perlu upgrade,
- annotation processor lama mungkin gagal,
- Lombok/MapStruct/ByteBuddy/ASM perlu versi baru,
- app server harus jalan di JDK yang sesuai.

Ini bukan otomatis Jakarta migration.

---

### 4.3 Upgrade GlassFish Saja

Contoh:

```text
- GlassFish 5.1 ke 6.x
```

Ini bukan “saja” dalam praktik, karena GlassFish 6.x pindah ke Jakarta EE 9/9.1 dan namespace `jakarta.*`.

Jadi upgrade GlassFish major line dapat membawa perubahan platform API.

Rule:

> Upgrade GlassFish major version harus dibaca sebagai upgrade runtime implementation sekaligus kemungkinan upgrade platform contract.

---

### 4.4 Migrasi `javax.*` ke `jakarta.*`

Ini adalah migration axis paling disruptive.

Yang perlu berubah:

- source imports,
- Maven dependencies,
- generated sources,
- XML descriptors,
- reflection strings,
- test imports,
- mock libraries,
- integration libraries,
- application server descriptors,
- transitive dependencies,
- client SDK jika expose Jakarta types.

Contoh source migration:

```diff
-import javax.servlet.Filter;
-import javax.servlet.FilterChain;
-import javax.servlet.ServletRequest;
-import javax.servlet.ServletResponse;
+import jakarta.servlet.Filter;
+import jakarta.servlet.FilterChain;
+import jakarta.servlet.ServletRequest;
+import jakarta.servlet.ServletResponse;
```

Contoh dependency migration:

```diff
-<dependency>
-    <groupId>javax</groupId>
-    <artifactId>javaee-api</artifactId>
-    <version>8.0</version>
-    <scope>provided</scope>
-</dependency>
+<dependency>
+    <groupId>jakarta.platform</groupId>
+    <artifactId>jakarta.jakartaee-api</artifactId>
+    <version>11.0.0</version>
+    <scope>provided</scope>
+</dependency>
```

Tetapi mengganti import tidak cukup. Seluruh dependency graph harus konsisten.

---

### 4.5 Upgrade Platform API

Jakarta EE 9 adalah mostly namespace migration. Jakarta EE 10 dan 11 membawa perubahan lebih substantif di beberapa spesifikasi.

Contoh kategori perubahan:

- API deprecated removal,
- minimum Java baseline naik,
- integration with Java 21 features,
- spec behavior clarification,
- new specs seperti Jakarta Data di EE 11,
- perubahan versi Servlet, Faces, CDI, Persistence, REST, Security, Concurrency, dll.

Karena user sudah menyelesaikan seri API-specific, di seri GlassFish ini kita tidak akan mengulang detail setiap API. Fokus kita adalah efeknya terhadap runtime:

- deployment compatibility,
- server config,
- classpath,
- resource binding,
- runtime behavior,
- operational risk.

---

## 5. GlassFish 5.x: Java EE 8 / `javax.*` Legacy Baseline

### 5.1 Mental Model

GlassFish 5.x adalah baseline untuk aplikasi Java EE 8 yang memakai `javax.*`.

Typical application:

```text
- Java 8 source/target
- javax.servlet
- javax.persistence
- javax.ejb
- javax.ws.rs
- javax.validation
- javax.annotation
- web.xml Java EE 8 schema
- persistence.xml JPA 2.2 era
- WAR/EAR deploy ke GlassFish 5
```

### 5.2 Kapan Masih Relevan

Masih relevan jika:

- aplikasi mission-critical legacy masih `javax.*`,
- biaya migrasi Jakarta belum justified,
- dependency pihak ketiga belum punya versi Jakarta,
- sistem sedang masuk maintenance mode,
- organisasi butuh stabilitas jangka pendek,
- aplikasi tidak exposed langsung ke internet atau sudah dilindungi layer lain,
- migration roadmap sedang disiapkan bertahap.

### 5.3 Risiko

Risiko utama:

- modern JDK compatibility terbatas,
- security patch cadence perlu dievaluasi,
- dependency ecosystem makin bergerak ke Jakarta,
- sulit mengadopsi Jakarta EE 10/11 feature,
- build pipeline lama biasanya ikut rapuh,
- container/cloud-native story biasanya kurang modern,
- library modern mungkin tidak lagi support `javax`.

### 5.4 Prinsip Jika Tetap di GlassFish 5.x

Jika harus bertahan:

1. freeze dependency secara sadar,
2. dokumentasikan runtime JDK resmi yang dipakai,
3. lakukan CVE monitoring,
4. isolate network exposure,
5. pastikan backup domain config,
6. siapkan migration inventory,
7. jangan campur modern library `jakarta` ke aplikasi `javax`,
8. buat automated smoke test sebelum perubahan infra.

---

## 6. GlassFish 6.x: Jakarta EE 9/9.1 dan Namespace Break

### 6.1 Mental Model

GlassFish 6.x adalah line transisi besar karena berada di era Jakarta EE 9/9.1.

Jakarta EE 9 mengubah namespace dari `javax.*` ke `jakarta.*`.

Jakarta EE 9.1 terutama penting karena membuka jalan certification pada Java SE 11.

### 6.2 Apa Nilai GlassFish 6.x?

Nilainya bukan terutama feature baru. Nilainya adalah:

- memaksa aplikasi masuk namespace Jakarta,
- menghilangkan ketergantungan `javax` untuk EE APIs,
- menjadi stepping stone sebelum Jakarta EE 10/11,
- memisahkan risiko namespace migration dari risiko modern API behavior.

### 6.3 Kapan Gunakan GlassFish 6.x dalam Migration Roadmap?

GlassFish 6.x berguna sebagai intermediate step jika:

- aplikasi besar,
- terlalu berisiko langsung ke GlassFish 8,
- ingin validasi namespace migration dulu,
- ingin mengurangi jumlah variabel perubahan,
- masih ada library yang belum cocok dengan Jakarta EE 10/11 tetapi sudah support `jakarta.*` dasar.

### 6.4 Risiko GlassFish 6.x

- Line transisi; bukan target ideal jangka panjang untuk greenfield modern.
- Harus tetap validasi JDK 17 jika dipakai.
- Banyak library modern mungkin lebih menargetkan Jakarta EE 10/11.
- Migrasi namespace tetap disruptive.

### 6.5 Migration Rule

> GlassFish 6.x cocok sebagai “namespace migration checkpoint”, bukan selalu sebagai final destination.

---

## 7. GlassFish 7.x: Jakarta EE 10 Modern Baseline

### 7.1 Mental Model

GlassFish 7.x adalah line Jakarta EE 10.

Jakarta EE 10 menaikkan baseline minimum Java SE ke 11 atau lebih tinggi.

Typical modern Jakarta EE 10 app:

```text
- JDK 17 atau 21 runtime
- jakarta.* namespace
- jakarta.jakartaee-api 10.x provided
- modern CDI/JPA/REST stack
- GlassFish 7.x
```

### 7.2 Kenapa GlassFish 7.x Penting

GlassFish 7.x sering menjadi target realistis untuk organisasi yang:

- ingin keluar dari Java EE 8,
- ingin masuk `jakarta.*`,
- belum siap Java 21 minimum,
- masih butuh Java 11/17 flexibility,
- ingin Jakarta EE 10 ecosystem maturity.

### 7.3 Java Runtime Strategy untuk GlassFish 7.x

Secara praktis:

- Java 11 adalah minimum Jakarta EE 10 baseline.
- Java 17 sering menjadi enterprise LTS target yang aman.
- Java 21 bisa menjadi target modern jika minor release GlassFish dan dependency sudah mendukung.
- GlassFish 7.1.0 disebut sebagai final Jakarta EE 10 release dan diuji dengan Java 17, 21, dan 25 secara experimental untuk Java 25 pada halaman download resmi.

### 7.4 Kapan Pilih GlassFish 7.x dibanding 8.x?

Pilih 7.x jika:

- organisasi belum siap Java 21 minimum,
- aplikasi masih perlu runtime Java 17,
- dependency stack belum valid untuk Jakarta EE 11,
- upgrade target ingin konservatif,
- platform requirement hanya Jakarta EE 10.

Pilih 8.x jika:

- target runtime sudah Java 21+,
- ingin Jakarta EE 11,
- ingin berada di line terbaru,
- ingin mempersiapkan Java 25 era,
- siap melakukan validation lebih intensif.

---

## 8. GlassFish 8.x: Jakarta EE 11 dan Java 21+ Runtime Line

### 8.1 Mental Model

GlassFish 8.x adalah line Jakarta EE 11.

Jakarta EE 11 minimum Java SE version adalah Java SE 17 atau lebih tinggi, tetapi GlassFish 8 sendiri mensyaratkan Java 21 minimum menurut release notes GlassFish 8.

Ini perbedaan penting:

```text
Jakarta EE 11 platform baseline: Java 17+
GlassFish 8 runtime requirement: Java 21+
```

Jadi jangan menyimpulkan:

> “Karena Jakarta EE 11 minimum Java 17, GlassFish 8 pasti jalan di Java 17.”

Untuk GlassFish 8, release note menyatakan minimum Java 21.

### 8.2 Kenapa Ini Masuk Akal?

Runtime implementation boleh punya requirement lebih tinggi daripada minimum platform specification.

Specification mengatakan compatible implementation harus memenuhi kontrak platform. Tetapi produk/runtime tertentu boleh memilih baseline JVM yang lebih tinggi jika implementation membutuhkan atau menargetkan itu.

### 8.3 Karakter GlassFish 8.x

GlassFish 8.x cocok untuk:

- aplikasi baru berbasis Jakarta EE 11,
- organisasi yang sudah standardize Java 21,
- platform yang ingin menyerap Java 21 runtime benefits,
- modernization dari Java EE legacy ke modern Jakarta stack,
- eksplorasi Java 25 setelah validasi.

### 8.4 Risiko GlassFish 8.x

- Java 21 minimum bisa menjadi blocker organisasi.
- Dependency lama mungkin belum siap Jakarta EE 11.
- Migration dari `javax` langsung ke GlassFish 8 adalah lompatan besar.
- Tooling, IDE, build plugin, APM agent harus dicek.
- Security/observability integration perlu validasi ulang.

### 8.5 Prinsip Adopsi GlassFish 8.x

Untuk produksi:

1. gunakan JDK 21 sebagai baseline aman,
2. gunakan Jakarta EE 11 API secara `provided`,
3. hindari membawa duplicate server API ke WAR/EAR,
4. validasi semua dependency Jakarta-compatible,
5. jalankan integration test di server real,
6. buat startup/deploy smoke test otomatis,
7. ukur memory/thread/pool behavior,
8. siapkan rollback ke line sebelumnya jika migration bukan greenfield.

---

## 9. Java 8 sampai Java 25: Apa yang Relevan untuk GlassFish Engineer?

Kita tidak akan mengulang seluruh Java feature dari seri Java utama. Fokus di sini: apa implikasinya terhadap GlassFish runtime.

---

### 9.1 Java 8

Relevansi:

- baseline historis Java EE 8,
- banyak aplikasi `javax.*`,
- banyak library enterprise lama,
- bytecode 52,
- app server legacy.

GlassFish implication:

- cocok dengan GlassFish 5 era,
- bukan target ideal untuk modern GlassFish 8,
- migration perlu inventory besar.

Risiko:

- TLS/security defaults lama,
- GC/observability lebih terbatas,
- container awareness lebih lemah dibanding JDK modern,
- ecosystem bergerak meninggalkan Java 8.

---

### 9.2 Java 9

Relevansi:

- Java Platform Module System introduced.
- Enterprise apps umumnya masih classpath-based.

GlassFish implication:

- module system memengaruhi reflective access dan internal JDK APIs,
- banyak library lama mulai menunjukkan illegal reflective access warning.

Praktis:

- jarang menjadi target produksi LTS,
- lebih penting sebagai titik perubahan runtime behavior.

---

### 9.3 Java 10

Relevansi:

- non-LTS,
- `var` introduced.

GlassFish implication:

- jarang target runtime enterprise,
- source feature bisa dipakai jika compile target sesuai, tapi tidak strategis.

---

### 9.4 Java 11

Relevansi:

- LTS penting,
- minimum untuk Jakarta EE 10 compatible implementations,
- banyak organisasi migrate dari Java 8 ke 11.

GlassFish implication:

- GlassFish 6.1 line menargetkan support JDK 11 untuk Jakarta EE 9.1.
- GlassFish 7/Jakarta EE 10 memiliki baseline Java SE 11+.

Risiko migration dari 8 ke 11:

- JAXB/JAX-WS tidak lagi bagian default JDK,
- internal API access,
- TLS/cert changes,
- old Maven plugins,
- old bytecode agents.

---

### 9.5 Java 12–16

Relevansi:

- non-LTS releases,
- banyak feature preview/incubation,
- record final di 16.

GlassFish implication:

- biasanya tidak menjadi enterprise runtime target,
- bisa memengaruhi build/test jika organisasi ikut latest JDK,
- jangan jadikan baseline production kecuali ada kebijakan khusus.

---

### 9.6 Java 17

Relevansi:

- LTS besar,
- minimum Java SE version untuk Jakarta EE 11 platform,
- baseline enterprise modern sebelum Java 21.

GlassFish implication:

- GlassFish 6.2.5 meningkatkan compatibility dengan JDK 17.
- GlassFish 7.x bisa relevan untuk runtime Java 17.
- GlassFish 8 membutuhkan Java 21 minimum, jadi Java 17 bukan runtime untuk GlassFish 8.

Risiko:

- stronger encapsulation,
- SecurityManager deprecation/removal path,
- library bytecode/ASM update,
- reflection access issue.

---

### 9.7 Java 18–20

Relevansi:

- non-LTS,
- useful for testing future compatibility.

GlassFish implication:

- bukan baseline enterprise umum,
- bisa menjadi early warning untuk future JDK compatibility.

---

### 9.8 Java 21

Relevansi:

- LTS modern,
- virtual threads final,
- strong target untuk modern enterprise runtime,
- minimum JDK untuk GlassFish 8.

GlassFish implication:

- GlassFish 8 requires Java 21 minimum.
- Jakarta EE 11 dapat memanfaatkan enhancement Java 21, khususnya melalui update Jakarta Concurrency terkait virtual threads.

Caveat:

- virtual threads bukan magic fix untuk semua workload,
- JDBC blocking tetap perlu pool sizing,
- app server thread model tetap harus dipahami,
- APM/agent compatibility perlu dicek.

---

### 9.9 Java 22–24

Relevansi:

- non-LTS,
- useful untuk forward compatibility testing.

GlassFish implication:

- jangan jadikan target default enterprise kecuali organisasi memang punya cadence JDK non-LTS.
- validasi server, agent, tooling, dan dependency.

---

### 9.10 Java 25

Relevansi:

- LTS setelah Java 21,
- target modern jangka menengah,
- GlassFish 8 release notes menyebut berjalan pada JDK 21 sampai JDK 25.

GlassFish implication:

- GlassFish 8 bisa menjadi bridge ke Java 25 validation.
- GlassFish 7.1.0 halaman download menyebut diuji dengan Java 17, 21, dan 25 experimental.
- Untuk production, bedakan “runs/tested/experimental” vs “organization-approved support”.

Decision rule:

> Java 25 boleh menjadi target strategic validation, tetapi production baseline harus mengikuti release note runtime, policy organisasi, vendor support, dan hasil performance/security regression test.

---

## 10. Migration Map: Dari Kondisi Awal ke Target

Sekarang kita susun beberapa jalur migration yang realistis.

---

## 11. Scenario A — Aplikasi Java 8 + Java EE 8 + GlassFish 5 Tetap Maintenance

### 11.1 Kondisi

```text
Current:
- Java 8
- GlassFish 5.x
- Java EE 8
- javax.*
- WAR/EAR legacy
- dependency lama
```

### 11.2 Target

```text
Target:
- tetap GlassFish 5.x sementara
- fokus patch, isolation, monitoring, dan migration readiness
```

### 11.3 Cocok Jika

- aplikasi stabil,
- tidak banyak feature baru,
- risk appetite rendah,
- budget migrasi belum ada,
- dependency belum siap Jakarta,
- vendor/client tidak mengizinkan perubahan besar.

### 11.4 Yang Harus Dilakukan

1. inventory dependency,
2. freeze artifact versions,
3. backup domain config,
4. document admin commands,
5. harden TLS/proxy boundary,
6. centralize logs,
7. add smoke tests,
8. create migration backlog,
9. scan source for `javax.*`,
10. scan descriptors for Java EE schemas.

### 11.5 Hidden Risk

Jika terlalu lama bertahan, risiko migrasi makin besar karena ecosystem makin jauh.

---

## 12. Scenario B — Java 8/Java EE 8 ke Java 11, Namespace Tetap `javax`

### 12.1 Kondisi

```text
Current:
- Java 8
- javax.*
- GlassFish 5.x
```

### 12.2 Target

```text
Target:
- source/target bisa tetap 8 atau naik 11
- namespace tetap javax
- runtime JDK naik jika server dan dependency mendukung
```

### 12.3 Keuntungan

- risiko lebih kecil dibanding Jakarta migration,
- improve JVM/security baseline,
- bisa modernize build pipeline,
- bisa bersihkan dependency lama.

### 12.4 Risiko

- GlassFish 5 compatibility dengan JDK modern harus sangat hati-hati,
- old libraries mungkin gagal,
- JAXB/JAX-WS issue,
- reflective access issue,
- TLS behavior berubah.

### 12.5 Testing Minimum

- startup test,
- deploy test,
- login/security test,
- DB connection test,
- transaction test,
- JMS test jika ada,
- SOAP/XML test jika ada,
- PDF/email/file generation jika ada,
- long-running soak test.

### 12.6 Prinsip

> Ini adalah “JDK migration”, bukan “Jakarta migration”. Jangan rename package dulu.

---

## 13. Scenario C — Java EE 8 `javax` ke Jakarta EE 9/9.1 `jakarta` via GlassFish 6

### 13.1 Kondisi

```text
Current:
- Java EE 8
- javax.*
- GlassFish 5.x
```

### 13.2 Target Intermediate

```text
Target:
- Jakarta EE 9/9.1
- jakarta.*
- GlassFish 6.x
```

### 13.3 Tujuan

Memisahkan namespace migration dari upgrade fitur Jakarta EE 10/11.

### 13.4 Kelebihan

- fokus pada rename dan dependency consistency,
- behavior API relatif dekat,
- cocok untuk large codebase,
- mengurangi cognitive load migration.

### 13.5 Kekurangan

- mungkin hanya intermediate, bukan final,
- tetap butuh langkah lanjutan ke 7/8,
- dependency harus sudah Jakarta-compatible.

### 13.6 Checklist

1. ganti API dependency ke Jakarta,
2. transform source import,
3. transform XML descriptors,
4. update third-party libraries,
5. remove duplicate `javax` jars,
6. run compile,
7. run unit tests,
8. deploy ke GlassFish 6,
9. fix deployment errors,
10. run integration regression.

---

## 14. Scenario D — Java EE 8 Langsung ke Jakarta EE 10 / GlassFish 7

### 14.1 Kondisi

```text
Current:
- Java 8
- Java EE 8
- GlassFish 5
- javax.*
```

### 14.2 Target

```text
Target:
- Java 17 or 21 runtime
- Jakarta EE 10
- GlassFish 7
- jakarta.*
```

### 14.3 Cocok Jika

- aplikasi sedang aktif dikembangkan,
- testing cukup kuat,
- dependency sudah ada versi Jakarta EE 10 compatible,
- tim siap melakukan refactor,
- target tidak perlu GlassFish 8/Java 21 minimum.

### 14.4 Risiko

- namespace migration,
- platform API behavior update,
- JDK runtime update,
- build tool update,
- server config update,
- deployment descriptor update.

Banyak variabel berubah sekaligus.

### 14.5 Cara Mengontrol Risiko

Buat milestone:

```text
M1: compile with modern build, still javax
M2: transform source to jakarta
M3: dependency graph jakarta-clean
M4: deploy minimal app to GF7
M5: deploy full app to GF7
M6: pass integration tests
M7: run performance regression
M8: production rehearsal
```

---

## 15. Scenario E — Java EE 8 Langsung ke Jakarta EE 11 / GlassFish 8 / Java 21

### 15.1 Kondisi

```text
Current:
- Java 8
- Java EE 8
- GlassFish 5
- javax.*
```

### 15.2 Target

```text
Target:
- Java 21+
- GlassFish 8
- Jakarta EE 11
- jakarta.*
```

### 15.3 Ini Lompatan Besar

Perubahan yang terjadi sekaligus:

- Java 8 → Java 21,
- Java EE 8 → Jakarta EE 11,
- `javax` → `jakarta`,
- GlassFish 5 → GlassFish 8,
- old dependency → modern dependency,
- old deployment model → modern server config,
- old JVM tuning → modern JVM tuning.

### 15.4 Cocok Jika

- aplikasi tidak terlalu besar,
- test coverage kuat,
- ada waktu regression cukup,
- dependency siap,
- migration dilakukan sebagai modernization project resmi,
- ada rollback plan.

### 15.5 Tidak Cocok Jika

- aplikasi mission-critical tanpa test,
- tidak ada environment staging yang mirip prod,
- banyak dependency proprietary lama,
- banyak SOAP/XML legacy,
- banyak reflection/classloader hack,
- deployment config tidak terdokumentasi.

### 15.6 Prinsip

> Direct jump boleh, tetapi jangan buta. Buat inventory dan proving stage sebelum full migration.

---

## 16. Scenario F — Greenfield Modern Jakarta EE 11 dengan GlassFish 8

### 16.1 Target

```text
- Java 21 baseline
- GlassFish 8.x
- Jakarta EE 11
- jakarta.* only
- no javax dependencies
- containerized deployment optional
```

### 16.2 Recommended Approach

- Gunakan `jakarta.jakartaee-api` scope `provided`.
- Jangan bundle server API ke WAR/EAR.
- Gunakan JDK 21 sebagai initial baseline.
- Gunakan Maven/Gradle modern.
- Setup integration test against real GlassFish.
- Treat domain config as code.
- Setup admin script sejak awal.
- Setup health/monitoring/logging sejak awal.

### 16.3 Contoh Maven Baseline

```xml
<properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>jakarta.platform</groupId>
            <artifactId>jakarta.jakartaee-bom</artifactId>
            <version>11.0.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>jakarta.platform</groupId>
        <artifactId>jakarta.jakartaee-api</artifactId>
        <version>11.0.0</version>
        <scope>provided</scope>
    </dependency>
</dependencies>
```

### 16.4 Why `provided`?

Karena GlassFish menyediakan implementation API runtime.

Jika API jar ikut dibundle, risiko:

- duplicate classes,
- classloading conflict,
- `ClassCastException`,
- deployment ambiguity,
- server behavior tidak sesuai expectation.

---

## 17. Practical Decision Tree

Gunakan decision tree berikut.

```text
START
  |
  |-- Apakah aplikasi masih javax.*?
  |       |
  |       |-- YES --> Apakah migration ke jakarta sudah disetujui?
  |       |             |
  |       |             |-- NO  --> Tetap di Java EE/Jakarta EE 8 line; harden & inventory
  |       |             |
  |       |             |-- YES --> Apakah target perlu Java 21+/Jakarta EE 11?
  |       |                           |
  |       |                           |-- YES --> Pertimbangkan GF8, tapi buat staged migration
  |       |                           |
  |       |                           |-- NO  --> Pertimbangkan GF6 sebagai checkpoint atau GF7 sebagai target
  |       |
  |       |-- NO --> Aplikasi sudah jakarta.*
  |                     |
  |                     |-- Butuh Jakarta EE 11? --> GF8 + Java 21+
  |                     |
  |                     |-- Butuh Jakarta EE 10? --> GF7 + Java 11/17/21 sesuai support
  |
  |-- Apakah organisasi sudah approve Java 21 runtime?
          |
          |-- YES --> GF8 feasible for Jakarta EE 11
          |
          |-- NO  --> GF7/Java17 lebih realistis untuk modern Jakarta
```

---

## 18. Compatibility Risk Matrix

| Perubahan | Risiko Source | Risiko Binary | Risiko Runtime | Risiko Ops | Catatan |
|---|---:|---:|---:|---:|---|
| Java 8 → 11 runtime, source tetap 8 | Low | Low-Med | Med | Med | Library lama bisa gagal |
| Java 8 → 17 runtime | Low | Low-Med | Med-High | Med | Strong encapsulation impact |
| Java 8 → 21 runtime | Low | Low-Med | High | Med-High | Agent/tooling validation penting |
| `javax` → `jakarta` | High | Very High | High | Med | Tidak binary compatible |
| GF5 → GF6 | High | High | High | Med | Namespace break |
| GF6 → GF7 | Med | Med | Med | Med | Jakarta EE 10 changes |
| GF7 → GF8 | Med | Med | Med-High | Med | Java 21 minimum |
| Java 17 → 21 on Jakarta app | Low-Med | Low | Med | Med | Virtual thread/env/tooling caveat |
| Java 21 → 25 | Low-Med | Low | Med | Med | Validate server/tooling support |

---

## 19. Dependency Graph Audit

Sebelum migrasi, jalankan audit dependency.

### 19.1 Maven

```bash
mvn -DskipTests dependency:tree > dependency-tree.txt
```

Cari:

```bash
grep -i "javax" dependency-tree.txt
grep -i "jakarta" dependency-tree.txt
grep -i "servlet" dependency-tree.txt
grep -i "jaxrs" dependency-tree.txt
grep -i "persistence" dependency-tree.txt
grep -i "validation" dependency-tree.txt
grep -i "annotation" dependency-tree.txt
```

### 19.2 Gradle

```bash
./gradlew dependencies > dependencies.txt
```

Atau per configuration:

```bash
./gradlew dependencyInsight --dependency javax.servlet
./gradlew dependencyInsight --dependency jakarta.servlet
```

### 19.3 Apa yang Dicari?

- `javax.servlet-api`
- `javax.ws.rs-api`
- `javax.persistence-api`
- `javax.validation-api`
- `javax.annotation-api`
- `javax.xml.bind`
- old Jersey 2.x javax variants
- old Hibernate Validator javax variants
- old Jackson/JAXB integration
- old Swagger/OpenAPI libraries still javax
- old Spring libraries expecting javax servlet
- old test containers/server adapters

### 19.4 Golden Rule

> Dalam satu deployment unit, jangan campur Jakarta EE API server dengan library yang masih compile terhadap Java EE `javax` types untuk API boundary yang sama.

---

## 20. Source Audit untuk `javax.*`

### 20.1 Simple Grep

```bash
grep -R "import javax\." src/main/java src/test/java
```

### 20.2 XML Descriptor Search

```bash
grep -R "java.sun.com/xml/ns/javaee" src/main/webapp src/main/resources
```

```bash
grep -R "xmlns.jcp.org/xml/ns/javaee" src/main/webapp src/main/resources
```

```bash
grep -R "javax\." src/main/resources src/main/webapp
```

### 20.3 Reflection/String Search

```bash
grep -R "javax\.servlet" src/main/java src/main/resources
```

```bash
grep -R "javax\.persistence" src/main/java src/main/resources
```

### 20.4 Generated Source

Periksa juga:

- generated SOAP client,
- generated JAXB classes,
- annotation processor output,
- OpenAPI generated code,
- MapStruct generated code,
- custom codegen.

---

## 21. Descriptor Migration Awareness

Source import migration sering terlihat jelas. Descriptor migration sering terlupakan.

Contoh lama:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee
                             http://xmlns.jcp.org/xml/ns/javaee/web-app_4_0.xsd"
         version="4.0">
</web-app>
```

Jakarta modern menggunakan namespace/schema Jakarta.

Tetapi jangan asal ubah descriptor tanpa memahami target platform. Descriptor version harus sesuai target Servlet/Jakarta EE version.

Yang perlu dicek:

- `web.xml`,
- `beans.xml`,
- `persistence.xml`,
- `validation.xml`,
- `ejb-jar.xml`,
- `application.xml`,
- `ra.xml`,
- `glassfish-web.xml`,
- `glassfish-ejb-jar.xml`,
- `glassfish-application.xml`,
- `glassfish-resources.xml`.

---

## 22. Build Tool Compatibility

Migrasi runtime sering gagal karena build tool tertinggal.

### 22.1 Maven Checklist

Periksa:

- Maven version,
- `maven-compiler-plugin`,
- `maven-war-plugin`,
- `maven-ear-plugin`,
- `maven-surefire-plugin`,
- `maven-failsafe-plugin`,
- annotation processor,
- dependency plugin,
- enforcer plugin.

Gunakan compiler release, bukan source/target terpisah, jika memungkinkan:

```xml
<configuration>
    <release>21</release>
</configuration>
```

### 22.2 Gradle Checklist

Periksa:

- Gradle wrapper version,
- Java toolchain,
- WAR/EAR plugin,
- dependency lock,
- annotation processor path,
- test JVM.

Contoh:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

---

## 23. Server API Scope Discipline

Salah satu kesalahan paling umum:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
</dependency>
```

Tanpa `provided`, jar bisa ikut masuk artifact.

Yang benar untuk aplikasi deploy ke GlassFish:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
    <scope>provided</scope>
</dependency>
```

Kenapa?

Karena runtime menyediakan implementation.

Aplikasi hanya butuh API untuk compile.

---

## 24. JDBC Driver Compatibility

JDBC driver adalah titik risiko penting.

Migrasi Java/GlassFish bisa gagal pada:

- driver class name,
- datasource class name,
- TLS/certificate validation,
- timezone handling,
- module/reflection issue,
- XA datasource behavior,
- connection validation query,
- statement cache behavior,
- transaction isolation default.

Checklist:

1. cocokkan driver dengan DB version,
2. cocokkan driver dengan JDK runtime,
3. letakkan driver di lokasi yang benar,
4. test connection pool,
5. test transaction rollback,
6. test connection validation,
7. test failover/reconnect,
8. test long-running idle connection.

Jangan menganggap aplikasi sukses deploy berarti database integration aman.

---

## 25. Security Compatibility

Upgrade JDK/server bisa mengubah:

- TLS protocol default,
- cipher suites,
- truststore behavior,
- certificate chain validation,
- hostname verification,
- security manager behavior,
- LDAP SSL behavior,
- JAAS/custom realm behavior,
- cookie SameSite/Secure behavior behind proxy,
- admin security requirements.

Migration test harus mencakup:

- login,
- logout,
- role mapping,
- session timeout,
- remember-me jika ada,
- external identity provider,
- mTLS jika ada,
- outbound HTTPS call,
- inbound TLS/proxy behavior.

---

## 26. Observability and Agent Compatibility

APM/logging/metrics agent sering tertinggal.

Periksa:

- Java agent compatible dengan JDK target,
- bytecode instrumentation compatible dengan Jakarta namespace,
- log bridge tidak konflik,
- MDC/correlation masih bekerja,
- metrics endpoint masih expose sinyal benar,
- thread names berubah atau tidak,
- async context propagation.

APM yang hanya tahu `javax.servlet` mungkin tidak otomatis instrument `jakarta.servlet`.

Ini sering menyebabkan false sense:

> “Aplikasi jalan, tapi tracing hilang.”

---

## 27. Runtime Verification Layers

Jangan validasi migration hanya dengan compile.

Gunakan layer berikut.

### 27.1 Compile Verification

- source compile,
- test compile,
- annotation processors,
- generated code.

### 27.2 Static Dependency Verification

- no accidental `javax` in Jakarta artifact,
- no duplicated Jakarta API jars,
- no old servlet/jaxrs/persistence API in WAR.

### 27.3 Deployment Verification

- server starts,
- app deploys,
- descriptors parsed,
- CDI bootstraps,
- JPA persistence units start,
- resources bind,
- security realm resolves.

### 27.4 Functional Verification

- key user flows,
- admin flows,
- batch/timer flows,
- JMS flows,
- report/export flows,
- integration flows.

### 27.5 Non-Functional Verification

- latency,
- throughput,
- memory,
- GC,
- thread pool,
- JDBC pool,
- startup time,
- redeploy behavior.

### 27.6 Operational Verification

- logs,
- metrics,
- alerts,
- health checks,
- graceful shutdown,
- rollback,
- backup/restore.

---

## 28. Migration Anti-Patterns

### 28.1 “Search Replace javax to jakarta”

Ini hanya sebagian kecil migration.

Gagal karena:

- dependency masih `javax`,
- descriptor belum berubah,
- generated code belum berubah,
- reflection string belum berubah,
- server-specific config belum dicek,
- test library belum compatible.

---

### 28.2 “Upgrade Semua Sekaligus”

Contoh buruk:

```text
Java 8 → 21
GlassFish 5 → 8
Java EE 8 → Jakarta EE 11
Hibernate old → latest
JDBC driver old → latest
Maven old → latest
OS image old → latest
Proxy config berubah
Database config berubah
```

Jika gagal, root cause menjadi sulit.

---

### 28.3 “Compile Success = Migration Success”

Enterprise runtime failure sering muncul saat:

- deployment scanning,
- CDI validation,
- JPA bootstrap,
- transaction enlistment,
- resource lookup,
- security role mapping,
- runtime reflection,
- lazy endpoint execution.

---

### 28.4 “Server API Dibundle ke Aplikasi”

Membawa `jakarta.jakartaee-api` atau implementation jar ke WAR/EAR bisa membuat classloading conflict.

---

### 28.5 “Tidak Ada Rollback Plan”

Migration tanpa rollback bukan engineering, itu gambling.

Rollback harus mencakup:

- artifact lama,
- domain config lama,
- DB migration rollback/forward fix,
- proxy route,
- credentials,
- deployment script,
- monitoring dashboard.

---

## 29. Top 1% Heuristics untuk Version Decision

### 29.1 Pisahkan Axis Perubahan

Selalu tulis eksplisit:

```text
JDK runtime: 8 -> 17
Source level: 8 -> 17
Platform API: Java EE 8 -> Jakarta EE 10
Namespace: javax -> jakarta
Server: GF5 -> GF7
Dependency set: legacy -> modern
Deployment topology: VM -> container
```

Jika terlalu banyak axis berubah, pecah migration.

---

### 29.2 Jangan Percaya “Compatible” Tanpa Scope

Compatible terhadap apa?

- compile?
- deploy?
- TCK?
- runtime smoke test?
- production workload?
- vendor support?
- security policy?
- APM instrumentation?

Compatibility selalu punya scope.

---

### 29.3 JDK LTS Tidak Otomatis Menjadi Runtime Baseline

Java 25 mungkin LTS. Tetapi server, agent, dependency, policy, dan test result tetap menentukan apakah ia boleh menjadi production baseline.

---

### 29.4 Namespace Consistency Lebih Penting daripada Sekadar Versi Terbaru

Aplikasi Jakarta yang bersih lebih stabil daripada aplikasi “setengah javax setengah jakarta”.

---

### 29.5 Migration Harus Punya Evidence

Evidence minimal:

- dependency report,
- source scan report,
- descriptor scan report,
- deployment log,
- smoke test result,
- performance baseline,
- rollback validation.

Tanpa evidence, keputusan migration tidak defensible.

---

## 30. Migration Planning Template

Gunakan template ini untuk proyek nyata.

```markdown
# GlassFish Migration Plan

## 1. Current State
- Java runtime:
- Source level:
- Bytecode target:
- Enterprise platform:
- Namespace:
- GlassFish version:
- Deployment type:
- Database:
- JDBC driver:
- JMS usage:
- Security realm:
- External integrations:
- APM/logging agents:

## 2. Target State
- Java runtime:
- Source level:
- Bytecode target:
- Enterprise platform:
- Namespace:
- GlassFish version:
- Deployment type:

## 3. Change Axes
| Axis | From | To | Risk | Owner | Test Evidence |
|---|---|---|---|---|---|
| JDK | | | | | |
| Namespace | | | | | |
| Server | | | | | |
| Dependencies | | | | | |
| Descriptors | | | | | |
| JDBC | | | | | |
| Security | | | | | |
| Observability | | | | | |

## 4. Migration Steps
1.
2.
3.

## 5. Validation Plan
- Compile:
- Unit test:
- Deployment test:
- Integration test:
- Performance test:
- Security test:
- Operational test:

## 6. Rollback Plan
- Artifact rollback:
- Domain config rollback:
- DB rollback/forward fix:
- Proxy rollback:
- Monitoring rollback:

## 7. Go/No-Go Criteria
- 
```

---

## 31. Concrete Recommendation Matrix

| Starting Point | Recommended Target | Path |
|---|---|---|
| Java 8 + GlassFish 5 + stable maintenance | Stay temporarily, harden, inventory | Scenario A |
| Java 8 + GF5 but wants JVM modernization only | Carefully test Java 11/17 path if supported | Scenario B |
| Java EE 8 large app, low test confidence | GF6 checkpoint first | Scenario C |
| Java EE 8 app, decent tests, wants modern Jakarta | GF7 / Jakarta EE 10 | Scenario D |
| Java EE 8 app, strong tests, strategic modernization | GF8 / Jakarta EE 11 / Java 21 | Scenario E |
| Greenfield modern enterprise | GF8 / Java 21 / Jakarta EE 11 | Scenario F |
| Existing Jakarta EE 10 app | GF7 stable, or evaluate GF8 if Java 21 ready | GF7→GF8 assessment |
| Existing Jakarta EE 11 app | GF8 | Java 21+ baseline |

---

## 32. Practical Lab: Version Fingerprinting

Sebelum migration, buat script sederhana untuk mencatat keadaan.

### 32.1 Java Runtime

```bash
java -version
javac -version
```

### 32.2 GlassFish Version

```bash
asadmin version
```

### 32.3 Domain Info

```bash
asadmin list-domains
asadmin list-instances
asadmin list-applications
```

### 32.4 JVM Options

```bash
asadmin list-jvm-options
```

### 32.5 Resources

```bash
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
asadmin list-jms-resources
asadmin list-connector-resources
```

### 32.6 Applications

```bash
asadmin list-applications --long=true
```

### 32.7 Dependency Tree

```bash
mvn -DskipTests dependency:tree > dependency-tree.txt
```

### 32.8 Source Namespace

```bash
grep -R "import javax\." src/main/java | wc -l
grep -R "import jakarta\." src/main/java | wc -l
```

### 32.9 Artifact Inspection

```bash
jar tf target/app.war | grep -E "javax|jakarta|servlet|persistence|validation"
```

### 32.10 Why This Matters

Tanpa fingerprint, migration discussion mudah berubah menjadi opini.

Dengan fingerprint, kita bisa berkata:

```text
Aplikasi memiliki 1,842 javax imports, 27 XML descriptors Java EE schema,
13 dependency transitive javax, 4 server-specific GlassFish descriptors,
2 JDBC pools, 1 JMS queue, dan 3 custom realms.
```

Itu baru migration planning yang serius.

---

## 33. Failure Examples and Diagnosis

### 33.1 Unsupported Class Version

Error:

```text
java.lang.UnsupportedClassVersionError: com/example/App has been compiled by a more recent version of the Java Runtime
```

Meaning:

- artifact bytecode target lebih tinggi dari JVM runtime.

Fix:

- jalankan server dengan JDK lebih baru, atau
- compile ulang dengan `--release` lebih rendah.

---

### 33.2 Missing `javax.servlet.Filter` on Jakarta Runtime

Error:

```text
java.lang.NoClassDefFoundError: javax/servlet/Filter
```

Meaning:

- ada code/dependency masih `javax.servlet`,
- runtime Jakarta menyediakan `jakarta.servlet`, bukan `javax.servlet`.

Fix:

- upgrade dependency ke Jakarta variant,
- transform source,
- pastikan tidak ada old jar.

---

### 33.3 `ClassCastException` antara `javax` dan `jakarta`

Error:

```text
ClassCastException: class javax.ws.rs.core.Response cannot be cast to class jakarta.ws.rs.core.Response
```

Meaning:

- dua API family tercampur,
- client/server library beda namespace.

Fix:

- bersihkan dependency graph,
- gunakan satu namespace family end-to-end.

---

### 33.4 Deployment Descriptor Schema Error

Error:

```text
Deployment descriptor parsing failed
```

Meaning:

- descriptor schema/version tidak sesuai runtime,
- namespace XML lama,
- invalid element setelah platform upgrade.

Fix:

- update descriptor sesuai Jakarta target,
- hapus descriptor jika annotation-based sudah cukup,
- validasi XML.

---

### 33.5 CDI Deployment Failure Setelah Migration

Error:

```text
WELD-001408: Unsatisfied dependencies
```

Meaning:

- type berubah namespace,
- bean discovery berubah,
- dependency tidak terdeteksi,
- classloading issue.

Fix:

- cek imports,
- cek `beans.xml`,
- cek dependency scope,
- cek module packaging.

---

## 34. Version Strategy untuk Java 8–25

### 34.1 Untuk Legacy Enterprise

Strategi realistis:

```text
Phase 1: Stabilize current GF5/Java8
Phase 2: Inventory javax/dependency/config
Phase 3: Modernize build/tests
Phase 4: Migrate namespace to jakarta
Phase 5: Target GF7 or GF8
Phase 6: Runtime tune and harden
```

### 34.2 Untuk Active Product

Strategi agresif tapi terkendali:

```text
Phase 1: Create migration branch
Phase 2: Upgrade build to support Java 17/21
Phase 3: Run OpenRewrite/javax-to-jakarta migration
Phase 4: Upgrade dependencies
Phase 5: Deploy to GF7
Phase 6: Decide GF8 after Java 21 readiness
```

### 34.3 Untuk Greenfield

Strategi langsung:

```text
Java 21 + Jakarta EE 11 + GlassFish 8
```

Tetapi tetap:

- integration test real server,
- domain config as code,
- no bundled server APIs,
- observability sejak awal.

### 34.4 Untuk Java 25 Adoption

Strategi:

```text
Production baseline: Java 21
Compatibility lane: Java 25
```

Artinya:

- production tetap Java 21 dulu,
- CI nightly/staging test Java 25,
- kumpulkan evidence,
- tunggu server/tooling/org approval,
- baru promote.

---

## 35. Ringkasan Mental Model

Part ini bisa diringkas menjadi beberapa prinsip.

### 35.1 Compatibility Itu Multi-Axis

Jangan bertanya:

> “Compatible tidak?”

Tanyakan:

> “Compatible pada axis apa: source, bytecode, namespace, platform API, runtime JVM, server implementation, dependency graph, atau operational tooling?”

### 35.2 `javax` ke `jakarta` adalah Boundary Besar

Ini bukan rename kecil.

Ini memengaruhi:

- source,
- binary,
- dependency,
- descriptor,
- reflection,
- generated code,
- server runtime.

### 35.3 GlassFish Major Version Mengikuti Platform Era

- GF5: Java EE 8 / `javax`
- GF6: Jakarta EE 9/9.1 / `jakarta`
- GF7: Jakarta EE 10 / `jakarta`
- GF8: Jakarta EE 11 / `jakarta`, Java 21+ runtime

### 35.4 Java LTS Target Harus Dipilih Berdasarkan Runtime Evidence

- Java 8: legacy
- Java 11: transition
- Java 17: modern conservative
- Java 21: modern strong baseline, required by GF8
- Java 25: strategic validation / future baseline

### 35.5 Top Engineer Mengontrol Variabel

Jangan upgrade semua sekaligus tanpa evidence.

Pisahkan:

- JDK,
- namespace,
- server,
- API,
- dependencies,
- descriptors,
- deployment,
- observability.

---

## 36. Checklist Akhir Part 1

Sebelum lanjut ke Part 2, pastikan kamu bisa menjawab:

1. Apa bedanya Java source level, bytecode target, dan runtime JDK?
2. Kenapa Jakarta EE 9 tidak source/binary compatible dengan Java EE 8?
3. Apa perbedaan GlassFish 5, 6, 7, dan 8 dari sisi platform?
4. Kenapa Jakarta EE 11 minimum Java 17 tidak berarti GlassFish 8 bisa jalan di Java 17?
5. Kapan GlassFish 6 berguna sebagai migration checkpoint?
6. Kapan GlassFish 7 lebih realistis daripada GlassFish 8?
7. Apa risiko mencampur `javax` dan `jakarta` dalam satu artifact?
8. Kenapa dependency tree audit wajib sebelum migration?
9. Kenapa compile success bukan deployment success?
10. Bagaimana membuat migration plan yang defensible?

---

## 37. Referensi Resmi dan Bacaan Lanjutan

- Eclipse GlassFish official site: https://glassfish.org/
- Eclipse GlassFish downloads: https://glassfish.org/download
- Eclipse GlassFish 7.x downloads: https://glassfish.org/download_gf7.html
- Eclipse GlassFish 6.x downloads: https://glassfish.org/download_gf6.html
- Eclipse GlassFish Release Notes 8: https://glassfish.org/docs/latest/release-notes.html
- Eclipse GlassFish GitHub repository: https://github.com/eclipse-ee4j/glassfish
- Jakarta EE Platform 10 Specification: https://jakarta.ee/specifications/platform/10/
- Jakarta EE Platform 11 Specification: https://jakarta.ee/specifications/platform/11/
- Jakarta EE 9 Platform Specification, namespace compatibility section: https://jakarta.ee/specifications/platform/9/jakarta-platform-spec-9.html
- OpenRewrite javax to jakarta migration recipe: https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

---

# Status Series

Seri belum selesai.

- Part 0: selesai.
- Part 1: selesai.
- Berikutnya: **Part 2 — Installation, Distribution Layout, dan Runtime Anatomy**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-000.md">⬅️ Part 0 — Orientation: GlassFish sebagai Runtime Enterprise, Bukan Sekadar Server Jakarta EE</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-002.md">Part 2 — Installation, Distribution Layout, dan Runtime Anatomy ➡️</a>
</div>
