# learn-java-io-file-filesystem-storage-engineering

## Part 22 — Checksums, Hashes, Integrity, and Deduplication

> Seri: **Java IO File, Filesystem, Storage Engineering**  
> Target: Java 8 hingga Java 25  
> Fokus: checksum, cryptographic hash, streaming digest, file manifest, integrity verification, deduplication, corruption detection, dan batas keamanan hash.

---

## 0. Tujuan Bagian Ini

Setelah bagian sebelumnya kita membangun append-only file, WAL, journaling, dan recovery design, bagian ini menjawab pertanyaan fundamental berikut:

> Setelah file ditulis, dibaca ulang, dipindahkan, dikirim, atau diproses ulang, bagaimana kita tahu file itu masih sama?

Di level junior, jawaban umum biasanya:

```text
Cek ukuran file.
```

Di level menengah:

```text
Hitung checksum atau hash.
```

Di level senior/top-tier:

```text
Tentukan integrity model lebih dulu:
- corruption accidental atau malicious tampering?
- single file atau kumpulan file?
- hash disimpan di mana?
- siapa yang dipercaya?
- kapan hash dihitung?
- apakah file immutable setelah hash?
- apakah operasi copy/move harus atomic?
- bagaimana recovery jika hash mismatch?
- bagaimana deduplication menghindari collision, race, dan cross-tenant leakage?
```

Bagian ini bukan sekadar API `MessageDigest`. Bagian ini membangun mental model bahwa **checksum/hash adalah kontrak integritas**, bukan dekorasi metadata.

---

## 1. Posisi Materi Ini Dalam File Engineering

Dalam file workflow production, hash/checksum biasanya muncul di banyak titik:

```text
upload
  -> stream to staging
  -> compute hash while writing
  -> verify size/content
  -> atomic publish
  -> store metadata manifest
  -> downstream process
  -> verify before processing
  -> verify after copy/move/export
  -> archive with manifest
```

Checksum/hash dipakai untuk:

1. Mendeteksi kerusakan file.
2. Memastikan file yang dibaca adalah file yang sama dengan yang ditulis.
3. Menghindari pemrosesan duplikat.
4. Membuat content-addressed storage.
5. Membuat manifest export/import.
6. Validasi transfer file.
7. Menandai versi immutable.
8. Mendeteksi partial write.
9. Mendeteksi salah copy.
10. Membantu recovery setelah crash.

Tetapi checksum/hash **tidak otomatis** menjawab semua bentuk integritas.

---

## 2. Mental Model: Integrity Itu Bukan Satu Hal

Kata “integrity” sering dipakai terlalu umum. Dalam file engineering, minimal ada beberapa jenis integritas.

### 2.1 Byte Integrity

Apakah byte file sama dengan byte yang diharapkan?

Contoh:

```text
expected SHA-256 = abc...
actual SHA-256   = abc...
```

Kalau sama, besar kemungkinan content sama.

### 2.2 Structural Integrity

Apakah struktur file valid?

Contoh file binary custom:

```text
magic       valid?
version     supported?
headerSize  reasonable?
recordCount matches actual records?
checksum    valid?
footer      exists?
```

Hash keseluruhan bisa cocok, tetapi aplikasi tetap perlu structural validation jika file berasal dari sumber eksternal.

### 2.3 Semantic Integrity

Apakah isi file masuk akal secara domain?

Contoh:

```text
CSV valid secara byte.
Header valid.
SHA-256 cocok.

Tapi amount negatif padahal domain melarang.
```

Hash tidak menggantikan domain validation.

### 2.4 Provenance Integrity

Apakah file berasal dari pihak yang benar?

Hash biasa tidak menjawab ini.

Kalau attacker bisa mengganti file dan mengganti hash manifest, maka SHA-256 tetap cocok, tetapi tidak membuktikan sumber file benar.

Untuk provenance, gunakan:

- digital signature,
- HMAC,
- trusted metadata store,
- authenticated channel,
- object storage checksum controlled by trusted service,
- signed manifest.

### 2.5 Workflow Integrity

Apakah file sudah melewati state yang benar?

Contoh:

```text
STAGED -> VERIFIED -> PUBLISHED -> PROCESSED -> ARCHIVED
```

Hash membantu membuktikan content, tetapi state machine tetap perlu memastikan lifecycle.

---

## 3. Checksum vs Cryptographic Hash

### 3.1 Checksum

Checksum adalah ringkasan data yang terutama dipakai untuk mendeteksi error tidak disengaja.

Contoh Java:

- `java.util.zip.CRC32`
- `java.util.zip.CRC32C`
- `java.util.zip.Adler32`

Checksum cocok untuk:

- deteksi corruption accidental,
- transfer/network/storage error,
- record framing internal,
- quick validation,
- file format internal checksum,
- WAL record checksum.

Checksum tidak cocok untuk:

- security boundary,
- adversarial tampering,
- proof of authenticity,
- deduplication yang sensitif collision secara security.

### 3.2 Cryptographic Hash

Cryptographic hash dirancang agar sulit menemukan:

- input berbeda dengan hash sama,
- input dari hash tertentu,
- dua input berbeda dengan hash sama.

Contoh Java:

- `SHA-256`
- `SHA-384`
- `SHA-512`

Java menyediakan ini melalui:

```java
java.security.MessageDigest
```

Cryptographic hash cocok untuk:

- content identity,
- manifest integrity,
- deduplication key,
- tamper evidence jika hash disimpan di tempat trusted,
- immutable artifact verification,
- content-addressable storage.

Tetapi cryptographic hash saja tetap tidak membuktikan authenticity. Untuk itu perlu signature/HMAC/trusted store.

---

## 4. Decision Table

| Kebutuhan | Pilihan Umum | Catatan |
|---|---:|---|
| Deteksi accidental corruption record kecil | CRC32C | Cepat, bukan untuk security |
| Deteksi accidental corruption file besar | CRC32C atau SHA-256 | Pilih berdasarkan cost dan threat model |
| Deduplication file | SHA-256 | Tambahkan size sebagai prefilter |
| Security-sensitive manifest | SHA-256 + signature/HMAC | Hash harus dilindungi |
| WAL record checksum | CRC32C | Umum untuk corruption detection |
| Public artifact verification | SHA-256/SHA-512 | Publish hash dari channel trusted |
| Password storage | Bukan SHA-256 biasa | Gunakan password hashing KDF; di luar scope file integrity |
| Fast non-security fingerprint | CRC32C atau non-crypto hash library | Java standard tidak punya semua non-crypto hash modern |

