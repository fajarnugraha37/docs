# Part 4 — `String`: Semantics, Immutability, Interning, Unicode, Performance

**Series:** `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
**File:** `04-string-semantics-immutability-interning-unicode-performance.md`  
**Target Java:** Java 8 sampai Java 25  
**Fokus:** `java.lang.String` sebagai kontrak bahasa, runtime value, representasi teks, boundary API, dan sumber bug/performance/security di sistem production.

---

## 1. Tujuan Part Ini

`String` sering dianggap class paling mudah di Java karena dipakai dari hari pertama:

```java
String name = "Fajar";
System.out.println("Hello " + name);
```

Tetapi dalam sistem serius, `String` adalah salah satu tipe paling penting dan paling berbahaya untuk diremehkan.

`String` berada di persimpangan antara:

1. **Java language syntax**: literal, concatenation, switch, text block.
2. **JVM runtime**: constant pool, interning, class metadata, invokedynamic string concat sejak Java 9.
3. **Memory model**: immutability, sharing, compact strings, allocation pressure.
4. **Internationalization**: Unicode, code unit, code point, normalization, locale-sensitive behavior.
5. **Security**: spoofing, canonicalization bugs, path/string validation, secret retention.
6. **API design**: ID, code, enum external value, message, error detail, log text, protocol payload.
7. **Performance**: repeated concat, substring, regex misuse, case conversion, encoding/decoding.
8. **Production correctness**: comparing text, trimming text, parsing numbers, normalizing input, stable persistence.

Tujuan bagian ini adalah membuat kamu memahami `String` sebagai **semantic boundary object**, bukan sekadar “array of characters”.

Setelah menyelesaikan bagian ini, kamu harus mampu:

- menjelaskan kenapa `String` immutable dan apa konsekuensi desainnya;
- membedakan object identity, textual equality, lexical ordering, locale ordering, dan canonical equality;
- memahami literal pool dan `intern()` tanpa mitos;
- memahami perubahan representasi internal dari Java 8 ke Java 9+;
- memahami Unicode di level yang cukup untuk tidak membuat bug global-user-facing;
- memilih API `String`, `CharSequence`, `StringBuilder`, regex, formatter, dan encoder secara tepat;
- merancang boundary string yang defensible untuk domain, security, persistence, dan integration;
- mendeteksi failure mode `String` yang sering muncul di production.

---

## 2. Mental Model Utama

### 2.1 `String` bukan “teks manusia” secara utuh

Di Java, `String` adalah **immutable sequence of `char` values** menurut abstraksi API historisnya.

Masalahnya: `char` di Java adalah 16-bit UTF-16 code unit, bukan “karakter manusia”.

Artinya:

```java
String s = "😀";
System.out.println(s.length()); // 2, bukan 1
```

Kenapa 2? Karena emoji tersebut diwakili oleh **surrogate pair** dalam UTF-16.

Jadi mental model yang lebih benar:

```text
Human-perceived character / grapheme
    != Unicode code point
        != UTF-16 code unit / Java char
            != byte representation in memory/file/network
```

Kalau kamu memperlakukan semua itu sama, sistemmu akan terlihat benar untuk ASCII, lalu rusak untuk nama orang, alamat, emoji, bahasa non-Latin, simbol legal, dan teks copy-paste dari dokumen.

---

### 2.2 `String` adalah value-like object, tapi bukan primitive value

`String` immutable dan equality-nya berbasis isi:

```java
String a = new String("abc");
String b = new String("abc");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

Tetapi ia tetap reference type:

```java
String x = null;
```

Jadi `String` berada di posisi menarik:

```text
Reference identity exists,
but business meaning usually comes from textual value.
```

Konsekuensi:

- gunakan `equals` untuk isi;
- gunakan `==` hanya jika benar-benar ingin membandingkan identity atau constant singleton internal, yang hampir tidak pernah perlu untuk business logic;
- desain API harus jelas apakah `null`, empty string, blank string, dan absent value berbeda atau sama.

---

### 2.3 `String` adalah boundary type paling umum

Hampir semua boundary sistem menggunakan `String`:

- HTTP headers;
- query parameters;
- JSON fields;
- XML element text;
- database VARCHAR/CLOB;
- file path;
- environment variable;
- system property;
- username;
- email;
- ID eksternal;
- error message;
- log line;
- enum code;
- configuration value;
- SQL text;
- command-line argument;
- shell command;
- regular expression.

Karena itu, banyak bug besar bukan berasal dari “String API tidak tahu”, tetapi dari **boundary semantics tidak didefinisikan**.

Pertanyaan yang harus selalu muncul saat melihat `String` pada boundary:

```text
Apakah ini raw input, normalized value, display label, machine code, identifier, secret, path, regex, SQL fragment, or protocol payload?
```

Kalau jawabannya tidak jelas, tipe `String` terlalu longgar.

---

### 2.4 `String` memiliki dua wajah: stable abstraction dan changing implementation

Secara API, `String` tampak stabil dari Java 8 sampai Java 25.

Tetapi implementasi internalnya berubah besar sejak Java 9 melalui **Compact Strings**:

```text
Java 8 mental model umum:
String -> char[]

Java 9+ implementation umum:
String -> byte[] + coder flag
```

API tetap mempertahankan abstraksi UTF-16, tetapi storage internal bisa Latin-1 atau UTF-16 tergantung isi.

Pelajaran penting:

```text
Jangan membangun desain berdasarkan field internal String.
Gunakan contract API, bukan layout implementation.
```

---

## 3. `String` dalam Java Language dan JVM

### 3.1 String literal

String literal otomatis menjadi instance `String`:

```java
String s = "abc";
```

Semua literal dengan teks sama di class loading context yang sesuai dapat merujuk ke canonical interned string yang sama.

```java
String a = "abc";
String b = "abc";

System.out.println(a == b); // true, karena literal pool
```

