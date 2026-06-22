# learn-java-dsa-part-015.md

# Part 015 — String Algorithms I: String Cost Model, Search, Parsing

> Seri: **Java Data Structure and Algorithm**  
> Posisi: **Part 015 dari 030**  
> Fokus: memahami `String` sebagai struktur data sequence, bukan sekadar tipe teks; memahami cost model, search, parsing, dan algorithmic thinking untuk text-processing di Java.

---

## 0. Tujuan Bagian Ini

Pada banyak sistem bisnis, string terlihat seperti hal kecil: nama, kode, nomor dokumen, email, path, query parameter, template, search keyword, payload log, rule expression, atau reference number. Tetapi dari sisi Data Structure and Algorithm, string adalah salah satu struktur data paling sering disentuh, paling mudah disalahgunakan, dan paling sering menjadi sumber bug tersembunyi.

Bagian ini tidak mengulang seri data type tentang Unicode, encoding, charset, atau representasi karakter. Kita hanya mengambil bagian yang langsung berdampak pada algoritma string di Java.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca `String` sebagai sequence dengan cost model yang jelas.
2. Menjelaskan kenapa operasi string tertentu terlihat sederhana tetapi bisa mahal.
3. Membedakan operasi berdasarkan `char`, code point, substring, regex, dan parser berbasis cursor.
4. Mendesain pencarian string sederhana dengan benar.
5. Memahami mental model KMP dan Rabin-Karp tanpa sekadar menghafal template.
6. Membuat parser kecil yang deterministic dan tidak rapuh.
7. Menentukan kapan cukup pakai API bawaan Java, kapan perlu algoritma manual, dan kapan perlu parser/lexer formal.
8. Menghindari failure mode umum: accidental quadratic concatenation, regex overuse, Unicode boundary bug, parsing ambigu, dan memory pressure.

---

## 1. String Sebagai Struktur Data

Secara mental, string adalah **sequence of textual units**. Masalahnya: unit apa?

Dalam Java, `String` menyediakan akses berbasis `char` melalui method seperti `charAt(int)`. Namun `char` adalah 16-bit code unit, bukan selalu satu karakter manusia. Java `CharSequence` mendeskripsikan dirinya sebagai readable sequence of `char` values, dan dokumentasi Java mengingatkan bahwa `char` dapat merepresentasikan karakter BMP atau surrogate. Jadi, dari sudut algoritma, `String` bukan selalu “array of human characters”.

Untuk banyak domain backend seperti kode status, kode pos numerik, UUID, nomor referensi, keyword ASCII, slug, ID, dan protocol token, pendekatan berbasis `char` sering cukup aman. Tetapi untuk nama orang, alamat, teks bebas, emoji, bahasa non-Latin, atau input publik, asumsi satu `char` = satu karakter bisa salah.

### 1.1 Mental Model Minimum

```text
String
  ├─ logical text seen by user
  ├─ sequence of UTF-16 code units exposed through charAt
  ├─ sequence of Unicode code points exposed through codePointAt/codePoints
  └─ internal storage optimized by JVM implementation
```

Yang penting:

- **API indexing Java `String` mayoritas berbasis `char` index.**
- **`length()` mengembalikan jumlah `char`, bukan jumlah karakter visual manusia.**
- **Beberapa karakter Unicode di luar BMP membutuhkan dua `char` atau surrogate pair.**
- **Grapheme cluster bisa lebih kompleks lagi**, misalnya emoji + modifier atau huruf + combining mark.

Untuk DSA, ini berarti:

- Jika problem domain terbatas ASCII, algoritma berbasis `char` bisa sederhana dan cepat.
- Jika problem domain full Unicode, algoritma harus jelas: apakah memproses code unit, code point, atau grapheme cluster.
- Jika problem berkaitan dengan tampilan ke user, jangan mengandalkan `length()` sebagai jumlah karakter yang terlihat.

---

## 2. Java `String` Cost Model

Java `String` bersifat immutable. Setiap operasi yang “mengubah” string sebenarnya membuat string baru atau objek bantu baru.

Dokumentasi Java mendeskripsikan `String` sebagai class untuk memeriksa karakter sequence, membandingkan string, mencari string, mengekstrak substring, dan membuat copy dengan transformasi case. Artinya `String` adalah API kaya operasi, tetapi bukan mutable buffer.

### 2.1 Immutability

Immutability memberi banyak manfaat:

1. Aman dipakai sebagai key `HashMap`.
2. Aman dibagikan antar thread tanpa sinkronisasi untuk state internalnya.
3. Bisa cache hash code.
4. Aman untuk string literal pool.
5. Membuat API lebih predictable.

Tetapi dari sisi algoritma:

1. Concatenation berulang bisa menghasilkan banyak object sementara.
2. Transformasi bertahap bisa mahal jika tiap langkah membuat string baru.
3. Substring/copy perlu diperhitungkan pada input besar.
4. Parsing dengan banyak `substring()` bisa menciptakan allocation pressure.

### 2.2 Compact Strings

Sejak JDK 9, JEP 254 memperkenalkan Compact Strings. Representasi internal `String` berubah dari `char[]` ke `byte[]` plus encoding flag, sehingga string yang hanya butuh Latin-1 bisa memakai satu byte per karakter, sedangkan string lain memakai UTF-16. Detail ini adalah implementasi internal, bukan contract API, tetapi penting untuk cost model modern.

Implikasi engineering:

- Jangan mengasumsikan internal `String` adalah `char[]`.
- Jangan mengoptimasi berdasarkan detail internal yang bukan API contract.
- String Latin-1-heavy bisa lebih hemat memory dibanding asumsi lama “2 byte per char”.
- Operasi algorithmic tetap perlu dihitung dari panjang input dan allocation behavior.

### 2.3 `length()`, `isEmpty()`, `charAt()`

Untuk kebanyakan implementasi, operasi ini murah:

```java
String s = "ACEAS-2026-000001";
int n = s.length();       // jumlah char/code unit
boolean empty = s.isEmpty();
char c = s.charAt(0);     // akses char index
```

Tetapi ada jebakan:

```java
String emoji = "😀";
System.out.println(emoji.length()); // 2, bukan 1
```

Dari sisi DSA, selalu tentukan unit:

```text
Problem: validate 6 digit postal code
Unit: char, ASCII digit
Safe: yes

Problem: truncate display name to 20 visible characters
Unit: grapheme cluster / user-perceived character
Safe with charAt: no

Problem: scan protocol token separated by ':'
Unit: char delimiter
Safe: usually yes
```

