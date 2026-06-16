# learn-java-security-cryptography-integrity-part-010.md

# Part 10 — Asymmetric Encryption and Key Agreement

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `010`  
> Topik: Java Security, Cryptography, Integrity  
> Fokus: asymmetric encryption, RSA-OAEP, hybrid/envelope encryption, ECDH/key agreement, forward secrecy, dan post-quantum awareness  
> Status seri: belum selesai — ini Part 10 dari 35 (`Part 0` sampai `Part 34`)

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas:

- cryptographic mental model,
- randomness, nonce, IV, salt,
- hash/digest/fingerprint,
- password storage dan KDF,
- symmetric encryption,
- MAC,
- digital signature.

Sekarang kita masuk ke area yang sering sangat disalahpahami: **asymmetric encryption dan key agreement**.

Banyak engineer tahu kalimat:

> "Public key untuk encrypt, private key untuk decrypt."

Tetapi dalam sistem nyata, kalimat itu terlalu dangkal dan sering menyesatkan. Public key cryptography bukan sekadar "encrypt pakai public key". Dalam production, asymmetric primitive biasanya dipakai untuk:

1. **Mengamankan pertukaran key**, bukan mengenkripsi data besar secara langsung.
2. **Membangun shared secret** antara dua pihak.
3. **Membungkus data encryption key**.
4. **Menyediakan basis TLS handshake**.
5. **Mendukung envelope encryption**.
6. **Menyediakan confidentiality untuk key material**, bukan seluruh payload.
7. **Membantu desain forward secrecy**, jika key agreement dilakukan secara ephemeral.
8. **Memisahkan domain key transport, key agreement, encryption, dan signature**.

Target part ini:

1. Kamu paham perbedaan:
   - asymmetric encryption,
   - digital signature,
   - key transport,
   - key agreement,
   - key wrapping,
   - envelope encryption,
   - hybrid encryption.

2. Kamu tidak lagi mengatakan:
   - "encrypt with private key",
   - "RSA untuk encrypt file besar",
   - "ECDH itu encryption",
   - "public key bisa dipakai langsung untuk semua confidentiality problem",
   - "kalau sudah RSA pasti aman".

3. Kamu bisa mendesain payload format yang:
   - versioned,
   - algorithm-aware,
   - key-id aware,
   - rotation-friendly,
   - tidak vulnerable terhadap substitution,
   - tidak bergantung pada implicit state.

4. Kamu bisa membaca Java API seperti:
   - `Cipher`,
   - `KeyPairGenerator`,
   - `KeyAgreement`,
   - `KeyFactory`,
   - `KeyStore`,
   - `AlgorithmParameterSpec`,
   - `OAEPParameterSpec`,
   - `ECGenParameterSpec`,
   - `X509EncodedKeySpec`,
   - `PKCS8EncodedKeySpec`,
   dengan mental model security, bukan hanya syntax.

---

## 1. Big Picture: Kenapa Asymmetric Cryptography Ada?

Symmetric cryptography punya masalah utama:

> Kedua pihak harus punya secret key yang sama sebelum komunikasi aman bisa dimulai.

Jika Alice dan Bob belum pernah bertemu, bagaimana mereka berbagi AES key tanpa attacker melihat?

Asymmetric cryptography menjawab sebagian masalah ini dengan pasangan key:

```text
Key Pair
├── Public Key  : boleh diketahui pihak lain
└── Private Key : harus dijaga rahasia oleh pemilik
```

Tetapi ada beberapa jenis primitive yang berbeda:

```text
Asymmetric Cryptography
├── Digital Signature
│   ├── private key signs
│   └── public key verifies
│
├── Public-Key Encryption / Key Transport
│   ├── public key encrypts/wraps small secret
│   └── private key decrypts/unwraps
│
└── Key Agreement
    ├── both parties contribute key material
    └── shared secret is derived, not directly transported
```

Jadi asymmetric cryptography bukan satu benda. Ia adalah keluarga primitive.

---

## 2. Core Vocabulary

### 2.1 Public-Key Encryption

Public-key encryption adalah primitive di mana:

```text
ciphertext = encrypt(publicKeyOfRecipient, plaintext)
plaintext  = decrypt(privateKeyOfRecipient, ciphertext)
```

Guarantee utamanya:

```text
Only holder of recipient private key should decrypt.
```

Biasanya dipakai untuk mengenkripsi **small secret**, bukan data besar.

Contoh:

- encrypt random AES key dengan RSA-OAEP,
- encrypt data encryption key untuk recipient,
- implementasi key transport.

---

### 2.2 Digital Signature

Digital signature adalah primitive di mana:

```text
signature = sign(privateKeyOfSigner, message)
valid     = verify(publicKeyOfSigner, message, signature)
```

Guarantee utamanya:

```text
Message was signed by holder of private key,
and message was not modified after signing.
```

Signature bukan encryption.

Kalimat yang salah:

```text
"Encrypt with private key."
```

Yang benar:

```text
"Sign with private key."
```

Kalimat "encrypt with private key" biasanya muncul dari misunderstanding RSA textbook, tetapi dalam security engineering modern istilah itu harus dihindari karena mencampur semantics antara encryption dan signature.

---

### 2.3 Key Transport

Key transport adalah pola:

```text
Sender generates random secret key.
Sender encrypts/wraps that secret key for recipient.
Recipient decrypts/unwraps it.
```

Contoh:

```text
DEK = random AES-256 key
wrappedDEK = RSA-OAEP(publicKeyRecipient, DEK)
ciphertext = AES-GCM(DEK, plaintext)
```

Di sini asymmetric encryption hanya mengamankan DEK. Payload besar dienkripsi dengan symmetric encryption.

---

### 2.4 Key Agreement

Key agreement adalah pola:

```text
Alice private key + Bob public key   -> shared secret
Bob private key   + Alice public key -> same shared secret
```

Tidak ada pihak yang "mengirim key rahasia" secara langsung.

Contoh umum:

- Diffie-Hellman,
- ECDH,
- X25519,
- ephemeral ECDH di TLS.

Key agreement menghasilkan shared secret yang kemudian diproses melalui KDF untuk menghasilkan symmetric keys.

```text
ECDH raw shared secret
        ↓
KDF/HKDF
        ↓
encryption key + MAC key + IV material/context-bound keys
```

Raw shared secret tidak boleh langsung dianggap sebagai AES key yang siap pakai.

---

### 2.5 Envelope Encryption

Envelope encryption adalah pola membungkus data key dengan key lain.

```text
Plaintext
   ↓ encrypt with DEK
Ciphertext

DEK
   ↓ wrap/encrypt with KEK/public key/KMS key
Encrypted DEK
```

Terminologi:

```text
DEK = Data Encryption Key
KEK = Key Encryption Key
```

