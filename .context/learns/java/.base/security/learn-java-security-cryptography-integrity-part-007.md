# learn-java-security-cryptography-integrity-part-007

# Part 7 — Symmetric Encryption in Java: AES, Modes, Padding, AEAD

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `Part 7 dari 35`  
> Status seri: **belum selesai**  
> Fokus: symmetric encryption, AES, mode operasi, padding, AEAD, payload format, dan misuse-resistant Java implementation mindset.

---

## 0. Tujuan Part Ini

Part sebelumnya membangun fondasi:

- Part 0: security mental model.
- Part 1: Java Security Architecture.
- Part 2: threat modeling.
- Part 3: cryptography guarantee.
- Part 4: randomness, nonce, IV, salt, token.
- Part 5: hash, digest, fingerprint, checksum, integrity boundary.
- Part 6: password storage dan secret-derived keys.

Part ini masuk ke symmetric encryption: cara melindungi **confidentiality** data menggunakan key yang sama untuk encrypt dan decrypt.

Namun tujuan part ini **bukan** sekadar bisa menulis:

```java
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
```

Tujuan sebenarnya:

1. Memahami **security property** apa yang diberikan symmetric encryption.
2. Memahami kenapa **mode operasi** lebih penting daripada sekadar memilih AES.
3. Memahami kenapa **AEAD** seperti AES-GCM atau ChaCha20-Poly1305 menjadi default modern untuk banyak kasus.
4. Memahami format payload terenkripsi yang bisa dioperasikan, dirotasi, dimigrasi, diaudit, dan diverifikasi.
5. Menghindari kesalahan Java crypto yang umum: ECB, IV reuse, unauthenticated ciphertext, padding oracle, hardcoded key, silent downgrade, dan format tanpa versioning.
6. Mampu mendesain encryption layer yang realistis untuk Java enterprise system.

Target mental model:

> Encryption yang aman bukan hanya `algorithm + key`. Encryption yang aman adalah kontrak sistem: key benar, mode benar, nonce/IV benar, authentication tag diverifikasi, context di-bind, payload punya format, error tidak bocor, dan lifecycle operasional dapat dipertanggungjawabkan.

---

## 1. Apa Itu Symmetric Encryption?

Symmetric encryption adalah mekanisme di mana **key yang sama** digunakan untuk mengenkripsi dan mendekripsi data.

```text
plaintext + key  -> encryption -> ciphertext
ciphertext + key -> decryption -> plaintext
```

Contoh requirement:

- Menyimpan field sensitif di database.
- Mengenkripsi file sebelum dikirim ke sistem eksternal.
- Melindungi payload cache.
- Melindungi backup application-level.
- Membuat envelope encryption dengan data key.
- Membungkus data sebelum dikirim ke queue yang tidak sepenuhnya dipercaya.

Symmetric encryption biasanya jauh lebih cepat daripada asymmetric encryption dan cocok untuk data berukuran besar.

Namun symmetric encryption punya masalah besar:

> Siapa pun yang punya key bisa decrypt dan biasanya juga bisa encrypt data valid.

Artinya, security sistem sangat bergantung pada:

1. Key generation.
2. Key storage.
3. Key access control.
4. Key rotation.
5. Key separation.
6. Key compromise response.
7. Payload format.
8. Mode operasi.
9. Nonce/IV discipline.

---

## 2. Security Guarantee yang Diharapkan

Saat orang berkata “data dienkripsi”, sering kali mereka mengira semua aman. Ini framing yang lemah.

Pertanyaan yang benar:

> Setelah data dienkripsi, attacker masih bisa melakukan apa?

Symmetric encryption bisa memberi beberapa security property tergantung primitive dan mode:

| Property | Arti | Diberikan oleh encryption biasa? | Diberikan oleh AEAD? |
|---|---|---:|---:|
| Confidentiality | Attacker tidak bisa membaca plaintext | Ya, jika mode benar | Ya |
| Integrity | Attacker tidak bisa mengubah ciphertext menjadi plaintext valid | Tidak selalu | Ya |
| Authenticity | Data berasal dari pihak yang punya key | Tidak selalu | Ya, symmetric authenticity |
| Freshness | Data bukan replay lama | Tidak otomatis | Tidak otomatis, butuh nonce/timestamp/state |
| Non-repudiation | Pengirim tidak bisa menyangkal | Tidak | Tidak, butuh digital signature |

Poin penting:

> Encryption tanpa integrity sering berbahaya, karena attacker mungkin tidak bisa membaca plaintext tetapi bisa mengubah ciphertext dengan efek terkontrol atau memicu oracle.

Contoh:

- CBC tanpa MAC bisa rentan padding oracle.
- CTR tanpa MAC bersifat malleable.
- GCM dengan nonce reuse bisa catastrophic.
- ECB membocorkan pola.

---

## 3. AES: Block Cipher, Bukan Skema Encryption Lengkap

AES adalah block cipher. Ia menerima:

- block input 128-bit;
- key 128/192/256-bit;
- menghasilkan block output 128-bit.

AES sendiri bukan “cara mengenkripsi file panjang”. AES perlu **mode operasi** untuk memproses data yang panjangnya lebih dari satu block.

Mental model:

```text
AES primitive:
  16 bytes in + key -> 16 bytes out

Encryption scheme:
  plaintext arbitrary length
  + key
  + mode
  + IV/nonce
  + padding maybe
  + authentication maybe
  -> ciphertext package
```

Jadi saat engineer berkata “pakai AES”, itu belum cukup. Pertanyaan lanjutannya:

1. AES mode apa?
2. Padding apa?
3. IV/nonce dari mana?
4. IV/nonce disimpan di mana?
5. Integrity dijamin bagaimana?
6. Key dipakai untuk apa saja?
7. Payload punya versioning?
8. Bagaimana decryption failure ditangani?
9. Bagaimana rotation?
10. Bagaimana audit dan migration?

---

## 4. Mode Operasi: Bagian yang Sering Menentukan Aman atau Tidak

Mode operasi menentukan bagaimana block cipher dipakai untuk data panjang.

Beberapa mode penting:

1. ECB.
2. CBC.
3. CTR.
4. GCM.
5. XTS.
6. SIV/GCM-SIV concept.

Tidak semua perlu dipakai di aplikasi Java biasa. Untuk application-layer encryption, default modern umumnya:

```text
AES-GCM jika tersedia dan nonce discipline bisa dijaga.
ChaCha20-Poly1305 jika cocok dengan platform/performance/portability.
```

---

## 5. ECB: Anti-Pattern yang Harus Otomatis Ditolak

ECB = Electronic Codebook.

ECB mengenkripsi setiap block secara independen:

```text
same plaintext block + same key -> same ciphertext block
```

Akibatnya, pattern plaintext bocor.

Contoh mental:

```text
plaintext blocks:
  A A A B C A

ECB ciphertext blocks:
  X X X Y Z X
```

