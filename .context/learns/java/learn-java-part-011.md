# learn-java-part-011.md

# Bagian 11 — Text, Unicode, Locale, Date-Time

> Target pembaca: software engineer yang ingin memahami Java bukan hanya sebagai bahasa untuk menulis business logic, tetapi sebagai platform production yang harus benar ketika berhadapan dengan teks lintas bahasa, file lintas encoding, API lintas sistem, zona waktu, DST, sorting nama manusia, audit timestamp, dan format data yang harus tahan lama.

---

## Metadata

- Seri: Belajar Java hingga Java 25
- Bagian: 11
- Nama file: `learn-java-part-011.md`
- Fokus: `String`, Unicode, charset, encoding, regex, locale, collation, formatting, date-time
- Level: intermediate → advanced → production-grade
- Gaya belajar: mental model, semantics, trade-off, failure mode, API design, latihan
- Versi acuan: Java SE 25 / JDK 25

---

## Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan perbedaan **byte**, **char**, **code unit**, **code point**, **grapheme cluster**, **glyph**, **charset**, dan **encoding**.
2. Menghindari bug klasik `String.length()` pada emoji dan karakter supplementary.
3. Memahami kenapa `char` Java bukan “character manusia”.
4. Memproses teks Unicode secara aman memakai `codePoints()`, `Character`, `Normalizer`, `Collator`, dan `Locale`.
5. Menentukan kapan memakai `String`, `StringBuilder`, `StringBuffer`, `CharSequence`, `byte[]`, atau streaming decoder.
6. Mendesain I/O teks yang eksplisit charset-nya.
7. Memahami dampak Java 18+ yang menjadikan UTF-8 sebagai default charset, tanpa menjadikan default charset sebagai alasan untuk malas eksplisit.
8. Menulis regex yang benar, aman, reusable, dan tidak rentan catastrophic backtracking.
9. Membedakan `Instant`, `LocalDate`, `LocalDateTime`, `OffsetDateTime`, `ZonedDateTime`, `Duration`, dan `Period`.
10. Mendesain timestamp untuk audit, business event, scheduling, SLA, dan regulatory workflow.
11. Menghindari bug DST, timezone conversion, locale formatting, dan parsing tanggal.
12. Membuat guideline production untuk teks dan waktu di Java.

---

# 11.0 Kenapa Text dan Time Sulit?

Banyak engineer menganggap teks dan waktu sebagai hal sederhana:

```java
String name = "Fajar";
LocalDateTime now = LocalDateTime.now();
```

Tetapi di production, dua domain ini adalah sumber bug yang sangat mahal:

- nama manusia tidak selalu ASCII;
- satu “karakter visual” bisa terdiri dari beberapa code point;
- satu code point bisa membutuhkan dua `char` di Java;
- uppercase/lowercase bisa bergantung pada locale;
- sorting nama manusia bukan sorting Unicode code unit;
- file dari sistem lama bisa memakai Windows-1252, Shift_JIS, Big5, ISO-8859-1, atau EBCDIC;
- satu waktu lokal bisa tidak pernah terjadi karena DST gap;
- satu waktu lokal bisa terjadi dua kali karena DST overlap;
- `LocalDateTime` tidak bisa mewakili instant global tanpa zone/offset;
- audit log yang menyimpan waktu tanpa timezone dapat kehilangan makna;
- regex yang tampak benar bisa membuat CPU 100% karena backtracking;
- parsing tanggal bisa salah karena locale atau resolver style;
- `yyyy` dan `YYYY` pada formatter bisa menghasilkan tahun berbeda.

Mental model penting:

> Text dan time bukan sekadar value. Mereka adalah hasil interpretasi terhadap konteks: encoding, locale, calendar, timezone, dan aturan domain.

Java menyediakan library yang kuat, tetapi library itu tidak menyelamatkan desain yang salah. Bagian ini akan membangun model mental agar kamu tahu **kapan value berarti data murni, kapan value berarti interpretasi, dan kapan value harus disertai konteks**.

---

# 11.1 Mental Model String

## 11.1.1 Apa itu `String` di Java?

`String` adalah object immutable yang merepresentasikan urutan teks. Secara API, `String`:

- `final`;
- immutable;
- mengimplementasikan `CharSequence`;
- mengimplementasikan `Comparable<String>`;
- mendukung operasi pencarian, slicing, comparison, case conversion, encoding, dan formatting.

Contoh sederhana:

```java
String s = "hello";
```

Yang sering disalahpahami:

```java
String s = "🙂";
System.out.println(s.length()); // 2, bukan 1
```

Kenapa? Karena `String.length()` menghitung jumlah **UTF-16 code unit**, bukan jumlah karakter visual manusia.

---

## 11.1.2 `String` immutable: apa konsekuensinya?

Immutable berarti setelah dibuat, isi string tidak berubah.

```java
String a = "case";
String b = a.toUpperCase(Locale.ROOT);

System.out.println(a); // case
System.out.println(b); // CASE
```

Konsekuensi positif:

- aman dishare antar thread;
- bisa dipakai sebagai key map;
- bisa di-cache hash-nya;
- cocok untuk string pool/interning;
- aman sebagai value object kecil.

Konsekuensi negatif:

- operasi transformasi menghasilkan object baru;
- concatenation berulang dalam loop bisa mahal jika tidak dioptimasi;
- substring dan replace menghasilkan string baru;
- banyak parsing teks bisa menghasilkan allocation besar.

Rule praktis:

```java
// Baik untuk sedikit concat
String message = "case=" + caseId + ", status=" + status;

// Baik untuk loop banyak append
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item).append('\n');
}
String result = sb.toString();
```

Modern `javac` dapat mengoptimalkan string concatenation, tetapi jangan jadikan itu alasan melakukan concat masif di loop tanpa sadar allocation.

---

## 11.1.3 String literal dan string pool

```java
String a = "java";
String b = "java";
String c = new String("java");

System.out.println(a == b);      // true, literal sama dari pool
System.out.println(a == c);      // false, object berbeda
System.out.println(a.equals(c)); // true, isi sama
```

Mental model:

- literal string disimpan dalam string pool;
- `==` membandingkan reference identity;
- `equals` membandingkan content;
- `intern()` mengembalikan canonical representation dari pool.

Jangan gunakan `==` untuk membandingkan isi string.

```java
if (status == "APPROVED") { // salah
}

if ("APPROVED".equals(status)) { // benar
}
```

Dalam domain state, lebih baik gunakan enum atau sealed type:

```java
enum CaseStatus {
    DRAFT, SUBMITTED, APPROVED, REJECTED
}
```

String cocok untuk data external. Untuk state internal, modelkan dengan type yang lebih kuat.

---

## 11.1.4 Compact Strings: implementation detail yang penting untuk performance

Sejak JDK 9, Java mengadopsi **Compact Strings**. Secara konsep, banyak string Latin-1 dapat disimpan lebih hemat daripada representasi 16-bit penuh. Namun ini adalah detail implementasi JVM/JDK, bukan kontrak bahasa.

Mental model:

- secara API, `String` tetap dipandang sebagai sequence UTF-16 code units;
- secara internal, JDK dapat memakai representasi lebih hemat;
- jangan menulis kode yang bergantung pada layout internal `String`;
- jangan memakai reflection/Unsafe untuk membaca field internal `String`.

