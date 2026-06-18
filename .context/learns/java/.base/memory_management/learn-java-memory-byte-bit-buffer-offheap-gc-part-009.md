# learn-java-memory-byte-bit-buffer-offheap-gc-part-009

# Arrays, Strings, Compact Strings, Charsets, and Memory Footprint

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `009`  
> Topik: Arrays, Strings, Compact Strings, Charsets, and Memory Footprint  
> Target Java: 8 sampai 25  
> Fokus: memahami bagaimana array dan string benar-benar mengonsumsi memory, bagaimana representasi berubah sejak Java 9, bagaimana charset/encoding menyebabkan allocation, dan bagaimana mendesain sistem text-heavy yang lebih hemat memory.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

1. bit, byte, word, alignment, endianness;
2. primitive memory semantics;
3. object layout;
4. reference graph dan `CompressedOops`;
5. stack, heap, metaspace, native memory;
6. allocation mechanics;
7. object lifetime;
8. strong/soft/weak/phantom reference dan `Cleaner`.

Bagian ini menggabungkan semuanya pada salah satu sumber memory pressure paling umum di Java production system:

```text
array + String + text encoding
```

Banyak service Java tidak kehabisan memory karena object domain yang kompleks. Mereka kehabisan memory karena:

```text
String ID
String status
String JSON
String XML
String log line
String exception message
String cache key
String SQL
String path
String header
String token
String enum-like value
String temporary conversion dari byte[]
```

Sistem modern sering tampak seperti sistem object-oriented, tetapi secara memory sering lebih dekat ke:

```text
text pipeline yang kebetulan dibungkus object graph
```

Bagian ini penting karena kesalahan kecil di area string bisa berubah menjadi:

- heap footprint membengkak;
- GC pause meningkat;
- old generation cepat penuh;
- cache jauh lebih mahal dari perkiraan;
- latency naik karena encoding/decoding berulang;
- memory leak terlihat seperti “data normal”; 
- JSON/XML processing menyebabkan allocation storm;
- observability/logging menghabiskan memory sebelum business logic.

---

## 1. Core Mental Model

Array dan string harus dipahami pada dua level sekaligus:

```text
Language-level view
  ↓
Apa yang terlihat di Java source code

Runtime-level view
  ↓
Object header, backing array, reference, coder, padding, deduplication, GC reachability
```

Contoh sederhana:

```java
String s = "ACEAS";
```

Secara source code, ini tampak seperti satu nilai text.

Secara runtime, konsepnya bisa melibatkan:

```text
String object
  ├── object header
  ├── fields: hash/hashIsZero/coder/value reference, tergantung versi JDK
  └── backing byte[] atau char[]
        ├── array header
        ├── length
        └── element storage
```

Pada Java 8, `String` secara umum berbasis `char[]`.

Pada Java 9+, melalui Compact Strings, representasi internal berubah menjadi `byte[]` + flag encoding internal. String yang cukup direpresentasikan sebagai Latin-1 dapat memakai 1 byte per karakter, sedangkan string yang membutuhkan UTF-16 memakai 2 byte per karakter.

Secara public API, `String` tetap merepresentasikan sequence UTF-16 code units. Jadi ada perbedaan penting:

```text
Public semantic contract:
  String berperilaku sebagai UTF-16 code-unit sequence.

Internal storage optimization:
  JVM/JDK boleh menyimpan content sebagai Latin-1 byte[] jika aman.
```

Ini salah satu mental model paling penting pada Java 9+:

```text
String bukan lagi selalu char[] secara fisik,
tetapi API-nya tetap berbasis char/code unit semantics.
```

---

## 2. Array: Object yang Sangat Sering Diremehkan

Array di Java adalah object.

Artinya array memiliki:

```text
object header
array length field
payload elements
padding/alignment
```

Misalnya:

```java
byte[] bytes = new byte[10];
int[] ints = new int[10];
Object[] refs = new Object[10];
```

Ketiganya sama-sama object, tetapi payload-nya berbeda.

### 2.1 Primitive Array

Primitive array menyimpan value secara contiguous.

Contoh konseptual:

```text
int[]
┌───────────────┬────────┬─────┬─────┬─────┬─────┐
│ object header │ length │ i0  │ i1  │ i2  │ ... │
└───────────────┴────────┴─────┴─────┴─────┴─────┘
```

Keuntungannya:

- locality bagus;
- tidak ada pointer chasing per element;
- GC hanya perlu melacak satu object array, bukan setiap primitive;
- cocok untuk data dense;
- cocok untuk numeric processing;
- cocok untuk bitmap, counters, histograms, offsets.

Kekurangannya:

- fixed length;
- resizing butuh allocation array baru;
- copy bisa mahal untuk array besar;
- sparse data bisa boros;
- array besar bisa masuk kategori humongous pada G1, tergantung ukuran region dan threshold.

### 2.2 Reference Array

`Object[]`, `String[]`, `MyDto[]` tidak menyimpan object-nya langsung. Mereka menyimpan reference.

```text
String[]
┌───────────────┬────────┬──────┬──────┬──────┐
│ object header │ length │ ref0 │ ref1 │ ref2 │
└───────────────┴────────┴──────┴──────┴──────┘
                         │      │      │
                         ▼      ▼      ▼
                      String String String
```

Konsekuensinya:

```text
String[1_000_000]
```

bukan berarti ada satu juta string inline di array. Yang ada:

```text
1 array besar berisi 1 juta reference
+ N object String
+ N backing arrays
```

Ini sangat penting untuk memory estimation.

### 2.3 Array of Objects vs Object of Arrays

Model umum OOP:

```java
final class Record {
    long id;
    int status;
    long timestamp;
}

Record[] records;
```

Layout konseptual:

```text
Record[] refs
  ├── ref -> Record(id,status,timestamp)
  ├── ref -> Record(id,status,timestamp)
  └── ref -> Record(id,status,timestamp)
```

Jika data sangat besar, bentuk ini menghasilkan:

- banyak object header;
- banyak reference;
- pointer chasing;
- locality buruk;
- GC marking lebih mahal;
- cache miss lebih banyak.

Alternatif data-oriented:

```java
long[] ids;
int[] statuses;
long[] timestamps;
```

Layout:

```text
ids:        [id0, id1, id2, ...]
statuses:  [s0,  s1,  s2,  ...]
timestamps:[t0,  t1,  t2,  ...]
```