---

## 5. Java API Landscape

### 5.1 `MessageDigest`

`MessageDigest` adalah API utama Java untuk cryptographic digest.

Contoh:

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
digest.update(bytes);
byte[] hash = digest.digest();
```

Hal penting:

- `MessageDigest` bersifat stateful.
- Setelah `digest()` dipanggil, object biasanya reset ke initial state.
- Jangan share instance antar thread tanpa sinkronisasi.
- Gunakan algorithm name standar.
- `SHA-256` tersedia luas dan aman untuk file integrity modern.

### 5.2 `DigestInputStream`

`DigestInputStream` membungkus `InputStream` dan memperbarui digest saat byte dibaca.

```java
try (InputStream in = Files.newInputStream(path);
     DigestInputStream din = new DigestInputStream(in, MessageDigest.getInstance("SHA-256"))) {
    din.transferTo(OutputStream.nullOutputStream());
    byte[] hash = din.getMessageDigest().digest();
}
```

Catatan Java 8:

- `InputStream.transferTo` baru ada setelah Java 8.
- Untuk Java 8, gunakan loop manual.

### 5.3 `DigestOutputStream`

`DigestOutputStream` menghitung digest saat data ditulis.

Ini berguna untuk upload atau copy pipeline:

```text
source stream -> DigestOutputStream -> file output stream
```

Tetapi hati-hati:

- Digest yang dihitung adalah byte yang dikirim ke stream, bukan jaminan bahwa byte sudah durable di disk.
- Untuk durability, tetap perlu flush/close/force sesuai kebutuhan.

### 5.4 `Checksum`

`java.util.zip.Checksum` adalah interface untuk checksum.

Implementasi umum:

- `CRC32` sejak awal Java.
- `Adler32` sejak awal Java.
- `CRC32C` sejak Java 9.

Karena target seri Java 8–25, `CRC32C` perlu fallback jika aplikasi harus jalan di Java 8.

---

## 6. Java 8–25 Compatibility Notes

### 6.1 Java 8

Di Java 8 tersedia:

```java
java.security.MessageDigest
java.security.DigestInputStream
java.security.DigestOutputStream
java.util.zip.CRC32
java.util.zip.Adler32
```

Belum tersedia:

```java
java.util.zip.CRC32C
InputStream.transferTo
Files.readString
Files.writeString
HexFormat
```

Untuk hex encoding di Java 8, buat helper manual.

### 6.2 Java 9+

Java 9 menambahkan:

```java
java.util.zip.CRC32C
```

Ini berguna untuk checksum cepat dengan polynomial CRC-32C.

### 6.3 Java 11+

Java 11 menambahkan convenience API seperti `Files.readString` dan `Files.writeString`, tetapi untuk hashing file besar tetap gunakan streaming.

### 6.4 Java 17+

Java 17 menyediakan `java.util.HexFormat`, sehingga konversi byte hash ke hex lebih nyaman.

### 6.5 Java 25

Di Java 25, API dasar untuk hashing file masih berbasis kombinasi:

```text
Files / InputStream / FileChannel
MessageDigest
Checksum
DigestInputStream / DigestOutputStream
```

Tidak ada alasan untuk membaca seluruh file ke memory hanya untuk hash.

---

## 7. Golden Rule: Hash File Besar Dengan Streaming

Anti-pattern:

```java
byte[] all = Files.readAllBytes(path);
byte[] hash = MessageDigest.getInstance("SHA-256").digest(all);
```

Masalah:

- Memory meledak untuk file besar.
- File 4 GB tidak cocok dengan array byte biasa.
- GC pressure tinggi.
- Tidak ada progress reporting.
- Tidak mudah dibatalkan.

Pattern yang benar:

```java
static byte[] sha256(Path path) throws IOException, NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] buffer = new byte[1024 * 1024];

    try (InputStream in = Files.newInputStream(path)) {
        int read;
        while ((read = in.read(buffer)) != -1) {
            digest.update(buffer, 0, read);
        }
    }

    return digest.digest();
}
```

Mengapa buffer 1 MiB?

- Cukup besar untuk mengurangi overhead read call.
- Tidak terlalu besar untuk memboroskan memory.
- Bisa dituning berdasarkan workload.

Untuk banyak file paralel, jangan sembarang pakai buffer besar per thread. Kalau 200 thread masing-masing 8 MiB buffer, memory langsung besar.

---

## 8. Hex Encoding Hash

Hash biasanya disimpan sebagai hex string.

### 8.1 Java 17+

```java
static String toHex(byte[] bytes) {
    return java.util.HexFormat.of().formatHex(bytes);
}
```

### 8.2 Java 8 Compatible

```java
static String toHexJava8(byte[] bytes) {
    char[] hex = new char[bytes.length * 2];
    char[] digits = "0123456789abcdef".toCharArray();

    for (int i = 0; i < bytes.length; i++) {
        int v = bytes[i] & 0xff;
        hex[i * 2] = digits[v >>> 4];
        hex[i * 2 + 1] = digits[v & 0x0f];
    }

    return new String(hex);
}
```

Hindari:

```java
new BigInteger(1, hash).toString(16)
```

Karena leading zero bisa hilang jika tidak dipadding.

---

## 9. Computing SHA-256 With Metadata Snapshot

Dalam production, hash saja sering kurang. Simpan juga metadata snapshot.

```java
record FileFingerprint(
        Path path,
        long size,
        FileTime lastModifiedTime,
        String sha256
) {}
```

Java 8 belum punya `record`, jadi gunakan class biasa.

Contoh Java 8 compatible:

```java
public final class FileFingerprint {
    private final Path path;
    private final long size;
    private final FileTime lastModifiedTime;
    private final String sha256;

