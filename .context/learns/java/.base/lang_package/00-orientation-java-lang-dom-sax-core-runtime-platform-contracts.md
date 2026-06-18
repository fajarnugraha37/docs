# Part 0 — Orientation: Why `java.lang`, DOM, and SAX Still Matter in Modern Java

**Series:** `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
**File:** `00-orientation-java-lang-dom-sax-core-runtime-platform-contracts.md`  
**Target Java:** Java 8 sampai Java 25  
**Focus packages:** `java.lang.*`, `org.w3c.dom.*`, `org.xml.sax.*`  
**Related modules:** `java.base`, `java.xml`, dan sedikit boundary ke `jdk.xml.dom`

---

## 1. Tujuan Part Ini

Part 0 bukan daftar API biasa. Ini adalah peta berpikir sebelum masuk ke detail. Tujuannya adalah membuat kamu melihat tiga area ini sebagai **kontrak platform**, bukan sekadar package yang kebetulan ada di JDK.

Kita akan membangun orientasi terhadap:

1. kenapa `java.lang` adalah pusat gravitasi Java runtime;
2. kenapa DOM dan SAX masih relevan walaupun sekarang banyak orang memakai Jackson, JAXB, StAX, atau framework integration;
3. bagaimana membedakan bahasa Java, JVM, Java SE API, JDK implementation, dan library/framework;
4. bagaimana Java 8 sampai 25 mengubah cara kita membaca API lama;
5. bagaimana membaca Java API specification seperti engineer senior, bukan sekadar seperti pemakai method;
6. apa saja batas seri ini supaya tidak mengulang seri sebelumnya;
7. mental model besar yang akan dipakai di seluruh part berikutnya.

Setelah part ini, kamu harus punya jawaban kuat untuk pertanyaan:

> “Kenapa saya perlu belajar `java.lang`, DOM, dan SAX secara advance, padahal saya sudah bisa membuat aplikasi Java enterprise?”

Jawabannya: karena package-package ini adalah **kontrak rendah** yang menjadi dasar banyak keputusan framework, runtime, compatibility, memory, parsing, observability, dan failure handling. Banyak bug production yang terlihat seperti bug framework sebenarnya berasal dari salah memahami kontrak dasar ini.

---

## 2. Posisi `java.lang`, DOM, dan SAX dalam Platform Java

### 2.1 `java.lang` adalah package yang terlihat sederhana tetapi paling fundamental

Di Java, package `java.lang` otomatis di-import oleh compiler. Karena otomatis tersedia, banyak developer menganggapnya “basic”. Ini asumsi yang berbahaya.

`java.lang` berisi class dan interface yang langsung membentuk cara program Java hidup:

- `Object` menentukan identitas, equality, hashing, monitor, lifecycle legacy;
- `Class` menentukan representasi tipe di runtime;
- `String` menentukan representasi teks paling umum di seluruh aplikasi;
- primitive wrapper menentukan boxing, parsing, numeric boundary, cache, dan identity trap;
- `Enum`, `Record`, annotation compiler contracts, dan sealed runtime metadata membentuk model bahasa modern;
- `Throwable`, `Exception`, `RuntimeException`, dan `Error` menentukan failure semantics;
- `System`, `Runtime`, `Process`, `ProcessBuilder`, `ProcessHandle` menjadi boundary ke OS/runtime environment;
- `Thread`, `ThreadLocal`, `InheritableThreadLocal`, `StackTraceElement`, `StackWalker` menjadi boundary execution dan observability;
- `ClassLoader`, `Package`, `Module`, `ModuleLayer` menjadi boundary loading dan encapsulation.

Dengan kata lain: `java.lang` bukan “kumpulan class dasar”. `java.lang` adalah **permukaan kontrak antara source code Java, compiler, JVM, operating system, module system, dan application framework**.

### 2.2 DOM adalah model tree dokumen XML

`org.w3c.dom` menyediakan interface Document Object Model. DOM melihat dokumen XML sebagai **mutable in-memory tree**.

Mental model DOM:

```text
XML bytes/text
   ↓ parse
Document
   ↓
Node tree
   ├── Element
   ├── Attr
   ├── Text
   ├── Comment
   ├── CDATASection
   └── ...
```

DOM cocok ketika kamu butuh:

- random access ke banyak bagian dokumen;
- modifikasi dokumen;
- membaca elemen dalam urutan tidak linear;
- bekerja dengan dokumen kecil-menengah;
- membangun XML output dengan struktur yang jelas;
- interoperabilitas dengan API lama yang berbasis DOM.

DOM tidak cocok ketika:

- dokumen sangat besar;
- kamu hanya butuh streaming extraction;
- memory footprint harus sangat kecil;
- data bisa diproses satu event demi satu event;
- kamu tidak perlu memodifikasi tree.

Kesalahan umum developer adalah menganggap DOM seperti object graph domain. DOM bukan domain model. DOM adalah **representasi syntactic tree** dari XML. Ia membawa detail yang kadang tidak kamu pikirkan: namespace, prefix, whitespace text node, attribute node, owner document, live `NodeList`, normalization, dan implementasi parser.

### 2.3 SAX adalah model event streaming

`org.xml.sax` menyediakan API parsing berbasis event. SAX melihat XML sebagai stream event yang dipush oleh parser ke handler.

Mental model SAX:

```text
XML bytes/text
   ↓ parser reads sequentially
