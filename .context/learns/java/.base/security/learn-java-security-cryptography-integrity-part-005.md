# learn-java-security-cryptography-integrity-part-005

# Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `005`  
> Status: **Part 5 dari 35**  
> Topik utama: cryptographic hash, digest, checksum, fingerprint, canonicalization, streaming hash, hash chaining, integrity manifest  
> Prasyarat konseptual: Part 0 sampai Part 4

---

## 0. Tujuan Part Ini

Bagian ini membangun pemahaman mendalam tentang **hashing dan integrity boundary** dalam sistem Java.

Targetnya bukan hanya bisa menulis:

```java
MessageDigest.getInstance("SHA-256")
```

Target sebenarnya adalah mampu menjawab:

1. Kapan hash cukup untuk integrity?
2. Kapan hash **tidak cukup** dan harus memakai MAC atau signature?
3. Apa beda checksum, digest, fingerprint, content-address, dan commitment?
4. Kenapa `SHA-256(payload)` kadang aman, kadang useless, dan kadang misleading?
5. Kenapa hashing harus didahului canonicalization?
6. Bagaimana menghitung hash file besar tanpa memuat seluruh file ke memory?
7. Bagaimana membangun manifest integrity untuk batch/file transfer?
8. Bagaimana membuat audit chain sederhana yang tamper-evident?
9. Apa saja misuse pattern hashing di Java enterprise systems?
10. Bagaimana mereview kode yang memakai hashing agar tidak memberi rasa aman palsu?

Hash adalah primitive yang tampak sederhana, tetapi sering menjadi sumber desain yang salah. Banyak engineer memakai hash sebagai “security dust”: tambahkan SHA-256, lalu merasa aman. Padahal hash tanpa secret tidak membuktikan siapa pembuat data. Hash juga tidak mencegah attacker mengganti payload dan hash sekaligus jika keduanya berada pada boundary yang sama.

Part ini akan menanamkan mental model utama:

> Hash hanya memberi integrity jika nilai hash berada pada trust boundary yang lebih kuat daripada data yang diverifikasi.

---

## 1. Positioning dalam Seri

Kita sudah membahas:

- Part 0: security mental model.
- Part 1: peta Java Security Architecture.
- Part 2: threat modeling.
- Part 3: crypto guarantee.
- Part 4: randomness, entropy, nonce, salt, IV, token.

Part 5 adalah jembatan menuju:

- Part 6: password storage.
- Part 7: symmetric encryption.
- Part 8: MAC.
- Part 9: digital signature.
- Part 25: audit trail integrity.
- Part 26: distributed data integrity.
- Part 27-29: supply chain/build integrity.

Hash sering muncul di semua bagian tersebut.

Namun perlu ditekankan sejak awal:

> Hash adalah unkeyed primitive. Jika attacker bisa mengubah data dan hash-nya sekaligus, hash tidak memberi authenticity.

---

## 2. Vocabulary yang Harus Dibedakan

### 2.1 Hash Function

Hash function mengambil input dengan ukuran arbitrer dan menghasilkan output fixed-length.

Contoh:

```text
input:  "case-123|approved|2026-06-16"
output: 7f2c... fixed length digest
```

Dalam konteks security, yang dimaksud biasanya **cryptographic hash function**, bukan hash table hash.

Contoh cryptographic hash:

- SHA-256
- SHA-384
- SHA-512
- SHA3-256
- SHA3-512

Contoh non-cryptographic hash:

- MurmurHash
- xxHash
- CityHash
- Java `String.hashCode()`
- CRC32
- Adler32

Non-cryptographic hash bisa sangat cepat, tetapi tidak dirancang untuk melawan attacker.

---

### 2.2 Message Digest

