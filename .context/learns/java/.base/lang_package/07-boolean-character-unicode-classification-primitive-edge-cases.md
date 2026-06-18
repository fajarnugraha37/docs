# Part 7 — `Boolean`, `Character`, Unicode Classification, and Primitive Edge Cases

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `07-boolean-character-unicode-classification-primitive-edge-cases.md`  
> Scope: Java 8–25  
> Focus: `java.lang.Boolean`, `java.lang.Character`, primitive boolean/char modelling, Unicode classification, source identifiers, text/security boundary, and production failure modes.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas wrapper primitive secara umum: boxing, caches, overflow, numeric semantics, dan value representation. Part ini memperdalam dua tipe yang sering terlihat sederhana tetapi secara desain sering menjadi sumber bug halus:

1. `boolean` / `Boolean`
2. `char` / `Character`

Keduanya terlihat kecil:

```java
boolean active = true;
char c = 'A';
```

Tetapi di sistem serius, dua tipe ini menyentuh banyak boundary penting:

- modelling keputusan bisnis;
- representasi state;
- parsing konfigurasi;
- tri-state ambiguity;
- nullability;
- Unicode;
- input validation;
- source-code identifier rules;
- case conversion;
- spoofing;
- masking;
- parsing file legacy;
- XML/DOM/SAX text handling;
- security-sensitive normalization.

Tujuan part ini bukan menghafal method `Boolean` dan `Character`, tetapi membangun mental model:

> `boolean` cocok untuk fakta biner yang benar-benar total dan tidak ambigu.  
> `Boolean` cocok hanya jika nullability adalah bagian kontrak yang eksplisit.  
> `char` bukan “character manusia”; `char` adalah 16-bit UTF-16 code unit.  
> `Character` adalah utility untuk bekerja pada code unit dan code point, tetapi pemrosesan text production harus sadar Unicode boundary.

Setelah part ini, kamu diharapkan bisa:

- membedakan kapan memakai `boolean`, `Boolean`, enum, atau richer domain type;
- memahami kenapa `Boolean.parseBoolean("yes")` menghasilkan `false`, bukan error;
- mendesain konfigurasi boolean yang aman;
- memahami bahwa `char` bukan Unicode code point penuh;
- membaca string berdasarkan code point, bukan asal loop `charAt(i)`;
- membedakan code unit, code point, surrogate pair, glyph, dan grapheme cluster;
- memakai `Character` classification API secara benar;
- memahami source identifier rule di Java;
- menghindari bug security karena case conversion, Unicode spoofing, dan normalization;
- menghubungkan pemahaman ini dengan XML DOM/SAX yang akan dibahas nanti.

---

## 2. Mental Model Utama

### 2.1 `boolean`: binary value, not business state machine

`boolean` hanya punya dua nilai:

```java
true
false
```

Itu cocok untuk pertanyaan yang benar-benar binary:

```java
boolean authenticated;
boolean enabled;
boolean cacheHit;
boolean hasAttachment;
```

Namun banyak konsep bisnis terlihat binary padahal tidak:

```java
Boolean approved;
Boolean verified;
Boolean submitted;
Boolean consented;
```

Pertanyaan penting:

> Apakah domain benar-benar hanya punya dua keadaan, atau ada state lain seperti unknown, pending, not applicable, expired, revoked, system-derived, user-declared, atau not yet evaluated?

Jika ada lebih dari dua keadaan, boolean hampir pasti modelling yang terlalu miskin.

Contoh buruk:

```java
class Application {
    boolean approved;
}
```

Masalah:

- `false` bisa berarti rejected;
- `false` bisa berarti belum diproses;
- `false` bisa berarti approval tidak diperlukan;
- `false` bisa berarti data migrasi belum lengkap;
- `false` bisa berarti default primitive karena field belum diset.

Model lebih jujur:

```java
enum ApprovalStatus {
    NOT_SUBMITTED,
    PENDING_REVIEW,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    NOT_APPLICABLE
}
```

Top 1% engineer tidak hanya bertanya “bisa pakai boolean atau tidak?”, tetapi:

- apa state space yang valid?
- apakah default value aman?
- apakah `false` overloaded?
- apakah transisi state defensible?
- apakah audit log bisa menjelaskan keputusan?
- apakah schema DB/API bisa evolve?

---

### 2.2 `Boolean`: nullable wrapper, not better boolean

`Boolean` bukan versi “enterprise” dari `boolean`. `Boolean` adalah reference wrapper:

```java
Boolean enabled = null;
```

Ia bisa bernilai:

```text
TRUE
FALSE
null
```

Masalahnya, null sering bukan state domain eksplisit, melainkan kebocoran representasi:

```java
if (user.getEmailVerified()) { // possible NullPointerException
    ...
}
```

Jika null punya arti domain, buat eksplisit.

Buruk:

```java
Boolean consentGiven;
```

Lebih baik:

```java
enum ConsentStatus {
    NOT_ASKED,
    GIVEN,
    DENIED,
    WITHDRAWN
}
```

Atau jika field hanya boleh nullable karena external API:

```java
record ExternalUserDto(Boolean emailVerified) {
}
```

Lalu normalize di boundary:

```java
EmailVerificationStatus toDomain(Boolean value) {
    if (value == null) return EmailVerificationStatus.UNKNOWN_FROM_PROVIDER;
    return value ? EmailVerificationStatus.VERIFIED : EmailVerificationStatus.UNVERIFIED;
}
```

---

### 2.3 `char`: UTF-16 code unit, not full Unicode character

Kesalahan besar:

```java
char c = text.charAt(i);
```

dan menganggap `c` selalu satu karakter manusia.

Dalam Java, `char` adalah 16-bit unsigned code unit. Ia merepresentasikan satu unit UTF-16, bukan selalu satu Unicode code point.

Contoh:

```java
String s = "😀";
System.out.println(s.length());      // 2
System.out.println(s.codePointCount(0, s.length())); // 1
```

Emoji `😀` adalah code point U+1F600. Di UTF-16, ia direpresentasikan sebagai surrogate pair: dua `char`.

Mental model:

```text
Human-perceived character / grapheme cluster
    may contain one or more Unicode code points
        each code point may be represented by one or two UTF-16 code units
            Java char = one UTF-16 code unit
```

Jadi:

```text
char != Unicode character
char != glyph
char != grapheme cluster
char == UTF-16 code unit
```

---

### 2.4 `Character`: utility for code units and code points

`Character` menyediakan banyak method:

```java
Character.isLetter(c)
Character.isDigit(c)
Character.isWhitespace(c)
Character.isJavaIdentifierStart(c)
Character.toUpperCase(c)
```

Tetapi banyak method punya overload:

```java
Character.isLetter(char ch)
Character.isLetter(int codePoint)
```

Untuk Unicode modern, biasakan memikirkan versi `int codePoint`, bukan hanya `char`.

Contoh:

```java
int cp = s.codePointAt(index);
boolean letter = Character.isLetter(cp);
```

---

