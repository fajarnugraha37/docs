# learn-java-collections-and-streams-part-012.md

# Java Collections and Streams — Part 012  
# Collections and Generics: Invariance, Wildcards, PECS, Type Erasure, Raw Types, Heap Pollution, Checked Wrappers, dan Type-Safe API Design

> Seri: **Advanced Java Collections and Streams**  
> Bagian: **012**  
> Fokus: memahami hubungan Collections dan Generics sebagai **compile-time type safety system**. Kita akan membedah invariant generic types, wildcard `? extends` dan `? super`, PECS, type erasure, raw types, heap pollution, generic arrays, checked wrappers, capture helper methods, bounded type parameters, generic methods, variance dalam API design, dan production pitfalls.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Generics adalah Compile-Time Contract](#2-mental-model-generics-adalah-compile-time-contract)
3. [Kenapa Collections Butuh Generics](#3-kenapa-collections-butuh-generics)
4. [Generic Type Dasar](#4-generic-type-dasar)
5. [Invariance: `List<String>` bukan `List<Object>`](#5-invariance-liststring-bukan-listobject)
6. [Arrays Covariant, Generics Invariant](#6-arrays-covariant-generics-invariant)
7. [Wildcard `?`](#7-wildcard-)
8. [Upper-Bounded Wildcard: `? extends T`](#8-upper-bounded-wildcard--extends-t)
9. [Lower-Bounded Wildcard: `? super T`](#9-lower-bounded-wildcard--super-t)
10. [PECS: Producer Extends, Consumer Super](#10-pecs-producer-extends-consumer-super)
11. [Read/Write Rules with Wildcards](#11-readwrite-rules-with-wildcards)
12. [Generic Methods](#12-generic-methods)
13. [Bounded Type Parameters](#13-bounded-type-parameters)
14. [Multiple Bounds](#14-multiple-bounds)
15. [Wildcard vs Type Parameter](#15-wildcard-vs-type-parameter)
16. [Capture Helper Methods](#16-capture-helper-methods)
17. [Return Types and Wildcards](#17-return-types-and-wildcards)
18. [Type Erasure](#18-type-erasure)
19. [Reifiable vs Non-Reifiable Types](#19-reifiable-vs-non-reifiable-types)
20. [Raw Types](#20-raw-types)
21. [Heap Pollution](#21-heap-pollution)
22. [Unchecked Warnings](#22-unchecked-warnings)
23. [`@SuppressWarnings("unchecked")`](#23-suppresswarningsunchecked)
24. [Generic Arrays Problem](#24-generic-arrays-problem)
25. [Varargs and Generics](#25-varargs-and-generics)
26. [`@SafeVarargs`](#26-safevarargs)
27. [Checked Collections](#27-checked-collections)
28. [Collections API Examples: Why Signatures Look Complex](#28-collections-api-examples-why-signatures-look-complex)
29. [`Collections.copy`](#29-collectionscopy)
30. [`Collections.max/min`](#30-collectionsmaxmin)
31. [`Comparator<? super T>`](#31-comparator-super-t)
32. [Collectors and Generics](#32-collectors-and-generics)
33. [Designing Type-Safe Collection APIs](#33-designing-type-safe-collection-apis)
34. [Domain Modeling with Generics](#34-domain-modeling-with-generics)
35. [Generics and Runtime Boundaries](#35-generics-and-runtime-boundaries)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Collections tanpa generics akan seperti ini:

```java
List ids = new ArrayList();
ids.add("CASE-1");
ids.add(123);

String id = (String) ids.get(1); // ClassCastException
```

Generics membuat compiler bisa mencegah banyak bug:

```java
List<CaseId> ids = new ArrayList<>();
ids.add(new CaseId("CASE-1"));
ids.add(123); // compile error
```

Tetapi generics di Java juga punya area yang sering membingungkan:

```java
List<String> is not List<Object>
List<? extends Number>
List<? super Integer>
Collection<? extends T>
Comparator<? super T>
Class<T>
List<T>[]
raw List
unchecked cast
heap pollution
```

Tujuan bagian ini:

- memahami generics sebagai type-safety contract;
- memahami invariance dan variance via wildcards;
- memahami PECS;
- memahami type erasure;
- memahami raw types dan heap pollution;
- memahami kenapa signature Collections API terlihat kompleks;
- mendesain API collections yang fleksibel dan aman.

---

# 2. Mental Model: Generics adalah Compile-Time Contract

Generics di Java terutama bekerja di compile time.

```java
List<String>
```

berarti:

```text
Compiler harus menjaga agar list ini digunakan sebagai list of String.
```

Runtime biasanya tidak menyimpan informasi penuh `String` sebagai type argument karena type erasure.

## 2.1 Contract for developer

```java
Map<CaseId, CaseSummary>
```

lebih kuat daripada:

```java
Map
```

atau:

```java
Map<String, Object>
```

Karena compiler tahu:

- key harus `CaseId`;
- value harus `CaseSummary`.

## 2.2 Not runtime magic

At runtime, banyak generic type info dihapus.

```java
List<String>
List<Integer>
```

keduanya runtime class-nya tetap semacam `ArrayList`.

## 2.3 Generic type safety is preventive

Generics mencegah wrong type masuk ke collection sebelum runtime.

## 2.4 Rule

```text
Generics move type errors from runtime to compile time.
```

---

# 3. Kenapa Collections Butuh Generics

Sebelum generics, Collections menyimpan `Object`.

```java
List names = new ArrayList();
names.add("Alice");
names.add(42);
```

Saat mengambil:

```java
String name = (String) names.get(0);
```

Butuh cast manual.

## 3.1 Problem

Cast bisa gagal jauh dari lokasi insert.

```java
names.add(42);          // bug inserted here
String s = (String) ... // failure later
```

## 3.2 With generics

```java
List<String> names = new ArrayList<>();
names.add("Alice");
names.add(42); // compile error
```

## 3.3 Documentation

Type itself documents intent:

```java
List<EmailAddress>
Set<Permission>
Map<TenantCaseKey, CaseSummary>
```

## 3.4 API correctness

Generic APIs can be reusable and safe:

```java
static <T> List<T> copyToList(Iterable<? extends T> source)
```

## 3.5 Rule

Collections and generics together form type-safe data modeling vocabulary.

---

# 4. Generic Type Dasar

A generic type is a class or interface parameterized over types.

Examples:

```java
List<E>
Set<E>
Map<K, V>
Optional<T>
Comparator<T>
```

## 4.1 Type parameter

```java
class Box<T> {
    private T value;
}
```

`T` is type parameter.

## 4.2 Type argument

```java
Box<String>
```

`String` is type argument.

## 4.3 Collection examples

```java
List<CaseId>
Map<CaseId, CaseSummary>
Set<Permission>
Queue<Job>
```

## 4.4 Diamond operator

```java
List<String> names = new ArrayList<>();
```

Compiler infers right-hand type argument.

## 4.5 Generic method

```java
static <T> T first(List<T> list) {
    return list.getFirst();
}
```

## 4.6 Rule

Generic type parameter lets one implementation be type-safe for many types.

---

# 5. Invariance: `List<String>` bukan `List<Object>`

Java generics are invariant.

Even though:

```java
String extends Object
```

it is not true that:

```java
List<String> extends List<Object>
```

## 5.1 Why?

If this were allowed:

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings; // illegal, imagine allowed
objects.add(123);
String s = strings.get(0); // boom
```

## 5.2 Correct abstraction

If you want read-only-ish “list of some subtype of Object”:

```java
List<? extends Object>
```

or simply:

```java
List<?>
```

## 5.3 Example

```java
void printAll(List<Object> values) { ... }

List<String> names = List.of("A");
printAll(names); // compile error
```

Fix:

```java
void printAll(List<?> values) {
    for (Object value : values) {
        System.out.println(value);
    }
}
```

## 5.4 Rule

Generic subtype relationship is not inherited from element subtype relationship.

---

# 6. Arrays Covariant, Generics Invariant

Arrays are covariant.

```java
String[] strings = new String[10];
Object[] objects = strings; // allowed
objects[0] = 123; // ArrayStoreException at runtime
```

Generics prevent this at compile time.

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings; // compile error
```

## 6.1 Runtime vs compile-time

Arrays know component type at runtime.

Generic collections use type erasure, so runtime cannot check full type arguments in same way.

## 6.2 Why generic arrays problematic

```java
List<String>[] array = new List<String>[10]; // illegal
```

Because arrays are runtime type-checked but generic component type is erased.

## 6.3 Rule

Arrays are runtime-reified and covariant; generics are erased and invariant.

---

# 7. Wildcard `?`

Wildcard means unknown type.

```java
List<?>
```

means:

```text
List of some type, but we do not know exactly what.
```

## 7.1 You can read as Object

```java
void print(List<?> values) {
    for (Object value : values) {
        System.out.println(value);
    }
}
```

## 7.2 You cannot add normal values

```java
void add(List<?> values) {
    values.add("x"); // compile error
}
```

Because actual list might be `List<Integer>`.

## 7.3 You can add null

```java
values.add(null);
```

Technically allowed, but usually bad style.

## 7.4 Use cases

- printing;
- size;
- contains;
- read-only generic operations;
- unknown collection type.

## 7.5 Rule

`List<?>` is good when element type does not matter.

---

# 8. Upper-Bounded Wildcard: `? extends T`

```java
List<? extends Number>
```

means:

```text
List of some unknown subtype of Number.
```

Could be:

```java
List<Integer>
List<Double>
List<BigDecimal>
List<Number>
```

## 8.1 Good for producers

If list produces Numbers:

```java
double sum(List<? extends Number> values) {
    double total = 0;
    for (Number value : values) {
        total += value.doubleValue();
    }
    return total;
}
```

Can pass:

```java
List<Integer>
List<Double>
```

## 8.2 Cannot add Number

```java
void addNumber(List<? extends Number> values) {
    values.add(1); // compile error
}
```

Because actual list might be `List<Double>`.

## 8.3 Read type

You can read as `Number`.

## 8.4 Write type

Cannot write except null.

## 8.5 Rule

Use `? extends T` when your API reads/consumes values from source as T.

---

# 9. Lower-Bounded Wildcard: `? super T`

```java
List<? super Integer>
```

means:

```text
List of some unknown supertype of Integer.
```

Could be:

```java
List<Integer>
List<Number>
List<Object>
```

## 9.1 Good for consumers

If list consumes Integers:

```java
void addIntegers(List<? super Integer> values) {
    values.add(1);
    values.add(2);
}
```

Can pass:

```java
List<Integer>
List<Number>
List<Object>
```

## 9.2 Reading

When reading, safest type is Object:

```java
Object value = values.get(0);
```

Cannot assume Number because actual list could be `List<Object>` containing non-numbers.

## 9.3 Rule

Use `? super T` when your API writes T values into destination.

---

# 10. PECS: Producer Extends, Consumer Super

PECS:

```text
Producer Extends
Consumer Super
```

## 10.1 Producer

If parameter produces T values for you to read:

```java
Collection<? extends T>
```

Example:

```java
void addAll(Collection<? extends T> source)
```

## 10.2 Consumer

If parameter consumes T values you write:

```java
Collection<? super T>
```

Example:

```java
void copyTo(Collection<? super T> destination)
```

## 10.3 Both read and write?

If you both read and write same exact T:

```java
List<T>
```

## 10.4 Example copy

```java
static <T> void copy(
    List<? super T> dest,
    List<? extends T> src
) {
    for (T item : src) {
        dest.add(item);
    }
}
```

## 10.5 Rule

When confused, ask: is this parameter producing or consuming T?

---

# 11. Read/Write Rules with Wildcards

## 11.1 `List<T>`

Read T, write T.

```java
T value = list.get(0);
list.add(value);
```

## 11.2 `List<? extends T>`

Read T, cannot write T.

```java
T value = list.get(0);
list.add(value); // compile error
```

## 11.3 `List<? super T>`

Can write T, read Object.

```java
list.add(t);
Object value = list.get(0);
```

## 11.4 `List<?>`

Read Object, cannot write non-null.

```java
Object value = list.get(0);
list.add("x"); // compile error
```

## 11.5 Rule table

| Type | Read as | Write |
|---|---|---|
| `List<T>` | `T` | `T` |
| `List<? extends T>` | `T` | no, except null |
| `List<? super T>` | `Object` | `T` |
| `List<?>` | `Object` | no, except null |

---

# 12. Generic Methods

Generic methods declare type parameters before return type.

```java
static <T> T first(List<T> list) {
    return list.get(0);
}
```

## 12.1 Type inference

Compiler infers T:

```java
String s = first(List.of("A", "B"));
```

## 12.2 Multiple params

```java
static <T> List<T> concat(
    List<? extends T> a,
    List<? extends T> b
) {
    List<T> result = new ArrayList<>();
    result.addAll(a);
    result.addAll(b);
    return List.copyOf(result);
}
```

## 12.3 Method type parameter vs class type parameter

Class:

```java
class Repository<T> {}
```

Method:

```java
<T> List<T> parseAll(...)
```

## 12.4 Rule

Use generic methods when type relationship is local to one method.

---

# 13. Bounded Type Parameters

Type parameters can have bounds.

```java
static <T extends Comparable<T>> T max(List<T> values) {
    ...
}
```

## 13.1 Meaning

T must be Comparable to T.

## 13.2 Example

```java
static <T extends Number> double sum(List<T> numbers)
```

## 13.3 Better flexibility

Often:

```java
<T extends Comparable<? super T>>
```

is more flexible.

Because T may be comparable to its supertype.

## 13.4 Domain example

```java
static <ID extends CaseIdentifier> ...
```

## 13.5 Rule

Bounds express required capability of type parameter.

---

# 14. Multiple Bounds

Type parameter can have multiple bounds:

```java
<T extends Closeable & Flushable>
```

Class bound first, then interfaces.

```java
<T extends SomeClass & InterfaceA & InterfaceB>
```

## 14.1 Use case

Require multiple capabilities:

```java
static <T extends Runnable & AutoCloseable> void runAndClose(T task)
```

## 14.2 Collections use case

Rare in application collection APIs, but useful in framework/library code.

## 14.3 Rule

Use multiple bounds when one type must satisfy multiple contracts.

---

# 15. Wildcard vs Type Parameter

## 15.1 Use wildcard when no relationship needed

```java
void printAll(List<?> values)
```

No need to name type.

## 15.2 Use type parameter when relationship needed

```java
static <T> void copy(List<? super T> dest, List<? extends T> src)
```

`T` relates dest and src.

## 15.3 Bad overgeneric

```java
static <T> void printAll(List<T> values)
```

Could be:

```java
static void printAll(List<?> values)
```

## 15.4 Return same type

```java
static <T> T first(List<T> values)
```

Needs T.

## 15.5 Rule

If type variable appears only once, wildcard may be better.

---

# 16. Capture Helper Methods

Sometimes wildcard prevents mutation because type is unknown.

## 16.1 Example

```java
void reverse(List<?> list) {
    reverseHelper(list);
}

private static <T> void reverseHelper(List<T> list) {
    List<T> copy = new ArrayList<>(list);
    Collections.reverse(copy);
    for (int i = 0; i < list.size(); i++) {
        list.set(i, copy.get(i));
    }
}
```

The helper captures unknown wildcard as T.

## 16.2 Why

Compiler can name the unknown type inside helper.

## 16.3 Use cases

Library utilities that accept wildcard but need internal type-safe operations.

## 16.4 Rule

Use private helper methods to capture wildcard when needed.

---

# 17. Return Types and Wildcards

Avoid wildcard return types unless there is strong reason.

## 17.1 Bad

```java
List<? extends Event> events()
```

Caller cannot easily use returned list.

## 17.2 Better

```java
List<Event> events()
```

or specific:

```java
List<CaseEvent> events()
```

## 17.3 Parameter vs return

Wildcards are usually more useful in parameters than returns.

## 17.4 Why

Return type should give caller usable guarantee.

Parameter type should accept flexible inputs.

## 17.5 Rule

Use wildcards for input flexibility, not output ambiguity.

---

# 18. Type Erasure

Java generics use type erasure.

## 18.1 Meaning

Type parameters are erased at runtime to bounds or Object.

```java
List<String>
List<Integer>
```

both are runtime `List`.

## 18.2 Cannot do

```java
if (list instanceof List<String>) { } // illegal
```

## 18.3 Cannot new T

```java
T value = new T(); // illegal
```

Need factory/Supplier/Class<T>.

## 18.4 Cannot know element type

```java
List<T> list
```

does not carry T at runtime.

## 18.5 Bridge methods

Compiler may generate bridge methods to preserve polymorphism with erasure.

## 18.6 Rule

Generics protect compile-time usage; runtime type info is limited.

---

# 19. Reifiable vs Non-Reifiable Types

## 19.1 Reifiable

Type whose runtime representation fully knows type.

Examples:

```java
String
String[]
List raw
List<?>
int
```

## 19.2 Non-reifiable

Type with erased type arguments.

Examples:

```java
List<String>
Map<String, Integer>
T
```

## 19.3 Why matters

Cannot create arrays of non-reifiable type safely.

```java
new List<String>[10] // illegal
```

## 19.4 instanceof

```java
obj instanceof List<?> // ok
obj instanceof List<String> // illegal
```

## 19.5 Rule

Parameterized generic types are generally non-reifiable.

---

# 20. Raw Types

Raw type means using generic class without type argument.

```java
List raw = new ArrayList();
```

## 20.1 Why exists

Backward compatibility with pre-generics Java.

## 20.2 Danger

Compiler loses type safety.

```java
List<String> strings = new ArrayList<>();
List raw = strings;
raw.add(123);
String s = strings.get(0); // ClassCastException
```

## 20.3 Warnings

Raw type usage produces warnings.

Do not ignore.

## 20.4 Boundary exception

Sometimes raw types appear when interacting with old libraries/reflection.

Contain them at boundary.

## 20.5 Rule

Never use raw collections in modern application code except isolated legacy boundaries.

---

# 21. Heap Pollution

Heap pollution occurs when variable of parameterized type refers to object that is not of that parameterized type.

## 21.1 Example

```java
List<String> strings = new ArrayList<>();
List raw = strings;
raw.add(123); // heap pollution
```

Now `strings` contains Integer.

## 21.2 Failure later

```java
String s = strings.get(0); // ClassCastException
```

## 21.3 Generics + varargs can cause heap pollution

Because varargs use arrays and arrays are reified.

## 21.4 Rule

Heap pollution often hides cause and fails later.

---

# 22. Unchecked Warnings

Unchecked warnings indicate compiler cannot fully verify type safety.

Example:

```java
List<String> strings = (List<String>) raw;
```

## 22.1 Why serious

Unchecked warning means potential runtime ClassCastException.

## 22.2 Do not globally suppress

Bad:

```java
@SuppressWarnings("unchecked")
class WholeService { ... }
```

## 22.3 Localize suppression

```java
@SuppressWarnings("unchecked")
List<String> result = (List<String>) raw;
```

But only after validation or trusted invariant.

## 22.4 Rule

Every unchecked warning deserves explanation.

---

# 23. `@SuppressWarnings("unchecked")`

Use only when:

- warning is unavoidable;
- you can prove type safety;
- scope is minimal;
- comment explains invariant.

## 23.1 Good pattern

```java
@SuppressWarnings("unchecked")
private static <T> List<T> castList(Object value, Class<T> elementType) {
    if (!(value instanceof List<?> rawList)) {
        throw new IllegalArgumentException("Expected list");
    }

    for (Object element : rawList) {
        if (!elementType.isInstance(element)) {
            throw new IllegalArgumentException("Invalid element type");
        }
    }

    // Safe after runtime validation.
    return (List<T>) rawList;
}
```

## 23.2 Better

Return copied list:

```java
List<T> result = new ArrayList<>();
for (Object element : rawList) {
    result.add(elementType.cast(element));
}
return List.copyOf(result);
```

No unchecked cast needed.

## 23.3 Rule

Prefer runtime validation + typed copy over unchecked cast.

---

# 24. Generic Arrays Problem

## 24.1 Illegal

```java
List<String>[] array = new List<String>[10];
```

## 24.2 Why

Arrays know component type at runtime; generic parameter `String` is erased.

## 24.3 Alternative

Use list of lists:

```java
List<List<String>> lists = new ArrayList<>();
```

## 24.4 If array required

Use raw/wildcard array carefully:

```java
List<?>[] array = new List<?>[10];
```

But be careful with assignment/use.

## 24.5 Rule

Prefer collections over arrays for parameterized types.

---

# 25. Varargs and Generics

Varargs create arrays.

```java
static <T> List<T> ofAll(T... values) { ... }
```

If T is non-reifiable, warnings can occur.

## 25.1 Heap pollution risk

```java
static void dangerous(List<String>... stringLists) {
    Object[] array = stringLists;
    array[0] = List.of(42);
    String s = stringLists[0].get(0); // ClassCastException
}
```

## 25.2 Safe usage

If method does not write to varargs array or expose it, can be safe.

## 25.3 Rule

Generic varargs require extra caution.

---

# 26. `@SafeVarargs`

`@SafeVarargs` suppresses warnings for methods/constructors that are safe with generic varargs.

Can be used on:

- static methods;
- final instance methods;
- private methods;
- constructors.

## 26.1 Safe if

- method does not write unsafe values into varargs array;
- does not expose varargs array to untrusted code.

## 26.2 Example

```java
@SafeVarargs
static <T> List<T> concatLists(List<? extends T>... lists) {
    List<T> result = new ArrayList<>();
    for (List<? extends T> list : lists) {
        result.addAll(list);
    }
    return List.copyOf(result);
}
```

## 26.3 Rule

Use `@SafeVarargs` only when you understand why method is safe.

---

# 27. Checked Collections

`Collections.checkedList`, `checkedSet`, `checkedMap`, etc. provide runtime type checking wrappers.

## 27.1 Example

```java
List raw = new ArrayList();
List<String> checked = Collections.checkedList(raw, String.class);

checked.add("ok");
((List) checked).add(123); // ClassCastException
```

## 27.2 Use cases

- raw legacy collection boundary;
- plugin API;
- reflection/deserialization boundary;
- debugging heap pollution.

## 27.3 Limitation

Only checks runtime class.

Cannot check nested generics:

```java
List<List<String>>
```

with `List.class` does not verify inner element types.

## 27.4 Rule

Checked collections are runtime guardrails, not replacement for generics.

---

# 28. Collections API Examples: Why Signatures Look Complex

JDK Collections methods often look like this:

```java
static <T> void copy(List<? super T> dest, List<? extends T> src)
```

or:

```java
static <T extends Object & Comparable<? super T>> T max(Collection<? extends T> coll)
```

These are complex because they encode variance and type safety.

## 28.1 Why source extends?

Source produces values.

## 28.2 Why dest super?

Destination consumes values.

## 28.3 Why Comparable super?

Allows T to be comparable to supertypes.

## 28.4 Why Comparator super?

Comparator that can compare supertype of T can compare T.

## 28.5 Rule

Complex generic signatures usually maximize API flexibility while preserving safety.

---

# 29. `Collections.copy`

Signature concept:

```java
static <T> void copy(List<? super T> dest, List<? extends T> src)
```

## 29.1 Why `src extends T`

Source produces T.

Can copy from:

```java
List<Integer>
```

into destination of Number/Object.

## 29.2 Why `dest super T`

Destination consumes T.

Can copy into:

```java
List<Number>
List<Object>
```

## 29.3 Example

```java
List<Integer> ints = List.of(1, 2, 3);
List<Number> nums = new ArrayList<>(List.of(0, 0, 0));

Collections.copy(nums, ints);
```

## 29.4 Destination size

Destination must already be at least as large as source.

## 29.5 Rule

`copy` is PECS in real JDK API.

---

# 30. `Collections.max/min`

Conceptually:

```java
static <T extends Object & Comparable<? super T>> T max(Collection<? extends T> coll)
```

## 30.1 Why collection extends T?

Collection produces candidate values.

## 30.2 Why Comparable super T?

T can be comparable to T or its supertype.

## 30.3 Comparator overload

```java
static <T> T max(Collection<? extends T> coll, Comparator<? super T> comp)
```

## 30.4 Rule

Max/min signatures are designed to accept flexible producer collections and comparators.

---

# 31. `Comparator<? super T>`

Why not just:

```java
Comparator<T>
```

Because comparator of a supertype can compare subtype objects.

## 31.1 Example

```java
Comparator<CharSequence> byLength =
    Comparator.comparingInt(CharSequence::length);

List<String> strings = new ArrayList<>();
strings.sort(byLength); // works because Comparator<? super String>
```

If List.sort required Comparator<String>, this would fail.

## 31.2 Rule

Consumers of T should often be `? super T`.

Comparator consumes two T values, so `Comparator<? super T>` is flexible.

---

# 32. Collectors and Generics

Collectors have complex generic signatures because they model:

- input element type;
- accumulation type;
- result type;
- downstream collectors;
- map suppliers;
- merge functions.

## 32.1 toMap example

```java
<T, K, U> Collector<T, ?, Map<K,U>> toMap(
    Function<? super T, ? extends K> keyMapper,
    Function<? super T, ? extends U> valueMapper
)
```

## 32.2 Why keyMapper super T?

Function consumes T.

A function accepting supertype of T can consume T.

## 32.3 Why extends K?

Function produces K or subtype of K.

## 32.4 groupingBy

Generic signatures encode classifier, downstream, map factory.

## 32.5 Rule

Collector generics follow producer/consumer logic too.

---

# 33. Designing Type-Safe Collection APIs

## 33.1 Accept flexible producers

If only reading from input:

```java
void addEvents(Collection<? extends CaseEvent> events)
```

## 33.2 Accept flexible consumers

If writing to output:

```java
void exportTo(Collection<? super CaseSummary> out)
```

## 33.3 Avoid wildcard returns

Return concrete useful type:

```java
List<CaseEvent> events()
```

not:

```java
List<? extends CaseEvent> events()
```

## 33.4 Use domain types

```java
Set<Permission>
Map<CaseId, CaseSummary>
```

not:

```java
Set<String>
Map<String, Object>
```

where domain semantics matter.

## 33.5 Hide raw/unchecked code

Boundary adapter:

```java
List<CaseId> parseCaseIds(Object raw)
```

internally validates.

## 33.6 Rule

Use wildcards in parameters for flexibility; use precise types in returns for usability.

---

# 34. Domain Modeling with Generics

## 34.1 Typed ID

```java
record CaseId(String value) {}
record UserId(String value) {}
```

Avoid:

```java
Map<String, Object>
```

## 34.2 Generic ID?

```java
record Id<T>(String value) {}
```

Can encode entity type:

```java
Id<Case> caseId;
Id<User> userId;
```

## 34.3 Pros

- prevents mixing IDs;
- reusable.

## 34.4 Cons

- runtime erasure;
- serialization complexity;
- verbose;
- not always worth it.

## 34.5 Generic domain container

```java
record Page<T>(List<T> items, int page, int size, long total) {
    Page {
        items = List.copyOf(items);
    }
}
```

## 34.6 Generic result

```java
sealed interface Result<T, E> {}
```

## 34.7 Rule

Use generics to encode reusable structure, not to make domain unreadable.

---

# 35. Generics and Runtime Boundaries

Generic type info is limited at runtime.

## 35.1 JSON deserialization

Deserializing:

```java
List<CaseSummary>
```

often requires type token/type reference in frameworks.

## 35.2 Reflection

`Class<List<CaseSummary>>` does not work normally because class literal cannot represent parameterized type.

Use framework-specific `TypeReference`.

## 35.3 Runtime validation

If input is raw Object:

```java
Object raw
```

validate elements manually or via framework.

## 35.4 Checked wrapper limitation

Cannot deeply validate nested generic types.

## 35.5 Rule

At runtime boundaries, generics are not enough; validate and map to typed domain.

---

# 36. Production Failure Modes

## 36.1 Raw List pollution

Raw list inserts wrong type, ClassCastException later.

Fix: no raw types; checked wrapper at legacy boundary.

## 36.2 Wrong wildcard

API takes `List<Base>` so callers cannot pass `List<Sub>`.

Fix: `List<? extends Base>` for producer input.

## 36.3 Cannot add to extends list

Developer confused by `List<? extends T>`.

Fix: use `? super T` for destination.

## 36.4 Wildcard return unusable

Caller cannot add/use specific type easily.

Fix: precise return type.

## 36.5 Suppressed warning hides bug

Fix: localize suppression and validate.

## 36.6 Generic varargs heap pollution

Fix: avoid or use `@SafeVarargs` only when safe.

## 36.7 Generic array creation workaround unsafe

Fix: use collections or explicit array factory.

## 36.8 `ClassCastException` far from source

Heap pollution inserted earlier.

Fix: compile-time generics + boundary validation.

## 36.9 Nested generic unchecked cast

```java
(List<List<String>>) raw
```

not deeply safe.

Fix: validate recursively or parse with type token.

## 36.10 Comparator type too narrow

API demands `Comparator<T>` and rejects `Comparator<Super>`.

Fix: `Comparator<? super T>`.

## 36.11 Copy API too narrow

```java
void copy(List<T> dest, List<T> src)
```

cannot copy Integer to Number.

Fix: PECS signature.

## 36.12 Type erasure misconception

Expecting runtime to know `List<CaseId>`.

Fix: pass `Class<T>`/type token where needed.

---

# 37. Best Practices

## 37.1 General

- Avoid raw types.
- Treat unchecked warnings as real problems.
- Use `List<?>` when type does not matter.
- Use `? extends T` for producer/source parameters.
- Use `? super T` for consumer/destination parameters.
- Avoid wildcard return types.
- Use bounded type parameters for required capabilities.
- Use helper methods for wildcard capture.
- Prefer typed domain wrappers.

## 37.2 Suppression

- Keep `@SuppressWarnings("unchecked")` as narrow as possible.
- Add comment explaining invariant.
- Prefer runtime validation and typed copy.

## 37.3 API

- Parameters can be flexible.
- Returns should be precise.
- Use `Comparator<? super T>`.
- Use `Collection<? extends T>` for addAll-like inputs.
- Use `Collection<? super T>` for output sinks.

## 37.4 Runtime boundary

- Validate raw data.
- Use type tokens/framework support for nested generics.
- Do not trust generic type at runtime after deserialization.

---

# 38. Decision Matrix

| Need | Recommended |
|---|---|
| print/read any list | `List<?>` |
| read numbers from list | `List<? extends Number>` |
| add integers to list | `List<? super Integer>` |
| copy source to dest | `<T> dest: List<? super T>, src: List<? extends T>` |
| sort list | `Comparator<? super T>` |
| return domain list | `List<DomainType>` |
| accept subtypes | `Collection<? extends Base>` |
| output sink | `Collection<? super Result>` |
| type relationship between params | generic method `<T>` |
| unknown raw boundary | validate + typed copy |
| legacy raw collection | checked wrapper |
| runtime element type needed | `Class<T>` or type token |
| generic varargs | avoid or use `@SafeVarargs` if safe |
| generic arrays | prefer collections |
| nested generic deserialization | framework TypeReference/type token |

---

# 39. Latihan

## Latihan 1 — Invariance

Why does this fail?

```java
List<String> strings = List.of("A");
List<Object> objects = strings;
```

Explain with counterexample.

## Latihan 2 — Producer Extends

Write method:

```java
double sum(Collection<? extends Number> numbers)
```

Call with List<Integer>, List<Double>, List<BigDecimal>.

## Latihan 3 — Consumer Super

Write method:

```java
void addDefaults(Collection<? super Permission> out)
```

Call with Collection<Permission> and Collection<Object>.

## Latihan 4 — Copy Signature

Implement:

```java
static <T> void copyTo(Collection<? super T> dest, Iterable<? extends T> src)
```

## Latihan 5 — Wildcard Return Smell

Refactor:

```java
List<? extends Event> events()
```

into more usable API.

## Latihan 6 — Raw Type Pollution

Create raw List pollution and show ClassCastException later.

Then fix with generics.

## Latihan 7 — Checked Wrapper

Protect raw list with `Collections.checkedList`.

## Latihan 8 — Generic Varargs

Write safe concat method:

```java
@SafeVarargs
static <T> List<T> concat(List<? extends T>... lists)
```

Explain why safe.

## Latihan 9 — Capture Helper

Implement reverse for `List<?>` using helper method.

## Latihan 10 — Type Token Boundary

Design method:

```java
static <T> List<T> castList(Object raw, Class<T> type)
```

that validates all elements and returns immutable copy.

---

# 40. Ringkasan

Collections and Generics are the type-safety backbone of Java collection design.

Core lessons:

- Generics move type errors from runtime to compile time.
- `List<String>` is not `List<Object>` because generics are invariant.
- Arrays are covariant and runtime-checked; generics are invariant and erased.
- `?` means unknown type.
- `? extends T` is for producer/source/read.
- `? super T` is for consumer/destination/write.
- PECS: Producer Extends, Consumer Super.
- Use generic methods when type relationships matter.
- Use bounded type parameters for required capabilities.
- Prefer wildcards in parameters, precise types in returns.
- Type erasure limits runtime generic type info.
- Raw types cause heap pollution.
- Unchecked warnings must be handled deliberately.
- Generic arrays and generic varargs are tricky.
- Checked wrappers help at raw legacy boundaries.
- JDK Collections signatures are complex to maximize flexibility safely.
- Runtime boundaries still need validation/type tokens.

Main rule:

```text
Use generics not to make code clever,
but to make invalid collection states impossible to express.
```

---

# 41. Referensi

1. Oracle Java Tutorials — Generic Types  
   https://docs.oracle.com/javase/tutorial/java/generics/types.html

2. Oracle Java Tutorials — Wildcards  
   https://docs.oracle.com/javase/tutorial/java/generics/wildcards.html

3. dev.java — Generics  
   https://dev.java/learn/generics/

4. Java SE 25 — `Collections`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html

5. Java SE 25 — `Collection`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html

6. Java SE 25 — `List`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html

7. Java SE 25 — `Comparator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html

8. Java Language Specification — Type Erasure, Reifiable Types, Raw Types  
   https://docs.oracle.com/javase/specs/jls/se17/html/jls-4.html

9. Java SE 25 — `ClassCastException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassCastException.html

10. Java SE 25 — `SafeVarargs`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/SafeVarargs.html