---

## 3. Complexity Operasi Umum pada String

| Operasi | Typical Cost | Catatan |
|---|---:|---|
| `length()` | O(1) | jumlah `char`, bukan grapheme |
| `charAt(i)` | O(1) | index berbasis `char` |
| `equals` | O(n) worst-case | sering cepat jika reference sama atau length beda |
| `hashCode` | O(n) pertama kali | cached setelah dihitung pada `String` |
| `substring` | O(k) pada Java modern | membuat string baru untuk range panjang k |
| `indexOf` | O(n*m) worst theoretical untuk naive mental model | implementasi JDK bisa punya optimasi internal |
| concatenation kecil | bisa optimized | compiler/JVM dapat memakai builder/invokedynamic |
| concatenation dalam loop | berpotensi O(n²) | gunakan `StringBuilder` |
| regex match | tergantung pattern | bisa sangat mahal bila pattern buruk |
| split regex | bisa mahal | `String.split` memakai regex |

### 3.1 Kesalahan Paling Umum: Concatenation dalam Loop

Buruk:

```java
String result = "";
for (String item : items) {
    result += item + ",";
}
```

Secara mental, tiap iterasi membuat string baru yang menyalin isi lama + tambahan baru. Jika total output panjangnya `N`, operasi bisa mendekati:

```text
copy 1 + copy 2 + copy 3 + ... + copy N = O(N²)
```

Gunakan:

```java
StringBuilder builder = new StringBuilder();
for (String item : items) {
    builder.append(item).append(',');
}
String result = builder.toString();
```

Atau untuk join sederhana:

```java
String result = String.join(",", items);
```

### 3.2 Pre-sizing `StringBuilder`

`StringBuilder` adalah mutable sequence of characters. Dokumentasi Java menyebut operasi utamanya adalah `append` dan `insert`, dan class ini dirancang untuk penggunaan single-thread tanpa sinkronisasi seperti `StringBuffer`.

Jika ukuran output bisa diperkirakan, beri kapasitas awal:

```java
int estimatedSize = items.size() * 16;
StringBuilder builder = new StringBuilder(estimatedSize);

for (String item : items) {
    builder.append(item).append('\n');
}

return builder.toString();
```

Kenapa penting?

- Tanpa capacity cukup, internal buffer perlu grow.
- Grow berarti allocate buffer baru dan copy isi lama.
- Growth tetap amortized baik, tetapi untuk output besar bisa membuat allocation spike.

---

## 4. `String`, `StringBuilder`, `StringBuffer`, `CharSequence`

### 4.1 `String`

Gunakan `String` untuk immutable value, key map, external API boundary, domain identifier, stable text, dan output final.

```java
public record CaseReference(String value) {
    public CaseReference {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case reference must not be blank");
        }
    }
}
```

### 4.2 `StringBuilder`

Gunakan `StringBuilder` untuk membangun string bertahap, parser output, serializer sederhana, report generation kecil-menengah, dan template rendering manual.

```java
public static String renderCsvLine(List<String> values) {
    StringBuilder out = new StringBuilder(values.size() * 12);

    for (int i = 0; i < values.size(); i++) {
        if (i > 0) {
            out.append(',');
        }
        appendCsvEscaped(out, values.get(i));
    }

    return out.toString();
}
```

### 4.3 `StringBuffer`

`StringBuffer` synchronized. Dalam code modern, default-nya bukan ini, kecuali benar-benar perlu mutable character buffer yang disinkronisasi.

Untuk concurrency, sering lebih baik desainnya diubah:

- masing-masing thread punya local `StringBuilder`, lalu merge,
- gunakan immutable output,
- gunakan queue/event aggregation,
- jangan berbagi mutable builder global.

### 4.4 `CharSequence`

`CharSequence` adalah interface untuk readable sequence of `char` values. Implementasinya bisa `String`, `StringBuilder`, `StringBuffer`, `CharBuffer`, dan lainnya.

Gunakan `CharSequence` untuk API yang hanya perlu membaca sequence:

```java
public static boolean startsWithAsciiLetter(CharSequence s) {
    if (s == null || s.isEmpty()) {
        return false;
    }
    char c = s.charAt(0);
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}
```

Namun hati-hati:

- `CharSequence` bisa mutable.
- Jangan simpan reference `CharSequence` bila membutuhkan value immutable.
- Jika perlu stability, copy ke `String`.

```java
this.value = input.toString();
```

---

## 5. Search Dasar pada String

Search string berarti mencari pattern `p` di text `t`.

```text
text    = "ABC ABCDAB ABCDABCDABDE"
pattern = "ABCDABD"
```

Pertanyaan umum:

1. Apakah pattern muncul?
2. Di index berapa muncul pertama kali?
3. Muncul berapa kali?
4. Muncul di semua index mana?
5. Apakah match boleh overlap?
6. Apakah case-sensitive?
7. Apakah Unicode normalization-sensitive?
8. Apakah pattern literal atau regex?

Sebelum memilih algoritma, tentukan constraint:

```text
n = panjang text
m = panjang pattern
k = jumlah pattern
alphabet = ASCII? Unicode? digits only?
query frequency = sekali? banyak kali?
input source = trusted? untrusted?
```

### 5.1 Naive Search

Naive search mencoba pattern di setiap posisi.

```java
public static int indexOfNaive(String text, String pattern) {
    if (text == null || pattern == null) {
        throw new IllegalArgumentException("text and pattern must not be null");
    }

    int n = text.length();
    int m = pattern.length();

    if (m == 0) {
        return 0;
    }
    if (m > n) {
        return -1;
    }

    for (int i = 0; i <= n - m; i++) {
        int j = 0;
        while (j < m && text.charAt(i + j) == pattern.charAt(j)) {
            j++;
        }
        if (j == m) {
            return i;
        }
    }

    return -1;
}
```

Worst-case: `O(n*m)`.

Contoh buruk:

```text
text    = "aaaaaaaaaaaaaaaaab"
pattern = "aaaaab"
```

Pattern hampir cocok di banyak posisi, lalu gagal di akhir.

Tetapi naive search tetap layak jika input kecil, pattern pendek, bukan hot path, kode harus sederhana, atau Java built-in `indexOf` sudah cukup.

### 5.2 Semua Occurrence