Dalam Java, istilah digest sering merujuk pada output dari `MessageDigest`.

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
byte[] result = digest.digest(data);
```

Digest adalah hasil hash.

```text
message -> hash function -> digest
```

Digest bukan encryption. Digest tidak bisa didekripsi.

---

### 2.3 Fingerprint

Fingerprint adalah digest yang dipakai sebagai identitas ringkas suatu object.

Contoh:

- fingerprint file release
- fingerprint certificate
- fingerprint artifact JAR
- fingerprint public key
- fingerprint document evidence

Fingerprint menjawab:

> “Apakah object yang saya lihat sekarang byte-for-byte sama dengan object yang pernah saya lihat sebelumnya?”

Fingerprint tidak otomatis menjawab:

> “Apakah object ini dibuat oleh pihak yang sah?”

Untuk itu perlu MAC atau signature.

---

### 2.4 Checksum

Checksum mendeteksi accidental corruption, bukan malicious tampering.

Contoh:

- CRC32
- Adler32
- TCP checksum
- file transfer checksum untuk error detection

Checksum berguna untuk:

- mendeteksi bit flip
- mendeteksi storage/network corruption tidak disengaja
- quick validation di pipeline non-adversarial

Checksum tidak cukup untuk:

- membuktikan file tidak dimanipulasi attacker
- membuktikan source file terpercaya
- audit evidence integrity di adversarial context

---

### 2.5 Content Address

Content address berarti identitas object adalah hash dari content-nya.

Contoh konseptual:

```text
sha256:abc123... -> object bytes
```

Dipakai pada:

- Git object model
- container image layer
- artifact cache
- immutable blob store
- deduplication store

Content address memberi property:

> Jika content berubah, address berubah.

Namun tetap perlu trust terhadap mapping, source, dan policy.

---

### 2.6 Commitment

Hash kadang dipakai sebagai commitment.

Contoh:

```text
Hari ini A menyimpan hash dari dokumen rahasia.
Besok A membuka dokumen itu.
Verifier menghitung ulang hash.
Jika sama, verifier tahu dokumen itu sudah “committed” sejak hari ini.
```

Tetapi commitment yang aman butuh perhatian terhadap:

- entropy input
- domain separation
- collision resistance
- preimage resistance
- timestamp trust
- storage trust

Jika input kecil dan mudah ditebak, attacker bisa brute-force hash.

Contoh buruk:

```text
hash("APPROVED")
hash("REJECTED")
```

Itu bukan commitment yang menyembunyikan isi.

---

## 3. Security Properties Cryptographic Hash

Cryptographic hash biasanya dievaluasi dari beberapa property.

### 3.1 Preimage Resistance

Diberikan hash `h`, sulit mencari input `m` sehingga:

```text
H(m) = h
```

Artinya digest tidak mudah dibalik menjadi input.

Namun “sulit” bukan berarti tidak bisa ditebak jika input space kecil.

Contoh buruk:

```text
SHA-256("yes")
SHA-256("no")
SHA-256("male")
SHA-256("female")
SHA-256("approved")
SHA-256("rejected")
```

Input seperti ini bisa ditebak dengan dictionary.

Mental model:

> Hash menyembunyikan input hanya jika input punya entropy cukup besar atau diberi secret/blinding yang benar.

---

### 3.2 Second-Preimage Resistance

Diberikan input `m1`, sulit mencari input lain `m2` sehingga:

```text
m1 != m2
H(m1) = H(m2)
```

Ini penting untuk file integrity:

```text
original file -> digest
attacker sulit membuat file lain dengan digest sama
```

---

### 3.3 Collision Resistance

Sulit mencari dua input berbeda `m1` dan `m2` sehingga:

```text
H(m1) = H(m2)
```

Collision resistance penting untuk:

- certificate signature schemes
- artifact identity
- content-addressed storage
- signed manifest
- audit data structure

MD5 dan SHA-1 sudah tidak layak untuk collision-sensitive security design.

---

### 3.4 Avalanche Effect

Perubahan kecil pada input menghasilkan perubahan digest yang tampak acak.

```text
H("case=123")
H("case=124")
```

Output harus sangat berbeda.

Ini bukan property formal paling utama untuk threat model, tetapi berguna sebagai intuisi.

---

### 3.5 Fixed Output Size and Birthday Bound

Hash output fixed length.

Contoh:

- SHA-256 -> 256-bit output
- SHA-384 -> 384-bit output
- SHA-512 -> 512-bit output

Collision resistance kira-kira dibatasi birthday bound.

Untuk n-bit digest, collision work factor sekitar:

```text
2^(n/2)
```

Maka SHA-256 memberi collision security sekitar 128-bit.

Ini biasanya sangat kuat untuk sistem aplikasi, tetapi tetap harus dipakai dengan benar.

---

## 4. Hash Bukan Encryption

Hash:

```text
input -> digest
```

Encryption:

```text
plaintext + key -> ciphertext
ciphertext + key -> plaintext
```

Hash tidak punya key dan tidak bisa didekripsi.

Kesalahan umum:

```text
"Kita encrypt password pakai SHA-256."
```

Itu salah istilah dan salah desain.

Password tidak dienkripsi dengan SHA-256. Password disimpan dengan **password hashing/KDF** seperti Argon2id, bcrypt, scrypt, atau PBKDF2 dengan salt dan work factor.

SHA-256 cepat. Justru karena cepat, SHA-256 tidak cocok sebagai password hashing langsung.

---

## 5. Hash Bukan MAC

Hash tanpa secret:

```text
digest = SHA-256(message)
```

MAC dengan secret key:

```text
tag = HMAC-SHA-256(secretKey, message)
```

Hash menjawab:

> “Apakah message ini sama dengan message yang menghasilkan digest ini?”

MAC menjawab:

> “Apakah message ini dibuat/diverifikasi oleh pihak yang punya secret key?”

Jika attacker bisa mengubah message dan digest, hash tidak berguna.

Contoh buruk:

```json
{
  "payload": {
    "caseId": "123",
    "decision": "APPROVED"
  },
  "hash": "sha256(payload)"
}
```

Jika attacker mengubah payload menjadi `REJECTED` lalu menghitung ulang hash, verifier tetap lolos.

Yang dibutuhkan adalah:

```text
HMAC(secret, canonicalPayload)
```

atau digital signature jika verifier tidak boleh punya signing key.

---

## 6. Hash Bukan Signature

Digital signature memakai private key untuk signing dan public key untuk verification.

```text
signature = Sign(privateKey, hash(message))
Verify(publicKey, message, signature)
```

Signature menjawab:

> “Pihak yang punya private key terkait public key ini menandatangani message ini.”

Hash saja tidak menjawab itu.

Use case signature:

- signed document
- signed audit export
- signed release artifact
- signed command from trusted party
- third-party verification
- non-repudiation-oriented workflow

Jika pihak verifier juga boleh membuat tag, pakai MAC.
Jika pihak verifier tidak boleh membuat bukti baru, pakai signature.

---

## 7. Integrity Boundary: Konsep Paling Penting di Part Ini

Hash hanya berguna jika digest disimpan/dikirim melalui boundary yang lebih dipercaya daripada data.

### 7.1 Boundary Buruk

```text
[untrusted file] + [hash file di folder yang sama]
```

Jika attacker bisa mengganti keduanya, integrity check tidak bermakna.

Contoh:

```text
invoice.pdf
invoice.pdf.sha256
```

Jika dua-duanya dari source yang sama-sama tidak dipercaya, attacker bisa mengganti file dan hash.

---

### 7.2 Boundary Lebih Baik

```text
file downloaded from mirror
hash fetched from trusted HTTPS vendor page
```

Ini lebih baik, karena file dan digest berasal dari boundary berbeda.

Namun tetap bergantung pada:

- TLS benar
- vendor page benar
- tidak ada compromise di website
- algorithm cukup kuat
- user benar membandingkan digest

---

### 7.3 Boundary Lebih Kuat

```text
file + signed manifest
signature verified with trusted public key
```

Di sini integrity dan authenticity lebih kuat karena manifest tidak hanya di-hash, tetapi ditandatangani.

---

### 7.4 Boundary untuk Database

Misalnya database record memiliki kolom:

```text
record_data
record_hash = SHA-256(record_data)
```

Jika attacker punya akses update database, ia bisa mengubah dua-duanya.

Agar hash berguna, ada beberapa opsi:

1. Hash disimpan di append-only external ledger.
2. Hash chain dikirim ke audit system terpisah.
3. Record di-MAC dengan key yang tidak ada di database.
4. Record ditandatangani oleh signing service.
5. Hash root dipublish ke storage/authority yang tidak bisa dimodifikasi oleh actor database.

Mental model:

> Integrity check harus melintasi trust boundary. Kalau data dan bukti integrity berada dalam kompromi domain yang sama, bukti itu ikut kompromi.

---

## 8. Java API: `MessageDigest`

### 8.1 Basic Usage

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class Sha256Example {
    public static void main(String[] args) throws NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] input = "hello".getBytes(StandardCharsets.UTF_8);
        byte[] digest = md.digest(input);
        String hex = HexFormat.of().formatHex(digest);
        System.out.println(hex);
    }
}
```

