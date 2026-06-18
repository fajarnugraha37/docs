# Learn Java Part 000 — Orientasi dan Mental Model Java hingga Java 25

> **Target pembaca:** software engineer yang ingin memahami Java bukan sebagai kumpulan syntax, tetapi sebagai bahasa, platform, runtime, dan ekosistem production-grade.  
> **Target versi:** Java / JDK / Java SE hingga versi 25.  
> **Output pembelajaran:** setelah bagian ini, kamu punya peta mental untuk memahami semua bagian berikutnya: language semantics, JVM, memory, concurrency, GC, tooling, framework, observability, dan production engineering.

---

## Daftar Isi

- [0.0 Cara Membaca Bagian Ini](#00-cara-membaca-bagian-ini)
- [0.1 Java Bukan Sekadar Bahasa](#01-java-bukan-sekadar-bahasa)
- [0.2 Apa yang Membedakan Java Engineer Biasa vs Top-Tier](#02-apa-yang-membedakan-java-engineer-biasa-vs-top-tier)
- [0.3 Mental Model Utama Java](#03-mental-model-utama-java)
- [0.4 Java Release Model](#04-java-release-model)
- [0.5 Peta Besar Java hingga Versi 25](#05-peta-besar-java-hingga-versi-25)
- [0.6 Cara Belajar Java agar Tidak Terjebak Framework-First Thinking](#06-cara-belajar-java-agar-tidak-terjebak-framework-first-thinking)
- [0.7 Checklist Pemahaman Bagian 0](#07-checklist-pemahaman-bagian-0)
- [0.8 Latihan Mental Model](#08-latihan-mental-model)
- [0.9 Ringkasan Eksekutif](#09-ringkasan-eksekutif)
- [Referensi Utama](#referensi-utama)

---

## 0.0 Cara Membaca Bagian Ini

Bagian ini belum membahas syntax secara detail. Itu sengaja.

Banyak engineer belajar Java dengan urutan seperti ini:

1. belajar `class`, `main`, `if`, `for`, `List`, `Map`;
2. lanjut Spring Boot;
3. belajar JPA, REST API, Kafka, Redis;
4. deploy ke Kubernetes;
5. ketika production bermasalah, baru sadar tidak paham JVM, memory, thread, GC, classpath, dependency conflict, dan observability.

Urutan itu bisa membuat seseorang produktif cepat, tetapi sering menghasilkan pemahaman yang rapuh. Engineer bisa membuat service berjalan, tetapi sulit menjawab pertanyaan seperti:

- Kenapa service lambat hanya setelah traffic naik?
- Kenapa heap masih terlihat besar setelah GC?
- Kenapa thread pool penuh padahal CPU belum tinggi?
- Kenapa `CompletableFuture` membuat starvation?
- Kenapa virtual thread tidak otomatis membuat sistem lebih cepat?
- Kenapa `HashMap` bisa rusak saat `equals/hashCode` salah?
- Kenapa upgrade JDK aman di satu service tetapi gagal di service lain?
- Kenapa dependency compile-time dan runtime bisa berbeda?
- Kenapa Spring `@Transactional` tidak bekerja saat method dipanggil dari class yang sama?
- Kenapa reflection, proxy, annotation scanning, dan bytecode generation memengaruhi startup time?

Bagian 0 membangun fondasi untuk membaca Java sebagai sistem berlapis:

```text
source code
  ↓
compiler javac
  ↓
class file / bytecode
  ↓
class loading + verification + linking + initialization
  ↓
interpreter + JIT compiler
  ↓
heap + stack + native memory + threads
  ↓
garbage collector + safepoint + runtime services
  ↓
application framework + libraries
  ↓
OS + container + Kubernetes + observability stack
```

Kalau lapisan ini jelas, materi berikutnya tidak akan terasa seperti daftar fitur acak. Setiap fitur Java akan punya tempat:

- syntax berada di level language;
- bytecode berada di level JVM instruction model;
- object allocation berada di level runtime memory;
- `volatile`, `synchronized`, dan `final` berada di level Java Memory Model;
- GC berada di level heap lifecycle;
- Spring, Hibernate, Netty, Kafka client berada di level library/framework yang berdiri di atas mekanisme Java;
- container tuning berada di level interaksi JVM dengan OS dan cgroup.

---

## 0.1 Java Bukan Sekadar Bahasa

Kalimat “saya belajar Java” sering ambigu. Yang dipelajari bisa berarti beberapa hal berbeda:

1. **Java sebagai bahasa pemrograman**
2. **Java sebagai platform standar**
3. **Java sebagai runtime virtual machine**
4. **Java sebagai ekosistem library dan framework**
5. **Java sebagai operational platform untuk production system**

Engineer yang kuat bisa membedakan kelima hal ini. Engineer yang lemah sering mencampurnya.

Contoh kebingungan umum:

> “Java lambat.”

Pernyataan itu tidak presisi. Yang lambat apa?

- syntax Java?
- compiler `javac`?
- JVM startup?
- JIT warmup?
- GC pause?
- framework startup?
- database query?
- serialization JSON?
- thread pool starvation?
- CPU throttling di container?
- logging synchronous?
- DNS/TLS/network latency?

Tanpa membedakan layer, diagnosis akan menjadi tebakan.

### 0.1.1 Java sebagai bahasa

Sebagai bahasa, Java menyediakan konsep seperti:

- class;
- interface;
- enum;
- record;
- sealed class/interface;
- primitive type;
- reference type;
- generics;
- lambda;
- annotation;
- exception;
- switch expression;
- pattern matching;
- module declaration;
- access modifier;
- statement dan expression;
- overload dan override;
- constructor dan initialization;
- `synchronized`, `volatile`, dan memory semantics tertentu.

Bahasa Java didefinisikan oleh **Java Language Specification** atau **JLS**. Untuk Java SE 25, spesifikasinya adalah *The Java Language Specification, Java SE 25 Edition*.

Mental model penting:

```text
Java language menentukan apa arti program Java secara source-level.
```

JLS menjawab pertanyaan seperti:

- Apakah kode ini valid secara bahasa?
- Bagaimana overload resolution bekerja?
- Apa urutan initialization class?
- Apa arti `final`?
- Bagaimana scoping variable?
- Bagaimana pattern matching dicek?
- Bagaimana definite assignment bekerja?
- Apa aturan constructor?
- Apa aturan generics dan type inference?

Contoh:

```java
String s = null;
System.out.println(s.length());
```

Secara bahasa, kode ini valid. Tetapi secara runtime, ia melempar `NullPointerException`.

Artinya, validitas source-level tidak sama dengan keamanan runtime-level.

Contoh lain:

```java
List<String> names = new ArrayList<>();
List<Object> objects = names; // tidak valid
```

Kenapa tidak valid? Karena generic type Java bersifat invariant. Ini bukan keputusan JVM langsung, tetapi aturan type system bahasa Java.

### 0.1.2 Java sebagai platform

Sebagai platform, Java bukan hanya syntax. Java SE menyediakan kumpulan API standar:

- `java.lang`;
- `java.util`;
- `java.time`;
- `java.io`;
- `java.nio`;
- `java.net`;
- `java.concurrent`;
- `java.security`;
- `java.sql`;
- `java.management`;
- `java.lang.invoke`;
- `java.lang.reflect`;
- `java.util.stream`;
- dan banyak modul lain.

Java Platform, Standard Edition mendefinisikan API inti untuk program general-purpose. JDK 25 documentation membagi dokumentasi ke area seperti API documentation, guides, tool specifications, language and libraries, specifications, security, HotSpot VM, garbage collection tuning, troubleshooting, monitoring, dan management.

Mental model penting:

```text
Java platform = kontrak standar API + bahasa + VM + tooling yang membentuk lingkungan eksekusi Java.
```

Ini alasan library Java bisa berjalan lintas vendor JDK, selama bergantung pada API standar dan tidak memakai detail internal vendor.

Contoh:

```java
var now = java.time.Instant.now();
var list = java.util.List.of("A", "B", "C");
var path = java.nio.file.Path.of("data/input.txt");
```

Kode ini bukan hanya “syntax Java”. Ia bergantung pada API standar Java SE.

### 0.1.3 Java sebagai runtime: JVM

Java source code tidak langsung dieksekusi oleh CPU. Umumnya alurnya:

```text
.java source file
  ↓ javac
.class file / bytecode
  ↓ JVM
machine code / interpreted execution
```

JVM adalah mesin abstrak yang mengeksekusi class file. JVM specification mendefinisikan hal-hal seperti:

- class file format;
- primitive dan reference type di level VM;
- runtime data areas;
- heap;
- Java Virtual Machine stack;
- frames;
- operand stack;
- local variables;
- method area;
- runtime constant pool;
- loading, linking, initialization;
- bytecode instruction set;
- exception handling;
- synchronization;
- verification.

Mental model penting:

```text
JLS menjelaskan source language.
JVMS menjelaskan mesin abstrak yang menjalankan class file.
HotSpot adalah implementasi JVM yang umum dipakai.
```

JLS dan JVMS berbeda. Ini penting.

Misalnya, di source Java kamu menulis:

```java
int x = a + b;
```

Di level bytecode, ini bisa menjadi instruksi load, arithmetic, dan store. JVM tidak “melihat” kode Java seperti yang kamu tulis. JVM melihat class file.

Framework seperti Spring, Hibernate, Mockito, Byte Buddy, Lombok, MapStruct, Jackson, Quarkus, Micronaut, dan OpenTelemetry agent sering bekerja dengan memanfaatkan mekanisme runtime seperti:

- reflection;
- annotation metadata;
- classpath scanning;
- dynamic proxy;
- bytecode generation;
- instrumentation;
- class loading;
- method handles;
- invokedynamic.

Kalau kamu hanya memahami Java sebagai syntax, framework internals akan terlihat seperti “magic”. Kalau kamu memahami Java sebagai runtime, magic itu berubah menjadi mekanisme teknis.

### 0.1.4 Java sebagai ekosistem

Java juga besar karena ekosistemnya:

- Spring Boot;
- Jakarta EE;
- Quarkus;
- Micronaut;
- Hibernate;
- jOOQ;
- Netty;
- Vert.x;
- Kafka client;
- Reactor;
- Akka/Pekko;
- Maven;
- Gradle;
- JUnit;
- Mockito;
- Testcontainers;
- JMH;
- JFR;
- Java Mission Control;
- async-profiler;
- OpenTelemetry;
- SLF4J/Logback/Log4j2;
- Jackson;
- gRPC;
- Protobuf;
- Avro;
- Flyway/Liquibase.

Namun ekosistem yang besar punya konsekuensi:

- dependency graph bisa kompleks;
- transitive dependency bisa konflik;
- classpath bisa berbeda antara compile dan runtime;
- reflection bisa melanggar encapsulation;
- framework abstraction bisa menyembunyikan cost;
- annotation-driven programming bisa membuat control flow tidak eksplisit;
- proxy bisa membuat behavior berbeda dari yang terlihat di source;
- startup time bisa dipengaruhi scanning dan initialization;
- memory footprint bisa membengkak karena framework metadata;
- upgrade JDK bisa membuka masalah illegal reflective access atau internal API dependency.

Mental model penting:

```text
Ecosystem Java mempercepat delivery, tetapi semakin tinggi abstraction, semakin penting memahami layer di bawahnya.
```

### 0.1.5 Java sebagai operational substrate

Di production, Java adalah proses OS yang hidup di environment nyata:

```text
Java application
  ↓
JVM process
  ↓
Linux/Windows/macOS process model
  ↓
container runtime / cgroup
  ↓
Kubernetes scheduler / node resources
  ↓
network / DNS / storage / database / message broker
```

Saat service Java berjalan di Kubernetes, beberapa hal menjadi penting:

- heap size;
- native memory;
- metaspace;
- thread stack memory;
- direct buffer;
- GC behavior;
- CPU quota;
- CPU throttling;
- container memory limit;
- startup probe;
- readiness probe;
- liveness probe;
- graceful shutdown;
- TLS handshake;
- DNS cache;
- connection pool;
- log throughput;
- metric cardinality;
- tracing overhead.

Top-tier Java engineer tidak berhenti di `mvn spring-boot:run`. Ia mampu membaca service Java sebagai:

```text
business behavior + runtime behavior + operational behavior
```

Contoh nyata:

Service Spring Boot mengalami latency spike. Engineer biasa mungkin berkata:

> “Mungkin query database lambat.”

Engineer yang kuat akan memecah kemungkinan:

- Apakah p95/p99 naik atau average saja?
- Apakah CPU naik?
- Apakah GC pause meningkat?
- Apakah allocation rate naik?
- Apakah thread pool penuh?
- Apakah DB pool exhausted?
- Apakah Kafka consumer lag?
- Apakah DNS/TLS/remote call bermasalah?
- Apakah log sink lambat?
- Apakah pod kena CPU throttling?
- Apakah JIT warmup terjadi setelah rolling restart?
- Apakah ada class loading atau lazy initialization di request pertama?

Ini bukan sekadar debugging. Ini cara berpikir sistemik.

---

## 0.2 Apa yang Membedakan Java Engineer Biasa vs Top-Tier

Bagian ini bukan untuk membuat label elit. Tujuannya adalah membuat standar berpikir yang jelas.

Engineer Java biasa biasanya mampu:

- menulis class, method, DTO, service, repository;
- membuat REST API;
- memakai Spring Boot;
- memakai ORM;
- menulis unit test dasar;
- membuat query database;
- deploy service;
- membaca log error sederhana.

Itu cukup untuk banyak pekerjaan. Tetapi untuk sistem kompleks, terutama yang punya kebutuhan reliability, security, auditability, latency, throughput, migration, compliance, dan maintainability, kemampuan itu belum cukup.

Top-tier Java engineer mempunyai lapisan kemampuan tambahan.

### 0.2.1 Mampu membedakan syntax, semantics, dan mechanics

Syntax adalah bentuk tulisan.

Semantics adalah arti.

Mechanics adalah bagaimana runtime mewujudkan arti itu.

Contoh:

```java
synchronized (lock) {
    counter++;
}
```

Syntax:

- ada keyword `synchronized`;
- ada block;
- ada object monitor.

Semantics:

- hanya satu thread yang bisa memasuki monitor yang sama pada satu waktu;
- ada happens-before relationship saat lock release/acquire;
- visibility state dijaga oleh memory model.

Mechanics:

- JVM menggunakan monitorenter/monitorexit di bytecode;
- implementasi HotSpot bisa punya fast path dan inflated monitor;
- contention bisa menyebabkan blocking;
- virtual thread historically bisa pinning jika blocking terjadi dalam monitor, walaupun JDK modern terus memperbaiki area ini;
- JFR bisa merekam event lock tertentu;
- thread dump bisa menunjukkan blocked monitor.

Engineer biasa melihat “ini lock”. Engineer kuat melihat correctness, memory visibility, contention, observability, dan runtime consequence.

### 0.2.2 Paham cost of abstraction

Java modern kaya abstraction:

- stream;
- lambda;
- reflection;
- annotation;
- proxy;
- ORM;
- reactive pipeline;
- virtual thread;
- dependency injection;
- serialization framework;
- object mapper;
- aspect-oriented programming.

Abstraction bagus ketika menyembunyikan detail yang tidak relevan. Abstraction buruk ketika menyembunyikan detail yang menentukan correctness atau performance.

Contoh:

```java
users.stream()
     .filter(User::active)
     .map(User::email)
     .toList();
```

Ini bagus untuk transformasi sederhana.

Tetapi jika pipeline menjadi:

```java
orders.parallelStream()
      .map(order -> externalService.enrich(order))
      .map(order -> repository.save(order))
      .toList();
```

Masalah potensial:

- `parallelStream` memakai common `ForkJoinPool`;
- blocking I/O di common pool bisa mengganggu task lain;
- repository save mungkin transactional context tidak aman;
- ordering dan side effect sulit diprediksi;
- error propagation bisa membingungkan;
- backpressure tidak eksplisit;
- external service bisa overload.

Abstraction bukan musuh. Abstraction yang tidak dipahami adalah musuh.

### 0.2.3 Paham failure mode

Top-tier engineer selalu bertanya:

```text
Bagaimana ini gagal?
Bagaimana kita tahu ia gagal?
Bagaimana sistem pulih?
Apa efek samping jika retry?
Apa state yang bisa setengah selesai?
Apa yang terjadi saat proses mati di tengah operasi?
Apa yang terjadi saat dependency lambat, bukan mati?
Apa yang terjadi saat data lama bertemu logic baru?
```

Dalam Java, failure mode bisa muncul di banyak layer:

| Layer | Contoh Failure |
|---|---|
| Language | Null pointer, invalid cast, equality contract rusak |
| Runtime | OutOfMemoryError, StackOverflowError, class loading error |
| Concurrency | deadlock, race condition, visibility bug, starvation |
| GC | pause spike, promotion failure, allocation pressure |
| I/O | partial read, timeout, charset error, file descriptor leak |
| Network | DNS stale, TLS failure, connection reset, retry storm |
| Framework | proxy bypass, wrong transaction boundary, lazy loading outside session |
| Database | deadlock, lock wait, isolation anomaly, connection leak |
| Messaging | duplicate message, out-of-order event, poison message |
| Deployment | incompatible JDK, memory limit too low, CPU throttling |

Engineer kuat bukan hanya menulis happy path. Ia membuat failure path menjadi eksplisit.

### 0.2.4 Paham invariants

Invariant adalah kondisi yang harus selalu benar.

Contoh domain sederhana:

```text
A case cannot be closed before it has a final decision.
A payment cannot be captured twice.
A user cannot approve their own request.
A license cannot be renewed if it is revoked.
```

Dalam Java, invariant bisa dijaga oleh:

- constructor;
- factory method;
- record compact constructor;
- sealed hierarchy;
- enum state machine;
- validation boundary;
- database constraint;
- transaction boundary;
- optimistic locking;
- idempotency key;
- event version;
- test suite;
- static analysis;
- type system.

Contoh weak model:

```java
class Case {
    String status;
}
```

Masalah:

- status bebas diisi string apapun;
- transition tidak dikontrol;
- invalid state mudah muncul;
- audit trail tidak inherent;
- tidak ada compile-time help.

Model lebih kuat:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    DECIDED,
    CLOSED,
    REJECTED
}
```

Lebih kuat lagi:

```java
sealed interface CaseState permits Draft, Submitted, UnderReview, Decided, Closed, Rejected {}

record Draft() implements CaseState {}
record Submitted() implements CaseState {}
record UnderReview() implements CaseState {}
record Decided(String decisionId) implements CaseState {}
record Closed(String closureReason) implements CaseState {}
record Rejected(String rejectionReason) implements CaseState {}
```

Di sini state tertentu bisa membawa data wajib. `Decided` harus punya `decisionId`; `Closed` harus punya `closureReason`. Type system membantu menjaga invariant.

Top-tier Java engineer memakai bahasa untuk memperkecil ruang kesalahan, bukan hanya sebagai tempat menulis prosedur.

### 0.2.5 Paham compatibility

Java terkenal sangat menjaga compatibility, tetapi compatibility punya beberapa jenis:

1. **Source compatibility**  
   Kode lama masih bisa dikompilasi ulang.

2. **Binary compatibility**  
   Class file lama masih bisa di-link dan dijalankan tanpa recompile.

3. **Behavioral compatibility**  
   Program lama masih berperilaku sama saat runtime.

4. **Operational compatibility**  
   Program lama masih aman dijalankan dalam environment production yang sama.

5. **Dependency compatibility**  
   Semua library, framework, annotation processor, plugin build, dan runtime agent masih cocok.

Oracle release notes JDK 25 sendiri menekankan potensi compatibility issue saat migration, termasuk source, binary, dan behavioral compatibility.

Contoh:

- Source compatible tetapi behavioral berubah karena timezone database baru.
- Binary compatible tetapi framework gagal karena akses reflective ke internal JDK dibatasi.
- Unit test pass tetapi production gagal karena agent observability tidak support JDK baru.
- App compile di JDK 25 tetapi runtime container masih JDK 21.
- Library support Java 25 tetapi Maven plugin belum support class file version terbaru.

Top-tier Java engineer selalu memisahkan:

```text
Bisa compile ≠ bisa run ≠ aman di production ≠ aman dalam jangka panjang.
```

### 0.2.6 Paham observability sebagai bagian dari desain

Observability bukan tempelan setelah sistem jadi. Dalam Java, observability harus dipikirkan sejak desain:

- log apa yang perlu ada?
- metric apa yang menunjukkan health?
- trace span mana yang penting?
- event domain mana yang perlu diaudit?
- correlation ID lewat mana?
- thread name membantu atau tidak?
- error diklasifikasikan atau tidak?
- JFR event bisa membantu apa?
- apakah high-cardinality label akan membunuh metric backend?
- apakah logging synchronous memperparah latency?

Contoh error handling lemah:

```java
try {
    process(command);
} catch (Exception e) {
    log.error("failed", e);
}
```

Masalah:

- command apa yang gagal?
- aggregate apa?
- correlation ID apa?
- retryable atau tidak?
- state berubah atau belum?
- user-facing effect apa?
- apakah perlu audit event?
- apakah exception ditelan?

Lebih kuat:

```java
try {
    process(command);
} catch (DomainRejection e) {
    audit.rejected(command.commandId(), command.aggregateId(), e.reasonCode());
    throw e;
} catch (RetryableDependencyFailure e) {
    metrics.increment("case.command.retryable_failure", tags(command));
    throw e;
} catch (Exception e) {
    metrics.increment("case.command.unexpected_failure", tags(command));
    log.error("Unexpected command failure: commandId={}, aggregateId={}, type={}",
            command.commandId(), command.aggregateId(), command.getClass().getSimpleName(), e);
    throw e;
}
```

Ini bukan verbosity tanpa alasan. Ini membuat failure dapat dipahami.

### 0.2.7 Paham kapan tidak memakai fitur baru

Java 25 punya banyak fitur menarik: scoped values, structured concurrency preview, module import declarations, compact source files, flexible constructor bodies, AOT improvements, compact object headers, JFR improvements, generational Shenandoah, vector API incubator, dan lain-lain.

Namun engineer kuat tidak memakai fitur hanya karena baru.

Pertanyaan yang harus dijawab:

- Apakah fitur final, preview, incubator, atau experimental?
- Apakah boleh dipakai di production policy organisasi?
- Apakah build tool support?
- Apakah IDE support?
- Apakah framework support?
- Apakah observability agent support?
- Apakah tim paham?
- Apakah migration path jelas?
- Apakah benefit lebih besar dari risk?

Contoh:

- `ScopedValue` di Java 25 final dan relevan untuk contextual data, terutama bersama virtual threads.
- `Structured Concurrency` di Java 25 masih preview, sehingga perlu policy eksplisit jika ingin dipakai.
- `Vector API` masih incubator, cocok untuk eksperimen atau workload tertentu, bukan default untuk business service biasa.
- Compact source files bagus untuk learning/scripting, bukan berarti semua enterprise code harus ditulis tanpa class eksplisit.

Top-tier engineer punya disiplin adopsi.

---

## 0.3 Mental Model Utama Java

Bagian ini adalah inti Part 000.

Kita akan membuat peta mental dari source code sampai production behavior.

### 0.3.1 Model besar: Java pipeline

Saat kamu menulis program Java:

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello, Java");
    }
}
```

Yang sebenarnya terjadi bukan “Java menjalankan file itu”. Alurnya kira-kira:

```text
1. Developer menulis source code .java
2. javac membaca source code
3. javac melakukan parsing dan type checking
4. javac menghasilkan .class file
5. java launcher memulai JVM
6. JVM menemukan entry point
7. Class loader memuat class
8. JVM melakukan verification
9. JVM melakukan linking
10. JVM melakukan initialization
11. Bytecode dieksekusi oleh interpreter
12. Hot method diprofiling
13. JIT compiler mengubah hot bytecode menjadi machine code
14. Object dialokasikan di heap
15. Thread menjalankan call stack
16. GC membersihkan object yang tidak reachable
17. Runtime service mengelola synchronization, safepoint, signal, native call, JFR, monitoring
18. Program berinteraksi dengan OS, file, network, database, dan dependency lain
```

Diagram:

```text
Developer intent
  ↓
Java source code (.java)
  ↓ javac
Class file (.class)
  ↓ java launcher
JVM startup
  ↓
Class loading
  ↓
Verification
  ↓
Linking
  ↓
Initialization
  ↓
Interpretation
  ↓ profiling
JIT compilation
  ↓
Optimized machine code
  ↓
Runtime execution
  ↓
GC / threads / native / I/O / observability
```

Setiap tahap bisa menjadi sumber masalah.

| Tahap | Contoh Masalah |
|---|---|
| Source | syntax error, generic misuse, invalid override |
| Compile | annotation processor error, dependency missing |
| Class file | class version mismatch |
| Launch | wrong JDK, wrong classpath/module path |
| Class loading | `ClassNotFoundException`, `NoClassDefFoundError` |
| Verification | invalid bytecode, agent bug |
| Linking | `NoSuchMethodError`, `IncompatibleClassChangeError` |
| Initialization | static initializer failure |
| Interpretation/JIT | warmup latency, deoptimization |
| Runtime memory | OOM, leak, GC pressure |
| Threading | deadlock, starvation, race condition |
| I/O | timeout, FD leak, charset bug |
| Framework | proxy behavior, reflection access issue |

### 0.3.2 Source code bukan runtime truth

Source code adalah niat manusia. Runtime behavior adalah hasil dari banyak transformasi.

Contoh source sederhana:

```java
public int sum(List<Integer> numbers) {
    return numbers.stream()
            .mapToInt(Integer::intValue)
            .sum();
}
```

Di source, ini terlihat sederhana. Tetapi runtime behavior melibatkan:

- object `List` konkret;
- iterator/spliterator;
- stream pipeline;
- lambda atau method reference;
- possible allocation;
- boxing/unboxing history;
- method dispatch;
- JIT inlining;
- branch behavior;
- null handling;
- potential `NullPointerException` jika list/null element tidak sesuai asumsi.

Top-tier Java engineer tidak paranoid terhadap semua detail setiap waktu. Tetapi ketika ada bug/performance issue, ia tahu layer mana yang harus dibuka.

### 0.3.3 Compilation: `javac` bukan hanya translator

`javac` melakukan beberapa pekerjaan:

- lexical analysis;
- parsing;
- symbol resolution;
- type checking;
- overload resolution;
- generics checking;
- desugaring fitur tertentu;
- annotation processing;
- class file generation.

Misalnya, generics Java banyak dicek di compile time dan dihapus melalui type erasure di runtime.

Source:

```java
List<String> names = new ArrayList<>();
names.add("Fajar");
String first = names.get(0);
```

Runtime tidak membawa `List<String>` sebagai jenis collection berbeda dari `List<Integer>`. Banyak informasi generic tidak reified di runtime.

Implikasi:

- kamu tidak bisa membuat `new List<String>[10]` secara normal;
- `instanceof List<String>` tidak valid;
- reflection butuh trik untuk membaca generic signature;
- raw type bisa menyebabkan heap pollution;
- framework serialization butuh metadata tambahan.

### 0.3.4 Class file adalah kontrak portabilitas

Java terkenal dengan konsep “write once, run anywhere”, tetapi detailnya bukan source code berjalan di mana saja. Yang portabel adalah class file yang mengikuti spesifikasi JVM dan dijalankan oleh JVM yang kompatibel.

Class file berisi:

- magic number;
- version;
- constant pool;
- access flags;
- class name;
- superclass;
- interfaces;
- fields;
- methods;
- attributes;
- bytecode;
- debug metadata opsional;
- annotation metadata;
- module/record/nest/sealed-related metadata tergantung fitur.

Mental model penting:

```text
Source compatibility adalah urusan javac/JLS.
Class file compatibility adalah urusan JVM/JVMS.
```

Contoh masalah:

```text
java.lang.UnsupportedClassVersionError
```

Biasanya berarti class file dikompilasi untuk versi Java yang lebih baru daripada JVM runtime.

Misalnya aplikasi dikompilasi dengan JDK 25 tetapi dijalankan di runtime JDK 21. Ini bukan bug business logic. Ini mismatch class file/runtime.

### 0.3.5 Class loading: Java tidak memuat semua hal sekaligus

Class loading adalah proses JVM menemukan dan memuat class saat dibutuhkan.

JVM biasanya memiliki beberapa class loader:

- bootstrap class loader;
- platform class loader;
- application class loader;
- custom class loader.

Framework, application server, plugin system, test runner, agent, dan container tertentu bisa memakai custom class loader.

Mental model:

```text
Class identity = class name + defining class loader
```

Dua class dengan nama fully qualified sama bisa dianggap berbeda jika dimuat oleh class loader berbeda.

Ini menjelaskan masalah aneh seperti:

```text
ClassCastException: com.example.User cannot be cast to com.example.User
```

Terlihat absurd, tetapi bisa terjadi jika dua `com.example.User` dimuat oleh class loader berbeda.

Class loading juga menjelaskan kenapa:

- dependency duplicate bisa berbahaya;
- shading perlu hati-hati;
- servlet container punya class loader hierarchy;
- OSGi/modular runtime kompleks;
- devtools hot reload bisa memicu classloader leak;
- static field di classloader lama bisa menahan memory.

### 0.3.6 Verification: JVM tidak percaya bytecode begitu saja

JVM melakukan verification untuk memastikan class file aman secara struktural dan type-safe menurut aturan JVM.

Ini penting karena class file tidak harus dihasilkan oleh `javac`. Ia bisa dihasilkan oleh:

- Kotlin compiler;
- Scala compiler;
- Groovy compiler;
- Clojure compiler;
- Byte Buddy;
- ASM;
- Javassist;
- instrumentation agent;
- obfuscator;
- code generator.

Verifier membantu menjaga agar bytecode tidak merusak asumsi JVM, misalnya stack type tidak cocok, branch invalid, atau initialization object tidak benar.

Untuk engineer aplikasi, verification biasanya tidak terlihat. Tetapi saat memakai agent, bytecode manipulation, mocking framework, atau instrumentation, error verification bisa muncul.

### 0.3.7 Linking dan initialization

Setelah class dimuat, JVM melakukan linking, yang mencakup:

1. **Verification**  
   Memastikan class file valid.

2. **Preparation**  
   Menyiapkan storage untuk static fields dan memberi default value.

3. **Resolution**  
   Mengubah symbolic references menjadi direct references saat dibutuhkan.

Lalu class initialization menjalankan static initializer dan static field initializer.

Contoh:

```java
class Config {
    static final String ENV = System.getenv("APP_ENV");
    static final DatabaseClient CLIENT = connect();

    static DatabaseClient connect() {
        return new DatabaseClient(ENV);
    }
}
```

Ini tampak sederhana, tetapi punya risiko:

- class initialization bisa melakukan I/O;
- failure bisa menjadi `ExceptionInInitializerError`;
- static initialization order bisa membingungkan;
- test isolation sulit;
- configuration dibaca terlalu awal;
- class loading menjadi punya side effect.

Rule of thumb production-grade:

```text
Jangan membuat static initialization melakukan pekerjaan berat, I/O, network call, atau logic yang sulit dikontrol.
```

### 0.3.8 Interpretation dan JIT compilation

Saat JVM menjalankan bytecode, JVM tidak langsung mengubah semua bytecode menjadi machine code optimal.

Biasanya HotSpot menggunakan kombinasi:

- interpreter;
- profiling;
- tiered compilation;
- C1 compiler;
- C2 compiler;
- deoptimization.

Mental model:

```text
JVM belajar dari program yang sedang berjalan.
```

Saat method sering dieksekusi, JVM menganggapnya hot. Hot method bisa dikompilasi menjadi machine code. JIT bisa melakukan optimisasi seperti:

- inlining;
- escape analysis;
- scalar replacement;
- dead code elimination;
- loop optimization;
- lock elimination;
- branch profiling;
- speculative optimization.

Implikasi:

1. **Warmup penting**  
   Aplikasi Java bisa lebih lambat di awal lalu lebih cepat setelah hot path dikompilasi.

2. **Benchmark naive menipu**  
   Mengukur satu kali eksekusi method Java sering tidak valid karena belum warmup, dead-code elimination, atau JIT belum stabil.

3. **Production behavior bisa berbeda dari local test**  
   Traffic pattern memengaruhi JIT profile.

4. **Stack trace dan source tidak selalu menggambarkan machine code aktual**  
   JIT bisa inline banyak method.

5. **Deoptimization bisa terjadi**  
   Optimisasi spekulatif bisa dibatalkan jika asumsi runtime berubah.

### 0.3.9 Heap allocation

Object Java umumnya dialokasikan di heap.

Contoh:

```java
var user = new User("A", "B");
```

Secara mental, ada beberapa hal:

- reference `user` berada di local variable frame;
- object `User` berada di heap;
- field object disimpan di memory layout tertentu;
- object punya header;
- GC melacak reachability;
- allocation biasanya sangat cepat jika lewat TLAB;
- object bisa mati cepat dan dikumpulkan di young generation;
- object yang hidup lama bisa pindah/terpromosi ke old generation tergantung GC.

Kesalahan mental model umum:

> “Object allocation di Java selalu mahal.”

Tidak selalu. Allocation di JVM modern bisa sangat cepat. Yang sering mahal adalah **allocation rate tinggi + object hidup cukup lama + GC pressure + cache locality buruk + abstraction overhead**.

Contoh:

```java
for (int i = 0; i < 10_000_000; i++) {
    var s = "value=" + i;
    consume(s);
}
```

Masalah bukan sekadar “ada object”. Masalahnya:

- berapa banyak allocation per detik?
- object mati cepat atau hidup lama?
- apakah JIT bisa mengeliminasi allocation?
- apakah string benar-benar dibutuhkan?
- apakah buffer bisa dipakai ulang?
- apakah workload memory-bound?

### 0.3.10 Reachability dan garbage collection

Garbage collector tidak mencari object yang “sudah tidak dipakai” menurut niat manusia. GC mencari object yang **tidak reachable** dari root tertentu.

GC roots bisa mencakup:

- local variable di thread stack;
- static fields;
- JNI references;
- monitor references;
- class loader reachable graph;
- internal JVM structures.

Object yang masih reachable tidak akan dikumpulkan, walaupun secara bisnis sudah tidak berguna.

Contoh memory leak:

```java
class Cache {
    private final Map<String, byte[]> data = new HashMap<>();

    void put(String key, byte[] value) {
        data.put(key, value);
    }
}
```

Jika entry tidak pernah dihapus, semua `byte[]` tetap reachable melalui `Cache.data`.

Bagi GC, ini bukan garbage.

Mental model:

```text
Memory leak di Java sering berarti unwanted reachability, bukan pointer hilang seperti di C.
```

### 0.3.11 Stack, frame, dan method call

Setiap thread punya call stack. Setiap method call membuat frame. Frame berisi:

- local variables;
- operand stack;
- reference ke runtime constant pool;
- return information.

Jika rekursi terlalu dalam:

```java
void recurse() {
    recurse();
}
```

Maka terjadi:

```text
StackOverflowError
```

Ini berbeda dari heap OOM. Thread stack adalah area memory berbeda.

Di container, terlalu banyak platform thread bisa menghabiskan native memory karena setiap thread punya stack.

Virtual thread mengubah economics thread, tetapi bukan berarti semua batas hilang. Virtual thread tetap punya continuation/state dan tetap bisa menekan scheduler, heap, atau dependency eksternal jika tidak ada limit/backpressure.

### 0.3.12 Threads, scheduling, dan concurrency

Java punya model concurrency kaya:

- platform thread;
- virtual thread;
- synchronized;
- volatile;
- locks;
- atomics;
- executors;
- fork/join;
- completable future;
- structured concurrency;
- scoped values;
- concurrent collections.

Tetapi concurrency bukan hanya “menjalankan banyak hal sekaligus”. Concurrency adalah tentang koordinasi state, ordering, cancellation, failure propagation, dan resource limit.

Pertanyaan concurrency yang benar:

- Data apa yang shared?
- Siapa owner state?
- Apa invariant yang harus dijaga?
- Apakah visibility dijamin?
- Apakah update atomic?
- Apa batas parallelism?
- Apa yang terjadi saat task gagal?
- Apa yang terjadi saat task lambat?
- Apa yang terjadi saat parent request dibatalkan?
- Apakah cancellation sampai ke child task?
- Apakah timeout meninggalkan pekerjaan zombie?

Virtual thread mempermudah blocking concurrency, tetapi tidak menghapus kebutuhan desain:

```text
Virtual thread menyelesaikan sebagian cost thread, bukan menyelesaikan distributed systems failure.
```

Jika kamu membuat 100.000 virtual thread yang semuanya memanggil database dengan pool 50 connection, bottleneck tetap database pool. Tanpa backpressure, hasilnya bisa timeout storm.

### 0.3.13 Safepoints

Safepoint adalah titik di mana thread Java bisa dihentikan sementara agar JVM melakukan operasi global tertentu, misalnya sebagian operasi GC, deoptimization, biased-locking era lama, class redefinition, thread dump, dan operasi runtime lain.

Sebagai engineer aplikasi, kamu tidak selalu perlu memikirkan safepoint. Namun untuk performance troubleshooting, safepoint penting karena bisa menyebabkan pause yang terlihat seperti aplikasi “diam”.

Gejala:

- latency spike tanpa CPU tinggi;
- semua thread tampak berhenti sebentar;
- GC log menunjukkan pause;
- JFR menunjukkan safepoint event.

Mental model:

```text
Tidak semua pause Java adalah business logic lambat. Sebagian pause berasal dari koordinasi runtime.
```

### 0.3.14 Native boundary

Java sering berinteraksi dengan kode native:

- JNI;
- Foreign Function & Memory API;
- direct buffer;
- file I/O;
- socket I/O;
- TLS library;
- compression library;
- OS call;
- container runtime;
- monitoring agent;
- database driver native component tertentu.

Native boundary penting karena:

- memory bisa berada di luar heap;
- leak bisa terjadi di native memory;
- GC tidak mengelola semua memory;
- crash bisa menjadi JVM crash, bukan Java exception;
- observability bisa lebih sulit;
- security boundary lebih sensitif.

Contoh:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
```

Direct buffer menggunakan memory di luar heap Java. Heap terlihat aman, tetapi process RSS bisa naik.

Mental model:

```text
Heap kecil bukan berarti memory process kecil.
```

Ini sangat penting di Kubernetes. Pod bisa OOMKilled walaupun heap belum mencapai `-Xmx`, karena total memory process meliputi heap + metaspace + thread stacks + direct buffers + code cache + GC structures + native libraries + mmap + allocator overhead.

### 0.3.15 Observability: melihat mesin hidup

Untuk memahami Java production system, kamu perlu alat observability:

- logs;
- metrics;
- traces;
- thread dumps;
- heap dumps;
- GC logs;
- JFR recordings;
- profiler;
- native memory tracking;
- OS/container metrics.

Mapping sederhana:

| Pertanyaan | Alat |
|---|---|
| Request mana yang lambat? | tracing, access log, metrics |
| Method mana yang makan CPU? | profiler, JFR |
| Object apa yang banyak dialokasi? | allocation profile, JFR, heap dump |
| Thread kenapa menunggu? | thread dump, JFR monitor events |
| GC kenapa sering? | GC log, JFR, heap telemetry |
| Memory bocor di mana? | heap dump, dominator tree |
| Native memory naik kenapa? | native memory tracking, OS RSS |
| Pool habis? | app metrics, thread dump, DB metrics |
| Pod mati kenapa? | Kubernetes events, container logs, cgroup metrics |

Top-tier Java engineer tidak hanya “menambahkan log”. Ia tahu alat mana untuk pertanyaan mana.

---

## 0.4 Java Release Model

Java modern tidak lagi bergerak seperti era Java 6/7/8 yang menunggu bertahun-tahun untuk rilis besar. Sejak Java 10, JDK memakai model feature release berbasis waktu. JEP 3 mendefinisikan JDK release process, dengan siklus feature release yang dimulai setiap enam bulan.

### 0.4.1 Feature release vs LTS

Ada dua konsep yang sering dicampur:

1. **Feature release**  
   Rilis Java reguler yang membawa fitur, enhancement, deprecation, removal, bug fix, performance improvement.

2. **LTS release**  
   Rilis yang oleh banyak vendor diberi long-term support lebih panjang.

Java 25 adalah release penting karena:

- merupakan Reference Implementation Java SE 25;
- mencapai General Availability pada 16 September 2025;
- menjadi LTS dari banyak vendor;
- menggantikan Java 21 sebagai LTS terbaru dalam banyak roadmap vendor;
- membawa 18 JEP di JDK 25;
- memuat banyak fitur yang terintegrasi sejak Java 21.

Namun LTS bukan berarti “fiturnya lebih benar secara teknis”. LTS adalah keputusan support lifecycle vendor. Dari sisi engineering, kamu tetap harus membaca:

- fitur final;
- fitur preview;
- fitur incubator;
- fitur experimental;
- deprecation;
- removal;
- compatibility notes;
- support matrix framework/library.

### 0.4.2 Preview, incubator, experimental, final

Java punya beberapa status fitur.

#### Final feature

Fitur final adalah fitur standar yang sudah menjadi bagian stabil dari platform/language/API.

Contoh di Java 25:

- `ScopedValue` final;
- `Compact Source Files and Instance Main Methods` final;
- `Flexible Constructor Bodies` final;
- `Module Import Declarations` final;
- `Key Derivation Function API` final.

Tetap perlu memahami konteks penggunaannya, tetapi risiko perubahan API/signature jauh lebih rendah dibanding preview/incubator.

#### Preview feature

Preview feature adalah fitur yang sudah cukup matang untuk dicoba, tetapi belum final. Ia bisa berubah atau dihapus di rilis berikutnya.

Implikasi:

- butuh flag `--enable-preview` untuk compile/run;
- tidak ideal untuk library publik yang harus stabil tanpa policy jelas;
- cocok untuk eksplorasi, prototype, atau production terbatas jika organisasi sadar risiko.

Contoh Java 25:

- Structured Concurrency masih preview;
- Stable Values preview;
- PEM Encodings of Cryptographic Objects preview;
- Primitive Types in Patterns, `instanceof`, and `switch` third preview.

#### Incubator feature

Incubator feature biasanya berupa API/module yang masih sangat eksploratif. Tujuannya mendapatkan feedback.

Contoh Java 25:

- Vector API tenth incubator.

Incubator lebih hati-hati lagi untuk production adoption.

#### Experimental feature

Experimental feature lebih rendah stabilitasnya. Bisa berubah, bisa dihapus, dan biasanya perlu flag khusus.

Contoh Java 25:

- JFR CPU-Time Profiling experimental.

### 0.4.3 Deprecation dan removal

Deprecation bukan dekorasi. Deprecation adalah sinyal desain platform.

Ada dua jenis praktis:

- deprecated tetapi belum direncanakan segera dihapus;
- deprecated for removal.

Jika API/option ditandai for removal, kamu harus membuat migration plan.

Java 25 juga memiliki removal dan deprecation. Misalnya JDK 25 menghapus 32-bit x86 port, dan release notes memuat berbagai perubahan/deprecation yang bisa memengaruhi migration.

Mental model:

```text
Upgrade Java bukan hanya “ganti versi JDK”. Upgrade adalah compatibility project.
```

Checklist upgrade:

- source compatibility;
- binary compatibility;
- behavioral compatibility;
- build tool compatibility;
- plugin compatibility;
- framework compatibility;
- agent compatibility;
- runtime option compatibility;
- container image compatibility;
- GC behavior;
- TLS/security provider behavior;
- timezone data;
- deprecation/removal;
- performance regression;
- observability validation.

### 0.4.4 Java 25 sebagai target belajar

Kenapa belajar hingga Java 25 berbeda dari belajar Java 8?

Karena Java modern punya paradigma baru:

- records untuk data carrier;
- sealed classes untuk closed domain hierarchy;
- pattern matching untuk deconstruction dan branching lebih aman;
- switch expression untuk expression-oriented style;
- virtual threads untuk blocking concurrency dengan footprint lebih kecil;
- scoped values untuk context propagation yang lebih mudah dipikirkan dibanding `ThreadLocal` di banyak skenario;
- structured concurrency untuk mengelola task related sebagai unit kerja;
- foreign function & memory API untuk native interop modern;
- stream gatherers untuk custom intermediate stream operations;
- class-file API untuk manipulasi class file lebih terstruktur;
- AOT-related improvements untuk startup/warmup direction;
- JFR improvements untuk observability;
- GC improvement di G1, ZGC, dan Shenandoah;
- security dan integrity-by-default direction yang makin membatasi akses internal berbahaya.

Namun Java modern tetap membawa warisan lama:

- null masih ada;
- type erasure masih ada;
- checked exception masih ada;
- classpath masih ada;
- mutable object masih default;
- reflection masih banyak dipakai;
- Spring proxy behavior masih relevan;
- ORM impedance mismatch masih relevan;
- thread safety tetap sulit;
- distributed system tetap sulit.

Jadi belajar Java 25 bukan berarti mengabaikan Java lama. Java modern adalah lapisan baru di atas kompatibilitas panjang.

### 0.4.5 Strategi adopsi versi di organisasi

Untuk organisasi, ada beberapa strategi:

#### Strategi konservatif

- production pakai LTS;
- upgrade antar LTS;
- preview/incubator tidak dipakai;
- dependency harus support resmi;
- migration window jelas;
- cocok untuk regulated enterprise.

Kelebihan:

- stabil;
- mudah diaudit;
- risiko rendah.

Kekurangan:

- lambat mengadopsi fitur;
- technical debt bisa menumpuk saat lompat versi terlalu jauh.

#### Strategi progressive LTS

- production pakai LTS terbaru setelah periode stabilisasi;
- development/test mencoba feature release non-LTS;
- library/framework diuji lebih awal;
- upgrade rehearsal rutin.

Kelebihan:

- risiko upgrade lebih terkendali;
- tim tidak kaget saat LTS baru;
- menemukan incompatibility lebih awal.

Kekurangan:

- butuh disiplin CI dan compatibility matrix.

#### Strategi latest feature release

- selalu mendekati versi terbaru;
- cocok untuk tim kecil dengan ownership kuat;
- butuh automated test, dependency update cepat, dan monitoring kuat.

Kelebihan:

- fitur/performance/security terbaru cepat masuk.

Kekurangan:

- support lifecycle pendek;
- lebih sering upgrade;
- vendor/framework support harus dicek ketat.

Untuk sistem enterprise/regulatory, strategi yang paling masuk akal biasanya:

```text
production: LTS stabil
pre-prod/lab: feature release terbaru untuk early compatibility testing
policy: preview/incubator hanya dengan approval eksplisit
```

---

## 0.5 Peta Besar Java hingga Versi 25

Bagian ini bukan daftar lengkap fitur per versi. Tujuannya memberi peta evolusi sehingga kamu tahu kenapa Java modern terlihat seperti sekarang.

### 0.5.1 Era Java awal: object-oriented platform

Java awal populer karena:

- memory safety dibanding C/C++;
- garbage collection;
- standard library cukup kaya;
- JVM portability;
- applet/server-side/enterprise adoption;
- threading built-in;
- exception model;
- class loading;
- security model historis.

Fondasi yang masih relevan:

- class;
- interface;
- inheritance;
- exception;
- thread;
- synchronization;
- collection;
- class loader;
- bytecode.

### 0.5.2 Era Java 5: generics, annotations, concurrency utilities

Java 5 sangat penting karena membawa:

- generics;
- annotations;
- enhanced for loop;
- enum;
- autoboxing/unboxing;
- varargs;
- `java.util.concurrent`.

Banyak framework modern lahir dari kombinasi annotations + reflection + classpath scanning.

Contoh:

```java
@Service
@Transactional
class CaseService {
}
```

Annotation membuat metadata bisa ditempel di source. Reflection membuat metadata bisa dibaca runtime. Proxy/AOP membuat behavior bisa disisipkan.

### 0.5.3 Era Java 8: lambda, stream, default method, Date-Time API

Java 8 mengubah gaya pemrograman Java:

- lambda;
- method reference;
- functional interfaces;
- stream API;
- `Optional`;
- default methods;
- `java.time`.

Dampaknya besar:

- API lebih composable;
- callback lebih natural;
- collection processing lebih ekspresif;
- library bisa berevolusi dengan default method;
- date-time model jauh lebih baik.

Namun juga muncul misuse:

- stream terlalu panjang;
- `Optional` dipakai sebagai field/entity property;
- parallel stream dipakai untuk blocking I/O;
- lambda dengan side effect berlebihan;
- functional style tanpa error model jelas.

### 0.5.4 Era Java 9+: module system dan strong encapsulation

Java 9 membawa JPMS/module system.

Tujuannya:

- modularisasi JDK;
- strong encapsulation;
- reliable configuration;
- mengurangi ketergantungan ke internal API;
- custom runtime image dengan `jlink`.

Namun banyak aplikasi enterprise tetap memakai classpath. Artinya Java modern hidup dalam dua dunia:

- classpath legacy;
- module path modern.

Keduanya perlu dipahami.

### 0.5.5 Era Java 14–17: records, sealed classes, pattern matching direction

Java 14–17 membawa fitur language modern yang sangat penting untuk modeling:

- records;
- sealed classes;
- pattern matching for `instanceof`;
- switch expression;
- text blocks.

Untuk domain modeling, fitur ini sangat berguna.

Contoh command model:

```java
sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase {}

record SubmitCase(String caseId, String submittedBy) implements CaseCommand {}
record ApproveCase(String caseId, String approvedBy) implements CaseCommand {}
record RejectCase(String caseId, String rejectedBy, String reason) implements CaseCommand {}
```

Dengan sealed interface, compiler tahu semua subtype yang sah. Ini membantu exhaustive handling.

### 0.5.6 Era Java 21: virtual threads dan modern concurrency

Java 21 sebagai LTS besar membawa virtual threads final.

Virtual thread mengubah economics concurrency untuk aplikasi blocking I/O.

Sebelumnya, banyak aplikasi memakai async/reactive style karena platform thread mahal. Dengan virtual thread, blocking code bisa lebih scalable untuk banyak use case I/O-bound.

Namun virtual thread bukan silver bullet.

Virtual thread membantu:

- membuat thread-per-request feasible;
- mengurangi kebutuhan callback kompleks;
- menyederhanakan blocking I/O service;
- meningkatkan concurrency dengan footprint lebih kecil.

Virtual thread tidak otomatis menyelesaikan:

- database bottleneck;
- external service limit;
- lock contention;
- CPU-bound work;
- bad transaction boundary;
- retry storm;
- memory pressure;
- missing backpressure.

### 0.5.7 Era Java 25: stabilisasi dan perluasan Java modern

JDK 25 membawa 18 JEP. Dari sudut pandang mental model, area pentingnya:

#### Language productivity

- Compact Source Files and Instance Main Methods;
- Flexible Constructor Bodies;
- Module Import Declarations;
- Primitive Types in Patterns preview.

Ini membuat Java lebih ramah untuk awal belajar dan scripting kecil, tetapi tetap menjaga jalan menuju program besar.

#### Concurrency/context propagation

- Scoped Values final;
- Structured Concurrency preview.

Ini melanjutkan arah Project Loom: bukan hanya thread lebih murah, tetapi struktur concurrency lebih mudah dipikirkan.

#### Performance/runtime

- Ahead-of-Time command-line ergonomics;
- Ahead-of-Time method profiling;
- Compact Object Headers;
- Generational Shenandoah;
- JFR improvements.

Ini menunjukkan arah Java modern: startup, footprint, profiling, dan observability menjadi perhatian besar.

#### Security/crypto

- Key Derivation Function API;
- PEM Encodings preview;
- post-quantum crypto additions dari JDK 24;
- integrity-by-default direction.

#### Tooling/serviceability

- JFR Cooperative Sampling;
- JFR CPU-Time Profiling experimental;
- JFR Method Timing & Tracing.

Ini penting untuk production engineer karena Java terus memperkuat kemampuan melihat runtime tanpa selalu bergantung pada external profiler.

---

## 0.6 Cara Belajar Java agar Tidak Terjebak Framework-First Thinking

Framework-first thinking adalah pola belajar seperti ini:

```text
Spring Boot dulu → copy pattern → jalan → production issue → bingung
```

Pendekatan yang lebih kuat:

```text
Java semantics → runtime mechanics → library design → framework behavior → production operation
```

### 0.6.1 Prinsip 1: Selalu tanya “ini terjadi di layer mana?”

Saat melihat fitur atau bug, klasifikasikan layernya.

Contoh:

```java
@Transactional
public void submit() {
    validate();
    save();
}
```

Pertanyaan layer:

- `@Transactional` adalah annotation: language metadata.
- Spring membaca annotation: reflection/framework layer.
- Transaction biasanya diterapkan via proxy: runtime/proxy layer.
- Database commit/rollback: persistence layer.
- Isolation dan lock: database layer.
- Error propagation: application semantics.

Jika `@Transactional` tidak bekerja, penyebab bisa:

- method tidak public;
- self-invocation bypass proxy;
- class tidak menjadi bean;
- wrong transaction manager;
- exception type tidak memicu rollback sesuai policy;
- async call keluar dari transaction context;
- database autocommit behavior;
- reactive vs imperative transaction mismatch.

Tanpa layer thinking, debugging menjadi trial-error.

### 0.6.2 Prinsip 2: Bedakan API contract dan implementation detail

Java punya spesifikasi dan implementasi.

Contoh:

- JLS mendefinisikan bahasa.
- JVMS mendefinisikan virtual machine.
- Java SE API mendefinisikan API standar.
- HotSpot mengimplementasikan JVM.
- G1/ZGC/Shenandoah adalah GC implementation.
- Spring mengimplementasikan framework behavior di atas Java.

Jangan mengandalkan implementation detail kecuali sadar risiko.

Contoh:

```java
HashMap<String, Integer> map = new HashMap<>();
```

API contract tidak menjamin ordering. Jika program bergantung pada order iterasi `HashMap`, itu bug desain. Gunakan `LinkedHashMap` jika order insertion dibutuhkan.

### 0.6.3 Prinsip 3: Pelajari happy path dan failure path bersamaan

Saat belajar fitur, jangan hanya bertanya:

> “Bagaimana cara pakainya?”

Tanya juga:

- Bagaimana ia gagal?
- Apa exception-nya?
- Apa resource yang perlu ditutup?
- Apa yang terjadi jika input null?
- Apa yang terjadi jika timeout?
- Apakah thread-safe?
- Apakah blocking?
- Apakah allocate banyak object?
- Apakah bisa diprofiling?
- Apa metric yang relevan?

Contoh belajar `ExecutorService`.

Happy path:

```java
var executor = Executors.newFixedThreadPool(10);
executor.submit(task);
```

Failure path:

- executor tidak di-shutdown;
- queue unbounded;
- task exception hilang jika `Future` tidak dicek;
- rejection policy tidak dipahami;
- blocking task menyebabkan starvation;
- thread name tidak informatif;
- context propagation hilang;
- shutdown tidak graceful;
- cancellation tidak di-handle.

### 0.6.4 Prinsip 4: Jangan percaya benchmark tanpa model

Benchmark Java sulit karena:

- JIT warmup;
- dead-code elimination;
- constant folding;
- escape analysis;
- GC interference;
- CPU frequency scaling;
- OS scheduling;
- allocation profile;
- branch prediction;
- cache effect;
- logging/measurement overhead.

Rule:

```text
Microbenchmark tanpa JMH hampir selalu mencurigakan.
Production performance tanpa profiling hampir selalu spekulatif.
```

### 0.6.5 Prinsip 5: Baca dokumentasi resmi untuk boundary

Untuk top-tier Java, kamu tidak harus hafal seluruh JLS/JVMS. Tetapi kamu harus tahu kapan harus membuka dokumen yang tepat.

Gunakan:

- JLS saat bingung syntax/semantics bahasa;
- JVMS saat bingung class file, bytecode, class loading, initialization, runtime data areas;
- Java SE API docs saat butuh contract API;
- JDK tool docs saat memakai `jcmd`, `jlink`, `jpackage`, `jfr`, dll.;
- release notes saat migration;
- JEP saat ingin memahami motivasi fitur.

### 0.6.6 Prinsip 6: Gunakan “small executable experiments”

Belajar Java paling efektif jika setiap konsep diuji dengan program kecil.

Contoh eksperimen:

1. class initialization order;
2. `equals/hashCode` broken behavior di `HashMap`;
3. `volatile` visibility;
4. deadlock dua lock;
5. bounded vs unbounded executor queue;
6. heap dump dari cache leak;
7. GC log allocation-heavy loop;
8. JFR recording untuk CPU hot method;
9. virtual thread dengan blocking sleep vs DB pool kecil;
10. classpath conflict dengan dua versi library.

Belajar bukan hanya membaca. Belajar Java yang kuat harus melihat runtime behavior.

---

## 0.7 Checklist Pemahaman Bagian 0

Kamu dianggap memahami bagian ini jika bisa menjelaskan hal-hal berikut tanpa menghafal kata-kata:

### Java sebagai sistem

- [ ] Bisa membedakan Java language, Java platform, JVM, JDK, dan ecosystem.
- [ ] Bisa menjelaskan perbedaan JLS dan JVMS.
- [ ] Bisa menjelaskan kenapa source code bukan runtime truth.
- [ ] Bisa menjelaskan alur `.java → .class → JVM → machine code`.
- [ ] Bisa menjelaskan kenapa Java portable lewat class file/JVM.

### Runtime mental model

- [ ] Bisa menjelaskan class loading secara high-level.
- [ ] Bisa menjelaskan kenapa class identity melibatkan class loader.
- [ ] Bisa menjelaskan linking dan initialization secara high-level.
- [ ] Bisa menjelaskan interpreter, profiling, JIT, dan warmup.
- [ ] Bisa menjelaskan heap, stack, native memory secara terpisah.
- [ ] Bisa menjelaskan reachability sebagai dasar GC.
- [ ] Bisa menjelaskan kenapa memory leak di Java berarti unwanted reachability.

### Concurrency dan production

- [ ] Bisa menjelaskan kenapa thread bukan hanya soal parallelism.
- [ ] Bisa menjelaskan bahwa virtual thread bukan silver bullet.
- [ ] Bisa menjelaskan pentingnya timeout, cancellation, backpressure, dan failure propagation.
- [ ] Bisa membedakan CPU-bound dan I/O-bound workload.
- [ ] Bisa menjelaskan kenapa pod bisa OOM walau heap belum penuh.

### Release dan adoption

- [ ] Bisa menjelaskan feature release vs LTS.
- [ ] Bisa menjelaskan final vs preview vs incubator vs experimental.
- [ ] Bisa menjelaskan kenapa upgrade JDK adalah compatibility project.
- [ ] Bisa membuat policy adopsi fitur Java baru untuk tim enterprise.

### Engineering maturity

- [ ] Bisa menjelaskan cost of abstraction.
- [ ] Bisa menanyakan failure mode dari setiap design.
- [ ] Bisa mencari layer tempat bug terjadi.
- [ ] Bisa memilih alat observability sesuai pertanyaan.
- [ ] Bisa membedakan “bisa jalan” dan “production-grade”.

---

## 0.8 Latihan Mental Model

Latihan ini tidak butuh jawaban panjang. Tujuannya melatih cara berpikir.

### Latihan 1 — Layer classification

Untuk setiap kasus, tentukan layer paling mungkin:

1. `NoSuchMethodError` saat runtime setelah upgrade dependency.
2. `OutOfMemoryError: Java heap space` setelah traffic naik.
3. Pod Kubernetes OOMKilled, tetapi heap metrics tidak mencapai `-Xmx`.
4. `@Transactional` tidak rollback.
5. Request pertama setelah deploy lambat, request berikutnya cepat.
6. `ClassCastException: User cannot be cast to User`.
7. Latency naik, CPU rendah, thread dump banyak WAITING ke DB pool.
8. Compile sukses di local, gagal di CI karena annotation processor.
9. Aplikasi JDK 25 gagal jalan di runtime JDK 21.
10. Log volume tinggi membuat latency naik.

Jawaban ringkas:

1. binary/dependency compatibility;
2. heap/GC/allocation/reachability;
3. native/process/container memory;
4. framework proxy/transaction semantics;
5. class loading/JIT warmup/lazy initialization;
6. class loader identity;
7. resource pool starvation/backpressure;
8. build tool/compiler/plugin layer;
9. class file version/runtime mismatch;
10. observability/logging I/O backpressure.

### Latihan 2 — Failure-first design

Ambil fitur sederhana:

```java
void approveCase(String caseId, String approverId)
```

Tanyakan:

- Apa invariant domain?
- Apa state sebelum/sesudah?
- Apa yang terjadi jika case tidak ditemukan?
- Apa yang terjadi jika approver tidak berwenang?
- Apa yang terjadi jika case sudah approved?
- Apa yang terjadi jika request dikirim dua kali?
- Apa yang terjadi jika database commit berhasil tapi event publish gagal?
- Apa audit trail wajib?
- Apa correlation ID?
- Apa metric failure?
- Apakah operation idempotent?
- Apakah retry aman?
- Apakah error user-facing berbeda dari technical error?

Ini adalah cara berpikir Java engineer yang bergerak dari method ke system behavior.

### Latihan 3 — Runtime prediction

Prediksi apa yang terjadi:

```java
class A {
    static final B b = new B();
    static {
        System.out.println("A init");
    }
}

class B {
    static {
        System.out.println("B init");
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println("start");
        A a = new A();
    }
}
```

Pertanyaan:

- Kapan `A` di-load?
- Kapan `A` di-initialize?
- Kapan `B` di-initialize?
- Urutan output apa?
- Apa bedanya loading dan initialization?

Tujuannya bukan sekadar menjawab output. Tujuannya sadar bahwa class initialization punya urutan dan side effect.

### Latihan 4 — Upgrade policy

Bayangkan timmu ingin upgrade dari Java 21 ke Java 25.

Buat checklist:

- JDK vendor apa?
- Build tool versi berapa?
- Maven/Gradle plugin support?
- Spring Boot versi support Java 25?
- Hibernate/Jackson/Netty/Kafka client support?
- Annotation processor support?
- Lombok/MapStruct support?
- CI image update?
- Docker base image update?
- Runtime flags masih valid?
- GC default/selected masih sesuai?
- Observability agent support?
- Security scanner support?
- Performance baseline sebelum/sesudah?
- Load test?
- Rollback plan?
- Preview feature policy?

---

## 0.9 Ringkasan Eksekutif

Java harus dipahami sebagai sistem berlapis, bukan sekadar bahasa.

Layer utamanya:

```text
Language → Compiler → Class File → JVM → Runtime Memory → Concurrency → Libraries → Framework → Production Environment
```

JLS menjelaskan bahasa Java. JVMS menjelaskan mesin virtual yang mengeksekusi class file. Java SE API mendefinisikan library standar. JDK menyediakan tool dan implementasi. HotSpot adalah implementasi JVM yang umum. Framework seperti Spring berdiri di atas semua itu.

Top-tier Java engineer tidak hanya bisa menulis kode. Ia bisa:

- menjaga invariant;
- memahami runtime behavior;
- membaca failure mode;
- menilai cost of abstraction;
- membedakan compatibility source/binary/behavioral/operational;
- memakai observability dengan tepat;
- memilih fitur baru berdasarkan maturity dan trade-off;
- melakukan migration dengan aman;
- mendesain sistem yang bisa dipahami, diuji, dioperasikan, dan dipertanggungjawabkan.

Java 25 adalah target belajar yang bagus karena ia membawa banyak fitur modern sambil tetap mempertahankan kompatibilitas ekosistem Java. Tetapi Java 25 juga menuntut disiplin: pahami mana fitur final, preview, incubator, dan experimental.

Kalimat kunci untuk membawa ke bagian berikutnya:

```text
Jangan belajar Java sebagai daftar fitur. Pelajari Java sebagai runtime system yang kebetulan menyediakan bahasa yang sangat stabil dan ekosistem yang sangat besar.
```

---

## Referensi Utama

Referensi berikut digunakan sebagai dasar penyusunan bagian ini. Materi di atas adalah penjelasan dan sintesis, bukan salinan dari dokumen sumber.

1. Oracle, **JDK 25 Documentation**  
   https://docs.oracle.com/en/java/javase/25/

2. Oracle, **Java SE 25 & JDK 25 Specifications**  
   https://docs.oracle.com/en/java/javase/25/docs/specs/index.html

3. Oracle, **The Java Language Specification, Java SE 25 Edition**  
   https://docs.oracle.com/javase/specs/jls/se25/html/

4. Oracle, **The Java Virtual Machine Specification, Java SE 25 Edition**  
   https://docs.oracle.com/javase/specs/jvms/se25/html/index.html

5. OpenJDK, **JDK 25 Project Page**  
   https://openjdk.org/projects/jdk/25/

6. OpenJDK, **JEPs in JDK 25 integrated since JDK 21**  
   https://openjdk.org/projects/jdk/25/jeps-since-jdk-21

7. OpenJDK, **Java 25 / JDK 25 General Availability announcement**  
   https://mail.openjdk.org/pipermail/jdk-dev/2025-September/010483.html

8. OpenJDK, **JEP 3: JDK Release Process**  
   https://openjdk.org/jeps/3

9. Oracle, **Consolidated JDK 25 Release Notes**  
   https://www.oracle.com/anz/java/technologies/javase/25all-relnotes.html

---

## Lanjut ke Bagian 1

Bagian berikutnya sebaiknya masuk ke:

```text
Bagian 1 — Setup, Toolchain, dan Cara Kerja Build Java Modern
```

Fokus Bagian 1:

- memilih JDK distribution;
- struktur JDK;
- command-line tools;
- `javac`, `java`, `jar`, `jdeps`, `jlink`, `jpackage`, `jcmd`, `jfr`;
- Maven vs Gradle mental model;
- dependency graph;
- classpath vs module path;
- runtime configuration;
- project layout production-grade.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-030](.jakarta/validation/learn-java-validation-jakarta-hibernate-validator-part-030.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 001 — Setup, Toolchain, dan Cara Kerja Build Java Modern hingga Java 25](./learn-java-part-001.md)