Keunggulan:

- locality lebih baik;
- memory overhead lebih rendah;
- scanning lebih cepat;
- GC lebih ringan karena hanya beberapa array besar.

Trade-off:

- API kurang object-oriented;
- lebih mudah salah index;
- update multi-array harus menjaga invariant;
- domain modeling menjadi kurang ekspresif.

Mental model top engineer:

```text
Gunakan object graph untuk behavior-rich domain.
Gunakan primitive arrays untuk data-heavy hot path.
```

---

## 3. Array Memory Footprint: Estimasi Praktis

Anggap JVM 64-bit dengan compressed oops dan object alignment 8 byte. Angka aktual bisa berbeda tergantung JVM, flag, dan layout, tetapi model ini cukup untuk reasoning.

Secara kasar:

```text
array size = header + length + element_size * length + padding
```

Contoh kasar:

```java
byte[] a = new byte[1000];
```

Payload 1000 byte, tetapi total footprint bukan persis 1000 byte.

Ada:

```text
object header + length + payload + alignment padding
```

Untuk array kecil, overhead relatif besar.

Contoh:

```java
byte[] one = new byte[1];
```

Payload hanya 1 byte, tetapi object-nya bisa sekitar puluhan byte karena header dan padding.

Pelajaran penting:

```text
Banyak array kecil jauh lebih mahal daripada satu array besar.
```

Ini sering terjadi pada:

- tokenization;
- parsing CSV;
- parsing JSON;
- split string;
- per-row byte array;
- per-field char/byte copy;
- encoding tiap value secara individual.

---

## 4. `String` sebagai Object: Bukan Sekadar Text

`String` adalah immutable object.

Sifat utama:

- immutable;
- final class;
- menyimpan sequence character secara logical;
- memiliki hash caching;
- bisa diintern;
- banyak method menghasilkan `String` baru;
- backing storage-nya berbeda antara Java 8 dan Java 9+.

Secara konseptual:

```text
String
  ├── object header
  ├── reference ke backing storage
  ├── hash cache
  ├── encoding/coder metadata pada Java 9+
  └── fields internal lain tergantung versi implementasi
```

Yang sering dilupakan:

```text
String object dan backing array adalah dua object berbeda.
```

Jadi satu string bukan cuma satu allocation.

Contoh:

```java
String s = new String("abc");
```

Bisa melibatkan:

- literal string dari string pool;
- object `String` baru;
- mungkin copy/berbagi backing storage tergantung versi dan constructor behavior.

Dalam production reasoning, jangan menganggap:

```text
1 char = 2 bytes
```

lalu selesai. Itu terlalu dangkal.

Yang perlu dihitung:

```text
String object overhead
+ backing array overhead
+ payload bytes/chars
+ alignment
+ duplicate content
+ references dari container
+ retention path
```

---

## 5. Java 8 String vs Java 9+ Compact Strings

### 5.1 Java 8: `char[]`-centric Mental Model

Pada Java 8, mental model umum untuk `String` adalah:

```text
String object
  └── char[] value
```

Setiap `char` adalah 16-bit UTF-16 code unit.

Untuk text ASCII/Latin-only seperti:

```text
application
status
ACTIVE
PENDING
customerId
transactionId
```

Java 8 tetap memakai 2 byte per code unit di backing array.

Jadi text yang sebenarnya cukup 1 byte per karakter tetap memakai storage 2 byte per karakter.

### 5.2 Java 9+: Compact Strings

Compact Strings mengubah internal representation dari `String` dari `char[]` menjadi:

```text
byte[] value + coder flag
```

Coder menandakan apakah content disimpan sebagai:

```text
LATIN1   -> 1 byte per character untuk karakter Latin-1
UTF16    -> 2 bytes per code unit untuk content yang tidak muat Latin-1
```

Contoh:

```java
String a = "ACTIVE";        // kemungkinan LATIN1
String b = "école";         // masih bisa LATIN1 untuk é
String c = "こんにちは";     // butuh UTF16
String d = "😀";            // butuh UTF16 / surrogate pair semantics
```

Penting:

```text
Compact Strings tidak mengubah semantic public String.
```

`String.length()` tetap menghitung UTF-16 code units, bukan jumlah user-perceived characters.

Contoh:

```java
String emoji = "😀";
System.out.println(emoji.length());      // 2
System.out.println(emoji.codePointCount(0, emoji.length())); // 1
```

### 5.3 Dampak Compact Strings terhadap Footprint

Untuk sistem text-heavy berisi banyak ASCII/Latin string:

```text
Java 9+ bisa mengurangi payload backing storage string secara signifikan.
```

Tetapi jangan salah paham:

```text
Compact Strings menghemat payload,
bukan menghilangkan object overhead.
```

Jika sistem memiliki 10 juta string kecil seperti ID/status pendek, overhead object dan array header bisa tetap dominan.

Contoh konseptual:

```text
String "OK"
```

Payload mungkin hanya 2 byte dengan compact string.

Tetapi total footprint melibatkan:

- `String` object;
- backing `byte[]` object;
- headers;
- alignment;
- reference dari container.

Jadi untuk string kecil, payload hemat belum tentu cukup. Yang lebih penting bisa jadi:

```text
mengurangi jumlah String object
mengurangi duplikasi content
mengganti String dengan enum/int code
menghindari materialisasi field yang tidak perlu
```

---

## 6. Public UTF-16 Semantics: Code Unit vs Code Point vs Grapheme

Java `String` API secara historis berbasis UTF-16.

Istilah penting:

```text
code unit
  unit encoding UTF-16, di Java direpresentasikan sebagai char 16-bit

code point
  nilai Unicode scalar/conceptual character, misalnya U+1F600

grapheme cluster
  unit yang dirasakan user sebagai satu karakter visual
```

Contoh:

```java
String s = "😀";

System.out.println(s.length()); // 2 code units
System.out.println(s.codePointCount(0, s.length())); // 1 code point
```

Emoji tersebut berada di luar Basic Multilingual Plane, sehingga direpresentasikan sebagai surrogate pair:

```text
high surrogate + low surrogate
```

Kesalahan umum:

```java
for (int i = 0; i < s.length(); i++) {
    char c = s.charAt(i);
    // salah jika diasumsikan satu char == satu karakter manusia
}
```