Implikasi performance:

- banyak teks ASCII/Latin-1 dapat memakai memory lebih kecil;
- aplikasi dengan banyak key/header/identifier string bisa terbantu;
- tetapi begitu string membutuhkan karakter non-Latin-1, representasi bisa berubah;
- optimasi ini transparan, bukan API guarantee.

---

## 11.1.5 `String`, `StringBuilder`, `StringBuffer`, `CharSequence`

| Type | Mutability | Thread-safety | Use case |
|---|---:|---:|---|
| `String` | immutable | aman dishare | value teks final |
| `StringBuilder` | mutable | tidak synchronized | membangun string di satu thread |
| `StringBuffer` | mutable | synchronized | legacy/thread-shared builder, jarang perlu |
| `CharSequence` | interface | tergantung implementasi | API parameter fleksibel |

Preferensi API:

```java
// Lebih fleksibel untuk input baca-saja
boolean isBlankLike(CharSequence value) {
    return value == null || value.toString().isBlank();
}
```

Namun hati-hati:

```java
CharSequence cs = new StringBuilder("abc");
// bisa berubah jika builder dipegang pihak lain
```

Untuk boundary domain yang butuh immutability, convert ke `String`.

```java
record CaseTitle(String value) {
    CaseTitle {
        value = Objects.requireNonNull(value).strip();
        if (value.isBlank()) {
            throw new IllegalArgumentException("title must not be blank");
        }
    }
}
```

---

# 11.2 Character, `char`, Code Unit, Code Point, Grapheme

## 11.2.1 Hirarki konsep

Urutkan dari bawah ke atas:

| Konsep | Arti |
|---|---|
| byte | unit 8-bit dalam file/network/memory raw |
| charset/encoding | aturan mapping antara byte dan karakter/code unit |
| UTF-16 code unit | unit 16-bit; di Java direpresentasikan oleh `char` |
| code point | nomor karakter Unicode, misalnya U+0041 atau U+1F642 |
| grapheme cluster | karakter visual yang dirasakan manusia |
| glyph | bentuk visual yang dirender font |

Contoh:

```java
String s = "🙂"; // U+1F642

System.out.println(s.length());           // 2 UTF-16 code units
System.out.println(s.codePointCount(0, s.length())); // 1 code point
System.out.println(s.codePointAt(0));      // 128578 decimal
```

`char` Java adalah 16-bit UTF-16 code unit. Ia tidak selalu cukup untuk satu Unicode character.

---

## 11.2.2 BMP dan supplementary characters

Unicode code point legal berada pada rentang:

```text
U+0000 sampai U+10FFFF
```

BMP atau Basic Multilingual Plane adalah:

```text
U+0000 sampai U+FFFF
```

Supplementary characters adalah code point di atas U+FFFF. Mereka membutuhkan surrogate pair di UTF-16.

```java
String emoji = "🙂";

char high = emoji.charAt(0);
char low  = emoji.charAt(1);

System.out.println(Character.isHighSurrogate(high)); // true
System.out.println(Character.isLowSurrogate(low));   // true
System.out.println(Character.toCodePoint(high, low)); // 128578
```

Rule penting:

> Jangan iterasi teks Unicode umum dengan `for (int i = 0; i < s.length(); i++)` lalu menganggap `charAt(i)` adalah character manusia.

Lebih aman:

```java
String text = "A🙂B";

text.codePoints().forEach(cp -> {
    System.out.printf("U+%04X%n", cp);
});
```

---

## 11.2.3 Code point belum tentu grapheme cluster

Contoh kompleks:

```java
String family = "👨‍👩‍👧‍👦";
```

Secara visual terlihat satu emoji keluarga, tetapi terdiri dari beberapa code point yang digabung dengan zero-width joiner.

Contoh lain:

```java
String e1 = "é";        // bisa satu code point U+00E9
String e2 = "e\u0301"; // huruf e + combining acute accent
```

Keduanya bisa terlihat sama tetapi binary berbeda:

```java
System.out.println(e1.equals(e2)); // false, sebelum normalisasi
```

Untuk membandingkan bentuk canonical:

```java
import java.text.Normalizer;

String n1 = Normalizer.normalize(e1, Normalizer.Form.NFC);
String n2 = Normalizer.normalize(e2, Normalizer.Form.NFC);

System.out.println(n1.equals(n2)); // true
```

Mental model:

- code point = unit Unicode;
- grapheme cluster = unit user-perceived character;
- Java standard library punya dukungan code point kuat;
- grapheme segmentation penuh lebih kompleks dan sering membutuhkan ICU4J untuk kasus natural language berat.

---

## 11.2.4 Kapan memakai `char`, kapan memakai `int codePoint`?

Pakai `char` jika:

- data dijamin ASCII;
- parsing protokol byte/char sederhana;
- delimiter pasti BMP, misalnya `','`, `';'`, `'\n'`;
- kamu memproses UTF-16 internals secara sadar.

Pakai `int codePoint` jika:

- memproses nama manusia;
- validasi huruf/digit Unicode;
- tokenisasi teks multilingual;
- menghitung karakter non-ASCII;
- mendukung emoji/supplementary characters;
- menulis library text processing.

Contoh validasi code point:

```java
static boolean containsOnlyLetters(String text) {
    return text.codePoints().allMatch(Character::isLetter);
}
```

Versi `char` bisa salah untuk supplementary characters:

```java
static boolean broken(String text) {
    for (int i = 0; i < text.length(); i++) {
        if (!Character.isLetter(text.charAt(i))) {
            return false;
        }
    }
    return true;
}
```

---

# 11.3 Encoding dan Charset

## 11.3.1 String bukan byte

Ini salah satu mental model paling penting:

```text
String  = teks dalam model Java
byte[]  = data mentah hasil encoding tertentu
Charset = aturan mapping antara keduanya
```

Contoh:

```java
String text = "café";
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
String decoded = new String(bytes, StandardCharsets.UTF_8);
```

Jangan lakukan ini pada data external:

```java
byte[] bytes = text.getBytes();       // bergantung default charset
String s = new String(bytes);         // bergantung default charset
```

Meskipun Java modern default-nya UTF-8, production code tetap lebih baik eksplisit.

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
String s = new String(bytes, StandardCharsets.UTF_8);
```

Kenapa tetap eksplisit?

- niat jelas;
- review lebih mudah;
- migration lebih aman;
- external contract terdokumentasi;
- tidak bergantung configuration;
- menghindari bug jika runtime diset compatibility mode.

---

## 11.3.2 Charset umum

| Charset | Karakteristik | Use case |
|---|---|---|
| UTF-8 | variable length, kompatibel ASCII | default modern untuk file/API/web |
| UTF-16 | 16-bit code unit, surrogate pair | internal Java API model, beberapa file Windows lama |
| ISO-8859-1 | single byte Latin-1 | legacy western systems |
| Windows-1252 | superset-ish legacy Windows western | file lama dari Windows |
| Shift_JIS | Japanese legacy encoding | integrasi legacy Jepang |
| US-ASCII | 7-bit ASCII | protokol lama tertentu |

Rule umum:

> Untuk sistem baru, gunakan UTF-8 di semua boundary kecuali ada alasan kuat dari sistem legacy.

Boundary yang harus eksplisit charset:

- file import/export;
- HTTP body jika text/plain/csv/xml;
- CSV;
- fixed-width file;
- email body;
- SFTP batch file;
- message payload;
- audit export;
- report generation;
- database import/export.

---

## 11.3.3 Java 18+ UTF-8 by default

Sejak JDK 18, standard Java APIs menetapkan UTF-8 sebagai default charset, kecuali console I/O. Ini membuat behavior lebih konsisten lintas OS.

Namun ini bukan lisensi untuk menulis:

```java
Files.readString(path); // default UTF-8 di Files API memang OK, tapi contract harus jelas
```

Untuk boundary external, lebih baik:

```java
Files.readString(path, StandardCharsets.UTF_8);
Files.writeString(path, content, StandardCharsets.UTF_8);
```

Kenapa?

Karena kode ini bukan hanya instruksi ke JVM, tetapi juga dokumentasi kontrak data.

---

## 11.3.4 CharsetDecoder: ketika streaming dan error handling penting

Untuk file kecil:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Untuk file besar:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Untuk kontrol error malformed/unmappable:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);

try (Reader reader = new InputStreamReader(Files.newInputStream(path), decoder)) {
    // baca dengan error handling eksplisit
}
```

