# learn-java-oop-functional-reflection-codegen-modules-part-000

# Part 000 — Orientation: Mental Model Besar Java Program Structure

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Fokus: Java OOP, Functional Programming, Reflection, Code Generation, Modules, Package Management  
> Level: Advanced / architecture-aware / library-design-aware / runtime-aware  
> Status seri: **belum selesai** — ini adalah bagian 0 dari 30.

---

## 0. Tujuan Bagian Ini

Bagian ini bukan tutorial syntax Java.

Bagian ini adalah **peta mental** untuk membaca Java sebagai sebuah sistem berlapis:

1. source code yang ditulis developer,
2. type system yang divalidasi compiler,
3. class file yang dieksekusi JVM,
4. object graph yang hidup di runtime,
5. package boundary yang mengatur struktur source/API,
6. module boundary yang mengatur readability dan encapsulation,
7. artifact dependency yang dikelola build tool,
8. runtime image/classpath/module path yang menentukan apa yang benar-benar tersedia saat aplikasi berjalan.

Seorang engineer yang kuat tidak hanya bertanya:

> “Bagaimana cara menulis class ini?”

Tetapi bertanya:

> “Apa invariant yang dijaga class ini?”  
> “Apa boundary API-nya?”  
> “Apa yang diketahui compiler?”  
> “Apa yang baru diketahui runtime?”  
> “Apakah ini aman untuk reflection?”  
> “Apakah ini kompatibel jika library berevolusi?”  
> “Apakah package/module/artifact boundary-nya sesuai dependency direction?”

Part ini membangun fondasi untuk menjawab pertanyaan-pertanyaan itu.

---

## 1. Apa yang Dipelajari di Seri Ini

Seri ini membahas lima wilayah besar Java yang sering dipelajari terpisah, padahal di sistem nyata mereka saling memengaruhi.

```text
Java Program Structure
├── Object-Oriented Model
│   ├── class
│   ├── object
│   ├── inheritance
│   ├── interface
│   ├── polymorphism
│   ├── record
│   ├── enum
│   └── sealed hierarchy
│
├── Functional Model
│   ├── lambda
│   ├── functional interface
│   ├── method reference
│   ├── function composition
│   ├── effect boundary
│   └── result/error modeling
│
├── Runtime Introspection & Dynamic Access
│   ├── reflection
│   ├── annotations
│   ├── method handles
│   ├── var handles
│   ├── proxies
│   └── framework mechanics
│
├── Code Generation & Metaprogramming
│   ├── annotation processing
│   ├── source generation
│   ├── bytecode generation
│   ├── runtime generation
│   ├── agents/instrumentation
│   └── generated-code governance
│
└── Packaging, Modules, and Dependency Architecture
    ├── packages
    ├── package-private APIs
    ├── JPMS modules
    ├── exports / opens / requires
    ├── services
    ├── artifact dependencies
    ├── Maven/Gradle governance
    └── API evolution
```

Tujuannya bukan sekadar tahu fitur. Tujuannya adalah mampu merancang sistem Java yang:

- jelas invariant-nya,
- kecil dan stabil public API-nya,
- tidak bocor internal detail-nya,
- kompatibel terhadap evolusi,
- dapat diuji,
- dapat di-refactor,
- tidak rapuh terhadap framework magic,
- tidak kacau dependency graph-nya,
- dan bisa dipahami oleh manusia maupun tooling.

---

## 2. Apa yang Tidak Akan Diulang

Agar belajar efisien, seri ini sengaja tidak mengulang materi yang sudah masuk di seri lain.

Tidak akan fokus pada:

- dasar syntax Java,
- Collections API umum,
- Stream API dasar,
- concurrency, threads, virtual threads, reactive,
- JDBC, SQL, HikariCP,
- I/O, NIO, networking,
- cryptography/security,
- Jakarta/JAX-RS,
- DSA,
- reliability/graceful shutdown.

Namun beberapa konsep mungkin disinggung ketika relevan untuk desain type, API, module, atau boundary. Contoh:

- `Stream` tidak dibahas ulang sebagai collection pipeline, tetapi functional composition dan effect boundary tetap dibahas.
- `ServiceLoader` tidak dibahas sebagai “cara load plugin” saja, tetapi sebagai bagian dari JPMS service boundary.
- Annotation tidak dibahas sebagai “cara pakai annotation Spring”, tetapi sebagai metadata design, retention, processing, dan compatibility.

---

## 3. Lima Lensa Membaca Java

Untuk menjadi kuat dalam Java tingkat lanjut, kita perlu membaca satu potongan kode dari beberapa lensa sekaligus.

Misalnya:

```java
public sealed interface PaymentCommand
        permits AuthorizePayment, CapturePayment, RefundPayment {
}

public record AuthorizePayment(String orderId, long amount) implements PaymentCommand {
    public AuthorizePayment {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("orderId is required");
        }
        if (amount <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
    }
}
```

Kode ini bisa dibaca dari beberapa sudut.

### 3.1 Source-Level Lens

Apa yang terlihat di source code?

- Ada `sealed interface`.
- Ada `record`.
- Ada validasi di compact constructor.
- Ada finite set command types lewat `permits`.

Ini level yang biasanya dipahami developer menengah.

### 3.2 Type-System Lens

Apa yang diketahui compiler?

- `AuthorizePayment` adalah subtype dari `PaymentCommand`.
- Implementasi `PaymentCommand` dibatasi oleh `permits`.
- `AuthorizePayment` memiliki component `orderId` dan `amount`.
- Pattern matching/switch dapat dibuat exhaustive jika hierarchy lengkap diketahui.

Ini penting untuk membuat domain model yang compiler-assisted, bukan hanya convention-based.

### 3.3 Runtime Lens

Apa yang hidup saat runtime?

- Ada class metadata untuk `PaymentCommand`.
- Ada class metadata untuk `AuthorizePayment`.
- Ada object instance dengan state final-like dari record components.
- Reflection dapat membaca bahwa `AuthorizePayment` adalah record.
- Reflection dapat membaca record components.
- Reflection dapat membaca sealed permitted subclasses.

Ini penting untuk framework, serialization, mapper, validator, dan generated code.

### 3.4 API Evolution Lens

Apa risiko ketika kode ini menjadi public API?

- Menambah subtype baru ke sealed hierarchy dapat memengaruhi exhaustive switch consumer.
- Mengubah nama record component dapat merusak source/API expectation.
- Mengubah constructor validation dapat mengubah behavioral compatibility.
- Mengubah package/module export dapat memutus consumer.

Ini level library designer.

### 3.5 Architecture Boundary Lens

Di package/module mana type ini seharusnya berada?

- Apakah ini public command API?
- Apakah ini internal domain command?
- Apakah boleh diakses module lain?
- Apakah perlu diekspor via JPMS `exports`?
- Apakah perlu dibuka via `opens` untuk serialization framework?
- Apakah generated code boleh bergantung langsung pada type ini?

Ini level architecture.

---

## 4. Bedakan: Feature, Model, Contract, Boundary, Artifact

Kesalahan umum engineer adalah menyamakan semua hal sebagai “kode”. Padahal Java punya beberapa unit yang berbeda.

| Istilah | Pertanyaan Utama | Contoh |
|---|---|---|
| Language feature | Apa yang bisa ditulis di source code? | `record`, `sealed`, lambda, annotation |
| Type model | Apa yang diketahui compiler tentang bentuk program? | subtyping, overload, bounds, erasure |
| Runtime model | Apa yang tersedia saat aplikasi berjalan? | object, class metadata, reflection, classloader |
| Contract | Apa janji perilaku yang harus stabil? | `equals/hashCode`, interface method, API semantics |
| Boundary | Siapa boleh mengakses apa? | `private`, package-private, `exports`, `opens` |
| Artifact | Unit hasil build/dependency | `.jar`, Maven module, Gradle subproject |
| Runtime configuration | Bagaimana program dimuat/dijalankan? | classpath, module path, runtime image |