Envelope encryption membuat:

1. Data besar dienkripsi cepat dengan symmetric key.
2. Key kecil dapat dirotasi/dibungkus ulang tanpa re-encrypt semua data.
3. Multi-recipient encryption lebih mudah.
4. KMS/HSM integration lebih natural.
5. Audit key usage lebih terstruktur.

---

### 2.6 Hybrid Encryption

Hybrid encryption menggabungkan:

```text
Asymmetric primitive untuk key establishment
+
Symmetric AEAD untuk data encryption
```

Contoh:

```text
RSA-OAEP wraps AES key
AES-GCM encrypts payload
```

atau:

```text
ECDH derives shared secret
HKDF derives AES-GCM key
AES-GCM encrypts payload
```

Hampir semua real-world public-key encryption untuk data besar adalah hybrid encryption.

---

## 3. Kenapa Tidak Mengenkripsi File Besar Langsung dengan RSA?

RSA tidak dirancang untuk bulk data encryption.

Masalahnya:

1. **Batas ukuran plaintext kecil**  
   RSA hanya bisa mengenkripsi data lebih kecil dari modulus dikurangi overhead padding.

2. **Lambat**  
   Public-key operation jauh lebih mahal daripada symmetric encryption.

3. **Padding sangat penting**  
   RSA tanpa padding aman yang benar bisa fatal.

4. **Tidak memberikan AEAD-style data integrity untuk payload besar**  
   Kamu masih perlu authenticated encryption atau MAC.

5. **Sulit streaming**  
   RSA bukan stream encryption.

Karena itu desain benar:

```text
WRONG:
largeFile -> RSA encrypt -> ciphertext

RIGHT:
DEK = random AES key
ciphertext = AES-GCM(DEK, largeFile)
wrappedDEK = RSA-OAEP(publicKey, DEK)
store {wrappedDEK, nonce, ciphertext, tag, metadata}
```

---

## 4. Mental Model: Public Key Crypto Tidak Menghapus Kebutuhan Trust

Public key boleh dibagikan, tetapi kamu tetap harus tahu:

```text
Apakah public key itu benar milik pihak yang saya maksud?
```

Tanpa identity binding, public key encryption rentan terhadap man-in-the-middle.

Contoh:

```text
Alice ingin mengirim secret ke Bob.
Attacker mengganti public key Bob dengan public key Attacker.
Alice encrypt secret memakai public key Attacker.
Attacker decrypt secret.
```

Jadi problem public key cryptography tidak hanya:

```text
Can I encrypt?
```

Tetapi:

```text
Can I trust this public key belongs to the intended entity?
```

Cara binding public key ke identity:

1. X.509 certificate.
2. Certificate chain validation.
3. Trust store.
4. Public key pinning.
5. Key fingerprint verified out-of-band.
6. JWKS endpoint over properly validated TLS.
7. KMS/HSM-managed key identity.
8. Internal service registry with signed metadata.

Ini akan dibahas lebih dalam pada Part 12, 13, 14, dan 19.

---

## 5. RSA Encryption: Apa yang Benar dan Apa yang Salah

### 5.1 RSA Textbook Tidak Aman

Textbook RSA kira-kira:

```text
c = m^e mod n
m = c^d mod n
```

Ini bukan scheme aman untuk dipakai langsung.

RSA encryption harus menggunakan padding scheme yang aman, seperti OAEP.

---

### 5.2 RSA PKCS#1 v1.5 Encryption adalah Legacy Risk

`RSA/ECB/PKCS1Padding` masih sering terlihat di Java code lama.

Masalah:

1. Legacy.
2. Rentan terhadap class of padding oracle attacks jika error handling/protocol buruk.
3. Tidak ideal untuk desain baru.
4. Sulit dibuat robust dalam custom protocol.

Untuk desain baru, prefer:

```text
RSA-OAEP
```

Lebih spesifik:

```text
RSA/ECB/OAEPWithSHA-256AndMGF1Padding
```

Namun interoperability harus diuji karena detail OAEP parameter seperti digest, MGF digest, dan label harus sama antar platform.

---

### 5.3 Kenapa Java Menulis `RSA/ECB/OAEP...`?

Di Java transformation string, kamu mungkin melihat:

```java
Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
```

Ini terlihat aneh karena `ECB` biasanya buruk dalam block cipher mode.

Untuk RSA di Java, `ECB` di transformation string adalah historical placeholder. RSA bukan block cipher mode seperti AES-ECB. Tetapi tetap lebih baik jangan menjelaskan ini sebagai "RSA ECB mode aman", karena bisa membingungkan. Jelaskan:

```text
Untuk RSA transformation di JCE, komponen mode sering berupa placeholder provider-level.
Security property utamanya ditentukan oleh RSA padding scheme, misalnya OAEP.
```

---

### 5.4 OAEP Parameter Harus Eksplisit

Beberapa provider/platform punya default OAEP parameter yang berbeda.

Agar lebih jelas, gunakan `OAEPParameterSpec`.

Contoh Java:

```java
import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.security.PublicKey;
import java.security.spec.MGF1ParameterSpec;

public final class RsaOaepWrapExample {

    public static byte[] encryptSmallSecret(PublicKey recipientPublicKey, byte[] secret) throws Exception {
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");

        OAEPParameterSpec oaepParams = new OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT
        );

        cipher.init(Cipher.ENCRYPT_MODE, recipientPublicKey, oaepParams);
        return cipher.doFinal(secret);
    }
}
```

Catatan penting:

1. Secret harus kecil.
2. Jangan pakai RSA untuk payload besar.
3. Pastikan recipient private key sesuai.
4. Pastikan public key trust valid.
5. Pastikan algorithm metadata ikut disimpan di envelope.

---

## 6. Java API Map untuk Asymmetric Encryption

### 6.1 `KeyPairGenerator`

Dipakai untuk generate asymmetric key pair.

```java
KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
generator.initialize(3072);
KeyPair keyPair = generator.generateKeyPair();
```

Untuk EC:

```java
KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
generator.initialize(new ECGenParameterSpec("secp256r1"));
KeyPair keyPair = generator.generateKeyPair();
```

Untuk X25519 pada JDK yang mendukung:

```java
KeyPairGenerator generator = KeyPairGenerator.getInstance("X25519");
KeyPair keyPair = generator.generateKeyPair();
```

Catatan:

- Key generation policy harus mengikuti security strength dan compliance requirement.
- Jangan generate key pair on every request kecuali memang ephemeral key agreement.
- Jangan store private key sebagai plain file tanpa protection.

---

### 6.2 `KeyFactory`

Dipakai untuk reconstruct key dari encoded representation.

Public key biasanya X.509 SubjectPublicKeyInfo:

```java
X509EncodedKeySpec keySpec = new X509EncodedKeySpec(publicKeyBytes);
PublicKey publicKey = KeyFactory.getInstance("RSA").generatePublic(keySpec);
```

Private key biasanya PKCS#8:

```java
PKCS8EncodedKeySpec keySpec = new PKCS8EncodedKeySpec(privateKeyBytes);
PrivateKey privateKey = KeyFactory.getInstance("RSA").generatePrivate(keySpec);
```

Risk:

1. Loading public key tanpa verifying source.
2. Loading private key dari config raw.
3. Tidak membedakan test key dan production key.
4. Tidak punya key ID.
5. Tidak punya rotation lifecycle.

---

### 6.3 `Cipher`

Untuk RSA-OAEP key transport:

```java
Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
cipher.init(Cipher.ENCRYPT_MODE, publicKey, oaepParameterSpec);
byte[] wrappedKey = cipher.doFinal(dekBytes);
```

Untuk unwrap:

```java
cipher.init(Cipher.DECRYPT_MODE, privateKey, oaepParameterSpec);
byte[] dekBytes = cipher.doFinal(wrappedKey);
```

Jangan treat decrypt error sebagai detail yang boleh bocor ke attacker.

```text
Bad:
"OAEP padding invalid"
"private key mismatch"
"wrong digest"
"invalid ciphertext block"

Better:
"invalid encrypted envelope"
```

---

### 6.4 `KeyAgreement`

Untuk ECDH/XDH:

```java
KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
agreement.init(myPrivateKey);
agreement.doPhase(peerPublicKey, true);
byte[] sharedSecret = agreement.generateSecret();
```

Lalu:

```text
sharedSecret -> KDF -> AEAD key
```

Jangan langsung:

```java
SecretKeySpec key = new SecretKeySpec(sharedSecret, 0, 32, "AES");
```

Kenapa?

1. Raw shared secret belum necessarily uniformly distributed untuk key usage final.
2. Perlu bind context.
3. Perlu derive multiple keys.
4. Perlu domain separation.
5. Perlu transcript binding dalam protocol.

---

## 7. RSA-OAEP Hybrid Encryption: Payload Format

### 7.1 Naive Format yang Bermasalah

```json
{
  "key": "...",
  "data": "..."
}
```

Masalah:

1. Algorithm tidak jelas.
2. Key ID tidak jelas.
3. OAEP parameter tidak jelas.
4. Nonce tidak jelas.
5. AAD tidak jelas.
6. Tidak versioned.
7. Tidak rotation-friendly.
8. Tidak ada binding antara metadata dan ciphertext.
9. Tidak jelas apakah tag terpisah atau menyatu.
10. Tidak ada replay/expiry context jika dipakai untuk message.

---

### 7.2 Secure Envelope Format

Contoh format konseptual:

```json
{
  "version": 1,
  "type": "RSA_OAEP_AES_GCM_ENVELOPE",
  "recipientKeyId": "kms:rsa-key-2026-01",
  "keyEncryption": {
    "algorithm": "RSA-OAEP",
    "hash": "SHA-256",
    "mgf": "MGF1-SHA-256",
    "label": ""
  },
  "contentEncryption": {
    "algorithm": "AES-256-GCM",
    "nonce": "base64url(...)",
    "tagLengthBits": 128
  },
  "aad": {
    "tenantId": "tenant-123",
    "purpose": "case-evidence-export",
    "createdAt": "2026-06-16T10:15:30Z"
  },
  "encryptedKey": "base64url(...)",
  "ciphertext": "base64url(...)"
}
```

Important invariant:

```text
All security-relevant metadata must be authenticated.
```

Dengan AES-GCM, metadata seperti:

- version,
- type,
- recipientKeyId,
- key encryption algorithm,
- content encryption algorithm,
- tenant ID,
- purpose,
- createdAt,

harus masuk AAD atau ikut dalam canonical encoded bytes yang diautentikasi.

Jika metadata tidak diautentikasi, attacker bisa melakukan algorithm/key/context substitution.

---

### 7.3 Envelope Encryption Flow

```text
1. Validate recipient public key identity.
2. Generate random DEK.
3. Generate random AES-GCM nonce.
4. Build protected metadata.
5. Encrypt plaintext using AES-GCM with metadata as AAD.
6. Wrap DEK using RSA-OAEP public key.
7. Serialize envelope.
8. Zeroize temporary DEK if possible/best effort.
```

Decryption:

```text
1. Parse envelope.
2. Validate version and allowed algorithms.
3. Resolve private key by recipientKeyId.
4. Decrypt/wrap DEK with RSA-OAEP.
5. Rebuild exact AAD from protected metadata.
6. Decrypt AES-GCM ciphertext.
7. Reject envelope uniformly on failure.
```

---

## 8. Example: RSA-OAEP + AES-GCM Envelope in Java

Ini contoh minimal untuk mental model, bukan drop-in production library.

```java
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;

public final class HybridEncryptor {

    private static final SecureRandom RNG = new SecureRandom();

    private HybridEncryptor() {
    }

    public static EncryptedEnvelope encrypt(
            PublicKey recipientPublicKey,
            String recipientKeyId,
            byte[] plaintext,
            byte[] aad
    ) throws Exception {

        SecretKey dek = generateAes256Key();
        byte[] nonce = randomBytes(12);

        byte[] ciphertext = aesGcmEncrypt(dek, nonce, plaintext, aad);
        byte[] wrappedDek = rsaOaepWrap(recipientPublicKey, dek.getEncoded());

        return new EncryptedEnvelope(
                1,
                "RSA-OAEP-SHA256-AES-256-GCM",
                recipientKeyId,
                nonce,
                wrappedDek,
                ciphertext,
                aad
        );
    }

    private static SecretKey generateAes256Key() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        return generator.generateKey();
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RNG.nextBytes(bytes);
        return bytes;
    }

    private static byte[] aesGcmEncrypt(
            SecretKey key,
            byte[] nonce,
            byte[] plaintext,
            byte[] aad
    ) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad);
        return cipher.doFinal(plaintext);
    }

    private static byte[] rsaOaepWrap(PublicKey publicKey, byte[] secret) throws Exception {
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");

        OAEPParameterSpec oaep = new OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT
        );

        cipher.init(Cipher.ENCRYPT_MODE, publicKey, oaep);
        return cipher.doFinal(secret);
    }

    public record EncryptedEnvelope(
            int version,
            String algorithm,
            String recipientKeyId,
            byte[] nonce,
            byte[] encryptedKey,
            byte[] ciphertext,
            byte[] aad
    ) {
    }
}
```

Important production notes:

1. `aad` harus canonical dan stable.
2. `recipientKeyId` harus authenticated.
3. Envelope serialization harus deterministic untuk AAD.
4. Jangan pakai Java object serialization untuk envelope security boundary.
5. Jangan log plaintext, DEK, wrapped DEK, nonce+tag secara tidak perlu.
6. Jangan reuse nonce dengan DEK yang sama.
7. Jangan expose detailed decrypt errors.
8. Jangan menerima algorithm dari payload tanpa allowlist.
9. Jangan fallback otomatis ke algorithm lama tanpa policy.
10. Jangan generate RSA key di app startup untuk persistent data.

---

## 9. Decryption Flow

```java
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;
import java.security.PrivateKey;
import java.security.spec.MGF1ParameterSpec;

public final class HybridDecryptor {

    private HybridDecryptor() {
    }

    public static byte[] decrypt(
            PrivateKey recipientPrivateKey,
            HybridEncryptor.EncryptedEnvelope envelope
    ) throws Exception {

        validateEnvelopePolicy(envelope);

        byte[] dekBytes = rsaOaepUnwrap(recipientPrivateKey, envelope.encryptedKey());
        SecretKey dek = new SecretKeySpec(dekBytes, "AES");

        return aesGcmDecrypt(
                dek,
                envelope.nonce(),
                envelope.ciphertext(),
                envelope.aad()
        );
    }

    private static void validateEnvelopePolicy(HybridEncryptor.EncryptedEnvelope envelope) {
        if (envelope.version() != 1) {
            throw new IllegalArgumentException("Unsupported encrypted envelope");
        }

        if (!"RSA-OAEP-SHA256-AES-256-GCM".equals(envelope.algorithm())) {
            throw new IllegalArgumentException("Unsupported encrypted envelope");
        }

        if (envelope.nonce() == null || envelope.nonce().length != 12) {
            throw new IllegalArgumentException("Invalid encrypted envelope");
        }

        if (envelope.encryptedKey() == null || envelope.encryptedKey().length == 0) {
            throw new IllegalArgumentException("Invalid encrypted envelope");
        }

        if (envelope.ciphertext() == null || envelope.ciphertext().length == 0) {
            throw new IllegalArgumentException("Invalid encrypted envelope");
        }
    }

    private static byte[] rsaOaepUnwrap(PrivateKey privateKey, byte[] encryptedKey) throws Exception {
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");

        OAEPParameterSpec oaep = new OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT
        );

        cipher.init(Cipher.DECRYPT_MODE, privateKey, oaep);
        return cipher.doFinal(encryptedKey);
    }

    private static byte[] aesGcmDecrypt(
            SecretKey key,
            byte[] nonce,
            byte[] ciphertext,
            byte[] aad
    ) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad);
        return cipher.doFinal(ciphertext);
    }
}
```

Dalam production, kamu biasanya tidak ingin method public melempar error detail dari provider langsung ke caller eksternal.

Gunakan boundary:

```java
public byte[] decryptForApplication(EncryptedEnvelope envelope) {
    try {
        return internalDecrypt(envelope);
    } catch (Exception e) {
        auditInvalidEnvelope(envelope);
        throw new InvalidEncryptedEnvelopeException("Invalid encrypted envelope");
    }
}
```

---

## 10. Multi-Recipient Envelope Encryption

Satu ciphertext bisa dibuat untuk banyak recipient tanpa mengenkripsi plaintext berkali-kali.

```text
DEK = random
ciphertext = AES-GCM(DEK, plaintext)

encryptedKeys:
  - recipient A: RSA-OAEP(publicKeyA, DEK)
  - recipient B: RSA-OAEP(publicKeyB, DEK)
  - recipient C: RSA-OAEP(publicKeyC, DEK)
```

Format:

```json
{
  "version": 1,
  "contentEncryption": {
    "algorithm": "AES-256-GCM",
    "nonce": "..."
  },
  "recipients": [
    {
      "recipientKeyId": "user-a-key-2026",
      "keyEncryption": "RSA-OAEP-SHA256",
      "encryptedKey": "..."
    },
    {
      "recipientKeyId": "user-b-key-2026",
      "keyEncryption": "RSA-OAEP-SHA256",
      "encryptedKey": "..."
    }
  ],
  "ciphertext": "..."
}
```

Invariants:

1. Recipient list harus authenticated.
2. Recipient key ID harus authenticated.
3. Jangan biarkan attacker memindahkan encryptedKey dari envelope lain tanpa terdeteksi.
4. Purpose/context harus masuk AAD.
5. Jangan reuse DEK across unrelated documents kecuali desainnya eksplisit dan aman.

---

## 11. Key Agreement: Diffie-Hellman dan ECDH

### 11.1 Key Agreement Bukan Encryption

ECDH tidak menghasilkan ciphertext. ECDH menghasilkan shared secret.

```text
Alice private key + Bob public key   -> same shared secret
Bob private key   + Alice public key -> same shared secret
```

Lalu shared secret dipakai untuk derive keys.

```text
ECDH shared secret
   ↓ KDF
AES key / MAC key / nonce base / exporter secret
```

---

### 11.2 Static vs Ephemeral Key Agreement

#### Static-Static

```text
Alice static key + Bob static key
```

Pros:

- simple,
- identity stable.

Cons:

- jika private key bocor, past communications bisa terancam jika transcript/ciphertext tersimpan dan design tidak punya forward secrecy.

#### Ephemeral-Static

```text
Alice ephemeral key + Bob static key
```

Pros:

- sender fresh key per session/message,
- better compartmentalization.

Cons:

- authentication direction harus dipikirkan,
- recipient private key compromise bisa tetap berbahaya tergantung protocol.

#### Ephemeral-Ephemeral

```text
Alice ephemeral key + Bob ephemeral key
```

Pros:

- bisa mendukung forward secrecy jika authenticated dengan signature/certificate/protocol.
- lebih cocok untuk session protocol seperti TLS.

Cons:

- butuh authentication layer.
- raw ECDH saja tidak membuktikan identity.

---

### 11.3 Forward Secrecy

Forward secrecy berarti:

```text
If long-term private key is compromised later,
past session keys should remain protected.
```

Ini biasanya dicapai dengan ephemeral key agreement.

Contoh:

```text
TLS 1.3 uses ephemeral key exchange to derive session keys.
```

Dalam aplikasi custom, forward secrecy sulit dibuat benar jika kamu mendesain protocol sendiri. Untuk network communication, lebih baik gunakan TLS yang benar daripada membuat ECDH protocol sendiri.

---

## 12. ECDH di Java: Mental Model dan Example

Contoh ECDH raw:

```java
import javax.crypto.KeyAgreement;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.spec.ECGenParameterSpec;

public final class EcdhRawExample {

    public static void main(String[] args) throws Exception {
        KeyPair alice = generateEcKeyPair();
        KeyPair bob = generateEcKeyPair();

        byte[] aliceShared = deriveRawSharedSecret(alice, bob.getPublic());
        byte[] bobShared = deriveRawSharedSecret(bob, alice.getPublic());

        System.out.println(java.util.Arrays.equals(aliceShared, bobShared));
    }

    private static KeyPair generateEcKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    private static byte[] deriveRawSharedSecret(KeyPair ownKeyPair, PublicKey peerPublicKey) throws Exception {
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(ownKeyPair.getPrivate());
        agreement.doPhase(peerPublicKey, true);
        return agreement.generateSecret();
    }
}
```

Tetapi ini belum lengkap untuk production.

Masalah:

1. Tidak ada authentication.
2. Tidak ada KDF.
3. Tidak ada transcript binding.
4. Tidak ada key confirmation.
5. Tidak ada algorithm negotiation policy.
6. Tidak ada replay protection.
7. Tidak ada public key validation discussion.
8. Tidak ada context/purpose binding.
9. Tidak ada separation encryption vs MAC keys.
10. Tidak ada versioned envelope.

---

## 13. KDF Setelah Key Agreement

Raw shared secret harus diproses dengan KDF.

Idealnya gunakan KDF seperti HKDF, tetapi availability di pure JDK tergantung versi/provider. Banyak sistem memakai library vetted seperti Bouncy Castle, Tink, atau provider/cloud KMS capability jika sesuai policy.

Konsep HKDF:

```text
PRK = Extract(salt, sharedSecret)
OKM = Expand(PRK, info, length)
```

`info` harus bind context:

```text
application name
protocol version
algorithm suite
sender key id
recipient key id
transcript hash
purpose
tenant/domain
```

Contoh conceptual `info`:

```text
"case-platform:v1:file-transfer:alice-key-2026:bob-key-2026:aes-256-gcm"
```

Tanpa context binding, key material bisa secara tidak sengaja dipakai ulang lintas protocol.

---

## 14. Public Key Validation

Dalam key agreement, menerima public key dari peer tidak boleh dilakukan secara buta.

Risiko:

1. Invalid curve attack.
2. Small subgroup attack.
3. Key substitution.
4. Unknown key-share attack.
5. Algorithm confusion.
6. Wrong curve acceptance.
7. Cross-protocol key reuse.

Mitigation concept:

1. Gunakan provider/protocol yang melakukan validation dengan benar.
2. Restrict allowed curves/algorithms.
3. Bind peer identity ke public key.
4. Bind algorithm suite ke transcript/AAD.
5. Jangan campur key pair untuk signature dan ECDH kecuali scheme memang mendukung dan direkomendasikan.
6. Prefer TLS/mTLS untuk service-to-service daripada custom ECDH.

---

## 15. Key Agreement vs Key Transport: Kapan Pakai yang Mana?

### 15.1 Pakai RSA-OAEP Key Transport Jika

Cocok ketika:

1. Kamu perlu encrypt data untuk recipient tertentu secara asynchronous.
2. Recipient tidak sedang online.
3. Public key recipient sudah diketahui dan trusted.
4. Data bisa dikemas sebagai envelope.
5. Tidak butuh forward secrecy untuk stored object.
6. Use case mirip encrypted document/file/message at rest.

Contoh:

```text
Evidence export encrypted for agency public key.
```

---

### 15.2 Pakai ECDH/Key Agreement Jika

Cocok ketika:

1. Dua pihak berinteraksi dalam session/protocol.
2. Kamu ingin derive shared session keys.
3. Kamu membutuhkan forward secrecy.
4. Ada authentication layer.
5. Kamu mengikuti protocol established seperti TLS, Noise, HPKE, atau library vetted.

Contoh:

```text
TLS 1.3 connection.
```

---

### 15.3 Pakai KMS Envelope Encryption Jika

Cocok ketika:

1. App tidak boleh memegang long-term private key.
2. Key usage perlu audit.
3. Rotation perlu centralized.
4. Key material harus dilindungi HSM/KMS.
5. Compliance perlu separation of duties.
6. Data at rest di database/object storage.

Contoh:

```text
Encrypt sensitive case attachment before storing in S3/database.
```

---

## 16. HPKE: Modern Mental Model untuk Public-Key Encryption

Hybrid Public Key Encryption atau HPKE adalah modern construction yang mendefinisikan cara standar melakukan public-key encryption berbasis:

```text
KEM + KDF + AEAD
```

Konsep:

```text
KEM  = establish shared secret
KDF  = derive encryption context/key
AEAD = encrypt and authenticate payload
```

Kenapa penting walaupun kamu tidak langsung implement?

Karena HPKE mengajarkan architecture yang benar:

```text
Public-key cryptography should establish keys.
Symmetric AEAD should protect data.
Context must be bound.
Algorithms must be suite-based.
```

Jika kamu butuh public-key encryption modern dan interoperable, pertimbangkan library/protocol yang mengimplementasikan HPKE daripada membuat format custom dari nol.

---

## 17. KEM Concept dan Post-Quantum Awareness

### 17.1 Apa Itu KEM?

KEM = Key Encapsulation Mechanism.

Pattern:

```text
(encapsulatedKey, sharedSecret) = encapsulate(publicKey)
sharedSecret = decapsulate(privateKey, encapsulatedKey)
```

Berbeda dari encrypt arbitrary plaintext. KEM fokus pada membangun shared secret.

Modern hybrid encryption sering bisa dilihat sebagai:

```text
KEM + KDF + AEAD
```

RSA-OAEP key transport mirip "wrap random key", sedangkan KEM secara formal mendefinisikan key establishment pattern.

---

### 17.2 Post-Quantum Awareness

Quantum computer besar yang relevan secara kriptografis dapat mengancam RSA, finite-field DH, dan elliptic-curve DH/signature melalui Shor's algorithm.

Implikasi engineering:

1. Jangan hardcode desain yang sulit diganti.
2. Buat envelope versioned.
3. Simpan algorithm suite eksplisit.
4. Pisahkan key ID dan algorithm ID.
5. Dukung rotation.
6. Siapkan crypto agility.
7. Untuk long-term confidentiality, perhatikan risiko "harvest now, decrypt later".
8. Ikuti standard dan library/provider resmi, jangan implement PQC primitive sendiri.

Untuk Java engineer, post-quantum readiness bukan berarti menulis algoritma PQC sendiri. Yang penting adalah desain sistem bisa beradaptasi ketika provider, TLS stack, KMS, atau compliance policy berubah.

---

## 18. Crypto Agility

Crypto agility adalah kemampuan sistem mengganti primitive/key/protocol tanpa migrasi brutal.

Desain tidak agile:

```text
encrypted_value VARCHAR
contains base64 ciphertext only
no version
no algorithm
no key id
no nonce metadata
no tag metadata
```