```java
public static List<Integer> allOccurrencesNaive(String text, String pattern, boolean allowOverlap) {
    if (text == null || pattern == null) {
        throw new IllegalArgumentException("text and pattern must not be null");
    }

    int n = text.length();
    int m = pattern.length();
    List<Integer> result = new ArrayList<>();

    if (m == 0) {
        for (int i = 0; i <= n; i++) {
            result.add(i);
        }
        return result;
    }

    int i = 0;
    while (i <= n - m) {
        int j = 0;
        while (j < m && text.charAt(i + j) == pattern.charAt(j)) {
            j++;
        }
        if (j == m) {
            result.add(i);
            i += allowOverlap ? 1 : m;
        } else {
            i++;
        }
    }

    return result;
}
```

Contoh overlap:

```text
text = "aaaa"
pattern = "aa"

allowOverlap = true  => [0, 1, 2]
allowOverlap = false => [0, 2]
```

Ini detail kecil, tetapi penting pada parsing token, keyword detection, dan template placeholder scanning.

---

## 6. KMP: Knuth-Morris-Pratt Mental Model

KMP menyelesaikan masalah naive search: ketika sebagian pattern sudah cocok lalu gagal, jangan mundur ke awal tanpa informasi. Gunakan informasi dari pattern sendiri.

Intuisi:

```text
pattern = "ABABAC"

Saat kita sudah cocok "ABABA" lalu gagal di C,
sebagian prefix pattern juga merupakan suffix dari bagian yang sudah cocok.
Jadi kita bisa geser pattern ke posisi yang masih mungkin cocok,
tanpa memeriksa ulang karakter text yang sudah diketahui.
```

### 6.1 Prefix Function / LPS

LPS = Longest Proper Prefix which is also Suffix.

Untuk setiap posisi `i`, `lps[i]` menyimpan panjang prefix terpanjang dari `pattern[0..i]` yang juga suffix dari substring itu.

```text
pattern: A B A B A C
index:   0 1 2 3 4 5
lps:     0 0 1 2 3 0
```

### 6.2 Build LPS

```java
public static int[] buildLps(String pattern) {
    if (pattern == null) {
        throw new IllegalArgumentException("pattern must not be null");
    }

    int m = pattern.length();
    int[] lps = new int[m];

    int len = 0;
    int i = 1;

    while (i < m) {
        if (pattern.charAt(i) == pattern.charAt(len)) {
            len++;
            lps[i] = len;
            i++;
        } else if (len > 0) {
            len = lps[len - 1];
        } else {
            lps[i] = 0;
            i++;
        }
    }

    return lps;
}
```

Invariant penting:

```text
len = panjang candidate prefix yang juga suffix untuk pattern[0..i-1]
```

Ketika match, candidate memanjang. Ketika mismatch, `len = lps[len - 1]`, artinya coba candidate prefix lebih pendek yang masih valid.

### 6.3 KMP Search

```java
public static int indexOfKmp(String text, String pattern) {
    if (text == null || pattern == null) {
        throw new IllegalArgumentException("text and pattern must not be null");
    }

    int n = text.length();
    int m = pattern.length();

    if (m == 0) {
        return 0;
    }
    if (m > n) {
        return -1;
    }

    int[] lps = buildLps(pattern);

    int i = 0; // text index
    int j = 0; // pattern index

    while (i < n) {
        if (text.charAt(i) == pattern.charAt(j)) {
            i++;
            j++;

            if (j == m) {
                return i - m;
            }
        } else if (j > 0) {
            j = lps[j - 1];
        } else {
            i++;
        }
    }

    return -1;
}
```

Complexity:

```text
Build LPS: O(m)
Search:    O(n)
Total:     O(n + m)
Memory:    O(m)
```

### 6.4 Semua Occurrence dengan KMP

```java
public static List<Integer> allOccurrencesKmp(String text, String pattern) {
    if (text == null || pattern == null) {
        throw new IllegalArgumentException("text and pattern must not be null");
    }

    int n = text.length();
    int m = pattern.length();
    List<Integer> matches = new ArrayList<>();

    if (m == 0) {
        for (int i = 0; i <= n; i++) {
            matches.add(i);
        }
        return matches;
    }

    int[] lps = buildLps(pattern);
    int i = 0;
    int j = 0;

    while (i < n) {
        if (text.charAt(i) == pattern.charAt(j)) {
            i++;
            j++;

            if (j == m) {
                matches.add(i - m);
                j = lps[j - 1]; // allow overlap
            }
        } else if (j > 0) {
            j = lps[j - 1];
        } else {
            i++;
        }
    }

    return matches;
}
```

### 6.5 Kapan KMP Layak?

KMP layak ketika text besar, pattern cukup panjang, worst-case predictable penting, search dilakukan dalam engine/validator hot path, pattern literal, bukan regex, atau kamu tidak ingin bergantung pada behavior internal `String.indexOf`.

KMP sering tidak perlu ketika input kecil, cukup pakai `String.indexOf`, readability lebih penting, problem bukan hot path, atau pattern banyak sekaligus. Untuk banyak pattern, Aho-Corasick lebih relevan dan akan dibahas di Part 016.

---

## 7. Rabin-Karp Mental Model

Rabin-Karp memakai rolling hash untuk membandingkan window text dengan pattern.

```text
Daripada membandingkan semua karakter window setiap kali,
hitung hash window.
Jika hash window != hash pattern, pasti tidak match.
Jika hash sama, baru verifikasi karakter untuk menghindari collision.
```

### 7.1 Rolling Hash

Untuk string `abcd`, hash polynomial bisa dipikirkan seperti:

```text
hash("abcd") = a*B^3 + b*B^2 + c*B + d
```

Saat window geser dari `abcd` ke `bcde`:

```text
remove a contribution
multiply/shift
add e
```

### 7.2 Implementasi Sederhana

```java
public static List<Integer> rabinKarp(String text, String pattern) {
    if (text == null || pattern == null) {
        throw new IllegalArgumentException("text and pattern must not be null");
    }

    int n = text.length();
    int m = pattern.length();
    List<Integer> matches = new ArrayList<>();

    if (m == 0) {
        for (int i = 0; i <= n; i++) {
            matches.add(i);
        }
        return matches;
    }
    if (m > n) {
        return matches;
    }

    final long base = 256;
    final long mod = 1_000_000_007L;

    long highestPower = 1;
    for (int i = 1; i < m; i++) {
        highestPower = (highestPower * base) % mod;
    }

    long patternHash = 0;
    long windowHash = 0;

    for (int i = 0; i < m; i++) {
        patternHash = (patternHash * base + pattern.charAt(i)) % mod;
        windowHash = (windowHash * base + text.charAt(i)) % mod;
    }

    for (int start = 0; start <= n - m; start++) {
        if (patternHash == windowHash && regionEquals(text, start, pattern)) {
            matches.add(start);
        }

        if (start < n - m) {
            long outgoing = text.charAt(start);
            long incoming = text.charAt(start + m);

            windowHash = (windowHash - outgoing * highestPower) % mod;
            if (windowHash < 0) {
                windowHash += mod;
            }
            windowHash = (windowHash * base + incoming) % mod;
        }
    }

    return matches;
}

private static boolean regionEquals(String text, int start, String pattern) {
    for (int i = 0; i < pattern.length(); i++) {
        if (text.charAt(start + i) != pattern.charAt(i)) {
            return false;
        }
    }
    return true;
}
```

