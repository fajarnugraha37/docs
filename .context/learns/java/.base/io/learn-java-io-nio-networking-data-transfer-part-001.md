# Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-001.md`  
> Status: Part 001 dari 030 — seri belum selesai

---

## 0. Tujuan Pembelajaran

Part ini membahas salah satu sumber bug paling mahal dalam sistem Java: **salah memahami batas antara byte, character, encoding, charset, text, dan binary data**.

Di level surface, topik ini terlihat sederhana:

```java
String text = Files.readString(path);
```

atau:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

Namun di sistem production, kesalahan kecil pada boundary ini bisa menghasilkan:

- file corrupt;
- data ekspor/impor rusak;
- nama orang berubah;
- karakter non-ASCII hilang;
- CSV gagal diparse;
- JSON invalid;
- payload HTTP salah decode;
- log tidak bisa dianalisis;
- checksum mismatch;
- signature mismatch;
- compression/decompression terlihat gagal padahal root cause-nya encoding;
- message broker payload tidak interoperable;
- bug hanya muncul di Windows, Linux, container, atau environment tertentu;
- bug hanya muncul untuk bahasa tertentu, emoji, simbol mata uang, atau data copy-paste dari Office/Excel/browser.

Target akhir part ini bukan sekadar tahu bahwa “Java pakai Unicode” atau “UTF-8 itu bagus”. Targetnya adalah punya mental model yang cukup kuat untuk menjawab:

1. Data ini sebenarnya **byte** atau **text**?
2. Kapan kita boleh mengubah byte menjadi `String`?
3. Charset mana yang sedang dipakai?
4. Apakah boundary-nya aman untuk streaming/chunking?
5. Apa yang terjadi jika input malformed?
6. Apakah operasi ini deterministic lintas OS dan lintas versi Java?
7. Apakah ini aman untuk audit, signature, checksum, dan data transfer?

---

## 1. Mental Model Utama: Byte adalah Fakta, Character adalah Interpretasi

Dalam I/O, aturan paling penting adalah:

> **Byte adalah data fisik yang lewat storage/network. Character adalah hasil interpretasi byte memakai encoding tertentu.**

File, socket, HTTP body, database BLOB, ZIP entry, Kafka payload, S3 object, dan TCP stream pada akhirnya membawa **byte**. Komputer tidak menyimpan “huruf A” sebagai konsep linguistik; komputer menyimpan angka-angka byte.

Text muncul hanya ketika byte tersebut diinterpretasikan menggunakan charset tertentu.

Contoh:

```text
Byte sequence: 48 65 6C 6C 6F
Charset: UTF-8
Text: Hello
```

Tetapi byte yang sama atau mirip bisa memiliki arti berbeda jika charset berbeda.

Contoh konseptual:

```text
Byte 0xE9
ISO-8859-1  -> é
UTF-8       -> invalid jika berdiri sendiri
Windows-1252 -> é
```

Jadi, pertanyaan “isi file ini apa?” tidak lengkap. Pertanyaan yang benar:

> **Byte file ini harus didecode dengan charset apa untuk menjadi text yang benar?**

Jika charset tidak diketahui, maka kita belum punya informasi lengkap.

---

## 2. Model Lapisan: Storage/Transport Tidak Peduli Text

Bayangkan data transfer sebagai beberapa lapisan:

```text
[Domain Meaning]
    ↓
[Text Representation: JSON, CSV, XML, log line, properties]
    ↓ encode(charset)
[Byte Representation]
    ↓ optional transform: compress, encrypt, frame, checksum
[Storage/Transport: file, socket, HTTP body, message broker]
```

Saat membaca:

```text
[Storage/Transport]
    ↓ read bytes
[Byte Representation]
    ↓ optional inverse transform: decrypt, decompress, deframe
[Text Representation]
    ↓ decode(charset)
[Domain Meaning]
```

Bug sering terjadi ketika urutan ini dilanggar.

Contoh bug:

```text
compress(text.getBytes(defaultCharset))
```

lalu di mesin lain:

```text
decompress(bytes) -> new String(bytes, differentDefaultCharset)
```

Secara visual, pipeline-nya terlihat benar, tetapi sebenarnya tidak deterministic karena default charset bisa menjadi asumsi tersembunyi.

---

## 3. Terminologi yang Harus Dibedakan

### 3.1 Byte

Byte adalah unit 8-bit. Java merepresentasikan byte dengan tipe `byte`, tetapi Java `byte` bersifat signed dari `-128` sampai `127`. Untuk I/O, signedness ini biasanya tidak penting karena bit pattern-nya tetap sama.

Contoh:

```java
byte b = (byte) 0xFF;      // nilainya -1 secara signed
int unsigned = b & 0xFF;   // 255
```

Saat debugging binary data, sering kali kita perlu menampilkan byte sebagai unsigned hex.

```java
static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 3);
    for (byte b : bytes) {
        sb.append(String.format("%02X ", b & 0xFF));
    }
    return sb.toString().trim();
}
```

### 3.2 Character

“Character” dalam percakapan manusia berarti simbol/huruf. Tetapi dalam Java, istilah ini perlu hati-hati:

- `char` adalah **16-bit UTF-16 code unit**;
- satu Unicode code point bisa butuh satu atau dua `char`;
- satu grapheme yang terlihat sebagai satu karakter di layar bisa terdiri dari beberapa code point.

Jadi, `char` Java bukan selalu “satu karakter manusia”.

### 3.3 Code Unit

Code unit adalah unit storage internal dari suatu encoding.

Untuk Java `String`, code unit-nya adalah 16-bit UTF-16 unit.

Contoh:

```java
String s = "A";
System.out.println(s.length()); // 1
```

Tetapi untuk emoji:

```java
String s = "🙂";
System.out.println(s.length());      // 2, karena surrogate pair
System.out.println(s.codePointCount(0, s.length())); // 1
```

### 3.4 Code Point

Code point adalah nomor abstrak di Unicode, misalnya:

```text
U+0041 -> LATIN CAPITAL LETTER A
U+20AC -> EURO SIGN
U+1F642 -> SLIGHTLY SMILING FACE
```

Code point lebih dekat ke konsep “karakter Unicode” daripada `char`, tetapi bahkan code point belum tentu sama dengan satu glyph yang terlihat.

### 3.5 Grapheme Cluster

Grapheme cluster adalah unit yang biasanya terlihat sebagai satu karakter oleh user.

Contoh konseptual:

```text
é
```

Bisa direpresentasikan sebagai:

```text
U+00E9                    // precomposed: é
U+0065 U+0301             // e + combining acute accent
```

Keduanya bisa terlihat sama, tetapi byte dan code point sequence-nya berbeda.

Dampaknya:

- panjang text secara visual tidak sama dengan `String.length()`;
- substring bisa memotong combining mark;
- normalisasi penting untuk search, compare, indexing, dan signature;
- checksum/signature atas text harus dilakukan pada byte canonical yang disepakati, bukan pada “tampilan”.

### 3.6 Encoding

Encoding adalah aturan untuk mengubah character/code point/code unit menjadi byte.

Contoh encoding:

- UTF-8;
- UTF-16BE;
- UTF-16LE;
- ISO-8859-1;
- Windows-1252;
- US-ASCII.

### 3.7 Charset

Dalam Java, `Charset` adalah mapping bernama antara sequence Unicode code unit dan sequence byte. `Charset` menyediakan encoder dan decoder.

Contoh:

```java
Charset utf8 = StandardCharsets.UTF_8;
CharsetDecoder decoder = utf8.newDecoder();
CharsetEncoder encoder = utf8.newEncoder();
```