startDocument()
startElement(...)
characters(...)
endElement(...)
endDocument()
```

SAX cocok ketika:

- dokumen besar;
- kamu ingin memproses data secara sequential;
- kamu tidak perlu menyimpan seluruh dokumen;
- kamu ingin membangun state machine parsing;
- kamu butuh performa dan memory footprint lebih terkendali dibanding DOM.

SAX sulit ketika:

- kamu butuh akses acak ke node lain;
- kamu butuh modifikasi dokumen;
- struktur XML kompleks dan butuh banyak konteks lintas level;
- developer belum disiplin membangun state machine;
- kamu salah memahami bahwa `characters()` bisa dipanggil berkali-kali untuk satu blok teks.

DOM dan SAX adalah dua kutub:

| Aspek | DOM | SAX |
|---|---|---|
| Model | Tree | Event stream |
| Memory | Tinggi, karena seluruh dokumen ditahan | Rendah, karena sequential |
| Akses | Random access | Forward-only |
| Mutasi | Bisa | Tidak langsung |
| Kompleksitas state | Lebih rendah untuk dokumen kecil | Lebih tinggi, perlu state machine |
| Cocok untuk | Small/medium structured document | Large sequential import/extract |
| Risiko utama | Memory blow-up, namespace/whitespace trap | State bug, text fragmentation, context loss |

---

## 3. Bahasa Java, JVM, Java SE API, JDK, dan Framework: Jangan Dicampur

Engineer yang kuat harus bisa memisahkan layer. Banyak kebingungan Java muncul karena semua disebut “Java”, padahal maksudnya berbeda.

### 3.1 Bahasa Java

Bahasa Java adalah syntax dan semantic source-level:

- class;
- interface;
- enum;
- record;
- sealed class;
- lambda;
- switch expression;
- pattern matching;
- exception syntax;
- generics syntax;
- annotation syntax;
- primitive types;
- statement dan expression rules.

Contoh:

```java
record UserId(String value) {}
```

Ini fitur bahasa. Namun begitu dikompilasi, record juga punya representasi runtime melalui class `java.lang.Record`, metadata di `Class`, generated methods, dan bytecode attributes.

### 3.2 JVM

JVM adalah mesin eksekusi bytecode:

- class loading;
- bytecode verification;
- linking;
- initialization;
- execution;
- heap;
- stack;
- method area/metaspace;
- GC;
- threads;
- monitors;
- exceptions;
- JIT compilation.

Contoh:

```java
String s = "hello";
```

Ini terlihat seperti bahasa Java sederhana, tetapi melibatkan string literal, constant pool, class loading, object reference, dan runtime representation.

### 3.3 Java SE API

Java SE API adalah kumpulan package standard yang dispesifikasikan sebagai bagian dari platform.

Contoh:

- `java.lang`;
- `java.util`;
- `java.io`;
- `java.nio`;
- `java.xml` packages;
- `javax.xml.parsers`;
- `org.w3c.dom`;
- `org.xml.sax`.

API specification menjelaskan contract yang bisa diandalkan oleh program portable.

### 3.4 JDK implementation

JDK adalah implementasi dari Java SE plus tooling dan implementation-specific APIs.

Contoh:

- `javac`;
- `javadoc`;
- `jar`;
- `jlink`;
- `jcmd`;
- HotSpot VM;
- default XML parser implementation;
- internal packages;
- implementation-specific behavior.

Hal penting: sesuatu bisa **terjadi** di JDK tertentu tetapi bukan **kontrak portable**. Top engineer membedakan keduanya.

Contoh:

```java
System.out.println(System.getProperty("java.vm.name"));
```

Ini bisa menghasilkan “OpenJDK 64-Bit Server VM”, “Java HotSpot(TM) 64-Bit Server VM”, atau variant lain. Jangan desain business logic berdasarkan detail seperti ini kecuali memang ada runtime compatibility layer.

### 3.5 Framework/library

Framework seperti Spring, Hibernate, Jakarta EE, Jackson, Maven plugin, application server, dan XML binding library berada di atas Java SE/JDK.

Mereka sering memakai kontrak `java.lang` dan XML API di bawahnya:

- Spring memakai `Class`, `ClassLoader`, annotation, reflection, `Throwable`, `ThreadLocal`, `System` properties;
- Hibernate bergulat dengan equality, proxies, class metadata, enum persistence, record support;
- logging/tracing memakai stack trace, thread name, ThreadLocal/MDC;
- XML parsers/framework memakai DOM/SAX/JAXP factory;
- application server memakai classloader/module boundary;
- security hardening memakai XML parser features, entity resolver, system properties, dan module access.

Ketika kamu memahami layer rendah, kamu lebih mudah mendiagnosis bug framework.

---

## 4. Module View: `java.base`, `java.xml`, dan `jdk.xml.dom`

Sejak Java 9, Java Platform memiliki module system. Ini penting karena package tidak lagi hanya dilihat sebagai namespace, tetapi juga sebagai bagian dari module yang punya readability/export/encapsulation.

### 4.1 `java.base`

`java.lang` berada di module `java.base`.

`java.base` adalah module fundamental yang selalu tersedia. Kamu tidak perlu menambahkan `requires java.base;` karena semua module secara implisit bergantung padanya.

Mental model:

```text
Every Java program
    ↓ implicit dependency
java.base
    ↓ contains
java.lang
```

Implikasi:

- `java.lang` adalah bagian paling dasar dari Java runtime;
- class seperti `Object`, `String`, `Class`, `Throwable`, `System`, `Runtime`, `Thread` bukan optional;
- perubahan di area ini sangat sensitif terhadap backward compatibility;
- desain API di sini cenderung konservatif karena dampaknya luas.

### 4.2 `java.xml`

`org.w3c.dom` dan `org.xml.sax` berada di module `java.xml` dalam Java modern. Module `java.xml` mendefinisikan API untuk JAXP, StAX, SAX, dan W3C DOM.

Mental model:

```text
module java.xml
    ├── javax.xml
    ├── javax.xml.parsers
    ├── javax.xml.stream
    ├── javax.xml.transform
    ├── javax.xml.validation
    ├── org.w3c.dom
    ├── org.w3c.dom.ls
    ├── org.xml.sax
    ├── org.xml.sax.ext
    └── org.xml.sax.helpers
