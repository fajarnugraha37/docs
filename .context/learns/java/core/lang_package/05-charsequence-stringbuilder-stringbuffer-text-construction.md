# Part 5 — `StringBuilder`, `StringBuffer`, `CharSequence`, and Text Construction Contracts

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `05-charsequence-stringbuilder-stringbuffer-text-construction.md`  
> Scope: Java 8 hingga Java 25  
> Fokus: kontrak konstruksi teks, mutable character sequence, API boundary, allocation, thread-safety, dan failure mode production.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas `String` sebagai immutable text/value-like object: literal, interning, Unicode, compact strings, concatenation, dan boundary design.

Part ini membahas lapisan yang sering terlihat “mudah”, tetapi dalam sistem besar sering menjadi sumber bug, memory waste, concurrency leak, dan API ambiguity:

- `CharSequence`
- `StringBuilder`
- `StringBuffer`
- `Appendable`
- `StringJoiner`
- pola konstruksi teks
- kapan menggunakan `+`, `StringBuilder`, `StringBuffer`, `String.join`, `StringJoiner`, `Formatter`, `MessageFormat`, stream joining, atau custom writer
- kontrak mutability dan visibility
- bagaimana API menerima/menyimpan/mengembalikan teks secara aman

Target setelah part ini:

1. Kamu memahami bahwa `CharSequence` bukan “String interface”, melainkan kontrak baca yang lemah.
2. Kamu tahu kapan `StringBuilder` benar-benar diperlukan dan kapan compiler/JVM sudah cukup optimal.
3. Kamu bisa membedakan thread-safety `StringBuffer` dengan correctness di level aplikasi.
4. Kamu paham risiko menyimpan `CharSequence` mutable sebagai field/domain value.
5. Kamu bisa mendesain text construction di sistem production: log message, SQL/XML/JSON-ish string, diagnostics, report, template, command line, batch import/export.
6. Kamu mampu menilai failure mode: allocation storm, retained huge buffer, eager log construction, interleaving mutation, Unicode slicing, dan boundary leak.

---

## 2. Mental Model Utama

### 2.1 `String` adalah hasil akhir; builder adalah staging area

Pikirkan teks di Java dalam dua fase:

```text
Construction phase       Boundary/value phase
------------------       --------------------
StringBuilder      --->  String
StringBuffer       --->  String
StringJoiner       --->  String
Formatter          --->  String / Appendable
Writer             --->  file/socket/buffer
```

`StringBuilder` bukan pengganti `String`. Ia adalah **mutable staging area** untuk membangun urutan karakter sebelum dijadikan `String` atau dikirim ke target lain.

Prinsip desain:

```text
Inside method / local construction: mutable builder is fine.
Across boundary / stored value: prefer immutable String.
```

Boundary di sini berarti:

- field object;
- DTO/domain object;
- cache key;
- map key;
- return value public API;
- event payload;
- message passed between threads;
- audit/log/business record;
- data persisted to DB/file/queue.

### 2.2 `CharSequence` adalah kontrak akses, bukan kontrak immutability

`CharSequence` berbunyi seperti “readable character sequence”. Tetapi implementasinya bisa immutable atau mutable.

Contoh implementasi umum:

- `String` — immutable;
- `StringBuilder` — mutable, not synchronized;
- `StringBuffer` — mutable, synchronized;
- `CharBuffer` — buffer view, mutable depending on backing buffer;
- framework-specific lazy sequence.

Jadi, method seperti ini kelihatan fleksibel:

```java
public void setName(CharSequence name) {
    this.name = name;
}
```

Tetapi berbahaya jika `name` disimpan langsung. Pemanggil bisa memberi `StringBuilder`, lalu memutasi setelah object dibuat.

```java
StringBuilder sb = new StringBuilder("Alice");
user.setName(sb);
sb.setLength(0);
sb.append("Mallory");

// user.name mungkin ikut berubah jika disimpan sebagai CharSequence.
```

Mental model top engineer:

```text
Accepting CharSequence is okay for immediate read.
Storing CharSequence requires copying to String unless mutability is intentional.
```

### 2.3 Thread-safe object tidak otomatis membuat workflow thread-safe

`StringBuffer` synchronized. Tetapi ini hanya menyinkronkan tiap method call, bukan seluruh logical operation.

```java
if (buffer.length() < 100) {
    buffer.append(value);
}
```

Dua operasi ini bukan atomic sebagai satu invariant. Thread lain bisa mengubah buffer di antara `length()` dan `append()`.

Jadi:

```text
StringBuffer = method-level synchronization.
Not equal to transaction-level consistency.
```

Untuk kebanyakan kode modern:

- gunakan `StringBuilder` untuk local construction;
- gunakan lock/executor/actor/queue kalau butuh invariant lintas thread;
- gunakan immutable `String` di boundary;
- gunakan `StringBuffer` hanya untuk API legacy atau kebutuhan sink synchronized sederhana.

---

## 3. Peta API yang Dibahas

### 3.1 `CharSequence`

Kontrak utama:

```java
int length();
char charAt(int index);
CharSequence subSequence(int start, int end);
String toString();
```

Static/default modern methods yang relevan:

```java
static int compare(CharSequence cs1, CharSequence cs2)
```

Dan default method:

```java
IntStream chars();
IntStream codePoints();
```

Catatan penting:

- `charAt` bekerja pada UTF-16 code unit, bukan Unicode grapheme.
- `length` juga menghitung code unit.
- `subSequence` tidak menjamin immutable copy.
- `toString` adalah cara normal untuk mengambil snapshot string representation.

### 3.2 `StringBuilder`

Karakteristik:

```text
mutable
not synchronized
implements CharSequence, Appendable, Serializable, Comparable<StringBuilder>
```

Operasi utama:

- `append(...)`
- `insert(...)`
- `delete(...)`
- `deleteCharAt(...)`
- `replace(...)`
- `reverse()`
- `setLength(...)`
- `ensureCapacity(...)`
- `trimToSize()`
- `capacity()`
- `toString()`

Use case utama:

- membangun string dalam loop;
- membuat diagnostic message kompleks;
- membangun output text kecil-menengah;
- membuat SQL/log/debug text sementara;
- parser/formatter internal;
- reduce allocation untuk repeated append.

### 3.3 `StringBuffer`

Karakteristik:

```text
mutable
synchronized methods
legacy sibling of StringBuilder
implements CharSequence, Appendable, Serializable, Comparable<StringBuffer>
```

Use case modern:

- API lama masih membutuhkan `StringBuffer`;
- adapter ke library legacy;
- shared mutable sequence dengan operasi sederhana dan toleransi locking;
- sangat jarang menjadi pilihan pertama dalam desain baru.

### 3.4 `Appendable`

`Appendable` adalah kontrak “target yang bisa di-append karakter”.

Implementasi umum:

- `StringBuilder`
- `StringBuffer`
- `Writer`
- `PrintStream`
- `Formatter`

Kontrak utama:

```java
Appendable append(CharSequence csq) throws IOException;
Appendable append(CharSequence csq, int start, int end) throws IOException;
Appendable append(char c) throws IOException;
```

Ini berguna untuk desain API yang bisa menulis ke banyak target tanpa selalu membangun `String` di memory.

### 3.5 `StringJoiner`

Untuk membangun teks dengan delimiter, prefix, suffix.

```java
StringJoiner joiner = new StringJoiner(", ", "[", "]");
joiner.add("A").add("B").add("C");
String result = joiner.toString(); // [A, B, C]
```

Berguna ketika masalahnya bukan “append bebas”, tetapi “gabungkan banyak elemen dengan delimiter”.

---

## 4. Kenapa `CharSequence` Adalah Kontrak yang Lemah

### 4.1 `CharSequence` tidak menjanjikan value semantics

`String` punya value-like behavior:

```java
String a = "abc";
String b = new String("abc");
a.equals(b); // true
```

Tetapi `StringBuilder` dan `StringBuffer` tidak override `equals` menjadi content equality seperti `String`.

```java
StringBuilder a = new StringBuilder("abc");
StringBuilder b = new StringBuilder("abc");

System.out.println(a.equals(b)); // false, identity equality
```

Ini critical. Jangan gunakan `StringBuilder` sebagai key berbasis isi.

```java
Map<StringBuilder, Integer> map = new HashMap<>();
map.put(new StringBuilder("id-1"), 1);

System.out.println(map.get(new StringBuilder("id-1"))); // null
```

Gunakan `String` sebagai key.

```java
Map<String, Integer> map = new HashMap<>();
map.put(new StringBuilder("id-1").toString(), 1);

System.out.println(map.get("id-1")); // 1
```

### 4.2 `CharSequence` bisa berubah saat sedang dibaca

Misalnya API validator menerima `CharSequence`:

```java
public static boolean isNumeric(CharSequence value) {
    for (int i = 0; i < value.length(); i++) {
        if (!Character.isDigit(value.charAt(i))) {
            return false;
        }
    }
    return true;
}
```

Kalau `value` adalah `String`, aman dari perubahan. Kalau `value` adalah mutable object yang dimutasi thread lain, hasil bisa tidak konsisten.

Better untuk input yang harus stabil:

```java
public static boolean isNumeric(CharSequence value) {
    String snapshot = value == null ? null : value.toString();
    if (snapshot == null || snapshot.isEmpty()) {
        return false;
    }

    for (int i = 0; i < snapshot.length(); i++) {
        if (!Character.isDigit(snapshot.charAt(i))) {
            return false;
        }
    }
    return true;
}
```

Trade-off:

- snapshot menambah allocation;
- tetapi membuat behavior deterministic;
- cocok untuk validation/security/domain boundary;
- tidak selalu perlu untuk tight loop internal yang sudah mengontrol input.

### 4.3 `subSequence` tidak selalu copy

Untuk `String`, modern Java mengembalikan substring yang independen secara konseptual. Untuk implementasi lain, `subSequence` bisa berupa view.

Jangan berasumsi:

```java
CharSequence sub = sequence.subSequence(0, 5);
```

adalah immutable snapshot. Kalau perlu snapshot:

```java
String sub = sequence.subSequence(0, 5).toString();
```

---

## 5. `StringBuilder`: Mutable Sequence untuk Konstruksi Lokal

### 5.1 Basic usage

```java
StringBuilder sb = new StringBuilder();
sb.append("User ");
sb.append(userId);
sb.append(" failed login from ");
sb.append(ipAddress);

String message = sb.toString();
```

Ini bagus ketika:

- jumlah append banyak;
- terjadi dalam loop;
- ada conditional append;
- output akhir adalah satu `String`.

### 5.2 Method chaining bukan magic

```java
String result = new StringBuilder()
        .append("caseId=").append(caseId)
        .append(", status=").append(status)
        .append(", actor=").append(actor)
        .toString();
```

Chaining hanya mengembalikan builder yang sama. Tidak membuat string baru setiap append.

### 5.3 Kapasitas dan pertumbuhan

`StringBuilder` punya:

```java
length()   // jumlah char yang digunakan
capacity() // kapasitas internal buffer
```

Contoh:

```java
StringBuilder sb = new StringBuilder(1024);
System.out.println(sb.length());   // 0
System.out.println(sb.capacity()); // >= 1024
```

Mental model:

```text
length   = used portion
capacity = allocated internal space
```

Ketika append melebihi kapasitas, buffer internal perlu tumbuh dan data lama disalin. Karena itu, untuk output yang bisa diperkirakan ukurannya, initial capacity dapat membantu.

```java
StringBuilder sb = new StringBuilder(items.size() * 32);
for (Item item : items) {
    sb.append(item.code()).append('=').append(item.value()).append('\n');
}
```

Tetapi jangan micro-optimize secara buta. Initial capacity yang terlalu besar bisa membuang memory.

### 5.4 `setLength` bisa truncate atau pad dengan null character

```java
StringBuilder sb = new StringBuilder("abc");
sb.setLength(2);
System.out.println(sb); // ab

sb.setLength(5);
System.out.println(sb.length()); // 5
System.out.println((int) sb.charAt(3)); // 0
```

`setLength` lebih cocok untuk:

- reset builder reuse;
- truncate delimiter terakhir;
- internal buffer manipulation.

Hati-hati dengan null character (`\u0000`) ketika memperpanjang.

### 5.5 Menghapus delimiter terakhir

Pattern umum:

```java
StringBuilder sb = new StringBuilder();
for (String role : roles) {
    sb.append(role).append(",");
}
if (!roles.isEmpty()) {
    sb.setLength(sb.length() - 1);
}
return sb.toString();
```

Lebih baik untuk delimiter pakai `StringJoiner` atau `String.join` bila sesuai.

```java
return String.join(",", roles);
```

Atau:

```java
StringJoiner joiner = new StringJoiner(",");
for (String role : roles) {
    joiner.add(role);
}
return joiner.toString();
```

### 5.6 `reverse()` dan Unicode caveat

```java
StringBuilder sb = new StringBuilder("abc");
sb.reverse(); // cba
```

Untuk teks Unicode kompleks, reverse bisa membingungkan karena user-perceived character tidak selalu sama dengan UTF-16 code unit. `StringBuilder.reverse()` punya perlakuan tertentu terhadap surrogate pair, tetapi tidak berarti ia memahami grapheme cluster lengkap.

Contoh masalah konseptual:

- emoji + skin tone modifier;
- huruf + combining mark;
- flag emoji yang terdiri dari regional indicators;
- ZWJ sequence.

Untuk business text biasa, reverse jarang diperlukan. Untuk text UI/internationalization serius, gunakan library yang sadar Unicode grapheme segmentation.

---

## 6. `StringBuffer`: Thread-Safe Legacy, Bukan Default Modern

### 6.1 Perbedaan utama dengan `StringBuilder`

```text
StringBuilder = mutable, not synchronized, faster for local use
StringBuffer  = mutable, synchronized methods, legacy/thread-safe at method level
```

Dokumentasi Java modern sendiri menyarankan `StringBuilder` secara umum sebagai pengganti `StringBuffer` jika buffer digunakan oleh satu thread.

### 6.2 Thread-safe method tidak sama dengan atomic workflow

```java
StringBuffer buffer = new StringBuffer();

// Thread A and B
if (buffer.length() < 10) {
    buffer.append("ABCDE");
}
```

Masing-masing method synchronized, tetapi gabungan check-then-act tidak atomic.

Correct jika invariant penting:

```java
synchronized (buffer) {
    if (buffer.length() < 10) {
        buffer.append("ABCDE");
    }
}
```

Namun desain yang lebih baik sering kali:

- jangan share mutable text buffer;
- masing-masing thread membangun local `StringBuilder`;
- hasil dikirim ke queue/collector;
- gabungkan secara controlled.

### 6.3 Kapan `StringBuffer` masih masuk akal?

1. API legacy membutuhkan `StringBuffer`.
2. Kode lama sudah memakai `StringBuffer` dan tidak ada bottleneck.
3. Sink text sederhana dipakai bersama dan synchronized method cukup.
4. Framework lama masih expose `StringBuffer`.

Untuk desain baru, default-nya tetap `StringBuilder` lokal + boundary immutable.

---

## 7. `Appendable`: Desain Output Tanpa Selalu Membuat String

### 7.1 Problem: API yang selalu return `String` bisa boros

```java
public String renderReport(Report report) {
    StringBuilder sb = new StringBuilder();
    // build huge report
    return sb.toString();
}
```

Untuk output besar, ini bisa menahan seluruh teks di memory. Alternatif:

```java
public void renderReport(Report report, Appendable out) throws IOException {
    out.append("Report: ").append(report.id()).append('\n');
    for (ReportLine line : report.lines()) {
        out.append(line.code()).append(" = ").append(line.value()).append('\n');
    }
}
```

Pemanggil bisa memilih target:

```java
StringBuilder sb = new StringBuilder();
renderReport(report, sb);
String text = sb.toString();
```

Atau:

```java
try (Writer writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    renderReport(report, writer);
}
```

### 7.2 `Appendable` membuat API lebih composable

Kelebihan:

- bisa tulis ke memory (`StringBuilder`);
- bisa tulis ke file/network (`Writer`);
- bisa tulis ke formatter;
- menghindari intermediate huge string;
- cocok untuk report/export/template internal.

Kekurangan:

- method perlu handle `IOException` karena beberapa `Appendable` bisa I/O;
- lebih sulit dipakai daripada return `String`;
- tidak semua rendering perlu serumit ini.

Pattern pragmatic:

```java
public String renderSmall(Thing thing) {
    StringBuilder sb = new StringBuilder();
    try {
        renderTo(thing, sb);
    } catch (IOException impossible) {
        throw new AssertionError(impossible);
    }
    return sb.toString();
}

public void renderTo(Thing thing, Appendable out) throws IOException {
    out.append("id=").append(thing.id());
}
```

Karena `StringBuilder.append` tidak benar-benar melempar `IOException`, wrapper ini cukup umum.

---

## 8. `+` vs `StringBuilder`: Kapan Compiler Sudah Membantu?

### 8.1 Concatenation sederhana: gunakan `+`

```java
String message = "User " + userId + " failed login";
```

Ini readable. Di Java modern, string concatenation dikompilasi ke mekanisme runtime yang bisa dioptimalkan JVM. Sejak Java 9, JEP 280 mengubah strategi `javac` untuk memakai `invokedynamic` agar implementasi concatenation dapat berevolusi tanpa mengubah bytecode shape dari compiler.

Jangan menulis ini hanya demi “performance”:

```java
String message = new StringBuilder()
        .append("User ")
        .append(userId)
        .append(" failed login")
        .toString();
```

Untuk satu ekspresi sederhana, `+` lebih jelas.

### 8.2 Concatenation dalam loop: hati-hati

Buruk:

```java
String result = "";
for (String item : items) {
    result += item + "\n";
}
```

Kenapa buruk?

Setiap iterasi dapat membuat string baru dari hasil sebelumnya + item baru. Kompleksitas memory/copy bisa meningkat drastis.

Lebih baik:

```java
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item).append('\n');
}
String result = sb.toString();
```

Atau jika delimiter sederhana:

```java
String result = String.join("\n", items);
```

### 8.3 `+` di dalam satu statement loop body tidak selalu buruk

```java
for (Item item : items) {
    log.debug("item=" + item.id() + ", status=" + item.status());
}
```

Masalahnya bukan hanya `+`, tetapi eager construction ketika log level disabled. Lebih baik pakai lazy/parameterized logging sesuai framework.

Contoh dengan SLF4J-style:

```java
log.debug("item={}, status={}", item.id(), item.status());
```

Atau kalau computation mahal:

```java
if (log.isDebugEnabled()) {
    log.debug("expensive={}", buildExpensiveDiagnostic(item));
}
```

---

## 9. Pola Konstruksi Teks yang Tepat

### 9.1 Small fixed message

Gunakan `+`:

```java
throw new IllegalArgumentException("Invalid case id: " + caseId);
```

### 9.2 Banyak conditional fields

Gunakan `StringBuilder`:

```java
StringBuilder sb = new StringBuilder("CaseSearchCriteria{");

if (criteria.caseId() != null) {
    sb.append("caseId=").append(criteria.caseId()).append(", ");
}
if (criteria.status() != null) {
    sb.append("status=").append(criteria.status()).append(", ");
}
if (criteria.assignee() != null) {
    sb.append("assignee=").append(criteria.assignee()).append(", ");
}

if (sb.length() > "CaseSearchCriteria{".length()) {
    sb.setLength(sb.length() - 2);
}
sb.append('}');

return sb.toString();
```

Untuk production, pattern ini bisa dibungkus helper agar tidak repetitif.

### 9.3 Delimited list

Gunakan `String.join` jika elemen sudah `CharSequence`:

```java
String csv = String.join(",", codes);
```

Gunakan `Collectors.joining` jika stream transform:

```java
String csv = users.stream()
        .map(User::id)
        .collect(Collectors.joining(","));
```

Gunakan `StringJoiner` jika imperative:

```java
StringJoiner joiner = new StringJoiner(",", "[", "]");
for (User user : users) {
    joiner.add(user.id());
}
return joiner.toString();
```

### 9.4 Large generated output

Gunakan `Appendable`/`Writer`, bukan return huge string:

```java
public void writeCsv(List<User> users, Writer writer) throws IOException {
    writer.write("id,name,status\n");
    for (User user : users) {
        writer.write(escapeCsv(user.id()));
        writer.write(',');
        writer.write(escapeCsv(user.name()));
        writer.write(',');
        writer.write(escapeCsv(user.status()));
        writer.write('\n');
    }
}
```

### 9.5 Structured output

Jangan membangun JSON/XML/SQL kompleks dengan raw `StringBuilder` kecuali kamu benar-benar mengontrol escaping.

Buruk:

```java
String json = "{\"name\":\"" + name + "\"}";
```

Kalau `name` mengandung quote/backslash/control char, output rusak atau rentan injection.

Prinsip:

```text
StringBuilder is construction tool, not escaping/security tool.
```

Gunakan library serializer untuk JSON/XML/SQL parameterization. Kalau harus generate manual, buat escaping function yang benar dan diuji.

---

## 10. API Boundary Design: `String` atau `CharSequence`?

### 10.1 Parameter method

Gunakan `String` jika:

- input adalah domain value stabil;
- perlu disimpan;
- perlu equality/hash/canonicalization;
- public API harus jelas;
- security-sensitive boundary.

Gunakan `CharSequence` jika:

- hanya dibaca segera;
- ingin menerima `StringBuilder`, `StringBuffer`, `CharBuffer`;
- utility low-level text scanning;
- performance-sensitive parser internal;
- tidak menyimpan referensi.

Contoh aman:

```java
public static boolean startsWithIgnoreCase(CharSequence text, String prefix) {
    if (text.length() < prefix.length()) {
        return false;
    }
    for (int i = 0; i < prefix.length(); i++) {
        char a = Character.toLowerCase(text.charAt(i));
        char b = Character.toLowerCase(prefix.charAt(i));
        if (a != b) {
            return false;
        }
    }
    return true;
}
```