    public FileFingerprint(Path path, long size, FileTime lastModifiedTime, String sha256) {
        this.path = path;
        this.size = size;
        this.lastModifiedTime = lastModifiedTime;
        this.sha256 = sha256;
    }

    public Path path() { return path; }
    public long size() { return size; }
    public FileTime lastModifiedTime() { return lastModifiedTime; }
    public String sha256() { return sha256; }
}
```

Hashing helper:

```java
public static FileFingerprint fingerprint(Path path) throws IOException, NoSuchAlgorithmException {
    BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);

    if (!attrs.isRegularFile()) {
        throw new IOException("Not a regular file: " + path);
    }

    String sha256 = toHexJava8(sha256(path));

    return new FileFingerprint(
            path,
            attrs.size(),
            attrs.lastModifiedTime(),
            sha256
    );
}
```

Catatan penting:

> Size dan lastModifiedTime bukan bukti integritas. Mereka hanya prefilter dan diagnostic metadata.

File bisa berubah dengan ukuran sama dan timestamp yang sama/terbatas resolusinya.

---

## 10. Race Condition Saat Hashing

Hashing file tidak otomatis membekukan file.

Skenario:

```text
T1: mulai hash file A
T2: menulis ulang setengah file A
T1: lanjut membaca sisa file
T1: menghasilkan hash gabungan dari dua versi file
```

Ini bisa menghasilkan fingerprint untuk state yang tidak pernah ada secara konsisten.

### 10.1 Cara Mengurangi Risiko

Opsi desain:

1. Hash hanya file immutable.
2. Hash file di staging sebelum dipublish.
3. Gunakan atomic rename setelah file selesai.
4. Gunakan lock jika semua writer menghormati lock.
5. Validasi metadata sebelum dan sesudah hashing.
6. Gunakan content-addressed path setelah verified.

Contoh metadata double-check:

```java
public static String sha256WithBasicStabilityCheck(Path path) throws Exception {
    BasicFileAttributes before = Files.readAttributes(path, BasicFileAttributes.class);
    String hash = toHexJava8(sha256(path));
    BasicFileAttributes after = Files.readAttributes(path, BasicFileAttributes.class);

    if (before.size() != after.size()
            || !before.lastModifiedTime().equals(after.lastModifiedTime())) {
        throw new IOException("File changed during hashing: " + path);
    }

    return hash;
}
```

Ini bukan bukti sempurna. File bisa berubah lalu dikembalikan dengan size/timestamp sama. Tetapi sebagai operational guard, ini sering berguna.

Pattern yang lebih kuat:

```text
writer writes to .tmp
writer fsync/close
writer atomic move to final immutable name
reader hashes only final immutable name
```

---

## 11. Hash While Writing

Untuk upload/file intake, jangan menulis dulu lalu membaca ulang kalau bisa dihindari. Hitung hash saat streaming data ke disk.

### 11.1 Java 8 Compatible Hash While Copying

```java
public static String copyAndSha256(InputStream source, Path target) throws IOException, NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] buffer = new byte[1024 * 1024];

    try (OutputStream out = Files.newOutputStream(
            target,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE)) {

        int read;
        while ((read = source.read(buffer)) != -1) {
            digest.update(buffer, 0, read);
            out.write(buffer, 0, read);
        }
    }

    return toHexJava8(digest.digest());
}
```

### 11.2 Important Caveat

Hash di atas membuktikan byte yang dibaca dari source dan dikirim ke output stream.

Hash itu belum membuktikan:

- byte durable di disk,
- byte tidak diubah proses lain setelah ditulis,
- file target berhasil dipublish secara atomic,
- metadata benar,
- source terpercaya.

Untuk file intake robust:

```text
stream -> temp file + hash
close/force
verify size/hash policy
atomic move to content-addressed final path
store manifest/status in DB
```

---

## 12. CRC32 and CRC32C

### 12.1 CRC32

```java
public static long crc32(Path path) throws IOException {
    CRC32 crc = new CRC32();
    byte[] buffer = new byte[1024 * 1024];

    try (InputStream in = Files.newInputStream(path)) {
        int read;
        while ((read = in.read(buffer)) != -1) {
            crc.update(buffer, 0, read);
        }
    }

    return crc.getValue();
}
```

CRC32 cocok untuk accidental corruption detection, tetapi terlalu kecil untuk identity/security.

32-bit checksum berarti kemungkinan collision jauh lebih tinggi daripada SHA-256.

### 12.2 CRC32C

Java 9+:

```java
Checksum checksum = new CRC32C();
```

Java 8 tidak punya `CRC32C` di standard library.

Strategi Java 8–25:

- Jika target minimal Java 9, gunakan `CRC32C` bila butuh CRC-32C.
- Jika masih harus Java 8, gunakan `CRC32` atau library eksternal yang menyediakan CRC32C.
- Jangan menulis fallback reflection rumit kecuali benar-benar perlu satu binary untuk multi-runtime.

---

## 13. Checksum Per Record vs Hash Per File

Untuk file besar dengan banyak record, sering lebih baik memakai dua level integrity:

```text
file-level SHA-256
record-level CRC32C
```

Contoh append-only log:

```text
[record length][record type][payload][record crc]
[record length][record type][payload][record crc]
...
[file manifest: sha256, size, recordCount]
```

Mengapa perlu record checksum?

- Recovery bisa berhenti di record rusak.
- Tidak perlu membaca seluruh file untuk menemukan record terakhir valid.
- Partial write bisa dideteksi cepat.
- Compaction bisa memverifikasi record satu per satu.

Mengapa tetap perlu file-level hash?

- Verifikasi keseluruhan file setelah transfer/archive.
- Manifest bisa membuktikan final file immutable.
- Deduplication butuh identity keseluruhan.

---

## 14. Manifest File Pattern

Manifest adalah metadata yang mendeskripsikan file payload.

Contoh:

```json
{
  "version": 1,
  "files": [
    {
      "path": "data/customers-2026-06-18.csv",
      "size": 10485760,
      "sha256": "...",
      "contentType": "text/csv",
      "createdAt": "2026-06-18T09:00:00Z"
    }
  ]
}
```

Manifest digunakan untuk:

- export/import batch,
- archive validation,
- disaster recovery,
- cross-system handoff,
- audit trail,
- repeatable processing.

### 14.1 Manifest Integrity Problem

Kalau attacker bisa mengganti file dan manifest, hash di manifest tidak berguna sebagai security proof.

Solusi:

```text
payload files
manifest.json
manifest.json.sig
```

Atau:

```text
manifest hash stored in trusted DB
```

Atau:

```text
manifest delivered over authenticated channel
```

---

## 15. Hash Storage Design

Hash bisa disimpan di beberapa tempat:

### 15.1 Sidecar File

```text
report.pdf
report.pdf.sha256
```

Kelebihan:

- sederhana,
- portable,
- cocok untuk artifact distribution.

Kekurangan:

- mudah terpisah,
- bisa diganti bersama file,
- perlu naming convention.

### 15.2 Manifest

```text
batch/
  manifest.json
  files/a.csv
  files/b.csv