```

Dalam aplikasi module-aware, kamu perlu:

```java
module my.app {
    requires java.xml;
}
```

Kalau aplikasi masih classpath-based, module boundary biasanya tidak terasa langsung, tetapi tetap relevan untuk runtime image, jlink, strong encapsulation, dan deployment modern.

### 4.3 `jdk.xml.dom`

Ada juga module `jdk.xml.dom` yang berisi subset W3C DOM API yang bukan bagian dari Java SE API, seperti beberapa API DOM CSS/HTML/XPath tertentu. Karena prefix-nya `jdk.*`, kamu harus memperlakukannya dengan lebih hati-hati dibanding `java.xml`.

Rule praktis:

- gunakan `java.xml` sebagai baseline portable Java SE;
- gunakan `jdk.xml.dom` hanya jika benar-benar perlu dan kamu memahami portability cost;
- jangan desain core domain/business logic bergantung pada non-SE API tanpa alasan kuat.

---

## 5. Kenapa Seri Ini Advance, Bukan Basic

Belajar `java.lang` secara basic biasanya berhenti di:

- `String` immutable;
- `Object.equals` dan `hashCode`;
- exception checked/unchecked;
- wrapper class;
- enum;
- `System.out.println`;
- `Thread` basic;
- `Class` untuk reflection sederhana.

Belajar DOM/SAX secara basic biasanya berhenti di:

- parse XML;
- ambil element by tag name;
- handler SAX sederhana;
- build document;
- print XML.

Seri ini tidak berhenti di sana. Seri ini akan menekankan:

1. **contract thinking**  
   Apa yang dijamin API? Apa yang hanya kebetulan implementation?

2. **runtime thinking**  
   Apa dampaknya ke class loading, initialization, stack, thread, module, OS process, memory, dan failure?

3. **evolution thinking**  
   Bagaimana API ini berubah dari Java 8 ke 25? Apa yang deprecated? Apa yang modern? Apa yang harus tetap compatible?

4. **failure modelling**  
   Bug apa yang muncul kalau kontrak disalahpahami?

5. **production design**  
   Bagaimana memakai API dasar ini dalam sistem besar, bukan hanya contoh tutorial?

6. **security and operability**  
   Bagaimana XML parsing bisa menjadi SSRF/file disclosure? Bagaimana stack trace dan exception message membantu atau merusak observability?

7. **API boundary design**  
   Kapan memakai `String` vs `CharSequence`, enum vs sealed type, record vs entity, DOM vs SAX?

---

## 6. Peta Java 8 sampai Java 25 untuk Seri Ini

Seri ini menargetkan Java 8 hingga Java 25. Karena rentangnya panjang, kita harus membedakan:

- API yang ada sejak lama dan stabil;
- API yang muncul setelah Java 8;
- API yang deprecated;
- API yang behavior-nya berubah karena module system;
- API yang secara desain sebaiknya dihindari untuk sistem modern.

### 6.1 Java 8 sebagai baseline lama

Java 8 masih penting karena banyak enterprise system lama masih memakai Java 8 atau masih mempertahankan compatibility ke Java 8.

Ciri dunia Java 8:

- belum ada module system;
- reflection ke internal JDK masih sering dilakukan library lama;
- `java.lang` belum punya beberapa API modern seperti `StackWalker`, `ProcessHandle`, `Runtime.Version`, `Module`, `Record`;
- lambda dan functional interface sudah ada;
- PermGen sudah digantikan Metaspace sejak Java 8;
- banyak XML hardening pattern sudah relevan, tetapi default dan limits perlu dipahami.

### 6.2 Java 9 sebagai perubahan besar platform

Java 9 memperkenalkan module system.

Dampak ke seri ini:

- `java.lang.Module` muncul;
- `Class#getModule()` relevan;
- module readability/export/open mempengaruhi reflection/framework;
- `Runtime.Version` muncul untuk version parsing modern;
- `ProcessHandle` muncul untuk process lifecycle modern;
- `StackWalker` muncul sebagai API stack walking modern;
- strong encapsulation mulai mengubah kebiasaan memakai internal API;
- jlink/runtime image menjadi lebih relevan.

### 6.3 Java 10–16: modernisasi bertahap

Beberapa hal yang relevan:

- `var` di source level, walau bukan `java.lang` API;
- improvements pada `String` dan runtime;
- records diperkenalkan sebagai preview lalu final di Java 16;
- helpful NullPointerException hadir di Java 14;
- sealed classes berkembang menuju final di Java 17.

### 6.4 Java 17 sebagai LTS besar

Java 17 penting karena banyak organisasi pindah dari Java 8/11 ke Java 17.

Relevansi:

- sealed classes final;
- Security Manager deprecated for removal;
- records sudah final;
- module system sudah matang secara ekosistem;
- banyak library enterprise mulai menjadikan Java 17 sebagai baseline modern.

### 6.5 Java 21 sebagai LTS modern

Java 21 penting karena virtual threads menjadi final. Walaupun virtual threads lebih besar dari `java.lang`, class `Thread` tetap menjadi permukaan API-nya.

Relevansi:

- `Thread` tidak lagi identik dengan expensive platform thread;
- `ThreadLocal` usage perlu dievaluasi ulang;
- stack/observability perlu sadar virtual thread;
- structured concurrency masih bukan fokus utama seri ini, tetapi boundary-nya akan disebut ketika relevan.

### 6.6 Java 24 dan Security Manager disabled trajectory

Security Manager sudah deprecated for removal sejak Java 17 melalui JEP 411. JEP 486 kemudian mengambil langkah berikutnya: Security Manager permanently disabled. Ini relevan karena banyak API `java.lang.System`, `Runtime`, class loading, dan XML/network/file assumptions di masa lalu pernah dikaitkan dengan security manager checks.

Mental model modern:

- jangan mengandalkan Security Manager untuk sandboxing aplikasi server modern;
- gunakan OS/container boundary, process isolation, module encapsulation, dependency hygiene, permission model platform, dan explicit validation;
- XML parser hardening tetap wajib dilakukan di level parser/factory, bukan berharap runtime sandbox menyelamatkan.

### 6.7 Java 25 sebagai target terbaru seri

Java 25 adalah release Java SE 25/JDK 25 dan telah mencapai General Availability pada 16 September 2025. Untuk seri ini, Java 25 dipakai sebagai horizon terbaru agar materi tidak berhenti di Java 17/21.

Namun prinsip compatibility tetap:

- jika membangun library yang harus support Java 8, jangan langsung memakai API Java 9+ tanpa strategy;
- jika membangun aplikasi modern Java 21/25, jangan membatasi diri dengan pola Java 8 yang sudah usang;
- bedakan source compatibility, binary compatibility, dan runtime compatibility.

---

## 7. Cara Membaca API Spec seperti Top Engineer

Banyak developer membaca API spec hanya untuk mencari method. Engineer yang lebih matang membaca API spec untuk menemukan **kontrak**.

Saat membaca class/interface Java SE, tanyakan hal-hal berikut.

### 7.1 Apa status API ini?

Pertanyaan:

- apakah public Java SE API?
- apakah JDK-specific?
- apakah deprecated?
- apakah deprecated for removal?
- sejak versi berapa?
- ada replacement?
- ada behavior yang berubah antar versi?

Contoh:

- `Object.finalize()` historically ada, tetapi finalization adalah legacy dan berbahaya;
- Security Manager terkait `java.lang` sudah deprecated/disabled trajectory;
- SAX1 APIs masih ada tetapi sebagian deprecated untuk mendorong namespace-aware design;
- `java.lang.Module` tidak ada di Java 8.

### 7.2 Apa guarantee-nya?

Contoh pada `Object.equals`:

- reflexive;
- symmetric;
- transitive;
- consistent;
- `x.equals(null)` harus false.

Kalau kamu melanggar ini, bug bisa muncul di `HashMap`, `HashSet`, cache, ORM, dan deduplication logic.

### 7.3 Apa yang tidak dijamin?

Top engineer juga membaca “ruang kosong” dalam spec.

Contoh:

- `ClassLoader` order/detail tertentu tidak selalu cocok antar container;
- DOM implementation dapat berbeda pada feature support tertentu;
- SAX parser feature bisa unsupported;
- environment variables tidak dimaksudkan sebagai mutable runtime config;
- stack trace shape bukan API bisnis yang stabil;
- `Thread` priority bukan guarantee scheduling portable.