Catatan: ini masih bukan solusi full Unicode locale-aware. Tapi sebagai scanner ASCII-ish internal, bisa masuk akal.

### 10.2 Field dan constructor

Buruk:

```java
public final class DocumentName {
    private final CharSequence value;

    public DocumentName(CharSequence value) {
        this.value = Objects.requireNonNull(value);
    }
}
```

Lebih aman:

```java
public final class DocumentName {
    private final String value;

    public DocumentName(CharSequence value) {
        this.value = Objects.requireNonNull(value).toString();
        if (this.value.isBlank()) {
            throw new IllegalArgumentException("Document name must not be blank");
        }
    }

    public String value() {
        return value;
    }
}
```

### 10.3 Return type

Prefer return `String` untuk value final.

```java
public String displayName() {
    return firstName + " " + lastName;
}
```

Return `CharSequence` hanya jika memang ingin menyembunyikan implementation dan caller hanya boleh membaca. Tetapi ini jarang memberi keuntungan di business API.

### 10.4 Cache key

Selalu gunakan immutable normalized `String` atau value object immutable.

Buruk:

```java
Map<CharSequence, User> usersByName = new HashMap<>();
```

Lebih baik:

```java
Map<String, User> usersByName = new HashMap<>();
```

Dengan canonicalization bila perlu:

```java
String key = name.strip().toLowerCase(Locale.ROOT);
```

---

## 11. Memory dan Allocation Model

### 11.1 Builder mengurangi intermediate string, bukan menghilangkan allocation

```java
StringBuilder sb = new StringBuilder();
sb.append(a).append(b).append(c);
String result = sb.toString();
```

Allocation tetap ada:

- builder object;
- internal buffer;
- final string;
- mungkin intermediate object dari `String.valueOf` untuk beberapa tipe;
- object dari method yang dipanggil dalam append.

Namun dibanding repeated `result += ...` dalam loop, builder biasanya jauh lebih baik.

### 11.2 Retained huge buffer

Pattern berbahaya:

```java
private static final ThreadLocal<StringBuilder> TL_BUILDER =
        ThreadLocal.withInitial(StringBuilder::new);

public static String build(List<String> values) {
    StringBuilder sb = TL_BUILDER.get();
    sb.setLength(0);
    for (String value : values) {
        sb.append(value);
    }
    return sb.toString();
}
```

Masalah:

- suatu request besar membuat capacity builder menjadi sangat besar;
- builder tetap tersimpan di thread pool worker;
- memory retained lama;
- pada app server/container, ThreadLocal juga bisa memicu leak.

Mitigasi:

```java
private static final int MAX_REUSE_CAPACITY = 8 * 1024;

public static String build(List<String> values) {
    StringBuilder sb = TL_BUILDER.get();
    sb.setLength(0);
    try {
        for (String value : values) {
            sb.append(value);
        }
        return sb.toString();
    } finally {
        if (sb.capacity() > MAX_REUSE_CAPACITY) {
            TL_BUILDER.remove();
        } else {
            sb.setLength(0);
        }
    }
}
```

Tetapi default terbaik: jangan gunakan ThreadLocal builder kecuali profiling membuktikan perlu.

### 11.3 Builder reuse lokal

Reuse lokal dalam method bisa baik:

```java
StringBuilder sb = new StringBuilder(256);
for (Record record : records) {
    sb.setLength(0);
    sb.append(record.id()).append('|').append(record.status());
    output.add(sb.toString());
}
```

Ini aman karena builder tidak keluar dari method.

Tetapi hati-hati:

```java
List<CharSequence> output = new ArrayList<>();
StringBuilder sb = new StringBuilder();
for (Record record : records) {
    sb.setLength(0);
    sb.append(record.id());
    output.add(sb); // BUG: semua elemen refer ke builder yang sama
}
```

Correct:

```java
output.add(sb.toString());
```

---

## 12. Logging dan Diagnostics

### 12.1 Jangan bangun string mahal ketika log disabled

Buruk:

```java
log.debug("payload=" + renderHugePayload(payload));
```

Walaupun debug disabled, `renderHugePayload(payload)` tetap dieksekusi.

Lebih baik:

```java
if (log.isDebugEnabled()) {
    log.debug("payload={}", renderHugePayload(payload));
}
```

Atau jika logging framework mendukung supplier/lambda, gunakan lazy API.

### 12.2 `toString()` harus diagnostic, bukan business serialization

Buruk:

```java
public String toString() {
    return toJson();
}
```

Masalah:

- bisa mahal;
- bisa bocor data sensitif;
- bisa dipanggil implisit oleh log/exception;
- bisa menyebabkan recursion;
- bisa memicu lazy loading.

Better:

```java
@Override
public String toString() {
    return new StringBuilder("Case{")
            .append("id=").append(id)
            .append(", status=").append(status)
            .append(", version=").append(version)
            .append('}')
            .toString();
}
```

Jangan masukkan:

- password/token;
- full payload PII;
- huge collection;
- binary data;
- lazy association besar.

### 12.3 Exception message construction

Exception message harus cukup untuk debugging, tapi tidak berlebihan.

```java
throw new IllegalStateException(
        "Invalid transition: caseId=" + caseId
                + ", from=" + from
                + ", to=" + to
                + ", actorRole=" + actorRole
);
```

Untuk message kompleks:

```java
private static String invalidTransitionMessage(
        String caseId,
        String from,
        String to,
        String actorRole,
        Collection<String> allowedTargets
) {
    return new StringBuilder(128)
            .append("Invalid transition: caseId=").append(caseId)
            .append(", from=").append(from)
            .append(", to=").append(to)
            .append(", actorRole=").append(actorRole)
            .append(", allowedTargets=").append(allowedTargets)
            .toString();
}
```