```

Kelebihan:

- cocok multi-file,
- bisa simpan metadata tambahan,
- mudah diaudit.

Kekurangan:

- manifest perlu dilindungi,
- perlu schema/versioning.

### 15.3 Database Metadata

```text
file_id | path | size | sha256 | state | created_at
```

Kelebihan:

- trusted boundary lebih kuat,
- mudah query,
- bisa dikombinasikan dengan workflow state.

Kekurangan:

- DB dan filesystem bisa drift,
- perlu reconciliation job.

### 15.4 Content-Addressed Path

```text
/blobs/ab/cd/abcdef...sha256
```

Kelebihan:

- path mengandung identity,
- dedup natural,
- immutable by design.

Kekurangan:

- perlu mapping dari domain object ke blob hash,
- collision policy tetap harus ada,
- privacy/cross-tenant leakage perlu dipikirkan.

---

## 16. Deduplication Mental Model

Deduplication berarti menyimpan satu copy untuk content yang sama.

Basic idea:

```text
hash(file) -> key
if key exists:
    reuse existing blob
else:
    store new blob
```

Tetapi production dedup tidak sesederhana itu.

### 16.1 Safe Dedup Pipeline

```text
1. write upload to temp file
2. compute sha256 and size while writing
3. close/force temp file
4. derive blob path from sha256
5. attempt atomic create/publish
6. if blob already exists:
     verify existing blob size/hash
     delete temp
     reuse existing blob
7. store logical reference in DB
```

### 16.2 Why Size Matters

Gunakan `(algorithm, hash, size)` sebagai identity tuple.

```text
sha256 = abc...
size   = 1048576
```

Size bukan security proof, tetapi:

- mempercepat prefilter,
- membantu debugging,
- mengurangi risiko operational mistake,
- membantu collision handling policy.

### 16.3 Collision Policy

Untuk SHA-256, collision praktis sangat tidak mungkin untuk normal business systems. Tetapi top-tier engineering tetap mendefinisikan policy:

```text
If same SHA-256 but different size: reject as corruption/security incident.
If same SHA-256 and same size: treat as duplicate.
Optionally byte-compare before dedup for regulated/high-assurance domain.
```

Untuk CRC32, jangan gunakan sebagai dedup identity utama.

---

## 17. Content-Addressed Storage Layout

Jangan taruh semua blob dalam satu directory.

Anti-pattern:

```text
/blobs/<sha256>
```

Jika jutaan file, directory bisa berat.

Pattern:

```text
/blobs/ab/cd/abcdef1234...
```

Contoh:

```java
public static Path blobPath(Path root, String sha256) {
    if (!sha256.matches("[0-9a-f]{64}")) {
        throw new IllegalArgumentException("Invalid sha256 hex");
    }
    return root
            .resolve(sha256.substring(0, 2))
            .resolve(sha256.substring(2, 4))
            .resolve(sha256);
}
```

Kelebihan sharding:

- directory tidak terlalu besar,
- listing lebih ringan,
- cleanup bisa per prefix,
- backup/restore bisa dipecah.

---

## 18. Publishing Blob Safely

Dedup storage harus aman terhadap race beberapa upload dengan content sama.

```java
public static Path publishBlob(Path tempFile, Path blobRoot, String sha256) throws IOException {
    Path finalPath = blobPath(blobRoot, sha256);
    Files.createDirectories(finalPath.getParent());

    try {
        Files.move(tempFile, finalPath, StandardCopyOption.ATOMIC_MOVE);
        return finalPath;
    } catch (FileAlreadyExistsException duplicate) {
        Files.deleteIfExists(tempFile);
        return finalPath;
    } catch (AtomicMoveNotSupportedException e) {
        // Same filesystem should normally support atomic rename, but provider may not.
        throw new IOException("Atomic blob publish not supported: " + finalPath, e);
    }
}
```

Masalah: `Files.move(..., ATOMIC_MOVE)` dengan existing target punya behavior khusus tergantung opsi. Untuk dedup, lebih aman gunakan temporary name unik dan target final immutable; jika target sudah ada, verify lalu reuse.

Alternative race-safe pattern:

```text
1. create parent dirs
2. if final exists, verify and reuse
3. else move temp to final atomically
4. if move fails because final appeared, verify and reuse
```

Implementasi yang lebih defensif:

```java
public static Path publishVerifiedBlob(Path tempFile, Path blobRoot, String sha256) throws IOException, NoSuchAlgorithmException {
    Path finalPath = blobPath(blobRoot, sha256);
    Files.createDirectories(finalPath.getParent());

    if (Files.exists(finalPath)) {
        verifySha256(finalPath, sha256);
        Files.deleteIfExists(tempFile);
        return finalPath;
    }

    try {
        Files.move(tempFile, finalPath, StandardCopyOption.ATOMIC_MOVE);
        return finalPath;
    } catch (FileAlreadyExistsException e) {
        verifySha256(finalPath, sha256);
        Files.deleteIfExists(tempFile);
        return finalPath;
    }
}
```

Catatan:

- `exists` bukan lock.
- Move tetap menjadi arbitration point.
- Existing blob harus diverifikasi sebelum dipercaya.

---

## 19. Hash-Before-Move Pattern

Untuk intake:

```text
incoming.tmp
  -> compute hash
  -> validate content
  -> atomic move to final/<hash>