Contoh nyata:

```java
package com.acme.payment.api;

public interface PaymentGateway {
    PaymentResult authorize(PaymentRequest request);
}
```

Kode di atas bukan hanya interface. Ia bisa berarti:

- language feature: `interface`,
- type model: contract untuk subtype,
- API contract: janji ke consumer,
- package boundary: berada di `.api`,
- module boundary: mungkin diekspor,
- artifact boundary: mungkin ada di `payment-api.jar`,
- runtime boundary: implementation bisa ditemukan via DI atau `ServiceLoader`.

Top engineer selalu memisahkan level-level ini agar tidak salah desain.

---

## 5. Java sebagai Statically Typed, Nominal, Object-Oriented Language

Java adalah bahasa dengan **static type checking**: banyak kesalahan type dicegah saat compile time.

Namun Java bukan structural type system seperti TypeScript secara umum. Java terutama menggunakan **nominal typing**: dua type dianggap terkait bukan karena bentuk method-nya sama, tetapi karena deklarasi type relationship eksplisit.

Contoh:

```java
interface Startable {
    void start();
}

final class Engine {
    public void start() {
    }
}
```

Walaupun `Engine` punya method `start()`, `Engine` bukan `Startable` kecuali ditulis:

```java
final class Engine implements Startable {
    @Override
    public void start() {
    }
}
```

Implikasinya besar:

1. API Java mengandalkan deklarasi contract eksplisit.
2. Interface bukan hanya “shape”, tetapi named role.
3. Refactoring type relationship harus sadar binary/source compatibility.
4. Framework yang mencoba structural behavior biasanya harus memakai reflection, proxy, generated code, atau convention.

---

## 6. Java sebagai Runtime Object Model

Di Java, object bukan sekadar data bag.

Object adalah kombinasi dari:

- identity,
- state,
- behavior,
- class metadata,
- synchronization capability,
- lifecycle di heap,
- reference relationship dengan object lain.

Secara konseptual:

```text
Reference variable
    │
    ▼
Object on heap
    ├── object header / runtime metadata association
    ├── fields / state
    └── class identity
            │
            ▼
        Class metadata
        ├── methods
        ├── fields metadata
        ├── constructors metadata
        ├── annotations metadata
        ├── record/sealed metadata
        └── module/package association
```

Contoh:

```java
User user = new User("u-001", "Fajar");
```

Hal yang perlu dibedakan:

| Elemen | Makna |
|---|---|
| `User` sebelah kiri | compile-time type variable |
| `user` | variable/reference holder |
| `new User(...)` | object creation expression |
| object di heap | runtime instance |
| `User.class` | runtime class metadata |
| `User` constructor | initialization mechanism |

Kesalahan mental model yang umum:

> “Variable menyimpan object.”

Lebih akurat:

> Variable reference type menyimpan reference ke object, bukan object-nya secara langsung.

Ini penting untuk memahami aliasing, mutation, equality, object graph, dan defensive copying.

---

## 7. Java sebagai Functional-Capable Language

Java bukan bahasa functional murni, tetapi sejak Java 8 Java punya dukungan kuat untuk functional style:

- lambda expression,
- method reference,
- functional interface,
- default method,
- stream-like composition,
- higher-order API.

Namun functional Java yang matang bukan berarti “semua dibuat chain Stream”.

Functional Java yang matang berarti:

- business transformation dibuat eksplisit,
- effect boundary jelas,
- mutation dilokalisasi,
- fungsi kecil mudah diuji,
- error channel dirancang,
- null handling tidak liar,
- callback/lambda tidak mengaburkan flow.

Contoh desain buruk:

```java
orders.stream()
        .peek(order -> auditRepository.save(toAudit(order)))
        .map(order -> paymentClient.charge(order))
        .filter(result -> result.status().equals("SUCCESS"))
        .forEach(result -> notificationClient.send(result));
```

Masalahnya bukan karena menggunakan Stream. Masalahnya adalah pipeline terlihat seperti transformasi data, padahal berisi side effect besar:

- write audit,
- call external payment,
- send notification.

Lebih jelas:

```java
for (Order order : orders) {
    audit(order);
    PaymentResult result = charge(order);
    if (result.isSuccess()) {
        notifySuccess(result);
    }
}
```

Atau pisahkan pure transformation dari effect:

```java
List<ChargeCommand> commands = orders.stream()
        .map(this::toChargeCommand)
        .toList();

for (ChargeCommand command : commands) {
    processCharge(command);
}
```

Prinsipnya:

> Functional style dipakai ketika memperjelas data transformation dan contract. Jangan dipakai untuk menyembunyikan effectful workflow.

---

## 8. Java sebagai Reflective Platform

Java menyediakan metadata runtime yang bisa dibaca dan dipakai oleh program. Inilah basis banyak framework.

Dengan reflection, program dapat:

- membaca class,
- membaca field,
- membaca method,
- membaca constructor,
- membaca annotation,
- membuat instance,
- memanggil method,
- mengakses field dengan batasan tertentu.

Contoh:

```java
Class<?> type = Class.forName("com.acme.User");
Constructor<?> constructor = type.getConstructor(String.class, String.class);
Object instance = constructor.newInstance("u-001", "Fajar");
```

Reflection membuat Java bisa menjadi platform framework-heavy:

- dependency injection,
- validation,
- serialization/deserialization,
- ORM,
- testing/mocking,
- RPC mapping,
- CLI binding,
- configuration binding,
- plugin discovery.

Tetapi reflection membawa biaya desain:

1. compiler tidak selalu bisa melihat dependency aktual,
2. static analysis menjadi lebih sulit,
3. refactoring bisa diam-diam rusak,
4. JPMS strong encapsulation dapat membatasi deep reflection,
5. runtime failure menggantikan compile-time failure,
6. performance perlu caching dan desain akses yang benar.

Rule of thumb:

> Reflection adalah alat boundary-crossing. Gunakan ketika memang perlu membuat generic mechanism. Jangan gunakan untuk menghindari desain API yang eksplisit.

---

## 9. Java sebagai Metaprogrammable Platform

Metaprogramming berarti program membantu membuat, membaca, mengubah, atau menghubungkan program lain.

Di Java, metaprogramming muncul dalam beberapa bentuk:

```text
Metaprogramming in Java
├── Runtime introspection
│   └── Reflection
│
├── Runtime invocation
│   ├── Reflection Method.invoke
│   ├── MethodHandle
│   └── VarHandle
│
├── Runtime indirection
│   ├── Dynamic proxy
│   ├── InvocationHandler
│   └── class-based proxy libraries
│
├── Compile-time generation
│   └── Annotation processing
│
├── Source/code generation
│   ├── templates
│   ├── schema-driven generation
│   └── model-driven generation
│
├── Bytecode transformation
│   ├── build-time enhancement
│   ├── runtime enhancement
│   └── Java agents
│
└── Module/service discovery
    ├── ServiceLoader
    └── JPMS provides/uses
```

Pertanyaan arsitektural untuk setiap metaprogramming:

| Pertanyaan | Kenapa penting |
|---|---|
| Kapan kode dibuat? | compile time, build time, startup, runtime |
| Siapa owner generated code? | developer, build tool, framework, runtime |
| Apakah hasilnya terlihat oleh IDE? | memengaruhi debugging dan navigation |
| Apakah type-safe? | memengaruhi compile-time guarantee |
| Apakah kompatibel JPMS? | reflection/proxy butuh access boundary |
| Apakah bisa diuji? | generator sering menjadi hidden compiler |
| Apakah stabil terhadap refactoring? | string-based reflection mudah rusak |

Top engineer memperlakukan generator seperti compiler kecil. Generator harus punya:

- input model yang jelas,
- output contract yang jelas,
- error message yang bagus,
- test fixture,
- compatibility policy,
- debugging strategy.

---

## 10. Java sebagai Modular Platform

Sejak Java 9, Java memiliki Java Platform Module System atau JPMS.

JPMS memperkenalkan module sebagai unit program yang lebih kuat daripada package. Package mengelompokkan type dan memberi package-private access. Module mengatur:

- module dependency/readability,
- package mana yang diekspor,
- package mana yang dibuka untuk reflection,
- service usage/provider,
- strong encapsulation.

Contoh:

```java
module com.acme.payment {
    requires com.acme.common;

    exports com.acme.payment.api;

    opens com.acme.payment.internal.model to com.fasterxml.jackson.databind;

    uses com.acme.payment.spi.PaymentProvider;
}
```

Maknanya:

- module ini membaca `com.acme.common`,
- hanya package `com.acme.payment.api` yang diekspor sebagai API,
- package internal model tidak diekspor, tetapi dibuka secara terbatas untuk Jackson,
- module ini menggunakan service provider `PaymentProvider`.

Tanpa JPMS, banyak proyek hanya mengandalkan convention:

```text
com.acme.payment.internal
```

Tetapi convention bisa dilanggar oleh siapa pun yang punya dependency artifact. JPMS memberi enforcement lebih kuat.

Mental model:

```text
Package boundary answers:
  “Type ini dikelompokkan di namespace apa?”
  “Siapa yang bisa memakai package-private member?”

Module boundary answers:
  “Module mana boleh membaca module ini?”
  “Package mana yang menjadi public API?”
  “Package mana yang boleh di-reflect?”

Artifact boundary answers:
  “JAR mana membawa class ini?”
  “Dependency mana membawa transitive class ini?”
  “Versi mana yang dipakai saat build/runtime?”
```

---

## 11. Source Code, Class File, ClassLoader, Runtime: Empat Dunia Berbeda

Satu file `.java` bukan akhir dari cerita.

```text
Developer writes
    │
    ▼
Source code (.java)
    │ javac
    ▼
Class file (.class bytecode)
    │ packaged
    ▼
Artifact (.jar)
    │ resolved by build/runtime
    ▼
Classpath or module path
    │ loaded by classloader
    ▼
Class metadata in JVM
    │ instantiated/invoked
    ▼
Objects and execution
```

Setiap tahap punya jenis failure berbeda.

| Tahap | Contoh failure |
|---|---|
| Source | syntax error, type error |
| Compile | missing dependency, incompatible method signature |
| Packaging | duplicate classes, missing generated source |
| Dependency resolution | version conflict, transitive dependency mismatch |
| Class loading | `ClassNotFoundException`, `NoClassDefFoundError` |
| Linking | `NoSuchMethodError`, `IllegalAccessError` |
| Runtime invocation | reflection failure, `ClassCastException`, behavior bug |
| Module resolution | module not found, split package, inaccessible package |

Contoh penting:

```java
NoSuchMethodError
```

Ini sering bukan kesalahan source code saat ini, tetapi tanda bahwa:

- compile-time dependency berbeda dari runtime dependency,
- binary compatibility rusak,
- dependency mediation salah,
- classpath/module path membawa versi yang tidak sesuai.

Jadi saat melihat error Java tingkat lanjut, jangan hanya lihat source. Lihat juga artifact dan runtime graph.

---

## 12. Class, Object, Type, Package, Module, Artifact: Bedah Hubungannya

Ini peta konseptual penting.

```text
Artifact / JAR
└── Module (optional explicit JPMS module)
    └── Packages
        └── Types
            ├── class
            ├── interface
            ├── enum
            ├── record
            └── annotation interface
                └── Members
                    ├── fields
                    ├── methods
                    ├── constructors
                    ├── nested types
                    └── annotations

Runtime
└── ClassLoader / ModuleLayer
    └── Class metadata
        └── Object instances
```

### 12.1 Type

Type adalah konsep bahasa/compile-time yang menentukan operasi apa yang legal.

Contoh:

```java
CharSequence text = "hello";
```

Compile-time type variable adalah `CharSequence`, runtime object adalah `String`.

### 12.2 Class

Class adalah deklarasi yang dapat menghasilkan object instance, kecuali abstract atau utility-like class yang tidak dimaksudkan untuk diinstansiasi.

```java
final class Money {
    private final String currency;
    private final long minorUnits;
}
```

### 12.3 Object

Object adalah runtime instance dari class.

```java
Money price = new Money("IDR", 50_000);
```

### 12.4 Interface

Interface adalah named contract/capability/type role.

```java
interface Auditable {
    AuditEntry toAuditEntry();
}
```

### 12.5 Package

Package adalah namespace dan unit package-private access.

```java
package com.acme.payment.domain;
```

### 12.6 Module

Module adalah unit readability dan encapsulation.

```java
module com.acme.payment {
    exports com.acme.payment.api;
}
```

### 12.7 Artifact

Artifact adalah unit distribusi build/dependency, misalnya:

```text
com.acme:payment-api:1.4.2
com.acme:payment-domain:1.4.2
com.acme:payment-adapter-jdbc:1.4.2
```

Artifact bukan module secara otomatis, dan module bukan package. Jangan campuradukkan.

---

## 13. Classpath vs Module Path: Dua Mode Besar Runtime

Secara kasar, Java modern bisa berjalan dalam dua dunia:

```text
Legacy / traditional:
  classpath
  └── list of JAR/classes, mostly flat visibility

JPMS-aware:
  module path
  └── resolved module graph with readability and exports
```

Classpath lebih permisif:

- semua public class di dependency cenderung terlihat,
- internal package hanya convention,
- konflik class bisa diam-diam terjadi,
- dependency graph tidak selalu reliable.

Module path lebih eksplisit:

- module harus terbaca,
- hanya exported packages yang accessible,
- reflection butuh `opens`,
- split package dicegah,
- configuration lebih reliable.

Namun banyak enterprise app masih classpath-based karena framework, plugin, legacy dependency, dan operational compatibility. Jadi top engineer harus paham keduanya, bukan dogmatis.

Prinsip praktis:

> Gunakan package/artifact boundary dengan disiplin meski belum memakai JPMS penuh. Dengan begitu, migrasi ke module boundary menjadi lebih realistis.

---

## 14. API Surface: Bagian Kode yang Menjadi Janji

Tidak semua public code seharusnya dianggap API, tetapi secara teknis `public` membuka akses.

Di Java, API surface bisa muncul dari:

- public class,
- public interface,
- public method,
- public field,
- public constructor,
- public record component/accessor,
- public enum constant,
- exported package,
- annotation type,
- SPI interface,
- generated source,
- serialized form,
- reflection-accessed member,
- configuration property name,
- service provider name.

Contoh:

```java
public record UserResponse(String id, String displayName) {
}
```

Ini terlihat sederhana, tetapi public API-nya mencakup:

- record type name,
- package name,
- constructor signature,
- accessor `id()`,
- accessor `displayName()`,
- `equals`,
- `hashCode`,
- `toString`,
- serialized expectations jika dipakai JSON,
- reflection metadata jika framework bergantung padanya.