Java menyediakan `StandardCharsets` untuk charset standar yang guaranteed tersedia di semua implementasi Java platform, seperti `UTF_8`, `UTF_16`, `UTF_16BE`, `UTF_16LE`, `ISO_8859_1`, dan `US_ASCII`.

---

## 4. Java `String`: Bukan Byte Array, Bukan Array of Human Characters

### 4.1 `String` adalah Sequence of `char`/UTF-16 Code Units

Java `String` merepresentasikan character string. Secara API, ia menyediakan operasi berbasis `char` dan juga operasi berbasis code point.

Contoh:

```java
String s = "A🙂B";

System.out.println(s.length());                       // 4 char/code units
System.out.println(s.codePointCount(0, s.length()));   // 3 code points
```

Kenapa `length()` adalah 4?

```text
A     -> 1 UTF-16 code unit
🙂    -> 2 UTF-16 code units, surrogate pair
B     -> 1 UTF-16 code unit
Total -> 4
```

### 4.2 Jangan Memakai `length()` untuk Ukuran Byte

```java
String text = "é";

System.out.println(text.length()); // 1
System.out.println(text.getBytes(StandardCharsets.UTF_8).length); // 2
System.out.println(text.getBytes(StandardCharsets.ISO_8859_1).length); // 1
```

`String.length()` adalah jumlah UTF-16 code unit, bukan ukuran byte, bukan jumlah code point, dan bukan jumlah karakter visual.

Dampaknya ke production:

- validasi “maksimal 255 karakter” berbeda dari “maksimal 255 byte”;
- database column byte-length bisa overflow walaupun `String.length()` terlihat aman;
- fixed-width file format bisa rusak;
- protocol dengan max payload byte harus dihitung setelah encoding;
- signature/checksum harus dilakukan pada byte final, bukan panjang `String`.

### 4.3 Jangan Slice Text Sembarangan Jika Boundary adalah Byte

Misal kita mau mengirim payload maksimal 10 byte per chunk.

Salah:

```java
String chunk = text.substring(0, 10); // 10 char, bukan 10 byte
byte[] bytes = chunk.getBytes(StandardCharsets.UTF_8);
```

Jika text berisi non-ASCII, ukuran byte bisa lebih dari 10.

Lebih buruk lagi, jika kita memotong byte array langsung lalu decode:

```java
byte[] utf8 = text.getBytes(StandardCharsets.UTF_8);
byte[] first10 = Arrays.copyOfRange(utf8, 0, 10);
String broken = new String(first10, StandardCharsets.UTF_8);
```

Jika byte ke-10 berada di tengah sequence UTF-8 multi-byte, hasilnya bisa malformed atau replacement character.

---

## 5. UTF-8: Default Modern, Tetapi Jangan Jadikan Alasan untuk Ceroboh

Mulai JDK 18, Java menstandarkan UTF-8 sebagai default charset untuk standard Java APIs, kecuali area tertentu seperti console I/O. Perubahan ini berasal dari JEP 400, yang bertujuan membuat program Java lebih predictable dan portable ketika API bergantung pada default charset.

Ini memperbaiki banyak masalah lama, khususnya di Windows atau locale non-UTF-8. Namun aturan engineering yang baik tetap:

> **Untuk boundary eksternal, selalu eksplisitkan charset.**

Kenapa tetap eksplisit?

1. Code lebih jelas untuk reviewer.
2. Aman saat backport ke Java lama.
3. Aman saat berinteraksi dengan sistem legacy.
4. Aman saat format file mensyaratkan charset tertentu.
5. Menghindari asumsi ketika membaca code.
6. Beberapa API/area masih punya behavior khusus.
7. Untuk audit dan compliance, explicit contract lebih defensible.

Baik:

```java
String text = Files.readString(path, StandardCharsets.UTF_8);
```

Kurang baik untuk boundary serius:

```java
String text = Files.readString(path); // UTF-8 modern, tapi contract tidak terlihat eksplisit
```

Buruk untuk interoperability:

```java
String text = new String(bytes); // implicit default charset
byte[] out = text.getBytes();    // implicit default charset
```

---

## 6. UTF-8, UTF-16, ISO-8859-1, Windows-1252: Perbedaan Praktis

### 6.1 US-ASCII

- 7-bit.
- Mencakup karakter English dasar.
- Byte `0x00` sampai `0x7F`.
- Tidak bisa merepresentasikan banyak karakter dunia.

Jika sistem mengklaim ASCII tetapi menerima “é”, “€” atau emoji, ada mismatch contract.

### 6.2 ISO-8859-1

- 8-bit single-byte charset.
- Semua byte `0x00` sampai `0xFF` valid.
- Tidak ada invalid byte sequence.
- Tidak mendukung banyak simbol modern.

Catatan penting:

```java
byte[] bytes = text.getBytes(StandardCharsets.ISO_8859_1);
```

Jika text mengandung karakter yang tidak bisa direpresentasikan, default encoder bisa mengganti karakter tersebut, misalnya menjadi `?`, kecuali kita memakai `CharsetEncoder` dengan error action `REPORT`.

### 6.3 Windows-1252

- Mirip ISO-8859-1 di banyak area, tapi berbeda pada rentang tertentu.
- Banyak file legacy Windows/Excel sebenarnya Windows-1252, bukan ISO-8859-1.
- Simbol seperti smart quote dan euro sign sering jadi sumber bug.

Contoh bug umum:

```text
File diklaim ISO-8859-1, tetapi sebenarnya Windows-1252.
```

Akibatnya:

- karakter kutip melengkung rusak;
- simbol euro rusak;
- parsing masih “berhasil”, tapi data semantik salah.

### 6.4 UTF-8

- Variable-length encoding.
- ASCII kompatibel untuk byte `0x00` sampai `0x7F`.
- Code point di luar ASCII memakai multi-byte sequence.
- Dominan untuk web, JSON, API, file modern, dan interoperability.

Contoh ukuran:

```text
A     -> 1 byte in UTF-8
é     -> 2 bytes in UTF-8
€     -> 3 bytes in UTF-8
🙂    -> 4 bytes in UTF-8
```

### 6.5 UTF-16

- Menggunakan 16-bit code units.
- Code point di luar BMP memakai surrogate pair.
- Punya variasi byte order: big-endian dan little-endian.
- BOM dapat dipakai untuk menandai byte order.

UTF-16 sering muncul pada Windows ecosystem, beberapa file export lama, atau internal representation. Namun untuk file/API modern, UTF-8 biasanya lebih interoperable.

---

## 7. BOM: Byte Order Mark dan Efeknya

BOM adalah marker di awal byte stream.

Contoh umum:

```text
UTF-8 BOM     : EF BB BF
UTF-16BE BOM  : FE FF
UTF-16LE BOM  : FF FE
```

Masalah praktis:

1. UTF-8 tidak membutuhkan BOM, tapi beberapa tool menuliskannya.
2. Jika parser tidak menghapus BOM, field pertama bisa mengandung karakter tersembunyi.
3. CSV header bisa menjadi `"\uFEFFid"`, bukan `"id"`.
4. Properties/config bisa gagal match key.
5. Signature/checksum berubah jika BOM ada/tidak ada.

Contoh defensive handling untuk text file UTF-8 yang mungkin memiliki BOM:

```java
static String stripUtf8BomIfPresent(String s) {
    if (!s.isEmpty() && s.charAt(0) == '\uFEFF') {
        return s.substring(1);
    }
    return s;
}
```

Namun jangan strip BOM sembarangan di semua tempat. BOM adalah bagian dari byte content. Untuk format tertentu, keberadaannya harus mengikuti spesifikasi format.

---

## 8. Boundary Utama dalam Java I/O

### 8.1 Boundary Byte → Character

Terjadi saat decoding.

Contoh:

```java
String text = new String(bytes, StandardCharsets.UTF_8);
```

atau:

```java
Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8);
```

Pertanyaan wajib:

- Charset-nya apa?
- Apa yang terjadi kalau byte malformed?
- Apakah decoder mengganti karakter rusak diam-diam?
- Apakah input boleh mengandung BOM?
- Apakah stream bisa dipotong di tengah multi-byte sequence?

### 8.2 Boundary Character → Byte

Terjadi saat encoding.

Contoh:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

atau:

```java
Writer writer = new OutputStreamWriter(outputStream, StandardCharsets.UTF_8);
```

Pertanyaan wajib:

- Charset output-nya apa?
- Apakah semua karakter bisa direpresentasikan?
- Apa yang terjadi untuk unmappable character?
- Apakah perlu newline normalization?
- Apakah perlu BOM?
- Apakah downstream mengharapkan UTF-8, UTF-16LE, Windows-1252, atau lainnya?

### 8.3 Boundary Text → Domain Object

Contoh:

```text
bytes -> UTF-8 String -> JSON object
```

Kesalahan umum:

- menganggap JSON parser yang gagal berarti JSON salah, padahal byte decode salah;
- menganggap CSV parser salah, padahal delimiter/quote rusak karena charset mismatch;
- menganggap business validation salah, padahal ada hidden BOM atau non-breaking space.

### 8.4 Boundary Domain Object → Text

Contoh:

```text
object -> JSON String -> UTF-8 bytes
```

Kesalahan umum:

- serialization library default berbeda;
- escaping berubah;
- normalisasi Unicode tidak konsisten;
- field order berubah sehingga signature berubah;
- newline berubah sehingga checksum berubah.

### 8.5 Boundary Byte → Transform Byte

Contoh:

```text
UTF-8 bytes -> gzip bytes -> encrypted bytes
```

Compression dan encryption tidak tahu text. Mereka memproses byte.

Jangan lakukan:

```java
String compressedAsString = new String(gzipBytes, StandardCharsets.UTF_8); // salah konsep
```

Binary data bukan text. Jika harus direpresentasikan sebagai text, pakai encoding binary-to-text seperti Base64 atau hex.

---

## 9. Reader/Writer vs InputStream/OutputStream

### 9.1 Gunakan Stream untuk Byte/Binary

Gunakan `InputStream`/`OutputStream` untuk:

- image;
- PDF;
- ZIP;
- gzip;
- encrypted payload;
- protobuf;
- avro binary;
- arbitrary upload/download;
- checksum;
- signature;
- file copy;
- socket raw protocol;
- compressed archive;
- data yang charset-nya belum diketahui.

Contoh:

```java
try (InputStream in = Files.newInputStream(path)) {
    byte[] buffer = new byte[8192];
    int n;
    while ((n = in.read(buffer)) != -1) {
        // process bytes
    }
}
```

### 9.2 Gunakan Reader/Writer untuk Text yang Charset-nya Sudah Diketahui

Gunakan `Reader`/`Writer` jika data memang text.

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        // process text line
    }
}
```

### 9.3 Bridge: InputStreamReader dan OutputStreamWriter

`InputStreamReader` adalah bridge dari byte stream ke character stream. Ia membaca byte lalu decode menjadi character menggunakan charset tertentu.

```java
try (Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8)) {
    // read characters
}
```

`OutputStreamWriter` adalah bridge dari character stream ke byte stream.

```java
try (Writer writer = new OutputStreamWriter(outputStream, StandardCharsets.UTF_8)) {
    writer.write("hello");
}
```

### 9.4 Rule of Thumb

```text
Belum tahu charset? Tetap byte.
Sudah tahu charset dan format-nya text? Baru decode ke character.
Data binary? Jangan jadikan String.
Butuh checksum/signature? Hitung di byte final yang disepakati.
```

---

## 10. Default Charset: Kapan Berbahaya?

### 10.1 API yang Harus Diwaspadai

Waspadai API tanpa charset eksplisit:

```java
new String(bytes)
text.getBytes()
new InputStreamReader(inputStream)
new OutputStreamWriter(outputStream)
new FileReader(file)
new FileWriter(file)
Scanner(inputStream)
Formatter(file)
PrintWriter(file)
```

Di Java modern, default charset standard API adalah UTF-8, tetapi code seperti ini tetap menyembunyikan contract.

Lebih baik:

```java
new String(bytes, StandardCharsets.UTF_8)
text.getBytes(StandardCharsets.UTF_8)
new InputStreamReader(inputStream, StandardCharsets.UTF_8)
new OutputStreamWriter(outputStream, StandardCharsets.UTF_8)
Files.newBufferedReader(path, StandardCharsets.UTF_8)
Files.newBufferedWriter(path, StandardCharsets.UTF_8)
```

### 10.2 Legacy Migration Trap

Skenario:

- aplikasi lama berjalan di Java 8/11/17 pada Windows;
- default charset adalah Windows code page;
- upgrade ke Java 21;
- default charset menjadi UTF-8;
- file legacy tetap Windows-1252;
- code memakai `new String(bytes)`.

Akibat:

- hasil decode berubah;
- beberapa karakter menjadi replacement;
- test environment Linux lolos;
- production Windows atau data lama gagal.

Solusi:

- audit semua default charset usage;
- identifikasi external contract tiap file/API;
- eksplisitkan charset;
- tambahkan regression test dengan data non-ASCII;
- untuk file legacy, pakai charset legacy secara eksplisit.

---

## 11. Error Handling: Malformed vs Unmappable

### 11.1 Malformed Input

Malformed input terjadi saat byte sequence tidak valid untuk charset yang dipilih.

Contoh:

```text
Byte 0xE9 sendiri bukan valid UTF-8 sequence.
```

Jika didecode sebagai UTF-8, itu malformed.

### 11.2 Unmappable Character

Unmappable terjadi saat character tidak bisa di-encode ke charset target.

Contoh:

```java
String text = "hello 🙂";
byte[] ascii = text.getBytes(StandardCharsets.US_ASCII);
```

Emoji tidak bisa direpresentasikan di US-ASCII. Default behavior beberapa convenience API dapat mengganti dengan `?`.

### 11.3 Silent Replacement adalah Bahaya

Jika data kritikal, jangan biarkan replacement terjadi diam-diam.

Contoh risiko:

```text
Nama: José -> Jos?
Currency: € -> ?
Legal text: “quoted” -> ?quoted?
Identifier: AΩ -> A?
```

Untuk audit/legal/regulatory data, silent replacement bisa mengubah makna.

### 11.4 Pakai CharsetDecoder dengan REPORT

```java
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.*;

static String decodeUtf8Strict(byte[] bytes) throws CharacterCodingException {
    CharsetDecoder decoder = StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);

    CharBuffer chars = decoder.decode(ByteBuffer.wrap(bytes));
    return chars.toString();
}
```

Jika input invalid, method ini akan throw `CharacterCodingException` alih-alih mengganti data diam-diam.

### 11.5 Pakai CharsetEncoder dengan REPORT

```java
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.*;