Average-case biasanya `O(n + m)`, tetapi collision bisa membuat verifikasi sering terjadi, sehingga worst-case bisa memburuk.

### 7.3 Kapan Rabin-Karp Layak?

Rabin-Karp berguna ketika ingin mencari banyak pattern dengan panjang sama, rolling window fingerprint, approximate prefilter, plagiarism-like chunk matching, atau duplicate substring/chunk detection.

Kurang cocok ketika butuh deterministic no-collision behavior tanpa verifikasi, pattern tunggal dan sederhana, atau implementation risk tidak sebanding benefit.

---

## 8. Prefix, Suffix, Contains, StartsWith, EndsWith

Banyak masalah string sebenarnya bukan butuh algoritma kompleks. Sering cukup memilih operasi yang tepat.

```java
String code = "ACEAS-CASE-2026-000001";

boolean caseRef = code.startsWith("ACEAS-CASE-");
boolean year2026 = code.contains("-2026-");
boolean draft = code.endsWith("-DRAFT");
```

Tetapi dalam sistem nyata, pertanyaan pentingnya:

1. Apakah case-sensitive?
2. Apakah perlu normalization?
3. Apakah prefix/suffix literal atau pattern?
4. Apakah input bisa null?
5. Apakah whitespace signifikan?
6. Apakah token boundary harus dihormati?

Contoh bug:

```java
boolean isAdmin = role.contains("ADMIN");
```

Ini bisa match:

```text
NOT_ADMIN
READ_ADMIN_LOG
ADMINISTRATIVE_ASSISTANT
```

Lebih aman:

```java
Set<String> roles = Set.of("CASE_OFFICER", "ADMIN");
boolean isAdmin = roles.contains("ADMIN");
```

Atau jika input string delimited:

```java
public static boolean containsToken(String delimited, String token, char delimiter) {
    if (delimited == null || token == null || token.isEmpty()) {
        return false;
    }

    int n = delimited.length();
    int m = token.length();
    int i = 0;

    while (i <= n) {
        int start = i;
        int end = i;

        while (end < n && delimited.charAt(end) != delimiter) {
            end++;
        }

        if (end - start == m && delimited.regionMatches(start, token, 0, m)) {
            return true;
        }

        i = end + 1;
    }

    return false;
}
```

---

## 9. Parsing: Dari `split()` ke Cursor

Parsing adalah proses mengubah string menjadi struktur yang lebih bermakna.

```text
"caseId=123;state=OPEN;priority=HIGH"
```

menjadi:

```java
Map<String, String>
```

atau:

```java
record CaseFilter(String caseId, String state, String priority) {}
```

### 9.1 `split()` Tidak Selalu Murah

`String.split(regex)` memakai regex. Untuk delimiter literal sederhana, regex bisa overkill.

```java
String[] parts = input.split(";");
```

Ini mudah, tetapi membuat array, membuat substring, memakai regex engine, bisa membuang trailing empty string tergantung limit, dan kurang kontrol untuk error reporting.

Untuk parsing hot path atau format ketat, parser berbasis cursor sering lebih jelas.

### 9.2 Parser Cursor untuk Key-Value

Format:

```text
key=value;key=value;key=value
```

Rules:

- key tidak boleh kosong,
- value boleh kosong,
- delimiter antar pair `;`,
- separator key-value `=`,
- duplicate key ditolak,
- whitespace signifikan atau bisa ditrim sesuai kebutuhan.

```java
public static Map<String, String> parseKeyValuePairs(String input) {
    if (input == null) {
        throw new IllegalArgumentException("input must not be null");
    }

    Map<String, String> result = new LinkedHashMap<>();
    int n = input.length();
    int pos = 0;

    while (pos < n) {
        int keyStart = pos;

        while (pos < n && input.charAt(pos) != '=' && input.charAt(pos) != ';') {
            pos++;
        }

        if (pos == keyStart) {
            throw new IllegalArgumentException("empty key at index " + keyStart);
        }
        if (pos >= n || input.charAt(pos) != '=') {
            throw new IllegalArgumentException("expected '=' at index " + pos);
        }

        String key = input.substring(keyStart, pos);
        pos++; // skip '='

        int valueStart = pos;
        while (pos < n && input.charAt(pos) != ';') {
            pos++;
        }

        String value = input.substring(valueStart, pos);

        if (result.putIfAbsent(key, value) != null) {
            throw new IllegalArgumentException("duplicate key: " + key);
        }

        if (pos < n) {
            pos++; // skip ';'
            if (pos == n) {
                throw new IllegalArgumentException("trailing delimiter at index " + (pos - 1));
            }
        }
    }

    return result;
}
```

### 9.3 Kenapa Cursor Parser Bagus?

Parser cursor memberi kontrol atas posisi error, duplicate handling, empty token behavior, allocation, delimiter literal, escaping rules, dan deterministic complexity.

```text
pos selalu menunjuk karakter berikutnya yang belum dikonsumsi
setiap loop harus:
  - membaca satu unit grammar
  - memajukan pos
  - menjaga invariant format
```

Jika `pos` tidak maju pada salah satu branch, parser bisa infinite loop.

---

## 10. Tokenizer Sederhana

Tokenizer mengubah text menjadi token sequence.

Contoh input rule:

```text
state == OPEN && priority in [HIGH, CRITICAL]
```

Token:

```text
IDENT(state)
EQEQ
IDENT(OPEN)
AND
IDENT(priority)
IN
LBRACKET
IDENT(HIGH)
COMMA
IDENT(CRITICAL)
RBRACKET
EOF
```

### 10.1 Token Model

```java
public enum TokenType {
    IDENT,
    EQEQ,
    AND,
    IN,
    LBRACKET,
    RBRACKET,
    COMMA,
    EOF
}

public record Token(TokenType type, String lexeme, int position) {}
```

### 10.2 Lexer