Important details:

- Always specify charset for text.
- Do not rely on platform default encoding.
- Use standard algorithm names.
- Encode digest consistently, usually hex or Base64.

---

### 8.2 Incremental Update

```java
MessageDigest md = MessageDigest.getInstance("SHA-256");
md.update(part1);
md.update(part2);
md.update(part3);
byte[] digest = md.digest();
```

This computes:

```text
SHA-256(part1 || part2 || part3)
```

But be careful: concatenation can be ambiguous if fields are not length-delimited or canonicalized.

Bad:

```text
H(userId + role)
```

Because:

```text
userId="ab", role="c" -> "abc"
userId="a", role="bc" -> "abc"
```

Better:

```text
H(length(userId) || userId || length(role) || role)
```

or canonical serialization.

---

### 8.3 `MessageDigest` State

`MessageDigest` is stateful.

After `digest()` is called, the digest is reset.

Avoid sharing one instance across threads.

Bad:

```java
public final class BadHasher {
    private static final MessageDigest DIGEST = MessageDigest.getInstance("SHA-256");
}
```

This is unsafe because `MessageDigest` instances are mutable and not generally thread-safe.

Better:

```java
public static byte[] sha256(byte[] input) {
    try {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        return md.digest(input);
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException("SHA-256 is not available", e);
    }
}
```

For high-throughput systems, consider `ThreadLocal<MessageDigest>` carefully, but avoid hidden state misuse.

---

## 9. Hex, Base64, and Binary Digest Representation

Digest is binary.

```java
byte[] digest
```

To display or store it, encode it.

### 9.1 Hex

```java
String hex = HexFormat.of().formatHex(digest);
```

Pros:

- human-friendly
- common in CLI tools
- case-insensitive if normalized

Cons:

- 2 chars per byte
- larger than Base64

---

### 9.2 Base64

```java
String b64 = Base64.getEncoder().encodeToString(digest);
```

Pros:

- compact
- common in JSON/token contexts

Cons:

- variants matter: standard, URL-safe, padded, unpadded
- harder for humans to compare manually

---

### 9.3 Binary Storage

In database, binary column can be better:

```text
RAW(32)
BYTEA
VARBINARY(32)
BINARY(32)
```

Pros:

- compact
- avoids case/normalization issues

Cons:

- less convenient for manual inspection

Guideline:

- Use binary for internal storage.
- Use hex for CLI, manifest, audit report.
- Use Base64URL for URL/token contexts.

---

## 10. Charset and Text Hashing

Never do:

```java
text.getBytes()
```

It uses platform default charset.

Always do:

```java
text.getBytes(StandardCharsets.UTF_8)
```

But charset is not the only issue. Unicode text can have different representations that render similarly.

Example:

```text
é
```

Can be:

```text
U+00E9
```

or:

```text
e + combining accent
```

If your system hashes human text, decide whether to normalize.

```java
import java.text.Normalizer;

String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
byte[] bytes = normalized.getBytes(StandardCharsets.UTF_8);
```

But normalization itself is domain-sensitive. Do not normalize binary evidence files. Do normalize structured user text if business semantics require it.

---

## 11. Canonicalization Before Hashing

Hash is byte-sensitive.

This means these may produce different hashes:

```json
{"a":1,"b":2}
```

```json
{
  "b": 2,
  "a": 1
}
```

Semantically same? Maybe. Byte-wise same? No.

If integrity is based on semantic content, you need canonicalization.

---

### 11.1 Why Canonicalization Matters

Without canonicalization:

- same logical record may hash differently
- signature verification fails across systems
- audit export becomes non-reproducible
- attacker may exploit parser differences
- replay/dedup may fail

Canonicalization turns logical data into exactly one byte representation.

```text
logical object -> canonical bytes -> hash
```

---

### 11.2 Canonicalization Rules

A canonical format should define:

1. Field order.
2. Encoding.
3. Whitespace policy.
4. Numeric representation.
5. Date/time representation.
6. Null handling.
7. Unicode normalization.
8. Escaping rules.
9. Binary encoding.
10. Version marker.

---

### 11.3 Bad Manual Concatenation

Bad:

```java
String canonical = caseId + status + officerId + timestamp;
```

Problems:

- ambiguous boundaries
- null ambiguity
- delimiter escaping issue
- locale/time formatting issue
- no versioning

Better:

```text
version=1
caseId length + caseId bytes
status enum ordinal/name in stable format
officerId length + officerId bytes
timestamp as Instant ISO-8601 UTC
```

or use a stable canonical JSON/CBOR/protobuf strategy.

---

### 11.4 Delimiter Ambiguity

This looks okay:

```text
caseId|status|officerId
```

Until field contains `|`.

Then you need escaping.

If you use escaping, you need canonical escaping rules.

Often better:

```text
length-prefix each field
```

Example:

```text
8:CASE-1238:APPROVED5:U1001
```

But even this needs clear byte encoding and versioning.

---

