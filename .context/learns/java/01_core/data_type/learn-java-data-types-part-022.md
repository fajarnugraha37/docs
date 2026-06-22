# learn-java-data-types-part-022.md

# Java Data Types — Part 022  
# Data Layout, Object Header, Alignment, Compressed Oops, dan Memory Footprint

> Seri: **Advanced Java Data Types**  
> Bagian: **022**  
> Fokus: memahami konsekuensi memory dari pilihan data type di Java: object header, reference, alignment, padding, primitive fields, wrapper overhead, arrays, object graph, compressed ordinary object pointers, compressed class pointers, compact object headers, shallow size vs retained size, cache locality, JOL, `Instrumentation.getObjectSize`, dan bagaimana membuat keputusan type yang memory-aware tanpa bergantung pada layout implementation-specific.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Data Layout Penting](#2-kenapa-data-layout-penting)
3. [Mental Model: Java Object Bukan Hanya Field](#3-mental-model-java-object-bukan-hanya-field)
4. [Specification vs Implementation Detail](#4-specification-vs-implementation-detail)
5. [Object Header](#5-object-header)
6. [Mark Word, Class Pointer, dan Array Length](#6-mark-word-class-pointer-dan-array-length)
7. [Object Alignment dan Padding](#7-object-alignment-dan-padding)
8. [Reference Size dan Compressed Oops](#8-reference-size-dan-compressed-oops)
9. [Compressed Class Pointers](#9-compressed-class-pointers)
10. [Compact Object Headers: Modern HotSpot Direction](#10-compact-object-headers-modern-hotspot-direction)
11. [Primitive Fields vs Reference Fields](#11-primitive-fields-vs-reference-fields)
12. [Wrapper Types dan Boxing Overhead](#12-wrapper-types-dan-boxing-overhead)
13. [String Memory Layout dan Compact Strings](#13-string-memory-layout-dan-compact-strings)
14. [Arrays: Header + Length + Elements](#14-arrays-header--length--elements)
15. [Primitive Arrays vs Reference Arrays](#15-primitive-arrays-vs-reference-arrays)
16. [Multidimensional Arrays: Array of Arrays](#16-multidimensional-arrays-array-of-arrays)
17. [Object Graph: Shallow Size vs Retained Size](#17-object-graph-shallow-size-vs-retained-size)
18. [Collections Memory Footprint](#18-collections-memory-footprint)
19. [`ArrayList`, `LinkedList`, `HashMap`, `EnumMap`, `EnumSet`](#19-arraylist-linkedlist-hashmap-enummap-enumset)
20. [Records, Classes, dan Value Object Footprint](#20-records-classes-dan-value-object-footprint)
21. [Field Layout, Padding, dan Field Order](#21-field-layout-padding-dan-field-order)
22. [Cache Locality](#22-cache-locality)
23. [Allocation Rate dan GC Pressure](#23-allocation-rate-dan-gc-pressure)
24. [Measuring Object Size dengan JOL](#24-measuring-object-size-dengan-jol)
25. [`Instrumentation.getObjectSize`](#25-instrumentationgetobjectsize)
26. [Heap Dump, JFR, Native Memory Tracking](#26-heap-dump-jfr-native-memory-tracking)
27. [Designing Memory-Aware Domain Types](#27-designing-memory-aware-domain-types)
28. [Large Data dan Primitive Collections](#28-large-data-dan-primitive-collections)
29. [Off-Heap, ByteBuffer, dan MemorySegment](#29-off-heap-bytebuffer-dan-memorysegment)
30. [Production Failure Modes](#30-production-failure-modes)
31. [Best Practices](#31-best-practices)
32. [Decision Matrix](#32-decision-matrix)
33. [Latihan](#33-latihan)
34. [Ringkasan](#34-ringkasan)
35. [Referensi](#35-referensi)

---

# 1. Tujuan Bagian Ini

Di Java, kita sering menulis:

```java
record UserId(Long value) {}
record Point(Integer x, Integer y) {}
List<Integer> numbers = new ArrayList<>();
```

Secara semantik mungkin benar, tetapi dari sisi memory bisa sangat mahal.

Contoh:

```java
int[] numbers = new int[1_000_000];
```

dibanding:

```java
List<Integer> numbers = new ArrayList<>();
```

Keduanya sama-sama “kumpulan angka”, tetapi layout memory sangat berbeda:

- `int[]` menyimpan 1 juta primitive `int` secara contiguous;
- `ArrayList<Integer>` menyimpan array of references ke 1 juta object `Integer` yang masing-masing punya header/object overhead;
- jika nilai tidak cached, ada 1 juta object tambahan;
- GC harus melacak object graph jauh lebih besar.

Tujuan bagian ini:

- memberi mental model memory layout Java object;
- memahami header, reference, alignment, padding;
- memahami compressed oops;
- memahami shallow vs retained size;
- memahami arrays/collections/wrapper overhead;
- memahami kenapa `LinkedList` sering memory-heavy;
- memahami bagaimana mengukur dengan JOL/JFR/heap dump;
- membuat keputusan data type yang memory-aware.

Catatan penting:

```text
Jangan menulis business code yang bergantung pada object layout HotSpot tertentu.
Gunakan pemahaman ini untuk desain/performance reasoning dan measurement.
```

---

# 2. Kenapa Data Layout Penting

Memory footprint memengaruhi:

- heap usage;
- GC frequency;
- GC pause/CPU;
- cache locality;
- allocation rate;
- throughput;
- latency;
- container memory limit;
- cloud cost;
- OOM risk.

## 2.1 Small object overhead becomes huge at scale

Satu object kecil mungkin tampak murah.

Tapi 10 juta object kecil:

```text
object header
alignment padding
reference fields
GC metadata/tracking
pointer chasing
```

menjadi besar.

## 2.2 Object graph complexity

```java
List<OrderLine>
```

bukan hanya satu list.

Bisa terdiri dari:

```text
ArrayList object
internal Object[] array
N OrderLine objects
inside each OrderLine: ProductId object, Money object, BigDecimal object, Currency reference, ...
```

## 2.3 GC sees objects, not just bytes

Semakin banyak object, semakin banyak metadata/traversal/reference processing.

## 2.4 CPU cache

Contiguous primitive arrays lebih cache-friendly daripada linked node objects tersebar di heap.

## 2.5 Container memory

Di Kubernetes/ECS, memory limit ketat. Object overhead dapat menjadi biaya nyata.

---

# 3. Mental Model: Java Object Bukan Hanya Field

Jika kamu menulis:

```java
class Point {
    int x;
    int y;
}
```

Kamu mungkin berpikir ukuran = 8 bytes.

Tapi object punya:

```text
object header
fields
padding/alignment
```

Rough mental model:

```text
object size ≈ header + instance fields + padding
```

Untuk array:

```text
array size ≈ header + length field + elements + padding
```

Untuk reference field:

```text
reference field stores pointer/reference
referenced object has its own size elsewhere
```

## 3.1 Reference is not object

```java
String name;
```

Field `name` menyimpan reference. Object `String` ada terpisah.

## 3.2 Object graph

Object dengan reference fields membentuk graph.

```java
User -> DisplayName -> String -> byte[]
```

## 3.3 Shallow size

Size object itu sendiri, tidak termasuk objects yang direferensikan.

## 3.4 Retained size

Memory yang akan bebas jika object ini dan object yang hanya reachable darinya dikumpulkan GC.

## 3.5 Data layout matters for data type design

`record CaseId(String value)` is semantically excellent, but if you store 100 million IDs, memory representation matters.

---

# 4. Specification vs Implementation Detail

Java Language Specification tidak menjanjikan object header size, field order, reference size, padding, atau layout object tertentu.

Hal-hal seperti:

- object header bytes;
- compressed oops;
- alignment;
- field packing;
- array header;
- compact headers;

adalah implementation detail JVM, sering HotSpot-specific.

## 4.1 Do not depend on layout

Jangan menulis logic:

```java
// assumes object header 12 bytes
```

Ini tidak portable.

## 4.2 Use measurement per runtime

Ukuran dapat berubah karena:

- JVM vendor;
- version;
- architecture;
- flags;
- heap size;
- compressed oops enabled/disabled;
- object alignment;
- compact object headers;
- GC;
- preview/experimental features.

## 4.3 Why still learn?

Karena mental model membantu:

- memilih primitive vs wrapper;
- memilih array vs list;
- menghindari linked structures;
- memahami OOM;
- memahami GC pressure;
- mengukur dengan benar.

## 4.4 Production rule

```text
Reason with model.
Confirm with measurement.
Do not rely on exact bytes unless measured in target runtime.
```

---

# 5. Object Header

Setiap ordinary Java object punya object header.

Pada HotSpot klasik, object header secara konseptual berisi:

- mark word;
- class metadata pointer / klass pointer.

Dengan arrays, ada length field juga.

## 5.1 Mark word

Mark word menyimpan informasi runtime seperti:

- identity hash code;
- lock state;
- GC age;
- metadata terkait synchronization.

Detail berubah antar JVM/version.

## 5.2 Class pointer

Menunjuk metadata class object/type.

Compressed class pointers dapat mengurangi size pointer metadata class.

## 5.3 Header cost

Object kecil tetap membayar header.

```java
new Object()
```

tidak punya field, tetapi tetap punya header + alignment.

## 5.4 Many tiny objects

Millions of tiny wrappers/value objects can have large overhead.

## 5.5 Compact object headers

Modern HotSpot memiliki pekerjaan untuk mengurangi object header footprint. Ini membuat exact number makin version/flag-dependent.

---

# 6. Mark Word, Class Pointer, dan Array Length

## 6.1 Ordinary object conceptual layout

```text
[ mark word ][ class pointer ][ fields ][ padding ]
```

## 6.2 Array conceptual layout

```text
[ mark word ][ class pointer ][ length ][ elements ][ padding ]
```

## 6.3 Array length

Array memiliki `length` sebagai bagian dari object.

```java
int[] a = new int[10];
a.length
```

## 6.4 Array store checks

Reference arrays carry runtime component type information via class metadata.

```java
String[] strings = new String[1];
Object[] objects = strings;
objects[0] = 123; // ArrayStoreException
```

## 6.5 Header overhead makes tiny arrays expensive

```java
new int[1]
```

stores one int but still pays array header + alignment.

## 6.6 Batch data

For many small arrays, overhead can dominate.

Prefer larger contiguous arrays or structured buffers if needed.

---

# 7. Object Alignment dan Padding

JVM aligns objects to certain byte boundaries, commonly 8 bytes on many HotSpot configurations.

If object fields/header total not multiple of alignment, padding is added.

## 7.1 Example mental model

```text
header 12 bytes + int 4 bytes = 16 bytes
```

No padding if alignment 8 and total 16.

```text
header 12 bytes + byte 1 byte = 13 bytes -> padded to 16
```

## 7.2 Padding is invisible in Java code

But affects footprint.

## 7.3 Field padding

Fields may be arranged/padded to satisfy alignment.

## 7.4 ObjectAlignmentInBytes

HotSpot has `ObjectAlignmentInBytes` flag. Exact availability/default should be checked in target VM.

## 7.5 Design consequence

Many tiny objects with a few bytes of data waste memory due header + padding.

## 7.6 Do not manually reorder fields blindly

HotSpot may reorder fields. Measure with JOL.

---

# 8. Reference Size dan Compressed Oops

Oop means ordinary object pointer.

In 64-bit JVM, uncompressed references could be 64-bit. Compressed oops allow references to be represented compactly, commonly as 32-bit encoded values, enabling lower memory footprint for heaps in certain ranges.

OpenJDK HotSpot documentation describes compressed oops as managed pointers represented as 32-bit values that are scaled and added to a base address, enabling applications to address up to around 32GB heap while retaining compactness.

## 8.1 Why it matters

Reference-heavy structures:

```java
Object[]
ArrayList<Object>
HashMap<K,V>
linked nodes
object graphs
```

consume many references.

Compressed oops can significantly reduce memory.

## 8.2 Heap size interaction

Compressed oops often depends on maximum heap size and VM configuration.

When heap is very large, compressed oops may be disabled or use different mode.

Always verify flags in your runtime.

## 8.3 Check flags

Example:

```bash
java -XX:+PrintFlagsFinal -version | grep UseCompressedOops
```

or:

```bash
java -XshowSettings:vm -version
```

depending JVM.

## 8.4 Design consequence

A bigger heap can sometimes increase pointer size and object footprint, hurting effective capacity.

## 8.5 Rule

For memory-heavy Java services, compressed oops status is part of performance investigation.

---

# 9. Compressed Class Pointers

Besides ordinary object references, HotSpot can compress class metadata pointers.

Flag commonly:

```text
UseCompressedClassPointers
```

## 9.1 Why it matters

Object header includes class pointer/klass metadata reference.

Compressed class pointers can reduce object header size in classic layouts.

## 9.2 Relationship with compressed oops

Often enabled together in 64-bit HotSpot configurations, but verify.

## 9.3 Exact layout

JOL can show actual layout for target runtime.

## 9.4 Design consequence

Again, many tiny objects pay header overhead. Compressed class pointers can reduce that overhead.

## 9.5 Production rule

Do not assume; measure.

---

# 10. Compact Object Headers: Modern HotSpot Direction

JDK development includes compact object headers work to reduce object header size.

This matters because object header overhead is a major part of small object footprint.

## 10.1 Why important

If ordinary object header shrinks, memory footprint of object-rich applications can improve.

## 10.2 Version/flag-dependent

Availability and default status can change by JDK version and JVM vendor/build.

Treat as runtime-specific.

## 10.3 Measurement required

Use JOL or runtime tools in the same JDK build and flags.

## 10.4 Data type implication

Compact headers reduce overhead but do not eliminate:

- reference indirection;
- object graph complexity;
- wrapper allocation;
- poor locality;
- collection node overhead.

## 10.5 Do not rely on it

Design still benefits from primitive arrays, compact data structures, and avoiding unnecessary object graphs.

---

# 11. Primitive Fields vs Reference Fields

## 11.1 Primitive field

```java
int count;
long id;
boolean enabled;
double score;
```

Stored inline inside object.

## 11.2 Reference field

```java
String name;
BigDecimal amount;
UserId id;
```

Stores reference inline; object data elsewhere.

## 11.3 Example

```java
record Counter(int value) {}
```

Object contains int field plus header/padding.

```java
record Counter(Integer value) {}
```

Object contains reference to Integer; Integer object separate unless cached.

## 11.4 Nullable requirement

Primitive cannot be null.

Wrapper can be null, but has overhead.

Use primitive when value required and large scale/performance matter.

## 11.5 Domain type wrapping primitive

```java
record Version(long value) {}
```

Semantically good, but each Version object has overhead.

For normal domain use fine. For millions/billions, consider primitive storage plus typed boundary.

## 11.6 Project Valhalla note

Future value objects/primitive classes aim to improve this space, but current production Java object wrappers have identity/object overhead.

---

# 12. Wrapper Types dan Boxing Overhead

Wrapper types:

```java
Integer
Long
Double
Boolean
Character
```

are objects.

## 12.1 List<Integer>

```java
List<Integer> numbers = new ArrayList<>();
```

Memory components:

- ArrayList object;
- internal Object[] array of references;
- Integer objects for elements outside cache/boxing elimination.

## 12.2 int[]

```java
int[] numbers = new int[n];
```

One array object with contiguous primitive ints.

## 12.3 Boxing

```java
Integer x = 1000;
```

May allocate object unless optimized/cached.

## 12.4 Cache

Integer cache for small values can reduce allocation, but do not rely on identity.

## 12.5 Optional<Integer> vs OptionalInt

`Optional<Integer>` has wrapper concerns.

`OptionalInt` avoids boxed Integer.

## 12.6 Design rule

For high-volume numeric data:

```text
primitive array / primitive stream / specialized primitive collection
```

For ordinary domain fields, wrappers/domain records are often fine.

---

# 13. String Memory Layout dan Compact Strings

Since JDK 9, compact strings use byte[] plus coder rather than always char[] internally. JEP 254 describes changing String internal representation from UTF-16 char array to byte array plus encoding flag, so strings containing only Latin-1 characters can use about half memory for character storage.

## 13.1 String object graph

Modern String conceptually:

```text
String object
byte[] value
coder/metadata fields
```

Exact fields/layout may change.

## 13.2 ASCII/Latin-1 benefit

Many identifiers/codes/emails/status strings can be compact.

## 13.3 Still object graph

`String` is object plus array.

Many duplicate strings can consume memory.

## 13.4 String deduplication

Some GCs can deduplicate string backing arrays.

G1 has string deduplication option in some JDKs.

Measure.

## 13.5 Domain typed String wrappers

```java
record CaseId(String value) {}
```

adds object wrapper around String.

Fine for type safety, but memory-heavy at huge scale.

## 13.6 Interning

`String.intern()` can reduce duplicates but can also create contention/memory issues.

Use carefully.

---

# 14. Arrays: Header + Length + Elements

Arrays are objects.

```java
int[] values = new int[10];
```

Memory:

```text
array header
length
10 * int
padding
```

## 14.1 Primitive array

Elements inline.

```java
long[] ids
double[] scores
byte[] payload
```

Very compact.

## 14.2 Reference array

Elements are references.

```java
String[] names
Object[] objects
Integer[] numbers
```

Referenced objects separate.

## 14.3 Null slots

Reference array slots default null.

## 14.4 Array length overhead

Many tiny arrays waste header overhead.

## 14.5 Array alignment

Array total padded to object alignment.

## 14.6 Bounds checks

Array access includes bounds checks, often optimized by JIT in loops.

---

# 15. Primitive Arrays vs Reference Arrays

## 15.1 int[]

```java
int[] xs = new int[1_000_000];
```

Compact contiguous primitive values.

## 15.2 Integer[]

```java
Integer[] xs = new Integer[1_000_000];
```

Array stores references. Each non-null Integer is separate object unless cached/shared.

## 15.3 Object locality

Primitive array traversal is cache-friendly.

Reference array traversal:

```text
load reference
follow pointer to object
load object data
```

Pointer chasing.

## 15.4 GC impact

Reference array points to many objects that GC must trace.

Primitive arrays have no object references inside.

## 15.5 Nullability

Reference arrays can represent missing element with null.

Primitive arrays need sentinel/separate bitmap/domain policy.

## 15.6 Decision

Use primitive arrays for high-volume numeric data.

Use reference arrays/collections for object-rich domain data where semantics matter.

---

# 16. Multidimensional Arrays: Array of Arrays

Java multidimensional arrays are arrays of arrays.

```java
int[][] matrix = new int[3][4];
```

Conceptually:

```text
int[][] outer array of 3 references
each row is separate int[] of 4 elements
```

## 16.1 Not contiguous 2D block

Rows can be separate objects scattered in heap.

## 16.2 Jagged arrays

```java
int[][] triangle = new int[3][];
triangle[0] = new int[1];
triangle[1] = new int[2];
triangle[2] = new int[3];
```

## 16.3 Header overhead

Each row array has header.

For many small rows, overhead large.

## 16.4 Flat array alternative

```java
int[] matrix = new int[rows * cols];

int index(int r, int c) {
    return r * cols + c;
}
```

More compact and cache-friendly.

## 16.5 Domain trade-off

Flat arrays are lower-level. Use when performance/memory matters.

---

# 17. Object Graph: Shallow Size vs Retained Size

## 17.1 Shallow size

Memory used by object itself.

Example:

```java
ArrayList object
```

does not include internal array/elements.

## 17.2 Retained size

Memory that would become unreachable if object removed.

For:

```java
List<User> users
```

retained size may include:

- ArrayList;
- Object[];
- User objects;
- fields and referenced objects;
- strings;
- collections inside users.

## 17.3 Why important

`Instrumentation.getObjectSize(list)` can underlead because it returns approximate shallow size of list object, not graph.

## 17.4 Heap dump retained size

Heap analysis tools can estimate retained size.

## 17.5 Shared references

Retained size depends on sharing.

If String shared by many users, retained attribution is complex.

## 17.6 Rule

When investigating memory leak, retained size matters more than shallow size.

---

# 18. Collections Memory Footprint

Collections add object/array/node overhead.

## 18.1 ArrayList

```text
ArrayList object
Object[] elementData
element objects
```

## 18.2 HashMap

```text
HashMap object
Node[] table
Node objects per entry
key objects
value objects
```

Tree bins add more.

## 18.3 LinkedList

```text
LinkedList object
Node object per element
element objects
```

Each node has references to prev/next/item.

## 18.4 TreeMap

```text
TreeMap object
Entry object per mapping
left/right/parent/color/key/value
```

## 18.5 EnumSet

Often bit-vector-like compact representation for enum values.

## 18.6 EnumMap

Array indexed by enum ordinal internally conceptually.

Very compact for enum keys.

## 18.7 Collection choice affects memory massively

Semantics first, but memory can decide implementation.

---

# 19. `ArrayList`, `LinkedList`, `HashMap`, `EnumMap`, `EnumSet`

## 19.1 ArrayList

Good default for ordered list.

Memory efficient relative to linked nodes.

Over-allocates capacity sometimes.

Use initial capacity if size known.

```java
new ArrayList<>(expectedSize)
```

## 19.2 LinkedList

Memory-heavy due node per element.

Poor cache locality.

Use rarely.

For queue/stack, prefer:

```java
ArrayDeque
```

## 19.3 HashMap

Good lookup, but per-entry overhead.

For huge maps:

- initial capacity matters;
- key/value object footprint matters;
- consider primitive/specialized maps if keys primitive;
- consider off-heap/cache/db if too large.

## 19.4 EnumMap

For enum keys:

```java
EnumMap<Status, Handler>
```

more memory-efficient and faster than HashMap in many cases.

## 19.5 EnumSet

For enum sets:

```java
EnumSet<Permission>
```

much better than `HashSet<Permission>`.

## 19.6 Decision

Do not use general-purpose hash structures when specialized enum structure fits.

---

# 20. Records, Classes, dan Value Object Footprint

## 20.1 Record is object

```java
record CaseId(String value) {}
```

has object header + reference field + padding.

It is not zero-cost wrapper in current Java.

## 20.2 Class with same fields

A simple final class with same fields has similar footprint.

Record advantage is semantics/boilerplate, not memory magic.

## 20.3 Many typed wrappers

Typed wrappers improve correctness.

At massive scale, overhead matters.

## 20.4 Hybrid design

Use typed wrappers at boundaries/domain logic, compact representation internally for large storage.

Example:

```java
LongArrayCaseIdIndex
```

internally stores `long[]`, externally exposes `CaseId`.

## 20.5 Record with primitive

```java
record Version(long value) {}
```

Still object overhead, but long field inline.

## 20.6 Future value objects

Project Valhalla may eventually make some wrappers cheaper, but current object records have object identity/layout overhead.

---

# 21. Field Layout, Padding, dan Field Order

JVM may arrange fields to reduce padding. Actual layout is implementation-specific.

## 21.1 Example fields

```java
class Example {
    boolean a;
    long b;
    int c;
}
```

Naively field order could create padding. JVM may reorder non-static fields under constraints.

## 21.2 Inheritance affects layout

Superclass fields laid out too.

## 21.3 Contended fields

JVM/internal annotations/options can affect layout for false sharing mitigation.

## 21.4 Do not optimize by guessing

Use JOL to inspect.

## 21.5 Better design

Avoid excessive tiny objects rather than micro-tuning field order.

## 21.6 Important exception

Low-level performance libraries may care deeply. Application domain code usually should not.

---

# 22. Cache Locality

Modern CPUs like contiguous memory access.

## 22.1 Primitive array

```java
for (int x : intArray) { ... }
```

cache-friendly.

## 22.2 Linked structure

```java
for (Node n = head; n != null; n = n.next) { ... }
```

pointer chasing, cache misses.

## 22.3 ArrayList

Internal array of references is contiguous, but element objects may not be.

## 22.4 Object graph

Deep object graphs reduce locality.

## 22.5 Data-oriented design

For hot paths, separate data into primitive arrays/columns.

Example:

```java
long[] ids;
int[] statuses;
double[] scores;
```

instead of many objects.

## 22.6 Domain trade-off

Use object-rich model for clarity. Use data-oriented layout for measured hot paths.

---

# 23. Allocation Rate dan GC Pressure

Memory footprint is not just live heap. Allocation rate matters.

## 23.1 Temporary wrappers

```java
stream.map(x -> new ValueObject(x))
```

may allocate many objects.

JIT may optimize some, but not all.

## 23.2 Boxing in streams

```java
Stream<Integer>
```

boxes values.

Use:

```java
IntStream
LongStream
DoubleStream
```

for numeric pipelines.

## 23.3 Short-lived objects

Young-gen GC handles many short-lived objects well, but high allocation rate still costs CPU.

## 23.4 Long-lived object graphs

Old-gen pressure and marking/tracing cost.

## 23.5 Object pooling

Usually avoid object pools for ordinary objects. They can hurt GC and complexity.

Use pooling only for proven expensive resources/buffers and measure.

## 23.6 Design rule

Reduce unnecessary object count in hot paths, not everywhere blindly.

---

# 24. Measuring Object Size dengan JOL

JOL is OpenJDK Java Object Layout tool. The OpenJDK JOL project describes it as a toolbox to analyze object layout schemes in JVMs, using Unsafe, JVMTI, and Serviceability Agent to decode actual object layout, footprint, and references.

## 24.1 Add dependency

Example Maven coordinate may vary by version:

```xml
<dependency>
  <groupId>org.openjdk.jol</groupId>
  <artifactId>jol-core</artifactId>
  <version>...</version>
</dependency>
```

Check latest version.

## 24.2 ClassLayout

```java
System.out.println(ClassLayout.parseClass(Point.class).toPrintable());
```

## 24.3 Object layout

```java
Point p = new Point(1, 2);
System.out.println(ClassLayout.parseInstance(p).toPrintable());
```

## 24.4 GraphLayout

```java
System.out.println(GraphLayout.parseInstance(object).toFootprint());
```

Useful for object graph footprint.

## 24.5 Use same JVM flags

Run JOL with same JDK/version/flags as target.

## 24.6 JOL is diagnostic, not business dependency

Do not ship core business logic depending on JOL.

Use for measurement/learning/perf investigation.

---

# 25. `Instrumentation.getObjectSize`

Java `Instrumentation.getObjectSize(Object)` returns an implementation-specific approximation of storage consumed by an object. Java SE 25 API notes the result may include some or all overhead, is useful for comparison within an implementation, not between implementations, and may change during a single JVM invocation.

## 25.1 Shallow approximation

Usually shallow object size, not retained graph.

## 25.2 Needs Java agent

Instrumentation API generally requires agent setup.

## 25.3 Good for comparison

Compare same runtime:

```text
PointA vs PointB
```

## 25.4 Not portable exact truth

Do not compare across JVM vendors/versions/flags.

## 25.5 Prefer JOL for layout learning

JOL gives richer output.

---

# 26. Heap Dump, JFR, Native Memory Tracking

## 26.1 Heap dump

Use heap dump to inspect retained size and leaks.

Tools:

- Eclipse MAT;
- VisualVM;
- IntelliJ profiler;
- YourKit/JProfiler;
- jcmd heap dump.

## 26.2 JFR

Java Flight Recorder can show allocation pressure, object allocation samples, GC behavior.

## 26.3 Native Memory Tracking

NMT helps inspect native memory categories:

```bash
jcmd <pid> VM.native_memory summary
```

if enabled.

## 26.4 jcmd

Useful commands:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump file.hprof
jcmd <pid> VM.flags
```

## 26.5 Allocation profiling

Allocation rate often more actionable than one object size.

## 26.6 Production caution

Heap dump can pause/impact process and contain sensitive data.

---

# 27. Designing Memory-Aware Domain Types

## 27.1 Normal domain service

Use clear domain types:

```java
CaseId
Money
DateRange
EmailAddress
```

Correctness first.

## 27.2 Large in-memory index

If storing millions of entries, design carefully.

Example:

```java
Map<CaseId, CaseSummary>
```

may be heavy if CaseId wraps String and CaseSummary has many nested objects.

Consider:

- compact key representation;
- primitive IDs;
- arrays/columns;
- off-heap;
- database/search index;
- cache library;
- compression;
- interning/deduplication if safe.

## 27.3 Boundary wrapper

Use domain type at API/service boundary but store compact internal structure.

```java
long caseIdAsLong
```

inside index, with conversion.

## 27.4 Avoid premature optimization

Do not sacrifice domain clarity without measured need.

## 27.5 Design for scale hotspots

Identify hot data structures:

- cache;
- in-memory lookup;
- batch processing;
- parsing/tokenization;
- metrics;
- large event buffers.

Optimize those.

---

# 28. Large Data dan Primitive Collections

Java standard collections use references/wrappers.

For large primitive data:

```java
int[]
long[]
double[]
byte[]
```

or specialized libraries.

## 28.1 Primitive collection libraries

Examples:

- fastutil;
- Eclipse Collections primitive;
- HPPC;
- Agrona.

## 28.2 Trade-offs

Pros:

- less boxing;
- lower memory;
- better locality.

Cons:

- dependency;
- API unfamiliar;
- less standard;
- conversion overhead;
- integration friction.

## 28.3 Domain boundary

Expose domain-friendly API, keep primitive internals hidden.

## 28.4 BitSet

For boolean sets/dense flags:

```java
BitSet
```

or enum-specific:

```java
EnumSet
```

## 28.5 Byte arrays

For binary data, `byte[]` compact.

But copy/ownership/security matters.

## 28.6 Measure

Specialized collections should be justified by profiling or scale requirements.

---

# 29. Off-Heap, ByteBuffer, dan MemorySegment

## 29.1 ByteBuffer

Can be heap or direct.

```java
ByteBuffer.allocateDirect(size)
```

Direct buffer memory outside Java heap, but object wrapper still on heap.

## 29.2 Off-heap pros

- reduce GC pressure for large buffers;
- interop with native I/O;
- predictable large memory blocks.

## 29.3 Off-heap cons

- lifecycle management;
- bounds/access complexity;
- harder debugging;
- native memory OOM;
- serialization/manual layout.

## 29.4 MemorySegment

Modern Java Foreign Function & Memory API provides `MemorySegment` for safe access to memory segments. In Java 22, FFM became final via JEP 454; for Java 25 it is standard API area.

## 29.5 Use cases

- high-performance I/O;
- large binary data;
- native interop;
- columnar structures;
- specialized low-latency systems.

## 29.6 Business apps

Most business apps should use normal heap objects unless profiling shows need.

---

# 30. Production Failure Modes

## 30.1 OOM from `List<Integer>`

Millions of boxed integers instead of `int[]`.

Fix:

- primitive array;
- primitive collection;
- IntStream;
- compact representation.

## 30.2 LinkedList memory blow-up

Large list stored as LinkedList.

Fix:

- ArrayList/ArrayDeque.

## 30.3 HashMap overhead huge

Large map with object-heavy keys/values.

Fix:

- initial capacity;
- primitive/specialized map;
- compact key;
- offload to DB/cache;
- EnumMap if enum key.

## 30.4 Record wrapper explosion

Millions of tiny domain records in hot cache.

Fix:

- keep type safety at boundary;
- compact internal representation;
- measure.

## 30.5 Tiny arrays everywhere

Many small arrays overhead dominates.

Fix:

- batch/flat arrays;
- shared buffers;
- collections depending use case.

## 30.6 Heap dump misread

Looking only at shallow size misses retained graph.

Fix:

- analyze retained size/object graph.

## 30.7 Compressed oops disabled unexpectedly

Heap size/flags cause reference size increase.

Fix:

- inspect VM flags;
- tune heap/flags;
- measure.

## 30.8 String duplication

Many repeated codes/statuses/emails.

Fix:

- enum/code types;
- dedup strategy;
- database normalization;
- cautious interning/dedup.

## 30.9 Cache stores mutable heavy graph

Cache retains far more than expected.

Fix:

- lightweight DTO/snapshot;
- eviction;
- retained size analysis.

## 30.10 Object pooling worsens memory

Pool retains objects and hurts GC.

Fix:

- remove pool unless proven;
- use resource pools only for expensive resources.

---

# 31. Best Practices

## 31.1 General

- Treat object layout as implementation-specific.
- Use domain-correct types first.
- Measure memory in target JVM/version/flags.
- Understand shallow vs retained size.
- Prefer primitive arrays for high-volume primitive data.
- Avoid boxed collections in hot/large numeric paths.
- Prefer ArrayList/ArrayDeque over LinkedList for most cases.
- Use EnumSet/EnumMap for enum.
- Avoid many tiny objects in hot paths.
- Beware records/wrappers at massive scale.
- Use JOL for layout learning.
- Use JFR/heap dump for production memory investigation.
- Check compressed oops/class pointers flags for memory-heavy services.
- Do not rely on exact object header size in business logic.
- Optimize data structures based on profiling.

## 31.2 Collections

- Set initial capacity for large ArrayList/HashMap when known.
- Avoid HashMap for enum keys.
- Avoid LinkedList unless measured/justified.
- Avoid `Map<String,Object>` large graphs if schema known.
- Use compact specialized structures where needed.

## 31.3 Strings

- Avoid duplicate large strings.
- Use enum/code for closed values.
- Be careful with interning.
- Understand compact strings help but do not remove object overhead.

## 31.4 Off-heap

- Use off-heap/direct buffers only with clear need.
- Monitor native memory.
- Define lifecycle ownership.

---

# 32. Decision Matrix

| Situation | Memory-aware choice |
|---|---|
| million primitive ints | `int[]` / primitive collection |
| million boxed integers | avoid `List<Integer>` if memory-sensitive |
| enum flags | `EnumSet` |
| enum key handlers | `EnumMap` |
| ordered business list | `ArrayList`/unmodifiable List |
| queue/stack | `ArrayDeque` |
| large linked sequence | avoid `LinkedList` |
| dense boolean flags | `BitSet` |
| huge lookup by long key | primitive map library / compact index |
| domain boundary ID | typed ID record |
| huge internal ID index | primitive representation internally |
| small DTO/domain object | record/class fine |
| binary payload | `byte[]` with ownership policy |
| large binary I/O | direct ByteBuffer/MemorySegment maybe |
| memory investigation | JFR + heap dump + JOL |
| object size comparison | JOL / Instrumentation in same runtime |
| repeated stable codes | enum/code normalization |
| cache values | lightweight immutable snapshot |

---

# 33. Latihan

## Latihan 1 — JOL Point

Create:

```java
record Point(int x, int y) {}
```

Use JOL to inspect layout.

## Latihan 2 — int[] vs List<Integer>

Allocate 1 million ints in `int[]` and `List<Integer>`. Compare heap usage with JFR/heap histogram/JOL graph.

## Latihan 3 — ArrayList vs LinkedList

Create 1 million elements in both. Compare memory and iteration time.

## Latihan 4 — HashMap vs EnumMap

Create enum key map with 10 enum constants. Compare with HashMap using JOL/benchmark.

## Latihan 5 — HashSet vs EnumSet

Compare permission set representation.

## Latihan 6 — Shallow vs retained size

Measure ArrayList shallow size and graph footprint with JOL.

## Latihan 7 — CompressedOops flags

Run:

```bash
java -XX:+PrintFlagsFinal -version | grep -E "UseCompressedOops|UseCompressedClassPointers|ObjectAlignmentInBytes"
```

Record values.

## Latihan 8 — Multidimensional array

Compare `int[1000][1000]` vs flat `int[1_000_000]` footprint.

## Latihan 9 — Record wrapper scale

Create many `record Version(long value)` objects vs `long[]`. Compare memory.

## Latihan 10 — String duplication

Create many repeated strings. Try dedup/interning carefully and observe memory. Explain risks.

## Latihan 11 — Heap dump retained size

Create object graph with cache map retaining values. Analyze retained size.

## Latihan 12 — Off-heap buffer

Allocate direct ByteBuffer and observe heap vs native memory.

---

# 34. Ringkasan

Java object memory is not just fields.

Object footprint includes:

```text
object header
class metadata pointer
array length for arrays
reference fields
primitive fields
padding/alignment
referenced object graph
```

Key lessons:

- Layout is JVM implementation-specific.
- Exact sizes change by JDK, flags, architecture, compressed oops, alignment, compact headers.
- Object header overhead dominates tiny objects.
- References can be compressed, but still cost memory and indirection.
- Primitive arrays are compact and cache-friendly.
- Reference arrays point to separate objects.
- Multidimensional arrays are arrays of arrays.
- Wrapper types add object overhead.
- Records are ordinary objects from footprint perspective.
- Collections add internal arrays/nodes/tables.
- `LinkedList` is often memory-heavy.
- `EnumSet`/`EnumMap` are compact for enum.
- Shallow size is not retained size.
- JOL is the best learning/diagnostic tool for object layout.
- `Instrumentation.getObjectSize` gives implementation-specific approximation.
- Use JFR/heap dump for production memory investigation.
- Optimize measured hotspots, not every object.

Senior Java engineer does not memorize “an object is always X bytes”.

They think:

```text
How many objects?
How many references?
How deep is the object graph?
Are values boxed?
Are arrays primitive or reference?
Is locality good?
What is retained?
What does JOL/JFR/heap dump say on the real JVM?
```

Memory-aware type design is not premature optimization when object count is huge. It is production engineering.

---

# 35. Referensi

1. OpenJDK Code Tools — Java Object Layout (JOL)  
   https://openjdk.org/projects/code-tools/jol/

2. OpenJDK JOL GitHub — Java Object Layout  
   https://github.com/openjdk/jol

3. OpenJDK HotSpot Wiki — CompressedOops  
   https://wiki.openjdk.org/spaces/HotSpot/pages/11829259/CompressedOops

4. Java SE 25 API — `Instrumentation.getObjectSize`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.instrument/java/lang/instrument/Instrumentation.html#getObjectSize(java.lang.Object)

5. JEP 254 — Compact Strings  
   https://openjdk.org/jeps/254

6. Java SE 25 API — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

7. Java SE 25 API — `HashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

8. Java SE 25 API — `EnumSet`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html

9. Java SE 25 API — `EnumMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumMap.html

10. JEP 454 — Foreign Function & Memory API  
    https://openjdk.org/jeps/454

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-021.md">⬅️ Java Data Types — Part 021</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-023.md">Java Data Types — Part 023 ➡️</a>
</div>