Mengubah `displayName` menjadi `name` bukan sekadar rename internal. Itu bisa menjadi breaking change.

Rule:

> Public shape adalah contract. Jangan expose bentuk yang belum siap menjadi janji.

---

## 15. Invariant: Inti dari OOP yang Sering Hilang

OOP bukan sekadar “class punya field dan method”. OOP yang kuat dimulai dari invariant.

Invariant adalah kondisi yang harus selalu benar untuk object valid.

Contoh buruk:

```java
public class DateRange {
    public LocalDate start;
    public LocalDate end;
}
```

Masalah:

- `start` bisa null,
- `end` bisa null,
- `end` bisa sebelum `start`,
- siapa pun bisa mengubah kapan pun,
- object bisa berada dalam state invalid.

Contoh lebih baik:

```java
public final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    public DateRange(LocalDate start, LocalDate end) {
        if (start == null) {
            throw new IllegalArgumentException("start is required");
        }
        if (end == null) {
            throw new IllegalArgumentException("end is required");
        }
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        this.start = start;
        this.end = end;
    }

    public LocalDate start() {
        return start;
    }

    public LocalDate end() {
        return end;
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(start) && !date.isAfter(end);
    }
}
```

Di sini class melindungi invariant.

Pertanyaan desain OOP yang benar:

- State apa yang boleh ada?
- State apa yang tidak boleh ada?
- Siapa yang boleh mengubah state?
- Kapan state berubah?
- Method mana yang menjaga invariant?
- Apakah object bisa bocor sebelum valid?
- Apakah getter membocorkan mutable internal state?

---

## 16. Functional Boundary: Pure Core, Effect Shell

Functional programming membantu ketika kita memisahkan:

```text
Pure computation
  - deterministic
  - no external side effect
  - easy to test
  - easy to reason

Effectful operation
  - database
  - network
  - time
  - random
  - logging/audit
  - external service
  - mutation
```

Contoh:

```java
record InvoiceLine(String item, long quantity, long unitPrice) {
}

record InvoiceTotal(long subtotal, long tax, long grandTotal) {
}

final class InvoiceCalculator {
    InvoiceTotal calculate(List<InvoiceLine> lines, TaxPolicy taxPolicy) {
        long subtotal = lines.stream()
                .mapToLong(line -> line.quantity() * line.unitPrice())
                .sum();

        long tax = taxPolicy.calculateTax(subtotal);
        return new InvoiceTotal(subtotal, tax, subtotal + tax);
    }
}
```

Kode di atas mudah diuji karena tidak menyentuh database/network.

Effect shell:

```java
final class InvoiceService {
    private final InvoiceRepository repository;
    private final InvoiceCalculator calculator;
    private final NotificationClient notificationClient;

    InvoiceService(
            InvoiceRepository repository,
            InvoiceCalculator calculator,
            NotificationClient notificationClient
    ) {
        this.repository = repository;
        this.calculator = calculator;
        this.notificationClient = notificationClient;
    }

    InvoiceTotal closeInvoice(String invoiceId) {
        Invoice invoice = repository.get(invoiceId);
        InvoiceTotal total = calculator.calculate(invoice.lines(), invoice.taxPolicy());
        repository.markClosed(invoiceId, total);
        notificationClient.notifyInvoiceClosed(invoiceId);
        return total;
    }
}
```

Bukan berarti semua harus functional. Maksudnya:

> Taruh logic deterministik di tempat yang bersih. Taruh effect di boundary yang eksplisit.

---

## 17. Reflection Boundary: Ketika Compile-Time Contract Tidak Cukup

Reflection sering muncul ketika kita ingin menulis mekanisme generic.

Contoh sederhana: object mapper.

```java
final class SimpleMapper {
    Map<String, Object> toMap(Object object) {
        Class<?> type = object.getClass();
        Map<String, Object> result = new LinkedHashMap<>();

        for (Field field : type.getDeclaredFields()) {
            field.setAccessible(true);
            try {
                result.put(field.getName(), field.get(object));
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }

        return result;
    }
}
```

Kode ini kuat sekaligus berbahaya.

Kuat karena:

- bisa bekerja dengan banyak class tanpa interface khusus,
- mengurangi boilerplate,
- cocok untuk framework/generic tooling.

Berbahaya karena:

- bypass encapsulation,
- bergantung pada field name,
- rentan saat refactor,
- bisa gagal di JPMS jika package tidak dibuka,
- bisa melanggar invariant,
- bisa mahal jika tidak cache metadata.

Reflection boundary harus diperlakukan sebagai boundary khusus:

```text
Normal code:
  explicit method calls
  compile-time checked
  easy to refactor

Reflective code:
  string/name/metadata-based
  runtime checked
  harder to refactor
  needs caching/access policy
```

Prinsip:

> Reflection sebaiknya terkonsentrasi di framework/adapter layer, bukan tersebar di business logic.

---

## 18. Code Generation Boundary: Mengganti Runtime Magic dengan Compile-Time Output

Banyak framework modern mengurangi reflection runtime dengan code generation.

Contoh konsep:

```java
@Mapper
interface UserMapper {
    UserDto toDto(User user);
}
```

Annotation processor dapat menghasilkan:

```java
final class UserMapperImpl implements UserMapper {
    @Override
    public UserDto toDto(User user) {
        if (user == null) {
            return null;
        }
        return new UserDto(user.id(), user.name());
    }
}
```

Keuntungan generated code:

- lebih cepat daripada reflection runtime,
- error bisa muncul saat compile time,
- output bisa dibaca/debug,
- dependency lebih eksplisit.

Risiko:

- generated source bisa sulit dipahami,
- build menjadi lebih kompleks,
- annotation processor bisa memperlambat compile,
- incremental build bisa bermasalah,
- generator version menjadi bagian compatibility,
- debugging bisa lompat ke kode yang tidak ditulis manual.

Rule:

> Code generation bagus jika menghasilkan kode yang predictable, testable, dan lebih eksplisit daripada runtime magic.

---

## 19. Package Boundary: Architecture yang Paling Sering Diremehkan

Package bukan hanya folder.

Package adalah:

- namespace,
- unit package-private visibility,
- sinyal ownership,
- sinyal stability,
- sinyal dependency direction,
- dokumentasi architecture informal.

Contoh struktur lemah:

```text
com.acme.payment
├── controller
├── service
├── repository
├── dto
├── util
└── model
```

Struktur ini sering membuat semua fitur bercampur di layer besar. Dependency antar business capability menjadi tidak jelas.

Alternatif feature/domain-oriented:

```text
com.acme.payment
├── authorization
│   ├── api
│   ├── application
│   ├── domain
│   └── internal
├── capture
│   ├── api
│   ├── application
│   ├── domain
│   └── internal
└── refund
    ├── api
    ├── application
    ├── domain
    └── internal
```

Tidak ada struktur yang selalu benar. Pertanyaan pentingnya:

- Apakah package menunjukkan business boundary?
- Apakah internal API mudah disembunyikan?
- Apakah dependency direction jelas?
- Apakah package-private bisa dipakai untuk membatasi akses?
- Apakah test bisa masuk tanpa membuka semua public?
- Apakah package siap diekspor sebagai module API?

---

## 20. Module Boundary: API yang Bisa Dipaksa oleh Platform

Tanpa module system, kita sering menulis:

```text
com.acme.payment.internal
```

Tetapi consumer tetap bisa mengakses jika class-nya `public` dan artifact ada di classpath.

Dengan JPMS:

```java
module com.acme.payment {
    exports com.acme.payment.api;
}
```

Package `com.acme.payment.internal` tidak diekspor, sehingga tidak accessible oleh module lain secara normal.