Tetapi jangan jadikan ini pola business logic:

```java
String a = getFromRequest();
String b = "APPROVED";

// Buruk
if (a == b) { }

// Benar
if ("APPROVED".equals(a)) { }
```

`==` berhasil untuk literal tertentu karena detail interning, bukan karena equality semantics `String`.

---

### 3.2 Compile-time constant

Ekspresi literal yang bisa dihitung compile-time dapat digabung oleh compiler:

```java
String a = "ab" + "cd";
String b = "abcd";

System.out.println(a == b); // true
```

Tetapi jika melibatkan runtime value:

```java
String part = "cd";
String a = "ab" + part;
String b = "abcd";

System.out.println(a == b);      // biasanya false
System.out.println(a.equals(b)); // true
```

Mental model:

```text
Compile-time constant concat -> constant pool
Runtime concat -> runtime string construction
```

---

### 3.3 `String` dan `switch`

Java mendukung `switch` pada `String` sejak Java 7:

```java
switch (status) {
    case "DRAFT" -> handleDraft();
    case "SUBMITTED" -> handleSubmitted();
    default -> handleUnknown(status);
}
```

Secara semantik, ini berdasarkan equality isi, bukan identity. Compiler dapat mengoptimalkan dengan hash/equality dispatch.

Failure mode:

```java
switch (status.toUpperCase()) { ... }
```

Jika `status` null, NPE. Jika `toUpperCase()` tanpa `Locale.ROOT`, ada bug locale tertentu. Jika input eksternal memiliki Unicode lookalike atau whitespace tak terlihat, switch tidak cocok.

Lebih defensible:

```java
String normalized = normalizeStatusCode(status);
return switch (normalized) {
    case "DRAFT" -> Status.DRAFT;
    case "SUBMITTED" -> Status.SUBMITTED;
    default -> Status.UNKNOWN;
};
```

---

### 3.4 `String` concatenation evolution

Kode Java:

```java
String message = "User " + userId + " failed login at " + instant;
```

Di Java 8, compiler umumnya menerjemahkan concat runtime menjadi `StringBuilder` chain.

Di Java 9+, JEP 280 memperkenalkan **indify string concatenation**, yaitu translation berbasis `invokedynamic` agar strategi concat bisa dioptimalkan runtime tanpa harus mengubah bytecode pattern secara manual.

Implikasi praktis:

- untuk concat sederhana, pakai `+` saja;
- jangan premature optimize semua concat menjadi `StringBuilder`;
- untuk loop besar atau generator teks kompleks, tetap gunakan `StringBuilder`, `StringJoiner`, formatter yang tepat, atau streaming writer;
- untuk logging, gunakan parameterized logging agar tidak membangun string ketika log level mati.

Contoh buruk:

```java
for (Order order : orders) {
    csv += order.id() + "," + order.amount() + "\n";
}
```

Contoh lebih baik:

```java
StringBuilder csv = new StringBuilder(orders.size() * 64);
for (Order order : orders) {
    csv.append(order.id())
       .append(',')
       .append(order.amount())
       .append('\n');
}
```

Tetapi untuk satu baris sederhana:

```java
String label = prefix + ":" + value;
```

Ini baik-baik saja.

---

## 4. Immutability: Kenapa `String` Immutable?

### 4.1 Apa arti immutable?

Immutable berarti setelah dibuat, isi logis `String` tidak berubah.

```java
String s = "abc";
s.toUpperCase();
System.out.println(s); // abc
```

`toUpperCase()` menghasilkan object baru jika ada perubahan.

```java
String upper = s.toUpperCase(Locale.ROOT);
```

---

### 4.2 Kenapa immutability penting?

Immutability `String` mendukung banyak properti platform:

1. **Safe sharing**  
   Literal dan interned strings bisa dibagi antar kode tanpa takut dimutasi.

2. **Hash caching**  
   Karena isi stabil, hash code bisa disimpan/cached.

3. **Map key reliability**  
   `String` aman dipakai sebagai key `HashMap` karena hash/equality tidak berubah.

4. **Security**  
   Class names, file paths, URLs, permission names, environment values, dan config keys bisa ditangani sebagai value stabil.

5. **Class loading and constant pool**  
   Literal pool bergantung pada stabilitas isi.

6. **Thread safety**  
   `String` dapat dibaca dari banyak thread tanpa synchronization tambahan.

---

### 4.3 Immutability bukan berarti aman untuk semua hal

`String` immutable, tetapi tidak otomatis aman untuk menyimpan secret.

Masalah:

```java
String password = request.getParameter("password");
```

Karena immutable, kamu tidak bisa menghapus isinya dari memory secara deterministik. Ia bisa bertahan sampai GC, muncul di heap dump, log, exception, debugger, atau telemetry.

Untuk password/secret jangka pendek, `char[]` kadang lebih baik karena bisa di-clear, meskipun dalam aplikasi modern boundary HTTP/JSON sering tetap membuat `String` di layer awal.

Defensive principle:

```text
Jangan membuat secret menjadi String lebih banyak dari yang diperlukan.
Jangan log String yang mungkin mengandung secret.
Jangan jadikan secret bagian dari exception message.
```

---

### 4.4 Immutability dan substring

`substring` menghasilkan `String` baru.

Secara historis, ada masa ketika substring dapat berbagi backing array dengan string asli. Itu menciptakan bug memory retention: substring kecil menahan string besar. Di implementasi modern, ini tidak lagi menjadi asumsi aman untuk optimasi manual.

Pelajaran:

```text
Jangan bergantung pada sharing internal substring.
Pikirkan substring sebagai value baru secara semantik.
```

---

## 5. Equality, Ordering, dan Canonicalization

### 5.1 `equals`

`String.equals` membandingkan sequence karakter secara case-sensitive.

```java
"abc".equals("abc") // true
"abc".equals("ABC") // false
```