## 3. Posisi API dalam Java 8–25

### 3.1 `Boolean`

`Boolean` berada di `java.lang`, module `java.base` sejak Java 9.

Karakteristik utama:

```java
public final class Boolean
        implements Serializable, Comparable<Boolean>, Constable
```

Pada Java 8, `Boolean` belum punya beberapa API nominal descriptor yang muncul setelah constant API modern. Tetapi untuk penggunaan umum Java 8–25, method-method utama tetap stabil:

```java
Boolean.TRUE
Boolean.FALSE
Boolean.TYPE
Boolean.valueOf(boolean)
Boolean.valueOf(String)
Boolean.parseBoolean(String)
Boolean.getBoolean(String)
booleanValue()
compare(boolean, boolean)
logicalAnd(boolean, boolean)
logicalOr(boolean, boolean)
logicalXor(boolean, boolean)
```

---

### 3.2 `Character`

`Character` juga berada di `java.lang`, module `java.base`.

Ia merepresentasikan wrapper untuk primitive `char`, tetapi jauh lebih penting sebagai Unicode utility.

Dokumentasi Java SE menjelaskan perbedaan istilah:

```text
Unicode code point: nilai karakter dari U+0000 sampai U+10FFFF
Unicode code unit: nilai 16-bit char sebagai unit encoding UTF-16
```

Karena itu, `Character` API banyak memakai dua bentuk:

```java
boolean isLetter(char ch)
boolean isLetter(int codePoint)
```

Untuk sistem modern, versi code point lebih aman ketika input bisa berisi karakter di luar Basic Multilingual Plane.

---

## 4. `boolean` vs `Boolean` vs Enum vs Domain Type

### 4.1 Gunakan `boolean` jika state benar-benar total dan binary

Contoh valid:

```java
record CacheLookupResult(boolean hit, String value) {
}
```

`hit` memang binary: cache hit atau miss.

Contoh valid:

```java
final class FeatureFlagSnapshot {
    private final boolean newSearchEnabled;

    FeatureFlagSnapshot(boolean newSearchEnabled) {
        this.newSearchEnabled = newSearchEnabled;
    }

    boolean isNewSearchEnabled() {
        return newSearchEnabled;
    }
}
```

Jika flag sudah resolved pada boundary config, primitive `boolean` sangat baik karena:

- tidak nullable;
- default eksplisit di constructor;
- mudah dibaca;
- murah;
- tidak memicu accidental unboxing NPE.

---

### 4.2 Gunakan `Boolean` hanya untuk nullable boundary

Contoh boundary external API:

```java
record ProviderUserResponse(
        String id,
        Boolean emailVerified
) {
}
```

Kenapa boleh?

Karena external provider mungkin mengirim:

```json
{"emailVerified": true}
{"emailVerified": false}
{"emailVerified": null}
{}
```

Tetapi jangan biarkan `Boolean` bocor ke core domain.

Normalize:

```java
enum EmailVerificationStatus {
    VERIFIED,
    UNVERIFIED,
    UNKNOWN
}

final class UserMapper {
    static EmailVerificationStatus mapEmailVerified(Boolean value) {
        if (value == null) return EmailVerificationStatus.UNKNOWN;
        return value ? EmailVerificationStatus.VERIFIED : EmailVerificationStatus.UNVERIFIED;
    }
}
```

---

### 4.3 Gunakan enum jika ada lebih dari dua state

Contoh:

```java
enum ReviewDecision {
    NOT_STARTED,
    IN_PROGRESS,
    APPROVED,
    REJECTED,
    NEEDS_MORE_INFORMATION,
    ESCALATED
}
```

Ini jauh lebih baik daripada:

```java
boolean approved;
boolean rejected;
boolean needsMoreInfo;
boolean escalated;
```

Karena kombinasi boolean bisa membuat illegal state:

```text
approved=true, rejected=true
approved=false, rejected=false, needsMoreInfo=false, escalated=false
```

Enum membuat state space lebih terkendali.

---

### 4.4 Gunakan domain type jika boolean membawa alasan, waktu, aktor, atau source

Contoh:

```java
record ConsentDecision(
        ConsentStatus status,
        String source,
        Instant decidedAt,
        String decidedBy
) {
}

enum ConsentStatus {
    NOT_REQUESTED,
    GIVEN,
    DENIED,
    WITHDRAWN
}
```

Ini lebih defensible dibanding:

```java
Boolean consented;
```

Karena compliance/regulatory systems biasanya butuh menjawab:

- siapa yang memberi keputusan?
- kapan?
- melalui channel apa?
- versi policy apa?
- apakah keputusan ditarik kembali?
- apakah default system atau explicit user action?

---

## 5. `Boolean` API Deep Dive

### 5.1 `Boolean.TRUE` and `Boolean.FALSE`

`Boolean` menyediakan singleton constant:

```java
Boolean.TRUE
Boolean.FALSE
```

Biasanya `Boolean.valueOf(boolean)` akan mengembalikan constant ini:

```java
Boolean a = Boolean.valueOf(true);
Boolean b = Boolean.TRUE;

System.out.println(a == b); // true
```

Tetapi jangan mendesain logic berdasarkan identity wrapper.

Baik:

```java
if (Boolean.TRUE.equals(value)) {
    ...
}
```

Buruk:

```java
if (value == Boolean.TRUE) {
    ...
}
```

Secara praktik sering bekerja, tetapi tidak perlu mengandalkan identity untuk value object.

---

### 5.2 `parseBoolean(String)`

Kontrak penting:

```java
Boolean.parseBoolean("true")  // true
Boolean.parseBoolean("TRUE")  // true
Boolean.parseBoolean("TrUe")  // true
Boolean.parseBoolean("false") // false
Boolean.parseBoolean("yes")   // false
Boolean.parseBoolean(null)    // false
Boolean.parseBoolean("1")     // false
```

`parseBoolean` hanya true jika string equals-ignore-case dengan `"true"`. Selain itu false.

Ini berbahaya untuk konfigurasi.

Contoh:

```java
boolean enabled = Boolean.parseBoolean(System.getenv("FEATURE_ENABLED"));
```

Jika env salah ketik:

```text
FEATURE_ENABLED=ture
```

maka hasilnya `false` tanpa error.

Untuk production config, sering lebih baik strict parser:

```java
static boolean parseStrictBoolean(String raw, String name) {
    if (raw == null) {
        throw new IllegalArgumentException(name + " is required");
    }

    return switch (raw.trim().toLowerCase(Locale.ROOT)) {
        case "true" -> true;
        case "false" -> false;
        default -> throw new IllegalArgumentException(
                name + " must be either 'true' or 'false', but was: " + raw);
    };
}
```

Untuk Java 8:

```java
static boolean parseStrictBooleanJava8(String raw, String name) {
    if (raw == null) {
        throw new IllegalArgumentException(name + " is required");
    }

    String normalized = raw.trim().toLowerCase(Locale.ROOT);
    if ("true".equals(normalized)) return true;
    if ("false".equals(normalized)) return false;

    throw new IllegalArgumentException(
            name + " must be either 'true' or 'false', but was: " + raw);
}
```