Lebih aman untuk code point processing:

```java
for (int i = 0; i < s.length(); ) {
    int cp = s.codePointAt(i);
    // process cp
    i += Character.charCount(cp);
}
```

Untuk grapheme cluster seperti kombinasi huruf + accent atau emoji sequence, code point pun belum cukup. Itu biasanya perlu library/logic Unicode text boundary yang lebih spesifik.

Mental model:

```text
String.length() bukan jumlah karakter manusia.
char bukan karakter Unicode penuh.
byte count bukan char count.
code point count bukan selalu visual glyph count.
```

---

## 7. `String.substring`: Dari Historical Trap ke Modern Copy

Pada Java lama sebelum perubahan historis di sekitar Java 7u6, `substring` pernah berbagi backing array dengan string asal melalui offset/count. Ini dapat menyebabkan memory retention besar:

```java
String huge = readHugeText();
String small = huge.substring(10, 20);
```

Jika `small` berbagi backing array `huge`, maka `huge` tidak bisa dilepas walaupun hanya 10 karakter yang dibutuhkan.

Pada Java modern, `substring` membuat string baru dengan storage yang sesuai untuk substring tersebut, sehingga historical leak itu tidak lagi berlaku dalam bentuk lama.

Tetapi pelajaran mental model-nya tetap relevan:

```text
Small view over large data can retain large memory.
```

Ini masih terjadi di tempat lain:

- `ByteBuffer.slice()`;
- Netty `ByteBuf.slice()`;
- memory segment slicing jika lifetime arena besar;
- custom parser yang menyimpan reference ke large source buffer;
- JSON parser yang menyimpan view ke original char/byte array;
- mmap slice/reference.

Jadi walaupun `String.substring` modern sudah lebih aman, pola retention-nya tetap perlu dipahami.

---

## 8. `String.intern()` dan String Pool

`String.intern()` mengembalikan canonical representation untuk content string tertentu.

Konsepnya:

```text
Jika pool sudah punya string dengan content sama:
  return reference pool tersebut

Jika belum:
  tambahkan / gunakan string tersebut sebagai canonical entry
```

Contoh:

```java
String a = new String("ACTIVE");
String b = a.intern();
String c = "ACTIVE";

System.out.println(b == c); // true
```

### 8.1 Kapan Interning Berguna

Interning bisa membantu ketika:

- ada banyak string duplicate;
- vocabulary terbatas;
- string berumur panjang;
- identity comparison berguna setelah canonicalization;
- data seperti status/type/country/code/category sangat repetitif.

Contoh kandidat:

```text
ACTIVE / INACTIVE
PENDING / APPROVED / REJECTED
SG / ID / MY
module codes
permission names
short enum-like labels
```

### 8.2 Kapan Interning Berbahaya

Interning bisa buruk jika:

- string cardinality tinggi;
- string unique seperti UUID/requestId/token;
- string hanya hidup sebentar;
- input tidak trusted dan bisa menyebabkan pool membesar;
- digunakan sebagai pengganti cache policy;
- semua string diintern tanpa observasi.

Anti-pattern:

```java
String requestId = incomingRequestId.intern(); // buruk jika hampir selalu unique
```

Masalahnya:

```text
Interning mengubah temporary string menjadi kandidat long-lived canonical state.
```

Jika cardinality tidak terkendali, pool bisa menjadi sumber memory pressure.

### 8.3 Interning vs Enum vs Dictionary Encoding

Untuk value terbatas, sering lebih baik:

```java
enum Status {
    ACTIVE, INACTIVE, PENDING
}
```

Atau internal code:

```java
byte statusCode;
```

Daripada menyimpan string status berulang-ulang pada jutaan record.

Trade-off:

| Teknik | Kelebihan | Risiko |
|---|---|---|
| raw String | mudah, fleksibel | memory boros, typo, duplicate |
| intern | mengurangi duplicate content | pool pressure, cardinality risk |
| enum | type-safe, bounded | schema harus stabil |
| byte/int code | sangat hemat | butuh mapping dan validasi |
| dictionary encoding | hemat untuk large dataset | kompleksitas lebih tinggi |

Mental model:

```text
Interning adalah canonicalization, bukan garbage collection strategy.
```

---

## 9. G1 String Deduplication

G1 memiliki fitur String Deduplication yang bertujuan mengurangi duplicate backing storage untuk string dengan content sama.

Konsep penting:

```text
Yang dideduplicate bukan String object-nya,
tetapi backing character/byte array-nya.
```

Kenapa bukan object `String`?

Karena object identity dapat diamati oleh aplikasi:

```java
s1 == s2
synchronized (s1) { ... }
System.identityHashCode(s1)
```

Jika JVM diam-diam mengganti dua object `String` menjadi satu object yang sama, semantic aplikasi bisa berubah. Tetapi mengganti backing storage internal yang tidak terekspos secara public bisa dilakukan sebagai optimasi.

### 9.1 Perbedaan Deduplication dan Interning

| Aspek | Interning | G1 String Deduplication |
|---|---|---|
| Level | API/application-visible canonical string | GC/runtime optimization |
| Mengubah identity String? | bisa membuat caller memakai canonical object | tidak menyatukan String object |
| Target | literal/dynamic string yang diintern | duplicate backing storage |
| Collector | umum secara konsep | fitur G1 |
| Risiko | pool cardinality | CPU/GC overhead |

### 9.2 Kapan Deduplication Membantu

Membantu pada workload dengan:

- banyak duplicate string;
- string cukup long-lived;
- banyak data text repetitif;
- cache besar berisi repeated field values;
- deserialization dari database/JSON yang membuat duplicate strings.

Contoh:

```text
10 juta row dengan status = "ACTIVE"
10 juta DTO dengan country = "SG"
1 juta permission entries dengan repeated module name
```

### 9.3 Kapan Deduplication Kurang Membantu

Kurang membantu jika:

- string mayoritas unique;
- string sangat short-lived;
- allocation bottleneck bukan retained duplicate storage;
- overhead dedup lebih besar dari penghematan;
- service tidak memakai G1 atau fitur tidak aktif.

Mental model:

```text
String dedup membantu retained duplicate text.
Ia tidak menyelesaikan allocation storm temporary string.
```

---

## 10. `StringBuilder`, `StringBuffer`, dan Intermediate String