Null-safe idiom:

```java
if ("APPROVED".equals(status)) {
    ...
}
```

Atau modern:

```java
Objects.equals(status, expected)
```

---

### 5.2 `equalsIgnoreCase`

```java
"abc".equalsIgnoreCase("ABC") // true
```

Tetapi jangan anggap ini cukup untuk semua human language comparison. Ini bukan locale-aware collation. Untuk display sorting dan natural language comparison, gunakan `Collator` dari `java.text`.

Gunakan `equalsIgnoreCase` hanya untuk machine tokens yang memang ASCII-ish atau protocol-ish, misalnya header tertentu, dengan tetap hati-hati.

---

### 5.3 `compareTo`

`compareTo` melakukan lexicographic ordering berdasarkan Unicode value/UTF-16 ordering, bukan urutan kamus manusia.

```java
List<String> names = ...;
Collections.sort(names); // bukan locale-aware human sort
```

Untuk sorting nama manusia:

```java
Collator collator = Collator.getInstance(Locale.forLanguageTag("id-ID"));
names.sort(collator);
```

Untuk stable machine ordering, `compareTo` bisa tepat.

---

### 5.4 Case normalization

Bug klasik:

```java
String key = input.toLowerCase(); // locale default
```

Ini bisa rusak di locale tertentu seperti Turkish casing.

Untuk machine identifier gunakan:

```java
String key = input.toLowerCase(Locale.ROOT);
```

Atau jika domain hanya mengizinkan ASCII, validasi ASCII lalu gunakan ASCII-specific normalization.

---

### 5.5 Canonicalization

Canonicalization adalah mengubah input menjadi bentuk representasi standar sebelum dibandingkan/disimpan.

Contoh status code:

```java
static String normalizeStatusCode(String raw) {
    if (raw == null) {
        throw new IllegalArgumentException("status is required");
    }
    String s = raw.strip().toUpperCase(Locale.ROOT);
    if (!s.matches("[A-Z_]{1,40}")) {
        throw new IllegalArgumentException("invalid status");
    }
    return s;
}
```

Tetapi hati-hati: canonicalization berbeda untuk setiap domain.

```text
Email local-part          != username
Postal code               != person name
Legal entity name         != status code
XML namespace URI         != file path
Case number               != free-text description
```

Jangan membuat satu fungsi `normalize(String)` universal untuk semua hal.

---

## 6. Unicode: Level yang Wajib Dipahami Engineer Senior

### 6.1 Byte, char, code point, grapheme

Ambil string:

```java
String s = "A😀é";
```

Ada beberapa level:

```text
Bytes:
  tergantung encoding: UTF-8, UTF-16, ISO-8859-1, dll.

UTF-16 code units / Java char:
  'A'       -> 1 char
  '😀'      -> 2 char: high surrogate + low surrogate
  'é'       -> 1 char, jika precomposed

Unicode code points:
  A         -> U+0041
  😀        -> U+1F600
  é         -> U+00E9, atau bisa juga e + combining acute

Grapheme clusters:
  apa yang user lihat sebagai satu karakter visual
```

`String.length()` menghitung UTF-16 code unit.

```java
String emoji = "😀";
System.out.println(emoji.length()); // 2
System.out.println(emoji.codePointCount(0, emoji.length())); // 1
```

---

### 6.2 Iterasi karakter yang benar

Buruk untuk Unicode non-BMP:

```java
for (int i = 0; i < s.length(); i++) {
    char c = s.charAt(i);
    // Bisa memecah surrogate pair
}
```

Lebih baik untuk code point:

```java
s.codePoints().forEach(cp -> {
    System.out.println(Integer.toHexString(cp));
});
```

Atau manual:

```java
for (int i = 0; i < s.length(); ) {
    int cp = s.codePointAt(i);
    i += Character.charCount(cp);
}
```

Tetapi code point pun belum sama dengan grapheme cluster. Untuk UI-level truncation, cursor movement, atau display width, butuh library/logic yang memahami grapheme cluster.

---

### 6.3 Normalization

Unicode memungkinkan teks visual sama punya representasi berbeda.

Contoh konseptual:

```text
é
```

Bisa berupa:

```text
U+00E9 LATIN SMALL LETTER E WITH ACUTE
```

atau:

```text
U+0065 LATIN SMALL LETTER E
U+0301 COMBINING ACUTE ACCENT
```

Secara visual bisa sama, tetapi `String.equals` bisa false.

Gunakan `java.text.Normalizer` jika domain membutuhkan canonical comparison:

```java
String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Tetapi normalisasi bukan silver bullet:

- bisa mengubah representasi yang penting untuk domain tertentu;
- tidak menyelesaikan semua spoofing;
- harus diputuskan per boundary;
- perlu konsisten antara input validation, persistence, search, dan display.

---

### 6.4 Unicode spoofing dan confusable characters

Contoh problem:

```text
paypal.com
раураl.com
```

Beberapa huruf Cyrillic bisa terlihat mirip Latin.

Untuk sistem yang menangani identifier sensitif:

- username;
- domain-like identifier;
- organization code;
- approval code;
- role name;
- permission key;
- tenant key;

jangan hanya mengandalkan `String.equals` dan regex longgar.

Strategi defensible:

1. batasi character set untuk machine identifier;
2. gunakan whitelist explicit;
3. pisahkan display name dari stable identifier;
4. log canonical code, bukan hanya label;
5. pertimbangkan Unicode security guidelines untuk domain publik.

Contoh:

```java
private static final Pattern TENANT_CODE = Pattern.compile("[A-Z0-9_-]{3,40}");