```java
public final class SimpleRuleLexer {
    private final String input;
    private final int length;
    private int pos;

    public SimpleRuleLexer(String input) {
        if (input == null) {
            throw new IllegalArgumentException("input must not be null");
        }
        this.input = input;
        this.length = input.length();
    }

    public List<Token> tokenize() {
        List<Token> tokens = new ArrayList<>();

        while (true) {
            Token token = nextToken();
            tokens.add(token);
            if (token.type() == TokenType.EOF) {
                return tokens;
            }
        }
    }

    private Token nextToken() {
        skipWhitespace();

        if (pos >= length) {
            return new Token(TokenType.EOF, "", pos);
        }

        int start = pos;
        char c = input.charAt(pos);

        if (isIdentifierStart(c)) {
            pos++;
            while (pos < length && isIdentifierPart(input.charAt(pos))) {
                pos++;
            }

            String lexeme = input.substring(start, pos);
            return switch (lexeme) {
                case "in" -> new Token(TokenType.IN, lexeme, start);
                default -> new Token(TokenType.IDENT, lexeme, start);
            };
        }

        if (c == '=' && pos + 1 < length && input.charAt(pos + 1) == '=') {
            pos += 2;
            return new Token(TokenType.EQEQ, "==", start);
        }

        if (c == '&' && pos + 1 < length && input.charAt(pos + 1) == '&') {
            pos += 2;
            return new Token(TokenType.AND, "&&", start);
        }

        pos++;
        return switch (c) {
            case '[' -> new Token(TokenType.LBRACKET, "[", start);
            case ']' -> new Token(TokenType.RBRACKET, "]", start);
            case ',' -> new Token(TokenType.COMMA, ",", start);
            default -> throw new IllegalArgumentException("unexpected character '" + c + "' at index " + start);
        };
    }

    private void skipWhitespace() {
        while (pos < length && Character.isWhitespace(input.charAt(pos))) {
            pos++;
        }
    }

    private static boolean isIdentifierStart(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
    }

    private static boolean isIdentifierPart(char c) {
        return isIdentifierStart(c) || (c >= '0' && c <= '9');
    }
}
```

### 10.3 Mengapa Tokenizer Relevan untuk DSA?

Tokenizer adalah state machine kecil:

```text
state = current cursor position + current character class
transition = consume char/token
output = token stream
invariant = setiap char valid dikonsumsi tepat satu kali
```

Complexity:

```text
O(n) time
O(t) memory, t = jumlah token
```

Failure mode umum:

1. Tidak memajukan cursor.
2. Salah urutan match operator panjang vs pendek.
3. Tidak menyimpan posisi error.
4. Menganggap whitespace selalu tidak penting.
5. Identifier rules tidak konsisten dengan parser/domain.
6. Menggunakan regex kompleks padahal grammar sederhana.

---

## 11. Parser Mini: Dari Token ke Struktur

Tokenizer hanya menghasilkan token. Parser membangun struktur.

Untuk rule sederhana:

```text
condition := comparison ('&&' comparison)*
comparison := IDENT '==' IDENT | IDENT 'in' '[' IDENT (',' IDENT)* ']'
```

AST:

```java
public sealed interface Expr permits AndExpr, EqualsExpr, InExpr {}

public record AndExpr(List<Expr> terms) implements Expr {}

public record EqualsExpr(String field, String expected) implements Expr {}

public record InExpr(String field, Set<String> allowedValues) implements Expr {}
```

Parser:

```java
public final class SimpleRuleParser {
    private final List<Token> tokens;
    private int pos;

    public SimpleRuleParser(List<Token> tokens) {
        this.tokens = List.copyOf(tokens);
    }

    public Expr parse() {
        Expr expr = parseAndExpression();
        expect(TokenType.EOF);
        return expr;
    }

    private Expr parseAndExpression() {
        List<Expr> terms = new ArrayList<>();
        terms.add(parseComparison());

        while (match(TokenType.AND)) {
            terms.add(parseComparison());
        }

        if (terms.size() == 1) {
            return terms.get(0);
        }
        return new AndExpr(List.copyOf(terms));
    }

    private Expr parseComparison() {
        Token field = expect(TokenType.IDENT);

        if (match(TokenType.EQEQ)) {
            Token expected = expect(TokenType.IDENT);
            return new EqualsExpr(field.lexeme(), expected.lexeme());
        }

        if (match(TokenType.IN)) {
            expect(TokenType.LBRACKET);

            Set<String> values = new LinkedHashSet<>();
            values.add(expect(TokenType.IDENT).lexeme());

            while (match(TokenType.COMMA)) {
                values.add(expect(TokenType.IDENT).lexeme());
            }

            expect(TokenType.RBRACKET);
            return new InExpr(field.lexeme(), Set.copyOf(values));
        }

        throw error("expected '==' or 'in'");
    }

    private boolean match(TokenType type) {
        if (peek().type() == type) {
            pos++;
            return true;
        }
        return false;
    }

    private Token expect(TokenType type) {
        Token token = peek();
        if (token.type() != type) {
            throw error("expected " + type + " but found " + token.type());
        }
        pos++;
        return token;
    }

    private Token peek() {
        return tokens.get(pos);
    }

    private IllegalArgumentException error(String message) {
        Token token = peek();
        return new IllegalArgumentException(message + " at index " + token.position());
    }
}
```

Pelajaran DSA-nya:

- Token list adalah array/list linear.
- Parser cursor bergerak maju.
- Grammar menentukan state transition.
- AST adalah tree.
- Evaluator nanti bisa traversal tree.

---

## 12. Region Matching dan Menghindari Substring Tidak Perlu

Sering ada kode seperti ini:

```java
if (input.substring(start, end).equals("OPEN")) {
    // ...
}
```

Ini membuat string baru. Untuk hot path, gunakan region comparison:

```java
if (input.regionMatches(start, "OPEN", 0, 4)) {
    // ...
}
```

Atau manual jika butuh ASCII-specific:

```java
public static boolean regionEquals(String s, int start, String expected) {
    if (start < 0 || start + expected.length() > s.length()) {
        return false;
    }
    for (int i = 0; i < expected.length(); i++) {
        if (s.charAt(start + i) != expected.charAt(i)) {
            return false;
        }
    }
    return true;
}
```

Use case: parser, scanner, protocol decoder, fixed format validation, dan log classifier.

---

## 13. Case-Insensitive Matching

Case-insensitive matching bukan sekadar `toLowerCase()`.

```java
input.toLowerCase().equals("open")
```