Attacker mungkin tidak tahu A itu apa, tetapi tahu bahwa block yang sama muncul berkali-kali.

Dalam data enterprise, ini membocorkan:

- pola status;
- jenis dokumen;
- template field;
- repeated identifiers;
- structured record;
- format internal;
- perbedaan antar versi data.

Rule:

> Jangan gunakan `AES/ECB/...` untuk data application-level. Treat as security review blocker.

Contoh yang harus ditolak:

```java
Cipher.getInstance("AES/ECB/PKCS5Padding");
```

Bahkan jika key-nya kuat, mode-nya membocorkan struktur.

---

## 6. CBC: Pernah Umum, Sekarang Harus Sangat Hati-Hati

CBC = Cipher Block Chaining.

CBC menggunakan IV dan chaining antar block.

Kelebihan:

- Tidak membocorkan pattern seperti ECB jika IV random dan unik.
- Banyak legacy system mendukungnya.

Masalah:

- Membutuhkan padding untuk plaintext yang tidak kelipatan block.
- Tidak memberikan integrity.
- Rentan padding oracle jika error handling/protocol salah.
- Harus dikombinasikan dengan MAC secara benar.

CBC encryption secara sederhana:

```text
C1 = AES(P1 XOR IV)
C2 = AES(P2 XOR C1)
C3 = AES(P3 XOR C2)
```

Jika ciphertext diubah, plaintext hasil decrypt bisa berubah. Tanpa MAC, sistem mungkin memproses plaintext rusak atau membocorkan informasi lewat error.

### 6.1 Padding Oracle Mental Model

Padding oracle terjadi ketika attacker bisa membedakan:

- ciphertext gagal karena padding salah;
- ciphertext gagal karena MAC/format/business validation salah;
- ciphertext berhasil.

Walaupun attacker tidak punya key, perbedaan respons ini bisa digunakan untuk menebak plaintext.

Contoh sinyal oracle:

```text
400 Invalid padding
401 Invalid token
500 BadPaddingException
403 Signature mismatch
```

Aturan jika terpaksa memakai CBC:

1. Jangan pakai CBC tanpa authentication.
2. Gunakan encrypt-then-MAC, bukan MAC-then-encrypt.
3. Verifikasi MAC sebelum decrypt.
4. Gunakan key terpisah untuk encryption dan MAC.
5. Samakan error response.
6. Jangan log plaintext/ciphertext sensitif.
7. Pertimbangkan migration ke AEAD.

Namun untuk desain baru:

> Gunakan AEAD daripada CBC + HMAC manual, kecuali ada alasan compatibility yang kuat.

---

## 7. CTR: Stream-Like Mode yang Malleable

CTR = Counter mode.

CTR mengubah block cipher menjadi stream cipher-like construction.

Konsep:

```text
keystream = AES(key, nonce || counter)
ciphertext = plaintext XOR keystream
plaintext = ciphertext XOR keystream
```

Kelebihan:

- Tidak butuh padding.
- Bisa parallel.
- Efisien.

Masalah:

- Nonce/counter reuse dengan key yang sama sangat berbahaya.
- Tidak memberikan integrity.
- Malleable: flipping bit pada ciphertext akan flip bit pada plaintext.

Contoh:

```text
ciphertext[i] = plaintext[i] XOR keystream[i]
```

Jika attacker mengubah ciphertext bit tertentu, plaintext bit terkait berubah saat decrypt.

Rule:

> CTR harus dipasangkan dengan MAC/AEAD construction. Jangan pakai CTR telanjang untuk data sensitif.

---

## 8. GCM: Default Modern untuk Banyak Use Case

GCM = Galois/Counter Mode.

AES-GCM adalah AEAD mode: **Authenticated Encryption with Associated Data**.

Ia memberi:

1. Confidentiality untuk plaintext.
2. Integrity untuk ciphertext.
3. Authenticity symmetric terhadap pihak yang memegang key.
4. Binding terhadap AAD.

Komponen AES-GCM:

```text
inputs:
  key
  nonce/IV
  plaintext
  AAD optional

outputs:
  ciphertext
  authentication tag
```

Biasanya di Java, authentication tag digabung di akhir output `doFinal()`.

### 8.1 Apa Itu AAD?

AAD = Additional Authenticated Data.

AAD tidak dienkripsi, tetapi diautentikasi.

Artinya:

- AAD bisa dibaca siapa pun.
- Jika AAD berubah, tag verification gagal.

AAD berguna untuk mengikat ciphertext ke context.

Contoh AAD:

```text
application-name
schema-version
tenant-id
record-id
field-name
purpose
key-id
algorithm-id
created-at date bucket
```

Misalnya field `nationalId` milik tenant A tidak boleh bisa dipindahkan ke tenant B. Maka tenant-id dan field-name sebaiknya masuk AAD.

Tanpa AAD, attacker internal mungkin tidak bisa decrypt, tetapi bisa melakukan **ciphertext swapping** antar record jika akses storage cukup luas.

### 8.2 GCM Nonce Discipline

Untuk AES-GCM, nonce/IV harus unik untuk key yang sama.

Jika nonce digunakan ulang dengan key yang sama, dampaknya bisa catastrophic:

- confidentiality bisa bocor;
- authentication bisa rusak;
- attacker bisa memalsukan ciphertext/tag dalam skenario tertentu.

Rule:

> Dengan AES-GCM, jangan pernah reuse nonce/IV untuk key yang sama.

Praktik umum:

- Gunakan 96-bit random nonce dari `SecureRandom`.
- Simpan nonce bersama ciphertext.
- Jangan derive nonce dari timestamp saja.
- Jangan reset counter tanpa mengganti key.
- Jangan generate nonce dari `Random`.
- Jangan hardcode nonce.

Untuk volume sangat tinggi, random 96-bit nonce masih umum, tetapi sistem dengan throughput ekstrem harus menghitung collision risk dan mungkin memakai deterministic counter nonce dengan state yang kuat.

---

## 9. ChaCha20-Poly1305

ChaCha20-Poly1305 adalah AEAD scheme:

- ChaCha20 memberi encryption stream cipher.
- Poly1305 memberi authentication tag.

Kelebihan:

- Baik di platform tanpa AES hardware acceleration.
- Dipakai luas dalam protokol modern.
- Tersedia di Java modern sebagai standard algorithm name.

Namun prinsipnya sama:

1. Nonce harus unik per key.
2. Tag harus diverifikasi.
3. AAD bisa digunakan untuk context binding.
4. Payload harus punya format/version.

Di Java, `Cipher` documentation juga menekankan bahwa ChaCha20 dan ChaCha20-Poly1305 membutuhkan nonce unik dengan key yang sama dan cipher harus diinisialisasi ulang dengan nonce berbeda setelah operasi encryption/decryption.

---

## 10. Padding: Kenapa `NoPadding` pada GCM Bukan Berarti Tanpa Security