---

## 13. Security: Builder Tidak Melakukan Escaping

### 13.1 SQL

Buruk:

```java
String sql = "select * from users where name = '" + name + "'";
```

Correct:

```java
PreparedStatement ps = connection.prepareStatement(
        "select * from users where name = ?"
);
ps.setString(1, name);
```

### 13.2 XML

Buruk:

```java
String xml = "<name>" + name + "</name>";
```

Jika `name = "A&B"`, XML invalid. Jika mengandung markup, output bisa berubah.

Minimum escaping:

```java
static String escapeXmlText(String text) {
    StringBuilder sb = new StringBuilder(text.length());
    for (int i = 0; i < text.length(); i++) {
        char c = text.charAt(i);
        switch (c) {
            case '&' -> sb.append("&amp;");
            case '<' -> sb.append("&lt;");
            case '>' -> sb.append("&gt;");
            default -> sb.append(c);
        }
    }
    return sb.toString();
}
```

Tetapi untuk XML serius, gunakan XML writer/DOM/serializer yang benar.

### 13.3 HTML

Jangan gunakan XML escaping untuk HTML attribute/context secara sembarangan. Escaping bergantung konteks:

- HTML text;
- HTML attribute;
- JavaScript string;
- URL;
- CSS.

`StringBuilder` tidak tahu konteks ini.

### 13.4 Command line

Buruk:

```java
String command = "convert " + inputPath + " " + outputPath;
Runtime.getRuntime().exec(command);
```

Lebih aman:

```java
new ProcessBuilder("convert", inputPath.toString(), outputPath.toString()).start();
```

Akan dibahas lebih dalam pada part `Runtime/ProcessBuilder`.

---

## 14. Unicode dan `CharSequence`

### 14.1 `char` bukan selalu karakter manusia

`CharSequence.length()` menghitung UTF-16 code unit.

```java
String s = "😄";
System.out.println(s.length()); // 2
System.out.println(s.codePointCount(0, s.length())); // 1
```

Karena itu builder operation berdasarkan index harus hati-hati.

```java
StringBuilder sb = new StringBuilder("😄abc");
sb.deleteCharAt(0); // bisa merusak surrogate pair
```

Better jika bekerja dengan code point:

```java
int cp = sb.codePointAt(0);
int count = Character.charCount(cp);
sb.delete(0, count);
```

### 14.2 `chars()` vs `codePoints()`

```java
CharSequence seq = "😄";
seq.chars().forEach(System.out::println);      // dua UTF-16 code unit
seq.codePoints().forEach(System.out::println); // satu code point
```

Untuk text internasional, prefer `codePoints()` jika maksudnya Unicode code point.

Namun code point pun belum tentu grapheme cluster.

---

## 15. Design Pattern: Safe Text Builder Utility

Kadang kita butuh utility kecil untuk diagnostic string tanpa framework berat.

```java
public final class DiagnosticText {
    private final StringBuilder sb;
    private boolean hasField;

    private DiagnosticText(String typeName) {
        this.sb = new StringBuilder(typeName).append('{');
    }

    public static DiagnosticText of(String typeName) {
        return new DiagnosticText(typeName);
    }

    public DiagnosticText field(String name, Object value) {
        if (hasField) {
            sb.append(", ");
        }
        sb.append(name).append('=').append(safe(value));
        hasField = true;
        return this;
    }

    private static Object safe(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof CharSequence cs && cs.length() > 256) {
            return cs.subSequence(0, 256) + "...";
        }
        return value;
    }

    @Override
    public String toString() {
        return sb.append('}').toString();
    }
}
```

Usage:

```java
@Override
public String toString() {
    return DiagnosticText.of("Case")
            .field("id", id)
            .field("status", status)
            .field("assignee", assignee)
            .toString();
}
```

Caveat: contoh ini sederhana. Jika `toString()` dipanggil dua kali pada object `DiagnosticText`, ia akan append `}` lagi. Bisa dibuat lebih robust dengan `build()` sekali atau flag finalized. Tujuannya menunjukkan pola, bukan library final.

---

## 16. Design Pattern: Appendable Renderer

Untuk output yang kadang kecil, kadang besar:

```java
public interface TextRenderer<T> {
    void render(T value, Appendable out) throws IOException;

    default String renderToString(T value) {
        StringBuilder sb = new StringBuilder();
        try {
            render(value, sb);
        } catch (IOException e) {
            throw new AssertionError("StringBuilder should not throw IOException", e);
        }
        return sb.toString();
    }
}
```

Implementasi:

```java
public final class CaseSummaryRenderer implements TextRenderer<CaseSummary> {
    @Override
    public void render(CaseSummary value, Appendable out) throws IOException {
        out.append("Case ").append(value.caseId()).append('\n');
        out.append("Status: ").append(value.status()).append('\n');
        out.append("Officer: ").append(value.officerName()).append('\n');
    }
}
```

Keuntungan:

- test bisa pakai `renderToString`;
- production export bisa pakai `Writer`;
- tidak wajib menahan semua output di memory;
- boundary jelas.

---

## 17. Design Pattern: Text Scanner dengan `CharSequence`

Untuk utility internal yang membaca input tanpa copy:

```java
public final class AsciiTokenScanner {
    private final CharSequence input;
    private int index;

    public AsciiTokenScanner(CharSequence input) {
        this.input = Objects.requireNonNull(input);
    }

    public boolean hasNext() {
        skipWhitespace();
        return index < input.length();
    }

    public String nextToken() {
        skipWhitespace();
        int start = index;
        while (index < input.length() && !Character.isWhitespace(input.charAt(index))) {
            index++;
        }
        return input.subSequence(start, index).toString();
    }

    private void skipWhitespace() {
        while (index < input.length() && Character.isWhitespace(input.charAt(index))) {
            index++;
        }
    }
}
```

Kenapa return `String`?

Karena token adalah boundary value. `subSequence` bisa view/mutable; `toString()` memberi snapshot.

---

## 18. Anti-Patterns

### 18.1 Public API return mutable builder

Buruk:

```java
public StringBuilder getName() {
    return nameBuilder;
}
```

Pemanggil bisa memutasi state internal.

Better:

```java
public String getName() {
    return nameBuilder.toString();
}
```

Atau simpan sebagai `String` sejak awal.

### 18.2 Store mutable `CharSequence`

Buruk:

```java
private final CharSequence externalId;
```

Better:

```java
private final String externalId;
```

### 18.3 Use builder as map key

Buruk:

```java
Map<StringBuilder, Data> map = new HashMap<>();
```

Better:

```java
Map<String, Data> map = new HashMap<>();
```

### 18.4 Overuse `StringBuffer`

Buruk:

```java
StringBuffer sb = new StringBuffer(); // local variable only
```

Better:

```java
StringBuilder sb = new StringBuilder();
```

### 18.5 Manual escaping everywhere

Buruk:

```java
sb.append("<tag>").append(value).append("</tag>");
```

Better:

- XML writer/DOM serializer;
- JSON serializer;
- SQL prepared statement;
- template engine dengan escaping context-aware.

### 18.6 Eager diagnostic string

Buruk:

```java
log.trace(buildVeryLargeTraceMessage(model));
```

Better:

```java
if (log.isTraceEnabled()) {
    log.trace(buildVeryLargeTraceMessage(model));
}
```

---

## 19. Java 8 hingga Java 25: Evolusi yang Relevan

### 19.1 Java 8 baseline

Pada Java 8:

- `StringBuilder` dan `StringBuffer` sudah matang;
- `CharSequence` sudah punya default methods `chars()` dan `codePoints()`;
- `StringJoiner` diperkenalkan di Java 8;
- stream `Collectors.joining` tersedia;
- lambda membuat text transformation pipeline lebih umum.

### 19.2 Java 9

Java 9 penting karena:

- module system memindahkan diskusi ke `java.base` boundary;
- JEP 280 mengubah string concatenation bytecode strategy menjadi `invokedynamic`;
- compact strings dari part sebelumnya memengaruhi memory representation `String`, walau builder contract tetap di level character sequence.

### 19.3 Java 11+

String API bertambah seperti `isBlank`, `lines`, `strip`, `repeat`, yang sering mengurangi kebutuhan builder untuk operasi sederhana.

### 19.4 Java 15+

Text blocks membuat multiline string lebih readable, sehingga builder tidak perlu dipakai hanya untuk membuat literal multiline.

```java
String template = """
        Dear %s,

        Your case %s has been updated.
        """;
```

Tetapi untuk dynamic repeated construction, builder/joiner/writer tetap relevan.

### 19.5 Java 21–25

Di Java modern, prinsipnya:

- jangan micro-optimize concatenation sederhana;
- gunakan API yang paling mengekspresikan intent;
- builder tetap penting untuk loop/conditional/large output;
- boundary immutability makin penting karena virtual threads/concurrent workloads membuat hidden mutable state makin berisiko;
- observability/logging harus lazy dan bounded.

---

## 20. Performance Reasoning

### 20.1 Jangan benchmark dengan intuisi

Aturan kasar:

```text
Single expression        -> use +
Loop append              -> use StringBuilder
Delimited collection     -> use String.join / Collectors.joining / StringJoiner
Large streaming output   -> use Writer / Appendable
Legacy synchronized need -> StringBuffer
```

Tetapi performance nyata dipengaruhi:

- JDK version;
- JIT compilation;
- escape analysis;
- allocation rate;
- branch prediction;
- log level;
- output size distribution;
- GC;
- compact string representation;
- framework behavior.

### 20.2 Escape analysis

Local `StringBuilder` kadang dapat dioptimalkan oleh JIT jika tidak escape. Tetapi jangan mendesain correctness berdasarkan asumsi optimisasi.

```java
String f(String a, String b) {
    return a + b;
}
```

Runtime bisa sangat optimal. Tetapi:

```java
StringBuilder builder = new StringBuilder();
this.lastBuilder = builder; // escapes
```

Begitu object escape, optimisasi lebih terbatas dan risiko mutability muncul.

### 20.3 Initial capacity

Gunakan initial capacity ketika estimasi masuk akal:

```java
StringBuilder sb = new StringBuilder(rows.size() * 64);
```

Jangan lakukan:

```java
StringBuilder sb = new StringBuilder(Integer.MAX_VALUE);
```

Atau over-estimate besar untuk request kecil. Lebih baik estimasi konservatif.

### 20.4 `trimToSize`

`trimToSize()` dapat mengurangi memory internal buffer, tapi bisa menyebabkan copy. Biasanya tidak perlu untuk builder lokal yang segera dibuang.

Masuk akal jika:

- builder disimpan lama;
- capacity sempat besar;
- kamu benar-benar harus retain builder;
- profiling menunjukkan retained buffer besar.

Tetapi sering lebih baik tidak menyimpan builder sama sekali.

---

## 21. Production Checklist

Sebelum memakai text construction di production, tanyakan:

### 21.1 Boundary

