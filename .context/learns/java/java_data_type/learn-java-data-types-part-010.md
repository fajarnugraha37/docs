# learn-java-data-types-part-010.md

# Java Data Types — Part 010  
# `String` sebagai Data Type: Identity, Immutability, Interning, Memory, dan Boundary Semantics

> Seri: **Advanced Java Data Types**  
> Bagian: **010**  
> Fokus: memahami `String` bukan hanya sebagai “teks”, tetapi sebagai reference type khusus yang sangat sentral di Java: literal, immutability, equality, interning, compact strings, concatenation, `StringBuilder`, substring, Unicode/UTF-16, canonicalization, sensitive data, memory/GC, API/DB/cache boundary, dan kapan `String` harus diganti domain-specific type.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa `String` Sangat Penting di Java](#2-kenapa-string-sangat-penting-di-java)
3. [`String` dalam Java Type System](#3-string-dalam-java-type-system)
4. [`String` adalah Reference Type, Bukan Primitive](#4-string-adalah-reference-type-bukan-primitive)
5. [`String` sebagai Sequence of UTF-16 Code Units](#5-string-sebagai-sequence-of-utf-16-code-units)
6. [String Literal](#6-string-literal)
7. [String Pool dan Interning](#7-string-pool-dan-interning)
8. [`String.intern()`](#8-stringintern)
9. [Identity vs Equality pada `String`](#9-identity-vs-equality-pada-string)
10. [Immutability: Kenapa `String` Immutable](#10-immutability-kenapa-string-immutable)
11. [Immutability dan Security](#11-immutability-dan-security)
12. [Immutability dan Thread-Safety](#12-immutability-dan-thread-safety)
13. [Immutability dan Hash Code Caching](#13-immutability-dan-hash-code-caching)
14. [String Concatenation](#14-string-concatenation)
15. [`StringBuilder` dan `StringBuffer`](#15-stringbuilder-dan-stringbuffer)
16. [Text Blocks dan Readability](#16-text-blocks-dan-readability)
17. [Substring dan Memory Behavior](#17-substring-dan-memory-behavior)
18. [Compact Strings](#18-compact-strings)
19. [String Deduplication](#19-string-deduplication)
20. [String Memory Footprint dan GC Pressure](#20-string-memory-footprint-dan-gc-pressure)
21. [String sebagai Key di Map/Cache](#21-string-sebagai-key-di-mapcache)
22. [String Canonicalization](#22-string-canonicalization)
23. [Normalization, Case, Locale, dan Search Key](#23-normalization-case-locale-dan-search-key)
24. [String dan Regex](#24-string-dan-regex)
25. [String Parsing dan Conversion](#25-string-parsing-dan-conversion)
26. [String Formatting](#26-string-formatting)
27. [String vs `char[]` vs `byte[]` untuk Sensitive Data](#27-string-vs-char-vs-byte-untuk-sensitive-data)
28. [String di API, JSON, Database, Kafka, Logs](#28-string-di-api-json-database-kafka-logs)
29. [Stringly Typed Code Anti-Pattern](#29-stringly-typed-code-anti-pattern)
30. [Domain-Specific String Types](#30-domain-specific-string-types)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices](#32-best-practices)
33. [Decision Matrix](#33-decision-matrix)
34. [Latihan](#34-latihan)
35. [Ringkasan](#35-ringkasan)
36. [Referensi](#36-referensi)

---

# 1. Tujuan Bagian Ini

`String` adalah salah satu type yang paling sering dipakai dalam Java:

```java
String name = "Fajar";
String status = "CLOSED";
String id = "CASE-001";
String json = "{...}";
String query = "select * from cases";
String token = "...";
```

Karena sangat mudah dipakai, `String` sering menjadi tempat berkumpulnya masalah:

```java
if (status == "CLOSED") { ... }          // identity bug
status = "CLOESD";                       // typo accepted
amount = "100.00";                       // numeric as string
id = officerId;                          // parameter tertukar
name.toLowerCase();                      // default locale trap
token.toString();                        // secret leak
String huge = Files.readString(path);     // memory spike
```

Tujuan bagian ini:

- memahami `String` sebagai object immutable;
- memahami literal, string pool, interning;
- memahami equality dan identity;
- memahami UTF-16 semantics;
- memahami concatenation dan builder;
- memahami compact strings dan memory behavior;
- memahami canonicalization dan normalization;
- memahami sensitive data issue;
- memahami boundary API/DB/cache/log;
- memahami kapan `String` cukup dan kapan harus domain type.

---

# 2. Kenapa `String` Sangat Penting di Java

`String` dipakai untuk:

- nama;
- ID;
- status;
- code;
- JSON/XML;
- SQL;
- URL;
- file path;
- log message;
- exception message;
- config;
- header;
- token;
- username;
- email;
- reason;
- query parameter;
- Kafka key;
- cache key.

Karena itu `String` bukan sekadar text container. Ia sering menjadi **boundary type** antar layer dan sistem.

## 2.1 String is easy to overuse

Karena semua bisa dijadikan string, banyak code menjadi stringly typed:

```java
void update(String type, String status, String action, String id) {}
```

Compiler tidak bisa membedakan:

```java
update(action, id, status, type); // compile success
```

Solusi:

```java
void update(CaseType type, CaseStatus status, CaseAction action, CaseId id) {}
```

## 2.2 String is flexible but weak

`String` memiliki set of values terlalu luas:

```text
all possible character sequences
```

Untuk domain tertentu, set legal jauh lebih kecil:

```text
CaseStatus = DRAFT, SUBMITTED, CLOSED
CurrencyCode = [A-Z]{3}
PolicyCode = [A-Z0-9_]{3,64}
CaseId = CASE-\d+
```

Jika memakai raw `String`, compiler tidak membantu.

---

# 3. `String` dalam Java Type System

`String` adalah final class di `java.lang`.

```java
public final class String
    implements Serializable, Comparable<String>, CharSequence, Constable, ConstantDesc
```

Konsekuensi:

- `String` adalah reference type;
- `String` bukan primitive;
- `String` immutable;
- `String` final, tidak bisa disubclass;
- `String` implements `CharSequence`;
- `String` comparable secara lexicographic Unicode/code unit order;
- `String` serializable;
- string literals adalah instance dari `String`.

## 3.1 `String` belongs to `java.lang`

Tidak perlu import:

```java
String s = "hello";
```

## 3.2 `String` implements `CharSequence`

APIs can accept:

- `String`;
- `StringBuilder`;
- `StringBuffer`;
- `CharBuffer`;
- custom text sequence.

Tetapi jika butuh immutable/stable value, copy ke `String`.

## 3.3 `String` as Comparable

```java
"a".compareTo("b") < 0
```

Ini lexicographic based on Unicode values/code units, bukan locale-sensitive natural language collation.

Untuk user-facing sorting, gunakan `Collator`.

---

# 4. `String` adalah Reference Type, Bukan Primitive

```java
String a = "hello";
String b = a;
```

`a` and `b` are references to same String object.

Tetapi karena String immutable, aliasing aman.

```java
String upper = a.toUpperCase(Locale.ROOT);
```

Ini membuat/mengembalikan String lain; original tidak berubah.

## 4.1 Null

`String` bisa null:

```java
String name = null;
```

Sehingga:

```java
name.length()
```

bisa throw NPE.

## 4.2 Empty vs blank vs null

Makna berbeda:

```java
null       // absent
""         // empty
"   "      // blank
"Fajar"    // content
```

Java menyediakan:

```java
isEmpty()
isBlank()
strip()
```

## 4.3 Design policy

Untuk setiap String field, tentukan:

- boleh null?
- boleh empty?
- boleh blank?
- perlu strip?
- perlu normalize?
- max length by what unit?
- user display text atau machine key?
- sensitive?

---

# 5. `String` sebagai Sequence of UTF-16 Code Units

Java `String` merepresentasikan sequence of `char` values.

`char` adalah UTF-16 code unit.

Karena itu:

```java
String s = "😄";
s.length(); // 2
```

User melihat satu emoji, tetapi `String.length()` mengembalikan dua UTF-16 code units.

## 5.1 String API index is char index

Method seperti:

```java
charAt
substring
indexOf
offsetByCodePoints
codePointAt
```

menggunakan indexes ke UTF-16 code units kecuali method code point secara eksplisit.

## 5.2 Code points

Gunakan:

```java
s.codePoints()
s.codePointAt(index)
s.codePointCount(0, s.length())
```

untuk Unicode code point processing.

## 5.3 Grapheme cluster

User-perceived character bisa terdiri dari beberapa code points.

`String` API tidak langsung menyediakan abstraction full grapheme cluster.

Gunakan `BreakIterator` atau Unicode library khusus jika UI-level character segmentation penting.

## 5.4 Practical rule

Jangan gunakan:

```java
s.length()
```

sebagai “jumlah karakter yang user lihat” tanpa memperjelas semantics.

---

# 6. String Literal

String literal:

```java
"hello"
```

adalah `String` object.

All string literals in Java programs are instances of `String`.

## 6.1 Literal interning

String literals are interned.

```java
String a = "hello";
String b = "hello";

a == b // true
```

Keduanya menunjuk interned String object yang sama.

## 6.2 Compile-time concatenation

```java
String s = "he" + "llo";
```

bisa menjadi compile-time constant dan diintern sebagai `"hello"`.

```java
"hello" == "he" + "llo" // true
```

Tetapi:

```java
String part = "he";
"hello" == part + "llo" // false usually
```

karena runtime concatenation membuat/mengembalikan String lain.

## 6.3 Literal and class loading

String literals terkait class constant pool dan interned at runtime.

Biasanya tidak perlu dikelola langsung.

## 6.4 Literal for secrets?

Jangan simpan secret sebagai string literal:

```java
private static final String API_KEY = "secret";
```

Bisa muncul di class file, heap dump, source control, atau log.

Gunakan secret management.

---

# 7. String Pool dan Interning

String pool menyimpan canonical String instances.

Interning berarti equal strings bisa share satu canonical object.

## 7.1 Literal pool behavior

```java
String a = "abc";
String b = "abc";

a == b // true
```

## 7.2 Runtime string

```java
String a = "abc";
String b = new String("abc");

a == b       // false
a.equals(b) // true
```

## 7.3 Why pool exists?

Manfaat:

- memory sharing untuk literals/canonical strings;
- class constant handling;
- reuse untuk string yang sama;
- memungkinkan literal identity sharing.

## 7.4 Do not rely on identity

Walaupun interning ada, equality bisnis harus memakai:

```java
equals
```

## 7.5 Interning dynamic values

`intern()` bisa canonicalize dynamic strings, tetapi bisa membuat memory pressure jika dipakai sembarangan.

---

# 8. `String.intern()`

```java
String s = new String("hello");
String i = s.intern();

System.out.println(i == "hello"); // true
```

`intern()` mengembalikan canonical representation dari string pool.

## 8.1 When useful?

Potensi use case:

- banyak string duplikat;
- parser dengan identifier berulang;
- compiler/interpreter;
- memory optimization setelah measurement;
- enum-like dynamic symbols.

## 8.2 Risks

- pool memory growth;
- global lifetime effects;
- overhead;
- unnecessary complexity;
- unique user input bisa memenuhi pool.

## 8.3 Prefer domain canonicalization first

Untuk domain keys:

```java
PolicyCode
Username
CaseStatus
```

gunakan typed canonical values. Jangan blindly intern raw user input.

## 8.4 Interning is not validation

```java
status = status.intern();
```

tidak membuat invalid status menjadi valid.

Gunakan enum/domain type.

---

# 9. Identity vs Equality pada `String`

## 9.1 `==`

Membandingkan reference identity.

```java
String a = new String("x");
String b = new String("x");

a == b // false
```

## 9.2 `equals`

Membandingkan content.

```java
a.equals(b) // true
```

## 9.3 Null-safe comparison

```java
Objects.equals(a, b)
```

atau constant first:

```java
"CLOSED".equals(status)
```

## 9.4 `equalsIgnoreCase`

```java
"abc".equalsIgnoreCase("ABC")
```

Berguna untuk kasus sederhana, tetapi bukan solusi lengkap locale/collation/normalization.

## 9.5 Case-insensitive machine key

Lebih baik canonicalization:

```java
String key = input.strip().toLowerCase(Locale.ROOT);
```

lalu compare dengan `equals`.

## 9.6 Avoid string status

Daripada:

```java
if ("CLOSED".equals(status)) {}
```

lebih baik:

```java
if (status == CaseStatus.CLOSED) {}
```

dengan `status` berupa enum.

---

# 10. Immutability: Kenapa `String` Immutable

`String` immutable: content tidak berubah setelah dibuat.

```java
String s = "hello";
String upper = s.toUpperCase(Locale.ROOT);

System.out.println(s);     // hello
System.out.println(upper); // HELLO
```

## 10.1 Why important?

Immutability memungkinkan:

- safe sharing;
- string pool;
- thread-safety;
- hashCode caching;
- security assumptions;
- class loading safety;
- map key stability.

## 10.2 What operations do

Methods seperti:

```java
replace
substring
toLowerCase
toUpperCase
trim
strip
concat
```

mengembalikan String baru atau mungkin same String jika tidak ada perubahan.

Tidak mutate original.

## 10.3 Common bug

```java
name.strip();
```

tidak mengubah variable.

Correct:

```java
name = name.strip();
```

## 10.4 String as HashMap key

Karena immutable, String aman secara teknis sebagai key jika canonicalization benar.

Tetapi raw user strings tetap butuh normalization/case policy.

---

# 11. Immutability dan Security

String immutability membantu security dalam beberapa hal:

- path/class name tidak bisa berubah setelah validasi;
- map key stabil;
- safe sharing antar thread;
- permission strings stabil jika dipakai.

Tetapi merugikan lifecycle sensitive data.

## 11.1 Secrets in String

```java
String password = request.password();
```

Tidak bisa clear content secara manual.

Ia bertahan sampai GC dan bisa muncul di heap dump/log jika bocor.

## 11.2 char[] alternative

```java
char[] password;
Arrays.fill(password, '\0');
```

Bisa clear, tetapi hanya membantu jika tidak ada copy sebagai String.

## 11.3 byte[] for keys

Cryptographic keys sering memakai byte[] atau key objects.

Clear arrays jika lifecycle dikontrol.

## 11.4 Do not overclaim

`char[]` bukan magic. Framework HTTP/JSON bisa membuat String internal.

Gunakan secure end-to-end handling jika benar-benar required.

## 11.5 toString leak

Sensitive domain type harus override `toString`.

```java
record AccessToken(String value) {
    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

---

# 12. Immutability dan Thread-Safety

String thread-safe karena immutable.

```java
String shared = "config-key";
```

Banyak thread bisa membaca aman.

## 12.1 Safe sharing

Tidak perlu synchronization untuk content String.

## 12.2 Reference visibility still matters

Jika mutable object punya non-final String field yang diupdate lintas thread:

```java
private String status;
```

visibility update reference tetap butuh synchronization/volatile/safe publication.

String immutability tidak membuat containing object thread-safe.

## 12.3 StringBuilder not thread-safe

`StringBuilder` mutable dan tidak synchronized.

Jangan share mutable builder antar thread tanpa synchronization.

## 12.4 StringBuffer synchronized

`StringBuffer` adalah synchronized legacy mutable character sequence.

Biasanya gunakan `StringBuilder` kecuali benar-benar butuh synchronized buffer.

---

# 13. Immutability dan Hash Code Caching

`String.hashCode()` computed dari content.

Karena String immutable, hash code bisa di-cache.

Ini membantu repeated use as key.

## 13.1 HashMap key

```java
Map<String, Value> map = new HashMap<>();
map.put("caseId", value);
```

String technically good as key.

## 13.2 Domain issue remains

Raw String key semantically weak.

```java
Map<String, CaseRecord> cases;
```

Lebih baik:

```java
Map<CaseId, CaseRecord> cases;
```

dengan `CaseId` membungkus canonical String.

## 13.3 Hash collision

String hash tidak unique. Different strings bisa punya hash sama.

HashMap menyelesaikan collision dengan equals.

Jangan pakai `hashCode` sebagai ID/security checksum.

## 13.4 Hash and DoS

Banyak equal-hash strings bisa memberi collision pressure. Batasi untrusted keys dan ukuran input.

---

# 14. String Concatenation

## 14.1 `+` operator

Java mendukung String concatenation:

```java
String message = "Hello, " + name;
```

Jika salah satu operand String, operand lain dikonversi ke String.

## 14.2 Compile-time constants

```java
String s = "a" + "b";
```

compiled as `"ab"`.

## 14.3 Runtime concatenation

```java
String s = prefix + value + suffix;
```

Modern Java compilers memakai `invokedynamic` string concatenation machinery sehingga JVM bisa mengoptimalkan.

## 14.4 Concatenation in loops

Bad:

```java
String result = "";
for (String item : items) {
    result += item;
}
```

Membuat banyak intermediate strings.

Better:

```java
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item);
}
String result = sb.toString();
```

Atau:

```java
String.join(",", items)
```

untuk joining.

## 14.5 Null concatenation

```java
String s = "value=" + null;
```

Menghasilkan:

```text
value=null
```

Ini bisa menyembunyikan null bug di log/message.

---

# 15. `StringBuilder` dan `StringBuffer`

## 15.1 StringBuilder

Mutable sequence of characters.

```java
StringBuilder sb = new StringBuilder();
sb.append("hello");
sb.append(" ");
sb.append("world");
String s = sb.toString();
```

Gunakan untuk membangun string dinamis.

## 15.2 Capacity

StringBuilder punya capacity. Appending beyond capacity akan grow internal storage.

Jika expected size diketahui:

```java
StringBuilder sb = new StringBuilder(expectedLength);
```

## 15.3 StringBuffer

Synchronized version.

```java
StringBuffer buffer = new StringBuffer();
```

Lebih jarang dipakai di modern code.

## 15.4 Builder reuse

Jangan reuse StringBuilder antar request/thread tanpa kontrol.

Risiko:

- memory retention karena capacity besar;
- thread-safety;
- stale content.

## 15.5 StringJoiner/String.join

Untuk delimiters:

```java
String result = String.join(",", values);
```

atau:

```java
StringJoiner joiner = new StringJoiner(",");
```

## 15.6 Collectors.joining

```java
String csv = values.stream()
    .collect(Collectors.joining(","));
```

Bagus untuk data moderate; untuk huge streams, pertimbangkan streaming writer.

---

# 16. Text Blocks dan Readability

Text blocks memungkinkan multi-line string literals:

~~~java
String sql = """
    SELECT *
    FROM cases
    WHERE status = ?
    """;
~~~

Berguna untuk:

- SQL snippets;
- JSON examples;
- test fixtures;
- HTML templates;
- multi-line messages.

## 16.1 Indentation handling

Text blocks punya indentation rules. Perhatikan resulting whitespace.

## 16.2 Not templating

Text blocks adalah literals. Jangan gunakan unsafe concatenation untuk SQL/HTML.

Bad:

~~~java
String sql = """
    SELECT * FROM users WHERE name = '%s'
    """.formatted(name);
~~~

Gunakan prepared statements.

## 16.3 Test readability

Text blocks bagus untuk expected JSON di tests, tetapi normalize whitespace jika perlu.

---

# 17. Substring dan Memory Behavior

## 17.1 substring API

```java
String sub = s.substring(beginIndex, endIndex);
```

Indexes adalah UTF-16 code unit indexes.

Bisa split surrogate pair jika ceroboh.

## 17.2 Modern substring copies

Modern JDK tidak lagi mempertahankan large original backing array untuk small substring seperti JDK lama. Substring membuat representasi baru untuk substring.

## 17.3 Still allocates

Substring membuat String object/content representation baru. Dalam hot parsing loops, banyak substring bisa menciptakan allocation pressure.

## 17.4 Parser optimization

Alih-alih membuat substring terus-menerus:

- gunakan indexes ke original string;
- gunakan `CharSequence` slice abstraction dengan hati-hati;
- parse dari `Reader`/buffer;
- gunakan streaming parser;
- benchmark.

## 17.5 Security

Jangan log substrings dari secret tokens secara sembarangan.

---

# 18. Compact Strings

JEP 254 memperkenalkan Compact Strings di JDK 9.

Sebelumnya, String internal memakai char array-like UTF-16 storage. Compact Strings mengubah internal representation menjadi byte array plus encoding flag, menyimpan Latin-1 strings satu byte per character dan UTF-16 jika dibutuhkan.

## 18.1 Why it matters

Banyak string di aplikasi typical Latin-1/ASCII-compatible:

- IDs;
- HTTP headers;
- JSON field names;
- enum names;
- codes;
- logs.

Compact Strings bisa mengurangi memory.

## 18.2 It is implementation detail

Code tetap melihat String sebagai sequence UTF-16 `char` values.

Jangan bergantung pada field internal byte[]/coder.

## 18.3 Mixed content

Jika String mengandung karakter di luar Latin-1, internal storage memakai UTF-16 representation.

## 18.4 Performance impact

Compact strings dapat meningkatkan memory/cache locality untuk Latin-1 strings, tetapi operation tertentu perlu encoding checks.

Biasanya beneficial; jangan micro-optimize tanpa measurement.

---

# 19. String Deduplication

String deduplication adalah optimasi JVM/GC yang bisa mengurangi memory dengan membuat duplicate String contents share backing storage.

## 19.1 Use case

Banyak duplicate runtime strings:

- parsed JSON keys;
- repeated codes;
- duplicated names;
- XML/CSV repeated values;
- banyak DTO dengan string sama.

## 19.2 JVM option

Common option:

```text
-XX:+UseStringDeduplication
```

dengan G1 pada banyak HotSpot JDK.

Exact support/behavior tergantung JVM/version/GC.

## 19.3 Trade-offs

Deduplication bisa mengurangi memory tetapi menambah GC work/overhead.

Gunakan setelah measuring.

## 19.4 Not semantic

Deduplication tidak mengubah equality/identity semantics yang harus diandalkan.

Jangan berharap:

```java
a == b
```

menjadi true.

## 19.5 Measure

Gunakan:

- JFR;
- GC logs;
- heap histogram;
- memory profiler;
- production-like load.

---

# 20. String Memory Footprint dan GC Pressure

## 20.1 Many strings cost memory

Setiap String object punya:

- object header;
- fields;
- backing byte[]/storage;
- array header;
- content bytes;
- alignment.

Exact layout JVM-dependent.

## 20.2 Duplicate strings

Duplicate contents bisa membuang memory.

Examples:

- reading CSV dengan repeated status values;
- mapping DB rows to DTOs dengan repeated code strings;
- JSON parsing repeated field names;
- logs building repeated messages.

## 20.3 Allocation hot spots

Common sources:

- concatenation in loop;
- substring parsing;
- regex split/replace;
- `String.format`;
- JSON serialization/deserialization;
- logging disabled tapi message dibangun eager;
- `toString` pada large objects;
- repeated normalization/case conversion.

## 20.4 Use JFR

Profile allocations:

```text
java.lang.String
byte[]
StringBuilder
Pattern/Matcher
```

## 20.5 Avoid premature optimization

Most business code bisa memakai String normal.

Optimize jika:

- memory profile menunjukkan String pressure;
- latency terdampak allocation/GC;
- huge parsing/text processing;
- high-throughput logging/serialization.

---

# 21. String sebagai Key di Map/Cache

String technically works well as Map key karena immutable dan hashCode stabil.

Tetapi semantic issues tetap ada.

## 21.1 Raw String key ambiguity

```java
Map<String, CaseRecord> casesById;
Map<String, Officer> officersById;
```

Bisa tertukar.

Better:

```java
Map<CaseId, CaseRecord>
Map<OfficerId, Officer>
```

## 21.2 Canonicalization

Jika memakai String keys:

```java
String key = input.strip().toLowerCase(Locale.ROOT);
```

Store canonical key consistently.

## 21.3 Cache key construction

Bad:

```java
String key = tenantId + userId + query;
```

Ambiguous:

```text
tenant=ab, user=c
tenant=a, user=bc
```

Better typed key:

```java
record SearchCacheKey(TenantId tenantId, UserId userId, QueryHash queryHash) {}
```

atau delimiter + escaping yang benar.

## 21.4 Secret keys

Jangan gunakan raw tokens as cache keys jika logs/metrics expose keys.

Hash/mask where appropriate.

## 21.5 High-cardinality metrics

Jangan pakai arbitrary strings sebagai metric labels:

```text
userId
email
requestId
full URL with query
```

Bisa merusak backend metrics cardinality.

---

# 22. String Canonicalization

Canonicalization berarti mengubah berbagai input equivalent menjadi satu standard representation.

Examples:

```text
" ABC " -> "ABC"
"abc" -> "ABC"
"e\u0301" -> "\u00E9"
```

## 22.1 Why canonicalize?

- equality;
- uniqueness;
- search;
- cache keys;
- idempotency keys;
- security;
- deduplication.

## 22.2 Policy depends on field

PolicyCode:

```text
strip + uppercase Locale.ROOT + ASCII pattern
```

Username:

```text
normalize + lowercase Locale.ROOT + allowed chars
```

DisplayName:

```text
preserve original + normalized search key
```

FreeText:

```text
preserve original, maybe normalize for search only
```

## 22.3 Example

```java
public record PolicyCode(String value) {
    private static final Pattern PATTERN = Pattern.compile("[A-Z0-9_]{3,64}");

    public PolicyCode {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid policy code");
        }
    }
}
```

## 22.4 Do not overcanonicalize

Legal names, addresses, comments, and audit text bisa perlu preserving exact original.

Store both jika perlu:

```text
original_value
canonical_search_key
```

## 22.5 Canonicalization and audit

Jika canonicalization mengubah user input, audit mungkin perlu original input.

---

# 23. Normalization, Case, Locale, dan Search Key

## 23.1 Normalization

Gunakan `Normalizer` untuk Unicode normalization:

```java
String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

## 23.2 Case conversion

Gunakan `Locale.ROOT` untuk machine keys:

```java
input.toLowerCase(Locale.ROOT)
```

Gunakan user locale untuk display.

## 23.3 Turkish I

Hindari:

```java
input.toLowerCase()
```

karena default locale dapat mengubah behavior.

## 23.4 Search keys

Search key mungkin:

```java
String searchKey = Normalizer.normalize(input, Normalizer.Form.NFKC)
    .strip()
    .toLowerCase(Locale.ROOT);
```

Namun NFKC bisa mengubah semantics; gunakan hati-hati.

## 23.5 Database alignment

Jika app canonicalizes tetapi DB collation berbeda, uniqueness/search bisa tetap mengejutkan.

Gunakan canonical column dan unique constraint.

---

# 24. String dan Regex

Beberapa String method memakai regex.

## 24.1 `split` uses regex

```java
"a.b".split(".")
```

`.` berarti any character, sehingga hasil mengejutkan.

Correct:

```java
"a.b".split("\\.")
```

atau:

```java
input.split(Pattern.quote("."))
```

## 24.2 `replace` vs `replaceAll`

```java
replace      // literal replacement
replaceAll   // regex
replaceFirst // regex
```

Gunakan `replace` jika tidak butuh regex.

## 24.3 Regex performance

Regex kompleks bisa menyebabkan catastrophic backtracking.

User input + vulnerable regex = ReDoS risk.

## 24.4 Precompile pattern

```java
private static final Pattern POLICY_CODE = Pattern.compile("[A-Z0-9_]{3,64}");
```

Jangan compile same regex terus-menerus di hot path.

## 24.5 Validation regex and Unicode

`\\w` dan character classes mungkin tidak berarti seperti yang dikira dalam konteks Unicode/flags.

Untuk security-sensitive identifiers, define allowed characters eksplisit.

---

# 25. String Parsing dan Conversion

Strings sering dikonversi:

```java
Integer.parseInt
Long.parseLong
Boolean.parseBoolean
BigDecimal(String)
UUID.fromString
Instant.parse
LocalDate.parse
Enum.valueOf
```

## 25.1 Parsing errors

Parsing bisa throw:

```java
NumberFormatException
DateTimeParseException
IllegalArgumentException
```

Jangan bocorkan raw exceptions ke API users.

Map ke validation errors.

## 25.2 Boolean parsing trap

```java
Boolean.parseBoolean("true") // true
Boolean.parseBoolean("TRUE") // true
Boolean.parseBoolean("yes")  // false
Boolean.parseBoolean("abc")  // false
```

`parseBoolean` mengembalikan false untuk apapun yang bukan true ignoring case.

Untuk config/user input, ini bisa menyembunyikan typo.

Better strict parser:

```java
static boolean parseStrictBoolean(String value) {
    return switch (value) {
        case "true" -> true;
        case "false" -> false;
        default -> throw new IllegalArgumentException("Expected true or false");
    };
}
```

## 25.3 Enum parsing

```java
CaseStatus.valueOf(input)
```

throws jika invalid dan case-sensitive.

Prefer explicit parser:

```java
static Optional<CaseStatus> parseStatus(String input) {
    try {
        return Optional.of(CaseStatus.valueOf(input.strip().toUpperCase(Locale.ROOT)));
    } catch (IllegalArgumentException ex) {
        return Optional.empty();
    }
}
```

Atau map external codes separately.

## 25.4 BigDecimal parsing

Gunakan String constructor untuk exact decimal:

```java
new BigDecimal("0.10")
```

bukan:

```java
new BigDecimal(0.10)
```

## 25.5 UUID parsing

```java
UUID.fromString(input)
```

Validate format dan map exception ke API validation error.

---

# 26. String Formatting

## 26.1 `String.format`

```java
String message = String.format("Hello %s", name);
```

Menggunakan formatter dan locale-sensitive behavior tergantung overload/default locale.

Untuk locale-neutral formatting:

```java
String.format(Locale.ROOT, "value=%d", value)
```

## 26.2 `.formatted`

```java
String message = "Hello %s".formatted(name);
```

Convenient tapi tetap formatting machinery.

## 26.3 Performance

`String.format` relatif heavy.

Untuk simple concatenation:

```java
"Hello " + name
```

fine.

Untuk loops, gunakan builder/joiner.

## 26.4 Locale

Number/date formatting harus locale-aware untuk display.

Jangan pakai `String.format` untuk machine serialization jika exact format required kecuali controlled.

## 26.5 SQL/HTML injection

Jangan gunakan formatting/concatenation untuk SQL dengan user input.

Gunakan prepared statements.

Jangan build HTML/JS tanpa escaping.

---

# 27. String vs `char[]` vs `byte[]` untuk Sensitive Data

## 27.1 String secrets

Problems:

- immutable;
- tidak bisa clear;
- mungkin interned/literal;
- bisa muncul di heap dump;
- toString/log risk;
- copies during parsing/serialization.

## 27.2 char[]

Pros:

- bisa clear dengan Arrays.fill;
- common for password APIs.

Cons:

- tetap bisa dicopy;
- banyak framework convert to String;
- tidak aman jika logged/dumped sebelum clear;
- inconvenient.

## 27.3 byte[]

Pros:

- cocok untuk keys/tokens/binary secrets;
- bisa clear;
- bekerja dengan crypto APIs.

Cons:

- mutable;
- defensive copies menciptakan copies lagi;
- lifecycle sulit.

## 27.4 Domain wrapper

```java
public final class SecretBytes implements AutoCloseable {
    private byte[] value;

    public SecretBytes(byte[] value) {
        this.value = value.clone();
    }

    public byte[] copyValue() {
        ensureOpen();
        return value.clone();
    }

    @Override
    public void close() {
        if (value != null) {
            Arrays.fill(value, (byte) 0);
            value = null;
        }
    }

    private void ensureOpen() {
        if (value == null) {
            throw new IllegalStateException("Secret closed");
        }
    }

    @Override
    public String toString() {
        return "SecretBytes[masked]";
    }
}
```

## 27.5 Practical rule

Untuk typical backend apps, secrets sering masuk sebagai String karena framework. Kurangi exposure:

- jangan log;
- mask;
- short lifetime;
- hindari literals;
- gunakan secret managers;
- hindari storing di DTO toString;
- hindari exception messages.

Untuk high-security code, desain end-to-end secret lifecycle.

---

# 28. String di API, JSON, Database, Kafka, Logs

## 28.1 API

Untuk setiap String field definisikan:

- required?
- nullable?
- min/max length?
- blank allowed?
- normalization?
- pattern?
- example?
- sensitive?
- encoding?
- enum alternative?

## 28.2 JSON

JSON strings adalah Unicode text. Tetapi API consumers bisa menangani normalization/case berbeda.

Document external representation.

## 28.3 Database

Text column issues:

- length semantics;
- collation;
- case sensitivity;
- normalization;
- index length;
- uniqueness;
- trailing spaces;
- encoding.

## 28.4 Kafka/event

String fields dalam event schema butuh evolution policy.

Jangan gunakan free-form String untuk fields yang seharusnya enum/code kecuali forward compatibility policy jelas.

## 28.5 Logs

Jangan log raw:

- password;
- token;
- secret;
- PII;
- large payload;
- untrusted multiline text tanpa escaping.

## 28.6 Metrics labels

Hindari high-cardinality arbitrary String values.

Bad:

```text
metric{userId="...", requestId="..."}
```

## 28.7 Cache keys

Canonicalize dan delimit dengan aman.

Prefer typed key record.

---

# 29. Stringly Typed Code Anti-Pattern

Stringly typed code merepresentasikan structured/domain concepts sebagai raw strings.

Examples:

```java
String status = "CLOSED";
String type = "ENFORCEMENT";
String action = "APPROVE";
String amount = "12.34";
String deadline = "2026-06-12";
String enabled = "true";
```

## 29.1 Problems

- typo tidak tertangkap;
- invalid values allowed;
- parameter mix-up;
- parsing scattered;
- no central validation;
- no autocomplete/refactor safety;
- no explicit semantics;
- poor audit;
- runtime failures.

## 29.2 Replace status with enum

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    CLOSED
}
```

## 29.3 Replace command/action with sealed type

```java
sealed interface CaseCommand permits SubmitCase, CloseCase {}

record SubmitCase(CaseId caseId) implements CaseCommand {}
record CloseCase(CaseId caseId, ClosureReason reason) implements CaseCommand {}
```

## 29.4 Replace ID string with typed ID

```java
record CaseId(String value) {}
```

## 29.5 Replace amount string with Money

```java
record Money(BigDecimal amount, Currency currency) {}
```

## 29.6 Keep String at boundary

String di DTO okay:

```java
record CloseCaseRequest(String caseId, String reason) {}
```

Tetapi map segera:

```java
new CloseCaseCommand(new CaseId(request.caseId()), new ClosureReason(request.reason()))
```

---

# 30. Domain-Specific String Types

## 30.1 CaseId

```java
public record CaseId(String value) {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{4}-[0-9]{6}");

    public CaseId {
        Objects.requireNonNull(value, "value");
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid case id");
        }
    }
}
```

## 30.2 PolicyCode

```java
public record PolicyCode(String value) {
    private static final Pattern PATTERN = Pattern.compile("[A-Z0-9_]{3,64}");

    public PolicyCode {
        Objects.requireNonNull(value);
        value = value.strip().toUpperCase(Locale.ROOT);

        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid policy code");
        }
    }
}
```

## 30.3 RejectionReason

```java
public record RejectionReason(String value) {
    public RejectionReason {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value.strip(), Normalizer.Form.NFC);

        int length = value.codePointCount(0, value.length());
        if (length < 10 || length > 2000) {
            throw new IllegalArgumentException("Reason length must be 10..2000 code points");
        }
    }

    @Override
    public String toString() {
        return "RejectionReason[length=" + value.codePointCount(0, value.length()) + "]";
    }
}
```

## 30.4 AccessToken

```java
public record AccessToken(String value) {
    public AccessToken {
        Objects.requireNonNull(value);
        if (value.isBlank()) {
            throw new IllegalArgumentException("Token cannot be blank");
        }
    }

    @Override
    public String toString() {
        return "AccessToken[masked]";
    }
}
```

## 30.5 Benefits

- validation central;
- normalization central;
- no parameter mix-up;
- safe logging;
- explicit boundary mapping;
- easier testing;
- better autocomplete;
- domain language visible.

---

# 31. Production Failure Modes

## 31.1 String comparison with `==`

Works in tests karena literal interning, fails dengan DB/API strings.

Fix:

```java
equals
enum/domain type
```

## 31.2 Status typo

```java
"CLOESD"
```

accepted.

Fix:

```java
enum CaseStatus
```

atau parser dengan validation.

## 31.3 Default locale lowercasing

```java
key.toLowerCase()
```

breaks in Turkish locale.

Fix:

```java
toLowerCase(Locale.ROOT)
```

## 31.4 Unicode normalization duplicate

Dua visually same names/keys stored differently.

Fix:

- normalize canonical key;
- unique constraint on canonical key.

## 31.5 Regex split bug

```java
"a.b".split(".")
```

returns unexpected result.

Fix:

```java
split("\\.")
Pattern.quote
```

## 31.6 Boolean.parseBoolean typo

```java
Boolean.parseBoolean("treu") // false
```

Fix strict parser for config/user input.

## 31.7 String concatenation in loop

Membuat banyak intermediate strings, menyebabkan allocation/GC.

Fix:

```java
StringBuilder
StringJoiner
Collectors.joining
streaming writer
```

## 31.8 Sensitive toString leak

Record dengan token/password mencetak value.

Fix:

- override toString;
- logging policy;
- secret wrapper.

## 31.9 Huge String memory spike

Reading large file/payload into String.

Fix:

- stream processing;
- size limits;
- backpressure;
- chunking.

## 31.10 High-cardinality string metrics

Memakai user/request IDs di metric labels menyebabkan metrics backend explosion.

Fix:

- bounded low-cardinality labels;
- logs/traces untuk high-cardinality data.

## 31.11 Cache key collision by concatenation

```java
tenant + user + query
```

ambiguous.

Fix:

- typed key;
- delimiter + escaping;
- structured key.

## 31.12 SQL injection

String concatenation untuk SQL.

Fix:

- prepared statements;
- parameter binding;
- query builder with bind variables.

---

# 32. Best Practices

## 32.1 General

- Use `equals`, not `==`, untuk String content.
- Use enum/domain type untuk closed sets.
- Use typed ID records daripada raw String IDs.
- Normalize/canonicalize machine keys.
- Use `Locale.ROOT` untuk machine case conversion.
- Preserve original display text where needed.
- Define null/empty/blank policy.
- Define length semantics.
- Avoid concatenation in loops.
- Use StringBuilder/StringJoiner untuk dynamic construction.
- Use prepared statements untuk SQL.
- Avoid logging secrets/PII.
- Avoid raw strings sebagai cache keys ketika structured key needed.
- Avoid high-cardinality strings in metrics.
- Profile before intern/dedup optimization.

## 32.2 Domain String rules

Untuk setiap domain string type:

- validate in constructor;
- normalize jika appropriate;
- decide case sensitivity;
- decide Unicode normalization;
- decide length unit;
- override toString jika sensitive/large;
- provide clear factory/parser for external input.

## 32.3 Boundary rules

At API boundary:

- DTO string fields are okay;
- validate/map immediately;
- avoid leaking raw DTO into domain;
- document schema.

At DB boundary:

- define collation/length/unique constraint;
- store canonical key jika needed.

At log boundary:

- mask/escape.

---

# 33. Decision Matrix

| Situation | Use raw String? | Better option |
|---|---:|---|
| simple local message | yes | String |
| log template | yes | parameterized logging |
| status closed set | no | enum |
| command/action alternatives | no | enum/sealed type |
| ID | rarely | typed ID record |
| machine code | no raw | value object + regex |
| username | no raw | Username canonical type |
| display name | String ok with policy | DisplayName type if important |
| reason/comment | String ok with validation | Reason value object |
| token/password | avoid raw where possible | secret wrapper/masked type |
| money amount | no | Money/BigDecimal/minor unit |
| date/time | no | java.time type |
| config boolean | no raw string | strict parser/config type |
| cache key | maybe | typed key record |
| SQL | no concat | prepared statement |
| natural language sort | String + Collator | Collator comparator |
| large text file | no huge String | streaming |

---

# 34. Latihan

## Latihan 1 — String identity

Run:

```java
String a = "hello";
String b = "hello";
String c = new String("hello");

System.out.println(a == b);
System.out.println(a == c);
System.out.println(a.equals(c));
```

Explain.

## Latihan 2 — Compile-time vs runtime concat

```java
String a = "hello";
String b = "he" + "llo";

String prefix = "he";
String c = prefix + "llo";

System.out.println(a == b);
System.out.println(a == c);
System.out.println(a.equals(c));
```

Explain.

## Latihan 3 — Intern

```java
String c = new String("hello");
String i = c.intern();

System.out.println(i == "hello");
```

Explain.

## Latihan 4 — Immutability

```java
String name = " fajar ";
name.strip();
System.out.println(name);
name = name.strip();
System.out.println(name);
```

Explain.

## Latihan 5 — Concatenation loop

Build string from 100_000 numbers using `+=` and `StringBuilder`. Benchmark with JMH if possible.

## Latihan 6 — Turkish locale

```java
Locale.setDefault(Locale.forLanguageTag("tr"));
System.out.println("ID".toLowerCase());
System.out.println("ID".toLowerCase(Locale.ROOT));
```

Explain.

## Latihan 7 — Regex split

```java
System.out.println(Arrays.toString("a.b.c".split(".")));
System.out.println(Arrays.toString("a.b.c".split("\\.")));
```

Explain.

## Latihan 8 — Boolean parsing

```java
System.out.println(Boolean.parseBoolean("true"));
System.out.println(Boolean.parseBoolean("treu"));
```

Write strict boolean parser.

## Latihan 9 — Domain type

Implement:

```java
PolicyCode
CaseId
AccessToken
RejectionReason
```

with validation and safe toString.

## Latihan 10 — Cache key

Refactor string concatenated cache key into record:

```java
record SearchCacheKey(TenantId tenantId, UserId userId, QueryHash queryHash) {}
```

## Latihan 11 — Sensitive toString

Create record with password/token and observe generated toString. Override it.

## Latihan 12 — Unicode length

Compare:

```java
"hello".length()
"😄".length()
"😄".codePointCount(0, "😄".length())
```

Explain.

---

# 35. Ringkasan

`String` adalah salah satu type paling penting di Java.

Ia adalah:

```text
reference type
final class
immutable
UTF-16 code unit sequence
interned for literals
content-comparable with equals
excellent key technically
dangerous if used as universal domain type
```

Hal penting:

- String literal diintern.
- `==` membandingkan identity, bukan content.
- `equals` membandingkan content.
- String immutable, thread-safe, dan cocok sebagai key.
- String operations return new strings.
- Concatenation in loops can be expensive.
- `StringBuilder` is mutable and good for dynamic construction.
- Compact strings reduce memory for Latin-1-compatible content but are implementation detail.
- `String.intern` can help only after measurement and can hurt memory.
- `String` for secrets is risky because immutable and hard to clear.
- Raw String for status/action/ID/code is stringly typed anti-pattern.
- Domain-specific String types improve validation, safety, and readability.
- Boundary string handling must define normalization, locale, length, charset, collation, and security policy.

Senior Java engineer tidak bertanya hanya:

```text
Is this a String?
```

Mereka bertanya:

```text
What kind of string?
Display text?
Machine key?
Identifier?
Secret?
Code?
External input?
Canonical value?
Search key?
Can it be blank?
Can it contain Unicode?
What is its length unit?
Can it be logged?
```

Itulah cara menjadikan `String` safe data type, bukan sumber bug production tersembunyi.

---

# 36. Referensi

1. Java SE 25 API — `String`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html

2. Java SE 25 API — `StringBuilder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StringBuilder.html

3. Java SE 25 API — `StringBuffer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StringBuffer.html

4. Java SE 25 API — `CharSequence`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/CharSequence.html

5. Java SE 25 API — `StringJoiner`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/StringJoiner.html

6. Java SE 25 API — `Formatter`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Formatter.html

7. Java SE 25 API — `Normalizer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Normalizer.html

8. Java SE 25 API — `Collator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Collator.html

9. Java SE 25 API — `Pattern`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html

10. JEP 254 — Compact Strings  
    https://openjdk.org/jeps/254

11. Java SE 9 Release Notes — Compact Strings  
    https://www.oracle.com/java/technologies/javase/9-new-features.html

12. Java Language Specification SE 25 — String Literals  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-3.html#jls-3.10.5

13. Java Language Specification SE 25 — String Concatenation Operator  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.18.1