Di Java transformation string, kamu akan melihat:

```java
AES/GCM/NoPadding
```

Jangan salah paham. `NoPadding` di sini bukan berarti security-nya kurang.

GCM adalah stream-like AEAD mode yang tidak membutuhkan block padding seperti CBC.

Bandingkan:

```text
AES/CBC/PKCS5Padding -> block mode + padding + no built-in authentication
AES/GCM/NoPadding    -> AEAD mode + no padding needed + authentication tag
```

Padding relevan untuk mode seperti CBC. Untuk GCM/CTR, padding tidak diperlukan.

---

## 11. Java `Cipher` Mental Model

`javax.crypto.Cipher` adalah API utama untuk encryption/decryption.

Transformation string umumnya:

```text
algorithm/mode/padding
```

Contoh:

```java
Cipher.getInstance("AES/GCM/NoPadding")
Cipher.getInstance("AES/CBC/PKCS5Padding")
Cipher.getInstance("ChaCha20-Poly1305")
```

Masalah umum:

```java
Cipher.getInstance("AES")
```

Ini provider-dependent dan bisa berarti default mode/padding yang tidak diinginkan, sering kali ECB pada provider tertentu/legacy behavior.

Rule:

> Selalu sebutkan transformation secara eksplisit. Jangan pakai `Cipher.getInstance("AES")`.

---

## 12. Java AES-GCM Example yang Layak Dipakai sebagai Baseline

Contoh berikut bukan library production lengkap, tetapi baseline yang menunjukkan prinsip penting:

- AES-GCM.
- 256-bit key input.
- 96-bit IV random.
- 128-bit tag.
- AAD optional.
- payload versioning.
- base64url encoding.
- error handling tidak membocorkan detail.

```java
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;

public final class AesGcmEnvelope {
    private static final byte VERSION = 1;
    private static final byte ALG_AES_256_GCM = 1;

    private static final int AES_256_KEY_BYTES = 32;
    private static final int GCM_IV_BYTES = 12;       // 96-bit recommended common size
    private static final int GCM_TAG_BITS = 128;

    private static final SecureRandom RNG = new SecureRandom();

    private AesGcmEnvelope() {
    }

    public static String encryptToToken(byte[] plaintext, byte[] rawKey, byte[] aad)
            throws GeneralSecurityException {
        Objects.requireNonNull(plaintext, "plaintext");
        SecretKey key = toAes256Key(rawKey);

        byte[] iv = new byte[GCM_IV_BYTES];
        RNG.nextBytes(iv);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));

        byte[] envelopeAad = buildEnvelopeAad(aad);
        cipher.updateAAD(envelopeAad);

        byte[] ciphertextAndTag = cipher.doFinal(plaintext);

        ByteBuffer out = ByteBuffer.allocate(1 + 1 + 1 + iv.length + ciphertextAndTag.length);
        out.put(VERSION);
        out.put(ALG_AES_256_GCM);
        out.put((byte) iv.length);
        out.put(iv);
        out.put(ciphertextAndTag);

        return Base64.getUrlEncoder().withoutPadding().encodeToString(out.array());
    }

    public static byte[] decryptFromToken(String token, byte[] rawKey, byte[] aad)
            throws GeneralSecurityException {
        Objects.requireNonNull(token, "token");
        SecretKey key = toAes256Key(rawKey);

        byte[] envelope;
        try {
            envelope = Base64.getUrlDecoder().decode(token);
        } catch (IllegalArgumentException e) {
            throw new InvalidCiphertextException("Invalid encrypted payload");
        }

        if (envelope.length < 1 + 1 + 1 + GCM_IV_BYTES + 16) {
            throw new InvalidCiphertextException("Invalid encrypted payload");
        }

        ByteBuffer in = ByteBuffer.wrap(envelope);
        byte version = in.get();
        byte alg = in.get();
        int ivLength = Byte.toUnsignedInt(in.get());

        if (version != VERSION || alg != ALG_AES_256_GCM || ivLength != GCM_IV_BYTES) {
            throw new InvalidCiphertextException("Invalid encrypted payload");
        }

        if (in.remaining() <= ivLength) {
            throw new InvalidCiphertextException("Invalid encrypted payload");
        }

        byte[] iv = new byte[ivLength];
        in.get(iv);

        byte[] ciphertextAndTag = new byte[in.remaining()];
        in.get(ciphertextAndTag);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(buildEnvelopeAad(aad));

        try {
            return cipher.doFinal(ciphertextAndTag);
        } catch (AEADBadTagException e) {
            throw new InvalidCiphertextException("Invalid encrypted payload");
        }
    }

    private static SecretKey toAes256Key(byte[] rawKey) {
        Objects.requireNonNull(rawKey, "rawKey");
        if (rawKey.length != AES_256_KEY_BYTES) {
            throw new IllegalArgumentException("AES-256 key must be exactly 32 bytes");
        }
        return new SecretKeySpec(rawKey, "AES");
    }

    private static byte[] buildEnvelopeAad(byte[] aad) {
        byte[] prefix = "learn-java-security:v1:aes-256-gcm".getBytes(StandardCharsets.UTF_8);
        if (aad == null || aad.length == 0) {
            return prefix;
        }

        ByteBuffer buffer = ByteBuffer.allocate(prefix.length + 1 + aad.length);
        buffer.put(prefix);
        buffer.put((byte) 0);
        buffer.put(aad);
        return buffer.array();
    }

    public static final class InvalidCiphertextException extends GeneralSecurityException {
        public InvalidCiphertextException(String message) {
            super(message);
        }
    }
}
```

### 12.1 Apa yang Bagus dari Contoh Ini?

1. Transformation eksplisit: `AES/GCM/NoPadding`.
2. IV random 96-bit.
3. Tag 128-bit.
4. AAD dipakai.
5. Payload punya version dan algorithm id.
6. Error decryption dibuat generic.
7. Key length divalidasi.
8. IV disimpan bersama ciphertext.
9. Base64url cocok untuk token/string transport.
10. Tidak ada hardcoded key.

### 12.2 Apa yang Belum Dicakup?

Contoh ini belum menyelesaikan:

1. Key generation.
2. Key storage.
3. Key rotation.
4. KMS/HSM integration.
5. Key id lookup.
6. Multi-version decrypt.
7. Audit.
8. Metrics.
9. Large streaming file encryption.
10. Secure memory zeroization.

Semua itu akan muncul lebih detail di part key management, keystore, secure file transfer, dan runtime hardening.

---

## 13. Payload Format: Jangan Simpan Ciphertext Mentah Tanpa Metadata

Kesalahan besar:

```text
store only base64(ciphertext)
```

Masalah:

- Tidak tahu algorithm.
- Tidak tahu version.
- Tidak tahu IV.
- Tidak tahu key id.
- Tidak tahu tag length.
- Tidak bisa rotation.
- Tidak bisa migration.
- Tidak bisa audit.
- Tidak bisa support format lama.