Pilihan `CodingErrorAction`:

| Action | Makna |
|---|---|
| `REPORT` | lempar error, cocok untuk data harus valid |
| `REPLACE` | ganti karakter invalid, cocok untuk best-effort display |
| `IGNORE` | buang data invalid, berbahaya untuk audit/security |

Untuk regulatory/audit system, default aman biasanya:

```text
REPORT malformed input, reject file, simpan evidence error.
```

Jangan diam-diam mengganti data invalid dengan `�` kalau data itu akan menjadi evidence, financial record, atau decision basis.

---

## 11.3.5 BOM

BOM atau Byte Order Mark dapat muncul pada file UTF-8/UTF-16.

Masalah umum:

```text
CSV header terlihat "case_id", tetapi sebenarnya "\uFEFFcase_id".
```

Contoh handling sederhana:

```java
static String stripBom(String s) {
    if (!s.isEmpty() && s.charAt(0) == '\uFEFF') {
        return s.substring(1);
    }
    return s;
}
```

Untuk parser production, jadikan BOM handling bagian dari input adapter, bukan logic domain.

---

# 11.4 Unicode Normalization

## 11.4.1 Kenapa normalisasi perlu?

Dua string bisa terlihat sama tetapi byte/code point berbeda:

```java
String composed = "é";        // U+00E9
String decomposed = "e\u0301"; // U+0065 U+0301

System.out.println(composed.equals(decomposed)); // false
```

Normalisasi membuat bentuk equivalent menjadi konsisten:

```java
String a = Normalizer.normalize(composed, Normalizer.Form.NFC);
String b = Normalizer.normalize(decomposed, Normalizer.Form.NFC);

System.out.println(a.equals(b)); // true
```

---

## 11.4.2 Bentuk normalisasi

| Form | Makna | Use case |
|---|---|---|
| NFC | canonical composition | default umum untuk storage/display |
| NFD | canonical decomposition | analisis accent/diacritic |
| NFKC | compatibility composition | search/index/security normalization tertentu |
| NFKD | compatibility decomposition | transliteration/search tertentu |

Default praktis:

```text
Untuk storage teks manusia: pertimbangkan NFC.
Untuk search accent-insensitive: normalize + remove combining marks.
Untuk security-sensitive identifier: jangan sembarang NFKC tanpa threat model.
```

---

## 11.4.3 Accent-insensitive search contoh

```java
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

final class TextSearchKey {
    private static final Pattern COMBINING_MARKS = Pattern.compile("\\p{M}+");

    static String foldForSearch(String input) {
        String normalized = Normalizer.normalize(input, Normalizer.Form.NFD);
        String withoutMarks = COMBINING_MARKS.matcher(normalized).replaceAll("");
        return withoutMarks.toLowerCase(Locale.ROOT);
    }
}
```

Contoh:

```java
System.out.println(TextSearchKey.foldForSearch("José")); // jose
System.out.println(TextSearchKey.foldForSearch("JOSE")); // jose
```

Catatan penting:

- ini bukan solusi sempurna untuk semua bahasa;
- beberapa bahasa punya aturan collation/search sendiri;
- untuk search multilingual serius, pertimbangkan search engine atau ICU4J.

---

# 11.5 Case Mapping dan Locale

## 11.5.1 `toLowerCase()` tanpa Locale adalah jebakan

```java
String key = "TITLE".toLowerCase(); // bergantung default locale
```

Untuk key internal, enum name, protocol value, header, identifier:

```java
String key = "TITLE".toLowerCase(Locale.ROOT);
```

Untuk display ke user:

```java
String display = title.toLowerCase(userLocale);
```

Mental model:

| Kebutuhan | Locale |
|---|---|
| internal normalization | `Locale.ROOT` |
| user-facing format | locale user |
| protocol/API key | jangan locale-sensitive, gunakan fixed canonical form |
| natural language transform | locale eksplisit |

---

## 11.5.2 Turkish-I problem

Dalam Turkish, huruf `I` dan `i` tidak berperilaku seperti English.

```java
Locale turkish = Locale.forLanguageTag("tr-TR");

System.out.println("TITLE".toLowerCase(Locale.ROOT)); // title
System.out.println("TITLE".toLowerCase(turkish));     // tıtle, dotless i
```

Bug production klasik:

```java
String header = input.toLowerCase();
if (header.equals("content-type")) { ... }
```

Pada default locale tertentu, hasil bisa salah.

Solusi:

```java
String header = input.toLowerCase(Locale.ROOT);
```

---

## 11.5.3 `equalsIgnoreCase` bukan solusi universal

```java
"straße".equalsIgnoreCase("STRASSE") // tidak selalu sesuai ekspektasi natural language
```

Untuk protocol key, `equalsIgnoreCase` sering cukup.

Untuk natural language search/sort, gunakan `Collator` atau search engine yang mendukung analyzer bahasa.

---

# 11.6 Collation: Sorting dan Comparing Teks Manusia

## 11.6.1 `String.compareTo` bukan sorting nama manusia

```java
List<String> names = new ArrayList<>(List.of("Åsa", "Ana", "Änne", "Zoë"));
Collections.sort(names); // lexicographic Unicode order, bukan natural language order
```

Untuk sorting natural language:

```java
Collator collator = Collator.getInstance(Locale.forLanguageTag("sv-SE"));
names.sort(collator);
```

`Collator` melakukan locale-sensitive comparison.

---

## 11.6.2 Collator strength

```java
Collator collator = Collator.getInstance(Locale.ENGLISH);
collator.setStrength(Collator.PRIMARY);

System.out.println(collator.compare("resume", "résumé") == 0); // true pada strength tertentu
```

Strength umum:

| Strength | Sensitivitas |
|---|---|
| PRIMARY | base letter saja, sering abaikan accent/case |
| SECONDARY | bedakan accent |
| TERTIARY | bedakan case/variant |
| IDENTICAL | paling ketat |

Gunakan `Collator` untuk:

- sorting nama;
- search natural language sederhana;
- perbandingan text user-facing.

Jangan gunakan `Collator` untuk:

- key map internal;
- protocol comparison;
- security canonicalization tanpa desain matang.

