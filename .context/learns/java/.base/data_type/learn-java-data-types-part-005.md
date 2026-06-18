# learn-java-data-types-part-005.md

# Java Data Types — Part 005  
# `char`, Unicode, Code Point, `String`, dan Text Data

> Seri: **Advanced Java Data Types**  
> Bagian: **005**  
> Fokus: memahami text data di Java dari sudut type system dan production engineering: `char` sebagai UTF-16 code unit, Unicode code point, surrogate pair, grapheme cluster, `String.length()` trap, normalization, locale-sensitive case mapping, collation, validation, security, database/API boundary, dan failure mode production.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Text Data Itu Sulit](#2-kenapa-text-data-itu-sulit)
3. [`char` dalam Java Type System](#3-char-dalam-java-type-system)
4. [Mental Model: Character, Code Point, Code Unit, Glyph, Grapheme](#4-mental-model-character-code-point-code-unit-glyph-grapheme)
5. [Unicode dan UTF-16 di Java](#5-unicode-dan-utf-16-di-java)
6. [`char` adalah UTF-16 Code Unit, Bukan Karakter Manusia](#6-char-adalah-utf-16-code-unit-bukan-karakter-manusia)
7. [Basic Multilingual Plane dan Supplementary Characters](#7-basic-multilingual-plane-dan-supplementary-characters)
8. [Surrogate Pair](#8-surrogate-pair)
9. [`String.length()`, `charAt`, dan Index Trap](#9-stringlength-charat-dan-index-trap)
10. [Code Point API di `String` dan `Character`](#10-code-point-api-di-string-dan-character)
11. [Iterasi Text yang Benar](#11-iterasi-text-yang-benar)
12. [Grapheme Cluster: Karakter yang Dilihat User](#12-grapheme-cluster-karakter-yang-dilihat-user)
13. [Combining Marks dan Normalization](#13-combining-marks-dan-normalization)
14. [Unicode Normalization: NFC, NFD, NFKC, NFKD](#14-unicode-normalization-nfc-nfd-nfkc-nfkd)
15. [Case Mapping dan Locale Trap](#15-case-mapping-dan-locale-trap)
16. [Turkish `I` Problem](#16-turkish-i-problem)
17. [Case Folding vs Lowercase](#17-case-folding-vs-lowercase)
18. [Collation dan Sorting Natural Language](#18-collation-dan-sorting-natural-language)
19. [Validation: Username, Name, Code, Identifier](#19-validation-username-name-code-identifier)
20. [Security: Homoglyph, Confusable, Normalization Attack](#20-security-homoglyph-confusable-normalization-attack)
21. [Text Boundary: API, JSON, Database, Kafka, CSV, Logs](#21-text-boundary-api-json-database-kafka-csv-logs)
22. [Database Collation dan Case Sensitivity](#22-database-collation-dan-case-sensitivity)
23. [Length Limit: Code Unit vs Code Point vs Byte vs Grapheme](#23-length-limit-code-unit-vs-code-point-vs-byte-vs-grapheme)
24. [Encoding Boundary: UTF-8, UTF-16, Charset](#24-encoding-boundary-utf-8-utf-16-charset)
25. [Domain-Specific Text Types](#25-domain-specific-text-types)
26. [`String` Immutability, Interning, dan Memory Note](#26-string-immutability-interning-dan-memory-note)
27. [Production Failure Modes](#27-production-failure-modes)
28. [Best Practices](#28-best-practices)
29. [Decision Matrix](#29-decision-matrix)
30. [Latihan](#30-latihan)
31. [Ringkasan](#31-ringkasan)
32. [Referensi](#32-referensi)

---

# 1. Tujuan Bagian Ini

Banyak engineer mengira text data sederhana:

```java
char c = 'A';
String s = "hello";
System.out.println(s.length());
```

Namun production text handling bisa rusak pada:

- emoji;
- nama orang internasional;
- aksen;
- bahasa Turki;
- huruf Arab/Hebrew/Thai;
- combining mark;
- database collation;
- case-insensitive search;
- username security;
- homoglyph attack;
- byte length limit;
- CSV/export;
- JSON encoding;
- log masking;
- file charset;
- validation regex.

Tujuan bagian ini:

1. memahami `char` secara benar;
2. memahami `String` sebagai UTF-16 sequence;
3. membedakan code unit, code point, grapheme cluster;
4. memahami surrogate pair;
5. memahami normalization;
6. memahami locale-sensitive case mapping;
7. memahami sorting/collation;
8. membuat text validation yang aman;
9. memilih type text yang tepat untuk domain dan boundary.

---

# 2. Kenapa Text Data Itu Sulit

Text terlihat sederhana karena kita melihatnya di layar sebagai karakter.

Tetapi komputer menyimpan text sebagai angka.

Ada beberapa layer:

```text
human-perceived character
  ↓
grapheme cluster
  ↓
Unicode code point(s)
  ↓
encoding code units
  ↓
bytes
  ↓
storage/network
  ↓
font/glyph rendering
```

Jika layer ini dicampur, bug terjadi.

Contoh:

```java
String emoji = "😄";

System.out.println(emoji.length());      // 2
System.out.println(emoji.codePointCount(0, emoji.length())); // 1
```

User melihat satu emoji. Java `String.length()` memberi 2 karena menghitung UTF-16 code units, bukan user-perceived characters.

## 2.1 Text bug sering lolos test

Jika test hanya memakai ASCII:

```text
Fajar
John
ABC123
hello
```

maka bug Unicode tidak terlihat.

Tambahkan test:

```text
José
Å
Å
İstanbul
straße
محمد
你好
😄
👨‍👩‍👧‍👦
```

## 2.2 ASCII mental model berbahaya

ASCII mental model:

```text
1 char = 1 byte = 1 character = 1 screen column
```

Di Unicode modern, ini salah.

Dalam Java:

```text
1 char = 16-bit UTF-16 code unit
1 code point = 1 or 2 char
1 grapheme cluster = 1 or more code points
1 displayed glyph = font/rendering dependent
1 UTF-8 byte count != String.length()
```

---

# 3. `char` dalam Java Type System

`char` adalah primitive integral type.

Properties:

```text
size: 16-bit
range: '\u0000' to '\uffff'
numeric range: 0 to 65535
signed: no, unsigned
default value: '\u0000'
```

Contoh:

```java
char c = 'A';
int code = c;

System.out.println(code); // 65
```

`char` bisa ikut arithmetic:

```java
char c = 'A';
c++;
System.out.println(c); // B
```

## 3.1 `char` bukan `byte`

`char` 16-bit, bukan 8-bit.

```java
char c = '\u00E9'; // é
```

## 3.2 `char` bukan Unicode scalar value penuh

Unicode code point bisa sampai:

```text
U+10FFFF
```

Tetapi `char` hanya sampai:

```text
U+FFFF
```

Jadi banyak code point tidak muat dalam satu `char`.

## 3.3 `char` sebagai type rendah-level

Gunakan `char` untuk:

- simple ASCII delimiter;
- parser/lexer internal;
- known BMP-only processing;
- small char switch;
- low-level UTF-16 operation.

Hindari `char` untuk:

- user-facing character counting;
- emoji handling;
- general Unicode validation;
- name processing;
- security-sensitive text comparison.

---

# 4. Mental Model: Character, Code Point, Code Unit, Glyph, Grapheme

Istilah ini wajib dibedakan.

## 4.1 Character

“Character” sering ambigu. Bisa berarti:

- huruf yang dilihat manusia;
- Unicode code point;
- Java `char`;
- glyph;
- grapheme cluster.

Karena ambigu, hindari istilah “character” tanpa konteks.

## 4.2 Code point

Unicode code point adalah angka yang merepresentasikan abstract character.

Contoh:

```text
U+0041 = LATIN CAPITAL LETTER A
U+1F604 = SMILING FACE WITH OPEN MOUTH AND SMILING EYES
```

Java merepresentasikan code point sebagai `int`.

```java
int codePoint = 0x1F604;
```

## 4.3 Code unit

Code unit adalah unit dalam encoding.

Untuk UTF-16, code unit adalah 16-bit.

Java `char` = UTF-16 code unit.

## 4.4 Glyph

Glyph adalah bentuk visual yang dirender oleh font.

Satu code point bisa punya glyph berbeda tergantung font/style. Satu glyph bisa merepresentasikan beberapa code point.

## 4.5 Grapheme cluster

Grapheme cluster adalah apa yang user anggap sebagai satu karakter.

Contoh:

```text
"a" + combining acute accent
```

bisa terlihat sebagai:

```text
á
```

Emoji family:

```text
👨‍👩‍👧‍👦
```

terdiri dari beberapa code points yang membentuk satu user-perceived grapheme.

## 4.6 Practical mental map

```text
Java char        = UTF-16 code unit
Unicode code point = int
User character   = grapheme cluster
Displayed shape  = glyph
Stored bytes      = charset encoding, often UTF-8 at boundary
```

---

# 5. Unicode dan UTF-16 di Java

Java `String` is specified as a sequence of `char` values, and its API documents UTF-16 representation.

A `String` can represent supplementary characters using surrogate pairs.

## 5.1 UTF-16

UTF-16 encodes Unicode code points as:

- one 16-bit code unit for BMP code points;
- two 16-bit code units for supplementary code points.

## 5.2 BMP

Basic Multilingual Plane:

```text
U+0000 to U+FFFF
```

Most common legacy characters fit here, but not all modern characters/emoji.

## 5.3 Supplementary characters

Supplementary characters:

```text
U+10000 to U+10FFFF
```

Need surrogate pair in UTF-16.

## 5.4 Java consequence

`String.length()` returns number of `char` code units, not code points.

```java
"abc".length() // 3
"😄".length() // 2
```

---

# 6. `char` adalah UTF-16 Code Unit, Bukan Karakter Manusia

This is the most important point in this part.

```java
char c = '😄'; // compile error
```

Why?

`😄` is U+1F604, outside BMP, requiring two UTF-16 code units. A single `char` cannot hold it.

But:

```java
String s = "😄";
char high = s.charAt(0);
char low = s.charAt(1);
```

`high` and `low` are surrogate code units. Neither alone is the emoji.

## 6.1 Broken first character

Bad:

```java
String first = String.valueOf(name.charAt(0));
```

If name starts with supplementary character, result is half surrogate.

Better for code point:

```java
int cp = name.codePointAt(0);
String firstCodePoint = new String(Character.toChars(cp));
```

But for user-perceived grapheme, even code point may not be enough.

## 6.2 Broken truncate

Bad:

```java
String shortText = text.substring(0, 10);
```

Could split surrogate pair or grapheme cluster.

At minimum, truncate by code point:

```java
String truncateCodePoints(String s, int maxCodePoints) {
    if (s.codePointCount(0, s.length()) <= maxCodePoints) {
        return s;
    }
    int end = s.offsetByCodePoints(0, maxCodePoints);
    return s.substring(0, end);
}
```

For UI, grapheme-aware truncation may be needed.

## 6.3 Broken reverse

Naive reverse by char can break surrogate pairs.

Use library/API that understands code points/graphemes if reversing user text is needed.

---

# 7. Basic Multilingual Plane dan Supplementary Characters

## 7.1 BMP examples

BMP includes many common characters:

```text
A U+0041
é U+00E9
中 U+4E2D
ا Arabic letters
many symbols
```

These can fit in one `char`.

## 7.2 Supplementary examples

Supplementary includes many emoji and historic scripts:

```text
😄 U+1F604
𐐷 U+10437
many symbols and emoji
```

These require surrogate pairs.

## 7.3 Why this matters

If your app:

- accepts names;
- handles chat/message;
- stores user input;
- does length limit;
- validates identifiers;
- truncates text;
- masks logs;
- exports CSV;
- indexes search;

then BMP-only assumption is unsafe.

## 7.4 Testing

Always include supplementary character tests:

```java
String emoji = "😄";
assertThat(emoji.length()).isEqualTo(2);
assertThat(emoji.codePointCount(0, emoji.length())).isEqualTo(1);
```

---

# 8. Surrogate Pair

UTF-16 uses surrogate pairs for supplementary code points.

## 8.1 High and low surrogate

High surrogate range:

```text
U+D800 to U+DBFF
```

Low surrogate range:

```text
U+DC00 to U+DFFF
```

Together they encode one supplementary code point.

## 8.2 Java APIs

```java
Character.isHighSurrogate(char ch)
Character.isLowSurrogate(char ch)
Character.isSurrogatePair(char high, char low)
Character.toCodePoint(char high, char low)
Character.toChars(int codePoint)
```

Example:

```java
String s = "😄";

char high = s.charAt(0);
char low = s.charAt(1);

System.out.println(Character.isHighSurrogate(high)); // true
System.out.println(Character.isLowSurrogate(low));   // true
System.out.println(Integer.toHexString(Character.toCodePoint(high, low))); // 1f604
```

## 8.3 Ill-formed UTF-16

A `String` can contain unpaired surrogates because `String` is a sequence of `char` values. Not every sequence is well-formed Unicode text.

Example:

```java
String broken = "\uD83D"; // high surrogate alone
```

Many APIs handle this defensively, but security/reliability-sensitive code should validate if well-formed text is required.

## 8.4 Validation

```java
static boolean isWellFormedUtf16(String s) {
    for (int i = 0; i < s.length(); i++) {
        char ch = s.charAt(i);

        if (Character.isHighSurrogate(ch)) {
            if (i + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(i + 1))) {
                return false;
            }
            i++;
        } else if (Character.isLowSurrogate(ch)) {
            return false;
        }
    }
    return true;
}
```

## 8.5 Boundary behavior

When encoding to UTF-8, ill-formed surrogate sequences may be replaced, rejected, or handled depending encoder configuration.

For strict systems, validate before persistence/transmission.

---

# 9. `String.length()`, `charAt`, dan Index Trap

## 9.1 `String.length()`

Returns number of UTF-16 code units.

```java
"hello".length() // 5
"😄".length()    // 2
```

## 9.2 `charAt`

Returns one UTF-16 code unit.

```java
String s = "😄";
char c = s.charAt(0); // high surrogate, not full emoji
```

## 9.3 `substring`

Indexes are char indexes.

```java
s.substring(0, 1)
```

can return half surrogate if not careful.

## 9.4 `offsetByCodePoints`

Use to move by code points:

```java
int index = s.offsetByCodePoints(0, 1);
String firstCodePoint = s.substring(0, index);
```

## 9.5 `codePointCount`

```java
int count = s.codePointCount(0, s.length());
```

Counts code points, not grapheme clusters.

## 9.6 Index mapping is expensive

Code point indexing is not O(1) in UTF-16 because code points can take 1 or 2 code units.

Avoid repeated random access by code point in large strings. Iterate once when possible.

---

# 10. Code Point API di `String` dan `Character`

## 10.1 `String.codePointAt`

```java
int cp = s.codePointAt(index);
```

Index is still char index.

## 10.2 `String.codePointBefore`

```java
int cp = s.codePointBefore(index);
```

## 10.3 `String.codePoints`

```java
s.codePoints().forEach(cp -> {
    System.out.println(Integer.toHexString(cp));
});
```

Returns `IntStream` of code points.

## 10.4 `Character` methods

```java
Character.isLetter(int codePoint)
Character.isDigit(int codePoint)
Character.isWhitespace(int codePoint)
Character.toLowerCase(int codePoint)
Character.toUpperCase(int codePoint)
Character.getType(int codePoint)
Character.charCount(int codePoint)
```

Prefer `int codePoint` overloads where possible.

## 10.5 Create String from code point

```java
String s = new String(Character.toChars(0x1F604));
```

or:

```java
String s = new StringBuilder().appendCodePoint(0x1F604).toString();
```

## 10.6 Code point validation

```java
if (!Character.isValidCodePoint(cp)) {
    throw new IllegalArgumentException("Invalid Unicode code point");
}
```

---

# 11. Iterasi Text yang Benar

## 11.1 Iterasi char

```java
for (int i = 0; i < s.length(); i++) {
    char ch = s.charAt(i);
}
```

This iterates UTF-16 code units.

Use only when you intentionally process code units.

## 11.2 Iterasi code point

```java
for (int i = 0; i < s.length(); ) {
    int cp = s.codePointAt(i);
    // process cp
    i += Character.charCount(cp);
}
```

Or:

```java
s.codePoints().forEach(cp -> process(cp));
```

## 11.3 Iterasi grapheme cluster

Java standard `BreakIterator.getCharacterInstance(locale)` can help approximate character boundaries for locale-sensitive text segmentation, but full modern emoji grapheme behavior may require more specialized Unicode libraries depending requirements.

Example:

```java
BreakIterator iterator = BreakIterator.getCharacterInstance(Locale.ROOT);
iterator.setText(text);

int start = iterator.first();
for (int end = iterator.next(); end != BreakIterator.DONE; start = end, end = iterator.next()) {
    String grapheme = text.substring(start, end);
}
```

## 11.4 Which iteration to choose?

| Need | Iterate by |
|---|---|
| low-level UTF-16 operation | char/code unit |
| Unicode property validation | code point |
| user-visible character count/truncate | grapheme cluster |
| byte limit | encoded bytes |
| database varchar limit | depends DB semantics |
| protocol length | protocol-defined unit |

---

# 12. Grapheme Cluster: Karakter yang Dilihat User

User-perceived character may consist of multiple code points.

Examples:

```text
a + combining acute accent = á
🇮🇩 flag = regional indicator pair
👨‍👩‍👧‍👦 family emoji = multiple emoji + zero-width joiners
```

## 12.1 `codePointCount` still not user character count

```java
String family = "👨‍👩‍👧‍👦";
System.out.println(family.codePointCount(0, family.length()));
```

This can be more than 1, while user sees one family emoji.

## 12.2 UI length limit

If product says:

```text
max 20 characters
```

Clarify:

- code units?
- code points?
- grapheme clusters?
- bytes?
- database characters?
- display columns?

For user-facing text, grapheme clusters are closest.

## 12.3 Storage limit

Storage may limit bytes.

Example:

```text
VARCHAR(20)
```

meaning depends on database encoding/collation/type.

Even if user limit is graphemes, DB must be sized safely in bytes/characters.

## 12.4 Practical strategy

For many backend systems:

- validate max code points for approximate user length;
- enforce byte limit for storage/protocol;
- avoid splitting surrogate pairs;
- for UI-perfect behavior, use frontend/internationalization library with grapheme support;
- document semantics.

---

# 13. Combining Marks dan Normalization

Some characters can be represented multiple ways.

Example:

```text
é
```

Can be:

```text
U+00E9 LATIN SMALL LETTER E WITH ACUTE
```

or:

```text
U+0065 LATIN SMALL LETTER E
U+0301 COMBINING ACUTE ACCENT
```

They look same but binary representation differs.

## 13.1 Equality problem

```java
String composed = "\u00E9";
String decomposed = "e\u0301";

System.out.println(composed.equals(decomposed)); // false
```

But user sees both as `é`.

## 13.2 Search problem

If database stores one form and query uses another, exact match may fail depending normalization/collation.

## 13.3 Security problem

Attackers may use visually similar or canonically equivalent forms to bypass validation or uniqueness checks.

## 13.4 Normalize before canonical comparison

```java
String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Use a consistent normalization policy for identifiers/search keys where appropriate.

---

# 14. Unicode Normalization: NFC, NFD, NFKC, NFKD

Java provides `java.text.Normalizer`.

Forms:

```text
NFC  = canonical composition
NFD  = canonical decomposition
NFKC = compatibility composition
NFKD = compatibility decomposition
```

## 14.1 NFC

Common storage normalization form.

```java
String nfc = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Combines decomposed sequences when possible.

## 14.2 NFD

Decomposes combined characters.

Useful in some search/accent processing.

## 14.3 NFKC/NFKD

Compatibility forms can change semantics more aggressively.

Example: compatibility characters may be folded to simpler forms.

Use carefully, especially for security/identifier normalization, and understand consequences.

## 14.4 Normalization policy

Different fields need different policy.

| Field | Possible policy |
|---|---|
| username/login key | normalize + case fold + confusable policy |
| legal name | preserve original + maybe normalized search key |
| display text | preserve original |
| code/identifier | restrict allowed chars + normalize |
| search index | normalize/search-specific analyzer |
| audit | preserve original plus normalized if needed |

## 14.5 Store original and normalized key

For user names or legal text:

```text
display_name_original
display_name_search_key
```

For username:

```text
username_original?
username_normalized_unique
```

depending product/security requirement.

---

# 15. Case Mapping dan Locale Trap

Case conversion is locale-sensitive.

```java
text.toLowerCase()
text.toUpperCase()
```

without locale uses default locale, which can vary by environment.

Bad for protocol/identifier:

```java
String key = input.toLowerCase();
```

If default locale Turkish, behavior may surprise.

Use:

```java
input.toLowerCase(Locale.ROOT)
```

for locale-neutral identifiers.

Use user locale for display text:

```java
title.toUpperCase(userLocale)
```

## 15.1 Case mapping can change length

```java
"ß".toUpperCase(Locale.GERMAN)
```

may become `"SS"` or capital sharp S depending Unicode/version/context. Do not assume same length.

## 15.2 Case mapping can be one-to-many

A single code point can map to multiple code points.

Therefore:

- don't allocate fixed char buffer assuming same length;
- don't compare by char positions after case mapping;
- don't use case conversion for secure canonicalization casually.

## 15.3 Locale.ROOT

Use `Locale.ROOT` for machine-readable identifiers:

- enum-like strings;
- HTTP header normalization;
- case-insensitive map keys;
- usernames if policy says locale-neutral;
- protocol keywords.

---

# 16. Turkish `I` Problem

Turkish has special casing:

```text
I  -> ı
İ  -> i
```

In English-like locale:

```text
I -> i
```

## 16.1 Example

```java
String s = "TITLE";

System.out.println(s.toLowerCase(Locale.ENGLISH)); // title
System.out.println(s.toLowerCase(Locale.forLanguageTag("tr"))); // tıtle
```

The `I` becomes dotless `ı`.

## 16.2 Production bug

If code does:

```java
String normalized = headerName.toLowerCase();
```

and server default locale is Turkish, protocol matching may break.

## 16.3 Fix

Use:

```java
toLowerCase(Locale.ROOT)
toUpperCase(Locale.ROOT)
```

for locale-insensitive protocol/domain keys.

## 16.4 User-facing text

For user display, use the user's locale.

Don't use `Locale.ROOT` for natural-language presentation if user expects local casing.

---

# 17. Case Folding vs Lowercase

Case folding is a Unicode concept for caseless matching.

Lowercasing is locale-sensitive transformation.

Java standard library primarily provides case conversion, not full Unicode case folding API as a single high-level method.

## 17.1 Caseless matching

For simple locale-neutral matching:

```java
a.equalsIgnoreCase(b)
```

or normalize with `Locale.ROOT` depending requirements.

But `equalsIgnoreCase` is not full normalization/collation/security solution.

## 17.2 Identifier matching

A secure identifier matching pipeline may need:

```text
normalize
case fold/lowercase Locale.ROOT
confusable checks
allowed character policy
unique constraint on canonical key
```

## 17.3 Search

Search should often use search engine analyzers/collation rather than simple lowercase.

---

# 18. Collation dan Sorting Natural Language

Sorting text by Unicode code point is not same as natural language sorting.

## 18.1 Bad natural sorting

```java
Collections.sort(names);
```

This uses lexicographic Unicode order based on `String.compareTo`.

It may not match user language expectations.

## 18.2 Use Collator

```java
Collator collator = Collator.getInstance(locale);
names.sort(collator);
```

`Collator` performs locale-sensitive string comparison.

## 18.3 Strength

Collator has strength levels:

- PRIMARY;
- SECONDARY;
- TERTIARY;
- IDENTICAL.

These affect whether accents/case matter.

Example:

```java
Collator collator = Collator.getInstance(Locale.ENGLISH);
collator.setStrength(Collator.PRIMARY);
```

## 18.4 Database collation

App sorting and DB sorting may differ.

If API pagination depends on sorting, define sorting at DB layer or ensure consistency.

## 18.5 Search vs sort

Searching, sorting, uniqueness, and display may need different rules.

Don't use one naive lowercase comparison for all.

---

# 19. Validation: Username, Name, Code, Identifier

Different text fields need different validation.

## 19.1 Human name

Human names are diverse.

Bad:

```java
name.matches("[A-Za-z ]+")
```

This rejects many valid names.

For legal/display names, prefer:

- length limit;
- control character rejection;
- normalization policy;
- possibly script policy if business requires;
- avoid overly narrow Latin-only rules unless domain truly requires.

## 19.2 Username

Username is security-sensitive.

Define:

- allowed characters;
- normalization form;
- case sensitivity;
- uniqueness key;
- confusable policy;
- min/max length;
- reserved names;
- display vs login name.

Example strict username:

```java
public record Username(String value) {
    private static final Pattern ALLOWED =
        Pattern.compile("[a-z0-9_]{3,32}");

    public Username {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value, Normalizer.Form.NFKC)
            .toLowerCase(Locale.ROOT);

        if (!ALLOWED.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid username");
        }
    }
}
```

This is intentionally restrictive. It may be right for login identifiers, not for human names.

## 19.3 Code/identifier

For machine codes:

```text
CASE-2026-000001
POLICY_V1
SGD
```

Restrict strongly:

```java
Pattern.compile("[A-Z0-9_-]{1,64}")
```

Use `Locale.ROOT` for uppercase/lowercase.

## 19.4 Free text

For comments/descriptions:

- allow Unicode;
- reject control characters if needed;
- limit length by code points/bytes;
- sanitize output depending context;
- avoid HTML injection;
- preserve original.

## 19.5 Email

Email validation is complex. Avoid naive regex. For many systems:

- parse/validate with a dedicated library or conservative application policy;
- normalize domain part carefully;
- do not over-normalize local part unless policy says so;
- handle internationalized domain names if supported.

---

# 20. Security: Homoglyph, Confusable, Normalization Attack

Unicode enables characters that look alike.

Example:

```text
Latin A: A
Cyrillic А: А
```

They may look identical but are different code points.

## 20.1 Homoglyph attack

An attacker can create username:

```text
раypal
```

using Cyrillic letters that look like Latin.

## 20.2 Confusable identifiers

For security-sensitive identifiers:

- restrict script;
- detect mixed scripts;
- use confusable detection;
- normalize;
- reserve protected names;
- manual review for high-risk names.

Java standard library does not provide complete confusable detection. Use specialized libraries/policies if needed.

## 20.3 Normalization bypass

If validation checks one form but storage/search uses another, attacker may bypass uniqueness or filters.

Pipeline should be consistent:

```text
input
  → decode
  → validate well-formedness
  → normalize
  → validate allowed chars
  → canonical key
  → unique constraint
```

## 20.4 Control characters

Reject or escape:

- null char;
- bidi control characters where risky;
- line separators in logs/CSV;
- terminal escape codes;
- invisible characters if not allowed.

## 20.5 Log injection

User text containing newline can forge logs.

Use structured logging and escape values.

---

# 21. Text Boundary: API, JSON, Database, Kafka, CSV, Logs

## 21.1 JSON

JSON strings are Unicode text. Ensure:

- UTF-8 encoding at HTTP boundary;
- proper escaping;
- length validation;
- no invalid surrogate issues;
- consistent normalization if needed.

## 21.2 Database

Database stores text with encoding/collation rules.

Important:

- column type;
- max length semantics;
- collation;
- case sensitivity;
- normalization not always automatic;
- index length;
- unique constraints under collation.

## 21.3 Kafka/events

Text fields in events need schema:

- max length;
- normalization policy;
- allowed characters;
- PII classification;
- compatibility rules.

## 21.4 CSV

CSV text has pitfalls:

- delimiter;
- quotes;
- newline inside field;
- encoding;
- Excel formula injection;
- leading zeros in IDs;
- Unicode BOM expectations.

For CSV exports, protect formula injection:

```text
=cmd|...
+SUM(...)
@...
```

depending consumer.

## 21.5 Logs

Never log raw sensitive text.

For text values:

- mask PII;
- escape control chars;
- include stable IDs instead of full content if possible;
- avoid log injection.

---

# 22. Database Collation dan Case Sensitivity

## 22.1 Collation affects equality and sorting

Database collation can make:

```text
'A' = 'a'
'é' = 'e'
```

or not, depending configuration.

## 22.2 Unique constraint surprise

If username column collation is case-insensitive:

```text
Fajar
fajar
```

may be considered duplicate.

If case-sensitive, they may both exist.

Decide explicitly.

## 22.3 App vs DB mismatch

App normalizes:

```java
username.toLowerCase(Locale.ROOT)
```

DB collation might do different comparison.

Best for identifiers:

- store canonical key;
- unique constraint on canonical key;
- use explicit app normalization;
- avoid relying on unspecified DB collation.

## 22.4 Sorting pagination

If API returns sorted names with pagination, sorting must be stable and consistent.

Use DB collation or application Collator, but avoid mixing across pages.

## 22.5 Migration risk

Changing DB collation can:

- change uniqueness;
- change sorting;
- invalidate indexes;
- change query plans;
- break pagination;
- reveal duplicates.

---

# 23. Length Limit: Code Unit vs Code Point vs Byte vs Grapheme

When product says:

```text
max length 50
```

Ask:

```text
50 what?
```

## 23.1 Java code units

```java
s.length()
```

Counts UTF-16 code units.

## 23.2 Code points

```java
s.codePointCount(0, s.length())
```

Counts Unicode code points.

## 23.3 Bytes

```java
s.getBytes(StandardCharsets.UTF_8).length
```

Counts UTF-8 bytes.

## 23.4 Grapheme clusters

Use BreakIterator/library.

## 23.5 Different answers

For `"😄"`:

```text
UTF-16 code units: 2
code points: 1
UTF-8 bytes: 4
grapheme clusters: 1
```

For `"e\u0301"`:

```text
UTF-16 code units: 2
code points: 2
UTF-8 bytes: 3
grapheme clusters: 1
```

## 23.6 Practical policy

| Use case | Limit by |
|---|---|
| DB byte limit | bytes |
| Java substring safety | code point/code unit carefully |
| user-facing characters | grapheme clusters |
| protocol field max bytes | bytes |
| simple machine code | regex chars/code units if ASCII-only |
| SMS/message billing | domain-specific encoding rules |

## 23.7 Do not truncate blindly

Blind truncation can split surrogate pair or combining sequence.

At minimum truncate by code point. For UI, grapheme-aware.

---

# 24. Encoding Boundary: UTF-8, UTF-16, Charset

Inside Java, `String` is UTF-16-like sequence of char values.

At I/O boundary, text becomes bytes using a charset.

## 24.1 Always specify charset

Bad:

```java
new String(bytes)
text.getBytes()
Files.readString(path) // default charset behavior depends API/JDK specifics
```

Good:

```java
new String(bytes, StandardCharsets.UTF_8)
text.getBytes(StandardCharsets.UTF_8)
Files.readString(path, StandardCharsets.UTF_8)
```

## 24.2 Default charset

Modern JDKs use UTF-8 as default charset by default since JDK 18, but explicit charset remains best for contracts and clarity.

## 24.3 UTF-8 for external boundary

Use UTF-8 for:

- HTTP JSON;
- files;
- Kafka text payloads;
- logs;
- CSV unless consumer requires otherwise.

## 24.4 Encoding errors

Decoding invalid bytes can:

- replace invalid sequences;
- throw exception;
- silently corrupt depending decoder.

For strict processing, configure decoder:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT);
```

## 24.5 Byte length validation

If external protocol max is 255 bytes:

```java
int bytes = text.getBytes(StandardCharsets.UTF_8).length;
if (bytes > 255) reject;
```

Do not use `text.length()`.

---

# 25. Domain-Specific Text Types

## 25.1 Why text needs type

Raw `String` is too general.

```java
String id;
String name;
String reason;
String email;
String code;
String description;
```

Each has different rules.

Use domain types:

```java
record CaseNumber(String value) {}
record OfficerName(String value) {}
record RejectionReason(String value) {}
record EmailAddress(String value) {}
record PolicyCode(String value) {}
```

## 25.2 Example: PolicyCode

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

## 25.3 Example: RejectionReason

```java
public record RejectionReason(String value) {
    public RejectionReason {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value.strip(), Normalizer.Form.NFC);
        int codePoints = value.codePointCount(0, value.length());

        if (codePoints < 10) {
            throw new IllegalArgumentException("Reason too short");
        }
        if (codePoints > 2000) {
            throw new IllegalArgumentException("Reason too long");
        }
    }
}
```

## 25.4 Example: Username

Strict identifier:

```java
public record Username(String value) {
    private static final Pattern USERNAME = Pattern.compile("[a-z0-9_]{3,32}");

    public Username {
        Objects.requireNonNull(value);
        value = Normalizer.normalize(value, Normalizer.Form.NFKC)
            .strip()
            .toLowerCase(Locale.ROOT);

        if (!USERNAME.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid username");
        }
    }
}
```

## 25.5 Preserve original vs canonical

For display names:

```java
record DisplayName(String original, String normalizedSearchKey) {}
```

Do not destroy user’s intended spelling unless domain says so.

---

# 26. `String` Immutability, Interning, dan Memory Note

This part focuses type/text, not full String internals, but some notes matter.

## 26.1 String is immutable

Operations create new strings:

```java
String s = "hello";
String upper = s.toUpperCase(Locale.ROOT);
```

`s` unchanged.

## 26.2 String concatenation

Compiler/runtime optimizes concatenation in many cases, but in loops use `StringBuilder`.

```java
StringBuilder sb = new StringBuilder();
for (...) {
    sb.append(...);
}
```

## 26.3 String interning

String literals are interned.

```java
String a = "hello";
String b = "hello";
System.out.println(a == b); // true for literals
```

Do not use `==` for string content comparison.

Use:

```java
a.equals(b)
```

## 26.4 Compact strings

Modern JDKs can store strings internally more compactly when content is Latin-1 compatible. This is implementation detail, not API contract.

Do not write logic depending on internal representation.

## 26.5 Sensitive data

String immutable means sensitive content can remain in memory until GC.

For passwords/keys, prefer specialized security APIs and avoid storing secrets in `String` when lifecycle control matters. But `char[]` is not magic if copied/logged elsewhere.

---

# 27. Production Failure Modes

## 27.1 Emoji breaks length limit

System allows max 10 characters using `length()`. Emoji counts as 2, user sees unexpected rejection.

Fix:

- define length semantics;
- use code point/grapheme count as needed.

## 27.2 Truncation corrupts surrogate pair

```java
text.substring(0, max)
```

splits surrogate. Downstream encoder/search fails or displays replacement char.

Fix:

- truncate by code point/grapheme;
- validate well-formed UTF-16.

## 27.3 Turkish locale breaks key normalization

```java
key.toLowerCase()
```

on Turkish default locale breaks `"ID"` to `"ıd"`.

Fix:

```java
key.toLowerCase(Locale.ROOT)
```

## 27.4 Duplicate username via normalization

```text
é
e + combining acute
```

stored as different strings.

Fix:

- normalize canonical key;
- unique constraint on canonical key.

## 27.5 Homoglyph impersonation

Attacker uses visually similar script.

Fix:

- restrict identifier scripts;
- confusable detection;
- manual review for high-value names.

## 27.6 Database collation mismatch

App treats usernames case-insensitive, DB unique constraint case-sensitive. Duplicates created.

Fix:

- canonical column;
- explicit collation;
- unique canonical key.

## 27.7 Byte limit exceeded

Java `length()` underestimates UTF-8 byte length. External system rejects message.

Fix:

```java
text.getBytes(StandardCharsets.UTF_8).length
```

## 27.8 Log injection

User input contains newline and fake log prefix.

Fix:

- structured logging;
- escaping;
- control char rejection/masking.

## 27.9 CSV formula injection

Exported name starts with `=`; spreadsheet executes formula.

Fix:

- CSV escaping/sanitization policy for spreadsheet targets.

## 27.10 Case mapping changes length

Uppercasing/lowercasing changes length and breaks fixed-width assumption.

Fix:

- don't assume length preserved;
- validate after transformation.

---

# 28. Best Practices

## 28.1 General

- Treat `char` as UTF-16 code unit, not user character.
- Use code point APIs for Unicode character processing.
- Use grapheme-aware logic for user-visible character count/truncation.
- Always specify `Locale.ROOT` for machine key case normalization.
- Use user locale for user-facing case/formatting.
- Normalize text where canonical equality matters.
- Preserve original text where legal/display fidelity matters.
- Specify charset at I/O boundary.
- Validate byte length when protocol/storage limit is bytes.
- Avoid naive `[A-Za-z]` for human names.
- Restrict machine identifiers strongly.
- Consider security confusables for usernames/brands/admin identifiers.
- Do not expose raw sensitive text in logs.

## 28.2 For identifiers

- Normalize with chosen form.
- Case-normalize with `Locale.ROOT` if case-insensitive.
- Restrict allowed characters.
- Store canonical key.
- Enforce unique constraint on canonical key.
- Consider confusable/mixed-script policy.

## 28.3 For display names

- Preserve original.
- Limit length safely.
- Reject dangerous control chars.
- Normalize search key separately.
- Avoid over-restricting scripts.

## 28.4 For free text

- Accept Unicode.
- Limit length by clear unit.
- Sanitize at output context.
- Avoid logging raw content.
- Store encoding consistently.

## 28.5 For codes

- Use strict ASCII if domain allows:

```text
[A-Z0-9_-]
```

- Normalize case with `Locale.ROOT`.
- Use value object.

---

# 29. Decision Matrix

| Use case | Recommended type/policy |
|---|---|
| ASCII delimiter parsing | `char` ok |
| Binary protocol byte text | byte/charset explicit |
| User-visible name | `String` + validation + preserve original |
| Username/login | normalized canonical `String` + strict policy |
| Machine code | domain type + ASCII regex |
| Free text comment | `String` + length/control char policy |
| Emoji-capable message | `String` + code point/grapheme-aware limits |
| Case-insensitive key | normalize with `Locale.ROOT` |
| Natural-language sort | `Collator` |
| Database unique username | canonical column + unique constraint |
| JSON API text | UTF-8 + schema + validation |
| Security-sensitive identifier | normalization + confusable/mixed-script policy |
| Password/secret | avoid String if lifecycle control needed |

---

# 30. Latihan

## Latihan 1 — Emoji length

Run:

```java
String s = "😄";
System.out.println(s.length());
System.out.println(s.codePointCount(0, s.length()));
System.out.println(s.charAt(0));
System.out.println(s.charAt(1));
```

Explain.

## Latihan 2 — Surrogate validation

Implement `isWellFormedUtf16(String s)`.

Test:

```java
"😄"
"\uD83D"
"\uDE04"
```

## Latihan 3 — Code point iteration

Write a method that prints each code point in hex.

## Latihan 4 — Truncate by code points

Implement:

```java
String truncateCodePoints(String s, int maxCodePoints)
```

Ensure it doesn't split surrogate pair.

## Latihan 5 — Normalization equality

Compare:

```java
String a = "\u00E9";
String b = "e\u0301";
```

Then normalize both to NFC and compare.

## Latihan 6 — Turkish locale

Run:

```java
String s = "TITLE";
System.out.println(s.toLowerCase(Locale.ENGLISH));
System.out.println(s.toLowerCase(Locale.forLanguageTag("tr")));
System.out.println(s.toLowerCase(Locale.ROOT));
```

Explain.

## Latihan 7 — Username value object

Implement `Username`:

- normalize NFKC;
- lowercase Locale.ROOT;
- allowed `[a-z0-9_]{3,32}`;
- reject invalid.

## Latihan 8 — Byte length

Calculate UTF-8 byte length for:

```java
"hello"
"é"
"😄"
"👨‍👩‍👧‍👦"
```

## Latihan 9 — Collator

Sort names with:

```java
String.compareTo
Collator.getInstance(Locale.forLanguageTag("id-ID"))
```

Compare behavior.

## Latihan 10 — Log injection

Create string with newline and fake log prefix. Show why structured logging/escaping matters.

---

# 31. Ringkasan

Text data di Java membutuhkan mental model berlapis:

```text
char            = UTF-16 code unit
code point      = Unicode scalar-ish value represented as int
grapheme cluster= user-perceived character
glyph           = rendered shape
bytes           = encoded representation at boundary
```

Hal terpenting:

- `char` bukan karakter manusia.
- `String.length()` menghitung UTF-16 code units.
- Supplementary characters memakai surrogate pairs.
- Code point count masih bukan grapheme count.
- Normalization penting untuk canonical equality.
- Locale penting untuk case conversion.
- `Locale.ROOT` penting untuk machine keys.
- `Collator` penting untuk natural-language sorting.
- Identifier security perlu policy terhadap confusable/mixed scripts.
- Length limit harus menyebut unit: code unit, code point, byte, atau grapheme.
- Boundary I/O harus punya charset explicit.
- Domain-specific text types membuat validation dan semantics lebih aman.

Engineer senior tidak menulis:

```java
if (name.length() <= 50)
```

tanpa bertanya:

```text
50 apa?
code units?
code points?
graphemes?
bytes?
database column characters?
display width?
```

Itulah level ketelitian yang dibutuhkan untuk production-grade text handling.

---

# 32. Referensi

1. Java SE 25 API — `String`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html

2. Java SE 25 API — `Character`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html

3. Java SE 25 API — `Normalizer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Normalizer.html

4. Java SE 25 API — `Collator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/Collator.html

5. Java SE 25 API — `BreakIterator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/BreakIterator.html

6. Java SE 25 API — `Locale`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html

7. Java SE 25 API — `Charset`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/Charset.html

8. Java Language Specification SE 25 — Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

9. Unicode Standard  
   https://www.unicode.org/standard/standard.html

10. Unicode Technical Report #15 — Unicode Normalization Forms  
    https://unicode.org/reports/tr15/

11. Unicode Technical Standard #39 — Unicode Security Mechanisms  
    https://unicode.org/reports/tr39/

12. Unicode Standard Annex #29 — Unicode Text Segmentation  
    https://unicode.org/reports/tr29/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-004.md">⬅️ Java Data Types — Part 004</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-006.md">Java Data Types — Part 006 ➡️</a>
</div>