### 7.4 Apa side effect-nya?

Contoh:

- `Class.forName("x.y.Z")` bisa memicu class initialization jika memakai overload tertentu;
- `System.setProperty` mengubah global JVM state;
- `ProcessBuilder.start()` membuat OS process;
- DOM parsing bisa membaca external entity jika tidak di-hardening;
- `Throwable` creation bisa capture stack trace dan mahal;
- `String.intern()` masuk ke string pool dan bisa berdampak memory.

### 7.5 Apa failure mode-nya?

Setiap API penting harus dibaca dengan mode:

> “Bagaimana API ini rusak di production?”

Contoh:

- `Integer == Integer` tampak benar di test kecil karena cache, lalu gagal di data besar;
- `ThreadLocal` menyimpan user context dan bocor antar request di thread pool;
- DOM `NodeList` live membuat loop mutation salah;
- SAX `characters()` dipanggil beberapa kali sehingga text hilang/terduplikasi;
- `getElementsByTagName("id")` salah ketika namespace aktif;
- `System.currentTimeMillis()` dipakai untuk latency measurement lalu kacau saat clock berubah;
- `Process` output tidak dibaca sehingga child process deadlock.

### 7.6 Apa hubungan API ini dengan compatibility?

Contoh:

- enum ordinal tidak boleh dipersist karena urutan constant bisa berubah;
- record component public API sulit diubah tanpa breaking callers;
- exception checked mempengaruhi method signature;
- module exports/opens mempengaruhi framework reflective access;
- XML namespace handling mempengaruhi interoperability antar partner.

### 7.7 Apa implementation note yang perlu diperhatikan?

Javadoc sering punya bagian:

- API Note;
- Implementation Note;
- Since;
- Deprecated;
- Throws;
- Security Exception notes;
- Null handling;
- Thread-safety statement;
- mutability statement.

Jangan lewati bagian ini.

---

## 8. Batas Cakupan Seri Ini

Seri ini intentionally sempit pada package, tetapi dalam pada pemahaman.

### 8.1 Yang dibahas dalam seri ini

Area `java.lang`:

- object identity dan equality;
- runtime type metadata;
- strings dan text boundary;
- primitive wrapper dan numeric edge cases;
- enum/record/sealed runtime view;
- exception/error taxonomy;
- system/runtime/process boundary;
- thread-related API dari sudut `java.lang`;
- stack trace dan stack walker;
- class loader/package/module/layer;
- annotations compiler contracts;
- lambda runtime support boundary;
- cleaner/class-attached metadata;
- Java 8–25 compatibility strategy.

Area DOM:

- document tree mental model;
- node identity dan ownership;
- mutation semantics;
- namespace handling;
- traversal/querying;
- DOM Level 3 concepts;
- DOM implementation portability;
- secure DOM parsing.

Area SAX:

- event parsing mental model;
- handler contract;
- namespace-aware parsing;
- features/properties;
- entity resolution;
- DTD handling;
- secure SAX parsing;
- state machine extraction;
- large document processing.

### 8.2 Yang tidak diulang panjang

Agar efisien, seri ini tidak akan mengulang secara panjang:

- Java syntax dasar;
- OOP basic;
- collection/stream API;
- concurrency primitives secara lengkap;
- reactive programming;
- memory/GC full course;
- reflection full course;
- JDBC/persistence;
- Jakarta EE integration;
- JAX-RS;
- JAXB/Jakarta XML Binding;
- Jackson XML;
- full XML Schema/XPath/XSLT course;
- security/cryptography umum.

Namun topik tersebut bisa disebut singkat ketika menjadi boundary.

Contoh:

- `ThreadLocal` dibahas bukan sebagai concurrency course, tetapi sebagai `java.lang` runtime context hazard;
- XPath disebut hanya sebagai boundary dari DOM querying;
- StAX disebut hanya sebagai pembanding SAX/DOM;
- JAXB disebut hanya untuk menjelaskan kapan DOM/SAX bukan pilihan terbaik;
- GC disebut hanya ketika `String`, `Throwable`, DOM tree, atau `ThreadLocal` berdampak memory.

---

## 9. Mental Model Besar Seri Ini

Untuk menghindari belajar API secara acak, kita akan memakai beberapa mental model berulang.

### 9.1 Contract vs implementation

Hal pertama: bedakan kontrak dan implementasi.

```text
Contract:
  Apa yang dijanjikan API/spec.

Implementation:
  Cara JDK tertentu mewujudkannya.
```

Contoh:

- Kontrak `String` adalah immutable sequence of characters; internal compact string representation adalah implementation detail;
- kontrak `equals/hashCode` adalah logical equality; implementasi hash tertentu tidak boleh dijadikan business guarantee;
- kontrak DOM `NodeList` bisa live; implementasi traversal internal bukan urusan caller;
- kontrak SAX `characters()` bisa dipanggil berkali-kali; parser tidak wajib mengirim seluruh text sebagai satu event.

Rule:

> Build design on contracts. Optimize only with implementation knowledge that you can safely isolate.

### 9.2 Identity vs value

Java penuh dengan jebakan identity vs value.

Identity:

```java
x == y
```

Menjawab: apakah dua reference menunjuk object yang sama?

Value/logical equality:

```java
x.equals(y)
```

Menjawab: apakah dua object dianggap sama menurut domain/contract?

Contoh perbedaan:

- dua `String` berbeda object tetapi isi sama;
- dua `Integer` bisa tampak `==` untuk nilai kecil karena cache;
- enum constant aman dibandingkan dengan `==` karena singleton per constant;
- DOM `Node` identity penting karena node adalah posisi dalam tree;
- record equality berbasis component;
- entity persistence sering punya equality problem karena lifecycle/proxy/ID.

Top engineer tidak asal override `equals`. Ia bertanya:

- object ini value object atau entity?
- equality-nya berdasarkan apa?
- apakah field mutable?
- apakah class final?
- apakah ada proxy/subclass?
- apakah hash stabil selama object berada di map/set?

### 9.3 Type at compile time vs type at runtime

Java punya static type dan runtime type.

```java
CharSequence x = "hello";
```

Compile-time type: `CharSequence`  
Runtime type: `String`

`java.lang.Class` adalah pintu ke runtime type metadata.

Ini penting untuk:

- DI container;
- serializers;
- mappers;
- plugin systems;
- reflection;
- class loading;
- module access;
- generic erasure;
- safe casting;
- sealed/record/enum detection.

Failure mode umum:

```java
if (clazz.isAssignableFrom(String.class)) { ... }
```