Desain agile:

```json
{
  "version": 2,
  "suite": "X25519-HKDF-SHA256-AES-256-GCM",
  "keyId": "recipient-key-2026-q2",
  "nonce": "...",
  "encapsulatedKey": "...",
  "ciphertext": "..."
}
```

Database design:

```text
encrypted_payload_version
encryption_suite
key_id
nonce
encrypted_key
ciphertext
created_at
rotated_at
```

Operational support:

1. decrypt old version,
2. encrypt new version,
3. rewrap keys,
4. re-encrypt data when necessary,
5. monitor old algorithm usage,
6. eventually disable old algorithm.

---

## 19. Anti-Patterns

### 19.1 "Encrypt with Private Key"

Wrong mental model.

Jika goal kamu authenticity:

```text
Use digital signature.
```

Jika goal kamu confidentiality:

```text
Encrypt with recipient public key or derive session key with key agreement.
```

---

### 19.2 RSA untuk Semua Data

Wrong:

```text
RSA encrypt JSON/file/blob directly.
```

Correct:

```text
AES-GCM encrypts data.
RSA-OAEP wraps AES key.
```

---

### 19.3 Raw ECDH Secret sebagai AES Key

Wrong:

```java
byte[] shared = keyAgreement.generateSecret();
SecretKey key = new SecretKeySpec(shared, 0, 32, "AES");
```

Better:

```text
shared secret -> KDF with context -> AES key
```

---

### 19.4 Tidak Mengautentikasi Metadata

Wrong:

```text
ciphertext protected
algorithm/key id/purpose not protected
```

Attack:

```text
Attacker swaps key ID or algorithm metadata.
```

Better:

```text
All security-relevant metadata included in AAD/signature/transcript.
```

---

### 19.5 Blind Trust pada Public Key

Wrong:

```text
public key dari request body langsung dipakai encrypt.
```

Better:

```text
public key resolved from trusted registry/certificate/JWKS/KMS and identity-bound.
```

---

### 19.6 Automatic Fallback

Wrong:

```text
Try OAEP-SHA256.
If failed, try PKCS1Padding.
If failed, try OAEP-SHA1.
```

Ini bisa membuka downgrade oracle.

Better:

```text
Use explicit version/suite.
Reject unsupported suite.
Migration via controlled policy.
```

---

### 19.7 Detailed Decryption Errors

Wrong:

```text
"invalid OAEP padding"
"invalid GCM tag"
"unknown key id"
"wrong private key"
```

Better external error:

```text
"invalid encrypted envelope"
```

Internal audit boleh punya detail terbatas, aman, dan tidak mengandung secret.

---

### 19.8 Reusing Same Key Pair Across Purposes

Risk:

```text
same RSA key for signing and decryption
same EC key for ECDSA and ECDH
same key across test/prod
same key across protocols
```

Better:

```text
purpose-specific keys
key usage constraints
certificate KeyUsage/ExtendedKeyUsage
KMS key policy
algorithm suite separation
```

---

## 20. Security Invariants

Untuk asymmetric encryption/key agreement, invariant yang harus dijaga:

### 20.1 Public Key Identity Invariant

```text
Data must only be encrypted to a public key that is bound to the intended recipient identity.
```

Violation:

```text
attacker-supplied public key accepted.
```

---

### 20.2 Private Key Custody Invariant

```text
Long-term private keys must not be exportable, logged, committed, dumped, or broadly accessible.
```

Violation:

```text
private key loaded from plaintext config file readable by all pods.
```

---

### 20.3 Hybrid Encryption Invariant

```text
Large payloads must be encrypted with authenticated symmetric encryption, not raw asymmetric encryption.
```

Violation:

```text
RSA used directly for chunks of file data.
```

---

### 20.4 Metadata Authentication Invariant

```text
Algorithm, version, key ID, purpose, tenant, and recipient context must be authenticated.
```

Violation:

```text
keyId is parsed from unauthenticated JSON and controls decryption behavior.
```

---

### 20.5 Algorithm Allowlist Invariant

```text
Only explicitly allowed algorithms/suites may be accepted.
```

Violation:

```text
Cipher.getInstance(envelope.algorithmFromUser())
```

---

### 20.6 Key Separation Invariant

```text
A key must be used only for its intended purpose.
```

Violation:

```text
same RSA private key used for decrypting payloads and signing legal records.
```

---

### 20.7 Key Agreement KDF Invariant

```text
Raw key agreement output must go through a KDF with context binding before use.
```

Violation:

```text
ECDH output used directly as AES key.
```

---

### 20.8 Replay/Freshness Invariant

```text
If encrypted messages are commands or transactions, encryption alone is not enough; freshness/replay controls are required.
```

Violation:

```text
old encrypted approval command replayed successfully.
```

---

## 21. Failure Modes

### 21.1 Confidentiality Failure

Cause:

- wrong public key,
- compromised private key,
- weak padding,
- untrusted key source,
- logged plaintext/DEK,
- KMS mispolicy.

Impact:

- data disclosure,
- cross-tenant exposure,
- evidence leakage,
- regulatory breach.

---

### 21.2 Integrity Failure

Cause:

- unauthenticated metadata,
- non-AEAD encryption,
- accepting modified envelope,
- no signature/MAC where required.

Impact:

- wrong recipient,
- wrong tenant context,
- downgraded algorithm,
- tampered file accepted.

---

### 21.3 Availability Failure

Cause:

- expired certificate/key,
- missing private key alias,
- rotation not propagated,
- unsupported provider algorithm,
- KMS outage,
- HSM rate limit.

Impact:

- cannot decrypt data,
- message backlog,
- failed login/integration,
- evidence inaccessible.

---

### 21.4 Non-Repudiation Failure

Cause:

- using encryption where signature needed,
- shared private key,
- no audit trail for key usage,
- no timestamp authority,
- poor custody.

Impact:

- cannot prove who signed,
- legal dispute,
- weak audit defensibility.

---

### 21.5 Cryptographic Agility Failure

Cause:

- no version field,
- algorithm implicit in code,
- key ID absent,
- encrypted data stored as opaque blob,
- no migration process.

Impact:

- cannot rotate,
- cannot migrate away from deprecated algorithm,
- forced big-bang data rewrite.

---

## 22. Review Questions for Design

Saat review desain asymmetric encryption/key agreement, tanyakan:

1. Apa objective-nya: confidentiality, authenticity, integrity, non-repudiation, atau key establishment?
2. Apakah ini butuh encryption atau signature?
3. Jika encryption, kenapa asymmetric langsung? Kenapa bukan hybrid?
4. Bagaimana public key di-bind ke identity?
5. Bagaimana private key disimpan?
6. Siapa boleh decrypt?
7. Apakah key exportable?
8. Apakah KMS/HSM dipakai?
9. Bagaimana key rotation dilakukan?
10. Apakah payload format versioned?
11. Apakah algorithm suite eksplisit?
12. Apakah key ID authenticated?
13. Apakah metadata masuk AAD?
14. Apakah decryption error uniform?
15. Apakah replay protection dibutuhkan?
16. Apakah forward secrecy dibutuhkan?
17. Jika memakai ECDH, di mana KDF-nya?
18. Apa context binding di KDF?
19. Apakah algorithm negotiation bisa downgrade?
20. Apa incident plan jika private key bocor?

---

## 23. Case Study: Secure Evidence Export untuk Regulatory Case Platform

### 23.1 Requirement

Sebuah platform case management perlu mengekspor evidence file ke agency lain.

Requirement:

1. File hanya bisa dibuka agency penerima.
2. Platform pengirim tidak perlu menyimpan shared secret dengan agency.
3. File bisa besar.
4. Metadata case harus tidak bisa diubah tanpa terdeteksi.
5. Penerima bisa decrypt secara offline.
6. Key agency bisa rotate per tahun.
7. Export harus audit-friendly.

---

### 23.2 Wrong Design

```text
1. Serialize file as ZIP.
2. Encrypt ZIP pakai RSA public key agency.
3. Store base64 result.
4. Email/link result.
```

Masalah:

1. RSA tidak cocok untuk file besar.
2. Tidak ada AEAD.
3. Metadata tidak authenticated.
4. Tidak ada version.
5. Tidak ada key ID.
6. Tidak ada rotation story.
7. Tidak ada audit envelope.
8. Public key trust belum jelas.

---

### 23.3 Better Design

```text
1. Resolve agency public encryption certificate from trusted registry.
2. Validate certificate chain, expiry, key usage, and agency identity.
3. Generate random DEK.
4. Build protected metadata:
   - caseId
   - evidenceId
   - exportId
   - recipientAgencyId
   - issuerSystemId
   - createdAt
   - purpose
   - algorithm suite
   - recipientKeyId
5. Encrypt file using AES-256-GCM with protected metadata as AAD.
6. Wrap DEK using RSA-OAEP-SHA256 with agency public key.
7. Create envelope JSON/CBOR.
8. Optionally sign envelope with platform signing key.
9. Store audit record:
   - exportId
   - recipient
   - keyId
   - digest of ciphertext
   - operator/system actor
   - timestamp
10. Receiver validates envelope, unwraps DEK, decrypts file, and verifies optional signature.
```

---

### 23.4 Architecture Diagram

```text
+-------------------------+
| Case Platform           |
|                         |
|  Evidence File          |
|      │                  |
|      ▼                  |
|  Generate DEK           |
|      │                  |
|      ├── AES-GCM encrypt file ──────► ciphertext
|      │                                  ▲
|      │                                  │ AAD: protected metadata
|      ▼                                  │
|  RSA-OAEP wrap DEK                      │
|      │                                  │
|      ▼                                  │
|  encrypted DEK                          │
|      │                                  │
|      └───────────── Envelope ───────────┘
|
| Optional: Sign envelope
+-------------------------+

                  │
                  ▼

+-------------------------+
| Recipient Agency        |
|                         |
|  Resolve private key    |
|  Unwrap DEK             |
|  Verify metadata/AAD    |
|  Decrypt AES-GCM        |
|  Verify optional sig    |
+-------------------------+
```

---

### 23.5 Security Invariants

```text
Invariant 1:
Evidence plaintext is encrypted only with random DEK.

Invariant 2:
DEK is wrapped only for validated recipient public key.

Invariant 3:
Metadata that determines case/recipient/purpose/key/suite is authenticated.

Invariant 4:
Decrypt failure does not reveal which cryptographic check failed.

Invariant 5:
Key rotation does not break old exports because each envelope records recipientKeyId and suite.

Invariant 6:
Audit record links export event to envelope digest, actor, recipient, and timestamp.
```

---

## 24. Case Study: Service-to-Service Secure Session

Requirement:

```text
Service A and Service B communicate online.
They need confidentiality, integrity, server identity, and preferably forward secrecy.
```

Wrong design:

```text
Implement custom ECDH over REST headers.
```

Better design:

```text
Use TLS 1.3 or mTLS.
```

Why?

1. TLS already solves algorithm negotiation.
2. TLS authenticates server certificate.
3. mTLS can authenticate client certificate.
4. TLS 1.3 supports ephemeral key exchange.
5. Libraries/provider handle public key validation.
6. Operational tooling exists.
7. Observability and certificate rotation are known practices.

Custom ECDH is justified only when:

1. You are implementing a well-reviewed protocol.
2. You have cryptographic expertise.
3. You can test interop.
4. You can handle downgrade/replay/transcript binding.
5. You can support incident response.

For most Java enterprise systems:

```text
Use TLS/mTLS for transport.
Use application-level signatures/MAC only for specific end-to-end integrity across intermediaries.
```

---

## 25. Java Provider and Interoperability Notes

### 25.1 Provider Differences

Different providers may differ in:

1. supported algorithms,
2. transformation aliases,
3. OAEP defaults,
4. curve support,
5. key encoding behavior,
6. FIPS mode behavior,
7. disabled algorithm policy,
8. exception types/messages.

Do not assume:

```text
Works on my JDK provider == portable across all runtime environments.
```

---

### 25.2 Always Specify Protocol-Level Suite

Instead of storing:

```text
RSA
```

Store:

```text
RSA-OAEP-SHA256-MGF1SHA256 + AES-256-GCM
```

Instead of storing:

```text
ECDH
```

Store:

```text
ECDH-secp256r1-HKDF-SHA256-AES-256-GCM
```

Even better, define internal suite IDs:

```text
ENVELOPE_V1_RSA_OAEP_SHA256_AES_256_GCM
ENVELOPE_V2_X25519_HKDF_SHA256_AES_256_GCM
```

And map those IDs to implementation details in code.

---

## 26. Production Checklist

### Design

- [ ] Objective jelas: encryption, signature, key transport, atau key agreement.
- [ ] Public key identity binding jelas.
- [ ] Private key custody jelas.
- [ ] Hybrid encryption untuk payload besar.
- [ ] Envelope versioned.
- [ ] Algorithm suite eksplisit.
- [ ] Key ID eksplisit dan authenticated.
- [ ] Metadata security-relevant masuk AAD/signature.
- [ ] Key rotation path tersedia.
- [ ] Decrypt old/encrypt new migration didukung.

### Implementation