---

### 5.3 `valueOf(String)`

`Boolean.valueOf(String)` punya semantic sama dengan `parseBoolean`, tetapi mengembalikan `Boolean` object:

```java
Boolean value = Boolean.valueOf("true");
```

Hasil:

```text
"true" ignoring case -> Boolean.TRUE
others              -> Boolean.FALSE
```

Jangan menganggap `valueOf("yes")` error.

---

### 5.4 `getBoolean(String)`

Ini sering disalahpahami.

```java
boolean debug = Boolean.getBoolean("app.debug");
```

Bukan parse string `"app.debug"`. Method ini membaca system property bernama `app.debug`.

Setara mental model:

```java
String value = System.getProperty("app.debug");
boolean debug = Boolean.parseBoolean(value);
```

Contoh:

```bash
java -Dapp.debug=true MyApp
```

```java
Boolean.getBoolean("app.debug") // true
```

Pitfall:

```java
Boolean.getBoolean("true")
```

Ini mencari system property bernama `true`, bukan mengembalikan true.

---

### 5.5 `logicalAnd`, `logicalOr`, `logicalXor`

`Boolean` menyediakan:

```java
Boolean.logicalAnd(a, b)
Boolean.logicalOr(a, b)
Boolean.logicalXor(a, b)
```

Ini bekerja pada primitive boolean.

Perbedaan penting dari operator `&&` dan `||`:

```java
boolean x = Boolean.logicalAnd(expensiveA(), expensiveB());
boolean y = expensiveA() && expensiveB();
```

`logicalAnd` tidak short-circuit karena argument dievaluasi sebelum method dipanggil.

Jadi:

```java
Boolean.logicalAnd(false, expensive())
```

`expensive()` tetap dieksekusi.

Sedangkan:

```java
false && expensive()
```

`expensive()` tidak dieksekusi.

Gunakan `logicalAnd`/`logicalOr` hanya saat kamu memang butuh method reference atau explicit primitive logical operation, bukan pengganti umum `&&`/`||`.

---

## 6. Boolean Modelling Patterns

### 6.1 Positive naming

Lebih baik:

```java
boolean enabled;
boolean visible;
boolean valid;
boolean allowed;
boolean active;
```

Daripada:

```java
boolean disabled;
boolean invisible;
boolean invalid;
boolean disallowed;
boolean inactive;
```

Karena double negative sulit dibaca:

```java
if (!user.isNotVerified()) {
    ...
}
```

Lebih jelas:

```java
if (user.isVerified()) {
    ...
}
```

Namun ada pengecualian jika domain term memang natural:

```java
boolean deleted;
boolean archived;
boolean cancelled;
```

Itu masih wajar karena merepresentasikan lifecycle marker.

---

### 6.2 Avoid boolean parameter trap

Buruk:

```java
sendEmail(user, true, false, true);
```

Apa arti tiga boolean itu?

Lebih baik:

```java
sendEmail(user, EmailOptions.builder()
        .priority(Priority.HIGH)
        .includeAttachments(false)
        .auditRequired(true)
        .build());
```

Atau:

```java
sendEmail(user, EmailMode.AUDITED_HIGH_PRIORITY);
```

Boolean parameter mudah membuat call-site tidak terbaca.

Pattern lebih baik:

```java
void updateStatus(ApplicationId id, ApprovalStatus status) {
    ...
}
```

Daripada:

```java
void updateStatus(ApplicationId id, boolean approved) {
    ...
}
```

---

### 6.3 Boolean as derived property, not source of truth

Contoh:

```java
class CaseFile {
    private CaseStatus status;

    boolean isClosed() {
        return status == CaseStatus.CLOSED
            || status == CaseStatus.REJECTED
            || status == CaseStatus.WITHDRAWN;
    }
}
```

`isClosed()` adalah derived boolean. Source of truth tetap `CaseStatus`.

Ini bagus karena:

- state utama tidak hilang;
- query tetap ergonomis;
- perubahan definisi “closed” bisa dikendalikan;
- audit/history lebih kaya.

---

### 6.4 Boolean in database schema

Di banyak database, boolean bisa muncul sebagai:

```text
true/false
Y/N
1/0
T/F
ACTIVE/INACTIVE
nullable column
```

Jangan biarkan mapping DB otomatis mengaburkan domain.

Contoh mapper eksplisit:

```java
static boolean parseYn(String value, String column) {
    if ("Y".equals(value)) return true;
    if ("N".equals(value)) return false;
    throw new IllegalArgumentException(column + " must be Y or N but was " + value);
}
```

Untuk nullable DB column:

```java
static Optional<Boolean> parseNullableYn(String value, String column) {
    if (value == null) return Optional.empty();
    return Optional.of(parseYn(value, column));
}
```

Tetapi jika null punya arti domain, lebih baik enum.

---

## 7. `char` and `Character`: Unicode Mental Model

### 7.1 Unicode code point

Unicode memberi nomor untuk karakter abstrak.

Contoh:

```text
'A'  -> U+0041
'あ' -> U+3042
'😀' -> U+1F600
```

Rentang valid code point:

```text
U+0000 sampai U+10FFFF
```

Di Java, code point biasanya direpresentasikan dengan `int`.

```java
int codePoint = 0x1F600;
```

---

### 7.2 UTF-16 code unit

Java `char` adalah 16-bit code unit.

Untuk code point dalam Basic Multilingual Plane/BMP:

```text
U+0000 sampai U+FFFF
```

satu code point bisa direpresentasikan oleh satu `char`.

Contoh:

```java
char a = 'A';       // U+0041
char hiragana = 'あ'; // U+3042
```

Tetapi code point di atas U+FFFF butuh dua `char`:

```java
String emoji = "😀";

System.out.println(emoji.length()); // 2 char/code units
```

---

### 7.3 Surrogate pairs

UTF-16 memakai surrogate pair untuk merepresentasikan supplementary code point.

Surrogate range:

```text
High surrogate: U+D800 to U+DBFF
Low surrogate : U+DC00 to U+DFFF
```

Contoh:

```java
String emoji = "😀";
char high = emoji.charAt(0);
char low = emoji.charAt(1);

System.out.println(Character.isHighSurrogate(high)); // true
System.out.println(Character.isLowSurrogate(low));   // true
System.out.println(Character.toCodePoint(high, low)); // 128512 / 0x1F600
```

Jika kamu loop pakai `charAt`, kamu bisa memecah satu code point menjadi dua unit yang tidak bermakna sendiri.

---

### 7.4 Grapheme cluster

Bahkan code point pun belum tentu sama dengan “karakter yang terlihat manusia”.

Contoh:

```text
é
```

Bisa direpresentasikan sebagai:

```text
U+00E9                  // precomposed
U+0065 U+0301           // e + combining acute accent
```

Keduanya bisa terlihat sama, tetapi sequence code point berbeda.

Contoh lain:

```text
👨‍👩‍👧‍👦
```

Family emoji bisa terdiri dari beberapa code point yang disambung zero width joiner.

Jadi levelnya:

```text
char/code unit < code point < grapheme cluster < rendered glyph/user-perceived character
```

`Character` cukup kuat untuk code point classification, tetapi bukan full grapheme segmentation engine. Untuk text UI, search, collation, dan language-sensitive processing, kamu sering butuh `java.text`, ICU4J, database collation, atau dedicated text processing layer.

---

## 8. Correct Iteration Over Text

### 8.1 Wrong: iterate by `char`

```java
static int countLettersWrong(String s) {
    int count = 0;
    for (int i = 0; i < s.length(); i++) {
        if (Character.isLetter(s.charAt(i))) {
            count++;
        }
    }
    return count;
}
```

Ini salah untuk supplementary characters tertentu karena membaca code unit, bukan code point.

---

### 8.2 Better: iterate by code point

```java
static int countLetters(String s) {
    int count = 0;
    for (int i = 0; i < s.length(); ) {
        int cp = s.codePointAt(i);
        if (Character.isLetter(cp)) {
            count++;
        }
        i += Character.charCount(cp);
    }
    return count;
}
```

Atau:

```java
static long countLettersStream(String s) {
    return s.codePoints()
            .filter(Character::isLetter)
            .count();
}
```

Catatan performance:

- loop manual memberi kontrol allocation/performance lebih baik;
- `codePoints()` lebih declarative tetapi tetap harus diuji untuk hot path.

---

### 8.3 Safe truncate by code point

Buruk:

```java
String prefix = input.substring(0, maxChars);
```

Jika `maxChars` jatuh di tengah surrogate pair, string bisa mengandung surrogate tidak valid.

Lebih baik:

```java
static String truncateByCodePoints(String input, int maxCodePoints) {
    if (input == null) return null;
    if (maxCodePoints < 0) throw new IllegalArgumentException("maxCodePoints must be >= 0");

    int end = input.offsetByCodePoints(0, Math.min(maxCodePoints, input.codePointCount(0, input.length())));
    return input.substring(0, end);
}
```

Namun ini masih bukan truncate by grapheme cluster. Untuk UI display, code point truncation masih bisa memotong combining sequence.

---

## 9. `Character` Classification API

### 9.1 Letter, digit, alphanumeric

Common APIs:

```java
Character.isLetter(cp)
Character.isDigit(cp)
Character.isLetterOrDigit(cp)
```

Gunakan overload `int` untuk code point.

Contoh:

```java
static boolean isAlphaNumericCodePoint(int cp) {
    return Character.isLetterOrDigit(cp);
}
```

Tetapi ingat: ini Unicode-aware, bukan ASCII-only.

```java
Character.isDigit('5')       // true
Character.isDigit('５')      // true, fullwidth digit
Character.isDigit('٣')       // true, Arabic-Indic digit
```

Jika requirement adalah ASCII digit untuk protocol/config/token, jangan pakai `isDigit` tanpa sadar.

ASCII-only:

```java
static boolean isAsciiDigit(int cp) {
    return cp >= '0' && cp <= '9';
}
```

ASCII alphanumeric:

```java
static boolean isAsciiAlphaNum(int cp) {
    return (cp >= 'A' && cp <= 'Z')
        || (cp >= 'a' && cp <= 'z')
        || (cp >= '0' && cp <= '9');
}
```

---

### 9.2 Whitespace

Java punya beberapa method yang mirip:

```java
Character.isWhitespace(cp)
Character.isSpaceChar(cp)
String.strip()
String.trim()
```

Perbedaan detailnya penting.

- `trim()` historis menghapus karakter <= U+0020.
- `strip()` memakai Unicode whitespace awareness via `Character.isWhitespace`.
- `isSpaceChar` berfokus pada Unicode space separators, line separator, paragraph separator.

Untuk Java 11+:

```java
String normalized = input.strip();
```

Untuk Java 8:

```java
String normalized = input.trim();
```

Tetapi `trim()` tidak sama dengan `strip()`.

Untuk security-sensitive token parsing, sebaiknya definisikan whitespace apa yang diterima.

Contoh strict header parser:

```java
static String requireNoWhitespace(String value, String name) {
    for (int i = 0; i < value.length(); ) {
        int cp = value.codePointAt(i);
        if (Character.isWhitespace(cp)) {
            throw new IllegalArgumentException(name + " must not contain whitespace");
        }
        i += Character.charCount(cp);
    }
    return value;
}
```

---

### 9.3 Unicode category

`Character.getType(cp)` mengembalikan category Unicode seperti:

```java
Character.UPPERCASE_LETTER
Character.LOWERCASE_LETTER
Character.DECIMAL_DIGIT_NUMBER
Character.SPACE_SEPARATOR
Character.CONTROL
Character.FORMAT
Character.NON_SPACING_MARK
Character.SURROGATE
```

Contoh diagnostic:

```java
static void printCodePoints(String s) {
    for (int i = 0; i < s.length(); ) {
        int cp = s.codePointAt(i);
        System.out.printf("U+%04X type=%d charCount=%d%n",
                cp,
                Character.getType(cp),
                Character.charCount(cp));
        i += Character.charCount(cp);
    }
}
```

Ini berguna untuk debugging input aneh:

- invisible characters;
- zero width joiner;
- non-breaking space;
- mixed-script spoofing;
- unexpected combining marks;
- control characters.

---

### 9.4 Control and format characters

Contoh validasi untuk field ID:

```java
static void rejectControlAndFormatChars(String value, String fieldName) {
    for (int i = 0; i < value.length(); ) {
        int cp = value.codePointAt(i);
        int type = Character.getType(cp);
        if (type == Character.CONTROL || type == Character.FORMAT) {
            throw new IllegalArgumentException(fieldName + " contains invisible/control character U+"
                    + Integer.toHexString(cp).toUpperCase(Locale.ROOT));
        }
        i += Character.charCount(cp);
    }
}
```

Namun hati-hati: beberapa format characters bisa sah dalam bahasa tertentu atau emoji sequences. Jangan membuat validasi global terlalu agresif untuk nama manusia, tetapi boleh ketat untuk identifier teknis.

---

## 10. Java Identifier Rules

### 10.1 Source code identifiers are Unicode-aware

Java source identifiers bukan hanya ASCII.

Validasi identifier Java bisa memakai:

```java
Character.isJavaIdentifierStart(cp)
Character.isJavaIdentifierPart(cp)
```

Contoh:

```java
static boolean isJavaIdentifier(String s) {
    if (s == null || s.isEmpty()) return false;

    int i = 0;
    int first = s.codePointAt(i);
    if (!Character.isJavaIdentifierStart(first)) return false;
    i += Character.charCount(first);

    while (i < s.length()) {
        int cp = s.codePointAt(i);
        if (!Character.isJavaIdentifierPart(cp)) return false;
        i += Character.charCount(cp);
    }

    return true;
}
```