Banyak developer membalik arah `isAssignableFrom`. Seri ini akan melatih membaca relasi type dengan benar.

### 9.4 Object lifecycle vs resource lifecycle

Java object lifecycle tidak sama dengan resource lifecycle.

Object lifecycle:

```text
allocated → reachable/unreachable → garbage collected
```

Resource lifecycle:

```text
opened/acquired → used → closed/released
```

Kesalahan klasik:

- mengandalkan finalizer/cleaner untuk menutup file/socket/process;
- lupa membaca process stream;
- menyimpan DOM besar terlalu lama;
- ThreadLocal menahan object setelah request selesai;
- exception object menyimpan cause/suppressed/stack besar;
- class loader tidak bisa GC karena static cache.

Rule:

> GC mengurus memory object. GC tidak otomatis mengurus correctness resource lifecycle.

### 9.5 Global state is architecture debt

`System`, properties, environment, default locale, default charset, timezone, standard streams, security manager setting, classloader context, dan system-level XML properties adalah contoh global/semi-global state.

Global state berguna tetapi berbahaya.

Pertanyaan desain:

- siapa yang boleh membaca?
- siapa yang boleh mengubah?
- kapan dibaca?
- apakah dibaca saat class initialization?
- apakah test bisa mengisolasi?
- apakah behavior berubah antar environment?
- apakah tenant/request/user context bocor?

Contoh buruk:

```java
public final class Config {
    static final String REGION = System.getenv("REGION");
}
```

Ini membaca environment saat class initialization. Dalam test atau dynamic runtime, perubahan environment/config tidak akan terlihat. Ini mungkin benar untuk beberapa sistem, tetapi harus disadari sebagai pilihan desain.

### 9.6 Failure taxonomy

Tidak semua failure sama.

Kita akan membedakan:

```text
Domain rejection
  contoh: status case tidak boleh berubah dari CLOSED ke DRAFT.

Validation failure
  contoh: field mandatory kosong.

Programming error
  contoh: NullPointerException karena invariant internal rusak.

Environmental failure
  contoh: file tidak ada, process gagal, config missing.

Platform/runtime failure
  contoh: OutOfMemoryError, LinkageError, NoClassDefFoundError.

Security failure
  contoh: XML external entity mencoba baca local file.
```

Exception taxonomy yang buruk membuat sistem sulit dioperasikan:

- semua jadi `RuntimeException`;
- semua di-log sebagai ERROR;
- semua di-retry;
- cause hilang;
- stack trace dipotong;
- message tidak punya context;
- sensitive data bocor ke log.

### 9.7 Tree vs stream XML processing

DOM dan SAX mewakili dua cara berpikir yang berbeda.

DOM:

```text
I need the document as a navigable mutable structure.
```

SAX:

```text
I need to react to parsing events and maintain only the state I need.
```

Pilihan parser bukan soal “mana lebih modern”, tetapi soal shape workload.

Pertanyaan desain XML:

- ukuran dokumen berapa?
- perlu random access atau sequential processing?
- perlu mutation atau hanya extraction?
- perlu validation?
- perlu preserve whitespace/comment/CDATA?
- apakah namespace penting?
- apakah input trusted?
- apakah error perlu dilaporkan dengan line/column?
- apakah parsing sebagian boleh commit sebagian?
- apakah output harus canonical/stable?

### 9.8 Namespace is identity, prefix is syntax

Dalam XML, namespace URI adalah bagian dari identity element/attribute. Prefix hanyalah alias di dokumen.

Dua dokumen ini secara namespace bisa ekuivalen:

```xml
<a:case xmlns:a="urn:case">...</a:case>
```

```xml
<x:case xmlns:x="urn:case">...</x:case>
```

Kalau code kamu mencari prefix `a`, code itu rapuh. Yang benar biasanya mencari namespace URI dan local name.

Rule:

> In namespace-aware XML processing, do not treat prefix as business identity.

### 9.9 Secure by parser configuration, not by hope

XML parser harus di-hardening secara eksplisit.

Threat model XML:

- XXE local file disclosure;
- SSRF via external entity;
- DTD fetching;
- entity expansion bomb;
- huge document memory blow-up;
- namespace confusion;
- schema location abuse;
- malicious error/log payload.

Rule:

> XML input from outside your trust boundary is hostile until proven otherwise.

---

## 10. Cara Memilih API: Practical Decision Matrix

### 10.1 DOM vs SAX vs StAX vs JAXB/Jackson

Walaupun seri ini fokus DOM/SAX, kamu perlu tahu kapan tidak memakai keduanya.

| Kebutuhan | Pilihan biasanya | Alasan |
|---|---|---|
| Dokumen kecil, butuh random access/mutasi | DOM | Tree mudah dinavigasi dan dimodifikasi |
| Dokumen besar, extraction sequential | SAX | Memory rendah, event-driven |
| Dokumen besar, ingin pull-based parser | StAX | Caller mengontrol pembacaan |
| XML terstruktur kuat menjadi object | JAXB/Jackson XML | Mapping object lebih produktif |
| Perlu transform XML | XSLT/Transformer | Bukan fokus seri ini |
| Perlu query kompleks | XPath | Boundary dari DOM, bukan fokus utama |
| Perlu exact low-level control | SAX/custom | Handler/state machine eksplisit |

Rule:

> Jangan memakai DOM hanya karena mudah kalau dokumen bisa besar. Jangan memakai SAX hanya karena memory rendah kalau state machine-nya membuat correctness rapuh.

### 10.2 `String` vs richer type

Kalau data punya makna domain, jangan selalu berhenti di `String`.

Contoh buruk:

```java
void approve(String caseId, String userId, String reason)
```

Lebih kuat:

```java
record CaseId(String value) {}
record UserId(String value) {}
record ApprovalReason(String value) {}

void approve(CaseId caseId, UserId userId, ApprovalReason reason)
```

Namun jangan over-engineer semua hal. Gunakan richer type ketika:

- salah tukar parameter berbahaya;
- format/validasi penting;
- value muncul di banyak boundary;
- logging/masking berbeda;
- equality/canonicalization penting.

### 10.3 Enum vs String code vs sealed type

Gunakan enum ketika:

- daftar nilai finite dan relatif stabil;
- representasi internal type-safe penting;
- compile-time exhaustiveness membantu;
- identity constant jelas.

Gunakan external code mapping ketika:

- nilai datang dari partner/API/database;
- kode eksternal tidak boleh sama dengan nama enum;
- compatibility rename diperlukan.

Gunakan sealed hierarchy ketika:

- setiap variant punya payload/behavior berbeda;
- state modelling lebih kaya dari daftar constant;
- exhaustive handling penting;
- domain transition kompleks.