static String normalizeTenantCode(String raw) {
    String value = requireText(raw).strip().toUpperCase(Locale.ROOT);
    if (!TENANT_CODE.matcher(value).matches()) {
        throw new IllegalArgumentException("Invalid tenant code");
    }
    return value;
}
```

---

## 7. `String` API yang Sering Disalahpahami

### 7.1 `isEmpty` vs `isBlank`

```java
"".isEmpty();      // true
"   ".isEmpty();   // false

"".isBlank();      // true, Java 11+
"   ".isBlank();   // true
```

`isBlank()` menggunakan konsep whitespace Unicode, bukan sekadar ASCII space.

Untuk Java 8, belum ada `isBlank`, jadi biasanya dibuat utility:

```java
static boolean isBlank(String s) {
    return s == null || s.trim().isEmpty();
}
```

Tapi `trim()` tidak sama dengan `strip()`.

---

### 7.2 `trim` vs `strip`

`trim()` adalah method lama yang menghapus karakter dengan code point <= U+0020.

`strip()` Java 11+ berbasis Unicode whitespace.

```java
String s = "  abc  ";
s.trim();
s.strip();
```

Untuk input modern, `strip()` biasanya lebih semantik. Untuk protocol lama yang mendefinisikan ASCII whitespace tertentu, `trim()` atau custom logic mungkin lebih tepat.

---

### 7.3 `substring`

```java
String code = "APPROVED";
String prefix = code.substring(0, 3); // APP
```

Failure modes:

- index berbasis UTF-16 code unit;
- bisa memotong surrogate pair;
- `IndexOutOfBoundsException` jika panjang tidak divalidasi;
- sering dipakai untuk parsing fixed-format tanpa validasi.

Lebih defensible untuk fixed prefix:

```java
if (code.startsWith("APP-")) {
    ...
}
```

Atau validasi format dulu.

---

### 7.4 `replace` vs `replaceAll`

```java
"a.b".replace(".", "-");     // a-b
"a.b".replaceAll(".", "-");  // --- karena . adalah regex wildcard
```

Mental model:

```text
replace      -> literal replacement
replaceAll   -> regex replacement
replaceFirst -> regex replacement pertama
```

Gunakan `replace` jika tidak butuh regex.

---

### 7.5 `split`

`split` memakai regex.

```java
"a.b.c".split(".") // salah: . regex wildcard
"a.b.c".split("\\.") // benar
```

Trailing empty string juga punya behavior yang sering mengejutkan:

```java
"a,b,".split(",")     // ["a", "b"]
"a,b,".split(",", -1) // ["a", "b", ""]
```

Untuk CSV, jangan pakai split sederhana jika ada quote/escape. Gunakan parser CSV.

---

### 7.6 `matches`

`matches` harus mencocokkan seluruh string.

```java
"abc123".matches("\\d+") // false
"abc123".matches(".*\\d+.*") // true
```

Selain itu, `matches` compile regex setiap call. Untuk hot path, precompile `Pattern`.

```java
private static final Pattern CODE = Pattern.compile("[A-Z0-9_]{1,40}");

boolean ok = CODE.matcher(value).matches();
```

---

### 7.7 `lines`

Java 11+:

```java
String text = "a\nb\n";
text.lines().forEach(System.out::println);
```

Gunakan untuk multiline processing sederhana. Untuk file besar, jangan load seluruh file jadi `String`; gunakan streaming reader.

---

### 7.8 `formatted` dan `String.format`

Java 15+ memiliki instance method:

```java
String msg = "User %s has %d attempts".formatted(userId, attempts);
```

`String.format` dan `formatted` memakai formatting machinery yang lebih berat daripada concat sederhana.

Gunakan untuk readability ketika format kompleks atau locale-aware formatting diperlukan. Jangan gunakan di tight loop hot path tanpa alasan.

---

### 7.9 `indent`, `stripIndent`, `translateEscapes`

Modern Java menambah method untuk text block/multiline string.

Contoh:

```java
String json = """
        {
          "status": "OK"
        }
        """;
```

Text block meningkatkan readability untuk SQL, JSON sample, XML sample, dan template kecil. Tetapi untuk template production kompleks, gunakan template engine atau structured builder.

---

## 8. Interning dan String Pool

### 8.1 Apa itu interning?

Interning adalah proses mendapatkan canonical representation untuk string dengan isi sama.

```java
String a = new String("abc");
String b = a.intern();
String c = "abc";

System.out.println(a == c); // false
System.out.println(b == c); // true
```

`intern()` mengembalikan string canonical dari pool.

---

### 8.2 Kapan interning berguna?

Interning bisa berguna untuk domain dengan banyak duplikasi string jangka panjang:

- parsing jutaan record dengan kode status berulang;
- compiler/interpreter symbol table;
- XML tag/namespace names di parser tertentu;
- protocol tokens;
- dictionary-like workload.

Tetapi manual `intern()` tidak boleh dipakai sembarangan.

Risiko:

- pool pressure;
- lifetime panjang;
- memory sulit diprediksi;
- bisa memperburuk performance jika cardinality tinggi;
- lock/contention/GC behavior tergantung VM;
- domain semantics tersamarkan.

---

### 8.3 Alternatif manual interning

Untuk aplikasi bisnis, sering lebih baik menggunakan canonical map terbatas:

```java
final class CodeCanonicalizer {
    private final ConcurrentMap<String, String> values = new ConcurrentHashMap<>();