```

Mengapa hash sebelum move?

- File final hanya berisi verified immutable content.
- Consumer tidak pernah melihat partial file.
- Hash menjadi identity saat publish.
- Recovery lebih mudah.

Jangan lakukan:

```text
move to final
then hash
then mark valid
```

Karena consumer bisa melihat final file sebelum valid.

Lebih aman:

```text
staging/<uuid>.tmp
staging/<uuid>.meta
verified/<sha256>
```

---

## 20. Hash-After-Copy Verification

Untuk copy antar filesystem atau export:

```text
source hash -> copy -> target hash -> compare
```

Contoh:

```java
public static void copyWithVerification(Path source, Path target) throws Exception {
    String sourceHash = toHexJava8(sha256(source));

    Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);

    String targetHash = toHexJava8(sha256(target));

    if (!sourceHash.equals(targetHash)) {
        throw new IOException("Copy verification failed: " + source + " -> " + target);
    }
}
```

Production version harus mempertimbangkan:

- target temp file,
- fsync/force,
- atomic publish,
- cleanup target partial,
- verify size first,
- retry policy.

Better pattern:

```text
source
  -> copy to target.tmp
  -> hash target.tmp
  -> compare
  -> atomic move target.tmp to target
```

---

## 21. Hash and Atomicity Are Different

Hash menjawab:

```text
Apakah content sama?
```

Atomicity menjawab:

```text
Apakah observer melihat old version atau new version, bukan half-written version?
```

Durability menjawab:

```text
Apakah data survive crash/power loss?
```

Security authenticity menjawab:

```text
Apakah content berasal dari pihak yang benar?
```

Jangan mencampur empat konsep ini.

Pattern robust biasanya menggabungkan semuanya:

```text
write temp
compute hash
force file
atomic move
force directory if needed
store manifest in trusted DB
optionally sign manifest
```

---

## 22. Hashing Directory Trees

Hashing directory tree tidak sekadar hash setiap file.

Masalah:

- ordering traversal tidak guaranteed,
- path separator beda OS,
- case sensitivity beda filesystem,
- symlink handling harus jelas,
- metadata ikut dihitung atau tidak,
- empty directory dihitung atau tidak,
- file permission dihitung atau tidak,
- timestamp dihitung atau tidak.

### 22.1 Deterministic Tree Hash

Rules harus eksplisit:

```text
- include only regular files
- do not follow symlinks
- use relative path with '/' separator
- sort entries lexicographically by normalized relative path
- hash path bytes in UTF-8
- hash file size
- hash file content SHA-256
- exclude lastModifiedTime
- exclude owner/permission
```

Jika metadata penting, buat mode berbeda:

```text
content-only tree hash
content-plus-metadata tree hash
```

### 22.2 Tree Manifest Approach

Daripada membuat satu hash langsung, buat manifest deterministik:

```text
SHA256  SIZE  PATH
abc...  123   dir/a.txt
def...  456   dir/b.txt
```

Lalu hash manifest.

Keuntungan:

- bisa debug file mana yang beda,
- bisa transfer incremental,
- bisa verify sebagian,
- bisa audit.

---

## 23. Tree Hash Example

```java
public static List<String> fileManifestLines(Path root) throws IOException, NoSuchAlgorithmException {
    List<Path> files = new ArrayList<>();

    Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
            if (attrs.isRegularFile()) {
                files.add(file);
            }
            return FileVisitResult.CONTINUE;
        }
    });

    Collections.sort(files, Comparator.comparing(path -> toPortableRelative(root, path)));

    List<String> lines = new ArrayList<>();
    for (Path file : files) {
        String rel = toPortableRelative(root, file);
        long size = Files.size(file);
        String hash = toHexJava8(sha256(file));
        lines.add(hash + "  " + size + "  " + rel);
    }

    return lines;
}

private static String toPortableRelative(Path root, Path file) {
    return root.relativize(file).toString().replace(File.separatorChar, '/');
}
```

Caveat:

- Ini tidak mengikuti symlink.
- Tidak menangani file berubah saat hashing.
- Untuk production, hash di snapshot/staging immutable.

---

## 24. Integrity In Archive Export/Import

Untuk export batch:

```text
export-2026-06-18/
  manifest.json
  data/customers.csv
  data/orders.csv
```

Atau ZIP:

```text
export.zip
  manifest.json
  data/customers.csv
  data/orders.csv