Ini berguna untuk code generation, expression language, template engine, DSL, annotation processor, atau mapper generator.

---

### 10.2 Java identifier is not business identifier

Jangan pakai `isJavaIdentifierStart/Part` untuk validasi business ID kecuali memang domainnya Java source code.

Contoh business identifiers:

```text
case number
license number
postal code
user ID
agency code
external reference number
```

Masing-masing punya grammar sendiri.

Contoh postal code SG 6 digit:

```java
static boolean isSingaporePostalCode(String value) {
    if (value == null || value.length() != 6) return false;
    for (int i = 0; i < value.length(); i++) {
        char ch = value.charAt(i);
        if (ch < '0' || ch > '9') return false;
    }
    return true;
}
```

Kenapa ASCII digit, bukan `Character.isDigit`?

Karena postal code external API biasanya mengharapkan ASCII digits `0-9`, bukan Unicode decimal digit dari script lain.

---

### 10.3 `isIdentifierIgnorable`

`Character.isIdentifierIgnorable(cp)` menguji karakter yang dapat diabaikan dalam identifier.

Ini penting untuk compiler/source tooling, tetapi berbahaya jika digunakan di business validation tanpa memahami konsekuensinya. Invisible characters dapat menyebabkan dua string terlihat sama tapi berbeda secara binary.

Untuk domain technical identifiers, biasanya lebih aman reject invisible/format/control chars.

---

## 11. Case Conversion and Locale Bugs

### 11.1 `Character.toLowerCase` vs `String.toLowerCase`

`Character.toLowerCase(cp)` melakukan mapping satu code point.

`String.toLowerCase(Locale)` bisa melakukan string-level mapping.

Beberapa case conversion tidak satu-ke-satu.

Contoh klasik:

```java
"TITLE".toLowerCase(new Locale("tr", "TR"))
```

Dalam Turkish locale, `I` punya behavior berbeda.

Untuk protocol keys, enum names, headers, config keys, use:

```java
value.toLowerCase(Locale.ROOT)
```

Bukan:

```java
value.toLowerCase()
```

Karena no-arg `toLowerCase()` memakai default locale process/JVM.

---

### 11.2 Case-insensitive comparison

Untuk simple protocol-ish ASCII values:

```java
"true".equalsIgnoreCase(raw)
```

Untuk user-facing language text, case-insensitive matching jauh lebih kompleks dan bisa melibatkan normalization/collation.

Jangan mencampur:

- protocol case-insensitive;
- language-aware comparison;
- database collation;
- security canonicalization.

Mereka punya tujuan berbeda.

---

### 11.3 Uppercase/lowercase is not normalization

Ini salah:

```java
String canonical = input.toLowerCase(Locale.ROOT);
```

Jika kamu ingin canonicalization Unicode, case folding dan normalization adalah topik berbeda.

Untuk banyak technical ID, strategi lebih aman:

1. batasi character set;
2. normalisasi whitespace;
3. reject invisible/control chars;
4. tentukan case sensitivity secara eksplisit;
5. simpan canonical form dan original form jika perlu.

---

## 12. Unicode Normalization Boundary

### 12.1 Equivalent-looking strings may not be binary equal

Contoh:

```java
String a = "é";        // U+00E9
String b = "e\u0301"; // U+0065 + U+0301

System.out.println(a.equals(b)); // false
```

Keduanya bisa terlihat sama.

Java menyediakan normalization di `java.text.Normalizer`, bukan `java.lang.Character`.

