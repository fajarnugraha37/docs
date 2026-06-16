# Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-004.md`  
> Status: Part 004 dari 030  
> Prasyarat: Part 000–003

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **binary data** dari text data secara konseptual dan praktis.
2. Memahami kapan `DataInputStream`/`DataOutputStream` cukup, dan kapan harus membuat format binary sendiri dengan `ByteBuffer` atau `Channel`.
3. Mendesain format binary yang punya:
   - magic number,
   - version,
   - header,
   - length prefix,
   - flags,
   - checksum,
   - payload,
   - compatibility rule.
4. Menghindari bug umum binary I/O:
   - salah endianness,
   - partial read,
   - partial write,
   - EOF ambigu,
   - frame terlalu besar,
   - format tidak evolvable,
   - corruption tidak terdeteksi.
5. Membuat parser binary yang tidak percaya input secara buta.
6. Memahami bahwa TCP/file stream hanyalah urutan byte, bukan message boundary.
7. Menentukan kapan binary format lebih tepat dibanding JSON, CSV, Java serialization, atau text protocol.

Part ini adalah fondasi penting sebelum masuk ke `FileChannel`, memory-mapped file, networking framing, compression, dan reliable data transfer.

---

## 2. Mental Model: Binary I/O adalah Kontrak Byte-Level

Saat kamu bekerja dengan text I/O, kamu berurusan dengan pertanyaan:

> “Byte ini jika ditafsirkan dengan charset tertentu menjadi karakter apa?”

Saat kamu bekerja dengan binary I/O, pertanyaannya berubah menjadi:

> “Byte pada offset tertentu mewakili field apa, panjangnya berapa, urutannya bagaimana, dan validasinya apa?”

Binary I/O bukan sekadar “lebih cepat dari text”. Binary I/O adalah desain kontrak.

Contoh sederhana:

```text
Offset  Size  Meaning
0       4     magic number: 0x4A 0x49 0x4F 0x31, ASCII "JIO1"
4       1     version
5       1     flags
6       2     header length
8       4     payload length
12      4     CRC32 payload
16      N     payload bytes
```

Tanpa kontrak seperti ini, deretan byte tidak punya makna.

```text
4A 49 4F 31 01 00 00 10 00 00 04 00 91 7C 2D 1A ...
```

Bagi manusia, itu sulit dibaca. Bagi mesin, itu sangat presisi asalkan formatnya jelas.

---

## 3. Binary vs Text: Bukan Mana yang Lebih Baik, Tapi Boundary-nya Berbeda

### 3.1 Text format

Contoh:

```json
{
  "type": "PAYMENT",
  "amount": 125000,
  "currency": "IDR"
}
```

Kelebihan:

- mudah dibaca manusia,
- mudah di-debug,
- cocok untuk API boundary,
- field bisa fleksibel,
- tooling luas.

Kekurangan:

- lebih besar,
- perlu parsing character/charset,
- number/date/precision bisa ambigu,
- schema sering tidak dipaksa secara ketat,
- parsing bisa mahal untuk volume sangat besar.

### 3.2 Binary format

Contoh konseptual:

```text
01 00 00 00 00 01 E8 48 49 44 52
```

Kelebihan:

- compact,
- cepat untuk mesin,
- fixed layout bisa sangat efisien,
- cocok untuk file index, protocol internal, storage engine, telemetry, compression container, multimedia, database page, dan transport volume besar.

Kekurangan:

- sulit dibaca manusia,
- perlu tooling khusus,
- compatibility harus dirancang sejak awal,
- salah satu byte bisa membuat parsing gagal total,
- bug endianness dan length field bisa fatal.

### 3.3 Rule of thumb

Gunakan text ketika:

- manusia perlu membaca/debug langsung,
- interoperability lebih penting daripada ukuran,
- schema evolusi cepat,
- throughput tidak ekstrem,
- payload relatif kecil.

Gunakan binary ketika:

- throughput/ukuran penting,
- format dikontrol kuat,
- data perlu random access,
- payload besar dan repetitive,
- protocol internal high-volume,
- storage/index/transfer butuh layout stabil.

---

## 4. Binary Data di Java: API Utama

Java punya beberapa level API untuk binary I/O:

| Level | API | Cocok Untuk |
|---|---|---|
| Basic byte stream | `InputStream`, `OutputStream` | read/write byte mentah |
| Primitive stream | `DataInputStream`, `DataOutputStream` | primitive Java portable |
| Buffer-oriented | `ByteBuffer` | layout binary, NIO, channel, endianness |
| Channel-oriented | `ReadableByteChannel`, `WritableByteChannel`, `FileChannel`, `SocketChannel` | high-performance I/O |
| Checksum | `CRC32`, `Adler32`, `CheckedInputStream`, `CheckedOutputStream` | deteksi corruption non-cryptographic |
| Cryptographic digest | `MessageDigest`, `DigestInputStream`, `DigestOutputStream` | integrity/security hashing |

Dokumentasi Java menyatakan `DataInputStream` memungkinkan aplikasi membaca primitive Java dari underlying input stream secara machine-independent, sedangkan `DataOutputStream` menulis primitive Java ke output stream secara portable. Artinya API ini berguna untuk format sederhana, tetapi tetap menuntut kamu mendesain urutan field dan batas data sendiri.

---

## 5. `DataInputStream` dan `DataOutputStream`

### 5.1 Apa yang mereka selesaikan

`DataOutputStream` menyediakan method seperti:

```java
writeBoolean(boolean v)
writeByte(int v)
writeShort(int v)
writeChar(int v)
writeInt(int v)
writeLong(long v)
writeFloat(float v)
writeDouble(double v)
writeUTF(String str)
```

`DataInputStream` menyediakan pasangan:

```java
readBoolean()
readByte()
readShort()
readChar()
readInt()
readLong()
readFloat()
readDouble()
readUTF()
```

Mereka menyelesaikan masalah:

> “Bagaimana mengubah primitive Java menjadi urutan byte dan membacanya kembali secara konsisten?”

Contoh:

```java
import java.io.*;
import java.nio.file.*;

public class DataStreamExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("order.bin");

        try (DataOutputStream out = new DataOutputStream(
                new BufferedOutputStream(Files.newOutputStream(path)))) {
            out.writeInt(1001);
            out.writeLong(125_000L);
            out.writeUTF("IDR");
            out.writeBoolean(true);
        }

        try (DataInputStream in = new DataInputStream(
                new BufferedInputStream(Files.newInputStream(path)))) {
            int orderId = in.readInt();
            long amount = in.readLong();
            String currency = in.readUTF();
            boolean paid = in.readBoolean();

            System.out.printf("orderId=%d amount=%d currency=%s paid=%s%n",
                    orderId, amount, currency, paid);
        }
    }
}
```