static byte[] encodeAsciiStrict(String text) throws CharacterCodingException {
    CharsetEncoder encoder = StandardCharsets.US_ASCII
            .newEncoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);

    ByteBuffer buffer = encoder.encode(CharBuffer.wrap(text));
    byte[] out = new byte[buffer.remaining()];
    buffer.get(out);
    return out;
}
```

Untuk output ke sistem legacy, strict encoding lebih aman daripada mengirim data rusak.

---

## 12. Streaming Decode: Jangan Memotong Multi-Byte Sequence

### 12.1 Problem

UTF-8 variable-length. Satu character bisa memakai 1 sampai 4 byte. Jika membaca file/network per chunk, chunk boundary bisa jatuh di tengah character.

Contoh konseptual:

```text
🙂 in UTF-8 = F0 9F 99 82
```

Jika chunk pertama hanya berisi:

```text
F0 9F
```

itu belum cukup untuk decode. Decoder harus menunggu byte berikutnya.

### 12.2 Anti-Pattern

```java
byte[] buffer = new byte[4];
int n;
while ((n = in.read(buffer)) != -1) {
    String s = new String(buffer, 0, n, StandardCharsets.UTF_8);
    process(s);
}
```

Ini terlihat masuk akal tetapi salah untuk UTF-8 streaming karena tiap chunk didecode independen. Jika multi-byte sequence terpotong antar chunk, decoder tidak membawa state.

### 12.3 Solusi Sederhana: Gunakan Reader

```java
try (Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
    char[] chars = new char[4096];
    int n;
    while ((n = reader.read(chars)) != -1) {
        process(chars, 0, n);
    }
}
```

`InputStreamReader` menyimpan state decoder antar read.

### 12.4 Solusi NIO: Gunakan CharsetDecoder Stateful

Untuk part NIO nanti kita akan lebih detail. Intinya, decoder harus diberi kesempatan menjaga state antar `decode()` call.

Skeleton konseptual:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);

ByteBuffer in = ByteBuffer.allocate(8192);
CharBuffer out = CharBuffer.allocate(8192);

// read bytes into ByteBuffer, flip, decode, compact, repeat
```

Kuncinya:

- jangan decode setiap chunk dengan `new String(...)` secara independen;
- pertahankan undecoded tail bytes;
- panggil decoder dengan end-of-input yang benar;
- tangani `CoderResult.UNDERFLOW`, `OVERFLOW`, dan error.

---

## 13. Line Processing: Baris Bukan Sekadar `\n`

### 13.1 Newline Variants

Text file bisa memakai:

```text
LF    \n      Unix/Linux/macOS modern
CRLF  \r\n    Windows / many network protocols
CR    \r      legacy Mac
```

`BufferedReader.readLine()` membaca satu line tanpa menyertakan line terminator. Ia mengenali beberapa line terminator, tetapi output line-nya tidak menyimpan newline asli.

Implikasi:

- baik untuk logical line processing;
- tidak cocok jika harus mempertahankan byte-exact file;
- checksum/signature akan berubah jika file ditulis ulang dengan newline berbeda;
- protocol tertentu mensyaratkan CRLF, misalnya banyak format network text protocol.

### 13.2 Jangan Pakai Line-Based Reader untuk Binary Protocol

Binary payload bisa berisi byte `0x0A` yang terlihat seperti newline. Jika data bukan text line protocol, jangan baca dengan `BufferedReader.readLine()`.

### 13.3 Line Length Attack

`readLine()` bisa membaca line sangat panjang dan menyebabkan memory pressure.

Untuk input untrusted, tambahkan batas ukuran:

```java
static String readLineBounded(Reader reader, int maxChars) throws IOException {
    StringBuilder sb = new StringBuilder(Math.min(maxChars, 1024));
    int c;
    while ((c = reader.read()) != -1) {
        if (c == '\n') {
            break;
        }
        if (c == '\r') {
            // Simplified: real implementation may need to handle following \n.
            break;
        }
        if (sb.length() >= maxChars) {
            throw new IOException("Line too long: max " + maxChars + " chars");
        }
        sb.append((char) c);
    }
    if (c == -1 && sb.isEmpty()) {
        return null;
    }
    return sb.toString();
}
```

Catatan: batas character belum tentu batas byte. Untuk network defense biasanya batas byte lebih penting.

---

## 14. CSV, JSON, XML, Properties, dan Log: Semua Punya Boundary Sendiri

### 14.1 JSON

JSON modern hampir selalu UTF-8 di HTTP/API boundary, tetapi jangan mencampur asumsi:

```text
HTTP Content-Type: application/json; charset=UTF-8
Body bytes: UTF-8 JSON
Parser: decode correctly
```

Masalah umum:

- body didecode sebagai default charset;
- header charset diabaikan;
- upstream mengirim UTF-16 JSON;
- signature dihitung atas string setelah pretty print, bukan byte original;
- log menyimpan JSON yang sudah rusak karena decode lebih awal.

### 14.2 CSV

CSV lebih berbahaya karena sering datang dari Excel, legacy system, atau vendor.

Pertanyaan wajib:

- charset apa?
- delimiter apa?
- quote char apa?
- escape rule apa?
- newline di dalam quoted field boleh atau tidak?
- BOM ada atau tidak?
- header exact atau perlu trim/normalisasi?
- file besar atau kecil?

CSV bug yang sering terjadi:

```text
Header sebenarnya: \uFEFFid,name
Code mencari: id
Hasil: kolom id tidak ditemukan
```

### 14.3 XML

XML bisa mendeklarasikan encoding di prolog:

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

Jika kita sudah decode bytes ke `String` dengan charset salah sebelum XML parser membaca prolog, parser tidak lagi bisa menyelamatkan data.

Untuk XML, lebih aman berikan `InputStream` ke parser agar parser dapat mendeteksi encoding sesuai aturan XML.

### 14.4 `.properties`

Historically, Java `.properties` punya aturan encoding yang spesifik dan legacy. API modern memiliki variasi reader/input stream yang berbeda semantics. Jangan asumsikan semua config file adalah UTF-8 kecuali format dan API-nya jelas.

### 14.5 Log

Log terlihat text, tetapi dalam distributed system log adalah data transfer juga.

Masalah umum:

- container log collector mengasumsikan UTF-8;
- aplikasi menulis non-UTF-8;
- stack trace tercampur binary payload;
- log injection via newline;
- invisible characters mengacaukan search;
- truncation memotong multi-byte UTF-8;
- PII leakage saat dump raw payload.

---

## 15. Normalisasi Unicode: Sama Terlihat, Belum Tentu Sama Byte

### 15.1 Contoh Masalah

Dua string bisa terlihat sama:

```text
é
```

Tetapi sequence-nya berbeda:

```text
U+00E9
U+0065 U+0301
```

Di Java:

```java
String a = "\u00E9";
String b = "e\u0301";

System.out.println(a.equals(b)); // false
System.out.println(a.length());  // 1
System.out.println(b.length());  // 2
```

### 15.2 Normalizer

Java menyediakan `java.text.Normalizer`.

```java
import java.text.Normalizer;

String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Bentuk umum:

- NFC: canonical composition;
- NFD: canonical decomposition;
- NFKC: compatibility composition;
- NFKD: compatibility decomposition.

### 15.3 Kapan Normalisasi Perlu?

Perlu dipertimbangkan untuk:

- search;
- deduplication;
- username comparison;
- filename comparison;
- regulatory name matching;
- indexing;
- canonical signature input jika format mengharuskan.

Namun normalisasi bisa mengubah byte representation dan kadang makna compatibility. Jangan normalisasi tanpa contract.

Rule:

```text
Normalize for comparison/search when business contract says so.
Do not normalize byte-exact payload silently.
```

---

## 16. Case Conversion dan Locale Trap

Walaupun part ini fokus I/O, text yang masuk dari I/O sering diproses dengan case conversion.

Anti-pattern:

```java
String key = input.toLowerCase();
```

Ini memakai default locale. Di beberapa locale, hasilnya bisa mengejutkan, misalnya Turkish dotted/dotless I.

Untuk protocol keys, enum names, header names, command names, gunakan locale independent:

```java
String key = input.toLowerCase(Locale.ROOT);
```

Ini penting untuk:

- HTTP header normalization;
- CSV header mapping;
- config key;
- command parser;
- file extension matching;
- canonicalization before signature.

---

## 17. Binary Data Tidak Boleh Dipaksa Menjadi String

### 17.1 Anti-Pattern

```java
String s = new String(binaryBytes, StandardCharsets.UTF_8);
byte[] restored = s.getBytes(StandardCharsets.UTF_8);
```

Ini tidak round-trip safe untuk arbitrary binary.

Jika binary bytes bukan valid UTF-8, decode bisa mengganti byte invalid dengan replacement character. Ketika encode lagi, byte original hilang.

### 17.2 Gunakan Base64 untuk Binary-to-Text

```java
import java.util.Base64;