`String` immutable. Operasi concatenation bisa menghasilkan intermediate object jika tidak dioptimalkan.

Modern Java compiler/runtime punya optimasi string concatenation, tetapi mental model tetap perlu hati-hati dalam loop dan hot path.

### 10.1 `StringBuilder`

`StringBuilder` adalah mutable sequence, tidak synchronized.

Cocok untuk:

- membangun string lokal dalam satu thread;
- loop;
- formatting manual ringan;
- query/text assembly yang bounded.

Contoh:

```java
StringBuilder sb = new StringBuilder(128);
for (String item : items) {
    sb.append(item).append(',');
}
return sb.toString();
```

Pre-sizing penting:

```java
new StringBuilder(expectedSize)
```

Karena growth internal dapat menyebabkan array baru dan copy.

### 10.2 `StringBuffer`

`StringBuffer` synchronized.

Saat ini jarang diperlukan kecuali API lama atau shared mutable sequence yang benar-benar butuh synchronization.

Dalam kebanyakan kode modern:

```text
Prefer StringBuilder untuk local construction.
Avoid sharing mutable builder across threads.
```

### 10.3 `StringJoiner` dan `Collectors.joining`

Bagus untuk readability, tetapi pada hot path perlu observasi allocation.

```java
String joined = list.stream().collect(Collectors.joining(","));
```

Ini readable, tetapi jika dipakai dalam loop besar atau per-request intensif, ukur allocation rate.

### 10.4 Logging String Construction

Anti-pattern:

```java
log.debug("payload = " + expensiveToString(payload));
```

Jika debug disabled, expression bisa tetap dievaluasi sebelum call, tergantung bentuknya.

Lebih baik:

```java
log.debug("payload = {}", payload);
```

Tetapi hati-hati: jika `payload.toString()` mahal dan framework tetap memanggilnya pada path tertentu, tetap perlu observasi.

Untuk sangat mahal:

```java
if (log.isDebugEnabled()) {
    log.debug("payload = {}", expensiveToString(payload));
}
```

Mental model:

```text
Observability code juga bagian dari allocation profile.
```

---

## 11. Charset dan Encoding: Tempat Byte Menjadi Text

Sistem produksi jarang hidup hanya di `String`.

Data datang sebagai bytes:

- HTTP request body;
- database wire protocol;
- Kafka/RabbitMQ message;
- file;
- socket;
- compressed payload;
- encrypted payload;
- object storage.

Kemudian diubah menjadi text:

```text
byte[] / ByteBuffer
  ↓ decode using Charset
String / char sequence
```

Dan sebaliknya:

```text
String
  ↓ encode using Charset
byte[] / ByteBuffer
```

Setiap crossing bisa menghasilkan allocation.

### 11.1 `Charset`, `CharsetDecoder`, `CharsetEncoder`

`CharsetDecoder` mengubah byte sequence dari charset tertentu menjadi sequence Unicode character.

`CharsetEncoder` mengubah character sequence menjadi byte sequence.

Contoh sederhana:

```java
byte[] bytes = input.getBytes(StandardCharsets.UTF_8);
String s = new String(bytes, StandardCharsets.UTF_8);
```

Pada hot path, ini bisa berarti:

```text
allocate byte[]
allocate String
allocate backing storage
possibly allocate temporary decoder/encoder structures
```

### 11.2 Default Charset Trap

Hindari:

```java
new String(bytes)
text.getBytes()
```

Karena memakai default charset platform/runtime.

Lebih eksplisit:

```java
new String(bytes, StandardCharsets.UTF_8)
text.getBytes(StandardCharsets.UTF_8)
```

Mental model:

```text
Charset adalah bagian dari protocol contract.
Jangan jadikan environment default sebagai protocol.
```

### 11.3 ASCII, Latin-1, UTF-8, UTF-16

Ringkas:

| Encoding | Karakteristik |
|---|---|
| ASCII | 7-bit, subset sangat kecil |
| ISO-8859-1 / Latin-1 | 1 byte per char untuk 256 code points awal |
| UTF-8 | variable length, sangat umum untuk network/file |
| UTF-16 | 2 atau 4 byte via surrogate pair, Java String semantic berbasis code unit UTF-16 |

Kesalahan umum:

```text
Jumlah karakter != jumlah byte.
String.length() != UTF-8 byte length.
```

Contoh:

```java
String s = "é";
System.out.println(s.length()); // 1 UTF-16 code unit
System.out.println(s.getBytes(StandardCharsets.UTF_8).length); // 2 bytes
```

Contoh emoji:

```java
String s = "😀";
System.out.println(s.length()); // 2 UTF-16 code units
System.out.println(s.codePointCount(0, s.length())); // 1 code point
System.out.println(s.getBytes(StandardCharsets.UTF_8).length); // 4 bytes
```

---

## 12. Text-heavy Memory Patterns di Production

### 12.1 JSON Materialization

JSON-heavy service sering melakukan pipeline seperti:

```text
byte[] body
  ↓ decode
String json
  ↓ parse
Map/List/DTO object graph
  ↓ validation
new strings for fields
  ↓ log/debug/error message
more strings
  ↓ serialize response
byte[] response
```

Masalahnya bukan hanya JSON parsing.

Masalahnya adalah materialisasi berlapis:

```text
bytes + String + tokens + DTO + field strings + response string + response bytes
```

Jika payload besar, puncak memory per request bisa jauh lebih besar dari ukuran request body.

Contoh mental estimate:

```text
1 MB JSON request
```

Bisa sementara menjadi:

```text
1 MB input byte[]
+ 1-2 MB String/backing storage
+ parser buffers
+ object graph DTO
+ field strings
+ validation errors
+ response object
+ response byte[]
```

Puncak memory bisa beberapa kali ukuran payload asli.

### 12.2 XML Lebih Berat

XML sering lebih boros karena:

- tag names berulang;
- namespace;
- attribute;
- DOM materialization;
- whitespace;
- validation metadata;
- character normalization.

DOM parsing sangat berbahaya untuk payload besar karena membuat full tree di memory.

Streaming parser seperti SAX/StAX bisa lebih hemat jika model pemrosesan memungkinkan.

### 12.3 Logs sebagai Memory Pressure

Log line adalah string.

Exception stack trace adalah text.

MDC values adalah string.

Structured logging bisa membuat temporary map/string/JSON.