### 10.4 Exception checked vs unchecked

Pertanyaan desain:

- apakah caller bisa recover secara meaningful?
- apakah exception bagian dari normal business alternative?
- apakah method signature akan menjadi noise?
- apakah failure environmental dan perlu propagated?
- apakah ini programming error?

Rule praktis:

- domain rejection bisa menjadi checked/unchecked tergantung architecture;
- validation sering lebih baik sebagai result/problem details, bukan exception untuk flow biasa;
- programming error biasanya unchecked;
- environmental failure bisa checked di low-level API, lalu diterjemahkan di boundary;
- jangan kehilangan cause.

### 10.5 `System.currentTimeMillis()` vs `System.nanoTime()`

Gunakan:

- `currentTimeMillis()` untuk wall-clock timestamp kasar;
- `nanoTime()` untuk elapsed duration measurement.

Jangan ukur latency dengan wall-clock jika butuh akurasi duration, karena wall clock bisa berubah akibat NTP/time adjustment.

---

## 11. Reading Path untuk Part Berikutnya

Seri ini disusun dari core runtime menuju XML processing.

### 11.1 Fase 1 — Root runtime contracts

Part 1–7:

- `java.lang` sebagai root platform;
- `Object`;
- `Class`;
- `String`;
- `CharSequence`/builders;
- wrappers/numeric;
- `Boolean`/`Character`.

Tujuannya: memahami object, type, text, dan primitive boundary.

### 11.2 Fase 2 — Language-level runtime constructs

Part 8–10:

- enum;
- record;
- sealed type runtime view.

Tujuannya: memahami fitur bahasa modern sebagai runtime contract dan design tool.

### 11.3 Fase 3 — Failure and environment contracts

Part 11–20:

- throwable;
- exception/error taxonomy;
- system;
- runtime/process;
- thread/threadlocal;
- stack walker;
- classloader/package/module/layer;
- runtime version;
- global state;
- math/floating point.

Tujuannya: memahami production boundary, operability, compatibility, dan platform behavior.

### 11.4 Fase 4 — Compiler/runtime support contracts

Part 21–23:

- java.lang annotations;
- lambda runtime support boundary;
- class-attached metadata dan cleanup.

Tujuannya: memahami metadata, compiler contract, dan framework-adjacent runtime behavior.

### 11.5 Fase 5 — DOM/SAX XML contracts

Part 24–31:

- DOM mental model;
- DOM mutation/querying/Level 3;
- SAX mental model;
- SAX namespace/features/entity;
- secure XML parsing;
- advanced XML processing patterns.

Tujuannya: bisa memilih, mengamankan, dan mendesain XML processing dengan benar.

### 11.6 Fase 6 — Capstone

Part 32:

- production-grade runtime/XML utility layer;
- compatibility matrix Java 8/11/17/21/25;
- parser hardening factory;
- process executor;
- runtime info collector;
- exception taxonomy;
- checklist.

Tujuannya: mengikat semua konsep menjadi design yang bisa dipakai.

---

## 12. Java 8–25 Compatibility Mindset

Saat menulis code/library yang harus hidup di rentang Java 8–25, kamu perlu strategi.

### 12.1 Source compatibility

Source compatibility berarti source code bisa dikompilasi dengan compiler target tertentu.

Contoh:

```java
record UserId(String value) {}
```

Ini tidak source-compatible dengan Java 8 karena record belum ada.

### 12.2 Binary compatibility

Binary compatibility berarti artifact yang sudah dikompilasi tetap bisa dipakai oleh caller lama/baru tanpa recompilation tertentu.

Contoh perubahan yang bisa breaking:

- mengubah method signature;
- menghapus enum constant yang dipakai caller;
- mengubah class menjadi sealed dengan permits terbatas;
- mengubah checked exception declaration;
- mengubah package/module export.

### 12.3 Runtime compatibility

Runtime compatibility berarti artifact bisa berjalan di runtime tertentu.

Contoh:

- class yang dikompilasi untuk Java 21 tidak bisa dijalankan di Java 8;
- code yang langsung refer `java.lang.Record` tidak bisa run di Java 8;
- code yang memakai `StackWalker` perlu Java 9+;
- code module-aware perlu memperhatikan module path;
- XML parser feature mungkin berbeda antar implementation/runtime.

### 12.4 Multi-version strategy

Jika perlu support Java 8 dan Java modern:

1. tentukan baseline minimal;
2. isolasi API modern di class terpisah;
3. gunakan reflection hanya untuk optional compatibility dengan hati-hati;
4. pertimbangkan multi-release JAR untuk library;
5. buat test matrix;
6. jangan hanya test di satu JDK vendor/version;
7. dokumentasikan behavior difference.

### 12.5 Jangan membawa semua constraint lama ke sistem baru

Kalau aplikasi targetnya Java 21/25, jangan otomatis menulis semua code seolah Java 8.

Gunakan modern API ketika memberi value:

- records untuk data carrier yang jelas;
- sealed types untuk finite domain alternatives;
- `ProcessHandle` untuk process management;
- `StackWalker` untuk stack inspection;
- `Runtime.Version` untuk parsing version;
- `String` modern methods;
- virtual-thread-aware thinking untuk `ThreadLocal`.

Tetapi tetap desain dengan migration cost dan team maturity.

---

## 13. Production Failure Stories yang Akan Kita Hindari

Bagian ini sengaja praktis. Banyak bug production terlihat “aneh” sampai kamu kaitkan dengan kontrak dasar.

### 13.1 Broken equality membuat cache dan dedup kacau

Contoh:

```java
final class CaseKey {
    private final String agency;
    private final String caseNo;

    // equals uses agency only, hashCode uses agency + caseNo
}
```

Akibat:

- `HashMap` lookup gagal;
- duplicate detection salah;
- cache miss misterius;
- behavior tergantung bucket distribution.

Root cause: melanggar contract `equals/hashCode`.

### 13.2 Mutable key di `HashMap`

```java
Map<RequestKey, Result> cache = new HashMap<>();
RequestKey key = new RequestKey("A", "001");
cache.put(key, result);
key.setCaseNo("002");
cache.get(key); // bisa gagal
```

Root cause: hash berubah setelah object masuk map.

### 13.3 `Integer == Integer` tampak benar di dev, salah di prod

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b); // often true due to cache