String encoded = Base64.getEncoder().encodeToString(binaryBytes);
byte[] decoded = Base64.getDecoder().decode(encoded);
```

Gunakan Base64 untuk:

- embedding binary dalam JSON;
- token;
- email-safe transfer;
- log terbatas;
- config yang butuh representasi text.

Gunakan hex untuk:

- debugging;
- checksum;
- signature fingerprint;
- byte-level inspection.

### 17.3 Jangan Log Binary Raw

Jika harus log binary:

- batasi ukuran;
- gunakan hex/Base64;
- redact sensitive data;
- tambahkan length;
- jangan log full payload besar.

Contoh:

```java
static String previewHex(byte[] bytes, int max) {
    int n = Math.min(bytes.length, max);
    StringBuilder sb = new StringBuilder(n * 3 + 32);
    for (int i = 0; i < n; i++) {
        sb.append(String.format("%02X", bytes[i] & 0xFF));
        if (i + 1 < n) sb.append(' ');
    }
    if (bytes.length > max) {
        sb.append(" ... (total ").append(bytes.length).append(" bytes)");
    }
    return sb.toString();
}
```

---

## 18. Checksum, Hash, Signature: Harus atas Byte, Bukan String Ambigu

Checksum/hash/signature harus dihitung atas byte sequence yang jelas.

Salah:

```java
String payload = new String(bytes, StandardCharsets.UTF_8);
String normalized = payload.trim();
byte[] signed = normalized.getBytes();
```

Masalah:

- `trim()` mengubah content;
- charset implicit;
- newline bisa berubah;
- Unicode normalization tidak jelas;
- whitespace signifikan bisa hilang;
- byte original tidak lagi sama.

Benar untuk byte-exact signature:

```java
byte[] payloadBytes = Files.readAllBytes(path);
byte[] digest = sha256(payloadBytes);
```

Benar untuk canonical text signature:

```text
1. Decode dengan charset eksplisit.
2. Parse sesuai format.
3. Canonicalize sesuai spesifikasi.
4. Encode ulang dengan charset eksplisit.
5. Sign canonical bytes.
```

Kunci utamanya: canonicalization harus menjadi contract, bukan efek samping implementation.

---

## 19. HTTP Boundary: Header, Body, Charset, dan Content-Type

HTTP membawa body sebagai bytes. `Content-Type` dapat memberi tahu media type dan kadang charset.

Contoh:

```http
Content-Type: text/plain; charset=UTF-8
```

Untuk JSON:

```http
Content-Type: application/json
```

Dalam praktik modern, JSON biasanya UTF-8, tetapi tetap penting memahami boundary.

Kesalahan umum:

```java
String body = response.body(); // tergantung BodyHandler yang dipakai
```

Jika library sudah decode, pastikan decode rules-nya sesuai contract.

Untuk signature verification webhook, sering kali harus memakai raw body bytes, bukan body string hasil parsing.

Salah:

```java
String body = requestBodyAsString;
verifySignature(body.getBytes(StandardCharsets.UTF_8));
```

Benar:

```java
byte[] rawBody = requestBodyBytes;
verifySignature(rawBody);
```

Karena provider biasanya sign raw bytes yang dikirim.

---

## 20. Database Boundary: VARCHAR/CLOB/BLOB dan Encoding

Walaupun detail database bukan fokus part ini, Java I/O sering bertemu database.

Mental model:

- `VARCHAR`, `NVARCHAR`, `CLOB`, `NCLOB` adalah text-ish;
- `BLOB`, `RAW`, `BYTEA`, `VARBINARY` adalah binary;
- JDBC driver melakukan konversi sesuai database/session/client encoding;
- jangan simpan arbitrary binary ke text column dengan `new String(bytes)`;
- gunakan Base64 jika binary harus masuk text field, tetapi sadar overhead.

Bug umum:

- file PDF disimpan sebagai `String`;
- JSON bytes disimpan sebagai BLOB lalu dibaca sebagai text tanpa charset;
- text legacy encoding disimpan ke CLOB setelah decode salah;
- database length constraint dihitung char sementara downstream menghitung byte.

---

## 21. File Name Encoding dan Filesystem Boundary

Isi file dan nama file adalah dua hal berbeda.

Masalah:

- filesystem memiliki aturan encoding/normalization berbeda;
- macOS historically punya normalization behavior berbeda;
- Windows case-insensitive by default;
- Linux biasanya byte-oriented untuk filename, tetapi Java mengekspos sebagai `String`;
- filename dari ZIP/archive bisa membawa encoding sendiri;
- filename dari user bisa mengandung invisible characters.

Jangan menganggap:

```text
nama file terlihat sama -> path pasti sama
```

Untuk sistem serius:

- validasi karakter nama file;
- batasi panjang;
- normalisasi jika contract mengharuskan;
- jangan pakai raw user filename untuk path final;
- simpan original display name terpisah dari storage object key;
- hati-hati path traversal.

Path traversal akan dibahas lebih dalam di part security.

---

## 22. Practical Decision Matrix

| Situasi | Representasi yang Benar | API yang Disarankan | Catatan |
|---|---:|---|---|
| Copy file apa pun | byte | `Files.copy`, `InputStream`/`OutputStream`, `FileChannel` | Jangan decode |
| Baca text UTF-8 kecil | character | `Files.readString(path, UTF_8)` | Aman jika ukuran bounded |
| Baca text besar | character streaming | `Files.newBufferedReader(path, UTF_8)` | Hindari load-all |
| Baca binary upload | byte streaming | `InputStream` | Batasi size |
| Parse JSON dari HTTP | bytes → text → object | library/parser sesuai contract | Untuk signature, simpan raw bytes |
| Parse CSV vendor | bytes → text dengan charset eksplisit | `BufferedReader` + CSV parser | Waspadai BOM dan Excel encoding |
| Generate fixed-width file | text → bytes eksplisit | `OutputStreamWriter` + charset | Hitung byte length jika spec byte-based |
| Kirim binary dalam JSON | Base64 text | `Base64` | Jangan `new String(binary)` |
| Hash file | byte | `MessageDigest` over stream | Jangan hash `String` kecuali canonical |
| Decode untrusted UTF-8 | strict decoder | `CharsetDecoder` + `REPORT` | Jangan silent replacement |
| Legacy Windows file | text dengan charset legacy | `Charset.forName("windows-1252")` | Contract harus jelas |

---

## 23. Step-by-Step: Membaca Text File dengan Benar

### 23.1 Small Trusted UTF-8 Text File

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class SmallTextReadExample {
    public static String readConfig(Path path) throws IOException {
        return Files.readString(path, StandardCharsets.UTF_8);
    }
}
```

Cocok untuk:

- config kecil;
- test fixture;
- template kecil;
- file yang ukurannya bounded dan trusted.

Tidak cocok untuk:

- file upload besar;
- log besar;
- input untrusted tanpa size limit;
- data yang charset-nya belum diketahui.