Ini mengubah cara berpikir:

```text
public class inside non-exported package
    ≠ public API for other modules
```

Artinya `public` tidak lagi selalu berarti “global public”. Dalam module system, public member tetap membutuhkan exported package agar accessible dari luar module.

Ini penting untuk library/platform design.

Namun JPMS juga membuat reflection lebih eksplisit:

```java
opens com.acme.payment.internal.model to com.fasterxml.jackson.databind;
```

Maknanya:

- package tidak diekspor sebagai compile-time API,
- tetapi dibuka untuk deep reflection oleh module tertentu.

Top engineer membedakan:

| Directive | Makna |
|---|---|
| `exports` | package menjadi compile-time/public API untuk module lain |
| `opens` | package dibuka untuk deep reflection |
| `requires` | module membaca module lain |
| `requires transitive` | dependency ikut terbaca consumer |
| `uses` | module memakai service |
| `provides ... with` | module menyediakan implementation service |

---

## 21. Artifact Boundary: Maven/Gradle Bukan Administrasi, Tapi Architecture

Banyak engineer menganggap `pom.xml` atau `build.gradle` sebagai detail build. Di sistem besar, build file adalah architecture graph.

Contoh artifact split:

```text
payment-api.jar
payment-domain.jar
payment-application.jar
payment-adapter-jdbc.jar
payment-adapter-rest.jar
payment-boot.jar
```

Dependency direction yang sehat mungkin:

```text
payment-boot
  ├── payment-application
  ├── payment-adapter-jdbc
  └── payment-adapter-rest

payment-application
  ├── payment-api
  └── payment-domain

payment-adapter-jdbc
  ├── payment-api
  └── payment-domain
```

Yang harus dihindari:

```text
payment-domain -> payment-adapter-jdbc
payment-api -> payment-application
payment-common -> everything
```

`common` module sering menjadi tempat dependency cycle disembunyikan.

Pertanyaan penting:

- Apakah artifact boundary sesuai deployment/build boundary?
- Apakah public API dipisah dari implementation?
- Apakah adapter bergantung ke core, bukan sebaliknya?
- Apakah transitive dependency bocor ke consumer?
- Apakah versi dependency terkendali lewat BOM/dependency management/version catalog?
- Apakah runtime dependency sama dengan compile-time dependency?

---

## 22. Dependency Graph: Bentuk Tersembunyi dari Sistem

Setiap Java system punya dependency graph, walaupun tidak didokumentasikan.

```text
A depends on B
B depends on C
A indirectly depends on C
```

Masalah muncul ketika graph:

- cyclic,
- terlalu dense,
- tidak punya direction,
- semua bergantung ke `common`,
- API module bergantung ke implementation,
- test utility masuk production dependency,
- framework dependency bocor ke domain,
- version conflict tersembunyi.

Contoh bau desain:

```text
common.jar
├── StringUtils
├── DateUtils
├── PaymentStatus
├── UserRepository
├── JsonMapper
├── KafkaPublisher
├── SpringConfig
└── OracleHelper
```

Ini bukan common. Ini junk drawer.

Lebih baik pisahkan berdasarkan responsibility:

```text
platform-json
platform-time
platform-observability
payment-api
payment-domain
payment-application
payment-adapter-oracle
payment-adapter-kafka
```

Dependency graph yang sehat punya arah.

```text
Outer / infrastructure / boot
        │
        ▼
Application orchestration
        │
        ▼
Domain model / core contracts
```

Tetapi jangan terjebak dogma. Kadang shared kernel atau platform module valid, asalkan contract-nya jelas.

---

## 23. Binary Compatibility: Kenapa Compile Sukses Belum Tentu Runtime Aman

Java punya konsep binary compatibility: perubahan source tertentu tidak selalu merusak class file consumer yang sudah dikompilasi, tetapi beberapa perubahan bisa menyebabkan runtime error.

Contoh situasi:

1. Library v1:

```java
public class PriceFormatter {
    public String format(long amount) {
        return Long.toString(amount);
    }
}
```

2. Consumer dikompilasi terhadap v1:

```java
formatter.format(100L);
```

3. Library v2 menghapus method:

```java
public class PriceFormatter {
    public String format(BigDecimal amount) {
        return amount.toPlainString();
    }
}
```

Consumer lama mungkin masih berhasil compile jika tidak dikompilasi ulang? Tetapi saat runtime dengan v2, bisa muncul:

```text
NoSuchMethodError
```

Ini menunjukkan pentingnya memikirkan API evolution.

Perubahan yang tampak kecil bisa besar:

- rename package,
- rename class,
- remove method,
- change method descriptor,
- change return type tertentu,
- change field static/final nature,
- change enum constants,
- change record components,
- change sealed permitted subclasses,
- remove exported package,
- stop opening package for reflection.

Top engineer saat membuat public/internal platform API selalu bertanya:

> “Apa yang terjadi pada consumer lama saat artifact ini diganti versi?”

---

## 24. Architectural Reading Example: Satu Fitur Dibaca Berlapis

Misalkan kita ingin membuat plugin payment provider.

### 24.1 API

```java
package com.acme.payment.api;

public interface PaymentProvider {
    PaymentResult authorize(PaymentRequest request);
}
```

Pertanyaan:

- Apakah interface ini terlalu besar?
- Apakah `PaymentRequest` stabil?
- Apakah error channel jelas?
- Apakah provider boleh blocking?
- Apakah provider lifecycle perlu didefinisikan?

### 24.2 Domain Types

```java
public record PaymentRequest(String orderId, long amount, String currency) {
    public PaymentRequest {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("orderId is required");
        }
        if (amount <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO-4217 code");
        }
    }
}
```

Pertanyaan:

- Apakah `long amount` minor unit atau major unit?
- Apakah currency validation cukup?
- Apakah record component names menjadi JSON contract?
- Apakah future field addition akan breaking?

### 24.3 Module Descriptor

```java
module com.acme.payment.api {
    exports com.acme.payment.api;
}
```

Pertanyaan:

- Apakah hanya API yang diekspor?
- Apakah SPI dipisah dari API?
- Apakah transitive dependency bocor?

### 24.4 Service Provider

```java
module com.acme.payment.stripe {
    requires com.acme.payment.api;

    provides com.acme.payment.api.PaymentProvider
            with com.acme.payment.stripe.StripePaymentProvider;
}
```

Pertanyaan:

- Apakah provider class harus public?
- Apakah package implementation perlu diekspor? Seharusnya tidak.
- Apakah provider ditemukan via `ServiceLoader`?
- Apakah lifecycle/init/config jelas?

### 24.5 Runtime

```java
ServiceLoader<PaymentProvider> loader = ServiceLoader.load(PaymentProvider.class);
```

Pertanyaan:

- Module path atau classpath?
- Apakah semua provider module ter-resolve?
- Bagaimana handle multiple providers?
- Bagaimana error saat provider gagal load?

### 24.6 Build Artifact

```text
com.acme:payment-api
com.acme:payment-provider-stripe
com.acme:payment-provider-xendit
com.acme:payment-runtime
```

Pertanyaan:

- Siapa bergantung ke siapa?
- Apakah API bebas framework dependency?
- Apakah provider dependency tidak bocor ke core?
- Bagaimana version compatibility antar API dan provider?

Inilah cara membaca Java secara top-level: bukan class satu per satu, tetapi sebagai graph contract dan boundary.

---

## 25. Design Axis: Runtime Flexibility vs Compile-Time Safety

Banyak keputusan Java berada pada trade-off ini.