Anti-pattern:

```java
log.info("Huge payload: {}", payloadAsString);
```

Atau lebih buruk:

```java
log.error("Failed payload=" + requestBodyAsString, ex);
```

Risiko:

- payload sensitive masuk log;
- memory allocation besar;
- GC pressure;
- disk/network logging pressure;
- observability backend mahal.

Prinsip:

```text
Log identifiers and facts, not full payloads by default.
```

---

## 13. Cache Key, Map Key, dan String Footprint

`String` sering digunakan sebagai key:

```java
Map<String, Value> cache;
```

Ini nyaman, tetapi mahal jika key banyak dan duplicate.

### 13.1 Key Composition Anti-pattern

```java
String key = tenantId + ":" + module + ":" + objectId;
cache.put(key, value);
```

Ini menghasilkan composite string.

Jika dibuat per request, bisa ada:

- `StringBuilder`/concat allocation;
- final key string;
- backing storage;
- duplicate prefix berulang;
- old-gen retention jika cache long-lived.

Alternatif:

```java
record CacheKey(String tenantId, String module, long objectId) {}
```

Tetapi record object juga punya overhead.

Alternatif lebih hemat pada hot path:

```java
record CacheKey(int tenantCode, short moduleCode, long objectId) {}
```

Atau packed long jika domain memungkinkan.

### 13.2 Canonicalization untuk Repeated Dimensions

Jika `tenantId` dan `module` berulang, bisa canonicalize dimension:

```text
tenant string -> tenant int code
module string -> module short code
```

Lalu key runtime menjadi numeric.

Trade-off:

- butuh registry mapping;
- migration lebih kompleks;
- perlu validation;
- debugging perlu helper.

Tetapi untuk jutaan entry, memory saving bisa besar.

---

## 14. `String.split`, Regex, dan Hidden Allocation

`String.split(regex)` memakai regex.

Contoh:

```java
String[] parts = line.split(",");
```

Ini tampak sederhana, tetapi bisa menghasilkan:

- regex processing;
- array `String[]`;
- substring strings;
- backing arrays;
- temporary matcher structures.

Untuk hot path CSV sederhana, manual parser atau library streaming bisa lebih efisien.

Contoh manual sederhana:

```java
static int countCommas(String s) {
    int count = 0;
    for (int i = 0; i < s.length(); i++) {
        if (s.charAt(i) == ',') count++;
    }
    return count;
}
```

Bukan berarti semua regex buruk. Regex sangat berguna untuk correctness dan readability. Tetapi pada hot path, regex bisa menjadi allocation source besar.

Mental model:

```text
Convenience text API sering menyembunyikan object creation.
```

---

## 15. Arrays and Strings in GC Terms

GC tidak peduli bahwa string itu “cuma text”. GC melihat object graph.

Contoh:

```java
List<String> names = new ArrayList<>();
```

Graph:

```text
ArrayList
  └── Object[] elementData
        ├── ref -> String -> byte[]
        ├── ref -> String -> byte[]
        └── ref -> String -> byte[]
```

Jika list long-lived, semua string dan backing arrays reachable.

### 15.1 Duplicate String and Live Set

GC cost banyak ditentukan oleh live set.

Duplicate long-lived string meningkatkan:

- heap occupancy;
- old-gen pressure;
- marking cost;
- remembered-set/card cost jika ada update references;
- heap dump size;
- cache miss.

### 15.2 Short-lived String and Allocation Rate

Temporary string meningkatkan:

- young allocation rate;
- young GC frequency;
- CPU untuk allocation/zeroing/copying;
- promotion risk jika survive beberapa cycle.

Jadi ada dua masalah berbeda:

```text
Duplicate long-lived strings -> live set problem.
Temporary strings -> allocation rate problem.
```

Solusinya berbeda.

| Problem | Gejala | Solusi umum |
|---|---|---|
| temporary strings | young GC sering, allocation tinggi | reduce intermediate strings, streaming, builder reuse local, avoid split/regex |
| duplicate long-lived strings | old gen besar, retained size tinggi | canonicalization, enum/code, G1 string dedup, cache redesign |
| large text payload | puncak heap tinggi | streaming parse, bounded payload, avoid full materialization |
| string cache key besar | cache memory mahal | numeric key, structured key, dictionary encoding |

---

## 16. Compact Strings: Jangan Salah Mengambil Kesimpulan

Compact Strings sering membuat orang berpikir:

```text
String memory problem sudah selesai di Java 9+.
```

Ini salah.

Compact Strings membantu payload storage untuk Latin-1-compatible content.

Tetapi tidak menghilangkan:

- `String` object overhead;
- backing array object overhead;
- duplicate strings;
- temporary allocation;
- container reference overhead;
- JSON/XML object graph;
- cache retention;
- encoding/decoding cost;
- non-Latin content UTF-16 storage.

Contoh:

```text
1 juta String unik masing-masing 5 karakter ASCII
```

Payload memang kecil, tetapi object overhead tetap besar.

Lebih buruk lagi:

```text
1 juta String unique requestId
```

Tidak bisa banyak dibantu deduplication karena content berbeda.

Mental model:

```text
Compact Strings mengurangi cost per payload byte,
tetapi tidak memperbaiki desain yang membuat terlalu banyak text object.
```

---

## 17. Design Pattern: Text Boundary, Binary Core

Salah satu prinsip desain memory-aware:

```text
Text at the boundary, typed/binary representation inside.
```

Contoh buruk:

```java
final class CaseRecord {
    String status;
    String priority;
    String agencyCode;
    String createdEpochMillis;
}
```

Lebih baik:

```java
final class CaseRecord {
    Status status;
    Priority priority;
    short agencyCode;
    long createdEpochMillis;
}
```

Atau untuk data-heavy batch:

```java
byte[] statuses;
byte[] priorities;
short[] agencyCodes;
long[] createdEpochMillis;
```

Text tetap diperlukan untuk:

- API boundary;
- database input/output;
- logs;
- UI;
- protocol;
- human-readable report.

Tetapi internal computation sebaiknya memakai type yang lebih compact dan semantically constrained.

Prinsip:

```text
Parse once.
Validate once.
Store typed form.
Format at the edge.
```

---

## 18. Memory Budget per String-heavy Record

Misalnya kita punya record:

```java
record PersonDto(
    String id,
    String name,
    String status,
    String country,
    String createdAt
) {}
```