### 23.2 Large UTF-8 Text File Line-by-Line

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class LargeTextReadExample {
    public static long countNonBlankLines(Path path) throws IOException {
        long count = 0;
        try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isBlank()) {
                    count++;
                }
            }
        }
        return count;
    }
}
```

Kelebihan:

- memory bounded;
- decoder state aman;
- resource tertutup;
- charset eksplisit.

### 23.3 Strict UTF-8 Read untuk Input Kritis

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.*;
import java.nio.file.Files;
import java.nio.file.Path;

public final class StrictUtf8FileReadExample {
    public static String readStrictUtf8(Path path) throws IOException {
        byte[] bytes = Files.readAllBytes(path);
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            CharBuffer chars = decoder.decode(ByteBuffer.wrap(bytes));
            return chars.toString();
        } catch (CharacterCodingException e) {
            throw new IOException("File is not valid UTF-8: " + path, e);
        }
    }
}
```

Catatan:

- ini load-all, hanya cocok untuk file bounded;
- untuk file besar, perlu strict streaming decoder;
- berguna untuk import file yang harus reject jika corrupt.

---

## 24. Step-by-Step: Menulis Text File dengan Benar

### 24.1 Simple UTF-8 Write

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class TextWriteExample {
    public static void writeReport(Path path, String content) throws IOException {
        Files.writeString(path, content, StandardCharsets.UTF_8);
    }
}
```

### 24.2 Streaming Write

```java
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public final class StreamingTextWriteExample {
    public static void writeLines(Path path, List<String> lines) throws IOException {
        try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
            for (String line : lines) {
                writer.write(line);
                writer.newLine();
            }
        }
    }
}
```

Catatan:

- `newLine()` memakai platform line separator;
- jika format mengharuskan `\n` atau `\r\n`, tulis eksplisit;
- untuk checksum/signature portable, newline harus disepakati.

### 24.3 Strict Encoding untuk Charset Terbatas

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.*;
import java.nio.file.Files;
import java.nio.file.Path;

public final class StrictLegacyEncodingWriteExample {
    public static void writeAsciiStrict(Path path, String content) throws IOException {
        CharsetEncoder encoder = StandardCharsets.US_ASCII.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            ByteBuffer buffer = encoder.encode(CharBuffer.wrap(content));
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);
            Files.write(path, bytes);
        } catch (CharacterCodingException e) {
            throw new IOException("Content cannot be represented as US-ASCII", e);
        }
    }
}
```

---

## 25. Designing a Text Boundary Contract

Saat mendesain file/API/message, tulis contract seperti ini:

```text
Payload type      : text
Format            : JSON Lines
Charset           : UTF-8
BOM               : not allowed
Line terminator   : LF (\n)
Max line size     : 1 MiB encoded bytes
Max file size     : 5 GiB
Malformed input   : reject entire file
Unicode normalize : no normalization during ingestion
Checksum          : SHA-256 over raw file bytes
Compression       : gzip before transfer, checksum over uncompressed raw bytes and compressed object bytes both recorded
```

Kenapa sedetail ini?

Karena tanpa contract, implementasi akan membuat asumsi berbeda.

Contoh pertanyaan yang harus terjawab:

- Jika ada BOM, reject atau strip?
- Jika ada invalid UTF-8, reject atau replace?
- Jika line terlalu panjang, reject line atau file?
- Jika ada CRLF, normalize atau preserve?
- Jika field mengandung emoji, valid atau tidak?
- Jika downstream legacy tidak bisa encode, reject atau transliterate?
- Jika checksum mismatch, retry atau quarantine?

---

## 26. Failure Model

### 26.1 Charset Mismatch

Gejala:

- karakter aneh;
- `�` replacement character;
- `MalformedInputException`;
- CSV header tidak match;
- nama user berubah;
- test lolos dengan ASCII tetapi gagal data real.

Root cause:

- producer dan consumer tidak sepakat charset;
- default charset implicit;
- file legacy;
- vendor documentation salah;
- Excel export bukan UTF-8.

Mitigasi:

- explicit charset;
- sample data non-ASCII;
- strict decoder;
- reject malformed;
- data contract.

### 26.2 Silent Data Loss

Gejala:

- `?` muncul;
- karakter hilang;
- field berubah tapi tidak error;
- audit tidak bisa menjelaskan perubahan.

Root cause:

- encoder replacement;
- decoder replacement;
- wrong charset yang tetap valid;
- normalization/trim tidak disengaja.

Mitigasi:

- `CodingErrorAction.REPORT`;
- validation before conversion;
- store raw bytes untuk audit jika perlu;
- compare checksum before/after.

### 26.3 Chunk Boundary Corruption

Gejala:

- hanya gagal untuk payload besar;
- hanya gagal untuk emoji/non-ASCII;
- replacement character muncul di sekitar chunk boundary;
- retry menghasilkan error berbeda.

Root cause:

- decode per chunk tanpa decoder state;
- potong byte di tengah UTF-8 sequence;
- framing byte-based tetapi parser text-based.

Mitigasi:

- use `Reader`;
- stateful `CharsetDecoder`;
- frame by byte but decode full frame;
- do not split text blindly.

### 26.4 Byte-Exact Contract Broken

Gejala:

- signature mismatch;
- checksum mismatch;
- webhook verification gagal;
- file yang ditulis ulang terlihat sama tapi hash beda.

Root cause:

- newline normalization;
- trim;
- pretty print;
- charset re-encoding;
- BOM added/removed;
- Unicode normalization;
- field order berubah.

Mitigasi:

- sign raw bytes;
- define canonicalization;
- preserve original bytes;
- test exact byte output.

### 26.5 Resource Exhaustion

Gejala:

- OOM;
- long GC pause;
- process killed;
- thread blocked;
- import stuck.

Root cause:

- `readAllBytes` untuk file besar;
- `readString` untuk upload besar;
- unbounded `readLine`;
- huge malformed payload;
- log raw payload besar.

Mitigasi:

- streaming;
- max byte limit;
- max line length;
- bounded buffer;
- backpressure;
- reject oversized input early.

---

## 27. Anti-Pattern Catalog

### Anti-Pattern 1 — `new String(bytes)` di Boundary Eksternal

```java
String text = new String(bytes);
```

Masalah:

- charset implicit;
- contract tidak terlihat;
- migration risk;
- data mismatch.

Gunakan:

```java
String text = new String(bytes, StandardCharsets.UTF_8);
```

Untuk input kritikal, gunakan strict decoder.

### Anti-Pattern 2 — `getBytes()` Tanpa Charset

```java
byte[] bytes = text.getBytes();
```

Gunakan:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

### Anti-Pattern 3 — Binary Data Jadi String

```java
String s = new String(fileBytes, StandardCharsets.UTF_8);
```

Jika file binary, ini salah. Gunakan byte stream. Jika perlu text representation, gunakan Base64/hex.

### Anti-Pattern 4 — Decode Per Chunk

```java
while ((n = in.read(buf)) != -1) {
    process(new String(buf, 0, n, StandardCharsets.UTF_8));
}
```

Gunakan `Reader` atau `CharsetDecoder` stateful.

### Anti-Pattern 5 — Menganggap `String.length()` adalah Panjang Karakter Manusia

```java
if (name.length() <= 10) { ... }
```

Tidak selalu salah, tetapi harus tahu contract-nya. Jika contract user-visible character, perlu grapheme-aware handling. Jika contract byte-size, encode dulu lalu hitung bytes.

### Anti-Pattern 6 — Menggunakan `trim()` untuk Data Canonical

```java
String canonical = input.trim();
```

`trim()` bisa mengubah data dan tidak menangani semua Unicode whitespace sesuai ekspektasi modern. Untuk protocol canonicalization, definisikan rule eksplisit.

### Anti-Pattern 7 — Mengabaikan BOM

```java
String firstHeader = headers[0];
if (firstHeader.equals("id")) { ... }
```