```text
More compile-time safety
    ├── direct method call
    ├── interface implementation
    ├── sealed hierarchy
    ├── records with explicit constructors
    ├── annotation processing generated code
    └── JPMS exports/requires

More runtime flexibility
    ├── reflection
    ├── dynamic proxy
    ├── classpath scanning
    ├── string-based config
    ├── runtime bytecode generation
    └── open-ended plugin discovery
```

Tidak ada yang selalu benar.

Compile-time safety bagus untuk:

- core domain,
- internal platform API,
- critical business rule,
- library contract,
- high-change refactoring area.

Runtime flexibility bagus untuk:

- framework integration,
- plugin systems,
- generic mapping,
- tool development,
- optional extension,
- backward compatibility layer.

Masalah muncul ketika runtime flexibility dipakai untuk core business logic sehingga error baru muncul saat production.

Rule:

> Jadikan core logic compile-time visible. Konsentrasikan runtime dynamism di boundary yang bisa diuji dan dimonitor.

---

## 26. Design Axis: Encapsulation vs Framework Convenience

Framework sering butuh akses ke internal detail:

- no-arg constructor,
- non-final class,
- mutable field,
- reflection access,
- annotation metadata,
- proxyable method,
- open package.

Desain domain sering ingin sebaliknya:

- final class,
- immutable field,
- constructor validation,
- no setter,
- closed hierarchy,
- strong encapsulation.

Trade-off:

```text
Framework convenience
    ↑
    │ public no-arg constructor
    │ setters everywhere
    │ mutable DTO/domain mixed
    │ open reflection
    │ annotation-coupled model
    │
    │ balanced adapter boundary
    │
    │ immutable core model
    │ explicit factories
    │ package-private internals
    │ sealed domain hierarchy
    │ minimal exported API
    ↓
Domain encapsulation
```

Strategi sehat:

- pisahkan framework DTO dari domain object jika perlu,
- gunakan mapper/generated mapper,
- buka package hanya untuk framework tertentu,
- jangan membiarkan framework constraint menghancurkan invariant domain,
- pahami kapan pragmatis lebih baik daripada purity.

---

## 27. Design Axis: Inheritance vs Composition vs Pattern Matching

Untuk variasi behavior/model, Java memberi beberapa pilihan.

### 27.1 Inheritance

```java
abstract class PaymentProcessor {
    abstract PaymentResult process(PaymentRequest request);
}
```

Bagus jika:

- benar-benar ada substitutability,
- base class invariant jelas,
- extension point stabil,
- protected API dirancang hati-hati.

Berisiko karena fragile base class.

### 27.2 Interface + Composition

```java
interface PaymentProcessor {
    PaymentResult process(PaymentRequest request);
}

final class AuditingPaymentProcessor implements PaymentProcessor {
    private final PaymentProcessor delegate;
}
```

Bagus untuk:

- decorator,
- strategy,
- testability,
- clean substitution.

### 27.3 Sealed Hierarchy + Pattern Matching

```java
sealed interface PaymentEvent permits Authorized, Failed, Refunded {
}

record Authorized(String paymentId) implements PaymentEvent {
}

record Failed(String reason) implements PaymentEvent {
}

record Refunded(String refundId) implements PaymentEvent {
}
```

Bagus jika:

- variasi data finite,
- consumer perlu exhaustive handling,
- domain state/event punya closed set.

### 27.4 Enum Dispatch

```java
enum PaymentStatus {
    PENDING,
    AUTHORIZED,
    FAILED
}
```

Bagus jika variasi sederhana dan stabil.

Decision matrix:

| Kebutuhan | Pilihan cenderung tepat |
|---|---|
| Banyak implementasi eksternal | interface |
| Closed finite domain variants | sealed hierarchy |
| Shared algorithm skeleton | abstract class/template method, hati-hati |
| Behavior bisa diganti runtime | strategy/composition |
| State sederhana | enum |
| Exhaustive handling penting | sealed + switch/pattern matching |

---

## 28. Design Axis: Annotation vs Explicit Code

Annotation sering terlihat rapi:

```java
@Audited
@Retryable(maxAttempts = 3)
@Transactional
public PaymentResult authorize(PaymentRequest request) {
    return gateway.authorize(request);
}
```

Tetapi annotation menyembunyikan behavior di luar method body.

Pertanyaan desain:

- Apakah annotation hanya metadata atau mengubah control flow?
- Siapa membaca annotation?
- Kapan annotation diproses?
- Apakah behavior terlihat di test?
- Apakah annotation order penting?
- Apakah annotation bekerja pada self-invocation?
- Apakah annotation tetap bekerja dengan final class/method?
- Apakah annotation butuh runtime reflection?
- Apakah package perlu `opens`?

Annotation bagus untuk declarative metadata yang stabil. Annotation buruk jika menjadi tempat menyembunyikan business logic kompleks.

Rule:

> Annotation adalah API. Desain annotation seperti mendesain bahasa kecil.

---

## 29. Design Axis: Source Generation vs Runtime Reflection

Misalnya ingin membuat mapper.

### Runtime reflection mapper

```text
Pros:
- flexible
- less generated source
- works dynamically

Cons:
- runtime failure
- slower without caching
- harder static analysis
- JPMS opens issue
```

### Compile-time generated mapper

```text
Pros:
- compile-time failure
- faster runtime
- readable output
- refactoring friendlier if processor is good

Cons:
- build complexity
- processor dependency
- generated source management
- incremental compilation concerns
```

Decision guide:

| Context | Prefer |
|---|---|
| Hot path mapping | generated code |
| Dynamic schema/plugin | reflection/runtime generation |
| Stable DTO mapping | annotation processing |
| Admin/debug tool | reflection acceptable |
| Library for unknown types | reflection + careful cache/access policy |
| Native image/closed world | generated/static metadata often better |

---

## 30. “Top 1%” Mental Checklist Saat Membaca Java Codebase

Saat masuk ke codebase Java besar, jangan mulai dari file random. Baca sebagai struktur.

### 30.1 Type/API Checklist

- Apa public API utama?
- Mana type yang stable contract?
- Mana type internal?
- Apakah interface benar-benar abstraction atau hanya mirror implementation?
- Apakah inheritance digunakan untuk substitutability atau reuse malas?
- Apakah record dipakai untuk value carrier yang tepat?
- Apakah enum/sealed hierarchy mencerminkan finite domain?
- Apakah null/error channel jelas?

### 30.2 Object/Invariants Checklist

- Object mana yang punya invariant penting?
- Apakah invariant dijaga constructor/factory/method?
- Apakah mutable state bocor?
- Apakah equality/hashCode aman?
- Apakah object dipakai sebagai key di map/set?
- Apakah ada partially initialized object?

### 30.3 Functional/Effect Checklist

- Mana pure computation?
- Mana effectful boundary?
- Apakah lambda menyembunyikan side effect?
- Apakah stream pipeline mudah dipahami?
- Apakah exception/null masuk pipeline secara liar?

### 30.4 Reflection/Codegen Checklist

- Framework mana memakai reflection?
- Package mana perlu dibuka?
- Apakah reflective access tersebar?
- Apakah annotation menjadi hidden DSL?
- Apakah generated code bisa dibaca?
- Apakah processor/generator punya test?
- Apakah refactoring aman terhadap string-based names?

### 30.5 Package/Module Checklist

- Apakah package structure menunjukkan domain boundary?
- Apakah internal package benar-benar internal?
- Apakah ada cyclic package dependency?
- Apakah module descriptor tersedia?
- Apakah exported package minimal?
- Apakah opens terlalu luas?
- Apakah split package terjadi?

### 30.6 Artifact/Dependency Checklist