Payload terenkripsi sebaiknya punya struktur.

Contoh binary envelope:

```text
byte 0      : version
byte 1      : algorithm id
byte 2      : flags
byte 3      : key id length
N bytes     : key id
byte next   : nonce length
N bytes     : nonce/IV
remaining   : ciphertext + tag
```

Contoh JSON envelope:

```json
{
  "v": 1,
  "alg": "A256GCM",
  "kid": "customer-pii-2026-01",
  "iv": "base64url...",
  "aad": "implicit:tenantId+recordId+fieldName",
  "ct": "base64url(ciphertext+tag)"
}
```

Binary lebih compact. JSON lebih mudah debug/audit. Pilihan tergantung use case.

Rule:

> Jangan buat encryption format yang tidak bisa dimigrasikan.

---

## 14. `kid`: Key ID Bukan Secret

`kid` atau key id menunjukkan key mana yang dipakai untuk decrypt.

`kid` biasanya tidak secret.

Fungsi `kid`:

1. Mendukung key rotation.
2. Memilih key lama untuk decrypt.
3. Membedakan tenant/purpose.
4. Audit crypto usage.
5. Menolak algorithm/key yang sudah retired.

Contoh:

```text
customer-pii-aesgcm-2026-q1
file-transfer-partner-x-2026-01
case-audit-envelope-v3
```

Namun `kid` harus diperlakukan sebagai untrusted input saat decrypt.

Jangan:

```java
Path keyFile = Path.of("/keys/" + kid + ".key");
```

Tanpa allowlist, ini bisa jadi path traversal atau key confusion.

Yang benar:

```java
SecretKey key = keyRegistry.lookupAllowedKey(kid, Purpose.PII_FIELD_ENCRYPTION);
```

Key lookup harus:

- allowlisted;
- purpose-bound;
- tenant-aware jika perlu;
- menolak key disabled;
- menolak algorithm mismatch;
- log audit event tanpa membocorkan secret.

---

## 15. AAD Design: Mencegah Ciphertext Swapping

Bayangkan database punya tabel:

```text
customer_id | tenant_id | encrypted_national_id
```

Jika attacker internal bisa update row tapi tidak punya key, dia mungkin copy ciphertext dari customer A ke customer B.

Kalau encryption tidak mengikat context, decrypt tetap berhasil.

Masalah:

```text
ciphertext customer A dipindah ke customer B
-> decrypt berhasil
-> data integrity rusak
```

Solusi: bind context via AAD.

Contoh AAD:

```text
tenant_id + table_name + column_name + row_id + schema_version
```

Jika ciphertext dipindah, AAD saat decrypt berbeda, tag verification gagal.

Contoh Java:

```java
String aadText = String.join("|",
        "tenant=" + tenantId,
        "table=customer",
        "column=national_id",
        "row=" + customerId,
        "schema=v1"
);
byte[] aad = aadText.getBytes(StandardCharsets.UTF_8);
```

Catatan penting:

- AAD harus deterministic.
- AAD harus canonical.
- Jangan memasukkan value yang bisa berubah tanpa re-encrypt.
- Jangan memasukkan whitespace/format bebas tanpa canonicalization.
- Jangan memasukkan secret yang tidak perlu.

---

## 16. Key Separation

Jangan pakai satu key untuk semua purpose.

Bad:

```text
same key for:
- encrypt customer PII
- sign webhook
- encrypt file
- encrypt token
- test environment
- production environment
```

Masalah:

1. Blast radius besar.
2. Sulit rotasi.
3. Sulit audit.
4. Key compromise satu use case menghancurkan semua.
5. Salah algorithm bisa membuka serangan lintas konteks.

Good:

```text
key-purpose-environment-tenant/version

pii-field-encryption-prod-2026-q1
file-transfer-partner-x-prod-2026-q1
cache-token-encryption-uat-2026-q1
```

Key separation minimal berdasarkan:

- environment;
- purpose;
- algorithm class;
- tenant jika risk menuntut;
- data classification;
- lifecycle/rotation requirement.

---

## 17. Key Generation untuk AES

AES key harus dihasilkan dari cryptographically secure RNG atau KMS.

Contoh Java lokal:

```java
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.security.SecureRandom;

KeyGenerator keyGenerator = KeyGenerator.getInstance("AES");
keyGenerator.init(256, SecureRandom.getInstanceStrong());
SecretKey key = keyGenerator.generateKey();
```

Namun production enterprise sering lebih baik:

- AWS KMS / GCP KMS / Azure Key Vault.
- HSM.
- centralized secret manager.
- envelope encryption.

Jangan generate AES key dari:

```java
"my-secret-password".getBytes()
```

Jika input-nya password, pakai KDF/password hashing context seperti PBKDF2/Argon2id/scrypt sesuai use case. Namun password-derived encryption key punya risiko sendiri dan perlu desain khusus.

---

## 18. Envelope Encryption

Envelope encryption adalah pattern di mana data dienkripsi dengan DEK, lalu DEK dilindungi dengan KEK.

```text
plaintext
  encrypted by DEK -> ciphertext

DEK
  wrapped/encrypted by KEK -> encrypted DEK
```

Payload menyimpan:

```text
key id of KEK
encrypted DEK
nonce/IV
ciphertext+tag
metadata
```

Kelebihan:

1. Data encryption cepat secara lokal.
2. KEK bisa dikelola KMS/HSM.
3. Rotation KEK bisa dilakukan tanpa re-encrypt semua data plaintext.
4. Blast radius lebih terkendali.
5. Audit KMS bisa menunjukkan key unwrap/decrypt event.

Pattern ini umum untuk:

- file besar;
- object storage;
- database field encryption skala besar;
- backup;
- multi-tenant encryption.

---

## 19. Field-Level Encryption vs Database Encryption

Database encryption seperti TDE melindungi data at rest di level storage.

Application field-level encryption melindungi field sebelum masuk database.

Perbandingan:

| Aspek | DB/TDE | App Field-Level Encryption |
|---|---|---|
| Melindungi disk theft | Ya | Ya |
| Melindungi DBA query | Tidak selalu | Lebih mungkin |
| Melindungi app compromise | Tidak | Tidak jika app punya key |
| Query/search mudah | Ya | Sulit |
| Key di app | Tidak selalu | Ya/akses via KMS |
| Granular context binding | Terbatas | Bisa |

Field-level encryption cocok untuk:

- national ID;
- bank account;
- personal document reference;
- high-risk PII;
- partner payload;
- evidence metadata.

Namun ada trade-off:

- sorting sulit;
- searching sulit;
- indexing sulit;
- partial matching hampir tidak mungkin;
- migration kompleks;
- re-encryption butuh job;
- observability terbatas.

Rule:

> Jangan mengenkripsi field tanpa mendesain kebutuhan query, support, migration, dan incident response.