```

Manifest harus mencatat:

```text
relative path
size
sha256
content type optional
schema version optional
record count optional
created time optional
```

Import flow:

```text
1. extract to staging safely
2. validate no path traversal
3. read manifest
4. verify every file exists
5. verify size
6. verify SHA-256
7. validate schema/domain
8. publish/import
```

Jangan import sebelum verification selesai.

---

## 25. Hash and Compression

Hash bisa dihitung atas:

1. compressed bytes,
2. uncompressed bytes,
3. both.

Contoh:

```text
archive.zip SHA-256 = hash of zip container
file.csv SHA-256    = hash of extracted payload
```

Keduanya punya makna berbeda.

Compressed hash menjawab:

```text
Apakah archive container sama?
```

Uncompressed hash menjawab:

```text
Apakah payload logical sama?
```

Dua ZIP bisa berisi payload sama tetapi byte ZIP berbeda karena metadata/timestamp/compression level berbeda.

Untuk business payload integrity, simpan hash payload per entry.

---

## 26. Tamper Evidence vs Tamper Resistance

Hash yang disimpan di lokasi yang sama dengan file hanya memberi tamper evidence lemah.

```text
file.dat
file.dat.sha256
```

Jika attacker bisa mengubah keduanya, hash cocok.

Untuk tamper resistance/authenticity:

- sign manifest dengan private key,
- gunakan HMAC dengan secret key,
- simpan hash di database yang access control-nya berbeda,
- gunakan append-only audit log,
- gunakan object storage versioning + retention,
- gunakan WORM/immutable storage untuk regulated records.

Hash adalah building block, bukan security system penuh.

---

## 27. HMAC: When Hash Needs a Secret

Jika perlu membuktikan bahwa metadata/file dibuat oleh pihak yang punya secret, gunakan HMAC.

Contoh conceptual:

```java
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(secretKey);
byte[] tag = mac.doFinal(data);
```

HMAC cocok untuk:

- signed internal manifest,
- webhook/file handoff antar service internal,
- tamper detection dengan shared secret.

Tetapi key management menjadi isu utama:

- secret disimpan di mana?
- rotasi key bagaimana?
- key ID dicatat tidak?
- algoritma upgrade bagaimana?

Karena fokus seri ini file/filesystem, detail cryptographic protocol tidak dibahas panjang di sini.

---

## 28. Digital Signature: When There Are Different Parties

Jika producer dan verifier adalah pihak berbeda, digital signature lebih cocok daripada HMAC.

```text
producer private key signs manifest
consumer public key verifies manifest
```

Gunakan untuk:

- artifact release,
- regulatory evidence package,
- cross-organization data exchange,
- plugin/package verification.

Signature biasanya diterapkan ke manifest, bukan setiap file secara terpisah.

```text
manifest.json
manifest.json.sig
```

Manifest berisi hash file-file payload.

---

## 29. Hash Algorithm Agility

Jangan simpan hash tanpa algorithm.

Buruk:

```text
hash = abc123...
```

Lebih baik:

```text
algorithm = SHA-256
hash      = abc123...
```

Atau URI-like:

```text
sha256:abcdef...
```

Mengapa?

- Algoritma bisa berubah.
- SHA-1 dulu umum, sekarang tidak cocok untuk collision-resistant integrity.
- Migrasi butuh data model yang mendukung multi-algorithm.

Schema lebih robust:

```sql
file_hashes(
  file_id,
  algorithm,
  value_hex,
  created_at,
  primary key(file_id, algorithm)
)
```

---

## 30. Hash Comparison

Untuk security-sensitive comparison, gunakan constant-time comparison.

Java:

```java
MessageDigest.isEqual(expectedBytes, actualBytes)
```

Untuk file dedup biasa, string equality sering cukup, tetapi biasakan memahami konteks.

Jika hash berasal dari attacker dan comparison memengaruhi secret-bearing decision, pertimbangkan timing side-channel.

---

## 31. Error Handling: What To Do On Mismatch

Hash mismatch bukan sekadar exception teknis. Itu event integritas.

Klasifikasi:

```text
MISMATCH_AFTER_COPY
MISMATCH_ON_IMPORT
MISMATCH_EXISTING_BLOB
MISMATCH_MANIFEST
MISMATCH_AFTER_RECOVERY
MISMATCH_DURING_RECONCILIATION
```

Respon bisa berbeda:

| Situasi | Respon |
|---|---|
| Copy target mismatch | Delete target temp, retry/copy ulang |
| Import mismatch | Reject package, quarantine |
| Existing blob mismatch | Incident: content-addressed store corrupt or collision/tamper |
| Manifest mismatch | Reject archive, preserve evidence |
| WAL record checksum mismatch | Truncate at last valid record atau recover segment |
| Reconciliation mismatch | Mark object corrupted, stop serving |

Untuk sistem regulatory/case management, mismatch harus diaudit.

Log minimal:

```text
correlationId
fileId
path logical, not necessarily full sensitive path
expected algorithm/hash/size
actual algorithm/hash/size
operation
actor/service
state
```

Hindari logging full sensitive path atau filename user jika mengandung PII.

---

## 32. Performance Model

Hashing file besar adalah operasi kombinasi:

```text
storage read throughput
+ page cache behavior
+ CPU digest throughput
+ allocation/buffer strategy
```

### 32.1 Bottleneck Bisa Berbeda

Untuk HDD/network filesystem:

```text
I/O-bound
```

Untuk NVMe cepat dengan SHA-512/SHA-256 software:

```text
bisa CPU-bound
```

Untuk banyak file kecil:

```text
metadata/syscall-bound
```

Untuk object mounted filesystem:

```text
latency-bound
```

### 32.2 Parallel Hashing

Parallel hashing bisa membantu, tetapi:

- terlalu banyak concurrent read bisa merusak throughput,
- random I/O meningkat,
- page cache thrashing,
- network filesystem overload,
- CPU saturated,
- memory buffer meningkat.

Gunakan bounded executor.

```java
ExecutorService pool = Executors.newFixedThreadPool(Math.min(4, Runtime.getRuntime().availableProcessors()));
```

Jangan spawn thread per file tanpa limit.

### 32.3 Avoid Double Read

Jika workflow upload/copy bisa menghitung hash sambil menulis, lakukan itu.

```text
read source once -> write target + digest
```

Tetapi untuk verify target on disk, kadang perlu read ulang setelah close/force. Ini trade-off antara correctness dan cost.

---

## 33. Security Pitfalls

### 33.1 Using MD5/SHA-1 for Security Integrity

Jangan gunakan MD5/SHA-1 untuk collision-resistant security use case.

Masih mungkin muncul untuk legacy checksum, tetapi labeli sebagai legacy/non-security.

### 33.2 Trusting User-Provided Hash Blindly

Jika user upload file dan hash, hash itu hanya membuktikan bahwa user mengklaim sesuatu.

Sistem tetap perlu menghitung sendiri.

### 33.3 Hashing After Unsafe Path Resolution

Jangan sampai hashing dipakai untuk file yang path-nya sudah dieksploitasi.

```text
validate containment first
then open/hash
```

### 33.4 Symlink Swap During Hash

Attacker bisa mengganti path dengan symlink jika directory writable.

Mitigasi:

- gunakan staging directory controlled,
- jangan follow symlink untuk upload storage,
- gunakan random internal filename,
- pakai file handle setelah create,
- publish atomic.

### 33.5 Cross-Tenant Dedup Leakage

Global dedup bisa membocorkan informasi.

Contoh:

```text
Tenant A upload file X.
Tenant B upload file X.
Sistem bilang “duplicate already exists”.
```

Tenant B bisa menyimpulkan file X pernah ada.

Mitigasi:

- dedup per tenant,
- jangan expose duplicate signal,
- encrypt per tenant sebelum dedup jika privacy lebih penting,
- gunakan access-control mapping ketat.

---

## 34. Dedup and Reference Counting

Content-addressed blob sering dipakai oleh banyak logical object.

```text
blob sha256 ABC referenced by file_id 1, 2, 3
```

Jangan delete blob hanya karena satu logical file dihapus.

Model:

```sql
blobs(
  blob_id,
  algorithm,
  hash,
  size,
  path,
  state
)