- Apa dependency graph antar artifact?
- Apakah API module bergantung ke implementation?
- Apakah transitive dependency bocor?
- Apakah version conflict mungkin?
- Apakah build reproducible?
- Apakah runtime classpath sama dengan compile classpath?

---

## 31. Common Failure Modes di Sistem Java Besar

### 31.1 Public API Terlalu Besar

Gejala:

- semua class `public`,
- semua package bisa dipakai consumer,
- internal DTO dipakai di luar module,
- sulit refactor karena banyak unknown consumer.

Solusi:

- kecilkan public API,
- gunakan package-private,
- pisahkan `.api` dan `.internal`,
- gunakan JPMS `exports` jika memungkinkan,
- dokumentasikan compatibility policy.

### 31.2 Reflection Tersebar di Business Logic

Gejala:

- banyak `Class.forName`,
- banyak `setAccessible(true)`,
- string method/field name tersebar,
- runtime error saat rename field,
- module access error.

Solusi:

- konsentrasikan reflection di infrastructure layer,
- cache metadata,
- buat typed adapter,
- gunakan annotation processor jika pola stabil.

### 31.3 Annotation Menjadi Magic Tak Terkontrol

Gejala:

- method terlihat sederhana tapi behavior besar disembunyikan annotation,
- urutan annotation penting tapi tidak jelas,
- test tidak mencakup framework behavior,
- self-invocation bug,
- proxy limitation.

Solusi:

- dokumentasikan annotation semantics,
- batasi annotation untuk metadata/cross-cutting concern,
- test via integration boundary,
- hindari business branching tersembunyi di annotation.

### 31.4 Package-by-Layer Membesar Tanpa Boundary

Gejala:

```text
service/
  PaymentService
  RefundService
  UserService
  ReportService
  NotificationService
```

Semua saling panggil.

Solusi:

- pecah berdasarkan capability/domain,
- definisikan API/internal per capability,
- buat dependency direction eksplisit,
- pakai package-private untuk internal collaboration.

### 31.5 Dependency Graph Tidak Terkendali

Gejala:

- `common` tergantung semua,
- domain tergantung framework,
- adapter tergantung adapter lain,
- test dependency masuk runtime,
- runtime error versi library.

Solusi:

- audit dependency graph,
- enforce dependency rules,
- pakai BOM/dependency management/version catalog,
- split artifact berdasarkan boundary,
- hindari transitive dependency leak.

---

## 32. Mental Model Praktis: Java Program sebagai Contract Graph

Cara paling kuat melihat aplikasi Java besar:

```text
Java system = graph of contracts + graph of objects + graph of dependencies
```

### 32.1 Contract Graph

Berisi:

- interface,
- public class,
- record,
- enum,
- annotation,
- exported package,
- module descriptor,
- configuration keys,
- serialized payloads.

Pertanyaan:

> Siapa menjanjikan apa kepada siapa?

### 32.2 Object Graph

Berisi:

- runtime instances,
- dependencies antar object,
- lifecycle,
- mutable state,
- identity,
- ownership.

Pertanyaan:

> Siapa memiliki state apa, dan siapa boleh mengubahnya?

### 32.3 Dependency Graph

Berisi:

- package dependency,
- module dependency,
- artifact dependency,
- runtime classpath/module path,
- generated code dependency.

Pertanyaan:

> Siapa boleh bergantung ke siapa, dan apakah arah dependency sesuai architecture?

Jika tiga graph ini kacau, sistem sulit dirawat walaupun setiap class terlihat “bersih”.

---

## 33. Step-by-Step Cara Menganalisis Codebase Java dengan Lensa Seri Ini

### Step 1 — Identifikasi Artifact Boundary

Cari:

- Maven modules,
- Gradle subprojects,
- JAR outputs,
- dependency management,
- application boot module.

Tanyakan:

- Apa unit deploy?
- Apa unit library?
- Apa unit API?
- Apa unit adapter?

### Step 2 — Identifikasi Package Boundary

Cari package:

- `.api`,
- `.spi`,
- `.internal`,
- `.domain`,
- `.application`,
- `.adapter`,
- `.config`.

Tanyakan:

- Apakah nama package mencerminkan responsibility?
- Apakah internal package benar-benar tidak dipakai luar?

### Step 3 — Identifikasi Public API

Cari:

- public interfaces,
- public records,
- public DTOs,
- public annotations,
- public enums,
- public constructors.

Tanyakan:

- Apakah semua public memang harus public?
- Apa compatibility promise-nya?

### Step 4 — Identifikasi Domain Invariants

Cari object penting:

- command,
- event,
- aggregate-like model,
- value object,
- state enum,
- policy/strategy.

Tanyakan:

- Apa state invalid yang dicegah?
- Apakah constructor/factory menjaga invariant?

### Step 5 — Identifikasi Dynamic Mechanisms

Cari:

- reflection,
- annotation scanning,
- proxy,
- generated code,
- ServiceLoader,
- classpath scanning,
- bytecode enhancement.

Tanyakan:

- Mana yang compile-time visible?
- Mana yang runtime-only?
- Bagaimana failure-nya dideteksi?

### Step 6 — Identifikasi Module/Encapsulation Strategy

Cari:

- `module-info.java`,
- exported packages,
- opened packages,
- automatic modules,
- unnamed module assumptions.

Tanyakan:

- Apakah module boundary enforce architecture?
- Apakah opens terlalu luas?

### Step 7 — Identifikasi Evolution Risk

Cari type yang dipakai consumer lain.

Tanyakan:

- Jika field/record component berubah, siapa rusak?
- Jika enum constant ditambah, siapa rusak?
- Jika sealed subtype ditambah, siapa rusak?
- Jika method dihapus, apakah binary consumer rusak?

---

## 34. Mini Case Study: Dari Naive Class ke Architecture-Aware Type

### 34.1 Naive Version

```java
public class Payment {
    public String id;
    public String status;
    public long amount;
}
```

Masalah:

- semua mutable,
- status stringly typed,
- amount tidak jelas unit/currency,
- invariant tidak ada,
- public field menjadi API,
- invalid state mudah dibuat.

### 34.2 Better Value Types

```java
public record Money(String currency, long minorUnits) {
    public Money {
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO-4217 code");
        }
        if (minorUnits < 0) {
            throw new IllegalArgumentException("minorUnits must not be negative");
        }
    }
}
```

### 34.3 Finite State

```java
public enum PaymentStatus {
    INITIATED,
    AUTHORIZED,
    CAPTURED,
    FAILED,
    REFUNDED
}
```

### 34.4 Encapsulated Entity-like Object

```java
public final class Payment {
    private final String id;
    private PaymentStatus status;
    private final Money amount;

    public Payment(String id, Money amount) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id is required");
        }
        if (amount == null) {
            throw new IllegalArgumentException("amount is required");
        }
        this.id = id;
        this.amount = amount;
        this.status = PaymentStatus.INITIATED;
    }

    public void authorize() {
        if (status != PaymentStatus.INITIATED) {
            throw new IllegalStateException("Only initiated payment can be authorized");
        }
        status = PaymentStatus.AUTHORIZED;
    }

    public String id() {
        return id;
    }

    public PaymentStatus status() {
        return status;
    }

    public Money amount() {
        return amount;
    }
}
```

### 34.5 Architecture-Aware Placement

```text
com.acme.payment.domain
  Money
  Payment
  PaymentStatus

com.acme.payment.api
  PaymentCommand
  PaymentResult

com.acme.payment.application
  PaymentApplicationService

com.acme.payment.adapter.persistence
  PaymentEntity
  PaymentRepositoryJdbc
```

### 34.6 Module Descriptor