---

## 20. Searchable Encryption: Jangan Buat Sendiri Secara Naif

Kebutuhan umum:

> “Saya mau encrypt NIK/email, tapi tetap bisa search exact match.”

Solusi naif:

```text
store encrypted value + SHA-256(value)
```

Masalah:

- Jika domain kecil, hash bisa di-bruteforce.
- Email/phone/NIK punya format predictable.
- Hash tanpa key bukan proteksi cukup.

Alternatif untuk exact lookup:

```text
lookup_token = HMAC(lookup_key, canonical_value)
stored encrypted_value = AEAD(value)
stored lookup_token = deterministic keyed token
```

Dengan catatan:

- lookup key terpisah dari encryption key;
- canonicalization wajib;
- HMAC token tetap bocor equality pattern;
- domain kecil masih bisa diserang jika key bocor;
- tidak mendukung partial search;
- rotation lookup token harus direncanakan.

Jangan menyebut ini “encryption yang searchable sempurna”. Ini trade-off.

---

## 21. Deterministic Encryption: Equality Leakage

Deterministic encryption menghasilkan ciphertext yang sama untuk plaintext yang sama.

Kelebihan:

- Bisa exact match.
- Bisa dedup.

Masalah:

- Membocorkan equality.
- Rentan frequency analysis.
- Buruk untuk domain kecil.

Contoh domain kecil:

```text
gender: M/F
status: ACTIVE/INACTIVE/SUSPENDED
country: ID/SG/MY
```

Jika deterministic encryption dipakai, attacker bisa melihat pola walau tidak tahu plaintext langsung.

Rule:

> Untuk confidentiality maksimum, gunakan randomized encryption seperti AEAD dengan nonce unik. Deterministic encryption hanya boleh dipakai jika equality leakage diterima secara eksplisit dalam threat model.

---

## 22. Compression Before Encryption: Risiko Side Channel

Kadang orang ingin compress sebelum encrypt untuk efisiensi.

```text
plaintext -> compress -> encrypt
```

Untuk file statis yang tidak bercampur dengan attacker-controlled input, ini bisa masuk akal.

Namun untuk protokol interaktif atau payload yang mencampur secret dan attacker-controlled input, compression bisa membuka side channel seperti kelas serangan CRIME/BREACH.

Rule:

> Jangan compress secret bersama attacker-controlled input dalam konteks di mana attacker bisa mengamati ukuran ciphertext dan mengulang percobaan.

Untuk batch file internal, risiko lebih rendah tetapi tetap perlu threat model.

---

## 23. Error Handling: Jangan Membocorkan Oracle

Bad:

```java
catch (AEADBadTagException e) {
    return "Invalid tag";
} catch (BadPaddingException e) {
    return "Invalid padding";
} catch (IllegalBlockSizeException e) {
    return "Invalid block size";
}
```

Good:

```java
catch (GeneralSecurityException | IllegalArgumentException e) {
    throw new InvalidCiphertextException("Invalid encrypted payload");
}
```

Log internal juga harus hati-hati.

Jangan log:

- plaintext;
- raw key;
- full ciphertext sensitif;
- nonce+tag+context jika bisa dieksploitasi;
- exception detail yang muncul ke client.

Boleh log secara terbatas:

- algorithm id;
- key id;
- version;
- operation;
- failure category generic;
- correlation id;
- caller/service;
- environment.

Contoh:

```text
WARN crypto.decrypt.failed op=field-decrypt alg=A256GCM kid=pii-2026-q1 reason=invalid_payload correlation=...
```

---

## 24. Performance and Resource Management

Encryption bukan gratis, tetapi sering bukan bottleneck utama dibanding I/O, network, DB, serialization, dan latency KMS.

Hal yang perlu dipikirkan:

1. Per-call `Cipher.getInstance()` overhead.
2. `Cipher` bukan object yang aman dishare lintas thread tanpa disiplin.
3. KMS call latency.
4. Key cache TTL.
5. Large payload memory allocation.
6. Streaming encryption untuk file besar.
7. AES hardware acceleration.
8. Base64 overhead.
9. Compression trade-off.
10. Metrics dan circuit breaker.

Rule praktis:

- Jangan share mutable `Cipher` singleton antar thread.
- Boleh membuat `Cipher` per operation untuk kesederhanaan dan safety.
- Untuk high throughput, benchmark dengan aman; jangan korbankan nonce discipline.
- Hindari menampung file besar penuh di memory.

---

## 25. Streaming Encryption untuk File Besar

`CipherInputStream` dan `CipherOutputStream` ada, tetapi untuk AEAD perlu hati-hati.

Pada AEAD, authentication tag biasanya diverifikasi di akhir stream. Artinya:

> Jangan memproses plaintext hasil decrypt sebagai trusted sebelum tag akhir diverifikasi.

Masalah:

```text
decrypt stream -> langsung import record ke DB
baru di akhir tahu tag invalid
```

Ini berbahaya karena data invalid sudah diproses.

Pattern lebih aman:

1. Decrypt ke temporary file/lokasi staging.
2. Verifikasi tag berhasil.
3. Atomic move ke lokasi trusted.
4. Baru proses/import.
5. Hapus staging saat gagal.

Untuk file besar dan chunked encryption, gunakan chunk-level AEAD:

```text
file header: version, alg, key id, file nonce base
chunk 0: nonce derived safely, aad(file id + chunk index), ciphertext+tag
chunk 1: nonce derived safely, aad(file id + chunk index), ciphertext+tag
...
final manifest: chunk count, total size, optional file digest/signature
```

Namun chunked encryption lebih kompleks. Jangan improvisasi tanpa review.

---

## 26. Large Object Encryption Design

Untuk dokumen/evidence file:

```text
[Header]
  magic bytes
  format version
  algorithm id
  key id
  content type maybe
  file id
  chunk size

[Encrypted DEK]
  wrapped data encryption key

[Chunks]
  chunk index
  nonce
  ciphertext
  tag

[Footer/Manifest]
  total chunks
  total plaintext length maybe
  manifest digest/signature optional
```

AAD per chunk:

```text
file-id | format-version | alg | chunk-index | total-chunks maybe | purpose
```

Security invariant:

1. Chunk tidak bisa dipindah ke file lain.
2. Chunk tidak bisa dipindah urutan tanpa terdeteksi.
3. Chunk tidak bisa dihapus tanpa terdeteksi.
4. File tidak bisa diproses sebagai complete sebelum manifest valid.
5. Key id tidak bisa dipakai untuk purpose lain.

---

## 27. Common Misuse Pattern di Java Symmetric Encryption

### 27.1 `Cipher.getInstance("AES")`

Problem: default mode/padding provider-dependent dan bisa tidak aman.

Fix:

```java
Cipher.getInstance("AES/GCM/NoPadding")
```

### 27.2 ECB

Problem: pattern leakage.