---

# 11.7 Regex di Java

## 11.7.1 Mental model regex Java

Regex Java memakai dua level escaping:

1. Java string literal escaping.
2. Regex escaping.

Contoh digit:

```java
Pattern p = Pattern.compile("\\d+");
```

`"\\d+"` di Java string menjadi `\d+` untuk regex engine.

Contoh literal backslash:

```java
Pattern backslash = Pattern.compile("\\\\");
```

Maka, jika regex kompleks, gunakan text block untuk readability:

```java
Pattern emailLike = Pattern.compile("""
        (?x)
        ^
        [A-Z0-9._%+-]+  # local part
        @
        [A-Z0-9.-]+     # domain
        \\\.
        [A-Z]{2,}
        $
        """, Pattern.CASE_INSENSITIVE);
```

Catatan: regex email di atas tetap bukan validator email sempurna. Untuk email production, gunakan library/validator yang sesuai kebutuhan.

---

## 11.7.2 `Pattern` vs `Matcher`

```java
Pattern pattern = Pattern.compile("[A-Z]{3}-\\d{4}");
Matcher matcher = pattern.matcher("ABC-1234");

if (matcher.matches()) {
    System.out.println("valid");
}
```

Mental model:

- `Pattern` adalah compiled regex;
- `Pattern` immutable dan aman dishare antar thread;
- `Matcher` menyimpan state matching;
- `Matcher` tidak thread-safe;
- compile regex sekali jika dipakai berkali-kali.

Buruk:

```java
boolean valid(String s) {
    return s.matches("[A-Z]{3}-\\d{4}"); // compile setiap call
}
```

Lebih baik:

```java
private static final Pattern CASE_NO = Pattern.compile("[A-Z]{3}-\\d{4}");

boolean valid(String s) {
    return CASE_NO.matcher(s).matches();
}
```

---

## 11.7.3 `matches`, `find`, `lookingAt`

```java
Pattern p = Pattern.compile("\\d+");

System.out.println(p.matcher("123").matches());    // true, seluruh input
System.out.println(p.matcher("abc123").matches()); // false
System.out.println(p.matcher("abc123").find());    // true, substring
System.out.println(p.matcher("123abc").lookingAt());// true, prefix
```

Rule:

| Method | Arti |
|---|---|
| `matches()` | seluruh input harus match |
| `find()` | cari match berikutnya di input |
| `lookingAt()` | match dari awal input, tidak harus sampai akhir |

Untuk validasi input, biasanya pakai `matches()` dengan anchor eksplisit:

```java
Pattern.compile("^[A-Z]{3}-\\d{4}$")
```

---

## 11.7.4 Character classes dan Unicode

Contoh:

```java
Pattern asciiWord = Pattern.compile("[A-Za-z0-9_]+");
Pattern unicodeLetters = Pattern.compile("\\p{L}+");
Pattern marks = Pattern.compile("\\p{M}+");
```

Beberapa kategori Unicode:

| Regex | Makna |
|---|---|
| `\p{L}` | letter |
| `\p{M}` | mark/combining mark |
| `\p{N}` | number |
| `\p{Sc}` | currency symbol |
| `\p{IsLatin}` | Latin script |
| `\p{IsGreek}` | Greek script |

Untuk domain internasional, hindari asumsi `[A-Za-z]` jika requirement-nya “nama manusia” atau “huruf”.

---

## 11.7.5 Catastrophic backtracking

Regex ini berbahaya:

```java
Pattern evil = Pattern.compile("(a+)+b");
```

Input:

```java
"aaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

Tidak ada `b`, engine bisa mencoba banyak kombinasi dan CPU meledak.

Pattern rawan:

- nested quantifier: `(a+)+`
- ambiguous alternation: `(a|aa)+`
- greedy wildcard besar: `.*.*.*`
- regex kompleks untuk format nested seperti HTML/XML/JSON

Mitigasi:

1. Batasi panjang input sebelum regex.
2. Gunakan possessive quantifier jika cocok.
3. Gunakan atomic group jika cocok.
4. Hindari nested ambiguous quantifier.
5. Untuk format structured, gunakan parser, bukan regex.

Contoh possessive:

```java
Pattern safe = Pattern.compile("a++b");
```

Contoh atomic group:

```java
Pattern safe = Pattern.compile("(?>a+)b");
```

---

## 11.7.6 Regex sebagai boundary validator

Regex cocok untuk:

- format sederhana;
- identifier;
- case number;
- postcode sederhana;
- token sederhana;
- splitting ringan.

Regex buruk untuk:

- JSON/XML/HTML parsing penuh;
- business rule kompleks;
- validasi email sempurna;
- validasi alamat manusia;
- natural language parsing;
- nested grammar.

Contoh domain case number:

```java
record CaseNumber(String value) {
    private static final Pattern PATTERN = Pattern.compile("^CASE-[0-9]{4}-[0-9]{6}$");

    CaseNumber {
        Objects.requireNonNull(value, "value");
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid case number: " + value);
        }
    }
}
```

Regex sebaiknya hidup dekat dengan value object/boundary adapter, bukan tersebar di service.

---

# 11.8 Formatting, Locale, dan Message

## 11.8.1 Formatting angka

Jangan format angka user-facing secara manual:

```java
NumberFormat format = NumberFormat.getNumberInstance(Locale.forLanguageTag("id-ID"));
System.out.println(format.format(1234567.89));
```

Untuk currency:

```java
NumberFormat currency = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("id-ID"));
System.out.println(currency.format(1500000));
```

Untuk internal serialization/API, jangan pakai locale format. Gunakan format stabil:

```java
String value = BigDecimal.valueOf(1234.56).toPlainString();
```

---

## 11.8.2 MessageFormat

Untuk pesan user-facing yang punya placeholder dan perlu localization:

```java
MessageFormat fmt = new MessageFormat(
        "Case {0} was submitted on {1,date,long}",
        Locale.ENGLISH
);

String message = fmt.format(new Object[] { "CASE-2026-000001", new Date() });
```

Untuk aplikasi modern, biasanya `ResourceBundle + MessageFormat` atau framework i18n.

Pitfall:

- quote `'` punya rule khusus di `MessageFormat`;
- jangan memakai format user-facing untuk machine parsing;
- pisahkan message code dari message text.

---

## 11.8.3 `Formatter` / `String.format`

```java
String s = String.format(Locale.ROOT, "%.2f", 12.345);
```

Gunakan `Locale.ROOT` untuk output internal stabil.

```java
String csv = String.format(Locale.ROOT, "%s,%.2f", id, amount);
```

Gunakan locale user untuk display.

```java
String display = String.format(userLocale, "%,.2f", amount);
```

---

# 11.9 Date-Time API: Mental Model

## 11.9.1 Kenapa `java.time` ada?

Sebelum Java 8, Java punya:

- `java.util.Date`;
- `java.util.Calendar`;
- `java.text.SimpleDateFormat`.

Masalah klasik:

- mutability;
- confusing API;
- thread-safety issue pada formatter lama;
- month zero-based di `Calendar`;
- timezone handling rumit;
- sulit membedakan date-only, time-only, instant, local time, offset time.

`java.time` memperbaiki desain dengan type yang lebih eksplisit dan immutable.

---

## 11.9.2 Type utama dan kapan dipakai