### 5.2 Yang sering disalahpahami

Kode di atas **bukan** otomatis membuat format yang evolvable.

Format implisitnya adalah:

```text
int orderId
long amount
modified UTF string currency
boolean paid
```

Kalau besok kamu mengubah urutan baca menjadi:

```java
long amount = in.readLong();
int orderId = in.readInt();
```

hasilnya rusak, karena binary I/O sangat bergantung pada urutan dan ukuran field.

### 5.3 `writeUTF` bukan UTF-8 biasa

Salah satu jebakan penting: `DataOutputStream.writeUTF` memakai **modified UTF-8**, bukan UTF-8 biasa untuk semua konteks. `DataInputStream.readUTF` membaca format yang sama.

Implikasi:

- cocok jika file hanya dibaca oleh Java `DataInputStream`,
- kurang cocok untuk format interoperable lintas bahasa,
- punya batas panjang encoded string karena formatnya memakai length prefix 2 byte,
- tidak sama dengan menulis `string.getBytes(StandardCharsets.UTF_8)`.

Untuk format serius yang ingin interoperable, lebih eksplisit:

```java
byte[] currencyBytes = currency.getBytes(StandardCharsets.UTF_8);
out.writeInt(currencyBytes.length);
out.write(currencyBytes);
```

Lalu saat membaca:

```java
int length = in.readInt();
byte[] bytes = in.readNBytes(length);
String currency = new String(bytes, StandardCharsets.UTF_8);
```

Tetapi ini pun harus divalidasi agar `length` tidak liar.

---

## 6. Primitive Encoding: Ukuran Field Harus Jelas

Dalam binary format, setiap field harus punya ukuran pasti atau mekanisme panjang.

| Java Type | Ukuran Umum | Catatan |
|---|---:|---|
| `byte` | 1 byte | signed di Java, tapi bisa dipakai sebagai unsigned dengan masking |
| `boolean` | format tergantung API | `DataOutputStream.writeBoolean` menulis 1 byte |
| `short` | 2 byte | sering untuk small integer atau header length |
| `char` | 2 byte | UTF-16 code unit, bukan Unicode code point |
| `int` | 4 byte | sering untuk length, id, count |
| `long` | 8 byte | timestamp, offset, amount minor unit |
| `float` | 4 byte | IEEE 754 |
| `double` | 8 byte | IEEE 754 |

Masalah umum:

- memakai `int` untuk file size > 2GB,
- memakai `short` untuk length tanpa sadar batas 65535 jika dianggap unsigned,
- memakai `char` untuk text internasional,
- memakai floating point untuk uang,
- memakai timestamp tanpa unit dan timezone convention.

Untuk uang, lebih aman:

```text
amount_minor_unit: int64
currency_code: 3 ASCII bytes atau UTF-8 length-prefixed string
```

Contoh:

```text
IDR 125000 rupiah -> amount_minor_unit = 125000
USD 12.34 dollar  -> amount_minor_unit = 1234, scale convention = cents
```

---

## 7. Endianness: Urutan Byte untuk Nilai Multi-Byte

### 7.1 Apa itu endianness

Anggap kita ingin menulis integer:

```text
0x01020304
```

Big-endian:

```text
01 02 03 04
```

Little-endian:

```text
04 03 02 01
```

Nilainya sama, representasi byte-nya berbeda.

### 7.2 Java default

`DataInputStream`/`DataOutputStream` memakai representasi big-endian untuk primitive multi-byte. `ByteBuffer` juga default-nya big-endian untuk buffer baru, dan byte order dapat diganti dengan `order(ByteOrder.LITTLE_ENDIAN)`.

Contoh:

```java
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

public class EndiannessExample {
    public static void main(String[] args) {
        int value = 0x01020304;

        ByteBuffer big = ByteBuffer.allocate(4);
        big.order(ByteOrder.BIG_ENDIAN);
        big.putInt(value);

        ByteBuffer little = ByteBuffer.allocate(4);
        little.order(ByteOrder.LITTLE_ENDIAN);
        little.putInt(value);

        System.out.println(Arrays.toString(big.array()));
        System.out.println(Arrays.toString(little.array()));
    }
}
```

Output konseptual:

```text
[1, 2, 3, 4]
[4, 3, 2, 1]
```

### 7.3 Rule penting

Jangan berkata:

> “Kita pakai endianness native mesin.”

Untuk file/protocol yang disimpan atau dikirim lintas mesin, pilih satu secara eksplisit.

Biasanya:

- network protocols historis sering pakai big-endian/network byte order,
- format yang dekat dengan CPU/native tertentu bisa pakai little-endian,
- yang penting bukan big/little-nya, tetapi **terdokumentasi dan konsisten**.

---

## 8. Stream Bukan Message: Partial Read adalah Kenyataan

Salah satu bug paling umum pada binary I/O adalah mengasumsikan:

```java
in.read(buffer);
```

pasti mengisi seluruh buffer.

Itu salah.

`InputStream.read(byte[])` mengembalikan jumlah byte yang benar-benar terbaca, atau `-1` jika EOF. Jumlahnya bisa lebih kecil dari ukuran buffer, terutama pada socket, pipe, compressed stream, dan berbagai wrapper stream.

### 8.1 Kode yang salah

```java
byte[] header = new byte[16];
in.read(header); // SALAH: belum tentu 16 byte terbaca
parseHeader(header);
```

Masalah:

- bisa hanya terbaca 3 byte,
- sisanya masih default `0`,
- parser membaca header palsu,
- corruption muncul diam-diam.

### 8.2 Kode yang lebih benar

```java
byte[] header = in.readNBytes(16);
if (header.length != 16) {
    throw new EOFException("Expected 16-byte header, got " + header.length);
}
```

Atau untuk Java versi lama:

```java
static void readFully(InputStream in, byte[] buffer) throws IOException {
    int offset = 0;
    while (offset < buffer.length) {
        int n = in.read(buffer, offset, buffer.length - offset);
        if (n == -1) {
            throw new EOFException("Expected " + buffer.length + " bytes, got " + offset);
        }
        offset += n;
    }
}
```