Fix: AEAD.

### 27.3 Static IV

Bad:

```java
byte[] iv = new byte[12];
```

atau:

```java
byte[] iv = "123456789012".getBytes(StandardCharsets.UTF_8);
```

Fix:

```java
byte[] iv = new byte[12];
secureRandom.nextBytes(iv);
```

### 27.4 IV Tidak Disimpan

Problem: tidak bisa decrypt atau developer tergoda derive IV deterministik buruk.

Fix: simpan IV bersama ciphertext. IV tidak perlu secret.

### 27.5 Reuse Key untuk Semua

Fix: key separation.

### 27.6 Password Jadi AES Key Langsung

Bad:

```java
new SecretKeySpec(password.getBytes(UTF_8), "AES")
```

Fix: gunakan KDF jika use case memang password-based encryption, atau gunakan random key dari KMS.

### 27.7 Tidak Ada Authentication

Bad:

```java
AES/CBC/PKCS5Padding
AES/CTR/NoPadding
```

tanpa MAC.

Fix: AES-GCM/ChaCha20-Poly1305.

### 27.8 Decrypt Dulu Baru Verify Manual

Problem: oracle/processing of untrusted plaintext.

Fix: AEAD `doFinal()` harus sukses sebelum plaintext trusted.

### 27.9 Error Detail Bocor

Fix: generic error.

### 27.10 Tidak Ada Versioning

Fix: envelope format.

---

## 28. Design Pattern: Application Field Encryption Service

Contoh interface:

```java
public interface FieldEncryptionService {
    EncryptedField encrypt(FieldEncryptionRequest request);
    byte[] decrypt(EncryptedField encryptedField, FieldContext context);
}
```

Request:

```java
public record FieldEncryptionRequest(
        byte[] plaintext,
        FieldContext context,
        CryptoPurpose purpose
) {}

public record FieldContext(
        String tenantId,
        String aggregateType,
        String aggregateId,
        String fieldName,
        int schemaVersion
) {}

public enum CryptoPurpose {
    CUSTOMER_PII,
    CASE_EVIDENCE_METADATA,
    PARTNER_TRANSFER_SECRET
}
```

Encrypted field:

```java
public record EncryptedField(
        int version,
        String algorithm,
        String keyId,
        byte[] nonce,
        byte[] ciphertextAndTag
) {}
```

Flow:

```text
caller
  -> builds FieldContext
  -> encryption service resolves key by purpose/env/tenant
  -> canonical AAD from context
  -> AES-GCM encrypt
  -> returns envelope
  -> repository stores envelope fields
```

Security invariants:

1. Context harus lengkap.
2. AAD canonical.
3. Key purpose-bound.
4. Nonce unik per key.
5. Decryption hanya sukses untuk context yang sama.
6. Error generic.
7. Metrics/audit ada.

---

## 29. Design Pattern: Secure Token Encryption

Kadang sistem butuh token opaque yang berisi data kecil.

Contoh:

```text
reset link token
invite token
short-lived state token
one-time workflow token
```

Namun hati-hati: tidak semua token harus encrypted. Kadang signed token cukup. Kadang server-side random token lebih baik.

Jika memakai encrypted token:

Payload plaintext:

```json
{
  "sub": "user-123",
  "purpose": "password-reset",
  "iat": 1780000000,
  "exp": 1780000600,
  "nonce": "random-id"
}
```

AAD:

```text
app=aceas|token-purpose=password-reset|format=v1
```

Security requirement:

1. Token punya expiry.
2. Token purpose-bound.
3. Token optional one-time via server-side nonce store.
4. Key separate dari field encryption.
5. Decrypt failure generic.
6. Replay policy jelas.

Poin penting:

> AEAD memberi integrity token, tetapi tidak otomatis mencegah replay. Replay harus didesain sendiri.

---

## 30. Design Pattern: Partner File Encryption

Untuk file exchange:

```text
producer Java service
  -> generate DEK
  -> encrypt file chunks with AEAD
  -> wrap DEK with partner/public KMS/KEK process
  -> produce manifest
  -> upload file + manifest

consumer
  -> validate manifest
  -> unwrap DEK
  -> decrypt chunks to staging
  -> verify complete
  -> atomic publish/process
```

Jika partner hanya mendukung legacy AES-CBC:

1. Dokumentasikan risk.
2. Gunakan random IV per file.
3. Pakai HMAC encrypt-then-MAC jika protocol bisa diubah.
4. Jika tidak bisa, isolasi channel dengan TLS/mTLS dan file signature.
5. Buat migration plan.
6. Jangan mengklaim integrity kuat jika tidak ada MAC/signature.

---

## 31. Design Pattern: Encrypt-then-MAC untuk Legacy CBC

Jika benar-benar terpaksa CBC:

```text
encKey != macKey
iv = secure random
ciphertext = AES-CBC-PKCS5Padding(encKey, iv, plaintext)
mac = HMAC-SHA256(macKey, version || alg || kid || iv || ciphertext || aad)
payload = version || alg || kid || iv || ciphertext || mac
```

Decrypt:

```text
parse payload
lookup keys
verify HMAC constant-time
if HMAC invalid -> generic failure
only then decrypt CBC
validate plaintext format
```

Jangan:

```text
decrypt CBC -> check padding -> then verify MAC
```

Karena itu membuka oracle risk.

Namun untuk desain baru, tetap lebih baik AEAD.

---

## 32. Algorithm Selection Guidance

Default recommendation untuk Java application-level encryption:

```text
Preferred:
  AES-256-GCM or AES-128-GCM

Also acceptable when supported and appropriate:
  ChaCha20-Poly1305

Avoid for new designs:
  AES-CBC without MAC
  AES-CTR without MAC
  AES-ECB
  DES
  3DES
  RC4
  Blowfish for new systems
```

AES-128 vs AES-256:

- AES-128 masih kuat untuk banyak use case.
- AES-256 sering dipilih untuk policy/compliance margin.
- Key management lebih penting daripada memilih 256-bit tetapi menyimpan key sembarangan.

Rule:

> AES-256-GCM dengan key management buruk lebih lemah secara sistem daripada AES-128-GCM dengan key lifecycle yang benar.

---

## 33. Security Review Checklist untuk Symmetric Encryption

Gunakan checklist ini saat review PR/design.

### 33.1 Requirement

- [ ] Apa data yang dilindungi?
- [ ] Confidentiality terhadap siapa?
- [ ] Integrity dibutuhkan?
- [ ] Authenticity dibutuhkan?
- [ ] Replay perlu dicegah?
- [ ] Retention/migration/rotation requirement jelas?

### 33.2 Algorithm/Mode

- [ ] Tidak memakai ECB.
- [ ] Tidak memakai `Cipher.getInstance("AES")`.
- [ ] AEAD digunakan untuk desain baru.
- [ ] CBC/CTR legacy memiliki MAC yang benar.
- [ ] Algorithm id disimpan dalam envelope.