Integer x = 1000;
Integer y = 1000;
System.out.println(x == y); // false
```

Root cause: wrapper identity bukan value equality.

### 13.4 `ThreadLocal` bocor antar request

```java
CURRENT_USER.set(user);
// lupa remove()
```

Pada thread pool, thread yang sama dipakai request lain. User context bisa bocor.

Root cause: menyamakan lifecycle request dengan lifecycle thread.

### 13.5 Stack trace dipakai sebagai business logic

```java
String caller = Thread.currentThread().getStackTrace()[3].getClassName();
```

Ini rapuh karena:

- compiler/runtime/framework bisa mengubah stack shape;
- proxy/AOP menambah frame;
- virtual thread/framework instrumentation bisa mempengaruhi;
- optimization bisa berbeda.

Root cause: diagnostic artifact dijadikan contract bisnis.

### 13.6 DOM parsing dokumen besar membuat memory habis

DOM memuat seluruh tree. XML 100 MB bisa menjadi object graph jauh lebih besar dari 100 MB.

Root cause: salah memilih model parsing.

### 13.7 SAX text hilang karena asumsi `characters()` sekali panggil

Bug umum:

```java
public void characters(char[] ch, int start, int length) {
    currentText = new String(ch, start, length);
}
```

Kalau parser memecah text menjadi beberapa call, hanya bagian terakhir yang tersimpan.

Yang lebih aman:

```java
textBuffer.append(ch, start, length);
```

Root cause: salah membaca handler contract.

### 13.8 XML XXE membuka local file atau SSRF

Jika parser mengizinkan external entity, input XML bisa mencoba membaca file lokal atau URL internal.

Root cause: parser tidak di-hardening di trust boundary.

### 13.9 Namespace prefix dianggap identity

```java
if (node.getNodeName().equals("abc:Case")) { ... }
```

Partner mengubah prefix menjadi `c:Case`, padahal namespace URI sama. Code rusak.

Root cause: prefix dianggap identity.

### 13.10 Process deadlock karena stdout/stderr tidak dibaca

Jika child process menghasilkan output banyak dan parent tidak membaca stream, buffer OS bisa penuh dan child process block.

Root cause: process stream lifecycle tidak dikelola.

---

## 14. Mindset Desain: Dari API ke Architecture

Belajar API tidak cukup. Kita perlu mengubah API menjadi architecture decision.

### 14.1 Setiap API punya blast radius

Contoh:

- `System.setProperty` mempengaruhi seluruh JVM;
- `ThreadLocal` mempengaruhi semua code di thread yang sama;
- custom classloader mempengaruhi type identity;
- DOM document besar mempengaruhi heap;
- exception taxonomy mempengaruhi retry, transaction rollback, API response, logging;
- enum external mapping mempengaruhi database/API compatibility;
- XML parser hardening mempengaruhi security posture aplikasi.

Sebelum memakai API, tanya:

```text
Apa blast radius API ini jika salah?
```

### 14.2 Jangan sembunyikan dependency penting di global/static

Static/global memudahkan akses tetapi menyulitkan reasoning.

Contoh:

```java
final class XmlParsers {
    static DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
}
```

Pertanyaan:

- apakah factory thread-safe?
- apakah sudah di-hardening?
- apakah feature unsupported ditangani?
- apakah namespace-aware?
- apakah test bisa mengganti behavior?
- apakah secure config applied once?

### 14.3 Buat boundary eksplisit

Daripada XML parsing tersebar di banyak tempat, buat boundary:

```java
interface SafeXmlParser {
    Document parseSmallTrustedShape(InputStream input);
    void parseLargeExternalFeed(InputStream input, FeedHandler handler);
}
```

Keuntungan:

- hardening centralized;
- logging consistent;
- parser feature compatibility bisa diuji;
- namespace policy jelas;
- error handling konsisten;
- memory limit policy bisa dikontrol.

### 14.4 Prefer explicit context over hidden context

Hidden context:

```java
TenantContext.getCurrentTenant()
```

Explicit context:

```java
service.approve(command, tenantContext);
```

Hidden context kadang perlu untuk logging/tracing, tetapi berbahaya untuk business correctness jika tidak dikelola.

ThreadLocal bukan dosa, tetapi harus punya lifecycle policy:

```java
try {
    context.set(value);
    chain.doFilter(request, response);
} finally {
    context.remove();
}
```

### 14.5 Treat parsing as boundary crossing

Parsing bukan sekadar mengubah text menjadi object. Parsing adalah boundary crossing dari dunia luar ke sistem kamu.

Untuk XML external input:

- validate size;
- harden parser;
- disable dangerous features;
- handle namespace correctly;
- fail closed;
- avoid logging raw malicious input;
- report location when useful;
- map parser exceptions to safe errors;
- avoid partial inconsistent writes.

---

## 15. Tooling dan Eksperimen yang Direkomendasikan

Untuk mengikuti seri ini secara maksimal, kamu sebaiknya punya beberapa JDK.

### 15.1 Minimal JDK matrix

Direkomendasikan:

- JDK 8 untuk legacy baseline;
- JDK 11 sebagai transitional LTS;
- JDK 17 sebagai modern enterprise LTS;
- JDK 21 sebagai virtual thread LTS;
- JDK 25 sebagai horizon terbaru seri.

### 15.2 Eksperimen kecil yang akan sering dipakai

Kita akan sering membuat program kecil untuk mengamati:

- equality/hash behavior;
- string interning;
- class loading;
- module metadata;
- process handling;
- stack trace;
- `ThreadLocal` leak simulation;
- DOM `NodeList` live behavior;
- SAX `characters()` fragmentation;
- XML hardening payload.

### 15.3 Jangan hanya membaca, jalankan

Untuk topik seperti ini, pemahaman datang dari kombinasi:

```text
API spec
  + small experiment
  + failure case
  + production design pattern