## 12. Hashing Files in Java

### 12.1 Simple Streaming File Hash

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class FileHashing {
    private static final int BUFFER_SIZE = 1024 * 64;

    public static String sha256Hex(Path path) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_SIZE];

            try (InputStream in = Files.newInputStream(path)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    md.update(buffer, 0, read);
                }
            }

            return HexFormat.of().formatHex(md.digest());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to hash file: " + path, e);
        }
    }
}
```

Why streaming?

- avoids loading entire file
- handles large uploads
- safer for memory pressure
- supports pipeline processing

---

### 12.2 DigestInputStream

Java also provides `DigestInputStream`.

```java
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;

MessageDigest md = MessageDigest.getInstance("SHA-256");
try (InputStream raw = Files.newInputStream(path);
     DigestInputStream in = new DigestInputStream(raw, md)) {
    in.transferTo(OutputStream.nullOutputStream());
}
byte[] digest = md.digest();
```

This is useful when you already stream data and want digest as side effect.

But avoid hiding digest logic too deeply. Security-critical integrity should be visible in code review.

---

### 12.3 Hash While Writing

For upload pipelines, hash while writing to temp file:

```java
public static String storeAndHash(InputStream upload, Path tempFile) {
    try {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];

        try (var out = Files.newOutputStream(tempFile)) {
            int read;
            while ((read = upload.read(buffer)) != -1) {
                md.update(buffer, 0, read);
                out.write(buffer, 0, read);
            }
        }

        return HexFormat.of().formatHex(md.digest());
    } catch (Exception e) {
        throw new IllegalStateException("Failed to store and hash upload", e);
    }
}
```

But remember:

- hash validates bytes received, not whether uploader is authorized
- hash validates later equality, not malware safety
- hash validates byte identity, not business correctness

---

## 13. Comparing Digests Safely

### 13.1 Timing-Safe Compare

For public file checksums, timing-safe compare is usually not critical.

For secret-derived values, MAC tags, password hashes, tokens, or authentication checks, use constant-time comparison.

Java provides:

```java
MessageDigest.isEqual(expected, actual)
```

Example:

```java
if (!MessageDigest.isEqual(expectedDigest, actualDigest)) {
    throw new SecurityException("Digest mismatch");
}
```

Do not use:

```java
Arrays.equals(secretTag1, secretTag2)
```

for secret-authentication contexts unless you have verified timing behavior is acceptable for that context.

---

### 13.2 Normalize Encoded Digest Before Compare

If comparing hex strings:

- decode both to bytes then compare
- or normalize case and length strictly

Better:

```java
byte[] expected = HexFormat.of().parseHex(expectedHex.toLowerCase(Locale.ROOT));
byte[] actual = sha256Bytes(data);
boolean ok = MessageDigest.isEqual(expected, actual);
```

Validate exact length:

```text
SHA-256 hex length = 64 chars
SHA-256 byte length = 32 bytes
```

---

## 14. Algorithm Selection

### 14.1 Recommended Defaults

For general application integrity:

- SHA-256 is usually default.
- SHA-384 or SHA-512 can be used if policy requires larger digest.
- SHA3-256 is valid where SHA-3 is required or useful.

For password storage:

- do not use raw SHA-256/SHA-512.
- use Argon2id, bcrypt, scrypt, or PBKDF2 with proper parameters.

For keyed integrity:

- use HMAC-SHA-256 or HMAC-SHA-384.

For signatures:

- hash choice depends on signature algorithm and security level.

---

### 14.2 Avoid

Avoid for security-sensitive use:

- MD5
- SHA-1
- CRC32
- Adler32
- `String.hashCode()`
- custom hash
- truncated digest without explicit risk analysis

MD5/SHA-1 may still appear in legacy fingerprinting or non-security contexts, but should trigger review.

---

### 14.3 Truncating Hashes

Sometimes systems truncate hashes for IDs.

Example:

```text
sha256 digest -> first 12 bytes -> display id
```

This is not automatically wrong, but must be analyzed.

Questions:

1. Is collision dangerous?
2. How many objects exist?
3. Is attacker choosing inputs?
4. Is this only display convenience or security boundary?
5. What happens on collision?

If used as database identifier, collision handling must exist.
If used as security proof, truncation must be justified.

---

## 15. Hashing Structured Records

Suppose you want integrity for a regulatory case decision record:

```text
caseId
applicationId
decision
reasonCodes
officerId
decidedAt
version
```

Bad approach:

```java
String raw = caseId + applicationId + decision + reasonCodes + officerId + decidedAt;
String digest = sha256Hex(raw.getBytes(UTF_8));
```

Problems:

- ambiguous boundaries
- unstable ordering of `reasonCodes`
- timezone issue
- enum renaming issue
- locale formatting issue
- missing schema version
- no domain separation

Better approach:

```text
RecordDigestV1:
  domain = "ACEAS_CASE_DECISION_RECORD"
  schemaVersion = 1
  caseId = UTF-8 length-prefixed string
  applicationId = UTF-8 length-prefixed string
  decision = stable enum code
  reasonCodes = sorted list of stable codes
  officerId = stable principal id
  decidedAt = Instant UTC epoch millis or ISO-8601 UTC