`DataInputStream` punya method `readFully`, yang memang dibuat untuk kebutuhan seperti ini:

```java
DataInputStream in = new DataInputStream(source);
byte[] header = new byte[16];
in.readFully(header);
```

### 8.3 Partial write juga ada

Di `OutputStream`, `write(byte[])` biasanya menulis seluruh array atau melempar exception. Tetapi saat masuk ke NIO `Channel`, terutama non-blocking channel, write bisa parsial.

Dengan `WritableByteChannel`:

```java
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

Dengan non-blocking channel, loop seperti ini tidak boleh sembarang dilakukan di event loop tanpa strategi readiness/backpressure, karena `write` bisa return `0`.

---

## 9. Framing: Cara Membuat Boundary di Atas Byte Stream

File dan TCP sama-sama bisa dipandang sebagai stream byte. Mereka tidak otomatis tahu pesanmu mulai dan selesai di mana.

Maka kamu butuh framing.

Framing adalah aturan untuk menjawab:

> “Bagaimana receiver tahu satu unit data sudah lengkap?”

### 9.1 Fixed-size frame

Contoh:

```text
Setiap record selalu 64 byte.
```

Kelebihan:

- parsing mudah,
- random access mudah,
- tidak perlu length field.

Kekurangan:

- boros jika data variabel,
- sulit untuk field panjang seperti string,
- evolusi format lebih kaku.

Cocok untuk:

- index file,
- fixed record table,
- telemetry kecil,
- embedded binary structure.

### 9.2 Delimiter-based frame

Contoh:

```text
message\n
```

Kelebihan:

- sederhana,
- cocok untuk text protocol.

Kekurangan:

- delimiter bisa muncul di payload,
- perlu escaping,
- tidak cocok untuk arbitrary binary,
- scanning delimiter bisa mahal untuk payload besar.

Cocok untuk:

- line protocol,
- command protocol sederhana,
- log-like data.

### 9.3 Length-prefixed frame

Contoh:

```text
[length: 4 bytes][payload: length bytes]
```

Kelebihan:

- cocok untuk binary,
- receiver tahu berapa byte harus dibaca,
- payload boleh berisi byte apa pun.

Kekurangan:

- length field harus divalidasi,
- corrupted length bisa fatal,
- attacker bisa mengirim length besar untuk OOM.

Cocok untuk:

- TCP protocol,
- binary file container,
- internal RPC,
- chunk transfer.

### 9.4 Header-body frame

Format lebih matang biasanya seperti:

```text
[magic][version][flags][header_length][payload_length][checksum][payload]
```

Ini memberi ruang untuk:

- deteksi format,
- evolusi versi,
- optional feature via flags,
- validasi ukuran,
- checksum,
- metadata tambahan.

---

## 10. Magic Number: Jangan Biarkan Parser Menebak

Magic number adalah signature awal file/frame.

Contoh:

```text
JIO1
```

Dalam byte:

```text
0x4A 0x49 0x4F 0x31
```

Tujuannya:

- memastikan file adalah format yang benar,
- mendeteksi file kosong/salah format lebih awal,
- membedakan versi besar,
- membantu debugging dengan hex dump.

Contoh Java:

```java
static final int MAGIC = 0x4A494F31; // "JIO1"

static void writeMagic(DataOutputStream out) throws IOException {
    out.writeInt(MAGIC);
}

static void validateMagic(DataInputStream in) throws IOException {
    int magic = in.readInt();
    if (magic != MAGIC) {
        throw new IOException("Invalid magic: 0x" + Integer.toHexString(magic));
    }
}
```

Catatan:

- magic number sebaiknya mudah dikenali,
- jangan terlalu pendek untuk format penting,
- jangan hanya mengandalkan extension file.

---

## 11. Versioning: Format yang Tidak Bisa Berevolusi adalah Hutang Teknis

Binary format harus punya versi sejak awal.

Minimal:

```text
magic: 4 bytes
version: 1 byte
```

Contoh:

```java
static final byte VERSION_1 = 1;

out.writeInt(MAGIC);
out.writeByte(VERSION_1);
```

Saat membaca:

```java
int magic = in.readInt();
if (magic != MAGIC) {
    throw new IOException("Invalid magic");
}

int version = in.readUnsignedByte();
if (version != 1) {
    throw new IOException("Unsupported version: " + version);
}
```

### 11.1 Versioning strategy

Ada beberapa strategi:

#### Strict version

Reader hanya menerima versi tertentu.

```text
Reader v1 hanya menerima format v1.
```

Kelebihan:

- sederhana,
- aman.

Kekurangan:

- tidak fleksibel.

#### Backward-compatible extension

Format punya header length dan flags sehingga reader lama bisa skip field baru.

```text
[magic][version][header_length][known fields][extra fields]
```

Reader lama:

- baca known fields,
- skip sisa header berdasarkan `header_length`.

#### Schema-based evolution

Format memakai schema eksternal/internal seperti Protobuf/Avro.

Kelebihan:

- evolusi lebih formal,
- tooling kuat.

Kekurangan:

- ada dependency dan kompleksitas.

### 11.2 Compatibility rule yang harus ditulis

Untuk format internal serius, dokumentasikan:

```text
- Field baru hanya boleh ditambahkan di bagian extension header.
- Field existing tidak boleh berubah ukuran/arti.
- Enum value lama tidak boleh dipakai ulang.
- Reader harus menolak version lebih besar kecuali flag compatible diset.
- Length field wajib divalidasi terhadap max configured size.
```

---

## 12. Flags: Cara Menyatakan Optional Feature

Flags biasanya bit field.

Contoh 1 byte flags:

```text
bit 0: compressed
bit 1: encrypted
bit 2: checksum_present
bit 3: reserved
bit 4-7: reserved
```

Java:

```java
static final int FLAG_COMPRESSED = 1 << 0;
static final int FLAG_ENCRYPTED = 1 << 1;
static final int FLAG_CHECKSUM_PRESENT = 1 << 2;