    String canonicalize(String raw) {
        String normalized = raw.strip().toUpperCase(Locale.ROOT);
        return values.computeIfAbsent(normalized, Function.identity());
    }
}
```

Tetapi ini juga harus dibatasi agar tidak menjadi memory leak:

- gunakan bounded cache;
- batasi valid code set;
- gunakan enum untuk finite set;
- jangan canonicalize untrusted high-cardinality input tanpa limit.

---

## 9. Compact Strings: Java 8 vs Java 9+

### 9.1 Java 8 mental model

Banyak developer Java 8 mengenal `String` sebagai wrapper atas `char[]`.

Secara konsep API, `String` memang sequence UTF-16 `char`.

### 9.2 Java 9+ Compact Strings

JEP 254 mengubah representasi internal `String` menjadi lebih space-efficient: data disimpan sebagai `byte[]` plus flag encoding, sehingga string Latin-1 dapat memakai satu byte per karakter, sedangkan string yang membutuhkan UTF-16 tetap memakai dua byte per karakter.

Konsekuensi:

```text
String API tetap sama.
Internal representation berubah.
Memory footprint untuk banyak string ASCII/Latin-1 turun signifikan.
```

Contoh workload yang diuntungkan:

- HTTP headers;
- JSON keys;
- database codes;
- log messages;
- English/ASCII identifiers;
- config keys;
- XML tag names;
- status strings.

Tetapi jangan salah paham:

- `String.length()` tetap menghitung UTF-16 code units;
- `charAt()` tetap mengembalikan `char`;
- encoding file/network tetap perlu eksplisit;
- compact internal storage bukan berarti string aman dianggap Latin-1;
- reflection ke internal field adalah ide buruk dan bisa gagal karena modules/encapsulation.

---

## 10. Encoding: `String` Bukan Byte Array

### 10.1 Boundary teks ke byte

`String` adalah teks dalam model Java. File/network/database sering butuh bytes.

Buruk:

```java
byte[] bytes = text.getBytes(); // default charset
```

Lebih baik:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

Dan sebaliknya:

```java
String text = new String(bytes, StandardCharsets.UTF_8);
```

Default charset bisa berubah tergantung versi/runtime/environment. Jangan gunakan default untuk protocol atau persistence.

---

### 10.2 Encoding mismatch

Bug umum:

```text
System A menulis UTF-8.
System B membaca ISO-8859-1.
Teks terlihat rusak.
```

Atau:

```text
Database column encoding berbeda dari app expectation.
```

Atau:

```text
HTTP response tidak punya charset jelas.
```

Prinsip:

```text
Every byte/text boundary must name its charset.
```

Untuk sistem modern, defaultkan UTF-8 kecuali protocol secara eksplisit berbeda.

---

### 10.3 `String` dan binary data

Jangan simpan binary arbitrary sebagai `String` kecuali melalui encoding yang tepat seperti Base64 atau hex.

Buruk:

```java
String s = new String(binaryBytes, StandardCharsets.UTF_8); // bisa corrupt
```

Benar:

```java
String b64 = Base64.getEncoder().encodeToString(binaryBytes);
byte[] decoded = Base64.getDecoder().decode(b64);
```

---

## 11. API Boundary Design dengan `String`

### 11.1 Semua `String` tidak sama

Bandingkan:

```java
void approve(String id, String status, String reason, String user, String role) { ... }
```

Ini lemah. Semua parameter bertipe sama, mudah tertukar, dan semantics tidak jelas.

Lebih kuat:

```java
record CaseId(String value) {
    CaseId {
        value = normalize(value);
    }
}

record UserId(String value) {
    UserId {
        value = normalize(value);
    }
}

enum ApprovalStatus {
    APPROVED,
    REJECTED
}

void approve(CaseId caseId, ApprovalStatus status, String reason, UserId userId) { ... }
```

`String` bagus sebagai representation, tetapi sering buruk sebagai domain type.

---

### 11.2 Raw vs normalized vs validated

Tiga state ini harus dibedakan:

```text
Raw input:
  apa adanya dari user/request/file.

Normalized value:
  sudah di-strip/case-fold/normalize sesuai domain.

Validated value:
  sudah memenuhi invariant domain.
```

Contoh:

```java
record AgencyCode(String value) {
    private static final Pattern PATTERN = Pattern.compile("[A-Z0-9]{2,10}");

    AgencyCode {
        Objects.requireNonNull(value, "agency code");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid agency code");
        }
    }
}
```

Sekarang `AgencyCode` membawa invariant. Bukan sekadar string liar.

---

### 11.3 Empty vs blank vs null vs absent

Ini harus diputuskan per field.

```text
null       -> tidak ada reference / unknown / not supplied
""         -> supplied but empty
"   "      -> supplied blank text
Optional   -> absence explicit at API level
```

Untuk field wajib:

```java
static String requireNonBlank(String value, String fieldName) {
    if (value == null || value.isBlank()) {
        throw new IllegalArgumentException(fieldName + " is required");
    }
    return value;
}
```

Untuk Java 8, gunakan utility kompatibel.

---

### 11.4 Display label vs stable code

Jangan jadikan display label sebagai key logic.

Buruk:

```java
if (statusLabel.equals("Pending Approval")) { ... }
```

Lebih baik:

```java
record StatusCode(String value) { }
record StatusLabel(String value) { }
```

Atau:

```java
enum CaseStatus {
    PENDING_APPROVAL("PENDING_APPROVAL", "Pending Approval");