```

Kalau hanya membaca method list, kamu akan tahu “cara pakai”. Kalau menjalankan failure case, kamu akan tahu “cara tidak rusak”.

---

## 16. Apa yang Harus Kamu Kuasai Setelah Part 0

Setelah part ini, kamu harus bisa menjelaskan:

1. `java.lang` adalah root runtime contract, bukan package basic biasa;
2. DOM adalah mutable in-memory XML tree;
3. SAX adalah event-driven streaming parser contract;
4. `java.base` selalu tersedia, sedangkan DOM/SAX berada di `java.xml`;
5. Java 8–25 harus dipahami dengan compatibility mindset;
6. API spec harus dibaca sebagai contract, bukan daftar method;
7. perbedaan contract dan implementation sangat penting;
8. XML namespace URI lebih penting daripada prefix;
9. parser XML external input harus di-hardening;
10. global state seperti `System` properties, default locale/timezone, standard streams, dan ThreadLocal harus dipakai sadar blast radius;
11. runtime type, classloader, module, dan exception hierarchy bukan konsep akademis, tetapi langsung mempengaruhi framework dan production debugging.

---

## 17. Checklist Mental sebelum Masuk Part 1

Gunakan checklist ini sebelum masuk ke detail `java.lang`.

### 17.1 Saat melihat API `java.lang`

Tanyakan:

- apakah ini language-level contract?
- apakah ini runtime/JVM boundary?
- apakah ini global state?
- apakah ini mutable?
- apakah ini thread-sensitive?
- apakah ini classloader/module-sensitive?
- apakah ini punya compatibility impact?
- apakah ini mahal secara memory/performance?
- apakah ini mempengaruhi observability?
- apakah ini bisa bocor ke security boundary?

### 17.2 Saat melihat DOM API

Tanyakan:

- node ini punya owner document apa?
- namespace-aware atau tidak?
- prefix atau namespace URI yang dipakai?
- `NodeList` ini live atau snapshot?
- whitespace text node relevan atau noise?
- document size aman untuk DOM?
- mutation order aman?
- output perlu canonical/stable?
- parser sudah di-hardening?

### 17.3 Saat melihat SAX API

Tanyakan:

- state machine apa yang sedang dibangun?
- text accumulation aman terhadap fragmentation?
- namespace feature aktif?
- locator dipakai untuk error reporting?
- entity resolution aman?
- parser feature unsupported ditangani?
- partial processing idempotent?
- handler reusable atau single-use?

---

## 18. Latihan Pemanasan

Latihan ini tidak perlu jawaban panjang sekarang. Tujuannya untuk mengaktifkan mental model.

### Latihan 1 — Identity vs equality

Apa output program ini, dan kenapa?

```java
String a = "case-001";
String b = new String("case-001");

System.out.println(a == b);
System.out.println(a.equals(b));
```

Pertanyaan lanjutan:

- apakah `b.intern()` mengubah object `b`?
- kapan identity comparison benar?
- apa bahaya memakai `==` untuk ID string?

### Latihan 2 — Enum external code

Misal ada enum:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Database menyimpan `ordinal()`.

Pertanyaan:

- apa yang terjadi jika `PENDING_REVIEW` ditambahkan di tengah?
- apa strategi yang lebih aman?
- bagaimana menangani external code yang berubah nama?

### Latihan 3 — DOM namespace

Dua XML berikut:

```xml
<a:Case xmlns:a="urn:case"><a:Id>1</a:Id></a:Case>
```

```xml
<c:Case xmlns:c="urn:case"><c:Id>1</c:Id></c:Case>
```

Pertanyaan:

- apakah keduanya merepresentasikan element namespace yang sama?
- apakah code yang mencari `a:Case` robust?
- API DOM apa yang sebaiknya dipakai?

### Latihan 4 — SAX text fragmentation

Jika XML:

```xml
<Name>Fajar Abdi Nugraha</Name>
```

Apakah parser SAX wajib memanggil `characters()` sekali saja untuk seluruh text?

Pertanyaan:

- bagaimana handler yang benar menyimpan text?
- kapan buffer harus di-reset?
- bagaimana menghindari whitespace noise?

### Latihan 5 — Runtime version

Apa masalah dari code ini?

```java
String version = System.getProperty("java.version");
if (version.startsWith("1.8")) {
    // Java 8
} else if (version.startsWith("11")) {
    // Java 11
}
```

Pertanyaan:

- bagaimana version string berubah setelah Java 9?
- API apa yang lebih cocok di Java 9+?
- bagaimana jika library harus support Java 8?

---

## 19. Ringkasan Part 0

Part 0 membangun fondasi seri:

- `java.lang` adalah package paling fundamental dalam Java, bukan sekadar package basic;
- `java.lang` menghubungkan source code, compiler, JVM, runtime environment, process, class loading, exception, text, type metadata, dan framework behavior;
- DOM memodelkan XML sebagai mutable tree;
- SAX memodelkan XML sebagai event stream;
- Java 8–25 membutuhkan compatibility mindset karena API dan runtime model berubah signifikan, terutama sejak Java 9 module system;
- API spec harus dibaca sebagai contract: guarantee, non-guarantee, side effect, failure mode, compatibility impact;
- XML parsing adalah security boundary, bukan hanya data conversion;
- seri ini akan bergerak dari root runtime contracts menuju XML tree/event contracts dan ditutup dengan capstone production utility layer.

Kalau Part 0 berhasil, kamu tidak lagi melihat `Object`, `String`, `Class`, `Throwable`, DOM, dan SAX sebagai “API lama”. Kamu melihatnya sebagai **kontrak dasar yang menentukan apakah sistem Java kamu predictable, secure, diagnosable, compatible, dan maintainable**.

---

## 20. Referensi Resmi untuk Orientasi

Referensi berikut dipakai sebagai baseline orientasi. Part-part berikutnya akan memakai referensi yang lebih spesifik per API.

1. OpenJDK JDK 25 Project — JDK 25 mencapai General Availability pada 16 September 2025.  
   https://openjdk.org/projects/jdk/25/

2. Java SE 25 API — Package `org.w3c.dom`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/org/w3c/dom/package-summary.html

3. Java SE 25 API — Package `org.xml.sax`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/org/xml/sax/package-summary.html

4. Java SE 25 API — Package `javax.xml.parsers`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/javax/xml/parsers/package-summary.html

5. Java SE 11 API — Module `java.xml`, mendefinisikan JAXP, StAX, SAX, dan W3C DOM API.  
   https://docs.oracle.com/en/java/javase/11/docs/api/java.xml/module-summary.html

6. Java SE 8 API — Package `org.w3c.dom`, mendukung DOM Level 2 Core, DOM Level 3 Core, dan DOM Level 3 Load and Save.  
   https://docs.oracle.com/javase/8/docs/api/org/w3c/dom/package-summary.html

7. Java SE 8 API — Package `org.xml.sax`, core SAX APIs dan catatan SAX1 deprecated untuk namespace-aware design.  
   https://docs.oracle.com/javase/8/docs/api/org/xml/sax/package-summary.html

8. OpenJDK JEP 411 — Deprecate the Security Manager for Removal.  
   https://openjdk.org/jeps/411

9. OpenJDK JEP 486 — Permanently Disable the Security Manager.  
   https://openjdk.org/jeps/486

---

## Status Seri

Seri **belum selesai**. Ini adalah **Part 0 dari 32**.

Part berikutnya:

**Part 1 — `java.lang` as the Root Contract of the Java Platform**  
File: `01-java-lang-as-platform-root-contract.md`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 35 — Capstone: Building a Production-Grade Java Network Client and Service Platform](../io/network/035-capstone-production-grade-java-network-client-and-service-platform.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 1 — `java.lang` as the Root Contract of the Java Platform](./01-java-lang-as-platform-root-contract.md)