Masalah:

1. Membuat string baru.
2. Locale bisa memengaruhi case mapping.
3. Unicode case mapping kompleks.
4. Untuk ASCII token, lebih baik manual atau pakai `equalsIgnoreCase`.

Untuk domain enum/code ASCII:

```java
if (status.equalsIgnoreCase("OPEN")) {
    // ...
}
```

Untuk map key canonicalization:

```java
String normalized = input.toUpperCase(Locale.ROOT);
```

Gunakan `Locale.ROOT`, bukan default locale, jika token bersifat machine-readable.

---

## 14. Regex: Powerful, Tapi Bukan Default Algorithm

Regex sangat berguna untuk pattern matching. Tetapi regex bukan free.

Masalah umum:

1. Compile pattern berulang.
2. Pattern terlalu kompleks.
3. Catastrophic backtracking.
4. Dipakai untuk parsing grammar nested.
5. `split()` dipakai di hot path tanpa sadar regex.
6. Error reporting buruk.

### 14.1 Compile Pattern Sekali

Buruk:

```java
public boolean isValid(String input) {
    return input.matches("[A-Z]{3}-\\d{6}");
}
```

Lebih baik:

```java
private static final Pattern CASE_REF_PATTERN = Pattern.compile("[A-Z]{3}-\\d{6}");

public static boolean isValidCaseRef(String input) {
    return input != null && CASE_REF_PATTERN.matcher(input).matches();
}
```

### 14.2 Regex vs Manual Validation

Untuk format sangat sederhana, manual bisa lebih cepat, jelas, dan error-friendly.

Regex:

```java
private static final Pattern POSTAL_CODE = Pattern.compile("\\d{6}");
```

Manual:

```java
public static boolean isSixDigitPostalCode(String input) {
    if (input == null || input.length() != 6) {
        return false;
    }
    for (int i = 0; i < 6; i++) {
        char c = input.charAt(i);
        if (c < '0' || c > '9') {
            return false;
        }
    }
    return true;
}
```

Manual version: no regex engine, no pattern ambiguity, easy to customize error, dan ASCII-specific by design. Regex version: concise, declarative, easier for richer patterns, tetapi less explicit cost-wise.

---

## 15. Common String Algorithm Patterns

### 15.1 Frequency Counting

Untuk ASCII lowercase:

```java
public static int[] lowercaseFrequency(String s) {
    int[] freq = new int[26];
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (c >= 'a' && c <= 'z') {
            freq[c - 'a']++;
        }
    }
    return freq;
}
```

Untuk full code point:

```java
public static Map<Integer, Integer> codePointFrequency(String s) {
    Map<Integer, Integer> freq = new HashMap<>();
    s.codePoints().forEach(cp -> freq.merge(cp, 1, Integer::sum));
    return freq;
}
```

Trade-off:

```text
int[26]     => cepat, kecil, domain sempit
int[128]    => ASCII
int[256]    => byte-like extended assumption, hati-hati encoding
Map<Integer,Integer> => fleksibel, lebih mahal
```

### 15.2 Anagram Check

```java
public static boolean isAnagramLowercaseAscii(String a, String b) {
    if (a == null || b == null || a.length() != b.length()) {
        return false;
    }

    int[] balance = new int[26];

    for (int i = 0; i < a.length(); i++) {
        char ca = a.charAt(i);
        char cb = b.charAt(i);

        if (ca < 'a' || ca > 'z' || cb < 'a' || cb > 'z') {
            return false;
        }

        balance[ca - 'a']++;
        balance[cb - 'a']--;
    }

    for (int count : balance) {
        if (count != 0) {
            return false;
        }
    }

    return true;
}
```

### 15.3 Longest Common Prefix

```java
public static String longestCommonPrefix(List<String> values) {
    if (values == null || values.isEmpty()) {
        return "";
    }

    String first = values.get(0);
    if (first == null) {
        return "";
    }

    int prefixLength = first.length();

    for (int i = 1; i < values.size(); i++) {
        String current = values.get(i);
        if (current == null) {
            return "";
        }

        int j = 0;
        int limit = Math.min(prefixLength, current.length());
        while (j < limit && first.charAt(j) == current.charAt(j)) {
            j++;
        }
        prefixLength = j;

        if (prefixLength == 0) {
            return "";
        }
    }

    return first.substring(0, prefixLength);
}
```

Complexity: `O(total compared chars)`, tidak selalu `O(n*m)` dalam praktik karena early mismatch stops.

### 15.4 Palindrome

```java
public static boolean isPalindromeByChar(String s) {
    if (s == null) {
        return false;
    }

    int left = 0;
    int right = s.length() - 1;

    while (left < right) {
        if (s.charAt(left) != s.charAt(right)) {
            return false;
        }
        left++;
        right--;
    }

    return true;
}
```

Untuk full Unicode/user-visible text, ini belum cukup. Harus jelas apa definisi palindrome.

---

## 16. Production Example: Template Placeholder Scanner

Misalnya template:

```text
"Dear ${name}, your case ${caseRef} is ${state}."
```

Rules:

- placeholder dimulai `${`, diakhiri `}`,
- name hanya `[A-Za-z_][A-Za-z0-9_]*`,
- nested placeholder tidak didukung,
- unclosed placeholder error,
- duplicate boleh atau tidak tergantung kebutuhan.

### 16.1 Model

```java
public record Placeholder(String name, int startInclusive, int endExclusive) {}
```

### 16.2 Scanner

```java
public static List<Placeholder> scanPlaceholders(String template) {
    if (template == null) {
        throw new IllegalArgumentException("template must not be null");
    }

    List<Placeholder> result = new ArrayList<>();
    int n = template.length();
    int i = 0;

    while (i < n) {
        char c = template.charAt(i);

        if (c == '$' && i + 1 < n && template.charAt(i + 1) == '{') {
            int start = i;
            i += 2;

            int nameStart = i;
            if (i >= n || !isIdentifierStart(template.charAt(i))) {
                throw new IllegalArgumentException("invalid placeholder name at index " + i);
            }

            i++;
            while (i < n && isIdentifierPart(template.charAt(i))) {
                i++;
            }

            String name = template.substring(nameStart, i);

            if (i >= n || template.charAt(i) != '}') {
                throw new IllegalArgumentException("unclosed placeholder starting at index " + start);
            }

            i++; // consume '}'
            result.add(new Placeholder(name, start, i));
        } else {
            i++;
        }
    }

    return result;
}
```

### 16.3 Renderer