file_objects(
  file_id,
  tenant_id,
  blob_id,
  original_name,
  created_at
)
```

Garbage collection:

```text
1. mark blobs with no references
2. wait grace period
3. verify still unreferenced
4. delete physical blob
5. mark deleted
```

Hindari immediate physical delete dalam transaction yang sama dengan logical delete jika ada concurrency tinggi.

---

## 35. Reconciliation Job

Filesystem dan DB bisa drift.

Contoh drift:

- DB says blob exists, file missing.
- File exists, DB missing.
- Size mismatch.
- Hash mismatch.
- Temp files abandoned.
- Sidecar manifest missing.

Reconciliation job:

```text
scan DB -> verify files
scan filesystem -> find orphans
verify sample/full hashes
quarantine suspicious files
emit metrics
create repair tasks
```

Jangan selalu hash semua file tiap hari kalau data sangat besar. Bisa gunakan:

- sampling,
- rolling verification,
- priority based on age/access,
- verify on read,
- verify on migration,
- verify before archive/export.

---

## 36. Practical Utility Class: Java 8 Compatible

```java
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.zip.CRC32;

public final class FileIntegrity {
    private static final int BUFFER_SIZE = 1024 * 1024;

    private FileIntegrity() {
    }

    public static String sha256Hex(Path path) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_SIZE];

            try (InputStream in = Files.newInputStream(path)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }

            return toHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public static long crc32(Path path) throws IOException {
        CRC32 crc = new CRC32();
        byte[] buffer = new byte[BUFFER_SIZE];

        try (InputStream in = Files.newInputStream(path)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                crc.update(buffer, 0, read);
            }
        }

        return crc.getValue();
    }

    public static boolean sha256Equals(Path path, String expectedHex) throws IOException {
        String actualHex = sha256Hex(path);
        return constantTimeHexEquals(expectedHex, actualHex);
    }

    public static String toHex(byte[] bytes) {
        char[] hex = new char[bytes.length * 2];
        char[] digits = "0123456789abcdef".toCharArray();

        for (int i = 0; i < bytes.length; i++) {
            int v = bytes[i] & 0xff;
            hex[i * 2] = digits[v >>> 4];
            hex[i * 2 + 1] = digits[v & 0x0f];
        }

        return new String(hex);
    }

    private static boolean constantTimeHexEquals(String expectedHex, String actualHex) {
        if (expectedHex == null || actualHex == null) {
            return false;
        }

        byte[] expected = expectedHex.toLowerCase().getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        byte[] actual = actualHex.toLowerCase().getBytes(java.nio.charset.StandardCharsets.US_ASCII);

        return MessageDigest.isEqual(expected, actual);
    }
}
```

Catatan:

- `SHA-256` seharusnya tersedia di standard Java runtime modern.
- Method tetap membungkus `NoSuchAlgorithmException` menjadi `IllegalStateException` karena ini kondisi environment abnormal.
- `constantTimeHexEquals` di sini menyamakan lowercase dulu, tetapi untuk sistem strict lebih baik validasi format hex lebih awal.

---

## 37. Production Intake Example

Pseudo-flow:

```java
public StoredBlob ingest(InputStream source, String originalName) {
    Path temp = createRandomTempInStaging();

    HashAndSize result = writeTempAndHash(source, temp);

    forceIfRequired(temp);

    validatePolicy(originalName, result.size(), result.sha256());

    Path finalBlob = publishToContentAddressedStore(temp, result.sha256());

    return db.insertLogicalFileReference(
        originalName,
        result.size(),
        "SHA-256",
        result.sha256(),
        finalBlob
    );
}
```

State machine:

```text
RECEIVING
  -> STAGED
  -> HASHED
  -> VERIFIED
  -> PUBLISHED
  -> REFERENCED