```java
module com.acme.payment {
    exports com.acme.payment.api;

    // domain may or may not be exported depending on intended API
    // exports com.acme.payment.domain;

    opens com.acme.payment.adapter.persistence to some.persistence.framework;
}
```

Pelajaran:

- OOP menjaga invariant.
- Functional style bisa dipakai untuk pure calculation.
- Reflection hanya dibuka di adapter boundary.
- Package memisahkan domain/API/application/adapter.
- Module descriptor mengontrol yang benar-benar diekspos.
- Artifact dependency harus mengikuti boundary ini.

---

## 35. Vocabulary Inti untuk Seri Ini

| Istilah | Definisi praktis |
|---|---|
| Type | Kategori compile-time yang menentukan operasi legal |
| Class | Deklarasi blueprint runtime untuk object dan metadata |
| Object | Runtime instance dengan identity/state/behavior |
| Interface | Named contract/capability/role |
| Record | Nominal transparent carrier untuk immutable-ish data agregat |
| Enum | Finite set of named singleton constants |
| Sealed type | Type hierarchy yang implementor/subclass-nya dibatasi |
| Package | Namespace dan package-private access boundary |
| Module | Unit readability, exports, opens, services, encapsulation |
| Artifact | Unit build/distribution/dependency seperti JAR |
| API | Bentuk/behavior yang boleh dipakai consumer dan harus stabil |
| SPI | Contract untuk implementor/plugin/provider |
| Invariant | Kondisi yang harus selalu benar untuk object valid |
| Reflection | Runtime inspection/invocation atas metadata program |
| Annotation | Metadata yang bisa dipakai compiler/tool/runtime |
| Annotation processing | Compile-time code analysis/generation berbasis annotation |
| Code generation | Pembuatan source/bytecode/config dari model/metadata |
| Binary compatibility | Apakah consumer binary lama tetap bisa berjalan dengan library baru |
| Classpath | Mekanisme tradisional pencarian class/JAR |
| Module path | Mekanisme JPMS untuk resolved module graph |
| Export | Membuka package sebagai API compile-time ke module lain |
| Open | Membuka package untuk deep reflection |

---

## 36. Prinsip-Prinsip Besar yang Akan Dipakai Sepanjang Seri

### Prinsip 1 — Make Invalid State Unrepresentable Jika Masuk Akal

Jangan biarkan object mudah dibuat dalam kondisi rusak.

```java
// Weak
new Payment("", -100, "???");

// Better
new PaymentId("pay-001");
new Money("IDR", 100_000);
```

### Prinsip 2 — Public API Harus Lebih Kecil dari Implementation

Semakin besar API, semakin mahal evolusinya.

### Prinsip 3 — Runtime Magic Harus Terkonsentrasi

Reflection, proxies, dan bytecode generation jangan tersebar di business logic.

### Prinsip 4 — Package Structure Harus Menceritakan Architecture

Folder bukan sekadar storage. Package adalah peta dependency mental.

### Prinsip 5 — Module/Artifact Boundary Harus Mengikuti Dependency Direction

Jangan biarkan build graph bertentangan dengan architecture graph.

### Prinsip 6 — Functional Style Harus Memperjelas, Bukan Memamerkan

Lambda/stream yang menyembunyikan effect lebih buruk daripada loop eksplisit.

### Prinsip 7 — Generated Code Harus Bisa Dipercaya

Generator adalah compiler kecil. Ia harus diuji dan punya output contract.

### Prinsip 8 — API Evolution Adalah Desain, Bukan Afterthought

Begitu type dipakai consumer lain, perubahan kecil bisa menjadi breaking change.

---

## 37. Latihan Mental

Jawab tanpa coding dulu.

### Latihan 1 — Class vs API

Ada class:

```java
public class InternalPaymentMapper {
    public PaymentDto map(Payment payment) {
        return new PaymentDto(payment.id(), payment.amount());
    }
}
```

Pertanyaan:

1. Apakah class ini public API?
2. Jika tidak, kenapa `public` berbahaya?
3. Apakah lebih baik package-private?
4. Jika berada di non-exported package JPMS, apa efeknya?

### Latihan 2 — Reflection Boundary

Sebuah service membaca field object memakai reflection untuk validasi.

Pertanyaan:

1. Apakah validasi ini seharusnya explicit interface?
2. Apakah annotation cukup?
3. Apakah field name refactor-safe?
4. Apakah package harus `opens`?
5. Bagaimana test failure-nya?

### Latihan 3 — Record sebagai API

```java
public record UserResponse(String id, String name) {
}
```

Pertanyaan:

1. Apa yang terjadi jika `name` diganti menjadi `displayName`?
2. Apakah JSON contract berubah?
3. Apakah accessor berubah?
4. Apakah constructor signature berubah?
5. Apakah ini breaking change?

### Latihan 4 — Package Design

Bandingkan:

```text
com.acme.case.service
com.acme.case.repository
com.acme.case.dto
```

versus:

```text
com.acme.case.assignment
com.acme.case.escalation
com.acme.case.approval
```

Pertanyaan:

1. Struktur mana lebih menunjukkan business capability?
2. Struktur mana lebih mudah membatasi dependency?
3. Struktur mana lebih mudah menjadi module boundary?
4. Struktur mana lebih mudah dipahami engineer baru?

---

## 38. Ringkasan

Bagian ini membangun peta mental bahwa Java bukan hanya kumpulan syntax.

Java program harus dibaca sebagai gabungan dari:

1. **source-level structure** — apa yang ditulis,
2. **type-system structure** — apa yang diketahui compiler,
3. **runtime structure** — apa yang hidup di JVM,
4. **object graph** — instance dan state relationship,
5. **contract graph** — API/SPI/annotation/serialized form,
6. **package graph** — namespace dan internal boundary,
7. **module graph** — readability/exports/opens/services,
8. **artifact graph** — dependency dan versioning,
9. **evolution graph** — apa yang bisa berubah tanpa merusak consumer.

Mental model ini akan dipakai di semua part berikutnya.

Part berikutnya akan masuk ke fondasi yang lebih teknis:

> **Part 001 — Java Type System Deep Dive: Identity, Value, Reference, Nominal Typing**

---

## 39. Referensi Resmi dan Bacaan Teknis

Referensi ini dipakai sebagai anchor konseptual untuk seri:

1. Oracle Java Language Specification, Java SE 25/26 — untuk definisi language-level tentang package, class, interface, record, sealed type, dan binary compatibility.
2. Oracle Java SE API Documentation — terutama `java.base`, `java.lang`, dan `java.lang.reflect`.
3. OpenJDK JEP 261 — Java Platform Module System, reliable configuration, strong encapsulation.
4. OpenJDK JEP 409 — Sealed Classes.
5. Dokumentasi Maven POM/dependency management — untuk artifact/dependency governance.

---

## 40. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[x] Part 000 — Orientation: Mental Model Besar Java Program Structure
[ ] Part 001 — Java Type System Deep Dive: Identity, Value, Reference, Nominal Typing
[ ] Part 002 — Class Anatomy: Fields, Methods, Constructors, Initializers, Class Loading Semantics
[ ] Part 003 — Object Identity, Equality, Hashing, Immutability, and Object Contracts
...
[ ] Part 030 — Capstone: Designing a Modular, Reflective, Generated-Code Friendly Java Library
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: 34 — Top 1% OSGi Engineering: Design Reviews, Invariants, Checklists, and Decision Framework](../osgi/34-top-1-percent-osgi-engineering-design-reviews-invariants-checklists-decision-framework.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-001](./learn-java-oop-functional-reflection-codegen-modules-part-001.md)

</div>