    private final String code;
    private final String defaultLabel;
}
```

Label bisa berubah karena bahasa, UI copywriting, legal wording, atau stakeholder preference. Code harus stabil.

---

## 12. Security Failure Modes

### 12.1 Secrets in strings

Jangan:

```java
log.info("Login failed for password={}", password);
throw new IllegalArgumentException("Invalid token: " + token);
```

Lebih baik:

```java
log.info("Login failed for userId={}, reason={}", userId, reasonCode);
throw new IllegalArgumentException("Invalid token");
```

String secret dapat muncul di:

- logs;
- exception stack trace;
- heap dump;
- metrics label;
- tracing span attribute;
- crash report;
- APM breadcrumbs.

---

### 12.2 Command injection

Buruk:

```java
String cmd = "convert " + inputPath + " " + outputPath;
Runtime.getRuntime().exec(cmd);
```

Gunakan `ProcessBuilder` dengan argument terpisah:

```java
new ProcessBuilder("convert", inputPath.toString(), outputPath.toString()).start();
```

String yang tampak “path biasa” bisa membawa shell metacharacter jika dipakai sebagai command string.

---

### 12.3 SQL/LDAP/XPath injection

String concatenation untuk query adalah red flag.

Buruk:

```java
String sql = "select * from users where username = '" + username + "'";
```

Gunakan prepared statement / parameter binding.

Untuk XML/XPath, jangan membangun expression dari input tanpa escaping atau binding yang sesuai.

---

### 12.4 Regex injection / ReDoS

Jika user input dimasukkan ke regex:

```java
Pattern.compile(".*" + userInput + ".*");
```

Gunakan:

```java
Pattern.compile(".*" + Pattern.quote(userInput) + ".*");
```

Tetapi tetap hati-hati dengan pattern besar dan input panjang. Regex tertentu dapat menyebabkan catastrophic backtracking.

---

### 12.5 Path traversal

String path bukan file path aman.

Buruk:

```java
Path path = Paths.get(baseDir + "/" + userFileName);
```

Lebih baik:

```java
Path base = Paths.get("/safe/base").toRealPath();
Path target = base.resolve(userFileName).normalize();

if (!target.startsWith(base)) {
    throw new SecurityException("Invalid path");
}
```

---

### 12.6 Canonicalization order bug

Security check harus dilakukan pada canonical form yang benar.

Buruk:

```java
if (!path.contains("..")) {
    use(path);
}
```

Karena encoding, symlink, separator alternatif, Unicode lookalike, dan normalization bisa melewati check.

Prinsip:

```text
Decode -> normalize/canonicalize -> validate -> use
```

Tetapi detailnya tergantung domain.

---

## 13. Performance dan Memory

### 13.1 Allocation pressure

String mudah dibuat tanpa sadar:

```java
String key = tenant + ":" + module + ":" + id;
```

Dalam request biasa, ini bukan masalah. Dalam hot path jutaan operasi/detik, allocation bisa signifikan.

Strategi:

- jangan optimasi sebelum ada profiling;
- gunakan `StringBuilder` untuk loop/generator besar;
- cache finite repeated values;
- hindari regex di hot path jika simple parser cukup;
- hindari `toLowerCase`/`toUpperCase` repeatedly;
- gunakan structured keys atau objects jika string key terlalu sering dibangun.

---

### 13.2 Logging

Buruk:

```java
log.debug("Large payload: " + payload.toPrettyJson());
```

Walaupun debug mati, string bisa tetap dibangun.

Lebih baik:

```java
log.debug("Large payload: {}", payload::toPrettyJson); // jika logger mendukung supplier
```

atau:

```java
if (log.isDebugEnabled()) {
    log.debug("Large payload: {}", payload.toPrettyJson());
}
```

Untuk SLF4J parameterized logging:

```java
log.info("Case {} moved from {} to {}", caseId, from, to);
```

---

### 13.3 Regex cost

```java
value.matches("[A-Z0-9]+")
```

compile regex setiap call.

Untuk validation sering:

```java
private static final Pattern CODE = Pattern.compile("[A-Z0-9]+");

boolean ok = CODE.matcher(value).matches();
```

Untuk simple ASCII checks, manual loop bisa lebih cepat dan jelas:

```java
static boolean isAsciiUpperCode(String s) {
    if (s == null || s.isEmpty()) return false;
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_')) {
            return false;
        }
    }
    return true;
}
```

---

### 13.4 Large strings

Large string dapat menyebabkan:

- high heap usage;
- GC pressure;
- humongous allocations pada G1 untuk ukuran tertentu;
- memory spike saat decoding/encoding;
- log explosion;
- OOM jika payload tidak dibatasi.

Defensive design:

- batasi request body size;
- batasi XML/JSON text field length;
- gunakan streaming untuk file besar;
- jangan log full payload;
- lakukan truncation aman untuk diagnostic;
- gunakan reader/writer untuk transformasi besar.

---

### 13.5 Deduplication

Beberapa GC/runtime punya string deduplication options, tetapi jangan jadikan ini desain utama. Aplikasi tetap harus:

- membatasi cardinality;
- menghindari duplikasi tidak perlu;
- menggunakan model data yang benar;
- tidak membuat string besar sementara tanpa alasan.

---

## 14. Java 8–25 Evolution Map untuk `String`

### 14.1 Java 8 baseline

Di Java 8, banyak API modern belum tersedia:

- belum ada `isBlank`;
- belum ada `strip`;
- belum ada `lines`;
- belum ada `repeat`;
- belum ada text block;
- concat runtime umumnya via `StringBuilder` bytecode pattern;
- internal representation umum masih dikenal sebagai char-array-based.

Untuk library yang harus support Java 8, kamu perlu utility sendiri untuk beberapa operasi.

---

### 14.2 Java 9

Perubahan penting:

- Compact Strings via JEP 254;
- indify string concatenation via JEP 280;
- module system memperkuat encapsulation, sehingga akses reflektif ke internal `String` makin tidak layak;
- runtime optimization string meningkat tanpa mengubah source code.

---

### 14.3 Java 11

API penting:

- `isBlank()`;
- `strip()`;
- `stripLeading()`;
- `stripTrailing()`;
- `lines()`;
- `repeat(int)`.

Ini membuat code text handling lebih ekspresif.

---

### 14.4 Java 13–15 text blocks

Text blocks menjadi final di Java 15, membantu multiline literals.

```java
String xml = """
        <case>
          <status>APPROVED</status>
        </case>
        """;