| Type | Mewakili | Ada timezone? | Use case |
|---|---|---:|---|
| `Instant` | titik waktu global | UTC-like timeline | audit timestamp, event time, persistence |
| `LocalDate` | tanggal kalender | tidak | tanggal lahir, due date date-only |
| `LocalTime` | jam-menit-detik | tidak | jam buka/tutup |
| `LocalDateTime` | tanggal + waktu lokal | tidak | input form sebelum zone diketahui |
| `OffsetDateTime` | date-time + offset | offset saja | API timestamp dengan offset |
| `ZonedDateTime` | date-time + region zone | ya, zone rules | scheduling manusia, calendar event |
| `Duration` | durasi berbasis detik/nano | tidak | timeout, SLA technical |
| `Period` | periode kalender y/m/d | tidak | umur, subscription month |
| `ZoneId` | zona region | ya | `Asia/Jakarta`, `Europe/Berlin` |
| `ZoneOffset` | offset tetap | ya | `+07:00`, `Z` |
| `Clock` | sumber waktu | tergantung | testability |

Rule ringkas:

```text
Audit/event persistence: Instant.
User schedule: ZonedDateTime + ZoneId.
Date-only business rule: LocalDate.
Duration timeout: Duration.
Calendar period: Period.
```

---

## 11.9.3 `Instant`

```java
Instant now = Instant.now();
```

`Instant` adalah titik pada timeline global.

Cocok untuk:

- createdAt;
- updatedAt;
- submittedAt;
- event occurredAt;
- audit log timestamp;
- message timestamp;
- distributed tracing timestamp.

Contoh persistence:

```java
record CaseSubmitted(
        String caseId,
        Instant occurredAt
) {}
```

`Instant` tidak cocok untuk:

- “tanggal sidang 2026-07-01” tanpa jam;
- “setiap hari jam 09:00 Jakarta”;
- “bulan berjalan”; 
- birthday.

---

## 11.9.4 `LocalDate`

```java
LocalDate dueDate = LocalDate.of(2026, 7, 1);
```

`LocalDate` adalah tanggal kalender tanpa timezone.

Cocok untuk:

- tanggal lahir;
- effective date;
- expiry date date-only;
- business day;
- due date jika aturannya date-based.

Pitfall:

```java
LocalDate date = LocalDate.now(); // memakai default zone sistem
```

Lebih testable:

```java
LocalDate date = LocalDate.now(clock);
```

Atau eksplisit zone:

```java
LocalDate jakartaDate = LocalDate.now(ZoneId.of("Asia/Jakarta"));
```

---

## 11.9.5 `LocalDateTime`

```java
LocalDateTime input = LocalDateTime.of(2026, 3, 29, 2, 30);
```

`LocalDateTime` tidak punya timezone/offset. Ia tidak bisa langsung dianggap sebagai instant global.

Bug klasik:

```java
LocalDateTime submittedAt = LocalDateTime.now();
```

Jika disimpan sebagai audit timestamp, data ini ambigu:

- timezone server apa?
- kalau server pindah region?
- kalau dibaca sistem lain?
- apakah ini UTC atau local?

Gunakan `Instant` untuk audit timestamp.

`LocalDateTime` cocok untuk:

- input form: user memilih tanggal dan jam;
- intermediate value sebelum zone dipasang;
- local schedule template;
- display model.

Konversi ke instant harus butuh zone:

```java
ZoneId zone = ZoneId.of("Asia/Jakarta");
Instant instant = localDateTime.atZone(zone).toInstant();
```

---

## 11.9.6 `OffsetDateTime` vs `ZonedDateTime`

`OffsetDateTime` punya offset tetap:

```java
OffsetDateTime t = OffsetDateTime.parse("2026-06-11T10:15:30+07:00");
```

`ZonedDateTime` punya region zone dan rules:

```java
ZonedDateTime z = ZonedDateTime.of(
        2026, 6, 11, 10, 15, 30, 0,
        ZoneId.of("Asia/Jakarta")
);
```

Perbedaan penting:

```text
+07:00 adalah offset.
Asia/Jakarta adalah zone region.
```

Untuk banyak tempat, offset bisa berubah karena DST atau keputusan pemerintah. Region zone menyimpan rules, offset hanya hasil pada saat tertentu.

Gunakan:

- `OffsetDateTime` untuk API timestamp yang membawa offset;
- `ZonedDateTime` untuk schedule manusia yang harus mengikuti zone rules;
- `Instant` untuk storage event/audit.

---

# 11.10 Time Zone dan DST

## 11.10.1 DST gap

Di beberapa zona, waktu lokal tertentu tidak pernah terjadi karena jam maju.

Contoh konseptual:

```text
2026-03-29 02:30 Europe/Berlin
```

Pada DST start, jam bisa lompat dari 02:00 ke 03:00. Maka 02:30 tidak valid.

```java
ZoneId berlin = ZoneId.of("Europe/Berlin");
LocalDateTime local = LocalDateTime.of(2026, 3, 29, 2, 30);
ZonedDateTime zoned = local.atZone(berlin);
System.out.println(zoned); // Java menyesuaikan sesuai rules
```

Jangan menganggap semua local date-time valid.

---

## 11.10.2 DST overlap

Saat jam mundur, satu waktu lokal bisa terjadi dua kali.

Contoh konseptual:

```text
2026-10-25 02:30 Europe/Berlin
```

Waktu 02:30 bisa punya offset summer/winter berbeda.

Untuk domain scheduling, kamu perlu policy:

- pilih offset earlier;
- pilih offset later;
- minta user konfirmasi;
- reject ambiguous time;
- simpan offset eksplisit.

---

## 11.10.3 Asia/Jakarta tidak berarti semua zona aman

Asia/Jakarta tidak memiliki DST saat ini, tetapi sistem production sering:

- menerima user dari banyak negara;
- memproses event dari external system;
- berjalan di container dengan timezone UTC;
- menyimpan data dari browser;
- membuat report regional;
- melakukan scheduling cross-region.

Jangan desain waktu berdasarkan asumsi zona lokalmu saja.

---

# 11.11 Duration vs Period

## 11.11.1 `Duration`

`Duration` adalah amount berbasis seconds/nanos.

```java
Duration timeout = Duration.ofSeconds(30);
Duration sla = Duration.ofHours(48);
```

Cocok untuk:

- timeout HTTP;
- retry delay;
- SLA technical;
- lock lease;
- cache TTL;
- measuring elapsed time.

---

## 11.11.2 `Period`

`Period` adalah amount kalender berbasis years/months/days.

```java
Period oneMonth = Period.ofMonths(1);
```

Cocok untuk:

- subscription satu bulan;
- umur;
- calendar-based validity;
- due date + 14 calendar days.

Perbedaan:

```java
LocalDate jan31 = LocalDate.of(2026, 1, 31);
System.out.println(jan31.plus(Period.ofMonths(1))); // 2026-02-28
```

Satu bulan bukan jumlah detik tetap.

Rule:

```text
Timeout/SLA technical: Duration.
Business calendar: Period.
```

---

# 11.12 DateTimeFormatter dan Parsing

## 11.12.1 Formatter immutable dan thread-safe

```java
private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_OFFSET_DATE_TIME;
```

Berbeda dari `SimpleDateFormat`, `DateTimeFormatter` immutable dan aman dishare.

