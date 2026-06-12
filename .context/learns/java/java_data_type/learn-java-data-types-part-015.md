# learn-java-data-types-part-015.md

# Java Data Types — Part 015  
# Generics: Parametric Types, Wildcards, Variance, Erasure, dan Type-Safe API Design

> Seri: **Advanced Java Data Types**  
> Bagian: **015**  
> Fokus: memahami Java generics secara mendalam: generic class, generic method, type parameter, bounded type, wildcard, invariance, covariance/contravariance via `? extends` dan `? super`, PECS, capture conversion, type erasure, bridge method, raw type, heap pollution, generic arrays, type token, recursive bounds, fluent API, collections design, dan production API design.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Generics Ada](#2-kenapa-generics-ada)
3. [Mental Model: Type sebagai Parameter](#3-mental-model-type-sebagai-parameter)
4. [Generic Class](#4-generic-class)
5. [Generic Method](#5-generic-method)
6. [Type Parameter Naming](#6-type-parameter-naming)
7. [Parameterized Type vs Raw Type](#7-parameterized-type-vs-raw-type)
8. [Generic Invariance](#8-generic-invariance)
9. [Array Covariance vs Generic Invariance](#9-array-covariance-vs-generic-invariance)
10. [Upper Bounded Type Parameter](#10-upper-bounded-type-parameter)
11. [Multiple Bounds](#11-multiple-bounds)
12. [Recursive Bounds dan F-Bounded Polymorphism](#12-recursive-bounds-dan-f-bounded-polymorphism)
13. [Wildcards: `?`](#13-wildcards-)
14. [Upper Bounded Wildcard: `? extends T`](#14-upper-bounded-wildcard--extends-t)
15. [Lower Bounded Wildcard: `? super T`](#15-lower-bounded-wildcard--super-t)
16. [PECS: Producer Extends, Consumer Super](#16-pecs-producer-extends-consumer-super)
17. [Unbounded Wildcard: `?`](#17-unbounded-wildcard-)
18. [Wildcard Capture](#18-wildcard-capture)
19. [Generic API Design: Input, Output, Transform](#19-generic-api-design-input-output-transform)
20. [Type Inference](#20-type-inference)
21. [Diamond Operator](#21-diamond-operator)
22. [Target Typing](#22-target-typing)
23. [Type Erasure](#23-type-erasure)
24. [Bridge Methods](#24-bridge-methods)
25. [Reifiable vs Non-Reifiable Types](#25-reifiable-vs-non-reifiable-types)
26. [Heap Pollution](#26-heap-pollution)
27. [Raw Types](#27-raw-types)
28. [Generic Arrays Problem](#28-generic-arrays-problem)
29. [Varargs + Generics](#29-varargs--generics)
30. [Type Token dan Runtime Generic Information](#30-type-token-dan-runtime-generic-information)
31. [Generic Exceptions Limitation](#31-generic-exceptions-limitation)
32. [Generics dan Primitive Types](#32-generics-dan-primitive-types)
33. [Generics di Collections Framework](#33-generics-di-collections-framework)
34. [Generics di Domain Model](#34-generics-di-domain-model)
35. [Generics di Repository, Mapper, Validator, Result](#35-generics-di-repository-mapper-validator-result)
36. [Fluent API dan Self Type Problem](#36-fluent-api-dan-self-type-problem)
37. [When Not to Use Generics](#37-when-not-to-use-generics)
38. [Production Failure Modes](#38-production-failure-modes)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Generics adalah salah satu fitur Java yang paling penting, tetapi juga paling sering disalahpahami.

Contoh sederhana:

```java
List<String> names = new ArrayList<>();
names.add("Fajar");

String name = names.get(0);
```

Tanpa generics, kita akan menulis:

```java
List names = new ArrayList();
names.add("Fajar");

String name = (String) names.get(0);
```

Generics memberi:

- compile-time type safety;
- mengurangi cast manual;
- API lebih ekspresif;
- reusable algorithms;
- typed collections;
- typed domain abstractions.

Namun generics juga membawa konsep sulit:

```java
List<Integer> is not List<Number>
List<? extends Number>
List<? super Integer>
<T extends Comparable<? super T>>
Class<T>
TypeReference<List<User>>
```

Dan banyak pitfall production:

- raw type menyebabkan `ClassCastException`;
- `List<?>` tidak bisa ditambah elemen sembarang;
- `List<? extends T>` producer-only;
- `List<? super T>` consumer-friendly;
- type erasure menghilangkan generic type di runtime;
- `new T[]` tidak bisa;
- generic varargs bisa heap pollution;
- wildcard terlalu kompleks membuat API sulit dipakai;
- over-generic abstraction membuat domain tidak jelas.

Tujuan bagian ini:

- memahami generics sebagai type-level parameterization;
- memahami invariance dan wildcard variance;
- memahami PECS;
- memahami erasure dan bridge method;
- memahami raw type dan heap pollution;
- memahami generic arrays limitation;
- memahami runtime type token;
- memahami design API generic yang aman dan readable;
- memahami kapan generics membantu dan kapan membuat desain lebih buruk.

---

# 2. Kenapa Generics Ada

Generics ditambahkan agar class/interface/method bisa bekerja dengan banyak type tanpa kehilangan compile-time type safety.

## 2.1 Sebelum generics

```java
List list = new ArrayList();
list.add("hello");
list.add(123);

String s = (String) list.get(1); // ClassCastException
```

Bug baru muncul runtime.

## 2.2 Dengan generics

```java
List<String> list = new ArrayList<>();
list.add("hello");
// list.add(123); // compile error

String s = list.get(0); // no cast
```

Compiler menjaga element type.

## 2.3 Generics sebagai contract

```java
Map<CaseId, CaseRecord>
```

lebih kuat daripada:

```java
Map
Map<Object, Object>
Map<String, Object>
```

Compiler tahu:

- key harus `CaseId`;
- value adalah `CaseRecord`.

## 2.4 Reusable algorithms

```java
static <T> T first(List<T> values) {
    return values.get(0);
}
```

Works for:

```java
List<String>
List<CaseId>
List<Money>
```

## 2.5 Domain clarity

Generics memungkinkan abstraction:

```java
interface Repository<ID, ENTITY> {
    Optional<ENTITY> findById(ID id);
}
```

Tetapi jangan terlalu generic sampai domain hilang.

---

# 3. Mental Model: Type sebagai Parameter

Generic type seperti function di level type.

```java
List<T>
```

`T` adalah parameter type.

Saat digunakan:

```java
List<String>
List<Integer>
List<CaseId>
```

`T` diganti secara compile-time dengan type argument.

## 3.1 Generic class

```java
class Box<T> {
    private final T value;

    Box(T value) {
        this.value = value;
    }

    T value() {
        return value;
    }
}
```

Usage:

```java
Box<String> name = new Box<>("Fajar");
Box<Integer> count = new Box<>(10);
```

## 3.2 Generic method

```java
static <T> T identity(T value) {
    return value;
}
```

## 3.3 Type parameter vs type argument

Declaration:

```java
class Box<T> {}
```

`T` is type parameter.

Use:

```java
Box<String>
```

`String` is type argument.

## 3.4 Compile-time abstraction

Generics mostly exist at compile-time due type erasure.

Runtime does not create separate class for:

```java
List<String>
List<Integer>
```

Both are basically `List` at runtime.

---

# 4. Generic Class

## 4.1 Basic class

```java
public final class Box<T> {
    private final T value;

    public Box(T value) {
        this.value = value;
    }

    public T value() {
        return value;
    }
}
```

Usage:

```java
Box<String> b = new Box<>("hello");
String value = b.value();
```

## 4.2 Multiple type parameters

```java
public record Pair<L, R>(L left, R right) {}
```

Usage:

```java
Pair<CaseId, OfficerId> assignment;
```

## 4.3 Generic interface

```java
interface Mapper<S, T> {
    T map(S source);
}
```

## 4.4 Generic record

```java
public record Result<T>(T value) {}
```

But result usually needs success/failure modeling; sealed type may be better.

## 4.5 Static members

Type parameter `T` belongs to instance context.

Cannot use class type parameter in static field/method directly:

```java
class Box<T> {
    // static T defaultValue; // invalid

    static <T> Box<T> of(T value) {
        return new Box<>(value);
    }
}
```

Static generic method declares its own `<T>`.

---

# 5. Generic Method

Generic method declares type parameter before return type.

```java
public static <T> T first(List<T> values) {
    if (values.isEmpty()) {
        throw new NoSuchElementException();
    }
    return values.get(0);
}
```

## 5.1 Type inference

```java
String s = first(List.of("a", "b"));
Integer i = first(List.of(1, 2));
```

Compiler infers `T`.

## 5.2 Explicit type witness

Rarely needed:

```java
String s = MyUtils.<String>first(List.of("a"));
```

## 5.3 Generic method in non-generic class

```java
final class Lists {
    static <T> List<T> immutableCopy(Collection<? extends T> source) {
        return List.copyOf(source);
    }
}
```

## 5.4 Method type parameter vs class type parameter

```java
class Repository<T> {
    <R> R map(T entity, Function<T, R> mapper) {
        return mapper.apply(entity);
    }
}
```

`T` belongs to class. `R` belongs to method.

## 5.5 Don't overuse method generics

Bad:

```java
<T> void log(T value) {
    System.out.println(value);
}
```

No need. `Object` is enough:

```java
void log(Object value)
```

Use generics when relationship between input/output types matters.

---

# 6. Type Parameter Naming

Common conventions:

| Name | Meaning |
|---|---|
| `T` | Type |
| `E` | Element |
| `K` | Key |
| `V` | Value |
| `R` | Result/Return |
| `S` | Source |
| `U` | second type |
| `ID` | identifier type |
| `ENTITY` | entity type |

## 6.1 Standard examples

```java
interface List<E> {}
interface Map<K, V> {}
interface Function<T, R> {}
```

## 6.2 Domain-specific names

For complex APIs, descriptive names may help:

```java
interface Repository<ID, ENTITY> {
    Optional<ENTITY> findById(ID id);
}
```

## 6.3 Avoid meaningless many letters

Bad:

```java
class Processor<A, B, C, D, E> {}
```

Unless each relationship is obvious.

## 6.4 Keep generic arity low

A type with 4+ generic parameters is often hard to use.

Consider grouping types or simplifying API.

---

# 7. Parameterized Type vs Raw Type

## 7.1 Parameterized type

```java
List<String>
Map<CaseId, CaseRecord>
Repository<CaseId, CaseRecord>
```

## 7.2 Raw type

```java
List
Map
Repository
```

Raw type exists for backward compatibility with pre-generics Java.

Avoid raw types in new code.

## 7.3 Raw type danger

```java
List<String> names = new ArrayList<>();

List raw = names;
raw.add(123);

String s = names.get(0); // ClassCastException maybe
```

Compiler warns, but raw type bypasses type safety.

## 7.4 Unbounded wildcard is safer

Instead of:

```java
List list
```

use:

```java
List<?> list
```

when element type unknown.

`List<?>` says:

```text
a list of some unknown type
```

and prevents unsafe writes.

## 7.5 Legacy boundary

Raw types may appear when interacting with old libraries/reflection.

Confine raw usage to boundary and convert/validate immediately.

---

# 8. Generic Invariance

This is critical.

Even if:

```java
Integer extends Number
```

it does NOT mean:

```java
List<Integer> extends List<Number>
```

This is invalid:

```java
List<Integer> ints = new ArrayList<>();
List<Number> nums = ints; // compile error
```

## 8.1 Why?

If allowed:

```java
List<Integer> ints = new ArrayList<>();
List<Number> nums = ints;

nums.add(3.14); // Double is Number
Integer x = ints.get(0); // would break
```

So Java generics are invariant.

## 8.2 Invariance protects type safety

`List<Integer>` means every element is Integer.

Allowing it as `List<Number>` would permit adding non-Integer Number.

## 8.3 Use wildcards for variance

Producer:

```java
List<? extends Number>
```

Consumer:

```java
List<? super Integer>
```

## 8.4 Common mental model

```text
List<Integer> is a list that can contain only Integers.
List<Number> is a list that can contain any Number.
Those are not substitutable.
```

---

# 9. Array Covariance vs Generic Invariance

Arrays are covariant:

```java
String[] strings = new String[1];
Object[] objects = strings;
objects[0] = 123; // ArrayStoreException
```

Generics are invariant:

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings; // compile error
```

## 9.1 Arrays catch at runtime

Arrays know component type at runtime and throw `ArrayStoreException`.

## 9.2 Generics catch at compile time

Generics prevent unsafe assignment before runtime.

## 9.3 Why generics safer

No runtime surprise for ordinary generic collection writes.

## 9.4 But generics erased

Generics cannot enforce element type fully at runtime due erasure.

Raw types/unchecked casts can still break safety.

## 9.5 Design rule

Prefer generics collections over arrays for object collections in API design.

Use arrays for primitives/performance/interoperability.

---

# 10. Upper Bounded Type Parameter

You can restrict type parameter.

```java
static <T extends Comparable<T>> T max(T a, T b) {
    return a.compareTo(b) >= 0 ? a : b;
}
```

`T` must be subtype of `Comparable<T>`.

## 10.1 Bound gives operations

Without bound:

```java
static <T> int compare(T a, T b) {
    return a.compareTo(b); // compile error
}
```

With bound:

```java
static <T extends Comparable<T>> int compare(T a, T b) {
    return a.compareTo(b);
}
```

## 10.2 Bound can be class or interface

```java
<T extends Number>
<T extends CharSequence>
<T extends Runnable>
```

## 10.3 Bound affects erasure

Unbounded `T` erases to `Object`.

```java
class Box<T> { T value; }
```

Bounded `T extends Number` erases to `Number`.

```java
class NumberBox<T extends Number> { T value; }
```

## 10.4 Avoid overrestricting

If method only needs `Object` methods, no bound needed.

If it needs comparison, use `Comparator` sometimes instead of `Comparable` bound.

---

# 11. Multiple Bounds

Type parameter can have multiple bounds.

```java
<T extends Number & Comparable<T>>
```

Syntax: at most one class bound first, then interfaces.

```java
<T extends SomeClass & InterfaceA & InterfaceB>
```

## 11.1 Example

```java
static <T extends CharSequence & Comparable<T>> T longerComparable(T a, T b) {
    return a.length() >= b.length() ? a : b;
}
```

## 11.2 Class bound first

Valid:

```java
<T extends Number & Comparable<T>>
```

Invalid:

```java
<T extends Comparable<T> & Number>
```

because class bound must come first.

## 11.3 Use sparingly

Multiple bounds can make API harder to read.

Sometimes better to accept separate collaborators:

```java
Comparator<T>
Function<T, Key>
```

## 11.4 Domain example

```java
interface Identified<ID> {
    ID id();
}

interface Versioned {
    Version version();
}

static <T extends Identified<ID> & Versioned, ID> ...
```

This can become complex quickly. Prefer clear domain abstractions.

---

# 12. Recursive Bounds dan F-Bounded Polymorphism

F-bounded polymorphism means type parameter bounded by expression involving itself.

Common:

```java
<T extends Comparable<? super T>>
```

## 12.1 Comparable example

Better max signature:

```java
static <T extends Comparable<? super T>> T max(Collection<? extends T> values) {
    ...
}
```

Why `? super T`?

Because a type may be comparable to its supertype.

## 12.2 Self type pattern

```java
abstract class Builder<T extends Builder<T>> {
    T self() {
        return (T) this;
    }

    T withName(String name) {
        ...
        return self();
    }
}
```

Allows fluent subclass returns.

## 12.3 Danger

Unchecked casts and complexity.

## 12.4 Prefer simpler design

Many fluent APIs do not need recursive generics.

If complexity high, consider composition or concrete builder methods.

## 12.5 Domain use

Rare in domain model. More common in frameworks/base libraries.

---

# 13. Wildcards: `?`

Wildcard means unknown type argument.

```java
List<?>
```

means:

```text
List of some unknown type.
```

Could be:

```java
List<String>
List<Integer>
List<CaseId>
```

But caller does not know exactly.

## 13.1 Why wildcards exist?

To express variance/flexibility.

Example:

```java
void printAll(List<?> values) {
    for (Object value : values) {
        System.out.println(value);
    }
}
```

Can accept any list.

## 13.2 You cannot add arbitrary values

```java
void f(List<?> list) {
    // list.add("x"); // compile error
    list.add(null); // only null allowed
}
```

Because actual list might be `List<Integer>`.

## 13.3 Read as Object

```java
Object value = list.get(0);
```

You can read elements as Object.

## 13.4 Wildcard vs type parameter

Use wildcard when you do not need to relate type in multiple positions.

Use type parameter when relationship matters.

Example wildcard:

```java
void print(List<?> values)
```

Example type parameter:

```java
<T> T first(List<T> values)
```

---

# 14. Upper Bounded Wildcard: `? extends T`

```java
List<? extends Number>
```

means list of some unknown subtype of Number.

Could be:

```java
List<Integer>
List<Long>
List<Double>
List<Number>
```

## 14.1 Good for producers

You can read Numbers:

```java
double sum(List<? extends Number> values) {
    double total = 0;
    for (Number value : values) {
        total += value.doubleValue();
    }
    return total;
}
```

## 14.2 Cannot safely add

```java
void addNumber(List<? extends Number> values) {
    // values.add(Integer.valueOf(1)); // compile error
}
```

Because actual list might be `List<Double>`.

## 14.3 Only null add

```java
values.add(null);
```

Technically allowed, but usually bad.

## 14.4 Producer mental model

`? extends Number` produces Number values for you.

You consume/read from it.

## 14.5 API example

```java
void processAll(Collection<? extends Event> events)
```

Accepts `Collection<UserCreatedEvent>`.

---

# 15. Lower Bounded Wildcard: `? super T`

```java
List<? super Integer>
```

means list of some unknown supertype of Integer.

Could be:

```java
List<Integer>
List<Number>
List<Object>
```

## 15.1 Good for consumers

You can add Integer:

```java
void addInts(List<? super Integer> values) {
    values.add(1);
    values.add(2);
}
```

## 15.2 Reading gives Object

```java
Object value = values.get(0);
```

Because actual list might be `List<Object>`.

Compiler cannot promise more specific than Object.

## 15.3 Consumer mental model

`? super Integer` consumes Integer values from you.

You write into it.

## 15.4 API example

```java
void copyIntegers(List<Integer> source, List<? super Integer> target)
```

Target can be `List<Integer>`, `List<Number>`, or `List<Object>`.

## 15.5 Comparator example

```java
Comparator<? super T>
```

A comparator of supertype can compare T values.

---

# 16. PECS: Producer Extends, Consumer Super

PECS is the core heuristic:

```text
Producer Extends
Consumer Super
```

If parameter produces T values for you to read:

```java
? extends T
```

If parameter consumes T values you write:

```java
? super T
```

## 16.1 Copy example

```java
static <T> void copy(
    List<? extends T> source,
    List<? super T> target
) {
    for (T item : source) {
        target.add(item);
    }
}
```

Source produces T.

Target consumes T.

## 16.2 Collections.copy

Java Collections API uses this idea:

```java
copy(List<? super T> dest, List<? extends T> src)
```

## 16.3 Function example

```java
<R> List<R> map(
    List<? extends T> source,
    Function<? super T, ? extends R> mapper
)
```

- source produces T-ish values;
- mapper consumes T-ish input;
- mapper produces R-ish output.

## 16.4 Don't overuse PECS in return type

Avoid returning wildcard types from public APIs:

```java
List<? extends Event> events()
```

hard to use.

Usually return:

```java
List<Event>
```

or specific immutable collection.

## 16.5 PECS is heuristic, not law

Use type parameter when you need exact relationship.

---

# 17. Unbounded Wildcard: `?`

```java
List<?>
```

Useful when type is irrelevant.

## 17.1 Print all

```java
void printAll(Collection<?> values) {
    for (Object value : values) {
        System.out.println(value);
    }
}
```

## 17.2 Size

```java
int size(Collection<?> values) {
    return values.size();
}
```

## 17.3 Clear

```java
void clear(Collection<?> values) {
    values.clear();
}
```

Clear doesn't need element type.

## 17.4 Difference from raw type

`List<?>` is type-safe.

Raw `List` allows unsafe add.

```java
void unsafe(List list) {
    list.add(123);
}
```

```java
void safe(List<?> list) {
    // list.add(123); // compile error
}
```

## 17.5 Use when reading as Object only

If you need to preserve element type, use generic method.

---

# 18. Wildcard Capture

Sometimes compiler internally captures wildcard as a fresh type.

Example:

```java
void reverse(List<?> list) {
    reverseHelper(list);
}

private static <T> void reverseHelper(List<T> list) {
    ...
}
```

## 18.1 Why helper needed?

Inside `reverse(List<?>)`, element type unknown.

Helper method captures that unknown as `T`.

## 18.2 Swap example

```java
public static void swap(List<?> list, int i, int j) {
    swapHelper(list, i, j);
}

private static <T> void swapHelper(List<T> list, int i, int j) {
    T temp = list.get(i);
    list.set(i, list.get(j));
    list.set(j, temp);
}
```

## 18.3 Capture conversion

Compiler uses capture conversion to reason about wildcard types.

## 18.4 API design

If users need helper methods to use your API, maybe your wildcard design is too complex.

## 18.5 Error messages

You may see:

```text
capture of ?
```

This means compiler created internal unknown type for wildcard.

---

# 19. Generic API Design: Input, Output, Transform

## 19.1 Input only

If method only reads input:

```java
void publishAll(Collection<? extends DomainEvent> events)
```

## 19.2 Output only

If method writes into output:

```java
void addDefaultRules(Collection<? super Rule> rules)
```

## 19.3 Input-output same type relationship

```java
<T> List<T> filter(Collection<T> values, Predicate<? super T> predicate)
```

## 19.4 Transform

```java
<T, R> List<R> map(
    Collection<? extends T> values,
    Function<? super T, ? extends R> mapper
)
```

## 19.5 Public return types

Avoid wildcards in return unless necessary.

Bad:

```java
List<? extends User> users()
```

Hard for caller.

Better:

```java
List<User> users()
```

or:

```java
List<AdminUser> adminUsers()
```

## 19.6 Keep API ergonomic

A perfectly flexible generic signature can be unreadable.

Favor clarity over maximal theoretical flexibility unless library-level API.

---

# 20. Type Inference

Compiler infers type arguments.

```java
List<String> names = List.of("a", "b");
```

## 20.1 Method inference

```java
static <T> T identity(T value) { return value; }

String s = identity("x");
```

## 20.2 Target type

```java
List<String> names = new ArrayList<>();
```

Diamond uses target type.

## 20.3 Ambiguous inference

```java
var list = List.of();
```

Inferred type may be `List<Object>`.

Better specify:

```java
List<String> list = List.of();
```

or:

```java
var list = List.<String>of();
```

## 20.4 Null inference

```java
var x = identity(null);
```

Compiler may infer a broad type or fail depending context.

Avoid ambiguous null generic calls.

## 20.5 Inference and overloads

Generic overloads can confuse method resolution.

Avoid overly clever overloads with generics.

---

# 21. Diamond Operator

Instead of:

```java
Map<CaseId, CaseRecord> map = new HashMap<CaseId, CaseRecord>();
```

Use:

```java
Map<CaseId, CaseRecord> map = new HashMap<>();
```

## 21.1 Anonymous classes

Modern Java supports diamond with anonymous classes in many cases.

## 21.2 var + diamond

```java
var map = new HashMap<CaseId, CaseRecord>();
```

This is okay.

But:

```java
var map = new HashMap<>();
```

may infer:

```java
HashMap<Object, Object>
```

depending context.

Be explicit when needed.

## 21.3 Best practice

With `var`, specify generic type on RHS if no target type:

```java
var handlers = new EnumMap<CaseStatus, Handler>(CaseStatus.class);
```

or use LHS explicit type.

---

# 22. Target Typing

Target typing means context helps infer generic type.

```java
List<String> names = List.of();
```

The target type `List<String>` helps infer `String`.

## 22.1 Method argument target

```java
void accept(List<String> names) {}

accept(List.of());
```

Compiler can infer List<String>.

## 22.2 Lambda target

```java
Function<String, Integer> length = s -> s.length();
```

Lambda type inferred from target.

## 22.3 Generic factory

```java
static <T> Box<T> box(T value) { return new Box<>(value); }

Box<String> b = box("x");
```

## 22.4 Pitfall with var

`var` removes explicit target.

```java
var empty = List.of();
```

Inferred as immutable empty list with broad type.

Use explicit type witness if needed.

---

# 23. Type Erasure

Java generics are implemented mostly by type erasure.

Oracle tutorial describes erasure as compiler replacing type parameters with bounds or `Object`, inserting casts when necessary, and generating bridge methods to preserve polymorphism. It also notes that type erasure ensures no new classes are created for parameterized types and generics incur no runtime overhead in that sense.

## 23.1 Example

Source:

```java
class Box<T> {
    private T value;

    T value() {
        return value;
    }
}
```

Erased roughly:

```java
class Box {
    private Object value;

    Object value() {
        return value;
    }
}
```

If bounded:

```java
class NumberBox<T extends Number> {
    T value;
}
```

Erased to:

```java
class NumberBox {
    Number value;
}
```

## 23.2 Cast insertion

Source:

```java
Box<String> box = new Box<>("x");
String s = box.value();
```

Compiler inserts cast after erasure:

```java
String s = (String) box.value();
```

## 23.3 Runtime class

```java
List<String> strings = new ArrayList<>();
List<Integer> ints = new ArrayList<>();

strings.getClass() == ints.getClass() // true
```

Both are `ArrayList`.

## 23.4 Cannot overload by generic argument

Invalid:

```java
void process(List<String> values) {}
void process(List<Integer> values) {}
```

Same erasure.

## 23.5 Cannot use `instanceof List<String>`

```java
if (obj instanceof List<String>) {} // invalid
```

Use:

```java
if (obj instanceof List<?> list) {}
```

and validate elements if needed.

---

# 24. Bridge Methods

Type erasure can require compiler-generated bridge methods to preserve polymorphism.

## 24.1 Example

```java
class Node<T> {
    T data;

    void setData(T data) {
        this.data = data;
    }
}

class MyNode extends Node<Integer> {
    @Override
    void setData(Integer data) {
        this.data = data;
    }
}
```

After erasure:

```java
class Node {
    void setData(Object data) {}
}

class MyNode extends Node {
    void setData(Integer data) {}
}
```

But overriding needs `setData(Object)`. Compiler generates bridge:

```java
void setData(Object data) {
    setData((Integer) data);
}
```

## 24.2 Why you care

Stack traces/reflection may show synthetic bridge methods.

Frameworks should handle them.

## 24.3 Bridge methods and ClassCastException

Raw type misuse can call bridge with wrong type, causing ClassCastException.

## 24.4 Not usually hand-written

You don't write bridge methods. Compiler does.

## 24.5 Debugging

If you see method marked synthetic/bridge in reflection, generics/erasure may be involved.

---

# 25. Reifiable vs Non-Reifiable Types

A reifiable type has full runtime representation.

Examples:

```java
String
String[]
int[]
List<?> 
raw List
```

Non-reifiable:

```java
List<String>
List<Integer>
T
List<T>
```

because type argument erased.

## 25.1 Why matters

You cannot do:

```java
new List<String>[10]
obj instanceof List<String>
```

## 25.2 `List<?>` is reifiable enough

```java
if (obj instanceof List<?> list) {}
```

Allowed.

## 25.3 Class literal

```java
String.class
List.class
int[].class
```

But not:

```java
List<String>.class // invalid
```

## 25.4 Runtime generic metadata

Some generic signatures are stored in class file metadata, but runtime object instance does not generally carry concrete type argument.

Reflection can inspect declared generic types, not always actual runtime values.

---

# 26. Heap Pollution

Heap pollution occurs when a variable of parameterized type refers to object that is not of that parameterized type.

## 26.1 Raw type example

```java
List<String> strings = new ArrayList<>();

List raw = strings;
raw.add(123);

String s = strings.get(0); // ClassCastException
```

`strings` claims List<String>, but heap contains Integer.

## 26.2 Unchecked warnings

Compiler warns:

```text
unchecked call
unchecked conversion
```

Treat as serious.

## 26.3 Generic varargs

```java
static void dangerous(List<String>... lists) {
    Object[] array = lists;
    array[0] = List.of(123);
    String s = lists[0].get(0);
}
```

Heap pollution.

## 26.4 Suppress warning carefully

```java
@SuppressWarnings("unchecked")
```

only around smallest possible scope and with explanation.

## 26.5 Production impact

Heap pollution causes delayed ClassCastException far from root cause.

This is painful to debug.

---

# 27. Raw Types

Raw types disable generic checking.

```java
List raw = new ArrayList();
```

## 27.1 Why raw exists

Backward compatibility with pre-Java 5 code.

## 27.2 Raw type accepts anything

```java
raw.add("x");
raw.add(123);
```

## 27.3 Raw type infection

Once raw type enters, warnings spread.

## 27.4 Use wildcard instead

```java
List<?> unknown
```

for unknown element type.

## 27.5 Boundary quarantine

If interacting with legacy raw API:

```java
@SuppressWarnings("unchecked")
List<String> strings = validateStringList(raw);
```

Validate contents before casting.

## 27.6 Do not ignore warnings

Unchecked warnings are often future production bugs.

---

# 28. Generic Arrays Problem

Arrays are reified; generics are erased.

```java
T[] array = new T[10]; // invalid
```

## 28.1 Why?

Runtime needs actual component type for array store checks.

But `T` erased.

## 28.2 Unsafe workaround

```java
@SuppressWarnings("unchecked")
T[] array = (T[]) new Object[10];
```

This may be okay internally if never exposed and carefully controlled, but dangerous.

## 28.3 Better: generator

```java
static <T> T[] toArray(Collection<T> values, IntFunction<T[]> factory) {
    return values.toArray(factory.apply(values.size()));
}
```

Usage:

```java
String[] arr = toArray(names, String[]::new);
```

## 28.4 Better: Class<T>

```java
@SuppressWarnings("unchecked")
static <T> T[] newArray(Class<T> type, int length) {
    return (T[]) Array.newInstance(type, length);
}
```

## 28.5 Prefer List<T>

Most generic APIs should use `List<T>` or `Collection<T>` instead of `T[]`.

---

# 29. Varargs + Generics

Varargs are arrays. Generic varargs can cause heap pollution.

```java
@SafeVarargs
static <T> List<T> listOf(T... values) {
    return List.of(values);
}
```

## 29.1 Warning

Compiler may warn:

```text
Possible heap pollution from parameterized vararg type
```

## 29.2 SafeVarargs

Use `@SafeVarargs` only when method does not perform unsafe operations on varargs array or expose it.

Allowed on:

- static methods;
- final instance methods;
- private instance methods;
- constructors.

## 29.3 Safe example

```java
@SafeVarargs
static <T> List<T> immutableList(T... values) {
    return List.copyOf(Arrays.asList(values));
}
```

Still consider null behavior.

## 29.4 Unsafe example

```java
@SafeVarargs
static <T> void unsafe(List<T>... lists) {
    Object[] array = lists;
    array[0] = List.of("wrong");
}
```

Do not lie with annotation.

## 29.5 Prefer collection parameter

```java
void process(Collection<? extends Event> events)
```

instead of generic varargs if unsure.

---

# 30. Type Token dan Runtime Generic Information

Because of erasure, sometimes you need explicit runtime type information.

## 30.1 Class<T>

```java
<T> T read(String json, Class<T> type)
```

Usage:

```java
User user = read(json, User.class);
```

Works for non-parameterized type.

## 30.2 Problem with List<User>

Cannot write:

```java
List<User>.class
```

## 30.3 TypeReference pattern

Libraries use super type token:

```java
new TypeReference<List<User>>() {}
```

or:

```java
ParameterizedTypeReference<List<User>>
```

This captures generic type in anonymous subclass metadata.

## 30.4 Manual type token

```java
record TypeToken<T>(Type type) {}
```

Complex to implement correctly.

Use library types when needed.

## 30.5 Domain design

Do not leak runtime generic type token everywhere unless building serialization/framework infrastructure.

Application services usually should use concrete typed methods.

---

# 31. Generic Exceptions Limitation

You cannot create generic throwable class.

Invalid:

```java
class Problem<T> extends Exception {}
```

Generic classes cannot directly or indirectly subclass `Throwable`.

## 31.1 Why?

Type erasure and exception handling would be problematic.

## 31.2 Generic method can throw type parameter bounded by Throwable

```java
static <E extends Exception> void sneaky(E e) throws E {
    throw e;
}
```

Use carefully.

## 31.3 Avoid clever exception generics

In application code, prefer explicit exception types or result types.

## 31.4 Domain errors

For typed domain errors, sealed result may be better than generic exception.

---

# 32. Generics dan Primitive Types

Generics work only with reference types.

Invalid:

```java
List<int>
Optional<int>
```

Use wrappers:

```java
List<Integer>
Optional<Integer>
```

or primitive specialized APIs:

```java
int[]
IntStream
OptionalInt
```

## 32.1 Boxing cost

```java
List<Integer>
```

boxes int values.

For large numeric data, use primitive arrays or specialized collections.

## 32.2 Type parameter cannot be primitive

```java
class Box<T> {}
Box<int> // invalid
```

## 32.3 Future direction

Project Valhalla aims to improve this space, but current production Java generics are erased and reference-only.

## 32.4 API design

For business data, `List<Integer>` fine if small.

For 10 million ints, use `int[]`, `IntStream`, or primitive collection.

---

# 33. Generics di Collections Framework

Collections Framework heavily uses generics.

## 33.1 List<E>

```java
List<String> names;
```

E is element type.

## 33.2 Map<K,V>

```java
Map<CaseId, CaseRecord> cases;
```

K key, V value.

## 33.3 Comparator<? super T>

```java
list.sort(Comparator<? super T> c)
```

Comparator of supertype can compare T.

## 33.4 Collection<? extends T>

Methods that accept producers often use extends.

## 33.5 Collections.copy

The signature reflects PECS:

```java
copy(List<? super T> dest, List<? extends T> src)
```

Destination consumes T, source produces T.

## 33.6 checked collections

`Collections.checkedList` can provide runtime type checking wrapper:

```java
List<String> safe = Collections.checkedList(rawList, String.class);
```

Useful at legacy boundaries.

## 33.7 Unmodifiable vs checked

Different concerns:

- unmodifiable prevents mutation through wrapper;
- checked prevents wrong runtime type insertion.

---

# 34. Generics di Domain Model

## 34.1 Typed ID generic?

Option:

```java
record Id<T>(UUID value) {}
```

Usage:

```java
Id<CaseRecord> caseId;
Id<Officer> officerId;
```

Pros:

- reusable;
- phantom type prevents mixing.

Cons:

- runtime erasure;
- less explicit than `CaseId`;
- serialization awkward;
- error messages less domain-specific.

Often better:

```java
record CaseId(UUID value) {}
record OfficerId(UUID value) {}
```

## 34.2 Result<T,E>

```java
sealed interface Result<T, E> permits Ok, Err {}

record Ok<T, E>(T value) implements Result<T, E> {}
record Err<T, E>(E error) implements Result<T, E> {}
```

Useful but can become verbose in Java.

Domain-specific sealed results often clearer.

## 34.3 Page<T>

```java
record Page<T>(
    List<T> items,
    PageInfo pageInfo
) {
    Page {
        items = List.copyOf(items);
        Objects.requireNonNull(pageInfo);
    }
}
```

Good generic domain utility.

## 34.4 Command<TResponse>

```java
interface Command<R> {}
```

Can model command response type.

But dispatching generic command handlers can become complex due erasure.

## 34.5 Avoid over-generalizing domain

Bad:

```java
Entity<ID, STATUS, TYPE, OWNER, VERSION>
```

If it obscures domain, don't.

---

# 35. Generics di Repository, Mapper, Validator, Result

## 35.1 Repository

```java
interface Repository<ID, E> {
    Optional<E> findById(ID id);
    E save(E entity);
}
```

Good as base abstraction maybe.

But concrete repository often clearer:

```java
interface CaseRepository {
    Optional<CaseRecord> findById(CaseId id);
}
```

## 35.2 Mapper

```java
interface Mapper<S, T> {
    T map(S source);
}
```

Good.

## 35.3 Validator

```java
interface Validator<T> {
    List<Violation> validate(T value);
}
```

Good.

## 35.4 Handler

```java
interface CommandHandler<C extends Command<R>, R> {
    R handle(C command);
}
```

Can be powerful but dispatch registry tricky due erasure.

## 35.5 Result

Generic result can reduce duplication but may be less expressive than domain-specific sealed result.

Compare:

```java
Result<UserId, RegistrationError>
```

vs:

```java
sealed interface RegisterUserResult permits Registered, DuplicateEmail, InvalidRegistration {}
```

Domain-specific is often more readable.

---

# 36. Fluent API dan Self Type Problem

Fluent builders with inheritance often want methods to return subtype.

## 36.1 Naive base builder

```java
class BaseBuilder {
    BaseBuilder withName(String name) {
        return this;
    }
}

class UserBuilder extends BaseBuilder {
    UserBuilder withEmail(String email) {
        return this;
    }
}
```

Chaining issue:

```java
new UserBuilder()
    .withName("Fajar")
    .withEmail("x"); // withName returns BaseBuilder
```

## 36.2 Recursive generic self type

```java
abstract class BaseBuilder<B extends BaseBuilder<B>> {
    B withName(String name) {
        ...
        return self();
    }

    protected abstract B self();
}

class UserBuilder extends BaseBuilder<UserBuilder> {
    @Override
    protected UserBuilder self() {
        return this;
    }

    UserBuilder withEmail(String email) {
        ...
        return this;
    }
}
```

## 36.3 Cost

Complexity and potential unchecked casts.

## 36.4 Alternative

Avoid inheritance in builders.

Use composition or concrete builder.

## 36.5 Domain advice

Most domain builders do not need generic self types.

---

# 37. When Not to Use Generics

## 37.1 No relationship between types

Bad:

```java
<T> void print(T value)
```

Use:

```java
void print(Object value)
```

## 37.2 Domain becomes abstract mush

Bad:

```java
Processor<A, B, C, D>
```

No domain language.

## 37.3 One implementation only

If generic abstraction has one concrete use, maybe premature.

## 37.4 Wildcard spaghetti

```java
Map<? extends K, ? super List<? extends V>>
```

If callers cannot understand it, redesign.

## 37.5 Runtime type required everywhere

If every method needs `Class<T>`/`TypeReference<T>`, consider concrete APIs.

## 37.6 Generic repository everywhere

Generic repository pattern can hide domain-specific queries/invariants.

Use concrete repositories in domain.

---

# 38. Production Failure Modes

## 38.1 Raw type ClassCastException

Legacy raw list accepts wrong type. Failure occurs later.

Fix:

- eliminate raw types;
- use `List<?>`;
- validate at boundary;
- checked collections.

## 38.2 Invariance confusion

Developer expects `List<Integer>` usable as `List<Number>`.

Fix:

- use `List<? extends Number>` for producers;
- understand PECS.

## 38.3 Wrong wildcard direction

API uses `? extends` but method needs to add values.

Fix:

- use `? super T` for consumers.

## 38.4 Returning wildcard type

Caller struggles with `List<? extends Event>`.

Fix:

- return `List<Event>` or exact type.

## 38.5 Generic array unsafe cast

`(T[]) new Object[]` escapes and causes ClassCastException.

Fix:

- use `IntFunction<T[]>`;
- `Array.newInstance`;
- prefer collections.

## 38.6 Heap pollution from varargs

Generic varargs method corrupts array.

Fix:

- avoid;
- `@SafeVarargs` only if safe.

## 38.7 Type erasure breaks dispatch

Registry keyed only by raw class cannot distinguish `Handler<List<User>>` vs `Handler<List<Order>>`.

Fix:

- use type tokens;
- concrete handler keys;
- explicit message type.

## 38.8 Over-generic domain

Generic base classes obscure business behavior.

Fix:

- concrete domain types;
- generics only at utility/infrastructure boundaries.

## 38.9 Ignored unchecked warnings

Unchecked cast warning later becomes production ClassCastException.

Fix:

- treat warnings as errors where possible;
- minimize suppressions.

## 38.10 `var` + diamond infers Object

```java
var map = new HashMap<>();
```

becomes `HashMap<Object,Object>`.

Fix:

```java
Map<CaseId, CaseRecord> map = new HashMap<>();
```

or:

```java
var map = new HashMap<CaseId, CaseRecord>();
```

---

# 39. Best Practices

## 39.1 General

- Use generics to express type relationships.
- Avoid raw types.
- Prefer `List<?>` over raw `List` for unknown element type.
- Understand invariance.
- Use `? extends T` for producers.
- Use `? super T` for consumers.
- Avoid wildcard return types.
- Keep generic parameter count low.
- Use bounded type parameters only when needed.
- Avoid generic arrays; prefer collections or array factories.
- Treat unchecked warnings seriously.
- Keep `@SuppressWarnings("unchecked")` narrow and documented.
- Use `Class<T>` or TypeReference only at runtime type boundaries.
- Use primitive arrays/streams for large primitive data.
- Prefer concrete domain APIs over over-generic repositories.

## 39.2 API

- Make common use easy.
- Don't expose complex wildcard types unless library-level flexibility needed.
- Use type parameters when input/output types related.
- Use wildcards when accepting flexible input.
- Return concrete generic types, not wildcards.
- Document type parameter semantics.

## 39.3 Domain

- Use records/classes for typed IDs instead of over-generic `Id<T>` unless team accepts phantom types.
- Use generic Page<T>, Validator<T>, Mapper<S,T> where obvious.
- Use domain-specific sealed results when generic Result<T,E> becomes unreadable.
- Avoid generic abstraction that hides ubiquitous language.

## 39.4 Runtime

- Remember type erasure.
- Don't expect `List<String>` runtime checks.
- Use checked collections or validators at unsafe boundaries.
- Use type tokens for serialization/deserialization of parameterized types.

---

# 40. Decision Matrix

| Situation | Recommended |
|---|---|
| typed collection | `List<T>`, `Set<T>`, `Map<K,V>` |
| read-only flexible input | `Collection<? extends T>` |
| write target | `Collection<? super T>` |
| unknown list | `List<?>` |
| return list | `List<T>` not wildcard |
| generic utility preserving type | `<T> T`, `<T> List<T>` |
| needs comparison | `<T extends Comparable<? super T>>` or `Comparator<? super T>` |
| generic array creation | `IntFunction<T[]>` or `Array.newInstance` |
| runtime class needed | `Class<T>` |
| runtime parameterized type needed | `TypeReference<T>` pattern |
| legacy raw input | validate + convert; maybe `Collections.checked*` |
| large primitive data | primitive array/stream/collection |
| domain ID | concrete `CaseId` often better |
| generic page | `Page<T>` good |
| generic repository | use carefully; concrete repo often clearer |
| result with domain alternatives | sealed domain result often clearer |
| fluent inheritance | recursive generics if necessary, otherwise avoid |

---

# 41. Latihan

## Latihan 1 — Generic Box

Implement:

```java
record Box<T>(T value) {}
```

Use with `String`, `Integer`, `CaseId`.

## Latihan 2 — Generic Method

Implement:

```java
static <T> T first(List<T> values)
```

Handle empty list.

## Latihan 3 — Invariance

Try:

```java
List<Integer> ints = List.of(1,2);
List<Number> nums = ints;
```

Explain compile error.

## Latihan 4 — Extends Producer

Implement:

```java
double sum(Collection<? extends Number> values)
```

Try with `List<Integer>`, `List<Double>`.

## Latihan 5 — Super Consumer

Implement:

```java
void addDefaults(Collection<? super Integer> target)
```

Try with `List<Integer>`, `List<Number>`, `List<Object>`.

## Latihan 6 — PECS Copy

Implement:

```java
static <T> void copy(List<? extends T> src, List<? super T> dest)
```

## Latihan 7 — Raw Type Pollution

Create `List<String>`, assign to raw `List`, add Integer, observe ClassCastException later.

## Latihan 8 — Generic Array

Try `new T[10]`. Then implement array factory with `IntFunction<T[]>`.

## Latihan 9 — Type Erasure

Print runtime class of `ArrayList<String>` and `ArrayList<Integer>`.

## Latihan 10 — Type Token

Use a JSON library style pseudo-signature:

```java
<T> T read(String json, Class<T> type)
<T> T read(String json, TypeReference<T> type)
```

Explain why `Class<T>` is not enough for `List<User>`.

## Latihan 11 — Generic Result vs Sealed Result

Implement generic:

```java
Result<T,E>
```

Then compare with domain-specific:

```java
RegisterUserResult
```

Discuss readability.

## Latihan 12 — Wildcard API Review

Review a method signature with wildcards. Decide if it is producer, consumer, both, or too complex.

---

# 42. Ringkasan

Generics adalah mekanisme Java untuk parameterisasi type secara compile-time.

Mereka memberi:

```text
type safety
reusable algorithms
typed collections
less casting
expressive APIs
```

Tetapi konsep pentingnya harus dipahami:

- generics invariant;
- wildcard memberi controlled variance;
- `? extends T` untuk producer;
- `? super T` untuk consumer;
- `List<?>` lebih aman daripada raw `List`;
- type erasure menghapus banyak generic info di runtime;
- bridge methods menjaga polymorphism setelah erasure;
- generic arrays sulit karena arrays reified dan generics erased;
- raw types dan unchecked warnings adalah sumber heap pollution;
- generics tidak bekerja dengan primitive types;
- runtime parameterized type butuh type token pattern.

Senior Java engineer tidak hanya tahu syntax:

```java
<T>
?
extends
super
```

Mereka tahu kapan generic membuat API lebih aman, dan kapan generic membuat domain lebih kabur.

Rule of thumb:

```text
Use generics to express real type relationships.
Do not use generics to look clever.
```

Jika generics membantu compiler menjaga invariant, gunakan. Jika generics membuat semua orang bingung, desain ulang.

---

# 43. Referensi

1. Java Language Specification SE 25 — Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

2. Java Language Specification SE 25 — Type Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.4

3. Java Language Specification SE 25 — Parameterized Types  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.5

4. Java Language Specification SE 25 — Type Erasure  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.6

5. Java Language Specification SE 25 — Reifiable Types  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.7

6. Java Language Specification SE 25 — Raw Types  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.8

7. Java Language Specification SE 25 — Heap Pollution  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.12.2

8. Java Language Specification SE 25 — Capture Conversion  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html#jls-5.1.10

9. Oracle Java Tutorial — Type Erasure  
   https://docs.oracle.com/javase/tutorial/java/generics/erasure.html

10. Oracle Java Tutorial — Effects of Type Erasure and Bridge Methods  
    https://docs.oracle.com/javase/tutorial/java/generics/bridgeMethods.html

11. Java SE 25 API — `Collections`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

12. Java SE 25 API — `List`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

13. Java SE 25 API — `Map`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html

14. Java SE 25 API — `Class`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html