Jika header adalah `\uFEFFid`, match gagal.

### Anti-Pattern 8 — Mengandalkan Excel Export Tanpa Contract

Excel/export tools sering menghasilkan charset, delimiter, quote, newline, dan BOM yang berbeda tergantung environment. Treat as external untrusted format.

---

## 28. Production Pattern: Safe Text Ingestion Pipeline

Untuk sistem import file text dari external party:

```text
1. Receive file as bytes.
2. Store raw file bytes or immutable object reference for audit.
3. Enforce max file size.
4. Compute raw checksum.
5. Detect/validate expected charset.
6. Decode strictly.
7. Handle BOM based on contract.
8. Parse format.
9. Validate records.
10. Quarantine invalid file with reason.
11. Emit metrics and audit event.
12. Process records idempotently.
```

Contoh skeleton:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class SafeTextIngestion {
    private static final long MAX_BYTES = 100L * 1024 * 1024; // 100 MiB

    public static IngestedText ingestUtf8(Path file) throws IOException {
        long size = Files.size(file);
        if (size > MAX_BYTES) {
            throw new IOException("File too large: " + size + " bytes");
        }

        byte[] raw = Files.readAllBytes(file);
        String sha256 = sha256Hex(raw);
        String text = decodeUtf8Strict(raw);
        text = stripUtf8BomIfPresent(text);

        return new IngestedText(text, sha256, raw.length);
    }

    private static String decodeUtf8Strict(byte[] raw) throws IOException {
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            CharBuffer chars = decoder.decode(ByteBuffer.wrap(raw));
            return chars.toString();
        } catch (CharacterCodingException e) {
            throw new IOException("Invalid UTF-8 input", e);
        }
    }

    private static String stripUtf8BomIfPresent(String s) {
        if (!s.isEmpty() && s.charAt(0) == '\uFEFF') {
            return s.substring(1);
        }
        return s;
    }

    private static String sha256Hex(byte[] bytes) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 not available", e);
        }
    }

    public record IngestedText(String text, String rawSha256, int rawBytes) {}
}
```

Catatan:

- Skeleton ini load-all, cocok untuk batas 100 MiB jika memory budget aman.
- Untuk multi-GB ingestion, gunakan streaming approach.
- Audit menyimpan hash raw bytes, bukan hash text setelah transformasi.

---

## 29. Production Pattern: Safe Text Export Pipeline

Untuk export file text ke external party:

```text
1. Define output format and charset.
2. Validate all field values before writing.
3. Normalize only if contract says so.
4. Escape according to file format.
5. Encode with explicit charset.
6. Fail on unmappable characters if charset legacy.
7. Write to temp file.
8. Flush and close.
9. Compute checksum.
10. Atomically publish final file.
11. Emit manifest.
```

Contoh contract:

```text
Format: CSV
Charset: UTF-8
BOM: no
Newline: CRLF
Delimiter: comma
Quote: double quote
Checksum: SHA-256 over final file bytes
```

Contoh writer sederhana:

```java
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public final class CsvExportExample {
    public static void writeCsv(Path path, List<Row> rows) throws IOException {
        try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
            writer.write("id,name,amount");
            writer.write("\r\n");
            for (Row row : rows) {
                writer.write(csv(row.id()));
                writer.write(',');
                writer.write(csv(row.name()));
                writer.write(',');
                writer.write(csv(row.amount()));
                writer.write("\r\n");
            }
        }
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }
        boolean quote = value.indexOf(',') >= 0
                || value.indexOf('"') >= 0
                || value.indexOf('\r') >= 0
                || value.indexOf('\n') >= 0;
        String escaped = value.replace("\"", "\"\"");
        return quote ? "\"" + escaped + "\"" : escaped;
    }

    public record Row(String id, String name, String amount) {}
}
```

Catatan:

- Untuk production, gunakan CSV library matang.
- Contoh ini untuk memperlihatkan boundary charset/newline/escaping.
- Atomic file write akan dibahas mendalam di part NIO.2.

---

## 30. Testing Strategy untuk Encoding Bug

### 30.1 Jangan Test Hanya ASCII

ASCII sering membuat bug encoding tersembunyi.

Gunakan fixture:

```text
ASCII: Hello
Latin: José, München
Currency: €, £, ¥
CJK: 中文, 日本語, 한글
Emoji: 🙂 🚀
Combining: é
Smart quote: “hello”
Whitespace: non-breaking space
BOM: \uFEFFid
```

### 30.2 Test Round Trip

```java
String original = "José 🙂 €";
byte[] bytes = original.getBytes(StandardCharsets.UTF_8);
String decoded = new String(bytes, StandardCharsets.UTF_8);
assert original.equals(decoded);
```

### 30.3 Test Negative Case

```java
byte[] invalidUtf8 = {(byte) 0xE9};
try {
    decodeUtf8Strict(invalidUtf8);
    throw new AssertionError("Expected failure");
} catch (CharacterCodingException expected) {
    // OK
}
```

### 30.4 Test Byte-Exact Output

Untuk format file/protocol, test bytes:

```java
byte[] expected = "id,name\r\n1,José\r\n".getBytes(StandardCharsets.UTF_8);
byte[] actual = Files.readAllBytes(outputPath);
assert Arrays.equals(expected, actual);
```

### 30.5 Test Chunk Boundary

Buat test yang sengaja memotong UTF-8 di tengah sequence.

```java
String text = "A🙂B";
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);