---

## 11.12.2 Formatting `Instant`

```java
Instant now = Instant.now();
String s = DateTimeFormatter.ISO_INSTANT.format(now);
```

Output contoh:

```text
2026-06-11T15:30:00Z
```

Untuk zone tertentu:

```java
DateTimeFormatter fmt = DateTimeFormatter
        .ofPattern("yyyy-MM-dd HH:mm:ss VV")
        .withLocale(Locale.ROOT)
        .withZone(ZoneId.of("Asia/Jakarta"));

String display = fmt.format(Instant.now());
```

---

## 11.12.3 `yyyy` vs `YYYY`

Bug klasik:

```java
DateTimeFormatter.ofPattern("YYYY-MM-dd"); // week-based-year, bukan calendar year
```

Biasanya kamu mau:

```java
DateTimeFormatter.ofPattern("yyyy-MM-dd");
```

`YYYY` bisa menghasilkan tahun berbeda di akhir/desember atau awal/januari karena week-based-year.

Rule:

```text
Untuk tanggal kalender biasa: yyyy-MM-dd.
Jangan pakai YYYY kecuali memang week-based-year.
```

---

## 11.12.4 ResolverStyle

Parsing tanggal sebaiknya strict untuk input penting.

```java
DateTimeFormatter strictDate = DateTimeFormatter
        .ofPattern("uuuu-MM-dd")
        .withResolverStyle(ResolverStyle.STRICT);

LocalDate date = LocalDate.parse("2026-02-28", strictDate);
```

Kenapa `uuuu`, bukan `yyyy`?

Dalam formatter Java, `u` adalah proleptic year, sering lebih tepat untuk strict parsing. `y` adalah year-of-era dan bisa butuh era untuk strict resolution pada kasus tertentu.

Contoh input invalid:

```java
LocalDate.parse("2026-02-30", strictDate); // error
```

---

## 11.12.5 Jangan parse user-facing text untuk machine contract

Buruk:

```java
// API mengirim "11 Juni 2026 10:00 WIB"
```

Lebih baik:

```json
{
  "submittedAt": "2026-06-11T03:00:00Z",
  "displayZone": "Asia/Jakarta"
}
```

Machine contract harus stabil:

- ISO-8601;
- explicit offset/zone jika perlu;
- jangan bergantung locale;
- jangan bergantung label timezone seperti `WIB` jika parser tidak mendukung/memahami.

---

# 11.13 Clock dan Testability

## 11.13.1 Jangan panggil `now()` langsung di domain logic

Buruk:

```java
class CaseService {
    void submit(Case c) {
        c.submit(Instant.now());
    }
}
```

Sulit dites secara deterministik.

Lebih baik:

```java
class CaseService {
    private final Clock clock;

    CaseService(Clock clock) {
        this.clock = clock;
    }

    void submit(Case c) {
        c.submit(Instant.now(clock));
    }
}
```

Test:

```java
Clock fixed = Clock.fixed(
        Instant.parse("2026-06-11T03:00:00Z"),
        ZoneOffset.UTC
);
```

---

## 11.13.2 Boundary waktu

Design rule:

```text
Ambil waktu di application boundary, inject ke domain sebagai value.
```

Contoh:

```java
record SubmitCaseCommand(
        String caseId,
        String actorId
) {}

record SubmissionContext(
        Instant receivedAt,
        ZoneId actorZone
) {}
```

Domain method:

```java
caseRecord.submit(command.actorId(), context.receivedAt());
```

Dengan ini:

- audit deterministic;
- test mudah;
- replay event lebih aman;
- business decision bisa dijelaskan;
- tidak ada hidden `now()` di dalam entity.

---

# 11.14 Database dan API Time Design

## 11.14.1 Storage timestamp

Default production guideline:

```text
Store machine event time as Instant/UTC.
Store user intended schedule with ZoneId if future/local semantics matter.
```

Contoh event audit:

```java
record AuditEntry(
        UUID id,
        String action,
        Instant occurredAt,
        String actorId
) {}
```

Database:

```sql
occurred_at TIMESTAMP WITH TIME ZONE -- tergantung DB semantics
```

Catatan: nama type SQL tidak selalu berarti behavior sama antar DB. PostgreSQL `timestamp with time zone` tidak menyimpan nama zone region; ia menyimpan instant yang dinormalisasi. Kalau perlu zone user, simpan kolom terpisah.

```sql
occurred_at_utc TIMESTAMPTZ NOT NULL,
actor_zone_id TEXT NOT NULL
```

---

## 11.14.2 Future schedule

Misalnya user menjadwalkan hearing:

```text
2026-10-25 09:00 Europe/Berlin
```

Simpan:

```java
record ScheduledHearing(
        LocalDateTime localDateTime,
        ZoneId zoneId
) {}
```

Kenapa tidak langsung `Instant` saja?

Karena untuk schedule masa depan, zone rules bisa berubah. Jika hukum/aturan bisnis mengatakan “jam 09:00 waktu lokal Berlin”, maka local date-time + zone id adalah niat user. Instant bisa dihitung untuk eksekusi, tetapi intent tetap harus tersimpan.

Praktik robust:

```text
- simpan localDateTime
- simpan zoneId
- simpan computedInstant saat scheduling
- saat eksekusi, validasi apakah rules berubah jika domain perlu
```

---

## 11.14.3 API timestamp

Untuk API event:

```json
{
  "caseId": "CASE-2026-000001",
  "status": "SUBMITTED",
  "occurredAt": "2026-06-11T03:00:00Z"
}
```

Untuk user-facing date-time:

```json
{
  "hearingDateTime": "2026-10-25T09:00:00",
  "zoneId": "Europe/Berlin"
}
```

Jangan kirim:

```json
{
  "date": "11/06/26"
}
```

Tanpa format/locale, ini ambigu.

---

# 11.15 Legacy Date/Calendar Interop

## 11.15.1 `Date` sebenarnya instant-ish

`java.util.Date` namanya menyesatkan. Ia bukan date-only; ia merepresentasikan instant millisecond dari epoch.

Konversi:

```java
Date date = Date.from(instant);
Instant instant = date.toInstant();
```

---

## 11.15.2 Calendar interop

Jika harus memakai legacy API:

```java
Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
Instant instant = cal.toInstant();
```

Tetapi untuk kode baru, prefer `java.time`.

---

## 11.15.3 SQL time types

Modern JDBC mendukung `java.time` types.

Konsep mapping umum:

| Java | SQL conceptual |
|---|---|
| `LocalDate` | DATE |
| `LocalTime` | TIME |
| `LocalDateTime` | TIMESTAMP WITHOUT TIME ZONE |
| `Instant` / `OffsetDateTime` | TIMESTAMP WITH TIME ZONE, bergantung DB/driver |

Selalu cek behavior driver dan database, jangan asumsi dari nama type.

---

# 11.16 Security dan Reliability pada Text/Time

## 11.16.1 Unicode spoofing

Karakter berbeda bisa terlihat mirip:

```text
Latin A: A
Cyrillic A: А
```

Untuk identifier security-sensitive:

- username;
- domain name;
- email local part;
- permission key;
- role name;
- API client id;
- case reference external;

kamu perlu policy:

```text
- allowlist script tertentu?
- normalize ke NFC?
- reject mixed-script suspicious?
- tampilkan canonical ID?
- audit raw input dan normalized value?
```