```java
import java.text.Normalizer;

String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Meskipun `Normalizer` bukan fokus part ini, kamu perlu tahu boundary-nya karena `Character` classification saja tidak cukup.

---

### 12.2 When to normalize

Normalisasi cocok untuk:

- search keys;
- deduplication;
- canonical comparison;
- user input matching;
- file names in cross-platform system;
- security-sensitive allowlist check.

Tetapi jangan normalisasi sembarangan pada:

- password;
- cryptographic material;
- signed XML/text;
- exact legal text;
- binary protocol payload;
- audit evidence.

Untuk signed payload, perubahan satu code point saja bisa membatalkan signature.

---

### 12.3 Store original and canonical forms

Pattern production:

```java
record NormalizedName(
        String original,
        String canonical
) {
    static NormalizedName from(String input) {
        String original = Objects.requireNonNull(input, "input");
        String canonical = Normalizer.normalize(original, Normalizer.Form.NFC)
                .strip()
                .toLowerCase(Locale.ROOT);
        return new NormalizedName(original, canonical);
    }
}
```

Catatan:

- original untuk display/audit;
- canonical untuk search/matching;
- grammar harus tetap domain-specific.

---

## 13. Security: Unicode Spoofing and Invisible Characters

### 13.1 Homoglyphs

Beberapa karakter dari script berbeda terlihat mirip.

Contoh konseptual:

```text
A Latin 'a'
Cyrillic 'а'
Greek alpha 'α'
```

Mereka tidak sama secara code point.

Risiko:

- username spoofing;
- tenant code spoofing;
- phishing domain-like identifier;
- audit search miss;
- reviewer salah baca;
- malicious config key.

Untuk technical identifiers, gunakan allowlist ketat:

```java
static boolean isSafeAsciiIdentifier(String s) {
    if (s == null || s.isEmpty()) return false;
    for (int i = 0; i < s.length(); i++) {
        char ch = s.charAt(i);
        boolean ok = (ch >= 'A' && ch <= 'Z')
                || (ch >= 'a' && ch <= 'z')
                || (ch >= '0' && ch <= '9')
                || ch == '_' || ch == '-' || ch == '.';
        if (!ok) return false;
    }
    return true;
}
```

Untuk nama manusia, jangan gunakan allowlist ASCII. Pakai policy berbeda.

---

### 13.2 Invisible characters

Beberapa code point tidak terlihat:

- zero width space;
- zero width joiner;
- zero width non-joiner;
- byte order mark;
- control characters;
- variation selectors;
- non-breaking space.

Contoh diagnostic utility:

```java
static String describeCodePoints(String s) {
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < s.length(); ) {
        int cp = s.codePointAt(i);
        if (out.length() > 0) out.append(' ');
        out.append("U+")
           .append(String.format(Locale.ROOT, "%04X", cp))
           .append("(")
           .append(Character.getType(cp))
           .append(")");
        i += Character.charCount(cp);
    }
    return out.toString();
}
```

Gunakan di log diagnostic internal, tetapi hati-hati jangan log PII/sensitive text sembarangan.

---

### 13.3 Mixed-script policy

Untuk beberapa sistem, kamu mungkin perlu mendeteksi input mixed-script. `Character.UnicodeScript` membantu:

```java
static Set<Character.UnicodeScript> scriptsIn(String s) {
    Set<Character.UnicodeScript> scripts = EnumSet.noneOf(Character.UnicodeScript.class);
    for (int i = 0; i < s.length(); ) {
        int cp = s.codePointAt(i);
        Character.UnicodeScript script = Character.UnicodeScript.of(cp);
        if (script != Character.UnicodeScript.COMMON
                && script != Character.UnicodeScript.INHERITED
                && script != Character.UnicodeScript.UNKNOWN) {
            scripts.add(script);
        }
        i += Character.charCount(cp);
    }
    return scripts;
}
```

Namun mixed-script detection bukan solusi lengkap spoofing. Ia hanya salah satu signal.

Untuk sistem high-risk, gunakan library/security profile yang memang didesain untuk Unicode spoof detection.

---

## 14. XML/DOM/SAX Relevance

Kenapa `Boolean` dan `Character` penting untuk seri DOM/SAX nanti?

Karena XML parsing penuh dengan boundary text:

```xml
<enabled>true</enabled>
<postalCode>123456</postalCode>
<name>José</name>
<status>APPROVED</status>
```

Masalah yang akan muncul:

- apakah `enabled` boleh `TRUE`, `true`, `1`, `Y`, `yes`?
- apakah whitespace di text node perlu `strip` atau preserve?
- apakah `postalCode` harus ASCII digit?
- apakah `name` perlu normalization?
- apakah entity expansion menghasilkan text yang harus divalidasi lagi?
- apakah parser mengirim text SAX dalam beberapa `characters()` callback?
- apakah DOM text node bisa terpecah?
- apakah XML signed payload boleh dinormalisasi?

Contoh strict XML boolean parser:

```java
static boolean parseXmlBooleanStrict(String text, String path) {
    String v = text == null ? null : text.strip();
    if ("true".equals(v)) return true;
    if ("false".equals(v)) return false;
    throw new IllegalArgumentException(path + " must be 'true' or 'false'");
}
```

Namun XML Schema `xs:boolean` juga mengenal lexical forms tertentu seperti `true`, `false`, `1`, `0`. Jika kamu sedang mematuhi schema, parser harus sesuai schema contract, bukan preferensi pribadi.

Ini contoh penting:

> Parsing text tidak boleh “kira-kira benar”. Parsing harus mengikuti contract boundary.

---

## 15. Primitive Edge Cases

### 15.1 Default values

Primitive field default:

```java
class Flags {
    boolean enabled; // false by default
    char marker;     // '\u0000' by default
}
```

Default `false` bisa berbahaya jika “belum diset” berbeda dari false.

Default `\u0000` bisa berbahaya jika dianggap empty char.

Tidak ada “empty char” di Java. `char` selalu punya value.

Jika optional character:

```java
OptionalInt optionalCodePoint;
```

atau:

```java
Integer codePointOrNull;
```

atau domain type.

---

### 15.2 `char` numeric nature

`char` bisa dipakai dalam arithmetic karena numeric integral type.

```java
char c = 'A';
int x = c + 1; // 66
```

Ini berguna tetapi juga bisa membingungkan.

```java
char c = '9';
int digit = c - '0'; // 9, ASCII-specific
```

Ini valid untuk ASCII digit, bukan semua Unicode digit.

Unicode-aware:

```java
int digit = Character.digit(cp, 10);
```

Tetapi untuk protocol numeric string, ASCII-only sering lebih benar.

---

### 15.3 `Character.digit` and numeric values

```java
Character.digit('9', 10) // 9
Character.digit('A', 16) // 10
Character.digit('Ｆ', 16) // may map depending Unicode data
```

Jangan gunakan `Character.digit` untuk parsing strict protocol tanpa tahu bahwa ia Unicode-aware.

Untuk hexadecimal protocol yang hanya ASCII:

```java
static int hexValueAscii(int cp) {
    if (cp >= '0' && cp <= '9') return cp - '0';
    if (cp >= 'A' && cp <= 'F') return cp - 'A' + 10;
    if (cp >= 'a' && cp <= 'f') return cp - 'a' + 10;
    return -1;
}
```

---

### 15.4 `char` and signedness

`char` adalah unsigned 16-bit. `byte` adalah signed 8-bit.

Konversi bisa mengejutkan:

```java
char c = 65535;
int i = c; // 65535
```

Tetapi:

```java
byte b = (byte) c; // truncation
```

Hindari memakai `char` sebagai generic unsigned short kecuali benar-benar interop low-level dan sangat jelas.

---

## 16. Production Patterns

### 16.1 Strict boolean config parser

```java
final class ConfigBooleans {
    private ConfigBooleans() {
    }

    static boolean required(String raw, String key) {
        if (raw == null) {
            throw new IllegalArgumentException("Missing required boolean config: " + key);
        }
        return parse(raw, key);
    }

    static boolean optional(String raw, String key, boolean defaultValue) {
        if (raw == null || raw.isBlank()) {
            return defaultValue;
        }
        return parse(raw, key);
    }

    private static boolean parse(String raw, String key) {
        String v = raw.strip().toLowerCase(Locale.ROOT);
        return switch (v) {
            case "true" -> true;
            case "false" -> false;
            default -> throw new IllegalArgumentException(
                    "Config " + key + " must be 'true' or 'false', but was: " + raw);
        };
    }
}
```

Java 8 compatible version:

```java
final class ConfigBooleansJava8 {
    private ConfigBooleansJava8() {
    }

    static boolean required(String raw, String key) {
        if (raw == null) {
            throw new IllegalArgumentException("Missing required boolean config: " + key);
        }
        return parse(raw, key);
    }

    static boolean optional(String raw, String key, boolean defaultValue) {
        if (raw == null || raw.trim().isEmpty()) {
            return defaultValue;
        }
        return parse(raw, key);
    }

    private static boolean parse(String raw, String key) {
        String v = raw.trim().toLowerCase(Locale.ROOT);
        if ("true".equals(v)) return true;
        if ("false".equals(v)) return false;
        throw new IllegalArgumentException(
                "Config " + key + " must be 'true' or 'false', but was: " + raw);
    }
}
```

---

### 16.2 Code point validator for technical identifiers

```java
final class TechnicalIdentifiers {
    private TechnicalIdentifiers() {
    }