static boolean hasFlag(int flags, int flag) {
    return (flags & flag) != 0;
}
```

Menulis:

```java
int flags = 0;
flags |= FLAG_CHECKSUM_PRESENT;
out.writeByte(flags);
```

Membaca:

```java
int flags = in.readUnsignedByte();
boolean compressed = hasFlag(flags, FLAG_COMPRESSED);
```

Rule penting:

- reserved bits harus 0,
- reader boleh menolak unknown critical flags,
- jangan langsung mengabaikan flag yang tidak dimengerti jika bisa mengubah cara interpretasi payload.

---

## 13. Unsigned Values di Java

Java tidak punya unsigned primitive umum kecuali `char` secara teknis 16-bit unsigned code unit, tetapi jangan pakai `char` untuk angka binary.

`byte` Java range:

```text
-128..127
```

Namun byte di file sering dimaksudkan sebagai:

```text
0..255
```

Gunakan masking:

```java
int unsigned = signedByte & 0xFF;
```

`DataInputStream` menyediakan:

```java
readUnsignedByte()
readUnsignedShort()
```

Contoh:

```java
int version = in.readUnsignedByte();      // 0..255
int headerLength = in.readUnsignedShort(); // 0..65535
```

Untuk unsigned int 32-bit:

```java
long unsignedInt = Integer.toUnsignedLong(in.readInt());
```

Hati-hati saat length memakai unsigned 32-bit. Nilainya bisa lebih besar dari `Integer.MAX_VALUE`, sehingga tidak bisa langsung dipakai untuk alokasi array.

---

## 14. Length Field: Field Paling Berbahaya dalam Binary Format

Length field terlihat sederhana:

```text
[payload_length: int32][payload]
```

Tapi inilah sumber banyak bug:

- negative length,
- length terlalu besar,
- length tidak sesuai sisa file,
- corrupted length,
- attacker mengirim length 2GB,
- integer overflow saat menghitung total size,
- allocation bomb.

### 14.1 Kode yang salah

```java
int length = in.readInt();
byte[] payload = in.readNBytes(length); // berbahaya jika length tidak divalidasi
```

Jika `length = 1_500_000_000`, aplikasi bisa OOM.

### 14.2 Kode yang benar secara defensif

```java
static byte[] readLengthPrefixedPayload(DataInputStream in, int maxPayloadSize)
        throws IOException {
    int length = in.readInt();

    if (length < 0) {
        throw new IOException("Negative payload length: " + length);
    }
    if (length > maxPayloadSize) {
        throw new IOException("Payload too large: " + length + " > " + maxPayloadSize);
    }

    byte[] payload = in.readNBytes(length);
    if (payload.length != length) {
        throw new EOFException("Expected " + length + " payload bytes, got " + payload.length);
    }
    return payload;
}
```

### 14.3 Jangan selalu allocate seluruh payload

Untuk payload besar, jangan langsung:

```java
byte[] payload = new byte[length];
```

Lebih baik stream per chunk:

```java
static void copyExactly(InputStream in, OutputStream out, long bytesToCopy)
        throws IOException {
    byte[] buffer = new byte[64 * 1024];
    long remaining = bytesToCopy;

    while (remaining > 0) {
        int toRead = (int) Math.min(buffer.length, remaining);
        int n = in.read(buffer, 0, toRead);
        if (n == -1) {
            throw new EOFException("Unexpected EOF, remaining=" + remaining);
        }
        out.write(buffer, 0, n);
        remaining -= n;
    }
}
```

---

## 15. Checksum: Deteksi Corruption, Bukan Security

Checksum membantu mendeteksi perubahan data tidak disengaja:

- disk corruption,
- transfer corruption,
- truncation,
- wrong payload,
- bug penulisan.

Java menyediakan `CRC32`, yang dapat digunakan untuk menghitung CRC-32 stream data.

Contoh:

```java
import java.util.zip.CRC32;

static long crc32(byte[] data) {
    CRC32 crc = new CRC32();
    crc.update(data);
    return crc.getValue();
}
```

### 15.1 CRC bukan security hash

CRC32 tidak melindungi dari attacker yang sengaja memodifikasi data. Untuk security integrity, gunakan cryptographic hash atau MAC, misalnya:

- SHA-256 untuk digest,
- HMAC-SHA256 untuk integrity dengan secret,
- authenticated encryption untuk encryption + integrity.

### 15.2 Checksum placement

Ada beberapa pilihan:

#### Header berisi checksum payload

```text
[header with crc32][payload]
```

Kelebihan:

- reader tahu expected checksum sebelum membaca payload.

Kekurangan:

- writer harus menghitung checksum dulu sebelum menulis header, atau melakukan seek back/update header.

#### Trailer berisi checksum

```text
[header][payload][crc32]
```

Kelebihan:

- cocok untuk streaming write.

Kekurangan:

- reader baru tahu checksum setelah seluruh payload terbaca.

#### Per-chunk checksum

```text
[chunk_length][chunk_crc][chunk_payload]
```

Kelebihan:

- cocok untuk file besar,
- bisa resume,
- bisa validasi sebagian.

Kekurangan:

- format lebih kompleks.

---

## 16. Mendesain Format Binary Sederhana yang Stabil

Kita akan desain format bernama `JIO1` untuk menyimpan satu payload binary.

### 16.1 Layout

```text
Offset  Size  Field
0       4     magic: ASCII "JIO1"
4       1     version: 1
5       1     flags
6       2     headerLength, unsigned short, big-endian
8       4     payloadLength, signed int, must be >= 0
12      4     payloadCrc32, int bits of CRC32
16      N     payload bytes
```

Invariant:

```text
- magic must equal JIO1
- version must be supported
- reserved flags must be zero
- headerLength must be 16 for version 1
- payloadLength must be >= 0
- payloadLength must be <= configured max
- payload bytes must be exactly payloadLength
- computed CRC32(payload) must equal payloadCrc32
```

### 16.2 Writer

```java
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.zip.CRC32;

public final class Jio1Writer {
    private static final int MAGIC = 0x4A494F31; // "JIO1"
    private static final int VERSION = 1;
    private static final int FLAGS = 0;
    private static final int HEADER_LENGTH = 16;

    private Jio1Writer() {
    }

    public static void write(Path path, byte[] payload) throws IOException {
        if (payload == null) {
            throw new NullPointerException("payload");
        }

        long crcValue = crc32(payload);

        try (DataOutputStream out = new DataOutputStream(
                new BufferedOutputStream(Files.newOutputStream(path)))) {
            out.writeInt(MAGIC);
            out.writeByte(VERSION);
            out.writeByte(FLAGS);
            out.writeShort(HEADER_LENGTH);
            out.writeInt(payload.length);
            out.writeInt((int) crcValue);
            out.write(payload);
        }
    }

    private static long crc32(byte[] payload) {
        CRC32 crc = new CRC32();
        crc.update(payload);
        return crc.getValue();
    }