Jika ada 1 juta record, jangan hanya hitung 5 juta field.

Hitung:

```text
1 juta PersonDto object
+ references untuk 5 string fields
+ 5 juta String object
+ 5 juta backing arrays
+ container/list/array overhead
+ duplicate values
```

Jika `status` hanya 5 kemungkinan dan `country` hanya 200 kemungkinan, menyimpan raw string per record itu boros.

Optimasi bertahap:

1. Ganti `status` menjadi enum/byte.
2. Ganti `country` menjadi short code/dictionary.
3. Simpan `createdAt` sebagai epoch `long`, bukan ISO date string.
4. Untuk `id`, pertimbangkan binary UUID jika format memungkinkan.
5. Untuk `name`, tetap String karena memang text variable.

Hasilnya:

```java
record PersonCompact(
    UUID id,
    String name,
    byte statusCode,
    short countryCode,
    long createdAtEpochMillis
) {}
```

Atau jika sangat data-heavy:

```java
UUID[] ids;
String[] names;
byte[] statusCodes;
short[] countryCodes;
long[] createdAtEpochMillis;
```

---

## 19. Primitive Array vs Boxed Array vs Collection

Bandingkan:

```java
int[] a = new int[1_000_000];
Integer[] b = new Integer[1_000_000];
List<Integer> c = new ArrayList<>();
```

`int[]`:

```text
1 array object
+ 1 juta int contiguous
```

`Integer[]`:

```text
1 reference array
+ up to 1 juta Integer objects
```

`ArrayList<Integer>`:

```text
ArrayList object
+ Object[] elementData
+ up to 1 juta Integer objects
```

Kecuali values memakai cache Integer kecil, boxing bisa sangat mahal.

Untuk text-heavy system, pattern serupa terjadi:

```java
List<String>
```

adalah:

```text
ArrayList
+ Object[]
+ String objects
+ backing byte[]/char[] arrays
```

Jangan menganggap collection sebagai “satu data structure”. Collection adalah root dari graph.

---

## 20. Memory Leak Pattern: String Retention

### 20.1 Static Map

```java
static final Map<String, Object> CACHE = new HashMap<>();
```

Jika key terus bertambah:

```text
String keys hidup selamanya
value hidup selamanya
backing arrays hidup selamanya
```

### 20.2 Exception Accumulation

```java
List<Exception> failures = new ArrayList<>();
```

Exception menyimpan message, stack trace, causes, suppressed exceptions. Banyak message adalah string.

### 20.3 Request Body Stored in Context

```java
context.put("payload", requestBodyString);
```

Jika context masuk async queue atau audit cache, payload besar retained.

### 20.4 MDC Leak

MDC biasanya `ThreadLocal` berbasis map string-string.

Jika tidak dibersihkan pada pooled platform thread:

```text
request-specific string retained by thread
```

Pada virtual thread, pola retention berbeda karena virtual thread biasanya tidak reused seperti pool platform thread, tetapi tetap jangan menyimpan payload besar di scoped context.

### 20.5 Parser Keeps Source

Custom parser menyimpan original input string untuk error reporting:

```java
final class ParsedDocument {
    private final String originalSource;
    private final List<Token> tokens;
}
```

Jika `ParsedDocument` long-lived, full source ikut long-lived.

---

## 21. Heap Dump Reading for String-heavy Cases

Ketika heap dump menunjukkan banyak memory di `String`, jangan berhenti di sana.

Pertanyaan yang benar:

```text
String apa?
Siapa yang menahan?
Apakah duplicate?
Apakah temporary tapi promoted?
Apakah cache key?
Apakah payload?
Apakah log/error/audit?
Apakah field domain yang seharusnya enum/code?
```

### 21.1 Dominator Tree

Cari dominator seperti:

- `HashMap`;
- `ConcurrentHashMap`;
- `ArrayList`;
- cache implementation;
- session store;
- queue;
- thread local map;
- classloader;
- parser/document object;
- audit buffer.

### 21.2 Histogram

Class histogram bisa menunjukkan:

```text
java.lang.String
byte[]
char[] pada Java 8
Object[]
HashMap$Node
ArrayList
```

Pada Java 9+, backing string akan tampak sebagai `byte[]`, bukan `char[]` untuk Compact Strings.

Tetapi `byte[]` juga dipakai banyak hal lain:

- network buffers;
- byte arrays;
- compressed data;
- crypto;
- serialized payload;
- string backing storage.

Jadi perlu dominator/path analysis, bukan histogram saja.

### 21.3 Duplicate String Analysis

MAT dan tooling tertentu bisa membantu menemukan duplicate strings.

Tetapi interpretasinya hati-hati:

- duplicate short string mungkin tidak signifikan;
- duplicate long string bisa besar;
- duplicate string yang short-lived tidak tampak jika dump diambil setelah GC;
- dump timing memengaruhi hasil.

---

## 22. Java 8 sampai 25: Perubahan yang Relevan

### 22.1 Java 8

Relevan:

- `String` masih berbasis `char[]` secara umum;
- G1 String Deduplication tersedia sebagai fitur untuk G1;
- banyak aplikasi enterprise masih Java 8 sehingga char[] footprint tetap penting;
- PermGen sudah tidak ada, diganti Metaspace sejak Java 8.

### 22.2 Java 9

Relevan:

- Compact Strings diperkenalkan;
- internal `String` berubah ke `byte[]` + coder;
- G1 menjadi default collector untuk banyak konfigurasi server;
- module system memperketat akses internal, meskipun banyak library masih memakai reflection/Unsafe.

### 22.3 Java 11 / 17 / 21

Relevan:

- banyak aplikasi produksi pindah ke LTS ini;
- Compact Strings sudah menjadi baseline umum;
- GC logging unified sudah lazim;
- JFR semakin praktis untuk observability;
- ZGC/Shenandoah makin mature pada versi modern.

### 22.4 Java 22+

Relevan:

- Foreign Function & Memory API finalized di Java 22;
- pemrosesan off-heap/foreign memory punya API standar modern;
- ini berdampak pada desain text/binary boundary untuk sistem high-performance.

### 22.5 Java 25

Relevan:

- `String` public API tetap UTF-16 code-unit oriented;
- Compact Strings tetap baseline HotSpot modern;
- GC modern seperti G1/ZGC/Shenandoah makin penting untuk workload memory-heavy;
- jalur deprecation Unsafe memory-access mendorong library migrasi ke API standar.

---

## 23. Practical Guidelines

### 23.1 Untuk DTO/API

Gunakan `String` jika field memang text bebas.

Hindari `String` untuk:

- status bounded;
- type bounded;
- boolean-like value;
- numeric date/time;
- numeric amount;
- UUID internal binary-capable;
- repeated code yang bisa dictionary encoded.

Contoh:

```java
// Kurang baik untuk internal model
record OrderDto(String status, String createdAt, String amount) {}

// Lebih baik untuk internal model
record Order(Status status, Instant createdAt, BigDecimal amount) {}
```

Untuk data-heavy storage, bahkan `Instant` dan `BigDecimal` mungkin terlalu mahal; gunakan compact representation jika benar-benar hot path dan invariant jelas.

### 23.2 Untuk Parsing

Prinsip:

```text
Do not materialize full text if streaming is enough.
```

Contoh:

- gunakan streaming JSON parser untuk payload besar;
- hindari `readAllBytes()` + `new String(...)` untuk file besar;
- hindari DOM XML untuk document besar;
- batasi payload size;
- validasi size sebelum decoding jika memungkinkan.

### 23.3 Untuk Cache

Prinsip:

```text
Cache entry cost = key cost + value cost + container overhead + retention lifetime.
```

Untuk key string:

- ukur cardinality;
- canonicalize bounded dimensions;
- hindari key hasil concat berulang tanpa batas;
- gunakan eviction;
- jangan intern high-cardinality keys.

### 23.4 Untuk Logging

Prinsip:

```text
Log enough to diagnose, not enough to duplicate database/payload in heap/log pipeline.
```

Hindari:

- full request body;
- full response body;
- huge collection `toString()`;
- exception storm dengan message besar;
- logging inside tight loops.

### 23.5 Untuk Internationalization

Jangan asumsikan:

```text
1 char == 1 character
1 character == 1 byte
substring index == user-visible index
String.length == visual length
```

Gunakan code point API jika perlu memproses Unicode character.

Gunakan library text boundary jika perlu user-visible grapheme cluster.

---

## 24. Diagnostic Checklist

Ketika service punya memory issue dan banyak `String`/`byte[]`:

### 24.1 Pertanyaan Pertama

```text
Apakah memory tinggi karena temporary allocation atau retained live set?
```

Indikasi temporary:

- young GC sering;
- allocation rate tinggi;
- heap after full GC tidak terlalu besar;
- flamegraph menunjukkan parsing/concat/encoding.

Indikasi retained:

- old gen after GC terus naik;
- heap dump dominator menunjukkan cache/list/map;
- duplicate string banyak;
- data structure long-lived memegang string.

### 24.2 Pertanyaan Kedua

```text
String itu data domain, protocol, log, cache key, atau parser artifact?
```

Solusi tergantung sumber.

### 24.3 Pertanyaan Ketiga

```text
Apakah field tersebut seharusnya String?
```

Jika bounded, pertimbangkan enum/code.

Jika timestamp, gunakan numeric/time type.

Jika amount, gunakan numeric decimal representation.

Jika large payload, jangan simpan sebagai String long-lived.

### 24.4 Pertanyaan Keempat

```text
Apakah duplicate content cukup besar untuk dedup/canonicalization?
```

Jika iya:

- G1 String Deduplication bisa diuji;
- application-level dictionary encoding bisa lebih deterministic;
- enum/code lebih baik untuk bounded domain.

### 24.5 Pertanyaan Kelima

```text
Apakah encoding/decoding dilakukan berulang?
```

Contoh buruk:

```java
String s = new String(bytes, UTF_8);
byte[] b = s.getBytes(UTF_8);
String s2 = new String(b, UTF_8);
```

Jika pipeline sebenarnya binary, jangan bolak-balik ke string.

---

## 25. Worked Example: Memory-aware Case List

Misalnya service mengambil 500.000 case dari database untuk report.

Model awal:

```java
record CaseRow(
    String caseId,
    String status,
    String agency,
    String createdAt,
    String updatedAt,
    String applicantName,
    String payloadJson
) {}
```

Masalah:

- `status` repeated;
- `agency` repeated;
- `createdAt`/`updatedAt` string;
- `payloadJson` besar;
- semua dimaterialisasi sekaligus;
- list menahan semua row sampai report selesai.

Perbaikan bertahap:

### Step 1: Type conversion

```java
record CaseRow(
    String caseId,
    Status status,
    short agencyCode,
    long createdAtMillis,
    long updatedAtMillis,
    String applicantName
) {}
```

`payloadJson` tidak dimasukkan jika tidak dibutuhkan.

### Step 2: Streaming report

Daripada:

```java
List<CaseRow> rows = repository.findAll();
return reportGenerator.generate(rows);
```

Gunakan streaming/batch:

```java
repository.streamRows(criteria, row -> {
    reportWriter.write(row);
});
```

### Step 3: Bounded memory

Pastikan writer flush bertahap dan tidak menyimpan semua line sebagai `String`.

### Step 4: Avoid repeated formatting

Format timestamp hanya saat output, bukan disimpan sebagai string internal.

### Step 5: Observe

Ukur:

- allocation rate;
- heap after GC;
- peak RSS;
- report duration;
- p95/p99 pause;
- count rows per batch.

Mental model:

```text
Memory optimization terbaik sering bukan micro-optimizing String,
tetapi mengubah lifecycle data dari materialized-all menjadi streaming/bounded.
```

---

## 26. Worked Example: Cache with String Keys

Model awal:

```java
Map<String, Rule> rules = new ConcurrentHashMap<>();

String key = tenantId + ":" + module + ":" + ruleType + ":" + version;
rules.put(key, rule);
```

Jika ada banyak tenant/module/type/version, key string bisa besar.

Perbaikan:

```java
record RuleKey(
    int tenantId,
    short moduleCode,
    byte ruleType,
    int version
) {}
```

Atau packed key:

```java
long key = pack(tenantId, moduleCode, ruleType, version);
```

Packed key hemat, tetapi raw `long` kurang expressive.

Pilihan tergantung:

- cardinality;
- hot path;
- debugging need;
- risk salah packing;
- domain bounds.

Guideline:

```text
Jangan mulai dari packed long.
Mulai dari typed key.
Turun ke packed representation hanya jika evidence menunjukkan perlu.
```

---

## 27. Common Anti-patterns

### 27.1 Menggunakan String untuk Semua Hal

```java
Map<String, String> everything;
```

Ini fleksibel tetapi lemah secara type, validation, dan memory.

### 27.2 Menyimpan Payload Mentah dan Parsed Object Sekaligus

```java
class RequestContext {
    String rawJson;
    RequestDto parsed;
}
```

Jika raw JSON tidak dibutuhkan setelah parse, lepaskan.

### 27.3 Unbounded String Cache

```java
cache.put(userInput, value);
```

Tanpa eviction/cardinality control.

### 27.4 `split` pada Hot Path

```java
for (String line : lines) {
    String[] parts = line.split(",");
}
```

Bisa mahal. Gunakan parser yang sesuai jika data besar.

### 27.5 Repeated Encoding

```java
send(new String(bytes, UTF_8).getBytes(UTF_8));
```

Jika tidak perlu inspect text, jangan decode.

### 27.6 Logging Full Object Graph

```java
log.info("result={}", hugeResult);
```

`toString()` bisa membuat string besar.

### 27.7 Interning Untrusted Input

```java
String canonical = input.intern();
```

Jika input cardinality tak terbatas, ini memory risk.

---

## 28. Rules of Thumb

1. `String` itu mahal jika jumlahnya banyak, walaupun setiap string pendek.
2. `String` immutable, tetapi immutability tidak berarti free.
3. Java 9+ Compact Strings membantu Latin-1 content, tetapi bukan solusi semua memory problem.
4. `String.length()` menghitung UTF-16 code units, bukan user-visible characters.
5. `byte[]` di heap dump tidak selalu network buffer; bisa backing storage string.
6. Banyak string duplicate long-lived adalah live-set problem.
7. Banyak string temporary adalah allocation-rate problem.
8. `intern()` cocok untuk bounded vocabulary, bukan high-cardinality input.
9. G1 String Deduplication membantu duplicate backing storage, bukan object identity dan bukan allocation storm.
10. Text sebaiknya berada di boundary; internal representation sebaiknya typed dan compact jika domain memungkinkan.
11. Jangan decode bytes menjadi String jika pipeline tidak perlu text semantics.
12. Jangan materialize full payload jika bisa streaming.
13. Jangan menyimpan timestamp/amount/status sebagai string di internal hot model kecuali ada alasan kuat.
14. Ukur dengan heap dump, allocation profiler, GC log, JFR, bukan intuisi.

---

## 29. Mini Exercise

### Exercise 1

Anda memiliki 2 juta record:

```java
record Item(
    String id,
    String status,
    String country,
    String createdAt
) {}
```

Dengan kondisi:

- `status` hanya 6 kemungkinan;
- `country` hanya 80 kemungkinan;
- `createdAt` selalu ISO timestamp;
- `id` UUID string;
- data dipakai untuk filtering dan aggregation, bukan display langsung.

Pertanyaan:

1. Field mana yang paling jelas tidak perlu disimpan sebagai String internal?
2. Apa alternatif representasi?
3. Apakah `intern()` solusi ideal?
4. Apakah Compact Strings cukup menyelesaikan masalah?

Jawaban yang diharapkan:

1. `status`, `country`, `createdAt`, dan mungkin `id` bisa direpresentasikan lebih compact.
2. `status` -> enum/byte, `country` -> short dictionary code, `createdAt` -> long epoch millis, `id` -> UUID/binary pair of longs jika cocok.
3. `intern()` mungkin membantu `status`/`country`, tetapi enum/code lebih type-safe dan deterministic.
4. Tidak. Compact Strings mengurangi payload Latin-1, tetapi object overhead dan duplicate/retention tetap ada.

### Exercise 2

Service membaca 20 MB JSON, mengubah ke `String`, parse ke DTO, lalu menyimpan raw JSON untuk audit dalam request context.

Pertanyaan:

1. Apa puncak memory yang perlu dicurigai?
2. Apa redesign yang lebih aman?

Jawaban yang diharapkan:

1. Input bytes, string JSON, parser buffer, DTO graph, raw retained string, audit copy/logging bisa membuat peak jauh di atas 20 MB.
2. Streaming audit ke storage terpisah, bounded payload, parse streaming, jangan simpan raw string di context jika tidak perlu, simpan hash/reference/object storage key.

---

## 30. Kesimpulan

Array dan String adalah fondasi data Java, tetapi juga sumber memory pressure paling umum.

Pemahaman top-level bukan hanya:

```text
String adalah immutable
array punya length
```

Melainkan:

```text
String adalah object + backing storage + encoding semantics + possible duplicate content + GC reachability.
Array adalah object contiguous yang bisa sangat efisien atau sangat mahal tergantung bentuk graph.
Text conversion adalah allocation boundary.
Encoding adalah protocol contract.
Compact Strings membantu, tetapi desain lifecycle dan representation tetap lebih menentukan.
```

Jika harus diringkas menjadi satu prinsip:

```text
Treat text as an external representation.
Inside the system, keep data as typed, bounded, compact, and short-lived as possible.
```

---

## 31. Referensi

Referensi utama yang relevan untuk bagian ini:

1. OpenJDK JEP 254: Compact Strings  
   https://openjdk.org/jeps/254

2. OpenJDK JEP 192: String Deduplication in G1  
   https://openjdk.org/jeps/192

3. Java SE 25 API: `java.lang.String`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html

4. Java SE 25 API: `java.lang.Character`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html

5. Java SE 25 API: `java.nio.charset.CharsetDecoder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/CharsetDecoder.html

6. Oracle Java SE 25 GC Tuning Guide: Garbage-First Garbage Collector  
   https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html

7. Oracle JDK 9 New Features: Compact Strings  
   https://www.oracle.com/java/technologies/javase/9-new-features.html

---

## 32. Status Seri

```text
Part 009 selesai.
Seri belum selesai.
Masih lanjut ke part 010 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-010.md
```

Topik berikutnya:

```text
Bit Manipulation Patterns for Real Systems
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-008](./learn-java-memory-byte-bit-buffer-offheap-gc-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-010.md](./learn-java-memory-byte-bit-buffer-offheap-gc-part-010.md)

</div>