    static void requireAsciiIdentifier(String value, String field) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException(field + " is required");
        }

        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            boolean ok = (ch >= 'A' && ch <= 'Z')
                    || (ch >= 'a' && ch <= 'z')
                    || (ch >= '0' && ch <= '9')
                    || ch == '_' || ch == '-' || ch == '.';
            if (!ok) {
                throw new IllegalArgumentException(field + " contains illegal character U+"
                        + String.format(Locale.ROOT, "%04X", (int) ch));
            }
        }
    }
}
```

Untuk business name, jangan pakai ini. Technical ID dan human name beda grammar.

---

### 16.3 Unicode-aware name sanity check

```java
static void rejectDangerousInvisibleChars(String value, String field) {
    if (value == null) return;

    for (int i = 0; i < value.length(); ) {
        int cp = value.codePointAt(i);
        int type = Character.getType(cp);

        if (type == Character.CONTROL) {
            throw new IllegalArgumentException(field + " contains control character U+"
                    + String.format(Locale.ROOT, "%04X", cp));
        }

        // Be careful with FORMAT: some languages and emoji sequences may use them.
        // This policy rejects them for fields where invisibles are not expected.
        if (type == Character.FORMAT) {
            throw new IllegalArgumentException(field + " contains format/invisible character U+"
                    + String.format(Locale.ROOT, "%04X", cp));
        }

        i += Character.charCount(cp);
    }
}
```

Policy harus disesuaikan domain. Jangan jadikan satu validator untuk semua field.

---

### 16.4 Defensive string diagnostics

```java
static String safeDebugShape(String value) {
    if (value == null) return "<null>";

    int codePoints = value.codePointCount(0, value.length());
    StringBuilder types = new StringBuilder();

    for (int i = 0, seen = 0; i < value.length() && seen < 20; seen++) {
        int cp = value.codePointAt(i);
        if (types.length() > 0) types.append(' ');
        types.append("U+")
             .append(String.format(Locale.ROOT, "%04X", cp))
             .append(":")
             .append(Character.getType(cp));
        i += Character.charCount(cp);
    }

    return "chars=" + value.length()
            + ", codePoints=" + codePoints
            + ", prefixTypes=[" + types + "]";
}
```

Ini membantu debugging tanpa mencetak raw sensitive text.

---

## 17. Failure Modes

### 17.1 Nullable Boolean unboxing NPE

```java
Boolean enabled = null;
if (enabled) { // NPE
    ...
}
```

Safe jika null berarti false:

```java
if (Boolean.TRUE.equals(enabled)) {
    ...
}
```

Namun lebih baik normalize boundary.

---

### 17.2 `parseBoolean` hides invalid input

```java
Boolean.parseBoolean("yes")  // false
Boolean.parseBoolean("1")    // false
Boolean.parseBoolean("ture") // false
```

Untuk config dan external payload, silent false bisa dangerous.

---

### 17.3 Overloaded false

```java
boolean approved = false;
```

Bisa berarti:

- rejected;
- pending;
- not applicable;
- not evaluated;
- default;
- migrated unknown.

Gunakan enum/domain state.

---

### 17.4 Boolean parameter unreadability

```java
createUser(name, true, false, true);
```

Buat parameter object, enum, atau named builder.

---

### 17.5 `charAt` breaks emoji/supplementary characters

```java
for (int i = 0; i < s.length(); i++) {
    process(s.charAt(i));
}
```

Gunakan code point loop jika text bisa Unicode penuh.

---

### 17.6 `length()` means code units, not human characters

```java
"😀".length() // 2
```

Untuk count code points:

```java
s.codePointCount(0, s.length())
```

Untuk grapheme cluster, butuh API/library lain.

---

### 17.7 Unicode-aware classification when ASCII-only required

```java
Character.isDigit(cp)
```

menerima banyak digit non-ASCII.

Untuk protocol/API yang require ASCII, pakai explicit range.

---

### 17.8 Default locale bug

```java
key.toLowerCase()
```

Gunakan:

```java
key.toLowerCase(Locale.ROOT)
```

untuk technical keys.

---

### 17.9 Invisible character mismatch

Dua string bisa terlihat sama tetapi berbeda secara binary.

Contoh konseptual:

```text
"admin"
"ad\\u200Bmin"  // zero width space
"ad\\u200Dmin"  // zero width joiner
"ad\\u00A0min"  // non-breaking space
"ad\\u0009min"  // tab
```

Risiko:

- user mengira dua identifier sama;
- reviewer salah membaca data;
- audit search tidak menemukan record;
- allowlist/denylist bypass;
- log tampak normal tetapi value berbeda;
- XML/CSV import membawa invisible character dari copy-paste.

Untuk technical identifier, reject control/format chars atau batasi ke ASCII allowlist.

---

### 17.10 Normalization changes signed data

Jika XML/text ditandatangani secara digital, normalisasi text sembarangan dapat membatalkan signature atau mengubah bukti audit.

Boundary rule:

```text
Normalize for matching/search only when contract allows.
Preserve exact original for audit/signature/legal evidence.
```

Contoh salah:

```java
String canonical = Normalizer.normalize(xmlText, Normalizer.Form.NFC);
verifySignature(canonical); // wrong if signature was generated on original bytes/text model
```

Untuk signed payload, canonicalization harus mengikuti spesifikasi signature/canonical XML yang relevan, bukan normalisasi ad-hoc.

---

## 18. Design Heuristics

### 18.1 Boolean decision checklist

Sebelum membuat field boolean, tanya:

1. Apakah state benar-benar hanya dua?
2. Apakah `false` punya satu arti saja?
3. Apakah ada state `unknown`, `not applicable`, `pending`, `expired`, atau `system-derived`?
4. Apakah default `false` aman?
5. Apakah field ini source of truth atau derived property?
6. Apakah perlu menyimpan reason/timestamp/actor?
7. Apakah boolean ini akan diekspos ke API publik?
8. Apakah naming-nya positive dan jelas?
9. Apakah akan muncul boolean parameter trap?
10. Apakah DB/API external punya representasi lain seperti `Y/N`, `1/0`, atau `null`?

Jika jawaban menunjukkan ambiguity, gunakan enum/domain type.

---

### 18.2 Character/text decision checklist

Sebelum memvalidasi text, tanya:

1. Apakah field ini human text atau technical identifier?
2. Apakah Unicode penuh diterima?
3. Apakah ASCII-only lebih benar?
4. Apakah whitespace boleh?
5. Apakah case-sensitive?
6. Apakah perlu normalization?
7. Apakah input akan dipakai untuk security decision?
8. Apakah invisible/control characters boleh?
9. Apakah panjang dihitung berdasarkan byte, char, code point, atau grapheme?
10. Apakah original text harus dipertahankan untuk audit/signature?

---

### 18.3 Parser design heuristic

Untuk parser boundary:

```text
Lenient input + strict normalization + explicit error reporting
```

Tetapi “lenient” tidak berarti menerima semua value lalu diam-diam default.

Contoh buruk:

```java
boolean enabled = Boolean.parseBoolean(raw);
```

Contoh lebih baik:

```java
boolean enabled = parseStrictBoolean(raw, "feature.enabled");
```

Untuk technical ID:

```text
Strict input + explicit grammar + stable canonical form
```

Untuk human name:

```text
Permissive input + minimal rejection + preserve original + optional canonical search form
```

---

## 19. Java 8–25 Compatibility Notes

### 19.1 Stable core

Core concepts ini stabil dari Java 8 sampai Java 25:

- `boolean` primitive;
- `Boolean` wrapper;
- `char` primitive;
- `Character` wrapper/utility;
- UTF-16 based `String` API;
- `charAt` returns code unit;
- code point APIs;
- surrogate pair utilities;
- classification APIs;
- Java identifier APIs.

---

### 19.2 Java 11+ text convenience

Java 11 menambahkan method `String` seperti:

```java
strip()
stripLeading()
stripTrailing()
isBlank()
lines()
repeat()
```

Untuk Java 8 compatible code, kamu tidak bisa memakai method ini langsung.

Alternatif:

```java
trim()
```

Tetapi `trim()` tidak sama persis dengan Unicode-aware `strip()`.

Jika library harus support Java 8–25, kamu perlu compatibility layer atau baseline berbeda.

---

### 19.3 Unicode data evolves

Unicode version yang didukung Java berubah antar release. Ini berarti hasil method seperti:

```java
Character.isLetter(cp)
Character.getType(cp)
Character.UnicodeScript.of(cp)
```

bisa berubah untuk code point baru ketika runtime Java berbeda.

Untuk kebanyakan aplikasi ini baik. Tetapi untuk compliance/security/protocol parser yang butuh determinisme lintas runtime, kamu harus:

- pin runtime version;
- test matrix Java versions;
- batasi grammar ke ASCII/domain-specific;
- atau pakai library/data Unicode yang dipin versinya.

---

## 20. Exercises

### Exercise 1 — Replace boolean state

Diberikan:

```java
class Application {
    boolean submitted;
    boolean approved;
    boolean rejected;
    boolean withdrawn;
}
```

Tugas:

- identifikasi illegal states;
- desain enum state yang lebih baik;
- definisikan transisi valid;
- tentukan derived boolean method seperti `isTerminal()`.

---

### Exercise 2 — Strict boolean parser

Buat parser config yang:

- menerima hanya `true` dan `false` case-insensitive;
- trim whitespace;
- menolak `yes`, `no`, `1`, `0`, empty string;
- memberi error message dengan nama config;
- support Java 8.

---

### Exercise 3 — Unicode-safe length

Buat utility:

```java
int countCodePoints(String s)
String truncateCodePoints(String s, int max)
```

Test dengan:

```text
abc
😀
a😀b
é
e + combining acute
```

---

### Exercise 4 — Technical ID validator

Buat validator untuk ID teknis:

```text
A-Z a-z 0-9 _ - .
length 1..64
must start with letter
must not end with dot
must not contain consecutive dots
```

Jelaskan kenapa tidak memakai `Character.isLetterOrDigit`.

---

### Exercise 5 — XML text boundary

Diberikan XML:

```xml
<config>
    <enabled> yes </enabled>
    <postalCode>１２３４５６</postalCode>
    <name>é</name>