    public static void main(String[] args) throws IOException {
        Path path = Path.of("example.jio1");
        byte[] payload = "Hello binary world".getBytes(StandardCharsets.UTF_8);
        write(path, payload);
    }
}
```

### 16.3 Reader

```java
import java.io.*;
import java.nio.file.*;
import java.util.zip.CRC32;

public final class Jio1Reader {
    private static final int MAGIC = 0x4A494F31; // "JIO1"
    private static final int SUPPORTED_VERSION = 1;
    private static final int HEADER_LENGTH_V1 = 16;
    private static final int RESERVED_FLAGS_MASK = 0b1111_1111;

    private Jio1Reader() {
    }

    public static byte[] read(Path path, int maxPayloadSize) throws IOException {
        try (DataInputStream in = new DataInputStream(
                new BufferedInputStream(Files.newInputStream(path)))) {

            int magic = in.readInt();
            if (magic != MAGIC) {
                throw new IOException("Invalid magic: 0x" + Integer.toHexString(magic));
            }

            int version = in.readUnsignedByte();
            if (version != SUPPORTED_VERSION) {
                throw new IOException("Unsupported version: " + version);
            }

            int flags = in.readUnsignedByte();
            if ((flags & RESERVED_FLAGS_MASK) != 0) {
                throw new IOException("Unsupported flags: 0x" + Integer.toHexString(flags));
            }

            int headerLength = in.readUnsignedShort();
            if (headerLength != HEADER_LENGTH_V1) {
                throw new IOException("Invalid header length: " + headerLength);
            }

            int payloadLength = in.readInt();
            if (payloadLength < 0) {
                throw new IOException("Negative payload length: " + payloadLength);
            }
            if (payloadLength > maxPayloadSize) {
                throw new IOException("Payload too large: " + payloadLength);
            }

            int expectedCrc = in.readInt();

            byte[] payload = in.readNBytes(payloadLength);
            if (payload.length != payloadLength) {
                throw new EOFException("Expected " + payloadLength
                        + " bytes, got " + payload.length);
            }

            int actualCrc = (int) crc32(payload);
            if (actualCrc != expectedCrc) {
                throw new IOException("CRC mismatch: expected=0x"
                        + Integer.toHexString(expectedCrc)
                        + " actual=0x"
                        + Integer.toHexString(actualCrc));
            }

            return payload;
        }
    }

    private static long crc32(byte[] payload) {
        CRC32 crc = new CRC32();
        crc.update(payload);
        return crc.getValue();
    }
}
```

### 16.4 Apa yang sudah baik dari contoh ini

Contoh ini sudah punya:

- magic number,
- version,
- flags,
- header length,
- payload length,
- max payload validation,
- EOF detection,
- checksum validation,
- explicit error message.

### 16.5 Apa yang belum production-grade

Masih ada batasan:

- payload dibaca seluruhnya ke memory,
- CRC dihitung setelah payload ada di memory,
- tidak atomic write,
- belum ada fsync,
- belum ada trailer,
- belum ada chunking,
- belum ada compression/encryption,
- belum ada schema payload,
- belum ada streaming parser.

Hal-hal itu akan dibahas di part berikutnya.

---

## 17. Streaming Payload Besar dengan Checksum

Untuk payload besar, hindari model:

```java
byte[] payload = in.readAllBytes();
```

Lebih baik stream dan hitung checksum sambil berjalan.

### 17.1 Copy dengan CRC32

```java
import java.io.*;
import java.util.zip.CRC32;

public final class StreamingChecksum {
    private StreamingChecksum() {
    }

    public static long copyAndChecksum(InputStream in, OutputStream out, long bytesToCopy)
            throws IOException {
        CRC32 crc = new CRC32();
        byte[] buffer = new byte[64 * 1024];
        long remaining = bytesToCopy;

        while (remaining > 0) {
            int toRead = (int) Math.min(buffer.length, remaining);
            int n = in.read(buffer, 0, toRead);
            if (n == -1) {
                throw new EOFException("Unexpected EOF, remaining=" + remaining);
            }
            crc.update(buffer, 0, n);
            out.write(buffer, 0, n);
            remaining -= n;
        }

        return crc.getValue();
    }
}
```

Pola ini penting untuk:

- download file besar,
- import file besar,
- network transfer,
- compression pipeline,
- file copy dengan validasi,
- object storage upload/download.

---

## 18. ByteBuffer untuk Binary Layout

`ByteBuffer` berguna ketika kamu ingin membangun atau membaca layout binary dengan kontrol posisi, limit, byte order, dan primitive get/put.

Contoh menulis header:

```java
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public final class HeaderBufferExample {
    private static final int MAGIC = 0x4A494F31;

    public static byte[] createHeader(int payloadLength, int crc32) {
        ByteBuffer buffer = ByteBuffer.allocate(16)
                .order(ByteOrder.BIG_ENDIAN);

        buffer.putInt(MAGIC);
        buffer.put((byte) 1);      // version
        buffer.put((byte) 0);      // flags
        buffer.putShort((short) 16); // header length
        buffer.putInt(payloadLength);
        buffer.putInt(crc32);

        return buffer.array();
    }
}
```

Membaca:

```java
static Header parseHeader(byte[] headerBytes) throws IOException {
    if (headerBytes.length != 16) {
        throw new IOException("Header must be exactly 16 bytes");
    }

    ByteBuffer buffer = ByteBuffer.wrap(headerBytes)
            .order(ByteOrder.BIG_ENDIAN);

    int magic = buffer.getInt();
    int version = buffer.get() & 0xFF;
    int flags = buffer.get() & 0xFF;
    int headerLength = buffer.getShort() & 0xFFFF;
    int payloadLength = buffer.getInt();
    int crc32 = buffer.getInt();

    return new Header(magic, version, flags, headerLength, payloadLength, crc32);
}