```

Then hash canonical bytes.

---

## 16. Domain Separation

Domain separation prevents same hash function from being reused ambiguously across contexts.

Bad:

```text
SHA-256(canonicalData)
```

Better:

```text
SHA-256("CASE_DECISION_RECORD_V1" || canonicalData)
```

Why?

Because the same bytes may appear in different contexts.

Domain separation makes it clear the digest belongs to a specific purpose.

Example domains:

```text
FILE_UPLOAD_SHA256_V1
CASE_DECISION_RECORD_V1
AUDIT_EVENT_HASH_V1
MANIFEST_ENTRY_HASH_V1
RELEASE_ARTIFACT_HASH_V1
```

This helps:

- avoid cross-protocol confusion
- improve audit clarity
- support migration/versioning
- reduce accidental digest reuse

---

## 17. Hash Chaining

Hash chaining links records so that changing an old record changes all later hashes.

### 17.1 Basic Chain

```text
hash_0 = SHA-256("GENESIS")
hash_n = SHA-256(hash_{n-1} || canonical(record_n))
```

Property:

- If record 3 changes, hash 3 changes.
- Then hash 4, 5, 6... no longer match.

This is tamper-evident if chain head is protected.

---

### 17.2 Java-Oriented Audit Chain Example

```java
public record AuditEvent(
        long sequence,
        String actorId,
        String action,
        String entityType,
        String entityId,
        Instant occurredAt,
        String payloadHashHex
) {}
```

Chain input:

```text
AUDIT_CHAIN_V1
previousHash
sequence
actorId
action
entityType
entityId
occurredAt
payloadHash
```

Important invariant:

```text
sequence_n = sequence_{n-1} + 1
previousHash_n = hash_{n-1}
hash_n = H(domain || previousHash_n || canonical(event_n))
```

---

### 17.3 Hash Chain Limitations

Hash chain does not prevent tampering if attacker can:

- rewrite entire chain
- rewrite chain head
- reset sequence
- modify canonicalization code
- modify verification job
- modify storage and audit metadata

Therefore, protect chain head by:

1. Writing periodic root hash to external append-only system.
2. Signing periodic checkpoints.
3. Sending checkpoint to independent audit service.
4. Publishing checkpoint to immutable object storage with retention lock.
5. Storing checkpoint in separate security domain.

---

## 18. Merkle Tree Mental Model

Hash chain is linear.
Merkle tree is hierarchical.

```text
       root
      /    
   h12      h34
  /  \     /  \
h1   h2   h3   h4
```

Useful when:

- many files need one integrity root
- proof of inclusion is needed
- partial verification is required
- batch export has many records

Example:

```text
case-export-manifest-root = MerkleRoot(file1Hash, file2Hash, ..., fileNHash)
```

If root is signed, verifier can check individual file membership.

Merkle trees are more advanced than basic hashing but useful for:

- evidence package
- release bundle
- batch reconciliation
- ledger-like audit
- large document set verification

---

## 19. Integrity Manifest

An integrity manifest lists files/items and their digests.

Example:

```text
manifest-version: 1
algorithm: SHA-256
created-at: 2026-06-16T00:00:00Z
entries:
  - path: evidence/case-123/document-001.pdf
    size: 182391
    sha256: 9e107d9d372bb6826bd81d3542a419d6...
  - path: evidence/case-123/photo-001.jpg
    size: 981222
    sha256: 4e07408562bedb8b60ce05c1decfe3ad...
```

Manifest helps verify:

- file content unchanged
- expected file set complete
- unexpected files detected
- size mismatch detected
- algorithm known

But manifest itself must be protected.

Options:

1. Store manifest in stronger boundary.
2. MAC the manifest.
3. Sign the manifest.
4. Store manifest root hash in independent audit system.

---

## 20. Manifest Design Checklist

A good manifest should include:

1. Manifest schema version.
2. Hash algorithm.
3. Canonical path format.
4. File size.
5. MIME/media type if needed.
6. Created timestamp in UTC.
7. Generator identity/version.
8. Entry ordering rule.
9. Digest encoding.
10. Signature/MAC metadata if protected.

Avoid:

- OS-dependent path separator ambiguity.
- Case-insensitive path ambiguity.
- Relative path traversal.
- Hidden file omission.
- Symbolic link ambiguity.
- Locale-dependent sorting.
- Missing algorithm field.
- Mixing MD5/SHA-256 without policy.

---

## 21. Path Canonicalization for File Manifests

File manifests are vulnerable to path confusion.

Bad paths:

```text
../secret.txt
./evidence/file.pdf
evidence//file.pdf
EVIDENCE/file.pdf
evidence/ＦＩＬＥ.pdf
```

Rules should define:

- use `/` as separator
- no absolute paths
- no `..`
- no empty segment
- no symlink following unless explicitly allowed
- Unicode normalization policy
- case sensitivity policy
- allowed path character set

Example canonical path rule:

```text
Manifest paths are UTF-8 NFC strings, slash-separated, relative to package root, with no empty segment, no '.', no '..', no leading slash, and no trailing slash.
```

---

## 22. Hashing and Deduplication

Hash is often used for deduplication:

```text
if sha256(file) already exists, reuse stored blob
```

This is usually fine, but consider:

1. Collision handling.
2. Privacy leakage.
3. User-controlled input.
4. Cross-tenant deduplication risk.
5. Existence oracle.

Cross-tenant dedup can leak information:

> If uploading known file returns “already exists”, user may infer another tenant has same file.

Mitigation:

- tenant-scoped dedup
- access-control before existence response
- no observable dedup response
- keyed hash for lookup in sensitive contexts

---

## 23. Hashing and Idempotency

You may derive idempotency key from request content.

Example:

```text
idempotencyKey = SHA-256(canonicalCommand)
```

This can work if:

- canonical command is stable
- caller identity is included
- operation type is included
- time/window semantics are clear
- replay behavior is explicit

Bad:

```text
SHA-256(amount + account)
```

Better:

```text
SHA-256("PAYMENT_COMMAND_V1" || tenantId || callerId || commandId || canonicalBody)
```

But for public APIs, prefer client-supplied idempotency key plus server-side validation.

---

## 24. Hashing and Replay Protection

Hash alone does not prevent replay.

Example:

```text
POST /approve
body: {caseId: 123}
hash: SHA-256(body)
```

Attacker can replay the same body and same hash.

Replay protection needs:

- nonce
- timestamp
- sequence number
- idempotency key
- server-side seen-set
- expiry window
- MAC/signature covering replay fields

This moves into Part 8 and Part 26, but hash mental model is needed here:

> Hash proves equality, not freshness.

---

## 25. Hashing and Privacy

Hashing PII does not automatically anonymize it.

Example:

```text
SHA-256(email)
SHA-256(phoneNumber)
SHA-256(nationalId)
```

If input space is predictable, attacker can dictionary attack.

Bad assumption:

> “We hashed NRIC/email/phone, so it is anonymous.”

Better framing:

> “This is pseudonymized at best, and may be reversible by guessing unless protected by keyed transformation or strong privacy design.”

Options:

- HMAC with secret pepper for lookup token
- format-preserving tokenization service
- irreversible deletion if not needed
- per-tenant secret
- access-controlled re-identification

But do not invent privacy crypto casually. Privacy design depends on legal, operational, and data model constraints.

---

## 26. Hashing and Passwords

Raw hash is bad for password storage.

Bad:

```java
String stored = sha256Hex(password.getBytes(UTF_8));
```

Why bad?

- SHA-256 is fast.
- Passwords have low entropy.
- Attackers can use GPU/ASIC/dictionary attacks.
- Same password gives same hash unless salted.

Better:

- Argon2id
- bcrypt
- scrypt
- PBKDF2 with strong parameters if required by platform/compliance

This is Part 6.

For now remember:

> Cryptographic hash for file/message integrity is not the same as password hashing.

---

## 27. Hash Length Extension Attacks

Some hash constructions like SHA-256 are vulnerable to length extension when misused as MAC:

Bad:

```text
tag = SHA-256(secret || message)
```

An attacker who knows `tag` and `message` may be able to compute a valid tag for:

```text
message || attackerControlledSuffix
```

without knowing secret.

Correct:

```text
tag = HMAC-SHA-256(secret, message)
```

Lesson:

> Do not build your own MAC from hash. Use HMAC.

---

## 28. Java Implementation: A Small Hashing Utility

A disciplined utility can prevent common mistakes.

```java
package com.example.security.digest;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;