```

Bagus untuk sample/test/template kecil, tetapi bukan pengganti serializer XML/JSON production.

---

### 14.5 Java 15+ formatted

`String.formatted` memperbaiki ergonomi:

```java
String s = "Hello %s".formatted(name);
```

Tetap gunakan dengan bijak karena format machinery lebih berat dari concat sederhana.

---

### 14.6 Java 21–25

Dari perspektif `String` API inti, tidak ada perubahan radikal setara Java 9 compact strings. Yang lebih penting adalah ekosistem bahasa/runtime modern:

- pattern matching dan records membuat modelling value lebih baik daripada raw string;
- virtual threads meningkatkan jumlah execution context sehingga string allocation/logging/context propagation perlu disiplin;
- stronger encapsulation membuat dependency ke internals makin tidak defensible;
- Java 25 sebagai LTS memberi baseline modern untuk library enterprise berikutnya.

---

## 15. Patterns untuk Production Code

### 15.1 Value object wrapper

Gunakan untuk identifier/domain code.

```java
public record CaseNumber(String value) {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{8}");

    public CaseNumber {
        Objects.requireNonNull(value, "case number");
        value = value.strip().toUpperCase(Locale.ROOT);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid case number");
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Keuntungan:

- validation dekat dengan data;
- tidak mudah tertukar dengan string lain;
- equality benar;
- API lebih self-documenting;
- domain invariant lebih kuat.

---

### 15.2 Explicit charset boundary

```java
public final class Utf8 {
    private Utf8() {}

    public static byte[] encode(String value) {
        Objects.requireNonNull(value, "value");
        return value.getBytes(StandardCharsets.UTF_8);
    }

    public static String decode(byte[] bytes) {
        Objects.requireNonNull(bytes, "bytes");
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
```

Jangan menyebar `getBytes()` default di codebase.

---

### 15.3 Safe truncation for logs

```java
public static String truncateForLog(String value, int maxCodePoints) {
    if (value == null) return null;
    if (maxCodePoints < 0) throw new IllegalArgumentException("maxCodePoints");

    int cpCount = value.codePointCount(0, value.length());
    if (cpCount <= maxCodePoints) return value;

    int end = value.offsetByCodePoints(0, maxCodePoints);
    return value.substring(0, end) + "…";
}
```

Ini lebih baik daripada memotong raw char index yang bisa memecah surrogate pair.

Tetapi untuk grapheme cluster masih belum sempurna.

---

### 15.4 Stable external enum code

```java
enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String raw) {
        String code = raw.strip().toUpperCase(Locale.ROOT);
        for (CaseStatus s : values()) {
            if (s.code.equals(code)) return s;
        }
        throw new IllegalArgumentException("Unknown case status");
    }
}
```

Jangan persist enum ordinal. Jangan bergantung pada display label.

---

### 15.5 Bounded canonicalization

```java
final class KnownCodeRegistry {
    private final Map<String, KnownCode> byCode;

    KnownCodeRegistry(Collection<KnownCode> codes) {
        this.byCode = codes.stream()
                .collect(Collectors.toUnmodifiableMap(
                        c -> c.value().toUpperCase(Locale.ROOT),
                        Function.identity()
                ));
    }

    KnownCode resolve(String raw) {
        String normalized = raw.strip().toUpperCase(Locale.ROOT);
        KnownCode code = byCode.get(normalized);
        if (code == null) {
            throw new IllegalArgumentException("Unknown code");
        }
        return code;
    }
}
```

Ini lebih aman daripada `intern()` untuk domain finite.

---

## 16. Anti-Patterns

### 16.1 `==` untuk compare string

```java
if (status == "APPROVED") { } // salah
```

Gunakan:

```java
if ("APPROVED".equals(status)) { }
```

---

### 16.2 Satu utility normalize universal

```java
String normalize(String s) {
    return s.trim().toLowerCase();
}
```

Ini berbahaya karena domain berbeda membutuhkan aturan berbeda.

---

### 16.3 Default charset

```java
new String(bytes)
text.getBytes()
```

Gunakan charset eksplisit.

---

### 16.4 Regex untuk semua parsing

Regex powerful, tetapi tidak selalu tepat:

- CSV;
- nested format;
- XML;
- JSON;
- programming language;
- shell command;
- large untrusted input.

Gunakan parser yang sesuai.

---

### 16.5 Log full payload

```java
log.info("payload={}", payload);
```

Bisa bocor PII/secret dan membuat log/observability runtuh.

Gunakan redaction, truncation, dan structured logging.

---

### 16.6 Treat display text as machine identity

```java
if (buttonText.equals("Approve")) { ... }
```

Display text berubah. Machine identity harus stabil.

---

### 16.7 Case conversion tanpa locale

```java
input.toUpperCase()
input.toLowerCase()
```

Untuk machine value:

```java
input.toUpperCase(Locale.ROOT)
```

---

## 17. Failure Modes di Production

### 17.1 Duplicate user karena Unicode normalization

Dua username terlihat sama tetapi beda code point sequence.

Dampak:

- duplicate account;
- authorization confusion;
- audit sulit;
- support ticket sulit direproduksi.

Mitigasi:

- tentukan allowed charset;
- normalize sebelum uniqueness check;
- simpan canonical dan display form terpisah jika perlu.

---

### 17.2 Authorization bypass karena string role tidak canonical

```java
if (role.equals("ADMIN")) { ... }
```

Input bisa:

```text
" admin "
"Admin"
"ＡＤＭＩＮ" fullwidth
"ADMIN\u0000"
```

Mitigasi:

- role jangan raw string;
- gunakan enum/permission object;
- normalize dan validate di boundary;
- reject unknown form, jangan auto-correct terlalu longgar untuk security-sensitive field.

---

### 17.3 Cache miss karena whitespace tak terlihat

`"ABC"` dan `"ABC\u00A0"` bisa terlihat sama di UI.

Mitigasi:

- show escaped diagnostic untuk support;
- canonicalize keys;
- validate allowed characters;
- store raw input for audit jika diperlukan, tetapi use canonical for matching.

---

### 17.4 Memory spike karena load file ke String

```java
String xml = Files.readString(path);
Document doc = parse(xml);
```

Untuk file XML besar, ini menggandakan/melipatgandakan memory:

- bytes file;
- decoded String;
- parser buffers;
- DOM tree.

Mitigasi:

- parse dari stream/reader;
- gunakan SAX/StAX untuk besar;
- batasi ukuran;
- hindari DOM untuk large sequential extraction.

---

### 17.5 Broken truncation

```java
String preview = text.substring(0, 100);
```

Jika kurang dari 100 char: exception. Jika ada surrogate pair: bisa rusak. Jika sensitive text: bocor.

Mitigasi:

- validate length;
- code point aware truncation;
- redaction before logging;
- cap byte length jika protocol boundary.

---

### 17.6 Regex ReDoS dari validation string

Pattern seperti:

```java
(a+)+$
```

pada input crafted bisa menyebabkan CPU spike.

Mitigasi:

- hindari nested quantifier berbahaya;
- gunakan length limit sebelum regex;
- precompile pattern;
- pertimbangkan parser/manual validation;
- fuzz/test malicious input.

---

## 18. Design Checklist: Ketika Melihat `String` di Code Review

Tanyakan:

1. Apakah string ini **raw**, **normalized**, atau **validated**?
2. Apakah `null`, empty, blank, dan absent dibedakan dengan jelas?
3. Apakah ini seharusnya value object atau enum?
4. Apakah case conversion memakai `Locale.ROOT` untuk machine value?
5. Apakah charset eksplisit di byte boundary?
6. Apakah regex benar-benar perlu?
7. Apakah input length dibatasi?
8. Apakah Unicode non-ASCII valid untuk domain ini?
9. Apakah comparison harus exact, case-insensitive, normalized, atau locale-aware?
10. Apakah string ini mungkin secret/PII?
11. Apakah string ini akan masuk log, metric, trace, exception, atau audit?
12. Apakah string dipakai sebagai path, command, SQL, XPath, regex, URL, atau HTML?
13. Apakah display label tercampur dengan stable code?
14. Apakah string besar diproses streaming atau full memory?
15. Apakah performance issue sudah dibuktikan dengan profiling?

---

## 19. Practical Exercises

### Exercise 1 — Status normalization

Buat `CaseStatusCode` record yang:

- menolak null;
- melakukan `strip()`;
- upper-case dengan `Locale.ROOT`;
- hanya menerima `[A-Z_]{3,40}`;
- menyimpan canonical value;
- punya `toString()` yang mengembalikan value.

Diskusikan apakah `" approved "` harus diterima atau ditolak.

---

### Exercise 2 — Unicode length

Prediksi output:

```java
String s = "A😀é";
System.out.println(s.length());
System.out.println(s.codePointCount(0, s.length()));
System.out.println(s.substring(0, 2));
```

Kemudian jelaskan kenapa substring bisa bermasalah.

---

### Exercise 3 — Safe byte boundary

Refactor code berikut:

```java
byte[] payload = requestBody.getBytes();
String response = new String(responseBytes);
```

Menjadi explicit charset boundary.

---

### Exercise 4 — Regex trap

Jelaskan perbedaan:

```java
"a.b.c".split(".")
"a.b.c".split("\\.")
"a.b.c".replace(".", "-")
"a.b.c".replaceAll(".", "-")
```

---

### Exercise 5 — Design review

Review API berikut:

```java
void assign(String user, String role, String tenant, String reason)
```

Ubah menjadi API yang lebih defensible untuk sistem enterprise.

---

## 20. Ringkasan

`String` adalah class sederhana hanya di permukaan.

Di level advanced, `String` adalah:

- immutable reference type dengan value-like semantics;
- kontrak bahasa untuk literal, concat, switch, dan text block;
- objek runtime yang heavily optimized oleh JVM;
- boundary paling umum antar sistem;
- representasi teks berbasis UTF-16 abstraction, bukan karakter manusia;
- sumber bug security/correctness saat normalization, charset, locale, regex, path, command, query, dan logging tidak didefinisikan;
- tipe yang sering harus dibungkus menjadi domain-specific value object.

Mental model yang harus dibawa:

```text
String is not just text.
String is a boundary contract.
Every String needs semantics.
```

Jika kamu melihat `String` di sistem production, jangan hanya bertanya “isinya apa?”. Tanyakan:

```text
String ini mewakili apa?
Dari mana asalnya?
Sudah dinormalisasi?
Sudah divalidasi?
Boleh null/blank?
Aman untuk log?
Aman untuk compare?
Aman untuk persist?
Aman untuk dipakai di protocol/query/path/command?
```

Itulah perbedaan antara developer yang hanya tahu `String` API dan engineer yang memahami runtime/platform contract.

---

## 21. Referensi Utama

- Java SE 25 API — `java.lang.String`
- Java SE 25 API — `java.lang.StringBuilder`
- Java SE 8 API — `java.lang.String`
- OpenJDK JEP 254 — Compact Strings
- OpenJDK JEP 280 — Indify String Concatenation
- Java Language Specification — String literals, compile-time constants, expressions
- Java Virtual Machine Specification — constant pool, class loading, invokedynamic
- Unicode Standard concepts — code point, code unit, normalization, grapheme cluster

---

## 22. Status Seri

Part ini adalah **Part 4 dari 32**.

Seri **belum selesai**.

Part berikutnya:

**Part 5 — `StringBuilder`, `StringBuffer`, `CharSequence`, and Text Construction Contracts**

File berikutnya:

```text
05-charsequence-stringbuilder-stringbuffer-text-construction.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./03-class-type-token-runtime-type-metadata.md">⬅️ Part 3 — `Class<T>` and Runtime Type Tokens</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./05-charsequence-stringbuilder-stringbuffer-text-construction.md">Part 5 — `StringBuilder`, `StringBuffer`, `CharSequence`, and Text Construction Contracts ➡️</a>
</div>