record Header(
        int magic,
        int version,
        int flags,
        int headerLength,
        int payloadLength,
        int crc32
) {
}
```

### 18.1 Kapan `ByteBuffer` lebih cocok

Gunakan `ByteBuffer` ketika:

- kamu bekerja dengan NIO channel,
- perlu random access dalam buffer,
- perlu endianness eksplisit,
- perlu parse header fixed layout,
- ingin menghindari banyak object kecil,
- ingin interoperable dengan native/binary protocol.

Gunakan `DataInputStream` ketika:

- format sederhana,
- sequential,
- Java-only atau internal,
- tidak perlu non-blocking/channel.

---

## 19. Hex Dump: Skill Debugging yang Wajib

Binary debugging tanpa hex dump itu menyiksa.

Helper sederhana:

```java
public static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 3);
    for (byte b : bytes) {
        sb.append(String.format("%02X ", b & 0xFF));
    }
    return sb.toString().trim();
}
```

Contoh:

```java
byte[] header = HeaderBufferExample.createHeader(1024, 0x12345678);
System.out.println(hex(header));
```

Output:

```text
4A 49 4F 31 01 00 00 10 00 00 04 00 12 34 56 78
```

Interpretasi:

```text
4A 49 4F 31  -> "JIO1"
01           -> version 1
00           -> flags
00 10        -> header length 16
00 00 04 00  -> payload length 1024
12 34 56 78  -> CRC/checksum placeholder
```

Untuk engineer yang sering menangani transfer, file corruption, atau protocol issue, kemampuan membaca hex dump sangat berguna.

---

## 20. EOF Semantics: EOF Bisa Valid, Bisa Error

EOF bukan selalu error.

Contoh membaca sampai habis file:

```java
while ((n = in.read(buffer)) != -1) {
    process(buffer, 0, n);
}
```

EOF di sini normal.

Tetapi EOF saat membaca fixed-size header adalah error:

```java
byte[] header = in.readNBytes(16);
if (header.length != 16) {
    throw new EOFException("Truncated header");
}
```

EOF saat membaca payload length-prefixed juga error jika payload belum lengkap:

```java
Expected payloadLength bytes, but stream ended early.
```

Rule:

```text
EOF is valid only when protocol says there is no more structured data expected.
```

Dalam binary protocol, jangan membiarkan EOF menjadi “ya sudah selesai” jika kamu sedang berada di tengah frame.

---

## 21. Corruption Model

Binary format harus mengantisipasi corruption.

Jenis corruption:

| Jenis | Contoh | Deteksi |
|---|---|---|
| Wrong file | user memberi file lain | magic number |
| Unsupported version | writer lebih baru | version check |
| Truncated header | file hanya 5 byte | readFully/readNBytes length check |
| Truncated payload | transfer putus | payload length check |
| Mutated payload | byte berubah | checksum/hash |
| Wrong endianness | length jadi absurd | sanity limit |
| Field invalid | flags unknown | validation |
| Extra trailing bytes | file digabung/salah tulis | optional strict EOF check |

### 21.1 Strict trailing byte check

Setelah membaca satu frame, apakah boleh ada byte tambahan?

Untuk format “single payload file”, biasanya tidak boleh.

```java
int extra = in.read();
if (extra != -1) {
    throw new IOException("Trailing bytes after payload");
}
```

Untuk format “multi-frame stream”, byte tambahan adalah frame berikutnya.

Maka format harus menyatakan:

```text
single-frame file atau multi-frame stream?
```

---

## 22. Multi-Record Binary File

Kadang file berisi banyak record.

Format:

```text
[file_header]
[record_1]
[record_2]
[record_3]
...
```

Setiap record:

```text
[record_type: 1 byte]
[record_flags: 1 byte]
[record_length: 4 bytes]
[record_payload: N bytes]
[record_crc32: 4 bytes]
```

### 22.1 EOF normal di boundary record

Parser:

```text
- baca record header
- jika EOF sebelum mulai record header: normal selesai
- jika EOF di tengah record header: truncated/corrupt
- baca payload sesuai length
- jika EOF di tengah payload: truncated/corrupt
```

Ini berbeda dari single-frame file.

### 22.2 Contoh loop parser konseptual

```java
while (true) {
    RecordHeader header;
    try {
        header = readRecordHeader(in);
    } catch (EOFException eofAtBoundary) {
        break; // valid only if EOF occurred before any header byte was consumed
    }

    byte[] payload = readPayload(in, header.length(), maxRecordSize);
    validateChecksum(payload, header.expectedCrc());
    process(header.type(), payload);
}
```

Masalahnya: `DataInputStream.readInt()` tidak memberi tahu apakah EOF terjadi sebelum byte pertama atau setelah sebagian byte. Untuk parser multi-record yang sangat presisi, kamu mungkin perlu membaca header byte array dulu dan membedakan:

```java
byte[] header = readUpTo(in, RECORD_HEADER_SIZE);
if (header.length == 0) {
    return END_OF_STREAM;
}
if (header.length < RECORD_HEADER_SIZE) {
    throw new EOFException("Truncated record header");
}
```

---

## 23. Designing for Forward Compatibility

Jika ingin reader lama bisa membaca file baru, kamu butuh pola extension.

Contoh header:

```text
magic: 4
version: 1
flags: 1
headerLength: 2
payloadLength: 8
payloadCrc32: 4
createdAtEpochMillis: 8
extension: headerLength - knownHeaderSize
payload: N
```

Reader lama tahu `knownHeaderSize = 28`.

Jika `headerLength > knownHeaderSize`, reader lama bisa skip:

```java
int extraHeaderBytes = headerLength - KNOWN_HEADER_SIZE;
in.skipNBytes(extraHeaderBytes);
```

Tetapi ini hanya aman jika field tambahan benar-benar optional dan tidak mengubah interpretasi payload lama.

Kalau field baru mengubah cara payload dibaca, gunakan flags/version yang membuat reader lama menolak file.

---

## 24. Binary Format dan Security

Binary parser adalah attack surface.

Hal yang wajib dilindungi:

### 24.1 Max size

Selalu punya limit:

```java
int maxFrameSize = 16 * 1024 * 1024;
```

Bukan:

```java
int length = in.readInt();
byte[] payload = new byte[length];
```

### 24.2 Timeout untuk network

Pada socket, attacker bisa mengirim header sangat lambat.

Mitigasi:

- read timeout,
- max frame size,
- max header size,
- max idle time,
- connection limit.

### 24.3 Unknown flag/version

Jangan abaikan feature yang tidak dimengerti.

### 24.4 Compression flag

Jika payload compressed, lindungi dari decompression bomb.

Butuh:

- compressed size limit,
- decompressed size limit,
- ratio limit,
- time budget.

### 24.5 Checksum bukan autentikasi

CRC32 tidak mencegah attacker memalsukan payload. Untuk boundary tidak trusted, gunakan MAC/signature.

---

## 25. Binary I/O dan Network Protocol

TCP tidak menjaga message boundary. Misalnya sender melakukan:

```java
out.write(frame1);
out.write(frame2);
```

Receiver bisa melihat:

```text
read #1 -> separuh frame1
read #2 -> sisa frame1 + awal frame2
read #3 -> sisa frame2
```

Atau:

```text
read #1 -> frame1 + frame2 sekaligus
```

Maka parser harus berbasis frame, bukan berbasis jumlah `read()`.

Length-prefix adalah pola paling umum:

```text
[int32 length][payload bytes]
```

Untuk non-blocking NIO, kamu perlu state machine:

```text
READ_HEADER -> READ_PAYLOAD -> VALIDATE -> DISPATCH -> READ_HEADER
```

State menyimpan:

- buffer header yang belum lengkap,
- expected payload length,
- buffer payload/chunk target,
- checksum accumulator,
- timeout/deadline,
- current protocol state.

Ini akan dibahas lebih dalam di part networking.

---

## 26. Binary I/O dan File Format

File berbeda dari socket karena:

- bisa seek,
- bisa tahu ukuran total,
- bisa random access,
- bisa memory-map,
- bisa atomic replace,
- bisa punya index/footer.

Format file binary sering memakai:

```text
[header][data blocks][index][footer]
```

Footer berguna untuk:

- mengetahui index offset,
- validasi file sudah complete,
- checksum global,
- commit marker.

Contoh:

```text
Header:
  magic
  version
  flags