public final class Digests {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final HexFormat HEX = HexFormat.of();

    private Digests() {}

    public static byte[] sha256(byte[] input) {
        Objects.requireNonNull(input, "input");
        return newDigest("SHA-256").digest(input);
    }

    public static byte[] sha256Utf8(String input) {
        Objects.requireNonNull(input, "input");
        return sha256(input.getBytes(StandardCharsets.UTF_8));
    }

    public static String sha256Hex(byte[] input) {
        return HEX.formatHex(sha256(input));
    }

    public static String sha256HexUtf8(String input) {
        return HEX.formatHex(sha256Utf8(input));
    }

    public static byte[] sha256File(Path path) throws IOException {
        Objects.requireNonNull(path, "path");
        MessageDigest digest = newDigest("SHA-256");
        byte[] buffer = new byte[BUFFER_SIZE];

        try (InputStream in = Files.newInputStream(path)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }

        return digest.digest();
    }

    public static String sha256FileHex(Path path) throws IOException {
        return HEX.formatHex(sha256File(path));
    }

    public static boolean constantTimeEquals(byte[] expected, byte[] actual) {
        Objects.requireNonNull(expected, "expected");
        Objects.requireNonNull(actual, "actual");
        return MessageDigest.isEqual(expected, actual);
    }

    private static MessageDigest newDigest(String algorithm) {
        try {
            return MessageDigest.getInstance(algorithm);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(algorithm + " is not available", e);
        }
    }
}
```

Notes:

- No static shared `MessageDigest` instance.
- Explicit UTF-8.
- Streaming file support.
- Constant-time byte comparison helper.
- Throws checked `IOException` for file reading.

---

## 29. Integrity Verification Workflow

A robust verification workflow should separate:

1. Fetch data.
2. Fetch trusted expected digest/manifest.
3. Canonicalize if needed.
4. Compute actual digest.
5. Compare digest safely.
6. Enforce failure policy.
7. Record verification result.
8. Avoid using data if verification fails.

Example file verification:

```java
public static void verifySha256(Path file, String expectedHex) throws IOException {
    byte[] expected = HexFormat.of().parseHex(expectedHex);
    byte[] actual = Digests.sha256File(file);

    if (!MessageDigest.isEqual(expected, actual)) {
        throw new SecurityException("SHA-256 mismatch for file: " + file);
    }
}
```

But operationally:

- Where did `expectedHex` come from?
- Is it signed?
- Is it fetched via trusted channel?
- Is algorithm fixed or in manifest?
- What happens on mismatch?
- Is mismatch logged without leaking sensitive path/data?

---

## 30. Mismatch Handling

Digest mismatch is not a “minor warning” if integrity matters.

Possible causes:

1. Accidental corruption.
2. Partial transfer.
3. Wrong file version.
4. Encoding/canonicalization mismatch.
5. Malicious tampering.
6. Wrong algorithm.
7. Manifest mismatch.
8. Race condition while file is being written.

Failure policy:

- quarantine file
- stop processing
- alert operator/security team
- preserve evidence
- do not auto-retry blindly if malicious tampering possible
- include correlation ID
- avoid logging full sensitive content

---

## 31. Race Conditions in File Hashing

Hashing a file that is concurrently modified can produce inconsistent results.

Problems:

- file changes while reading
- symlink swap
- path replaced after validation
- temp file not atomically moved

Mitigations:

1. Write upload to private temp file.
2. Compute hash before publishing.
3. Use atomic move.
4. Avoid following symlink if not expected.
5. Verify file size before/after hashing if needed.
6. Use file locks only if semantics are clear.
7. Prefer content-addressed immutable storage.

Example pipeline:

```text
receive stream
-> write to temp file in private directory
-> fsync if required
-> compute sha256
-> validate against manifest/policy
-> move atomically to content-addressed path
-> record digest in database/audit system
```

---

## 32. Content-Addressed Storage Pattern

Store file by digest:

```text
/storage/sha256/ab/cd/abcdef...
```

Benefits:

- natural dedup
- immutable identity
- easy verification
- corruption detection

Rules:

1. Store only after full hash computed.
2. Path derived from digest, not user filename.
3. Original filename stored as metadata, not storage path.
4. Metadata access-controlled.
5. Digest collision handling policy exists.
6. Tenant leakage considered.

---

## 33. Hashing in Build and Supply Chain

Hash appears in:

- Maven artifact checksums
- Gradle dependency verification
- container image digests
- SBOM references
- release checksum files
- signed provenance

Hash tells you an artifact matches expected bytes.

But the stronger question is:

> Who produced the expected digest, and why do I trust it?

For supply chain integrity, combine:

- cryptographic hash
- signature
- provenance
- trusted repository
- reproducible build where possible
- policy enforcement

This is developed later in Part 27-29.

---

## 34. Hashing in Audit Trails

For audit trail, hash can support tamper evidence.

But avoid weak pattern:

```text
audit_event_hash = SHA-256(audit_event_json)
```

stored in same table.

If database admin or compromised app can rewrite both event and hash, it is weak.

Better:

```text
hash_n = H(domain || previous_hash || canonical_event_n)
checkpoint = Sign(privateKey, hash_n || sequence_n || timestamp)
checkpoint stored externally
```

Then attacker must modify:

- event table
- chain records
- checkpoint store
- signing system
- verification history

This increases tamper difficulty and detection probability.

---

## 35. Hashing in Distributed Systems

Hash is useful for:

- deduplication
- idempotency
- event payload fingerprint
- reconciliation
- outbox verification
- detecting divergence between services
- comparing snapshots

But hash cannot solve:

- concurrent update conflict alone
- authorization correctness
- replay prevention alone
- semantic consistency
- exactly-once delivery
- clock trust

Example useful pattern:

```text
publisher computes payloadHash
outbox stores payloadHash
consumer records payloadHash
reconciliation compares producer/consumer hashes
```

This detects mismatch but does not prove authenticity unless combined with MAC/signature or trusted broker boundary.

---

## 36. Common Misuse Patterns

### 36.1 Using Hash as Authentication

Bad:

```text
client sends payload + SHA-256(payload)
```

Fix:

```text
client sends payload + HMAC(secret, canonicalPayload)
```

---

### 36.2 Hashing Passwords with SHA-256

Bad:

```text
storedPassword = SHA-256(password)
```

Fix:

```text
Argon2id/bcrypt/scrypt/PBKDF2 + salt + work factor
```

---

### 36.3 Hashing Non-Canonical JSON

Bad:

```text
SHA-256(jsonString)
```

when JSON can be serialized differently.

Fix:

```text
canonical JSON/CBOR/protobuf bytes -> hash
```

---

### 36.4 Using MD5 for Security

Bad:

```text
MD5(file) as tamper-proof integrity
```

Fix:

```text
SHA-256 or better, plus signed manifest if authenticity needed
```

---

### 36.5 Storing Data and Hash in Same Compromise Domain

Bad:

```text
record + SHA-256(record) in same mutable table
```

Fix:

```text
MAC/signature/checkpoint/external append-only boundary
```

---

### 36.6 Ambiguous Concatenation

Bad:

```text
H(a + b + c)
```

Fix:

```text
H(domain || length(a)||a || length(b)||b || length(c)||c)
```

---

### 36.7 Treating Hash as Anonymization

Bad:

```text
anonymousUserId = SHA-256(email)
```

Fix:

```text
privacy threat model + HMAC/tokenization/minimization/access control
```

---

### 36.8 Truncated Hash Without Collision Policy

Bad:

```text
id = first8Chars(SHA-256(payload))
```

Fix:

```text
sufficient length + collision handling + threat analysis
```

---

### 36.9 Logging Hash as If It Is Always Safe

A hash of sensitive low-entropy data can leak information.

Bad:

```text
log.info("emailHash={}", sha256(email));
```

An attacker can brute-force common emails.

Fix:

- do not log if not needed
- use keyed pseudonymization if justified
- rotate secret carefully
- apply privacy policy

---

## 37. Review Heuristics

When reviewing Java code using `MessageDigest`, ask:

1. What security property is intended?
2. Is hash being used where MAC/signature is required?
3. Where is expected digest stored?
4. Can attacker modify both data and digest?
5. Is input canonicalized?
6. Is charset explicit?
7. Is algorithm acceptable?
8. Is `MessageDigest` instance shared unsafely?
9. Is comparison timing-safe where relevant?
10. Is failure policy safe?
11. Is digest truncated?
12. Is hash used on password/secret/PII incorrectly?
13. Is replay/freshness incorrectly assumed?
14. Is domain separation present?
15. Is migration/versioning planned?

---

## 38. Production Checklist

### 38.1 Algorithm

- [ ] Use SHA-256 or stronger for general digest.
- [ ] Avoid MD5/SHA-1 for security.
- [ ] Do not use CRC/Adler/String.hashCode for adversarial integrity.
- [ ] Use password hashing algorithm for passwords.
- [ ] Use HMAC/signature when authenticity is required.

### 38.2 Input

- [ ] Use explicit byte encoding.
- [ ] Canonicalize structured data.
- [ ] Include schema version.
- [ ] Include domain separation string.
- [ ] Avoid ambiguous concatenation.

### 38.3 Storage and Boundary

- [ ] Store digest in stronger/different trust boundary if integrity matters.
- [ ] Protect manifest with MAC/signature if adversarial tampering is possible.
- [ ] Do not store record and hash only in same mutable compromise domain.
- [ ] Protect chain head/checkpoints.

### 38.4 Implementation

- [ ] Do not share mutable `MessageDigest` across threads.
- [ ] Stream large files.
- [ ] Compare secret-related digests/tags with constant-time comparison.
- [ ] Validate digest length and encoding.
- [ ] Handle mismatch as security-relevant event.

### 38.5 Operations

- [ ] Log mismatch with correlation ID.
- [ ] Quarantine suspicious payload.
- [ ] Preserve evidence on mismatch.
- [ ] Monitor digest mismatch rate.
- [ ] Document algorithm migration path.

---

## 39. Mini Case Study: Evidence File Intake

### 39.1 Scenario

A Java service receives evidence files for regulatory cases.

Requirements:

1. File must not be modified after intake.
2. Later reviewers must verify file identity.
3. Export package must prove completeness.
4. Audit trail must detect tampering.
5. External party may need to verify package.

---

### 39.2 Weak Design

```text
Upload file
-> store original filename
-> compute SHA-256
-> save file and hash in same DB/storage
```

Problems:

- hash and file may be modified by same actor
- original filename can cause path confusion
- no manifest
- no signature
- no chain/checkpoint
- no canonical metadata
- no export verification protocol

---

### 39.3 Stronger Design

```text
1. Receive file stream.
2. Store to private temp location.
3. Compute SHA-256 while streaming.
4. Validate size/type/policy.
5. Move to immutable content-addressed storage by digest.
6. Store metadata separately:
   - caseId
   - evidenceId
   - originalFilename
   - contentDigest
   - size
   - mediaType
   - uploadedBy
   - uploadedAt
