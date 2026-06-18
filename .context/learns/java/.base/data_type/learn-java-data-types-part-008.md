# learn-java-data-types-part-008.md

# Java Data Types — Part 008  
# Wrapper Types, Boxing, Unboxing, Cache, dan Primitive Collections

> Seri: **Advanced Java Data Types**  
> Bagian: **008**  
> Fokus: memahami wrapper types (`Integer`, `Long`, `Boolean`, dll), autoboxing/unboxing, wrapper cache, equality trap, `null` unboxing, generics boundary, collections/streams overhead, primitive specialized APIs, memory/GC impact, dan kapan harus memilih primitive, wrapper, atau domain type.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Wrapper Types Ada](#2-kenapa-wrapper-types-ada)
3. [Daftar Wrapper Types](#3-daftar-wrapper-types)
4. [Wrapper sebagai Reference Type](#4-wrapper-sebagai-reference-type)
5. [Boxing Conversion](#5-boxing-conversion)
6. [Unboxing Conversion](#6-unboxing-conversion)
7. [Autoboxing dan Autounboxing](#7-autoboxing-dan-autounboxing)
8. [Wrapper Cache dan `valueOf`](#8-wrapper-cache-dan-valueof)
9. [`==` Trap pada Wrapper](#9--trap-pada-wrapper)
10. [Unboxing `null` dan NPE](#10-unboxing-null-dan-npe)
11. [Wrapper Equality: `equals`, `compareTo`, dan Numeric Semantics](#11-wrapper-equality-equals-compareto-dan-numeric-semantics)
12. [Wrapper dan Generics](#12-wrapper-dan-generics)
13. [Collections: `List<Integer>` vs `int[]`](#13-collections-listinteger-vs-int)
14. [Streams: `Stream<Integer>` vs `IntStream`](#14-streams-streaminteger-vs-intstream)
15. [Primitive Optional: `OptionalInt`, `OptionalLong`, `OptionalDouble`](#15-primitive-optional-optionalint-optionallong-optionaldouble)
16. [Wrapper dan Reflection/Framework Boundary](#16-wrapper-dan-reflectionframework-boundary)
17. [Wrapper dan Database Nullability](#17-wrapper-dan-database-nullability)
18. [Wrapper dan JSON/API Boundary](#18-wrapper-dan-jsonapi-boundary)
19. [Wrapper dan Configuration](#19-wrapper-dan-configuration)
20. [Memory Footprint dan GC Cost](#20-memory-footprint-dan-gc-cost)
21. [Escape Analysis dan Boxing Elimination](#21-escape-analysis-dan-boxing-elimination)
22. [Primitive Collections dan Specialized Libraries](#22-primitive-collections-dan-specialized-libraries)
23. [Wrapper sebagai Domain Type? Kenapa Belum Cukup](#23-wrapper-sebagai-domain-type-kenapa-belum-cukup)
24. [Production Failure Modes](#24-production-failure-modes)
25. [Best Practices](#25-best-practices)
26. [Decision Matrix](#26-decision-matrix)
27. [Latihan](#27-latihan)
28. [Ringkasan](#28-ringkasan)
29. [Referensi](#29-referensi)

---

# 1. Tujuan Bagian Ini

Java memiliki primitive types:

```java
int
long
boolean
double
char
```

Tetapi banyak API Java bekerja dengan object/reference types:

```java
List<T>
Map<K, V>
Optional<T>
Stream<T>
Object
Comparable<T>
```

Primitive tidak bisa dipakai langsung sebagai generic type argument:

```java
List<int> numbers; // invalid
```

Karena itu Java menyediakan wrapper types:

```java
Integer
Long
Boolean
Double
Character
```

Wrapper types terlihat sederhana, tetapi banyak bug production muncul dari:

```java
Integer a = 128;
Integer b = 128;
System.out.println(a == b); // false?
```

atau:

```java
Boolean enabled = null;
if (enabled) { // NullPointerException
}
```

atau performance issue:

```java
List<Integer> values = new ArrayList<>();
for (int i = 0; i < 10_000_000; i++) {
    values.add(i); // boxing/object/GC pressure
}
```

Bagian ini akan membuat kamu memahami:

- wrapper class satu per satu;
- boxing/unboxing menurut bahasa;
- `valueOf` dan caching;
- `==` vs `equals`;
- unboxing NPE;
- wrapper dalam generics/collections/streams;
- primitive specialized APIs;
- memory/performance trade-off;
- boundary dengan DB/API/config/framework;
- kapan wrapper tepat dan kapan domain type lebih tepat.

---

# 2. Kenapa Wrapper Types Ada

Primitive bukan object.

Itu berarti primitive tidak punya:

- identity object;
- inheritance;
- generic type compatibility;
- `null`;
- method instance seperti object biasa;
- ability disimpan dalam `Object`;
- ability digunakan sebagai type parameter.

Contoh:

```java
Object x = 42; // autoboxing to Integer
```

Secara source code terlihat `42` masuk ke `Object`, tetapi sebenarnya terjadi boxing ke `Integer`.

## 2.1 Collections membutuhkan reference type

```java
List<Integer> numbers = List.of(1, 2, 3);
```

Tidak bisa:

```java
List<int> numbers;
```

Karena Java generics bekerja dengan reference types.

## 2.2 Nullability

Wrapper bisa `null`:

```java
Integer count = null;
Boolean enabled = null;
```

Ini berguna untuk boundary seperti database nullable column, tetapi berbahaya jika unboxing terjadi tanpa check.

## 2.3 Utility methods

Wrapper menyediakan utility:

```java
Integer.parseInt("123")
Integer.toUnsignedLong(x)
Long.compare(a, b)
Double.isFinite(x)
Character.isLetter(cp)
Boolean.parseBoolean("true")
```

## 2.4 Object-oriented bridge

Wrapper adalah jembatan antara dunia primitive dan dunia object.

Tetapi bridge ini punya biaya dan trap.

---

# 3. Daftar Wrapper Types

| Primitive | Wrapper |
|---|---|
| `boolean` | `Boolean` |
| `byte` | `Byte` |
| `short` | `Short` |
| `int` | `Integer` |
| `long` | `Long` |
| `char` | `Character` |
| `float` | `Float` |
| `double` | `Double` |

Semua wrapper adalah final classes.

Numeric wrappers extend:

```java
Number
```

Contoh:

```java
Integer extends Number
Long extends Number
Double extends Number
```

`Boolean` dan `Character` tidak extend `Number`.

## 3.1 Common capabilities

Wrapper classes generally provide:

- `valueOf`;
- parsing;
- conversion;
- constants `MIN_VALUE`, `MAX_VALUE` for numeric/char;
- `compare`;
- `compareTo`;
- `toString`;
- static utility methods.

## 3.2 Wrapper is immutable

Wrapper objects are immutable.

```java
Integer x = 10;
x = x + 1;
```

This does not mutate Integer object. It unboxes, adds, boxes new value/reference.

## 3.3 Wrapper can be null

Unlike primitive:

```java
int x = null;      // invalid
Integer y = null;  // valid
```

This is both feature and danger.

---

# 4. Wrapper sebagai Reference Type

Wrapper variable stores reference to wrapper object or null.

```java
Integer x = Integer.valueOf(10);
```

Conceptually:

```text
x -> Integer object containing int 10
```

## 4.1 Wrapper has identity

```java
Integer a = new Integer(100); // constructor deprecated/removed? avoid
Integer b = new Integer(100);
a == b // false
```

Use `valueOf`, not constructors.

## 4.2 Wrapper identity should rarely matter

You almost always care about numeric value, not wrapper object identity.

Use:

```java
a.equals(b)
```

or unbox intentionally:

```java
a.intValue() == b.intValue()
```

with null-safety.

## 4.3 Wrapper and Object

```java
Object o = Integer.valueOf(42);
```

Runtime class:

```text
java.lang.Integer
```

## 4.4 Wrapper and immutability

Wrapper immutability makes sharing safe, but does not remove allocation/boxing costs.

---

# 5. Boxing Conversion

Boxing conversion converts primitive value to corresponding wrapper object.

Examples:

```java
int i = 10;
Integer boxed = i;
```

Equivalent conceptually:

```java
Integer boxed = Integer.valueOf(i);
```

## 5.1 Boxing mapping

| Primitive | Boxing result |
|---|---|
| `boolean` | `Boolean` |
| `byte` | `Byte` |
| `short` | `Short` |
| `char` | `Character` |
| `int` | `Integer` |
| `long` | `Long` |
| `float` | `Float` |
| `double` | `Double` |

## 5.2 Boxing can allocate or reuse cached object

```java
Integer x = 100;
```

May reuse cached `Integer`.

```java
Integer y = 1000;
```

May allocate or may not, depending value and cache rules/implementation.

Never write logic based on wrapper identity.

## 5.3 Boxing in method call

```java
void accept(Integer x) {}

accept(10); // int boxes to Integer
```

## 5.4 Boxing to Object

```java
Object x = 10; // boxes to Integer
```

## 5.5 Boxing in varargs

```java
void log(Object... values) {}

log(1, true, 3.14);
```

Boxes primitives into wrapper objects.

This can create allocation in hot logging path if not optimized.

---

# 6. Unboxing Conversion

Unboxing converts wrapper object to primitive value.

```java
Integer boxed = Integer.valueOf(10);
int x = boxed;
```

Conceptually:

```java
int x = boxed.intValue();
```

## 6.1 Unboxing mapping

| Wrapper | Primitive |
|---|---|
| `Boolean` | `boolean` |
| `Byte` | `byte` |
| `Short` | `short` |
| `Character` | `char` |
| `Integer` | `int` |
| `Long` | `long` |
| `Float` | `float` |
| `Double` | `double` |

## 6.2 Unboxing null throws NPE

```java
Integer x = null;
int y = x; // NullPointerException
```

Equivalent:

```java
x.intValue()
```

on null.

## 6.3 Unboxing in condition

```java
Boolean enabled = null;

if (enabled) { // NPE
}
```

Fix depending semantics:

```java
if (Boolean.TRUE.equals(enabled)) {
    ...
}
```

or validate config/domain earlier.

## 6.4 Unboxing in arithmetic

```java
Integer a = null;
int b = a + 1; // NPE
```

## 6.5 Unboxing in comparison

```java
Integer a = null;
if (a > 0) { } // NPE
```

---

# 7. Autoboxing dan Autounboxing

Autoboxing/unboxing are compiler conveniences.

They make code shorter, but can hide costs.

## 7.1 Example

```java
List<Integer> list = new ArrayList<>();
list.add(1);
int x = list.get(0);
```

Compiler inserts boxing/unboxing.

Conceptually:

```java
list.add(Integer.valueOf(1));
int x = list.get(0).intValue();
```

## 7.2 Hidden operations

Autoboxing can happen in:

- assignment;
- method invocation;
- arithmetic;
- comparison;
- conditional expressions;
- varargs;
- generics/collections;
- streams;
- reflection invocation.

## 7.3 Mixed arithmetic

```java
Integer a = 10;
Integer b = 20;
Integer c = a + b;
```

Conceptually:

```text
unbox a
unbox b
add int
box result
```

If `a` or `b` null → NPE.

## 7.4 Conditional expression

```java
Integer x = condition ? 1 : null;
```

Careful with type inference and boxing/unboxing.

More dangerous:

```java
int x = condition ? boxedInteger : 0;
```

If `boxedInteger` null when condition true, NPE.

## 7.5 Method overload surprise

```java
void f(long x) {}
void f(Integer x) {}

f(1);
```

Overload resolution has rules: widening primitive often preferred over boxing depending context.

Avoid confusing overloads mixing primitive/wrapper.

---

# 8. Wrapper Cache dan `valueOf`

Wrapper classes often cache common values.

## 8.1 Integer cache

`Integer.valueOf` caches values in at least range:

```text
-128 to 127
```

The spec/API documents caching behavior for this range and may allow larger cache implementation/config.

Example:

```java
Integer a = Integer.valueOf(127);
Integer b = Integer.valueOf(127);

System.out.println(a == b); // true
```

```java
Integer x = Integer.valueOf(128);
Integer y = Integer.valueOf(128);

System.out.println(x == y); // not guaranteed true; commonly false
```

## 8.2 Autoboxing uses valueOf-like behavior

```java
Integer a = 127;
Integer b = 127;

a == b // true due cache
```

But:

```java
Integer x = 128;
Integer y = 128;

x == y // often false
```

## 8.3 Long/Short/Byte/Character caches

Commonly:

- `Byte`: all byte values;
- `Short`: at least -128..127;
- `Integer`: at least -128..127;
- `Long`: at least -128..127;
- `Character`: often 0..127;
- `Boolean`: `Boolean.TRUE`, `Boolean.FALSE`.

But do not rely beyond documented guarantees.

## 8.4 Float/Double cache?

`Float` and `Double` generally do not cache in the same way.

## 8.5 Best rule

Never use `==` to compare wrapper values.

Use:

```java
Objects.equals(a, b)
```

or:

```java
Integer.compare(a, b)
```

after null handling.

---

# 9. `==` Trap pada Wrapper

## 9.1 Integer example

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b); // true, cached

Integer x = 1000;
Integer y = 1000;
System.out.println(x == y); // false, commonly
```

This is one of the most famous Java traps.

## 9.2 Why?

`==` on reference types compares identity.

For cached values, both references can point to same cached object.

For non-cached, different objects.

## 9.3 Use equals

```java
Objects.equals(x, y)
```

or:

```java
x.equals(y)
```

if `x` non-null.

## 9.4 Comparison with primitive

```java
Integer x = 1000;
int y = 1000;

System.out.println(x == y); // true
```

Because `x` unboxes to int, then primitive comparison.

If `x` null:

```java
Integer x = null;
int y = 0;
System.out.println(x == y); // NPE
```

## 9.5 Mixed wrappers

```java
Integer i = 1;
Long l = 1L;

// i == l // compile error: incomparable reference types
```

But if unboxed explicitly:

```java
i.longValue() == l.longValue()
```

## 9.6 Boolean wrapper

```java
Boolean a = Boolean.TRUE;
Boolean b = true;

a == b // true usually because Boolean uses TRUE/FALSE singletons
```

Still, do not rely on identity except constants.

Use:

```java
Boolean.TRUE.equals(value)
```

for nullable boolean check.

---

# 10. Unboxing `null` dan NPE

## 10.1 Common cases

```java
Integer count = null;
int c = count; // NPE
```

```java
Map<String, Integer> map = new HashMap<>();
int value = map.get("missing"); // NPE
```

Because `map.get` returns null, then unboxed.

Fix:

```java
int value = map.getOrDefault("missing", 0);
```

But ensure default semantics are correct.

## 10.2 Boolean config

```java
Boolean enabled = config.getEnabled();

if (enabled) { // NPE if null
}
```

Fix:

```java
if (Boolean.TRUE.equals(enabled)) {}
```

or:

```java
boolean enabled = requireConfigured(config.getEnabled());
```

## 10.3 Stream unboxing

```java
List<Integer> values = Arrays.asList(1, null, 3);
int sum = values.stream().mapToInt(Integer::intValue).sum(); // NPE
```

Need null policy:

```java
int sum = values.stream()
    .filter(Objects::nonNull)
    .mapToInt(Integer::intValue)
    .sum();
```

But filtering null may hide data quality issue. Decide explicitly.

## 10.4 Ternary trap

```java
Integer maybe = null;
int value = condition ? maybe : 0;
```

If condition true, NPE.

## 10.5 Best practice

Do not let nullable wrappers flow deep into domain logic.

At boundary:

```java
Integer raw = dto.count();
```

Map to:

```java
Count count
Optional<Count>
CountState
```

depending semantics.

---

# 11. Wrapper Equality: `equals`, `compareTo`, dan Numeric Semantics

## 11.1 Integer/Long equals

```java
Integer.valueOf(1).equals(Integer.valueOf(1)) // true
```

But different wrapper types not equal:

```java
Integer.valueOf(1).equals(Long.valueOf(1L)) // false
```

## 11.2 compareTo

Numeric wrappers implement `Comparable`.

```java
Integer.compare(1, 2)
Long.compare(1L, 2L)
Double.compare(1.0, 2.0)
```

Prefer static compare methods instead of subtraction.

Bad:

```java
return a - b; // overflow risk
```

Good:

```java
return Integer.compare(a, b);
```

## 11.3 Double/Float equals

Floating wrappers have special semantics:

```java
Double.valueOf(Double.NaN).equals(Double.valueOf(Double.NaN)) // true
Double.valueOf(0.0).equals(Double.valueOf(-0.0)) // false
```

Understand before using as key.

## 11.4 Character equals

`Character` equality is by `char` code unit value, not full Unicode character/grapheme.

```java
Character.valueOf('A').equals('A') // true via boxing
```

But supplementary code point cannot be a single Character.

## 11.5 Boolean equals

```java
Boolean.TRUE.equals(value)
```

is common null-safe true check.

---

# 12. Wrapper dan Generics

Java generics require reference types.

```java
List<Integer> xs = new ArrayList<>();
```

No:

```java
List<int>
```

## 12.1 Type erasure

At runtime, generics are erased. A `List<Integer>` is still a List of references.

Each element is an `Integer` reference.

## 12.2 Boxing cost in generic collections

```java
List<Integer> values = new ArrayList<>();
values.add(42); // boxes
int x = values.get(0); // unboxes
```

## 12.3 Generic algorithms

```java
class Box<T> {
    private T value;
}
```

`T` cannot be primitive. So primitive values must be boxed.

## 12.4 Generic numeric code limitation

Java lacks operator overloading and primitive generics, so generic numeric algorithms are awkward.

```java
<T extends Number> T add(T a, T b) // cannot use a + b
```

You often need specialized methods:

```java
int add(int a, int b)
long add(long a, long b)
double add(double a, double b)
```

or use library abstractions.

## 12.5 Future direction note

Project Valhalla aims to improve primitive/value types and generics in future Java, but current mainstream Java requires wrappers in generic type arguments.

Do not design current production assuming future primitive generics.

---

# 13. Collections: `List<Integer>` vs `int[]`

## 13.1 `int[]`

```java
int[] values = new int[1_000_000];
```

Stores primitive int values compactly.

Pros:

- memory efficient;
- cache-friendly;
- no boxing;
- fast;
- no per-element object.

Cons:

- fixed length;
- less expressive API;
- no generic collection interface;
- manual resizing if needed.

## 13.2 `List<Integer>`

```java
List<Integer> values = new ArrayList<>();
```

Stores references to `Integer` objects.

Pros:

- flexible size;
- collection API;
- generics;
- easy integration.

Cons:

- boxing;
- object overhead;
- reference indirection;
- GC pressure;
- null elements possible;
- cache locality worse.

## 13.3 Approximate memory intuition

For 1 million integers:

```text
int[]:
  ~4 MB + array header

ArrayList<Integer>:
  reference array ~4/8 MB depending compressed oops
  Integer objects ~16 MB or more
  total much larger
```

Exact size depends JVM/object layout/compressed oops/alignment.

Use JOL/JFR for measurement.

## 13.4 Null risk

```java
List<Integer> values = Arrays.asList(1, null, 3);
```

`int[]` cannot contain null.

## 13.5 When List<Integer> is fine

- small collections;
- API convenience;
- business collections not performance-critical;
- nullable values need representation;
- integration with generic API.

## 13.6 When int[] is better

- large numeric arrays;
- performance-sensitive loops;
- memory-sensitive processing;
- algorithmic code;
- low-level parsing;
- telemetry buffers.

---

# 14. Streams: `Stream<Integer>` vs `IntStream`

## 14.1 Stream<Integer>

```java
Stream<Integer> stream = values.stream();
```

Elements are boxed.

Operations may box/unbox.

## 14.2 IntStream

```java
IntStream stream = IntStream.of(1, 2, 3);
```

Specialized primitive stream.

Also:

```java
LongStream
DoubleStream
```

## 14.3 Prefer primitive streams for numeric operations

```java
int sum = values.stream()
    .mapToInt(Integer::intValue)
    .sum();
```

If source already primitive:

```java
int sum = IntStream.of(array).sum();
```

## 14.4 Avoid boxed reduce for numeric sum

Bad:

```java
Integer sum = values.stream()
    .reduce(0, (a, b) -> a + b);
```

This boxes/unboxes repeatedly.

Better:

```java
int sum = values.stream().mapToInt(Integer::intValue).sum();
```

## 14.5 Null handling

Primitive streams cannot contain null.

This is good if null invalid.

If source `List<Integer>` may contain null, decide policy before `mapToInt`.

## 14.6 Summary statistics

Primitive streams provide:

```java
summaryStatistics()
average()
sum()
min()
max()
```

Example:

```java
IntSummaryStatistics stats = values.stream()
    .mapToInt(Integer::intValue)
    .summaryStatistics();
```

---

# 15. Primitive Optional: `OptionalInt`, `OptionalLong`, `OptionalDouble`

Generic `Optional<T>` cannot hold primitive directly.

```java
Optional<Integer>
```

boxes int.

Primitive specializations:

```java
OptionalInt
OptionalLong
OptionalDouble
```

## 15.1 OptionalInt

```java
OptionalInt maybeCount = OptionalInt.of(10);
OptionalInt empty = OptionalInt.empty();

if (maybeCount.isPresent()) {
    int value = maybeCount.getAsInt();
}
```

## 15.2 Use case

Good for return type:

```java
OptionalInt findRetryCount(...);
OptionalLong findLatestVersion(...);
OptionalDouble averageScore(...);
```

## 15.3 Not for fields by default

Similar to `Optional<T>`, primitive Optional is mainly return type.

Avoid as entity/DTO field unless convention/framework supports it.

## 15.4 No null

`OptionalInt` variable itself should not be null.

## 15.5 API design

If absence has reason, `OptionalInt` is not enough.

Use result type:

```java
sealed interface ScoreLookup permits ScoreFound, ScoreUnavailable {}
```

---

# 16. Wrapper dan Reflection/Framework Boundary

Frameworks often use wrappers because they deal with Object values.

Examples:

- reflection `Method.invoke` returns Object;
- annotation values;
- JSON mappers;
- ORM result mapping;
- configuration binding;
- expression languages;
- template engines.

## 16.1 Reflection boxing

Primitive return values from reflection are boxed.

```java
Object result = method.invoke(target);
```

If method returns `int`, result is `Integer`.

## 16.2 Field access

Reflection field get on primitive field returns boxed value.

```java
Object value = field.get(target);
```

## 16.3 Framework nullability

Frameworks may map missing/null values to wrapper null.

Example DB nullable column:

```java
Integer score;
```

If you use primitive:

```java
int score;
```

null may map to 0 or fail depending framework/config.

## 16.4 Mapper pitfalls

DTO:

```java
record Request(Integer count) {}
```

Domain:

```java
record Count(int value) {}
```

Mapper must validate null and range.

Do not pass wrapper null deep.

---

# 17. Wrapper dan Database Nullability

## 17.1 Primitive cannot represent DB NULL

DB:

```sql
score INTEGER NULL
```

Java:

```java
int score;
```

cannot represent null. Possible issues:

- framework sets 0;
- mapping error;
- ambiguity between 0 and missing.

Use wrapper at persistence boundary:

```java
Integer score;
```

Then map to domain:

```java
Optional<Score>
ScoreState
```

## 17.2 Non-null DB column

DB:

```sql
retry_count INTEGER NOT NULL
```

Java primitive may be fine:

```java
int retryCount;
```

But if domain needs validation/range, use domain type.

## 17.3 Boolean nullable column

```sql
enabled BOOLEAN NULL
```

Java:

```java
Boolean enabled;
```

Map null to explicit tri-state:

```java
enum EnabledState { ENABLED, DISABLED, UNKNOWN }
```

## 17.4 Numeric nullable vs default

Do not confuse:

```text
NULL
0
```

They often have different meaning.

## 17.5 Migration

When making column non-null:

1. backfill nulls;
2. add default if appropriate;
3. update app validation;
4. apply NOT NULL constraint.

---

# 18. Wrapper dan JSON/API Boundary

JSON field can be:

```json
{ "count": 0 }
{ "count": null }
{}
```

These are different.

Java DTO:

```java
record Request(Integer count) {}
```

may receive null for explicit null or missing depending mapper.

## 18.1 Primitive DTO field

```java
record Request(int count) {}
```

If JSON missing, mapper may set 0 or fail depending configuration.

This can hide missing required field.

## 18.2 Wrapper DTO field

```java
record Request(Integer count) {}
```

Can detect missing/null only if mapper provides metadata or validation distinguishes them.

## 18.3 Validation

Use Bean Validation or manual validation:

```java
if (request.count() == null) {
    throw new BadRequest("count is required");
}
```

Then map:

```java
Count count = new Count(request.count());
```

## 18.4 PATCH semantics

For PATCH, wrapper null is ambiguous:

```json
{ "count": null }
```

vs missing field.

Use explicit patch model if needed:

```java
sealed interface FieldUpdate<T> permits NoChange, SetValue, ClearValue {}
```

## 18.5 API contract

Document:

- required/optional;
- nullable/non-nullable;
- default value;
- min/max;
- numeric range;
- whether missing differs from null.

---

# 19. Wrapper dan Configuration

Config binding often uses wrapper to detect missing value.

## 19.1 Dangerous primitive default

```java
record SecurityConfig(boolean enabled) {}
```

If config missing, default may become false depending binder, potentially unsafe.

## 19.2 Wrapper for required config

```java
record SecurityConfig(Boolean enabled) {
    SecurityConfig {
        if (enabled == null) {
            throw new IllegalArgumentException("security.enabled is required");
        }
    }

    boolean enabledValue() {
        return enabled;
    }
}
```

## 19.3 Numeric config

```java
record PoolConfig(Integer maxSize) {}
```

Validate:

```java
if (maxSize == null) fail;
if (maxSize < 1 || maxSize > 100) fail;
```

Then map to primitive/domain:

```java
new PoolSize(maxSize)
```

## 19.4 Defaults should be explicit

If default exists, make it visible:

```java
int maxSize = Objects.requireNonNullElse(config.maxSize(), 10);
```

But don't default safety-critical values silently.

## 19.5 Config value object

```java
record ThreadPoolSize(int value) {
    ThreadPoolSize {
        if (value < 1 || value > 256) throw new IllegalArgumentException();
    }
}
```

---

# 20. Memory Footprint dan GC Cost

## 20.1 Wrapper object overhead

An `Integer` object contains an int field plus object header/alignment.

So it costs much more than 4 bytes.

Exact size depends JVM.

## 20.2 Reference array overhead

`ArrayList<Integer>` internally has Object[] array storing references.

Each reference points to Integer object.

## 20.3 GC pressure

Boxing many values can create many short-lived objects:

```java
for (int i = 0; i < n; i++) {
    list.add(i);
}
```

Each non-cached value may box to object.

## 20.4 Cache reduces some allocation

Values like `Integer.valueOf(0)` may reuse cached object.

But do not rely on cache for performance design.

Also cache only helps limited values.

## 20.5 JFR allocation profiling

Use JFR to find boxing allocation:

- `java.lang.Integer`;
- `java.lang.Long`;
- `java.lang.Double`;
- lambda/stream related allocations.

## 20.6 Memory-sensitive design

For large numeric datasets:

- primitive arrays;
- off-heap/ByteBuffer;
- specialized primitive collections;
- columnar representation;
- database aggregation;
- streaming processing.

---

# 21. Escape Analysis dan Boxing Elimination

Modern JIT can eliminate some boxing allocations if object does not escape.

Example:

```java
Integer x = a + b;
return x.intValue();
```

JIT may optimize away wrapper.

## 21.1 Do not depend blindly

Optimization depends on:

- JIT warmup;
- code shape;
- escape analysis success;
- method inlining;
- polymorphism;
- runtime profile;
- JVM version/options.

## 21.2 Boxing in collections escapes

If you put boxed value into collection, it usually escapes.

```java
list.add(i);
```

The Integer object/reference must exist logically.

## 21.3 Boxing in megamorphic/framework path

Reflection/generic Object APIs often prevent elimination.

## 21.4 Measure

Use:

- JMH for microbenchmark;
- JFR for allocation profile;
- GC logs for allocation pressure;
- async profiler if needed.

## 21.5 Code clarity vs micro-optimization

Do not avoid wrappers in normal small business code purely out of fear.

Optimize where data volume/hot path proves it matters.

---

# 22. Primitive Collections dan Specialized Libraries

Java standard library does not provide `IntArrayList`, `LongHashSet`, etc. It provides primitive arrays and primitive streams.

For high-performance primitive collections, common external libraries include:

- fastutil;
- HPPC;
- Eclipse Collections primitive collections;
- Agrona;
- Trove legacy.

## 22.1 Why specialized primitive collections?

They avoid boxing.

Example:

```java
IntSet
Long2ObjectMap
IntArrayList
```

Benefits:

- lower memory;
- less GC;
- better cache locality;
- faster numeric algorithms.

Costs:

- extra dependency;
- API less standard;
- team familiarity;
- serialization integration;
- maintenance/license review.

## 22.2 When worth it?

Use when:

- millions of numeric elements;
- hot path performance;
- memory pressure;
- GC bottleneck;
- profiling shows wrapper allocation;
- low-latency requirements.

Not needed for small business lists.

## 22.3 Primitive arrays first

Before adding dependency, consider:

```java
int[]
long[]
double[]
```

If algorithm simple.

## 22.4 Domain model boundary

Do not leak specialized collection library across domain/API boundary unless adopted as standard.

Keep it internal to performance module.

---

# 23. Wrapper sebagai Domain Type? Kenapa Belum Cukup

Wrapper gives object form, not domain meaning.

```java
Integer age;
Long caseId;
Double score;
Boolean approved;
```

Still ambiguous.

## 23.1 Long ID problem

```java
void assign(Long caseId, Long officerId)
```

Bug:

```java
assign(officerId, caseId); // compiles
```

Better:

```java
record CaseId(long value) {}
record OfficerId(long value) {}
```

## 23.2 Integer status problem

```java
Integer status = 3;
```

What is 3?

Better:

```java
enum CaseStatus
```

## 23.3 Boolean decision problem

```java
Boolean eligible
```

Does false have reason? Does null mean unknown?

Better:

```java
EligibilityDecision
```

## 23.4 Double score problem

```java
Double riskScore
```

Can be null, NaN, Infinity, out of range.

Better:

```java
record RiskScore(double value) {
    RiskScore {
        if (!Double.isFinite(value) || value < 0 || value > 1) {
            throw new IllegalArgumentException();
        }
    }
}
```

## 23.5 Wrapper is representation, not ubiquitous language

Use wrapper at technical boundaries. Use domain type in core.

---

# 24. Production Failure Modes

## 24.1 `Integer == Integer`

Symptom:

```text
Logic works for small IDs but fails for larger IDs.
```

Cause:

```java
if (id1 == id2)
```

Cache makes small values pass accidentally.

Fix:

```java
Objects.equals(id1, id2)
```

or typed primitive ID comparison.

## 24.2 Unboxing null Boolean

Symptom:

```text
NPE when config missing.
```

Cause:

```java
if (config.enabled()) {}
```

where `enabled()` returns `Boolean`.

Fix:

- validate config at startup;
- use `Boolean.TRUE.equals`;
- explicit default.

## 24.3 Map get unboxing NPE

```java
Map<String, Integer> counts = new HashMap<>();
int count = counts.get("missing");
```

Fix:

```java
counts.getOrDefault("missing", 0)
```

or handle absence explicitly.

## 24.4 Boxing allocation spike

Symptom:

```text
JFR shows millions of Integer allocations.
```

Cause:

```java
Stream<Integer>
List<Integer>
boxed reduce
```

Fix:

```java
IntStream
int[]
primitive collection
```

## 24.5 DTO primitive hides missing JSON field

```java
record Request(int count) {}
```

Missing count becomes 0 or binding issue, but validation misses.

Fix:

```java
record Request(Integer count) {}
```

then validate required.

## 24.6 Nullable DB column mapped to primitive

DB NULL becomes 0/false or mapping failure.

Fix:

- wrapper at persistence boundary;
- explicit domain state.

## 24.7 Wrapper as cache key with wrong equality expectation

`Double.NaN`, `-0.0`, `BigDecimal`-like semantics can surprise.

Fix:

- domain key normalization;
- avoid floating key if possible.

## 24.8 Accidental overload

```java
void f(int x) {}
void f(Integer x) {}
```

Call with null picks wrapper; call with literal picks primitive. Confusing.

Fix:

- avoid overload primitive/wrapper pairs in public API.

---

# 25. Best Practices

## 25.1 Wrapper comparison

- Never compare wrapper values with `==` unless identity/singleton intentional.
- Use `Objects.equals`.
- For ordering, use `Integer.compare`, `Long.compare`, etc.
- Be careful with `Double`/`Float` NaN and `-0.0`.

## 25.2 Null handling

- Treat wrapper null as boundary concern.
- Do not let nullable wrappers flow deep.
- Validate at API/DB/config boundary.
- Use primitive after required validation.
- Use domain state/result for meaningful absence.

## 25.3 Performance

- Use primitive arrays/streams for large numeric data.
- Avoid boxed streams in hot numeric paths.
- Watch `List<Integer>` memory for large collections.
- Use JFR/JMH before optimizing ordinary business code.
- Consider specialized primitive collections only when justified.

## 25.4 API design

- Avoid overloads that differ only primitive vs wrapper.
- Avoid Boolean parameters.
- Use wrapper DTO field when missing/null must be detected.
- Map wrapper DTO to domain type.
- Avoid exposing raw wrapper IDs; use typed IDs.

## 25.5 Domain modeling

- Wrapper is not domain type.
- Use `record CaseId(long value)`, not raw `Long`.
- Use `RiskScore`, not raw `Double`.
- Use enum/sealed decision, not `Boolean approved`.
- Use `Money`, not `BigDecimal amount` alone.

---

# 26. Decision Matrix

| Situation | Recommended type |
|---|---|
| local counter | `int` |
| non-null field count | primitive or domain type |
| nullable DB integer boundary | `Integer` at persistence boundary |
| required JSON number | wrapper DTO + validation or primitive if binder strict |
| optional method return int | `OptionalInt` |
| large numeric list hot path | `int[]`/`long[]`/primitive collection |
| generic collection small | `List<Integer>` ok |
| numeric stream aggregation | `IntStream`/`LongStream`/`DoubleStream` |
| ID in domain | `record CaseId(long value)` |
| ID in public JSON | string DTO if large |
| Boolean config required | `Boolean` boundary + startup validation |
| domain decision | sealed result/policy decision |
| cache key numeric domain | immutable domain key |
| high-volume primitive map | specialized primitive collection |
| score 0..1 | `RiskScore(double)` |
| nullable score with reason | result/sealed state, not just `Double` |

---

# 27. Latihan

## Latihan 1 — Integer cache

Run:

```java
Integer a = 127;
Integer b = 127;
Integer x = 128;
Integer y = 128;

System.out.println(a == b);
System.out.println(x == y);
System.out.println(Objects.equals(x, y));
```

Explain.

## Latihan 2 — Unboxing null

Run:

```java
Integer count = null;
int c = count;
```

Explain stacktrace and fix.

## Latihan 3 — Map get NPE

```java
Map<String, Integer> counts = new HashMap<>();
int count = counts.get("missing");
```

Fix in two ways:

1. default 0;
2. explicit absence error.

## Latihan 4 — List<Integer> vs int[]

Create 10 million integers in `List<Integer>` and `int[]`. Measure memory/allocation with JFR or simple heap observation.

## Latihan 5 — Stream<Integer> vs IntStream

Compare:

```java
values.stream().reduce(0, (a, b) -> a + b)
values.stream().mapToInt(Integer::intValue).sum()
```

Use JMH if possible.

## Latihan 6 — OptionalInt

Implement:

```java
OptionalInt findRetryCount(CaseId id)
```

Then compare with:

```java
Optional<Integer>
Integer nullable
int default
```

Explain semantics.

## Latihan 7 — DTO mapping

Design request:

```json
{ "maxRetries": null }
{}
{ "maxRetries": 3 }
```

Model difference between missing, null, and set value.

## Latihan 8 — Boolean config

Create config with `Boolean enabled`, validate required at startup, then expose primitive getter.

## Latihan 9 — Domain ID

Refactor:

```java
void assign(Long caseId, Long officerId)
```

to:

```java
void assign(CaseId caseId, OfficerId officerId)
```

## Latihan 10 — Boxing in varargs

Create logging-like method:

```java
void log(Object... args)
```

Call with primitives and inspect allocation/JFR in hot loop.

---

# 28. Ringkasan

Wrapper types bridge primitive values into object/reference world.

They are necessary for:

- generics;
- collections;
- `Object`;
- nullability;
- framework/reflection;
- utility methods.

But wrappers introduce traps:

```text
boxing allocation
unboxing NPE
== identity comparison
cache surprise
nullable ambiguity
generic collection overhead
stream boxing cost
```

Rules utama:

- Use primitive for required local/non-null numeric/boolean values.
- Use wrapper at boundaries where null/missing is meaningful.
- Validate wrapper null early.
- Use `OptionalInt/Long/Double` for optional primitive return values.
- Use primitive streams/arrays for high-volume numeric processing.
- Never compare wrapper values with `==`.
- Use typed domain records instead of raw wrappers for IDs/status/score.
- Remember wrapper is representation, not domain meaning.

Top-tier Java engineer melihat `Integer` bukan hanya “object version of int”, tetapi sebagai boundary object dengan semantics, nullability, identity, cache behavior, memory cost, and API implications.

---

# 29. Referensi

1. Java Language Specification SE 25 — Chapter 5: Conversions and Contexts  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html

2. Java Language Specification SE 25 — Boxing Conversion  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html#jls-5.1.7

3. Java Language Specification SE 25 — Unboxing Conversion  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html#jls-5.1.8

4. Java SE 25 API — `Integer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Integer.html

5. Java SE 25 API — `Long`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Long.html

6. Java SE 25 API — `Boolean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Boolean.html

7. Java SE 25 API — `Double`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Double.html

8. Java SE 25 API — `Character`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html

9. Java SE 25 API — `OptionalInt`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalInt.html

10. Java SE 25 API — `OptionalLong`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalLong.html

11. Java SE 25 API — `OptionalDouble`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/OptionalDouble.html

12. Java SE 25 API — `IntStream`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/IntStream.html

13. Java SE 25 API — `LongStream`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/LongStream.html

14. Java SE 25 API — `DoubleStream`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/DoubleStream.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-007.md">⬅️ Java Data Types — Part 007</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-009.md">Java Data Types — Part 009 ➡️</a>
</div>