Data blocks:
  repeated block records

Footer:
  indexOffset
  recordCount
  fileChecksum
  magicFooter
```

Jika file ditulis streaming, header kadang belum tahu ukuran final. Solusi:

1. tulis placeholder header, lalu seek back update header,
2. simpan metadata final di footer,
3. tulis manifest terpisah,
4. gunakan temp file lalu finalize atomically.

---

## 27. Data Type Design: Jangan Bocorkan Detail Java Sembarangan

Binary format yang baik tidak sekadar mencerminkan class Java.

Jangan desain seperti:

```text
writeUTF(customer.name)
writeInt(customer.age)
writeObject(customer.address)
```

Itu mencampur domain object dengan storage/protocol format.

Lebih baik desain schema eksplisit:

```text
CustomerRecord v1:
- customer_id: uint64
- name_utf8_length: uint16
- name_utf8_bytes: N
- status_code: uint8
- created_at_epoch_millis: int64
```

Rule:

- gunakan unit eksplisit,
- gunakan timezone/epoch convention eksplisit,
- gunakan enum numeric yang terdokumentasi,
- jangan reuse enum value,
- jangan serialisasi object graph untuk protocol eksternal,
- jangan bergantung pada nama field Java jika formatnya binary custom.

---

## 28. Error Handling Strategy

Binary parser sebaiknya membedakan error:

| Error | Makna | Bisa retry? |
|---|---|---|
| Invalid magic | bukan format yang benar | tidak |
| Unsupported version | reader terlalu lama | tidak, upgrade reader |
| Negative length | corrupt/malicious | tidak |
| Length too large | corrupt/malicious/config limit | mungkin dengan config berbeda, tapi hati-hati |
| EOF in header | truncated | bisa retry transfer |
| EOF in payload | partial transfer | bisa resume/retry |
| Checksum mismatch | corrupt | retry sumber data |
| Unknown critical flag | incompatible | tidak |
| IOException underlying | storage/network issue | tergantung jenis |

Jangan semuanya dilempar sebagai:

```text
RuntimeException: failed
```

Untuk production, error harus memberi sinyal operasional:

- apakah file salah format,
- apakah transfer incomplete,
- apakah ada corruption,
- apakah reader perlu upgrade,
- apakah input terlalu besar,
- apakah ada bug parser.

---

## 29. Testing Binary Format

Binary format harus dites lebih keras daripada DTO biasa.

### 29.1 Golden file test

Simpan file binary kecil sebagai fixture.

```text
fixtures/jio1-valid-small.bin
fixtures/jio1-invalid-magic.bin
fixtures/jio1-truncated-header.bin
fixtures/jio1-truncated-payload.bin
fixtures/jio1-bad-crc.bin
fixtures/jio1-too-large.bin
```

Tujuan:

- memastikan compatibility,
- mencegah perubahan format tidak sengaja,
- bisa dibaca lintas versi.

### 29.2 Round-trip test

```text
object/data -> writer -> bytes -> reader -> object/data
```

Pastikan hasil sama.

### 29.3 Negative test

Test input rusak:

- magic salah,
- version salah,
- flags unknown,
- length negatif,
- length terlalu besar,
- payload kurang,
- checksum salah,
- extra trailing bytes.

### 29.4 Fuzz-like test sederhana

Generate random bytes dan pastikan parser:

- tidak hang,
- tidak OOM,
- tidak infinite loop,
- gagal dengan exception terkendali.

Contoh:

```java
for (int i = 0; i < 10_000; i++) {
    byte[] random = new byte[randomLength()];
    ThreadLocalRandom.current().nextBytes(random);

    try {
        parse(random);
    } catch (IOException expected) {
        // acceptable
    }
}
```

### 29.5 Cross-version test

Jika format punya v1 dan v2:

```text
writer v1 -> reader v1
writer v1 -> reader v2
writer v2 -> reader v2
writer v2 -> reader v1: reject atau compatible sesuai kontrak
```

---

## 30. Performance Notes

Binary I/O sering lebih cepat, tapi bukan otomatis.

Faktor utama:

- jumlah syscall,
- ukuran buffer,
- allocation rate,
- parsing complexity,
- checksum cost,
- compression cost,
- disk/network speed,
- copy antar buffer,
- GC pressure.

### 30.1 Hindari write kecil terlalu banyak

Ini buruk:

```java
for (Record r : records) {
    out.writeByte(r.type());
    out.writeInt(r.length());
    out.write(r.payload());
}
```

Jika `out` tidak dibuffer, setiap write bisa menjadi operasi mahal.

Gunakan buffering:

```java
try (DataOutputStream out = new DataOutputStream(
        new BufferedOutputStream(Files.newOutputStream(path), 64 * 1024))) {
    // write records
}
```

Atau batch ke `ByteBuffer`.

### 30.2 Jangan premature pakai direct buffer

Direct buffer berguna untuk NIO/native I/O tertentu, tetapi:

- allocation lebih mahal,
- memory di luar heap,
- lifecycle lebih sulit,
- tidak cocok untuk semua kasus.

Part khusus `ByteBuffer` dan direct memory akan membahas ini lebih dalam.

### 30.3 Checksum punya biaya

CRC32 relatif ringan, tetapi tetap ada biaya. Untuk file besar, hitung streaming agar tidak menggandakan memory.

### 30.4 Format compact bisa lebih mahal jika terlalu bit-packed

Menghemat beberapa byte dengan bit-level packing bisa membuat parser rumit dan lambat.

Engineering trade-off:

```text
compactness vs simplicity vs speed vs evolvability
```

---

## 31. Anti-Pattern Binary I/O

### Anti-pattern 1: Format tanpa magic number

```text
Reader langsung membaca int pertama sebagai length.
```

Masalah:

- file salah bisa dianggap valid,
- error sulit didiagnosis.

### Anti-pattern 2: Format tanpa version

Masalah:

- tidak bisa evolusi,
- perubahan field diam-diam merusak reader lama.

### Anti-pattern 3: Length tanpa max limit

Masalah:

- OOM,
- denial of service,
- corrupted file bisa menghancurkan process.

### Anti-pattern 4: Menganggap `read()` mengisi buffer penuh

Masalah:

- parsing data setengah,
- bug intermittent.

### Anti-pattern 5: `writeUTF` untuk format interoperable

Masalah:

- modified UTF-8,
- limit panjang,
- non-Java reader bisa salah.

### Anti-pattern 6: CRC dianggap security

Masalah:

- attacker bisa menghitung CRC baru,
- tidak ada authentication.

### Anti-pattern 7: Native endianness untuk file/protocol

Masalah:

- format beda antar mesin,
- debugging sulit.

### Anti-pattern 8: Binary format mengikuti class Java

Masalah:

- coupling tinggi,
- refactor class merusak format,
- tidak cocok untuk compatibility jangka panjang.

---

## 32. Production Checklist

Sebelum membuat binary format, jawab pertanyaan ini:

### Format identity

- Apa magic number-nya?
- Apa version-nya?
- Apakah format single-frame atau multi-frame?
- Apakah ada footer/commit marker?

### Field layout

- Field apa saja?
- Offset dan size setiap field?
- Endianness apa?
- Integer signed atau unsigned?
- Timestamp unit apa?
- String encoding apa?

### Boundary

- Bagaimana reader tahu payload selesai?
- Apakah length-prefix, delimiter, fixed-size, atau footer index?
- Apa max payload size?
- Apa max header size?

### Compatibility

- Perubahan apa yang compatible?
- Perubahan apa yang incompatible?
- Bagaimana reader lama bereaksi terhadap version baru?
- Bagaimana unknown flags ditangani?

### Reliability

- Bagaimana mendeteksi truncation?
- Bagaimana mendeteksi corruption?
- Apakah checksum per payload/per chunk/global?
- Apakah write atomic?
- Apakah ada fsync requirement?

### Security

- Apakah input trusted?
- Apakah length divalidasi?
- Apakah compressed payload dibatasi?
- Apakah integrity butuh cryptographic MAC?
- Apakah parser bisa hang/OOM?

### Observability

- Error message cukup diagnostik?
- Apakah bisa log magic/version/length tanpa leak payload sensitif?
- Apakah ada metrics parse failure by reason?

---

## 33. Latihan

### Latihan 1 — Buat format binary sederhana

Desain format untuk menyimpan daftar `UserEvent`:

```text
userId: long
eventType: byte
epochMillis: long
payload: UTF-8 bytes
```

Syarat:

- file punya magic number,
- version,
- record count,
- tiap record punya payload length,
- max payload 1 MB,
- checksum per record.

Tulis:

- layout table,
- writer,
- reader,
- negative test cases.

### Latihan 2 — EOF boundary

Buat parser multi-record yang bisa membedakan:

1. EOF tepat setelah record terakhir: valid.
2. EOF di tengah header record: error.
3. EOF di tengah payload: error.

### Latihan 3 — Endianness

Buat file dengan `ByteBuffer` little-endian, lalu coba baca dengan big-endian. Amati field mana yang menjadi absurd.

### Latihan 4 — Checksum failure

Tulis file valid, ubah satu byte payload, pastikan reader menolak dengan CRC mismatch.

### Latihan 5 — Length attack

Buat input palsu dengan payload length `Integer.MAX_VALUE`. Pastikan parser menolak sebelum alokasi memory.

---

## 34. Ringkasan

Binary I/O adalah tentang kontrak byte-level. Java menyediakan API yang membantu, seperti `DataInputStream`, `DataOutputStream`, `ByteBuffer`, dan `CRC32`, tetapi API tersebut tidak otomatis membuat format yang aman, stabil, atau evolvable.

Hal terpenting dari part ini:

1. Binary format harus eksplisit.
2. Byte stream tidak punya message boundary.
3. `read()` tidak wajib memenuhi buffer.
4. Endianness harus dipilih dan didokumentasikan.
5. Length field wajib divalidasi.
6. Magic number membantu mendeteksi format salah.
7. Versioning harus ada sejak awal.
8. Checksum mendeteksi corruption, bukan serangan aktif.
9. EOF bisa normal atau error tergantung state parser.
10. Format yang baik punya invariant, compatibility rule, dan failure model.

Binary I/O yang matang bukan hanya soal menulis byte lebih cepat. Ia adalah desain protokol kecil: ada struktur, aturan evolusi, validasi, batas ukuran, dan cara gagal yang bisa dipahami.

---

## 35. Referensi

- Oracle Java SE Documentation — `java.io.DataInputStream`: membaca primitive Java dari underlying input stream secara machine-independent.
- Oracle Java SE Documentation — `java.io.DataOutputStream`: menulis primitive Java ke output stream secara portable.
- Oracle Java SE Documentation — `java.nio.ByteBuffer`: operasi get/put byte dan primitive dengan byte order tertentu.
- Oracle Java SE Documentation — `java.nio.ByteOrder`: representasi big-endian, little-endian, dan native order.
- Oracle Java SE Documentation — `java.util.zip.CRC32`: menghitung CRC-32 untuk data stream.
- Oracle Java SE Documentation — `java.io.InputStream`: kontrak `read` dan kondisi partial read/error.

---

## 36. Status Seri

Part yang sudah selesai:

```text
Part 000 — Mental Model Besar Java I/O
Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance
Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil
```

Seri belum selesai.

Part berikutnya:

```text
Part 005 — Character I/O: Reader, Writer, Line Processing, Large Text File, dan Text Pipeline
```