7. Append audit event:
   - EVIDENCE_FILE_ACCEPTED
   - payloadHash
   - previousAuditHash
   - auditHash
8. Periodically sign audit checkpoint.
9. For export:
   - generate canonical manifest
   - include file entries
   - sign manifest
   - provide verification tool/instructions
```

---

### 39.4 Security Properties

This design gives:

- file byte identity
- dedup-compatible storage
- tamper-evident audit chain
- package completeness via manifest
- external verification via signature
- better forensic trail

Still does not automatically give:

- malware safety
- business validity
- authorization correctness
- perfect non-repudiation
- protection if signing key is compromised

Those require additional controls.

---

## 40. Mini Case Study: Case Decision Digest

### 40.1 Scenario

You want to store digest of final case decision.

Decision fields:

```text
caseId
finalOutcome
reasonCodes
decisionMaker
approvedAt
```

### 40.2 Design

Canonical bytes:

```text
CASE_DECISION_DIGEST_V1
caseId length + caseId UTF-8
finalOutcome stable code
reasonCodes sorted stable code list
decisionMaker stable principal id
approvedAt Instant UTC
```

Digest:

```text
decisionDigest = SHA-256(canonicalBytes)
```

Then protect digest by:

- inserting into audit event
- including previous audit hash
- checkpointing chain head
- signing final decision document if external verification is required

### 40.3 Invariant

```text
For a finalized case decision, any later reconstruction of the canonical decision record must produce the same digest unless the decision was legitimately superseded with a new versioned event.
```

This invariant is stronger than “there is a hash column”.

---

## 41. Mental Model Summary

Hash is best understood as:

```text
stable bytes -> fixed digest
```

But security depends on context:

```text
hash security = primitive strength + canonicalization + boundary + threat model + failure handling
```

Remember:

1. Hash is not encryption.
2. Hash is not authentication.
3. Hash is not signature.
4. Hash is not password storage.
5. Hash is not anonymization.
6. Hash does not provide freshness.
7. Hash does not help if attacker can alter both data and digest.
8. Hash is powerful when combined with trust boundaries, MAC, signature, manifest, chain, or checkpoint.

---

## 42. Practical Decision Table

| Requirement | Use |
|---|---|
| Detect accidental file corruption | CRC/checksum may be enough |
| Detect adversarial file tampering | SHA-256 with trusted digest or signed manifest |
| Verify payload came from shared-secret party | HMAC |
| Verify payload signed by private-key holder | Digital signature |
| Store password verifier | Argon2id/bcrypt/scrypt/PBKDF2, not raw SHA |
| Deduplicate large blobs | SHA-256 content address, with collision policy |
| Build tamper-evident audit log | Hash chain + protected checkpoint/signature |
| Verify release artifact | SHA-256 + trusted signature/provenance |
| Pseudonymize predictable PII | Usually HMAC/tokenization, not raw hash |
| Prevent replay | Nonce/timestamp/sequence + MAC/signature/server state |

---

## 43. Review Questions

Use these to test your understanding:

1. If file and `.sha256` file are downloaded from the same compromised server, what does verification prove?
2. Why is `SHA-256(password)` not acceptable for password storage?
3. Why is `SHA-256(secret || message)` not a safe MAC?
4. Why does JSON need canonicalization before hashing/signing?
5. What is the difference between collision resistance and preimage resistance?
6. Why might hashing an email address fail to anonymize it?
7. How can hash chaining detect audit record tampering?
8. Why must the chain head/checkpoint be protected separately?
9. When is digest truncation acceptable?
10. What is the security difference between checksum, digest, MAC, and signature?

---

## 44. References

- Oracle Java SE API: `java.security.MessageDigest`.
- Oracle Java Security Standard Algorithm Names.
- NIST FIPS 180-4: Secure Hash Standard.
- NIST FIPS 202: SHA-3 Standard: Permutation-Based Hash and Extendable-Output Functions.
- OWASP Cryptographic Storage Cheat Sheet.
- OWASP Password Storage Cheat Sheet.
- OWASP Top 10 2021 A02: Cryptographic Failures.
- OWASP Key Management Cheat Sheet.

---

## 45. Closing

Part 5 membangun dasar integrity dari sisi hash/digest.

Inti paling penting:

> Hash hanya menjawab “apakah bytes sama”, bukan “apakah bytes benar, sah, fresh, rahasia, atau berasal dari pihak terpercaya.”

Untuk membangun sistem aman, hash harus dipasang pada boundary yang benar dan sering perlu dikombinasikan dengan MAC, signature, manifest, chain, checkpoint, policy, dan operational response.

Pada Part 6, kita akan masuk ke topik yang sering disalahpahami: **Password Storage, Password Verification, and Secret-Derived Keys**.

Status seri: **belum selesai**. Ini adalah **Part 5 dari 35**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-004](./learn-java-security-cryptography-integrity-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-006](./learn-java-security-cryptography-integrity-part-006.md)