### 33.3 Key

- [ ] Key tidak hardcoded.
- [ ] Key tidak dari password mentah.
- [ ] Key purpose-bound.
- [ ] Environment separated.
- [ ] Key rotation plan ada.
- [ ] Key id allowlisted.

### 33.4 Nonce/IV

- [ ] IV/nonce dibuat oleh `SecureRandom` atau counter aman.
- [ ] IV/nonce unik per key.
- [ ] IV/nonce disimpan bersama ciphertext.
- [ ] Tidak ada static IV.
- [ ] Tidak derive IV dari timestamp saja.

### 33.5 AAD/Context

- [ ] AAD dipakai untuk bind context jika ciphertext bisa dipindahkan.
- [ ] AAD canonical dan deterministic.
- [ ] AAD tidak memakai field yang berubah tanpa re-encrypt.
- [ ] Tenant/record/field/purpose dipertimbangkan.

### 33.6 Payload Format

- [ ] Version ada.
- [ ] Algorithm id ada.
- [ ] Key id ada jika rotation dibutuhkan.
- [ ] IV/nonce ada.
- [ ] Tag ada.
- [ ] Format bisa dimigrasikan.

### 33.7 Decryption

- [ ] Tag/MAC failure tidak membocorkan detail.
- [ ] Plaintext tidak diproses sebelum AEAD verification sukses.
- [ ] Error response generic.
- [ ] Metrics tidak membocorkan sensitive data.
- [ ] Audit event cukup untuk investigation.

### 33.8 Operations

- [ ] Rotation procedure ada.
- [ ] Compromise response ada.
- [ ] Backup encrypted payload kompatibel dengan key lifecycle.
- [ ] Load/performance diuji.
- [ ] Observability ada untuk failure rate.

---

## 34. Mini Case Study: Encrypting National ID in Case Management Platform

### 34.1 Context

Sistem regulatory case management menyimpan national ID untuk applicant/respondent.

Threats:

1. Database read-only leak.
2. Insider DB query.
3. Accidental log/export.
4. Row-level ciphertext swapping.
5. Backup leak.
6. Key compromise.
7. Migration failure.

Requirement:

1. National ID harus confidential at application storage level.
2. App perlu exact lookup by national ID.
3. Data harus tenant-bound.
4. Harus mendukung key rotation.
5. Tidak boleh expose plaintext di logs.
6. Audit decrypt access diperlukan.

### 34.2 Design

Store fields:

```text
national_id_ciphertext
national_id_nonce
national_id_alg
national_id_kid
national_id_lookup_token
national_id_crypto_version
```

Encryption:

```text
plaintext = canonical national id
AAD = tenantId | aggregateType=Party | aggregateId | field=nationalId | schema=v1
encryptionKey = keyRegistry.resolve("party-national-id-encryption", tenant/env)
AES-GCM encrypt
```

Lookup:

```text
lookupToken = HMAC(lookupKey, canonicalNationalId)
```

Key separation:

```text
encryption key != lookup key
prod key != uat key
national id key != generic token key
```

Decrypt path:

```text
load envelope
resolve key by kid and purpose
rebuild AAD from current row context
decrypt
if tag invalid -> security event, generic failure
```

### 34.3 Invariants

1. Ciphertext from tenant A cannot decrypt under tenant B context.
2. Ciphertext from row A cannot be moved to row B without detection.
3. Lookup token cannot reveal plaintext without lookup key.
4. Key rotation can decrypt old data and encrypt new data with new key.
5. Decrypt access emits audit event.
6. Logs never contain plaintext national ID.

### 34.4 Failure Mode

| Failure | Cause | Effect | Mitigation |
|---|---|---|---|
| Tag invalid after row update | AAD changed unexpectedly | Decrypt fails | stable context design, migration script |
| Cannot decrypt old rows | key retired too early | data loss | key state machine: active/decrypt-only/retired/destroyed |
| Search impossible | no lookup token | business outage | design exact lookup separately |
| Equality leakage | lookup token same for same ID | observable duplicate pattern | accept in threat model or avoid exact lookup |
| Logs leak ID | debug logging plaintext | data breach | log policy + tests + scanners |

---

## 35. Testing Strategy

### 35.1 Positive Test

- Encrypt then decrypt returns original plaintext.
- Different plaintexts decrypt correctly.
- AAD match succeeds.
- Old version decrypt path works.

### 35.2 Negative Test

- Modify ciphertext: decrypt fails.
- Modify tag: decrypt fails.
- Modify nonce: decrypt fails.
- Modify AAD: decrypt fails.
- Modify version: fails or routes to correct version handler.
- Wrong key: decrypt fails.
- Wrong key id: fails.
- Empty payload: fails generic.
- Truncated payload: fails generic.

### 35.3 Nonce Test

- Multiple encryptions of same plaintext produce different ciphertext.
- Nonce length correct.
- Nonce not all-zero.
- Nonce not reused in deterministic test with fixed RNG mock only if intentional.

### 35.4 Log Test

- Plaintext not logged.
- Key not logged.
- Full token/ciphertext not logged unless policy allows redacted form.

### 35.5 Migration Test

- Version 1 payload decrypts after version 2 introduced.
- New encrypt uses latest key/version.
- Old key decrypt-only works.

---

## 36. Production Observability

Metrics yang berguna:

```text
crypto.encrypt.count{purpose,alg,kid}
crypto.decrypt.count{purpose,alg,kid}
crypto.decrypt.failure.count{purpose,alg,kid,reason=generic}
crypto.key.lookup.failure.count{purpose,kid}
crypto.payload.version.count{version,alg}
crypto.rotation.reencrypt.count{fromKid,toKid}
```

Alerts:

- decrypt failure spike;
- unknown `kid`;
- deprecated algorithm still used for encryption;
- key near expiry;
- KMS latency spike;
- KMS deny/access error;
- sudden increase in decrypt volume for sensitive purpose.

Audit event:

```json
{
  "eventType": "CRYPTO_DECRYPT",
  "purpose": "CUSTOMER_PII",
  "algorithm": "A256GCM",
  "keyId": "pii-2026-q1",
  "actor": "service:case-management-api",
  "recordType": "Party",
  "recordId": "redacted-or-hashed",
  "outcome": "SUCCESS",
  "correlationId": "..."
}
```

Jangan audit plaintext.

---

## 37. Operational Key Rotation Model

Key states:

```text
PRE_ACTIVE
ACTIVE_ENCRYPT_DECRYPT
DECRYPT_ONLY
DISABLED
DESTROYED
```

Rotation flow:

```text
1. Create new key as PRE_ACTIVE.
2. Deploy config allowing decrypt old + new.
3. Mark new key ACTIVE_ENCRYPT_DECRYPT.
4. Mark old key DECRYPT_ONLY.
5. New writes use new key.
6. Background re-encrypt old data.
7. Verify no old payload remains.
8. Disable old key.
9. Destroy according to retention/compliance policy.
```