```java
public static String renderTemplate(String template, Map<String, String> values) {
    List<Placeholder> placeholders = scanPlaceholders(template);
    if (placeholders.isEmpty()) {
        return template;
    }

    StringBuilder out = new StringBuilder(template.length() + values.size() * 8);
    int cursor = 0;

    for (Placeholder placeholder : placeholders) {
        out.append(template, cursor, placeholder.startInclusive());

        String value = values.get(placeholder.name());
        if (value == null) {
            throw new IllegalArgumentException("missing value for placeholder: " + placeholder.name());
        }

        out.append(value);
        cursor = placeholder.endExclusive();
    }

    out.append(template, cursor, template.length());
    return out.toString();
}
```

DSA insight:

- Scan: `O(n)`.
- Render: `O(n + output size)`.
- Placeholder list: `O(k)`.
- Builder prevents repeated concatenation.
- Indices preserve original text ranges.

---

## 17. Production Example: Case Reference Parser

Misalnya format:

```text
CEA-ENF-2026-000123
```

Komponen:

```text
agency = CEA
module = ENF
year   = 2026
seq    = 000123
```

### 17.1 Domain Record

```java
public record CaseReferenceParts(
        String agency,
        String module,
        int year,
        int sequence
) {}
```

### 17.2 Parser Tanpa Regex

```java
public static CaseReferenceParts parseCaseReference(String input) {
    if (input == null) {
        throw new IllegalArgumentException("case reference must not be null");
    }

    // CEA-ENF-2026-000123 => length 3+1+3+1+4+1+6 = 19
    if (input.length() != 19) {
        throw new IllegalArgumentException("invalid case reference length: " + input.length());
    }

    expectDash(input, 3);
    expectDash(input, 7);
    expectDash(input, 12);

    String agency = input.substring(0, 3);
    String module = input.substring(4, 7);

    requireUpperAscii(agency, "agency", 0);
    requireUpperAscii(module, "module", 4);

    int year = parseFixedDigits(input, 8, 12, "year");
    int sequence = parseFixedDigits(input, 13, 19, "sequence");

    return new CaseReferenceParts(agency, module, year, sequence);
}

private static void expectDash(String s, int index) {
    if (s.charAt(index) != '-') {
        throw new IllegalArgumentException("expected '-' at index " + index);
    }
}

private static void requireUpperAscii(String s, String label, int offset) {
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (c < 'A' || c > 'Z') {
            throw new IllegalArgumentException("invalid " + label + " character at index " + (offset + i));
        }
    }
}

private static int parseFixedDigits(String s, int start, int end, String label) {
    int value = 0;
    for (int i = start; i < end; i++) {
        char c = s.charAt(i);
        if (c < '0' || c > '9') {
            throw new IllegalArgumentException("invalid " + label + " digit at index " + i);
        }
        value = value * 10 + (c - '0');
    }
    return value;
}
```

Kenapa ini bagus untuk format fixed-width?

- deterministic,
- no regex dependency,
- error position jelas,
- no temporary array dari split,
- validasi ketat,
- complexity `O(1)` karena panjang fixed.

---

## 18. Failure Modes String di Production

### 18.1 Accidental Quadratic Build

Gejala: report generation lambat, CPU naik, allocation tinggi, GC sering, code terlihat harmless.

Penyebab:

```java
output += line;
```

Solusi: `StringBuilder`, `StringJoiner`, streaming writer, atau chunked output.

### 18.2 Regex Catastrophic Backtracking

Pattern nested quantifier bisa sangat lambat pada input tertentu.

```text
(a+)+$
```

Pada input panjang yang hampir cocok, regex engine backtracking bisa eksplosif.

Mitigasi:

- hindari nested ambiguous quantifier,
- gunakan possessive quantifier/atomic group jika paham,
- batasi panjang input,
- compile pattern sekali,
- gunakan parser manual untuk grammar deterministic,
- jangan menjalankan regex user-supplied tanpa guard.

### 18.3 `split()` Menghilangkan Trailing Empty

```java
String s = "a,b,";
String[] parts = s.split(",");
```

Default behavior bisa tidak sesuai ekspektasi trailing empty. Gunakan limit jika perlu:

```java
String[] parts = s.split(",", -1);
```

Namun tetap ingat: delimiter adalah regex.

### 18.4 Unicode Length Bug

```java
if (name.length() <= 20) {
    accept(name);
}
```

Ini membatasi jumlah UTF-16 code units, bukan karakter visual.

### 18.5 Locale Bug

```java
String key = input.toUpperCase();
```

Gunakan:

```java
String key = input.toUpperCase(Locale.ROOT);
```

untuk token machine-readable.

### 18.6 Substring Allocation Pressure

Parser yang membuat substring untuk setiap token dapat menghasilkan banyak allocation.

Solusi:

- simpan start/end range,
- gunakan `CharSequence` view jika benar-benar perlu,
- parse angka langsung dari input,
- gunakan region comparison,
- hanya materialize token final.

### 18.7 Null vs Empty vs Blank

String domain perlu membedakan:

```text
null   = tidak ada nilai
""     = nilai kosong
"   "  = blank whitespace
```

Jangan asal `trim()` semua input jika whitespace signifikan.

---

## 19. Testing Strategy untuk String Algorithm

String algorithm harus diuji dengan variasi input yang sering dilupakan.

### 19.1 Boundary Cases

```text
null
""
"a"
pattern kosong
pattern lebih panjang dari text
pattern sama dengan text
pattern di awal
pattern di tengah
pattern di akhir
pattern tidak ada
repeated characters
unicode surrogate pair
whitespace
trailing delimiter
duplicate key
invalid character
```

### 19.2 Test KMP vs Naive

Cara bagus: bandingkan hasil algoritma optimized dengan algoritma sederhana.

```java
@Test
void kmpShouldMatchNaiveForManyInputs() {
    List<String> texts = List.of(
            "",
            "a",
            "aaaa",
            "abcabcabc",
            "ababababac",
            "ACEAS-CASE-2026-000001"
    );

    List<String> patterns = List.of("", "a", "aa", "abc", "ababac", "CASE", "missing");

    for (String text : texts) {
        for (String pattern : patterns) {
            assertEquals(indexOfNaive(text, pattern), indexOfKmp(text, pattern));
        }
    }
}
```

### 19.3 Property-Based Thinking

```text
Jika indexOf(text, pattern) = i dan i >= 0,
maka text.substring(i, i + pattern.length()).equals(pattern)

Jika allOccurrences mengembalikan i,
setiap i harus valid dan match pattern.

Jika parser render lalu parse balik,
struktur harus sama untuk subset format yang valid.
```