- Apakah hasil akhir perlu immutable? Jika iya, gunakan `String`.
- Apakah input `CharSequence` disimpan? Jika iya, copy ke `String`.
- Apakah value dipakai sebagai key? Jika iya, gunakan normalized immutable `String`.
- Apakah builder keluar dari method? Jika iya, kemungkinan desain buruk.

### 21.2 Correctness

- Apakah delimiter handling benar untuk empty list?
- Apakah null handling eksplisit?
- Apakah Unicode indexing aman?
- Apakah text harus locale-aware?
- Apakah equality berdasarkan content atau identity?

### 21.3 Security

- Apakah output masuk SQL/XML/HTML/JSON/shell?
- Apakah escaping context-aware?
- Apakah ada secret/PII di diagnostic string?
- Apakah logging bounded?

### 21.4 Performance

- Apakah string dibangun dalam loop?
- Apakah output bisa sangat besar?
- Apakah log message dibangun saat log disabled?
- Apakah builder reuse menahan buffer besar?
- Apakah initial capacity masuk akal?

### 21.5 Concurrency

- Apakah builder shared antar thread?
- Apakah ThreadLocal builder benar-benar perlu?
- Apakah `StringBuffer` method-level sync cukup untuk invariant?
- Apakah mutable `CharSequence` bocor ke object lain?

---

## 22. Latihan / Thought Exercise

### Exercise 1 — API boundary

Evaluasi API berikut:

```java
public final class CaseReference {
    private final CharSequence value;

    public CaseReference(CharSequence value) {
        this.value = value;
    }

    public CharSequence value() {
        return value;
    }
}
```

Pertanyaan:

1. Apa bug mutability yang mungkin terjadi?
2. Apa risiko jika digunakan sebagai cache key?
3. Bagaimana desain yang lebih aman?

Jawaban yang diharapkan:

- simpan sebagai `String`;
- validate null/blank/format;
- return `String`;
- canonicalize jika perlu.

### Exercise 2 — Loop concatenation

Refactor:

```java
String output = "";
for (Order order : orders) {
    output += order.id() + ":" + order.status() + "\n";
}
```

Versi 1: gunakan `StringBuilder`.  
Versi 2: gunakan `Writer` jika output bisa besar.  
Versi 3: gunakan stream joining jika collection kecil dan readability lebih penting.

### Exercise 3 — Safe logging

Evaluasi:

```java
log.debug("case=" + caseObject.toDetailedJson());
```

Pertanyaan:

1. Apa yang terjadi saat debug disabled?
2. Apa risiko PII?
3. Bagaimana membuatnya lazy dan bounded?

### Exercise 4 — Unicode deletion

Kenapa kode ini berbahaya?

```java
StringBuilder sb = new StringBuilder("😄abc");
sb.deleteCharAt(0);
```

Refactor agar menghapus code point pertama secara aman.

### Exercise 5 — `StringBuffer` invariant

Apakah kode ini aman?

```java
if (buffer.length() < max) {
    buffer.append(value);
}
```

Jawab:

- method individual synchronized jika `StringBuffer`, tetapi check-then-act tidak atomic;
- butuh external synchronization atau desain tanpa shared mutable buffer.

---

## 23. Ringkasan

`StringBuilder`, `StringBuffer`, dan `CharSequence` bukan sekadar “cara membuat string”. Mereka adalah bagian dari kontrak text construction di Java.

Inti mental model:

```text
String       = immutable final text value
CharSequence = weak readable sequence contract, not immutability
StringBuilder = local mutable construction buffer
StringBuffer  = synchronized legacy mutable buffer
Appendable    = output target abstraction
StringJoiner  = delimiter-aware construction helper
```

Prinsip yang harus dibawa ke production:

1. Gunakan `+` untuk concatenation sederhana yang readable.
2. Gunakan `StringBuilder` untuk loop/conditional construction lokal.
3. Gunakan `StringJoiner`, `String.join`, atau `Collectors.joining` untuk delimiter.
4. Gunakan `Writer`/`Appendable` untuk output besar.
5. Jangan simpan mutable `CharSequence` di domain object.
6. Jangan gunakan builder sebagai map key.
7. Jangan menganggap `StringBuffer` menyelesaikan semua concurrency problem.
8. Jangan membangun SQL/XML/HTML/JSON/shell command manual tanpa escaping/parameterization yang benar.
9. Jangan membangun diagnostic/log string mahal saat tidak diperlukan.
10. Selalu ubah ke `String` pada boundary yang membutuhkan value semantics.

Dengan memahami part ini, kamu mulai melihat bahwa API kecil di `java.lang` membawa konsekuensi desain besar: immutability, mutability, ownership, allocation, thread-safety, boundary safety, dan security.

---

## 24. Referensi Resmi

- Java SE 25 API — `java.lang.CharSequence`
- Java SE 25 API — `java.lang.StringBuilder`
- Java SE 25 API — `java.lang.StringBuffer`
- Java SE 25 API — `java.lang.String`
- Java SE 8 API — `java.lang.StringBuilder` sebagai baseline kompatibilitas
- OpenJDK JEP 280 — Indify String Concatenation

---

## 25. Status Seri

Progress saat ini:

```text
Part 0  selesai — Orientation
Part 1  selesai — java.lang as Platform Root Contract
Part 2  selesai — Object
Part 3  selesai — Class<T>
Part 4  selesai — String
Part 5  selesai — CharSequence, StringBuilder, StringBuffer, Text Construction
Part 6  berikutnya — Primitive Wrappers, Boxing, Caches, Numeric Semantics
```

Seri belum selesai. Masih ada banyak bagian penting sampai Part 32.
