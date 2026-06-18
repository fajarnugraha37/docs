# learn-java-data-types-part-000.md

# Java Data Types — Part 000  
# Peta Besar Java Type System: Dari Compiler, JVM, Domain Model, hingga Production Boundary

> Seri: **Advanced Java Data Types**  
> Bagian: **000**  
> Target: membangun mental model sebelum masuk detail primitive, reference, generics, records, sealed types, nullability, memory layout, serialization, database mapping, API contract, dan failure mode production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Data Type Itu Lebih Penting dari yang Terlihat](#2-kenapa-data-type-itu-lebih-penting-dari-yang-terlihat)
3. [Definisi Resmi: Types, Values, dan Variables](#3-definisi-resmi-types-values-dan-variables)
4. [Mental Model 1: Type sebagai Set of Values dan Set of Operations](#4-mental-model-1-type-sebagai-set-of-values-dan-set-of-operations)
5. [Mental Model 2: Type sebagai Kontrak Compiler](#5-mental-model-2-type-sebagai-kontrak-compiler)
6. [Mental Model 3: Type sebagai Representasi Runtime](#6-mental-model-3-type-sebagai-representasi-runtime)
7. [Mental Model 4: Type sebagai Bahasa Domain](#7-mental-model-4-type-sebagai-bahasa-domain)
8. [Mental Model 5: Type sebagai Boundary Antar Sistem](#8-mental-model-5-type-sebagai-boundary-antar-sistem)
9. [Dua Keluarga Besar: Primitive Types dan Reference Types](#9-dua-keluarga-besar-primitive-types-dan-reference-types)
10. [Special Null Type dan Mengapa `null` Berbahaya](#10-special-null-type-dan-mengapa-null-berbahaya)
11. [Variable, Value, Object, Reference: Jangan Dicampur](#11-variable-value-object-reference-jangan-dicampur)
12. [Compile-Time Type vs Runtime Class](#12-compile-time-type-vs-runtime-class)
13. [Static Typing, Strong Typing, dan Nominal Typing di Java](#13-static-typing-strong-typing-dan-nominal-typing-di-java)
14. [Type Conversion: Ketika Compiler Mengizinkan Perubahan Bentuk](#14-type-conversion-ketika-compiler-mengizinkan-perubahan-bentuk)
15. [Type Inference: `var` Bukan Dynamic Typing](#15-type-inference-var-bukan-dynamic-typing)
16. [Identity vs Value: Pertanyaan Paling Penting pada Data Type](#16-identity-vs-value-pertanyaan-paling-penting-pada-data-type)
17. [Mutability dan Ownership](#17-mutability-dan-ownership)
18. [Equality, Ordering, dan Hashing sebagai Kontrak Type](#18-equality-ordering-dan-hashing-sebagai-kontrak-type)
19. [Representasi Data dalam Memory: Yang Harus Dipahami Sejak Awal](#19-representasi-data-dalam-memory-yang-harus-dipahami-sejak-awal)
20. [Data Type di Boundary: JSON, Database, Kafka, API, dan UI](#20-data-type-di-boundary-json-database-kafka-api-dan-ui)
21. [Type Design: Dari Primitive Obsession ke Domain-Specific Type](#21-type-design-dari-primitive-obsession-ke-domain-specific-type)
22. [Modern Java Type Modeling: Records, Sealed Types, Pattern Matching](#22-modern-java-type-modeling-records-sealed-types-pattern-matching)
23. [Cara Membaca Kode Java dari Sudut Type System](#23-cara-membaca-kode-java-dari-sudut-type-system)
24. [Failure Modes Production karena Type Design Buruk](#24-failure-modes-production-karena-type-design-buruk)
25. [Prinsip Desain Data Type untuk Engineer Senior](#25-prinsip-desain-data-type-untuk-engineer-senior)
26. [Checklist Awal Saat Mendesain Field/Parameter/Return Type](#26-checklist-awal-saat-mendesain-fieldparameterreturn-type)
27. [Latihan Mental Model](#27-latihan-mental-model)
28. [Ringkasan](#28-ringkasan)
29. [Referensi](#29-referensi)

---

# 1. Tujuan Bagian Ini

Bagian ini **belum** membahas detail `int`, `long`, `String`, `record`, `enum`, atau `List` secara granular. Itu akan masuk pada bagian-bagian berikutnya.

Bagian ini membangun fondasi:

```text
Apa itu "type" di Java?
Apa bedanya variable, value, object, dan reference?
Apa yang compiler tahu?
Apa yang JVM tahu?
Apa yang domain expert maksud?
Apa yang database/API/serializer lihat?
Apa failure mode jika type salah dipilih?
```

Tujuan akhirnya: saat kamu melihat field seperti ini:

```java
private String status;
private String officerId;
private double amount;
private boolean approved;
private LocalDateTime deadline;
```

kamu tidak hanya berpikir:

```text
Oke, itu tipe data biasa.
```

Tetapi langsung bertanya:

```text
Status ini closed set atau open set?
officerId ini harus punya type sendiri?
amount ini uang atau measurement?
approved ini cukup boolean atau butuh decision object?
deadline ini local date, instant, atau zoned time?
Apakah field ini nullable?
Apakah field ini mutable?
Apakah field ini aman diserialisasi?
Apakah field ini aman disimpan ke DB?
Apakah field ini bisa diaudit?
```

Itulah perbedaan antara “tahu tipe data Java” dan “menguasai data modeling di Java”.

---

# 2. Kenapa Data Type Itu Lebih Penting dari yang Terlihat

Data type terlihat sederhana karena tutorial biasanya memperkenalkan seperti ini:

```java
int age = 25;
double price = 99.99;
boolean active = true;
String name = "Fajar";
```

Ini benar secara dasar, tetapi tidak cukup untuk engineering nyata.

Dalam production system, data type menentukan:

1. nilai apa yang legal;
2. operasi apa yang legal;
3. apakah data boleh `null`;
4. apakah data bisa berubah;
5. apakah data punya identity;
6. apakah equality by value atau by identity;
7. bagaimana data disimpan di memory;
8. bagaimana data dikirim lewat JSON/XML/Protobuf;
9. bagaimana data disimpan ke database;
10. bagaimana data berubah antar versi;
11. apakah data aman untuk log;
12. apakah data aman untuk audit;
13. apakah data bisa menyebabkan bug concurrency;
14. apakah data menyebabkan memory overhead;
15. apakah compiler bisa membantu mencegah bug.

Contoh:

```java
void assignCase(String caseId, String officerId) {
    ...
}
```

Secara Java ini valid. Tetapi secara domain, compiler tidak bisa membedakan:

```java
assignCase(officerId, caseId); // tertukar tapi tetap compile
```

Jika kita memakai type domain:

```java
void assignCase(CaseId caseId, OfficerId officerId) {
    ...
}
```

maka bug tertukar menjadi compile-time error.

Itulah kekuatan type system: **mendorong error dari runtime ke compile time**.

## 2.1 Type adalah alat berpikir

Type bukan hanya alat mesin. Type juga alat komunikasi manusia.

Bandingkan:

```java
void reject(String id, String reason, String user, String code) {}
```

dengan:

```java
void reject(
    CaseId caseId,
    RejectionReason reason,
    OfficerId rejectedBy,
    PolicyCode policyCode
) {}
```

Versi kedua lebih panjang, tetapi jauh lebih jelas. Ia menjawab:

- ID apa?
- reason untuk apa?
- user sebagai siapa?
- code itu code apa?

Top engineer memakai type untuk **membuat ambiguity menjadi eksplisit**.

## 2.2 Type adalah guardrail

Dalam sistem besar, bug sering terjadi bukan karena engineer tidak tahu cara coding, tetapi karena API terlalu permisif.

Contoh:

```java
public void updateStatus(String status) {
    this.status = status;
}
```

Ini mengizinkan:

```java
updateStatus("CLOESD");   // typo
updateStatus("");         // invalid
updateStatus("APPROVED"); // mungkin transition ilegal
updateStatus(null);       // NPE nanti
```

Dengan enum:

```java
public void transitionTo(CaseStatus status) {
    ...
}
```

typo string hilang, tetapi transition ilegal masih mungkin.

Dengan behavior method:

```java
public CaseClosed close(CloseCase command, Clock clock) {
    ...
}
```

type dan behavior bekerja sama untuk menjaga invariant.

## 2.3 Type adalah dokumentasi yang bisa diverifikasi compiler

Komentar bisa bohong:

```java
// amount in cents
private long amount;
```

Tapi type bisa lebih kuat:

```java
private Money amount;
```

Jika `Money` punya invariant, compiler dan constructor ikut menjaga.

---

# 3. Definisi Resmi: Types, Values, dan Variables

Java Language Specification membagi type Java menjadi dua kategori utama:

```text
primitive types
reference types
```

Primitive types terdiri dari:

```text
boolean
byte
short
int
long
char
float
double
```

Reference types terdiri dari:

```text
class types
interface types
array types
```

Selain itu ada **special null type**, yaitu type dari expression `null`.

Secara konseptual:

```text
type menentukan jenis value yang dapat dimiliki expression/variable
```

Variable adalah storage location yang memiliki type.

Contoh:

```java
int count = 10;
String name = "Fajar";
```

- `count` adalah variable.
- `int` adalah type variable `count`.
- `10` adalah value.
- `name` adalah variable.
- `String` adalah reference type.
- `"Fajar"` adalah String object yang direferensikan oleh variable `name`.

## 3.1 Primitive value vs reference value

Primitive variable menyimpan primitive value.

```java
int x = 42;
```

Reference variable menyimpan reference value, yaitu reference ke object atau `null`.

```java
String s = "hello";
```

Variable `s` **bukan object String-nya**. `s` menyimpan reference ke object String.

Ini sangat penting untuk memahami:

- aliasing;
- mutability;
- pass-by-value;
- `==` vs `equals`;
- GC;
- memory leak;
- null pointer;
- object identity.

---

# 4. Mental Model 1: Type sebagai Set of Values dan Set of Operations

Cara sederhana memahami type:

```text
Type = himpunan nilai legal + operasi legal
```

Contoh `boolean`:

```text
values: true, false
operations: !, &&, ||, ==, !=
```

Contoh `int`:

```text
values: -2^31 sampai 2^31-1
operations: +, -, *, /, %, bitwise, comparison
```

Contoh `CaseStatus`:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED,
    REJECTED
}
```

Set of values:

```text
DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED, REJECTED
```

Jika status direpresentasikan sebagai `String`, set of values-nya secara praktis menjadi:

```text
semua string yang mungkin
```

Itu terlalu luas.

## 4.1 Type yang terlalu luas membuat bug mudah masuk

Contoh:

```java
void updateStatus(String status)
```

mengizinkan semua ini:

```java
updateStatus("DRAFT");
updateStatus("draft");
updateStatus("Draf");
updateStatus("CLOSED ");
updateStatus("DELETE FROM cases");
updateStatus("");
updateStatus(null);
```

Type `String` terlalu luas untuk domain status.

Lebih baik:

```java
void updateStatus(CaseStatus status)
```

Namun ini pun belum cukup jika transition harus dijaga.

Lebih baik lagi:

```java
caseRecord.submit(command);
caseRecord.close(command);
caseRecord.reject(command);
```

## 4.2 Type yang terlalu sempit juga bisa salah

Kadang engineer membuat type terlalu sempit sebelum domain stabil.

Contoh:

```java
enum ExternalPartnerStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

Jika partner bisa menambah status baru kapan saja, enum internal yang terlalu strict bisa membuat deserialization gagal.

Untuk external boundary, kadang lebih aman:

```java
record ExternalStatus(String rawValue) {}
```

lalu diterjemahkan ke domain status:

```java
CaseStatus translate(ExternalStatus externalStatus) { ... }
```

Prinsip:

```text
Internal domain type harus ketat.
External boundary type harus kompatibel dan defensif.
```

---

# 5. Mental Model 2: Type sebagai Kontrak Compiler

Compiler memakai type untuk mengecek:

- assignment;
- method call;
- return value;
- overload resolution;
- generic constraint;
- conversion;
- switch exhaustiveness;
- access;
- exception checking;
- pattern matching.

Contoh:

```java
int x = "hello"; // compile error
```

Ini trivial.

Yang lebih penting:

```java
record CaseId(UUID value) {}
record OfficerId(UUID value) {}

void assign(CaseId caseId, OfficerId officerId) {}
```

Sekarang compiler mencegah:

```java
OfficerId officerId = new OfficerId(UUID.randomUUID());
CaseId caseId = new CaseId(UUID.randomUUID());

assign(officerId, caseId); // compile error
```

Tanpa domain-specific type, compiler tidak bisa membantu:

```java
void assign(UUID caseId, UUID officerId) {}

assign(officerId, caseId); // compile success, domain bug
```

## 5.1 Compiler bukan domain expert

Compiler hanya tahu aturan type yang kamu berikan.

Jika kamu memberi type terlalu umum:

```java
String
int
boolean
Map<String, Object>
Object
```

compiler kehilangan kemampuan membantu.

Contoh:

```java
Map<String, Object> payload = new HashMap<>();
payload.put("caseId", 123);
payload.put("status", true);
```

Compiler tidak tahu bahwa:

- `caseId` harus UUID/string tertentu;
- `status` harus enum;
- `true` tidak valid sebagai status.

Semakin banyak `Object`, raw type, `Map<String,Object>`, dan stringly-typed design, semakin banyak bug pindah dari compile-time ke runtime.

## 5.2 Type sebagai constraint

Contoh:

```java
public record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value);
        if (value.compareTo(BigDecimal.ZERO) < 0 ||
            value.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new IllegalArgumentException("Percentage must be 0..100");
        }
    }
}
```

Compiler tidak tahu range `0..100`, tetapi type `Percentage` membuat range check terpusat.

Sekarang semua method yang menerima `Percentage` bisa berasumsi:

```text
nilai sudah valid
```

Itu mengurangi defensive validation berulang.

---

# 6. Mental Model 3: Type sebagai Representasi Runtime

Compiler melihat source code. JVM menjalankan bytecode.

Di runtime, data muncul dalam beberapa area:

- heap;
- thread stack;
- local variable array;
- operand stack;
- method area / class metadata;
- native memory;
- registers/CPU cache secara fisik.

Secara JVM, value dapat berupa:

- primitive value;
- reference value.

Contoh method:

```java
int add(int a, int b) {
    return a + b;
}
```

Pada level JVM, `a` dan `b` berada dalam local variables frame, operasi memakai operand stack.

Contoh:

```java
String upper(String s) {
    return s.toUpperCase();
}
```

Variable `s` adalah reference. Object `String` berada di heap. Method call menggunakan reference tersebut.

## 6.1 Type memengaruhi memory

Bandingkan:

```java
int[] values = new int[1_000_000];
```

dengan:

```java
List<Integer> values = new ArrayList<>();
```

`int[]` menyimpan primitive `int` secara contiguous.

`List<Integer>` menyimpan reference ke `Integer` objects. Ada overhead:

- object header per `Integer`;
- reference array;
- boxing;
- pointer chasing;
- GC pressure;
- cache locality buruk.

Keduanya “kumpulan angka”, tetapi representasi runtime sangat berbeda.

## 6.2 Type memengaruhi GC

Banyak object kecil:

```java
List<Integer>
List<BigDecimal>
List<Money>
List<CaseDto>
```

bisa meningkatkan allocation rate dan GC pressure.

Primitive array:

```java
int[]
long[]
double[]
```

lebih compact dan cache-friendly untuk numeric processing.

Namun domain clarity mungkin lebih baik dengan value object. Engineering berarti memilih trade-off berdasarkan context.

## 6.3 Type memengaruhi JIT optimization

JIT dapat mengoptimasi berdasarkan type profile.

Contoh interface:

```java
interface PricingRule {
    Money apply(Money base);
}
```

Jika runtime call site selalu hanya satu implementation, JIT bisa meng-inline. Jika puluhan implementation berbeda melewati call site yang sama, call site bisa menjadi megamorphic dan optimasi lebih sulit.

Type design memengaruhi performance, bukan hanya readability.

---

# 7. Mental Model 4: Type sebagai Bahasa Domain

Domain model yang baik membuat business language muncul di code.

Buruk:

```java
void escalate(String id, int level, String reason, String user) {}
```

Lebih baik:

```java
void escalate(
    CaseId caseId,
    Severity newSeverity,
    EscalationReason reason,
    OfficerId escalatedBy
) {}
```

## 7.1 Domain-specific type

Domain-specific type adalah type kecil yang merepresentasikan konsep domain.

Contoh:

```java
public record CaseId(UUID value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
    }
}

public record EscalationReason(String value) {
    public EscalationReason {
        Objects.requireNonNull(value, "value");
        value = value.strip();
        if (value.length() < 10) {
            throw new IllegalArgumentException("Escalation reason too short");
        }
    }
}
```

Manfaat:

- validation terpusat;
- compiler mencegah parameter tertukar;
- code lebih self-documenting;
- invariant lebih kuat;
- testing lebih fokus;
- API internal lebih jelas;
- audit lebih mudah.

## 7.2 Type sebagai ubiquitous language

Jika domain expert mengatakan:

```text
A case can be escalated only with a valid escalation reason.
```

Code sebaiknya punya:

```java
EscalationReason
CaseEscalated
EscalationPolicy
```

Bukan:

```java
String reason
String type = "ESC"
int status = 4
```

## 7.3 Type membantu auditability

Audit membutuhkan makna:

```text
who did what, when, why, under which policy, from which state to which state
```

Type yang baik:

```java
record CaseStateChanged(
    CaseId caseId,
    CaseStatus from,
    CaseStatus to,
    CaseAction action,
    ActorId actorId,
    DecisionReason reason,
    PolicyVersion policyVersion,
    Instant occurredAt
) {}
```

lebih audit-friendly daripada:

```java
Map<String, Object> audit = ...
```

---

# 8. Mental Model 5: Type sebagai Boundary Antar Sistem

Data jarang tinggal di JVM. Data melewati boundary:

```text
Java object
  ↔ JSON
  ↔ HTTP
  ↔ database
  ↔ Kafka event
  ↔ cache
  ↔ log
  ↔ UI
  ↔ report
```

Setiap boundary bisa mengubah makna.

## 8.1 Java type vs JSON type

Java:

```java
long id = 9_223_372_036_854_775_807L;
```

JSON number bisa dibaca oleh JavaScript sebagai `Number`, yang aman hanya sampai integer 53-bit.

Akibat:

```text
Java long ID bisa kehilangan presisi di JavaScript client
```

Solusi:

```text
Represent long ID as string in external JSON contract
```

## 8.2 Java enum vs API enum

Internal enum:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED
}
```

Jika enum ini langsung diekspos ke API, menambah value baru bisa memecahkan consumer yang tidak siap.

Boundary DTO sebaiknya punya compatibility strategy.

## 8.3 Java `Instant` vs database timestamp

`Instant` adalah point-in-time UTC.

Database punya:

- `timestamp without time zone`;
- `timestamp with time zone`;
- vendor-specific precision;
- timezone conversion behavior;
- driver behavior.

Salah mapping bisa menyebabkan bug deadline/audit.

## 8.4 Java `BigDecimal` vs JSON/database

`BigDecimal` punya:

- precision;
- scale;
- rounding;
- textual representation.

Database `NUMERIC(19, 2)` punya constraint scale/precision.

JSON consumer mungkin membaca number sebagai floating point.

Untuk money, boundary harus eksplisit:

```json
{
  "amountMinor": 125000,
  "currency": "IDR"
}
```

atau:

```json
{
  "amount": "1250.00",
  "currency": "SGD"
}
```

Jangan asal:

```json
{
  "amount": 1250.00
}
```

tanpa kontrak precision.

---

# 9. Dua Keluarga Besar: Primitive Types dan Reference Types

## 9.1 Primitive types

Primitive types adalah:

```text
boolean
byte
short
int
long
char
float
double
```

Primitive:

- bukan object;
- tidak punya identity;
- tidak bisa `null`;
- punya default value jika field/array component;
- disimpan sebagai value;
- operasi arithmetic/comparison langsung;
- tidak bisa dipakai langsung sebagai generic type argument.

Contoh:

```java
List<int> numbers; // tidak valid
List<Integer> numbers; // valid, memakai wrapper
```

## 9.2 Reference types

Reference types:

```text
class
interface
array
```

Contoh:

```java
String
Object
List<String>
CaseId
int[]
Runnable
```

Reference variable dapat menyimpan:

- reference ke object/array;
- `null`.

Reference types punya:

- identity object;
- method dispatch;
- inheritance/subtyping;
- polymorphism;
- object header;
- GC behavior;
- possible aliasing;
- possible mutability.

## 9.3 Primitive vs reference trade-off

| Aspect | Primitive | Reference |
|---|---|---|
| Nullability | tidak bisa null | bisa null |
| Identity | tidak ada | object identity |
| Memory overhead | rendah | lebih tinggi |
| Generics | tidak langsung | ya |
| Domain expressiveness | rendah | tinggi |
| Mutability | value itself immutable | object bisa mutable/immutable |
| Default field value | `0`, `false`, etc. | `null` |
| GC pressure | rendah | tergantung allocation |
| API clarity | sering kurang | bisa sangat jelas |

## 9.4 Primitive bukan selalu lebih baik

`int age` mungkin cukup.

Tetapi:

```java
int status
int type
int currency
int permission
int error
```

sering buruk karena tidak menjelaskan domain.

Primitive tepat untuk:

- numeric computation;
- counters;
- indexes;
- compact arrays;
- low-level performance code;
- simple internal implementation detail.

Reference/domain type tepat untuk:

- public API internal;
- domain concept;
- validation;
- boundary;
- audit;
- preventing parameter mix-up.

---

# 10. Special Null Type dan Mengapa `null` Berbahaya

`null` adalah literal khusus. Ia memiliki special null type, dan null reference dapat dikonversi ke reference type mana pun.

Contoh:

```java
String name = null;
CaseId caseId = null;
List<String> values = null;
```

Tidak bisa:

```java
int x = null; // compile error
```

## 10.1 Null bukan object

`null` bukan instance dari class mana pun.

```java
Object o = null;
System.out.println(o instanceof Object); // false
```

## 10.2 Null menyembunyikan makna

`null` bisa berarti banyak hal:

```text
unknown
not provided
not applicable
not loaded
not authorized
not found
not calculated yet
failed
empty
unset
```

Jika semua memakai `null`, caller tidak tahu makna sebenarnya.

## 10.3 Null as absence

Untuk return value, `Optional<T>` kadang lebih jelas:

```java
Optional<OfficerId> assignedOfficer()
```

Tetapi untuk field/domain state, sering lebih baik pakai type yang lebih eksplisit.

Buruk:

```java
private Instant closedAt; // null jika belum closed
private String closeReason; // null jika belum closed
```

Lebih baik dengan sealed state:

```java
sealed interface CaseState permits Open, Closed {}

record Open() implements CaseState {}
record Closed(Instant closedAt, ClosureReason reason) implements CaseState {}
```

Sekarang `closedAt` dan `reason` hanya ada jika state benar-benar `Closed`.

## 10.4 Null dan unboxing

```java
Integer count = null;
int x = count; // NullPointerException
```

Unboxing null adalah failure mode umum.

## 10.5 Null policy

Untuk codebase serius, harus ada policy:

- Apakah parameter boleh null?
- Apakah return boleh null?
- Apakah field boleh null?
- Apakah collection boleh null atau empty?
- Apakah pakai nullability annotation?
- Apakah pakai Optional?
- Apakah JSON null diterima?
- Apakah DB nullable mapped ke wrapper/Optional/domain state?

Default yang baik:

```text
Non-null by default.
Absence harus eksplisit.
Collection kosong lebih baik daripada null.
Domain state lebih baik daripada field nullable.
```

---

# 11. Variable, Value, Object, Reference: Jangan Dicampur

Banyak kebingungan Java berasal dari mencampur empat istilah ini.

## 11.1 Variable

Variable adalah storage location.

```java
int x = 10;
```

`x` adalah variable.

## 11.2 Value

Value adalah isi yang dimiliki variable/expression.

```java
10
true
'a'
3.14
reference to object
null
```

## 11.3 Object

Object adalah instance dari class atau array yang berada di heap.

```java
new CaseId(UUID.randomUUID())
new int[10]
"hello"
```

## 11.4 Reference

Reference adalah value yang menunjuk ke object.

```java
CaseId id = new CaseId(UUID.randomUUID());
```

`id` adalah variable. Nilai dalam `id` adalah reference ke object `CaseId`.

## 11.5 Java is pass-by-value

Java selalu pass-by-value.

Untuk primitive:

```java
void increment(int x) {
    x++;
}
```

Caller tidak berubah.

Untuk reference:

```java
void rename(Person p) {
    p.setName("New");
}
```

Reference value dicopy. Kedua reference menunjuk object yang sama, sehingga object bisa berubah.

Tetapi reassign parameter tidak mengubah caller:

```java
void replace(Person p) {
    p = new Person("Other");
}
```

Caller tetap menunjuk object lama.

Mental model:

```text
Java copies values.
For references, copied value is a reference.
```

---

# 12. Compile-Time Type vs Runtime Class

Java punya compile-time type dan runtime class.

Contoh:

```java
CharSequence text = "hello";
```

Compile-time type variable `text`:

```text
CharSequence
```

Runtime class object:

```text
String
```

## 12.1 Method yang bisa dipanggil ditentukan compile-time type

```java
CharSequence text = "hello";

text.length();      // valid
text.toUpperCase(); // compile error
```

`toUpperCase()` ada di `String`, tapi compile-time type `CharSequence` tidak punya method itu.

Butuh cast:

```java
String s = (String) text;
s.toUpperCase();
```

## 12.2 Dispatch terjadi runtime

```java
interface Rule {
    boolean matches(Case c);
}

Rule rule = new EscalationRule();
rule.matches(c);
```

Compiler melihat `Rule`. Runtime memilih implementation `EscalationRule`.

Ini dasar polymorphism.

## 12.3 Runtime class dan proxy

Framework sering mengganti runtime class dengan proxy.

```java
CaseService service = applicationContext.getBean(CaseService.class);
System.out.println(service.getClass());
```

Bisa output:

```text
CaseService$$SpringCGLIB$$0
jdk.proxy2.$Proxy123
```

Jadi jangan desain logic yang bergantung pada:

```java
obj.getClass() == CaseService.class
```

jika framework proxy mungkin terlibat.

Gunakan interface/behavior, atau utility framework jika butuh target class.

## 12.4 Type erasure

Generics Java sebagian besar dihapus saat runtime.

```java
List<String> names = List.of("a");
List<Integer> numbers = List.of(1);
```

Runtime class keduanya biasanya sama-sama implementation List, bukan `List<String>` vs `List<Integer>` sebagai class terpisah.

Ini penting untuk:

- serialization;
- reflection;
- framework generic resolution;
- type token;
- unchecked cast;
- raw type bugs.

---

# 13. Static Typing, Strong Typing, dan Nominal Typing di Java

## 13.1 Static typing

Java melakukan type checking saat compile-time.

```java
int x = "hello"; // compile error
```

Namun Java juga punya dynamic behavior:

- dynamic dispatch;
- reflection;
- class loading;
- proxies;
- casts;
- `instanceof`;
- generics erasure.

Jadi Java bukan “semua ditentukan compile-time”. Tetapi core type checking-nya static.

## 13.2 Strong typing

Java tidak mengizinkan operasi sembarangan antar type tanpa aturan conversion.

```java
String s = 123; // compile error
```

Namun Java punya conversion:

```java
long x = 123;       // widening
int y = (int) 123L; // narrowing explicit
```

## 13.3 Nominal typing

Java mostly nominally typed: compatibility berdasarkan deklarasi nama type/interface/inheritance, bukan hanya shape.

Contoh:

```java
class A {
    void run() {}
}

class B {
    void run() {}
}
```

Walaupun shape sama, `A` bukan `B`.

Interface eksplisit:

```java
interface RunnableTask {
    void run();
}

class A implements RunnableTask {
    public void run() {}
}
```

Nominal typing membuat domain type kuat:

```java
record CaseId(UUID value) {}
record OfficerId(UUID value) {}
```

Walau shape sama, keduanya type berbeda.

## 13.4 Structural thinking tetap berguna

Walaupun Java nominal, kamu bisa mendesain interface berdasarkan capability:

```java
interface HasCaseId {
    CaseId caseId();
}
```

Tetapi jangan overuse marker/capability interface jika tidak ada behavior nyata.

---

# 14. Type Conversion: Ketika Compiler Mengizinkan Perubahan Bentuk

Type conversion adalah sumber banyak bug.

## 14.1 Widening primitive conversion

```java
int i = 10;
long l = i;
double d = l;
```

Biasanya aman dari sisi range untuk integer widening, tetapi bisa kehilangan precision saat ke floating-point.

## 14.2 Narrowing primitive conversion

```java
long l = 1_000_000_000_000L;
int i = (int) l; // overflow/truncation
```

Compile but dangerous.

## 14.3 Numeric promotion

```java
byte a = 1;
byte b = 2;
byte c = a + b; // compile error, a+b promoted to int
```

## 14.4 Compound assignment trap

```java
byte b = 1;
b += 1; // compile, implicit cast
```

`b += 1` roughly includes implicit narrowing conversion.

## 14.5 Boxing/unboxing

```java
Integer x = 1; // boxing
int y = x;     // unboxing
```

Trap:

```java
Integer x = null;
int y = x; // NPE
```

## 14.6 Reference casting

```java
Object o = "hello";
String s = (String) o; // ok

Object n = 123;
String bad = (String) n; // ClassCastException
```

## 14.7 Conversion as boundary smell

Jika banyak cast:

```java
Object value = map.get("caseId");
CaseId id = (CaseId) value;
```

mungkin design terlalu loose.

Better:

```java
record CaseCommand(CaseId caseId, OfficerId officerId) {}
```

---

# 15. Type Inference: `var` Bukan Dynamic Typing

`var` adalah local variable type inference.

```java
var name = "Fajar";
```

Compiler menyimpulkan:

```java
String name = "Fajar";
```

Setelah itu type tetap statis.

```java
var x = 10;
x = "hello"; // compile error
```

## 15.1 Kapan `var` baik?

Baik jika RHS jelas:

```java
var caseId = new CaseId(UUID.randomUUID());
var users = new ArrayList<User>();
var result = repository.findById(id);
```

## 15.2 Kapan `var` buruk?

Buruk jika type penting tapi tidak jelas:

```java
var data = client.call();
var result = process(data);
var value = map.get(key);
```

Jika pembaca harus hover IDE untuk paham type, mungkin explicit type lebih baik.

## 15.3 `var` dapat menyembunyikan type terlalu umum

```java
var list = new ArrayList<>();
```

Type inferred:

```java
ArrayList<Object>
```

Atau diamond inference mungkin tidak sesuai ekspektasi tergantung context.

Lebih baik:

```java
List<CaseId> ids = new ArrayList<>();
```

## 15.4 Principle

Gunakan `var` untuk mengurangi noise, bukan mengurangi informasi penting.

---

# 16. Identity vs Value: Pertanyaan Paling Penting pada Data Type

Pertanyaan pertama untuk type design:

```text
Apakah konsep ini punya identity atau hanya value?
```

## 16.1 Entity identity

Entity:

```text
same identity, state may change over time
```

Contoh:

```java
EnforcementCase
Officer
Application
License
```

Case yang sama bisa berubah status dari `OPEN` ke `CLOSED`, tetapi identity-nya tetap.

## 16.2 Value object

Value object:

```text
same values mean same value
```

Contoh:

```java
CaseId
Money
DateRange
EmailAddress
EscalationReason
Severity
```

`Money(100, "SGD")` sama dengan `Money(100, "SGD")`.

## 16.3 Java consequences

Entity equality:

- biasanya by ID;
- hati-hati jika ID generated setelah persist;
- mutable state tidak boleh masuk hashCode jika object jadi key.

Value object equality:

- by all meaningful fields;
- cocok dengan record;
- harus immutable.

## 16.4 Wrong identity modeling

Bug:

```java
record Case(String id, String status) {}
```

Record equality by all components. Jika status berubah, equality/hashCode berubah.

Untuk entity, record sering bukan pilihan terbaik jika lifecycle mutable.

Better:

```java
final class EnforcementCase {
    private final CaseId id;
    private CaseStatus status;
}
```

---

# 17. Mutability dan Ownership

## 17.1 Mutable object

Object bisa berubah setelah dibuat.

```java
class Case {
    private CaseStatus status;

    void close() {
        this.status = CaseStatus.CLOSED;
    }
}
```

Mutable cocok untuk entity lifecycle, tetapi harus dikontrol.

## 17.2 Immutable object

Object tidak berubah setelah dibuat.

```java
record CaseId(UUID value) {}
record Money(BigDecimal amount, Currency currency) {}
```

Immutable cocok untuk value object, command, event, result.

## 17.3 Shallow immutability

Record tidak otomatis deep immutable.

```java
record EvidenceSet(List<String> ids) {}
```

Jika list mutable diberikan ke constructor, isi bisa berubah dari luar.

Fix:

```java
record EvidenceSet(List<String> ids) {
    EvidenceSet {
        ids = List.copyOf(ids);
    }
}
```

## 17.4 Ownership

Jika method menerima mutable object:

```java
void setItems(List<Item> items) {
    this.items = items;
}
```

Siapa pemilik list? Caller atau object ini?

Jika caller masih punya reference dan mengubah list, invariant bisa rusak.

Gunakan defensive copy:

```java
this.items = List.copyOf(items);
```

## 17.5 Mutability and concurrency

Immutable object lebih mudah dishare antar thread.

Mutable object butuh:

- synchronization;
- volatile;
- confinement;
- immutable snapshots;
- copy-on-write;
- ownership discipline.

---

# 18. Equality, Ordering, dan Hashing sebagai Kontrak Type

Type yang masuk collection harus punya kontrak equality/hashing benar.

## 18.1 `equals` dan `hashCode`

Jika dua object equal, hashCode harus sama.

```java
a.equals(b) => a.hashCode() == b.hashCode()
```

Jika tidak, `HashMap`/`HashSet` rusak secara behavior.

## 18.2 Mutable key bug

```java
record Key(String value) {}

Map<Key, String> map = new HashMap<>();
Key key = new Key("A");
map.put(key, "value");
```

Record immutable aman.

Tapi mutable key:

```java
class MutableKey {
    String value;
    ...
}
```

Jika `value` berubah setelah dimasukkan ke `HashMap`, lookup bisa gagal.

## 18.3 Ordering

`Comparable` harus konsisten dengan equals jika digunakan di sorted collections.

`TreeSet` memakai comparator untuk uniqueness.

Jika comparator menganggap dua object sama (`compare == 0`) tetapi equals false, satu object bisa hilang dari set.

## 18.4 Domain ordering

Ordering harus punya makna domain.

Contoh `Severity`:

```java
enum Severity {
    LOW(1), MEDIUM(2), HIGH(3), CRITICAL(4);

    private final int rank;

    boolean isHigherThan(Severity other) {
        return this.rank > other.rank;
    }
}
```

Jangan mengandalkan enum ordinal untuk persistence atau external contract.

---

# 19. Representasi Data dalam Memory: Yang Harus Dipahami Sejak Awal

Kita akan deep dive nanti, tetapi mental model awal penting.

## 19.1 Primitive field vs reference field

```java
class A {
    int x;
    String s;
}
```

`x` adalah primitive field.

`s` adalah reference field ke object String atau null.

## 19.2 Object graph

```java
Case
  -> CaseId
      -> UUID
  -> OfficerId
      -> String
  -> List<Note>
      -> Note
      -> Note
```

Banyak reference berarti object graph lebih besar dan traversal bisa lebih mahal.

## 19.3 Compactness vs expressiveness

Domain type:

```java
record CaseId(UUID value) {}
```

lebih jelas tetapi menambah object wrapper dibanding raw UUID.

Apakah itu masalah? Biasanya tidak untuk domain object normal.

Tapi untuk 100 juta IDs dalam memory, representasi compact mungkin penting.

Top engineer tidak anti value object, tetapi tahu kapan representation cost relevan.

## 19.4 Allocation rate

Data type pilihan memengaruhi allocation rate.

Contoh:

```java
stream.map(x -> new Money(...))
```

dalam hot loop bisa menghasilkan banyak object.

JIT escape analysis mungkin menghapus beberapa allocation, tetapi jangan bergantung tanpa evidence.

Gunakan JFR/JMH jika performance kritikal.

---

# 20. Data Type di Boundary: JSON, Database, Kafka, API, dan UI

## 20.1 Internal type tidak harus sama dengan external type

Internal:

```java
record CaseId(UUID value) {}
```

External JSON:

```json
{
  "caseId": "0192f..."
}
```

Database:

```sql
case_id UUID
```

Kafka key:

```text
caseId string/bytes
```

UI:

```text
display case number CASE-2026-0001
```

Satu domain concept bisa punya banyak representation.

## 20.2 DTO boundary

Jangan expose domain object langsung.

Domain:

```java
record Money(long minorUnits, Currency currency) {}
```

API DTO:

```java
record MoneyDto(String amount, String currency) {}
```

Mapping harus eksplisit.

## 20.3 Versioning

Type di boundary harus evolvable.

Internal enum bisa berubah. External contract harus lebih hati-hati.

Contoh menambah enum value:

```text
Internal: okay if all code exhaustive updated.
External: breaking if consumers don't tolerate unknown.
```

## 20.4 Logs and PII

Type bisa membantu masking.

```java
record EmailAddress(String value) {
    String masked() { ... }
}
```

Jangan log raw sensitive type.

## 20.5 Event schema

Domain event internal:

```java
record CaseEscalated(CaseId id, Severity severity, EscalationReason reason) {}
```

Integration event:

```java
record CaseEscalatedV1(String caseId, String severity, String occurredAt) {}
```

Pisahkan agar internal evolution tidak memecah consumers.

---

# 21. Type Design: Dari Primitive Obsession ke Domain-Specific Type

Primitive obsession adalah kebiasaan merepresentasikan konsep domain dengan primitive/string umum.

Contoh:

```java
record CaseDto(
    String id,
    String status,
    String severity,
    String assignedOfficer,
    String reason
) {}
```

Ini mungkin cocok sebagai boundary DTO, tetapi buruk jika menjadi domain core.

## 21.1 Step refactor

Mulai dari:

```java
void escalate(String caseId, String severity, String reason, String officerId)
```

Refactor menjadi:

```java
void escalate(
    CaseId caseId,
    Severity severity,
    EscalationReason reason,
    OfficerId officerId
)
```

Lalu pindahkan behavior:

```java
caseRecord.escalate(new EscalateCase(caseId, severity, reason, officerId), policy, clock);
```

## 21.2 Kapan membuat type sendiri?

Buat type sendiri jika:

- konsep domain penting;
- sering dipakai;
- punya validation;
- raw type mudah tertukar;
- butuh masking/logging khusus;
- butuh serialization/persistence khusus;
- punya invariant;
- muncul di audit/API;
- bug akibat salah value mahal.

Tidak perlu type sendiri jika:

- scope sangat lokal;
- tidak punya makna domain;
- tidak ada invariant;
- tidak membuat API lebih jelas;
- hanya membungkus tanpa value.

## 21.3 Over-modeling

Terlalu banyak tiny type juga bisa membuat code berat.

Contoh berlebihan:

```java
record FirstCharacterOfMiddleName(String value) {}
```

Jika tidak ada invariant/domain meaning, mungkin tidak perlu.

Prinsip:

```text
Model meaning, not ceremony.
```

---

# 22. Modern Java Type Modeling: Records, Sealed Types, Pattern Matching

Java modern memberi alat lebih kuat untuk data modeling.

## 22.1 Records

Records cocok untuk:

- value object;
- DTO;
- command;
- event;
- result;
- query;
- immutable data carrier.

Contoh:

```java
public record EscalateCase(
    CommandId commandId,
    CaseId caseId,
    OfficerId officerId,
    Severity newSeverity,
    EscalationReason reason
) {
    public EscalateCase {
        Objects.requireNonNull(commandId);
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(officerId);
        Objects.requireNonNull(newSeverity);
        Objects.requireNonNull(reason);
    }
}
```

## 22.2 Sealed types

Sealed types cocok untuk closed alternatives.

```java
sealed interface CloseCaseResult permits CaseClosed, CloseCaseRejected {}

record CaseClosed(CaseId caseId) implements CloseCaseResult {}
record CloseCaseRejected(CaseId caseId, CloseCaseError error) implements CloseCaseResult {}
```

## 22.3 Pattern matching

```java
String message(CloseCaseResult result) {
    return switch (result) {
        case CaseClosed closed -> "Closed " + closed.caseId();
        case CloseCaseRejected rejected -> "Rejected: " + rejected.error();
    };
}
```

Compiler membantu memastikan semua subtype tertangani jika sealed hierarchy exhaustively known.

## 22.4 Data-oriented programming in Java

Records + sealed + pattern matching memungkinkan style yang lebih data-oriented:

```text
Define data shapes explicitly.
Define closed alternatives.
Use exhaustive pattern matching.
Keep transformations explicit.
```

Tetapi jangan ubah Java menjadi bahasa lain secara paksa. Entity lifecycle dan encapsulated behavior tetap penting.

---

# 23. Cara Membaca Kode Java dari Sudut Type System

Saat membaca class/method, tanyakan:

## 23.1 Untuk field

```java
private String status;
```

Pertanyaan:

- mengapa String?
- possible values apa?
- apakah closed set?
- apakah nullable?
- apakah ada invariant?
- apakah status transition legal?
- apakah status disimpan/dikirim keluar?

## 23.2 Untuk parameter

```java
void pay(double amount)
```

Pertanyaan:

- amount ini uang?
- currency mana?
- boleh negatif?
- precision?
- rounding?
- double aman?

## 23.3 Untuk return type

```java
boolean validate(Command command)
```

Pertanyaan:

- jika false, alasannya apa?
- butuh error code?
- butuh multiple violations?
- butuh audit?
- apakah boolean cukup?

## 23.4 Untuk collection

```java
List<Item> items()
```

Pertanyaan:

- mutable?
- ordered?
- boleh duplicate?
- boleh empty?
- boleh null element?
- ukuran bounded?
- snapshot atau live view?

## 23.5 Untuk `Map<String,Object>`

Pertanyaan:

- apakah schema hilang?
- apakah bisa diganti record?
- apakah key typo terdeteksi?
- siapa memvalidasi value type?
- apakah serialization aman?

---

# 24. Failure Modes Production karena Type Design Buruk

## 24.1 Money rounding bug

```java
double amount = 0.1 + 0.2;
```

Menyebabkan mismatch settlement/reporting.

Fix:

```java
Money
BigDecimal with explicit scale/rounding
long minor unit
```

## 24.2 Status typo

```java
status = "CLOESD";
```

Tidak terdeteksi jika status string.

Fix:

```java
enum CaseStatus
state machine
```

## 24.3 Boolean state impossible combination

```java
approved = true;
rejected = true;
```

Fix:

```java
enum DecisionStatus
sealed Decision
```

## 24.4 NPE from unboxing

```java
Boolean active = null;
if (active) { ... }
```

Fix:

```java
boolean with default
Optional/tri-state enum
explicit nullable handling
```

## 24.5 Mutable key in HashMap

Object key berubah setelah dimasukkan map, lookup gagal.

Fix:

```java
immutable key
record value object
```

## 24.6 JSON long precision loss

Java `long` ID dikirim sebagai JSON number, JavaScript kehilangan presisi.

Fix:

```text
ID as string externally
```

## 24.7 Date/time timezone bug

`LocalDateTime` dipakai untuk event timestamp global.

Fix:

```java
Instant for audit/event occurrence
ZonedDateTime only when zone is part of meaning
LocalDate for business date
```

## 24.8 Enum evolution breaks consumer

Consumer switch tidak handle enum baru.

Fix:

- external contract versioning;
- unknown value handling;
- tolerant reader;
- schema compatibility testing.

## 24.9 `Map<String,Object>` payload runtime failure

Wrong type stored:

```java
payload.put("amount", "100");
BigDecimal amount = (BigDecimal) payload.get("amount");
```

ClassCastException production.

Fix:

```java
record PaymentRequest(Money amount, PayerId payerId) {}
```

## 24.10 Audit cannot explain decision

```java
boolean eligible = false;
```

No reason.

Fix:

```java
record EligibilityDecision(boolean eligible, Reason reason, PolicyVersion policyVersion) {}
```

---

# 25. Prinsip Desain Data Type untuk Engineer Senior

## 25.1 Prefer explicit domain type at internal boundaries

Internal use case APIs should use domain-specific types.

```java
EscalateCaseResult escalate(EscalateCase command)
```

not:

```java
Map<String, Object> escalate(Map<String, Object> request)
```

## 25.2 Keep boundary DTO separate

External boundary has compatibility concerns. Domain type has invariant concerns.

Separate them.

## 25.3 Make invalid state hard to represent

Use:

- value object validation;
- enum;
- sealed state;
- constructor/factory;
- private fields;
- no public setters;
- defensive copy.

## 25.4 Be explicit about absence

Avoid ambiguous null.

Use:

- Optional for return;
- empty collection;
- sealed result;
- domain state;
- nullable annotation if needed.

## 25.5 Be explicit about time

Use:

- `Instant` for machine timestamp/audit;
- `LocalDate` for business date;
- `ZonedDateTime` when zone matters;
- `Clock` for testability;
- explicit timezone policy.

## 25.6 Be explicit about numeric semantics

Use:

- `int`/`long` for counters/indexes;
- `long minorUnits` or `BigDecimal` for money;
- `BigDecimal` with scale/rounding for decimal business;
- avoid `double` for money;
- guard overflow if needed.

## 25.7 Prefer immutability for values

Value objects, commands, events, results should be immutable.

## 25.8 Measure before optimizing representation

Don't avoid domain types because of imagined performance cost. Use JFR/JMH if needed.

## 25.9 Design for evolution

Ask:

- can this enum get new values?
- can this record get new fields?
- can this JSON schema evolve?
- can database column become nullable/non-null?
- can old consumer read new event?

## 25.10 Document semantics near type

A good type carries docs/tests/examples.

```java
/**
 * Business date in Asia/Singapore used for regulatory deadline calculation.
 * This is not an Instant.
 */
public record RegulatoryBusinessDate(LocalDate value) {}
```

---

# 26. Checklist Awal Saat Mendesain Field/Parameter/Return Type

## 26.1 Field checklist

- [ ] Apa konsep domain field ini?
- [ ] Apakah primitive/string cukup?
- [ ] Apakah butuh value object?
- [ ] Apakah nullable?
- [ ] Apakah mutable?
- [ ] Apakah perlu validation?
- [ ] Apakah perlu normalization?
- [ ] Apakah masuk equality/hashCode?
- [ ] Apakah disimpan DB?
- [ ] Apakah diserialisasi?
- [ ] Apakah boleh dilog?
- [ ] Apakah punya compatibility risk?

## 26.2 Parameter checklist

- [ ] Apakah parameter mudah tertukar?
- [ ] Apakah jumlah parameter terlalu banyak?
- [ ] Apakah boolean parameter menyembunyikan intent?
- [ ] Apakah lebih baik command object?
- [ ] Apakah null boleh?
- [ ] Apakah validation sudah terjadi?

## 26.3 Return type checklist

- [ ] Apakah bisa gagal?
- [ ] Jika gagal, perlu reason?
- [ ] Apakah absence normal?
- [ ] Apakah return boolean cukup?
- [ ] Apakah perlu result object?
- [ ] Apakah collection bounded?
- [ ] Apakah caller boleh mutate result?

## 26.4 Boundary checklist

- [ ] Java type mapping ke JSON jelas?
- [ ] Java type mapping ke DB jelas?
- [ ] Precision/timezone/enum compatibility jelas?
- [ ] Unknown values handled?
- [ ] Versioning strategy ada?
- [ ] Security/PII masking jelas?

---

# 27. Latihan Mental Model

## Latihan 1 — Ganti primitive dengan domain type

Dari:

```java
void approve(String caseId, String officerId, String reason) {}
```

Ubah menjadi domain type:

```java
void approve(CaseId caseId, OfficerId officerId, ApprovalReason reason) {}
```

Tambahkan validation minimal.

## Latihan 2 — Boolean ke sealed result

Dari:

```java
boolean isEligible(Case c) {}
```

Ubah ke:

```java
sealed interface EligibilityResult permits Eligible, NotEligible {}

record Eligible() implements EligibilityResult {}
record NotEligible(Reason reason) implements EligibilityResult {}
```

## Latihan 3 — Status string ke state machine

Dari:

```java
String status;
```

Ubah ke:

```java
enum CaseStatus
```

lalu buat transition policy.

## Latihan 4 — Null fields ke sealed state

Dari:

```java
Instant closedAt;
String closedReason;
```

Ubah ke:

```java
sealed interface CaseState
record Open(...) implements CaseState
record Closed(Instant closedAt, ClosureReason reason) implements CaseState
```

## Latihan 5 — Boundary mapping

Buat tiga representation untuk `Money`:

- domain type;
- JSON DTO;
- database columns.

Jelaskan conversion dan precision.

---

# 28. Ringkasan

Java type system bukan sekadar daftar tipe dasar. Type system adalah alat untuk:

- membatasi nilai legal;
- membatasi operasi legal;
- membantu compiler menemukan bug;
- menjelaskan domain;
- menjaga invariant;
- mengontrol memory/performance;
- membuat API lebih aman;
- membuat serialization/database mapping jelas;
- mencegah illegal state;
- mendukung audit dan evolusi sistem.

Mental model paling penting:

```text
Type = meaning + constraints + operations + representation + boundary contract
```

Jika kamu memilih type dengan benar, banyak bug tidak pernah terjadi.

Jika kamu memilih type terlalu longgar, bug berpindah ke runtime, production, audit, dan incident.

Engineer top-tier menggunakan type bukan hanya untuk membuat code compile, tetapi untuk membuat system lebih benar, jelas, aman, dan mudah berevolusi.

---

# 29. Referensi

1. Java Language Specification SE 25 — Chapter 4: Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

2. Java Virtual Machine Specification SE 25  
   https://docs.oracle.com/javase/specs/jvms/se25/html/index.html

3. Java SE 25 Language Changes Summary  
   https://docs.oracle.com/en/java/javase/25/language/java-language-changes-summary.html

4. JEP 395 — Records  
   https://openjdk.org/jeps/395

5. JEP 409 — Sealed Classes  
   https://openjdk.org/jeps/409

6. JEP 441 — Pattern Matching for switch  
   https://openjdk.org/jeps/441

7. Oracle Java SE 25 API Documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/index.html

8. Oracle Java SE 25 Tool Specifications  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/index.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-034.md](../concurrency/learn-java-concurrency-and-reactive-part-034.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-001.md](./learn-java-data-types-part-001.md)