```

Failure recovery:

| State | Recovery |
|---|---|
| RECEIVING | delete old temp after timeout |
| STAGED | hash or delete if incomplete marker missing |
| HASHED | verify temp still exists; publish or quarantine |
| VERIFIED | publish if not already published |
| PUBLISHED | ensure DB reference exists |
| REFERENCED | normal state |

---

## 38. Operational Metrics

Track:

```text
file_hash_bytes_total
file_hash_duration_seconds
file_hash_failures_total
file_integrity_mismatch_total
file_dedup_hits_total
file_dedup_misses_total
file_manifest_verification_failures_total
file_reconciliation_missing_blob_total
file_reconciliation_hash_mismatch_total
```

Breakdown labels:

```text
algorithm
operation
storage_area
file_type
result
```

Hati-hati cardinality tinggi. Jangan jadikan full path atau hash sebagai metric label.

---

## 39. Logging Checklist

Untuk hash operation sukses:

```text
operation=hash
algorithm=SHA-256
size=...
durationMs=...
correlationId=...
```

Untuk mismatch:

```text
operation=verify
expectedAlgorithm=SHA-256
expectedHashPrefix=first12chars
actualHashPrefix=first12chars
expectedSize=...
actualSize=...
fileId=...
correlationId=...
result=MISMATCH
```

Jangan log full hash jika hash dianggap sensitive dalam threat model tertentu. Hash dari known document bisa dipakai sebagai oracle.

---

## 40. Common Mistakes

### Mistake 1 — Hashing `Path.toString()` Instead of File Content

```java
MessageDigest.getInstance("SHA-256").digest(path.toString().getBytes())
```

Ini hash nama path, bukan isi file.

### Mistake 2 — `readAllBytes` for Large File

Akan gagal pada file besar dan menyebabkan memory pressure.

### Mistake 3 — Using CRC32 for Security

CRC32 bukan cryptographic hash.

### Mistake 4 — Trusting Hash Stored Beside File As Security Proof

Sidecar hash bisa diganti bersama file.

### Mistake 5 — Hashing Mutable File

Hash bisa merepresentasikan campuran dua versi file.

### Mistake 6 — Dedup Based Only on Original Filename

Filename bukan identity.

### Mistake 7 — Dedup Based on CRC32

Collision terlalu mudah untuk skala besar/security-sensitive.

### Mistake 8 — Not Storing Algorithm

Nanti sulit migrasi dari SHA-256 ke algoritma lain.

### Mistake 9 — Not Handling Existing Blob Race

Concurrent upload content sama bisa menyebabkan failure palsu.

### Mistake 10 — No Reconciliation

DB/filesystem drift akan ditemukan terlalu terlambat.

---

## 41. Top 1% Mental Models

### 41.1 Hash Is Identity Only Under Immutability

Hash berguna sebagai identity jika content immutable setelah hash dihitung.

Kalau file masih bisa berubah, hash adalah snapshot attempt, bukan identity stabil.

### 41.2 Hash Does Not Create Trust

Hash hanya membandingkan content terhadap expected value.

Pertanyaan penting:

```text
expected value berasal dari siapa?
apakah expected value dilindungi?
```

### 41.3 Integrity Is Layered

Robust file integrity sering berlapis:

```text
record checksum
file hash
manifest
signed manifest
trusted metadata store
workflow state machine
reconciliation job
```

### 41.4 Size Is Not Integrity, But It Is Useful

Size bukan bukti content, tetapi sangat berguna untuk:

- prefilter,
- diagnostics,
- collision policy,
- transfer validation,
- operational alert.

### 41.5 Dedup Is a Storage Architecture, Not Just Hash Map

Dedup membutuhkan:

- content-addressed layout,
- race handling,
- reference tracking,
- garbage collection,
- tenant isolation,
- verification,
- repair strategy.

### 41.6 Hashing Is I/O Workload

Hash operation bisa menjadi bottleneck production. Perlakukan sebagai workload dengan metrics, limits, retry, and backpressure.

---

## 42. Practice Exercises

### Exercise 1 — SHA-256 CLI Tool

Buat CLI Java 8 compatible:

```text
java Sha256Tool file1 file2 file3
```

Output:

```text
<sha256>  <size>  <path>
```

Tambahkan error handling per file agar satu file gagal tidak menghentikan semua.

### Exercise 2 — Verified Copy

Implementasikan:

```java
copyWithVerification(Path source, Path target)
```

Rules:

- copy ke temp target,
- hash source,
- hash temp target,
- compare,
- atomic move temp ke target,
- cleanup saat gagal.

### Exercise 3 — Directory Manifest

Buat manifest deterministik untuk directory:

```text
sha256 size relativePath
```

Rules:

- ignore symlink,
- include only regular files,
- sort by portable relative path,
- use `/` separator.

### Exercise 4 — Dedup Store

Bangun mini content-addressed storage:

```java
StoredBlob put(InputStream source)
InputStream get(String sha256)
void deleteReference(String logicalId)
```

Tambahkan:

- sharded path,
- DB sederhana/in-memory map,
- duplicate handling,
- reference count,
- orphan cleanup.

### Exercise 5 — Manifest Verification

Buat verifier:

```text
manifest.json + files/
```

Verifier harus:

- reject missing file,
- reject size mismatch,
- reject SHA-256 mismatch,
- reject path traversal,
- report all errors, not only first error.

---

## 43. Checklist Praktis

Sebelum memakai hash/checksum di production, jawab:

```text
[ ] Apa threat model: accidental corruption atau malicious tampering?
[ ] Algorithm apa yang dipakai?
[ ] Apakah algorithm disimpan bersama hash?
[ ] Apakah file immutable saat hash dihitung?
[ ] Apakah hash dihitung streaming?
[ ] Apakah file besar aman dari memory explosion?
[ ] Apakah expected hash disimpan di trusted place?
[ ] Apakah perlu signature/HMAC?
[ ] Apakah size disimpan?
[ ] Apakah mismatch punya recovery policy?
[ ] Apakah dedup punya race handling?
[ ] Apakah dedup isolated per tenant?
[ ] Apakah ada reconciliation job?
[ ] Apakah metrics/logging cukup?
[ ] Apakah hash comparison perlu constant-time?
[ ] Apakah manifest deterministic?
[ ] Apakah archive extraction aman dari traversal?
```

---

## 44. Ringkasan

Checksum dan hash adalah alat penting untuk file engineering, tetapi nilainya tergantung pada desain di sekitarnya.

Poin utama:

1. Checksum cocok untuk accidental corruption, bukan security.
2. Cryptographic hash cocok untuk content identity dan tamper evidence jika expected hash trusted.
3. Hash file besar harus streaming.
4. Hashing mutable file bisa menghasilkan snapshot tidak konsisten.
5. Hash bukan atomicity, bukan durability, dan bukan authenticity.
6. Manifest harus deterministic dan dilindungi jika security-sensitive.
7. Deduplication adalah arsitektur storage lengkap, bukan sekadar `Map<hash, path>`.
8. Store `(algorithm, hash, size)`, bukan hash saja.
9. Integrity mismatch adalah event operasional/security yang harus diaudit.
10. Top-tier engineer mendesain integrity sebagai layered system: record checksum, file hash, manifest, trusted store, signature/HMAC, workflow state, dan reconciliation.

---

## 45. Koneksi Ke Part Berikutnya

Bagian berikutnya adalah:

```text
Part 23 — File Naming, Extension, MIME, Charset, and Content Detection
```

Setelah memahami bahwa hash membuktikan byte identity, kita akan membahas hal yang sering tertukar dengan identity: **nama file, extension, MIME type, charset, dan content detection**.

File bernama `invoice.pdf` belum tentu PDF. File dengan MIME `text/csv` belum tentu CSV valid. File dengan extension aman belum tentu content aman. Dan content detection sendiri penuh keterbatasan.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Append-Only Files, WAL, Journaling, and Recovery Design](./learn-java-io-file-filesystem-storage-engineering-part-21-append-only-wal-journaling-recovery-design.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 23](./learn-java-io-file-filesystem-storage-engineering-part-23-file-naming-extension-mime-charset-content-detection.md)