---

## 20. Benchmarking Notes

Jangan microbenchmark string algorithm dengan `System.nanoTime()` asal-asalan jika hasilnya akan dipakai untuk keputusan serius. JIT, warmup, dead code elimination, allocation, dan input distribution dapat menipu.

Untuk benchmark serius:

- gunakan JMH,
- siapkan variasi input:
  - match awal,
  - match akhir,
  - no match,
  - repeated char worst-case,
  - random text,
  - long text,
  - short pattern,
  - long pattern,
- ukur allocation rate,
- jangan hanya throughput, lihat p99 jika relevan,
- benchmark built-in `indexOf` sebagai baseline.

Sering kali jawaban terbaik bukan “implement KMP sendiri”, tetapi:

```text
gunakan String.indexOf untuk simplicity,
validasi bahwa bottleneck bukan di search,
jika memang hot path dan worst-case penting, baru pertimbangkan algoritma khusus.
```

---

## 21. Decision Framework

### 21.1 Pertanyaan Awal

```text
1. Input-nya machine-readable atau human-readable?
2. Unit algoritmanya char, code point, token, line, atau grapheme?
3. Pattern literal atau regex?
4. Search sekali atau banyak kali?
5. Pattern satu atau banyak?
6. Input trusted atau untrusted?
7. Panjang input dibatasi atau tidak?
8. Error reporting butuh posisi detail atau tidak?
9. Apakah allocation menjadi masalah?
10. Apakah format punya grammar?
```

### 21.2 Pilihan Solusi

| Problem | Default | Upgrade jika perlu |
|---|---|---|
| contains literal kecil | `String.contains/indexOf` | KMP jika worst-case literal search penting |
| prefix/suffix | `startsWith/endsWith` | Trie untuk banyak prefix |
| format fixed-width | manual parser | generated parser jarang perlu |
| delimited simple | cursor parser / split | custom lexer jika escaping kompleks |
| regex validasi | precompiled `Pattern` | manual validator untuk hot path/simple ASCII |
| banyak keyword | loop `indexOf` untuk kecil | Aho-Corasick / trie Part 016 |
| template placeholder | scanner cursor | parser jika expression nested |
| case-insensitive token | `equalsIgnoreCase` / `Locale.ROOT` canonicalization | Collator untuk natural language |

---

## 22. Checklist Review Kode String

```text
[ ] Apakah unit string jelas: char/code point/token/grapheme?
[ ] Apakah null/empty/blank dibedakan dengan benar?
[ ] Apakah concatenation dalam loop memakai StringBuilder?
[ ] Apakah regex di-compile ulang di hot path?
[ ] Apakah split dipakai tanpa sadar regex/trailing behavior?
[ ] Apakah parsing punya error position yang berguna?
[ ] Apakah input length dibatasi untuk untrusted input?
[ ] Apakah case conversion memakai Locale.ROOT untuk machine token?
[ ] Apakah substring dalam loop menciptakan allocation besar?
[ ] Apakah algorithmic complexity jelas?
[ ] Apakah tests mencakup boundary, repeated chars, dan invalid input?
[ ] Apakah built-in API cukup sebelum membuat algoritma custom?
```

---

## 23. Ringkasan Mental Model

String algorithm di Java harus dipahami sebagai kombinasi dari:

```text
String semantics
  + sequence unit
  + algorithmic complexity
  + allocation behavior
  + API contract
  + domain grammar
```

Jangan melihat string hanya sebagai “teks”. Dalam sistem nyata, string bisa menjadi key, protocol, mini-language, serialized structure, path, template, user input, search corpus, dan rule expression.

Kesalahan memilih operasi string bisa berubah menjadi bug validasi, security issue, performance bottleneck, memory pressure, inconsistent behavior antar locale, parsing ambiguity, dan incorrect business decision.

Top-tier engineer tidak otomatis memakai algoritma paling canggih. Mereka memilih level yang tepat:

```text
Built-in API jika cukup.
Manual scanner jika format sederhana dan butuh kontrol.
KMP/Rabin-Karp jika search literal butuh guarantee/rolling behavior.
Trie/Aho-Corasick jika banyak pattern.
Parser formal jika grammar kompleks.
```

---

## 24. Latihan

### Latihan 1 — Manual CSV Field Splitter

Buat parser CSV satu baris dengan rules:

- delimiter `,`,
- quote `"`,
- escaped quote `""`,
- empty field valid,
- trailing comma menghasilkan empty field,
- error jika quote tidak tertutup.

Jangan pakai `split()`.

### Latihan 2 — Compare KMP vs Built-in

Implementasikan:

```java
List<Integer> allOccurrencesKmp(String text, String pattern)
```

Lalu bandingkan dengan implementasi berbasis `indexOf(pattern, fromIndex)` untuk banyak input.

### Latihan 3 — Template Renderer dengan Escaping

Extend placeholder scanner agar:

```text
\${name}
```

dianggap literal `${name}`, bukan placeholder.

### Latihan 4 — Fixed Format Parser

Parse nomor dokumen:

```text
CEA/ENF/2026/000123
```

Rules:

- agency 3 uppercase letters,
- module 3 uppercase letters,
- year 4 digits,
- sequence 6 digits,
- separator `/`,
- error harus menyebut index.

### Latihan 5 — Regex Replacement Review

Ambil satu regex validation di project nyata. Tanyakan:

1. Apakah pattern di-compile sekali?
2. Apakah input length dibatasi?
3. Apakah pattern bisa backtracking parah?
4. Apakah manual parser lebih tepat?
5. Apakah error message cukup jelas?

---

## 25. Referensi

- Oracle Java SE 25 API — `String`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html
- Oracle Java SE 25 API — `StringBuilder`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StringBuilder.html
- Oracle Java SE 25 API — `CharSequence`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/CharSequence.html
- Oracle Java SE 25 API — `Pattern`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html
- OpenJDK JEP 254 — Compact Strings: https://openjdk.org/jeps/254

---

## 26. Status Seri

Part ini adalah **Part 015 dari 030**.

Seri **belum selesai**.

Berikutnya:

```text
Part 016 — String Algorithms II: Trie, Prefix Index, Suffix Thinking
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dsa-part-014.md">⬅️ Part 014 — Graph II: Shortest Path, Topological Sort, Dependency Resolution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dsa-part-016.md">Part 016 — String Algorithms II: Trie, Prefix Index, Suffix Thinking ➡️</a>
</div>