- [ ] RSA-OAEP, bukan raw RSA.
- [ ] AES-GCM/AEAD untuk data.
- [ ] Random DEK per object/message.
- [ ] Nonce unique per DEK.
- [ ] OAEP parameter eksplisit.
- [ ] Tidak menerima arbitrary algorithm dari input.
- [ ] Error eksternal uniform.
- [ ] Secret tidak dilog.
- [ ] Private key tidak disimpan plaintext.
- [ ] Test interop antar platform/provider.

### Key Agreement

- [ ] Raw shared secret tidak langsung dipakai.
- [ ] Ada KDF.
- [ ] Ada context binding.
- [ ] Ada authentication.
- [ ] Ada replay/freshness control bila message-level.
- [ ] Curve/algorithm allowlist.
- [ ] Tidak membuat custom protocol jika TLS/mTLS cukup.

### Operation

- [ ] Key inventory.
- [ ] Owner key jelas.
- [ ] Expiry monitoring.
- [ ] Rotation playbook.
- [ ] Compromise playbook.
- [ ] KMS/HSM audit enabled.
- [ ] Backup/restore private key policy jelas.
- [ ] Revocation/decommission policy ada.
- [ ] Metrics decrypt failure tidak leak sensitive detail.
- [ ] Old algorithm usage monitored.

---

## 27. Mini Exercises

### Exercise 1

Kamu menemukan code:

```java
Cipher cipher = Cipher.getInstance("RSA");
cipher.init(Cipher.ENCRYPT_MODE, publicKey);
byte[] encrypted = cipher.doFinal(largeJson.getBytes());
```

Analisis:

1. Apa masalahnya?
2. Apa risiko provider default?
3. Apa risiko ukuran payload?
4. Apa desain penggantinya?
5. Metadata apa yang harus ditambahkan?

Jawaban ideal:

```text
Gunakan hybrid encryption:
- random DEK
- AES-GCM untuk JSON
- RSA-OAEP-SHA256 untuk wrap DEK
- version/suite/keyId/nonce/AAD
- public key trust validation
```

---

### Exercise 2

Kamu melihat requirement:

```text
"Untuk membuktikan pesan berasal dari system A, encrypt payload pakai private key system A."
```

Perbaiki requirement.

Jawaban:

```text
Gunakan digital signature dengan private signing key system A.
Receiver memverifikasi signature dengan public key/certificate system A.
Jika payload juga confidential, lakukan encrypt-then-sign atau sign-then-encrypt sesuai protocol yang jelas, tetapi jangan menyebut signature sebagai private-key encryption.
```

---

### Exercise 3

Kamu diminta membuat REST endpoint:

```text
POST /secure-command
Header: X-Public-Key
Body: encrypted command
```

Client mengirim public key di header.

Pertanyaan:

1. Apakah ini aman?
2. Public key siapa?
3. Apa trust boundary?
4. Bagaimana identity binding?
5. Apakah command butuh replay protection?

Insight:

```text
Public key dari caller tidak otomatis trusted.
Jika server encrypt response ke key itu, attacker bisa inject key.
Jika command terenkripsi untuk server, server public key harus diketahui client dari trusted channel.
Command integrity/authenticity butuh signature/MAC/token binding.
Replay protection butuh nonce/timestamp/idempotency/event ID.
```

---

## 28. Mental Model Ringkas

Ingat pemetaan ini:

```text
Need confidentiality for data?
    Use symmetric AEAD for data.

Need encrypt data for recipient with public key?
    Use hybrid encryption.

Need prove sender?
    Use digital signature or MAC depending trust model.

Need establish session key online?
    Use TLS/mTLS or vetted key agreement protocol.

Need encrypt stored data with centralized control?
    Use envelope encryption with KMS/HSM.

Need future migration?
    Use versioned envelope and crypto agility.

Need protect against replay?
    Crypto alone is not enough; add freshness/idempotency/sequence.
```

---

## 29. Summary

Asymmetric encryption dan key agreement adalah foundation penting, tetapi juga sumber banyak kesalahan desain.

Hal yang harus melekat:

1. Public-key encryption bukan signature.
2. Signature bukan encryption.
3. "Encrypt with private key" adalah istilah yang harus dihindari.
4. RSA tidak dipakai untuk mengenkripsi data besar langsung.
5. Gunakan hybrid encryption: asymmetric untuk key, symmetric AEAD untuk data.
6. RSA-OAEP lebih tepat untuk desain baru daripada RSA PKCS#1 v1.5 encryption.
7. ECDH menghasilkan shared secret, bukan ciphertext.
8. Raw shared secret harus masuk KDF.
9. Public key harus di-bind ke identity.
10. Metadata harus authenticated.
11. Envelope harus versioned dan algorithm-aware.
12. Decrypt error harus uniform.
13. Key rotation harus didesain dari awal.
14. Forward secrecy butuh ephemeral key agreement/protocol.
15. Untuk service-to-service, TLS/mTLS biasanya lebih tepat daripada custom crypto.
16. Crypto agility adalah requirement production, bukan nice-to-have.
17. Post-quantum awareness berarti desain siap migrasi, bukan implement algorithm sendiri.

---

## 30. Referensi

Referensi primer dan panduan yang relevan untuk part ini:

1. Oracle Java Cryptography Architecture Reference Guide.
2. Oracle Java `Cipher` API.
3. Oracle Java `KeyAgreement` API.
4. Oracle Java Security Standard Algorithm Names.
5. NIST SP 800-56A Rev. 3 — Pair-Wise Key Establishment Using Discrete Logarithm Cryptography.
6. NIST SP 800-56B Rev. 2 — Pair-Wise Key Establishment Using Integer Factorization Cryptography.
7. NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management.
8. OWASP Cryptographic Storage Cheat Sheet.
9. OWASP Key Management Cheat Sheet.
10. OWASP Secrets Management Cheat Sheet.
11. RFC 9180 — Hybrid Public Key Encryption.
12. RFC 8017 — PKCS #1 RSA Cryptography Specifications.
13. RFC 8446 — TLS 1.3.
14. RFC 5869 — HKDF.
15. Java provider documentation for supported algorithms and transformation strings.

---

## 31. Status Seri

Seri `learn-java-security-cryptography-integrity` belum selesai.

Progress saat ini:

```text
[x] Part 0  — Security Mental Model for Senior Java Engineers
[x] Part 1  — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
[x] Part 2  — Threat Modeling for Java Systems
[x] Part 3  — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
[x] Part 4  — Randomness, Entropy, Nonce, Salt, IV, Token
[x] Part 5  — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
[x] Part 6  — Password Storage, Password Verification, and Secret-Derived Keys
[x] Part 7  — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
[x] Part 8  — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
[x] Part 9  — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
[x] Part 10 — Asymmetric Encryption and Key Agreement
[ ] Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
...
[ ] Part 34 — Capstone: Designing a Secure Java Regulatory Case Management Platform
```

Part berikutnya: **Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM**.