Jangan menganggap `String.equals` cukup untuk keamanan visual.

---

## 11.16.2 Control characters

Input user bisa membawa:

- newline;
- tab;
- zero-width space;
- right-to-left override;
- null-like control;
- escape sequence.

Risiko:

- log injection;
- CSV injection;
- UI spoofing;
- audit confusion;
- command injection jika diteruskan ke shell;
- header injection.

Contoh sanitasi log sederhana:

```java
static String safeForSingleLineLog(String input) {
    return input
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\t", "\\t");
}
```

Untuk security serius, buat sanitizer per sink:

```text
HTML sink ≠ SQL sink ≠ CSV sink ≠ log sink ≠ shell sink.
```

---

## 11.16.3 Time-based security

Bug waktu bisa berdampak security:

- token expiry salah karena timezone;
- SLA escalation salah karena `LocalDateTime` ambigu;
- replay window salah karena clock skew;
- certificate validity salah karena parsing;
- audit tampering sulit dideteksi karena timestamp lokal;
- scheduled enforcement berjalan dua kali saat DST overlap.

Guideline:

```text
Security token expiry: Instant + Duration.
Audit: Instant UTC + monotonic sequence jika perlu ordering kuat.
User schedule: LocalDateTime + ZoneId + DST policy.
```

---

# 11.17 Domain Modeling Patterns

## 11.17.1 Value object untuk text input

```java
record PersonName(String value) {
    PersonName {
        value = Objects.requireNonNull(value, "value").strip();
        value = Normalizer.normalize(value, Normalizer.Form.NFC);

        if (value.isBlank()) {
            throw new IllegalArgumentException("name must not be blank");
        }
        if (value.codePointCount(0, value.length()) > 200) {
            throw new IllegalArgumentException("name too long");
        }
    }
}
```

Kenapa code point count, bukan length?

Karena limit domain biasanya “jumlah karakter manusia-ish”, bukan UTF-16 code unit. Meski code point count belum sempurna untuk grapheme cluster, ia lebih baik daripada `length()` untuk supplementary characters.

---

## 11.17.2 Value object untuk machine identifier

```java
record CaseReference(String value) {
    private static final Pattern PATTERN = Pattern.compile("^CASE-[0-9]{4}-[0-9]{6}$");

    CaseReference {
        value = Objects.requireNonNull(value, "value").strip().toUpperCase(Locale.ROOT);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid case reference: " + value);
        }
    }
}
```

Machine identifier boleh jauh lebih ketat daripada nama manusia.

---

## 11.17.3 Value object untuk audit timestamp

```java
record AuditTime(Instant value) {
    AuditTime {
        Objects.requireNonNull(value, "value");
    }

    static AuditTime now(Clock clock) {
        return new AuditTime(Instant.now(clock));
    }
}
```

Domain event:

```java
record CaseStatusChanged(
        CaseReference caseReference,
        String previousStatus,
        String newStatus,
        AuditTime occurredAt
) {}
```

---

## 11.17.4 Value object untuk scheduled local time

```java
record ScheduledLocalDateTime(
        LocalDateTime localDateTime,
        ZoneId zoneId
) {
    ScheduledLocalDateTime {
        Objects.requireNonNull(localDateTime, "localDateTime");
        Objects.requireNonNull(zoneId, "zoneId");
    }

    Instant toInstant() {
        return localDateTime.atZone(zoneId).toInstant();
    }
}
```

Untuk domain yang peduli DST ambiguity, tambahkan policy explicit.

---

# 11.18 Production Failure Modes

## 11.18.1 Text failure modes

| Failure | Penyebab | Pencegahan |
|---|---|---|
| mojibake | decode dengan charset salah | charset eksplisit |
| `String.length()` salah | emoji/surrogate | code point/grapheme aware |
| nama gagal validasi | regex ASCII-only | Unicode-aware requirement |
| sorting aneh | `String.compareTo` | `Collator` |
| search gagal | composed vs decomposed | normalization |
| Turkish-I bug | default locale | `Locale.ROOT` untuk internal |
| regex CPU spike | catastrophic backtracking | regex review + length limit |
| log injection | newline/control chars | sink-specific escaping |
| CSV injection | cell starts with `=`, `+`, `-`, `@` | CSV-safe export policy |
| visual spoofing | confusable chars | identifier policy |

---

## 11.18.2 Time failure modes

| Failure | Penyebab | Pencegahan |
|---|---|---|
| audit timestamp ambigu | `LocalDateTime` | `Instant` |
| schedule salah saat DST | zone ignored | `ZonedDateTime`/policy |
| due date berubah timezone | convert date-only ke instant sembarangan | `LocalDate` untuk date-only |
| timeout salah | pakai `Period` | `Duration` |
| subscription salah | pakai fixed seconds | `Period` |
| test flaky | `Instant.now()` langsung | inject `Clock` |
| parsing salah | locale/format ambigu | ISO + strict formatter |
| report beda server | default zone | explicit zone |
| API consumer bingung | timestamp tanpa offset | ISO instant/offset |
| ordering event salah | clock skew distributed | sequence/version/correlation |

---

# 11.19 Design Checklist

## 11.19.1 Checklist text

Sebelum memproses text, jawab:

1. Ini human text atau machine identifier?
2. Apakah boleh Unicode penuh?
3. Apakah perlu normalization?
4. Apakah comparison-nya binary, case-insensitive, atau locale-sensitive?
5. Apakah sorting harus natural language?
6. Apakah input berasal dari file/network? Charset apa?
7. Apakah data invalid harus reject atau replace?
8. Apakah ada risiko control character/log injection?
9. Apakah regex punya batas panjang input?
10. Apakah storage dan search memakai bentuk canonical yang konsisten?

---

## 11.19.2 Checklist time

Sebelum memakai date-time, jawab:

1. Ini instant global atau tanggal lokal?
2. Apakah value butuh timezone?
3. Apakah timezone region harus disimpan?
4. Apakah offset saja cukup?
5. Apakah event ini audit/persistence?
6. Apakah ini future schedule?
7. Apakah DST gap/overlap perlu policy?
8. Apakah ini duration technical atau period kalender?
9. Apakah formatter/parser strict?
10. Apakah test memakai `Clock`?

---

# 11.20 Recommended Standards untuk Java Project

## 11.20.1 Text standards

```text
1. Semua file source code disimpan UTF-8.
2. Semua file import/export baru harus mendefinisikan charset eksplisit, default UTF-8.
3. Semua conversion String <-> byte[] harus memakai Charset eksplisit.
4. Untuk internal key normalization, gunakan Locale.ROOT.
5. Untuk user-facing sorting/search, gunakan Locale/Collator yang sesuai.
6. Untuk human text storage, normalize ke NFC jika domain menyetujui.
7. Untuk machine identifier, gunakan allowlist ketat dan canonical form.
8. Jangan memakai String.length() untuk batas panjang human text tanpa sadar UTF-16.
9. Regex yang dipakai di hot path harus precompiled static final Pattern.
10. Regex terhadap input external harus punya batas panjang input.
```

---

## 11.20.2 Time standards