</config>
```

Tentukan:

- apakah `enabled` valid?
- apakah `postalCode` valid jika contract ASCII 6 digit?
- apakah `name` perlu normalization?
- apakah original name harus disimpan?

---

## 21. Production Checklist

Untuk boolean:

- [ ] Field boolean benar-benar binary.
- [ ] `false` tidak overloaded.
- [ ] Nullable `Boolean` tidak bocor ke core domain kecuali eksplisit.
- [ ] External boolean dinormalisasi di boundary.
- [ ] Config boolean diparse strict.
- [ ] Boolean parameter tidak membuat call-site ambigu.
- [ ] Domain state kompleks memakai enum/domain object.
- [ ] Derived boolean tidak dijadikan source of truth.

Untuk character/text:

- [ ] `char` tidak diasumsikan sebagai full character.
- [ ] Code point loop dipakai untuk Unicode-aware processing.
- [ ] ASCII-only grammar memakai explicit ASCII range.
- [ ] Unicode-aware grammar memakai `Character` overload `int`.
- [ ] Locale-sensitive case conversion memakai `Locale.ROOT` untuk technical keys.
- [ ] Invisible/control chars diperlakukan sesuai policy field.
- [ ] Normalization dilakukan hanya di boundary yang benar.
- [ ] Original text dipertahankan jika dibutuhkan untuk audit/signature/legal evidence.
- [ ] Panjang field didefinisikan: byte, char, code point, atau grapheme.
- [ ] Test mencakup emoji, combining mark, fullwidth digit, whitespace aneh, dan null.

---

## 22. Ringkasan

`Boolean` dan `Character` terlihat kecil, tetapi di sistem production mereka berada di boundary yang sangat penting.

`boolean` bagus untuk fakta binary yang total dan tidak ambigu. Tetapi banyak business state bukan binary. Jika `false` punya lebih dari satu arti, modelnya salah. Gunakan enum atau domain object.

`Boolean` bukan default pilihan yang lebih fleksibel. Ia adalah nullable wrapper. Null harus punya arti eksplisit atau segera dinormalisasi di boundary. Jangan biarkan unboxing NPE menjadi bagian dari business logic.

`char` bukan karakter manusia. Ia adalah UTF-16 code unit. Banyak karakter modern, emoji, dan supplementary code point membutuhkan dua `char`. Untuk Unicode-aware processing, gunakan code point API dan `Character` overload berbasis `int`.

`Character` sangat berguna untuk classification, identifier rules, surrogate handling, Unicode script, dan numeric conversion. Tetapi kamu harus tahu kapan requirement adalah Unicode-aware dan kapan justru ASCII-only. Banyak protocol, config, postal code, token, dan technical ID lebih aman dengan explicit ASCII grammar.

Case conversion, whitespace, normalization, invisible characters, dan mixed-script input adalah area yang sering menciptakan bug security dan data quality. Untuk user-facing text, jangan terlalu agresif. Untuk technical identifiers, jangan terlalu permisif.

Part ini juga mempersiapkan DOM/SAX: XML adalah text boundary. Parsing XML yang aman tidak berhenti setelah dokumen berhasil dibaca. Text content tetap harus diparse, divalidasi, dinormalisasi, atau dipertahankan sesuai contract.

---

## 23. Referensi Resmi dan Lanjutan

- Java SE 25 API — `java.lang.Character`
- Java SE 25 API — `java.lang.Boolean`
- Java SE 25 API — `java.lang.String`
- Java SE 25 API — `java.lang` package summary
- Java Language Specification — lexical structure and identifiers
- Java SE 8 API — baseline compatibility for Java 8
- Unicode Standard — code point, code unit, normalization, categories
- Java `java.text.Normalizer` API for Unicode normalization

---

## 24. Status Seri

Progress saat ini:

```text
Part 0  selesai — Orientation
Part 1  selesai — java.lang as Platform Root Contract
Part 2  selesai — Object
Part 3  selesai — Class<T>
Part 4  selesai — String
Part 5  selesai — CharSequence/StringBuilder/StringBuffer
Part 6  selesai — Primitive Wrappers/Numeric Semantics
Part 7  selesai — Boolean/Character/Unicode/Primitive Edge Cases
```

Seri belum selesai.

Part berikutnya:

```text
Part 8 — Enum: Constant Identity, Type Safety, Switch, Serialization, Design
File   — 08-enum-constant-identity-type-safety-switch-serialization.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 6 — Primitive Wrappers, Boxing, Caches, Numeric Semantics](./06-primitive-wrappers-boxing-caches-numeric-semantics.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 8 — `Enum`: Constant Identity, Type Safety, Switch, Serialization, Design](./08-enum-constant-identity-type-safety-switch-serialization.md)