// Simulasikan stream yang mengembalikan chunk kecil 1-2 byte.
```

Tujuannya memastikan decoder stateful, bukan `new String(chunk)` per chunk.

---

## 31. Observability: Apa yang Perlu Dilihat Saat Encoding Bermasalah

Log dan metrics harus membantu debugging tanpa membocorkan data sensitif.

### 31.1 Log yang Berguna

Untuk file ingestion:

```text
file_name=safe-display-name.csv
raw_size_bytes=123456
raw_sha256=...
expected_charset=UTF-8
bom_present=true
malformed_input=false
records_total=1000
records_rejected=3
first_error_line=42
```

Jangan log seluruh payload jika berisi data sensitif.

### 31.2 Metrics

- count invalid charset input;
- count malformed UTF-8;
- count unmappable output;
- count BOM present;
- count oversized line;
- distribution raw file size;
- parse failure by vendor/source;
- checksum mismatch count.

### 31.3 Error Message

Buruk:

```text
Failed to parse file
```

Baik:

```text
Rejected file: invalid UTF-8 byte sequence at byte offset around 15432. Expected charset=UTF-8. raw_sha256=...
```

Untuk user-facing message, jangan terlalu teknis. Untuk operational log, detail penting.

---

## 32. Security Notes

Encoding bug bisa menjadi security bug.

### 32.1 Validation Bypass

Jika sistem memvalidasi sebelum decode final, attacker bisa memakai encoding trick.

Rule:

```text
Decode/canonicalize according to contract first, then validate.
```

Namun canonicalization juga harus hati-hati agar tidak mengubah makna tanpa disadari.

### 32.2 Confusable Characters

Unicode memiliki karakter yang terlihat mirip:

```text
Latin A vs Cyrillic А
```

Untuk identifier/security-sensitive name, perlu policy:

- allowlist character set;
- restrict script mixing;
- normalize;
- display warnings;
- avoid using visual equality as identity.

### 32.3 Log Injection

Text input bisa mengandung newline:

```text
username = "alice\nERROR admin logged in"
```

Jika langsung dilog, attacker bisa memalsukan baris log.

Mitigasi:

- structured logging;
- escape control characters;
- limit length;
- sanitize for log display.

### 32.4 Resource Exhaustion

Untrusted text bisa sangat besar, satu line bisa ratusan MB, atau invalid sequence bisa memicu path error mahal.

Mitigasi:

- max bytes;
- max line length;
- max field length;
- timeout;
- streaming parser;
- reject early.

---

## 33. Performance Notes

### 33.1 Encoding/Decoding Bukan Gratis

Transcoding UTF-8 ↔ UTF-16 butuh CPU dan allocation. Untuk payload besar, operasi ini signifikan.

Hindari decode jika tidak perlu.

Contoh:

- file copy tidak perlu `String`;
- checksum tidak perlu decode;
- binary proxy tidak perlu decode;
- upload pass-through tidak perlu decode;
- compressed payload tidak perlu decode sebelum decompress.

### 33.2 Avoid Intermediate Huge String

Buruk:

```java
String text = Files.readString(path, StandardCharsets.UTF_8);
for (String line : text.split("\n")) {
    process(line);
}
```

Masalah:

- load full file;
- duplicate memory;
- regex split allocation;
- line array besar;
- OOM risk.

Lebih baik:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

### 33.3 Strict Decoder Bisa Lebih Mahal, Tapi Sering Layak

Untuk data eksternal yang harus benar, strict decode adalah biaya kecil dibanding biaya data corruption.

Gunakan strategi:

- strict at boundary;
- fail fast;
- quarantine;
- avoid repeated decode downstream.

---

## 34. Engineering Checklist

Gunakan checklist ini saat review code I/O yang menyentuh text.

### 34.1 Charset Checklist

- [ ] Apakah data ini text atau binary?
- [ ] Jika text, charset-nya eksplisit?
- [ ] Jika memakai default charset, apakah memang intentional?
- [ ] Apakah Java version migration memengaruhi behavior?
- [ ] Apakah ada legacy vendor/system charset?
- [ ] Apakah test mencakup non-ASCII?

### 34.2 Decode Checklist

- [ ] Apakah input trusted atau untrusted?
- [ ] Apakah malformed input harus reject atau replace?
- [ ] Apakah BOM allowed?
- [ ] Apakah decoding dilakukan streaming dengan state yang benar?
- [ ] Apakah size limit diterapkan sebelum load-all?

### 34.3 Encode Checklist

- [ ] Apakah output charset sesuai contract?
- [ ] Apakah semua karakter bisa direpresentasikan?
- [ ] Apakah unmappable character harus error?
- [ ] Apakah newline sesuai spec?
- [ ] Apakah output byte-exact ditest?

### 34.4 Byte-Exact Checklist

- [ ] Apakah checksum/signature dihitung atas byte yang benar?
- [ ] Apakah ada transformasi text sebelum verification?
- [ ] Apakah newline/BOM/normalization memengaruhi hash?
- [ ] Apakah raw bytes perlu disimpan untuk audit?

### 34.5 Security Checklist

- [ ] Apakah text input bisa menyebabkan log injection?
- [ ] Apakah confusable characters relevan?
- [ ] Apakah path/file name divalidasi?
- [ ] Apakah line/field/file size dibatasi?
- [ ] Apakah binary payload pernah dipaksa jadi String?

---

## 35. Latihan

### Latihan 1 — Cari Bug Charset

Review code ini:

```java
public String read(Path path) throws IOException {
    return new String(Files.readAllBytes(path));
}
```

Pertanyaan:

1. Bug apa yang mungkin muncul?
2. Apa bedanya di Java 17 dan Java 21?
3. Bagaimana memperbaiki untuk file UTF-8 kecil?
4. Bagaimana memperbaiki untuk file besar?
5. Bagaimana jika input harus reject invalid UTF-8?

### Latihan 2 — Chunk Decode

Code ini membaca socket:

```java
byte[] buffer = new byte[1024];
int n;
while ((n = socketInput.read(buffer)) != -1) {
    String part = new String(buffer, 0, n, StandardCharsets.UTF_8);
    parser.accept(part);
}
```

Pertanyaan:

1. Kenapa ini bisa rusak?
2. Data seperti apa yang memicu bug?
3. Bagaimana menggantinya dengan `InputStreamReader`?
4. Kapan tetap perlu byte-level framing sebelum decode?

### Latihan 3 — Signature Mismatch

Sebuah webhook provider mengirim JSON dan header signature. Code kita:

```java
String body = readBodyAsString(request);
String pretty = objectMapper.writerWithDefaultPrettyPrinter()
        .writeValueAsString(objectMapper.readTree(body));
verify(pretty.getBytes(StandardCharsets.UTF_8), signature);
```

Pertanyaan:

1. Kenapa signature gagal?
2. Byte mana yang seharusnya diverifikasi?
3. Apa perbedaan raw body dan parsed body?

### Latihan 4 — CSV BOM

File CSV vendor memiliki header:

```text
id,name,amount
```

Tetapi code tidak menemukan kolom `id`.

Pertanyaan:

1. Apa kemungkinan root cause terkait BOM?
2. Bagaimana mendeteksi?
3. Apakah harus strip atau reject?
4. Bagaimana menulis test-nya?

### Latihan 5 — Fixed Byte Limit

Sistem downstream menerima field maksimal 10 bytes UTF-8. User memasukkan:

```text
éééééé
```

Pertanyaan:

1. Berapa `String.length()`?
2. Berapa byte UTF-8?
3. Apakah valid untuk limit 10 bytes?
4. Bagaimana validasi yang benar?

---

## 36. Ringkasan

Part ini memberi fondasi penting:

1. **Byte adalah fakta fisik. Character adalah interpretasi.**
2. File/socket/HTTP body/message broker membawa byte, bukan `String`.
3. `String.length()` bukan ukuran byte dan bukan selalu jumlah karakter manusia.
4. `char` Java adalah UTF-16 code unit, bukan selalu satu Unicode code point.
5. Charset harus menjadi contract eksplisit di boundary eksternal.
6. UTF-8 default modern membantu portability, tetapi explicit charset tetap best practice.
7. Jangan decode binary data menjadi `String`.
8. Jangan decode UTF-8 per chunk tanpa decoder state.
9. Untuk data kritikal, gunakan strict decoder/encoder dengan `CodingErrorAction.REPORT`.
10. Checksum, hash, dan signature harus dihitung atas byte sequence yang jelas.
11. BOM, newline, normalization, locale, dan replacement character adalah sumber bug nyata.
12. Production-grade text I/O butuh contract: charset, BOM, newline, max size, malformed behavior, checksum, dan observability.

Mental model yang harus dibawa ke part berikutnya:

```text
External world gives you bytes.
You may only turn bytes into text when you know the charset and error policy.
You may only turn text into bytes when you know the target charset and output contract.
Anything else is an assumption that can become a production incident.
```

---

## 37. Referensi Resmi dan Lanjutan

- Oracle Java SE 21 API — `Charset`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/Charset.html
- Oracle Java SE 21 API — `StandardCharsets`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/StandardCharsets.html
- Oracle Java SE 21 API — `InputStreamReader`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/InputStreamReader.html
- Oracle Java SE 21 API — `String`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html
- Oracle Java SE 17/21 API — `Files.readString`: https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/nio/file/Files.html
- OpenJDK JEP 400 — UTF-8 by Default: https://openjdk.org/jeps/400
- Java Language Specification, Lexical Structure — UTF-16 code units/code points: https://docs.oracle.com/javase/specs/

---

## 38. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Mental Model Besar Java I/O
- Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug

Part berikutnya:

```text
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 000 — Mental Model Besar Java I/O: Dari Byte, Stream, Channel, Buffer, sampai Data Transfer](./learn-java-io-nio-networking-data-transfer-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 002 — Classic `java.io`: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle](./learn-java-io-nio-networking-data-transfer-part-002.md)

</div>