Invariant:

> Jangan destroy key selama masih ada ciphertext yang perlu didecrypt, termasuk backup, archive, audit evidence, dan legal hold data.

---

## 38. “Encryption Solves It” Fallacy

Encryption tidak menyelesaikan:

1. Broken authorization.
2. App server compromise.
3. XSS yang mencuri plaintext setelah decrypt.
4. SQL injection yang memanggil app decrypt endpoint.
5. Logging plaintext.
6. Insider yang punya decrypt privilege.
7. Replay attack.
8. Business logic tampering.
9. Wrong recipient.
10. Data minimization failure.

Encryption adalah control penting, tapi bukan pengganti access control, audit, least privilege, secure coding, dan operational discipline.

---

## 39. Decision Framework: Kapan Encrypt, Hash, MAC, atau Sign?

| Requirement | Primitive |
|---|---|
| Perlu baca lagi plaintext | Encryption |
| Tidak perlu baca password, hanya verify | Password hashing/KDF |
| Perlu detect tampering dengan shared secret | MAC/HMAC |
| Perlu pihak lain verify tanpa shared secret | Digital signature |
| Perlu exact lookup field sensitif | HMAC lookup token + encryption |
| Perlu file integrity saja | Hash jika trusted channel, signature/MAC jika adversarial |
| Perlu confidentiality + integrity | AEAD |
| Perlu non-repudiation | Signature, bukan symmetric encryption |

---

## 40. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman:

1. Kenapa `AES` saja bukan spesifikasi encryption yang cukup?
2. Kenapa ECB buruk walaupun key 256-bit?
3. Apa bedanya IV, nonce, dan salt dalam konteks symmetric encryption?
4. Kenapa AES-GCM membutuhkan nonce unik per key?
5. Apa yang diberikan AAD?
6. Apakah AAD terenkripsi?
7. Kenapa encryption tanpa authentication berbahaya?
8. Apa bedanya AES-GCM dan AES-CBC + HMAC?
9. Kenapa tag failure tidak boleh diekspos detailnya?
10. Kenapa payload terenkripsi butuh version dan algorithm id?
11. Apa fungsi `kid`?
12. Kenapa `kid` harus dianggap untrusted input?
13. Apa risiko deterministic encryption?
14. Bagaimana melakukan exact lookup terhadap field terenkripsi?
15. Kenapa replay tidak otomatis dicegah oleh AEAD?
16. Kenapa streaming AEAD harus berhati-hati sebelum tag verified?
17. Apa bedanya TDE dan application field encryption?
18. Bagaimana key rotation bisa menyebabkan data loss?
19. Apa yang harus masuk audit event crypto?
20. Apa tanda PR encryption harus diblokir?

---

## 41. Summary

Symmetric encryption adalah salah satu fondasi security, tetapi API yang tampak sederhana menyembunyikan banyak invariant.

Hal yang harus dibawa dari part ini:

1. AES adalah primitive, bukan skema lengkap.
2. Mode operasi menentukan banyak aspek keamanan.
3. ECB harus ditolak.
4. CBC/CTR tanpa authentication tidak cukup untuk desain baru.
5. AEAD seperti AES-GCM dan ChaCha20-Poly1305 adalah default modern untuk confidentiality + integrity.
6. Nonce/IV discipline adalah invariant kritikal.
7. AAD sangat penting untuk context binding dan mencegah ciphertext swapping.
8. Payload terenkripsi harus punya version, algorithm id, key id, nonce, ciphertext, dan tag.
9. Key separation dan key rotation sama pentingnya dengan algorithm choice.
10. Decryption failure harus generic agar tidak menjadi oracle.
11. Encryption tidak menggantikan authorization, audit, secure coding, dan operational controls.

Mental model akhir:

> Symmetric encryption yang aman adalah desain end-to-end: primitive benar, mode benar, key benar, nonce benar, AAD benar, envelope benar, error benar, rotation benar, dan threat model jelas.

---

## 42. Referensi

Referensi utama untuk part ini:

1. Oracle Java `Cipher` API documentation.
2. Oracle Java Security Standard Algorithm Names.
3. Oracle Java Cryptography Architecture Reference Guide.
4. OWASP Cryptographic Storage Cheat Sheet.
5. OWASP Key Management Cheat Sheet.
6. OWASP Top 10 A02: Cryptographic Failures.
7. NIST SP 800-38D: Recommendation for Block Cipher Modes of Operation — GCM and GMAC.
8. NIST FIPS 197: Advanced Encryption Standard.
9. RFC 8439: ChaCha20 and Poly1305 for IETF Protocols.
10. OpenJDK JEP 329: ChaCha20 and Poly1305 Cryptographic Algorithms.

---

## 43. Status Seri

Seri `learn-java-security-cryptography-integrity` belum selesai.

Progress saat ini:

- [x] Part 0 — Security Mental Model for Senior Java Engineers
- [x] Part 1 — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
- [x] Part 2 — Threat Modeling for Java Systems
- [x] Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
- [x] Part 4 — Randomness, Entropy, Nonce, Salt, IV, Token
- [x] Part 5 — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
- [x] Part 6 — Password Storage, Password Verification, and Secret-Derived Keys
- [x] Part 7 — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
- [ ] Part 8 — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
- [ ] Part 9 — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
- [ ] Part 10 — Asymmetric Encryption and Key Agreement
- [ ] Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
- [ ] Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
- [ ] Part 13 — X.509, PKI, Certificate Path Validation, Revocation
- [ ] Part 14 — TLS/JSSE Deep Dive for Java Engineers
- [ ] Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties
- [ ] Part 16 — Secure Serialization, Deserialization, and Object Integrity
- [ ] Part 17 — Secure File, Archive, and Data Transfer Integrity
- [ ] Part 18 — XML Security, XXE, XML Signature, XML Encryption
- [ ] Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity
- [ ] Part 20 — OAuth2/OIDC Security for Java Systems Without Repeating Jakarta/JAX-RS
- [ ] Part 21 — Authorization Integrity: Policy, Permission, and Confused Deputy
- [ ] Part 22 — Input Validation, Canonicalization, Injection Resistance
- [ ] Part 23 — Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics
- [ ] Part 24 — Secrets Management in Java Applications
- [ ] Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
- [ ] Part 26 — Data Integrity in Distributed Java Systems
- [ ] Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance
- [ ] Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust
- [ ] Part 29 — Secure Build, CI/CD, and Release Integrity for Java
- [ ] Part 30 — Runtime Hardening: JVM, Container, OS, Network
- [ ] Part 31 — Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST
- [ ] Part 32 — Incident Response for Java Security Failures
- [ ] Part 33 — Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
- [ ] Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-006](./learn-java-security-cryptography-integrity-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-008](./learn-java-security-cryptography-integrity-part-008.md)
