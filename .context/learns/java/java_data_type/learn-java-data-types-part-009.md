# learn-java-data-types-part-009.md

# Java Data Types — Part 009  
# Arrays: Type, Covariance, Memory, Performance, Copying, dan Varargs

> Seri: **Advanced Java Data Types**  
> Bagian: **009**  
> Fokus: memahami array Java sebagai reference type yang punya sifat unik: fixed length, mutable, reified component type, covariance, runtime store check, `ArrayStoreException`, primitive vs object array, multidimensional/jagged arrays, copying, sorting/searching, varargs, heap pollution, defensive copy, memory/performance, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Array dalam Java Type System](#2-array-dalam-java-type-system)
3. [Mental Model: Array adalah Object, Bukan Primitive](#3-mental-model-array-adalah-object-bukan-primitive)
4. [Deklarasi dan Inisialisasi Array](#4-deklarasi-dan-inisialisasi-array)
5. [Fixed Length dan Mutable Elements](#5-fixed-length-dan-mutable-elements)
6. [Array Component Type](#6-array-component-type)
7. [Primitive Array vs Reference Array](#7-primitive-array-vs-reference-array)
8. [Default Values dalam Array](#8-default-values-dalam-array)
9. [Array Index, Bounds Check, dan `ArrayIndexOutOfBoundsException`](#9-array-index-bounds-check-dan-arrayindexoutofboundsexception)
10. [Array Covariance](#10-array-covariance)
11. [`ArrayStoreException`](#11-arraystoreexception)
12. [Reified Array Type vs Erased Generics](#12-reified-array-type-vs-erased-generics)
13. [Kenapa `new T[]` Tidak Boleh dalam Generic Code](#13-kenapa-new-t-tidak-boleh-dalam-generic-code)
14. [Multidimensional Arrays: Array of Arrays](#14-multidimensional-arrays-array-of-arrays)
15. [Jagged Arrays](#15-jagged-arrays)
16. [Array Equality, Hashing, dan String Representation](#16-array-equality-hashing-dan-string-representation)
17. [`java.util.Arrays`](#17-javautilarrays)
18. [`System.arraycopy`](#18-systemarraycopy)
19. [`Arrays.copyOf` dan `copyOfRange`](#19-arrayscopyof-dan-copyofrange)
20. [Sorting Arrays](#20-sorting-arrays)
21. [Searching Arrays](#21-searching-arrays)
22. [Filling, Comparing, Mismatch, dan Prefix Operations](#22-filling-comparing-mismatch-dan-prefix-operations)
23. [Array to List: `Arrays.asList` Trap](#23-array-to-list-arraysaslist-trap)
24. [Varargs: Array di Balik Parameter Fleksibel](#24-varargs-array-di-balik-parameter-fleksibel)
25. [Varargs + Generics = Heap Pollution](#25-varargs--generics--heap-pollution)
26. [`@SafeVarargs`](#26-safevarargs)
27. [Reflection Array: `java.lang.reflect.Array`](#27-reflection-array-javalangreflectarray)
28. [Defensive Copy dan Representation Exposure](#28-defensive-copy-dan-representation-exposure)
29. [Arrays dalam Records dan Value Objects](#29-arrays-dalam-records-dan-value-objects)
30. [Memory Layout dan Performance](#30-memory-layout-dan-performance)
31. [Bounds Check Elimination dan Hot Loops](#31-bounds-check-elimination-dan-hot-loops)
32. [Arrays vs Collections](#32-arrays-vs-collections)
33. [Arrays vs ByteBuffer/Off-Heap/Native Memory](#33-arrays-vs-bytebufferoff-heapnative-memory)
34. [Security dan Sensitive Arrays](#34-security-dan-sensitive-arrays)
35. [Production Failure Modes](#35-production-failure-modes)
36. [Best Practices](#36-best-practices)
37. [Decision Matrix](#37-decision-matrix)
38. [Latihan](#38-latihan)
39. [Ringkasan](#39-ringkasan)
40. [Referensi](#40-referensi)

---

# 1. Tujuan Bagian Ini

Array adalah salah satu data structure paling dasar di Java.

Banyak engineer memakai array setiap hari:

```java
String[] args
byte[] payload
int[] values
Object[] parameters
```

Tetapi array Java punya sifat yang tidak selalu intuitif:

- array adalah object/reference type;
- array length fixed;
- elements mutable;
- primitive array dan object array berbeda drastis;
- reference arrays covariant;
- array component type reified di runtime;
- generics erased, arrays reified;
- `Object[] objects = new String[10]` compile tetapi bisa runtime fail;
- `record Digest(byte[] bytes)` punya equality trap;
- `Arrays.asList(int[])` tidak menghasilkan `List<Integer>`;
- varargs sebenarnya array;
- varargs generic bisa menyebabkan heap pollution;
- defensive copy wajib untuk mutable arrays;
- `byte[]` bisa bocor dan dimutasi dari luar;
- large arrays memengaruhi memory/GC/performance.

Bagian ini akan membahas array dari level bahasa, runtime, API, domain design, performance, dan production failure.

---

# 2. Array dalam Java Type System

Array adalah reference type.

Contoh:

```java
int[] numbers = new int[10];
String[] names = new String[5];
Object value = numbers;
```

`numbers` adalah variable reference type `int[]`.

Object array-nya berada di heap secara konseptual.

## 2.1 Array type

Array type ditulis:

```java
componentType[]
```

Examples:

```java
int[]
long[]
String[]
Object[]
List<String>[]
int[][]
String[][]
```

## 2.2 Array component type

Untuk:

```java
String[] names;
```

component type adalah:

```text
String
```

Untuk:

```java
int[][] matrix;
```

component type dari `int[][]` adalah:

```text
int[]
```

karena multidimensional array di Java adalah array of arrays.

## 2.3 Array object punya length

```java
numbers.length
```

`length` bukan method. Itu final field-like property khusus array.

```java
numbers.length()
```

tidak valid.

---

# 3. Mental Model: Array adalah Object, Bukan Primitive

```java
int[] a = {1, 2, 3};
int[] b = a;

b[0] = 99;

System.out.println(a[0]); // 99
```

`a` dan `b` mereferensikan array object yang sama.

## 3.1 Reference assignment

```java
int[] b = a;
```

tidak menyalin isi array. Hanya menyalin reference.

Untuk menyalin isi:

```java
int[] b = a.clone();
```

atau:

```java
int[] b = Arrays.copyOf(a, a.length);
```

## 3.2 Array mutability

Array length fixed, tetapi elements mutable.

```java
final int[] values = {1, 2, 3};
values[0] = 99; // allowed
```

`final` mencegah variable reassignment, bukan mutasi array.

## 3.3 Array identity

Array tidak override `equals`.

```java
int[] x = {1, 2};
int[] y = {1, 2};

x.equals(y) // false
```

Gunakan:

```java
Arrays.equals(x, y)
```

---

# 4. Deklarasi dan Inisialisasi Array

## 4.1 Declaration

```java
int[] values;
String[] names;
```

Java juga mengizinkan gaya C:

```java
int values[];
```

Tetapi Java style lebih umum:

```java
int[] values;
```

Karena type-nya adalah `int[]`.

## 4.2 Creation

```java
int[] values = new int[10];
String[] names = new String[5];
```

Length harus non-negative.

```java
new int[-1]; // NegativeArraySizeException
```

## 4.3 Initializer

```java
int[] values = {1, 2, 3};
String[] names = {"A", "B"};
```

Equivalent:

```java
int[] values = new int[] {1, 2, 3};
```

## 4.4 Anonymous array

```java
process(new int[] {1, 2, 3});
```

## 4.5 Array of reference objects

```java
String[] names = new String[3];
```

Creates array of length 3 with all elements `null`.

It does not create String objects.

---

# 5. Fixed Length dan Mutable Elements

Array length cannot change.

```java
int[] values = new int[3];
values.length // 3
```

Tidak ada:

```java
values.add(4)
values.remove(0)
```

Untuk dynamic size, gunakan collection:

```java
ArrayList<Integer>
```

atau manual grow array.

## 5.1 Grow array manually

```java
int[] old = {1, 2, 3};
int[] grown = Arrays.copyOf(old, old.length + 1);
grown[3] = 4;
```

## 5.2 ArrayList internally uses array

`ArrayList` memakai array internal yang bisa tumbuh dengan membuat array baru dan copy.

## 5.3 Fixed length can be feature

Array fixed length cocok untuk:

- protocol frame;
- fixed-size buffer;
- matrix;
- lookup table;
- memory-sensitive numeric data;
- high-performance hot path.

## 5.4 Mutable elements risk

Even if array reference is private final:

```java
private final byte[] digest;
```

contents can change if exposed.

Use defensive copy.

---

# 6. Array Component Type

Array knows its component type at runtime.

```java
String[] names = new String[3];

System.out.println(names.getClass());
System.out.println(names.getClass().getComponentType());
```

Typical:

```text
class [Ljava.lang.String;
class java.lang.String
```

## 6.1 Primitive component

```java
int[] values = new int[3];
values.getClass().getComponentType(); // int
```

## 6.2 Runtime type matters

Array store checks use runtime component type.

```java
Object[] objects = new String[3];
objects[0] = Integer.valueOf(1); // runtime check fails
```

## 6.3 Component type and reflection

```java
Array.newInstance(componentType, length)
```

creates array with runtime component type.

## 6.4 Component type and covariance

Reference arrays support covariance based on component type hierarchy.

More on that soon.

---

# 7. Primitive Array vs Reference Array

## 7.1 Primitive array

```java
int[] values = new int[1_000_000];
```

Stores primitive values directly in array storage.

Benefits:

- compact;
- no per-element object;
- no null;
- cache-friendly;
- less GC pressure.

## 7.2 Reference array

```java
Integer[] values = new Integer[1_000_000];
```

Stores references.

Elements initially null.

If filled with `Integer`, each element points to wrapper object unless cached/reused.

## 7.3 Object array

```java
Object[] objects = new Object[10];
```

Can store references to any object compatible with runtime component type `Object`.

## 7.4 `int[]` is not `Integer[]`

```java
int[] primitive = {1, 2, 3};
Integer[] boxed = {1, 2, 3};
```

They are completely different array types.

## 7.5 No array covariance between primitive and wrapper

```java
Object[] o = new int[3]; // compile error
Object obj = new int[3]; // ok
```

Primitive array is object, but not Object[].

## 7.6 Use cases

| Need | Use |
|---|---|
| raw bytes | `byte[]` |
| large numeric data | `int[]`, `long[]`, `double[]` |
| object references | `T[]` |
| nullable elements | reference array |
| dynamic size | collection |
| generic API | collection or `T[]` carefully |

---

# 8. Default Values dalam Array

Array elements are initialized to default values.

| Component type | Default |
|---|---|
| `boolean` | `false` |
| `byte`, `short`, `int`, `long` | `0` |
| `char` | `'\u0000'` |
| `float` | `0.0f` |
| `double` | `0.0d` |
| reference | `null` |

Example:

```java
int[] xs = new int[3];       // [0,0,0]
boolean[] bs = new boolean[2]; // [false,false]
String[] ss = new String[2]; // [null,null]
```

## 8.1 Default can hide bugs

```java
int[] scores = new int[10];
```

Is 0 valid score or uninitialized?

If uninitialized must be detected, use:

- sentinel value with care;
- wrapper array `Integer[]`;
- separate boolean initialized array;
- domain object;
- collection with actual size;
- fill with invalid marker.

## 8.2 Arrays.fill

```java
Arrays.fill(scores, -1);
```

But sentinel values can be dangerous if domain later allows `-1`.

## 8.3 Reference arrays and NPE

```java
String[] names = new String[3];
names[0].length(); // NPE
```

Initialize elements before use.

---

# 9. Array Index, Bounds Check, dan `ArrayIndexOutOfBoundsException`

Array index starts at 0.

Valid indexes:

```text
0 to length - 1
```

## 9.1 Bounds check

```java
int[] values = {1, 2, 3};

values[3] // ArrayIndexOutOfBoundsException
values[-1] // ArrayIndexOutOfBoundsException
```

## 9.2 Bounds check is safety feature

Java prevents memory corruption by checking array bounds.

This is major safety difference from languages with unchecked raw array access.

## 9.3 Performance concern

JIT can eliminate bounds checks in many loops if it proves indexes safe.

Example:

```java
for (int i = 0; i < values.length; i++) {
    sum += values[i];
}
```

This pattern is optimizer-friendly.

## 9.4 Loop correctness

Good:

```java
for (int i = 0; i < values.length; i++) {}
```

Bad:

```java
for (int i = 0; i <= values.length; i++) {}
```

off-by-one.

## 9.5 Index type

Array index is `int`, not `long`.

Max array length is limited by int and JVM memory constraints.

For data larger than int indexing, use chunking, off-heap, files, database, or specialized structures.

---

# 10. Array Covariance

Java reference arrays are covariant.

If:

```java
String extends Object
```

then:

```java
String[] extends Object[]
```

Example:

```java
String[] strings = new String[3];
Object[] objects = strings;
```

This compiles.

## 10.1 Why dangerous?

```java
objects[0] = Integer.valueOf(1);
```

Compile-time type `Object[]` permits storing Integer.

Runtime actual array is `String[]`, so JVM throws `ArrayStoreException`.

## 10.2 Why Java allows it?

Historical design for flexibility before generics existed.

It is type-safe only because runtime store check exists.

## 10.3 Generics are invariant

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings; // compile error
```

Generics avoid this runtime store failure by rejecting at compile time.

## 10.4 Prefer collections/generics for type-safe APIs

If you need producer/consumer variance, use generics wildcards:

```java
List<? extends CharSequence>
List<? super String>
```

not array covariance.

---

# 11. `ArrayStoreException`

`ArrayStoreException` is thrown when storing wrong type into object array.

Example:

```java
Object[] objects = new String[3];
objects[0] = Integer.valueOf(42); // ArrayStoreException
```

## 11.1 Runtime type check

Array runtime type is `String[]`.

Each store checks assignment compatibility with component type `String`.

## 11.2 Only reference arrays

Primitive arrays cannot have this kind of covariance:

```java
Object[] o = new int[3]; // compile error
```

## 11.3 Production scenario

Framework method:

```java
void fill(Object[] target) {
    target[0] = someObject;
}
```

Caller passes:

```java
String[] target = new String[10];
fill(target);
```

Potential runtime failure.

## 11.4 API rule

If method accepts `Object[]`, it should be clear what element types it may store.

If method only reads, use:

```java
Object[] source
```

or better generic:

```java
<T> void read(T[] source)
```

If method writes, be very careful.

---

# 12. Reified Array Type vs Erased Generics

Arrays are reified:

```text
runtime knows component type
```

Generics are erased:

```text
runtime does not fully know T
```

## 12.1 Array runtime type

```java
String[] names = new String[3];
names.getClass().getComponentType() // String.class
```

## 12.2 Generic runtime type

```java
List<String> names = new ArrayList<>();
```

At runtime, list object does not carry `String` element type in the same direct way.

## 12.3 Consequence

Arrays enforce store type at runtime.

Generics enforce mostly at compile time, with unchecked warnings when type safety cannot be proven.

## 12.4 Heap pollution

Heap pollution occurs when variable of parameterized type refers to object not of that parameterized type.

Example through raw types or generic varargs.

## 12.5 Array of parameterized types

```java
List<String>[] array = new List<String>[10]; // compile error
```

Because array would need runtime component type `List<String>`, but generics erased.

---

# 13. Kenapa `new T[]` Tidak Boleh dalam Generic Code

Generic type parameter `T` is erased at runtime.

```java
class Box<T> {
    T[] values = new T[10]; // compile error
}
```

At runtime JVM does not know actual T component type.

## 13.1 Workaround with generator

```java
@SuppressWarnings("unchecked")
T[] values = (T[]) new Object[10];
```

Dangerous; can cause ClassCastException or heap pollution if exposed.

## 13.2 Workaround with IntFunction

```java
public static <T> T[] copyToArray(List<T> list, IntFunction<T[]> arrayFactory) {
    T[] array = arrayFactory.apply(list.size());
    return list.toArray(array);
}
```

Usage:

```java
String[] arr = copyToArray(list, String[]::new);
```

## 13.3 Workaround with Class<T>

```java
@SuppressWarnings("unchecked")
T[] array = (T[]) Array.newInstance(componentType, size);
```

## 13.4 Prefer collections internally

For generic containers, use:

```java
List<T>
Object[] internal
```

carefully encapsulated.

`ArrayList` internally uses Object[] but hides it behind generics.

## 13.5 Never expose unsafe generic arrays

If you use Object[] internally, don't return it as T[] unless safely created with component type.

---

# 14. Multidimensional Arrays: Array of Arrays

Java multidimensional arrays are arrays whose elements are arrays.

```java
int[][] matrix = new int[3][4];
```

This creates:

```text
int[][] outer array length 3
each element references int[] length 4
```

## 14.1 Not contiguous 2D block necessarily

Unlike some languages, Java 2D array is not one flat rectangular memory block.

It is array of references to row arrays.

## 14.2 Access

```java
matrix[row][col]
```

Equivalent:

```java
int[] rowArray = matrix[row];
int value = rowArray[col];
```

## 14.3 Null rows possible

```java
int[][] matrix = new int[3][];
matrix[0] = new int[4];
matrix[1] = null;
```

`matrix[1][0]` causes NPE.

## 14.4 Rectangular initialization

```java
int[][] matrix = new int[3][4];
```

All rows initialized to length 4.

## 14.5 Performance

2D array has extra indirection per row.

For dense numeric matrix, a flat array can be faster:

```java
double[] matrix = new double[rows * cols];

double get(int r, int c) {
    return matrix[r * cols + c];
}
```

This improves locality and reduces object overhead.

---

# 15. Jagged Arrays

Jagged array means rows have different lengths.

```java
int[][] triangle = new int[3][];
triangle[0] = new int[1];
triangle[1] = new int[2];
triangle[2] = new int[3];
```

## 15.1 Useful for variable-length rows

Examples:

- adjacency lists;
- triangular matrices;
- grouped data;
- sparse-ish structures;
- parsed records.

## 15.2 Iteration

```java
for (int r = 0; r < triangle.length; r++) {
    int[] row = triangle[r];
    for (int c = 0; c < row.length; c++) {
        ...
    }
}
```

## 15.3 Null row policy

Decide whether null rows allowed.

Prefer empty arrays over null rows:

```java
triangle[i] = new int[0];
```

## 15.4 Deep copy

For 2D arrays:

```java
int[][] copy = new int[original.length][];
for (int i = 0; i < original.length; i++) {
    copy[i] = original[i].clone();
}
```

`original.clone()` copies only outer array, not inner arrays.

---

# 16. Array Equality, Hashing, dan String Representation

Arrays inherit Object equals/hashCode/toString.

## 16.1 Equals

```java
int[] a = {1, 2};
int[] b = {1, 2};

a.equals(b) // false
```

Use:

```java
Arrays.equals(a, b)
```

## 16.2 Deep equals

```java
Object[] a = {new int[]{1, 2}};
Object[] b = {new int[]{1, 2}};

Arrays.deepEquals(a, b)
```

## 16.3 Hash code

```java
Arrays.hashCode(a)
Arrays.deepHashCode(a)
```

## 16.4 toString

```java
int[] a = {1, 2};
System.out.println(a); // [I@...
```

Use:

```java
Arrays.toString(a)
Arrays.deepToString(a)
```

## 16.5 Record trap

```java
record Digest(byte[] bytes) {}
```

Generated equals/hashCode/toString use array reference behavior.

Need custom implementation for value semantics.

---

# 17. `java.util.Arrays`

`Arrays` provides utility methods for manipulating arrays, including:

- sort;
- parallelSort;
- binarySearch;
- equals;
- deepEquals;
- compare;
- mismatch;
- fill;
- copyOf;
- copyOfRange;
- asList;
- stream;
- setAll;
- parallelSetAll;
- parallelPrefix.

Java SE 25 API states `Arrays` contains methods for manipulating arrays such as sorting/searching and a static factory to view arrays as lists. Most methods throw `NullPointerException` if array reference is null unless noted.

## 17.1 Examples

```java
Arrays.sort(values);
Arrays.equals(a, b);
Arrays.copyOf(values, newLength);
Arrays.fill(values, -1);
Arrays.toString(values);
```

## 17.2 Static utility style

`Arrays` is final utility class.

No instance needed.

## 17.3 Null handling

Most methods throw NPE for null array reference.

```java
Arrays.sort(null); // NPE
```

Validate before call if null possible.

---

# 18. `System.arraycopy`

`System.arraycopy` copies elements from source array to destination array.

Signature:

```java
System.arraycopy(Object src, int srcPos, Object dest, int destPos, int length)
```

## 18.1 Example

```java
int[] src = {1, 2, 3, 4};
int[] dest = new int[4];

System.arraycopy(src, 1, dest, 0, 2);

System.out.println(Arrays.toString(dest)); // [2,3,0,0]
```

## 18.2 Native/optimized

`arraycopy` is highly optimized by JVM.

Use for bulk copying.

## 18.3 Overlapping copy

`System.arraycopy` handles overlapping regions correctly as if using temporary copy in relevant cases.

Example:

```java
int[] a = {1, 2, 3, 4, 5};
System.arraycopy(a, 0, a, 1, 4);
System.out.println(Arrays.toString(a)); // [1,1,2,3,4]
```

## 18.4 Type checks

If copying reference arrays and element not compatible with destination runtime component type, `ArrayStoreException` can occur.

## 18.5 Exceptions

Can throw:

- NullPointerException;
- ArrayStoreException;
- IndexOutOfBoundsException;
- ArrayIndexOutOfBoundsException depending scenario;
- ArrayStoreException for incompatible array types/elements.

Use carefully in low-level code.

---

# 19. `Arrays.copyOf` dan `copyOfRange`

## 19.1 copyOf

```java
int[] copy = Arrays.copyOf(original, original.length);
```

Can resize:

```java
int[] bigger = Arrays.copyOf(original, original.length + 10);
```

Extra elements default-initialized.

## 19.2 copyOfRange

```java
int[] slice = Arrays.copyOfRange(original, fromInclusive, toExclusive);
```

## 19.3 Shallow copy for reference arrays

```java
Person[] copy = Arrays.copyOf(people, people.length);
```

Copies references, not Person objects.

If Person mutable, both arrays refer same objects.

## 19.4 Deep copy

Need custom logic:

```java
Person[] copy = Arrays.stream(people)
    .map(Person::copy)
    .toArray(Person[]::new);
```

## 19.5 Defensive copy

For arrays in value objects:

```java
this.bytes = Arrays.copyOf(bytes, bytes.length);
```

or:

```java
bytes.clone()
```

---

# 20. Sorting Arrays

## 20.1 Primitive sort

```java
int[] values = {3, 1, 2};
Arrays.sort(values);
```

Sorts in ascending numeric order.

## 20.2 Object array sort

```java
String[] names = {"b", "a"};
Arrays.sort(names);
```

Uses natural ordering.

## 20.3 Comparator

```java
CaseSummary[] cases = ...;
Arrays.sort(cases, Comparator.comparing(CaseSummary::createdAt));
```

## 20.4 parallelSort

```java
Arrays.parallelSort(values);
```

May improve for large arrays, but overhead may not be worth for small arrays.

Benchmark with real data.

## 20.5 Stability

Object sort in Java uses stable sort for `Arrays.sort(Object[])` in modern Java API. Primitive sort stability irrelevant because primitives have no identity.

## 20.6 Sorting nulls

Object array sorting with natural order fails if null elements present.

Use comparator:

```java
Arrays.sort(names, Comparator.nullsLast(String::compareTo));
```

## 20.7 Sorting with locale

Use Collator:

```java
Collator collator = Collator.getInstance(locale);
Arrays.sort(names, collator);
```

---

# 21. Searching Arrays

## 21.1 binarySearch

```java
int index = Arrays.binarySearch(values, target);
```

Array must be sorted according to same ordering.

If not found, returns negative insertion point encoding:

```text
-(insertionPoint) - 1
```

## 21.2 Example

```java
int[] values = {1, 3, 5};
int r = Arrays.binarySearch(values, 4); // -3
int insertionPoint = -r - 1; // 2
```

## 21.3 Object binary search

```java
Arrays.binarySearch(names, "Fajar")
```

or with comparator:

```java
Arrays.binarySearch(cases, key, comparator)
```

## 21.4 Common bug

Sorting with one comparator, searching with another comparator or natural order.

Must match.

## 21.5 Duplicates

If duplicates exist, binarySearch does not guarantee first/last duplicate index.

If first/last needed, implement lower/upper bound.

---

# 22. Filling, Comparing, Mismatch, dan Prefix Operations

## 22.1 fill

```java
Arrays.fill(values, -1);
Arrays.fill(values, from, to, 0);
```

For reference arrays:

```java
Arrays.fill(objects, sameObject);
```

All elements refer to same object.

Beware if object mutable.

## 22.2 setAll

```java
Arrays.setAll(values, i -> i * i);
```

For primitive arrays too:

```java
Arrays.setAll(intArray, i -> i * i);
```

## 22.3 parallelSetAll

Parallel version for large arrays.

## 22.4 compare

Arrays has lexicographic compare methods.

```java
Arrays.compare(a, b)
```

## 22.5 mismatch

```java
int index = Arrays.mismatch(a, b);
```

Returns first mismatch index or -1 if no mismatch.

Useful for binary comparisons.

## 22.6 parallelPrefix

Computes prefix operation.

```java
Arrays.parallelPrefix(values, Integer::sum);
```

Advanced numeric/parallel use case.

---

# 23. Array to List: `Arrays.asList` Trap

## 23.1 Reference array

```java
String[] arr = {"a", "b"};
List<String> list = Arrays.asList(arr);
```

Returns fixed-size list backed by array.

```java
list.set(0, "x"); // ok, updates array
list.add("c");    // UnsupportedOperationException
```

## 23.2 Backed by array

```java
arr[0] = "z";
System.out.println(list.get(0)); // z
```

## 23.3 Primitive array trap

```java
int[] arr = {1, 2, 3};
List<int[]> list = Arrays.asList(arr);
```

This creates a list with one element: the `int[]`.

Not `List<Integer>`.

To box:

```java
List<Integer> list = Arrays.stream(arr)
    .boxed()
    .toList();
```

## 23.4 `List.of` with primitive array

```java
List<int[]> list = List.of(arr);
```

same conceptual issue: one int[] element.

## 23.5 Mutable vs unmodifiable

If you need independent mutable list:

```java
List<String> list = new ArrayList<>(Arrays.asList(arr));
```

If unmodifiable snapshot:

```java
List<String> list = List.copyOf(Arrays.asList(arr));
```

---

# 24. Varargs: Array di Balik Parameter Fleksibel

Varargs syntax:

```java
void log(String message, Object... args) {}
```

Compiler creates array for varargs arguments.

```java
log("x", 1, "a");
```

Conceptually:

```java
log("x", new Object[] {Integer.valueOf(1), "a"});
```

## 24.1 Varargs parameter is array

Inside method:

```java
args.length
args[0]
```

## 24.2 Passing existing array

```java
Object[] arr = {1, "a"};
log("x", arr);
```

Passes array as varargs array.

## 24.3 Passing array as single argument

If you want array itself as one Object argument:

```java
log("x", (Object) arr);
```

## 24.4 Varargs allocation

Varargs can allocate array at call site.

In hot path/logging, this can matter.

Logging frameworks often avoid work if disabled, but varargs array may still be created depending call/API/JIT.

## 24.5 Varargs and mutation

Method can mutate varargs array:

```java
void f(String... values) {
    values[0] = "changed";
}
```

If caller passed existing array, caller sees mutation.

Do not mutate varargs unless documented.

---

# 25. Varargs + Generics = Heap Pollution

Generic varargs can be unsafe because varargs are arrays, and arrays are reified while generics are erased.

Example:

```java
static void dangerous(List<String>... lists) {
    Object[] array = lists;
    array[0] = List.of(123); // heap pollution
    String s = lists[0].get(0); // ClassCastException
}
```

## 25.1 Compiler warning

You may see:

```text
Possible heap pollution from parameterized vararg type
```

## 25.2 Why?

`List<String>...` is actually an array of raw-ish `List` at runtime. The runtime cannot enforce `List<String>` element type.

## 25.3 Avoid exposing generic varargs

Prefer:

```java
List<List<String>>
```

instead of:

```java
List<String>...
```

for public APIs if safety unclear.

## 25.4 Safe cases

Generic varargs can be safe if method:

- does not write to varargs array;
- does not expose array to untrusted code;
- only reads values safely;
- does not store array where heap pollution can occur.

Use `@SafeVarargs` only when you understand why it is safe.

---

# 26. `@SafeVarargs`

`@SafeVarargs` suppresses unchecked warnings for safe generic varargs methods/constructors.

Can be used on:

- static methods;
- final instance methods;
- private instance methods;
- constructors.

Example:

```java
@SafeVarargs
static <T> List<T> concat(List<? extends T>... lists) {
    List<T> result = new ArrayList<>();
    for (List<? extends T> list : lists) {
        result.addAll(list);
    }
    return List.copyOf(result);
}
```

This is safe if it does not write unsafe values into `lists` array or expose it.

## 26.1 Do not use as warning duct tape

Bad:

```java
@SafeVarargs
static <T> void unsafe(List<T>... lists) {
    Object[] array = lists;
    array[0] = List.of("wrong");
}
```

Annotation is a promise. Do not lie.

## 26.2 Prefer collection parameter

Often better:

```java
static <T> List<T> concat(Collection<? extends List<? extends T>> lists)
```

or:

```java
static <T> List<T> concat(List<? extends T> first, List<? extends T> second)
```

depending API.

---

# 27. Reflection Array: `java.lang.reflect.Array`

Reflection API supports arrays dynamically.

## 27.1 Create array dynamically

```java
Object array = Array.newInstance(String.class, 10);
Array.set(array, 0, "hello");
String value = (String) Array.get(array, 0);
```

## 27.2 Primitive arrays

```java
Object array = Array.newInstance(int.class, 10);
Array.setInt(array, 0, 42);
int value = Array.getInt(array, 0);
```

## 27.3 Widening conversions

`Array` permits widening conversions during get/set operations but rejects narrowing conversions.

## 27.4 Use cases

- serializers;
- frameworks;
- generic mappers;
- reflection utilities;
- plugin systems.

## 27.5 Application code

Normal application code rarely needs reflection array. Prefer normal array/generic collection unless building framework/infrastructure.

---

# 28. Defensive Copy dan Representation Exposure

Arrays are mutable. If you store array in object, copy it.

## 28.1 Bad value object

```java
public final class Digest {
    private final byte[] bytes;

    public Digest(byte[] bytes) {
        this.bytes = bytes;
    }

    public byte[] bytes() {
        return bytes;
    }
}
```

Caller can mutate:

```java
byte[] raw = {1, 2};
Digest digest = new Digest(raw);

raw[0] = 99;              // mutates digest
digest.bytes()[1] = 88;   // mutates digest
```

## 28.2 Good value object

```java
public final class Digest {
    private final byte[] bytes;

    public Digest(byte[] bytes) {
        this.bytes = bytes.clone();
    }

    public byte[] bytes() {
        return bytes.clone();
    }
}
```

## 28.3 Performance trade-off

Defensive copy costs memory/time.

For security/value correctness, pay it.

For internal hot path, document ownership transfer:

```java
// Takes ownership of array; caller must not mutate after passing.
```

But this is dangerous for public APIs.

## 28.4 Immutable wrappers

Prefer immutable higher-level representation when possible.

But for raw bytes, Java has no built-in immutable byte array wrapper. Make your own type or use ByteBuffer read-only carefully.

## 28.5 ByteBuffer read-only caveat

`asReadOnlyBuffer` prevents mutation through that buffer, but underlying array/object may still be mutable elsewhere if shared.

---

# 29. Arrays dalam Records dan Value Objects

Records are shallowly immutable.

```java
record Payload(byte[] bytes) {}
```

Problems:

- constructor stores mutable array reference;
- accessor exposes mutable array;
- generated equals uses array reference;
- generated hashCode uses array identity;
- generated toString prints array object id.

## 29.1 Custom record with defensive copy

```java
public record Payload(byte[] bytes) {
    public Payload {
        bytes = bytes.clone();
    }

    @Override
    public byte[] bytes() {
        return bytes.clone();
    }

    @Override
    public boolean equals(Object obj) {
        return obj instanceof Payload other &&
               Arrays.equals(this.bytes, other.bytes);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(bytes);
    }

    @Override
    public String toString() {
        return "Payload[length=" + bytes.length + "]";
    }
}
```

## 29.2 Consider final class instead

For array-heavy value object, final class may be clearer than record.

## 29.3 Sensitive arrays

For secrets, avoid generated record toString.

```java
record Secret(byte[] value) {}
```

leaks length/reference string, not contents, but accessors leak mutable contents unless cloned.

## 29.4 Equality policy

If array order matters:

```java
Arrays.equals
```

If order doesn't matter, use sorted copy/multiset logic.

Decide domain semantics.

---

# 30. Memory Layout dan Performance

## 30.1 Primitive arrays

Primitive arrays store values contiguously.

```java
int[] values
double[] values
byte[] payload
```

Excellent locality and low overhead.

## 30.2 Reference arrays

Reference arrays store references contiguously, not objects.

```java
Person[] people
```

People objects elsewhere on heap.

Access involves pointer chasing.

## 30.3 Object overhead

Many small objects in object arrays can cause:

- memory overhead;
- GC pressure;
- cache misses.

## 30.4 Flat representation

For performance, sometimes replace:

```java
Point[] points
```

with:

```java
double[] xs;
double[] ys;
```

or flat:

```java
double[] coordinates; // x0,y0,x1,y1...
```

Trade-off: less domain clarity, more manual indexing.

## 30.5 Large arrays and GC

Very large arrays can affect GC behavior and allocation.

In G1, very large objects may be humongous depending region size. This matters for large byte arrays/buffers.

Use streaming/chunking if payload huge.

## 30.6 Zero-initialization cost

New arrays are zero/default initialized.

Large allocation has initialization cost.

## 30.7 Copy cost

Copying large arrays is O(n), but optimized.

Avoid unnecessary copy in hot path, but do not sacrifice safety at public boundary.

---

# 31. Bounds Check Elimination dan Hot Loops

Java performs bounds checks for safety, but JIT can eliminate redundant checks.

## 31.1 Optimizer-friendly loop

```java
for (int i = 0; i < values.length; i++) {
    sum += values[i];
}
```

## 31.2 Less friendly patterns

Complex index calculations may prevent elimination:

```java
values[f(i, j)]
```

unless JIT proves safety.

## 31.3 Manual caching length

```java
for (int i = 0, len = values.length; i < len; i++) {}
```

Usually not necessary; JIT handles common patterns.

## 31.4 Microbenchmark

Use JMH for loop optimization experiments.

Do not trust naive benchmark.

## 31.5 Avoid premature unsafe tricks

Java arrays are safe and often optimized. Do not use Unsafe/off-heap just to avoid bounds checks unless proven and justified.

---

# 32. Arrays vs Collections

## 32.1 Arrays

Pros:

- compact;
- fast random access;
- primitive support;
- low overhead;
- fixed size;
- good for low-level/high-volume data.

Cons:

- fixed length;
- mutable;
- poor high-level API;
- covariance trap;
- equality trap;
- generic awkwardness;
- defensive copy needed.

## 32.2 Collections

Pros:

- rich API;
- dynamic size;
- generics;
- better abstraction;
- unmodifiable wrappers/factories;
- easier domain modeling.

Cons:

- no primitive generics;
- boxing overhead;
- more object overhead;
- possible mutability/aliasing too;
- iterator overhead in some cases.

## 32.3 Use arrays when

- primitive numeric/binary data;
- fixed-size buffer;
- performance-critical hot path;
- interop API requires array;
- varargs;
- low-level algorithm.

## 32.4 Use collections when

- dynamic size;
- domain list/set/map semantics;
- API readability;
- generics needed;
- set/map operations;
- immutability via `List.copyOf`, `Set.copyOf`.

## 32.5 API boundary

For public APIs, collections often safer:

```java
List<Item> items()
```

instead of:

```java
Item[] items()
```

unless array required.

---

# 33. Arrays vs ByteBuffer/Off-Heap/Native Memory

## 33.1 byte[]

Common for payloads.

Pros:

- simple;
- GC-managed;
- fast;
- works with many APIs.

Cons:

- large arrays on heap;
- copying;
- mutable;
- GC pressure for large buffers.

## 33.2 ByteBuffer

```java
ByteBuffer buffer
```

Can be heap or direct.

Direct buffers allocate outside Java heap but still managed by JVM cleaner/lifecycle.

Use for:

- NIO;
- network/file I/O;
- interop;
- large buffers.

## 33.3 Off-heap/Foreign Memory

Modern Java has Foreign Function & Memory API for advanced native/off-heap access.

Use only when needed:

- native interop;
- huge data;
- performance;
- memory layout control.

## 33.4 Trade-off

Arrays are simplest. Off-heap adds lifecycle risk.

Do not move off-heap without evidence.

---

# 34. Security dan Sensitive Arrays

## 34.1 Why char[] for passwords?

Historically, `char[]` recommended because it can be overwritten, unlike immutable String.

```java
char[] password = ...
Arrays.fill(password, '\0');
```

## 34.2 Not magic

Sensitive data may still be copied by:

- UI framework;
- String conversion;
- logs;
- heap dump;
- GC movement;
- encoding;
- library internals.

`char[]` helps only if lifecycle controlled end-to-end.

## 34.3 byte[] secrets

For keys/tokens:

```java
byte[] key
```

Clear after use:

```java
Arrays.fill(key, (byte) 0);
```

But ensure no other copies exist.

## 34.4 Defensive copy vs clearing tension

If you copy secret arrays defensively, you create more copies to clear.

Security-sensitive API must define ownership/lifecycle carefully.

## 34.5 Constant-time comparison

For secrets/MACs/digests, do not use early-exit comparison if timing matters.

Use security APIs like:

```java
MessageDigest.isEqual(a, b)
```

for digest comparison.

---

# 35. Production Failure Modes

## 35.1 Array covariance failure

```java
Object[] objects = new String[1];
objects[0] = 42; // ArrayStoreException
```

Occurs in generic/framework code.

Fix:

- use generics/collections;
- avoid writing into covariant arrays;
- use correct component type.

## 35.2 Mutable byte[] leak

Value object stores and returns raw byte[].

External code mutates digest/token.

Fix:

- defensive copy;
- immutable wrapper.

## 35.3 Record with array equality bug

```java
record Digest(byte[] bytes) {}
```

Same content not equal.

Fix:

- custom equals/hashCode;
- final class.

## 35.4 Arrays.asList primitive trap

```java
Arrays.asList(new int[]{1,2,3}).size() // 1
```

Fix:

```java
Arrays.stream(intArray).boxed().toList()
```

## 35.5 Shallow clone of 2D array

```java
int[][] copy = original.clone();
```

Only outer array copied. Inner rows shared.

Fix deep copy rows.

## 35.6 Varargs generic heap pollution

Generic varargs method writes unsafe value and causes ClassCastException later.

Fix:

- avoid generic varargs;
- use `@SafeVarargs` only if truly safe;
- use collection parameter.

## 35.7 Sorting then binary search with different comparator

Search returns wrong result.

Fix:

- use same comparator;
- encapsulate sorted array/search operations.

## 35.8 Large array OOM

Reading entire file into byte[]:

```java
Files.readAllBytes(hugeFile)
```

causes OOM.

Fix:

- streaming;
- chunking;
- memory mapped with care;
- backpressure.

## 35.9 Sensitive data remains in array/log

Byte array printed poorly or exposed.

Fix:

- mask toString;
- clear secret arrays;
- avoid logs.

## 35.10 Null elements in reference array

`String[] arr = new String[10]`, then iterate and call method → NPE.

Fix:

- initialize;
- use list with actual size;
- validate.

---

# 36. Best Practices

## 36.1 General

- Remember arrays are mutable objects.
- Use primitive arrays for large numeric/binary data.
- Use collections for domain-level dynamic collections.
- Avoid array covariance in public writing APIs.
- Use `Arrays.equals/hashCode/toString`, not Object methods.
- Deep copy multidimensional arrays when needed.
- Be careful with `Arrays.asList`.
- Use `System.arraycopy`/`Arrays.copyOf` for copying.
- Defensive copy arrays in value objects.
- Do not expose internal arrays.
- Be careful with arrays in records.
- Avoid generic varargs unless safe.
- Use `@SafeVarargs` responsibly.
- Validate length and indexes.
- Avoid loading huge payloads into one array if streaming possible.

## 36.2 API design

Prefer:

```java
List<T>
```

for public domain APIs.

Use arrays when:

- performance;
- binary data;
- fixed-size;
- interop;
- varargs convenience.

## 36.3 Security

- Mask array contents in toString/logs if sensitive.
- Clear secret arrays when lifecycle controlled.
- Avoid copying secrets unnecessarily.
- Use constant-time comparison for secret bytes.

## 36.4 Performance

- Prefer flat primitive arrays in hot numeric paths.
- Avoid object arrays for huge numeric data.
- Benchmark before complex off-heap optimization.
- Watch large array allocation/GC.
- Use JFR for allocation profiling.

---

# 37. Decision Matrix

| Situation | Recommended |
|---|---|
| Raw binary payload | `byte[]`, maybe ByteBuffer for I/O |
| Immutable digest value | final class/record with defensive copy + Arrays.equals |
| Large int dataset | `int[]` |
| Dynamic domain items | `List<Item>` |
| Public API returning items | `List<T>`/unmodifiable collection |
| Fixed small lookup table | array |
| 2D dense numeric matrix | flat primitive array or specialized matrix |
| Jagged rows | array of arrays or list of arrays |
| Generic container internals | Object[] encapsulated carefully |
| Need runtime component type | array/reflection Array |
| Varargs convenience | `T...` if safe |
| Generic varargs | avoid or `@SafeVarargs` with proof |
| Sensitive key bytes | byte[] with ownership/clear policy |
| Huge file processing | stream/chunk, not one huge byte[] |
| Sorting natural language | array/list + Collator comparator |
| Dedup by content | Set with wrapper key, not raw array |

---

# 38. Latihan

## Latihan 1 — Array covariance

Run:

```java
String[] strings = new String[1];
Object[] objects = strings;
objects[0] = 42;
```

Explain compile-time and runtime behavior.

## Latihan 2 — Primitive array vs Object

Test:

```java
int[] arr = {1, 2, 3};
Object o = arr;
Object[] objects = arr; // why compile error?
```

Explain.

## Latihan 3 — Arrays.asList trap

Run:

```java
System.out.println(Arrays.asList(new String[]{"a","b"}).size());
System.out.println(Arrays.asList(new int[]{1,2}).size());
```

Explain.

## Latihan 4 — Defensive copy

Implement immutable `Digest` wrapping byte[] with:

- defensive copy in constructor;
- defensive copy accessor;
- content equals/hashCode;
- safe toString.

## Latihan 5 — 2D shallow clone

Create `int[][]`, clone outer array, mutate inner row, observe original affected. Implement deep copy.

## Latihan 6 — Varargs mutation

Write method:

```java
static void mutate(String... values) {
    values[0] = "changed";
}
```

Pass existing array and observe mutation.

## Latihan 7 — Generic varargs heap pollution

Create unsafe generic varargs example and observe ClassCastException. Then refactor to collection parameter.

## Latihan 8 — Sorting and binary search

Sort string array case-insensitive, then binary search with natural order. Explain failure. Fix with same comparator.

## Latihan 9 — Large array memory

Allocate large `byte[]` and observe heap. Then process same data streaming/chunked.

## Latihan 10 — Flat matrix

Implement matrix using:

```java
double[] data
int rows
int cols
```

Compare with `double[][]` in access pattern benchmark using JMH if possible.

---

# 39. Ringkasan

Array Java adalah reference type dengan karakteristik unik:

```text
fixed length
mutable elements
runtime component type
covariant for reference arrays
reified
bounds-checked
object identity equality by default
```

Hal penting:

- `int[]` is object, but not `Object[]`.
- Primitive arrays store values compactly.
- Reference arrays store references.
- `String[]` can be assigned to `Object[]`, but wrong store causes `ArrayStoreException`.
- Arrays know component type at runtime.
- Generics are erased, so generic arrays are tricky.
- Multidimensional arrays are arrays of arrays.
- `clone`/copy of 2D array can be shallow.
- `Arrays.equals`, `hashCode`, `toString` are needed for content behavior.
- `Arrays.asList` has fixed-size/backed-by-array behavior and primitive array trap.
- Varargs are arrays.
- Generic varargs can cause heap pollution.
- Arrays in records/value objects need defensive copy and custom equality.
- Large arrays can affect memory/GC.
- Use arrays for low-level/fixed/performance data, collections for domain API.

Engineer senior tidak melihat array sebagai sekadar “list sederhana”, tetapi sebagai low-level mutable object with runtime type, memory behavior, type-system quirks, and API hazards.

---

# 40. Referensi

1. Java Language Specification SE 25 — Chapter 10: Arrays  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-10.html

2. Java Language Specification SE 25 — Array Types  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-10.html#jls-10.1

3. Java SE 25 API — `java.util.Arrays`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html

4. Java SE 25 API — `System.arraycopy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/System.html

5. Java SE 25 API — `ArrayStoreException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ArrayStoreException.html

6. Java SE 25 API — `java.lang.reflect.Array`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Array.html

7. Java SE 25 API — `ArrayIndexOutOfBoundsException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ArrayIndexOutOfBoundsException.html

8. Java SE 25 API — `NegativeArraySizeException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/NegativeArraySizeException.html

9. Java SE 25 API — `MessageDigest.isEqual`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html

10. Java Language Specification SE 25 — Variable Arity Parameters  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html

11. Java Language Specification SE 25 — Heap Pollution  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.12.2