```text
1. Audit/event timestamp disimpan sebagai Instant.
2. User schedule masa depan disimpan sebagai LocalDateTime + ZoneId.
3. API machine timestamp memakai ISO-8601 dengan Z/offset eksplisit.
4. Date-only business value memakai LocalDate, bukan midnight Instant sembarangan.
5. Timeout, TTL, retry delay memakai Duration.
6. Calendar validity/subscription memakai Period.
7. Semua domain/service yang butuh current time menerima Clock.
8. Jangan memakai default timezone untuk business rule tanpa eksplisit.
9. Parsing input penting harus strict.
10. Report user-facing harus format dengan Locale dan ZoneId eksplisit.
```

---

# 11.21 Mini Project — Evidence Text and Time Normalizer

## 11.21.1 Goal

Buat library kecil untuk memproses evidence file dari external system:

- input CSV UTF-8;
- reject malformed UTF-8;
- strip BOM;
- normalize nama ke NFC;
- validasi case reference;
- parse timestamp ISO instant;
- parse due date sebagai `LocalDate`;
- build search key accent-insensitive;
- output domain records.

---

## 11.21.2 Domain model

```java
record EvidenceRow(
        CaseReference caseReference,
        PersonName submittedBy,
        Instant submittedAt,
        LocalDate dueDate,
        String searchNameKey
) {}
```

---

## 11.21.3 Parser sketch

```java
final class EvidenceParser {
    List<EvidenceRow> parse(Path path) throws IOException {
        CharsetDecoder decoder = StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(Files.newInputStream(path), decoder))) {

            List<EvidenceRow> rows = new ArrayList<>();
            String header = stripBom(reader.readLine());
            validateHeader(header);

            String line;
            int lineNo = 1;
            while ((line = reader.readLine()) != null) {
                lineNo++;
                rows.add(parseLine(line, lineNo));
            }
            return rows;
        }
    }

    private EvidenceRow parseLine(String line, int lineNo) {
        // Untuk CSV production, gunakan parser CSV library.
        // Ini hanya sketch.
        String[] parts = line.split(",", -1);
        if (parts.length != 4) {
            throw new IllegalArgumentException("invalid column count at line " + lineNo);
        }

        CaseReference ref = new CaseReference(parts[0]);
        PersonName name = new PersonName(parts[1]);
        Instant submittedAt = Instant.parse(parts[2]);
        LocalDate dueDate = LocalDate.parse(parts[3], DateTimeFormatter.ISO_LOCAL_DATE);

        return new EvidenceRow(
                ref,
                name,
                submittedAt,
                dueDate,
                TextSearchKey.foldForSearch(name.value())
        );
    }
}
```

---

# 11.22 Latihan Bertahap

## Latihan 1 — String length trap

Buat program yang mencetak:

- `length()`;
- `codePointCount()`;
- setiap `char` hex;
- setiap code point hex;

untuk input:

```text
A
é
é
🙂
👨‍👩‍👧‍👦
```

Jelaskan hasilnya.

---

## Latihan 2 — Charset corruption

1. Tulis file dengan UTF-8 berisi `こんにちは café 🙂`.
2. Baca dengan UTF-8.
3. Baca dengan ISO-8859-1.
4. Bandingkan hasilnya.
5. Jelaskan kenapa data bisa rusak tanpa exception.

---

## Latihan 3 — Turkish-I

Buat test:

```java
"TITLE".toLowerCase(Locale.ROOT)
"TITLE".toLowerCase(Locale.forLanguageTag("tr-TR"))
```

Jelaskan kenapa internal key harus memakai `Locale.ROOT`.

---

## Latihan 4 — Normalization

Bandingkan:

```java
"é"
"e\u0301"
```

Lakukan:

- `equals` sebelum normalisasi;
- `NFC`;
- `NFD`;
- panjang `length` dan `codePointCount`.

---

## Latihan 5 — Regex performance

Uji regex:

```java
(a+)+b
```

terhadap input panjang tanpa `b`. Lalu ubah menjadi possessive/atomic dan bandingkan.

---

## Latihan 6 — Date-time type selection

Untuk setiap kasus, pilih type Java yang tepat:

1. `createdAt` audit log.
2. Tanggal lahir.
3. Hearing dijadwalkan jam 09:00 Europe/Berlin.
4. Timeout HTTP 30 detik.
5. Subscription 1 bulan.
6. API timestamp dari external system dengan `+07:00`.
7. Report harian berdasarkan Asia/Jakarta.

---

## Latihan 7 — DST policy

Cari zona yang punya DST. Buat local date-time saat gap dan overlap. Amati hasil `atZone`. Tulis policy domain yang menurutmu aman.

---

# 11.23 Ringkasan Mental Model

## Text

```text
byte[] --decode(charset)--> String/char/code units --interpret Unicode--> code points/graphemes
String --encode(charset)--> byte[]
```

Jangan campur:

- byte length;
- string length;
- code point count;
- visual character count.

Mereka berbeda.

---

## Locale

```text
Locale bukan bahasa saja.
Locale adalah konteks formatting/comparison/case mapping untuk user-facing behavior.
```

Gunakan:

- `Locale.ROOT` untuk internal canonicalization;
- user locale untuk display;
- `Collator` untuk sorting natural language.

---

## Time

```text
Instant      = kapan secara global.
LocalDate    = tanggal kalender tanpa waktu.
LocalDateTime= tanggal+waktu lokal tanpa zone.
ZonedDateTime= tanggal+waktu lokal + zone rules.
Duration     = jumlah waktu technical.
Period       = jumlah kalender.
```

Audit:

```text
Instant
```

Schedule manusia:

```text
LocalDateTime + ZoneId (+ DST policy)
```

Testability:

```text
Clock
```

---

# 11.24 Referensi Utama

- Java SE 25 `String` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html
- Java SE 25 `Character` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html
- Java SE 25 `Charset` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/Charset.html
- Java SE 25 `Pattern` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html
- Java SE 25 `Normalizer` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Normalizer.html
- Java SE 25 `Locale` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html
- Java SE 25 `Collator` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Collator.html
- Java SE 25 `java.time` package: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/package-summary.html
- Java SE 25 `Instant` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html
- Java SE 25 `DateTimeFormatter` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html
- JEP 254 — Compact Strings: https://openjdk.org/jeps/254
- JEP 400 — UTF-8 by Default: https://openjdk.org/jeps/400

---

# 11.25 Penutup

Bagian ini mungkin terlihat seperti “materi utility”, tetapi sebenarnya ini adalah fondasi correctness production.

Engineer Java yang kuat tidak hanya tahu bahwa `String` immutable dan `LocalDateTime` ada. Ia tahu:

- kapan `String.length()` menipu;
- kapan `char` tidak cukup;
- kapan charset harus eksplisit;
- kapan text harus dinormalisasi;
- kapan comparison harus locale-sensitive;
- kapan regex menjadi risiko CPU;
- kapan timestamp harus `Instant`;
- kapan schedule harus menyimpan `ZoneId`;
- kapan `Duration` dan `Period` tidak interchangeable;
- kapan `Clock` wajib untuk testable design.

Kalau bagian ini dikuasai, kamu akan jauh lebih siap membangun sistem Java yang benar untuk data global, regulatory workflow, audit trail, dan integrasi enterprise.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java — Part 010](./learn-java-part-010.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 012 — JVM Internal: Dari Class File sampai JIT](./learn-java-part-012.md)

</div>